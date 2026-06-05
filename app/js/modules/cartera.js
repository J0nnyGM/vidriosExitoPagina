import {
    collection, query, where, getDocs, orderBy, limit, onSnapshot, doc, getDoc,
    addDoc, serverTimestamp, updateDoc, increment, collectionGroup // <-- AÑADIR ESTA
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
// Variables del Módulo
let _db;
let _showView;
let _currencyFormatter;
let unsubscribeCartera = null;

// Inicializador
export function initCartera(db, showView) {
    _db = db;
    _showView = showView;
    _currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0
    });
}

// Carga la Vista Principal (DISEÑO UNIFICADO)
export function loadCarteraView() {
    _showView('cartera');

    const container = document.getElementById('cartera-content');
    if (!container) return;

    if (unsubscribeCartera) {
        unsubscribeCartera();
        unsubscribeCartera = null;
    }

    // Estructura limpia, igual a Empleados/Dashboard
    container.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-md min-h-[600px]">
            <div class="flex flex-col md:flex-row justify-between items-center mb-6 border-b border-gray-100 pb-4 gap-4">
                <div>
                    <h2 class="text-2xl font-bold text-gray-800 flex items-center">
                        <i class="fa-solid fa-wallet text-indigo-500 mr-3"></i>
                        Gestión de Cartera
                    </h2>
                    <p class="text-sm text-gray-500 mt-1">Control financiero de proyectos y proveedores.</p>
                </div>
                
                <div class="flex bg-gray-100 p-1 rounded-lg">
                    <button onclick="window.switchCarteraTab('resumen')" id="tab-cartera-resumen" class="cartera-nav-btn px-4 py-2 text-sm font-bold rounded-md text-gray-600 hover:text-indigo-600 transition-all">
                        <i class="fa-solid fa-chart-pie mr-2"></i> Resumen
                    </button>
                    <button onclick="window.switchCarteraTab('cobrar')" id="tab-cartera-cobrar" class="cartera-nav-btn px-4 py-2 text-sm font-bold rounded-md text-gray-600 hover:text-indigo-600 transition-all">
                        <i class="fa-solid fa-hand-holding-dollar mr-2"></i> Clientes (Cobrar)
                    </button>
                    <button onclick="window.switchCarteraTab('pagar')" id="tab-cartera-pagar" class="cartera-nav-btn px-4 py-2 text-sm font-bold rounded-md text-gray-600 hover:text-red-600 transition-all">
                        <i class="fa-solid fa-file-invoice-dollar mr-2"></i> Proveedores (Pagar)
                    </button>
                </div>
            </div>

            <div id="cartera-dynamic-area" class="relative min-h-[400px]">
                <div class="flex justify-center items-center h-64"><div class="loader"></div></div>
            </div>
        </div>
    `;

    // Función de navegación
    window.switchCarteraTab = (tab) => {
        document.querySelectorAll('.cartera-nav-btn').forEach(btn => {
            btn.classList.remove('bg-white', 'shadow-sm', 'text-gray-800', 'text-indigo-600', 'text-red-600');
            btn.classList.add('text-gray-500');
        });

        const activeBtn = document.getElementById(`tab-cartera-${tab}`);
        if (activeBtn) {
            activeBtn.classList.add('bg-white', 'shadow-sm');
            activeBtn.classList.remove('text-gray-500');
            if (tab === 'pagar') activeBtn.classList.add('text-red-600');
            else activeBtn.classList.add('text-indigo-600');
        }

        const area = document.getElementById('cartera-dynamic-area');
        switch (tab) {
            case 'resumen': renderResumenTab(area); break;
            case 'cobrar': renderCuentasPorCobrarTab(area); break; // Aquí está la lógica corregida abajo
            case 'pagar': renderCuentasPorPagarTab(area); break;
        }
    };

    window.switchCarteraTab('resumen');
}


// ----------------------------------------------------------
// FASE 1: RESUMEN GENERAL (DASHBOARD CON GRÁFICOS) - CORREGIDO
// ----------------------------------------------------------
async function renderResumenTab(container) {
    // 1. Mostrar estructura con estado de carga
    container.innerHTML = `
        <div class="animate-pulse space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="bg-gray-200 h-32 rounded-xl"></div>
                <div class="bg-gray-200 h-32 rounded-xl"></div>
                <div class="bg-gray-200 h-32 rounded-xl"></div>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="bg-gray-200 h-64 rounded-xl"></div>
                <div class="bg-gray-200 h-64 rounded-xl"></div>
            </div>
        </div>
    `;

    const parseMoney = (val) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        const clean = String(val).replace(/[^0-9.-]+/g, "");
        return parseFloat(clean) || 0;
    };

    try {
        // 2. Consultas en Paralelo
        const [projectsSnap, cortesSnap, paymentsSnap, poSnap] = await Promise.all([
            getDocs(query(collection(_db, "projects"))),
            getDocs(query(collectionGroup(_db, 'cortes'), where('status', '==', 'aprobado'))),
            getDocs(query(collectionGroup(_db, 'payments'))),
            getDocs(query(collection(_db, "purchaseOrders"))) 
        ]);

        // --- A. CALCULAR CUENTAS POR COBRAR (CLIENTES) ---
        const sumPagosPorProyecto = {};
        paymentsSnap.forEach(doc => {
            const data = doc.data();
            const pid = doc.ref.parent.parent.id;
            if (!data.type || data.type === 'abono_anticipo' || data.type === 'abono_cartera') {
                 const monto = parseMoney(data.amount || 0);
                 if (!sumPagosPorProyecto[pid]) sumPagosPorProyecto[pid] = 0;
                 sumPagosPorProyecto[pid] += monto;
            }
        });

        const sumCortesNetosPorProyecto = {};
        cortesSnap.forEach(doc => {
            const data = doc.data();
            const pid = doc.ref.parent.parent.id;
            const bruto = parseMoney(data.totalValue || 0);
            const amortizacion = parseMoney(data.amortizacion || 0);
            let descuentos = 0;
            if (data.otrosDescuentos && Array.isArray(data.otrosDescuentos)) {
                data.otrosDescuentos.forEach(d => descuentos += parseMoney(d.value));
            }
            const valorNetoDeuda = bruto - amortizacion - descuentos;
            if (!sumCortesNetosPorProyecto[pid]) sumCortesNetosPorProyecto[pid] = 0;
            sumCortesNetosPorProyecto[pid] += valorNetoDeuda;
        });

        let totalCobrar = 0;
        const pendingList = []; // Lista para vencimientos

        projectsSnap.forEach(doc => {
            const p = doc.data();
            const pid = doc.id;
            const anticipoPactado = parseMoney(p.advance || p.anticipo || 0);
            const deudaCortes = sumCortesNetosPorProyecto[pid] || 0;
            const totalExigible = anticipoPactado + deudaCortes;
            const totalPagado = sumPagosPorProyecto[pid] || 0;
            const deudaProyecto = totalExigible - totalPagado;

            if (deudaProyecto > 1000) {
                totalCobrar += deudaProyecto;
                pendingList.push({
                    type: 'cobrar',
                    title: p.name || 'Proyecto Sin Nombre',
                    entity: p.clientName || 'Cliente General',
                    amount: deudaProyecto,
                    date: p.createdAt ? p.createdAt.toDate() : new Date() 
                });
            }
        });

        // --- B. CALCULAR CUENTAS POR PAGAR (PROVEEDORES) ---
        let totalPagar = 0;
        
        poSnap.forEach(doc => {
            const po = doc.data();
            const totalOrden = parseMoney(po.totalCost || 0);
            const pagadoOrden = parseMoney(po.paidAmount || 0);
            const deudaOrden = totalOrden - pagadoOrden;
            const isValid = !['rechazada', 'cancelada', 'anulada'].includes(po.status);
            
            if (deudaOrden > 100 && isValid) {
                totalPagar += deudaOrden;
                 pendingList.push({
                    type: 'pagar',
                    title: `Orden #${po.poNumber || 'N/A'}`,
                    entity: po.provider || po.supplierName || 'Proveedor',
                    amount: deudaOrden,
                    date: po.createdAt ? po.createdAt.toDate() : new Date()
                });
            }
        });

        // --- C. PREPARAR DATOS PARA VISTAS ---
        const balance = totalCobrar - totalPagar;

        // 1. Datos para el Gráfico
        const maxVal = Math.max(totalCobrar, totalPagar, 1);
        const heightCobrar = Math.round((totalCobrar / maxVal) * 100);
        const heightPagar = Math.round((totalPagar / maxVal) * 100);

        // 2. Datos para la Lista
        pendingList.sort((a, b) => a.date - b.date);
        const topPending = pendingList.slice(0, 5); 

        // 3. Calcular TAB DESTINO (Corrección del error)
        // Determinamos aquí a qué pestaña debe ir el botón, en lugar de hacerlo en el HTML
        const targetTab = (topPending.length > 0 && topPending[0].type === 'cobrar') ? 'cobrar' : 'pagar';

        // 4. Renderizar HTML Final
        container.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 cursor-pointer hover:border-green-300 transition-all group" onclick="window.switchCarteraTab('cobrar')">
                    <div class="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center text-2xl text-green-600 group-hover:scale-110 transition-transform">
                        <i class="fa-solid fa-arrow-trend-up"></i>
                    </div>
                    <div>
                        <p class="text-sm text-gray-500 font-medium">Por Cobrar (Clientes)</p>
                        <h3 class="text-2xl font-bold text-gray-800">${_currencyFormatter.format(totalCobrar)}</h3>
                    </div>
                </div>

                <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 cursor-pointer hover:border-red-300 transition-all group" onclick="window.switchCarteraTab('pagar')">
                    <div class="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center text-2xl text-red-600 group-hover:scale-110 transition-transform">
                        <i class="fa-solid fa-arrow-trend-down"></i>
                    </div>
                    <div>
                        <p class="text-sm text-gray-500 font-medium">Por Pagar (Proveedores)</p>
                        <h3 class="text-2xl font-bold text-gray-800">${_currencyFormatter.format(totalPagar)}</h3>
                    </div>
                </div>

                <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div class="w-14 h-14 rounded-full bg-indigo-50 flex items-center justify-center text-2xl text-indigo-600">
                        <i class="fa-solid fa-scale-balanced"></i>
                    </div>
                    <div>
                        <p class="text-sm text-gray-500 font-medium">Balance Proyectado</p>
                        <h3 class="text-2xl font-bold ${balance >= 0 ? 'text-indigo-600' : 'text-red-500'}">
                            ${_currencyFormatter.format(balance)}
                        </h3>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                <div class="bg-white p-6 rounded-xl shadow border border-gray-100 min-h-[300px] flex flex-col">
                    <h4 class="font-bold text-gray-700 mb-6 flex items-center gap-2">
                        <i class="fa-solid fa-chart-simple text-indigo-500"></i> Flujo de Caja Actual
                    </h4>
                    
                    <div class="flex-grow flex items-end justify-center gap-12 px-8 pb-4 border-b border-gray-100">
                        <div class="flex flex-col items-center gap-2 group w-24">
                            <span class="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity mb-1 transform translate-y-2 group-hover:translate-y-0 duration-300">
                                ${_currencyFormatter.format(totalCobrar)}
                            </span>
                            <div class="w-full bg-green-100 rounded-t-lg relative overflow-hidden group-hover:bg-green-200 transition-colors" style="height: 200px">
                                <div class="absolute bottom-0 w-full bg-green-500 rounded-t-lg transition-all duration-1000 ease-out hover:bg-green-600" style="height: ${heightCobrar}%"></div>
                            </div>
                            <span class="text-sm font-bold text-gray-500">Entradas</span>
                        </div>

                        <div class="flex flex-col items-center gap-2 group w-24">
                            <span class="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity mb-1 transform translate-y-2 group-hover:translate-y-0 duration-300">
                                ${_currencyFormatter.format(totalPagar)}
                            </span>
                            <div class="w-full bg-red-100 rounded-t-lg relative overflow-hidden group-hover:bg-red-200 transition-colors" style="height: 200px">
                                <div class="absolute bottom-0 w-full bg-red-500 rounded-t-lg transition-all duration-1000 ease-out hover:bg-red-600" style="height: ${heightPagar}%"></div>
                            </div>
                            <span class="text-sm font-bold text-gray-500">Salidas</span>
                        </div>
                    </div>
                    <p class="text-xs text-center text-gray-400 mt-4">Comparativa visual de cuentas pendientes</p>
                </div>

                <div class="bg-white p-6 rounded-xl shadow border border-gray-100 min-h-[300px] flex flex-col">
                    <h4 class="font-bold text-gray-700 mb-4 flex items-center gap-2">
                        <i class="fa-regular fa-clock text-orange-500"></i> Pendientes Más Antiguos
                    </h4>
                    
                    <div class="flex-grow overflow-y-auto custom-scrollbar pr-2">
                        ${topPending.length === 0 ? `
                            <div class="h-full flex flex-col items-center justify-center text-gray-400">
                                <i class="fa-solid fa-check-double text-4xl mb-2 text-green-100"></i>
                                <p class="text-sm">Todo está al día</p>
                            </div>
                        ` : `
                            <div class="space-y-3">
                                ${topPending.map(item => `
                                    <div class="flex items-center justify-between p-3 rounded-lg border border-gray-50 hover:border-gray-200 hover:bg-gray-50 transition-all cursor-pointer group"
                                         onclick="window.switchCarteraTab('${item.type}')">
                                        <div class="flex items-center gap-3 min-w-0">
                                            <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${item.type === 'cobrar' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}">
                                                <i class="fa-solid ${item.type === 'cobrar' ? 'fa-hand-holding-dollar' : 'fa-file-invoice'}"></i>
                                            </div>
                                            <div class="min-w-0">
                                                <p class="text-sm font-bold text-gray-800 truncate">${item.title}</p>
                                                <p class="text-xs text-gray-500 truncate">${item.entity}</p>
                                            </div>
                                        </div>
                                        <div class="text-right flex-shrink-0">
                                            <p class="text-sm font-bold ${item.type === 'cobrar' ? 'text-green-600' : 'text-red-600'}">
                                                ${_currencyFormatter.format(item.amount)}
                                            </p>
                                            <p class="text-[10px] text-gray-400 flex items-center justify-end gap-1">
                                                <i class="fa-regular fa-calendar"></i> ${item.date.toLocaleDateString('es-CO')}
                                            </p>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        `}
                    </div>
                    <button onclick="window.switchCarteraTab('${targetTab}')" class="mt-4 w-full py-2 text-xs font-bold text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">
                        Ver Gestión Completa
                    </button>
                </div>
            </div>
        `;

    } catch (error) {
        console.error("Error cargando resumen de cartera:", error);
        container.innerHTML = `
            <div class="p-6 bg-red-50 border border-red-200 rounded-xl text-center text-red-600">
                <p class="font-bold">Error al cargar el resumen financiero</p>
                <p class="text-sm">${error.message}</p>
            </div>
        `;
    }
}

// ----------------------------------------------------------
// FASE 3: CUENTAS POR PAGAR (PROVEEDORES)
// ----------------------------------------------------------
async function renderCuentasPorPagarTab(container) {
    // Estructura base (modificada para mostrar Proveedores en lugar de Facturas en el título)
    container.innerHTML = `
        <div class="space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-white p-5 rounded-xl shadow border border-gray-200 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 text-xl">
                        <i class="fa-solid fa-users-rectangle"></i>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-gray-500 uppercase">Total Deuda Proveedores</p>
                        <h3 id="total-payable-display" class="text-2xl font-bold text-gray-800">$ 0</h3>
                    </div>
                </div>
                <div class="bg-white p-5 rounded-xl shadow border border-gray-200 flex flex-col justify-center">
                    <label class="text-xs font-bold text-gray-400 uppercase mb-1">Buscar Proveedor</label>
                    <input type="text" id="payable-search" class="w-full border-b border-gray-300 focus:border-orange-500 outline-none py-1 text-sm" placeholder="Nombre o NIT...">
                </div>
            </div>

            <div class="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
                <div class="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h3 class="font-bold text-gray-700">Proveedores con Saldo Pendiente</h3>
                    <span class="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded font-bold" id="payable-count-badge">Cargando...</span>
                </div>
                <div id="payable-list" class="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                    <div class="text-center py-12"><div class="loader mx-auto"></div><p class="text-gray-400 mt-2">Agrupando deudas...</p></div>
                </div>
            </div>
        </div>
    `;

    const listContainer = document.getElementById('payable-list');
    const totalDisplay = document.getElementById('total-payable-display');
    const countBadge = document.getElementById('payable-count-badge');
    const searchInput = document.getElementById('payable-search');

    const parseMoney = (val) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        const clean = String(val).replace(/[^0-9.-]+/g, "");
        return parseFloat(clean) || 0;
    };

    try {
        const q = query(collection(_db, "purchaseOrders"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);

        const suppliersMap = {}; // Objeto para agrupar: { supplierId: { ...datos, orders: [] } }
        let totalGlobalDebt = 0;

        snapshot.forEach(doc => {
            const po = doc.data();
            const total = parseMoney(po.totalCost || 0);
            const paid = parseMoney(po.paidAmount || 0);
            const debt = total - paid;
            const isValidStatus = !['rechazada', 'cancelada', 'anulada'].includes(po.status);

            if (debt > 100 && isValidStatus) {
                const supplierId = po.supplierId || 'unknown';
                const supplierName = po.provider || po.supplierName || "Proveedor General";
                const poInfo = {
                    id: doc.id,
                    poNumber: po.poNumber || doc.id.substr(0, 6).toUpperCase(),
                    date: po.createdAt ? po.createdAt.toDate().toLocaleDateString('es-CO') : 'N/A',
                    total: total,
                    paid: paid,
                    debt: debt
                };

                if (!suppliersMap[supplierId]) {
                    suppliersMap[supplierId] = {
                        id: supplierId,
                        name: supplierName,
                        totalDebt: 0,
                        count: 0,
                        orders: []
                    };
                }

                suppliersMap[supplierId].totalDebt += debt;
                suppliersMap[supplierId].count += 1;
                suppliersMap[supplierId].orders.push(poInfo);
                totalGlobalDebt += debt;
            }
        });

        // Convertir a array y ordenar por deuda mayor
        const suppliersList = Object.values(suppliersMap).sort((a, b) => b.totalDebt - a.totalDebt);

        totalDisplay.textContent = _currencyFormatter.format(totalGlobalDebt);
        countBadge.textContent = `${suppliersList.length} Proveedores`;

        const renderRows = (items) => {
            listContainer.innerHTML = '';
            if (items.length === 0) {
                listContainer.innerHTML = `<div class="p-10 text-center flex flex-col items-center"><i class="fa-solid fa-check-circle text-4xl text-green-200 mb-3"></i><p class="text-gray-500">No hay deudas pendientes.</p></div>`;
                return;
            }

            items.forEach(supplier => {
                const row = document.createElement('div');
                row.className = "p-4 hover:bg-orange-50 transition-colors group flex flex-col sm:flex-row justify-between items-center gap-4";

                // Convertimos el array de órdenes a string JSON para pasar al modal de detalles
                // (Usamos encodeURIComponent para evitar problemas con comillas en el HTML)
                const ordersJson = encodeURIComponent(JSON.stringify(supplier.orders));

                row.innerHTML = `
                    <div class="flex-1 w-full cursor-pointer" onclick="window.openSupplierOrdersModal('${supplier.name}', '${ordersJson}')">
                        <div class="flex justify-between mb-1">
                            <div>
                                <h4 class="font-bold text-gray-800 text-base flex items-center">
                                    <i class="fa-solid fa-building mr-2 text-gray-400"></i> ${supplier.name}
                                </h4>
                                <p class="text-xs text-blue-600 hover:underline mt-1">
                                    Ver ${supplier.count} órdenes pendientes <i class="fa-solid fa-arrow-right text-[10px]"></i>
                                </p>
                            </div>
                            <div class="text-right">
                                <p class="text-[10px] text-gray-400 uppercase font-bold">Total a Pagar</p>
                                <p class="text-xl font-bold text-orange-600">${_currencyFormatter.format(supplier.totalDebt)}</p>
                            </div>
                        </div>
                    </div>

                    <button class="btn-pay-supplier bg-orange-600 text-white hover:bg-orange-700 px-5 py-2 rounded-lg text-sm font-bold transition-all shadow-md flex items-center whitespace-nowrap"
                        data-supplier-id="${supplier.id}" data-supplier="${supplier.name}" data-debt="${supplier.totalDebt}">
                        <i class="fa-solid fa-money-bill-wave mr-2"></i> Abonar
                    </button>
                `;

                // Listener para el botón de pago (FIFO)
                row.querySelector('.btn-pay-supplier').addEventListener('click', (e) => {
                    e.stopPropagation(); // Evitar abrir el detalle al hacer click en pagar
                    const btn = e.currentTarget;
                    openRegisterExpenseModal(btn.dataset.supplierId, btn.dataset.supplier, parseFloat(btn.dataset.debt));
                });

                listContainer.appendChild(row);
            });
        };

        renderRows(suppliersList);

        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = suppliersList.filter(s => s.name.toLowerCase().includes(term));
            renderRows(filtered);
        });

    } catch (error) {
        console.error("Error Cartera Pagar:", error);
        listContainer.innerHTML = `<div class="p-6 text-center text-red-500">Error: ${error.message}</div>`;
    }
}

/**
 * Modal Flotante para Registrar Egreso (Pago a Proveedor)
 */
function openRegisterExpenseModal(supplierId, supplierName, currentDebt) {
    const overlay = document.createElement('div');
    overlay.className = "fixed inset-0 bg-gray-900 bg-opacity-50 z-[70] flex items-center justify-center opacity-0 transition-opacity duration-300";

    const modalHtml = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 transform scale-95 transition-transform duration-300">
            <div class="flex justify-between items-center mb-4 border-b border-gray-100 pb-2">
                <h3 class="text-lg font-bold text-gray-800">Registrar Pago a Proveedor</h3>
                <button id="close-exp-modal" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-xl"></i></button>
            </div>
            
            <div class="bg-orange-50 p-3 rounded-lg mb-4 text-center border border-orange-100">
                <p class="text-xs text-orange-500 uppercase font-bold">Proveedor</p>
                <p class="font-bold text-gray-800 truncate">${supplierName}</p>
                <p class="text-xs text-gray-500 mt-1">Deuda Total: <span class="font-bold text-red-500">${_currencyFormatter.format(currentDebt)}</span></p>
            </div>

            <form id="form-register-expense" class="space-y-4">
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Valor a Pagar</label>
                    <div class="relative">
                        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                        <input type="text" id="expense-amount" required class="currency-input w-full border-2 border-gray-200 rounded-lg p-3 pl-7 text-xl font-bold text-gray-700 focus:border-orange-400 outline-none" placeholder="0">
                    </div>
                </div>
                
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Pago</label>
                        <input type="date" id="expense-date" required class="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white" value="${new Date().toISOString().split('T')[0]}">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Método de Pago</label>
                        <select id="expense-method" required class="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white focus:border-orange-500 outline-none">
                            <option value="Transferencia">Transferencia</option>
                            <option value="Efectivo">Efectivo</option>
                            <option value="Tarjeta">Tarjeta</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Referencia / Nota (Opcional)</label>
                    <input type="text" id="expense-note" class="w-full border border-gray-300 rounded-lg p-2 text-sm" placeholder="Ej: Comprobante #1234">
                </div>

                <button type="submit" class="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 rounded-lg shadow-md transition-transform active:scale-95 flex justify-center items-center">
                    <i class="fa-solid fa-paper-plane mr-2"></i> Confirmar Pago
                </button>
            </form>
        </div>
    `;

    overlay.innerHTML = modalHtml;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        overlay.querySelector('div').classList.remove('scale-95');
        overlay.querySelector('div').classList.add('scale-100');
    });

    const close = () => {
        overlay.classList.add('opacity-0');
        setTimeout(() => overlay.remove(), 300);
    };

    const amountInput = overlay.querySelector('#expense-amount');
    amountInput.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, '');
        if (val) e.target.value = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0 }).format(val);
    });

    overlay.querySelector('#close-exp-modal').onclick = close;

    overlay.querySelector('#form-register-expense').onsubmit = async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        const rawAmount = amountInput.value.replace(/[$. ]/g, '');
        const amountToPay = parseFloat(rawAmount);
        const date = overlay.querySelector('#expense-date').value;

        // Capturamos los nuevos campos
        const method = overlay.querySelector('#expense-method').value;
        const noteText = overlay.querySelector('#expense-note').value.trim();
        const finalNote = noteText ? `${method} - ${noteText}` : method; // Combinamos para el historial

        if (!amountToPay || amountToPay <= 0) { alert("Monto inválido"); return; }

        btn.disabled = true;
        btn.textContent = "Distribuyendo pago...";

        try {
            // 1. Buscar órdenes pendientes (FIFO)
            const q = query(
                collection(_db, "purchaseOrders"),
                where("supplierId", "==", supplierId),
                orderBy("createdAt", "asc")
            );

            const snapshot = await getDocs(q);
            let remainingMoney = amountToPay;
            let billsPaidCount = 0;

            // 2. Distribuir pago
            for (const docSnap of snapshot.docs) {
                if (remainingMoney <= 0) break;

                const po = docSnap.data();
                const total = po.totalCost || 0;
                const paid = po.paidAmount || 0;
                const debt = total - paid;

                if (debt <= 100) continue;

                const paymentForThisBill = Math.min(remainingMoney, debt);

                // Guardamos el pago con los datos estructurados
                await addDoc(collection(_db, "purchaseOrders", docSnap.id, "payments"), {
                    amount: paymentForThisBill,
                    date: date,
                    paymentMethod: method, // Guardamos el método específico
                    note: `${finalNote} (Auto)`,
                    createdAt: serverTimestamp(),
                    createdBy: 'admin'
                });

                await updateDoc(doc(_db, "purchaseOrders", docSnap.id), {
                    paidAmount: increment(paymentForThisBill),
                    status: (Math.abs(debt - paymentForThisBill) < 100) ? 'pagada' : (po.status === 'pendiente' ? 'parcial' : po.status)
                });

                remainingMoney -= paymentForThisBill;
                billsPaidCount++;
            }

            if (billsPaidCount === 0) {
                alert("El proveedor no tiene deudas pendientes antiguas para aplicar este pago.");
            } else {
                let msg = `Pago de ${_currencyFormatter.format(amountToPay - remainingMoney)} aplicado a ${billsPaidCount} orden(es).`;
                if (remainingMoney > 0) msg += `\nSaldo a favor restante: ${_currencyFormatter.format(remainingMoney)}`;
                alert(msg);
            }

            close();

            const currentTabBtn = document.getElementById('tab-cartera-pagar');
            if (currentTabBtn) currentTabBtn.click();

        } catch (error) {
            console.error("Error distribuyendo pago:", error);
            alert("Error al procesar el pago: " + error.message);
            btn.disabled = false;
            btn.textContent = "Confirmar Pago";
        }
    };
}

// ----------------------------------------------------------
// FASE 2: CUENTAS POR COBRAR (SINCRONIZACIÓN REAL CORREGIDA)
// ----------------------------------------------------------
async function renderCuentasPorCobrarTab(container) {
    // 1. Estructura HTML
    container.innerHTML = `
        <div class="space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-white p-5 rounded-xl shadow border border-gray-200 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-xl">
                        <i class="fa-solid fa-hand-holding-dollar"></i>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-gray-500 uppercase">Total por Cobrar (Exigible)</p>
                        <h3 id="total-receivable-display" class="text-2xl font-bold text-gray-800">$ 0</h3>
                    </div>
                </div>
                <div class="bg-white p-5 rounded-xl shadow border border-gray-200 flex flex-col justify-center">
                    <label class="text-xs font-bold text-gray-400 uppercase mb-1">Buscar Proyecto</label>
                    <input type="text" id="cartera-search" class="w-full border-b border-gray-300 focus:border-indigo-500 outline-none py-1 text-sm" placeholder="Escribe nombre del cliente...">
                </div>
            </div>

            <div class="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
                <div class="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h3 class="font-bold text-gray-700">Estado de Cuenta (Cortes + Anticipos)</h3>
                    <span class="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded font-bold" id="project-count-badge">Calculando...</span>
                </div>
                <div id="receivables-list" class="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                    <div class="text-center py-12"><div class="loader mx-auto"></div><p class="text-gray-400 mt-2">Sincronizando con Proyectos...</p></div>
                </div>
            </div>
        </div>
    `;

    const listContainer = document.getElementById('receivables-list');
    const totalDisplay = document.getElementById('total-receivable-display');
    const countBadge = document.getElementById('project-count-badge');
    const searchInput = document.getElementById('cartera-search');

    const parseMoney = (val) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        const clean = String(val).replace(/[^0-9.-]+/g, "");
        return parseFloat(clean) || 0;
    };

    try {
        // A. Traer TODOS los Proyectos
        const projectsQuery = query(collection(_db, "projects"), orderBy("createdAt", "desc"));
        const projectsSnap = await getDocs(projectsQuery);

        // B. Traer TODOS los Cortes Aprobados (Global)
        const cortesQuery = query(collectionGroup(_db, 'cortes'), where('status', '==', 'aprobado'));
        const cortesSnap = await getDocs(cortesQuery);

        // C. Traer TODOS los Pagos (Global - Optimización para evitar N lecturas)
        // Nota: Si son muchos pagos, esto podría ser pesado. Lo ideal sería índices compuestos.
        // Por ahora, para garantizar precisión, traemos todo 'payment' group.
        const paymentsQuery = query(collectionGroup(_db, 'payments'));
        const paymentsSnap = await getDocs(paymentsQuery);

        // Mapa para sumar cortes NETOS (Valor Bruto - Amortización - Descuentos)
        const sumCortesNetosPorProyecto = {};
        
        cortesSnap.forEach(doc => {
            const data = doc.data();
            // El padre.parent.id es el ID del proyecto
            const pid = doc.ref.parent.parent.id;
            
            const bruto = parseMoney(data.totalValue || 0);
            const amortizacion = parseMoney(data.amortizacion || 0);
            
            // Sumar otros descuentos si existen
            let descuentos = 0;
            if (data.otrosDescuentos && Array.isArray(data.otrosDescuentos)) {
                data.otrosDescuentos.forEach(d => descuentos += parseMoney(d.value));
            }

            // CORRECCIÓN: Lo que se debe de este corte es el Bruto MENOS lo que se mató con anticipo MENOS descuentos
            const valorGeneradorDeuda = bruto - amortizacion - descuentos;

            if (!sumCortesNetosPorProyecto[pid]) sumCortesNetosPorProyecto[pid] = 0;
            sumCortesNetosPorProyecto[pid] += valorGeneradorDeuda;
        });

        // Mapa para sumar Pagos Reales
        const sumPagosPorProyecto = {};
        paymentsSnap.forEach(doc => {
            const data = doc.data();
            // El payment suele estar en projects/{pid}/payments/{payId} -> ref.parent.parent.id
            const pid = doc.ref.parent.parent.id;
            // Solo sumamos ingresos reales (abonos, anticipos pagados)
            // Filtramos si hay pagos anulados si tuvieras ese estado
            const monto = parseMoney(data.amount || 0);
            
            if (!sumPagosPorProyecto[pid]) sumPagosPorProyecto[pid] = 0;
            sumPagosPorProyecto[pid] += monto;
        });

        let totalGlobalDebt = 0;
        const dataList = [];

        // D. Cruzar la información
        projectsSnap.forEach(doc => {
            const p = doc.data();
            const pid = doc.id;

            // 1. Anticipo Pactado (Deuda Inicial)
            // Se asume que el anticipo se convierte en deuda exigible apenas se crea el proyecto (o cuando se pacta)
            // Si el anticipo no se ha pagado, es deuda. Si se pagó, entra en 'sumPagosPorProyecto'.
            const anticipoPactado = parseMoney(p.advance || p.anticipo || p.downPayment || 0);

            // 2. Suma de Cortes (Ya descontando amortizaciones para no duplicar deuda)
            const deudaPorCortes = sumCortesNetosPorProyecto[pid] || 0;

            // 3. Total Exigible (Lo que debieron habernos pagado en total hasta hoy)
            const totalExigible = anticipoPactado + deudaPorCortes;

            // 4. Total Recaudado Real (Lo que realmente entró al banco/caja)
            const totalPagado = sumPagosPorProyecto[pid] || 0;

            // 5. Deuda Real
            const deuda = totalExigible - totalPagado;

            // Filtro visual: Mostrar si hay deuda > 1000 pesos o si es un proyecto activo con movimientos
            if (deuda > 1000 || (totalExigible > 0 && deuda !== 0)) {
                
                // Porcentaje de recaudo
                const progress = totalExigible > 0 ? (totalPagado / totalExigible) * 100 : 0;

                dataList.push({
                    id: pid,
                    name: p.name || "Sin Nombre",
                    client: p.clientName || "Cliente General",
                    deuda: deuda,
                    progress: progress,
                    cortesNetos: deudaPorCortes,
                    anticipo: anticipoPactado,
                    pagado: totalPagado
                });

                if (deuda > 0) totalGlobalDebt += deuda;
            }
        });

        // Ordenar por deuda descendente
        dataList.sort((a, b) => b.deuda - a.deuda);

        totalDisplay.textContent = _currencyFormatter.format(totalGlobalDebt);
        countBadge.textContent = `${dataList.length} Proyectos`;

        // E. Renderizar
        const renderRows = (items) => {
            listContainer.innerHTML = '';
            if (items.length === 0) {
                listContainer.innerHTML = `<div class="p-8 text-center text-gray-400">No hay cartera pendiente.</div>`;
                return;
            }

            items.forEach(item => {
                const row = document.createElement('div');
                row.className = "p-4 hover:bg-gray-50 transition-colors group flex flex-col md:flex-row justify-between items-center gap-4 border-b border-gray-100 last:border-0";

                const barColor = item.progress >= 100 ? 'bg-green-500' : (item.progress > 50 ? 'bg-yellow-400' : 'bg-red-500');
                const debtColor = item.deuda > 100 ? 'text-red-600' : 'text-green-600';
                
                // Manejo de saldos a favor (negativos)
                let debtText = _currencyFormatter.format(item.deuda);
                if (item.deuda <= 0 && item.deuda > -1000) debtText = "Paz y Salvo";
                if (item.deuda <= -1000) debtText = `Favor Cliente: ${_currencyFormatter.format(Math.abs(item.deuda))}`;

                row.innerHTML = `
                    <div class="flex-1 w-full min-w-0 cursor-pointer select-none" 
                         onclick="window.openClientPaymentsModal('${item.id}', '${item.name}')"
                         title="Clic para ver historial de pagos">
                        
                        <div class="flex justify-between mb-1">
                            <div class="min-w-0 pr-2">
                                <h4 class="font-bold text-gray-800 text-sm truncate flex items-center group-hover:text-indigo-600 transition-colors">
                                    ${item.name}
                                    <i class="fa-solid fa-eye text-[10px] text-gray-300 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"></i>
                                </h4>
                                <p class="text-xs text-gray-500 truncate"><i class="fa-solid fa-user mr-1"></i> ${item.client}</p>
                            </div>
                            <div class="text-right flex-shrink-0">
                                <p class="text-[10px] text-gray-400 uppercase font-bold">Saldo Pendiente</p>
                                <p class="text-lg font-bold ${debtColor}">${debtText}</p>
                            </div>
                        </div>
                        
                        <div class="flex items-center gap-2 mt-1">
                            <div class="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                                <div class="${barColor} h-full rounded-full" style="width: ${Math.min(Math.max(item.progress, 0), 100)}%"></div>
                            </div>
                            <span class="text-xs font-bold text-gray-500">${item.progress.toFixed(0)}%</span>
                        </div>

                        <div class="flex flex-wrap gap-3 mt-2 text-[10px] text-gray-500 bg-gray-50 p-2 rounded border border-gray-100">
                            <span title="Valor pactado de anticipo">🔹 Anticipo: ${_currencyFormatter.format(item.anticipo)}</span>
                            <span title="Valor Neto generado por cortes (Bruto - Amortizaciones)">🏗️ Cortes (Neto): ${_currencyFormatter.format(item.cortesNetos)}</span>
                            <span class="ml-auto text-green-700 font-bold bg-green-50 px-2 rounded">Pagado: ${_currencyFormatter.format(item.pagado)}</span>
                        </div>
                    </div>

                    <button class="btn-abonar bg-white border border-gray-300 text-indigo-600 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm flex-shrink-0 z-10"
                        data-id="${item.id}" data-name="${item.name}" data-debt="${item.deuda}"
                        onclick="event.stopPropagation()"> <i class="fa-solid fa-cash-register mr-1"></i> Registrar Ingreso
                    </button>
                `;

                // Re-bind del evento click
                row.querySelector('.btn-abonar').addEventListener('click', (e) => {
                    openRegisterPaymentModal(e.currentTarget.dataset.id, e.currentTarget.dataset.name, parseFloat(e.currentTarget.dataset.debt));
                });

                listContainer.appendChild(row);
            });
        };

        renderRows(dataList);

        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = dataList.filter(i => i.name.toLowerCase().includes(term) || i.client.toLowerCase().includes(term));
            renderRows(filtered);
        });

    } catch (error) {
        console.error("Error crítico en Cartera:", error);
        listContainer.innerHTML = `<div class="p-6 text-center text-red-500 border-2 border-red-100 rounded-lg bg-red-50">
            <p class="font-bold">Error al sincronizar datos.</p>
            <p class="text-xs mt-1">${error.message}</p>
        </div>`;
    }
}

/**
 * Modal Flotante para Registrar Abono de Cliente
 */
function openRegisterPaymentModal(projectId, projectName, currentDebt) {
    // Usamos una estructura similar a openCustomInputModal pero más compleja
    const overlay = document.createElement('div');
    overlay.className = "fixed inset-0 bg-gray-900 bg-opacity-50 z-[70] flex items-center justify-center opacity-0 transition-opacity duration-300";

    const modalHtml = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 transform scale-95 transition-transform duration-300">
            <div class="flex justify-between items-center mb-4 border-b border-gray-100 pb-2">
                <h3 class="text-lg font-bold text-gray-800">Registrar Ingreso</h3>
                <button id="close-pay-modal" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-xl"></i></button>
            </div>
            
            <div class="bg-indigo-50 p-3 rounded-lg mb-4 text-center">
                <p class="text-xs text-indigo-500 uppercase font-bold">Proyecto</p>
                <p class="font-bold text-indigo-900 truncate">${projectName}</p>
                <p class="text-xs text-gray-500 mt-1">Deuda actual: <span class="font-bold text-red-500">${_currencyFormatter.format(currentDebt)}</span></p>
            </div>

            <form id="form-register-income" class="space-y-4">
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Monto del Abono</label>
                    <input type="text" id="income-amount" required class="currency-input w-full border-2 border-green-100 rounded-lg p-3 text-xl font-bold text-green-700 focus:border-green-500 outline-none placeholder-green-200" placeholder="$ 0">
                </div>
                
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha</label>
                    <input type="date" id="income-date" required class="w-full border border-gray-300 rounded-lg p-2 text-sm" value="${new Date().toISOString().split('T')[0]}">
                </div>

                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Concepto / Referencia</label>
                    <input type="text" id="income-concept" required class="w-full border border-gray-300 rounded-lg p-2 text-sm" placeholder="Ej: Anticipo 2, Pago final...">
                </div>

                <button type="submit" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg shadow-md transition-transform active:scale-95 flex justify-center items-center">
                    <i class="fa-solid fa-check-circle mr-2"></i> Registrar Pago
                </button>
            </form>
        </div>
    `;

    overlay.innerHTML = modalHtml;
    document.body.appendChild(overlay);

    // Animación entrada
    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        overlay.querySelector('div').classList.remove('scale-95');
        overlay.querySelector('div').classList.add('scale-100');
    });

    // Helpers
    const close = () => {
        overlay.classList.add('opacity-0');
        setTimeout(() => overlay.remove(), 300);
    };

    // Setup Inputs
    const amountInput = overlay.querySelector('#income-amount');
    // Si tienes una función global setupCurrencyInput, úsala, si no, lógica simple:
    amountInput.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, '');
        if (val) e.target.value = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val);
    });

    // Listeners
    overlay.querySelector('#close-pay-modal').onclick = close;

    // Submit Lógica
    overlay.querySelector('#form-register-income').onsubmit = async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        const rawAmount = amountInput.value.replace(/[$. ]/g, ''); // Limpiar formato moneda
        const amount = parseFloat(rawAmount);
        const date = overlay.querySelector('#income-date').value;
        const concept = overlay.querySelector('#income-concept').value;

        if (!amount || amount <= 0) { alert("Monto inválido"); return; }
        if (amount > currentDebt) {
            if (!confirm("El monto supera la deuda registrada. ¿Continuar igual?")) return;
        }

        btn.disabled = true;
        btn.textContent = "Guardando...";

        try {
            // CAMBIO 1: Usar la colección estándar "payments" en lugar de "incomes"
            await addDoc(collection(_db, "projects", projectId, "payments"), {
                amount: amount,
                date: date,
                concept: concept,
                type: 'abono_cartera', // Identificador para saber que vino de cartera
                createdAt: serverTimestamp()
            });

            // Esto se mantiene igual (es lo que permite que Cartera se actualice)
            await updateDoc(doc(_db, "projects", projectId), {
                paidAmount: increment(amount),
                lastPaymentDate: date
            });

            alert("Abono registrado y sincronizado exitosamente.");
            close();
            // Recargar vista
            renderCuentasPorCobrarTab(document.getElementById('receivables-list').parentElement.parentElement); // Hack rápido para recargar o llamar a loadCarteraView()

        } catch (error) {
            console.error(error);
            alert("Error al guardar pago.");
            btn.disabled = false;
            btn.textContent = "Registrar Pago";
        }
    };
}

window.openSupplierOrdersModal = function (supplierName, ordersJson) {
    const orders = JSON.parse(decodeURIComponent(ordersJson));

    const overlay = document.createElement('div');
    // CAMBIO 1: Z-Index ajustado a 45 para que el modal de "Ver Orden" (z-50) pueda abrirse encima
    overlay.className = "fixed inset-0 bg-gray-900 bg-opacity-60 z-[45] flex items-center justify-center opacity-0 transition-opacity duration-300 backdrop-blur-sm";

    let rowsHtml = '';

    if (orders.length === 0) {
        rowsHtml = `
            <div class="text-center py-12 text-gray-400">
                <i class="fa-solid fa-clipboard-check text-5xl mb-3 text-gray-200"></i>
                <p>No hay órdenes pendientes para este proveedor.</p>
            </div>`;
    } else {
        orders.forEach(po => {
            const progress = po.total > 0 ? (po.paid / po.total) * 100 : 0;

            let statusBadge = '';
            let cardBorder = 'border-gray-200';
            let progressBarColor = 'bg-orange-500';

            if (po.debt <= 100) {
                statusBadge = '<span class="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-200">PAGADA</span>';
                cardBorder = 'border-green-200';
                progressBarColor = 'bg-green-500';
            } else if (po.paid > 0) {
                statusBadge = '<span class="bg-yellow-50 text-yellow-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-yellow-200">PARCIAL</span>';
                cardBorder = 'border-yellow-200';
                progressBarColor = 'bg-yellow-500';
            } else {
                statusBadge = '<span class="bg-red-50 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-red-100">PENDIENTE</span>';
                cardBorder = 'border-red-100';
            }

            rowsHtml += `
                <div class="bg-white p-4 rounded-xl border ${cardBorder} shadow-sm mb-3 relative overflow-hidden hover:shadow-md transition-all group">
                    
                    <div class="flex justify-between items-start mb-3">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 border border-gray-100 group-hover:bg-orange-50 group-hover:text-orange-500 transition-colors">
                                <i class="fa-solid fa-file-invoice text-lg"></i>
                            </div>
                            <div>
                                <button class="font-bold text-blue-600 text-sm leading-tight hover:underline text-left flex items-center gap-1" 
                                        data-action="view-purchase-order" 
                                        data-id="${po.id}">
                                    Orden #${po.poNumber}
                                    <i class="fa-solid fa-arrow-up-right-from-square text-[10px] opacity-50"></i>
                                </button>
                                <p class="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                                    <i class="fa-regular fa-calendar"></i> ${po.date}
                                </p>
                            </div>
                        </div>
                        <div class="text-right">
                            ${statusBadge}
                            <p class="font-bold text-orange-600 text-base mt-1 tracking-tight">${_currencyFormatter.format(po.debt)}</p>
                        </div>
                    </div>
                    
                    <div class="space-y-2">
                        <div class="flex justify-between text-[10px] text-gray-500 font-medium uppercase tracking-wide">
                            <span>Progreso Pago</span>
                            <span>${progress.toFixed(0)}%</span>
                        </div>
                        <div class="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                            <div class="${progressBarColor} h-full rounded-full transition-all duration-500 ease-out relative" style="width: ${Math.min(progress, 100)}%"></div>
                        </div>
                        <div class="flex justify-between items-center pt-2 text-xs text-gray-600 border-t border-gray-50 mt-2">
                            <span class="bg-gray-50 px-2 py-1 rounded">Total: <strong class="text-gray-800">${_currencyFormatter.format(po.total)}</strong></span>
                            <span class="text-green-700 bg-green-50 px-2 py-1 rounded">Pagado: <strong>${_currencyFormatter.format(po.paid)}</strong></span>
                        </div>
                    </div>
                </div>
            `;
        });
    }

    const modalHtml = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl p-0 transform scale-95 transition-transform duration-300 flex flex-col max-h-[85vh] overflow-hidden">
            
            <div class="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-white z-10">
                <div class="flex items-center gap-3 overflow-hidden">
                    <div class="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 flex-shrink-0 text-xl">
                        <i class="fa-solid fa-building"></i>
                    </div>
                    <div class="min-w-0">
                        <h3 class="text-xl font-bold text-gray-800 truncate">${supplierName}</h3>
                        <p class="text-sm text-gray-500 font-medium">Detalle de Deuda por Orden</p>
                    </div>
                </div>
                <button id="close-orders-modal" class="w-9 h-9 flex items-center justify-center rounded-full bg-gray-50 text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors">
                    <i class="fa-solid fa-xmark text-xl"></i>
                </button>
            </div>
            
            <div class="overflow-y-auto flex-grow p-6 bg-gray-50/50 custom-scrollbar">
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    ${rowsHtml}
                </div>
            </div>
            
            <div class="p-4 border-t border-gray-100 bg-white text-center">
                <div class="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700 flex items-center justify-center gap-2">
                    <i class="fa-solid fa-circle-info flex-shrink-0"></i>
                    <p>
                        Para ver el detalle completo de una orden, haz clic en el número azul (ej. <strong>Orden #PO-001</strong>).
                    </p>
                </div>
            </div>
        </div>
    `;

    overlay.innerHTML = modalHtml;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        overlay.querySelector('div').classList.remove('scale-95');
        overlay.querySelector('div').classList.add('scale-100');
    });

    overlay.querySelector('#close-orders-modal').onclick = () => {
        overlay.classList.add('opacity-0');
        overlay.querySelector('div').classList.remove('scale-100');
        overlay.querySelector('div').classList.add('scale-95');
        setTimeout(() => overlay.remove(), 300);
    };
};

/**
 * Abre un modal con el historial de pagos de un cliente (Proyecto)
 */
window.openClientPaymentsModal = async function (projectId, projectName) {
    // Crear overlay
    const overlay = document.createElement('div');
    overlay.className = "fixed inset-0 bg-gray-900 bg-opacity-60 z-[80] flex items-center justify-center opacity-0 transition-opacity duration-300 backdrop-blur-sm";

    // Estado de carga inicial
    overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl p-10 flex flex-col items-center justify-center transform scale-95 transition-transform duration-300">
             <div class="loader mb-4"></div>
             <p class="text-gray-500 font-medium animate-pulse">Cargando historial de pagos...</p>
        </div>
    `;
    document.body.appendChild(overlay);

    // Animación de entrada
    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        overlay.querySelector('div').classList.remove('scale-95');
        overlay.querySelector('div').classList.add('scale-100');
    });

    try {
        // Consultar pagos del proyecto
        const q = query(collection(_db, "projects", projectId, "payments"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);

        let rowsHtml = '';

        if (snapshot.empty) {
            rowsHtml = `
                <div class="text-center py-16 text-gray-400">
                    <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i class="fa-solid fa-hand-holding-dollar text-3xl text-gray-300"></i>
                    </div>
                    <p class="text-lg font-medium text-gray-500">No hay pagos registrados</p>
                    <p class="text-sm text-gray-400">Este proyecto aún no tiene abonos.</p>
                </div>`;
        } else {
            snapshot.forEach(doc => {
                const payment = doc.data();
                const date = payment.date ? new Date(payment.date + 'T00:00:00').toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Fecha desconocida';
                const amount = _currencyFormatter.format(payment.amount || 0);
                const concept = payment.concept || payment.note || 'Sin concepto';

                // Determinar tipo para icono y color
                let typeLabel = 'Pago';
                let icon = 'fa-money-bill-wave';
                let colorClass = 'text-green-600 bg-green-50 border-green-100';

                if (payment.type === 'abono_anticipo') {
                    typeLabel = 'Anticipo';
                    icon = 'fa-piggy-bank';
                    colorClass = 'text-blue-600 bg-blue-50 border-blue-100';
                } else if (payment.type === 'abono_cartera') {
                    typeLabel = 'Abono Cartera';
                    icon = 'fa-wallet';
                    colorClass = 'text-indigo-600 bg-indigo-50 border-indigo-100';
                }

                rowsHtml += `
                    <div class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all flex items-center gap-4 group hover:border-indigo-100">
                        <div class="w-12 h-12 rounded-full ${colorClass} flex items-center justify-center text-xl group-hover:scale-110 transition-transform shadow-sm border">
                            <i class="fa-solid ${icon}"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex justify-between items-start">
                                <h5 class="font-bold text-gray-800 text-sm truncate pr-2">${concept}</h5>
                                <span class="bg-gray-100 text-gray-500 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border border-gray-200">${typeLabel}</span>
                            </div>
                            <p class="text-xs text-gray-500 flex items-center gap-2 mt-1">
                                <i class="fa-regular fa-calendar"></i> ${date}
                            </p>
                        </div>
                        <div class="text-right pl-4 border-l border-gray-100">
                            <p class="text-[10px] text-gray-400 uppercase font-bold">Monto</p>
                            <p class="font-bold text-gray-800 text-lg">${amount}</p>
                        </div>
                    </div>
                `;
            });
        }

        // Reemplazar contenido con el modal real
        const modalHtml = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl p-0 flex flex-col max-h-[85vh] overflow-hidden">
                
                <div class="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-white z-10">
                    <div class="flex items-center gap-4 overflow-hidden">
                        <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white shadow-lg flex-shrink-0 text-2xl">
                            <i class="fa-solid fa-building-user"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 class="text-2xl font-bold text-gray-800 truncate">${projectName}</h3>
                            <p class="text-sm text-gray-500 font-medium flex items-center gap-2">
                                <span class="w-2 h-2 rounded-full bg-green-500"></span>
                                Historial de Abonos y Pagos
                            </p>
                        </div>
                    </div>
                    <button id="close-client-payments" class="w-10 h-10 flex items-center justify-center rounded-full bg-gray-50 text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                <div class="overflow-y-auto flex-grow p-6 bg-slate-50 custom-scrollbar">
                    <div class="space-y-3">
                        ${rowsHtml}
                    </div>
                </div>

                <div class="p-4 border-t border-gray-100 bg-white text-center">
                     <button class="text-sm text-gray-500 hover:text-indigo-600 font-medium transition-colors flex items-center justify-center gap-2 mx-auto" onclick="document.getElementById('close-client-payments').click()">
                        Cerrar Ventana
                    </button>
                </div>
            </div>
        `;

        // Actualizamos el contenido del overlay existente
        overlay.innerHTML = modalHtml;

        // Re-asignar el evento de cierre al nuevo botón
        overlay.querySelector('#close-client-payments').onclick = () => {
            overlay.classList.remove('opacity-100');
            overlay.classList.add('opacity-0');
            overlay.querySelector('div').classList.remove('scale-100');
            overlay.querySelector('div').classList.add('scale-95');
            setTimeout(() => overlay.remove(), 300);
        };

    } catch (error) {
        console.error("Error loading payments:", error);
        overlay.innerHTML = `
            <div class="bg-white p-8 rounded-2xl shadow-xl text-center max-w-sm mx-4">
                <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500 text-2xl">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                </div>
                <h3 class="text-lg font-bold text-gray-800 mb-2">Error al cargar</h3>
                <p class="text-gray-600 mb-6">${error.message}</p>
                <button class="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg font-bold hover:bg-gray-200" onclick="this.closest('.fixed').remove()">Cerrar</button>
            </div>`;
    }
};