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
