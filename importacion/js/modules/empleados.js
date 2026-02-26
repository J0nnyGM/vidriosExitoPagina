// js/modules/empleados.js

import { db, storage, functions } from '../firebase-config.js';
import { collection, doc, updateDoc, query, onSnapshot, getDocs, where, addDoc, deleteDoc, arrayUnion, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
import { 
    allUsers, setAllUsers, allPendingLoans, setAllPendingLoans, 
    currentUser, currentUserData, 
    showModalMessage, hideModal, showTemporaryMessage, showPdfModal 
} from '../app.js';
import { formatCurrency, unformatCurrency, unformatCurrencyInput, formatCurrencyInput } from '../utils.js';
import { METODOS_DE_PAGO, RRHH_DOCUMENT_TYPES, ALL_MODULES } from '../constants.js';

// --- CONFIGURACIÓN DE CACHÉ ---
const EMPLEADOS_CACHE_KEY = 'empleados_cache';
const EMPLEADOS_SYNC_KEY = 'empleados_last_sync';

// --- CARGA DE DATOS ---
export async function loadEmpleados() {
    if (!currentUserData || currentUserData.role !== 'admin') {
        return () => { }; 
    }

    const cachedData = localStorage.getItem(EMPLEADOS_CACHE_KEY);
    const lastSyncStr = localStorage.getItem(EMPLEADOS_SYNC_KEY);
    
    let lastSync = null;
    let mapUsers = new Map();

    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            parsedData.forEach(u => mapUsers.set(u.id, u));
            setAllUsers(Array.from(mapUsers.values()));
            renderAndAttachEmployeeListeners(Array.from(mapUsers.values()));
        } catch (e) {
            console.warn("Caché de empleados corrupto. Se limpiará.");
            localStorage.removeItem(EMPLEADOS_CACHE_KEY);
            localStorage.removeItem(EMPLEADOS_SYNC_KEY);
        }
    }

    if (lastSyncStr) lastSync = new Date(parseInt(lastSyncStr));

    try {
        const colRef = collection(db, "users");
        let q;

        if (lastSync) {
            const syncTime = new Date(lastSync.getTime() - 60000); 
            q = query(colRef, where("_lastUpdated", ">=", syncTime));
        } else {
            q = query(colRef);
        }

        const snapshot = await getDocs(q);
        let huboCambios = false;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data._lastUpdated && typeof data._lastUpdated.toMillis === 'function') data._lastUpdated = data._lastUpdated.toMillis();
            if (data.creadoEn && typeof data.creadoEn.toMillis === 'function') data.creadoEn = data.creadoEn.toMillis();
            
            mapUsers.set(doc.id, { id: doc.id, ...data });
            huboCambios = true;
        });

        if (huboCambios || !lastSync) {
            const finalArray = Array.from(mapUsers.values());
            
            finalArray.sort((a, b) => {
                const statusOrder = { 'pending': 1, 'inactive': 2, 'active': 3 };
                const orderA = statusOrder[a.status] || 99;
                const orderB = statusOrder[b.status] || 99;
                if (orderA !== orderB) return orderA - orderB;
                return (a.nombre || '').localeCompare(b.nombre || '');
            });

            localStorage.setItem(EMPLEADOS_CACHE_KEY, JSON.stringify(finalArray));
            localStorage.setItem(EMPLEADOS_SYNC_KEY, Date.now().toString());

            setAllUsers(finalArray);
            renderAndAttachEmployeeListeners(finalArray);
            console.log(`[Caché] Empleados sincronizados. ${snapshot.size} lecturas de Firebase.`);
        }

    } catch (error) {
        console.error("Error sincronizando empleados:", error);
    }
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

    empleadosListEl.innerHTML = '';

    // AQUI ESTÁ EL CAMBIO: Ya no usamos .filter(u => u.id !== currentUser.uid)
    users.forEach(empleado => {
        const el = document.createElement('div');
        el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-center gap-4';

        const isMe = (empleado.id === currentUser.uid); // Comprobamos si es el propio admin

        let statusBadge = '';
        let toggleButtonHTML = '';

        switch (empleado.status) {
            case 'active':
                statusBadge = `<span class="text-xs font-semibold bg-green-200 text-green-800 px-2 py-1 rounded-full">Activo</span>`;
                toggleButtonHTML = `<button data-uid="${empleado.id}" data-status="inactive" class="user-status-btn bg-yellow-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-yellow-600 transition w-full">Desactivar</button>`;
                break;
            case 'inactive':
                statusBadge = `<span class="text-xs font-semibold bg-gray-200 text-gray-800 px-2 py-1 rounded-full">Inactivo</span>`;
                toggleButtonHTML = `<button data-uid="${empleado.id}" data-status="active" class="user-status-btn bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-600 transition w-full">Activar</button>`;
                break;
            default:
                statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Pendiente</span>`;
                toggleButtonHTML = `<button data-uid="${empleado.id}" data-status="active" class="user-status-btn bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-600 transition w-full">Activar</button>`;
                break;
        }

        // Medida de seguridad: Si es el propio Admin, no puede desactivarse ni eliminarse
        if (isMe) {
            toggleButtonHTML = `<button disabled class="bg-gray-200 text-gray-500 px-4 py-2 rounded-lg text-sm font-semibold cursor-not-allowed w-full">Tu Cuenta</button>`;
        }

        const deleteBtnHTML = isMe 
            ? '' 
            : `<button data-uid="${empleado.id}" class="delete-user-btn bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-600 transition w-full">Eliminar</button>`;

        el.innerHTML = `
            <div class="flex-grow">
                <div class="flex items-center gap-2 mb-1">
                     <p class="font-semibold">${empleado.nombre} ${isMe ? '<span class="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded ml-2">Tú</span>' : ''}</p>
                     ${statusBadge}
                </div>
                <p class="text-sm text-gray-600">${empleado.email} <span class="text-sm font-normal text-gray-500">(${empleado.role})</span></p>
            </div>
            <div class="flex-shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-2 w-full sm:w-auto">
                <button data-user-json='${JSON.stringify(empleado)}' class="manage-rrhh-docs-btn bg-teal-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-teal-600 transition w-full">RR.HH.</button>
                <button data-user-json='${JSON.stringify(empleado)}' class="manage-user-btn bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-600 transition w-full">Gestionar</button>
                ${toggleButtonHTML}
                ${deleteBtnHTML}
            </div>`;
        empleadosListEl.appendChild(el);
    });

    // Listeners de los botones (Actualizado para usar Firestore Directo)
    document.querySelectorAll('.user-status-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const userId = e.currentTarget.dataset.uid;
            const newStatus = e.currentTarget.dataset.status;
            
            // Verificación extra en frontend por si acaso
            if (currentUserData.role !== 'admin') {
                return showModalMessage("Solo los administradores pueden hacer esto.");
            }

            if (confirm(`¿Estás seguro de que quieres cambiar el estado de este usuario a "${newStatus}"?`)) {
                showModalMessage("Actualizando estado...", true);
                try {
                    // Actualizamos directamente en Firestore sin pasar por Functions
                    await updateDoc(doc(db, "users", userId), {
                        status: newStatus,
                        _lastUpdated: serverTimestamp()
                    });
                    
                    // Actualizar caché local
                    const userActual = allUsers.find(u => u.id === userId);
                    if (userActual) {
                        updateLocalCache({ ...userActual, status: newStatus, _lastUpdated: Date.now() });
                    }

                    hideModal();
                    showTemporaryMessage("Estado del usuario actualizado.", "success");
                } catch (error) {
                    console.error("Error al cambiar estado en Firestore:", error);
                    // Si falla aquí, es por tus Reglas de Seguridad (firestore.rules)
                    showModalMessage(`Error de permisos: Asegúrate de ser Administrador.`);
                }
            }
        });
    });

    document.querySelectorAll('.manage-rrhh-docs-btn').forEach(btn => btn.addEventListener('click', (e) => showRRHHModal(JSON.parse(e.currentTarget.dataset.userJson))));
    document.querySelectorAll('.manage-user-btn').forEach(btn => btn.addEventListener('click', (e) => showAdminEditUserModal(JSON.parse(e.currentTarget.dataset.userJson))));
    
    document.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const uid = e.currentTarget.dataset.uid;
            if (confirm('¿Estás seguro de que quieres eliminar este usuario permanentemente?')) {
                showModalMessage("Eliminando usuario...", true);
                try {
                    await deleteDoc(doc(db, "users", uid));
                    
                    const cachedData = localStorage.getItem(EMPLEADOS_CACHE_KEY);
                    if (cachedData) {
                        const users = JSON.parse(cachedData).filter(u => u.id !== uid);
                        localStorage.setItem(EMPLEADOS_CACHE_KEY, JSON.stringify(users));
                        setAllUsers(users);
                        renderAndAttachEmployeeListeners(users);
                    }
                    hideModal();
                    showTemporaryMessage("Usuario eliminado.", "success");
                } catch (error) {
                    hideModal();
                    showModalMessage("Error al eliminar: " + error.message);
                }
            }
        });
    });
}

function showAdminEditUserModal(user) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const userPermissions = user.permissions || {};

    let permissionsHTML = ALL_MODULES.filter(m => m !== 'empleados').map(module => {
        const isChecked = userPermissions[module] || false;
        const capitalized = module.charAt(0).toUpperCase() + module.slice(1);
        return `
                <label class="flex items-center space-x-2">
                    <input type="checkbox" class="permission-checkbox h-4 w-4 rounded border-gray-300" data-module="${module}" ${isChecked ? 'checked' : ''}>
                    <span>${capitalized}</span>
                </label>
            `;
    }).join('');

    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Gestionar Empleado: ${user.nombre}</h2>
                    <button id="close-admin-edit-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <form id="admin-edit-user-form" class="space-y-4">
                    <input type="hidden" id="admin-edit-user-id" value="${user.id}">
                    <div><label class="block text-sm font-medium">Nombre Completo</label><input type="text" id="admin-edit-name" class="w-full p-2 border rounded-lg mt-1" value="${user.nombre || ''}" required></div>
                    <div><label class="block text-sm font-medium">Correo Electrónico</label><input type="email" id="admin-edit-email" class="w-full p-2 border rounded-lg mt-1" value="${user.email || ''}" required></div>
                    <div><label class="block text-sm font-medium">Teléfono</label><input type="tel" id="admin-edit-phone" class="w-full p-2 border rounded-lg mt-1" value="${user.telefono || ''}"></div>
                    <div><label class="block text-sm font-medium">Dirección</label><input type="text" id="admin-edit-address" class="w-full p-2 border rounded-lg mt-1" value="${user.direccion || ''}"></div>
                    <div><label class="block text-sm font-medium">Fecha de Nacimiento</label><input type="date" id="admin-edit-dob" class="w-full p-2 border rounded-lg mt-1" value="${user.dob || ''}"></div>
                    <div>
                        <label class="block text-sm font-medium">Rol</label>
                    <select id="admin-edit-role-select" class="w-full p-2 border rounded-lg mt-1 bg-white">
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option>
                        <option value="planta" ${user.role === 'planta' ? 'selected' : ''}>Planta</option>
                        <option value="contabilidad" ${user.role === 'contabilidad' ? 'selected' : ''}>Contabilidad</option>
                    </select>
                    </div>
                    <div id="admin-edit-permissions-container">
                        <label class="block text-sm font-medium mb-2">Permisos de Módulos</label>
                        <div class="grid grid-cols-2 gap-2">
                            ${permissionsHTML}
                        </div>
                    </div>
                    <div class="flex justify-end pt-4">
                        <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Guardar Cambios</button>
                    </div>
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

// --- RRHH: MODAL PRINCIPAL Y PESTAÑAS ---
function showRRHHModal(empleado) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl w-full max-w-5xl mx-auto text-left flex flex-col" style="max-height: 90vh;">
                <div class="flex justify-between items-center p-4 border-b">
                    <h2 class="text-xl font-semibold">Recursos Humanos: ${empleado.nombre}</h2>
                    <button id="close-rrhh-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <div class="border-b border-gray-200">
                    <nav class="-mb-px flex space-x-6 px-6 overflow-x-auto">
                        <button id="rrhh-tab-contratacion" class="dashboard-tab-btn active py-3 px-1 font-semibold whitespace-nowrap">Datos y Contratación</button>
                        <button id="rrhh-tab-pagos" class="dashboard-tab-btn py-3 px-1 font-semibold whitespace-nowrap">Pagos y Liquidaciones</button>
                        <button id="rrhh-tab-descargos" class="dashboard-tab-btn py-3 px-1 font-semibold whitespace-nowrap">Descargos</button>
                        <button id="rrhh-tab-prestamos" class="dashboard-tab-btn py-3 px-1 font-semibold whitespace-nowrap">Préstamos</button>
                    </nav>
                </div>
                <div class="p-6 overflow-y-auto flex-grow">
                    <div id="rrhh-view-contratacion"></div>
                    <div id="rrhh-view-pagos" class="hidden"></div>
                    <div id="rrhh-view-descargos" class="hidden"></div>
                    <div id="rrhh-view-prestamos" class="hidden"></div>
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
        <form id="contratacion-form">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-4">
                    <h3 class="text-lg font-semibold border-b pb-2">Información Laboral</h3>
                    <div><label class="block text-sm font-medium">Fecha de Ingreso</label><input type="date" id="rrhh-fechaIngreso" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.fechaIngreso || ''}"></div>
                    <div><label class="block text-sm font-medium">Salario</label><input type="text" id="rrhh-salario" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.salario ? formatCurrency(contratacionData.salario) : ''}"></div>
                    <div><label class="block text-sm font-medium">EPS</label><input type="text" id="rrhh-eps" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.eps || ''}"></div>
                    <div><label class="block text-sm font-medium">AFP</label><input type="text" id="rrhh-afp" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.afp || ''}"></div>
                </div>
                <div class="space-y-4">
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center border-b pb-2 gap-2">
                        <h3 class="text-lg font-semibold">Documentos</h3>
                        <div class="flex items-center gap-2">
                            <label for="rrhh-year-filter" class="text-sm font-medium">Año:</label>
                            <select id="rrhh-year-filter" class="p-1 border rounded-lg bg-white">${yearOptions}</select>
                            <button type="button" id="download-all-docs-btn" class="bg-green-600 text-white font-bold py-1 px-3 rounded-lg hover:bg-green-700 text-sm">Descargar Todo</button>
                        </div>
                    </div>
                    <div id="rrhh-documents-list" class="border rounded-lg"></div>
                </div>
            </div>
            <div class="flex justify-end mt-6">
                <button type="submit" class="bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-700">Guardar Información</button>
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
            <div class="flex justify-between items-center p-3 border-b">
                <span class="font-medium">${docType.name}</span>
                <div class="flex items-center gap-2">
                    ${docUrl ? `<button type="button" data-pdf-url="${docUrl}" data-doc-name="${docType.name}" class="view-rrhh-pdf-btn bg-blue-500 text-white px-3 py-1 rounded-lg text-sm hover:bg-blue-600">Ver</button>` : '<span class="text-xs text-gray-400">No adjunto</span>'}
                    <input type="file" id="${fileInputId}" class="hidden" accept=".pdf,.jpg,.jpeg,.png">
                    <label for="${fileInputId}" class="bg-gray-200 text-gray-700 px-3 py-1 rounded-lg text-sm font-semibold cursor-pointer hover:bg-gray-300">Adjuntar</label>
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
                 <div class="bg-gray-50 p-4 rounded-lg">
                    <h3 class="text-lg font-semibold mb-2">Liquidador Horas Extra</h3>
                    <div class="space-y-2">
                        <div><label class="text-sm">Salario Base (sin auxilio)</label><input type="text" id="salario-base-he" class="w-full p-2 border bg-gray-200 rounded-lg mt-1" value="${formatCurrency(salario > 200000 ? salario - 200000 : 0)}" readonly></div>
                        <div><label for="horas-extra-input" class="text-sm">Cantidad de Horas Extra</label><input type="number" id="horas-extra-input" class="w-full p-2 border rounded-lg mt-1" min="0"></div>
                        <button id="calcular-horas-btn" class="w-full bg-blue-500 text-white font-semibold py-2 rounded-lg hover:bg-blue-600">Calcular</button>
                        <div id="horas-extra-resultado" class="text-center font-bold text-xl mt-2 p-2 bg-blue-100 rounded-lg"></div>
                    </div>
                </div>
                <div class="bg-gray-50 p-4 rounded-lg">
                    <h3 class="text-lg font-semibold mb-2">Registrar Nuevo Pago</h3>
                    <form id="rrhh-pago-form" class="space-y-3">
                        <div id="prestamos-pendientes-container" class="mb-4"></div>
                        <div><label class="text-sm">Motivo</label><select id="rrhh-pago-motivo" class="w-full p-2 border rounded-lg mt-1 bg-white"><option>Sueldo</option><option>Prima</option><option>Horas Extra</option><option>Liquidación</option></select></div>
                        <div>
                            <label class="text-sm">Valor</label>
                            <input type="text" id="rrhh-pago-valor" class="w-full p-2 border rounded-lg mt-1" required>
                            <p id="pago-sugerido-info" class="text-xs text-gray-500 mt-1 hidden">Valor quincenal sugerido (salario/2 - aportes).</p>
                        </div>
                        <div><label class="text-sm">Fecha</label><input type="date" id="rrhh-pago-fecha" class="w-full p-2 border rounded-lg mt-1" value="${new Date().toISOString().split('T')[0]}" required></div>
                        <div><label class="text-sm">Fuente de Pago</label><select id="rrhh-pago-fuente" class="w-full p-2 border rounded-lg mt-1 bg-white">${metodosDePagoHTML}</select></div>
                        <button type="submit" class="w-full bg-green-600 text-white font-semibold py-2 rounded-lg hover:bg-green-700">Registrar Pago</button>
                    </form>
                </div>
            </div>
            <div class="md:col-span-2">
                <h3 class="text-lg font-semibold mb-2">Historial de Pagos</h3>
                <div class="border rounded-lg max-h-96 overflow-y-auto">
                    <table class="w-full text-sm">
                        <thead class="bg-gray-100"><tr><th class="p-2 text-left">Fecha</th><th class="p-2 text-left">Motivo</th><th class="p-2 text-right">Valor</th><th class="p-2 text-left">Fuente</th></tr></thead>
                        <tbody id="rrhh-pagos-historial">${pagosHTML}</tbody>
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
                <div class="border p-4 rounded-lg">
                    <div class="flex justify-between items-start">
                        <div>
                            <p class="font-semibold">${d.motivo}</p>
                            <p class="text-sm text-gray-500">Fecha: ${d.fecha}</p>
                        </div>
                        <div class="flex items-center gap-2">
                            ${d.citacionUrl ? `<button type="button" data-pdf-url="${d.citacionUrl}" data-doc-name="Citación" class="view-rrhh-pdf-btn text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded-full hover:bg-blue-200">Citación</button>` : ''}
                            ${d.actaUrl ? `<button type="button" data-pdf-url="${d.actaUrl}" data-doc-name="Acta" class="view-rrhh-pdf-btn text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded-full hover:bg-blue-200">Acta</button>` : ''}
                            ${d.conclusionUrl ? `<button type="button" data-pdf-url="${d.conclusionUrl}" data-doc-name="Conclusión" class="view-rrhh-pdf-btn text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded-full hover:bg-blue-200">Conclusión</button>` : ''}
                        </div>
                    </div>
                </div>
            `).join('')
        : '<p class="text-center text-gray-500 py-4">No hay descargos registrados.</p>';

    container.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="md:col-span-1">
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <h3 class="text-lg font-semibold mb-2">Registrar Descargo</h3>
                        <form id="descargos-form" class="space-y-4">
                            <div><label for="descargo-fecha" class="text-sm font-medium">Fecha de Reunión</label><input type="date" id="descargo-fecha" class="w-full p-2 border rounded-lg mt-1" required></div>
                            <div><label for="descargo-motivo" class="text-sm font-medium">Motivo de Reunión</label><textarea id="descargo-motivo" class="w-full p-2 border rounded-lg mt-1" rows="3" required></textarea></div>
                            <div><label for="descargo-citacion" class="text-sm font-medium">Citación a descargos (PDF)</label><input type="file" id="descargo-citacion" class="w-full text-sm" accept=".pdf"></div>
                            <div><label for="descargo-acta" class="text-sm font-medium">Acta de descargos (PDF)</label><input type="file" id="descargo-acta" class="w-full text-sm" accept=".pdf"></div>
                            <div><label for="descargo-conclusion" class="text-sm font-medium">Conclusión de descargos (PDF)</label><input type="file" id="descargo-conclusion" class="w-full text-sm" accept=".pdf"></div>
                            <button type="submit" class="w-full bg-purple-600 text-white font-semibold py-2 rounded-lg hover:bg-purple-700">Guardar Descargo</button>
                        </form>
                    </div>
                </div>
                <div class="md:col-span-2">
                     <h3 class="text-lg font-semibold mb-2">Historial de Descargos</h3>
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
        <div class="space-y-4">
            <div class="bg-gray-50 p-3 rounded-lg border">
                <h3 class="font-semibold mb-2">Filtrar Préstamos</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium mb-1">Filtrar por Mes</label>
                        <div class="flex gap-2">
                            <select id="loan-month-filter" class="p-2 border rounded-lg bg-white w-full">${monthOptions}</select>
                            <select id="loan-year-filter" class="p-2 border rounded-lg bg-white w-full">${yearOptions}</select>
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-1">Filtrar por Rango</label>
                        <div class="flex gap-2 items-center">
                            <input type="date" id="loan-start-date" class="p-2 border rounded-lg w-full">
                            <span class="text-gray-500">-</span>
                            <input type="date" id="loan-end-date" class="p-2 border rounded-lg w-full">
                        </div>
                    </div>
                </div>
            </div>
            <div>
                <h3 class="text-lg font-semibold mb-2">Solicitudes de Préstamo</h3>
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
        el.className = 'border p-3 rounded-lg';

        let statusBadge = '';
        let actions = '';
        switch (p.status) {
            case 'solicitado':
                statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Solicitado</span>`;
                actions = `
                    <button data-loan-json='${JSON.stringify(p)}' class="approve-loan-btn bg-green-500 text-white text-xs px-3 py-1 rounded-full hover:bg-green-600">Aprobar</button>
                    <button data-loan-id="${p.id}" data-action="denegado" class="loan-action-btn bg-red-500 text-white text-xs px-3 py-1 rounded-full hover:bg-red-600">Denegar</button>
                `;
                break;
            case 'aprobado': statusBadge = `<span class="text-xs font-semibold bg-blue-200 text-blue-800 px-2 py-1 rounded-full">Aprobado</span>`; break;
            case 'cancelado': statusBadge = `<span class="text-xs font-semibold bg-gray-200 text-gray-800 px-2 py-1 rounded-full">Cancelado</span>`; break;
            case 'denegado': statusBadge = `<span class="text-xs font-semibold bg-red-200 text-red-800 px-2 py-1 rounded-full">Denegado</span>`; break;
        }
        el.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                <div>
                    <p class="font-bold text-lg">${formatCurrency(p.amount)}</p>
                    <p class="text-sm text-gray-600">${p.reason}</p>
                    <p class="text-xs text-gray-400">Solicitado el: ${p.requestDate}</p>
                </div>
                <div class="flex items-center gap-2 mt-2 sm:mt-0">
                    ${statusBadge}
                    ${actions}
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
            <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Solicitud de Préstamo</h2>
                    <button id="close-loan-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <form id="loan-request-form" class="space-y-4 mb-6">
                    <div>
                        <label for="loan-amount" class="block text-sm font-medium">Monto a Solicitar</label>
                        <input type="text" id="loan-amount" class="w-full p-2 border rounded-lg mt-1" inputmode="numeric" required>
                    </div>
                    <div>
                        <label for="loan-reason" class="block text-sm font-medium">Motivo</label>
                        <textarea id="loan-reason" class="w-full p-2 border rounded-lg mt-1" rows="3" required></textarea>
                    </div>
                    <button type="submit" class="w-full bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-yellow-700">Enviar Solicitud</button>
                </form>
                <div>
                    <h3 class="text-lg font-semibold border-t pt-4">Mis Solicitudes</h3>
                    <div id="my-loans-list" class="space-y-2 mt-2 max-h-60 overflow-y-auto">Cargando...</div>
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
            el.className = 'border p-3 rounded-lg flex justify-between items-center';
            let statusBadge = '';
            switch (p.status) {
                case 'solicitado': statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Solicitado</span>`; break;
                case 'aprobado': statusBadge = `<span class="text-xs font-semibold bg-blue-200 text-blue-800 px-2 py-1 rounded-full">Aprobado</span>`; break;
                case 'cancelado': statusBadge = `<span class="text-xs font-semibold bg-gray-200 text-gray-800 px-2 py-1 rounded-full">Cancelado</span>`; break;
                case 'denegado': statusBadge = `<span class="text-xs font-semibold bg-red-200 text-red-800 px-2 py-1 rounded-full">Denegado</span>`; break;
            }
            el.innerHTML = `
                    <div>
                        <p class="font-bold">${formatCurrency(p.amount)}</p>
                        <p class="text-xs text-gray-500">${p.requestDate}</p>
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
        requestsHTML = '<p class="text-center text-gray-500 py-4">No hay solicitudes de préstamo pendientes.</p>';
    } else {
        requests.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
        requestsHTML = requests.map(p => {
            const empleado = allUsers.find(u => u.id === p.employeeId);
            const telefono = empleado ? empleado.telefono : 'No encontrado';
            return `
            <div class="border p-3 rounded-lg text-left">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                    <div>
                        <p class="font-bold text-gray-800">${p.employeeName}</p>
                        <p class="text-sm text-gray-500">${telefono}</p> 
                        <p class="font-bold text-lg mt-1">${formatCurrency(p.amount)}</p>
                        <p class="text-sm text-gray-600">${p.reason}</p>
                        <p class="text-xs text-gray-400">Solicitado el: ${p.requestDate}</p>
                    </div>
                    <div class="flex items-center gap-2 mt-2 sm:mt-0">
                        <button data-loan-json='${JSON.stringify(p)}' class="approve-loan-btn bg-green-500 text-white text-xs px-3 py-1 rounded-full hover:bg-green-700">Aprobar</button>
                        <button data-loan-id="${p.id}" data-action="denegado" class="loan-action-btn bg-red-500 text-white text-xs px-3 py-1 rounded-full hover:bg-red-600">Denegar</button>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-11/12 md:w-4/5 lg:w-3/4 mx-auto flex flex-col" style="max-height: 85vh;">
            <div class="flex justify-between items-center p-4 border-b">
                <h2 class="text-xl font-semibold">Solicitudes de Préstamo Pendientes</h2>
                <button id="close-all-loans-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="p-4 space-y-3 overflow-y-auto">
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
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-left">
            <h2 class="text-xl font-semibold mb-4">Aprobar Préstamo</h2>
            <p class="mb-1"><span class="font-semibold">Empleado:</span> ${loan.employeeName}</p>
            <p class="mb-4"><span class="font-semibold">Monto:</span> ${formatCurrency(loan.amount)}</p>
            <form id="approve-loan-form">
                <div>
                    <label for="loan-payment-method" class="block text-sm font-medium">Fuente del Pago</label>
                    <select id="loan-payment-method" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-white" required>
                        ${metodosDePagoHTML}
                    </select>
                </div>
                <div class="flex gap-4 justify-end pt-4 mt-4 border-t">
                    <button type="button" id="cancel-approve-btn" class="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-semibold">Cancelar</button>
                    <button type="submit" class="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold">Confirmar Aprobación</button>
                </div>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('cancel-approve-btn').addEventListener('click', hideModal);
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
    const loanRequestBtn = document.getElementById('loan-request-btn');
    if (loanRequestBtn) {
        loanRequestBtn.addEventListener('click', showLoanRequestModal);
    }

    const viewAllLoansBtn = document.getElementById('view-all-loans-btn');
    if (viewAllLoansBtn) {
        viewAllLoansBtn.addEventListener('click', () => { showAllLoansModal(allPendingLoans); });
    }
}