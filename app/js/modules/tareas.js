// js/tareas.js
import { collection, query, where, orderBy, onSnapshot, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp, documentId, writeBatch, increment, collectionGroup, setDoc, arrayRemove, arrayUnion } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { functions, httpsCallable } from "../core/firebase-config.js";

let db, storage, deps;

// Mapas globales expuestos por app.js en el objeto window
const materialStatusListeners = window.materialStatusListeners;
const taskCommentListeners = window.taskCommentListeners;

/**
 * Inicializa el módulo de tareas inyectando las dependencias de Firebase y globales
 */
export function initTareas(firestoreDb, firestoreStorage, dependencies) {
    db = firestoreDb;
    storage = firestoreStorage;
    deps = dependencies; 
    // deps contiene: showView, closeMainModal, openConfirmModal, getCurrentUser, getCurrentProject, getUsersMap, loadTasksView (opcional)

    // Inicializar listeners fijos para los modales de progreso
    setupProgressListeners();

    // Registrar globalmente funciones de cerrar para evitar problemas con handlers de eventos inline
    window.closeMultipleProgressModal = closeMultipleProgressModal;
    window.closeProgressModal = closeProgressModal;
}

// ============================================================================
// 1. MODAL: CREAR NUEVA TAREA
// ============================================================================
export async function openNewTaskModal() {
    const mainModal = document.getElementById('main-modal');
    const defaultTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalForm = document.getElementById('modal-form');
    const modalContentDiv = document.getElementById('main-modal-content');

    if (defaultTitle && defaultTitle.parentElement) {
        defaultTitle.parentElement.style.display = 'none';
    }

    const title = 'Crear Nueva Tarea';
    const btnText = 'Guardar Tarea';
    const btnClass = 'bg-gradient-to-r from-green-600 to-emerald-700 hover:from-green-700 hover:to-emerald-800 text-white shadow-lg transform hover:-translate-y-0.5 transition-all';
    
    modalContentDiv.classList.add('max-w-6xl');
    
    modalBody.innerHTML = '<div class="text-center py-10"><div class="loader mx-auto mb-2"></div><p class="text-gray-500">Cargando formulario...</p></div>';
    mainModal.style.display = 'flex';

    let projectChoicesInstance = null;
    let assigneeChoicesInstance = null;
    let additionalChoicesInstance = null;

    let activeProjects = [];
    let allActiveUsers = [];

    // ============================================================
    // 2. OBTENER DATOS (PROYECTOS Y USUARIOS DESDE FIREBASE)
    // ============================================================
    try {
        // --- 1. Descargamos Proyectos ---
        const projectsQuery = query(collection(db, "projects"), where("status", "==", "active"), orderBy("name"));
        const projectsSnapshot = await getDocs(projectsQuery);
        activeProjects = projectsSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name }));

        // --- 2. Descargamos Usuarios Directamente (SOLUCIÓN AL ERROR) ---
        const usersQuery = query(collection(db, "users"), where("status", "==", "active"));
        const usersSnapshot = await getDocs(usersQuery);
        
        usersSnapshot.forEach(doc => {
            const user = doc.data();
            allActiveUsers.push({ id: doc.id, name: `${user.firstName} ${user.lastName}` });
        });
        allActiveUsers.sort((a, b) => a.name.localeCompare(b.name));

    } catch (error) {
        console.error("Error cargando datos:", error);
        if(window.closeMainModal) window.closeMainModal();
        alert("Error de conexión al cargar datos.");
        return;
    }

    const bodyHtml = `
        <div class="flex flex-col h-full max-h-[80vh]">
            <div class="-mx-6 -mt-6 mb-6 bg-gradient-to-r from-indigo-600 to-blue-700 px-8 py-4 rounded-t-lg text-white shadow-md flex justify-between items-center">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-xl backdrop-blur-sm"><i class="fa-solid fa-file-circle-plus"></i></div>
                    <h2 class="text-xl font-bold tracking-tight">Nueva Tarea</h2>
                </div>
                <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white p-2"><i class="fa-solid fa-xmark text-xl"></i></button>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-grow overflow-y-auto custom-scrollbar p-1 pb-10"> 
                <div class="space-y-6">
                    <div class="bg-white p-5 rounded-xl border border-blue-200 shadow-sm">
                        <h4 class="text-sm font-bold text-blue-800 mb-3">1. Seleccionar Proyecto</h4>
                        <div class="relative z-50"> 
                            <select id="task-project-choices" name="projectId" required class="w-full"></select>
                            <input type="hidden" name="projectName">
                        </div>
                    </div>

                    <div id="task-items-selection" class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hidden relative z-10">
                        <h4 class="text-sm font-bold text-gray-700 mb-3">2. Seleccionar Ítems</h4>
                        <div id="task-items-list" class="max-h-80 overflow-y-auto space-y-1 pr-1 custom-scrollbar bg-slate-50 p-2 rounded border border-gray-100"></div>
                    </div>
                </div>

                <div class="space-y-6">
                    <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                        <h4 class="text-sm font-bold text-gray-700 mb-2">3. Asignación</h4>
                        
                        <div class="relative z-50"> 
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Responsable Principal</label>
                            <select id="task-assignee-choices" name="assigneeId" required></select>
                            <input type="hidden" name="assigneeName">
                        </div>

                        <div class="relative z-40"> 
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Personal de Apoyo (Múltiple)</label>
                            <select id="task-additional-assignees-choices" name="additionalAssigneeIds" multiple class="w-full"></select>
                            <p class="text-[10px] text-gray-400 mt-1">Selecciona a todos los colaboradores necesarios.</p>
                        </div>
                    </div>
                    
                    <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4 relative z-10">
                        <h4 class="text-sm font-bold text-gray-700 mb-2">4. Detalles</h4>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Descripción</label>
                            <textarea id="task-description" name="description" rows="3" required class="w-full border rounded-lg p-2 text-sm resize-none"></textarea>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Límite</label>
                            <input type="date" id="task-dueDate" name="dueDate" class="w-full border rounded-lg p-2 text-sm">
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    modalBody.innerHTML = bodyHtml;
    if(defaultTitle) defaultTitle.textContent = title;

    const oldConfirmBtn = document.getElementById('modal-confirm-btn');
    const confirmBtn = oldConfirmBtn.cloneNode(true); 
    oldConfirmBtn.parentNode.replaceChild(confirmBtn, oldConfirmBtn);
    
    confirmBtn.textContent = btnText;
    confirmBtn.className = `text-white font-bold py-2 px-4 rounded-lg transition-all ${btnClass}`;
    confirmBtn.style.display = 'block';
    confirmBtn.disabled = false;
    delete confirmBtn.dataset.isProcessing; 

    setTimeout(() => {
        const projectEl = document.getElementById('task-project-choices');
        const assigneeEl = document.getElementById('task-assignee-choices');
        const additionalEl = document.getElementById('task-additional-assignees-choices');

        projectChoicesInstance = new Choices(projectEl, { choices: activeProjects.map(p => ({ value: p.id, label: p.name })), searchPlaceholderValue: "Buscar...", itemSelectText: '', allowHTML: false });
        assigneeChoicesInstance = new Choices(assigneeEl, { choices: allActiveUsers.map(u => ({ value: u.id, label: u.name })), searchPlaceholderValue: "Buscar...", itemSelectText: '', allowHTML: false });

        additionalChoicesInstance = new Choices(additionalEl, { 
            choices: allActiveUsers.map(u => ({ value: u.id, label: u.name })),
            removeItemButton: true,
            searchPlaceholderValue: "Escribe para buscar...",
            placeholderValue: "Seleccionar colaboradores...",
            allowHTML: false,
            shouldSort: false
        });

        projectEl.addEventListener('change', async (event) => {
            const pid = event.detail.value;
            const itemsList = document.getElementById('task-items-list');
            const itemsDiv = document.getElementById('task-items-selection');
            const pName = modalForm.querySelector('input[name="projectName"]');
            
            const proj = activeProjects.find(p => p.id === pid);
            if (pName && proj) pName.value = proj.name;

            if (pid) {
                itemsDiv.classList.remove('hidden');
                itemsList.innerHTML = '<div class="text-center py-2"><div class="loader"></div></div>';
                
                try {
                    const snap = await getDocs(query(collection(db, "projects", pid, "items"), orderBy("name")));
                    if (snap.empty) itemsList.innerHTML = '<p class="text-center text-xs text-gray-400">Sin ítems.</p>';
                    else {
                        itemsList.innerHTML = '';
                        snap.forEach(doc => {
                            const i = {id: doc.id, ...doc.data()};
                            itemsList.innerHTML += `
                                <div class="task-item-row flex items-center justify-between py-2 border-b border-gray-100 px-2 hover:bg-blue-50 transition-colors">
                                    <label class="flex items-center gap-2 cursor-pointer flex-grow"> 
                                        <input type="checkbox" name="selectedItemIds" value="${i.id}" data-item-quantity="${i.quantity}" class="item-checkbox rounded text-blue-600 focus:ring-blue-500">
                                        <div class="flex flex-col">
                                            <span class="text-sm font-bold text-gray-700">${i.name}</span>
                                            ${i.blueprintURL ? `<span class="text-[10px] text-blue-500"><i class="fa-solid fa-file-contract"></i> Plano disponible</span>` : ''}
                                        </div>
                                    </label>
                                    <input type="number" name="itemQuantity_${i.id}" min="1" max="${i.quantity}" placeholder="Max: ${i.quantity}" class="item-quantity-input w-20 border rounded p-1 text-xs text-center" disabled>
                                </div>`;
                        });
                        itemsList.querySelectorAll('.item-checkbox').forEach(chk => {
                            chk.addEventListener('change', (e) => {
                                const inp = e.target.closest('.task-item-row').querySelector('.item-quantity-input');
                                inp.disabled = !e.target.checked;
                                if(!e.target.checked) inp.value = ''; else inp.focus();
                            });
                        });
                    }
                } catch (e) { console.error(e); }
            } else { itemsDiv.classList.add('hidden'); }
        });

        assigneeEl.addEventListener('change', (e) => {
            const u = allActiveUsers.find(us => us.id === e.detail.value);
            if (u) modalForm.querySelector('input[name="assigneeName"]').value = u.name;
        });

        const dInp = modalBody.querySelector('#task-dueDate');
        if(dInp) dInp.min = new Date().toISOString().split("T")[0];

        mainModal.addEventListener('close', () => {
            if(projectChoicesInstance) projectChoicesInstance.destroy();
            if(assigneeChoicesInstance) assigneeChoicesInstance.destroy();
            if(additionalChoicesInstance) additionalChoicesInstance.destroy();
            modalContentDiv.classList.remove('max-w-6xl');
        }, { once: true });

    }, 100);

    confirmBtn.addEventListener('click', async () => {
        if (confirmBtn.dataset.isProcessing === 'true') return;
        
        confirmBtn.dataset.isProcessing = 'true';
        confirmBtn.disabled = true;
        const originalText = confirmBtn.textContent;
        confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

        try {
            const formData = new FormData(modalForm);
            const taskData = Object.fromEntries(formData.entries());

            const rawSelect = document.getElementById('task-additional-assignees-choices');
            let selectedIds = [];
            if (rawSelect) selectedIds = Array.from(rawSelect.selectedOptions).map(option => option.value);

            taskData.additionalAssigneeIds = selectedIds;
            
            await createTask(taskData); 

        } catch (error) {
            console.error("Error en botón guardar:", error);
            confirmBtn.disabled = false;
            confirmBtn.textContent = originalText;
            delete confirmBtn.dataset.isProcessing;
        }
    });
}

async function createTask(taskData) {
    const currentUser = deps.getCurrentUser();
    const loadingOverlay = document.getElementById('loading-overlay');
    const modalForm = document.getElementById('modal-form');

    // 1. Validaciones básicas
    if (!taskData.projectId || !taskData.assigneeId || !taskData.description) {
        alert("Por favor, completa Proyecto, Asignado Principal y Descripción.");
        return;
    }

    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    // =========================================================================
    // 2. LÓGICA DE USUARIOS (FILTRO DE DUPLICADOS)
    // =========================================================================
    let rawAdditional = taskData.additionalAssigneeIds;
    if (!rawAdditional) rawAdditional = [];
    else if (!Array.isArray(rawAdditional)) rawAdditional = [rawAdditional];

    const uniqueAdditionalSet = new Set(rawAdditional);
    if (uniqueAdditionalSet.has(taskData.assigneeId)) {
        uniqueAdditionalSet.delete(taskData.assigneeId);
    }
    const finalAdditionalAssignees = Array.from(uniqueAdditionalSet);
    // =========================================================================

    // Variables para el proceso de ítems
    const selectedItemsQueryData = [];
    const specificSubItemIds = [];
    const selectedItemsForTask = [];
    let totalMetrosAsignados = 0;
    const batchSubItemUpdates = writeBatch(db);
    let subItemsToStamp = [];

    try {
        // 3. VERIFICAR SI HAY ÍTEMS SELECCIONADOS
        const itemCheckboxes = modalForm.querySelectorAll('input[name="selectedItemIds"]:checked');
        
        if (itemCheckboxes.length > 0) {
            // A. Validar cantidades
            for (const checkbox of itemCheckboxes) {
                const itemId = checkbox.value;
                const quantityInput = modalForm.querySelector(`input[name="itemQuantity_${itemId}"]`);
                const quantity = parseInt(quantityInput?.value);
                const maxQuantity = parseInt(checkbox.dataset.itemQuantity) || 1;

                // Obtener nombre seguro
                const row = checkbox.closest('.task-item-row');
                let nameEl = row ? row.querySelector('.font-bold') : null;
                let itemName = nameEl ? nameEl.textContent : "Ítem";
                itemName = itemName.replace('Plano', '').trim();

                if (!quantity || quantity <= 0) throw new Error(`Cantidad inválida para "${itemName}".`);
                if (quantity > maxQuantity) throw new Error(`Exceso de cantidad para "${itemName}".`);

                selectedItemsQueryData.push({
                    itemId: itemId,
                    quantityNeeded: quantity,
                    itemName: itemName
                });
            }

            // B. Buscar Sub-ítems disponibles
            for (const itemQuery of selectedItemsQueryData) {
                const subItemsQuery = query(
                    collection(db, "projects", taskData.projectId, "items", itemQuery.itemId, "subItems"),
                    orderBy("number", "asc")
                );

                const subItemsSnapshot = await getDocs(subItemsQuery);
                let assignedCount = 0;

                for (const subItemDoc of subItemsSnapshot.docs) {
                    if (assignedCount >= itemQuery.quantityNeeded) break;
                    const data = subItemDoc.data();

                    if (data.status !== 'Instalado' && !data.assignedTaskId) {
                        specificSubItemIds.push(subItemDoc.id);
                        totalMetrosAsignados += (data.m2 || 0);
                        subItemsToStamp.push(subItemDoc.ref);
                        assignedCount++;
                    }
                }

                if (assignedCount < itemQuery.quantityNeeded) {
                    throw new Error(`No hay suficientes unidades disponibles para "${itemQuery.itemName}".`);
                }

                selectedItemsForTask.push({
                    itemId: itemQuery.itemId,
                    quantity: itemQuery.quantityNeeded,
                    itemName: itemQuery.itemName
                });
            }
        } else {
            console.log("Creando tarea general (sin ítems asociados).");
        }

        // 4. Guardar la Tarea Principal
        const newTaskRef = await addDoc(collection(db, "tasks"), {
            projectId: taskData.projectId,
            projectName: taskData.projectName,
            assigneeId: taskData.assigneeId,
            assigneeName: taskData.assigneeName,
            additionalAssigneeIds: finalAdditionalAssignees,
            selectedItems: selectedItemsForTask,
            specificSubItemIds: specificSubItemIds,
            description: taskData.description,
            dueDate: taskData.dueDate || null,
            status: 'pendiente',
            createdAt: new Date(),
            createdBy: currentUser.uid,
            totalMetrosAsignados: totalMetrosAsignados
        });

        console.log("Tarea creada con éxito. ID:", newTaskRef.id);

        // 5. Actualizar Sub-ítems (Solo si hubo ítems que estampar)
        if (subItemsToStamp.length > 0) {
            subItemsToStamp.forEach(subItemRef => {
                batchSubItemUpdates.update(subItemRef, { assignedTaskId: newTaskRef.id });
            });
            await batchSubItemUpdates.commit();
        }

        // 6. Actualizar Estadísticas (Solo si hay metros > 0)
        if (totalMetrosAsignados > 0) {
            try {
                const today = new Date();
                const statDocId = `${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}`;
                const statsRef = doc(db, "employeeStats", taskData.assigneeId, "monthlyStats", statDocId);
                await setDoc(statsRef, {
                    metrosAsignados: increment(totalMetrosAsignados),
                    metrosCompletados: increment(0)
                }, { merge: true });
            } catch (statsError) {
                console.warn("Error actualizando estadísticas:", statsError);
            }
        }

        // 7. Enviar Notificaciones
        const notificationData = {
            message: `Nueva tarea: ${taskData.description.substring(0, 30)}...`,
            projectName: taskData.projectName || "Proyecto",
            taskId: newTaskRef.id,
            read: false,
            createdAt: new Date(),
            type: 'new_task_assignment'
        };

        const usersToNotify = new Set(finalAdditionalAssignees);
        if (taskData.assigneeId !== currentUser.uid) usersToNotify.add(taskData.assigneeId);

        for (const userId of usersToNotify) {
            if (userId === currentUser.uid) continue;
            try {
                await addDoc(collection(db, "notifications"), { ...notificationData, userId: userId });
            } catch (e) { console.warn("Error notificando:", e); }
        }

        if (window.closeMainModal) {
            window.closeMainModal();
        } else if (deps.closeMainModal) {
            deps.closeMainModal();
        }

        if (window.showToast) {
            window.showToast("Tarea registrada correctamente.");
        } else {
            alert("Tarea registrada correctamente.");
        }

    } catch (error) {
        console.error("Error al crear tarea:", error);
        alert(`Error: ${error.message}`);
        
        const confirmBtn = document.getElementById('modal-confirm-btn');
        if(confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = 'Guardar Tarea';
            confirmBtn.dataset.isProcessing = 'false';
        }
    } finally {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }
}

// ============================================================================
// 2. MODAL: EDITAR TAREA
// ============================================================================
export async function openEditTaskModal(taskIdOrData) {
    const mainModal = document.getElementById('main-modal');
    const defaultTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalForm = document.getElementById('modal-form');
    const modalContentDiv = document.getElementById('main-modal-content');

    const taskId = typeof taskIdOrData === 'object' ? taskIdOrData.id : taskIdOrData;

    if (!taskId) {
        console.error("No se recibió un ID válido para editar la tarea.");
        return;
    }

    if (defaultTitle && defaultTitle.parentElement) {
        defaultTitle.parentElement.style.display = 'none';
    }

    const title = 'Editar Tarea';
    const btnText = 'Guardar Cambios';
    const btnClass = 'bg-yellow-500 hover:bg-yellow-600 shadow-lg transition-all';
    
    modalContentDiv.classList.add('max-w-6xl');

    modalBody.innerHTML = '<div class="text-center py-5"><div class="loader mx-auto"></div> Cargando datos de la tarea...</div>';
    mainModal.style.display = 'flex';

    modalForm.dataset.type = 'edit-task';
    modalForm.dataset.id = taskId;

    // ============================================================
    // 2. OBTENER DATOS (USUARIOS Y TAREA DESDE FIREBASE)
    // ============================================================
    let data = {};
    let allActiveUsers = [];

    try {
        // --- 1. Descargamos Usuarios Directamente (SOLUCIÓN AL ERROR) ---
        const usersQuery = query(collection(db, "users"), where("status", "==", "active"));
        const usersSnapshot = await getDocs(usersQuery);
        
        usersSnapshot.forEach(doc => {
            const user = doc.data();
            allActiveUsers.push({ id: doc.id, name: `${user.firstName} ${user.lastName}` });
        });
        allActiveUsers.sort((a, b) => a.name.localeCompare(b.name));

        // --- 2. Descargamos los datos de la tarea ---
        const taskSnap = await getDoc(doc(db, "tasks", taskId));
        if (!taskSnap.exists()) throw new Error("La tarea no existe.");
        data = taskSnap.data();

    } catch (error) {
        console.error("Error cargando tarea/usuarios:", error);
        if(window.closeMainModal) window.closeMainModal();
        alert("Error al cargar los datos.");
        return;
    }

    const bodyHtml = `
        <div class="flex flex-col h-full max-h-[80vh]">
            
            <div class="-mx-6 -mt-6 mb-6 bg-gradient-to-r from-yellow-500 to-amber-600 px-8 py-4 rounded-t-lg text-white shadow-md flex justify-between items-center">
                 <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-xl backdrop-blur-sm"><i class="fa-solid fa-pen-to-square"></i></div>
                    <h2 class="text-xl font-bold tracking-tight">Editar Tarea Operativa</h2>
                </div>
                <div class="flex gap-4 items-center">
                    <span class="text-xs font-mono bg-white/20 px-2 py-0.5 rounded">ID: ${taskId.substring(0, 6).toUpperCase()}</span>
                    <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white p-2"><i class="fa-solid fa-xmark text-xl"></i></button>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 flex-grow overflow-y-auto custom-scrollbar p-1">

                <div class="space-y-6">
                    
                    <div class="bg-gray-100 p-5 rounded-xl border border-gray-300 shadow-inner">
                        <h4 class="text-md font-extrabold text-gray-700 mb-3 border-b border-gray-300 pb-2 flex items-center">
                            <i class="fa-solid fa-city mr-2 text-gray-500"></i> Proyecto Asignado
                        </h4>
                        <div>
                            <label for="task-project-choices" class="block text-xs font-bold text-gray-500 uppercase mb-1">Proyecto (No editable)</label>
                            <select id="task-project-choices" name="projectId" class="w-full" disabled placeholder="Cargando proyecto..."></select>
                            <input type="hidden" name="projectName" value="${data.projectName || ''}"> 
                        </div>
                    </div>

                    <div id="task-items-selection" class="bg-white p-5 rounded-xl border border-gray-200 shadow-md">
                        <h4 class="text-md font-extrabold text-gray-700 mb-3 border-b border-gray-200 pb-2 flex items-center">
                            <i class="fa-solid fa-layer-group mr-2 text-orange-500"></i> Ítems Relacionados
                        </h4>
                        <div id="task-items-list" class="max-h-64 overflow-y-auto space-y-2 text-sm pr-2 custom-scrollbar">
                            <p class="text-gray-400 italic text-center py-4">Cargando ítems...</p>
                        </div>
                        <p class="text-xs text-red-500 mt-3"><i class="fa-solid fa-info-circle mr-1"></i> Los ítems de una tarea en curso no pueden modificarse.</p>
                    </div>
                </div>

                <div class="space-y-6">

                    <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-md space-y-4">
                        <h4 class="text-md font-extrabold text-gray-700 mb-3 border-b border-gray-200 pb-2 flex items-center">
                            <i class="fa-solid fa-user-tag mr-2 text-green-500"></i> 1. Responsables
                        </h4>
                        
                        <div>
                            <label for="task-assignee-choices" class="block text-xs font-bold text-gray-500 uppercase mb-1">Asignar A (Principal)</label>
                            <select id="task-assignee-choices" name="assigneeId" required></select>
                            <input type="hidden" name="assigneeName" value="${data.assigneeName || ''}">
                        </div>
                        
                        <div>
                            <label for="task-additional-assignees-choices" class="block text-xs font-bold text-gray-500 uppercase mb-1">Personas Adicionales</label>
                            <select id="task-additional-assignees-choices" name="additionalAssigneeIds" multiple></select>
                        </div>
                    </div>
                    
                    <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-md space-y-4">
                        <h4 class="text-md font-extrabold text-gray-700 mb-3 border-b border-gray-200 pb-2 flex items-center">
                            <i class="fa-solid fa-clipboard-list mr-2 text-indigo-500"></i> 2. Descripción y Plazo
                        </h4>
                        
                        <div>
                            <label for="task-description" class="block text-xs font-bold text-gray-500 uppercase mb-1">Descripción de la Tarea</label>
                            <textarea id="task-description" name="description" rows="3" required class="w-full border rounded-lg p-2 text-sm resize-none">${data.description || ''}</textarea>
                        </div>
                        
                        <div>
                            <label for="task-dueDate" class="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Límite</label>
                            <input type="date" id="task-dueDate" name="dueDate" class="w-full border rounded-lg p-2 text-sm" value="${data.dueDate || ''}">
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    modalBody.innerHTML = bodyHtml;
    
    const oldConfirmBtn = document.getElementById('modal-confirm-btn');
    const confirmBtn = oldConfirmBtn.cloneNode(true);
    oldConfirmBtn.parentNode.replaceChild(confirmBtn, oldConfirmBtn);
    
    confirmBtn.textContent = btnText;
    confirmBtn.className = `text-white font-bold py-2 px-4 rounded-lg transition-all ${btnClass}`;
    confirmBtn.style.display = 'block';
    confirmBtn.disabled = false;
    delete confirmBtn.dataset.isProcessing;

    setTimeout(() => {
        const projectElement = document.getElementById('task-project-choices');
        const projectChoices = new Choices(projectElement, {
            choices: [{ value: data.projectId, label: data.projectName || 'Cargando...' }],
            itemSelectText: '', allowHTML: false,
        });
        projectChoices.setValue([{ value: data.projectId, label: data.projectName || 'Proyecto' }]);
        projectChoices.disable();

// ============================================================
        // A. RESPONSABLE PRINCIPAL (Selección automática desde el inicio)
        // ============================================================
        const assigneeElement = document.getElementById('task-assignee-choices');
        const assigneeChoices = new Choices(assigneeElement, {
            choices: allActiveUsers.map(u => ({ 
                value: u.id, 
                label: u.name,
                selected: u.id === data.assigneeId // <-- AQUÍ ESTÁ LA MAGIA: Lo selecciona si coincide el ID
            })),
            searchPlaceholderValue: "Buscar usuario...", 
            itemSelectText: 'Seleccionar', 
            allowHTML: false,
        });
        
        // Listener para actualizar el nombre oculto si cambian al responsable
        assigneeElement.addEventListener('change', (event) => {
            const selectedAssigneeId = event.detail.value;
            const assigneeNameInput = modalForm.querySelector('input[name="assigneeName"]');
            const selectedUser = allActiveUsers.find(u => u.id === selectedAssigneeId);
            if (assigneeNameInput) assigneeNameInput.value = selectedUser ? selectedUser.name : '';
        });

        // ============================================================
        // B. PERSONAL DE APOYO (Selección múltiple automática)
        // ============================================================
        const additionalAssigneesElement = document.getElementById('task-additional-assignees-choices');
        const additionalAssigneesChoices = new Choices(additionalAssigneesElement, {
            choices: allActiveUsers.map(u => ({ 
                value: u.id, 
                label: u.name,
                // Comprueba si el array de IDs adicionales existe y si incluye este usuario
                selected: Array.isArray(data.additionalAssigneeIds) && data.additionalAssigneeIds.includes(u.id)
            })),
            removeItemButton: true, 
            searchPlaceholderValue: "Añadir más usuarios...", 
            allowHTML: false,
        });

        const itemsListDiv = document.getElementById('task-items-list');
        const itemsListUl = document.createElement('ul');
        itemsListUl.className = 'space-y-2';

        if (data.selectedItems && data.selectedItems.length > 0) {
            const itemDetailPromises = data.selectedItems.map(async itemInfo => {
                try {
                    const itemDoc = await getDoc(doc(db, "projects", data.projectId, "items", itemInfo.itemId));
                    const itemData = itemDoc.exists() ? itemDoc.data() : { name: `ID: ${itemInfo.itemId}`, blueprintURL: null };
                    
                    const planoBtn = itemData.blueprintURL ? `
                        <button type="button" onclick="viewDocument('${itemData.blueprintURL}', '${itemData.name}'); return false;" class="text-blue-500 hover:text-blue-700 ml-1 p-1 rounded-md text-xs border border-blue-200 bg-white shadow-sm">
                            <i class="fa-solid fa-file-contract"></i>
                        </button>` : '';

                    return `
                        <li class="flex items-center justify-between py-1 px-1 border-b border-gray-100 last:border-0">
                            <span class="font-medium text-gray-700">
                                <i class="fa-solid fa-check-square mr-2 text-green-500"></i>
                                ${itemData.name} (x${itemInfo.quantity})
                            </span>
                            <div class="flex items-center">
                                ${planoBtn}
                            </div>
                        </li>
                    `;
                } catch (e) {
                    return `<li class="text-red-500">Error cargando ítem</li>`;
                }
            });
            Promise.all(itemDetailPromises).then(htmlItems => {
                itemsListUl.innerHTML = htmlItems.join('');
                itemsListDiv.innerHTML = '';
                itemsListDiv.appendChild(itemsListUl);
            });
        } else {
            itemsListDiv.innerHTML = '<p class="italic text-gray-500 text-center py-4">No hay ítems asociados.</p>';
        }

        const dueDateInput = modalBody.querySelector('#task-dueDate');
        if (dueDateInput) dueDateInput.min = new Date().toISOString().split("T")[0];

        mainModal.addEventListener('close', () => {
            projectChoices.destroy(); 
            assigneeChoices.destroy(); 
            additionalAssigneesChoices.destroy();
            modalContentDiv.classList.remove('max-w-6xl');
        }, { once: true });

    }, 150);

    confirmBtn.addEventListener('click', async () => {
        if (confirmBtn.dataset.isProcessing === 'true') return;
        
        confirmBtn.dataset.isProcessing = 'true';
        confirmBtn.disabled = true;
        const originalText = confirmBtn.textContent;
        confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

        try {
            const formData = new FormData(modalForm);
            const newData = Object.fromEntries(formData.entries());

            const rawSelect = document.getElementById('task-additional-assignees-choices');
            let selectedIds = [];
            if (rawSelect) selectedIds = Array.from(rawSelect.selectedOptions).map(option => option.value);
            
            newData.additionalAssigneeIds = selectedIds;
            
            // Función original de tu código
            if(window.updateTask) {
                await window.updateTask(taskId, newData);
            } else {
                await updateTask(taskId, newData);
            }
            
        } catch (error) {
            console.error("Error en botón guardar edición:", error);
            confirmBtn.disabled = false;
            confirmBtn.textContent = originalText;
            delete confirmBtn.dataset.isProcessing;
        }
    });
}

// ============================================================================
// 3. REGISTRO DE AVANCE INDIVIDUAL
// ============================================================================
export async function openProgressModal(subItem) {
    const modal = document.getElementById('progress-modal');
    if (!modal) return;

    const form = modal.querySelector('#progress-modal-form');
    form.reset();
    form.dataset.id = subItem.id;
    form.dataset.itemid = subItem.itemId;

    modal.querySelector('#progress-modal-title').textContent = `Registrar Avance: Unidad N° ${subItem.number}`;
    modal.querySelector('#sub-item-location').value = subItem.location || '';
    modal.querySelector('#sub-item-real-width').value = (subItem.realWidth * 100) || ''; 
    modal.querySelector('#sub-item-real-height').value = (subItem.realHeight * 100) || ''; 
    modal.querySelector('#sub-item-date').value = subItem.installDate || new Date().toISOString().split('T')[0];

    const photoPreview = modal.querySelector('#photo-preview');
    if (subItem.photoURL) {
        photoPreview.innerHTML = `<a href="${subItem.photoURL}" target="_blank" class="text-blue-600 hover:underline text-sm">Ver foto actual</a>`;
    } else {
        photoPreview.innerHTML = '';
    }

    modal.style.display = 'flex';
}

function closeProgressModal() { 
    document.getElementById('progress-modal').style.display = 'none'; 
}

async function saveSingleProgress(e) {
    e.preventDefault();
    const form = document.getElementById('progress-modal-form');
    const confirmBtn = document.getElementById('progress-modal-confirm-btn');
    const feedbackP = document.getElementById('progress-feedback');
    
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Guardando...';
    feedbackP.textContent = '';
    feedbackP.className = 'text-sm mt-4 text-center text-blue-600';

    const subItemId = form.dataset.id;
    const itemId = form.dataset.itemid;
    const photoFile = document.getElementById('sub-item-photo').files[0];
    const location = document.getElementById('sub-item-location').value;
    const installDate = document.getElementById('sub-item-date').value;

    const currentProject = deps.getCurrentProject();
    if (!currentProject || !currentProject.id || !itemId) {
        feedbackP.textContent = "Error: Contexto de proyecto perdido.";
        feedbackP.className = 'text-sm mt-4 text-center text-red-600';
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Guardar Cambios';
        return;
    }

    try {
        const subItemRef = doc(db, "projects", currentProject.id, "items", itemId, "subItems", subItemId);
        const subItemSnap = await getDoc(subItemRef);
        const subItemData = subItemSnap.exists() ? subItemSnap.data() : {};

        const data = {
            location: location,
            realWidth: (parseFloat(document.getElementById('sub-item-real-width').value) / 100) || 0,
            realHeight: (parseFloat(document.getElementById('sub-item-real-height').value) / 100) || 0,
            installDate: installDate,
            installer: deps.getCurrentUser().uid,
            status: 'Instalado',
            m2: subItemData.m2 || 0,
            assignedTaskId: subItemData.assignedTaskId || null
        };

        if (photoFile) {
            feedbackP.textContent = 'Procesando foto...';
            const watermarkText = `Vidrios Exito - ${currentProject.name} - ${installDate} - ${location}`;
            const watermarkedBlob = await addWatermark(photoFile, watermarkText);

            const storageRef = ref(storage, `evidence/${currentProject.id}/${itemId}/${subItemId}`);
            const snapshot = await uploadBytes(storageRef, watermarkedBlob);
            data.photoURL = await getDownloadURL(snapshot.ref);
        }

        await updateDoc(subItemRef, data);
        closeProgressModal();

    } catch (error) {
        console.error(error);
        feedbackP.textContent = `Error: ${error.message}`;
        feedbackP.className = 'text-sm mt-4 text-center text-red-600';
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Guardar Cambios';
    }
}

// ============================================================================
// 4. REGISTRO DE AVANCE MÚLTIPLE (LOTE)
// ============================================================================
export async function openMultipleProgressModal(originatingTaskIdOrSubItemIds) {
    const modal = document.getElementById('multiple-progress-modal');
    const title = document.getElementById('multiple-progress-modal-title');
    const tableBody = document.getElementById('multiple-progress-table-body');
    const confirmBtn = document.getElementById('multiple-progress-modal-confirm-btn');

    if (!modal || !title || !tableBody || !confirmBtn) return;

    modal.style.display = 'flex';
    title.textContent = `Registrar Avance...`;
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Cargando datos...</td></tr>';

    try {
        document.getElementById('multiple-sub-item-date').value = new Date().toISOString().split('T')[0];
        
        // Reset group bulk fields
        const groupPhotoInput = document.getElementById('multiple-group-photo');
        if (groupPhotoInput) groupPhotoInput.value = '';
        const bulkLocInput = document.getElementById('bulk-location');
        if (bulkLocInput) bulkLocInput.value = '';
        const bulkWidthInput = document.getElementById('bulk-width');
        if (bulkWidthInput) bulkWidthInput.value = '';
        const bulkHeightInput = document.getElementById('bulk-height');
        if (bulkHeightInput) bulkHeightInput.value = '';

        let subItemIdsToShow = [];
        let taskItems = [];
        const currentProject = deps.getCurrentProject();

        if (Array.isArray(originatingTaskIdOrSubItemIds)) {
            confirmBtn.dataset.originatingTaskId = '';
            subItemIdsToShow = originatingTaskIdOrSubItemIds;
            if (!currentProject) {
                throw new Error("Contexto de proyecto incorrecto.");
            }
            if (!window.currentItem) {
                throw new Error("No se ha seleccionado ningún ítem.");
            }
            taskItems = [{
                itemId: window.currentItem.id,
                quantity: subItemIdsToShow.length
            }];
        } else {
            const originatingTaskId = originatingTaskIdOrSubItemIds;
            confirmBtn.dataset.originatingTaskId = originatingTaskId || '';
            const taskRef = doc(db, "tasks", originatingTaskId);
            const taskSnap = await getDoc(taskRef);
            if (!taskSnap.exists()) throw new Error(`La tarea no fue encontrada.`);
            
            const taskData = taskSnap.data();
            if(!currentProject || currentProject.id !== taskData.projectId) {
                 throw new Error(`Contexto de proyecto incorrecto. Cambia al proyecto correspondiente.`);
            }

            taskItems = taskData.selectedItems || [];
            subItemIdsToShow = taskData.specificSubItemIds || [];

            if (subItemIdsToShow.length === 0) {
                for (const selectedItem of taskItems) {
                    if (selectedItem.quantity <= 0) continue;
                    const subItemsQuery = query(
                        collection(db, "projects", currentProject.id, "items", selectedItem.itemId, "subItems"),
                        where("status", "!=", "Instalado"),
                        orderBy("number", "asc")
                    );
                    const subItemsSnapshot = await getDocs(subItemsQuery);
                    const pendingDocs = subItemsSnapshot.docs.slice(0, selectedItem.quantity);
                    pendingDocs.forEach(d => subItemIdsToShow.push(d.id));
                }
                if (subItemIdsToShow.length > 0) {
                    await updateDoc(taskRef, { specificSubItemIds: subItemIdsToShow });
                }
            }
        }

        title.textContent = `Registrar Avance...`;
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Cargando datos...</td></tr>';

        const subItemsData = [];
        const itemsMap = new Map();

        for (const item of taskItems) {
            if (!itemsMap.has(item.itemId)) {
                const itemDoc = await getDoc(doc(db, "projects", currentProject.id, "items", item.itemId));
                itemsMap.set(item.itemId, itemDoc.exists() ? itemDoc.data().name : `Ítem Desconocido`);
            }

            for (let i = 0; i < subItemIdsToShow.length; i += 30) {
                const chunkIds = subItemIdsToShow.slice(i, i + 30);
                const qSubItems = query(
                    collection(db, "projects", currentProject.id, "items", item.itemId, "subItems"),
                    where(documentId(), "in", chunkIds)
                );
                const subItemsSnapshot = await getDocs(qSubItems);
                subItemsSnapshot.forEach(docSnap => {
                    if (docSnap.data().status !== 'Instalado') subItemsData.push({ id: docSnap.id, ...docSnap.data() });
                });
            }
        }

        if (subItemsData.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-green-600 font-bold">Todos los ítems de esta tarea ya están instalados.</td></tr>';
            confirmBtn.disabled = true;
            return;
        }

        const isSingleUnit = (subItemsData.length === 1);
        
        // Controlar visibilidad de inputs grupales
        const bulkPhotoContainer = document.getElementById('multiple-group-photo-container');
        const bulkFillingContainer = document.getElementById('multiple-bulk-filling-container');
        const bulkDateContainer = document.getElementById('multiple-date-container');

        if (isSingleUnit) {
            if (bulkPhotoContainer) bulkPhotoContainer.style.display = 'none';
            if (bulkFillingContainer) bulkFillingContainer.style.display = 'none';
            if (bulkDateContainer) {
                bulkDateContainer.className = 'col-span-4 md:col-span-4'; // Ocupa todo el espacio
            }
            
            // Obtener el nombre del subítem único
            const singleSubItem = subItemsData[0];
            const singleItemName = itemsMap.get(singleSubItem.itemId) || 'Unidad';
            title.textContent = `Registrar Avance: ${singleItemName} (Unidad N° ${singleSubItem.number})`;
        } else {
            if (bulkPhotoContainer) bulkPhotoContainer.style.display = 'block';
            if (bulkFillingContainer) bulkFillingContainer.style.display = 'block';
            if (bulkDateContainer) {
                bulkDateContainer.className = 'col-span-1';
            }
            title.textContent = `Registrar Avance para ${subItemsData.length} Unidad(es)`;
        }

        const groupedSubItems = new Map();
        subItemsData.forEach(subItem => {
            if (!groupedSubItems.has(subItem.itemId)) groupedSubItems.set(subItem.itemId, []);
            groupedSubItems.get(subItem.itemId).push(subItem);
        });

        tableBody.innerHTML = '';
        groupedSubItems.forEach((subItemsArray, itemId) => {
            subItemsArray.sort((a, b) => (a.number || 0) - (b.number || 0));
            const itemName = itemsMap.get(itemId);

            if (!isSingleUnit) {
                tableBody.innerHTML += `
                    <tr class="group-header bg-slate-50/70 border-b border-slate-100 cursor-pointer hover:bg-slate-100/70 transition-colors" data-group-id="group-${itemId}">
                        <td colspan="5" class="px-4 py-3.5 font-bold text-slate-700 flex justify-between items-center select-none">
                            <span class="text-sm font-semibold">${itemName} (${subItemsArray.length} und.)</span>
                            <svg class="h-4 w-4 transform transition-transform duration-200 group-arrow text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                        </td>
                    </tr>
                `;
            }

            subItemsArray.forEach(subItem => {
                tableBody.innerHTML += `
                    <tr class="subitem-row group-${itemId} border-b border-slate-100 hover:bg-slate-50/30 transition-colors group/row" data-id="${subItem.id}" data-item-id="${subItem.itemId}">
                        <td class="w-12 bg-slate-50/30 border-r border-slate-100 text-center select-none">
                            <span class="text-base font-black text-slate-800">#${subItem.number}</span>
                        </td>
                        <td class="w-[28%] px-3 py-3.5">
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400"><i class="fa-solid fa-location-dot text-xs"></i></div>
                                <input type="text" class="location-input block w-full pl-9 pr-3 py-2.5 border border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-xl bg-slate-50/50 focus:bg-white transition-all text-sm font-semibold outline-none shadow-sm" value="" placeholder="Ubicación...">
                            </div>
                        </td>
                        <td class="w-[28%] px-3 py-3.5">
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-300"><i class="fa-solid fa-arrows-left-right text-[10px]"></i></div>
                                <input type="number" class="real-width-input block w-full pl-9 pr-3 py-2.5 border border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-xl bg-slate-50/50 focus:bg-white transition-all text-sm text-center font-mono outline-none shadow-sm" value="${(subItem.realWidth * 100) || ''}" placeholder="Ancho">
                            </div>
                        </td>
                        <td class="w-[28%] px-3 py-3.5">
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-300"><i class="fa-solid fa-arrows-up-down text-[10px]"></i></div>
                                <input type="number" class="real-height-input block w-full pl-9 pr-3 py-2.5 border border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-xl bg-slate-50/50 focus:bg-white transition-all text-sm text-center font-mono outline-none shadow-sm" value="${(subItem.realHeight * 100) || ''}" placeholder="Alto">
                            </div>
                        </td>
                        <td class="w-16 px-3 py-3.5 text-center">
                            <label class="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-slate-50/50 text-indigo-500 border border-slate-200 hover:border-indigo-500 hover:text-indigo-600 hover:shadow-md cursor-pointer transition-all group/icon" title="Tomar foto o subir archivo">
                                <i class="fa-solid fa-camera text-lg group-hover/icon:scale-110 transition-transform"></i>
                                <input type="file" class="photo-input hidden" accept="image/*" onchange="if(this.files.length > 0) { this.parentElement.classList.remove('bg-slate-50/50', 'text-indigo-500', 'border-slate-200'); this.parentElement.classList.add('bg-gradient-to-r', 'from-emerald-500', 'to-teal-500', 'text-white', 'border-emerald-600', 'shadow-md', 'shadow-emerald-100'); this.previousElementSibling.className='fa-solid fa-check text-lg animate-bounce-quick'; }">
                            </label>
                        </td>
                    </tr>
                `;
            });
        });

        // Agregar manejadores de clic para colapsar/expandir grupos (acordeón) si no es single unit
        if (!isSingleUnit) {
            const groupHeaders = tableBody.querySelectorAll('.group-header');
            groupHeaders.forEach(header => {
                header.addEventListener('click', () => {
                    const groupId = header.dataset.groupId;
                    const rows = tableBody.querySelectorAll(`.subitem-row.${groupId}`);
                    const arrow = header.querySelector('.group-arrow');
                    
                    let isCollapsed = false;
                    rows.forEach(row => {
                        if (row.style.display === 'none') {
                            row.style.display = '';
                        } else {
                            row.style.display = 'none';
                            isCollapsed = true;
                        }
                    });
                    
                    if (arrow) {
                        if (isCollapsed) {
                            arrow.style.transform = 'rotate(-90deg)';
                        } else {
                            arrow.style.transform = 'rotate(0deg)';
                        }
                    }
                });
            });
        }

        confirmBtn.disabled = false;
        
    } catch (error) {
        console.error("Error al abrir modal múltiple:", error);
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        confirmBtn.disabled = true;
    }
}

function closeMultipleProgressModal() {
    const modal = document.getElementById('multiple-progress-modal');
    if (modal) modal.style.display = 'none';
    const confirmBtn = document.getElementById('multiple-progress-modal-confirm-btn');
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Guardar Cambios';
    }
}

async function saveMultipleProgress() {
    const confirmBtn = document.getElementById('multiple-progress-modal-confirm-btn');
    const feedbackP = document.getElementById('multiple-progress-feedback');

    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Guardando...';
    if (feedbackP) {
        feedbackP.textContent = 'Validando...';
        feedbackP.className = 'text-sm mt-4 text-center text-blue-600';
    }

    const originatingTaskId = confirmBtn.dataset.originatingTaskId;
    const currentProject = deps.getCurrentProject();
    const currentUser = deps.getCurrentUser();

    if (!currentProject || !currentProject.id) {
        alert("Error de contexto de proyecto.");
        closeMultipleProgressModal();
        return;
    }

    let taskTeamUids = [currentUser.uid];
    let taskData = null;

    if (originatingTaskId) {
        try {
            const taskSnap = await getDoc(doc(db, "tasks", originatingTaskId));
            if (taskSnap.exists()) {
                taskData = taskSnap.data();
                taskTeamUids = [taskData.assigneeId, ...(taskData.additionalAssigneeIds || [])].filter(Boolean);
            }
        } catch(e) { console.warn("Error leyendo tarea", e); }
    }

    let validationError = null;
    try {
        const commonDate = document.getElementById('multiple-sub-item-date').value;
        const tableRows = document.querySelectorAll('#multiple-progress-table-body tr.subitem-row');
        const batch = writeBatch(db);
        const photoUploads = [];
        const groupPhotoFile = document.getElementById('multiple-group-photo')?.files[0];
        let rowsProcessed = 0;

        for (const row of tableRows) {
            const subItemId = row.dataset.id;
            const itemId = row.dataset.itemId;
            const location = row.querySelector('.location-input').value.trim();
            const realWidth = (parseFloat(row.querySelector('.real-width-input').value) / 100) || 0;
            const realHeight = (parseFloat(row.querySelector('.real-height-input').value) / 100) || 0;
            const photoFile = row.querySelector('.photo-input').files[0] || groupPhotoFile;

            if (!location) continue; // Solo procesa los que tengan ubicación

            if (!photoFile) {
                validationError = `Falta foto de evidencia para la Unidad (Lugar: ${location}).`;
                break;
            }

            rowsProcessed++;

            const subItemRef = doc(db, "projects", currentProject.id, "items", itemId, "subItems", subItemId);
            
            batch.update(subItemRef, {
                location,
                realWidth,
                realHeight,
                installDate: commonDate,
                installer: currentUser.uid,
                status: 'Instalado',
                assignedTaskId: originatingTaskId || null,
                installersTeam: taskTeamUids
            });

            if (photoFile) {
                photoUploads.push({
                    subItemId, itemId, photoFile,
                    watermarkText: `Vidrios Exito - ${currentProject.name} - ${commonDate} - ${location}`
                });
            }
        }

        if (validationError) throw new Error(validationError);
        if (rowsProcessed === 0) throw new Error("No se llenó la ubicación de ninguna unidad.");

        // Guardar BD
        await batch.commit();
        if (feedbackP) feedbackP.textContent = `Guardando fotos para ${rowsProcessed} unidad(es)...`;

        // Subir Fotos
        for (const upload of photoUploads) {
            try {
                const watermarkedBlob = await addWatermark(upload.photoFile, upload.watermarkText);
                const storageRef = ref(storage, `evidence/${currentProject.id}/${upload.itemId}/${upload.subItemId}`);
                const snapshot = await uploadBytes(storageRef, watermarkedBlob);
                const url = await getDownloadURL(snapshot.ref);
                await updateDoc(doc(db, "projects", currentProject.id, "items", upload.itemId, "subItems", upload.subItemId), { photoURL: url });
            } catch(e) { console.error("Error subiendo foto", e); }
        }

        // Verificar Tarea Completada
        let feedbackMessage = `¡Avance registrado para ${rowsProcessed} unidad(es)!`;
        if (originatingTaskId && taskData && taskData.specificSubItemIds) {
            let totalPending = 0;
            const subItemsSnap = await getDocs(query(
                collectionGroup(db, "subItems"), 
                where("assignedTaskId", "==", originatingTaskId)
            ));
            
            subItemsSnap.forEach(d => {
                 if(taskData.specificSubItemIds.includes(d.id) && d.data().status !== 'Instalado') totalPending++;
            });

            if (totalPending === 0) {
                await updateDoc(doc(db, "tasks", originatingTaskId), { status: 'completada', completedAt: new Date(), completedBy: currentUser.uid });
                feedbackMessage = '¡Avance registrado y tarea completada!';
            }
        }

        if (feedbackP) {
            feedbackP.textContent = feedbackMessage;
            feedbackP.className = 'text-sm mt-4 text-center text-green-600 font-bold';
        }

        setTimeout(() => {
            closeMultipleProgressModal();
        }, 2000);

    } catch (error) {
        console.error(error);
        if (feedbackP) {
            feedbackP.textContent = error.message;
            feedbackP.className = 'text-sm mt-4 text-center text-red-600 font-bold';
        }
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Guardar Cambios';
    }
}

// ============================================================================
// 5. UTILIDADES (Event Listeners fijos y Marcas de Agua)
// ============================================================================
function setupProgressListeners() {
    const progressCancelBtn = document.getElementById('progress-modal-cancel-btn');
    if (progressCancelBtn) progressCancelBtn.addEventListener('click', closeProgressModal);

    const progressForm = document.getElementById('progress-modal-form');
    if (progressForm) progressForm.addEventListener('submit', saveSingleProgress);

    const multiCancelBtn = document.getElementById('multiple-progress-modal-cancel-btn');
    if (multiCancelBtn) multiCancelBtn.addEventListener('click', closeMultipleProgressModal);

    const multiCloseIcon = document.getElementById('multiple-progress-modal-close-icon');
    if (multiCloseIcon) multiCloseIcon.addEventListener('click', closeMultipleProgressModal);

    const multiConfirmBtn = document.getElementById('multiple-progress-modal-confirm-btn');
    if (multiConfirmBtn) multiConfirmBtn.addEventListener('click', saveMultipleProgress);

    const applyGroupBtn = document.getElementById('btn-apply-group-settings');
    if (applyGroupBtn) {
        applyGroupBtn.addEventListener('click', () => {
            const bulkLoc = document.getElementById('bulk-location')?.value.trim();
            const bulkWidth = document.getElementById('bulk-width')?.value.trim();
            const bulkHeight = document.getElementById('bulk-height')?.value.trim();

            const tableRows = document.querySelectorAll('#multiple-progress-table-body tr.subitem-row');
            tableRows.forEach(row => {
                if (bulkLoc) {
                    const locInput = row.querySelector('.location-input');
                    if (locInput) locInput.value = bulkLoc;
                }
                if (bulkWidth) {
                    const wInput = row.querySelector('.real-width-input');
                    if (wInput) wInput.value = bulkWidth;
                }
                if (bulkHeight) {
                    const hInput = row.querySelector('.real-height-input');
                    if (hInput) hInput.value = bulkHeight;
                }
            });
        });
    }
}

function addWatermark(file, text) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                const MAX_WIDTH = 1920; 
                let width = img.width;
                let height = img.height;

                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                const fontSize = Math.max(16, width / 60); 
                ctx.font = `bold ${fontSize}px Arial`;
                ctx.fillStyle = 'rgba(255, 0, 0, 0.9)'; 
                ctx.textAlign = 'right';
                ctx.textBaseline = 'bottom';

                const margin = 20;
                ctx.fillText(text, canvas.width - margin, canvas.height - margin);

                canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85); 
            };
            img.onerror = reject;
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ============================================================================
// 6. HELPERS
// ============================================================================
async function getActiveProjects() {
    const q = query(collection(db, "projects"), where("status", "==", "active"), orderBy("name"));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ value: doc.id, label: doc.data().name }));
}

function getActiveUsersList() {
    const list = [];
    const usersMap = deps.getUsersMap();
    usersMap.forEach((user, userId) => {
        if (user.status === 'active') {
            list.push({ value: userId, label: `${user.firstName} ${user.lastName}` });
        }
    });
    return list.sort((a, b) => a.label.localeCompare(b.label));
}

// ============================================================================
// 7. MARCAR TAREA COMO COMPLETADA
// ============================================================================
export async function completeTask(taskId) {
    if (!taskId) return;
    try {
        const currentUser = deps.getCurrentUser();
        
        await updateDoc(doc(db, "tasks", taskId), {
            status: 'completada',
            completedAt: serverTimestamp(),
            completedBy: currentUser ? currentUser.uid : 'Sistema'
        });

        // Mostramos el mensaje de éxito
        if (window.showToast) {
            window.showToast("Tarea completada con éxito", "success");
        } else {
            alert("Tarea completada con éxito");
        }

        // Si tenemos la vista de tareas en pantalla, la refrescamos
        if (deps.loadTasksView) {
            deps.loadTasksView();
        }
        
    } catch (error) {
        console.error("Error al completar la tarea:", error);
        if (window.showToast) {
            window.showToast("Error al completar la tarea: " + error.message, "error");
        } else {
            alert("Error al completar la tarea");
        }
    }
}

export function loadTasksView() {
    const newTaskBtn = document.getElementById('new-task-btn');
    const adminToggleContainer = document.getElementById('admin-task-toggle-container');
    const role = window.currentUserRole;

    if (newTaskBtn && adminToggleContainer) {
        const isAdmin = (role === 'admin');
        const isBodega = (role === 'bodega');
        newTaskBtn.classList.toggle('hidden', !isAdmin);
        adminToggleContainer.classList.toggle('hidden', !(isAdmin || isBodega));
    }

    const adminToggleCheckbox = document.getElementById('admin-task-toggle-checkbox');
    if (adminToggleCheckbox && !adminToggleCheckbox.dataset.listenerAttached) {
        adminToggleCheckbox.dataset.listenerAttached = 'true';
        adminToggleCheckbox.addEventListener('change', () => {
            const currentActiveTab = document.querySelector('#tareas-view .task-tab-button.active');
            const currentFilter = currentActiveTab ? currentActiveTab.dataset.statusFilter : 'pendiente';
            const titleElement = document.querySelector('#tareas-view h1');
            if (titleElement) {
                titleElement.textContent = adminToggleCheckbox.checked ? 'Todas las Tareas' : 'Mis Tareas Asignadas';
            }
            loadAndDisplayTasks(currentFilter); // <-- 'blockButtons' eliminado
        });
    }

    const tabsContainer = document.querySelector('#tareas-view .mb-4.border-b nav');
    if (!tabsContainer) {
        console.error('ERROR CRÍTICO: No se encontró el contenedor de pestañas (nav).');
        return;
    }

    if (!tabsContainer.dataset.listenerAttached) {
        tabsContainer.addEventListener('click', (e) => {
            const clickedButton = e.target.closest('.task-tab-button');
            if (!clickedButton) return;
            const statusFilter = clickedButton.dataset.statusFilter;
            const isActive = clickedButton.classList.contains('active');
            if (!isActive) {
                tabsContainer.querySelectorAll('.task-tab-button').forEach(btn => btn.classList.remove('active'));
                clickedButton.classList.add('active');
                loadAndDisplayTasks(statusFilter); // <-- 'blockButtons' eliminado
            }
        });
        tabsContainer.dataset.listenerAttached = 'true';
    }

    // Carga inicial
    const currentActiveTab = tabsContainer.querySelector('.task-tab-button.active');
    const initialFilter = currentActiveTab ? currentActiveTab.dataset.statusFilter : 'pendiente';
    if (!currentActiveTab) {
        tabsContainer.querySelector('#pending-tasks-tab')?.classList.add('active');
    }

    loadAndDisplayTasks(initialFilter);
}

export async function loadAndDisplayTasks(statusFilter = 'pendiente') {
    const tasksContainer = document.getElementById('tasks-container');
    if (!tasksContainer) return;

    // Mostrar spinner/cargando con diseño premium
    tasksContainer.innerHTML = `
        <div id="loading-tasks" class="text-center py-12 bg-white rounded-2xl border border-slate-100 p-8 shadow-sm">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-500 border-t-transparent mb-4"></div>
            <p class="text-slate-500 font-semibold text-sm">Cargando tareas...</p>
        </div>
    `;

    try {
        const currentUser = deps.getCurrentUser();
        const role = window.currentUserRole;
        if (!currentUser) throw new Error("No hay usuario autenticado.");

        const adminToggleCheckbox = document.getElementById('admin-task-toggle-checkbox');
        const showAll = adminToggleCheckbox ? adminToggleCheckbox.checked : false;

        let q;
        const tasksRef = collection(db, "tasks");

        // Construir query de Firestore sin orderBy para evitar la necesidad de índices compuestos
        if (showAll && (role === 'admin' || role === 'bodega')) {
            q = query(tasksRef, where("status", "==", statusFilter));
            const querySnapshot = await getDocs(q);
            const tasks = [];
            querySnapshot.forEach(docSnap => {
                tasks.push({ id: docSnap.id, ...docSnap.data() });
            });
            
            // Ordenar en memoria por createdAt (descendente)
            tasks.sort((a, b) => {
                const aTime = a.createdAt?.seconds || (a.createdAt?.toDate ? a.createdAt.toDate().getTime()/1000 : 0) || 0;
                const bTime = b.createdAt?.seconds || (b.createdAt?.toDate ? b.createdAt.toDate().getTime()/1000 : 0) || 0;
                return bTime - aTime;
            });
            
            renderTasks(tasks, tasksContainer);
            return;
        } else {
            const q1 = query(tasksRef, where("status", "==", statusFilter), where("assigneeId", "==", currentUser.uid));
            const q2 = query(tasksRef, where("status", "==", statusFilter), where("additionalAssigneeIds", "array-contains", currentUser.uid));
            
            const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
            
            const tasksMap = new Map();
            snap1.forEach(docSnap => tasksMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));
            snap2.forEach(docSnap => tasksMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));
            
            const combinedTasks = Array.from(tasksMap.values());
            
            // Ordenar en memoria por createdAt (descendente)
            combinedTasks.sort((a, b) => {
                const aTime = a.createdAt?.seconds || (a.createdAt?.toDate ? a.createdAt.toDate().getTime()/1000 : 0) || 0;
                const bTime = b.createdAt?.seconds || (b.createdAt?.toDate ? b.createdAt.toDate().getTime()/1000 : 0) || 0;
                return bTime - aTime;
            });
            
            renderTasks(combinedTasks, tasksContainer);
            return;
        }

    } catch (error) {
        console.error("Error al cargar tareas:", error);
        tasksContainer.innerHTML = `
            <div class="text-center py-10 bg-rose-50 rounded-2xl border border-rose-100 p-8 shadow-sm">
                <div class="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-3 text-rose-500">
                    <i class="fa-solid fa-triangle-exclamation text-xl"></i>
                </div>
                <p class="text-rose-800 font-bold">Error al cargar tareas</p>
                <p class="text-xs text-rose-500 mt-1">${error.message}</p>
            </div>
        `;
    }
}

function renderTasks(tasks, container) {
    container.innerHTML = '';
    if (tasks.length === 0) {
        container.className = "w-full";
        container.innerHTML = `
            <div class="text-center py-16 bg-slate-50 border border-slate-100 rounded-2xl p-8 w-full shadow-sm">
                <div class="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                    <i class="fa-solid fa-list-check text-2xl"></i>
                </div>
                <p class="text-slate-700 font-extrabold text-lg">No hay tareas</p>
                <p class="text-slate-400 text-sm mt-1.5">No se encontraron tareas con este filtro en el sistema.</p>
            </div>
        `;
        return;
    }

    // El contenedor #tasks-container en CSS ya es una cuadrícula, pero le aplicamos clases de Tailwind
    // directamente para asegurar 2 columnas a todo lo ancho de la pantalla y un gap generoso.
    container.className = "grid grid-cols-1 md:grid-cols-2 gap-8 w-full";
    
    tasks.forEach(task => {
        const card = createTaskCard(task);
        const col = document.createElement('div');
        col.className = "h-full w-full";
        col.appendChild(card);
        container.appendChild(col);
        
        if (task.specificSubItemIds && task.specificSubItemIds.length > 0) {
            loadTaskMaterialStatus(task.id, task.projectId, `material-status-${task.id}`, 'card');
        }
    });
}

export function createTaskCard(task) {
    const currentUser = deps.getCurrentUser();
    const currentUserRole = window.currentUserRole;
    const usersMap = deps.getUsersMap();
    
    const card = document.createElement('div');
    card.className = "bg-white/90 backdrop-blur-md border border-slate-200/70 rounded-2xl shadow-sm hover:shadow-xl hover:scale-[1.01] hover:border-indigo-200 transition-all duration-300 overflow-hidden h-full flex flex-col group relative";
    card.dataset.id = task.id;
    
    const dueDate = task.dueDate ? new Date(task.dueDate + 'T00:00:00') : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let dateBadgeHtml = '';
    if (dueDate && task.status === 'pendiente') {
        const diffTime = dueDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays < 0) {
            dateBadgeHtml = `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 border border-rose-100 text-rose-700">
                    <i class="fa-solid fa-circle-exclamation text-[10px] animate-pulse"></i> Vencida
                </span>
            `;
        } else if (diffDays === 0) {
            dateBadgeHtml = `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 border border-amber-100 text-amber-700">
                    <i class="fa-solid fa-clock text-[10px] animate-bounce"></i> Hoy
                </span>
            `;
        } else if (diffDays <= 3) {
            dateBadgeHtml = `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-50 border border-orange-100 text-orange-700">
                    Faltan ${diffDays} días
                </span>
            `;
        } else {
            dateBadgeHtml = `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-50 border border-slate-100 text-slate-600">
                    <i class="fa-regular fa-calendar text-[10px]"></i> ${dueDate.toLocaleDateString('es-CO')}
                </span>
            `;
        }
    } else if (dueDate) {
        dateBadgeHtml = `
            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-50 border border-slate-100 text-slate-500">
                <i class="fa-regular fa-calendar text-[10px]"></i> ${dueDate.toLocaleDateString('es-CO')}
            </span>
        `;
    } else {
        dateBadgeHtml = `
            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-50 border border-slate-100 text-slate-400">
                Sin fecha límite
            </span>
        `;
    }

    // --- Barra de Progreso (Instalación) ---
    let progressBarHtml = '';
    const progressBarId = `task-progress-bar-${task.id}`;
    const progressTextId = `task-progress-text-${task.id}`;
    if (task.status === 'completada') {
        progressBarHtml = `
            <div class="space-y-1.5">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-slate-500">Instalación</span>
                    <span class="text-xs font-extrabold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">100%</span>
                </div>
                <div class="w-full bg-slate-100 rounded-full h-2 shadow-inner overflow-hidden">
                    <div class="h-full rounded-full bg-emerald-500" style="width: 100%;"></div>
                </div>
            </div>`;
    } else if (task.specificSubItemIds && task.specificSubItemIds.length > 0) {
        progressBarHtml = `
            <div class="space-y-1.5">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-slate-500">Instalación</span>
                    <span id="${progressTextId}" class="text-xs font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">Calculando...</span>
                </div>
                <div class="w-full bg-slate-100 rounded-full h-2 shadow-inner overflow-hidden">
                    <div id="${progressBarId}" class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 transition-all duration-500 ease-out" style="width: 0%;"></div>
                </div>
            </div>`;
        const calculateProgress = async () => {
            try {
                const subItemIds = task.specificSubItemIds || [];
                const selectedItems = task.selectedItems || [];
                const projectId = task.projectId;

                if (subItemIds.length === 0 || selectedItems.length === 0 || !projectId) {
                    const progressTextElement = document.getElementById(progressTextId);
                    if (progressTextElement) progressTextElement.textContent = `0% (0/0)`;
                    return;
                }

                let installedCount = 0;
                let totalFoundInTask = 0;
                const subItemIdsSet = new Set(subItemIds);

                for (const itemInfo of selectedItems) {
                    const itemId = itemInfo.itemId;
                    if (!itemId) continue;

                    for (let i = 0; i < subItemIds.length; i += 30) {
                        const chunkIds = subItemIds.slice(i, i + 30);
                        const q = query(
                            collection(db, "projects", projectId, "items", itemId, "subItems"),
                            where(documentId(), "in", chunkIds)
                        );

                        const snapshot = await getDocs(q);

                        snapshot.forEach(docSnap => {
                            if (docSnap.exists() && subItemIdsSet.has(docSnap.id)) {
                                totalFoundInTask++;
                                if (docSnap.data().status === 'Instalado') {
                                    installedCount++;
                                }
                            }
                        });
                    }
                }

                const totalSubItemsEffective = subItemIds.length;
                const percentage = totalSubItemsEffective > 0 ? (installedCount / totalSubItemsEffective) * 100 : 0;

                const progressBarElement = document.getElementById(progressBarId);
                const progressTextElement = document.getElementById(progressTextId);

                if (progressBarElement) progressBarElement.style.width = `${percentage.toFixed(0)}%`;
                if (progressTextElement) progressTextElement.textContent = `${percentage.toFixed(0)}% (${installedCount}/${totalSubItemsEffective})`;

            } catch (error) {
                console.error(`Error calculating progress for task ${task.id}:`, error);
                const progressTextElement = document.getElementById(progressTextId);
                if (progressTextElement) progressTextElement.textContent = 'Error';
            }
        };
        setTimeout(calculateProgress, 100);
    }

    // --- Placeholder para el Estado de Materiales ---
    const materialStatusId = `material-status-${task.id}`;
    let materialStatusHtml = '';
    if (task.specificSubItemIds && task.specificSubItemIds.length > 0) {
        materialStatusHtml = `
            <div id="${materialStatusId}" class="mt-2 text-xs">
                <p class="text-slate-400 italic flex items-center gap-1.5"><i class="fa-solid fa-spinner fa-spin text-indigo-500"></i> Cargando materiales...</p>
            </div>`;
    }

    // --- Botones estilizados Premium ---
    const baseButtonClasses = "text-xs font-bold py-2 px-3 rounded-xl transition-all duration-200 flex items-center gap-1.5 hover:scale-[1.02] active:scale-95 shadow-sm hover:shadow";
    
    const editButtonHtmlFinal = currentUserRole === 'admin' ? `
        <button data-action="edit-task" data-id="${task.id}" class="${baseButtonClasses} bg-amber-500 hover:bg-amber-600 text-white">
            <i class="fa-solid fa-pen-to-square"></i> Editar
        </button>
    ` : '';

    const viewTaskButtonHtmlFinal = `
        <button data-action="view-task-details" data-id="${task.id}" class="${baseButtonClasses} bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100/50">
            <i class="fa-solid fa-eye"></i> Ver
        </button>
    `;

    const registerProgressButtonHtmlFinal = task.status === 'pendiente' && task.projectId && ((task.selectedItems && task.selectedItems.length > 0) || (task.specificSubItemIds && task.specificSubItemIds.length > 0)) ? `
        <button data-action="register-task-progress" data-task-id="${task.id}" class="${baseButtonClasses} bg-indigo-600 hover:bg-indigo-700 text-white">
            <i class="fa-solid fa-plus"></i> Registrar Avance
        </button>
    ` : '';

    const requestMaterialButtonHtml = task.status === 'pendiente' && task.projectId && task.specificSubItemIds && task.specificSubItemIds.length > 0 ? `
        <button data-action="request-material-from-task"
                data-project-id="${task.projectId}"
                data-task-id="${task.id}"
                class="${baseButtonClasses} bg-purple-500 hover:bg-purple-600 text-white">
            <i class="fa-solid fa-boxes-stacked"></i> Pedir Material
        </button>
    ` : '';

    const completeButtonHtmlFinal = task.status === 'pendiente' ? `
        <button data-action="complete-task" data-id="${task.id}" class="${baseButtonClasses} bg-emerald-500 hover:bg-emerald-600 text-white">
            <i class="fa-solid fa-circle-check"></i> Listar
        </button>
    ` : '';

    const adminToggleCheckbox = document.getElementById('admin-task-toggle-checkbox');
    const isAdminView = adminToggleCheckbox?.checked && currentUserRole === 'admin';
    
    // Badge de comentarios pendientes
    const unreadCommentHtml = (task.unreadCommentFor && task.unreadCommentFor.includes(currentUser.uid)) ? `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 border border-blue-100 text-blue-600 animate-pulse" title="Nuevos comentarios">
            <i class="fa-solid fa-comment-dots text-xs"></i> ¡Comentario Nuevo!
        </span>
    ` : '';

    // Estilo elegante del responsable principal
    const creatorName = usersMap.get(task.createdBy)?.firstName || 'N/A';
    const mainAssigneeName = task.assigneeName || 'N/A';
    const mainAssigneeInitials = mainAssigneeName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    // Estilo elegante de apoyo adicional
    let supportStaffHtml = '';
    if (task.additionalAssigneeIds && task.additionalAssigneeIds.length > 0) {
        supportStaffHtml = `
            <div class="flex items-center gap-1.5">
                <span class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Apoyo:</span>
                <div class="flex items-center -space-x-1.5">
                    ${task.additionalAssigneeIds.map(uid => {
                        const u = usersMap.get(uid);
                        const fullName = u ? `${u.firstName} ${u.lastName}` : 'N/A';
                        const initials = u ? `${u.firstName[0]}${u.lastName[0] || ''}`.toUpperCase() : '??';
                        return `
                            <div class="w-6 h-6 rounded-full bg-slate-100 text-slate-600 border border-white flex items-center justify-center font-extrabold text-[9px] uppercase shadow-sm cursor-pointer hover:-translate-y-0.5 transition-transform" title="${fullName}">
                                ${initials}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    card.innerHTML = `
        <div class="p-5 flex-grow flex flex-col space-y-4">
            <!-- Cabecera -->
            <div class="space-y-1.5">
                <div class="flex justify-between items-start gap-2">
                    <span class="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-extrabold tracking-wider uppercase bg-gradient-to-r from-indigo-500/10 to-blue-500/10 text-indigo-700 border border-indigo-100/50">
                        ${task.projectName || 'General'}
                    </span>
                    <div class="flex-shrink-0">
                        ${dateBadgeHtml}
                    </div>
                </div>
                
                <h3 class="text-base font-extrabold text-slate-800 leading-snug group-hover:text-indigo-950 transition-colors">
                    ${task.description}
                </h3>
            </div>

            <!-- Comentarios y Badges -->
            ${unreadCommentHtml ? `<div class="pt-1">${unreadCommentHtml}</div>` : ''}

            <!-- Responsables -->
            <div class="flex flex-wrap items-center gap-4 pt-1 pb-1 border-y border-slate-100">
                <div class="flex items-center gap-2">
                    <div class="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center font-black text-[10px] uppercase shadow-sm border border-indigo-100">
                        ${mainAssigneeInitials}
                    </div>
                    <div class="flex flex-col">
                        <span class="text-[9px] uppercase font-bold text-slate-400 leading-none">Responsable</span>
                        <span class="font-bold text-slate-700 text-xs mt-0.5">${mainAssigneeName}</span>
                    </div>
                </div>

                ${supportStaffHtml}
            </div>

            <!-- Sección de progreso y materiales -->
            <div class="bg-slate-50/50 rounded-2xl border border-slate-100/80 p-3.5 space-y-3.5">
                ${progressBarHtml}
                ${materialStatusHtml}
            </div>

            <!-- Metadata del Creador -->
            <div class="text-[10px] text-slate-400 font-semibold flex items-center gap-1 mt-auto pt-1 justify-end">
                <span>Creado por:</span>
                <span class="text-slate-600 font-bold">${creatorName}</span>
            </div>
        </div>
        
        <!-- Acciones/Botones del footer -->
        <div class="bg-slate-50/50 p-4 border-t border-slate-100/80 flex flex-wrap gap-2 justify-end items-center mt-auto">
            ${editButtonHtmlFinal}
            ${viewTaskButtonHtmlFinal}
            ${requestMaterialButtonHtml}
            ${registerProgressButtonHtmlFinal}
            ${completeButtonHtmlFinal}
        </div>
    `;
    
    return card;
}

export function closeTaskDetailsModal() {
    const modal = document.getElementById('task-details-modal');
    if (modal) {
        modal.style.display = 'none';

        const bodyEl = document.getElementById('task-details-body');

        // Limpiar listeners de material activos para este modal
        const materialStatusDiv = bodyEl.querySelector('div[id^="task-detail-material-status-"]');
        if (materialStatusDiv) {
            const placeholderId = materialStatusDiv.id;
            if (materialStatusListeners.has(placeholderId)) {
                materialStatusListeners.get(placeholderId)(); // Llama a la función unsubscribe
                materialStatusListeners.delete(placeholderId);
                console.log(`Listener de material ${placeholderId} limpiado al cerrar modal.`);
            }
        }

        // --- INICIO DE LA MODIFICACIÓN (Limpieza de listener de Comentarios) ---
        const commentsSection = bodyEl.querySelector('#task-comments-section');
        if (commentsSection) {
            const taskId = commentsSection.dataset.taskId; // Obtengo el ID que guardé
            if (taskId && taskCommentListeners.has(taskId)) {
                taskCommentListeners.get(taskId)(); // Unsubscribe
                taskCommentListeners.delete(taskId);
                console.log(`Listener de comentarios para ${taskId} limpiado.`);
            }
        }
        // --- FIN DE LA MODIFICACIÓN ---

        // Limpiar el contenido para la próxima vez
        bodyEl.innerHTML = '<div class="text-center py-8"><div class="loader mx-auto"></div></div>';
        document.getElementById('task-details-actions').querySelectorAll('button:not(#task-details-cancel-btn)').forEach(btn => btn.remove());
    }
}

export function loadTaskMaterialStatus(taskId, projectId, placeholderId, renderMode = 'detail') {
    // Cancelar cualquier listener anterior para esta misma tarjeta
    if (materialStatusListeners.has(placeholderId)) {
        materialStatusListeners.get(placeholderId)(); // Llama a la función unsubscribe
        materialStatusListeners.delete(placeholderId);
    }

    const q = query(
        collection(db, "projects", projectId, "materialRequests"),
        where("taskId", "==", taskId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const container = document.getElementById(placeholderId);
        if (!container) {
            unsubscribe(); // Si el contenedor ya no existe, cancela el listener
            materialStatusListeners.delete(placeholderId);
            return;
        }

        // --- INICIO DE LÓGICA (Modificada para agrupar por tipo/medida) ---

        // 1. Agrupar materiales de todas las solicitudes de esta tarea
        const materialSummary = new Map();

        snapshot.forEach(doc => {
            const request = doc.data();
            const status = request.status; // 'pendiente', 'aprobado', 'entregado', 'entregado_parcial'
            const items = request.consumedItems || [];

            items.forEach(item => {
                // --- INICIO DE CORRECCIÓN: Clave Única ---
                // Creamos una clave única para CADA TIPO de ítem (no solo por materialId)
                const itemLength = (item.length || 0).toString(); // ej: 2.5 o 0
                const itemType = item.type || 'full_unit';
                const uniqueKey = `${item.materialId}-${itemType}-${itemLength}`;
                // --- FIN DE CORRECCIÓN ---

                const materialName = item.itemName || "Material";

                if (!materialSummary.has(uniqueKey)) {

                    // --- INICIO DE CORRECCIÓN: Guardar Descripción ---
                    let description = "Unidad Completa";
                    if (itemType === 'cut') {
                        description = `Corte de ${item.length * 100} cm`;
                    } else if (itemType === 'remnant') {
                        description = `Retazo de ${item.length * 100} cm`;
                    }
                    // --- FIN DE CORRECCIÓN ---

                    materialSummary.set(uniqueKey, {
                        name: materialName,
                        description: description, // <-- AÑADIDO
                        solicitado: 0,
                        despachado: 0 // "unidades pasadas"
                    });
                }

                const summary = materialSummary.get(uniqueKey);
                const quantity = item.quantity || 0;

                // Contamos 'solicitado' solo si está aprobado o ya entregado (no pendiente)
                if (status === 'aprobado' || status === 'entregado' || status === 'entregado_parcial') {
                    summary.solicitado += quantity;
                }

                // Contamos 'despachado' solo si está entregado
                if (status === 'entregado') {
                    summary.despachado += quantity;
                }
                // Si es parcial, contamos lo que se ha entregado del historial
                else if (status === 'entregado_parcial') {
                    const deliveryHistory = request.deliveryHistory || [];
                    deliveryHistory.forEach(delivery => {
                        delivery.items.forEach(deliveredItem => {

                            // --- INICIO DE CORRECCIÓN: Comparación de Clave Única ---
                            // Comparamos el ítem entregado con nuestra clave única
                            if (deliveredItem.materialId === item.materialId &&
                                deliveredItem.type === itemType &&
                                (deliveredItem.length || 0).toString() === itemLength) {
                                summary.despachado += deliveredItem.quantity;
                            }
                            // --- FIN DE CORRECCIÓN ---
                        });
                    });
                }
            });
        });

        // 2. Generar el HTML basado en el modo de renderizado
        let html = '';

        if (renderMode === 'detail') {
            // --- MODO DETALLE (Modificado para mostrar la descripción) ---
            if (materialSummary.size === 0) {
                html = `
                    <p class="font-semibold text-red-600 flex items-center">
                        <svg class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        No has solicitado material
                    </p>`;
            } else {
                html = `
                    <div class="overflow-hidden rounded-md border border-gray-200">
                        <table class="min-w-full text-sm">
                            <thead class="bg-gray-100">
                                <tr>
                                    <th class="px-3 py-2 text-left font-semibold text-gray-600">Material</th>
                                    <th class="px-3 py-2 text-left font-semibold text-gray-600">Descripción</th>
                                    <th class="px-3 py-2 text-center font-semibold text-gray-600">Entregado</th>
                                    <th class="px-3 py-2 text-center font-semibold text-gray-600">Pendiente</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-200 bg-white">
                `;

                materialSummary.forEach((summary) => {
                    const pendiente = Math.max(0, summary.solicitado - summary.despachado);
                    const entregado = summary.despachado;
                    const colorPendiente = pendiente > 0 ? 'text-red-600' : 'text-gray-700';

                    html += `
                        <tr>
                            <td class="px-3 py-2 font-medium text-gray-800">${summary.name}</td>
                            <td class="px-3 py-2 text-gray-600">${summary.description}</td>
                            <td class="px-3 py-2 text-center font-bold text-green-600">${entregado}</td>
                            <td class="px-3 py-2 text-center font-bold ${colorPendiente}">${pendiente}</td>
                        </tr>
                    `;
                });

                html += `
                            </tbody>
                        </table>
                    </div>
                `;
            }
        } else {
            // --- MODO RESUMEN (CON BARRA DE PROGRESO) ---

            // 1. Calculamos el estado general
            let overallStatus = 'none';
            let totalSolicitado = 0;
            let totalDespachado = 0;

            materialSummary.forEach((summary) => {
                totalSolicitado += summary.solicitado;
                totalDespachado += summary.despachado;
            });

            // 2. Calculamos el porcentaje
            const porcentaje = (totalSolicitado > 0) ? (totalDespachado / totalSolicitado) * 100 : 0;

            if (totalSolicitado === 0) {
                overallStatus = 'none';
            } else if (porcentaje === 0) {
                overallStatus = 'requested';
            } else if (porcentaje < 100) {
                overallStatus = 'partial';
            } else {
                overallStatus = 'delivered';
            }
            // Fin del cálculo

            // 3. Generar el HTML
            if (overallStatus === 'none') {
                html = `
                    <div class="flex items-center gap-1.5 text-xs font-bold text-rose-600 bg-rose-50/50 px-3 py-1.5 rounded-xl border border-rose-100/50 mt-1">
                        <i class="fa-solid fa-triangle-exclamation text-[10px]"></i> Sin material solicitado
                    </div>`;
            } else {
                let barColor = 'bg-blue-600'; // Color para 'requested'
                let barTextColor = 'text-blue-700 bg-blue-50';
                let barText = `Material Solicitado (${totalDespachado}/${totalSolicitado})`;

                if (overallStatus === 'partial') {
                    barColor = 'bg-yellow-500'; // Color para 'partial'
                    barTextColor = 'text-yellow-700 bg-yellow-50';
                    barText = `Despachado Parcial (${totalDespachado}/${totalSolicitado})`;
                } else if (overallStatus === 'delivered') {
                    barColor = 'bg-green-600'; // Color para 'delivered'
                    barTextColor = 'text-green-700 bg-green-50';
                    barText = `Material Despachado (${totalDespachado}/${totalSolicitado})`;
                }

                html = `
                    <div class="space-y-1.5 mt-1">
                        <div class="flex justify-between items-center">
                            <span class="text-xs font-bold text-slate-500">${barText}</span>
                            <span class="text-xs font-extrabold ${barTextColor} px-2 py-0.5 rounded-md">${porcentaje.toFixed(0)}%</span>
                        </div>
                        <div class="w-full bg-slate-100 rounded-full h-2 shadow-inner overflow-hidden">
                            <div class="h-full rounded-full ${barColor} transition-all duration-500 ease-out" style="width: ${porcentaje.toFixed(0)}%;"></div>
                        </div>
                    </div>
                `;
            }
        }

        container.innerHTML = html;

    }, (error) => {
        console.error(`Error al cargar estado de material para tarea ${taskId}:`, error);
        const container = document.getElementById(placeholderId);
        if (container) {
            container.innerHTML = `<p class="text-xs text-red-500">Error al cargar estado de material.</p>`;
        }
    });

    // Guardar la función de unsubscribe
    materialStatusListeners.set(placeholderId, unsubscribe);
    // También la añadimos al listener global por si acaso
    activeListeners.push(unsubscribe);
}

// ============================================================================
// 8. BITÁCORA Y SEGURIDAD / DETALLE DE TAREA
// ============================================================================

async function addCommentToTask(taskId) {
    const input = document.getElementById('task-comment-input');
    const submitBtn = document.getElementById('task-comment-submit-btn');
    if (!input || !submitBtn) return;

    const commentText = input.value.trim();
    if (commentText.length === 0) return;

    const currentUser = deps.getCurrentUser();
    const usersMap = deps.getUsersMap();

    const userData = usersMap.get(currentUser.uid) || { firstName: 'Usuario', lastName: 'Desconocido' };
    const authorFirstName = userData.firstName || 'Usuario';

    submitBtn.disabled = true;
    input.disabled = true;

    try {
        const taskRef = doc(db, "tasks", taskId);
        const taskSnap = await getDoc(taskRef);

        if (!taskSnap.exists()) {
            throw new Error("La tarea ya no existe. No se puede comentar.");
        }
        const taskData = taskSnap.data();

        const commentData = {
            userId: currentUser.uid,
            userName: `${authorFirstName} ${userData.lastName.charAt(0)}.`,
            text: commentText,
            createdAt: new Date()
        };
        await addDoc(collection(db, "tasks", taskId, "comments"), commentData);

        const notifyFunction = httpsCallable(functions, 'notifyOnNewTaskComment');
        await notifyFunction({
            taskId: taskId,
            projectId: taskData.projectId,
            commentText: commentText,
            authorName: authorFirstName
        });

        input.value = '';

    } catch (error) {
        console.error("Error al añadir comentario o notificar:", error);
        alert(`No se pudo guardar el comentario: ${error.message}`);
    } finally {
        submitBtn.disabled = false;
        input.disabled = false;
        input.focus();
    }
}

export async function openTaskDetailsModal(taskId) {
    const modal = document.getElementById('task-details-modal');
    const titleEl = document.getElementById('task-details-title');
    const bodyEl = document.getElementById('task-details-body');
    const actionsEl = document.getElementById('task-details-actions');

    const currentUser = deps.getCurrentUser();
    const currentUserRole = window.currentUserRole;
    const usersMap = deps.getUsersMap();

    // --- MEJORA 1: MÁS ANCHO ---
    const modalContainer = modal.querySelector('.w-11\\/12');
    if (modalContainer) {
        modalContainer.classList.remove('md:max-w-2xl', 'md:max-w-4xl');
        modalContainer.classList.add('md:max-w-6xl');
    }

    if (!modal || !bodyEl || !actionsEl) return;

    try {
        const taskRef = doc(db, "tasks", taskId);
        updateDoc(taskRef, { unreadCommentFor: arrayRemove(currentUser.uid) });
    } catch (e) { console.error(e); }

    window.materialRequestReturnContext = { view: 'detalle-tarea', taskId: taskId };

    modal.style.display = 'flex';
    if (titleEl.parentElement) titleEl.parentElement.style.display = 'none';

    bodyEl.innerHTML = '<div class="flex justify-center items-center h-64"><div class="loader"></div></div>';
    actionsEl.innerHTML = `<button type="button" id="task-details-cancel-btn" data-action="close-task-details" class="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold py-2 px-4 rounded-lg transition-colors shadow-sm">Cerrar</button>`;

    try {
        const taskRef = doc(db, "tasks", taskId);
        const taskSnap = await getDoc(taskRef);

        if (!taskSnap.exists()) throw new Error("Tarea no encontrada.");

        const task = { id: taskSnap.id, ...taskSnap.data() };

        // --- PREPARACIÓN DE DATOS ---
        const assigneeUser = usersMap.get(task.assigneeId);
        const assigneeName = assigneeUser ? `${assigneeUser.firstName} ${assigneeUser.lastName}` : 'Sin asignar';
        const assigneeInitial = assigneeUser ? assigneeUser.firstName.charAt(0) : '?';

        // --- MEJORA VISUAL ---
        let additionalMembersHtml = '';
        if (task.additionalAssigneeIds && task.additionalAssigneeIds.length > 0) {
            let membersGrid = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">';
            
            task.additionalAssigneeIds.forEach(id => {
                const u = usersMap.get(id);
                if(u) {
                    membersGrid += `
                        <div class="flex items-center p-2 bg-gray-50 rounded-lg border border-gray-100 hover:bg-gray-100 transition-colors">
                            <div class="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-[10px] border border-blue-200 mr-2 shrink-0">
                                ${u.firstName.charAt(0)}
                            </div>
                            <span class="text-xs font-medium text-gray-600 truncate">${u.firstName} ${u.lastName}</span>
                        </div>
                    `;
                }
            });
            membersGrid += '</div>';
            additionalMembersHtml = membersGrid;
        } else {
            additionalMembersHtml = '<p class="text-xs text-gray-400 italic mt-2 bg-gray-50 p-2 rounded text-center">Sin personal de apoyo asignado.</p>';
        }

        const formatDate = (dateStr) => dateStr ? new Date(dateStr + 'T00:00:00').toLocaleDateString('es-CO', { month: 'short', day: 'numeric' }) : '---';
        const createdDate = task.createdAt ? task.createdAt.toDate().toLocaleDateString('es-CO', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '---';

        const statusConfig = {
            'pendiente': { color: 'text-yellow-700', bg: 'bg-yellow-50', border: 'border-yellow-200', icon: 'fa-clock', label: 'En Progreso' },
            'completada': { color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', icon: 'fa-circle-check', label: 'Completada' }
        };
        const st = statusConfig[task.status] || statusConfig['pendiente'];

        const materialStatusId = `task-detail-material-status-${task.id}`;
        const itemsTbodyId = `task-detail-items-tbody-${task.id}`;

        bodyEl.innerHTML = `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6 relative overflow-hidden">
                <div class="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full -mr-10 -mt-10 opacity-50 pointer-events-none"></div>
                
                <div class="relative z-10 flex justify-between items-start">
                    <div class="flex gap-4">
                        <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-xl shadow-md shrink-0">
                            <i class="fa-solid fa-list-check"></i>
                        </div>
                        <div>
                            <p class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Detalle de Tarea</p>
                            <h2 class="text-2xl font-black text-gray-800 leading-tight mb-2">${task.description}</h2>
                            
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="px-2.5 py-0.5 rounded-md text-xs font-bold uppercase bg-gray-100 text-gray-600 border border-gray-200">
                                    <i class="fa-regular fa-folder mr-1"></i> ${task.projectName || 'Proyecto'}
                                </span>
                                <span class="px-2.5 py-0.5 rounded-md text-xs font-bold uppercase ${st.bg} ${st.color} border ${st.border} flex items-center gap-1">
                                    <i class="fa-solid ${st.icon}"></i> ${st.label}
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    <button onclick="document.getElementById('task-details-cancel-btn').click()" class="text-gray-400 hover:text-gray-600 transition-colors p-1">
                        <i class="fa-solid fa-xmark text-2xl"></i>
                    </button>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div class="lg:col-span-7 space-y-6">
                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                        <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-4 flex items-center">
                            <i class="fa-solid fa-users mr-2"></i> Equipo de Trabajo
                        </h4>
                        
                        <div class="flex items-center p-3 bg-indigo-50 rounded-xl border border-indigo-100 mb-4 shadow-sm">
                            <div class="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xl border-2 border-white shadow mr-3 shrink-0">
                                ${assigneeInitial}
                            </div>
                            <div class="flex-grow">
                                <p class="text-sm font-bold text-gray-900">${assigneeName}</p>
                                <div class="flex items-center mt-0.5">
                                    <span class="bg-white text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded border border-indigo-200 flex items-center">
                                        <i class="fa-solid fa-star text-yellow-400 mr-1"></i> Responsable
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <div class="flex items-center mb-1">
                                <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Colaboradores de Apoyo</p>
                                <div class="h-px bg-gray-100 flex-grow ml-3"></div>
                            </div>
                            ${additionalMembersHtml}
                        </div>
                    </div>
                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div class="px-5 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                            <h4 class="text-xs font-bold text-gray-700 uppercase tracking-wide">
                                <i class="fa-solid fa-layer-group mr-2 text-blue-500"></i> Ítems a Instalar
                            </h4>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-sm text-left">
                                <thead class="bg-white text-gray-500 border-b border-gray-100 text-xs uppercase">
                                    <tr>
                                        <th class="px-4 py-3 font-semibold">Ítem / Referencia</th>
                                        <th class="px-4 py-3 text-center font-semibold">Total</th>
                                        <th class="px-4 py-3 text-center font-semibold text-orange-600">Pendiente</th>
                                    </tr>
                                </thead>
                                <tbody id="${itemsTbodyId}" class="divide-y divide-gray-50 text-gray-700">
                                    <tr><td colspan="3" class="text-center py-4 text-gray-400 italic">Cargando ítems...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                        <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3 flex items-center">
                            <i class="fa-solid fa-box-open mr-2"></i> Disponibilidad de Material
                        </h4>
                        <div id="${materialStatusId}">
                            <div class="animate-pulse flex space-x-4">
                                <div class="flex-1 space-y-2 py-1">
                                    <div class="h-2 bg-gray-200 rounded"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="lg:col-span-5 space-y-6">
                    <div class="bg-indigo-50 rounded-xl border border-indigo-100 p-5 flex justify-between items-center">
                        <div>
                            <p class="text-xs font-bold text-indigo-400 uppercase mb-1">Fecha Límite</p>
                            <p class="text-lg font-bold text-indigo-900">${formatDate(task.dueDate)}</p>
                        </div>
                        <div class="text-right">
                             <p class="text-xs font-bold text-indigo-400 uppercase mb-1">Creada</p>
                             <p class="text-sm font-medium text-indigo-700">${createdDate}</p>
                        </div>
                    </div>

                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col h-[450px]">
                        <div class="px-4 py-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                            <h4 class="text-xs font-bold text-gray-600 uppercase tracking-wide">
                                <i class="fa-regular fa-comments mr-2"></i> Bitácora
                            </h4>
                            <span class="text-[10px] bg-white border border-gray-200 px-2 py-0.5 rounded text-gray-400">Chat de Tarea</span>
                        </div>
                        
                        <div id="task-comments-list" class="flex-grow overflow-y-auto p-4 space-y-3 custom-scrollbar bg-slate-50">
                            <p class="text-center text-gray-400 text-xs italic pt-4">Cargando historial...</p>
                        </div>

                        <div class="p-3 border-t border-gray-200 bg-white" id="task-comments-section" data-task-id="${task.id}">
                            <div class="flex gap-2">
                                <input type="text" id="task-comment-input" class="flex-grow border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" placeholder="Escribe un comentario...">
                                <button id="task-comment-submit-btn" class="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 transition-colors shadow-sm">
                                    <i class="fa-solid fa-paper-plane"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        if (task.specificSubItemIds && task.specificSubItemIds.length > 0) {
            const loadItems = async () => {
                try {
                    const subItemIds = task.specificSubItemIds;
                    const selectedItems = task.selectedItems || [];
                    const itemsStatus = new Map();
                    const itemIds = [...new Set(selectedItems.map(i => i.itemId))];
                    const itemDocs = await Promise.all(itemIds.map(id => getDoc(doc(db, "projects", task.projectId, "items", id))));

                    const itemsInfo = new Map(itemDocs.map(d => [
                        d.id,
                        d.exists() ? {
                            name: d.data().name,
                            url: d.data().blueprintURL,
                            description: d.data().description
                        } : { name: 'Ítem', url: null, description: '' }
                    ]));

                    itemIds.forEach(id => {
                        const info = itemsInfo.get(id);
                        itemsStatus.set(id, {
                            name: info.name,
                            url: info.url,
                            description: info.description,
                            total: 0,
                            installed: 0
                        });
                    });

                    const subItemIdsSet = new Set(subItemIds);
                    for (const itemInfo of selectedItems) {
                        const itemId = itemInfo.itemId;
                        const q = query(collection(db, "projects", task.projectId, "items", itemId, "subItems"));
                        const snap = await getDocs(q);
                        snap.forEach(d => {
                            if (subItemIdsSet.has(d.id)) {
                                const st = itemsStatus.get(itemId);
                                if (st) {
                                    st.total++;
                                    if (d.data().status === 'Instalado') st.installed++;
                                }
                            }
                        });
                    }

                    let htmlRows = '';
                    itemsStatus.forEach(st => {
                        if (st.total === 0) return;
                        const pending = st.total - st.installed;
                        let nameCellContent = `
                            <div class="flex flex-col">
                                <span class="font-bold text-gray-700 text-sm leading-tight">${st.name}</span>
                                <span class="text-xs text-gray-500 mt-0.5 whitespace-normal break-words leading-snug">
                                    ${st.description || '<span class="italic opacity-50">Sin descripción</span>'}
                                </span>
                            </div>
                        `;
                        if (st.url) {
                            nameCellContent += `
                                <button type="button" class="btn-view-plano mt-2 inline-flex items-center text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded border border-indigo-200 transition-colors w-fit shadow-sm"
                                    data-url="${st.url}" data-name="${st.name}">
                                    <i class="fa-solid fa-file-contract mr-1.5 pointer-events-none"></i> Ver Plano
                                </button>`;
                        }
                        htmlRows += `
                            <tr class="hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                                <td class="px-4 py-3 align-top">${nameCellContent}</td>
                                <td class="px-4 py-3 text-center text-gray-600 align-middle font-mono bg-gray-50/50">${st.total}</td>
                                <td class="px-4 py-3 text-center font-bold align-middle ${pending > 0 ? 'text-orange-600' : 'text-green-600'}">
                                    ${pending > 0 ? pending : '<i class="fa-solid fa-check"></i>'}
                                </td>
                            </tr>`;
                    });

                    const tbody = document.getElementById(itemsTbodyId);
                    if (tbody) {
                        tbody.innerHTML = htmlRows || '<tr><td colspan="3" class="p-4 text-center text-sm text-gray-400">Sin ítems</td></tr>';
                        tbody.onclick = (e) => {
                            const btn = e.target.closest('.btn-view-plano');
                            if (btn) {
                                e.preventDefault();
                                e.stopPropagation();
                                const url = btn.dataset.url;
                                const name = btn.dataset.name;
                                if (typeof window.viewDocument === 'function') {
                                    window.viewDocument(url, name);
                                }
                            }
                        };
                    }
                } catch (e) { console.error(e); }
            };
            loadItems();
        } else {
            document.getElementById(itemsTbodyId).innerHTML = '<tr><td colspan="3" class="p-4 text-center text-sm text-gray-400">No hay ítems asociados.</td></tr>';
        }

        if (task.specificSubItemIds && task.specificSubItemIds.length > 0) {
            loadTaskMaterialStatus(task.id, task.projectId, materialStatusId, 'detail');
        } else {
            document.getElementById(materialStatusId).innerHTML = '<p class="text-sm text-gray-400 italic">No aplica (sin ítems).</p>';
        }

        // Bitácora Comments setup
        const commentsList = document.getElementById('task-comments-list');
        const submitBtn = document.getElementById('task-comment-submit-btn');

        if (submitBtn && commentsList) {
            submitBtn.addEventListener('click', () => addCommentToTask(task.id));
            if (taskCommentListeners.has(task.id)) taskCommentListeners.get(task.id)();

            const qComments = query(collection(db, "tasks", task.id, "comments"), orderBy("createdAt", "asc"));
            const unsubComments = onSnapshot(qComments, (snap) => {
                commentsList.innerHTML = '';
                if (snap.empty) {
                    commentsList.innerHTML = '<div class="flex flex-col items-center justify-center h-full text-gray-300"><i class="fa-regular fa-comment-dots text-3xl mb-2"></i><p class="text-xs">Sin actividad reciente</p></div>';
                    return;
                }
                snap.forEach(doc => {
                    const c = doc.data();
                    const isLog = c.type === 'log';
                    const date = c.createdAt ? c.createdAt.toDate() : new Date();
                    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const isMe = c.userId === currentUser.uid;
                    let msgHtml = '';
                    if (isLog) {
                        msgHtml = `<div class="flex justify-center my-2"><div class="bg-gray-100 text-gray-500 text-[10px] py-1 px-3 rounded-full border border-gray-200 flex items-center gap-1"><i class="fa-solid fa-info-circle"></i> ${c.text} <span class="opacity-60 ml-1">${time}</span></div></div>`;
                    } else {
                        msgHtml = `<div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} mb-3 animate-fade-in">
                                <div class="flex items-end gap-2 max-w-[85%] ${isMe ? 'flex-row-reverse' : 'flex-row'}">
                                    <div class="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600 border border-gray-300 shrink-0">${c.userName.charAt(0)}</div>
                                    <div class="py-2 px-3 rounded-2xl text-sm shadow-sm ${isMe ? 'bg-blue-100 text-blue-900 rounded-br-none' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'}"><p>${c.text}</p></div>
                                </div>
                                <span class="text-[10px] text-gray-400 mt-1 mx-9">${c.userName} • ${time}</span>
                            </div>`;
                    }
                    commentsList.insertAdjacentHTML('beforeend', msgHtml);
                });
                commentsList.scrollTop = commentsList.scrollHeight;
            });
            taskCommentListeners.set(task.id, unsubComments);
        }

        // Action Buttons Setup
        const actionBtnsContainer = document.createElement('div');
        actionBtnsContainer.className = 'flex flex-wrap gap-2 mr-auto';

        if (currentUserRole === 'admin') {
            actionBtnsContainer.innerHTML += `
                <button data-action="edit-task" data-id="${task.id}" class="text-yellow-600 hover:text-yellow-800 hover:bg-yellow-50 font-bold py-2 px-3 rounded-lg text-sm transition-colors flex items-center border border-yellow-200">
                    <i class="fa-solid fa-pen-to-square mr-2"></i> Editar
                </button>`;
        }
        if (task.status === 'pendiente' && task.specificSubItemIds && task.specificSubItemIds.length > 0) {
            const progressBtn = document.createElement('button');
            progressBtn.dataset.action = 'register-task-progress';
            progressBtn.dataset.taskId = task.id;
            progressBtn.className = "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:shadow-lg transition-all flex items-center transform hover:-translate-y-0.5 text-sm";
            progressBtn.innerHTML = `<i class="fa-solid fa-camera mr-2"></i> Registrar Avance`;
            const materialBtn = document.createElement('button');
            materialBtn.dataset.action = 'request-material-from-task';
            materialBtn.dataset.projectId = task.projectId;
            materialBtn.dataset.taskId = task.id;
            materialBtn.className = "bg-white border border-purple-200 text-purple-600 hover:bg-purple-50 font-bold py-2 px-4 rounded-lg shadow-sm transition-colors text-sm flex items-center";
            materialBtn.innerHTML = `<i class="fa-solid fa-dolly mr-2"></i> Pedir Material`;
            actionBtnsContainer.appendChild(progressBtn);
            actionBtnsContainer.appendChild(materialBtn);
        }
        if (task.status === 'pendiente') {
            actionBtnsContainer.innerHTML += `
                <button data-action="complete-task" data-id="${task.id}" class="text-green-600 hover:text-green-800 hover:bg-green-50 border border-green-200 font-bold py-2 px-3 rounded-lg text-sm transition-colors ml-2" title="Marcar como completada">
                    <i class="fa-solid fa-check-double mr-1"></i> Completar
                </button>`;
        }
        actionsEl.insertBefore(actionBtnsContainer, actionsEl.firstChild);

    } catch (error) {
        console.error("Error modal tarea:", error);
        titleEl.textContent = 'Error';
        bodyEl.innerHTML = `<div class="p-8 text-center text-red-500 bg-red-50 rounded-xl border border-red-100"><i class="fa-solid fa-triangle-exclamation text-3xl mb-2"></i><p>${error.message}</p></div>`;
    }
}

export async function openSafetyCheckInModal(callbackOnSuccess, taskId) {
    window.onSafetyCheckInSuccess = callbackOnSuccess; 

    const modal = document.getElementById('safety-checkin-modal');
    const step1 = document.getElementById('checkin-step-1-face');
    const step2 = document.getElementById('checkin-step-2-epp');
    const videoEl = document.getElementById('checkin-video-feed');
    const canvasEl = document.getElementById('checkin-video-canvas');
    const takePhotoButton = document.getElementById('checkin-take-photo-btn');
    const faceStatus = document.getElementById('checkin-face-status');
    const eppList = document.getElementById('checkin-epp-list');
    const confirmBtn = document.getElementById('checkin-confirm-btn');

    const currentUser = deps.getCurrentUser();

    if (step1) step1.classList.remove('hidden');
    if (step2) step2.classList.add('hidden');
    
    if (confirmBtn) {
        confirmBtn.classList.add('hidden');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-shield-check"></i> <span>Autorizar Avance</span>';
        if (taskId) {
            confirmBtn.dataset.taskId = taskId;
        } else {
            delete confirmBtn.dataset.taskId;
        }
    }
    
    if (takePhotoButton) {
        takePhotoButton.classList.remove('hidden');
        takePhotoButton.disabled = false;
        takePhotoButton.innerHTML = '<i class="fa-solid fa-camera"></i> <span>Escanear Rostro</span>';
    }
    
    if (faceStatus) faceStatus.textContent = 'Esperando cámara...';
    if (eppList) eppList.innerHTML = '<p class="text-gray-400">Cargando dotación...</p>';

    if (modal) modal.style.display = 'flex';

    try {
        if (window.videoStream) {
            window.videoStream.getTracks().forEach(track => track.stop());
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: true
        });
        window.videoStream = stream;
        if (videoEl) videoEl.srcObject = stream;
    } catch (err) {
        console.error("Error al acceder a la cámara:", err);
        if (faceStatus) faceStatus.textContent = "Error al acceder a la cámara. Revisa los permisos.";
        return;
    }

    if (eppList) {
        try {
            const historyQuery = query(
                collection(db, "dotacionHistory"),
                where("action", "==", "asignada"),
                where("userId", "==", currentUser.uid),
                where("status", "==", "activo")
            );
            const snapshot = await getDocs(historyQuery);

            if (snapshot.empty) {
                eppList.innerHTML = '<p class="text-sm text-gray-500">No tienes dotación activa asignada.</p>';
                if (confirmBtn) confirmBtn.disabled = false;
            } else {
                let eppHtml = '';
                const catalogIds = snapshot.docs.map(doc => doc.data().itemId);
                const catalogQuery = query(collection(db, "dotacionCatalog"), where("__name__", "in", catalogIds));
                const catalogSnapshot = await getDocs(catalogQuery);
                const catalogMap = new Map(catalogSnapshot.docs.map(doc => [doc.id, doc.data()]));

                snapshot.forEach(doc => {
                    const item = doc.data();
                    const catalogItem = catalogMap.get(item.itemId);
                    let vencimientoHtml = '<span class="text-xs text-green-600">(Vigente)</span>';

                    if (catalogItem && catalogItem.vidaUtilDias && item.fechaEntrega) {
                        const today = new Date(); today.setHours(0, 0, 0, 0);
                        const deliveryDate = new Date(item.fechaEntrega + 'T00:00:00');
                        const expirationDate = new Date(deliveryDate.getTime());
                        expirationDate.setDate(expirationDate.getDate() + catalogItem.vidaUtilDias);
                        const diffTime = expirationDate.getTime() - today.getTime();
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                        if (diffDays <= 0) {
                            vencimientoHtml = `<span class="text-xs text-red-600 font-bold">(VENCIDO)</span>`;
                        } else if (diffDays <= 30) {
                            vencimientoHtml = `<span class="text-xs text-yellow-600 font-bold">(Vence en ${diffDays} días)</span>`;
                        }
                    }

                    eppHtml += `
                        <label class="flex items-center p-2 bg-white border rounded-md">
                            <input type="checkbox" class="h-5 w-5 rounded epp-checkbox">
                            <span class="ml-3 text-sm font-medium">${item.itemName || 'Ítem'}</span>
                            <span class="ml-auto">${vencimientoHtml}</span>
                        </label>
                    `;
                });
                eppList.innerHTML = eppHtml;
            }
        } catch (err) {
            console.error("Error al cargar EPP:", err);
            eppList.innerHTML = '<p class="text-red-500">Error al cargar tu dotación.</p>';
        }
    }
}

export function checkIfSafetyCheckInNeeded() {
    const lastCheckInString = localStorage.getItem('lastSafetyCheckIn');
    if (!lastCheckInString) {
        return true; 
    }

    const lastCheckInDate = new Date(lastCheckInString);
    const today = new Date();

    if (lastCheckInDate.getFullYear() === today.getFullYear() &&
        lastCheckInDate.getMonth() === today.getMonth() &&
        lastCheckInDate.getDate() === today.getDate()) {

        return false; 
    }

    return true; 
}
