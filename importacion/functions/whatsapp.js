const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const sharp = require("sharp"); // 🔥 NUEVA LIBRERÍA DE CONVERSIÓN
const db = admin.firestore();
const storage = admin.storage();

// --- CONFIGURACIÓN ---
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "mi_secreto_vidrio_express_2026";
const API_TOKEN = process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;

// Memoria caché para no convertir la misma imagen 500 veces en campañas masivas
const convertedImageCache = {}; 

// --- HELPERS ---

// 🔥 NUEVO: Convertidor sobre la marcha (WebP a JPG)
async function getMetaCompatibleUrl(mediaUrl) {
    if (!mediaUrl) return null;
    
    // Si la URL no contiene .webp, asumimos que es segura y la pasamos directo
    if (!mediaUrl.includes('.webp')) return mediaUrl;

    // Si ya la convertimos en esta sesión, devolvemos la URL convertida al instante
    if (convertedImageCache[mediaUrl]) return convertedImageCache[mediaUrl];

    console.log(`🔄 Convirtiendo imagen WebP a JPG para Meta: ${mediaUrl}`);
    
    try {
        // 1. Descargar la imagen original
        const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        // 2. Convertir a JPEG
        const jpegBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();

        // 3. Subir a una carpeta temporal en Storage
        const fileName = `meta_cache/${Date.now()}_converted.jpg`;
        const file = storage.bucket().file(fileName);
        
        await file.save(jpegBuffer, { metadata: { contentType: 'image/jpeg' } });
        await file.makePublic();

        const newUrl = file.publicUrl();
        convertedImageCache[mediaUrl] = newUrl; // Guardar en caché local
        
        console.log(`✅ Imagen convertida con éxito: ${newUrl}`);
        return newUrl;
    } catch (error) {
        console.error("❌ Error convirtiendo imagen para Meta:", error.message);
        return mediaUrl; // Si algo falla, pasamos la original (plan de contingencia)
    }
}

// 1. Enviar mensaje a Meta
async function sendToMeta(phoneNumber, message, type = 'text', mediaUrl = null, templateName = null, templateLang = 'en_US') {
    const url = `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`;
    let body = { 
        messaging_product: 'whatsapp', 
        to: phoneNumber, 
        type: type 
    };

    if (type === 'image') {
        body.image = { link: mediaUrl, caption: message || "" };
    } else if (type === 'document') {
        // 🔥 NUEVO: Soporte para PDFs y Archivos
        body.document = { link: mediaUrl, filename: message || "Documento" };
    } else if (type === 'template') {
        body.template = { 
            name: templateName, 
            language: { code: templateLang } 
        };
    } else if (type === 'audio') {
        body.audio = { link: mediaUrl };
    } else {
        body.text = { body: message };
    }

    try {
        const response = await axios.post(url, body, {
            headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' }
        });
        return response.data.messages[0].id;
    } catch (error) {
        console.error("Error Meta API:", error.response?.data || error.message);
        throw new Error(error.response?.data?.error?.message || "Fallo al enviar mensaje a WhatsApp");
    }
}

// 2. Descargar y subir multimedia entrante
async function downloadAndUploadMedia(mediaId, mimeType, phoneNumber) {
    try {
        const metaRes = await axios.get(`https://graph.facebook.com/v17.0/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        });
        const fileRes = await axios.get(metaRes.data.url, {
            responseType: 'arraybuffer',
            headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        });

        const ext = mimeType.split('/')[1].split(';')[0] || 'bin';
        const fileName = `chats/${phoneNumber}/${Date.now()}_${mediaId}.${ext}`;
        const file = storage.bucket().file(fileName);

        await file.save(fileRes.data, { metadata: { contentType: mimeType } });
        await file.makePublic();
        return file.publicUrl();
    } catch (error) {
        console.error("Error media:", error);
        return null;
    }
}

// --- WEBHOOK (RECIBIR + BOT) ---
const webhook = functions.https.onRequest(async (req, res) => {
    if (req.method === "GET") {
        if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
            console.log("✅ Webhook verificado por Meta correctamente.");
            res.status(200).send(req.query["hub.challenge"]);
        } else {
            res.sendStatus(403);
        }
        return;
    }

    if (req.method === "POST") {
        const body = req.body;

        if (body.object) {
            const change = body.entry?.[0]?.changes?.[0]?.value;

            // ESCENARIO 1: Mensaje entrante
            if (change?.messages) {
                const message = change.messages[0];
                const phoneNumber = message.from;
                const userName = change.contacts?.[0]?.profile?.name || "Usuario";
                const type = message.type;
                
                let content = "";
                let mediaUrl = null;
                let locationData = null;
                let contactosData = null;

                try {
                    if (type === "text") {
                        content = message.text.body;
                    } else if (type === "image") {
                        content = message.image.caption || "📷 Imagen recibida";
                        mediaUrl = await downloadAndUploadMedia(message.image.id, message.image.mime_type, phoneNumber);
                    } else if (type === "audio" || type === "voice") {
                        content = "🎤 Audio recibido";
                        const mediaData = message.audio || message.voice;
                        mediaUrl = await downloadAndUploadMedia(mediaData.id, mediaData.mime_type, phoneNumber);
                    } else if (type === "sticker") {
                        content = "🌟 Sticker";
                        mediaUrl = await downloadAndUploadMedia(message.sticker.id, message.sticker.mime_type, phoneNumber);
                    } else if (type === "document") {
                        // 🔥 NUEVO: Recibir PDFs de clientes
                        content = message.document.filename || "📄 Documento recibido";
                        mediaUrl = await downloadAndUploadMedia(message.document.id, message.document.mime_type, phoneNumber);
                    } else if (type === "location") {
                        const lat = message.location.latitude;
                        const lng = message.location.longitude;
                        content = `📍 Ubicación: ${message.location.name || ""} ${message.location.address || ""}`.trim();
                        mediaUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
                        locationData = {
                            lat: lat,
                            lng: lng,
                            name: message.location.name || "Ubicación Compartida",
                            address: message.location.address || "Ver en Google Maps"
                        };
                    } else if (type === "contacts") {
                        const contactPhone = message.contacts[0].phones?.[0]?.wa_id || message.contacts[0].phones?.[0]?.phone || "0";
                        content = `👤 Contacto: ${message.contacts[0].name?.formatted_name || "Contacto"}`;
                        mediaUrl = contactPhone.replace(/[^0-9]/g, ''); 
                        contactosData = message.contacts.map(c => ({
                            name: { formatted_name: c.name?.formatted_name || "Contacto" },
                            phones: (c.phones || []).map(p => ({ phone: p.phone || p.wa_id || "" }))
                        }));
                    } else {
                        content = `[Archivo no soportado: ${type}]`;
                    }

                    const chatRef = db.collection('chats').doc(phoneNumber);
                    const now = new Date();
                    const bogotaHour = parseInt(now.toLocaleString("en-US", {timeZone: "America/Bogota", hour: "numeric", hour12: false}));
                    
                    const isOutOfOffice = bogotaHour >= 20 || bogotaHour < 7; 
                    let autoReplySent = false;

                    if (isOutOfOffice) {
                        // Usar una transacción para evitar condiciones de carrera (duplicados de auto-respuesta)
                        autoReplySent = await db.runTransaction(async (transaction) => {
                            const docSnap = await transaction.get(chatRef);
                            const data = docSnap.exists ? docSnap.data() : {};
                            
                            let lastAutoReplyDate = null;
                            if (data.lastAutoReply && typeof data.lastAutoReply.toDate === 'function') {
                                lastAutoReplyDate = data.lastAutoReply.toDate();
                            } else if (data.ultimaRespuestaBot && typeof data.ultimaRespuestaBot.toDate === 'function') {
                                lastAutoReplyDate = data.ultimaRespuestaBot.toDate();
                            } else if (data.lastAutoReply) {
                                lastAutoReplyDate = new Date(data.lastAutoReply);
                            } else if (data.ultimaRespuestaBot) {
                                lastAutoReplyDate = new Date(data.ultimaRespuestaBot);
                            }

                            const hoursSinceLast = lastAutoReplyDate ? (new Date() - lastAutoReplyDate) / (1000 * 60 * 60) : 24;

                            if (hoursSinceLast > 12) {
                                transaction.set(chatRef, {
                                    lastAutoReply: admin.firestore.FieldValue.serverTimestamp(),
                                    ultimaRespuestaBot: admin.firestore.FieldValue.serverTimestamp()
                                }, { merge: true });
                                return true;
                            }
                            return false;
                        });
                    }

                    if (autoReplySent) {
                        try {
                            const replyText = "¡Hola! Gracias por comunicarte con *Vidrio Express*. 🏢\n\nHemos recibido tu mensaje, pero en este momento nuestro equipo está descansando. Te responderemos a primera hora de la mañana.";
                            const replyId = await sendToMeta(phoneNumber, replyText, 'text');
                            
                            // Guardar auto-respuesta en subcolección 'messages'
                            await chatRef.collection('messages').add({
                                type: 'outgoing', content: replyText, messageType: 'text',
                                whatsappId: replyId, isAutoReply: true, timestamp: admin.firestore.Timestamp.now()
                            });
                            // Guardar auto-respuesta en subcolección 'mensajes'
                            await chatRef.collection('mensajes').doc(replyId).set({
                                id: replyId,
                                tipo: 'text',
                                direccion: 'saliente',
                                fecha: admin.firestore.FieldValue.serverTimestamp(),
                                estadoEnvio: 'sent',
                                enviadoPor: 'bot_automatico',
                                texto: replyText,
                                mediaUrl: null
                            });
                        } catch (metaErr) {
                            console.error("Error enviando auto-respuesta:", metaErr);
                        }
                    }

                    // Actualizar el documento del chat con soporte para ambos esquemas de nombres
                    const updateData = {
                        // Esquema 2 (MiSmartech)
                        clientName: userName,
                        phoneNumber,
                        lastMessage: content,
                        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastCustomerInteraction: admin.firestore.FieldValue.serverTimestamp(),
                        unread: true,
                        platform: 'whatsapp',
                        status: 'open',

                        // Esquema 1 (VidriosExito)
                        telefono: phoneNumber,
                        nombre: userName,
                        ultimoMensaje: content,
                        ultimaFecha: admin.firestore.FieldValue.serverTimestamp(),
                        mensajesNoLeidos: admin.firestore.FieldValue.increment(1),
                        estadoChat: 'activo',

                        _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                    };

                    if (autoReplySent) {
                        updateData.lastAutoReply = admin.firestore.FieldValue.serverTimestamp();
                        updateData.ultimaRespuestaBot = admin.firestore.FieldValue.serverTimestamp();
                    }

                    await chatRef.set(updateData, { merge: true });

                    // Guardar mensaje entrante en subcolección 'messages'
                    const msgDocEnglish = {
                        id: message.id,
                        type: 'incoming',
                        content: content,
                        mediaUrl: mediaUrl,
                        messageType: type,
                        whatsappId: message.id,
                        timestamp: admin.firestore.Timestamp.now()
                    };
                    if (locationData) msgDocEnglish.location = locationData;
                    if (contactosData) msgDocEnglish.contactos = contactosData;
                    await chatRef.collection('messages').doc(message.id).set(msgDocEnglish);

                    // Guardar mensaje entrante en subcolección 'mensajes'
                    const msgDocSpanish = {
                        id: message.id,
                        tipo: type,
                        direccion: 'entrante',
                        fecha: admin.firestore.FieldValue.serverTimestamp(),
                        texto: content,
                        mediaUrl: mediaUrl,
                        fileName: type === 'document' ? (message.document.filename || 'Documento') : null
                    };
                    if (locationData) msgDocSpanish.location = locationData;
                    if (contactosData) msgDocSpanish.contactos = contactosData;
                    await chatRef.collection('mensajes').doc(message.id).set(msgDocSpanish);
                    
                } catch (e) { 
                    console.error("❌ [ERROR INTERNO PROCESANDO MENSAJE]:", e); 
                }
            } 
            // ESCENARIO 2: Reporte de Estado (Fallos de Meta)
            else if (change?.statuses) {
                const status = change.statuses[0];
                
                if (status.errors) {
                    console.error("🚫 [META BLOQUEO/ERROR]:", JSON.stringify(status.errors, null, 2));
                    try {
                        const recipientId = status.recipient_id;
                        
                        // Actualizar en subcolección 'messages'
                        const msgsSnapshot = await db.collection('chats').doc(recipientId).collection('messages').where('whatsappId', '==', status.id).get();
                        if (!msgsSnapshot.empty) {
                            msgsSnapshot.forEach(docRef => {
                                docRef.ref.update({
                                    error: true,
                                    errorDetails: status.errors[0].message || status.errors[0].title || "Bloqueado por Meta"
                                });
                            });
                        }

                        // Actualizar en subcolección 'mensajes'
                        const msgRef = db.collection('chats').doc(recipientId).collection('mensajes').doc(status.id);
                        const docCheck = await msgRef.get();
                        if (docCheck.exists) {
                            await msgRef.update({
                                error: true,
                                errorDetails: status.errors[0].message || status.errors[0].title || "Bloqueado por Meta"
                            });
                        }
                    } catch(e) { console.error("Error al actualizar BD con el fallo:", e); }
                } else {
                    // Actualizar estado ordinario (sent, delivered, read) en Firestore
                    try {
                        const recipientId = status.recipient_id;
                        
                        // Subcolección 'messages'
                        const msgsSnapshot = await db.collection('chats').doc(recipientId).collection('messages').where('whatsappId', '==', status.id).get();
                        if (!msgsSnapshot.empty) {
                            msgsSnapshot.forEach(docRef => {
                                docRef.ref.update({
                                    status: status.status
                                });
                            });
                        }

                        // Subcolección 'mensajes'
                        await db.collection('chats').doc(recipientId).collection('mensajes').doc(status.id).set({
                            estadoEnvio: status.status,
                            _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    } catch(e) { console.error("Error al actualizar estado del mensaje:", e); }
                }
            }
        }
        res.sendStatus(200);
    }
});

// --- FUNCIÓN DE ENVÍO MANUAL (PANEL ADMIN) ---
const sendMessage = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    
    // Soportar tanto variables de MiSmartech (phoneNumber) como VidriosExito (telefonoDestino)
    const phoneNumber = data.phoneNumber || data.telefonoDestino;
    const message = data.message || data.contenido;
    const type = data.type || data.tipo;
    const mediaUrl = data.mediaUrl;
    const fileName = data.fileName;

    if (!phoneNumber || !type) throw new functions.https.HttpsError('invalid-argument', 'Faltan datos requeridos (número o tipo).');
    
    let agentName = context.auth.token.name;
    if (!agentName) {
        try {
            const userDoc = await db.collection('users').doc(context.auth.uid).get();
            if (userDoc.exists && userDoc.data().name) agentName = userDoc.data().name;
            else agentName = context.auth.token.email.split('@')[0];
        } catch (e) { agentName = context.auth.token.email.split('@')[0]; }
    }
    
    let finalType = type;
    let finalMedia = mediaUrl;
    
    // Filtro 1: Si es un placeholder, mandarlo como texto normal
    if (type === 'image' && (!mediaUrl || mediaUrl.includes('via.placeholder.com'))) {
        finalType = 'text';
        finalMedia = null;
    } 
    // Filtro 2: 🔥 PROCESAR WEBP A JPG SI ES NECESARIO
    else if (type === 'image' && mediaUrl) {
        finalMedia = await getMetaCompatibleUrl(mediaUrl);
    }
    
    try {
        const waId = await sendToMeta(phoneNumber, message, finalType, finalMedia);

        const chatRef = db.collection('chats').doc(phoneNumber);
        
        // 🔥 Dinámico según el tipo
        let previewTxt = `tú: ${message}`;
        if (finalType === 'image') previewTxt = '📷 Imagen enviada';
        if (finalType === 'document') previewTxt = '📄 Documento enviado';

        // Actualizar el documento del chat en ambos esquemas
        await chatRef.set({
            // Esquema 2 (MiSmartech)
            lastMessage: previewTxt,
            lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
            unread: false,

            // Esquema 1 (VidriosExito)
            ultimoMensaje: previewTxt,
            ultimaFecha: admin.firestore.FieldValue.serverTimestamp(),
            mensajesNoLeidos: 0,
            estadoChat: 'activo',

            _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Guardar mensaje saliente en subcolección 'messages' (English)
        await chatRef.collection('messages').doc(waId).set({
            type: 'outgoing',
            content: message || (finalType === 'image' ? 'Imagen enviada' : ''),
            mediaUrl: finalMedia || null,
            messageType: finalType || 'text',
            whatsappId: waId,
            timestamp: admin.firestore.Timestamp.now(),
            sentBy: agentName
        });

        // Guardar mensaje saliente en subcolección 'mensajes' (Spanish)
        await chatRef.collection('mensajes').doc(waId).set({
            id: waId,
            tipo: finalType,
            direccion: 'saliente',
            fecha: admin.firestore.FieldValue.serverTimestamp(),
            estadoEnvio: 'sent',
            enviadoPor: context.auth.uid, // Guardamos ID de usuario original
            texto: message || (finalType === 'image' ? 'Imagen enviada' : ''),
            mediaUrl: finalMedia || null,
            fileName: finalType === 'document' ? (fileName || 'Documento') : null
        });

        return { success: true, messageId: waId };
    } catch (error) {
        throw new functions.https.HttpsError('internal', error.message);
    }
});

// --- FUNCIÓN PARA MARCAR MENSAJES COMO LEÍDOS (CHULOS AZULES) ---
const marcarChatComoLeido = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');

    const { telefono, messageId } = data;
    if (!telefono) throw new functions.https.HttpsError('invalid-argument', 'Falta el teléfono.');

    try {
        // 1. Avisarle a Meta que leímos el mensaje (esto pone los chulos azules al cliente)
        if (messageId) {
            const url = `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`;
            await axios.post(url, {
                messaging_product: "whatsapp",
                status: "read",
                message_id: messageId
            }, {
                headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' }
            });
        }

        // 2. Poner el contador de "no leídos" en 0 en nuestro Firestore
        await db.collection('chats').doc(telefono).update({
            // Spanish
            mensajesNoLeidos: 0,
            // English
            unread: false,
            _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true };
    } catch (error) {
        console.error(`Error marcando como leido el chat ${telefono}:`, error.message);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

// --- PRUEBA DE PLANTILLA ---
const sendTestTemplate = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    try {
        const waId = await sendToMeta(data.phoneNumber, null, 'template', null, 'hello_world', 'en_US');
        return { success: true, waId: waId };
    } catch (error) { throw new functions.https.HttpsError('internal', error.message); }
});

// --- FUNCIÓN DE MARKETING MASIVO (CAMPAÑAS) ---
const sendMassTemplate = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    
    const { phoneNumber, templateName, imageUrl, clientName, customMessage, linkPath } = data;
    
    try {
        // 🔥 PROCESAR LA IMAGEN DE LA CAMPAÑA (Solo se procesa 1 vez gracias a la caché)
        const finalImageUrl = await getMetaCompatibleUrl(imageUrl);

        const url = `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`;
        
        const body = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'template',
            template: {
                name: templateName,
                language: { code: 'es' }, 
                components: [
                    {
                        type: 'header',
                        parameters: [
                            { type: 'image', image: { link: finalImageUrl } }
                        ]
                    },
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: clientName || "Cliente" }, 
                            { type: 'text', text: customMessage || "Promoción especial" } 
                        ]
                    },
                    {
                        type: 'button',
                        sub_type: 'url',
                        index: "0", 
                        parameters: [
                            { type: 'text', text: linkPath }
                        ]
                    }
                ]
            }
        };

        const response = await axios.post(url, body, {
            headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' }
        });

        const chatRef = db.collection('chats').doc(phoneNumber);
        
        const previewTxt = '📢 [Campaña Enviada]';

        await chatRef.set({
            // Spanish
            ultimoMensaje: previewTxt,
            ultimaFecha: admin.firestore.FieldValue.serverTimestamp(),
            mensajesNoLeidos: 0,
            estadoChat: 'activo',

            // English
            lastMessage: previewTxt,
            lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
            unread: false,

            _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // messages
        await chatRef.collection('messages').add({
            type: 'outgoing',
            content: `📢 *Campaña Masiva:*\n${customMessage}\n🔗 URL: /${linkPath}`,
            mediaUrl: finalImageUrl,
            messageType: 'template',
            whatsappId: response.data.messages[0].id,
            timestamp: admin.firestore.Timestamp.now()
        });

        // mensajes
        await chatRef.collection('mensajes').add({
            id: response.data.messages[0].id,
            tipo: 'template',
            direccion: 'saliente',
            fecha: admin.firestore.FieldValue.serverTimestamp(),
            estadoEnvio: 'sent',
            enviadoPor: 'campana_masiva',
            texto: `📢 *Campaña Masiva:*\n${customMessage}\n🔗 URL: /${linkPath}`,
            mediaUrl: finalImageUrl
        });

        return { success: true, waId: response.data.messages[0].id };
    } catch (error) {
        console.error("❌ Error Meta API (Campaña Masiva):", JSON.stringify(error.response?.data || error.message));
        throw new functions.https.HttpsError('internal', error.response?.data?.error?.message || "Fallo al enviar campaña a Meta");
    }
});

// Exports for Cloud Functions exports v2
exports.webhook = webhook;
exports.whatsappWebhook = webhook;

exports.sendMessage = sendMessage;
exports.enviarMensajeWhatsApp = sendMessage;

exports.marcarChatComoLeido = marcarChatComoLeido;

exports.sendTestTemplate = sendTestTemplate;
exports.sendMassTemplate = sendMassTemplate;