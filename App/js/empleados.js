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
    writeBatch, // <-- LÍNEA CORREGIDA
    collectionGroup,
    increment
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
 * Carga el contenido de la pestaña "Nómina" con deducción de préstamos.
 */
async function loadNominaTab(container) {
    // 1. Renderizar el "Shell" (Estructura HTML)
    container.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-md">
            
            <div class="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
                <div class="relative w-full md:w-1/3">
                    <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <i class="fa-solid fa-search text-gray-400"></i>
                    </div>
                    <input type="text" id="nomina-search" class="pl-10 block w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-blue-500 focus:border-blue-500" placeholder="Buscar empleado...">
                </div>
                
                <button id="btn-export-nomina-excel" class="w-full md:w-auto bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center shadow transition-colors">
                    <i class="fa-solid fa-file-excel mr-2"></i> Exportar Sábana (Excel)
                </button>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left" id="nomina-table">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                        <tr>
                            <th class="px-6 py-3">Operario</th>
                            <th class="px-6 py-3 text-center">Nivel Comisión</th>
                            <th class="px-6 py-3 text-right">Salario Básico</th>
                            <th class="px-6 py-3 text-right text-lime-600">Bonificación M² (Mes)</th>
                            <th class="px-6 py-3 text-right text-red-600">Desc. Préstamos (Est.)</th>
                            <th class="px-6 py-3 text-right text-blue-700">Total a Pagar (Est.)</th>
                        </tr>
                    </thead>
                    <tbody id="empleados-nomina-table-body" class="divide-y divide-gray-100">
                    </tbody>
                    <tfoot id="empleados-nomina-table-foot" class="bg-gray-100 font-bold text-gray-800 border-t-2 border-gray-200">
                        <tr>
                            <td colspan="2" class="px-6 py-4 text-right uppercase text-xs tracking-wider">Totales del Mes:</td>
                            <td id="total-basico" class="px-6 py-4 text-right">---</td>
                            <td id="total-bonificacion" class="px-6 py-4 text-right text-lime-700">---</td>
                            <td id="total-deducciones" class="px-6 py-4 text-right text-red-700">---</td>
                            <td id="total-pagar" class="px-6 py-4 text-right text-blue-800 text-base">---</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <p class="text-xs text-gray-400 mt-2 text-right">* La deducción de préstamos es un estimado basado en (Saldo / Cuotas). El valor final se ajusta al registrar el pago.</p>
        </div>
    `;

    // 2. Obtener elementos del DOM
    const monthSelector = document.getElementById('empleado-month-selector');
    const tableBody = document.getElementById('empleados-nomina-table-body');
    const searchInput = document.getElementById('nomina-search');
    const exportBtn = document.getElementById('btn-export-nomina-excel');

    if (!monthSelector || !tableBody) return;

    const selectedMonthYear = monthSelector.value;
    const currentStatDocId = selectedMonthYear.replace('-', '_');

    tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10"><div class="loader mx-auto"></div><p class="mt-2 text-gray-500">Cargando reporte para ${selectedMonthYear}...</p></td></tr>`;

    try {
        // 3. Obtener usuarios activos
        const usersMap = _getUsersMap();
        const activeUsers = [];
        usersMap.forEach((user, id) => {
            if (user.status === 'active') {
                activeUsers.push({ id, ...user });
            }
        });

        if (activeUsers.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-500">No se encontraron operarios activos.</td></tr>`;
            return;
        }

        // 4. Obtener Préstamos Activos Globalmente (Optimización con collectionGroup)
        const loansQuery = query(collectionGroup(_db, 'loans'), where('status', '==', 'active'));
        const loansSnapshot = await getDocs(loansQuery);

        const userLoansMap = new Map(); // userId -> { totalBalance, estimatedDeduction }

        loansSnapshot.forEach(doc => {
            const loan = doc.data();
            // El abuelo del documento de préstamo es el usuario (users/{userId}/loans/{loanId})
            const userId = doc.ref.parent.parent.id;

            if (!userLoansMap.has(userId)) {
                userLoansMap.set(userId, { totalBalance: 0, estimatedDeduction: 0 });
            }

            const userData = userLoansMap.get(userId);
            userData.totalBalance += (loan.balance || 0);

            // Cálculo de cuota sugerida: Si hay cuotas definidas, dividimos saldo / cuotas.
            const installments = loan.installments && loan.installments > 0 ? loan.installments : 1;
            const deduction = (loan.balance || 0) / installments;

            userData.estimatedDeduction += deduction;
        });

        // 5. Obtener estadísticas del mes seleccionado
        const statPromises = activeUsers.map(op => getDoc(doc(_db, "employeeStats", op.id, "monthlyStats", currentStatDocId)));
        const statSnapshots = await Promise.all(statPromises);

        // Variables para acumuladores de totales
        let sumBasico = 0;
        let sumBonificacion = 0;
        let sumDeducciones = 0;
        let sumTotal = 0;

        // 6. Combinar datos y realizar cálculos
        const empleadoData = activeUsers.map((operario, index) => {
            const statDoc = statSnapshots[index];
            const stats = statDoc.exists() ? statDoc.data() : { totalBonificacion: 0 };
            const loanInfo = userLoansMap.get(operario.id) || { totalBalance: 0, estimatedDeduction: 0 };

            const basico = parseFloat(operario.salarioBasico) || 0;
            const bono = stats.totalBonificacion || 0;

            // La deducción estimada no puede ser mayor a la deuda total
            const deduction = Math.min(loanInfo.estimatedDeduction, loanInfo.totalBalance);

            // Neto estimado = Básico + Bono - Deducción
            const total = basico + bono - deduction;

            sumBasico += basico;
            sumBonificacion += bono;
            sumDeducciones += deduction;
            sumTotal += total;

            return {
                id: operario.id,
                fullName: `${operario.firstName} ${operario.lastName}`,
                cedula: operario.idNumber || 'N/A',
                bankName: operario.bankName || 'N/A',
                accountType: operario.accountType || 'N/A',
                accountNumber: operario.accountNumber || 'N/A',
                commissionLevel: operario.commissionLevel || 'principiante',
                salarioBasico: basico,
                bonificacion: bono,
                deduccionPrestamos: deduction, // Valor a descontar
                deudaTotal: loanInfo.totalBalance, // Deuda total activa
                totalPagar: total
            };
        });

        // 7. Ordenar por total a pagar descendente
        empleadoData.sort((a, b) => b.totalPagar - a.totalPagar);

        // 8. Función de renderizado de la tabla
        const renderTable = (dataToRender) => {
            tableBody.innerHTML = '';
            if (dataToRender.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-500">No se encontraron resultados.</td></tr>`;
                return;
            }

            dataToRender.forEach(data => {
                const row = document.createElement('tr');
                row.className = 'bg-white hover:bg-blue-50 cursor-pointer transition-colors searchable-row';
                row.dataset.action = "view-payment-history";
                row.dataset.id = data.id;

                const levelText = data.commissionLevel.charAt(0).toUpperCase() + data.commissionLevel.slice(1);

                // Estilo rojo si hay deducción
                const dedHtml = data.deduccionPrestamos > 0
                    ? `<span class="text-red-600 font-semibold">- ${currencyFormatter.format(data.deduccionPrestamos)}</span>`
                    : `<span class="text-gray-400">-</span>`;

                row.innerHTML = `
                    <td class="px-6 py-4 font-medium text-gray-900">
                        ${data.fullName}
                        ${data.deudaTotal > 0 ? `<div class="text-xs text-red-400">Deuda Total: ${currencyFormatter.format(data.deudaTotal)}</div>` : ''}
                    </td>
                    <td class="px-6 py-4 text-center text-xs uppercase text-gray-500 font-semibold">${levelText}</td>
                    <td class="px-6 py-4 text-right font-medium text-gray-600">${currencyFormatter.format(data.salarioBasico)}</td>
                    <td class="px-6 py-4 text-right font-bold text-lime-600">${currencyFormatter.format(data.bonificacion)}</td>
                    <td class="px-6 py-4 text-right">${dedHtml}</td>
                    <td class="px-6 py-4 text-right font-bold text-blue-700">${currencyFormatter.format(data.totalPagar)}</td>
                `;
                tableBody.appendChild(row);
            });
        };

        renderTable(empleadoData);

        // 9. Actualizar Footer con Totales
        document.getElementById('total-basico').textContent = currencyFormatter.format(sumBasico);
        document.getElementById('total-bonificacion').textContent = currencyFormatter.format(sumBonificacion);
        document.getElementById('total-deducciones').textContent = "- " + currencyFormatter.format(sumDeducciones);
        document.getElementById('total-pagar').textContent = currencyFormatter.format(sumTotal);

        // 10. Lógica del Buscador
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filteredData = empleadoData.filter(emp =>
                emp.fullName.toLowerCase().includes(term) ||
                emp.cedula.includes(term)
            );
            renderTable(filteredData);
        });

        // 11. Lógica de Exportación a Excel
        exportBtn.addEventListener('click', () => {
            try {
                // Datos del reporte
                const exportData = empleadoData.map(emp => ({
                    "Cédula": emp.cedula,
                    "Nombre Completo": emp.fullName,
                    "Banco": emp.bankName,
                    "Tipo Cuenta": emp.accountType,
                    "No. Cuenta": emp.accountNumber,
                    "Nivel": emp.commissionLevel,
                    "Salario Básico": emp.salarioBasico,
                    "Bonificación Mes": emp.bonificacion,
                    "Deducción Préstamos (Est.)": emp.deduccionPrestamos,
                    "Deuda Total Restante": emp.deudaTotal - emp.deduccionPrestamos, // Saldo proyectado
                    "Total a Pagar (Est.)": emp.totalPagar,
                    "Mes": selectedMonthYear
                }));

                // Fila de Totales
                exportData.push({
                    "Cédula": "",
                    "Nombre Completo": "TOTALES",
                    "Banco": "",
                    "Tipo Cuenta": "",
                    "No. Cuenta": "",
                    "Nivel": "",
                    "Salario Básico": sumBasico,
                    "Bonificación Mes": sumBonificacion,
                    "Deducción Préstamos (Est.)": sumDeducciones,
                    "Deuda Total Restante": "",
                    "Total a Pagar (Est.)": sumTotal,
                    "Mes": ""
                });

                const ws = XLSX.utils.json_to_sheet(exportData);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Nomina " + selectedMonthYear);

                // Ajustar ancho de columnas
                const wscols = [
                    { wch: 15 }, { wch: 30 }, { wch: 20 }, { wch: 15 }, { wch: 20 }, { wch: 15 },
                    { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 10 }
                ];
                ws['!cols'] = wscols;

                XLSX.writeFile(wb, `Sabana_Nomina_Detallada_${selectedMonthYear}.xlsx`);

            } catch (error) {
                console.error("Error al exportar Excel:", error);
                alert("No se pudo generar el archivo Excel.");
            }
        });

    } catch (error) {
        console.error("Error al cargar el reporte de nómina:", error);
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-red-500">Error: ${error.message}</td></tr>`;
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

    document.getElementById('empleado-details-bank').textContent = user.bankName || 'No registrado';
    document.getElementById('empleado-details-account-type').textContent = user.accountType || 'N/A';
    document.getElementById('empleado-details-account-number').textContent = user.accountNumber || '---';

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

/**
 * Abre el modal de Comprobante de Nómina (Versión Profesional con Ajuste Salarial).
 * @param {object} payment - Objeto con los datos del pago.
 * @param {object} user - Objeto completo del usuario.
 */
function openPaymentVoucherModal(payment, user) {
    const modal = document.getElementById('payment-voucher-modal');
    const earningsList = document.getElementById('voucher-earnings-list');
    const deductionsList = document.getElementById('voucher-deductions-list');

    if (!modal) return;

    // 1. Llenar datos básicos
    const dateStr = payment.createdAt ? payment.createdAt.toDate().toLocaleDateString('es-CO') : payment.paymentDate;
    document.getElementById('voucher-date').textContent = `Fecha de Pago: ${dateStr}`;

    // Nombre y Cédula
    document.getElementById('voucher-employee-name').textContent = `${user.firstName} ${user.lastName}`;
    document.getElementById('voucher-employee-id').textContent = user.idNumber || 'N/A';

    document.getElementById('voucher-concept').textContent = payment.concepto;
    document.getElementById('voucher-total').textContent = currencyFormatter.format(payment.monto);

    // 2. Limpiar listas
    earningsList.innerHTML = '';
    deductionsList.innerHTML = '';
    earningsList.classList.remove('space-y-2');
    deductionsList.classList.remove('space-y-2');

    // 3. Helper de filas
    const createItemRow = (label, value, isBold = false) => {
        return `
            <li class="flex justify-between items-center py-3 border-b border-gray-100 last:border-0 ${isBold ? 'font-bold text-gray-800 text-base' : 'text-gray-600'}">
                <span>${label}</span>
                <span>${currencyFormatter.format(value)}</span>
            </li>`;
    };

    // 4. Desglosar datos
    const d = payment.desglose || {};
    const horas = payment.horas || {};

    // --- INICIO DE LA LÓGICA DE VISUALIZACIÓN (Salario Mínimo vs Real) ---
    let displaySalario = d.salarioProrrateado;
    let displayBonificacion = d.bonificacionM2 || 0;

    // Si el pago se calculó sobre la base del mínimo (deduccionSobreMinimo = true)
    if (d.deduccionSobreMinimo && d.baseDeduccion > 0) {
        // En este modo, 'baseDeduccion' guarda exactamente el Salario Mínimo * Días Trabajados.
        const salarioMinimoProrrateado = d.baseDeduccion;

        // Solo aplicamos el cambio si el salario real es mayor al mínimo (para no afectar a quienes ganan menos)
        if (displaySalario > salarioMinimoProrrateado) {
            const excedente = displaySalario - salarioMinimoProrrateado;

            // 1. El salario básico visual pasa a ser el mínimo
            displaySalario = salarioMinimoProrrateado;

            // 2. El excedente se suma a la bonificación existente
            displayBonificacion += excedente;
        }
    }
    // --- FIN DE LA LÓGICA ---

    // --- INGRESOS ---
    if (displaySalario > 0) {
        earningsList.innerHTML += createItemRow(`Salario Básico (${payment.diasPagados} días)`, displaySalario);
    }

    if (d.auxilioTransporteProrrateado > 0) {
        earningsList.innerHTML += createItemRow(`Aux. Transporte`, d.auxilioTransporteProrrateado);
    }

    if (d.horasExtra > 0) {
        earningsList.innerHTML += createItemRow(`Horas Extra (${horas.totalHorasExtra || 0}h)`, d.horasExtra);
    }

    if (displayBonificacion > 0) {
        // Cambiamos la etiqueta para que refleje que incluye auxilios/bonos
        earningsList.innerHTML += createItemRow(`Bonificación / Aux. No Salarial`, displayBonificacion, true);
    }

    if (d.otros > 0) {
        earningsList.innerHTML += createItemRow(`Otros Pagos`, d.otros);
    }

    // --- DEDUCCIONES ---
    if (d.deduccionSalud < 0) {
        deductionsList.innerHTML += createItemRow(`Aporte Salud (4%)`, Math.abs(d.deduccionSalud));
    }

    if (d.deduccionPension < 0) {
        deductionsList.innerHTML += createItemRow(`Aporte Pensión (4%)`, Math.abs(d.deduccionPension));
    }

    if (d.abonoPrestamos > 0) {
        deductionsList.innerHTML += createItemRow(`Abono a Préstamos/Adelantos`, d.abonoPrestamos, true); // true para negrita
    }

    if (d.otros < 0) {
        deductionsList.innerHTML += createItemRow(`Otros Descuentos`, Math.abs(d.otros));
    }

    if (deductionsList.innerHTML === '') {
        deductionsList.innerHTML = '<li class="py-3 text-gray-400 italic text-center text-xs">No hay deducciones registradas</li>';
    }

    // 5. Mostrar Modal
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    const closeModal = () => { modal.style.display = 'none'; };
    document.getElementById('voucher-close-btn').onclick = closeModal;
    document.getElementById('voucher-close-footer-btn').onclick = closeModal;
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
 * Abre el modal de creación de préstamo.
 */
function openLoanModal(userId) {
    const modal = document.getElementById('loan-modal');
    const form = document.getElementById('loan-form');
    if (!modal || !form) return;

    form.reset();
    // Formato de moneda para el input
    const amountInput = form.querySelector('input[name="amount"]');
    _setupCurrencyInput(amountInput);

    // Fecha hoy
    form.querySelector('input[name="date"]').value = new Date().toISOString().split('T')[0];

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // Manejo del submit (una sola vez)
    form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Guardando...';

        try {
            const amount = parseFloat(amountInput.value.replace(/[$. ]/g, '')) || 0;
            const description = form.querySelector('textarea[name="description"]').value;
            const installments = parseInt(form.querySelector('input[name="installments"]').value) || 1;
            const date = form.querySelector('input[name="date"]').value;

            if (amount <= 0) throw new Error("El monto debe ser mayor a 0");

            // Guardar en subcolección 'loans'
            await addDoc(collection(_db, "users", userId, "loans"), {
                amount: amount,
                balance: amount, // Al inicio, el saldo es igual al monto
                description: description,
                installments: installments,
                date: date,
                status: 'active', // active | paid
                createdAt: serverTimestamp()
            });

            alert("Préstamo registrado exitosamente.");
            modal.style.display = 'none';
            // Recargar vista para actualizar deuda
            loadPaymentHistoryView(userId);

        } catch (error) {
            console.error(error);
            alert("Error al guardar: " + error.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Guardar Préstamo';
        }
    };

    document.getElementById('loan-modal-cancel').onclick = () => {
        modal.style.display = 'none';
    };
}

/**
 * (FUNCIÓN MAESTRA) Carga el historial, datos bancarios, navegación y GESTIÓN DE PRÉSTAMOS.
 */
export async function loadPaymentHistoryView(userId) {
    _showView('payment-history-view');

    // Limpiar listener anterior
    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    // --- 1. REFERENCIAS DOM ---
    const nameEl = document.getElementById('payment-history-name');
    const tableBody = document.getElementById('payment-history-table-body');

    // Bancarios
    const bankInfoContainer = document.getElementById('payment-header-bank-info');
    const bankNameEl = document.getElementById('ph-bank-name');
    const accountTypeEl = document.getElementById('ph-account-type');
    const accountNumberEl = document.getElementById('ph-account-number');

    // Navegación
    const btnPrev = document.getElementById('btn-prev-employee');
    const btnNext = document.getElementById('btn-next-employee');

    // Formulario
    const form = document.getElementById('payment-register-form');
    const salarioEl = document.getElementById('payment-salario-basico');
    const bonificacionEl = document.getElementById('payment-bonificacion-mes');
    const liquidarCheckbox = document.getElementById('payment-liquidar-bonificacion');
    const diasPagarInput = document.getElementById('payment-dias-pagar');

    // Préstamos (Elementos nuevos)
    const debtEl = document.getElementById('payment-total-debt');
    // Nota: El contenedor de la lista se genera dinámicamente abajo, 
    // asegurándonos de reemplazar el fieldset estático si aún existe.

    // Estado de carga inicial
    nameEl.textContent = 'Cargando datos...';
    tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-500"><div class="loader mx-auto"></div></td></tr>`;
    bankInfoContainer.classList.add('hidden');

    let user = null;

    try {
        // --- 2. DATOS FRESCOS ---
        const userRef = doc(_db, "users", userId);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            user = { id: userSnap.id, ...userSnap.data() };
            _getUsersMap().set(userId, user);
        } else {
            throw new Error("Usuario no encontrado.");
        }

        // --- 3. UI ENCABEZADO Y BANCO ---
        nameEl.textContent = `${user.firstName} ${user.lastName}`;

        if (user.bankName && user.accountNumber) {
            bankNameEl.textContent = user.bankName;
            accountTypeEl.textContent = user.accountType || 'Cuenta';
            accountNumberEl.textContent = user.accountNumber;
            bankInfoContainer.classList.remove('hidden');

            const accountContainer = accountNumberEl.parentElement;
            const newAccountContainer = accountContainer.cloneNode(true);
            accountContainer.parentNode.replaceChild(newAccountContainer, accountContainer);

            newAccountContainer.onclick = () => {
                navigator.clipboard.writeText(user.accountNumber).then(() => {
                    const icon = newAccountContainer.querySelector('i');
                    const originalClass = "fa-regular fa-copy ml-2 text-gray-400 group-hover:text-gray-600";
                    icon.className = "fa-solid fa-check ml-2 text-green-600 scale-125 transition-transform";
                    setTimeout(() => { icon.className = originalClass; }, 1500);
                }).catch(console.error);
            };
        } else {
            bankInfoContainer.classList.add('hidden');
        }

        // --- 4. NAVEGACIÓN ---
        const usersMap = _getUsersMap();
        const activeUsers = Array.from(usersMap.values())
            .filter(u => u.status === 'active')
            .sort((a, b) => a.firstName.localeCompare(b.firstName));

        let currentIndex = -1;
        if (activeUsers.length > 0) currentIndex = activeUsers.findIndex(u => u.id === userId);

        if (btnPrev) {
            const newBtnPrev = btnPrev.cloneNode(true);
            btnPrev.parentNode.replaceChild(newBtnPrev, btnPrev);
            if (currentIndex > 0) {
                const prevUser = activeUsers[currentIndex - 1];
                newBtnPrev.disabled = false;
                newBtnPrev.title = `Ir a: ${prevUser.firstName} ${prevUser.lastName}`;
                newBtnPrev.onclick = () => loadPaymentHistoryView(prevUser.id);
            } else { newBtnPrev.disabled = true; }
        }

        if (btnNext) {
            const newBtnNext = btnNext.cloneNode(true);
            btnNext.parentNode.replaceChild(newBtnNext, btnNext);
            if (currentIndex !== -1 && currentIndex < activeUsers.length - 1) {
                const nextUser = activeUsers[currentIndex + 1];
                newBtnNext.disabled = false;
                newBtnNext.title = `Ir a: ${nextUser.firstName} ${nextUser.lastName}`;
                newBtnNext.onclick = () => loadPaymentHistoryView(nextUser.id);
            } else { newBtnNext.disabled = true; }
        }

// --- 5. GESTIÓN DE PRÉSTAMOS (SOLO DEDUCCIÓN) ---
        
        // 1. Búsqueda robusta del contenedor
        let loanFieldset = document.getElementById('loan-management-fieldset');
        if (!loanFieldset) {
            loanFieldset = form.querySelector('fieldset.bg-indigo-50');
            if (!loanFieldset) {
                 const legends = form.querySelectorAll('legend');
                 for (const legend of legends) {
                     if (legend.textContent.includes('Deducción') || legend.textContent.includes('Préstamos')) {
                         loanFieldset = legend.parentElement;
                         break;
                     }
                 }
            }
        }

        if (loanFieldset) {
            loanFieldset.id = 'loan-management-fieldset';
            loanFieldset.className = "mt-6 space-y-3";
            loanFieldset.style.border = "none";
            loanFieldset.style.background = "transparent";
            loanFieldset.style.padding = "0";

            loanFieldset.innerHTML = `
                <div class="px-1 border-b border-gray-200 pb-2 mb-2">
                    <h4 class="text-sm font-bold text-gray-700 uppercase tracking-wide">Deducción de Préstamos</h4>
                    <p class="text-xs text-gray-500 mt-0.5">Deuda Total Activa: <span id="payment-total-debt" class="font-bold text-red-600">$ 0</span></p>
                </div>

                <div class="bg-white border border-gray-300 rounded-lg overflow-hidden shadow-sm">
                    <div class="max-h-48 overflow-y-auto custom-scrollbar">
                        <table class="w-full text-xs text-left">
                            <thead class="bg-gray-100 text-gray-600 font-semibold border-b border-gray-200 sticky top-0 z-10">
                                <tr>
                                    <th class="py-2 px-3 w-2/5">Concepto</th>
                                    <th class="py-2 px-3 w-1/5 text-right">Fecha</th>
                                    <th class="py-2 px-3 w-1/5 text-right">Saldo</th>
                                    <th class="py-2 px-3 w-1/5 text-right">Abonar</th>
                                </tr>
                            </thead>
                            <tbody id="active-loans-list" class="divide-y divide-gray-100 text-gray-700">
                                <tr><td colspan="4" class="text-center py-4 text-gray-400 italic">Cargando préstamos...</td></tr>
                            </tbody>
                        </table>
                    </div>
                    
                    <div class="bg-gray-50 border-t border-gray-200 px-4 py-2 flex justify-between items-center">
                        <span class="font-semibold text-gray-600">Total a Descontar:</span>
                        <span id="payment-total-loan-deduction-display" class="font-bold text-base text-red-600">$ 0</span>
                    </div>
                </div>
            `;

            // (ELIMINADO EL LISTENER DEL BOTÓN 'btn-new-loan-trigger')

            // 2. Consultar y Renderizar Préstamos
            const activeLoansList = document.getElementById('active-loans-list');
            const totalDebtElDisplay = document.getElementById('payment-total-debt');

            const loansQuery = query(collection(_db, "users", userId, "loans"), where("status", "==", "active"), orderBy("date", "asc"));
            const loansSnap = await getDocs(loansQuery);
            
            let totalActiveDebt = 0;
            activeLoansList.innerHTML = '';

            if (loansSnap.empty) {
                activeLoansList.innerHTML = `
                    <tr>
                        <td colspan="4" class="text-center py-6 text-gray-400">
                            <i class="fa-regular fa-circle-check mb-1 text-lg"></i><br>
                            Sin deudas activas
                        </td>
                    </tr>`;
            } else {
                loansSnap.forEach(doc => {
                    const loan = { id: doc.id, ...doc.data() };
                    totalActiveDebt += (loan.balance || 0);
                    
                    const dateStr = new Date(loan.date).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' });

                    const row = document.createElement('tr');
                    row.className = "hover:bg-blue-50 transition-colors group";
                    
                    row.innerHTML = `
                        <td class="py-2 px-3 align-middle">
                            <div class="truncate font-medium max-w-[120px] sm:max-w-[180px]" title="${loan.description}">
                                ${loan.description}
                            </div>
                            ${loan.installments > 1 ? '<span class="text-[9px] text-blue-500 bg-blue-100 px-1 rounded">Diferido</span>' : ''}
                        </td>
                        <td class="py-2 px-3 text-right text-gray-500 align-middle whitespace-nowrap">
                            ${dateStr}
                        </td>
                        <td class="py-2 px-3 text-right font-bold text-gray-800 align-middle whitespace-nowrap">
                            ${currencyFormatter.format(loan.balance)}
                        </td>
                        <td class="py-1.5 px-3 text-right align-middle">
                            <input type="text" 
                                class="loan-deduction-input w-24 border border-gray-300 rounded px-2 py-1 text-right text-xs font-bold text-gray-900 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-300 outline-none" 
                                placeholder="0"
                                data-loan-id="${loan.id}"
                                data-balance="${loan.balance}">
                        </td>
                    `;
                    activeLoansList.appendChild(row);
                });
            }
            
            totalDebtElDisplay.textContent = currencyFormatter.format(totalActiveDebt);

            // Activar eventos
            activeLoansList.querySelectorAll('.loan-deduction-input').forEach(input => {
                _setupCurrencyInput(input);
                input.addEventListener('focus', function() { this.select(); });
                input.addEventListener('input', () => updatePaymentTotal());
            });
        }
        
    } catch (e) {
        console.error("Error al cargar datos:", e);
        nameEl.textContent = 'Error';
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-red-500">${e.message}</td></tr>`;
        return;
    }

    // --- 6. CONFIGURAR FORMULARIO ---
    const config = _getPayrollConfig();
    const salario = parseFloat(user.salarioBasico) || 0;
    let auxTransporte = 0;

    if (config && config.salarioMinimo && salario > 0) {
        const limiteSMLV = (config.salarioMinimo) * (config.limiteAuxilioTransporte || 2);
        if (salario <= limiteSMLV) auxTransporte = config.auxilioTransporte || 0;
    }

    salarioEl.textContent = currencyFormatter.format(salario) + " (Mensual)";
    salarioEl.dataset.value = salario;
    salarioEl.dataset.auxTransporte = auxTransporte;

    form.dataset.deduccionSobreMinimo = user.deduccionSobreMinimo || false;

    // Bonificación
    const today = new Date();
    const currentStatDocId = `${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}`;
    const statRef = doc(_db, "employeeStats", userId, "monthlyStats", currentStatDocId);
    const statSnap = await getDoc(statRef);

    let bonificacion = 0;
    let pagada = false;
    if (statSnap.exists()) {
        bonificacion = statSnap.data().totalBonificacion || 0;
        pagada = statSnap.data().bonificacionPagada || false;
    }

    bonificacionEl.dataset.value = bonificacion;
    if (pagada) {
        bonificacionEl.textContent = currencyFormatter.format(bonificacion) + " (Ya liquidada)";
        bonificacionEl.classList.replace('text-lime-600', 'text-gray-400');
        liquidarCheckbox.checked = true; liquidarCheckbox.disabled = true;
    } else {
        bonificacionEl.textContent = currencyFormatter.format(bonificacion) + " (Pendiente)";
        bonificacionEl.classList.replace('text-gray-400', 'text-lime-600');
        liquidarCheckbox.checked = false; liquidarCheckbox.disabled = false;
    }

    if (!diasPagarInput.value) diasPagarInput.value = 15;
    // Llamamos al recálculo inicial
    if (typeof updatePaymentTotal === 'function') updatePaymentTotal();

    // --- 7. TABLA HISTORIAL (Snapshot) ---
    const q = query(collection(_db, "users", userId, "paymentHistory"), orderBy("createdAt", "desc"));
    unsubscribeEmpleadosTab = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-500">No hay pagos.</td></tr>`;
            return;
        }
        tableBody.innerHTML = '';
        snapshot.forEach(docSnap => {
            const payment = docSnap.data();
            const row = document.createElement('tr');
            row.className = 'bg-white border-b hover:bg-gray-50 transition-colors';
            const date = payment.createdAt ? payment.createdAt.toDate().toLocaleDateString('es-CO') : payment.paymentDate;

            row.innerHTML = `
                <td class="px-6 py-4 font-medium text-gray-900">${date}</td>
                <td class="px-6 py-4">${payment.concepto}</td>
                <td class="px-6 py-4 text-right font-medium text-gray-900">${currencyFormatter.format(payment.monto)}</td>
                <td class="px-6 py-4 text-center">
                    <div class="flex justify-center items-center gap-2">
                        <button class="view-voucher-btn bg-blue-100 hover:bg-blue-200 text-blue-700 p-2 rounded-full transition-colors" title="Ver Comprobante">
                            <i class="fa-solid fa-file-invoice-dollar"></i>
                        </button>
                        <button data-action="delete-payment" data-user-id="${userId}" data-doc-id="${docSnap.id}" class="bg-red-100 hover:bg-red-200 text-red-600 p-2 rounded-full transition-colors" title="Eliminar">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </td>
            `;

            const viewBtn = row.querySelector('.view-voucher-btn');
            if (viewBtn) {
                // Aseguramos que openPaymentVoucherModal esté disponible
                viewBtn.addEventListener('click', () => {
                    // Suponiendo que esta función existe en el mismo archivo o es global
                    // Si es interna, la llamamos directo.
                    openPaymentVoucherModal(payment, user);
                });
            }
            tableBody.appendChild(row);
        });
    });

    // --- 8. LISTENERS DEL FORMULARIO ---
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);

    newForm.addEventListener('submit', (e) => handleRegisterPayment(e, userId));

    newForm.querySelectorAll('.payment-horas-input, .currency-input, .payment-dias-input, #payment-liquidar-bonificacion').forEach(input => {
        input.addEventListener('input', () => {
            if (typeof updatePaymentTotal === 'function') updatePaymentTotal();
        });
    });

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

    let loanDeduction = 0;
    document.querySelectorAll('.loan-deduction-input').forEach(input => {
        const val = parseFloat(input.value.replace(/[$. ]/g, '')) || 0;
        loanDeduction += val;
    });

    // Actualizar el display del total a descontar en el fieldset
    const loanTotalDisplay = document.getElementById('payment-total-loan-deduction-display');
    if (loanTotalDisplay) loanTotalDisplay.textContent = currencyFormatter.format(loanDeduction);

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
    const totalPagar = totalDevengado - totalDeducciones - loanDeduction; // Se usa la suma calculada

    document.getElementById('payment-total-pagar').textContent = currencyFormatter.format(totalPagar);
}

/**
 * (FUNCIÓN COMPLETA) Registra el pago, aplica deducciones y AMORTIZA PRÉSTAMOS ESPECÍFICOS.
 */
async function handleRegisterPayment(e, userId) {
    e.preventDefault();
    const submitButton = document.getElementById('payment-submit-button');
    submitButton.disabled = true;
    submitButton.innerHTML = '<div class="loader-small mx-auto"></div>';

    const config = _getPayrollConfig();
    const form = document.getElementById('payment-register-form');

    try {
        // 1. Obtener valores generales
        const diasPagar = parseFloat(document.getElementById('payment-dias-pagar').value) || 0;
        const salarioMensual = parseFloat(document.getElementById('payment-salario-basico').dataset.value || 0);
        const auxTransporteMensual = parseFloat(document.getElementById('payment-salario-basico').dataset.auxTransporte || 0);

        const salarioProrrateado = (salarioMensual / 30) * diasPagar;
        const auxTransporteProrrateado = (auxTransporteMensual / 30) * diasPagar;

        const otros = parseFloat(document.getElementById('payment-otros').value.replace(/[$. ]/g, '')) || 0;
        const totalHorasExtra = parseFloat(document.getElementById('payment-total-horas').textContent.replace(/[$. ]/g, '')) || 0;
        const concepto = document.getElementById('payment-concepto').value;

        // 2. PROCESAR DEDUCCIÓN DE PRÉSTAMOS (Lógica Individual)
        let totalLoanDeduction = 0;
        const loanPayments = []; // Array para guardar qué préstamos se pagaron

        const loanInputs = document.querySelectorAll('.loan-deduction-input');
        for (const input of loanInputs) {
            const val = parseFloat(input.value.replace(/[$. ]/g, '')) || 0;
            const loanId = input.dataset.loanId;
            const currentBalance = parseFloat(input.dataset.balance);

            if (val > 0) {
                if (val > currentBalance) {
                    throw new Error(`El abono a uno de los préstamos supera su saldo pendiente (${currencyFormatter.format(currentBalance)}).`);
                }

                totalLoanDeduction += val;
                loanPayments.push({
                    loanId: loanId,
                    amount: val,
                    previousBalance: currentBalance
                });
            }
        }

        // 3. Checkbox Liquidación
        const liquidarBonificacion = document.getElementById('payment-liquidar-bonificacion').checked;
        const bonificacionPotencial = parseFloat(document.getElementById('payment-bonificacion-mes').dataset.value || 0);
        const bonificacionPagada = liquidarBonificacion ? bonificacionPotencial : 0;

        // 4. Validaciones
        if (!concepto) throw new Error("Ingresa un concepto para el pago.");
        if (diasPagar <= 0) throw new Error("Días a pagar inválidos.");

        // 5. Calcular Deducciones de Ley
        const deduccionSobreMinimo = form.dataset.deduccionSobreMinimo === 'true';
        let baseDeduccion = 0;

        if (deduccionSobreMinimo) {
            baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
        } else {
            baseDeduccion = salarioProrrateado + totalHorasExtra + bonificacionPagada;
        }

        if (baseDeduccion > 0 && baseDeduccion < (config.salarioMinimo / 30) * diasPagar) {
            baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
        }

        const deduccionSalud = baseDeduccion * (config.porcentajeSalud / 100);
        const deduccionPension = baseDeduccion * (config.porcentajePension / 100);
        const totalDeduccionesLey = deduccionSalud + deduccionPension;

        // 6. CALCULAR NETO A PAGAR FINAL
        // (Ingresos) - (Salud + Pension) - (Total Préstamos)
        const totalDevengado = salarioProrrateado + auxTransporteProrrateado + bonificacionPagada + totalHorasExtra + otros;
        const totalPagar = totalDevengado - totalDeduccionesLey - totalLoanDeduction;

        if (totalPagar < 0) throw new Error("El total a pagar no puede ser negativo. Revisa las deducciones.");

        // 7. Obtener datos de registro
        const currentUserId = _getCurrentUserId();
        const usersMap = _getUsersMap();
        const currentUser = usersMap.get(currentUserId);
        const registeredByName = currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : 'Sistema';

        // 8. Construir Objeto Payment
        const paymentData = {
            userId: userId,
            paymentDate: new Date().toISOString().split('T')[0],
            concepto: concepto,
            monto: totalPagar,
            diasPagados: diasPagar,
            desglose: {
                salarioProrrateado: salarioProrrateado,
                auxilioTransporteProrrateado: auxTransporteProrrateado,
                bonificacionM2: bonificacionPagada,
                horasExtra: totalHorasExtra,
                otros: otros,
                abonoPrestamos: totalLoanDeduction, // Total descontado
                detallesPrestamos: loanPayments,    // Detalle específico (NUEVO)
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

        const batch = writeBatch(_db);

        // A. Guardar el documento de Pago
        const paymentHistoryRef = doc(collection(_db, "users", userId, "paymentHistory"));
        batch.set(paymentHistoryRef, paymentData);

        // B. Actualizar Bonificación (si aplica)
        if (liquidarBonificacion) {
            const today = new Date();
            const currentStatDocId = `${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}`;
            const statRef = doc(_db, "employeeStats", userId, "monthlyStats", currentStatDocId);
            batch.set(statRef, { bonificacionPagada: true }, { merge: true });
        }

        // C. AMORTIZAR PRÉSTAMOS ESPECÍFICOS
        loanPayments.forEach(pago => {
            const loanRef = doc(_db, "users", userId, "loans", pago.loanId);
            const newBalance = pago.previousBalance - pago.amount;

            const updateData = { balance: newBalance };
            if (newBalance <= 0) {
                updateData.status = 'paid';
                updateData.paidAt = serverTimestamp();
            }
            batch.update(loanRef, updateData);
        });

        // Ejecutar todas las escrituras
        await batch.commit();

        // 9. Resetear y Recargar
        document.getElementById('payment-concepto').value = '';
        document.getElementById('payment-horas-diurnas').value = '0';
        document.getElementById('payment-otros').value = '$ 0';
        // Los inputs de préstamos se limpiarán al recargar la vista
        document.getElementById('payment-dias-pagar').value = '15';

        document.querySelectorAll('#payment-register-form .currency-input').forEach(_setupCurrencyInput);

        // Recargar vista para ver el pago en la tabla y actualizar las deudas
        loadPaymentHistoryView(userId);

    } catch (error) {
        console.error("Error al registrar el pago:", error);
        alert("Error: " + error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Registrar Pago';
    }
}