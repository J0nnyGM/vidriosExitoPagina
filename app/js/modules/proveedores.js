// js/proveedores.js
import { collection, query, orderBy, onSnapshot, doc, getDoc, getDocs, where } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

let db, showView, formatCurrency;
let unsubscribeSuppliers = null;
export let currentSupplierId = null; // Para saber a quién pagar en los modales
let unsubscribeSupplierPOs = null;
let unsubscribeSupplierPayments = null;

let suppliersCurrentPage = 1;
const suppliersItemsPerPage = 10;

/**
 * Inicializa el módulo de proveedores
 */
export function initProveedores(firestoreDb, dependencies) {
    db = firestoreDb;
    showView = dependencies.showView;
    formatCurrency = dependencies.formatCurrency;
}

/**
 * Carga la vista de Proveedores con diseño moderno y paginación.
 */
export function loadProveedoresView() {
    const tableBody = document.getElementById('suppliers-table-body');
    const searchInput = document.getElementById('supplier-search-input');
    const pagContainer = document.getElementById('suppliers-pagination-container');

    if (!tableBody) return;

    suppliersCurrentPage = 1; // Reset a página 1 al cargar la vista
    if (unsubscribeSuppliers) unsubscribeSuppliers();

    let allSuppliers = [];

    const renderTable = (suppliersData) => {
        tableBody.innerHTML = '';

        if (suppliersData.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center py-16">
                        <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3 text-gray-300">
                            <i class="fa-solid fa-users-slash text-2xl"></i>
                        </div>
                        <p class="text-gray-500 font-medium text-sm">No se encontraron proveedores.</p>
                    </td>
                </tr>`;
            if (pagContainer) pagContainer.innerHTML = '';
            return;
        }

        // PAGINACIÓN EN MEMORIA
        const totalPages = Math.ceil(suppliersData.length / suppliersItemsPerPage) || 1;
        if (suppliersCurrentPage > totalPages) {
            suppliersCurrentPage = totalPages;
        }
        if (suppliersCurrentPage < 1) {
            suppliersCurrentPage = 1;
        }

        const startIdx = (suppliersCurrentPage - 1) * suppliersItemsPerPage;
        const endIdx = startIdx + suppliersItemsPerPage;
        const paginatedItems = suppliersData.slice(startIdx, endIdx);

        // Pintar controles de paginación
        if (pagContainer) {
            const regStart = startIdx + 1;
            const regEnd = Math.min(endIdx, suppliersData.length);
            
            pagContainer.innerHTML = `
                <div>
                    Mostrando <span class="font-bold text-slate-700">${regStart}</span> a <span class="font-bold text-slate-700">${regEnd}</span> de <span class="font-bold text-slate-700">${suppliersData.length}</span> proveedores
                </div>
                <div class="flex items-center gap-2">
                    <button id="btn-sup-pag-prev" ${suppliersCurrentPage === 1 ? 'disabled' : ''} 
                        class="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-bold transition-all disabled:opacity-40 disabled:hover:bg-white cursor-pointer disabled:cursor-not-allowed text-xs flex items-center gap-1">
                        <i class="fa-solid fa-angle-left"></i> Anterior
                    </button>
                    <span class="text-xs font-bold text-slate-400 px-2">Página ${suppliersCurrentPage} de ${totalPages}</span>
                    <button id="btn-sup-pag-next" ${suppliersCurrentPage === totalPages ? 'disabled' : ''} 
                        class="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-bold transition-all disabled:opacity-40 disabled:hover:bg-white cursor-pointer disabled:cursor-not-allowed text-xs flex items-center gap-1">
                        Siguiente <i class="fa-solid fa-angle-right"></i>
                    </button>
                </div>
            `;

            const btnPrev = document.getElementById('btn-sup-pag-prev');
            const btnNext = document.getElementById('btn-sup-pag-next');

            if (btnPrev && suppliersCurrentPage > 1) {
                btnPrev.onclick = () => {
                    suppliersCurrentPage--;
                    renderTable(suppliersData);
                };
            }
            if (btnNext && suppliersCurrentPage < totalPages) {
                btnNext.onclick = () => {
                    suppliersCurrentPage++;
                    renderTable(suppliersData);
                };
            }
        }

        paginatedItems.forEach(supplier => {
            const row = document.createElement('tr');
            row.className = 'bg-white hover:bg-purple-50/30 transition-colors border-b border-slate-50 last:border-0 group';

            const initial = (supplier.name || '?').charAt(0).toUpperCase();

            row.innerHTML = `
                <td class="px-6 py-4">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-xl font-black border border-purple-100 shadow-sm shrink-0 group-hover:scale-105 transition-transform">
                            ${initial}
                        </div>
                        <div>
                            <p class="font-bold text-gray-800 text-sm leading-tight">${supplier.name}</p>
                            <div class="flex items-center gap-2 mt-1">
                                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">NIT</span>
                                <span class="text-xs text-gray-500 font-mono">${supplier.nit || '---'}</span>
                            </div>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4">
                    <div class="flex flex-col">
                        <p class="text-sm font-bold text-slate-700 flex items-center gap-2">
                            <i class="fa-solid fa-user-tie text-purple-300 text-xs"></i> 
                            ${supplier.contactName || '---'}
                        </p>
                        <p class="text-xs text-gray-400 mt-0.5 font-mono pl-5">
                            ${supplier.contactPhone || '---'}
                        </p>
                    </div>
                </td>
                <td class="px-6 py-4">
                    <div class="space-y-1">
                        ${supplier.email ?
                    `<a href="mailto:${supplier.email}" class="text-xs text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-2 font-medium">
                                <i class="fa-solid fa-envelope text-indigo-200"></i> ${supplier.email}
                            </a>` :
                    `<span class="text-xs text-gray-400 flex items-center gap-2"><i class="fa-solid fa-envelope text-gray-200"></i> No registrado</span>`
                }
                        <div class="flex items-center gap-2 text-xs text-gray-500 truncate max-w-[200px]" title="${supplier.address || ''}">
                            <i class="fa-solid fa-location-dot text-gray-300"></i> ${supplier.address || '---'}
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 text-right">
                    <div class="flex justify-end items-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button data-action="quick-pay-supplier" data-id="${supplier.id}" 
                            class="w-8 h-8 rounded-lg flex items-center justify-center bg-white border border-slate-200 text-slate-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-all shadow-sm" 
                            title="Registrar Pago">
                            <i class="fa-solid fa-money-bill-wave"></i>
                        </button>
                        <button data-action="view-supplier-details" data-id="${supplier.id}" 
                            class="w-8 h-8 rounded-lg flex items-center justify-center bg-white border border-slate-200 text-slate-400 hover:text-purple-600 hover:border-purple-200 hover:bg-purple-50 transition-all shadow-sm" 
                            title="Ver Detalles">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                        <button data-action="edit-supplier" data-id="${supplier.id}" 
                            class="w-8 h-8 rounded-lg flex items-center justify-center bg-white border border-slate-200 text-slate-400 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 transition-all shadow-sm" 
                            title="Editar">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                    </div>
                </td>
            `;
            tableBody.appendChild(row);
        });
    };

    tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-12"><div class="loader mx-auto"></div></td></tr>';

    const suppliersQuery = query(collection(db, "suppliers"), orderBy("name"));
    unsubscribeSuppliers = onSnapshot(suppliersQuery, (snapshot) => {
        allSuppliers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
        if (term) {
            const filtered = allSuppliers.filter(s => {
                return (s.name || '').toLowerCase().includes(term) ||
                    (s.nit || '').toLowerCase().includes(term) ||
                    (s.contactName || '').toLowerCase().includes(term) ||
                    (s.email || '').toLowerCase().includes(term);
            });
            renderTable(filtered);
        } else {
            renderTable(allSuppliers);
        }
    });

    if (searchInput && !searchInput.dataset.listening) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            suppliersCurrentPage = 1; // Reset a primera página al buscar
            if (!term) {
                renderTable(allSuppliers);
                return;
            }
            const filtered = allSuppliers.filter(s => {
                return (s.name || '').toLowerCase().includes(term) ||
                    (s.nit || '').toLowerCase().includes(term) ||
                    (s.contactName || '').toLowerCase().includes(term) ||
                    (s.email || '').toLowerCase().includes(term);
            });
            renderTable(filtered);
        });
        searchInput.dataset.listening = "true";
    }
}

/**
 * Carga la vista detallada de un proveedor
 */
export async function loadSupplierDetailsView(supplierId) {
    currentSupplierId = supplierId;
    window.currentSupplierId = supplierId;
    showView('supplierDetails');

    const summaryContent = document.getElementById('summary-content');
    const posTableBody = document.getElementById('supplier-pos-table-body');
    const paymentsTableBody = document.getElementById('supplier-payments-table-body');
    const nameTitle = document.getElementById('supplier-details-name');

    summaryContent.innerHTML = '<div class="flex justify-center items-center h-40"><div class="loader"></div></div>';
    posTableBody.innerHTML = '';
    paymentsTableBody.innerHTML = '';

    if (unsubscribeSupplierPOs) unsubscribeSupplierPOs();
    if (unsubscribeSupplierPayments) unsubscribeSupplierPayments();

    const tabsContainer = document.getElementById('supplier-details-tabs');
    const tabContents = document.querySelectorAll('.supplier-tab-content');

    const newTabsContainer = tabsContainer.cloneNode(true);
    tabsContainer.parentNode.replaceChild(newTabsContainer, tabsContainer);

    newTabsContainer.addEventListener('click', (e) => {
        const button = e.target.closest('.tab-button');
        if (button) {
            newTabsContainer.querySelectorAll('.tab-button').forEach(btn => {
                btn.classList.remove('border-purple-600', 'text-purple-600');
                btn.classList.add('border-transparent', 'text-gray-500');
            });
            button.classList.remove('border-transparent', 'text-gray-500');
            button.classList.add('border-purple-600', 'text-purple-600');

            const tabName = button.dataset.tab;
            tabContents.forEach(content => content.classList.toggle('hidden', content.id !== `${tabName}-content`));
        }
    });

    try {
        const supplierRef = doc(db, "suppliers", supplierId);
        const supplierSnap = await getDoc(supplierRef);
        if (!supplierSnap.exists()) throw new Error("Proveedor no encontrado");

        const supplier = { id: supplierSnap.id, ...supplierSnap.data() };
        if (nameTitle) nameTitle.textContent = supplier.name;

        const allPOsQuery = query(collection(db, "purchaseOrders"), where("supplierId", "==", supplierId));
        const allPaymentsQuery = query(collection(db, "suppliers", supplierId, "payments"));

        const [poSnapshot, paymentsSnap] = await Promise.all([getDocs(allPOsQuery), getDocs(allPaymentsQuery)]);

        const totalBilled = poSnapshot.docs.reduce((sum, doc) => {
            const d = doc.data();
            return d.status !== 'anulada' ? sum + (d.totalCost || 0) : sum;
        }, 0);

        const totalPaid = paymentsSnap.docs.reduce((sum, doc) => sum + (doc.data().amount || 0), 0);
        const saldo = totalBilled - totalPaid;

        const initial = (supplier.name || '?').charAt(0).toUpperCase();

        const profileCard = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div class="lg:col-span-2 bg-gradient-to-br from-purple-700 to-indigo-800 rounded-xl shadow-lg text-white p-6 relative overflow-hidden">
                    <div class="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
                        <i class="fa-solid fa-handshake text-9xl"></i>
                    </div>
                    
                    <div class="relative z-10 flex flex-col md:flex-row gap-6 items-start md:items-center">
                        <div class="w-20 h-20 bg-white rounded-2xl flex items-center justify-center text-purple-700 text-4xl font-black shadow-md shrink-0">
                            ${initial}
                        </div>
                        
                        <div class="flex-grow space-y-1">
                            <h2 class="text-2xl font-bold leading-tight">${supplier.name}</h2>
                            <div class="flex flex-wrap gap-3 text-sm text-purple-100">
                                <span class="bg-white/10 px-2 py-0.5 rounded border border-white/20">NIT: ${supplier.nit || '---'}</span>
                                <span class="flex items-center gap-1"><i class="fa-solid fa-location-dot"></i> ${supplier.address || 'Sin dirección'}</span>
                            </div>
                            
                            <div class="pt-4 flex flex-wrap gap-6">
                                <div>
                                    <p class="text-[10px] text-purple-300 uppercase font-bold">Contacto</p>
                                    <p class="font-medium">${supplier.contactName || '---'}</p>
                                </div>
                                <div>
                                    <p class="text-[10px] text-purple-300 uppercase font-bold">Teléfono</p>
                                    <p class="font-medium font-mono">${supplier.contactPhone || '---'}</p>
                                </div>
                                <div>
                                    <p class="text-[10px] text-purple-300 uppercase font-bold">Correo</p>
                                    <p class="font-medium">${supplier.email || '---'}</p>
                                </div>
                            </div>
                        </div>
                        
                        <div class="flex flex-col gap-2 shrink-0">
                            <button data-action="edit-supplier" data-id="${supplier.id}" class="bg-white text-purple-700 hover:bg-purple-50 font-bold py-2 px-4 rounded-lg shadow-sm transition-all text-sm flex items-center justify-center gap-2">
                                <i class="fa-solid fa-pen-to-square"></i> Editar
                            </button>
                            <button data-action="new-supplier-payment" class="bg-emerald-500 text-white hover:bg-emerald-400 font-bold py-2 px-4 rounded-lg shadow-sm transition-all text-sm flex items-center justify-center gap-2 border border-emerald-400/50">
                                <i class="fa-solid fa-money-bill-wave"></i> Pagar
                            </button>
                        </div>
                    </div>
                </div>

                <div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex flex-col justify-between relative overflow-hidden">
                    <div class="absolute top-0 right-0 w-16 h-16 bg-gray-50 rounded-bl-full -mr-8 -mt-8"></div>
                    
                    <div>
                        <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-4 flex items-center">
                            <i class="fa-solid fa-building-columns mr-2 text-indigo-500"></i> Datos Bancarios
                        </h4>
                        <div class="space-y-1 mb-4">
                            <p class="text-sm font-bold text-gray-800">${supplier.bankName || 'No registrado'}</p>
                            <p class="text-xs text-gray-500">${supplier.accountType || 'Cuenta'}</p>
                            <div class="flex items-center gap-2 bg-indigo-50 px-2 py-1.5 rounded border border-indigo-100 w-fit mt-1">
                                <span class="font-mono text-sm font-bold text-indigo-700 select-all">${supplier.accountNumber || '---'}</span>
                                <button onclick="navigator.clipboard.writeText('${supplier.accountNumber}'); window.showToast('Copiado', 'success')" class="text-indigo-400 hover:text-indigo-700 transition-colors">
                                    <i class="fa-regular fa-copy"></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    ${supplier.qrCodeURL ? `
                        <div class="flex items-center gap-3 mt-auto pt-4 border-t border-gray-100 cursor-pointer group" onclick="window.openImageModal('${supplier.qrCodeURL}')">
                            <img src="${supplier.qrCodeURL}" class="w-12 h-12 object-cover rounded border border-gray-200 shadow-sm">
                            <div>
                                <p class="text-xs font-bold text-indigo-600 group-hover:underline">Ver Código QR</p>
                                <p class="text-[10px] text-gray-400">Clic para ampliar</p>
                            </div>
                        </div>
                    ` : '<p class="text-xs text-gray-400 italic mt-auto">Sin QR registrado</p>'}
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                    <div class="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-lg"><i class="fa-solid fa-file-invoice"></i></div>
                    <div><p class="text-[10px] font-bold text-gray-400 uppercase">Facturado Total</p><p class="text-lg font-black text-gray-800">${formatCurrency(totalBilled)}</p></div>
                </div>
                <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                    <div class="w-10 h-10 rounded-full bg-green-50 text-green-600 flex items-center justify-center text-lg"><i class="fa-solid fa-check-circle"></i></div>
                    <div><p class="text-[10px] font-bold text-gray-400 uppercase">Pagado Total</p><p class="text-lg font-black text-green-600">${formatCurrency(totalPaid)}</p></div>
                </div>
                <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                    <div class="w-10 h-10 rounded-full ${saldo > 100 ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-400'} flex items-center justify-center text-lg"><i class="fa-solid fa-scale-unbalanced"></i></div>
                    <div><p class="text-[10px] font-bold text-gray-400 uppercase">Saldo Pendiente</p><p class="text-lg font-black ${saldo > 100 ? 'text-red-600' : 'text-gray-400'}">${formatCurrency(saldo)}</p></div>
                </div>
            </div>
        `;
        summaryContent.innerHTML = profileCard;

        // LISTENER DE ÓRDENES (PO)
        const poQuery = query(collection(db, "purchaseOrders"), where("supplierId", "==", supplierId), orderBy("createdAt", "desc"));
        unsubscribeSupplierPOs = onSnapshot(poQuery, (snapshot) => {
            posTableBody.innerHTML = '';
            if (snapshot.empty) {
                posTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-gray-400"><i class="fa-solid fa-file-circle-xmark text-2xl mb-2 opacity-50"></i><p>No hay órdenes registradas.</p></td></tr>`;
                return;
            }
            snapshot.forEach(doc => {
                const po = { id: doc.id, ...doc.data() };
                const poNumber = po.poNumber || po.id.substring(0, 6);
                const date = po.createdAt ? po.createdAt.toDate().toLocaleDateString('es-CO') : '---';

                let statusBadge;
                if (po.status === 'recibida') statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700 border border-green-200"><i class="fa-solid fa-check mr-1"></i>Recibida</span>`;
                else if (po.status === 'anulada') statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 border border-red-200"><i class="fa-solid fa-ban mr-1"></i>Anulada</span>`;
                else statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200"><i class="fa-solid fa-clock mr-1"></i>Pendiente</span>`;

                const progress = po.totalCost > 0 ? Math.min(((po.paidAmount || 0) / po.totalCost) * 100, 100) : 0;
                const progressColor = progress >= 100 ? 'bg-green-500' : 'bg-indigo-500';

                const row = document.createElement('tr');
                row.className = "bg-white hover:bg-gray-50 border-b last:border-0 transition-colors group";
                row.innerHTML = `
                    <td class="px-6 py-4">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">PO</div>
                            <div>
                                <p class="font-bold text-gray-800 text-sm">#${poNumber}</p>
                                <p class="text-xs text-gray-500">${date}</p>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-right font-bold text-gray-800 text-sm">
                        ${formatCurrency(po.totalCost || 0)}
                    </td>
                    <td class="px-6 py-4 text-center">
                         <div class="w-full bg-gray-200 rounded-full h-1.5 mb-1 max-w-[100px] mx-auto">
                            <div class="${progressColor} h-1.5 rounded-full" style="width: ${progress}%"></div>
                        </div>
                        <span class="text-[10px] text-gray-500 font-semibold">${progress.toFixed(0)}%</span>
                    </td>
                    <td class="px-6 py-4 text-center">${statusBadge}</td>
                    <td class="px-6 py-4 text-center">
                        <button data-action="view-purchase-order" data-id="${po.id}" class="text-gray-400 hover:text-purple-600 hover:bg-purple-50 w-8 h-8 rounded-lg transition-all"><i class="fa-solid fa-eye"></i></button>
                    </td>
                `;
                posTableBody.appendChild(row);
            });
        });

        // LISTENER DE PAGOS
        const paymentsQuery = query(collection(db, "suppliers", supplierId, "payments"), orderBy("date", "desc"));
        unsubscribeSupplierPayments = onSnapshot(paymentsQuery, (snapshot) => {
            paymentsTableBody.innerHTML = '';
            if (snapshot.empty) {
                paymentsTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-12 text-gray-400"><i class="fa-solid fa-wallet text-2xl mb-2 opacity-50"></i><p>No hay pagos registrados.</p></td></tr>`;
                return;
            }
            snapshot.forEach(doc => {
                const p = { id: doc.id, ...doc.data() };
                const row = document.createElement('tr');
                row.className = "bg-white hover:bg-gray-50 border-b last:border-0 transition-colors";

                let iconClass = 'bg-gray-100 text-gray-500';
                let icon = 'fa-money-bill';
                if (p.paymentMethod === 'Transferencia') { iconClass = 'bg-indigo-50 text-indigo-600'; icon = 'fa-building-columns'; }

                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-600 font-medium">
                        ${new Date(p.date + 'T00:00:00').toLocaleDateString('es-CO')}
                    </td>
                    <td class="px-6 py-4">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-lg ${iconClass} flex items-center justify-center shrink-0"><i class="fa-solid ${icon} text-xs"></i></div>
                            <div>
                                <p class="text-sm font-bold text-gray-700">${p.paymentMethod || 'General'}</p>
                                <p class="text-xs text-gray-400 truncate max-w-[200px]">${p.note || ''}</p>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-right font-bold text-emerald-600 text-sm">
                        ${formatCurrency(p.amount || 0)}
                    </td>
                    <td class="px-6 py-4 text-center">
                        <button data-action="delete-supplier-payment" data-id="${p.id}" class="text-gray-400 hover:text-red-600 w-8 h-8 rounded-lg hover:bg-red-50 transition-all"><i class="fa-regular fa-trash-can"></i></button>
                    </td>
                `;
                paymentsTableBody.appendChild(row);
            });
        });

    } catch (error) {
        console.error("Error loading supplier details:", error);
        summaryContent.innerHTML = `<div class="p-6 bg-red-50 border border-red-100 rounded-lg text-center text-red-600">Error: ${error.message}</div>`;
    }
}

/**
 * Busca el último precio de compra de un material específico para un proveedor.
 */
export async function findLastPurchasePrice(supplierId, materialId) {
    try {
        const poQuery = query(
            collection(db, "purchaseOrders"),
            where("supplierId", "==", supplierId),
            where("status", "==", "recibida"),
            orderBy("createdAt", "desc"),
            limit(10)
        );

        const poSnapshot = await getDocs(poQuery);
        if (poSnapshot.empty) return null;

        for (const poDoc of poSnapshot.docs) {
            const poData = poDoc.data();
            if (poData.items && Array.isArray(poData.items)) {
                const foundItem = poData.items.find(item => item.materialId === materialId);
                if (foundItem) return foundItem.unitCost;
            }
        }
        return null;
    } catch (error) {
        console.error("Error al buscar el último precio de compra:", error);
        return null; 
    }
}