const functions = require("firebase-functions");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { initializeApp, getApps } = require("firebase-admin/app");

// Importaciones para la sintaxis v2
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler"); // Importar onSchedule

if (getApps().length === 0) {
    initializeApp();
}

const db = getFirestore();

// --- INICIO DE NUEVA FUNCIÓN AUXILIAR ---
/**
 * Obtiene el nombre de un usuario desde la colección 'users'.
 * @param {string} userId - El ID del usuario.
 * @returns {Promise<string>} - El nombre del usuario o "Usuario Desconocido".
 */
async function getUserName(userId) {
    if (!userId) return "Nadie";
    try {
        const userDoc = await db.doc(`users/${userId}`).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            return `${userData.firstName || 'Usuario'} ${userData.lastName || ''}`.trim();
        }
        return "Usuario Desconocido";
    } catch (error) {
        console.error(`Error al obtener nombre de usuario ${userId}:`, error);
        return "Usuario";
    }
}
// --- FIN DE NUEVA FUNCIÓN AUXILIAR ---

// --- Lógica de cálculo (sin cambios) ---
function calculateItemTotal(item) {
    let total = 0;
    const calculatePartTotal = (details, quantity) => {
        if (!details || !details.unitPrice) return 0;
        const subtotal = details.unitPrice * quantity;
        if (details.taxType === 'aiu') {
            const admin = subtotal * (details.aiuA / 100 || 0);
            const imprev = subtotal * (details.aiuI / 100 || 0);
            const utilidad = subtotal * (details.aiuU / 100 || 0);
            const ivaSobreUtilidad = utilidad * 0.19;
            return subtotal + admin + imprev + utilidad + ivaSobreUtilidad;
        } else if (details.taxType === 'iva') {
            return subtotal * 1.19;
        }
        return subtotal;
    };
    if (item.itemType === 'suministro_instalacion_incluido') {
        total = calculatePartTotal(item.includedDetails, item.quantity);
    } else {
        total += calculatePartTotal(item.supplyDetails, item.quantity);
        total += calculatePartTotal(item.installationDetails, item.quantity);
    }
    return Math.round(total); // Redondeo
}

const recalculateProjectProgress = async (projectId) => {
    if (!projectId) {
        console.log("No projectId provided for recalculation.");
        return;
    }
    const projectRef = db.doc(`projects/${projectId}`);

    // --- INICIO DE CAMBIO: Consultar subcolecciones ---
    const itemsQuery = projectRef.collection('items');
    // Usamos collectionGroup para buscar 'subItems' en todas las subcolecciones DE ESTE PROYECTO
    const subItemsQuery = db.collectionGroup('subItems').where('projectId', '==', projectId);
    // --- FIN DE CAMBIO ---

    const [itemsSnapshot, subItemsSnapshot] = await Promise.all([itemsQuery.get(), subItemsQuery.get()]);
    let totalM2 = 0, totalItems = 0, executedM2 = 0, executedItems = 0, executedValue = 0;
    const itemsMap = new Map();

    itemsSnapshot.forEach(doc => {
        const item = { id: doc.id, ...doc.data() };

        // --- INICIO DE CORRECCIÓN 1 (Bug de Texto/Número) ---
        // Forzamos la cantidad a ser un número (entero) usando parseInt
        const itemQuantity = parseInt(item.quantity, 10) || 0;

        totalM2 += ((item.width || 0) * (item.height || 0)) * itemQuantity;
        totalItems += itemQuantity;
        // --- FIN DE CORRECCIÓN 1 ---

        itemsMap.set(item.id, item);
    });

    subItemsSnapshot.forEach(doc => {
        const subItem = doc.data();
        if (subItem.status === 'Instalado') {
            const parentItem = itemsMap.get(subItem.itemId);
            if (parentItem) {
                // Aseguramos que la cantidad del padre sea un número para la división
                const parentQuantity = parseInt(parentItem.quantity, 10) || 1; // Evitar división por cero

                executedItems += 1;

                // --- INICIO DE CORRECCIÓN 2 (Bug de M² Ejecutados) ---
                // Calculamos el M² de esta unidad (1 subItem)
                const subItemM2 = (parentItem.width || 0) * (parentItem.height || 0);
                executedM2 += subItemM2; // Sumamos solo el área de la unidad, no el total
                // --- FIN DE CORRECCIÓN 2 ---

                const itemTotalValue = calculateItemTotal(parentItem);
                const subItemValue = itemTotalValue / parentQuantity;
                executedValue += subItemValue;
            }
        }
    });

    const progressSummary = { totalM2, totalItems, executedM2, executedItems, executedValue, updatedAt: FieldValue.serverTimestamp() };
    return projectRef.update({ progressSummary });
};

// --- Trigger de Firestore (v2 - ya corregido) ---
exports.onSubItemChange = onDocumentWritten("projects/{projectId}/items/{itemId}/subItems/{subItemId}", async (event) => {
    // --- FIN DE CAMBIO ---
    const projectId = event.params.projectId; // Obtenemos el projectId desde los parámetros

    if (projectId) {
        try {
            await recalculateProjectProgress(projectId);
        } catch (error) {
            console.error(`Failed to update progress for project ${projectId}`, error);
        }
    }
});

// --- Función Callable (v2 - CORREGIDA) ---
exports.runFullRecalculation = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'La función debe ser llamada por un usuario autenticado.');
    }

    console.log("Starting full progress recalculation for all projects...");
    const projectsSnapshot = await db.collection('projects').get();
    const promises = [];
    projectsSnapshot.forEach(doc => {
        promises.push(recalculateProjectProgress(doc.id));
    });

    await Promise.all(promises);
    console.log("Full progress recalculation completed successfully.");
    return { message: `Recálculo completado para ${promises.length} proyectos.` };
});

/**
 * Cloud Function programada que audita y sincroniza el stock de todos los materiales.
 * Se recomienda programarla para que se ejecute una vez al día (ej. cada madrugada).
 */

exports.scheduledInventorySync = onSchedule("every 24 hours", async (event) => {
    console.log("Executing scheduled inventory audit...");

    try {
        const catalogSnapshot = await db.collection("materialCatalog").get();
        if (catalogSnapshot.empty) {
            console.log("No materials in catalog to sync.");
            return null;
        }

        let materialsUpdated = 0;
        let remnantsConsolidated = 0;

        for (const materialDoc of catalogSnapshot.docs) {
            const materialRef = materialDoc.ref;
            const materialData = materialDoc.data();
            const batch = db.batch();

            // TAREA 1: Sincronizar el stock de unidades completas
            const batchesSnapshot = await materialRef.collection("stockBatches").get();
            const realStock = batchesSnapshot.docs.reduce((sum, doc) => sum + (doc.data().quantityRemaining || 0), 0);

            if (realStock !== (materialData.quantityInStock || 0)) {
                console.log(`- Updating full unit stock for "${materialData.name}": from ${materialData.quantityInStock || 0} to ${realStock}`);
                batch.update(materialRef, { quantityInStock: realStock });
                materialsUpdated++;
            }

            // TAREA 2: Consolidar y limpiar los retazos
            if (materialData.isDivisible) {
                const remnantsSnapshot = await materialRef.collection("remnantStock").get();
                if (!remnantsSnapshot.empty) {
                    const remnantsByLength = new Map();

                    remnantsSnapshot.forEach(doc => {
                        const remnantData = doc.data();
                        const length = remnantData.length;
                        if (length) {
                            const existing = remnantsByLength.get(length) || { totalQuantity: 0, docsToDelete: [] };
                            // Suma la cantidad, tratando los que no tienen como 0
                            existing.totalQuantity += remnantData.quantity || 0;
                            existing.docsToDelete.push(doc.ref);
                            remnantsByLength.set(length, existing);
                        } else {
                            // Borra retazos sin medida para limpiar datos
                            batch.delete(doc.ref);
                        }
                    });

                    for (const [length, group] of remnantsByLength.entries()) {
                        // Consolida si hay más de un documento para la misma medida,
                        // o si la cantidad total es cero (para limpiar),
                        // o si el único documento no tiene el campo 'quantity' (para repararlo)
                        const needsConsolidation = group.docsToDelete.length > 1 ||
                            group.totalQuantity <= 0 ||
                            (group.docsToDelete.length === 1 && !remnantsSnapshot.docs.find(d => d.ref.path === group.docsToDelete[0].path).data().hasOwnProperty('quantity'));

                        if (needsConsolidation) {
                            remnantsConsolidated++;
                            console.log(`- Consolidating/Cleaning remnants for "${materialData.name}" of length ${length}m.`);

                            group.docsToDelete.forEach(docRef => batch.delete(docRef));

                            if (group.totalQuantity > 0) {
                                const newRemnantRef = materialRef.collection("remnantStock").doc();
                                batch.set(newRemnantRef, {
                                    length: length,
                                    quantity: group.totalQuantity,
                                    unit: 'm',
                                    createdAt: FieldValue.serverTimestamp()
                                });
                            }
                        }
                    }
                }
            }

            await batch.commit();
        }

        console.log(`Sync completed! Full units updated: ${materialsUpdated}. Remnant groups consolidated/cleaned: ${remnantsConsolidated}.`);
        return null;

    } catch (error) {
        console.error("Error during scheduled inventory sync:", error);
        return null;
    }
});


/**
 * Cloud Function programada para recalcular el progreso de TODOS los proyectos
 * diariamente a la medianoche (00:00).
 */
exports.scheduledProjectRecalculation = onSchedule({
    schedule: "0 0 * * *", // 00:00 (Medianoche) todos los días
    timeZone: "America/Bogota", // Aseguramos la zona horaria de Colombia
}, async (event) => {

    console.log("Iniciando recálculo diario programado del progreso de todos los proyectos...");

    try {
        const projectsSnapshot = await db.collection('projects').get();
        const promises = [];

        projectsSnapshot.forEach(doc => {
            // Usamos la misma lógica de recálculo que ya existe
            promises.push(recalculateProjectProgress(doc.id));
        });

        await Promise.all(promises);

        console.log(`Recálculo programado completado para ${promises.length} proyectos.`);
        return { success: true, count: promises.length };

    } catch (error) {
        console.error("Error durante el recálculo programado de proyectos:", error);
        return null;
    }
});

/**
 * Cloud Function (callable) para crear un nuevo ítem y todos sus sub-ítems de forma atómica.
 */
exports.createProjectItem = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'La función debe ser llamada por un usuario autenticado.');
    }
    const data = request.data;
    const uid = request.auth.uid;
    if (!data.projectId || !data.name || !data.quantity || data.quantity <= 0) {
        throw new HttpsError('invalid-argument', 'Faltan datos esenciales (projectId, name, quantity).');
    }

    try {
        // --- INICIO DE CAMBIO: Usar path de subcolección ---
        const projectRef = db.doc(`projects/${data.projectId}`);
        const itemRef = projectRef.collection('items').doc();
        // --- FIN DE CAMBIO ---

        const batch = db.batch();
        batch.set(itemRef, {
            ...data,
            ownerId: uid,
            createdAt: FieldValue.serverTimestamp(),
        });

        for (let i = 1; i <= data.quantity; i++) {
            // --- INICIO DE CAMBIO: Usar path de subcolección anidada ---
            const subItemRef = itemRef.collection('subItems').doc();
            // --- FIN DE CAMBIO ---
            batch.set(subItemRef, {
                itemId: itemRef.id,
                projectId: data.projectId,
                number: i,
                status: 'Pendiente de Fabricación',
                location: '',
                manufacturer: '',
                installer: '',
                installDate: '',
                photoURL: ''
            });
        }
        await batch.commit();

        console.log(`Successfully created item ${itemRef.id} with ${data.quantity} sub-items.`);
        return { success: true, itemId: itemRef.id };

    } catch (error) {
        console.error("Error creating project item:", error);
        throw new HttpsError('internal', 'No se pudo crear el ítem y sus sub-ítems.');
    }
});


/**
 * Función de borrado recursivo para subcolecciones (necesaria para `deleteArchivedProject`).
 * @param {FirebaseFirestore.DocumentReference} docRef - La referencia al documento a eliminar.
 * @param {FirebaseFirestore.WriteBatch} batch - El batch de escritura.
 * @returns {Promise<void>}
 */
async function deleteDocumentAndSubcollections(docRef, batch) {
    // Primero, borra subcolecciones de este documento (ej. /items/{itemId}/subItems)
    const subcollections = await docRef.listCollections();
    for (const subcollectionRef of subcollections) {
        const snapshot = await subcollectionRef.get();
        snapshot.forEach(doc => {
            // Recursivamente borra documentos en subcolecciones (aunque aquí solo esperamos un nivel)
            batch.delete(doc.ref);
        });
    }
    // Finalmente, borra el documento principal (ej. /items/{itemId})
    batch.delete(docRef);
}

exports.deleteArchivedProject = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'La función debe ser llamada por un usuario autenticado.');
    }
    const projectId = request.data.projectId;
    if (!projectId) {
        throw new HttpsError('invalid-argument', 'Se requiere un ID de proyecto.');
    }

    const projectRef = db.doc(`projects/${projectId}`);

    try {
        const projectDoc = await projectRef.get();
        if (!projectDoc.exists) {
            throw new HttpsError('not-found', 'El proyecto no existe.');
        }
        if (projectDoc.data().status !== 'archived') {
            throw new HttpsError('failed-precondition', 'Solo se pueden eliminar proyectos que están archivados.');
        }

        // --- INICIO DE CAMBIO: Lógica de borrado recursivo ---
        // Firestore limita los batches a 500. Si un proyecto es enorme, esto fallará.
        // Para esta app, asumimos que un proyecto no superará las 500 escrituras de borrado.
        // Si lo supera, se necesita una cola de tareas (Task Queue), que es mucho más compleja.

        const batch = db.batch();

        // 1. Borrar colecciones directas del proyecto (cortes, payments, etc.)
        const rootSubcollections = ['cortes', 'payments', 'peopleOfInterest', 'documents', 'otrosSi', 'varios', 'materialRequests'];
        for (const collectionName of rootSubcollections) {
            const snapshot = await projectRef.collection(collectionName).get();
            snapshot.forEach(doc => batch.delete(doc.ref));
        }

        // 2. Borrar 'items' y sus 'subItems' anidados
        const itemsSnapshot = await projectRef.collection('items').get();
        for (const itemDoc of itemsSnapshot.docs) {
            // Borra /items/{itemId}/subItems/{subItemId}
            const subItemsSnapshot = await itemDoc.ref.collection('subItems').get();
            subItemsSnapshot.forEach(subItemDoc => {
                batch.delete(subItemDoc.ref);
            });
            // Borra /items/{itemId}
            batch.delete(itemDoc.ref);
        }

        // 3. Borrar el documento principal del proyecto
        batch.delete(projectRef);

        await batch.commit();
        // --- FIN DE CAMBIO ---

        console.log(`Successfully deleted archived project ${projectId}.`);
        return { success: true, message: 'Proyecto eliminado con éxito.' };

    } catch (error) {
        console.error(`Error deleting project ${projectId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', `No se pudo completar la eliminación: ${error.message}`);
    }
});

/**
 * Cloud Function (callable) para actualizar un ítem existente de forma segura.
 */
exports.updateProjectItem = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'La función debe ser llamada por un usuario autenticado.');
    }
    const { itemId, updatedData } = request.data;
    if (!itemId || !updatedData || !updatedData.name) {
        throw new HttpsError('invalid-argument', 'Faltan datos esenciales (itemId, updatedData).');
    }

    // --- INICIO DE CAMBIO: Path de subcolección ---
    // El 'projectId' DEBE estar en 'updatedData' para esta lógica
    const projectId = updatedData.projectId;
    if (!projectId) {
        throw new HttpsError('invalid-argument', 'El projectId es necesario en updatedData para actualizar un ítem.');
    }
    const itemRef = db.doc(`projects/${projectId}/items/${itemId}`);
    // --- FIN DE CAMBIO ---

    try {
        const itemDoc = await itemRef.get();
        if (!itemDoc.exists) {
            throw new HttpsError('not-found', 'El ítem que intentas editar no existe.');
        }

        await itemRef.update(updatedData);
        console.log(`Successfully updated item ${itemId}.`);
        return { success: true, message: 'Ítem actualizado con éxito.' };

    } catch (error) {
        console.error(`Error updating item ${itemId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'No se pudo actualizar el ítem.');
    }
});

// Esta es la nueva función que valida y descuenta el stock
exports.deliverMaterial = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'La función debe ser llamada por un usuario autenticado.');
    }
    
    // 1. OBTENEMOS EL NUEVO PAYLOAD
    const { projectId, requestId, itemsToDeliver } = request.data;
    const uid = request.auth.uid;

    if (!projectId || !requestId || !itemsToDeliver || !Array.isArray(itemsToDeliver) || itemsToDeliver.length === 0) {
        throw new HttpsError('invalid-argument', 'Faltan datos (projectId, requestId, itemsToDeliver).');
    }

    const requestRef = db.doc(`projects/${projectId}/materialRequests/${requestId}`);
    
    // --- INICIO DE CORRECCIÓN ---
    const deliveryLog = {
        deliveredBy: uid,
        deliveredAt: new Date(), // <-- CAMBIO: Usamos new Date() en lugar de FieldValue.serverTimestamp()
        items: itemsToDeliver 
    };
    // --- FIN DE CORRECCIÓN ---

    try {
        await db.runTransaction(async (transaction) => {
            const requestDoc = await transaction.get(requestRef);
            if (!requestDoc.exists) throw new Error("La solicitud no existe.");
            
            const requestData = requestDoc.data();
            const status = requestData.status;
            if (status !== 'aprobado' && status !== 'entregado_parcial') {
                throw new Error(`Solo se pueden entregar solicitudes con estado 'aprobado' o 'entregado_parcial'. Estado actual: ${status}`);
            }

            const itemsSolicitados = requestData.consumedItems || [];
            const itemsEntregadosHistorial = requestData.deliveryHistory || [];

            // 2. VALIDAR LA ENTREGA ACTUAL CONTRA LO PENDIENTE
            const pendienteMap = new Map();
            itemsSolicitados.forEach(item => {
                const key = `${item.materialId}-${item.type}-${item.length || 0}`;
                pendienteMap.set(key, (pendienteMap.get(key) || 0) + item.quantity);
            });

            itemsEntregadosHistorial.forEach(entrega => {
                entrega.items.forEach(item => {
                    const key = `${item.materialId}-${item.type}-${item.length || 0}`;
                    pendienteMap.set(key, (pendienteMap.get(key) || 0) - item.quantity);
                });
            });

            for (const item of itemsToDeliver) {
                const key = `${item.materialId}-${item.type}-${item.length || 0}`;
                const pendiente = pendienteMap.get(key) || 0;
                if (item.quantity > pendiente) {
                    throw new Error(`Intento de entregar ${item.quantity} de ${item.materialId} (tipo ${item.type}) pero solo quedan ${pendiente} pendientes.`);
                }
            }
            
            // 3. OBTENER DATOS DE MATERIALES (STOCK)
            const materialIds = [...new Set(itemsToDeliver.map(item => item.materialId))];
            const materialsData = new Map();
            for (const id of materialIds) {
                const materialRef = db.doc(`materialCatalog/${id}`);
                const [materialDoc, batchesSnap, remnantsSnap] = await Promise.all([
                    transaction.get(materialRef),
                    transaction.get(materialRef.collection('stockBatches').where('quantityRemaining', '>', 0).orderBy('purchaseDate', 'asc')),
                    transaction.get(materialRef.collection('remnantStock').where('quantity', '>', 0).orderBy('length', 'asc'))
                ]);
                
                if (!materialDoc.exists) throw new Error(`El material con ID ${id} no existe en el catálogo.`);

                materialsData.set(id, {
                    doc: materialDoc,
                    data: materialDoc.data(),
                    ref: materialRef,
                    batches: batchesSnap.docs.map(d => ({ ref: d.ref, data: d.data() })),
                    remnants: remnantsSnap.docs.map(d => ({ ref: d.ref, data: d.data() }))
                });
            }

            // 4. LÓGICA DE DESCUENTO DE STOCK
            for (const item of itemsToDeliver) {
                const { ref: materialRef, data: materialData, batches, remnants } = materialsData.get(item.materialId);
                const requestedQty = parseInt(item.quantity);
                if (isNaN(requestedQty) || requestedQty <= 0) continue;

                if (item.type === 'cut') {
                    const defaultLength = materialData.defaultSize?.length || 0;
                    if (defaultLength <= 0) throw new Error(`El material "${materialData.name}" no tiene una longitud estándar definida.`);
                    
                    let cutsToMake = Array(requestedQty).fill(parseFloat(item.length));
                    const newRemnantsToCreate = new Map();

                    while (cutsToMake.length > 0) {
                        const nextCut = cutsToMake.pop();
                        const suitableRemnant = remnants.find(r => r.data.length >= nextCut && r.data.quantity > 0);

                        if (suitableRemnant) {
                            transaction.update(suitableRemnant.ref, { quantity: FieldValue.increment(-1) });
                            suitableRemnant.data.quantity--; 
                            const newLength = parseFloat((suitableRemnant.data.length - nextCut).toFixed(2));
                            if (newLength > 0.05) { 
                                newRemnantsToCreate.set(newLength, (newRemnantsToCreate.get(newLength) || 0) + 1);
                            }
                        } else {
                            const suitableBatch = batches.find(b => b.data.quantityRemaining > 0);
                            if (!suitableBatch) throw new Error(`No hay stock (lotes) para realizar el corte de ${nextCut}m para "${materialData.name}".`);
                            
                            transaction.update(suitableBatch.ref, { quantityRemaining: FieldValue.increment(-1) });
                            transaction.update(materialRef, { quantityInStock: FieldValue.increment(-1) });
                            suitableBatch.data.quantityRemaining--; 

                            const newLength = parseFloat((defaultLength - nextCut).toFixed(2));
                            if (newLength > 0.05) {
                                newRemnantsToCreate.set(newLength, (newRemnantsToCreate.get(newLength) || 0) + 1);
                            }
                        }
                    }

                    for (const [length, quantity] of newRemnantsToCreate.entries()) {
                        const existingRemnantRef = remnants.find(r => r.data.length === length)?.ref;
                        if (existingRemnantRef) {
                            transaction.update(existingRemnantRef, { quantity: FieldValue.increment(quantity) });
                        } else {
                            const newRemnantRef = materialRef.collection('remnantStock').doc();
                            transaction.set(newRemnantRef, { length, quantity, unit: 'm', createdAt: new Date() }); // Usamos new Date() aquí también
                        }
                    }

                } else if (item.type === 'remnant') {
                    const remnantToUse = remnants.find(r => r.data.length === item.length);
                    if (!remnantToUse || remnantToUse.data.quantity < requestedQty) {
                        throw new Error(`Stock insuficiente del retazo de ${item.length}m para "${materialData.name}". Solicitado: ${requestedQty}, Disponible: ${remnantToUse ? remnantToUse.data.quantity : 0}.`);
                    }
                    transaction.update(remnantToUse.ref, { quantity: FieldValue.increment(-requestedQty) });
                } else { // 'full_unit'
                    const totalStock = batches.reduce((sum, b) => sum + b.data.quantityRemaining, 0);
                    if (totalStock < requestedQty) {
                        throw new Error(`Stock insuficiente de "${materialData.name}". Solicitado: ${requestedQty}, Disponible: ${totalStock}`);
                    }
                    let remainingToFulfill = requestedQty;
                    for (const batch of batches) {
                        if (remainingToFulfill <= 0) break;
                        const consume = Math.min(batch.data.quantityRemaining, remainingToFulfill);
                        transaction.update(batch.ref, { quantityRemaining: FieldValue.increment(-consume) });
                        remainingToFulfill -= consume;
                    }
                    transaction.update(materialRef, { quantityInStock: FieldValue.increment(-requestedQty) });
                }
            }
            
            // 5. DETERMINAR EL NUEVO ESTADO DE LA SOLICITUD
            itemsToDeliver.forEach(item => {
                const key = `${item.materialId}-${item.type}-${item.length || 0}`;
                pendienteMap.set(key, (pendienteMap.get(key) || 0) - item.quantity);
            });

            const isFullyDelivered = Array.from(pendienteMap.values()).every(qty => qty <= 0);
            const newStatus = isFullyDelivered ? 'entregado' : 'entregado_parcial';

            // 6. ACTUALIZAR LA SOLICITUD
            transaction.update(requestRef, { 
                status: newStatus, 
                responsibleId: uid, 
                deliveryHistory: FieldValue.arrayUnion(deliveryLog) 
            });
        });
        
        return { success: true, message: 'Entrega registrada y stock actualizado.' };

    } catch (error) {
        console.error(`Error al entregar la solicitud ${requestId}:`, error);
        throw new HttpsError('internal', error.message || 'No se pudo procesar la entrega.');
    }
});

/**
 * Cloud Function (callable) para notificar a los usuarios relevantes sobre un nuevo comentario en una tarea.
 */
exports.notifyOnNewTaskComment = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'La función debe ser llamada por un usuario autenticado.');
    }

    const { taskId, projectId, commentText, authorName } = request.data;
    const authorId = request.auth.uid;

    if (!taskId || !projectId || !commentText || !authorName) {
        throw new HttpsError('invalid-argument', 'Faltan datos esenciales (taskId, projectId, commentText, authorName).');
    }

    console.log(`Notificando comentario de ${authorName} (ID: ${authorId}) en tarea ${taskId}...`);

    try {
        const recipientIds = new Set();

        // 1. Obtener la tarea para encontrar a los asignados
        const taskDoc = await db.doc(`tasks/${taskId}`).get();
        let taskDescription = "una tarea";
        let projectName = "un proyecto"; // Valor por defecto

        if (taskDoc.exists) {
            const taskData = taskDoc.data();
            taskDescription = taskData.description ? `la tarea "${taskData.description.substring(0, 30)}..."` : "una tarea";
            projectName = taskData.projectName || "un proyecto"; // Obtenemos el nombre del proyecto

            // Añadir asignado principal
            if (taskData.assigneeId) {
                recipientIds.add(taskData.assigneeId);

            }
            // Añadir asignados adicionales
            if (taskData.additionalAssigneeIds && Array.isArray(taskData.additionalAssigneeIds)) {
                taskData.additionalAssigneeIds.forEach(id => recipientIds.add(id));
            }
        }

        // 2. Obtener a todos los administradores
        const adminSnapshot = await db.collection('users').where('role', '==', 'admin').get();
        adminSnapshot.forEach(doc => {
            recipientIds.add(doc.id);
        });

        // 3. Quitar al autor del comentario de la lista de destinatarios
        recipientIds.delete(authorId);

        if (recipientIds.size === 0) {
            console.log("No hay destinatarios a quien notificar (autor es el único involucrado).");
            return { success: true, recipients: [] };
        }

        // Mensaje actualizado para incluir el nombre del proyecto
        const batch = db.batch();

        // --- INICIO DE LA MODIFICACIÓN ---
        // Creamos un título con el contexto
        const notificationTitle = `${authorName} comentó en ${taskDescription}`;
        // El 'message' ahora es el comentario completo, sin truncar.
        const notificationMessage = commentText;

        recipientIds.forEach(userId => {
            const notificationRef = db.collection('notifications').doc();
            batch.set(notificationRef, {
                userId: userId,
                title: notificationTitle, // <-- CAMBIO AÑADIDO
                message: notificationMessage, // <-- CAMBIO MODIFICADO (ahora es el comentario completo)
                projectName: projectName,
                taskId: taskId,
                projectId: projectId,
                read: false,
                createdAt: FieldValue.serverTimestamp(), // Usar hora del servidor
                type: 'task_comment' // Nuevo tipo de notificación
            });
        });

        await batch.commit();

        console.log(`Notificaciones enviadas a ${recipientIds.size} usuarios.`);
        return { success: true, recipients: Array.from(recipientIds) };

    } catch (error) {
        console.error(`Error al notificar sobre el comentario de la tarea ${taskId}:`, error);
        throw new HttpsError('internal', 'No se pudo completar el envío de notificaciones.');
    }
});

/**
 * Cloud Function (trigger) para notificar al canal de admins y bodega
 * cuando se crea una nueva solicitud de material.
 */
exports.notifyOnNewMaterialRequest = onDocumentWritten("projects/{projectId}/materialRequests/{requestId}", async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
        console.log("No data associated with the event");
        return;
    }

    const requestData = snapshot.data();
    const projectId = event.params.projectId;
    // const requestId = event.params.requestId; // No lo usaremos para navegar por ahora

    // 1. Get Requester's Name
    let requesterName = "Alguien";
    if (requestData.requesterId) {
        try {
            const userDoc = await db.doc(`users/${requestData.requesterId}`).get();
            if (userDoc.exists) {
                requesterName = userDoc.data().firstName || "Usuario";
            }
        } catch (e) { console.warn("Could not fetch requester name", e); }
    }

    // 2. Get Project Name
    let projectName = "un proyecto";
    try {
        const projectDoc = await db.doc(`projects/${projectId}`).get();
        if (projectDoc.exists) {
            projectName = projectDoc.data().name || "un proyecto";
        }
    } catch (e) { console.warn("Could not fetch project name", e); }

    // 3. Create a summary message
    let message = `${requesterName} ha solicitado material para ${projectName}.`;
    if (requestData.consumedItems && requestData.consumedItems.length > 0) {
        const firstItem = requestData.consumedItems[0];
        // Usamos el 'itemName' que ya guardamos en la solicitud
        message = `${requesterName} solicitó ${firstItem.quantity}x ${firstItem.itemName || 'material'} para ${projectName}.`;
        if (requestData.consumedItems.length > 1) {
            message += ` (y ${requestData.consumedItems.length - 1} más...)`;
        }
    }

    // 4. Create the single channel notification
    try {
        await db.collection('notifications').add({
            channel: 'admins_bodega', // Enviar al canal que 'admin' y 'bodega' ya escuchan
            title: "Nueva Solicitud de Material",
            message: message,
            projectName: projectName,
            projectId: projectId, // ID para la navegación
            read: false,
            createdAt: FieldValue.serverTimestamp(),
            type: 'material_request' // Nuevo tipo de notificación
        });
        console.log("Sent material request notification to 'admins_bodega' channel.");
    } catch (error) {
        console.error("Failed to send channel notification:", error);
    }

    return;
});

/**
 * Trigger que envía notificaciones cuando el estado de una solicitud de material
 * vinculada a una tarea cambia (ej: Aprobado, Entregado).
 */
exports.notifyOnMaterialUpdate = onDocumentWritten("projects/{projectId}/materialRequests/{requestId}", async (event) => {
    // No hacer nada si el documento se borró
    if (!event.data.after.exists) {
        return null;
    }

    const beforeData = event.data.before.data() || {};
    const afterData = event.data.after.data();

    const statusBefore = beforeData.status;
    const statusAfter = afterData.status;
    const taskId = afterData.taskId; // Obtenemos el ID de la tarea vinculada

    // Salir si no hay ID de tarea, o si el estado no cambió
    if (!taskId || statusBefore === statusAfter) {
        return null;
    }

    let notificationTitle = "";
    let notificationMessage = "";
    let notificationType = "info"; // Tipo genérico

    // 1. Determinar el mensaje basado en el cambio de estado que SOLICITASTE
    if (statusAfter === "aprobado") {
        notificationTitle = "Material Aprobado";
        notificationMessage = `El material para la tarea fue aprobado por bodega.`;
        notificationType = "material_approved";
    } else if (statusAfter === "entregado_parcial") {
        notificationTitle = "Material Entregado (Parcial)";
        notificationMessage = `Se entregó material parcial para la tarea. Revisa el estado.`;
        notificationType = "material_delivered";
    } else if (statusAfter === "entregado") {
        notificationTitle = "Material Entregado (Completo)";
        notificationMessage = `Se completó la entrega de material para la tarea.`;
        notificationType = "material_delivered";
    } else {
        // No notificar sobre otros estados (pendiente, rechazado, etc.)
        return null;
    }

    try {
        const recipientIds = new Set();
        const projectId = event.params.projectId;
        let projectName = "Proyecto";
        let taskDescription = "la tarea";

        // 2. Obtener la Tarea y el Proyecto para los detalles
        const taskDoc = await db.doc(`tasks/${taskId}`).get();
        if (taskDoc.exists) {
            const taskData = taskDoc.data();
            taskDescription = taskData.description ? `"${taskData.description.substring(0, 30)}..."` : "la tarea";
            projectName = taskData.projectName || "Proyecto"; // Usar el nombre guardado en la tarea

            // 3. Obtener Asignados (Principal y Adicionales)
            if (taskData.assigneeId) recipientIds.add(taskData.assigneeId);
            if (taskData.additionalAssigneeIds && Array.isArray(taskData.additionalAssigneeIds)) {
                taskData.additionalAssigneeIds.forEach(id => recipientIds.add(id));
            }
        } else {
            // Si la tarea no existe, al menos buscar el nombre del proyecto
            const projectDoc = await db.doc(`projects/${projectId}`).get();
            if (projectDoc.exists()) {
                projectName = projectDoc.data().name || "Proyecto";
            }
        }

        // 4. Obtener TODOS los Administradores
        const adminSnapshot = await db.collection('users').where('role', '==', 'admin').get();
        adminSnapshot.forEach(doc => recipientIds.add(doc.id));

        if (recipientIds.size === 0) {
            console.log(`notifyOnMaterialUpdate: No hay destinatarios para la tarea ${taskId}.`);
            return null;
        }

        // Actualizar mensajes con los nombres
        notificationTitle = `${notificationTitle} (Tarea: ${taskDescription})`;

        // 5. Enviar Batch de Notificaciones
        const batch = db.batch();
        recipientIds.forEach(userId => {
            // No nos auto-notificamos si el usuario que aprueba/entrega es uno de los destinatarios
            // (La función deliverMaterial/approve es llamada por el admin/bodega)
            // Esta lógica se puede añadir si 'uid' estuviera disponible, pero por ahora notificamos a todos.

            const notificationRef = db.collection('notifications').doc();
            batch.set(notificationRef, {
                userId: userId,
                title: notificationTitle,
                message: notificationMessage,
                projectName: projectName,
                taskId: taskId,
                projectId: projectId,
                read: false,
                createdAt: FieldValue.serverTimestamp(),
                type: notificationType
            });
        });

        await batch.commit();
        console.log(`notifyOnMaterialUpdate: Notificaciones enviadas a ${recipientIds.size} usuarios por cambio de estado a '${statusAfter}' en Tarea ${taskId}.`);
        return { success: true, recipients: Array.from(recipientIds) };

    } catch (error) {
        console.error(`Error en notifyOnMaterialUpdate (Tarea: ${taskId}):`, error);
        // No lanzamos HttpsError porque esto no fue llamado por un cliente, fue un trigger
        return { success: false, error: error.message };
    }
});

/**
 * Trigger que se activa cuando se añade un nuevo comentario.
 * Añade a todos los involucrados (excepto al autor) a un array 'unreadCommentFor'
 * en el documento de la tarea, para que vean un ícono de "no leído".
 */
// ASEGÚRATE DE QUE DICE 'onDocumentWritten' AQUÍ
exports.notifyUnreadComment = onDocumentWritten("tasks/{taskId}/comments/{commentId}", async (event) => {
    // Solo nos interesa la creación de un nuevo comentario
    if (!event.data.before.exists && event.data.after.exists) {
        const taskId = event.params.taskId;
        const commentData = event.data.after.data();
        const authorId = commentData.userId; // El ID de quien escribió

        const taskRef = db.doc(`tasks/${taskId}`);

        try {
            const taskDoc = await taskRef.get();
            if (!taskDoc.exists) return null; // La tarea no existe

            const taskData = taskDoc.data();
            const recipientIds = new Set();

            // 1. Obtener Asignados (Principal y Adicionales)
            if (taskData.assigneeId) recipientIds.add(taskData.assigneeId);
            if (taskData.additionalAssigneeIds && Array.isArray(taskData.additionalAssigneeIds)) {
                taskData.additionalAssigneeIds.forEach(id => recipientIds.add(id));
            }

            // 2. Obtener TODOS los Administradores
            const adminSnapshot = await db.collection('users').where('role', '==', 'admin').get();
            adminSnapshot.forEach(doc => recipientIds.add(doc.id));

            // 3. Quitar al autor del comentario de la lista de destinatarios
            recipientIds.delete(authorId);

            if (recipientIds.size > 0) {
                // 4. Actualizar la tarea
                // Usamos arrayUnion para añadir los IDs de forma segura
                return taskRef.update({
                    unreadCommentFor: FieldValue.arrayUnion(...Array.from(recipientIds))
                });
            }
            return null;

        } catch (error) {
            console.error(`Error en notifyUnreadComment (Tarea: ${taskId}):`, error);
            return null;
        }
    }
    return null;
});

/**
 * ======================================================================
 * ¡FUNCIÓN DE MIGRACIÓN DE UN SOLO USO!
 * Esta función se debe ejecutar UNA SOLA VEZ para migrar los datos.
 * Después de verificar que la migración fue exitosa, puedes borrarla.
 * ======================================================================
 */
exports.migrateDataToSubcollections = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'La función debe ser llamada por un usuario autenticado.');
    }

    console.log("Iniciando migración de 'items' y 'subItems' a subcolecciones...");

    try {
        const allItemsSnapshot = await db.collection('items').get();
        const allSubItemsSnapshot = await db.collection('subItems').get();

        if (allItemsSnapshot.empty) {
            return { success: true, message: "No se encontraron 'items' en la raíz para migrar." };
        }

        // Mapear todos los sub-items por su itemId para un acceso rápido
        const subItemsMap = new Map();
        allSubItemsSnapshot.forEach(doc => {
            const subItem = doc.data();
            if (!subItem.itemId) return;
            if (!subItemsMap.has(subItem.itemId)) {
                subItemsMap.set(subItem.itemId, []);
            }
            subItemsMap.get(subItem.itemId).push({ id: doc.id, data: subItem });
        });

        console.log(`Se encontraron ${allItemsSnapshot.size} items y ${allSubItemsSnapshot.size} subItems para procesar.`);

        let itemsMigrados = 0;
        let subItemsMigrados = 0;
        const BATCH_LIMIT = 400; // Límite de seguridad (Firestore es 500)
        let batch = db.batch();
        let batchCount = 0;

        for (const itemDoc of allItemsSnapshot.docs) {
            const item = itemDoc.data();
            const itemId = itemDoc.id;
            const projectId = item.projectId;

            if (!projectId) {
                console.warn(`Item ${itemId} omitido: no tiene projectId.`);
                continue;
            }

            // 1. Añadir el 'item' a su nueva ubicación en el batch
            const newItemRef = db.doc(`projects/${projectId}/items/${itemId}`);
            batch.set(newItemRef, item);
            batchCount++;
            itemsMigrados++;

            // 2. Añadir todos sus 'subItems' al batch
            const subItemsParaEsteItem = subItemsMap.get(itemId) || [];
            for (const subItemObj of subItemsParaEsteItem) {
                const newSubItemRef = db.doc(`projects/${projectId}/items/${itemId}/subItems/${subItemObj.id}`);
                batch.set(newSubItemRef, subItemObj.data);
                batchCount++;
                subItemsMigrados++;

                // Si el batch se llena, lo ejecutamos y creamos uno nuevo
                if (batchCount >= BATCH_LIMIT) {
                    console.log(`...ejecutando batch de ${batchCount} operaciones...`);
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                }
            }
        }

        // 3. Ejecutar el último batch restante
        if (batchCount > 0) {
            console.log(`...ejecutando batch final de ${batchCount} operaciones...`);
            await batch.commit();
        }

        const message = `Migración completada. Se copiaron ${itemsMigrados} items y ${subItemsMigrados} subItems.`;
        console.log(message);
        return { success: true, message: message };

    } catch (error) {
        console.error("Error catastrófico durante la migración:", error);
        throw new HttpsError('internal', `Falló la migración: ${error.message}`);
    }
});

// --- INICIO DE NUEVA FUNCIÓN DE AUDITORÍA ---
/**
 * Trigger que registra automáticamente la actividad (cambios de estado, asignación)
 * en la bitácora de comentarios de una tarea.
 */
exports.logTaskActivity = onDocumentWritten("tasks/{taskId}", async (event) => {
    // Solo nos interesan las ACTUALIZACIONES
    if (!event.data.before.exists || !event.data.after.exists) {
        return null;
    }

    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();
    const taskRef = event.data.after.ref;
    const logsToWrite = [];

    try {
        // 1. Verificar cambio de Estado (ej. Completada)
        if (beforeData.status !== afterData.status) {
            if (afterData.status === 'completada') {
                const userName = await getUserName(afterData.completedBy); // 'completedBy' es seteado por app.js
                logsToWrite.push({
                    text: `La tarea fue marcada como **Completada** por ${userName}.`,
                    type: 'log',
                    userId: 'system'
                });
            } else if (afterData.status === 'pendiente' && beforeData.status === 'completada') {
                 logsToWrite.push({
                    text: `La tarea fue **re-abierta** (marcada como pendiente).`,
                    type: 'log',
                    userId: 'system'
                });
            }
        }

        // 2. Verificar cambio de Fecha de Entrega
        if (beforeData.dueDate !== afterData.dueDate) {
            logsToWrite.push({
                text: `Se cambió la fecha de entrega de [${beforeData.dueDate || 'N/A'}] a [${afterData.dueDate || 'N/A'}].`,
                type: 'log',
                userId: 'system'
            });
        }

        // 3. Verificar cambio de Asignado Principal
        if (beforeData.assigneeId !== afterData.assigneeId) {
            const oldName = await getUserName(beforeData.assigneeId);
            const newName = await getUserName(afterData.assigneeId);
            logsToWrite.push({
                text: `Se reasignó la tarea de ${oldName} a **${newName}**.`,
                type: 'log',
                userId: 'system'
            });
        }
        
        // (Opcional: puedes añadir más 'if' aquí para 'description', 'additionalAssigneeIds', etc.)

        // 4. Escribir los logs si hay alguno
        if (logsToWrite.length > 0) {
            const batch = db.batch();
            for (const log of logsToWrite) {
                const commentRef = taskRef.collection('comments').doc();
                batch.set(commentRef, { 
                    ...log, 
                    createdAt: FieldValue.serverTimestamp() // Usamos la hora del servidor
                });
            }
            await batch.commit();
        }
        return null;

    } catch (error) {
        console.error(`Error en logTaskActivity (Tarea: ${event.params.taskId}):`, error);
        return null;
    }
});
// --- FIN DE NUEVA FUNCIÓN DE AUDITORÍA ---