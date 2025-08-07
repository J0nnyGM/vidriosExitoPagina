// Importaciones de Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateEmail } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, writeBatch, getDocs, arrayUnion } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
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

// --- ELEMENTOS DEL DOM ---

const loadingOverlay = document.getElementById('loading-overlay');
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const loginView = document.getElementById('login-view');
const registerView = document.getElementById('register-view');

const views = {
    dashboard: document.getElementById('dashboard-view'),
    adminPanel: document.getElementById('admin-panel-view'),
    projectDetails: document.getElementById('project-details-view'),
    subItems: document.getElementById('sub-items-view'),
};

// --- MANEJO DE VISTAS ---

function showView(viewName) {
    Object.values(views).forEach(view => view.classList.add('hidden'));
    if (views[viewName]) views[viewName].classList.remove('hidden');
}

function showAuthView(viewName) {
    loginView.classList.toggle('hidden', viewName !== 'login');
    registerView.classList.toggle('hidden', viewName !== 'register');
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
        currentUser = null;
        currentUserRole = null;
        authContainer.classList.remove('hidden');
        appContainer.classList.add('hidden');
        showAuthView('login');
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

function handleLogout() {
    signOut(auth);
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
    showView('dashboard');
    currentProject = null;
    currentItem = null;
    if (unsubscribeItems) unsubscribeItems();
    if (unsubscribeSubItems) unsubscribeSubItems();
    if (unsubscribeUsers) unsubscribeUsers();
    
    document.getElementById('new-project-btn').classList.toggle('hidden', currentUserRole !== 'admin');
    document.getElementById('admin-panel-btn').classList.toggle('hidden', currentUserRole !== 'admin');
    document.getElementById('profile-btn').classList.toggle('hidden', currentUserRole !== 'employee');
    
    if (currentUser) {
        loadProjects();
        if (currentUserRole === 'employee') {
            loadNotifications();
        }
    }
}

function loadProjects() {
    const projectsContainer = document.getElementById('projects-container');
    projectsContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center py-10">
            <div class="loader"></div>
            <p class="text-gray-500 mt-4">Cargando proyectos...</p>
        </div>`;
    
    let q = query(collection(db, "projects"));

    unsubscribeProjects = onSnapshot(q, async (querySnapshot) => {
        projectsContainer.innerHTML = '<div id="projects-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>';
        const projectsGrid = document.getElementById('projects-grid');

        if (querySnapshot.empty) {
            projectsGrid.innerHTML = '<p class="text-gray-500 col-span-full text-center">No hay proyectos para mostrar.</p>';
            return;
        }
        
        for (const projectDoc of querySnapshot.docs) {
            const projectData = { id: projectDoc.id, ...projectDoc.data() };
            const { totalM2, executedM2 } = await calculateProjectProgress(projectData.id);
            const progress = totalM2 > 0 ? (executedM2 / totalM2) * 100 : 0;
            const card = createProjectCard(projectData, progress);
            projectsGrid.appendChild(card);
        }
    }, (error) => {
        console.error("Error cargando proyectos: ", error);
        projectsContainer.innerHTML = '<p class="text-red-500 col-span-full text-center">Error al cargar los proyectos.</p>';
    });
}

async function calculateProjectProgress(projectId) {
    const itemsQuery = query(collection(db, "items"), where("projectId", "==", projectId));
    const itemsSnapshot = await getDocs(itemsQuery);
    let totalM2 = 0, executedM2 = 0;
    for (const itemDoc of itemsSnapshot.docs) {
        const item = itemDoc.data();
        totalM2 += item.width * item.height * item.quantity;
        const subItemsQuery = query(collection(db, "subItems"), where("itemId", "==", itemDoc.id), where("status", "==", "Instalado"));
        const subItemsSnapshot = await getDocs(subItemsQuery);
        executedM2 += item.width * item.height * subItemsSnapshot.size;
    }
    return { totalM2, executedM2 };
}

function createProjectCard(project, progress) {
    const card = document.createElement('div');
    card.className = "bg-white p-6 rounded-lg shadow-lg hover:shadow-xl transition-shadow cursor-pointer";
    card.dataset.id = project.id;
    card.innerHTML = `
        <div class="flex justify-between items-start">
            <h2 class="text-xl font-bold mb-2 text-gray-800">${project.name}</h2>
            ${currentUserRole === 'admin' ? `<button class="delete-project-btn text-red-500 hover:text-red-700 text-sm font-semibold" data-id="${project.id}">Eliminar</button>` : ''}
        </div>
        <p class="text-sm text-gray-500 mb-4">Progreso General</p>
        <div class="progress-bar-bg w-full rounded-full h-2.5"><div class="progress-bar-fg h-2.5 rounded-full" style="width: ${progress.toFixed(2)}%"></div></div>
        <p class="text-right text-sm mt-1 font-semibold">${progress.toFixed(2)}%</p>
    `;
    card.addEventListener('click', (e) => {
        if (!e.target.closest('.delete-project-btn')) {
            showProjectDetails(project);
        }
    });
    if(currentUserRole === 'admin') {
        card.querySelector('.delete-project-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openConfirmModal(`¿Estás seguro de que quieres eliminar el proyecto "${project.name}"?`, () => deleteProject(project.id));
        });
    }
    return card;
}

async function createProject(name) {
    await addDoc(collection(db, "projects"), { name, ownerId: currentUser.uid, createdAt: new Date() });
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
        <td class="px-6 py-4 font-medium text-gray-900">${user.firstName} ${user.lastName}</td>
        <td class="px-6 py-4">${user.email}</td>
        <td class="px-6 py-4">
            <select class="user-role-select border rounded-md p-1" data-userid="${user.id}">
                <option value="employee" ${user.role === 'employee' ? 'selected' : ''}>Empleado</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option>
            </select>
        </td>
        <td class="px-6 py-4 font-semibold ${statusColor}">${statusText}</td>
        <td class="px-6 py-4 text-center">
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
        });
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

// --- LÓGICA DE DETALLES DEL PROYECTO ---
function showProjectDetails(project) {
    currentProject = project;
    if (unsubscribeProjects) unsubscribeProjects();
    document.getElementById('project-name-header').textContent = project.name;
    document.getElementById('project-actions').classList.toggle('hidden', currentUserRole !== 'admin');
    showView('projectDetails');
    loadItems(project.id);
}

function loadItems(projectId) {
    const loadingDiv = document.getElementById('loading-items');
    loadingDiv.classList.remove('hidden');
    
    const q = query(collection(db, "items"), where("projectId", "==", projectId));
    unsubscribeItems = onSnapshot(q, async (querySnapshot) => {
        loadingDiv.classList.add('hidden');
        
        currentItemsData = [];
        for (const itemDoc of querySnapshot.docs) {
            const itemData = { id: itemDoc.id, ...itemDoc.data() };
            const subItemsQuery = query(collection(db, "subItems"), where("itemId", "==", itemData.id), where("status", "==", "Instalado"));
            itemData.executedCount = (await getDocs(subItemsQuery)).size;
            const percentage = itemData.quantity > 0 ? (itemData.executedCount / itemData.quantity) : 0;
            if (percentage === 0) { itemData.status = 'Pendiente'; }
            else if (percentage < 1) { itemData.status = 'En Proceso'; }
            else { itemData.status = 'Instalado'; }
            currentItemsData.push(itemData);
        }
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
    const contractedM2 = item.width * item.height * item.quantity;
    const executedM2 = item.width * item.height * executedCount;
    
    let statusColor;
    if (item.status === 'Pendiente') { statusColor = 'bg-red-100 text-red-800'; }
    else if (item.status === 'En Proceso') { statusColor = 'bg-yellow-100 text-yellow-800'; }
    else { statusColor = 'bg-green-100 text-green-800'; }

    const adminActions = `<button class="edit-item-btn text-yellow-600 hover:underline font-semibold">Editar</button><button class="delete-item-btn text-red-600 hover:underline font-semibold">Eliminar</button>`;

    row.innerHTML = `<td class="px-6 py-4 font-medium text-gray-900">${item.name}</td><td class="px-6 py-4">${item.width}m x ${item.height}m</td><td class="px-6 py-4 text-center">${item.quantity}</td><td class="px-6 py-4 text-center">${contractedM2.toFixed(2)} m²</td><td class="px-6 py-4 text-center font-semibold">${executedCount}</td><td class="px-6 py-4 text-center font-semibold">${executedM2.toFixed(2)} m²</td><td class="px-6 py-4 text-center"><span class="text-xs font-medium mr-2 px-2.5 py-0.5 rounded-full ${statusColor}">${item.status}</span></td><td class="px-6 py-4 text-center"><div class="flex justify-center items-center gap-4"><button class="view-details-btn text-blue-600 hover:underline font-semibold">Ver</button>${currentUserRole === 'admin' ? adminActions : ''}</div></td>`;
    row.querySelector('.view-details-btn').addEventListener('click', () => showSubItems(item));
    if (currentUserRole === 'admin') {
        row.querySelector('.edit-item-btn').addEventListener('click', () => openMainModal('editItem', item));
        row.querySelector('.delete-item-btn').addEventListener('click', () => {
            openConfirmModal(`¿Seguro que quieres eliminar el ítem "${item.name}"?`, () => deleteItem(item.id));
        });
    }
    return row;
}

async function createItem(itemData) {
    const itemRef = await addDoc(collection(db, "items"), { ...itemData, projectId: currentProject.id, ownerId: currentUser.uid, createdAt: new Date() });
    const batch = writeBatch(db);
    for (let i = 1; i <= itemData.quantity; i++) {
        const subItemRef = doc(collection(db, "subItems"));
        batch.set(subItemRef, { itemId: itemRef.id, projectId: currentProject.id, number: i, status: 'Pendiente de Fabricación', location: '', manufacturer: '', installer: '', installDate: '', photoURL: '' });
    }
    await batch.commit();
    closeMainModal();
}
        
async function updateItem(itemId, itemData) {
    await updateDoc(doc(db, "items", itemId), { name: itemData.name, width: itemData.width, height: itemData.height });
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
    if (unsubscribeItems) unsubscribeItems();
    document.getElementById('item-name-header').textContent = `Detalle de: ${item.name}`;
    document.getElementById('item-summary-header').textContent = `Total de ${item.quantity} unidades.`;
    showView('subItems');
    loadSubItems(item.id);
}
        
function loadSubItems(itemId) {
    const loadingDiv = document.getElementById('loading-sub-items');
    loadingDiv.classList.remove('hidden');
    const subItemsTableBody = document.getElementById('sub-items-table-body');
    
    const q = query(collection(db, "subItems"), where("itemId", "==", itemId));
    unsubscribeSubItems = onSnapshot(q, (querySnapshot) => {
        loadingDiv.classList.add('hidden');
        subItemsTableBody.innerHTML = '';
        const docs = querySnapshot.docs.sort((a,b) => a.data().number - b.data().number);
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
    switch(statusText) {
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

    row.innerHTML = `<td class="px-6 py-4 font-bold text-gray-900">${subItem.number}</td><td class="px-6 py-4">${subItem.location || 'N/A'}</td><td class="px-6 py-4">${manufacturerName}</td><td class="px-6 py-4">${installerName}</td><td class="px-6 py-4">${subItem.installDate || 'N/A'}</td><td class="px-6 py-4 text-center"><span class="text-xs font-medium mr-2 px-2.5 py-0.5 rounded-full ${statusColor}">${statusText}</span></td><td class="px-6 py-4 text-center">${photoHtml}</td><td class="px-6 py-4 text-center"><button class="register-progress-btn bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-1 px-3 rounded-full">Registrar Avance</button></td>`;
    
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
            title = 'Crear Nuevo Proyecto'; btnText = 'Crear Proyecto'; btnClass = 'bg-blue-500 hover:bg-blue-600';
            bodyHtml = `<div><label for="project-name" class="block text-sm font-medium text-gray-700">Nombre del Proyecto</label><input type="text" id="project-name" name="name" required class="mt-1 block w-full px-3 py-2 border rounded-md"></div>`;
            break;
        case 'addItem':
            title = 'Añadir Nuevo Ítem'; btnText = 'Añadir Ítem'; btnClass = 'bg-green-500 hover:bg-green-600';
            bodyHtml = `<div class="space-y-4"><div><label for="item-name" class="block text-sm font-medium text-gray-700">Nombre</label><input type="text" id="item-name" name="name" required class="mt-1 block w-full px-3 py-2 border rounded-md"></div><div><label for="item-quantity" class="block text-sm font-medium text-gray-700">Cantidad</label><input type="number" id="item-quantity" name="quantity" required min="1" class="mt-1 block w-full px-3 py-2 border rounded-md"></div><div class="grid grid-cols-2 gap-4"><div><label for="item-width" class="block text-sm font-medium text-gray-700">Ancho (m)</label><input type="number" id="item-width" name="width" required step="0.01" min="0" class="mt-1 block w-full px-3 py-2 border rounded-md"></div><div><label for="item-height" class="block text-sm font-medium text-gray-700">Alto (m)</label><input type="number" id="item-height" name="height" required step="0.01" min="0" class="mt-1 block w-full px-3 py-2 border rounded-md"></div></div></div>`;
            break;
        case 'editItem':
            title = 'Editar Ítem'; btnText = 'Guardar Cambios'; btnClass = 'bg-yellow-500 hover:bg-yellow-600';
            bodyHtml = `<div class="space-y-4"><p class="text-sm text-yellow-700 bg-yellow-50 p-3 rounded-md">Nota: La cantidad no se puede editar.</p><div><label for="item-name" class="block text-sm font-medium text-gray-700">Nombre</label><input type="text" id="item-name" name="name" required value="${data.name}" class="mt-1 block w-full px-3 py-2 border rounded-md"></div><div><label for="item-quantity" class="block text-sm font-medium text-gray-700">Cantidad</label><input type="number" id="item-quantity" name="quantity" readonly value="${data.quantity}" class="mt-1 block w-full px-3 py-2 border rounded-md bg-gray-100"></div><div class="grid grid-cols-2 gap-4"><div><label for="item-width" class="block text-sm font-medium text-gray-700">Ancho (m)</label><input type="number" id="item-width" name="width" required step="0.01" min="0" value="${data.width}" class="mt-1 block w-full px-3 py-2 border rounded-md"></div><div><label for="item-height" class="block text-sm font-medium text-gray-700">Alto (m)</label><input type="number" id="item-height" name="height" required step="0.01" min="0" value="${data.height}" class="mt-1 block w-full px-3 py-2 border rounded-md"></div></div></div>`;
            break;
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
    const type = modalForm.dataset.type; const id = modalForm.dataset.id;
    switch (type) {
        case 'newProject': await createProject(data.name); break;
        case 'addItem': await createItem({ name: data.name, quantity: parseInt(data.quantity), width: parseFloat(data.width), height: parseFloat(data.height) }); break;
        case 'editItem': await updateItem(id, { name: data.name, width: parseFloat(data.width), height: parseFloat(data.height) }); break;
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
        if(!isInstallerSelected) {
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
let onConfirmCallback = () => {};
function openConfirmModal(message, callback) {
    confirmModalBody.textContent = message;
    onConfirmCallback = callback;
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

document.getElementById('back-to-dashboard-btn').addEventListener('click', showDashboard);
document.getElementById('back-to-project-btn').addEventListener('click', () => showProjectDetails(currentProject));
document.getElementById('profile-btn').addEventListener('click', () => {
    const userData = usersMap.get(currentUser.uid);
    openMainModal('editProfile', userData);
});

const importModal = document.getElementById('import-modal');
document.getElementById('import-modal-cancel-btn').addEventListener('click', () => importModal.style.display = 'none');
document.getElementById('download-template-btn').addEventListener('click', () => {
    const ws = XLSX.utils.json_to_sheet([{ nombre: "Ventana Corrediza", cantidad: 10, ancho: 1.5, alto: 1.2 }]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
    XLSX.writeFile(wb, "plantilla_items.xlsx");
});
document.getElementById('import-modal-confirm-btn').addEventListener('click', () => {
    const fileInput = document.getElementById('excel-file-input');
    const feedbackDiv = document.getElementById('import-feedback');
    if (fileInput.files.length === 0) { feedbackDiv.textContent = 'Selecciona un archivo.'; return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result); const workbook = XLSX.read(data, {type: 'array'});
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        feedbackDiv.textContent = `Importando ${json.length} ítems...`;
        for (const item of json) {
            if (item.nombre && item.cantidad && item.ancho && item.alto) {
                await createItem({ name: String(item.nombre), quantity: parseInt(item.cantidad), width: parseFloat(item.ancho), height: parseFloat(item.alto) });
            }
        }
        feedbackDiv.textContent = '¡Importación completada!';
        setTimeout(() => { importModal.style.display = 'none'; feedbackDiv.textContent = ''; fileInput.value = ''; }, 2000);
    };
    reader.readAsArrayBuffer(fileInput.files[0]);
});

document.getElementById('export-pdf-btn').addEventListener('click', async () => {
    const { jsPDF } = window.jspdf; 
    const docPDF = new jsPDF();
    const tableRows = []; 
    const headers = ["Objeto", "Medida", "Cant. Cont.", "M² Cont.", "Cant. Ejec.", "M² Ejec.", "Estado"];
    const itemsQuery = query(collection(db, "items"), where("projectId", "==", currentProject.id));
    const itemsSnapshot = await getDocs(itemsQuery);
    for (const itemDoc of itemsSnapshot.docs) {
        const item = itemDoc.data();
        const subItemsQuery = query(collection(db, "subItems"), where("itemId", "==", itemDoc.id), where("status", "==", "Instalado"));
        const executedCount = (await getDocs(subItemsQuery)).size;
        const contractedM2 = item.width * item.height * item.quantity; 
        const executedM2 = item.width * item.height * executedCount;
        const percentage = item.quantity > 0 ? (executedCount / item.quantity) : 0;
        let status = percentage === 0 ? 'Pendiente' : (percentage < 1 ? 'En Proceso' : 'Instalado');
        tableRows.push([item.name, `${item.width}x${item.height}m`, item.quantity, contractedM2.toFixed(2), executedCount, executedM2.toFixed(2), status]);
    }
    docPDF.text(`Resumen del Proyecto: ${currentProject.name}`, 14, 15);
    docPDF.autoTable({ startY: 20, head: [headers], body: tableRows });
    docPDF.save(`resumen_${currentProject.name.replace(/\s/g, '_')}.pdf`);
});

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
            message: `La foto de evidencia para el ítem #${itemName} (Unidad ${subItemId.substring(0,5)}...) fue rechazada. Por favor, sube una nueva.`,
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
                if(projectDoc.exists() && itemDoc.exists()) {
                    const projectData = {id: projectid, ...projectDoc.data()};
                    const itemData = {id: itemid, ...itemDoc.data()};
                    
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
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        return;
    }

    if (Notification.permission === 'default') {
        permissionBanner.classList.remove('hidden');
    } else {
        permissionBanner.classList.add('hidden');
    }

    document.getElementById('enable-notifications-btn').addEventListener('click', async () => {
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                console.log('Notification permission granted.');
                const vapidKey = 'BKdSH8VAjrl0Fpzc-FZmIVvahDsXV_BlIXU440PWRL3CBkqHiNCg3tav-Lf2kZFOy99sfTHfA5L2e-yXpf-eMiQ';
                const fcmToken = await getToken(messaging, { vapidKey: vapidKey });

                if (fcmToken) {
                    console.log('FCM Token:', fcmToken);
                    const userRef = doc(db, "users", currentUser.uid);
                    await updateDoc(userRef, {
                        fcmTokens: arrayUnion(fcmToken)
                    });
                }
            } else {
                console.log('Unable to get permission to notify.');
            }
        } catch (error) {
            console.error('An error occurred while getting token. ', error);
        } finally {
            permissionBanner.classList.add('hidden');
        }
    });
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
        navigator.serviceWorker.register('/firebase-messaging-sw.js')
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
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Navegación
    document.getElementById('show-register').addEventListener('click', (e) => { e.preventDefault(); showAuthView('register'); });
    document.getElementById('show-login').addEventListener('click', (e) => { e.preventDefault(); showAuthView('login'); });
    document.getElementById('back-to-dashboard-btn').addEventListener('click', showDashboard);
    document.getElementById('back-to-project-btn').addEventListener('click', () => showProjectDetails(currentProject));
    document.getElementById('back-to-dashboard-from-admin-btn').addEventListener('click', showDashboard);
    
    // Acciones
    document.getElementById('profile-btn').addEventListener('click', () => {
        const userData = usersMap.get(currentUser.uid);
        openMainModal('editProfile', userData);
    });
    document.getElementById('admin-panel-btn').addEventListener('click', () => {
        showView('adminPanel');
        loadUsers('active');
    });
    document.getElementById('new-project-btn').addEventListener('click', () => openMainModal('newProject'));
    document.getElementById('add-item-btn').addEventListener('click', () => openMainModal('addItem'));
    document.getElementById('import-items-btn').addEventListener('click', () => document.getElementById('import-modal').style.display = 'flex');
    document.getElementById('export-pdf-btn').addEventListener('click', exportProjectToPDF);

    // Pestañas del Panel de Admin
    document.getElementById('active-users-tab').addEventListener('click', () => loadUsers('active'));
    document.getElementById('archived-users-tab').addEventListener('click', () => loadUsers('archived'));

    // Modales
    document.getElementById('modal-cancel-btn').addEventListener('click', closeMainModal);
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

    // Notificaciones
    document.getElementById('notifications-bell-btn').addEventListener('click', () => {
        document.getElementById('notifications-dropdown').classList.toggle('hidden');
    });
    document.getElementById('enable-notifications-btn').addEventListener('click', requestNotificationPermission);

    // Ordenamiento de tabla
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
});