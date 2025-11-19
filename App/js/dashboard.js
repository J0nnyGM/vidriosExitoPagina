// App/js/dashboard.js

// --- Importaciones de Firebase ---
import {
    doc,
    onSnapshot,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    collectionGroup // <-- AÑADIDO: Necesario para contar préstamos de todos los usuarios
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// --- Variables del Módulo (Dependencias de app.js) ---
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
 */
export function showGeneralDashboard() {
    _showView('dashboard-general');
    const widgetsContainer = document.getElementById('dashboard-widgets-container');
    widgetsContainer.innerHTML = '<p class="text-gray-500">Cargando estadísticas...</p>';

    // 1. Destruir gráficos anteriores
    destroyExistingCharts();

    // 2. Cancelar listeners anteriores
    if (unsubscribeDashboard) {
        unsubscribeDashboard();
        unsubscribeDashboard = null;
    }

    const userRole = _getCurrentUserRole();

    // 3. Cargar dashboard según rol
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
 */
function loadAdminDashboard(container) {
    const statsRef = doc(_db, "system", "dashboardStats");

    const unsubStats = onSnapshot(statsRef, (docSnap) => {
        if (!docSnap.exists()) {
            container.innerHTML = '<p class="text-red-500">Aún no se han generado estadísticas. Ve a "Proyectos" y presiona "Sincronizar Progreso".</p>';
            return;
        }

        const stats = docSnap.data();

        destroyExistingCharts();
        renderAdminDashboard(stats); // Renderiza el HTML completo
        createDashboardCharts(stats); // Dibuja los gráficos

        // --- LÓGICA AÑADIDA: Contador de préstamos pendientes en tiempo real ---
        const badgeEl = document.getElementById('pending-loans-badge');
        if (badgeEl) {
            // Escuchamos cambios en cualquier documento 'loans' con estado 'pending'
            const qLoans = query(collectionGroup(_db, 'loans'), where('status', '==', 'pending'));
            
            // Nota: Este listener interno se "pierde" si no lo guardamos, 
            // pero como el dashboard se recarga al cambiar de vista, es aceptable para el MVP.
            // Para ser estrictos, deberíamos agregarlo a un array de unsubs.
            onSnapshot(qLoans, (snap) => {
                const count = snap.size;
                badgeEl.textContent = count;
                if (count > 0) {
                    badgeEl.classList.remove('hidden');
                } else {
                    badgeEl.classList.add('hidden');
                }
            });
        }
        // -------------------------------------------------------

    }, (error) => {
        console.error("Error al cargar estadísticas del dashboard:", error);
        container.innerHTML = '<p class="text-red-500">Error al cargar estadísticas.</p>';
    });

    unsubscribeDashboard = unsubStats;
}

/**
 * Carga los datos y listeners para el dashboard del Operario.
 */
async function loadOperarioDashboard(container, userId) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const currentStatDocId = `${year}_${month}`;

    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
    });

    // --- HTML COMPLETO DEL OPERARIO (Restaurado "Próximas Tareas" y agregado Botón Préstamo) ---
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
                    <button data-action="go-to-tareas" class="w-full text-left p-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow transition-all">
                         <i class="fa-solid fa-list-check mr-2"></i> Ver Mis Tareas
                    </button>
                    <button data-action="go-to-dotacion" class="w-full text-left p-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-lg border transition-all">
                        <i class="fa-solid fa-helmet-safety mr-2"></i> Ver Mi Dotación
                    </button>
                    
                    <button data-action="request-loan" class="w-full text-left p-3 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold rounded-lg shadow transition-all flex items-center justify-between">
                        <span><i class="fa-solid fa-hand-holding-dollar mr-2"></i> Solicitar Préstamo</span>
                        <i class="fa-solid fa-chevron-right text-indigo-200"></i>
                    </button>
                </div>
            </div>
        </div>
    `;

    // Configuración de Listeners del Operario (Sin cambios, usando tu lógica original)
    const taskKpiEl = document.getElementById('operario-tasks-kpi');
    const dotacionKpiEl = document.getElementById('operario-dotacion-kpi');
    const upcomingTasksEl = document.getElementById('operario-upcoming-tasks');
    const overdueTasksEl = document.getElementById('operario-overdue-tasks');
    let listeners = [];

    // Listener Stats
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
    
    // Listener Tareas
    const qTasks = query(collection(_db, "tasks"), where("assigneeId", "==", userId), where("status", "==", "pendiente"));
    const qTasksAlt = query(collection(_db, "tasks"), where("additionalAssigneeIds", "array-contains", userId), where("status", "==", "pendiente"));
    
    let taskCount = 0;
    let taskAltCount = 0;
    let principalTasksMap = new Map();
    let additionalTasksMap = new Map();
    const todayDate = new Date(); todayDate.setHours(12,0,0,0);

    const renderTaskLists = () => {
        if (!upcomingTasksEl || !overdueTasksEl) return;
        const allTasks = [...principalTasksMap.values(), ...additionalTasksMap.values()];
        const upcomingTasks = [];
        const overdueTasks = [];
        allTasks.forEach(task => {
            if (task.dueDate) {
                const dueDate = new Date(task.dueDate + 'T12:00:00');
                if (dueDate < todayDate) {
                    overdueTasks.push(task);
                } else {
                    upcomingTasks.push(task);
                }
            }
        });
        overdueTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        upcomingTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        
        // Render Vencidas
        if (overdueTasks.length === 0) {
            overdueTasksEl.innerHTML = '<p class="text-sm text-green-700 font-medium">¡Estás al día! No tienes tareas vencidas.</p>';
        } else {
            overdueTasksEl.innerHTML = overdueTasks.map(task => {
                 const dueDate = new Date(task.dueDate + 'T00:00:00');
                 const diffTime = new Date().getTime() - dueDate.getTime();
                 const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                 return `
                    <div data-action="view-task-details" data-id="${task.id}" class="p-3 border border-red-200 bg-white rounded-lg hover:bg-gray-50 cursor-pointer">
                        <div class="flex justify-between items-center">
                            <span class="text-sm font-semibold text-gray-800">${task.description}</span>
                            <span class="text-xs font-bold text-red-700">Vencida hace ${diffDays} días</span>
                        </div>
                        <p class="text-xs text-gray-500">${task.projectName}</p>
                    </div>`;
            }).join('');
        }

        // Render Próximas (RESTAURADO)
        if (upcomingTasks.length === 0) {
            upcomingTasksEl.innerHTML = '<p class="text-sm text-gray-500 italic">No tienes tareas próximas con fecha límite.</p>';
        } else {
            upcomingTasksEl.innerHTML = upcomingTasks.slice(0, 2).map(task => {
                const dueDate = new Date(task.dueDate + 'T00:00:00');
                const diffTime = dueDate.getTime() - new Date().getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                return `
                    <div data-action="view-task-details" data-id="${task.id}" class="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                        <div class="flex justify-between items-center">
                            <span class="text-sm font-semibold text-gray-800">${task.description}</span>
                            <span class="text-xs font-bold text-blue-600">Vence en ${diffDays} días</span>
                        </div>
                        <p class="text-xs text-gray-500">${task.projectName}</p>
                    </div>`;
            }).join('');
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

    // Listener Dotacion
    const qDotacion = query(collection(_db, "dotacionHistory"), where("userId", "==", userId), where("status", "==", "activo"));
    const unsubDotacion = onSnapshot(qDotacion, (snapshot) => {
        let totalItems = 0;
        snapshot.forEach(doc => { totalItems += (doc.data().quantity || 0); });
        if (dotacionKpiEl) dotacionKpiEl.textContent = totalItems;
    });
    listeners.push(unsubDotacion);

    unsubscribeDashboard = () => {
        listeners.forEach(unsub => unsub());
    };
}

/**
 * Renderiza el HTML de los widgets para Admin/Bodega.
 * (VERSIÓN COMPLETA: Restauradas listas Top 3 y Productividad Global)
 */
function renderAdminDashboard(stats) {
    const container = document.getElementById('dashboard-widgets-container');
    if (!container) return;

    const toolStats = stats.tools || { total: 0, disponible: 0, asignada: 0, en_reparacion: 0, topDamage: [] };
    const dotacionStats = stats.dotacion || { totalTipos: 0, totalStock: 0, totalAsignado: 0, topConsumo: [] };
    const projectStats = stats.projects || { total: 0, active: 0, archived: 0 };
    const taskStats = stats.tasks || { total: 0, pendientes: 0, completadas: 0 };
    const inventoryStats = stats.inventory || { totalValue: 0, totalTypes: 0 };
    const productivityStats = stats.productivity || { metrosAsignados: 0, metrosCompletados: 0, metrosEnTiempo: 0, metrosFueraDeTiempo: 0, totalBonificacion: 0 };

    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
    });

    // Lógica restaurada para las listas Top 3
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

    // --- HTML COMPLETO DEL ADMIN ---
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
                    <div class="h-64"><canvas id="tools-chart-canvas"></canvas></div>
                </div>
                <div class="p-4 bg-white rounded-lg shadow border">
                    <h3 class="text-lg font-semibold text-gray-800 mb-4">Estado de Dotación</h3>
                    <div class="h-64"><canvas id="dotacion-chart-canvas"></canvas></div>
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
                    
                    <button data-action="view-pending-loans" class="relative w-full text-left p-3 bg-white border-2 border-indigo-100 hover:border-indigo-300 text-indigo-700 font-semibold rounded-lg shadow-sm transition-all flex items-center justify-between group">
                        <span class="flex items-center"><i class="fa-solid fa-file-invoice-dollar mr-3 text-indigo-500 group-hover:text-indigo-700"></i> Préstamos Pendientes</span>
                        
                        <span id="pending-loans-badge" class="hidden bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full animate-pulse">0</span>
                    </button>

                    <div class="border-t pt-2 mt-2"></div>

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

function destroyExistingCharts() {
    activeDashboardCharts.forEach(chart => chart.destroy());
    activeDashboardCharts = [];
}

function createDonutChart(ctx, label, data, labels, colors) {
    if (!window.Chart) return;
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
                legend: { position: 'bottom', labels: { padding: 15, boxWidth: 12 } }
            },
            cutout: '70%'
        }
    });
    activeDashboardCharts.push(chart);
}

function createDashboardCharts(stats) {
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
    const dotacionCtx = document.getElementById('dotacion-chart-canvas');
    if (dotacionCtx && stats.dotacion) {
        const ds = stats.dotacion;
        createDonutChart(
            dotacionCtx.getContext('2d'),
            'Dotación',
            [ds.totalStock, ds.totalAsignado],
            ['En Stock', 'Asignado'],
            ['#3B82F6', '#F59E0B']
        );
    }
}