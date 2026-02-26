// js/modules/dashboard.js

import { db, functions } from '../firebase-config.js';
import { collection, doc, getDoc, query, onSnapshot, getDocs, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
import { 
    allRemisiones, allGastos, allClientes, allUsers, initialBalances, currentUserData, currentUser,
    showModalMessage, hideModal, showTemporaryMessage 
} from '../app.js';
import { formatCurrency, unformatCurrency, unformatCurrencyInput, formatCurrencyInput } from '../utils.js';
import { METODOS_DE_PAGO } from '../constants.js';

export let _unsubscribePendingTransfers = null;

export function cleanupDashboardListeners() {
    if (_unsubscribePendingTransfers) {
        _unsubscribePendingTransfers();
        _unsubscribePendingTransfers = null;
    }
}

// --- OPTIMIZACIÓN 1: SALDOS INICIALES CON CACHÉ ---
const BALANCES_CACHE_KEY = 'initial_balances_cache';

async function ensureInitialBalances() {
    if (Object.keys(initialBalances).length > 0) return; // Ya en memoria RAM

    const cachedData = localStorage.getItem(BALANCES_CACHE_KEY);
    if (cachedData) {
        try {
            Object.assign(initialBalances, JSON.parse(cachedData));
            // Carga instantánea desde LocalStorage, luego verificamos si hay cambios en el servidor
        } catch (e) {
            localStorage.removeItem(BALANCES_CACHE_KEY);
        }
    }

    try {
        const balanceDocRef = doc(db, "saldosIniciales", "current");
        const balanceDoc = await getDoc(balanceDocRef);
        if (balanceDoc.exists()) {
            const data = balanceDoc.data();
            Object.assign(initialBalances, data);
            localStorage.setItem(BALANCES_CACHE_KEY, JSON.stringify(data));
        }
    } catch (error) {
        console.error("Error cargando saldos iniciales:", error);
    }
}

// --- RENDERIZADO DEL DASHBOARD PRINCIPAL ---
export async function showDashboardModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    await ensureInitialBalances();
    // Validamos si hay saldos guardados (ignoramos campos de configuración interna como _lastUpdated)
    const hasRealBalances = Object.keys(initialBalances).some(key => METODOS_DE_PAGO.includes(key));
    let initialBalanceButtonHTML = !hasRealBalances ? `<button id="set-initial-balance-btn" class="bg-gray-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-gray-700">Saldos Iniciales</button>` : '';

    const saldosHTML = METODOS_DE_PAGO.map(metodo => `
        <div class="bg-gray-100 p-4 rounded-lg">
            <div class="text-sm font-semibold text-gray-800">${metodo.toUpperCase()}</div>
            <div id="summary-${metodo.toLowerCase()}" class="text-xl font-bold"></div>
        </div>
    `).join('');

    modalContentWrapper.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-auto text-left flex flex-col" style="height: 80vh;">
        <div class="flex justify-between items-center p-4 border-b flex-wrap gap-2">
            <h2 class="text-xl font-semibold">Resumen Financiero</h2>
            <div class="flex items-center gap-4 flex-wrap justify-end">
                ${initialBalanceButtonHTML}
                <button id="show-transfer-modal-btn" class="bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-yellow-700 whitespace-nowrap">Transferir Fondos</button>
                <button id="download-report-btn" class="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 whitespace-nowrap">Descargar PDF</button>
                <button id="close-dashboard-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
        </div>
        <div class="border-b border-gray-200">
            <nav class="-mb-px flex space-x-6 px-6 overflow-x-auto">
                <button id="dashboard-tab-summary" class="dashboard-tab-btn active py-4 px-1 font-semibold whitespace-nowrap">Resumen Mensual</button>
                <button id="dashboard-tab-cartera" class="dashboard-tab-btn py-4 px-1 font-semibold whitespace-nowrap">Cartera</button>
                <button id="dashboard-tab-clientes" class="dashboard-tab-btn py-4 px-1 font-semibold whitespace-nowrap">Clientes</button>
                <button id="dashboard-tab-transferencias" class="dashboard-tab-btn py-4 px-1 font-semibold whitespace-nowrap">Transferencias</button>
            </nav>
        </div>
        
        <div id="dashboard-summary-view" class="p-6 space-y-6 overflow-y-auto flex-grow">
             <div class="flex items-center gap-4"> 
                <select id="summary-month" class="p-2 border rounded-lg"></select> 
                <select id="summary-year" class="p-2 border rounded-lg"></select> 
             </div>
             <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"> 
                <div class="bg-green-100 p-4 rounded-lg"><div class="text-sm font-semibold text-green-800">VENTAS (MES)</div><div id="summary-sales" class="text-2xl font-bold"></div></div> 
                <div class="bg-red-100 p-4 rounded-lg"><div class="text-sm font-semibold text-red-800">GASTOS (MES)</div><div id="summary-expenses" class="text-2xl font-bold"></div></div> 
                <div class="bg-indigo-100 p-4 rounded-lg"><div class="text-sm font-semibold text-indigo-800">UTILIDAD (MES)</div><div id="summary-profit" class="text-2xl font-bold"></div></div> 
                <div class="bg-yellow-100 p-4 rounded-lg"><div class="text-sm font-semibold text-yellow-800">CARTERA PENDIENTE (MES)</div><div id="summary-cartera" class="text-2xl font-bold"></div></div> 
             </div>
             <div> 
                <h3 class="font-semibold mb-2">Saldos Estimados (Total Cuentas)</h3> 
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4"> ${saldosHTML} </div> 
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4"> 
                    <div class="bg-gray-100 p-4 rounded-lg"> 
                        <div class="text-sm font-semibold text-gray-800">CARTERA TOTAL ACUMULADA</div> 
                        <div id="summary-cartera-total" class="text-xl font-bold"></div> 
                    </div> 
                    <div class="bg-teal-100 p-4 rounded-lg border-l-4 border-teal-500"> 
                        <div class="text-sm font-semibold text-teal-800">INGRESO CONFIRMADO DEL DÍA</div> 
                        <div id="summary-daily-sales" class="text-xl font-bold"></div> 
                    </div> 
                </div> 
                <div class="mt-4">
                    <h4 class="text-sm font-semibold text-gray-600 mb-2">Desglose Venta del Día (Ingresos vs Crédito)</h4>
                    <div id="daily-sales-breakdown-cards" class="grid grid-cols-2 sm:grid-cols-4 gap-4"></div>
                </div>
             </div>
             <div> <h3 class="font-semibold mb-2">Utilidad/Pérdida (Últimos 6 Meses)</h3> <div class="bg-gray-50 p-4 rounded-lg"><canvas id="profitLossChart"></canvas></div> </div>
        </div>

        <div id="dashboard-cartera-view" class="p-6 hidden flex-grow overflow-y-auto flex-col">
            <h3 class="font-semibold mb-2 text-xl">Cartera Pendiente de Cobro</h3>
            
            <div class="flex space-x-1 bg-gray-100 p-1 rounded-lg mb-4 w-fit">
                <button id="subtab-cartera-detalle" class="px-4 py-2 rounded-md text-sm font-semibold bg-white shadow text-gray-800 transition-all">Detalle por Remisión</button>
                <button id="subtab-cartera-cliente" class="px-4 py-2 rounded-md text-sm font-semibold text-gray-500 hover:text-gray-800 transition-all">Total por Cliente</button>
            </div>

            <div id="view-cartera-detalle">
                <div id="cartera-list" class="space-y-4"></div>
                <div id="cartera-total" class="text-right font-bold text-xl mt-4"></div>
            </div>

            <div id="view-cartera-cliente" class="hidden">
                <div id="cartera-clientes-list" class="space-y-4"></div>
                <div id="cartera-clientes-total" class="text-right font-bold text-xl mt-4"></div>
            </div>
        </div>

        <div id="dashboard-clientes-view" class="p-6 hidden flex-grow overflow-y-auto">
            <h3 class="font-semibold mb-2 text-xl">Ranking de Clientes</h3>
            <div class="flex flex-wrap items-center gap-4 mb-4 p-2 bg-gray-50 rounded-lg border"> 
                <div class="flex items-center gap-2"><label class="text-sm font-medium">Desde:</label><select id="rank-start-month" class="p-2 border rounded-lg"></select><select id="rank-start-year" class="p-2 border rounded-lg"></select></div> 
                <div class="flex items-center gap-2"><label class="text-sm font-medium">Hasta:</label><select id="rank-end-month" class="p-2 border rounded-lg"></select><select id="rank-end-year" class="p-2 border rounded-lg"></select></div> 
                <button id="rank-filter-btn" class="bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700">Filtrar</button> 
                <button id="rank-show-all-btn" class="bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700">Mostrar Todos</button> 
            </div>
            <div id="top-clientes-list" class="space-y-3"></div>
        </div>
        
        <div id="dashboard-transferencias-view" class="p-6 hidden flex-grow overflow-y-auto flex-col">
            <h3 class="font-semibold mb-2 text-xl">Historial de Transferencias Confirmadas</h3>
             <div class="flex flex-col sm:flex-row gap-4 my-4 p-4 bg-gray-50 rounded-lg border">
                 <div class="flex-1"> <label for="filter-transfer-month" class="text-sm font-medium text-gray-700">Mes</label> <select id="filter-transfer-month" class="p-2 border rounded-lg bg-white w-full mt-1"></select> </div>
                 <div class="flex-1"> <label for="filter-transfer-year" class="text-sm font-medium text-gray-700">Año</label> <select id="filter-transfer-year" class="p-2 border rounded-lg bg-white w-full mt-1"></select> </div>
             </div>
            <div id="transferencias-list" class="space-y-3"></div>
            <div id="transferencias-pagination" class="mt-auto pt-4 border-t border-gray-200"></div>
        </div>

        <div id="pending-transfers-section" class="p-6 border-t mt-auto bg-yellow-50 hidden">
            <h3 class="font-semibold mb-2 text-lg text-yellow-800">Transferencias Pendientes de Confirmación</h3>
            <div id="pending-transfers-list" class="space-y-3 max-h-40 overflow-y-auto"></div>
        </div>
    </div>
    `;

    document.getElementById('modal').classList.remove('hidden');

    const tabs = {
        summary: document.getElementById('dashboard-tab-summary'),
        cartera: document.getElementById('dashboard-tab-cartera'),
        clientes: document.getElementById('dashboard-tab-clientes'),
        transferencias: document.getElementById('dashboard-tab-transferencias')
    };
    const views = {
        summary: document.getElementById('dashboard-summary-view'),
        cartera: document.getElementById('dashboard-cartera-view'),
        clientes: document.getElementById('dashboard-clientes-view'),
        transferencias: document.getElementById('dashboard-transferencias-view')
    };

    Object.keys(tabs).forEach(key => {
        if (tabs[key]) {
            tabs[key].addEventListener('click', () => {
                Object.values(tabs).forEach(t => t?.classList.remove('active'));
                Object.values(views).forEach(v => v?.classList.add('hidden'));
                tabs[key].classList.add('active');
                if (views[key]) views[key].classList.remove('hidden');
                
                if (key === 'transferencias') { 
                    currentPageTransfers = 1;
                    loadConfirmedTransfers(); 
                }
            });
        }
    });

    const subTabDetalle = document.getElementById('subtab-cartera-detalle');
    const subTabCliente = document.getElementById('subtab-cartera-cliente');
    const viewDetalle = document.getElementById('view-cartera-detalle');
    const viewCliente = document.getElementById('view-cartera-cliente');

    if (subTabDetalle && subTabCliente) {
        subTabDetalle.addEventListener('click', () => {
            subTabDetalle.classList.add('bg-white', 'shadow', 'text-gray-800');
            subTabDetalle.classList.remove('text-gray-500');
            subTabCliente.classList.remove('bg-white', 'shadow', 'text-gray-800');
            subTabCliente.classList.add('text-gray-500');
            viewDetalle.classList.remove('hidden');
            viewCliente.classList.add('hidden');
        });

        subTabCliente.addEventListener('click', () => {
            subTabCliente.classList.add('bg-white', 'shadow', 'text-gray-800');
            subTabCliente.classList.remove('text-gray-500');
            subTabDetalle.classList.remove('bg-white', 'shadow', 'text-gray-800');
            subTabDetalle.classList.add('text-gray-500');
            viewCliente.classList.remove('hidden');
            viewDetalle.classList.add('hidden');
            renderCarteraClientes();
        });
    }

    document.getElementById('close-dashboard-modal').addEventListener('click', () => {
        cleanupDashboardListeners();
        hideModal();
    });

    const initialBalanceBtn = document.getElementById('set-initial-balance-btn');
    if (initialBalanceBtn) initialBalanceBtn.addEventListener('click', showInitialBalanceModal);

    const downloadBtn = document.getElementById('download-report-btn');
    if (downloadBtn) downloadBtn.addEventListener('click', showReportDateRangeModal);
    
    const transferBtn = document.getElementById('show-transfer-modal-btn');
    if (transferBtn) transferBtn.addEventListener('click', showTransferModal);

    populateDateFilters('summary');
    populateDateFilters('rank-start');
    populateDateFilters('rank-end');
    populateDateFilters('filter-transfer');

    const monthSelect = document.getElementById('summary-month');
    const yearSelect = document.getElementById('summary-year');
    const updateDashboardView = () => updateDashboard(parseInt(yearSelect.value), parseInt(monthSelect.value));
    if (monthSelect) monthSelect.addEventListener('change', updateDashboardView);
    if (yearSelect) yearSelect.addEventListener('change', updateDashboardView);

    const rankStartMonth = document.getElementById('rank-start-month');
    const rankStartYear = document.getElementById('rank-start-year');
    const rankEndMonth = document.getElementById('rank-end-month');
    const rankEndYear = document.getElementById('rank-end-year');
    const rankFilterBtn = document.getElementById('rank-filter-btn');
    if (rankFilterBtn) rankFilterBtn.addEventListener('click', () => {
        const startDate = new Date(rankStartYear.value, rankStartMonth.value, 1);
        const endDate = new Date(rankEndYear.value, parseInt(rankEndMonth.value) + 1, 0);
        renderTopClientes(startDate, endDate);
    });
    
    const rankShowAllBtn = document.getElementById('rank-show-all-btn');
    if (rankShowAllBtn) rankShowAllBtn.addEventListener('click', () => renderTopClientes());

    const transferMonthFilter = document.getElementById('filter-transfer-month');
    const transferYearFilter = document.getElementById('filter-transfer-year');
    
    const resetAndRenderTransfers = () => {
        currentPageTransfers = 1;
        renderConfirmedTransfersList();
    };

    if (transferMonthFilter) transferMonthFilter.addEventListener('change', resetAndRenderTransfers);
    if (transferYearFilter) transferYearFilter.addEventListener('change', resetAndRenderTransfers);

    renderPendingTransfers();
    updateDashboardView();
    renderCartera();
    renderTopClientes();
}

function populateDateFilters(prefix) {
    const monthSelect = document.getElementById(`${prefix}-month`);
    const yearSelect = document.getElementById(`${prefix}-year`);
    if (!monthSelect || !yearSelect) return;

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const now = new Date();

    monthSelect.innerHTML = prefix.includes('filter-') || prefix.includes('rank-') ? '<option value="all">Todos los Meses</option>' : '';
    for (let i = 0; i < 12; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = monthNames[i];
        if (i === now.getMonth() && !prefix.includes('filter-')) option.selected = true;
        monthSelect.appendChild(option);
    }

    yearSelect.innerHTML = prefix.includes('filter-') || prefix.includes('rank-') ? '<option value="all">Todos los Años</option>' : '';
    const currentYear = now.getFullYear();
    for (let i = 0; i < 5; i++) {
        const year = currentYear - i;
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    }
}

async function updateDashboard(year, month) {
    await ensureInitialBalances();
    
    const salesThisMonth = allRemisiones
        .flatMap(r => Array.isArray(r.payments) ? r.payments : [])
        .filter(p => { const d = new Date(p.date + 'T00:00:00'); return d.getMonth() === month && d.getFullYear() === year; })
        .reduce((sum, p) => sum + p.amount, 0);

    const expensesThisMonth = allGastos.filter(g => { const d = new Date(g.fecha + 'T00:00:00'); return d.getMonth() === month && d.getFullYear() === year; }).reduce((sum, g) => sum + g.valorTotal, 0);

    const carteraThisMonth = allRemisiones.filter(r => { const d = new Date(r.fechaRecibido + 'T00:00:00'); return d.getMonth() === month && d.getFullYear() === year && r.estado !== 'Anulada'; })
        .reduce((sum, r) => {
            const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
            const totalPagado = paymentsArray.reduce((s, p) => s + p.amount, 0);
            const saldo = r.valorTotal - totalPagado;
            return sum + (saldo > 0 ? saldo : 0);
        }, 0);

    document.getElementById('summary-sales').textContent = formatCurrency(salesThisMonth);
    document.getElementById('summary-expenses').textContent = formatCurrency(expensesThisMonth);
    document.getElementById('summary-profit').textContent = formatCurrency(salesThisMonth - expensesThisMonth);
    document.getElementById('summary-cartera').textContent = formatCurrency(carteraThisMonth);

    const totalCartera = allRemisiones.filter(r => r.estado !== 'Anulada')
        .reduce((sum, r) => {
            const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
            const totalPagado = paymentsArray.reduce((s, p) => s + p.amount, 0);
            const saldo = r.valorTotal - totalPagado;
            return sum + (saldo > 0 ? saldo : 0);
        }, 0);
    document.getElementById('summary-cartera-total').textContent = formatCurrency(totalCartera);

    const accountBalances = {};
    METODOS_DE_PAGO.forEach(metodo => { accountBalances[metodo] = initialBalances[metodo] || 0; });

    allRemisiones.forEach(r => {
        const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
        paymentsArray.forEach(p => {
            if (accountBalances[p.method] !== undefined) accountBalances[p.method] += p.amount;
        });
    });

    allGastos.forEach(g => {
        if (accountBalances[g.fuentePago] !== undefined) accountBalances[g.fuentePago] -= g.valorTotal;
    });

    METODOS_DE_PAGO.forEach(metodo => {
        const element = document.getElementById(`summary-${metodo.toLowerCase()}`);
        if (element) element.textContent = formatCurrency(accountBalances[metodo]);
    });

    const now = new Date();
    const today = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;

    const breakdown = {};
    METODOS_DE_PAGO.forEach(m => breakdown[m] = 0);
    let totalConfirmedToday = 0;

    allRemisiones.forEach(r => {
        if (r.estado === 'Anulada') return;
        const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
        paymentsArray.forEach(p => {
            if (p.date === today && p.status === 'confirmado') {
                if (breakdown[p.method] !== undefined) {
                    breakdown[p.method] += p.amount;
                    totalConfirmedToday += p.amount;
                }
            }
        });
    });

    const todayRemisiones = allRemisiones.filter(r => r.fechaRecibido === today && r.estado !== 'Anulada');
    let carteraToday = 0;
    todayRemisiones.forEach(r => {
        const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
        const paidConfirmedToday = paymentsArray.filter(p => p.date === today && p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const saldo = r.valorTotal - paidConfirmedToday;
        if (saldo > 0) carteraToday += saldo;
    });

    document.getElementById('summary-daily-sales').textContent = formatCurrency(totalConfirmedToday);

    const breakdownContainer = document.getElementById('daily-sales-breakdown-cards');
    if (breakdownContainer) {
        let cardsHTML = '';
        METODOS_DE_PAGO.forEach(metodo => {
            cardsHTML += `
                <div class="bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <div class="text-xs font-semibold text-gray-500 uppercase">${metodo}</div>
                    <div class="text-lg font-bold text-gray-800">${formatCurrency(breakdown[metodo] || 0)}</div>
                </div>
            `;
        });
        cardsHTML += `
            <div class="bg-red-50 p-3 rounded-lg border border-red-200">
                <div class="text-xs font-semibold text-red-800 uppercase">EN CARTERA (HOY)</div>
                <div class="text-lg font-bold text-red-700">${formatCurrency(carteraToday)}</div>
            </div>
        `;
        if (totalConfirmedToday === 0 && carteraToday === 0) {
            cardsHTML = '<div class="col-span-full text-center text-sm text-gray-500 italic py-2">No hay movimientos hoy.</div>';
        }
        breakdownContainer.innerHTML = cardsHTML;
    }

    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const labels = []; const salesData = []; const expensesData = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(); d.setMonth(d.getMonth() - i);
        const m = d.getMonth(); const y = d.getFullYear();
        labels.push(monthNames[m]);

        salesData.push(allRemisiones.flatMap(r => Array.isArray(r.payments) ? r.payments : []).filter(p => { const pDate = new Date(p.date + 'T00:00:00'); return pDate.getMonth() === m && pDate.getFullYear() === y; }).reduce((sum, p) => sum + p.amount, 0));
        expensesData.push(allGastos.filter(g => { const gDate = new Date(g.fecha + 'T00:00:00'); return gDate.getMonth() === m && gDate.getFullYear() === y; }).reduce((sum, g) => sum + g.valorTotal, 0));
    }
    
    const ctx = document.getElementById('profitLossChart')?.getContext('2d');
    if (ctx && window.Chart) {
        if (window.profitLossChartInstance) window.profitLossChartInstance.destroy();
        window.profitLossChartInstance = new window.Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{ label: 'Ventas', data: salesData, backgroundColor: 'rgba(75, 192, 192, 0.6)' }, { label: 'Gastos', data: expensesData, backgroundColor: 'rgba(255, 99, 132, 0.6)' }]
            },
            options: { scales: { y: { beginAtZero: true } } }
        });
    }
}

function calculateOverdueDays(dateString) {
    const today = new Date(); const receivedDate = new Date(dateString);
    today.setHours(0, 0, 0, 0); receivedDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((today - receivedDate) / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
}

function renderCartera() {
    const carteraListEl = document.getElementById('cartera-list');
    const carteraTotalEl = document.getElementById('cartera-total');

    const pendingRemisiones = allRemisiones.filter(r => {
        if (r.estado === 'Anulada') return false;
        const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
        return r.valorTotal - paymentsArray.reduce((sum, p) => sum + p.amount, 0) > 0.01;
    }).sort((a, b) => new Date(a.fechaRecibido) - new Date(b.fechaRecibido));

    carteraListEl.innerHTML = '';
    if (pendingRemisiones.length === 0) {
        carteraListEl.innerHTML = '<p class="text-center text-gray-500 py-8">¡No hay cartera pendiente!</p>';
        carteraTotalEl.innerHTML = '';
        return;
    }

    let totalCartera = 0;
    pendingRemisiones.forEach(r => {
        const paymentsArray = Array.isArray(r.payments) ? r.payments : [];
        const saldoPendiente = r.valorTotal - paymentsArray.reduce((sum, p) => sum + p.amount, 0);
        totalCartera += saldoPendiente;
        
        const overdueDays = calculateOverdueDays(r.fechaRecibido);
        let overdueColor = 'text-gray-600';
        if (overdueDays > 30) overdueColor = 'text-yellow-600';
        if (overdueDays > 60) overdueColor = 'text-red-600';

        const card = document.createElement('div');
        card.className = 'bg-white p-4 rounded-lg shadow-md border border-gray-200';
        card.dataset.remisionJson = JSON.stringify(r); 

        card.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                <div class="mb-2 sm:mb-0 flex-grow">
                    <p class="font-bold text-gray-800">${r.clienteNombre}</p>
                    <p class="text-sm text-gray-500">Remisión N° <span class="font-mono">${r.numeroRemision}</span> &bull; Recibido: ${r.fechaRecibido}</p>
                </div>
                <div class="text-left sm:text-right w-full sm:w-auto flex-shrink-0"> 
                    <p class="text-sm text-gray-500">Saldo Pendiente</p>
                    <p class="font-bold text-xl text-red-600">${formatCurrency(saldoPendiente)}</p>
                </div>
            </div>
            <div class="mt-2 pt-2 border-t border-gray-200 text-sm flex justify-between items-center">
                <p><span class="font-semibold">Valor Total:</span> ${formatCurrency(r.valorTotal)}</p>
                <p class="${overdueColor} font-semibold">${overdueDays} días de vencido</p>
                <button class="cartera-payment-btn bg-purple-600 text-white font-bold py-1 px-3 rounded-lg hover:bg-purple-700 text-xs">Gestionar Pagos</button>
            </div>
        `;
        carteraListEl.appendChild(card);
    });
    carteraTotalEl.innerHTML = `Total Cartera: <span class="text-red-600">${formatCurrency(totalCartera)}</span>`;
    
    const oldListener = carteraListEl._paymentClickListener;
    if (oldListener) carteraListEl.removeEventListener('click', oldListener);

    const newListener = (event) => {
        const btn = event.target.closest('.cartera-payment-btn');
        if (btn) {
            const card = btn.closest('[data-remision-json]');
            if (card) {
                const remisionData = JSON.parse(card.dataset.remisionJson);
                const customEvent = new CustomEvent('openPaymentModal', { detail: remisionData });
                document.dispatchEvent(customEvent);
            }
        }
    };
    carteraListEl.addEventListener('click', newListener);
    carteraListEl._paymentClickListener = newListener;
}

function renderCarteraClientes() {
    const container = document.getElementById('cartera-clientes-list');
    const totalEl = document.getElementById('cartera-clientes-total');
    if (!container || !totalEl) return;

    const pendingRemisiones = allRemisiones.filter(r => {
        if (r.estado === 'Anulada') return false;
        return r.valorTotal - (Array.isArray(r.payments) ? r.payments : []).reduce((sum, p) => sum + p.amount, 0) > 0.01;
    });

    if (pendingRemisiones.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-8">¡No hay cartera pendiente!</p>';
        totalEl.innerHTML = ''; return;
    }

    const carteraPorCliente = {};
    let granTotal = 0;

    pendingRemisiones.forEach(r => {
        const saldo = r.valorTotal - (Array.isArray(r.payments) ? r.payments : []).reduce((sum, p) => sum + p.amount, 0);
        const clienteId = r.idCliente || 'DESCONOCIDO';
        if (!carteraPorCliente[clienteId]) {
            carteraPorCliente[clienteId] = { nombre: r.clienteNombre || 'Cliente Desconocido', telefono: r.clienteTelefono || '', remisionesCount: 0, totalDeuda: 0 };
        }
        carteraPorCliente[clienteId].totalDeuda += saldo;
        carteraPorCliente[clienteId].remisionesCount += 1; 
        granTotal += saldo;
    });

    const clientesOrdenados = Object.values(carteraPorCliente).sort((a, b) => b.totalDeuda - a.totalDeuda);
    container.innerHTML = '';
    clientesOrdenados.forEach(c => {
        const card = document.createElement('div');
        card.className = 'bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4';
        const labelRemisiones = c.remisionesCount === 1 ? 'remisión pendiente' : 'remisiones pendientes';
        card.innerHTML = `
            <div>
                <p class="font-bold text-lg text-gray-800">${c.nombre}</p>
                <p class="text-sm text-gray-600 font-medium">${c.remisionesCount} ${labelRemisiones}</p>
                ${c.telefono && c.telefono !== 'N/A' ? `<p class="text-xs text-gray-400 mt-1">Tel: ${c.telefono}</p>` : ''}
            </div>
            <div class="text-left sm:text-right w-full sm:w-auto border-t sm:border-t-0 pt-2 sm:pt-0 mt-2 sm:mt-0">
                <p class="text-xs text-gray-500 uppercase tracking-wider">Deuda Total</p>
                <p class="font-bold text-xl text-red-600">${formatCurrency(c.totalDeuda)}</p>
            </div>
        `;
        container.appendChild(card);
    });
    totalEl.innerHTML = `Total Cartera: <span class="text-red-600">${formatCurrency(granTotal)}</span>`;
}

function renderTopClientes(startDate, endDate) {
    const container = document.getElementById('top-clientes-list');
    if (!container) return;

    let remisionesToAnalyze = allRemisiones;
    if (startDate && endDate) {
        remisionesToAnalyze = allRemisiones.filter(r => {
            const d = new Date(r.fechaRecibido);
            return d >= startDate && d <= endDate;
        });
    }

    const clientesConHistorial = allClientes.map(cliente => {
        const remisionesCliente = remisionesToAnalyze.filter(r => r.idCliente === cliente.id && r.estado !== 'Anulada');
        const totalComprado = remisionesCliente.reduce((sum, r) => sum + r.valorTotal, 0);
        return { ...cliente, totalComprado, numCompras: remisionesCliente.length };
    }).filter(c => c.numCompras > 0).sort((a, b) => b.totalComprado - a.totalComprado);

    container.innerHTML = '';
    if (clientesConHistorial.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-8">No hay datos de compras de clientes para el rango seleccionado.</p>';
        return;
    }

    clientesConHistorial.forEach(cliente => {
        const el = document.createElement('div');
        el.className = 'border p-4 rounded-lg';
        el.innerHTML = `
                <div class="flex justify-between items-center">
                    <p class="font-semibold text-lg">${cliente.nombre}</p>
                    <p class="font-bold text-xl text-green-600">${formatCurrency(cliente.totalComprado)}</p>
                </div>
                <p class="text-sm text-gray-600">${cliente.numCompras} ${cliente.numCompras === 1 ? 'compra' : 'compras'}</p>
            `;
        container.appendChild(el);
    });
}

// --- OPTIMIZACIÓN 2: TRANSFERENCIAS CON CACHE Y PAGINACIÓN ---
const TRANSF_CACHE_KEY = 'transferencias_cache';
const TRANSF_SYNC_KEY = 'transferencias_last_sync';
let allConfirmedTransfers = [];
let currentPageTransfers = 1;
const transfersPerPage = 15;

async function loadConfirmedTransfers() {
    const listContainer = document.getElementById('transferencias-list');
    if (!listContainer) return;

    listContainer.innerHTML = '<p class="text-gray-500 text-center py-4">Cargando historial...</p>';

    const cachedData = localStorage.getItem(TRANSF_CACHE_KEY);
    const lastSyncStr = localStorage.getItem(TRANSF_SYNC_KEY);
    
    let lastSync = null;
    let mapTransfers = new Map();

    if (cachedData) {
        try {
            allConfirmedTransfers = JSON.parse(cachedData);
            allConfirmedTransfers.forEach(t => mapTransfers.set(t.id, t));
            renderConfirmedTransfersList(); 
        } catch (e) {
            localStorage.removeItem(TRANSF_CACHE_KEY);
        }
    }

    if (lastSyncStr) lastSync = new Date(parseInt(lastSyncStr));

    try {
        const colRef = collection(db, "transferencias");
        let q;
        
        if (lastSync) {
            const syncTime = new Date(lastSync.getTime() - 60000);
            q = query(colRef, where("estado", "==", "confirmada"), where("_lastUpdated", ">=", syncTime));
        } else {
            q = query(colRef, where("estado", "==", "confirmada"));
        }

        const snapshot = await getDocs(q);
        let huboCambios = false;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.confirmadoEn && typeof data.confirmadoEn.toMillis === 'function') data.confirmadoEn = data.confirmadoEn.toMillis();
            if (data.fechaRegistro && typeof data.fechaRegistro.toMillis === 'function') data.fechaRegistro = data.fechaRegistro.toMillis();
            if (data._lastUpdated && typeof data._lastUpdated.toMillis === 'function') data._lastUpdated = data._lastUpdated.toMillis();
            
            mapTransfers.set(doc.id, { id: doc.id, ...data });
            huboCambios = true;
        });

        if (huboCambios || !lastSync) {
            allConfirmedTransfers = Array.from(mapTransfers.values());
            allConfirmedTransfers.sort((a, b) => b.confirmadoEn - a.confirmadoEn); 
            
            localStorage.setItem(TRANSF_CACHE_KEY, JSON.stringify(allConfirmedTransfers));
            localStorage.setItem(TRANSF_SYNC_KEY, Date.now().toString());

            renderConfirmedTransfersList();
        }
    } catch (error) {
        console.error("Error sincronizando transferencias:", error);
    }
}

function updateLocalTransfersCache(newTransfer) {
    const cachedData = localStorage.getItem(TRANSF_CACHE_KEY);
    let transfers = cachedData ? JSON.parse(cachedData) : [];
    
    const index = transfers.findIndex(t => t.id === newTransfer.id);
    if (index !== -1) transfers[index] = newTransfer;
    else transfers.push(newTransfer);
    
    transfers.sort((a, b) => b.confirmadoEn - a.confirmadoEn);
    
    localStorage.setItem(TRANSF_CACHE_KEY, JSON.stringify(transfers));
    allConfirmedTransfers = transfers;
}

function renderConfirmedTransfersList() {
    const listContainer = document.getElementById('transferencias-list');
    const paginationContainer = document.getElementById('transferencias-pagination');
    const monthFilter = document.getElementById('filter-transfer-month');
    const yearFilter = document.getElementById('filter-transfer-year');
    
    if (!listContainer) return;

    const selectedMonth = monthFilter ? monthFilter.value : 'all';
    const selectedYear = yearFilter ? yearFilter.value : 'all';

    let filtered = allConfirmedTransfers;

    if (selectedYear !== 'all') {
        filtered = filtered.filter(t => new Date(t.confirmadoEn).getFullYear() == selectedYear);
    }
    if (selectedMonth !== 'all') {
        filtered = filtered.filter(t => new Date(t.confirmadoEn).getMonth() == selectedMonth);
    }

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / transfersPerPage) || 1;

    if (currentPageTransfers > totalPages) currentPageTransfers = totalPages;
    if (currentPageTransfers < 1) currentPageTransfers = 1;

    const startIndex = (currentPageTransfers - 1) * transfersPerPage;
    const endIndex = startIndex + transfersPerPage;
    const paginatedTransfers = filtered.slice(startIndex, endIndex);

    listContainer.innerHTML = ''; 
    if (totalItems === 0) {
        listContainer.innerHTML = '<p class="text-center text-gray-500 py-4">No se encontraron transferencias confirmadas para este período.</p>';
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    paginatedTransfers.forEach(transfer => {
        const el = document.createElement('div');
        el.className = 'bg-white p-4 rounded-lg shadow border border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-4 items-start';

        let fechaConfirmacionStr = new Date(transfer.confirmadoEn).toLocaleDateString();
        let horaConfirmacionStr = new Date(transfer.confirmadoEn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let fechaRegistroStr = transfer.fechaRegistro ? new Date(transfer.fechaRegistro).toLocaleDateString() : 'N/A';
        const fechaTransferenciaStr = transfer.fechaTransferencia ? new Date(transfer.fechaTransferencia + 'T00:00:00').toLocaleDateString() : fechaRegistroStr;

        const registradoPorNombre = allUsers.find(u => u.id === transfer.registradoPor)?.nombre || 'Desconocido';
        const confirmadoPorNombre = allUsers.find(u => u.id === transfer.confirmadoPor)?.nombre || 'Desconocido';

        el.innerHTML = `
            <div class="md:col-span-1 space-y-1">
                <p class="font-bold text-xl text-indigo-700">${formatCurrency(transfer.monto)}</p>
                <p class="text-sm font-semibold text-gray-800">
                    <span class="text-red-600">${transfer.cuentaOrigen}</span> &rarr; <span class="text-green-600">${transfer.cuentaDestino}</span>
                </p>
                 <p class="text-xs text-gray-500">Fecha Transferencia: ${fechaTransferenciaStr}</p>
                ${transfer.referencia ? `<p class="text-xs text-gray-600 italic break-all">Ref: ${transfer.referencia}</p>` : ''}
            </div>
            <div class="md:col-span-1 text-xs text-gray-600 border-t md:border-t-0 md:border-l md:pl-4 pt-2 md:pt-0">
                <p class="font-semibold text-gray-800">Registrado:</p>
                <p>Por: ${registradoPorNombre}</p><p>Fecha: ${fechaRegistroStr}</p>
            </div>
            <div class="md:col-span-1 text-xs text-gray-600 border-t md:border-t-0 md:border-l md:pl-4 pt-2 md:pt-0">
                <p class="font-semibold text-gray-800">Confirmado:</p>
                <p>Por: ${confirmadoPorNombre}</p><p>Fecha: ${fechaConfirmacionStr}</p><p>Hora: ${horaConfirmacionStr}</p>
            </div>
        `;
        listContainer.appendChild(el);
    });

    if (paginationContainer) {
        paginationContainer.innerHTML = `
            <div class="flex justify-between items-center mt-2">
                <span class="text-sm text-gray-600">Mostrando ${startIndex + 1} - ${Math.min(endIndex, totalItems)} de ${totalItems}</span>
                <div class="flex gap-2">
                    <button id="prev-transf-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPageTransfers === 1 ? 'disabled' : ''}>Anterior</button>
                    <span class="px-3 py-1 font-semibold text-gray-700">Pág ${currentPageTransfers} de ${totalPages}</span>
                    <button id="next-transf-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPageTransfers === totalPages ? 'disabled' : ''}>Siguiente</button>
                </div>
            </div>
        `;

        const prevBtn = document.getElementById('prev-transf-btn');
        const nextBtn = document.getElementById('next-transf-btn');
        if (prevBtn && currentPageTransfers > 1) prevBtn.addEventListener('click', () => { currentPageTransfers--; renderConfirmedTransfersList(); });
        if (nextBtn && currentPageTransfers < totalPages) nextBtn.addEventListener('click', () => { currentPageTransfers++; renderConfirmedTransfersList(); });
    }
}

// --- OPTIMIZACIÓN 3: TRANSFERENCIAS PENDIENTES (Mantiene onSnapshot por ser cola en vivo) ---
function renderPendingTransfers() {
    const container = document.getElementById('pending-transfers-list');
    const section = document.getElementById('pending-transfers-section');

    if (_unsubscribePendingTransfers) {
        _unsubscribePendingTransfers();
        _unsubscribePendingTransfers = null;
    }

    if (!container || !section || !currentUserData || currentUserData.role !== 'admin') {
        section?.classList.add('hidden'); return; 
    }

    const q = query(collection(db, "transferencias"), where("estado", "==", "pendiente"));
    _unsubscribePendingTransfers = onSnapshot(q, (snapshot) => {
        const pendingTransfers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (pendingTransfers.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-500">No hay transferencias pendientes.</p>';
            section.classList.add('hidden'); return;
        }

        section.classList.remove('hidden'); container.innerHTML = ''; 

        pendingTransfers.forEach(transfer => {
            const el = document.createElement('div');
            el.className = 'border p-3 rounded-lg flex justify-between items-center bg-white';
            const canConfirm = currentUser.uid !== transfer.registradoPor;
            const fechaRegistro = transfer.fechaRegistro ? new Date(transfer.fechaRegistro.seconds * 1000).toLocaleDateString() : 'Fecha no disponible';
            const fechaMostrar = transfer.fechaTransferencia || fechaRegistro;

            el.innerHTML = `
                <div>
                    <p class="font-semibold">${formatCurrency(transfer.monto)}</p>
                    <p class="text-sm text-gray-600">${transfer.cuentaOrigen} &rarr; ${transfer.cuentaDestino}</p>
                    <p class="text-xs text-gray-400">Fecha Transferencia: ${fechaMostrar}</p>
                    ${transfer.referencia ? `<p class="text-xs text-gray-500">Ref: ${transfer.referencia}</p>` : ''}
                </div>
                <button data-transfer-id="${transfer.id}" class="confirm-transfer-btn bg-green-500 text-white text-xs px-3 py-1 rounded hover:bg-green-600 ${!canConfirm ? 'opacity-50 cursor-not-allowed' : ''}" ${!canConfirm ? 'disabled title="Otro admin debe confirmar"' : ''}>
                    Confirmar
                </button>
            `;
            container.appendChild(el);
        });
    });

    container.removeEventListener('click', handleConfirmTransferClick);
    container.addEventListener('click', handleConfirmTransferClick);
}

function handleConfirmTransferClick(e) {
    const confirmButton = e.target.closest('.confirm-transfer-btn:not([disabled])');
    if (confirmButton) handleConfirmTransfer(e);
}

async function handleConfirmTransfer(e) {
    const transferId = e.target.dataset.transferId;
    if (!transferId) return;

    if (!confirm("¿Estás seguro de que quieres confirmar esta transferencia? Esta acción registrará los gastos correspondientes.")) return;

    showModalMessage("Confirmando transferencia...", true);
    try {
        const confirmTransfer = httpsCallable(functions, 'confirmTransfer');
        const result = await confirmTransfer({ transferId: transferId });
        
        // Actualizamos localmente el caché si la función devuelve la transferencia confirmada
        if(result.data && result.data.transferencia) {
            updateLocalTransfersCache(result.data.transferencia);
            currentPageTransfers = 1;
            renderConfirmedTransfersList();
        } else {
             // Si la function no devuelve data, forzamos recarga desde Firebase
             loadConfirmedTransfers();
        }

        hideModal(); showTemporaryMessage("¡Transferencia confirmada!", "success");
    } catch (error) {
        console.error("Error al confirmar:", error); showModalMessage(`Error: ${error.message}`);
    }
}

function showTransferModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const origenOptions = METODOS_DE_PAGO.map(m => `<option value="${m}">${m}</option>`).join('');

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-md w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Registrar Transferencia</h2><button id="close-transfer-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button></div>
            <form id="transfer-form" class="space-y-4">
                <div><label class="block text-sm font-medium">Cuenta Origen</label><select id="transfer-origen" class="w-full p-2 border rounded-lg bg-white" required><option value="">-- Seleccionar --</option>${origenOptions}</select></div>
                <div><label class="block text-sm font-medium">Cuenta Destino</label><select id="transfer-destino" class="w-full p-2 border rounded-lg bg-white" required><option value="">-- Seleccionar --</option></select></div>
                <div><label class="block text-sm font-medium">Fecha de Transferencia</label><input type="date" id="transfer-fecha" class="w-full p-2 border rounded-lg" value="${new Date().toISOString().split('T')[0]}" required></div>
                 <div><label class="block text-sm font-medium">Monto (COP)</label><input type="text" id="transfer-amount" inputmode="numeric" class="w-full p-2 border rounded-lg" required></div>
                 <div><label class="block text-sm font-medium">Referencia (Opcional)</label><input type="text" id="transfer-reference" class="w-full p-2 border rounded-lg"></div>
                <button type="submit" class="w-full bg-yellow-600 text-white font-bold py-2 rounded-lg hover:bg-yellow-700">Registrar Transferencia</button>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-transfer-modal').addEventListener('click', hideModal);

    const origenSelect = document.getElementById('transfer-origen');
    const destinoSelect = document.getElementById('transfer-destino');
    origenSelect.addEventListener('change', () => {
        destinoSelect.innerHTML = '<option value="">-- Seleccionar --</option>';
        METODOS_DE_PAGO.forEach(m => { if (m !== origenSelect.value) destinoSelect.innerHTML += `<option value="${m}">${m}</option>`; });
    });

    const amountInput = document.getElementById('transfer-amount');
    amountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    amountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    document.getElementById('transfer-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const origen = document.getElementById('transfer-origen').value;
        const destino = document.getElementById('transfer-destino').value;
        const amount = unformatCurrency(document.getElementById('transfer-amount').value);
        const reference = document.getElementById('transfer-reference').value;
        const fechaTransferencia = document.getElementById('transfer-fecha').value;

        if (!origen || !destino || origen === destino || isNaN(amount) || amount <= 0 || !fechaTransferencia) {
            return showModalMessage("Verifica los datos de la transferencia.");
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true; submitBtn.textContent = 'Procesando...';

        showModalMessage("Registrando transferencia...", true);
        try {
            const recordTransfer = httpsCallable(functions, 'recordTransfer');
            await recordTransfer({ cuentaOrigen: origen, cuentaDestino: destino, monto: amount, referencia: reference, fechaTransferencia: fechaTransferencia });
            hideModal(); showTemporaryMessage("Transferencia registrada.", "success");
        } catch (error) { 
            showModalMessage(`Error: ${error.message}`); 
        } finally {
            submitBtn.disabled = false; submitBtn.textContent = 'Registrar Transferencia';
        }
    });
}

// --- UTILIDADES ---
async function showInitialBalanceModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    
    // Obtenemos del caché local primero para velocidad
    let balances = { ...initialBalances }; 

    const balanceFieldsHTML = METODOS_DE_PAGO.map(metodo => `
        <div><label class="block text-sm font-medium">${metodo}</label><input type="text" id="balance-${metodo.toLowerCase()}" class="cost-input-cop w-full p-2 border rounded-lg mt-1" value="${formatCurrency(balances[metodo] || 0)}"></div>
    `).join('');

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Establecer Saldos Iniciales</h2><button id="close-balance-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button></div>
            <p class="text-sm text-gray-600 mb-4">Ingresa el saldo base de cada cuenta.</p>
            <form id="initial-balance-form" class="space-y-3">${balanceFieldsHTML}<div class="pt-4"><button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 rounded-lg hover:bg-indigo-700">Guardar Saldos</button></div></form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-balance-modal').addEventListener('click', hideModal);

    document.querySelectorAll('.cost-input-cop').forEach(input => {
        input.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
        input.addEventListener('blur', (e) => formatCurrencyInput(e.target));
    });

    document.getElementById('initial-balance-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitButton = e.target.querySelector('button[type="submit"]');
        submitButton.disabled = true; submitButton.textContent = 'Guardando...';

        const balancesToSave = {};
        METODOS_DE_PAGO.forEach(metodo => {
            balancesToSave[metodo] = unformatCurrency(document.getElementById(`balance-${metodo.toLowerCase()}`).value);
        });

        try {
            const setBalances = httpsCallable(functions, 'setInitialBalances');
            await setBalances(balancesToSave);
            
            Object.assign(initialBalances, balancesToSave); 
            localStorage.setItem(BALANCES_CACHE_KEY, JSON.stringify(balancesToSave));

            if(window.Swal) window.Swal.fire('¡Éxito!', 'Saldos iniciales guardados.', 'success');
            hideModal();
            updateDashboard(new Date().getFullYear(), new Date().getMonth()); 
        } catch (error) {
            console.error("Error al guardar saldos:", error);
            if(window.Swal) window.Swal.fire('Error', 'No se pudieron guardar los saldos.', 'error');
        } finally {
            submitButton.disabled = false; submitButton.textContent = 'Guardar Saldos';
        }
    });
}

function showReportDateRangeModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const now = new Date();
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    let monthOptions = '';
    for (let i = 0; i < 12; i++) monthOptions += `<option value="${i}" ${i === now.getMonth() ? 'selected' : ''}>${monthNames[i]}</option>`;
    let yearOptions = '';
    for (let i = 0; i < 5; i++) { const year = now.getFullYear() - i; yearOptions += `<option value="${year}">${year}</option>`; }

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Reporte Financiero</h2><button id="close-report-range-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button></div>
            <form id="report-range-form" class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div><label class="block text-sm">Mes Inicio</label><select id="report-start-month" class="w-full p-2 border rounded-lg">${monthOptions}</select></div>
                    <div><label class="block text-sm">Año Inicio</label><select id="report-start-year" class="w-full p-2 border rounded-lg">${yearOptions}</select></div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div><label class="block text-sm">Mes Fin</label><select id="report-end-month" class="w-full p-2 border rounded-lg">${monthOptions}</select></div>
                    <div><label class="block text-sm">Año Fin</label><select id="report-end-year" class="w-full p-2 border rounded-lg">${yearOptions}</select></div>
                </div>
                <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 rounded-lg hover:bg-blue-700">Generar Reporte PDF</button>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-report-range-modal').addEventListener('click', hideModal);
    document.getElementById('report-range-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const startMonth = parseInt(document.getElementById('report-start-month').value);
        const startYear = parseInt(document.getElementById('report-start-year').value);
        const endMonth = parseInt(document.getElementById('report-end-month').value);
        const endYear = parseInt(document.getElementById('report-end-year').value);
        generateSummaryPDF(startYear, startMonth, endYear, endMonth);
        hideModal();
    });
}

function generateSummaryPDF(startYear, startMonth, endYear, endMonth) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        return showModalMessage("Error: jsPDF no está cargado correctamente.", "error");
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const startDate = new Date(startYear, startMonth, 1);
    const endDate = new Date(endYear, endMonth + 1, 0);

    const rangeTitle = `${monthNames[startMonth]} ${startYear} - ${monthNames[endMonth]} ${endYear}`;
    doc.setFontSize(20);
    doc.text(`Reporte Financiero: ${rangeTitle}`, 105, 20, { align: "center" });

    const accountBalances = {};
    METODOS_DE_PAGO.forEach(metodo => { accountBalances[metodo] = initialBalances[metodo] || 0; });

    const salesInRange = allRemisiones.flatMap(r => r.payments || []).filter(p => { const d = new Date(p.date); return d >= startDate && d <= endDate; }).reduce((sum, p) => sum + p.amount, 0);
    const expensesInRange = allGastos.filter(g => { const d = new Date(g.fecha); return d >= startDate && d <= endDate; }).reduce((sum, g) => sum + g.valorTotal, 0);
    const profitInRange = salesInRange - expensesInRange;

    const summaryData = [
        ['Ventas Totales en el Período', formatCurrency(salesInRange)],
        ['Gastos Totales en el Período', formatCurrency(expensesInRange)],
        ['Utilidad/Pérdida Total', formatCurrency(profitInRange)],
    ];

    if(doc.autoTable) {
        doc.autoTable({ startY: 30, head: [['Resumen del Período', 'Valor']], body: summaryData, theme: 'grid', headStyles: { fillColor: [41, 128, 185] } });
    }

    const monthlyData = [];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        
        const monthlySales = allRemisiones.flatMap(r => r.payments || []).filter(p => { const d = new Date(p.date); return d.getMonth() === month && d.getFullYear() === year; }).reduce((sum, p) => sum + p.amount, 0);
        const monthlyExpenses = allGastos.filter(g => { const d = new Date(g.fecha); return d.getMonth() === month && d.getFullYear() === year; }).reduce((sum, g) => sum + g.valorTotal, 0);
        const monthlyProfit = monthlySales - monthlyExpenses;
        const endOfMonth = new Date(year, month + 1, 0);
        const carteraAtEndOfMonth = allRemisiones.filter(r => new Date(r.fechaRecibido) <= endOfMonth && r.estado !== 'Anulada').reduce((sum, r) => { const totalPagado = (r.payments || []).filter(p => new Date(p.date) <= endOfMonth).reduce((s, p) => s + p.amount, 0); const saldo = r.valorTotal - totalPagado; return sum + (saldo > 0 ? saldo : 0); }, 0);

        monthlyData.push([`${monthNames[month]} ${year}`, formatCurrency(monthlySales), formatCurrency(monthlyExpenses), formatCurrency(monthlyProfit), formatCurrency(carteraAtEndOfMonth)]);
        currentDate.setMonth(currentDate.getMonth() + 1);
    }

    if(doc.autoTable) {
        doc.autoTable({ startY: doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 70, head: [['Mes', 'Ventas', 'Gastos', 'Utilidad/Pérdida', 'Cartera al Cierre']], body: monthlyData, theme: 'striped', headStyles: { fillColor: [22, 160, 133] } });
    }

    allRemisiones.forEach(r => (r.payments || []).forEach(p => { if (accountBalances[p.method] !== undefined) accountBalances[p.method] += p.amount; }));
    allGastos.forEach(g => { if (accountBalances[g.fuentePago] !== undefined) accountBalances[g.fuentePago] -= g.valorTotal; });

    const totalCartera = allRemisiones.filter(r => r.estado !== 'Anulada').reduce((sum, r) => { const totalPagado = (r.payments || []).reduce((s, p) => s + p.amount, 0); const saldo = r.valorTotal - totalPagado; return sum + (saldo > 0 ? saldo : 0); }, 0);

    const accountData = METODOS_DE_PAGO.map(metodo => [metodo, formatCurrency(accountBalances[metodo])]);
    accountData.push(['Cartera Total Pendiente', formatCurrency(totalCartera)]);

    if(doc.autoTable) {
        doc.autoTable({ startY: doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 150, head: [['Saldos y Totales Actuales', 'Valor']], body: accountData, theme: 'grid', headStyles: { fillColor: [41, 128, 185] } });
    }

    doc.save(`Reporte-Financiero-${startYear}-${startMonth + 1}_a_${endYear}-${endMonth + 1}.pdf`);
}