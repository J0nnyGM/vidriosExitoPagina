const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const fcm = admin.messaging();

exports.sendPushNotification = functions.firestore
  .document("notifications/{notificationId}")
  .onCreate(async (snapshot) => {
    const notificationData = snapshot.data();
    const userId = notificationData.userId;

    // Obtener el documento del usuario para encontrar su token
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      console.log(`No se encontró al usuario ${userId}`);
      return;
    }

    const userData = userDoc.data();
    const fcmTokens = userData.fcmTokens;

    if (!fcmTokens || fcmTokens.length === 0) {
      console.log(`El usuario ${userId} no tiene tokens de notificación.`);
      return;
    }

    // Crear el mensaje de la notificación
    const payload = {
      notification: {
        title: "Acción Requerida en Proyecto",
        body: notificationData.message,
        click_action: "https://vidriosexitoorganizador.web.app", // URL de tu app
      },
    };

    // Enviar la notificación a todos los tokens del usuario
    try {
      const response = await fcm.sendToDevice(fcmTokens, payload);
      console.log("Notificación enviada con éxito:", response);
    } catch (error) {
      console.error("Error al enviar la notificación:", error);
    }
  });

  /**
 * Cloud Function para recibir una orden de compra y actualizar el inventario por lotes (FIFO).
 * Esta función es "callable", lo que significa que la llamaremos directamente desde nuestro app.js.
 */
exports.receivePurchaseOrder = functions.https.onCall(async (data, context) => {
  // Verificación de autenticación
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "El usuario debe estar autenticado.",
    );
  }

  const poId = data.poId;
  const uid = context.auth.uid;

  if (!poId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Se requiere el ID de la orden de compra.",
    );
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
      let totalStockUpdate = 0;

      // Por cada ítem en la orden de compra, creamos un nuevo lote de stock
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

        // Usamos FieldValue para sumar la nueva cantidad al stock total del material
        transaction.update(materialRef, {
            quantityInStock: admin.firestore.FieldValue.increment(item.quantity)
        });
      }

      // Finalmente, actualizamos el estado de la orden de compra
      transaction.update(poRef, {
        status: "recibida",
        receivedAt: new Date(),
        receivedBy: uid,
      });
    });

    return {success: true, message: "Stock actualizado con éxito."};
  } catch (error) {
    console.error("Error en la transacción de recepción:", error);
    throw new functions.https.HttpsError(
      "internal",
      "No se pudo completar la recepción de la orden: " + error.message,
    );
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

  const {projectId, materialId, quantity, subItemId} = data;
  const uid = context.auth.uid;

  if (!projectId || !materialId || !quantity || !subItemId) {
    throw new functions.https.HttpsError("invalid-argument", "Faltan datos para la solicitud.");
  }

  const materialRef = db.collection("materialCatalog").doc(materialId);
  const requestRef = db.collection("projects").doc(projectId).collection("materialRequests").doc();

  try {
    await db.runTransaction(async (transaction) => {
      // 1. Leer el documento principal del material
      const materialDoc = await transaction.get(materialRef);
      if (!materialDoc.exists) {
        throw new Error("El material solicitado no existe en el catálogo.");
      }
      
      const materialData = materialDoc.data();
      if (materialData.quantityInStock < quantity) {
        throw new Error(`No hay suficiente stock. Solicitado: ${quantity}, Disponible: ${materialData.quantityInStock}.`);
      }

      // 2. Leer todos los lotes de stock, ordenados por fecha (FIFO)
      const batchesQuery = materialRef.collection("stockBatches")
        .where("quantityRemaining", ">", 0)
        .orderBy("quantityRemaining")
        .orderBy("purchaseDate");
      
      const batchesSnapshot = await transaction.get(batchesQuery);

      let remainingToFulfill = quantity;
      let totalCost = 0;
      const consumedBatches = []; // Para registrar de dónde salió el material

      // 3. Recorrer los lotes y "consumirlos"
      for (const batchDoc of batchesSnapshot.docs) {
        if (remainingToFulfill <= 0) break;

        const batchData = batchDoc.data();
        const availableInBatch = batchData.quantityRemaining;
        const consumeFromBatch = Math.min(availableInBatch, remainingToFulfill);

        const newRemaining = availableInBatch - consumeFromBatch;
        transaction.update(batchDoc.ref, { quantityRemaining: newRemaining });

        totalCost += consumeFromBatch * batchData.unitCost;
        remainingToFulfill -= consumeFromBatch;
        
        consumedBatches.push({
            batchId: batchDoc.id,
            quantityConsumed: consumeFromBatch,
            unitCost: batchData.unitCost
        });
      }

      if (remainingToFulfill > 0) {
        // Esto no debería ocurrir si la cantidad total en stock es correcta.
        throw new Error("Inconsistencia en el stock. No se pudo cumplir la solicitud.");
      }

// 4. Actualizar la cantidad total en el documento principal del material
      const newStock = materialData.quantityInStock - quantity;
      transaction.update(materialRef, {
        quantityInStock: newStock
      });

      // ======== INICIO: LÓGICA DE ALERTA DE STOCK MÍNIMO ========
      const minStockThreshold = materialData.minStockThreshold || 0;
      if (minStockThreshold > 0 && newStock <= minStockThreshold) {
          // Si el nuevo stock está por debajo del umbral, creamos una notificación
          const notificationRef = db.collection("notifications").doc();
          transaction.set(notificationRef, {
              // Dirigimos la notificación a un "canal" de administradores
              channel: "admins_bodega", 
              message: `Alerta de Stock Bajo: El material "${materialData.name}" ha alcanzado el umbral mínimo (${newStock} / ${minStockThreshold}).`,
              read: false,
              createdAt: new Date(),
              link: "/catalog" // Para que al hacer clic, los lleve al catálogo
          });
      }
      // ==========================================================

      // 5. Crear el documento de la solicitud con el costo calculado
      transaction.set(requestRef, {
        materialId: materialId,
        materialName: materialData.name,
        quantity: quantity,
        subItemId: subItemId,
        requesterId: uid,
        createdAt: new Date(),
        status: "solicitado",
        totalCost: totalCost, // <-- ¡EL COSTO FIFO CALCULADO!
        consumedBatches: consumedBatches // <-- Trazabilidad completa
      });
    });
    
    return { success: true, message: "Solicitud creada con éxito." };
  } catch (error) {
    console.error("Error en la transacción FIFO:", error);
    throw new functions.https.HttpsError(
      "internal",
      "No se pudo completar la solicitud: " + error.message,
    );
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
  const uid = context.auth.uid;

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

      // Verificamos que la cantidad a devolver no sea mayor a la solicitada
      const alreadyReturned = requestData.returnedQuantity || 0;
      if (quantityToReturn > (requestData.quantity - alreadyReturned)) {
          throw new Error("No se puede devolver más material del que se solicitó.");
      }

      // Añadimos la cantidad de vuelta al stock total del material
      transaction.update(materialRef, {
        quantityInStock: admin.firestore.FieldValue.increment(quantityToReturn),
      });

      // Creamos un nuevo lote de stock para el material devuelto
      // Esto es más simple y seguro que intentar revertir lotes antiguos
      const batchRef = materialRef.collection("stockBatches").doc();
      transaction.set(batchRef, {
        purchaseDate: new Date(), // Fecha de la devolución
        quantityReceived: quantityToReturn,
        quantityRemaining: quantityToReturn,
        unitCost: 0, // El material devuelto no tiene costo de compra
        notes: `Devolución de solicitud ${requestId}`,
      });
      
      // Actualizamos la solicitud original para reflejar la devolución
      transaction.update(requestRef, {
          returnedQuantity: admin.firestore.FieldValue.increment(quantityToReturn),
          status: 'Devolución Parcial'
      });
    });

    return { success: true, message: "Devolución registrada con éxito." };
  } catch (error) {
    console.error("Error en la transacción de devolución:", error);
    throw new functions.https.HttpsError(
      "internal",
      "No se pudo completar la devolución: " + error.message
    );
  }
});