// --- Importaciones de Firebase (requeridas por este módulo) ---
import {
    collection,
    query,
    onSnapshot,
    addDoc,
    doc,
    updateDoc,
    deleteDoc,
    orderBy,
    serverTimestamp,
    getDoc,
    writeBatch,
    getDocs,
    where // <-- Importación 'where' para las pestañas
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// --- AÑADIMOS IMPORTACIONES DE STORAGE ---
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

// --- Variables locales del módulo (para almacenar dependencias) ---
let db;
let storage;
let openMainModalCallback;
let closeMainModalCallback;
let openConfirmModalCallback;
let sendNotificationCallback;
let getCurrentUser;
let getUsersMap;

let unsubscribeTools = null;
let toolAssigneeChoices = null; // <-- Para el buscador interactivo

// --- INICIO: Nueva Función de Helper para Redimensionar ---
/**
 * Redimensiona una imagen antes de subirla.
 * @param {File} file - El archivo de imagen original.
 * @param {number} maxWidth - El ancho máximo permitido.
 * @returns {Promise<Blob>} - Una promesa que se resuelve con el Blob de la imagen redimensionada.
 */
function resizeImage(file, maxWidth = 800) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                let width = img.width;
                let height = img.height;

                // Si la imagen es más ancha que el máximo, la redimensionamos
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                // Dibuja la imagen redimensionada en el canvas
                ctx.drawImage(img, 0, 0, width, height);

                // Convierte el canvas a Blob con calidad JPEG
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Error al convertir canvas a Blob.'));
                    }
                }, 'image/jpeg', 0.85); // 85% de calidad
            };
            img.onerror = reject;
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
// --- FIN: Nueva Función de Helper ---


/**
 * Inicializa el módulo de Herramientas, recibiendo las dependencias de app.js
 */
export function initHerramientas(
    firebaseDb,
    firebaseStorage,
    openModalFunc,
    closeModalFunc,
    confirmModalFunc,
    notificationFunc,
    openImageModalFunc,
    userGetter,
    usersMapGetter
) {
    db = firebaseDb;
    storage = firebaseStorage;
    openMainModalCallback = openModalFunc;
    closeMainModalCallback = closeModalFunc;
    openConfirmModalCallback = confirmModalFunc;
    sendNotificationCallback = notificationFunc;
    const openImageModalCallback = openImageModalFunc;
    getCurrentUser = userGetter;
    getUsersMap = usersMapGetter;

    // 1. Conectar los botones de la vista
    document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;

        const toolCard = target.closest('.tool-card');
        const toolId = toolCard?.dataset.id;
        const toolName = toolCard?.dataset.name;
        const assignedToId = toolCard?.dataset.assignedto;

        // Acciones que este módulo debe manejar
        switch (action) {
            case 'new-tool':
                handleOpenToolModal(null, 'new-tool');
                break;
            case 'edit-tool':
                handleOpenToolModal(toolId, 'edit-tool');
                break;
            case 'delete-tool':
                openConfirmModalCallback(`¿Seguro que quieres eliminar "${toolName}"?`, () => {
                    handleDeleteTool(toolId);
                });
                break;
            case 'assign-tool':
                handleOpenToolModal(toolId, 'assign-tool');
                break;
            case 'return-tool':
                handleOpenToolModal(toolId, 'return-tool', assignedToId);
                break;
            case 'view-tool-history':
                handleViewToolHistory(toolId, toolName);
                break;

            case 'view-tool-image':
                const imageUrl = target.dataset.url;
                if (imageUrl) {
                    closeToolHistoryModal();
                    openImageModalCallback(imageUrl);
                }
                break;
        }
    });

    // 2. Conectar el formulario del modal
    const modalForm = document.getElementById('modal-form');

    modalForm.addEventListener('submit', (e) => {
        const type = modalForm.dataset.type;
        const form = e.target;

        if (['new-tool', 'edit-tool', 'assign-tool', 'return-tool'].includes(type)) {

            e.preventDefault();

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            handleSaveTool(form);
        }
    });

    // 3. Conectar botón de cierre del modal de historial
    const historyModal = document.getElementById('tool-history-modal');
    const historyCloseBtn = document.getElementById('tool-history-close-btn');
    if (historyModal && historyCloseBtn) {
        historyCloseBtn.addEventListener('click', closeToolHistoryModal);
    }

    // --- INICIO DE CORRECCIÓN ---

    // 4. Configurar Filtros (Poblarlos se hará por separado)
    const assigneeFilterSelect = document.getElementById('tool-assignee-filter');
    if (assigneeFilterSelect && !toolAssigneeChoices) { // Solo si no se ha inicializado

        // 4a. Dejar el HTML del <select> vacío.
        assigneeFilterSelect.innerHTML = ''; // ¡Completamente vacío!

        // 4b. Inicializar Choices.js con las opciones estáticas
        toolAssigneeChoices = new Choices(assigneeFilterSelect, {
            itemSelectText: 'Seleccionar',
            searchPlaceholderValue: 'Buscar colaborador...',
            allowHTML: false,
            // ¡CAMBIO CLAVE! Añadimos las opciones estáticas aquí
            choices: [
                { value: 'all', label: 'Todos' }
                // (La línea de "bodega" se ha eliminado)
            ]
        });

        // 4c. Seleccionar "Todos" por defecto INMEDIATAMENTE
        toolAssigneeChoices.setChoiceByValue('all');

        // 4d. (Era 4c) Conectar el 'change' event A LA INSTANCIA de Choices.js
        toolAssigneeChoices.passedElement.element.addEventListener('change', () => {
            loadHerramientaView();
        });
    }

    // 5. Conectar las PESTAÑAS (Tabs)
    const tabsNav = document.getElementById('tool-tabs-nav');
    if (tabsNav) {
        tabsNav.addEventListener('click', (e) => {
            const button = e.target.closest('.tool-tab-button');
            if (button && !button.classList.contains('active')) {

                // const statusFilter = button.dataset.statusFilter; // <--- Línea eliminada

                // --- INICIO DE CORRECCIÓN ---
                // ¡El bloque 'if' que estaba aquí se ha eliminado!
                // --- FIN DE CORRECCIÓN ---

                // Actualizar la UI de las pestañas
                tabsNav.querySelectorAll('.tool-tab-button').forEach(btn => {
                    btn.classList.remove('active', 'border-blue-500', 'text-blue-600');
                    btn.classList.add('border-transparent', 'text-gray-500');
                });
                button.classList.add('active', 'border-blue-500', 'text-blue-600');
                button.classList.remove('border-transparent', 'text-gray-500');

                loadHerramientaView();
            }
        });
    }

    // 6. Conectar el BUSCADOR POR NOMBRE
    const searchInput = document.getElementById('tool-search-input');
    let searchTimeout = null;
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            // Espera 300ms después de que el usuario deja de teclear
            searchTimeout = setTimeout(() => {
                loadHerramientaView();
            }, 300);
        });
    }
    // --- FIN DE CORRECCIÓN ---
}

/**
 * Puebla la lista de usuarios en el filtro de asignación de herramientas.
 * Debe ser llamada por app.js DESPUÉS de que el usersMap esté listo.
 */
export function updateToolFilterOptions(usersMap) {
    if (!toolAssigneeChoices) {
        console.warn("Choices.js de Herramientas (toolAssigneeChoices) no está listo.");
        return;
    }

    // 1. Generar SÓLO las opciones de usuario
    const userOptions = Array.from(usersMap.entries())
        .filter(([id, user]) =>
            user.status === 'active' &&
            id.toLowerCase() !== 'all' &&
            user.firstName.toLowerCase() !== 'all'
        )
        .sort((a, b) => a[1].firstName.localeCompare(b[1].firstName))
        .map(([id, user]) => ({
            value: id,
            label: `${user.firstName} ${user.lastName}`
        }));

    // 2. Añadir SÓLO los usuarios a la lista existente
    // El 'false' al final significa AÑADIR, no reemplazar.
    toolAssigneeChoices.setChoices(userOptions, 'value', 'label', false);

    // 3. (La línea de setChoiceByValue se elimina de aquí, ya está en init)
}

/**
 * Resetea la vista de Herramientas a su estado por defecto y carga los datos.
 * Esta función es llamada por app.js cuando se hace clic en el menú.
 */
export function resetToolViewAndLoad() {
    // 1. Resetea visualmente las pestañas a "Disponible"
    const tabsNav = document.getElementById('tool-tabs-nav');
    if (tabsNav) {
        tabsNav.querySelectorAll('.tool-tab-button').forEach(btn => {
            const isDefault = btn.dataset.statusFilter === 'disponible';
            btn.classList.toggle('active', isDefault);
            btn.classList.toggle('border-blue-500', isDefault);
            btn.classList.toggle('text-blue-600', isDefault);
            btn.classList.toggle('border-transparent', !isDefault);
            btn.classList.toggle('text-gray-500', !isDefault);
        });
    }

    // 2. Resetea los filtros y el layout
    const searchInput = document.getElementById('tool-search-input');
    const searchContainer = document.getElementById('tool-search-container');
    const assigneeContainer = document.getElementById('tool-assignee-container');

    if (searchInput) searchInput.value = '';

    if (toolAssigneeChoices) {
        // Arregla el bug de "all" vs "Todos"
        toolAssigneeChoices.setChoiceByValue('all');

    }

    // Oculta asignación, expande búsqueda
    if (assigneeContainer) assigneeContainer.classList.add('hidden');
    if (searchContainer) {
        searchContainer.classList.remove('md:col-span-2');
        searchContainer.classList.add('md:col-span-3');
    }

    // 3. Carga la vista
    loadHerramientaView();
}


/**
 * Carga la vista de Herramientas y activa el listener de Firestore.
 * (MODIFICADO: Ya no crea ni destruye Choices.js)
 */
export function loadHerramientaView() {
    const gridContainer = document.getElementById('tools-grid-container');
    const searchContainer = document.getElementById('tool-search-container');
    const assigneeContainer = document.getElementById('tool-assignee-container');

    // Quitamos la dependencia de 'assigneeFilterSelect' ya que 'toolAssigneeChoices' es global
    if (!gridContainer || !searchContainer || !assigneeContainer || !toolAssigneeChoices) return;
    if (unsubscribeTools) unsubscribeTools();

    // 1. Leer los valores actuales de TODOS los filtros
    const statusFilter = document.querySelector('#tool-tabs-nav .active')?.dataset.statusFilter || 'disponible';
    const searchTerm = document.getElementById('tool-search-input').value.toLowerCase();
    const assigneeFilter = toolAssigneeChoices.getValue(true) || 'all';

    // 2. Lógica de Layout (basada en la pestaña activa)
    if (statusFilter === 'asignada') {
        searchContainer.classList.remove('md:col-span-3');
        searchContainer.classList.add('md:col-span-2');
        assigneeContainer.classList.remove('hidden');
    } else {
        searchContainer.classList.remove('md:col-span-2');
        searchContainer.classList.add('md:col-span-3');
        assigneeContainer.classList.add('hidden');

        // --- INICIO DE LA CORRECCIÓN ---
        // Si el filtro se va a ocultar, lo reseteamos a "Todos".
        if (toolAssigneeChoices) {
            toolAssigneeChoices.setChoiceByValue('all');

        }
        // --- FIN DE LA CORRECCIÓN ---
    }

    // 3. (Query a Firestore, sin cambios)
    const toolsQuery = query(
        collection(db, "tools"),
        where("status", "==", statusFilter),
        orderBy("name")
    );

    unsubscribeTools = onSnapshot(toolsQuery, (snapshot) => {
        gridContainer.innerHTML = '';
        const usersMap = getUsersMap();

        // 4. (Filtrado JS, sin cambios)
        let tools = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (assigneeFilter === 'bodega') {
            tools = tools.filter(tool => !tool.assignedTo);
        } else if (assigneeFilter !== 'all') {
            tools = tools.filter(tool => tool.assignedTo === assigneeFilter);
        }
        if (searchTerm) {
            tools = tools.filter(tool =>
                tool.name.toLowerCase().includes(searchTerm) ||
                (tool.reference && tool.reference.toLowerCase().includes(searchTerm))
            );
        }

        // 5. Renderizar los resultados filtrados
        if (tools.length === 0) {
            let emptyMessage = "No se encontraron herramientas con esos filtros.";
            if (!searchTerm && assigneeFilter === 'all') {
                if (statusFilter === 'disponible') emptyMessage = "No hay herramientas disponibles en bodega.";
                if (statusFilter === 'asignada') emptyMessage = "No hay herramientas asignadas.";
                if (statusFilter === 'en_reparacion') emptyMessage = "No hay herramientas en reparación.";
            }

            gridContainer.innerHTML = `
                <div class="md:col-span-2 min-h-[300px] flex items-center justify-center">
                    <p class="text-gray-500 text-center text-lg">${emptyMessage}</p>
                </div>
            `;
            return;
        }

        tools.forEach(tool => {
            const card = createToolCard(tool, usersMap);
            gridContainer.appendChild(card);
        });

    }, (error) => {
        console.error("Error al cargar herramientas:", error);
        gridContainer.innerHTML = `<p class="text-red-500 text-center md:col-span-2">Error al cargar datos.</p>`;
    });
}

/**
 * Crea el HTML para una TARJETA de herramienta. (Sin cambios)
 */
function createToolCard(tool, usersMap) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden flex flex-col tool-card';
    card.dataset.id = tool.id;
    card.dataset.name = tool.name;
    card.dataset.assignedto = tool.assignedTo || '';

    const assignedToUser = usersMap.get(tool.assignedTo);
    const assignedToName = assignedToUser ? `${assignedToUser.firstName} ${assignedToUser.lastName}` : 'En Bodega';

    let statusText, statusColor, actionButton;

    // Lógica de botones dinámicos
    if (tool.status === 'asignada') {
        statusText = 'Asignada';
        statusColor = 'bg-yellow-100 text-yellow-800';
        actionButton = `<button data-action="return-tool" class="bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">Recibir (Devolver)</button>`;
    } else if (tool.status === 'en_reparacion') {
        statusText = 'En Reparación';
        statusColor = 'bg-red-100 text-red-800';
        actionButton = `<button data-action="return-tool" class="bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">Recibir (de Taller)</button>`;
    } else { // 'disponible'
        statusText = 'Disponible';
        statusColor = 'bg-green-100 text-green-800';
        actionButton = `<button data-action="assign-tool" class="bg-green-500 hover:bg-green-600 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">Asignar</button>`;
    }

    card.innerHTML = `
        <div class="flex-grow flex">
            
            <div class="w-1/3 flex-shrink-0 aspect-square bg-gray-100"> 
                <img 
                    src="${tool.photoURL || 'https://via.placeholder.com/300'}" 
                    alt="${tool.name}" 
                    class="w-full h-full object-contain cursor-pointer" 
                    data-action="view-tool-image"
                    data-url="${tool.photoURL || 'https://via.placeholder.com/300'}"
                >
            </div>
            
            <div class="w-2/3 flex-grow p-4 flex flex-col">
                <h3 class="text-lg font-bold text-gray-900">${tool.name}</h3>
                <p class="text-sm text-gray-500 mb-3">${tool.reference || 'Sin referencia'}</p>
                
                <div class="text-sm space-y-2 mt-auto">
                    <div class="flex justify-between items-center">
                        <span class="font-medium text-gray-600">Estado:</span>
                        <span class="px-2 py-0.5 text-xs font-semibold rounded-full ${statusColor}">${statusText}</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="font-medium text-gray-600">Ubicación:</span>
                        <span class="font-medium text-gray-800 truncate" title="${assignedToName}">${assignedToName}</span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="bg-gray-50 p-3 border-t grid grid-cols-3 gap-2">
            ${actionButton}
            <button data-action="view-tool-history" class="bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold py-2 px-3 rounded-lg w-full">Historial</button>
            <button data-action="edit-tool" class="bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">Editar</button>
        </div>
    `;
    return card;
}

/**
 * Pide al modal principal (en app.js) que se abra para una acción de herramienta. (Sin cambios)
 */
async function handleOpenToolModal(toolId = null, actionType = 'edit-tool', assignedToId = null) {
    let data = {};
    let modalType = actionType;

    if (actionType === 'new-tool') {
        openMainModalCallback('new-tool');
    } else {
        const toolRef = doc(db, "tools", toolId);
        const toolSnap = await getDoc(toolRef);
        if (toolSnap.exists()) {
            data = toolSnap.data();
            data.id = toolId;
            if (actionType === 'return-tool') {
                data.assignedToId = assignedToId;
            }
            openMainModalCallback(modalType, data);
        } else {
            alert("Error: No se encontró la herramienta.");
        }
    }
}

/**
 * Guarda (Crea, Actualiza, Asigna o Devuelve) una herramienta. (Sin cambios)
 */
async function handleSaveTool(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const type = form.dataset.type;
    const id = form.dataset.id;
    const currentUser = getCurrentUser();

    if (!currentUser) {
        alert("Error: No se pudo identificar al usuario.");
        return;
    }

    const confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Guardando...';

    try {
        const batch = writeBatch(db);

        if (type === 'new-tool') {
            const photoFile = data.photo;

            const newToolRef = doc(collection(db, "tools"));
            const newToolId = newToolRef.id;

            confirmBtn.textContent = 'Redimensionando foto...';
            const resizedBlob = await resizeImage(photoFile, 800);
            confirmBtn.textContent = 'Subiendo foto...';

            const photoPath = `tools_photos/${newToolId}/${photoFile.name}`;
            const photoStorageRef = ref(storage, photoPath);
            await uploadBytes(photoStorageRef, resizedBlob);
            const downloadURL = await getDownloadURL(photoStorageRef);

            const toolData = {
                name: data.name,
                reference: data.reference,
                photoURL: downloadURL,
                status: 'disponible',
                assignedTo: null,
                createdAt: serverTimestamp(),
                lastUpdatedBy: currentUser.uid,
            };

            batch.set(newToolRef, toolData);

        } else if (type === 'edit-tool') {
            const toolRef = doc(db, "tools", id);
            batch.update(toolRef, {
                name: data.name,
                reference: data.reference,
                lastUpdatedBy: currentUser.uid,
                updatedAt: serverTimestamp()
            });

        } else if (type === 'assign-tool') {
            const toolRef = doc(db, "tools", id);
            const assigneeId = data.assignedTo;
            const toolName = data.toolName;

            const assignPhotoFile = data.assignPhoto;
            const assignComments = data.assignComments || "";

            confirmBtn.textContent = 'Redimensionando foto...';
            const resizedBlob = await resizeImage(assignPhotoFile, 800);
            confirmBtn.textContent = 'Subiendo foto...';

            const photoPath = `tool_assignments/${id}/${Date.now()}_${assignPhotoFile.name}`;
            const photoStorageRef = ref(storage, photoPath);
            await uploadBytes(photoStorageRef, resizedBlob);
            const downloadURL = await getDownloadURL(photoStorageRef);

            batch.update(toolRef, {
                status: 'asignada',
                assignedTo: assigneeId,
                lastUpdatedBy: currentUser.uid,
                updatedAt: serverTimestamp()
            });

            const historyRef = doc(collection(db, "tools", id, "history"));
            batch.set(historyRef, {
                action: 'asignada',
                userId: assigneeId,
                adminId: currentUser.uid,
                timestamp: serverTimestamp(),
                assignPhotoURL: downloadURL,
                assignComments: assignComments
            });

            sendNotificationCallback(
                assigneeId,
                'Herramienta Asignada',
                `Se te ha asignado la herramienta: ${toolName}.`,
                'herramienta'
            );

        } else if (type === 'return-tool') {
            const toolRef = doc(db, "tools", id);
            const returnPhotoFile = data.returnPhoto;
            const toolName = data.toolName;
            const originalAssigneeId = data.originalAssigneeId;

            const returnStatus = data.returnStatus;
            const returnComments = data.returnComments || "";

            const newToolStatus = (returnStatus === 'dañado') ? 'en_reparacion' : 'disponible';

            confirmBtn.textContent = 'Redimensionando foto...';
            const resizedBlob = await resizeImage(returnPhotoFile, 800);
            confirmBtn.textContent = 'Subiendo foto...';

            const photoPath = `tool_returns/${id}/${Date.now()}_${returnPhotoFile.name}`;
            const photoStorageRef = ref(storage, photoPath);
            await uploadBytes(photoStorageRef, resizedBlob);
            const downloadURL = await getDownloadURL(photoStorageRef);

            batch.update(toolRef, {
                status: newToolStatus,
                assignedTo: null,
                lastUpdatedBy: currentUser.uid,
                updatedAt: serverTimestamp()
            });

            const historyRef = doc(collection(db, "tools", id, "history"));
            batch.set(historyRef, {
                action: 'devuelta',
                adminId: currentUser.uid,
                timestamp: serverTimestamp(),
                returnPhotoURL: downloadURL,
                returnStatus: returnStatus,
                returnComments: returnComments
            });

            if (originalAssigneeId) {
                sendNotificationCallback(
                    originalAssigneeId,
                    'Devolución Recibida',
                    `Recibimos tu devolución de la herramienta: ${toolName}.`,
                    'herramienta'
                );
            }
        }

        await batch.commit();
        closeMainModalCallback();

    } catch (error) {
        console.error("Error al guardar herramienta:", error);
        alert("Error: " + error.message);
    } finally {
        confirmBtn.disabled = false;

        const type = form.dataset.type;
        if (type === 'new-tool') confirmBtn.textContent = 'Crear Herramienta';
        else if (type === 'edit-tool') confirmBtn.textContent = 'Guardar Cambios';
        else if (type === 'assign-tool') confirmBtn.textContent = 'Confirmar Asignación';
        else if (type === 'return-tool') confirmBtn.textContent = 'Confirmar Devolución';
        else confirmBtn.textContent = 'Guardar';
    }
}

/**
 * Elimina una herramienta de Firestore. (Sin cambios)
 */
async function handleDeleteTool(toolId) {
    try {
        const toolRef = doc(db, "tools", toolId);
        await deleteDoc(toolRef);
    } catch (error) {
        console.error("Error al eliminar herramienta:", error);
        alert("Error al eliminar la herramienta.");
    }
}

/**
 * Abre un modal y muestra el historial de una herramienta específica. (Sin cambios)
 */
async function handleViewToolHistory(toolId, toolName) {
    const modal = document.getElementById('tool-history-modal');
    const title = document.getElementById('tool-history-title');
    const body = document.getElementById('tool-history-body');

    if (!modal || !title || !body) return;

    title.textContent = `Historial de: ${toolName}`;
    body.innerHTML = '<p class="text-gray-500 text-center">Cargando historial...</p>';
    modal.style.display = 'flex';

    const usersMap = getUsersMap();

    try {
        const historyQuery = query(
            collection(db, "tools", toolId, "history"),
            orderBy("timestamp", "desc")
        );
        const snapshot = await getDocs(historyQuery);

        if (snapshot.empty) {
            body.innerHTML = '<p class="text-gray-500 text-center">No hay historial para esta herramienta.</p>';
            return;
        }

        body.innerHTML = '';

        snapshot.forEach(doc => {
            const entry = doc.data();
            const timestamp = entry.timestamp ? entry.timestamp.toDate() : new Date();
            const dateString = timestamp.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
            const timeString = timestamp.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

            const adminUser = usersMap.get(entry.adminId);
            const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : 'Sistema';

            let entryHtml = '';

            if (entry.action === 'asignada') {
                const targetUser = usersMap.get(entry.userId);
                const targetName = targetUser ? `${targetUser.firstName} ${targetUser.lastName}` : 'Usuario Desconocido';

                entryHtml = `
                    <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <p class="font-semibold text-yellow-800">Asignada a: ${targetName}</p>
                        <p class="text-sm text-gray-600">Entregado por: ${adminName}</p>
                        
                        ${entry.assignComments ? `<p class="text-sm text-gray-800 mt-2 p-2 bg-white border rounded-md"><strong>Observación:</strong> ${entry.assignComments}</p>` : ''}

                        ${entry.assignPhotoURL ? `<button data-action="view-tool-image" data-url="${entry.assignPhotoURL}" class="text-sm text-blue-600 hover:underline mt-2 inline-block font-medium">Ver foto de entrega</button>` : ''}
                        
                        <p class="text-xs text-gray-500 mt-1">${dateString} - ${timeString}</p>
                    </div>
                `;

            } else if (entry.action === 'devuelta') {

                let statusText = '';
                switch (entry.returnStatus) {
                    case 'bueno':
                        statusText = '<span class="font-medium text-green-700">Estado: Bueno</span>';
                        break;
                    case 'con_defecto':
                        statusText = '<span class="font-medium text-yellow-700">Estado: Con Defecto</span>';
                        break;
                    case 'dañado':
                        statusText = '<span class="font-medium text-red-700">Estado: Dañado</span>';
                        break;
                    default:
                        statusText = '<span class="font-medium text-gray-700">Estado: N/A</span>';
                }

                entryHtml = `
                    <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div class="flex justify-between items-start">
                            <p class="font-semibold text-blue-800">Devuelta a Bodega</p>
                            ${statusText}
                        </div>
                        <p class="text-sm text-gray-600">Recibido por: ${adminName}</p>
                        
                        ${entry.returnComments ? `<p class="text-sm text-gray-800 mt-2 p-2 bg-white border rounded-md"><strong>Comentario:</strong> ${entry.returnComments}</p>` : ''}
                        
                        ${entry.returnPhotoURL ? `<button data-action="view-tool-image" data-url="${entry.returnPhotoURL}" class="text-sm text-blue-600 hover:underline mt-2 inline-block font-medium">Ver foto de devolución</button>` : ''}
                        
                        <p class="text-xs text-gray-500 mt-1">${dateString} - ${timeString}</p>
                    </div>
                `;
            }

            body.innerHTML += entryHtml;
        });

    } catch (error) {
        console.error("Error al cargar historial:", error);
        body.innerHTML = '<p class="text-red-500 text-center">Error al cargar el historial.</p>';
    }
}
// --- FIN: Nueva Función para Ver Historial ---


/**
 * Cierra el modal de historial de herramienta. (Sin cambios)
 */
function closeToolHistoryModal() {
    const modal = document.getElementById('tool-history-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}