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

    const titleElement = document.getElementById('dotacion-view-title');
    const newDotacionBtn = document.getElementById('new-dotacion-item-btn');
    const tabsNav = document.getElementById('dotacion-tabs-nav');
    const filterBar = document.getElementById('dotacion-filter-bar');
    const assigneeContainer = document.getElementById('dotacion-assignee-container');
    const searchContainer = document.getElementById('dotacion-search-container');
    const categoryContainer = document.getElementById('dotacion-category-container');
    const gridContainer = document.getElementById('dotacion-grid-container');
    const dashboardContainer = document.getElementById('dotacion-dashboard-container');
    const historyContainer = document.getElementById('dotacion-history-container');

    const inventarioActions = document.getElementById('dotacion-inventario-actions');
    const asignacionesActions = document.getElementById('dotacion-asignaciones-actions');

    if (!titleElement || !filterBar) return;

    // 1. RESET TOTAL (Ocultar todo)
    gridContainer.classList.add('hidden');
    dashboardContainer.classList.add('hidden');
    historyContainer.classList.add('hidden');

    // --- CORRECCIÓN CLAVE AQUÍ ---
    filterBar.classList.add('hidden');
    filterBar.classList.remove('md:grid'); // <--- ESTO ELIMINA LA LÍNEA BLANCA
    // -----------------------------

    if (inventarioActions) inventarioActions.classList.add('hidden');
    if (asignacionesActions) asignacionesActions.classList.add('hidden');

    // 2. Lógica según Rol
    const isAdminView = (role === 'admin' || role === 'bodega' || role === 'sst');
    newDotacionBtn.classList.toggle('hidden', !isAdminView);
    tabsNav.classList.toggle('hidden', !isAdminView);

    if (role === 'operario') {
        const currentUser = getCurrentUser();
        titleElement.textContent = `Mi Dotación`;
        historyContainer.classList.remove('hidden');
        loadDotacionAsignaciones(currentUser.uid, 'dotacion-history-container');

    } else {
        titleElement.textContent = 'Gestión de Dotación';
        const activeTab = document.querySelector('#dotacion-tabs-nav .active')?.dataset.statusFilter || 'resumen';

        if (activeTab === 'resumen') {
            // Pestaña Resumen: 
            // No tocamos filterBar, así que se queda oculto y sin 'md:grid' (gracias al Reset)
            dashboardContainer.classList.remove('hidden');
            loadDotacionDashboard(dashboardContainer);

        } else if (activeTab === 'inventario') {
            // Pestaña Inventario: Restauramos la visibilidad y la rejilla
            filterBar.classList.remove('hidden');
            // Forzamos las clases de diseño específicas para esta vista
            filterBar.className = "md:grid md:grid-cols-4 gap-4 items-center p-4 bg-white border border-gray-200 rounded-lg mb-6 shadow-sm";

            searchContainer.classList.remove('hidden');
            searchContainer.className = "md:col-span-3";

            categoryContainer.classList.remove('hidden');
            categoryContainer.className = "md:col-span-1";

            assigneeContainer.classList.add('hidden');

            if (inventarioActions) inventarioActions.classList.remove('hidden');

            gridContainer.classList.remove('hidden');
            loadDotacionCatalog();

        } else if (activeTab === 'asignaciones') {
            // Pestaña Asignaciones: Restauramos la visibilidad
            filterBar.classList.remove('hidden');

            // --- CORRECCIÓN: 1 Columna para que ocupe todo el ancho ---
            filterBar.className = "md:grid md:grid-cols-1 gap-4 items-center p-4 bg-white border border-gray-200 rounded-lg mb-6 shadow-sm";

            searchContainer.classList.add('hidden');
            categoryContainer.classList.add('hidden');

            assigneeContainer.classList.remove('hidden');
            assigneeContainer.className = "md:col-span-1 w-full"; // Forzamos ancho total

            if (asignacionesActions) asignacionesActions.classList.remove('hidden');

            historyContainer.classList.remove('hidden');
            const assigneeFilter = (dotacionAssigneeChoices && dotacionAssigneeChoices.getValue(true)) ? dotacionAssigneeChoices.getValue(true) : 'all';
            loadDotacionAsignaciones(assigneeFilter, 'dotacion-history-container');
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
 * Carga el reporte de dotación de un empleado en el contenedor especificado.
 */
export async function loadDotacionAsignaciones(userId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`[Dotacion] Contenedor ${containerId} no encontrado.`);
        return;
    }

    // 1. Estado de Carga
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-12">
            <div class="loader mx-auto mb-4"></div>
            <p class="text-gray-500 text-sm animate-pulse">Cargando inventario asignado...</p>
        </div>
    `;

    try {
        // --- CORRECCIÓN: Usamos 'db' (la variable global del módulo) ---
        if (!db) throw new Error("La base de datos no está inicializada en dotacion.js");

        // 2. Consultar Historial de Asignaciones
        const qHistory = query(
            collection(db, "dotacionHistory"),
            where("userId", "==", userId),
            where("action", "==", "asignada"),
            orderBy("fechaEntrega", "desc")
        );

        const snapshot = await getDocs(qHistory);

        if (snapshot.empty) {
            container.innerHTML = `
                <div class="bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 p-10 text-center mt-4">
                    <div class="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                        <i class="fa-solid fa-shirt text-gray-300 text-3xl"></i>
                    </div>
                    <h4 class="text-gray-600 font-bold">Sin dotación registrada</h4>
                    <p class="text-gray-400 text-xs mt-1">Este colaborador no tiene historial de entregas.</p>
                </div>`;
            return;
        }

        // 3. Procesar Datos
        let totalItemsDelivered = 0;
        let activeItemsCount = 0;
        let lastDeliveryDate = null;
        const activeItems = [];

        // Recolectar IDs para cargar catálogo
        const uniqueItemIds = new Set();
        snapshot.docs.forEach(doc => uniqueItemIds.add(doc.data().itemId));

        const catalogMap = new Map();
        for (const itemId of uniqueItemIds) {
            try {
                const catSnap = await getDoc(doc(db, "dotacionCatalog", itemId));
                if (catSnap.exists()) catalogMap.set(itemId, catSnap.data());
            } catch (e) { console.warn("Ítem catálogo no encontrado", itemId); }
        }

        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            const catalogItem = catalogMap.get(data.itemId) || {};

            totalItemsDelivered += (data.quantity || 0);

            if (!lastDeliveryDate) lastDeliveryDate = data.fechaEntrega;

            // Solo mostramos en la tabla los que están ACTIVOS
            if (data.status === 'activo') {
                activeItemsCount += (data.quantity || 0);

                // Calcular Vencimiento
                let statusHtml = '<span class="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded">Indefinido</span>';
                let expirationText = '---';

                if (catalogItem.vidaUtilDias && data.fechaEntrega) {
                    const deliveryDate = new Date(data.fechaEntrega + 'T00:00:00');
                    const expDate = new Date(deliveryDate);
                    expDate.setDate(expDate.getDate() + catalogItem.vidaUtilDias);

                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
                    expirationText = expDate.toLocaleDateString('es-CO');

                    if (diffDays < 0) statusHtml = `<span class="bg-red-100 text-red-700 text-xs font-bold px-2 py-1 rounded whitespace-nowrap">Vencido (${Math.abs(diffDays)}d)</span>`;
                    else if (diffDays <= 30) statusHtml = `<span class="bg-yellow-100 text-yellow-800 text-xs font-bold px-2 py-1 rounded whitespace-nowrap">Vence en ${diffDays}d</span>`;
                    else statusHtml = `<span class="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded">Vigente</span>`;
                }

                activeItems.push({
                    name: data.itemName || catalogItem.itemName || 'Ítem',
                    category: catalogItem.category || 'General',
                    talla: data.talla || catalogItem.talla || 'N/A',
                    quantity: data.quantity,
                    deliveryDate: data.fechaEntrega,
                    expirationText: expirationText,
                    statusHtml: statusHtml,
                    photoURL: data.photoURL
                });
            }
        });

        // 4. Renderizar HTML
        const lastDateStr = lastDeliveryDate ? new Date(lastDeliveryDate + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';

        const itemsRows = activeItems.map(item => `
            <tr class="hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0">
                <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-500 text-xs">
                            <i class="fa-solid ${item.category === 'EPP' ? 'fa-helmet-safety' : 'fa-shirt'}"></i>
                        </div>
                        <div>
                            <p class="font-bold text-gray-800 text-sm">${item.name}</p>
                            <p class="text-[10px] text-gray-500 uppercase">${item.category}</p>
                        </div>
                    </div>
                </td>
                <td class="px-4 py-3 text-center text-sm">${item.talla}</td>
                <td class="px-4 py-3 text-center font-bold text-gray-700">${item.quantity}</td>
                <td class="px-4 py-3 text-center text-xs text-gray-600">
                    <div>${item.deliveryDate}</div>
                    ${item.expirationText !== '---' ? `<div class="text-[10px] text-gray-400 mt-0.5">Vence: ${item.expirationText}</div>` : ''}
                </td>
                <td class="px-4 py-3 text-center">${item.statusHtml}</td>
                <td class="px-4 py-3 text-center">
                     ${item.photoURL ?
                `<button onclick="window.openImageModal('${item.photoURL}')" class="text-blue-600 hover:bg-blue-50 p-1.5 rounded transition-colors" title="Ver Evidencia"><i class="fa-regular fa-image"></i></button>`
                : '<span class="text-gray-300">-</span>'}
                </td>
            </tr>
        `).join('');

        container.innerHTML = `
            <div class="space-y-6 mt-4">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div class="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-center gap-4">
                        <div class="w-10 h-10 rounded-full bg-white text-blue-600 flex items-center justify-center shadow-sm"><i class="fa-solid fa-boxes-packing"></i></div>
                        <div><p class="text-xs font-bold text-blue-400 uppercase">Total Histórico</p><p class="text-xl font-bold text-blue-900">${totalItemsDelivered}</p></div>
                    </div>
                    <div class="bg-green-50 p-4 rounded-xl border border-green-100 flex items-center gap-4">
                        <div class="w-10 h-10 rounded-full bg-white text-green-600 flex items-center justify-center shadow-sm"><i class="fa-solid fa-user-shield"></i></div>
                        <div><p class="text-xs font-bold text-green-400 uppercase">En Poder (Activo)</p><p class="text-xl font-bold text-green-900">${activeItemsCount}</p></div>
                    </div>
                    <div class="bg-purple-50 p-4 rounded-xl border border-purple-100 flex items-center gap-4">
                        <div class="w-10 h-10 rounded-full bg-white text-purple-600 flex items-center justify-center shadow-sm"><i class="fa-solid fa-calendar-check"></i></div>
                        <div><p class="text-xs font-bold text-purple-400 uppercase">Última Entrega</p><p class="text-sm font-bold text-purple-900">${lastDateStr}</p></div>
                    </div>
                </div>

                <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div class="px-6 py-3 border-b border-gray-100 bg-gray-50"><h4 class="font-bold text-gray-700 text-sm">Inventario Activo</h4></div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm text-left">
                            <thead class="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                                <tr>
                                    <th class="px-4 py-3">Ítem</th>
                                    <th class="px-4 py-3 text-center">Talla</th>
                                    <th class="px-4 py-3 text-center">Cant.</th>
                                    <th class="px-4 py-3 text-center">Entrega / Vencimiento</th>
                                    <th class="px-4 py-3 text-center">Estado</th>
                                    <th class="px-4 py-3 text-center">Foto</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-50">
                                ${itemsRows || '<tr><td colspan="6" class="text-center py-4 text-gray-400">No hay ítems activos.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

    } catch (error) {
        console.error("Error cargando dotación:", error);
        container.innerHTML = `<div class="p-4 text-center text-red-500 text-sm">Error: ${error.message}</div>`;
    }
}

function createDotacionCatalogCard(item) {
    const card = document.createElement('div');
    // Diseño moderno con hover effect
    card.className = 'bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col hover:shadow-md transition-shadow duration-300 group dotacion-catalog-card';

    // Datasets para eventos
    card.dataset.id = item.id;
    card.dataset.name = item.itemName;
    card.dataset.talla = item.talla || 'N/A';
    card.dataset.photourl = item.itemPhotoURL || '';
    card.dataset.stock = item.quantityInStock || 0;
    card.dataset.reference = item.reference || '';
    card.dataset.category = item.category || '';
    card.dataset.vidautil = item.vidaUtilDias || '';

    const stock = item.quantityInStock || 0;
    let stockBadge = '';

    if (stock === 0) {
        stockBadge = '<span class="bg-red-100 text-red-700 text-xs font-bold px-2.5 py-1 rounded-full border border-red-200">Agotado</span>';
    } else if (stock <= 5) {
        stockBadge = `<span class="bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full border border-amber-200">Bajo Stock: ${stock}</span>`;
    } else {
        stockBadge = `<span class="bg-emerald-100 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full border border-emerald-200">En Stock: ${stock}</span>`;
    }

    const vidaUtilText = item.vidaUtilDias ? `${item.vidaUtilDias} días` : 'Indefinida';
    const tallaText = item.talla && item.talla !== 'N/A' ? item.talla : 'Única';

    card.innerHTML = `
        <div class="p-4 flex gap-4 items-start">
            <div class="w-24 h-24 flex-shrink-0 bg-slate-50 rounded-lg border border-slate-100 overflow-hidden relative group-hover:border-blue-200 transition-colors cursor-pointer" data-action="view-dotacion-item-image">
                ${item.itemPhotoURL
            ? `<img src="${item.itemPhotoURL}" alt="${item.itemName}" class="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500">`
            : `<div class="w-full h-full flex items-center justify-center text-slate-300"><i class="fa-solid fa-image text-3xl"></i></div>`
        }
            </div>

            <div class="flex-grow min-w-0">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-0.5">${item.category}</p>
                        <h3 class="text-base font-bold text-slate-800 leading-tight truncate pr-2" title="${item.itemName}">${item.itemName}</h3>
                    </div>
                </div>
                
                <p class="text-xs text-slate-500 mt-1 font-mono truncate">${item.reference || 'Sin Ref'}</p>

                <div class="flex flex-wrap gap-2 mt-3">
                    <span class="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded border border-slate-200 font-medium">
                        <i class="fa-solid fa-ruler-horizontal mr-1 text-slate-400"></i> ${tallaText}
                    </span>
                    <span class="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded border border-slate-200 font-medium">
                        <i class="fa-regular fa-clock mr-1 text-slate-400"></i> ${vidaUtilText}
                    </span>
                </div>
            </div>
        </div>

        <div class="mt-auto px-4 pb-3 pt-0">
            <div class="flex justify-between items-center mb-3">
                ${stockBadge}
            </div>
            
            <div class="grid grid-cols-2 gap-2">
                <button data-action="register-dotacion-delivery" class="col-span-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 px-3 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2">
                    <i class="fa-solid fa-hand-holding-box"></i> Entregar
                </button>
                <button data-action="add-dotacion-stock" class="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-slate-900 text-xs font-bold py-2 px-3 rounded-lg transition-colors">
                    + Stock
                </button>
                <div class="flex gap-2">
                     <button data-action="edit-dotacion-catalog-item" class="flex-1 bg-white border border-slate-300 text-amber-600 hover:bg-amber-50 hover:border-amber-300 text-xs font-bold py-2 rounded-lg transition-colors" title="Editar">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button data-action="view-dotacion-catalog-history" class="flex-1 bg-white border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-800 text-xs font-bold py-2 rounded-lg transition-colors" title="Historial">
                        <i class="fa-solid fa-clock-rotate-left"></i>
                    </button>
                </div>
            </div>
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
        // HTML para KPIs (Tarjetas modernas con iconos)
        const kpiHtml = `
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 text-xl">
                        <i class="fa-solid fa-tags"></i>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-wider">Referencias</p>
                        <p class="text-2xl font-black text-slate-800">${kpi.totalTipos}</p>
                    </div>
                </div>

                <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 text-xl">
                        <i class="fa-solid fa-boxes-stacked"></i>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-wider">En Bodega</p>
                        <p class="text-2xl font-black text-slate-800">${kpi.totalStock}</p>
                    </div>
                </div>

                <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 text-xl">
                        <i class="fa-solid fa-user-shield"></i>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-wider">Asignado</p>
                        <p class="text-2xl font-black text-slate-800">${kpi.totalAsignado}</p>
                    </div>
                </div>

                <div class="bg-slate-800 p-5 rounded-xl shadow-md border border-slate-700 flex items-center gap-4 text-white">
                    <div class="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-white text-xl">
                        <i class="fa-solid fa-layer-group"></i>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Activos</p>
                        <p class="text-2xl font-black">${kpi.totalStock + kpi.totalAsignado}</p>
                    </div>
                </div>
            </div>
        `;

        // Reporte 1: Top Consumo (Mejorado visualmente)
        let consumoHtml = '<div class="flex flex-col items-center justify-center h-40 text-slate-400"><i class="fa-solid fa-chart-bar mb-2 text-2xl opacity-20"></i><span class="text-xs">Sin datos de consumo</span></div>';
        if (consumoMap.size > 0) {
            consumoHtml = '<ul class="divide-y divide-slate-100">';
            const sortedConsumo = [...consumoMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
            sortedConsumo.forEach(([userId, count], index) => {
                const user = usersMap.get(userId);
                const userName = user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido';
                const rankColor = index < 3 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500';

                consumoHtml += `
                <li class="py-3 flex justify-between items-center hover:bg-slate-50 transition-colors px-2 rounded-lg">
                    <button data-action="view-user-report-details" data-userid="${userId}" data-username="${userName}" data-type="consumo" class="flex items-center gap-3 text-left group w-full">
                        <span class="w-6 h-6 rounded-full ${rankColor} text-xs font-bold flex items-center justify-center">${index + 1}</span>
                        <span class="font-medium text-slate-700 group-hover:text-blue-600 transition-colors text-sm">${userName}</span>
                    </button>
                    <span class="font-bold text-sm bg-blue-50 text-blue-700 px-2 py-1 rounded-md">${count}</span>
                </li>`;
            });
            consumoHtml += '</ul>';
        }

        // Reporte 2: Top Descarte (Mejorado visualmente)
        let descarteHtml = '<div class="flex flex-col items-center justify-center h-40 text-slate-400"><i class="fa-solid fa-recycle mb-2 text-2xl opacity-20"></i><span class="text-xs">Sin datos de descarte</span></div>';
        if (descarteMap.size > 0) {
            descarteHtml = '<ul class="divide-y divide-slate-100">';
            const sortedDescarte = [...descarteMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
            sortedDescarte.forEach(([userId, count], index) => {
                const user = usersMap.get(userId);
                const userName = user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido';
                const rankColor = index < 3 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500';

                descarteHtml += `
                <li class="py-3 flex justify-between items-center hover:bg-slate-50 transition-colors px-2 rounded-lg">
                    <button data-action="view-user-report-details" data-userid="${userId}" data-username="${userName}" data-type="descarte" class="flex items-center gap-3 text-left group w-full">
                        <span class="w-6 h-6 rounded-full ${rankColor} text-xs font-bold flex items-center justify-center">${index + 1}</span>
                        <span class="font-medium text-slate-700 group-hover:text-red-600 transition-colors text-sm">${userName}</span>
                    </button>
                    <span class="font-bold text-sm bg-red-50 text-red-700 px-2 py-1 rounded-md">${count}</span>
                </li>`;
            });
            descarteHtml += '</ul>';
        }

        // Reporte 3: Vencimiento (Estilo alerta)
        let vencimientoReportHtml = '<div class="flex flex-col items-center justify-center h-40 text-slate-400"><i class="fa-solid fa-calendar-check mb-2 text-2xl opacity-20"></i><span class="text-xs">Todo al día</span></div>';
        if (vencimientoList.length > 0) {
            vencimientoList.sort((a, b) => a.diffDays - b.diffDays);
            vencimientoReportHtml = '<ul class="space-y-2">';
            vencimientoList.forEach(item => {
                const isExpired = item.diffDays <= 0;
                const bgClass = isExpired ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100';
                const iconClass = isExpired ? 'text-red-500 fa-triangle-exclamation' : 'text-amber-500 fa-clock';
                const textClass = isExpired ? 'text-red-800' : 'text-amber-800';
                const statusText = isExpired ? `Vencido hace ${Math.abs(item.diffDays)} días` : `Vence en ${item.diffDays} días`;

                vencimientoReportHtml += `
                    <li class="p-3 rounded-lg border ${bgClass} flex items-start gap-3">
                        <i class="fa-solid ${iconClass} mt-1"></i>
                        <div>
                            <p class="text-sm font-bold ${textClass}">${item.itemName} <span class="font-normal opacity-75">(${item.talla})</span></p>
                            <p class="text-xs ${textClass} mt-0.5">${statusText}</p>
                            <p class="text-[10px] uppercase tracking-wide text-slate-500 mt-1 bg-white/50 px-1 rounded inline-block"><i class="fa-solid fa-user mr-1"></i> ${item.userName}</p>
                        </div>
                    </li>`;
            });
            vencimientoReportHtml += '</ul>';
        }

        // Reporte 4: Tallas (Acordeón visual)
        let tallasHtml = '<div class="flex flex-col items-center justify-center h-40 text-slate-400"><i class="fa-solid fa-ruler-combined mb-2 text-2xl opacity-20"></i><span class="text-xs">Sin detalle de tallas</span></div>';
        if (tallaStockMap.size > 0) {
            tallasHtml = '<div class="space-y-3">';
            const sortedTallaGroups = [...tallaStockMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            for (const [baseName, group] of sortedTallaGroups) {
                tallasHtml += `
                <div class="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                    <div class="px-3 py-2 bg-white border-b border-slate-100 flex justify-between items-center">
                        <span class="text-xs font-bold text-slate-700 uppercase">${baseName}</span>
                        <span class="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">${group.total} total</span>
                    </div>
                    <div class="p-2 flex flex-wrap gap-2">`;

                group.tallas.sort((a, b) => a.talla.localeCompare(b.talla, undefined, { numeric: true, sensitivity: 'base' }));
                for (const item of group.tallas) {
                    // Barra de progreso visual para el stock de la talla
                    const stockLevel = Math.min(item.stock, 20) * 5; // Max 100%
                    const stockColor = item.stock < 3 ? 'bg-red-500' : 'bg-blue-500';

                    tallasHtml += `
                        <div class="flex-1 min-w-[80px] bg-white border border-slate-200 rounded p-1.5 text-center relative overflow-hidden group" title="Stock: ${item.stock}">
                            <div class="absolute bottom-0 left-0 h-1 ${stockColor} opacity-20 w-full"></div>
                            <div class="absolute bottom-0 left-0 h-1 ${stockColor} transition-all duration-500" style="width: ${stockLevel}%"></div>
                            <p class="text-[10px] text-slate-400 uppercase font-bold">Talla ${item.talla}</p>
                            <p class="text-sm font-bold text-slate-700">${item.stock}</p>
                        </div>`;
                }
                tallasHtml += `</div></div>`;
            }
            tallasHtml += '</div>';
        }

        // Renderizar Grid de Reportes
        const reportsHtml = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="space-y-6">
                    <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-full">
                        <div class="flex items-center justify-between mb-4 border-b border-slate-100 pb-2">
                            <h3 class="font-bold text-slate-700 flex items-center gap-2"><i class="fa-solid fa-box-open text-blue-500"></i> Más Solicitados</h3>
                        </div>
                        <div class="max-h-80 overflow-y-auto custom-scrollbar pr-1">${consumoHtml}</div>
                    </div>

                    <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-full">
                        <div class="flex items-center justify-between mb-4 border-b border-slate-100 pb-2">
                            <h3 class="font-bold text-slate-700 flex items-center gap-2"><i class="fa-solid fa-arrow-rotate-left text-red-500"></i> Mayor Rotación (Descarte)</h3>
                        </div>
                        <div class="max-h-80 overflow-y-auto custom-scrollbar pr-1">${descarteHtml}</div>
                    </div>
                </div>

                <div class="space-y-6">
                    <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <div class="flex items-center justify-between mb-4 border-b border-slate-100 pb-2">
                            <h3 class="font-bold text-slate-700 flex items-center gap-2"><i class="fa-solid fa-bell text-amber-500"></i> Alertas de Vencimiento</h3>
                            <span class="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-bold">Próximos 30 días</span>
                        </div>
                        <div class="max-h-60 overflow-y-auto custom-scrollbar pr-1">${vencimientoReportHtml}</div>
                    </div>

                    <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <div class="flex items-center justify-between mb-4 border-b border-slate-100 pb-2">
                            <h3 class="font-bold text-slate-700 flex items-center gap-2"><i class="fa-solid fa-ruler text-slate-500"></i> Stock por Tallas</h3>
                        </div>
                        <div class="max-h-80 overflow-y-auto custom-scrollbar pr-1">${tallasHtml}</div>
                    </div>
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

    // --- LÓGICA VISUAL DE ESTADO ---
    let statusColor = 'border-slate-200'; // Borde por defecto
    let statusBg = 'bg-white';
    let statusIcon = '<i class="fa-solid fa-circle-check text-slate-300"></i>';
    let statusText = 'Inactivo';
    let statusBadgeClass = 'bg-slate-100 text-slate-500';

    // Datos
    const vidaUtilDias = catalogItem.vidaUtilDias;
    const lastDeliveryDateStr = historySummary.lastDeliveryDate;
    let durationText = "---";

    if (historySummary.status === 'activo') {
        // Estado: ACTIVO (En poder del empleado)
        statusColor = 'border-l-4 border-l-blue-500 border-y border-r border-slate-200';
        statusIcon = '<i class="fa-solid fa-shirt text-blue-500"></i>';
        statusText = 'En Uso';
        statusBadgeClass = 'bg-blue-50 text-blue-700 border-blue-100';

        if (lastDeliveryDateStr) {
            const lastDate = new Date(lastDeliveryDateStr + 'T00:00:00');
            const today = new Date();
            const diffTime = Math.abs(today - lastDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            durationText = `${diffDays} días`;

            // Verificar Vencimiento
            if (vidaUtilDias) {
                const expirationDate = new Date(lastDate.getTime());
                expirationDate.setDate(expirationDate.getDate() + vidaUtilDias);
                const daysLeft = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));

                if (daysLeft <= 0) {
                    statusColor = 'border-l-4 border-l-red-500 border-y border-r border-red-100 bg-red-50/30';
                    statusText = 'Vencido';
                    statusBadgeClass = 'bg-red-100 text-red-700 border-red-200 font-bold';
                    durationText = `<span class="text-red-600 font-bold">Venció hace ${Math.abs(daysLeft)} días</span>`;
                } else if (daysLeft <= 30) {
                    statusColor = 'border-l-4 border-l-amber-500 border-y border-r border-amber-100 bg-amber-50/30';
                    statusText = 'Vence Pronto';
                    statusBadgeClass = 'bg-amber-100 text-amber-700 border-amber-200 font-bold';
                    durationText = `<span class="text-amber-600 font-bold">Quedan ${daysLeft} días</span>`;
                }
            }
        }
    } else if (historySummary.status === 'devuelto' || historySummary.status === 'devuelto_stock') {
        // Estado: DEVUELTO
        statusColor = 'border border-slate-200 bg-slate-50 opacity-75';
        statusIcon = '<i class="fa-solid fa-rotate-left text-slate-400"></i>';
        statusText = 'Devuelto';
        statusBadgeClass = 'bg-slate-200 text-slate-600';
    } else {
        // Estado: NUNCA ENTREGADO
        statusColor = 'border border-dashed border-slate-300';
        statusText = 'No Asignado';
    }

    card.className = `rounded-xl shadow-sm overflow-hidden flex flex-col relative ${statusColor} ${statusBg}`;

    // Botón de acción principal (Devolución)
    let actionButton = '';
    if (canAdmin && historySummary.status === 'activo' && historySummary.lastHistoryId) {
        actionButton = `
            <button data-action="return-dotacion-item" 
                    data-lasthistoryid="${historySummary.lastHistoryId}" 
                    data-itemname="${catalogItem.itemName}"
                    data-itemid="${catalogItem.id}"
                    class="w-full mt-3 bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 text-xs font-bold py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-2">
                <i class="fa-solid fa-arrow-right-from-bracket"></i> Registrar Devolución
            </button>`;
    }

    // Link a Foto de Entrega
    let photoLink = '';
    if (historySummary.deliveryPhotoURL) {
        photoLink = `
            <button data-action="view-dotacion-delivery-image" data-photourl="${historySummary.deliveryPhotoURL}" class="text-xs text-blue-500 hover:text-blue-700 hover:underline flex items-center gap-1 mt-1">
                <i class="fa-solid fa-paperclip"></i> Ver constancia entrega
            </button>`;
    }

    card.innerHTML = `
        <div class="p-4 flex gap-4">
            <div class="w-16 h-16 flex-shrink-0 bg-white rounded-lg border border-slate-100 p-1 shadow-sm">
                <img src="${catalogItem.itemPhotoURL || 'https://via.placeholder.com/100'}" class="w-full h-full object-contain rounded">
            </div>

            <div class="flex-grow min-w-0">
                <div class="flex justify-between items-start">
                    <h4 class="font-bold text-slate-800 text-sm truncate pr-2" title="${catalogItem.itemName}">${catalogItem.itemName}</h4>
                    <span class="text-[10px] px-2 py-0.5 rounded-full border ${statusBadgeClass} whitespace-nowrap">${statusText}</span>
                </div>
                
                <p class="text-xs text-slate-500 mt-0.5 mb-2">Ref: ${catalogItem.reference || '---'} | Talla: <strong>${catalogItem.talla || 'U'}</strong></p>
                
                <div class="flex items-center gap-4 text-xs text-slate-600 bg-white/50 p-1.5 rounded border border-slate-100/50">
                    <div title="Total entregado históricamente">
                        <i class="fa-solid fa-boxes-packing text-slate-400 mr-1"></i> <span class="font-bold">${historySummary.totalConsumido}</span>
                    </div>
                    <div title="Tiempo de uso actual">
                        <i class="fa-regular fa-clock text-slate-400 mr-1"></i> ${durationText}
                    </div>
                </div>
                
                ${photoLink}
            </div>
        </div>

        <div class="px-4 pb-4 pt-0 mt-auto">
             ${actionButton}
             <button data-action="view-item-detail-history" 
                    data-itemid="${catalogItem.id}" 
                    data-itemname="${catalogItem.itemName}" 
                    data-talla="${catalogItem.talla || 'N/A'}" 
                    data-userid="${userId}"
                    class="w-full mt-2 text-xs text-slate-500 hover:text-slate-800 font-medium flex items-center justify-center gap-1 transition-colors">
                <i class="fa-solid fa-history"></i> Ver historial completo
            </button>
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