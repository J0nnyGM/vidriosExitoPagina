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
    collectionGroup 
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
    
    // Loader estilizado
    widgetsContainer.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center py-20">
            <div class="loader mb-4"></div>
            <p class="text-gray-400 font-medium animate-pulse">Sincronizando panel de control...</p>
        </div>`;

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
        widgetsContainer.innerHTML = '<div class="col-span-full text-center py-20 text-gray-400">No hay un dashboard configurado para este rol.</div>';
    }
}

/**
 * Carga los datos y listeners para el dashboard de Admin/Bodega.
 */
function loadAdminDashboard(container) {
    const statsRef = doc(_db, "system", "dashboardStats");

    const unsubStats = onSnapshot(statsRef, (docSnap) => {
        if (!docSnap.exists()) {
            container.innerHTML = `
                <div class="col-span-full text-center py-20 bg-white rounded-2xl border border-gray-200 shadow-sm">
                    <i class="fa-solid fa-chart-simple text-4xl text-gray-300 mb-4"></i>
                    <p class="text-gray-600 font-bold">Sin datos estadísticos</p>
                    <p class="text-gray-400 text-sm mb-4">El sistema necesita calcular las métricas iniciales.</p>
                    <button class="text-blue-600 hover:underline text-sm font-bold">Ir a Proyectos > Sincronizar</button>
                </div>`;
            return;
        }

        const stats = docSnap.data();

        destroyExistingCharts();
        renderAdminDashboard(stats); 
        createDashboardCharts(stats); 

        // --- Contador de préstamos pendientes en tiempo real ---
        const badgeEl = document.getElementById('pending-loans-badge');
        if (badgeEl) {
            const qLoans = query(collectionGroup(_db, 'loans'), where('status', '==', 'pending'));
            onSnapshot(qLoans, (snap) => {
                const count = snap.size;
                badgeEl.textContent = count;
                if (count > 0) {
                    badgeEl.classList.remove('hidden');
                    badgeEl.classList.add('animate-bounce'); // Animación extra
                } else {
                    badgeEl.classList.add('hidden');
                    badgeEl.classList.remove('animate-bounce');
                }
            });
        }

    }, (error) => {
        console.error("Error al cargar estadísticas del dashboard:", error);
        container.innerHTML = '<p class="text-red-500 text-center py-10">Error de conexión al cargar estadísticas.</p>';
    });

    unsubscribeDashboard = unsubStats;
}

/**
 * Carga los datos y listeners para el dashboard del Operario.
 * (DISEÑO MEJORADO: Tarjetas Interactivas)
 */
async function loadOperarioDashboard(container, userId) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const currentStatDocId = `${year}_${month}`;
    const monthName = today.toLocaleString('es-CO', { month: 'long' });

    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
    });

    // HTML ESTRUCTURAL
    container.innerHTML = `
        <div class="lg:col-span-2 space-y-8">
            
            <div class="flex items-center justify-between">
                <div>
                    <h2 class="text-2xl font-bold text-gray-800">Hola, bienvenido de nuevo 👋</h2>
                    <p class="text-gray-500 text-sm">Resumen de tu actividad para <span class="capitalize font-bold text-indigo-600">${monthName}</span>.</p>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                <div data-action="go-to-tareas" class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer group relative overflow-hidden">
                    <div class="absolute right-0 top-0 w-24 h-24 bg-yellow-50 rounded-full -mr-6 -mt-6 transition-transform group-hover:scale-110"></div>
                    <div class="relative z-10">
                        <div class="w-10 h-10 rounded-xl bg-yellow-100 text-yellow-600 flex items-center justify-center text-xl mb-3">
                            <i class="fa-solid fa-list-check"></i>
                        </div>
                        <p class="text-xs font-bold text-gray-400 uppercase tracking-wide">Pendientes</p>
                        <h3 id="operario-tasks-kpi" class="text-3xl font-black text-gray-800 mt-1">--</h3>
                        <p class="text-xs text-yellow-600 font-bold mt-2 flex items-center">
                            Ver mis tareas <i class="fa-solid fa-arrow-right ml-1 transition-transform group-hover:translate-x-1"></i>
                        </p>
                    </div>
                </div>

                <div data-action="go-to-dotacion" class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer group relative overflow-hidden">
                    <div class="absolute right-0 top-0 w-24 h-24 bg-blue-50 rounded-full -mr-6 -mt-6 transition-transform group-hover:scale-110"></div>
                    <div class="relative z-10">
                        <div class="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center text-xl mb-3">
                            <i class="fa-solid fa-helmet-safety"></i>
                        </div>
                        <p class="text-xs font-bold text-gray-400 uppercase tracking-wide">Dotación Activa</p>
                        <h3 id="operario-dotacion-kpi" class="text-3xl font-black text-gray-800 mt-1">--</h3>
                        <p class="text-xs text-blue-600 font-bold mt-2 flex items-center">
                            Gestionar equipo <i class="fa-solid fa-arrow-right ml-1 transition-transform group-hover:translate-x-1"></i>
                        </p>
                    </div>
                </div>

                <div data-action="view-my-loans" class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer group relative overflow-hidden">
                    <div class="absolute right-0 top-0 w-24 h-24 bg-indigo-50 rounded-full -mr-6 -mt-6 transition-transform group-hover:scale-110"></div>
                    <div class="relative z-10">
                        <div class="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center text-xl mb-3">
                            <i class="fa-solid fa-hand-holding-dollar"></i>
                        </div>
                        <p class="text-xs font-bold text-gray-400 uppercase tracking-wide">Deuda Activa</p>
                        <h3 id="operario-loans-kpi" class="text-xl font-black text-indigo-600 mt-2">--</h3>
                        <p class="text-xs text-indigo-500 font-bold mt-2 flex items-center">
                            Ver historial <i class="fa-solid fa-arrow-right ml-1 transition-transform group-hover:translate-x-1"></i>
                        </p>
                    </div>
                </div>
            </div>

            <div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div class="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h3 class="font-bold text-gray-800 text-sm uppercase tracking-wide">Métricas de Rendimiento</h3>
                    <span class="text-xs bg-white border border-gray-200 px-2 py-1 rounded text-gray-500 font-mono">${month}/${year}</span>
                </div>
                
                <div id="operario-productivity-kpis" class="p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div class="text-center border-r border-gray-100 last:border-0">
                        <p class="text-xs text-gray-400 uppercase font-bold mb-1">M² Asignados</p>
                        <p id="kpi-m2-asignados" class="text-2xl font-black text-gray-800">0</p>
                    </div>
                    <div class="text-center border-r border-gray-100 last:border-0">
                        <p class="text-xs text-gray-400 uppercase font-bold mb-1">M² Completados</p>
                        <p id="kpi-m2-completados" class="text-2xl font-black text-blue-600">0</p>
                    </div>
                    <div class="text-center border-r border-gray-100 last:border-0">
                        <p class="text-xs text-gray-400 uppercase font-bold mb-1">Eficiencia (Tiempo)</p>
                        <p id="kpi-m2-en-tiempo" class="text-2xl font-black text-green-500">0</p>
                    </div>
                    <div class="text-center">
                        <p class="text-xs text-gray-400 uppercase font-bold mb-1">Bonificación</p>
                        <p id="kpi-bonificacion-mes" class="text-2xl font-black text-lime-600">$0</p>
                    </div>
                </div>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-red-50 rounded-2xl border border-red-100 p-5 shadow-sm">
                    <h3 class="font-bold text-red-800 text-sm flex items-center mb-4">
                        <i class="fa-solid fa-triangle-exclamation mr-2"></i> Atención Requerida
                    </h3>
                    <div id="operario-overdue-tasks" class="space-y-3">
                        <p class="text-xs text-red-400 italic">Cargando alertas...</p>
                    </div>
                </div>
                
                <div class="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                    <h3 class="font-bold text-gray-800 text-sm flex items-center mb-4">
                        <i class="fa-regular fa-calendar mr-2 text-blue-500"></i> Próximas Entregas
                    </h3>
                    <div id="operario-upcoming-tasks" class="space-y-3">
                        <p class="text-xs text-gray-400 italic">Cargando agenda...</p>
                    </div>
                </div>
            </div>
        </div>

        <div class="lg:col-span-1 space-y-6">
            <div class="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm sticky top-6">
                <h3 class="font-bold text-gray-800 text-sm uppercase tracking-wide mb-4">Menú Rápido</h3>
                <div class="space-y-3">
                    <button data-action="go-to-tareas" class="w-full flex items-center p-3 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl transition-colors text-sm group">
                         <div class="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-blue-500 mr-3 shadow-sm group-hover:scale-110 transition-transform"><i class="fa-solid fa-list-check"></i></div>
                         Ir a Mis Tareas
                    </button>
                    <button data-action="request-loan" class="w-full flex items-center p-3 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold rounded-xl transition-colors text-sm group">
                        <div class="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-gray-500 mr-3 shadow-sm group-hover:scale-110 transition-transform"><i class="fa-solid fa-hand-holding-dollar"></i></div>
                        Pedir Adelanto
                    </button>
                    <button data-action="view-my-loans" class="w-full flex items-center p-3 bg-white border border-gray-200 hover:border-gray-300 text-gray-600 font-medium rounded-xl transition-colors text-sm group">
                        <div class="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 mr-3 group-hover:text-gray-600 transition-colors"><i class="fa-solid fa-clock-rotate-left"></i></div>
                        Historial Financiero
                    </button>
                </div>
            </div>
        </div>
    `;

    // --- Lógica de Listeners (Misma que antes, solo reconectada al nuevo HTML) ---
    const taskKpiEl = document.getElementById('operario-tasks-kpi');
    const dotacionKpiEl = document.getElementById('operario-dotacion-kpi');
    const loansKpiEl = document.getElementById('operario-loans-kpi');
    const upcomingTasksEl = document.getElementById('operario-upcoming-tasks');
    const overdueTasksEl = document.getElementById('operario-overdue-tasks');
    let listeners = [];

    // 1. Stats
    const qStats = doc(_db, "employeeStats", userId, "monthlyStats", currentStatDocId);
    const unsubStats = onSnapshot(qStats, (docSnap) => {
        if (docSnap.exists()) {
            const stats = docSnap.data();
            document.getElementById('kpi-m2-asignados').textContent = (stats.metrosAsignados || 0).toFixed(1);
            document.getElementById('kpi-m2-completados').textContent = (stats.metrosCompletados || 0).toFixed(1);
            document.getElementById('kpi-m2-en-tiempo').textContent = (stats.metrosEnTiempo || 0).toFixed(1);
            // document.getElementById('kpi-m2-fuera-tiempo').textContent = ... (Opcional si quieres mostrarlo)
            document.getElementById('kpi-bonificacion-mes').textContent = currencyFormatter.format(stats.totalBonificacion || 0);
        } else {
            // Valores por defecto
            ['kpi-m2-asignados', 'kpi-m2-completados', 'kpi-m2-en-tiempo'].forEach(id => document.getElementById(id).textContent = "0");
            document.getElementById('kpi-bonificacion-mes').textContent = "$0";
        }
    });
    listeners.push(unsubStats);
    
    // 2. Tareas (Principal + Adicionales)
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
                if (dueDate < todayDate) overdueTasks.push(task);
                else upcomingTasks.push(task);
            }
        });

        // Ordenar
        overdueTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        upcomingTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        
        // Render Vencidas
        if (overdueTasks.length === 0) overdueTasksEl.innerHTML = '<div class="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded-lg"><i class="fa-solid fa-check-circle"></i> <span class="text-xs font-bold">¡Todo al día!</span></div>';
        else overdueTasksEl.innerHTML = overdueTasks.map(task => {
            const diffDays = Math.ceil((new Date().getTime() - new Date(task.dueDate + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24));
            return `
                <div data-action="view-task-details" data-id="${task.id}" class="bg-white p-3 rounded-lg border-l-4 border-red-500 shadow-sm hover:bg-red-50 cursor-pointer flex justify-between items-center group">
                    <div class="min-w-0">
                        <p class="text-xs font-bold text-gray-800 truncate group-hover:text-red-700 transition-colors">${task.description}</p>
                        <p class="text-[10px] text-red-400">Venció hace ${diffDays} días</p>
                    </div>
                    <i class="fa-solid fa-chevron-right text-gray-300 text-xs"></i>
                </div>`;
        }).join('');

        // Render Próximas
        if (upcomingTasks.length === 0) upcomingTasksEl.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Sin entregas próximas.</p>';
        else upcomingTasksEl.innerHTML = upcomingTasks.slice(0, 3).map(task => {
             const diffDays = Math.ceil((new Date(task.dueDate + 'T00:00:00').getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
             let dayLabel = diffDays === 0 ? 'Hoy' : (diffDays === 1 ? 'Mañana' : `${diffDays} días`);
             let colorClass = diffDays <= 2 ? 'text-orange-600 bg-orange-50' : 'text-blue-600 bg-blue-50';

             return `
                <div data-action="view-task-details" data-id="${task.id}" class="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg cursor-pointer border border-transparent hover:border-gray-100 transition-all">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-8 h-8 rounded-lg ${colorClass} flex items-center justify-center text-xs font-bold flex-shrink-0">
                            ${diffDays === 0 ? '!' : diffDays}
                        </div>
                        <p class="text-xs font-medium text-gray-700 truncate">${task.description}</p>
                    </div>
                    <span class="text-[10px] font-bold text-gray-400">${dayLabel}</span>
                </div>`;
        }).join('');
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

    // 3. Dotacion
    const qDotacion = query(collection(_db, "dotacionHistory"), where("userId", "==", userId), where("status", "==", "activo"));
    const unsubDotacion = onSnapshot(qDotacion, (snapshot) => {
        let totalItems = 0;
        snapshot.forEach(doc => { totalItems += (doc.data().quantity || 0); });
        if (dotacionKpiEl) dotacionKpiEl.textContent = totalItems;
    });
    listeners.push(unsubDotacion);

    // 4. Préstamos Activos
    const qLoans = query(collection(_db, "users", userId, "loans"), where("status", "==", "active"));
    const unsubLoans = onSnapshot(qLoans, (snapshot) => {
        let totalBalance = 0;
        snapshot.forEach(doc => { totalBalance += (doc.data().balance || 0); });
        if (loansKpiEl) {
            loansKpiEl.textContent = currencyFormatter.format(totalBalance);
            // Cambio de color dinámico si hay deuda
            if (totalBalance > 0) loansKpiEl.classList.replace('text-gray-400', 'text-red-600');
        }
    });
    listeners.push(unsubLoans);

    unsubscribeDashboard = () => {
        listeners.forEach(unsub => unsub());
    };
}

/**
 * Renderiza el HTML de los widgets para Admin/Bodega.
 * (DISEÑO MEJORADO: Tarjetas de KPI profesionales y Gráficos limpios)
 */
function renderAdminDashboard(stats) {
    const container = document.getElementById('dashboard-widgets-container');
    if (!container) return;

    const toolStats = stats.tools || { total: 0, disponible: 0, asignada: 0, en_reparacion: 0, topDamage: [] };
    const dotacionStats = stats.dotacion || { totalTipos: 0, totalStock: 0, totalAsignado: 0, topConsumo: [] };
    const projectStats = stats.projects || { total: 0, active: 0, archived: 0 };
    const taskStats = stats.tasks || { total: 0, pendientes: 0, completadas: 0 };
    const inventoryStats = stats.inventory || { totalValue: 0, totalTypes: 0 };
    const productivityStats = stats.productivity || { metrosAsignados: 0, metrosCompletados: 0 };

    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
    });

    const usersMap = _getUsersMap();
    
    const renderTopList = (listData, labelType) => {
        if (!listData || listData.length === 0) return `<div class="flex flex-col items-center justify-center h-32 text-gray-400"><i class="fa-regular fa-folder-open mb-2"></i><span class="text-xs">Sin datos</span></div>`;
        
        return listData.slice(0, 4).map((item, index) => {
            const user = usersMap.get(item.userId);
            const userName = user ? `${user.firstName} ${user.lastName}` : 'Desconocido';
            const initials = user ? (user.firstName[0] + user.lastName[0]) : '?';
            
            return `
                <li class="flex items-center justify-between py-3 px-0 border-b border-gray-50 last:border-0">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">${initials}</div>
                        <span class="text-sm font-medium text-gray-700">${userName}</span>
                    </div>
                    <span class="text-xs font-bold bg-gray-50 px-2 py-1 rounded text-gray-600">${item.count} ${labelType}</span>
                </li>`;
        }).join('');
    };
    const topDamageHtml = renderTopList(toolStats.topDamage, 'reportes');
    const topConsumoHtml = renderTopList(dotacionStats.topConsumo, 'entregas');

    container.innerHTML = `
        <div class="lg:col-span-2 space-y-8">

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                <div data-action="go-to-proyectos" class="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group relative overflow-hidden">
                    <div class="absolute right-0 top-0 w-32 h-32 bg-blue-50 rounded-full -mr-10 -mt-10 transition-transform group-hover:scale-110"></div>
                    <div class="relative z-10">
                        <div class="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center text-xl mb-4 shadow-lg shadow-blue-200">
                            <i class="fa-solid fa-building-columns"></i>
                        </div>
                        <p class="text-xs font-bold text-gray-400 uppercase tracking-wider">Proyectos Activos</p>
                        <h3 class="text-4xl font-black text-gray-800 mt-1">${projectStats.active}</h3>
                    </div>
                </div>

                <div data-action="go-to-tareas" class="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group relative overflow-hidden">
                    <div class="absolute right-0 top-0 w-32 h-32 bg-yellow-50 rounded-full -mr-10 -mt-10 transition-transform group-hover:scale-110"></div>
                    <div class="relative z-10">
                        <div class="w-12 h-12 rounded-xl bg-yellow-500 text-white flex items-center justify-center text-xl mb-4 shadow-lg shadow-yellow-200">
                            <i class="fa-solid fa-list-check"></i>
                        </div>
                        <p class="text-xs font-bold text-gray-400 uppercase tracking-wider">Tareas Pendientes</p>
                        <h3 class="text-4xl font-black text-gray-800 mt-1">${taskStats.pendientes}</h3>
                    </div>
                </div>

                <div data-action="go-to-catalog" class="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group relative overflow-hidden">
                    <div class="absolute right-0 top-0 w-32 h-32 bg-indigo-50 rounded-full -mr-10 -mt-10 transition-transform group-hover:scale-110"></div>
                    <div class="relative z-10">
                        <div class="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-xl mb-4 shadow-lg shadow-indigo-200">
                            <i class="fa-solid fa-vault"></i>
                        </div>
                        <p class="text-xs font-bold text-gray-400 uppercase tracking-wider">Valor Inventario</p>
                        <h3 class="text-2xl font-black text-gray-800 mt-2 truncate" title="${currencyFormatter.format(inventoryStats.totalValue)}">
                            ${currencyFormatter.format(inventoryStats.totalValue)}
                        </h3>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                <div data-action="go-to-herramientas" class="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm cursor-pointer hover:border-blue-300 transition-all">
                    <div class="flex justify-between items-center mb-6">
                        <h3 class="font-bold text-gray-800">Estado de Herramientas</h3>
                        <span class="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded font-medium">Total: ${toolStats.total}</span>
                    </div>
                    <div class="h-64 relative">
                        <canvas id="tools-chart-canvas"></canvas>
                        <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span class="text-2xl font-bold text-gray-300 opacity-20"><i class="fa-solid fa-screwdriver-wrench"></i></span>
                        </div>
                    </div>
                </div>

                <div data-action="go-to-dotacion" class="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm cursor-pointer hover:border-blue-300 transition-all">
                    <div class="flex justify-between items-center mb-6">
                        <h3 class="font-bold text-gray-800">Distribución de EPP</h3>
                         <span class="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded font-medium">Items: ${dotacionStats.totalStock}</span>
                    </div>
                    <div class="h-64 relative">
                        <canvas id="dotacion-chart-canvas"></canvas>
                         <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span class="text-2xl font-bold text-gray-300 opacity-20"><i class="fa-solid fa-helmet-safety"></i></span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                    <h3 class="font-bold text-gray-800 mb-4 flex items-center">
                        <i class="fa-solid fa-arrow-trend-up text-blue-500 mr-2"></i> Mayor Consumo (Dotación)
                    </h3>
                    <ul class="space-y-1">${topConsumoHtml}</ul>
                </div>
                
                <div class="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                    <h3 class="font-bold text-gray-800 mb-4 flex items-center">
                        <i class="fa-solid fa-circle-exclamation text-red-500 mr-2"></i> Reportes de Daño
                    </h3>
                    <ul class="space-y-1">${topDamageHtml}</ul>
                </div>
            </div>

        </div>

        <div class="lg:col-span-1 space-y-6">
            <div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm sticky top-6">
                <h3 class="font-bold text-gray-800 text-sm uppercase tracking-wide mb-5">Accesos Directos</h3>
                
                <div class="space-y-3">
                    <button data-action="new-project" class="w-full text-left p-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center group">
                        <div class="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center mr-3"><i class="fa-solid fa-plus"></i></div>
                        Nuevo Proyecto
                    </button>

                    <button data-action="new-task" class="w-full text-left p-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center group">
                        <div class="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center mr-3"><i class="fa-solid fa-list-check"></i></div>
                        Nueva Tarea
                    </button>
                    
                    <button data-action="new-purchase-order" class="w-full text-left p-4 bg-gray-800 hover:bg-gray-900 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center group">
                         <div class="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center mr-3"><i class="fa-solid fa-cart-plus"></i></div>
                        Orden de Compra
                    </button>

                    <div class="h-px bg-gray-100 my-4"></div>

                    <button data-action="view-pending-loans" class="w-full text-left p-3 bg-white border-2 border-red-50 hover:border-red-200 text-gray-700 font-semibold rounded-xl transition-all flex items-center justify-between group hover:bg-red-50/50">
                        <span class="flex items-center"><i class="fa-solid fa-bell text-red-400 mr-3 group-hover:text-red-600"></i> Préstamos</span>
                        <span id="pending-loans-badge" class="hidden bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">0</span>
                    </button>

                     <button data-action="new-tool" class="w-full text-left p-3 bg-gray-50 hover:bg-gray-100 text-gray-600 font-medium rounded-xl transition-all flex items-center">
                        <i class="fa-solid fa-screwdriver text-gray-400 mr-3"></i> Crear Herramienta
                    </button>
                    
                    <button data-action="new-dotacion-catalog-item" class="w-full text-left p-3 bg-gray-50 hover:bg-gray-100 text-gray-600 font-medium rounded-xl transition-all flex items-center">
                        <i class="fa-solid fa-helmet-safety text-gray-400 mr-3"></i> Nuevo Ítem Dotación
                    </button>
                    
                    <button data-action="add-catalog-item" class="w-full text-left p-3 bg-gray-50 hover:bg-gray-100 text-gray-600 font-medium rounded-xl transition-all flex items-center">
                        <i class="fa-solid fa-box text-gray-400 mr-3"></i> Crear Material
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
    
    // Configuración visual mejorada para Chart.js
    const chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                backgroundColor: colors,
                hoverOffset: 10,
                borderWidth: 0, // Sin bordes blancos
                borderRadius: 5, // Bordes redondeados en los segmentos
                cutout: '75%' // Agujero más grande
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'bottom', 
                    labels: { 
                        usePointStyle: true, 
                        padding: 20, 
                        font: { size: 11, family: 'sans-serif' },
                        color: '#6B7280'
                    } 
                },
                tooltip: {
                    backgroundColor: '#1F2937',
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false
                }
            },
            animation: {
                animateScale: true,
                animateRotate: true
            }
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
            ['#10B981', '#F59E0B', '#EF4444', '#9CA3AF']
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