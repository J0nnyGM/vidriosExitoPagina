const functions = require("firebase-functions");
// Sintaxis moderna para importar los servicios de Firebase Admin
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

// Inicialización segura para evitar que la app se inicie varias veces
if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();
const auth = getAuth();

/**
 * Cloud Function para recibir una orden de compra, crear lotes de stock y actualizar el inventario.
 */
exports.receivePurchaseOrder = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "La función debe ser llamada por un usuario autenticado.");
  }
  const uid = context.auth.uid;

  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) {
    throw new functions.https.HttpsError("not-found", "El usuario que realiza la llamada no existe.");
  }
  const userRole = userDoc.data().role;
  if (userRole !== 'admin' && userRole !== 'bodega') {
    throw new functions.https.HttpsError("permission-denied", "No tienes permisos (admin/bodega) para esta acción.");
  }

  const poId = data.poId;
  if (!poId) {
    throw new functions.https.HttpsError("invalid-argument", "Se requiere un ID de orden de compra (poId).");
  }

  const poRef = db.collection("purchaseOrders").doc(poId);

  try {
    await db.runTransaction(async (transaction) => {
      const poDoc = await transaction.get(poRef);
      if (!poDoc.exists) throw new functions.https.HttpsError("not-found", "La orden de compra no existe.");
      
      const poData = poDoc.data();
      if (poData.status !== "pendiente") throw new functions.https.HttpsError("failed-precondition", "Esta orden ya fue procesada.");
      if (!Array.isArray(poData.items) || poData.items.length === 0) throw new Error("La orden de compra no contiene materiales.");

      for (const item of poData.items) {
        if (!item.materialId || typeof item.quantity !== 'number' || item.quantity <= 0) {
          throw new Error(`El item en la orden tiene un formato o cantidad incorrecta.`);
        }
        
        const materialRef = db.collection("materialCatalog").doc(item.materialId);
        const batchRef = materialRef.collection("stockBatches").doc();

        transaction.set(batchRef, {
            purchaseDate: new Date(),
            quantityInitial: item.quantity,
            quantityRemaining: item.quantity,
            unitCost: item.unitCost || 0,
            purchaseOrderId: poId,
        });
        transaction.update(materialRef, { quantityInStock: FieldValue.increment(item.quantity) });
      }
      transaction.update(poRef, { status: "recibida", receivedAt: new Date(), receivedBy: uid });
    });
    return { message: "¡Mercancía recibida y stock actualizado correctamente!" };
  } catch (error) {
    console.error(`CRASH en la transacción para PO ${poId}:`, error.message);
    throw new functions.https.HttpsError("internal", error.message || "Ocurrió un error interno en la transacción.");
  }
});

/**
 * Cloud Function para procesar una solicitud de material usando FIFO.
 */
exports.requestMaterialFIFO = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "El usuario debe estar autenticado.");
  }

  const { projectId, materials, subItemIds } = data;
  const uid = context.auth.uid;

  if (!projectId || !materials || !subItemIds || materials.length === 0 || subItemIds.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "Faltan datos para la solicitud.");
  }

  const requestRef = db.collection("projects").doc(projectId).collection("materialRequests").doc();

  try {
    await db.runTransaction(async (transaction) => {
      let totalRequestCost = 0;
      let allConsumedBatches = [];
      let allMaterialNames = [];

      for (const material of materials) {
        const materialRef = db.collection("materialCatalog").doc(material.materialId);
        const batchesQuery = materialRef.collection("stockBatches").where("quantityRemaining", ">", 0).orderBy("purchaseDate", "asc");
        
        // En el SDK de Admin, las consultas SÍ se pueden hacer dentro de la transacción
        const batchesSnapshot = await transaction.get(batchesQuery);
        
        // Hacemos una validación de stock real antes de continuar
        const realStock = batchesSnapshot.docs.reduce((sum, doc) => sum + doc.data().quantityRemaining, 0);
        if (realStock < material.quantity) {
            const materialDoc = await transaction.get(materialRef);
            const materialName = materialDoc.exists() ? materialDoc.data().name : material.materialId;
            throw new Error(`No hay stock real de ${materialName}. Solicitado: ${material.quantity}, Disponible: ${realStock}.`);
        }

        let remainingToFulfill = material.quantity;
        let materialCost = 0;

        for (const batchDoc of batchesSnapshot.docs) {
          if (remainingToFulfill <= 0) break;
          const batchData = batchDoc.data();
          const consume = Math.min(batchData.quantityRemaining, remainingToFulfill);

          // SINTAXIS CORREGIDA: Usamos FieldValue directamente
          transaction.update(batchDoc.ref, { quantityRemaining: FieldValue.increment(-consume) });
          materialCost += consume * batchData.unitCost;
          remainingToFulfill -= consume;
          allConsumedBatches.push({ materialId: material.materialId, batchId: batchDoc.id, quantityConsumed: consume });
        }

        // SINTAXIS CORREGIDA: Usamos FieldValue directamente
        transaction.update(materialRef, { quantityInStock: FieldValue.increment(-material.quantity) });
        
        const materialDoc = await transaction.get(materialRef);
        const materialName = materialDoc.exists() ? materialDoc.data().name : material.materialId;

        totalRequestCost += materialCost;
        allMaterialNames.push(`${material.quantity} x ${materialName}`);
      }

      transaction.set(requestRef, {
        materials,
        subItemIds,
        materialName: allMaterialNames.join(', '),
        quantity: materials.reduce((sum, mat) => sum + mat.quantity, 0),
        requesterId: uid,
        createdAt: new Date(),
        status: "solicitado",
        totalCost: totalRequestCost,
        consumedBatches: allConsumedBatches,
      });
    });
    
    return { success: true, message: "Solicitud creada con éxito." };
  } catch (error) {
    console.error("Error en la transacción FIFO:", error);
    throw new functions.https.HttpsError("internal", "No se pudo completar la solicitud: " + error.message);
  }
});

/**
 * Cloud Function para procesar la devolución de material.
 */
exports.returnMaterial = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "El usuario debe estar autenticado.");
  }

  const { projectId, requestId, quantityToReturn } = data;
  
  if (!projectId || !requestId || !quantityToReturn || quantityToReturn <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "Faltan datos para la devolución.");
  }

  const requestRef = db.collection("projects").doc(projectId).collection("materialRequests").doc(requestId);

  try {
    await db.runTransaction(async (transaction) => {
      const requestDoc = await transaction.get(requestRef);
      if (!requestDoc.exists) throw new Error("La solicitud original no existe.");

      const requestData = requestDoc.data();
      // Asumiendo que las solicitudes ahora pueden tener MÚLTIPLES materiales, esta lógica necesita un ajuste.
      // Por ahora, la mantenemos simple asumiendo que solo se devuelve el PRIMER material de la solicitud.
      const materialId = requestData.materials[0].materialId;
      if (!materialId) throw new Error("La solicitud no tiene un ID de material válido.");

      const materialRef = db.collection("materialCatalog").doc(materialId);

      const alreadyReturned = requestData.returnedQuantity || 0;
      const totalRequested = requestData.materials[0].quantity;
      if (quantityToReturn > (totalRequested - alreadyReturned)) {
        throw new Error("No se puede devolver más material del que se solicitó originalmente.");
      }

      // SINTAXIS CORREGIDA: Usamos FieldValue directamente
      transaction.update(materialRef, {
        quantityInStock: FieldValue.increment(quantityToReturn),
      });

      // Creamos un nuevo lote para el material devuelto
      const batchRef = materialRef.collection("stockBatches").doc();
      transaction.set(batchRef, {
        purchaseDate: new Date(),
        quantityInitial: quantityToReturn,
        quantityRemaining: quantityToReturn,
        unitCost: 0, // El material devuelto no tiene costo de compra
        notes: `Devolución de solicitud ${requestId}`,
      });
      
      // SINTAXIS CORREGIDA: Usamos FieldValue directamente
      transaction.update(requestRef, {
        returnedQuantity: FieldValue.increment(quantityToReturn),
      });
    });

    return { success: true, message: "Devolución registrada con éxito." };
  } catch (error) {
    console.error("Error en la transacción de devolución:", error);
    throw new functions.https.HttpsError("internal", "No se pudo completar la devolución: " + error.message);
  }
});