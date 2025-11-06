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
        }

        // Acciones dentro de la tarjeta de dotación (Inventario)
        const dotacionCard = target.closest('.dotacion-catalog-card');
        if (dotacionCard) {
            const itemId = dotacionCard.dataset.id;

            // Cargar datos del ítem para los modales
            const cardData = {
                id: itemId,
                itemName: dotacionCard.dataset.name,
                talla: dotacionCard.dataset.talla,
                itemPhotoURL: dotacionCard.dataset.photourl,
                quantityInStock: parseInt(dotacionCard.dataset.stock) || 0
            };

            switch (action) {
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
                case 'return-dotacion-item': {
                    const lastHistoryId = button.dataset.lasthistoryid;
                    const itemName = button.dataset.itemname;
                    if (lastHistoryId) {
                        openConfirmModalCallback(`¿Confirmas la devolución (descarte) del último "${itemName}" entregado? Esto permitirá que el empleado reciba uno nuevo.`, () => {
                            handleReturnDotacionItem(lastHistoryId, itemName);
                        });
                    } else {
                        alert("No hay un registro de entrega para devolver.");
                    }
                    break;
                }

                // --- INICIO DE CORRECCIÓN ---
                // Nivel 2: Clic en "Ver Foto"
                case 'view-dotacion-delivery-image': {
                    // Usamos .closest() para asegurar que obtenemos el 'photourl' de la fila <tr>
                    const deliveryUrl = button.closest('.dotacion-history-row')?.dataset.photourl;
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
    });

    // 2. Conectar el formulario del modal
    const modalForm = document.getElementById('modal-form');
    modalForm.addEventListener('submit', (e) => {
        const type = modalForm.dataset.type;
        const form = e.target;

        if (['new-dotacion-catalog-item', 'add-dotacion-stock', 'register-dotacion-delivery'].includes(type)) {
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

        filterBar.classList.add('hidden'); // Operario no usa filtros
        historyContainer.classList.remove('hidden'); // Mostrar el contenedor de Asignaciones

        // El operario solo ve su historial detallado (Nivel 2)
        loadDotacionAsignaciones(currentUser.uid);

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
            // Leemos el filtro y dejamos que loadDotacionAsignaciones decida
            const assigneeFilter = (dotacionAssigneeChoices && dotacionAssigneeChoices.getValue(true)) ? dotacionAssigneeChoices.getValue(true) : 'all';
            loadDotacionAsignaciones(assigneeFilter);
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
 * @param {string} userIdFilter - 'all' (para resumen) o un ID de usuario específico (para detalle).
 */
async function loadDotacionAsignaciones(userIdFilter = 'all') {
    const role = getCurrentUserRole();

    // Contenedores
    const summaryContainer = document.getElementById('dotacion-summary-table-container');
    const detailGrid = document.getElementById('dotacion-detail-grid-container');
    const backBtn = document.getElementById('dotacion-back-to-summary-btn');

    // Elementos del Resumen (Nivel 1)
    const summaryTableBody = document.getElementById('dotacion-summary-table-body');

    if (unsubscribeDotacion) unsubscribeDotacion();

    const usersMap = getUsersMap();

    if (userIdFilter === 'all') {
        // --- 1. VISTA RESUMEN (NIVEL 1: POR EMPLEADO) ---
        summaryContainer.classList.remove('hidden');
        detailGrid.classList.add('hidden');
        backBtn.classList.add('hidden');

        summaryTableBody.innerHTML = '<tr><td colspan="3" class="text-center py-6"><div class="loader mx-auto"></div></td></tr>';

        let historyQuery = query(collection(db, "dotacionHistory"), where("action", "==", "asignada"));

        unsubscribeDotacion = onSnapshot(historyQuery, (snapshot) => {
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
        // --- 2. VISTA DETALLADA (NIVEL 2: NUEVA LÓGICA DE "ESTADO") ---
        summaryContainer.classList.add('hidden');
        detailGrid.classList.remove('hidden');
        backBtn.classList.toggle('hidden', role === 'operario');

        detailGrid.innerHTML = '<div class="loader-container col-span-full"><div class="loader mx-auto"></div></div>';

        // 1. Consultas en paralelo: Catálogo e Historial del Usuario
        try {
            const [catalogSnapshot, historySnapshot] = await Promise.all([
                getDocs(query(collection(db, "dotacionCatalog"), orderBy("itemName"))),

                getDocs(query(
                    collection(db, "dotacionHistory"),
                    where("action", "==", "asignada"),
                    where("userId", "==", userIdFilter),
                    orderBy("fechaEntrega", "desc")
                ))
            ]);

            // 2. Procesar el historial del usuario
            const userHistoryMap = new Map();

            historySnapshot.forEach(doc => {
                const entry = { id: doc.id, ...doc.data() };
                const key = entry.itemId;

                // --- INICIO DE CORRECCIÓN ---
                if (!userHistoryMap.has(key)) {
                    userHistoryMap.set(key, {
                        itemId: entry.itemId,
                        itemName: entry.itemName,
                        talla: entry.talla,
                        totalConsumido: 0, // <-- CORREGIDO (de 'count' a 'totalConsumido')
                        lastDeliveryDate: null,
                        lastHistoryId: null,
                        status: 'ninguno'
                    });
                }

                const summary = userHistoryMap.get(key);
                summary.totalConsumido += (entry.quantity || 0); // <-- CORREGIDO (de 'count' a 'totalConsumido')
                // --- FIN DE CORRECCIÓN ---

                if (!summary.lastDeliveryDate) {
                    summary.lastDeliveryDate = entry.fechaEntrega;
                    summary.lastHistoryId = entry.id;
                    summary.status = entry.status || 'activo';
                }
            });

            // 3. Obtener las fotos de los ítems del catálogo
            const catalogIds = Array.from(userHistoryMap.keys());
            const catalogPhotos = new Map();
            if (catalogIds.length > 0) {
                for (const itemId of catalogIds) {
                    try {
                        const itemDoc = await getDoc(doc(db, "dotacionCatalog", itemId));
                        if (itemDoc.exists()) {
                            catalogPhotos.set(itemId, itemDoc.data().itemPhotoURL || null);
                        }
                    } catch (e) { console.warn(`No se encontró el ítem ${itemId} en el catálogo.`); }
                }
            }

            detailGrid.innerHTML = '';
            if (catalogSnapshot.empty) {
                detailGrid.innerHTML = '<p class="text-gray-500 text-center col-span-full">No hay ítems de dotación en el catálogo.</p>';
                return;
            }

            // 4. Renderizar: Iterar sobre el CATÁLOGO, no sobre el historial
            catalogSnapshot.forEach((catalogDoc) => {
                const catalogItem = { id: catalogDoc.id, ...catalogDoc.data() };

                const historySummary = userHistoryMap.get(catalogItem.id) || {
                    totalConsumido: 0,
                    lastDeliveryDate: null,
                    lastHistoryId: null,
                    status: 'ninguno'
                };

                // Crear la tarjeta de estado
                const card = createDotacionDetailCard(catalogItem, historySummary, userIdFilter, role);
                detailGrid.appendChild(card);
            });

        } catch (error) {
            console.error("Error al cargar el detalle de dotación del empleado:", error);
            detailGrid.innerHTML = '<p class="text-red-500 text-center col-span-full">Error al cargar el historial.</p>';
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
        
        <div class="bg-gray-50 p-3 border-t grid grid-cols-3 gap-2">
            <button data-action="register-dotacion-delivery" class="bg-green-500 hover:bg-green-600 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">Registrar Entrega</button>
            <button data-action="add-dotacion-stock" class="bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">Añadir Stock</button>
            <button data-action="view-dotacion-catalog-history" class="bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold py-2 px-3 rounded-lg w-full">Historial</button>
        </div>
    `;
    return card;
}

/**
 * Carga el dashboard de resumen de dotación.
 * (Corregido el error de HTML)
 */
async function loadDotacionDashboard(container) {
    container.innerHTML = `<div class="text-center p-10"><p class="text-gray-500">Calculando estadísticas...</p><div class="loader mx-auto mt-4"></div></div>`;

    try {
        const usersMap = getUsersMap();

        // Consultas en paralelo
        const [catalogSnapshot, historySnapshot] = await Promise.all([
            getDocs(query(collection(db, "dotacionCatalog"))),
            getDocs(query(collection(db, "dotacionHistory")))
        ]);

        let kpi = { totalTipos: 0, totalStock: 0, totalAsignado: 0 };
        const assignedToMap = new Map();
        const categoryStockMap = new Map();

        catalogSnapshot.forEach(doc => {
            const item = doc.data();
            kpi.totalTipos++;
            kpi.totalStock += (item.quantityInStock || 0);

            const category = item.category || 'Otro';
            categoryStockMap.set(category, (categoryStockMap.get(category) || 0) + (item.quantityInStock || 0));
        });

        historySnapshot.forEach(doc => {
            const entry = doc.data();
            const quantity = entry.quantity || 0;
            kpi.totalAsignado += quantity;
            if (entry.userId) {
                assignedToMap.set(entry.userId, (assignedToMap.get(entry.userId) || 0) + quantity);
            }
        });

        // HTML para KPIs (Corregido)
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
                    <p class="text-sm font-medium text-yellow-800">Total Asignado</p>
                    <p class="text-3xl font-bold text-yellow-900">${kpi.totalAsignado}</p>
                </div>
                <div class="bg-gray-100 p-4 rounded-lg border border-gray-300 text-center">
                    <p class="text-sm font-medium text-gray-700">Total General</p>
                    <p class="text-3xl font-bold text-gray-800">${kpi.totalStock + kpi.totalAsignado}</p>
                </div>
            </div>
        `;

        // HTML para Reportes
        let assignedHtml = '<p class="text-sm text-gray-500">No hay ítems asignados.</p>';
        if (assignedToMap.size > 0) {
            assignedHtml = '<ul class="divide-y divide-gray-200">';
            const sortedAssigned = [...assignedToMap.entries()].sort((a, b) => b[1] - a[1]);
            sortedAssigned.forEach(([userId, count]) => {
                const user = usersMap.get(userId);
                const userName = user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido';
                assignedHtml += `<li class="py-2 flex justify-between items-center"><span class="font-medium text-gray-700">${userName}</span><span class="font-bold text-lg text-blue-600">${count}</span></li>`;
            });
            assignedHtml += '</ul>';
        }

        let categoryHtml = '<p class="text-sm text-gray-500">No hay ítems en stock.</p>';
        if (categoryStockMap.size > 0) {
            categoryHtml = '<ul class="divide-y divide-gray-200">';
            [...categoryStockMap.entries()].sort((a, b) => b[1] - a[1]).forEach(([category, count]) => {
                categoryHtml += `<li class="py-2 flex justify-between items-center"><span class="font-medium text-gray-700">${category}</span><span class="font-bold text-lg text-green-600">${count}</span></li>`;
            });
            categoryHtml += '</ul>';
        }

        const reportsHtml = `
            <div class="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-white p-4 rounded-lg shadow-md border">
                    <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-3">Ítems Asignados (por Colaborador)</h3>
                    <div class="max-h-60 overflow-y-auto pr-2">${assignedHtml}</div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow-md border">
                    <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-3">Stock Actual (por Categoría)</h3>
                    <div class="max-h-60 overflow-y-auto pr-2">${categoryHtml}</div>
                </div>
            </div>
        `;
        container.innerHTML = kpiHtml + reportsHtml;

    } catch (error) {
        console.error("Error al cargar el dashboard de dotación:", error);
        container.innerHTML = `<p class="text-red-500 text-center p-10">Error al cargar las estadísticas: ${error.message}</p>`;
    }
}

/**
 * Guarda los cambios de dotación (Crea Catálogo, Añade Stock, Registra Entrega).
 */
async function handleSaveDotacion(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const type = form.dataset.type;
    const currentUser = getCurrentUser();

    const confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Guardando...';

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
                createdAt: serverTimestamp(),
                createdBy: currentUser.uid,
            };
            batch.set(newItemRef, itemData);

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
                status: 'activo', // <-- CAMBIO: Marcar como activo
                itemId: itemId,
                itemName: data.itemName,
                talla: data.talla,
                quantity: quantity,
                userId: assigneeId,
                adminId: currentUser.uid,
                timestamp: serverTimestamp(),
                fechaEntrega: data.fechaEntrega,
                deliveryPhotoURL: deliveryPhotoURL
            });

            sendNotificationCallback(
                assigneeId,
                'Dotación Asignada',
                `Se te ha asignado: ${quantity}x ${data.itemName}.`,
                'dotacion'
            );
        }

        await batch.commit();
        closeMainModalCallback();

    } catch (error) {
        console.error("Error al guardar dotación:", error);
        alert("Error: " + error.message);
    } finally {
        confirmBtn.disabled = false;
        // Resetear texto del botón
        if (type === 'new-dotacion-catalog-item') confirmBtn.textContent = 'Crear Ítem';
        else if (type === 'add-dotacion-stock') confirmBtn.textContent = 'Añadir Stock';
        else if (type === 'register-dotacion-delivery') confirmBtn.textContent = 'Confirmar Entrega';
        else confirmBtn.textContent = 'Guardar';
    }
}

/**
 * Marca un ítem de dotación como "devuelto" (descarte).
 * Esto permite al usuario recibir uno nuevo.
 * @param {string} historyId - ID del documento de historial de entrega.
 * @param {string} itemName - Nombre del ítem (para el log).
 */
async function handleReturnDotacionItem(historyId, itemName) {
    if (!historyId) return;

    const historyRef = doc(db, "dotacionHistory", historyId);
    const currentUser = getCurrentUser();

    try {
        const batch = writeBatch(db);

        // 1. Actualiza el estado del registro de entrega
        batch.update(historyRef, {
            status: 'devuelto', // <-- CAMBIO: De 'activo' a 'devuelto'
            returnedAt: serverTimestamp(),
            returnedBy: currentUser.uid
        });

        // 2. (Opcional pero recomendado) Añadir un log al historial del CATÁLOGO
        const historyDoc = await getDoc(historyRef);
        const historyData = historyDoc.data();

        if (historyData && historyData.itemId) {
            const catalogHistoryRef = doc(collection(db, "dotacionHistory"));
            const userName = getUsersMap().get(historyData.userId)?.firstName || 'Usuario';

            batch.set(catalogHistoryRef, {
                action: 'devuelto', // Acción de "devuelto"
                itemId: historyData.itemId,
                itemName: itemName,
                quantity: historyData.quantity,
                adminId: currentUser.uid,
                notes: `Devolución de ${userName}`,
                timestamp: serverTimestamp()
            });
        }

        await batch.commit();
        // La vista se actualizará sola gracias a onSnapshot

    } catch (error) {
        console.error("Error al registrar la devolución:", error);
        alert("No se pudo registrar la devolución.");
    }
}

/**
 * Crea la tarjeta para la vista "Detalle de Empleado" (Nivel 2).
 * Muestra el ESTADO de un ítem de catálogo para un empleado.
 * @param {object} catalogItem - El ítem del catálogo (ej. "Casco").
 * @param {object} historySummary - El historial resumido de ese ítem para el empleado.
 * @param {string} userId - El ID del empleado.
 * @param {string} role - El rol del usuario actual.
 * @returns {HTMLElement} - El elemento div de la tarjeta.
 */
function createDotacionDetailCard(catalogItem, historySummary, userId, role) {
    const card = document.createElement('div');
    // Añadimos un borde de color según el estado
    let statusBorder = 'border-gray-200';
    if (historySummary.status === 'activo') {
        statusBorder = 'border-green-500 border-2';
    } else if (historySummary.status === 'devuelto') {
        statusBorder = 'border-gray-400';
    }

    card.className = `bg-white rounded-lg shadow ${statusBorder} p-4 flex flex-col dotacion-detail-card`;

    const canAdmin = (role === 'admin' || role === 'bodega' || role === 'sst');

    // Calcular duración
    let durationText = "N/A";
    if (historySummary.lastDeliveryDate) {
        const lastDate = new Date(historySummary.lastDeliveryDate + 'T00:00:00');
        const today = new Date();
        const diffTime = Math.abs(today - lastDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        durationText = `Hace ${diffDays} día(s)`;
    }

    // Lógica del botón Devolver
    let returnButtonHtml = '';
    // Solo se puede devolver si es Admin Y el ítem está 'activo'
    if (canAdmin && historySummary.status === 'activo' && historySummary.lastHistoryId) {
        returnButtonHtml = `
            <button data-action="return-dotacion-item" 
                    data-lasthistoryid="${historySummary.lastHistoryId}" 
                    data-itemname="${catalogItem.itemName}"
                    class="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full">
                Devolver (Descarte)
            </button>`;
    } else if (historySummary.status === 'devuelto') {
        returnButtonHtml = `
            <button class="bg-gray-400 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full" disabled>
                Devuelto
            </button>`;
    } else {
        // 'ninguno' o no es admin
        returnButtonHtml = `
            <button class="bg-gray-400 text-white text-sm font-semibold py-2 px-3 rounded-lg w-full" disabled>
                ${canAdmin ? 'N/A' : 'Devolver (Descarte)'}
            </button>`;
    }

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
                    
                    <div class="mt-4 text-sm space-y-2">
                        <div>
                            <p class="font-medium text-gray-600">Total Consumido:</p>
                            <p class="font-bold text-2xl text-blue-600">${historySummary.totalConsumido}</p>
                        </div>
                        <div>
                            <p class="font-medium text-gray-600">Última Entrega:</p>
                            <p class="font-semibold text-gray-800">${durationText}</p>
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

        // 2. (Se eliminaron los cálculos de 'totalAsignado' y 'currentStock')
        // 3. (Se eliminó la variable 'summaryHtml' y el body.innerHTML += summaryHtml)

        if (historySnapshot.empty) {
            body.innerHTML += '<p class="text-gray-500 text-center">No hay historial para este ítem.</p>';
            return;
        }

        historySnapshot.forEach(doc => {
            const entry = doc.data();
            const timestamp = entry.timestamp ? entry.timestamp.toDate() : new Date();
            const dateString = timestamp.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
            const adminName = usersMap.get(entry.adminId)?.firstName || 'Sistema';

            let entryHtml = '';

            if (entry.action === 'asignada') {
                const targetUser = usersMap.get(entry.userId);
                const targetName = targetUser ? `${targetUser.firstName} ${targetUser.lastName}` : 'Usuario Desconocido';
                const deliveryDate = entry.fechaEntrega ? new Date(entry.fechaEntrega + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A';

                let statusHtml = '';
                if (entry.status === 'devuelto') {
                    const returnedDate = entry.returnedAt ? entry.returnedAt.toDate().toLocaleDateString('es-CO') : '';
                    statusHtml = `<p class="text-sm font-semibold text-gray-500">Estado: Devuelto (${returnedDate})</p>`;
                } else if (entry.status === 'activo') {
                    statusHtml = '<p class="text-sm font-semibold text-green-600">Estado: Activo</p>';
                }

                entryHtml = `
                    <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <div class="flex justify-between items-start">
                            <p class="font-semibold text-yellow-800">Entrega de ${entry.quantity} unidad(es) a: ${targetName}</p>
                            ${statusHtml} 
                        </div>
                        <p class="text-sm text-gray-600">Registrado por: ${adminName} (Fecha Entrega: ${deliveryDate})</p>
                    ${entry.deliveryPhotoURL ? `<button data-action="view-tool-image" data-url="${entry.deliveryPhotoURL}" class="text-sm text-blue-600 hover:underline mt-2 inline-block font-medium">Ver foto de entrega</button>` : ''}                        <p class="text-xs text-gray-500 mt-1">Registrado el: ${dateString}</p>
                    </div>
                `;

            } else if (entry.action === 'stock_added') {
                entryHtml = `
                    <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p class="font-semibold text-blue-800">+ ${entry.quantity} unidad(es) añadidas al stock</p>
                        <p class="text-sm text-gray-600">Registrado por: ${adminName}</p>
                        <p class="text-xs text-gray-500 mt-1">Registrado el: ${dateString}</p>
                    </div>
                `;

            } else if (entry.action === 'devuelto') {
                entryHtml = `
                    <div class="p-3 bg-gray-100 border border-gray-300 rounded-lg">
                        <p class="font-semibold text-gray-700">Devolución (Descarte) registrada</p>
                        <p class="text-sm text-gray-600">Registrado por: ${adminName}</p>
                        <p class="text-sm text-gray-600">Notas: ${entry.notes || 'N/A'}</p>
                        <p class="text-xs text-gray-500 mt-1">Registrado el: ${dateString}</p>
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