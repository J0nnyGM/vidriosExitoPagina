// js/modules/whatsapp.js

import { db, storage, functions } from '../firebase-config.js';
import { collection, query, onSnapshot, orderBy, doc, updateDoc, serverTimestamp, limit, getDocs, where } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
import { currentUserData, showModalMessage, showTemporaryMessage, allClientes, allRemisiones, hideModal } from '../app.js';
import { formatCurrency } from '../utils.js';

let unsubscribeChats = null;
let unsubscribeMessages = null;
let currentChatPhone = null;
let allChats = [];
let tempSendingMessage = null; 
let currentChatMessagesMap = new Map();

// --- NUEVO: Variable para controlar el reloj en vivo ---
let chatTimerInterval = null;

// ESTADO DE LA BANDEJA (Por defecto mostramos los 'activos')
let currentInboxFilter = 'activo'; 

// --- NUEVO: ACTUALIZAR NOTIFICACIONES GLOBALES ---
function updateWhatsAppBadges() {
    // Sumamos todos los 'mensajesNoLeidos' de la lista de chats activos
    const totalUnread = allChats.reduce((sum, chat) => sum + (chat.mensajesNoLeidos || 0), 0);
    
    const desktopBadge = document.getElementById('badge-desktop-wa');
    const mobileBadge = document.getElementById('badge-mobile-wa');

    if (totalUnread > 0) {
        // Mostramos los globos rojos
        if (desktopBadge) { desktopBadge.textContent = totalUnread; desktopBadge.classList.remove('hidden'); }
        if (mobileBadge) { mobileBadge.textContent = totalUnread; mobileBadge.classList.remove('hidden'); }
    } else {
        // Ocultamos los globos si no hay mensajes
        if (desktopBadge) desktopBadge.classList.add('hidden');
        if (mobileBadge) mobileBadge.classList.add('hidden');
    }
}

window.viewWaImage = function(url) {
    const modal = document.getElementById('modal-secondary');
    const wrapper = document.getElementById('modal-secondary-content-wrapper');
    wrapper.innerHTML = `
        <div class="relative w-full h-[100dvh] flex items-center justify-center p-4">
            <button onclick="document.getElementById('modal-secondary').classList.add('hidden')" class="absolute top-4 right-4 text-white text-5xl font-bold z-50 hover:text-gray-300 transition">×</button>
            <img src="${url}" class="max-w-full max-h-full object-contain rounded-lg shadow-2xl">
        </div>
    `;
    modal.classList.remove('hidden');
};

// --- PANEL LATERAL DE CRM ---
window.closeCrmPanel = function() {
    const panel = document.getElementById('wa-crm-sidepanel');
    const backdrop = document.getElementById('wa-crm-backdrop');
    if (panel) panel.classList.add('translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
};

window.openCrmPanel = function(phone) {
    const client = buscarClientePorTelefono(phone);
    if (!client) return;

    const chatArea = document.getElementById('whatsapp-chat-area');
    
    // Backdrop (fondo oscuro)
    let backdrop = document.getElementById('wa-crm-backdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'wa-crm-backdrop';
        backdrop.className = 'absolute inset-0 bg-black bg-opacity-40 z-30 hidden sm:hidden transition-opacity';
        backdrop.onclick = window.closeCrmPanel;
        chatArea.appendChild(backdrop);
    }
    backdrop.classList.remove('hidden');

    let panel = document.getElementById('wa-crm-sidepanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'wa-crm-sidepanel';
        panel.className = 'absolute top-0 right-0 h-full w-4/5 sm:w-80 bg-gray-50 shadow-[0_0_30px_rgba(0,0,0,0.3)] transform translate-x-full transition-transform duration-300 z-40 flex flex-col border-l border-gray-200';
        
        panel.addEventListener('click', (e) => {
            const btnPago = e.target.closest('.wa-pago-btn');
            if (btnPago) {
                const remData = JSON.parse(decodeURIComponent(btnPago.dataset.remjson));
                document.dispatchEvent(new CustomEvent('openWaPaymentModal', { detail: remData }));
            }
        });
        chatArea.appendChild(panel);
    }

    const remisiones = allRemisiones.filter(r => r.idCliente === client.id && r.estado !== 'Anulada');
    let htmlDeuda = ''; let htmlPedidos = ''; let deudaTotal = 0; let pedidosPendientes = 0;

    remisiones.forEach(r => {
        const pagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const saldo = r.valorTotal - pagado;
        const remJsonEncoded = encodeURIComponent(JSON.stringify(r));
        const pdfButton = r.pdfPath ? `<button data-file-path="${r.pdfPath}" class="text-[10px] sm:text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded font-bold hover:bg-gray-300 transition">PDF</button>` : '';
        const pagoButton = `<button data-remjson="${remJsonEncoded}" class="wa-pago-btn text-[10px] sm:text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded font-bold hover:bg-purple-200 transition">Pagos</button>`;

        if (saldo > 0) {
            deudaTotal += saldo;
            htmlDeuda += `
                <div class="bg-white p-2 rounded-lg shadow-sm border border-red-100 mb-2">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-[10px] font-bold text-gray-500">REM-${r.numeroRemision}</span>
                        <span class="text-[10px] text-gray-400">${r.fechaRecibido}</span>
                    </div>
                    <div class="flex justify-between items-center mt-1 mb-2">
                        <span class="font-bold text-red-600 text-sm">${formatCurrency(saldo)}</span>
                    </div>
                    <div class="flex justify-end gap-1 pt-1 border-t border-gray-50">${pdfButton}${pagoButton}</div>
                </div>`;
        }

        if (r.estado !== 'Entregado') {
            pedidosPendientes++;
            const itemsResumen = r.items.map(i => `${i.descripcion} (x${i.cantidad})`).join(', ');
            htmlPedidos += `
                <div class="bg-white p-2 rounded-lg shadow-sm border border-amber-100 mb-2">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-[10px] font-bold text-gray-500">REM-${r.numeroRemision}</span>
                        <span class="text-[9px] font-bold text-amber-600 uppercase">${r.estado}</span>
                    </div>
                    <p class="text-[10px] text-gray-500 truncate mt-1 mb-2" title="${itemsResumen}">${itemsResumen}</p>
                    <div class="flex justify-end gap-1 pt-1 border-t border-gray-50">${pdfButton}${saldo > 0 ? pagoButton : ''}</div>
                </div>`;
        }
    });

    if (htmlDeuda === '') htmlDeuda = '<p class="text-xs text-gray-400 italic py-2">Sin saldos pendientes.</p>';
    if (htmlPedidos === '') htmlPedidos = '<p class="text-xs text-gray-400 italic py-2">Sin pedidos activos.</p>';

    panel.innerHTML = `
        <div class="p-3 sm:p-4 bg-indigo-600 text-white flex justify-between items-center flex-shrink-0 shadow-md">
            <div>
                <h3 class="font-bold text-sm">Estado de Cuenta</h3>
                <p class="text-[10px] text-indigo-200 truncate w-40 sm:max-w-[200px]">${client.nombreEmpresa || client.nombre}</p>
            </div>
            <button onclick="window.closeCrmPanel()" class="text-white text-2xl hover:text-indigo-200 leading-none">&times;</button>
        </div>
        <div class="flex-grow overflow-y-auto p-3 sm:p-4 space-y-4">
            <div>
                <div class="flex justify-between items-center border-b border-red-200 pb-1 mb-2">
                    <h4 class="font-bold text-gray-800 text-xs sm:text-sm">💰 Cartera</h4>
                    <span class="font-bold text-red-600 text-xs sm:text-sm">${formatCurrency(deudaTotal)}</span>
                </div>
                ${htmlDeuda}
            </div>
            <div>
                <div class="flex justify-between items-center border-b border-amber-200 pb-1 mb-2">
                    <h4 class="font-bold text-gray-800 text-xs sm:text-sm">📦 Activos</h4>
                    <span class="font-bold text-amber-600 text-[10px] bg-amber-50 px-1.5 py-0.5 rounded-full">${pedidosPendientes}</span>
                </div>
                ${htmlPedidos}
            </div>
        </div>
    `;
    setTimeout(() => panel.classList.remove('translate-x-full'), 10);
};

// --- CAMBIAR ESTADO DEL CHAT ---
window.toggleChatStatus = async function(phone, currentStatus) {
    const newStatus = currentStatus === 'resuelto' ? 'activo' : 'resuelto';
    showModalMessage(`Moviendo chat a ${newStatus}...`, true);
    try {
        await updateDoc(doc(db, "chats", phone), {
            estadoChat: newStatus,
            _lastUpdated: serverTimestamp()
        });
        
        if (newStatus === 'resuelto') {
            document.getElementById('whatsapp-chat-area').classList.add('hidden');
            document.getElementById('whatsapp-sidebar').classList.remove('hidden');
            document.getElementById('whatsapp-sidebar').classList.add('flex');
            currentChatPhone = null;
        } else {
            document.getElementById('wa-chat-header-actions').innerHTML = `
                <button onclick="window.toggleChatStatus('${phone}', 'activo')" class="bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs sm:text-sm font-bold py-1.5 px-3 rounded-lg shadow-sm flex items-center gap-1 transition">
                    <span class="text-green-500">✔️</span> Resolver
                </button>
            `;
        }
        hideModal();
        showTemporaryMessage(`Chat marcado como ${newStatus}`, "success");
    } catch(e) {
        hideModal();
        showModalMessage("Error al cambiar estado del chat.");
    }
};

export function loadChats() {
    if (!currentUserData || (currentUserData.role !== 'admin' && !currentUserData.permissions?.whatsapp)) return;

    const q = query(collection(db, "chats"), orderBy("ultimaFecha", "desc"));
    
    unsubscribeChats = onSnapshot(q, (snapshot) => {
        allChats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderChatList();
        updateWhatsAppBadges(); // <--- ¡ESTA ES LA MAGIA QUE AÑADIMOS!
    });
}

function renderChatList(searchTerm = '') {
    const listContainer = document.getElementById('chats-list');
    if (!listContainer) return;

    let filteredChats = allChats.filter(c => {
        const estado = c.estadoChat || 'activo'; 
        return estado === currentInboxFilter;
    });

    if (searchTerm) {
        filteredChats = filteredChats.filter(c => 
            (c.nombre && c.nombre.toLowerCase().includes(searchTerm.toLowerCase())) || 
            (c.telefono && c.telefono.includes(searchTerm))
        );
    }

    if (filteredChats.length === 0) {
        const msgEmpty = currentInboxFilter === 'activo' ? '¡Bandeja al día! No hay chats activos.' : 'No hay chats resueltos.';
        listContainer.innerHTML = `<p class="text-center text-gray-500 mt-10 text-sm font-medium">${msgEmpty}</p>`;
        return;
    }

    listContainer.innerHTML = filteredChats.map(chat => {
        const dateObj = chat.ultimaFecha?.toDate ? chat.ultimaFecha.toDate() : new Date();
        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const unreadBadge = chat.mensajesNoLeidos > 0 ? `<div class="bg-green-500 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full">${chat.mensajesNoLeidos}</div>` : '';
        const isSelected = currentChatPhone === chat.id ? 'bg-gray-200' : 'hover:bg-gray-100';
        
        const clientMatch = buscarClientePorTelefono(chat.id);
        const displayName = clientMatch ? (clientMatch.nombreEmpresa || clientMatch.nombre) : (chat.nombre || 'Desconocido');
        const inicial = displayName !== 'Desconocido' ? displayName.charAt(0).toUpperCase() : '#';

        let previewText = chat.ultimoMensaje || '...';
        const fallbacks = ['[IMAGE]', '[VIDEO]', '[AUDIO]', '[DOCUMENT]', '[STICKER]', '[CONTACTO(S) RECIBIDO(S)]'];
        if (fallbacks.includes(previewText.toUpperCase())) previewText = '📷 Archivo multimedia';
        if (previewText.startsWith('Ubicación:')) previewText = '📍 Ubicación';

        return `
            <div class="chat-item p-3 border-b cursor-pointer flex items-center gap-3 transition ${isSelected}" data-phone="${chat.id}" data-name="${displayName}">
                <div class="w-12 h-12 rounded-full ${clientMatch ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'} font-bold flex items-center justify-center flex-shrink-0" title="${clientMatch ? 'Cliente Registrado' : 'Prospecto'}">
                    ${inicial}
                </div>
                <div class="flex-grow overflow-hidden">
                    <div class="flex justify-between items-center mb-1">
                        <h4 class="font-bold text-gray-800 text-sm truncate">${displayName}</h4>
                        <span class="text-xs text-gray-500">${timeStr}</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <p class="text-sm text-gray-600 truncate">${previewText}</p>
                        ${unreadBadge}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.chat-item').forEach(el => {
        el.addEventListener('click', (e) => {
            const phone = e.currentTarget.dataset.phone;
            const name = e.currentTarget.dataset.name;
            openChat(phone, name);
        });
    });
}

function buscarClientePorTelefono(phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    const localPhone = cleanPhone.startsWith('57') ? cleanPhone.substring(2) : cleanPhone;
    
    return allClientes.find(c => {
        const t1 = (c.telefono1 || '').replace(/\D/g, '');
        const t2 = (c.telefono2 || '').replace(/\D/g, '');
        return t1 === cleanPhone || t1 === localPhone || t2 === cleanPhone || t2 === localPhone;
    });
}

function generarBannerCRM(phone) {
    const client = buscarClientePorTelefono(phone);
    if (!client) return ''; 

    const remisiones = allRemisiones.filter(r => r.idCliente === client.id && r.estado !== 'Anulada');
    let deudaTotal = 0;
    let pendientesEntrega = 0;
    
    remisiones.forEach(r => {
        const pagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const saldo = r.valorTotal - pagado;
        if (saldo > 0) deudaTotal += saldo;
        if (r.estado !== 'Entregado') pendientesEntrega++;
    });

    const deudaBadge = deudaTotal > 0 
        ? `<span class="bg-red-100 text-red-800 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">Debe: ${formatCurrency(deudaTotal)}</span>`
        : `<span class="bg-green-100 text-green-800 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">Al día</span>`;
        
    const pedidosBadge = pendientesEntrega > 0 
        ? `<span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap flex items-center gap-1">📦 ${pendientesEntrega}</span>`
        : '';

    return `
        <div class="bg-indigo-50 border-b border-indigo-100 p-2 sm:px-4 flex justify-between items-center shadow-sm w-full gap-1 sm:gap-2">
            <div class="text-[10px] sm:text-xs font-semibold text-indigo-900 flex items-center gap-1 truncate max-w-[40%] sm:max-w-none">
                <svg class="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2"></path></svg>
                <span class="truncate hidden sm:inline">Cliente: </span>
                <span class="truncate">${client.nombreEmpresa || client.nombre}</span>
            </div>
            <div class="flex gap-1 sm:gap-2 items-center flex-shrink-0">
                <div class="flex gap-1 flex-col sm:flex-row items-end sm:items-center">
                    ${deudaBadge}
                    ${pedidosBadge}
                </div>
                <button onclick="window.openCrmPanel('${phone}')" class="bg-indigo-600 text-white text-[10px] sm:text-xs font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded shadow hover:bg-indigo-700 transition flex items-center whitespace-nowrap">
                    Detalles
                </button>
            </div>
        </div>
    `;
}

function openChat(phone, name) {
    currentChatPhone = phone;
    const chatInfo = allChats.find(c => c.id === phone) || {};
    const estadoActual = chatInfo.estadoChat || 'activo';
    
    document.getElementById('whatsapp-sidebar').classList.add('hidden', 'md:flex');
    document.getElementById('whatsapp-chat-area').classList.remove('hidden');
    document.getElementById('whatsapp-chat-area').classList.add('flex');

    document.getElementById('wa-contact-name').textContent = name;
    
    // Dejamos el teléfono listo, el temporizador lo rellenará en `renderMessagesFromMap`
    document.getElementById('wa-contact-phone').innerHTML = `+${phone}`;
    
    document.getElementById('wa-avatar').textContent = name !== 'Desconocido' ? name.charAt(0).toUpperCase() : '#';
    document.getElementById('wa-current-phone').value = phone;
    document.getElementById('wa-send-form').classList.remove('hidden');

    const headerActions = document.getElementById('wa-chat-header-actions');
    if (headerActions) {
        if (estadoActual === 'resuelto') {
            headerActions.innerHTML = `<button onclick="window.toggleChatStatus('${phone}', 'resuelto')" class="bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs sm:text-sm font-bold py-1.5 px-3 rounded-lg shadow-sm flex items-center gap-1 transition"><span class="text-blue-500">🔄</span> Reabrir Chat</button>`;
        } else {
            headerActions.innerHTML = `<button onclick="window.toggleChatStatus('${phone}', 'activo')" class="bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs sm:text-sm font-bold py-1.5 px-3 rounded-lg shadow-sm flex items-center gap-1 transition"><span class="text-green-500">✔️</span> Resolver</button>`;
        }
    }
    
    window.closeCrmPanel();

    const bannerContainer = document.getElementById('wa-crm-banner') || (() => {
        const div = document.createElement('div');
        div.id = 'wa-crm-banner';
        document.getElementById('wa-messages-container').parentNode.insertBefore(div, document.getElementById('wa-messages-container'));
        return div;
    })();
    bannerContainer.innerHTML = generarBannerCRM(phone);

    const msgContainer = document.getElementById('wa-messages-container');
    msgContainer.innerHTML = '<div class="text-center p-4 text-sm text-gray-500">Cargando mensajes...</div>';

    // Limpieza al cambiar de chat
    if (unsubscribeMessages) unsubscribeMessages();
    if (chatTimerInterval) clearInterval(chatTimerInterval); // Limpiamos el reloj anterior
    currentChatMessagesMap.clear();

    const CACHE_KEY_MSG = `wa_msgs_${phone}`;
    const cachedMsgs = localStorage.getItem(CACHE_KEY_MSG);
    if (cachedMsgs) {
        try {
            JSON.parse(cachedMsgs).forEach(m => currentChatMessagesMap.set(m.id, m));
        } catch(e) { localStorage.removeItem(CACHE_KEY_MSG); }
    }

    const marcarLeidoFn = httpsCallable(functions, 'marcarChatComoLeido');
    marcarLeidoFn({ telefono: phone, messageId: null }).catch(e => console.error("Error al marcar leído:", e));

    const q = query(collection(db, `chats/${phone}/mensajes`), orderBy("fecha", "desc"), limit(20));
    
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(change => {
            const data = change.doc.data();
            if (data.fecha && typeof data.fecha.toMillis === 'function') data.fecha = data.fecha.toMillis();
            
            if (change.type === 'removed') {
                currentChatMessagesMap.delete(change.doc.id);
            } else {
                currentChatMessagesMap.set(change.doc.id, { id: change.doc.id, ...data });
            }
        });

        renderMessagesFromMap(phone, msgContainer);
    });

    renderChatList(); 
}

function renderMessagesFromMap(phone, msgContainer) {
    const messagesArray = Array.from(currentChatMessagesMap.values());
    messagesArray.sort((a, b) => (a.fecha || 0) - (b.fecha || 0));
    localStorage.setItem(`wa_msgs_${phone}`, JSON.stringify(messagesArray));

    let html = '';
    let ultimoMsgDelCliente = null;

    if (messagesArray.length >= 20) {
        html += `<div class="text-center my-2"><button onclick="window.loadOlderMessages('${phone}')" class="bg-white border border-gray-300 text-gray-600 text-xs font-bold py-1 px-3 rounded-full hover:bg-gray-100 shadow-sm">Cargar mensajes anteriores</button></div>`;
    }

    if (messagesArray.length === 0 && !tempSendingMessage) {
        msgContainer.innerHTML = '<div class="text-center p-4 text-sm text-gray-500">No hay mensajes.</div><div id="optimistic-anchor"></div>';
        // Si no hay mensajes, asumimos ventana cerrada
        manejarTemporizador(phone, null);
        return;
    }

    messagesArray.forEach(msg => {
        const isSaliente = msg.direccion === 'saliente';
        const dateObj = new Date(msg.fecha || Date.now());
        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Guardar el más reciente que NO sea nuestro
        if (!isSaliente) ultimoMsgDelCliente = dateObj;

        let tick = '';
        if (isSaliente) {
            if (msg.estadoEnvio === 'read') tick = '<span class="text-blue-500 ml-1 font-bold">✓✓</span>';
            else if (msg.estadoEnvio === 'delivered') tick = '<span class="text-gray-400 ml-1 font-bold">✓✓</span>';
            else tick = '<span class="text-gray-400 ml-1">✓</span>';
        }

        let mediaHTML = '';
        let showText = msg.texto && msg.texto.trim() !== '';
        
        const fallbacks = ['[IMAGE]', '[VIDEO]', '[AUDIO]', '[DOCUMENT]', '[STICKER]', '[CONTACTO(S) RECIBIDO(S)]'];
        if (fallbacks.includes(msg.texto?.toUpperCase()) || (msg.tipo === 'location' && msg.texto?.startsWith('Ubicación:'))) {
            showText = false;
        }

        if (msg.tipo === 'image') {
            mediaHTML = `<img src="${msg.mediaUrl}" class="rounded-lg mb-1 max-w-[220px] sm:max-w-[280px] cursor-pointer hover:opacity-90 transition object-cover" onclick="viewWaImage('${msg.mediaUrl}')">`;
        } else if (msg.tipo === 'sticker') {
            mediaHTML = `<img src="${msg.mediaUrl}" class="w-32 h-32 object-contain drop-shadow-md">`;
        } else if (msg.tipo === 'video') {
            mediaHTML = `<video controls src="${msg.mediaUrl}" class="rounded-lg mb-1 max-w-[220px] sm:max-w-[280px] bg-black"></video>`;
        } else if (msg.tipo === 'audio') {
            mediaHTML = `<audio controls src="${msg.mediaUrl}" class="w-56 sm:w-64 mb-1 h-10"></audio>`;
        } else if (msg.tipo === 'document') {
            mediaHTML = `
                <a href="${msg.mediaUrl}" target="_blank" class="flex items-center gap-3 bg-black/5 p-3 rounded-lg mb-1 hover:bg-black/10 transition shadow-sm border border-gray-100">
                    <div class="bg-red-500 text-white rounded p-2 flex-shrink-0">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                    </div>
                    <span class="text-sm font-semibold truncate max-w-[150px] text-gray-800">${msg.fileName || 'Ver Documento'}</span>
                </a>`;
        } else if (msg.tipo === 'location' && msg.location) {
            mediaHTML = `
                <a href="http://googleusercontent.com/maps.google.com/maps?q=${msg.location.lat},${msg.location.lng}" target="_blank" class="block w-48 sm:w-56 rounded-lg overflow-hidden border border-gray-200 shadow-sm hover:shadow-md transition mb-1 bg-[#e5e3df]">
                    <div class="h-24 flex items-center justify-center text-4xl relative">
                        <div class="absolute inset-0 opacity-40" style="background-image: linear-gradient(#d1cec7 2px, transparent 2px), linear-gradient(90deg, #d1cec7 2px, transparent 2px); background-size: 20px 20px;"></div>
                        <div class="z-10 drop-shadow-md pb-4 text-red-500 animate-bounce">📍</div>
                    </div>
                    <div class="p-3 bg-white flex flex-col">
                        <span class="text-sm font-bold text-gray-800 truncate">${msg.location.name || 'Ubicación Compartida'}</span>
                        <span class="text-xs font-medium text-gray-500 truncate">${msg.location.address || 'Ver en Google Maps'}</span>
                    </div>
                </a>`;
        } else if (msg.tipo === 'contacts' && msg.contactos) {
            mediaHTML = `
                <div class="bg-white border border-gray-200 rounded-lg mb-1 w-48 sm:w-56 shadow-sm divide-y divide-gray-100">
                   ${msg.contactos.map(c => `
                     <div class="flex items-center gap-3 p-3">
                       <div class="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-xl flex-shrink-0">👤</div>
                       <div class="overflow-hidden">
                         <p class="font-bold text-sm truncate text-gray-800">${c.name?.formatted_name || 'Contacto'}</p>
                         <p class="text-xs text-blue-600 truncate hover:underline cursor-pointer font-semibold"><a href="tel:+${c.phones?.[0]?.phone?.replace(/\D/g,'')}">${c.phones?.[0]?.phone || 'Sin número'}</a></p>
                       </div>
                     </div>
                   `).join('')}
                </div>`;
        }

        const alignClass = isSaliente ? 'ml-auto bg-[#dcf8c6] rounded-lg rounded-tr-none' : 'mr-auto bg-white rounded-lg rounded-tl-none';
        let bubbleClass = alignClass;
        let shadowPadding = 'p-2 px-3 shadow-sm';
        
        if (msg.tipo === 'sticker' && !showText) {
            bubbleClass = isSaliente ? 'ml-auto' : 'mr-auto';
            shadowPadding = 'p-0 shadow-none bg-transparent';
        }

        html += `
            <div class="${bubbleClass} ${shadowPadding} max-w-[85%] w-fit relative group flex flex-col mb-1.5">
                ${mediaHTML}
                ${showText ? `<p class="text-[15px] text-gray-800 break-words whitespace-pre-wrap leading-tight">${msg.texto}</p>` : ''}
                
                <div class="${(msg.tipo === 'sticker' && !showText) ? 'absolute bottom-0 right-0 bg-white/80 rounded-full px-1.5 py-0.5' : 'text-right mt-1'} text-[10px] text-gray-500 flex justify-end items-center gap-1">
                    ${timeStr}${tick}
                </div>
            </div>
        `;
    });

    html += `<div id="optimistic-anchor"></div>`;
    
    const isAtBottom = msgContainer.scrollHeight - msgContainer.scrollTop <= msgContainer.clientHeight + 150;
    
    msgContainer.innerHTML = html;
    
    if (isAtBottom || tempSendingMessage) {
        msgContainer.scrollTop = msgContainer.scrollHeight;
    }

    // Iniciar Temporizador de 24H
    manejarTemporizador(phone, ultimoMsgDelCliente);
}

// --- LÓGICA DEL RELOJ DE 24 HORAS EN VIVO ---
function manejarTemporizador(phone, ultimoMsgDate) {
    if (chatTimerInterval) clearInterval(chatTimerInterval);

    const warningEl = document.getElementById('wa-24h-warning');
    const inputEl = document.getElementById('wa-msg-input');
    const btnEl = document.getElementById('wa-send-btn');
    const fileInput = document.getElementById('wa-file-input');
    const phoneEl = document.getElementById('wa-contact-phone');

    if (!ultimoMsgDate) {
        if(phoneEl) phoneEl.innerHTML = `<span class="truncate">+${phone}</span> <span class="ml-1 sm:ml-2 bg-gray-200 text-gray-600 font-bold px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] uppercase tracking-wider flex-shrink-0">Esperando</span>`;
        if(warningEl) warningEl.classList.remove('hidden');
        if(inputEl) { inputEl.disabled = true; inputEl.placeholder = "Esperando respuesta..."; inputEl.classList.add('bg-gray-200'); }
        if(btnEl) btnEl.disabled = true;
        if(fileInput) fileInput.disabled = true;
        return;
    }

    const updateTimer = () => {
        const now = new Date();
        const diffMs = now - ultimoMsgDate;
        const limitMs = 24 * 60 * 60 * 1000;
        const leftMs = limitMs - diffMs;

        if (leftMs <= 0) {
            if(phoneEl) phoneEl.innerHTML = `<span class="truncate">+${phone}</span> <span class="ml-1 sm:ml-2 bg-red-100 text-red-700 font-bold px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] uppercase tracking-wider flex-shrink-0">Expirado</span>`;
            if(warningEl) warningEl.classList.remove('hidden');
            
            if(inputEl) { 
                inputEl.disabled = true; 
                inputEl.placeholder = "Ventana cerrada."; 
                inputEl.classList.add('bg-gray-200'); 
            }
            if(btnEl) btnEl.disabled = true;
            if(fileInput) fileInput.disabled = true;
            clearInterval(chatTimerInterval);
        } else {
            const h = Math.floor(leftMs / (1000 * 60 * 60));
            const m = Math.floor((leftMs % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((leftMs % (1000 * 60)) / 1000);
            
            const colorClass = h < 2 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700';
            
            // Ocultamos los segundos en móviles para ahorrar espacio
            if(phoneEl) phoneEl.innerHTML = `<span class="truncate">+${phone}</span> <span class="ml-1 sm:ml-2 ${colorClass} font-bold px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] tracking-wide flex-shrink-0">⏱️ ${h}h ${m}m <span class="hidden sm:inline">${s}s</span></span>`;
            
            if(warningEl) warningEl.classList.add('hidden');
            if(inputEl && inputEl.disabled) { 
                inputEl.disabled = false; 
                inputEl.placeholder = "Mensaje..."; 
                inputEl.classList.remove('bg-gray-200'); 
                if(btnEl) btnEl.disabled = false;
                if(fileInput) fileInput.disabled = false;
            }
        }
    };

    updateTimer(); 
    chatTimerInterval = setInterval(updateTimer, 1000);
}


window.loadOlderMessages = async function(phone) {
    if (currentChatMessagesMap.size === 0) return;
    
    const msgContainer = document.getElementById('wa-messages-container');
    const oldScrollHeight = msgContainer.scrollHeight;

    const messagesArray = Array.from(currentChatMessagesMap.values());
    messagesArray.sort((a, b) => (a.fecha || 0) - (b.fecha || 0));
    const oldestDate = messagesArray[0].fecha;

    const btnObj = event.target;
    btnObj.textContent = "Cargando...";
    btnObj.disabled = true;

    try {
        const q = query(
            collection(db, `chats/${phone}/mensajes`), 
            where("fecha", "<", new Date(oldestDate)),
            orderBy("fecha", "desc"), 
            limit(20)
        );
        
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            btnObj.textContent = "No hay más mensajes";
            return;
        }

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.fecha && typeof data.fecha.toMillis === 'function') data.fecha = data.fecha.toMillis();
            currentChatMessagesMap.set(docSnap.id, { id: docSnap.id, ...data });
        });

        renderMessagesFromMap(phone, msgContainer);
        
        msgContainer.scrollTop = msgContainer.scrollHeight - oldScrollHeight;

    } catch (error) {
        console.error("Error cargando mensajes antiguos:", error);
        btnObj.textContent = "Error al cargar";
        btnObj.disabled = false;
    }
}

async function handleSendMessage(e) {
    e.preventDefault();
    const phone = document.getElementById('wa-current-phone').value;
    const inputEl = document.getElementById('wa-msg-input');
    const fileInput = document.getElementById('wa-file-input');
    const text = inputEl.value.trim();
    const file = fileInput.files[0];

    if (!phone || (!text && !file)) return;

    inputEl.value = '';
    fileInput.value = ''; 
    const btnEl = document.getElementById('wa-send-btn');
    btnEl.disabled = true;

    const anchor = document.getElementById('optimistic-anchor');
    if (anchor) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        tempSendingMessage = true; 
        anchor.innerHTML = `
            <div class="ml-auto bg-[#dcf8c6] rounded-lg rounded-tr-none p-2 px-3 max-w-[85%] w-fit shadow-sm relative group mb-2 flex flex-col opacity-60">
                ${file ? `<span class="text-sm italic text-gray-600 border-b border-green-200 pb-1 mb-1 block">📎 Subiendo archivo...</span>` : ''}
                ${text ? `<p class="text-[15px] text-gray-800 break-words whitespace-pre-wrap leading-tight">${text}</p>` : ''}
                <div class="text-right mt-1 text-[10px] text-gray-500 flex justify-end items-center gap-1">
                    ${timeStr} <span class="text-gray-400 ml-1 font-bold">🕒</span>
                </div>
            </div>
        `;
        const msgContainer = document.getElementById('wa-messages-container');
        msgContainer.scrollTop = msgContainer.scrollHeight;
    }

    try {
        let mediaUrl = null;
        let tipo = 'text';
        let fileName = null;

        if (file) {
            const storageRef = ref(storage, `whatsapp_saliente/${Date.now()}_${file.name}`);
            const snapshot = await uploadBytes(storageRef, file);
            mediaUrl = await getDownloadURL(snapshot.ref);
            
            if (file.type.startsWith('image/')) tipo = 'image';
            else if (file.type.startsWith('video/')) tipo = 'video';
            else if (file.type.startsWith('audio/')) tipo = 'audio';
            else { tipo = 'document'; fileName = file.name; }
        }

        const enviarFn = httpsCallable(functions, 'enviarMensajeWhatsApp');
        await enviarFn({ telefonoDestino: phone, tipo: tipo, contenido: text, mediaUrl: mediaUrl, fileName: fileName });
        
    } catch (error) {
        console.error("Error al enviar MSJ:", error);
        showModalMessage("Error al enviar mensaje. Revisa tu conexión o si la sesión de 24h caducó.");
    } finally {
        tempSendingMessage = null;
        const checkAnchor = document.getElementById('optimistic-anchor');
        if (checkAnchor) checkAnchor.innerHTML = '';
        btnEl.disabled = false;
        document.getElementById('wa-msg-input').focus();
    }
}

export function setupWhatsAppEvents() {
    const searchInput = document.getElementById('whatsapp-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => renderChatList(e.target.value));
    }

    const tabActivos = document.getElementById('wa-tab-activos');
    const tabResueltos = document.getElementById('wa-tab-resueltos');
    
    if (tabActivos && tabResueltos) {
        tabActivos.addEventListener('click', () => {
            currentInboxFilter = 'activo';
            tabActivos.className = "flex-1 py-2 text-sm font-bold text-indigo-600 border-b-2 border-indigo-600 transition";
            tabResueltos.className = "flex-1 py-2 text-sm font-bold text-gray-500 border-b-2 border-transparent hover:text-gray-700 transition";
            renderChatList();
        });
        
        tabResueltos.addEventListener('click', () => {
            currentInboxFilter = 'resuelto';
            tabResueltos.className = "flex-1 py-2 text-sm font-bold text-indigo-600 border-b-2 border-indigo-600 transition";
            tabActivos.className = "flex-1 py-2 text-sm font-bold text-gray-500 border-b-2 border-transparent hover:text-gray-700 transition";
            renderChatList();
        });
    }

    const sendForm = document.getElementById('wa-send-form');
    if (sendForm) {
        sendForm.addEventListener('submit', handleSendMessage);
        
        const textarea = document.getElementById('wa-msg-input');
        textarea.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (this.value.trim() !== '' || document.getElementById('wa-file-input').files.length > 0) {
                    sendForm.dispatchEvent(new Event('submit'));
                }
            }
        });
    }

    const backBtn = document.getElementById('wa-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            document.getElementById('whatsapp-chat-area').classList.add('hidden');
            document.getElementById('whatsapp-sidebar').classList.remove('hidden');
            document.getElementById('whatsapp-sidebar').classList.add('flex');
            currentChatPhone = null;
            if (unsubscribeMessages) unsubscribeMessages();
            if (chatTimerInterval) clearInterval(chatTimerInterval);
            window.closeCrmPanel(); 
            renderChatList();
        });
    }
}