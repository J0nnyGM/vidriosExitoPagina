// js/compras.js
import { collection, query, where, orderBy, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

let db, formatCurrency, getCurrentUserRole;
let unsubscribePurchaseOrders = null;
let cachedOrders = [];

/**
 * Inicializa el módulo inyectando dependencias
 */
export function initCompras(firestoreDb, deps) {
    db = firestoreDb;
    formatCurrency = deps.formatCurrency;
    getCurrentUserRole = deps.getCurrentUserRole;
}

/**
 * Carga la vista de Órdenes de Compra con alineación y búsqueda.
 */
export function loadComprasView() {
    const tableBody = document.getElementById('purchase-orders-table-body');
    const startDateInput = document.getElementById('po-start-date-filter');
    const endDateInput = document.getElementById('po-end-date-filter');
    const searchInput = document.getElementById('po-search-input');

    if (!tableBody) return;

    if (!startDateInput.value || !endDateInput.value) {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);
        startDateInput.value = start.toISOString().split('T')[0];
        endDateInput.value = end.toISOString().split('T')[0];
    }

    const renderTable = () => {
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
        tableBody.innerHTML = '';

        const filtered = cachedOrders.filter(po => {
            const textMatch =
                (po.poNumber || '').toLowerCase().includes(searchTerm) ||
                (po.provider || po.supplierName || '').toLowerCase().includes(searchTerm) ||
                (po.id || '').toLowerCase().includes(searchTerm);
            return textMatch;
        });

        if (filtered.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-gray-400"><div class="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-2"><i class="fa-solid fa-filter-circle-xmark text-xl"></i></div><p class="text-xs">No se encontraron órdenes con ese criterio.</p></td></tr>`;
            return;
        }

        filtered.forEach(po => {
            const poIdentifier = po.poNumber || po.id.substring(0, 6).toUpperCase();
            const dateStr = po.createdAt ? po.createdAt.toDate().toLocaleDateString('es-CO') : '---';
            const totalStr = formatCurrency(po.totalCost || po.total || 0);

            let statusHtml;
            switch (po.status) {
                case 'recibida': statusHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200"><i class="fa-solid fa-check mr-1"></i>Recibida</span>`; break;
                case 'anulada': statusHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 border border-red-200"><i class="fa-solid fa-ban mr-1"></i>Anulada</span>`; break;
                default: statusHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200"><span class="w-1.5 h-1.5 bg-amber-500 rounded-full mr-1.5 animate-pulse"></span>Pendiente</span>`;
            }

            const row = document.createElement('tr');
            row.className = 'bg-white hover:bg-emerald-50/30 transition-colors border-b border-slate-50 last:border-0 group';
            row.innerHTML = `
                <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center font-mono text-xs font-bold border border-slate-200 group-hover:border-emerald-300 group-hover:text-emerald-600 transition-colors">PO</div>
                        <span class="font-bold text-indigo-600 text-sm">#${poIdentifier}</span>
                    </div>
                </td>
                <td class="px-6 py-4 text-xs font-medium text-slate-500">
                    <div class="flex items-center gap-2"><i class="fa-regular fa-calendar text-slate-300"></i> ${dateStr}</div>
                </td>
                <td class="px-6 py-4 font-bold text-slate-700 text-sm">${po.provider || po.supplierName || 'Desconocido'}</td>
                <td class="px-6 py-4 text-right font-black text-slate-800 text-sm">${totalStr}</td>
                <td class="px-6 py-4 text-center">${statusHtml}</td>
                <td class="px-6 py-4 text-right">
                    <button data-action="view-purchase-order" data-id="${po.id}" class="bg-white hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 border border-slate-200 hover:border-emerald-200 w-8 h-8 rounded-lg transition-all shadow-sm inline-flex items-center justify-center">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    };

    const filterBtn = document.getElementById('apply-po-filter-btn');
    if (filterBtn && !filterBtn.dataset.listening) {
        filterBtn.addEventListener('click', () => loadComprasView());
        filterBtn.dataset.listening = "true";

        startDateInput.addEventListener('change', validatePoDateRange);
        endDateInput.addEventListener('change', validatePoDateRange);
    }

    if (searchInput && !searchInput.dataset.listening) {
        searchInput.addEventListener('input', renderTable);
        searchInput.dataset.listening = "true";
    }

    tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-12"><div class="loader mx-auto mb-2"></div><p class="text-xs text-gray-400">Sincronizando órdenes...</p></td></tr>`;

    const startDate = new Date(startDateInput.value + 'T00:00:00');
    const endDate = new Date(endDateInput.value + 'T23:59:59');

    if (unsubscribePurchaseOrders) unsubscribePurchaseOrders();

    const poQuery = query(
        collection(db, "purchaseOrders"),
        where("createdAt", ">=", startDate),
        where("createdAt", "<=", endDate),
        orderBy("createdAt", "desc")
    );

    unsubscribePurchaseOrders = onSnapshot(poQuery, (snapshot) => {
        cachedOrders = [];
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-16 text-gray-400"><div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3"><i class="fa-solid fa-calendar-xmark text-2xl opacity-30"></i></div><p class="text-sm">No hay órdenes en este rango de fechas.</p></td></tr>`;
            return;
        }
        snapshot.forEach(doc => {
            cachedOrders.push({ id: doc.id, ...doc.data() });
        });
        renderTable();
    }, (error) => {
        console.error("Error POs:", error);
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-red-500 py-4">Error de conexión al cargar órdenes.</td></tr>`;
    });
}

export function validatePoDateRange() {
    const startDateInput = document.getElementById('po-start-date-filter');
    const endDateInput = document.getElementById('po-end-date-filter');
    const feedbackP = document.getElementById('po-filter-feedback');
    const applyFilterBtn = document.getElementById('apply-po-filter-btn');

    if (!startDateInput.value || !endDateInput.value) {
        applyFilterBtn.disabled = true;
        return;
    }

    const startDate = new Date(startDateInput.value);
    const endDate = new Date(endDateInput.value);

    if (startDate > endDate) {
        feedbackP.textContent = 'La fecha "Desde" no puede ser posterior a la fecha "Hasta".';
        applyFilterBtn.disabled = true;
        return;
    }

    const threeMonthsInMillis = 90 * 24 * 60 * 60 * 1000; 
    if (endDate - startDate > threeMonthsInMillis) {
        feedbackP.textContent = 'El rango de fechas no puede ser mayor a 3 meses.';
        applyFilterBtn.disabled = true;
    } else {
        feedbackP.textContent = ''; 
        applyFilterBtn.disabled = false; 
    }
}

export async function openPurchaseOrderModal(poId) {
    const modal = document.getElementById('po-details-modal');
    if (!modal) return;

    const contentContainer = document.getElementById('po-details-content');
    const actionsContainer = document.getElementById('po-details-actions');
    const modalContainer = modal.querySelector('.w-11\\/12');

    if (modalContainer) {
        modalContainer.className = "w-11/12 md:max-w-5xl bg-white rounded-xl shadow-2xl transform transition-all relative flex flex-col max-h-[95vh]";
    }

    contentContainer.innerHTML = '<div class="flex justify-center items-center h-64"><div class="loader"></div></div>';
    actionsContainer.innerHTML = '';
    modal.style.display = 'flex';

    try {
        const poRef = doc(db, "purchaseOrders", poId);
        const poSnap = await getDoc(poRef);
        if (!poSnap.exists()) throw new Error("Orden no encontrada");
        const po = { id: poSnap.id, ...poSnap.data() };

        let supplierData = {};
        if (po.supplierId) {
            const supSnap = await getDoc(doc(db, "suppliers", po.supplierId));
            if (supSnap.exists()) supplierData = supSnap.data();
        }

        const statusColors = {
            recibida: "bg-emerald-100 text-emerald-800 border-emerald-200",
            pendiente: "bg-amber-100 text-amber-800 border-amber-200",
            rechazada: "bg-rose-100 text-rose-800 border-rose-200",
            anulada: "bg-red-100 text-red-800 border-red-200"
        };
        const statusClass = statusColors[po.status] || "bg-gray-100 text-gray-800";
        const creationDate = po.createdAt ? po.createdAt.toDate().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }) : '---';

        let itemsWithNames = [];
        if (po.items && po.items.length > 0) {
            itemsWithNames = await Promise.all(po.items.map(async (item) => {
                if (item.itemName) return item;
                let collectionName = 'materialCatalog';
                if (item.itemType === 'dotacion') collectionName = 'dotacionCatalog';
                if (item.itemType === 'herramienta') collectionName = 'tools';

                try {
                    const itemDoc = await getDoc(doc(db, collectionName, item.materialId));
                    if (itemDoc.exists()) {
                        const data = itemDoc.data();
                        const resolvedName = data.name || data.itemName || 'Sin nombre';
                        return { ...item, itemName: resolvedName };
                    }
                } catch (e) {
                    console.warn("Error recuperando nombre de ítem:", e);
                }
                return { ...item, itemName: 'Ítem desconocido (Eliminado)' };
            }));
        }

        let itemsHtml = '';
        if (itemsWithNames.length > 0) {
            itemsHtml = itemsWithNames.map((item, idx) => `
                <tr class="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                    <td class="py-3 pl-4 text-sm text-gray-500 font-mono">${idx + 1}</td>
                    <td class="py-3 text-sm font-medium text-gray-800">
                        ${item.itemName} 
                        ${item.itemType ? `<span class="text-[9px] text-gray-400 uppercase ml-2 px-1.5 py-0.5 bg-gray-100 rounded border border-gray-200 tracking-wider"> ${item.itemType} </span>` : ''}
                    </td>
                    <td class="py-3 text-center text-sm text-gray-600 font-bold">${item.quantity}</td>
                    <td class="py-3 text-right text-sm text-gray-600 font-mono">${formatCurrency(item.unitCost)}</td>
                    <td class="py-3 pr-4 text-right text-sm font-bold text-gray-900 font-mono">${formatCurrency(item.quantity * item.unitCost)}</td>
                </tr>
            `).join('');
        } else {
            itemsHtml = '<tr><td colspan="5" class="text-center py-4 text-gray-400">Sin ítems registrados.</td></tr>';
        }

        contentContainer.innerHTML = `
            <div class="flex flex-col h-full bg-gray-50/50">
                <div class="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-start shadow-sm relative z-10">
                    <div>
                        <div class="flex items-center gap-3 mb-1">
                             <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white"><i class="fa-solid fa-cart-shopping"></i></div>
                             <h2 class="text-2xl font-black text-gray-800 tracking-tight">Orden de Compra</h2>
                        </div>
                        <p class="text-sm text-gray-500 ml-11">#${po.poNumber || po.id.substring(0, 6).toUpperCase()}</p>
                    </div>
                    <div class="text-right">
                        <span class="px-3 py-1 rounded-full text-xs font-black uppercase border ${statusClass} mb-2 inline-block">${po.status}</span>
                        <p class="text-xs text-gray-400 flex items-center justify-end gap-1"><i class="fa-regular fa-calendar"></i> ${creationDate}</p>
                    </div>
                </div>

                <div class="flex-grow overflow-y-auto custom-scrollbar p-6">
                    <div class="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
                        <div class="lg:col-span-8 space-y-6">
                            <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                <p class="text-xs font-bold text-gray-400 uppercase mb-3 tracking-wide">Proveedor</p>
                                <div class="flex items-start gap-4">
                                    <div class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-bold text-lg border border-gray-200">
                                        ${(po.supplierName || 'P').charAt(0)}
                                    </div>
                                    <div>
                                        <p class="font-bold text-gray-800 text-lg leading-tight">${po.supplierName || 'Proveedor General'}</p>
                                        <p class="text-sm text-gray-500 mt-0.5">${supplierData.nit ? `NIT: ${supplierData.nit}` : ''}</p>
                                        <button class="text-xs text-blue-600 hover:underline mt-1 font-medium flex items-center gap-1" 
                                           data-action="view-supplier-details" data-id="${po.supplierId}">
                                           Ver perfil completo <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                <div class="px-4 py-3 bg-gray-50 border-b border-gray-200">
                                    <h4 class="text-xs font-bold text-gray-500 uppercase">Detalle de Ítems</h4>
                                </div>
                                <div class="overflow-x-auto">
                                    <table class="w-full text-left">
                                        <thead class="bg-white text-xs text-gray-400 uppercase border-b border-gray-100">
                                            <tr>
                                                <th class="py-2 pl-4 font-semibold">#</th>
                                                <th class="py-2 font-semibold">Descripción</th>
                                                <th class="py-2 text-center font-semibold">Cant.</th>
                                                <th class="py-2 text-right font-semibold">Unit.</th>
                                                <th class="py-2 pr-4 text-right font-semibold">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>${itemsHtml}</tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <div class="lg:col-span-4 space-y-4">
                            <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <p class="text-xs font-bold text-gray-400 uppercase mb-3">Resumen Financiero</p>
                                <div class="flex justify-between items-end mb-2">
                                    <span class="text-sm text-gray-600">Total Orden</span>
                                    <span class="text-xl font-black text-gray-900">${formatCurrency(po.totalCost || 0)}</span>
                                </div>
                                <div class="flex justify-between items-center text-sm mb-4 pt-2 border-t border-dashed border-gray-200">
                                    <span class="text-gray-500">Abonado</span>
                                    <span class="font-bold text-green-600">${formatCurrency(po.paidAmount || 0)}</span>
                                </div>
                                <div class="w-full bg-gray-100 rounded-full h-2 mb-1">
                                    <div class="bg-blue-600 h-2 rounded-full" style="width: ${Math.min(((po.paidAmount || 0) / (po.totalCost || 1)) * 100, 100)}%"></div>
                                </div>
                                <p class="text-xs text-right text-gray-400">${Math.round(((po.paidAmount || 0) / (po.totalCost || 1)) * 100)}% Pagado</p>
                            </div>

                            <div class="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-5 text-white shadow-lg relative overflow-hidden">
                                <div class="absolute top-0 right-0 opacity-10 -mt-4 -mr-4"><i class="fa-solid fa-wallet text-9xl"></i></div>
                                
                                <h4 class="font-bold text-sm uppercase tracking-wider mb-4 flex items-center text-blue-200">
                                    <i class="fa-solid fa-money-bill-transfer mr-2"></i> Datos de Pago
                                </h4>

                                <div class="space-y-3 relative z-10">
                                    <div>
                                        <p class="text-[10px] text-slate-400 uppercase">Banco</p>
                                        <p class="font-bold text-base">${supplierData.bankName || 'No registrado'}</p>
                                    </div>
                                    <div>
                                        <p class="text-[10px] text-slate-400 uppercase">Cuenta (${supplierData.accountType || ''})</p>
                                        <div class="flex items-center gap-2">
                                            <p class="font-mono text-lg font-bold tracking-wide text-yellow-400">${supplierData.accountNumber || '---'}</p>
                                            <button onclick="navigator.clipboard.writeText('${supplierData.accountNumber}'); window.showToast('Copiado', 'success')" class="text-white/50 hover:text-white transition-colors"><i class="fa-regular fa-copy"></i></button>
                                        </div>
                                    </div>
                                </div>

                                ${supplierData.qrCodeURL ? `
                                    <div class="mt-6 pt-4 border-t border-white/10 text-center">
                                        <div class="bg-white p-1.5 rounded-lg inline-block cursor-pointer hover:scale-105 transition-transform shadow-md" onclick="window.openImageModal('${supplierData.qrCodeURL}')">
                                            <img src="${supplierData.qrCodeURL}" class="w-28 h-28 object-cover rounded">
                                        </div>
                                        <p class="text-[10px] text-slate-400 mt-2 flex items-center justify-center gap-1"><i class="fa-solid fa-qrcode"></i> Toca para ampliar</p>
                                    </div>
                                ` : '<div class="mt-4 p-3 bg-white/5 rounded text-center text-xs text-slate-400 italic border border-white/10">Sin código QR disponible</div>'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        actionsContainer.innerHTML = `
            <button type="button" data-action="close-details-modal" class="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 font-bold py-2.5 px-5 rounded-xl shadow-sm transition-all">
                Cerrar
            </button>
        `;

        const userRole = getCurrentUserRole();
        if (po.status === 'pendiente' && (userRole === 'admin' || userRole === 'bodega')) {
            actionsContainer.innerHTML += `
                <button data-action="reject-purchase-order" data-id="${po.id}" class="bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 font-bold py-2.5 px-5 rounded-xl transition-all shadow-sm flex items-center">
                    <i class="fa-solid fa-trash mr-2"></i> Rechazar
                </button>
                <button data-action="receive-purchase-order" data-id="${po.id}" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-6 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center transform hover:-translate-y-0.5">
                    <i class="fa-solid fa-box-open mr-2"></i> Recibir Mercancía
                </button>
            `;
        }

    } catch (error) {
        console.error("Error modal PO:", error);
        contentContainer.innerHTML = `<div class="p-10 text-center text-red-500">Error: ${error.message}</div>`;
    }
}

export function closePurchaseOrderModal() {
    const modal = document.getElementById('po-details-modal');
    if (modal) modal.style.display = 'none';
}