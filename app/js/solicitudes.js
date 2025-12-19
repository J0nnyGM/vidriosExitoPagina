import { 
    collection, query, where, getDocs, orderBy, limit, onSnapshot, doc, getDoc, 
    updateDoc, collectionGroup, serverTimestamp, 
    writeBatch, increment // <--- AGREGAR ESTOS DOS
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

let _db;
let _showView;
let _currentUserRole;
let _usersMap;
let _openMainModal;
let unsubscribeSolicitudes = null;

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
    });

    // 5. Configurar Modales (Limpieza de listeners antiguos)
    // app.js también configura estos modales, así que esto es redundante.
    /*
    setupModal('delivery-modal', 'delivery-modal-close-btn', 'delivery-modal-cancel-btn', () => {
        currentDeliveryReqId = null;
        currentDeliveryProjectId = null;
        currentRequestData = null;
    });

    setupModal('request-details-modal', 'request-details-close-btn', 'request-details-cancel-btn');

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
    */
   // --- FIN DEL BLOQUE COMENTADO ---
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
        <div class="w-full px-4 sm:px-6 lg:px-8 py-8">
            <div class="flex flex-col md:flex-row justify-between items-end mb-8 gap-6">
                <div>
                    <h1 class="text-4xl font-black text-gray-800 tracking-tight mb-2">Centro de Solicitudes</h1>
                    <p class="text-gray-500 text-lg">Gestiona aprobaciones y despachos de material.</p>
                </div>

                <div class="bg-white p-1.5 rounded-2xl shadow-sm border border-gray-100 flex">
                    <button id="tab-sol-pendientes" onclick="window.filterSolicitudes('pendientes')" 
                        class="sol-tab-btn px-6 py-3 text-sm font-bold rounded-xl transition-all shadow-md bg-indigo-500 text-white transform scale-100">
                        Por Gestionar
                    </button>
                    <button id="tab-sol-historial" onclick="window.filterSolicitudes('historial')" 
                        class="sol-tab-btn px-6 py-3 text-sm font-bold rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">
                        Historial
                    </button>
                </div>
            </div>

            <div class="relative mb-8 group">
                <div class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-gray-300 group-focus-within:text-indigo-400 transition-colors">
                    <i class="fa-solid fa-search text-lg"></i>
                </div>
                <input type="text" id="solicitudes-search" 
                    class="w-full pl-14 pr-6 py-4 bg-white border-2 border-gray-100 rounded-3xl text-gray-600 placeholder-gray-300 focus:border-indigo-100 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-sm text-lg" 
                    placeholder="Buscar por proyecto o solicitante...">
                <div class="absolute inset-y-0 right-0 pr-6 flex items-center pointer-events-none">
                    <span id="solicitudes-count" class="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-xl text-xs font-bold">0</span>
                </div>
            </div>

            <div id="solicitudes-list-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 min-h-[400px]">
                <div class="col-span-full flex flex-col items-center justify-center py-20 opacity-50">
                    <div class="loader mb-4"></div>
                    <p class="font-medium text-gray-400">Cargando solicitudes...</p>
                </div>
            </div>
        </div>
    `;

    window.filterSolicitudes = (mode) => {
        document.querySelectorAll('.sol-tab-btn').forEach(btn => {
            btn.classList.remove('bg-indigo-500', 'text-white', 'shadow-md', 'transform', 'scale-100');
            btn.classList.add('text-gray-400', 'hover:text-gray-600', 'hover:bg-gray-50');
        });
        const activeBtn = document.getElementById(`tab-sol-${mode}`);
        if(activeBtn) {
            activeBtn.classList.add('bg-indigo-500', 'text-white', 'shadow-md', 'transform', 'scale-100');
            activeBtn.classList.remove('text-gray-400', 'hover:text-gray-600', 'hover:bg-gray-50');
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
        const projectNames = new Map();
        
        snapshot.docs.forEach(docSnap => {
            // Validación anti-crash para documentos huérfanos
            if (!docSnap.ref.parent || !docSnap.ref.parent.parent) return;

            const req = { id: docSnap.id, ...docSnap.data() };
            const projectId = docSnap.ref.parent.parent.id;
            let projectName = "Cargando...";
            
            if (projectNames.has(projectId)) {
                projectName = projectNames.get(projectId);
            } else {
                getDoc(doc(_db, "projects", projectId)).then(snap => {
                    if(snap.exists()) {
                        const name = snap.data().name;
                        projectNames.set(projectId, name);
                        const el = document.getElementById(`proj-name-${req.id}`);
                        if(el) el.textContent = name;
                    }
                }).catch(() => {});
            }

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

// --- FUNCIONES DE ACCIÓN ---

async function handleViewRequestDetails(reqId, projectId) {
    const modal = document.getElementById('request-details-modal');
    const modalContent = document.getElementById('request-details-content');
    if (!modal || !modalContent) return;

    modalContent.innerHTML = '<div class="py-10 text-center"><div class="loader mx-auto"></div></div>';
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    try {
        const reqRef = doc(_db, "projects", projectId, "materialRequests", reqId);
        const reqSnap = await getDoc(reqRef);
        
        if (!reqSnap.exists()) {
            modalContent.innerHTML = '<p class="text-red-500 text-center">Solicitud no encontrada</p>';
            return;
        }

        const reqData = reqSnap.data();
        const items = reqData.consumedItems || reqData.materials || [];
        const dateObj = reqData.createdAt ? reqData.createdAt.toDate() : new Date();
        
        let itemsListHtml = '';
        
        items.forEach(item => {
            const delivered = parseInt(item.deliveredQuantity) || 0;
            const requested = parseInt(item.quantity) || 0;
            const isComplete = delivered >= requested;
            
            // --- CORRECCIÓN: DETECTAR EL USO O DESTINO ---
            // Buscamos si existe un subItem (ej: Ventana 1), una nota o un uso específico
            const usoEnObra = item.subItemName || item.usage || item.notes || ''; 
            
            // Creamos una etiqueta visual si existe información
            const usoHtml = usoEnObra 
                ? `<p class="text-[10px] text-indigo-600 mt-1 font-bold bg-indigo-50 px-2 py-1 rounded-md inline-block border border-indigo-100">
                     <i class="fa-solid fa-screwdriver-wrench mr-1"></i> ${usoEnObra}
                   </p>` 
                : '';
            // ----------------------------------------------

            itemsListHtml += `
                <li class="py-3 flex justify-between items-start border-b border-gray-100 last:border-0 group hover:bg-gray-50/50 transition-colors px-2 rounded-lg">
                    <div class="pr-2">
                        <p class="font-bold text-gray-800 text-sm leading-tight">${item.itemName}</p>
                        
                        <div class="flex items-center gap-2 mt-0.5">
                            <p class="text-xs text-gray-500 font-mono">Ref: ${item.itemReference || '---'}</p>
                        </div>

                        ${usoHtml}
                    </div>

                    <div class="text-right flex-shrink-0">
                        <p class="text-sm font-mono">
                            <span class="${isComplete ? 'text-green-600' : 'text-blue-600'} font-bold text-lg">${delivered}</span> 
                            <span class="text-gray-400 text-xs">/ ${requested}</span>
                        </p>
                        <p class="text-[9px] text-gray-400 uppercase tracking-wide font-bold">Entregado</p>
                    </div>
                </li>
            `;
        });

        let modalActions = '';
        // BOTONES DE ACCIÓN DENTRO DEL MODAL
        if (reqData.status === 'pendiente') {
            modalActions = `
                <div class="grid grid-cols-2 gap-3 mt-6 pt-4 border-t border-gray-100">
                    <button class="py-3 px-4 rounded-xl bg-red-50 text-red-600 font-bold text-sm hover:bg-red-100 border border-red-100 transition-all"
                        onclick="document.getElementById('request-details-close-btn').click(); setTimeout(() => document.querySelector('[data-action=\\'reject-request\\'][data-id=\\'${reqId}\\']')?.click(), 100);">
                        Rechazar
                    </button>
                    <button class="py-3 px-4 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 shadow-lg transition-all"
                        onclick="document.getElementById('request-details-close-btn').click(); setTimeout(() => document.querySelector('[data-action=\\'approve-request\\'][data-id=\\'${reqId}\\']')?.click(), 100);">
                        Aprobar Solicitud
                    </button>
                </div>`;
        } else if (reqData.status === 'aprobado' || reqData.status === 'entregado_parcial') {
            modalActions = `
                <div class="mt-6 pt-4 border-t border-gray-100">
                    <button class="w-full py-3 px-4 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 shadow-lg transition-all"
                        onclick="document.getElementById('request-details-close-btn').click(); setTimeout(() => document.querySelector('[data-action=\\'deliver-material\\'][data-id=\\'${reqId}\\']')?.click(), 100);">
                        <i class="fa-solid fa-dolly mr-2"></i> Registrar Entrega
                    </button>
                </div>`;
        }

        // CORRECCIÓN VISUAL: Tarjeta blanca dentro del fondo gris, sin doble padding.
        modalContent.innerHTML = `
            <div class="space-y-6">
                <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div class="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <p class="text-gray-400 text-[10px] uppercase font-bold">Fecha</p>
                            <p class="font-bold text-gray-800">${dateObj.toLocaleString()}</p>
                        </div>
                        <div>
                            <p class="text-gray-400 text-[10px] uppercase font-bold">Estado</p>
                            <span class="inline-block px-2 py-0.5 rounded text-xs font-bold uppercase bg-gray-100 text-gray-600 border border-gray-200 mt-0.5">${reqData.status.replace('_', ' ')}</span>
                        </div>
                        <div class="col-span-2 mt-2">
                            <p class="text-gray-400 text-[10px] uppercase font-bold mb-1">Notas del Solicitante</p>
                            <div class="bg-gray-50 p-3 rounded-lg text-gray-600 text-sm italic border border-gray-100">
                                "${reqData.notes || 'Sin notas adicionales.'}"
                            </div>
                        </div>
                    </div>
                </div>
                
                <div>
                    <h4 class="font-bold text-gray-800 text-sm mb-3 uppercase tracking-wide flex items-center gap-2">
                        <i class="fa-solid fa-list-check text-indigo-500"></i> Detalle de Materiales
                    </h4>
                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <ul class="max-h-64 overflow-y-auto divide-y divide-gray-100 px-4">
                            ${itemsListHtml}
                        </ul>
                    </div>
                </div>
                
                ${modalActions}
            </div>
        `;
    } catch (error) {
        console.error("Error detalle:", error);
        modalContent.innerHTML = `<p class="text-red-500">Error: ${error.message}</p>`;
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

async function handleOpenDeliveryModal(reqId, projectId) {
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