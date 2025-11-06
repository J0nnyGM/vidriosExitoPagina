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
    where, // <-- Importación 'where' para las pestañas
    collectionGroup // <-- AÑADIR ESTA LÍNEA
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// --- AÑADIMOS IMPORTACIONES DE STORAGE ---
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

export const TOOL_CATEGORIES = [
    { value: "electrica", label: "Herramienta Eléctrica" },
    { value: "manual", label: "Herramienta Manual" },
    { value: "medicion", label: "Equipo de Medición" },
    { value: "seguridad", label: "Equipo de Seguridad" },
    { value: "andamios", label: "Andamios y Escaleras" },
    { value: "otro", label: "Otro" }
];

// --- Variables locales del módulo (para almacenar dependencias) ---
let db;
let storage;
let openMainModalCallback;
let closeMainModalCallback;
let openConfirmModalCallback;
let sendNotificationCallback;
let getCurrentUser;
let getUsersMap;
let getCurrentUserRole; // <-- AÑADE ESTA LÍNEA

let unsubscribeTools = null;
let toolAssigneeChoices = null;
let toolCategoryChoices = null;

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
    usersMapGetter,
    userRoleGetter // <-- AÑADE ESTA LÍNEA
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
    getCurrentUserRole = userRoleGetter; // <-- AÑADE ESTA LÍNEA

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

            case 'register-maintenance':
                handleOpenToolModal(toolId, 'register-maintenance');
                break;
            case 'decommission-tool':
                openConfirmModal(`¿Seguro que quieres "Dar de Baja" (retirar) la herramienta "${toolName}"? Esta acción guardará la herramienta en el historial de "Retiradas" y no se puede deshacer.`, () => {
                    handleDecommissionTool(toolId);
                });
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

        // --- INICIO DE CORRECCIÓN ---
        if (['new-tool', 'edit-tool', 'assign-tool', 'return-tool', 'register-maintenance'].includes(type)) {
            // --- FIN DE CORRECCIÓN ---

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
        assigneeFilterSelect.addEventListener('change', () => {
            console.log('Filtro de Asignación CAMBIÓ'); // <-- Para depurar
            loadHerramientaView();
        });
        // --- INICIO DE CÓDIGO AÑADIDO (CATEGORÍA) ---
        // 4e. Inicializar el filtro de Categoría
        const categoryFilterSelect = document.getElementById('tool-category-filter');
        if (categoryFilterSelect && !toolCategoryChoices) {
            // Creamos las opciones, añadiendo "Todas" al principio
            const categoryOptions = [
                { value: 'all', label: 'Todas las Categorías' },
                ...TOOL_CATEGORIES
            ];

            toolCategoryChoices = new Choices(categoryFilterSelect, {
                itemSelectText: 'Seleccionar',
                allowHTML: false,
                choices: categoryOptions,
                searchEnabled: false,
            });

            toolCategoryChoices.setChoiceByValue('all'); // Por defecto

            // 4f. Conectar el 'change' event
            categoryFilterSelect.addEventListener('change', () => {
                console.log('Filtro de Categoría CAMBIÓ'); // <-- Para depurar
                loadHerramientaView();
            });
        }
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
    const role = getCurrentUserRole();

    // 1. Obtenemos el elemento del título
    const titleElement = document.getElementById('herramienta-view-title');

    // Ocultar/Mostrar elementos según el rol
    const newToolBtn = document.getElementById('new-tool-btn');
    const tabsNav = document.getElementById('tool-tabs-nav');
    const filterBar = document.getElementById('tool-filter-bar');

    if (newToolBtn) newToolBtn.classList.toggle('hidden', role === 'operario');
    if (tabsNav) tabsNav.classList.toggle('hidden', role === 'operario');
    if (filterBar) filterBar.classList.toggle('hidden', role === 'operario');

    if (role === 'operario') {
        // --- INICIO DE LA MODIFICACIÓN ---
        // 2. Cambiamos el título para el operario
        if (titleElement) {
            const currentUser = getCurrentUser(); // Obtenemos el usuario actual
            const usersMap = getUsersMap(); // Obtenemos el mapa de usuarios
            let userName = 'Operario'; // Nombre por defecto

            // Buscamos el nombre del usuario en el mapa
            if (currentUser && usersMap.has(currentUser.uid)) {
                const userData = usersMap.get(currentUser.uid);
                // Usamos el primer nombre (o 'Usuario' si no tiene)
                userName = userData.firstName || 'Usuario';
            }

            // Asignamos el nuevo título personalizado
            titleElement.textContent = `Herramientas Asignadas a ${userName}`;
        }
        // --- FIN DE LA MODIFICACIÓN ---

        // VISTA DE OPERARIO
        document.getElementById('tools-grid-container')?.classList.remove('hidden');
        document.getElementById('tool-dashboard-container')?.classList.add('hidden');

        loadHerramientaView(); // loadHerramientaView ahora se encarga de forzar el filtro

    } else {
        // 3. Nos aseguramos de que el título sea el original para admin/bodega
        if (titleElement) {
            titleElement.textContent = 'Gestión de Herramientas';
        }

        // VISTA DE ADMIN/BODEGA (Lógica existente)
        if (tabsNav) {
            tabsNav.querySelectorAll('.tool-tab-button').forEach(btn => {
                const isDefault = btn.dataset.statusFilter === 'resumen';
                btn.classList.toggle('active', isDefault);
                btn.classList.toggle('border-blue-500', isDefault);
                btn.classList.toggle('text-blue-600', isDefault);
                btn.classList.toggle('border-transparent', !isDefault);
                btn.classList.toggle('text-gray-500', !isDefault);
            });
        }

        const searchInput = document.getElementById('tool-search-input');
        if (searchInput) searchInput.value = '';

        if (toolAssigneeChoices) {
            toolAssigneeChoices.setChoiceByValue('all');
        }
        if (toolCategoryChoices) {
            toolCategoryChoices.setChoiceByValue('all');
        }

        loadHerramientaView();
    }
}


/**
 * Carga la vista de Herramientas y activa el listener de Firestore.
 * (MODIFICADO: Ya no crea ni destruye Choices.js)
 */
export function loadHerramientaView() {
    const gridContainer = document.getElementById('tools-grid-container');
    const searchContainer = document.getElementById('tool-search-container');
    const assigneeContainer = document.getElementById('tool-assignee-container');
    const dashboardContainer = document.getElementById('tool-dashboard-container');
    const categoryContainer = document.getElementById('tool-category-container');
    const filtersBar = document.getElementById('tool-filter-bar');

    if (!gridContainer || !searchContainer || !assigneeContainer || !toolAssigneeChoices || !dashboardContainer || !filtersBar || !categoryContainer) return;
    if (unsubscribeTools) unsubscribeTools();

    // --- INICIO DE LA CORRECCIÓN ---
    // 1. Obtener el ROL y el USUARIO primero
    const role = getCurrentUserRole();
    const currentUser = getCurrentUser();

    // 2. Determinar el filtro de estado BASADO en el ROL
    let statusFilter;
    if (role === 'operario') {
        statusFilter = 'asignada'; // El operario SIEMPRE ve 'asignada'
    } else {
        // Admin/Bodega usa las pestañas
        statusFilter = document.querySelector('#tool-tabs-nav .active')?.dataset.statusFilter || 'resumen';
    }

    // 3. Leer los filtros restantes
    const searchTerm = document.getElementById('tool-search-input').value.toLowerCase();
    const categoryFilter = (toolCategoryChoices && toolCategoryChoices.getValue(true)) ? toolCategoryChoices.getValue(true) : 'all';
    let assigneeFilter = (toolAssigneeChoices && toolAssigneeChoices.getValue(true)) ? toolAssigneeChoices.getValue(true) : 'all';

    // 4. Lógica de Layout (basada en el statusFilter determinado)
    if (statusFilter === 'resumen') {
        // Esta rama ahora solo será ejecutada por Admin/Bodega
        searchContainer.classList.add('hidden');
        assigneeContainer.classList.add('hidden');
        filtersBar.classList.add('hidden');
        categoryContainer.classList.add('hidden');
        gridContainer.classList.add('hidden');
        dashboardContainer.classList.remove('hidden');

        loadToolDashboard(dashboardContainer);
        return;

    } else {
        // Esta rama es para Admin/Bodega (en otras pestañas) Y para Operario
        searchContainer.classList.remove('hidden');
        filtersBar.classList.remove('hidden');
        categoryContainer.classList.remove('hidden');
        gridContainer.classList.remove('hidden');
        dashboardContainer.classList.add('hidden');
    }

    // 5. Lógica de Layout de Filtros (basada en rol y estado)
    if (role === 'operario') {
        // Operario: Ocultar filtros
        searchContainer.classList.remove('md:col-span-2');
        searchContainer.classList.add('md:col-span-3'); // El buscador (aunque se oculte)
        assigneeContainer.classList.add('hidden');
        // ¡Asegurarse de que los filtros estén ocultos!
        filtersBar.classList.add('hidden');

    } else if (statusFilter === 'asignada') {
        // Admin/Bodega en pestaña 'asignada'
        searchContainer.classList.remove('md:col-span-3');
        searchContainer.classList.add('md:col-span-2');
        assigneeContainer.classList.remove('hidden');
    } else {
        // Admin/Bodega en otras pestañas
        searchContainer.classList.remove('md:col-span-2');
        searchContainer.classList.add('md:col-span-3');
        assigneeContainer.classList.add('hidden');
        if (toolAssigneeChoices) {
            toolAssigneeChoices.setChoiceByValue('all');
        }
    }

    // 6. Query a Firestore (condicional por rol)
    let toolsQuery;

    if (role === 'operario') {
        // El operario solo ve sus herramientas asignadas
        // El statusFilter ya es 'asignada', pero la consulta es MÁS específica
        toolsQuery = query(
            collection(db, "tools"),
            where("status", "==", "asignada"),
            where("assignedTo", "==", currentUser.uid), // <-- Filtro clave
            orderBy("name")
        );
    } else {
        // Admin/Bodega ve la pestaña seleccionada
        toolsQuery = query(
            collection(db, "tools"),
            where("status", "==", statusFilter), // Usa el 'statusFilter' de las pestañas
            orderBy("name")
        );
    }
    // --- FIN DE LA CORRECCIÓN ---

    unsubscribeTools = onSnapshot(toolsQuery, (snapshot) => {
        gridContainer.innerHTML = '';
        const usersMap = getUsersMap();

        // 7. Filtrado JS (modificado para que el operario no filtre)
        let tools = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Aplicar filtros solo si no es operario
        if (role !== 'operario') {
            if (assigneeFilter !== 'all') {
                tools = tools.filter(tool => tool.assignedTo === assigneeFilter);
            }
            if (searchTerm) {
                tools = tools.filter(tool =>
                    tool.name.toLowerCase().includes(searchTerm) ||
                    (tool.reference && tool.reference.toLowerCase().includes(searchTerm))
                );
            }
            if (categoryFilter !== 'all') {
                tools = tools.filter(tool => tool.category === categoryFilter);
            }
        }

        // 8. Renderizar los resultados filtrados
        if (tools.length === 0) {
            let emptyMessage = "No se encontraron herramientas con esos filtros.";

            // --- INICIO CORRECCIÓN MENSAJE OPERARIO ---
            if (role === 'operario') {
                emptyMessage = "No tienes herramientas asignadas en este momento.";
            }
            // --- FIN CORRECCIÓN MENSAJE OPERARIO ---
            else if (!searchTerm && assigneeFilter === 'all') {
                if (statusFilter === 'disponible') emptyMessage = "No hay herramientas disponibles en bodega.";
                if (statusFilter === 'asignada') emptyMessage = "No hay herramientas asignadas.";
                if (statusFilter === 'en_reparacion') emptyMessage = "No hay herramientas en reparación.";
                if (statusFilter === 'dada_de_baja') emptyMessage = "No hay herramientas retiradas.";
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
 * Crea el HTML para una TARJETA de herramienta. (Actualizada con Categoría y Costo)
 */
function createToolCard(tool, usersMap) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden flex flex-col tool-card';
    card.dataset.id = tool.id;
    card.dataset.name = tool.name;
    card.dataset.assignedto = tool.assignedTo || '';

    // --- OBTENER ROL ACTUAL ---
    const role = getCurrentUserRole();

    const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const category = TOOL_CATEGORIES.find(c => c.value === tool.category);
    const categoryLabel = category ? category.label : (tool.category || 'Sin Categoría');
    const purchaseCostLabel = (tool.purchaseCost && tool.purchaseCost > 0)
        ? currencyFormatter.format(tool.purchaseCost)
        : null;

    const assignedToUser = usersMap.get(tool.assignedTo);
    const assignedToName = assignedToUser ? `${assignedToUser.firstName} ${assignedToUser.lastName}` : 'En Bodega';

    let statusText, statusColor, actionButton, thirdButtonHtml;

    if (role === 'operario') {
        // --- VISTA SIMPLIFICADA PARA OPERARIO ---
        statusText = 'Asignada';
        statusColor = 'bg-yellow-100 text-yellow-800';
        actionButton = ''; // No puede asignar/devolver
        thirdButtonHtml = ''; // No puede editar/eliminar

    } else {
        // --- VISTA COMPLETA PARA ADMIN/BODEGA ---
        if (tool.status === 'asignada') {
            statusText = 'Asignada';
            statusColor = 'bg-yellow-100 text-yellow-800';
            actionButton = `<button data-action="return-tool" class="bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">Recibir (Devolver)</button>`;
        } else if (tool.status === 'en_reparacion') {
            statusText = 'En Reparación';
            statusColor = 'bg-red-100 text-red-800';
            actionButton = `<button data-action="register-maintenance" class="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">Registrar Mantenimiento</button>`;
        } else if (tool.status === 'dada_de_baja') {
            statusText = 'Dada de Baja';
            statusColor = 'bg-gray-200 text-gray-800';
            actionButton = `<button disabled class="bg-gray-400 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">Retirada</button>`;
        } else { // 'disponible'
            statusText = 'Disponible';
            statusColor = 'bg-green-100 text-green-800';
            actionButton = `<button data-action="assign-tool" class="bg-green-500 hover:bg-green-600 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">Asignar</button>`;
        }

        thirdButtonHtml = (tool.status === 'en_reparacion')
            ? `<button data-action="decommission-tool" class="bg-red-700 hover:bg-red-800 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">Dar de Baja</button>`
            : (tool.status === 'dada_de_baja')
                ? `<button data-action="delete-tool" class="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">Eliminar</button>`
                : `<button data-action="edit-tool" class="bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">Editar</button>`;
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
                <div class="flex-grow">
                    <h3 class="text-lg font-bold text-gray-900">${tool.name}</h3>
                    <p class="text-sm text-gray-500">${tool.reference || 'Sin referencia'}</p>
                    
                    <div class="mt-3 text-sm space-y-1">
                        <div>
                            <span class="font-medium text-gray-600">Categoría:</span>
                            <span class="font-semibold text-gray-800">${categoryLabel}</span>
                        </div>
                        ${purchaseCostLabel ? `
                        <div>
                            <span class="font-medium text-gray-600">Costo Adq.:</span>
                            <span class="font-semibold text-gray-800">${purchaseCostLabel}</span>
                        </div>` : ''}
                    </div>
                </div>
                
                <div class="text-sm space-y-2 mt-4 pt-2 border-t">
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
        
        <div class="bg-gray-50 p-3 border-t grid ${role === 'operario' ? 'grid-cols-1' : 'grid-cols-3'} gap-2">
            ${actionButton}
            <button data-action="view-tool-history" class="bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold py-2 px-3 rounded-lg w-full">Historial</button>
            ${thirdButtonHtml}
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
                category: data.category || 'otro', // <-- AÑADIDO
                purchaseCost: parseFloat(data.purchaseCost.replace(/[$. ]/g, '')) || 0, // <-- AÑADIDO
                purchaseDate: data.purchaseDate || null, // <-- AÑADIDO
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
                category: data.category || 'otro', // <-- AÑADIDO
                purchaseCost: parseFloat(data.purchaseCost.replace(/[$. ]/g, '')) || 0, // <-- AÑADIDO
                purchaseDate: data.purchaseDate || null, // <-- AÑADIDO
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
                returnedByUserId: originalAssigneeId, // <-- AÑADE ESTA LÍNEA
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
            }// --- INICIO DE CÓDIGO AÑADIDO ---
        } else if (type === 'register-maintenance') {
            const toolRef = doc(db, "tools", id);

            // 1. Actualizar la herramienta a 'disponible'
            batch.update(toolRef, {
                status: 'disponible',
                lastUpdatedBy: currentUser.uid,
                updatedAt: serverTimestamp()
            });

            // 2. Crear el registro en el historial
            const historyRef = doc(collection(db, "tools", id, "history"));
            batch.set(historyRef, {
                action: 'mantenimiento',
                adminId: currentUser.uid,
                timestamp: serverTimestamp(),
                maintenanceProvider: data.maintenanceProvider || 'No especificado',
                maintenanceCost: parseFloat(data.maintenanceCost.replace(/[$. ]/g, '')) || 0,
                maintenanceNotes: data.maintenanceNotes || ''
            });
            // --- FIN DE CÓDIGO AÑADIDO ---

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
        else if (type === 'register-maintenance') confirmBtn.textContent = 'Finalizar Mantenimiento';
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
 * Cambia el estado de una herramienta a "dada_de_baja".
 */
async function handleDecommissionTool(toolId) {
    try {
        const toolRef = doc(db, "tools", toolId);
        const historyRef = doc(collection(db, "tools", toolId, "history"));
        const currentUser = getCurrentUser();

        // Usar un batch para asegurar que ambas escrituras funcionen
        const batch = writeBatch(db);

        batch.update(toolRef, {
            status: 'dada_de_baja',
            assignedTo: null, // Se quita de cualquier asignación
            lastUpdatedBy: currentUser.uid,
            updatedAt: serverTimestamp()
        });

        batch.set(historyRef, {
            action: 'dada_de_baja',
            adminId: currentUser.uid,
            timestamp: serverTimestamp()
        });

        await batch.commit();

    } catch (error) {
        console.error("Error al dar de baja la herramienta:", error);
        alert("Error al dar de baja la herramienta.");
    }
}

/**
 * Abre un modal y muestra el historial de una herramienta específica. (Sin cambios)
 */
async function handleViewToolHistory(toolId, toolName) {
    const role = getCurrentUserRole(); 
    
    const modal = document.getElementById('tool-history-modal');
    const title = document.getElementById('tool-history-title');
    const body = document.getElementById('tool-history-body');

    if (!modal || !title || !body) return;

    // --- INICIO DE MODIFICACIÓN (TÍTULO) ---
    // Ponemos un título temporal mientras cargan los datos
    title.textContent = `Historial de: ${toolName}`; 
    // --- FIN DE MODIFICACIÓN (TÍTULO) ---
    
    body.innerHTML = '<p class="text-gray-500 text-center">Cargando historial...</p>';
    modal.style.display = 'flex';

    const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const usersMap = getUsersMap();

    try {
        // 1. Cargar el documento principal de la herramienta
        const toolDoc = await getDoc(doc(db, "tools", toolId));
        const toolData = toolDoc.exists() ? toolDoc.data() : {};
        const purchaseCost = toolData.purchaseCost || 0;
        let totalMaintenanceCost = 0;
        
        // --- INICIO DE MODIFICACIÓN (TÍTULO FINAL) ---
        // Construir el título final con el nombre y la referencia
        const toolReference = toolData.reference || null;
        if (toolReference) {
            title.textContent = `Historial de: ${toolName} (${toolReference})`;
        } else {
            title.textContent = `Historial de: ${toolName}`;
        }
        // --- FIN DE MODIFICACIÓN (TÍTULO FINAL) ---
        
        const historyQuery = query(
            collection(db, "tools", toolId, "history"),
            orderBy("timestamp", "desc")
        );
        const snapshot = await getDocs(historyQuery);

        body.innerHTML = ''; // Limpiamos el "Cargando..."

        // --- INICIO DE MODIFICACIÓN (Eliminar referencia del body) ---
        // La línea que imprimía toolData.reference en el body se ha eliminado.
        // --- FIN DE MODIFICACIÓN ---

        if (snapshot.empty) {
            body.innerHTML += '<p class="text-gray-500 text-center">No hay historial para esta herramienta.</p>'; // Usamos +=
            return;
        }

        // 2. Calcular el costo total de mantenimiento (necesitamos un bucle previo)
        snapshot.forEach(doc => {
            if (doc.data().action === 'mantenimiento') {
                totalMaintenanceCost += doc.data().maintenanceCost || 0;
            }
        });

        // 3. Renderizar el resumen de costos SÓLO si NO es operario
        if (role !== 'operario') {
            const costSummaryHtml = `
                <div class="mb-4 grid grid-cols-2 gap-4">
                    <div class="bg-gray-100 p-3 rounded-lg text-center">
                        <p class="text-sm font-medium text-gray-700">Costo de Adquisición</p>
                        <p class="text-2xl font-bold text-gray-900">${currencyFormatter.format(purchaseCost)}</p>
                    </div>
                    <div class="bg-orange-50 p-3 rounded-lg text-center">
                        <p class="text-sm font-medium text-orange-800">Costo Total Mantenimiento</p>
                        <p class="text-2xl font-bold text-orange-900">${currencyFormatter.format(totalMaintenanceCost)}</p>
                    </div>
                </div>
                <hr class="mb-4">
            `;
            body.innerHTML += costSummaryHtml;
        }

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
                
                const targetName = (role === 'operario' && entry.userId === getCurrentUser().uid) 
                    ? "Mí" 
                    : (targetUser ? `${targetUser.firstName} ${targetUser.lastName}` : 'Usuario Desconocido');

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
            } else if (entry.action === 'mantenimiento') {
                // El rol 'operario' no verá esta sección porque está dentro del 'if' que ya filtramos
                entryHtml = `
                    <div class="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <p class="font-semibold text-orange-800">Registro de Mantenimiento</p>
                        <p class="text-sm text-gray-600">Registrado por: ${adminName}</p>
                        
                        <div class="text-sm text-gray-800 mt-2 p-2 bg-white border rounded-md space-y-1">
                            <p><strong>Proveedor:</strong> ${entry.maintenanceProvider || 'N/A'}</p>
                            <p><strong>Costo:</strong> ${currencyFormatter.format(entry.maintenanceCost || 0)}</p>
                            ${entry.maintenanceNotes ? `<p><strong>Notas:</strong> ${entry.maintenanceNotes}</p>` : ''}
                        </div>
                        
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


/**
 * Cierra el modal de historial de herramienta. (Sin cambios)
 */
function closeToolHistoryModal() {
    const modal = document.getElementById('tool-history-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Carga los datos y renderiza el dashboard de resumen de herramientas.
 * @param {HTMLElement} container - El elemento <div> donde se inyectará el HTML.
 */
async function loadToolDashboard(container) {
    container.innerHTML = `
        <div class="text-center p-10">
            <p class="text-gray-500">Calculando estadísticas...</p>
            <div class="loader mx-auto mt-4"></div>
        </div>`;

    try {
        const usersMap = getUsersMap();
        const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });

        // 1. Consultas en paralelo
        const [toolsSnapshot, maintenanceSnapshot, damagedReturnsSnapshot] = await Promise.all([
            getDocs(query(collection(db, "tools"))), // Todas las herramientas
            getDocs(query(collectionGroup(db, "history"), where("action", "==", "mantenimiento"))), // Costos
            getDocs(query(collectionGroup(db, "history"), where("returnStatus", "in", ["dañado", "con_defecto"]))) // Daños
        ]);

        // 2. Procesar KPIs (Costos y Conteo)
        let kpi = {
            total: 0,
            disponible: 0,
            asignada: 0,
            en_reparacion: 0,
            dada_de_baja: 0,
            totalMaintenanceCost: 0,
            totalAssetValue: 0 // <-- AÑADE ESTA LÍNEA (si no existe)
        };
        const assignedToMap = new Map(); // Para "Herramientas por Colaborador"

        toolsSnapshot.forEach(doc => {
            const tool = doc.data();
            kpi.total++;

            if (tool.status !== 'dada_de_baja') {
                kpi.totalAssetValue += tool.purchaseCost || 0;
            }


            switch (tool.status) {
                case 'disponible': kpi.disponible++; break;
                case 'asignada':
                    kpi.asignada++;
                    const userId = tool.assignedTo;
                    if (userId) { // Solo contamos si hay un ID de usuario
                        const count = (assignedToMap.get(userId) || 0) + 1;
                        assignedToMap.set(userId, count);
                    }
                    break;
                case 'en_reparacion': kpi.en_reparacion++; break;
                case 'dada_de_baja': kpi.dada_de_baja++; break;
            }
        });

        maintenanceSnapshot.forEach(doc => {
            kpi.totalMaintenanceCost += doc.data().maintenanceCost || 0;
        });

        // 3. Procesar Devoluciones Dañadas (Tu nueva solicitud)
        const damagedReturnsMap = new Map(); // Para "Devoluciones con daños"
        damagedReturnsSnapshot.forEach(doc => {
            const historyEntry = doc.data();
            // --- INICIO DE CORRECCIÓN ---
            // Cambiamos 'adminId' por 'returnedByUserId'
            const returnedById = historyEntry.returnedByUserId;
            if (returnedById) {
                const count = (damagedReturnsMap.get(returnedById) || 0) + 1;
                damagedReturnsMap.set(returnedById, count);
            }
            // --- FIN DE CORRECCIÓN ---
        });

        // 4. Renderizar el HTML

        // HTML para KPIs
        const kpiHtml = `
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-6">
                <div class="bg-blue-50 p-4 rounded-lg border border-blue-200 text-center"><p class="text-sm font-medium text-blue-800">Total Herramientas</p><p class="text-3xl font-bold text-blue-900">${kpi.total}</p></div>
                <div class="bg-green-50 p-4 rounded-lg border border-green-200 text-center"><p class="text-sm font-medium text-green-800">Disponibles</p><p class="text-3xl font-bold text-green-900">${kpi.disponible}</p></div>
                <div class="bg-yellow-50 p-4 rounded-lg border border-yellow-200 text-center"><p class="text-sm font-medium text-yellow-800">Asignadas</p><p class="text-3xl font-bold text-yellow-900">${kpi.asignada}</p></div>
                <div class="bg-orange-50 p-4 rounded-lg border border-orange-200 text-center"><p class="text-sm font-medium text-orange-800">En Reparación</p><p class="text-3xl font-bold text-orange-900">${kpi.en_reparacion}</p></div>
                <div class="bg-gray-100 p-4 rounded-lg border border-gray-300 text-center"><p class="text-sm font-medium text-gray-700">Costo Mantenimiento</p><p class="text-3xl font-bold text-gray-800">${currencyFormatter.format(kpi.totalMaintenanceCost)}</p></div>
                <div class="bg-indigo-50 p-4 rounded-lg border border-indigo-200 text-center">
                    <p class="text-sm font-medium text-indigo-800">Valor Total Activos</p>
                    <p class="text-3xl font-bold text-indigo-900">${currencyFormatter.format(kpi.totalAssetValue)}</p>
                </div>
            </div>
        `;

        // HTML para Reportes
        let assignedHtml = '<p class="text-sm text-gray-500">No hay herramientas asignadas.</p>';
        if (assignedToMap.size > 0) {
            assignedHtml = '<ul class="divide-y divide-gray-200">';
            const sortedAssigned = [...assignedToMap.entries()].sort((a, b) => b[1] - a[1]); // Ordenar por quién tiene más
            sortedAssigned.forEach(([userId, count]) => {
                const user = usersMap.get(userId);
                const userName = user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido';
                assignedHtml += `<li class="py-2 flex justify-between items-center"><span class="font-medium text-gray-700">${userName}</span><span class="font-bold text-lg text-blue-600">${count}</span></li>`;
            });
            assignedHtml += '</ul>';
        }

        let damagedHtml = '<p class="text-sm text-gray-500">No hay registros de devoluciones con daños.</p>';
        if (damagedReturnsMap.size > 0) {
            damagedHtml = '<ul class="divide-y divide-gray-200">';
            const sortedDamaged = [...damagedReturnsMap.entries()].sort((a, b) => b[1] - a[1]); // Ordenar por quién reporta más
            sortedDamaged.forEach(([userId, count]) => { // <-- CAMBIADO DE 'adminId' a 'userId'
                const user = usersMap.get(userId); // <-- CAMBIADO
                const userName = user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido'; // <-- Ahora es el colaborador
                damagedHtml += `<li class="py-2 flex justify-between items-center"><span class="font-medium text-gray-700">${userName}</span><span class="font-bold text-lg text-red-600">${count}</span></li>`;
            });
            damagedHtml += '</ul>';
        }

        const reportsHtml = `
            <div class="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-white p-4 rounded-lg shadow-md border">
                    <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-3">Herramientas por Colaborador</h3>
                    <div class="max-h-60 overflow-y-auto pr-2">
                        ${assignedHtml}
                    </div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow-md border">
                    <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-3">Devoluciones con Daños (Reportadas por)</h3>
                    <div class="max-h-60 overflow-y-auto pr-2">
                        ${damagedHtml}
                    </div>
                </div>
            </div>
        `;

        // Unir todo
        container.innerHTML = kpiHtml + reportsHtml;

    } catch (error) {
        console.error("Error al cargar el dashboard de herramientas:", error);
        container.innerHTML = `<p class="text-red-500 text-center p-10">Error al cargar las estadísticas: ${error.message}</p>`;
    }
}