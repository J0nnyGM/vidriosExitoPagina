// js/usuarios.js
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

let db, openMainModal, openConfirmModal;
let unsubscribeUsers = null;
let allUsersCache = [];
export let currentUserFilter = 'active';

/**
 * Inicializa el módulo de usuarios inyectando dependencias
 */
export function initUsuarios(firestoreDb, deps) {
    db = firestoreDb;
    openMainModal = deps.openMainModal;
    openConfirmModal = deps.openConfirmModal;
}

/**
 * Carga y gestiona la vista de usuarios con filtros y búsqueda.
 */
export function loadUsers(filter = 'active') {
    currentUserFilter = filter;
    const loadingDiv = document.getElementById('loading-users');
    const tableBody = document.getElementById('users-table-body');
    const emptyMsg = document.getElementById('empty-users-msg');
    const searchInput = document.getElementById('user-search-input');

    // 1. Actualizar UI de Pestañas
    document.querySelectorAll('.user-tab-btn').forEach(btn => {
        if (btn.dataset.filter === filter) {
            btn.classList.remove('text-gray-500', 'hover:bg-white/60');
            btn.classList.add('bg-white', 'text-indigo-600', 'shadow-sm');
        } else {
            btn.classList.add('text-gray-500', 'hover:bg-white/60');
            btn.classList.remove('bg-white', 'text-indigo-600', 'shadow-sm');
        }
    });

    // 2. Configurar Listener de Búsqueda (Solo una vez)
    if (searchInput && !searchInput.dataset.listenerAttached) {
        searchInput.addEventListener('input', () => renderUsersList());
        searchInput.dataset.listenerAttached = 'true';
    }

    // 3. Configurar Listeners de Tabs (Solo una vez)
    const tabsContainer = document.getElementById('user-tabs-container');
    if (tabsContainer && !tabsContainer.dataset.listenerAttached) {
        tabsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.user-tab-btn');
            if (btn) loadUsers(btn.dataset.filter);
        });
        tabsContainer.dataset.listenerAttached = 'true';
    }

    // 4. Iniciar Suscripción (Si no existe ya)
    if (!unsubscribeUsers) {
        if (loadingDiv) loadingDiv.classList.remove('hidden');
        if (tableBody) tableBody.innerHTML = '';
        if (emptyMsg) emptyMsg.classList.add('hidden');

        const q = query(collection(db, "users"), orderBy("firstName")); // Traemos todos y filtramos en memoria

        unsubscribeUsers = onSnapshot(q, (querySnapshot) => {
            allUsersCache = [];
            querySnapshot.forEach(doc => {
                allUsersCache.push({ id: doc.id, ...doc.data() });
            });

            if (loadingDiv) loadingDiv.classList.add('hidden');
            renderUsersList(); // Renderizar con el filtro actual
        }, (error) => {
            console.error("Error users:", error);
            if (loadingDiv) loadingDiv.innerHTML = '<p class="text-red-500">Error al cargar.</p>';
        });
    } else {
        // Si ya estamos suscritos, solo refrescamos la vista con el nuevo filtro
        renderUsersList();
    }
}

/**
 * Filtra y renderiza la lista de usuarios en memoria.
 */
function renderUsersList() {
    const tableBody = document.getElementById('users-table-body');
    const emptyMsg = document.getElementById('empty-users-msg');
    const searchTerm = document.getElementById('user-search-input')?.value.toLowerCase().trim() || '';

    if (!tableBody) return;
    tableBody.innerHTML = '';

    const filteredUsers = allUsersCache.filter(user => {
        // 1. Filtro por Estado (Tab)
        let statusMatch = false;
        if (currentUserFilter === 'active') statusMatch = user.status === 'active';
        else if (currentUserFilter === 'pending') statusMatch = user.status === 'pending';
        else if (currentUserFilter === 'archived') statusMatch = user.status === 'archived';

        // 2. Filtro por Búsqueda
        const searchMatch =
            (user.firstName || '').toLowerCase().includes(searchTerm) ||
            (user.lastName || '').toLowerCase().includes(searchTerm) ||
            (user.email || '').toLowerCase().includes(searchTerm) ||
            (user.idNumber || '').includes(searchTerm);

        return statusMatch && searchMatch;
    });

    if (filteredUsers.length === 0) {
        if (emptyMsg) emptyMsg.classList.remove('hidden');
    } else {
        if (emptyMsg) emptyMsg.classList.add('hidden');
        filteredUsers.forEach(user => {
            tableBody.appendChild(createUserRow(user));
        });
    }
}

/**
 * Crea la fila HTML para la tabla de usuarios
 */
function createUserRow(user) {
    const row = document.createElement('tr');
    row.className = 'bg-white border-b hover:bg-slate-50 transition-colors group';

    // 1. Avatar / Iniciales
    const initials = `${(user.firstName || '').charAt(0)}${(user.lastName || '').charAt(0)}`.toUpperCase();
    const avatarHtml = user.profilePhotoURL
        ? `<img src="${user.profilePhotoURL}" class="w-10 h-10 rounded-full object-cover border border-gray-200 shadow-sm">`
        : `<div class="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-100 to-blue-100 text-indigo-600 flex items-center justify-center font-bold text-sm border border-indigo-200 shadow-sm">${initials}</div>`;

    // 2. Badge de Estado
    let statusBadge = '';
    if (user.status === 'active') statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200"><span class="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1.5"></span>Activo</span>`;
    else if (user.status === 'pending') statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200"><span class="w-1.5 h-1.5 bg-amber-500 rounded-full mr-1.5"></span>Pendiente</span>`;
    else statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200"><i class="fa-solid fa-box-archive mr-1.5"></i>Archivado</span>`;

    // 3. Botones de Acción
    const btnClass = "w-8 h-8 rounded-lg flex items-center justify-center transition-all shadow-sm hover:shadow-md";
    let actionsHtml = '';

    if (user.status === 'archived') {
        actionsHtml = `
            <button class="restore-user-btn ${btnClass} bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200" title="Restaurar Usuario">
                <i class="fa-solid fa-trash-arrow-up"></i>
            </button>
            <button class="delete-user-btn ${btnClass} bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200" title="Eliminar Definitivamente">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;
    } else {
        const isPending = user.status === 'pending';
        const toggleTitle = isPending ? 'Aprobar / Activar' : 'Desactivar (Pendiente)';
        const toggleIcon = isPending ? 'fa-check' : 'fa-user-lock';
        const toggleColor = isPending ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-emerald-200' : 'bg-amber-50 text-amber-600 hover:bg-amber-100 border-amber-200';

        actionsHtml = `
            <button class="edit-user-btn ${btnClass} bg-white text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-slate-200" title="Editar">
                <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="toggle-status-btn ${btnClass} ${toggleColor} border" title="${toggleTitle}" data-status="${user.status}">
                <i class="fa-solid ${toggleIcon}"></i>
            </button>
            <button class="archive-user-btn ${btnClass} bg-white text-slate-400 hover:text-slate-700 hover:bg-slate-100 border border-slate-200" title="Archivar">
                <i class="fa-solid fa-box-archive"></i>
            </button>
        `;
    }

    row.innerHTML = `
        <td class="px-6 py-4">
            <div class="flex items-center gap-4">
                ${avatarHtml}
                <div>
                    <p class="font-bold text-gray-800 text-sm leading-tight">${user.firstName} ${user.lastName}</p>
                    <p class="text-xs text-gray-500 mt-0.5 font-mono">${user.email}</p>
                    <p class="text-[10px] text-gray-400 mt-0.5">CC: ${user.idNumber || '---'}</p>
                </div>
            </div>
        </td>
        <td class="px-6 py-4">
            <div class="flex flex-col gap-1">
                <select class="user-role-select text-xs font-bold text-slate-600 bg-slate-50 border-slate-200 rounded-lg p-1.5 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer" data-userid="${user.id}">
                    <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option>
                    <option value="sst" ${user.role === 'sst' ? 'selected' : ''}>SST (Seguridad)</option>
                    <option value="bodega" ${user.role === 'bodega' ? 'selected' : ''}>Bodega / Logística</option>
                    <option value="operario" ${user.role === 'operario' ? 'selected' : ''}>Operario</option>
                    <option value="nomina" ${user.role === 'nomina' ? 'selected' : ''}>Nómina</option>
                </select>
            </div>
        </td>
        <td class="px-6 py-4 text-center">
            ${statusBadge}
        </td>
        <td class="px-6 py-4 text-right">
            <div class="flex justify-end gap-2 opacity-90 group-hover:opacity-100 transition-opacity">
                ${actionsHtml}
            </div>
        </td>
    `;

    row.querySelector('.user-role-select').addEventListener('change', (e) => {
        updateUserRole(user.id, e.target.value);
    });

    if (user.status !== 'archived') {
        row.querySelector('.toggle-status-btn').addEventListener('click', () => {
            const newStatus = user.status === 'active' ? 'pending' : 'active';
            updateUserStatus(user.id, newStatus);
        });
        row.querySelector('.edit-user-btn').addEventListener('click', () => openMainModal('editUser', user));
        row.querySelector('.archive-user-btn').addEventListener('click', () => {
            openConfirmModal(`¿Archivar al usuario ${user.firstName}? Desaparecerá de las listas activas.`, () => updateUserStatus(user.id, 'archived'));
        });
    } else {
        row.querySelector('.restore-user-btn').addEventListener('click', () => {
            openConfirmModal(`¿Restaurar al usuario ${user.firstName}? Pasará a estado Pendiente.`, () => updateUserStatus(user.id, 'pending'));
        });
        row.querySelector('.delete-user-btn').addEventListener('click', () => {
            openConfirmModal(`¿ELIMINAR DEFINITIVAMENTE a ${user.email}? Esta acción es irreversible.`, () => deleteUser(user.id));
        });
    }

    return row;
}

async function updateUserRole(uid, newRole) {
    await updateDoc(doc(db, "users", uid), { role: newRole });
}

async function updateUserStatus(uid, newStatus) {
    await updateDoc(doc(db, "users", uid), { status: newStatus });
}

async function deleteUser(uid) {
    await deleteDoc(doc(db, "users", uid));
    console.warn(`Usuario ${uid} eliminado de Firestore. Recuerda eliminarlo en Authentication si es necesario.`);
}