import { 
    collection, query, where, getDocs, orderBy, limit, onSnapshot, doc, getDoc, 
    updateDoc, collectionGroup, serverTimestamp, 
    writeBatch, increment, documentId, addDoc 
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

let _db;
let _showView;
let _currentUserRole;
let _usersMap;
let _openMainModal;
let unsubscribeSolicitudes = null;
let projectCache = new Map();

// Variables para controlar el modal de entrega
let currentDeliveryReqId = null;
let currentDeliveryProjectId = null;
let currentRequestData = null; 

export function initSolicitudes(db, showView, currentUserRole, usersMap, openMainModal) {
    _db = db;
    _showView = showView;
    _currentUserRole = currentUserRole;
    _usersMap = usersMap;
    _openMainModal = openMainModal;

    // --- CORRECCIÓN: COMENTAMOS ESTE BLOQUE COMPLETO ---
    // El archivo app.js ya maneja estos clics globalmente. 
    // Al tenerlo aquí también, se ejecutaba dos veces (doble modal).
    
    /* document.addEventListener('click', (e) => {
        // 1. Botón "Registrar Entrega / Despachar"
        const deliverBtn = e.target.closest('[data-action="deliver-material"]');
        if (deliverBtn) {
            e.stopPropagation(); 
            e.preventDefault();
            const reqId = deliverBtn.dataset.id;
            const projectId = deliverBtn.dataset.projectId;
            
            if (reqId && projectId) {
                handleOpenDeliveryModal(reqId, projectId);
            }
            return;
        }

        // 2. Botón "Aprobar"
        const approveBtn = e.target.closest('[data-action="approve-request"]');
        if (approveBtn) {
            e.stopPropagation();
            e.preventDefault();
            const reqId = approveBtn.dataset.id;
            const projectId = approveBtn.dataset.projectId;
            if (reqId && projectId) handleApproveRequest(reqId, projectId);
            return;
        }

        // 3. Botón "Rechazar"
        const rejectBtn = e.target.closest('[data-action="reject-request"]');
        if (rejectBtn) {
            e.stopPropagation();
            e.preventDefault();
            const reqId = rejectBtn.dataset.id;
            const projectId = rejectBtn.dataset.projectId;
            if (reqId && projectId) handleRejectRequest(reqId, projectId);
            return;
        }

        // 4. Clic en la Tarjeta (Ver Detalles)
        const card = e.target.closest('[data-action="view-request-details"]');
        if (card && !e.target.closest('button') && !e.target.closest('input') && !e.target.closest('.action-btn')) {
            const reqId = card.dataset.id;
            const projectId = card.dataset.projectId;
            if (reqId && projectId) handleViewRequestDetails(reqId, projectId);
        }
    }); */

    const deliveryForm = document.getElementById('delivery-modal-form');
    if (deliveryForm) {
        const newForm = deliveryForm.cloneNode(true);
        deliveryForm.parentNode.replaceChild(newForm, deliveryForm);
        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleDeliverySubmit(() => {
                document.getElementById('delivery-modal').classList.add('hidden');
                document.getElementById('delivery-modal').classList.remove('flex');
            });
        });
    }

    // 5. Configurar Modales (Limpieza de listeners antiguos)
    setupModal('delivery-modal', 'delivery-modal-close-btn', 'delivery-modal-cancel-btn', () => {
        currentDeliveryReqId = null;
        currentDeliveryProjectId = null;
        currentRequestData = null;
    });

    setupModal('request-details-modal', 'request-details-close-btn', 'request-details-cancel-btn');

   // --- FIN DEL BLOQUE COMENTADO ---

    // Event listeners for Material Request Form
    const materialRequestForm = document.getElementById('material-request-form');
    if (materialRequestForm) {
        materialRequestForm.addEventListener('click', e => {
            const target = e.target;
            const addCutBtn = target.closest('#add-cut-btn-view');
            const addMaterialBtn = target.closest('#add-material-to-request-btn-view');
            const removeCutBtn = target.closest('.remove-cut-btn-view');
            const addCutToRequestBtn = target.closest('.add-cut-to-request-btn-view');
            const addRemnantBtn = target.closest('.add-remnant-to-request-btn-view');
            const removeItemBtn = target.closest('.remove-request-item-btn-view');

            if (addCutBtn) {
                const cutsContainer = document.getElementById('cuts-container-view');
                const cutField = document.createElement('div');
                cutField.className = 'cut-item-view flex flex-col sm:flex-row items-center gap-3 p-3 bg-slate-50 border border-slate-200/60 rounded-xl mb-2 transition-all duration-300 hover:shadow-sm animate-fade-in';
                cutField.innerHTML = `
                    <div class="w-full sm:flex-1 relative">
                        <input type="number" class="cut-length-input-view w-full border border-slate-200 rounded-lg p-2 pl-3 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 bg-white transition-all" placeholder="Medida (cm)">
                    </div>
                    <div class="w-full sm:w-28 relative">
                        <input type="number" class="cut-quantity-input-view w-full border border-slate-200 rounded-lg p-2 pl-3 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 bg-white transition-all" placeholder="Cantidad">
                    </div>
                    <div class="w-full sm:w-auto flex items-center justify-end gap-2 shrink-0">
                        <button type="button" class="add-cut-to-request-btn-view bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white text-xs font-bold py-2 px-4 rounded-lg shadow-sm hover:shadow transition-all flex items-center gap-1.5 transform hover:-translate-y-0.5 shrink-0">
                            <i class="fa-solid fa-plus text-[10px]"></i> Añadir
                        </button>
                        <button type="button" class="remove-cut-btn-view text-slate-400 hover:text-red-500 hover:bg-red-50 p-2 rounded-lg transition-all duration-200 shrink-0" title="Eliminar corte">
                            <i class="fa-solid fa-trash-can text-sm"></i>
                        </button>
                    </div>`;
                if (cutsContainer) cutsContainer.appendChild(cutField);
            }

            if (removeCutBtn) {
                const cutItem = removeCutBtn.closest('.cut-item-view');
                if (cutItem) cutItem.remove();
            }

            if (removeItemBtn) {
                const summaryItem = removeItemBtn.closest('.request-summary-item');
                if (summaryItem) summaryItem.remove();
            }

            if (addMaterialBtn) {
                const quantityInput = document.getElementById('new-request-quantity-view');
                if (!quantityInput) return;
                const quantity = parseInt(quantityInput.value);

                const selectedMaterial = window.materialChoicesView?.getValue();

                if (!selectedMaterial || !quantity || quantity <= 0) {
                    return;
                }

                addMaterialToSummaryList({
                    materialId: selectedMaterial.value,
                    materialName: selectedMaterial.customProperties.name,
                    quantity: quantity,
                    type: 'full_unit'
                });

                quantityInput.value = '';
            }

            if (addCutToRequestBtn) {
                const cutItem = addCutToRequestBtn.closest('.cut-item-view');
                if (!cutItem) return;

                const lengthInCm = parseFloat(cutItem.querySelector('.cut-length-input-view')?.value) || 0;
                const lengthInMeters = lengthInCm / 100;
                const quantity = parseInt(cutItem.querySelector('.cut-quantity-input-view')?.value);

                const selectedMaterial = window.materialChoicesView?.getValue();
                if (!selectedMaterial || !lengthInMeters || quantity <= 0) {
                    alert("Por favor, ingresa una medida y cantidad válidas.");
                    return;
                }

                const defaultLengthInMeters = selectedMaterial.customProperties.defaultLength || 0;

                if (defaultLengthInMeters > 0) {
                    if (lengthInMeters > defaultLengthInMeters) {
                        const defaultLengthInCm = defaultLengthInMeters * 100;
                        alert(`Error: El corte (${lengthInCm} cm) no puede ser más largo que la tira estándar (${defaultLengthInCm} cm) para este material.`);
                        return;
                    }
                }

                addMaterialToSummaryList({
                    materialId: selectedMaterial.value,
                    materialName: selectedMaterial.customProperties.name,
                    quantity: quantity,
                    length: lengthInMeters,
                    type: 'cut'
                });
                cutItem.remove();
            }

            if (addRemnantBtn) {
                const remnantChoiceDiv = addRemnantBtn.closest('.remnant-item-choice');
                if (!remnantChoiceDiv) return;
                const quantityInput = remnantChoiceDiv.querySelector('.remnant-quantity-input');
                if (!quantityInput) return;
                const quantity = parseInt(quantityInput.value);
                const maxQuantity = parseInt(quantityInput.max);

                if (!quantity || quantity <= 0 || quantity > maxQuantity) {
                    alert(`Por favor, introduce una cantidad válida (entre 1 y ${maxQuantity}).`);
                    return;
                }

                const { remnantId, materialId, materialName, remnantText, remnantLength } = addRemnantBtn.dataset;
                addMaterialToSummaryList({
                    materialId: materialId,
                    materialName: materialName,
                    remnantId: remnantId,
                    remnantText: remnantText,
                    remnantLength: parseFloat(remnantLength),
                    quantity: quantity,
                    type: 'remnant'
                });

                const availableQtySpan = remnantChoiceDiv.querySelector('.remnant-available-qty');
                const newAvailableQty = maxQuantity - quantity;
                if (newAvailableQty <= 0) {
                    remnantChoiceDiv.remove();
                } else {
                    if (availableQtySpan) availableQtySpan.textContent = newAvailableQty;
                    quantityInput.max = newAvailableQty;
                    quantityInput.value = '';
                }
            }
        });

        // Search in items
        const searchInput = document.getElementById('request-item-search-view');
        searchInput?.addEventListener('input', e => {
            const queryVal = e.target.value.toLowerCase();
            document.querySelectorAll('#request-item-list-container-view .request-item-card').forEach(item => {
                const name = item.querySelector('label')?.textContent.toLowerCase() || '';
                item.style.display = name.includes(queryVal) ? 'block' : 'none';
            });
        });

        materialRequestForm.addEventListener('submit', handleMaterialRequestSubmit);
    }
}

// Función helper para configurar cierre de modales
function setupModal(modalId, closeBtnId, cancelBtnId, onCloseCallback) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    const closeModal = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        if (onCloseCallback) onCloseCallback();
    };

    const closeBtn = document.getElementById(closeBtnId);
    const cancelBtn = document.getElementById(cancelBtnId);

    if (closeBtn) {
        const newClose = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newClose, closeBtn);
        newClose.addEventListener('click', closeModal);
    }
    if (cancelBtn) {
        const newCancel = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
        newCancel.addEventListener('click', closeModal);
    }
}

export function loadSolicitudesView() {
    _showView('solicitud');
    
    const container = document.getElementById('solicitud-view');
    if (!container) return;

    container.innerHTML = `
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-8 flex flex-col md:flex-row justify-between items-center gap-4 relative overflow-hidden">
            <div class="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-full -mr-16 -mt-16 opacity-50 pointer-events-none"></div>

            <div class="flex items-center gap-4 w-full md:w-auto relative z-10">
                <div class="w-12 h-12 bg-gradient-to-br from-indigo-50 to-purple-50 text-indigo-600 rounded-xl flex items-center justify-center text-2xl shadow-sm border border-indigo-100">
                    <i class="fa-solid fa-boxes-stacked"></i>
                </div>
                <div>
                    <h1 class="text-2xl font-black text-gray-800 tracking-tight leading-none">Centro de Solicitudes</h1>
                    <p class="text-xs text-gray-500 font-medium mt-1">Gestiona aprobaciones y despachos de material</p>
                </div>
            </div>

            <div class="flex bg-gray-100 p-1 rounded-lg w-full md:w-auto border border-gray-200 relative z-10">
                <button id="tab-sol-pendientes" onclick="window.filterSolicitudes('pendientes')" 
                    class="sol-tab-btn flex-1 md:flex-none px-4 py-1.5 text-xs font-bold rounded-md transition-all shadow-sm bg-white text-indigo-600">
                    Por Gestionar
                </button>
                <button id="tab-sol-historial" onclick="window.filterSolicitudes('historial')" 
                    class="sol-tab-btn flex-1 md:flex-none px-4 py-1.5 text-xs font-bold rounded-md text-gray-500 hover:text-gray-700 transition-all">
                    Historial
                </button>
            </div>
        </div>

        <div class="relative mb-6 group">
            <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                <i class="fa-solid fa-magnifying-glass"></i>
            </div>
            <input type="text" id="solicitudes-search" 
                class="w-full pl-10 pr-12 py-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all" 
                placeholder="Buscar por proyecto o solicitante...">
            <div class="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                <span id="solicitudes-count" class="bg-indigo-50 text-indigo-600 px-2.5 py-0.5 rounded-full text-xs font-bold">0</span>
            </div>
        </div>

        <div id="solicitudes-list-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 min-h-[400px]">
            <div class="col-span-full flex flex-col items-center justify-center py-20 opacity-50">
                <div class="loader mb-4"></div>
                <p class="font-medium text-gray-400 text-sm">Cargando solicitudes...</p>
            </div>
        </div>
    `;

    window.filterSolicitudes = (mode) => {
        document.querySelectorAll('.sol-tab-btn').forEach(btn => {
            btn.classList.remove('bg-white', 'text-indigo-600', 'shadow-sm');
            btn.classList.add('text-gray-500', 'hover:text-gray-700');
        });
        const activeBtn = document.getElementById(`tab-sol-${mode}`);
        if(activeBtn) {
            activeBtn.classList.add('bg-white', 'text-indigo-600', 'shadow-sm');
            activeBtn.classList.remove('text-gray-500', 'hover:text-gray-700');
        }
        loadSolicitudesData(mode);
    };

    loadSolicitudesData('pendientes');

    const searchInput = document.getElementById('solicitudes-search');
    if(searchInput){
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const cards = document.querySelectorAll('.solicitud-card');
            let visibleCount = 0;
            cards.forEach(card => {
                if(card.innerText.toLowerCase().includes(term)) {
                    card.style.display = 'flex'; 
                    visibleCount++;
                } else {
                    card.style.display = 'none';
                }
            });
            const countBadge = document.getElementById('solicitudes-count');
            if(countBadge) countBadge.textContent = visibleCount;
        });
    }
}

async function loadSolicitudesData(mode) {
    const listContainer = document.getElementById('solicitudes-list-container');
    if(!listContainer) return;

    if (unsubscribeSolicitudes) unsubscribeSolicitudes();

    let q;
    if (mode === 'pendientes') {
        q = query(
            collectionGroup(_db, 'materialRequests'), 
            where('status', 'in', ['pendiente', 'aprobado', 'entregado_parcial']),
            orderBy('createdAt', 'desc')
        );
    } else {
        q = query(
            collectionGroup(_db, 'materialRequests'), 
            where('status', 'in', ['entregado', 'rechazado']),
            orderBy('createdAt', 'desc'),
            limit(50)
        );
    }

    unsubscribeSolicitudes = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            listContainer.innerHTML = `
                <div class="col-span-full flex flex-col items-center justify-center py-24 text-center">
                    <div class="w-32 h-32 bg-indigo-50 rounded-full flex items-center justify-center mb-6 animate-bounce-slow">
                        <i class="fa-solid fa-clipboard-check text-5xl text-indigo-200"></i>
                    </div>
                    <h3 class="text-2xl font-bold text-gray-700 mb-2">Sin pendientes</h3>
                    <p class="text-gray-400 max-w-md">No hay solicitudes para gestionar en este momento.</p>
                </div>`;
            const countBadge = document.getElementById('solicitudes-count');
            if(countBadge) countBadge.textContent = 0;
            return;
        }

        listContainer.innerHTML = '';
        
        snapshot.docs.forEach(docSnap => {
            // Validación anti-crash para documentos huérfanos
            if (!docSnap.ref.parent || !docSnap.ref.parent.parent) return;

            const req = { id: docSnap.id, ...docSnap.data() };
            const projectId = docSnap.ref.parent.parent.id;
            let projectName = "Cargando...";
            
            if (projectCache.has(projectId)) {
                projectName = projectCache.get(projectId);
            } else {
                getDoc(doc(_db, "projects", projectId)).then(snap => {
                    if(snap.exists()) {
                        const name = snap.data().name;
                        projectCache.set(projectId, name);
                        const el = document.getElementById(`proj-name-${req.id}`);
                        if(el) el.textContent = name;
                    }
                }).catch(() => {});
            };

            const card = createSolicitudCard(req, projectId, projectName);
            listContainer.appendChild(card);
        });
        const countBadge = document.getElementById('solicitudes-count');
        if(countBadge) countBadge.textContent = listContainer.children.length;
    });
}

function createSolicitudCard(req, projectId, projectName) {
    const requesterUser = _usersMap.get(req.requesterId);
    const requesterName = requesterUser ? `${requesterUser.firstName} ${requesterUser.lastName}` : 'Usuario';
    const initials = requesterUser ? (requesterUser.firstName[0] + (requesterUser.lastName[0] || '')).toUpperCase() : '?';
    
    const dateObj = req.createdAt ? req.createdAt.toDate() : new Date();
    const date = dateObj.toLocaleString('es-CO', { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
    
    const statusConfig = {
        'pendiente': { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Por Aprobar', border: 'border-amber-200', icon: 'fa-hourglass-half' },
        'aprobado': { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Por Despachar', border: 'border-blue-200', icon: 'fa-thumbs-up' },
        'entregado_parcial': { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Entrega Parcial', border: 'border-orange-200', icon: 'fa-box-open' },
        'entregado': { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Entregado Total', border: 'border-emerald-200', icon: 'fa-check-circle' },
        'rechazado': { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Rechazado', border: 'border-rose-200', icon: 'fa-ban' },
    };
    const st = statusConfig[req.status] || statusConfig['pendiente'];

    const items = req.consumedItems || req.materials || [];
    let itemsHtml = '';
    
    // Función auxiliar para calcular entregas reales (Lógica mejorada)
    const getRealDeliveredQuantity = (item) => {
        let total = parseInt(item.deliveredQuantity) || 0;
        if (req.deliveryHistory && Array.isArray(req.deliveryHistory)) {
            let historialTotal = 0;
            req.deliveryHistory.forEach(delivery => {
                if (delivery.items && Array.isArray(delivery.items)) {
                    delivery.items.forEach(dItem => {
                        // Normalizamos para comparar
                        const sameId = String(dItem.materialId) === String(item.materialId);
                        const sameType = (dItem.type || 'full_unit') === (item.type || 'full_unit');
                        const sameLength = (parseFloat(dItem.length) || 0) === (parseFloat(item.length) || 0);
                        if (sameId && sameType && sameLength) {
                            historialTotal += (parseInt(dItem.quantity) || 0);
                        }
                    });
                }
            });
            if (historialTotal > total) total = historialTotal;
        }
        return total;
    };

    items.slice(0, 3).forEach(item => {
        const delivered = getRealDeliveredQuantity(item);
        const requested = parseInt(item.quantity) || 0;
        const progressPercent = requested > 0 ? Math.min(100, Math.round((delivered / requested) * 100)) : 0;
        const progressColor = progressPercent >= 100 ? 'bg-emerald-500' : 'bg-blue-500';

        itemsHtml += `
            <div class="mb-2 last:mb-0">
                <div class="flex justify-between text-xs text-gray-600 mb-0.5">
                    <span class="font-medium truncate max-w-[70%]">${item.itemName || 'Ítem'}</span>
                    <span class="font-mono"><span class="font-bold text-gray-800">${delivered}</span> / ${requested}</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-1.5">
                    <div class="${progressColor} h-1.5 rounded-full transition-all duration-500" style="width: ${progressPercent}%"></div>
                </div>
            </div>`;
    });

    if (items.length > 3) {
        itemsHtml += `<div class="text-xs text-center text-indigo-400 font-medium mt-2">+ ${items.length - 3} ítems más</div>`;
    }

    const card = document.createElement('div');
    card.className = "solicitud-card bg-white rounded-3xl p-5 border border-gray-100 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col relative group cursor-pointer";
    
    card.setAttribute('data-action', 'view-request-details');
    card.setAttribute('data-id', req.id);
    card.setAttribute('data-project-id', projectId);

    // --- LÓGICA DE BOTONES ACTUALIZADA ---
    let actionButtons = '';
    
    if (req.status === 'pendiente') {
        // Pendiente: Aprobar / Rechazar
        actionButtons = `
            <div class="flex gap-2 relative z-20 mt-2">
                <button class="action-btn flex-1 py-2 px-2 rounded-xl bg-red-50 text-red-600 font-bold text-xs hover:bg-red-100 border border-red-100 transition-all flex items-center justify-center gap-2 active:scale-95"
                    data-action="reject-request" data-id="${req.id}" data-project-id="${projectId}">
                    Rechazar
                </button>
                <button class="action-btn flex-[2] py-2 px-2 rounded-xl bg-blue-600 text-white font-bold text-xs hover:bg-blue-700 shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95"
                    data-action="approve-request" data-id="${req.id}" data-project-id="${projectId}">
                    <i class="fa-solid fa-check"></i> Aprobar
                </button>
            </div>`;

    } else if (req.status === 'aprobado' || req.status === 'entregado_parcial') {
        // Aprobado o Parcial: Solo "Continuar Entrega" (Ya NO sale devolver aquí)
        const btnText = req.status === 'entregado_parcial' ? 'Continuar Entrega' : 'Registrar Entrega';
        actionButtons = `
            <button class="action-btn w-full mt-2 py-3 px-4 rounded-2xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 hover:shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95 relative z-20"
                data-action="deliver-material" data-id="${req.id}" data-project-id="${projectId}">
                <i class="fa-solid fa-dolly"></i> ${btnText}
            </button>`;

    } else if (req.status === 'entregado') {
        // Entregado Total (Historial): Aquí SÍ sale el botón de Devolver
        actionButtons = `
            <button class="action-btn w-full mt-2 py-2 px-4 rounded-2xl bg-white border border-gray-200 text-gray-600 font-bold text-xs hover:bg-gray-50 hover:text-yellow-600 transition-all flex items-center justify-center gap-2 active:scale-95 relative z-20"
                data-action="return-material" data-id="${req.id}" data-project-id="${projectId}">
                <i class="fa-solid fa-rotate-left"></i> Devolver Material
            </button>`;
            
    } else {
        // Rechazado
        actionButtons = `<div class="w-full py-2 text-center text-gray-300 text-xs font-bold">Finalizada</div>`;
    }

    card.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 group-hover:text-indigo-600 transition-colors flex-shrink-0 border border-gray-100">
                    <i class="fa-solid ${st.icon}"></i>
                </div>
                <div class="min-w-0">
                    <h4 class="font-bold text-gray-800 text-sm leading-tight truncate" id="proj-name-${req.id}">${projectName}</h4>
                    <p class="text-[10px] text-gray-400 mt-0.5">${date}</p>
                </div>
            </div>
            <span class="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide border ${st.bg} ${st.text} ${st.border} flex-shrink-0">
                ${st.label}
            </span>
        </div>

        <div class="flex items-center gap-2 mb-4 p-1.5 bg-gray-50 rounded-lg border border-gray-100 w-fit max-w-full">
            <div class="w-6 h-6 rounded-full bg-white flex items-center justify-center text-[10px] font-bold text-gray-500 shadow-sm border border-gray-100">
                ${initials}
            </div>
            <p class="text-xs font-bold text-gray-700 truncate pr-2">${requesterName}</p>
        </div>

        <div class="bg-gray-50/50 rounded-2xl p-4 mb-2 border border-gray-100 flex-grow pointer-events-none">
            ${itemsHtml}
        </div>

        <div class="mt-auto relative z-10"> 
            ${actionButtons}
        </div>
    `;

    return card;
}

export async function handleViewRequestDetails(reqId, projectId) {
    const modal = document.getElementById('request-details-modal');
    const modalContent = document.getElementById('request-details-content');
    if (!modal || !modalContent) return;

    // Ajustar dinámicamente el tamaño del modal a ancho premium
    const modalContainer = modal.querySelector('.premium-modal-card') || modal.querySelector('.w-11\\/12');
    if (modalContainer) {
        modalContainer.className = "w-11/12 md:max-w-5xl bg-white rounded-3xl overflow-hidden shadow-2xl border border-slate-100 flex flex-col max-h-[95vh] animate-scale-up";
    }

    modalContent.innerHTML = '<div class="py-20 text-center"><div class="loader mx-auto"></div></div>';
    modal.style.display = ''; // Reset inline style
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    try {
        const reqRef = doc(_db, "projects", projectId, "materialRequests", reqId);
        const reqSnap = await getDoc(reqRef);
        
        if (!reqSnap.exists()) {
            modalContent.innerHTML = '<p class="text-red-500 text-center font-bold">Solicitud no encontrada</p>';
            return;
        }

        const reqData = reqSnap.data();
        const items = reqData.consumedItems || reqData.materials || [];
        
        // 1. Obtener la Tarea Asociada
        let associatedTaskHtml = '';
        if (reqData.taskId) {
            let taskDescription = "Cargando...";
            try {
                const taskSnap = await getDoc(doc(_db, "tasks", reqData.taskId));
                if (taskSnap.exists()) {
                    taskDescription = taskSnap.data().description || "Tarea sin descripción";
                } else {
                    taskDescription = "Tarea no encontrada";
                }
            } catch (e) {
                console.warn(e);
                taskDescription = "Error al recuperar detalles de la tarea";
            }
            associatedTaskHtml = `
                <div class="bg-indigo-50 border border-indigo-100 rounded-2xl p-5 flex items-center gap-4 shadow-sm mb-6">
                    <div class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-blue-500 shadow-sm shrink-0 border border-blue-100">
                        <i class="fa-solid fa-thumbtack text-lg"></i>
                    </div>
                    <div>
                        <p class="text-[9px] font-bold text-indigo-400 uppercase tracking-wider leading-none">TAREA ASOCIADA</p>
                        <p class="text-sm font-black text-indigo-950 uppercase mt-1.5 leading-normal">"${taskDescription.toUpperCase()}"</p>
                    </div>
                </div>
            `;
        }

        // 2. Mapear estado
        const statusConfig = {
            'pendiente': { bg: 'bg-white', text: 'text-amber-600', border: 'border-amber-100', label: 'Por Aprobar', icon: 'fa-hourglass-half' },
            'aprobado': { bg: 'bg-white', text: 'text-blue-600', border: 'border-blue-100', label: 'APROBADO', icon: 'fa-thumbs-up' },
            'entregado_parcial': { bg: 'bg-white', text: 'text-orange-600', border: 'border-orange-100', label: 'Entrega Parcial', icon: 'fa-box-open' },
            'entregado': { bg: 'bg-white', text: 'text-emerald-600', border: 'border-emerald-100', label: 'Entregado Total', icon: 'fa-check-circle' },
            'rechazado': { bg: 'bg-white', text: 'text-rose-600', border: 'border-rose-100', label: 'Rechazado', icon: 'fa-ban' },
        };
        const st = statusConfig[reqData.status] || statusConfig['pendiente'];

        // Helper para fechas
        const formatDate = (timestamp) => {
            if (!timestamp) return 'Pendiente';
            const dateObj = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
            return dateObj.toLocaleString('es-CO', { 
                day: 'numeric', 
                month: 'short', 
                hour: 'numeric', 
                minute: '2-digit', 
                hour12: true 
            }).replace('.', '');
        };

        // 3. Renderizar listado de materiales
        let itemsTableHtml = '';
        items.forEach((item, idx) => {
            const delivered = parseInt(item.deliveredQuantity) || 0;
            const requested = parseInt(item.quantity) || 0;
            const detailText = item.length ? `${item.length * 100} cm` : 'Estándar';
            
            let deliveredColor = 'text-orange-500 font-bold';
            if (delivered >= requested) {
                deliveredColor = 'text-green-600 font-bold';
            }

            itemsTableHtml += `
                <tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50/20 transition-colors">
                    <td class="py-3.5 pl-5 text-center text-slate-400 font-bold font-mono text-[11px]">${idx + 1}</td>
                    <td class="py-3.5">
                        <div class="flex items-center gap-3">
                            <div class="w-9 h-9 bg-slate-50 text-slate-400 border border-slate-100 rounded-lg flex items-center justify-center shrink-0 shadow-inner">
                                 <i class="fa-solid fa-box text-xs"></i>
                            </div>
                            <span class="font-bold text-slate-700 text-xs">${item.itemName || 'Material'}</span>
                        </div>
                    </td>
                    <td class="py-3.5 text-center text-slate-400 font-bold text-xs italic">${detailText}</td>
                    <td class="py-3.5 text-center text-slate-800 font-bold text-xs">${requested}</td>
                    <td class="py-3.5 text-center ${deliveredColor} text-xs font-black">${delivered}</td>
                    <td class="py-3.5 pr-5 text-center text-slate-400 font-semibold text-xs">-</td>
                </tr>
            `;
        });

        // 4. Renderizar Destino / Uso en obra
        let usoEnObraHtml = `
            <i class="fa-solid fa-trowel-bricks text-slate-300 text-3xl mb-2"></i>
            <p class="text-xs font-bold text-slate-400">No se especificó un destino en obra.</p>
        `;
        if (reqData.notes) {
            usoEnObraHtml = `
                <div class="w-full text-left bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Notas de instalación</p>
                    <p class="text-xs font-semibold text-slate-600 italic">"${reqData.notes}"</p>
                </div>
            `;
        }

        // 5. Cronología del proceso
        const createdAtStr = formatDate(reqData.createdAt);
        const approvedAtStr = formatDate(reqData.approvedAt || reqData.rejectedAt);
        const deliveredAtStr = formatDate(reqData.lastDeliveryAt);

        let timelineHtml = `
            <div class="relative">
                <div class="absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-blue-500 border-4 border-white flex items-center justify-center shadow-sm z-10"></div>
                <p class="text-xs font-bold text-slate-700 leading-tight">Solicitado</p>
                <p class="text-[10px] text-slate-400 mt-0.5">${createdAtStr}</p>
            </div>
        `;

        if (reqData.status === 'rechazado') {
            timelineHtml += `
                <div class="relative mt-5">
                    <div class="absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-rose-500 border-4 border-white flex items-center justify-center shadow-sm z-10"></div>
                    <p class="text-xs font-bold text-rose-600 leading-tight">Rechazado</p>
                    <p class="text-[10px] text-slate-400 mt-0.5">${approvedAtStr}</p>
                </div>
            `;
        } else {
            const hasApproved = reqData.status !== 'pendiente';
            const approvedBulletColor = hasApproved ? 'bg-blue-500' : 'bg-slate-250';
            const approvedTextColor = hasApproved ? 'text-slate-800' : 'text-slate-400';
            timelineHtml += `
                <div class="relative mt-5">
                    <div class="absolute -left-[31px] top-1 w-4 h-4 rounded-full ${approvedBulletColor} border-4 border-white flex items-center justify-center shadow-sm z-10"></div>
                    <p class="text-xs font-bold ${approvedTextColor} leading-tight">Aprobado</p>
                    <p class="text-[10px] text-slate-400 mt-0.5">${approvedAtStr}</p>
                </div>
            `;

            const hasDelivered = reqData.status === 'entregado' || reqData.status === 'entregado_parcial';
            const deliveredBulletColor = hasDelivered ? 'bg-blue-500' : 'bg-slate-200';
            const deliveredTextColor = hasDelivered ? 'text-slate-800' : 'text-slate-400';
            timelineHtml += `
                <div class="relative mt-5">
                    <div class="absolute -left-[31px] top-1 w-4 h-4 rounded-full ${deliveredBulletColor} border-4 border-white flex items-center justify-center shadow-sm z-10"></div>
                    <p class="text-xs font-bold ${deliveredTextColor} leading-tight">${reqData.status === 'entregado_parcial' ? 'Entregado Parcial' : 'Entregado'}</p>
                    <p class="text-[10px] text-slate-400 mt-0.5">${deliveredAtStr}</p>
                </div>
            `;
        }

        // 6. Solicitante
        const requesterUser = _usersMap.get(reqData.requesterId);
        const requesterName = requesterUser ? `${requesterUser.firstName} ${requesterUser.lastName}` : 'Usuario';
        const requesterInitials = requesterUser ? (requesterUser.firstName[0] + (requesterUser.lastName[0] || '')).toUpperCase() : '?';
        const requesterRole = requesterUser ? (requesterUser.role === 'operario' ? 'Operario' : requesterUser.role.charAt(0).toUpperCase() + requesterUser.role.slice(1)) : 'Usuario';

        // 7. Gestor
        const managerUser = reqData.responsibleId ? _usersMap.get(reqData.responsibleId) : null;
        const managedByName = managerUser ? `${managerUser.firstName} ${managerUser.lastName}` : (reqData.approvedBy ? `Personal (${reqData.approvedBy})` : 'Pendiente');
        const managedByRole = managerUser ? (managerUser.role.charAt(0).toUpperCase() + managerUser.role.slice(1)) : (reqData.approvedBy ? 'Administración' : 'N/A');

        // 8. Botones del footer
        let footerActions = '';
        if (reqData.status === 'pendiente') {
            if (_currentUserRole === 'admin' || _currentUserRole === 'bodega') {
                footerActions += `
                    <button class="px-5 py-2.5 rounded-xl border border-rose-100 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs transition-all active:scale-95 shadow-sm"
                        onclick="closeRequestDetailsModal(); setTimeout(() => document.querySelector('[data-action=\\'reject-request\\'][data-id=\\'${reqId}\\']')?.click(), 100);">
                        Rechazar
                    </button>
                    <button class="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-xs hover:bg-blue-700 shadow-md hover:shadow-lg transition-all active:scale-95 flex items-center gap-1.5"
                        onclick="closeRequestDetailsModal(); setTimeout(() => document.querySelector('[data-action=\\'approve-request\\'][data-id=\\'${reqId}\\']')?.click(), 100);">
                        <i class="fa-solid fa-check"></i> Aprobar Solicitud
                    </button>
                `;
            }
        } else if (reqData.status === 'aprobado' || reqData.status === 'entregado_parcial') {
            if (_currentUserRole === 'admin' || _currentUserRole === 'bodega') {
                footerActions += `
                    <button class="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-xs hover:bg-blue-700 shadow-md hover:shadow-lg transition-all active:scale-95 flex items-center gap-2"
                        onclick="closeRequestDetailsModal(); setTimeout(() => document.querySelector('[data-action=\\'deliver-material\\'][data-id=\\'${reqId}\\']')?.click(), 100);">
                        <i class="fa-solid fa-cart-shopping"></i> Registrar Entrega
                    </button>
                `;
            }
        } else if (reqData.status === 'entregado') {
            if (_currentUserRole === 'admin' || _currentUserRole === 'bodega') {
                footerActions += `
                    <button class="px-6 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50 hover:text-yellow-600 transition-all active:scale-95 flex items-center gap-2 shadow-sm"
                        onclick="closeRequestDetailsModal(); setTimeout(() => document.querySelector('[data-action=\\'return-material\\'][data-id=\\'${reqId}\\']')?.click(), 100);">
                        <i class="fa-solid fa-rotate-left"></i> Devolver Material
                    </button>
                `;
            }
        }

        // Reconstrucción del contenedor modal
        if (modalContainer) {
            modalContainer.innerHTML = `
                <!-- HEADER PREMIUM OSCURO -->
                <div class="bg-slate-900 px-6 py-4 flex justify-between items-center relative overflow-hidden shrink-0">
                    <div class="absolute top-0 right-0 w-32 h-32 bg-slate-800/20 rounded-full -mr-16 -mt-16 pointer-events-none"></div>
                    <div class="relative z-10 flex flex-col items-start gap-1">
                        <span class="inline-block bg-[#374151]/75 text-slate-300 px-2 py-0.5 rounded text-[10px] font-bold font-mono tracking-wider border border-slate-700/50 shadow-inner">ID: ${reqId.substring(0, 6).toUpperCase()}</span>
                        <h3 class="text-2xl font-black text-white tracking-tight leading-tight">Solicitud de Material</h3>
                    </div>
                    <div class="flex items-center gap-3 relative z-10">
                        <span class="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border ${st.bg} ${st.text} ${st.border} flex items-center gap-1.5 shadow-md">
                            <i class="fa-solid ${st.icon}"></i> ${st.label}
                        </span>
                        <button id="request-details-close-btn" data-action="close-details-modal" onclick="closeRequestDetailsModal()"
                            class="text-slate-400 hover:text-white hover:bg-slate-800/80 p-1.5 rounded-full transition-all">
                            <i class="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>
                </div>

                <!-- CUERPO EN 2 COLUMNAS -->
                <div id="request-details-content" class="p-6 overflow-y-auto bg-slate-50/50 space-y-6 flex-grow custom-scrollbar">
                    
                    ${associatedTaskHtml}

                    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                        <!-- COLUMNA IZQUIERDA (8/12) -->
                        <div class="lg:col-span-8 space-y-6">
                            
                            <!-- MATERIALES REQUERIDOS -->
                            <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                                <div class="px-5 py-4 bg-white border-b border-slate-100 flex justify-between items-center">
                                    <h4 class="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                                        <i class="fa-solid fa-boxes-stacked text-indigo-500"></i> Materiales Requeridos
                                    </h4>
                                    <span class="bg-blue-50 text-blue-600 border border-blue-100 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wide shrink-0">${items.length} ítems</span>
                                </div>
                                <div class="overflow-x-auto">
                                    <table class="w-full text-left text-xs border-collapse">
                                        <thead class="bg-slate-50 text-slate-400 uppercase font-bold border-b border-slate-100">
                                            <tr>
                                                <th class="py-3 pl-5 text-center w-12 font-semibold">#</th>
                                                <th class="py-3 font-semibold">Material</th>
                                                <th class="py-3 text-center w-24 font-semibold">Detalle</th>
                                                <th class="py-3 text-center w-16 font-semibold">Solic.</th>
                                                <th class="py-3 text-center w-16 font-semibold">Entreg.</th>
                                                <th class="py-3 pr-5 text-center w-16 font-semibold text-rose-500 font-bold">Dev.</th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-slate-50">
                                            ${itemsTableHtml}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <!-- USO EN OBRA -->
                            <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden p-5">
                                <h4 class="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2 mb-4">
                                    <i class="fa-solid fa-helmet-safety text-amber-500"></i> Uso en Obra
                                </h4>
                                <div class="border-2 border-dashed border-slate-100 rounded-2xl py-6 px-4 text-center flex flex-col items-center justify-center">
                                    ${usoEnObraHtml}
                                </div>
                            </div>
                        </div>

                        <!-- COLUMNA DERECHA (4/12) -->
                        <div class="lg:col-span-4 space-y-6">
                            
                            <!-- CRONOLOGÍA -->
                            <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
                                <h4 class="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2 mb-5">
                                    <i class="fa-solid fa-timeline text-indigo-500"></i> Cronología del Proceso
                                </h4>
                                <div class="relative pl-6 border-l-2 border-slate-100 space-y-5 py-1 ml-3">
                                    ${timelineHtml}
                                </div>
                            </div>

                            <!-- SOLICITADO POR -->
                            <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 flex items-center gap-4 hover:shadow transition-all duration-300">
                                <div class="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm shadow-inner shrink-0 border border-blue-100">
                                    ${requesterInitials}
                                </div>
                                <div class="min-w-0">
                                    <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none">Solicitado Por</p>
                                    <p class="text-xs font-black text-slate-850 uppercase truncate mt-1 leading-normal">${requesterName}</p>
                                    <p class="text-[10px] text-slate-400 font-semibold leading-none mt-0.5">${requesterRole}</p>
                                </div>
                            </div>

                            <!-- GESTIONADO POR -->
                            <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 flex items-center gap-4 hover:shadow transition-all duration-300">
                                <div class="w-10 h-10 rounded-full bg-slate-50 text-slate-450 flex items-center justify-center text-sm border border-slate-200 shrink-0 shadow-inner">
                                    <i class="fa-solid fa-user"></i>
                                </div>
                                <div class="min-w-0">
                                    <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none">Gestionado Por</p>
                                    <p class="text-xs font-black text-slate-850 uppercase truncate mt-1 leading-normal">${managedByName}</p>
                                    <p class="text-[10px] text-slate-400 font-semibold leading-none mt-0.5">${managedByRole}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- FOOTER -->
                <div id="request-details-footer" class="p-4 border-t border-slate-100 flex flex-wrap justify-end gap-2 bg-white shrink-0">
                    ${footerActions}
                    <button type="button" id="request-details-cancel-btn" onclick="closeRequestDetailsModal()"
                        class="px-5 py-2.5 rounded-xl border border-slate-250 bg-white hover:bg-slate-50 text-slate-600 font-bold text-xs transition-all shadow-sm active:scale-95">
                        Cerrar
                    </button>
                </div>
            `;
        }

        // Re-adjuntar eventos close/cancel para robustez completa
        setupModal('request-details-modal', 'request-details-close-btn', 'request-details-cancel-btn');

    } catch (error) {
        console.error("Error detalle:", error);
        modalContent.innerHTML = `<p class="text-red-500 font-bold text-center py-6">Error al cargar: ${error.message}</p>`;
    }
}

async function handleApproveRequest(reqId, projectId) {
    if (!confirm("¿Aprobar esta solicitud?")) return;

    const btn = document.querySelector(`button[data-id="${reqId}"][data-action="approve-request"]`);
    if(btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
    }

    try {
        const reqRef = doc(_db, "projects", projectId, "materialRequests", reqId);
        await updateDoc(reqRef, {
            status: 'aprobado',
            approvedAt: serverTimestamp(),
            approvedBy: _currentUserRole 
        });
    } catch (error) {
        console.error("Error:", error);
        alert("Error: " + error.message);
        if(btn) {
            btn.disabled = false;
            btn.innerHTML = 'Aprobar';
        }
    }
}

async function handleRejectRequest(reqId, projectId) {
    if (!confirm("¿Rechazar esta solicitud?")) return;

    const btn = document.querySelector(`button[data-id="${reqId}"][data-action="reject-request"]`);
    if(btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
    }

    try {
        const reqRef = doc(_db, "projects", projectId, "materialRequests", reqId);
        await updateDoc(reqRef, {
            status: 'rechazado',
            rejectedAt: serverTimestamp(),
            rejectedBy: _currentUserRole
        });
    } catch (error) {
        console.error("Error:", error);
        alert("Error: " + error.message);
        if(btn) {
            btn.disabled = false;
            btn.innerHTML = 'Rechazar';
        }
    }
}

export async function handleOpenDeliveryModal(reqId, projectId) {
    const modal = document.getElementById('delivery-modal');
    const modalBody = document.getElementById('delivery-modal-body');
    const confirmBtn = document.getElementById('delivery-modal-confirm-btn');

    if (!modal || !modalBody) return;

    currentDeliveryReqId = reqId;
    currentDeliveryProjectId = projectId;
    
    modalBody.innerHTML = '<div class="py-10 text-center"><div class="loader mx-auto"></div></div>';
    if(confirmBtn) confirmBtn.disabled = true;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    try {
        const reqRef = doc(_db, "projects", projectId, "materialRequests", reqId);
        const reqSnap = await getDoc(reqRef);

        if (!reqSnap.exists()) {
            modalBody.innerHTML = '<p class="text-red-500 text-center">Error: Documento no encontrado</p>';
            return;
        }

        currentRequestData = reqSnap.data(); 
        const items = currentRequestData.consumedItems || currentRequestData.materials || [];

        let html = `
            <div class="bg-indigo-50 p-4 rounded-xl mb-4 border border-indigo-100">
                <h4 class="text-sm font-bold text-indigo-900 mb-1">Despacho de Material</h4>
                <p class="text-xs text-indigo-700">Confirma las cantidades a entregar hoy.</p>
            </div>
            <div class="space-y-2 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
        `;

        items.forEach((item, index) => {
            const requested = parseInt(item.quantity) || 0;
            const alreadyDelivered = parseInt(item.deliveredQuantity) || 0;
            const remaining = Math.max(0, requested - alreadyDelivered);
            const isCompleted = remaining === 0;
            const bgColor = isCompleted ? 'bg-green-50 border-green-100' : 'bg-white border-gray-200';

            html += `
                <div class="flex flex-col sm:flex-row items-center justify-between p-3 rounded-xl border ${bgColor} shadow-sm gap-3">
                    <div class="flex items-center gap-3 w-full sm:w-auto">
                        <div class="${isCompleted ? 'bg-green-200 text-green-700' : 'bg-gray-100 text-gray-500'} w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs shrink-0">
                           ${isCompleted ? '<i class="fa-solid fa-check"></i>' : (index + 1)}
                        </div>
                        <div>
                            <p class="font-bold text-gray-800 text-sm">${item.itemName}</p>
                            <p class="text-xs text-gray-500">
                                Pedido: <strong>${requested}</strong> | 
                                Entregado: <strong class="text-blue-600">${alreadyDelivered}</strong>
                            </p>
                        </div>
                    </div>
                    
                    <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
                        ${isCompleted ? 
                            `<span class="px-3 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-lg"><i class="fa-solid fa-check mr-1"></i> Listo</span>` 
                            : 
                            `<div class="flex flex-col items-end w-24">
                                <label class="text-[9px] text-gray-400 font-bold uppercase mb-0.5">A entregar</label>
                                <input type="number" 
                                    class="delivery-input w-full p-2 border border-gray-300 rounded-lg font-bold text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-sm"
                                    data-index="${index}"
                                    value="${remaining}" 
                                    min="0" 
                                    max="${remaining}">
                            </div>`
                        }
                    </div>
                </div>
            `;
        });

        html += '</div>';
        modalBody.innerHTML = html;
        if(confirmBtn) {
            confirmBtn.textContent = 'Confirmar Despacho';
            confirmBtn.classList.remove('bg-green-600');
            confirmBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
            confirmBtn.disabled = false;
        }

    } catch (error) {
        console.error("Error modal:", error);
        modalBody.innerHTML = `<p class="text-red-500">Error: ${error.message}</p>`;
    }
}

async function handleDeliverySubmit(closeModalCallback) {
    if (!currentDeliveryReqId || !currentDeliveryProjectId || !currentRequestData) return;

    const confirmBtn = document.getElementById('delivery-modal-confirm-btn');
    const inputs = document.querySelectorAll('.delivery-input');
    
    let hasChanges = false;
    let deliveryDataMap = {}; // Mapa: índice -> cantidad a entregar

    // 1. Recolectar datos del formulario
    inputs.forEach(input => {
        const val = parseInt(input.value) || 0;
        if (val > 0) {
            hasChanges = true;
            deliveryDataMap[input.dataset.index] = val;
        }
    });

    if (!hasChanges) {
        alert("Por favor, indica la cantidad a entregar (mayor a 0).");
        return;
    }

    if(confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Validando stock...';
    }

    try {
        const batch = writeBatch(_db); // Iniciamos un lote de escritura
        const originalItems = currentRequestData.consumedItems || currentRequestData.materials || [];
        let allCompleted = true;

        // 2. VALIDACIÓN DE STOCK (CRÍTICO)
        // Usamos un bucle for...of para poder usar 'await' dentro y detener el proceso si algo falla
        for (const indexStr of Object.keys(deliveryDataMap)) {
            const index = parseInt(indexStr);
            const deliveringNow = deliveryDataMap[index];
            const item = originalItems[index];
            
            // Intentamos obtener el ID del material. 
            // Nota: En tu estructura debe existir 'materialId' o 'itemId' que enlace al catálogo.
            const materialId = item.materialId || item.itemId;

            if (!materialId) {
                throw new Error(`El ítem "${item.itemName}" no tiene un ID de material vinculado para verificar stock.`);
            }

            // Consultar el inventario global en tiempo real
            const materialRef = doc(_db, "materialCatalog", materialId);
            const materialSnap = await getDoc(materialRef);

            if (!materialSnap.exists()) {
                throw new Error(`El material "${item.itemName}" no se encuentra en el Catálogo de Bodega.`);
            }

            const currentStock = parseInt(materialSnap.data().quantityInStock) || 0;

            // --- AQUÍ ESTÁ LA MAGIA: CHEQUEO DE STOCK ---
            if (currentStock < deliveringNow) {
                throw new Error(`🚫 STOCK INSUFICIENTE para: ${item.itemName}\n\n📦 En Bodega: ${currentStock}\n🚚 Intentas entregar: ${deliveringNow}\n\nPor favor ajusta la cantidad o abastece el inventario.`);
            }

            // Si pasa la validación, agendamos el descuento en el batch
            batch.update(materialRef, { 
                quantityInStock: increment(-deliveringNow) 
            });
        }

        // 3. PREPARAR ACTUALIZACIÓN DE LA SOLICITUD
        const updatedItems = originalItems.map((item, index) => {
            const prevDelivered = parseInt(item.deliveredQuantity) || 0;
            const requested = parseInt(item.quantity) || 0;
            
            // Si este ítem se está entregando ahora, sumamos
            const deliveringNow = deliveryDataMap[index] || 0;
            const totalDelivered = prevDelivered + deliveringNow;
            
            if (totalDelivered < requested) allCompleted = false;

            return {
                ...item,
                deliveredQuantity: totalDelivered
            };
        });

        // Verificar también los ítems que NO se están entregando hoy, para ver si faltan
        originalItems.forEach((item, index) => {
             if(!deliveryDataMap.hasOwnProperty(index)) {
                 const prev = parseInt(item.deliveredQuantity) || 0;
                 const req = parseInt(item.quantity) || 0;
                 if(prev < req) allCompleted = false;
             }
        });

        const newStatus = allCompleted ? 'entregado' : 'entregado_parcial';
        const reqRef = doc(_db, "projects", currentDeliveryProjectId, "materialRequests", currentDeliveryReqId);
        
        // Actualizamos la solicitud en el mismo batch
        batch.update(reqRef, {
            consumedItems: updatedItems, 
            status: newStatus,
            lastDeliveryAt: serverTimestamp()
        });

        // 4. EJECUTAR TODO (Inventario + Solicitud) AL TIEMPO
        if(confirmBtn) confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
        
        await batch.commit(); // <-- AQUÍ SE GUARDA TODO. Si falla algo antes, no se guarda nada.

        // Feedback Visual
        if(confirmBtn) {
            confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Guardado!';
            confirmBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            confirmBtn.classList.add('bg-green-600', 'hover:bg-green-700');
        }
        
        setTimeout(() => {
            if(closeModalCallback) closeModalCallback();
            // Restaurar botón
            if(confirmBtn) {
                confirmBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
                confirmBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
                confirmBtn.textContent = 'Confirmar Despacho';
                confirmBtn.disabled = false;
            }
        }, 1000);

    } catch (error) {
        console.error("Error submit:", error);
        // Mostramos el mensaje de error (ej: Stock insuficiente)
        alert(error.message); 
        
        if(confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = 'Confirmar Despacho';
        }
    }
}

// --- RECOVERY OF MISSING FUNCTIONS (OLA 6) ---

export function closeRequestDetailsModal() {
    const modal = document.getElementById('request-details-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = ''; // Clear inline styles
    }
}

export function setupAddMaterialButton(choicesInstance) {
    const addBtn = document.getElementById('add-material-to-request-btn');
    const quantityInput = document.getElementById('new-request-quantity');
    const itemsListDiv = document.getElementById('request-items-list');

    if (!addBtn) return;

    addBtn.addEventListener('click', () => {
        const selectedItem = choicesInstance.getValue();
        if (!selectedItem) {
            alert("Por favor, selecciona un material de la lista.");
            return;
        }
        const materialId = selectedItem.value;
        const materialName = selectedItem.customProperties.name;
        const quantity = parseInt(quantityInput.value);

        if (materialId && quantity > 0) {
            const listItem = document.createElement('div');
            listItem.className = 'flex justify-between items-center bg-gray-100 p-2 rounded-md text-sm';
            listItem.dataset.materialId = materialId;
            listItem.dataset.quantity = quantity;
            listItem.innerHTML = `<span>${quantity} x ${materialName}</span><button type="button" class="remove-request-item-btn text-red-500 font-bold text-lg leading-none">&times;</button>`;
            itemsListDiv.appendChild(listItem);

            // Limpia los campos después de añadir
            quantityInput.value = '';
            choicesInstance.removeActiveItems();
            choicesInstance.setChoiceByValue('');
        }
    });

    // Listener para eliminar ítems de la lista de solicitud
    itemsListDiv.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove-request-item-btn');
        if (removeBtn) {
            removeBtn.parentElement.remove();
        }
    });
}

export function setupRequestItemSearch() {
    const searchInput = document.getElementById('request-item-search');
    const listContainer = document.getElementById('request-item-list-container');
    if (!searchInput || !listContainer) return;

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase();
        const items = listContainer.querySelectorAll('.request-item-card');
        items.forEach(item => {
            const name = item.querySelector('label').textContent.toLowerCase();
            if (name.includes(query)) {
                item.style.display = 'block';
            } else {
                item.style.display = 'none';
            }
        });
    });
}

export function resetMaterialRequestForm() {
    const form = document.getElementById('material-request-form');
    if (!form) return;

    form.reset();

    const summaryList = document.getElementById('request-items-list-view');
    if (summaryList) {
        summaryList.innerHTML = '<p class="text-sm text-gray-400 text-center">Añade materiales para verlos aquí.</p>';
    }

    if (window.materialChoicesView) {
        window.materialChoicesView.removeActiveItems();
        window.materialChoicesView.setChoiceByValue('');
    }

    // --- INICIO DE LA CORRECCIÓN ---
    // Se reescribió esta sección para evitar el error de sintaxis.
    const unitsSection = document.getElementById('units-section-view');
    if (unitsSection) unitsSection.classList.add('hidden');

    const divisibleSection = document.getElementById('divisible-section-view');
    if (divisibleSection) divisibleSection.classList.add('hidden');

    const remnantsContainer = document.getElementById('remnants-container-view');
    if (remnantsContainer) remnantsContainer.classList.add('hidden');

    const cutsContainer = document.getElementById('cuts-container-view');
    if (cutsContainer) cutsContainer.innerHTML = '';

    const remnantsList = document.getElementById('remnants-list-view');
    if (remnantsList) remnantsList.innerHTML = '';
    // --- FIN DE LA CORRECCIÓN ---
}

export async function showMaterialRequestView(taskItems = null) {
    _showView('material-request-view');
    document.getElementById('material-request-project-name').textContent = window.currentProject?.name || '';

    // Actualizar texto del botón Volver según el contexto
    const backBtn = document.querySelector('#material-request-view button[data-action="back-to-project"]');
    if (backBtn) {
        const returnCtx = window.materialRequestReturnContext;
        if (returnCtx && (returnCtx.view === 'tareas' || returnCtx.view === 'detalle-tarea')) {
            backBtn.innerHTML = `&larr; Volver a Tareas`;
        } else {
            backBtn.innerHTML = `&larr; Volver al Proyecto`;
        }
    }

    // Limpiar el ID de la tarea por defecto
    const taskIdInput = document.getElementById('material-request-task-id');
    if (taskIdInput) taskIdInput.value = '';

    const itemListContainer = document.getElementById('request-item-list-container-view');
    const userSelectorContainer = document.getElementById('request-user-selector-container-view');

    // Renderizar la estructura base INMEDIATAMENTE
    if (itemListContainer) itemListContainer.innerHTML = '<p class="text-gray-400 italic text-center py-4">Cargando ítems del proyecto...</p>';
    if (userSelectorContainer) userSelectorContainer.innerHTML = '';

    // Renderizar selector de materiales con estado de carga
    const selectContainer = document.querySelector('#material-choices-select-view')?.parentNode;
    if (selectContainer) selectContainer.innerHTML = '<select id="material-choices-select-view" disabled><option>Cargando materiales...</option></select>';
    
    // Deshabilitamos secciones dependientes mientras carga
    document.getElementById('units-section-view')?.classList.add('hidden');
    document.getElementById('divisible-section-view')?.classList.add('hidden');
    document.getElementById('remnants-container-view')?.classList.add('hidden');
    
    const cutsContainer = document.getElementById('cuts-container-view');
    if (cutsContainer) cutsContainer.innerHTML = '';
    const remnantsList = document.getElementById('remnants-list-view');
    if (remnantsList) remnantsList.innerHTML = '';
    const requestItemsList = document.getElementById('request-items-list-view');
    if (requestItemsList) requestItemsList.innerHTML = '<p class="text-sm text-gray-400 text-center">Añade materiales para verlos aquí.</p>';

    // Función asíncrona para cargar el catálogo y configurar Choices.js
    const loadCatalogAndSetupChoices = async () => {
        try {
            const inventorySnapshot = await getDocs(query(collection(_db, "materialCatalog"), orderBy("name")));
            const inventory = inventorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const materialOptions = inventory
                .filter(mat => mat && mat.name)
                .map(mat => {
                    const referencePart = mat.reference ? `[${mat.reference}] ` : '';
                    const systemPart = mat.system ? `${mat.system} - ` : '';
                    const colorPart = mat.color ? ` (${mat.color})` : '';
                    const fullFormattedName = `${referencePart}${systemPart}${mat.name}${colorPart}`;
                    return {
                        value: mat.id,
                        label: `${fullFormattedName} (Stock: ${mat.quantityInStock || 0})`,
                        customProperties: { 
                            isDivisible: mat.isDivisible, 
                            name: fullFormattedName, 
                            defaultLength: (mat.defaultSize?.length || 0) 
                        }
                    };
                });

            if (selectContainer) selectContainer.innerHTML = '<select id="material-choices-select-view"></select>';
            if (window.materialChoicesView) {
                window.materialChoicesView.destroy();
            }
            window.materialChoicesView = new Choices('#material-choices-select-view', {
                choices: materialOptions,
                searchEnabled: true, itemSelectText: 'Seleccionar', placeholder: true, placeholderValue: 'Escribe para buscar...',
                allowHTML: false
            });

            // Re-añadir el listener de 'change' al nuevo elemento select
            document.getElementById('material-choices-select-view')?.addEventListener('change', async () => {
                const divisibleSection = document.getElementById('divisible-section-view');
                const unitsSection = document.getElementById('units-section-view');
                const remnantsContainer = document.getElementById('remnants-container-view');
                const remnantsList = document.getElementById('remnants-list-view');
                
                if (divisibleSection) divisibleSection.classList.add('hidden');
                if (unitsSection) unitsSection.classList.add('hidden');
                if (remnantsContainer) remnantsContainer.classList.add('hidden');
                
                if (document.getElementById('cuts-container-view')) document.getElementById('cuts-container-view').innerHTML = '';
                if (document.getElementById('new-request-quantity-view')) document.getElementById('new-request-quantity-view').value = '';
                if (remnantsList) remnantsList.innerHTML = '';
                
                const selectedMaterial = window.materialChoicesView?.getValue();
                if (selectedMaterial) {
                    if (unitsSection) unitsSection.classList.remove('hidden');
                    if (selectedMaterial.customProperties.isDivisible) {
                        if (divisibleSection) divisibleSection.classList.remove('hidden');
                        const remnantsSnapshot = await getDocs(query(collection(_db, "materialCatalog", selectedMaterial.value, "remnantStock"), where("quantity", ">", 0)));
                        if (!remnantsSnapshot.empty) {
                            if (remnantsContainer) remnantsContainer.classList.remove('hidden');
                            remnantsSnapshot.forEach(doc => {
                                const remnant = { id: doc.id, ...doc.data() };
                                const remnantLengthInCm = (remnant.length || 0) * 100;
                                const remnantText = `Retazo de ${remnantLengthInCm} cm`;
                                
                                    remnantsList.innerHTML += `
                                        <div class="remnant-item-choice flex items-center justify-between text-xs p-3 bg-white border border-amber-100 rounded-xl shadow-sm hover:shadow transition-all duration-200 gap-4 animate-fade-in w-full">
                                            <span class="font-semibold text-slate-700 flex items-center gap-1.5">
                                                <i class="fa-solid fa-scissors text-amber-500"></i>
                                                <span><span class="remnant-available-qty text-amber-600 font-bold">${remnant.quantity}</span> und. de ${remnantText}</span>
                                            </span>
                                            <div class="flex items-center gap-2 shrink-0">
                                                <input type="number" class="remnant-quantity-input w-16 border border-slate-200 rounded-lg p-1.5 text-center text-xs font-semibold text-slate-700 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-100 bg-slate-50/50" placeholder="Cant." min="1" max="${remnant.quantity}">
                                                <button type="button" data-remnant-id="${remnant.id}" data-remnant-length="${remnant.length}" data-material-id="${selectedMaterial.value}" data-material-name="${selectedMaterial.customProperties.name}" data-remnant-text="${remnantText}" class="add-remnant-to-request-btn-view bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-[10px] font-black uppercase tracking-wider py-1.5 px-3 rounded-lg shadow-sm hover:shadow transition-all flex items-center gap-1 transform hover:-translate-y-0.5">
                                                    <i class="fa-solid fa-plus text-[9px]"></i> Añadir
                                                </button>
                                            </div>
                                        </div>`;
                            });
                        }
                    }
                }
            });

        } catch (error) {
            console.error("Error al cargar el catálogo de materiales:", error);
            if (selectContainer) selectContainer.innerHTML = '<select id="material-choices-select-view" disabled><option>Error al cargar</option></select>';
        }
    };

    // Función asíncrona para cargar los ítems del proyecto/tarea
    const loadProjectOrTaskItems = async () => {
        try {
            if (!window.currentProject) return;
            let items = [];
            if (taskItems && taskItems.length > 0) {
                const itemIds = taskItems.map(item => item.itemId);

                if (itemIds.length > 0) {
                    const itemsQuery = query(collection(_db, "projects", window.currentProject.id, "items"), where(documentId(), "in", itemIds));
                    const itemsSnapshot = await getDocs(itemsQuery);
                    const itemsMap = new Map(itemsSnapshot.docs.map(doc => [doc.id, doc.data()]));
                    items = taskItems.map(taskItem => {
                        const itemData = itemsMap.get(taskItem.itemId);
                        return {
                            id: taskItem.itemId,
                            name: itemData ? itemData.name : 'Ítem Desconocido',
                            quantity: taskItem.quantity
                        };
                    });
                }
            } else {
                // Cargar todos los ítems del proyecto
                const itemsSnapshot = await getDocs(query(collection(_db, "projects", window.currentProject.id, "items"), orderBy("name")));
                items = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            }

            // Renderizar la lista de ítems
            if (itemListContainer) {
                if (items.length === 0) {
                    itemListContainer.innerHTML = '<p class="text-gray-500 italic text-center py-4">No hay ítems disponibles.</p>';
                } else {
                    itemListContainer.innerHTML = items.filter(item => item && item.id && item.name).map(item => `
                        <div class="request-item-card p-3 border border-slate-200/60 rounded-xl bg-slate-50/50 hover:bg-white hover:shadow transition-all duration-200">
                            <label class="block text-xs font-bold text-slate-700 mb-2 flex items-center justify-between">
                                <span>${item.name}</span>
                                <span class="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md text-[10px] font-black shrink-0">${item.quantity} unds. disp.</span>
                            </label>
                            <div class="flex items-center justify-between gap-4">
                                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cantidad para este item:</span>
                                <input type="number" data-item-id="${item.id}" class="request-item-quantity w-24 border border-slate-200 rounded-lg p-1.5 text-center text-xs font-semibold text-slate-700 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-100 bg-white" placeholder="0" min="0" max="${item.quantity}">
                            </div>
                        </div>`).join('');
                }
            }

        } catch (error) {
            console.error("Error al cargar ítems del proyecto/tarea:", error);
            if (itemListContainer) itemListContainer.innerHTML = '<p class="text-red-500 text-center py-4">Error al cargar ítems.</p>';
        }
    };

    // Función asíncrona para cargar el selector de usuario (si aplica)
    const loadUserSelector = () => {
        if (_currentUserRole === 'admin' || _currentUserRole === 'bodega') {
            const userOptions = Array.from(_usersMap.entries())
                .filter(([uid, user]) => user.status === 'active')
                .map(([uid, user]) => `<option value="${uid}" ${uid === window.currentUser?.uid ? 'selected' : ''}>${user.firstName} ${user.lastName}</option>`)
                .join('');
            if (userSelectorContainer) {
                userSelectorContainer.innerHTML = `
                    <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 relative overflow-hidden">
                        <div class="absolute top-0 left-0 w-1.5 h-full bg-amber-500 rounded-l-2xl"></div>
                        <h4 class="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
                            <span class="w-6 h-6 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center text-xs font-bold">4</span>
                            Autorización
                        </h4>
                        <p class="text-xs text-slate-400 font-medium mb-3">Registrar la solicitud a nombre de:</p>
                        <select id="request-as-user-select-view" class="w-full border border-slate-200 rounded-xl p-3 text-xs font-semibold text-slate-700 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 bg-white cursor-pointer transition-all">
                            ${userOptions}
                        </select>
                    </div>`;
            }
        } else {
            if (userSelectorContainer) userSelectorContainer.innerHTML = '';
        }
    };

    // Ejecutar las cargas de datos en paralelo
    await Promise.all([
        loadCatalogAndSetupChoices(),
        loadProjectOrTaskItems(),
        loadUserSelector()
    ]);
}

export async function handleMaterialRequestSubmit(e) {
    e.preventDefault();

    const summaryList = document.getElementById('request-items-list-view');
    if (!summaryList) return;
    const consumedItemsNodes = summaryList.querySelectorAll('.request-summary-item');
    const itemUsageNodes = document.querySelectorAll('#request-item-list-container-view .request-item-quantity');
    const userSelector = document.getElementById('request-as-user-select-view');
    const taskId = document.getElementById('material-request-task-id')?.value;

    if (consumedItemsNodes.length === 0) {
        alert("Debes añadir al menos un material a la solicitud.");
        return;
    }
    
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    try {
        const consumedItems = Array.from(consumedItemsNodes).map(node => {
            const materialName = node.dataset.materialName || "Material Desconocido";

            const data = {
                materialId: node.dataset.materialId,
                type: node.dataset.type,
                quantity: parseInt(node.dataset.quantity, 10),
                itemName: materialName
            };

            if (node.dataset.type === 'cut') {
                data.length = parseFloat(node.dataset.length);
            } else if (node.dataset.type === 'remnant') {
                data.length = parseFloat(node.dataset.length || node.dataset.remnantLength || 0);
            }
            return data;
        });

        const itemsToConsume = Array.from(itemUsageNodes)
            .filter(input => parseInt(input.value, 10) > 0)
            .map(input => ({
                itemId: input.dataset.itemId,
                quantityConsumed: parseInt(input.value, 10)
            }));

        const requesterId = (userSelector && userSelector.value) ? userSelector.value : window.currentUser?.uid;
        const requestCollection = collection(_db, "projects", window.currentProject.id, "materialRequests");

        const requestData = {
            projectId: window.currentProject.id,
            requesterId: requesterId,
            createdAt: new Date(),
            status: 'pendiente',
            consumedItems: consumedItems,
            itemsToConsume: itemsToConsume
        };
        if (taskId && taskId.trim() !== '') {
            requestData.taskId = taskId;
        }
        await addDoc(requestCollection, requestData);

        alert("¡Solicitud enviada con éxito!");
        resetMaterialRequestForm();

        // Lógica de Retorno
        const returnCtx = window.materialRequestReturnContext || { view: 'proyectos' };
        console.log("Volviendo al contexto:", returnCtx.view);

        if (returnCtx.view === 'tareas' || returnCtx.view === 'detalle-tarea') {
            _showView('tareas');
            if (typeof window.loadAndDisplayTasks === 'function') {
                window.loadAndDisplayTasks('pendiente');
            }
            if (returnCtx.view === 'detalle-tarea' && returnCtx.taskId && typeof window.openTaskDetailsModal === 'function') {
                window.openTaskDetailsModal(returnCtx.taskId);
            }
        }
        else if (returnCtx.view === 'proyectos' || !window.currentProject || _currentUserRole !== 'admin') {
            if (typeof window.showGeneralDashboard === 'function') {
                window.showGeneralDashboard();
            } else {
                _showView('dashboard');
            }
        }
        else {
            if (typeof window.showProjectDetails === 'function') {
                window.showProjectDetails(window.currentProject, 'materiales');
            }
        }

    } catch (error) {
        console.error("Error al enviar la solicitud de material:", error);
        alert("Ocurrió un error al enviar la solicitud.");
    } finally {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        window.materialRequestReturnContext = { view: 'proyectos' };
    }
}

export function addMaterialToSummaryList(item) {
    const listDiv = document.getElementById('request-items-list-view');
    if (!listDiv) return;
    if (listDiv.querySelector('p')) {
        listDiv.innerHTML = '';
    }

    let existingItemDiv = null;
    let newQuantity = item.quantity;
    let text = '';

    switch (item.type) {
        case 'full_unit':
            existingItemDiv = listDiv.querySelector(`.request-summary-item[data-type="full_unit"][data-material-id="${item.materialId}"]`);
            break;
        case 'cut':
            existingItemDiv = listDiv.querySelector(`.request-summary-item[data-type="cut"][data-material-id="${item.materialId}"][data-length="${item.length}"]`);
            break;
        case 'remnant':
            existingItemDiv = listDiv.querySelector(`.request-summary-item[data-type="remnant"][data-material-id="${item.materialId}"][data-remnant-length="${item.remnantLength}"]`);
            break;
    }

    if (existingItemDiv) {
        const currentQuantity = parseInt(existingItemDiv.dataset.quantity, 10) || 0;
        newQuantity = currentQuantity + item.quantity;
        existingItemDiv.dataset.quantity = newQuantity;

        switch (item.type) {
            case 'full_unit': text = `${newQuantity} x ${item.materialName}`; break;
            case 'cut': text = `${newQuantity} corte(s) de ${item.length * 100} cm - ${item.materialName}`; break;
            case 'remnant': text = `${newQuantity} retazo(s) ${item.materialName} ${item.remnantText}`; break;
        }

        let iconClass = 'fa-cube';
        switch (item.type) {
            case 'full_unit': iconClass = 'fa-box text-blue-500'; break;
            case 'cut': iconClass = 'fa-scissors text-indigo-500'; break;
            case 'remnant': iconClass = 'fa-recycle text-amber-500'; break;
        }

        const spanNode = existingItemDiv.querySelector('.summary-text-node');
        if (spanNode) {
            spanNode.textContent = text;
        } else {
            const fallbackSpan = existingItemDiv.querySelector('span');
            if (fallbackSpan) fallbackSpan.textContent = text;
        }
    } else {
        switch (item.type) {
            case 'full_unit': text = `${item.quantity} x ${item.materialName}`; break;
            case 'cut': text = `${item.quantity} corte(s) de ${item.length * 100} cm - ${item.materialName}`; break;
            case 'remnant': text = `${item.quantity} retazo(s) ${item.materialName} ${item.remnantText}`; break;
        }
        let iconClass = 'fa-cube';
        switch (item.type) {
            case 'full_unit': iconClass = 'fa-box text-blue-500'; break;
            case 'cut': iconClass = 'fa-scissors text-indigo-500'; break;
            case 'remnant': iconClass = 'fa-recycle text-amber-500'; break;
        }

        const itemDiv = document.createElement('div');
        itemDiv.className = 'request-summary-item flex justify-between items-center bg-slate-50 border border-slate-200/60 p-3 rounded-xl text-xs font-semibold text-slate-700 shadow-sm hover:shadow transition-all duration-200 gap-4 animate-fade-in';

        itemDiv.dataset.materialId = item.materialId;
        itemDiv.dataset.materialName = item.materialName;
        itemDiv.dataset.type = item.type;
        itemDiv.dataset.quantity = item.quantity;
        if (item.length) itemDiv.dataset.length = item.length;
        if (item.remnantId) itemDiv.dataset.remnantId = item.remnantId;
        if (item.remnantLength) itemDiv.dataset.remnantLength = item.remnantLength;
        if (item.remnantText) itemDiv.dataset.remnantText = item.remnantText;

        itemDiv.innerHTML = `<span class="flex items-center gap-2"><i class="fa-solid ${iconClass}"></i><span class="summary-text-node">${text}</span></span><button type="button" class="remove-request-item-btn-view text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-all duration-200 shrink-0" title="Quitar item"><i class="fa-solid fa-trash-can text-sm"></i></button>`;
        listDiv.appendChild(itemDiv);
    }
}
