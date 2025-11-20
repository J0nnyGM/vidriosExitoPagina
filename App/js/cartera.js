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
    _showView('cartera-view'); 
    
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
        if(activeBtn) {
            activeBtn.classList.add('bg-white', 'shadow-sm');
            activeBtn.classList.remove('text-gray-500');
            if(tab === 'pagar') activeBtn.classList.add('text-red-600');
            else activeBtn.classList.add('text-indigo-600');
        }

        const area = document.getElementById('cartera-dynamic-area');
        switch(tab) {
            case 'resumen': renderResumenTab(area); break;
            case 'cobrar': renderCuentasPorCobrarTab(area); break; // Aquí está la lógica corregida abajo
            case 'pagar': renderCuentasPorPagarTab(area); break;
        }
    };

    window.switchCarteraTab('resumen');
}


// --- SUB-VISTAS (Placeholders iniciales) ---

function renderResumenTab(container) {
    // Simulación de datos para diseño
    const totalCobrar = 150000000; 
    const totalPagar = 45000000;
    const balance = totalCobrar - totalPagar;

    container.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 cursor-pointer hover:border-green-300 transition-all" onclick="window.switchCarteraTab('cobrar')">
                <div class="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center text-2xl text-green-600">
                    <i class="fa-solid fa-arrow-trend-up"></i>
                </div>
                <div>
                    <p class="text-sm text-gray-500 font-medium">Por Cobrar (Clientes)</p>
                    <h3 class="text-2xl font-bold text-gray-800">${_currencyFormatter.format(totalCobrar)}</h3>
                </div>
            </div>

            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 cursor-pointer hover:border-red-300 transition-all" onclick="window.switchCarteraTab('pagar')">
                <div class="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center text-2xl text-red-600">
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
                    <h3 class="text-2xl font-bold text-indigo-600">${_currencyFormatter.format(balance)}</h3>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="bg-white p-6 rounded-xl shadow border border-gray-100 h-64 flex items-center justify-center">
                <p class="text-gray-400">Gráfico de Flujo de Caja (Próximamente)</p>
            </div>
             <div class="bg-white p-6 rounded-xl shadow border border-gray-100 h-64 flex items-center justify-center">
                <p class="text-gray-400">Vencimientos de Facturas (Próximamente)</p>
            </div>
        </div>
    `;
}


// ----------------------------------------------------------
// FASE 3: CUENTAS POR PAGAR (PROVEEDORES)
// ----------------------------------------------------------
async function renderCuentasPorPagarTab(container) {
    // 1. Estructura HTML (Consistente con Clientes)
    container.innerHTML = `
        <div class="space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-white p-5 rounded-xl shadow border border-gray-200 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 text-xl">
                        <i class="fa-solid fa-file-invoice-dollar"></i>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-gray-500 uppercase">Cuentas por Pagar</p>
                        <h3 id="total-payable-display" class="text-2xl font-bold text-gray-800">$ 0</h3>
                    </div>
                </div>
                <div class="bg-white p-5 rounded-xl shadow border border-gray-200 flex flex-col justify-center">
                    <label class="text-xs font-bold text-gray-400 uppercase mb-1">Buscar Proveedor</label>
                    <input type="text" id="payable-search" class="w-full border-b border-gray-300 focus:border-red-500 outline-none py-1 text-sm" placeholder="Nombre del proveedor...">
                </div>
            </div>

            <div class="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
                <div class="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h3 class="font-bold text-gray-700">Facturas Pendientes de Pago</h3>
                    <span class="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded font-bold" id="payable-count-badge">Cargando...</span>
                </div>
                <div id="payable-list" class="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                    <div class="text-center py-12"><div class="loader mx-auto"></div><p class="text-gray-400 mt-2">Revisando órdenes de compra...</p></div>
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
        // 2. Consultar Órdenes de Compra (purchase_orders)
        // Traemos las recientes primero.
        const q = query(collection(_db, "purchase_orders"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            listContainer.innerHTML = `<div class="p-8 text-center text-gray-500">No hay órdenes de compra registradas.</div>`;
            countBadge.textContent = "0";
            return;
        }

        let totalGlobalDebt = 0;
        const billsData = [];

        // 3. Procesar Datos
        snapshot.forEach(doc => {
            const po = doc.data();
            
            // Calculamos Total vs Pagado
            const total = parseMoney(po.total || po.totalEstimated || 0);
            const paid = parseMoney(po.paidAmount || po.totalPaid || 0); // Asegúrate de guardar esto al pagar
            const debt = total - paid;
            
            // ESTADOS: Solo mostramos si debe dinero Y no está anulada/rechazada
            const isValidStatus = !['rejected', 'cancelled'].includes(po.status);

            if (debt > 100 && isValidStatus) {
                const progress = total > 0 ? (paid / total) * 100 : 0;
                
                billsData.push({
                    id: doc.id,
                    supplier: po.supplierName || "Proveedor General",
                    poNumber: po.orderNumber || doc.id.substr(0,6).toUpperCase(), // Número de orden
                    date: po.createdAt ? po.createdAt.toDate().toLocaleDateString() : 'N/A',
                    total: total,
                    paid: paid,
                    debt: debt,
                    progress: progress,
                    status: po.status
                });
                totalGlobalDebt += debt;
            }
        });

        // Ordenar: Deuda mayor primero
        billsData.sort((a, b) => b.debt - a.debt);
        
        totalDisplay.textContent = _currencyFormatter.format(totalGlobalDebt);
        countBadge.textContent = `${billsData.length} Facturas`;

        // 4. Renderizar
        const renderRows = (items) => {
            listContainer.innerHTML = '';
            if (items.length === 0) {
                listContainer.innerHTML = `
                    <div class="p-10 text-center flex flex-col items-center">
                        <i class="fa-solid fa-thumbs-up text-4xl text-gray-300 mb-3"></i>
                        <p class="text-gray-500">Estás al día con los proveedores.</p>
                    </div>`;
                return;
            }

            items.forEach(item => {
                const row = document.createElement('div');
                row.className = "p-4 hover:bg-orange-50 transition-colors group flex flex-col md:flex-row justify-between items-center gap-4";
                
                const progressColor = item.progress > 50 ? 'bg-yellow-500' : 'bg-gray-300';

                row.innerHTML = `
                    <div class="flex-1 w-full">
                        <div class="flex justify-between mb-1">
                            <div>
                                <h4 class="font-bold text-gray-800 text-sm flex items-center">
                                    <i class="fa-solid fa-truck-field mr-2 text-gray-400"></i> ${item.supplier}
                                </h4>
                                <p class="text-xs text-gray-500">Orden #${item.poNumber} • ${item.date}</p>
                            </div>
                            <div class="text-right">
                                <p class="text-[10px] text-gray-400 uppercase font-bold">Por Pagar</p>
                                <p class="text-lg font-bold text-orange-600">${_currencyFormatter.format(item.debt)}</p>
                            </div>
                        </div>
                        
                        <div class="flex items-center gap-3 mt-2">
                            <div class="flex-1 bg-gray-100 rounded-full h-1.5 relative overflow-hidden">
                                <div class="${progressColor} h-full rounded-full" style="width: ${Math.min(item.progress, 100)}%"></div>
                            </div>
                            <span class="text-[10px] font-bold text-gray-400 w-10 text-right">${item.progress.toFixed(0)}%</span>
                        </div>
                    </div>

                    <button class="btn-pay-bill bg-white border border-gray-300 text-gray-600 hover:border-orange-500 hover:text-orange-600 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center whitespace-nowrap"
                        data-id="${item.id}" data-supplier="${item.supplier}" data-debt="${item.debt}">
                        <i class="fa-solid fa-money-bill-transfer mr-2"></i> Pagar
                    </button>
                `;

                row.querySelector('.btn-pay-bill').addEventListener('click', (e) => {
                    const btn = e.currentTarget;
                    openRegisterExpenseModal(btn.dataset.id, btn.dataset.supplier, parseFloat(btn.dataset.debt));
                });

                listContainer.appendChild(row);
            });
        };

        renderRows(billsData);

        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = billsData.filter(i => i.supplier.toLowerCase().includes(term) || i.poNumber.toLowerCase().includes(term));
            renderRows(filtered);
        });

    } catch (error) {
        console.error("Error Pagar:", error);
        listContainer.innerHTML = `<div class="p-6 text-center text-red-500">Error cargando datos.</div>`;
    }
}

/**
 * Modal Flotante para Registrar Egreso (Pago a Proveedor)
 */
function openRegisterExpenseModal(poId, supplierName, currentDebt) {
    const overlay = document.createElement('div');
    overlay.className = "fixed inset-0 bg-gray-900 bg-opacity-50 z-[70] flex items-center justify-center opacity-0 transition-opacity duration-300";
    
    const modalHtml = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 transform scale-95 transition-transform duration-300">
            <div class="flex justify-between items-center mb-4 border-b border-gray-100 pb-2">
                <h3 class="text-lg font-bold text-gray-800">Registrar Egreso</h3>
                <button id="close-exp-modal" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-xl"></i></button>
            </div>
            
            <div class="bg-orange-50 p-3 rounded-lg mb-4 text-center border border-orange-100">
                <p class="text-xs text-orange-500 uppercase font-bold">Pago a Proveedor</p>
                <p class="font-bold text-gray-800 truncate">${supplierName}</p>
                <p class="text-xs text-gray-500 mt-1">Deuda: <span class="font-bold text-red-500">${_currencyFormatter.format(currentDebt)}</span></p>
            </div>

            <form id="form-register-expense" class="space-y-4">
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Valor a Pagar</label>
                    <input type="text" id="expense-amount" required class="currency-input w-full border-2 border-gray-200 rounded-lg p-3 text-xl font-bold text-gray-700 focus:border-orange-400 outline-none" placeholder="$ 0">
                </div>
                
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Pago</label>
                    <input type="date" id="expense-date" required class="w-full border border-gray-300 rounded-lg p-2 text-sm" value="${new Date().toISOString().split('T')[0]}">
                </div>

                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Método / Nota</label>
                    <input type="text" id="expense-concept" required class="w-full border border-gray-300 rounded-lg p-2 text-sm" placeholder="Ej: Transferencia Bancolombia...">
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

    // Setup Input Moneda
    const amountInput = overlay.querySelector('#expense-amount');
    amountInput.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, '');
        if(val) e.target.value = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val);
    });

    overlay.querySelector('#close-exp-modal').onclick = close;

    overlay.querySelector('#form-register-expense').onsubmit = async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        const rawAmount = amountInput.value.replace(/[$. ]/g, '');
        const amount = parseFloat(rawAmount);
        const date = overlay.querySelector('#expense-date').value;
        const concept = overlay.querySelector('#expense-concept').value;

        if (!amount || amount <= 0) { alert("Monto inválido"); return; }
        if (amount > currentDebt) { 
            if(!confirm("Estás pagando más de lo que dice la deuda. ¿Seguro?")) return;
        }

        btn.disabled = true;
        btn.textContent = "Procesando...";

        try {
            // 1. Guardar el movimiento en subcolección 'payments' de la orden de compra
            await addDoc(collection(_db, "purchase_orders", poId, "payments"), {
                amount: amount,
                date: date,
                note: concept,
                createdAt: serverTimestamp(),
                createdBy: 'admin' // O ID real si lo tienes a mano
            });

            // 2. Actualizar el acumulado en la orden maestra
            await updateDoc(doc(_db, "purchase_orders", poId), {
                paidAmount: increment(amount),
                status: (amount >= currentDebt) ? 'paid' : 'partial' // Opcional: Cambiar estado si paga todo
            });

            alert("Egreso registrado.");
            close();
            // Recargar la tabla (Hack de recarga)
            const currentTabBtn = document.getElementById('tab-cartera-pagar');
            if(currentTabBtn) currentTabBtn.click();

        } catch (error) {
            console.error(error);
            alert("Error al guardar.");
            btn.disabled = false;
            btn.textContent = "Confirmar Pago";
        }
    };
}

// ----------------------------------------------------------
// FASE 2: CUENTAS POR COBRAR (SINCRONIZACIÓN REAL)
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

    // --- HELPER VITAL: Limpia "$ 1.000.000" a 1000000 ---
    const parseMoney = (val) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        // Elimina todo lo que no sea número, punto o guion
        const clean = String(val).replace(/[^0-9.-]+/g, ""); 
        return parseFloat(clean) || 0;
    };

    try {
        // A. Traer TODOS los Proyectos (Sin filtrar por activos para asegurar que vemos todo)
        const projectsQuery = query(collection(_db, "projects"), orderBy("createdAt", "desc"));
        const projectsSnap = await getDocs(projectsQuery);

        // B. Traer TODOS los Cortes Aprobados (Global)
        const cortesQuery = query(collectionGroup(_db, 'cortes'), where('status', '==', 'approved'));
        const cortesSnap = await getDocs(cortesQuery);

        // Mapa para sumar cortes: { projectId: 1500000 }
        const sumCortesPorProyecto = {};
        cortesSnap.forEach(doc => {
            // El padre.parent.id es el ID del proyecto
            const pid = doc.ref.parent.parent.id;
            const valor = parseMoney(doc.data().totalValue || doc.data().valor || 0);
            
            if (!sumCortesPorProyecto[pid]) sumCortesPorProyecto[pid] = 0;
            sumCortesPorProyecto[pid] += valor;
        });

        let totalGlobalDebt = 0;
        const dataList = [];

        // C. Cruzar la información
        projectsSnap.forEach(doc => {
            const p = doc.data();
            
            // 1. Calcular lo que nos DEBEN pagar (Exigible)
            // Exigible = Anticipo + Suma de Cortes Aprobados
            const anticipo = parseMoney(p.downPayment || p.anticipo || p.advance || 0);
            const cortes = sumCortesPorProyecto[doc.id] || 0;
            const totalExigible = anticipo + cortes;

            // 2. Calcular lo que YA pagaron
            // Asumimos que tienes un campo acumulado. Si no, esto será 0 y la deuda será total.
            const pagado = parseMoney(p.paidAmount || p.totalPaid || p.abonos || 0);

            // 3. Deuda Real
            const deuda = totalExigible - pagado;

            // Solo mostramos si hay deuda real (mayor a 100 pesos) O si hay movimiento de dinero
            if (deuda > 100 || totalExigible > 0) {
                // Porcentaje cobrado sobre lo ejecutado
                const progress = totalExigible > 0 ? (pagado / totalExigible) * 100 : 0;
                
                // Valor total del contrato (Informativo)
                const valorContrato = parseMoney(p.budget || p.totalValue || p.costo || 0);

                dataList.push({
                    id: doc.id,
                    name: p.name || "Sin Nombre",
                    client: p.clientName || p.client || "Cliente General",
                    exigible: totalExigible,
                    pagado: pagado,
                    deuda: deuda,
                    progress: progress,
                    cortes: cortes,
                    anticipo: anticipo,
                    contrato: valorContrato
                });

                if (deuda > 0) totalGlobalDebt += deuda;
            }
        });

        // Ordenar: Los que más deben primero
        dataList.sort((a, b) => b.deuda - a.deuda);
        
        totalDisplay.textContent = _currencyFormatter.format(totalGlobalDebt);
        countBadge.textContent = `${dataList.length} Proyectos`;

        // D. Renderizar
        const renderRows = (items) => {
            listContainer.innerHTML = '';
            if (items.length === 0) {
                listContainer.innerHTML = `<div class="p-8 text-center text-gray-400">No hay deudas pendientes por cobrar.</div>`;
                return;
            }

            items.forEach(item => {
                const row = document.createElement('div');
                row.className = "p-4 hover:bg-gray-50 transition-colors group flex flex-col md:flex-row justify-between items-center gap-4";
                
                // Barra de estado
                const barColor = item.progress >= 100 ? 'bg-green-500' : (item.progress > 50 ? 'bg-yellow-400' : 'bg-red-500');
                
                // Si la deuda es 0 o negativa (saldo a favor), mostrar en verde
                const debtColor = item.deuda > 0 ? 'text-red-600' : 'text-green-600';
                const debtText = item.deuda <= 0 ? 'Paz y Salvo' : _currencyFormatter.format(item.deuda);

                row.innerHTML = `
                    <div class="flex-1 w-full">
                        <div class="flex justify-between mb-1">
                            <div>
                                <h4 class="font-bold text-gray-800 text-sm truncate">${item.name}</h4>
                                <p class="text-xs text-gray-500"><i class="fa-solid fa-user mr-1"></i> ${item.client}</p>
                            </div>
                            <div class="text-right">
                                <p class="text-[10px] text-gray-400 uppercase font-bold">Saldo Pendiente</p>
                                <p class="text-lg font-bold ${debtColor}">${debtText}</p>
                            </div>
                        </div>
                        
                        <div class="flex items-center gap-2 mt-1">
                            <div class="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                                <div class="${barColor} h-full rounded-full" style="width: ${Math.min(item.progress, 100)}%"></div>
                            </div>
                            <span class="text-xs font-bold text-gray-500">${item.progress.toFixed(0)}%</span>
                        </div>

                        <div class="flex gap-3 mt-2 text-[10px] text-gray-400 bg-gray-50 p-1.5 rounded border border-gray-100">
                            <span title="Suma de Cortes Aprobados">🏗️ Cortes: <strong>${_currencyFormatter.format(item.cortes)}</strong></span>
                            <span title="Anticipo Inicial">💰 Anticipo: <strong>${_currencyFormatter.format(item.anticipo)}</strong></span>
                            <span class="ml-auto text-gray-600">Total Recaudado: <strong>${_currencyFormatter.format(item.pagado)}</strong></span>
                        </div>
                    </div>

                    <button class="btn-abonar bg-white border border-gray-300 text-indigo-600 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm"
                        data-id="${item.id}" data-name="${item.name}" data-debt="${item.deuda}">
                        <i class="fa-solid fa-cash-register mr-1"></i> Registrar Ingreso
                    </button>
                `;

                row.querySelector('.btn-abonar').addEventListener('click', (e) => {
                    // Llamamos a la función de modal de pago (asegúrate que openRegisterPaymentModal esté definida abajo)
                    openRegisterPaymentModal(e.currentTarget.dataset.id, e.currentTarget.dataset.name, parseFloat(e.currentTarget.dataset.debt));
                });

                listContainer.appendChild(row);
            });
        };

        renderRows(dataList);

        // Buscador
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
        if(val) e.target.value = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val);
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
            if(!confirm("El monto supera la deuda registrada. ¿Continuar igual?")) return;
        }

        btn.disabled = true;
        btn.textContent = "Guardando...";

        try {
            // 1. Registrar el movimiento en una subcolección 'incomes' o 'payments' del proyecto
            await addDoc(collection(_db, "projects", projectId, "incomes"), {
                amount: amount,
                date: date,
                concept: concept,
                createdAt: serverTimestamp()
            });

            // 2. Actualizar el acumulado 'paidAmount' del proyecto
            await updateDoc(doc(_db, "projects", projectId), {
                paidAmount: increment(amount),
                lastPaymentDate: date
            });

            alert("Abono registrado exitosamente.");
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