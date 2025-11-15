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

/**
 * (NUEVA FUNCIÓN DE MIGRACIÓN)
 * Recorre todos los sub-ítems de todos los proyectos y les añade
 * los campos 'm2' y 'assignedTaskId' si no los tienen.
 */
const migrateLegacySubItems = async () => {
    console.log("Iniciando migración de sub-ítems antiguos...");
    const subItemsSnapshot = await db.collectionGroup("subItems").get();

    if (subItemsSnapshot.empty) {
        console.log("No se encontraron sub-ítems para migrar.");
        return 0;
    }

    // Usaremos un mapa para cachear los M² de los ítems padres
    const itemsCache = new Map();
    let batch = db.batch(); // Iniciamos el primer batch
    let updatedCount = 0;

    for (const subItemDoc of subItemsSnapshot.docs) {
        const subItemData = subItemDoc.data();

        // Comprobar si este sub-ítem ya está migrado (si tiene el campo)
        if (subItemData.assignedTaskId !== undefined) {
            continue; // Ya tiene el campo, saltar
        }

        let m2 = 0;
        const itemId = subItemData.itemId;
        const projectId = subItemData.projectId;

        // Buscar el M² del ítem padre
        if (itemId && projectId) {
            const itemPath = `projects/${projectId}/items/${itemId}`;

            if (itemsCache.has(itemPath)) {
                m2 = itemsCache.get(itemPath); // Usar caché
            } else {
                const itemDoc = await db.doc(itemPath).get();
                if (itemDoc.exists) {
                    const itemData = itemDoc.data();
                    m2 = (itemData.width || 0) * (itemData.height || 0);
                    itemsCache.set(itemPath, m2); // Guardar en caché
                }
            }
        }

        // Añadir la actualización al batch
        batch.update(subItemDoc.ref, {
            assignedTaskId: null, // <-- Añade el campo para que 'createTask' lo encuentre
            m2: m2 // <-- Añade el campo M²
        });
        updatedCount++;

        // Los batches de Firestore tienen un límite de 500 operaciones
        if (updatedCount % 499 === 0) {
            await batch.commit();
            batch = db.batch(); // Iniciar un nuevo batch
        }
    }

    // Commit del último batch si queda algo pendiente
    if (updatedCount % 499 !== 0) {
        await batch.commit();
    }

    console.log(`Migración completada. ${updatedCount} sub-ítems actualizados.`);
    return updatedCount;
};

/**
 * Trigger que recalcula el Progreso del Proyecto Y
 * ACTUALIZA LAS ESTADÍSTICAS DE M² COMPLETADOS Y BONIFICACIONES (Globales y de Empleado).
 * (VERSIÓN ACTUALIZADA: Distribuye M² y Bonificación entre MÚLTIPLES instaladores)
 */
exports.onSubItemChange = onDocumentWritten("projects/{projectId}/items/{itemId}/subItems/{subItemId}", async (event) => {

    // --- Bloque 1: Recalcular Progreso del Proyecto (Lógica existente, sin cambios) ---
    const projectId = event.params.projectId;
    if (projectId) {
        try {
            await recalculateProjectProgress(projectId);
        } catch (error) {
            console.error(`Error al actualizar progreso del proyecto ${projectId}:`, error);
        }
    }

    // --- Bloque 2: Calcular Estadísticas de Productividad (LÓGICA NUEVA) ---
    const configDoc = await db.doc("system/bonificationConfig").get();
    const config = configDoc.exists ? configDoc.data() : null;

    if (!config) {
        console.error("¡CRÍTICO! El documento 'system/bonificationConfig' no existe. No se pueden calcular bonificaciones.");
    }

    try {
        if (!event.data.before.exists || !event.data.after.exists) return; // Solo actualizaciones

        const beforeData = event.data.before.data();
        const afterData = event.data.after.data();

        let operationType = 0; // 1 para sumar, -1 para restar
        let m2_total = 0;
        let installerIds = []; // Array de instaladores
        let installDateStr = null;
        let taskId = null;
        let onTime = true; // Por defecto

        if (beforeData.status !== "Instalado" && afterData.status === "Instalado") {
            // --- INSTALACIÓN (Sumar) ---
            operationType = 1;
            m2_total = afterData.m2 || 0;
            // Leemos el nuevo array 'installers' o el antiguo 'installer' como fallback
            installerIds = afterData.installers || (afterData.installer ? [afterData.installer] : []);
            installDateStr = afterData.installDate;
            taskId = afterData.assignedTaskId;
        } else if (beforeData.status === "Instalado" && afterData.status !== "Instalado") {
            // --- REVERSIÓN (Restar) ---
            operationType = -1;
            m2_total = beforeData.m2 || 0;
            // Leemos el array 'installers' o el antiguo 'installer'
            installerIds = beforeData.installers || (beforeData.installer ? [beforeData.installer] : []);
            installDateStr = beforeData.installDate;
            taskId = beforeData.assignedTaskId;
        }

        // Si no hay cambio, no hay instaladores, o no hay fecha, no podemos calcular.
        if (operationType === 0 || installerIds.length === 0 || !installDateStr) {
            return;
        }

        // Si los M² son 0, no calculamos (esto es correcto, no hay nada que sumar)
        if (m2_total === 0) {
            console.log("Cálculo omitido: M² es 0.");
            return; 
        }

        // --- DIVIDIR LOS M² ENTRE LOS INSTALADORES ---
        const m2_por_instalador = m2_total / installerIds.length;

        // Verificamos la Tarea (opcional) solo para la bonificación "a tiempo"
        if (taskId) {
            const taskDoc = await db.doc(`tasks/${taskId}`).get();
            if (taskDoc.exists) {
                const taskData = taskDoc.data();
                if (taskData.dueDate) {
                    const installDate = new Date(installDateStr + 'T12:00:00Z');
                    const dueDate = new Date(taskData.dueDate + 'T23:59:59Z');
                    if (installDate > dueDate) {
                        onTime = false; // Marcamos como "fuera de tiempo"
                    }
                }
            } else {
                console.warn(`Estadísticas: Se encontró un taskId (${taskId}) pero no la Tarea. Se calculará como 'a tiempo'.`);
            }
        }
        
        const installDate = new Date(installDateStr + 'T12:00:00Z');
        const year = installDate.getFullYear();
        const month = String(installDate.getMonth() + 1).padStart(2, '0');
        const statDocId = `${year}_${month}`;
        
        const statsRefGlobal = db.doc("system/dashboardStats");
        const batch = db.batch();

        // --- BUCLE PARA ACTUALIZAR A CADA INSTALADOR ---
        for (const installerId of installerIds) {
            const userDoc = await db.doc(`users/${installerId}`).get();
            if (!userDoc.exists) {
                console.error(`Estadísticas: No se encontró al Usuario ${installerId}. Omitiendo.`);
                continue; // Saltamos a la siguiente persona
            }
            
            const userData = userDoc.data();
            const level = userData.commissionLevel || "principiante";
            
            // Cálculo de Bonificación (porción individual)
            let bonificacion_individual = 0;
            if (config && config[level]) {
                const rate = onTime ? config[level].valorM2EnTiempo : config[level].valorM2FueraDeTiempo;
                // La bonificación es la porción de M² multiplicada por la tarifa
                bonificacion_individual = (m2_por_instalador * rate) * operationType;
            }

            // Actualización para el Empleado
            const statsRefEmployee = db.doc(`employeeStats/${installerId}/monthlyStats/${statDocId}`);
            const statsUpdateEmployee = {
                metrosCompletados: FieldValue.increment(m2_por_instalador * operationType),
                metrosEnTiempo: onTime ? FieldValue.increment(m2_por_instalador * operationType) : FieldValue.increment(0),
                metrosFueraDeTiempo: !onTime ? FieldValue.increment(m2_por_instalador * operationType) : FieldValue.increment(0),
                totalBonificacion: FieldValue.increment(bonificacion_individual)
            };
            batch.set(statsRefEmployee, statsUpdateEmployee, { merge: true });

            // Actualización Global (sumamos la porción de este empleado)
            const statsUpdateGlobal = {
                productivity: {
                    metrosCompletados: FieldValue.increment(m2_por_instalador * operationType),
                    metrosEnTiempo: onTime ? FieldValue.increment(m2_por_instalador * operationType) : FieldValue.increment(0),
                    metrosFueraDeTiempo: !onTime ? FieldValue.increment(m2_por_instalador * operationType) : FieldValue.increment(0),
                    totalBonificacion: FieldValue.increment(bonificacion_individual)
                }
            };
            batch.set(statsRefGlobal, statsUpdateGlobal, { merge: true });

            console.log(`Estadísticas de ${installerId} para ${statDocId} actualizadas: ${m2_por_instalador * operationType}m², $${bonificacion_individual} (A tiempo: ${onTime})`);
        }
        
        // (La lógica de actualizar la tarea 'completedSubItemsCount' se omite por simplicidad,
        // ya que solo la usa un gráfico que no funciona)

        await batch.commit();

    } catch (statError) {
        console.error(`Error al actualizar estadísticas de operario:`, statError);
    }
});

/**
 * Función auxiliar para recalcular el resumen de estadísticas de herramientas
 * desde cero y escribirlo en 'system/dashboardStats'.
 * (VERSIÓN ACTUALIZADA: Incluye Top 3 de daños)
 */
const recalculateToolStats = async () => {
    console.log("Iniciando recálculo de estadísticas de Herramientas...");
    const statsRef = db.doc("system/dashboardStats");

    // Consultas en paralelo
    const [toolsSnapshot, damagedReturnsSnapshot] = await Promise.all([
        db.collection("tools").get(),
        db.collectionGroup("history").where("returnStatus", "in", ["dañado", "con_defecto"]).get()
    ]);

    // 1. Contar estadísticas de estado
    const stats = {
        total: 0,
        disponible: 0,
        asignada: 0,
        en_reparacion: 0,
        dada_de_baja: 0
    };
    toolsSnapshot.forEach(doc => {
        const tool = doc.data();
        stats.total++;
        const status = tool.status || 'disponible';
        if (stats[status] !== undefined) {
            stats[status]++;
        } else {
            stats.disponible++; // Fallback
        }
    });

    // 2. Contar "Top 3 Daños"
    const damageMap = new Map();
    damagedReturnsSnapshot.forEach(doc => {
        const historyEntry = doc.data();
        const userId = historyEntry.returnedByUserId; // ID del operario que devolvió
        if (userId) {
            damageMap.set(userId, (damageMap.get(userId) || 0) + 1);
        }
    });
    // Convertir el Map a un array, ordenar y tomar los 3 primeros
    const topDamage = Array.from(damageMap.entries())
        .sort((a, b) => b[1] - a[1]) // Ordenar de mayor a menor
        .slice(0, 3) // Tomar solo los 3 primeros
        .map(([userId, count]) => ({ userId, count })); // Formatear

    stats.topDamage = topDamage; // Guardamos el array en las estadísticas

    console.log("Estadísticas de herramientas calculadas:", stats);
    return statsRef.set({ tools: stats }, { merge: true });
};

/**
 * Función auxiliar para recalcular el resumen de estadísticas de Dotación
 * desde cero y escribirlo en 'system/dashboardStats'.
 * (VERSIÓN ACTUALIZADA: Incluye Top 3 de consumo)
 */
const recalculateDotacionStats = async () => {
    console.log("Iniciando recálculo de estadísticas de Dotación...");
    const statsRef = db.doc("system/dashboardStats");

    // Consultas en paralelo
    const [catalogSnapshot, historySnapshot] = await Promise.all([
        db.collection("dotacionCatalog").get(),
        db.collection("dotacionHistory").get() // Obtenemos TODO el historial
    ]);

    const stats = {
        totalTipos: 0,
        totalStock: 0,
        totalAsignado: 0
    };
    const consumoMap = new Map();

    // 1. Contar el catálogo (Stock)
    catalogSnapshot.forEach(doc => {
        stats.totalTipos++;
        stats.totalStock += (doc.data().quantityInStock || 0);
    });

    // 2. Contar el historial (Asignado y Top Consumo)
    historySnapshot.forEach(doc => {
        const entry = doc.data();
        const quantity = entry.quantity || 0;

        // Contar total asignado (activo)
        if (entry.action === 'asignada' && entry.status === 'activo') {
            stats.totalAsignado += quantity;
        }

        // Contar consumo histórico (solo asignaciones)
        if (entry.action === 'asignada' && entry.userId) {
            consumoMap.set(entry.userId, (consumoMap.get(entry.userId) || 0) + quantity);
        }
    });

    // 3. Convertir Map de consumo a Top 3
    const topConsumo = Array.from(consumoMap.entries())
        .sort((a, b) => b[1] - a[1]) // Ordenar
        .slice(0, 3) // Top 3
        .map(([userId, count]) => ({ userId, count })); // Formatear

    stats.topConsumo = topConsumo; // Guardar el array

    console.log("Estadísticas de dotación calculadas:", stats);
    return statsRef.set({ dotacion: stats }, { merge: true });
};

/**
 * Función auxiliar para recalcular el resumen de estadísticas de Proyectos
 * desde cero y escribirlo en 'system/dashboardStats'.
 */
const recalculateProjectStats = async () => {
    console.log("Iniciando recálculo de estadísticas de Proyectos...");
    const statsRef = db.doc("system/dashboardStats");
    const projectsSnapshot = await db.collection("projects").get();

    const stats = {
        total: 0,
        active: 0,
        archived: 0
    };

    projectsSnapshot.forEach(doc => {
        const project = doc.data();
        stats.total++;
        if (project.status === 'active') {
            stats.active++;
        } else if (project.status === 'archived') {
            stats.archived++;
        }
    });

    console.log("Estadísticas de proyectos calculadas:", stats);
    return statsRef.set({ projects: stats }, { merge: true });
};

/**
 * Función auxiliar para recalcular el resumen de estadísticas de Tareas
 * desde cero y escribirlo en 'system/dashboardStats'.
 */
const recalculateTaskStats = async () => {
    console.log("Iniciando recálculo de estadísticas de Tareas...");
    const statsRef = db.doc("system/dashboardStats");
    const tasksSnapshot = await db.collection("tasks").get();

    const stats = {
        total: 0,
        pendientes: 0,
        completadas: 0
    };

    tasksSnapshot.forEach(doc => {
        const task = doc.data();
        stats.total++;
        if (task.status === 'pendiente') {
            stats.pendientes++;
        } else if (task.status === 'completada') {
            stats.completadas++;
        }
    });

    console.log("Estadísticas de tareas calculadas:", stats);
    return statsRef.set({ tasks: stats }, { merge: true });
};

/**
 * Función auxiliar para recalcular el valor total del inventario en stock
 * y escribirlo en 'system/dashboardStats'.
 */
const recalculateInventoryValueStats = async () => {
    console.log("Iniciando recálculo de estadísticas de Inventario (Valor)...");
    const statsRef = db.doc("system/dashboardStats");
    const catalogSnapshot = await db.collection("materialCatalog").get();

    let totalValue = 0;
    let totalTypes = 0;

    // Iteramos por cada TIPO de material (ej: Vidrio 3mm)
    for (const materialDoc of catalogSnapshot.docs) {
        totalTypes++;

        // Consultamos sus lotes de stock (donde está el precio)
        const batchesSnapshot = await materialDoc.ref.collection("stockBatches").get();

        if (!batchesSnapshot.empty) {
            let valueForItem = 0;
            batchesSnapshot.forEach(batchDoc => {
                const batchData = batchDoc.data();
                const cost = batchData.unitCost || 0;
                const remaining = batchData.quantityRemaining || 0;
                // Sumamos el valor de este lote (Costo * Cantidad Restante)
                valueForItem += (cost * remaining);
            });
            totalValue += valueForItem;
        }
    }

    const stats = {
        totalValue: totalValue, // Valor total en $
        totalTypes: totalTypes  // Total de tipos de material
    };

    console.log("Estadísticas de inventario calculadas:", stats);
    return statsRef.set({ inventory: stats }, { merge: true });
};

/**
 * Función auxiliar para recalcular TODAS las estadísticas de productividad
 * (Globales y de Empleado) desde cero, INCLUYENDO BONIFICACIONES.
 */
const recalculateProductivityStats = async () => {
    console.log("Iniciando recálculo MASIVO de Estadísticas de Productividad...");
    const statsRefGlobal = db.doc("system/dashboardStats");


    // --- INICIO DE MODIFICACIÓN ---
    // 2. Cargar la Configuración de Bonificación y el mapa de Usuarios UNA VEZ
    const configDoc = await db.doc("system/bonificationConfig").get();
    const config = configDoc.exists ? configDoc.data() : null;
    if (!config) {
        console.error("¡CRÍTICO! 'system/bonificationConfig' no existe. Las bonificaciones se calcularán como 0.");
    }

    const usersSnapshot = await db.collection("users").get();
    const usersLevelMap = new Map(); // Mapa para guardar solo el Nivel de Comisión
    usersSnapshot.forEach(doc => {
        usersLevelMap.set(doc.id, doc.data().commissionLevel || "principiante");
    });
    // --- FIN DE MODIFICACIÓN ---

    // 3. Inicializar contadores globales
    const globalStats = {
        productivity: {
            metrosAsignados: 0,
            metrosCompletados: 0,
            metrosEnTiempo: 0,
            metrosFueraDeTiempo: 0,
            totalBonificacion: 0 // <-- AÑADIDO
        }
    };

    // 4. Recalcular M² Asignados (Iterando Tareas)
    const tasksSnapshot = await db.collection("tasks").get();
    const employeeStatsMap = new Map();

    for (const taskDoc of tasksSnapshot.docs) {
        const task = taskDoc.data();
        const m2Asignados = task.totalMetrosAsignados || 0;

        if (m2Asignados > 0 && task.assigneeId) {
            globalStats.productivity.metrosAsignados += m2Asignados;

            const assigneeId = task.assigneeId;
            const createdAt = task.createdAt.toDate();
            const year = createdAt.getFullYear();
            const month = String(createdAt.getMonth() + 1).padStart(2, '0');
            const statDocId = `${assigneeId}/monthlyStats/${year}_${month}`;

            const stats = employeeStatsMap.get(statDocId) || { mAsignados: 0, mCompletados: 0, mEnTiempo: 0, mFueraTiempo: 0, bonificacion: 0 };
            stats.mAsignados += m2Asignados;
            employeeStatsMap.set(statDocId, stats);
        }
    }

    // 5. Recalcular M² Completados y Bonificaciones (Iterando Sub-Ítems)
    const installedSnapshot = await db.collectionGroup("subItems")
        .where("status", "==", "Instalado")
        .get();

    for (const subItemDoc of installedSnapshot.docs) {
        const subItem = subItemDoc.data();
        const m2 = subItem.m2 || 0;
        const installerId = subItem.installer;
        const installDateStr = subItem.installDate;
        const taskId = subItem.assignedTaskId;

        if (!m2 || !installerId || !installDateStr || !taskId) continue;

        const taskDoc = await db.doc(`tasks/${taskId}`).get();
        if (!taskDoc.exists) continue;
        const taskData = taskDoc.data();

        const installDate = new Date(installDateStr + 'T12:00:00Z');
        const year = installDate.getFullYear();
        const month = String(installDate.getMonth() + 1).padStart(2, '0');
        const statDocId = `${installerId}/monthlyStats/${year}_${month}`;

        let onTime = true;
        if (taskData.dueDate) {
            const dueDate = new Date(taskData.dueDate + 'T23:59:59Z');
            if (installDate > dueDate) onTime = false;
        }

        // --- INICIO DE CÁLCULO DE BONIFICACIÓN ---
        let bonificacion = 0;
        const level = usersLevelMap.get(installerId) || "principiante"; // Obtenemos el nivel del mapa
        if (config && config[level]) {
            const rate = onTime ? config[level].valorM2EnTiempo : config[level].valorM2FueraDeTiempo;
            bonificacion = m2 * rate;
        }
        // --- FIN DE CÁLCULO DE BONIFICACIÓN ---

        // Sumar a Global
        globalStats.productivity.metrosCompletados += m2;
        globalStats.productivity.totalBonificacion += bonificacion; // <-- AÑADIDO
        if (onTime) globalStats.productivity.metrosEnTiempo += m2;
        else globalStats.productivity.metrosFueraDeTiempo += m2;

        // Sumar a Empleado
        const stats = employeeStatsMap.get(statDocId) || { mAsignados: 0, mCompletados: 0, mEnTiempo: 0, mFueraTiempo: 0, bonificacion: 0 };
        stats.mCompletados += m2;
        stats.bonificacion += bonificacion; // <-- AÑADIDO
        if (onTime) stats.mEnTiempo += m2;
        else stats.mFueraTiempo += m2;
        employeeStatsMap.set(statDocId, stats);
    }

    // 6. Escribir todos los cálculos en Firestore
    const finalBatch = db.batch();

    finalBatch.set(statsRefGlobal, globalStats, { merge: true });

    employeeStatsMap.forEach((stats, statDocId) => {
        const docRef = db.doc(`employeeStats/${statDocId}`);
        finalBatch.set(docRef, {
            metrosAsignados: stats.mAsignados,
            metrosCompletados: stats.mCompletados,
            metrosEnTiempo: stats.mEnTiempo,
            metrosFueraDeTiempo: stats.mFueraTiempo,
            totalBonificacion: stats.bonificacion // <-- AÑADIDO
        }, { merge: true });
    });

    await finalBatch.commit();
    console.log(`Estadísticas de Productividad recalculadas. ${employeeStatsMap.size} registros de empleados actualizados.`);
};

/**
 * Trigger que actualiza las estadísticas de Proyectos
 * cuando se crea, elimina o archiva un proyecto.
 */
exports.updateProjectStats = onDocumentWritten("projects/{projectId}", async (event) => {
    const statsRef = db.doc("system/dashboardStats");

    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    const increments = {
        total: FieldValue.increment(0),
        active: FieldValue.increment(0),
        archived: FieldValue.increment(0)
    };
    let hasChanges = false;

    if (!event.data.before.exists && event.data.after.exists) {
        // --- CREACIÓN ---
        increments.total = FieldValue.increment(1);
        increments.active = FieldValue.increment(1); // Nuevos proyectos siempre están activos
        hasChanges = true;
    } else if (event.data.before.exists && !event.data.after.exists) {
        // --- ELIMINACIÓN ---
        increments.total = FieldValue.increment(-1);
        if (beforeData.status === 'active') {
            increments.active = FieldValue.increment(-1);
        } else if (beforeData.status === 'archived') {
            increments.archived = FieldValue.increment(-1);
        }
        hasChanges = true;
    } else if (beforeData.status !== afterData.status) {
        // --- CAMBIO DE ESTADO (Archivar/Restaurar) ---
        if (beforeData.status === 'active') increments.active = FieldValue.increment(-1);
        if (beforeData.status === 'archived') increments.archived = FieldValue.increment(-1);

        if (afterData.status === 'active') increments.active = FieldValue.increment(1);
        if (afterData.status === 'archived') increments.archived = FieldValue.increment(1);
        hasChanges = true;
    }

    if (!hasChanges) return null;

    try {
        console.log("Actualizando estadísticas de Proyectos:", increments);
        return statsRef.set({ projects: increments }, { merge: true });
    } catch (error) {
        console.error("Error al actualizar estadísticas de Proyectos:", error.message);
        return null;
    }
});

/**
 * Trigger que actualiza las estadísticas de Tareas
 * cuando se crea, elimina o completa una tarea.
 */
exports.updateTaskStats = onDocumentWritten("tasks/{taskId}", async (event) => {
    const statsRef = db.doc("system/dashboardStats");

    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    const increments = {
        total: FieldValue.increment(0),
        pendientes: FieldValue.increment(0),
        completadas: FieldValue.increment(0)
    };
    let hasChanges = false;

    if (!event.data.before.exists && event.data.after.exists) {
        // --- CREACIÓN ---
        increments.total = FieldValue.increment(1);
        increments.pendientes = FieldValue.increment(1); // Nuevas tareas siempre están pendientes
        hasChanges = true;
    } else if (event.data.before.exists && !event.data.after.exists) {
        // --- ELIMINACIÓN ---
        increments.total = FieldValue.increment(-1);
        if (beforeData.status === 'pendiente') {
            increments.pendientes = FieldValue.increment(-1);
        } else if (beforeData.status === 'completada') {
            increments.completadas = FieldValue.increment(-1);
        }
        hasChanges = true;
    } else if (beforeData.status !== afterData.status) {
        // --- CAMBIO DE ESTADO (Completar/Reabrir) ---
        if (beforeData.status === 'pendiente') increments.pendientes = FieldValue.increment(-1);
        if (beforeData.status === 'completada') increments.completadas = FieldValue.increment(-1);

        if (afterData.status === 'pendiente') increments.pendientes = FieldValue.increment(1);
        if (afterData.status === 'completada') increments.completadas = FieldValue.increment(1);
        hasChanges = true;
    }

    if (!hasChanges) return null;

    try {
        console.log("Actualizando estadísticas de Tareas:", increments);
        return statsRef.set({ tasks: increments }, { merge: true });
    } catch (error) {
        console.error("Error al actualizar estadísticas de Tareas:", error.message);
        return null;
    }
});

// --- Función Callable (v2 - CORREGIDA Y AMPLIADA) ---
exports.runFullRecalculation = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'La función debe ser llamada por un usuario autenticado.');
    }

    console.log("Iniciando recálculo completo de TODOS los módulos...");

    // 1. Recalcular Proyectos (lógica existente)
    console.log("Recalculando progreso de proyectos...");
    const projectsSnapshot = await db.collection('projects').get();
    const projectPromises = [];
    projectsSnapshot.forEach(doc => {
        projectPromises.push(recalculateProjectProgress(doc.id));
    });

    // 2. Preparamos las promesas de los módulos del Dashboard
    const dashboardPromises = [
        migrateLegacySubItems(), // <-- AÑADIDO: Migra ítems antiguos
        recalculateToolStats(),
        recalculateDotacionStats(),
        recalculateProjectStats(),
        recalculateTaskStats(),
        recalculateInventoryValueStats(),
        recalculateProductivityStats()
    ];
    // 3. Ejecutamos todas las promesas en paralelo
    await Promise.all([
        ...projectPromises,
        ...dashboardPromises
    ]);

    console.log("Recálculo completo finalizado exitosamente.");
    return { message: `Recálculo completado para ${projectPromises.length} proyectos y todos los módulos del dashboard.` };
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
        const projectRef = db.doc(`projects/${data.projectId}`);
        const itemRef = projectRef.collection('items').doc();

        // --- INICIO DE MODIFICACIÓN ---
        // 1. Calculamos los m2 del ítem padre
        // data.width y data.height ya vienen en metros (ej: 1.50)
        const m2 = (data.width || 0) * (data.height || 0);
        // --- FIN DE MODIFICACIÓN ---

        const batch = db.batch();
        batch.set(itemRef, {
            ...data,
            ownerId: uid,
            createdAt: FieldValue.serverTimestamp(),
        });

        for (let i = 1; i <= data.quantity; i++) {
            const subItemRef = itemRef.collection('subItems').doc();

            // --- INICIO DE MODIFICACIÓN ---
            // 2. Añadimos el nuevo campo 'm2' al subItem
            batch.set(subItemRef, {
                itemId: itemRef.id,
                projectId: data.projectId,
                number: i,
                status: 'Pendiente de Fabricación',
                m2: m2, // <-- AÑADIDO: Guardamos los m2
                assignedTaskId: null, // <-- AÑADIDO: Inicializamos el campo de la tarea
                location: '',
                manufacturer: '',
                installer: '',
                installDate: '',
                photoURL: ''
            });
            // --- FIN DE MODIFICACIÓN ---
        }
        await batch.commit();

        console.log(`Successfully created item ${itemRef.id} with ${data.quantity} sub-items (each with ${m2} m2).`);
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

/**
 * Trigger que registra la actividad de la tarea Y
 * ACTUALIZA LAS ESTADÍSTICAS DE M² ASIGNADOS (Globales y de Empleado).
 */
exports.logTaskActivity = onDocumentWritten("tasks/{taskId}", async (event) => {
    const taskRef = event.data.after.ref;
    const logsToWrite = [];

    // --- Lógica de Estadísticas (NUEVO) ---
    const statsRefGlobal = db.doc("system/dashboardStats");
    let statsUpdateGlobal = {};
    let statsUpdateEmployee = {};

    try {
        if (!event.data.before.exists && event.data.after.exists) {
            // --- TAREA CREADA ---
            const afterData = event.data.after.data();
            const metrosAsignados = afterData.totalMetrosAsignados || 0;
            const assigneeId = afterData.assigneeId;

            if (metrosAsignados > 0 && assigneeId) {
                // 1. Preparar incremento Global
                statsUpdateGlobal = {
                    productivity: {
                        metrosAsignados: FieldValue.increment(metrosAsignados)
                    }
                };

                // 2. Preparar incremento de Empleado
                const today = new Date();
                const year = today.getFullYear();
                const month = String(today.getMonth() + 1).padStart(2, '0');
                const statDocId = `${year}_${month}`;
                const statsRefEmployee = db.doc(`employeeStats/${assigneeId}/monthlyStats/${statDocId}`);

                statsUpdateEmployee = {
                    metrosAsignados: FieldValue.increment(metrosAsignados),
                    // Aseguramos que los otros campos existan
                    metrosCompletados: FieldValue.increment(0),
                    metrosEnTiempo: FieldValue.increment(0),
                    metrosFueraDeTiempo: FieldValue.increment(0)
                };

                // 3. Escribir en batch
                const statsBatch = db.batch();
                statsBatch.set(statsRefGlobal, statsUpdateGlobal, { merge: true });
                statsBatch.set(statsRefEmployee, statsUpdateEmployee, { merge: true });
                await statsBatch.commit();
                console.log(`Estadísticas de M² Asignados actualizadas para Global y Empleado ${assigneeId}`);
            }

        } else if (event.data.before.exists && !event.data.after.exists) {
            // --- TAREA ELIMINADA ---
            const beforeData = event.data.before.data();
            const metrosAsignados = beforeData.totalMetrosAsignados || 0;
            const assigneeId = beforeData.assigneeId;

            if (metrosAsignados > 0 && assigneeId) {
                // 1. Preparar decremento Global
                statsUpdateGlobal = {
                    productivity: {
                        metrosAsignados: FieldValue.increment(-metrosAsignados)
                    }
                };

                // 2. Preparar decremento de Empleado (del mes en que se creó)
                const createdAt = beforeData.createdAt.toDate(); // 'createdAt' es un Timestamp
                const year = createdAt.getFullYear();
                const month = String(createdAt.getMonth() + 1).padStart(2, '0');
                const statDocId = `${year}_${month}`;
                const statsRefEmployee = db.doc(`employeeStats/${assigneeId}/monthlyStats/${statDocId}`);

                statsUpdateEmployee = {
                    metrosAsignados: FieldValue.increment(-metrosAsignados)
                };

                // 3. Escribir en batch
                const statsBatch = db.batch();
                statsBatch.set(statsRefGlobal, statsUpdateGlobal, { merge: true });
                statsBatch.set(statsRefEmployee, statsUpdateEmployee, { merge: true });
                await statsBatch.commit();
                console.log(`Estadísticas de M² Asignados revertidas para Global y Empleado ${assigneeId}`);
            }
        }

        // --- Lógica de Bitácora (Existente, sin cambios) ---
        const beforeData = event.data.before.data() || {};
        const afterData = event.data.after.data() || {};

        if (beforeData.status !== afterData.status) {
            if (afterData.status === 'completada') {
                const userName = await getUserName(afterData.completedBy);
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
                    createdAt: FieldValue.serverTimestamp()
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




/**
 * Trigger que actualiza las estadísticas del dashboard (en system/dashboardStats)
 * cada vez que una herramienta se crea, elimina o cambia de estado.
 * (VERSIÓN CORREGIDA CON OBJETO ANIDADO Y LÓGICA DE TOTAL)
 */
exports.updateToolStats = onDocumentWritten("tools/{toolId}", async (event) => {
    const statsRef = db.doc("system/dashboardStats");

    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    // 1. Objeto para los incrementos.
    // Usamos FieldValue.increment() para operaciones atómicas.
    const increments = {
        total: FieldValue.increment(0),
        disponible: FieldValue.increment(0),
        asignada: FieldValue.increment(0),
        en_reparacion: FieldValue.increment(0),
        dada_de_baja: FieldValue.increment(0)
    };

    let hasChanges = false;

    if (!event.data.before.exists && event.data.after.exists) {
        // --- CREACIÓN ---
        increments.total = FieldValue.increment(1); // Suma 1 al total
        if (afterData.status) {
            increments[afterData.status] = FieldValue.increment(1);
        } else {
            increments.disponible = FieldValue.increment(1); // Fallback
        }
        hasChanges = true;

    } else if (event.data.before.exists && !event.data.after.exists) {
        // --- ELIMINACIÓN ---
        increments.total = FieldValue.increment(-1); // Resta 1 del total
        if (beforeData.status) {
            increments[beforeData.status] = FieldValue.increment(-1);
        }
        hasChanges = true;

    } else if (beforeData.status !== afterData.status) {
        // --- CAMBIO DE ESTADO ---
        // El total NO cambia, solo los estados.
        if (beforeData.status) {
            increments[beforeData.status] = FieldValue.increment(-1);
        }
        if (afterData.status) {
            increments[afterData.status] = FieldValue.increment(1);
        }
        hasChanges = true;
    }

    // Si no hubo cambios relevantes, no escribimos en la DB.
    if (!hasChanges) {
        return null;
    }

    // 2. Preparamos el objeto anidado (EL ARREGLO)
    // Esto asegura que se escriba como un mapa: { tools: { ... } }
    const updateData = {
        tools: increments
    };

    try {
        // Usamos JSON.stringify para que el log muestre la estructura
        console.log("INTENTANDO escribir en Firestore con datos (estructura anidada):", JSON.stringify(updateData));

        // 3. Usamos .set() con merge:true para crear/actualizar el objeto 'tools' anidado
        await statsRef.set(updateData, { merge: true });

        console.log("¡ÉXITO! Documento 'system/dashboardStats' actualizado (estructura anidada).");
        return null;

    } catch (error) {
        console.error("¡ERROR CRÍTICO AL ESCRIBIR EN FIRESTORE (estructura anidada)!", error.message, error.code);
        return null;
    }
});

/**
 * Trigger que actualiza las estadísticas de Dotación (Stock y Tipos)
 * cuando se modifica el catálogo 'dotacionCatalog'.
 */
exports.updateDotacionCatalogStats = onDocumentWritten("dotacionCatalog/{itemId}", async (event) => {
    const statsRef = db.doc("system/dashboardStats");

    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    // Objeto anidado para los incrementos
    const increments = {
        totalTipos: FieldValue.increment(0),
        totalStock: FieldValue.increment(0)
    };
    let hasChanges = false;

    if (!event.data.before.exists && event.data.after.exists) {
        // --- CREACIÓN ---
        increments.totalTipos = FieldValue.increment(1);
        increments.totalStock = FieldValue.increment(afterData.quantityInStock || 0);
        hasChanges = true;

    } else if (event.data.before.exists && !event.data.after.exists) {
        // --- ELIMINACIÓN ---
        increments.totalTipos = FieldValue.increment(-1);
        increments.totalStock = FieldValue.increment(-(beforeData.quantityInStock || 0));
        hasChanges = true;

    } else if (beforeData.quantityInStock !== afterData.quantityInStock) {
        // --- ACTUALIZACIÓN DE STOCK ---
        const diff = (afterData.quantityInStock || 0) - (beforeData.quantityInStock || 0);
        if (diff !== 0) {
            increments.totalStock = FieldValue.increment(diff);
            hasChanges = true;
        }
    }

    if (!hasChanges) return null;

    try {
        console.log("Actualizando estadísticas de Dotación (Catálogo):", increments);
        // Usamos la estructura anidada { dotacion: ... }
        return statsRef.set({ dotacion: increments }, { merge: true });
    } catch (error) {
        console.error("Error al actualizar estadísticas de Dotación (Catálogo):", error.message);
        return null;
    }
});

/**
 * Trigger que actualiza las estadísticas de Dotación (Asignado)
 * cuando se crea o modifica el historial 'dotacionHistory'.
 */
exports.updateDotacionHistoryStats = onDocumentWritten("dotacionHistory/{historyId}", async (event) => {
    const statsRef = db.doc("system/dashboardStats");

    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();
    let increment = 0;

    // Solo nos importa si la acción es 'asignada' y el estado es 'activo'
    const isAsignadaBefore = beforeData && beforeData.action === 'asignada' && beforeData.status === 'activo';
    const isAsignadaAfter = afterData && afterData.action === 'asignada' && afterData.status === 'activo';

    // Cantidad (asegurándonos que sea un número)
    const qtyBefore = (beforeData && beforeData.quantity) ? parseInt(beforeData.quantity, 10) : 0;
    const qtyAfter = (afterData && afterData.quantity) ? parseInt(afterData.quantity, 10) : 0;

    if (!isAsignadaBefore && isAsignadaAfter) {
        // --- CREACIÓN O ACTIVACIÓN ---
        // Se asignó un nuevo ítem activo
        increment = qtyAfter;
    } else if (isAsignadaBefore && !isAsignadaAfter) {
        // --- DEVOLUCIÓN O ELIMINACIÓN ---
        // Un ítem que estaba activo se devolvió o eliminó
        increment = -qtyBefore;
    } else {
        // No hubo cambio en el estado 'activo'
        return null;
    }

    if (increment === 0) return null;

    try {
        const updateData = {
            dotacion: {
                totalAsignado: FieldValue.increment(increment)
            }
        };
        console.log("Actualizando estadísticas de Dotación (Asignado):", updateData);
        return statsRef.set(updateData, { merge: true });
    } catch (error) {
        console.error("Error al actualizar estadísticas de Dotación (Asignado):", error.message);
        return null;
    }
});