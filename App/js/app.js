// Importaciones de Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateEmail } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, writeBatch, getDocs, arrayUnion, orderBy, runTransaction, collectionGroup, increment, limit } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app-check.js";

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
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
const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider('6Lc-090rAAAAAKkE09k5txsrVWXG3Xelxnrpb7Ty'),
    isTokenAutoRefreshEnabled: true
});
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const messaging = getMessaging(app);
const functions = getFunctions(app, 'us-central1'); // ASEGÚRATE DE QUE ESTA LÍNEA EXISTA

let unsubscribeTasks = null; // <-- AÑADE ESTA LÍNEAlet unsubscribeReports = null;
let unsubscribePurchaseOrders = null;
let unsubscribeInventory = null;
let unsubscribeStock = null;
let unsubscribeMaterialRequests = null;
const materialStatusListeners = new Map();
let materialRequestReturnContext = { view: 'proyectos' };
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
let catalogSearchTerm = ''; // Guarda el término de búsqueda actual para el catálogo


let lastVisibleCatalogDoc = null; // Guarda el último documento visto del catálogo
let isFetchingCatalog = false;    // Evita cargas múltiples simultáneas
const ITEMS_PER_PAGE = 20;        // Cantidad de ítems a cargar por página

let cachedMunicipalities = []; // Variable para guardar los municipios en caché

// AÑADE ESTAS LÍNEAS AL INICIO DEL ARCHIVO
let lastVisibleItemDoc = null; // Guarda el último ítem visto de un proyecto
let isFetchingItems = false;    // Evita cargas múltiples simultáneas

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
    } else if (viewName === 'reports') {
        showView('reports');
        loadReportsView();
    }
}

let unsubscribeCatalog = null; // Renombra la variable global

let materialCatalogData = []; // Variable global para el stock en tiempo real

async function loadCatalogView() {
    const tableBody = document.getElementById('catalog-table-body');
    const searchInput = document.getElementById('catalog-search-input');
    const loadMoreBtn = document.getElementById('load-more-catalog-btn');

    if (!tableBody) return;

    if (unsubscribeCatalog) unsubscribeCatalog();
    catalogSearchTerm = searchInput.value.trim();

    // Si hay texto en el buscador, se activa el modo de búsqueda
    if (catalogSearchTerm) {
        loadMoreBtn.classList.add('hidden'); // Ocultamos paginación durante la búsqueda

        try {
            // 1. Primero, obtenemos TODOS los materiales de la base de datos
            const allItemsSnapshot = await getDocs(query(collection(db, "materialCatalog")));
            const searchTermLower = catalogSearchTerm.toLowerCase();

            // 2. Filtramos los resultados en memoria
            const results = allItemsSnapshot.docs.filter(doc => {
                const material = doc.data();
                const nameMatch = material.name?.toLowerCase().includes(searchTermLower);
                const refMatch = material.reference?.toLowerCase().includes(searchTermLower);
                return nameMatch || refMatch;
            });

            // 3. AHORA SÍ, limpiamos la tabla justo antes de mostrar los nuevos resultados
            tableBody.innerHTML = '';

            if (results.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">No se encontraron coincidencias.</td></tr>`;
            } else {
                // 4. Mostramos los resultados encontrados
                results.forEach(doc => {
                    const material = { id: doc.id, ...doc.data() };
                    const stock = material.quantityInStock || 0;
                    const minStock = material.minStockThreshold || 0;
                    let stockStatusIndicator = stock > minStock ? '<div class="h-3 w-3 rounded-full bg-green-500 mx-auto" title="Stock OK"></div>' : '<div class="h-3 w-3 rounded-full bg-red-500 mx-auto" title="Stock Bajo"></div>';
                    const viewInventoryBtn = material.isDivisible ? `<button data-action="view-inventory" data-id="${material.id}" data-name="${material.name}" class="bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold py-2 px-4 rounded-lg">Ver Inventario</button>` : '';

                    const row = document.createElement('tr');
                    row.className = 'bg-white border-b';
                    row.innerHTML = `
                        <td class="px-6 py-4">${stockStatusIndicator}</td>
                        <td class="px-6 py-4 font-medium">${material.name}</td>
                        <td class="px-6 py-4 text-gray-500">${material.reference || 'N/A'}</td>
                        <td class="px-6 py-4">${material.unit}</td>
                        <td class="px-6 py-4 text-right font-bold text-lg">${stock}</td>
                        <td class="px-6 py-4 text-center">
                            <div class="flex justify-center items-center gap-2">
                                <button data-action="edit-catalog-item" data-id="${material.id}" class="bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold py-2 px-4 rounded-lg">Editar</button>
                                ${viewInventoryBtn}
                            </div>
                        </td>
                    `;
                    tableBody.appendChild(row);
                });
            }
        } catch (error) {
            console.error("Error durante la búsqueda:", error);
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">Error al realizar la búsqueda.</td></tr>`;
        }

    } else {
        // Si el buscador está vacío, volvemos al modo de paginación
        tableBody.innerHTML = ''; // Limpiamos la tabla para reiniciar la paginación
        lastVisibleCatalogDoc = null;
        fetchMoreCatalogItems();
    }
}
async function fetchMoreCatalogItems() {
    const tableBody = document.getElementById('catalog-table-body');
    const loadMoreBtn = document.getElementById('load-more-catalog-btn');

    if (isFetchingCatalog) return;
    isFetchingCatalog = true;
    loadMoreBtn.textContent = 'Cargando...';

    try {
        let q = query(collection(db, "materialCatalog"), orderBy("name"), limit(ITEMS_PER_PAGE));

        if (lastVisibleCatalogDoc) {
            q = query(q, startAfter(lastVisibleCatalogDoc));
        }

        const snapshot = await getDocs(q);

        if (snapshot.empty && !lastVisibleCatalogDoc) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">No hay materiales en el catálogo.</td></tr>`;
            loadMoreBtn.classList.add('hidden');
            return;
        }

        snapshot.forEach(doc => {
            const material = { id: doc.id, ...doc.data() };
            const stock = material.quantityInStock || 0;
            const minStock = material.minStockThreshold || 0;
            let stockStatusIndicator = stock > minStock ? '<div class="h-3 w-3 rounded-full bg-green-500 mx-auto" title="Stock OK"></div>' : '<div class="h-3 w-3 rounded-full bg-red-500 mx-auto" title="Stock Bajo"></div>';
            const viewInventoryBtn = material.isDivisible ? `<button data-action="view-inventory" data-id="${material.id}" data-name="${material.name}" class="bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold py-2 px-4 rounded-lg">Ver Inventario</button>` : '';

            const row = document.createElement('tr');
            row.className = 'bg-white border-b';
            row.innerHTML = `
                <td class="px-6 py-4">${stockStatusIndicator}</td>
                <td class="px-6 py-4 font-medium">${material.name}</td>
                <td class="px-6 py-4 text-gray-500">${material.reference || 'N/A'}</td>
                <td class="px-6 py-4">${material.unit}</td>
                <td class="px-6 py-4 text-right font-bold text-lg">${stock}</td>
                <td class="px-6 py-4 text-center">
                    <div class="flex justify-center items-center gap-2">
                        <button data-action="edit-catalog-item" data-id="${material.id}" class="bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold py-2 px-4 rounded-lg">Editar</button>
                        ${viewInventoryBtn}
                    </div>
                </td>
            `;
            tableBody.appendChild(row);
        });

        lastVisibleCatalogDoc = snapshot.docs[snapshot.docs.length - 1];

        if (snapshot.docs.length < ITEMS_PER_PAGE) {
            loadMoreBtn.classList.add('hidden');
        } else {
            loadMoreBtn.classList.remove('hidden');
        }

    } catch (error) {
        console.error("Error al cargar más materiales:", error);
        tableBody.innerHTML += `<tr><td colspan="6" class="text-center py-4 text-red-500">Error al cargar datos.</td></tr>`;
    } finally {
        isFetchingCatalog = false;
        loadMoreBtn.textContent = 'Cargar Más';
    }
}

/**
 * Abre y rellena el modal con los detalles de inventario de un material específico,
 * mostrando unidades completas y retazos en pestañas separadas.
 */
async function openInventoryDetailsModal(materialId, materialName) {
    const modal = document.getElementById('inventory-details-modal');
    if (!modal) return;

    if (!materialId) {
        console.error("Se intentó abrir el detalle de inventario sin un ID de material.");
        alert("Error: No se pudo identificar el material seleccionado.");
        return;
    }

    document.getElementById('inventory-details-title').textContent = `Inventario de: ${materialName}`;

    const completeStockBody = document.getElementById('complete-stock-table-body');
    const remnantStockBody = document.getElementById('remnant-stock-table-body');

    completeStockBody.innerHTML = `<tr><td colspan="4" class="text-center py-4">Cargando...</td></tr>`;
    remnantStockBody.innerHTML = `<tr><td colspan-4" class="text-center py-4">Cargando...</td></tr>`;

    modal.style.display = 'flex';

    try {
        const batchesQuery = query(collection(db, "materialCatalog", materialId, "stockBatches"), orderBy("purchaseDate", "desc"));
        const batchesSnapshot = await getDocs(batchesQuery);

        completeStockBody.innerHTML = '';
        if (batchesSnapshot.empty) {
            completeStockBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-500">No hay unidades completas en stock.</td></tr>`;
        } else {
            const poIds = [...new Set(batchesSnapshot.docs.map(doc => doc.data().purchaseOrderId).filter(id => id))];
            let poMap = new Map();
            if (poIds.length > 0) {
                const poQuery = query(collection(db, "purchaseOrders"), where("__name__", "in", poIds));
                const poSnapshot = await getDocs(poQuery);
                poSnapshot.forEach(doc => poMap.set(doc.id, doc.data().poNumber || doc.id.substring(0, 6)));
            }

            // =================== INICIO DE LA MODIFICACIÓN ===================
            batchesSnapshot.forEach(doc => {
                const batch = doc.data();
                let originText = 'N/A';
                let rowClass = 'bg-white';

                // Ahora priorizamos el ID de devolución
                if (batch.returnId) {
                    originText = `<span class="font-semibold text-yellow-700">Devolución (${batch.returnId})</span>`;
                    rowClass = 'bg-yellow-50';
                }
                else if (batch.purchaseOrderId) {
                    const poIdentifier = poMap.get(batch.purchaseOrderId) || 'N/A';
                    originText = `Compra (PO: ${poIdentifier})`;
                }

                const row = document.createElement('tr');
                row.className = `${rowClass} border-b`;
                row.innerHTML = `
                    <td class="px-4 py-2">${batch.purchaseDate.toDate().toLocaleDateString('es-CO')}</td>
                    <td class="px-4 py-2">${batch.quantityInitial}</td>
                    <td class="px-4 py-2 font-bold">${batch.quantityRemaining}</td>
                    <td class="px-4 py-2 text-xs">${originText}</td>
                `;
                completeStockBody.appendChild(row);
            });
            // =================== FIN DE LA MODIFICACIÓN ===================
        }

        const remnantsQuery = query(collection(db, "materialCatalog", materialId, "remnantStock"), orderBy("createdAt", "desc"));
        const remnantsSnapshot = await getDocs(remnantsQuery);
        remnantStockBody.innerHTML = '';
        if (remnantsSnapshot.empty) {
            remnantStockBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-500">No hay retazos en stock.</td></tr>`;
        } else {
            remnantsSnapshot.forEach(doc => {
                const remnant = doc.data();
                const row = document.createElement('tr');
                row.innerHTML = `<td class="px-4 py-2">${remnant.createdAt.toDate().toLocaleDateString('es-CO')}</td><td class="px-4 py-2 font-bold">${remnant.length} ${remnant.unit || 'm'}</td><td class="px-4 py-2">${remnant.quantity}</td><td class="px-4 py-2 text-xs">${remnant.notes || 'N/A'}</td>`;
                remnantStockBody.appendChild(row);
            });
        }

    } catch (error) {
        console.error("Error al cargar el detalle de inventario:", error);
        completeStockBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-red-500">Error al cargar datos.</td></tr>`;
        remnantStockBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-red-500">Error al cargar datos.</td></tr>`;
    }
}

function loadComprasView() {
    const tableBody = document.getElementById('purchase-orders-table-body');
    const startDateInput = document.getElementById('po-start-date-filter');
    const endDateInput = document.getElementById('po-end-date-filter');

    if (!tableBody || !startDateInput.value || !endDateInput.value) return;

    tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4"><div class="loader mx-auto"></div></td></tr>`;

    const startDate = new Date(startDateInput.value + 'T00:00:00');
    const endDate = new Date(endDateInput.value + 'T23:59:59');

    if (unsubscribePurchaseOrders) unsubscribePurchaseOrders();

    const poQuery = query(
        collection(db, "purchaseOrders"),
        where("createdAt", ">=", startDate),
        where("createdAt", "<=", endDate),
        orderBy("createdAt", "desc")
    );

    unsubscribePurchaseOrders = onSnapshot(poQuery, (snapshot) => {
        tableBody.innerHTML = '';
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">No hay órdenes de compra en este rango de fechas.</td></tr>`;
            return;
        }

        snapshot.forEach(doc => {
            const po = { id: doc.id, ...doc.data() };
            let statusText, statusColor;
            switch (po.status) {
                case 'recibida': statusText = 'Recibida'; statusColor = 'bg-green-100 text-green-800'; break;
                default: statusText = 'Pendiente'; statusColor = 'bg-yellow-100 text-yellow-800';
            }
            const poIdentifier = po.poNumber || po.id.substring(0, 6).toUpperCase();

            const row = document.createElement('tr');
            row.className = 'bg-white border-b';
            row.innerHTML = `
                <td class="px-6 py-4 font-mono text-xs font-bold">${poIdentifier}</td>
                <td class="px-6 py-4">${po.createdAt.toDate().toLocaleDateString('es-CO')}</td>
                <td class="px-6 py-4 font-medium">${po.provider}</td>
                <td class="px-6 py-4 text-right font-semibold">${currencyFormatter.format(po.totalCost || 0)}</td>
                <td class="px-6 py-4 text-center"><span class="px-2 py-1 text-xs font-semibold rounded-full ${statusColor}">${statusText}</span></td>
                <td class="px-6 py-4 text-center">
                    <button data-action="view-purchase-order" data-id="${po.id}" class="bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors w-32 text-center">Ver</button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    });
}

/**
 * Valida el rango de fechas del filtro de Órdenes de Compra en tiempo real.
 */
function validatePoDateRange() {
    const startDateInput = document.getElementById('po-start-date-filter');
    const endDateInput = document.getElementById('po-end-date-filter');
    const feedbackP = document.getElementById('po-filter-feedback');
    const applyFilterBtn = document.getElementById('apply-po-filter-btn');

    // No valida si alguna de las fechas está vacía
    if (!startDateInput.value || !endDateInput.value) {
        applyFilterBtn.disabled = true; // Deshabilita el botón si no hay un rango completo
        return;
    }

    const startDate = new Date(startDateInput.value);
    const endDate = new Date(endDateInput.value);

    // Valida que la fecha de inicio no sea posterior a la de fin
    if (startDate > endDate) {
        feedbackP.textContent = 'La fecha "Desde" no puede ser posterior a la fecha "Hasta".';
        applyFilterBtn.disabled = true;
        return;
    }

    // Valida el rango máximo de 3 meses
    const threeMonthsInMillis = 90 * 24 * 60 * 60 * 1000; // 90 días como aproximación
    if (endDate - startDate > threeMonthsInMillis) {
        feedbackP.textContent = 'El rango de fechas no puede ser mayor a 3 meses.';
        applyFilterBtn.disabled = true;
    } else {
        feedbackP.textContent = ''; // Limpia el mensaje si el rango es válido
        applyFilterBtn.disabled = false; // Habilita el botón
    }
}


async function loadReportsView() {
    const projectFilter = document.getElementById('report-project-filter');
    const startDateInput = document.getElementById('report-start-date');
    const endDateInput = document.getElementById('report-end-date');
    const generateReportBtn = document.getElementById('generate-report-btn');
    const reportContainer = document.getElementById('report-results-container');
    const reportSummary = document.getElementById('report-summary');
    const reportTableBody = document.getElementById('report-table-body');

    if (!projectFilter) return;

    const today = new Date().toISOString().split('T')[0];
    endDateInput.value = today;

    projectFilter.innerHTML = '<option value="">Cargando proyectos...</option>';
    try {
        const projectsQuery = query(collection(db, "projects"), orderBy("name"));
        const snapshot = await getDocs(projectsQuery);

        projectFilter.innerHTML = '<option value="all">Todos los Proyectos</option>';
        if (snapshot.empty) {
            console.warn("No se encontraron proyectos para el reporte.");
        } else {
            snapshot.forEach(doc => {
                const project = { id: doc.id, ...doc.data() };
                if (project.name) {
                    const option = document.createElement('option');
                    option.value = project.id;
                    option.textContent = project.name;
                    projectFilter.appendChild(option);
                }
            });
        }
    } catch (error) {
        console.error("Error al cargar la lista de proyectos:", error);
        projectFilter.innerHTML = '<option value="all">Error al cargar</option>';
    }

    if (generateReportBtn && !generateReportBtn.dataset.listenerAttached) {
        generateReportBtn.dataset.listenerAttached = 'true';
        generateReportBtn.addEventListener('click', async () => {
            const selectedProjectId = projectFilter.value;
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (!startDate) {
                alert("Por favor, selecciona una fecha de inicio.");
                return;
            }

            reportContainer.classList.remove('hidden');
            reportTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4">Generando reporte...</td></tr>`;
            reportSummary.innerHTML = '';

            try {
                let baseQuery = selectedProjectId === 'all'
                    ? collectionGroup(db, 'materialRequests')
                    : collection(db, "projects", selectedProjectId, "materialRequests");

                const requestsQuery = query(baseQuery,
                    where("createdAt", ">=", new Date(startDate)),
                    where("createdAt", "<=", new Date(endDate + 'T23:59:59'))
                );

                const requestsSnapshot = await getDocs(requestsQuery);
                if (requestsSnapshot.empty) {
                    reportTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">No se encontraron datos.</td></tr>`;
                    reportSummary.innerHTML = '';
                    return;
                }

                const projectsMap = new Map();
                const materialsMap = new Map();
                let totalCost = 0;
                let reportRowsHtml = '';

                // =================== INICIO DE LA CORRECCIÓN ===================
                // Se cambió la variable 'doc' por 'requestDoc' para evitar conflictos.
                for (const requestDoc of requestsSnapshot.docs) {
                    const request = requestDoc.data();
                    const items = request.consumedItems || request.materials || [];
                    const projectId = requestDoc.ref.parent.parent.id;
                    let projectName = projectsMap.get(projectId);

                    if (!projectName) {
                        const projectSnap = await getDoc(requestDoc.ref.parent.parent);
                        projectName = projectSnap.exists() ? projectSnap.data().name : 'Proyecto Desconocido';
                        projectsMap.set(projectId, projectName);
                    }
                    totalCost += request.totalCost || 0;

                    for (const item of items) {
                        let materialInfo = materialsMap.get(item.materialId);
                        if (item.materialId && !materialInfo) {
                            // Aquí ocurría el error. Ahora 'doc' se refiere a la función de Firebase.
                            const materialSnap = await getDoc(doc(db, "materialCatalog", item.materialId));
                            materialInfo = materialSnap.exists() ? materialSnap.data() : { name: 'Material Desconocido', unit: '' };
                            materialsMap.set(item.materialId, materialInfo);
                        }

                        const quantity = item.quantityConsumed || item.quantity || 0;
                        const materialName = materialInfo ? materialInfo.name : (item.itemName || 'N/A');
                        const materialUnit = materialInfo ? materialInfo.unit : '';

                        reportRowsHtml += `
                            <tr class="bg-white border-b">
                                <td class="px-6 py-4">${request.createdAt.toDate().toLocaleDateString('es-CO')}</td>
                                <td class="px-6 py-4 font-medium">${projectName}</td>
                                <td class="px-6 py-4">${materialName}</td>
                                <td class="px-6 py-4 text-center">${quantity} ${materialUnit}</td>
                                <td class="px-6 py-4 text-right">${currencyFormatter.format(request.totalCost || 0)}</td>
                            </tr>
                        `;
                    }
                }
                // =================== FIN DE LA CORRECCIÓN ===================

                reportTableBody.innerHTML = reportRowsHtml;
                reportSummary.innerHTML = `
                    <div class="bg-blue-50 p-4 rounded-lg">
                        <p class="text-sm text-blue-800">Costo Total de Materiales (aproximado)</p>
                        <p class="text-2xl font-bold text-blue-900">${currencyFormatter.format(totalCost)}</p>
                    </div>
                `;

            } catch (e) {
                console.error("Error al generar el reporte:", e);
                reportTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">Error: ${e.message}</td></tr>`;
            }
        });
    }
}

/**
 * Abre y rellena el modal con los detalles de una Orden de Compra específica.
 * @param {string} poId - El ID de la Orden de Compra a mostrar.
 */
async function openPurchaseOrderModal(poId) {
    const modal = document.getElementById('po-details-modal');
    if (!modal) return;

    const contentContainer = document.getElementById('po-details-content');
    const actionsContainer = document.getElementById('po-details-actions');

    // Preparamos el modal mostrando un estado de carga
    contentContainer.innerHTML = '<p class="text-center text-gray-500 py-8">Cargando detalles...</p>';
    actionsContainer.innerHTML = ''; // Limpiamos los botones de acciones anteriores
    modal.style.display = 'flex';

    try {
        const poRef = doc(db, "purchaseOrders", poId);
        const poSnap = await getDoc(poRef);
        if (!poSnap.exists()) {
            throw new Error("No se encontró la orden de compra.");
        }

        const po = { id: poSnap.id, ...poSnap.data() };

        // --- Tarjeta 1: Información General ---
        const statusText = po.status === 'recibida' ? 'Recibida' : 'Pendiente';
        const statusColor = po.status === 'recibida' ? 'text-green-600' : 'text-yellow-600';
        const infoCard = `
            <div class="bg-white p-4 rounded-lg shadow-sm border">
                <h4 class="text-lg font-bold text-gray-800 mb-3">Información General</h4>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <p class="text-gray-500">Proveedor</p>
                        <p class="font-semibold">${po.provider || po.supplierName || 'N/A'}</p>
                    </div>
                    <div>
                        <p class="text-gray-500">Fecha</p>
                        <p class="font-semibold">${po.createdAt.toDate().toLocaleDateString('es-CO')}</p>
                    </div>
                    <div class="col-span-2">
                        <p class="text-gray-500">Estado</p>
                        <p class="font-bold ${statusColor}">${statusText}</p>
                    </div>
                </div>
            </div>
        `;

        // --- Tarjeta 2: Materiales Incluidos ---
        let materialsListHtml = '<p class="text-sm text-gray-500">No se especificaron materiales.</p>';
        if (po.items && po.items.length > 0) {
            const materialPromises = po.items.map(item => getDoc(doc(db, "materialCatalog", item.materialId)));
            const materialSnapshots = await Promise.all(materialPromises);

            materialsListHtml = '<ul class="space-y-2">';
            for (let i = 0; i < po.items.length; i++) {
                const item = po.items[i];
                const materialSnap = materialSnapshots[i];
                const materialName = materialSnap.exists() ? materialSnap.data().name : 'Material no encontrado';

                materialsListHtml += `
                    <li class="p-3 bg-gray-50 rounded-md border text-sm">
                        <p class="font-semibold text-gray-800">${materialName}</p>
                        <div class="flex justify-between items-center mt-1 text-xs">
                            <span class="text-gray-600">Cantidad: <span class="font-bold text-black">${item.quantity}</span></span>
                            <span class="text-gray-600">Costo Unit.: <span class="font-bold text-black">${currencyFormatter.format(item.unitCost || 0)}</span></span>
                        </div>
                    </li>
                `;
            }
            materialsListHtml += '</ul>';
        }

        const materialsCard = `
            <div class="bg-white p-4 rounded-lg shadow-sm border">
                <h4 class="text-lg font-bold text-gray-800 mb-3">Materiales Incluidos</h4>
                ${materialsListHtml}
            </div>
        `;

        // --- Tarjeta 3: Resumen de Costos ---
        const totalCard = `
            <div class="bg-white p-4 rounded-lg shadow-sm border">
                <div class="flex justify-between items-center">
                    <h4 class="text-lg font-bold text-gray-800">Costo Total</h4>
                    <p class="text-2xl font-bold text-green-600">${currencyFormatter.format(po.totalCost || 0)}</p>
                </div>
            </div>
        `;

        // Unimos todas las tarjetas y las mostramos
        contentContainer.innerHTML = infoCard + materialsCard + totalCard;

        // --- Lógica de Botones de Acción ---
        actionsContainer.innerHTML = `<button type="button" data-action="close-details-modal" class="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg">Cerrar</button>`;
        if (po.status === 'pendiente' && (currentUserRole === 'admin' || currentUserRole === 'bodega')) {
            actionsContainer.innerHTML += `
                <button data-action="reject-purchase-order" data-id="${po.id}" class="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg">Rechazar Orden</button>
                <button data-action="receive-purchase-order" data-id="${po.id}" class="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg">Recibir Mercancía</button>
            `;
        }

    } catch (error) {
        console.error("Error al abrir los detalles de la orden de compra:", error);
        contentContainer.innerHTML = `<p class="text-center text-red-500 py-8">${error.message}</p>`;
    }
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
    if (unsubscribeProjects) unsubscribeProjects();

    unsubscribeProjects = onSnapshot(q, (querySnapshot) => {
        projectsContainer.innerHTML = '';

        if (querySnapshot.empty) {
            projectsContainer.innerHTML = '<p class="text-gray-500 text-center">No hay proyectos para mostrar.</p>';
            return;
        }

        querySnapshot.forEach(doc => {
            const projectData = { id: doc.id, ...doc.data() };

            // Usamos el resumen pre-calculado o valores por defecto si no existe
            const stats = projectData.progressSummary || { totalM2: 0, executedM2: 0, totalItems: 0, executedItems: 0, executedValue: 0 };
            const progress = stats.totalM2 > 0 ? (stats.executedM2 / stats.totalM2) * 100 : 0;

            const card = createProjectCard(projectData, progress, stats);
            projectsContainer.appendChild(card);
        });

    }, (error) => {
        console.error("Error cargando proyectos: ", error);
        projectsContainer.innerHTML = '<p class="text-red-500 text-center">Error al cargar los proyectos.</p>';
    });
}

function createProjectCard(project, progress, stats) {
    const card = document.createElement('div');
    card.className = "bg-white p-6 rounded-lg shadow-lg mb-6 project-card";
    card.dataset.id = project.id;
    card.dataset.name = project.name;

    const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

    // --- LÓGICA CONDICIONAL PARA LOS BOTONES ---
    let actionButtons = '';
    if (project.status === 'active') {
        actionButtons = `<button data-action="archive" class="text-yellow-600 hover:text-yellow-800 font-semibold py-2 px-4 rounded-lg bg-yellow-100 hover:bg-yellow-200 transition-colors">Archivar</button>`;
    } else if (project.status === 'archived') {
        actionButtons = `
            <button data-action="restore" class="text-green-600 hover:text-green-800 font-semibold py-2 px-4 rounded-lg bg-green-100 hover:bg-green-200 transition-colors">Restaurar</button>
            ${currentUserRole === 'admin' ? `<button data-action="delete" class="text-red-600 hover:text-red-800 font-semibold py-2 px-4 rounded-lg bg-red-100 hover:bg-red-200 transition-colors">Eliminar</button>` : ''}
        `;
    }

    card.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <div>
                <h2 class="text-2xl font-bold text-gray-800">${project.name}</h2>
                <p class="text-sm text-gray-500 font-semibold">${project.builderName || 'Constructora no especificada'}</p>
                <p class="text-sm text-gray-500">${project.location} - ${project.address}</p>
            </div>
            <div class="flex flex-wrap gap-2 justify-end">
                <button data-action="view-details" class="text-blue-600 hover:text-blue-800 font-semibold py-2 px-4 rounded-lg bg-blue-100 hover:bg-blue-200 transition-colors">Ver Detalles</button>
                ${actionButtons}
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
    try {
        const deleteProjectFunction = httpsCallable(functions, 'deleteArchivedProject');
        await deleteProjectFunction({ projectId: projectId });
        // No es necesario hacer nada más, la vista se actualizará sola gracias a onSnapshot
    } catch (error) {
        console.error("Error al eliminar el proyecto:", error);
        alert(`Error: ${error.message}`);
    }
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

let unsubscribeSuppliers = null; // Variable global para el listener de proveedores

function loadProveedoresView() {
    const tableBody = document.getElementById('suppliers-table-body');
    if (!tableBody) return;

    if (unsubscribeSuppliers) unsubscribeSuppliers();

    const suppliersQuery = query(collection(db, "suppliers"), orderBy("name"));
    unsubscribeSuppliers = onSnapshot(suppliersQuery, (snapshot) => {
        tableBody.innerHTML = '';
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">No hay proveedores registrados.</td></tr>`;
            return;
        }
        snapshot.forEach(doc => {
            const supplier = { id: doc.id, ...doc.data() };
            const row = document.createElement('tr');
            row.className = 'bg-white border-b hover:bg-gray-50';

            // =================== INICIO DE LA MODIFICACIÓN ===================
            const baseButtonClasses = "text-sm font-semibold py-2 px-4 rounded-lg transition-colors w-32 text-center";

            row.innerHTML = `
                <td class="px-6 py-4 font-medium text-gray-900">${supplier.name}</td>
                <td class="px-6 py-4">${supplier.nit || 'N/A'}</td>
                <td class="px-6 py-4">${supplier.contactName || 'N/A'}</td>
                <td class="px-6 py-4">${supplier.contactPhone || 'N/A'}</td>
                <td class="px-6 py-4 text-center">
                    <div class="flex justify-center items-center gap-2">
                        <button data-action="edit-supplier" data-id="${supplier.id}" class="bg-yellow-500 hover:bg-yellow-600 text-white ${baseButtonClasses}">Editar</button>
                        <button data-action="view-supplier-details" data-id="${supplier.id}" class="bg-blue-500 hover:bg-blue-600 text-white ${baseButtonClasses}">Ver Detalles</button>
                    </div>
                </td>
            `;
            // =================== FIN DE LA MODIFICACIÓN ===================

            tableBody.appendChild(row);
        });
    });
}

let currentSupplierId = null; // Variable global para saber en qué proveedor estamos
let unsubscribeSupplierPOs = null; // Listener para las órdenes de compra
let unsubscribeSupplierPayments = null; // Listener para los pagos

async function loadSupplierDetailsView(supplierId) {
    currentSupplierId = supplierId;
    showView('supplierDetails');

    // =================== INICIO DE LA MODIFICACIÓN ===================
    // Referencias a los nuevos contenedores
    const summaryContent = document.getElementById('summary-content');
    const posTableBody = document.getElementById('supplier-pos-table-body');
    const paymentsTableBody = document.getElementById('supplier-payments-table-body');

    // Limpiar contenido previo
    summaryContent.innerHTML = '<div class="text-center py-10"><div class="loader mx-auto"></div></div>';
    posTableBody.innerHTML = '';
    paymentsTableBody.innerHTML = '';

    if (unsubscribeSupplierPOs) unsubscribeSupplierPOs();
    if (unsubscribeSupplierPayments) unsubscribeSupplierPayments();

    const tabsContainer = document.getElementById('supplier-details-tabs');
    const tabContents = document.querySelectorAll('.supplier-tab-content');

    const switchSupplierTab = (tabName) => {
        tabsContainer.querySelectorAll('.tab-button').forEach(button => {
            const isActive = button.dataset.tab === tabName;
            button.classList.toggle('border-blue-500', isActive);
            button.classList.toggle('text-blue-600', isActive);
            button.classList.toggle('border-transparent', !isActive);
            button.classList.toggle('text-gray-500', !isActive);
        });
        tabContents.forEach(content => {
            content.classList.toggle('hidden', content.id !== `${tabName}-content`);
        });
    };

    tabsContainer.addEventListener('click', (e) => {
        const button = e.target.closest('.tab-button');
        if (button) {
            switchSupplierTab(button.dataset.tab);
        }
    });

    try {
        const supplierRef = doc(db, "suppliers", supplierId);
        const supplierSnap = await getDoc(supplierRef);
        if (!supplierSnap.exists()) throw new Error("Proveedor no encontrado");

        const supplier = supplierSnap.data();
        document.getElementById('supplier-details-name').textContent = supplier.name;

        // Cargar Pestaña "Resumen" (Información General + Estado de Cuenta)
        const infoCardHTML = `
            <div class="bg-white p-4 rounded-lg shadow-sm border">
                <h4 class="text-lg font-bold text-gray-800 mb-3">Datos del Proveedor</h4>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                    <div><p class="text-gray-500">NIT/Cédula</p><p class="font-semibold">${supplier.nit || 'N/A'}</p></div>
                    <div><p class="text-gray-500">Email</p><p class="font-semibold">${supplier.email || 'N/A'}</p></div>
                    <div><p class="text-gray-500">Dirección</p><p class="font-semibold">${supplier.address || 'N/A'}</p></div>
                    <div><p class="text-gray-500">Contacto</p><p class="font-semibold">${supplier.contactName || 'N/A'}</p></div>
                    <div><p class="text-gray-500">Teléfono</p><p class="font-semibold">${supplier.contactPhone || 'N/A'}</p></div>
                </div>
            </div>`;

        const allPOsQuery = query(collection(db, "purchaseOrders"), where("supplierId", "==", supplierId));
        const allPaymentsQuery = query(collection(db, "suppliers", supplierId, "payments"));
        const [poSnapshot, paymentsSnapshot] = await Promise.all([getDocs(allPOsQuery), getDocs(allPaymentsQuery)]);
        const totalBilled = poSnapshot.docs.reduce((sum, doc) => sum + (doc.data().totalCost || 0), 0);
        const totalPaid = paymentsSnapshot.docs.reduce((sum, doc) => sum + (doc.data().amount || 0), 0);

        const balanceCardHTML = `
            <div class="bg-white p-4 rounded-lg shadow-sm border">
                <h4 class="text-lg font-bold text-gray-800 mb-3">Estado de Cuenta General</h4>
                <div class="grid grid-cols-3 gap-4 text-center">
                    <div><p class="text-sm text-gray-500">Total Facturado</p><p class="text-xl font-bold text-gray-800">${currencyFormatter.format(totalBilled)}</p></div>
                    <div><p class="text-sm text-gray-500">Total Pagado</p><p class="text-xl font-bold text-green-600">${currencyFormatter.format(totalPaid)}</p></div>
                    <div><p class="text-sm text-red-700">Saldo Pendiente</p><p class="text-2xl font-bold text-red-600">${currencyFormatter.format(totalBilled - totalPaid)}</p></div>
                </div>
            </div>`;

        summaryContent.innerHTML = infoCardHTML + balanceCardHTML;

        // Cargar Pestaña de Órdenes de Compra (la lógica no cambia)
        const poQuery = query(collection(db, "purchaseOrders"), where("supplierId", "==", supplierId), orderBy("createdAt", "desc"));
        unsubscribeSupplierPOs = onSnapshot(poQuery, (snapshot) => {
            posTableBody.innerHTML = '';
            if (snapshot.empty) {
                posTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-500">No hay órdenes de compra.</td></tr>`;
            } else {
                snapshot.forEach(doc => {
                    const po = { id: doc.id, ...doc.data() };
                    const row = document.createElement('tr');
                    const statusText = po.status === 'recibida' ? 'Recibida' : 'Pendiente';
                    const statusColor = po.status === 'recibida' ? 'text-green-600' : 'text-yellow-600';
                    row.innerHTML = `<td class="px-6 py-4">${po.createdAt.toDate().toLocaleDateString('es-CO')}</td><td class="px-6 py-4 text-right font-semibold">${currencyFormatter.format(po.totalCost || 0)}</td><td class="px-6 py-4 text-center font-bold ${statusColor}">${statusText}</td><td class="px-6 py-4 text-center"><button data-action="view-purchase-order" data-id="${po.id}" class="bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold py-2 px-4 rounded-lg w-32 text-center">Ver</button></td>`;
                    posTableBody.appendChild(row);
                });
            }
        });

        // Cargar Pestaña de Pagos (la lógica no cambia)
        const paymentsQuery = query(collection(db, "suppliers", supplierId, "payments"), orderBy("date", "desc"));
        unsubscribeSupplierPayments = onSnapshot(paymentsQuery, (snapshot) => {
            paymentsTableBody.innerHTML = '';
            if (snapshot.empty) {
                paymentsTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-500">No hay pagos registrados.</td></tr>`;
            } else {
                snapshot.forEach(doc => {
                    const p = { id: doc.id, ...doc.data() };
                    const row = document.createElement('tr');
                    row.innerHTML = `<td class="px-6 py-4">${new Date(p.date + 'T00:00:00').toLocaleDateString('es-CO')}</td><td class="px-6 py-4">${p.paymentMethod || 'N/A'}</td><td class="px-6 py-4 text-right font-semibold">${currencyFormatter.format(p.amount || 0)}</td><td class="px-6 py-4 text-center"><button data-action="delete-supplier-payment" data-id="${p.id}" class="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2 px-4 rounded-lg w-32 text-center">Eliminar</button></td>`;
                    paymentsTableBody.appendChild(row);
                });
            }
        });

        // Activar la nueva pestaña "Resumen" por defecto
        switchSupplierTab('summary');
        // =================== FIN DE LA MODIFICACIÓN ===================

    } catch (error) {
        console.error("Error al cargar los detalles del proveedor:", error);
        summaryContent.innerHTML = `<p class="text-center text-red-500 py-10">${error.message}</p>`;
    }
}

/**
 * Busca el último precio de compra de un material específico para un proveedor.
 * @param {string} supplierId - El ID del proveedor.
 * @param {string} materialId - El ID del material.
 * @returns {Promise<number|null>} - El último precio o null si no se encuentra.
 */
async function findLastPurchasePrice(supplierId, materialId) {
    try {
        // 1. Buscamos las órdenes de compra más recientes de este proveedor que ya fueron recibidas.
        const poQuery = query(
            collection(db, "purchaseOrders"),
            where("supplierId", "==", supplierId),
            where("status", "==", "recibida"),
            orderBy("createdAt", "desc"),
            limit(10) // Limitamos a las últimas 10 para ser eficientes
        );

        const poSnapshot = await getDocs(poQuery);
        if (poSnapshot.empty) return null;

        // 2. Recorremos las órdenes desde la más nueva a la más vieja.
        for (const poDoc of poSnapshot.docs) {
            const poData = poDoc.data();
            if (poData.items && Array.isArray(poData.items)) {
                // 3. Buscamos el material dentro de los items de la orden.
                const foundItem = poData.items.find(item => item.materialId === materialId);

                // 4. Si lo encontramos, devolvemos su costo unitario.
                if (foundItem) {
                    console.log(`Último precio encontrado para ${materialId}: ${foundItem.unitCost}`);
                    return foundItem.unitCost;
                }
            }
        }

        // Si recorrimos todas las órdenes y no lo encontramos, no hay historial.
        return null;

    } catch (error) {
        console.error("Error al buscar el último precio de compra:", error);
        return null; // En caso de error, no hacemos nada.
    }
}

function createUserRow(user) {
    const row = document.createElement('tr');
    row.className = 'bg-white border-b';

    const statusColor = user.status === 'active' ? 'text-green-600' : (user.status === 'pending' ? 'text-yellow-600' : 'text-gray-500');
    const statusText = user.status === 'active' ? 'Activo' : (user.status === 'pending' ? 'Pendiente' : 'Archivado');

    // =================== INICIO DE LA MODIFICACIÓN ===================
    const baseButtonClasses = "text-sm font-semibold py-2 px-4 rounded-lg transition-colors w-32 text-center";
    let actionsHtml = '';

    if (user.status === 'archived') {
        actionsHtml = `
            <button class="restore-user-btn bg-green-500 hover:bg-green-600 text-white ${baseButtonClasses}">Restaurar</button>
            <button class="delete-user-btn bg-red-500 hover:bg-red-600 text-white ${baseButtonClasses}">Eliminar</button>
        `;
    } else {
        const toggleStatusText = user.status === 'active' ? 'Desactivar' : 'Activar';
        const toggleStatusColor = user.status === 'active' ? 'bg-gray-500 hover:bg-gray-600' : 'bg-green-500 hover:bg-green-600';

        actionsHtml = `
            <button class="edit-user-btn bg-yellow-500 hover:bg-yellow-600 text-white ${baseButtonClasses}">Editar</button>
            <button class="toggle-status-btn ${toggleStatusColor} text-white ${baseButtonClasses}" data-status="${user.status}">
                ${toggleStatusText}
            </button>
        `;
    }

    row.innerHTML = `
        <td class="px-6 py-4 font-medium text-gray-900" data-label="Nombre">${user.firstName} ${user.lastName}</td>
        <td class="px-6 py-4" data-label="Correo">${user.email}</td>
        <td class="px-6 py-4" data-label="Rol">
            <select class="user-role-select border rounded-md p-1 bg-white" data-userid="${user.id}">
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option>
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
    // =================== FIN DE LA MODIFICACIÓN ===================

    row.querySelector('.user-role-select').addEventListener('change', (e) => {
        updateUserRole(user.id, e.target.value);
    });

    if (user.status !== 'archived') {
        row.querySelector('.toggle-status-btn').addEventListener('click', (e) => {
            const newStatus = e.target.dataset.status === 'active' ? 'pending' : 'active';
            updateUserStatus(user.id, newStatus);
        });
        row.querySelector('.edit-user-btn').addEventListener('click', () => openMainModal('editUser', user));

        // Se elimina el botón "Archivar", ya que se puede desactivar el usuario
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
    const dropdownMenu = document.getElementById('project-tabs-dropdown-menu'); // Referencia al menú

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

    // ====================================================================
    //      INICIO: LÓGICA AÑADIDA PARA CORREGIR EL ERROR
    // ====================================================================
    // Se añade un listener al contenedor de los ítems del menú.
    dropdownMenuContainer.addEventListener('click', (e) => {
        e.preventDefault(); // Previene que la página salte al inicio
        const target = e.target;

        // Verificamos que se hizo clic en una opción del menú
        if (target.dataset.tab) {
            const tabName = target.dataset.tab;

            // Llamamos a la función que ya tienes para cambiar de pestaña
            switchProjectTab(tabName);

            // Ocultamos el menú desplegable
            if (dropdownMenu) {
                dropdownMenu.classList.add('hidden');
            }
        }
    });
    // ====================================================================
    //      FIN: LÓGICA AÑADIDA
    // ====================================================================
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

async function showProjectDetails(project, defaultTab = 'info-general') {
    // --- INICIO DE LA MODIFICACIÓN ---
    // Establecer el contexto de retorno CADA VEZ que se entra a esta vista
    materialRequestReturnContext = { view: 'proyecto-detalle', projectId: project.id };
    console.log("Contexto de retorno establecido en: proyecto-detalle"); // Log para depuración
    // --- FIN DE LA MODIFICACIÓN ---

    currentProject = project;
    showView('projectDetails');
    setupResponsiveTabs();

    const safeSetText = (id, text) => { /* ... */
        const element = document.getElementById(id);
        if (element) element.textContent = text;
    };

    // --- Rellenar datos estáticos (sin cambios) ---
    safeSetText('project-details-name', project.name);
    // ... (resto del código sin cambios) ...
    safeSetText('project-details-builder', project.builderName || 'Constructora no especificada');
    safeSetText('project-details-startDate', project.startDate ? new Date(project.startDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A');
    safeSetText('project-kickoffDate', project.kickoffDate ? new Date(project.kickoffDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A');
    safeSetText('project-endDate', project.endDate ? new Date(project.endDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A');
    const pricingModelText = project.pricingModel === 'incluido'
        ? 'Suministro e Instalación (Incluido)'
        : 'Suministro e Instalación (Separado)';
    safeSetText('project-details-pricingModel', pricingModelText);

    const stats = project.progressSummary || { executedValue: 0, totalItems: 0, executedItems: 0, executedM2: 0, totalM2: 0 };
    const contractedValue = await calculateProjectContractedValue(project.id);

    safeSetText('info-initial-contract-value', currencyFormatter.format(project.value || 0));
    safeSetText('info-contracted-value', currencyFormatter.format(contractedValue));
    safeSetText('info-executed-value', currencyFormatter.format(stats.executedValue));
    safeSetText('project-details-installedItems', `${stats.executedItems} / ${stats.totalItems}`);
    safeSetText('project-details-executedM2', `${stats.executedM2.toFixed(2)}m² / ${stats.totalM2.toFixed(2)}m²`);

    const paymentsQuery = query(collection(db, "projects", project.id, "payments"));
    onSnapshot(paymentsQuery, (paymentsSnapshot) => { /* ... */
        const allPayments = paymentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateGeneralInfoSummary(project, allPayments);
    });

    renderInteractiveDocumentCards(project.id);
    loadItems(project.id);
    loadCortes(project);
    loadPeopleOfInterest(project.id);

    loadPayments(project);
    loadMaterialsTab(project, null);

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
    if (!itemsTableBody) return;

    // Reinicia el estado de paginación y limpia la tabla
    lastVisibleItemDoc = null;
    itemsTableBody.innerHTML = '';

    if (unsubscribeItems) unsubscribeItems();

    // Llama a la función para cargar la primera página de resultados
    fetchMoreItems(projectId);
}

async function fetchMoreItems(projectId) {
    const itemsTableBody = document.getElementById('items-table-body');
    const loadMoreBtn = document.getElementById('load-more-items-btn');

    if (isFetchingItems || !currentProject) return;
    isFetchingItems = true;
    loadMoreBtn.textContent = 'Cargando...';
    loadMoreBtn.classList.remove('hidden');

    try {
        let q = query(
            collection(db, "items"),
            where("projectId", "==", projectId),
            orderBy(itemSortState.key, itemSortState.direction), // Usa el estado de ordenamiento actual
            limit(ITEMS_PER_PAGE)
        );

        if (lastVisibleItemDoc) {
            q = query(q, startAfter(lastVisibleItemDoc));
        }

        const itemsSnapshot = await getDocs(q);

        if (itemsSnapshot.empty && !lastVisibleItemDoc) {
            itemsTableBody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-gray-500">No hay ítems.</td></tr>`;
            loadMoreBtn.classList.add('hidden');
            return;
        }

        const items = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const itemIds = items.map(item => item.id);
        const executedCounts = new Map(itemIds.map(id => [id, 0]));

        if (itemIds.length > 0) {
            // Optimizamos la consulta de sub-ítems para que también sea más eficiente
            const subItemsQuery = query(collection(db, "subItems"), where("itemId", "in", itemIds), where("status", "==", "Instalado"));
            const subItemsSnapshot = await getDocs(subItemsQuery);
            subItemsSnapshot.forEach(doc => {
                const subItem = doc.data();
                executedCounts.set(subItem.itemId, (executedCounts.get(subItem.itemId) || 0) + 1);
            });
        }

        items.forEach(itemData => {
            const executedCount = executedCounts.get(itemData.id) || 0;
            const percentage = itemData.quantity > 0 ? (executedCount / itemData.quantity) : 0;
            itemData.status = percentage === 0 ? 'Pendiente' : (percentage < 1 ? 'En Proceso' : 'Instalado');

            const row = createItemRow(itemData, executedCount);
            itemsTableBody.appendChild(row);
        });

        // Guardamos el último documento para la siguiente consulta de paginación
        lastVisibleItemDoc = itemsSnapshot.docs[itemsSnapshot.docs.length - 1];

        // Ocultamos el botón "Cargar Más" si ya no hay más resultados
        if (itemsSnapshot.docs.length < ITEMS_PER_PAGE) {
            loadMoreBtn.classList.add('hidden');
        } else {
            loadMoreBtn.classList.remove('hidden');
        }

    } catch (error) {
        console.error("Error al cargar más ítems:", error);
    } finally {
        isFetchingItems = false;
        loadMoreBtn.textContent = 'Cargar Más';
    }
}

function renderSortedItems() {
    const itemsTableBody = document.getElementById('items-table-body');
    // La tabla ya no se borra aquí, se añaden los ítems en fetchMoreItems

    // La lógica de ordenamiento se aplicará en la consulta de Firestore, no aquí.
    // Simplemente nos aseguramos de que los indicadores visuales estén correctos.
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
    try {
        const createProjectItemFunction = httpsCallable(functions, 'createProjectItem');

        // --- INICIO DE LA CORRECCIÓN ---
        // Se añade la lógica que faltaba para procesar y estructurar los datos de precio
        const projectPricingModel = currentProject.pricingModel || 'separado';

        const newItemData = {
            name: data.name,
            description: data.description,
            quantity: parseInt(data.quantity),
            width: parseFloat(data.width),
            height: parseFloat(data.height),
            itemType: projectPricingModel === 'incluido' ? 'suministro_instalacion_incluido' : 'suministro_instalacion',
            projectId: currentProject.id,
        };

        if (projectPricingModel === 'incluido') {
            newItemData.includedDetails = {
                unitPrice: parseFloat(data.included_unitPrice?.replace(/[$. ]/g, '')) || 0,
                taxType: data.included_taxType || 'none',
                aiuA: parseFloat(data.included_aiuA) || 0,
                aiuI: parseFloat(data.included_aiuI) || 0,
                aiuU: parseFloat(data.included_aiuU) || 0
            };
            newItemData.supplyDetails = {};
            newItemData.installationDetails = {};
        } else {
            newItemData.supplyDetails = {
                unitPrice: parseFloat(data.supply_unitPrice?.replace(/[$. ]/g, '')) || 0,
                taxType: data.supply_taxType || 'none',
                aiuA: parseFloat(data.supply_aiuA) || 0,
                aiuI: parseFloat(data.supply_aiuI) || 0,
                aiuU: parseFloat(data.supply_aiuU) || 0
            };
            newItemData.installationDetails = {
                unitPrice: parseFloat(data.installation_unitPrice?.replace(/[$. ]/g, '')) || 0,
                taxType: data.installation_taxType || 'none',
                aiuA: parseFloat(data.installation_aiuA) || 0,
                aiuI: parseFloat(data.installation_aiuI) || 0,
                aiuU: parseFloat(data.installation_aiuU) || 0
            };
            newItemData.includedDetails = {};
        }

        // Se envía el objeto de datos ya estructurado a la Cloud Function
        await createProjectItemFunction(newItemData);
        // --- FIN DE LA CORRECCIÓN ---

    } catch (error) {
        console.error("Error al llamar a la función createProjectItem:", error);
        alert(`Error al crear el ítem: ${error.message}`);
    }
}

async function updateItem(itemId, data) {
    const projectPricingModel = currentProject.pricingModel || 'separado';

    // Prepara el objeto de datos con la misma lógica que ya teníamos
    const updatedData = {
        name: data.name,
        description: data.description,
        width: parseFloat(data.width),
        height: parseFloat(data.height),
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

    try {
        // Llama a la nueva Cloud Function
        const updateProjectItemFunction = httpsCallable(functions, 'updateProjectItem');
        await updateProjectItemFunction({ itemId: itemId, updatedData: updatedData });

    } catch (error) {
        console.error("Error al llamar a la función updateProjectItem:", error);
        alert(`Error al actualizar el ítem: ${error.message}`);
    }
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
        // --- INICIO DE LA CORRECCIÓN ---
        // Se estandariza la ruta de guardado para que sea consistente con otros documentos.
        const filePath = `project_documents/${currentProject.id}/otro_si/${Date.now()}_${file.name}`;
        // --- FIN DE LA CORRECCIÓN ---

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

async function openMainModal(type, data = {}) {
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

            const { request, materials } = data;

            // Generamos una sección para cada material en la solicitud
            const materialFormsHtml = materials.map(material => {
                // Buscamos si ya hay devoluciones para este material específico
                const returnedInfo = (request.returnedItems || []).find(item => item.materialId === material.materialId);
                const alreadyReturned = returnedInfo ? returnedInfo.quantity : 0;
                const maxReturn = material.quantity - alreadyReturned;

                // Si ya no se puede devolver más de este item, lo mostramos como deshabilitado
                if (maxReturn <= 0) {
                    return `
                        <div class="p-3 border rounded-md bg-gray-100 opacity-60">
                            <p class="font-semibold text-gray-800">${material.name}</p>
                            <p class="text-sm text-green-600">Todas las unidades fueron devueltas.</p>
                        </div>
                    `;
                }

                // Si el material NO es divisible
                if (!material.isDivisible) {
                    return `
                        <div class="material-return-item p-3 border rounded-md" data-material-id="${material.materialId}">
                            <p class="font-semibold text-gray-800">${material.name}</p>
                            <p class="text-xs text-gray-500 mb-2">Máximo a devolver: ${maxReturn} unidades</p>
                            <label class="block text-sm font-medium">Cantidad a Devolver</label>
                            <input type="number" name="quantity_${material.materialId}" class="return-quantity mt-1 w-full border p-2 rounded-md" max="${maxReturn}" min="0" placeholder="0">
                            <input type="hidden" name="type_${material.materialId}" value="complete">
                        </div>
                    `;
                }
                // Si SÍ es divisible
                else {
                    return `
                        <div class="material-return-item p-3 border rounded-md" data-material-id="${material.materialId}">
                            <p class="font-semibold text-gray-800">${material.name}</p>
                            <div class="mt-2 space-y-2">
                                <label class="flex items-center"><input type="radio" name="type_${material.materialId}" value="complete" class="return-type mr-2" checked> Unidades Completas</label>
                                <label class="flex items-center"><input type="radio" name="type_${material.materialId}" value="remnant" class="return-type mr-2"> Retazos</label>
                            </div>
                            
                            <div class="return-complete-section mt-2">
                                <p class="text-xs text-gray-500 mb-1">Máximo a devolver: ${maxReturn} unidades</p>
                                <input type="number" name="quantity_${material.materialId}" class="return-quantity w-full border p-2 rounded-md" max="${maxReturn}" min="0" placeholder="0">
                            </div>
                            
                            <div class="return-remnant-section hidden mt-2 space-y-2">
                                <div class="remnant-fields-container space-y-2">
                                    <div class="remnant-item grid grid-cols-3 gap-2 items-center">
                                        <input type="number" step="0.01" name="remnant_length_${material.materialId}" placeholder="Medida" class="border p-2 rounded-md text-sm">
                                        <input type="number" name="remnant_quantity_${material.materialId}" placeholder="Cantidad" class="border p-2 rounded-md text-sm">
                                        <button type="button" class="remove-remnant-btn text-red-500 text-xs">Eliminar</button>
                                    </div>
                                </div>
                                <button type="button" class="add-remnant-btn text-sm text-blue-600 font-semibold">+ Añadir otro tamaño</button>
                            </div>
                        </div>
                    `;
                }
            }).join('');

            bodyHtml = `<div class="space-y-4">${materialFormsHtml}</div>`;

            setTimeout(() => {
                const form = document.getElementById('modal-form');
                form.addEventListener('change', (e) => {
                    if (e.target.classList.contains('return-type')) {
                        const container = e.target.closest('.material-return-item');
                        const completeSection = container.querySelector('.return-complete-section');
                        const remnantSection = container.querySelector('.return-remnant-section');
                        if (e.target.value === 'complete') {
                            completeSection.classList.remove('hidden');
                            remnantSection.classList.add('hidden');
                        } else {
                            completeSection.classList.add('hidden');
                            remnantSection.classList.remove('hidden');
                        }
                    }
                });

                form.addEventListener('click', (e) => {
                    if (e.target.classList.contains('add-remnant-btn')) {
                        const container = e.target.closest('.material-return-item').querySelector('.remnant-fields-container');
                        const newItem = container.firstElementChild.cloneNode(true);
                        newItem.querySelectorAll('input').forEach(input => input.value = '');
                        container.appendChild(newItem);
                    }
                    if (e.target.classList.contains('remove-remnant-btn')) {
                        const container = e.target.closest('.remnant-fields-container');
                        if (container.children.length > 1) {
                            e.target.closest('.remnant-item').remove();
                        }
                    }
                });
            }, 100);

            // Guardamos los datos necesarios en el formulario para usarlos al guardar
            modalForm.dataset.id = request.id;
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
                    <div><label class="block text-sm font-medium">Referencia / SKU (Opcional)</label><input type="text" name="reference" class="mt-1 w-full border p-2 rounded-md" value="${isEditing ? data.reference || '' : ''}"></div>
                    <div class="grid grid-cols-2 gap-4">
                        <div><label class="block text-sm font-medium">Unidad de Medida</label><input type="text" name="unit" required class="mt-1 w-full border p-2 rounded-md" value="${isEditing ? data.unit : ''}" placeholder="ej: Tira, Lámina, Und"></div>
                        <div><label class="block text-sm font-medium">Umbral de Stock Mínimo</label><input type="number" name="minStockThreshold" class="mt-1 w-full border p-2 rounded-md" value="${isEditing ? data.minStockThreshold || '' : ''}" placeholder="Ej: 10"></div>
                    </div>
                    
                    <div class="border-t pt-4 space-y-4">
                        <div>
                            <label for="measurementType-select" class="block text-sm font-medium">Tipo de Medida</label>
                            <select id="measurementType-select" name="measurementType" class="mt-1 w-full border rounded-md p-2 bg-white">
                                <option value="unit" ${isEditing && data.measurementType === 'unit' ? 'selected' : ''}>Por Unidad (ej: tornillos, accesorios)</option>
                                <option value="linear" ${isEditing && data.measurementType === 'linear' ? 'selected' : ''}>Lineal (ej: perfiles, tiras)</option>
                                <option value="area" ${isEditing && data.measurementType === 'area' ? 'selected' : ''}>Por Área (ej: láminas de vidrio)</option>
                            </select>
                        </div>

                        <div id="dimensions-container" class="hidden space-y-4">
                            <p class="text-xs text-gray-500">Define el tamaño estándar de una unidad de compra (ej: una tira mide 6m).</p>
                            <div class="grid grid-cols-2 gap-4">
                                <div id="length-field">
                                    <label class="block text-sm font-medium">Largo Estándar (m)</label>
                                    <input type="number" step="0.01" name="defaultLength" class="mt-1 w-full border p-2 rounded-md" value="${isEditing && data.defaultSize ? data.defaultSize.length || '' : ''}">
                                </div>
                                <div id="width-field" class="hidden">
                                    <label class="block text-sm font-medium">Ancho Estándar (m)</label>
                                    <input type="number" step="0.01" name="defaultWidth" class="mt-1 w-full border p-2 rounded-md" value="${isEditing && data.defaultSize ? data.defaultSize.width || '' : ''}">
                                </div>
                            </div>
                        </div>
                    </div>
                    </div>`;

            // Lógica para mostrar/ocultar los campos de dimensiones
            setTimeout(() => {
                const measurementSelect = document.getElementById('measurementType-select');
                const dimensionsContainer = document.getElementById('dimensions-container');
                const lengthField = document.getElementById('length-field');
                const widthField = document.getElementById('width-field');

                const toggleDimensionFields = () => {
                    const selectedType = measurementSelect.value;
                    if (selectedType === 'linear' || selectedType === 'area') {
                        dimensionsContainer.classList.remove('hidden');
                        lengthField.classList.remove('hidden');
                        widthField.classList.toggle('hidden', selectedType !== 'area');
                    } else {
                        dimensionsContainer.classList.add('hidden');
                    }
                };

                measurementSelect.addEventListener('change', toggleDimensionFields);
                toggleDimensionFields(); // Ejecutar al abrir para establecer el estado inicial
            }, 100);
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

            const catalog = data.catalog || [];
            const suppliers = data.suppliers || [];

            const materialOptions = catalog.map(mat => `<option value="${mat.id}" data-unit="${mat.unit}">${mat.name} (${mat.reference || 'N/A'})</option>`).join('');

            // --- INICIO DE LA CORRECCIÓN ---
            // Ahora construimos las opciones de los proveedores directamente aquí.
            const supplierOptions = suppliers.map(sup => `<option value="${sup.id}">${sup.name}</option>`).join('');
            // --- FIN DE LA CORRECCIÓN ---

            bodyHtml = `
        <div class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label class="block text-sm font-medium">Proveedor</label>
                    <select id="po-supplier-select" required>${supplierOptions}</select>
                </div>
                <div>
                    <label class="block text-sm font-medium">Forma de Pago</label>
                    <select name="paymentMethod" class="w-full border p-2 rounded-md bg-white">
                        <option value="pendiente">Pendiente</option>
                        <option value="efectivo">Efectivo</option>
                        <option value="tarjeta">Tarjeta</option>
                        <option value="transferencia">Transferencia</option>
                    </select>
                </div>
            </div>
            <div id="po-items-container" class="space-y-2 border-t pt-4">
                <h4 class="text-md font-semibold text-gray-700">Materiales</h4>
                <div class="po-item flex flex-col sm:flex-row sm:items-end gap-2 p-2 border rounded-md">
                    <div class="flex-grow w-full"><label class="block text-xs">Material</label><select name="materialId" class="po-material-select w-full border p-2 rounded-md bg-white">${materialOptions}</select></div>
                    <div class="w-full sm:w-24"><label class="block text-xs">Cantidad</label><input type="number" name="quantity" required class="w-full border p-2 rounded-md"></div>
                    <div class="w-full sm:w-32"><label class="block text-xs">Costo Unitario</label><input type="text" name="unitCost" required class="currency-input w-full border p-2 rounded-md"></div>
                </div>
            </div>
            <button type="button" id="add-po-item-btn" class="text-sm text-blue-600 font-semibold">+ Añadir otro material</button>
        </div>`;

            setTimeout(() => {
                // --- INICIO DE LA CORRECCIÓN ---
                // Ahora, simplemente inicializamos Choices.js en el <select> que ya tiene los datos.
                const supplierSelectEl = document.getElementById('po-supplier-select');
                if (supplierSelectEl) {
                    new Choices(supplierSelectEl, {
                        itemSelectText: 'Seleccionar',
                        searchPlaceholderValue: 'Buscar proveedor...',
                        placeholder: true,
                        placeholderValue: 'Selecciona un proveedor',
                    });
                }
                // --- FIN DE LA CORRECCIÓN ---

                // El resto de la lógica no cambia
                const container = document.getElementById('po-items-container');
                const firstItem = container.querySelector('.po-item');
                document.getElementById('add-po-item-btn').addEventListener('click', () => {
                    const newItem = firstItem.cloneNode(true);
                    newItem.querySelectorAll('input').forEach(input => input.value = '');
                    container.appendChild(newItem);
                });

                container.addEventListener('change', async (e) => {
                    if (e.target.classList.contains('po-material-select')) {
                        const materialId = e.target.value;
                        const supplierId = supplierSelectEl.value;
                        if (!supplierId || !materialId) return;
                        const costInput = e.target.closest('.po-item').querySelector('.currency-input');
                        const lastPrice = await findLastPurchasePrice(supplierId, materialId);
                        if (lastPrice !== null) {
                            costInput.value = currencyFormatter.format(lastPrice).replace(/\s/g, ' ');
                        } else {
                            costInput.value = '';
                        }
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
        case 'new-supplier-payment': {
            title = 'Registrar Pago a Proveedor';
            btnText = 'Guardar Pago';
            btnClass = 'bg-green-500 hover:bg-green-600';
            bodyHtml = `
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium">Monto del Pago</label>
                        <input type="text" name="amount" required class="currency-input mt-1 w-full border rounded-md p-2">
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Método de Pago</label>
                        <select name="paymentMethod" class="mt-1 w-full border rounded-md p-2 bg-white">
                            <option value="Transferencia">Transferencia</option>
                            <option value="Efectivo">Efectivo</option>
                            <option value="Tarjeta">Tarjeta</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Fecha del Pago</label>
                        <input type="date" name="date" required class="mt-1 w-full border rounded-md p-2" value="${new Date().toISOString().split('T')[0]}">
                    </div>
                </div>
            `;
            setTimeout(() => {
                setupCurrencyInput(modalForm.querySelector('input[name="amount"]'));
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
        case 'new-supplier':
        case 'edit-supplier': {
            const isEditing = type === 'edit-supplier';
            title = isEditing ? 'Editar Proveedor' : 'Nuevo Proveedor';
            btnText = isEditing ? 'Guardar Cambios' : 'Crear Proveedor';
            btnClass = isEditing ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-blue-500 hover:bg-blue-600';

            // El HTML del formulario
            bodyHtml = `
                <div class="space-y-4">
                    <h4 class="text-md font-semibold text-gray-700 border-b pb-2">Información Principal</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium">Nombre o Razón Social</label>
                            <input type="text" name="name" required class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.name || '' : ''}">
                        </div>
                        <div>
                            <label class="block text-sm font-medium">NIT o Cédula</label>
                            <input type="text" name="nit" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.nit || '' : ''}">
                        </div>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium">Correo Electrónico</label>
                            <input type="email" name="email" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.email || '' : ''}">
                        </div>
                        <div>
                            <label class="block text-sm font-medium">Dirección</label>
                            <input type="text" name="address" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.address || '' : ''}">
                        </div>
                    </div>

                    <h4 class="text-md font-semibold text-gray-700 border-b pb-2 pt-4">Información de Contacto</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium">Nombre del Contacto</label>
                            <input type="text" name="contactName" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.contactName || '' : ''}">
                        </div>
                        <div>
                            <label class="block text-sm font-medium">Teléfono de Contacto</label>
                            <input type="tel" name="contactPhone" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.contactPhone || '' : ''}">
                        </div>
                    </div>

                    <h4 class="text-md font-semibold text-gray-700 border-b pb-2 pt-4">Información Bancaria</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium">Banco</label>
                            <input type="text" name="bankName" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.bankName || '' : ''}">
                        </div>
                        <div>
                            <label class="block text-sm font-medium">Tipo de Cuenta</label>
                            <select name="accountType" class="mt-1 w-full border rounded-md p-2 bg-white">
                                <option value="Ahorros" ${isEditing && data.accountType === 'Ahorros' ? 'selected' : ''}>Ahorros</option>
                                <option value="Corriente" ${isEditing && data.accountType === 'Corriente' ? 'selected' : ''}>Corriente</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Número de Cuenta</label>
                        <input type="text" name="accountNumber" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.accountNumber || '' : ''}">
                    </div>
                </div>
            `;
            break;
        }
        case 'request-material': {
            title = 'Crear Solicitud de Material';
            btnText = 'Enviar Solicitud';
            btnClass = 'bg-green-500 hover:bg-green-600';

            bodyHtml = `
        <div id="material-request-loader" class="text-center py-8">
        <div class="loader mx-auto"></div>
        <p class="mt-2 text-sm text-gray-500">Cargando datos del proyecto...</p>
        </div>
        <div id="material-request-form-content" class="hidden"></div>
        `;

            const loadDataAndBuildForm = async () => {
                try {
                    const loader = document.getElementById('material-request-loader');
                    const formContent = document.getElementById('material-request-form-content');

                    const [inventorySnapshot, itemsSnapshot] = await Promise.all([
                        getDocs(query(collection(db, "materialCatalog"))),
                        getDocs(query(collection(db, "items"), where("projectId", "==", currentProject.id)))
                    ]);

                    const inventory = inventorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    const items = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                    const materialOptions = inventory.map(mat => ({
                        value: mat.id,
                        label: `${mat.name} (Stock: ${mat.quantityInStock || 0})`,
                        // --- AÑADE 'stock' A ESTA LÍNEA ---
                        customProperties: { isDivisible: mat.isDivisible, name: mat.name, defaultLength: mat.defaultSize?.length || 0, stock: mat.quantityInStock || 0 }
                    }));

                    let userSelectorHtml = '';
                    if (currentUserRole === 'admin' || currentUserRole === 'bodega') {
                        const userOptions = Array.from(usersMap.entries()).filter(([uid, user]) => user.status === 'active').map(([uid, user]) => `<option value="${uid}" ${uid === currentUser.uid ? 'selected' : ''}>${user.firstName} ${user.lastName}</option>`).join('');
                        userSelectorHtml = `<div class="border p-3 rounded-lg"><h4 class="font-semibold text-gray-700 mb-2">3. ¿Quién solicita?</h4><select id="request-as-user-select" class="w-full border p-2 rounded-md bg-white text-sm">${userOptions}</select></div>`;
                    }

                    const itemInputsHtml = items.filter(item => item && item.id && item.name).map(item => `<div class="request-item-card p-2 border rounded-md bg-gray-50"><label class="block text-sm font-semibold">${item.name} <span class="text-xs font-normal text-gray-500">(${item.quantity} Unidades)</span></label><div class="flex items-center mt-1"><span class="text-sm mr-2">Cantidad:</span><input type="number" data-item-id="${item.id}" class="request-item-quantity w-24 border p-1 rounded-md text-sm" placeholder="0" min="0" max="${item.quantity}"></div></div>`).join('');

                    formContent.innerHTML = `
            <div class="space-y-4">
                <div class="border p-3 rounded-lg">
                    <h4 class="font-semibold text-gray-700 mb-2">1. Añadir Materiales</h4>
                    <div class="flex-grow w-full mb-2">
                        <label class="block text-xs font-medium">Buscar Material</label>
                        <select id="material-choices-select"></select>
                    </div>
                    
                    <div id="units-section" class="hidden flex items-end gap-2">
                        <div class="flex-grow">
                            <label class="block text-xs font-medium">Cantidad de Unidades Completas</label>
                            <input type="number" id="new-request-quantity" class="w-full border p-2 rounded-md">
                        </div>
                        <button type="button" id="add-material-to-request-btn" class="flex-shrink-0 bg-blue-500 text-white py-2 px-3 rounded-md text-sm">Añadir</button>
                    </div>

                    <div id="divisible-section" class="hidden mt-2 pt-2 border-t">
                        <p class="text-xs text-gray-500 mb-2">Este material se puede pedir por cortes. Añade las medidas que necesitas.</p>
                            <div id="cuts-container" class="space-y-2"></div>
                            <button type="button" id="add-cut-btn" class="text-sm text-blue-600 font-semibold mt-2">+ Añadir Medida de Corte</button>
                    </div>
                    
                    <div id="remnants-container" class="hidden mt-4 pt-4 border-t">
                        <h5 class="text-sm font-semibold text-gray-700 mb-2">Retazos Disponibles</h5>
                        <div id="remnants-list" class="space-y-2 max-h-32 overflow-y-auto"></div>
                    </div>

                    <div id="request-items-list" class="mt-3 space-y-2 max-h-48 overflow-y-auto border-t pt-3"></div>
                </div>
                <div class="border p-3 rounded-lg">
                    <h4 class="font-semibold text-gray-700 mb-2">2. ¿Para cuántas unidades se usará?</h4>
                    <input type="text" id="request-item-search" placeholder="Buscar ítem por nombre..." class="w-full border p-2 rounded-md text-sm mb-3">
                    <div id="request-item-list-container" class="max-h-48 overflow-y-auto space-y-2 pr-2">${itemInputsHtml}</div>
                </div>
                ${userSelectorHtml}
            </div>`;

                    loader.classList.add('hidden');
                    formContent.classList.remove('hidden');

                    const choices = new Choices('#material-choices-select', {
                        choices: materialOptions,
                        searchEnabled: true, itemSelectText: 'Seleccionar', placeholder: true, placeholderValue: 'Escribe para buscar...',
                    });

                    setupMaterialChoices(choices);
                    setupAddMaterialButton(choices);
                    setupCutManagement(choices);
                    setupRequestItemSearch();

                } catch (error) { console.error("Error al cargar datos para solicitud:", error); }
            };

            setTimeout(loadDataAndBuildForm, 50);
            break;
        }
        case 'edit-task': { // Case con formato mejorado
            title = 'Editar Tarea';
            btnText = 'Guardar Cambios';
            btnClass = 'bg-yellow-500 hover:bg-yellow-600';
            modalForm.dataset.id = data.id; // Guardamos el ID de la tarea

            modalBody.innerHTML = '<div class="text-center py-5"><div class="loader mx-auto"></div> Cargando datos...</div>';
            mainModal.style.display = 'flex';

            let allActiveUsers = [];
            try {
                usersMap.forEach((user, userId) => {
                    if (user.status === 'active') {
                        allActiveUsers.push({ id: userId, name: `${user.firstName} ${user.lastName}` });
                    }
                });
                allActiveUsers.sort((a, b) => a.name.localeCompare(b.name));
            } catch (error) {
                console.error("Error cargando usuarios para editar tarea:", error);
                closeMainModal();
                alert("Error al cargar usuarios.");
                return;
            }

            // --- Construcción del HTML con formato mejorado ---
            const additionalAssigneeValues = (data.additionalAssigneeIds || []).map(id => ({ value: id }));

            bodyHtml = `
                <div class="space-y-6"> 

                     <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4">
                         <h4 class="text-md font-semibold text-gray-700 mb-2 border-b pb-1">1. Información Principal</h4>
                        <div>
                            <label class="block text-sm font-medium text-gray-500 mb-1">Proyecto</label>
                            <p class="mt-1 font-semibold bg-white p-2 border rounded-md text-gray-700">${data.projectName || 'N/A'}</p>
                            <input type="hidden" name="projectId" value="${data.projectId}">
                            <input type="hidden" name="projectName" value="${data.projectName}">
                        </div>

                        <div>
                            <label for="edit-task-assignee-choices" class="block text-sm font-medium mb-1">Asignar A (Principal)</label>
                            <select id="edit-task-assignee-choices" name="assigneeId" required placeholder="Buscar o seleccionar usuario..."></select>
                            <input type="hidden" name="assigneeName">
                        </div>
                    </div>

                    <div class="border border-gray-200 rounded-lg p-4 bg-gray-100">
                        <label class="block text-sm font-medium text-gray-600 mb-2">2. Ítems Relacionados (No editable)</label>
                        <ul id="edit-task-items-list" class="max-h-40 overflow-y-auto space-y-1 text-sm text-gray-700 pl-5 pr-2">
                            <li class="italic text-gray-500">Cargando ítems...</li>
                        </ul>
                    </div>

                    <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4">
                         <h4 class="text-md font-semibold text-gray-700 mb-2 border-b pb-1">3. Detalles de la Tarea</h4>
                        <div>
                            <label for="edit-task-description" class="block text-sm font-medium mb-1">Descripción de la Tarea</label>
                            <textarea id="edit-task-description" name="description" rows="3" required class="mt-1 w-full border rounded-md p-2 text-sm">${data.description || ''}</textarea>
                        </div>

                        <div>
                            <label for="edit-task-additional-assignees-choices" class="block text-sm font-medium mb-1">Asignar a Personas Adicionales</label>
                            <select id="edit-task-additional-assignees-choices" name="additionalAssigneeIds" multiple placeholder="Buscar o añadir más usuarios..."></select>
                        </div>

                        <div>
                            <label for="edit-task-dueDate" class="block text-sm font-medium mb-1">Fecha Límite</label>
                            <input type="date" id="edit-task-dueDate" name="dueDate" class="mt-1 w-full border rounded-md p-2 text-sm" value="${data.dueDate || ''}">
                        </div>
                    </div>

                </div>`; // Fin de space-y-6

            modalBody.innerHTML = bodyHtml;

            // --- Inicialización de Choices.js y Lógica Dinámica (sin cambios) ---
            setTimeout(() => {
                // Asignado Principal
                const assigneeElement = document.getElementById('edit-task-assignee-choices');
                const assigneeChoices = new Choices(assigneeElement, { /* ... opciones ... */
                    choices: allActiveUsers.map(u => ({ value: u.id, label: u.name })),
                    searchPlaceholderValue: "Buscar usuario...", itemSelectText: 'Seleccionar', allowHTML: false,
                });
                if (data.assigneeId) {
                    assigneeChoices.setValue([{ value: data.assigneeId, label: data.assigneeName || 'Usuario' }]);
                    modalForm.querySelector('input[name="assigneeName"]').value = data.assigneeName || '';
                }
                assigneeElement.addEventListener('change', (event) => { /* ... (código para guardar nombre) ... */
                    const selectedAssigneeId = event.detail.value;
                    const assigneeNameInput = modalForm.querySelector('input[name="assigneeName"]');
                    const selectedUser = allActiveUsers.find(u => u.id === selectedAssigneeId);
                    assigneeNameInput.value = selectedUser ? selectedUser.name : '';
                });

                // Asignados Adicionales
                const additionalAssigneesElement = document.getElementById('edit-task-additional-assignees-choices');
                const additionalAssigneesChoices = new Choices(additionalAssigneesElement, { /* ... opciones ... */
                    choices: allActiveUsers.map(u => ({ value: u.id, label: u.name })),
                    removeItemButton: true, searchPlaceholderValue: "Añadir más usuarios...", allowHTML: false,
                });
                if (additionalAssigneeValues.length > 0) {
                    const preSelectedLabels = additionalAssigneeValues.map(v => {
                        const user = allActiveUsers.find(u => u.id === v.value);
                        return { value: v.value, label: user ? user.name : 'Usuario Desconocido' };
                    });
                    additionalAssigneesChoices.setValue(preSelectedLabels);
                }

                // Cargar y mostrar los ítems (solo visualización)
                const itemsListUl = document.getElementById('edit-task-items-list');
                if (data.selectedItems && data.selectedItems.length > 0) {
                    const itemDetailPromises = data.selectedItems.map(async itemInfo => { /* ... (código para cargar nombres) ... */
                        try {
                            const itemDoc = await getDoc(doc(db, "items", itemInfo.itemId));
                            const itemName = itemDoc.exists() ? itemDoc.data().name : `ID: ${itemInfo.itemId}`;
                            return `<li class="list-disc">${itemInfo.quantity} x ${itemName}</li>`; // Añadido list-disc
                        } catch { return `<li class="list-disc text-red-500">Error cargando ítem</li>`; } // Añadido list-disc
                    });
                    Promise.all(itemDetailPromises).then(htmlItems => {
                        if (itemsListUl) itemsListUl.innerHTML = htmlItems.join('');
                    });
                } else {
                    if (itemsListUl) itemsListUl.innerHTML = '<li class="italic text-gray-500">No hay ítems asociados.</li>';
                }

                // Fecha mínima
                const dueDateInput = modalBody.querySelector('#edit-task-dueDate');
                if (dueDateInput) {
                    dueDateInput.min = new Date().toISOString().split("T")[0];
                }

                // Destruir Choices al cerrar
                mainModal.addEventListener('close', () => {
                    assigneeChoices.destroy();
                    additionalAssigneesChoices.destroy();
                }, { once: true });

            }, 150);

            break; // Fin del case 'edit-task'
        }
        case 'new-task': { // Case con formato mejorado
            title = 'Crear Nueva Tarea';
            btnText = 'Guardar Tarea';
            btnClass = 'bg-green-500 hover:bg-green-600';

            modalBody.innerHTML = '<div class="text-center py-5"><div class="loader mx-auto"></div> Cargando datos...</div>';
            mainModal.style.display = 'flex';

            let activeProjects = [];
            let allActiveUsers = [];
            try {
                const projectsQuery = query(collection(db, "projects"), where("status", "==", "active"), orderBy("name"));
                const projectsSnapshot = await getDocs(projectsQuery);
                activeProjects = projectsSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name }));

                usersMap.forEach((user, userId) => {
                    if (user.status === 'active') {
                        allActiveUsers.push({ id: userId, name: `${user.firstName} ${user.lastName}` });
                    }
                });
                allActiveUsers.sort((a, b) => a.name.localeCompare(b.name));

            } catch (error) {
                console.error("Error cargando datos para nueva tarea:", error);
                closeMainModal();
                alert("Error al cargar la información necesaria para crear la tarea.");
                return;
            }

            // --- Construcción del HTML con formato mejorado ---
            bodyHtml = `
                <div class="space-y-6">

                    <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4">
                         <h4 class="text-md font-semibold text-gray-700 mb-2 border-b pb-1">1. Información Principal</h4>
                        <div>
                            <label for="task-project-choices" class="block text-sm font-medium mb-1">Proyecto (Activos)</label>
                            <select id="task-project-choices" name="projectId" required placeholder="Buscar o seleccionar proyecto..."></select>
                             <input type="hidden" name="projectName"> 
                        </div>

                        <div>
                            <label for="task-assignee-choices" class="block text-sm font-medium mb-1">Asignar A (Principal)</label>
                            <select id="task-assignee-choices" name="assigneeId" required placeholder="Buscar o seleccionar usuario..."></select>
                            <input type="hidden" name="assigneeName">
                        </div>
                    </div>

                    <div id="task-items-selection" class="hidden border border-gray-200 rounded-lg p-4">
                        <label class="block text-sm font-medium mb-2 text-gray-700">2. Ítems Relacionados <span class="text-red-500 font-semibold">*</span></label>
                        <div id="task-items-list" class="max-h-48 overflow-y-auto space-y-2 text-sm pr-2">
                            <p class="text-gray-400 italic">Selecciona un proyecto para ver sus ítems.</p>
                        </div>
                    </div>

                     <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4">
                         <h4 class="text-md font-semibold text-gray-700 mb-2 border-b pb-1">3. Detalles de la Tarea</h4>
                        <div>
                            <label for="task-description" class="block text-sm font-medium mb-1">Descripción de la Tarea</label>
                            <textarea id="task-description" name="description" rows="3" required class="mt-1 w-full border rounded-md p-2 text-sm" placeholder="Describe brevemente la tarea..."></textarea>
                        </div>

                        <div>
                            <label for="task-additional-assignees-choices" class="block text-sm font-medium mb-1">Asignar a Personas Adicionales (Opcional)</label>
                            <select id="task-additional-assignees-choices" name="additionalAssigneeIds" multiple placeholder="Buscar o añadir más usuarios..."></select>
                        </div>

                        <div>
                            <label for="task-dueDate" class="block text-sm font-medium mb-1">Fecha Límite (Opcional)</label>
                            <input type="date" id="task-dueDate" name="dueDate" class="mt-1 w-full border rounded-md p-2 text-sm">
                        </div>
                    </div>

                </div>`; // Fin de space-y-6

            modalBody.innerHTML = bodyHtml;
            document.getElementById('modal-title').textContent = title;
            const confirmBtn = document.getElementById('modal-confirm-btn');
            confirmBtn.textContent = btnText;
            confirmBtn.className = `text-white font-bold py-2 px-4 rounded-lg transition-all ${btnClass}`;

            // --- Inicialización de Choices.js y Lógica Dinámica (sin cambios) ---
            setTimeout(() => {
                const projectElement = document.getElementById('task-project-choices');
                const projectChoices = new Choices(projectElement, { /* ... opciones ... */
                    choices: activeProjects.map(p => ({ value: p.id, label: p.name })),
                    searchPlaceholderValue: "Buscar proyecto...", itemSelectText: 'Seleccionar', allowHTML: false,
                });

                const assigneeElement = document.getElementById('task-assignee-choices');
                const assigneeChoices = new Choices(assigneeElement, { /* ... opciones ... */
                    choices: allActiveUsers.map(u => ({ value: u.id, label: u.name })),
                    searchPlaceholderValue: "Buscar usuario...", itemSelectText: 'Seleccionar', allowHTML: false,
                });

                const additionalAssigneesElement = document.getElementById('task-additional-assignees-choices');
                const additionalAssigneesChoices = new Choices(additionalAssigneesElement, { /* ... opciones ... */
                    choices: allActiveUsers.map(u => ({ value: u.id, label: u.name })),
                    removeItemButton: true, searchPlaceholderValue: "Añadir más usuarios...", allowHTML: false,
                });

                // --- Lógica para cargar ítems al seleccionar proyecto ---
                projectElement.addEventListener('change', async (event) => { /* ... (código existente sin cambios) ... */
                    const selectedProjectId = event.detail.value;
                    const itemsSelectionDiv = document.getElementById('task-items-selection');
                    const itemsListDiv = document.getElementById('task-items-list');
                    const projectNameInput = modalForm.querySelector('input[name="projectName"]'); // Campo oculto

                    // Guardar nombre del proyecto seleccionado
                    const selectedProject = activeProjects.find(p => p.id === selectedProjectId);
                    projectNameInput.value = selectedProject ? selectedProject.name : '';


                    if (selectedProjectId) {
                        itemsListDiv.innerHTML = '<p class="text-gray-400">Cargando ítems...</p>';
                        itemsSelectionDiv.classList.remove('hidden');

                        try {
                            const itemsQuery = query(collection(db, "items"), where("projectId", "==", selectedProjectId), orderBy("name"));
                            const itemsSnapshot = await getDocs(itemsQuery);
                            if (itemsSnapshot.empty) {
                                itemsListDiv.innerHTML = '<p class="text-gray-400">Este proyecto no tiene ítems definidos.</p>';
                            } else {
                                itemsListDiv.innerHTML = ''; // Limpiar
                                itemsSnapshot.forEach(doc => {
                                    const item = { id: doc.id, ...doc.data() };
                                    // Creamos el HTML para cada ítem con el campo de cantidad
                                    itemsListDiv.innerHTML += `
                                        <div class="task-item-row flex items-center justify-between py-1 hover:bg-gray-100 px-1 rounded">
                                            <label class="inline-flex items-center flex-grow mr-2 cursor-pointer"> 
                                                <input type="checkbox" name="selectedItemIds" value="${item.id}" data-item-quantity="${item.quantity}" class="item-checkbox rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50">
                                                <span class="ml-2 truncate" title="${item.name}">${item.name}</span>
                                            </label>
                                            <input type="number" name="itemQuantity_${item.id}" min="1" max="${item.quantity}" placeholder="Cant." class="item-quantity-input w-20 border rounded-md p-1 text-sm bg-gray-100 focus:bg-white focus:ring-1 focus:ring-blue-300" disabled>
                                        </div>
                                    `;
                                });

                                // Añadimos un listener para habilitar/deshabilitar el input de cantidad
                                itemsListDiv.addEventListener('change', (e) => {
                                    if (e.target.classList.contains('item-checkbox')) {
                                        const quantityInput = e.target.closest('.task-item-row').querySelector('.item-quantity-input');
                                        if (quantityInput) {
                                            quantityInput.disabled = !e.target.checked;
                                            quantityInput.classList.toggle('bg-gray-100', !e.target.checked); // Visual feedback
                                            quantityInput.classList.toggle('focus:bg-white', e.target.checked); // Estilo focus
                                            if (!e.target.checked) {
                                                quantityInput.value = ''; // Limpiar cantidad si se desmarca
                                            } else {
                                                quantityInput.focus(); // Poner foco para ingresar cantidad
                                            }
                                        }
                                    }
                                });
                            }
                        } catch (error) {
                            console.error("Error cargando ítems para la tarea:", error);
                            itemsListDiv.innerHTML = '<p class="text-red-500">Error al cargar ítems.</p>';
                        }
                    } else {
                        // Si se deselecciona el proyecto
                        itemsSelectionDiv.classList.add('hidden');
                        itemsListDiv.innerHTML = '<p class="text-gray-400">Selecciona un proyecto para ver sus ítems.</p>';
                        projectNameInput.value = ''; // Limpiar nombre oculto
                    }
                });


                // Guardar nombre del asignado principal
                assigneeElement.addEventListener('change', (event) => { /* ... (código existente sin cambios) ... */
                    const selectedAssigneeId = event.detail.value;
                    const assigneeNameInput = modalForm.querySelector('input[name="assigneeName"]'); // Campo oculto
                    const selectedUser = allActiveUsers.find(u => u.id === selectedAssigneeId);
                    assigneeNameInput.value = selectedUser ? selectedUser.name : '';
                });

                // Establecer fecha mínima para dueDate
                const dueDateInput = modalBody.querySelector('#task-dueDate');
                if (dueDateInput) {
                    dueDateInput.min = new Date().toISOString().split("T")[0];
                }

                // Destruir instancias de Choices al cerrar el modal
                mainModal.addEventListener('close', () => {
                    projectChoices.destroy();
                    assigneeChoices.destroy();
                    additionalAssigneesChoices.destroy();
                }, { once: true });

            }, 150);

            break; // Fin del case 'new-task'
        }
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

    if (type === 'new-task') {
        await createTask(data); // Llama a la nueva función para crear la tarea
        return; // Salimos para no ejecutar el switch de abajo
    }

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
            currentProject = { ...currentProject, ...updatedData };
            showProjectDetails(currentProject);
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
            const measurementType = data.measurementType;
            const isDivisible = measurementType === 'linear' || measurementType === 'area';

            const catalogData = {
                name: data.name,
                reference: data.reference,
                unit: data.unit,
                minStockThreshold: parseInt(data.minStockThreshold) || 0,
                isDivisible: isDivisible, // Guardamos si es divisible
                measurementType: measurementType, // Guardamos el tipo de medida
                defaultSize: isDivisible ? { // Guardamos las dimensiones
                    length: parseFloat(data.defaultLength) || 0,
                    width: parseFloat(data.defaultWidth) || 0
                } : null,
                quantityInStock: 0
            };
            await addDoc(collection(db, "materialCatalog"), catalogData);
            break;
        }
        case 'edit-task': { // Nuevo case para guardar edición de tarea
            const taskId = id; // El ID de la tarea se guardó en modalForm.dataset.id
            if (!taskId) {
                alert("Error: No se pudo identificar la tarea a editar.");
                break;
            }

            // Recolectar datos actualizados del formulario
            const assigneeId = data.assigneeId;
            const assigneeName = data.assigneeName; // Nombre guardado desde el cambio en Choices
            const additionalAssignees = data.additionalAssigneeIds ?
                (Array.isArray(data.additionalAssigneeIds) ? data.additionalAssigneeIds : [data.additionalAssigneeIds])
                : [];

            const updatedTaskData = {
                assigneeId: assigneeId,
                assigneeName: assigneeName,
                additionalAssigneeIds: additionalAssignees,
                description: data.description,
                dueDate: data.dueDate || null,
                // No actualizamos projectId, projectName, selectedItems, specificSubItemIds
            };

            try {
                await updateDoc(doc(db, "tasks", taskId), updatedTaskData);
                console.log(`Tarea ${taskId} actualizada.`);
                // La vista se refrescará automáticamente por onSnapshot
            } catch (error) {
                console.error(`Error al actualizar la tarea ${taskId}:`, error);
                alert("No se pudo guardar los cambios en la tarea.");
            }
            break; // Fin del case 'edit-task'
        }
        case 'edit-catalog-item': {
            const measurementType = data.measurementType;
            const isDivisible = measurementType === 'linear' || measurementType === 'area';

            const updatedData = {
                name: data.name,
                reference: data.reference,
                unit: data.unit,
                minStockThreshold: parseInt(data.minStockThreshold) || 0,
                isDivisible: isDivisible, // Guardamos si es divisible
                measurementType: measurementType, // Guardamos el tipo de medida
                defaultSize: isDivisible ? { // Guardamos las dimensiones
                    length: parseFloat(data.defaultLength) || 0,
                    width: parseFloat(data.defaultWidth) || 0
                } : null,
            };
            await updateDoc(doc(db, "materialCatalog", id), updatedData);
            break;
        }
        case 'return-material': {
            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = 'Procesando...';

            try {
                const requestId = modalForm.dataset.id;

                // =================== INICIO DE LA MODIFICACIÓN ===================
                await runTransaction(db, async (transaction) => {
                    const returnCounterRef = doc(db, "counters", "materialReturns");
                    const counterDoc = await transaction.get(returnCounterRef);
                    if (!counterDoc.exists()) {
                        throw new Error("El contador de devoluciones 'materialReturns' no existe en Firestore. Por favor, créalo.");
                    }

                    const newReturnCount = (counterDoc.data().count || 0) + 1;
                    const returnId = `DEV-${String(newReturnCount).padStart(4, '0')}`; // Formato: DEV-0001

                    const returnsToProcess = [];
                    document.querySelectorAll('.material-return-item').forEach(itemDiv => {
                        const materialId = itemDiv.dataset.materialId;
                        const returnType = itemDiv.querySelector(`input[name="type_${materialId}"]:checked`)?.value || 'complete';

                        if (returnType === 'complete') {
                            const quantityToReturn = parseInt(itemDiv.querySelector(`input[name="quantity_${materialId}"]`).value);
                            if (quantityToReturn > 0) {
                                returnsToProcess.push({ type: 'complete', materialId, quantity: quantityToReturn });
                            }
                        } else if (returnType === 'remnant') {
                            // La lógica para retazos no cambia, pero se ejecutará dentro de la transacción
                            const remnants = [];
                            itemDiv.querySelectorAll('.remnant-item').forEach(remnantDiv => {
                                const length = parseFloat(remnantDiv.querySelector(`input[name^="remnant_length_"]`).value);
                                const quantity = parseInt(remnantDiv.querySelector(`input[name^="remnant_quantity_"]`).value);
                                if (length > 0 && quantity > 0) {
                                    remnants.push({ length, quantity });
                                }
                            });
                            if (remnants.length > 0) {
                                returnsToProcess.push({ type: 'remnant', materialId, remnants });
                            }
                        }
                    });

                    if (returnsToProcess.length === 0) {
                        throw new Error("No se especificó ninguna cantidad a devolver.");
                    }

                    for (const process of returnsToProcess) {
                        const materialRef = doc(db, "materialCatalog", process.materialId);

                        if (process.type === 'complete') {
                            const batchRef = doc(collection(materialRef, "stockBatches"));
                            transaction.set(batchRef, {
                                purchaseDate: new Date(),
                                quantityInitial: process.quantity,
                                quantityRemaining: process.quantity,
                                unitCost: 0,
                                // Guardamos el nuevo ID y la referencia a la solicitud original
                                returnId: returnId,
                                sourceRequestId: requestId,
                                notes: `Devolución (${returnId}) de Solicitud ${requestId.substring(0, 6)}...`,
                            });
                            transaction.update(materialRef, { quantityInStock: increment(process.quantity) });
                        }
                        else if (process.type === 'remnant') {
                            for (const remnant of process.remnants) {
                                const remnantRef = doc(collection(materialRef, "remnantStock"));
                                transaction.set(remnantRef, {
                                    length: remnant.length,
                                    quantity: remnant.quantity,
                                    unit: 'm',
                                    createdAt: new Date(),
                                    notes: `Sobrante de Devolución (${returnId})`
                                });
                            }
                        }
                    }

                    // Actualizamos el array de devoluciones en la solicitud original para un mejor seguimiento
                    const requestRef = doc(db, "projects", currentProject.id, "materialRequests", requestId);
                    transaction.update(requestRef, {
                        returnedItems: arrayUnion(...returnsToProcess)
                    });

                    // Finalmente, actualizamos el contador
                    transaction.update(returnCounterRef, { count: newReturnCount });
                });
                // =================== FIN DE LA MODIFICACIÓN ===================

                alert("¡Devolución registrada con éxito!");
                closeMainModal();

            } catch (error) {
                console.error("Error al registrar la devolución:", error);
                alert("Error: " + error.message);
            } finally {
                modalConfirmBtn.disabled = false;
                modalConfirmBtn.textContent = 'Confirmar Devolución';
            }
            break;
        }
        case 'new-purchase-order': {
            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = 'Guardando...';

            try {
                const supplierSelect = document.getElementById('po-supplier-select');
                const selectedSupplierOption = supplierSelect.options[supplierSelect.selectedIndex];
                const supplierId = selectedSupplierOption.value;
                const supplierName = selectedSupplierOption.text;
                const paymentMethod = modalForm.querySelector('select[name="paymentMethod"]').value;

                if (!supplierId) throw new Error("Debes seleccionar un proveedor.");

                const items = [];
                let totalCost = 0;
                document.querySelectorAll('#po-items-container .po-item').forEach(itemEl => {
                    const materialId = itemEl.querySelector('select[name="materialId"]').value;
                    const quantity = parseInt(itemEl.querySelector('input[name="quantity"]').value);
                    const unitCost = parseFloat(itemEl.querySelector('input[name="unitCost"]').value.replace(/[$. ]/g, '')) || 0;

                    if (materialId && quantity > 0) {
                        items.push({ materialId, quantity, unitCost });
                        totalCost += quantity * unitCost;
                    }
                });

                if (items.length === 0) {
                    throw new Error("Debes añadir al menos un material a la orden.");
                }

                // Usamos una transacción para obtener el nuevo número y crear la orden de forma segura
                const counterRef = doc(db, "counters", "purchaseOrders");
                const newPoRef = doc(collection(db, "purchaseOrders"));

                await runTransaction(db, async (transaction) => {
                    const counterDoc = await transaction.get(counterRef);
                    if (!counterDoc.exists()) {
                        throw "El documento contador de órdenes de compra no existe. Por favor, créalo.";
                    }

                    const newCount = (counterDoc.data().count || 0) + 1;
                    const poNumber = `PO-${String(newCount).padStart(4, '0')}`; // Formato: PO-0001

                    const poData = {
                        poNumber: poNumber, // <-- EL NUEVO NÚMERO CORTO
                        supplierId: supplierId,
                        supplierName: supplierName,
                        provider: supplierName,
                        paymentMethod: paymentMethod,
                        createdAt: new Date(),
                        createdBy: currentUser.uid,
                        status: 'pendiente',
                        items: items,
                        totalCost: totalCost
                    };

                    // Creamos la nueva orden y actualizamos el contador
                    transaction.set(newPoRef, poData);
                    transaction.update(counterRef, { count: newCount });
                });

                // --- FIN DE LA MODIFICACIÓN ---

                alert("¡Orden de compra creada con éxito!");
                closeMainModal();

            } catch (error) {
                console.error("Fallo al guardar la orden de compra:", error);
                alert("No se pudo guardar la orden de compra: " + error.message);
            } finally {
                modalConfirmBtn.disabled = false;
            }
            break;
        }
        case 'new-supplier-payment': {
            if (currentSupplierId) {
                const paymentData = {
                    amount: parseFloat(data.amount.replace(/[$. ]/g, '')) || 0,
                    paymentMethod: data.paymentMethod,
                    date: data.date,
                    createdAt: new Date()
                };
                await addDoc(collection(db, "suppliers", currentSupplierId, "payments"), paymentData);
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
        case 'request-material': {
            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = 'Procesando...';

            try {
                // Recolectamos los materiales y los ítems de destino desde la interfaz de usuario
                const requestedItems = [];
                document.querySelectorAll('#request-items-list > div').forEach(itemEl => {
                    requestedItems.push({
                        isRemnant: itemEl.dataset.isRemnant === 'true',
                        materialId: itemEl.dataset.materialId,
                        quantity: parseInt(itemEl.dataset.quantity),
                        remnantId: itemEl.dataset.remnantId || null,
                        itemName: itemEl.querySelector('span').textContent
                    });
                });

                const targetItems = [];
                document.querySelectorAll('.request-item-quantity').forEach(input => {
                    const quantity = parseInt(input.value);
                    if (quantity > 0) {
                        targetItems.push({ itemId: input.dataset.itemId, quantity: quantity });
                    }
                });

                const selectedRequesterId = document.getElementById('request-as-user-select')?.value || currentUser.uid;

                if (requestedItems.length === 0 || targetItems.length === 0) {
                    throw new Error("Debes añadir al menos un material y especificar la cantidad para al menos un ítem de destino.");
                }

                // =================== INICIO DE LA CORRECCIÓN ===================

                // 1. Planificamos todos los cambios que haremos en la base de datos ANTES de la transacción.
                const transactionPlan = {
                    batchUpdates: [],
                    remnantUpdates: [],
                    mainStockUpdates: [],
                    totalCost: 0,
                    consumedItems: [],
                    materialNames: []
                };

                for (const item of requestedItems) {
                    const materialRef = doc(db, "materialCatalog", item.materialId);

                    if (item.isRemnant) { // Lógica para retazos
                        const remnantRef = doc(materialRef, "remnantStock", item.remnantId);
                        transactionPlan.remnantUpdates.push({ ref: remnantRef, deduct: item.quantity });
                        transactionPlan.consumedItems.push({ type: 'remnant', ...item });
                        transactionPlan.materialNames.push(item.itemName);
                    } else { // Lógica para unidades completas (FIFO)
                        const batchesQuery = query(collection(materialRef, "stockBatches"), where("quantityRemaining", ">", 0), orderBy("purchaseDate", "asc"));
                        const batchesSnapshot = await getDocs(batchesQuery);

                        const availableStock = batchesSnapshot.docs.reduce((sum, doc) => sum + doc.data().quantityRemaining, 0);
                        if (availableStock < item.quantity) {
                            const materialSnap = await getDoc(materialRef);
                            const materialName = materialSnap.exists() ? materialSnap.data().name : item.materialId;
                            throw new Error(`No hay stock suficiente de ${materialName}. Solicitado: ${item.quantity}, Disponible: ${availableStock}.`);
                        }

                        let remainingToFulfill = item.quantity;
                        for (const batchDoc of batchesSnapshot.docs) {
                            if (remainingToFulfill <= 0) break;
                            const batchData = batchDoc.data();
                            const consume = Math.min(batchData.quantityRemaining, remainingToFulfill);

                            transactionPlan.batchUpdates.push({ ref: batchDoc.ref, deduct: consume });
                            transactionPlan.totalCost += consume * (batchData.unitCost || 0);
                            remainingToFulfill -= consume;
                        }

                        transactionPlan.mainStockUpdates.push({ ref: materialRef, deduct: item.quantity });
                        transactionPlan.consumedItems.push({ type: 'full_unit', ...item });
                        transactionPlan.materialNames.push(item.itemName);
                    }
                }

                // 2. Ejecutamos la transacción atómica con nuestro plan.
                await runTransaction(db, async (transaction) => {
                    // A. Verificamos y actualizamos los lotes de stock
                    for (const update of transactionPlan.batchUpdates) {
                        const batchDoc = await transaction.get(update.ref);
                        if (!batchDoc.exists() || batchDoc.data().quantityRemaining < update.deduct) {
                            throw new Error("El stock cambió mientras se procesaba la solicitud. Por favor, inténtalo de nuevo.");
                        }
                        transaction.update(update.ref, { quantityRemaining: increment(-update.deduct) });
                    }

                    // B. Verificamos y actualizamos los retazos
                    for (const update of transactionPlan.remnantUpdates) {
                        const remnantDoc = await transaction.get(update.ref);
                        if (!remnantDoc.exists() || remnantDoc.data().quantity < update.deduct) {
                            throw new Error("El retazo solicitado ya no está disponible. Por favor, inténtalo de nuevo.");
                        }
                        transaction.update(update.ref, { quantity: increment(-update.deduct) });
                    }

                    // C. Actualizamos el contador general de stock
                    for (const update of transactionPlan.mainStockUpdates) {
                        transaction.update(update.ref, { quantityInStock: increment(-update.deduct) });
                    }

                    // D. Creamos el documento de la solicitud
                    const requestRef = doc(collection(db, "projects", currentProject.id, "materialRequests"));
                    transaction.set(requestRef, {
                        consumedItems: transactionPlan.consumedItems,
                        targetItems,
                        materialName: transactionPlan.materialNames.join(', '),
                        quantity: requestedItems.reduce((sum, item) => sum + item.quantity, 0),
                        requesterId: selectedRequesterId,
                        createdAt: new Date(),
                        status: "solicitado",
                        totalCost: transactionPlan.totalCost,
                    });
                });
                // =================== FIN DE LA CORRECCIÓN ===================

                alert("Solicitud creada con éxito.");
                closeMainModal();

            } catch (error) {
                console.error("Error al crear la solicitud de material:", error);
                alert("Error: " + error.message);
            } finally {
                modalConfirmBtn.disabled = false;
                modalConfirmBtn.textContent = 'Enviar Solicitud';
            }
            break;
        }
        case 'new-supplier': {
            const newSupplierData = {
                name: data.name,
                nit: data.nit || '',
                email: data.email || '',
                address: data.address || '',
                contactName: data.contactName || '',
                contactPhone: data.contactPhone || '',
                bankName: data.bankName || '',
                accountType: data.accountType || 'Ahorros',
                accountNumber: data.accountNumber || '',
                createdAt: new Date()
            };
            await addDoc(collection(db, "suppliers"), newSupplierData);
            break;
        }

        case 'edit-supplier': {
            const supplierRef = doc(db, "suppliers", id);
            await updateDoc(supplierRef, {
                name: data.name,
                nit: data.nit || '',
                email: data.email || '',
                address: data.address || '',
                contactName: data.contactName || '',
                contactPhone: data.contactPhone || '',
                bankName: data.bankName || '',
                accountType: data.accountType || 'Ahorros',
                accountNumber: data.accountNumber || ''
            });
            break;
        }
        case 'addItem': { // Se usan llaves para crear un bloque de alcance
            const itemName = data.name.trim().toLowerCase();
            if (!itemName) {
                alert("El nombre del objeto no puede estar vacío.");
                return; // Detiene la ejecución
            }

            // Realiza una consulta para verificar si ya existe un ítem con ese nombre en el proyecto
            const q = query(collection(db, "items"), where("projectId", "==", currentProject.id), where("name", "==", data.name.trim()));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                alert(`Error: Ya existe un ítem con el nombre "${data.name.trim()}" en este proyecto.`);
                return; // Detiene la ejecución si el nombre ya existe
            }

            await createItem(data);
            // ====================================================================
            //      INICIO: LÓGICA AÑADIDA PARA ACTUALIZAR LA VISTA
            // ====================================================================
            // Después de crear el ítem, volvemos a cargar los detalles del proyecto.
            // La función showProjectDetails se encargará de recalcular todo y
            // actualizar la "Información General" automáticamente.
            const projectDoc = await getDoc(doc(db, "projects", currentProject.id));
            if (projectDoc.exists()) {
                currentProject = { id: projectDoc.id, ...projectDoc.data() }; // Actualizamos la data local del proyecto
                showProjectDetails(currentProject, 'items'); // Recargamos la vista, manteniéndonos en la pestaña de ítems
            }
            // ====================================================================
            //      FIN: LÓGICA AÑADIDA
            // ====================================================================
            break;
        }
        case 'editItem': { // Se usan llaves para crear un bloque de alcance
            const newItemName = data.name.trim();
            if (!newItemName) {
                alert("El nombre del objeto no puede estar vacío.");
                return;
            }

            // Busca otros ítems en el proyecto que tengan el nuevo nombre
            const q = query(collection(db, "items"), where("projectId", "==", currentProject.id), where("name", "==", newItemName));
            const querySnapshot = await getDocs(q);

            let isDuplicate = false;
            querySnapshot.forEach(doc => {
                // Si encuentra un documento con el mismo nombre y un ID DIFERENTE, es un duplicado
                if (doc.id !== id) {
                    isDuplicate = true;
                }
            });

            if (isDuplicate) {
                alert(`Error: Ya existe otro ítem con el nombre "${newItemName}" en este proyecto.`);
                return; // Detiene la ejecución
            }

            await updateItem(id, data);
            // ====================================================================
            //      INICIO: LÓGICA AÑADIDA PARA ACTUALIZAR LA VISTA
            // ====================================================================
            // Misma lógica que al añadir: recargamos los detalles del proyecto.
            const projectDoc = await getDoc(doc(db, "projects", currentProject.id));
            if (projectDoc.exists()) {
                currentProject = { id: projectDoc.id, ...projectDoc.data() };
                showProjectDetails(currentProject, 'items');
            }
            // ====================================================================
            //      FIN: LÓGICA AÑADIDA
            // ====================================================================
            break;
        }
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

/**
 * Abre el modal para registrar avance en lote, mostrando solo los sub-ítems especificados,
 * agrupados por su ítem padre y con grupos plegables.
 * @param {string[]} subItemIdsToShow - Array con los IDs de los sub-ítems a mostrar.
 * @param {string} [originatingTaskId] - (Opcional) El ID de la tarea que originó la apertura del modal.
 */
async function openMultipleProgressModal(subItemIdsToShow, originatingTaskId = null) {
    const modal = document.getElementById('multiple-progress-modal');
    const title = document.getElementById('multiple-progress-modal-title');
    const tableBody = document.getElementById('multiple-progress-table-body');
    const confirmBtn = document.getElementById('multiple-progress-modal-confirm-btn');

    if (!modal || !title || !tableBody || !confirmBtn) {
        console.error("Error: No se encontraron elementos del modal de progreso múltiple.");
        return;
    }

    confirmBtn.dataset.originatingTaskId = originatingTaskId || '';
    title.textContent = `Registrar Avance para ${subItemIdsToShow.length} Unidad(es)`;
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Cargando sub-ítems...</td></tr>';

    const manufacturerSelect = document.getElementById('multiple-sub-item-manufacturer');
    const installerSelect = document.getElementById('multiple-sub-item-installer');
    await populateUserDropdowns(manufacturerSelect, installerSelect, {});
    document.getElementById('multiple-sub-item-date').value = new Date().toISOString().split('T')[0];

    modal.style.display = 'flex';

    try {
        tableBody.innerHTML = '';

        if (subItemIdsToShow.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">No hay sub-ítems pendientes para esta tarea/selección.</td></tr>';
            return;
        }

        // 1. Obtener datos completos de los sub-ítems solicitados
        const subItemPromises = subItemIdsToShow.map(id => getDoc(doc(db, "subItems", id)));
        const subItemDocs = await Promise.all(subItemPromises);

        // --- INICIO CORRECCIÓN (FILTRO 1) ---
        // Filtramos CUALQUIER sub-ítem que no exista, ya esté instalado, O NO TENGA itemId
        const subItemsData = subItemDocs
            .filter(docSnap => docSnap.exists() && docSnap.data().status !== 'Instalado' && docSnap.data().itemId)
            .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        // --- FIN CORRECCIÓN (FILTRO 1) ---

        if (subItemsData.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Todos los sub-ítems solicitados ya están instalados o no se encontraron.</td></tr>';
            return;
        }

        // 2. Obtener los IDs únicos de los ítems padres
        // --- INICIO CORRECCIÓN (FILTRO 2) ---
        // Añadimos .filter(Boolean) para eliminar explícitamente cualquier valor 'undefined' o 'null'
        const parentItemIds = [...new Set(subItemsData.map(si => si.itemId))]
            .filter(id => typeof id === 'string' && id.trim() !== '');
        // --- FIN CORRECCIÓN (FILTRO 2) ---

        // Si después de filtrar no quedan IDs padres (porque todos los sub-ítems tenían itemId undefined)
        if (parentItemIds.length === 0) {
            console.warn("Sub-ítems encontrados pero ninguno tenía un 'itemId' válido.", subItemsData);
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-500">Error: Los sub-ítems no están vinculados a un ítem padre.</td></tr>';
            return;
        }

        // 3. Obtener los datos de los ítems padres (nombres)
        const itemPromises = parentItemIds.map(id => getDoc(doc(db, "items", id))); // Esta línea ya no debería fallar
        const itemDocs = await Promise.all(itemPromises);
        const itemsMap = new Map(itemDocs.map(docSnap => [docSnap.id, docSnap.exists() ? docSnap.data().name : `Ítem Desconocido (${docSnap.id.substring(0, 5)}...)`]));

        // 4. Agrupar los sub-ítems por su itemId
        const groupedSubItems = new Map();
        subItemsData.forEach(subItem => {
            // No necesitamos verificar itemId aquí de nuevo porque ya lo filtramos
            if (!groupedSubItems.has(subItem.itemId)) {
                groupedSubItems.set(subItem.itemId, []);
            }
            groupedSubItems.get(subItem.itemId).push(subItem);
        });

        // 5. Ordenar los sub-ítems dentro de cada grupo por número
        groupedSubItems.forEach((subItemsArray) => {
            subItemsArray.sort((a, b) => (a.number || 0) - (b.number || 0));
        });

        // 6. Construir el HTML de la tabla con agrupaciones
        groupedSubItems.forEach((subItemsArray, itemId) => {
            const itemName = itemsMap.get(itemId);

            const headerRow = document.createElement('tr');
            headerRow.className = 'group-header bg-gray-100 border-b border-t-2 border-gray-300 cursor-pointer hover:bg-gray-200';
            headerRow.dataset.groupId = `group-${itemId}`;
            headerRow.innerHTML = `
                <td colspan="5" class="px-4 py-2 font-bold text-gray-700 flex justify-between items-center">
                    <span>${itemName} (${subItemsArray.length} und.)</span>
                    <svg class="h-4 w-4 transform transition-transform group-arrow" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                </td>
            `;
            tableBody.appendChild(headerRow);

            subItemsArray.forEach(subItem => {
                const row = document.createElement('tr');
                row.className = `subitem-row ${`group-${itemId}`} border-b`;
                row.dataset.id = subItem.id;
                row.innerHTML = `
                    <td class="px-4 py-2 font-bold">${subItem.number}</td>
                    <td class="px-4 py-2"><input type="text" class="location-input mt-1 block w-full px-2 py-1 border rounded-md text-sm" value="${subItem.location || ''}"></td>
                    <td class="px-4 py-2"><input type="number" step="0.01" class="real-width-input mt-1 block w-full px-2 py-1 border rounded-md text-sm" value="${subItem.realWidth || ''}"></td>
                    <td class="px-4 py-2"><input type="number" step="0.01" class="real-height-input mt-1 block w-full px-2 py-1 border rounded-md text-sm" value="${subItem.realHeight || ''}"></td>
                    <td class="px-4 py-2"><input type="file" class="photo-input" accept="image/*" capture="environment" style="display: block; width: 100%;"></td>
                `;
                tableBody.appendChild(row);
            });
        });

    } catch (error) {
        console.error("Error al cargar y agrupar sub-ítems:", error);
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-500">Error al cargar datos. Revisa la consola.</td></tr>';
    }
}

function closeMultipleProgressModal() {
    if (multipleProgressModal) {
        multipleProgressModal.style.display = 'none';
    }

    // --- INICIO DE LA MODIFICACIÓN ---
    // Reseteamos el botón CADA VEZ que el modal se cierra
    const confirmBtn = document.getElementById('multiple-progress-modal-confirm-btn');
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Guardar Cambios';
    }
    // --- FIN DE LA MODIFICACIÓN ---
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

                // --- INICIO DE LA LÓGICA DE REDIMENSIONAMIENTO ---
                const MAX_WIDTH = 1920; // Ancho máximo de la imagen
                let width = img.width;
                let height = img.height;

                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }

                canvas.width = width;
                canvas.height = height;
                // --- FIN DE LA LÓGICA DE REDIMENSIONAMIENTO ---

                // Dibuja la imagen (ya redimensionada) en el canvas
                ctx.drawImage(img, 0, 0, width, height);

                // Configura el estilo de la marca de agua
                const fontSize = Math.max(16, width / 60); // Ajustamos el tamaño de fuente al nuevo ancho
                ctx.font = `bold ${fontSize}px Arial`;
                ctx.fillStyle = 'rgba(255, 0, 0, 0.9)'; // Rojo con ligera transparencia
                ctx.textAlign = 'right';
                ctx.textBaseline = 'bottom';

                // Añade un pequeño margen desde el borde
                const margin = 20;
                ctx.fillText(text, canvas.width - margin, canvas.height - margin);

                // Convierte el canvas de nuevo a un archivo (Blob)
                canvas.toBlob((blob) => {
                    resolve(blob);
                }, 'image/jpeg', 0.85); // Calidad del 85% para un buen balance
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

    if (confirmBtn.disabled) return;

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Guardando...';
    if (feedbackP) {
        feedbackP.textContent = 'Validando y actualizando datos...';
        feedbackP.className = 'text-sm mt-4 text-center text-blue-600';
    }

    let success = false;
    let isTaskNowComplete = false;
    let validationError = null;

    try {
        const originatingTaskId = confirmBtn.dataset.originatingTaskId;

        const commonData = {
            manufacturer: document.getElementById('multiple-sub-item-manufacturer').value,
            installer: document.getElementById('multiple-sub-item-installer').value,
            installDate: document.getElementById('multiple-sub-item-date').value,
        };

        const tableRows = document.querySelectorAll('#multiple-progress-table-body tr.subitem-row');

        // --- INICIO DE LA NUEVA VALIDACIÓN ---
        // 1. Revisamos si el usuario llenó al menos una ubicación
        let locationFilled = false;
        for (const row of tableRows) {
            if (row.querySelector('.location-input').value.trim()) {
                locationFilled = true;
                break; // Si encontramos una, no necesitamos seguir buscando
            }
        }

        // 2. Si llenó una ubicación, validamos Fabricante e Instalador
        if (locationFilled) {
            // Check 2.1: Fabricante (solo si se registró algún avance)
            if (!commonData.manufacturer) {
                validationError = `Debes seleccionar un 'Fabricante (para todos)' si registras avance.`;
            }
            // Check 2.2: Instalador (solo si se registró algún avance)
            else if (!commonData.installer) { // Usamos else if para mostrar un error a la vez
                validationError = `Debes seleccionar un 'Instalador (para todos)' si registras avance.`;
            }
        }
        // --- FIN DE LA NUEVA VALIDACIÓN ---

        // 3. Si hubo error en la validación anterior, detenemos
        if (validationError) {
            alert(validationError);
            if (feedbackP) {
                feedbackP.textContent = 'Revisa los campos obligatorios.';
                feedbackP.className = 'text-sm mt-4 text-center text-red-600';
            }
            throw new Error("Error de validación de usuario (Fabricante/Instalador).");
        }


        const batch = writeBatch(db);
        const photoUploads = [];
        const updatedSubItemIds = [];
        let rowsProcessed = 0;

        // 4. Obtener IDs y datos (sin cambios)
        const subItemIdsInModal = Array.from(tableRows).map(row => row.dataset.id);
        const subItemsMap = new Map();
        if (subItemIdsInModal.length > 0) {
            const MAX_IN_QUERY = 30;
            for (let i = 0; i < subItemIdsInModal.length; i += MAX_IN_QUERY) {
                const chunkIds = subItemIdsInModal.slice(i, i + MAX_IN_QUERY);
                const subItemsChunkQuery = query(collection(db, "subItems"), where("__name__", "in", chunkIds));
                const subItemsChunkSnapshot = await getDocs(subItemsChunkQuery);
                subItemsChunkSnapshot.forEach(doc => subItemsMap.set(doc.id, doc.data()));
            }
        }


        // 5. Iterar y validar (Validaciones de Foto y Estado sin cambios)
        for (const row of tableRows) {
            const subItemId = row.dataset.id;
            const subItemData = subItemsMap.get(subItemId) || {};
            const individualData = {
                location: row.querySelector('.location-input').value.trim(),
                realWidth: parseFloat(row.querySelector('.real-width-input').value) || 0,
                realHeight: parseFloat(row.querySelector('.real-height-input').value) || 0,
            };
            const photoFile = row.querySelector('.photo-input').files[0];

            if (!individualData.location) {
                continue;
            }

            rowsProcessed++;
            updatedSubItemIds.push(subItemId);

            let finalStatus = subItemData.status;
            if (commonData.installer) {
                finalStatus = 'Instalado';
            } else if (commonData.manufacturer) {
                finalStatus = 'Pendiente de Instalación';
            }

            if (finalStatus === 'Instalado') {
                // Check 2.1: Instalador (ya validado arriba, pero doble check por seguridad)
                if (!commonData.installer) {
                    validationError = `Falta seleccionar el 'Instalador (para todos)' para marcar ítems como Instalado.`;
                    break;
                }
                // Check 2.2: Fecha (ya validado arriba, pero doble check por seguridad)
                if (!commonData.installDate) {
                    validationError = `Falta seleccionar la 'Fecha de Instalación (para todos)' para marcar ítems como Instalado.`;
                    break;
                }
                // Check 2.3: Foto (nueva o existente)
                if (!photoFile && !subItemData.photoURL) {
                    validationError = `Falta la foto de evidencia para la Unidad N° ${subItemData.number || subItemId.substring(0, 5)}... (Lugar: ${individualData.location}).`;
                    break;
                }
            }

            const dataToUpdate = { ...commonData, ...individualData, status: finalStatus };
            if (!commonData.manufacturer) delete dataToUpdate.manufacturer;
            if (!commonData.installer) delete dataToUpdate.installer;

            const subItemRef = doc(db, "subItems", subItemId);
            batch.update(subItemRef, dataToUpdate);

            if (photoFile) {
                if (subItemData && subItemData.projectId && subItemData.itemId) {
                    const watermarkText = `Vidrios Exito - ${currentProject?.name || subItemData.projectId} - ${commonData.installDate} - ${individualData.location}`;
                    photoUploads.push({ subItemId, photoFile, watermarkText, itemId: subItemData.itemId, projectId: subItemData.projectId });
                } else {
                    console.warn(`No se pudo obtener projectId o itemId para ${subItemId}, no se subirá foto.`);
                }
            }
        } // Fin del bucle for...of


        // 6. Validaciones Pre-Commit (Sin cambios)
        if (validationError) {
            alert(validationError);
            if (feedbackP) {
                feedbackP.textContent = 'Revisa los campos obligatorios.';
                feedbackP.className = 'text-sm mt-4 text-center text-red-600';
            }
            // Usamos 'throw' para ir directamente al 'finally' y reactivar el botón
            throw new Error("Error de validación de usuario.");
        }

        if (rowsProcessed === 0) {
            alert("No se registró ningún avance. Debes llenar el campo 'Lugar de Instalación' para al menos una unidad.");
            if (feedbackP) {
                feedbackP.textContent = 'Registro cancelado.';
                feedbackP.className = 'text-sm mt-4 text-center text-red-600';
            }
            // Usamos 'throw' para ir directamente al 'finally' y reactivar el botón
            throw new Error("No se procesaron filas.");
        }

        // 7. Guardar en Base de Datos (Sin cambios)
        await batch.commit();
        if (feedbackP) feedbackP.textContent = `Datos guardados para ${rowsProcessed} unidad(es). Procesando fotos...`;

        for (const upload of photoUploads) {
            // ... (código para subir foto con marca de agua) ...
            try {
                const watermarkedBlob = await addWatermark(upload.photoFile, upload.watermarkText);
                const storageRef = ref(storage, `evidence/${upload.projectId}/${upload.itemId}/${upload.subItemId}`);
                const snapshot = await uploadBytes(storageRef, watermarkedBlob);
                const downloadURL = await getDownloadURL(snapshot.ref);
                await updateDoc(doc(db, "subItems", upload.subItemId), { photoURL: downloadURL });
            } catch (photoError) {
                console.error(`Error procesando/subiendo foto para ${upload.subItemId}:`, photoError);
            }
        }

        // 8. Lógica de verificación de tarea (Sin cambios)
        let feedbackMessage = `¡Avance registrado para ${rowsProcessed} unidad(es)!`;
        let feedbackClass = 'text-sm mt-4 text-center text-green-600';

        if (originatingTaskId && commonData.installer) {
            // ... (código para verificar si la tarea se completa) ...
            if (feedbackP) feedbackP.textContent = 'Fotos subidas. Verificando estado de la tarea...';

            const taskDoc = await getDoc(doc(db, "tasks", originatingTaskId));
            if (!taskDoc.exists()) {
                throw new Error("No se pudo encontrar la tarea original para verificarla.");
            }

            const taskData = taskDoc.data();

            if (taskData.specificSubItemIds && taskData.specificSubItemIds.length > 0) {
                // ... (lógica para tareas nuevas) ...
                const allTaskSubItemIds = taskData.specificSubItemIds;
                const checkQuery = query(collection(db, "subItems"), where("__name__", "in", allTaskSubItemIds));
                const subItemsSnapshot = await getDocs(checkQuery);
                let allTaskSubItemsInstalled = true;
                let pendingCountInTask = 0;
                subItemsSnapshot.forEach(doc => {
                    if (doc.data().status !== 'Instalado') {
                        allTaskSubItemsInstalled = false;
                        pendingCountInTask++;
                    }
                });
                if (allTaskSubItemsInstalled && subItemsSnapshot.size === allTaskSubItemIds.length) {
                    // ... (código para completar la tarea) ...
                    const taskRef = doc(db, "tasks", originatingTaskId);
                    await updateDoc(taskRef, { status: 'completada', completedAt: new Date(), completedBy: currentUser.uid });
                    feedbackMessage = '¡Avance registrado y tarea completada!';
                    isTaskNowComplete = true;
                } else {
                    feedbackMessage = `¡Avance registrado para ${rowsProcessed} unidad(es)! Aún quedan ${pendingCountInTask} pendientes en esta tarea.`;
                }
            } else {
                feedbackMessage = `¡Avance registrado para ${rowsProcessed} unidad(es)! (Tarea antigua, no se autocompleta).`;
            }
        }

        if (feedbackP) {
            feedbackP.textContent = feedbackMessage;
            feedbackP.className = feedbackClass;
        }

        // 9. Éxito (Sin cambios)
        success = true;

        if (success) {
            setTimeout(() => {
                closeMultipleProgressModal();
                if (feedbackP) feedbackP.textContent = '';
                if (views.tareas && !views.tareas.classList.contains('hidden')) {
                    const currentActiveTab = document.querySelector('#tareas-view .task-tab-button.active');
                    const currentFilter = currentActiveTab ? currentActiveTab.dataset.statusFilter : 'pendiente';
                    loadAndDisplayTasks(currentFilter);
                }
            }, 2500);
        }

    } catch (error) {
        // --- BLOQUE CATCH (Sin cambios) ---
        console.error("Error al guardar el avance múltiple:", error);
        if (feedbackP && !validationError && error.message !== "No se procesaron filas." && error.message !== "Error de validación de usuario." && error.message !== "Error de validación de usuario (Fabricante/Instalador).") {
            feedbackP.textContent = 'Error al guardar. Revisa la consola.';
            feedbackP.className = 'text-sm mt-4 text-center text-red-600';
        }
    } finally {
        // --- BLOQUE FINALLY (Sin cambios) ---
        if (!success) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Guardar Cambios';
        }
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
        tareas: document.getElementById('tareas-view'), // <-- ASEGÚRATE DE QUE ESTA LÍNEA ESTÉ        
        herramienta: document.getElementById('herramienta-view'),
        dotacion: document.getElementById('dotacion-view'),
        cartera: document.getElementById('cartera-view'),
        solicitud: document.getElementById('solicitud-view'),
        empleados: document.getElementById('empleados-view'),
        proveedores: document.getElementById('proveedores-view'),
        supplierDetails: document.getElementById('supplier-details-view'),
        adminPanel: document.getElementById('admin-panel-view'),
        projectDetails: document.getElementById('project-details-view'),
        subItems: document.getElementById('sub-items-view'),
        corteDetails: document.getElementById('corte-details-view'),
        catalog: document.getElementById('catalog-view'),
        compras: document.getElementById('compras-view'),
        reports: document.getElementById('reports-view'),
        'material-request-view': document.getElementById('material-request-view'),

    };


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

    document.getElementById('recalculate-all-btn').addEventListener('click', async () => {
        openConfirmModal("Esto recalculará las estadísticas de TODOS los proyectos. Puede tardar un momento. ¿Continuar?", async () => {
            loadingOverlay.classList.remove('hidden');
            try {
                const runRecalculation = httpsCallable(functions, 'runFullRecalculation');
                const result = await runRecalculation();
                alert(result.data.message);
            } catch (error) {
                console.error("Error al ejecutar el recálculo:", error);
                alert("Error: " + error.message);
            } finally {
                loadingOverlay.classList.add('hidden');
            }
        });
    });

    // --- Lógica para el filtro de fecha de Órdenes de Compra ---
    const poStartDateInput = document.getElementById('po-start-date-filter');
    const poEndDateInput = document.getElementById('po-end-date-filter');
    const applyPoFilterBtn = document.getElementById('apply-po-filter-btn');

    if (poStartDateInput) {
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        poStartDateInput.value = firstDayOfMonth.toISOString().split('T')[0];
        poEndDateInput.value = lastDayOfMonth.toISOString().split('T')[0];

        // Añadimos los listeners para la validación instantánea
        poStartDateInput.addEventListener('change', validatePoDateRange);
        poEndDateInput.addEventListener('change', validatePoDateRange);

        applyPoFilterBtn.addEventListener('click', () => {
            loadComprasView();
        });

        // Validamos el rango inicial al cargar la página
        validatePoDateRange();
    }

    // --- INICIO: Listener para Plegar/Desplegar Grupos en Modal Múltiple ---
    const multiProgressTableBody = document.getElementById('multiple-progress-table-body');
    if (multiProgressTableBody) {
        multiProgressTableBody.addEventListener('click', (e) => {
            // Busca si se hizo clic en una cabecera de grupo
            const header = e.target.closest('.group-header');
            if (header) {
                const groupId = header.dataset.groupId; // Obtiene el ID del grupo (ej: 'group-itemId123')
                if (!groupId) return; // Salir si no hay ID de grupo

                // Selecciona todas las filas de sub-ítems que pertenecen a este grupo
                const subRows = multiProgressTableBody.querySelectorAll(`.${groupId}`);
                // Selecciona el icono de flecha en la cabecera
                const arrow = header.querySelector('.group-arrow');

                // Alterna la clase 'hidden' en cada fila de sub-ítem
                subRows.forEach(row => {
                    row.classList.toggle('hidden');
                });

                // Alterna la rotación de la flecha (asumiendo que inicialmente no está rotada)
                if (arrow) {
                    arrow.classList.toggle('rotate-180'); // Tailwind class para rotar 180 grados
                }
            }
        });
    }
    // --- FIN: Listener para Plegar/Desplegar ---

    // --- Listener para el botón "Cargar Más" del catálogo ---
    const loadMoreCatalogBtn = document.getElementById('load-more-catalog-btn');
    if (loadMoreCatalogBtn) {
        loadMoreCatalogBtn.addEventListener('click', fetchMoreCatalogItems);
    }

    // --- Listener para el botón "Cargar Más" de los ítems de un proyecto ---
    const loadMoreItemsBtn = document.getElementById('load-more-items-btn');
    if (loadMoreItemsBtn) {
        loadMoreItemsBtn.addEventListener('click', () => {
            if (currentProject) {
                fetchMoreItems(currentProject.id);
            }
        });
    }

    // --- Listener para el buscador del catálogo ---
    const catalogSearchInput = document.getElementById('catalog-search-input');
    if (catalogSearchInput) {
        let searchTimeout;
        catalogSearchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            // Espera 300ms después de que el usuario deja de teclear para buscar
            searchTimeout = setTimeout(() => {
                loadCatalogView();
            }, 300);
        });
    }

    // ====================================================================
    //      INICIO: EVENT LISTENER UNIFICADO (VERSIÓN FINAL Y CORREGIDA)
    // ====================================================================
    document.body.addEventListener('click', async (e) => {
        const target = e.target;

        // --- MANEJO DE CLICS QUE NO SON BOTONES DE ACCIÓN ---
        const inventoryTab = target.closest('.inventory-tab');
        if (inventoryTab) {
            const tabName = inventoryTab.dataset.tab;
            document.querySelectorAll('.inventory-tab-content').forEach(content => content.classList.add('hidden'));
            document.querySelectorAll('.inventory-tab').forEach(tab => tab.classList.remove('active'));
            const contentToShow = document.getElementById(`${tabName}-content`);
            if (contentToShow) contentToShow.classList.remove('hidden');
            inventoryTab.classList.add('active');
            return;
        }

        const tabButton = target.closest('#project-details-tabs .tab-button');
        if (tabButton) {
            switchProjectTab(tabButton.dataset.tab);
            return;
        }

        if (target.dataset.action === 'view-image' && target.tagName === 'IMG') {
            openImageModal(target.getAttribute('src'));
            return;
        }

        const elementWithAction = target.closest('[data-action]');

        const uploadCard = target.closest('.document-upload-card[data-action="upload-doc"]');
        if (uploadCard && !target.closest('button')) {
            uploadCard.querySelector('input[type="file"]')?.click();
            return;
        }

        if (!elementWithAction) return;

        const action = elementWithAction.dataset.action;
        const elementId = elementWithAction.dataset.id || elementWithAction.dataset.corteId || elementWithAction.dataset.poId;
        const projectIdForTask = elementWithAction.dataset.projectId; // Para "Ver Proyecto" desde tarea
        const taskIdForProgress = elementWithAction.dataset.taskId; // Específico para "Registrar Avance"

        console.log(`Action: ${action}, ElementID: ${elementId}, ProjectID(Task): ${projectIdForTask}, TaskID(Progress): ${taskIdForProgress}`);

        // --- LÓGICA POR CONTEXTO ESPECÍFICO ---
        const projectCard = elementWithAction.closest('.project-card');
        if (projectCard) {
            const projectId = projectCard.dataset.id;
            const projectName = projectCard.dataset.name;
            switch (action) {
                case 'view-details':
                    const docSnap = await getDoc(doc(db, "projects", projectId));
                    if (docSnap.exists()) showProjectDetails({ id: docSnap.id, ...docSnap.data() });
                    break;
                case 'archive':
                    openConfirmModal(`¿Archivar el proyecto "${projectName}"?`, () => archiveProject(projectId));
                    break;
                case 'restore':
                    openConfirmModal(`¿Restaurar el proyecto "${projectName}"?`, () => restoreProject(projectId));
                    break;
                case 'delete':
                    openConfirmModal(`¿Eliminar el proyecto "${projectName}"?`, () => deleteProject(projectId));
                    break;
            }
            return;
        }

        const itemRow = elementWithAction.closest('tr[data-id]');
        if (itemRow) {
            const itemId = itemRow.dataset.id;
            const itemDoc = await getDoc(doc(db, "items", itemId));
            if (itemDoc.exists()) {
                const itemData = { id: itemDoc.id, ...itemDoc.data() };
                switch (action) {
                    case 'view-item-details': showSubItems(itemData); break;
                    case 'edit-item': openMainModal('editItem', itemData); break;
                    case 'delete-item': openConfirmModal(`¿Eliminar "${itemData.name}"?`, () => deleteItem(itemId)); break;
                }
            }
            return;
        }

        // --- ACCIONES GENERALES Y DE MODALES (MANEJADAS POR UN SWITCH) ---
        switch (action) {
            // Navegación Global
            case 'logout': handleLogout(); break;
            case 'toggle-menu': document.getElementById('sidebar').classList.toggle('-translate-x-full'); break;

            // Vistas Principales
            case 'new-project': openMainModal('newProject'); break;
            case 'new-task':
                openMainModal('new-task');
                break;

            // Acciones de Documentos
            case 'view-documents': {
                const docType = elementWithAction.dataset.docType;
                if (docType && currentProjectDocs.has(docType)) {
                    const docs = currentProjectDocs.get(docType);
                    openDocumentViewerModal(docType, docs);
                } else {
                    openDocumentViewerModal(docType, []);
                }
                break;
            }
            case 'open-otro-si-modal':
                openOtroSiModal();
                break;

            // Personas de Interés
            case 'add-interest-person':
                openMainModal('addInterestPerson');
                break;
            case 'delete-interest-person':
                openConfirmModal("¿Seguro que quieres eliminar a esta persona?", () => {
                    deleteDoc(doc(db, "projects", currentProject.id, "peopleOfInterest", elementId));
                });
                break;

            // Compras e Inventario
            case 'view-purchase-order':
                openPurchaseOrderModal(elementId);
                break;
            case 'add-catalog-item':
                openMainModal('add-catalog-item');
                break;

            case 'deliver-material': {
                const requestId = elementWithAction.dataset.id;
                openConfirmModal('¿Confirmas la entrega de este material? Esto validará y descontará el stock.', async () => {
                    loadingOverlay.classList.remove('hidden');
                    try {
                        const deliverFunction = httpsCallable(functions, 'deliverMaterial');
                        await deliverFunction({ projectId: currentProject.id, requestId: requestId });
                        alert("¡Material entregado con éxito! El stock ha sido actualizado.");

                    } catch (error) {
                        if (error.message) {
                            alert(`Error: ${error.message}`);
                        } else {
                            alert("Ocurrió un error inesperado al intentar entregar el material.");
                            console.error("Error no controlado al entregar material:", error);
                        }
                    } finally {
                        loadingOverlay.classList.add('hidden');
                    }
                });
                break;
            }

            case 'view-task-details':
                if (elementId) {
                    openTaskDetailsModal(elementId);
                } else {
                    console.error("view-task-details: data-id faltante en el botón.");
                }
                break;

            case 'complete-task':
                if (elementId) {
                    openConfirmModal('¿Marcar esta tarea como completada?', () => completeTask(elementId));
                } else {
                    console.error("No se pudo obtener el ID de la tarea para completarla.");
                }
                break;

            case 'register-task-progress':
                if (taskIdForProgress) {
                    closeTaskDetailsModal();
                    handleRegisterTaskProgress(taskIdForProgress);
                } else {
                    console.error("register-task-progress: data-task-id faltante.");
                }
                break;

            case 'view-project-from-task':
                if (projectIdForTask) {
                    const docSnap = await getDoc(doc(db, "projects", projectIdForTask));
                    if (docSnap.exists()) {
                        showProjectDetails({ id: docSnap.id, ...docSnap.data() });
                    } else {
                        alert("El proyecto asociado a esta tarea ya no existe.");
                    }
                } else {
                    console.error("No se pudo obtener el ID del proyecto desde la tarea.");
                }
                break;

            case 'edit-task': {
                const taskId = elementId;
                if (taskId) {
                    loadingOverlay.classList.remove('hidden');
                    try {
                        // --- INICIO DE LA MODIFICACIÓN ---
                        // Si el botón está dentro del modal de detalles, cerramos ese modal primero
                        if (elementWithAction.closest('#task-details-modal')) {
                            closeTaskDetailsModal();
                        }
                        // --- FIN DE LA MODIFICACIÓN ---

                        const taskDoc = await getDoc(doc(db, "tasks", taskId));
                        if (taskDoc.exists()) {
                            openMainModal('edit-task', { id: taskId, ...taskDoc.data() });
                        } else {
                            alert("La tarea que intentas editar ya no existe.");
                        }
                    } catch (error) {
                        console.error("Error al obtener datos de la tarea para editar:", error);
                        alert("No se pudieron cargar los datos de la tarea.");
                    } finally {
                        loadingOverlay.classList.add('hidden');
                    }
                }
                break;
            }

            case 'request-material-from-task': {
                const projectId = elementWithAction.dataset.projectId;
                const taskId = elementWithAction.dataset.taskId;

                if (projectId && taskId) {
                    if (elementWithAction.closest('#task-details-modal')) {
                        closeTaskDetailsModal();
                    }
                    await handleRequestMaterialFromTask(projectId, taskId);
                } else {
                    console.error("Faltan datos (projectId o taskId) para solicitar material desde la tarea.");
                    alert("No se pudo iniciar la solicitud de material.");
                }
                break;
            }

            // Acciones dentro de la Vista de un Proyecto
            case 'back-to-dashboard': showDashboard(); break;

            // --- INICIO DE LA MODIFICACIÓN ---
            case 'back-to-project':
                // Primero, limpia el formulario
                resetMaterialRequestForm();

                console.log("Botón 'Volver' presionado, regresando a:", materialRequestReturnContext.view);

                // --- INICIO DE LA MODIFICACIÓN ---
                // Si el origen fue 'tareas' O 'detalle-tarea', volvemos a la lista de tareas.
                if (materialRequestReturnContext.view === 'tareas' || materialRequestReturnContext.view === 'detalle-tarea') {
                    showView('tareas');
                    loadAndDisplayTasks('pendiente'); // Recargamos las tareas pendientes
                } else {
                    // Si no, volvemos al proyecto (comportamiento por defecto)
                    showProjectDetails(currentProject, 'materiales');
                }
                // *** Eliminamos el reseteo del contexto de aquí ***
                // --- FIN DE LA MODIFICACIÓN ---
                break;
            // --- FIN DE LA MODIFICACIÓN ---

            case 'edit-project-info': openMainModal('editProjectInfo', currentProject); break;
            // Pestaña Ítems
            case 'add-item': openMainModal('addItem'); break;
            case 'import-items': document.getElementById('import-modal').style.display = 'flex'; break;
            case 'export-pdf': exportProjectToPDF(); break;

            // Pestaña Cortes
            case 'back-to-project-details-cortes': showProjectDetails(currentProject, 'cortes'); break;
            case 'set-corte-type': {
                const type = elementWithAction.dataset.type;
                document.querySelectorAll('.corte-type-btn').forEach(btn => {
                    const isSelected = btn.dataset.type === type;
                    btn.classList.toggle('bg-blue-500', isSelected);
                    btn.classList.toggle('text-white', isSelected);
                    btn.classList.toggle('bg-gray-200', !isSelected);
                    btn.classList.toggle('text-gray-700', !isSelected);
                });
                setupCorteSelection(type);
                break;
            }
            case 'generate-corte': generateCorte(); break;
            case 'cancel-corte-selection': closeCorteSelectionView(); break;
            case 'view-corte-details':
            case 'approve-corte':
            case 'deny-corte':
            case 'export-corte-pdf':
                const corteRef = doc(db, "projects", currentProject.id, "cortes", elementId);
                const corteSnap = await getDoc(corteRef);
                if (corteSnap.exists()) {
                    const corteData = { id: corteSnap.id, ...corteSnap.data() };
                    if (action === 'view-corte-details') showCorteDetails(corteData);
                    if (action === 'approve-corte') openConfirmModal("¿Aprobar este corte?", () => approveCorte(currentProject.id, elementId));
                    if (action === 'deny-corte') openConfirmModal("¿Denegar y eliminar este corte?", () => denyCorte(currentProject.id, elementId));
                    if (action === 'export-corte-pdf') exportCorteToPDF(currentProject, corteData, elementWithAction.dataset.type);
                }
                break;


            case 'view-inventory': {
                const materialId = elementWithAction.dataset.id;
                const materialName = elementWithAction.dataset.name;
                openInventoryDetailsModal(materialId, materialName);
                break;
            }

            case 'close-inventory-details':
                const modal = document.getElementById('inventory-details-modal');
                if (modal) modal.style.display = 'none';
                break;

            // Pestaña Pagos
            case 'add-other-payment': openMainModal('add-other-payment'); break;
            case 'delete-payment':
                openConfirmModal('¿Eliminar este movimiento?', () => deleteDoc(doc(db, "projects", currentProject.id, "payments", elementId)));
                break;
            case 'add-corte-payment':
                openMainModal('add-corte-payment', { corteId: elementId, corteNumber: elementWithAction.dataset.corteNumber });
                break;

            // Pestaña Materiales
            case 'request-material':
                // --- INICIO DE LA MODIFICACIÓN ---
                // Leemos el dataset del botón para ver si hay ítems de tarea pre-guardados
                const taskItemsJson = elementWithAction.dataset.taskItems;
                let taskItems = null;
                if (taskItemsJson) {
                    try {
                        taskItems = JSON.parse(taskItemsJson);
                    } catch (e) { console.error("Error al parsear taskItems desde el botón:", e); }
                }
                // Pasamos los ítems (o null) a la función
                showMaterialRequestView(taskItems);
                // --- FIN DE LA MODIFICACIÓN ---
                break;
            case 'return-material': {
                const requestId = elementWithAction.dataset.id;
                loadingOverlay.classList.remove('hidden');
                try {
                    const requestRef = doc(db, "projects", currentProject.id, "materialRequests", requestId);
                    const requestSnap = await getDoc(requestRef);
                    if (!requestSnap.exists()) throw new Error("La solicitud original no se encontró.");

                    const requestData = requestSnap.data();
                    let itemsInRequest = [];

                    if (Array.isArray(requestData.consumedItems)) {
                        itemsInRequest = requestData.consumedItems.filter(item => item.type === 'full_unit');
                    } else if (Array.isArray(requestData.materials)) {
                        itemsInRequest = requestData.materials;
                    } else if (requestData.materialId && requestData.quantity) {
                        itemsInRequest = [{ materialId: requestData.materialId, quantity: requestData.quantity }];
                    }

                    if (itemsInRequest.length === 0) throw new Error("Esta solicitud no contiene unidades completas que se puedan devolver.");

                    const materialPromises = itemsInRequest.map(m => m.materialId ? getDoc(doc(db, "materialCatalog", m.materialId)) : null).filter(p => p);
                    const materialSnapshots = await Promise.all(materialPromises);
                    const materialsWithDetails = materialSnapshots.map((snap, index) => snap && snap.exists() ? { ...itemsInRequest[index], ...snap.data() } : null).filter(m => m);
                    if (materialsWithDetails.length === 0) throw new Error("No se pudieron encontrar los materiales originales en el catálogo.");

                    openMainModal('return-material', { request: { id: requestId, ...requestData }, materials: materialsWithDetails });
                } catch (error) {
                    alert("Error: " + error.message);
                } finally {
                    loadingOverlay.classList.add('hidden');
                }
                break;
            }

            case 'edit-catalog-item': {
                const materialId = elementWithAction.dataset.id;
                if (materialId) {
                    const materialDocRef = doc(db, "materialCatalog", materialId);
                    const materialDocSnap = await getDoc(materialDocRef);
                    if (materialDocSnap.exists()) {
                        openMainModal('edit-catalog-item', { id: materialDocSnap.id, ...materialDocSnap.data() });
                    }
                }
                break;
            }
            case 'view-request-details': {
                const requestId = elementWithAction.dataset.id;
                openRequestDetailsModal(requestId);
                break;
            }
            case 'approve-request': {
                const requestId = elementWithAction.dataset.id;
                openConfirmModal('¿Aprobar esta solicitud de material?', async () => {
                    const requestRef = doc(db, "projects", currentProject.id, "materialRequests", requestId);
                    await updateDoc(requestRef, {
                        status: 'aprobado',
                        responsibleId: currentUser.uid // Quien aprueba
                    });
                });
                break;
            }
            case 'view-supplier-details': {
                loadSupplierDetailsView(elementWithAction.dataset.id);
                break;
            }
            case 'back-to-suppliers':
                showView('proveedores');
                break;

            case 'reject-request': {
                const requestId = elementWithAction.dataset.id;
                openConfirmModal('¿Rechazar esta solicitud?', async () => {
                    const requestRef = doc(db, "projects", currentProject.id, "materialRequests", requestId);
                    await updateDoc(requestRef, { status: 'rechazado', responsibleId: currentUser.uid });
                });
                break;
            }
            case 'new-supplier-payment':
                openMainModal('new-supplier-payment');
                break;
            case 'receive-purchase-order':
                openConfirmModal('¿Confirmas la recepción? Esto actualizará el stock.', async () => {
                    loadingOverlay.classList.remove('hidden');
                    try {
                        const poRef = doc(db, "purchaseOrders", elementId);

                        await runTransaction(db, async (transaction) => {
                            const poDoc = await transaction.get(poRef);
                            if (!poDoc.exists()) throw new Error("La orden de compra no existe.");

                            const poData = poDoc.data();
                            if (poData.status !== "pendiente") throw new Error("Esta orden ya fue procesada.");
                            if (!Array.isArray(poData.items) || poData.items.length === 0) throw new Error("La orden no contiene materiales.");

                            for (const item of poData.items) {
                                const materialRef = doc(db, "materialCatalog", item.materialId);
                                const batchRef = doc(collection(materialRef, "stockBatches"));

                                transaction.set(batchRef, {
                                    purchaseDate: new Date(),
                                    quantityInitial: item.quantity,
                                    quantityRemaining: item.quantity,
                                    unitCost: item.unitCost || 0,
                                    purchaseOrderId: elementId,
                                });
                                transaction.update(materialRef, { quantityInStock: increment(item.quantity) });
                            }
                            transaction.update(poRef, { status: "recibida", receivedAt: new Date(), receivedBy: currentUser.uid });
                        });
                        alert("¡Mercancía recibida! El stock se ha actualizado.");
                        closePurchaseOrderModal();
                    } catch (error) {
                        console.error("Error al recibir la mercancía:", error);
                        alert("Error: " + error.message);
                    } finally {
                        loadingOverlay.classList.add('hidden');
                    }
                });
                break;
            case 'reject-purchase-order':
                openConfirmModal('¿Seguro que quieres eliminar esta orden?', async () => {
                    await deleteDoc(doc(db, "purchaseOrders", elementId));
                    closePurchaseOrderModal();
                });
                break;
            case 'sync-inventory':
                syncAllInventoryStock();
                break;

            case 'new-supplier':
                openMainModal('new-supplier');
                break;

            case 'edit-supplier': {
                const supplierDoc = await getDoc(doc(db, "suppliers", elementWithAction.dataset.id));
                if (supplierDoc.exists()) {
                    openMainModal('edit-supplier', { id: supplierDoc.id, ...supplierDoc.data() });
                }
                break;
            }

            case 'new-purchase-order': {
                loadingOverlay.classList.remove('hidden');
                try {
                    const [catalogSnapshot, suppliersSnapshot] = await Promise.all([
                        getDocs(query(collection(db, "materialCatalog"))),
                        getDocs(query(collection(db, "suppliers"), orderBy("name")))
                    ]);

                    const catalog = catalogSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    const suppliers = suppliersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                    openMainModal('new-purchase-order', { catalog, suppliers });

                } catch (error) {
                    console.error("Error al preparar la PO:", error);
                    alert("Error al cargar los datos necesarios: " + error.message);
                } finally {
                    loadingOverlay.classList.add('hidden');
                }
                break;
            }
            case 'close-details-modal':
                closeRequestDetailsModal();
                closePurchaseOrderModal();
                break;
        }

        if (target.id === 'request-details-close-btn' || target.id === 'request-details-cancel-btn') {
            closeRequestDetailsModal();
        }
    });

    document.getElementById('task-details-close-btn')?.addEventListener('click', closeTaskDetailsModal);
    document.getElementById('task-details-cancel-btn')?.addEventListener('click', closeTaskDetailsModal);
    // Opcional: cerrar al hacer clic fuera del modal
    document.getElementById('task-details-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'task-details-modal') {
            closeTaskDetailsModal();
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

    document.getElementById('document-viewer-close-btn').addEventListener('click', closeDocumentViewerModal);
    document.getElementById('documents-modal-close-btn').addEventListener('click', closeDocumentsModal);

    document.getElementById('documents-modal-body').addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button || !button.dataset.action) return;
        const action = button.dataset.action;
        if (action === 'view-doc') {
            const url = button.dataset.url;
            if (url) window.open(url, '_blank');
        }
        if (action === 'delete-doc') {
            const projectId = button.dataset.projectId;
            const docId = button.dataset.docId;
            openConfirmModal(`¿Estás seguro de que quieres eliminar este documento?`, () => deleteProjectDocument(projectId, docId));
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
        const fileInput = e.target.closest('.document-upload-card input[type="file"]');
        if (fileInput) {
            const file = fileInput.files[0];
            const docType = fileInput.dataset.docType;
            if (file && currentProject) {
                const card = fileInput.closest('.document-upload-card');
                const statusP = card.querySelector('.doc-status');
                if (statusP) statusP.textContent = 'Subiendo...';
                uploadProjectDocument(currentProject.id, file, docType);
            }
        }
    });

    const documentDisplayModal = document.getElementById('document-display-modal');
    function closeDocumentDisplayModal() {
        const iframe = document.getElementById('document-iframe');
        documentDisplayModal.style.display = 'none';
        iframe.src = 'about:blank';
    }
    document.getElementById('document-display-close-btn').addEventListener('click', closeDocumentDisplayModal);
    documentDisplayModal.addEventListener('click', (e) => {
        if (e.target === documentDisplayModal) {
            closeDocumentDisplayModal();
        }
    });

    document.getElementById('document-viewer-list').addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button || !button.dataset.action) return;
        const action = button.dataset.action;
        if (action === 'view-doc') {
            viewDocument(button.dataset.url, button.dataset.name);
        }
        if (action === 'delete-doc') {
            openConfirmModal(`¿Eliminar "${button.dataset.docName}"?`, () => deleteProjectDocument(currentProject.id, button.dataset.docId));
        }
    });

    document.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'tabs') {
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
                openConfirmModal("¿Eliminar este 'Otro Sí'?", () => deleteOtroSi(button.dataset.id));
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'varios-modal-close-btn') {
            closeVariosModal();
        }
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
                openConfirmModal("¿Eliminar este documento?", () => deleteVarios(button.dataset.id));
            }
        });
    }

    const notificationsBtn = document.getElementById('notifications-btn');
    const notificationsDropdown = document.getElementById('notifications-dropdown');
    const profileBtn = document.getElementById('profile-btn');

    if (notificationsBtn) {
        notificationsBtn.addEventListener('click', () => {
            notificationsDropdown.classList.toggle('hidden');
        });
    }

    if (profileBtn) {
        profileBtn.addEventListener('click', () => {
            if (currentUser && usersMap.has(currentUser.uid)) {
                openMainModal('editProfile', usersMap.get(currentUser.uid));
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (notificationsDropdown && !notificationsBtn.contains(e.target) && !notificationsDropdown.contains(e.target)) {
            notificationsDropdown.classList.add('hidden');
        }
    });

    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const mainNav = document.getElementById('main-nav');

    function initializeDesktopSidebar() {
        if (window.innerWidth >= 768 && sidebar && mainContent) {
            mainContent.classList.add('is-shifted');
            sidebar.classList.add('is-collapsed');
        }
    }

    if (window.innerWidth >= 768 && sidebar) {
        sidebar.addEventListener('mouseenter', () => {
            if (sidebar.classList.contains('is-collapsed')) {
                sidebar.classList.add('is-expanded-hover');
            }
        });
        sidebar.addEventListener('mouseleave', () => {
            sidebar.classList.remove('is-expanded-hover');
        });
    }

    if (mainNav) {
        mainNav.addEventListener('click', (e) => {
            const link = e.target.closest('.nav-link');
            if (link) {
                e.preventDefault();
                const viewName = link.dataset.view;
                if (viewName === 'tareas') { // Si se hizo clic en 'Tareas'
                    showView('tareas');   // Muestra la vista
                    loadTasksView();      // Carga la lógica específica de tareas
                } else if (viewName === 'adminPanel') {
                    showView('adminPanel');
                    loadUsers('active');
                } else if (viewName === 'proveedores') {
                    showView('proveedores');
                    loadProveedoresView();
                } else if (viewName === 'catalog') {
                    showView('catalog');
                    loadCatalogView();
                } else if (viewName === 'compras') {
                    showView('compras');
                    loadComprasView();
                } else if (viewName === 'reports') {
                    showView('reports');
                    loadReportsView();
                } else {
                    showView(viewName);
                }
                if (window.innerWidth < 768) {
                    sidebar.classList.add('-translate-x-full');
                }
            }
        });
    }

    if (menuToggleBtn) {
        menuToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('-translate-x-full');
        });
    }
    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.innerWidth >= 768) {
                mainContent.classList.toggle('is-shifted');
                sidebar.classList.toggle('is-collapsed');
            } else {
                sidebar.classList.add('-translate-x-full');
            }
        });
    }

    if (mainContent) {
        mainContent.addEventListener('click', () => {
            if (window.innerWidth < 768 && sidebar && !sidebar.classList.contains('-translate-x-full')) {
                sidebar.classList.add('-translate-x-full');
            }
        });
    }

    // ====================================================================
    //      INICIO: CORRECCIÓN PARA MENÚ DESPLEGABLE EN VISTA DE PROYECTO
    // ====================================================================
    const projectTabsDropdownBtn = document.getElementById('project-tabs-dropdown-btn');
    const projectTabsDropdownMenu = document.getElementById('project-tabs-dropdown-menu');

    if (projectTabsDropdownBtn && projectTabsDropdownMenu) {
        // 1. Lógica para ABRIR/CERRAR el menú desplegable
        projectTabsDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Evita que otros listeners interfieran
            projectTabsDropdownMenu.classList.toggle('hidden');
        });

        // 2. Lógica para CAMBIAR de pestaña al hacer clic en una opción
        projectTabsDropdownMenu.addEventListener('click', (e) => {
            const link = e.target.closest('a[data-tab]');
            if (link) {
                e.preventDefault();
                const tabName = link.dataset.tab;
                switchProjectTab(tabName); // Reutilizamos la función que ya existe
                projectTabsDropdownMenu.classList.add('hidden'); // Ocultamos el menú
            }
        });

        // 3. Lógica para CERRAR el menú si se hace clic fuera de él
        document.addEventListener('click', (e) => {
            if (!projectTabsDropdownBtn.contains(e.target) && !projectTabsDropdownMenu.contains(e.target)) {
                projectTabsDropdownMenu.classList.add('hidden');
            }
        });
    }
    // ====================================================================
    //      FIN: CORRECCIÓN
    // ====================================================================

    initializeDesktopSidebar();

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

    const addOtherDiscountsCheckboxCorte = document.getElementById('corte-add-other-discounts-checkbox');
    const descuentosSectionCorte = document.getElementById('corte-descuentos-section');
    if (addOtherDiscountsCheckboxCorte && descuentosSectionCorte) {
        addOtherDiscountsCheckboxCorte.addEventListener('change', () => {
            descuentosSectionCorte.classList.toggle('hidden', !addOtherDiscountsCheckboxCorte.checked);
        });
    }

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
            const currencyInput = newDiscountField.querySelector('.currency-input');
            setupCurrencyInput(currencyInput);
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
                updateMultipleProgressButtonState();
            }
        });
        registerMultipleBtn.addEventListener('click', () => {
            const selectedIds = Array.from(document.querySelectorAll('.subitem-checkbox:checked')).map(cb => cb.dataset.id);
            openMultipleProgressModal(selectedIds);
        });
    }

    // --- Lógica para la nueva vista de Solicitud de Material ---
    // --- Lógica para la nueva vista de Solicitud de Material ---
    const materialRequestForm = document.getElementById('material-request-form');
    if (materialRequestForm) {

        materialRequestForm.addEventListener('click', e => {
            const addCutBtn = e.target.closest('#add-cut-btn-view');
            const addMaterialBtn = e.target.closest('#add-material-to-request-btn-view');
            const removeCutBtn = e.target.closest('.remove-cut-btn-view');
            const addCutToRequestBtn = e.target.closest('.add-cut-to-request-btn-view');
            const addRemnantBtn = e.target.closest('.add-remnant-to-request-btn-view');
            const removeItemBtn = e.target.closest('.remove-request-item-btn-view');

            if (addCutBtn) {
                const cutsContainer = document.getElementById('cuts-container-view');
                const cutField = document.createElement('div');
                cutField.className = 'cut-item-view grid grid-cols-3 gap-2 items-center';
                cutField.innerHTML = `
                    <input type="number" step="0.01" class="cut-length-input-view border p-2 rounded-md text-sm" placeholder="Medida (m)">
                    <input type="number" class="cut-quantity-input-view border p-2 rounded-md text-sm" placeholder="Cantidad">
                    <div class="flex items-center gap-2">
                        <button type="button" class="add-cut-to-request-btn-view bg-green-500 text-white text-xs font-bold py-2 px-3 rounded hover:bg-green-600">Añadir</button>
                        <button type="button" class="remove-cut-btn-view text-red-500 hover:text-red-700 text-xs font-semibold">Quitar</button>
                    </div>`;
                cutsContainer.appendChild(cutField);
            }

            if (removeCutBtn) removeCutBtn.closest('.cut-item-view').remove();

            if (removeItemBtn) removeItemBtn.closest('.request-summary-item').remove();

            if (addMaterialBtn) {
                const quantityInput = document.getElementById('new-request-quantity-view');
                const quantity = parseInt(quantityInput.value);

                // --- INICIO DE LA CORRECCIÓN ---
                const selectedMaterial = window.materialChoicesView.getValue(); // Obtiene el objeto completo

                if (!selectedMaterial || !quantity || quantity <= 0) {
                    return;
                }
                // --- FIN DE LA CORRECCIÓN ---

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
                const length = parseFloat(cutItem.querySelector('.cut-length-input-view').value);
                const quantity = parseInt(cutItem.querySelector('.cut-quantity-input-view').value);

                const selectedMaterial = window.materialChoicesView.getValue();
                if (!selectedMaterial || !length || !quantity) {
                    return;
                }

                // --- INICIO DE LA VALIDACIÓN ---
                const defaultLength = selectedMaterial.customProperties.defaultLength || 0;
                if (defaultLength > 0 && length > defaultLength) {
                    alert(`Error: La medida del corte (${length}m) no puede ser mayor que la longitud estándar del material (${defaultLength}m).`);
                    return; // Detiene la ejecución
                }
                // --- FIN DE LA VALIDACIÓN ---

                addMaterialToSummaryList({
                    materialId: selectedMaterial.value,
                    materialName: selectedMaterial.customProperties.name,
                    quantity: quantity,
                    length: length,
                    type: 'cut'
                });
                cutItem.remove();
            }

            if (addRemnantBtn) {
                const remnantChoiceDiv = addRemnantBtn.closest('.remnant-item-choice');
                const quantityInput = remnantChoiceDiv.querySelector('.remnant-quantity-input');
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
                    remnantLength: remnantLength,
                    quantity: quantity,
                    type: 'remnant'
                });

                const availableQtySpan = remnantChoiceDiv.querySelector('.remnant-available-qty');
                const newAvailableQty = maxQuantity - quantity;
                if (newAvailableQty <= 0) {
                    remnantChoiceDiv.remove();
                } else {
                    availableQtySpan.textContent = newAvailableQty;
                    quantityInput.max = newAvailableQty;
                    quantityInput.value = '';
                }
            }
        });

        document.getElementById('material-choices-select-view').addEventListener('change', async () => {
            const divisibleSection = document.getElementById('divisible-section-view');
            const unitsSection = document.getElementById('units-section-view');
            const remnantsContainer = document.getElementById('remnants-container-view');
            const remnantsList = document.getElementById('remnants-list-view');
            [divisibleSection, unitsSection, remnantsContainer].forEach(el => el.classList.add('hidden'));
            remnantsList.innerHTML = '';
            const selectedMaterial = window.materialChoicesView.getValue();
            if (selectedMaterial) {
                unitsSection.classList.remove('hidden');
                if (selectedMaterial.customProperties.isDivisible) {
                    divisibleSection.classList.remove('hidden');
                    const remnantsSnapshot = await getDocs(query(collection(db, "materialCatalog", selectedMaterial.value, "remnantStock"), where("quantity", ">", 0)));
                    if (!remnantsSnapshot.empty) {
                        remnantsContainer.classList.remove('hidden');
                        remnantsSnapshot.forEach(doc => {
                            const remnant = { id: doc.id, ...doc.data() };
                            const remnantText = `${remnant.length} ${remnant.unit || 'm'}`;
                            remnantsList.innerHTML += `<div class="remnant-item-choice flex items-center justify-between text-sm p-2 bg-gray-100 rounded-md"><span><span class="remnant-available-qty">${remnant.quantity}</span> und. de ${remnantText}</span><div class="flex items-center gap-2"><input type="number" class="remnant-quantity-input w-20 border p-1 rounded-md text-sm" placeholder="Cant." min="1" max="${remnant.quantity}"><button type="button" data-remnant-id="${remnant.id}" data-remnant-length="${remnant.length}" data-material-id="${selectedMaterial.value}" data-material-name="${selectedMaterial.customProperties.name}" data-remnant-text="${remnantText}" class="add-remnant-to-request-btn-view bg-green-500 text-white text-xs font-bold py-2 px-3 rounded hover:bg-green-600">Añadir</button></div></div>`;
                        });
                    }
                }
            }
        });

        document.getElementById('request-item-search-view').addEventListener('input', e => {
            const query = e.target.value.toLowerCase();
            document.querySelectorAll('#request-item-list-container-view .request-item-card').forEach(item => {
                const name = item.querySelector('label').textContent.toLowerCase();
                item.style.display = name.includes(query) ? 'block' : 'none';
            });
        });

        materialRequestForm.addEventListener('submit', handleMaterialRequestSubmit);
    }

    // Función auxiliar para añadir ítems al resumen
    function addMaterialToSummaryList(item) {
        const listDiv = document.getElementById('request-items-list-view');
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
                // --- CORRECCIÓN CLAVE: Agrupa por medida, no por ID ---
                existingItemDiv = listDiv.querySelector(`.request-summary-item[data-type="remnant"][data-material-id="${item.materialId}"][data-remnant-length="${item.remnantLength}"]`);
                break;
        }

        if (existingItemDiv) {
            const currentQuantity = parseInt(existingItemDiv.dataset.quantity) || 0;
            newQuantity = currentQuantity + item.quantity;
            existingItemDiv.dataset.quantity = newQuantity;

            switch (item.type) {
                case 'full_unit': text = `${newQuantity} x ${item.materialName}`; break;
                case 'cut': text = `${newQuantity} corte(s) de ${item.length}m - ${item.materialName}`; break;
                case 'remnant': text = `${newQuantity} retazo(s) de ${item.remnantText} - ${item.materialName}`; break;
            }
            existingItemDiv.querySelector('span').textContent = text;
        } else {
            switch (item.type) {
                case 'full_unit': text = `${item.quantity} x ${item.materialName}`; break;
                case 'cut': text = `${item.quantity} corte(s) de ${item.length}m - ${item.materialName}`; break;
                case 'remnant': text = `${item.quantity} retazo(s) de ${item.remnantText} - ${item.materialName}`; break;
            }
            const itemDiv = document.createElement('div');
            itemDiv.className = 'request-summary-item flex justify-between items-center bg-gray-100 p-2 rounded-md text-sm';
            Object.keys(item).forEach(key => itemDiv.dataset[key] = item[key]);
            itemDiv.innerHTML = `<span>${text}</span><button type="button" class="remove-request-item-btn-view text-red-500 font-bold text-lg leading-none">&times;</button>`;
            listDiv.appendChild(itemDiv);
        }
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

/**
 * Carga la pestaña de Materiales.
 * @param {object} project - El objeto del proyecto actual.
 * @param {Array|null} taskItems - (Opcional) Array de ítems de una tarea, si se llama desde una.
 */
async function loadMaterialsTab(project, taskItems = null) { // <-- PARÁMETRO AÑADIDO
    const canRequest = currentUserRole === 'admin' || currentUserRole === 'operario';
    const requestMaterialBtn = document.getElementById('request-material-btn');
    if (requestMaterialBtn) {
        requestMaterialBtn.classList.toggle('hidden', !canRequest);

        // --- INICIO DE LA MODIFICACIÓN ---
        // Almacenamos los ítems de la tarea en el botón para usarlos al hacer clic
        if (taskItems) {
            // Guardamos los ítems como un string JSON en el dataset del botón
            requestMaterialBtn.dataset.taskItems = JSON.stringify(taskItems);
        } else {
            // Limpiamos si no venimos de una tarea
            requestMaterialBtn.dataset.taskItems = "";
        }
        // --- FIN DE LA MODIFICACIÓN ---
    }

    const requestsTableBody = document.getElementById('requests-table-body');
    if (!requestsTableBody) return;

    if (unsubscribeMaterialRequests) unsubscribeMaterialRequests();
    const requestsQuery = query(collection(db, "projects", project.id, "materialRequests"), orderBy("createdAt", "desc"));

    unsubscribeMaterialRequests = onSnapshot(requestsQuery, async (snapshot) => {
        // ... (El resto de la lógica de onSnapshot para cargar la tabla de solicitudes no cambia) ...
        if (snapshot.empty) {
            requestsTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">No hay solicitudes de material.</td></tr>`;
            return;
        }
        const requestsPromises = snapshot.docs.map(async (requestDoc) => {
            const request = { id: requestDoc.id, ...requestDoc.data() };
            const consumedItems = request.consumedItems || [];
            if (consumedItems.length > 0 && consumedItems[0].materialId) {
                const firstItem = consumedItems[0];
                const materialRef = doc(db, "materialCatalog", firstItem.materialId);
                const materialDoc = await getDoc(materialRef);
                const materialName = materialDoc.exists() ? materialDoc.data().name : 'Desconocido';
                request.summary = `${firstItem.quantity} x ${materialName}`;
                if (consumedItems.length > 1) {
                    request.summary += ` (y ${consumedItems.length - 1} más)`;
                }
            } else {
                request.summary = 'N/A';
            }
            return request;
        });
        const requestsWithData = await Promise.all(requestsPromises);
        requestsTableBody.innerHTML = '';
        requestsWithData.forEach(request => {
            const solicitante = usersMap.get(request.requesterId)?.firstName || 'Desconocido';
            const responsable = usersMap.get(request.responsibleId)?.firstName || 'N/A';
            const baseButtonClasses = "text-sm font-semibold py-2 px-4 rounded-lg transition-colors w-32 text-center";
            const viewDetailsBtn = `<button data-action="view-request-details" data-id="${request.id}" class="bg-blue-500 hover:bg-blue-600 text-white ${baseButtonClasses}">Ver Detalles</button>`;
            let statusText, statusColor, actionsHtml = '';
            switch (request.status) {
                case 'pendiente':
                    statusText = 'Pendiente'; statusColor = 'bg-yellow-100 text-yellow-800';
                    if (currentUserRole === 'admin' || currentUserRole === 'bodega') {
                        actionsHtml = `
                            <button data-action="approve-request" data-id="${request.id}" class="bg-green-500 hover:bg-green-600 text-white ${baseButtonClasses}">Aprobar</button>
                            <button data-action="reject-request" data-id="${request.id}" class="bg-red-500 hover:bg-red-600 text-white ${baseButtonClasses}">Rechazar</button>
                        `;
                    }
                    break;
                case 'aprobado':
                    statusText = 'Aprobado'; statusColor = 'bg-blue-100 text-blue-800';
                    if (currentUserRole === 'bodega' || currentUserRole === 'admin') {
                        actionsHtml = `<button data-action="deliver-material" data-id="${request.id}" class="bg-teal-500 hover:bg-teal-600 text-white ${baseButtonClasses}">Entregado</button>`;
                    }
                    break;
                case 'entregado':
                    statusText = 'Entregado'; statusColor = 'bg-green-100 text-green-800';
                    if (currentUserRole === 'admin' || currentUserRole === 'operario') {
                        actionsHtml = `<button data-action="return-material" data-id="${request.id}" class="bg-yellow-500 hover:bg-yellow-600 text-white ${baseButtonClasses}">Devolver</button>`;
                    }
                    break;
                case 'rechazado':
                    statusText = 'Rechazado'; statusColor = 'bg-red-100 text-red-800';
                    break;
                default:
                    statusText = request.status || 'Desconocido'; statusColor = 'bg-gray-100 text-gray-800';
            }
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="px-6 py-4">${request.createdAt.toDate().toLocaleDateString('es-CO')}</td>
                <td class="px-6 py-4">${solicitante}</td>
                <td class="px-6 py-4">${request.summary}</td>
                <td class="px-6 py-4 text-center"><span class="px-2 py-1 text-xs font-semibold rounded-full ${statusColor}">${statusText}</span></td>
                <td class="px-6 py-4">${responsable}</td>
                <td class="px-6 py-4 text-center">
                    <div class="flex justify-center items-center gap-2">
                        ${viewDetailsBtn}
                        ${actionsHtml}
                    </div>
                </td>
            `;
            requestsTableBody.appendChild(row);
        });
    });
}

/**
 * Abre y rellena el modal con los detalles de una solicitud de material.
 * @param {string} requestId - El ID de la solicitud a mostrar.
 */
async function openRequestDetailsModal(requestId) {
    const modal = document.getElementById('request-details-modal');
    const modalBody = document.getElementById('request-details-content');

    if (!modal || !modalBody || !currentProject) return;

    modalBody.innerHTML = '<div class="loader mx-auto my-8"></div>';
    modal.style.display = 'flex';

    try {
        const [requestSnap, itemsSnap] = await Promise.all([
            getDoc(doc(db, "projects", currentProject.id, "materialRequests", requestId)),
            getDocs(query(collection(db, "items"), where("projectId", "==", currentProject.id)))
        ]);

        if (!requestSnap.exists()) {
            modalBody.innerHTML = '<p class="text-red-500 text-center">No se encontró la solicitud.</p>';
            return;
        }

        const projectItemsMap = new Map(itemsSnap.docs.map(doc => [doc.id, doc.data()]));
        const requestData = requestSnap.data();
        const consumedItems = requestData.consumedItems || [];

        const consumedItemsPromises = consumedItems.map(async (item) => {
            const materialDoc = await getDoc(doc(db, "materialCatalog", item.materialId));
            const materialName = materialDoc.exists() ? materialDoc.data().name : 'Desconocido';
            let description = '';

            switch (item.type) {
                case 'full_unit':
                    description = 'Unidad Completa';
                    break;
                case 'cut':
                    description = `Corte de ${item.length}m`;
                    break;
                case 'remnant':
                    description = `Retazo de ${item.length}m`;
                    break;
                default:
                    description = 'N/A';
            }
            return `
                <tr class="border-b last:border-b-0">
                    <td class="py-3 px-4">${materialName}</td>
                    <td class="py-3 px-4 text-gray-600">${description}</td>
                    <td class="py-3 px-4 text-center font-bold text-lg">${item.quantity}</td>
                </tr>
            `;
        });

        const consumedItemsHtml = (await Promise.all(consumedItemsPromises)).join('');

        // ... (El resto del código de la función para generar el HTML permanece igual)
        const requester = usersMap.get(requestData.requesterId);
        const responsible = requestData.responsibleId ? usersMap.get(requestData.responsibleId) : null;
        let statusText, statusColor;
        switch (requestData.status) { /* ... */ }

        const destinationItemsHtml = (requestData.itemsToConsume && requestData.itemsToConsume.length > 0) ? "..." : "...";

        modalBody.innerHTML = `... ${consumedItemsHtml} ... ${destinationItemsHtml} ...`; // El HTML del modal

        // --- El código completo del innerHTML para mayor claridad ---
        const destinationItemsHtmlFinal = (requestData.itemsToConsume && requestData.itemsToConsume.length > 0)
            ? requestData.itemsToConsume.map(item => {
                const projectItem = projectItemsMap.get(item.itemId);
                return `<li class="py-1"><strong>${item.quantityConsumed}</strong> para: <strong>${projectItem ? projectItem.name : 'Ítem Desconocido'}</strong></li>`;
            }).join('')
            : '<p class="text-sm text-gray-500">No se especificaron ítems de destino.</p>';
        let statusTextFinal, statusColorFinal;
        switch (requestData.status) {
            case 'aprobado': statusTextFinal = 'Aprobado'; statusColorFinal = 'bg-blue-100 text-blue-800'; break;
            case 'entregado': statusTextFinal = 'Entregado'; statusColorFinal = 'bg-green-100 text-green-800'; break;
            case 'rechazado': statusTextFinal = 'Rechazado'; statusColorFinal = 'bg-red-100 text-red-800'; break;
            default: statusTextFinal = 'Pendiente'; statusColorFinal = 'bg-yellow-100 text-yellow-800';
        }
        modalBody.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="md:col-span-2 space-y-6">
                    <div class="bg-white p-5 rounded-lg border">
                         <h4 class="flex items-center text-lg font-bold text-gray-800 mb-3">Materiales Solicitados</h4>
                        <div class="overflow-hidden rounded-lg border">
                             <table class="w-full text-sm">
                                <thead class="bg-gray-50 text-left">
                                    <tr>
                                        <th class="py-2 px-4 font-semibold text-gray-600">Material</th>
                                        <th class="py-2 px-4 font-semibold text-gray-600">Descripción</th>
                                        <th class="py-2 px-4 font-semibold text-gray-600 text-center">Cant.</th>
                                    </tr>
                                </thead>
                                <tbody class="bg-white divide-y divide-gray-200">
                                    ${consumedItemsHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="bg-white p-5 rounded-lg border">
                        <h4 class="flex items-center text-lg font-bold text-gray-800 mb-3">Uso Previsto</h4>
                        ${(requestData.itemsToConsume && requestData.itemsToConsume.length > 0) ? `<ul class="text-sm space-y-1 ml-4">${destinationItemsHtmlFinal}</ul>` : destinationItemsHtmlFinal}
                    </div>
                </div>
                <div class="space-y-6">
                    <div class="bg-gray-50 p-4 rounded-lg border">
                        <h4 class="text-base font-bold text-gray-700 mb-2">Detalles</h4>
                        <div class="text-sm space-y-2">
                            <p><strong>Fecha:</strong><br>${requestData.createdAt.toDate().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                            <p><strong>Estado:</strong><br><span class="font-semibold px-2 py-1 text-xs rounded-full ${statusColorFinal}">${statusTextFinal}</span></p>
                        </div>
                    </div>
                    <div class="bg-gray-50 p-4 rounded-lg border">
                        <h4 class="text-base font-bold text-gray-700 mb-2">Responsables</h4>
                        <div class="text-sm space-y-2">
                            <p><strong>Solicita:</strong><br>${requester ? requester.firstName + ' ' + requester.lastName : 'N/A'}</p>
                            <p><strong>Gestiona:</strong><br>${responsible ? responsible.firstName + ' ' + responsible.lastName : 'N/A'}</p>
                        </div>
                    </div>
                </div>
            </div>`;


    } catch (error) {
        console.error("Error al abrir los detalles de la solicitud:", error);
        modalBody.innerHTML = '<p class="text-red-500 text-center">Ocurrió un error al cargar los detalles.</p>';
    }
}

/**
 * Cierra el modal de detalles de la solicitud.
 */
function closeRequestDetailsModal() {
    const modal = document.getElementById('request-details-modal');
    if (modal) {
        modal.style.display = 'none';
    }
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
/**
 * Audita y sincroniza el stock total de todos los materiales en el catálogo.
 * Recalcula el stock total basándose en la suma de los lotes (stockBatches)
 * y actualiza el campo 'quantityInStock' del material.
 */
async function syncAllInventoryStock() {
    console.log("Iniciando auditoría completa de stock (incluyendo devoluciones)...");
    loadingOverlay.classList.remove('hidden');

    try {
        const [catalogSnapshot, receivedPOsSnapshot, requestsSnapshot] = await Promise.all([
            getDocs(collection(db, "materialCatalog")),
            getDocs(query(collection(db, "purchaseOrders"), where("status", "==", "recibida"))),
            getDocs(query(collectionGroup(db, 'materialRequests'))) // Obtenemos TODAS las solicitudes
        ]);

        if (catalogSnapshot.empty) {
            alert("No hay materiales en el catálogo para sincronizar.");
            return;
        }

        const inflows = new Map();
        receivedPOsSnapshot.forEach(poDoc => {
            const items = poDoc.data().items || [];
            items.forEach(item => {
                const currentInflow = inflows.get(item.materialId) || 0;
                inflows.set(item.materialId, currentInflow + item.quantity);
            });
        });

        const outflows = new Map();
        const returns = new Map(); // Mapa para las devoluciones

        requestsSnapshot.forEach(reqDoc => {
            const requestData = reqDoc.data();
            const requestStatus = requestData.status;

            // Contabilizamos las SALIDAS solo de solicitudes aprobadas o entregadas
            if (requestStatus === 'aprobado' || requestStatus === 'entregado') {
                const itemsToProcess = requestData.consumedItems || requestData.materials || [];
                itemsToProcess.forEach(item => {
                    const quantity = item.quantityConsumed || item.quantity;
                    if (item.materialId && quantity) {
                        const currentOutflow = outflows.get(item.materialId) || 0;
                        outflows.set(item.materialId, currentOutflow + quantity);
                    }
                });
            }

            // --- INICIO DE LA CORRECCIÓN CLAVE ---
            // Contabilizamos las DEVOLUCIONES
            const returnedItems = requestData.returnedItems || [];
            if (Array.isArray(returnedItems)) {
                returnedItems.forEach(item => {
                    if (item.materialId && item.quantity) {
                        const currentReturn = returns.get(item.materialId) || 0;
                        returns.set(item.materialId, currentReturn + item.quantity);
                    }
                });
            }
            // --- FIN DE LA CORRECCIÓN CLAVE ---
        });

        const batch = writeBatch(db);
        let materialsUpdated = 0;

        for (const materialDoc of catalogSnapshot.docs) {
            const materialId = materialDoc.id;
            const materialData = materialDoc.data();

            const totalIn = inflows.get(materialId) || 0;
            const totalOut = outflows.get(materialId) || 0;
            const totalReturned = returns.get(materialId) || 0;

            // La fórmula correcta: Entradas + Devoluciones - Salidas
            const realStock = totalIn + totalReturned - totalOut;

            console.log(`- Auditando "${materialData.name}": Entradas=${totalIn}, Salidas=${totalOut}, Devoluciones=${totalReturned}, Stock Real=${realStock}`);

            if (realStock !== (materialData.quantityInStock || 0)) {
                console.warn(`  -> ¡Desfase encontrado! Stock guardado=${materialData.quantityInStock}, debe ser ${realStock}. Corrigiendo...`);
                const materialRef = doc(db, "materialCatalog", materialId);
                batch.update(materialRef, { quantityInStock: realStock });
                materialsUpdated++;
            }
        }

        if (materialsUpdated > 0) {
            await batch.commit();
            alert(`¡Sincronización completada! Se corrigió el stock de ${materialsUpdated} materiales.`);
        } else {
            alert("Auditoría finalizada. ¡Todo el inventario ya estaba sincronizado!");
        }

    } catch (error) {
        console.error("Error durante la auditoría de stock:", error);
        alert("Ocurrió un error al sincronizar: " + error.message);
    } finally {
        loadCatalogView();
        loadingOverlay.classList.add('hidden');
    }
}

function setupCutManagement(choicesInstance) {
    const modalBody = document.getElementById('modal-body'); // Ajustado para el modal
    const requestList = document.getElementById('request-items-list');

    modalBody.addEventListener('click', e => {
        const addCutBtn = e.target.closest('#add-cut-btn');
        const removeCutBtn = e.target.closest('.remove-cut-btn');
        const addCutToRequestBtn = e.target.closest('.add-cut-to-request-btn');
        const addRemnantBtn = e.target.closest('.add-remnant-to-request-btn');

        if (addCutBtn) {
            const cutsContainer = document.getElementById('cuts-container');
            const cutField = document.createElement('div');
            cutField.className = 'cut-item grid grid-cols-3 gap-2 items-center';
            cutField.innerHTML = `
                <input type="number" step="0.01" class="cut-length-input border p-2 rounded-md text-sm" placeholder="Medida (m)">
                <input type="number" class="cut-quantity-input border p-2 rounded-md text-sm" placeholder="Cantidad">
                <div class="flex items-center gap-2">
                    <button type="button" class="add-cut-to-request-btn bg-green-500 text-white text-xs font-bold py-2 px-3 rounded hover:bg-green-600">Añadir</button>
                    <button type="button" class="remove-cut-btn text-red-500 hover:text-red-700 text-xs font-semibold">Quitar</button>
                </div>
            `;
            cutsContainer.appendChild(cutField);
        }

        if (removeCutBtn) {
            removeCutBtn.closest('.cut-item').remove();
        }

        if (addCutToRequestBtn) {
            const cutItem = addCutToRequestBtn.closest('.cut-item');
            const length = parseFloat(cutItem.querySelector('.cut-length-input').value);
            const quantity = parseInt(cutItem.querySelector('.cut-quantity-input').value);
            const selectedMaterial = choicesInstance.getValue();
            if (!selectedMaterial || !length || !quantity) return;

            addMaterialToSummaryList({
                materialId: selectedMaterial.value,
                materialName: selectedMaterial.customProperties.name,
                quantity: quantity,
                length: length,
                type: 'cut'
            });
            cutItem.remove();
        }

        // --- INICIO DE LA CORRECCIÓN ---
        if (addRemnantBtn) {
            const remnantChoiceDiv = addRemnantBtn.closest('.remnant-item-choice');
            const quantityInput = remnantChoiceDiv.querySelector('.remnant-quantity-input');
            const quantity = parseInt(quantityInput.value);
            const maxQuantity = parseInt(quantityInput.max);

            if (!quantity || quantity <= 0 || quantity > maxQuantity) {
                alert(`Por favor, introduce una cantidad válida (entre 1 y ${maxQuantity}).`);
                return;
            }

            const { remnantId, materialId, materialName, remnantText } = addRemnantBtn.dataset;
            addMaterialToSummaryList({
                materialId: materialId,
                materialName: materialName,
                remnantId: remnantId,
                remnantText: remnantText,
                quantity: quantity,
                type: 'remnant'
            });

            // Actualiza la interfaz para reflejar el stock restante
            const availableQtySpan = remnantChoiceDiv.querySelector('.remnant-available-qty');
            const newAvailableQty = maxQuantity - quantity;
            if (newAvailableQty <= 0) {
                remnantChoiceDiv.remove(); // Elimina el retazo si se agota
            } else {
                availableQtySpan.textContent = newAvailableQty;
                quantityInput.max = newAvailableQty;
                quantityInput.value = '';
            }
        }
        // --- FIN DE LA CORRECCIÓN ---
    });
}

function setupMaterialChoices(choicesInstance) {
    const divisibleSection = document.getElementById('divisible-section');
    const unitsSection = document.getElementById('units-section');
    const remnantsContainer = document.getElementById('remnants-container');
    const remnantsList = document.getElementById('remnants-list');

    choicesInstance.passedElement.element.addEventListener('change', async () => {
        const selectedMaterial = choicesInstance.getValue();

        [divisibleSection, unitsSection, remnantsContainer].forEach(el => el.classList.add('hidden'));
        document.getElementById('cuts-container').innerHTML = '';
        document.getElementById('new-request-quantity').value = '';
        remnantsList.innerHTML = '';

        if (selectedMaterial) {
            const materialId = selectedMaterial.value;
            const isDivisible = selectedMaterial.customProperties.isDivisible;

            unitsSection.classList.remove('hidden');

            if (isDivisible) {
                divisibleSection.classList.remove('hidden');

                const remnantsSnapshot = await getDocs(query(collection(db, "materialCatalog", materialId, "remnantStock"), where("quantity", ">", 0)));
                if (!remnantsSnapshot.empty) {
                    remnantsContainer.classList.remove('hidden');
                    remnantsSnapshot.forEach(doc => {
                        const remnant = { id: doc.id, ...doc.data() };
                        const remnantText = `${remnant.length} ${remnant.unit || 'm'}`;

                        remnantsList.innerHTML += `
                            <div class="remnant-item-choice flex items-center justify-between text-sm p-2 bg-gray-100 rounded-md">
                                <span><span class="remnant-available-qty">${remnant.quantity}</span> und. de ${remnantText}</span>
                                <div class="flex items-center gap-2">
                                    <input type="number" class="remnant-quantity-input w-20 border p-1 rounded-md text-sm" placeholder="Cant." min="1" max="${remnant.quantity}">
                                    <button type="button" 
                                            data-remnant-id="${remnant.id}" 
                                            data-remnant-length="${remnant.length}"
                                            data-material-id="${materialId}" 
                                            data-material-name="${selectedMaterial.customProperties.name}" 
                                            data-remnant-text="${remnantText}" 
                                            class="add-remnant-to-request-btn bg-green-500 text-white text-xs font-bold py-2 px-3 rounded hover:bg-green-600">
                                        Añadir
                                    </button>
                                </div>
                            </div>`;
                    });
                }
            }
        }
    });
}

function setupAddMaterialButton(choicesInstance) {
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

function setupRequestItemSearch() {
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

/**
 * Muestra la vista de solicitud de material, filtrando opcionalmente los ítems de destino.
 * @param {Array|null} taskItems - (Opcional) Array de ítems de la tarea { itemId, quantity }
 */
/**
 * Muestra la vista de solicitud de material de forma optimizada, cargando datos dinámicos asíncronamente.
 * @param {Array|null} taskItems - (Opcional) Array de ítems de la tarea { itemId, quantity }
 */
async function showMaterialRequestView(taskItems = null) {
    showView('material-request-view');
    document.getElementById('material-request-project-name').textContent = currentProject.name;

    // Limpiar el ID de la tarea por defecto
    const taskIdInput = document.getElementById('material-request-task-id');
    if (taskIdInput) taskIdInput.value = '';

    const itemListContainer = document.getElementById('request-item-list-container-view');
    const userSelectorContainer = document.getElementById('request-user-selector-container-view');

    // --- INICIO DE LA OPTIMIZACIÓN ---
    // 1. Renderizar la estructura base INMEDIATAMENTE
    itemListContainer.innerHTML = '<p class="text-gray-400 italic text-center py-4">Cargando ítems del proyecto...</p>';
    userSelectorContainer.innerHTML = ''; // Limpiar por si acaso

    // Renderizar selector de materiales con estado de carga
    const selectContainer = document.querySelector('#material-choices-select-view').parentNode;
    selectContainer.innerHTML = '<select id="material-choices-select-view" disabled><option>Cargando materiales...</option></select>';
    // Deshabilitamos secciones dependientes mientras carga
    document.getElementById('units-section-view').classList.add('hidden');
    document.getElementById('divisible-section-view').classList.add('hidden');
    document.getElementById('remnants-container-view').classList.add('hidden');
    document.getElementById('cuts-container-view').innerHTML = '';
    document.getElementById('remnants-list-view').innerHTML = '';
    document.getElementById('request-items-list-view').innerHTML = '<p class="text-sm text-gray-400 text-center">Añade materiales para verlos aquí.</p>';

    // Función asíncrona para cargar el catálogo y configurar Choices.js
    const loadCatalogAndSetupChoices = async () => {
        try {
            const inventorySnapshot = await getDocs(query(collection(db, "materialCatalog"), orderBy("name"))); // Ordenar aquí puede ayudar
            const inventory = inventorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const materialOptions = inventory.map(mat => ({
                value: mat.id,
                label: `${mat.name} (Stock: ${mat.quantityInStock || 0})`,
                customProperties: { isDivisible: mat.isDivisible, name: mat.name, defaultLength: mat.defaultSize?.length || 0 }
            }));

            // Recrear el select y Choices.js con los datos cargados
            selectContainer.innerHTML = '<select id="material-choices-select-view"></select>'; // Recrear el select vacío
            if (window.materialChoicesView) {
                window.materialChoicesView.destroy(); // Destruir instancia anterior si existe
            }
            window.materialChoicesView = new Choices('#material-choices-select-view', {
                choices: materialOptions,
                searchEnabled: true, itemSelectText: 'Seleccionar', placeholder: true, placeholderValue: 'Escribe para buscar...',
                allowHTML: false // Importante por seguridad y rendimiento
            });

            // Re-añadir el listener de 'change' al nuevo elemento select
            document.getElementById('material-choices-select-view').addEventListener('change', async () => { /* ... (código existente del listener 'change') ... */
                const divisibleSection = document.getElementById('divisible-section-view');
                const unitsSection = document.getElementById('units-section-view');
                const remnantsContainer = document.getElementById('remnants-container-view');
                const remnantsList = document.getElementById('remnants-list-view');
                [divisibleSection, unitsSection, remnantsContainer].forEach(el => el.classList.add('hidden'));
                document.getElementById('cuts-container-view').innerHTML = ''; // Limpiar cortes
                document.getElementById('new-request-quantity-view').value = ''; // Limpiar cantidad
                remnantsList.innerHTML = ''; // Limpiar retazos
                const selectedMaterial = window.materialChoicesView.getValue();
                if (selectedMaterial) {
                    unitsSection.classList.remove('hidden');
                    if (selectedMaterial.customProperties.isDivisible) {
                        divisibleSection.classList.remove('hidden');
                        // La carga de retazos se mantiene aquí, ya que depende de la selección
                        const remnantsSnapshot = await getDocs(query(collection(db, "materialCatalog", selectedMaterial.value, "remnantStock"), where("quantity", ">", 0)));
                        if (!remnantsSnapshot.empty) {
                            remnantsContainer.classList.remove('hidden');
                            remnantsSnapshot.forEach(doc => {
                                const remnant = { id: doc.id, ...doc.data() };
                                const remnantText = `${remnant.length} ${remnant.unit || 'm'}`;
                                remnantsList.innerHTML += `<div class="remnant-item-choice flex items-center justify-between text-sm p-2 bg-gray-100 rounded-md"><span><span class="remnant-available-qty">${remnant.quantity}</span> und. de ${remnantText}</span><div class="flex items-center gap-2"><input type="number" class="remnant-quantity-input w-20 border p-1 rounded-md text-sm" placeholder="Cant." min="1" max="${remnant.quantity}"><button type="button" data-remnant-id="${remnant.id}" data-remnant-length="${remnant.length}" data-material-id="${selectedMaterial.value}" data-material-name="${selectedMaterial.customProperties.name}" data-remnant-text="${remnantText}" class="add-remnant-to-request-btn-view bg-green-500 text-white text-xs font-bold py-2 px-3 rounded hover:bg-green-600">Añadir</button></div></div>`;
                            });
                        }
                    }
                }
            });

        } catch (error) {
            console.error("Error al cargar el catálogo de materiales:", error);
            selectContainer.innerHTML = '<select id="material-choices-select-view" disabled><option>Error al cargar</option></select>';
        }
    };

    // Función asíncrona para cargar los ítems del proyecto/tarea
    const loadProjectOrTaskItems = async () => {
        try {
            let items = [];
            if (taskItems && taskItems.length > 0) {
                // Cargar solo ítems de la tarea
                const itemIds = taskItems.map(item => item.itemId);
                if (itemIds.length > 0) {
                    const itemsQuery = query(collection(db, "items"), where("__name__", "in", itemIds));
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
                const itemsSnapshot = await getDocs(query(collection(db, "items"), where("projectId", "==", currentProject.id), orderBy("name"))); // Ordenar aquí
                items = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            }

            // Renderizar la lista de ítems
            if (items.length === 0) {
                itemListContainer.innerHTML = '<p class="text-gray-500 italic text-center py-4">No hay ítems disponibles.</p>';
            } else {
                itemListContainer.innerHTML = items.filter(item => item && item.id && item.name).map(item => `
                    <div class="request-item-card p-2 border rounded-md bg-gray-50">
                        <label class="block text-sm font-semibold">${item.name} <span class="text-xs font-normal text-gray-500">(${item.quantity} Unidades)</span></label>
                        <div class="flex items-center mt-1">
                            <span class="text-sm mr-2">Cantidad:</span>
                            <input type="number" data-item-id="${item.id}" class="request-item-quantity w-24 border p-1 rounded-md text-sm" placeholder="0" min="0" max="${item.quantity}">
                        </div>
                    </div>`).join('');
            }

        } catch (error) {
            console.error("Error al cargar ítems del proyecto/tarea:", error);
            itemListContainer.innerHTML = '<p class="text-red-500 text-center py-4">Error al cargar ítems.</p>';
        }
    };

    // Función asíncrona para cargar el selector de usuario (si aplica)
    const loadUserSelector = () => {
        if (currentUserRole === 'admin' || currentUserRole === 'bodega') {
            const userOptions = Array.from(usersMap.entries())
                .filter(([uid, user]) => user.status === 'active')
                .map(([uid, user]) => `<option value="${uid}" ${uid === currentUser.uid ? 'selected' : ''}>${user.firstName} ${user.lastName}</option>`)
                .join('');
            userSelectorContainer.innerHTML = `<h4 class="text-xl font-semibold text-gray-800 mb-4 border-b pb-2">4. ¿Quién solicita?</h4><select id="request-as-user-select-view" class="w-full border p-2 rounded-md bg-white text-sm">${userOptions}</select>`;
        } else {
            userSelectorContainer.innerHTML = '';
        }
    };

    // 2. Ejecutar las cargas de datos en paralelo (o secuencial si prefieres)
    // Usamos Promise.all para que se ejecuten concurrentemente
    Promise.all([
        loadCatalogAndSetupChoices(),
        loadProjectOrTaskItems(),
        loadUserSelector() // Esta es rápida, no necesita ser asíncrona realmente
    ]);
    // --- FIN DE LA OPTIMIZACIÓN ---

    // El resto de los listeners (para añadir cortes, etc.) no necesitan esperar
    // y pueden permanecer fuera de las funciones asíncronas de carga.
    // Asegúrate de que los listeners que dependen de Choices.js
    // se inicialicen DESPUÉS de que loadCatalogAndSetupChoices haya terminado
    // o manejen el caso en que window.materialChoicesView aún no exista.
    // (Ya están dentro de loadCatalogAndSetupChoices, lo cual es correcto).

}

async function handleMaterialRequestSubmit(e) {
    e.preventDefault();

    const summaryList = document.getElementById('request-items-list-view');
    const consumedItemsNodes = summaryList.querySelectorAll('.request-summary-item');
    const itemUsageNodes = document.querySelectorAll('#request-item-list-container-view .request-item-quantity');
    const userSelector = document.getElementById('request-as-user-select-view');
    const taskId = document.getElementById('material-request-task-id').value;

    if (consumedItemsNodes.length === 0) {
        alert("Debes añadir al menos un material a la solicitud.");
        return;
    }
    loadingOverlay.classList.remove('hidden');

    try {
        const consumedItems = Array.from(consumedItemsNodes).map(node => {
            const data = {
                materialId: node.dataset.materialId,
                type: node.dataset.type,
                quantity: parseInt(node.dataset.quantity),
                itemName: node.querySelector('span') ? node.querySelector('span').textContent.split('x ').pop().split(' de ')[0] : 'Material'
            };
            if (node.dataset.type === 'cut') {
                data.length = parseFloat(node.dataset.length);
            } else if (node.dataset.type === 'remnant') {
                data.length = parseFloat(node.dataset.remnantLength);
            }
            return data;
        });

        const itemsToConsume = Array.from(itemUsageNodes)
            .filter(input => parseInt(input.value) > 0)
            .map(input => ({
                itemId: input.dataset.itemId,
                quantityConsumed: parseInt(input.value)
            }));

        const requesterId = (userSelector && userSelector.value) ? userSelector.value : currentUser.uid;
        const requestCollection = collection(db, "projects", currentProject.id, "materialRequests");

        const requestData = {
            projectId: currentProject.id,
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

        // --- INICIO DE LA MODIFICACIÓN (Lógica de Retorno) ---
        console.log("Volviendo al contexto:", materialRequestReturnContext.view);

        // Si el origen fue 'tareas' O 'detalle-tarea', volvemos a la lista de tareas.
        if (materialRequestReturnContext.view === 'tareas' || materialRequestReturnContext.view === 'detalle-tarea') {
            showView('tareas');
            loadAndDisplayTasks('pendiente'); // Recargamos las tareas pendientes
        } else {
            // Si no, volvemos al proyecto (comportamiento por defecto)
            showProjectDetails(currentProject, 'materiales');
        }
        // --- FIN DE LA MODIFICACIÓN ---

    } catch (error) {
        console.error("Error al enviar la solicitud de material:", error);
        alert("Ocurrió un error al enviar la solicitud.");
    } finally {
        // Ocultamos el overlay solo si NO volvemos al detalle de la tarea
        // (porque openTaskDetailsModal lo maneja)
        if (materialRequestReturnContext.view !== 'detalle-tarea') {
            loadingOverlay.classList.add('hidden');
        }
        // Limpiamos el contexto por si acaso para la próxima vez
        materialRequestReturnContext = { view: 'proyectos' };
    }
}


async function processMaterialRequest(projectId, requestId) {
    try {
        const approveFunction = httpsCallable(functions, 'approveMaterialRequest');
        await approveFunction({ projectId, requestId });
    } catch (error) {
        // El error ya se muestra en el 'catch' del botón, así que solo lo re-lanzamos
        throw error;
    }
}

/**
 * Limpia y resetea todos los campos del formulario de solicitud de material.
 */
function resetMaterialRequestForm() {
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

// --- LÓGICA DE TAREAS ASIGNADAS ---

/**
 * Prepara la vista de Tareas Asignadas, configura los filtros y carga las tareas iniciales.
 */
function loadTasksView() {
    const newTaskBtn = document.getElementById('new-task-btn');
    if (newTaskBtn) {
        const canCreateTasks = currentUserRole === 'admin';
        newTaskBtn.classList.toggle('hidden', !canCreateTasks);
    }

    const tabsContainer = document.querySelector('#tareas-view .mb-4.border-b nav');

    if (!tabsContainer) {
        console.error('ERROR CRÍTICO: No se encontró el contenedor de pestañas (nav).');
        return;
    }

    // Asegurarse de que el listener se añada solo una vez
    if (!tabsContainer.dataset.listenerAttached) {
        tabsContainer.addEventListener('click', (e) => {
            const clickedButton = e.target.closest('.task-tab-button');
            if (!clickedButton) return;

            const statusFilter = clickedButton.dataset.statusFilter;
            const isActive = clickedButton.classList.contains('active');

            if (!isActive) {
                // 1. Actualizar visualmente las pestañas
                tabsContainer.querySelectorAll('.task-tab-button').forEach(btn => btn.classList.remove('active'));
                clickedButton.classList.add('active');
                // 2. Llamar a la función para cargar las tareas
                loadAndDisplayTasks(statusFilter);
            }
        });
        tabsContainer.dataset.listenerAttached = 'true';
    }

    // Carga inicial
    const currentActiveTab = tabsContainer.querySelector('.task-tab-button.active');
    const initialFilter = currentActiveTab ? currentActiveTab.dataset.statusFilter : 'pendiente';

    if (!currentActiveTab) {
        tabsContainer.querySelector('#pending-tasks-tab')?.classList.add('active');
    }

    loadAndDisplayTasks(initialFilter);
}


/**
 * Carga las tareas desde Firestore filtradas por estado (para asignado principal O adicional)
 * y las muestra en la interfaz usando listeners en tiempo real.
 * @param {string} statusFilter - El estado por el cual filtrar ('pendiente' o 'completada').
 */
function loadAndDisplayTasks(statusFilter = 'pendiente') {
    // Establecer contexto (sin cambios)
    materialRequestReturnContext = { view: 'tareas' };
    console.log("Contexto de retorno establecido en: tareas"); // Log para depuración

    const tasksContainer = document.getElementById('tasks-container');
    let loadingDiv = document.getElementById('loading-tasks');

    // --- Manejo del Loader ---
    if (tasksContainer && !loadingDiv) {
        // console.warn("[Tareas] El div 'loading-tasks' no se encontró. Recreándolo.");
        loadingDiv = document.createElement('div');
        loadingDiv.id = 'loading-tasks';
        loadingDiv.className = 'text-center py-10';
        loadingDiv.innerHTML = '<p class="text-gray-500">Cargando tareas...</p>';
        tasksContainer.appendChild(loadingDiv);
    }
    if (!tasksContainer || !loadingDiv || !currentUser) {
        // console.error(`[Tareas] Error al iniciar loadAndDisplayTasks('${statusFilter}'): Faltan elementos esenciales.`);
        return;
    }
    // No ocultamos el loader aquí, lo hacemos en renderCombinedTasks la primera vez

    // Limpiamos los listeners de materiales de las tarjetas anteriores
    materialStatusListeners.forEach(unsubscribe => unsubscribe());
    materialStatusListeners.clear();

    // --- Cancelar Listener de Tareas Anterior ---
    if (unsubscribeTasks) {
        try { unsubscribeTasks(); } catch (e) { console.warn(`[Tareas] Advertencia al cancelar listener: ${e.message}`); } finally { unsubscribeTasks = null; }
    }

    // --- Lógica de Doble Consulta con onSnapshot ---
    let principalTasks = new Map();
    let additionalTasks = new Map();
    let combinedTasksRendered = false; // Bandera para ocultar el loader una sola vez

    // Función para combinar, ordenar y renderizar
    const renderCombinedTasks = (principalMap, additionalMap) => {
        // Ocultar loader la primera vez que se renderiza
        if (!combinedTasksRendered) {
            const currentLoadingDiv = document.getElementById('loading-tasks');
            if (currentLoadingDiv) currentLoadingDiv.classList.add('hidden');
            combinedTasksRendered = true;
        }

        const combinedMap = new Map([...principalMap, ...additionalMap]); // Combina y deduplica

        const currentTasksContainer = document.getElementById('tasks-container');
        if (!currentTasksContainer) {
            console.error("[Tareas] Contenedor de tareas no encontrado durante el renderizado.");
            return; // Salir si el contenedor no existe
        }

        // --- Renderizado Inteligente (Actualizar/Añadir/Quitar) ---
        // 1. Marcar todas las tarjetas existentes como "por revisar"
        const existingCardElements = currentTasksContainer.querySelectorAll('.task-card');
        existingCardElements.forEach(card => card.dataset.markedForRemoval = 'true');
        // Eliminar mensaje de "no hay tareas" si existe
        currentTasksContainer.querySelector('.no-tasks-message')?.remove();

        if (combinedMap.size === 0) {
            // Si no hay tareas, mostrar mensaje y limpiar tarjetas viejas
            existingCardElements.forEach(card => card.remove()); // Eliminar las marcadas
            const noTasksMessage = document.createElement('p');
            noTasksMessage.className = 'text-gray-500 text-center py-6 no-tasks-message';
            noTasksMessage.textContent = `No tienes tareas ${statusFilter === 'pendiente' ? 'pendientes' : 'completadas'}.`;
            currentTasksContainer.appendChild(noTasksMessage);
            return;
        }

        // 2. Convertir Map a Array y ordenar
        const sortedTasks = Array.from(combinedMap.values()).sort((a, b) => {
            const dateA = a.dueDate ? new Date(a.dueDate) : new Date(8640000000000000);
            const dateB = b.dueDate ? new Date(b.dueDate) : new Date(8640000000000000);
            return dateA - dateB;
        });

        // 3. Iterar sobre las tareas ordenadas
        let previousCard = null; // Para insertar en el orden correcto
        sortedTasks.forEach((taskData) => {
            const existingCard = currentTasksContainer.querySelector(`.task-card[data-id="${taskData.id}"]`);
            if (existingCard) {
                // Si la tarjeta ya existe, la desmarcamos y actualizamos referencia
                delete existingCard.dataset.markedForRemoval;
                previousCard = existingCard;
                // NOTA: Si los datos internos de la tarjeta pudieran cambiar (ej. descripción),
                // aquí se podría comparar `taskData` con los datos guardados en `existingCard`
                // y actualizar solo si es necesario, o simplemente re-renderizarla.
                // Por ahora, asumimos que solo cambia el estado (pendiente/completada),
                // lo cual ya maneja el filtro de la consulta.
            } else {
                // Si la tarjeta es nueva, la creamos y la insertamos
                try {
                    // createTaskCard ahora carga sus propios datos asíncronamente
                    const taskCard = createTaskCard(taskData);

                    // Insertar después de la tarjeta anterior o al principio
                    if (previousCard) {
                        previousCard.insertAdjacentElement('afterend', taskCard);
                    } else {
                        currentTasksContainer.insertBefore(taskCard, currentTasksContainer.firstChild);
                    }
                    previousCard = taskCard; // Actualizamos la referencia

                } catch (cardError) {
                    console.error(`[Tareas] Error creando tarjeta para tarea ${taskData.id} (${statusFilter}):`, cardError);
                }
            }
        });

        // 4. Eliminar las tarjetas que quedaron marcadas para remover
        currentTasksContainer.querySelectorAll('.task-card[data-marked-for-removal="true"]').forEach(card => {
            console.log(`Removing card for task ${card.dataset.id}`); // Log opcional
            // Limpiar listener de material antes de remover
            const materialStatusDiv = card.querySelector(`[id^="material-status-${card.dataset.id}"]`);
            if (materialStatusDiv && materialStatusListeners.has(materialStatusDiv.id)) {
                materialStatusListeners.get(materialStatusDiv.id)();
                materialStatusListeners.delete(materialStatusDiv.id);
            }
            card.remove();
        });
    };

    // Consulta 1: Tareas PRINCIPALES (onSnapshot)
    const principalQuery = query(
        collection(db, "tasks"),
        where("assigneeId", "==", currentUser.uid),
        where("status", "==", statusFilter)
    );
    const unsubscribePrincipal = onSnapshot(principalQuery, (querySnapshot) => {
        let changed = false;
        querySnapshot.docChanges().forEach((change) => {
            changed = true; // Marcamos que hubo cambios
            if (change.type === "removed") {
                principalTasks.delete(change.doc.id);
            } else {
                principalTasks.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
            }
        });
        // Solo renderiza si hubo cambios o es la primera carga (combinedTasksRendered es false)
        if (changed || !combinedTasksRendered) renderCombinedTasks(principalTasks, additionalTasks);
    }, (error) => {
        console.error(`Error en listener de tareas principales (${statusFilter}): `, error);
        renderCombinedTasks(principalTasks, additionalTasks); // Intenta renderizar en caso de error
    });

    // Consulta 2: Tareas ADICIONALES (onSnapshot)
    const additionalQuery = query(
        collection(db, "tasks"),
        where("additionalAssigneeIds", "array-contains", currentUser.uid),
        where("status", "==", statusFilter)
    );
    const unsubscribeAdditional = onSnapshot(additionalQuery, (querySnapshot) => {
        let changed = false;
        querySnapshot.docChanges().forEach((change) => {
            changed = true; // Marcamos que hubo cambios
            if (change.type === "removed") {
                additionalTasks.delete(change.doc.id);
            } else {
                additionalTasks.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
            }
        });
        // Solo renderiza si hubo cambios o es la primera carga
        if (changed || !combinedTasksRendered) renderCombinedTasks(principalTasks, additionalTasks);
    }, (error) => {
        console.error(`Error en listener de tareas adicionales (${statusFilter}): `, error);
        renderCombinedTasks(principalTasks, additionalTasks); // Intenta renderizar en caso de error
    });


    // Guardamos ambos listeners para poder cancelarlos después
    unsubscribeTasks = () => {
        unsubscribePrincipal();
        unsubscribeAdditional();
    };

    // Añadir el nuevo listener combinado al array de listeners activos
    if (unsubscribeTasks) {
        activeListeners = activeListeners.filter(listener => listener !== unsubscribeTasks);
        activeListeners.push(unsubscribeTasks);
    } else {
        console.error("ERROR CRÍTICO: unsubscribeTasks es null DESPUÉS de crear los listeners.");
    }
}

/**
 * Crea el elemento HTML (tarjeta) para mostrar una tarea individual, asegurando altura uniforme y pie alineado.
 * @param {object} task - El objeto de datos de la tarea desde Firestore.
 * @returns {HTMLElement} - El elemento div de la tarjeta de tarea.
 */
function createTaskCard(task) {
    const card = document.createElement('div');
    // --- INICIO DE LA MODIFICACIÓN ---
    // ASEGURAMOS que 'h-full' esté aquí
    card.className = "bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden h-full task-card"; 
    card.dataset.id = task.id;

    // --- Lógica de Fecha (sin cambios) ---
    const dueDate = task.dueDate ? new Date(task.dueDate + 'T00:00:00') : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let dateColor = 'text-gray-500';
    let dateText = dueDate ? dueDate.toLocaleDateString('es-CO') : 'Sin fecha límite';
    let dateIcon = `<svg class="h-4 w-4 mr-1 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>`;
    if (dueDate && task.status === 'pendiente') {
        if (dueDate < today) {
            dateColor = 'text-red-600 font-bold';
            dateText += ' (Vencida)';
            dateIcon = `<svg class="h-4 w-4 mr-1 inline-block text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.414-1.414L11 10.586V6z" clip-rule="evenodd"></path></svg>`;
        } else if (dueDate.getTime() === today.getTime()) {
            dateColor = 'text-yellow-600 font-bold';
            dateText += ' (Hoy)';
            dateIcon = `<svg class="h-4 w-4 mr-1 inline-block text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.414-1.414L11 10.586V6z" clip-rule="evenodd"></path></svg>`;
        }
    }

    // --- Lógica para listas de ítems (con carga asíncrona) ---
    let itemsSectionHtml = '';
    const pendingListId = `task-items-pending-${task.id}`;
    const completedListId = `task-items-completed-${task.id}`;

    if (task.specificSubItemIds && task.specificSubItemIds.length > 0) {
        itemsSectionHtml = `
            <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="bg-yellow-50 p-3 rounded-md border border-yellow-200">
                    <p class="text-xs font-semibold text-yellow-800 mb-1 flex items-center">
                        <svg class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Ítems por Trabajar:
                    </p>
                    <ul id="${pendingListId}" class="space-y-1 pl-5">
                        <li class="text-xs text-gray-400 italic">Cargando...</li>
                    </ul>
                </div>
                <div class="bg-green-50 p-3 rounded-md border border-green-200">
                    <p class="text-xs font-semibold text-green-800 mb-1 flex items-center">
                        <svg class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Ítems Trabajados:
                    </p>
                    <ul id="${completedListId}" class="space-y-1 pl-5">
                         <li class="text-xs text-gray-400 italic">Cargando...</li>
                    </ul>
                </div>
            </div>
        `;

        const loadAndSeparateItems = async () => { /* ... (código existente sin cambios) ... */
            try {
                const subItemIds = task.specificSubItemIds;
                const subItemPromises = subItemIds.map(id => getDoc(doc(db, "subItems", id)));
                const subItemDocs = await Promise.all(subItemPromises);
                const itemsStatus = new Map();
                for (const docSnap of subItemDocs) {
                    if (docSnap.exists()) {
                        const subItem = docSnap.data();
                        const itemId = subItem.itemId;
                        if (!itemId) continue;
                        if (!itemsStatus.has(itemId)) {
                            const itemDoc = await getDoc(doc(db, "items", itemId));
                            const itemName = itemDoc.exists() ? itemDoc.data().name : `Ítem ID: ${itemId}`;
                            itemsStatus.set(itemId, { name: itemName, total: 0, installed: 0 });
                        }
                        const statusInfo = itemsStatus.get(itemId);
                        statusInfo.total++;
                        if (subItem.status === 'Instalado') {
                            statusInfo.installed++;
                        }
                    }
                }
                let pendingHtml = '';
                let completedHtml = '';
                itemsStatus.forEach((statusInfo) => {
                    const pendingCount = statusInfo.total - statusInfo.installed;
                    if (pendingCount > 0) {
                        pendingHtml += `<li class="text-xs text-gray-800 list-disc">${pendingCount} x ${statusInfo.name}</li>`;
                    }
                    if (statusInfo.installed > 0) {
                        completedHtml += `<li class="text-xs text-gray-800 list-disc">${statusInfo.installed} x ${statusInfo.name}</li>`;
                    }
                });
                const pendingListElement = document.getElementById(pendingListId);
                const completedListElement = document.getElementById(completedListId);
                if (pendingListElement) pendingListElement.innerHTML = pendingHtml || '<li class="text-xs text-gray-400 italic">Ninguno pendiente</li>';
                if (completedListElement) completedListElement.innerHTML = completedHtml || '<li class="text-xs text-gray-400 italic">Ninguno trabajado</li>';
            } catch (error) {
                console.error(`Error loading item details for task ${task.id}:`, error);
                const pendingListElement = document.getElementById(pendingListId);
                const completedListElement = document.getElementById(completedListId);
                if (pendingListElement) pendingListElement.innerHTML = `<li class="text-xs text-red-500 list-disc">Error al cargar</li>`;
                if (completedListElement) completedListElement.innerHTML = `<li class="text-xs text-red-500 list-disc">Error al cargar</li>`;
            }
        };
        setTimeout(loadAndSeparateItems, 50);
    }

    // --- Barra de Progreso (con carga asíncrona) ---
    let progressBarHtml = '';
    const progressBarId = `task-progress-bar-${task.id}`;
    const progressTextId = `task-progress-text-${task.id}`;
    if (task.status === 'completada') {
        progressBarHtml = `
            <div class="mt-4 px-4">
                <div class="flex justify-between mb-1"><span class="text-xs font-medium text-green-700">Completada</span><span class="text-xs font-medium text-green-700">100%</span></div>
                <div class="task-progress-bar-bg"><div class="task-progress-bar-fg bg-green-500" style="width: 100%;"></div></div>
            </div>`;
    } else if (task.specificSubItemIds && task.specificSubItemIds.length > 0) {
        progressBarHtml = `
            <div class="mt-4 px-4">
                <div class="flex justify-between mb-1"><span class="text-xs font-medium text-gray-500">Progreso General</span><span id="${progressTextId}" class="text-xs font-medium text-blue-700">Calculando...</span></div>
                <div class="task-progress-bar-bg"><div id="${progressBarId}" class="task-progress-bar-fg" style="width: 0%;"></div></div>
            </div>`;
        const calculateProgress = async () => {
            try {
                const subItemIds = task.specificSubItemIds;
                const subItemPromises = subItemIds.map(id => getDoc(doc(db, "subItems", id)));
                const subItemDocs = await Promise.all(subItemPromises);
                let installedCount = 0;
                let foundCount = 0;
                subItemDocs.forEach(docSnap => {
                    if (docSnap.exists()) {
                        foundCount++;
                        if (docSnap.data().status === 'Instalado') {
                            installedCount++;
                        }
                    }
                });
                const totalSubItemsEffective = Math.min(foundCount, subItemIds.length);
                const percentage = totalSubItemsEffective > 0 ? (installedCount / totalSubItemsEffective) * 100 : 0;
                const progressBarElement = document.getElementById(progressBarId);
                const progressTextElement = document.getElementById(progressTextId);
                if (progressBarElement) progressBarElement.style.width = `${percentage.toFixed(0)}%`;
                if (progressTextElement) progressTextElement.textContent = `${percentage.toFixed(0)}% (${installedCount}/${totalSubItemsEffective})`;
            } catch (error) {
                console.error(`Error calculating progress for task ${task.id}:`, error);
                const progressTextElement = document.getElementById(progressTextId);
                if (progressTextElement) progressTextElement.textContent = 'Error';
            }
        };
        setTimeout(calculateProgress, 100);
    } else {
        progressBarHtml = `
            <div class="mt-4 px-4"><p class="text-xs text-gray-400 italic text-center">Progreso no disponible.</p></div>`;
    }

    // --- Botones (sin cambios) ---
    const baseButtonClasses = "text-xs font-bold py-2 px-4 rounded-lg transition-colors flex items-center shadow-sm";
    const iconBaseClasses = "h-4 w-4 mr-1";
    const editButtonHtmlFinal = currentUserRole === 'admin' ? `
        <button data-action="edit-task" data-id="${task.id}" class="${baseButtonClasses} bg-yellow-500 hover:bg-yellow-600 text-white">
            <svg class="${iconBaseClasses}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
            Editar
        </button>
    ` : '';
    const completeButtonHtmlFinal = task.status === 'pendiente' ? `
        <button data-action="complete-task" data-id="${task.id}" class="${baseButtonClasses} bg-green-500 hover:bg-green-600 text-white">
            <svg class="${iconBaseClasses}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            Completada
        </button>
    ` : '';
    const viewTaskButtonHtmlFinal = `
        <button data-action="view-task-details" data-id="${task.id}" class="${baseButtonClasses} bg-blue-100 hover:bg-blue-200 text-blue-700">
             <svg class="${iconBaseClasses}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.478 0-8.268-2.943-9.542-7z"></path></svg>
            Ver Tarea
        </button>
    `;
    const registerProgressButtonHtmlFinal = task.status === 'pendiente' && task.projectId && ((task.selectedItems && task.selectedItems.length > 0) || (task.specificSubItemIds && task.specificSubItemIds.length > 0)) ? `
        <button data-action="register-task-progress" data-task-id="${task.id}" class="${baseButtonClasses} bg-blue-500 hover:bg-blue-600 text-white">
            <svg class="${iconBaseClasses}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
            Registrar Avance
        </button>
    ` : '';
    const requestMaterialButtonHtml = task.status === 'pendiente' && task.projectId && task.specificSubItemIds && task.specificSubItemIds.length > 0 ? `
        <button data-action="request-material-from-task"
                data-project-id="${task.projectId}"
                data-task-id="${task.id}"
                class="${baseButtonClasses} bg-purple-500 hover:bg-purple-600 text-white">
            <svg class="${iconBaseClasses}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>
            Solicitar Material
        </button>
    ` : '';

    // --- Estructura HTML final ---
    card.innerHTML = `
        <div class="p-4 flex-grow">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <p class="text-xs font-semibold text-blue-600 uppercase tracking-wide">${task.projectName || 'Proyecto no especificado'}</p>
                    <h3 class="text-lg font-bold text-gray-900 leading-tight mt-1">${task.description}</h3>
                </div>
                <div class="text-right flex-shrink-0 pl-4">
                    <p class="text-sm ${dateColor} flex items-center justify-end">
                        ${dateIcon}
                        ${dateText}
                    </p>
                    <p class="text-xs text-gray-400 mt-1">
                        Por: ${usersMap.get(task.createdBy)?.firstName || 'N/A'}
                    </p>
                </div>
            </div>
            ${itemsSectionHtml}
            ${progressBarHtml}
        </div>
        <div class="bg-gray-50 p-3 border-t border-gray-200 flex flex-wrap gap-2 justify-end">
            ${editButtonHtmlFinal}
            ${viewTaskButtonHtmlFinal}
            ${requestMaterialButtonHtml}
            ${registerProgressButtonHtmlFinal}
            ${completeButtonHtmlFinal}
        </div>
    `;
    return card;
}

/**
 * Busca la cantidad EXACTA de sub-ítems pendientes especificada en la tarea
 * y abre el modal de progreso múltiple mostrando solo esos sub-ítems.
 * @param {string} taskId - El ID de la tarea.
 */
async function handleRegisterTaskProgress(taskId) {
    if (!taskId) return;

    console.log(`[Task Progress] Iniciando handleRegisterTaskProgress para Tarea ID: ${taskId}`);
    loadingOverlay.classList.remove('hidden');

    try {
        const taskRef = doc(db, "tasks", taskId);
        let taskSnap = await getDoc(taskRef); // 'let' en lugar de 'const'

        if (!taskSnap.exists()) {
            throw new Error(`[Task Progress] La tarea ${taskId} no fue encontrada.`);
        }

        let taskData = taskSnap.data(); // 'let' en lugar de 'const'
        console.log(`[Task Progress] Tarea encontrada. Proyecto ID: ${taskData.projectId}`);

        // *** INICIO DE LA MODIFICACIÓN ***

        // Verificamos si la tarea usa el nuevo sistema de IDs específicos
        if (taskData.specificSubItemIds && taskData.specificSubItemIds.length > 0) {

            // LÓGICA NUEVA (La tarea ya está actualizada)
            console.log(`[Task Progress] Tarea usa 'specificSubItemIds'. Abriendo modal con ${taskData.specificSubItemIds.length} IDs.`);
            await openMultipleProgressModal(taskData.specificSubItemIds, taskId);

        } else {

            // LÓGICA ANTIGUA (La tarea debe ser actualizada)
            console.warn(`[Task Progress] Tarea ${taskId} no tiene 'specificSubItemIds'. Actualizando tarea ahora...`);

            if (!taskData.projectId || !taskData.selectedItems || taskData.selectedItems.length === 0) {
                throw new Error("[Task Progress] Esta tarea (antigua) no tiene ítems de proyecto relacionados.");
            }

            const relevantPendingSubItemIds = [];
            for (const selectedItem of taskData.selectedItems) {
                const itemId = selectedItem.itemId;
                const quantityNeeded = selectedItem.quantity;

                if (quantityNeeded <= 0) continue;

                console.log(`[Task Progress] (Migración) Buscando ${quantityNeeded} sub-ítem(s) pendientes para Ítem ID: ${itemId}`);

                const subItemsQuery = query(
                    collection(db, "subItems"),
                    where("projectId", "==", taskData.projectId),
                    where("itemId", "==", itemId),
                    where("status", "!=", "Instalado"),
                    orderBy("number", "asc"),
                    limit(quantityNeeded)
                );

                const subItemsSnapshot = await getDocs(subItemsQuery);

                if (subItemsSnapshot.empty) {
                    console.warn(`[Task Progress] (Migración) No se encontraron sub-ítems pendientes para ${itemId}.`);
                } else {
                    console.log(`[Task Progress] (Migración) Encontrados ${subItemsSnapshot.size} sub-ítem(s) para ${itemId}.`);
                    subItemsSnapshot.forEach(subItemDoc => {
                        relevantPendingSubItemIds.push(subItemDoc.id);
                    });
                }
            } // Fin del bucle for

            console.log(`[Task Progress] (Migración) Total de sub-ítems encontrados: ${relevantPendingSubItemIds.length}`);

            if (relevantPendingSubItemIds.length === 0) {
                console.warn("[Task Progress] (Migración) No se encontraron sub-ítems pendientes en total.");
                // (Lógica de alerta existente)
                const checkGeneralPendingQuery = query(
                    collection(db, "subItems"),
                    where("projectId", "==", taskData.projectId),
                    where("itemId", "in", taskData.selectedItems.map(si => si.itemId)),
                    where("status", "!=", "Instalado"),
                    limit(1)
                );
                const generalPendingSnapshot = await getDocs(checkGeneralPendingQuery);
                if (generalPendingSnapshot.empty) {
                    alert("Todos los sub-ítems relacionados con esta tarea ya han sido marcados como 'Instalado'.");
                } else {
                    alert("No se encontraron sub-ítems pendientes específicos para las cantidades requeridas por esta tarea en este momento.");
                }

            } else {

                // *** ¡EL PASO CLAVE! ***
                // Guardamos los IDs encontrados en la tarea para futuras ejecuciones
                console.log(`[Task Progress] (Migración) Guardando ${relevantPendingSubItemIds.length} IDs en la tarea ${taskId}...`);
                await updateDoc(taskRef, {
                    specificSubItemIds: relevantPendingSubItemIds
                });

                // Ahora que la tarea está actualizada, la abrimos
                console.log(`[Task Progress] (Migración) Tarea actualizada. Llamando a openMultipleProgressModal.`);
                await openMultipleProgressModal(relevantPendingSubItemIds, taskId);
            }
        }
        // *** FIN DE LA MODIFICACIÓN ***

    } catch (error) {
        // El error ahora tendrá más contexto gracias a los logs
        console.error("Error en handleRegisterTaskProgress:", error);
        alert(`Error: ${error.message}`);
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

/**
* Marca una tarea como completada en Firestore, SI TODOS sus sub-ítems están instalados.
* @param {string} taskId - El ID de la tarea a completar.
*/
async function completeTask(taskId) {
    const taskRef = doc(db, "tasks", taskId);
    loadingOverlay.classList.remove('hidden'); // Muestra el loader

    try {
        const taskSnap = await getDoc(taskRef);
        if (!taskSnap.exists()) {
            throw new Error("La tarea no fue encontrada.");
        }

        const taskData = taskSnap.data();
        const subItemIds = taskData.specificSubItemIds;

        // --- INICIO DE LA VALIDACIÓN ---
        // 1. Verificar si hay sub-ítems asociados
        if (subItemIds && subItemIds.length > 0) {

            // 2. Obtener el estado de TODOS los sub-ítems de la tarea
            const subItemsQuery = query(
                collection(db, "subItems"),
                where("__name__", "in", subItemIds) // Consulta por IDs específicos
            );
            const subItemsSnapshot = await getDocs(subItemsQuery);

            let allInstalled = true;
            let foundCount = 0; // Para verificar que encontramos todos los IDs esperados

            // --- INICIO DE LA CORRECCIÓN ---
            // Declaramos installedCount aquí, antes del bucle
            let installedCount = 0;
            // --- FIN DE LA CORRECCIÓN ---

            // 3. Revisar cada sub-ítem
            subItemsSnapshot.forEach(doc => {
                foundCount++;
                if (doc.data().status === 'Instalado') {
                    // --- INICIO DE LA CORRECCIÓN ---
                    // Incrementamos la variable ya declarada
                    installedCount++;
                    // --- FIN DE LA CORRECCIÓN ---
                } else {
                    allInstalled = false;
                }
            });

            // 4. Verificar si encontramos todos los sub-ítems y si todos están instalados
            if (foundCount !== subItemIds.length || !allInstalled) {
                // Si faltan sub-ítems o alguno no está instalado, muestra error
                // Ahora podemos usar installedCount en el mensaje sin error
                alert(`No se puede completar la tarea. ${subItemIds.length - foundCount} sub-ítem(s) no se encontraron o ${subItemIds.length - installedCount} aún no están marcados como 'Instalado'.`);
                loadingOverlay.classList.add('hidden'); // Oculta el loader
                return; // Detiene la ejecución
            }
        } else {
            // Si la tarea no tiene subItemIds (puede ser antigua o sin ítems)
            console.warn(`Tarea ${taskId} no tiene sub-ítems específicos asociados. Completando sin verificar avance.`);
        }
        // --- FIN DE LA VALIDACIÓN ---

        // Si pasa la validación (o no tenía subítems), actualiza la tarea
        await updateDoc(taskRef, {
            status: 'completada',
            completedAt: new Date(),
            completedBy: currentUser.uid
        });

        console.log(`Tarea ${taskId} marcada como completada.`);
        // La vista se actualizará automáticamente gracias a onSnapshot

    } catch (error) {
        console.error("Error al marcar la tarea como completada:", error);
        alert(`No se pudo completar la tarea: ${error.message}`);
    } finally {
        loadingOverlay.classList.add('hidden'); // Asegura que el loader se oculte
    }
}

/**
 * Guarda una nueva tarea en Firestore, incluyendo ítems seleccionados con cantidad
 * y envía notificaciones a los asignados.
 * @param {object} taskData - Datos de la tarea obtenidos del formulario del modal.
 */
async function createTask(taskData) {
    // Validaciones básicas (se mantienen projectId, assigneeId, description)
    if (!taskData.projectId || !taskData.assigneeId || !taskData.description) {
        alert("Por favor, completa Proyecto, Asignado Principal y Descripción.");
        return;
    }

    // --- Recolectar datos de ítems y encontrar subItemIds (Lógica existente sin cambios) ---
    const itemCheckboxes = modalForm.querySelectorAll('input[name="selectedItemIds"]:checked');
    if (itemCheckboxes.length === 0) {
        alert("Debes seleccionar al menos un Ítem Relacionado e ingresar su cantidad.");
        return;
    }
    const selectedItemsQueryData = [];
    // (Bucle for...of para validar cantidades y llenar selectedItemsQueryData)
    for (const checkbox of itemCheckboxes) {
        const itemId = checkbox.value;
        const quantityInput = modalForm.querySelector(`input[name="itemQuantity_${itemId}"]`);
        const quantity = parseInt(quantityInput?.value);
        const maxQuantity = parseInt(checkbox.dataset.itemQuantity) || 1;

        if (!quantity || quantity <= 0) {
            throw new Error(`Por favor, ingresa una cantidad válida (mayor a 0) para el ítem "${checkbox.nextElementSibling.textContent}".`);
        }
        if (quantity > maxQuantity) {
            throw new Error(`La cantidad para el ítem "${checkbox.nextElementSibling.textContent}" (${quantity}) excede el máximo permitido (${maxQuantity}).`);
        }

        selectedItemsQueryData.push({
            itemId: itemId,
            quantityNeeded: quantity,
            itemName: checkbox.nextElementSibling.textContent
        });
    }

    const specificSubItemIds = [];
    const selectedItemsForTask = [];
    // (Bucle for...of para buscar los subItemIds y llenar specificSubItemIds y selectedItemsForTask)
    for (const itemQuery of selectedItemsQueryData) {
        const subItemsQuery = query(
            collection(db, "subItems"),
            where("projectId", "==", taskData.projectId),
            where("itemId", "==", itemQuery.itemId),
            where("status", "!=", "Instalado"),
            orderBy("number", "asc"),
            limit(itemQuery.quantityNeeded)
        );
        const subItemsSnapshot = await getDocs(subItemsQuery);
        if (subItemsSnapshot.size < itemQuery.quantityNeeded) {
            throw new Error(`No se pudieron asignar ${itemQuery.quantityNeeded} unidades para "${itemQuery.itemName}". Solo se encontraron ${subItemsSnapshot.size} unidades pendientes.`);
        }
        subItemsSnapshot.forEach(doc => {
            specificSubItemIds.push(doc.id);
        });
        selectedItemsForTask.push({
            itemId: itemQuery.itemId,
            quantity: itemQuery.quantityNeeded
        });
    }
    // --- Fin recolección y búsqueda ---


    // Recolectar asignados adicionales (sin cambios)
    const additionalAssignees = taskData.additionalAssigneeIds ?
        (Array.isArray(taskData.additionalAssigneeIds) ? taskData.additionalAssigneeIds : [taskData.additionalAssigneeIds])
        : [];

    try {
        // --- Guardar la Tarea (Lógica existente) ---
        const newTaskRef = await addDoc(collection(db, "tasks"), { // Guardamos la referencia a la nueva tarea
            projectId: taskData.projectId,
            projectName: taskData.projectName,
            assigneeId: taskData.assigneeId,
            assigneeName: taskData.assigneeName,
            additionalAssigneeIds: additionalAssignees,
            selectedItems: selectedItemsForTask,
            specificSubItemIds: specificSubItemIds,
            description: taskData.description,
            dueDate: taskData.dueDate || null,
            status: 'pendiente',
            createdAt: new Date(),
            createdBy: currentUser.uid
        });
        console.log("Nueva tarea guardada en Firestore con ID:", newTaskRef.id);

        // --- INICIO DE LA NUEVA LÓGICA DE NOTIFICACIONES ---
        const notificationMessage = `Nueva tarea asignada: ${taskData.description.substring(0, 50)}${taskData.description.length > 50 ? '...' : ''}`;
        const notificationData = {
            message: notificationMessage,
            taskId: newTaskRef.id, // ID de la tarea recién creada
            projectId: taskData.projectId,
            read: false,
            createdAt: new Date(),
            type: 'new_task_assignment' // Tipo de notificación
        };

        // 1. Notificación para el asignado principal
        if (taskData.assigneeId && taskData.assigneeId !== currentUser.uid) { // No notificarse a sí mismo
            await addDoc(collection(db, "notifications"), {
                ...notificationData,
                userId: taskData.assigneeId
            });
            console.log(`Notificación enviada a asignado principal: ${taskData.assigneeId}`);
        }

        // 2. Notificaciones para asignados adicionales
        for (const additionalId of additionalAssignees) {
            if (additionalId && additionalId !== currentUser.uid) { // No notificarse a sí mismo
                await addDoc(collection(db, "notifications"), {
                    ...notificationData,
                    userId: additionalId
                });
                console.log(`Notificación enviada a asignado adicional: ${additionalId}`);
            }
        }
        // --- FIN DE LA NUEVA LÓGICA DE NOTIFICACIONES ---

        closeMainModal();

    } catch (error) {
        console.error("Error al guardar la nueva tarea o enviar notificaciones:", error);
        alert(`No se pudo guardar la tarea: ${error.message}`);
    }
}

/**
 * Abre el modal con los detalles completos de una tarea específica, con un diseño mejorado.
 * Establece el contexto de retorno para la solicitud de material.
 * @param {string} taskId - El ID de la tarea a mostrar.
 */
async function openTaskDetailsModal(taskId) {
    const modal = document.getElementById('task-details-modal');
    const titleEl = document.getElementById('task-details-title');
    const bodyEl = document.getElementById('task-details-body');
    const actionsEl = document.getElementById('task-details-actions');

    if (!modal || !bodyEl || !actionsEl) return;

    // Establecer el contexto de retorno CADA VEZ que se entra a esta vista
    materialRequestReturnContext = { view: 'detalle-tarea', taskId: taskId };
    console.log("Contexto de retorno establecido en: detalle-tarea"); // Log para depuración

    // Mostrar modal y estado de carga
    modal.style.display = 'flex';
    titleEl.textContent = 'Cargando Detalles...';
    bodyEl.innerHTML = '<div class="text-center py-8"><div class="loader mx-auto"></div></div>';
    actionsEl.querySelectorAll('button:not(#task-details-cancel-btn)').forEach(btn => btn.remove());

    try {
        const taskRef = doc(db, "tasks", taskId);
        const taskSnap = await getDoc(taskRef);

        if (!taskSnap.exists()) {
            throw new Error("Tarea no encontrada.");
        }

        const task = { id: taskSnap.id, ...taskSnap.data() };

        // --- Título del Modal ---
        titleEl.textContent = `Detalle Tarea: ${task.description.substring(0, 40)}${task.description.length > 40 ? '...' : ''}`;

        // --- Obtener Nombres ---
        const creatorName = usersMap.get(task.createdBy)?.firstName || 'Desconocido';
        const assigneeName = usersMap.get(task.assigneeId)?.firstName + ' ' + usersMap.get(task.assigneeId)?.lastName || 'No asignado';
        let additionalAssigneesNames = 'Ninguno';
        if (task.additionalAssigneeIds && task.additionalAssigneeIds.length > 0) {
            additionalAssigneesNames = task.additionalAssigneeIds
                .map(id => usersMap.get(id)?.firstName || `ID: ${id.substring(0, 5)}...`)
                .join(', ');
        }

        // --- Formatear Fechas y Estado ---
        const dueDate = task.dueDate ? new Date(task.dueDate + 'T00:00:00') : null;
        const createdAtDate = task.createdAt ? task.createdAt.toDate().toLocaleDateString('es-CO') : 'N/A';
        let dueDateText = dueDate ? dueDate.toLocaleDateString('es-CO') : 'No establecida';
        let statusText = task.status === 'pendiente' ? 'Pendiente' : 'Completada';
        let statusColorClass = task.status === 'pendiente' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800';

        // --- Generar lista detallada de ítems ---
        let itemsDetailsHtml = '<p class="text-sm text-gray-500 italic">No hay ítems asociados a esta tarea.</p>';
        if (task.specificSubItemIds && task.specificSubItemIds.length > 0) {
            itemsDetailsHtml = `<div class="border rounded-lg overflow-hidden mt-2">
                <table class="w-full text-sm">
                    <thead class="bg-gray-100">
                        <tr>
                            <th class="px-3 py-2 text-left font-semibold text-gray-600">Ítem</th>
                            <th class="px-3 py-2 text-center font-semibold text-gray-600">Cantidad Total</th>
                            <th class="px-3 py-2 text-center font-semibold text-gray-600">Pendientes</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200" id="task-detail-items-tbody-${task.id}">
                        <tr><td colspan="3" class="text-center py-3 text-gray-400 italic">Cargando ítems...</td></tr>
                    </tbody>
                </table>
             </div>`;

            const loadItemDetails = async () => { /* ... (código existente) ... */
                try {
                    const subItemIds = task.specificSubItemIds;
                    const subItemPromises = subItemIds.map(id => getDoc(doc(db, "subItems", id)));
                    const subItemDocs = await Promise.all(subItemPromises);
                    const itemsStatus = new Map();
                    for (const docSnap of subItemDocs) {
                        if (docSnap.exists()) {
                            const subItem = docSnap.data();
                            const itemId = subItem.itemId;
                            if (!itemId) continue;
                            if (!itemsStatus.has(itemId)) {
                                const itemDoc = await getDoc(doc(db, "items", itemId));
                                const itemName = itemDoc.exists() ? itemDoc.data().name : `Ítem ID: ${itemId}`;
                                itemsStatus.set(itemId, { name: itemName, total: 0, installed: 0 });
                            }
                            const statusInfo = itemsStatus.get(itemId);
                            statusInfo.total++;
                            if (subItem.status === 'Instalado') {
                                statusInfo.installed++;
                            }
                        }
                    }
                    let tableBodyHtml = '';
                    if (itemsStatus.size === 0) {
                        tableBodyHtml = '<tr><td colspan="3" class="text-center py-3 text-red-500">Error: No se encontraron los ítems asociados.</td></tr>';
                    } else {
                        itemsStatus.forEach((statusInfo, itemId) => {
                            const pendingCount = statusInfo.total - statusInfo.installed;
                            tableBodyHtml += `
                                <tr class="hover:bg-gray-50">
                                    <td class="px-3 py-2 font-medium text-gray-800">${statusInfo.name}</td>
                                    <td class="px-3 py-2 text-center">${statusInfo.total}</td>
                                    <td class="px-3 py-2 text-center font-bold ${pendingCount > 0 ? 'text-red-600' : 'text-green-600'}">${pendingCount}</td>
                                </tr>`;
                        });
                    }
                    const tbodyElement = document.getElementById(`task-detail-items-tbody-${task.id}`);
                    if (tbodyElement) tbodyElement.innerHTML = tableBodyHtml;
                } catch (error) {
                    console.error(`Error loading item details for task ${task.id}:`, error);
                    const tbodyElement = document.getElementById(`task-detail-items-tbody-${task.id}`);
                    if (tbodyElement) tbodyElement.innerHTML = '<tr><td colspan="3" class="text-center py-3 text-red-500">Error al cargar detalles de ítems.</td></tr>';
                }
            };
            setTimeout(loadItemDetails, 50);
        }

        // --- INICIO DE LA MODIFICACIÓN ---
        // 1. Añadimos el placeholder para el estado del material DENTRO del modal
        const materialStatusId = `task-detail-material-status-${task.id}`;
        let materialStatusHtml = '';
        // Solo si la tarea tiene subítems (y por ende, podría necesitar material)
        if (task.specificSubItemIds && task.specificSubItemIds.length > 0) {
            materialStatusHtml = `
                <div class="bg-white border border-gray-200 rounded-lg p-4">
                     <h4 class="text-md font-semibold text-gray-700 mb-2 border-b pb-2 flex items-center">
                        <svg class="h-5 w-5 mr-2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"></path></svg>
                        Estado de Materiales
                    </h4>
                    <div id="${materialStatusId}">
                        <p class="text-sm text-gray-400 italic">Cargando estado de materiales...</p>
                    </div>
                </div>
             `;
        }
        // --- FIN DE LA MODIFICACIÓN ---


        // --- Construir el cuerpo del modal con secciones ---
        bodyEl.innerHTML = `
            <div class="space-y-6">
                <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
                     <h4 class="text-md font-semibold text-gray-700 mb-3 border-b pb-2 flex items-center">
                        <svg class="h-5 w-5 mr-2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Información General
                    </h4>
                    <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <div>
                            <dt class="font-medium text-gray-500">Proyecto</dt>
                            <dd class="text-gray-900 font-semibold">${task.projectName || 'N/A'}</dd>
                        </div>
                        <div>
                            <dt class="font-medium text-gray-500">Estado</dt>
                            <dd><span class="px-2 py-1 text-xs font-semibold rounded-full ${statusColorClass}">${statusText}</span></dd>
                        </div>
                         <div>
                            <dt class="font-medium text-gray-500">Fecha Límite</dt>
                            <dd class="text-gray-900">${dueDateText}</dd>
                        </div>
                        <div>
                            <dt class="font-medium text-gray-500">Fecha Creación</dt>
                            <dd class="text-gray-900">${createdAtDate}</dd>
                        </div>
                        <div class="col-span-2">
                            <dt class="font-medium text-gray-500">Descripción</dt>
                            <dd class="text-gray-900 whitespace-pre-wrap">${task.description}</dd>
                        </div>
                    </dl>
                </div>
                <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
                      <h4 class="text-md font-semibold text-gray-700 mb-3 border-b pb-2 flex items-center">
                         <svg class="h-5 w-5 mr-2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M15 21v-1a6 6 0 00-1-3.796V12a4 4 0 11-8 0v2.204a6 6 0 00-1 3.796v1z"></path></svg>
                        Asignación
                    </h4>
                     <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <div>
                            <dt class="font-medium text-gray-500">Asignado Principal</dt>
                            <dd class="text-gray-900 font-semibold">${assigneeName}</dd>
                        </div>
                        <div>
                            <dt class="font-medium text-gray-500">Creada por</dt>
                            <dd class="text-gray-900">${creatorName}</dd>
                        </div>
                        <div class="col-span-2">
                            <dt class="font-medium text-gray-500">Otros Asignados</dt>
                            <dd class="text-gray-900">${additionalAssigneesNames}</dd>
                        </div>
                    </dl>
                </div>
                <div class="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 class="text-md font-semibold text-gray-700 mb-2 border-b pb-2 flex items-center">
                        <svg class="h-5 w-5 mr-2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                        Ítems Relacionados y Avance
                    </h4>
                    ${itemsDetailsHtml}
                </div>
                ${materialStatusHtml}
            </div>
        `;

        // --- INICIO DE LA MODIFICACIÓN ---
        // 2. Llamamos a la función para que llene el placeholder
        // Solo si la tarea tiene subítems (y por ende, el placeholder existe)
        if (task.specificSubItemIds && task.specificSubItemIds.length > 0) {
            loadTaskMaterialStatus(task.id, task.projectId, materialStatusId);
        }
        // --- FIN DE LA MODIFICACIÓN ---

        // --- Añadir botones de acción (sin cambios) ---
        actionsEl.querySelectorAll('button:not(#task-details-cancel-btn)').forEach(btn => btn.remove());

        if (currentUserRole === 'admin') { /* ... (botón editar) ... */
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.dataset.action = 'edit-task';
            editBtn.dataset.id = task.id;
            editBtn.className = 'bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg flex items-center';
            editBtn.innerHTML = `<svg class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg> Editar Tarea`;
            actionsEl.insertBefore(editBtn, actionsEl.firstChild);
        }
        if (task.status === 'pendiente' && task.specificSubItemIds && task.specificSubItemIds.length > 0) { /* ... (botón solicitar material) ... */
            const requestBtn = document.createElement('button');
            requestBtn.type = 'button';
            requestBtn.dataset.action = 'request-material-from-task';
            requestBtn.dataset.projectId = task.projectId;
            requestBtn.dataset.taskId = task.id;
            requestBtn.className = 'bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-4 rounded-lg flex items-center';
            requestBtn.innerHTML = `<svg class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg> Solicitar Material`;
            actionsEl.insertBefore(requestBtn, actionsEl.firstChild);
        }
        if (task.status === 'pendiente' && task.specificSubItemIds && task.specificSubItemIds.length > 0) { /* ... (botón registrar avance) ... */
            const progressBtn = document.createElement('button');
            progressBtn.type = 'button';
            progressBtn.dataset.action = 'register-task-progress';
            progressBtn.dataset.taskId = task.id;
            progressBtn.className = 'bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg flex items-center';
            progressBtn.innerHTML = `<svg class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg> Registrar Avance`;
            actionsEl.insertBefore(progressBtn, actionsEl.firstChild);
        }

    } catch (error) {
        console.error("Error al abrir detalles de tarea:", error);
        titleEl.textContent = 'Error';
        bodyEl.innerHTML = `<p class="text-red-500 text-center py-6">${error.message}</p>`;
    }
}

/**
 * Cierra el modal de detalles de la tarea.
 */
function closeTaskDetailsModal() {
    const modal = document.getElementById('task-details-modal');
    if (modal) {
        modal.style.display = 'none';

        const bodyEl = document.getElementById('task-details-body');

        // --- INICIO DE LA MODIFICACIÓN (Limpieza de listener) ---
        // Limpiar listeners de material activos para este modal
        // Buscamos cualquier div de estado de material dentro del cuerpo del modal
        const materialStatusDiv = bodyEl.querySelector('div[id^="task-detail-material-status-"]');
        if (materialStatusDiv) {
            const placeholderId = materialStatusDiv.id;
            if (materialStatusListeners.has(placeholderId)) {
                materialStatusListeners.get(placeholderId)(); // Llama a la función unsubscribe
                materialStatusListeners.delete(placeholderId);
                console.log(`Listener de material ${placeholderId} limpiado al cerrar modal.`);
            }
        }
        // --- FIN DE LA MODIFICACIÓN ---

        // Opcional: Limpiar el contenido para la próxima vez
        bodyEl.innerHTML = '<div class="text-center py-8"><div class="loader mx-auto"></div></div>';
        document.getElementById('task-details-actions').querySelectorAll('button:not(#task-details-cancel-btn)').forEach(btn => btn.remove());
    }
}

/**
 * Inicia el proceso de solicitud de material pre-seleccionando ítems de una tarea.
 * @param {string} projectId - El ID del proyecto.
 * @param {string} taskId - El ID de la tarea origen.
 */
async function handleRequestMaterialFromTask(projectId, taskId) {
    loadingOverlay.classList.remove('hidden');
    try {
        const [projectDoc, taskDoc] = await Promise.all([
            getDoc(doc(db, "projects", projectId)),
            getDoc(doc(db, "tasks", taskId))
        ]);

        if (!projectDoc.exists()) throw new Error("El proyecto asociado no existe.");
        if (!taskDoc.exists()) throw new Error("La tarea asociada no existe.");

        currentProject = { id: projectDoc.id, ...projectDoc.data() };
        const taskData = taskDoc.data();
        const subItemIds = taskData.specificSubItemIds || [];

        let pendingItemsForTask = [];
        if (subItemIds.length > 0) {
            // ... (Lógica existente para calcular pendingItemsMap) ...
            const subItemPromises = subItemIds.map(id => getDoc(doc(db, "subItems", id)));
            const subItemDocs = await Promise.all(subItemPromises);
            const pendingItemsMap = new Map();
            subItemDocs.forEach(docSnap => {
                if (docSnap.exists() && docSnap.data().status !== 'Instalado') {
                    const subItem = docSnap.data();
                    if (subItem.itemId) {
                        const currentCount = pendingItemsMap.get(subItem.itemId) || 0;
                        pendingItemsMap.set(subItem.itemId, currentCount + 1);
                    }
                }
            });
            pendingItemsMap.forEach((quantity, itemId) => {
                pendingItemsForTask.push({ itemId, quantity });
            });
        } else {
            console.warn("La tarea no tiene subítems específicos para pre-seleccionar.");
            pendingItemsForTask = taskData.selectedItems || null;
        }

        // 2. Mostrar la vista de solicitud, PASANDO los ítems pendientes
        await showMaterialRequestView(pendingItemsForTask);

        // --- INICIO DE LA MODIFICACIÓN ---
        // 3. Guardar el ID de la tarea en el formulario
        const taskIdInput = document.getElementById('material-request-task-id');
        if (taskIdInput) {
            taskIdInput.value = taskId; // Guardamos el ID de la tarea
        }
        // --- FIN DE LA MODIFICACIÓN ---

        // 4. Pre-seleccionar los ítems y cantidades en el formulario
        const itemListContainer = document.getElementById('request-item-list-container-view');
        pendingItemsForTask.forEach(itemInfo => {
            const inputElement = itemListContainer.querySelector(`.request-item-quantity[data-item-id="${itemInfo.itemId}"]`);
            if (inputElement) {
                inputElement.value = itemInfo.quantity;
            }
        });

    } catch (error) {
        console.error("Error al iniciar solicitud desde tarea:", error);
        alert(`Error al preparar la solicitud: ${error.message}`);
        showView('tareas');
        loadTasksView();
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

/**
 * Carga y muestra el estado de los materiales (solicitado, despachado) para una tarea específica.
 * @param {string} taskId - El ID de la tarea.
 * @param {string} projectId - El ID del proyecto.
 * @param {string} placeholderId - El ID del div donde se renderizará el HTML.
 */
function loadTaskMaterialStatus(taskId, projectId, placeholderId) {
    // Cancelar cualquier listener anterior para esta misma tarjeta
    if (materialStatusListeners.has(placeholderId)) {
        materialStatusListeners.get(placeholderId)(); // Llama a la función unsubscribe
        materialStatusListeners.delete(placeholderId);
    }

    const q = query(
        collection(db, "projects", projectId, "materialRequests"),
        where("taskId", "==", taskId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const container = document.getElementById(placeholderId);
        if (!container) {
            unsubscribe(); // Si el contenedor ya no existe, cancela el listener
            materialStatusListeners.delete(placeholderId);
            return;
        }

        if (snapshot.empty) {
            container.innerHTML = `
                <p class="text-xs font-semibold text-gray-700 mb-1 flex items-center">
                    <svg class="h-4 w-4 mr-1 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"></path></svg>
                    Estado de Materiales:
                </p>
                <p class="text-xs text-gray-500 pl-5">No se ha solicitado material.</p>
            `;
            return;
        }

        // Usamos un Map para agrupar por material (itemId)
        const materialSummary = new Map();

        snapshot.forEach(doc => {
            const request = doc.data();
            const status = request.status; // 'pendiente', 'aprobado', 'entregado'
            const items = request.consumedItems || [];

            items.forEach(item => {
                const materialId = item.materialId;
                // Usamos el nombre guardado en la solicitud, o un fallback
                const materialName = item.itemName || "Material";

                if (!materialSummary.has(materialId)) {
                    materialSummary.set(materialId, {
                        name: materialName,
                        solicitado: 0,
                        despachado: 0
                    });
                }

                const summary = materialSummary.get(materialId);
                const quantity = item.quantity || 0;

                if (status === 'entregado') {
                    summary.despachado += quantity;
                    summary.solicitado += quantity; // Si está entregado, también fue solicitado
                } else if (status === 'aprobado' || status === 'pendiente') {
                    summary.solicitado += quantity;
                }
            });
        });

        // Generar el HTML final
        let html = `
            <p class="text-xs font-semibold text-gray-700 mb-1 flex items-center">
                <svg class="h-4 w-4 mr-1 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"></path></svg>
                Estado de Materiales:
            </p>`;

        if (materialSummary.size === 0) {
            html += '<p class="text-xs text-gray-500 pl-5">No se ha solicitado material.</p>';
        }

        html += '<ul class="space-y-1 text-xs pl-5">';
        materialSummary.forEach((summary, id) => {
            const pendiente = summary.solicitado - summary.despachado;

            html += `<li class="border-b border-gray-100 pb-1 last:border-b-0">
                <span class="font-medium text-gray-800">${summary.name}</span>
                <div class="pl-2">
                   <span class="text-blue-600">Solicitado: ${summary.solicitado}</span> | 
                   <span class="text-green-600">Despachado: ${summary.despachado}</span>
                   ${pendiente > 0 ? `| <span class="font-bold text-red-600">Pendiente: ${pendiente}</span>` : ''}
                </div>
            </li>`;
        });
        html += '</ul>';

        container.innerHTML = html;

    }, (error) => {
        console.error(`Error al cargar estado de material para tarea ${taskId}:`, error);
        const container = document.getElementById(placeholderId);
        if (container) {
            container.innerHTML = `<p class="text-xs text-red-500">Error al cargar estado de material.</p>`;
        }
    });

    // Guardar la función de unsubscribe
    materialStatusListeners.set(placeholderId, unsubscribe);
    // También la añadimos al listener global por si acaso
    activeListeners.push(unsubscribe);
}