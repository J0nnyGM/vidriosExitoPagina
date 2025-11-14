// App/js/empleados.js

// --- INICIO DE CORRECCIÓN: Importaciones en el nivel superior ---
import {
    doc,
    getDoc,
    collection,
    query,
    where,
    getDocs,
    orderBy,
    limit,
    onSnapshot,
    addDoc,
    serverTimestamp,
    deleteDoc,
    setDoc, // <-- AÑADIDO
    writeBatch // <-- LÍNEA CORREGIDA
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
// --- FIN DE CORRECCIÓN ---


// --- Variables del Módulo (Dependencias de app.js) ---
let _db;
let _getUsersMap;
let _getCurrentUserRole;
let _showView;
let _storage;
let _openConfirmModal;
let _getPayrollConfig;
let _getCurrentUserId;
let _setupCurrencyInput; // <-- AÑADIR ESTA LÍNEA

// --- Variables locales del Módulo (Estado) ---
let activeEmpleadoChart = null;
let unsubscribeEmpleadosTab = null;

// Formateador de moneda
const currencyFormatter = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
});

/**
 * Inicializa el módulo de Empleados.
 */
export function initEmpleados(
    db,
    getUsersMap,
    getCurrentUserRole,
    showView,
    storage,
    openConfirmModal,
    loadDotacionFunc,
    getPayrollConfig,
    getCurrentUserId,
    setupCurrencyInput // <-- AÑADIR ESTE PARÁMETRO
) {
    _db = db;
    _getUsersMap = getUsersMap;
    _getCurrentUserRole = getCurrentUserRole;
    _showView = showView;
    _storage = storage;
    _openConfirmModal = openConfirmModal;
    _getPayrollConfig = getPayrollConfig;
    _getCurrentUserId = getCurrentUserId;
    _setupCurrencyInput = setupCurrencyInput; // <-- AÑADIR ESTA ASIGNACIÓN

    window.loadDotacionAsignaciones = loadDotacionFunc;

    // Listener para los clics en las pestañas
    const tabsNav = document.getElementById('empleados-tabs-nav');
    if (tabsNav) {
        tabsNav.addEventListener('click', (e) => {
            const button = e.target.closest('.empleados-tab-button');
            if (button && !button.classList.contains('active')) {
                switchEmpleadosTab(button.dataset.tab);
            }
        });
    }
}

/**
 * Carga la vista de Empleados (El "Cerebro" o "Enrutador" del módulo).
 * (VERSIÓN ACTUALIZADA: Con selector de mes global)
 */
export function loadEmpleadosView() {
    const role = _getCurrentUserRole();
    const tabsNav = document.getElementById('empleados-tabs-nav');
    const viewContainer = document.getElementById('empleados-view');
    if (!tabsNav || !viewContainer) return;

    // 1. Limpiar listeners de la pestaña anterior
    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    // --- INICIO DE MODIFICACIÓN: Renderizar el selector de mes (si no existe) ---
    if (!viewContainer.querySelector('#empleado-month-selector')) {
        const header = viewContainer.querySelector('.flex.justify-between.items-center');
        header.insertAdjacentHTML('beforeend', `
            <div>
                <label for="empleado-month-selector" class="block text-sm font-medium text-gray-700">Seleccionar Mes:</label>
                <input type="month" id="empleado-month-selector"
                       class="mt-1 block w-full md:w-auto px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500">
            </div>
        `);

        // Asignar valor inicial
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        document.getElementById('empleado-month-selector').value = `${year}-${month}`;

        // Añadir el listener para recargar la PESTAÑA ACTIVA
        document.getElementById('empleado-month-selector').addEventListener('change', () => {
            const activeTabKey = tabsNav.querySelector('.active')?.dataset.tab || 'productividad';
            switchEmpleadosTab(activeTabKey); // Recarga la pestaña activa
        });
    }
    // --- FIN DE MODIFICACIÓN ---

    // 2. Definir las pestañas disponibles (sin cambios)
    const allTabs = {
        productividad: { label: 'Productividad', roles: ['admin'] },
        sst: { label: 'SST (Vencimientos)', roles: ['admin', 'sst'] },
        nomina: { label: 'Nómina (Bonificación)', roles: ['admin', 'nomina'] }
    };

    const availableTabs = Object.keys(allTabs).filter(key =>
        allTabs[key].roles.includes(role)
    );

    // 3. Renderizar las pestañas (sin cambios)
    tabsNav.innerHTML = '';
    availableTabs.forEach(tabKey => {
        tabsNav.innerHTML += `
            <button data-tab="${tabKey}"
                class="empleados-tab-button whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
                ${allTabs[tabKey].label}
            </button>
        `;
    });

    // 4. Activar la primera pestaña disponible (sin cambios)
    if (availableTabs.length > 0) {
        // Evitamos que 'switchEmpleadosTab' se llame dos veces si la pestaña ya está activa
        const currentActiveTab = tabsNav.querySelector('.active')?.dataset.tab;
        const defaultTab = availableTabs[0];
        if (currentActiveTab !== defaultTab) {
            switchEmpleadosTab(defaultTab);
        }
    } else {
        document.getElementById('empleados-content-container').innerHTML =
            '<p class="text-gray-500">Esta sección no está disponible para tu rol.</p>';
    }
}

/**
 * Cambia la pestaña activa y carga su contenido.
 * (Esta función está correcta, no necesita cambios)
 */
function switchEmpleadosTab(tabName) {
    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    document.querySelectorAll('.empleados-tab-content').forEach(content => {
        content.classList.add('hidden');
    });

    document.querySelectorAll('.empleados-tab-button').forEach(button => {
        const isActive = button.dataset.tab === tabName;
        button.classList.toggle('active', isActive);
        button.classList.toggle('border-blue-500', isActive);
        button.classList.toggle('text-blue-600', isActive);
        button.classList.toggle('border-transparent', !isActive);
        button.classList.toggle('text-gray-500', !isActive);
    });

    const activeContent = document.getElementById(`empleados-tab-${tabName}`);
    if (activeContent) {
        activeContent.classList.remove('hidden');

        switch (tabName) {
            case 'productividad':
                loadProductividadTab(activeContent);
                break;
            case 'sst':
                loadSSTTab(activeContent);
                break;
            case 'nomina':
                loadNominaTab(activeContent);
                break;
        }
    }
}

async function loadProductividadTab(container) {

    // 1. Renderizar el "Shell" (SOLO la tabla)
    container.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-md">
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-50">
                        <tr>
                            <th class="px-6 py-3">Operario</th>
                            <th class="px-6 py-3 text-center">Nivel Comisión</th>
                            <th class="px-6 py-3 text-right">M² Asignados</th>
                            <th class="px-6 py-3 text-right">M² Completados</th>
                            <th class="px-6 py-3 text-right text-green-600">M² a Tiempo</th>
                            <th class="px-6 py-3 text-right text-red-600">M² Fuera de Tiempo</th>
                            <th class="px-6 py-3 text-right text-blue-600">Bonificación (Mes)</th>
                        </tr>
                    </thead>
                    <tbody id="empleados-prod-table-body">
                        </tbody>
                </table>
            </div>
        </div>
    `;

    // 2. Obtener el selector de mes (que ya existe)
    const monthSelector = document.getElementById('empleado-month-selector');
    const tableBody = document.getElementById('empleados-prod-table-body');

    // Función interna para cargar la tabla
    const loadTableData = async () => {
        // Lee el selector, consulta Firestore, y renderiza las filas.
        const selectedMonthYear = monthSelector.value;
        const currentStatDocId = selectedMonthYear.replace('-', '_');

        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10"><div class="loader mx-auto"></div><p class="mt-2 text-gray-500">Cargando reporte para ${selectedMonthYear}...</p></td></tr>`;

        try {
            const usersMap = _getUsersMap();
            const activeUsers = []; // <-- Variable renombrada
            usersMap.forEach((user, id) => {
                // --- INICIO DE LA MODIFICACIÓN ---
                // Ahora incluye a todos los usuarios activos
                if (user.status === 'active') {
                    // --- FIN DE LA MODIFICACIÓN ---
                    activeUsers.push({ id, ...user }); // <-- Variable renombrada
                }
            });

            if (activeUsers.length === 0) { // <-- Variable renombrada
                tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-gray-500">No se encontraron operarios activos.</td></tr>`;
                return;
            }

            const statPromises = activeUsers.map(op => getDoc(doc(_db, "employeeStats", op.id, "monthlyStats", currentStatDocId))); // <-- Variable renombrada
            const statSnapshots = await Promise.all(statPromises);

            const empleadoData = activeUsers.map((operario, index) => { // <-- Variable renombrada
                const statDoc = statSnapshots[index];
                const stats = statDoc.exists() ? statDoc.data() : {
                    metrosAsignados: 0, metrosCompletados: 0, metrosEnTiempo: 0, metrosFueraDeTiempo: 0, totalBonificacion: 0
                };
                return { ...operario, stats: stats };
            });

            empleadoData.sort((a, b) => b.stats.metrosCompletados - a.stats.metrosCompletados);

            tableBody.innerHTML = '';
            if (empleadoData.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-gray-500">No hay datos de productividad para ${selectedMonthYear}.</td></tr>`;
            }

            empleadoData.forEach(data => {
                const row = document.createElement('tr');
                row.className = 'bg-white border-b hover:bg-gray-50 cursor-pointer';
                row.dataset.action = "view-empleado-details";
                row.dataset.id = data.id;

                const level = data.commissionLevel || 'principiante';
                const levelText = level.charAt(0).toUpperCase() + level.slice(1);

                row.innerHTML = `
                    <td class="px-6 py-4 font-medium text-gray-900">${data.firstName} ${data.lastName}</td>
                    <td class="px-6 py-4 text-center text-gray-600">${levelText}</td>
                    <td class="px-6 py-4 text-right font-medium">${(data.stats.metrosAsignados || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 text-right font-bold text-blue-700">${(data.stats.metrosCompletados || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 text-right font-medium text-green-600">${(data.stats.metrosEnTiempo || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 text-right font-medium text-red-600">${(data.stats.metrosFueraDeTiempo || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 text-right font-bold text-blue-700">${currencyFormatter.format(data.stats.totalBonificacion || 0)}</td>
                `;
                tableBody.appendChild(row);
            });

        } catch (error) {
            console.error("Error al cargar el reporte de productividad:", error);
            tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-red-500">Error al cargar el reporte: ${error.message}</td></tr>`;
        }
    };

    // 3. (Eliminamos el 'addEventListener' de aquí, porque ya está en loadEmpleadosView)

    // 4. Cargar los datos de la tabla por primera vez
    loadTableData();
}


/**
 * Carga el contenido de la pestaña "SST".
 * (Esta función está correcta, no necesita cambios)
 */
function loadSSTTab(container) {
    container.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-md">
            <h2 class="text-xl font-bold text-gray-800 mb-4">Alertas de Vencimiento de EPP</h2>
            <div id="sst-alerts-container">
                <p class="text-gray-500">Cargando alertas de vencimiento...</p>
            </div>
        </div>
    `;

    if (unsubscribeEmpleadosTab) unsubscribeEmpleadosTab();

    const usersMap = _getUsersMap();

    const q = query(
        collection(_db, "dotacionHistory"),
        where("action", "==", "asignada"),
        where("status", "==", "activo")
    );

    unsubscribeEmpleadosTab = onSnapshot(q, async (snapshot) => {
        const alertsContainer = document.getElementById('sst-alerts-container');
        if (!alertsContainer) return;

        if (snapshot.empty) {
            alertsContainer.innerHTML = '<p class="text-green-600 font-semibold">No hay dotación activa asignada para monitorear.</p>';
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const alerts = [];

        const catalogRefs = new Set(snapshot.docs.map(d => d.data().itemId));
        const catalogPromises = Array.from(catalogRefs).map(id => getDoc(doc(_db, "dotacionCatalog", id)));
        const catalogSnapshots = await Promise.all(catalogPromises);
        const catalogMap = new Map(catalogSnapshots.map(snap => [snap.id, snap.data()]));

        snapshot.forEach(doc => {
            const entry = doc.data();
            const catalogItem = catalogMap.get(entry.itemId);

            if (catalogItem && catalogItem.vidaUtilDias && entry.fechaEntrega) {
                const deliveryDate = new Date(entry.fechaEntrega + 'T00:00:00');
                const expirationDate = new Date(deliveryDate.getTime());
                expirationDate.setDate(expirationDate.getDate() + catalogItem.vidaUtilDias);

                const diffTime = expirationDate.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays <= 30) {
                    const user = usersMap.get(entry.userId);
                    alerts.push({
                        userName: user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido',
                        itemName: entry.itemName,
                        talla: entry.talla || 'N/A',
                        diffDays: diffDays
                    });
                }
            }
        });

        if (alerts.length === 0) {
            alertsContainer.innerHTML = '<p class="text-green-600 font-semibold">¡Excelente! Ningún EPP activo vence en los próximos 30 días.</p>';
            return;
        }

        alerts.sort((a, b) => a.diffDays - b.diffDays);

        alertsContainer.innerHTML = alerts.map(item => {
            const isVencido = item.diffDays <= 0;
            const colorClass = isVencido ? 'border-red-500 bg-red-50' : 'border-yellow-500 bg-yellow-50';
            const textClass = isVencido ? 'text-red-700' : 'text-yellow-700';
            const text = isVencido ? `VENCIDO (hace ${Math.abs(item.diffDays)} días)` : `Vence en ${item.diffDays} días`;

            return `
                <div class="p-3 border-l-4 ${colorClass} rounded-r-lg mb-2">
                    <p class="font-bold ${textClass}">${text}</p>
                    <p class="text-sm text-gray-800">${item.itemName} (${item.talla}) - ${item.userName}</p>
                </div>
            `;
        }).join('');

    }, (error) => {
        console.error("Error al cargar alertas SST:", error);
        const alertsContainer = document.getElementById('sst-alerts-container');
        if (alertsContainer) alertsContainer.innerHTML = '<p class="text-red-500">Error al cargar alertas.</p>';
    });
}

/**
 * (FUNCIÓN ACTUALIZADA)
 * Carga el contenido de la pestaña "Nómina".
 * @param {HTMLElement} container - El <div> de la pestaña.
 */
async function loadNominaTab(container) {
    // 1. Renderizar el "Shell" (SOLO la tabla)
    container.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-md">
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-50">
                        <tr>
                            <th class="px-6 py-3">Operario</th>
                            <th class="px-6 py-3 text-center">Nivel Comisión</th>
                            <th class="px-6 py-3 text-right">Salario Básico</th>
                            <th class="px-6 py-3 text-right text-lime-600">Bonificación M² (Mes)</th>
                            <th class="px-6 py-3 text-right text-blue-700">Total a Pagar (Mes)</th>
                        </tr>
                    </thead>
                    <tbody id="empleados-nomina-table-body">
                        </tbody>
                </table>
            </div>
        </div>
    `;

    // 2. Obtener el selector de mes (global) y el cuerpo de la tabla
    const monthSelector = document.getElementById('empleado-month-selector');
    const tableBody = document.getElementById('empleados-nomina-table-body');
    const selectedMonthYear = monthSelector.value;
    const currentStatDocId = selectedMonthYear.replace('-', '_');

    tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-10"><div class="loader mx-auto"></div><p class="mt-2 text-gray-500">Cargando reporte de nómina para ${selectedMonthYear}...</p></td></tr>`;

    try {
        // 3. Obtener usuarios activos (del usersMap)
        const usersMap = _getUsersMap();
        const activeUsers = []; // <-- Variable renombrada
        usersMap.forEach((user, id) => {
            // --- INICIO DE LA MODIFICACIÓN ---
            if (user.status === 'active') {
                // --- FIN DE LA MODIFICACIÓN ---
                activeUsers.push({ id, ...user }); // <-- Variable renombrada
            }
        });

        if (activeUsers.length === 0) { // <-- Variable renombrada
            tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-gray-500">No se encontraron operarios activos.</td></tr>`;
            return;
        }

        // 4. Obtener sus estadísticas de ese mes
        const statPromises = activeUsers.map(op => getDoc(doc(_db, "employeeStats", op.id, "monthlyStats", currentStatDocId))); // <-- Variable renombrada
        const statSnapshots = await Promise.all(statPromises);

        // 5. Combinar datos
        const empleadoData = activeUsers.map((operario, index) => { // <-- Variable renombrada
            const statDoc = statSnapshots[index];
            const stats = statDoc.exists() ? statDoc.data() : { totalBonificacion: 0 };
            return {
                ...operario,
                salarioBasico: operario.salarioBasico || 0,
                bonificacion: stats.totalBonificacion || 0,
                totalPagar: (operario.salarioBasico || 0) + (stats.totalBonificacion || 0)
            };
        });

        // 6. Ordenar por el total a pagar
        empleadoData.sort((a, b) => b.totalPagar - a.totalPagar);

        // 7. Renderizar tabla
        tableBody.innerHTML = '';
        empleadoData.forEach(data => {
            const row = document.createElement('tr');
            row.className = 'bg-white border-b hover:bg-gray-50 cursor-pointer';
            row.dataset.action = "view-payment-history"; // <-- MODIFICADO
            row.dataset.id = data.id;

            const level = data.commissionLevel || 'principiante';
            const levelText = level.charAt(0).toUpperCase() + level.slice(1);

            row.innerHTML = `
                <td class="px-6 py-4 font-medium text-gray-900">${data.firstName} ${data.lastName}</td>
                <td class="px-6 py-4 text-center text-gray-600">${levelText}</td>
                <td class="px-6 py-4 text-right font-medium">${currencyFormatter.format(data.salarioBasico)}</td>
                <td class="px-6 py-4 text-right font-bold text-lime-700">${currencyFormatter.format(data.bonificacion)}</td>
                <td class="px-6 py-4 text-right font-bold text-blue-700">${currencyFormatter.format(data.totalPagar)}</td>
            `;
            tableBody.appendChild(row);
        });

    } catch (error) {
        console.error("Error al cargar el reporte de nómina:", error);
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-red-500">Error al cargar el reporte: ${error.message}</td></tr>`;
    }
}

/**
 * Carga y muestra el perfil de productividad detallado de un empleado.
 * (Esta función está correcta, no necesita cambios)
 */
export async function showEmpleadoDetails(userId) {
    _showView('empleado-details');
    destroyActiveChart();

    const usersMap = _getUsersMap();
    const user = usersMap.get(userId);

    if (!user) {
        document.getElementById('empleado-details-name').textContent = 'Error: Usuario no encontrado';
        return;
    }

    // 1. Llenar cabecera
    const level = user.commissionLevel || 'principiante';
    const levelText = level.charAt(0).toUpperCase() + level.slice(1);
    const nameEl = document.getElementById('empleado-details-name');
    nameEl.textContent = `${user.firstName} ${user.lastName}`;
    nameEl.dataset.userId = userId;

    document.getElementById('empleado-details-level').textContent = `Nivel: ${levelText}`;
    document.getElementById('empleado-details-idNumber').textContent = user.idNumber || 'N/A';
    document.getElementById('empleado-details-email').textContent = user.email || 'N/A';
    document.getElementById('empleado-details-phone').textContent = user.phone || 'N/A';
    document.getElementById('empleado-details-address').textContent = user.address || 'N/A';

    // 2. Configurar listener de clics para las pestañas internas
    const tabsNav = document.getElementById('empleado-details-tabs-nav');
    const newTabsNav = tabsNav.cloneNode(true);
    tabsNav.parentNode.replaceChild(newTabsNav, tabsNav);

    newTabsNav.addEventListener('click', (e) => {
        const button = e.target.closest('.empleado-details-tab-button');
        if (button && !button.classList.contains('active')) {
            switchEmpleadoDetailsTab(button.dataset.tab, userId);
        }
    });

    // 3. Cargar la pestaña "Resumen" por defecto
    switchEmpleadoDetailsTab('resumen', userId);
}

/**
 * Cambia la pestaña activa del PERFIL DE EMPLEADO.
 * (Esta función está correcta, no necesita cambios)
 */
function switchEmpleadoDetailsTab(tabName, userId) {
    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    document.querySelectorAll('.empleado-details-tab-content').forEach(content => {
        content.classList.add('hidden');
    });

    document.querySelectorAll('.empleado-details-tab-button').forEach(button => {
        const isActive = button.dataset.tab === tabName;
        button.classList.toggle('active', isActive);
        button.classList.toggle('border-blue-500', isActive);
        button.classList.toggle('text-blue-600', isActive);
        button.classList.toggle('border-transparent', !isActive);
        button.classList.toggle('text-gray-500', !isActive);
    });

    const activeContent = document.getElementById(`empleado-tab-${tabName}`);
    if (activeContent) {
        activeContent.classList.remove('hidden');

        switch (tabName) {
            case 'resumen':
                loadEmpleadoResumenTab(userId);
                break;
            case 'documentos':
                loadEmpleadoDocumentosTab(userId);
                break;
            case 'dotacion':
                const dotacionContainer = document.getElementById('empleado-dotacion-container');
                if (window.loadDotacionAsignaciones) {
                    window.loadDotacionAsignaciones(userId, 'empleado-dotacion-container');
                } else {
                    dotacionContainer.innerHTML = "<p class='text-red-500'>Error: Módulo de dotación no cargado.</p>";
                }
                break;
        }
    }
}

/**
 * Carga el contenido de la pestaña "Resumen" (Gráfico de Productividad).
 * (Esta función está correcta, no necesita cambios)
 */
async function loadEmpleadoResumenTab(userId) {
    try {
        const labels = [];
        const dataBonificacion = [];
        const dataEnTiempo = [];
        const dataFueraTiempo = [];

        const today = new Date();
        const monthlyStatRefs = [];
        const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

        for (let i = 5; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const statDocId = `${year}_${month}`;

            labels.push(`${monthNames[d.getMonth()]} ${year}`);
            monthlyStatRefs.push(getDoc(doc(_db, "employeeStats", userId, "monthlyStats", statDocId)));
        }

        const statSnapshots = await Promise.all(monthlyStatRefs);

        statSnapshots.forEach(snap => {
            if (snap.exists()) {
                const stats = snap.data();
                dataBonificacion.push(stats.totalBonificacion || 0);
                dataEnTiempo.push(stats.metrosEnTiempo || 0);
                dataFueraTiempo.push(stats.metrosFueraDeTiempo || 0);
            } else {
                dataBonificacion.push(0);
                dataEnTiempo.push(0);
                dataFueraTiempo.push(0);
            }
        });

        const ctx = document.getElementById('empleado-productivity-chart').getContext('2d');
        createProductivityChart(ctx, labels, dataBonificacion, dataEnTiempo, dataFueraTiempo);

    } catch (error) {
        console.error("Error al cargar gráfico de productividad:", error);
        document.getElementById('empleado-productivity-chart').innerHTML = '<p class="text-red-500">Error al cargar gráfico.</p>';
    }
}

/**
 * Carga el contenido de la pestaña "Documentos".
 * (Esta función está correcta, no necesita cambios)
 */
function loadEmpleadoDocumentosTab(userId) {
    const container = document.getElementById('empleado-document-cards-container');
    if (!container) return;

    container.innerHTML = '<p class="text-gray-500 col-span-full">Cargando documentos...</p>';

    const docTypes = [
        { id: 'cedula', title: 'Cédula' },
        { id: 'hoja_vida', title: 'Hoja de Vida' },
        { id: 'contrato', title: 'Contrato' },
        { id: 'examen_medico', title: 'Examen Médico' },
        { id: 'certificado_arl', title: 'Certificado ARL' },
        { id: 'certificado_eps', title: 'Certificado EPS' },
        { id: 'certificado_afp', title: 'Certificado AFP' },
        { id: 'curso_alturas', title: 'Curso de Alturas' },
    ];

    const q = query(collection(_db, "users", userId, "documents"));

    if (unsubscribeEmpleadosTab) unsubscribeEmpleadosTab();

    unsubscribeEmpleadosTab = onSnapshot(q, (snapshot) => {
        const currentDocs = new Map();
        // --- INICIO DE CORRECCIÓN ---
        // Iteramos sobre los documentos y usamos el 'type' como clave
        // También guardamos el 'id' real del documento
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.type) {
                currentDocs.set(data.type, { id: doc.id, ...data });
            }
        });
        // --- FIN DE CORRECCIÓN ---
        container.innerHTML = '';

        docTypes.forEach(type => {
            const docData = currentDocs.get(type.id);
            const isUploaded = !!docData;

            const card = document.createElement('div');
            card.className = `p-4 flex flex-col items-center justify-center rounded-lg shadow border ${isUploaded ? 'bg-green-50 border-green-200' : 'bg-white'}`;

            let statusHtml = '';
            if (isUploaded) {
                statusHtml = `
                    <p class="text-xs text-green-700 font-bold mb-2">Cargado</p>
                    <div class="flex space-x-2">
                        <a href="${docData.url}" target="_blank" class="view-doc-btn bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-2 px-3 rounded-lg">Ver</a>
                        <button data-action="delete-empleado-doc" data-doc-id="${docData.id}" data-doc-url="${docData.url}" class="delete-doc-btn bg-red-500 hover:bg-red-600 text-white text-xs font-bold py-2 px-3 rounded-lg">X</button>
                    </div>
                `;
            } else {
                statusHtml = `
                    <label class="cursor-pointer bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-bold py-2 px-3 rounded-lg">
                        Subir
                        <input type="file" class="hidden upload-empleado-doc-input" data-doc-type="${type.id}">
                    </label>
                `;
            }

            card.innerHTML = `
                <i class="fa-solid fa-file-pdf text-3xl ${isUploaded ? 'text-green-600' : 'text-gray-400'} mb-3"></i>
                <p class="font-semibold text-sm text-center text-gray-800 mb-3">${type.title}</p>
                ${statusHtml}
            `;
            container.appendChild(card);
        });
    });

    // --- INICIO DE CORRECCIÓN ---
    // Usamos 'newContainer' para asegurar que los listeners se apliquen
    const newContainer = container.cloneNode(true);
    container.parentNode.replaceChild(newContainer, container);

    newContainer.addEventListener('change', handleDocumentUpload);
    newContainer.addEventListener('click', handleDocumentDelete);
    // --- FIN DE CORRECCIÓN ---
}

/** * (FUNCIÓN CORREGIDA) 
 * Maneja la subida de un documento de empleado.
 */
async function handleDocumentUpload(e) {
    if (!e.target.classList.contains('upload-empleado-doc-input')) return;

    const file = e.target.files[0];
    const docType = e.target.dataset.docType;
    const userId = document.getElementById('empleado-details-name').dataset.userId;

    if (!file || !docType || !userId) return;

    const label = e.target.closest('label');
    label.textContent = 'Subiendo...';
    label.style.pointerEvents = 'none';

    try {
        const storageRef = ref(_storage, `employee_documents/${userId}/${docType}/${file.name}`);
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        // Usamos setDoc con el docType como ID para evitar duplicados
        // Esto sobrescribirá el documento anterior si suben uno nuevo
        const docRef = doc(_db, "users", userId, "documents", docType);

        await setDoc(docRef, {
            type: docType,
            name: file.name,
            url: downloadURL,
            uploadedAt: serverTimestamp()
        });

    } catch (error) {
        console.error("Error al subir documento de empleado:", error);
        alert("Error al subir documento.");
    } finally {
        label.textContent = 'Subir';
        label.style.pointerEvents = 'auto';
    }
}

/** * (FUNCIÓN CORREGIDA) 
 * Maneja el borrado de un documento de empleado.
 */
async function handleDocumentDelete(e) {
    const button = e.target.closest('[data-action="delete-empleado-doc"]');
    if (!button) return;

    const docId = button.dataset.docId; // Este es el ID del documento (ej. "cedula")
    const docUrl = button.dataset.docUrl; // URL del archivo en Storage
    const userId = document.getElementById('empleado-details-name').dataset.userId;

    if (!docId || !userId) return;

    _openConfirmModal("¿Seguro que quieres eliminar este documento?", async () => {
        try {
            // 1. Borrar el registro de Firestore
            await deleteDoc(doc(_db, "users", userId, "documents", docId));

            // 2. Borrar el archivo de Storage (si tenemos la URL)
            if (docUrl) {
                try {
                    const fileRef = ref(_storage, docUrl);
                    await deleteObject(fileRef);
                } catch (storageError) {
                    console.error("Error al borrar archivo de Storage (puede que ya no exista):", storageError);
                    // No detenemos el proceso si falla el borrado de Storage,
                    // lo principal es borrar el registro de Firestore.
                }
            }
        } catch (error) {
            console.error("Error al borrar documento:", error);
            alert("Error al borrar documento.");
        }
    });
}


/**
 * (FUNCIÓN EXISTENTE - SIN CAMBIOS)
 * Destruye la instancia del gráfico de empleado activa.
 */
function destroyActiveChart() {
    if (activeEmpleadoChart) {
        activeEmpleadoChart.destroy();
        activeEmpleadoChart = null;
    }
}

/**
 * (FUNCIÓN EXISTENTE - SIN CAMBIOS)
 * Crea un gráfico de barras para la productividad.
 */
function createProductivityChart(ctx, labels, dataBonificacion, dataEnTiempo, dataFueraTiempo) {
    if (!window.Chart) {
        console.error("Chart.js no está cargado.");
        return;
    }

    destroyActiveChart();

    activeEmpleadoChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Bonificación ($)',
                    data: dataBonificacion,
                    backgroundColor: '#84CC16', // lime-500
                    yAxisID: 'yBonificacion',
                    order: 3
                },
                {
                    label: 'M² a Tiempo',
                    data: dataEnTiempo,
                    backgroundColor: '#10B981', // green-500
                    yAxisID: 'yMetros',
                    order: 1,
                    stack: 'Stack 0',
                },
                {
                    label: 'M² Fuera de Tiempo',
                    data: dataFueraTiempo,
                    backgroundColor: '#EF4444', // red-500
                    yAxisID: 'yMetros',
                    order: 2,
                    stack: 'Stack 0',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                },
                yMetros: {
                    type: 'linear',
                    position: 'left',
                    stacked: true,
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Metros Cuadrados (M²)'
                    }
                },
                yBonificacion: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Bonificación (COP)'
                    },
                    grid: {
                        drawOnChartArea: false,
                    },
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                }
            }
        }
    });
}

/**
 * (FUNCIÓN ACTUALIZADA - FASE 2)
 * Carga el historial de pagos y controla el checkbox de liquidación.
 * @param {string} userId - El ID del operario a mostrar.
 */
export function loadPaymentHistoryView(userId) {
    _showView('payment-history-view');

    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    const usersMap = _getUsersMap();
    const user = usersMap.get(userId);
    const tableBody = document.getElementById('payment-history-table-body');
    const nameEl = document.getElementById('payment-history-name');

    const form = document.getElementById('payment-register-form');
    const salarioEl = document.getElementById('payment-salario-basico');
    const bonificacionEl = document.getElementById('payment-bonificacion-mes');
    const liquidarCheckbox = document.getElementById('payment-liquidar-bonificacion'); // <-- AÑADIDO

    if (!user) {
        // ... (código de error - sin cambios)
        nameEl.textContent = 'Error: Usuario no encontrado';
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-red-500">Usuario no encontrado.</td></tr>`;
        return;
    }

    // 2. Llenar la cabecera
    nameEl.textContent = `${user.firstName} ${user.lastName}`;
    tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-500">Cargando historial...</td></tr>`;

    // 3. Llenar el formulario (Salario, Bonificación y ESTADO DEL CHECKBOX)
    (async () => {
        const config = _getPayrollConfig();
        const salario = user.salarioBasico || 0;
        let auxTransporte = 0;

        if (config && config.salarioMinimo && salario > 0) {
            const limiteSMLV = (config.salarioMinimo) * (config.limiteAuxilioTransporte || 2);
            if (salario <= limiteSMLV) {
                auxTransporte = config.auxilioTransporte || 0;
            }
        }

        salarioEl.textContent = currencyFormatter.format(salario) + " (Mensual)";
        salarioEl.dataset.value = salario;
        salarioEl.dataset.auxTransporte = auxTransporte;

        const deduccionSobreMinimo = user.deduccionSobreMinimo || false;
        form.dataset.deduccionSobreMinimo = deduccionSobreMinimo;

        // Obtener Bonificación (del mes actual)
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const currentStatDocId = `${year}_${month}`;
        const statRef = doc(_db, "employeeStats", userId, "monthlyStats", currentStatDocId);
        const statSnap = await getDoc(statRef);

        let bonificacion = 0;
        let bonificacionYaPagada = false; // <-- AÑADIDO

        if (statSnap.exists()) {
            const stats = statSnap.data();
            bonificacion = stats.totalBonificacion || 0;
            bonificacionYaPagada = stats.bonificacionPagada || false; // <-- AÑADIDO
        }

        // --- INICIO DE MODIFICACIÓN (Control del Checkbox) ---
        bonificacionEl.dataset.value = bonificacion; // Guardamos el valor numérico

        if (bonificacionYaPagada) {
            bonificacionEl.textContent = currencyFormatter.format(bonificacion) + " (Ya liquidada este mes)";
            bonificacionEl.classList.add('text-gray-400');
            bonificacionEl.classList.remove('text-lime-600');
            liquidarCheckbox.checked = true;
            liquidarCheckbox.disabled = true; // No se puede desmarcar
        } else {
            bonificacionEl.textContent = currencyFormatter.format(bonificacion) + " (Pendiente por liquidar)";
            bonificacionEl.classList.remove('text-gray-400');
            bonificacionEl.classList.add('text-lime-600');
            liquidarCheckbox.checked = false; // Por defecto desmarcado
            liquidarCheckbox.disabled = false; // Habilitado
        }
        // --- FIN DE MODIFICACIÓN ---

        const diasPagarInput = document.getElementById('payment-dias-pagar');
        if (diasPagarInput && !diasPagarInput.value) {
            diasPagarInput.value = 15;
        }

        updatePaymentTotal();
    })();

    // 4. Escuchar en tiempo real la subcolección de pagos (la tabla)
    // ... (Esta lógica de 'onSnapshot' no cambia)
    const q = query(collection(_db, "users", userId, "paymentHistory"), orderBy("createdAt", "desc"));
    unsubscribeEmpleadosTab = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-500">No hay pagos registrados.</td></tr>`;
            return;
        }
        tableBody.innerHTML = '';
        snapshot.forEach(doc => {
            const payment = doc.data();
            const row = document.createElement('tr');
            row.className = 'bg-white border-b';
            const paymentDate = payment.createdAt ? payment.createdAt.toDate().toLocaleDateString('es-CO') : payment.paymentDate;
            row.innerHTML = `
                <td class="px-6 py-4 font-medium text-gray-900">${paymentDate}</td>
                <td class="px-6 py-4">${payment.concepto}</td>
                <td class="px-6 py-4 text-right font-medium">${currencyFormatter.format(payment.monto)}</td>
                <td class="px-6 py-4 text-center">
                    <button data-action="delete-payment" data-user-id="${userId}" data-doc-id="${doc.id}" class="text-red-500 hover:text-red-700">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    }, (error) => {
        console.error("Error al cargar historial de pagos:", error);
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-red-500">Error al cargar el historial.</td></tr>`;
    });

    // 5. Configurar los listeners del formulario
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);

    newForm.addEventListener('submit', (e) => handleRegisterPayment(e, userId));

    // --- INICIO DE MODIFICACIÓN (Añadir listener al checkbox) ---
    newForm.querySelectorAll('.payment-horas-input, .currency-input, .payment-dias-input, #payment-liquidar-bonificacion').forEach(input => {
        input.addEventListener('input', updatePaymentTotal);
    });
    // --- FIN DE MODIFICACIÓN ---

    newForm.querySelectorAll('.currency-input').forEach(_setupCurrencyInput);
}

/**
 * (FUNCIÓN ACTUALIZADA - FASE 3: LÓGICA DE LIQUIDACIÓN)
 * Calcula el total a pagar en el formulario de registro de pago en tiempo real.
 */
function updatePaymentTotal() {
    const config = _getPayrollConfig();
    if (!config || !config.salarioMinimo) {
        console.warn("Configuración de nómina no cargada. Los cálculos pueden ser incorrectos.");
        return;
    }

    const form = document.getElementById('payment-register-form');
    const salarioEl = document.getElementById('payment-salario-basico');
    const bonificacionEl = document.getElementById('payment-bonificacion-mes');
    const diasPagar = parseFloat(document.getElementById('payment-dias-pagar').value) || 0;

    // --- INICIO DE MODIFICACIÓN (FASE 3) ---
    // 1. Obtener el checkbox de liquidación
    const liquidarCheckbox = document.getElementById('payment-liquidar-bonificacion');
    const liquidarBonificacion = liquidarCheckbox.checked; // true si está marcado
    // --- FIN DE MODIFICACIÓN ---

    // 2. Obtener valores MENSUALES
    const salarioMensual = parseFloat(salarioEl.dataset.value || 0);
    const auxTransporteMensual = parseFloat(salarioEl.dataset.auxTransporte || 0);

    // 3. Calcular valores PRORRATEADOS
    const salarioProrrateado = (salarioMensual / 30) * diasPagar;
    const auxTransporteProrrateado = (auxTransporteMensual / 30) * diasPagar;

    // 4. Obtener valores que NO se prorratean
    const otros = parseFloat(document.getElementById('payment-otros').value.replace(/[$. ]/g, '')) || 0;

    // --- INICIO DE MODIFICACIÓN (FASE 3) ---
    // 5. Determinar la bonificación a pagar
    const bonificacionPotencial = parseFloat(bonificacionEl.dataset.value || 0);
    let bonificacionAPagar = 0; // Por defecto es 0 (ej. primera quincena)

    // Solo incluimos la bonificación si el checkbox está marcado
    if (liquidarBonificacion) {
        bonificacionAPagar = bonificacionPotencial;
    }
    // --- FIN DE MODIFICACIÓN ---

    // 6. Calcular Horas Extra
    const horasExtra = parseFloat(document.getElementById('payment-horas-diurnas').value) || 0;
    const valorHora = (salarioMensual / 235);
    const multiplicador = config.multiplicadorHoraExtra || 1.25;
    const totalHorasExtra = (horasExtra * valorHora * multiplicador);

    document.getElementById('payment-total-horas').textContent = currencyFormatter.format(totalHorasExtra);

    // 7. Calcular Deducciones (usando bonificacionAPagar)
    const deduccionSobreMinimo = form.dataset.deduccionSobreMinimo === 'true';
    let baseDeduccion = 0;

    if (deduccionSobreMinimo) {
        baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
    } else {
        // Base es: Básico + H.Extra + BONIFICACIÓN (solo si se paga)
        baseDeduccion = salarioProrrateado + totalHorasExtra + bonificacionAPagar;
    }

    if (baseDeduccion > 0 && baseDeduccion < (config.salarioMinimo / 30) * diasPagar) {
        baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
    }

    const deduccionSalud = baseDeduccion * (config.porcentajeSalud / 100);
    const deduccionPension = baseDeduccion * (config.porcentajePension / 100);
    const totalDeducciones = deduccionSalud + deduccionPension;

    // 8. Calcular Total Final (usando bonificacionAPagar)
    const totalDevengado = salarioProrrateado + auxTransporteProrrateado + bonificacionAPagar + totalHorasExtra + otros;
    const totalPagar = totalDevengado - totalDeducciones;

    document.getElementById('payment-total-pagar').textContent = currencyFormatter.format(totalPagar);
}

/**
 * (FUNCIÓN ACTUALIZADA - FASE 4: GUARDAR ESTADO DE LIQUIDACIÓN)
 * Maneja el evento 'submit' del nuevo formulario de registro de pago.
 */
async function handleRegisterPayment(e, userId) {
    e.preventDefault();
    const submitButton = document.getElementById('payment-submit-button');
    submitButton.disabled = true;
    submitButton.innerHTML = '<div class="loader-small mx-auto"></div>';

    const config = _getPayrollConfig();
    const form = document.getElementById('payment-register-form');

    try {
        // 1. Obtener valores del formulario
        const diasPagar = parseFloat(document.getElementById('payment-dias-pagar').value) || 0;
        const salarioMensual = parseFloat(document.getElementById('payment-salario-basico').dataset.value || 0);
        const auxTransporteMensual = parseFloat(document.getElementById('payment-salario-basico').dataset.auxTransporte || 0);

        const salarioProrrateado = (salarioMensual / 30) * diasPagar;
        const auxTransporteProrrateado = (auxTransporteMensual / 30) * diasPagar;

        const otros = parseFloat(document.getElementById('payment-otros').value.replace(/[$. ]/g, '')) || 0;
        const totalHorasExtra = parseFloat(document.getElementById('payment-total-horas').textContent.replace(/[$. ]/g, '')) || 0;
        const totalPagar = parseFloat(document.getElementById('payment-total-pagar').textContent.replace(/[$. ]/g, '')) || 0;
        const concepto = document.getElementById('payment-concepto').value;

        // --- INICIO DE MODIFICACIÓN (FASE 4) ---
        // 2. Leer el estado del checkbox de liquidación
        const liquidarCheckbox = document.getElementById('payment-liquidar-bonificacion');
        const liquidarBonificacion = liquidarCheckbox.checked;

        // 3. Determinar la bonificación que se está pagando
        const bonificacionPotencial = parseFloat(document.getElementById('payment-bonificacion-mes').dataset.value || 0);
        const bonificacionPagada = liquidarBonificacion ? bonificacionPotencial : 0;
        // --- FIN DE MODIFICACIÓN ---

        if (!concepto) throw new Error("Por favor, ingresa un concepto para el pago.");
        if (diasPagar <= 0) throw new Error("Por favor, ingresa un número de días válido.");

        // 4. Recalcular deducciones (basado en la bonificaciónPAGADA)
        const deduccionSobreMinimo = form.dataset.deduccionSobreMinimo === 'true';
        let baseDeduccion = 0;

        if (deduccionSobreMinimo) {
            baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
        } else {
            // La base es Básico + H.Extra + Bonificación (solo si se está pagando)
            baseDeduccion = salarioProrrateado + totalHorasExtra + bonificacionPagada;
        }

        if (baseDeduccion > 0 && baseDeduccion < (config.salarioMinimo / 30) * diasPagar) {
            baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
        }

        const deduccionSalud = baseDeduccion * (config.porcentajeSalud / 100);
        const deduccionPension = baseDeduccion * (config.porcentajePension / 100);

        // 5. Obtener el nombre de quien registra
        const currentUserId = _getCurrentUserId();
        const usersMap = _getUsersMap();
        const currentUser = usersMap.get(currentUserId);
        const registeredByName = currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : 'Sistema';

        // 6. Crear el objeto de historial de pago
        const paymentData = {
            userId: userId,
            paymentDate: new Date().toISOString().split('T')[0],
            concepto: concepto,
            monto: totalPagar,
            diasPagados: diasPagar,
            desglose: {
                salarioProrrateado: salarioProrrateado,
                auxilioTransporteProrrateado: auxTransporteProrrateado,
                bonificacionM2: bonificacionPagada, // <-- MODIFICADO (guarda solo lo pagado)
                horasExtra: totalHorasExtra,
                otros: otros,
                deduccionSalud: -deduccionSalud,
                deduccionPension: -deduccionPension,
                baseDeduccion: baseDeduccion,
                deduccionSobreMinimo: deduccionSobreMinimo
            },
            horas: {
                totalHorasExtra: parseFloat(document.getElementById('payment-horas-diurnas').value) || 0
            },
            createdAt: serverTimestamp(),
            registeredBy: currentUserId,
            registeredByName: registeredByName
        };

        // 7. Guardar en Firestore (en un batch)
        const batch = writeBatch(_db);

        const paymentHistoryRef = doc(collection(_db, "users", userId, "paymentHistory"));
        batch.set(paymentHistoryRef, paymentData);

        // --- INICIO DE MODIFICACIÓN (FASE 4) ---
        // 8. Si se liquidó la bonificación, marcarla como pagada en employeeStats
        if (liquidarBonificacion) {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const currentStatDocId = `${year}_${month}`;
            const statRef = doc(_db, "employeeStats", userId, "monthlyStats", currentStatDocId);

            // Usamos set con merge:true para crear el campo si no existe
            batch.set(statRef, {
                bonificacionPagada: true
            }, { merge: true });
        }
        // --- FIN DE MODIFICACIÓN ---

        await batch.commit(); // Ejecutamos ambas escrituras

        // 9. Resetear el formulario
        document.getElementById('payment-concepto').value = '';
        document.getElementById('payment-horas-diurnas').value = '0';
        document.getElementById('payment-otros').value = '$ 0';
        document.getElementById('payment-dias-pagar').value = '15';

        document.querySelectorAll('#payment-register-form .currency-input').forEach(_setupCurrencyInput);

        // Recargar la vista (Fase 2) para reflejar el estado "Pagada"
        loadPaymentHistoryView(userId);

    } catch (error) {
        console.error("Error al registrar el pago:", error);
        alert("Error al registrar el pago: " + error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Registrar Pago';
    }
}