// js/modules/empleados.js

import { db, storage, functions, httpsCallable } from '../firebase-config.js';
import { collection, doc, updateDoc, query, onSnapshot, getDocs, where, addDoc, deleteDoc, arrayUnion, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { 
    allUsers, setAllUsers, allPendingLoans, setAllPendingLoans, 
    currentUser, currentUserData, 
    showModalMessage, hideModal, showTemporaryMessage, showPdfModal 
} from '../app.js';
import { formatCurrency, unformatCurrency, unformatCurrencyInput, formatCurrencyInput } from '../utils.js';
import { METODOS_DE_PAGO, RRHH_DOCUMENT_TYPES, ALL_MODULES } from '../constants.js';

let showInactiveEmployees = false;

// --- CONFIGURACIÓN DE CACHÉ ---
const EMPLEADOS_CACHE_KEY = 'empleados_cache';
const EMPLEADOS_SYNC_KEY = 'empleados_last_sync';

// --- CARGA DE DATOS (INTELIGENTE + TIEMPO REAL INFALIBLE) ---
export function loadEmpleados() {
    if (!currentUserData || currentUserData.role !== 'admin') {
        return () => { }; 
    }

    const cachedData = localStorage.getItem(EMPLEADOS_CACHE_KEY);
    
    let mapUsers = new Map();
    let maxLastUpdated = 0; // Guardará la fecha exacta del documento más reciente

    // 1. Cargar desde el caché local (Velocidad instantánea)
    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            parsedData.forEach(u => {
                mapUsers.set(u.id, u);
                // Buscamos cuál es el timestamp más reciente que tenemos guardado
                if (u._lastUpdated && u._lastUpdated > maxLastUpdated) {
                    maxLastUpdated = u._lastUpdated;
                }
            });
            setAllUsers(Array.from(mapUsers.values()));
            renderAndAttachEmployeeListeners(Array.from(mapUsers.values()));
        } catch (e) {
            console.warn("Caché de empleados corrupto. Se limpiará.");
            localStorage.removeItem(EMPLEADOS_CACHE_KEY);
            localStorage.removeItem(EMPLEADOS_SYNC_KEY);
        }
    }

    // 2. onSnapshot Diferencial basado en la información real del servidor
    const colRef = collection(db, "users");
    let q;

    if (maxLastUpdated > 0) {
        // Restamos 2 minutos de margen de seguridad a la fecha del último documento
        const syncTime = new Date(maxLastUpdated - 120000); 
        q = query(colRef, where("_lastUpdated", ">=", syncTime));
    } else {
        // Si no hay caché, descarga todo
        q = query(colRef);
    }

    // 3. Quedarse escuchando los cambios en vivo
    const unsubscribe = onSnapshot(q, (snapshot) => {
        let huboCambios = false;

        snapshot.docChanges().forEach((change) => {
            const doc = change.doc;
            const data = doc.data();

            // Limpieza de Timestamps para poder serializar en JSON local
            if (data._lastUpdated && typeof data._lastUpdated.toMillis === 'function') data._lastUpdated = data._lastUpdated.toMillis();
            if (data.creadoEn && typeof data.creadoEn.toMillis === 'function') data.creadoEn = data.creadoEn.toMillis();
            
            if (change.type === "added" || change.type === "modified") {
                mapUsers.set(doc.id, { id: doc.id, ...data });
                huboCambios = true;
            }
            if (change.type === "removed") {
                mapUsers.delete(doc.id);
                huboCambios = true;
            }
        });

        // 4. Si hubo un cambio, actualizamos la memoria, el caché local y la pantalla
        if (huboCambios) {
            const finalArray = Array.from(mapUsers.values());
            
            finalArray.sort((a, b) => {
                const statusOrder = { 'pending': 1, 'inactive': 2, 'active': 3 };
                const orderA = statusOrder[a.status] || 99;
                const orderB = statusOrder[b.status] || 99;
                if (orderA !== orderB) return orderA - orderB;
                return (a.nombre || '').localeCompare(b.nombre || '');
            });

            localStorage.setItem(EMPLEADOS_CACHE_KEY, JSON.stringify(finalArray));
            
            setAllUsers(finalArray);
            renderAndAttachEmployeeListeners(finalArray);
            
            console.log(`[Empleados] ${snapshot.docChanges().length} cambios detectados en tiempo real.`);
        }
    }, (error) => {
        console.error("Error en onSnapshot diferencial de empleados:", error);
    });

    return unsubscribe;
}

function updateLocalCache(newOrUpdatedUser) {
    const cachedData = localStorage.getItem(EMPLEADOS_CACHE_KEY);
    let users = cachedData ? JSON.parse(cachedData) : [];
    
    const index = users.findIndex(u => u.id === newOrUpdatedUser.id);
    if (index !== -1) users[index] = newOrUpdatedUser;
    else users.push(newOrUpdatedUser);
    
    users.sort((a, b) => {
        const statusOrder = { 'pending': 1, 'inactive': 2, 'active': 3 };
        const orderA = statusOrder[a.status] || 99;
        const orderB = statusOrder[b.status] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return (a.nombre || '').localeCompare(b.nombre || '');
    });
    
    localStorage.setItem(EMPLEADOS_CACHE_KEY, JSON.stringify(users));
    setAllUsers(users);
    renderAndAttachEmployeeListeners(users);
}

export function loadAllLoanRequests() {
    const q = query(collection(db, "prestamos"), where("status", "==", "solicitado"));
    return onSnapshot(q, (snapshot) => {
        const pending = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllPendingLoans(pending);
        
        const badge = document.getElementById('header-loan-badge');
        if (badge) {
            if (pending.length > 0) {
                badge.textContent = pending.length;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    });
}

// --- RENDERIZADO Y MODALES DE EMPLEADOS ---
function renderAndAttachEmployeeListeners(users) {
    const empleadosListEl = document.getElementById('empleados-list');
    if (!empleadosListEl) return;

    // 1. Filtrar los usuarios según el estado del botón
    const filteredUsers = users.filter(u => {
        if (showInactiveEmployees) return true; // Mostrar todos
        return u.status !== 'inactive'; // Ocultar inactivos
    });

    // 2. Construir la cabecera con el botón de filtro
    const activeCount = users.filter(u => u.status === 'active').length;
    const inactiveCount = users.filter(u => u.status === 'inactive').length;
    const pendingCount = users.filter(u => u.status === 'pending').length;

    let htmlContent = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5 bg-slate-50 border border-slate-200/60 p-4 rounded-2xl shadow-xs">
            <div class="text-xs sm:text-sm text-slate-600">
                <span class="font-bold text-slate-800">Total:</span> ${users.length} 
                <span class="mx-1 text-slate-300">&bull;</span>
                <span class="text-emerald-700 font-semibold">${activeCount} Activos</span>, 
                <span class="text-amber-700 font-semibold">${pendingCount} Pendientes</span>, 
                <span class="text-slate-500 font-semibold">${inactiveCount} Inactivos</span>
            </div>
            <button id="toggle-inactive-btn" class="w-full sm:w-auto text-center text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-xs ${showInactiveEmployees ? 'bg-slate-800 hover:bg-slate-900 text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}">
                ${showInactiveEmployees ? 'Ocultar Inactivos' : 'Mostrar Inactivos'}
            </button>
        </div>
        <div class="space-y-4">
    `;

    if (filteredUsers.length === 0) {
        htmlContent += `<p class="text-center text-slate-500 py-6">No hay empleados para mostrar con los filtros actuales.</p>`;
    }

    // 3. Generar las tarjetas de los empleados
    filteredUsers.forEach(empleado => {
        const isMe = (empleado.id === currentUser.uid); // Comprobamos si es el propio admin
        const nameInitial = (empleado.nombre || 'E').charAt(0).toUpperCase();

        let statusBadge = '';
        let toggleButtonHTML = '';

        switch (empleado.status) {
            case 'active':
                statusBadge = `<span class="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-emerald-250 uppercase tracking-wider">Activo</span>`;
                toggleButtonHTML = `<button data-uid="${empleado.id}" data-status="inactive" class="user-status-btn bg-amber-600 hover:bg-amber-700 text-white py-2 px-3 sm:py-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold transition w-full shadow-xs">Desactivar</button>`;
                break;
            case 'inactive':
                statusBadge = `<span class="bg-slate-100 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-250 uppercase tracking-wider">Inactivo</span>`;
                toggleButtonHTML = `<button data-uid="${empleado.id}" data-status="active" class="user-status-btn bg-emerald-650 hover:bg-emerald-755 text-white py-2 px-3 sm:py-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold transition w-full shadow-xs">Activar</button>`;
                break;
            default:
                statusBadge = `<span class="bg-amber-50 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-amber-250 uppercase tracking-wider">Pendiente</span>`;
                toggleButtonHTML = `<button data-uid="${empleado.id}" data-status="active" class="user-status-btn bg-emerald-650 hover:bg-emerald-755 text-white py-2 px-3 sm:py-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold transition w-full shadow-xs">Activar</button>`;
                break;
        }

        // Medida de seguridad: Si es el propio Admin, no puede desactivarse ni eliminarse
        if (isMe) {
            toggleButtonHTML = `<button disabled class="bg-slate-100 text-slate-400 border border-slate-200 py-2 px-3 sm:py-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold cursor-not-allowed w-full shadow-xs">Tu Cuenta</button>`;
        }

        // Si el usuario está inactivo, le ponemos un fondo gris claro a su tarjeta para distinguirlo rápidamente
        const cardBgClass = empleado.status === 'inactive' ? 'opacity-70 bg-slate-50' : 'bg-white';

        htmlContent += `
            <div class="premium-card premium-card-indigo p-4 sm:p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${cardBgClass} shadow-xs hover:shadow-md transition">
                <div class="flex items-center gap-4 flex-grow w-full text-left min-w-0">
                    <div class="premium-avatar premium-avatar-indigo flex-shrink-0">${nameInitial}</div>
                    <div class="flex-grow min-w-0">
                        <div class="flex items-center gap-2 mb-1 flex-wrap">
                             <p class="font-extrabold text-base sm:text-lg text-slate-900 truncate">${empleado.nombre} ${isMe ? '<span class="text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded ml-2 uppercase">Tú</span>' : ''}</p>
                             ${statusBadge}
                        </div>
                        <p class="text-xs text-slate-500 font-medium">${empleado.email} &bull; <span class="font-bold text-indigo-650 uppercase text-[10px] tracking-wider">${empleado.role}</span></p>
                    </div>
                </div>
                <div class="flex-shrink-0 grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-row gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                    <button data-user-json='${JSON.stringify(empleado)}' class="manage-rrhh-docs-btn bg-teal-650 hover:bg-teal-755 text-white py-2 px-3 sm:py-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold transition shadow-xs">RR.HH.</button>
                    <button data-user-json='${JSON.stringify(empleado)}' class="manage-user-btn bg-indigo-650 hover:bg-indigo-755 text-white py-2 px-3 sm:py-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold transition shadow-xs">Gestionar</button>
                    <div class="col-span-2 sm:col-span-1 w-full lg:w-auto">
                        ${toggleButtonHTML}
                    </div>
                </div>
            </div>`;
    });

    htmlContent += `</div>`; // Cerramos el contenedor de las tarjetas
    empleadosListEl.innerHTML = htmlContent;

    // 4. Asignar Eventos a los Botones
    
    // Botón de Filtro
    const toggleBtn = document.getElementById('toggle-inactive-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            showInactiveEmployees = !showInactiveEmployees;
            renderAndAttachEmployeeListeners(users); // Volvemos a dibujar la lista
        });
    }

    // Botones de Estado (Activar/Desactivar)
    document.querySelectorAll('.user-status-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const userId = e.currentTarget.dataset.uid;
            const newStatus = e.currentTarget.dataset.status;
            
            if (currentUserData.role !== 'admin') {
                return showModalMessage("Solo los administradores pueden hacer esto.");
            }

            if (confirm(`¿Estás seguro de que quieres cambiar el estado de este usuario a "${newStatus}"?`)) {
                showModalMessage("Actualizando estado...", true);
                try {
                    await updateDoc(doc(db, "users", userId), {
                        status: newStatus,
                        _lastUpdated: serverTimestamp()
                    });
                    
                    const userActual = allUsers.find(u => u.id === userId);
                    if (userActual) {
                        updateLocalCache({ ...userActual, status: newStatus, _lastUpdated: Date.now() });
                    }

                    hideModal();
                    showTemporaryMessage("Estado del usuario actualizado.", "success");
                } catch (error) {
                    console.error("Error al cambiar estado en Firestore:", error);
                    showModalMessage(`Error de permisos: Asegúrate de ser Administrador.`);
                }
            }
        });
    });

    // Botones de RRHH y Gestionar
    document.querySelectorAll('.manage-rrhh-docs-btn').forEach(btn => btn.addEventListener('click', (e) => showRRHHModal(JSON.parse(e.currentTarget.dataset.userJson))));
    document.querySelectorAll('.manage-user-btn').forEach(btn => btn.addEventListener('click', (e) => showAdminEditUserModal(JSON.parse(e.currentTarget.dataset.userJson))));
}

function showAdminEditUserModal(user) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const userPermissions = user.permissions || {};

    let permissionsHTML = ALL_MODULES.filter(m => m !== 'empleados').map(module => {
        const isChecked = userPermissions[module] || false;
        const capitalized = module.charAt(0).toUpperCase() + module.slice(1);
        return `
                <label class="flex items-center space-x-2" style="display: flex !important;">
                    <input type="checkbox" class="permission-checkbox h-4 w-4 rounded border-slate-350 text-indigo-600 focus:ring-indigo-500" data-module="${module}" ${isChecked ? 'checked' : ''}>
                    <span class="text-sm font-semibold text-slate-700">${capitalized}</span>
                </label>
            `;
    }).join('');

    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-lg w-full mx-auto" style="height: auto; max-height: 85vh;">
            <div class="modal-header-fixed">
                <h2 class="text-xl font-bold text-slate-800">Gestionar Empleado: ${user.nombre}</h2>
                <button id="close-admin-edit-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="admin-edit-user-form" class="modal-body-scroll p-6 space-y-4">
                <input type="hidden" id="admin-edit-user-id" value="${user.id}">
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Nombre Completo</label>
                    <input type="text" id="admin-edit-name" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${user.nombre || ''}" required>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Correo Electrónico</label>
                    <input type="email" id="admin-edit-email" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${user.email || ''}" required>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Teléfono</label>
                        <input type="tel" id="admin-edit-phone" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${user.telefono || ''}">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Fecha de Nacimiento</label>
                        <input type="date" id="admin-edit-dob" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${user.dob || ''}">
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Dirección</label>
                    <input type="text" id="admin-edit-address" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${user.direccion || ''}">
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Rol</label>
                    <select id="admin-edit-role-select" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm">
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option>
                        <option value="planta" ${user.role === 'planta' ? 'selected' : ''}>Planta</option>
                        <option value="contabilidad" ${user.role === 'contabilidad' ? 'selected' : ''}>Contabilidad</option>
                    </select>
                </div>
                <div id="admin-edit-permissions-container" class="bg-slate-50 border border-slate-100 p-4 rounded-2xl">
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Permisos de Módulos</label>
                    <div class="grid grid-cols-2 gap-3">
                        ${permissionsHTML}
                    </div>
                </div>
                <button type="submit" class="w-full bg-indigo-650 hover:bg-indigo-755 text-white font-bold py-3 rounded-xl transition-colors shadow-xs mt-2">Guardar Cambios</button>
            </form>
        </div>
        `;

    const roleSelect = document.getElementById('admin-edit-role-select');
    const permissionsContainer = document.getElementById('admin-edit-permissions-container');

    function togglePermissionsUI(role) {
        permissionsContainer.style.display = (role === 'admin') ? 'none' : 'block';
    }

    roleSelect.addEventListener('change', (e) => togglePermissionsUI(e.target.value));
    togglePermissionsUI(user.role);

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-admin-edit-modal').addEventListener('click', hideModal);
    
    document.getElementById('admin-edit-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = document.getElementById('admin-edit-user-id').value;
        const newRole = document.getElementById('admin-edit-role-select').value;
        const newPermissions = {};

        document.querySelectorAll('#admin-edit-permissions-container .permission-checkbox').forEach(cb => {
            newPermissions[cb.dataset.module] = cb.checked;
        });

        const updatedData = {
            nombre: document.getElementById('admin-edit-name').value,
            email: document.getElementById('admin-edit-email').value,
            telefono: document.getElementById('admin-edit-phone').value,
            direccion: document.getElementById('admin-edit-address').value,
            dob: document.getElementById('admin-edit-dob').value,
            role: newRole,
            permissions: (newRole === 'admin') ? {} : newPermissions,
            _lastUpdated: serverTimestamp() 
        };

        showModalMessage("Guardando cambios...", true);
        try {
            await updateDoc(doc(db, "users", userId), updatedData);
            
            updateLocalCache({ ...user, ...updatedData, _lastUpdated: Date.now() });

            hideModal();
            showModalMessage("Datos del empleado actualizados.", false, 2000);
        } catch (error) {
            console.error("Error al actualizar empleado:", error);
            showModalMessage("Error al guardar los cambios.");
        }
    });
}

function showRRHHModal(empleado) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    modalContentWrapper.innerHTML = `
            <div class="modal-card max-w-5xl w-full mx-auto" style="height: 85vh; max-height: 85vh;">
                <div class="modal-header-fixed">
                    <h2 class="text-xl font-bold text-slate-800">Recursos Humanos: ${empleado.nombre}</h2>
                    <button id="close-rrhh-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <div class="border-b border-slate-200 bg-slate-50/50 flex-shrink-0">
                    <nav class="-mb-px flex space-x-6 px-6 overflow-x-auto">
                        <button id="rrhh-tab-contratacion" class="dashboard-tab-btn active py-4 px-1 font-semibold whitespace-nowrap border-b-2 border-transparent transition-all">Datos y Contratación</button>
                        <button id="rrhh-tab-pagos" class="dashboard-tab-btn py-4 px-1 font-semibold whitespace-nowrap border-b-2 border-transparent transition-all">Pagos y Liquidaciones</button>
                        <button id="rrhh-tab-descargos" class="dashboard-tab-btn py-4 px-1 font-semibold whitespace-nowrap border-b-2 border-transparent transition-all">Descargos</button>
                        <button id="rrhh-tab-prestamos" class="dashboard-tab-btn py-4 px-1 font-semibold whitespace-nowrap border-b-2 border-transparent transition-all">Préstamos</button>
                    </nav>
                </div>
                <div class="modal-body-scroll p-6 flex-grow flex flex-col min-h-0">
                    <div id="rrhh-view-contratacion" class="w-full"></div>
                    <div id="rrhh-view-pagos" class="hidden w-full"></div>
                    <div id="rrhh-view-descargos" class="hidden w-full"></div>
                    <div id="rrhh-view-prestamos" class="hidden w-full"></div>
                </div>
            </div>
        `;
    document.getElementById('modal').classList.remove('hidden');

    document.getElementById('close-rrhh-modal').addEventListener('click', hideModal);

    const tabs = [
        document.getElementById('rrhh-tab-contratacion'),
        document.getElementById('rrhh-tab-pagos'),
        document.getElementById('rrhh-tab-descargos'),
        document.getElementById('rrhh-tab-prestamos')
    ];
    const views = [
        document.getElementById('rrhh-view-contratacion'),
        document.getElementById('rrhh-view-pagos'),
        document.getElementById('rrhh-view-descargos'),
        document.getElementById('rrhh-view-prestamos')
    ];

    const switchRrhhTab = (activeIndex) => {
        tabs.forEach((tab, index) => tab.classList.toggle('active', index === activeIndex));
        views.forEach((view, index) => view.classList.toggle('hidden', index !== activeIndex));
    };

    tabs.forEach((tab, i) => tab.addEventListener('click', () => switchRrhhTab(i)));

    renderContratacionTab(empleado, views[0]);
    renderPagosTab(empleado, views[1]);
    renderDescargosTab(empleado, views[2]);
    renderPrestamosTab(empleado, views[3]);
}
function renderContratacionTab(empleado, container) {
    const contratacionData = empleado.contratacion || {};
    const yearsWithData = Object.keys(contratacionData).filter(key => !isNaN(parseInt(key)));
    const currentYear = new Date().getFullYear().toString();
    const availableYears = [...new Set([currentYear, ...yearsWithData])].sort((a, b) => b - a);

    const selectedYear = availableYears[0];
    let yearOptions = availableYears.map(year => `<option value="${year}" ${year === selectedYear ? 'selected' : ''}>${year}</option>`).join('');
    container.innerHTML = `
        <form id="contratacion-form" class="space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div class="space-y-4">
                    <h3 class="text-lg font-bold text-slate-800 border-b border-slate-100 pb-2">Información Laboral</h3>
                    <div>
                        <label class="block text-sm font-semibold text-slate-700">Fecha de Ingreso</label>
                        <input type="date" id="rrhh-fechaIngreso" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" value="${contratacionData.fechaIngreso || ''}">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-slate-700">Salario</label>
                        <input type="text" id="rrhh-salario" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" value="${contratacionData.salario ? formatCurrency(contratacionData.salario) : ''}">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-slate-700">EPS</label>
                        <input type="text" id="rrhh-eps" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" value="${contratacionData.eps || ''}">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-slate-700">AFP</label>
                        <input type="text" id="rrhh-afp" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" value="${contratacionData.afp || ''}">
                    </div>
                </div>
                <div class="space-y-4">
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center border-b border-slate-100 pb-2 gap-2">
                        <h3 class="text-lg font-bold text-slate-800">Documentos</h3>
                        <div class="flex items-center gap-2">
                            <label for="rrhh-year-filter" class="text-sm font-medium text-slate-600">Año:</label>
                            <select id="rrhh-year-filter" class="p-1.5 border border-slate-300 rounded-lg bg-white shadow-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">${yearOptions}</select>
                            <button type="button" id="download-all-docs-btn" class="bg-indigo-650 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded-lg text-sm transition-colors shadow-sm">Descargar Todo</button>
                        </div>
                    </div>
                    <div id="rrhh-documents-list" class="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden bg-white shadow-sm"></div>
                </div>
            </div>
            <div class="flex justify-end pt-4 border-t border-slate-100">
                <button type="submit" class="bg-indigo-650 text-white font-bold py-2.5 px-6 rounded-xl hover:bg-indigo-700 transition-colors shadow-sm">Guardar Información</button>
            </div>
        </form>
    `;
    renderDocumentList(empleado, selectedYear);

    document.getElementById('rrhh-year-filter').addEventListener('change', (e) => {
        renderDocumentList(empleado, e.target.value);
    });

    const salarioInput = document.getElementById('rrhh-salario');
    if (salarioInput) {
        salarioInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
        salarioInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));
    }

    const contratacionForm = document.getElementById('contratacion-form');
    if (contratacionForm) {
        contratacionForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const updatedData = {
                "contratacion.fechaIngreso": document.getElementById('rrhh-fechaIngreso').value,
                "contratacion.salario": unformatCurrency(document.getElementById('rrhh-salario').value),
                "contratacion.eps": document.getElementById('rrhh-eps').value,
                "contratacion.afp": document.getElementById('rrhh-afp').value,
                "_lastUpdated": serverTimestamp()
            };
            showTemporaryMessage("Guardando datos...", "info");
            try {
                await updateDoc(doc(db, "users", empleado.id), updatedData);
                
                if (!empleado.contratacion) empleado.contratacion = {};
                empleado.contratacion.fechaIngreso = updatedData["contratacion.fechaIngreso"];
                empleado.contratacion.salario = updatedData["contratacion.salario"];
                empleado.contratacion.eps = updatedData["contratacion.eps"];
                empleado.contratacion.afp = updatedData["contratacion.afp"];
                updateLocalCache({ ...empleado, _lastUpdated: Date.now() });

                showTemporaryMessage("Datos guardados con éxito.", "success");
            } catch (error) {
                console.error("Error al guardar datos:", error);
                showTemporaryMessage("Error al guardar los datos.", "error");
            }
        });
    }

    document.getElementById('download-all-docs-btn').addEventListener('click', () => {
        const selectedYear = document.getElementById('rrhh-year-filter').value;
        downloadAllDocsAsZip(empleado, selectedYear);
    });
}

function renderDocumentList(empleado, year) {
    const documentsListContainer = document.getElementById('rrhh-documents-list');
    if (!documentsListContainer) return;

    const contratacionData = empleado.contratacion || {};
    const documentosDelAnio = contratacionData[year]?.documentos || {};

    let documentsHTML = RRHH_DOCUMENT_TYPES.map(docType => {
        const docUrl = documentosDelAnio[docType.id];
        const fileInputId = `file-rrhh-${docType.id}-${empleado.id}`;
        return `
            <div class="flex justify-between items-center p-3.5 hover:bg-slate-50 transition-colors">
                <span class="font-semibold text-sm text-slate-700">${docType.name}</span>
                <div class="flex items-center gap-3">
                    ${docUrl ? `
                        <span class="text-xs font-semibold bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Adjunto</span>
                        <button type="button" data-pdf-url="${docUrl}" data-doc-name="${docType.name}" class="view-rrhh-pdf-btn bg-indigo-550 hover:bg-indigo-100 text-indigo-700 font-bold px-3 py-1.5 rounded-lg text-xs transition-colors shadow-xs">Ver</button>
                    ` : `
                        <span class="text-xs font-medium text-slate-400">Sin archivo</span>
                    `}
                    <input type="file" id="${fileInputId}" class="hidden" accept=".pdf,.jpg,.jpeg,.png">
                    <label for="${fileInputId}" style="display: inline-block !important;" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors border border-slate-200 shadow-xs">Adjuntar</label>
                </div>
            </div>
        `;
    }).join('');

    documentsListContainer.innerHTML = documentsHTML;

    documentsListContainer.querySelectorAll('.view-rrhh-pdf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            showPdfModal(e.currentTarget.dataset.pdfUrl, e.currentTarget.dataset.docName);
        });
    });

    RRHH_DOCUMENT_TYPES.forEach(docType => {
        const fileInput = documentsListContainer.querySelector(`#file-rrhh-${docType.id}-${empleado.id}`);
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const selectedYear = document.getElementById('rrhh-year-filter').value;
                    const docPath = `contratacion.${selectedYear}.documentos.${docType.id}`;
                    handleFileUpload(empleado, docPath, file);
                }
            });
        }
    });
}

async function handleFileUpload(empleado, docPath, file) {
    if (!file) return;
    showTemporaryMessage(`Subiendo ${file.name}...`, 'info');

    const storageRef = ref(storage, `empleados/${empleado.id}/documentos/${docPath.split('.').pop()}_${Date.now()}_${file.name}`);
    try {
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        const updatePayload = { _lastUpdated: serverTimestamp() };
        updatePayload[docPath] = downloadURL;
        await updateDoc(doc(db, "users", empleado.id), updatePayload);
        
        const updatedDoc = await getDocs(query(collection(db, "users"), where("__name__", "==", empleado.id)));
        if (!updatedDoc.empty) {
            updateLocalCache({ id: empleado.id, ...updatedDoc.docs[0].data() });
            showRRHHModal(allUsers.find(u => u.id === empleado.id));
        }
        
        showTemporaryMessage("¡Documento subido con éxito!", 'success');
    } catch (error) {
        console.error("Error al subir el archivo:", error);
        showTemporaryMessage("Error al subir el archivo.", 'error');
    }
}

async function downloadAllDocsAsZip(empleado, year) {
    const documentos = empleado.contratacion?.[year]?.documentos;
    if (!documentos || Object.keys(documentos).length === 0) {
        showModalMessage("Este empleado no tiene documentos para descargar en este año.");
        return;
    }

    showModalMessage("Preparando descarga... Esto puede tardar unos segundos.", true);

    try {
        const zip = new window.JSZip();
        const promises = [];

        for (const docType in documentos) {
            const url = documentos[docType];
            if (url) {
                const promise = fetch(url)
                    .then(response => {
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                        return response.blob();
                    })
                    .then(blob => {
                        const docInfo = RRHH_DOCUMENT_TYPES.find(d => d.id === docType);
                        const docName = docInfo ? docInfo.name.replace(/ /g, '_') : docType;
                        let fileExtension = 'pdf'; 
                        try {
                            const urlPath = new URL(url).pathname;
                            const extensionMatch = urlPath.match(/\.([^.]+)$/);
                            if (extensionMatch) fileExtension = extensionMatch[1].split('?')[0];
                            else fileExtension = blob.type.split('/')[1] || 'pdf';
                        } catch (e) {
                            fileExtension = blob.type.split('/')[1] || 'pdf';
                        }
                        zip.file(`${docName}.${fileExtension}`, blob);
                    })
                    .catch(error => {
                        console.error(`No se pudo descargar ${docType}:`, error);
                        zip.file(`ERROR_${docType}.txt`, `Error: ${error.message}`);
                    });
                promises.push(promise);
            }
        }

        await Promise.all(promises);

        zip.generateAsync({ type: "blob" }).then(function (content) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(content);
            a.download = `documentos_${empleado.nombre.replace(/ /g, '_')}_${year}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            hideModal();
        });
    } catch (error) {
        console.error("Error al crear el archivo zip:", error);
        showModalMessage("Error al crear el archivo ZIP.");
    }
}

function renderPagosTab(empleado, container) {
    const salario = empleado.contratacion?.salario || 0;
    const pagos = empleado.pagos || [];
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');

    const pagosHTML = pagos.length > 0 ? pagos.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map(p => `
        <tr class="border-b">
            <td class="p-2">${p.fecha}</td>
            <td class="p-2">${p.motivo}</td>
            <td class="p-2 text-right">${formatCurrency(p.valor)}</td>
            <td class="p-2">${p.fuentePago}</td>
        </tr>
    `).join('') : '<tr><td colspan="4" class="p-4 text-center text-gray-500">No hay pagos registrados.</td></tr>';

    const q = query(collection(db, "prestamos"), where("employeeId", "==", empleado.id), where("status", "==", "aprobado"));
    getDocs(q).then(snapshot => {
        const prestamos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        const prestamosContainer = container.querySelector('#prestamos-pendientes-container');
        if (prestamosContainer) {
            if (prestamos.length > 0) {
                prestamosContainer.innerHTML = `
                    <h4 class="font-semibold text-md mb-2">Préstamos Pendientes de Cobro</h4>
                    <div class="space-y-2">
                        ${prestamos.map(p => `
                            <div class="bg-yellow-100 p-3 rounded-lg flex justify-between items-center">
                                <div>
                                    <p class="font-semibold">${formatCurrency(p.amount)}</p>
                                    <p class="text-xs text-yellow-800">${p.reason}</p>
                                </div>
                                <button data-loan-id="${p.id}" class="cobrar-prestamo-btn bg-yellow-500 text-white text-xs px-3 py-1 rounded-full hover:bg-yellow-600">Marcar Cancelado</button>
                            </div>
                        `).join('')}
                    </div>`;
                prestamosContainer.querySelectorAll('.cobrar-prestamo-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const loanId = e.currentTarget.dataset.loanId;
                        if (confirm("¿Estás seguro de que quieres marcar este préstamo como cancelado?")) {
                            await handleLoanAction(loanId, 'cancelado');
                            showRRHHModal(allUsers.find(u => u.id === empleado.id)); 
                        }
                    });
                });
            } else {
                prestamosContainer.innerHTML = '';
            }
        }
    });

    container.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="md:col-span-1 space-y-4">
                 <div class="bg-slate-50 border border-slate-100 p-4 rounded-xl shadow-xs">
                    <h3 class="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">Liquidador Horas Extra</h3>
                    <div class="space-y-3 mt-3">
                        <div>
                            <label class="text-xs font-semibold text-slate-600">Salario Base (sin auxilio)</label>
                            <input type="text" id="salario-base-he" class="w-full p-2 border border-slate-300 bg-slate-100 text-slate-500 rounded-lg mt-1 cursor-not-allowed" value="${formatCurrency(salario > 200000 ? salario - 200000 : 0)}" readonly>
                        </div>
                        <div>
                            <label for="horas-extra-input" class="text-xs font-semibold text-slate-600">Cantidad de Horas Extra</label>
                            <input type="number" id="horas-extra-input" class="w-full p-2 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" min="0">
                        </div>
                        <button id="calcular-horas-btn" class="w-full bg-indigo-650 hover:bg-indigo-700 text-white font-bold py-2 rounded-lg transition-colors shadow-xs">Calcular</button>
                        <div id="horas-extra-resultado" class="text-center font-bold text-xl mt-2 p-2 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-lg"></div>
                    </div>
                </div>
                <div class="bg-slate-50 border border-slate-100 p-4 rounded-xl shadow-xs">
                    <h3 class="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">Registrar Nuevo Pago</h3>
                    <form id="rrhh-pago-form" class="space-y-3 mt-3">
                        <div id="prestamos-pendientes-container" class="mb-4"></div>
                        <div>
                            <label class="text-xs font-semibold text-slate-600">Motivo</label>
                            <select id="rrhh-pago-motivo" class="w-full p-2 border border-slate-300 rounded-lg mt-1 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all">
                                <option>Sueldo</option>
                                <option>Prima</option>
                                <option>Horas Extra</option>
                                <option>Liquidación</option>
                            </select>
                        </div>
                        <div>
                            <label class="text-xs font-semibold text-slate-600">Valor</label>
                            <input type="text" id="rrhh-pago-valor" class="w-full p-2 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all" required>
                            <p id="pago-sugerido-info" class="text-xs text-slate-500 mt-1 hidden">Valor quincenal sugerido (salario/2 - aportes).</p>
                        </div>
                        <div>
                            <label class="text-xs font-semibold text-slate-600">Fecha</label>
                            <input type="date" id="rrhh-pago-fecha" class="w-full p-2 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all" value="${new Date().toISOString().split('T')[0]}" required>
                        </div>
                        <div>
                            <label class="text-xs font-semibold text-slate-600">Fuente de Pago</label>
                            <select id="rrhh-pago-fuente" class="w-full p-2 border border-slate-300 rounded-lg mt-1 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all">${metodosDePagoHTML}</select>
                        </div>
                        <button type="submit" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded-lg transition-colors shadow-xs">Registrar Pago</button>
                    </form>
                </div>
            </div>
            <div class="md:col-span-2">
                <h3 class="text-lg font-bold text-slate-800 mb-2">Historial de Pagos</h3>
                <div class="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs max-h-96 overflow-y-auto">
                    <table class="w-full text-sm">
                        <thead class="bg-slate-50 text-slate-700 font-bold border-b border-slate-100">
                            <tr>
                                <th class="p-3 text-left">Fecha</th>
                                <th class="p-3 text-left">Motivo</th>
                                <th class="p-3 text-right">Valor</th>
                                <th class="p-3 text-left">Fuente</th>
                            </tr>
                        </thead>
                        <tbody id="rrhh-pagos-historial" class="divide-y divide-slate-100">${pagosHTML}</tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    const valorPagoInput = document.getElementById('rrhh-pago-valor');
    const motivoPagoSelect = document.getElementById('rrhh-pago-motivo');
    const pagoSugeridoInfo = document.getElementById('pago-sugerido-info');

    valorPagoInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    valorPagoInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    motivoPagoSelect.addEventListener('change', (e) => {
        if (e.target.value === 'Sueldo') {
            if (salario > 0) {
                const pagoQuincenal = (salario / 2) - 56940;
                valorPagoInput.value = pagoQuincenal > 0 ? pagoQuincenal : 0;
                formatCurrencyInput(valorPagoInput);
                pagoSugeridoInfo.classList.remove('hidden');
            } else {
                valorPagoInput.value = '';
                valorPagoInput.placeholder = 'Definir salario primero';
                pagoSugeridoInfo.classList.add('hidden');
            }
        } else {
            valorPagoInput.value = '';
            valorPagoInput.placeholder = '';
            pagoSugeridoInfo.classList.add('hidden');
        }
    });

    motivoPagoSelect.dispatchEvent(new Event('change'));

    document.getElementById('calcular-horas-btn').addEventListener('click', (e) => {
        e.preventDefault();
        const horas = parseFloat(document.getElementById('horas-extra-input').value) || 0;
        if (salario > 0) {
            const salarioBase = salario > 200000 ? salario - 200000 : salario;
            const valorHoraNormal = salarioBase / 240;
            const valorHoraExtra = valorHoraNormal * 1.25;
            const totalPagar = valorHoraExtra * horas;
            document.getElementById('horas-extra-resultado').textContent = formatCurrency(totalPagar);
        } else {
            document.getElementById('horas-extra-resultado').textContent = "Salario no definido.";
        }
    });

    document.getElementById('rrhh-pago-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nuevoPago = {
            motivo: document.getElementById('rrhh-pago-motivo').value,
            valor: unformatCurrency(document.getElementById('rrhh-pago-valor').value),
            fecha: document.getElementById('rrhh-pago-fecha').value,
            fuentePago: document.getElementById('rrhh-pago-fuente').value,
            timestamp: new Date().toISOString()
        };

        if (nuevoPago.valor <= 0) return showModalMessage("El valor del pago debe ser mayor a cero.");

        showModalMessage("Registrando pago...", true);
        try {
            await updateDoc(doc(db, "users", empleado.id), { pagos: arrayUnion(nuevoPago), _lastUpdated: serverTimestamp() });

            const nuevoGasto = {
                fecha: nuevoPago.fecha,
                proveedorId: empleado.id,
                proveedorNombre: `Empleado: ${empleado.nombre} (${nuevoPago.motivo})`,
                numeroFactura: `Pago RRHH`,
                valorTotal: nuevoPago.valor,
                fuentePago: nuevoPago.fuentePago,
                registradoPor: currentUser.uid,
                timestamp: Date.now(),
                isEmployeePayment: true,
                _lastUpdated: serverTimestamp()
            };
            await addDoc(collection(db, "gastos"), nuevoGasto);

            const updatedUser = { ...empleado, pagos: [...pagos, nuevoPago], _lastUpdated: Date.now() };
            updateLocalCache(updatedUser);

            showModalMessage("Pago registrado y añadido a gastos.", false, 2500);
            showRRHHModal(updatedUser);
        } catch (error) {
            console.error("Error al registrar pago:", error);
            showModalMessage("Error al registrar el pago.");
        }
    });
}

function renderDescargosTab(empleado, container) {
    const descargos = empleado.descargos || [];
    const descargosHTML = descargos.length > 0
        ? descargos.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map((d) => `
                <div class="bg-slate-50 border border-slate-100 p-4 rounded-xl shadow-xs">
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div>
                            <p class="font-bold text-slate-800 text-sm">${d.motivo}</p>
                            <p class="text-xs text-slate-400 mt-1">Fecha de reunión: ${d.fecha}</p>
                        </div>
                        <div class="flex items-center gap-2 border-t sm:border-t-0 pt-2 sm:pt-0 w-full sm:w-auto">
                            ${d.citacionUrl ? `<button type="button" data-pdf-url="${d.citacionUrl}" data-doc-name="Citación" class="view-rrhh-pdf-btn text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors border border-indigo-100 shadow-xs">Citación</button>` : ''}
                            ${d.actaUrl ? `<button type="button" data-pdf-url="${d.actaUrl}" data-doc-name="Acta" class="view-rrhh-pdf-btn text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors border border-indigo-100 shadow-xs">Acta</button>` : ''}
                            ${d.conclusionUrl ? `<button type="button" data-pdf-url="${d.conclusionUrl}" data-doc-name="Conclusión" class="view-rrhh-pdf-btn text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors border border-indigo-100 shadow-xs">Conclusión</button>` : ''}
                        </div>
                    </div>
                </div>
            `).join('')
        : '<p class="text-center text-slate-500 py-6 text-sm">No hay descargos registrados.</p>';

    container.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="md:col-span-1">
                    <div class="bg-slate-50 border border-slate-100 p-4 rounded-xl shadow-xs">
                        <h3 class="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">Registrar Descargo</h3>
                        <form id="descargos-form" class="space-y-4 mt-3">
                            <div>
                                <label for="descargo-fecha" class="text-xs font-semibold text-slate-600">Fecha de Reunión</label>
                                <input type="date" id="descargo-fecha" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" required>
                            </div>
                            <div>
                                <label for="descargo-motivo" class="text-xs font-semibold text-slate-600">Motivo de Reunión</label>
                                <textarea id="descargo-motivo" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" rows="3" required></textarea>
                            </div>
                            <div>
                                <label for="descargo-citacion" class="text-xs font-semibold text-slate-600">Citación a descargos (PDF)</label>
                                <input type="file" id="descargo-citacion" class="w-full text-xs mt-1 block file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200" accept=".pdf">
                            </div>
                            <div>
                                <label for="descargo-acta" class="text-xs font-semibold text-slate-600">Acta de descargos (PDF)</label>
                                <input type="file" id="descargo-acta" class="w-full text-xs mt-1 block file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200" accept=".pdf">
                            </div>
                            <div>
                                <label for="descargo-conclusion" class="text-xs font-semibold text-slate-600">Conclusión de descargos (PDF)</label>
                                <input type="file" id="descargo-conclusion" class="w-full text-xs mt-1 block file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200" accept=".pdf">
                            </div>
                            <button type="submit" class="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg transition-colors shadow-xs">Guardar Descargo</button>
                        </form>
                    </div>
                </div>
                <div class="md:col-span-2">
                     <h3 class="text-lg font-bold text-slate-800 mb-2">Historial de Descargos</h3>
                     <div class="space-y-3">${descargosHTML}</div>
                </div>
            </div>
        `;
    document.querySelectorAll('.view-rrhh-pdf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            showPdfModal(e.currentTarget.dataset.pdfUrl, e.currentTarget.dataset.docName);
        });
    });

    document.getElementById('descargos-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fecha = document.getElementById('descargo-fecha').value;
        const motivo = document.getElementById('descargo-motivo').value;
        const citacionFile = document.getElementById('descargo-citacion').files[0];
        const actaFile = document.getElementById('descargo-acta').files[0];
        const conclusionFile = document.getElementById('descargo-conclusion').files[0];

        showModalMessage("Guardando descargo y subiendo archivos...", true);

        try {
            const timestamp = Date.now();
            const uploadPromises = [];
            const fileData = {};

            if (citacionFile) {
                const citacionRef = ref(storage, `empleados/${empleado.id}/descargos/${timestamp}_citacion.pdf`);
                uploadPromises.push(uploadBytes(citacionRef, citacionFile).then(snap => getDownloadURL(snap.ref)).then(url => fileData.citacionUrl = url));
            }
            if (actaFile) {
                const actaRef = ref(storage, `empleados/${empleado.id}/descargos/${timestamp}_acta.pdf`);
                uploadPromises.push(uploadBytes(actaRef, actaFile).then(snap => getDownloadURL(snap.ref)).then(url => fileData.actaUrl = url));
            }
            if (conclusionFile) {
                const conclusionRef = ref(storage, `empleados/${empleado.id}/descargos/${timestamp}_conclusion.pdf`);
                uploadPromises.push(uploadBytes(conclusionRef, conclusionFile).then(snap => getDownloadURL(snap.ref)).then(url => fileData.conclusionUrl = url));
            }

            await Promise.all(uploadPromises);

            const nuevoDescargo = { fecha, motivo, ...fileData, timestamp: new Date().toISOString() };
            await updateDoc(doc(db, "users", empleado.id), { descargos: arrayUnion(nuevoDescargo), _lastUpdated: serverTimestamp() });
            
            const updatedUser = { ...empleado, descargos: [...descargos, nuevoDescargo], _lastUpdated: Date.now() };
            updateLocalCache(updatedUser);

            e.target.reset();
            showModalMessage("Descargo registrado con éxito.", false, 2000);
            showRRHHModal(updatedUser);
        } catch (error) {
            console.error("Error al registrar descargo:", error);
            showModalMessage("Error al guardar el descargo.");
        }
    });
}

// --- SISTEMA DE PRÉSTAMOS ---
function renderPrestamosTab(empleado, container) {
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let monthOptions = monthNames.map((month, i) => `<option value="${i}" ${i === currentMonth ? 'selected' : ''}>${month}</option>`).join('');
    let yearOptions = '';
    for (let i = 0; i < 5; i++) {
        const year = currentYear - i;
        yearOptions += `<option value="${year}">${year}</option>`;
    }

    container.innerHTML = `
        <div class="space-y-5">
            <div class="bg-slate-50 border border-slate-100 p-4 rounded-xl shadow-xs">
                <h3 class="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">Filtrar Préstamos</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                    <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">Filtrar por Mes</label>
                        <div class="flex gap-2">
                            <select id="loan-month-filter" class="p-2 border border-slate-300 rounded-lg bg-white w-full focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all">${monthOptions}</select>
                            <select id="loan-year-filter" class="p-2 border border-slate-300 rounded-lg bg-white w-full focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all">${yearOptions}</select>
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">Filtrar por Rango</label>
                        <div class="flex gap-2 items-center">
                            <input type="date" id="loan-start-date" class="p-2 border border-slate-300 rounded-lg w-full focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all">
                            <span class="text-slate-400 font-bold">-</span>
                            <input type="date" id="loan-end-date" class="p-2 border border-slate-300 rounded-lg w-full focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all">
                        </div>
                    </div>
                </div>
            </div>
            <div>
                <h3 class="text-lg font-bold text-slate-800 mb-2">Solicitudes de Préstamo</h3>
                <div id="rrhh-prestamos-list" class="space-y-3">Cargando...</div>
            </div>
        </div>
    `;

    const monthFilter = document.getElementById('loan-month-filter');
    const yearFilter = document.getElementById('loan-year-filter');
    const startDateFilter = document.getElementById('loan-start-date');
    const endDateFilter = document.getElementById('loan-end-date');

    const filterLoans = async () => {
        const startDate = startDateFilter.value;
        const endDate = endDateFilter.value;
        const month = monthFilter.value;
        const year = yearFilter.value;
        let prestamosQuery;

        if (startDate && endDate) {
            prestamosQuery = query(
                collection(db, "prestamos"),
                where("employeeId", "==", empleado.id),
                where("requestDate", ">=", startDate),
                where("requestDate", "<=", endDate)
            );
        } else {
            const firstDay = new Date(year, month, 1).toISOString().split('T')[0];
            const lastDay = new Date(year, parseInt(month) + 1, 0).toISOString().split('T')[0];
            prestamosQuery = query(
                collection(db, "prestamos"),
                where("employeeId", "==", empleado.id),
                where("requestDate", ">=", firstDay),
                where("requestDate", "<=", lastDay)
            );
        }

        const snapshot = await getDocs(prestamosQuery);
        const prestamos = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
        renderLoanList(prestamos);
    };

    monthFilter.addEventListener('change', () => { startDateFilter.value = ''; endDateFilter.value = ''; filterLoans(); });
    yearFilter.addEventListener('change', () => { startDateFilter.value = ''; endDateFilter.value = ''; filterLoans(); });
    endDateFilter.addEventListener('change', () => {
        if (startDateFilter.value) {
            monthFilter.value = now.getMonth();
            yearFilter.value = now.getFullYear();
            filterLoans();
        }
    });

    filterLoans();
}

function renderLoanList(prestamos) {
    const prestamosListEl = document.getElementById('rrhh-prestamos-list');
    if (!prestamosListEl) return;

    if (prestamos.length === 0) {
        prestamosListEl.innerHTML = '<p class="text-center text-gray-500 py-4">No se encontraron préstamos para el filtro seleccionado.</p>';
        return;
    }
    prestamosListEl.innerHTML = '';
    prestamos.forEach(p => {
        const el = document.createElement('div');
        el.className = 'bg-slate-50 border border-slate-100 p-4 rounded-xl shadow-xs hover:shadow-md transition-shadow';

        let statusBadge = '';
        let actions = '';
        switch (p.status) {
            case 'solicitado':
                statusBadge = `<span class="text-xs font-semibold bg-yellow-100 text-yellow-800 px-2.5 py-1 rounded-full border border-yellow-200">Solicitado</span>`;
                actions = `
                    <button data-loan-json='${JSON.stringify(p)}' class="approve-loan-btn bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors shadow-xs">Aprobar</button>
                    <button data-loan-id="${p.id}" data-action="denegado" class="loan-action-btn bg-red-650 hover:bg-red-755 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors shadow-xs">Denegar</button>
                `;
                break;
            case 'aprobado': statusBadge = `<span class="text-xs font-semibold bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full border border-blue-200">Aprobado</span>`; break;
            case 'cancelado': statusBadge = `<span class="text-xs font-semibold bg-slate-100 text-slate-800 px-2.5 py-1 rounded-full border border-slate-200">Cancelado</span>`; break;
            case 'denegado': statusBadge = `<span class="text-xs font-semibold bg-red-100 text-red-800 px-2.5 py-1 rounded-full border border-red-200">Denegado</span>`; break;
        }
        el.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <p class="font-black text-xl text-indigo-650">${formatCurrency(p.amount)}</p>
                    <p class="text-sm text-slate-700 italic mt-0.5">"${p.reason}"</p>
                    <p class="text-xs text-slate-400 mt-1">Solicitado el: ${p.requestDate}</p>
                </div>
                <div class="flex items-center gap-3 mt-3 sm:mt-0 border-t sm:border-t-0 pt-2 sm:pt-0 w-full sm:w-auto justify-between sm:justify-end">
                    ${statusBadge}
                    <div class="flex items-center gap-2">	extColor${actions}</div>
                </div>
            </div>
        `;
        prestamosListEl.appendChild(el);
    });

    prestamosListEl.querySelectorAll('.approve-loan-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showApproveLoanModal(JSON.parse(e.currentTarget.dataset.loanJson)));
    });
    prestamosListEl.querySelectorAll('.loan-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleLoanAction(e.currentTarget.dataset.loanId, e.currentTarget.dataset.action));
    });
}

function showLoanRequestModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-lg w-full mx-auto text-left">
            <div class="modal-header-fixed">
                <h2 class="text-xl font-bold text-slate-800">Solicitud de Préstamo</h2>
                <button id="close-loan-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="modal-body-scroll space-y-6">
                <form id="loan-request-form" class="space-y-4">
                    <div>
                        <label for="loan-amount" class="block text-sm font-semibold text-slate-700">Monto a Solicitar</label>
                        <input type="text" id="loan-amount" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white transition-all" inputmode="numeric" required>
                    </div>
                    <div>
                        <label for="loan-reason" class="block text-sm font-semibold text-slate-700">Motivo</label>
                        <textarea id="loan-reason" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white transition-all" rows="3" required></textarea>
                    </div>
                    <button type="submit" class="w-full bg-indigo-650 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-sm">Enviar Solicitud</button>
                </form>
                <div class="border-t border-slate-100 pt-4">
                    <h3 class="text-base font-bold text-slate-800">Mis Solicitudes</h3>
                    <div id="my-loans-list" class="space-y-3 mt-3 max-h-60 overflow-y-auto divide-y divide-slate-100">Cargando...</div>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-loan-modal').addEventListener('click', hideModal);

    const amountInput = document.getElementById('loan-amount');
    amountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    amountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    document.getElementById('loan-request-form').addEventListener('submit', handleLoanRequestSubmit);

    const loansListEl = document.getElementById('my-loans-list');
    const q = query(collection(db, "prestamos"), where("employeeId", "==", currentUser.uid));
    onSnapshot(q, (snapshot) => {
        const prestamos = snapshot.docs.map(d => d.data());
        prestamos.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));

        if (prestamos.length === 0) {
            loansListEl.innerHTML = '<p class="text-center text-gray-500 py-4">No tienes solicitudes de préstamo.</p>';
            return;
        }
        loansListEl.innerHTML = '';
        prestamos.forEach(p => {
            const el = document.createElement('div');
            el.className = 'bg-slate-50 border border-slate-100 p-3 rounded-xl flex justify-between items-center';
            let statusBadge = '';
            switch (p.status) {
                case 'solicitado': statusBadge = `<span class="text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-250 px-2 py-0.5 rounded-md uppercase tracking-wider">Solicitado</span>`; break;
                case 'aprobado': statusBadge = `<span class="text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-250 px-2 py-0.5 rounded-md uppercase tracking-wider">Aprobado</span>`; break;
                case 'cancelado': statusBadge = `<span class="text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-md uppercase tracking-wider">Cancelado</span>`; break;
                case 'denegado': statusBadge = `<span class="text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200 px-2 py-0.5 rounded-md uppercase tracking-wider">Denegado</span>`; break;
            }
            el.innerHTML = `
                    <div>
                        <p class="font-extrabold text-slate-800">${formatCurrency(p.amount)}</p>
                        <p class="text-xs text-slate-400 font-medium mt-0.5">${p.requestDate}</p>
                    </div>
                    ${statusBadge}
                `;
            loansListEl.appendChild(el);
        });
    });
}

async function handleLoanRequestSubmit(e) {
    e.preventDefault();
    const amount = unformatCurrency(document.getElementById('loan-amount').value);
    const reason = document.getElementById('loan-reason').value;

    if (amount <= 0) return showModalMessage("El monto debe ser mayor a cero.");

    const newLoan = {
        employeeId: currentUser.uid,
        employeeName: currentUserData.nombre,
        amount: amount,
        reason: reason,
        requestDate: new Date().toISOString().split('T')[0],
        status: 'solicitado'
    };

    showModalMessage("Enviando solicitud...", true);
    try {
        await addDoc(collection(db, "prestamos"), newLoan);
        hideModal();
        showModalMessage("¡Solicitud enviada con éxito!", false, 2000);
    } catch (error) {
        console.error("Error al solicitar préstamo:", error);
        showModalMessage("Error al enviar la solicitud.");
    }
}

function showAllLoansModal(requests) {
    let requestsHTML = '';
    if (requests.length === 0) {
        requestsHTML = '<p class="text-center text-slate-500 py-8 text-lg">No hay solicitudes de préstamo pendientes.</p>';
    } else {
        requests.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
        requestsHTML = requests.map(p => {
            const empleado = allUsers.find(u => u.id === p.employeeId);
            const telefono = empleado ? empleado.telefono : 'No encontrado';
            return `
            <div class="bg-slate-50 border border-slate-100 p-4 rounded-xl shadow-sm text-left hover:shadow-md transition-shadow">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div class="space-y-1">
                        <div class="flex items-center gap-2">
                            <p class="font-bold text-slate-800 text-base">${p.employeeName}</p>
                            <span class="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-medium">${telefono}</span>
                        </div>
                        <p class="text-sm text-slate-600 italic">"${p.reason}"</p>
                        <p class="text-xs text-slate-400">Solicitado el: ${p.requestDate}</p>
                    </div>
                    <div class="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0">
                        <p class="font-black text-2xl text-indigo-650">${formatCurrency(p.amount)}</p>
                        <div class="flex items-center gap-2">
                            <button data-loan-json='${JSON.stringify(p)}' class="approve-loan-btn bg-emerald-650 hover:bg-emerald-755 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-xs">Aprobar</button>
                            <button data-loan-id="${p.id}" data-action="denegado" class="loan-action-btn bg-rose-650 hover:bg-rose-755 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-xs">Denegar</button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-4xl w-full mx-auto" style="height: 85vh; max-height: 85vh;">
            <div class="modal-header-fixed">
                <h2 class="text-xl font-bold text-slate-800">Solicitudes de Préstamo Pendientes</h2>
                <button id="close-all-loans-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="modal-body-scroll space-y-4">
                ${requestsHTML}
            </div>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-all-loans-modal').addEventListener('click', hideModal);

    modalContentWrapper.querySelectorAll('.approve-loan-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showApproveLoanModal(JSON.parse(e.currentTarget.dataset.loanJson)));
    });
    modalContentWrapper.querySelectorAll('.loan-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleLoanAction(e.currentTarget.dataset.loanId, e.currentTarget.dataset.action));
    });
}

function showApproveLoanModal(loan) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');

    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-md w-full mx-auto text-left">
            <div class="modal-header-fixed">
                <h2 class="text-xl font-bold text-slate-800">Aprobar Préstamo</h2>
                <button id="cancel-approve-btn-close" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="approve-loan-form" class="modal-body-scroll space-y-5">
                <div class="bg-indigo-50 border border-indigo-100 p-4 rounded-xl space-y-2">
                    <p class="text-sm text-slate-700"><span class="font-semibold text-slate-900">Empleado:</span> ${loan.employeeName}</p>
                    <p class="text-sm text-slate-700 flex justify-between items-baseline"><span class="font-semibold text-slate-900">Monto:</span> <span class="text-2xl font-black text-indigo-650">${formatCurrency(loan.amount)}</span></p>
                </div>
                <div>
                    <label for="loan-payment-method" class="block text-sm font-semibold text-slate-700">Fuente del Pago</label>
                    <select id="loan-payment-method" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 transition-all text-sm" required>
                        ${metodosDePagoHTML}
                    </select>
                </div>
                <div class="flex gap-3 justify-end pt-4 border-t border-slate-100">
                    <button type="button" id="cancel-approve-btn" class="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2.5 rounded-xl font-bold transition-colors text-sm">Cancelar</button>
                    <button type="submit" class="bg-emerald-650 hover:bg-emerald-755 text-white px-5 py-2.5 rounded-xl font-bold transition-colors shadow-xs text-sm">Confirmar Aprobación</button>
                </div>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('cancel-approve-btn').addEventListener('click', hideModal);
    document.getElementById('cancel-approve-btn-close').addEventListener('click', hideModal);
    document.getElementById('approve-loan-form').addEventListener('submit', (e) => {
        e.preventDefault();
        handleApproveLoan(loan, document.getElementById('loan-payment-method').value);
    });
}

async function handleApproveLoan(loan, paymentMethod) {
    showModalMessage("Procesando aprobación...", true);
    try {
        const approvalDate = new Date();
        const dateString = approvalDate.toISOString().split('T')[0];

        const nuevoGasto = {
            fecha: dateString,
            proveedorId: loan.employeeId,
            proveedorNombre: `Préstamo Aprobado: ${loan.employeeName}`,
            numeroFactura: `Préstamo RRHH`,
            valorTotal: loan.amount,
            fuentePago: paymentMethod,
            registradoPor: currentUser.uid,
            timestamp: Date.now(),
            isLoanAdvance: true,
            _lastUpdated: serverTimestamp()
        };
        await addDoc(collection(db, "gastos"), nuevoGasto);

        const nuevoPago = {
            motivo: `Préstamo: ${loan.reason.substring(0, 30)}`,
            valor: loan.amount,
            fecha: dateString,
            fuentePago: paymentMethod,
            timestamp: approvalDate.toISOString()
        };
        
        await updateDoc(doc(db, "users", loan.employeeId), { pagos: arrayUnion(nuevoPago), _lastUpdated: serverTimestamp() });
        await updateDoc(doc(db, "prestamos", loan.id), {
            status: 'aprobado',
            paymentMethod: paymentMethod,
            aprobadoBy: currentUser.uid,
            aprobadoDate: dateString
        });

        const empleadoAfectado = allUsers.find(u => u.id === loan.employeeId);
        if (empleadoAfectado) {
            if (!empleadoAfectado.pagos) empleadoAfectado.pagos = [];
            empleadoAfectado.pagos.push(nuevoPago);
            empleadoAfectado._lastUpdated = Date.now();
            updateLocalCache(empleadoAfectado);
        }

        hideModal();
        showTemporaryMessage("Préstamo aprobado y registrado.", 'success');
    } catch (error) {
        console.error("Error al aprobar préstamo:", error);
        hideModal();
        showModalMessage("Error al procesar la aprobación.");
    }
}

async function handleLoanAction(loanId, action) {
    if (action === 'aprobado') return;

    showModalMessage("Actualizando préstamo...", true);
    try {
        if (action === 'denegado') {
            await deleteDoc(doc(db, "prestamos", loanId));
            showModalMessage("Préstamo denegado y eliminado.", false, 2000);
        } else {
            await updateDoc(doc(db, "prestamos", loanId), {
                status: action,
                [`${action}By`]: currentUser.uid,
                [`${action}Date`]: new Date().toISOString().split('T')[0]
            });
            showModalMessage(`Préstamo marcado como ${action}.`, false, 2000);
        }
    } catch (error) {
        console.error(`Error al ${action} el préstamo:`, error);
        showModalMessage("Error al actualizar el estado del préstamo.");
    }
}

export function setupEmpleadosEvents() {
    if (window.__setupEmpleadosEventsInit) return;
    window.__setupEmpleadosEventsInit = true;

    const loanRequestBtn = document.getElementById('loan-request-btn');
    if (loanRequestBtn) {
        loanRequestBtn.addEventListener('click', showLoanRequestModal);
    }

    const viewAllLoansBtn = document.getElementById('view-all-loans-btn');
    if (viewAllLoansBtn) {
        viewAllLoansBtn.addEventListener('click', () => { showAllLoansModal(allPendingLoans); });
    }
}