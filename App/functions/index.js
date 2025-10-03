const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const fcm = admin.messaging();

  /**
 * Cloud Function para recibir una orden de compra y actualizar el inventario por lotes (FIFO).
 * Esta función es "callable", lo que significa que la llamaremos directamente desde nuestro app.js.
 */
exports.receivePurchaseOrder = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "El usuario debe estar autenticado.");
  }
  const poId = data.poId;
  const uid = context.auth.uid;
  if (!poId) {
    throw new functions.https.HttpsError("invalid-argument", "Se requiere el ID de la orden de compra.");
  }
  const poRef = db.collection("purchaseOrders").doc(poId);
  try {
    await db.runTransaction(async (transaction) => {
      const poDoc = await transaction.get(poRef);
      if (!poDoc.exists) {
        throw new Error("La orden de compra no existe.");
      }
      if (poDoc.data().status !== "pendiente") {
        throw new Error("Esta orden ya fue procesada.");
      }
      const poItems = poDoc.data().items;
      for (const item of poItems) {
        const materialRef = db.collection("materialCatalog").doc(item.materialId);
        const batchRef = materialRef.collection("stockBatches").doc();
        transaction.set(batchRef, {
          purchaseDate: poDoc.data().createdAt,
          quantityReceived: item.quantity,
          quantityRemaining: item.quantity,
          unitCost: item.unitCost,
          purchaseOrderId: poId,
        });
        transaction.update(materialRef, {
          quantityInStock: admin.firestore.FieldValue.increment(item.quantity),
        });
      }
      transaction.update(poRef, {
        status: "recibida",
        receivedAt: new Date(),
        receivedBy: uid,
      });
    });
    return { success: true, message: "Stock actualizado con éxito." };
  } catch (error) {
    console.error("Error en la transacción de recepción:", error);
    throw new functions.https.HttpsError("internal", "No se pudo completar la recepción: " + error.message);
  }
});

/**
 * Cloud Function para procesar una solicitud de material usando el método FIFO.
 * Descuenta el stock de los lotes más antiguos y calcula el costo real.
 */
exports.requestMaterialFIFO = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "El usuario debe estar autenticado.");
  }

  const { projectId, materials, subItemIds } = data; // Nuevos parámetros
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

      // Procesamos cada material solicitado en la misma transacción
      for (const material of materials) {
        const materialRef = db.collection("materialCatalog").doc(material.materialId);
        const materialDoc = await transaction.get(materialRef);

        if (!materialDoc.exists) throw new Error(`El material ${material.materialId} no existe.`);
        const materialData = materialDoc.data();
        if (materialData.quantityInStock < material.quantity) {
          throw new Error(`No hay stock de ${materialData.name}. Solicitado: ${material.quantity}, Disponible: ${materialData.quantityInStock}.`);
        }

        const batchesQuery = materialRef.collection("stockBatches").where("quantityRemaining", ">", 0).orderBy("purchaseDate", "asc");
        const batchesSnapshot = await transaction.get(batchesQuery);
        
        let remainingToFulfill = material.quantity;
        let materialCost = 0;

        for (const batchDoc of batchesSnapshot.docs) {
          if (remainingToFulfill <= 0) break;
          const batchData = batchDoc.data();
          const consume = Math.min(batchData.quantityRemaining, remainingToFulfill);
          transaction.update(batchDoc.ref, { quantityRemaining: admin.firestore.FieldValue.increment(-consume) });
          materialCost += consume * batchData.unitCost;
          remainingToFulfill -= consume;
          allConsumedBatches.push({ materialId: material.materialId, batchId: batchDoc.id, quantityConsumed: consume });
        }
        
        if (remainingToFulfill > 0) throw new Error(`Inconsistencia en el stock para ${materialData.name}.`);

        transaction.update(materialRef, { quantityInStock: admin.firestore.FieldValue.increment(-material.quantity) });
        totalRequestCost += materialCost;
        allMaterialNames.push(`${material.quantity} x ${materialData.name}`);
      }

      // Creamos la solicitud unificada
      transaction.set(requestRef, {
        materials: materials, // Array de materiales
        subItemIds: subItemIds, // Array de sub-ítems
        materialName: allMaterialNames.join(', '), // Un resumen para la vista rápida
        quantity: materials.reduce((sum, mat) => sum + mat.quantity, 0), // Cantidad total de items
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
 * Cloud Function para procesar la devolución de material al inventario.
 * Revierte la salida de material, añadiéndolo de vuelta al lote más reciente.
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
      if (!requestDoc.exists) {
        throw new Error("La solicitud original no existe.");
      }

      const requestData = requestDoc.data();
      const materialId = requestData.materialId;
      const materialRef = db.collection("materialCatalog").doc(materialId);

      const alreadyReturned = requestData.returnedQuantity || 0;
      if (quantityToReturn > (requestData.quantity - alreadyReturned)) {
        throw new Error("No se puede devolver más material del que se solicitó.");
      }

      transaction.update(materialRef, {
        quantityInStock: admin.firestore.FieldValue.increment(quantityToReturn),
      });

      const batchRef = materialRef.collection("stockBatches").doc();
      transaction.set(batchRef, {
        purchaseDate: new Date(),
        quantityReceived: quantityToReturn,
        quantityRemaining: quantityToReturn,
        unitCost: 0,
        notes: `Devolución de solicitud ${requestId}`,
      });
      
      transaction.update(requestRef, {
        returnedQuantity: admin.firestore.FieldValue.increment(quantityToReturn),
        status: 'Devolución Parcial',
      });
    });

    return { success: true, message: "Devolución registrada con éxito." };
  } catch (error) {
    console.error("Error en la transacción de devolución:", error);
    throw new functions.https.HttpsError("internal", "No se pudo completar la devolución: " + error.message);
  }
});

