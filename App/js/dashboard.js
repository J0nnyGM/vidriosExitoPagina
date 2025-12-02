import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js"; // <--- Necesario para llamar al backend
import {
    collection,
    query,
    where,
    getDocs,
    orderBy,
    limit,
    startAfter,
    collectionGroup,
    doc,
    getDoc,
    onSnapshot
    // setDoc Eliminado: El frontend solo lee, no escribe en system.
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
// Variable global para controlar las gráficas de este módulo
let activeModuleCharts = [];

export function showGeneralDashboard() {
    _showView('dashboard-general');
    const widgetsContainer = document.getElementById('dashboard-widgets-container');
    
    widgetsContainer.className = 'space-y-8';
    widgetsContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center h-64 text-gray-400">
            <div class="loader mb-4"></div>
            <p class="animate-pulse">Cargando panel de control...</p>
        </div>
    `;

    // 1. Limpieza de Gráficas previas
    if (activeModuleCharts.length > 0) {
        activeModuleCharts.forEach(chart => chart.destroy());
        activeModuleCharts = [];
    }

    // 2. Cancelar listeners anteriores
    if (typeof unsubscribeDashboard === 'function' && unsubscribeDashboard) {
        unsubscribeDashboard();
        unsubscribeDashboard = null;
    }

    const userRole = _getCurrentUserRole();

    // 3. Renderizado por Rol
    if (userRole === 'admin') {
        loadAdminDashboard(widgetsContainer);
    } 
    else if (userRole === 'bodega') {
        renderBodegaDashboard(widgetsContainer);
    } 
    else if (userRole === 'sst') {
        renderSSTDashboard(widgetsContainer);
    } 
    else if (userRole === 'operario') {
        loadOperarioDashboard(widgetsContainer, _getCurrentUserId());
    } 
    else {
        widgetsContainer.innerHTML = `
            <div class="p-8 text-center bg-white rounded-2xl shadow-sm border border-gray-200">
                <i class="fa-solid fa-user-lock text-4xl text-gray-300 mb-3"></i>
                <p class="text-gray-500">No hay un dashboard configurado para este rol.</p>
            </div>`;
    }
}

/**
 * Carga los datos y listeners para el dashboard de Admin/Bodega.
 */
function loadAdminDashboard(container) {
    const statsRef = doc(_db, "system", "dashboardStats");

    const unsubStats = onSnapshot(statsRef, (docSnap) => {
        
        // --- LÓGICA DE AUTO-INICIALIZACIÓN VÍA BACKEND ---
        if (!docSnap.exists()) {
            console.warn("⚠️ Dashboard sin datos. Solicitando recálculo al servidor...");
            
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-64 text-gray-400">
                    <div class="loader mb-4"></div>
                    <p class="animate-pulse text-blue-600 font-medium">Obteniendo datos del servidor...</p>
                    <p class="text-xs text-gray-400 mt-2">(Calculando estadísticas reales)</p>
                </div>
            `;

            // En lugar de crear datos falsos/vacíos aquí, llamamos a la función del backend
            // que cuenta los datos REALES y crea el documento.
            const functions = getFunctions(getApp(), 'us-central1');
            const runRecalculation = httpsCallable(functions, 'runFullRecalculation');

            runRecalculation()
                .then(() => console.log("✅ Servidor completó la inicialización."))
                .catch((error) => {
                    console.error("❌ Error al solicitar inicialización:", error);
                    container.innerHTML = `
                        <div class="p-6 bg-red-50 border border-red-200 rounded-xl text-center">
                            <p class="text-red-600 font-bold">No se pudo conectar con el servidor.</p>
                            <p class="text-xs mt-1">${error.message}</p>
                        </div>`;
                });
                
            return; // Salimos y esperamos a que el onSnapshot se dispare de nuevo con los datos
        }
        // -------------------------------------------------

        const stats = docSnap.data();

        destroyExistingCharts();
        renderAdminDashboard(stats, container);
        createDashboardCharts(stats);

        // Listener de préstamos pendientes
        const badgeEl = document.getElementById('pending-loans-badge');
        if (badgeEl) {
            const qLoans = query(collectionGroup(_db, 'loans'), where('status', '==', 'pending'));
            onSnapshot(qLoans, (snap) => {
                const count = snap.size;
                badgeEl.textContent = count;
                badgeEl.classList.toggle('hidden', count === 0);
            });
        }

    }, (error) => {
        if (error.code === 'permission-denied') return;
        console.error("Error dashboard:", error);
        container.innerHTML = `<p class="text-red-500 bg-red-50 p-4 rounded-lg">Error de conexión: ${error.message}</p>`;
    });

    unsubscribeDashboard = unsubStats;
}


/**
 * Renderiza el HTML moderno para Admin/Bodega.
 */
function renderAdminDashboard(stats, container) {
    const toolStats = stats.tools || { total: 0, disponible: 0, asignada: 0, en_reparacion: 0, topDamage: [] };
    const dotacionStats = stats.dotacion || { totalTipos: 0, totalStock: 0, totalAsignado: 0, topConsumo: [] };
    const projectStats = stats.projects || { total: 0, active: 0, archived: 0 };
    const taskStats = stats.tasks || { total: 0, pendientes: 0, completadas: 0 };
    const inventoryStats = stats.inventory || { totalValue: 0, totalTypes: 0 };
    const productivityStats = stats.productivity || { metrosAsignados: 0, metrosCompletados: 0, totalBonificacion: 0 };

    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
    });

    // Helper para listas Top
    const usersMap = _getUsersMap();
    const renderTopList = (listData, type) => {
        if (!usersMap || usersMap.size === 0) return `<p class="text-xs text-gray-400 italic p-4 text-center">Cargando usuarios...</p>`;
        if (!listData || listData.length === 0) return `<div class="flex flex-col items-center justify-center py-8 text-gray-400"><i class="fa-regular fa-folder-open text-2xl mb-2 opacity-50"></i><p class="text-xs">Sin datos de ${type}</p></div>`;

        return `<ul class="divide-y divide-gray-100">
            ${listData.map((item, index) => {
            const user = usersMap.get(item.userId);
            const userName = user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido';
            const initials = userName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const medalColor = index === 0 ? 'text-yellow-500' : (index === 1 ? 'text-gray-400' : 'text-orange-400');

            return `
                <li class="flex items-center justify-between py-3 px-1 hover:bg-slate-50 transition-colors rounded-lg group">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 border border-slate-200">
                            ${initials}
                        </div>
                        <div class="flex flex-col">
                            <span class="text-sm font-semibold text-slate-700">${userName}</span>
                            <span class="text-[10px] text-slate-400 flex items-center gap-1">
                                <i class="fa-solid fa-trophy ${medalColor} text-[9px]"></i> Top ${index + 1}
                            </span>
                        </div>
                    </div>
                    <span class="text-sm font-bold text-slate-800 bg-white border border-slate-200 px-2 py-1 rounded-md shadow-sm group-hover:border-indigo-200 group-hover:text-indigo-600 transition-all">
                        ${item.count}
                    </span>
                </li>`;
        }).join('')}
        </ul>`;
    };

    const topDamageHtml = renderTopList(toolStats.topDamage, 'daños');
    const topConsumoHtml = renderTopList(dotacionStats.topConsumo, 'entregas');

    // --- ESTRUCTURA PRINCIPAL ---
    container.innerHTML = `
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
            <div>
                <h1 class="text-2xl font-extrabold text-slate-800 tracking-tight">Vista General</h1>
                <p class="text-slate-500 text-sm">Resumen operativo y financiero en tiempo real.</p>
            </div>
            <div class="flex items-center gap-2 bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
                <span class="px-3 py-1 text-xs font-bold text-green-700 bg-green-50 rounded-md flex items-center gap-2">
                    <span class="relative flex h-2 w-2">
                      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    Sistema Online
                </span>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            <div class="lg:col-span-2 space-y-6">
                
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    
                    <div data-action="go-to-proyectos" class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer group relative overflow-hidden">
                        <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110">
                            <i class="fa-solid fa-building text-6xl text-blue-600"></i>
                        </div>
                        <div class="relative z-10">
                            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center shadow-lg mb-3">
                                <i class="fa-solid fa-house text-sm"></i>
                            </div>
                            <p class="text-2xl font-black text-slate-800 tracking-tight">${projectStats.active}</p>
                            <p class="text-xs font-bold text-slate-400 uppercase tracking-wide mt-1">Proyectos Activos</p>
                        </div>
                    </div>

                    <div data-action="go-to-tareas" class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md hover:border-yellow-300 transition-all cursor-pointer group relative overflow-hidden">
                        <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110">
                            <i class="fa-solid fa-list-check text-6xl text-yellow-500"></i>
                        </div>
                        <div class="relative z-10">
                            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500 text-white flex items-center justify-center shadow-lg mb-3">
                                <i class="fa-solid fa-clipboard-list text-sm"></i>
                            </div>
                            <p class="text-2xl font-black text-slate-800 tracking-tight">${taskStats.pendientes}</p>
                            <p class="text-xs font-bold text-slate-400 uppercase tracking-wide mt-1">Tareas Pendientes</p>
                        </div>
                    </div>

                    <div data-action="go-to-catalog" class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer group relative overflow-hidden">
                        <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110">
                            <i class="fa-solid fa-coins text-6xl text-indigo-600"></i>
                        </div>
                        <div class="relative z-10">
                            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-lg mb-3">
                                <i class="fa-solid fa-sack-dollar text-sm"></i>
                            </div>
                            <p class="text-xl font-black text-slate-800 tracking-tight truncate">${currencyFormatter.format(inventoryStats.totalValue)}</p>
                            <p class="text-xs font-bold text-slate-400 uppercase tracking-wide mt-1">Valor Inventario</p>
                        </div>
                    </div>
                </div>

                <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div class="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                        <h3 class="font-bold text-slate-700 flex items-center gap-2">
                            <i class="fa-solid fa-chart-line text-blue-500"></i> Productividad Global
                        </h3>
                        <span class="text-[10px] font-bold text-slate-400 bg-white px-2 py-1 rounded border border-slate-200">HISTÓRICO</span>
                    </div>
                    <div class="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                        <div class="text-center px-2">
                            <p class="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">M² Asignados</p>
                            <p class="text-3xl font-black text-slate-800">${(productivityStats.metrosAsignados || 0).toFixed(0)}</p>
                        </div>
                        <div class="text-center px-2 pt-4 md:pt-0">
                            <p class="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">M² Completados</p>
                            <p class="text-3xl font-black text-blue-600">${(productivityStats.metrosCompletados || 0).toFixed(0)}</p>
                        </div>
                        <div class="text-center px-2 pt-4 md:pt-0">
                            <p class="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Total Bonificaciones</p>
                            <p class="text-3xl font-black text-lime-600 truncate" title="${currencyFormatter.format(productivityStats.totalBonificacion || 0)}">
                                ${currencyFormatter.format(productivityStats.totalBonificacion || 0)}
                            </p>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div data-action="go-to-herramientas" class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 cursor-pointer hover:border-emerald-300 transition-all group">
                        <div class="flex justify-between items-center mb-4">
                            <h3 class="font-bold text-slate-700 flex items-center gap-2">
                                <i class="fa-solid fa-screwdriver-wrench text-emerald-500"></i> Herramientas
                            </h3>
                            <i class="fa-solid fa-arrow-right text-slate-300 group-hover:text-emerald-500 transition-colors"></i>
                        </div>
                        <div class="h-48"><canvas id="tools-chart-canvas"></canvas></div>
                    </div>
                    <div data-action="go-to-dotacion" class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 cursor-pointer hover:border-cyan-300 transition-all group">
                        <div class="flex justify-between items-center mb-4">
                            <h3 class="font-bold text-slate-700 flex items-center gap-2">
                                <i class="fa-solid fa-helmet-safety text-cyan-500"></i> Dotación
                            </h3>
                            <i class="fa-solid fa-arrow-right text-slate-300 group-hover:text-cyan-500 transition-colors"></i>
                        </div>
                        <div class="h-48"><canvas id="dotacion-chart-canvas"></canvas></div>
                    </div>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div class="px-5 py-3 bg-slate-50 border-b border-slate-100">
                            <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wide">Top Consumo Dotación</h3>
                        </div>
                        <div class="p-2">${topConsumoHtml}</div>
                    </div>
                    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div class="px-5 py-3 bg-slate-50 border-b border-slate-100">
                            <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wide">Top Reportes Daño</h3>
                        </div>
                        <div class="p-2">${topDamageHtml}</div>
                    </div>
                </div>
            </div>

            <div class="lg:col-span-1 space-y-6">
                <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 sticky top-4">
                    <h3 class="font-bold text-slate-700 mb-4 flex items-center gap-2">
                        <i class="fa-solid fa-bolt text-yellow-400"></i> Acciones Rápidas
                    </h3>
                    
                    <div class="space-y-3">
                        <button data-action="new-project" class="w-full text-left p-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold rounded-xl shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all flex items-center">
                            <div class="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center mr-3">
                                <i class="fa-solid fa-plus"></i>
                            </div>
                            Nuevo Proyecto
                        </button>
                        
                        <button data-action="new-purchase-order" class="w-full text-left p-3 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 font-bold rounded-xl transition-all flex items-center shadow-sm">
                            <div class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center mr-3 text-slate-500">
                                <i class="fa-solid fa-cart-plus"></i>
                            </div>
                            Orden de Compra
                        </button>

                        <button data-action="view-pending-loans" class="w-full text-left p-3 bg-white border border-indigo-100 hover:border-indigo-300 text-indigo-800 font-bold rounded-xl shadow-sm transition-all flex items-center justify-between group relative overflow-hidden">
                            <div class="flex items-center z-10">
                                <div class="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center mr-3 text-indigo-600 group-hover:scale-110 transition-transform">
                                    <i class="fa-solid fa-hand-holding-dollar"></i>
                                </div>
                                Revisar Préstamos
                            </div>
                            <span id="pending-loans-badge" class="hidden bg-red-500 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full shadow-sm animate-pulse z-10">0</span>
                            <div class="absolute inset-0 bg-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        </button>

                        <div class="bg-white p-6 rounded-xl shadow-sm border border-red-100 hover:shadow-md transition-all group cursor-pointer relative overflow-hidden" data-action="send-admin-alert">
                            <div class="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                <i class="fa-solid fa-bullhorn text-6xl text-red-600 transform rotate-12"></i>
                            </div>
                            
                            <div class="flex items-center gap-4 relative z-10">
                                <div class="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                                    <i class="fa-solid fa-bell"></i>
                                </div>
                                <div>
                                    <h3 class="text-lg font-bold text-gray-800 group-hover:text-red-600 transition-colors">Llamado Urgente</h3>
                                    <p class="text-xs text-gray-500">Enviar alerta de pantalla completa</p>
                                </div>
                            </div>
                        </div>
                                            
                        <div class="my-4 border-t border-slate-100"></div>

                        <div class="grid grid-cols-2 gap-3">
                            <button data-action="new-tool" class="flex flex-col items-center justify-center p-3 bg-gray-50 hover:bg-white border border-gray-200 hover:border-emerald-400 rounded-xl transition-all text-gray-600 hover:text-emerald-600 group">
                                <i class="fa-solid fa-toolbox text-xl mb-1 group-hover:scale-110 transition-transform"></i>
                                <span class="text-[10px] font-bold uppercase">Herramienta</span>
                            </button>
                            <button data-action="new-dotacion-catalog-item" class="flex flex-col items-center justify-center p-3 bg-gray-50 hover:bg-white border border-gray-200 hover:border-cyan-400 rounded-xl transition-all text-gray-600 hover:text-cyan-600 group">
                                <i class="fa-solid fa-shirt text-xl mb-1 group-hover:scale-110 transition-transform"></i>
                                <span class="text-[10px] font-bold uppercase">Dotación</span>
                            </button>
                             <button data-action="add-catalog-item" class="col-span-2 flex items-center justify-center p-3 bg-gray-50 hover:bg-white border border-gray-200 hover:border-indigo-400 rounded-xl transition-all text-gray-600 hover:text-indigo-600 gap-2 group">
                                <i class="fa-solid fa-box-open group-hover:scale-110 transition-transform"></i>
                                <span class="text-xs font-bold uppercase">Material (Catálogo)</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

}

/**
 * Carga los datos y listeners para el dashboard del Operario (Diseño Moderno + Botón Ingreso).
 */
async function loadOperarioDashboard(container, userId) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');

    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
    });

    container.innerHTML = `


        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">

            <div class="lg:col-span-2 space-y-6">

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    
                    <div data-action="go-to-tareas" class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 hover:border-yellow-400 hover:shadow-md transition-all cursor-pointer group">
                        <div class="flex items-center gap-4">
                            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500 text-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                                <i class="fa-solid fa-list-check text-lg"></i>
                            </div>
                            <div>
                                <p class="text-xs font-bold text-slate-400 uppercase tracking-wide">Pendientes</p>
                                <p id="operario-tasks-kpi" class="text-2xl font-black text-slate-800">...</p>
                            </div>
                        </div>
                    </div>

                    <div data-action="go-to-dotacion" class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 hover:border-cyan-400 hover:shadow-md transition-all cursor-pointer group">
                         <div class="flex items-center gap-4">
                            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 text-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                                <i class="fa-solid fa-hard-hat text-lg"></i>
                            </div>
                            <div>
                                <p class="text-xs font-bold text-slate-400 uppercase tracking-wide">Dotación</p>
                                <p id="operario-dotacion-kpi" class="text-2xl font-black text-slate-800">...</p>
                            </div>
                        </div>
                    </div>

                    <div data-action="view-my-loans" class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 hover:border-indigo-400 hover:shadow-md transition-all cursor-pointer group">
                         <div class="flex items-center gap-4">
                            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 text-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                                <i class="fa-solid fa-hand-holding-dollar text-lg"></i>
                            </div>
                            <div>
                                <p class="text-xs font-bold text-slate-400 uppercase tracking-wide">Deuda</p>
                                <p id="operario-loans-kpi" class="text-lg font-black text-indigo-600 truncate">...</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div class="px-5 py-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                         <h3 class="font-bold text-slate-700 flex items-center gap-2">
                            <i class="fa-solid fa-chart-pie text-blue-500"></i> Mi Productividad
                        </h3>
                        <span class="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-1 rounded border border-blue-200">${month}/${year}</span>
                    </div>
                    
                    <div id="operario-productivity-kpis" class="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
                         <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 text-center">
                            <p class="text-[10px] font-bold text-slate-400 uppercase">Asignados</p>
                            <p id="kpi-m2-asignados" class="text-xl font-black text-slate-700 mt-1">0.00</p>
                            <span class="text-[10px] text-slate-400">m²</span>
                        </div>
                        <div class="bg-blue-50 p-3 rounded-xl border border-blue-100 text-center">
                            <p class="text-[10px] font-bold text-blue-400 uppercase">Completados</p>
                            <p id="kpi-m2-completados" class="text-xl font-black text-blue-700 mt-1">0.00</p>
                            <span class="text-[10px] text-blue-400">m²</span>
                        </div>
                        <div class="bg-lime-50 p-3 rounded-xl border border-lime-100 text-center col-span-2 sm:col-span-1">
                            <p class="text-[10px] font-bold text-lime-600 uppercase">Bonificación</p>
                            <p id="kpi-bonificacion-mes" class="text-xl font-black text-lime-700 mt-1">$0</p>
                            <span class="text-[10px] text-lime-500">estimada</span>
                        </div>
                        
                        <div class="col-span-2 sm:col-span-3 grid grid-cols-2 gap-4 mt-2 pt-4 border-t border-slate-100">
                             <div class="text-center">
                                <p class="text-[10px] font-bold text-green-600 uppercase mb-1">A Tiempo</p>
                                <span id="kpi-m2-en-tiempo" class="bg-green-100 text-green-800 px-3 py-1 rounded-lg font-bold text-sm">0.00</span>
                             </div>
                             <div class="text-center">
                                <p class="text-[10px] font-bold text-red-500 uppercase mb-1">Fuera Tiempo</p>
                                <span id="kpi-m2-fuera-tiempo" class="bg-red-50 text-red-600 px-3 py-1 rounded-lg font-bold text-sm">0.00</span>
                             </div>
                        </div>
                    </div>
                </div>
                
                <div class="bg-red-50 rounded-2xl shadow-sm border border-red-100 overflow-hidden">
                    <div class="px-5 py-3 bg-red-100/50 border-b border-red-100">
                        <h3 class="text-xs font-bold text-red-700 uppercase tracking-wide flex items-center gap-2">
                            <i class="fa-solid fa-circle-exclamation"></i> Tareas Vencidas
                        </h3>
                    </div>
                    <div id="operario-overdue-tasks" class="p-4 space-y-2">
                        <p class="text-xs text-gray-400 italic text-center">Cargando...</p>
                    </div>
                </div>
                
                <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                     <div class="px-5 py-3 bg-slate-50 border-b border-slate-100">
                        <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wide">Próximas Tareas</h3>
                    </div>
                    <div id="operario-upcoming-tasks" class="p-4 space-y-2">
                         <p class="text-xs text-gray-400 italic text-center">Cargando...</p>
                    </div>
                </div>
            </div>

            <div class="lg:col-span-1 space-y-6">
                <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 sticky top-4">
                    <h3 class="font-bold text-slate-700 mb-4 flex items-center gap-2">
                         <i class="fa-solid fa-bolt text-yellow-400"></i> Acciones Rápidas
                    </h3>
                    
                    <div class="space-y-3">
                        

                        <div class="my-4 border-t border-slate-100"></div>

                        <button data-action="go-to-tareas" class="w-full text-left p-3 bg-blue-50 hover:bg-blue-100 border border-blue-100 text-blue-700 font-bold rounded-xl transition-all flex items-center gap-3">
                             <i class="fa-solid fa-list-check text-xl opacity-80"></i>
                             <span class="text-sm">Ver Mis Tareas</span>
                        </button>
                        
                        <button data-action="go-to-dotacion" class="w-full text-left p-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-xl shadow-sm transition-all flex items-center gap-3">
                            <i class="fa-solid fa-helmet-safety text-cyan-600 text-xl"></i>
                            <span class="text-sm">Ver Mi Dotación</span>
                        </button>
                        
                        <button data-action="request-loan" class="w-full text-left p-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 font-bold rounded-xl transition-all flex items-center justify-between group">
                            <div class="flex items-center gap-3">
                                <i class="fa-solid fa-hand-holding-dollar text-xl group-hover:scale-110 transition-transform"></i>
                                <span class="text-sm">Solicitar Préstamo</span>
                            </div>
                            <i class="fa-solid fa-chevron-right text-xs opacity-50"></i>
                        </button>

                        <button data-action="view-my-loans" class="w-full text-left p-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 font-bold rounded-xl transition-all flex items-center justify-between">
                            <span class="text-xs">Historial Préstamos</span>
                            <i class="fa-solid fa-clock-rotate-left text-gray-400"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Iniciar listeners y lógica
    startOperarioListeners(userId);
}

// Variable global para saber qué acción está realizando la cámara
let currentCameraAction = null;

// ------------------------------------------------------------------
// NUEVA FUNCIÓN: Manejar Reporte de Ingreso
// ------------------------------------------------------------------
async function handleReportEntry() {
    // 1. Verificar si el usuario tiene foto de perfil registrada para comparar
    if (!userData || !userData.profilePhotoURL) {
        alert("Error: No tienes una foto de perfil registrada. Por favor, actualiza tu perfil primero para usar el reconocimiento facial.");
        return;
    }

    // 2. Establecer el contexto de la cámara
    currentCameraAction = 'entry_report';

    // 3. Abrir el modal de cámara existente
    // (Reutilizamos tu modal 'confirm-modal' o 'main-modal' adaptado para cámara)
    // Asumimos que tienes una función para abrir la vista de cámara, si no, usamos la lógica estándar:

    // NOTA: Aquí reutilizamos la lógica que ya tenías para editar perfil, 
    // pero cambiamos el título y comportamiento.

    const modal = document.getElementById('main-modal');
    const modalTitle = document.getElementById('main-modal-title');
    const modalBody = document.getElementById('main-modal-body');
    const modalFooter = document.getElementById('main-modal-footer'); // Si existe

    if (modalTitle) modalTitle.textContent = "Verificación Biométrica de Ingreso";

    // Inyectamos el HTML de la cámara en el modal
    modalBody.innerHTML = `
        <div class="flex flex-col items-center justify-center space-y-4">
            <div class="relative w-full max-w-md aspect-square bg-black rounded-2xl overflow-hidden shadow-lg border-4 border-emerald-500">
                <video id="camera-video" autoplay playsinline class="w-full h-full object-cover transform scale-x-[-1]"></video>
                <canvas id="camera-canvas" class="absolute top-0 left-0 w-full h-full hidden"></canvas>
                
                <div class="absolute inset-0 border-2 border-white/30 rounded-full m-12 pointer-events-none border-dashed"></div>
                <div class="absolute bottom-4 left-0 right-0 text-center text-white text-xs bg-black/50 py-1">
                    Ubica tu rostro en el centro
                </div>
            </div>
            
            <div id="camera-controls" class="flex gap-4">
                <button id="capture-entry-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2 transition-all transform hover:scale-105">
                    <i class="fa-solid fa-camera"></i> Validar Ingreso
                </button>
                <button type="button" onclick="closeMainModal()" class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-3 rounded-full font-bold">
                    Cancelar
                </button>
            </div>
            
            <div id="entry-status-msg" class="text-sm font-bold text-gray-600 h-6"></div>
        </div>
    `;

    openMainModal('camera_entry'); // Usamos un ID lógico para que el switch de modals sepa qué hacer si es necesario

    // 4. Iniciar Cámara
    const video = document.getElementById('camera-video');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = stream;
        // Guardamos el stream para cerrarlo después
        video.dataset.stream = "active";
    } catch (err) {
        console.error("Error cámara:", err);
        alert("No se pudo acceder a la cámara. Verifica los permisos.");
        closeMainModal();
        return;
    }

    // 5. Listener del botón Capturar
    document.getElementById('capture-entry-btn').addEventListener('click', async () => {
        const btn = document.getElementById('capture-entry-btn');
        const statusMsg = document.getElementById('entry-status-msg');

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';
        statusMsg.textContent = "Obteniendo ubicación y validando rostro...";
        statusMsg.className = "text-sm font-bold text-blue-600 h-6 animate-pulse";

        try {
            // A. Obtener Ubicación GPS
            const location = await getCurrentLocation();

            // B. Capturar Foto del Video
            const canvas = document.getElementById('camera-canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0); // Dibujar frame actual

            // Convertir a Blob
            const photoBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));

            // C. Reconocimiento Facial (Comparación)
            statusMsg.textContent = "Verificando identidad...";

            // Cargamos la imagen de referencia (del perfil)
            const refImg = await faceapi.fetchImage(userData.profilePhotoURL);
            const detectionsRef = await faceapi.detectSingleFace(refImg).withFaceLandmarks().withFaceDescriptor();

            if (!detectionsRef) {
                throw new Error("No se pudo detectar un rostro claro en tu foto de perfil registrada.");
            }

            // Detectar rostro en la foto actual (canvas)
            // Nota: faceapi puede leer directamente del elemento HTML video o canvas
            const detectionsCurrent = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor();

            if (!detectionsCurrent) {
                throw new Error("No se detecta un rostro en la cámara. Acércate más.");
            }

            // Calcular distancia (Similitud)
            const faceMatcher = new faceapi.FaceMatcher(detectionsRef);
            const match = faceMatcher.findBestMatch(detectionsCurrent.descriptor);

            console.log("Resultado FaceAPI:", match.toString());

            // Umbral de seguridad (0.6 es el estándar, menor es más estricto)
            if (match.distance > 0.6) {
                throw new Error("Validación fallida: El rostro no coincide con el usuario registrado.");
            }

            // D. Si todo es válido, subir foto y guardar registro
            statusMsg.textContent = "Guardando registro...";
            statusMsg.className = "text-sm font-bold text-emerald-600 h-6";

            // Subir foto de evidencia a Storage
            const filename = `attendance/${currentUser.uid}_${Date.now()}.jpg`;
            const storageRefObj = ref(storage, filename);
            await uploadBytes(storageRefObj, photoBlob);
            const evidenceURL = await getDownloadURL(storageRefObj);

            // Guardar en Firestore
            await addDoc(collection(db, "attendance_reports"), {
                userId: currentUser.uid,
                userName: `${userData.firstName} ${userData.lastName}`,
                role: currentUserRole,
                timestamp: serverTimestamp(),
                location: {
                    lat: location.coords.latitude,
                    lng: location.coords.longitude,
                    accuracy: location.coords.accuracy
                },
                photoURL: evidenceURL,
                matchScore: match.distance, // Guardamos qué tan preciso fue el match
                type: 'ingreso'
            });

            // Éxito
            alert(`✅ Ingreso reportado exitosamente.\nUbicación: ${location.coords.latitude.toFixed(4)}, ${location.coords.longitude.toFixed(4)}`);
            closeMainModal();

        } catch (error) {
            console.error("Error en reporte:", error);
            statusMsg.textContent = "Error: " + error.message;
            statusMsg.className = "text-sm font-bold text-red-600 h-6";
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Reintentar';
        }
    });
}

// Función auxiliar para prometer la geolocalización
function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("La geolocalización no es soportada por tu navegador."));
        } else {
            navigator.geolocation.getCurrentPosition(resolve, (err) => {
                let msg = "Error de ubicación desconocido.";
                switch (err.code) {
                    case err.PERMISSION_DENIED: msg = "Usuario denegó el acceso a la ubicación."; break;
                    case err.POSITION_UNAVAILABLE: msg = "Información de ubicación no disponible."; break;
                    case err.TIMEOUT: msg = "Se agotó el tiempo para obtener ubicación."; break;
                }
                reject(new Error(msg));
            }, {
                enableHighAccuracy: true, // Pedir GPS preciso
                timeout: 10000,
                maximumAge: 0
            });
        }
    });
}

// Asegurarnos de limpiar la cámara al cerrar modal
const originalCloseMainModal = window.closeMainModal; // Guardamos la original si existe globalmente
window.closeMainModal = function () {
    const video = document.getElementById('camera-video');
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }
    // Llamar a la función original de cierre (lógica de ocultar div)
    const modal = document.getElementById('main-modal');
    if (modal) modal.classList.add('hidden');
    // Restaurar cualquier estado necesario
    currentCameraAction = null;
};


/**
 * Inicializa los listeners de Firestore para el dashboard de Operario.
 * Conecta los datos en tiempo real con el nuevo diseño moderno.
 */
function startOperarioListeners(userId) {
    // 1. Referencias al DOM (KPIs y Listas)
    const taskKpiEl = document.getElementById('operario-tasks-kpi');
    const dotacionKpiEl = document.getElementById('operario-dotacion-kpi');
    const loansKpiEl = document.getElementById('operario-loans-kpi');

    const upcomingTasksEl = document.getElementById('operario-upcoming-tasks');
    const overdueTasksEl = document.getElementById('operario-overdue-tasks');

    // Referencias a Productividad
    const kpiM2Asignados = document.getElementById('kpi-m2-asignados');
    const kpiM2Completados = document.getElementById('kpi-m2-completados');
    const kpiM2EnTiempo = document.getElementById('kpi-m2-en-tiempo');
    const kpiM2FueraTiempo = document.getElementById('kpi-m2-fuera-tiempo');
    const kpiBonificacion = document.getElementById('kpi-bonificacion-mes');

    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
    });

    // Array para guardar los desuscriptores locales
    let listeners = [];

    // --- A. LISTENER DE PRODUCTIVIDAD (Mes Actual) ---
    const today = new Date();
    const currentStatDocId = `${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}`;

    if (kpiM2Asignados) {
        const qStats = doc(_db, "employeeStats", userId, "monthlyStats", currentStatDocId);
        const unsubStats = onSnapshot(qStats, (docSnap) => {
            if (docSnap.exists()) {
                const stats = docSnap.data();
                kpiM2Asignados.textContent = (stats.metrosAsignados || 0).toFixed(2);
                kpiM2Completados.textContent = (stats.metrosCompletados || 0).toFixed(2);

                // Actualizamos los elementos adicionales si existen en el nuevo diseño
                if (kpiM2EnTiempo) kpiM2EnTiempo.textContent = (stats.metrosEnTiempo || 0).toFixed(2);
                if (kpiM2FueraTiempo) kpiM2FueraTiempo.textContent = (stats.metrosFueraDeTiempo || 0).toFixed(2);

                kpiBonificacion.textContent = currencyFormatter.format(stats.totalBonificacion || 0);
            } else {
                // Valores por defecto si no hay datos este mes
                kpiM2Asignados.textContent = "0.00";
                kpiM2Completados.textContent = "0.00";
                if (kpiM2EnTiempo) kpiM2EnTiempo.textContent = "0.00";
                if (kpiM2FueraTiempo) kpiM2FueraTiempo.textContent = "0.00";
                kpiBonificacion.textContent = "$0";
            }
        }, (error) => { if (error.code !== 'permission-denied') console.error("Error stats:", error); });

        listeners.push(unsubStats);
    }

    // --- B. LISTENERS DE TAREAS (Principal + Adicional) ---
    // Usamos dos mapas para evitar duplicados si el usuario está en ambas listas de una tarea
    let principalTasksMap = new Map();
    let additionalTasksMap = new Map();
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0); // Inicio del día para comparar fechas

    // Función de renderizado (se ejecuta cada vez que cambia algo en las tareas)
    const renderTaskLists = () => {
        if (!upcomingTasksEl || !overdueTasksEl) return;

        // Combinar mapas
        const allTasks = [...principalTasksMap.values(), ...additionalTasksMap.values()];

        // Actualizar KPI Total
        if (taskKpiEl) taskKpiEl.textContent = allTasks.length;

        // Separar en Vencidas y Próximas
        const upcomingTasks = [];
        const overdueTasks = [];

        allTasks.forEach(task => {
            if (task.dueDate) {
                // Ajuste simple de zona horaria para comparación
                const dueDate = new Date(task.dueDate + 'T00:00:00');
                if (dueDate < todayDate) overdueTasks.push(task);
                else upcomingTasks.push(task);
            } else {
                // Tareas sin fecha van a próximas (al final)
                upcomingTasks.push(task);
            }
        });

        // Ordenar por fecha
        overdueTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)); // Las más antiguas primero
        upcomingTasks.sort((a, b) => {
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate) - new Date(b.dueDate); // Las más cercanas primero
        });

        // 1. Renderizar VENCIDAS
        if (overdueTasks.length === 0) {
            overdueTasksEl.innerHTML = `
                <div class="flex flex-col items-center justify-center py-4 text-green-600">
                    <i class="fa-solid fa-check-circle text-2xl mb-1"></i>
                    <p class="text-xs font-bold">¡Estás al día!</p>
                </div>`;
        } else {
            overdueTasksEl.innerHTML = overdueTasks.map(task => {
                const diffDays = Math.ceil((new Date().getTime() - new Date(task.dueDate + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24));
                return `
                <div data-action="view-task-details" data-id="${task.id}" class="p-3 bg-white border border-red-100 rounded-xl shadow-sm hover:shadow hover:border-red-200 cursor-pointer group transition-all flex justify-between items-center">
                    <div class="min-w-0 pr-2">
                        <p class="text-sm font-bold text-slate-700 truncate group-hover:text-red-600 transition-colors">${task.description}</p>
                        <p class="text-[10px] text-slate-400 truncate">${task.projectName || 'Proyecto'}</p>
                    </div>
                    <span class="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-md whitespace-nowrap flex items-center">
                        <i class="fa-solid fa-clock mr-1"></i> ${diffDays}d
                    </span>
                </div>`;
            }).join('');
        }

        // 2. Renderizar PRÓXIMAS (Máx 4)
        if (upcomingTasks.length === 0) {
            upcomingTasksEl.innerHTML = '<p class="text-xs text-gray-400 italic text-center py-4">No hay tareas pendientes.</p>';
        } else {
            upcomingTasksEl.innerHTML = upcomingTasks.slice(0, 4).map(task => {
                let dateBadge = '';

                if (task.dueDate) {
                    const diffTime = new Date(task.dueDate + 'T00:00:00').getTime() - todayDate.getTime();
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    let colorClass = 'text-slate-500 bg-slate-50 border-slate-200';
                    let text = `${diffDays} días`;

                    if (diffDays === 0) { text = 'Hoy'; colorClass = 'text-orange-600 bg-orange-50 border-orange-100 font-bold'; }
                    else if (diffDays === 1) { text = 'Mañana'; colorClass = 'text-blue-600 bg-blue-50 border-blue-100 font-bold'; }

                    dateBadge = `<span class="text-[10px] px-2 py-0.5 rounded border ${colorClass}">${text}</span>`;
                } else {
                    dateBadge = `<span class="text-[10px] text-slate-400 px-2">Sin fecha</span>`;
                }

                return `
                <div data-action="view-task-details" data-id="${task.id}" class="p-3 bg-white border border-slate-100 rounded-xl hover:border-blue-300 hover:shadow-sm cursor-pointer transition-all flex justify-between items-center group">
                    <div class="min-w-0 pr-2 flex items-center gap-2">
                        <div class="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0 group-hover:scale-125 transition-transform"></div>
                        <span class="text-sm font-medium text-slate-600 truncate group-hover:text-slate-900">${task.description}</span>
                    </div>
                    ${dateBadge}
                </div>`;
            }).join('');
        }
    };

    // Querys
    const qTasks = query(collection(_db, "tasks"), where("assigneeId", "==", userId), where("status", "==", "pendiente"));
    const qTasksAlt = query(collection(_db, "tasks"), where("additionalAssigneeIds", "array-contains", userId), where("status", "==", "pendiente"));

    const unsubTasks = onSnapshot(qTasks, (snapshot) => {
        principalTasksMap.clear();
        snapshot.forEach(doc => principalTasksMap.set(doc.id, { id: doc.id, ...doc.data() }));
        renderTaskLists();
    }, (error) => { if (error.code !== 'permission-denied') console.error("Error tasks:", error); });

    const unsubTasksAlt = onSnapshot(qTasksAlt, (snapshot) => {
        additionalTasksMap.clear();
        snapshot.forEach(doc => additionalTasksMap.set(doc.id, { id: doc.id, ...doc.data() }));
        renderTaskLists();
    }, (error) => { if (error.code !== 'permission-denied') console.error("Error alt tasks:", error); });

    listeners.push(unsubTasks, unsubTasksAlt);

    // --- C. LISTENER DOTACIÓN (Total Ítems) ---
    if (dotacionKpiEl) {
        const qDotacion = query(collection(_db, "dotacionHistory"), where("userId", "==", userId), where("status", "==", "activo"));
        const unsubDotacion = onSnapshot(qDotacion, (snapshot) => {
            let totalItems = 0;
            snapshot.forEach(doc => { totalItems += (doc.data().quantity || 0); });
            dotacionKpiEl.textContent = totalItems;
        }, (error) => { if (error.code !== 'permission-denied') console.error("Error dotacion:", error); });
        listeners.push(unsubDotacion);
    }

    // --- D. LISTENER PRÉSTAMOS (Saldo Total) ---
    if (loansKpiEl) {
        const qLoans = query(collection(_db, "users", userId, "loans"), where("status", "==", "active"));
        const unsubLoans = onSnapshot(qLoans, (snapshot) => {
            let totalBalance = 0;
            snapshot.forEach(doc => { totalBalance += (doc.data().balance || 0); });

            loansKpiEl.textContent = currencyFormatter.format(totalBalance);

            // Estilo dinámico: Indigo si hay deuda, Gris si no
            if (totalBalance > 0) {
                loansKpiEl.classList.remove('text-slate-800');
                loansKpiEl.classList.add('text-indigo-600');
            } else {
                loansKpiEl.classList.add('text-slate-800');
                loansKpiEl.classList.remove('text-indigo-600');
            }
        }, (error) => { if (error.code !== 'permission-denied') console.error("Error loans:", error); });
        listeners.push(unsubLoans);
    }

    // Función de limpieza global para este módulo
    unsubscribeDashboard = () => {
        listeners.forEach(unsub => unsub());
        listeners = [];
    };
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
                hoverOffset: 4,
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        font: { size: 10, family: "'Inter', sans-serif" },
                        boxWidth: 10,
                        usePointStyle: true
                    }
                }
            },
            cutout: '75%',
            layout: { padding: 10 }
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
            ['Disp.', 'Asig.', 'Rep.', 'Baja'],
            ['#10B981', '#F59E0B', '#EF4444', '#94A3B8']
        );
    }
    const dotacionCtx = document.getElementById('dotacion-chart-canvas');
    if (dotacionCtx && stats.dotacion) {
        const ds = stats.dotacion;
        createDonutChart(
            dotacionCtx.getContext('2d'),
            'Dotación',
            [ds.totalStock, ds.totalAsignado],
            ['Stock', 'Asig.'],
            ['#3B82F6', '#F59E0B']
        );
    }
}

/**
 * Renderiza el Dashboard para BODEGA con KPIs INTERACTIVOS.
 */
async function renderBodegaDashboard(container) {
    const dateStr = new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const capitalizedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

    container.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center py-12 h-96">
            <div class="loader mb-4"></div>
            <p class="text-gray-400 font-medium animate-pulse">Sincronizando inventario...</p>
        </div>`;

    try {
        // 1. Consultas de Datos
        const [requestsSnap, poSnap, catalogSnap] = await Promise.all([
            getDocs(query(collectionGroup(_db, 'materialRequests'), where("status", "==", "pendiente"))),
            getDocs(query(collection(_db, "purchaseOrders"), where("status", "==", "pendiente"))),
            getDocs(collection(_db, "materialCatalog"))
        ]);

        const pendingRequests = requestsSnap.size;
        const pendingPO = poSnap.size;
        let lowStockCount = 0;
        let healthyStockCount = 0;
        let totalRefs = 0;
        
        catalogSnap.forEach(doc => {
            totalRefs++;
            const item = doc.data();
            if ((item.quantityInStock || 0) <= (item.minStockThreshold || 5)) {
                lowStockCount++;
            } else {
                healthyStockCount++;
            }
        });

        // 2. Renderizado HTML Estructurado
        container.innerHTML = `
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-800 tracking-tight">Panel de Bodega</h1>
                    <p class="text-slate-500 mt-1 text-sm">Gestión logística e inventario.</p>
                </div>
                <div class="bg-white px-5 py-2.5 rounded-xl shadow-sm border border-slate-200 text-sm text-slate-600 font-medium flex items-center gap-3">
                    <div class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <i class="fa-regular fa-calendar text-slate-400"></i> ${capitalizedDate}
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
                
                <div class="lg:col-span-9 space-y-6">
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6">
                        
                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between relative overflow-hidden group hover:shadow-md transition-all cursor-pointer" data-action="go-to-proyectos">
                            <div class="absolute right-0 top-0 p-4 opacity-5 transform group-hover:scale-110 transition-transform"><i class="fa-solid fa-dolly text-8xl text-blue-600"></i></div>
                            <div>
                                <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 group-hover:text-blue-600 transition-colors">Por Despachar</p>
                                <h3 class="text-4xl font-black text-slate-800">${pendingRequests}</h3>
                                <p class="text-xs text-blue-600 font-medium mt-2 flex items-center gap-1">
                                    Solicitudes pendientes <i class="fa-solid fa-arrow-right opacity-0 group-hover:opacity-100 transition-opacity"></i>
                                </p>
                            </div>
                            <div class="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                                <i class="fa-solid fa-clipboard-list"></i>
                            </div>
                        </div>

                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between hover:shadow-md transition-all cursor-pointer group" data-action="go-to-catalog">
                            <div>
                                <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 group-hover:text-amber-600 transition-colors">Stock Crítico</p>
                                <h3 class="text-4xl font-black text-slate-800">${lowStockCount}</h3>
                                <p class="text-xs text-amber-600 font-medium mt-2 flex items-center gap-1">
                                    Ítems bajo mínimo <i class="fa-solid fa-arrow-right opacity-0 group-hover:opacity-100 transition-opacity"></i>
                                </p>
                            </div>
                            <div class="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                                <i class="fa-solid fa-triangle-exclamation"></i>
                            </div>
                        </div>

                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between hover:shadow-md transition-all cursor-pointer group" data-action="go-to-compras">
                            <div>
                                <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 group-hover:text-emerald-600 transition-colors">Entradas</p>
                                <h3 class="text-4xl font-black text-slate-800">${pendingPO}</h3>
                                <p class="text-xs text-emerald-600 font-medium mt-2 flex items-center gap-1">
                                    Órdenes por recibir <i class="fa-solid fa-arrow-right opacity-0 group-hover:opacity-100 transition-opacity"></i>
                                </p>
                            </div>
                            <div class="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                                <i class="fa-solid fa-truck-ramp-box"></i>
                            </div>
                        </div>

                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between hover:shadow-md transition-all cursor-pointer group" data-action="go-to-catalog">
                            <div>
                                <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 group-hover:text-indigo-600 transition-colors">Total Referencias</p>
                                <h3 class="text-4xl font-black text-slate-800">${totalRefs}</h3>
                                <p class="text-xs text-indigo-600 font-medium mt-2 flex items-center gap-1">
                                    Catálogo activo <i class="fa-solid fa-arrow-right opacity-0 group-hover:opacity-100 transition-opacity"></i>
                                </p>
                            </div>
                            <div class="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                                <i class="fa-solid fa-tags"></i>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-8 items-center">
                        <div class="flex-1 w-full">
                            <h4 class="text-lg font-bold text-slate-700 mb-2">Salud del Inventario</h4>
                            <p class="text-sm text-slate-500 mb-6">Proporción de ítems con stock suficiente vs crítico.</p>
                            
                            <div class="flex gap-4 mb-4">
                                <div class="flex-1 bg-green-50 border border-green-100 p-3 rounded-xl">
                                    <p class="text-xs text-green-600 font-bold uppercase">Saludable</p>
                                    <p class="text-2xl font-black text-green-800">${healthyStockCount}</p>
                                </div>
                                <div class="flex-1 bg-amber-50 border border-amber-100 p-3 rounded-xl">
                                    <p class="text-xs text-amber-600 font-bold uppercase">Crítico</p>
                                    <p class="text-2xl font-black text-amber-800">${lowStockCount}</p>
                                </div>
                            </div>
                        </div>
                        <div class="w-full md:w-64 h-64 relative flex items-center justify-center">
                            <canvas id="bodega-stock-chart"></canvas>
                        </div>
                    </div>
                </div>

                <div class="lg:col-span-3 space-y-6">
                    <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 h-full">
                        <h3 class="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2 uppercase tracking-wide border-b pb-3">
                            <i class="fa-solid fa-bolt text-yellow-500"></i> Acciones Rápidas
                        </h3>
                        
                        <div class="space-y-3">
                            <button data-action="send-admin-alert" class="w-full flex items-center gap-3 p-3 rounded-xl bg-red-50 text-red-700 hover:bg-red-100 hover:shadow-md transition-all text-left group border border-red-100">
                                <div class="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform text-red-500"><i class="fa-solid fa-bullhorn"></i></div>
                                <div><p class="font-bold text-sm">Llamado Urgente</p><p class="text-[10px] opacity-75">Alerta</p></div>
                            </button>

                            <button data-action="go-to-proyectos" class="w-full flex items-center gap-3 p-3 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 hover:shadow-md transition-all text-left group border border-blue-100">
                                <div class="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform text-blue-500"><i class="fa-solid fa-dolly"></i></div>
                                <div><p class="font-bold text-sm">Despachar Material</p><p class="text-[10px] opacity-75">Solicitudes</p></div>
                            </button>

                            <button data-action="go-to-catalog" class="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-50 text-slate-700 hover:bg-slate-100 hover:shadow-md transition-all text-left group border border-slate-200">
                                <div class="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform text-indigo-500"><i class="fa-solid fa-boxes-stacked"></i></div>
                                <div><p class="font-bold text-sm">Inventario</p><p class="text-[10px] opacity-75">Stock</p></div>
                            </button>

                            <button data-action="go-to-compras" class="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-50 text-slate-700 hover:bg-slate-100 hover:shadow-md transition-all text-left group border border-slate-200">
                                <div class="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform text-emerald-500"><i class="fa-solid fa-file-invoice-dollar"></i></div>
                                <div><p class="font-bold text-sm">Compras</p><p class="text-[10px] opacity-75">Proveedores</p></div>
                            </button>

                            <button data-action="go-to-herramientas" class="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-50 text-slate-700 hover:bg-slate-100 hover:shadow-md transition-all text-left group border border-slate-200">
                                <div class="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform text-orange-500"><i class="fa-solid fa-screwdriver-wrench"></i></div>
                                <div><p class="font-bold text-sm">Herramientas</p><p class="text-[10px] opacity-75">Préstamos</p></div>
                            </button>
                            
                            <button data-action="request-loan" class="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-50 text-slate-700 hover:bg-slate-100 hover:shadow-md transition-all text-left group border border-slate-200">
                                <div class="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform text-gray-500"><i class="fa-solid fa-hand-holding-dollar"></i></div>
                                <div><p class="font-bold text-sm">Préstamo</p><p class="text-[10px] opacity-75">Personal</p></div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 3. Crear Gráfica
        const ctx = document.getElementById('bodega-stock-chart').getContext('2d');
        const chart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Stock Saludable', 'Stock Bajo'],
                datasets: [{
                    data: [healthyStockCount, lowStockCount],
                    backgroundColor: ['#10b981', '#f59e0b'], 
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                cutout: '70%'
            }
        });
        activeModuleCharts.push(chart);

    } catch (error) {
        console.error("Error Dashboard Bodega:", error);
        container.innerHTML = `<p class="text-red-500 text-center">Error cargando datos: ${error.message}</p>`;
    }
}

/**
 * Renderiza el Dashboard para SST con diseño de columnas y Gráfica de Herramientas CORREGIDA.
 */
async function renderSSTDashboard(container) {
    const dateStr = new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const capitalizedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

    container.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center py-12 h-96">
            <div class="loader mb-4"></div>
            <p class="text-gray-400 font-medium animate-pulse">Verificando seguridad...</p>
        </div>`;

    try {
        // 1. CONSULTAS (Recuperamos la consulta de estadísticas globales para la gráfica)
        const [statsDoc, dotacionSnap, usersSnap, catalogSnap] = await Promise.all([
            getDoc(doc(_db, "system/dashboardStats")), // <--- ESTA FALTABA
            getDocs(query(collection(_db, "dotacionHistory"), where("status", "==", "activo"))),
            getDocs(query(collection(_db, "users"), where("status", "==", "active"))),
            getDocs(collection(_db, "dotacionCatalog"))
        ]);

        // 2. PROCESAR DATOS
        // Extraer estadísticas de herramientas para la GRÁFICA y el KPI
        const statsData = statsDoc.exists() ? statsDoc.data() : {};
        const toolStats = statsData.tools || { disponible: 0, asignada: 0, en_reparacion: 0, dada_de_baja: 0 };
        
        // KPI: Equipos en Riesgo (Reparación + Baja)
        const toolsIssues = (toolStats.en_reparacion || 0) + (toolStats.dada_de_baja || 0);
        
        const activePersonnel = usersSnap.size;

        // Calcular Dotación Vencida (KPI)
        let expiredDotacionCount = 0;
        const vidaUtilMap = new Map();
        catalogSnap.forEach(d => vidaUtilMap.set(d.id, d.data().vidaUtilDias || 0));

        const today = new Date();
        dotacionSnap.forEach(doc => {
            const entry = doc.data();
            const vidaUtil = vidaUtilMap.get(entry.itemId);
            if (vidaUtil && entry.fechaEntrega) {
                const deliveryDate = new Date(entry.fechaEntrega + 'T00:00:00');
                const expDate = new Date(deliveryDate);
                expDate.setDate(expDate.getDate() + vidaUtil);
                const daysLeft = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
                if (daysLeft <= 15) expiredDotacionCount++;
            }
        });

        // 3. RENDERIZADO HTML
        container.innerHTML = `
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div>
                    <h1 class="text-3xl font-extrabold text-slate-800 tracking-tight">Panel SST</h1>
                    <p class="text-slate-500 mt-1 text-sm">Seguridad y Salud en el Trabajo.</p>
                </div>
                <div class="bg-white px-5 py-2.5 rounded-xl shadow-sm border border-slate-200 text-sm text-slate-600 font-medium flex items-center gap-3">
                    <div class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <i class="fa-regular fa-calendar text-slate-400"></i> ${capitalizedDate}
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
                
                <div class="lg:col-span-9 space-y-6">
                    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        
                        <div class="bg-white p-6 rounded-2xl shadow-sm border ${expiredDotacionCount > 0 ? 'border-red-100 bg-red-50/30' : 'border-slate-100'} flex items-center justify-between hover:shadow-md transition-all cursor-pointer group" data-action="go-to-dotacion">
                            <div>
                                <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 group-hover:text-blue-600 transition-colors">Alertas EPP</p>
                                <h3 class="text-4xl font-black ${expiredDotacionCount > 0 ? 'text-red-700' : 'text-slate-800'}">${expiredDotacionCount}</h3>
                                <p class="text-xs text-slate-500 mt-2 flex items-center gap-1 group-hover:text-blue-500">
                                    Dotación por vencer <i class="fa-solid fa-arrow-right opacity-0 group-hover:opacity-100 transition-opacity"></i>
                                </p>
                            </div>
                            <div class="w-16 h-16 rounded-2xl ${expiredDotacionCount > 0 ? 'bg-red-100 text-red-600' : 'bg-blue-50 text-blue-600'} flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                                <i class="fa-solid fa-helmet-safety"></i>
                            </div>
                        </div>

                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between hover:shadow-md transition-all cursor-pointer group" data-action="go-to-herramientas">
                            <div>
                                <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 group-hover:text-orange-600 transition-colors">Equipos Riesgo</p>
                                <h3 class="text-4xl font-black text-slate-800">${toolsIssues}</h3>
                                <p class="text-xs text-orange-600 font-medium mt-2 flex items-center gap-1">
                                    Reparación / Baja <i class="fa-solid fa-arrow-right opacity-0 group-hover:opacity-100 transition-opacity"></i>
                                </p>
                            </div>
                            <div class="w-16 h-16 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                                <i class="fa-solid fa-screwdriver-wrench"></i>
                            </div>
                        </div>

                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between hover:shadow-md transition-all cursor-pointer group" data-action="back-to-empleados">
                            <div>
                                <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 group-hover:text-emerald-600 transition-colors">Personal Activo</p>
                                <h3 class="text-4xl font-black text-slate-800">${activePersonnel}</h3>
                                <p class="text-xs text-emerald-600 font-medium mt-2 flex items-center gap-1">
                                    En operación hoy <i class="fa-solid fa-arrow-right opacity-0 group-hover:opacity-100 transition-opacity"></i>
                                </p>
                            </div>
                            <div class="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                                <i class="fa-solid fa-users"></i>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-8 items-center">
                        <div class="flex-1 w-full">
                            <h4 class="text-lg font-bold text-slate-700 mb-2">Estado del Parque de Herramientas</h4>
                            <p class="text-sm text-slate-500 mb-6">Distribución actual de equipos y maquinaria.</p>
                            
                            <ul class="space-y-3 text-sm">
                                <li class="flex justify-between items-center p-2 bg-green-50 rounded-lg border border-green-100">
                                    <span class="flex items-center text-green-700 font-medium"><span class="w-2 h-2 rounded-full bg-green-500 mr-2"></span>Disponibles</span> 
                                    <span class="font-bold text-green-800 text-lg">${toolStats.disponible || 0}</span>
                                </li>
                                <li class="flex justify-between items-center p-2 bg-blue-50 rounded-lg border border-blue-100">
                                    <span class="flex items-center text-blue-700 font-medium"><span class="w-2 h-2 rounded-full bg-blue-500 mr-2"></span>Asignadas</span> 
                                    <span class="font-bold text-blue-800 text-lg">${toolStats.asignada || 0}</span>
                                </li>
                                <li class="flex justify-between items-center p-2 bg-orange-50 rounded-lg border border-orange-100">
                                    <span class="flex items-center text-orange-700 font-medium"><span class="w-2 h-2 rounded-full bg-orange-500 mr-2"></span>En Reparación</span> 
                                    <span class="font-bold text-orange-800 text-lg">${toolStats.en_reparacion || 0}</span>
                                </li>
                                <li class="flex justify-between items-center p-2 bg-red-50 rounded-lg border border-red-100">
                                    <span class="flex items-center text-red-700 font-medium"><span class="w-2 h-2 rounded-full bg-red-500 mr-2"></span>Dada de Baja</span> 
                                    <span class="font-bold text-red-800 text-lg">${toolStats.dada_de_baja || 0}</span>
                                </li>
                            </ul>
                        </div>
                        <div class="w-full md:w-64 h-64 relative flex items-center justify-center">
                            <canvas id="sst-tools-chart"></canvas>
                        </div>
                    </div>
                </div>

                <div class="lg:col-span-3 space-y-6">
                    <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 h-full">
                        <h3 class="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2 uppercase tracking-wide border-b pb-3">
                            <i class="fa-solid fa-bolt text-yellow-500"></i> Acciones Rápidas
                        </h3>

                        <div class="space-y-3">
                            <button data-action="send-admin-alert" class="w-full flex items-center gap-3 p-3 rounded-xl bg-red-50 text-red-700 hover:bg-red-100 hover:shadow-md transition-all text-left group border border-red-100">
                                <div class="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-red-500 shadow-sm"><i class="fa-solid fa-bullhorn"></i></div>
                                <div><p class="font-bold text-sm">Alerta SST</p><p class="text-[10px] opacity-75">Emergencia</p></div>
                            </button>

                            <button data-action="go-to-dotacion" class="w-full flex items-center gap-3 p-3 rounded-xl bg-amber-50 text-amber-700 hover:bg-amber-100 hover:shadow-md transition-all text-left group border border-amber-100">
                                <div class="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-amber-500 shadow-sm"><i class="fa-solid fa-vest"></i></div>
                                <div><p class="font-bold text-sm">Gestión EPP</p><p class="text-[10px] opacity-75">Entregas y control</p></div>
                            </button>

                            <button data-action="back-to-empleados" class="w-full flex items-center gap-3 p-3 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 hover:shadow-md transition-all text-left group border border-blue-100">
                                <div class="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-blue-500 shadow-sm"><i class="fa-solid fa-id-card"></i></div>
                                <div><p class="font-bold text-sm">Personal</p><p class="text-[10px] opacity-75">Documentos</p></div>
                            </button>

                            <button data-action="go-to-herramientas" class="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-50 text-slate-700 hover:bg-slate-100 hover:shadow-md transition-all text-left group border border-slate-200">
                                <div class="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-slate-500 shadow-sm"><i class="fa-solid fa-clipboard-check"></i></div>
                                <div><p class="font-bold text-sm">Inspección</p><p class="text-[10px] opacity-75">Equipos</p></div>
                            </button>

                             <button data-action="request-loan" class="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-50 text-slate-700 hover:bg-slate-100 hover:shadow-md transition-all text-left group border border-slate-200">
                                <div class="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-gray-500 shadow-sm"><i class="fa-solid fa-hand-holding-dollar"></i></div>
                                <div><p class="font-bold text-sm">Préstamo</p><p class="text-[10px] opacity-75">Personal</p></div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 4. CREAR GRÁFICA
        const ctx = document.getElementById('sst-tools-chart').getContext('2d');
        const chart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Disponible', 'Asignada', 'Reparación', 'Baja'],
                datasets: [{
                    data: [toolStats.disponible || 0, toolStats.asignada || 0, toolStats.en_reparacion || 0, toolStats.dada_de_baja || 0],
                    backgroundColor: ['#22c55e', '#3b82f6', '#f97316', '#ef4444'], // Colores brillantes
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false } // Ocultamos leyenda por defecto (ya hicimos una custom)
                },
                cutout: '70%',
                animation: {
                    animateScale: true,
                    animateRotate: true
                }
            }
        });
        activeModuleCharts.push(chart);

    } catch (error) {
        console.error("Error Dashboard SST:", error);
        container.innerHTML = `<p class="text-red-500 text-center p-10">Error cargando datos: ${error.message}</p>`;
    }
}