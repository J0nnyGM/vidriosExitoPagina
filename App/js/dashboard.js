// App/js/dashboard.js

// --- Importaciones de Firebase (necesarias para las consultas) ---
import {
    doc,
    onSnapshot,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs // <-- Importante para el dashboard de operario
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// --- Variables del Módulo (Dependencias de app.js) ---
// Estas se inicializarán con initDashboard()
let _db;
let _showView;
let _getUsersMap;
let _getCurrentUserRole;
let _getCurrentUserId;

// --- Variables locales del Módulo (Estado) ---
let activeDashboardCharts = [];
let unsubscribeDashboard = null;

/**
 * Inicializa el módulo del Dashboard.
 * app.js llama a esta función una vez al inicio.
 */
export function initDashboard(db, showView, getUsersMap, getCurrentUserRole, getCurrentUserId) {
    _db = db;
    _showView = showView;
    _getUsersMap = getUsersMap;
    _getCurrentUserRole = getCurrentUserRole;
    _getCurrentUserId = getCurrentUserId;
}

/**
 * Muestra el dashboard general y activa el listener de estadísticas
 * (VERSIÓN MIGRADA: Enrutador por Rol)
 * Esta es la función que app.js llamará desde el menú.
 */
export function showGeneralDashboard() {
    _showView('dashboard-general');
    const widgetsContainer = document.getElementById('dashboard-widgets-container');
    widgetsContainer.innerHTML = '<p class="text-gray-500">Cargando estadísticas...</p>';

    // 1. Destruir cualquier gráfico de una vista anterior
    destroyExistingCharts();

    // 2. Cancelar listeners de dashboard anteriores
    if (unsubscribeDashboard) {
        unsubscribeDashboard();
        unsubscribeDashboard = null; // Limpiamos la variable
    }

    const userRole = _getCurrentUserRole();

    // 3. Cargar el dashboard correcto según el rol
    if (userRole === 'admin' || userRole === 'bodega' || userRole === 'sst') {
        loadAdminDashboard(widgetsContainer);
    } else if (userRole === 'operario') {
        loadOperarioDashboard(widgetsContainer, _getCurrentUserId());
    } else {
        widgetsContainer.innerHTML = '<p class="text-gray-500">No hay un dashboard configurado para este rol.</p>';
    }
}

/**
 * Carga los datos y listeners para el dashboard de Admin/Bodega.
 * (Función interna del módulo)
 */
function loadAdminDashboard(container) {
    const statsRef = doc(_db, "system", "dashboardStats");

    // Asignamos el listener a la variable global
    unsubscribeDashboard = onSnapshot(statsRef, (docSnap) => {
        if (!docSnap.exists()) {
            container.innerHTML = '<p class="text-red-500">Aún no se han generado estadísticas. Ve a "Proyectos" y presiona "Sincronizar Progreso".</p>';
            return;
        }

        const stats = docSnap.data();

        // 1. Destruir gráficos de la renderización anterior
        destroyExistingCharts();

        // 2. Renderizar el HTML (que crea los <canvas>)
        renderAdminDashboard(stats);

        // 3. Dibujar los gráficos DESPUÉS de que el HTML exista
        createDashboardCharts(stats);

    }, (error) => {
        console.error("Error al cargar estadísticas del dashboard:", error);
        container.innerHTML = '<p class="text-red-500">Error al cargar estadísticas.</p>';
    });
}

/**
 * Carga los datos y listeners para el dashboard del Operario.
 * (VERSIÓN FINAL: Con Iconos Font Awesome CORREGIDOS)
 * @param {HTMLElement} container - El div contenedor para el dashboard.
 * @param {string} userId - El ID del usuario actual.
 */
async function loadOperarioDashboard(container, userId) {
    // 1. Definir el ID del documento de estadísticas del mes actual
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const currentStatDocId = `${year}_${month}`; // Ej: "2025_11"

    // Formateador de moneda
    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
    });

    // 2. Renderizar el HTML "Shell" (la estructura)
    container.innerHTML = `
        <div class="lg:col-span-2 space-y-6">

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                <div class="p-4 bg-white rounded-lg shadow border flex items-center space-x-4">
                    <div class="flex-shrink-0 bg-yellow-500 rounded-lg w-14 h-14 flex items-center justify-center">
                         <i class="fa-solid fa-list-check text-2xl text-white"></i>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-500">Mis Tareas Pendientes</p>
                        <p id="operario-tasks-kpi" class="text-2xl font-bold text-gray-900">...</p>
                    </div>
                </div>
                <div class="p-4 bg-white rounded-lg shadow border flex items-center space-x-4">
                    <div class="flex-shrink-0 bg-blue-500 rounded-lg w-14 h-14 flex items-center justify-center">
                         <i class="fa-solid fa-hard-hat text-2xl text-white"></i>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-500">Mi Dotación Activa</p>
                        <p id="operario-dotacion-kpi" class="text-2xl font-bold text-gray-900">...</p>
                    </div>
                </div>
            </div>

            <div class="p-4 bg-white rounded-lg shadow border">
                <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">Mi Productividad (Este Mes: ${month}/${year})</h3>
                <div id="operario-productivity-kpis" class="grid grid-cols-2 md:grid-cols-3 gap-4">
                    
                    <div class="bg-gray-50 p-3 rounded-lg border text-center">
                        <p class="text-sm font-medium text-gray-600">M² Asignados</p>
                        <p id="kpi-m2-asignados" class="text-2xl font-bold text-gray-800">0.00</p>
                    </div>
                    <div class="bg-blue-50 p-3 rounded-lg border border-blue-200 text-center">
                        <p class="text-sm font-medium text-blue-800">M² Completados</p>
                        <p id="kpi-m2-completados" class="text-2xl font-bold text-blue-900">0.00</p>
                    </div>
                    
                    <div class="bg-lime-50 p-3 rounded-lg border border-lime-200 text-center">
                        <p class="text-sm font-medium text-lime-800">Bonificación (Mes)</p>
                        <p id="kpi-bonificacion-mes" class="text-2xl font-bold text-lime-900">$0</p>
                    </div>

                    <div class="bg-green-50 p-3 rounded-lg border border-green-200 text-center">
                        <p class="text-sm font-medium text-green-800">M² a Tiempo</p>
                        <p id="kpi-m2-en-tiempo" class="text-2xl font-bold text-green-900">0.00</p>
                    </div>
                    <div class="bg-red-50 p-3 rounded-lg border border-red-200 text-center">
                        <p class="text-sm font-medium text-red-800">M² Fuera de Tiempo</p>
                        <p id="kpi-m2-fuera-tiempo" class="text-2xl font-bold text-red-900">0.00</p>
                    </div>

                </div>
            </div>
            
            <div class="p-4 bg-red-50 rounded-lg shadow border-2 border-red-200">
                <h3 class="text-lg font-semibold text-red-700 border-b border-red-200 pb-2 mb-4">¡Tareas Vencidas!</h3>
                <div id="operario-overdue-tasks" class="space-y-3">
                    <p class="text-sm text-gray-500 italic">Buscando tareas vencidas...</p>
                </div>
            </div>
            
            <div class="p-4 bg-white rounded-lg shadow border">
                <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">Próximas Tareas (2)</h3>
                <div id="operario-upcoming-tasks" class="space-y-3">
                    <p class="text-sm text-gray-500 italic">Buscando tareas próximas...</p>
                </div>
            </div>
        </div>

        <div class="lg:col-span-1 space-y-6">
            
            <div class="p-4 bg-white rounded-lg shadow border">
                <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">Acciones Rápidas</h3>
                <div class="space-y-3">
                    <button data-action="go-to-tareas" class="w-full text-left p-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow">
                        Ver Mis Tareas
                    </button>
                    <button data-action="go-to-dotacion" class="w-full text-left p-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-lg border">
                        Ver Mi Dotación
                    </button>
                </div>
            </div>
            
        </div>
    `;

    // 3. Configurar los Listeners en tiempo real para este usuario
    // (Esta parte no necesita cambios, la lógica de los listeners está bien)
    const taskKpiEl = document.getElementById('operario-tasks-kpi');
    const dotacionKpiEl = document.getElementById('operario-dotacion-kpi');
    const upcomingTasksEl = document.getElementById('operario-upcoming-tasks');
    const overdueTasksEl = document.getElementById('operario-overdue-tasks');
    let listeners = [];

    // --- KPIs de Productividad ---
    const kpiM2Asignados = document.getElementById('kpi-m2-asignados');
    const kpiM2Completados = document.getElementById('kpi-m2-completados');
    const kpiM2EnTiempo = document.getElementById('kpi-m2-en-tiempo');
    const kpiM2FueraTiempo = document.getElementById('kpi-m2-fuera-tiempo');
    const kpiBonificacion = document.getElementById('kpi-bonificacion-mes');

    const qStats = doc(_db, "employeeStats", userId, "monthlyStats", currentStatDocId);
    const unsubStats = onSnapshot(qStats, (docSnap) => {
        if (docSnap.exists()) {
            const stats = docSnap.data();
            kpiM2Asignados.textContent = (stats.metrosAsignados || 0).toFixed(2);
            kpiM2Completados.textContent = (stats.metrosCompletados || 0).toFixed(2);
            kpiM2EnTiempo.textContent = (stats.metrosEnTiempo || 0).toFixed(2);
            kpiM2FueraTiempo.textContent = (stats.metrosFueraDeTiempo || 0).toFixed(2);
            kpiBonificacion.textContent = currencyFormatter.format(stats.totalBonificacion || 0);
        } else {
            kpiM2Asignados.textContent = "0.00";
            kpiM2Completados.textContent = "0.00";
            kpiM2EnTiempo.textContent = "0.00";
            kpiM2FueraTiempo.textContent = "0.00";
            kpiBonificacion.textContent = "$0";
        }
    });
    listeners.push(unsubStats);
    
    // --- Lógica de Listeners de Tareas y Dotación (Sin cambios) ---
    const qTasks = query(collection(_db, "tasks"), where("assigneeId", "==", userId), where("status", "==", "pendiente"));
    const qTasksAlt = query(collection(_db, "tasks"), where("additionalAssigneeIds", "array-contains", userId), where("status", "==", "pendiente"));
    
    let taskCount = 0;
    let taskAltCount = 0;
    
    const todayStr = new Date().toISOString().split('T')[0];
    const todayDate = new Date(todayStr + 'T12:00:00Z');

    let principalTasksMap = new Map();
    let additionalTasksMap = new Map();

    const renderTaskLists = () => {
        if (!upcomingTasksEl || !overdueTasksEl) return;
        const allTasks = [...principalTasksMap.values(), ...additionalTasksMap.values()];
        const upcomingTasks = [];
        const overdueTasks = [];
        allTasks.forEach(task => {
            if (task.dueDate) {
                const dueDate = new Date(task.dueDate + 'T12:00:00Z');
                if (dueDate < todayDate) {
                    overdueTasks.push(task);
                } else {
                    upcomingTasks.push(task);
                }
            }
        });
        overdueTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        upcomingTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        if (overdueTasks.length === 0) {
            overdueTasksEl.innerHTML = '<p class="text-sm text-green-700 font-medium">¡Estás al día! No tienes tareas vencidas.</p>';
        } else {
            overdueTasksEl.innerHTML = '';
            overdueTasks.forEach(task => {
                const dueDate = new Date(task.dueDate + 'T00:00:00');
                const diffTime = new Date().getTime() - dueDate.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                let dateText = `Vencida hace ${diffDays} días`;
                if (diffDays === 1) dateText = 'Venció Ayer';

                overdueTasksEl.innerHTML += `
                    <div data-action="view-task-details" data-id="${task.id}" class="p-3 border border-red-200 bg-white rounded-lg hover:bg-gray-50 cursor-pointer">
                        <div class="flex justify-between items-center">
                            <span class="text-sm font-semibold text-gray-800">${task.description}</span>
                            <span class="text-xs font-bold text-red-700">${dateText}</span>
                        </div>
                        <p class="text-xs text-gray-500">${task.projectName}</p>
                    </div>
                `;
            });
        }
        if (upcomingTasks.length === 0) {
            upcomingTasksEl.innerHTML = '<p class="text-sm text-gray-500 italic">No tienes tareas próximas con fecha límite.</p>';
        } else {
            upcomingTasksEl.innerHTML = '';
            upcomingTasks.slice(0, 2).forEach(task => {
                const dueDate = new Date(task.dueDate + 'T00:00:00');
                const diffTime = dueDate.getTime() - new Date().getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                let dateText = `Vence en ${diffDays} días`;
                if (diffDays === 0) dateText = 'Vence Hoy';
                if (diffDays === 1) dateText = 'Vence Mañana';
    
                upcomingTasksEl.innerHTML += `
                    <div data-action="view-task-details" data-id="${task.id}" class="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                        <div class="flex justify-between items-center">
                            <span class="text-sm font-semibold text-gray-800">${task.description}</span>
                            <span class="text-xs font-bold text-red-600">${dateText}</span>
                        </div>
                        <p class="text-xs text-gray-500">${task.projectName}</p>
                    </div>
                `;
            });
        }
    };

    const unsubTasks = onSnapshot(qTasks, (snapshot) => {
        taskCount = snapshot.size;
        if (taskKpiEl) taskKpiEl.textContent = taskCount + taskAltCount;
        principalTasksMap.clear();
        snapshot.forEach(doc => principalTasksMap.set(doc.id, { id: doc.id, ...doc.data() }));
        renderTaskLists();
    });
    
    const unsubTasksAlt = onSnapshot(qTasksAlt, (snapshot) => {
        taskAltCount = snapshot.size;
        if (taskKpiEl) taskKpiEl.textContent = taskCount + taskAltCount;
        additionalTasksMap.clear();
        snapshot.forEach(doc => additionalTasksMap.set(doc.id, { id: doc.id, ...doc.data() }));
        renderTaskLists();
    });
    listeners.push(unsubTasks, unsubTasksAlt);

    const qDotacion = query(collection(_db, "dotacionHistory"), where("userId", "==", userId), where("status", "==", "activo"));
    const unsubDotacion = onSnapshot(qDotacion, (snapshot) => {
        let totalItems = 0;
        snapshot.forEach(doc => { totalItems += (doc.data().quantity || 0); });
        if (dotacionKpiEl) dotacionKpiEl.textContent = totalItems;
    });
    listeners.push(unsubDotacion);

    // 4. Guardar los listeners en la variable global
    unsubscribeDashboard = () => {
        listeners.forEach(unsub => unsub());
    };
}

/**
 * Renderiza el HTML de los widgets (tarjetas) para el dashboard de Admin.
 * (VERSIÓN CORREGIDA: Iconos Font Awesome con tamaño 'fa-xl')
 * @param {object} stats - El objeto de estadísticas desde Firestore.
 */
function renderAdminDashboard(stats) {
    const container = document.getElementById('dashboard-widgets-container');
    if (!container) return;

    // 1. Obtenemos todos los datos
    const toolStats = stats.tools || { total: 0, disponible: 0, asignada: 0, en_reparacion: 0, topDamage: [] };
    const dotacionStats = stats.dotacion || { totalTipos: 0, totalStock: 0, totalAsignado: 0, topConsumo: [] };
    const projectStats = stats.projects || { total: 0, active: 0, archived: 0 };
    const taskStats = stats.tasks || { total: 0, pendientes: 0, completadas: 0 };
    const inventoryStats = stats.inventory || { totalValue: 0, totalTypes: 0 };
    const productivityStats = stats.productivity || { metrosAsignados: 0, metrosCompletados: 0, metrosEnTiempo: 0, metrosFueraDeTiempo: 0, totalBonificacion: 0 };

    // Formateador de moneda
    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
    });

    // Función auxiliar para renderizar las listas "Top 3"
    const usersMap = _getUsersMap();
    const renderTopList = (listData, type) => {
        if (!usersMap || usersMap.size === 0) return `<p class="text-sm text-gray-500 italic px-3">Cargando usuarios...</p>`;
        if (!listData || listData.length === 0) {
            return `<p class="text-sm text-gray-500 italic px-3">No hay datos de ${type} aún.</p>`;
        }
        return listData.map((item, index) => {
            const user = usersMap.get(item.userId);
            const userName = user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido';
            const colors = ['text-red-600', 'text-orange-500', 'text-yellow-500'];
            const bgColor = ['bg-red-100', 'bg-orange-100', 'bg-yellow-100'];

            return `
                <li class="flex items-center justify-between py-2 px-3 rounded-lg ${index < 3 ? bgColor[index] : 'bg-gray-50'}">
                    <span class="text-sm font-medium ${index < 3 ? colors[index] : 'text-gray-700'}">${index + 1}. ${userName}</span>
                    <span class="text-sm font-bold ${index < 3 ? colors[index] : 'text-gray-900'}">${item.count} ${type}</span>
                </li>`;
        }).join('');
    };
    const topDamageHtml = renderTopList(toolStats.topDamage, 'reportes');
    const topConsumoHtml = renderTopList(dotacionStats.topConsumo, 'entregas');

    // 2. Definimos el HTML con el layout 2/3 + 1/3
    container.innerHTML = `
        <div class="lg:col-span-2 space-y-6">

<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                <div class="p-4 bg-white rounded-lg shadow border flex items-center space-x-4">
                    <div class="flex-shrink-0 bg-blue-500 rounded-lg w-14 h-14 flex items-center justify-center">
                        <i class="fa-solid fa-house text-2xl text-white"></i>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-500">Proyectos Activos</p>
                        <p class="text-2xl font-bold text-gray-900">${projectStats.active}</p>
                    </div>
                </div>
                <div class="p-4 bg-white rounded-lg shadow border flex items-center space-x-4">
                    <div class="flex-shrink-0 bg-yellow-500 rounded-lg w-14 h-14 flex items-center justify-center">
                         <i class="fa-solid fa-list-check text-2xl text-white"></i>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-500">Tareas Pendientes</p>
                        <p class="text-2xl font-bold text-gray-900">${taskStats.pendientes}</p>
                    </div>
                </div>
                <div class="p-4 bg-white rounded-lg shadow border flex items-center space-x-4">
                    <div class="flex-shrink-0 bg-indigo-500 rounded-lg w-14 h-14 flex items-center justify-center">
                        <i class="fa-solid fa-dollar-sign text-2xl text-white"></i>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-500">Valor Inventario</p>
                        <p class="text-2xl font-bold text-gray-900">${currencyFormatter.format(inventoryStats.totalValue)}</p>
                    </div>
                </div>
            </div>

            <div class="p-4 bg-white rounded-lg shadow border">
                <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">Productividad Global (Histórico)</h3>
                <div id="admin-productivity-kpis" class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div class="bg-gray-50 p-3 rounded-lg border text-center">
                        <p class="text-sm font-medium text-gray-600">M² Asignados</p>
                        <p class="text-2xl font-bold text-gray-800">${(productivityStats.metrosAsignados || 0).toFixed(2)}</p>
                    </div>
                    <div class="bg-blue-50 p-3 rounded-lg border border-blue-200 text-center">
                        <p class="text-sm font-medium text-blue-800">M² Completados</p>
                        <p class="text-2xl font-bold text-blue-900">${(productivityStats.metrosCompletados || 0).toFixed(2)}</p>
                    </div>
                    <div class="bg-lime-50 p-3 rounded-lg border border-lime-200 text-center">
                        <p class="text-sm font-medium text-lime-800">Total Bonificaciones</p>
                        <p class="text-2xl font-bold text-lime-900">${currencyFormatter.format(productivityStats.totalBonificacion || 0)}</p>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="p-4 bg-white rounded-lg shadow border">
                    <h3 class="text-lg font-semibold text-gray-800 mb-4">Estado de Herramientas</h3>
                    <div class="h-64">
                        <canvas id="tools-chart-canvas"></canvas>
                    </div>
                </div>
                <div class="p-4 bg-white rounded-lg shadow border">
                    <h3 class="text-lg font-semibold text-gray-800 mb-4">Estado de Dotación</h3>
                    <div class="h-64">
                        <canvas id="dotacion-chart-canvas"></canvas>
                    </div>
                </div>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="p-4 bg-white rounded-lg shadow border">
                    <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">Top 3 Consumo Dotación</h3>
                    <ul class="space-y-2">
                        ${topConsumoHtml}
                    </ul>
                </div>
                <div class="p-4 bg-white rounded-lg shadow border">
                    <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">Top 3 Reportes de Daño</h3>
                    <ul class="space-y-2">
                        ${topDamageHtml}
                    </ul>
                </div>
            </div>
        </div>

        <div class="lg:col-span-1 space-y-6">
            
            <div class="p-4 bg-white rounded-lg shadow border">
                <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">Acciones Rápidas</h3>
                <div class="space-y-3">
                    <button data-action="new-project" class="w-full text-left p-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow">
                        + Nuevo Proyecto
                    </button>
                    <button data-action="new-purchase-order" class="w-full text-left p-3 bg-gray-700 hover:bg-gray-800 text-white font-semibold rounded-lg shadow">
                        + Nueva Orden de Compra
                    </button>
                    <button data-action="new-tool" class="w-full text-left p-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-lg border">
                        + Nueva Herramienta
                    </button>
                    <button data-action="new-dotacion-catalog-item" class="w-full text-left p-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-lg border">
                        + Nuevo Ítem de Dotación
                    </button>
                    <button data-action="add-catalog-item" class="w-full text-left p-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-lg border">
                        + Nuevo Material (Catálogo)
                    </button>
                </div>
            </div>

        </div>
    `;
}

/**
 * Destruye todas las instancias de gráficos activas.
 * (Función interna del módulo)
 */
function destroyExistingCharts() {
    activeDashboardCharts.forEach(chart => chart.destroy());
    activeDashboardCharts = [];
}

/**
 * Función auxiliar reutilizable para crear un gráfico de dona.
 * (Función interna del módulo)
 */
function createDonutChart(ctx, label, data, labels, colors) {
    if (!window.Chart) {
        console.error("Chart.js no está cargado.");
        return;
    }
    const chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                backgroundColor: colors,
                hoverOffset: 8,
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        boxWidth: 12
                    }
                }
            },
            cutout: '70%'
        }
    });
    activeDashboardCharts.push(chart);
}

/**
 * Busca los <canvas> en el HTML y dibuja los gráficos con los datos.
 * (Función interna del módulo)
 */
function createDashboardCharts(stats) {
    // 1. Gráfico de Herramientas
    const toolCtx = document.getElementById('tools-chart-canvas');
    if (toolCtx && stats.tools) {
        const ts = stats.tools;
        createDonutChart(
            toolCtx.getContext('2d'),
            'Herramientas',
            [ts.disponible, ts.asignada, ts.en_reparacion, ts.dada_de_baja],
            ['Disponibles', 'Asignadas', 'Reparación', 'De Baja'],
            ['#10B981', '#F59E0B', '#EF4444', '#6B7280']
        );
    }

    // 2. Gráfico de Dotación
    const dotacionCtx = document.getElementById('dotacion-chart-canvas');
    if (dotacionCtx && stats.dotacion) {
        const ds = stats.dotacion;
        createDonutChart(
            dotacionCtx.getContext('2d'),
            'Dotación',
            [ds.totalStock, ds.totalAsignado],
            ['En Stock (Bodega)', 'Asignado (Activo)'],
            ['#3B82F6', '#F59E0B']
        );
    }
}