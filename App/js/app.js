// Importaciones de Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateEmail } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, writeBatch, getDocs, arrayUnion, orderBy } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging.js";

// --- CONFIGURACIÓN Y ESTADO ---

const firebaseConfig = {
    apiKey: "AIzaSyC693QE-O4rdx6qPcZRyvgZUwSWDofBFWw",
    authDomain: "vidriosexitoorganizador.firebaseapp.com",
    projectId: "vidriosexitoorganizador",
    storageBucket: "vidriosexitoorganizador.firebasestorage.app",
    messagingSenderId: "872898185887",
    appId: "1:872898185887:web:0a6a8c209527a19c2ff0aa",
    measurementId: "G-DMVHCCV44M"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const messaging = getMessaging(app);

let activeListeners = [];
let currentUser = null;
let currentUserRole = null;
let usersMap = new Map();
let currentProject = null;
let currentItem = null;
let unsubscribeProjects = null;
let unsubscribeItems = null;
let unsubscribeSubItems = null;
let unsubscribeUsers = null;
let itemSortState = { key: 'name', direction: 'asc' };
let currentItemsData = [];

let cachedMunicipalities = []; // Variable para guardar los municipios en caché

// AÑADE ESTA FUNCIÓN AQUÍ
function normalizeString(str) {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}


async function fetchMunicipalities() {
    // Si ya los tenemos, no volvemos a llamar a la API
    if (cachedMunicipalities.length > 0) {
        return cachedMunicipalities;
    }

    try {
        const response = await fetch('https://api-colombia.com/api/v1/City');
        if (!response.ok) {
            throw new Error(`Error de red: ${response.statusText}`);
        }
        const cities = await response.json();
        // Guardamos solo los nombres en nuestra caché y los ordenamos alfabéticamente
        cachedMunicipalities = cities.map(city => city.name).sort();
        return cachedMunicipalities;
    } catch (error) {
        console.error("Error al obtener los municipios:", error);
        // En caso de error, devolvemos una lista vacía para no romper la app
        return [];
    }
}

// --- ELEMENTOS DEL DOM ---

const loadingOverlay = document.getElementById('loading-overlay');
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const loginView = document.getElementById('login-view');
const registerView = document.getElementById('register-view');

const views = {
    proyectos: document.getElementById('dashboard-view'),
    tareas: document.getElementById('tareas-view'),
    herramienta: document.getElementById('herramienta-view'),
    dotacion: document.getElementById('dotacion-view'),
    cartera: document.getElementById('cartera-view'),
    solicitud: document.getElementById('solicitud-view'),
    empleados: document.getElementById('empleados-view'),
    adminPanel: document.getElementById('admin-panel-view'),
    projectDetails: document.getElementById('project-details-view'),
    subItems: document.getElementById('sub-items-view'),
};

// ====================================================================
//      INICIO: FUNCIÓN AÑADIDA PARA CERRAR EL MENÚ LATERAL
// ====================================================================
/**
 * Cierra el menú lateral (sidebar) de forma segura.
 */
function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.add('-translate-x-full');
    }
}
// ====================================================================
//      FIN: FUNCIÓN AÑADIDA
// ====================================================================


// --- MANEJO DE VISTAS ---

function showView(viewName) {
    Object.values(views).forEach(view => view.classList.add('hidden'));
    if (views[viewName]) {
        views[viewName].classList.remove('hidden');
    }
    // Actualizar el enlace activo en la navegación
    document.querySelectorAll('#main-nav .nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.view === viewName);
    });
    // Ocultar el menú lateral en móviles al cambiar de vista
    document.getElementById('sidebar').classList.add('-translate-x-full');
}

// --- AUTENTICACIÓN ---

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists() && userDoc.data().status === 'active') {
            currentUser = user;
            currentUserRole = userDoc.data().role;
            await loadUsersMap();
            authContainer.classList.add('hidden');
            appContainer.classList.remove('hidden');
            document.getElementById('user-info').textContent = `Usuario: ${currentUser.email} (Rol: ${currentUserRole})`;
            showDashboard();
            requestNotificationPermission();
        } else {
            await signOut(auth);
        }
    } else {
        showView('auth-view'); // <--- ESTA ES LA CORRECCIÓN
        currentUser = null;
        currentUserRole = null;
        authContainer.classList.remove('hidden');
        appContainer.classList.add('hidden');
    }
    loadingOverlay.classList.add('hidden');
});

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorP = document.getElementById('login-error');
    errorP.textContent = '';

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists() && userDoc.data().status === 'pending') {
            errorP.textContent = "Solicita autorización al administrador.";
            await signOut(auth);
        }

    } catch (error) {
        console.error("Error de inicio de sesión:", error.code);
        errorP.textContent = "Correo o contraseña incorrectos.";
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const errorP = document.getElementById('register-error');

    if (!document.getElementById('accept-terms').checked) {
        errorP.textContent = 'Debes aceptar el uso de datos personales.';
        return;
    }

    try {
        errorP.textContent = '';
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "users", userCredential.user.uid), {
            firstName: document.getElementById('register-firstName').value,
            lastName: document.getElementById('register-lastName').value,
            idNumber: document.getElementById('register-idNumber').value,
            phone: document.getElementById('register-phone').value,
            address: document.getElementById('register-address').value,
            email: email,
            role: 'employee',
            status: 'pending',
            createdAt: new Date()
        });
        openRegisterSuccessModal();
    } catch (error) {
        console.error("Error de registro:", error.code);
        if (error.code === 'auth/email-already-in-use') {
            errorP.textContent = "Este correo electrónico ya está en uso.";
        } else {
            errorP.textContent = "Error al registrar la cuenta.";
        }
    }
}

async function handleLogout() {
    try {
        // 1. Desconecta todos los listeners de Firestore que estén activos.
        //    (Esto previene el error de permisos).
        activeListeners.forEach(unsubscribe => unsubscribe());
        activeListeners = []; // Limpia el array para la próxima sesión.

        // 2. Cierra la sesión del usuario de forma segura.
        await signOut(auth);
        console.log('Usuario cerró sesión exitosamente');

    } catch (error) {
        console.error('Error al cerrar sesión: ', error);
    }
}

// --- LÓGICA DE DATOS ---
async function loadUsersMap() {
    usersMap.clear();
    const q = query(collection(db, "users"));
    const querySnapshot = await getDocs(q);
    querySnapshot.forEach((doc) => {
        usersMap.set(doc.id, doc.data());
    });
}

// --- LÓGICA DEL DASHBOARD ---
function showDashboard() {
    showView('proyectos'); // Mostrar la vista de proyectos por defecto
    currentProject = null;
    currentItem = null;
    if (unsubscribeItems) unsubscribeItems();
    if (unsubscribeSubItems) unsubscribeSubItems();
    if (unsubscribeUsers) unsubscribeUsers();

    document.getElementById('admin-nav-link').classList.toggle('hidden', currentUserRole !== 'admin');

    if (currentUser) {
        loadProjects();
        if (currentUserRole === 'employee') {
            // loadNotifications(); // Puedes reactivar esto si lo necesitas
        }
    }
}

function loadProjects(status = 'active') {
    const projectsContainer = document.getElementById('projects-container');
    projectsContainer.innerHTML = `<div class="loader-container"><div class="loader"></div></div>`;

    // Actualizar el estado visual de las pestañas
    document.getElementById('active-projects-tab').classList.toggle('active', status === 'active');
    document.getElementById('archived-projects-tab').classList.toggle('active', status === 'archived');

    const q = query(collection(db, "projects"), where("status", "==", status));
    if (unsubscribeProjects) unsubscribeProjects(); // Cancela la suscripción anterior


    unsubscribeProjects = onSnapshot(q, async (querySnapshot) => {
        projectsContainer.innerHTML = '';

        if (querySnapshot.empty) {
            projectsContainer.innerHTML = '<p class="text-gray-500 text-center">No hay proyectos para mostrar.</p>';
            return;
        }

        const projects = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const projectIds = projects.map(p => p.id);

        const progressDataMap = await calculateAllProjectsProgress(projectIds);

        projects.forEach(projectData => {
            const stats = progressDataMap.get(projectData.id) || { totalM2: 0, executedM2: 0, totalItems: 0, executedItems: 0 };
            const progress = stats.totalM2 > 0 ? (stats.executedM2 / stats.totalM2) * 100 : 0;

            const card = createProjectCard(projectData, progress, stats);
            projectsContainer.appendChild(card);
        });

    }, (error) => {
        console.error("Error cargando proyectos: ", error);
        projectsContainer.innerHTML = '<p class="text-red-500 text-center">Error al cargar los proyectos.</p>';
    });
}

async function calculateAllProjectsProgress(projectIds) {
    const progressData = new Map(projectIds.map(id => [id, {
        totalM2: 0, executedM2: 0,
        totalItems: 0, executedItems: 0,
        executedValue: 0 // Nuevo campo para el valor ejecutado
    }]));

    if (projectIds.length === 0) return progressData;

    // 1. Obtener todos los ítems para los proyectos en lotes de 10
    const itemPromises = [];
    for (let i = 0; i < projectIds.length; i += 10) {
        const batchIds = projectIds.slice(i, i + 10);
        itemPromises.push(getDocs(query(collection(db, "items"), where("projectId", "in", batchIds))));
    }
    const itemSnapshots = await Promise.all(itemPromises);

    const allItems = [];
    const allItemIds = [];
    const itemProjectMap = new Map();
    const itemM2Map = new Map();

    itemSnapshots.forEach(snapshot => {
        snapshot.forEach(doc => {
            const item = { id: doc.id, ...doc.data() };
            allItems.push(item);
            allItemIds.push(item.id);
            itemProjectMap.set(item.id, item.projectId);
            itemM2Map.set(item.id, item.width * item.height);

            const projectProgress = progressData.get(item.projectId);
            if (projectProgress) {
                projectProgress.totalM2 += (item.width * item.height) * item.quantity;
                projectProgress.totalItems += item.quantity;
            }
        });
    });

    if (allItemIds.length === 0) return progressData;

    // 2. Obtener todos los sub-ítems ejecutados en lotes de 10
    const subItemPromises = [];
    for (let i = 0; i < allItemIds.length; i += 10) {
        const batchIds = allItemIds.slice(i, i + 10);
        subItemPromises.push(getDocs(query(collection(db, "subItems"), where("itemId", "in", batchIds), where("status", "==", "Instalado"))));
    }
    const subItemSnapshots = await Promise.all(subItemPromises);

    // 3. Calcular los totales ejecutados (sección modificada)
    subItemSnapshots.forEach(snapshot => {
        snapshot.forEach(doc => {
            const subItem = doc.data();
            const projectId = itemProjectMap.get(subItem.itemId);
            const itemM2 = itemM2Map.get(subItem.itemId);
            const projectProgress = progressData.get(projectId);

            if (projectProgress) {
                projectProgress.executedM2 += itemM2;
                projectProgress.executedItems += 1;

                // Nuevo: Calcular valor ejecutado
                const parentItem = allItems.find(item => item.id === subItem.itemId);
                if (parentItem) {
                    const itemTotalValue = calculateItemTotal(parentItem);
                    const subItemValue = itemTotalValue / parentItem.quantity;
                    projectProgress.executedValue += subItemValue;
                }
            }
        });
    });

    return progressData;
}

function createProjectCard(project, progress, stats) {
    const card = document.createElement('div');
    card.className = "bg-white p-6 rounded-lg shadow-lg mb-6 project-card";
    card.dataset.id = project.id;
    card.dataset.name = project.name;

    const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

    const actionButton = project.status === 'active'
        ? `<button data-action="archive" class="text-yellow-600 hover:text-yellow-800 font-semibold py-2 px-4 rounded-lg bg-yellow-100 hover:bg-yellow-200 transition-colors">Archivar</button>`
        : `<button data-action="restore" class="text-green-600 hover:text-green-800 font-semibold py-2 px-4 rounded-lg bg-green-100 hover:bg-green-200 transition-colors">Restaurar</button>`;

    card.innerHTML = `
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <h2 class="text-2xl font-bold text-gray-800">${project.name}</h2>
                        <p class="text-sm text-gray-500 font-semibold">${project.builderName || 'Constructora no especificada'}</p>
                        <p class="text-sm text-gray-500">${project.location} - ${project.address}</p>
                    </div>
                    <div class="flex items-center space-x-2">
                        <button data-action="view-details" class="text-blue-600 hover:text-blue-800 font-semibold py-2 px-4 rounded-lg bg-blue-100 hover:bg-blue-200 transition-colors">Ver Detalles</button>

                        ${project.status === 'active'
            ? `<button data-action="archive" class="text-yellow-600 hover:text-yellow-800 font-semibold py-2 px-4 rounded-lg bg-yellow-100 hover:bg-yellow-200 transition-colors">Archivar</button>`
            : `<button data-action="restore" class="text-green-600 hover:text-green-800 font-semibold py-2 px-4 rounded-lg bg-green-100 hover:bg-green-200 transition-colors">Restaurar</button>`}
                        
                        ${currentUserRole === 'admin' ? `<button data-action="delete" class="text-red-600 hover:text-red-800 font-semibold py-2 px-4 rounded-lg bg-red-100 hover:bg-red-200 transition-colors">Eliminar</button>` : ''}
                    </div>
                </div>
                <div class="mb-4">
                    <div class="flex justify-between mb-1">
                        <span class="text-sm font-medium text-gray-600">Progreso General</span>
                        <span class="text-sm font-bold text-blue-600">${progress.toFixed(2)}%</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-4">
                        <div class="bg-blue-600 h-4 rounded-full transition-all duration-500" style="width: ${progress.toFixed(2)}%"></div>
                    </div>
                </div>
                <div class="border-t border-gray-200 pt-4 mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="text-center">
                        <p class="text-sm text-gray-500">Valor Contrato</p>
                        <p class="text-xl font-bold">${currencyFormatter.format(project.value || 0)}</p>
                    </div>
                    <div class="text-center">
                        <p class="text-sm text-gray-500">Valor Ejecutado</p>
                        <p class="text-xl font-bold text-green-600">${currencyFormatter.format(stats.executedValue || 0)}</p>
                    </div>
                    <div class="text-left text-sm">
                        <p><span class="font-semibold">Ítems Instalados:</span> ${stats.executedItems} / ${stats.totalItems}</p>
                        <p><span class="font-semibold">M² Ejecutados:</span> ${stats.executedM2.toFixed(2)} / ${stats.totalM2.toFixed(2)}</p>
                    </div>
                    <div class="text-left text-sm">
                        <p><span class="font-semibold">Inicio Contrato:</span> ${project.startDate ? new Date(project.startDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A'}</p>
                        <p><span class="font-semibold">Fin Contrato:</span> ${project.endDate ? new Date(project.endDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A'}</p>
                    </div>
                </div>
            `;
    return card;
}

async function createProject(projectData) {
    await addDoc(collection(db, "projects"), {
        ...projectData,
        ownerId: currentUser.uid,
        createdAt: new Date()
    });
}

async function deleteProject(projectId) {
    const batch = writeBatch(db);
    const subItemsQuery = query(collection(db, "subItems"), where("projectId", "==", projectId));
    const subItemsSnapshot = await getDocs(subItemsQuery);
    subItemsSnapshot.forEach(doc => batch.delete(doc.ref));
    const itemsQuery = query(collection(db, "items"), where("projectId", "==", projectId));
    const itemsSnapshot = await getDocs(itemsQuery);
    itemsSnapshot.forEach(doc => batch.delete(doc.ref));
    batch.delete(doc(db, "projects", projectId));
    await batch.commit();
}

async function archiveProject(projectId) {
    await updateDoc(doc(db, "projects", projectId), { status: 'archived' });
}

async function restoreProject(projectId) {
    await updateDoc(doc(db, "projects", projectId), { status: 'active' });
}

// --- PANEL DE ADMINISTRACIÓN ---
function loadUsers(filter) {
    const loadingDiv = document.getElementById('loading-users');
    const usersTableBody = document.getElementById('users-table-body');
    loadingDiv.classList.remove('hidden');
    usersTableBody.innerHTML = '';

    document.getElementById('active-users-tab').classList.toggle('active', filter === 'active');
    document.getElementById('archived-users-tab').classList.toggle('active', filter === 'archived');

    const q = query(collection(db, "users"));
    unsubscribeUsers = onSnapshot(q, (querySnapshot) => {
        loadingDiv.classList.add('hidden');
        usersTableBody.innerHTML = '';

        querySnapshot.forEach(doc => {
            const userData = { id: doc.id, ...doc.data() };
            const isActiveOrPending = userData.status === 'active' || userData.status === 'pending';

            if (userData.id !== currentUser.uid) {
                if (filter === 'active' && isActiveOrPending) {
                    usersTableBody.appendChild(createUserRow(userData));
                } else if (filter === 'archived' && userData.status === 'archived') {
                    usersTableBody.appendChild(createUserRow(userData));
                }
            }
        });
    });
}

function createUserRow(user) {
    const row = document.createElement('tr');
    row.className = 'bg-white border-b';

    const statusColor = user.status === 'active' ? 'text-green-600' : (user.status === 'pending' ? 'text-yellow-600' : 'text-gray-500');
    const statusText = user.status === 'active' ? 'Activo' : (user.status === 'pending' ? 'Pendiente' : 'Archivado');

    let actionsHtml = '';
    if (user.status === 'archived') {
        actionsHtml = `
            <button class="restore-user-btn text-green-600 hover:underline font-semibold">Restaurar</button>
            <button class="delete-user-btn text-red-600 hover:underline font-semibold">Eliminar</button>
        `;
    } else {
        actionsHtml = `
            <button class="edit-user-btn text-yellow-600 hover:underline font-semibold">Editar</button>
            <button class="archive-user-btn text-gray-600 hover:underline font-semibold">Archivar</button>
            <button class="toggle-status-btn bg-blue-500 text-white px-3 py-1 rounded-md text-sm" data-status="${user.status}">
                ${user.status === 'active' ? 'Desactivar' : 'Activar'}
            </button>
        `;
    }

    row.innerHTML = `
   
        <td class="px-6 py-4 font-medium text-gray-900" data-label="Nombre">${user.firstName} ${user.lastName}</td>
        <td class="px-6 py-4" data-label="Correo">${user.email}</td>
        <td class="px-6 py-4" data-label="Rol">
            <select class="user-role-select border rounded-md p-1" data-userid="${user.id}">
                <option value="employee" ${user.role === 'employee' ? 'selected' : ''}>Empleado</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option>
            </select>
        </td>
        <td class="px-6 py-4 font-semibold ${statusColor}" data-label="Estado">${statusText}</td>
        <td class="px-6 py-4 text-center" data-label="Acciones">
            <div class="flex justify-center gap-2">
                ${actionsHtml}
            </div>
        </td>
    `;

    row.querySelector('.user-role-select').addEventListener('change', (e) => {
        updateUserRole(user.id, e.target.value);
    });

    if (user.status !== 'archived') {
        row.querySelector('.toggle-status-btn').addEventListener('click', (e) => {
            const newStatus = e.target.dataset.status === 'active' ? 'pending' : 'active';
            updateUserStatus(user.id, newStatus);
        }); openMainModal
        row.querySelector('.edit-user-btn').addEventListener('click', () => openMainModal('editUser', user));
        row.querySelector('.archive-user-btn').addEventListener('click', () => {
            openConfirmModal(`¿Seguro que quieres archivar al usuario ${user.email}?`, () => updateUserStatus(user.id, 'archived'));
        });
    } else {
        row.querySelector('.restore-user-btn').addEventListener('click', () => {
            openConfirmModal(`¿Seguro que quieres restaurar al usuario ${user.email}?`, () => updateUserStatus(user.id, 'pending'));
        });
        row.querySelector('.delete-user-btn').addEventListener('click', () => {
            openConfirmModal(`¿Seguro que quieres ELIMINAR PERMANENTEMENTE al usuario ${user.email}? Esta acción no se puede deshacer.`, () => deleteUser(user.id));
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
    console.warn(`Usuario ${uid} eliminado de Firestore. Se requiere una Cloud Function para eliminarlo de Authentication.`);
}

/**
 * Configura el menú desplegable para la vista móvil y lo sincroniza.
 */
function setupResponsiveTabs() {
    const desktopButtons = document.querySelectorAll('#project-details-tabs .tab-button');
    const dropdownMenuContainer = document.getElementById('dropdown-menu-items');

    if (!dropdownMenuContainer || !desktopButtons.length) return;

    // Llena el menú con las opciones basadas en los botones de escritorio.
    dropdownMenuContainer.innerHTML = '';
    desktopButtons.forEach(button => {
        const menuItem = document.createElement('a');
        menuItem.href = '#';
        menuItem.dataset.tab = button.dataset.tab;
        menuItem.textContent = button.textContent;
        // Estas clases son de TailwindCSS para dar estilo a cada opción del menú
        menuItem.className = 'block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100';
        dropdownMenuContainer.appendChild(menuItem);
    });
}


/**
 * Sincroniza el estado visual de los botones y el texto del menú desplegable.
 * @param {string} tabName - El nombre de la pestaña activa.
 */
function syncTabsState(tabName) {
    const dropdownButtonText = document.getElementById('dropdown-btn-text');
    let activeTabText = '';

    // Sincroniza los botones de escritorio
    document.querySelectorAll('#project-details-tabs .tab-button').forEach(button => {
        const isActive = button.dataset.tab === tabName;
        button.classList.toggle('active', isActive);
        if (isActive) {
            // Guarda el texto de la pestaña activa para ponerlo en el botón móvil
            activeTabText = button.textContent;
        }
    });

    // Actualiza el texto del botón del menú desplegable
    if (dropdownButtonText) {
        dropdownButtonText.textContent = activeTabText;
    }
}


/**
 * Cambia la vista de la pestaña activa.
 * @param {string} tabName - El nombre de la pestaña a mostrar.
 */
function switchProjectTab(tabName) {
    // Oculta todos los contenidos
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });

    // Muestra el contenido de la pestaña seleccionada
    const activeContent = document.getElementById(`${tabName}-content`);
    if (activeContent) {
        activeContent.classList.remove('hidden');
    }

    // Sincroniza el estado visual de los botones y el menú
    syncTabsState(tabName);
}

// --- LÓGICA DE DETALLES DEL PROYECTO ---
async function showProjectDetails(project) {
    currentProject = project;
    showView('projectDetails');
    setupResponsiveTabs();


    // Llenar datos de la cabecera
    document.getElementById('project-details-name').textContent = project.name;
    document.getElementById('project-details-builder').textContent = project.builderName || 'Constructora no especificada';

    // --- Llenar datos de la pestaña "Información General" ---
    const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
    document.getElementById('project-details-value').textContent = currencyFormatter.format(project.value || 0);
    document.getElementById('project-details-advance').textContent = currencyFormatter.format(project.advance || 0);
    document.getElementById('project-details-startDate').textContent = project.startDate ? new Date(project.startDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A';

    // Lógica para fechas editables
    const kickoffInput = document.getElementById('project-kickoffDate');
    const endInput = document.getElementById('project-endDate');
    kickoffInput.value = project.kickoffDate || '';
    endInput.value = project.endDate || '';
    // ... (resto de la lógica para el botón de guardar fechas)

    // --- CALCULAR Y MOSTRAR MÉTRICAS DE AVANCE ---
    // Limpiar métricas anteriores
    document.getElementById('project-details-executedValue').textContent = 'Calculando...';
    document.getElementById('project-details-installedItems').textContent = 'Calculando...';
    document.getElementById('project-details-executedM2').textContent = 'Calculando...';

    // Volver a calcular las estadísticas para este proyecto específico
    const statsMap = await calculateAllProjectsProgress([project.id]);
    const stats = statsMap.get(project.id) || { executedValue: 0, executedItems: 0, totalItems: 0, executedM2: 0, totalM2: 0 };

    document.getElementById('project-details-executedValue').textContent = currencyFormatter.format(stats.executedValue);
    document.getElementById('project-details-installedItems').textContent = `${stats.executedItems} / ${stats.totalItems}`;
    document.getElementById('project-details-executedM2').textContent = `${stats.executedM2.toFixed(2)}m² / ${stats.totalM2.toFixed(2)}m²`;

    // --- Cargar datos para las otras pestañas ---
    renderInteractiveDocumentCards(project.id); // <--- Llama a la nueva función
    loadItems(project.id);


    // Activar la primera pestaña por defecto
    switchProjectTab('info-general');
}

function calculateItemUnitPrice(item) {
    let unitPrice = 0;
    if (item.itemType === 'supply_only' || item.itemType === 'supply_install') {
        // El ?. es un operador opcional para evitar errores si 'supplyDetails' no existe
        unitPrice += item.supplyDetails?.unitPrice || 0;
    }
    if (item.itemType === 'install_only' || item.itemType === 'supply_install') {
        unitPrice += item.installationDetails?.unitPrice || 0;
    }
    return unitPrice;
}

function calculateItemTotal(item) {
    let total = 0;

    // Función auxiliar para calcular el valor de una parte (suministro o instalación)
    const calculatePartTotal = (details) => {
        if (!details || !details.unitPrice) {
            return 0;
        }
        const subtotal = details.unitPrice * item.quantity;
        if (details.taxType === 'aiu') {
            const admin = subtotal * (details.aiuA / 100 || 0);
            const imprev = subtotal * (details.aiuI / 100 || 0);
            const utilidad = subtotal * (details.aiuU / 100 || 0);
            const ivaSobreUtilidad = utilidad * 0.19;
            return subtotal + admin + imprev + utilidad + ivaSobreUtilidad;
        } else if (details.taxType === 'iva') {
            return subtotal * 1.19;
        }
        return subtotal;
    };

    if (item.itemType === 'supply_only' || item.itemType === 'supply_install') {
        total += calculatePartTotal(item.supplyDetails);
    }
    if (item.itemType === 'install_only' || item.itemType === 'supply_install') {
        total += calculatePartTotal(item.installationDetails);
    }

    return total;
}

function loadItems(projectId) {
    const itemsTableBody = document.getElementById('items-table-body');
    if (!itemsTableBody) return; // Verificación para evitar errores

    // Muestra un indicador de carga directamente en la tabla
    itemsTableBody.innerHTML = `<tr><td colspan="8" class="text-center py-10"><div class="loader mx-auto"></div><p class="mt-2 text-sm text-gray-500">Cargando ítems...</p></td></tr>`;

    const q = query(collection(db, "items"), where("projectId", "==", projectId));

    // Cancela la suscripción anterior para evitar listeners duplicados
    if (unsubscribeItems) unsubscribeItems();

    unsubscribeItems = onSnapshot(q, async (querySnapshot) => {

        if (querySnapshot.empty) {
            currentItemsData = [];
            renderSortedItems(); // renderSortedItems mostrará el mensaje "No hay ítems"
            return;
        }

        const items = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const itemIds = items.map(item => item.id);

        const executedCounts = new Map(itemIds.map(id => [id, 0]));
        if (itemIds.length > 0) {
            const subItemPromises = [];
            for (let i = 0; i < itemIds.length; i += 10) {
                const batchIds = itemIds.slice(i, i + 10);
                subItemPromises.push(
                    getDocs(query(collection(db, "subItems"), where("itemId", "in", batchIds), where("status", "==", "Instalado")))
                );
            }
            const subItemSnapshots = await Promise.all(subItemPromises);
            subItemSnapshots.forEach(snapshot => {
                snapshot.forEach(doc => {
                    const subItem = doc.data();
                    executedCounts.set(subItem.itemId, (executedCounts.get(subItem.itemId) || 0) + 1);
                });
            });
        }

        currentItemsData = items.map(itemData => {
            const executedCount = executedCounts.get(itemData.id) || 0;
            itemData.executedCount = executedCount;
            const percentage = itemData.quantity > 0 ? (executedCount / itemData.quantity) : 0;

            if (percentage === 0) {
                itemData.status = 'Pendiente';
            } else if (percentage < 1) {
                itemData.status = 'En Proceso';
            } else {
                itemData.status = 'Instalado';
            }
            return itemData;
        });

        renderSortedItems();
    });
}

function renderSortedItems() {
    const itemsTableBody = document.getElementById('items-table-body');
    itemsTableBody.innerHTML = '';

    if (currentItemsData.length === 0) {
        itemsTableBody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-gray-500">No hay ítems.</td></tr>`;
        return;
    }

    // Lógica de Ordenamiento
    currentItemsData.sort((a, b) => {
        const key = itemSortState.key;
        const dir = itemSortState.direction === 'asc' ? 1 : -1;
        if (a[key] < b[key]) return -1 * dir;
        if (a[key] > b[key]) return 1 * dir;
        return 0;
    });

    // Renderizado
    currentItemsData.forEach(itemData => {
        const row = createItemRow(itemData, itemData.executedCount);
        itemsTableBody.appendChild(row);
    });

    // Actualizar indicadores de ordenamiento
    document.querySelectorAll('.sortable-header').forEach(header => {
        const indicator = header.querySelector('.sort-indicator');
        if (header.dataset.sort === itemSortState.key) {
            indicator.textContent = itemSortState.direction === 'asc' ? '↑' : '↓';
            indicator.style.opacity = '1';
        } else {
            indicator.textContent = '';
            indicator.style.opacity = '0.5';
        }
    });
}

function createItemRow(item, executedCount) {
    const row = document.createElement('tr');
    row.className = 'bg-white border-b hover:bg-gray-50';
    row.dataset.id = item.id;

    // Usamos las nuevas funciones para obtener los valores correctos
    const unitPrice = calculateItemUnitPrice(item);
    const totalValue = calculateItemTotal(item);
    const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

    let statusColor;
    if (item.status === 'Pendiente') { statusColor = 'bg-red-100 text-red-800'; }
    else if (item.status === 'En Proceso') { statusColor = 'bg-yellow-100 text-yellow-800'; }
    else { statusColor = 'bg-green-100 text-green-800'; }

    row.innerHTML = `
            <td class="px-6 py-4 font-medium text-gray-900" data-label="Objeto">${item.name}</td>
        <td class="px-6 py-4 text-center" data-label="Cant.">${item.quantity}</td>
        <td class="px-6 py-4 text-center" data-label="Ancho (m)">${item.width}</td>
        <td class="px-6 py-4 text-center" data-label="Alto (m)">${item.height}</td>
        <td class="px-6 py-4 text-center" data-label="Vlr. Unitario">${currencyFormatter.format(unitPrice)}</td>
        <td class="px-6 py-4 text-center font-semibold" data-label="Vlr. Total">${currencyFormatter.format(totalValue)}</td>
                <td class="px-6 py-4 text-center" data-label="Estado"><span class="text-xs font-medium mr-2 px-2.5 py-0.5 rounded-full ${statusColor}">${item.status}</span></td>
                <td class="px-6 py-4 text-center" data-label="Acciones">
                    <div class="flex justify-center items-center gap-4">
                        <button data-action="view-item-details" class="text-blue-600 hover:underline font-semibold">Ver</button>
                        ${currentUserRole === 'admin' ? `
                        <button data-action="edit-item" class="text-yellow-600 hover:underline font-semibold">Editar</button>
                        <button data-action="delete-item" class="text-red-600 hover:underline font-semibold">Eliminar</button>
                        ` : ''}
                    </div>
                </td>`;

    return row;
}

async function createItem(data) {
    const newItem = {
        name: data.name,
        quantity: parseInt(data.quantity),
        width: parseFloat(data.width),
        height: parseFloat(data.height),
        itemType: data.itemType,
        supplyDetails: {
            unitPrice: parseFloat(data.supply_unitPrice?.replace(/[$. ]/g, '')) || 0,
            taxType: data.supply_taxType || 'none',
            aiuA: parseFloat(data.supply_aiuA) || 0,
            aiuI: parseFloat(data.supply_aiuI) || 0,
            aiuU: parseFloat(data.supply_aiuU) || 0
        },
        installationDetails: {
            unitPrice: parseFloat(data.installation_unitPrice?.replace(/[$. ]/g, '')) || 0,
            taxType: data.installation_taxType || 'none',
            aiuA: parseFloat(data.installation_aiuA) || 0,
            aiuI: parseFloat(data.installation_aiuI) || 0,
            aiuU: parseFloat(data.installation_aiuU) || 0
        },
        projectId: currentProject.id,
        ownerId: currentUser.uid,
        createdAt: new Date()
    };

    const itemRef = await addDoc(collection(db, "items"), newItem);

    const batch = writeBatch(db);
    for (let i = 1; i <= newItem.quantity; i++) {
        const subItemRef = doc(collection(db, "subItems"));
        batch.set(subItemRef, {
            itemId: itemRef.id,
            projectId: currentProject.id,
            number: i,
            status: 'Pendiente de Fabricación',
            location: '', manufacturer: '', installer: '', installDate: '', photoURL: ''
        });
    }
    await batch.commit();

    closeMainModal();
}

async function updateItem(itemId, data) {
    // This object now correctly structures the data from the form
    const updatedData = {
        name: data.name,
        // The quantity is read-only, so we don't update it
        width: parseFloat(data.width),
        height: parseFloat(data.height),
        itemType: data.itemType,
        supplyDetails: {
            unitPrice: parseFloat(data.supply_unitPrice?.replace(/[$. ]/g, '')) || 0,
            taxType: data.supply_taxType || 'none',
            aiuA: parseFloat(data.supply_aiuA) || 0,
            aiuI: parseFloat(data.supply_aiuI) || 0,
            aiuU: parseFloat(data.supply_aiuU) || 0
        },
        installationDetails: {
            unitPrice: parseFloat(data.installation_unitPrice?.replace(/[$. ]/g, '')) || 0,
            taxType: data.installation_taxType || 'none',
            aiuA: parseFloat(data.installation_aiuA) || 0,
            aiuI: parseFloat(data.installation_aiuI) || 0,
            aiuU: parseFloat(data.installation_aiuU) || 0
        }
    };

    await updateDoc(doc(db, "items", itemId), updatedData);
    closeMainModal();
}

async function deleteItem(itemId) {
    const batch = writeBatch(db);
    const subItemsQuery = query(collection(db, "subItems"), where("itemId", "==", itemId));
    const subItemsSnapshot = await getDocs(subItemsQuery);
    subItemsSnapshot.forEach(doc => batch.delete(doc.ref));
    batch.delete(doc(db, "items", itemId));
    await batch.commit();
}

// --- LÓGICA DE SUB-ÍTEMS ---
function showSubItems(item) {
    currentItem = item;

    // Oculta la vista de detalles del proyecto y muestra la de sub-ítems
    showView('subItems');

    document.getElementById('item-name-header').textContent = `Detalle de: ${item.name}`;
    document.getElementById('item-summary-header').textContent = `Total de ${item.quantity} unidades.`;

    loadSubItems(item.id);
}

async function openDocumentsModal(project) {
    document.getElementById('documents-modal-title').textContent = `Documentos de: ${project.name}`;
    loadProjectDocuments(project.id);
    document.getElementById('documents-modal').style.display = 'flex';
}

function closeDocumentsModal() {
    document.getElementById('documents-modal').style.display = 'none';
}

let currentProjectDocs = new Map(); // Caché para los documentos del proyecto actual

/**
 * Revisa si el dispositivo es considerado móvil basado en el ancho de la pantalla.
 * @returns {boolean} - Devuelve true si es móvil, false si es escritorio.
 */
function isMobileDevice() {
    return window.innerWidth <= 768;
}

/**
 * Abre un documento, ya sea en un modal (escritorio) or en una nueva pestaña (móvil).
 * @param {string} url - La URL del documento a mostrar.
 * @param {string} name - El nombre del documento para mostrarlo en el título.
 */
function viewDocument(url, name = 'Documento') {
    if (isMobileDevice()) {
        // En móvil, abre una nueva pestaña.
        window.open(url, '_blank');
    } else {
        // En escritorio, abre el modal.
        const modal = document.getElementById('document-display-modal');
        const iframe = document.getElementById('document-iframe');
        const title = document.getElementById('document-display-title');

        iframe.src = url;
        title.textContent = name;
        modal.style.display = 'flex';
    }
}

function openDocumentViewerModal(docType, docs) {
    const modal = document.getElementById('document-viewer-modal');
    const title = document.getElementById('document-viewer-title');
    const list = document.getElementById('document-viewer-list');

    title.textContent = `Documentos: ${docType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}`;
    list.innerHTML = '';

    if (!docs || docs.length === 0) {
        list.innerHTML = '<p class="text-gray-500 text-center py-8">No hay documentos disponibles para esta categoría.</p>';
    } else {
        let tableHTML = '<div class="space-y-2">';
        docs.forEach(docData => {
            const isPdf = docData.url.toLowerCase().includes('.pdf');
            const iconSVG = isPdf
                ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>`
                : `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>`;

            tableHTML += `
                <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div class="flex items-center space-x-3 flex-grow truncate">
                        <div class="flex-shrink-0">${iconSVG}</div>
                        <span class="text-gray-800 font-medium truncate" title="${docData.name}">${docData.name}</span>
                    </div>
                    <div class="flex items-center space-x-4 flex-shrink-0 ml-4">
                        <button data-action="view-doc" data-url="${docData.url}" data-name="${docData.name}" class="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-2 px-4 rounded-lg transition-colors">Ver</button>
                        <button data-action="delete-doc" data-doc-id="${docData.id}" data-doc-name="${docData.name}" class="bg-red-500 hover:bg-red-600 text-white text-xs font-bold py-2 px-4 rounded-lg transition-colors">Eliminar</button>
                    </div>
                </div>
            `;
        });
        tableHTML += '</div>';
        list.innerHTML = tableHTML;
    }
    modal.style.display = 'flex';
}

function closeDocumentViewerModal() {
    document.getElementById('document-viewer-modal').style.display = 'none';
}

async function uploadProjectDocument(projectId, file, docType) {
    if (!file) return;
    const timestamp = new Date().getTime();
    const fileName = `${timestamp}_${file.name}`;
    const storageRef = ref(storage, `project_documents/${projectId}/${docType}/${fileName}`);

    try {
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        await addDoc(collection(db, "projects", projectId, "documents"), {
            name: file.name,
            url: downloadURL,
            type: docType,
            uploadedAt: new Date()
        });
        loadProjectDocuments(projectId); // Recargar la lista
    } catch (error) {
        console.error("Error al subir el documento:", error);
        alert("Error al subir el documento.");
    }
}

async function deleteProjectDocument(projectId, docId) {
    console.log(`Iniciando eliminación. Proyecto ID: ${projectId}, Documento ID: ${docId}`);

    // Verificación de seguridad para asegurar que tenemos los datos necesarios
    if (!projectId || !docId) {
        console.error("Error: Faltan el ID del proyecto o del documento para eliminar.");
        alert("Error: No se pudo obtener la información necesaria para la eliminación.");
        return;
    }

    try {
        const docRef = doc(db, "projects", projectId, "documents", docId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            console.log("Documento encontrado en Firestore. Procediendo a eliminar de Storage...");
            const fileUrl = docSnap.data().url;

            // 1. Borrar el archivo físico de Firebase Storage
            const fileStorageRef = ref(storage, fileUrl);
            await deleteObject(fileStorageRef);
            console.log("Archivo eliminado de Storage con éxito.");

            // 2. Borrar el registro de la base de datos de Firestore
            await deleteDoc(docRef);
            console.log("Documento eliminado de Firestore con éxito.");

            // No es necesario un 'alert' de éxito porque la lista se actualizará sola, 
            // pero cerramos el visor de documentos para mostrar el cambio.
            closeDocumentViewerModal();

        } else {
            console.error("Error: El documento con ID", docId, "no fue encontrado en la base de datos.");
            alert("Error: No se pudo encontrar el registro del documento para eliminarlo.");
        }
    } catch (error) {
        console.error("ERROR COMPLETO al eliminar el documento:", error);

        // Mensaje de error más útil para el usuario
        if (error.code === 'storage/object-not-found') {
            alert("Error: El archivo ya no existe en el almacenamiento, pero el registro sí. Eliminando solo el registro...");
            // Si el archivo no existe pero el registro sí, eliminamos el registro para limpiar.
            await deleteDoc(doc(db, "projects", projectId, "documents", docId));
        } else if (error.code === 'storage/unauthorized') {
            alert("Error de permisos. No tienes autorización para eliminar este archivo. Contacta al administrador.");
        } else {
            alert("Ocurrió un error inesperado al eliminar el documento. Revisa la consola para más detalles.");
        }
    }
}

/**
 * Sube un archivo a Firebase Storage y guarda su URL en Firestore.
 * @param {string} proyectoId - El ID del proyecto al que pertenece el documento.
 * @param {File} file - El archivo que el usuario ha seleccionado.
 * @param {string} tipo - El tipo de documento (ej: 'cedula', 'contrato').
 */
function subirDocumento(proyectoId, file, tipo) {
    // 1. Define la ruta donde se guardará el archivo en Firebase Storage.
    // Esto crea una ruta organizada, ej: "proyectos/ID_DEL_PROYECTO/cedula/nombre_del_archivo.pdf"
    const filePath = `proyectos/${proyectoId}/${tipo}/${file.name}`;
    const fileRef = ref(storage, filePath);

    // 2. Inicia la tarea de subida del archivo.
    // Usamos uploadBytes que es la función moderna en v9+
    uploadBytes(fileRef, file).then((snapshot) => {

        console.log(`¡Archivo '${tipo}' subido con éxito!`);

        // 3. Una vez subido, obtenemos la URL pública de descarga.
        getDownloadURL(snapshot.ref).then((downloadURL) => {

            // 4. Preparamos el objeto para actualizar la base de datos.
            // Usamos la notación de punto para actualizar un campo dentro de un objeto.
            // Ej: { 'documentos.cedula': 'url_del_archivo' }
            const updateData = {};
            updateData[`documentos.${tipo}`] = downloadURL;

            // 5. Actualizamos el documento del proyecto en Firestore con la nueva URL.
            const projectDocRef = doc(db, "projects", projectId);
            updateDoc(projectDocRef, updateData)
                .then(() => {
                    console.log("Referencia del documento guardada en Firestore.");
                    // La vista se actualizará automáticamente gracias a onSnapshot.
                })
                .catch(error => {
                    console.error("Error al guardar la URL en Firestore:", error);
                    alert("Error al guardar la referencia del documento.");
                });
        });

    }).catch((error) => {
        // Manejo de errores durante la subida del archivo.
        console.error("Error al subir el archivo a Storage:", error);
        alert("Hubo un error al subir el documento.");
    });
}

function setupDocumentos(proyectoId, documentosDelProyecto) {
    const container = document.getElementById('document-cards-container');
    if (!container) return;

    container.innerHTML = '';

    const documentosRequeridos = [
        { id: 'cedula', nombre: 'Cédula', descripcion: 'Documento de identidad.' },
        { id: 'contrato', nombre: 'Contrato', descripcion: 'Contrato de servicio firmado.' }
    ];

    let cardsHTML = '';
    documentosRequeridos.forEach(docInfo => {
        const docExiste = documentosDelProyecto && documentosDelProyecto[docInfo.id];
        const docURL = docExiste ? documentosDelProyecto[docInfo.id] : '#';

        cardsHTML += `
            <div id="card-${docInfo.id}" data-tipo="${docInfo.id}" 
                 class="bg-gray-100 p-4 rounded-lg shadow ${!docExiste ? 'cursor-pointer hover:bg-gray-200' : ''}">
                <h4 class="font-bold text-gray-700">${docInfo.nombre}</h4>
                <p class="text-sm text-gray-600 mb-2">${docInfo.descripcion}</p>
                ${docExiste
                ? `<a href="${docURL}" target="_blank" class="font-bold text-blue-600 hover:underline">Ver Documento</a>`
                : '<span class="text-sm text-blue-500">Haz clic para subir</span>'
            }
                <input type="file" id="file-input-${docInfo.id}" class="hidden" accept="application/pdf,image/*">
            </div>
        `;
    });
    container.innerHTML = cardsHTML;

    documentosRequeridos.forEach(docInfo => {
        const docExiste = documentosDelProyecto && documentosDelProyecto[docInfo.id];
        if (!docExiste) {
            const card = document.getElementById(`card-${docInfo.id}`);
            const fileInput = document.getElementById(`file-input-${docInfo.id}`);
            if (card && fileInput) {
                card.onclick = () => fileInput.click();
                fileInput.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        card.querySelector('span').textContent = 'Subiendo...';
                        subirDocumento(proyectoId, file, docInfo.id);
                    }
                };
            }
        }
    });
}

let unsubscribeOtroSi = null;

function openOtroSiModal() {
    const modal = document.getElementById('otro-si-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.getElementById('otro-si-form').reset();
        loadOtroSiList(currentProject.id);
    }
}

function closeOtroSiModal() {
    const modal = document.getElementById('otro-si-modal');
    if (modal) {
        modal.style.display = 'none';
        if (unsubscribeOtroSi) unsubscribeOtroSi();
    }
}

async function handleOtroSiSubmit(e) {
    e.preventDefault();
    const concept = document.getElementById('otro-si-concept').value;
    const file = document.getElementById('otro-si-file').files[0];
    const submitBtn = document.getElementById('otro-si-submit-btn');

    if (!concept || !file) {
        alert("Por favor, completa el concepto y selecciona un archivo.");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';

    try {
        const filePath = `projects/${currentProject.id}/otrosSi/${Date.now()}_${file.name}`;
        const fileRef = ref(storage, filePath);
        const snapshot = await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        const otroSiCollection = collection(db, "projects", currentProject.id, "otrosSi");
        await addDoc(otroSiCollection, {
            concept: concept,
            fileURL: downloadURL,
            fileName: file.name,
            createdAt: new Date()
        });

        document.getElementById('otro-si-form').reset();
    } catch (error) {
        console.error("Error al guardar el 'Otro Sí':", error);
        alert("Ocurrió un error al guardar.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Guardar Otro Sí';
    }
}

function loadOtroSiList(projectId) {
    const listContainer = document.getElementById('otro-si-list-container');
    const q = query(collection(db, "projects", projectId, "otrosSi"), orderBy("createdAt", "desc"));

    if (unsubscribeOtroSi) unsubscribeOtroSi();

    unsubscribeOtroSi = onSnapshot(q, (snapshot) => {
        if (!listContainer) return;
        listContainer.innerHTML = '';
        if (snapshot.empty) {
            listContainer.innerHTML = '<p class="text-gray-500 text-center">No se han añadido otrosí al contrato.</p>';
            return;
        }
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            const item = document.createElement('div');
            item.className = 'p-3 bg-gray-50 rounded-lg border flex justify-between items-start';
            item.innerHTML = `
                <div class="flex-grow pr-4">
                    <p class="text-sm text-gray-800 font-semibold">${data.concept}</p>
                    <a href="${data.fileURL}" target="_blank" class="text-xs text-blue-600 hover:underline truncate">Ver Archivo: ${data.fileName}</a>
                </div>
                <button data-action="delete-otro-si" data-id="${data.id}" class="text-red-500 hover:text-red-700 text-xs font-semibold">Eliminar</button>
            `;
            listContainer.appendChild(item);
        });
    });
}

async function deleteOtroSi(otroSiId) {
    try {
        const docRef = doc(db, "projects", currentProject.id, "otrosSi", otroSiId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const fileURL = docSnap.data().fileURL;
            if (fileURL) {
                const fileRef = ref(storage, fileURL);
                await deleteObject(fileRef);
            }
            await deleteDoc(docRef);
        }
    } catch (error) {
        console.error("Error al eliminar 'Otro Sí':", error);
        alert("No se pudo eliminar el registro.");
    }
}

// ====================================================================
//      INICIO: FUNCIONES PARA GESTIONAR "VARIOS"
// ====================================================================
let unsubscribeVarios = null;

function openVariosModal() {
    document.getElementById('varios-modal').style.display = 'flex';
    document.getElementById('varios-form').reset();
    loadVariosList(currentProject.id);
}

function closeVariosModal() {
    document.getElementById('varios-modal').style.display = 'none';
    if (unsubscribeVarios) unsubscribeVarios();
}

async function handleVariosSubmit(e) {
    e.preventDefault();
    const concept = document.getElementById('varios-concept').value;
    const file = document.getElementById('varios-file').files[0];
    const submitBtn = document.getElementById('varios-submit-btn');

    if (!concept || !file) {
        alert("Por favor, completa el concepto y selecciona un archivo.");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';

    try {
        const filePath = `projects/${currentProject.id}/varios/${Date.now()}_${file.name}`;
        const fileRef = ref(storage, filePath);
        const snapshot = await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        const variosCollection = collection(db, "projects", currentProject.id, "varios");
        await addDoc(variosCollection, {
            concept: concept,
            fileURL: downloadURL,
            fileName: file.name,
            createdAt: new Date()
        });

        document.getElementById('varios-form').reset();
    } catch (error) {
        console.error("Error al guardar el documento 'Varios':", error);
        alert("Ocurrió un error al guardar.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Guardar Documento';
    }
}

function loadVariosList(projectId) {
    const listContainer = document.getElementById('varios-list-container');
    const q = query(collection(db, "projects", projectId, "varios"), orderBy("createdAt", "desc"));

    if (unsubscribeVarios) unsubscribeVarios();

    unsubscribeVarios = onSnapshot(q, (snapshot) => {
        if (!listContainer) return;
        listContainer.innerHTML = '';
        if (snapshot.empty) {
            listContainer.innerHTML = '<p class="text-gray-500 text-center">No se han añadido documentos varios.</p>';
            return;
        }
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            const item = document.createElement('div');
            item.className = 'p-3 bg-gray-50 rounded-lg border flex justify-between items-start';
            item.innerHTML = `
                <div class="flex-grow pr-4">
                    <p class="text-sm text-gray-800 font-semibold">${data.concept}</p>
                    <a href="${data.fileURL}" target="_blank" class="text-xs text-blue-600 hover:underline truncate">Ver Archivo: ${data.fileName}</a>
                </div>
                <button data-action="delete-varios" data-id="${data.id}" class="text-red-500 hover:text-red-700 text-xs font-semibold">Eliminar</button>
            `;
            listContainer.appendChild(item);
        });
    });
}

async function deleteVarios(variosId) {
    try {
        const docRef = doc(db, "projects", currentProject.id, "varios", variosId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const fileURL = docSnap.data().fileURL;
            if (fileURL) {
                const fileRef = ref(storage, fileURL);
                await deleteObject(fileRef);
            }
            await deleteDoc(docRef);
        }
    } catch (error) {
        console.error("Error al eliminar 'Varios':", error);
        alert("No se pudo eliminar el registro.");
    }
}
// ====================================================================
//      FIN: FUNCIONES
// ====================================================================

// ====================================================================
//      INICIO: FUNCIÓN renderInteractiveDocumentCards MEJORADA
// ====================================================================
function renderInteractiveDocumentCards(projectId) {
    const container = document.getElementById('document-cards-container');
    if (!container) return;

    const docTypes = [
        { id: 'contrato', title: 'Contrato', multiple: false },
        { id: 'cotizacion', title: 'Cotización', multiple: false },
        { id: 'polizas', title: 'Pólizas', multiple: true },
        { id: 'pago_polizas', title: 'Pago de Pólizas', multiple: true },
        { id: 'otro_si', title: 'Otro Sí', action: 'open-otro-si-modal' },
        // AÑADE ESTA LÍNEA
        { id: 'varios', title: 'Varios', action: 'open-varios-modal' }
    ];

    const q = query(collection(db, "projects", projectId, "documents"));
    onSnapshot(q, (snapshot) => {
        const currentContainer = document.getElementById('document-cards-container');
        if (!currentContainer) return;

        currentProjectDocs.clear();
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            if (!currentProjectDocs.has(data.type)) {
                currentProjectDocs.set(data.type, []);
            }
            currentProjectDocs.get(data.type).push(data);
        });

        currentContainer.innerHTML = '';
        docTypes.forEach(type => {
            const docs = currentProjectDocs.get(type.id);
            const isUploaded = docs && docs.length > 0;
            const canUpload = type.multiple || !isUploaded;
            const card = document.createElement('div');

            let statusText = 'Clic para subir';
            if (isUploaded) {
                statusText = type.multiple ? `${docs.length} archivo(s) cargados` : 'Archivo cargado';
            }
            if (!canUpload) {
                statusText = 'Archivo cargado';
            }

            // --- LÓGICA DEL COLOR VERDE AÑADIDA AQUÍ ---
            const bgColorClass = isUploaded ? 'bg-green-50' : 'bg-white';

            if (type.action) {
                // Lógica para la tarjeta "Otro Sí"
                card.className = `document-upload-card p-4 cursor-pointer bg-white`;
                card.dataset.action = type.action;
                card.innerHTML = `
                    <div class="doc-icon mt-4">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <p class="doc-title text-center font-bold">${type.title}</p>
                    <p class="doc-status text-center text-sm text-gray-600">Añadir o gestionar</p>
                `;
            } else {
                // LÓGICA UNIFICADA PARA TODAS LAS TARJETAS DE DOCUMENTOS
                card.className = `document-upload-card p-4 flex flex-col items-center justify-center rounded-lg shadow ${bgColorClass} ${canUpload ? 'cursor-pointer' : 'cursor-default'}`;
                if (canUpload) {
                    card.dataset.action = "upload-doc";
                }
                card.dataset.docType = type.id;

                let buttonText = type.multiple ? "Ver Documentos" : "Ver Documento";

                card.innerHTML = `
                    ${isUploaded ? `<div class="mb-2"><button data-action="view-documents" data-doc-type="${type.id}" class="view-docs-btn bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm">${buttonText}</button></div>` : ''}
                    <div class="doc-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    </div>
                    <p class="doc-title font-bold">${type.title}</p>
                    <p class="doc-status text-sm text-gray-600">${statusText}</p>
                    <input type="file" class="hidden" data-doc-type="${type.id}" ${type.multiple ? 'multiple' : ''}>
                `;
            }
            currentContainer.appendChild(card);
        });
    });
}
// ====================================================================
//      FIN: FUNCIÓN MEJORADA
// ====================================================================

function loadProjectDocuments(projectId) {
    const listContainer = document.getElementById('documents-list');
    listContainer.innerHTML = 'Cargando...';
    const q = query(collection(db, "projects", projectId, "documents"), orderBy("uploadedAt", "desc"));

    onSnapshot(q, (snapshot) => {
        listContainer.innerHTML = '';
        if (snapshot.empty) {
            listContainer.innerHTML = '<p class="text-sm text-gray-500">No hay documentos cargados.</p>';
            return;
        }
        snapshot.forEach(doc => {
            const docData = { id: doc.id, ...doc.data() };
            const docElement = document.createElement('div');
            docElement.className = "flex items-center justify-between p-2 rounded hover:bg-gray-100";

            docElement.innerHTML = `
                    <span class="flex-grow text-gray-800 truncate pr-4">${docData.name}</span>
                    <div class="flex-shrink-0 space-x-2">
                        <button data-action="view-doc" data-url="${docData.url}" class="text-blue-600 hover:underline text-sm font-semibold">Ver</button>
                        <button data-action="delete-doc" data-project-id="${projectId}" data-doc-id="${docData.id}" class="text-red-600 hover:underline text-sm font-semibold">Eliminar</button>
                    </div>
                `;
            listContainer.appendChild(docElement);
        });
    });
}

function loadSubItems(itemId) {
    const loadingDiv = document.getElementById('loading-sub-items');
    loadingDiv.classList.remove('hidden');
    const subItemsTableBody = document.getElementById('sub-items-table-body');

    const q = query(collection(db, "subItems"), where("itemId", "==", itemId));
    unsubscribeSubItems = onSnapshot(q, (querySnapshot) => {
        loadingDiv.classList.add('hidden');
        subItemsTableBody.innerHTML = '';
        const docs = querySnapshot.docs.sort((a, b) => a.data().number - b.data().number);
        docs.forEach(subItemDoc => {
            const subItem = { id: subItemDoc.id, ...subItemDoc.data() };
            subItemsTableBody.appendChild(createSubItemRow(subItem));
        });
    });
}

function createSubItemRow(subItem) {
    const row = document.createElement('tr');
    row.className = 'bg-white border-b hover:bg-gray-50';

    const manufacturerData = usersMap.get(subItem.manufacturer);
    const installerData = usersMap.get(subItem.installer);
    const manufacturerName = manufacturerData ? `${manufacturerData.firstName} ${manufacturerData.lastName}` : 'N/A';
    const installerName = installerData ? `${installerData.firstName} ${installerData.lastName}` : 'N/A';

    let statusText = subItem.status || 'Pendiente de Fabricación';
    let statusColor;
    switch (statusText) {
        case 'Instalado':
            statusColor = 'bg-green-100 text-green-800';
            break;
        case 'Pendiente de Instalación':
            statusColor = 'bg-yellow-100 text-yellow-800';
            break;
        case 'Faltante de Evidencia':
            statusColor = 'bg-orange-100 text-orange-800';
            break;
        case 'Pendiente de Fabricación':
        default:
            statusColor = 'bg-red-100 text-red-800';
            break;
    }

    let photoHtml = 'N/A';
    if (subItem.photoURL) {
        photoHtml = `<button class="view-photo-btn text-blue-600 hover:underline font-semibold" data-photourl="${subItem.photoURL}">Ver</button>`;
        if (currentUserRole === 'admin') {
            photoHtml += `<button class="delete-photo-btn text-red-600 hover:underline font-semibold ml-2" data-subitemid="${subItem.id}" data-itemid="${subItem.itemId}" data-projectid="${subItem.projectId}" data-installerid="${subItem.installer}">Eliminar</button>`;
        }
    }

    row.innerHTML = `
    <td class="px-6 py-4 font-bold text-gray-900">${subItem.number}</td><td class="px-6 py-4">${subItem.location || 'N/A'}</td><td class="px-6 py-4">${manufacturerName}</td><td class="px-6 py-4">${installerName}</td><td class="px-6 py-4">${subItem.installDate || 'N/A'}</td><td class="px-6 py-4 text-center"><span class="text-xs font-medium mr-2 px-2.5 py-0.5 rounded-full ${statusColor}">${statusText}</span></td><td class="px-6 py-4 text-center">${photoHtml}</td><td class="px-6 py-4 text-center"><button class="register-progress-btn bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-1 px-3 rounded-full">Registrar Avance</button></td>`;

    if (subItem.photoURL) {
        row.querySelector('.view-photo-btn').addEventListener('click', (e) => {
            openImageModal(e.target.dataset.photourl);
        });
        if (currentUserRole === 'admin') {
            row.querySelector('.delete-photo-btn').addEventListener('click', (e) => {
                openConfirmModal(`¿Seguro que quieres eliminar esta foto de evidencia?`, () => {
                    handleDeletePhoto(e.target.dataset.subitemid, e.target.dataset.itemid, e.target.dataset.installerid, e.target.dataset.projectid);
                });
            });
        }
    }

    row.querySelector('.register-progress-btn').addEventListener('click', () => openProgressModal(subItem));
    return row;
}

async function updateSubItem(subItemId, data) {
    await updateDoc(doc(db, "subItems", subItemId), data);
}

// --- MANEJO DE MODALES ---
const mainModal = document.getElementById('main-modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalForm = document.getElementById('modal-form');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');

function openMainModal(type, data = {}) {
    let title, bodyHtml, btnText, btnClass;
    modalForm.reset();
    modalForm.dataset.type = type;
    modalForm.dataset.id = data.id || '';
    switch (type) {
        case 'newProject':
            title = 'Crear Nuevo Proyecto';
            btnText = 'Crear Proyecto';
            btnClass = 'bg-blue-500 hover:bg-blue-600';
            bodyHtml = `
                    <div class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label for="project-name" class="block text-sm font-medium">Nombre del Proyecto</label>
                                <input type="text" id="project-name" name="name" required class="mt-1 w-full border rounded-md p-2">
                            </div>
                            <div>
                                <label for="project-builder" class="block text-sm font-medium">Constructora</label>
                                <input type="text" id="project-builder" name="builderName" required class="mt-1 w-full border rounded-md p-2">
                            </div>
                        </div>
                        <div class="relative">
                            <label for="project-location" class="block text-sm font-medium">Ubicación (Municipio)</label>
                            <input type="text" id="project-location" name="location" required class="mt-1 w-full border rounded-md p-2" autocomplete="off" placeholder="Escribe para buscar...">
                            <div id="municipalities-results" class="municipality-search-results hidden"></div>
                        </div>
                        <div>
                            <label for="project-address" class="block text-sm font-medium">Dirección</label>
                            <input type="text" id="project-address" name="address" required class="mt-1 w-full border rounded-md p-2">
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label for="project-value" class="block text-sm font-medium">Valor del Contrato</label>
                                <input type="text" id="project-value" name="value" required class="mt-1 w-full border rounded-md p-2">
                            </div>
                            <div>
                                <label for="project-advance" class="block text-sm font-medium">Anticipo</label>
                                <input type="text" id="project-advance" name="advance" required class="mt-1 w-full border rounded-md p-2">
                            </div>
                        </div>
                        <div class="grid grid-cols-3 gap-4 border-t pt-4">
                            <div>
                                <label for="project-startDate" class="block text-sm font-medium">Inicio Contrato</label>
                                <input type="date" id="project-startDate" name="startDate" class="mt-1 w-full border rounded-md p-2">
                            </div>
                            <div>
                                <label for="project-kickoffDate" class="block text-sm font-medium">Acta de Inicio</label>
                                <input type="date" id="project-kickoffDate" name="kickoffDate" class="mt-1 w-full border rounded-md p-2">
                            </div>
                            <div>
                                <label for="project-endDate" class="block text-sm font-medium">Fin Contrato</label>
                                <input type="date" id="project-endDate" name="endDate" class="mt-1 w-full border rounded-md p-2">
                            </div>
                        </div>
                    </div>`;

            setTimeout(() => {
                // --- Lógica del buscador (sin cambios) ---
                const inputLocation = document.getElementById('project-location');
                const resultsContainer = document.getElementById('municipalities-results');
                fetchMunicipalities();
                inputLocation.addEventListener('input', async () => {
                    const municipalities = await fetchMunicipalities();
                    resultsContainer.innerHTML = '';

                    const query = inputLocation.value;
                    if (query.length === 0) {
                        resultsContainer.classList.add('hidden');
                        return;
                    }

                    // Normalizamos la búsqueda para ignorar tildes y mayúsculas
                    const normalizedQuery = normalizeString(query);
                    const filtered = municipalities.filter(m => normalizeString(m).startsWith(normalizedQuery));

                    if (filtered.length > 0) {
                        resultsContainer.classList.remove('hidden');
                        filtered.slice(0, 7).forEach(municipality => {
                            const item = document.createElement('div');
                            item.className = 'municipality-item';
                            item.textContent = municipality;
                            item.addEventListener('click', () => {
                                inputLocation.value = municipality;
                                resultsContainer.classList.add('hidden');
                            });
                            resultsContainer.appendChild(item);
                        });
                    } else {
                        resultsContainer.classList.add('hidden');
                    }
                });
                // Ocultar resultados si se hace clic fuera
                document.addEventListener('click', (e) => {
                    const dropdownBtn = document.getElementById('project-tabs-dropdown-btn');
                    const dropdownMenu = document.getElementById('project-tabs-dropdown-menu');

                    // Si se hace clic en el botón, muestra/oculta el menú
                    if (dropdownBtn && dropdownBtn.contains(e.target)) {
                        dropdownMenu.classList.toggle('hidden');
                    }
                    // Si se hace clic en una opción del menú...
                    else if (dropdownMenu && dropdownMenu.contains(e.target) && e.target.dataset.tab) {
                        e.preventDefault();
                        switchProjectTab(e.target.dataset.tab); // Cambia la pestaña
                        dropdownMenu.classList.add('hidden'); // Cierra el menú
                    }
                    // Si se hace clic en cualquier otro lugar, cierra el menú
                    else if (dropdownMenu) {
                        dropdownMenu.classList.add('hidden');
                    }
                });
                // --- NUEVA LÓGICA PARA FORMATEO DE MONEDA ---
                const valueInput = document.getElementById('project-value');
                const advanceInput = document.getElementById('project-advance');
                const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

                const formatCurrencyInput = (e) => {
                    let value = e.target.value.replace(/[$. ]/g, '');
                    if (!isNaN(value) && value) {
                        e.target.value = currencyFormatter.format(value).replace(/\s/g, ' ');
                    } else {
                        e.target.value = '';
                    }
                };

                valueInput.addEventListener('input', formatCurrencyInput);
                advanceInput.addEventListener('input', formatCurrencyInput);

            }, 100);
            break;
        case 'addItem':
        case 'editItem': {
            const isEditing = type === 'editItem';
            title = isEditing ? 'Editar Ítem' : 'Añadir Nuevo Ítem';
            btnText = isEditing ? 'Guardar Cambios' : 'Añadir Ítem';
            btnClass = isEditing ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-green-500 hover:bg-green-600';

            // Plantilla para una sección de costo (Suministro o Instalación)
            const costSectionTemplate = (section, title, data = {}) => `
                    <div class="border rounded-lg p-3 mt-2">
                        <p class="font-semibold">${title}</p>
                        <div class="grid grid-cols-2 gap-4 mt-2">
                            <div>
                                <label for="item-${section}-unitPrice" class="block text-xs font-medium">Precio Unitario</label>
                                <input type="text" id="item-${section}-unitPrice" name="${section}_unitPrice" class="mt-1 w-full border rounded-md p-2" value="${data.unitPrice || ''}">
                            </div>
                            <div>
                                <label class="block text-xs font-medium">Impuesto</label>
                                <div class="mt-2 flex space-x-2">
                                    <label class="flex items-center text-xs"><input type="radio" name="${section}_taxType" value="iva" class="mr-1" ${data.taxType === 'iva' ? 'checked' : ''}> IVA</label>
                                    <label class="flex items-center text-xs"><input type="radio" name="${section}_taxType" value="aiu" class="mr-1" ${data.taxType === 'aiu' ? 'checked' : ''}> AIU</label>
                                </div>
                            </div>
                        </div>
                        <div id="${section}-aiu-fields" class="hidden space-y-2 mt-3">
                            <div class="grid grid-cols-3 gap-2">
                                <div><label for="${section}-aiu-a" class="block text-xs">A(%)</label><input type="number" id="${section}-aiu-a" name="${section}_aiuA" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuA || ''}"></div>
                                <div><label for="${section}-aiu-i" class="block text-xs">I(%)</label><input type="number" id="${section}-aiu-i" name="${section}_aiuI" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuI || ''}"></div>
                                <div><label for="${section}-aiu-u" class="block text-xs">U(%)</label><input type="number" id="${section}-aiu-u" name="${section}_aiuU" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuU || ''}"></div>
                            </div>
                        </div>
                    </div>`;

            bodyHtml = `
                    <div class="space-y-4">
                        <div>
                            <label for="item-name" class="block text-sm font-medium">Nombre</label>
                            <input type="text" id="item-name" name="name" required class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.name : ''}">
                        </div>
                        <div class="grid grid-cols-3 gap-4">
                            <div><label for="item-quantity" class="block text-sm font-medium">Cantidad</label><input type="number" id="item-quantity" name="quantity" required min="1" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.quantity : ''}" ${isEditing ? 'readonly' : ''}></div>
                            <div><label for="item-width" class="block text-sm font-medium">Ancho (m)</label><input type="number" id="item-width" name="width" required step="0.01" min="0" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.width : ''}"></div>
                            <div><label for="item-height" class="block text-sm font-medium">Alto (m)</label><input type="number" id="item-height" name="height" required step="0.01" min="0" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.height : ''}"></div>
                        </div>
                        <div>
                            <label class="block text-sm font-medium">Tipo de Ítem</label>
                            <div class="mt-2 flex space-x-4">
                                <label class="flex items-center"><input type="radio" name="itemType" value="supply_install" class="mr-2" ${!isEditing || data.itemType === 'supply_install' ? 'checked' : ''}> Suministro e Instalación</label>
                                <label class="flex items-center"><input type="radio" name="itemType" value="supply_only" class="mr-2" ${isEditing && data.itemType === 'supply_only' ? 'checked' : ''}> Solo Suministro</label>
                                <label class="flex items-center"><input type="radio" name="itemType" value="install_only" class="mr-2" ${isEditing && data.itemType === 'install_only' ? 'checked' : ''}> Solo Instalación</label>
                            </div>
                        </div>
                        <div id="supply-section">${costSectionTemplate('supply', 'Detalles de Suministro', isEditing ? data.supplyDetails : {})}</div>
                        <div id="installation-section">${costSectionTemplate('installation', 'Detalles de Instalación', isEditing ? data.installationDetails : {})}</div>
                    </div>`;

            setTimeout(() => {
                const setupCostSection = (section, data = {}) => {
                    const aiuFields = document.getElementById(`${section}-aiu-fields`);
                    const priceInput = document.getElementById(`item-${section}-unitPrice`);
                    const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

                    // Lógica para mostrar/ocultar campos AIU
                    document.querySelectorAll(`input[name="${section}_taxType"]`).forEach(radio => {
                        radio.addEventListener('change', (e) => aiuFields.classList.toggle('hidden', e.target.value !== 'aiu'));
                        if (radio.checked && radio.value === 'aiu') aiuFields.classList.remove('hidden');
                    });

                    // LÓGICA PARA FORMATEO DE MONEDA
                    const formatCurrencyInput = (e) => {
                        let value = e.target.value.replace(/[$. ]/g, '');
                        if (!isNaN(value) && value) {
                            e.target.value = currencyFormatter.format(value).replace(/\s/g, ' ');
                        } else {
                            e.target.value = '';
                        }
                    };

                    priceInput.addEventListener('input', formatCurrencyInput);

                    // Formatear el valor inicial si se está editando
                    if (isEditing && data.unitPrice) {
                        priceInput.value = currencyFormatter.format(data.unitPrice).replace(/\s/g, ' ');
                    }
                };

                // Lógica para mostrar/ocultar secciones de Suministro/Instalación
                const supplySection = document.getElementById('supply-section');
                const installSection = document.getElementById('installation-section');
                const toggleSections = (type) => {
                    supplySection.classList.toggle('hidden', type === 'install_only');
                    installSection.classList.toggle('hidden', type === 'supply_only');
                };

                document.querySelectorAll('input[name="itemType"]').forEach(radio => {
                    radio.addEventListener('change', (e) => toggleSections(e.target.value));
                    if (radio.checked) toggleSections(radio.value);
                });

                // Llama a la configuración para cada sección, pasando los datos si se está editando
                setupCostSection('supply', isEditing ? data.supplyDetails : {});
                setupCostSection('installation', isEditing ? data.installationDetails : {});
            }, 100);
            break;
        }
        case 'editUser':
            title = 'Editar Usuario'; btnText = 'Guardar Cambios'; btnClass = 'bg-yellow-500 hover:bg-yellow-600';
            bodyHtml = `<div class="space-y-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label for="user-firstName" class="block text-sm font-medium text-gray-700">Nombre</label><input type="text" id="user-firstName" name="firstName" value="${data.firstName}" required class="mt-1 block w-full px-3 py-2 border rounded-md"></div>
                    <div><label for="user-lastName" class="block text-sm font-medium text-gray-700">Apellido</label><input type="text" id="user-lastName" name="lastName" value="${data.lastName}" required class="mt-1 block w-full px-3 py-2 border rounded-md"></div>
                </div>
                <div><label for="user-idNumber" class="block text-sm font-medium text-gray-700">Cédula</label><input type="text" id="user-idNumber" name="idNumber" value="${data.idNumber}" required class="mt-1 block w-full px-3 py-2 border rounded-md"></div>
                <div><label for="user-email" class="block text-sm font-medium text-gray-700">Correo</label><input type="email" id="user-email" name="email" value="${data.email}" required class="mt-1 block w-full px-3 py-2 border rounded-md bg-gray-100" readonly></div>
                <div><label for="user-phone" class="block text-sm font-medium text-gray-700">Celular</label><input type="tel" id="user-phone" name="phone" value="${data.phone}" required class="mt-1 block w-full px-3 py-2 border rounded-md"></div>
                <div><label for="user-address" class="block text-sm font-medium text-gray-700">Dirección</label><input type="text" id="user-address" name="address" value="${data.address}" required class="mt-1 block w-full px-3 py-2 border rounded-md"></div>
            </div>`;
            break;
        case 'editProfile':
            title = 'Mi Perfil'; btnText = 'Guardar Cambios'; btnClass = 'bg-blue-500 hover:bg-blue-600';
            bodyHtml = `<div class="space-y-4">
                <div><label class="block text-sm font-medium text-gray-500">Nombre</label><p class="mt-1">${data.firstName} ${data.lastName}</p></div>
                <div><label class="block text-sm font-medium text-gray-500">Cédula</label><p class="mt-1">${data.idNumber}</p></div>
                <div><label for="profile-email" class="block text-sm font-medium text-gray-700">Correo</label><input type="email" id="profile-email" name="email" value="${data.email}" required class="mt-1 block w-full px-3 py-2 border rounded-md"></div>
                <div><label for="profile-phone" class="block text-sm font-medium text-gray-700">Celular</label><input type="tel" id="profile-phone" name="phone" value="${data.phone}" required class="mt-1 block w-full px-3 py-2 border rounded-md"></div>
                <div><label for="profile-address" class="block text-sm font-medium text-gray-700">Dirección</label><input type="text" id="profile-address" name="address" value="${data.address}" required class="mt-1 block w-full px-3 py-2 border rounded-md"></div>
            </div>`;
            break;
    }
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    const confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.textContent = btnText;
    confirmBtn.className = `text-white font-bold py-2 px-4 rounded-lg transition-all ${btnClass}`;
    mainModal.style.display = 'flex';
}
function closeMainModal() { mainModal.style.display = 'none'; }
document.getElementById('modal-cancel-btn').addEventListener('click', closeMainModal);
modalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(modalForm).entries());
    const type = modalForm.dataset.type;
    const id = modalForm.dataset.id;

    switch (type) {
        case 'newProject':
            const projectData = {
                name: data.name,
                builderName: data.builderName,
                location: data.location,
                address: data.address,
                value: parseFloat(data.value.replace(/[$. ]/g, '')) || 0,
                advance: parseFloat(data.advance.replace(/[$. ]/g, '')) || 0,
                // AÑADE ESTOS CAMPOS
                startDate: data.startDate,
                kickoffDate: data.kickoffDate,
                endDate: data.endDate,
                status: 'active'
            };
            await createProject(projectData);
            break;
        case 'addItem': await createItem(data); break;
        case 'editItem': await updateItem(id, data); break;
        case 'editUser':
            await updateDoc(doc(db, "users", id), {
                firstName: data.firstName,
                lastName: data.lastName,
                idNumber: data.idNumber,
                phone: data.phone,
                address: data.address,
            });
            break;
        case 'editProfile':
            try {
                const user = auth.currentUser;
                if (data.email !== user.email) {
                    await updateEmail(user, data.email);
                }
                await updateDoc(doc(db, "users", user.uid), {
                    email: data.email,
                    phone: data.phone,
                    address: data.address,
                });
            } catch (error) {
                console.error("Error al actualizar perfil:", error);
                alert("Error al actualizar el perfil. Es posible que necesites volver a iniciar sesión.");
            }
            break;
    }
    closeMainModal();
});

const progressModal = document.getElementById('progress-modal');
const progressForm = document.getElementById('progress-modal-form');
const progressConfirmBtn = document.getElementById('progress-modal-confirm-btn');

async function populateUserDropdowns(manufacturerSelect, installerSelect, subItem) {
    manufacturerSelect.innerHTML = '<option value="">Seleccionar</option>';
    installerSelect.innerHTML = '<option value="">Seleccionar</option>';

    if (currentUserRole === 'admin') {
        usersMap.forEach((user, uid) => {
            const option = document.createElement('option');
            option.value = uid;
            option.textContent = `${user.firstName} ${user.lastName}`;
            manufacturerSelect.appendChild(option.cloneNode(true));
            installerSelect.appendChild(option);
        });
    } else { // Si es empleado
        const currentUserData = usersMap.get(currentUser.uid);
        const option = document.createElement('option');
        option.value = currentUser.uid;
        option.textContent = `${currentUserData.firstName} ${currentUserData.lastName}`;
        manufacturerSelect.appendChild(option.cloneNode(true));
        installerSelect.appendChild(option);
    }

    manufacturerSelect.value = subItem.manufacturer || '';
    installerSelect.value = subItem.installer || '';
}


async function openProgressModal(subItem) {
    progressForm.reset();
    progressForm.dataset.id = subItem.id;
    progressForm.dataset.itemid = subItem.itemId;
    document.getElementById('progress-modal-title').textContent = `Registrar Avance: Unidad N° ${subItem.number}`;
    document.getElementById('sub-item-location').value = subItem.location || '';

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('sub-item-date').value = subItem.installDate || today;

    const manufacturerSelect = document.getElementById('sub-item-manufacturer');
    const installerSelect = document.getElementById('sub-item-installer');
    const photoInput = document.getElementById('sub-item-photo');
    const feedbackP = document.getElementById('progress-feedback');
    feedbackP.textContent = '';

    await populateUserDropdowns(manufacturerSelect, installerSelect, subItem);

    const updatePhotoPermission = () => {
        const isInstallerSelected = installerSelect.value !== '';
        photoInput.disabled = !isInstallerSelected;
        if (!isInstallerSelected) {
            photoInput.value = '';
        }
    };

    installerSelect.addEventListener('change', updatePhotoPermission);
    photoInput.addEventListener('click', (e) => {
        if (!installerSelect.value) {
            e.preventDefault();
            feedbackP.textContent = 'Por favor, seleccione un instalador antes de subir una foto de evidencia.';
            feedbackP.className = 'text-sm mt-4 text-center text-red-600';
        } else {
            feedbackP.textContent = '';
        }
    });
    updatePhotoPermission();

    const photoPreview = document.getElementById('photo-preview');
    if (subItem.photoURL) {
        photoPreview.innerHTML = `<a href="${subItem.photoURL}" target="_blank" class="text-blue-600 hover:underline text-sm">Ver foto actual</a>`;
    } else {
        photoPreview.innerHTML = '';
    }

    progressModal.style.display = 'flex';
}
function closeProgressModal() { progressModal.style.display = 'none'; }
document.getElementById('progress-modal-cancel-btn').addEventListener('click', closeProgressModal);
progressForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedbackP = document.getElementById('progress-feedback');
    progressConfirmBtn.disabled = true;
    progressConfirmBtn.textContent = 'Guardando...';
    feedbackP.textContent = '';
    feedbackP.className = 'text-sm mt-4 text-center';

    const subItemId = progressForm.dataset.id;
    const itemId = progressForm.dataset.itemid;
    const photoFile = document.getElementById('sub-item-photo').files[0];

    const manufacturerId = document.getElementById('sub-item-manufacturer').value;
    const installerId = document.getElementById('sub-item-installer').value;

    let newStatus = 'Pendiente de Fabricación';
    if (installerId) {
        newStatus = 'Instalado';
    } else if (manufacturerId) {
        newStatus = 'Pendiente de Instalación';
    }

    let data = {
        location: document.getElementById('sub-item-location').value,
        manufacturer: manufacturerId,
        installer: installerId,
        installDate: document.getElementById('sub-item-date').value,
        status: newStatus
    };

    try {
        if (photoFile) {
            if (currentUserRole === 'employee' && installerId !== currentUser.uid) {
                throw new Error("Solo puedes subir una foto si eres el instalador asignado.");
            }
            feedbackP.textContent = 'Subiendo foto...';
            feedbackP.classList.add('text-blue-600');
            const storageRef = ref(storage, `evidence/${currentProject.id}/${itemId}/${subItemId}`);
            const snapshot = await uploadBytes(storageRef, photoFile);
            data.photoURL = await getDownloadURL(snapshot.ref);
            feedbackP.textContent = 'Foto subida con éxito. Guardando datos...';
            feedbackP.classList.remove('text-blue-600');
            feedbackP.classList.add('text-green-600');
        }

        await updateSubItem(subItemId, data);
        closeProgressModal();

    } catch (error) {
        console.error("Error detallado al guardar:", error);
        feedbackP.textContent = error.message.includes("instalador") ? error.message : `Error: ${error.code}.`;
        feedbackP.classList.remove('text-blue-600', 'text-green-600');
        feedbackP.classList.add('text-red-600');
    } finally {
        progressConfirmBtn.disabled = false;
        progressConfirmBtn.textContent = 'Guardar Cambios';
    }
});

const confirmModal = document.getElementById('confirm-modal');
const confirmModalBody = document.getElementById('confirm-modal-body');
const confirmModalCancelBtn = document.getElementById('confirm-modal-cancel-btn');
const confirmModalConfirmBtn = document.getElementById('confirm-modal-confirm-btn');
let onConfirmCallback = () => { };
// ESTA ES LA FUNCIÓN MEJORADA
function openConfirmModal(message, callback) {
    confirmModalBody.textContent = message;
    onConfirmCallback = callback;

    // LÍNEA AÑADIDA: Le damos la prioridad más alta
    confirmModal.style.zIndex = 60;

    confirmModal.style.display = 'flex';
}
function closeConfirmModal() { confirmModal.style.display = 'none'; }
confirmModalCancelBtn.addEventListener('click', closeConfirmModal);
confirmModalConfirmBtn.addEventListener('click', () => { onConfirmCallback(); closeConfirmModal(); });

const imageModal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');
const imageModalCloseBtn = document.getElementById('image-modal-close-btn');
const registerSuccessModal = document.getElementById('register-success-modal');

function openImageModal(imageUrl) {
    modalImage.src = imageUrl;
    imageModal.style.display = 'flex';
}

function closeImageModal() {
    imageModal.style.display = 'none';
    modalImage.src = '';
}

function openRegisterSuccessModal() {
    registerSuccessModal.style.display = 'flex';
}

function closeRegisterSuccessModal() {
    registerSuccessModal.style.display = 'none';
}

document.getElementById('register-success-accept-btn').addEventListener('click', async () => {
    closeRegisterSuccessModal();
    await signOut(auth);
    document.getElementById('register-form').reset();
    showAuthView('login');
});

imageModalCloseBtn.addEventListener('click', closeImageModal);
imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal) {
        closeImageModal();
    }
});

// Manejo de eventos para botones que pueden estar ocultos
document.getElementById('app-container').addEventListener('click', (e) => {
    // Botón para exportar a PDF
    if (e.target && e.target.id === 'export-pdf-btn') {
        exportProjectToPDF();
    }

    // Botón para habilitar notificaciones
    if (e.target && e.target.id === 'enable-notifications-btn') {
        // Lógica existente...
    }

    // AÑADE ESTA NUEVA LÓGICA AQUÍ
    // Botón para ver el perfil
    if (e.target && e.target.id === 'profile-btn') {
        const userData = usersMap.get(currentUser.uid);
        openMainModal('editProfile', userData);
    }
});

const importModal = document.getElementById('import-modal');
document.getElementById('import-modal-cancel-btn').addEventListener('click', () => importModal.style.display = 'none');
document.getElementById('download-template-btn').addEventListener('click', () => {
    const wb = XLSX.utils.book_new();

    // --- HOJA 1: INSTRUCCIONES ---
    const instructions = [
        ["Columna", "Descripción y Ejemplo"],
        ["Nombre del Ítem", "Nombre descriptivo del objeto. Ej: 'Ventana Sala'"],
        ["Cantidad", "Número total de unidades de este ítem. Ej: 5"],
        ["Ancho (m)", "Ancho en metros. Usar punto (.) para decimales. Ej: 1.5"],
        ["Alto (m)", "Alto en metros. Usar punto (.) para decimales. Ej: 2.2"],
        ["Tipo de Ítem", "Opciones válidas: Suministro e Instalacion, Solo Suministro, Solo Instalacion"],
        ["Precio Suministro (Unitario)", "Costo del material por unidad, SIN impuestos. Si es 'Solo Instalacion', dejar en 0."],
        ["Impuesto Suministro", "Opciones válidas: IVA, AIU, Ninguno"],
        ["AIU ... % (Suministro)", "Llenar solo si el impuesto es AIU. Ingresar solo el número (sin %). Ej: 10"],
        ["Precio Instalación (Unitario)", "Costo de mano de obra por unidad, SIN impuestos. Si es 'Solo Suministro', dejar en 0."],
        ["Impuesto Instalación", "Opciones válidas: IVA, AIU, Ninguno"],
        ["AIU ... % (Instalación)", "Llenar solo si el impuesto es AIU. Ingresar solo el número (sin %). Ej: 5"]
    ];
    const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
    // Ajustar ancho de columnas
    wsInstructions['!cols'] = [{ wch: 30 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, wsInstructions, "Instrucciones");

    // --- HOJA 2: PLANTILLA PARA LLENAR ---
    const exampleData = [{
        'Nombre del Ítem': "Ventana Corrediza Sala",
        'Cantidad': 5,
        'Ancho (m)': 1.5,
        'Alto (m)': 1.2,
        'Tipo de Ítem': "Suministro e Instalacion",
        'Precio Suministro (Unitario)': 150000,
        'Impuesto Suministro': "AIU",
        'AIU Admin % (Suministro)': 5,
        'AIU Imprev % (Suministro)': 2,
        'AIU Utilidad % (Suministro)': 10,
        'Precio Instalación (Unitario)': 50000,
        'Impuesto Instalación': "IVA",
        'AIU Admin % (Instalación)': null,
        'AIU Imprev % (Instalación)': null,
        'AIU Utilidad % (Instalación)': null
    }];
    const wsData = XLSX.utils.json_to_sheet(exampleData);
    // Añadir comentarios a las celdas de encabezado
    wsData['E1'].c = [{ a: "Usuario", t: "Opciones: Suministro e Instalacion, Solo Suministro, Solo Instalacion" }];
    wsData['G1'].c = [{ a: "Usuario", t: "Opciones: IVA, AIU, Ninguno" }];
    wsData['L1'].c = [{ a: "Usuario", t: "Opciones: IVA, AIU, Ninguno" }];
    wsData['!cols'] = Array(15).fill({ wch: 25 }); // Ajustar ancho de todas las columnas

    XLSX.utils.book_append_sheet(wb, wsData, "Plantilla Items");

    XLSX.writeFile(wb, "Plantilla_Items_VidriosExito.xlsx");
});
document.getElementById('import-modal-confirm-btn').addEventListener('click', () => {
    const fileInput = document.getElementById('excel-file-input');
    const feedbackDiv = document.getElementById('import-feedback');
    if (fileInput.files.length === 0) {
        feedbackDiv.textContent = 'Por favor, selecciona un archivo.';
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const json = XLSX.utils.sheet_to_json(workbook.Sheets["Plantilla Items"]);

            feedbackDiv.textContent = `Importando ${json.length} ítems...`;

            for (const row of json) {
                // Mapeo de los nuevos nombres de columna a los nombres internos
                const newRow = {
                    nombre_item: row['Nombre del Ítem'],
                    cantidad: row['Cantidad'],
                    ancho: row['Ancho (m)'],
                    alto: row['Alto (m)'],
                    tipo_item: row['Tipo de Ítem'],
                    precio_unitario_suministro: row['Precio Suministro (Unitario)'],
                    impuesto_suministro: row['Impuesto Suministro'],
                    'aiu_admin_suministro_%': row['AIU Admin % (Suministro)'],
                    'aiu_imprev_suministro_%': row['AIU Imprev % (Suministro)'],
                    'aiu_utilidad_suministro_%': row['AIU Utilidad % (Suministro)'],
                    precio_unitario_instalacion: row['Precio Instalación (Unitario)'],
                    impuesto_instalacion: row['Impuesto Instalación'],
                    'aiu_admin_instalacion_%': row['AIU Admin % (Instalación)'],
                    'aiu_imprev_instalacion_%': row['AIU Imprev % (Instalación)'],
                    'aiu_utilidad_instalacion_%': row['AIU Utilidad % (Instalación)']
                };

                if (!newRow.nombre_item || !newRow.cantidad || !newRow.ancho || !newRow.alto) {
                    console.warn("Fila omitida por falta de datos básicos:", newRow);
                    continue;
                }

                let itemType = 'supply_install';
                if (newRow.tipo_item) {
                    const typeLower = newRow.tipo_item.toLowerCase();
                    if (typeLower.includes('solo suministro')) itemType = 'supply_only';
                    if (typeLower.includes('solo instalacion')) itemType = 'install_only';
                }

                const itemData = {
                    name: newRow.nombre_item,
                    quantity: newRow.cantidad,
                    width: newRow.ancho,
                    height: newRow.alto,
                    itemType: itemType,
                    supply_unitPrice: String(newRow.precio_unitario_suministro || 0),
                    supply_taxType: (newRow.impuesto_suministro || 'none').toLowerCase(),
                    supply_aiuA: newRow['aiu_admin_suministro_%'] || 0,
                    supply_aiuI: newRow['aiu_imprev_suministro_%'] || 0,
                    supply_aiuU: newRow['aiu_utilidad_suministro_%'] || 0,
                    installation_unitPrice: String(newRow.precio_unitario_instalacion || 0),
                    installation_taxType: (newRow.impuesto_instalacion || 'none').toLowerCase(),
                    installation_aiuA: newRow['aiu_admin_instalacion_%'] || 0,
                    installation_aiuI: newRow['aiu_imprev_instalacion_%'] || 0,
                    installation_aiuU: newRow['aiu_utilidad_instalacion_%'] || 0
                };

                await createItem(itemData);
            }

            feedbackDiv.textContent = '¡Importación completada!';
            setTimeout(() => {
                document.getElementById('import-modal').style.display = 'none';
                feedbackDiv.textContent = '';
                fileInput.value = '';
            }, 2000);

        } catch (error) {
            console.error("Error al importar el archivo:", error);
            feedbackDiv.textContent = 'Error al procesar el archivo. Verifique el formato y que la hoja se llame "Plantilla Items".';
        }
    };
    reader.readAsArrayBuffer(fileInput.files[0]);
});

async function exportProjectToPDF() {
    const { jsPDF } = window.jspdf;
    const docPDF = new jsPDF();
    const tableRows = [];
    const headers = ["Objeto", "Cant.", "Ancho", "Alto", "Vlr. Unitario", "Vlr. Total", "Estado"];

    const itemsQuery = query(collection(db, "items"), where("projectId", "==", currentProject.id));
    const itemsSnapshot = await getDocs(itemsQuery);

    for (const itemDoc of itemsSnapshot.docs) {
        const item = { id: itemDoc.id, ...itemDoc.data() };
        const unitPrice = calculateItemUnitPrice(item); // Usamos la nueva función
        const totalValue = calculateItemTotal(item);
        const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

        tableRows.push([
            item.name,
            item.quantity,
            item.width,
            item.height,
            currencyFormatter.format(unitPrice), // Valor unitario correcto
            currencyFormatter.format(totalValue),
            item.status
        ]);
    }
    docPDF.text(`Resumen del Proyecto: ${currentProject.name}`, 14, 15);
    docPDF.autoTable({ startY: 20, head: [headers], body: tableRows });
    docPDF.save(`resumen_${currentProject.name.replace(/\s/g, '_')}.pdf`);
}

// --- NOTIFICACIONES ---
async function handleDeletePhoto(subItemId, itemId, installerId, projectId) {
    try {
        const storageRef = ref(storage, `evidence/${projectId}/${itemId}/${subItemId}`);
        await deleteObject(storageRef);
        await updateDoc(doc(db, "subItems", subItemId), { photoURL: '', status: 'Faltante de Evidencia' });

        const itemDoc = await getDoc(doc(db, "items", itemId));
        const itemName = itemDoc.exists() ? itemDoc.data().name : "un ítem";

        // Crear notificación
        await addDoc(collection(db, "notifications"), {
            userId: installerId,
            message: `La foto de evidencia para el ítem #${itemName} (Unidad ${subItemId.substring(0, 5)}...) fue rechazada. Por favor, sube una nueva.`,
            subItemId: subItemId,
            itemId: itemId,
            projectId: projectId,
            read: false,
            createdAt: new Date()
        });

    } catch (error) {
        console.error("Error al eliminar la foto:", error);
        alert("No se pudo eliminar la foto.");
    }
}

function loadNotifications() {
    const notificationsList = document.getElementById('notifications-list');
    const notificationBadge = document.getElementById('notification-badge');
    const q = query(collection(db, "notifications"), where("userId", "==", currentUser.uid), where("read", "==", false));
    onSnapshot(q, (querySnapshot) => {
        notificationBadge.classList.toggle('hidden', querySnapshot.empty);
        notificationsList.innerHTML = '';
        if (querySnapshot.empty) {
            notificationsList.innerHTML = '<p class="p-4 text-sm text-gray-500">No hay notificaciones nuevas.</p>';
            return;
        }
        querySnapshot.forEach(doc => {
            const notification = { id: doc.id, ...doc.data() };
            const notificationItem = document.createElement('div');
            notificationItem.className = 'p-2 border-b hover:bg-gray-100 cursor-pointer';
            notificationItem.dataset.projectid = notification.projectId;
            notificationItem.dataset.itemid = notification.itemId;
            notificationItem.dataset.notifid = notification.id;
            notificationItem.innerHTML = `
                <p class="text-sm font-bold">Acción Requerida</p>
                <p class="text-sm">${notification.message}</p>
            `;
            notificationsList.appendChild(notificationItem);
        });

        document.querySelectorAll('#notifications-list > div').forEach(item => {
            item.addEventListener('click', async (e) => {
                const { projectid, itemid, notifid } = e.currentTarget.dataset;

                await updateDoc(doc(db, "notifications", notifid), { read: true });

                const projectDoc = await getDoc(doc(db, "projects", projectid));
                const itemDoc = await getDoc(doc(db, "items", itemid));
                if (projectDoc.exists() && itemDoc.exists()) {
                    const projectData = { id: projectid, ...projectDoc.data() };
                    const itemData = { id: itemid, ...itemDoc.data() };

                    showProjectDetails(projectData);
                    showSubItems(itemData);
                }

                document.getElementById('notifications-dropdown').classList.add('hidden');
            });
        });
    });
}

async function requestNotificationPermission() {
    const permissionBanner = document.getElementById('notification-permission-banner');
    // Verificación clave: si el banner no existe, no continuamos.
    if (!permissionBanner) {
        return;
    }

    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        return;
    }

    if (Notification.permission === 'default') {
        permissionBanner.classList.remove('hidden');
    } else {
        permissionBanner.classList.add('hidden');
    }
}

onMessage(messaging, (payload) => {
    console.log('Message received. ', payload);
    new Notification(payload.notification.title, {
        body: payload.notification.body,
    });
    loadNotifications();
});

// Registrar el Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('firebase-messaging-sw.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);
            }).catch(error => {
                console.error('Service Worker registration failed:', error);
            });
    });
}

// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    // Formularios de Autenticación
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);

    // Contenedor de Autenticación
    document.getElementById('auth-container').addEventListener('click', (e) => {
        if (e.target.id === 'show-register') {
            e.preventDefault();
            showAuthView('register');
        }
        if (e.target.id === 'show-login') {
            e.preventDefault();
            showAuthView('login');
        }
    });



    // MANEJADOR DE EVENTOS CENTRALIZADO para el contenido principal
    document.getElementById('main-content').addEventListener('click', async (e) => {
        const target = e.target;

        const uploadCard = e.target.closest('.document-upload-card[data-action="upload-doc"]');
        // LA CONDICIÓN AÑADIDA ES: !e.target.closest('button')
        if (uploadCard && !e.target.closest('button')) {
            // Busca el input de archivo oculto DENTRO de la tarjeta y lo activa
            const fileInput = uploadCard.querySelector('input[type="file"]');
            if (fileInput) {
                fileInput.click();
            }
            return; // Detenemos la ejecución para no interferir con otros clics
        }

        const button = target.closest('button');
        const docCard = target.closest('.document-category-card.clickable');

        // ====================================================================
        //      INICIO: CÓDIGO AÑADIDO PARA LA TARJETA "OTRO SÍ"
        // ====================================================================
        const otroSiCard = e.target.closest('.document-upload-card[data-action="open-otro-si-modal"]');
        if (otroSiCard) {
            openOtroSiModal();
            return; // Detiene la ejecución para no interferir con otros clics
        }
        // ====================================================================
        //      FIN: CÓDIGO AÑADIDO
        // ====================================================================

        // Lógica para clics en tarjetas de documentos
        if (docCard) {
            const docType = docCard.dataset.docType;
            const docs = currentProjectDocs.get(docType) || [];
            openDocumentViewerModal(docType, docs);
            return; // Detiene la ejecución para no procesar botones
        }

        // ======================================================
        //      INICIO: CÓDIGO AÑADIDO PARA EL BOTÓN "VER"
        // ======================================================
        if (button && button.dataset.action === 'view-documents') {
            const docType = button.dataset.docType;
            const docs = currentProjectDocs.get(docType) || [];
            openDocumentViewerModal(docType, docs);
            return; // Detenemos la ejecución aquí para que no interfiera con otros clics
        }
        // ======================================================
        //      FIN: CÓDIGO AÑADIDO
        // ======================================================


        // NUEVA LÓGICA PARA LAS PESTAÑAS DE DETALLES DEL PROYECTO
        const tabButton = e.target.closest('#project-details-tabs .tab-button');
        if (tabButton) {
            const tabName = tabButton.dataset.tab;
            switchProjectTab(tabName);
        }

        // Lógica para clics en botones
        if (button && button.dataset.action) {
            const action = button.dataset.action;
            const projectCard = button.closest('.project-card');
            const itemRow = button.closest('tr');

            // Acciones en tarjetas de PROYECTO
            if (projectCard) {
                const projectId = projectCard.dataset.id;
                const projectName = projectCard.dataset.name;

                switch (action) {
                    case 'view-details': {
                        const docSnap = await getDoc(doc(db, "projects", projectId));
                        if (docSnap.exists()) showProjectDetails({ id: docSnap.id, ...docSnap.data() });
                        break;
                    }
                    case 'archive':
                        openConfirmModal(`¿Estás seguro de archivar el proyecto "${projectName}"?`, () => archiveProject(projectId));
                        break;
                    case 'restore':
                        openConfirmModal(`¿Restaurar el proyecto "${projectName}"?`, () => restoreProject(projectId));
                        break;
                    case 'delete':
                        openConfirmModal(`¿Estás seguro de eliminar el proyecto "${projectName}"?`, () => deleteProject(projectId));
                        break;
                }
                return;
            }

            // Acciones en filas de la tabla de ÍTEMS
            if (itemRow && itemRow.dataset.id) {
                const itemId = itemRow.dataset.id;
                const itemDoc = await getDoc(doc(db, "items", itemId));
                if (!itemDoc.exists()) return;
                const itemData = { id: itemDoc.id, ...itemDoc.data() };

                switch (action) {
                    case 'view-item-details':
                        showSubItems(itemData);
                        break;
                    case 'edit-item':
                        openMainModal('editItem', itemData);
                        break;
                    case 'delete-item':
                        openConfirmModal(`¿Seguro que quieres eliminar el ítem "${itemData.name}"?`, () => deleteItem(itemId));
                        break;
                }
                return;
            }

            // Acciones generales (cabecera, etc.)
            switch (action) {
                case 'logout': handleLogout(); break;
                case 'new-project': openMainModal('newProject'); break;
                case 'toggle-menu': document.getElementById('sidebar').classList.toggle('-translate-x-full'); break;
                case 'back-to-dashboard': showDashboard(); break;
                case 'back-to-project': showProjectDetails(currentProject); break;
                case 'add-item':
                    openMainModal('addItem');
                    break;

                // ASEGÚRATE DE QUE ESTE CASE EXISTA
                case 'import-items':
                    document.getElementById('import-modal').style.display = 'flex';
                    break;

                case 'export-pdf':
                    exportProjectToPDF();
                    break;
                case 'manage-documents': openDocumentsModal(currentProject); break;
                case 'save-dates':
                    const kickoffDate = document.getElementById('project-kickoffDate').value;
                    const endDate = document.getElementById('project-endDate').value;
                    await updateDoc(doc(db, "projects", currentProject.id), { kickoffDate, endDate });
                    document.getElementById('save-dates-btn').classList.add('hidden');
                    break;
            }
        }
    });

    // Pestañas de Proyectos y Usuarios
    document.getElementById('active-projects-tab').addEventListener('click', () => loadProjects('active'));
    document.getElementById('archived-projects-tab').addEventListener('click', () => loadProjects('archived'));
    document.getElementById('active-users-tab').addEventListener('click', () => loadUsers('active'));
    document.getElementById('archived-users-tab').addEventListener('click', () => loadUsers('archived'));

    // Modales y otros elementos
    document.getElementById('progress-modal-cancel-btn').addEventListener('click', closeProgressModal);
    document.getElementById('import-modal-cancel-btn').addEventListener('click', () => document.getElementById('import-modal').style.display = 'none');
    document.getElementById('confirm-modal-cancel-btn').addEventListener('click', closeConfirmModal);
    document.getElementById('image-modal-close-btn').addEventListener('click', closeImageModal);
    document.getElementById('register-success-accept-btn').addEventListener('click', () => {
        closeRegisterSuccessModal();
        handleLogout();
        document.getElementById('register-form').reset();
        showAuthView('login');
    });

    // AÑADE ESTA LÍNEA
    document.getElementById('document-viewer-close-btn').addEventListener('click', closeDocumentViewerModal);

    // Modal de Documentos (este listener ya lo tienes, asegúrate de que esté)
    document.getElementById('documents-modal-close-btn').addEventListener('click', closeDocumentsModal);


    // Ordenamiento de tabla de ítems
    document.querySelectorAll('.sortable-header').forEach(header => {
        header.addEventListener('click', () => {
            const sortKey = header.dataset.sort;
            if (itemSortState.key === sortKey) {
                itemSortState.direction = itemSortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                itemSortState.key = sortKey;
                itemSortState.direction = 'asc';
            }
            renderSortedItems();
        });
    });

    // === INICIO DEL BLOQUE AÑADIDO ===
    // Modal de Documentos
    document.getElementById('documents-modal-close-btn').addEventListener('click', closeDocumentsModal);

    document.getElementById('documents-modal-body').addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button || !button.dataset.action) return;

        const action = button.dataset.action;

        if (action === 'view-doc') {
            const url = button.dataset.url;
            if (url) {
                window.open(url, '_blank');
            }
        }

        if (action === 'delete-doc') {
            const projectId = button.dataset.projectId;
            const docId = button.dataset.docId;
            openConfirmModal(
                `¿Estás seguro de que quieres eliminar este documento? Esta acción no se puede deshacer.`,
                () => deleteProjectDocument(projectId, docId)
            );
        }
    });

    document.getElementById('documents-modal-body').addEventListener('change', (e) => {
        if (e.target.classList.contains('document-upload-input')) {
            const file = e.target.files[0];
            const docType = e.target.dataset.docType;
            if (file && currentProject) {
                uploadProjectDocument(currentProject.id, file, docType);
                e.target.value = '';
            }
        }
    });

    document.getElementById('main-content').addEventListener('change', (e) => {
        // Si el elemento que cambió es un input de archivo dentro de una tarjeta de documento...
        const fileInput = e.target.closest('.document-upload-card input[type="file"]');
        if (fileInput) {
            const file = fileInput.files[0];
            const docType = fileInput.dataset.docType;

            if (file && currentProject) {
                // Actualizamos la tarjeta para mostrar que se está subiendo
                const card = fileInput.closest('.document-upload-card');
                const statusP = card.querySelector('.doc-status');
                if (statusP) statusP.textContent = 'Subiendo...';

                // Llamamos a la función que sube el archivo
                uploadProjectDocument(currentProject.id, file, docType);
            }
        }
    });

    const documentDisplayModal = document.getElementById('document-display-modal');

    // Función centralizada para cerrar el modal
    function closeDocumentDisplayModal() {
        const iframe = document.getElementById('document-iframe');
        documentDisplayModal.style.display = 'none';
        iframe.src = 'about:blank'; // Limpiamos el iframe para liberar memoria
    }

    // 1. Cierra el modal al hacer clic en el botón [X]
    document.getElementById('document-display-close-btn').addEventListener('click', closeDocumentDisplayModal);

    // 2. Cierra el modal al hacer clic FUERA del contenido (en el fondo oscuro)
    documentDisplayModal.addEventListener('click', (e) => {
        // Si el elemento clickeado (e.target) es el fondo del modal...
        if (e.target === documentDisplayModal) {
            closeDocumentDisplayModal();
        }
    });

    document.getElementById('document-viewer-list').addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button || !button.dataset.action) return;

        const action = button.dataset.action;

        if (action === 'view-doc') {
            const url = button.dataset.url;
            const name = button.dataset.name;
            viewDocument(url, name);
        }

        if (action === 'delete-doc') {
            const docId = button.dataset.docId;
            const docName = button.dataset.docName;

            // Llamamos a tu modal de confirmación existente
            openConfirmModal(
                `¿Estás seguro de que quieres eliminar el documento "${docName}"? Esta acción no se puede deshacer.`,
                () => {
                    // Esta función se ejecutará solo si el usuario confirma
                    deleteProjectDocument(currentProject.id, docId);
                }
            );
        }
    });

    document.addEventListener('change', (e) => {
        // Si el elemento que cambió es el menú con ID 'tabs'...
        if (e.target && e.target.id === 'tabs') {
            // ...entonces cambiamos la pestaña a la que el usuario seleccionó.
            switchProjectTab(e.target.value);
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'otro-si-modal-close-btn') {
            closeOtroSiModal();
        }
    });

    const otroSiForm = document.getElementById('otro-si-form');
    if (otroSiForm) {
        otroSiForm.addEventListener('submit', handleOtroSiSubmit);
    }

    const otroSiListContainer = document.getElementById('otro-si-list-container');
    if (otroSiListContainer) {
        otroSiListContainer.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action="delete-otro-si"]');
            if (button) {
                const otroSiId = button.dataset.id;
                openConfirmModal(
                    "¿Estás seguro de eliminar este 'Otro Sí'? Esta acción es permanente.",
                    () => deleteOtroSi(otroSiId)
                );
            }
        });
    }

    // ====================================================================
    //      INICIO: EVENTOS PARA EL MODAL "VARIOS"
    // ====================================================================
    document.addEventListener('click', (e) => {
        // Para el botón de cerrar
        if (e.target && e.target.id === 'varios-modal-close-btn') {
            closeVariosModal();
        }
        // Para la tarjeta que abre el modal
        const card = e.target.closest('.document-upload-card[data-action="open-varios-modal"]');
        if (card) {
            openVariosModal();
        }
    });

    const variosForm = document.getElementById('varios-form');
    if (variosForm) {
        variosForm.addEventListener('submit', handleVariosSubmit);
    }

    const variosListContainer = document.getElementById('varios-list-container');
    if (variosListContainer) {
        variosListContainer.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action="delete-varios"]');
            if (button) {
                const variosId = button.dataset.id;
                openConfirmModal(
                    "¿Estás seguro de eliminar este documento? Esta acción es permanente.",
                    () => deleteVarios(variosId)
                );
            }
        });
    }
    // ====================================================================
    //      FIN: EVENTOS
    // ====================================================================

    // ====================================================================
    //      INICIO: LÓGICA PARA BOTONES DE LA CABECERA (PERFIL Y NOTIFICACIONES)
    // ====================================================================
    const notificationsBtn = document.getElementById('notifications-btn');
    const notificationsDropdown = document.getElementById('notifications-dropdown');
    const profileBtn = document.getElementById('profile-btn');

    // Manejar clic en el botón de Notificaciones
    if (notificationsBtn) {
        notificationsBtn.addEventListener('click', () => {
            notificationsDropdown.classList.toggle('hidden');
        });
    }

    // Manejar clic en el botón de Perfil
    if (profileBtn) {
        profileBtn.addEventListener('click', () => {
            if (currentUser && usersMap.has(currentUser.uid)) {
                const userData = usersMap.get(currentUser.uid);
                openMainModal('editProfile', userData);
            }
        });
    }

    // Cerrar el menú de notificaciones si se hace clic fuera
    document.addEventListener('click', (e) => {
        if (notificationsDropdown && !notificationsBtn.contains(e.target) && !notificationsDropdown.contains(e.target)) {
            notificationsDropdown.classList.add('hidden');
        }
    });
    // ====================================================================
    //      FIN: LÓGICA PARA BOTONES DE LA CABECERA
    // ====================================================================

// ====================================================================
//      INICIO: LÓGICA FINAL Y UNIFICADA PARA EL MENÚ LATERAL (SIDEBAR)
// ====================================================================
const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('main-content');
const menuToggleBtn = document.getElementById('menu-toggle-btn'); // Botón hamburguesa (móvil)
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn'); // Botón Ocultar/Mostrar (dentro del menú)
const mainNav = document.getElementById('main-nav');

// --- Función para inicializar el estado del menú en Desktop ---
function initializeDesktopSidebar() {
    if (window.innerWidth >= 768 && sidebar && mainContent) {
        // Por defecto, el menú empieza colapsado mostrando solo los iconos.
        mainContent.classList.add('is-shifted');
        sidebar.classList.add('is-collapsed');
    }
}

// --- Lógica de hover para expandir en Desktop ---
if (window.innerWidth >= 768 && sidebar) {
    sidebar.addEventListener('mouseenter', () => {
        // Solo se expande al pasar el mouse si está en modo colapsado.
        if (sidebar.classList.contains('is-collapsed')) {
            sidebar.classList.add('is-expanded-hover');
        }
    });
    sidebar.addEventListener('mouseleave', () => {
        sidebar.classList.remove('is-expanded-hover');
    });
}

// --- Lógica de clics para cambiar de módulo ---
if (mainNav) {
    mainNav.addEventListener('click', (e) => {
        const link = e.target.closest('.nav-link');
        if (link) {
            e.preventDefault();
            const viewName = link.dataset.view;
            if (viewName === 'adminPanel') {
                showView('adminPanel');
                loadUsers('active');
            } else {
                showView(viewName);
            }
            // En móvil, sí cerramos el menú después de hacer clic.
            if (window.innerWidth < 768) {
                sidebar.classList.add('-translate-x-full');
            }
        }
    });
}

// --- Lógica para los botones de control ---
// Botón de hamburguesa (móvil)
if (menuToggleBtn) {
    menuToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('-translate-x-full');
    });
}
// Botón Ocultar/Mostrar (dentro del menú)
if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.innerWidth >= 768) { // Escritorio: Colapsa/Expande permanentemente
            mainContent.classList.toggle('is-shifted');
            sidebar.classList.toggle('is-collapsed');
        } else { // Móvil: Solo cierra
            sidebar.classList.add('-translate-x-full');
        }
    });
}

// --- Lógica para cerrar al hacer clic fuera (móvil) ---
if (mainContent) {
    mainContent.addEventListener('click', () => {
        if (window.innerWidth < 768 && sidebar && !sidebar.classList.contains('-translate-x-full')) {
            sidebar.classList.add('-translate-x-full');
        }
    });
}

// --- Inicializar estado al cargar la página ---
initializeDesktopSidebar();
// ====================================================================
//      FIN: LÓGICA FINAL
// ====================================================================
});