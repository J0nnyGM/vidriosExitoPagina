// --- Importaciones de Firebase ---
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
    where,
    collectionGroup,
    increment // <-- IMPORTANTE PARA STOCK
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

// --- Constantes del Módulo ---
export const DOTACION_CATEGORIES = [
    { value: "EPP", label: "EPP (Protección)" },
    { value: "Uniforme", label: "Uniforme" },
    { value: "Otro", label: "Otro" }
];

// --- Variables locales del módulo ---
let db;
let storage;
let openMainModalCallback;
let closeMainModalCallback;
let openConfirmModalCallback;
let sendNotificationCallback;
let openImageModalCallback;
let getCurrentUser;
let getUsersMap;
let getCurrentUserRole;

let unsubscribeDotacion = null;
let dotacionAssigneeChoices = null; // Para filtro de historial
let dotacionCategoryChoices = null; // Para filtro de inventario

// --- INICIO: Funciones de Helper (Copiadas de herramientas.js) ---
function resizeImage(file, maxWidth = 800) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                let width = img.width, height = img.height;
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Error al convertir canvas a Blob.'));
                    }
                }, 'image/jpeg', 0.85);
            };
            img.onerror = reject;
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Cierra el modal de historial
function closeDotacionHistoryModal() {
    const modal = document.getElementById('tool-history-modal'); // Reutilizamos el modal de historial de herramientas
    if (modal) {
        modal.style.display = 'none';
    }
}
// --- FIN: Funciones de Helper ---

/**
 * Inicializa el módulo de Dotación, recibiendo las dependencias de app.js
 */
export function initDotacion(
    firebaseDb,
    firebaseStorage,
    openModalFunc,
    closeModalFunc,
    confirmModalFunc,
    notificationFunc,
    openImageModalFunc,
    userGetter,
    usersMapGetter,
    userRoleGetter
) {
    db = firebaseDb;
    storage = firebaseStorage;
    openMainModalCallback = openModalFunc;
    closeMainModalCallback = closeModalFunc;
    openConfirmModalCallback = confirmModalFunc;
    sendNotificationCallback = notificationFunc;
    openImageModalCallback = openImageModalFunc;
    getCurrentUser = userGetter;
    getUsersMap = usersMapGetter;
    getCurrentUserRole = userRoleGetter;

    // 1. Conectar los botones de la vista
    document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;

        // Acciones que este módulo debe manejar
        switch (action) {
            case 'new-dotacion-catalog-item':
                openMainModalCallback('new-dotacion-catalog-item');
                return; // Detener para no ser capturado por 'dotacionCard'

            case 'export-dotacion-inventario-csv':
                exportInventarioCSV();
                return;

            case 'export-dotacion-inventario-pdf':
                exportInventarioPDF();
                return;
            // --- INICIO DE NUEVO CÓDIGO ---
            case 'export-dotacion-asignaciones-csv':
                exportAsignacionesCSV();
                return;

            case 'export-dotacion-asignaciones-pdf':
                exportAsignacionesPDF();
                return;
        }

        // --- INICIO DE NUEVA LÓGICA (Reportes Dashboard Nivel 2) ---
        const dashboardContainer = target.closest('#dotacion-dashboard-container');
        if (dashboardContainer) {
            const button = e.target.closest('[data-action="view-user-report-details"]');
            if (button) {
                const userId = button.dataset.userid;
                const userName = button.dataset.username;
                const type = button.dataset.type; // 'consumo' o 'descarte'

                // Llamamos a la nueva función (Paso 3)
                openUserReportModal(userId, userName, type);
            }
            return; // Detener
        }

        // Acciones dentro de la tarjeta de dotación (Inventario)
        const dotacionCard = target.closest('.dotacion-catalog-card');
        if (dotacionCard) {
            const itemId = dotacionCard.dataset.id;

            // Cargar datos del ítem para los modales (CON MÁS DATOS)
            const cardData = {
                id: itemId,
                itemName: dotacionCard.dataset.name,
                talla: dotacionCard.dataset.talla,
                itemPhotoURL: dotacionCard.dataset.photourl,
                quantityInStock: parseInt(dotacionCard.dataset.stock) || 0,
                // --- INICIO DE MODIFICACIÓN ---
                reference: dotacionCard.dataset.reference, // Nuevo
                category: dotacionCard.dataset.category,   // Nuevo
                vidaUtilDias: dotacionCard.dataset.vidautil // Nuevo
                // --- FIN DE MODIFICACIÓN ---
            };

            switch (action) {
                // --- INICIO DE MODIFICACIÓN ---
                case 'edit-dotacion-catalog-item':
                    openMainModalCallback('edit-dotacion-catalog-item', cardData);
                    break;
                // --- FIN DE MODIFICACIÓN ---
                case 'register-dotacion-delivery':
                    openMainModalCallback('register-dotacion-delivery', cardData);
                    break;
                case 'add-dotacion-stock':
                    openMainModalCallback('add-dotacion-stock', cardData);
                    break;
                case 'view-dotacion-catalog-history':
                    handleViewDotacionHistory(itemId, cardData.itemName, cardData.talla);
                    break;
                case 'view-dotacion-item-image': // Para ver la foto del ítem
                    if (cardData.itemPhotoURL) openImageModalCallback(cardData.itemPhotoURL);
                    break;
            }
            return; // Detener
        }

        // --- INICIO DE MODIFICACIÓN ---
        // Acciones unificadas para las pestañas "Asignaciones"
        const historyContainer = target.closest('#dotacion-history-container');
        if (historyContainer) {
            const button = e.target.closest('[data-action]'); // Asegurarnos de que sea un botón
            if (!button) return; // Si no es un botón, no hacer nada

            switch (button.dataset.action) { // Usamos button.dataset.action
                // Nivel 1: Clic en "Ver Historial" en la tabla resumen
                case 'view-user-history': {
                    const userId = button.dataset.userid;
                    const userName = button.dataset.username;
                    if (userId && dotacionAssigneeChoices) {
                        const userHistoryMap = new Map();
                        // 1. Sincroniza el <select>
                        dotacionAssigneeChoices.setValue([{ value: userId, label: userName }]);
                        // 2. Llama manualmente a la función de carga
                        loadDotacionAsignaciones(userId); // Carga Nivel 2
                    }
                    break;
                }
                // Nivel 2: Clic en "Volver"
                case 'dotacion-back-to-summary': {
                    if (dotacionAssigneeChoices) {
                        // 1. Sincroniza el <select>
                        dotacionAssigneeChoices.setChoiceByValue('all');
                    }
                    // 2. Llama manualmente a la función de carga
                    loadDotacionAsignaciones('all'); // Carga Nivel 1
                    break;
                }
                // Nivel 2: Clic en "Ver Historial (ítem)"
                case 'view-item-detail-history': {
                    const itemId = button.dataset.itemid;
                    const itemName = button.dataset.itemname;
                    const talla = button.dataset.talla;
                    const userId = button.dataset.userid;
                    // Abre el modal de historial, pero filtrado por usuario
                    handleViewDotacionHistory(itemId, itemName, talla, userId);
                    break;
                }
                // Nivel 2: Clic en "Devolver (Descarte)"
                // Nivel 2: Clic en "Devolver (Descarte)"
                case 'return-dotacion-item': {
                    const lastHistoryId = button.dataset.lasthistoryid;
                    const itemName = button.dataset.itemname;
                    // --- INICIO DE MODIFICACIÓN ---
                    const itemId = button.dataset.itemid; // Obtenemos el ID del catálogo

                    if (lastHistoryId && itemId) {
                        // Ya no llamamos a openConfirmModal, llamamos al nuevo modal
                        openMainModalCallback('return-dotacion-options', {
                            historyId: lastHistoryId,
                            itemName: itemName,
                            itemId: itemId // Pasamos el ID del catálogo
                        });
                        // --- FIN DE MODIFICACIÓN ---
                    } else {
                        alert("No hay un registro de entrega para devolver o falta el ID del ítem.");
                    }
                    break;
                }

                // --- INICIO DE CORRECCIÓN ---
                // Nivel 2: Clic en "Ver Foto"
                case 'view-dotacion-delivery-image': {
                    // Obtenemos la URL directamente del botón en el que se hizo clic
                    const deliveryUrl = button.dataset.photourl;
                    if (deliveryUrl) {
                        openImageModalCallback(deliveryUrl);
                    }
                    break;
                }
                // --- FIN DE CORRECCIÓN ---
            }
            return;
        }
        // --- FIN DE MODIFICACIÓN ---

        // Reutilizar el modal de historial de herramientas
        if (target.id === 'tool-history-close-btn') {
            closeDotacionHistoryModal();
        }

        // Listener para ver la foto de entrega DENTRO del modal de historial
        if (action === 'view-dotacion-delivery-image') {
            const deliveryUrl = target.dataset.photourl;
            if (deliveryUrl) {
                openImageModalCallback(deliveryUrl);
            }
        }
    });

    // 2. Conectar el formulario del modal
    const modalForm = document.getElementById('modal-form');
    modalForm.addEventListener('submit', (e) => {
        const type = modalForm.dataset.type;
        const form = e.target;

        // --- INICIO DE MODIFICACIÓN (Añadir el nuevo tipo) ---
        if (['new-dotacion-catalog-item', 'add-dotacion-stock', 'register-dotacion-delivery', 'return-dotacion-options', 'edit-dotacion-catalog-item'].includes(type)) {
            // --- FIN DE MODIFICACIÓN ---
            e.preventDefault();
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
            handleSaveDotacion(form);
        }
    });

    // 3. Configurar Filtros
    const assigneeFilterSelect = document.getElementById('dotacion-assignee-filter');
    if (assigneeFilterSelect && !dotacionAssigneeChoices) {
        assigneeFilterSelect.innerHTML = '';
        dotacionAssigneeChoices = new Choices(assigneeFilterSelect, {
            itemSelectText: 'Seleccionar',
            searchPlaceholderValue: 'Buscar colaborador...',
            allowHTML: false,
            choices: [{ value: 'all', label: 'Todos los Empleados' }]
        });
        dotacionAssigneeChoices.setChoiceByValue('all');

        assigneeFilterSelect.addEventListener('change', (event) => {
            // Solo recargamos si el evento fue disparado por el usuario
            if (event.detail.value) {
                // Llama a la función que decide qué Nivel mostrar
                loadDotacionView();
            }
        });

        // Rellenar el selector de Asignados (se llama desde app.js)
    }

    const categoryFilterSelect = document.getElementById('dotacion-category-filter');
    if (categoryFilterSelect && !dotacionCategoryChoices) {
        const categoryOptions = [
            { value: 'all', label: 'Todas las Categorías' },
            ...DOTACION_CATEGORIES
        ];
        dotacionCategoryChoices = new Choices(categoryFilterSelect, {
            itemSelectText: 'Seleccionar',
            allowHTML: false,
            choices: categoryOptions,
            searchEnabled: false,
        });
        dotacionCategoryChoices.setChoiceByValue('all');
        categoryFilterSelect.addEventListener('change', loadDotacionView);
    }

    // 4. Conectar las PESTAÑAS (Tabs)
    const tabsNav = document.getElementById('dotacion-tabs-nav');
    if (tabsNav) {
        tabsNav.addEventListener('click', (e) => {
            const button = e.target.closest('.dotacion-tab-button');
            if (button && !button.classList.contains('active')) {
                tabsNav.querySelectorAll('.dotacion-tab-button').forEach(btn => {
                    btn.classList.remove('active', 'border-blue-500', 'text-blue-600');
                    btn.classList.add('border-transparent', 'text-gray-500');
                });
                button.classList.add('active', 'border-blue-500', 'text-blue-600');
                button.classList.remove('border-transparent', 'text-gray-500');
                loadDotacionView();
            }
        });
    }

    // 5. Conectar el BUSCADOR POR NOMBRE
    const searchInput = document.getElementById('dotacion-search-input');
    let searchTimeout = null;
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(loadDotacionView, 300);
        });
    }
}


/**
 * Carga la vista de Dotación. Decide qué pestaña/vista mostrar.
 */
export function loadDotacionView() {
    const role = getCurrentUserRole();

    // 1. Definimos TODAS las variables de elementos aquí arriba
    const titleElement = document.getElementById('dotacion-view-title');
    const newDotacionBtn = document.getElementById('new-dotacion-item-btn');
    const tabsNav = document.getElementById('dotacion-tabs-nav');
    const filterBar = document.getElementById('dotacion-filter-bar');
    const assigneeContainer = document.getElementById('dotacion-assignee-container');
    const searchContainer = document.getElementById('dotacion-search-container');
    const categoryContainer = document.getElementById('dotacion-category-container');
    const gridContainer = document.getElementById('dotacion-grid-container');
    const dashboardContainer = document.getElementById('dotacion-dashboard-container');
    const historyContainer = document.getElementById('dotacion-history-container'); // Contenedor padre de Asignaciones

    // 2. Salida de seguridad
    if (!titleElement || !newDotacionBtn || !tabsNav || !filterBar || !assigneeContainer || !searchContainer || !categoryContainer || !gridContainer || !dashboardContainer || !historyContainer) {
        console.error("loadDotacionView: Faltan elementos esenciales del DOM.");
        return;
    }

    // 3. Ocultar todos los contenedores principales
    gridContainer.classList.add('hidden');
    dashboardContainer.classList.add('hidden');
    historyContainer.classList.add('hidden');

    // 4. Lógica de UI para Admin/Bodega vs Operario
    const isAdminView = (role === 'admin' || role === 'bodega' || role === 'sst');
    newDotacionBtn.classList.toggle('hidden', !isAdminView);
    tabsNav.classList.toggle('hidden', !isAdminView);
    filterBar.classList.toggle('hidden', !isAdminView);

    if (role === 'operario') {
        // --- VISTA DE OPERARIO ---
        const currentUser = getCurrentUser();
        const userName = getUsersMap().get(currentUser.uid)?.firstName || 'Usuario';
        titleElement.textContent = `Mi Dotación (${userName})`;

        // --- INICIO DE MODIFICACIÓN DEFINITIVA ---
        // Ocultamos explícitamente la barra Y todo su contenido
        filterBar.classList.add('hidden');
        if (assigneeContainer) assigneeContainer.classList.add('hidden');
        if (searchContainer) searchContainer.classList.add('hidden');
        if (categoryContainer) categoryContainer.classList.add('hidden');

        // Removemos las clases de layout que pueden estar causando el conflicto
        filterBar.classList.remove('md:grid', 'md:grid-cols-4', 'md:grid-cols-1');
        // --- FIN DE MODIFICACIÓN DEFINITIVA ---

        historyContainer.classList.remove('hidden'); // Mostrar el contenedor de Asignaciones

        // El operario solo ve su historial detallado (Nivel 2)
        loadDotacionAsignaciones(currentUser.uid, 'dotacion-history-container'); // <-- ID AÑADIDO

    } else {
        // --- VISTA DE ADMIN/BODEGA ---
        titleElement.textContent = 'Gestión de Dotación';
        const activeTab = document.querySelector('#dotacion-tabs-nav .active')?.dataset.statusFilter || 'resumen';

        // Mostrar/Ocultar filtros
        filterBar.classList.remove('hidden');
        const isAsignacionesTab = (activeTab === 'asignaciones');
        const isInventarioTab = (activeTab === 'inventario');

        searchContainer.classList.toggle('hidden', !isInventarioTab);
        categoryContainer.classList.toggle('hidden', !isInventarioTab);
        assigneeContainer.classList.toggle('hidden', !isAsignacionesTab);

        if (isAsignacionesTab) {
            filterBar.classList.remove('md:grid-cols-4');
            filterBar.classList.add('md:grid-cols-1');
            assigneeContainer.classList.remove('md:col-span-1');
            assigneeContainer.classList.add('md:col-span-1'); // Ocupará 1 de 1
        } else {
            filterBar.classList.remove('md:grid-cols-1');
            filterBar.classList.add('md:grid-cols-4');
            searchContainer.classList.remove('md:col-span-2');
            searchContainer.classList.add('md:col-span-3'); // 3 columnas
            categoryContainer.classList.add('md:col-span-1'); // 1 columna
        }

        const inventarioActions = document.getElementById('dotacion-inventario-actions');
        const asignacionesActions = document.getElementById('dotacion-asignaciones-actions');

        if (inventarioActions) inventarioActions.classList.toggle('hidden', !isInventarioTab);
        if (asignacionesActions) asignacionesActions.classList.toggle('hidden', !isAsignacionesTab);

        // Cargar la vista de la pestaña activa
        if (activeTab === 'resumen') {
            filterBar.classList.add('hidden');
            dashboardContainer.classList.remove('hidden');
            loadDotacionDashboard(dashboardContainer);
        } else if (activeTab === 'inventario') {
            gridContainer.classList.remove('hidden');
            loadDotacionCatalog();
        } else if (activeTab === 'asignaciones') {
            historyContainer.classList.remove('hidden');
            const assigneeFilter = (dotacionAssigneeChoices && dotacionAssigneeChoices.getValue(true)) ? dotacionAssigneeChoices.getValue(true) : 'all';
            loadDotacionAsignaciones(assigneeFilter, 'dotacion-history-container'); // <-- ID AÑADIDO
        }
    }
}


/**
 * Carga el catálogo de inventario desde `dotacionCatalog`.
 */
function loadDotacionCatalog() {
    const gridContainer = document.getElementById('dotacion-grid-container');
    gridContainer.innerHTML = '<div class="loader-container col-span-full"><div class="loader mx-auto"></div></div>';

    if (unsubscribeDotacion) unsubscribeDotacion();

    const searchTerm = document.getElementById('dotacion-search-input').value.toLowerCase();
    const categoryFilter = (dotacionCategoryChoices && dotacionCategoryChoices.getValue(true)) ? dotacionCategoryChoices.getValue(true) : 'all';

    let dotacionQuery = query(collection(db, "dotacionCatalog"), orderBy("itemName"));

    unsubscribeDotacion = onSnapshot(dotacionQuery, (snapshot) => {
        gridContainer.innerHTML = '';
        let items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Filtrado JS
        if (searchTerm) {
            items = items.filter(item =>
                item.itemName.toLowerCase().includes(searchTerm) ||
                (item.reference && item.reference.toLowerCase().includes(searchTerm))
            );
        }
        if (categoryFilter !== 'all') {
            items = items.filter(item => item.category === categoryFilter);
        }

        if (items.length === 0) {
            gridContainer.innerHTML = `<div class="md:col-span-2 min-h-[300px] flex items-center justify-center"><p class="text-gray-500 text-center text-lg">No hay ítems en el inventario que coincidan.</p></div>`;
            return;
        }

        items.forEach(item => {
            const card = createDotacionCatalogCard(item);
            gridContainer.appendChild(card);
        });

    }, (error) => {
        console.error("Error al cargar catálogo de dotación:", error);
        gridContainer.innerHTML = `<p class="text-red-500 text-center md:col-span-2">Error al cargar datos.</p>`;
    });
}

/**
 * Carga la pestaña "Asignaciones" (Nivel 1: Resumen o Nivel 2: Detalle).
 * (VERSIÓN MEJORADA CON REAL-TIME Y FOTO DE ENTREGA)
 *
 * @param {string} userIdFilter - 'all' (para resumen) o un ID de usuario específico (para detalle).
 * @param {string | null} containerId - El ID del div donde se renderizará el historial. Si es null, usa el ID por defecto.
 */
export async function loadDotacionAsignaciones(userIdFilter = 'all', containerId = null) { // <-- PARÁMETRO AÑADIDO
    const role = getCurrentUserRole();

    // --- INICIO DE MODIFICACIÓN ---
    // IDs de contenedor dinámicos. Si containerId es null, usa los IDs por defecto.
    const historyContainerId = containerId || 'dotacion-history-container';
    const summaryContainerId = 'dotacion-summary-table-container';
    const detailGridId = 'dotacion-detail-grid-container';
    const backBtnId = 'dotacion-back-to-summary-btn';
    const summaryTableBodyId = 'dotacion-summary-table-body';

    const historyContainer = document.getElementById(historyContainerId);
    if (!historyContainer) {
        console.error(`Contenedor de historial '${historyContainerId}' no encontrado.`);
        return;
    }

    // Si estamos en modo "widget", inyectamos la estructura HTML necesaria
    if (containerId && userIdFilter !== 'all') {
        // Esta es la vista Nivel 2 (detalle) para el operario en el dashboard
        historyContainer.innerHTML = `
            <div id="${detailGridId}" class="grid grid-cols-1 gap-4"></div>
            `;
    } else if (containerId) {
        // Esto es por si un admin ve el resumen en un widget (no implementado, pero por seguridad)
        historyContainer.innerHTML = `
             <div id="${summaryContainerId}" class="bg-white p-6 rounded-lg shadow-md">
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-50">
                            <tr>
                                <th class="px-6 py-3">Empleado</th>
                                <th class="px-6 py-3 text-center">Total Ítems Entregados</th>
                                <th class="px-6 py-3 text-center">Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="${summaryTableBodyId}"></tbody>
                    </table>
                </div>
            </div>
            <div id="${detailGridId}" class="hidden grid grid-cols-1 md:grid-cols-2 gap-6"></div>
        `;
    }
    
    // Contenedores
    const summaryContainer = document.getElementById(summaryContainerId);
    const detailGrid = document.getElementById(detailGridId);
    const backBtn = document.getElementById(backBtnId);
    const summaryTableBody = document.getElementById(summaryTableBodyId);
    // --- FIN DE MODIFICACIÓN ---


    if (unsubscribeDotacion) unsubscribeDotacion();

    const usersMap = getUsersMap();

    if (userIdFilter === 'all') {
        // --- 1. VISTA RESUMEN (NIVEL 1: POR EMPLEADO) ---
        // (Esta parte SÍ usa onSnapshot y ya funciona en tiempo real)
        if (!summaryContainer || !detailGrid || !summaryTableBody) {
            console.error("Faltan contenedores para la vista Nivel 1 (Resumen).");
            return;
        }
        
        summaryContainer.classList.remove('hidden');
        detailGrid.classList.add('hidden');
        if (backBtn) backBtn.classList.add('hidden'); // backBtn es opcional
        summaryTableBody.innerHTML = '<tr><td colspan="3" class="text-center py-6"><div class="loader mx-auto"></div></td></tr>';

        let historyQuery = query(collection(db, "dotacionHistory"), where("action", "==", "asignada"));
        unsubscribeDotacion = onSnapshot(historyQuery, (snapshot) => {
            // ... (Toda la lógica de summaryMap sigue igual)
            const summaryMap = new Map();
            snapshot.forEach(doc => {
                const entry = doc.data();
                if (entry.userId) {
                    const current = summaryMap.get(entry.userId) || { count: 0 };
                    current.count += (entry.quantity || 0);
                    summaryMap.set(entry.userId, current);
                }
            });
            summaryTableBody.innerHTML = '';
            if (summaryMap.size === 0) {
                summaryTableBody.innerHTML = '<tr><td colspan="3" class="text-center py-6 text-gray-500">No hay asignaciones registradas.</td></tr>';
                return;
            }
            summaryMap.forEach((data, userId) => {
                const user = usersMap.get(userId);
                const userName = user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido';
                const row = document.createElement('tr');
                row.className = 'bg-white border-b hover:bg-gray-50 dotacion-summary-row';
                row.innerHTML = `
                    <td class="px-6 py-4 font-medium text-gray-900">${userName}</td>
                    <td class="px-6 py-4 text-center font-bold text-lg text-blue-600">${data.count}</td>
                    <td class="px-6 py-4 text-center">
                        <button data-action="view-user-history" data-userid="${userId}" data-username="${userName}" class="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-2 px-3 rounded-lg">
                            Ver Dotación
                        </button>
                    </td>
                `;
                summaryTableBody.appendChild(row);
            });
        }, (error) => {
            console.error("Error al cargar resumen de dotación:", error);
            summaryTableBody.innerHTML = '<tr><td colspan="3" class="text-center py-6 text-red-500">Error al cargar el resumen.</td></tr>';
        });

    } else {
        // --- 2. VISTA DETALLADA (NIVEL 2: AHORA CON REAL-TIME) ---
        if (summaryContainer) summaryContainer.classList.add('hidden'); // summaryContainer es opcional
        if (detailGrid) detailGrid.classList.remove('hidden');
        if (backBtn) backBtn.classList.toggle('hidden', role === 'operario' || containerId); // Ocultar si es operario O si es un widget
        
        if (!detailGrid) {
            console.error("Contenedor de detalle (detailGrid) no encontrado.");
            return;
        }
        detailGrid.innerHTML = '<div class="loader-container col-span-full"><div class="loader mx-auto"></div></div>';

        try {
            // 1. Cargar el Catálogo UNA VEZ
            const catalogSnapshot = await getDocs(query(collection(db, "dotacionCatalog"), orderBy("itemName")));
            const catalogMap = new Map();
            catalogSnapshot.forEach(doc => {
                catalogMap.set(doc.id, { id: doc.id, ...doc.data() });
            });

            // 2. Definir la consulta de HISTORIAL
            const historyQuery = query(
                collection(db, "dotacionHistory"),
                where("action", "==", "asignada"),
                where("userId", "==", userIdFilter),
                orderBy("fechaEntrega", "desc")
            );

            // 3. Crear el listener REAL-TIME para el HISTORIAL
            if (unsubscribeDotacion) unsubscribeDotacion();
            unsubscribeDotacion = onSnapshot(historyQuery, (historySnapshot) => {

                const userHistoryMap = new Map();
                const activeItemFound = new Set();

                historySnapshot.forEach(doc => {
                    const entry = { id: doc.id, ...doc.data() };
                    const key = entry.itemId;

                    if (!userHistoryMap.has(key)) {
                        userHistoryMap.set(key, {
                            itemId: entry.itemId,
                            itemName: entry.itemName,
                            talla: entry.talla,
                            totalConsumido: 0,
                            lastDeliveryDate: null,
                            lastHistoryId: null,
                            status: 'ninguno',
                            deliveryPhotoURL: null // <-- Añadido el campo por defecto
                        });
                    }

                    const summary = userHistoryMap.get(key);
                    summary.totalConsumido += (entry.quantity || 0);

                    if (activeItemFound.has(key)) return;

                    const entryStatus = entry.status || 'activo';

                    if (entryStatus === 'activo') {
                        summary.lastDeliveryDate = entry.fechaEntrega;
                        summary.lastHistoryId = entry.id;
                        summary.status = 'activo';
                        // --- INICIO DE MODIFICACIÓN ---
                        summary.deliveryPhotoURL = entry.deliveryPhotoURL || null; // <-- LÍNEA AÑADIDA
                        // --- FIN DE MODIFICACIÓN ---
                        activeItemFound.add(key);
                    } else if (summary.status === 'ninguno') {
                        summary.lastDeliveryDate = entry.fechaEntrega;
                        summary.lastHistoryId = entry.id;
                        summary.status = entryStatus;
                        // --- INICIO DE MODIFICACIÓN ---
                        summary.deliveryPhotoURL = entry.deliveryPhotoURL || null; // <-- LÍNEA AÑADIDA
                        // --- FIN DE MODIFICACIÓN ---
                    }
                });

                // 4. Renderizar (la lógica de 'role === operario' va AQUI DENTRO)
                detailGrid.innerHTML = '';

                if (role === 'operario') {
                    // ... (VISTA OPERARIO)
                    if (userHistoryMap.size === 0) {
                        detailGrid.innerHTML = '<p class="text-gray-500 text-center col-span-full">Aún no tienes dotación asignada.</p>';
                        return;
                    }
                    userHistoryMap.forEach((historySummary, itemId) => {
                        const catalogItem = catalogMap.get(itemId);
                        if (!catalogItem) return;
                        const card = createDotacionDetailCard(catalogItem, historySummary, userIdFilter, role);
                        detailGrid.appendChild(card);
                    });

                } else {
                    // ... (VISTA ADMIN)
                    if (catalogMap.size === 0) {
                        detailGrid.innerHTML = '<p class="text-gray-500 text-center col-span-full">No hay ítems de dotación en el catálogo.</p>';
                        return;
                    }
                    catalogMap.forEach((catalogItem, catalogId) => {
                        const historySummary = userHistoryMap.get(catalogId) || {
                            totalConsumido: 0,
                            lastDeliveryDate: null,
                            lastHistoryId: null,
                            status: 'ninguno',
                            deliveryPhotoURL: null // <-- Añadido por si acaso
                        };
                        const card = createDotacionDetailCard(catalogItem, historySummary, userIdFilter, role);
                        detailGrid.appendChild(card);
                    });
                }
            }, (error) => {
                console.error("Error al escuchar historial de dotación (real-time):", error);
                detailGrid.innerHTML = '<p class="text-red-500 text-center col-span-full">Error al cargar datos en tiempo real.</p>';
            });

        } catch (error) {
            console.error("Error al cargar el catálogo de dotación:", error);
            detailGrid.innerHTML = '<p class="text-red-500 text-center col-span-full">Error fatal al cargar el catálogo.</p>';
        }
    }
}


/**
 * Crea el HTML para una TARJETA de ítem del catálogo de dotación.
 */
function createDotacionCatalogCard(item) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden flex flex-col dotacion-catalog-card'; // Clase
    card.dataset.id = item.id;
    card.dataset.name = item.itemName;
    card.dataset.talla = item.talla || 'N/A';
    card.dataset.photourl = item.itemPhotoURL || '';
    card.dataset.stock = item.quantityInStock || 0;
    // --- INICIO DE MODIFICACIÓN ---
    card.dataset.reference = item.reference || '';
    card.dataset.category = item.category || '';
    card.dataset.vidautil = item.vidaUtilDias || ''; // Usamos vidautil para el dataset
    // --- FIN DE MODIFICACIÓN ---

    const stock = item.quantityInStock || 0;
    const stockColor = stock > 5 ? 'text-green-600' : (stock > 0 ? 'text-yellow-600' : 'text-red-600');

    card.innerHTML = `
        <div class="flex-grow flex">
            <div class="w-1/3 flex-shrink-0 aspect-square bg-gray-100"> 
                <img 
                    src="${item.itemPhotoURL || 'https://via.placeholder.com/300'}" 
                    alt="${item.itemName}" 
                    class="w-full h-full object-contain cursor-pointer" 
                    data-action="view-dotacion-item-image"
                >
            </div>
            <div class="w-2/3 flex-grow p-4 flex flex-col">
                <div class="flex-grow">
                    <h3 class="text-lg font-bold text-gray-900">${item.itemName}</h3>
                    <p class="text-sm text-gray-500">${item.reference || 'Sin referencia'}</p>
                    <div class="mt-3 text-sm space-y-1">
                        <p><strong>Categoría:</strong> ${item.category}</p>
                        <p><strong>Talla:</strong> ${item.talla || 'N/A'}</p>
                        <p><strong>Vida Útil:</strong> ${item.vidaUtilDias ? `${item.vidaUtilDias} días` : 'N/A'}</p>
                    </div>
                </div>
                <div class="text-sm space-y-2 mt-4 pt-2 border-t">
                    <div class="flex justify-between items-center">
                        <span class="font-medium text-gray-600">Stock Actual:</span>
                        <span class="font-bold text-2xl ${stockColor}">${stock}</span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="bg-gray-50 p-3 border-t grid grid-cols-4 gap-2">
            <button data-action="register-dotacion-delivery" class="bg-green-500 hover:bg-green-600 text-white text-xs font-semibold py-2 px-2 rounded-lg w-full">Entrega</button>
            <button data-action="add-dotacion-stock" class="bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold py-2 px-2 rounded-lg w-full">Stock</button>
            
            <button data-action="edit-dotacion-catalog-item" class="bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-semibold py-2 px-2 rounded-lg w-full">Editar</button>
            
            <button data-action="view-dotacion-catalog-history" class="bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-semibold py-2 px-2 rounded-lg w-full">Historial</button>
        </div>
        `;
    return card;
}

/**
 * Carga el dashboard de resumen de dotación.
 * (MEJORADO con reportes de Consumo y Descarte)
 */
export async function loadDotacionDashboard(container) {
    container.innerHTML = `<div class="text-center p-10"><p class="text-gray-500">Calculando estadísticas...</p><div class="loader mx-auto mt-4"></div></div>`;

    try {
        const usersMap = getUsersMap();

        // Consultas en paralelo (AÑADIMOS 'historyFullSnapshot')
        const [catalogSnapshot, historyActiveSnapshot, historyFullSnapshot] = await Promise.all([
            getDocs(query(collection(db, "dotacionCatalog"))),

            // 1. Historial ACTIVO (para reporte de Vencimiento)
            getDocs(query(
                collection(db, "dotacionHistory"),
                where("action", "==", "asignada"),
                where("status", "==", "activo")
            )),

            // --- INICIO DE NUEVA CONSULTA ---
            // 2. Historial COMPLETO (para reportes de Consumo y Descarte)
            getDocs(query(collection(db, "dotacionHistory")))
            // --- FIN DE NUEVA CONSULTA ---
        ]);

        let kpi = { totalTipos: 0, totalStock: 0, totalAsignado: 0 };
        const tallaStockMap = new Map();
        const catalogVidaUtilMap = new Map(); // Para Vencimiento

        // --- INICIO DE NUEVOS MAPS ---
        const consumoMap = new Map(); // Nuevo: Para "Top Consumo"
        const descarteMap = new Map(); // Nuevo: Para "Top Descarte"
        // --- FIN DE NUEVOS MAPS ---

        catalogSnapshot.forEach(doc => {
            const item = doc.data();
            kpi.totalTipos++;
            const stock = item.quantityInStock || 0;
            kpi.totalStock += stock;

            // (Lógica de tallaStockMap - Sin cambios)
            if (stock > 0) {
                const baseName = item.itemName;
                const talla = item.talla || 'N/A';
                if (!tallaStockMap.has(baseName)) {
                    tallaStockMap.set(baseName, { total: 0, tallas: [] });
                }
                const group = tallaStockMap.get(baseName);
                group.total += stock;
                group.tallas.push({ talla: talla, stock: stock });
            }

            // (Lógica de catalogVidaUtilMap - Sin cambios)
            if (item.vidaUtilDias) {
                catalogVidaUtilMap.set(doc.id, item.vidaUtilDias);
            }
        });

        // --- Lógica de Vencimiento (Sin cambios) ---
        const vencimientoList = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        historyActiveSnapshot.forEach(doc => {
            const entry = doc.data();
            const quantity = entry.quantity || 0;
            kpi.totalAsignado += quantity; // <-- Esto se queda aquí

            // (Lógica de vencimientoList - Sin cambios)
            const vidaUtilDias = catalogVidaUtilMap.get(entry.itemId);
            const deliveryDateStr = entry.fechaEntrega;
            if (vidaUtilDias && deliveryDateStr) {
                const deliveryDate = new Date(deliveryDateStr + 'T00:00:00');
                const expirationDate = new Date(deliveryDate.getTime());
                expirationDate.setDate(expirationDate.getDate() + vidaUtilDias);
                const diffTime = expirationDate.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays <= 30) {
                    const user = usersMap.get(entry.userId);
                    vencimientoList.push({
                        userName: user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido',
                        itemName: entry.itemName || 'Ítem',
                        talla: entry.talla || 'N/A',
                        diffDays: diffDays,
                        expirationDate: expirationDate.toLocaleDateString('es-CO')
                    });
                }
            }
        });

        // --- INICIO DE NUEVA LÓGICA (Reportes de Consumo y Descarte) ---
        // 5. Procesar el historial COMPLETO
        historyFullSnapshot.forEach(doc => {
            const entry = doc.data();
            const userId = entry.userId;

            if (userId) {
                // Contar Consumo (cada vez que se 'asigna')
                if (entry.action === 'asignada') {
                    consumoMap.set(userId, (consumoMap.get(userId) || 0) + (entry.quantity || 0));
                }

                // Contar Descarte (cada vez que se 'devuelve' como descarte)
                if (entry.action === 'devuelto') {
                    descarteMap.set(userId, (descarteMap.get(userId) || 0) + (entry.quantity || 0));
                }
            }
        });
        // --- FIN DE NUEVA LÓGICA ---


        // HTML para KPIs (Sin cambios)
        const kpiHtml = `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div class="bg-blue-50 p-4 rounded-lg border border-blue-200 text-center">
                    <p class="text-sm font-medium text-blue-800">Tipos de Ítems</p>
                    <p class="text-3xl font-bold text-blue-900">${kpi.totalTipos}</p>
                </div>
                <div class="bg-green-50 p-4 rounded-lg border border-green-200 text-center">
                    <p class="text-sm font-medium text-green-800">Total en Stock</p>
                    <p class="text-3xl font-bold text-green-900">${kpi.totalStock}</p>
                </div>
                <div class="bg-yellow-50 p-4 rounded-lg border border-yellow-200 text-center">
                    <p class="text-sm font-medium text-yellow-800">Total Asignado (Activo)</p>
                    <p class="text-3xl font-bold text-yellow-900">${kpi.totalAsignado}</p>
                </div>
                <div class="bg-gray-100 p-4 rounded-lg border border-gray-300 text-center">
                    <p class="text-sm font-medium text-gray-700">Total General</p>
                    <p class="text-3xl font-bold text-gray-800">${kpi.totalStock + kpi.totalAsignado}</p>
                </div>
            </div>
        `;

        // --- INICIO DE MODIFICACIÓN: HTML para Nuevos Reportes ---

        // Reporte 1: Top Consumo (Histórico)
        let consumoHtml = '<p class="text-sm text-gray-500">No hay historial de consumo.</p>';
        if (consumoMap.size > 0) {
            consumoHtml = '<ul class="divide-y divide-gray-200">';
            const sortedConsumo = [...consumoMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10); // Top 10
            sortedConsumo.forEach(([userId, count]) => {
                const user = usersMap.get(userId);
                const userName = user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido';

                // --- INICIO DE MODIFICACIÓN ---
                consumoHtml += `<li class="py-2 flex justify-between items-center">
                    <button data-action="view-user-report-details" data-userid="${userId}" data-username="${userName}" data-type="consumo" class="font-medium text-blue-600 hover:text-blue-800 hover:underline text-left">
                        ${userName}
                    </button>
                    <span class="font-bold text-lg text-blue-600">${count}</span>
                </li>`;
                // --- FIN DE MODIFICACIÓN ---
            });
            consumoHtml += '</ul>';
        }

        // Reporte 2: Top Descarte (Histórico)
        let descarteHtml = '<p class="text-sm text-gray-500">No hay historial de descartes.</p>';
        if (descarteMap.size > 0) {
            descarteHtml = '<ul class="divide-y divide-gray-200">';
            const sortedDescarte = [...descarteMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10); // Top 10
            sortedDescarte.forEach(([userId, count]) => {
                const user = usersMap.get(userId);
                const userName = user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido';

                // --- INICIO DE MODIFICACIÓN ---
                descarteHtml += `<li class="py-2 flex justify-between items-center">
                    <button data-action="view-user-report-details" data-userid="${userId}" data-username="${userName}" data-type="descarte" class="font-medium text-blue-600 hover:text-blue-800 hover:underline text-left">
                        ${userName}
                    </button>
                    <span class="font-bold text-lg text-red-600">${count}</span>
                </li>`;
                // --- FIN DE MODIFICACIÓN ---
            });
            descarteHtml += '</ul>';
        }

        // Reporte 3: Tallas (Sin cambios)
        let tallasHtml = '<p class="text-sm text-gray-500">No hay stock detallado para mostrar.</p>';
        if (tallaStockMap.size > 0) {
            tallasHtml = '<ul class="divide-y divide-gray-200">';
            const sortedTallaGroups = [...tallaStockMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            for (const [baseName, group] of sortedTallaGroups) {
                tallasHtml += `<li class="py-3">
                    <div class="flex justify-between items-center mb-2">
                        <span class="font-semibold text-gray-800">${baseName}</span>
                        <span class="font-bold text-lg text-blue-600">Total: ${group.total}</span>
                    </div>
                    <ul class="pl-4 space-y-1">`;
                group.tallas.sort((a, b) => a.talla.localeCompare(b.talla, undefined, { numeric: true, sensitivity: 'base' }));
                for (const item of group.tallas) {
                    tallasHtml += `
                        <li class="text-sm flex justify-between">
                            <span class="text-gray-600">Talla ${item.talla}:</span>
                            <span class="font-medium text-gray-900">Stock: ${item.stock}</span>
                        </li>`;
                }
                tallasHtml += `</ul></li>`;
            }
            tallasHtml += '</ul>';
        }

        // Reporte 4: Vencimiento (Sin cambios)
        let vencimientoReportHtml = '<p class="text-sm text-gray-500">No hay ítems próximos a vencer.</p>';
        if (vencimientoList.length > 0) {
            vencimientoList.sort((a, b) => a.diffDays - b.diffDays);
            vencimientoReportHtml = '<ul class="divide-y divide-gray-200">';
            vencimientoList.forEach(item => {
                const color = item.diffDays <= 0 ? 'text-red-600 font-bold' : 'text-yellow-700 font-semibold';
                const status = item.diffDays <= 0 ? `(Vencido hace ${Math.abs(item.diffDays)} días)` : `(Vence en ${item.diffDays} días)`;
                vencimientoReportHtml += `
                    <li class="py-2">
                        <p class="${color}">${item.itemName} (Talla: ${item.talla}) ${status}</p>
                        <p class="text-xs text-gray-600">Empleado: ${item.userName} - Vence: ${item.expirationDate}</p>
                    </li>`;
            });
            vencimientoReportHtml += '</ul>';
        }

        // --- FIN DE MODIFICACIÓN ---


        // --- INICIO DE MODIFICACIÓN DEL LAYOUT ---
        // 7. Reordenar el grid 2x2
        const reportsHtml = `
            <div class="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                
                <div class="bg-white p-4 rounded-lg shadow-md border">
                    <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-3">Top 10 - Consumo Histórico (Entregas)</h3>
                    <div class="max-h-60 overflow-y-auto pr-2">${consumoHtml}</div>
                </div>

                <div class="bg-white p-4 rounded-lg shadow-md border border-red-200">
                    <h3 class="text-lg font-semibold text-red-800 border-b border-red-200 pb-2 mb-3">Top 10 - Descarte/Desgaste (Devoluciones)</h3>
                    <div class="max-h-60 overflow-y-auto pr-2">${descarteHtml}</div>
                </div>

                <div class="bg-white p-4 rounded-lg shadow-md border">
                    <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-3">Dotación Vencida o por Vencer (30 días)</h3>
                    <div class="max-h-60 overflow-y-auto pr-2">${vencimientoReportHtml}</div>
                </div>

                <div class="bg-white p-4 rounded-lg shadow-md border">
                    <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-3">Stock Detallado (por Talla)</h3>
                    <div class="max-h-60 overflow-y-auto pr-2">${tallasHtml}</div>
                </div>

            </div>
        `;
        // --- FIN DE MODIFICACIÓN DEL LAYOUT ---

        container.innerHTML = kpiHtml + reportsHtml;

    } catch (error) {
        console.error("Error al cargar el dashboard de dotación:", error);
        container.innerHTML = `<p class="text-red-500 text-center p-10">Error al cargar las estadísticas: ${error.message}</p>`;
    }
}

/**
 * Guarda los cambios de dotación (Crea Catálogo, Añade Stock, Registra Entrega).
 * (VERSIÓN CORREGIDA CON TRY...CATCH...FINALLY ARREGLADO)
 */
async function handleSaveDotacion(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const type = form.dataset.type;
    const currentUser = getCurrentUser();

    const confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Guardando...';

    let userIdToRefresh = null; // Variable para guardar el ID del usuario

    try {
        const batch = writeBatch(db);

        if (type === 'new-dotacion-catalog-item') {
            const photoFile = data.photo;
            const newItemRef = doc(collection(db, "dotacionCatalog"));
            let downloadURL = null;

            if (photoFile && photoFile.size > 0) {
                confirmBtn.textContent = 'Redimensionando foto...';
                const resizedBlob = await resizeImage(photoFile, 800);
                confirmBtn.textContent = 'Subiendo foto...';
                const photoPath = `dotacion_catalog_photos/${newItemRef.id}/${photoFile.name}`;
                const photoStorageRef = ref(storage, photoPath);
                await uploadBytes(photoStorageRef, resizedBlob);
                downloadURL = await getDownloadURL(photoStorageRef);
            }

            const itemData = {
                itemName: data.itemName,
                reference: data.reference || '',
                category: data.category,
                talla: data.talla || 'N/A',
                itemPhotoURL: downloadURL,
                quantityInStock: parseInt(data.initialStock) || 0,
                vidaUtilDias: parseInt(data.vidaUtilDias) || null, // <-- AÑADIDO
                createdAt: serverTimestamp(),
                createdBy: currentUser.uid,
            };
            batch.set(newItemRef, itemData);

            // --- INICIO DE NUEVA LÓGICA DE EDICIÓN ---
        } else if (type === 'edit-dotacion-catalog-item') {
            const itemId = data.itemId;
            if (!itemId) throw new Error("ID de ítem inválido para editar.");

            const itemRef = doc(db, "dotacionCatalog", itemId);
            const photoFile = data.photo;
            let downloadURL = null;

            // 1. Verificar si se subió una NUEVA foto
            if (photoFile && photoFile.size > 0) {
                confirmBtn.textContent = 'Redimensionando foto...';
                const resizedBlob = await resizeImage(photoFile, 800);
                confirmBtn.textContent = 'Subiendo foto...';
                const photoPath = `dotacion_catalog_photos/${itemId}/${photoFile.name}`;
                const photoStorageRef = ref(storage, photoPath);
                await uploadBytes(photoStorageRef, resizedBlob);
                downloadURL = await getDownloadURL(photoStorageRef);
            }

            // 2. Preparar los datos a actualizar
            const itemData = {
                itemName: data.itemName,
                reference: data.reference || '',
                category: data.category,
                talla: data.talla || 'N/A',
                vidaUtilDias: parseInt(data.vidaUtilDias) || null,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser.uid,
            };

            // 3. Añadir la URL de la foto SOLO SI se subió una nueva
            if (downloadURL) {
                itemData.itemPhotoURL = downloadURL;
            }

            // 4. Añadir al batch
            // NO TOCAMOS EL STOCK. El stock se maneja con 'add-dotacion-stock'
            batch.update(itemRef, itemData);
            // --- FIN DE NUEVA LÓGICA DE EDICIÓN ---

        } else if (type === 'add-dotacion-stock') {
            const itemId = data.itemId;
            const quantity = parseInt(data.quantity);
            if (!itemId || !quantity || quantity <= 0) {
                throw new Error("Cantidad o Ítem inválido.");
            }

            const itemRef = doc(db, "dotacionCatalog", itemId);
            batch.update(itemRef, {
                quantityInStock: increment(quantity)
            });

            // Registrar en historial
            const historyRef = doc(collection(db, "dotacionHistory"));
            batch.set(historyRef, {
                action: 'stock_added', // Acción de añadir stock
                itemId: itemId,
                itemName: (await getDoc(itemRef)).data().itemName, // Obtenemos el nombre
                quantity: quantity,
                adminId: currentUser.uid,
                timestamp: serverTimestamp(),
                purchaseCost: parseFloat(data.purchaseCost.replace(/[$. ]/g, '')) || 0,
            });

        } else if (type === 'register-dotacion-delivery') {
            const itemId = data.itemId;
            const quantity = parseInt(data.quantity);
            const assigneeId = data.assignedTo;
            const assignPhotoFile = data.assignPhoto;
            const itemName = data.itemName; // Nombre del ítem

            if (!itemId || !quantity || quantity <= 0 || !assigneeId) {
                throw new Error("Datos de entrega inválidos.");
            }

            // --- INICIO DE VALIDACIÓN (LÓGICA DE NEGOCIO) ---
            // 1. Verificar si el usuario ya tiene un ítem ACTIVO de este tipo
            const q = query(
                collection(db, "dotacionHistory"),
                where("action", "==", "asignada"),
                where("userId", "==", assigneeId),
                where("itemId", "==", itemId),
                where("status", "==", "activo") // ¡La clave!
            );

            const activeItemsSnap = await getDocs(q);

            if (!activeItemsSnap.empty) {
                // Si la consulta NO está vacía, el usuario ya tiene uno activo.
                const count = activeItemsSnap.size;
                throw new Error(`Este empleado ya tiene ${count} "${itemName}" activo(s). Debe devolver el ítem anterior antes de recibir uno nuevo.`);
            }
            // --- FIN DE VALIDACIÓN ---

            const itemRef = doc(db, "dotacionCatalog", itemId);

            // Subir foto de entrega
            confirmBtn.textContent = 'Redimensionando foto entrega...';
            const resizedBlob = await resizeImage(assignPhotoFile, 800);
            confirmBtn.textContent = 'Subiendo foto entrega...';
            const photoPath = `dotacion_deliveries/${itemId}/${Date.now()}_${assignPhotoFile.name}`;
            const photoStorageRef = ref(storage, photoPath);
            await uploadBytes(photoStorageRef, resizedBlob);
            const deliveryPhotoURL = await getDownloadURL(photoStorageRef);

            // 1. Descontar del Stock
            batch.update(itemRef, {
                quantityInStock: increment(-quantity)
            });

            // 2. Crear registro en el historial
            const historyRef = doc(collection(db, "dotacionHistory"));
            batch.set(historyRef, {
                action: 'asignada',
                status: 'activo',
                itemId: itemId,
                itemName: data.itemName,
                talla: data.talla,
                quantity: quantity,
                userId: assigneeId,
                adminId: currentUser.uid,
                timestamp: serverTimestamp(),
                fechaEntrega: data.fechaEntrega,
                deliveryPhotoURL: deliveryPhotoURL,
                serialNumber: data.serialNumber || null // <-- AÑADIR ESTA LÍNEA
            });

            sendNotificationCallback(
                assigneeId,
                'Dotación Asignada',
                `Se te ha asignado: ${quantity}x ${data.itemName}.`,
                'dotacion'
            );

            // --- INICIO DE MODIFICACIÓN: Lógica 'return-dotacion-options' ---
        } else if (type === 'return-dotacion-options') {
            const historyId = form.dataset.id;
            const itemId = form.dataset.itemid;
            const returnType = data.returnType;
            const itemName = data.itemName;

            // 1. Obtener los nuevos datos
            const returnPhotoFile = data.returnPhoto;
            const observaciones = data.observaciones || '';

            if (!historyId || !itemId || !returnType) {
                throw new Error("Faltan datos (historyId, itemId, returnType) para procesar la devolución.");
            }

            // 2. Validar la foto
            if (!returnPhotoFile || returnPhotoFile.size === 0) {
                throw new Error("La foto de devolución es obligatoria.");
            }

            const historyRef = doc(db, "dotacionHistory", historyId);
            const historyDoc = await getDoc(historyRef);
            if (!historyDoc.exists()) throw new Error("No se encontró el registro de historial de entrega.");

            const userId = historyDoc.data().userId;
            if (!userId) throw new Error("El registro de historial no tiene un ID de empleado asociado.");

            userIdToRefresh = userId;

            // 3. Subir la foto de devolución
            confirmBtn.textContent = 'Redimensionando foto...';
            const resizedBlob = await resizeImage(returnPhotoFile, 800);
            confirmBtn.textContent = 'Subiendo foto...';
            const photoPath = `dotacion_returns/${itemId}/${Date.now()}_${returnPhotoFile.name}`;
            const photoStorageRef = ref(storage, photoPath);
            await uploadBytes(photoStorageRef, resizedBlob);
            const downloadURL = await getDownloadURL(photoStorageRef);
            // --- FIN DE MODIFICACIÓN ---

            if (returnType === 'descarte') {
                // 4. Llamar a la función de descarte con los nuevos datos
                await logDotacionDescarte(batch, historyRef, itemId, itemName, currentUser.uid, userId, downloadURL, observaciones);

            } else if (returnType === 'stock') {
                // 5. Llamar a la función de retorno a stock con los nuevos datos
                await logDotacionReturnToStock(batch, historyRef, itemId, itemName, currentUser.uid, userId, downloadURL, observaciones);

            } else {
                throw new Error("Tipo de devolución no válido.");
            }
            // --- FIN DE NUEVA LÓGICA ---
        }

        await batch.commit();

        // Comprobamos si necesitamos refrescar la vista de asignaciones
        if (userIdToRefresh) {
            // Volvemos a cargar SOLO la vista de detalle de ese usuario
            // Esto es más eficiente y nos mantiene en la misma pantalla.
            loadDotacionAsignaciones(userIdToRefresh);
        } else {
            // Si fue otra acción (como añadir stock), recargamos la vista general
            loadDotacionView();
        }


        closeMainModalCallback();

        // --- INICIO DE LA CORRECCIÓN (Modificación) ---
        // (El bloque 'try' termina aquí)

        // loadDotacionView(); // <-- ELIMINAR O COMENTAR ESTA LÍNEA

        // Los bloques 'catch' y 'finally' ahora están DENTRO de la función
    } catch (error) {
        console.error("Error al guardar dotación:", error);
        alert("Error: " + error.message);
    } finally {
        confirmBtn.disabled = false;
        // Resetear texto del botón
        if (type === 'new-dotacion-catalog-item') confirmBtn.textContent = 'Crear Ítem';
        else if (type === 'add-dotacion-stock') confirmBtn.textContent = 'Añadir Stock';
        else if (type === 'register-dotacion-delivery') confirmBtn.textContent = 'Confirmar Entrega';
        else if (type === 'return-dotacion-options') confirmBtn.textContent = 'Procesar Devolución';
        else if (type === 'edit-dotacion-catalog-item') confirmBtn.textContent = 'Actualizar Ítem';
        else confirmBtn.textContent = 'Guardar';
    }
    // --- FIN DE LA CORRECCIÓN ---
}

/**
 * Marca un ítem como devuelto (descarte) y añade log.
 * (Lógica movida desde la antigua handleReturnDotacionItem)
 * @param {WriteBatch} batch - El batch de Firestore
 * @param {DocumentReference} historyRef - Referencia al historial de entrega
 * @param {string} itemId - ID del ítem en el catálogo
 * @param {string} itemName - Nombre del ítem
 * @param {string} adminId - ID del admin que registra
 * @param {string} userId - ID del empleado que devuelve
 * @param {string} returnPhotoURL - (NUEVO) URL de la foto de devolución
 * @param {string} observaciones - (NUEVO) Observaciones de la devolución
 */
async function logDotacionDescarte(batch, historyRef, itemId, itemName, adminId, userId, returnPhotoURL, observaciones) {
    // 1. Actualiza el estado del registro de entrega
    batch.update(historyRef, {
        status: 'devuelto',
        returnedAt: serverTimestamp(),
        returnedBy: adminId,
        returnPhotoURL: returnPhotoURL || null, // <-- AÑADIDO
        returnNotes: observaciones || ''      // <-- AÑADIDO
    });

    // 2. Añadir un log al historial del CATÁLOGO
    const catalogHistoryRef = doc(collection(db, "dotacionHistory"));
    const userName = getUsersMap().get(userId)?.firstName || 'Usuario';

    batch.set(catalogHistoryRef, {
        action: 'devuelto', // Acción de "devuelto"
        itemId: itemId,
        itemName: itemName,
        quantity: 1, // Asumimos 1
        adminId: adminId,
        notes: observaciones || `Devolución (Descarte) de ${userName}`, // <-- MODIFICADO
        timestamp: serverTimestamp(),
        returnPhotoURL: returnPhotoURL || null // <-- AÑADIDO
    });
}

/**
 * Marca un ítem como devuelto Y lo regresa al stock.
 * @param {WriteBatch} batch - El batch de Firestore
 * @param {DocumentReference} historyRef - Referencia al historial de entrega
 * @param {string} itemId - ID del ítem en el catálogo
 * @param {string} itemName - Nombre del ítem
 * @param {string} adminId - ID del admin que registra
 * @param {string} userId - ID del empleado que devuelve
 * @param {string} returnPhotoURL - (NUEVO) URL de la foto de devolución
 * @param {string} observaciones - (NUEVO) Observaciones de la devolución
 */
async function logDotacionReturnToStock(batch, historyRef, itemId, itemName, adminId, userId, returnPhotoURL, observaciones) {
    // 1. Actualiza el estado del registro de entrega
    batch.update(historyRef, {
        status: 'devuelto_stock', // Nuevo estado
        returnedAt: serverTimestamp(),
        returnedBy: adminId,
        returnPhotoURL: returnPhotoURL || null, // <-- AÑADIDO
        returnNotes: observaciones || ''      // <-- AÑADIDO
    });

    // 2. Añadir un log al historial del CATÁLOGO
    const catalogHistoryRef = doc(collection(db, "dotacionHistory"));
    const userName = getUsersMap().get(userId)?.firstName || 'Usuario';

    batch.set(catalogHistoryRef, {
        action: 'stock_return', // Nueva acción
        itemId: itemId,
        itemName: itemName,
        quantity: 1, // Asumimos 1
        adminId: adminId,
        notes: observaciones || `Devolución a Inventario de ${userName}`, // <-- MODIFICADO
        timestamp: serverTimestamp(),
        returnPhotoURL: returnPhotoURL || null // <-- AÑADIDO
    });

    // 3. Incrementar el stock en el catálogo
    const catalogRef = doc(db, "dotacionCatalog", itemId);
    batch.update(catalogRef, {
        quantityInStock: increment(1)
    });
}

/**
 * Crea la tarjeta para la vista "Detalle de Empleado" (Nivel 2).
 * Muestra el ESTADO de un ítem de catálogo para un empleado.
 * (Con lógica de vencimiento, botones corregidos y foto de entrega)
 * @param {object} catalogItem - El ítem del catálogo (ej. "Casco").
 * @param {object} historySummary - El historial resumido de ese ítem para el empleado.
 * @param {string} userId - El ID del empleado.
 * @param {string} role - El rol del usuario actual.
 * @returns {HTMLElement} - El elemento div de la tarjeta.
 */
function createDotacionDetailCard(catalogItem, historySummary, userId, role) {
    const card = document.createElement('div');

    const canAdmin = (role === 'admin' || role === 'bodega' || role === 'sst');

    // --- LÓGICA DE VENCIMIENTO (Sin cambios) ---
    let statusBorder = 'border-gray-200';
    let vencimientoHtml = '<p class="font-semibold text-gray-800">N/A</p>';
    const vidaUtilDias = catalogItem.vidaUtilDias;
    const lastDeliveryDateStr = historySummary.lastDeliveryDate;
    if (historySummary.status === 'activo' && vidaUtilDias && lastDeliveryDateStr) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const deliveryDate = new Date(lastDeliveryDateStr + 'T00:00:00');
        const expirationDate = new Date(deliveryDate.getTime());
        expirationDate.setDate(expirationDate.getDate() + vidaUtilDias);
        const diffTime = expirationDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const expirationDateString = expirationDate.toLocaleDateString('es-CO');
        if (diffDays <= 0) {
            statusBorder = 'border-red-500 border-2';
            vencimientoHtml = `<p class="font-bold text-lg text-red-600">${expirationDateString} (VENCIDO)</p>`;
        } else if (diffDays <= 30) {
            statusBorder = 'border-yellow-500 border-2';
            vencimientoHtml = `<p class="font-bold text-lg text-yellow-600">${expirationDateString} (Vence en ${diffDays} días)</p>`;
        } else {
            statusBorder = 'border-green-500 border-2';
            vencimientoHtml = `<p class="font-semibold text-gray-800">${expirationDateString}</p>`;
        }
    } else if (historySummary.status === 'activo') {
        statusBorder = 'border-green-500 border-2';
    } else if (historySummary.status === 'devuelto' || historySummary.status === 'devuelto_stock') {
        statusBorder = 'border-gray-400';
    }
    // --- FIN LÓGICA VENCIMIENTO ---

    card.className = `bg-white rounded-lg shadow ${statusBorder} p-4 flex flex-col dotacion-detail-card`;

    // --- Calcular duración (Sin cambios) ---
    let durationText = "N/A";
    if (historySummary.lastDeliveryDate) {
        const lastDate = new Date(historySummary.lastDeliveryDate + 'T00:00:00');
        const today = new Date();
        const diffTime = Math.abs(today - lastDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        durationText = `Hace ${diffDays} día(s)`;
    }

    // --- LÓGICA DE BOTONES DE DEVOLUCIÓN (Sin cambios) ---
    let returnButtonHtml = '';
    if (canAdmin && historySummary.status === 'activo' && historySummary.lastHistoryId) {
        returnButtonHtml = `
            <button data-action="return-dotacion-item" 
                    data-lasthistoryid="${historySummary.lastHistoryId}" 
                    data-itemname="${catalogItem.itemName}"
                    data-itemid="${catalogItem.id}"
                    class="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">
                Registrar Devolución
            </button>`;
    } else if (historySummary.status === 'devuelto' || historySummary.status === 'devuelto_stock') {
        returnButtonHtml = `
            <button class="bg-gray-400 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full" disabled>
                Devuelto
            </button>`;
    } else {
        let disabledText = 'N/A';
        if (role === 'operario') {
            disabledText = 'Devolver (Admin)';
        } else if (historySummary.status === 'ninguno') {
            disabledText = 'No Entregado';
        } else if (canAdmin && historySummary.status === 'activo' && !historySummary.lastHistoryId) {
            disabledText = 'Error (Sin ID)';
        }
        returnButtonHtml = `
            <button class="bg-gray-400 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full" disabled>
                ${disabledText}
            </button>`;
    }
    // --- FIN LÓGICA DE BOTONES DE DEVOLUCIÓN ---


    // --- INICIO DE MODIFICACIÓN (Botón de Foto Entrega) ---
    let fotoEntregaHtml = '';

    // CORRECCIÓN: Mostramos el botón si la URL existe, SIN importar el 'status'
    if (historySummary.deliveryPhotoURL) {
        fotoEntregaHtml = `
            <button data-action="view-dotacion-delivery-image" data-photourl="${historySummary.deliveryPhotoURL}" class="text-sm text-blue-600 hover:underline mt-2 inline-block font-medium">
                Ver Foto de Entrega (Recibo)
            </button>
        `;
    }
    // --- FIN DE MODIFICACIÓN ---


    // --- HTML de la tarjeta (Sin cambios, solo recibe la variable 'fotoEntregaHtml') ---
    card.innerHTML = `
        <div class="flex-grow flex">
            <div class="w-1/3 flex-shrink-0 aspect-square bg-gray-100 rounded-lg overflow-hidden"> 
                <img 
                    src="${catalogItem.itemPhotoURL || 'https://via.placeholder.com/300'}" 
                    alt="${catalogItem.itemName}" 
                    class="w-full h-full object-contain"
                >
            </div>
            
            <div class="w-2/3 flex-grow p-4 flex flex-col">
                <div class="flex-grow">
                    <h3 class="text-lg font-bold text-gray-900">${catalogItem.itemName}</h3>
                    <p class="text-sm text-gray-500">Talla: ${catalogItem.talla || 'N/A'}</p>
                    
                    ${fotoEntregaHtml} <div class="mt-4 text-sm space-y-3"> <div>
                            <p class="font-medium text-gray-600">Total Consumido:</p>
                            <p class="font-bold text-2xl text-blue-600">${historySummary.totalConsumido}</p>
                        </div>
                        <div>
                            <p class="font-medium text-gray-600">Asignado hace:</p>
                            <p class="font-semibold text-gray-800">${durationText}</p>
                        </div>
                        
                        <div>
                            <p class="font-medium text-gray-600">Fecha Vencimiento:</p>
                            ${vencimientoHtml}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="bg-gray-50 p-3 border-t mt-4 rounded-b-lg grid grid-cols-2 gap-2">
            <button data-action="view-item-detail-history" 
                    data-itemid="${catalogItem.id}" 
                    data-itemname="${catalogItem.itemName}" 
                    data-talla="${catalogItem.talla || 'N/A'}" 
                    data-userid="${userId}"
                    class="bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold py-2 px-3 rounded-lg w-full">
                Ver Historial
            </button>
            
            ${returnButtonHtml}
        </div>
    `;
    return card;
}

/**
 * Muestra el historial de un ÍTEM DE CATÁLOGO (no de un usuario).
 * @param {string} [userId] - Opcional. Si se provee, filtra el historial solo para este usuario.
 */
async function handleViewDotacionHistory(itemId, itemName, itemTalla, userId = null) {
    const modal = document.getElementById('tool-history-modal'); // Reutilizamos el modal
    const title = document.getElementById('tool-history-title');
    const body = document.getElementById('tool-history-body');

    if (!modal || !title || !body) return;

    const usersMap = getUsersMap();

    // Título dinámico
    let modalTitle = `Historial de: ${itemName} (Talla: ${itemTalla})`;
    if (userId) {
        const userName = usersMap.get(userId)?.firstName || 'Empleado';
        modalTitle += ` - Asignado a ${userName}`;
    }
    title.textContent = modalTitle;

    body.innerHTML = '<p class="text-gray-500 text-center">Cargando historial...</p>';
    modal.style.display = 'flex';

    try {
        // 1. Cargar el ítem principal (solo para la referencia) y el historial
        const [itemDoc, historySnapshot] = await Promise.all([
            getDoc(doc(db, "dotacionCatalog", itemId)),

            // Consulta de Historial (AHORA FILTRADA SI ES NECESARIO)
            (userId ?
                getDocs(query(
                    collection(db, "dotacionHistory"),
                    where("itemId", "==", itemId),
                    where("userId", "==", userId), // <-- Filtro por usuario
                    orderBy("timestamp", "desc")
                )) :
                getDocs(query(
                    collection(db, "dotacionHistory"),
                    where("itemId", "==", itemId),
                    orderBy("timestamp", "desc")
                ))
            )
        ]);

        // Actualizar el título con la referencia
        const itemData = itemDoc.exists() ? itemDoc.data() : {};
        const itemReference = itemData.reference || null;
        title.textContent = `Historial de: ${itemName} ${itemTalla !== 'N/A' ? `(Talla: ${itemTalla})` : ''} ${itemReference ? `(${itemReference})` : ''}`;

        body.innerHTML = ''; // Limpiar "Cargando..."

        // (Lógica de costos eliminada de aquí, se mantiene en el dashboard de herramientas)

        if (historySnapshot.empty) {
            body.innerHTML += '<p class="text-gray-500 text-center">No hay historial para este ítem.</p>';
            return;
        }

        historySnapshot.forEach(doc => {
            const entry = doc.data();
            const timestamp = entry.timestamp ? entry.timestamp.toDate() : new Date();
            const dateString = timestamp.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

            // --- INICIO DE LA CORRECCIÓN ---
            // Esta es la línea que faltaba
            const timeString = timestamp.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            // --- FIN DE LA CORRECCIÓN ---

            const adminName = usersMap.get(entry.adminId)?.firstName || 'Sistema';

            let entryHtml = '';

            if (entry.action === 'asignada') {
                const targetUser = usersMap.get(entry.userId);
                const targetName = targetUser ? `${targetUser.firstName} ${targetUser.lastName}` : 'Usuario Desconocido';
                const deliveryDate = entry.fechaEntrega ? new Date(entry.fechaEntrega + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A';

                let statusHtml = '';
                if (entry.status === 'devuelto' || entry.status === 'devuelto_stock') {
                    const returnedDate = entry.returnedAt ? entry.returnedAt.toDate().toLocaleDateString('es-CO') : '';
                    statusHtml = `<p class="text-sm font-semibold text-gray-500">Estado: Devuelto (${returnedDate})</p>`;
                } else if (entry.status === 'activo') {
                    statusHtml = '<p class="text-sm font-semibold text-green-600">Estado: Activo</p>';
                }

                const serialHtml = entry.serialNumber
                    ? `<p class="text-sm font-semibold text-gray-800 mt-1">Serial: ${entry.serialNumber}</p>`
                    : '';

                entryHtml = `
                    <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <div class="flex justify-between items-start">
                            <p class="font-semibold text-yellow-800">Entrega de ${entry.quantity} unidad(es) a: ${targetName}</p>
                            ${statusHtml} 
                        </div>
                        <p class="text-sm text-gray-600">Registrado por: ${adminName} (Fecha Entrega: ${deliveryDate})</p>
                        ${entry.deliveryPhotoURL ? `<button data-action="view-dotacion-delivery-image" data-photourl="${entry.deliveryPhotoURL}" class="text-sm text-blue-600 hover:underline mt-2 inline-block font-medium">Ver foto de entrega</button>` : ''}                    <p class="text-xs text-gray-500 mt-1">Registrado el: ${dateString} - ${timeString}</p>
                    </div>
                `;

            } else if (entry.action === 'stock_added') {
                entryHtml = `
                    <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p class="font-semibold text-blue-800">+ ${entry.quantity} unidad(es) añadidas al stock</p>
                        <p class="text-sm text-gray-600">Registrado por: ${adminName}</p>
                        <p class="text-xs text-gray-500 mt-1">Registrado el: ${dateString} - ${timeString}</p>
                    </div>
                `;

            } else if (entry.action === 'devuelto') {
                // Esta es la acción de DESCARTE
                entryHtml = `
                    <div class="p-3 bg-gray-100 border border-gray-300 rounded-lg">
                        <p class="font-semibold text-gray-700">Devolución (Descarte) registrada</p>
                        <p class="text-sm text-gray-600">Registrado por: ${adminName}</p>
                        
                        ${entry.notes ? `<p class="text-sm text-gray-800 mt-2 p-2 bg-white border rounded-md"><strong>Observación:</strong> ${entry.notes}</p>` : ''}
                        ${entry.returnPhotoURL ? `<button data-action="view-dotacion-item-image" data-photourl="${entry.returnPhotoURL}" class="text-sm text-blue-600 hover:underline mt-2 inline-block font-medium">Ver foto de devolución</button>` : ''}                        
                        <p class="text-xs text-gray-500 mt-1">Registrado el: ${dateString} - ${timeString}</p>
                    </div>
                `;
            } else if (entry.action === 'stock_return') {
                // Esta es la nueva acción de DEVOLUCIÓN A INVENTARIO
                entryHtml = `
                    <div class="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <p class="font-semibold text-green-800">Devolución a Inventario (Reutilizable)</p>
                        <p class="text-sm text-gray-600">Registrado por: ${adminName}</p>
                        
                        ${entry.notes ? `<p class="text-sm text-gray-800 mt-2 p-2 bg-white border rounded-md"><strong>Observación:</strong> ${entry.notes}</p>` : ''}
                        ${entry.returnPhotoURL ? `<button data-action="view-dotacion-item-image" data-photourl="${entry.returnPhotoURL}" class="text-sm text-blue-600 hover:underline mt-2 inline-block font-medium">Ver foto de devolución</button>` : ''}                        
                        <p class="text-xs text-gray-500 mt-1">Registrado el: ${dateString} - ${timeString}</p>
                    </div>
                `;
            }


            body.innerHTML += entryHtml;
        });

    } catch (error) {
        console.error("Error al cargar historial de dotación:", error);
        body.innerHTML = '<p class="text-red-500 text-center">Error al cargar el historial.</p>';
    }
}

/**
 * Puebla la lista de usuarios en el filtro de asignación de dotación.
 * Debe ser llamada por app.js DESPUÉS de que el usersMap esté listo.
 */
export function updateDotacionFilterOptions(usersMap) {
    if (!dotacionAssigneeChoices) {
        console.warn("Choices.js de Dotación (dotacionAssigneeChoices) no está listo.");
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
    // (El 'false' al final significa AÑADIR, no reemplazar)
    dotacionAssigneeChoices.setChoices(userOptions, 'value', 'label', false);
}

/**
 * (NUEVA FUNCIÓN)
 * Abre un modal (Nivel 2) que muestra el desglose de ítems para un usuario.
 * @param {string} userId - El ID del usuario.
 * @param {string} userName - El nombre del usuario.
 * @param {string} type - 'consumo' o 'descarte'.
 */
async function openUserReportModal(userId, userName, type) {
    // Reutilizamos el modal de historial de herramientas/dotación
    const modal = document.getElementById('tool-history-modal');
    const titleEl = document.getElementById('tool-history-title');
    const bodyEl = document.getElementById('tool-history-body');

    if (!modal || !titleEl || !bodyEl) return;

    // 1. Definir la acción a buscar y el título
    const action = (type === 'consumo') ? 'asignada' : 'devuelto';
    const title = (type === 'consumo') ? 'Reporte de Consumo' : 'Reporte de Descarte';

    titleEl.textContent = `${title} de: ${userName}`;
    bodyEl.innerHTML = '<p class="text-gray-500 text-center">Cargando reporte...</p>';
    modal.style.display = 'flex';

    try {
        // 2. Consultar el historial del usuario filtrando por la acción
        const historyQuery = query(
            collection(db, "dotacionHistory"),
            where("userId", "==", userId),
            where("action", "==", action)
        );
        const snapshot = await getDocs(historyQuery);

        if (snapshot.empty) {
            bodyEl.innerHTML = '<p class="text-gray-500 text-center">No hay registros para este reporte.</p>';
            return;
        }

        // 3. Agrupar los resultados por ítem
        const itemMap = new Map();
        snapshot.forEach(doc => {
            const entry = doc.data();
            const key = entry.itemId;
            if (!key) return; // Ignorar si no hay itemId

            if (!itemMap.has(key)) {
                itemMap.set(key, {
                    count: 0,
                    itemName: entry.itemName || 'Ítem desconocido',
                    talla: entry.talla || 'N/A', // Usamos la primera talla que encontramos
                    itemId: key
                });
            }
            // Sumamos la cantidad (generalmente 1, pero por si acaso)
            itemMap.get(key).count += (entry.quantity || 0);
        });

        // 4. Renderizar la lista (Nivel 2)
        bodyEl.innerHTML = '<ul class="divide-y divide-gray-200"></ul>';
        const listEl = bodyEl.querySelector('ul');

        // Ordenar por los más consumidos/descartados
        const sortedItems = [...itemMap.values()].sort((a, b) => b.count - a.count);

        sortedItems.forEach(item => {
            const li = document.createElement('li');
            li.className = "py-3 px-2 flex justify-between items-center";

            // Este botón nos lleva al Nivel 3 (reutiliza la acción existente)
            li.innerHTML = `
                <button class="text-left" 
                        data-action="view-dotacion-catalog-history" 
                        data-itemid="${item.itemId}" 
                        data-itemname="${item.itemName}" 
                        data-talla="${item.talla}" 
                        data-userid="${userId}"
                        title="Ver historial detallado de este ítem para ${userName}"
                        >
                    <p class="font-medium text-blue-600 hover:underline">${item.itemName}</p>
                    <p class="text-sm text-gray-500">Talla (referencia): ${item.talla}</p>
                </button>
                <span class="font-bold text-lg ${type === 'consumo' ? 'text-blue-600' : 'text-red-600'}">${item.count}</span>
            `;
            listEl.appendChild(li);
        });

    } catch (error) {
        console.error("Error al generar reporte de usuario:", error);
        bodyEl.innerHTML = '<p class="text-red-500 text-center">Error al cargar el reporte.</p>';
    }
}

/**
 * Convierte un array de objetos a un string CSV.
 * @param {Array<Object>} data - Los datos a convertir.
 * @param {Array<string>} headers - Un array con los nombres de las columnas.
 * @returns {string} El contenido completo del CSV como string.
 */
function convertToCSV(data, headers) {
    // Mapea los nombres de cabecera a las claves (si son diferentes, pero aquí son iguales)
    const headerKeys = headers;

    const headerRow = headers.join(',');
    const rows = data.map(obj => {
        return headerKeys.map(key => {
            let value = obj[key] === null || obj[key] === undefined ? '' : String(obj[key]);
            value = value.replace(/"/g, '""'); // Escapa comillas dobles
            if (value.includes(',')) {
                value = `"${value}"`; // Envuelve en comillas si contiene comas
            }
            return value;
        }).join(',');
    });
    return [headerRow, ...rows].join('\n');
}

/**
 * Dispara la descarga de un archivo CSV en el navegador.
 * @param {string} csvContent - El contenido del archivo CSV.
 * @param {string} filename - El nombre del archivo (ej. "reporte.csv").
 */
function downloadCSV(csvContent, filename) {
    // Añadimos el BOM para asegurar que Excel reconozca el UTF-8 (acentos)
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');

    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}
// --- FIN: NUEVAS FUNCIONES HELPER PARA CSV ---

// --- INICIO: NUEVAS FUNCIONES DE EXPORTACIÓN ---

/**
 * Obtiene los datos del inventario de dotación, aplicando los filtros actuales
 * de la interfaz de usuario (búsqueda y categoría).
 * @returns {Promise<Array<Object>>} Una promesa que resuelve a un array de ítems filtrados.
 */
async function getFilteredInventarioData() {
    // 1. Obtener filtros actuales (igual que en loadDotacionCatalog)
    const searchTerm = document.getElementById('dotacion-search-input').value.toLowerCase();
    const categoryFilter = (dotacionCategoryChoices && dotacionCategoryChoices.getValue(true)) ? dotacionCategoryChoices.getValue(true) : 'all';

    // 2. Obtener TODOS los datos del catálogo
    let dotacionQuery = query(collection(db, "dotacionCatalog"), orderBy("itemName"));
    const snapshot = await getDocs(dotacionQuery);
    let items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 3. Aplicar filtros de JS (lógica idéntica a loadDotacionCatalog)
    if (searchTerm) {
        items = items.filter(item =>
            item.itemName.toLowerCase().includes(searchTerm) ||
            (item.reference && item.reference.toLowerCase().includes(searchTerm))
        );
    }
    if (categoryFilter !== 'all') {
        items = items.filter(item => item.category === categoryFilter);
    }

    return items;
}

/**
 * Exporta la vista actual del INVENTARIO a CSV.
 */
async function exportInventarioCSV() {
    // Asumimos que 'loadingOverlay' es accesible globalmente desde app.js
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    try {
        const items = await getFilteredInventarioData();

        if (items.length === 0) {
            alert("No hay datos para exportar con los filtros actuales.");
            return;
        }

        // 4. Formatear para CSV
        const headers = ['itemName', 'reference', 'category', 'talla', 'quantityInStock', 'vidaUtilDias'];
        // Mapeamos los datos a los nombres de las cabeceras
        const dataToExport = items.map(item => ({
            itemName: item.itemName || '',
            reference: item.reference || '',
            category: item.category || '',
            talla: item.talla || 'N/A',
            quantityInStock: item.quantityInStock || 0,
            vidaUtilDias: item.vidaUtilDias || 'N/A'
        }));

        const csvContent = convertToCSV(dataToExport, headers);
        downloadCSV(csvContent, 'Reporte_Inventario_Dotacion.csv');

    } catch (error) {
        console.error("Error al exportar inventario CSV:", error);
        alert("No se pudo generar el reporte CSV: " + error.message);
    } finally {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }
}

/**
 * Exporta la vista actual del INVENTARIO a PDF.
 * (VERSIÓN MEJORADA con filtros y cabecera)
 */
async function exportInventarioPDF() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    try {
        // Verificamos que jsPDF y autoTable estén cargados (como en app.js)
        const { jsPDF } = window.jspdf;
        if (!jsPDF || !jsPDF.API.autoTable) {
            throw new Error("La librería jsPDF o jsPDF-AutoTable no está cargada.");
        }
        const doc = new jsPDF();

        const items = await getFilteredInventarioData();

        if (items.length === 0) {
            alert("No hay datos para exportar con los filtros actuales.");
            return;
        }

        // 4. Formatear para PDF AutoTable
        const head = [['Ítem', 'Referencia', 'Categoría', 'Talla', 'Stock', 'Vida Útil (Días)']];
        const body = items.map(item => [
            item.itemName || '',
            item.reference || '',
            item.category || '',
            item.talla || 'N/A',
            item.quantityInStock || 0,
            item.vidaUtilDias || 'N/A'
        ]);

        // --- INICIO DE MODIFICACIÓN (Añadir cabecera) ---
        const categoryFilter = (dotacionCategoryChoices && dotacionCategoryChoices.getValue(true)) ? dotacionCategoryChoices.getValue(true) : 'all';
        const searchTerm = document.getElementById('dotacion-search-input').value || 'Ninguna';
        const fecha = new Date().toLocaleDateString('es-CO');

        doc.setFontSize(18);
        doc.text("Reporte de Inventario de Dotación", 14, 22);

        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Fecha de Reporte: ${fecha}`, 14, 30);

        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text("Filtros Aplicados:", 14, 40);
        doc.setFontSize(10);
        doc.setTextColor(50);
        doc.text(`- Categoría: ${categoryFilter}`, 14, 46);
        doc.text(`- Búsqueda: ${searchTerm}`, 14, 52);

        doc.autoTable({
            startY: 60, // Ajustamos la posición inicial
            // --- FIN DE MODIFICACIÓN ---
            head: head,
            body: body,
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185] }, // Azul
        });

        doc.save('Reporte_Inventario_Dotacion.pdf');

    } catch (error) {
        console.error("Error al exportar inventario PDF:", error);
        alert("No se pudo generar el PDF: " + error.message);
    } finally {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }
}
// --- FIN: NUEVAS FUNCIONES DE EXPORTACIÓN ---

/**
 * Obtiene los datos del resumen de asignaciones (Nivel 1).
 * @returns {Promise<Array<Object>>} Datos de asignación por usuario.
 */
async function getAsignacionesSummaryData() {
    const usersMap = getUsersMap();

    // Consulta (idéntica a la de loadDotacionAsignaciones Nivel 1)
    let historyQuery = query(collection(db, "dotacionHistory"), where("action", "==", "asignada"));
    const snapshot = await getDocs(historyQuery);

    const summaryMap = new Map();
    snapshot.forEach(doc => {
        const entry = doc.data();
        if (entry.userId) {
            const current = summaryMap.get(entry.userId) || { count: 0 };
            current.count += (entry.quantity || 0);
            summaryMap.set(entry.userId, current);
        }
    });

    if (summaryMap.size === 0) return [];

    // Formatear los datos para exportar
    const dataToExport = [];
    summaryMap.forEach((data, userId) => {
        const user = usersMap.get(userId);
        const userName = user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido';
        dataToExport.push({
            Empleado: userName,
            TotalAsignado: data.count
        });
    });

    // Ordenar por nombre de empleado
    return dataToExport.sort((a, b) => a.Empleado.localeCompare(b.Empleado));
}

/**
 * Exporta el Resumen de Asignaciones a CSV.
 */
async function exportAsignacionesCSV() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    try {
        const data = await getAsignacionesSummaryData();
        if (data.length === 0) {
            alert("No hay datos de asignaciones para exportar.");
            return;
        }

        const headers = ['Empleado', 'TotalAsignado'];
        const csvContent = convertToCSV(data, headers); // Reutiliza la función helper
        downloadCSV(csvContent, 'Reporte_Asignaciones_Dotacion.csv'); // Reutiliza la función helper

    } catch (error) {
        console.error("Error al exportar asignaciones CSV:", error);
    } finally {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }
}

/**
 * Exporta el Resumen de Asignaciones a PDF.
 */
async function exportAsignacionesPDF() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    try {
        const { jsPDF } = window.jspdf;
        if (!jsPDF || !jsPDF.API.autoTable) {
            throw new Error("La librería jsPDF o jsPDF-AutoTable no está cargada.");
        }
        const doc = new jsPDF();

        const data = await getAsignacionesSummaryData();
        if (data.length === 0) {
            alert("No hay datos de asignaciones para exportar.");
            return;
        }

        const head = [['Empleado', 'Total Ítems Asignados']];
        const body = data.map(item => [item.Empleado, item.TotalAsignado]);
        const fecha = new Date().toLocaleDateString('es-CO');

        doc.setFontSize(18);
        doc.text("Reporte de Asignaciones de Dotación", 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Fecha de Reporte: ${fecha}`, 14, 30);
        doc.text("Este reporte muestra el conteo total de ítems entregados (histórico).", 14, 36);

        doc.autoTable({
            startY: 45,
            head: head,
            body: body,
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185] },
        });

        doc.save('Reporte_Asignaciones_Dotacion.pdf');

    } catch (error) {
        console.error("Error al exportar asignaciones PDF:", error);
    } finally {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }
}