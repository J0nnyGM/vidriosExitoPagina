// functions/whatsapp.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors")({ origin: true });

const VERIFY_TOKEN = "mi_secreto_vidrio_express_2026";
const BUCKET_NAME = "vidrioexpres1.firebasestorage.app"; // Tu bucket de Storage

// --- HELPERS ---
function formatColombianPhone(phone) {
    if (!phone || typeof phone !== "string") return null;
    let cleanPhone = phone.replace(/[\s-()]/g, "");
    if (cleanPhone.startsWith("57")) return cleanPhone;
    if (cleanPhone.length === 10) return `57${cleanPhone}`;
    return null;
}

// Función mágica para descargar fotos/audios de WhatsApp y guardarlos en Firebase Storage
async function downloadAndSaveMedia(mediaId, mimeType) {
    const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
    try {
        // 1. Pedirle a Meta la URL temporal de descarga del archivo
        const resUrl = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
            headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}` }
        });
        const urlDescarga = resUrl.data.url;

        // 2. Descargar el archivo binario
        const resBuffer = await axios.get(urlDescarga, {
            responseType: 'arraybuffer',
            headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}` }
        });

        // 3. Guardarlo en tu Firebase Storage
        const extension = mimeType.split('/')[1].split(';')[0] || 'bin';
        const bucket = admin.storage().bucket(BUCKET_NAME);
        const filePath = `whatsapp_media/${mediaId}.${extension}`;
        const file = bucket.file(filePath);
        
        await file.save(resBuffer.data, { contentType: mimeType });
        
        // 4. Generar URL firmada válida por mucho tiempo (o hacerla pública)
        const [url] = await file.getSignedUrl({ action: 'read', expires: '01-01-2100' });
        return url;
    } catch (error) {
        functions.logger.error("Error descargando media de WhatsApp:", error);
        return null;
    }
}

// --- 1. WEBHOOK: RECIBE MENSAJES Y LOS GUARDA EN FIRESTORE ---
exports.whatsappWebhook = functions.https.onRequest((req, res) => {
    cors(req, res, async () => {
        if (req.method === 'GET') {
            if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
                return res.status(200).send(req.query['hub.challenge']);
            }
            return res.status(403).send("Token inválido");
        }

        if (req.method === 'POST') {
            const body = req.body;

            if (body.object === 'whatsapp_business_account') {
                try {
                    const changes = body.entry?.[0]?.changes?.[0]?.value;
                    
                    // A) Si es un mensaje entrante de un cliente
                    if (changes && changes.messages && changes.messages.length > 0) {
                        const msg = changes.messages[0];
                        const contact = changes.contacts ? changes.contacts[0] : null;
                        
                        const phone = msg.from;
                        const contactName = contact ? contact.profile.name : "Desconocido";
                        const msgType = msg.type;
                        const msgId = msg.id;
                        
                        // Estructura base del mensaje
                        let firestoreMsg = {
                            id: msgId,
                            tipo: msgType,
                            direccion: 'entrante',
                            fecha: admin.firestore.Timestamp.fromDate(new Date(parseInt(msg.timestamp) * 1000)),
                            leido: false,
                            texto: ''
                        };

                        // Parsear el contenido dependiendo del tipo
                        if (msgType === 'text') {
                            firestoreMsg.texto = msg.text.body;
                        } 
                        // 👇 ¡AQUÍ ESTÁ EL CAMBIO! Añadimos msgType === 'sticker' 👇
                        else if (msgType === 'image' || msgType === 'video' || msgType === 'audio' || msgType === 'document' || msgType === 'sticker') {
                            const mediaData = msg[msgType];
                            firestoreMsg.texto = mediaData.caption || `[${msgType.toUpperCase()}]`;
                            firestoreMsg.mediaId = mediaData.id;
                            firestoreMsg.mimeType = mediaData.mime_type;
                            if (msgType === 'document') firestoreMsg.fileName = mediaData.filename;
                            
                            // Descargar a Firebase Storage
                            const firebaseMediaUrl = await downloadAndSaveMedia(mediaData.id, mediaData.mime_type);
                            firestoreMsg.mediaUrl = firebaseMediaUrl;
                        } 
                        else if (msgType === 'location') {
                            firestoreMsg.texto = `Ubicación: ${msg.location.name || ''} ${msg.location.address || ''}`;
                            firestoreMsg.location = { lat: msg.location.latitude, lng: msg.location.longitude };
                        } 
                        else if (msgType === 'contacts') {
                            firestoreMsg.texto = `[Contacto(s) recibido(s)]`;
                            firestoreMsg.contactos = msg.contacts;
                        } 
                        else if (msgType === 'interactive') {
                            // Cuando responden a botones
                            firestoreMsg.texto = msg.interactive.button_reply ? msg.interactive.button_reply.title : msg.interactive.list_reply.title;
                        }

// Guardar en Firestore: Colección "chats" -> Doc(Teléfono) -> Colección "mensajes"
                        const db = admin.firestore();
                        const chatRef = db.collection('chats').doc(phone);
                        
                        // --- LÓGICA DE AUTO-RESPUESTA INTELIGENTE ---
                        const chatDoc = await chatRef.get();
                        let needsAutoReply = false;
                        const data = chatDoc.exists ? chatDoc.data() : null;
                        
                        // Evitamos enviar múltiples mensajes si el cliente manda 5 fotos de golpe (Cooldown de 10 min)
                        const lastAutoMs = data && data.ultimaRespuestaBot ? data.ultimaRespuestaBot.toDate().getTime() : 0;
                        const hasCooldownPassed = (Date.now() - lastAutoMs) > (10 * 60 * 1000);

                        if (hasCooldownPassed) {
                            // Enviamos auto-respuesta si:
                            // 1. Es un cliente totalmente nuevo (!data)
                            // 2. El chat había sido marcado como 'resuelto'
                            // 3. Pasaron más de 24 horas desde la última interacción
                            const lastClientMsgMs = data && data.ultimaFecha ? data.ultimaFecha.toDate().getTime() : 0;
                            if (!data || data.estadoChat === 'resuelto' || (Date.now() - lastClientMsgMs > 24 * 60 * 60 * 1000)) {
                                needsAutoReply = true;
                            }
                        }

                        // 1. Guardar el mensaje real del cliente
                        await chatRef.collection('mensajes').doc(msgId).set(firestoreMsg);
                        
                        // 2. Actualizar el Inbox principal para que salte a la pestaña "Activos"
                        const updatePayload = {
                            telefono: phone,
                            nombre: contactName,
                            ultimoMensaje: firestoreMsg.texto,
                            ultimaFecha: firestoreMsg.fecha,
                            mensajesNoLeidos: admin.firestore.FieldValue.increment(1),
                            estadoChat: 'activo',
                            _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                        };

                        if (needsAutoReply) {
                            updatePayload.ultimaRespuestaBot = admin.firestore.FieldValue.serverTimestamp();
                        }

                        await chatRef.set(updatePayload, { merge: true });

                        // 3. Ejecutar el envío de la auto-respuesta
                        if (needsAutoReply) {
                            // Puedes modificar este texto a tu gusto:
                            const autoReplyText = "¡Hola! Gracias por comunicarte con *Vidrio Express*. 🏢\n\nHemos recibido tu mensaje y en breve uno de nuestros asesores te atenderá.\n\n_Horario de atención: Lunes a Viernes 8:00 AM - 5:30 PM y Sábados 8:00 AM - 12:15 PM_";
                            
                            try {
                                const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
                                const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
                                const url = `https://graph.facebook.com/v19.0/${PHONE_ID}/messages`;
                                
                                const resMeta = await axios.post(url, {
                                    messaging_product: "whatsapp",
                                    recipient_type: "individual",
                                    to: phone,
                                    type: "text",
                                    text: { preview_url: false, body: autoReplyText }
                                }, {
                                    headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" }
                                });

                                // Guardar la auto-respuesta en Firestore para que el asesor la vea en pantalla
                                const replyMsgId = resMeta.data.messages[0].id;
                                await chatRef.collection('mensajes').doc(replyMsgId).set({
                                    id: replyMsgId,
                                    tipo: 'text',
                                    direccion: 'saliente',
                                    fecha: admin.firestore.FieldValue.serverTimestamp(),
                                    estadoEnvio: 'sent',
                                    enviadoPor: 'bot_automatico',
                                    texto: autoReplyText,
                                    mediaUrl: null
                                });
                            } catch (e) {
                                functions.logger.error("Error en bot automático:", e);
                            }
                        }
                        // -----------------------------------------------------------
                    }

                    // B) Si es una actualización de estado (Enviado, Entregado, Leído)
                    if (changes && changes.statuses && changes.statuses.length > 0) {
                        const statusObj = changes.statuses[0];
                        const phone = statusObj.recipient_id;
                        
                        // CORRECCIÓN DE LA CONDICIÓN DE CARRERA: Usamos SET con merge
                        await admin.firestore().collection('chats').doc(phone).collection('mensajes').doc(statusObj.id).set({
                            estadoEnvio: statusObj.status,
                            _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    }

                } catch (error) {
                    functions.logger.error("Error procesando Webhook:", error);
                }
                return res.status(200).send('EVENT_RECEIVED');
            }
            return res.status(404).send('No es un evento de WhatsApp');
        }
        return res.status(405).send("Method Not Allowed");
    });
});

// --- 2. FUNCIÓN PARA ENVIAR MENSAJES DESDE EL SISTEMA ---
exports.enviarMensajeWhatsApp = functions.https.onCall(async (data, context) => {
    // Seguridad: Asegurar que el usuario está logueado
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Usuario no autenticado.");

    const { telefonoDestino, tipo, contenido, mediaUrl, fileName } = data;
    if (!telefonoDestino || !tipo) throw new functions.https.HttpsError("invalid-argument", "Faltan datos requeridos.");

    const phone = formatColombianPhone(telefonoDestino);
    const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
    const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
    
    let payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: tipo
    };

    // Construir el payload según el tipo de mensaje que envías
    if (tipo === 'text') {
        payload.text = { preview_url: true, body: contenido };
    } else if (tipo === 'image') {
        payload.image = { link: mediaUrl, caption: contenido || '' };
    } else if (tipo === 'document') {
        payload.document = { link: mediaUrl, caption: contenido || '', filename: fileName || 'Documento' };
    } else if (tipo === 'video') {
        payload.video = { link: mediaUrl, caption: contenido || '' };
    } else if (tipo === 'audio') {
        payload.audio = { link: mediaUrl };
    }

    try {
        const url = `https://graph.facebook.com/v19.0/${PHONE_ID}/messages`;
        const resMeta = await axios.post(url, payload, {
            headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" }
        });

        // Si fue exitoso, Meta nos devuelve el ID del mensaje
        const msgId = resMeta.data.messages[0].id;
        const db = admin.firestore();
        const msgRef = db.collection('chats').doc(phone).collection('mensajes').doc(msgId);

        // CORRECCIÓN DE LA CONDICIÓN DE CARRERA: Respetar si el Webhook llegó primero
        const msgDoc = await msgRef.get();
        let finalStatus = 'sent';
        if (msgDoc.exists && msgDoc.data().estadoEnvio) {
            finalStatus = msgDoc.data().estadoEnvio; // Mantener 'delivered' o 'read'
        }

        const firestoreMsg = {
            id: msgId,
            tipo: tipo,
            direccion: 'saliente',
            fecha: admin.firestore.FieldValue.serverTimestamp(),
            estadoEnvio: finalStatus,
            enviadoPor: context.auth.uid,
            texto: contenido || `[${tipo.toUpperCase()}]`,
            mediaUrl: mediaUrl || null
        };

        await msgRef.set(firestoreMsg, { merge: true });
        
        await db.collection('chats').doc(phone).set({
            telefono: phone,
            ultimoMensaje: `Tú: ${firestoreMsg.texto}`,
            ultimaFecha: admin.firestore.FieldValue.serverTimestamp(),
            _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return { success: true, messageId: msgId };
    } catch (error) {
        functions.logger.error("Error enviando mensaje de WA:", error.response ? error.response.data : error.message);
        throw new functions.https.HttpsError("internal", "No se pudo enviar el mensaje a Meta.");
    }
});

// --- 3. FUNCIÓN PARA MARCAR MENSAJES COMO LEÍDOS (CHULOS AZULES) ---
exports.marcarChatComoLeido = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Usuario no autenticado.");

    const { telefono, messageId } = data;
    if (!telefono) throw new functions.https.HttpsError("invalid-argument", "Falta el teléfono.");

    const db = admin.firestore();

    try {
        // 1. Avisarle a Meta que leímos el mensaje (esto pone los chulos azules al cliente)
        if (messageId) {
            const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
            const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
            const url = `https://graph.facebook.com/v19.0/${PHONE_ID}/messages`;
            
            await axios.post(url, {
                messaging_product: "whatsapp",
                status: "read",
                message_id: messageId
            }, {
                headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" }
            });
        }

        // 2. Poner el contador de "no leídos" en 0 en nuestro Firestore
        await db.collection('chats').doc(telefono).update({
            mensajesNoLeidos: 0,
            _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true };
    } catch (error) {
        functions.logger.error(`Error marcando como leído el chat ${telefono}:`, error.response ? error.response.data : error.message);
        throw new functions.https.HttpsError("internal", "No se pudo marcar como leído.");
    }
});