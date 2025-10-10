const functions = require("firebase-functions");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { initializeApp, getApps } = require("firebase-admin/app");

// Importaciones para la sintaxis v2
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

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
    return total;
}

const recalculateProjectProgress = async (projectId) => {
    if (!projectId) {
        console.log("No projectId provided for recalculation.");
        return;
    }
    const projectRef = db.doc(`projects/${projectId}`);
    const itemsQuery = db.collection('items').where('projectId', '==', projectId);
    const subItemsQuery = db.collection('subItems').where('projectId', '==', projectId);
    const [itemsSnapshot, subItemsSnapshot] = await Promise.all([itemsQuery.get(), subItemsQuery.get()]);
    let totalM2 = 0, totalItems = 0, executedM2 = 0, executedItems = 0, executedValue = 0;
    const itemsMap = new Map();
    itemsSnapshot.forEach(doc => {
        const item = { id: doc.id, ...doc.data() };
        totalM2 += (item.width * item.height) * item.quantity;
        totalItems += item.quantity;
        itemsMap.set(item.id, item);
    });
    subItemsSnapshot.forEach(doc => {
        const subItem = doc.data();
        if (subItem.status === 'Instalado') {
            const parentItem = itemsMap.get(subItem.itemId);
            if (parentItem) {
                executedItems += 1;
                executedM2 += (parentItem.width * parentItem.height);
                const itemTotalValue = calculateItemTotal(parentItem);
                const subItemValue = itemTotalValue / parentItem.quantity;
                executedValue += subItemValue;
            }
        }
    });
    const progressSummary = { totalM2, totalItems, executedM2, executedItems, executedValue, updatedAt: FieldValue.serverTimestamp() };
    return projectRef.update({ progressSummary });
};

// --- Trigger de Firestore (v2 - ya corregido) ---
exports.onSubItemChange = onDocumentWritten("subItems/{subItemId}", async (event) => {
    const subItemId = event.params.subItemId;
    let projectId = null;
    if (event.data.after.exists) {
        projectId = event.data.after.data().projectId;
    } else if (event.data.before.exists) {
        projectId = event.data.before.data().projectId;
    }
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

// Importa el módulo para funciones programadas (si no está ya)
const { onSchedule } = require("firebase-functions/v2/scheduler");

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
 * Cloud Function (callable) para crear un nuevo ítem y todos sus sub-ítems de forma atómica.
 */
exports.createProjectItem = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'La función debe ser llamada por un usuario autenticado.');
    }

    const data = request.data;
    const uid = request.auth.uid;

    // Validación de datos básicos
    if (!data.projectId || !data.name || !data.quantity || data.quantity <= 0) {
        throw new HttpsError('invalid-argument', 'Faltan datos esenciales (projectId, name, quantity).');
    }

    try {
        const itemRef = db.collection('items').doc();
        const batch = db.batch();

        // 1. Prepara la creación del ítem principal
        batch.set(itemRef, {
            ...data, // Todos los datos del formulario
            ownerId: uid,
            createdAt: FieldValue.serverTimestamp(),
        });

        // 2. Prepara la creación de todos los sub-ítems
        for (let i = 1; i <= data.quantity; i++) {
            const subItemRef = db.collection('subItems').doc();
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

        // 3. Ejecuta todas las operaciones a la vez
        await batch.commit();

        console.log(`Successfully created item ${itemRef.id} with ${data.quantity} sub-items.`);
        return { success: true, itemId: itemRef.id };

    } catch (error) {
        console.error("Error creating project item:", error);
        throw new HttpsError('internal', 'No se pudo crear el ítem y sus sub-ítems.');
    }
});

/**
 * Cloud Function (callable) para eliminar un proyecto ARCHIVADO y todos sus sub-documentos.
 */
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

        // --- INICIO DE LA CORRECCIÓN ---
        // La eliminación de subcolecciones se hace con un batch fuera de una transacción
        // para evitar errores de contención y complejidad.
        const collectionsToDelete = ['items', 'subItems', 'cortes', 'payments', 'peopleOfInterest', 'documents', 'otrosSi', 'varios', 'materialRequests'];
        const batch = db.batch();

        for (const collectionName of collectionsToDelete) {
            const snapshot = await projectRef.collection(collectionName).get();
            snapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
        }
        
        // Finalmente, añade la eliminación del documento del proyecto al batch
        batch.delete(projectRef);

        // Ejecuta todas las eliminaciones a la vez
        await batch.commit();
        // --- FIN DE LA CORRECCIÓN ---

        console.log(`Successfully deleted archived project ${projectId}.`);
        return { success: true, message: 'Proyecto eliminado con éxito.' };

    } catch (error) {
        console.error(`Error deleting project ${projectId}:`, error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'No se pudo completar la eliminación del proyecto.');
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

    // Validación de datos básicos
    if (!itemId || !updatedData || !updatedData.name) {
        throw new HttpsError('invalid-argument', 'Faltan datos esenciales (itemId, updatedData).');
    }

    const itemRef = db.doc(`items/${itemId}`);

    try {
        // Obtenemos el documento original para asegurarnos de que el usuario tiene permiso
        // (En el futuro, aquí se podrían añadir reglas de seguridad más complejas)
        const itemDoc = await itemRef.get();
        if (!itemDoc.exists) {
            throw new HttpsError('not-found', 'El ítem que intentas editar no existe.');
        }

        // Actualizamos el documento con los nuevos datos
        await itemRef.update(updatedData);

        console.log(`Successfully updated item ${itemId}.`);
        return { success: true, message: 'Ítem actualizado con éxito.' };

    } catch (error) {
        console.error(`Error updating item ${itemId}:`, error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'No se pudo actualizar el ítem.');
    }
});

// Esta es la nueva función que valida y descuenta el stock
exports.deliverMaterial = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'La función debe ser llamada por un usuario autenticado.');
    }
    
    const { projectId, requestId } = request.data;
    const uid = request.auth.uid;
    if (!projectId || !requestId) {
        throw new HttpsError('invalid-argument', 'Faltan projectId y requestId.');
    }

    const requestRef = db.doc(`projects/${projectId}/materialRequests/${requestId}`);

    try {
        await db.runTransaction(async (transaction) => {
            const requestDoc = await transaction.get(requestRef);
            if (!requestDoc.exists) throw new Error("La solicitud no existe.");
            
            const requestData = requestDoc.data();
            if (requestData.status !== 'aprobado') {
                throw new Error("Solo se pueden entregar solicitudes que han sido aprobadas.");
            }
            const itemsToProcess = requestData.consumedItems || [];
            
            const materialIds = [...new Set(itemsToProcess.map(item => item.materialId))];
            const materialsData = new Map();
            for (const id of materialIds) {
                const materialRef = db.doc(`materialCatalog/${id}`);
                const [materialDoc, batchesSnap, remnantsSnap] = await Promise.all([
                    transaction.get(materialRef),
                    transaction.get(materialRef.collection('stockBatches').where('quantityRemaining', '>', 0).orderBy('purchaseDate', 'asc')),
                    transaction.get(materialRef.collection('remnantStock').where('quantity', '>', 0).orderBy('length', 'asc'))
                ]);
                materialsData.set(id, {
                    doc: materialDoc,
                    batches: batchesSnap.docs.map(d => ({ ref: d.ref, data: d.data() })),
                    remnants: remnantsSnap.docs.map(d => ({ ref: d.ref, data: d.data() }))
                });
            }

            for (const item of itemsToProcess) {
                const { doc: materialDoc, batches, remnants } = materialsData.get(item.materialId);
                const materialData = materialDoc.data();
                const materialRef = materialDoc.ref;
                const requestedQty = parseInt(item.quantity);
                if (isNaN(requestedQty) || requestedQty <= 0) continue;

                if (item.type === 'cut') {
                    const defaultLength = materialData.defaultSize?.length || 0;
                    if (defaultLength <= 0) throw new Error(`El material "${materialData.name}" no tiene una longitud estándar definida.`);
                    
                    let cutsToMake = Array(requestedQty).fill(parseFloat(item.length));
                    
                    // --- INICIO DE LA CORRECCIÓN DE AGRUPACIÓN ---
                    const newRemnantsToCreate = new Map(); // Mapa para agrupar los nuevos retazos

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
                            if (!suitableBatch) throw new Error(`No hay stock para realizar el corte de ${nextCut}m para "${materialData.name}".`);
                            
                            transaction.update(suitableBatch.ref, { quantityRemaining: FieldValue.increment(-1) });
                            transaction.update(materialRef, { quantityInStock: FieldValue.increment(-1) });
                            suitableBatch.data.quantityRemaining--;

                            const newLength = parseFloat((defaultLength - nextCut).toFixed(2));
                            if (newLength > 0.05) {
                                newRemnantsToCreate.set(newLength, (newRemnantsToCreate.get(newLength) || 0) + 1);
                            }
                        }
                    }

                    // Después de procesar todos los cortes, guarda los retazos agrupados
                    for (const [length, quantity] of newRemnantsToCreate.entries()) {
                        const existingRemnant = remnants.find(r => r.data.length === length);
                        if (existingRemnant) {
                            transaction.update(existingRemnant.ref, { quantity: FieldValue.increment(quantity) });
                        } else {
                            const newRemnantRef = materialRef.collection('remnantStock').doc();
                            transaction.set(newRemnantRef, { length, quantity, unit: 'm', createdAt: FieldValue.serverTimestamp() });
                        }
                    }
                    // --- FIN DE LA CORRECCIÓN DE AGRUPACIÓN ---

                } else if (item.type === 'remnant') {
                    const remnantToUse = remnants.find(r => r.data.length === item.length);
                    if (!remnantToUse || remnantToUse.data.quantity < requestedQty) {
                        throw new Error(`Stock insuficiente del retazo de ${item.length}m para "${materialData.name}". Solicitado: ${requestedQty}, Disponible: ${remnantToUse ? remnantToUse.data.quantity : 0}.`);
                    }
                    transaction.update(remnantToUse.ref, { quantity: FieldValue.increment(-requestedQty) });
                } else {
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
            
            transaction.update(requestRef, { status: 'entregado', responsibleId: uid });
        });
        return { success: true, message: 'Material entregado y stock actualizado.' };

    } catch (error) {
        console.error(`Error al entregar la solicitud ${requestId}:`, error);
        throw new HttpsError('internal', error.message || 'No se pudo procesar la entrega.');
    }
});