// Importaciones de Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateEmail } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, writeBatch, getDocs, arrayUnion, orderBy, runTransaction, collectionGroup  } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
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

let unsubscribeReports = null;
const functions = getFunctions(app);
let unsubscribePurchaseOrders = null;
let unsubscribeInventory = null;
let unsubscribeStock = null;
let unsubscribeMaterialRequests = null;
let currentCorte = null;
let unsubscribePeopleOfInterest = null;
let unsubscribePayments = null;
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
let views = {}; // <-- AÑADE ESTA LÍNEA

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

function showView(viewName, fromHistory = false) {
    Object.values(views).forEach(view => {
        if (view) {
            view.classList.add('hidden');
            view.style.display = 'none';
        }
    });

    const targetView = views[viewName];
    if (targetView) {
        targetView.classList.remove('hidden');
        targetView.style.display = 'block';
    } else {
        console.error(`Error: No se encontró la vista: ${viewName}`);
    }

    document.querySelectorAll('#main-nav .nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.view === viewName);
    });

    if (window.innerWidth < 768) {
        closeSidebar();
    }

    // --- LÓGICA AÑADIDA PARA EL HISTORIAL ---
    // Si el cambio de vista NO viene de presionar "Atrás",
    // entonces lo añadimos al historial.
    if (!fromHistory) {
        const state = { viewName: viewName };
        const title = `Gestor de Proyectos - ${viewName}`;
        const url = `#${viewName}`;
        history.pushState(state, title, url);
    }
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
            role: 'operario',
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
    showView('proyectos'); // Llama a la vista de proyectos por defecto
    currentProject = null;

    // Cancela las suscripciones de la vista de detalles para ahorrar recursos
    if (unsubscribeItems) unsubscribeItems();
    if (unsubscribeSubItems) unsubscribeSubItems();
    if (unsubscribeCortes) unsubscribeCortes();
    if (unsubscribePeopleOfInterest) unsubscribePeopleOfInterest();
    if (unsubscribePayments) unsubscribePayments();

    // Actualiza la visibilidad de los enlaces del menú según el rol
    const isAdmin = currentUserRole === 'admin';
    const isBodega = currentUserRole === 'bodega';
    document.getElementById('admin-nav-link').classList.toggle('hidden', !isAdmin);
    document.getElementById('inventory-nav-link').classList.toggle('hidden', !isAdmin && !isBodega);
    document.getElementById('compras-nav-link').classList.toggle('hidden', currentUserRole !== 'admin' && currentUserRole !== 'bodega');
    document.getElementById('reports-nav-link').classList.toggle('hidden', currentUserRole !== 'admin');


    if (currentUser) {
        loadProjects();
    }else if (viewName === 'reports') {
    showView('reports');
    loadReportsView();
}
}

let unsubscribeCatalog = null; // Renombra la variable global

function loadCatalogView() {
    const tableBody = document.getElementById('catalog-table-body');
    if (!tableBody) return;

    if (unsubscribeCatalog) unsubscribeCatalog();
    
    const catalogQuery = query(collection(db, "materialCatalog"), orderBy("name"));
    unsubscribeCatalog = onSnapshot(catalogQuery, (snapshot) => {
        tableBody.innerHTML = '';
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">No hay materiales en el catálogo.</td></tr>`;
            return;
        }
        snapshot.forEach(doc => {
            const material = { id: doc.id, ...doc.data() };
            const stock = material.quantityInStock || 0;
            const minStock = material.minStockThreshold || 0;
            
            let stockStatusIndicator = '<div class="h-3 w-3 rounded-full bg-green-500 mx-auto" title="Stock OK"></div>';
            if (minStock > 0 && stock <= minStock) {
                stockStatusIndicator = '<div class="h-3 w-3 rounded-full bg-red-500 mx-auto" title="Stock Bajo"></div>';
            }

            const row = document.createElement('tr');
            row.className = 'bg-white border-b';
            row.innerHTML = `
                <td class="px-6 py-4">${stockStatusIndicator}</td>
                <td class="px-6 py-4 font-medium">${material.name}</td>
                <td class="px-6 py-4 text-gray-500">${material.reference || 'N/A'}</td>
                <td class="px-6 py-4">${material.unit}</td>
                <td class="px-6 py-4 text-right font-bold text-lg">${stock}</td>
                <td class="px-6 py-4 text-center">
                    <button data-action="edit-catalog-item" data-id="${material.id}" class="text-yellow-600 font-semibold hover:underline">Editar</button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    });
}


function loadComprasView() {
    const tableBody = document.getElementById('purchase-orders-table-body');
    if (!tableBody) return;

    if (unsubscribePurchaseOrders) unsubscribePurchaseOrders();

    const poQuery = query(collection(db, "purchaseOrders"), orderBy("createdAt", "desc"));
    unsubscribePurchaseOrders = onSnapshot(poQuery, (snapshot) => {
        tableBody.innerHTML = '';
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">No hay órdenes de compra.</td></tr>`;
            return;
        }

        snapshot.forEach(doc => {
            // Usamos un bloque try/catch para que un documento erróneo no detenga todo el proceso
            try {
                const po = { id: doc.id, ...doc.data() };

                // VERIFICACIÓN CLAVE: Nos aseguramos de que los datos esenciales existan
                if (!po.createdAt || typeof po.createdAt.toDate !== 'function' || !po.provider) {
                    // Si falta la fecha o el proveedor, lo reportamos en la consola y saltamos este documento
                    console.warn(`Se omitió la orden de compra con ID ${doc.id} por tener datos incompletos.`);
                    return; // 'continue' en un forEach
                }

                let statusText, statusColor;
                switch (po.status) {
                    case 'recibida':
                        statusText = 'Recibida'; statusColor = 'bg-green-100 text-green-800'; break;
                    default:
                        statusText = 'Pendiente'; statusColor = 'bg-yellow-100 text-yellow-800';
                }

                const row = document.createElement('tr');
                row.className = 'bg-white border-b';
                row.innerHTML = `
                    <td class="px-6 py-4">${po.createdAt.toDate().toLocaleDateString('es-CO')}</td>
                    <td class="px-6 py-4 font-medium">${po.provider}</td>
                    <td class="px-6 py-4 text-right font-semibold">${currencyFormatter.format(po.totalCost || 0)}</td>
                    <td class="px-6 py-4 text-center"><span class="px-2 py-1 text-xs font-semibold rounded-full ${statusColor}">${statusText}</span></td>
                    <td class="px-6 py-4 text-center">
                        <button data-action="view-purchase-order" data-id="${po.id}" class="text-blue-600 font-semibold hover:underline">Ver</button>
                    </td>
                `;
                tableBody.appendChild(row);

            } catch (error) {
                console.error(`Error al procesar la orden de compra con ID ${doc.id}:`, error);
                // Si ocurre un error inesperado, lo mostramos en consola pero no detenemos la carga de los demás
            }
        });
    });
}

async function loadReportsView() {
    const projectFilter = document.getElementById('report-project-filter');
    
    // Rellenar el filtro de proyectos
    const projectsSnapshot = await getDocs(query(collection(db, "projects")));
    projectFilter.innerHTML = '<option value="all">Todos los Proyectos</option>'; // Reset
    projectsSnapshot.forEach(doc => {
        projectFilter.innerHTML += `<option value="${doc.id}">${doc.data().name}</option>`;
    });

    // Poner fechas por defecto (mes actual)
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
    document.getElementById('report-start-date').value = firstDay;
    document.getElementById('report-end-date').value = lastDay;
}

async function generateMaterialReport() {
    loadingOverlay.classList.remove('hidden');
    const resultsContainer = document.getElementById('report-results-container');
    const summaryContainer = document.getElementById('report-summary');
    const tableBody = document.getElementById('report-table-body');

    // 1. Obtener valores de los filtros
    const startDate = new Date(document.getElementById('report-start-date').value);
    const endDate = new Date(document.getElementById('report-end-date').value);
    endDate.setHours(23, 59, 59); // Incluir todo el día de fin
    const projectId = document.getElementById('report-project-filter').value;

    // 2. Construir la consulta a Firestore
    let requestsQuery = collectionGroup(db, 'materialRequests');
    requestsQuery = query(requestsQuery, where('createdAt', '>=', startDate), where('createdAt', '<=', endDate));
    if (projectId !== 'all') {
        // Firestore no permite filtrar por un campo y luego por el path del documento.
        // Haremos el filtro del proyecto en el cliente.
    }

    // 3. Obtener y procesar los datos
    const snapshot = await getDocs(requestsQuery);
    let requests = snapshot.docs.map(doc => ({projectId: doc.ref.parent.parent.id, ...doc.data()}));
    
    // Filtro manual por proyecto si es necesario
    if (projectId !== 'all') {
        requests = requests.filter(req => req.projectId === projectId);
    }
    
    // 4. Renderizar resultados
    tableBody.innerHTML = '';
    if (requests.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">No se encontraron solicitudes en el rango de fechas.</td></tr>`;
    } else {
        const projectNames = new Map(); // Para no consultar el nombre del proyecto cada vez
        for (const req of requests) {
            if (!projectNames.has(req.projectId)) {
                const projectDoc = await getDoc(doc(db, "projects", req.projectId));
                projectNames.set(req.projectId, projectDoc.data()?.name || 'Proyecto Desconocido');
            }
            
            const row = document.createElement('tr');
            row.className = 'bg-white border-b';
            row.innerHTML = `
                <td class="px-6 py-4">${req.createdAt.toDate().toLocaleDateString('es-CO')}</td>
                <td class="px-6 py-4 font-medium">${projectNames.get(req.projectId)}</td>
                <td class="px-6 py-4">${req.materialName}</td>
                <td class="px-6 py-4 text-center">${req.quantity}</td>
                <td class="px-6 py-4 text-right font-semibold">${currencyFormatter.format(req.totalCost || 0)}</td>
            `;
            tableBody.appendChild(row);
        }
    }

    // 5. Calcular y mostrar resumen
    const totalCost = requests.reduce((sum, req) => sum + (req.totalCost || 0), 0);
    summaryContainer.innerHTML = `
        <div class="bg-gray-50 p-4 rounded-lg">
            <p class="text-sm font-medium text-gray-500">Costo Total de Materiales</p>
            <p class="text-2xl font-bold text-gray-800">${currencyFormatter.format(totalCost)}</p>
        </div>
        <div class="bg-gray-50 p-4 rounded-lg">
            <p class="text-sm font-medium text-gray-500">N° de Solicitudes</p>
            <p class="text-2xl font-bold text-gray-800">${requests.length}</p>
        </div>
    `;

    resultsContainer.classList.remove('hidden');
    loadingOverlay.classList.add('hidden');
}

/**
 * Abre y rellena el modal con los detalles de una Orden de Compra específica.
 * @param {string} poId - El ID de la Orden de Compra a mostrar.
 */
async function openPurchaseOrderModal(poId) {
    const modal = document.getElementById('po-details-modal');
    if (!modal) return;

    const summaryContainer = document.getElementById('po-details-summary');
    const itemsListContainer = document.getElementById('po-details-items-list');
    const actionsContainer = document.getElementById('po-details-actions');

    summaryContainer.innerHTML = '<p>Cargando...</p>';
    itemsListContainer.innerHTML = '';

    const poRef = doc(db, "purchaseOrders", poId);
    const poSnap = await getDoc(poRef);

    if (!poSnap.exists()) {
        alert("Error: No se encontró la orden de compra.");
        return;
    }

    const po = { id: poSnap.id, ...poSnap.data() };

    // Rellenar información del resumen
    summaryContainer.innerHTML = `
        <div>
            <p><span class="font-semibold">Proveedor:</span> ${po.provider}</p>
            <p><span class="font-semibold">Fecha:</span> ${po.createdAt.toDate().toLocaleDateString('es-CO')}</p>
            <p><span class="font-semibold">Estado:</span> ${po.status}</p>
        </div>`;

    // Rellenar lista de materiales
    for (const item of po.items) {
        const materialRef = doc(db, "materialCatalog", item.materialId);
        const materialSnap = await getDoc(materialRef);
        const materialName = materialSnap.exists() ? materialSnap.data().name : 'Material no encontrado';

        const itemEl = document.createElement('div');
        itemEl.className = 'p-2 bg-gray-50 rounded-md text-sm';
        itemEl.innerHTML = `
            <span class="font-semibold">${materialName}</span> - 
            Cantidad: <span class="font-bold">${item.quantity}</span> - 
            Costo Unitario: <span class="font-bold">${currencyFormatter.format(item.unitCost)}</span>
        `;
        itemsListContainer.appendChild(itemEl);
    }

    // Añadir botón de acción si la orden está pendiente
    actionsContainer.innerHTML = `<button type="button" id="po-details-cancel-btn" class="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-lg">Cerrar</button>`;
    if (po.status === 'pendiente' && (currentUserRole === 'admin' || currentUserRole === 'bodega')) {
        // Botón Rechazar
        const rejectBtn = document.createElement('button');
        rejectBtn.textContent = 'Rechazar Orden';
        rejectBtn.className = 'bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg';
        rejectBtn.dataset.action = 'reject-purchase-order';
        rejectBtn.dataset.id = po.id;
        actionsContainer.appendChild(rejectBtn);

        // Botón Recibir
        const receiveBtn = document.createElement('button');
        receiveBtn.textContent = 'Recibir Mercancía';
        receiveBtn.className = 'bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg';
        receiveBtn.dataset.action = 'receive-purchase-order';
        receiveBtn.dataset.id = po.id;
        actionsContainer.appendChild(receiveBtn);
    }

    modal.style.display = 'flex';
}

function closePurchaseOrderModal() {
    const modal = document.getElementById('po-details-modal');
    if (modal) modal.style.display = 'none';
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
                <div class="flex flex-wrap gap-2 justify-end">

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
            <select class="user-role-select border rounded-md p-1 bg-white" data-userid="${user.id}">
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador </option>
                <option value="sst" ${user.role === 'sst' ? 'selected' : ''}>SST</option>
                <option value="bodega" ${user.role === 'bodega' ? 'selected' : ''}>Bodega</option>
                <option value="operario" ${user.role === 'operario' ? 'selected' : ''}>Operario</option>
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
async function showProjectDetails(project, defaultTab = 'info-general') {
    currentProject = project;
    showView('projectDetails');
    setupResponsiveTabs();

    const safeSetText = (id, text) => {
        const element = document.getElementById(id);
        if (element) element.textContent = text;
    };

    // --- Rellenar datos estáticos ---
    safeSetText('project-details-name', project.name);
    safeSetText('project-details-builder', project.builderName || 'Constructora no especificada');
    safeSetText('project-details-startDate', project.startDate ? new Date(project.startDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A');
    safeSetText('project-kickoffDate', project.kickoffDate ? new Date(project.kickoffDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A');
    safeSetText('project-endDate', project.endDate ? new Date(project.endDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A');
    const pricingModelText = project.pricingModel === 'incluido'
        ? 'Suministro e Instalación (Incluido)'
        : 'Suministro e Instalación (Separado)';
    safeSetText('project-details-pricingModel', pricingModelText);

    // --- Cargar datos dinámicos ---
    // Ponemos un listener a los pagos para actualizar el resumen de Info General en tiempo real.
    const paymentsQuery = query(collection(db, "projects", project.id, "payments"));
    onSnapshot(paymentsQuery, (paymentsSnapshot) => {
        const allPayments = paymentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateGeneralInfoSummary(project, allPayments);
    });

    const [contractedValue, statsMap] = await Promise.all([
        calculateProjectContractedValue(project.id),
        calculateAllProjectsProgress([project.id])
    ]);
    const stats = statsMap.get(project.id) || { executedValue: 0, totalItems: 0 };

    safeSetText('info-initial-contract-value', currencyFormatter.format(project.value || 0));


    safeSetText('info-contracted-value', currencyFormatter.format(contractedValue));
    safeSetText('info-executed-value', currencyFormatter.format(stats.executedValue));
    safeSetText('project-details-installedItems', `${stats.executedItems} / ${stats.totalItems}`);
    safeSetText('project-details-executedM2', `${stats.executedM2.toFixed(2)}m² / ${stats.totalM2.toFixed(2)}m²`);

    // --- Cargar datos para las otras pestañas ---
    renderInteractiveDocumentCards(project.id);
    loadItems(project.id);
    loadCortes(project);
    loadPeopleOfInterest(project.id);
    loadPayments(project);
    loadMaterialsTab(project);

    switchProjectTab(defaultTab);
}

// ====================================================================
//      INICIO: LÓGICA REPLANTEADA PARA GESTIÓN DE CORTES
// ====================================================================
let unsubscribeCortes = null;
let currentCorteType = 'nosotros'; // 'nosotros' o 'obra'

/**
 * Carga y muestra la lista de cortes de obra para un proyecto.
 */

/**
 * Carga y muestra la lista de cortes de obra para un proyecto con un diseño responsive mejorado.
 */
function loadCortes(project) {
    const container = document.getElementById('cortes-list-container');
    if (!container) return;

    const q = query(collection(db, "projects", project.id, "cortes"), orderBy("createdAt", "desc"));
    if (unsubscribeCortes) unsubscribeCortes();

    unsubscribeCortes = onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        if (snapshot.empty) {
            container.innerHTML = '<p class="text-gray-500 text-center py-4">No se han creado cortes para este proyecto.</p>';
            return;
        }

        const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

        snapshot.forEach(doc => {
            const corte = { id: doc.id, ...doc.data() };
            const corteCard = document.createElement('div');
            corteCard.className = 'bg-white p-4 rounded-lg shadow-md border';

            let statusColor, statusText;
            switch (corte.status) {
                case 'aprobado': statusColor = 'bg-green-100 text-green-800'; statusText = 'Aprobado'; break;
                default: statusColor = 'bg-yellow-100 text-yellow-800'; statusText = 'Preliminar'; break;
            }

            // --- PLANTILLA SIMPLIFICADA ---
            corteCard.innerHTML = `
                <div class="flex flex-col sm:flex-row justify-between">
                    <div>
                        <p class="font-bold text-lg text-gray-800">Corte #${corte.corteNumber || 'N/A'} ${corte.isFinal ? '<span class="text-xs text-red-600 font-semibold">(FINAL)</span>' : ''}</p>
                        <p class="text-sm text-gray-600">Creado el: ${corte.createdAt.toDate().toLocaleDateString('es-CO')}</p>
                        <span class="mt-2 inline-block text-sm font-semibold px-3 py-1 rounded-full ${statusColor}">${statusText}</span>
                    </div>
                    <div class="bg-gray-50 p-3 rounded-lg flex justify-between items-center mt-3 sm:mt-0 sm:flex-col sm:items-end sm:justify-center">
                        <span class="text-base font-bold text-gray-800">Neto a Pagar:</span>
                        <span class="text-2xl font-bold text-green-600">${currencyFormatter.format(corte.netoAPagar || 0)}</span>
                    </div>
                </div>

                <div class="flex flex-col sm:flex-row sm:flex-wrap gap-2 justify-end mt-4 pt-3 border-t">
                    <button data-action="view-corte-details" data-corte-id="${corte.id}" class="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Ver Detalles</button>
                    ${corte.status === 'preliminar' ? `
                        ${project.pricingModel === 'separado' ? `
                            <button data-action="export-corte-pdf" data-corte-id="${corte.id}" data-type="suministro" class="bg-gray-500 hover:bg-gray-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Previsualizar Suministro</button>
                            <button data-action="export-corte-pdf" data-corte-id="${corte.id}" data-type="instalacion" class="bg-gray-500 hover:bg-gray-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Previsualizar Instalación</button>
                        ` : `
                            <button data-action="export-corte-pdf" data-corte-id="${corte.id}" data-type="completo" class="bg-gray-500 hover:bg-gray-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Previsualizar</button>
                        `}
                        <button data-action="approve-corte" data-corte-id="${corte.id}" class="bg-green-500 hover:bg-green-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Aprobar</button>
                        <button data-action="deny-corte" data-corte-id="${corte.id}" class="bg-red-500 hover:bg-red-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Denegar</button>
                    ` : ''}
                    ${corte.status === 'aprobado' ?
                    (project.pricingModel === 'separado' ? `
                            <button data-action="export-corte-pdf" data-corte-id="${corte.id}" data-type="suministro" class="bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Memoria Suministro</button>
                            <button data-action="export-corte-pdf" data-corte-id="${corte.id}" data-type="instalacion" class="bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Memoria Instalación</button>
                        ` : `
                            <button data-action="export-corte-pdf" data-corte-id="${corte.id}" data-type="completo" class="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Exportar Memoria</button>
                        `)
                    : ''}
                </div>
            `;

            container.appendChild(corteCard);
        });
    });
}



/**
 * Prepara la vista de selección de ítems para un nuevo corte.
 * @param {string} type - El tipo de corte ('nosotros' u 'obra').
 */
async function setupCorteSelection(type) {
    currentCorteType = type;
    const selectionView = document.getElementById('corte-items-selection-view');
    const description = document.getElementById('corte-selection-description');
    const accordionContainer = document.getElementById('corte-items-accordion');

    selectionView.classList.remove('hidden');
    accordionContainer.innerHTML = '<p class="text-gray-500">Buscando ítems disponibles...</p>';

    // Define qué estados de sub-ítems buscar
    const validStates = type === 'nosotros'
        ? ['Instalado', 'Suministrado'] // Asumimos que quieres poder facturar ambos
        : ['Instalado']; // La obra solo paga por lo instalado

    description.textContent = type === 'nosotros'
        ? "Selecciona los sub-ítems suministrados o instalados para incluir en el corte."
        : "Selecciona los sub-ítems que la obra va a pagar en este corte.";

    try {
        // 1. Obtener todos los sub-ítems en los estados válidos
        const subItemsQuery = query(collection(db, "subItems"), where("projectId", "==", currentProject.id), where("status", "in", validStates));
        const subItemsSnapshot = await getDocs(subItemsQuery);
        const allValidSubItems = subItemsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        // 2. Obtener sub-ítems que ya están en cortes aprobados
        const cortesQuery = query(collection(db, "projects", currentProject.id, "cortes"), where("status", "==", "aprobado"));
        const cortesSnapshot = await getDocs(cortesQuery);
        const subItemsInCortes = new Set();
        cortesSnapshot.forEach(corteDoc => {
            corteDoc.data().subItemIds?.forEach(id => subItemsInCortes.add(id));
        });

        // 3. Filtrar para obtener solo sub-ítems nuevos
        const availableSubItems = allValidSubItems.filter(subItem => !subItemsInCortes.has(subItem.id));

        if (availableSubItems.length === 0) {
            accordionContainer.innerHTML = '<p class="text-gray-500 text-center">No hay nuevos sub-ítems disponibles para este tipo de corte.</p>';
            return;
        }

        // 4. Agrupar sub-ítems por su ítem padre (V-01, V-02, etc.)
        const groupedByItem = new Map();
        availableSubItems.forEach(si => {
            if (!groupedByItem.has(si.itemId)) {
                groupedByItem.set(si.itemId, []);
            }
            groupedByItem.get(si.itemId).push(si);
        });

        // 5. Obtener los datos de los ítems padres
        const itemIds = Array.from(groupedByItem.keys());
        if (itemIds.length === 0) return;
        const itemsQuery = query(collection(db, "items"), where("__name__", "in", itemIds));
        const itemsSnapshot = await getDocs(itemsQuery);
        const itemsMap = new Map(itemsSnapshot.docs.map(d => [d.id, d.data()]));

        // 6. Construir el acordeón
        accordionContainer.innerHTML = '';
        itemsMap.forEach((item, itemId) => {
            const subItems = groupedByItem.get(itemId);
            const accordionItem = document.createElement('div');
            accordionItem.className = 'border rounded-lg';
            accordionItem.innerHTML = `
                <div class="accordion-header flex items-center justify-between p-3 bg-gray-100 cursor-pointer">
                    <label class="flex items-center space-x-2 font-semibold">
                        <input type="checkbox" class="corte-item-select-all rounded">
                        <span>${item.name} (${subItems.length} disponibles)</span>
                    </label>
                    <svg class="h-5 w-5 transition-transform" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                </div>
                <div class="accordion-content hidden p-3 border-t space-y-2">
                    ${subItems.map(si => `
                        <label class="flex items-center space-x-2 text-sm">
                            <input type="checkbox" class="corte-subitem-checkbox rounded" data-subitem-id="${si.id}" data-item-id="${si.itemId}">
                            <span>#${si.number} - ${si.location || 'Sin ubicación'} (${si.status})</span>
                        </label>
                    `).join('')}
                </div>
            `;
            accordionContainer.appendChild(accordionItem);
        });

    } catch (error) {
        console.error("Error al preparar la selección de corte:", error);
    }
}

/**
 * Genera el corte preliminar a partir de la selección del usuario.
 */
async function generateCorte() {
    const selectedSubItemsCheckboxes = document.querySelectorAll('.corte-subitem-checkbox:checked');
    if (selectedSubItemsCheckboxes.length === 0) {
        alert("Por favor, selecciona al menos un sub-ítem para generar el corte.");
        return;
    }

    const usarMedidaReal = document.getElementById('corte-usar-medida-real').checked;
    const amortizarAnticipo = document.getElementById('corte-amortizar-anticipo').checked;
    const esCorteFinal = document.getElementById('corte-es-final').checked;
    const agregarOtrosDescuentos = document.getElementById('corte-add-other-discounts-checkbox').checked;

    openConfirmModal(
        `Se creará un nuevo corte preliminar con ${selectedSubItemsCheckboxes.length} sub-ítems. ¿Deseas continuar?`,
        async () => {
            loadingOverlay.classList.remove('hidden');
            try {
                // --- 1. Calcular valor bruto del corte (con lógica de medida real) ---
                let valorBrutoCorte = 0;
                const subItemIds = Array.from(selectedSubItemsCheckboxes).map(cb => cb.dataset.subitemId);

                const allItemsQuery = query(collection(db, "items"), where("projectId", "==", currentProject.id));
                const allSubItemsQuery = query(collection(db, "subItems"), where("projectId", "==", currentProject.id));
                const [itemsSnapshot, subItemsSnapshot] = await Promise.all([getDocs(allItemsQuery), getDocs(allSubItemsQuery)]);
                const itemsMap = new Map(itemsSnapshot.docs.map(d => [d.id, d.data()]));
                const subItemsMap = new Map(subItemsSnapshot.docs.map(d => [d.id, { id: d.id, ...d.data() }]));

                for (const subItemId of subItemIds) {
                    const subItem = subItemsMap.get(subItemId);
                    const parentItem = itemsMap.get(subItem.itemId);

                    if (parentItem) {
                        const valorUnitarioContratado = calculateItemTotal(parentItem) / parentItem.quantity;
                        let valorSubItemParaCorte = valorUnitarioContratado;

                        if (usarMedidaReal && subItem.realWidth > 0 && subItem.realHeight > 0) {
                            const areaContratada = parentItem.width * parentItem.height;
                            const areaReal = subItem.realWidth * subItem.realHeight;
                            if (areaContratada > 0) {
                                valorSubItemParaCorte = (valorUnitarioContratado / areaContratada) * areaReal;
                            }
                        }
                        valorBrutoCorte += valorSubItemParaCorte;
                    }
                }

                // --- 2. Calcular amortización y descuentos ---
                let valorAmortizacion = 0;
                const anticipoTotal = currentProject.advance || 0;
                if (amortizarAnticipo && anticipoTotal > 0) {
                    const cortesQuery = query(collection(db, "projects", currentProject.id, "cortes"), where("status", "==", "aprobado"));
                    const cortesSnapshot = await getDocs(cortesQuery);
                    let totalAmortizadoPrevio = 0;
                    cortesSnapshot.forEach(doc => { totalAmortizadoPrevio += doc.data().amortizacion || 0; });
                    const anticipoRestante = anticipoTotal - totalAmortizadoPrevio;

                    if (esCorteFinal) {
                        valorAmortizacion = anticipoRestante;
                    } else {
                        const contractedValue = await calculateProjectContractedValue(currentProject.id);
                        if (contractedValue > 0) {
                            const porcentajeCorte = (valorBrutoCorte / contractedValue) * 100;
                            valorAmortizacion = (anticipoTotal * porcentajeCorte) / 100;
                        }
                    }
                    valorAmortizacion = Math.min(valorAmortizacion, anticipoRestante);
                }

                let totalOtrosDescuentos = 0;
                const otrosDescuentos = [];
                if (agregarOtrosDescuentos) {
                    document.querySelectorAll('#corte-descuentos-section .flex').forEach(div => {
                        const concept = div.querySelector('.discount-concept')?.value.trim();
                        const valueStr = div.querySelector('.discount-value')?.value.replace(/[$. ]/g, '') || '0';
                        const value = parseFloat(valueStr);
                        if (concept && value > 0) {
                            otrosDescuentos.push({ concept, value });
                            totalOtrosDescuentos += value;
                        }
                    });
                }

                const valorNeto = valorBrutoCorte - valorAmortizacion - totalOtrosDescuentos;

                // --- 3. Guardar el nuevo corte preliminar ---
                const cortesQueryTotal = query(collection(db, "projects", currentProject.id, "cortes"));
                const cortesSnapshotTotal = await getDocs(cortesQueryTotal);
                const newCorteNumber = cortesSnapshotTotal.size + 1;

                const newCorte = {
                    corteNumber: newCorteNumber,
                    createdAt: new Date(),
                    subItemIds: subItemIds,
                    totalValue: valorBrutoCorte,
                    amortizacion: valorAmortizacion,
                    otrosDescuentos: otrosDescuentos,
                    netoAPagar: valorNeto,
                    isFinal: esCorteFinal,
                    usadoMedidaReal: usarMedidaReal, // <-- AÑADE ESTA LÍNEA
                    projectId: currentProject.id,
                    status: 'preliminar',
                    type: currentCorteType
                };

                await addDoc(collection(db, "projects", currentProject.id, "cortes"), newCorte);

                alert(`¡Corte preliminar #${newCorteNumber} creado con éxito!`);
                closeCorteSelectionView();


            } catch (error) {
                console.error("Error al generar el corte:", error);
                alert("Ocurrió un error al generar el corte.");
            } finally {
                loadingOverlay.classList.add('hidden');
            }
        }
    );
}



/**
 * Aprueba un corte, cambiando su estado a 'aprobado'.
 */
async function approveCorte(projectId, corteId) {
    loadingOverlay.classList.remove('hidden');
    try {
        const corteRef = doc(db, "projects", projectId, "cortes", corteId);
        const corteSnap = await getDoc(corteRef);

        if (!corteSnap.exists()) {
            throw new Error("No se encontró el corte para aprobar.");
        }

        const corte = corteSnap.data();

        // 1. Revisa si este corte tiene un valor de amortización pre-calculado.
        const montoAmortizar = corte.amortizacion || 0;

        // 2. Si el monto es mayor que cero, crea el registro del pago.
        if (montoAmortizar > 0) {
            await addDoc(collection(db, "projects", projectId, "payments"), {
                amount: montoAmortizar,
                date: new Date().toISOString().split('T')[0],
                type: 'amortizacion_anticipo',
                concept: `Amortización Corte #${corte.corteNumber}`,
                targetId: corteId,
            });
        }

        // 3. Finalmente, actualiza el estado del corte a "aprobado".
        await updateDoc(corteRef, { status: 'aprobado' });

        alert("¡Corte aprobado con éxito!");

    } catch (error) {
        console.error("Error al aprobar el corte:", error);
        alert("Ocurrió un error al aprobar el corte: " + error.message);
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

/**
 * Deniega un corte, eliminándolo de la base de datos.
 */
async function denyCorte(projectId, corteId) {
    const corteRef = doc(db, "projects", projectId, "cortes", corteId);
    await deleteDoc(corteRef);
    alert("El corte ha sido denegado y eliminado.");
}

/**
 * Muestra los detalles de un corte específico, incluyendo los ítems y sus valores.
 * @param {object} corteData - El objeto completo del corte desde Firestore.
 */
/**
 * Muestra los detalles de un corte específico, incluyendo los ítems y sus valores.
 * @param {object} corteData - El objeto completo del corte desde Firestore.
 */
async function showCorteDetails(corteData) {
    currentCorte = corteData;
    showView('corteDetails');

    const titleEl = document.getElementById('corte-details-title');
    const summaryEl = document.getElementById('corte-details-summary');
    const listContainer = document.getElementById('corte-details-list');

    titleEl.textContent = `Detalle del Corte #${corteData.corteNumber}`;
    // Limpiamos el resumen para añadir el desglose financiero
    summaryEl.innerHTML = `
        <div class="text-sm space-y-1 mt-2">
            <div class="flex justify-between">
                <span>Valor Bruto:</span>
                <span class="font-medium">${currencyFormatter.format(corteData.totalValue || 0)}</span>
            </div>
            <div class="flex justify-between text-red-600">
                <span>Amortización:</span>
                <span class="font-medium">- ${currencyFormatter.format(corteData.amortizacion || 0)}</span>
            </div>
            ${(corteData.otrosDescuentos || []).map(d => `
                <div class="flex justify-between text-red-600">
                    <span>Descuento (${d.concept}):</span>
                    <span class="font-medium">- ${currencyFormatter.format(d.value)}</span>
                </div>
            `).join('')}
            <div class="flex justify-between border-t mt-1 pt-1">
                <span class="font-bold">Neto a Pagar:</span>
                <span class="font-bold text-green-600">${currencyFormatter.format(corteData.netoAPagar || 0)}</span>
            </div>
        </div>
    `;
    listContainer.innerHTML = `<div class="loader-container"><div class="loader"></div></div>`;

    try {
        const [itemsSnapshot, subItemsSnapshot] = await Promise.all([
            getDocs(query(collection(db, "items"), where("projectId", "==", currentProject.id))),
            getDocs(query(collection(db, "subItems"), where("projectId", "==", currentProject.id)))
        ]);
        const itemsMap = new Map(itemsSnapshot.docs.map(doc => [doc.id, doc.data()]));
        const subItemsMap = new Map(subItemsSnapshot.docs.map(doc => [doc.id, doc.data()]));

        listContainer.innerHTML = '';

        for (const subItemId of corteData.subItemIds) {
            const subItem = subItemsMap.get(subItemId);
            if (!subItem) continue;

            const parentItem = itemsMap.get(subItem.itemId);
            if (!parentItem) continue;

            const valorUnitarioContratado = calculateItemTotal(parentItem) / parentItem.quantity;
            let valorSubItemEnCorte = valorUnitarioContratado;

            if (corteData.usadoMedidaReal && subItem.realWidth > 0 && subItem.realHeight > 0) {
                const areaContratada = parentItem.width * parentItem.height;
                const areaReal = subItem.realWidth * subItem.realHeight;
                if (areaContratada > 0) {
                    valorSubItemEnCorte = (valorUnitarioContratado / areaContratada) * areaReal;
                }
            }

            const manufacturerData = usersMap.get(subItem.manufacturer);
            const installerData = usersMap.get(subItem.installer);
            const manufacturerName = manufacturerData ? `${manufacturerData.firstName} ${manufacturerData.lastName}` : 'N/A';
            const installerName = installerData ? `${installerData.firstName} ${installerData.lastName}` : 'N/A';

            let statusText = subItem.status || 'Pendiente';
            let statusColor = 'bg-gray-100 text-gray-800';
            switch (statusText) {
                case 'Instalado': statusColor = 'bg-green-100 text-green-800'; break;
                case 'Pendiente de Instalación': statusColor = 'bg-yellow-100 text-yellow-800'; break;
                case 'Faltante de Evidencia': statusColor = 'bg-orange-100 text-orange-800'; break;
            }

            const itemCard = document.createElement('div');
            itemCard.className = 'bg-white p-4 rounded-lg shadow-md border';
            itemCard.innerHTML = `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div class="md:col-span-1 space-y-4">
                        <div class="h-48 bg-gray-200 rounded-md flex items-center justify-center">
                            ${subItem.photoURL ?
                    `<img src="${subItem.photoURL}" alt="Evidencia" class="w-full h-full object-cover rounded-md cursor-pointer" data-action="view-image">` :
                    '<span class="text-gray-500 text-sm">Sin evidencia</span>'}
                        </div>
                        <div class="text-center">
                            <p class="text-sm font-medium text-gray-500">Valor en este Corte</p>
                            <p class="text-2xl font-bold text-green-600">${currencyFormatter.format(valorSubItemEnCorte)}</p>
                        </div>
                    </div>
                    <div class="md:col-span-2">
                        <p class="text-sm text-gray-500">Objeto</p>
                        <p class="font-bold text-xl text-gray-800 mb-2">${parentItem.name} - Unidad #${subItem.number}</p>
                        <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                            <div>
                                <dt class="font-medium text-gray-500">Lugar de Instalación</dt>
                                <dd class="text-gray-800">${subItem.location || 'N/A'}</dd>
                            </div>
                            <div>
                                <dt class="font-medium text-gray-500">Estado</dt>
                                <dd><span class="text-xs font-semibold px-2 py-1 rounded-full ${statusColor}">${statusText}</span></dd>
                            </div>
                            <div>
                                <dt class="font-medium text-gray-500">Medidas Contrato</dt>
                                <dd class="text-gray-800">${parentItem.width}m x ${parentItem.height}m</dd>
                            </div>
                             <div>
                                <dt class="font-medium text-gray-500">Medidas Reales</dt>
                                <dd class="text-gray-800">${subItem.realWidth || 'N/A'}m x ${subItem.realHeight || 'N/A'}m</dd>
                            </div>
                            <div>
                                <dt class="font-medium text-gray-500">Fabricante</dt>
                                <dd class="text-gray-800">${manufacturerName}</dd>
                            </div>
                            <div>
                                <dt class="font-medium text-gray-500">Instalador</dt>
                                <dd class="text-gray-800">${installerName}</dd>
                            </div>
                             <div>
                                <dt class="font-medium text-gray-500">Fecha Instalación</dt>
                                <dd class="text-gray-800">${subItem.installDate || 'N/A'}</dd>
                            </div>
                        </dl>
                    </div>
                </div>
            `;
            listContainer.appendChild(itemCard);
        }
    } catch (error) {
        console.error("Error al cargar detalles del corte:", error);
        listContainer.innerHTML = '<p class="text-red-500">No se pudieron cargar los detalles.</p>';
    }
}


function closeCorteSelectionView() {
    const selectionView = document.getElementById('corte-items-selection-view');
    if (selectionView) {
        selectionView.classList.add('hidden');
    }
    // Resetea los botones "Lo realizo yo" / "Lo realiza la obra"
    document.querySelectorAll('.corte-type-btn').forEach(btn => {
        btn.classList.remove('bg-blue-500', 'text-white');
        btn.classList.add('bg-gray-200', 'text-gray-700');
    });
}

// ====================================================================
//      FIN: LÓGICA REPLANTEADA
// ====================================================================

// =================== INICIA CÓDIGO AÑADIDO ===================

/**
 * Genera una memoria de corte detallada con formato profesional, cabeceras y totales de columna.
 * @param {object} proyecto - El objeto con los datos del proyecto actual.
 * @param {object} corte - El objeto con los datos del corte a exportar.
 * @param {string} exportType - El tipo de memoria: 'completo', 'suministro', o 'instalacion'.
 */
async function exportCorteToPDF(proyecto, corte, exportType) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });
    const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

    const calculateTaxDetails = (details, baseValue) => {
        const result = { admin: 0, imprev: 0, utilidad: 0, ivaSobreUtilidad: 0, iva: 0, aiuTotal: 0 };
        if (!details || !details.unitPrice || baseValue <= 0) return result;
        if (details.taxType === 'aiu') {
            result.admin = baseValue * (details.aiuA / 100 || 0);
            result.imprev = baseValue * (details.aiuI / 100 || 0);
            result.utilidad = baseValue * (details.aiuU / 100 || 0);
            result.ivaSobreUtilidad = result.utilidad * 0.19;
            result.aiuTotal = result.admin + result.imprev + result.utilidad + result.ivaSobreUtilidad;
        } else if (details.taxType === 'iva') {
            result.iva = baseValue * 0.19;
        }
        return result;
    };

    const [itemsSnapshot, subItemsSnapshot, cortesAnterioresSnapshot] = await Promise.all([
        getDocs(query(collection(db, "items"), where("projectId", "==", proyecto.id))),
        getDocs(query(collection(db, "subItems"), where("projectId", "==", proyecto.id))),
        getDocs(query(collection(db, "projects", proyecto.id, "cortes"), where("status", "==", "aprobado"), where("corteNumber", "<", corte.corteNumber)))
    ]);
    const allItems = new Map(itemsSnapshot.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    const allSubItems = new Map(subItemsSnapshot.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    const subItemsEjecutadosAntes = new Set();
    cortesAnterioresSnapshot.forEach(doc => { doc.data().subItemIds.forEach(id => subItemsEjecutadosAntes.add(id)); });

    // --- Cabecera del PDF (sin cambios) ---
    let reportTitle = `ACTA DE CORTE DE OBRA`;
    if (exportType === 'suministro') reportTitle = `ACTA DE CORTE DE SUMINISTRO`;
    if (exportType === 'instalacion') reportTitle = `ACTA DE CORTE DE INSTALACIÓN`;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`CONTRATISTA:`, 14, 15); doc.text(`CONTRATANTE:`, 14, 20); doc.text(`PROYECTO:`, 14, 25);
    doc.setFont("helvetica", "normal");
    doc.text(`DISTRIBUIDORA ALUMINIO Y VIDRIOS EXITO SAS`, 50, 15);
    doc.text(proyecto.builderName || 'No especificado', 50, 20);
    doc.text(proyecto.name, 50, 25);
    doc.setFont("helvetica", "bold");
    doc.text(`No Acta:`, 230, 15); doc.text(`FECHA:`, 230, 20);
    doc.setFont("helvetica", "normal");
    doc.text(`${corte.corteNumber}`, 250, 15);
    doc.text(new Date(corte.createdAt.seconds * 1000).toLocaleDateString('es-CO'), 250, 20);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`${reportTitle} - ${proyecto.name}`, doc.internal.pageSize.getWidth() / 2, 35, { align: 'center' });

    const body = [];
    const subItemsEnCorteSet = new Set(corte.subItemIds);
    let totalValorContratado = 0, totalValorEjecutadoAcumulado = 0, totalValorEjecutadoCorte = 0, totalValorSaldo = 0;

    // ======================================================
    //      INICIO: LÓGICA DE CÁLCULO DE TOTALES PARA RESUMEN (NUEVO)
    // ======================================================
    let subTotalCorteSinImpuestos = 0;
    let aiuDetailsCorte = { admin: 0, imprev: 0, utilidad: 0, ivaSobreUtilidad: 0, aiuA: 0, aiuI: 0, aiuU: 0 };
    let totalIvaCorte = 0;

    allItems.forEach(item => {
        const subItemsDeEsteItem = Array.from(allSubItems.values()).filter(si => si.itemId === item.id);
        const subItemsEnEsteCorte = subItemsDeEsteItem.filter(si => subItemsEnCorteSet.has(si.id));
        const ejecutadosEnEsteCorte = subItemsEnEsteCorte.length;
        const ejecutadosAntes = subItemsDeEsteItem.filter(si => subItemsEjecutadosAntes.has(si.id)).length;
        const ejecutadoAcumulado = ejecutadosAntes + ejecutadosEnEsteCorte;
        const saldo = item.quantity - ejecutadoAcumulado;

        let valorUnitarioSinImpuestos = 0, valorUnitarioTotalConImpuestos = 0, detallesDePrecio = null;

        if (exportType === 'completo') { detallesDePrecio = item.includedDetails; }
        else if (exportType === 'suministro') { detallesDePrecio = item.supplyDetails; }
        else if (exportType === 'instalacion') { detallesDePrecio = item.installationDetails; }

        if (detallesDePrecio) {
            valorUnitarioSinImpuestos = detallesDePrecio.unitPrice || 0;
            const tax = calculateTaxDetails(detallesDePrecio, valorUnitarioSinImpuestos);
            valorUnitarioTotalConImpuestos = valorUnitarioSinImpuestos + tax.iva + tax.aiuTotal;
        }

        let valorTotalEjecutadoCorteItem = 0;

        if (ejecutadosEnEsteCorte > 0) {
            subItemsEnEsteCorte.forEach(subItem => {
                let valorSubItemSinImpuestos = valorUnitarioSinImpuestos;

                if (corte.usadoMedidaReal && subItem.realWidth > 0 && subItem.realHeight > 0) {
                    const areaContratada = item.width * item.height;
                    const areaReal = subItem.realWidth * subItem.realHeight;
                    if (areaContratada > 0) {
                        valorSubItemSinImpuestos = (valorUnitarioSinImpuestos / areaContratada) * areaReal;
                    }
                }

                subTotalCorteSinImpuestos += valorSubItemSinImpuestos;
                const taxSubItem = calculateTaxDetails(detallesDePrecio, valorSubItemSinImpuestos);
                totalIvaCorte += taxSubItem.iva;
                aiuDetailsCorte.admin += taxSubItem.admin;
                aiuDetailsCorte.imprev += taxSubItem.imprev;
                aiuDetailsCorte.utilidad += taxSubItem.utilidad;
                aiuDetailsCorte.ivaSobreUtilidad += taxSubItem.ivaSobreUtilidad;

                valorTotalEjecutadoCorteItem += valorSubItemSinImpuestos + taxSubItem.iva + taxSubItem.aiuTotal;
            });
            if (detallesDePrecio?.taxType === 'aiu') {
                aiuDetailsCorte.aiuA = detallesDePrecio.aiuA || 0;
                aiuDetailsCorte.aiuI = detallesDePrecio.aiuI || 0;
                aiuDetailsCorte.aiuU = detallesDePrecio.aiuU || 0;
            }
        }

        const valorTotalContratadoItem = valorUnitarioTotalConImpuestos * item.quantity;
        const valorTotalEjecutadoAcumuladoItem = valorUnitarioTotalConImpuestos * ejecutadoAcumulado;
        const valorTotalSaldoItem = valorUnitarioTotalConImpuestos * saldo;

        totalValorContratado += valorTotalContratadoItem;
        totalValorEjecutadoAcumulado += valorTotalEjecutadoAcumuladoItem;
        totalValorEjecutadoCorte += valorTotalEjecutadoCorteItem;
        totalValorSaldo += valorTotalSaldoItem;

        const descriptionText = (item.description || item.name).substring(0, 100);

        body.push([
            item.name, descriptionText, item.width, item.height,
            item.quantity, currencyFormatter.format(valorUnitarioTotalConImpuestos), currencyFormatter.format(valorTotalContratadoItem),
            ejecutadosEnEsteCorte, currencyFormatter.format(valorTotalEjecutadoCorteItem),
            ejecutadoAcumulado, currencyFormatter.format(valorTotalEjecutadoAcumuladoItem),
            saldo, currencyFormatter.format(valorTotalSaldoItem)
        ]);
    });

    const headStyles = { fontStyle: 'bold', halign: 'center', valign: 'middle', fillColor: [52, 73, 94], textColor: 255 };
    const subheadStyles = { fontStyle: 'bold', halign: 'center', valign: 'middle', fillColor: [236, 240, 241], textColor: 0 };
    doc.autoTable({
        startY: 45,
        head: [
            [{ content: 'CONTRATADO', colSpan: 7, styles: headStyles }, { content: 'EJECUTADO CORTE ACTUAL', colSpan: 2, styles: { ...headStyles, fillColor: [22, 160, 133] } }, { content: 'EJECUTADO ACUMULADO', colSpan: 2, styles: { ...headStyles, fillColor: [41, 128, 185] } }, { content: 'SALDO POR EJECUTAR', colSpan: 2, styles: { ...headStyles, fillColor: [192, 57, 43] } }],
            [{ content: 'Item', styles: subheadStyles }, { content: 'Descripción', styles: subheadStyles }, { content: 'Ancho', styles: subheadStyles }, { content: 'Alto', styles: subheadStyles }, { content: 'Cant.', styles: subheadStyles }, { content: 'Vlr. Unit', styles: subheadStyles }, { content: 'Vlr. Total', styles: subheadStyles }, { content: 'Cant.', styles: subheadStyles }, { content: 'Valor', styles: subheadStyles }, { content: 'Cant.', styles: subheadStyles }, { content: 'Valor', styles: subheadStyles }, { content: 'Cant.', styles: subheadStyles }, { content: 'Valor', styles: subheadStyles }]
        ],
        body: body,
        foot: [
            [{ content: 'TOTALES', colSpan: 6, styles: { halign: 'right', fontStyle: 'bold' } }, { content: currencyFormatter.format(totalValorContratado), styles: { fontStyle: 'bold', halign: 'center' } }, '', { content: currencyFormatter.format(totalValorEjecutadoCorte), styles: { fontStyle: 'bold', halign: 'center' } }, '', { content: currencyFormatter.format(totalValorEjecutadoAcumulado), styles: { fontStyle: 'bold', halign: 'center' } }, '', { content: currencyFormatter.format(totalValorSaldo), styles: { fontStyle: 'bold', halign: 'center' } }]
        ],
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, halign: 'center', valign: 'middle' },
        footStyles: { fillColor: [236, 240, 241], textColor: 0 }
    });

    let finalY = doc.autoTable.previous.finalY;
    if (finalY > 180) { doc.addPage(); finalY = 20; } else { finalY += 7; }

    const summaryBody = [];
    summaryBody.push(['SUB TOTAL (Valor Ejecutado en Corte)', currencyFormatter.format(subTotalCorteSinImpuestos)]);
    if (totalIvaCorte > 0) summaryBody.push(['IVA (19%)', currencyFormatter.format(totalIvaCorte)]);
    if (aiuDetailsCorte.admin > 0 || aiuDetailsCorte.imprev > 0) {
        summaryBody.push([`Administración (${aiuDetailsCorte.aiuA}%)`, currencyFormatter.format(aiuDetailsCorte.admin)]);
        summaryBody.push([`Imprevistos (${aiuDetailsCorte.aiuI}%)`, currencyFormatter.format(aiuDetailsCorte.imprev)]);
        summaryBody.push([`Utilidad (${aiuDetailsCorte.aiuU}%)`, currencyFormatter.format(aiuDetailsCorte.utilidad)]);
        summaryBody.push(["IVA (19%) s/Utilidad", currencyFormatter.format(aiuDetailsCorte.ivaSobreUtilidad)]);
    }
    summaryBody.push([{ content: "TOTAL BRUTO CORTE", styles: { fontStyle: 'bold' } }, { content: currencyFormatter.format(totalValorEjecutadoCorte), styles: { fontStyle: 'bold' } }]);

    let totalAPagar = totalValorEjecutadoCorte;
    if (corte.amortizacion > 0) { summaryBody.push(["Amortización Anticipo", `(${currencyFormatter.format(corte.amortizacion)})`]); totalAPagar -= corte.amortizacion; }
    if (corte.otrosDescuentos && corte.otrosDescuentos.length > 0) { corte.otrosDescuentos.forEach(d => { summaryBody.push([`Descuento (${d.concept})`, `(${currencyFormatter.format(d.value)})`]); totalAPagar -= d.value; }); }
    summaryBody.push([{ content: "TOTAL A PAGAR", styles: { fontStyle: 'bold' } }, { content: currencyFormatter.format(totalAPagar), styles: { fontStyle: 'bold' } }]);

    doc.autoTable({
        startY: finalY, body: summaryBody, theme: 'plain', tableWidth: 100,
        margin: { left: 180 }, styles: { fontSize: 9 }, columnStyles: { 0: { halign: 'right' }, 1: { halign: 'right' } }
    });

    doc.save(`Memoria_Corte_${corte.corteNumber}_${proyecto.name}_${exportType}.pdf`);
}
// =================== FINALIZA CÓDIGO AÑADIDO ===================


// ====================================================================
//      INICIO: FUNCIÓN PARA CALCULAR EL VALOR TOTAL DE ÍTEMS
// ====================================================================
/**
 * Calcula la suma del valor total de todos los ítems de un proyecto.
 * @param {string} projectId - El ID del proyecto.
 * @returns {Promise<number>} - El valor total contratado.
 */
async function calculateProjectContractedValue(projectId) {
    let totalValue = 0;
    const itemsQuery = query(collection(db, "items"), where("projectId", "==", projectId));
    const querySnapshot = await getDocs(itemsQuery);

    querySnapshot.forEach(doc => {
        const item = doc.data();
        totalValue += calculateItemTotal(item);
    });

    return totalValue;
}
// ====================================================================
//      FIN: FUNCIÓN
// ====================================================================

// ====================================================================
//      INICIO: FUNCIONES DE CÁLCULO DE PRECIO CORREGIDAS
// ====================================================================

// REEMPLAZA tu función calculateItemUnitPrice con esta:
function calculateItemUnitPrice(item) {
    let unitPrice = 0;
    // Lógica nueva: revisa primero si es de tipo "incluido"
    if (item.itemType === 'suministro_instalacion_incluido') {
        unitPrice = item.includedDetails?.unitPrice || 0;
    } else {
        // Lógica anterior para los otros tipos
        if (item.itemType === 'suministro_instalacion') { // Asumiendo que este es el tipo para precios separados
            unitPrice += item.supplyDetails?.unitPrice || 0;
            unitPrice += item.installationDetails?.unitPrice || 0;
        }
        // Aquí podrías añadir lógica para 'solo suministro' o 'solo instalación' si existieran
    }
    return unitPrice;
}

// REEMPLAZA tu función calculateItemTotal con esta:
function calculateItemTotal(item) {
    let total = 0;

    const calculatePartTotal = (details, quantity) => {
        if (!details || !details.unitPrice) {
            return 0;
        }
        const subtotal = details.unitPrice * quantity;
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

    // Lógica nueva: revisa primero si es de tipo "incluido"
    if (item.itemType === 'suministro_instalacion_incluido') {
        total = calculatePartTotal(item.includedDetails, item.quantity);
    } else {
        // Lógica anterior para precios separados
        total += calculatePartTotal(item.supplyDetails, item.quantity);
        total += calculatePartTotal(item.installationDetails, item.quantity);
    }

    return total;
}
// ====================================================================
//      FIN: FUNCIONES CORREGIDAS
// ====================================================================

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

// ====================================================================
//      INICIO: FUNCIONES createItem Y updateItem CORREGIDAS
// ====================================================================

// REEMPLAZA TU FUNCIÓN createItem CON ESTA:
async function createItem(data) {
    // 1. Leemos el modelo de precios del proyecto actual
    const projectPricingModel = currentProject.pricingModel || 'separado';

    const newItem = {
        name: data.name,
        description: data.description, // <-- AÑADE ESTA LÍNEA

        quantity: parseInt(data.quantity),
        width: parseFloat(data.width),
        height: parseFloat(data.height),
        // 2. Asignamos el itemType basado en el modelo del proyecto, no del formulario
        itemType: projectPricingModel === 'incluido' ? 'suministro_instalacion_incluido' : 'suministro_instalacion',
        projectId: currentProject.id,
        ownerId: currentUser.uid,
        createdAt: new Date()
    };

    // 3. Guardamos los detalles de precio correctos
    if (projectPricingModel === 'incluido') {
        newItem.includedDetails = {
            unitPrice: parseFloat(data.included_unitPrice?.replace(/[$. ]/g, '')) || 0,
            taxType: data.included_taxType || 'none',
            aiuA: parseFloat(data.included_aiuA) || 0,
            aiuI: parseFloat(data.included_aiuI) || 0,
            aiuU: parseFloat(data.included_aiuU) || 0
        };
        newItem.supplyDetails = {};
        newItem.installationDetails = {};
    } else {
        newItem.supplyDetails = {
            unitPrice: parseFloat(data.supply_unitPrice?.replace(/[$. ]/g, '')) || 0,
            taxType: data.supply_taxType || 'none',
            aiuA: parseFloat(data.supply_aiuA) || 0,
            aiuI: parseFloat(data.supply_aiuI) || 0,
            aiuU: parseFloat(data.supply_aiuU) || 0
        };
        newItem.installationDetails = {
            unitPrice: parseFloat(data.installation_unitPrice?.replace(/[$. ]/g, '')) || 0,
            taxType: data.installation_taxType || 'none',
            aiuA: parseFloat(data.installation_aiuA) || 0,
            aiuI: parseFloat(data.installation_aiuI) || 0,
            aiuU: parseFloat(data.installation_aiuU) || 0
        };
        newItem.includedDetails = {};
    }

    const itemRef = await addDoc(collection(db, "items"), newItem);

    // La lógica para crear sub-ítems no cambia
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
    const projectPricingModel = currentProject.pricingModel || 'separado';

    const updatedData = {
        name: data.name,
        description: data.description, // <-- AÑADE ESTA LÍNEA

        width: parseFloat(data.width),
        height: parseFloat(data.height),
        // LÍNEA CORREGIDA: Asignamos el tipo basado en el modelo del proyecto
        itemType: projectPricingModel === 'incluido' ? 'suministro_instalacion_incluido' : 'suministro_instalacion',
    };

    if (projectPricingModel === 'incluido') {
        updatedData.includedDetails = {
            unitPrice: parseFloat(data.included_unitPrice?.replace(/[$. ]/g, '')) || 0,
            taxType: data.included_taxType || 'none',
            aiuA: parseFloat(data.included_aiuA) || 0,
            aiuI: parseFloat(data.included_aiuI) || 0,
            aiuU: parseFloat(data.included_aiuU) || 0
        };
        updatedData.supplyDetails = {};
        updatedData.installationDetails = {};
    } else {
        updatedData.supplyDetails = {
            unitPrice: parseFloat(data.supply_unitPrice?.replace(/[$. ]/g, '')) || 0,
            taxType: data.supply_taxType || 'none',
            aiuA: parseFloat(data.supply_aiuA) || 0,
            aiuI: parseFloat(data.supply_aiuI) || 0,
            aiuU: parseFloat(data.supply_aiuU) || 0
        };
        updatedData.installationDetails = {
            unitPrice: parseFloat(data.installation_unitPrice?.replace(/[$. ]/g, '')) || 0,
            taxType: data.installation_taxType || 'none',
            aiuA: parseFloat(data.installation_aiuA) || 0,
            aiuI: parseFloat(data.installation_aiuI) || 0,
            aiuU: parseFloat(data.installation_aiuU) || 0
        };
        updatedData.includedDetails = {};
    }

    await updateDoc(doc(db, "items", itemId), updatedData);
    closeMainModal();
}
// ====================================================================
//      FIN: FUNCIONES CORREGIDAS
// ====================================================================

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

    if (unsubscribeSubItems) unsubscribeSubItems();

    unsubscribeSubItems = onSnapshot(q, (querySnapshot) => {
        loadingDiv.classList.add('hidden');
        subItemsTableBody.innerHTML = '';

        const docs = querySnapshot.docs.sort((a, b) => {
            const numA = a.data()?.number || 0;
            const numB = b.data()?.number || 0;
            return numA - numB;
        });

        if (docs.length === 0) {
            subItemsTableBody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-gray-500">No hay sub-ítems para mostrar.</td></tr>`;
            return;
        }

        docs.forEach(subItemDoc => {
            try {
                const subItem = { id: subItemDoc.id, ...subItemDoc.data() };
                subItemsTableBody.appendChild(createSubItemRow(subItem));
            } catch (error) {
                console.error("Error al procesar el subítem:", subItemDoc.id, error);
                const errorRow = document.createElement('tr');
                errorRow.innerHTML = `<td colspan="8" class="text-center py-4 text-red-500 font-semibold">Error al cargar este subítem (ID: ${subItemDoc.id}).</td>`;
                subItemsTableBody.appendChild(errorRow);
            }
        });
    }, (error) => {
        console.error("Error al cargar la lista de sub-ítems:", error);
        subItemsTableBody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-red-500">Ocurrió un error al cargar los datos.</td></tr>`;
    });
}

function createSubItemRow(subItem) {
    const row = document.createElement('tr');
    row.className = 'bg-white border-b hover:bg-gray-50';

    // Búsqueda segura de nombres de usuario
    const manufacturerData = usersMap.get(subItem.manufacturer);
    const installerData = usersMap.get(subItem.installer);

    // Si el usuario existe, muestra su nombre, si no, muestra 'N/A'
    const manufacturerName = manufacturerData ? `${manufacturerData.firstName} ${manufacturerData.lastName}` : 'N/A';
    const installerName = installerData ? `${installerData.firstName} ${installerData.lastName}` : 'N/A';

    let statusText = subItem.status || 'Pendiente de Fabricación';
    let statusColor;
    switch (statusText) {
        case 'Instalado': statusColor = 'bg-green-100 text-green-800'; break;
        case 'Pendiente de Instalación': statusColor = 'bg-yellow-100 text-yellow-800'; break;
        case 'Faltante de Evidencia': statusColor = 'bg-orange-100 text-orange-800'; break;
        default: statusColor = 'bg-red-100 text-red-800'; break;
    }

    let photoHtml = 'N/A';
    if (subItem.photoURL) {
        photoHtml = `<button class="view-photo-btn text-blue-600 hover:underline font-semibold" data-photourl="${subItem.photoURL}">Ver</button>`;
        if (currentUserRole === 'admin') {
            photoHtml += `<button class="delete-photo-btn text-red-600 hover:underline font-semibold ml-2" data-subitemid="${subItem.id}" data-itemid="${subItem.itemId}" data-projectid="${subItem.projectId}" data-installerid="${subItem.installer}">Eliminar</button>`;
        }
    }

    row.innerHTML = `
        <td class="px-6 py-4">
            <input type="checkbox" class="subitem-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded" data-id="${subItem.id}">
        </td>
        <td class="px-6 py-4 font-bold text-gray-900">${subItem.number || 'N/A'}</td>
        <td class="px-6 py-4">${subItem.location || 'N/A'}</td>
        <td class="px-6 py-4">${manufacturerName}</td>
        <td class="px-6 py-4">${installerName}</td>
        <td class="px-6 py-4">${subItem.installDate || 'N/A'}</td>
        <td class="px-6 py-4 text-center"><span class="text-xs font-medium mr-2 px-2.5 py-0.5 rounded-full ${statusColor}">${statusText}</span></td>
        <td class="px-6 py-4 text-center">${photoHtml}</td>
        <td class="px-6 py-4 text-center"><button class="register-progress-btn bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-1 px-3 rounded-full">Avance Individual</button></td>
    `;

    if (subItem.photoURL) {
        row.querySelector('.view-photo-btn').addEventListener('click', (e) => {
            openImageModal(e.target.dataset.photourl);
        });
        if (currentUserRole === 'admin') {
            const deleteBtn = row.querySelector('.delete-photo-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    openConfirmModal(`¿Seguro que quieres eliminar esta foto de evidencia?`, () => {
                        handleDeletePhoto(e.target.dataset.subitemid, e.target.dataset.itemid, e.target.dataset.installerid, e.target.dataset.projectid);
                    });
                });
            }
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

                        <div class="border-t pt-4">
                            <label class="block text-sm font-medium text-gray-700">Modelo de Contrato</label>
                            <div class="mt-2 flex space-x-4">
                                <label class="flex items-center">
                                    <input type="radio" name="pricingModel" value="separado" class="mr-2" checked>
                                    <span>Suministro e Instalación (Separado)</span>
                                </label>
                                <label class="flex items-center">
                                    <input type="radio" name="pricingModel" value="incluido" class="mr-2">
                                    <span>Suministro e Instalación (Incluido)</span>
                                </label>
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
        case 'editProjectInfo':
            title = 'Editar Información del Proyecto';
            btnText = 'Guardar Cambios';
            btnClass = 'bg-yellow-500 hover:bg-yellow-600';
            bodyHtml = `
            <div class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium">Nombre del Proyecto</label>
                        <input type="text" name="name" required class="mt-1 w-full border rounded-md p-2" value="${data.name || ''}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Constructora</label>
                        <input type="text" name="builderName" required class="mt-1 w-full border rounded-md p-2" value="${data.builderName || ''}">
                    </div>
                </div>
                
                <div class="relative">
                    <label for="project-location" class="block text-sm font-medium">Ubicación (Municipio)</label>
                    <input type="text" id="project-location" name="location" required class="mt-1 w-full border rounded-md p-2" autocomplete="off" value="${data.location || ''}">
                    <div id="municipalities-results" class="municipality-search-results hidden"></div>
                </div>

                <div>
                    <label for="project-address" class="block text-sm font-medium">Dirección</label>
                    <input type="text" id="project-address" name="address" required class="mt-1 w-full border rounded-md p-2" value="${data.address || ''}">
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium">Valor del Contrato</label>
                        <input type="text" name="value" class="mt-1 w-full border rounded-md p-2" value="${data.value || 0}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Anticipo</label>
                        <input type="text" name="advance" class="mt-1 w-full border rounded-md p-2" value="${data.advance || 0}">
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-4 border-t pt-4">
                    <div>
                        <label class="block text-sm font-medium">Inicio Contrato</label>
                        <input type="date" name="startDate" class="mt-1 w-full border rounded-md p-2" value="${data.startDate || ''}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Acta de Inicio</label>
                        <input type="date" name="kickoffDate" class="mt-1 w-full border rounded-md p-2" value="${data.kickoffDate || ''}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Fin Contrato</label>
                        <input type="date" name="endDate" class="mt-1 w-full border rounded-md p-2" value="${data.endDate || ''}">
                    </div>
                </div>
            </div>`;

            setTimeout(() => {
                // Lógica para el formato de moneda
                const valueInput = modalForm.querySelector('input[name="value"]');
                const advanceInput = modalForm.querySelector('input[name="advance"]');
                setupCurrencyInput(valueInput);
                setupCurrencyInput(advanceInput);

                // Lógica para el buscador de municipios (reutilizada de "Nuevo Proyecto")
                const inputLocation = document.getElementById('project-location');
                const resultsContainer = document.getElementById('municipalities-results');
                fetchMunicipalities(); // Asegura que los municipios estén disponibles
                inputLocation.addEventListener('input', async () => {
                    const municipalities = await fetchMunicipalities();
                    resultsContainer.innerHTML = '';
                    const query = inputLocation.value;
                    if (query.length === 0) {
                        resultsContainer.classList.add('hidden');
                        return;
                    }
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
            }, 100);

            break;
        case 'return-material': {
            title = 'Registrar Devolución de Material';
            btnText = 'Confirmar Devolución';
            btnClass = 'bg-yellow-500 hover:bg-yellow-600';
            const maxReturn = data.quantity - (data.returnedQuantity || 0);
            bodyHtml = `
        <div class="space-y-4">
            <p class="text-sm">Material: <span class="font-bold">${data.materialName}</span></p>
            <p class="text-sm">Cantidad Solicitada Originalmente: <span class="font-bold">${data.quantity}</span></p>
            <p class="text-sm">Cantidad Máxima a Devolver: <span class="font-bold">${maxReturn}</span></p>
            <div>
                <label class="block text-sm font-medium">Cantidad a Devolver</label>
                <input type="number" name="quantityToReturn" required class="mt-1 w-full border p-2 rounded-md" max="${maxReturn}" min="1">
            </div>
        </div>`;
            break;
        }
        case 'add-catalog-item':
        case 'edit-catalog-item': {
            const isEditing = type === 'edit-catalog-item';
            title = isEditing ? 'Editar Material del Catálogo' : 'Añadir Nuevo Material al Catálogo';
            btnText = isEditing ? 'Guardar Cambios' : 'Añadir Material';
            btnClass = isEditing ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-blue-500 hover:bg-blue-600';
            bodyHtml = `
        <div class="space-y-4">
            <div><label class="block text-sm font-medium">Nombre del Material</label><input type="text" name="name" required class="mt-1 w-full border p-2 rounded-md" value="${isEditing ? data.name : ''}"></div>
            <div><label class="block text-sm font-medium">Referencia / SKU (Opcional)</label><input type="text" name="reference" class="mt-1 w-full border p-2 rounded-md" value="${isEditing ? data.reference : ''}"></div>
            <div class="grid grid-cols-2 gap-4">
                <div><label class="block text-sm font-medium">Unidad de Medida</label><input type="text" name="unit" required class="mt-1 w-full border p-2 rounded-md" value="${isEditing ? data.unit : ''}" placeholder="Metros, Unidades..."></div>
                <div><label class="block text-sm font-medium">Umbral de Stock Mínimo</label><input type="number" name="minStockThreshold" class="mt-1 w-full border p-2 rounded-md" value="${isEditing ? data.minStockThreshold || '' : ''}" placeholder="Ej: 10"></div>
            </div>
        </div>`;
            break;
        }
        case 'addInterestPerson':
            title = 'Añadir Persona de Interés';
            btnText = 'Guardar Persona';
            btnClass = 'bg-blue-500 hover:bg-blue-600';
            bodyHtml = `
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium">Nombre Completo</label>
                        <input type="text" name="name" required class="mt-1 w-full border rounded-md p-2">
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Cargo</label>
                        <select name="position" required class="mt-1 w-full border rounded-md p-2 bg-white">
                            <option value="" disabled selected>Selecciona un cargo...</option>
                            <option value="Director de obra">Director de obra</option>
                            <option value="Residente de obra">Residente de obra</option>
                            <option value="Maestro de obra">Maestro de obra</option>
                            <option value="SST residente">SST residente</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Correo Electrónico</label>
                        <input type="email" name="email" class="mt-1 w-full border rounded-md p-2">
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Teléfono</label>
                        <input type="tel" name="phone" class="mt-1 w-full border rounded-md p-2">
                    </div>
                </div>`;
            break;
        case 'add-anticipo-payment':
            title = 'Abonar al Anticipo';
            btnText = 'Guardar Abono';
            btnClass = 'bg-blue-500 hover:bg-blue-600';
            bodyHtml = `
                <p class="text-sm mb-4">Estás a punto de registrar un pago que se aplicará directamente al <strong>anticipo</strong> del contrato.</p>
                <input type="hidden" name="type" value="abono_anticipo">
                <div><label class="block text-sm font-medium">Valor del Abono</label><input type="text" name="amount" required class="currency-input mt-1 w-full border rounded-md p-2"></div>
                <div class="mt-4"><label class="block text-sm font-medium">Fecha del Abono</label><input type="date" name="date" required class="mt-1 w-full border rounded-md p-2"></div>`;

            setTimeout(() => {
                setupCurrencyInput(modalForm.querySelector('input[name="amount"]'));
                modalForm.querySelector('input[name="date"]').value = new Date().toISOString().split('T')[0];
            }, 100);
            break;

        case 'add-corte-payment':
            title = `Abonar al Corte #${data.corteNumber}`;
            btnText = 'Guardar Abono';
            btnClass = 'bg-blue-500 hover:bg-blue-600';
            bodyHtml = `
                <p class="text-sm mb-4">Estás registrando un pago para el <strong>Corte #${data.corteNumber}</strong>.</p>
                <input type="hidden" name="type" value="abono_corte">
                <input type="hidden" name="targetId" value="${data.corteId}">
                <div><label class="block text-sm font-medium">Valor del Abono</label><input type="text" name="amount" required class="currency-input mt-1 w-full border rounded-md p-2"></div>
                <div class="mt-4"><label class="block text-sm font-medium">Fecha del Abono</label><input type="date" name="date" required class="mt-1 w-full border rounded-md p-2"></div>`;

            setTimeout(() => {
                setupCurrencyInput(modalForm.querySelector('input[name="amount"]'));
                modalForm.querySelector('input[name="date"]').value = new Date().toISOString().split('T')[0];
            }, 100);
            break;
        case 'new-purchase-order': {
            title = 'Crear Orden de Compra';
            btnText = 'Guardar Orden';
            btnClass = 'bg-blue-500 hover:bg-blue-600';

            // Preparamos las opciones del catálogo para el desplegable
            const materialOptions = data.catalog.map(mat => `<option value="${mat.id}" data-unit="${mat.unit}">${mat.name} (${mat.reference})</option>`).join('');

            bodyHtml = `
                <div class="space-y-4">
                    <div><label class="block text-sm font-medium">Proveedor</label><input type="text" name="provider" required class="mt-1 w-full border p-2 rounded-md"></div>
                    <div id="po-items-container" class="space-y-2 border-t pt-4">
                        <div class="po-item flex items-end gap-2">
                            <div class="flex-grow"><label class="block text-xs">Material</label><select name="materialId" class="po-material-select w-full border p-2 rounded-md bg-white">${materialOptions}</select></div>
                            <div><label class="block text-xs">Cantidad</label><input type="number" name="quantity" required class="w-24 border p-2 rounded-md"></div>
                            <div><label class="block text-xs">Costo Unitario</label><input type="text" name="unitCost" required class="currency-input w-32 border p-2 rounded-md"></div>
                            <div class="pb-2"><span class="unit-display text-sm text-gray-500"></span></div>
                        </div>
                    </div>
                    <button type="button" id="add-po-item-btn" class="text-sm text-blue-600 font-semibold">+ Añadir otro material</button>
                </div>`;

            setTimeout(() => {
                // Lógica para añadir más items a la PO y actualizar unidades/formato de moneda
                const container = document.getElementById('po-items-container');
                const firstItem = container.querySelector('.po-item');
                document.getElementById('add-po-item-btn').addEventListener('click', () => {
                    const newItem = firstItem.cloneNode(true);
                    newItem.querySelectorAll('input').forEach(input => input.value = '');
                    container.appendChild(newItem);
                });
                // Listener para actualizar la unidad y aplicar formato de moneda dinámicamente
                container.addEventListener('change', (e) => {
                    if (e.target.classList.contains('po-material-select')) {
                        const selectedOption = e.target.options[e.target.selectedIndex];
                        e.target.closest('.po-item').querySelector('.unit-display').textContent = selectedOption.dataset.unit;
                    }
                });
                container.addEventListener('input', (e) => {
                    if (e.target.classList.contains('currency-input')) {
                        setupCurrencyInput(e.target);
                    }
                });
            }, 100);
            break;
        }
        case 'add-other-payment':
            title = 'Registrar Otro Movimiento';
            btnText = 'Guardar Movimiento';
            btnClass = 'bg-green-500 hover:bg-green-600';
            bodyHtml = `
                <p class="text-sm mb-4">Usa esta opción para registrar movimientos que no son abonos a cortes, como <strong>adelantos</strong>.</p>
                <input type="hidden" name="type" value="otro">
                <div><label class="block text-sm font-medium">Concepto</label><input type="text" name="concept" required class="mt-1 w-full border rounded-md p-2" placeholder="Ej: Adelanto semana 25"></div>
                <div class="mt-4"><label class="block text-sm font-medium">Valor</label><input type="text" name="amount" required class="currency-input mt-1 w-full border rounded-md p-2"></div>
                <div class="mt-4"><label class="block text-sm font-medium">Fecha</label><input type="date" name="date" required class="mt-1 w-full border rounded-md p-2"></div>`;

            setTimeout(() => {
                setupCurrencyInput(modalForm.querySelector('input[name="amount"]'));
                modalForm.querySelector('input[name="date"]').value = new Date().toISOString().split('T')[0];
            }, 100);
            break;
        case 'addItem':
        case 'editItem': {
            const isEditing = type === 'editItem';
            title = isEditing ? 'Editar Ítem' : 'Añadir Nuevo Ítem';
            btnText = isEditing ? 'Guardar Cambios' : 'Añadir Ítem';
            btnClass = isEditing ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-green-500 hover:bg-green-600';

            // Plantilla para la sección de costo SEPARADO
            const costSectionSeparated = (section, title, data = {}) => `
        <div class="border rounded-lg p-3 mt-2">
            <p class="font-semibold">${title}</p>
            <div class="grid grid-cols-2 gap-4 mt-2">
                <div>
                    <label class="block text-xs font-medium">Precio Unitario</label>
                    <input type="text" name="${section}_unitPrice" class="currency-input mt-1 w-full border rounded-md p-2" value="${data.unitPrice || ''}">
                </div>
                <div>
                    <label class="block text-xs font-medium">Impuesto</label>
                    <div class="mt-2 flex space-x-2">
                        <label class="flex items-center text-xs"><input type="radio" name="${section}_taxType" value="iva" class="mr-1 tax-type-radio" ${data.taxType === 'iva' ? 'checked' : ''}> IVA</label>
                        <label class="flex items-center text-xs"><input type="radio" name="${section}_taxType" value="aiu" class="mr-1 tax-type-radio" ${data.taxType === 'aiu' ? 'checked' : ''}> AIU</label>
                    </div>
                </div>
            </div>
            <div class="aiu-fields hidden space-y-2 mt-3">
                <div class="grid grid-cols-3 gap-2">
                    <div><label class="block text-xs">A(%)</label><input type="number" name="${section}_aiuA" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuA || ''}"></div>
                    <div><label class="block text-xs">I(%)</label><input type="number" name="${section}_aiuI" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuI || ''}"></div>
                    <div><label class="block text-xs">U(%)</label><input type="number" name="${section}_aiuU" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuU || ''}"></div>
                </div>
            </div>
        </div>`;

            // Plantilla para la sección de costo INCLUIDO
            const costSectionIncluded = (data = {}) => `
        <div class="border rounded-lg p-3 mt-2">
            <p class="font-semibold">Precio Total Incluido</p>
            <div class="grid grid-cols-2 gap-4 mt-2">
                <div>
                    <label class="block text-xs font-medium">Precio Unitario Total</label>
                    <input type="text" name="included_unitPrice" class="currency-input mt-1 w-full border rounded-md p-2" value="${data.unitPrice || ''}">
                </div>
                <div>
                    <label class="block text-xs font-medium">Impuesto</label>
                    <div class="mt-2 flex space-x-2">
                        <label class="flex items-center text-xs"><input type="radio" name="included_taxType" value="iva" class="mr-1 tax-type-radio" ${data.taxType === 'iva' ? 'checked' : ''}> IVA</label>
                        <label class="flex items-center text-xs"><input type="radio" name="included_taxType" value="aiu" class="mr-1 tax-type-radio" ${data.taxType === 'aiu' ? 'checked' : ''}> AIU</label>
                    </div>
                </div>
            </div>
            <div class="aiu-fields hidden space-y-2 mt-3">
                <div class="grid grid-cols-3 gap-2">
                    <div><label class="block text-xs">A(%)</label><input type="number" name="included_aiuA" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuA || ''}"></div>
                    <div><label class="block text-xs">I(%)</label><input type="number" name="included_aiuI" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuI || ''}"></div>
                    <div><label class="block text-xs">U(%)</label><input type="number" name="included_aiuU" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuU || ''}"></div>
                </div>
            </div>
        </div>`;

            // --- LÓGICA PRINCIPAL: Decide qué formulario mostrar ---
            let pricingModelHtml = '';
            const projectPricingModel = currentProject.pricingModel || 'separado'; // 'separado' por defecto

            if (projectPricingModel === 'incluido') {
                pricingModelHtml = costSectionIncluded(isEditing ? data.includedDetails : {});
            } else {
                pricingModelHtml = `
            ${costSectionSeparated('supply', 'Detalles de Suministro', isEditing ? data.supplyDetails : {})}
            ${costSectionSeparated('installation', 'Detalles de Instalación', isEditing ? data.installationDetails : {})}
        `;
            }

            bodyHtml = `
        <div class="space-y-4">
            <div><label class="block text-sm font-medium">Nombre</label><input type="text" name="name" required class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.name : ''}"></div>
            
            <div>
                <label class="block text-sm font-medium">Descripción</label>
                <textarea name="description" rows="3" class="mt-1 w-full border rounded-md p-2" placeholder="Ej: Ventana corrediza sistema 744 con vidrio laminado 3+3mm, incoloro...">${isEditing ? (data.description || '') : ''}</textarea>
            </div>
            <div class="grid grid-cols-3 gap-4">
                <div><label class="block text-sm font-medium">Cantidad</label><input type="number" name="quantity" required min="1" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.quantity : ''}" ${isEditing ? 'readonly' : ''}></div>
                <div><label class="block text-sm font-medium">Ancho (m)</label><input type="number" name="width" required step="0.01" min="0" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.width : ''}"></div>
                <div><label class="block text-sm font-medium">Alto (m)</label><input type="number" name="height" required step="0.01" min="0" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.height : ''}"></div>
            </div>
            ${pricingModelHtml}
        </div>`;

            setTimeout(() => {
                const modalContent = document.getElementById('modal-body');
                const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

                modalContent.querySelectorAll('.currency-input').forEach(input => {
                    const formatCurrency = (e) => {
                        let value = e.target.value.replace(/[$. ]/g, '');
                        if (!isNaN(value) && value) e.target.value = currencyFormatter.format(value).replace(/\s/g, ' ');
                        else e.target.value = '';
                    };
                    input.addEventListener('input', formatCurrency);
                    if (input.value) formatCurrency({ target: input });
                });

                modalContent.querySelectorAll('.tax-type-radio').forEach(radio => {
                    const aiuFields = radio.closest('.border').querySelector('.aiu-fields');
                    if (aiuFields) {
                        const toggleAiu = () => aiuFields.classList.toggle('hidden', radio.value !== 'aiu');
                        radio.addEventListener('change', toggleAiu);
                        if (radio.checked) toggleAiu();
                    }
                });
            }, 100);
            break;
        }
        case 'add-catalog-item':
        case 'edit-catalog-item': {
            const isEditing = type === 'edit-catalog-item';
            title = isEditing ? 'Editar Material del Catálogo' : 'Añadir Nuevo Material al Catálogo';
            btnText = isEditing ? 'Guardar Cambios' : 'Añadir Material';
            btnClass = isEditing ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-blue-500 hover:bg-blue-600';
            bodyHtml = `
                <div class="space-y-4">
                    <div><label class="block text-sm font-medium">Nombre del Material</label><input type="text" name="name" required class="mt-1 w-full border p-2 rounded-md" value="${isEditing ? data.name : ''}"></div>
                    <div><label class="block text-sm font-medium">Referencia / SKU (Opcional)</label><input type="text" name="reference" class="mt-1 w-full border p-2 rounded-md" value="${isEditing ? data.reference : ''}"></div>
                    <div><label class="block text-sm font-medium">Unidad de Medida</label><input type="text" name="unit" required class="mt-1 w-full border p-2 rounded-md" value="${isEditing ? data.unit : ''}" placeholder="Metros, Unidades, Kilos..."></div>
                </div>`;
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
        case 'add-purchase':
            title = 'Registrar Compra en Inventario';
            btnText = 'Añadir a Inventario';
            btnClass = 'bg-blue-500 hover:bg-blue-600';
            bodyHtml = `
        <div class="space-y-4">
            <div><label class="block text-sm font-medium">Nombre del Material</label><input type="text" name="name" required class="mt-1 w-full border p-2 rounded-md"></div>
            <div><label class="block text-sm font-medium">Referencia (Opcional)</label><input type="text" name="reference" class="mt-1 w-full border p-2 rounded-md"></div>
            <div class="grid grid-cols-2 gap-4">
                <div><label class="block text-sm font-medium">Cantidad Comprada</label><input type="number" name="quantity" required class="mt-1 w-full border p-2 rounded-md"></div>
                <div><label class="block text-sm font-medium">Unidad</label><input type="text" name="unit" required class="mt-1 w-full border p-2 rounded-md" placeholder="Metros, Unidades..."></div>
            </div>
        </div>`;
            break;

        case 'request-material':
            title = 'Solicitar Material del Inventario General';
            btnText = 'Crear Solicitud';
            btnClass = 'bg-green-500 hover:bg-green-600';
            const materialOptions = data.inventory.map(mat => `<option value="${mat.id}">${mat.name} (${mat.quantity} ${mat.unit} en stock)</option>`).join('');
            const subItemOptions = data.subItems.map(si => `<option value="${si.id}">${si.parentName} - Unidad #${si.number}</option>`).join('');
            bodyHtml = `
        <div class="space-y-4">
            <div><label class="block text-sm font-medium">Material del Inventario</label><select name="materialId" required class="mt-1 w-full border p-2 rounded-md bg-white">${materialOptions}</select></div>
            <div><label class="block text-sm font-medium">Cantidad Solicitada</label><input type="number" name="quantity" required class="mt-1 w-full border p-2 rounded-md"></div>
            <div><label class="block text-sm font-medium">Vincular a Sub-Ítem</label><select name="subItemId" required class="mt-1 w-full border p-2 rounded-md bg-white">${subItemOptions}</select></div>
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
                startDate: data.startDate,
                kickoffDate: data.kickoffDate,
                endDate: data.endDate,
                // AÑADE ESTA LÍNEA
                pricingModel: data.pricingModel, // <-- 'separado' o 'incluido'
                status: 'active'
            };
            await createProject(projectData);
            break;
        case 'editProjectInfo': // Asegúrate de que este bloque esté aquí
            const updatedData = {
                name: data.name,
                builderName: data.builderName,
                // Limpiamos los valores de moneda antes de guardarlos
                value: parseFloat(data.value.replace(/[$. ]/g, '')) || 0,
                advance: parseFloat(data.advance.replace(/[$. ]/g, '')) || 0,
                startDate: data.startDate,
                kickoffDate: data.kickoffDate,
                endDate: data.endDate,
            };
            await updateDoc(doc(db, "projects", id), updatedData);
            break;
        case 'addInterestPerson':
            const personData = {
                name: data.name,
                position: data.position,
                email: data.email,
                phone: data.phone
            };
            await addDoc(collection(db, "projects", currentProject.id, "peopleOfInterest"), personData);
            break;
        case 'back-to-project-details-cortes':
            showProjectDetails(currentProject);
            switchProjectTab('cortes');
            break;
        case 'view-corte-details':
            const corteId = button.dataset.corteId;
            const corteRef = doc(db, "projects", currentProject.id, "cortes", corteId);
            const corteSnap = await getDoc(corteRef);
            if (corteSnap.exists()) {
                showCorteDetails({ id: corteSnap.id, ...corteSnap.data() });
            }
            break;
case 'add-catalog-item': {
    const catalogData = {
        name: data.name,
        reference: data.reference,
        unit: data.unit,
        minStockThreshold: parseInt(data.minStockThreshold) || 0, // <-- AÑADE ESTA LÍNEA
        quantityInStock: 0
    };
    await addDoc(collection(db, "materialCatalog"), catalogData);
    break;
}
case 'edit-catalog-item': {
    const updatedData = {
        name: data.name,
        reference: data.reference,
        unit: data.unit,
        minStockThreshold: parseInt(data.minStockThreshold) || 0 // <-- AÑADE ESTA LÍNEA
    };
    await updateDoc(doc(db, "materialCatalog", id), updatedData);
    break;
}
        case 'return-material': {
            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = 'Procesando...';

            const returnData = {
                projectId: currentProject.id,
                requestId: id, // El id de la solicitud se guarda en el dataset del form
                quantityToReturn: parseInt(data.quantityToReturn)
            };

            try {
                const returnMaterial = httpsCallable(functions, 'returnMaterial');
                const result = await returnMaterial(returnData);

                alert(result.data.message);
                closeMainModal();
            } catch (error) {
                console.error("Error al llamar a la Cloud Function 'returnMaterial':", error);
                alert("Error: " + error.message);
            } finally {
                modalConfirmBtn.disabled = false;
            }
            break;
        }
        case 'new-purchase-order': {
            console.log("DEBUG: Paso 1 - Iniciando el guardado de la orden de compra.");
            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = 'Guardando...';

            try {
                const items = [];
                let totalCost = 0;

                console.log("DEBUG: Paso 2 - Obteniendo proveedor del formulario.");
                const provider = modalForm.querySelector('input[name="provider"]').value;
                console.log(`DEBUG: Proveedor encontrado: "${provider}"`);

                if (!provider) {
                    throw new Error("El campo 'Proveedor' es obligatorio.");
                }

                console.log("DEBUG: Paso 3 - Buscando los ítems de la orden en el DOM.");
                const itemElements = document.querySelectorAll('#po-items-container .po-item');
                console.log(`DEBUG: Se encontraron ${itemElements.length} elementos de ítem.`);

                itemElements.forEach((itemEl, index) => {
                    console.log(`DEBUG: Procesando ítem #${index + 1}`);
                    const materialId = itemEl.querySelector('select[name="materialId"]').value;
                    const quantity = parseInt(itemEl.querySelector('input[name="quantity"]').value);
                    const unitCostValue = itemEl.querySelector('input[name="unitCost"]').value;
                    const unitCost = parseFloat(unitCostValue.replace(/[$. ]/g, '')) || 0;

                    console.log(`DEBUG: Ítem #${index + 1} - Material ID: ${materialId}, Cantidad: ${quantity}, Costo Unitario: ${unitCost}`);

                    if (materialId && quantity > 0) {
                        items.push({ materialId, quantity, unitCost });
                        totalCost += quantity * unitCost;
                    }
                });

                console.log(`DEBUG: Paso 4 - Se procesaron ${items.length} ítems válidos.`);

                if (items.length === 0) {
                    throw new Error("Debes añadir al menos un material válido a la orden.");
                }

                const poData = {
                    provider: provider,
                    createdAt: new Date(),
                    createdBy: currentUser.uid,
                    status: 'pendiente',
                    items: items,
                    totalCost: totalCost
                };
                console.log("DEBUG: Paso 5 - Datos de la orden de compra listos para enviar:", poData);

                await addDoc(collection(db, "purchaseOrders"), poData);
                console.log("DEBUG: Paso 6 - ¡Datos enviados a Firestore con éxito!");

                alert("¡Orden de compra creada con éxito!");
                closeMainModal();

            } catch (error) {
                console.error("DEBUG ERROR CRÍTICO: Fallo al guardar la orden de compra:", error);
                alert("No se pudo guardar la orden de compra: " + error.message);
            } finally {
                console.log("DEBUG: Paso 7 - Bloque 'finally' ejecutado, reactivando botón.");
                modalConfirmBtn.disabled = false;
            }
            break;
        }

        // Y finalmente, la lógica para recibir la mercancía y actualizar el stock
        // Esta es una acción que irá en un futuro modal de "Ver PO", pero la preparamos aquí
        case 'receive-purchase-order': {
            const poId = button.dataset.id;
            const poRef = doc(db, "purchaseOrders", poId);

            try {
                await runTransaction(db, async (transaction) => {
                    const poDoc = await transaction.get(poRef);
                    if (!poDoc.exists() || poDoc.data().status !== 'pendiente') {
                        throw "Esta orden ya fue procesada o no existe.";
                    }

                    // Actualiza el stock de cada material en la orden
                    for (const item of poDoc.data().items) {
                        const materialRef = doc(db, "materialCatalog", item.materialId);
                        const materialDoc = await transaction.get(materialRef);
                        const newStock = (materialDoc.data().quantityInStock || 0) + item.quantity;
                        transaction.update(materialRef, { quantityInStock: newStock });
                    }

                    // Actualiza el estado de la orden
                    transaction.update(poRef, { status: 'recibida', receivedAt: new Date(), receivedBy: currentUser.uid });
                });
                alert("¡Orden de compra recibida y stock actualizado con éxito!");
            } catch (error) {
                console.error("Error al recibir la orden de compra:", error);
                alert("Error: " + error);
            }
            break;
        }
        case 'request-material': {
            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = 'Procesando...';

            const requestData = {
                projectId: currentProject.id,
                materialId: data.materialId,
                quantity: parseInt(data.quantity),
                subItemId: data.subItemId,
            };

            try {
                // Prepara y llama a la nueva Cloud Function
                const requestMaterial = httpsCallable(functions, 'requestMaterialFIFO');
                const result = await requestMaterial(requestData);

                alert(result.data.message);
                closeMainModal();

            } catch (error) {
                console.error("Error al llamar a la Cloud Function 'requestMaterialFIFO':", error);
                alert("Error al crear la solicitud: " + error.message);
            } finally {
                modalConfirmBtn.disabled = false;
            }
            break;
        }
        case 'add-anticipo-payment':
        case 'add-corte-payment':
        case 'add-other-payment':
            const paymentData = {
                amount: parseFloat(data.amount.replace(/[$. ]/g, '')) || 0,
                date: data.date,
                type: data.type, // 'abono_anticipo', 'abono_corte', u 'otro'
                targetId: data.targetId || null, // ID del corte si aplica
                concept: data.concept || `Abono a ${data.type === 'abono_anticipo' ? 'Anticipo' : `Corte #${modalForm.dataset.corteNumber}`}`, // Concepto automático o manual
            };
            modalForm.dataset.corteNumber = ''; // Limpiamos el dataset
            await addDoc(collection(db, "projects", currentProject.id, "payments"), paymentData);
            break;
        case 'view-image': // Para abrir el modal de la imagen
            const imageUrl = e.target.getAttribute('src');
            if (imageUrl) {
                openImageModal(imageUrl);
            }
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


// --- MODAL DE AVANCE INDIVIDUAL (SIMPLE Y DIRECTO) ---
async function openProgressModal(subItem) {
    const modal = document.getElementById('progress-modal');
    if (!modal) return;

    const form = modal.querySelector('#progress-modal-form');
    form.reset();
    form.dataset.id = subItem.id;
    form.dataset.itemid = subItem.itemId;

    modal.querySelector('#progress-modal-title').textContent = `Registrar Avance: Unidad N° ${subItem.number}`;
    modal.querySelector('#sub-item-location').value = subItem.location || '';
    modal.querySelector('#sub-item-real-width').value = subItem.realWidth || '';
    modal.querySelector('#sub-item-real-height').value = subItem.realHeight || '';
    modal.querySelector('#sub-item-date').value = subItem.installDate || new Date().toISOString().split('T')[0];

    const manufacturerSelect = modal.querySelector('#sub-item-manufacturer');
    const installerSelect = modal.querySelector('#sub-item-installer');
    await populateUserDropdowns(manufacturerSelect, installerSelect, subItem);

    const photoPreview = modal.querySelector('#photo-preview');
    if (subItem.photoURL) {
        photoPreview.innerHTML = `<a href="${subItem.photoURL}" target="_blank" class="text-blue-600 hover:underline text-sm">Ver foto actual</a>`;
    } else {
        photoPreview.innerHTML = '';
    }

    modal.style.display = 'flex';
}

function closeProgressModal() { progressModal.style.display = 'none'; }
document.getElementById('progress-modal-cancel-btn').addEventListener('click', closeProgressModal);
progressForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedbackP = document.getElementById('progress-feedback');
    progressConfirmBtn.disabled = true;
    progressConfirmBtn.textContent = 'Guardando...';
    feedbackP.textContent = '';
    feedbackP.className = 'text-sm mt-4 text-center text-blue-600';

    const subItemId = progressForm.dataset.id;
    const itemId = progressForm.dataset.itemid;
    const photoFile = document.getElementById('sub-item-photo').files[0];
    const location = document.getElementById('sub-item-location').value;
    const installDate = document.getElementById('sub-item-date').value;

    const data = {
        location: location,
        realWidth: parseFloat(document.getElementById('sub-item-real-width').value) || 0,
        realHeight: parseFloat(document.getElementById('sub-item-real-height').value) || 0,

        manufacturer: document.getElementById('sub-item-manufacturer').value,
        installer: document.getElementById('sub-item-installer').value,
        installDate: installDate,
    };

    if (data.installer) { data.status = 'Instalado'; }
    else if (data.manufacturer) { data.status = 'Pendiente de Instalación'; }

    try {
        if (photoFile) {
            feedbackP.textContent = 'Aplicando marca de agua...';
            const watermarkText = `Vidrios Exito - ${currentProject.name} - ${installDate} - ${location}`;
            const watermarkedBlob = await addWatermark(photoFile, watermarkText);

            feedbackP.textContent = 'Subiendo foto...';
            const storageRef = ref(storage, `evidence/${currentProject.id}/${itemId}/${subItemId}`);
            const snapshot = await uploadBytes(storageRef, watermarkedBlob);
            data.photoURL = await getDownloadURL(snapshot.ref);
            feedbackP.textContent = 'Foto subida. Guardando datos...';
        }

        await updateSubItem(subItemId, data);
        closeProgressModal();

    } catch (error) {
        console.error("Error al guardar el avance:", error);
        feedbackP.textContent = `Error: ${error.message}.`;
        feedbackP.className = 'text-sm mt-4 text-center text-red-600';
    } finally {
        progressConfirmBtn.disabled = false;
        progressConfirmBtn.textContent = 'Guardar Cambios';
    }
});

// =================== INICIAN NUEVAS FUNCIONES PARA AVANCE MÚLTIPLE ===================
const multipleProgressModal = document.getElementById('multiple-progress-modal');

async function openMultipleProgressModal(selectedIds) {
    const modal = document.getElementById('multiple-progress-modal');
    const title = document.getElementById('multiple-progress-modal-title');
    const tableBody = document.getElementById('multiple-progress-table-body');
    title.textContent = `Registrar Avance para ${selectedIds.length} Unidades`;
    tableBody.innerHTML = '';

    const manufacturerSelect = document.getElementById('multiple-sub-item-manufacturer');
    const installerSelect = document.getElementById('multiple-sub-item-installer');
    await populateUserDropdowns(manufacturerSelect, installerSelect, {});

    document.getElementById('multiple-sub-item-date').value = new Date().toISOString().split('T')[0];

    for (const id of selectedIds) {
        const subItemDoc = await getDoc(doc(db, "subItems", id));
        if (subItemDoc.exists()) {
            const subItem = { id: subItemDoc.id, ...subItemDoc.data() };
            const row = document.createElement('tr');
            row.className = 'border-b';
            row.dataset.id = subItem.id;
            row.innerHTML = `
            <td class="px-4 py-2 font-bold">${subItem.number}</td>
            <td class="px-4 py-2"><input type="text" class="location-input mt-1 block w-full px-2 py-1 border rounded-md" value="${subItem.location || ''}"></td>
            <td class="px-4 py-2"><input type="number" step="0.01" class="real-width-input mt-1 block w-full px-2 py-1 border rounded-md" value="${subItem.realWidth || ''}"></td>
            <td class="px-4 py-2"><input type="number" step="0.01" class="real-height-input mt-1 block w-full px-2 py-1 border rounded-md" value="${subItem.realHeight || ''}"></td>
            <td class="px-4 py-2"><input type="file" class="photo-input" accept="image/*" capture="environment" style="display: block; width: 100%;"></td>
        `;
            tableBody.appendChild(row);
        }
    }
    modal.style.display = 'flex';
}

function closeMultipleProgressModal() {
    if (multipleProgressModal) {
        multipleProgressModal.style.display = 'none';
    }
}

/**
 * Añade una marca de agua a un archivo de imagen.
 * @param {File} file - El archivo de imagen original.
 * @param {string} text - El texto que se usará como marca de agua.
 * @returns {Promise<Blob>} - Una promesa que se resuelve con el nuevo archivo de imagen (Blob) con la marca de agua.
 */
function addWatermark(file, text) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // Ajustar el tamaño del canvas a la imagen
                canvas.width = img.width;
                canvas.height = img.height;

                // Dibujar la imagen original en el canvas
                ctx.drawImage(img, 0, 0);

                // Configurar el estilo de la marca de agua
                const fontSize = Math.max(18, Math.min(img.width, img.height) / 30); // Tamaño de fuente dinámico
                ctx.font = `bold ${fontSize}px Arial`;
                ctx.fillStyle = 'rgb(255, 0, 0)'; // Blanco semi-transparente
                ctx.textAlign = 'right';
                ctx.textBaseline = 'bottom';

                // Añadir un pequeño margen desde el borde
                const margin = 15;
                ctx.fillText(text, canvas.width - margin, canvas.height - margin);

                // Convertir el canvas de nuevo a un archivo (Blob)
                canvas.toBlob((blob) => {
                    resolve(blob);
                }, 'image/jpeg', 0.9); // Calidad del 90%
            };
            img.onerror = reject;
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Asegurarse de que los listeners para el nuevo modal existan
const cancelBtn = document.getElementById('multiple-progress-modal-cancel-btn');
if (cancelBtn) {
    cancelBtn.addEventListener('click', closeMultipleProgressModal);
}

document.getElementById('multiple-progress-modal-confirm-btn').addEventListener('click', async () => {
    const confirmBtn = document.getElementById('multiple-progress-modal-confirm-btn');
    const feedbackP = document.getElementById('multiple-progress-feedback');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Guardando...';
    feedbackP.textContent = 'Actualizando datos...';
    feedbackP.className = 'text-sm mt-4 text-center text-blue-600';

    const commonData = {
        manufacturer: document.getElementById('multiple-sub-item-manufacturer').value,
        installer: document.getElementById('multiple-sub-item-installer').value,
        installDate: document.getElementById('multiple-sub-item-date').value,
    };

    if (commonData.installer) { commonData.status = 'Instalado'; }
    else if (commonData.manufacturer) { commonData.status = 'Pendiente de Instalación'; }

    const tableRows = document.querySelectorAll('#multiple-progress-table-body tr');
    const batch = writeBatch(db);
    const photoUploads = [];

    // Pre-cargar todos los sub-ítems para obtener su itemId
    const allSubItemsDocs = await getDocs(query(collection(db, "subItems"), where("projectId", "==", currentProject.id)));
    const subItemsMap = new Map(allSubItemsDocs.docs.map(doc => [doc.id, doc.data()]));

    tableRows.forEach(row => {
        const subItemId = row.dataset.id;
        const individualData = {
            location: row.querySelector('.location-input').value,
            realWidth: parseFloat(row.querySelector('.real-width-input').value) || 0,
            realHeight: parseFloat(row.querySelector('.real-height-input').value) || 0,
        };
        const photoFile = row.querySelector('.photo-input').files[0];

        const subItemRef = doc(db, "subItems", subItemId);
        batch.update(subItemRef, { ...commonData, ...individualData });

        if (photoFile) {
            const subItemData = subItemsMap.get(subItemId);
            if (subItemData) {
                const watermarkText = `Vidrios Exito - ${currentProject.name} - ${commonData.installDate} - ${individualData.location}`;
                photoUploads.push({ subItemId, photoFile, watermarkText, itemId: subItemData.itemId });
            }
        }
    });

    try {
        await batch.commit();
        feedbackP.textContent = 'Datos guardados. Procesando y subiendo fotos...';

        for (const upload of photoUploads) {
            const watermarkedBlob = await addWatermark(upload.photoFile, upload.watermarkText);
            const storageRef = ref(storage, `evidence/${currentProject.id}/${upload.itemId}/${upload.subItemId}`);
            const snapshot = await uploadBytes(storageRef, watermarkedBlob);
            const downloadURL = await getDownloadURL(snapshot.ref);
            await updateDoc(doc(db, "subItems", upload.subItemId), { photoURL: downloadURL });
        }

        feedbackP.textContent = '¡Proceso completado!';
        feedbackP.className = 'text-sm mt-4 text-center text-green-600';
        setTimeout(() => {
            closeMultipleProgressModal();
            feedbackP.textContent = '';
        }, 1500);

    } catch (error) {
        console.error("Error al guardar el avance múltiple:", error);
        feedbackP.textContent = 'Error al guardar. Revisa la consola.';
        feedbackP.className = 'text-sm mt-4 text-center text-red-600';
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Guardar Cambios';
    }
});
// =================== FINALIZAN NUEVAS FUNCIONES ===================


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
    ];
    // Se añadirán más instrucciones dependiendo del modelo del proyecto

    // --- HOJA 2: PLANTILLA PARA LLENAR (DINÁMICA) ---
    let exampleData = [];
    const projectPricingModel = currentProject.pricingModel || 'separado';

    if (projectPricingModel === 'incluido') {
        // --- Plantilla para Modelo INCLUIDO ---
        instructions.push(
            ["Precio Unitario (Incluido)", "Costo total por unidad, SIN impuestos. Ej: 200000"],
            ["Impuesto", "Opciones válidas: IVA, AIU, Ninguno"],
            ["AIU ... %", "Llenar solo si el impuesto es AIU. Ingresar solo el número (sin %). Ej: 10"]
        );

        exampleData = [{
            'Nombre del Ítem': "Ventana Fija Baño",
            'Cantidad': 2,
            'Ancho (m)': 0.8,
            'Alto (m)': 0.6,
            'Precio Unitario (Incluido)': 200000,
            'Impuesto': "IVA",
            'AIU Admin %': null,
            'AIU Imprev %': null,
            'AIU Utilidad %': null
        }];

    } else {
        // --- Plantilla para Modelo SEPARADO ---
        instructions.push(
            ["Precio Suministro (Unitario)", "Costo del material por unidad, SIN impuestos."],
            ["Impuesto Suministro", "Opciones válidas: IVA, AIU, Ninguno"],
            ["AIU ... % (Suministro)", "Llenar solo si el impuesto es AIU."],
            ["Precio Instalación (Unitario)", "Costo de mano de obra por unidad, SIN impuestos."],
            ["Impuesto Instalación", "Opciones válidas: IVA, AIU, Ninguno"],
            ["AIU ... % (Instalación)", "Llenar solo si el impuesto es AIU."]
        );

        exampleData = [{
            'Nombre del Ítem': "Ventana Corrediza Sala",
            'Cantidad': 5,
            'Ancho (m)': 1.5,
            'Alto (m)': 1.2,
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
    }

    // --- Creación del archivo Excel ---
    const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
    wsInstructions['!cols'] = [{ wch: 30 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, wsInstructions, "Instrucciones");

    const wsData = XLSX.utils.json_to_sheet(exampleData);
    wsData['!cols'] = Array(Object.keys(exampleData[0]).length).fill({ wch: 25 });
    XLSX.utils.book_append_sheet(wb, wsData, "Plantilla Items");

    XLSX.writeFile(wb, `Plantilla_Items_${currentProject.name.replace(/\s/g, '_')}.xlsx`);
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
            const projectPricingModel = currentProject.pricingModel || 'separado';

            for (const row of json) {
                // Verificación básica de que la fila tiene datos
                if (!row['Nombre del Ítem'] || !row['Cantidad'] || !row['Ancho (m)'] || !row['Alto (m)']) {
                    console.warn("Fila omitida por falta de datos básicos:", row);
                    continue;
                }

                // Construimos el objeto de datos que espera la función createItem
                const itemData = {
                    name: row['Nombre del Ítem'],
                    quantity: row['Cantidad'],
                    width: row['Ancho (m)'],
                    height: row['Alto (m)'],
                };

                if (projectPricingModel === 'incluido') {
                    // Lógica para modelo INCLUIDO
                    itemData.itemType = 'suministro_instalacion_incluido';
                    itemData.included_unitPrice = String(row['Precio Unitario (Incluido)'] || 0);
                    itemData.included_taxType = (row['Impuesto'] || 'none').toLowerCase();
                    itemData.included_aiuA = row['AIU Admin %'] || 0;
                    itemData.included_aiuI = row['AIU Imprev %'] || 0;
                    itemData.included_aiuU = row['AIU Utilidad %'] || 0;
                } else {
                    // Lógica para modelo SEPARADO
                    itemData.itemType = 'suministro_instalacion';
                    itemData.supply_unitPrice = String(row['Precio Suministro (Unitario)'] || 0);
                    itemData.supply_taxType = (row['Impuesto Suministro'] || 'none').toLowerCase();
                    itemData.supply_aiuA = row['AIU Admin % (Suministro)'] || 0;
                    itemData.supply_aiuI = row['AIU Imprev % (Suministro)'] || 0;
                    itemData.supply_aiuU = row['AIU Utilidad % (Suministro)'] || 0;
                    itemData.installation_unitPrice = String(row['Precio Instalación (Unitario)'] || 0);
                    itemData.installation_taxType = (row['Impuesto Instalación'] || 'none').toLowerCase();
                    itemData.installation_aiuA = row['AIU Admin % (Instalación)'] || 0;
                    itemData.installation_aiuI = row['AIU Imprev % (Instalación)'] || 0;
                    itemData.installation_aiuU = row['AIU Utilidad % (Instalación)'] || 0;
                }

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

// ====================================================================
//      INICIO: FUNCIÓN EXPORTAR A PDF REPLANTEADA COMO "MEMORIA DE PROYECTO"
// ====================================================================
async function exportProjectToPDF() {
    loadingOverlay.classList.remove('hidden');
    const { jsPDF } = window.jspdf;
    const docPDF = new jsPDF();
    const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
    let yPosition = 0;

    try {
        // --- 1. OBTENER TODOS LOS DATOS NECESARIOS ---
        const projectId = currentProject.id;
        const [itemsSnapshot, subItemsSnapshot, cortesSnapshot] = await Promise.all([
            getDocs(query(collection(db, "items"), where("projectId", "==", projectId))),
            getDocs(query(collection(db, "subItems"), where("projectId", "==", projectId))),
            getDocs(query(collection(db, "projects", projectId, "cortes"), where("status", "==", "aprobado"), orderBy("corteNumber")))
        ]);

        const itemsMap = new Map(itemsSnapshot.docs.map(doc => [doc.id, { id: doc.id, ...doc.data() }]));
        const subItemsMap = new Map(subItemsSnapshot.docs.map(doc => [doc.id, { id: doc.id, ...doc.data() }]));
        const approvedCortes = cortesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // --- 2. ENCABEZADO Y RESUMEN DEL CONTRATO ---
        docPDF.setFontSize(18);
        docPDF.text(`Memoria de Proyecto: ${currentProject.name}`, 14, 22);
        docPDF.setFontSize(11);
        docPDF.setTextColor(100);
        docPDF.text(`Constructora: ${currentProject.builderName}`, 14, 30);

        const contractedValue = await calculateProjectContractedValue(projectId);
        const contractDetails = [
            ["Valor del Contrato:", currencyFormatter.format(currentProject.value || 0)],
            ["Valor Contratado (Ítems):", currencyFormatter.format(contractedValue)],
            ["Anticipo:", currencyFormatter.format(currentProject.advance || 0)],
            ["Fecha Inicio:", currentProject.startDate ? new Date(currentProject.startDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A'],
        ];
        docPDF.autoTable({
            startY: 36,
            head: [['Detalles del Contrato', '']],
            body: contractDetails,
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185] }
        });
        yPosition = docPDF.autoTable.previous.finalY + 15;

        // --- 3. DETALLE DE CORTES APROBADOS ---
        docPDF.setFontSize(14);
        docPDF.text("Detalle de Cortes Aprobados", 14, yPosition);
        yPosition += 8;

        if (approvedCortes.length === 0) {
            docPDF.setFontSize(11);
            docPDF.text("No hay cortes aprobados para mostrar.", 14, yPosition);
        }

        for (const corte of approvedCortes) {
            const tableRows = [];

            // Llenamos las filas con el detalle de cada sub-ítem
            for (const subItemId of corte.subItemIds) {
                const subItem = subItemsMap.get(subItemId);
                if (subItem) {
                    const parentItem = itemsMap.get(subItem.itemId);
                    const medida = `${parentItem.width}m x ${parentItem.height}m`;
                    const fecha = subItem.installDate ? new Date(subItem.installDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A';
                    tableRows.push([`${parentItem.name} - #${subItem.number}`, subItem.location || 'Sin ubicación', medida, fecha]);
                }
            }

            // Añadimos la tabla detallada de ítems
            docPDF.autoTable({
                startY: yPosition,
                head: [[{ content: `CORTE #${corte.corteNumber} ${corte.isFinal ? '(FINAL)' : ''}`, colSpan: 4, styles: { fillColor: [39, 174, 96], textColor: [255, 255, 255] } }]],
                body: tableRows,
                columns: [{ header: 'Ítem' }, { header: 'Ubicación' }, { header: 'Medida' }, { header: 'Fecha Inst.' }],
                theme: 'grid',
                didDrawPage: (data) => { yPosition = data.cursor.y; }
            });

            // --- AÑADIMOS LA TABLA DE RESUMEN FINANCIERO DEL CORTE ---
            const financialSummary = [
                ['Valor Bruto del Corte:', currencyFormatter.format(corte.totalValue)],
            ];
            if (corte.amortizacion > 0) {
                financialSummary.push(['Amortización de Anticipo:', `- ${currencyFormatter.format(corte.amortizacion)}`]);
            }
            if (corte.descuento?.valor > 0) {
                financialSummary.push([`Descuento (${corte.descuento.concepto || 'N/A'}):`, `- ${currencyFormatter.format(corte.descuento.valor)}`]);
            }
            financialSummary.push(['Neto a Pagar por este Corte:', currencyFormatter.format(corte.netoAPagar)]);

            docPDF.autoTable({
                startY: docPDF.autoTable.previous.finalY + 2,
                body: financialSummary,
                theme: 'plain',
                styles: { fontSize: 9 },
                columnStyles: {
                    0: { fontStyle: 'bold', halign: 'right' },
                    1: { halign: 'right' }
                }
            });
            yPosition = docPDF.autoTable.previous.finalY + 15;
        }

        // --- 4. SECCIÓN DE PENDIENTES (SE MANTIENE IGUAL) ---
        // ... (código existente) ...

        // --- 5. GUARDAR EL PDF ---
        docPDF.save(`Memoria_Proyecto_${currentProject.name.replace(/\s/g, '_')}.pdf`);

    } catch (error) {
        console.error("Error al exportar a PDF:", error);
        alert("Ocurrió un error al generar el PDF.");
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}
// ====================================================================
//      FIN: FUNCIÓN EXPORTAR A PDF MEJORADA
// ====================================================================

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
    if (!notificationsList || !notificationBadge) return;

    let personalNotifs = [];
    let channelNotifs = [];

    // Función para renderizar todas las notificaciones juntas
    const renderNotifications = () => {
        const allNotifs = [...personalNotifs, ...channelNotifs];
        // Ordenamos por fecha para que las más nuevas aparezcan primero
        allNotifs.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());

        notificationBadge.classList.toggle('hidden', allNotifs.length === 0);
        notificationsList.innerHTML = '';

        if (allNotifs.length === 0) {
            notificationsList.innerHTML = '<p class="p-4 text-sm text-gray-500">No hay notificaciones nuevas.</p>';
            return;
        }

        allNotifs.forEach(notification => {
            const notificationItem = document.createElement('div');
            notificationItem.className = 'p-3 border-b hover:bg-gray-100 cursor-pointer notification-item';
            // Guardamos todos los datos necesarios para la navegación
            notificationItem.dataset.notifId = notification.id;
            notificationItem.dataset.projectId = notification.projectId || '';
            notificationItem.dataset.itemId = notification.itemId || '';
            notificationItem.dataset.link = notification.link || '';
            
            notificationItem.innerHTML = `
                <p class="text-sm font-bold">${notification.channel ? 'Alerta de Sistema' : 'Acción Requerida'}</p>
                <p class="text-sm">${notification.message}</p>
            `;
            notificationsList.appendChild(notificationItem);
        });
    };

    // Listener 1: Notificaciones personales
    const personalQuery = query(collection(db, "notifications"), where("userId", "==", currentUser.uid), where("read", "==", false));
    onSnapshot(personalQuery, (snapshot) => {
        personalNotifs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderNotifications();
    });

    // Listener 2: Notificaciones de canal para admin y bodega
    if (currentUserRole === 'admin' || currentUserRole === 'bodega') {
        const channelQuery = query(collection(db, "notifications"), where("channel", "==", "admins_bodega"), where("read", "==", false));
        onSnapshot(channelQuery, (snapshot) => {
            channelNotifs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderNotifications();
        });
    }

    // Un único Event Listener en la lista para manejar todos los clics
    notificationsList.addEventListener('click', async (e) => {
        const item = e.target.closest('.notification-item');
        if (!item) return;

        const { notifId, projectId, itemId, link } = item.dataset;

        // Marcar la notificación como leída
        await updateDoc(doc(db, "notifications", notifId), { read: true });

        // Navegar a la sección correspondiente
        if (link === '/catalog') {
            showView('catalog');
            loadCatalogView();
        } else if (projectId && itemId) {
            const projectDoc = await getDoc(doc(db, "projects", projectId));
            const itemDoc = await getDoc(doc(db, "items", itemId));
            if (projectDoc.exists() && itemDoc.exists()) {
                showProjectDetails({ id: projectId, ...projectDoc.data() });
                showSubItems({ id: itemId, ...itemDoc.data() });
            }
        }
        
        // Ocultar el menú desplegable
        document.getElementById('notifications-dropdown').classList.add('hidden');
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

    views = {
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
        corteDetails: document.getElementById('corte-details-view'),
        //pagos: document.getElementById('pagos-content'),
        //materiales: document.getElementById('materiales-content'), // <-- AÑADE ESTA LÍNEA
        catalog: document.getElementById('catalog-view'),
        compras: document.getElementById('compras-view'),
        reports: document.getElementById('reports-view'),

    };

    document.getElementById('generate-report-btn').addEventListener('click', generateMaterialReport);

    document.getElementById('po-details-close-btn').addEventListener('click', closePurchaseOrderModal);
    document.getElementById('po-details-cancel-btn').addEventListener('click', closePurchaseOrderModal);


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
        const button = target.closest('button[data-action]');

        // Manejo de clics en imágenes
        if (target.dataset.action === 'view-image' && target.tagName === 'IMG') {
            const imageUrl = target.getAttribute('src');
            if (imageUrl) openImageModal(imageUrl);
            return;
        }

        if (!button) return;
        const action = button.dataset.action;

        switch (action) {
            // -- Acciones de Dashboard --
            case 'view-details': {
                const projectId = projectCard?.dataset.id;
                const docSnap = await getDoc(doc(db, "projects", projectId));
                if (docSnap.exists()) showProjectDetails({ id: docSnap.id, ...docSnap.data() });
                break;
            }
            case 'archive': {
                const projectId = projectCard?.dataset.id;
                const projectName = projectCard?.dataset.name;
                openConfirmModal(`¿Estás seguro de archivar el proyecto "${projectName}"?`, () => archiveProject(projectId));
                break;
            }
            case 'restore': {
                const projectId = projectCard?.dataset.id;
                const projectName = projectCard?.dataset.name;
                openConfirmModal(`¿Restaurar el proyecto "${projectName}"?`, () => restoreProject(projectId));
                break;
            }
            case 'delete': {
                const projectId = projectCard?.dataset.id;
                const projectName = projectCard?.dataset.name;
                openConfirmModal(`¿Estás seguro de eliminar el proyecto "${projectName}"?`, () => deleteProject(projectId));
                break;
            }
            case 'return-material': {
                const requestId = button.dataset.id;
                const requestRef = doc(db, "projects", currentProject.id, "materialRequests", requestId);
                const requestSnap = await getDoc(requestRef);
                if (requestSnap.exists()) {
                    openMainModal('return-material', { id: requestSnap.id, ...requestSnap.data() });
                }
                break;
            }

            case 'add-stock':
                openMainModal('add-stock');
                break;

            // Añade un nuevo case para editar
            case 'edit-catalog-item': {
                const materialId = button.dataset.id;
                const materialRef = doc(db, "materialCatalog", materialId);
                const materialSnap = await getDoc(materialRef);
                if (materialSnap.exists()) {
                    openMainModal('edit-catalog-item', { id: materialSnap.id, ...materialSnap.data() });
                }
                break;
            }
            // Renombra 'add-purchase' a 'add-catalog-item'
            case 'add-catalog-item':
                openMainModal('add-catalog-item');
                break;


            case 'request-material': {
                // 1. Muestra un indicador de carga porque esta operación puede tardar un momento
                loadingOverlay.classList.remove('hidden');

                try {
                    // 2. Obtiene los datos necesarios en paralelo para mayor eficiencia
                    const [
                        inventorySnapshot,
                        itemsSnapshot,
                        subItemsSnapshot
                    ] = await Promise.all([
                        getDocs(query(collection(db, "inventory"))),
                        getDocs(query(collection(db, "items"), where("projectId", "==", currentProject.id))),
                        getDocs(query(collection(db, "subItems"), where("projectId", "==", currentProject.id)))
                    ]);

                    // 3. Prepara la lista de materiales del inventario general
                    const inventory = inventorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                    // 4. Prepara la lista de sub-ítems del proyecto, añadiendo el nombre del ítem padre para mayor claridad
                    const itemsMap = new Map(itemsSnapshot.docs.map(doc => [doc.id, doc.data()]));
                    const subItems = subItemsSnapshot.docs.map(doc => {
                        const data = doc.data();
                        const parentName = itemsMap.get(data.itemId)?.name || 'Ítem Desconocido';
                        return { id: doc.id, parentName, ...data };
                    });

                    // 5. Llama a la ventana flotante y le pasa toda la información preparada
                    openMainModal('request-material', { inventory, subItems });

                } catch (error) {
                    console.error("Error al preparar los datos para la solicitud de material:", error);
                    alert("No se pudieron cargar los datos para la solicitud.");
                } finally {
                    // 6. Oculta el indicador de carga
                    loadingOverlay.classList.add('hidden');
                }
                break;
            }

            case 'approve-request':
                await updateDoc(doc(db, "projects", currentProject.id, "materialRequests", button.dataset.id), { status: 'aprobado' });
                break;

            case 'reject-request':
                await updateDoc(doc(db, "projects", currentProject.id, "materialRequests", button.dataset.id), { status: 'rechazado' });
                break;
            case 'view-purchase-order': {
                const poId = button.dataset.id;
                openPurchaseOrderModal(poId);
                break;
            }

            case 'deliver-material':
                await updateDoc(doc(db, "projects", currentProject.id, "materialRequests", button.dataset.id), {
                    status: 'entregado',
                    responsibleId: currentUser.uid // El usuario de bodega que entrega es el responsable
                });
                break;
            case 'add-purchase-order': {
                const catalogSnapshot = await getDocs(query(collection(db, "materialCatalog")));
                const catalog = catalogSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                openMainModal('new-purchase-order', { catalog });
                break;
            }
            case 'new-purchase-order': {
                // Muestra un indicador de carga mientras preparamos los datos
                loadingOverlay.classList.remove('hidden');
                try {
                    // Obtenemos los materiales del catálogo para el desplegable
                    const catalogSnapshot = await getDocs(query(collection(db, "materialCatalog")));
                    const catalog = catalogSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                    // Abrimos el modal y le pasamos la lista de materiales
                    openMainModal('new-purchase-order', { catalog });
                } catch (error) {
                    console.error("Error al preparar la orden de compra:", error);
                    alert("No se pudieron cargar los materiales del catálogo.");
                } finally {
                    loadingOverlay.classList.add('hidden');
                }
                break;
            }

            // -- Acciones de la tabla de Ítems --
            case 'view-item-details':
            case 'edit-item':
            case 'delete-item': {
                const itemId = itemRow?.dataset.id;
                if (!itemId) return;
                const itemDoc = await getDoc(doc(db, "items", itemId));
                if (!itemDoc.exists()) return;
                const itemData = { id: itemDoc.id, ...itemDoc.data() };

                if (action === 'view-item-details') showSubItems(itemData);
                if (action === 'edit-item') openMainModal('editItem', itemData);
                if (action === 'delete-item') openConfirmModal(`¿Seguro que quieres eliminar el ítem "${itemData.name}"?`, () => deleteItem(itemId));
                break;
            }

            // -- Acciones de Cortes --
            case 'view-corte-details': {
                const corteId = button.dataset.corteId;
                const corteRef = doc(db, "projects", currentProject.id, "cortes", corteId);
                const corteSnap = await getDoc(corteRef);
                if (corteSnap.exists()) {
                    showCorteDetails({ id: corteSnap.id, ...corteSnap.data() });
                }
                break;
            }
            case 'export-corte-pdf': {
                const corteId = button.dataset.corteId;
                const exportType = button.dataset.type;
                const corteRef = doc(db, "projects", currentProject.id, "cortes", corteId);
                const corteSnap = await getDoc(corteRef);
                if (corteSnap.exists()) {
                    exportCorteToPDF(currentProject, { id: corteSnap.id, ...corteSnap.data() }, exportType);
                }
                break;
            }
            case 'approve-corte': {
                const corteId = button.dataset.corteId;
                openConfirmModal("¿Estás seguro de que quieres aprobar este corte? Esta acción es final.", () => approveCorte(currentProject.id, corteId));
                break;
            }
            case 'deny-corte': {
                const corteId = button.dataset.corteId;
                openConfirmModal("¿Estás seguro de que quieres denegar y eliminar este corte? No se podrá recuperar.", () => denyCorte(currentProject.id, corteId));
                break;
            }
            case 'cancel-corte-selection':
                closeCorteSelectionView();
                break;
            case 'generate-corte':
                generateCorte();
                break;
            case 'set-corte-type': {
                const type = button.dataset.type;
                document.querySelectorAll('.corte-type-btn').forEach(btn => {
                    btn.classList.toggle('bg-blue-500', btn.dataset.type === type);
                    btn.classList.toggle('text-white', btn.dataset.type === type);
                });
                setupCorteSelection(type);
                break;
            }

            // -- Acciones de Personas de Interés --
            case 'add-interest-person':
                openMainModal('addInterestPerson');
                break;
            case 'delete-interest-person': {
                const personId = button.dataset.id;
                openConfirmModal('¿Estás seguro de eliminar a esta persona?', () => deleteDoc(doc(db, "projects", currentProject.id, "peopleOfInterest", personId)));
                break;
            }

            // -- Acciones Generales --
            case 'logout': handleLogout(); break;
            case 'new-project': openMainModal('newProject'); break;
            case 'toggle-menu': document.getElementById('sidebar').classList.toggle('-translate-x-full'); break;
            case 'back-to-dashboard': showDashboard(); break;
            case 'back-to-project': showProjectDetails(currentProject); break;
            case 'add-item': openMainModal('addItem'); break;
            case 'import-items': document.getElementById('import-modal').style.display = 'flex'; break;
            case 'export-pdf': exportProjectToPDF(); break;
            case 'edit-project-info': openMainModal('editProjectInfo', currentProject); break;
            case 'back-to-project-details-cortes':
                showProjectDetails(currentProject, 'cortes'); // <--- Pasamos 'cortes' como el tab por defecto
                break;
            case 'view-image':
                const imageUrl = target.getAttribute('src');
                if (imageUrl) openImageModal(imageUrl);
                break;
            case 'add-anticipo-payment':
                openMainModal('add-anticipo-payment');
                break;
            case 'add-corte-payment':
                // Pasamos los datos del corte al modal
                openMainModal('add-corte-payment', {
                    corteId: button.dataset.corteId,
                    corteNumber: button.dataset.corteNumber
                });
                break;
            case 'add-other-payment':
                openMainModal('add-other-payment');
                break;
            case 'delete-payment':
                const paymentId = button.dataset.id;
                openConfirmModal(
                    '¿Estás seguro de que quieres eliminar este movimiento? Esta acción no se puede deshacer.',
                    () => deleteDoc(doc(db, "projects", currentProject.id, "payments", paymentId))
                );
                break;
            case 'view-purchase-order': {
                const poId = button.dataset.id;
                openPurchaseOrderModal(poId);
                break;
            }
        }
    });



    // --- Listener Secundario (SOLO para los botones de los modales) ---
    document.body.addEventListener('click', async (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;

        const action = button.dataset.action;
        const poId = button.dataset.id;

        if (action === 'receive-purchase-order') {
            openConfirmModal(
                '¿Confirmas que has recibido toda la mercancía? Esta acción actualizará el stock y no se puede deshacer.',
                async () => {
                    loadingOverlay.classList.remove('hidden');

                    try {
                        // Prepara la llamada a la Cloud Function
                        const receivePO = httpsCallable(functions, 'receivePurchaseOrder');
                        const result = await receivePO({ poId: poId });

                        // Muestra el mensaje de éxito del backend
                        alert(result.data.message);
                        closePurchaseOrderModal();

                    } catch (error) {
                        console.error("Error al llamar a la Cloud Function 'receivePurchaseOrder':", error);
                        alert("Error al procesar la orden: " + error.message);
                    } finally {
                        loadingOverlay.classList.add('hidden');
                    }
                }
            );
        }

        if (action === 'reject-purchase-order') {
            openConfirmModal(
                '¿Confirmas que has recibido toda la mercancía de esta orden? Esta acción actualizará el stock y no se puede deshacer.',
                async () => {
                    loadingOverlay.classList.remove('hidden'); // 1. Mostramos la carga
                    const poRef = doc(db, "purchaseOrders", poId);

                    try {
                        await runTransaction(db, async (transaction) => {
                            // ... (toda la lógica de la transacción se mantiene igual)
                            const poDoc = await transaction.get(poRef);
                            if (!poDoc.exists() || poDoc.data().status !== 'pendiente') {
                                throw new Error("Esta orden ya fue procesada o no existe.");
                            }

                            const materialsToUpdate = new Map();
                            poDoc.data().items.forEach(item => {
                                const currentQty = materialsToUpdate.get(item.materialId) || 0;
                                materialsToUpdate.set(item.materialId, currentQty + item.quantity);
                            });

                            const materialRefs = Array.from(materialsToUpdate.keys()).map(id => doc(db, "materialCatalog", id));
                            const materialDocs = await Promise.all(materialRefs.map(ref => transaction.get(ref)));

                            materialDocs.forEach((materialDoc, index) => {
                                if (!materialDoc.exists()) {
                                    throw new Error(`Uno de los materiales en la orden ya no existe.`);
                                }
                                const materialId = materialRefs[index].id;
                                const currentStock = materialDoc.data().quantityInStock || 0;
                                const receivedQuantity = materialsToUpdate.get(materialId);
                                transaction.update(materialRefs[index], { quantityInStock: currentStock + receivedQuantity });
                            });

                            transaction.update(poRef, { status: 'recibida', receivedAt: new Date(), receivedBy: currentUser.uid });
                        });

                        loadingOverlay.classList.add('hidden'); // 2. Ocultamos la carga ANTES de la alerta
                        alert("¡Orden de compra recibida y stock actualizado con éxito!"); // 3. Mostramos el mensaje
                        closePurchaseOrderModal(); // 4. Cerramos el modal de detalles

                    } catch (error) {
                        loadingOverlay.classList.add('hidden'); // También ocultamos la carga si hay un error
                        console.error("Error al recibir la orden de compra:", error);
                        alert("Error al procesar la orden: " + error.message);
                    }
                }
            );
        }

        // --- ACCIÓN: RECHAZAR ORDEN DE COMPRA (SIN CAMBIOS) ---
        if (action === 'reject-purchase-order') {
            openConfirmModal(
                '¿Estás seguro de que quieres rechazar y eliminar esta orden de compra? Esta acción no se puede deshacer.',
                async () => {
                    loadingOverlay.classList.remove('hidden');
                    try {
                        const poRef = doc(db, "purchaseOrders", poId);
                        await deleteDoc(poRef);
                        alert("La orden de compra ha sido eliminada.");
                        closePurchaseOrderModal();
                    } catch (error) {
                        console.error("Error al eliminar la orden de compra:", error);
                        alert("No se pudo eliminar la orden de compra.");
                    } finally {
                        loadingOverlay.classList.add('hidden');
                    }
                }
            );
        }
    });

    // ==============================================================
    //      INICIO: LISTENERS PARA EL MODAL DE ORDEN DE COMPRA
    // ==============================================================
    const poDetailsModal = document.getElementById('po-details-modal');

    // Función para cerrar el modal (asegúrate de que exista)
    function closePurchaseOrderModal() {
        if (poDetailsModal) poDetailsModal.style.display = 'none';
    }

    if (poDetailsModal) {
        poDetailsModal.addEventListener('click', (e) => {
            // Se cierra si se presiona el botón [X], el botón "Cerrar", o el fondo oscuro
            if (e.target.id === 'po-details-close-btn' ||
                e.target.id === 'po-details-cancel-btn' ||
                e.target.id === 'po-details-modal') {
                closePurchaseOrderModal();
            }
        });
    }
    // ==============================================================
    //      FIN: LISTENERS PARA EL MODAL DE ORDEN DE COMPRA
    // ==============================================================

    // ========================================================
    //      INICIO: LISTENER PARA EL BOTÓN "ATRÁS" DEL NAVEGADOR
    // ========================================================
    window.addEventListener('popstate', (event) => {
        // 'popstate' se activa cuando el usuario navega con los botones del navegador.
        if (event.state && event.state.viewName) {
            // Si encontramos una vista guardada, la mostramos.
            // El 'true' evita que se vuelva a guardar en el historial (evitando un bucle).
            console.log(`Navegando hacia atrás a la vista: ${event.state.viewName}`);
            showView(event.state.viewName, true);
        } else {
            // Si no hay estado, podría ser la primera página, mostramos el dashboard.
            showDashboard();
        }
    });
    // ========================================================
    //      FIN: LISTENER
    // ========================================================

    // ====================================================================
    //      INICIO: LISTENER PARA EL MENÚ DESPLEGABLE RESPONSIVE (NUEVO)
    // ====================================================================
    document.addEventListener('click', (e) => {
        const dropdownBtn = document.getElementById('project-tabs-dropdown-btn');
        const dropdownMenu = document.getElementById('project-tabs-dropdown-menu');
        const linkItem = e.target.closest('#dropdown-menu-items a');

        // Si se hace clic en una opción del menú
        if (linkItem && linkItem.dataset.tab) {
            e.preventDefault();
            switchProjectTab(linkItem.dataset.tab); // Cambia la pestaña
            if (dropdownMenu) dropdownMenu.classList.add('hidden'); // Cierra el menú
        }
        // Si se hace clic en el botón para abrir/cerrar el menú
        else if (dropdownBtn && dropdownBtn.contains(e.target)) {
            if (dropdownMenu) dropdownMenu.classList.toggle('hidden');
        }
        // Si se hace clic en cualquier otro lugar, cierra el menú
        else {
            if (dropdownMenu) dropdownMenu.classList.add('hidden');
        }
    });
    // ====================================================================
    //      FIN: LISTENER AÑADIDO
    // ====================================================================


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

                // Lógica corregida para llamar a la función de carga de cada vista
                if (viewName === 'adminPanel') {
                    showView('adminPanel');
                    loadUsers('active');
                } else if (viewName === 'catalog') { // <-- LÍNEA AÑADIDA
                    showView('catalog');
                    loadCatalogView();
                } else if (viewName === 'compras') { // <-- LÍNEA AÑADIDA
                    showView('compras');
                    loadComprasView();
                } else {
                    showView(viewName);
                }

                // En móvil, cerramos el menú después de hacer clic.
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


    document.getElementById('corte-items-accordion').addEventListener('click', (e) => {
        const header = e.target.closest('.accordion-header');
        if (header) {
            const content = header.nextElementSibling;
            const icon = header.querySelector('svg');
            content.classList.toggle('hidden');
            icon.classList.toggle('rotate-180');
        }

        const selectAllCheckbox = e.target.closest('.corte-item-select-all');
        if (selectAllCheckbox) {
            const content = selectAllCheckbox.closest('.accordion-header').nextElementSibling;
            content.querySelectorAll('.corte-subitem-checkbox').forEach(cb => {
                cb.checked = selectAllCheckbox.checked;
            });
        }
    });

    // Listener para mostrar/ocultar el contenedor de otros descuentos del corte
    const addOtherDiscountsCheckboxCorte = document.getElementById('corte-add-other-discounts-checkbox');
    const descuentosSectionCorte = document.getElementById('corte-descuentos-section');
    if (addOtherDiscountsCheckboxCorte && descuentosSectionCorte) {
        addOtherDiscountsCheckboxCorte.addEventListener('change', () => {
            descuentosSectionCorte.classList.toggle('hidden', !addOtherDiscountsCheckboxCorte.checked);
        });
    }

    // Listener para el botón que añade nuevos campos de descuento en el corte
    const addDiscountButtonCorte = document.getElementById('corte-add-discount-button');
    if (addDiscountButtonCorte) {
        addDiscountButtonCorte.addEventListener('click', () => {
            const container = descuentosSectionCorte;
            const newDiscountField = document.createElement('div');
            newDiscountField.classList.add('flex', 'items-center', 'mb-2', 'space-x-2');

            newDiscountField.innerHTML = `
                <input type="text" placeholder="Concepto" class="discount-concept w-full border rounded-md p-2 text-sm">
                <input type="text" placeholder="Valor" class="discount-value currency-input border rounded-md p-2 text-sm" style="max-width: 150px;">
                <button type="button" class="remove-discount-button text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-100">
                     <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            `;
            container.insertBefore(newDiscountField, addDiscountButtonCorte);

            // Añadir listener para el formateador de moneda al nuevo campo
            const currencyInput = newDiscountField.querySelector('.currency-input');
            const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
            currencyInput.addEventListener('input', (e) => {
                let value = e.target.value.replace(/[$. ]/g, '');
                if (!isNaN(value) && value) e.target.value = currencyFormatter.format(value).replace(/\s/g, ' ');
                else e.target.value = '';
            });

            // Añadir listener para el botón de eliminar
            newDiscountField.querySelector('.remove-discount-button').addEventListener('click', () => {
                newDiscountField.remove();
            });
        });
    }

    const subItemsTableBody = document.getElementById('sub-items-table-body');
    const selectAllCheckbox = document.getElementById('select-all-subitems-checkbox');
    const registerMultipleBtn = document.getElementById('register-multiple-progress-btn');

    if (subItemsTableBody && selectAllCheckbox && registerMultipleBtn) {
        const updateMultipleProgressButtonState = () => {
            const selectedCheckboxes = document.querySelectorAll('.subitem-checkbox:checked');
            registerMultipleBtn.disabled = selectedCheckboxes.length === 0;
        };

        selectAllCheckbox.addEventListener('change', () => {
            document.querySelectorAll('.subitem-checkbox').forEach(checkbox => { checkbox.checked = selectAllCheckbox.checked; });
            updateMultipleProgressButtonState();
        });

        subItemsTableBody.addEventListener('change', (e) => {
            if (e.target.classList.contains('subitem-checkbox')) {
                const allCheckboxes = document.querySelectorAll('.subitem-checkbox');
                const checkedCount = document.querySelectorAll('.subitem-checkbox:checked').length;
                selectAllCheckbox.checked = allCheckboxes.length > 0 && checkedCount === allCheckboxes.length;
                updateMultipleProgressButtonState();
            }
        });

        registerMultipleBtn.addEventListener('click', () => {
            const selectedIds = Array.from(document.querySelectorAll('.subitem-checkbox:checked')).map(cb => cb.dataset.id);
            openMultipleProgressModal(selectedIds); // <-- Cambio clave aquí
        });
    }
});

// ====================================================================
//      INICIO: LÓGICA PARA FORMATEO DE MONEDA (NUEVO)
// ====================================================================

/**
 * Formateador de moneda para Pesos Colombianos (COP).
 * Se puede reutilizar en toda la aplicación.
 */
const currencyFormatter = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0
});

/**
 * Aplica el formato de moneda a un campo de texto (input) mientras el usuario escribe.
 * @param {HTMLInputElement} inputElement - El elemento del input al que se le aplicará el formato.
 */
function setupCurrencyInput(inputElement) {
    if (!inputElement) return;

    // Función que se ejecuta cada vez que el usuario escribe
    const formatValue = () => {
        // 1. Limpia el valor actual de cualquier caracter que no sea un número
        let value = inputElement.value.replace(/[$. ]/g, '');

        // 2. Si es un número válido, lo formatea
        if (!isNaN(value) && value) {
            // Usamos el formateador y reemplazamos espacios raros para consistencia
            inputElement.value = currencyFormatter.format(value).replace(/\s/g, ' ');
        } else {
            // Si no es un número, limpia el campo
            inputElement.value = '';
        }
    };

    // 3. Asigna la función al evento 'input'
    inputElement.addEventListener('input', formatValue);

    // 4. Formatea el valor inicial que pueda tener el campo
    if (inputElement.value) {
        formatValue();
    }
}
// ====================================================================
//      FIN: LÓGICA PARA FORMATEO DE MONEDA
// ====================================================================


function loadPeopleOfInterest(projectId) {
    const listContainer = document.getElementById('interest-people-list');
    if (!listContainer) return;

    const q = query(collection(db, "projects", projectId, "peopleOfInterest"));
    if (unsubscribePeopleOfInterest) unsubscribePeopleOfInterest();

    unsubscribePeopleOfInterest = onSnapshot(q, (snapshot) => {
        listContainer.innerHTML = ''; // Limpia la lista
        if (snapshot.empty) {
            listContainer.innerHTML = '<p class="text-gray-500 text-sm">No se han añadido personas de interés.</p>';
            return;
        }

        snapshot.forEach(doc => {
            const person = { id: doc.id, ...doc.data() };
            const personCard = document.createElement('div');
            personCard.className = 'p-3 border rounded-lg bg-gray-50 flex justify-between items-start';

            personCard.innerHTML = `
                <div class="flex-grow">
                    <p class="font-bold text-gray-800">${person.name}</p>
                    <p class="text-sm text-gray-600">${person.position || 'Sin cargo'}</p>
                    <div class="mt-2 text-xs">
                        <p><strong>Correo:</strong> <a href="mailto:${person.email}" class="text-blue-600">${person.email || 'N/A'}</a></p>
                        <p><strong>Teléfono:</strong> <a href="tel:${person.phone}" class="text-blue-600">${person.phone || 'N/A'}</a></p>
                    </div>
                </div>
                <button data-action="delete-interest-person" data-id="${person.id}" class="text-red-500 hover:text-red-700 font-semibold text-sm ml-4">
                    Eliminar
                </button>
            `;
            listContainer.appendChild(personCard);
        });
    });
}



/**
 * Carga los datos financieros y llama a las funciones de renderizado para la pestaña de Pagos.
 * VERSIÓN REESTRUCTURADA Y FINAL.
 */
async function loadPayments(project) {
    if (unsubscribePayments) unsubscribePayments();

    const cortesQuery = query(collection(db, "projects", project.id, "cortes"), where("status", "==", "aprobado"));
    const paymentsQuery = query(collection(db, "projects", project.id, "payments"), orderBy("date", "desc"));

    const approvedCortesSnapshot = await getDocs(cortesQuery);
    const allApprovedCortes = approvedCortesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    unsubscribePayments = onSnapshot(paymentsQuery, (paymentsSnapshot) => {
        // Obtenemos las referencias a los elementos del DOM CON LOS NUEVOS IDs
        const anticipoTotalEl = document.getElementById('pagos-anticipo-total-value');
        const anticipoAmortizadoEl = document.getElementById('pagos-anticipo-amortizado-value');
        const anticipoPorAmortizarEl = document.getElementById('pagos-anticipo-por-amortizar-value');
        const cortesListContainer = document.getElementById('cortes-payment-list');
        const otrosPagosTableBody = document.getElementById('other-payments-table-body');

        if (!anticipoTotalEl) return; // Salida de seguridad

        const allPayments = paymentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 1. Procesar Anticipo
        const totalAnticipo = project.advance || 0;
        const anticipoPayments = allPayments.filter(p => p.type === 'abono_anticipo' || p.type === 'amortizacion_anticipo');
        const totalAmortizado = anticipoPayments.reduce((sum, p) => sum + p.amount, 0);

        anticipoTotalEl.textContent = currencyFormatter.format(totalAnticipo);
        anticipoAmortizadoEl.textContent = currencyFormatter.format(totalAmortizado);
        anticipoPorAmortizarEl.textContent = currencyFormatter.format(totalAnticipo - totalAmortizado);

        // 2. Procesar Abonos a Cortes
        cortesListContainer.innerHTML = '';
        if (allApprovedCortes.length === 0) {
            cortesListContainer.innerHTML = '<p class="text-center py-4 text-gray-500">No hay cortes aprobados.</p>';
        } else {
            allApprovedCortes.forEach(corte => {
                const cortePayments = allPayments.filter(p => p.type === 'abono_corte' && p.targetId === corte.id);
                const totalPagadoCorte = cortePayments.reduce((sum, p) => sum + p.amount, 0);
                const saldoCorte = (corte.netoAPagar || 0) - totalPagadoCorte;

                const corteCard = document.createElement('div');
                corteCard.className = 'bg-white p-4 rounded-lg shadow-sm border';
                corteCard.innerHTML = `
                    <div class="flex flex-col sm:flex-row justify-between items-start">
                        <div>
                            <p class="font-bold text-gray-800">Corte #${corte.corteNumber}</p>
                            <p class="text-lg font-bold text-gray-800">${currencyFormatter.format(corte.netoAPagar || 0)}</p>
                        </div>
                        <div class="text-left sm:text-right mt-2 sm:mt-0">
                            <p class="text-xs font-medium text-gray-500">Pagado: <span class="font-bold text-green-600">${currencyFormatter.format(totalPagadoCorte)}</span></p>
                            <p class="text-xs font-medium text-gray-500">Saldo: <span class="font-bold text-red-600">${currencyFormatter.format(saldoCorte)}</span></p>
                            <button data-action="add-corte-payment" data-corte-id="${corte.id}" data-corte-number="${corte.corteNumber}" class="mt-2 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-1 px-3 rounded w-full sm:w-auto">
                                + Registrar Abono
                            </button>
                        </div>
                    </div>`;
                cortesListContainer.appendChild(corteCard);
            });
        }

        // 3. Procesar Otros Pagos
        const otrosPagos = allPayments.filter(p => !p.type || p.type === 'otro');
        otrosPagosTableBody.innerHTML = '';
        if (otrosPagos.length === 0) {
            otrosPagosTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-500">No hay otros movimientos.</td></tr>`;
        } else {
            otrosPagos.forEach(pago => {
                const row = document.createElement('tr');
                row.className = 'bg-white border-b';
                row.innerHTML = `
                    <td class="px-6 py-4">${new Date(pago.date).toLocaleDateString('es-CO')}</td>
                    <td class="px-6 py-4 font-medium text-gray-900">${pago.concept}</td>
                    <td class="px-6 py-4 text-right font-semibold">${currencyFormatter.format(pago.amount)}</td>
                    <td class="px-6 py-4 text-center">
                        <button data-action="delete-payment" data-id="${pago.id}" class="text-red-500 hover:text-red-700 font-semibold text-sm">Eliminar</button>
                    </td>`;
                otrosPagosTableBody.appendChild(row);
            });
        }
    });
}

async function loadMaterialsTab(project) {
    // Visibilidad de botones según el rol del usuario
    const canRequest = currentUserRole === 'admin' || currentUserRole === 'operario';
    const requestMaterialBtn = document.getElementById('request-material-btn');
    if (requestMaterialBtn) {
        requestMaterialBtn.classList.toggle('hidden', !canRequest);
    }

    const requestsTableBody = document.getElementById('requests-table-body');
    if (!requestsTableBody) return;

    // Listener para las Solicitudes de este proyecto
    if (unsubscribeMaterialRequests) unsubscribeMaterialRequests();
    const requestsQuery = query(collection(db, "projects", project.id, "materialRequests"), orderBy("createdAt", "desc"));

    unsubscribeMaterialRequests = onSnapshot(requestsQuery, async (snapshot) => {
        // Obtenemos todos los sub-ítems del proyecto una sola vez para eficiencia
        const subItemsSnapshot = await getDocs(query(collection(db, "subItems"), where("projectId", "==", project.id)));
        const subItemsMap = new Map(subItemsSnapshot.docs.map(doc => [doc.id, doc.data()]));

        // Obtenemos los nombres de los ítems padres para dar más contexto
        const itemsSnapshot = await getDocs(query(collection(db, "items"), where("projectId", "==", project.id)));
        const itemsMap = new Map(itemsSnapshot.docs.map(doc => [doc.id, doc.data()]));

        requestsTableBody.innerHTML = '';
        if (snapshot.empty) {
            requestsTableBody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-gray-500">No hay solicitudes de material para este proyecto.</td></tr>`;
            return;
        }

        snapshot.forEach(doc => {
            const request = { id: doc.id, ...doc.data() };

            // Construcción de nombres para mayor claridad
            const subItem = subItemsMap.get(request.subItemId);
            const parentItem = subItem ? itemsMap.get(subItem.itemId) : null;
            const subItemName = parentItem ? `${parentItem.name} - Unidad #${subItem.number}` : 'Ítem no encontrado';
            const solicitante = usersMap.get(request.requesterId)?.firstName || 'Desconocido';
            const responsable = usersMap.get(request.responsibleId)?.firstName || 'N/A';

            let statusText, statusColor, actionsHtml = '';

            // Lógica de estados y acciones según el rol del usuario
            switch (request.status) {
                case 'solicitado':
                    statusText = 'Solicitado';
                    statusColor = 'bg-yellow-100 text-yellow-800';
                    if (currentUserRole === 'admin') {
                        actionsHtml = `<button data-action="approve-request" data-id="${request.id}" class="text-green-600 font-semibold hover:underline">Aprobar</button>
                                       <button data-action="reject-request" data-id="${request.id}" class="text-red-600 font-semibold hover:underline">Rechazar</button>`;
                    }
                    break;
                case 'aprobado':
                    statusText = 'Aprobado';
                    statusColor = 'bg-blue-100 text-blue-800';
                    if (currentUserRole === 'bodega' || currentUserRole === 'admin') {
                        actionsHtml = `<button data-action="deliver-material" data-id="${request.id}" class="text-blue-600 font-semibold hover:underline">Marcar Entregado</button>`;
                    }
                    break;
                case 'entregado':
                    statusText = 'Entregado'; statusColor = 'bg-green-100 text-green-800';
                    // AÑADIMOS EL BOTÓN DE DEVOLVER SI AÚN NO SE HA DEVUELTO TODO
                    if (request.quantity > (request.returnedQuantity || 0) && (currentUserRole === 'admin' || currentUserRole === 'operario')) {
                        actionsHtml = `<button data-action="return-material" data-id="${request.id}" class="text-yellow-600 font-semibold hover:underline">Devolver</button>`;
                    }
                    break;
                case 'rechazado':
                    statusText = 'Rechazado';
                    statusColor = 'bg-red-100 text-red-800';
                    break;
                default:
                    statusText = 'Desconocido';
                    statusColor = 'bg-gray-100 text-gray-800';
            }

            const row = document.createElement('tr');
            row.className = 'bg-white border-b hover:bg-gray-50';
            row.innerHTML = `
                <td class="px-6 py-4">${request.createdAt.toDate().toLocaleDateString('es-CO')}</td>
                <td class="px-6 py-4 font-medium">${request.materialName}</td>
                <td class="px-6 py-4 text-center">${request.quantity}</td>
                <td class="px-6 py-4">${solicitante}</td>
                <td class="px-6 py-4">${subItemName}</td>
                <td class="px-6 py-4 text-center"><span class="px-2 py-1 text-xs font-semibold rounded-full ${statusColor}">${statusText}</span></td>
                <td class="px-6 py-4">${responsable}</td>
                <td class="px-6 py-4 text-center space-x-2">${actionsHtml}</td>
            `;
            requestsTableBody.appendChild(row);
        });
    });
}
/**
 * Actualiza la tarjeta de resumen financiero en la PESTAÑA DE INFORMACIÓN GENERAL.
 * @param {object} project - El objeto del proyecto actual.
 * @param {Array} allPayments - Un array con todos los pagos del proyecto.
 */
function updateGeneralInfoSummary(project, allPayments) {
    const totalEl = document.getElementById('info-anticipo-total');
    const amortizadoEl = document.getElementById('info-anticipo-amortizado');
    const porAmortizarEl = document.getElementById('info-anticipo-por-amortizar');

    if (!totalEl || !amortizadoEl || !porAmortizarEl) return;

    const totalAnticipo = project.advance || 0;
    const anticipoPayments = allPayments.filter(p => p.type === 'abono_anticipo' || p.type === 'amortizacion_anticipo');
    const totalAmortizado = anticipoPayments.reduce((sum, p) => sum + p.amount, 0);

    totalEl.textContent = currencyFormatter.format(totalAnticipo);
    amortizadoEl.textContent = currencyFormatter.format(totalAmortizado);
    porAmortizarEl.textContent = currencyFormatter.format(totalAnticipo - totalAmortizado);
}