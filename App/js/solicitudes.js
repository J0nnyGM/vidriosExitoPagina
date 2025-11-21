import {
    collection, query, where, getDocs, orderBy, limit, onSnapshot, doc, getDoc, 
    updateDoc, collectionGroup, documentId
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

let _db;
let _showView;
let _currentUserRole;
let _usersMap;
let _openMainModal;
let unsubscribeSolicitudes = null;

export function initSolicitudes(db, showView, currentUserRole, usersMap, openMainModal) {
    _db = db;
    _showView = showView;
    _currentUserRole = currentUserRole;
    _usersMap = usersMap;
    _openMainModal = openMainModal;
}

export function loadSolicitudesView() {
    _showView('solicitud');
    
    const container = document.getElementById('solicitud-view');
    if (!container) return;

    // --- HEADER AMIGABLE Y LIMPIO ---
    container.innerHTML = `
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            
            <div class="flex flex-col md:flex-row justify-between items-end mb-8 gap-6">
                <div>
                    <h1 class="text-4xl font-black text-gray-800 tracking-tight mb-2">Centro de Solicitudes</h1>
                    <p class="text-gray-500 text-lg">Controla los despachos de material de forma visual.</p>
                </div>

                <div class="bg-white p-1.5 rounded-2xl shadow-sm border border-gray-100 flex">
                    <button id="tab-sol-pendientes" onclick="window.filterSolicitudes('pendientes')" 
                        class="sol-tab-btn px-6 py-3 text-sm font-bold rounded-xl transition-all shadow-md bg-indigo-500 text-white transform scale-100">
                        Pendientes
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
                    placeholder="Escribe para buscar por proyecto, solicitante o material...">
                <div class="absolute inset-y-0 right-0 pr-6 flex items-center pointer-events-none">
                    <span id="solicitudes-count" class="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-xl text-xs font-bold">0</span>
                </div>
            </div>

            <div id="solicitudes-list-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 min-h-[400px]">
                <div class="col-span-full flex flex-col items-center justify-center py-20 opacity-50">
                    <div class="loader mb-4"></div>
                    <p class="font-medium text-gray-400">Buscando solicitudes...</p>
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
        activeBtn.classList.remove('text-gray-400', 'hover:text-gray-600', 'hover:bg-gray-50');
        activeBtn.classList.add('bg-indigo-500', 'text-white', 'shadow-md', 'transform', 'scale-100');
        
        loadSolicitudesData(mode);
    };

    loadSolicitudesData('pendientes');

    document.getElementById('solicitudes-search').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const cards = document.querySelectorAll('.solicitud-card');
        let visibleCount = 0;
        cards.forEach(card => {
            if(card.innerText.toLowerCase().includes(term)) {
                card.style.display = 'flex'; // Flex para mantener el layout
                visibleCount++;
            } else {
                card.style.display = 'none';
            }
        });
        document.getElementById('solicitudes-count').textContent = visibleCount;
    });
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

    unsubscribeSolicitudes = onSnapshot(q, async (snapshot) => {
        if (snapshot.empty) {
            listContainer.innerHTML = `
                <div class="col-span-full flex flex-col items-center justify-center py-24 text-center">
                    <div class="w-32 h-32 bg-indigo-50 rounded-full flex items-center justify-center mb-6 animate-bounce-slow">
                        <i class="fa-solid fa-clipboard-check text-5xl text-indigo-200"></i>
                    </div>
                    <h3 class="text-2xl font-bold text-gray-700 mb-2">Todo limpio por aquí</h3>
                    <p class="text-gray-400 max-w-md">No hay solicitudes ${mode === 'pendientes' ? 'pendientes para despachar' : 'en el historial reciente'}.</p>
                </div>`;
            document.getElementById('solicitudes-count').textContent = 0;
            return;
        }

        listContainer.innerHTML = '';
        const projectNames = new Map();
        
        // Cargar datos y pintar
        for (const docSnap of snapshot.docs) {
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
                });
            }

            const card = createSolicitudCard(req, projectId, projectName);
            listContainer.appendChild(card);
        }
        document.getElementById('solicitudes-count').textContent = snapshot.size;
    });
}

function createSolicitudCard(req, projectId, projectName) {
    const requesterUser = _usersMap.get(req.requesterId);
    const requesterName = requesterUser ? `${requesterUser.firstName} ${requesterUser.lastName}` : 'Usuario Desconocido';
    const initials = requesterUser ? (requesterUser.firstName[0] + (requesterUser.lastName[0] || '')).toUpperCase() : '?';
    
    const dateObj = req.createdAt ? req.createdAt.toDate() : new Date();
    const date = dateObj.toLocaleString('es-CO', { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
    
    const statusConfig = {
        'pendiente': { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Pendiente', border: 'border-amber-200' },
        'aprobado': { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Aprobado', border: 'border-blue-200' },
        'entregado_parcial': { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Parcial', border: 'border-orange-200' },
        'entregado': { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Entregado', border: 'border-emerald-200' },
        'rechazado': { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Rechazado', border: 'border-rose-200' },
    };
    const st = statusConfig[req.status] || statusConfig['pendiente'];

    const items = req.consumedItems || req.materials || [];
    let itemsHtml = '';
    items.slice(0, 3).forEach(item => {
        itemsHtml += `
            <div class="flex justify-between items-center text-sm text-gray-600 mb-1.5 last:mb-0">
                <div class="flex items-center gap-2 overflow-hidden">
                    <div class="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0"></div>
                    <span class="truncate">${item.itemName || 'Material'}</span>
                </div>
                <span class="font-bold bg-white px-2 py-0.5 rounded text-xs border border-gray-100 shadow-sm text-gray-700 whitespace-nowrap">
                    ${item.quantity}
                </span>
            </div>`;
    });
    if (items.length > 3) {
        itemsHtml += `<div class="text-xs text-center text-indigo-400 font-medium mt-2 bg-indigo-50 rounded py-1">+ ${items.length - 3} materiales más</div>`;
    }

    const card = document.createElement('div');
    // CAMBIO 1: Clases para interacción en la tarjeta completa
    card.className = "solicitud-card bg-white rounded-3xl p-5 border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col relative group cursor-pointer select-none";
    
    // CAMBIO 2: Atributos de acción en el contenedor principal
    card.setAttribute('data-action', 'view-request-details');
    card.setAttribute('data-id', req.id);
    card.setAttribute('data-project-id', projectId);

    card.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-400 text-xl group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors flex-shrink-0">
                    <i class="fa-solid fa-cube"></i>
                </div>
                <div class="min-w-0">
                    <h4 class="font-extrabold text-gray-800 text-base leading-tight truncate pr-2 group-hover:text-indigo-600 transition-colors" id="proj-name-${req.id}">${projectName}</h4>
                    <p class="text-xs text-gray-400 mt-1 flex items-center gap-1">
                        <i class="fa-regular fa-clock"></i> ${date}
                    </p>
                </div>
            </div>
            <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${st.bg} ${st.text} ${st.border} flex-shrink-0">
                ${st.label}
            </span>
        </div>

        <div class="flex items-center gap-3 mb-5 p-2 pr-4 bg-gray-50 rounded-full border border-gray-100 w-fit max-w-full">
            <div class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-xs font-bold text-gray-500 shadow-sm border border-gray-100 flex-shrink-0">
                ${initials}
            </div>
            <div class="truncate">
                <p class="text-xs font-bold text-gray-700 truncate">${requesterName}</p>
            </div>
        </div>

        <div class="bg-gray-50/50 rounded-2xl p-4 mb-2 border border-gray-100 flex-grow group-hover:border-indigo-100 transition-colors">
            <p class="text-[10px] font-bold text-gray-400 uppercase mb-3 tracking-wider">Materiales Solicitados</p>
            ${itemsHtml}
        </div>

        <div class="mt-auto pt-4 relative z-10"> 
            ${ (_currentUserRole === 'admin' || _currentUserRole === 'bodega') && req.status !== 'entregado' && req.status !== 'rechazado' ? `
            <button class="w-full py-3 px-4 rounded-2xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-200 transition-all flex items-center justify-center gap-2 active:scale-95"
                data-action="deliver-material" data-id="${req.id}">
                <i class="fa-solid fa-dolly text-sm"></i> Despachar
            </button>
            ` : `
             <div class="w-full py-2 text-center text-gray-300 text-xs font-bold group-hover:text-indigo-400 transition-colors flex items-center justify-center gap-2">
                Ver detalles <i class="fa-solid fa-arrow-right"></i>
            </div>
            `}
        </div>
    `;

    return card;
}