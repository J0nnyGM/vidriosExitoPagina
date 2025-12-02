// Importaciones de Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateEmail } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, writeBatch, getDocs, arrayUnion, orderBy, runTransaction, collectionGroup, increment, limit, serverTimestamp, arrayRemove, documentId, enableIndexedDbPersistence, CACHE_SIZE_UNLIMITED } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js"; // <-- AÑADIDO documentId
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app-check.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging.js";
import { initDotacion, loadDotacionView, updateDotacionFilterOptions, loadDotacionAsignaciones } from './dotacion.js'; // <-- AÑADIDO 'loadDotacionAsignaciones'
import { initHerramientas, resetToolViewAndLoad, updateToolFilterOptions, TOOL_CATEGORIES } from './herramientas.js';
import { initDashboard, showGeneralDashboard } from './dashboard.js';
import { initEmpleados, loadEmpleadosView, showEmpleadoDetails, loadPaymentHistoryView } from './empleados.js'; // <-- AÑADIDO
import { initConfiguracion, loadConfiguracionView } from './configuracion.js';
import { initCartera, loadCarteraView } from "./cartera.js";
import { initSolicitudes, loadSolicitudesView } from './solicitudes.js';
import { handleReportEntry } from './ingresopersonal.js';

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

const VAPID_KEY = "BKdSH8VAjrl0Fpzc-FZmIVvahDsXV_BlIXU440PWRL3CBkqHiNCg3tav-Lf2kZFOy99sfTHfA5L2e-yXpf-eMiQ";

const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider('6Lc-090rAAAAAKkE09k5txsrVWXG3Xelxnrpb7Ty'),
    isTokenAutoRefreshEnabled: true
});
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const messaging = getMessaging(app);
const functions = getFunctions(app, 'us-central1'); // ASEGÚRATE DE QUE ESTA LÍNEA EXISTA


// --- INICIO CONFIGURACIÓN OFFLINE ---
enableIndexedDbPersistence(db)
    .catch((err) => {
        if (err.code == 'failed-precondition') {
            // Falló porque hay múltiples pestañas abiertas a la vez
            console.warn("La persistencia offline solo funciona con una pestaña abierta a la vez.");
        } else if (err.code == 'unimplemented') {
            // El navegador no soporta esta característica
            console.warn("El navegador no soporta persistencia offline.");
        }
    });
// --- FIN CONFIGURACIÓN OFFLINE ---

let unsubscribeTasks = null; // <-- AÑADE ESTA LÍNEA
let unsubscribeReports = null;
let unsubscribePurchaseOrders = null;
let unsubscribeInventory = null;
let unsubscribeStock = null;
let unsubscribeMaterialRequests = null;
const materialStatusListeners = new Map();
const taskCommentListeners = new Map(); // <-- AÑADIR ESTA LÍNEA
let materialRequestReturnContext = { view: 'proyectos' };
let currentCorte = null;
let unsubscribePeopleOfInterest = null;
let unsubscribePayments = null;
let activeListeners = [];
let currentUser = null;
let currentUserRole = null;

let processedPhotoFile = null; // Almacenará el archivo convertido (HEIC) o capturado (Cámara)

let usersMap = new Map();
let payrollConfig = null; // <-- ASEGÚRATE DE QUE ESTA LÍNEA ESTÉ
let selectedProjectId = null;
let currentProject = null;
let currentItem = null;
let unsubscribeProjects = null;
let unsubscribeItems = null;
let unsubscribeSubItems = null;
let unsubscribeUsers = null;
let itemSortState = { key: 'name', direction: 'asc' };
let currentItemsData = [];
let catalogSearchTerm = ''; // Guarda el término de búsqueda actual para el catálogo
let onSafetyCheckInSuccess = () => { }; // Callback global
let videoStream = null; // Variable global para el stream de la cámara
let verifiedCanvas = null; // Variable global para guardar la selfie verificada
let pendingProfileUpdateData = null; // Guarda los datos del formulario de perfil temporalmente
let _storage; // <-- AÑADIDO
let _openConfirmModal; // <-- AÑADIDO
let activeEmpleadoChart = null;
let unsubscribeEmpleadosTab = null;

/**
 * Carga y muestra el historial de cambios de un perfil de usuario.
 * @param {string} userId - El ID del usuario cuyo historial se cargará.
 */
async function loadProfileHistory(userId) {
    const modal = document.getElementById('tool-history-modal');
    const titleEl = document.getElementById('tool-history-title');
    const listContainer = document.getElementById('tool-history-body');

    if (!modal || !titleEl || !listContainer) {
        console.error("No se encontró el modal de historial (tool-history-modal).");
        return;
    }

    const user = usersMap.get(userId);
    const userName = user ? `${user.firstName} ${user.lastName}` : 'Usuario';

    titleEl.textContent = `Historial de Cambios: ${userName}`;

    listContainer.innerHTML = '<p class="text-sm text-gray-400 italic text-center p-4">Cargando historial...</p>';
    listContainer.className = "flex-grow overflow-y-auto pr-2 space-y-3 bg-gray-100 p-3 rounded-b-lg";
    modal.style.display = 'flex';

    const keyTranslator = {
        firstName: 'Nombre',
        lastName: 'Apellido',
        idNumber: 'Cédula',
        phone: 'Celular',
        address: 'Dirección',
        email: 'Correo',
        // profilePhotoURL: 'Foto de Perfil', // Ya no se mostrará
        tallaCamiseta: 'Talla Camiseta',
        tallaPantalón: 'Talla Pantalón',
        tallaBotas: 'Talla Botas'
    };

    function formatValue(value) {
        if (value === null || typeof value === 'undefined') return '';
        if (typeof value === 'string') return value.trim();
        return String(value);
    }

    const q = query(
        collection(db, "users", userId, "profileHistory"),
        orderBy("timestamp", "desc"),
        limit(10)
    );

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            listContainer.innerHTML = '<p class="text-sm text-gray-400 italic text-center p-4">No hay historial de cambios.</p>';
            return;
        }

        listContainer.innerHTML = '';
        snapshot.forEach(doc => {
            const entry = doc.data();
            const timestamp = entry.timestamp ? entry.timestamp.toDate() : new Date();
            const dateString = timestamp.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

            const changedByUser = usersMap.get(entry.changedBy);
            const changedByName = changedByUser ? (changedByUser.firstName || 'Usuario') : 'Desconocido';

            // --- INICIO DE MODIFICACIÓN: Filtrar campos ocultos ---
            // Lista de campos que NO queremos mostrar en el historial
            const hiddenFields = ['salarioBasico', 'profilePhotoURL', 'commissionLevel', 'deduccionSobreMinimo'];

            let hasVisibleChanges = false;
            let changesHtml = '<dl class="mt-2 text-xs space-y-1 border-t pt-2">';

            for (const [key, value] of Object.entries(entry.changes)) {
                // Si la llave está en la lista de ocultos, la saltamos
                if (hiddenFields.includes(key)) {
                    continue;
                }

                hasVisibleChanges = true;
                const translatedKey = keyTranslator[key] || key;

                changesHtml += `
                    <div class="grid grid-cols-3 gap-1">
                        <dt class="font-semibold text-gray-600 col-span-1">${translatedKey}:</dt>
                        <dd class="text-gray-800 col-span-2">
                            <span class="text-red-600">Antes:</span> ${formatValue(value.old)}<br>
                            <span class="text-green-600">Después:</span> ${formatValue(value.new)}
                        </dd>
                    </div>
                `;
            }
            changesHtml += '</dl>';
            // --- FIN DE MODIFICACIÓN ---

            // Solo mostramos la tarjeta si hay cambios visibles
            if (hasVisibleChanges) {
                const logEntry = document.createElement('div');
                logEntry.className = 'bg-white rounded-lg shadow-sm border border-gray-200 p-3';
                logEntry.innerHTML = `
                    <div class="flex justify-between items-center">
                        <p class="text-sm font-semibold text-blue-700">Cambio por: ${changedByName}</p>
                        <p class="text-xs text-gray-500">${dateString}</p>
                    </div>
                    ${changesHtml}
                `;
                listContainer.appendChild(logEntry);
            }
        });

        if (listContainer.children.length === 0) {
            listContainer.innerHTML = '<p class="text-sm text-gray-400 italic text-center p-4">No hay cambios visibles en el historial reciente.</p>';
        }

    }, (error) => {
        console.error("Error al cargar historial de perfil:", error);
        listContainer.innerHTML = '<p class="text-sm text-red-500 text-center">Error al cargar historial.</p>';
    });
}

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

/**
 * Cambia entre las vistas de Login y Registro dentro del contenedor de autenticación.
 * @param {string} viewName - 'login' o 'register'.
 */
function showAuthView(viewName) {
    const loginView = document.getElementById('login-view');
    const registerView = document.getElementById('register-view');

    if (viewName === 'login') {
        loginView.classList.remove('hidden');
        registerView.classList.add('hidden');
    } else if (viewName === 'register') {
        loginView.classList.add('hidden');
        registerView.classList.remove('hidden');
    }
}

// --- INICIO: FUNCIÓN DE HELPER (Copiada de dotacion.js) ---
function resizeImage(file, maxWidth = 800) {
    return new Promise((resolve, reject) => {

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                let width = img.width, height = img.height;
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Error al convertir canvas a Blob.'));
                    }
                }, 'image/jpeg', 0.85);
            };
            img.onerror = reject;
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

window.resizeImage = resizeImage;

// --- FIN: FUNCIÓN DE HELPER ---

// --- INICIO DE NUEVO CÓDIGO (FACE-API) ---

// URL donde están alojados los modelos de IA de face-api.js
const MODEL_URL = 'models';
let currentUserFaceDescriptor = null; // <-- AÑADE ESTA LÍNEA
let modelsLoaded = false; // <-- AÑADE ESTA LÍNEA


/**
 * Carga los modelos de IA para la detección Y RECONOCIMIENTO de rostros.
 * (VERSIÓN CORREGIDA: Carga SsdMobilenetv1)
 */
async function loadFaceAPImodels() {
    console.log("Cargando modelos de reconocimiento facial...");
    try {
        await Promise.all([
            // Cargar estos 3 modelos obligatoriamente
            faceapi.nets.ssdMobilenetv1.loadFromUri('models'),
            faceapi.nets.faceLandmark68Net.loadFromUri('models'),
            faceapi.nets.faceRecognitionNet.loadFromUri('models')
        ]);
        console.log("Modelos cargados.");
        modelsLoaded = true;
    } catch (error) {
        console.error("Error cargando IA:", error);
    }
}

/**
 * Carga los modelos de IA para la detección Y RECONOCIMIENTO de rostros.
 * (VERSIÓN CORREGIDA: Carga SsdMobilenetv1)

async function loadFaceAPImodels() {
    console.log("RECONOCIMIENTO FACIAL DESHABILITADO. Saltando carga de modelos.");
    // --- INICIO DE MODIFICACIÓN ---
    // Simplemente establecemos 'modelsLoaded' en true para no bloquear el flujo de la app
    // y para evitar intentos de detección.
    modelsLoaded = true;
    // --- FIN DE MODIFICACIÓN ---
}
*/

/**
 * (VERSIÓN CORREGIDA: Devuelve el descriptor)
 * Carga la foto de perfil y genera el descriptor facial para comparar.
 * @param {string} imageUrl - La URL de la foto de perfil del usuario.
 * @returns {Promise<Float32Array|null>} El descriptor facial o null.
 */

async function generateProfileFaceDescriptor(imageUrl) {
    if (!modelsLoaded) {
        console.warn("Los modelos de IA aún no han cargado. Saltando generación de descriptor.");
        return null;
    }

    try {
        const img = await faceapi.fetchImage(imageUrl);

        const detection = await faceapi.detectSingleFace(img)
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (detection) {
            console.log("Descriptor de perfil (huella facial) generado y guardado.");
            return detection.descriptor; // <-- CAMBIO CLAVE
        } else {
            console.warn("No se detectó un rostro en la foto de perfil. El reconocimiento facial se saltará.");
            return null; // <-- CAMBIO CLAVE
        }
    } catch (error) {
        console.error("Error al generar el descriptor de perfil:", error);
        return null; // <-- CAMBIO CLAVE
    }
}
/**
 * (VERSIÓN CORREGIDA: Devuelve el descriptor)
 * Carga la foto de perfil y genera el descriptor facial para comparar.
 * @param {string} imageUrl - La URL de la foto de perfil del usuario.
 * @returns {Promise<Float32Array|null>} El descriptor facial o null.
 
async function generateProfileFaceDescriptor(imageUrl) {
    // --- INICIO DE MODIFICACIÓN ---
    console.warn("RECONOCIMIENTO FACIAL DESHABILITADO. Omitiendo generación de descriptor.");
    return null;
    // --- FIN DE MODIFICACIÓN ---
}
*/


/**
 * Convierte un timestamp o fecha a un formato de tiempo relativo.
 * @param {number} timestamp - El timestamp en milisegundos.
 * @returns {string} - El tiempo relativo (ej: "hace 5 min").
 */
function formatTimeAgo(timestamp) {
    const now = Date.now();
    // Asegurarse de que el timestamp sea un número
    const seconds = Math.floor((now - Number(timestamp)) / 1000);

    if (isNaN(seconds) || seconds < 0) {
        return "justo ahora";
    }

    let interval = seconds / 31536000; // Años
    if (interval > 1) return `hace ${Math.floor(interval)}a`;
    interval = seconds / 2592000; // Meses
    if (interval > 1) return `hace ${Math.floor(interval)}m`;
    interval = seconds / 86400; // Días
    if (interval > 1) return `hace ${Math.floor(interval)}d`;
    interval = seconds / 3600; // Horas
    if (interval > 1) return `hace ${Math.floor(interval)}h`;
    interval = seconds / 60; // Minutos
    if (interval > 1) return `hace ${Math.floor(interval)} min`;

    return "justo ahora";
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

// --- CONFIGURACIÓN DE MÓDULOS DEL SIDEBAR ---
const SIDEBAR_CONFIG = [
    { key: 'dashboard', selector: '#dashboard-general-nav-link', label: 'Dashboard General' },
    { key: 'proyectos', selector: '#proyectos-nav-link', label: 'Proyectos' },
    { key: 'tareas', selector: 'a[data-view="tareas"]', label: 'Tareas Asignadas' },
    { key: 'herramienta', selector: 'a[data-view="herramienta"]', label: 'Herramienta' },
    { key: 'dotacion', selector: 'a[data-view="dotacion"]', label: 'Dotación' },
    { key: 'cartera', selector: 'a[data-view="cartera"]', label: 'Cartera' },
    { key: 'solicitud', selector: 'a[data-view="solicitud"]', label: 'Solicitud Material' },
    { key: 'empleados', selector: 'a[data-view="empleados"]', label: 'Empleados' },
    { key: 'proveedores', selector: 'a[data-view="proveedores"]', label: 'Proveedores' },
    { key: 'catalog', selector: 'a[data-view="catalog"]', label: 'Catálogo Materiales' },
    { key: 'compras', selector: 'a[data-view="compras"]', label: 'Órdenes Compra' },
    { key: 'reports', selector: 'a[data-view="reports"]', label: 'Reportes' },
    { key: 'adminPanel', selector: 'a[data-view="adminPanel"]', label: 'Gestionar Usuarios' },
    { key: 'configuracion', selector: '#configuracion-nav-link', label: 'Configuración' }
];

// Función auxiliar para obtener los permisos base de un rol
function getRoleDefaultPermissions(role) {
    const isAdmin = role === 'admin';
    const isBodega = role === 'bodega';
    const isSST = role === 'sst';
    const isOperario = role === 'operario';

    // Definimos la lógica base aquí (centralizada)
    return {
        dashboard: true,
        proyectos: isAdmin,
        tareas: true,
        herramienta: isAdmin || isBodega || isSST || isOperario,
        dotacion: isAdmin || isBodega || isSST || isOperario,
        cartera: isAdmin, // Ajusta según tu lógica de empleados.js si 'nomina' existe
        solicitud: true,
        empleados: isAdmin || isSST,
        proveedores: isAdmin || isBodega,
        catalog: isAdmin || isBodega,
        compras: isAdmin || isBodega,
        reports: isAdmin,
        adminPanel: isAdmin,
        configuracion: isAdmin
    };
}

// Función Principal de Visibilidad
function applySidebarPermissions(role, customPermissions = {}) {
    const defaultVisibility = getRoleDefaultPermissions(role);

    SIDEBAR_CONFIG.forEach(module => {
        const element = document.querySelector(module.selector);
        if (!element) return;

        // 1. Estado base del rol
        let shouldShow = defaultVisibility[module.key];

        // 2. Sobrescritura personalizada
        if (customPermissions[module.key] === 'show') shouldShow = true;
        if (customPermissions[module.key] === 'hide') shouldShow = false;

        // 3. Aplicar al DOM
        if (shouldShow) {
            element.classList.remove('hidden');
            // Mostrar el contenedor <li> padre si existe
            if (element.parentElement.tagName === 'LI') element.parentElement.classList.remove('hidden');
        } else {
            element.classList.add('hidden');
        }
    });
}

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
    if (!fromHistory && viewName !== 'project-details') {
        const state = { viewName: viewName };
        const title = `Gestor de Proyectos - ${viewName}`;
        const url = `#${viewName}`;
        history.pushState(state, title, url);
    }
}



async function initializePushNotifications(user) {
    try {
        // 1. Verificar soporte
        if (!('Notification' in window) || !('serviceWorker' in navigator)) {
            console.warn("Este navegador no soporta notificaciones.");
            return;
        }

        // 2. Pedir Permiso
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.warn("Permiso de notificaciones denegado.");
            return;
        }

        // --- CAMBIO IMPORTANTE AQUÍ ---

        // A. Registramos manualmente el Service Worker indicando la ruta relativa correcta
        // El punto './' es crucial, le dice que busque en la misma carpeta que el index.html
        const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');

        // B. Pasamos ese registro a getToken
        const token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: registration
        });

        // -------------------------------

        if (token) {
            console.log("FCM Token obtenido:", token);

            // 4. Guardar el Token en la base de datos del usuario
            const userRef = doc(db, "users", user.uid);
            await updateDoc(userRef, {
                fcmToken: token,
                lastTokenUpdate: new Date(),
                deviceInfo: navigator.userAgent
            });

        } else {
            console.log("No se pudo obtener el token de registro.");
        }

    } catch (error) {
        console.error("Error al inicializar notificaciones push:", error);
    }
}

// --- GESTIÓN DE PERMISOS DE INICIO ---

// 1. Función maestra que actualiza la interfaz del modal
window.updatePermissionUI = async function () {
    const updateCard = (type, isGranted) => {
        const container = document.getElementById(`perm-status-${type}`);
        const card = document.getElementById(`perm-card-${type}`);
        if (!container || !card) return;

        if (isGranted) {
            container.innerHTML = `<span class="text-green-600 font-bold text-xl"><i class="fa-solid fa-circle-check"></i></span>`;
            card.classList.remove('bg-gray-50', 'border-gray-200');
            card.classList.add('bg-green-50', 'border-green-200');
        }
    };

    // Chequeo Notificaciones
    const notifGranted = Notification.permission === 'granted';
    updateCard('notification', notifGranted);

    // Chequeo Cámara (Usamos query si el navegador lo soporta)
    try {
        const camStatus = await navigator.permissions.query({ name: 'camera' });
        updateCard('camera', camStatus.state === 'granted');
    } catch (e) {
        // Fallback si el navegador no soporta query para cámara (ej. Firefox antiguo)
        // No hacemos nada, dejamos el botón
    }

    // Chequeo Ubicación
    try {
        const locStatus = await navigator.permissions.query({ name: 'geolocation' });
        updateCard('location', locStatus.state === 'granted');
    } catch (e) { }
};

// 2. Pedir Cámara
window.requestCameraPermission = async function () {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        // Si tenemos éxito, apagamos la cámara inmediatamente (solo queríamos el permiso)
        stream.getTracks().forEach(track => track.stop());
        updatePermissionUI();
    } catch (error) {
        alert("Permiso denegado. Por favor habilita la cámara en la configuración del navegador.");
    }
};

// 3. Pedir Ubicación
window.requestLocationPermission = function () {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        (pos) => { updatePermissionUI(); },
        (err) => { alert("Permiso denegado. Habilita la ubicación en el candado de la barra de dirección."); }
    );
};

// 4. Pedir Notificaciones (Reutilizamos tu lógica existente)
window.requestPushPermission = async function () {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        // Llamamos a tu función existente que obtiene el token
        if (currentUser) initializePushNotifications(currentUser);
        updatePermissionUI();
    } else {
        alert("Permiso denegado. Habilita las notificaciones en el navegador.");
    }
};

// 5. Función que decide si abrir el modal o no al iniciar sesión
async function checkAllPermissionsOnLogin() {
    let missing = false;

    // A. Notificaciones
    if (Notification.permission !== 'granted') missing = true;

    // B. Cámara y Ubicación (Verificación asíncrona)
    try {
        const camStatus = await navigator.permissions.query({ name: 'camera' });
        if (camStatus.state !== 'granted') missing = true;

        const locStatus = await navigator.permissions.query({ name: 'geolocation' });
        if (locStatus.state !== 'granted') missing = true;
    } catch (e) {
        // Si falla la verificación (navegadores viejos), asumimos que falta para forzar el chequeo manual
        missing = true;
    }

    if (missing) {
        openMainModal('check-permissions');
    } else {
        console.log("Todos los permisos están habilitados. Continuando.");
        // Aquí podrías llamar a initializePushNotifications por si acaso el token expiró
        if (currentUser) initializePushNotifications(currentUser);
    }
}

// --- AUTENTICACIÓN ---

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDoc = await getDoc(doc(db, "users", user.uid));

        // Verificamos que el usuario exista y esté activo
        if (userDoc.exists() && userDoc.data().status === 'active') {
            currentUser = user;
            const userData = userDoc.data();
            currentUserRole = userData.role;

            // 1. Cargar mapa de usuarios (Necesario para nombres y referencias)
            await loadUsersMap();

            // --- INICIO: LÓGICA UI HEADER (NUEVO DISEÑO) ---
            const nombre = userData.firstName || 'Usuario';
            const apellido = userData.lastName || '';
            const rolFormateado = currentUserRole.charAt(0).toUpperCase() + currentUserRole.slice(1);
            const profilePhotoURL = userData.profilePhotoURL || null;
            const initials = `${nombre.charAt(0)}${apellido.charAt(0) || ''}`.toUpperCase();

            // Referencias a los elementos del nuevo header
            const nameEl = document.getElementById('header-user-name');
            const roleEl = document.getElementById('header-user-role');
            const photoEl = document.getElementById('header-profile-photo');
            const initialsEl = document.getElementById('header-profile-initials');

            // Referencias para el menú móvil (dentro del dropdown)
            const mobileNameEl = document.getElementById('mobile-user-name');
            const mobileEmailEl = document.getElementById('mobile-user-email');

            // Actualizar textos
            if (nameEl) nameEl.textContent = `${nombre} ${apellido}`;
            if (roleEl) roleEl.textContent = rolFormateado;
            if (mobileNameEl) mobileNameEl.textContent = `${nombre} ${apellido}`;
            if (mobileEmailEl) mobileEmailEl.textContent = userData.email;

            // Actualizar Foto o Iniciales
            if (photoEl && initialsEl) {
                if (profilePhotoURL) {
                    photoEl.src = profilePhotoURL;
                    photoEl.classList.remove('hidden');
                    initialsEl.classList.add('hidden');
                    // Quitar fondo gris si hay foto
                    if (photoEl.parentElement) photoEl.parentElement.classList.remove('bg-gray-200');
                } else {
                    photoEl.classList.add('hidden');
                    initialsEl.textContent = initials;
                    initialsEl.classList.remove('hidden');
                    // Poner fondo gris si son letras
                    if (photoEl.parentElement) photoEl.parentElement.classList.add('bg-gray-200');
                }
            }
            // --- FIN: LÓGICA UI HEADER ---


            // 2. Generar huella facial para validación (Biometría)
            if (profilePhotoURL) {
                try {
                    // Usamos await para asegurar que esté listo antes de que el usuario intente validar
                    currentUserFaceDescriptor = await generateProfileFaceDescriptor(profilePhotoURL);
                } catch (e) {
                    console.warn("No se pudo generar el descriptor facial:", e);
                    currentUserFaceDescriptor = null;
                }
            } else {
                console.warn("Usuario sin foto. Reconocimiento facial deshabilitado.");
                currentUserFaceDescriptor = null;
            }

            // 3. Mostrar la aplicación
            authContainer.classList.add('hidden');
            appContainer.classList.remove('hidden');

            // 4. Cargar configuración de nómina
            try {
                const payrollConfigRef = doc(db, "system", "payrollConfig");
                const payrollConfigSnap = await getDoc(payrollConfigRef);
                if (payrollConfigSnap.exists()) {
                    payrollConfig = payrollConfigSnap.data();
                } else {
                    payrollConfig = {}; // Prevenir errores si no existe
                }
            } catch (error) {
                console.error("Error cargando nómina:", error);
                payrollConfig = {};
            }

            // 5. Aplicar permisos de visualización (Sidebar)
            const userCustomPermissions = userData.customPermissions || {};
            applySidebarPermissions(currentUserRole, userCustomPermissions);

            // --- CAMBIO: Reemplazar la llamada directa por el chequeo completo ---

            // initializePushNotifications(user);  <-- BORRAR O COMENTAR ESTA LÍNEA

            // Insertar la nueva verificación:
            checkAllPermissionsOnLogin();

            // --------------------------------------------------------------------

            // 6. Cargar vista inicial...
            showGeneralDashboard();
            // requestNotificationPermission(); <-- PUEDES BORRAR ESTA LÍNEA (el modal ya se encarga)
            loadNotifications();

        } else {
            // Si el usuario no está activo o no existe, cerrar sesión forzada
            await signOut(auth);
        }
    } else {
        // Si no hay usuario logueado
        currentUser = null;
        currentUserRole = null;
        authContainer.classList.remove('hidden');
        appContainer.classList.add('hidden');
    }

    // Ocultar loader al finalizar todo el proceso
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
        
        // --- CAMBIO AQUÍ ---
        // Verificamos si el estado es 'pending' (pendiente)
        if (userDoc.exists() && userDoc.data().status === 'pending') {
            // Mensaje actualizado
            errorP.innerHTML = `<span class="font-bold">Acceso denegado:</span><br>Esperando respuesta del administrador para activar la cuenta.`;
            errorP.className = "text-orange-600 text-sm mt-4 text-center bg-orange-50 p-2 rounded border border-orange-200";
            
            await signOut(auth); // Cerramos la sesión inmediatamente
            return;
        }
        // -------------------

    } catch (error) {
        console.error("Error de inicio de sesión:", error.code);
        errorP.className = "text-red-500 text-sm mt-4 text-center"; // Reset estilo error normal
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
        activeListeners.forEach(unsubscribe => unsubscribe());
        activeListeners = [];
        await signOut(auth);
        console.log('Usuario cerró sesión exitosamente');

        // --- AGREGAR ESTA LÍNEA PARA LIMPIEZA TOTAL ---
        window.location.reload();

    } catch (error) {
        console.error('Error al cerrar sesión: ', error);
    }
}

let cameraStream = null; // Variable global para el stream de la cámara

/**
 * (NUEVA FUNCIÓN)
 * Abre el modal de la cámara y solicita acceso al dispositivo.
 * @param {string} targetInputId - El ID del input (oculto) que recibirá el archivo.
 * @param {string} targetPreviewId - El ID de la <img> que mostrará la vista previa.
 */
async function openCameraModal(targetInputId, targetPreviewId) {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-feed');
    const captureBtn = document.getElementById('camera-capture-btn');
    const cancelBtn = document.getElementById('camera-cancel-btn');

    if (!modal || !video || !captureBtn || !cancelBtn) return;

    try {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
        }
        // Pedimos la cámara trasera (environment)
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
        });
        video.srcObject = cameraStream;
        modal.style.display = 'flex';

        // Pasamos los IDs de destino a los botones
        captureBtn.dataset.targetInputId = targetInputId;
        captureBtn.dataset.targetPreviewId = targetPreviewId;

        cancelBtn.onclick = closeCameraModal;
        captureBtn.onclick = () => capturePhoto();

    } catch (err) {
        console.error("Error al acceder a la cámara:", err);
        // Si falla (ej. no hay cámara trasera), intenta con cualquier cámara
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
            video.srcObject = cameraStream;
            modal.style.display = 'flex';

            captureBtn.dataset.targetInputId = targetInputId;
            captureBtn.dataset.targetPreviewId = targetPreviewId;

            cancelBtn.onclick = closeCameraModal;
            captureBtn.onclick = () => capturePhoto();
        } catch (err2) {
            alert("No se pudo acceder a la cámara. Revisa los permisos.");
        }
    }
}

/**
 * (NUEVA FUNCIÓN)
 * Cierra el modal de la cámara y detiene el stream de video.
 */
function closeCameraModal() {
    const modal = document.getElementById('camera-modal');
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * (NUEVA FUNCIÓN)
 * Captura la foto desde el stream de video y la procesa.
 */
function capturePhoto() {
    const video = document.getElementById('camera-feed');
    const canvas = document.getElementById('camera-canvas');
    const captureBtn = document.getElementById('camera-capture-btn');
    const targetInputId = captureBtn.dataset.targetInputId;
    const targetPreviewId = captureBtn.dataset.targetPreviewId;

    // Ajustamos el canvas al tamaño del video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

    // Convertimos el canvas a un Blob (archivo)
    canvas.toBlob(async (blob) => {
        // Creamos un objeto File (como si fuera subido)
        const photoFile = new File([blob], "camera_capture.jpg", { type: "image/jpeg" });

        // Cerramos el modal
        closeCameraModal();

        // ¡Usamos la misma función que el convertidor HEIC!
        await handlePhotoFile(photoFile, targetInputId, targetPreviewId);

    }, 'image/jpeg', 0.9); // 90% de calidad
}

/**
 * (NUEVA FUNCIÓN - MODIFICADA PARA NO PROCESAR HEIC)
 * Procesa el archivo (convierte HEIC si es necesario) y actualiza la vista previa.
 * @param {File} file - El archivo (de la cámara o del input).
 * @param {string} fileInputId - El ID del input (para referencia).
 * @param {string} previewImgId - El ID de la <img> para la vista previa.
 */
async function handlePhotoFile(file, fileInputId, previewImgId) {
    const previewImg = document.getElementById(previewImgId);
    const promptEl = document.getElementById('editUser-prompt');
    const previewContainer = document.getElementById('editUser-preview');
    const statusEl = document.getElementById('editUser-photo-status'); // (ID del <p> que añadimos)

    if (!previewImg || !promptEl || !previewContainer || !statusEl) return;

    // Reinicia el estado
    processedPhotoFile = null;
    statusEl.textContent = '';
    statusEl.className = 'text-xs text-center h-4 mt-1';

    try {
        const fileType = file.type.toLowerCase();
        const fileName = file.name.toLowerCase();
        const isHEIC = fileType === 'image/heic' || fileType === 'image/heif' || fileName.endsWith('.heic') || fileName.endsWith('.heif');

        // Guardamos el archivo ORIGINAL (sea HEIC o JPG)
        processedPhotoFile = file;

        // 1. Lógica de Vista Previa
        if (isHEIC) {
            // Si es HEIC, no podemos mostrar vista previa. Mostramos un aviso.
            previewImg.src = ''; // Limpiamos la imagen anterior
            previewContainer.classList.add('hidden'); // Ocultamos el <img>
            promptEl.classList.remove('hidden'); // Mostramos el ícono de "foto"

            // Mostramos un estado de "pendiente"
            statusEl.textContent = 'Archivo HEIC. Se convertirá al guardar.';
            statusEl.className = 'text-xs text-center text-blue-600 h-4 mt-1';
        } else {
            // Si es JPG/PNG, usamos FileReader para mostrar la vista previa (rápido)
            statusEl.textContent = 'Cargando vista previa...';
            const reader = new FileReader();
            reader.onload = (event) => {
                previewImg.src = event.target.result;
                previewContainer.classList.remove('hidden');
                promptEl.classList.add('hidden');
                statusEl.textContent = 'Vista previa lista.';
                statusEl.className = 'text-xs text-center text-green-600 h-4 mt-1';
            }
            reader.readAsDataURL(file); // Leemos el archivo
        }

    } catch (err) {
        console.error("Error al procesar la foto:", err);
        statusEl.textContent = 'Error al leer el archivo.';
        statusEl.className = 'text-xs text-center text-red-600 h-4 mt-1';
        processedPhotoFile = null; // Resetea si falla
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

    // Aquí llamamos a la función para poblar el filtro de herramientas
    updateToolFilterOptions(usersMap);
    updateDotacionFilterOptions(usersMap); // <-- AÑADE ESTA LÍNEA
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

    // (La lógica de ocultar/mostrar enlaces de menú se movió a onAuthStateChanged)

    if (currentUser) {
        loadProjects();
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
 * Abre el detalle de la Orden de Compra con diseño tipo "Invoice/Factura".
 * Incluye sección destacada para facilitar el pago con QR.
 */
async function openPurchaseOrderModal(poId) {
    const modal = document.getElementById('po-details-modal');
    if (!modal) return;

    const contentContainer = document.getElementById('po-details-content');
    const actionsContainer = document.getElementById('po-details-actions');
    const modalContainer = modal.querySelector('.w-11\\/12');

    // Hacer el modal más ancho para el nuevo diseño
    if (modalContainer) {
        modalContainer.className = "w-11/12 md:max-w-5xl bg-white rounded-xl shadow-2xl transform transition-all relative flex flex-col max-h-[95vh]";
    }

    contentContainer.innerHTML = '<div class="flex justify-center items-center h-64"><div class="loader"></div></div>';
    actionsContainer.innerHTML = '';
    modal.style.display = 'flex';

    try {
        // 1. Cargar datos de PO y Proveedor
        const poRef = doc(db, "purchaseOrders", poId);
        const poSnap = await getDoc(poRef);
        if (!poSnap.exists()) throw new Error("Orden no encontrada");
        const po = { id: poSnap.id, ...poSnap.data() };

        let supplierData = {};
        if (po.supplierId) {
            const supSnap = await getDoc(doc(db, "suppliers", po.supplierId));
            if (supSnap.exists()) supplierData = supSnap.data();
        }

        const statusColors = {
            recibida: "bg-emerald-100 text-emerald-800 border-emerald-200",
            pendiente: "bg-amber-100 text-amber-800 border-amber-200",
            rechazada: "bg-rose-100 text-rose-800 border-rose-200"
        };
        const statusClass = statusColors[po.status] || "bg-gray-100 text-gray-800";
        const creationDate = po.createdAt ? po.createdAt.toDate().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }) : '---';

        // Renderizar ítems
        let itemsHtml = '';
        if (po.items && po.items.length > 0) {
            itemsHtml = po.items.map((item, idx) => `
                <tr class="border-b border-gray-50 last:border-0">
                    <td class="py-3 pl-4 text-sm text-gray-500 font-mono">${idx + 1}</td>
                    <td class="py-3 text-sm font-medium text-gray-800">
                        ${item.itemName || 'Ítem'} 
                        ${item.itemType ? `<span class="text-[10px] text-gray-400 uppercase ml-1 px-1 bg-gray-100 rounded border"> ${item.itemType} </span>` : ''}
                    </td>
                    <td class="py-3 text-center text-sm text-gray-600 font-bold">${item.quantity}</td>
                    <td class="py-3 text-right text-sm text-gray-600 font-mono">${currencyFormatter.format(item.unitCost)}</td>
                    <td class="py-3 pr-4 text-right text-sm font-bold text-gray-900 font-mono">${currencyFormatter.format(item.quantity * item.unitCost)}</td>
                </tr>
            `).join('');
        }

        // --- HTML NUEVO DISEÑO ---
        contentContainer.innerHTML = `
            <div class="flex flex-col h-full bg-gray-50/50">
                
                <div class="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-start shadow-sm relative z-10">
                    <div>
                        <div class="flex items-center gap-3 mb-1">
                             <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white"><i class="fa-solid fa-cart-shopping"></i></div>
                             <h2 class="text-2xl font-black text-gray-800 tracking-tight">Orden de Compra</h2>
                        </div>
                        <p class="text-sm text-gray-500 ml-11">#${po.poNumber || po.id.substring(0, 6).toUpperCase()}</p>
                    </div>
                    <div class="text-right">
                        <span class="px-3 py-1 rounded-full text-xs font-black uppercase border ${statusClass} mb-2 inline-block">
                            ${po.status}
                        </span>
                        <p class="text-xs text-gray-400 flex items-center justify-end gap-1"><i class="fa-regular fa-calendar"></i> ${creationDate}</p>
                    </div>
                </div>

                <div class="flex-grow overflow-y-auto custom-scrollbar p-6">
                    <div class="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
                        
                        <div class="lg:col-span-8 space-y-6">
                            <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                <p class="text-xs font-bold text-gray-400 uppercase mb-3 tracking-wide">Proveedor</p>
                                <div class="flex items-start gap-4">
                                    <div class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-bold text-lg border border-gray-200">
                                        ${(po.supplierName || 'P').charAt(0)}
                                    </div>
                                    <div>
                                        <p class="font-bold text-gray-800 text-lg leading-tight">${po.supplierName || 'Proveedor General'}</p>
                                        <p class="text-sm text-gray-500 mt-0.5">${supplierData.nit ? `NIT: ${supplierData.nit}` : ''}</p>
                                        <button class="text-xs text-blue-600 hover:underline mt-1 font-medium flex items-center gap-1" 
                                           data-action="view-supplier-details" data-id="${po.supplierId}">
                                           Ver perfil completo <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                <div class="px-4 py-3 bg-gray-50 border-b border-gray-200">
                                    <h4 class="text-xs font-bold text-gray-500 uppercase">Detalle de Ítems</h4>
                                </div>
                                <div class="overflow-x-auto">
                                    <table class="w-full text-left">
                                        <thead class="bg-white text-xs text-gray-400 uppercase border-b border-gray-100">
                                            <tr>
                                                <th class="py-2 pl-4 font-semibold">#</th>
                                                <th class="py-2 font-semibold">Descripción</th>
                                                <th class="py-2 text-center font-semibold">Cant.</th>
                                                <th class="py-2 text-right font-semibold">Unit.</th>
                                                <th class="py-2 pr-4 text-right font-semibold">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>${itemsHtml}</tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <div class="lg:col-span-4 space-y-4">
                            
                            <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <p class="text-xs font-bold text-gray-400 uppercase mb-3">Resumen Financiero</p>
                                <div class="flex justify-between items-end mb-2">
                                    <span class="text-sm text-gray-600">Total Orden</span>
                                    <span class="text-xl font-black text-gray-900">${currencyFormatter.format(po.totalCost || 0)}</span>
                                </div>
                                <div class="flex justify-between items-center text-sm mb-4 pt-2 border-t border-dashed border-gray-200">
                                    <span class="text-gray-500">Abonado</span>
                                    <span class="font-bold text-green-600">${currencyFormatter.format(po.paidAmount || 0)}</span>
                                </div>
                                <div class="w-full bg-gray-100 rounded-full h-2 mb-1">
                                    <div class="bg-blue-600 h-2 rounded-full" style="width: ${Math.min(((po.paidAmount || 0) / (po.totalCost || 1)) * 100, 100)}%"></div>
                                </div>
                                <p class="text-xs text-right text-gray-400">${Math.round(((po.paidAmount || 0) / (po.totalCost || 1)) * 100)}% Pagado</p>
                            </div>

                            <div class="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-5 text-white shadow-lg relative overflow-hidden">
                                <div class="absolute top-0 right-0 opacity-10 -mt-4 -mr-4"><i class="fa-solid fa-wallet text-9xl"></i></div>
                                
                                <h4 class="font-bold text-sm uppercase tracking-wider mb-4 flex items-center text-blue-200">
                                    <i class="fa-solid fa-money-bill-transfer mr-2"></i> Datos de Pago
                                </h4>

                                <div class="space-y-3 relative z-10">
                                    <div>
                                        <p class="text-[10px] text-slate-400 uppercase">Banco</p>
                                        <p class="font-bold text-base">${supplierData.bankName || 'No registrado'}</p>
                                    </div>
                                    <div>
                                        <p class="text-[10px] text-slate-400 uppercase">Cuenta (${supplierData.accountType || ''})</p>
                                        <div class="flex items-center gap-2">
                                            <p class="font-mono text-lg font-bold tracking-wide text-yellow-400">${supplierData.accountNumber || '---'}</p>
                                            <button onclick="navigator.clipboard.writeText('${supplierData.accountNumber}'); window.showToast('Copiado', 'success')" class="text-white/50 hover:text-white transition-colors"><i class="fa-regular fa-copy"></i></button>
                                        </div>
                                    </div>
                                </div>

                                ${supplierData.qrCodeURL ? `
                                    <div class="mt-6 pt-4 border-t border-white/10 text-center">
                                        <div class="bg-white p-1.5 rounded-lg inline-block cursor-pointer hover:scale-105 transition-transform shadow-md" onclick="window.openImageModal('${supplierData.qrCodeURL}')">
                                            <img src="${supplierData.qrCodeURL}" class="w-28 h-28 object-cover rounded">
                                        </div>
                                        <p class="text-[10px] text-slate-400 mt-2 flex items-center justify-center gap-1"><i class="fa-solid fa-qrcode"></i> Toca para ampliar</p>
                                    </div>
                                ` : '<div class="mt-4 p-3 bg-white/5 rounded text-center text-xs text-slate-400 italic border border-white/10">Sin código QR disponible</div>'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // --- Footer de Acciones ---
        actionsContainer.innerHTML = `
            <button type="button" data-action="close-details-modal" class="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 font-bold py-2.5 px-5 rounded-xl shadow-sm transition-all">
                Cerrar
            </button>
        `;

        if (po.status === 'pendiente' && (currentUserRole === 'admin' || currentUserRole === 'bodega')) {
            actionsContainer.innerHTML += `
                <button data-action="reject-purchase-order" data-id="${po.id}" class="bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 font-bold py-2.5 px-5 rounded-xl transition-all shadow-sm flex items-center">
                    <i class="fa-solid fa-trash mr-2"></i> Rechazar
                </button>
                <button data-action="receive-purchase-order" data-id="${po.id}" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-6 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center transform hover:-translate-y-0.5">
                    <i class="fa-solid fa-box-open mr-2"></i> Recibir Mercancía
                </button>
            `;
        }

    } catch (error) {
        console.error("Error modal PO:", error);
        contentContainer.innerHTML = `<div class="p-10 text-center text-red-500">Error: ${error.message}</div>`;
    }
}

function closePurchaseOrderModal() {
    const modal = document.getElementById('po-details-modal');
    if (modal) modal.style.display = 'none';
}

function loadProjects(status = 'active') {
    const projectsContainer = document.getElementById('projects-container');
    projectsContainer.innerHTML = `<div class="col-span-full flex justify-center py-12"><div class="loader"></div></div>`;

    // --- ACTUALIZACIÓN VISUAL DE PESTAÑAS (NUEVO DISEÑO) ---
    const activeTab = document.getElementById('active-projects-tab');
    const archivedTab = document.getElementById('archived-projects-tab');

    // Clases para el estado "Seleccionado" (Blanco con sombra)
    const selectedClasses = ['bg-white', 'text-indigo-600', 'shadow-sm'];
    // Clases para el estado "No Seleccionado" (Transparente gris)
    const unselectedClasses = ['text-gray-500', 'hover:text-gray-700', 'bg-transparent', 'shadow-none'];

    // Reseteamos clases base para evitar conflictos
    const baseClass = "flex-1 sm:flex-none px-4 py-1.5 text-xs font-bold rounded-md transition-all duration-200";
    activeTab.className = baseClass;
    archivedTab.className = baseClass;

    if (status === 'active') {
        activeTab.classList.add(...selectedClasses);
        archivedTab.classList.add(...unselectedClasses);
    } else {
        archivedTab.classList.add(...selectedClasses);
        activeTab.classList.add(...unselectedClasses);
    }
    // -------------------------------------------------------

    const q = query(collection(db, "projects"), where("status", "==", status));
    if (unsubscribeProjects) unsubscribeProjects();

    unsubscribeProjects = onSnapshot(q, (querySnapshot) => {
        projectsContainer.innerHTML = '';

        if (querySnapshot.empty) {
            // Diseño mejorado para el estado vacío
            projectsContainer.innerHTML = `
                <div class="col-span-full flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                    <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-400">
                        <i class="fa-regular fa-folder-open text-3xl"></i>
                    </div>
                    <h3 class="text-lg font-bold text-gray-700">No hay proyectos ${status === 'active' ? 'activos' : 'archivados'}</h3>
                    <p class="text-sm text-gray-500 mt-1">Comienza creando uno nuevo o cambia el filtro.</p>
                </div>`;
            return;
        }

        querySnapshot.forEach(doc => {
            const projectData = { id: doc.id, ...doc.data() };
            const stats = projectData.progressSummary || { totalM2: 0, executedM2: 0, totalItems: 0, executedItems: 0, executedValue: 0 };
            const progress = stats.totalM2 > 0 ? (stats.executedM2 / stats.totalM2) * 100 : 0;

            const card = createProjectCard(projectData, progress, stats);
            projectsContainer.appendChild(card);
        });

    }, (error) => {
        console.error("Error cargando proyectos: ", error);
        projectsContainer.innerHTML = '<p class="text-red-500 text-center col-span-full">Error al cargar los proyectos.</p>';
    });
}


/**
 * Crea la tarjeta de proyecto con diseño mejorado (Dirección y Fechas Claras).
 */
function createProjectCard(project, progress, stats) {
    const card = document.createElement('div');
    card.className = "bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-lg hover:border-indigo-300 transition-all duration-300 project-card group flex flex-col h-full overflow-hidden";
    card.dataset.id = project.id;
    card.dataset.name = project.name;

    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
    });

    // --- CÁLCULOS ---
    const physicalProgress = Math.min(progress, 100);
    let physicalColor = physicalProgress >= 100 ? 'bg-emerald-500' : (physicalProgress > 0 ? 'bg-blue-600' : 'bg-slate-300');

    const contractValue = project.value || 1;
    const executedValue = stats.executedValue || 0;
    const financialPercent = Math.min((executedValue / contractValue) * 100, 100);
    let financialColor = 'bg-indigo-600';
    if (financialPercent >= 100) financialColor = 'bg-emerald-500';

    const formatDate = (dateStr) => dateStr ? new Date(dateStr + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' }) : '--';

    // --- BOTONES DE ACCIÓN ---
    let actionButtons = '';
    const btnClass = "p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors border border-transparent hover:border-slate-200";

    if (project.status === 'active') {
        actionButtons = `
            <button data-action="edit-project-info" class="${btnClass}" title="Editar Info">
                <i class="fa-solid fa-pen"></i>
            </button>
            <button data-action="archive" class="${btnClass}" title="Archivar">
                <i class="fa-solid fa-box-archive"></i>
            </button>
        `;
    } else if (project.status === 'archived') {
        actionButtons = `
            <button data-action="restore" class="${btnClass} text-emerald-600 hover:bg-emerald-50" title="Restaurar">
                <i class="fa-solid fa-trash-arrow-up"></i>
            </button>
            ${currentUserRole === 'admin' ? `
                <button data-action="delete" class="${btnClass} text-red-500 hover:bg-red-50" title="Eliminar">
                    <i class="fa-solid fa-trash"></i>
                </button>` : ''}
        `;
    }

    // --- HTML TARJETA MEJORADA ---
    card.innerHTML = `
        <div class="p-5 pb-2 flex-grow">
            
            <div class="flex justify-between items-start gap-3 mb-4">
                <div class="flex gap-3 items-center overflow-hidden">
                    <div class="w-12 h-12 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl border border-indigo-100 flex-shrink-0">
                        <i class="fa-regular fa-building"></i>
                    </div>
                    <div class="min-w-0">
                        <h2 class="text-lg font-bold text-slate-800 truncate leading-tight" title="${project.name}">
                            ${project.name}
                        </h2>
                        <p class="text-xs text-slate-500 truncate flex items-center gap-1 mt-1">
                             <i class="fa-solid fa-hard-hat text-slate-400"></i> ${project.builderName || 'Sin Constructora'}
                        </p>
                    </div>
                </div>
                <button data-action="view-details" class="text-slate-300 hover:text-indigo-600 transition-colors p-1 transform hover:scale-110" title="Ir al Proyecto">
                    <i class="fa-solid fa-arrow-right-to-bracket text-xl"></i>
                </button>
            </div>
            
            <div class="mb-4">
                <p class="text-xs text-slate-400 uppercase font-bold mb-1">Ubicación</p>
                <div class="flex items-start gap-2 text-xs text-slate-600">
                    <i class="fa-solid fa-location-dot text-indigo-400 mt-0.5"></i>
                    <span class="truncate-2-lines leading-snug" title="${project.address || ''}">
                        <span class="font-semibold text-slate-700">${project.location}</span>
                        ${project.address ? `<br><span class="text-slate-500">${project.address}</span>` : ''}
                    </span>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-2 mb-4 border-t border-b border-slate-50 py-2">
                <div>
                    <p class="text-[10px] text-slate-400 uppercase font-bold">Inicio</p>
                    <p class="text-xs font-medium text-slate-700"><i class="fa-regular fa-calendar text-slate-400 mr-1"></i> ${formatDate(project.startDate)}</p>
                </div>
                <div>
                    <p class="text-[10px] text-slate-400 uppercase font-bold">Fin</p>
                    <p class="text-xs font-medium text-slate-700"><i class="fa-regular fa-flag text-slate-400 mr-1"></i> ${formatDate(project.endDate)}</p>
                </div>
            </div>

            <div class="bg-slate-50 rounded-lg p-3 border border-slate-100 mb-4 space-y-1.5">
                <div class="flex justify-between items-center">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Contrato</span>
                    <span class="text-xs font-bold text-slate-700">${currencyFormatter.format(project.value || 0)}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-[10px] font-bold text-emerald-600 uppercase tracking-wide">Ejecutado</span>
                    <span class="text-sm font-black text-emerald-600">${currencyFormatter.format(stats.executedValue || 0)}</span>
                </div>
                <div class="w-full bg-slate-200 rounded-full h-1.5 mt-1">
                    <div class="${financialColor} h-1.5 rounded-full transition-all duration-1000" style="width: ${financialPercent}%"></div>
                </div>
            </div>

            <div>
                <div class="flex justify-between items-end mb-1">
                    <span class="text-xs font-semibold text-slate-600">Avance Físico</span>
                    <span class="text-xs font-bold text-blue-600">${physicalProgress.toFixed(1)}%</span>
                </div>
                <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div class="${physicalColor} h-1.5 rounded-full transition-all duration-1000" style="width: ${physicalProgress}%"></div>
                </div>
            </div>
            
        </div>

        <div class="px-4 py-3 bg-slate-50 border-t border-slate-100 mt-auto flex justify-between items-center">
             <div class="text-xs text-slate-500 font-bold flex items-center gap-1.5">
                <i class="fa-solid fa-layer-group text-indigo-400"></i> 
                <span>${stats.executedItems}/${stats.totalItems} Ítems</span>
             </div>
             <div class="flex gap-1">
                ${actionButtons}
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

            // --- INICIO DE LA MODIFICACIÓN ---
            // La siguiente condición 'if' fue eliminada para que el 
            // administrador pueda verse a sí mismo en la lista.
            // if (userData.id !== currentUser.uid) { 
            // --- FIN DE LA MODIFICACIÓN ---

            if (filter === 'active' && isActiveOrPending) {
                usersTableBody.appendChild(createUserRow(userData));
            } else if (filter === 'archived' && userData.status === 'archived') {
                usersTableBody.appendChild(createUserRow(userData));
            }

            // (La llave de cierre del 'if' eliminado también se quitó)
        });
    });
}
let unsubscribeSuppliers = null; // Variable global para el listener de proveedores

function loadProveedoresView() {
    const tableBody = document.getElementById('suppliers-table-body');
    const searchInput = document.getElementById('supplier-search-input'); // Referencia al nuevo input

    if (!tableBody) return;

    if (unsubscribeSuppliers) unsubscribeSuppliers();

    // Variable para guardar los datos originales y filtrar sin volver a consultar la DB
    let allSuppliers = [];

    // Función interna para renderizar la tabla (reutilizable para el buscador)
    const renderTable = (suppliersData) => {
        tableBody.innerHTML = '';

        if (suppliersData.length === 0) {
            const message = searchInput.value.trim()
                ? 'No se encontraron proveedores que coincidan con la búsqueda.'
                : 'No hay proveedores registrados.';

            tableBody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center py-16">
                        <div class="flex flex-col items-center justify-center text-gray-400">
                            <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                                <i class="fa-solid fa-users-slash text-2xl text-gray-300"></i>
                            </div>
                            <p class="font-medium">${message}</p>
                        </div>
                    </td>
                </tr>`;
            return;
        }

        suppliersData.forEach(supplier => {
            const row = document.createElement('tr');
            row.className = 'bg-white border-b last:border-0 hover:bg-slate-50 transition-all group';
            const initial = (supplier.name || '?').charAt(0).toUpperCase();

            row.innerHTML = `
                <td class="px-6 py-4">
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 text-indigo-600 flex items-center justify-center text-lg font-bold border border-indigo-100 shadow-sm shrink-0">
                            ${initial}
                        </div>
                        <div class="min-w-0">
                            <p class="font-bold text-gray-800 text-sm leading-tight truncate" title="${supplier.name}">${supplier.name}</p>
                            <p class="text-xs text-gray-500 mt-0.5 font-mono flex items-center">
                                <span class="opacity-50 mr-1 text-[10px]">NIT:</span> ${supplier.nit || 'N/A'}
                            </p>
                        </div>
                    </div>
                </td>

                <td class="px-6 py-4">
                    <div class="flex flex-col">
                        <span class="text-sm font-medium text-gray-700 flex items-center gap-2">
                            <i class="fa-solid fa-user-tie text-gray-400 text-xs"></i> 
                            ${supplier.contactName || '---'}
                        </span>
                        <span class="text-xs text-gray-500 ml-5 mt-0.5 font-mono">
                            ${supplier.contactPhone || '---'}
                        </span>
                    </div>
                </td>

                <td class="px-6 py-4">
                    <div class="flex flex-col gap-1.5">
                        ${supplier.email ?
                    `<a href="mailto:${supplier.email}" class="text-xs text-blue-600 hover:underline flex items-center gap-2 font-medium"><i class="fa-solid fa-envelope text-blue-300"></i> ${supplier.email}</a>` :
                    `<span class="text-xs text-gray-400 flex items-center gap-2"><i class="fa-solid fa-envelope"></i> Sin email</span>`
                }
                        <span class="text-xs text-gray-500 flex items-center gap-2 truncate max-w-[200px]" title="${supplier.address || ''}">
                            <i class="fa-solid fa-location-dot text-gray-400"></i> ${supplier.address || '---'}
                        </span>
                    </div>
                </td>

                <td class="px-6 py-4 text-right">
                    <div class="flex justify-end items-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button data-action="edit-supplier" data-id="${supplier.id}" 
                            class="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all" 
                            title="Editar Información">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button data-action="view-supplier-details" data-id="${supplier.id}" 
                            class="pl-3 pr-2 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600 text-xs font-bold shadow-sm hover:shadow-md transition-all flex items-center gap-2 group/btn">
                            Ver Perfil 
                            <div class="bg-gray-100 group-hover/btn:bg-indigo-100 text-gray-400 group-hover/btn:text-indigo-600 rounded-md w-5 h-5 flex items-center justify-center transition-colors">
                                <i class="fa-solid fa-chevron-right text-[10px]"></i>
                            </div>
                        </button>
                    </div>
                </td>
            `;
            tableBody.appendChild(row);
        });
    };

    // Consultar Firestore en tiempo real
    const suppliersQuery = query(collection(db, "suppliers"), orderBy("name"));
    unsubscribeSuppliers = onSnapshot(suppliersQuery, (snapshot) => {
        // Actualizamos la lista maestra
        allSuppliers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Renderizamos (aplicando filtro si ya había algo escrito)
        filterAndRender();
    });

    // Lógica de Filtrado
    const filterAndRender = () => {
        const term = searchInput ? searchInput.value.toLowerCase().trim() : '';

        if (!term) {
            renderTable(allSuppliers);
            return;
        }

        const filtered = allSuppliers.filter(s => {
            const name = (s.name || '').toLowerCase();
            const nit = (s.nit || '').toLowerCase();
            const contact = (s.contactName || '').toLowerCase();
            const email = (s.email || '').toLowerCase();

            return name.includes(term) || nit.includes(term) || contact.includes(term) || email.includes(term);
        });

        renderTable(filtered);
    };

    // Listener del Input
    if (searchInput) {
        searchInput.addEventListener('input', filterAndRender);
    }
}

let currentSupplierId = null; // Variable global para saber en qué proveedor estamos
let unsubscribeSupplierPOs = null; // Listener para las órdenes de compra
let unsubscribeSupplierPayments = null; // Listener para los pagos

async function loadSupplierDetailsView(supplierId) {
    currentSupplierId = supplierId;
    showView('supplierDetails');

    const summaryContent = document.getElementById('summary-content');
    const posTableBody = document.getElementById('supplier-pos-table-body');
    const paymentsTableBody = document.getElementById('supplier-payments-table-body');

    const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

    summaryContent.innerHTML = '<div class="flex justify-center items-center h-64"><div class="loader"></div></div>';
    posTableBody.innerHTML = '';
    paymentsTableBody.innerHTML = '';

    if (unsubscribeSupplierPOs) unsubscribeSupplierPOs();
    if (unsubscribeSupplierPayments) unsubscribeSupplierPayments();

    // Configuración de pestañas internas
    const tabsContainer = document.getElementById('supplier-details-tabs');
    const tabContents = document.querySelectorAll('.supplier-tab-content');
    const newTabsContainer = tabsContainer.cloneNode(true);
    tabsContainer.parentNode.replaceChild(newTabsContainer, tabsContainer);

    newTabsContainer.addEventListener('click', (e) => {
        const button = e.target.closest('.tab-button');
        if (button) {
            newTabsContainer.querySelectorAll('.tab-button').forEach(btn => {
                btn.classList.remove('border-blue-500', 'text-blue-600');
                btn.classList.add('border-transparent', 'text-gray-500');
            });
            button.classList.remove('border-transparent', 'text-gray-500');
            button.classList.add('border-blue-500', 'text-blue-600');
            const tabName = button.dataset.tab;
            tabContents.forEach(content => content.classList.toggle('hidden', content.id !== `${tabName}-content`));
        }
    });

    try {
        const supplierRef = doc(db, "suppliers", supplierId);
        const supplierSnap = await getDoc(supplierRef);
        if (!supplierSnap.exists()) throw new Error("Proveedor no encontrado");

        const supplier = { id: supplierSnap.id, ...supplierSnap.data() };
        document.getElementById('supplier-details-name').textContent = supplier.name;

        // --- 1. TARJETA DE PERFIL (Con QR Integrado) ---
        const profileCard = `
            <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
                <div class="bg-slate-800 px-6 py-4 flex justify-between items-center">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 bg-white rounded-lg flex items-center justify-center text-slate-800 text-xl font-bold shadow">
                            ${supplier.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h2 class="text-xl font-bold text-white">${supplier.name}</h2>
                            <p class="text-slate-300 text-xs flex items-center gap-2">
                                <span><i class="fa-regular fa-id-card"></i> ${supplier.nit || 'S/N'}</span>
                                <span class="w-1 h-1 bg-slate-500 rounded-full"></span>
                                <span><i class="fa-solid fa-location-dot"></i> ${supplier.address || 'Sin dirección'}</span>
                            </p>
                        </div>
                    </div>
                    <button data-action="edit-supplier" data-id="${supplier.id}" class="text-xs bg-white/10 hover:bg-white/20 text-white font-bold py-2 px-4 rounded transition-colors">
                        <i class="fa-solid fa-pen-to-square mr-1"></i> Editar
                    </button>
                </div>
                
                <div class="p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div class="space-y-3 border-r border-gray-100 pr-4">
                        <h5 class="text-xs font-bold text-gray-400 uppercase tracking-wide">Contacto</h5>
                        <div>
                            <p class="text-sm font-bold text-gray-800">${supplier.contactName || '---'}</p>
                            <p class="text-xs text-gray-500">Encargado</p>
                        </div>
                        <div class="flex items-center gap-2 text-sm text-gray-600">
                            <i class="fa-solid fa-phone text-gray-300 w-5"></i> ${supplier.contactPhone || '---'}
                        </div>
                        <div class="flex items-center gap-2 text-sm text-gray-600">
                            <i class="fa-solid fa-envelope text-gray-300 w-5"></i> ${supplier.email || '---'}
                        </div>
                    </div>

                    <div class="space-y-3">
                        <h5 class="text-xs font-bold text-gray-400 uppercase tracking-wide">Información Bancaria</h5>
                        <div>
                            <p class="text-sm font-bold text-indigo-700">${supplier.bankName || 'Banco no registrado'}</p>
                            <p class="text-xs text-gray-500">${supplier.accountType || 'Cuenta'}</p>
                        </div>
                        <div class="flex items-center gap-2 bg-gray-50 p-2 rounded border border-gray-100 w-fit">
                            <span class="font-mono text-sm font-bold text-gray-700 select-all">${supplier.accountNumber || '---'}</span>
                            <button onclick="navigator.clipboard.writeText('${supplier.accountNumber}'); window.showToast('Copiado', 'success')" class="text-indigo-500 hover:text-indigo-700" title="Copiar">
                                <i class="fa-regular fa-copy"></i>
                            </button>
                        </div>
                    </div>

                    <div class="flex flex-col items-center justify-center pl-4 border-l border-gray-100">
                        ${supplier.qrCodeURL ? `
                            <div class="relative group cursor-pointer" onclick="window.openImageModal('${supplier.qrCodeURL}')">
                                <img src="${supplier.qrCodeURL}" class="w-24 h-24 object-cover rounded-lg border-2 border-dashed border-indigo-200 shadow-sm group-hover:border-indigo-500 transition-all">
                                <div class="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/10 transition-all rounded-lg">
                                    <i class="fa-solid fa-expand text-white opacity-0 group-hover:opacity-100 drop-shadow-md"></i>
                                </div>
                            </div>
                            <p class="text-[10px] text-indigo-500 mt-2 font-bold uppercase">Escanear QR</p>
                        ` : `
                            <div class="w-24 h-24 border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center text-gray-300">
                                <i class="fa-solid fa-qrcode text-2xl mb-1"></i>
                                <span class="text-[9px]">Sin QR</span>
                            </div>
                        `}
                    </div>
                </div>
            </div>`;

        // --- CÁLCULO DE SALDOS (Sin cambios) ---
        const allPOsQuery = query(collection(db, "purchaseOrders"), where("supplierId", "==", supplierId));
        const allPaymentsQuery = query(collection(db, "suppliers", supplierId, "payments"));
        const [poSnapshot, paymentsSnap] = await Promise.all([getDocs(allPOsQuery), getDocs(allPaymentsQuery)]);
        const totalBilled = poSnapshot.docs.reduce((sum, doc) => sum + (doc.data().totalCost || 0), 0);
        const totalPaid = paymentsSnap.docs.reduce((sum, doc) => sum + (doc.data().amount || 0), 0);
        const saldo = totalBilled - totalPaid;

        const balanceCards = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex items-center gap-4">
                    <div class="p-3 bg-blue-50 text-blue-600 rounded-full text-xl"><i class="fa-solid fa-file-invoice"></i></div>
                    <div><p class="text-xs font-bold text-gray-400 uppercase">Total Facturado</p><h3 class="text-xl font-black text-gray-800">${currencyFormatter.format(totalBilled)}</h3></div>
                </div>
                <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex items-center gap-4">
                    <div class="p-3 bg-green-50 text-green-600 rounded-full text-xl"><i class="fa-solid fa-check-circle"></i></div>
                    <div><p class="text-xs font-bold text-gray-400 uppercase">Total Pagado</p><h3 class="text-xl font-black text-green-600">${currencyFormatter.format(totalPaid)}</h3></div>
                </div>
                <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex items-center gap-4">
                    <div class="p-3 ${saldo > 100 ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-400'} rounded-full text-xl"><i class="fa-solid fa-scale-unbalanced"></i></div>
                    <div><p class="text-xs font-bold text-gray-400 uppercase">Saldo Pendiente</p><h3 class="text-xl font-black ${saldo > 100 ? 'text-red-600' : 'text-gray-400'}">${currencyFormatter.format(saldo)}</h3></div>
                </div>
            </div>
        `;

        // Inyectamos el contenido
        summaryContent.innerHTML = profileCard + balanceCards;

        // --- 2. Pestaña ÓRDENES ---
        const poQuery = query(collection(db, "purchaseOrders"), where("supplierId", "==", supplierId), orderBy("createdAt", "desc"));
        unsubscribeSupplierPOs = onSnapshot(poQuery, (snapshot) => {
            posTableBody.innerHTML = '';
            if (snapshot.empty) {
                posTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-gray-400">No hay órdenes de compra registradas.</td></tr>`;
                return;
            }
            snapshot.forEach(doc => {
                const po = { id: doc.id, ...doc.data() };
                const row = document.createElement('tr');
                row.className = "bg-white hover:bg-gray-50 border-b last:border-0 transition-colors group";

                let statusBadge = '';
                if (po.status === 'recibida') statusBadge = '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-200"><i class="fa-solid fa-check mr-1"></i> Recibida</span>';
                else if (po.status === 'rechazada') statusBadge = '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200"><i class="fa-solid fa-ban mr-1"></i> Rechazada</span>';
                else statusBadge = '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-800 border border-orange-200"><i class="fa-regular fa-clock mr-1"></i> Pendiente</span>';

                const progress = po.totalCost > 0 ? ((po.paidAmount || 0) / po.totalCost) * 100 : 0;
                const progressColor = progress >= 100 ? 'bg-green-500' : 'bg-yellow-400';

                row.innerHTML = `
                    <td class="px-6 py-4">
                        <p class="font-bold text-gray-800 text-sm">Orden #${po.poNumber || po.id.substring(0, 6)}</p>
                        <p class="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><i class="fa-regular fa-calendar"></i> ${po.createdAt.toDate().toLocaleDateString('es-CO')}</p>
                    </td>
                    <td class="px-6 py-4 text-right font-bold text-gray-800 text-sm">
                        ${currencyFormatter.format(po.totalCost || 0)}
                    </td>
                    <td class="px-6 py-4 text-center">
                        <div class="flex flex-col items-center justify-center w-24 mx-auto">
                            <div class="w-full bg-gray-200 rounded-full h-1.5 mb-1">
                                <div class="${progressColor} h-1.5 rounded-full" style="width: ${Math.min(progress, 100)}%"></div>
                            </div>
                            <span class="text-[10px] text-gray-500 font-semibold">${progress.toFixed(0)}% Pagado</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-center">
                        ${statusBadge}
                    </td>
                    <td class="px-6 py-4 text-center">
                        <button data-action="view-purchase-order" data-id="${po.id}" 
                            class="text-gray-400 hover:text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-all" title="Ver Detalle">
                            <i class="fa-solid fa-eye text-lg"></i>
                        </button>
                    </td>
                `;
                posTableBody.appendChild(row);
            });
        });

        // --- 3. Pestaña PAGOS ---
        const paymentsQuery = query(collection(db, "suppliers", supplierId, "payments"), orderBy("date", "desc"));
        unsubscribeSupplierPayments = onSnapshot(paymentsQuery, (snapshot) => {
            paymentsTableBody.innerHTML = '';
            if (snapshot.empty) {
                paymentsTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-12 text-gray-400">No hay pagos registrados.</td></tr>`;
                return;
            }
            snapshot.forEach(doc => {
                const p = { id: doc.id, ...doc.data() };
                const row = document.createElement('tr');
                row.className = "bg-white hover:bg-gray-50 border-b last:border-0 transition-colors";

                let methodIcon = 'fa-money-bill';
                let methodClass = 'text-gray-500 bg-gray-100';
                if (p.paymentMethod === 'Transferencia') { methodIcon = 'fa-building-columns'; methodClass = 'text-indigo-600 bg-indigo-50'; }
                if (p.paymentMethod === 'Tarjeta') { methodIcon = 'fa-credit-card'; methodClass = 'text-purple-600 bg-purple-50'; }

                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-600 font-medium">
                        ${new Date(p.date + 'T00:00:00').toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td class="px-6 py-4">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-lg ${methodClass} flex items-center justify-center flex-shrink-0">
                                <i class="fa-solid ${methodIcon} text-xs"></i>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-sm font-medium text-gray-700">${p.paymentMethod || 'Desconocido'}</span>
                                <span class="text-xs text-gray-400 truncate max-w-[150px]" title="${p.note || ''}">${p.note || ''}</span>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-right font-bold text-green-600 text-sm">
                        ${currencyFormatter.format(p.amount || 0)}
                    </td>
                    <td class="px-6 py-4 text-center">
                        <button data-action="delete-supplier-payment" data-id="${p.id}" 
                            class="text-gray-400 hover:text-red-600 p-2 rounded-full hover:bg-red-50 transition-all" title="Eliminar Pago">
                            <i class="fa-regular fa-trash-can"></i>
                        </button>
                    </td>
                `;
                paymentsTableBody.appendChild(row);
            });
        });

    } catch (error) {
        console.error("Error detalle proveedor:", error);
        summaryContent.innerHTML = `<div class="p-8 text-center text-red-500 bg-red-50 rounded-xl border border-red-100"><i class="fa-solid fa-triangle-exclamation text-3xl mb-2"></i><p>Error: ${error.message}</p></div>`;
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


/**
 * Carga la pestaña de "Información General" en la vista de detalles del proyecto.
 * Rellena los campos de resumen financiero, fechas y avance.
 */
async function loadProjectInfoTab() {
    if (!currentProject) return;

    // --- Referencias a los elementos del DOM (basado en index.html) ---
    const infoInitialContract = document.getElementById('info-initial-contract-value');
    const infoContracted = document.getElementById('info-contracted-value');
    const infoExecuted = document.getElementById('info-executed-value');
    const pricingModelEl = document.getElementById('project-details-pricingModel');

    const startDateEl = document.getElementById('project-details-startDate');
    const kickoffDateEl = document.getElementById('project-kickoffDate');
    const endDateEl = document.getElementById('project-endDate');

    const anticipoTotalEl = document.getElementById('info-anticipo-total');
    const anticipoAmortizadoEl = document.getElementById('info-anticipo-amortizado');
    const anticipoPorAmortizarEl = document.getElementById('info-anticipo-por-amortizar');

    const installedItemsEl = document.getElementById('project-details-installedItems');
    const executedM2El = document.getElementById('project-details-executedM2');

    try {
        // --- 1. Obtener Resumen de Avance (usamos el pre-calculado) ---
        const stats = currentProject.progressSummary || { totalM2: 0, executedM2: 0, totalItems: 0, executedItems: 0, executedValue: 0 };

        // --- 2. Calcular Valor Contratado (Ítems) ---
        const contractedValue = await calculateProjectContractedValue(currentProject.id);

        // --- 3. Calcular Amortización ---
        const paymentsQuery = query(collection(db, "projects", currentProject.id, "payments"));
        const paymentsSnapshot = await getDocs(paymentsQuery);
        const allPayments = paymentsSnapshot.docs.map(doc => doc.data());

        const totalAnticipo = currentProject.advance || 0;
        const anticipoPayments = allPayments.filter(p => p.type === 'abono_anticipo' || p.type === 'amortizacion_anticipo');
        const totalAmortizado = anticipoPayments.reduce((sum, p) => sum + p.amount, 0);

        // --- 4. Rellenar los campos ---
        if (infoInitialContract) infoInitialContract.textContent = currencyFormatter.format(currentProject.value || 0);
        if (infoContracted) infoContracted.textContent = currencyFormatter.format(contractedValue);
        if (infoExecuted) infoExecuted.textContent = currencyFormatter.format(stats.executedValue || 0);

        if (pricingModelEl) {
            pricingModelEl.textContent = currentProject.pricingModel === 'incluido'
                ? 'Suministro e Instalación (Incluido)'
                : 'Suministro e Instalación (Separado)';
        }

        if (startDateEl) startDateEl.textContent = currentProject.startDate ? new Date(currentProject.startDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A';
        if (kickoffDateEl) kickoffDateEl.textContent = currentProject.kickoffDate ? new Date(currentProject.kickoffDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A';
        if (endDateEl) endDateEl.textContent = currentProject.endDate ? new Date(currentProject.endDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A';

        if (anticipoTotalEl) anticipoTotalEl.textContent = currencyFormatter.format(totalAnticipo);
        if (anticipoAmortizadoEl) anticipoAmortizadoEl.textContent = currencyFormatter.format(totalAmortizado);
        if (anticipoPorAmortizarEl) anticipoPorAmortizarEl.textContent = currencyFormatter.format(totalAnticipo - totalAmortizado);

        if (installedItemsEl) installedItemsEl.textContent = `${stats.executedItems} / ${stats.totalItems}`;
        if (executedM2El) executedM2El.textContent = `${stats.executedM2.toFixed(2)} m² / ${stats.totalM2.toFixed(2)} m²`;

    } catch (error) {
        console.error("Error al cargar la pestaña de Información General:", error);
        // Opcional: Rellenar con texto de error
        if (infoContracted) infoContracted.textContent = "Error";
    }
}

/**
 * Muestra la vista de detalles del proyecto.
 * Acepta un objeto de proyecto (desde el dashboard) O un projectId (desde notificaciones).
 * @param {object | null} project - El objeto del proyecto (si está cargado).
 * @param {string} [defaultTabOrProjectId] - La pestaña a abrir, O el ID del proyecto si 'project' es nulo.
 * @param {string} [openTaskId] - (Opcional) El ID de una tarea para abrir automáticamente.
 */
async function showProjectDetails(project, defaultTabOrProjectId = 'info-general', openTaskId = null, fromHistory = false) {

    // IDs de tu index.html
    const projectTitle = document.getElementById('project-details-name');
    const projectBuilder = document.getElementById('project-details-builder');

    showView('project-details'); // <-- Esto necesita la corrección del Paso 3

    if (!fromHistory) {
        const state = {
            viewName: 'project-details',
            projectId: project.id // <-- Guardamos el ID del proyecto
        };
        const title = `Proyecto - ${project.name}`;
        // Usamos el ID en la URL para que se pueda compartir
        const url = `#project-details/${project.id}`;
        history.pushState(state, title, url);
    }

    loadingOverlay.classList.remove('hidden');

    let defaultTab = 'info-general';

    try {
        // Lógica de Carga (sin cambios)
        if (project && typeof project === 'object') {
            console.log("Cargando proyecto desde objeto (Dashboard)");
            defaultTab = defaultTabOrProjectId;
        }
        else if (project === null && typeof defaultTabOrProjectId === 'string') {
            const projectId = defaultTabOrProjectId;
            console.log(`Cargando proyecto desde ID (Notificación): ${projectId}`);

            const projectDoc = await getDoc(doc(db, "projects", projectId));
            if (projectDoc.exists()) {
                project = { id: projectDoc.id, ...projectDoc.data() };
            } else {
                throw new Error("El proyecto no existe.");
            }

        } else {
            throw new Error("No se proporcionó proyecto ni ID de proyecto.");
        }

        currentProject = { id: project.id, ...project };

        if (projectTitle) {
            projectTitle.textContent = currentProject.name;
        }
        if (projectBuilder) {
            projectBuilder.textContent = currentProject.builderName || 'Constructora no especificada';
        }

        materialRequestReturnContext = { view: 'proyecto-detalle', projectId: currentProject.id };

        setupResponsiveTabs();

        // --- INICIO DE LA CORRECCIÓN DE LLAMADAS A FUNCIONES ---

        // Cargar pestañas
        loadProjectInfoTab(); // <--- Esta es la función del Paso 1

        loadItems(currentProject.id); // Esta ya existía y estaba bien

        // CORREGIDO: 'loadMaterialsTab' espera el objeto completo, no solo el ID.
        loadMaterialsTab(currentProject);

        loadCortes(currentProject); // Esta ya estaba bien
        loadPayments(currentProject); // Esta ya estaba bien

        // CORREGIDO: Tu función se llama 'loadPeopleOfInterest' (sin Tab)
        loadPeopleOfInterest(currentProject.id);

        // CORREGIDO: Tu función se llama 'renderInteractiveDocumentCards'
        renderInteractiveDocumentCards(currentProject.id);

        // --- FIN DE LA CORRECCIÓN DE LLAMADAS A FUNCIONES ---


        // Lógica de 'openTaskId' (sin cambios)
        if (openTaskId) {
            switchProjectTab('items');
            console.log(`Abriendo tarea ${openTaskId} desde la notificación...`);
            setTimeout(() => {
                openTaskDetailsModal(openTaskId);
            }, 500);
        } else {
            switchProjectTab(defaultTab);
        }
        // --- FIN DE LÓGICA ---

    } catch (error) {
        console.error("Error al mostrar detalles del proyecto:", error);
        showView('proyectos');
    } finally {
        loadingOverlay.classList.add('hidden');
    }
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

        const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });

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

// Función auxiliar para obtener datos de empresa
async function getCompanyData() {
    try {
        const docRef = doc(db, "system", "generalConfig");
        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
            return snapshot.data().empresa || {};
        }
    } catch (error) {
        console.error("Error cargando datos de empresa:", error);
    }
    // Valores por defecto si falla la carga o no hay config
    return {
        nombre: "Vidrios Éxito S.A.S", 
        nit: "",
        logoURL: null
    };
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
    accordionContainer.innerHTML = '<div class="text-center py-10"><div class="loader mx-auto"></div><p class="text-gray-500 mt-2">Analizando ítems...</p></div>';

    // Validación de estados (Asegúrate que tus ítems tengan EXACTAMENTE estos estados en la BD)
    const validStates = type === 'nosotros'
        ? ['Instalado', 'Suministrado']
        : ['Instalado'];

    description.textContent = type === 'nosotros'
        ? "Selecciona los sub-ítems suministrados o instalados para incluir en el corte."
        : "Selecciona los sub-ítems que la obra va a pagar en este corte.";

    try {
        // --- CORRECCIÓN CLAVE AQUÍ ---
        // Usamos collectionGroup para buscar en las subcolecciones anidadas
        const subItemsQuery = query(
            collectionGroup(db, "subItems"),
            where("projectId", "==", currentProject.id),
            where("status", "in", validStates)
        );

        const subItemsSnapshot = await getDocs(subItemsQuery);
        const allValidSubItems = subItemsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        // Debug: Verificación en consola
        console.log(`Encontrados ${allValidSubItems.length} sub-ítems con estado ${validStates.join(' o ')}`);

        // 2. Obtener sub-ítems que ya están en cortes aprobados (o preliminares, para no duplicar)
        // Sugerencia: Filtra también los 'preliminar' para que no los agregues a dos cortes al tiempo
        const cortesQuery = query(collection(db, "projects", currentProject.id, "cortes"), where("status", "in", ["aprobado", "preliminar"]));
        const cortesSnapshot = await getDocs(cortesQuery);
        const subItemsInCortes = new Set();
        cortesSnapshot.forEach(corteDoc => {
            corteDoc.data().subItemIds?.forEach(id => subItemsInCortes.add(id));
        });

        // 3. Filtrar: (Todos los válidos) - (Los que ya tienen corte)
        const availableSubItems = allValidSubItems.filter(subItem => !subItemsInCortes.has(subItem.id));

        if (availableSubItems.length === 0) {
            accordionContainer.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <i class="fa-solid fa-clipboard-check text-3xl mb-2 text-gray-300"></i>
                    <p>No hay nuevos sub-ítems disponibles para cortar.</p>
                    <p class="text-xs mt-1">(Verifica que los ítems estén en estado "Instalado" o "Suministrado")</p>
                </div>`;
            return;
        }

        // 4. Agrupar sub-ítems por su ítem padre
        const groupedByItem = new Map();
        availableSubItems.forEach(si => {
            if (!groupedByItem.has(si.itemId)) {
                groupedByItem.set(si.itemId, []);
            }
            groupedByItem.get(si.itemId).push(si);
        });

        // 5. Obtener datos de los ítems padres (Optimizado con 'documentId')
        const itemIds = Array.from(groupedByItem.keys());
        if (itemIds.length === 0) return; // Seguridad

        // Firestore 'in' soporta máximo 10, si tienes más, debes hacer lotes o traer todo el proyecto
        // Como es un proyecto específico, es mejor traer todos los ítems del proyecto una sola vez si son muchos
        // O usar el método de batches. Aquí uso la consulta directa asumiendo <10 grupos por corte usualmente.
        const itemsSnapshot = await getDocs(query(collection(db, "projects", currentProject.id, "items"), where(documentId(), "in", itemIds.slice(0, 10))));

        const itemsMap = new Map(itemsSnapshot.docs.map(d => [d.id, d.data()]));

        // 6. Construir el acordeón
        accordionContainer.innerHTML = '';
        itemsMap.forEach((item, itemId) => {
            const subItems = groupedByItem.get(itemId);
            // Ordenar numéricamente (1, 2, 10 en lugar de 1, 10, 2)
            subItems.sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0));

            const accordionItem = document.createElement('div');
            accordionItem.className = 'border border-gray-200 rounded-lg mb-2 overflow-hidden';
            accordionItem.innerHTML = `
                <div class="accordion-header flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors">
                    <label class="flex items-center space-x-3 font-semibold text-gray-700 cursor-pointer select-none">
                        <input type="checkbox" class="corte-item-select-all w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500">
                        <span>${item.name} <span class="text-xs font-normal text-gray-500 ml-1">(${subItems.length} unds)</span></span>
                    </label>
                    <svg class="h-5 w-5 text-gray-400 transition-transform transform" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                </div>
                <div class="accordion-content hidden bg-white divide-y divide-gray-100">
                    ${subItems.map(si => `
                        <label class="flex items-center justify-between p-3 hover:bg-gray-50 cursor-pointer">
                            <div class="flex items-center space-x-3">
                                <input type="checkbox" class="corte-subitem-checkbox w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500" data-subitem-id="${si.id}" data-item-id="${si.itemId}">
                                <span class="text-sm text-gray-700">Unidad <strong>#${si.number}</strong></span>
                            </div>
                            <span class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">${si.location || 'Sin ubicación'}</span>
                        </label>
                    `).join('')}
                </div>
            `;
            accordionContainer.appendChild(accordionItem);
        });

    } catch (error) {
        console.error("Error al preparar la selección de corte:", error);
        accordionContainer.innerHTML = `<p class="text-red-500 text-center py-4">Error de consulta: Revisa la consola (posible falta de índice).</p>`;
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

                const allItemsQuery = query(collection(db, "projects", currentProject.id, "items"));
                const allSubItemsQuery = query(collectionGroup(db, "subItems"), where("projectId", "==", currentProject.id));
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
async function showCorteDetails(corteData) {
    currentCorte = corteData;
    showView('corteDetails');

    const titleEl = document.getElementById('corte-details-title');
    const summaryEl = document.getElementById('corte-details-summary');
    const listContainer = document.getElementById('corte-details-list');

    // FORMATO DE MONEDA
    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });

    // 1. PREPARAR DATOS DEL ENCABEZADO
    const dateStr = corteData.createdAt ? new Date(corteData.createdAt.seconds * 1000).toLocaleDateString('es-CO') : 'N/A';
    
    // Badge de Estado
    const statusBadge = corteData.status === 'aprobado' 
        ? '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-green-100 text-green-700 border border-green-200 shadow-sm"><i class="fa-solid fa-check-circle mr-1"></i> Aprobado</span>'
        : '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-amber-100 text-amber-700 border border-amber-200 shadow-sm"><i class="fa-solid fa-clock mr-1"></i> Preliminar</span>';

    // Badge de Tipo de Corte (Final o Parcial)
    const finalBadge = corteData.isFinal 
        ? '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-red-100 text-red-700 border border-red-200 shadow-sm"><i class="fa-solid fa-flag-checkered mr-1"></i> Corte Final</span>' 
        : '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-blue-50 text-blue-600 border border-blue-100 shadow-sm"><i class="fa-solid fa-arrows-rotate mr-1"></i> Corte Parcial</span>';

    // Badge de Medidas (Reales o Contrato)
    const measureBadge = corteData.usadoMedidaReal
        ? '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-purple-100 text-purple-700 border border-purple-200 shadow-sm"><i class="fa-solid fa-ruler-combined mr-1"></i> Medidas Reales</span>'
        : '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-gray-100 text-gray-600 border border-gray-200 shadow-sm"><i class="fa-solid fa-file-contract mr-1"></i> Medidas Contrato</span>';

    // Badge de Origen (Quién lo hizo) - Opcional si tienes la propiedad 'type'
    const originBadge = corteData.type === 'obra'
        ? '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-orange-100 text-orange-700 border border-orange-200 shadow-sm"><i class="fa-solid fa-hard-hat mr-1"></i> Reporte de Obra</span>'
        : '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-sm"><i class="fa-solid fa-building-user mr-1"></i> Reporte Interno</span>';


    // 2. INYECTAR HTML DEL ENCABEZADO
    titleEl.innerHTML = `
        <div class="flex flex-col gap-3">
            <div class="flex items-center gap-3">
                <div class="p-3 bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-xl shadow-md">
                    <i class="fa-solid fa-file-invoice-dollar text-2xl"></i>
                </div>
                <div>
                    <span class="text-2xl font-black text-gray-900 tracking-tight">Corte de Obra #${corteData.corteNumber}</span>
                    <p class="text-xs text-gray-500 font-medium flex items-center gap-1 mt-0.5">
                        <i class="fa-regular fa-calendar"></i> Generado el: ${dateStr}
                    </p>
                </div>
            </div>
            <div class="flex flex-wrap gap-2 pl-1">
                ${statusBadge}
                ${finalBadge}
                ${measureBadge}
                ${originBadge}
            </div>
        </div>
    `;

    // 3. RESUMEN FINANCIERO (Tarjetas)
    summaryEl.innerHTML = `
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6 mt-6">
            <div class="p-4 grid grid-cols-1 md:grid-cols-3 gap-6">
                
                <div class="flex flex-col justify-center p-4 rounded-xl border border-gray-100 bg-gray-50/50">
                    <p class="text-xs text-gray-400 uppercase font-bold mb-1">Valor Bruto (Ejecutado)</p>
                    <p class="text-xl font-bold text-gray-800">${currencyFormatter.format(corteData.totalValue || 0)}</p>
                </div>

                <div class="space-y-2 p-4 rounded-xl border border-red-100 bg-red-50/30">
                    <p class="text-xs text-red-800 uppercase font-bold mb-2 flex items-center"><i class="fa-solid fa-minus-circle mr-1"></i> Deducciones y Amortización</p>
                    <div class="flex justify-between text-sm text-red-700 border-b border-red-100/50 pb-1">
                        <span>Amortización Anticipo:</span>
                        <span class="font-medium">${currencyFormatter.format(corteData.amortizacion || 0)}</span>
                    </div>
                    ${(corteData.otrosDescuentos || []).map(d => `
                        <div class="flex justify-between text-sm text-red-600">
                            <span class="truncate max-w-[150px]" title="${d.concept}">${d.concept}:</span>
                            <span class="font-medium">${currencyFormatter.format(d.value)}</span>
                        </div>
                    `).join('')}
                </div>

                <div class="flex flex-col justify-center p-4 rounded-xl border border-emerald-200 bg-emerald-50 relative overflow-hidden group">
                    <div class="absolute right-0 top-0 p-2 text-emerald-200 opacity-40 group-hover:opacity-60 transition-opacity transform group-hover:scale-110"><i class="fa-solid fa-money-bill-1-wave text-5xl"></i></div>
                    <p class="text-xs text-emerald-800 uppercase font-bold mb-1 relative z-10">Total Neto a Pagar</p>
                    <p class="text-3xl font-black text-emerald-700 relative z-10 tracking-tight">${currencyFormatter.format(corteData.netoAPagar || 0)}</p>
                </div>
            </div>
        </div>
    `;

    // 4. CARGA DE ÍTEMS (Lógica existente mejorada con Grid)
    listContainer.innerHTML = `<div class="loader-container py-10"><div class="loader"></div><p class="text-center text-gray-400 text-sm mt-2">Cargando detalle de ítems...</p></div>`;

    try {
        const [itemsSnapshot, subItemsSnapshot] = await Promise.all([
            getDocs(query(collection(db, "projects", currentProject.id, "items"))),
            getDocs(query(collectionGroup(db, "subItems"), where("projectId", "==", currentProject.id)))
        ]);
        const itemsMap = new Map(itemsSnapshot.docs.map(doc => [doc.id, doc.data()]));
        const subItemsMap = new Map(subItemsSnapshot.docs.map(doc => [doc.id, doc.data()]));

        listContainer.innerHTML = '';

        if (!corteData.subItemIds || corteData.subItemIds.length === 0) {
            listContainer.innerHTML = `
                <div class="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
                    <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                        <i class="fa-solid fa-box-open text-gray-300 text-3xl"></i>
                    </div>
                    <p class="text-gray-500 font-medium">Este corte no tiene ítems asociados.</p>
                </div>`;
            return;
        }

        const itemsGrid = document.createElement('div');
        itemsGrid.className = "grid grid-cols-1 lg:grid-cols-2 gap-4";
        listContainer.appendChild(itemsGrid);

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

            const installerData = usersMap.get(subItem.installer);
            const installerName = installerData ? `${installerData.firstName} ${installerData.lastName}` : 'N/A';

            let statusText = subItem.status || 'Pendiente';
            let statusBadgeClass = 'bg-gray-100 text-gray-600 border-gray-200';
            if(statusText === 'Instalado') statusBadgeClass = 'bg-emerald-100 text-emerald-700 border-emerald-200';
            
            const itemCard = document.createElement('div');
            itemCard.className = 'bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col hover:shadow-md transition-shadow';
            
            itemCard.innerHTML = `
                <div class="px-4 py-3 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                    <div class="min-w-0 pr-2">
                        <p class="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-0.5 truncate" title="${parentItem.name}">
                            <i class="fa-solid fa-layer-group mr-1"></i> ${parentItem.name}
                        </p>
                        <p class="font-bold text-gray-800 text-sm">Unidad #${subItem.number}</p>
                    </div>
                    <span class="px-2 py-0.5 text-[10px] font-bold uppercase rounded border flex-shrink-0 ${statusBadgeClass}">${statusText}</span>
                </div>

                <div class="p-4 flex gap-4">
                    <div class="flex-grow space-y-2 text-sm">
                        <div class="flex justify-between items-center">
                            <span class="text-gray-500 text-xs"><i class="fa-solid fa-location-dot w-4 text-center mr-1"></i> Ubicación:</span>
                            <span class="font-medium text-gray-800 text-right truncate max-w-[140px]" title="${subItem.location}">${subItem.location || 'N/A'}</span>
                        </div>
                        
                        <div class="flex justify-between items-center">
                            <span class="text-gray-500 text-xs"><i class="fa-solid fa-ruler-combined w-4 text-center mr-1"></i> Medidas:</span>
                            <span class="font-medium text-gray-800 text-right font-mono bg-gray-50 px-1.5 rounded border border-gray-100 text-xs">
                                ${(subItem.realWidth * 100).toFixed(0)} x ${(subItem.realHeight * 100).toFixed(0)} cm
                            </span>
                        </div>

                        <div class="flex justify-between items-center">
                            <span class="text-gray-500 text-xs"><i class="fa-solid fa-user-gear w-4 text-center mr-1"></i> Instalador:</span>
                            <span class="font-medium text-gray-800 text-right truncate max-w-[140px]" title="${installerName}">${installerName}</span>
                        </div>
                        
                        <div class="pt-2 mt-1 border-t border-dashed border-gray-100 flex justify-between items-end">
                            <span class="text-xs text-gray-400 font-medium">Valor en Corte</span>
                            <span class="text-base font-bold text-green-600 leading-none">${currencyFormatter.format(valorSubItemEnCorte)}</span>
                        </div>
                    </div>

                    <div class="flex-shrink-0 w-20 h-20">
                        <div class="w-full h-full bg-gray-100 rounded-lg border border-gray-200 overflow-hidden relative group cursor-pointer shadow-inner">
                            ${subItem.photoURL ? 
                                `<img src="${subItem.photoURL}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" data-action="view-image">
                                 <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
                                    <i class="fa-solid fa-magnifying-glass-plus text-white opacity-0 group-hover:opacity-100 drop-shadow-md"></i>
                                 </div>` 
                                : `<div class="w-full h-full flex flex-col items-center justify-center text-gray-300">
                                     <i class="fa-regular fa-image text-xl"></i>
                                     <span class="text-[9px] mt-1">Sin Foto</span>
                                   </div>`
                            }
                        </div>
                    </div>
                </div>
            `;
            itemsGrid.appendChild(itemCard);
        }
    } catch (error) {
        console.error("Error al cargar detalles del corte:", error);
        listContainer.innerHTML = `<p class="text-red-500 text-center py-4">Error al cargar detalles.</p>`;
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
/**
 * Genera una memoria de corte detallada (PDF) corrigiendo la ruta de los datos.
 */
async function exportCorteToPDF(proyecto, corte, exportType) {
    loadingOverlay.classList.remove('hidden');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });
    
    // Formateador para enteros (sin decimales)
    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0 
    });

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

    try {
        // --- CORRECCIÓN PRINCIPAL AQUÍ ---
        // 1. Consultamos la subcolección 'items' DENTRO del proyecto
        // 2. Usamos 'collectionGroup' para traer todos los 'subItems' de este proyecto
        const [itemsSnapshot, subItemsSnapshot, cortesAnterioresSnapshot] = await Promise.all([
            getDocs(query(collection(db, "projects", proyecto.id, "items"))), // <-- Ruta corregida
            getDocs(query(collectionGroup(db, "subItems"), where("projectId", "==", proyecto.id))), // <-- Ruta corregida
            getDocs(query(collection(db, "projects", proyecto.id, "cortes"), where("status", "==", "aprobado"), where("corteNumber", "<", corte.corteNumber)))
        ]);

        const allItems = new Map(itemsSnapshot.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
        const allSubItems = new Map(subItemsSnapshot.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
        
        const subItemsEjecutadosAntes = new Set();
        cortesAnterioresSnapshot.forEach(doc => { 
            const d = doc.data();
            if(d.subItemIds) d.subItemIds.forEach(id => subItemsEjecutadosAntes.add(id)); 
        });

        // --- Cabecera del PDF ---
        // Intentamos cargar datos de la empresa si existen
        let empresaInfo = { nombre: "VIDRIOS Y ALUMINIOS EXITO", nit: "" };
        try {
             // Si tienes la función getCompanyData disponible, úsala aquí
             // const data = await getCompanyData(); empresaInfo = data;
        } catch(e) {}

        let reportTitle = `ACTA DE CORTE DE OBRA`;
        if (exportType === 'suministro') reportTitle = `ACTA DE CORTE DE SUMINISTRO`;
        if (exportType === 'instalacion') reportTitle = `ACTA DE CORTE DE INSTALACIÓN`;

        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text(`CONTRATISTA:`, 14, 15); doc.text(`CONTRATANTE:`, 14, 20); doc.text(`PROYECTO:`, 14, 25);
        doc.setFont("helvetica", "normal");
        doc.text(empresaInfo.nombre, 50, 15);
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
        const subItemsEnCorteSet = new Set(corte.subItemIds || []);
        let totalValorContratado = 0, totalValorEjecutadoAcumulado = 0, totalValorEjecutadoCorte = 0, totalValorSaldo = 0;

        // Variables para resumen financiero
        let subTotalCorteSinImpuestos = 0;
        let aiuDetailsCorte = { admin: 0, imprev: 0, utilidad: 0, ivaSobreUtilidad: 0, aiuA: 0, aiuI: 0, aiuU: 0 };
        let totalIvaCorte = 0;

        // Procesamiento de datos
        allItems.forEach(item => {
            // Filtramos subItems que pertenecen a este item (usando el mapa global que cargamos correctamente arriba)
            const subItemsDeEsteItem = Array.from(allSubItems.values()).filter(si => si.itemId === item.id);
            const subItemsEnEsteCorte = subItemsDeEsteItem.filter(si => subItemsEnCorteSet.has(si.id));
            const ejecutadosEnEsteCorte = subItemsEnEsteCorte.length;
            
            // Solo mostramos ítems que tengan movimiento o saldo, o sean parte del contrato
            if (ejecutadosEnEsteCorte === 0 && subItemsDeEsteItem.length === 0 && item.quantity === 0) return;

            const ejecutadosAntes = subItemsDeEsteItem.filter(si => subItemsEjecutadosAntes.has(si.id)).length;
            const ejecutadoAcumulado = ejecutadosAntes + ejecutadosEnEsteCorte;
            const saldo = item.quantity - ejecutadoAcumulado;

            let valorUnitarioSinImpuestos = 0, valorUnitarioTotalConImpuestos = 0, detallesDePrecio = null;

            if (exportType === 'completo') { detallesDePrecio = item.includedDetails; }
            else if (exportType === 'suministro') { detallesDePrecio = item.supplyDetails; }
            else if (exportType === 'instalacion') { detallesDePrecio = item.installationDetails; }

            // Fallback si no hay detalles específicos pero es modelo incluido
            if (!detallesDePrecio && proyecto.pricingModel === 'incluido') {
                 detallesDePrecio = item.includedDetails;
            }

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
                
                // Guardar porcentajes para el resumen final (tomamos del último ítem procesado)
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

            const descriptionText = (item.description || item.name).substring(0, 80);

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
                [{ content: 'CONTRATADO', colSpan: 7, styles: headStyles }, { content: 'EJECUTADO CORTE ACTUAL', colSpan: 2, styles: { ...headStyles, fillColor: [22, 160, 133] } }, { content: 'EJECUTADO ACUMULADO', colSpan: 2, styles: { ...headStyles, fillColor: [41, 128, 185] } }, { content: 'SALDO', colSpan: 2, styles: { ...headStyles, fillColor: [192, 57, 43] } }],
                [{ content: 'Item', styles: subheadStyles }, { content: 'Descripción', styles: subheadStyles }, { content: 'Ancho', styles: subheadStyles }, { content: 'Alto', styles: subheadStyles }, { content: 'Cant.', styles: subheadStyles }, { content: 'V. Unit', styles: subheadStyles }, { content: 'V. Total', styles: subheadStyles }, { content: 'Cant.', styles: subheadStyles }, { content: 'Valor', styles: subheadStyles }, { content: 'Cant.', styles: subheadStyles }, { content: 'Valor', styles: subheadStyles }, { content: 'Cant.', styles: subheadStyles }, { content: 'Valor', styles: subheadStyles }]
            ],
            body: body,
            foot: [
                [{ content: 'TOTALES', colSpan: 6, styles: { halign: 'right', fontStyle: 'bold' } }, { content: currencyFormatter.format(totalValorContratado), styles: { fontStyle: 'bold', halign: 'center' } }, '', { content: currencyFormatter.format(totalValorEjecutadoCorte), styles: { fontStyle: 'bold', halign: 'center' } }, '', { content: currencyFormatter.format(totalValorEjecutadoAcumulado), styles: { fontStyle: 'bold', halign: 'center' } }, '', { content: currencyFormatter.format(totalValorSaldo), styles: { fontStyle: 'bold', halign: 'center' } }]
            ],
            theme: 'grid',
            styles: { fontSize: 7, cellPadding: 1, halign: 'center', valign: 'middle' },
            columnStyles: { 1: { cellWidth: 40, halign: 'left' } }, // Descripción más ancha
            footStyles: { fillColor: [236, 240, 241], textColor: 0 }
        });

        // --- Tabla de Resumen Financiero ---
        let finalY = doc.autoTable.previous.finalY;
        if (finalY > 160) { doc.addPage(); finalY = 20; } else { finalY += 10; }

        const summaryBody = [];
        summaryBody.push(['SUB TOTAL (Valor Ejecutado en Corte)', currencyFormatter.format(subTotalCorteSinImpuestos)]);
        if (totalIvaCorte > 0) summaryBody.push(['IVA (19%)', currencyFormatter.format(totalIvaCorte)]);
        
        if (aiuDetailsCorte.admin > 0 || aiuDetailsCorte.imprev > 0) {
            summaryBody.push([`Administración (${aiuDetailsCorte.aiuA}%)`, currencyFormatter.format(aiuDetailsCorte.admin)]);
            summaryBody.push([`Imprevistos (${aiuDetailsCorte.aiuI}%)`, currencyFormatter.format(aiuDetailsCorte.imprev)]);
            summaryBody.push([`Utilidad (${aiuDetailsCorte.aiuU}%)`, currencyFormatter.format(aiuDetailsCorte.utilidad)]);
            if(aiuDetailsCorte.ivaSobreUtilidad > 0) {
                summaryBody.push(["IVA (19%) s/Utilidad", currencyFormatter.format(aiuDetailsCorte.ivaSobreUtilidad)]);
            }
        }
        summaryBody.push([{ content: "TOTAL BRUTO CORTE", styles: { fontStyle: 'bold' } }, { content: currencyFormatter.format(totalValorEjecutadoCorte), styles: { fontStyle: 'bold' } }]);

        let totalAPagar = totalValorEjecutadoCorte;
        if (corte.amortizacion > 0) { 
            summaryBody.push(["Amortización Anticipo", `(${currencyFormatter.format(corte.amortizacion)})`]); 
            totalAPagar -= corte.amortizacion; 
        }
        if (corte.otrosDescuentos && corte.otrosDescuentos.length > 0) { 
            corte.otrosDescuentos.forEach(d => { 
                summaryBody.push([`Descuento (${d.concept})`, `(${currencyFormatter.format(d.value)})`]); 
                totalAPagar -= d.value; 
            }); 
        }
        summaryBody.push([{ content: "NETO A PAGAR", styles: { fontStyle: 'bold', fillColor: [46, 204, 113] } }, { content: currencyFormatter.format(totalAPagar), styles: { fontStyle: 'bold', fillColor: [46, 204, 113] } }]);

        doc.autoTable({
            startY: finalY,
            body: summaryBody,
            theme: 'grid',
            tableWidth: 120,
            margin: { left: 160 }, // Alineado a la derecha
            styles: { fontSize: 9, cellPadding: 2 },
            columnStyles: { 0: { halign: 'right', fontStyle: 'bold' }, 1: { halign: 'right' } }
        });

        doc.save(`Acta_Corte_${corte.corteNumber}_${proyecto.name}_${exportType}.pdf`);

    } catch (error) {
        console.error("Error al exportar acta de corte:", error);
        alert("Ocurrió un error al generar el PDF del acta. Revisa la consola.");
    } finally {
        loadingOverlay.classList.add('hidden');
    }
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
    const itemsQuery = query(collection(db, "projects", projectId, "items"));
    const querySnapshot = await getDocs(itemsQuery);

    querySnapshot.forEach(doc => {
        const item = doc.data();
        totalValue += calculateItemTotal(item);
    });

    return Math.round(totalValue); // Aseguramos redondeo
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
    return Math.round(unitPrice); // <-- CAMBIO: Redondea el resultado final
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

    return Math.round(total); // <-- CAMBIO: Redondea el resultado final
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
        // --- INICIO DE CAMBIO: Path de subcolección ---
        let q = query(
            collection(db, "projects", projectId, "items"), // <-- CAMBIO
            orderBy(itemSortState.key, itemSortState.direction),
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
            const subItemsQuery = query(collectionGroup(db, "subItems"), where("itemId", "in", itemIds), where("status", "==", "Instalado"));
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
    const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
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
        const projectPricingModel = currentProject.pricingModel || 'separado';
        const newItemData = {
            name: data.name,
            description: data.description,
            quantity: parseInt(data.quantity),
            width: parseFloat(data.width) || 0,
            height: parseFloat(data.height) || 0,
            itemType: projectPricingModel === 'incluido' ? 'suministro_instalacion_incluido' : 'suministro_instalacion',
            projectId: currentProject.id, // Sigue enviando projectId
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
    const updatedData = {
        name: data.name,
        description: data.description,
        width: parseFloat(data.width) || 0,
        height: parseFloat(data.height) || 0,
        itemType: projectPricingModel === 'incluido' ? 'suministro_instalacion_incluido' : 'suministro_instalacion',
        projectId: currentProject.id, // <-- AÑADIDO: Importante para la función de backend
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
    // --- INICIO DE CAMBIO: Path de subcolecciones ---
    const itemRef = doc(db, "projects", currentProject.id, "items", itemId);
    const subItemsQuery = query(collection(itemRef, "subItems")); // Consulta la subcolección anidada
    // --- FIN DE CAMBIO ---

    const subItemsSnapshot = await getDocs(subItemsQuery);
    subItemsSnapshot.forEach(doc => batch.delete(doc.ref));
    batch.delete(itemRef); // Borra el item
    await batch.commit();
}

// --- LÓGICA DE SUB-ÍTEMS ---
function showSubItems(item) {
    currentItem = item;
    
    materialRequestReturnContext = { view: 'subItems' };

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
 * Abre un documento (PDF o Imagen) en el visor integrado.
 * @param {string} url - URL del archivo.
 * @param {string} title - Título para la ventana.
 */
function viewDocument(url, title = 'Visor de Documentos') {
    const modal = document.getElementById('document-display-modal');
    const iframe = document.getElementById('document-iframe');
    const titleEl = document.getElementById('document-display-title');
    const closeBtn = document.getElementById('document-display-close-btn');

    if (!modal || !iframe) return;

    // 1. Configurar Modal
    titleEl.textContent = title;

    // 2. Detectar tipo de archivo para mejor visualización
    // Si es PDF, usamos el visor nativo del navegador dentro del iframe
    iframe.src = url;

    // 3. Mostrar
    modal.classList.remove('hidden');
    modal.classList.add('flex'); // Aseguramos display flex para centrado

    // 4. Configurar Cierre
    const closeModal = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        iframe.src = 'about:blank'; // Limpiar para detener carga/audio/video
    };

    closeBtn.onclick = closeModal;

    // Cerrar al hacer clic fuera (backdrop)
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

// Exponer globalmente
window.viewDocument = viewDocument;


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

    if (!currentProject || !currentProject.id) {
        console.error("Error: currentProject no está definido al cargar subItems");
        return;
    }
    const q = query(collection(db, "projects", currentProject.id, "items", itemId, "subItems"));

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
            // CAMBIO: Usamos currentProject.id en lugar de subItem.projectId
            photoHtml += `<button class="delete-photo-btn text-red-600 hover:underline font-semibold ml-2" data-subitemid="${subItem.id}" data-itemid="${subItem.itemId}" data-projectid="${currentProject.id}" data-installerid="${subItem.installer}">Eliminar</button>`;
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

async function updateSubItem(itemId, subItemId, data) { // <-- Parámetro añadido
    // --- INICIO DE CAMBIO: Path de subcolección ---
    // Ahora usa el itemId pasado como argumento
    const subItemRef = doc(db, "projects", currentProject.id, "items", itemId, "subItems", subItemId);
    await updateDoc(subItemRef, data);
    // --- FIN DE CAMBIO ---
}

// --- MANEJO DE MODALES ---
const mainModal = document.getElementById('main-modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalForm = document.getElementById('modal-form');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');
const modalContentDiv = document.getElementById('main-modal-content'); // <-- AÑADE ESTA LÍNEA

async function openMainModal(type, data = {}) {

    // --- INICIO DE CORRECCIÓN (Reseteo Robustecido) ---
    if (modalContentDiv) {
        // 1. Limpiamos TODAS las clases de ancho que hayamos podido usar en cualquier caso
        modalContentDiv.classList.remove(
            'max-w-md', 'max-w-lg', 'max-w-xl', 'max-w-2xl', 'max-w-3xl',
            'max-w-4xl', 'max-w-5xl', 'max-w-6xl', 'max-w-7xl',
            'w-11/12', 'lg:w-3/4'
        );

        // 2. Restauramos SIEMPRE el tamaño por defecto (max-w-2xl)
        // Así, si el caso específico no dice nada, se verá normal.
        modalContentDiv.classList.add('max-w-2xl');

        // 3. Limpiamos estilos en línea (usados en Orden de Compra)
        modalContentDiv.style.width = '';
        modalContentDiv.style.maxWidth = '';
    }

    // Restaurar el encabezado por defecto (por si la alerta lo ocultó)
    if (document.getElementById('modal-title')) {
        document.getElementById('modal-title').parentElement.style.display = 'flex';
    }
    // --- FIN DE CORRECCIÓN ---

    let title, bodyHtml, btnText, btnClass;
    modalForm.reset();
    modalForm.dataset.type = type;
    modalForm.dataset.id = data.id || '';
    switch (type) {
        case 'newProject':
            title = 'Crear Nuevo Proyecto';
            btnText = 'Crear Proyecto';
            btnClass = 'bg-blue-500 hover:bg-blue-600';
            modalContentDiv.classList.add('max-w-2xl'); // <-- LÍNEA RESTAURADA
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
                const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });

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

        case 'report-entry':
            title = 'Reportar Ingreso';
            btnText = 'Confirmar Ingreso';
            btnClass = 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg w-full sm:w-auto';

            // Ajustamos el ancho para que se vea bien en móviles y escritorio
            if (modalContentDiv) {
                modalContentDiv.classList.remove('max-w-2xl');
                modalContentDiv.classList.add('max-w-lg');
            }

            bodyHtml = `
                <div class="space-y-5">
                    <div class="bg-blue-50 rounded-xl p-4 border border-blue-100 relative overflow-hidden">
                        <div class="flex items-start gap-3 relative z-10">
                            <div class="bg-white p-2 rounded-full text-blue-500 shadow-sm border border-blue-50 shrink-0">
                                <i class="fa-solid fa-location-dot text-xl"></i>
                            </div>
                            <div class="w-full">
                                <h4 class="text-blue-900 font-bold text-sm uppercase tracking-wide mb-1">Ubicación Actual</h4>
                                <p id="entry-location-text" class="text-blue-700 text-xs font-medium">Obteniendo coordenadas...</p>
                                <div id="entry-map-placeholder" class="mt-3 h-32 bg-blue-100/50 rounded-lg border-2 border-dashed border-blue-200 flex items-center justify-center text-blue-300">
                                    <span class="text-xs">Mapa de ubicación</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-2 ml-1">Evidencia Fotográfica (Selfie)</label>
                        
                        <div id="entry-photo-container" class="aspect-[4/5] w-full rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-all group relative overflow-hidden">
                            
                            <div id="entry-photo-placeholder" class="text-center p-6 transition-opacity group-hover:scale-105">
                                <div class="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-3 group-hover:shadow-md transition-all">
                                    <i class="fa-solid fa-camera text-2xl text-gray-400 group-hover:text-emerald-500 transition-colors"></i>
                                </div>
                                <p class="text-sm font-bold text-gray-400 group-hover:text-emerald-600">Tocar para tomar foto</p>
                            </div>

                            <img id="entry-photo-preview" class="absolute inset-0 w-full h-full object-cover hidden" />
                        </div>
                        
                        <input type="file" id="entry-photo-input" name="photo" accept="image/*" capture="user" class="hidden">
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Observaciones (Opcional)</label>
                        <div class="relative group">
                             <div class="absolute top-3.5 left-3 text-gray-400 group-focus-within:text-emerald-500 transition-colors">
                                <i class="fa-regular fa-comment-dots"></i>
                            </div>
                            <textarea name="comments" rows="2" 
                                class="w-full pl-10 pr-4 py-3 border-2 border-gray-100 hover:border-gray-200 rounded-xl text-gray-800 bg-gray-50 focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 outline-none transition-all text-sm font-medium placeholder-gray-400 resize-none"
                                placeholder="Ej: Ingreso a obra Torre 2..."></textarea>
                        </div>
                    </div>
                </div>
            `;

            // Inicialización de eventos específicos para este modal
            setTimeout(() => {
                const container = document.getElementById('entry-photo-container');
                const input = document.getElementById('entry-photo-input');
                const preview = document.getElementById('entry-photo-preview');
                const placeholder = document.getElementById('entry-photo-placeholder');

                if (container && input) {
                    // Al hacer clic en la caja, abrir cámara
                    container.addEventListener('click', () => input.click());

                    // Al seleccionar archivo, mostrar preview
                    input.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (evt) => {
                                preview.src = evt.target.result;
                                preview.classList.remove('hidden');
                                placeholder.classList.add('hidden');
                                container.classList.remove('border-dashed', 'bg-gray-50');
                                container.classList.add('border-emerald-500');
                            };
                            reader.readAsDataURL(file);
                        }
                    });
                }
            }, 100);
            break;


        case 'camera_entry': // <--- ESTE ES EL CASO QUE FALTA
            title = '📸 Validación de Ingreso';
            // Ocultamos el botón por defecto porque ingresopersonal.js tiene sus propios botones
            btnText = '';
            btnClass = 'hidden';

            // Ocultamos el footer estándar del modal para usar los botones personalizados
            if (document.getElementById('main-modal-footer')) {
                document.getElementById('main-modal-footer').style.display = 'none';
            }

            bodyHtml = `
                <div class="flex flex-col items-center justify-center space-y-6 py-4">
                    <div class="relative w-64 h-64 sm:w-80 sm:h-80 bg-black rounded-full overflow-hidden shadow-2xl border-4 border-emerald-500 ring-4 ring-emerald-100">
                        <video id="entry-camera-video" autoplay playsinline class="w-full h-full object-cover transform scale-x-[-1]"></video>
                        <canvas id="entry-camera-canvas" class="absolute top-0 left-0 w-full h-full hidden"></canvas>
                        <div class="absolute inset-0 border-2 border-white/40 rounded-full m-8 pointer-events-none border-dashed animate-pulse"></div>
                    </div>
                    
                    <div id="entry-status-msg" class="text-center min-h-[2.5rem] flex items-center justify-center px-4">
                        <p class="text-slate-600 font-medium text-sm bg-slate-100 px-4 py-1 rounded-full">
                            <i class="fa-solid fa-face-viewfinder mr-2"></i>Ubica tu rostro en el círculo
                        </p>
                    </div>

                    <div class="flex gap-4 w-full justify-center px-4">
                        <button type="button" id="btn-cancel-entry" class="flex-1 max-w-[120px] bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 py-3 rounded-xl font-bold transition-colors shadow-sm">
                            Cancelar
                        </button>
                        <button id="btn-capture-entry" class="flex-1 max-w-[200px] bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white py-3 rounded-xl font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
                            <i class="fa-solid fa-camera"></i> 
                            <span>Validar Ingreso</span>
                        </button>
                    </div>
                    
                    <div class="text-[10px] text-slate-400 text-center mt-2">
                        <i class="fa-solid fa-location-dot mr-1"></i> Se registrará tu ubicación y biometría.
                    </div>
                </div>
            `;
            break;


        // --- CASO: REVISAR Y APROBAR/RECHAZAR PRÉSTAMO ---
        case 'review-loan':
            title = 'Revisión y Aprobación';
            btnText = 'Aprobar y Activar Deuda';
            btnClass = 'bg-green-600 hover:bg-green-700 w-full md:w-auto';

            const fmtMoney = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

            bodyHtml = `
                <input type="hidden" name="loanId" value="${data.id}">
                <input type="hidden" name="userId" value="${data.uid}">

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    
                    <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <div class="flex items-center gap-4 mb-4 border-b border-gray-100 pb-3">
                            
                            <img src="${data.userPhoto}" alt="Perfil" class="w-14 h-14 rounded-full object-cover border-2 border-indigo-100 shadow-sm">
                            
                            <div>
                                <p class="text-xs text-gray-400 uppercase font-bold">Solicitante</p>
                                <p class="font-bold text-gray-800 text-lg leading-tight">${data.userName}</p>
                            </div>
                        </div>
                        <div>
                            <p class="text-xs text-gray-400 uppercase font-bold mb-1">Motivo</p>
                            <p class="text-sm text-gray-600 italic bg-gray-50 p-3 rounded border border-gray-100">"${data.description}"</p>
                        </div>
                    </div>

                    <div class="bg-indigo-50 p-4 rounded-xl border border-indigo-100 shadow-sm relative overflow-hidden">
                        <div class="absolute top-0 right-0 -mt-2 -mr-2 w-16 h-16 bg-indigo-100 rounded-full opacity-50"></div>
                        
                        <h4 class="text-indigo-800 font-bold text-sm mb-3 flex items-center">
                            <i class="fa-solid fa-money-bill-transfer mr-2"></i> Datos para Transferencia
                        </h4>
                        
                        <div class="space-y-2">
                            <div class="flex justify-between text-sm">
                                <span class="text-indigo-400">Banco:</span>
                                <span class="font-bold text-indigo-900 text-right">${data.bankName}</span>
                            </div>
                             <div class="flex justify-between text-sm">
                                <span class="text-indigo-400">Tipo:</span>
                                <span class="font-bold text-indigo-900 text-right">${data.accountType}</span>
                            </div>
                            <div class="mt-2 pt-2 border-t border-indigo-200">
                                <p class="text-xs text-indigo-500 mb-1">Número de Cuenta:</p>
                                <div class="flex items-center justify-between bg-white rounded px-2 py-1 border border-indigo-200">
                                    <span class="font-mono font-bold text-lg text-gray-800 select-all tracking-wide">${data.accountNumber}</span>
                                    <button type="button" class="text-gray-400 hover:text-indigo-600 transition-colors" onclick="navigator.clipboard.writeText('${data.accountNumber}'); window.showToast('Cuenta copiada', 'success')" title="Copiar">
                                        <i class="fa-regular fa-copy"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="bg-gray-50 p-5 rounded-xl border border-gray-200">
                    <h4 class="text-sm font-bold text-gray-700 border-b border-gray-200 pb-2 mb-4 flex items-center">
                        <i class="fa-solid fa-gavel mr-2 text-gray-400"></i> Decisión Administrativa
                    </h4>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Monto Aprobado</label>
                            <div class="relative">
                                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                                <input type="text" name="approvedAmount" required 
                                    class="currency-input pl-7 w-full border border-gray-300 rounded-lg p-2.5 text-xl font-bold text-green-700 focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none bg-white shadow-sm" 
                                    value="${data.amount}">
                            </div>
                            <p class="text-[10px] text-gray-400 mt-1">Solicitado: ${fmtMoney.format(data.amount)}</p>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Cuotas</label>
                            <input type="number" name="approvedInstallments" min="1" max="24" required 
                                class="w-full border border-gray-300 rounded-lg p-2.5 text-gray-800 font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white shadow-sm" 
                                value="${data.installments}">
                            <p class="text-[10px] text-gray-400 mt-1">Solicitado: ${data.installments}</p>
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Nota Interna (Opcional)</label>
                        <textarea name="adminNotes" rows="2" class="w-full border border-gray-300 rounded-lg p-2 text-sm focus:border-blue-500 outline-none" placeholder="Ej: Aprobado parcial por capacidad de endeudamiento..."></textarea>
                    </div>
                </div>

                <div class="mt-6 flex justify-between items-center">
                    <button type="button" id="btn-reject-loan-modal" class="text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-bold transition-colors flex items-center">
                        <i class="fa-solid fa-ban mr-2"></i> Rechazar Solicitud
                    </button>
                </div>
            `;

            setTimeout(() => {
                const amountInput = modalForm.querySelector('.currency-input');
                setupCurrencyInput(amountInput);

                document.getElementById('btn-reject-loan-modal').addEventListener('click', () => {
                    const loanId = modalForm.querySelector('input[name="loanId"]').value;
                    const userId = modalForm.querySelector('input[name="userId"]').value;
                    const notes = modalForm.querySelector('textarea[name="adminNotes"]').value;

                    openConfirmModal("¿Rechazar solicitud? No se generará deuda.", async () => {
                        try {
                            await updateDoc(doc(db, "users", userId, "loans", loanId), {
                                status: 'rejected',
                                rejectedAt: serverTimestamp(),
                                rejectedBy: currentUser.uid,
                                adminNotes: notes || 'Rechazado por administrador'
                            });
                            window.showToast("Solicitud rechazada correctamente.", "success");
                            closeMainModal();
                            setTimeout(() => openMainModal('view-pending-loans'), 500);
                        } catch (e) {
                            console.error(e);
                            window.showToast("Error al rechazar.", "error");
                        }
                    });
                });
            }, 100);
            break;

        case 'create-daily-report':
            title = 'Nuevo Reporte de Actividad';
            btnText = 'Guardar Reporte';
            btnClass = 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg';

            const todayStr = new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

            bodyHtml = `
            <div class="space-y-4">
                <div class="bg-gradient-to-r from-indigo-50 to-blue-50 p-4 rounded-xl border border-indigo-100 flex items-center gap-3">
                    <div class="p-2 bg-white rounded-full shadow-sm text-indigo-500"><i class="fa-regular fa-calendar-check"></i></div>
                    <div>
                        <p class="text-sm text-indigo-900 font-bold capitalize">${todayStr}</p>
                        <p class="text-xs text-indigo-600">Reporta tus actividades del día.</p>
                    </div>
                </div>

                <div>
                    <div class="flex justify-between items-end mb-2">
                        <label class="block text-sm font-bold text-gray-700">Descripción de Actividades</label>
                        <span id="mic-status" class="text-xs font-bold text-gray-400 italic transition-colors">Listo para escribir</span>
                    </div>
                    
                    <div class="relative">
                        <textarea id="daily-report-text" name="reportText" rows="6" 
                            class="w-full p-4 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-none text-gray-700 leading-relaxed transition-all placeholder-gray-400" 
                            placeholder="Escribe aquí o presiona el micrófono para dictar..."></textarea>
                        
                        <button type="button" id="btn-voice-record" 
                            class="absolute bottom-3 right-3 bg-gray-100 hover:bg-red-500 hover:text-white text-gray-500 p-3 rounded-xl transition-all shadow-sm border border-gray-200 group">
                            <i class="fa-solid fa-microphone text-lg group-hover:scale-110 transition-transform"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

            // Lógica del Micrófono (Web Speech API)
            setTimeout(() => {
                const btnRecord = document.getElementById('btn-voice-record');
                const textArea = document.getElementById('daily-report-text');
                const statusText = document.getElementById('mic-status');
                let recognition;

                if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                    recognition = new SpeechRecognition();
                    recognition.lang = 'es-CO';
                    recognition.interimResults = false;
                    recognition.continuous = false;

                    recognition.onstart = () => {
                        btnRecord.classList.add('bg-red-500', 'text-white', 'animate-pulse', 'ring-4', 'ring-red-200');
                        btnRecord.classList.remove('bg-gray-100', 'text-gray-500');
                        statusText.textContent = "Escuchando... habla ahora";
                        statusText.className = "text-xs font-bold text-red-500 italic animate-pulse";
                        textArea.classList.add('border-red-300');
                    };

                    recognition.onend = () => {
                        btnRecord.classList.remove('bg-red-500', 'text-white', 'animate-pulse', 'ring-4', 'ring-red-200');
                        btnRecord.classList.add('bg-gray-100', 'text-gray-500');
                        statusText.textContent = "Dictado finalizado";
                        statusText.className = "text-xs font-bold text-green-600 italic";
                        textArea.classList.remove('border-red-300');
                        setTimeout(() => { statusText.textContent = "Listo para escribir"; statusText.className = "text-xs font-bold text-gray-400 italic"; }, 2000);
                    };

                    recognition.onresult = (event) => {
                        const transcript = event.results[0][0].transcript;
                        const currentText = textArea.value.trim();
                        // Añade el texto dictado con un espacio si ya había texto
                        textArea.value = currentText + (currentText.length > 0 ? " " : "") + transcript.charAt(0).toUpperCase() + transcript.slice(1) + ".";
                        textArea.scrollTop = textArea.scrollHeight; // Auto-scroll al final
                    };

                    recognition.onerror = (event) => {
                        console.error("Error voz:", event.error);
                        statusText.textContent = "No te escuché bien. Intenta de nuevo.";
                        statusText.className = "text-xs font-bold text-orange-500 italic";
                    };

                    btnRecord.addEventListener('click', () => {
                        try { recognition.start(); } catch (e) { recognition.stop(); }
                    });
                } else {
                    btnRecord.style.display = 'none'; // Navegador no soporta
                }
            }, 100);
            break;

        // --- NUEVO CASO: VER HISTORIAL DE AUDITORÍA ---
        case 'view-audit-logs':
            title = 'Historial de Cambios y Auditoría';
            btnText = 'Cerrar';
            btnClass = 'bg-gray-500 hover:bg-gray-600';

            bodyHtml = `
                <div id="audit-log-list" class="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar p-1">
                    <div class="flex justify-center py-10"><div class="loader"></div></div>
                </div>
            `;

            setTimeout(async () => {
                const listContainer = document.getElementById('audit-log-list');
                try {
                    // Consultar logs filtrados por este empleado (targetId)
                    // data.userId viene pasado al abrir el modal
                    const q = query(
                        collection(db, "audit_logs"),
                        where("targetId", "==", data.userId),
                        orderBy("timestamp", "desc"),
                        limit(20)
                    );
                    const snapshot = await getDocs(q);

                    listContainer.innerHTML = '';

                    if (snapshot.empty) {
                        listContainer.innerHTML = `<p class="text-gray-400 text-center py-4">No hay registros de cambios recientes.</p>`;
                        return;
                    }

                    snapshot.forEach(doc => {
                        const log = doc.data();
                        const date = log.timestamp ? log.timestamp.toDate().toLocaleString('es-CO') : 'N/A';

                        // Icono según acción
                        let iconColor = 'text-gray-500';
                        let icon = 'fa-info-circle';
                        if (log.action.includes('Eliminar')) { icon = 'fa-trash-can'; iconColor = 'text-red-500'; }
                        if (log.action.includes('Editar') || log.action.includes('Cambio')) { icon = 'fa-pen-to-square'; iconColor = 'text-yellow-600'; }
                        if (log.action.includes('Pago')) { icon = 'fa-money-bill'; iconColor = 'text-green-600'; }

                        const item = document.createElement('div');
                        item.className = "bg-white p-3 rounded border border-gray-200 shadow-sm text-sm";
                        item.innerHTML = `
                            <div class="flex justify-between items-start">
                                <div class="flex items-center gap-2 font-bold text-gray-700">
                                    <i class="fa-solid ${icon} ${iconColor}"></i>
                                    <span>${log.action}</span>
                                </div>
                                <span class="text-xs text-gray-400">${date}</span>
                            </div>
                            <p class="text-gray-600 mt-1">${log.description}</p>
                            <div class="mt-2 pt-2 border-t border-gray-100 flex justify-between items-center text-xs">
                                <span class="text-gray-400">Por: <span class="font-semibold text-gray-600">${log.performedByName || 'Admin'}</span></span>
                                ${log.previousData ? `<button class="text-blue-500 hover:underline" onclick="alert('Detalle técnico: ' + '${log.previousData.replace(/'/g, "")}')">Ver Detalle</button>` : ''}
                            </div>
                        `;
                        listContainer.appendChild(item);
                    });
                } catch (error) {
                    console.error(error);
                    listContainer.innerHTML = `<p class="text-red-500 text-center">Error cargando logs. (Asegúrate de crear el índice compuesto en Firebase si la consola lo pide).</p>`;
                }
            }, 100);
            break;

        case 'check-permissions':
            title = 'Verificación de Permisos';
            btnText = 'Continuar a la App';
            btnClass = 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed';

            // Hacemos que el modal no se pueda cerrar con la X ni cancelar si es crítico
            if (document.getElementById('modal-cancel-btn')) document.getElementById('modal-cancel-btn').style.display = 'none';

            bodyHtml = `
                <div class="space-y-4">
                    <p class="text-sm text-gray-600 mb-4">Para utilizar el Gestor de Proyectos, necesitamos activar las siguientes funciones del dispositivo:</p>
                    
                    <div class="flex items-center justify-between p-4 border rounded-xl bg-gray-50" id="perm-card-camera">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xl">
                                <i class="fa-solid fa-camera"></i>
                            </div>
                            <div>
                                <p class="font-bold text-gray-800 text-sm">Cámara</p>
                                <p class="text-xs text-gray-500">Para reporte de ingreso y evidencia.</p>
                            </div>
                        </div>
                        <div id="perm-status-camera">
                            <button type="button" onclick="requestCameraPermission()" class="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-blue-700 transition-colors">Activar</button>
                        </div>
                    </div>

                    <div class="flex items-center justify-between p-4 border rounded-xl bg-gray-50" id="perm-card-location">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xl">
                                <i class="fa-solid fa-location-dot"></i>
                            </div>
                            <div>
                                <p class="font-bold text-gray-800 text-sm">Ubicación</p>
                                <p class="text-xs text-gray-500">Para validar el sitio de trabajo.</p>
                            </div>
                        </div>
                        <div id="perm-status-location">
                            <button type="button" onclick="requestLocationPermission()" class="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-green-700 transition-colors">Activar</button>
                        </div>
                    </div>

                    <div class="flex items-center justify-between p-4 border rounded-xl bg-gray-50" id="perm-card-notification">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xl">
                                <i class="fa-solid fa-bell"></i>
                            </div>
                            <div>
                                <p class="font-bold text-gray-800 text-sm">Notificaciones</p>
                                <p class="text-xs text-gray-500">Para alertas y llamados urgentes.</p>
                            </div>
                        </div>
                        <div id="perm-status-notification">
                            <button type="button" onclick="requestPushPermission()" class="text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-red-700 transition-colors">Activar</button>
                        </div>
                    </div>
                </div>
            `;

            // Verificamos el estado inicial al abrir el modal
            setTimeout(updatePermissionUI, 100);
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

        case 'send-admin-alert':
            // Ocultamos encabezado estándar
            if (document.getElementById('modal-title')) document.getElementById('modal-title').parentElement.style.display = 'none';

            title = 'Llamado Urgente';
            btnText = 'Enviar Alerta';
            btnClass = 'bg-red-600 hover:bg-red-700 text-white shadow-lg w-full sm:w-auto';

            if (modalContentDiv) {
                modalContentDiv.classList.remove('max-w-2xl');
                modalContentDiv.classList.add('max-w-md');
            }

            // Preparamos datos de usuarios
            const activeUsersData = Array.from(usersMap.entries())
                .filter(([id, user]) => user.status === 'active')
                .sort((a, b) => a[1].firstName.localeCompare(b[1].firstName))
                .map(([id, user]) => ({
                    value: id,
                    label: `${user.firstName} ${user.lastName}`
                }));

            bodyHtml = `
                <div class="-mx-6 -mt-6 mb-6 bg-gradient-to-b from-red-600 to-red-700 px-6 py-6 flex flex-col items-center justify-center relative rounded-t-lg shadow-md text-white">
                    <button type="button" id="custom-close-alert" class="absolute top-4 right-4 text-white/60 hover:text-white hover:bg-white/10 rounded-full p-1 transition-all">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                    <div class="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center text-3xl mb-2 backdrop-blur-sm shadow-inner border border-white/10">
                         <i class="fa-solid fa-tower-broadcast animate-pulse"></i>
                    </div>
                    <h2 class="text-xl font-black uppercase tracking-wider text-center leading-tight">Llamado Urgente</h2>
                </div>

                <div class="space-y-4 px-2">
                    
                    <div class="flex items-center justify-between p-3 bg-red-50 border border-red-100 rounded-lg">
                        <div class="flex items-center gap-2">
                            <div class="bg-white p-1.5 rounded text-red-500 shadow-sm"><i class="fa-solid fa-users"></i></div>
                            <span class="text-sm font-bold text-gray-700">Enviar a todo el personal</span>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="alert-send-all-toggle" class="sr-only peer">
                            <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                        </label>
                    </div>

                    <div id="alert-target-container" class="transition-all duration-300">
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Destinatarios Específicos</label>
                        <select id="alert-target-user" name="targetUserId" multiple class="w-full">
                            <option value="" placeholder>Cargando lista...</option>
                        </select>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Adjunto (Foto o PDF)</label>
                        <div class="relative group">
                            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 group-hover:text-red-500 transition-colors">
                                <i class="fa-solid fa-paperclip"></i>
                            </div>
                            <input type="file" id="alert-image-input" accept="image/*,.pdf" 
                                class="block w-full pl-10 text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100 cursor-pointer border rounded-lg py-2 border-gray-200 hover:border-red-300 transition-colors"/>
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Instrucción</label>
                        <div class="relative group">
                             <div class="absolute top-3.5 left-3 text-gray-400 group-focus-within:text-red-500 transition-colors">
                                <i class="fa-regular fa-comment-dots"></i>
                            </div>
                            <textarea name="alertMessage" rows="3" required 
                                class="w-full pl-10 pr-4 py-3 border-2 border-gray-100 hover:border-gray-200 rounded-xl text-gray-800 bg-gray-50 focus:bg-white focus:border-red-500 focus:ring-4 focus:ring-red-500/10 outline-none transition-all text-base font-medium placeholder-gray-400 resize-none"
                                placeholder="Ej: Favor presentarse en oficina..."></textarea>
                        </div>
                    </div>
                </div>
            `;

            // Inicialización Interactiva
            setTimeout(() => {
                // 1. Choices.js Configurado para Múltiple
                const selectElement = document.getElementById('alert-target-user');
                let choicesInstance = null;
                if (selectElement) {
                    choicesInstance = new Choices(selectElement, {
                        choices: activeUsersData,
                        searchEnabled: true,
                        placeholder: true,
                        placeholderValue: 'Seleccionar colaboradores...',
                        itemSelectText: '',
                        allowHTML: false,
                        removeItemButton: true, // <-- AÑADIDO: Permite borrar seleccionados con una X
                    });
                }

                // 2. Lógica del Toggle "Enviar a Todos"
                const toggle = document.getElementById('alert-send-all-toggle');
                const targetContainer = document.getElementById('alert-target-container');

                if (toggle) {
                    toggle.addEventListener('change', (e) => {
                        if (e.target.checked) {
                            targetContainer.classList.add('opacity-50', 'pointer-events-none');
                            if (choicesInstance) choicesInstance.disable();
                        } else {
                            targetContainer.classList.remove('opacity-50', 'pointer-events-none');
                            if (choicesInstance) choicesInstance.enable();
                        }
                    });
                }

                // 3. Botón cerrar custom
                const closeBtn = document.getElementById('custom-close-alert');
                if (closeBtn) closeBtn.addEventListener('click', closeMainModal);
            }, 100);
            break;

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
                            <p class="text-xs text-gray-500">Define el tamaño estándar de una unidad de compra (ej: una tira mide 600cm).</p>
                            <div class="grid grid-cols-2 gap-4">
                                <div id="length-field">
                                    <label class="block text-sm font-medium">Largo (cm)</label>
                                    <input type="number" name="defaultLength" class="mt-1 w-full border p-2 rounded-md" value="${isEditing && data.defaultSize ? (data.defaultSize.length * 100) || '' : ''}">
                                </div>
                                <div id="width-field" class="hidden">
                                    <label class="block text-sm font-medium">Ancho (cm)</label>
                                    <input type="number" name="defaultWidth" class="mt-1 w-full border p-2 rounded-md" value="${isEditing && data.defaultSize ? (data.defaultSize.width * 100) || '' : ''}">
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

        // --- NUEVO CASO: HISTORIAL DE PRÉSTAMOS (USUARIO) ---
        case 'view-my-loans':
            title = 'Historial de Mis Préstamos';
            btnText = 'Cerrar';
            btnClass = 'bg-gray-500 hover:bg-gray-600';
            // Ocultamos el botón de submit porque es solo lectura, el usuario cierra con la X o Cancelar

            bodyHtml = `
                <div id="my-loans-list" class="space-y-4 min-h-[200px]">
                    <div class="flex justify-center items-center h-32">
                        <div class="loader"></div>
                    </div>
                </div>
            `;

            setTimeout(async () => {
                const listContainer = document.getElementById('my-loans-list');
                const fmtMoney = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

                try {
                    // 1. Consultar SOLO los préstamos del usuario actual
                    const q = query(
                        collection(db, "users", currentUser.uid, "loans"),
                        orderBy("date", "desc") // De más nuevo a más viejo
                    );
                    const snapshot = await getDocs(q);

                    if (snapshot.empty) {
                        listContainer.innerHTML = `
                            <div class="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                                <i class="fa-solid fa-folder-open text-3xl mb-2"></i>
                                <p>No tienes historial de préstamos.</p>
                            </div>`;
                        return;
                    }

                    listContainer.innerHTML = '';

                    snapshot.forEach(doc => {
                        const loan = doc.data();
                        const dateStr = loan.date ? new Date(loan.date).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Fecha desconocida';

                        // Lógica de Estado
                        let statusBadge = '';
                        let cardBorder = 'border-gray-200';
                        let icon = '';
                        let footerInfo = '';

                        if (loan.status === 'paid') {
                            // ESTADO: PAGADO
                            cardBorder = 'border-green-200 bg-green-50';
                            statusBadge = '<span class="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded">PAGADO</span>';
                            icon = '<i class="fa-solid fa-circle-check text-green-500 text-xl"></i>';

                            // Obtenemos fecha de pago (paidAt)
                            let paidDateStr = 'Fecha desconocida';
                            if (loan.paidAt) {
                                paidDateStr = loan.paidAt.toDate().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
                            }

                            footerInfo = `
                                <div class="mt-3 pt-2 border-t border-green-200 text-sm text-green-800 flex items-start">
                                    <i class="fa-solid fa-money-bill-transfer mt-1 mr-2"></i>
                                    <div>
                                        <p class="font-bold">Cancelado en Nómina</p>
                                        <p class="text-xs">Descontado el: ${paidDateStr}</p>
                                    </div>
                                </div>`;

                        } else if (loan.status === 'active') {
                            // ESTADO: ACTIVO (Debiendo)
                            cardBorder = 'border-indigo-200 bg-white';
                            statusBadge = '<span class="bg-indigo-100 text-indigo-800 text-xs font-bold px-2 py-0.5 rounded">ACTIVO</span>';
                            icon = '<i class="fa-solid fa-circle-play text-indigo-500 text-xl"></i>';

                            footerInfo = `
                                <div class="mt-2 flex justify-between items-center text-sm">
                                    <span class="text-gray-500">Saldo Pendiente:</span>
                                    <span class="font-bold text-red-600">${fmtMoney.format(loan.balance)}</span>
                                </div>`;

                        } else if (loan.status === 'rejected') {
                            // ESTADO: RECHAZADO
                            cardBorder = 'border-red-100 bg-gray-50 opacity-75';
                            statusBadge = '<span class="bg-red-100 text-red-800 text-xs font-bold px-2 py-0.5 rounded">RECHAZADO</span>';
                            icon = '<i class="fa-solid fa-circle-xmark text-red-400 text-xl"></i>';

                            if (loan.adminNotes) {
                                footerInfo = `<p class="mt-2 text-xs text-red-600 italic bg-red-50 p-1 rounded">Nota Admin: "${loan.adminNotes}"</p>`;
                            }

                        } else {
                            // ESTADO: PENDIENTE (Revisión)
                            cardBorder = 'border-yellow-200 bg-yellow-50';
                            statusBadge = '<span class="bg-yellow-100 text-yellow-800 text-xs font-bold px-2 py-0.5 rounded">EN REVISIÓN</span>';
                            icon = '<i class="fa-solid fa-clock text-yellow-500 text-xl"></i>';
                            footerInfo = `<p class="mt-2 text-xs text-yellow-700 italic">Esperando aprobación del administrador.</p>`;
                        }

                        const card = document.createElement('div');
                        card.className = `rounded-lg border p-4 shadow-sm transition-all ${cardBorder}`;

                        card.innerHTML = `
                            <div class="flex justify-between items-start">
                                <div class="flex-1 pr-4">
                                    <div class="flex items-center gap-2 mb-1">
                                        ${statusBadge}
                                        <span class="text-xs text-gray-500">${dateStr}</span>
                                    </div>
                                    <h4 class="font-bold text-gray-800 text-lg">${fmtMoney.format(loan.amount)}</h4>
                                    <p class="text-sm text-gray-600 mt-1">"${loan.description}"</p>
                                </div>
                                <div>${icon}</div>
                            </div>
                            ${footerInfo}
                        `;
                        listContainer.appendChild(card);
                    });

                } catch (error) {
                    console.error("Error cargando historial:", error);
                    listContainer.innerHTML = `<p class="text-red-500 text-center">Error al cargar tus datos.</p>`;
                }
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
            // 1. Configuración Visual
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            title = 'Nueva Orden de Compra';
            btnText = 'Generar Orden';
            btnClass = 'bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white shadow-lg transform hover:-translate-y-0.5 transition-all';

            if (modalContentDiv) {
                modalContentDiv.classList.remove('max-w-2xl');
                modalContentDiv.style.width = '90vw';
                modalContentDiv.style.maxWidth = '1200px';
            }

            // 2. HTML Estructurado (Con correcciones de Z-INDEX y Contenedor de Alerta)
            bodyHtml = `
                <div id="material-request-loader" class="text-center py-12">
                    <div class="loader mx-auto mb-4"></div>
                    <p class="text-sm text-gray-500 animate-pulse">Cargando catálogo y proveedores...</p>
                </div>

                <div id="material-request-form-content" class="hidden flex flex-col h-full max-h-[80vh]">
                    
                    <div class="-mx-6 -mt-6 bg-gradient-to-r from-blue-600 to-indigo-700 px-8 py-6 rounded-t-lg text-white shadow-md mb-6 flex justify-between items-center">
                        <div class="flex items-center gap-4">
                            <div class="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center text-2xl backdrop-blur-sm border border-white/10">
                                <i class="fa-solid fa-cart-flatbed"></i>
                            </div>
                            <div>
                                <h2 class="text-2xl font-bold tracking-tight">Nueva Orden de Compra</h2>
                                <p class="text-blue-100 text-xs font-medium">Gestión de Abastecimiento</p>
                            </div>
                        </div>
                        <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white hover:bg-white/10 p-2 rounded-full transition-colors">
                            <i class="fa-solid fa-xmark text-2xl"></i>
                        </button>
                    </div>

                    <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm mb-6 grid grid-cols-1 md:grid-cols-3 gap-6 relative z-40">
                        
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Proveedor</label>
                            <select id="po-supplier-select" class="w-full" required></select>
                        </div>

                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Condición de Pago</label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                                    <i class="fa-solid fa-credit-card"></i>
                                </div>
                                <select name="paymentMethod" class="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white appearance-none cursor-pointer">
                                    <option value="pendiente" selected>Crédito / Pendiente</option>
                                    <option value="transferencia">Transferencia Inmediata</option>
                                    <option value="efectivo">Efectivo</option>
                                    <option value="tarjeta">Tarjeta Corporativa</option>
                                </select>
                                <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-500">
                                    <i class="fa-solid fa-chevron-down text-xs"></i>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Fecha de Emisión</label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                                    <i class="fa-regular fa-calendar"></i>
                                </div>
                                <input type="date" name="poDate" 
                                    class="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                                    value="${new Date().toISOString().split('T')[0]}">
                            </div>
                        </div>
                    </div>

                    <div class="flex flex-col flex-grow bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden relative z-0">
                        
                    <div class="bg-gray-50 p-4 border-b border-gray-200 relative z-50">
                            
                            <div class="flex flex-col lg:flex-row gap-3 items-end"> <div class="flex-grow w-full lg:w-auto">
                                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Buscar Ítem</label>
                                    <select id="po-add-item-select" class="w-full"></select>
                                </div>
                                
                                <div class="w-full lg:w-32">
                                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Cantidad</label>
                                    <input type="number" id="po-add-quantity" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 outline-none text-center font-bold" min="1" placeholder="0">
                                </div>
                                
                                <div class="w-full lg:w-48">
                                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Costo Unitario</label>
                                    <div class="relative">
                                        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                                        <input type="text" id="po-add-cost" class="currency-input w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 outline-none font-mono text-right" placeholder="0">
                                    </div>
                                </div>

                                <button type="button" id="po-add-item-btn" class="w-full lg:w-auto bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-sm transition-all flex items-center justify-center h-[38px] mb-[1px]">
                                    <i class="fa-solid fa-plus mr-2"></i> Añadir
                                </button>
                            </div>

                            <div id="po-price-info-card" class="hidden mt-4 p-3 rounded-lg border-l-4 text-sm shadow-sm flex items-start gap-3 transition-all duration-300"></div>

                        </div>

                        <div class="flex-grow overflow-y-auto bg-white relative min-h-[250px] z-0">
                            <table class="w-full text-sm text-left border-collapse">
                                <thead class="text-xs text-gray-500 uppercase bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th class="px-6 py-3 bg-gray-50/95 backdrop-blur">Descripción</th>
                                        <th class="px-6 py-3 text-center bg-gray-50/95 backdrop-blur">Cant.</th>
                                        <th class="px-6 py-3 text-right bg-gray-50/95 backdrop-blur">Unitario</th>
                                        <th class="px-6 py-3 text-right bg-gray-50/95 backdrop-blur">Subtotal</th>
                                        <th class="px-6 py-3 text-center bg-gray-50/95 backdrop-blur w-16"></th>
                                    </tr>
                                </thead>
                                <tbody id="po-items-table-body" class="divide-y divide-gray-50 text-gray-700">
                                    </tbody>
                            </table>
                            
                            <div id="po-empty-state" class="absolute inset-0 flex flex-col items-center justify-center text-gray-300 pointer-events-none">
                                <i class="fa-solid fa-basket-shopping text-6xl mb-4 opacity-20"></i>
                                <p class="text-sm font-medium">La orden está vacía</p>
                                <p class="text-xs">Usa la barra superior para agregar ítems</p>
                            </div>
                        </div>

                        <div class="bg-gray-50 p-4 border-t border-gray-200 flex justify-end items-center gap-4 relative z-20">
                            <div class="text-right">
                                <p class="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Orden</p>
                                <p id="po-total-display" class="text-3xl font-black text-gray-800 leading-none tracking-tight">$ 0</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // 3. Lógica de Carga y Eventos
            const loadDataAndBuildForm = async () => {
                try {
                    const loader = document.getElementById('material-request-loader');
                    const formContent = document.getElementById('material-request-form-content');

                    // Carga inicial de datos
                    const [materialSnap, dotacionSnap, toolsSnap, suppliersSnapshot] = await Promise.all([
                        getDocs(query(collection(db, "materialCatalog"), orderBy("name"))),
                        getDocs(query(collection(db, "dotacionCatalog"), orderBy("itemName"))),
                        getDocs(query(collection(db, "tools"), orderBy("name"))),
                        getDocs(query(collection(db, "suppliers"), orderBy("name")))
                    ]);

                    // Configurar Selector de Proveedor
                    const supplierSelect = document.getElementById('po-supplier-select');
                    const suppliers = suppliersSnapshot.docs.map(doc => ({ value: doc.id, label: doc.data().name }));
                    new Choices(supplierSelect, {
                        choices: suppliers,
                        itemSelectText: '',
                        searchPlaceholderValue: 'Buscar proveedor...',
                        placeholder: true,
                        placeholderValue: 'Selecciona un proveedor',
                        shouldSort: false
                    });

                    // Unificar Ítems y Clasificar
                    const unifiedItemOptions = [];

                    materialSnap.forEach(doc => {
                        const m = doc.data();
                        unifiedItemOptions.push({ value: doc.id, label: `${m.name} (${m.reference || '-'})`, customProperties: { type: 'material', unit: m.unit } });
                    });
                    dotacionSnap.forEach(doc => {
                        const d = doc.data();
                        unifiedItemOptions.push({ value: doc.id, label: `[DOT] ${d.itemName} (T: ${d.talla})`, customProperties: { type: 'dotacion', unit: 'Und' } });
                    });
                    toolsSnap.forEach(doc => {
                        const t = doc.data();
                        if (t.status === 'disponible' || t.status === 'mantenimiento') {
                            unifiedItemOptions.push({ value: doc.id, label: `[HER] ${t.name}`, customProperties: { type: 'herramienta', unit: 'Und' } });
                        }
                    });

                    // Ordenamiento Personalizado (1.Material, 2.Dotación, 3.Herramienta)
                    const typePriority = { 'material': 1, 'dotacion': 2, 'herramienta': 3 };
                    unifiedItemOptions.sort((a, b) => {
                        const priorityA = typePriority[a.customProperties.type] || 99;
                        const priorityB = typePriority[b.customProperties.type] || 99;
                        if (priorityA !== priorityB) return priorityA - priorityB;
                        return a.label.localeCompare(b.label);
                    });

                    // Inicializar Selector de Ítems
                    const itemSelect = document.getElementById('po-add-item-select');
                    const itemChoices = new Choices(itemSelect, {
                        choices: unifiedItemOptions,
                        itemSelectText: 'Seleccionar',
                        searchPlaceholderValue: 'Buscar material...',
                        placeholder: true,
                        placeholderValue: 'Escribe para buscar...',
                        searchResultLimit: 8,
                        shouldSort: false
                    });

                    // Mostrar formulario
                    loader.classList.add('hidden');
                    formContent.classList.remove('hidden');

                    // --- Lógica Interactiva ---
                    const addBtn = document.getElementById('po-add-item-btn');
                    const tableBody = document.getElementById('po-items-table-body');
                    const totalDisplay = document.getElementById('po-total-display');
                    const quantityInput = document.getElementById('po-add-quantity');
                    const costInput = document.getElementById('po-add-cost');
                    const emptyState = document.getElementById('po-empty-state');

                    setupCurrencyInput(costInput);

                    const updatePOTotal = () => {
                        let total = 0;
                        const rows = tableBody.querySelectorAll('tr');
                        rows.forEach(row => total += parseFloat(row.dataset.subtotal) || 0);
                        totalDisplay.textContent = currencyFormatter.format(total);
                        if (rows.length === 0) emptyState.classList.remove('hidden');
                        else emptyState.classList.add('hidden');
                    };

                    // Lógica Inteligente de Precios y Tarjeta Informativa
                    itemSelect.addEventListener('change', async () => {
                        const item = itemChoices.getValue();
                        const currentSupplierId = supplierSelect.value;

                        // Referencia a la nueva tarjeta fija
                        const infoCard = document.getElementById('po-price-info-card');

                        // 1. Resetear interfaz
                        if (infoCard) {
                            infoCard.classList.add('hidden');
                            infoCard.className = "hidden mt-4 p-3 rounded-lg border-l-4 text-sm shadow-sm flex items-start gap-3 transition-all duration-300";
                            infoCard.innerHTML = '';
                        }
                        costInput.classList.remove('border-green-500', 'text-green-700', 'border-yellow-500', 'bg-green-50');
                        costInput.placeholder = "0";

                        if (!item || !currentSupplierId) return;

                        costInput.placeholder = "Buscando...";

                        // 2. Consultar precios
                        const [myPrice, bestMarketOption] = await Promise.all([
                            findLastPurchasePrice(currentSupplierId, item.value),
                            findBestMarketPrice(item.value)
                        ]);

                        // 3. Rellenar input
                        let currentPriceVal = 0;
                        if (myPrice) {
                            currentPriceVal = myPrice;
                            costInput.value = currencyFormatter.format(myPrice).replace(/\s/g, ' ');
                        } else {
                            costInput.value = '';
                        }

                        // 4. Lógica de la Tarjeta Informativa
                        if (bestMarketOption) {
                            const marketPrice = bestMarketOption.price;
                            const marketSupplier = bestMarketOption.supplierName;
                            const marketDate = bestMarketOption.date ? new Date(bestMarketOption.date).toLocaleDateString() : 'Reciente';

                            if (currentPriceVal > 0 && marketPrice < currentPriceVal) {
                                // CASO A: MÁS CARO (Tarjeta Roja/Amarilla de Advertencia)
                                const diff = currentPriceVal - marketPrice;
                                const percent = Math.round((diff / marketPrice) * 100);

                                infoCard.className = "mt-4 p-3 rounded-lg border border-red-200 border-l-4 border-l-red-500 bg-red-50 text-red-800 flex items-start gap-3 animate-pulse-slow";
                                infoCard.innerHTML = `
                                    <div class="mt-0.5 text-red-600 text-lg"><i class="fa-solid fa-circle-exclamation"></i></div>
                                    <div class="flex-grow">
                                        <p class="font-bold">¡Opción más económica disponible!</p>
                                        <p class="mt-1">
                                            El proveedor <strong>${marketSupplier}</strong> vendió este ítem a 
                                            <span class="font-black bg-white px-1 rounded border border-red-200">${currencyFormatter.format(marketPrice)}</span> 
                                            (${marketDate}).
                                        </p>
                                        <p class="mt-1 text-xs font-semibold text-red-700">
                                            <i class="fa-solid fa-chart-line"></i> Estás pagando un 
                                            <span class="underline">${percent}% más caro</span> (${currencyFormatter.format(diff)} extra/und).
                                        </p>
                                    </div>
                                `;
                                infoCard.classList.remove('hidden');
                                costInput.classList.add('border-yellow-500');

                            } else if (currentPriceVal === 0) {
                                // CASO B: NUEVO (Tarjeta Azul de Referencia)
                                infoCard.className = "mt-4 p-3 rounded-lg border border-blue-200 border-l-4 border-l-blue-500 bg-blue-50 text-blue-800 flex items-start gap-3";
                                infoCard.innerHTML = `
                                    <div class="mt-0.5 text-blue-600 text-lg"><i class="fa-solid fa-circle-info"></i></div>
                                    <div class="flex-grow">
                                        <p class="font-bold">Referencia de Mercado</p>
                                        <p class="mt-1">
                                            No tienes historial con este proveedor. El mejor precio registrado es 
                                            <span class="font-bold text-blue-700">${currencyFormatter.format(marketPrice)}</span> 
                                            (por ${marketSupplier}).
                                        </p>
                                    </div>
                                `;
                                infoCard.classList.remove('hidden');

                            } else {
                                // CASO C: MEJOR PRECIO (Tarjeta Verde de Confirmación)
                                infoCard.className = "mt-4 p-3 rounded-lg border border-green-200 border-l-4 border-l-green-500 bg-green-50 text-green-800 flex items-start gap-3";
                                infoCard.innerHTML = `
                                    <div class="mt-0.5 text-green-600 text-lg"><i class="fa-solid fa-circle-check"></i></div>
                                    <div>
                                        <p class="font-bold">¡Excelente Precio!</p>
                                        <p class="text-xs mt-0.5">Este es el precio más bajo del mercado registrado en tu historial.</p>
                                    </div>
                                `;
                                infoCard.classList.remove('hidden');
                                costInput.classList.add('border-green-500', 'text-green-700', 'bg-green-50');
                            }
                        } else {
                            // CASO D: Ítem totalmente nuevo (nunca comprado)
                            infoCard.className = "mt-4 p-3 rounded-lg border border-gray-200 border-l-4 border-l-gray-400 bg-white text-gray-600 flex items-start gap-3";
                            infoCard.innerHTML = `
                                <div class="mt-0.5 text-gray-400 text-lg"><i class="fa-solid fa-asterisk"></i></div>
                                <div>
                                    <p class="font-bold">Primer Registro</p>
                                    <p class="text-xs mt-0.5">Este ítem no tiene historial de compra previo en el sistema.</p>
                                </div>
                            `;
                            infoCard.classList.remove('hidden');
                        }

                        quantityInput.focus();
                    });

                    // Ocultar alerta al escribir manual
                    costInput.addEventListener('input', () => {
                        const alert = document.getElementById('price-alert-container');
                        if (alert) alert.classList.add('hidden');
                    });

                    // Agregar a la tabla
                    addBtn.addEventListener('click', () => {
                        const item = itemChoices.getValue();
                        const qty = parseInt(quantityInput.value);
                        const cost = parseFloat(costInput.value.replace(/[$. ]/g, '')) || 0;

                        if (!item || !qty || qty <= 0 || cost <= 0) {
                            alert("Por favor completa el ítem, cantidad y costo.");
                            return;
                        }

                        // Verificar duplicado para sumar
                        const existingRow = tableBody.querySelector(`tr[data-item-id="${item.value}"][data-cost="${cost}"]`);
                        if (existingRow) {
                            const oldQty = parseInt(existingRow.dataset.quantity);
                            const newQty = oldQty + qty;
                            const newSub = newQty * cost;
                            existingRow.dataset.quantity = newQty;
                            existingRow.dataset.subtotal = newSub;
                            existingRow.classList.add('bg-blue-50');
                            setTimeout(() => existingRow.classList.remove('bg-blue-50'), 300);
                            existingRow.cells[1].innerHTML = `<span class="font-bold text-blue-600">${newQty}</span>`;
                            existingRow.cells[3].textContent = currencyFormatter.format(newSub);
                        } else {
                            const subtotal = qty * cost;
                            const tr = document.createElement('tr');
                            tr.className = "hover:bg-gray-50 group transition-colors";
                            tr.dataset.itemId = item.value;
                            tr.dataset.itemType = item.customProperties.type;
                            tr.dataset.quantity = qty;
                            tr.dataset.cost = cost;
                            tr.dataset.subtotal = subtotal;

                            tr.innerHTML = `
                                <td class="px-6 py-3">
                                    <p class="font-bold text-gray-800 text-sm">${item.label}</p>
                                    <p class="text-[10px] text-gray-400 uppercase">${item.customProperties.type}</p>
                                </td>
                                <td class="px-6 py-3 text-center font-bold text-gray-700">${qty}</td>
                                <td class="px-6 py-3 text-right text-gray-600 font-mono text-xs">${currencyFormatter.format(cost)}</td>
                                <td class="px-6 py-3 text-right font-bold text-gray-800">${currencyFormatter.format(subtotal)}</td>
                                <td class="px-6 py-3 text-center">
                                    <button type="button" class="remove-row-btn text-gray-300 hover:text-red-500 transition-colors p-2">
                                        <i class="fa-solid fa-trash-can"></i>
                                    </button>
                                </td>
                            `;
                            tableBody.appendChild(tr);
                            tableBody.parentElement.scrollTop = tableBody.parentElement.scrollHeight;
                        }
                        // Reset
                        quantityInput.value = '';
                        costInput.value = '';
                        itemChoices.setChoiceByValue('');
                        updatePOTotal();


                        const infoCard = document.getElementById('po-price-info-card');
                        if (infoCard) infoCard.classList.add('hidden'); // Ocultar tarjeta al agregar
                        costInput.classList.remove('border-green-500', 'text-green-700', 'border-yellow-500', 'bg-green-50'); // Reset inputs

                    });

                    // Borrar fila
                    tableBody.addEventListener('click', (e) => {
                        const btn = e.target.closest('.remove-row-btn');
                        if (btn) {
                            btn.closest('tr').remove();
                            updatePOTotal();
                        }
                    });

                } catch (error) {
                    console.error(error);
                    document.getElementById('material-request-form-content').innerHTML = `<p class="text-red-500 text-center p-4">Error al cargar: ${error.message}</p>`;
                }
            };

            setTimeout(loadDataAndBuildForm, 100);
            break;
        }

        case 'request-loan':
            title = 'Solicitar Préstamo / Adelanto';
            btnText = 'Enviar Solicitud';
            btnClass = 'bg-indigo-600 hover:bg-indigo-700';
            bodyHtml = `
                <div class="space-y-4">
                    <div class="p-3 bg-blue-50 text-blue-800 rounded-lg text-sm mb-4">
                        <i class="fa-solid fa-circle-info mr-2"></i>
                        La solicitud será revisada por administración. Si se aprueba, se descontará de tus próximos pagos.
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Monto Solicitado</label>
                        <input type="text" name="amount" required class="currency-input mt-1 w-full border rounded-md p-3 text-lg font-bold text-gray-800" placeholder="$ 0">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Fecha Deseada</label>
                        <input type="date" name="date" required class="mt-1 w-full border rounded-md p-2" value="${new Date().toISOString().split('T')[0]}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Motivo / Descripción</label>
                        <textarea name="description" rows="3" required class="mt-1 w-full border rounded-md p-2" placeholder="Ej: Calamidad doméstica, arreglo moto..."></textarea>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Cuotas Sugeridas (Opcional)</label>
                        <input type="number" name="installments" min="1" max="12" value="1" class="mt-1 w-full border rounded-md p-2">
                        <p class="text-xs text-gray-500 mt-1">Número de pagos en los que te gustaría diferirlo.</p>
                    </div>
                </div>
            `;
            setTimeout(() => {
                const amountInput = modalForm.querySelector('.currency-input');
                setupCurrencyInput(amountInput);
            }, 100);
            break;

        // --- CASO: VER PRÉSTAMOS PENDIENTES (ADMIN) ---
        case 'view-pending-loans':
            title = 'Solicitudes de Préstamo Pendientes';
            btnText = 'Cerrar';
            btnClass = 'bg-gray-500 hover:bg-gray-600 hidden'; // Ocultamos el botón principal del modal

            // Estructura del contenedor de la lista con loader inicial
            bodyHtml = `
                <div id="pending-loans-list" class="space-y-4 min-h-[200px]">
                    <div class="flex justify-center items-center h-32">
                        <div class="loader"></div>
                    </div>
                </div>
            `;

            // Lógica de carga asíncrona para Préstamos Pendientes
            setTimeout(async () => {
                const listContainer = document.getElementById('pending-loans-list');
                const fmtMoney = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

                try {
                    const q = query(collectionGroup(db, 'loans'), where('status', '==', 'pending'));
                    const snapshot = await getDocs(q);

                    if (snapshot.empty) {
                        listContainer.innerHTML = `
                            <div class="flex flex-col items-center justify-center py-12 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
                                <div class="bg-white p-4 rounded-full shadow-sm mb-3">
                                    <i class="fa-solid fa-check text-3xl text-green-500"></i>
                                </div>
                                <p class="font-medium text-lg">¡Todo al día!</p>
                                <p class="text-sm">No hay solicitudes pendientes.</p>
                            </div>`;
                        return;
                    }

                    listContainer.innerHTML = '';

                    for (const loanDoc of snapshot.docs) {
                        const loan = loanDoc.data();
                        const userRef = loanDoc.ref.parent.parent;
                        const userSnap = await getDoc(userRef);

                        let userData = {
                            firstName: 'Usuario', lastName: 'Desconocido',
                            bankName: '---', accountType: '', accountNumber: '---',
                            photoURL: null
                        };
                        if (userSnap.exists()) userData = userSnap.data();

                        const userName = `${userData.firstName} ${userData.lastName}`;
                        const dateObj = loan.date ? new Date(loan.date) : new Date();
                        const dateStr = dateObj.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
                        const initials = (userData.firstName.charAt(0) + userData.lastName.charAt(0)).toUpperCase();

                        // Lógica de Foto: Si tiene URL úsala, si no, usa un generador de avatares
                        const userPhoto = userData.photoURL || `https://ui-avatars.com/api/?name=${userData.firstName}+${userData.lastName}&background=random&color=fff`;

                        // --- AGREGAMOS userPhoto AL JSON ---
                        const loanDataJson = JSON.stringify({
                            id: loanDoc.id, uid: userRef.id, userName: userName,
                            amount: loan.amount, date: loan.date,
                            description: loan.description, installments: loan.installments,
                            bankName: userData.bankName || 'No registrado',
                            accountType: userData.accountType || '',
                            accountNumber: userData.accountNumber || '---',
                            userPhoto: userPhoto // <--- NUEVO CAMPO
                        }).replace(/"/g, '&quot;');

                        // Tarjeta de listado
                        const card = document.createElement('div');
                        card.className = "bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all overflow-hidden group";

                        card.innerHTML = `
                            <div class="px-4 py-3 border-b border-gray-100 bg-slate-50 flex justify-between items-center">
                                <div class="flex items-center gap-3">
                                    <img src="${userPhoto}" alt="${userName}" class="w-8 h-8 rounded-full object-cover border border-indigo-200">
                                    <div>
                                        <h4 class="text-sm font-bold text-gray-800 leading-tight">${userName}</h4>
                                        <p class="text-[10px] text-gray-500">Solicitado el ${dateStr}</p>
                                    </div>
                                </div>
                                <span class="px-2 py-1 bg-yellow-100 text-yellow-700 text-[10px] font-bold uppercase tracking-wider rounded-md border border-yellow-200">Pendiente</span>
                            </div>

                            <div class="p-0 grid grid-cols-1 md:grid-cols-2">
                                <div class="p-4 flex flex-col justify-between">
                                    <div>
                                        <p class="text-xs text-gray-400 uppercase font-bold tracking-wide mb-1">Monto Solicitado</p>
                                        <p class="text-2xl font-bold text-gray-800 mb-3">${fmtMoney.format(loan.amount || 0)} <span class="text-xs font-normal text-gray-400">(${loan.installments || 1} cuotas)</span></p>
                                        <div class="bg-gray-50 p-2 rounded-lg border border-gray-100">
                                            <p class="text-xs text-gray-500 italic leading-relaxed"><i class="fa-solid fa-quote-left text-gray-300 mr-1"></i> ${loan.description || 'Sin descripción'}</p>
                                        </div>
                                    </div>
                                </div>
                                <div class="bg-indigo-50 p-4 border-t md:border-t-0 md:border-l border-indigo-100 flex flex-col justify-center">
                                    <div class="flex items-start gap-3">
                                        <div class="p-2 bg-white rounded-lg text-indigo-600 shadow-sm"><i class="fa-solid fa-building-columns text-lg"></i></div>
                                        <div class="flex-1 min-w-0">
                                            <p class="text-[10px] text-indigo-400 uppercase font-bold">Cuenta de Destino</p>
                                            <p class="text-sm font-bold text-indigo-900 truncate">${userData.bankName}</p>
                                            <p class="text-xs text-indigo-700 mb-1">${userData.accountType}</p>
                                            <div class="flex items-center gap-2 bg-white px-2 py-1 rounded border border-indigo-100 w-fit">
                                                <span class="font-mono text-sm font-bold text-gray-700 select-all">${userData.accountNumber}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="px-4 py-3 bg-gray-50 border-t border-gray-200 flex justify-end">
                                <button data-action="open-loan-review" data-loan='${loanDataJson}' class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-sm hover:shadow transition-all flex items-center">
                                    Revisar y Aprobar <i class="fa-solid fa-arrow-right ml-2"></i>
                                </button>
                            </div>
                        `;
                        listContainer.appendChild(card);
                    }
                } catch (error) {
                    console.error("Error cargando préstamos:", error);
                    listContainer.innerHTML = `<div class="p-4 text-center text-red-500">Error al cargar datos.</div>`;
                }
            }, 100);
            break;

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

        case 'new-dotacion-catalog-item': {
            title = 'Nuevo Tipo de Ítem (Catálogo)';
            btnText = 'Crear Ítem';
            btnClass = 'bg-blue-500 hover:bg-blue-600';

            const categoryOptions = `
                <option value="EPP" selected>EPP (Protección)</option>
                <option value="Uniforme">Uniforme</option>
                <option value="Otro">Otro</option>
            `;

            bodyHtml = `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="md:col-span-1">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Foto del Ítem (Opcional)</label>
                        <div id="new-dotacion-dropzone" class="aspect-square w-full rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-500 bg-gray-50 relative overflow-hidden">
                            <div id="new-dotacion-preview" class="hidden absolute inset-0">
                                <img src="" id="new-dotacion-img-preview" class="w-full h-full object-contain">
                            </div>
                            <div id="new-dotacion-prompt" class="text-center p-4">
                                <svg class="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                                <p class="mt-2 text-sm text-gray-500">Foto del ítem (ej. Casco)</p>
                            </div>
                        </div>
                        <input type="file" id="dotacion-photo" name="photo" accept="image/*" class="hidden">
                    </div>

                <div class="md:col-span-2 space-y-4 pt-5">
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Nombre del Ítem</label>
                        <input type="text" name="itemName" required class="mt-1 w-full border rounded-md p-2" placeholder="Ej: Casco de Seguridad Blanco">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Referencia / SKU (Opcional)</label>
                        <input type="text" name="reference" class="mt-1 w-full border rounded-md p-2" placeholder="Ej: REF-CS-001">
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Categoría</label>
                            <select name="category" required class="mt-1 w-full border rounded-md p-2 bg-white">
                                ${categoryOptions}
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Talla (Opcional)</label>
                            <input type="text" name="talla" class="mt-1 w-full border rounded-md p-2" placeholder="Ej: L, 42, N/A">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div id="dotacion-initial-stock-group">
                            <label class="block text-sm font-medium text-gray-700">Stock Inicial (Opcional)</label>
                            <input type="number" name="initialStock" class="mt-1 w-full border rounded-md p-2" value="0" min="0">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Vida Útil (Días)</label>
                            <input type="number" name="vidaUtilDias" class="mt-1 w-full border rounded-md p-2" placeholder="Ej: 365 (para 1 año)">
                        </div>
                    </div>
                </div>
            `;

            setTimeout(() => { // Lógica para la vista previa de la foto (sin cambios)
                const dropzone = document.getElementById('new-dotacion-dropzone');
                const fileInput = document.getElementById('dotacion-photo');
                const previewContainer = document.getElementById('new-dotacion-preview');
                const previewImg = document.getElementById('new-dotacion-img-preview');
                const promptEl = document.getElementById('new-dotacion-prompt');
                if (dropzone) {
                    dropzone.addEventListener('click', () => fileInput.click());
                    fileInput.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                                previewImg.src = event.target.result;
                                previewContainer.classList.remove('hidden');
                                promptEl.classList.add('hidden');
                            }
                            reader.readAsDataURL(file);
                        }
                    });
                }
            }, 100);
            break;
        }

        case 'edit-dotacion-catalog-item': {
            title = 'Editar Ítem del Catálogo';
            btnText = 'Actualizar Ítem';
            btnClass = 'bg-yellow-500 hover:bg-yellow-600';
            modalForm.dataset.id = data.id; // Pasa el ID del ítem al formulario

            // Re-crear las opciones de categoría, seleccionando la correcta
            const categories = [
                { value: "EPP", label: "EPP (Protección)" },
                { value: "Uniforme", label: "Uniforme" },
                { value: "Otro", label: "Otro" }
            ];
            const categoryOptions = categories.map(cat =>
                `<option value="${cat.value}" ${data.category === cat.value ? 'selected' : ''}>${cat.label}</option>`
            ).join('');

            // Construimos el HTML, rellenando los 'value' con los datos existentes
            bodyHtml = `
                <input type="hidden" name="itemId" value="${data.id}">

                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="md:col-span-1">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Foto del Ítem (Opcional)</label>
                        <div id="new-dotacion-dropzone" class="aspect-square w-full rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-500 bg-gray-50 relative overflow-hidden">
                            
                            <div id="new-dotacion-preview" class="absolute inset-0">
                                <img src="${data.itemPhotoURL || 'https://via.placeholder.com/300'}" id="new-dotacion-img-preview" class="w-full h-full object-contain">
                            </div>

                            <div id="new-dotacion-prompt" class="hidden text-center p-4">
                                <svg class="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                                <p class="mt-2 text-sm text-gray-500">Reemplazar foto</p>
                            </div>
                        </div>
                        <input type="file" id="dotacion-photo" name="photo" accept="image/*" class="hidden">
                    </div>

                    <div class="md:col-span-2 space-y-4 pt-5">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Nombre del Ítem</label>
                            <input type="text" name="itemName" required class="mt-1 w-full border rounded-md p-2" value="${data.itemName || ''}">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Referencia / SKU (Opcional)</label>
                            <input type="text" name="reference" class="mt-1 w-full border rounded-md p-2" value="${data.reference || ''}">
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Categoría</label>
                                <select name="category" required class="mt-1 w-full border rounded-md p-2 bg-white">
                                    ${categoryOptions}
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Talla (Opcional)</label>
                                <input type="text" name="talla" class="mt-1 w-full border rounded-md p-2" value="${data.talla || ''}">
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-4">
                            <div class="col-span-2">
                                <label class="block text-sm font-medium text-gray-700">Vida Útil (Días)</label>
                                <input type="number" name="vidaUtilDias" class="mt-1 w-full border rounded-md p-2" value="${data.vidaUtilDias || ''}" placeholder="Ej: 365 (para 1 año)">
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Reutilizamos la misma lógica de dropzone que 'new-dotacion-catalog-item'
            setTimeout(() => {
                const dropzone = document.getElementById('new-dotacion-dropzone');
                const fileInput = document.getElementById('dotacion-photo');
                const previewContainer = document.getElementById('new-dotacion-preview');
                const previewImg = document.getElementById('new-dotacion-img-preview');
                const promptEl = document.getElementById('new-dotacion-prompt');

                // Lógica para mostrar el prompt si NO hay fotoURL
                if (!data.itemPhotoURL) {
                    previewContainer.classList.add('hidden');
                    promptEl.classList.remove('hidden');
                }

                if (dropzone) {
                    dropzone.addEventListener('click', () => fileInput.click());
                    fileInput.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                                previewImg.src = event.target.result;
                                previewContainer.classList.remove('hidden');
                                promptEl.classList.add('hidden');
                            }
                            reader.readAsDataURL(file);
                        }
                    });
                }
            }, 100);
            break;
        }

        // --- FIN DE NUEVO CÓDIGO ---

        case 'add-dotacion-stock': {
            title = 'Añadir Stock a Inventario';
            btnText = 'Añadir Stock';
            btnClass = 'bg-blue-500 hover:bg-blue-600';


            bodyHtml = `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="md:col-span-1">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Ítem</label>
                        <div class="aspect-square w-full rounded-lg bg-gray-100 overflow-hidden border">
                            <img src="${data.itemPhotoURL || 'https://via.placeholder.com/300'}" alt="${data.itemName}" class="w-full h-full object-contain">
                        </div>
                        <p class="text-center font-bold text-lg mt-2">${data.itemName}</p>
                        <p class="text-center text-sm text-gray-500">${data.talla || 'Sin talla'}</p>
                    </div>
                    <div class="md:col-span-2 space-y-4 pt-5">
                        <input type="hidden" name="itemId" value="${data.id}">
                        <div>
                            <label class="block text-sm font-medium">Cantidad a Añadir</label>
                            <input type="number" name="quantity" required class="mt-1 w-full border p-2 rounded-md" min="1">
                        </div>
                        <div>
                            <label class="block text-sm font-medium">Costo Total de la Compra (Opcional)</label>
                            <input type="text" id="dotacion-purchase-cost" name="purchaseCost" class="currency-input mt-1 w-full border rounded-md p-2" placeholder="$ 0">
                        </div>
                    </div>
                </div>
            `;


            setTimeout(() => {
                setupCurrencyInput(document.getElementById('dotacion-purchase-cost'));
            }, 100);
            break;
        }

        case 'register-dotacion-delivery': {
            title = 'Registrar Entrega de Dotación';
            btnText = 'Confirmar Entrega';
            btnClass = 'bg-green-500 hover:bg-green-600';

            const userChoices = Array.from(usersMap.entries())
                .filter(([id, user]) => user.status === 'active')
                .sort((a, b) => a[1].firstName.localeCompare(b[1].firstName))
                .map(([id, user]) => ({
                    value: id,
                    label: `${user.firstName} ${user.lastName}`
                }));


            bodyHtml = `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="md:col-span-1">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Ítem</label>
                        <div class="aspect-square w-full rounded-lg bg-gray-100 overflow-hidden border">
                            <img src="${data.itemPhotoURL || 'https://via.placeholder.com/300'}" alt="${data.itemName}" class="w-full h-full object-contain">
                        </div>
                        <p class="text-center font-bold text-lg mt-2">${data.itemName}</p>
                        <p class="text-center text-sm text-gray-500">${data.talla || 'Sin talla'}</p>
                        <p class="text-lg text-center font-bold mt-2 ${data.quantityInStock > 0 ? 'text-green-600' : 'text-red-600'}">Stock: ${data.quantityInStock}</p>
                        <input type="hidden" name="itemId" value="${data.id}">
                        <input type="hidden" name="itemName" value="${data.itemName}">
                        <input type="hidden" name="talla" value="${data.talla}">
                    </div>
                    
                    <div class="md:col-span-2 space-y-4">
                        <div>
                            <label class="block text-sm font-medium">1. Seleccionar Colaborador</label>
                            <select id="dotacion-assignedTo" name="assignedTo" required class="mt-1 w-full border rounded-md"></select>
                            
                            <div id="preferred-talla-suggestion" class="hidden text-sm text-blue-600 font-semibold text-center mt-2 p-2 bg-blue-50 rounded-md border border-blue-200">
                                </div>
                            </div>

                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium">2. Cantidad a Entregar</label>
                                <input type="number" name="quantity" required class="mt-1 w-full border p-2 rounded-md" min="1" max="${data.quantityInStock}" ${data.quantityInStock <= 0 ? 'disabled' : ''}>
                            </div>
                            <div>
                                <label class="block text-sm font-medium">3. Serial (Opcional)</label>
                                <input type="text" name="serialNumber" class="mt-1 w-full border p-2 rounded-md" placeholder="Ej: 11-22-33-44">
                            </div>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">4. Foto de Entrega (Requerida)</label>
                            <div id="assign-dotacion-dropzone" class="h-48 w-full rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-500 bg-gray-50 relative overflow-hidden">
                                <div id="assign-dotacion-preview" class="hidden absolute inset-0"><img src="" id="assign-dotacion-img-preview" class="w-full h-full object-contain"></div>
                                <div id="assign-dotacion-prompt" class="text-center p-4">
                                    <svg class="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                                    <p class="mt-2 text-sm text-gray-500">Subir foto de entrega</p>
                                </div>
                            </div>
                            
                            <input type="file" id="dotacion-assign-photo" name="assignPhoto" required accept="image/*" class="hidden">
                            </div>
                        <div>
                            <label class"block text-sm font-medium">4. Fecha de Entrega</label>
                            <input type="date" name="fechaEntrega" required class="mt-1 w-full border p-2 rounded-md">
                        </div>
                    </div>
                </div>
            `;

            setTimeout(() => {
                const assigneeSelect = document.getElementById('dotacion-assignedTo');
                if (assigneeSelect) {
                    // --- INICIO DE MODIFICACIÓN (Lógica JS) ---

                    // 1. Inicializamos Choices
                    const choicesInstance = new Choices(assigneeSelect, {
                        choices: userChoices,
                        itemSelectText: 'Seleccionar',
                        searchPlaceholderValue: 'Buscar colaborador...',
                        placeholder: true,
                        placeholderValue: 'Selecciona un usuario...',
                    });

                    // 2. Añadimos el listener 'change'
                    assigneeSelect.addEventListener('change', (event) => {
                        const suggestionDiv = document.getElementById('preferred-talla-suggestion');
                        if (!event.detail.value || !suggestionDiv) {
                            suggestionDiv.classList.add('hidden');
                            return;
                        }

                        const userId = event.detail.value;
                        const user = usersMap.get(userId); // Usamos el mapa de usuarios (¡eficiente!)
                        const itemNameLower = data.itemName.toLowerCase();

                        let preferredTalla = '';

                        // Hacemos el "match" entre el ítem y la talla guardada
                        if (itemNameLower.includes('camisa') || itemNameLower.includes('camiseta') || itemNameLower.includes('buzo')) {
                            preferredTalla = user.tallaCamiseta;
                        } else if (itemNameLower.includes('pantalón') || itemNameLower.includes('pantalon') || itemNameLower.includes('jean')) {
                            preferredTalla = user.tallaPantalón;
                        } else if (itemNameLower.includes('bota')) {
                            preferredTalla = user.tallaBotas;
                        }

                        // Mostramos u ocultamos la sugerencia
                        if (preferredTalla) {
                            suggestionDiv.textContent = `Talla preferida del usuario: ${preferredTalla}`;
                            suggestionDiv.classList.remove('hidden');
                        } else {
                            suggestionDiv.classList.add('hidden');
                        }
                    });

                    // --- FIN DE MODIFICACIÓN (Lógica JS) ---
                }
                // Lógica para la vista previa de la foto (copiada)
                const dropzone = document.getElementById('assign-dotacion-dropzone');
                const fileInput = document.getElementById('dotacion-assign-photo');
                const previewContainer = document.getElementById('assign-dotacion-preview');
                const previewImg = document.getElementById('assign-dotacion-img-preview');
                const promptEl = document.getElementById('assign-dotacion-prompt');
                if (dropzone) {
                    dropzone.addEventListener('click', () => fileInput.click());
                    fileInput.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                                previewImg.src = event.target.result;
                                previewContainer.classList.remove('hidden');
                                promptEl.classList.add('hidden');
                            }
                            reader.readAsDataURL(file);
                        }
                    });
                }
                // Set default date to today
                const dateInput = modalForm.querySelector('input[name="fechaEntrega"]');
                if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
            }, 100);
            break;
        }

        // --- INICIO DE CÓDIGO AÑADIDO (MEJORA 1 - DEVOLUCIONES) ---
        case 'return-dotacion-options':
            title = `Registrar Devolución de: ${data.itemName}`;
            btnText = 'Procesar Devolución';
            btnClass = 'bg-blue-500 hover:bg-blue-600';

            modalForm.dataset.id = data.historyId; // ID del registro de historial
            modalForm.dataset.itemid = data.itemId;   // ID del ítem en el catálogo

            bodyHtml = `
                <input type="hidden" name="itemName" value="${data.itemName}">
                
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="md:col-span-1">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Foto de Devolución (Req.)</label>
                        <div id="return-dotacion-dropzone" class="aspect-square w-full rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-500 bg-gray-50 relative overflow-hidden">
                            <div id="return-dotacion-preview" class="hidden absolute inset-0">
                                <img src="" id="return-dotacion-img-preview" class="w-full h-full object-contain">
                            </div>
                            <div id="return-dotacion-prompt" class="text-center p-4">
                                <svg class="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                                <p class="mt-2 text-sm text-gray-500">Foto del ítem devuelto</p>
                            </div>
                        </div>
                        <input type="file" id="dotacion-return-photo" name="returnPhoto" required accept="image/*" class="hidden">
                    </div>

                    <div class="md:col-span-2 space-y-4">
                        <div>
                            <p class="text-sm font-medium text-gray-700 mb-2">1. Selecciona el tipo de devolución:</p>
                            <div class="space-y-3">
                              <label class="flex items-center p-3 border rounded-lg has-[:checked]:bg-blue-50 has-[:checked]:border-blue-500 cursor-pointer">
                                <input type="radio" name="returnType" value="descarte" class="mr-3" checked>
                                <div>
                                  <strong class="font-semibold">Descartar Ítem (EPP)</strong>
                                  <p class="text-xs text-gray-600">No regresa al inventario (ej. casco vencido, guantes rotos).</p>
                                </div>
                              </label>
                              <label class="flex items-center p-3 border rounded-lg has-[:checked]:bg-green-50 has-[:checked]:border-green-500 cursor-pointer">
                                <input type="radio" name="returnType" value="stock" class="mr-3">
                                <div>
                                  <strong class="font-semibold">Devolver a Inventario (Reutilizable)</strong>
                                  <p class="text-xs text-gray-600">Regresa al stock para ser reasignado (ej. uniforme).</p>
                                </div>
                              </label>
                            </div>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium text-gray-700">2. Observaciones (Opcional)</label>
                            <textarea name="observaciones" rows="3" class="mt-1 w-full border rounded-md p-2" placeholder="Ej: Devuelto por rotura en visera..."></textarea>
                        </div>
                    </div>
                </div>
            `;

            // Añadir la lógica de JS para la vista previa de la foto (copiada de 'register-dotacion-delivery')
            setTimeout(() => {
                const dropzone = document.getElementById('return-dotacion-dropzone');
                const fileInput = document.getElementById('dotacion-return-photo');
                const previewContainer = document.getElementById('return-dotacion-preview');
                const previewImg = document.getElementById('return-dotacion-img-preview');
                const promptEl = document.getElementById('return-dotacion-prompt');
                if (dropzone) {
                    dropzone.addEventListener('click', () => fileInput.click());
                    fileInput.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                                previewImg.src = event.target.result;
                                previewContainer.classList.remove('hidden');
                                promptEl.classList.add('hidden');
                            }
                            reader.readAsDataURL(file);
                        }
                    });
                }
            }, 100);

            break;
        // --- FIN DE CÓDIGO AÑADIDO ---

        // --- INICIO DE NUEVO CÓDIGO AÑADIDO ---
        case 'new-tool': {
            title = 'Crear Nueva Herramienta';
            btnText = 'Crear Herramienta';
            btnClass = 'bg-blue-500 hover:bg-blue-600';
            modalContentDiv.classList.add('max-w-2xl'); // Aseguramos el tamaño estándar

            // Opciones de categoría (leídas desde herramientas.js)
            const categoryOptions = TOOL_CATEGORIES.map(cat =>
                `<option value="${cat.value}">${cat.label}</option>`
            ).join('');

            bodyHtml = `
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        
                        <div class="md:col-span-1">
                            <label class="block text-sm font-medium text-gray-700 mb-1">Foto (Requerida)</label>
                            <div id="new-tool-dropzone" class="aspect-square w-full rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-500 bg-gray-50 relative overflow-hidden">
                                <div id="new-tool-preview" class="hidden absolute inset-0">
                                    <img src="" id="new-tool-img-preview" class="w-full h-full object-contain">
                                </div>
                                <div id="new-tool-prompt" class="text-center p-4">
                                    <svg class="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3-3a4 4 0 00-5.656 0L28 28M8 32l9-9a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                                    <p class="mt-2 text-sm text-gray-500">Foto de la herramienta</p>
                                </div>
                            </div>
                            <input type="file" id="tool-photo" name="photo" accept="image/*" class="hidden" required> 
                        </div>
                        
                        <div class="md:col-span-2 space-y-4 pt-5">
                            <div>
                                <label for="tool-name" class="block text-sm font-medium text-gray-700">Nombre de la Herramienta</label>
                                <input type="text" id="tool-name" name="name" required class="mt-1 w-full border rounded-md p-2" placeholder="Ej: Taladro Percutor">
                            </div>
                            <div>
                                <label for="tool-reference" class="block text-sm font-medium text-gray-700">Referencia / Código (Opcional)</label>
                                <input type="text" id="tool-reference" name="reference" class="mt-1 w-full border rounded-md p-2" placeholder="Ej: DEW-DCD796">
                            </div>
                            
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <label for="tool-category" class="block text-sm font-medium text-gray-700">Categoría</label>
                                    <select id="tool-category" name="category" required class="mt-1 w-full border rounded-md p-2 bg-white">
                                        <option value="" disabled selected>Seleccione...</option>
                                        ${categoryOptions}
                                    </select>
                                </div>
                                <div>
                                    <label for="tool-purchaseDate" class="block text-sm font-medium text-gray-700">Fecha de Compra</label>
                                    <input type="date" id="tool-purchaseDate" name="purchaseDate" class="mt-1 w-full border rounded-md p-2">
                                </div>
                            </div>
                            <div>
                                <label for="tool-purchaseCost" class="block text-sm font-medium text-gray-700">Costo de Adquisición (Opcional)</label>
                                <input type="text" id="tool-purchaseCost" name="purchaseCost" class="currency-input mt-1 w-full border rounded-md p-2" placeholder="$ 0">
                            </div>
                        </div>
                    </div>
                `;

            // Lógica JS para el dropzone y el formateo de moneda
            setTimeout(() => {
                const dropzone = document.getElementById('new-tool-dropzone');
                const fileInput = document.getElementById('tool-photo');
                const previewContainer = document.getElementById('new-tool-preview');
                const previewImg = document.getElementById('new-tool-img-preview');
                const promptEl = document.getElementById('new-tool-prompt');

                if (dropzone) {
                    dropzone.addEventListener('click', () => fileInput.click());
                    fileInput.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                                previewImg.src = event.target.result;
                                previewContainer.classList.remove('hidden');
                                promptEl.classList.add('hidden');
                            }
                            reader.readAsDataURL(file);
                        }
                    });
                }

                const costInput = document.getElementById('tool-purchaseCost');
                if (costInput) setupCurrencyInput(costInput); // Función que ya existe en app.js

                const dateInput = document.getElementById('tool-purchaseDate');
                if (dateInput) dateInput.value = new Date().toISOString().split('T')[0]; // Pone la fecha de hoy

            }, 100);

            break;
        }
        // --- FIN DE NUEVO CÓDIGO AÑADIDO ---

        case 'edit-tool': {
            title = 'Editar Herramienta (Info Básica)';
            btnText = 'Guardar Cambios';
            btnClass = 'bg-yellow-500 hover:bg-yellow-600';

            // --- INICIO DE CÓDIGO AÑADIDO ---
            const categoryOptions = TOOL_CATEGORIES.map(cat =>
                `<option value="${cat.value}" ${data.category === cat.value ? 'selected' : ''}>${cat.label}</option>`
            ).join('');
            // --- FIN DE CÓDIGO AÑADIDO ---

            bodyHtml = `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    
                    <div class="md:col-span-1">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Foto Actual</label>
                        <div class="aspect-square w-full rounded-lg bg-gray-100 overflow-hidden border">
                            <img src="${data.photoURL || 'https://via.placeholder.com/300'}" 
                                 alt="${data.name || ''}" 
                                 class="w-full h-full object-contain">
                        </div>
                    </div>
                    
                    <div class="md:col-span-2 space-y-4 pt-5">
                        <div>
                            <label for="tool-name" class="block text-sm font-medium text-gray-700">Nombre de la Herramienta</label>
                            <input type="text" id="tool-name" name="name" required class="mt-1 w-full border rounded-md p-2" value="${data.name || ''}">
                        </div>
                        <div>
                            <label for="tool-reference" class="block text-sm font-medium text-gray-700">Referencia / Código (Opcional)</label>
                            <input type="text" id="tool-reference" name="reference" class="mt-1 w-full border rounded-md p-2" value="${data.reference || ''}">
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label for="tool-category" class="block text-sm font-medium text-gray-700">Categoría</label>
                                <select id="tool-category" name="category" required class="mt-1 w-full border rounded-md p-2 bg-white">
                                    <option value="" disabled>Seleccione...</option>
                                    ${categoryOptions}
                                </select>
                            </div>
                            <div>
                                <label for="tool-purchaseDate" class="block text-sm font-medium text-gray-700">Fecha de Compra</label>
                                <input type="date" id="tool-purchaseDate" name="purchaseDate" class="mt-1 w-full border rounded-md p-2" value="${data.purchaseDate || ''}">
                            </div>
                        </div>
                        <div>
                            <label for="tool-purchaseCost" class="block text-sm font-medium text-gray-700">Costo de Adquisición (Opcional)</label>
                            <input type="text" id="tool-purchaseCost" name="purchaseCost" class="currency-input mt-1 w-full border rounded-md p-2" placeholder="$ 0" value="${data.purchaseCost || 0}">
                        </div>
                        <p class="text-xs text-gray-500 pt-2">El estado y la asignación se gestionan mediante las acciones "Asignar" y "Recibir".</p>
                    </div>
                </div>
            `;

            // --- INICIO DE CÓDIGO AÑADIDO ---
            setTimeout(() => {
                const costInput = document.getElementById('tool-purchaseCost');
                if (costInput) setupCurrencyInput(costInput); // Aplicar formato al costo existente
            }, 100);
            // --- FIN DE CÓDIGO AÑADIDO ---
            break;
        }

        case 'assign-tool': {
            title = 'Asignar Herramienta';
            btnText = 'Confirmar Asignación';
            btnClass = 'bg-green-500 hover:bg-green-600';

            // --- INICIO DE CORRECCIÓN ---
            // Generamos un array de objetos (choices) en lugar de un string HTML
            const userChoices = Array.from(usersMap.entries())
                .filter(([id, user]) => user.status === 'active') // Solo usuarios activos
                .sort((a, b) => a[1].firstName.localeCompare(b[1].firstName)) // Ordenamos alfabéticamente
                .map(([id, user]) => ({
                    value: id,
                    label: `${user.firstName} ${user.lastName}`
                }));
            // --- FIN DE CORRECCIÓN ---

            // --- INICIO DE MODIFICACIÓN: FORMATO MODERNO ---
            bodyHtml = `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    
                    <div class="md:col-span-1">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Herramienta</label>
                        <div class="aspect-square w-full rounded-lg bg-gray-100 overflow-hidden border">
                            <img src="${data.photoURL || 'https://via.placeholder.com/300'}" 
                                 alt="${data.name || ''}" 
                                 class="w-full h-full object-contain">
                        </div>
                        <p class="text-center font-bold text-lg mt-2">${data.name || 'N/A'}</p>
                        <input type="hidden" name="toolName" value="${data.name || ''}">
                    </div>
                    
                    <div class="md:col-span-2 space-y-4">
                        <div>
                            <label for="tool-assignedTo" class="block text-sm font-medium">1. Seleccionar Colaborador</label>
                            <select id="tool-assignedTo" name="assignedTo" required class="mt-1 w-full border rounded-md"></select>
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">2. Foto de Evidencia (Entrega)</label>
                                <div id="assign-tool-dropzone" class="h-72 w-full rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-500 bg-gray-50 relative overflow-hidden">
                                <div id="assign-tool-preview" class="hidden absolute inset-0">
                                    <img src="" id="assign-tool-img-preview" class="w-full h-full object-contain">
                                </div>
                                <div id="assign-tool-prompt" class="text-center p-4">
                                    <svg class="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                                    <p class="mt-2 text-sm text-gray-500">Subir foto de entrega</p>
                                </div>
                            </div>
                            <input type="file" id="tool-assign-photo" name="assignPhoto" required accept="image/*" class="hidden">
                        </div>

                        <div>
                            <label for="tool-assign-comments" class="block text-sm font-medium">3. Observaciones (Opcional)</label>
                            <textarea id="tool-assign-comments" name="assignComments" rows="2" class="mt-1 w-full border rounded-md p-2" placeholder="Describa el estado de entrega..."></textarea>
                        </div>
                    </div>
                </div>
            `;


            // --- INICIO DE LÓGICA JS AÑADIDA PARA EL PREVIEW ---
            setTimeout(() => {
                const dropzone = document.getElementById('assign-tool-dropzone');
                const fileInput = document.getElementById('tool-assign-photo');
                const previewContainer = document.getElementById('assign-tool-preview');
                const previewImg = document.getElementById('assign-tool-img-preview');
                const promptEl = document.getElementById('assign-tool-prompt');

                if (!dropzone) return; // Seguridad por si el modal se cierra rápido

                // 1. Abrir el selector de archivos al hacer clic en la zona
                dropzone.addEventListener('click', () => {
                    fileInput.click();
                });

                // 2. Mostrar la vista previa cuando se selecciona un archivo
                fileInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            previewImg.src = event.target.result;
                            previewContainer.classList.remove('hidden');
                            promptEl.classList.add('hidden');
                        }
                        reader.readAsDataURL(file);
                    }
                });

                const assigneeSelect = document.getElementById('tool-assignedTo');
                if (assigneeSelect) {
                    new Choices(assigneeSelect, {
                        choices: userChoices, // El array de objetos que creamos
                        itemSelectText: 'Seleccionar',
                        searchPlaceholderValue: 'Buscar colaborador...',
                        placeholder: true,
                        placeholderValue: 'Selecciona un usuario...',
                        allowHTML: false,
                    });
                }

            }, 100); // Espera a que el modal se renderice
            // --- FIN DE LÓGICA JS AÑADIDA ---

            break;
        }

        case 'return-tool': {
            title = 'Recibir Herramienta (Devolución)';
            btnText = 'Confirmar Devolución';
            btnClass = 'bg-blue-500 hover:bg-blue-600';

            const assignedToUser = usersMap.get(data.assignedToId);
            const assignedToName = assignedToUser ? `${assignedToUser.firstName} ${assignedToUser.lastName}` : 'N/D';

            // --- INICIO DE MODIFICACIÓN: DISEÑO 2 COLUMNAS ---
            bodyHtml = `
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        
                        <div class="md:col-span-1">
                            <label class="block text-sm font-medium text-gray-700 mb-1">Foto de Devolución (Req.)</label>
                            
                            <div id="return-tool-dropzone" class="aspect-square w-full rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-500 bg-gray-50 relative overflow-hidden">
                                
                                <div id="return-tool-preview" class="hidden absolute inset-0">
                                    <img src="" id="return-tool-img-preview" class="w-full h-full object-contain">
                                </div>
                                
                                <div id="return-tool-prompt" class="text-center p-4">
                                    <svg class="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                                    <p class="mt-2 text-sm text-gray-500">Subir foto de devolución</p>
                                </div>
                            </div>
                            <input type="file" id="tool-return-photo" name="returnPhoto" required accept="image/*" class="hidden">
                        </div>
                        
                        <div class="md:col-span-2 space-y-4">
                            <input type="hidden" name="toolName" value="${data.name || ''}">
                            <input type="hidden" name="originalAssigneeId" value="${data.assignedToId || ''}">
                            
                            <div>
                                <p class="text-sm font-medium text-gray-700">Recibiendo:</p>
                                <p class="text-lg font-semibold text-gray-900">${data.name || 'N/A'}</p>
                            </div>
                            <div>
                                <p class="text-sm font-medium text-gray-700">Devuelta por:</p>
                                <p class="text-lg font-semibold text-gray-900">${assignedToName}</p>
                            </div>

                            <div>
                                <label for="tool-return-status" class="block text-sm font-medium text-gray-700">Estado de Devolución</label>
                                <select id="tool-return-status" name="returnStatus" required class="mt-1 w-full border rounded-md p-2 bg-white">
                                    <option value="bueno" selected>Bueno (Operativo)</option>
                                    <option value="con_defecto">Con Defecto (Funciona pero requiere revisión)</option>
                                    <option value="dañado">Dañado (No operativo, para reparación)</option>
                                </select>
                            </div>
                            <div>
                                <label for="tool-return-comments" class="block text-sm font-medium text-gray-700">Comentarios (Opcional)</label>
                                <textarea id="tool-return-comments" name="returnComments" rows="3" class="mt-1 w-full border rounded-md p-2" placeholder="Describa cualquier defecto o detalle..."></textarea>
                            </div>
                        </div>
                    </div>
                `;

            // --- AÑADIMOS LA LÓGICA JS PARA LA VISTA PREVIA ---
            setTimeout(() => {
                const dropzone = document.getElementById('return-tool-dropzone');
                const fileInput = document.getElementById('tool-return-photo');
                const previewContainer = document.getElementById('return-tool-preview');
                const previewImg = document.getElementById('return-tool-img-preview');
                const promptEl = document.getElementById('return-tool-prompt');

                if (!dropzone) return;

                dropzone.addEventListener('click', () => {
                    fileInput.click();
                });

                fileInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            previewImg.src = event.target.result;
                            previewContainer.classList.remove('hidden');
                            promptEl.classList.add('hidden');
                        }
                        reader.readAsDataURL(file);
                    }
                });
            }, 100); // Espera a que el modal se renderice


            break;
        }

        // --- INICIO DE CÓDIGO AÑADIDO ---
        case 'register-maintenance': {
            title = 'Registrar Mantenimiento';
            btnText = 'Finalizar Mantenimiento';
            btnClass = 'bg-green-500 hover:bg-green-600';

            // Aquí puedes añadir un dropdown de proveedores si lo deseas
            // Por ahora, usaremos un input de texto simple.

            bodyHtml = `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    
                    <div class="md:col-span-1">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Herramienta</label>
                        <div class="aspect-square w-full rounded-lg bg-gray-100 overflow-hidden border">
                            <img src="${data.photoURL || 'https://via.placeholder.com/300'}" 
                                 alt="${data.name || ''}" 
                                 class="w-full h-full object-contain">
                        </div>
                        <p class="text-center font-bold text-lg mt-2">${data.name || 'N/A'}</p>
                    </div>
                    
                    <div class="md:col-span-2 space-y-4">
                        <input type="hidden" name="toolName" value="${data.name || ''}">
                        
                        <div>
                            <label for="maintenance-provider" class="block text-sm font-medium">Proveedor / Taller (Opcional)</label>
                            <input type="text" id="maintenance-provider" name="maintenanceProvider" class="mt-1 w-full border rounded-md p-2" placeholder="Ej: Taller Pepito">
                        </div>

                        <div>
                            <label for="maintenance-cost" class="block text-sm font-medium">Costo de Reparación (Opcional)</label>
                            <input type="text" id="maintenance-cost" name="maintenanceCost" class="currency-input mt-1 w-full border rounded-md p-2" placeholder="$ 0">
                        </div>

                        <div>
                            <label for="maintenance-notes" class="block text-sm font-medium">Notas (Opcional)</label>
                            <textarea id="maintenance-notes" name="maintenanceNotes" rows="3" class="mt-1 w-full border rounded-md p-2" placeholder="Describa qué se reparó..."></textarea>
                        </div>

                        <p class="text-xs text-gray-500 pt-2">Al finalizar, la herramienta volverá a estar "Disponible".</S>
                    </div>

                </div>
            `;

            // Activamos el formateador de moneda para el campo de costo
            setTimeout(() => {
                const costInput = document.getElementById('maintenance-cost');
                setupCurrencyInput(costInput); // (Esta función ya existe en tu app.js)
            }, 100);

            break;
        }
        // --- FIN DE CÓDIGO AÑADIDO ---

        case 'addItem':
        case 'editItem': {
            const isEditing = type === 'editItem';
            title = isEditing ? 'Editar Ítem' : 'Añadir Nuevo Ítem';
            btnText = isEditing ? 'Guardar Cambios' : 'Añadir Ítem';
            btnClass = isEditing ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-green-500 hover:bg-green-600';

            // --- INICIO DE PLANTILLA MODERNA (Secciones) ---

            // Plantilla para la sección de costo SEPARADO
            const costSectionSeparated = (section, title, data = {}) => `
                <div class="border rounded-lg p-3 mt-2 bg-white">
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
                <div class="border rounded-lg p-3 mt-2 bg-white">
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

            // --- LÓGICA PRINCIPAL: Decide qué formulario de precios mostrar ---
            let pricingModelHtml = '';
            const projectPricingModel = currentProject.pricingModel || 'separado';

            if (projectPricingModel === 'incluido') {
                pricingModelHtml = costSectionIncluded(isEditing ? data.includedDetails : {});
            } else {
                pricingModelHtml = `
            ${costSectionSeparated('supply', 'Detalles de Suministro', isEditing ? data.supplyDetails : {})}
            ${costSectionSeparated('installation', 'Detalles de Instalación', isEditing ? data.installationDetails : {})}
        `;
            }

            // --- Estructura HTML moderna con secciones ---
            bodyHtml = `
                <div class="space-y-5">
                    <div class="bg-gray-50 p-4 rounded-lg border">
                        <h4 class="text-md font-semibold text-gray-700 mb-3 border-b pb-2">1. Información del Ítem</h4>
                        <div class="space-y-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Nombre</label>
                                <input type="text" name="name" required class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.name : ''}">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Descripción</label>
                                <textarea name="description" rows="3" class="mt-1 w-full border rounded-md p-2" placeholder="Ej: Ventana corrediza sistema 744 con vidrio laminado 3+3mm...">${isEditing ? (data.description || '') : ''}</textarea>
                            </div>
                        </div>
                    </div>

                    <div class="bg-gray-50 p-4 rounded-lg border">
                        <h4 class="text-md font-semibold text-gray-700 mb-3 border-b pb-2">2. Medidas y Cantidad</h4>
                        <div class="grid grid-cols-3 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Cantidad</Tlabel>
                                <input type="number" name="quantity" required min="1" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.quantity : ''}" ${isEditing ? 'readonly' : ''}>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Ancho (cm)</label>
                                <input type="number" name="width" required min="0" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? (data.width * 100) : ''}">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Alto (cm)</label>
                                <input type="number" name="height" required min="0" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? (data.height * 100) : ''}">
                            </div>
                        </div>
                    </div>

                    <div class="p-4 rounded-lg border">
                        <h4 class="text-md font-semibold text-gray-700 mb-2">3. Valoración (Costos)</h4>
                        ${pricingModelHtml}
                    </div>
                </div>`;

            // --- FIN DE PLANTILLA MODERNA ---

            setTimeout(() => {
                const modalContent = document.getElementById('modal-body');
                const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });

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
            btnText = 'Confirmar Pago';
            btnClass = 'bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white shadow-lg';

            // Ajustamos el ancho para que se vea elegante
            if (modalContentDiv) {
                modalContentDiv.classList.remove('max-w-2xl');
                modalContentDiv.classList.add('max-w-md');
            }

            // Ocultamos el título por defecto para usar nuestro propio header personalizado
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            bodyHtml = `
                <div class="-mx-6 -mt-6 mb-6 bg-gradient-to-r from-orange-500 to-red-600 px-6 py-5 flex justify-between items-center rounded-t-lg">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white backdrop-blur-sm shadow-sm">
                            <i class="fa-solid fa-money-bill-wave"></i>
                        </div>
                        <div>
                            <h3 class="text-lg font-bold text-white leading-tight">Nuevo Pago</h3>
                            <p class="text-xs text-orange-100 font-medium opacity-90">Abono a cuenta del proveedor</p>
                        </div>
                    </div>
                    </div>

                <div class="space-y-5">
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Monto a Pagar</label>
                        <div class="relative">
                            <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                <span class="text-gray-400 font-bold text-xl">$</span>
                            </div>
                            <input type="text" name="amount" required 
                                class="currency-input w-full pl-9 pr-4 py-3 border-2 border-gray-200 rounded-xl text-2xl font-bold text-gray-800 focus:border-orange-500 focus:ring-0 outline-none transition-colors placeholder-gray-300" 
                                placeholder="0">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Fecha</label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400"><i class="fa-regular fa-calendar"></i></div>
                                <input type="date" name="date" required class="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 focus:border-orange-500 focus:ring-2 focus:ring-orange-100 outline-none transition-all" value="${new Date().toISOString().split('T')[0]}">
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Método</label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400"><i class="fa-solid fa-wallet"></i></div>
                                <select name="paymentMethod" class="w-full pl-9 pr-8 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white focus:border-orange-500 focus:ring-2 focus:ring-orange-100 outline-none transition-all appearance-none">
                                    <option value="Transferencia">Transferencia</option>
                                    <option value="Efectivo">Efectivo</option>
                                    <option value="Tarjeta">Tarjeta</option>
                                </select>
                                <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-400"><i class="fa-solid fa-chevron-down text-xs"></i></div>
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Referencia / Nota (Opcional)</label>
                        <div class="relative">
                             <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400"><i class="fa-solid fa-pen"></i></div>
                            <input type="text" name="note" class="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 focus:border-orange-500 focus:ring-2 focus:ring-orange-100 outline-none transition-all" placeholder="Ej: Comprobante #1234">
                        </div>
                    </div>
                    
                    <div class="bg-blue-50 p-3 rounded-lg flex items-start gap-3 text-xs text-blue-700 border border-blue-100">
                        <i class="fa-solid fa-circle-info mt-0.5"></i>
                        <p>El pago se distribuirá automáticamente a las órdenes de compra más antiguas pendientes (FIFO) y se guardará en el historial.</p>
                    </div>
                </div>
            `;

            // Inicializar formato de moneda
            setTimeout(() => {
                setupCurrencyInput(modalForm.querySelector('input[name="amount"]'));
            }, 100);
            break;
        }
        case 'editUser':
            title = 'Editar Usuario';
            btnText = 'Guardar Cambios';
            btnClass = 'bg-yellow-500 hover:bg-yellow-600';
            modalContentDiv.classList.add('max-w-2xl');

            bodyHtml = `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    
                    <div class="md:col-span-1">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Selfie (Foto de Perfil)</label>
                        
                        <div class="aspect-square w-full rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-50 relative overflow-hidden">
                            <div id="editUser-preview" class="absolute inset-0 ${data.profilePhotoURL ? '' : 'hidden'}">
                                <img src="${data.profilePhotoURL || ''}" id="editUser-img-preview" class="w-full h-full object-cover">
                            </div>
                            <div id="editUser-prompt" class="text-center p-4 ${data.profilePhotoURL ? 'hidden' : ''} flex items-center justify-center h-full">
                                <svg class="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                            </div>
                        </div>

                        <input type="file" id="editUser-photo-input" name="photo" accept="image/*,.heic,.heif" class="hidden">

                        <div class="mt-2 grid grid-cols-2 gap-2">
                            <button type="button" id="editUser-upload-btn" class="bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm font-bold py-2 px-3 rounded-lg w-full">Subir Foto</button>
                            <button type="button" id="editUser-camera-btn" class="bg-blue-500 hover:bg-blue-600 text-white text-sm font-bold py-2 px-3 rounded-lg w-full">Tomar Foto</button>
                        </div>
                        <p id="editUser-photo-status" class="text-xs text-center text-blue-600 h-4 mt-1"></p>
                    </div>
                    
                    <div class="md:col-span-2 space-y-3">
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-medium text-gray-700">Nombre</label>
                                <input type="text" name="firstName" value="${data.firstName}" required class="mt-1 w-full border rounded-md p-2 text-sm">
                            </div>
                            <div>
                                <label class="block text-xs font-medium text-gray-700">Apellido</label>
                                <input type="text" name="lastName" value="${data.lastName}" required class="mt-1 w-full border rounded-md p-2 text-sm">
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-gray-700">Cédula</label>
                            <input type="text" name="idNumber" value="${data.idNumber}" required class="mt-1 w-full border rounded-md p-2 text-sm">
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-gray-700">Correo (No editable)</label>
                            <input type="email" name="email" value="${data.email}" required class="mt-1 w-full border rounded-md p-2 text-sm bg-gray-100" readonly>
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-gray-700">Celular</label>
                            <input type="tel" name="phone" value="${data.phone}" required class="mt-1 w-full border rounded-md p-2 text-sm">
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-gray-700">Dirección</label>
                            <input type="text" name="address" value="${data.address}" required class="mt-1 w-full border rounded-md p-2 text-sm">
                        </div>

                        <div class="pt-3 border-t mt-3">
                            <h4 class="text-sm font-bold text-gray-800 mb-2">Información Bancaria (Pago de Nómina)</h4>
                            <div class="grid grid-cols-2 gap-3">
                                <div>
                                    <label class="block text-xs font-medium text-gray-700">Banco</label>
                                    <input type="text" name="bankName" value="${data.bankName || ''}" class="mt-1 w-full border rounded-md p-2 text-sm" placeholder="Ej: Bancolombia">
                                </div>
                                <div>
                                    <label class="block text-xs font-medium text-gray-700">Tipo de Cuenta</label>
                                    <select name="accountType" class="mt-1 w-full border rounded-md p-2 text-sm bg-white">
                                        <option value="Ahorros" ${data.accountType === 'Ahorros' ? 'selected' : ''}>Ahorros</option>
                                        <option value="Corriente" ${data.accountType === 'Corriente' ? 'selected' : ''}>Corriente</option>
                                        <option value="Nequi/Daviplata" ${data.accountType === 'Nequi/Daviplata' ? 'selected' : ''}>Nequi / Daviplata</option>
                                    </select>
                                </div>
                                <div class="col-span-2">
                                    <label class="block text-xs font-medium text-gray-700">Número de Cuenta</label>
                                    <input type="text" name="accountNumber" value="${data.accountNumber || ''}" class="mt-1 w-full border rounded-md p-2 text-sm" placeholder="Ej: 031-123456-78">
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="md:col-span-3 border-t pt-4">
                        <h4 class="text-md font-semibold text-gray-700 mb-2">Tallas Preferidas</h4>
                        <div class="grid grid-cols-3 gap-4">
                            <div>
                                <label class="block text-sm font-medium">Camiseta</label>
                                <input type="text" name="tallaCamiseta" class="mt-1 w-full border rounded-md p-2" value="${data.tallaCamiseta || ''}" placeholder="Ej: L">
                            </div>
                            <div>
                                <label class="block text-sm font-medium">Pantalón</label>
                                <input type="text" name="tallaPantalón" class="mt-1 w-full border rounded-md p-2" value="${data.tallaPantalón || ''}" placeholder="Ej: 32">
                            </div>
                            <div>
                                <label class="block text-sm font-medium">Botas</label>
                                <input type="text" name="tallaBotas" class="mt-1 w-full border rounded-md p-2" value="${data.tallaBotas || ''}" placeholder="Ej: 42">
                            </div>
                        </div>
                    </div>

                    <div class="md:col-span-3 border-t pt-4">
                        <h4 class="text-md font-semibold text-gray-700 mb-2">Rol y Compensación</h4>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label for="user-role-select" class="block text-sm font-medium text-gray-700">Rol de Usuario</label>
                                <select id="user-role-select" name="role" class="mt-1 block w-full px-3 py-2 border rounded-md bg-white font-bold text-gray-700">
                                    <option value="operario" ${data.role === 'operario' ? 'selected' : ''}>Operario</option>
                                    <option value="admin" ${data.role === 'admin' ? 'selected' : ''}>Administrador</option>
                                    <option value="bodega" ${data.role === 'bodega' ? 'selected' : ''}>Bodega</option>
                                    <option value="sst" ${data.role === 'sst' ? 'selected' : ''}>SST</option>
                                </select>
                            </div>

                            <div>
                                <label for="user-commissionLevel" class="block text-sm font-medium text-gray-700">Nivel de Comisión</label>
                                <select id="user-commissionLevel" name="commissionLevel" class="mt-1 block w-full px-3 py-2 border rounded-md bg-white">
                                    <option value="principiante" ${data.commissionLevel === 'principiante' ? 'selected' : ''}>Principiante</option>
                                    <option value="intermedio" ${data.commissionLevel === 'intermedio' ? 'selected' : ''}>Intermedio</option>
                                    <option value="avanzado" ${data.commissionLevel === 'avanzado' ? 'selected' : ''}>Avanzado</option>
                                    <option value="" ${!data.commissionLevel ? 'selected' : ''}>Ninguno (No comisiona)</option>
                                </select>
                            </div>
                            
                            <div>
                                <label for="user-salarioBasico" class="block text-sm font-medium text-gray-700">Salario Básico</label>
                                <input type="text" id="user-salarioBasico" name="salarioBasico" class="currency-input mt-1 block w-full px-3 py-2 border rounded-md" value="${data.salarioBasico || 0}">
                            </div>
                        </div>

                        <div class="mt-4 flex items-center">
                            <input type="checkbox" id="user-deduccionSobreMinimo" name="deduccionSobreMinimo" class="h-4 w-4 text-blue-600 border-gray-300 rounded" ${data.deduccionSobreMinimo ? 'checked' : ''}>
                            <label for="user-deduccionSobreMinimo" class="ml-2 block text-sm text-gray-900">
                                Aplicar deducciones (Salud/Pensión) sobre el Salario Mínimo
                            </label>
                        </div>
                    </div>

                    <div class="md:col-span-3 border-t pt-4 mt-2">
                        <h4 class="text-md font-semibold text-gray-700 mb-3 flex items-center">
                            <i class="fa-solid fa-toggle-on mr-2 text-indigo-500"></i> 
                            Acceso a Módulos
                        </h4>
                        
                        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200 max-h-60 overflow-y-auto custom-scrollbar">
                            ${(() => {
                    // Generación inicial basada en el rol actual
                    const roleDefaults = getRoleDefaultPermissions(data.role || 'operario');

                    return SIDEBAR_CONFIG.map(mod => {
                        const currentPerm = (data.customPermissions && data.customPermissions[mod.key]);
                        // Lógica inicial de marcado
                        const isChecked = (currentPerm === 'show') || (roleDefaults[mod.key] && currentPerm !== 'hide');

                        let labelClass = "text-gray-700";
                        if (currentPerm === 'show') labelClass = "text-green-700 font-bold";
                        if (currentPerm === 'hide') labelClass = "text-red-500 line-through";

                        return `
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                        <input type="checkbox" name="perm_${mod.key}" 
                                            class="permission-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                                            ${isChecked ? 'checked' : ''}
                                            data-key="${mod.key}">
                                        <span class="text-xs ${labelClass} permission-label">${mod.label}</span>
                                    </label>
                                    `;
                    }).join('');
                })()}
                        </div>
                        <p class="text-[10px] text-gray-500 mt-2">
                            * Al cambiar el rol, los permisos se reiniciarán a los valores por defecto del nuevo rol.
                        </p>
                    </div>

                    <div class="md:col-span-3 border-t pt-4">
                        <button type="button" data-action="view-profile-history" data-userid="${data.id}" class="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg">
                            Ver Historial de Cambios
                        </button>
                    </div>
                </div>
            `;

            // Lógica JS para inicializar el modal
            setTimeout(() => {
                // 1. Moneda
                const salarioInput = document.getElementById('user-salarioBasico');
                if (salarioInput) setupCurrencyInput(salarioInput);

                // 2. Fotos
                processedPhotoFile = null;
                const fileInput = document.getElementById('editUser-photo-input');
                const uploadBtn = document.getElementById('editUser-upload-btn');
                const cameraBtn = document.getElementById('editUser-camera-btn');

                if (uploadBtn && fileInput) uploadBtn.addEventListener('click', () => fileInput.click());
                if (fileInput) {
                    fileInput.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (file) handlePhotoFile(file, 'editUser-photo-input', 'editUser-img-preview');
                    });
                }
                if (cameraBtn) {
                    cameraBtn.addEventListener('click', () => openCameraModal('editUser-photo-input', 'editUser-img-preview'));
                }

                // 3. ACTUALIZACIÓN DINÁMICA DE MÓDULOS AL CAMBIAR ROL (NUEVO)
                const roleSelect = document.getElementById('user-role-select');
                const permissionCheckboxes = document.querySelectorAll('.permission-checkbox');
                const permissionLabels = document.querySelectorAll('.permission-label');

                if (roleSelect) {
                    roleSelect.addEventListener('change', (e) => {
                        const newRole = e.target.value;
                        const newDefaults = getRoleDefaultPermissions(newRole);

                        // Reiniciamos todos los checkboxes según el nuevo rol
                        permissionCheckboxes.forEach((chk, index) => {
                            const key = chk.dataset.key;
                            // Forzamos el estado según el default del nuevo rol
                            chk.checked = !!newDefaults[key];

                            // Reseteamos estilos visuales (quitamos tachado o negrita de permisos custom previos)
                            if (permissionLabels[index]) {
                                permissionLabels[index].className = "text-xs text-gray-700 permission-label";
                            }
                        });
                    });
                }

            }, 100);
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
            btnClass = isEditing ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-blue-600 hover:bg-blue-700';

            if (modalContentDiv) {
                modalContentDiv.classList.remove('max-w-2xl');
                modalContentDiv.classList.add('max-w-3xl');
            }

            bodyHtml = `
                <div class="space-y-6">
                    
                    <div class="bg-gray-50 p-4 rounded-xl border border-gray-200">
                        <h4 class="text-sm font-bold text-gray-700 uppercase mb-3 flex items-center">
                            <div class="p-1.5 bg-blue-100 text-blue-600 rounded-md mr-2"><i class="fa-solid fa-id-card"></i></div>
                            Información Fiscal
                        </h4>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 mb-1">Razón Social / Nombre</label>
                                <input type="text" name="name" required class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Ej: Ferretería El Tornillo" value="${isEditing ? data.name || '' : ''}">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 mb-1">NIT / Cédula</label>
                                <input type="text" name="nit" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Ej: 900.123.456-7" value="${isEditing ? data.nit || '' : ''}">
                            </div>
                        </div>
                    </div>

                    <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <h4 class="text-sm font-bold text-gray-700 uppercase mb-3 flex items-center">
                            <div class="p-1.5 bg-green-100 text-green-600 rounded-md mr-2"><i class="fa-solid fa-address-book"></i></div>
                            Datos de Contacto
                        </h4>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 mb-1">Nombre Contacto</label>
                                <input type="text" name="contactName" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm" placeholder="Persona encargada" value="${isEditing ? data.contactName || '' : ''}">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 mb-1">Teléfono / Celular</label>
                                <input type="tel" name="contactPhone" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm" placeholder="300 123 4567" value="${isEditing ? data.contactPhone || '' : ''}">
                            </div>
                             <div>
                                <label class="block text-xs font-bold text-gray-500 mb-1">Correo Electrónico</label>
                                <input type="email" name="email" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm" placeholder="contacto@empresa.com" value="${isEditing ? data.email || '' : ''}">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 mb-1">Dirección Física</label>
                                <input type="text" name="address" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm" placeholder="Calle 123 # 45-67" value="${isEditing ? data.address || '' : ''}">
                            </div>
                        </div>
                    </div>

                    <div class="bg-gray-50 p-4 rounded-xl border border-gray-200">
                        <h4 class="text-sm font-bold text-gray-700 uppercase mb-3 flex items-center">
                            <div class="p-1.5 bg-indigo-100 text-indigo-600 rounded-md mr-2"><i class="fa-solid fa-building-columns"></i></div>
                            Información Bancaria
                        </h4>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 mb-1">Banco</label>
                                <input type="text" name="bankName" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm" placeholder="Ej: Bancolombia" value="${isEditing ? data.bankName || '' : ''}">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 mb-1">Tipo de Cuenta</label>
                                <select name="accountType" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm bg-white">
                                    <option value="Ahorros" ${isEditing && data.accountType === 'Ahorros' ? 'selected' : ''}>Ahorros</option>
                                    <option value="Corriente" ${isEditing && data.accountType === 'Corriente' ? 'selected' : ''}>Corriente</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 mb-1">Número de Cuenta</label>
                                <input type="text" name="accountNumber" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm font-mono" placeholder="000-00000-00" value="${isEditing ? data.accountNumber || '' : ''}">
                            </div>
                        </div>

                        <div class="border-t border-gray-200 pt-4">
                            <label class="block text-xs font-bold text-gray-500 mb-2">Código QR Interbancario (Opcional)</label>
                            <div class="flex items-center gap-4">
                                <div id="qr-preview-container" class="w-24 h-24 bg-white border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center overflow-hidden relative cursor-pointer hover:border-indigo-400 transition-colors">
                                    <img id="qr-img-preview" src="${isEditing ? data.qrCodeURL || '' : ''}" class="w-full h-full object-cover ${isEditing && data.qrCodeURL ? '' : 'hidden'}">
                                    <div id="qr-placeholder-icon" class="text-center ${isEditing && data.qrCodeURL ? 'hidden' : ''}">
                                        <i class="fa-solid fa-qrcode text-2xl text-gray-300"></i>
                                    </div>
                                </div>
                                
                                <div>
                                    <input type="file" id="supplier-qr-input" name="qrFile" accept="image/*" class="hidden">
                                    <button type="button" id="btn-select-qr" class="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-1.5 rounded-md text-xs font-bold shadow-sm transition-all mb-2">
                                        <i class="fa-solid fa-upload mr-1"></i> Subir QR
                                    </button>
                                    <p class="text-[10px] text-gray-400">Formatos: JPG, PNG, WebP.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Lógica JS para la previsualización
            setTimeout(() => {
                const btnSelect = document.getElementById('btn-select-qr');
                const fileInput = document.getElementById('supplier-qr-input');
                const previewContainer = document.getElementById('qr-preview-container');
                const imgPreview = document.getElementById('qr-img-preview');
                const iconPlaceholder = document.getElementById('qr-placeholder-icon');

                if (btnSelect && fileInput) {
                    // Al hacer clic en el botón o en el cuadro, abrir selector
                    btnSelect.onclick = () => fileInput.click();
                    previewContainer.onclick = () => fileInput.click();

                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (evt) => {
                                imgPreview.src = evt.target.result;
                                imgPreview.classList.remove('hidden');
                                iconPlaceholder.classList.add('hidden');
                                previewContainer.classList.remove('border-dashed');
                                previewContainer.classList.add('border-indigo-500');
                            };
                            reader.readAsDataURL(file);
                        }
                    };
                }
            }, 100);
            break;
        }
        case 'request-material': {
            title = 'Crear Solicitud de Material';
            btnText = 'Enviar Solicitud';
            btnClass = 'bg-green-500 hover:bg-green-600';

            // El HTML de carga sigue siendo útil por si se usa en el futuro
            bodyHtml = `
                <div id="material-request-loader" class="text-center py-8">
                <div class="loader mx-auto"></div>
                <p class="mt-2 text-sm text-gray-500">Cargando datos del proyecto...</p>
                </div>
                <div id="material-request-form-content" class="hidden"></div>
            `;

            // --- LÓGICA DUPLICADA ELIMINADA ---
            // Se eliminó la función const loadDataAndBuildForm = async () => { ... }
            // y la llamada setTimeout(loadDataAndBuildForm, 50);
            // ya que esta lógica se maneja en showMaterialRequestView()
            // --- FIN DE LA LIMPIEZA ---

            break;
        }
        case 'edit-task': { // Case con formato mejorado
            title = 'Editar Tarea';
            btnText = 'Guardar Cambios';
            btnClass = 'bg-yellow-500 hover:bg-yellow-600';
            modalContentDiv.classList.add('max-w-2xl'); // Aseguramos el tamaño estándar
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

            // --- INICIO DE LA MODIFICACIÓN (Nuevo HTML) ---
            bodyHtml = `
                <div class="space-y-6">

                    <fieldset class="space-y-2">
                        <legend class="text-lg font-semibold text-gray-800 pb-2">1. Proyecto (No editable)</legend>
                        <div>
                            <select id="task-project-choices" name="projectId" required placeholder="Cargando proyecto..."></select>
                            <input type="hidden" name="projectName" value="${data.projectName || ''}"> 
                        </div>
                    </fieldset>

                    <fieldset id="task-items-selection" class="space-y-2">
                        <legend class="text-lg font-semibold text-gray-800 pb-2">2. Ítems Relacionados (No editable)</legend>
                        <div id="task-items-list" class="max-h-48 overflow-y-auto space-y-2 text-sm pr-2 border rounded-md p-3 bg-gray-50">
                            <p class="text-gray-400 italic text-center py-4">Cargando ítems...</p>
                        </div>
                    </fieldset>

                    <fieldset class="space-y-4">
                        <legend class="text-lg font-semibold text-gray-800 pb-2">3. Detalles de la Tarea</legend>
                        
                        <div>
                            <label for="task-description" class="block text-sm font-medium mb-1">Descripción de la Tarea</label>
                            <textarea id="task-description" name="description" rows="3" required class="mt-1 w-full border rounded-md p-2 text-sm">${data.description || ''}</textarea>
                        </div>

                        <div>
                            <label for="task-assignee-choices" class="block text-sm font-medium mb-1">Asignar A (Principal)</label>
                            <select id="task-assignee-choices" name="assigneeId" required placeholder="Buscar o seleccionar usuario..."></select>
                            <input type="hidden" name="assigneeName" value="${data.assigneeName || ''}">
                        </div>

                        <div>
                            <label for="task-additional-assignees-choices" class="block text-sm font-medium mb-1">Asignar a Personas Adicionales</label>
                            <select id="task-additional-assignees-choices" name="additionalAssigneeIds" multiple placeholder="Buscar o añadir más usuarios..."></select>
                        </div>

                        <div>
                            <label for="task-dueDate" class="block text-sm font-medium mb-1">Fecha Límite</label>
                            <input type="date" id="task-dueDate" name="dueDate" class="mt-1 w-full border rounded-md p-2 text-sm" value="${data.dueDate || ''}">
                        </div>
                    </fieldset>

                </div>`; // Fin de space-y-6
            // --- FIN DE LA MODIFICACIÓN ---

            modalBody.innerHTML = bodyHtml;

            // --- INICIO DE MODIFICACIÓN (Lógica JS) ---
            setTimeout(() => {
                // 1. Selector de Proyecto (Cargar, seleccionar y deshabilitar)
                const projectElement = document.getElementById('task-project-choices');
                const projectChoices = new Choices(projectElement, {
                    choices: [{ value: data.projectId, label: data.projectName || 'Cargando...' }],
                    itemSelectText: '',
                    allowHTML: false,
                });
                projectChoices.setValue([{ value: data.projectId, label: data.projectName || 'Proyecto' }]);
                projectChoices.disable(); // Lo deshabilitamos

                // 2. Asignado Principal (Lógica existente)
                const assigneeElement = document.getElementById('task-assignee-choices');
                const assigneeChoices = new Choices(assigneeElement, {
                    choices: allActiveUsers.map(u => ({ value: u.id, label: u.name })),
                    searchPlaceholderValue: "Buscar usuario...", itemSelectText: 'Seleccionar', allowHTML: false,
                });
                if (data.assigneeId) {
                    assigneeChoices.setValue([{ value: data.assigneeId, label: data.assigneeName || 'Usuario' }]);
                }
                assigneeElement.addEventListener('change', (event) => {
                    const selectedAssigneeId = event.detail.value;
                    const assigneeNameInput = modalForm.querySelector('input[name="assigneeName"]');
                    const selectedUser = allActiveUsers.find(u => u.id === selectedAssigneeId);
                    assigneeNameInput.value = selectedUser ? selectedUser.name : '';
                });

                // 3. Asignados Adicionales (Lógica existente)
                const additionalAssigneesElement = document.getElementById('task-additional-assignees-choices');
                const additionalAssigneesChoices = new Choices(additionalAssigneesElement, {
                    choices: allActiveUsers.map(u => ({ value: u.id, label: u.name })),
                    removeItemButton: true, searchPlaceholderValue: "Añadir más usuarios...", allowHTML: false,
                });
                const additionalAssigneeValues = (data.additionalAssigneeIds || []).map(id => ({ value: id }));
                if (additionalAssigneeValues.length > 0) {
                    const preSelectedLabels = additionalAssigneeValues.map(v => {
                        const user = allActiveUsers.find(u => u.id === v.value);
                        return { value: v.value, label: user ? user.name : 'Usuario Desconocido' };
                    });
                    additionalAssigneesChoices.setValue(preSelectedLabels);
                }

                // 4. Cargar y mostrar los ítems (Modo solo lectura)
                const itemsListUl = document.getElementById('task-items-list');
                if (data.selectedItems && data.selectedItems.length > 0) {
                    const itemDetailPromises = data.selectedItems.map(async itemInfo => {
                        try {
                            const itemDoc = await getDoc(doc(db, "projects", data.projectId, "items", itemInfo.itemId));
                            const itemName = itemDoc.exists() ? itemDoc.data().name : `ID: ${itemInfo.itemId}`;

                            // HTML de solo lectura (checkbox marcado y deshabilitado)
                            return `
                                <div class="task-item-row flex items-center justify-between py-1 px-1">
                                    <label class="inline-flex items-center flex-grow mr-2"> 
                                        <input type="checkbox" class="item-checkbox rounded" checked disabled>
                                        <span class="ml-2 truncate" title="${itemName}">${itemName}</span>
                                    </label>
                                    <span class_name="item-quantity-display w-20 text-sm text-center font-medium">${itemInfo.quantity}</span>
                                </div>
                            `;
                        } catch {
                            return `<li class="list-disc text-red-500">Error cargando ítem</li>`;
                        }
                    });
                    Promise.all(itemDetailPromises).then(htmlItems => {
                        if (itemsListUl) itemsListUl.innerHTML = htmlItems.join('');
                    });
                } else {
                    if (itemsListUl) itemsListUl.innerHTML = '<li class="italic text-gray-500">No hay ítems asociados.</li>';
                }

                // 5. Fecha mínima (Lógica existente)
                const dueDateInput = modalBody.querySelector('#task-dueDate');
                if (dueDateInput) {
                    dueDateInput.min = new Date().toISOString().split("T")[0];
                }

                // Destruir Choices al cerrar
                mainModal.addEventListener('close', () => {
                    projectChoices.destroy();
                    assigneeChoices.destroy();
                    additionalAssigneesChoices.destroy();
                }, { once: true });

            }, 150);
            // --- FIN DE MODIFICACIÓN (Lógica JS) ---

            break; // Fin del case 'edit-task'
        }

        case 'new-task': { // Case con formato mejorado
            title = 'Crear Nueva Tarea';
            btnText = 'Guardar Tarea';
            btnClass = 'bg-green-500 hover:bg-green-600';
            modalContentDiv.classList.add('max-w-2xl'); // Aseguramos el tamaño estándar

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

            // --- INICIO DE LA MODIFICACIÓN ---
            // Reemplazamos el antiguo bodyHtml por este nuevo diseño de 3 pasos
            bodyHtml = `
                <div class="space-y-6">

                    <fieldset class="space-y-2">
                        <legend class="text-lg font-semibold text-gray-800 pb-2">1. Seleccionar Proyecto</legend>
                        <div>
                            <label for="task-project-choices" class="block text-sm font-medium mb-1">Proyecto (Activos)</label>
                            <select id="task-project-choices" name="projectId" required placeholder="Buscar o seleccionar proyecto..."></select>
                            <input type="hidden" name="projectName"> 
                        </div>
                    </fieldset>

                    <fieldset id="task-items-selection" class="hidden space-y-2">
                        <legend class="text-lg font-semibold text-gray-800 pb-2">2. Ítems Relacionados <span class="text-red-500 font-semibold">*</span></legend>
                        <div id="task-items-list" class="max-h-48 overflow-y-auto space-y-2 text-sm pr-2 border rounded-md p-3 bg-gray-50">
                            <p class="text-gray-400 italic text-center py-4">Selecciona un proyecto para ver sus ítems.</p>
                        </div>
                    </fieldset>

                    <fieldset class="space-y-4">
                        <legend class="text-lg font-semibold text-gray-800 pb-2">3. Detalles de la Tarea</legend>
                        
                        <div>
                            <label for="task-description" class="block text-sm font-medium mb-1">Descripción de la Tarea</label>
                            <textarea id="task-description" name="description" rows="3" required class="mt-1 w-full border rounded-md p-2 text-sm" placeholder="Describe brevemente la tarea..."></textarea>
                        </div>

                        <div>
                            <label for="task-assignee-choices" class="block text-sm font-medium mb-1">Asignar A (Principal)</label>
                            <select id="task-assignee-choices" name="assigneeId" required placeholder="Buscar o seleccionar usuario..."></select>
                            <input type="hidden" name="assigneeName">
                        </div>

                        <div>
                            <label for="task-additional-assignees-choices" class="block text-sm font-medium mb-1">Asignar a Personas Adicionales (Opcional)</label>
                            <select id="task-additional-assignees-choices" name="additionalAssigneeIds" multiple placeholder="Buscar o añadir más usuarios..."></select>
                        </div>

                        <div>
                            <label for="task-dueDate" class="block text-sm font-medium mb-1">Fecha Límite (Opcional)</label>
                            <input type="date" id="task-dueDate" name="dueDate" class="mt-1 w-full border rounded-md p-2 text-sm">
                        </div>
                    </fieldset>

                </div>`; // Fin de space-y-6
            // --- FIN DE LA MODIFICACIÓN ---

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
                            // --- INICIO DE LA CORRECCIÓN ---
                            // BUG: La consulta antigua buscaba en la colección raíz "items"
                            // const itemsQuery = query(collection(db, "items"), where("projectId", "==", selectedProjectId), orderBy("name"));

                            // CORRECCIÓN: Esta consulta busca en la subcolección "items" DENTRO del proyecto seleccionado
                            const itemsQuery = query(collection(db, "projects", selectedProjectId, "items"), orderBy("name"));
                            // --- FIN DE LA CORRECCIÓN ---

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
            modalContentDiv.classList.add('max-w-2xl'); // Aseguramos el tamaño

            // --- INICIO DE MODIFICACIÓN (HTML Solo Vista) ---
            bodyHtml = `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    
                    <div class="md:col-span-1">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Foto de Perfil</label>
                        <div class="aspect-square w-full rounded-lg bg-gray-100 overflow-hidden border">
                            <img src="${data.profilePhotoURL || 'https://via.placeholder.com/300'}" alt="Foto de perfil" class="w-full h-full object-cover">
                        </div>
                        <p class="text-xs text-center text-gray-500 mt-2">La foto de perfil solo puede ser actualizada por un administrador.</p>
                    </div>

                    <div class="md:col-span-2 space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-500">Nombre</label>
                            <p class="mt-1 p-2 bg-gray-100 rounded-md border">${data.firstName} ${data.lastName}</p>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-500">Cédula</label>
                            <p class="mt-1 p-2 bg-gray-100 rounded-md border">${data.idNumber}</p>
                        </div>
                        <div>
                            <label for="profile-email" class="block text-sm font-medium text-gray-700">Correo</label>
                            <input type="email" id="profile-email" name="email" value="${data.email}" required class="mt-1 block w-full px-3 py-2 border rounded-md">
                        </div>
                        <div>
                            <label for="profile-phone" class="block text-sm font-medium text-gray-700">Celular</label>
                            <input type="tel" id="profile-phone" name="phone" value="${data.phone}" required class="mt-1 block w-full px-3 py-2 border rounded-md">
                        </div>
                        <div>
                            <label for="profile-address" class="block text-sm font-medium text-gray-700">Dirección</label>
                            <input type="text" id="profile-address" name="address" value="${data.address}" required class="mt-1 block w-full px-3 py-2 border rounded-md">
                        </div>
                    </div>

                    <div class="md:col-span-3 border-t pt-4">
                        <h4 class="text-md font-semibold text-gray-700 mb-2">Tallas Preferidas</h4>
                        <div class="grid grid-cols-3 gap-4">
                            <div>
                                <label class="block text-sm font-medium">Camiseta</label>
                                <input type="text" name="tallaCamiseta" class="mt-1 w-full border rounded-md p-2" value="${data.tallaCamiseta || ''}" placeholder="Ej: L">
                            </div>
                            <div>
                                <label class="block text-sm font-medium">Pantalón</label>
                                <input type="text" name="tallaPantalón" class="mt-1 w-full border rounded-md p-2" value="${data.tallaPantalón || ''}" placeholder="Ej: 32">
                            </div>
                            <div>
                                <label class="block text-sm font-medium">Botas</label>
                                <input type="text" name="tallaBotas" class="mt-1 w-full border rounded-md p-2" value="${data.tallaBotas || ''}" placeholder="Ej: 42">
                            </div>
                        </div>
                    </div>

                    <div class="md:col-span-3 border-t pt-4">
                        
                        <button type="button" data-action="view-profile-history" data-userid="${currentUser.uid}" class="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg">
                            Ver Mi Historial de Cambios
                        </button>
                    </div>
                    </div>
            `;




            // Corregido (envuelto en un setTimeout):
            setTimeout(() => {
            }, 100);

            break;


    }

    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    const confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.textContent = btnText;
    confirmBtn.className = `text-white font-bold py-2 px-4 rounded-lg transition-all ${btnClass}`;
    mainModal.style.display = 'flex';
}

// --- EXPOSICIÓN DE FUNCIONES GLOBALES ---
window.openMainModal = openMainModal;   // <--- ESTO HACE QUE EL BOTÓN DE LOGS FUNCIONE
window.closeMainModal = closeMainModal; // (Recomendado para evitar futuros errores de cierre)

/**
 * Configura la lógica para añadir nuevos ítems a la PO y buscar precios.
 * (VERSIÓN CORREGIDA: Crea el HTML de la fila en lugar de clonarlo)
 * @param {Array} unifiedItemOptions - El array de opciones de ítems unificados.
 */
function setupPOItemLogic(unifiedItemOptions) {
    const container = document.getElementById('po-items-container');
    if (!container) return;

    const addBtn = document.getElementById('add-po-item-btn');

    /**
     * Función interna para crear una nueva fila de ítem
     */
    const addPOItemRow = () => {
        // 1. Crear un nuevo div
        const newItem = document.createElement('div');

        // 2. Establecer sus clases y HTML (con layout Grid y z-10)
        newItem.className = "po-item grid grid-cols-12 gap-2 items-center p-2 border rounded-md relative z-10 bg-white";
        newItem.innerHTML = `
            <div class="col-span-12 sm:col-span-6">
                <label class="block text-xs sm:hidden">Ítem</label>
                <select name="itemId" class="po-item-select w-full border p-2 rounded-md bg-white"></select>
            </div>
            
            <div class="col-span-6 sm:col-span-2">
                <label class="block text-xs sm:hidden">Cantidad</label>
                <input type="number" name="quantity" required class="w-full border p-2 rounded-md" placeholder="Cant.">
            </div>
            
            <div class="col-span-6 sm:col-span-3">
                <label class="block text-xs sm:hidden">Costo Unitario</label>
                <input type="text" name="unitCost" required class="currency-input w-full border p-2 rounded-md" placeholder="Costo Unit.">
            </div>

            <div class="col-span-12 sm:col-span-1 text-right sm:text-center">
                <button type="button" class="remove-po-item-btn text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-100">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        `;

        // 3. Añadir el nuevo elemento
        container.appendChild(newItem);

        // 4. Encontrar el <select> DENTRO del nuevo elemento
        const newSelect = newItem.querySelector('select[name="itemId"]');

        // 5. Inicializar Choices.js en el <select>
        new Choices(newSelect, {
            choices: unifiedItemOptions,
            itemSelectText: 'Seleccionar',
            searchPlaceholderValue: 'Buscar ítem...',
            searchResultLimit: 5 // <-- LÍNEA AÑADIDA
        });
    };

    // --- FIN DE LA FUNCIÓN INTERNA ---

    // Llamamos a la función para añadir la primera fila al cargar
    addPOItemRow();

    // El botón "+ Añadir ítem" ahora solo llama a esa función
    addBtn.onclick = addPOItemRow;

    // Listener para el nuevo botón "Eliminar"
    container.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove-po-item-btn');
        if (removeBtn) {
            if (container.querySelectorAll('.po-item').length > 1) {
                removeBtn.closest('.po-item').remove();
            } else {
                alert("Debes tener al menos un ítem en la orden.");
            }
        }
    });

    // Listener para buscar precios y guardar el tipo de ítem (Sin cambios)
    container.addEventListener('change', async (e) => {
        if (e.target.name === 'itemId') {
            // ... (lógica de findLastPurchasePrice - sin cambios) ...
            const selectEl = e.target;
            let itemType = null;
            try {
                const choicesInstance = selectEl.choices;
                const selectedChoice = choicesInstance?.getValue(true);
                itemType = selectedChoice?.customProperties?.type || null;
            } catch (error) {
                console.warn("No se pudo obtener la instancia de Choices.js, reintentando por dataset.");
                const selectedOption = selectEl.options[selectEl.selectedIndex];
                if (selectedOption && selectedOption.dataset.customProperties) {
                    itemType = JSON.parse(selectedOption.dataset.customProperties).type;
                }
            }
            if (itemType) {
                selectEl.dataset.itemType = itemType;
            }
            const materialId = selectEl.value;
            const supplierId = document.getElementById('po-supplier-select').value;
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

    // Formateador de moneda (Sin cambios)
    container.addEventListener('input', (e) => {
        if (e.target.classList.contains('currency-input')) {
            setupCurrencyInput(e.target);
        }
    });
}


function closeMainModal() { mainModal.style.display = 'none'; }
document.getElementById('modal-cancel-btn').addEventListener('click', closeMainModal);
modalForm.addEventListener('submit', async (e) => {
    const data = Object.fromEntries(new FormData(modalForm).entries());
    const type = modalForm.dataset.type;
    const id = modalForm.dataset.id;

    if (['new-tool', 'edit-tool', 'assign-tool', 'return-tool', 'register-maintenance', 'new-dotacion-catalog-item', 'add-dotacion-stock', 'register-dotacion-delivery', 'return-dotacion-options'].includes(type)) {
        return;
    }


    e.preventDefault();

    if (type === 'new-task') {
        await createTask(data); // Llama a la nueva función para crear la tarea
        return; // Salimos para no ejecutar el switch de abajo
    }

    if (type === 'create-daily-report') {
        const text = data.reportText;

        if (!text || text.trim().length < 5) {
            alert("El reporte está muy corto o vacío.");
            return;
        }

        modalConfirmBtn.disabled = true;
        modalConfirmBtn.textContent = "Guardando...";

        try {
            // Guardar en subcolección del usuario actual
            await addDoc(collection(db, "users", currentUser.uid, "daily_reports"), {
                content: text.trim(),
                createdAt: serverTimestamp(),
                createdByName: `${usersMap.get(currentUser.uid)?.firstName} ${usersMap.get(currentUser.uid)?.lastName}`
            });

            // (Opcional) Crear Log de auditoría
            if (window.logAuditAction) window.logAuditAction("Reporte Diario", "Creó reporte de actividad", currentUser.uid);

            showToast("Reporte guardado correctamente.", "success");
            closeMainModal();
        } catch (error) {
            console.error("Error:", error);
            alert("Error al guardar el reporte.");
        } finally {
            modalConfirmBtn.disabled = false;
        }
        return; // Importante: salir para no ejecutar otros casos
    }

    if (type === 'send-admin-alert') {
        const message = data.alertMessage;
        const sendToAll = document.getElementById('alert-send-all-toggle').checked;

        // --- INICIO CAMBIO: Leer múltiples valores ---
        const selectElement = document.getElementById('alert-target-user');
        let selectedUserIds = [];

        if (!sendToAll && selectElement) {
            // Convertimos las opciones seleccionadas a un array de valores (IDs)
            selectedUserIds = Array.from(selectElement.selectedOptions).map(option => option.value);
        }
        // --- FIN CAMBIO ---

        const fileInput = document.getElementById('alert-image-input');
        const file = fileInput ? fileInput.files[0] : null;

        // Validación Actualizada
        if (!sendToAll && selectedUserIds.length === 0) {
            alert("Por favor selecciona al menos un destinatario o activa 'Enviar a todos'.");
            return;
        }
        if (!message) {
            alert("Escribe un mensaje.");
            return;
        }

        modalConfirmBtn.disabled = true;
        modalConfirmBtn.textContent = "Enviando...";

        try {
            let attachmentURL = null;
            let attachmentType = null;

            // 1. Subir Archivo (Lógica existente)
            if (file) {
                const isPDF = file.type === 'application/pdf';
                modalConfirmBtn.textContent = isPDF ? "Subiendo documento..." : "Subiendo imagen...";

                const storagePath = `admin_alerts/${Date.now()}_${file.name}`;
                const storageRef = ref(storage, storagePath);

                if (isPDF) {
                    await uploadBytes(storageRef, file);
                    attachmentType = 'pdf';
                } else {
                    const resizedImage = await resizeImage(file, 1024);
                    await uploadBytes(storageRef, resizedImage);
                    attachmentType = 'image';
                }

                attachmentURL = await getDownloadURL(storageRef);
            }

            // 2. Preparar lista de destinatarios
            let recipients = [];
            if (sendToAll) {
                usersMap.forEach((user, uid) => {
                    if (user.status === 'active') recipients.push(uid);
                });
            } else {
                recipients = selectedUserIds; // <-- Usamos el array de IDs seleccionados
            }

            modalConfirmBtn.textContent = `Enviando a ${recipients.length} usuarios...`;

            // 3. Enviar Notificaciones en Batch
            const batch = writeBatch(db);

            recipients.forEach(uid => {
                const notifRef = doc(collection(db, "notifications"));
                batch.set(notifRef, {
                    userId: uid,
                    title: "📢 LLAMADO URGENTE",
                    message: message,
                    photoURL: attachmentURL,
                    attachmentType: attachmentType || 'image',
                    senderId: currentUser.uid,
                    senderName: usersMap.get(currentUser.uid)?.firstName || "Administrador",
                    read: false,
                    createdAt: serverTimestamp(),
                    type: 'admin_urgent_alert',
                    link: window.location.href
                });
            });

            await batch.commit();

            showToast(`Alerta enviada a ${recipients.length} usuarios.`, "success");
            closeMainModal();

        } catch (error) {
            console.error(error);
            alert("Error al enviar alerta: " + error.message);
        } finally {
            modalConfirmBtn.disabled = false;
        }
        return;
    }

    // --- AÑADE ESTE CASE COMPLETO ---
    if (type === 'new-dotacion') {
        const userId = data.userId;
        if (!userId) {
            alert("Error: No se seleccionó un usuario.");
            closeMainModal();
            return;
        }
        const dotacionData = {
            itemName: data.itemName,
            category: data.category,
            talla: data.talla || 'N/A',
            quantity: parseInt(data.quantity) || 1,
            fechaEntrega: data.fechaEntrega,
            observaciones: data.observaciones || '',
            assignedAt: new Date(),
            assignedBy: currentUser.uid
        };
        // Usa la nueva subcolección
        await addDoc(collection(db, "users", userId, "dotacionAsignada"), dotacionData);
        closeMainModal();
        return; // Salimos para no ejecutar el switch de abajo
    }
    // --- FIN DEL CASE ---

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
                    length: (parseFloat(data.defaultLength) / 100) || 0, // <-- CAMBIO
                    width: (parseFloat(data.defaultWidth) / 100) || 0 // <-- CAMBIO
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
                    length: (parseFloat(data.defaultLength) / 100) || 0, // <-- CAMBIO
                    width: (parseFloat(data.defaultWidth) / 100) || 0 // <-- CAMBIO
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

        case 'request-loan':
            const loanAmount = parseFloat(data.amount.replace(/[$. ]/g, '')) || 0;
            if (loanAmount <= 0) {
                alert("Por favor ingresa un monto válido.");
                return;
            }

            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = 'Enviando...';

            try {
                await addDoc(collection(db, "users", currentUser.uid, "loans"), {
                    amount: loanAmount,
                    balance: loanAmount,
                    description: data.description,
                    date: data.date,
                    installments: parseInt(data.installments) || 1,
                    status: 'pending',
                    createdAt: serverTimestamp(),
                    createdBy: currentUser.uid
                });

                alert("Solicitud enviada correctamente. Te notificaremos cuando sea aprobada.");
                closeMainModal();
            } catch (error) {
                console.error("Error solicitando préstamo:", error);
                alert("Error al enviar solicitud.");
            } finally {
                modalConfirmBtn.disabled = false;
            }
            break;

        case 'new-purchase-order': {
            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = 'Guardando...';
            try {
                const supplierSelect = document.getElementById('po-supplier-select');
                const selectedSupplierOption = supplierSelect.options[supplierSelect.selectedIndex];
                const supplierId = selectedSupplierOption.value;
                const supplierName = selectedSupplierOption.text;
                const paymentMethod = modalForm.querySelector('select[name="paymentMethod"]').value;
                const poDate = modalForm.querySelector('input[name="poDate"]').value; // Fecha seleccionada

                if (!supplierId) throw new Error("Debes seleccionar un proveedor.");

                const items = [];
                let totalCost = 0;

                // Recolectar ítems de la tabla
                document.querySelectorAll('#po-items-table-body tr').forEach(row => {
                    const materialId = row.dataset.itemId;
                    const itemType = row.dataset.itemType;
                    const quantity = parseInt(row.dataset.quantity);
                    const unitCost = parseFloat(row.dataset.cost);
                    const subtotal = parseFloat(row.dataset.subtotal);

                    if (materialId && quantity > 0 && itemType) {
                        items.push({ materialId, itemType, quantity, unitCost });
                        totalCost += subtotal;
                    }
                });

                if (items.length === 0) throw new Error("Debes añadir al menos un ítem.");

                // 1. Crear la Orden de Compra (Transacción)
                const counterRef = doc(db, "counters", "purchaseOrders");
                const newPoRef = doc(collection(db, "purchaseOrders"));
                let newPoNumber = '';

                await runTransaction(db, async (transaction) => {
                    const counterDoc = await transaction.get(counterRef);
                    const newCount = (counterDoc.exists() ? counterDoc.data().count : 0) + 1;
                    newPoNumber = `PO-${String(newCount).padStart(4, '0')}`;

                    const poData = {
                        poNumber: newPoNumber,
                        supplierId: supplierId,
                        supplierName: supplierName,
                        provider: supplierName,
                        paymentMethod: paymentMethod, // Guardamos el método elegido
                        createdAt: new Date(poDate),
                        createdBy: currentUser.uid,
                        status: 'pendiente', // Nace pendiente, el pago la actualizará si aplica
                        items: items,
                        totalCost: totalCost,
                        paidAmount: 0 // Inicializamos en 0
                    };
                    transaction.set(newPoRef, poData);
                    transaction.update(counterRef, { count: newCount });
                });

                // 2. LÓGICA DE PAGO AUTOMÁTICO
                // Si eligió un método de pago real (no 'pendiente'), registramos el pago inmediatamente
                if (paymentMethod !== 'pendiente') {
                    modalConfirmBtn.textContent = 'Registrando pago...';
                    await registerSupplierPayment(
                        supplierId,
                        totalCost, // Pagamos el valor total de la orden
                        paymentMethod,
                        poDate,
                        `Pago Inmediato PO #${newPoNumber}`
                    );
                    alert(`¡Orden #${newPoNumber} creada y PAGO registrado correctamente!`);
                } else {
                    alert(`¡Orden #${newPoNumber} creada con éxito (Pendiente de pago)!`);
                }

                closeMainModal();

            } catch (error) {
                console.error("Fallo al guardar PO:", error);
                alert("Error: " + error.message);
            } finally {
                modalConfirmBtn.disabled = false;
            }
            break;
        }

        case 'new-supplier-payment': {
            if (!currentSupplierId) {
                alert("Error: No se identificó el proveedor.");
                break;
            }

            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = "Procesando...";

            try {
                const amountToPay = parseFloat(data.amount.replace(/[$. ]/g, '')) || 0;
                if (amountToPay <= 0) throw new Error("Monto inválido.");

                // Usamos la función centralizada
                const billsPaid = await registerSupplierPayment(
                    currentSupplierId,
                    amountToPay,
                    data.paymentMethod,
                    data.date,
                    data.note || 'Abono Manual'
                );

                let msg = `Pago registrado exitosamente.`;
                if (billsPaid > 0) msg += ` Se aplicó a ${billsPaid} orden(es) pendiente(s).`;
                else msg += ` (Quedó como saldo a favor o no había deudas pendientes).`;

                alert(msg);
                closeMainModal();

            } catch (error) {
                console.error("Error al guardar pago:", error);
                alert("Error: " + error.message);
            } finally {
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
        case 'add-anticipo-payment':
        case 'add-corte-payment':
        case 'add-other-payment':
            // Validar monto
            const rawAmountPayment = parseFloat(data.amount.replace(/[$. ]/g, '')) || 0;

            const paymentData = {
                amount: rawAmountPayment,
                date: data.date,
                type: data.type,
                targetId: data.targetId || null,
                concept: data.concept || `Abono a ${data.type === 'abono_anticipo' ? 'Anticipo' : `Corte #${modalForm.dataset.corteNumber || ''}`}`,
                createdAt: new Date() // Importante para ordenar
            };

            // 1. Guardar en la colección de pagos (Historial)
            await addDoc(collection(db, "projects", currentProject.id, "payments"), paymentData);

            // 2. NUEVO: Actualizar el acumulado del proyecto para que CARTERA lo vea
            await updateDoc(doc(db, "projects", currentProject.id), {
                paidAmount: increment(rawAmountPayment)
            });

            modalForm.dataset.corteNumber = '';
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
            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = 'Creando...';

            try {
                let qrURL = null;
                const qrFile = document.getElementById('supplier-qr-input').files[0];

                // Si hay archivo, lo subimos
                if (qrFile) {
                    const storagePath = `suppliers/qr/${Date.now()}_${qrFile.name}`;
                    const storageRef = ref(storage, storagePath);
                    const snapshot = await uploadBytes(storageRef, qrFile);
                    qrURL = await getDownloadURL(snapshot.ref);
                }

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
                    qrCodeURL: qrURL, // <--- GUARDAMOS LA URL AQUÍ
                    createdAt: new Date()
                };
                await addDoc(collection(db, "suppliers"), newSupplierData);

            } catch (error) {
                console.error(error);
                alert("Error al crear proveedor: " + error.message);
            } finally {
                modalConfirmBtn.disabled = false;
            }
            break;
        }

        case 'edit-supplier': {
            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = 'Guardando...';

            try {
                const supplierRef = doc(db, "suppliers", id);
                const qrFile = document.getElementById('supplier-qr-input').files[0];

                const updateData = {
                    name: data.name,
                    nit: data.nit || '',
                    email: data.email || '',
                    address: data.address || '',
                    contactName: data.contactName || '',
                    contactPhone: data.contactPhone || '',
                    bankName: data.bankName || '',
                    accountType: data.accountType || 'Ahorros',
                    accountNumber: data.accountNumber || ''
                };

                // Solo subimos y actualizamos si el usuario seleccionó un archivo nuevo
                if (qrFile) {
                    const storagePath = `suppliers/qr/${Date.now()}_${qrFile.name}`;
                    const storageRef = ref(storage, storagePath);
                    const snapshot = await uploadBytes(storageRef, qrFile);
                    const qrURL = await getDownloadURL(snapshot.ref);
                    updateData.qrCodeURL = qrURL;
                }

                await updateDoc(supplierRef, updateData);

            } catch (error) {
                console.error(error);
                alert("Error al actualizar proveedor.");
            } finally {
                modalConfirmBtn.disabled = false;
            }
            break;
        }
        case 'addItem': { // Se usan llaves para crear un bloque de alcance
            const itemName = data.name.trim().toLowerCase();
            if (!itemName) {
                alert("El nombre del objeto no puede estar vacío.");
                return; // Detiene la ejecución
            }

            // Realiza una consulta para verificar si ya existe un ítem con ese nombre en el proyecto
            const q = query(collection(db, "projects", currentProject.id, "items"), where("name", "==", data.name.trim()));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                alert(`Error: Ya existe un ítem con el nombre "${data.name.trim()}" en este proyecto.`);
                return; // Detiene la ejecución si el nombre ya existe
            }

            // Convertimos cm (del modal) a m (para la DB)
            data.width = parseFloat(data.width) / 100;
            data.height = parseFloat(data.height) / 100;

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
            const q = query(collection(db, "projects", currentProject.id, "items"), where("name", "==", newItemName));
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

            data.width = parseFloat(data.width) / 100; // <-- CAMBIO
            data.height = parseFloat(data.height) / 100; // <-- CAMBIO
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
            try {
                modalConfirmBtn.disabled = true;
                modalConfirmBtn.textContent = 'Guardando...';

                // 1. Obtenemos los datos antiguos para comparar (historial)
                const userRef = doc(db, "users", id);
                const oldUserData = usersMap.get(id) || {};
                const changes = {}; // Objeto para registrar auditoría

                // ---------------------------------------------------------
                // A. PROCESAMIENTO DE FOTO (Cámara o Archivo)
                // ---------------------------------------------------------
                const photoFile = processedPhotoFile; // Variable global de app.js
                processedPhotoFile = null; // Limpiar variable
                let downloadURL = null;

                if (photoFile && photoFile.size > 0) {
                    let fileToResize = photoFile;

                    // Detectar y convertir HEIC (iPhone)
                    const fileType = photoFile.type.toLowerCase();
                    const fileName = photoFile.name.toLowerCase();
                    const isHEIC = fileType === 'image/heic' || fileType === 'image/heif' || fileName.endsWith('.heic');

                    if (isHEIC) {
                        modalConfirmBtn.textContent = 'Convirtiendo HEIC...';
                        const convertedBlob = await heic2any({
                            blob: photoFile,
                            toType: "image/jpeg",
                            quality: 0.8,
                            width: 1024
                        });
                        fileToResize = new File([convertedBlob], "converted.jpg", { type: "image/jpeg" });
                    }

                    // Redimensionar a 400px
                    modalConfirmBtn.textContent = 'Redimensionando foto...';
                    const resizedBlob = await resizeImage(fileToResize, 400);

                    // Subir a Firebase Storage
                    modalConfirmBtn.textContent = 'Subiendo foto...';
                    const photoPath = `profile_photos/${id}/profile.jpg`;
                    const photoStorageRef = ref(storage, photoPath);
                    await uploadBytes(photoStorageRef, resizedBlob);
                    downloadURL = await getDownloadURL(photoStorageRef);

                    // Registrar cambio en historial
                    changes.profilePhotoURL = { old: oldUserData.profilePhotoURL || 'ninguna', new: 'nueva foto' };
                }

                // ---------------------------------------------------------
                // B. LÓGICA DE PERMISOS (SIDEBAR)
                // ---------------------------------------------------------
                const customPermissions = {};

                // Obtenemos el rol base (asumiendo que no cambia en este modal, o está en oldUserData)
                const targetRole = oldUserData.role || 'operario';
                const roleDefaults = getRoleDefaultPermissions(targetRole);

                // Iteramos los checkboxes para detectar cambios respecto al default
                const checkboxes = modalForm.querySelectorAll('.permission-checkbox');
                checkboxes.forEach(cb => {
                    const key = cb.dataset.key;
                    const isChecked = cb.checked;
                    const defaultState = !!roleDefaults[key]; // true si el rol lo tiene, false si no

                    if (isChecked !== defaultState) {
                        // Guardamos la excepción solo si difiere del rol
                        customPermissions[key] = isChecked ? 'show' : 'hide';
                    }
                });

                // ---------------------------------------------------------
                // C. PREPARAR DATOS DE ACTUALIZACIÓN
                // ---------------------------------------------------------
                const dataToUpdate = {
                    firstName: data.firstName,
                    lastName: data.lastName,
                    idNumber: data.idNumber,
                    phone: data.phone,
                    address: data.address,

                    // Datos Bancarios
                    bankName: data.bankName || '',
                    accountType: data.accountType || 'Ahorros',
                    accountNumber: data.accountNumber || '',

                    // Dotación (Tallas)
                    tallaCamiseta: data.tallaCamiseta || '',
                    tallaPantalón: data.tallaPantalón || '',
                    tallaBotas: data.tallaBotas || '',

                    // Nómina
                    commissionLevel: data.commissionLevel || '',
                    salarioBasico: parseFloat(data.salarioBasico.replace(/[$. ]/g, '')) || 0,
                    deduccionSobreMinimo: !!data.deduccionSobreMinimo,

                    // Permisos Calculados
                    customPermissions: customPermissions
                };

                if (downloadURL) {
                    dataToUpdate.profilePhotoURL = downloadURL;
                }

                // ---------------------------------------------------------
                // D. COMPARAR CAMBIOS PARA HISTORIAL
                // ---------------------------------------------------------
                if (data.firstName !== oldUserData.firstName) changes.firstName = { old: oldUserData.firstName, new: data.firstName };
                if (data.lastName !== oldUserData.lastName) changes.lastName = { old: oldUserData.lastName, new: data.lastName };
                if (data.idNumber !== oldUserData.idNumber) changes.idNumber = { old: oldUserData.idNumber, new: data.idNumber };
                if (data.phone !== oldUserData.phone) changes.phone = { old: oldUserData.phone, new: data.phone };
                if (data.address !== oldUserData.address) changes.address = { old: oldUserData.address, new: data.address };

                // Comparar Tallas
                if ((data.tallaCamiseta || '') !== (oldUserData.tallaCamiseta || '')) changes.tallaCamiseta = { old: oldUserData.tallaCamiseta, new: data.tallaCamiseta };
                if ((data.tallaPantalón || '') !== (oldUserData.tallaPantalón || '')) changes.tallaPantalón = { old: oldUserData.tallaPantalón, new: data.tallaPantalón };
                if ((data.tallaBotas || '') !== (oldUserData.tallaBotas || '')) changes.tallaBotas = { old: oldUserData.tallaBotas, new: data.tallaBotas };

                // Comparar Nómina
                const oldSalario = oldUserData.salarioBasico || 0;
                const newSalario = dataToUpdate.salarioBasico;
                if (newSalario !== oldSalario) changes.salarioBasico = { old: oldSalario, new: newSalario };
                if (data.commissionLevel !== (oldUserData.commissionLevel || '')) changes.commissionLevel = { old: oldUserData.commissionLevel, new: data.commissionLevel };

                // Comparar Permisos (Simplificado)
                if (JSON.stringify(oldUserData.customPermissions || {}) !== JSON.stringify(customPermissions)) {
                    changes.permissions = { old: 'Permisos previos', new: 'Permisos actualizados' };
                }

                // ---------------------------------------------------------
                // E. GUARDAR EN FIRESTORE (BATCH)
                // ---------------------------------------------------------
                const batch = writeBatch(db);

                // 1. Actualizar documento del usuario
                batch.update(userRef, dataToUpdate);

                // 2. Crear registro en subcolección profileHistory
                if (Object.keys(changes).length > 0) {
                    const historyRef = doc(collection(userRef, "profileHistory"));
                    batch.set(historyRef, {
                        changes: changes,
                        changedBy: currentUser.uid,
                        timestamp: serverTimestamp()
                    });
                }

                await batch.commit();

            } catch (error) {
                console.error("Error al actualizar perfil:", error);
                alert("Error al actualizar el perfil: " + error.message);
            } finally {
                modalConfirmBtn.disabled = false;
                modalConfirmBtn.textContent = 'Guardar Cambios';
                closeMainModal();
            }
            break;

        case 'editProfile':
            // --- INICIO DE MODIFICACIÓN (Verificar cambios antes de autenticar) ---

            // 1. Obtenemos los datos actuales para comparar
            const user = auth.currentUser;
            const oldUserData = usersMap.get(user.uid) || {};

            // 2. Comparamos los campos (usamos || '' para evitar errores con null/undefined)
            const hasChanges = (
                data.email !== user.email ||
                data.phone !== oldUserData.phone ||
                data.address !== oldUserData.address ||
                (data.tallaCamiseta || '') !== (oldUserData.tallaCamiseta || '') ||
                (data.tallaPantalón || '') !== (oldUserData.tallaPantalón || '') ||
                (data.tallaBotas || '') !== (oldUserData.tallaBotas || '')
            );

            // 3. Decidimos el flujo
            if (hasChanges) {
                // SI HAY CAMBIOS: Iniciar flujo de autenticación facial
                console.log("Cambios detectados en el perfil. Iniciando autenticación facial...");

                // 1. Guardamos los datos del formulario en la variable temporal
                pendingProfileUpdateData = data;

                // 2. Cerramos el modal de perfil
                closeMainModal();

                // 3. Abrimos el modal de autenticación facial
                openProfileAuthModal();

            } else {
                // NO HAY CAMBIOS: Solo cerrar el modal
                console.log("No se detectaron cambios en el perfil. Cerrando modal.");
                closeMainModal();
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
    modal.querySelector('#sub-item-real-width').value = (subItem.realWidth * 100) || ''; // <-- CAMBIO
    modal.querySelector('#sub-item-real-height').value = (subItem.realHeight * 100) || ''; // <-- CAMBIO
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

    // 1. Obtenemos los datos actuales del subItem (para preservar m2 y taskId)
    if (!currentProject || !currentProject.id || !itemId) {
        throw new Error("Contexto de proyecto o ítem perdido. No se puede guardar.");
    }
    const subItemRef = doc(db, "projects", currentProject.id, "items", itemId, "subItems", subItemId);
    const subItemSnap = await getDoc(subItemRef);
    const subItemData = subItemSnap.exists() ? subItemSnap.data() : {};

    const data = {
        location: location,
        realWidth: (parseFloat(document.getElementById('sub-item-real-width').value) / 100) || 0,
        realHeight: (parseFloat(document.getElementById('sub-item-real-height').value) / 100) || 0,

        manufacturer: document.getElementById('sub-item-manufacturer').value,
        installer: document.getElementById('sub-item-installer').value,
        installDate: installDate,

        // --- INICIO DE LA MODIFICACIÓN ---
        m2: subItemData.m2 || 0, // Preservamos los M2
        assignedTaskId: subItemData.assignedTaskId || null // Preservamos el ID de la tarea
        // --- FIN DE LA MODIFICACIÓN ---
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

        await updateSubItem(itemId, subItemId, data);
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
 * Abre el modal para registrar avance en lote, mostrando solo los sub-ítems especificados.
 * Esta función ahora es responsable de cargar TODOS los datos de la tarea.
 * @param {string} originatingTaskId - El ID de la tarea que se está procesando.
 */
async function openMultipleProgressModal(originatingTaskId) {
    const modal = document.getElementById('multiple-progress-modal');
    const title = document.getElementById('multiple-progress-modal-title');
    const tableBody = document.getElementById('multiple-progress-table-body');
    const confirmBtn = document.getElementById('multiple-progress-modal-confirm-btn');

    if (!modal || !title || !tableBody || !confirmBtn) {
        console.error("Error: No se encontraron elementos del modal de progreso múltiple.");
        return;
    }

    // --- INICIO DE OPTIMIZACIÓN ---
    // 1. Mostrar el modal INMEDIATAMENTE
    modal.style.display = 'flex';
    confirmBtn.dataset.originatingTaskId = originatingTaskId || '';
    title.textContent = `Registrar Avance...`; // Título temporal
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Cargando datos de la tarea...</td></tr>';

    // Limpiamos el 'currentItem' global
    currentItem = null;
    // --- FIN DE OPTIMIZACIÓN ---

    try {
        // 2. Cargar los dropdowns (esto es rápido, usa caché 'usersMap')
        document.getElementById('multiple-sub-item-date').value = new Date().toISOString().split('T')[0];

        // 3. Cargar TODO lo demás (la parte lenta)
        const taskRef = doc(db, "tasks", originatingTaskId);
        let taskSnap = await getDoc(taskRef);

        if (!taskSnap.exists()) throw new Error(`La tarea ${originatingTaskId} no fue encontrada.`);

        let taskData = taskSnap.data();

        confirmBtn.dataset.assigneeId = taskData.assigneeId;

        const projectId = taskData.projectId;

        // 4. Cargar el contexto del Proyecto
        const projectDoc = await getDoc(doc(db, "projects", projectId));
        if (!projectDoc.exists()) throw new Error(`El proyecto ${projectId} asociado a la tarea no existe.`);
        currentProject = { id: projectDoc.id, ...projectDoc.data() }; // <-- Contexto global establecido

        // 5. Validar que la tarea tenga ítems
        const taskItems = taskData.selectedItems || [];
        if (taskItems.length === 0) throw new Error("Esta tarea no tiene ítems asociados.");

        // 6. Lógica de Migración / Carga de IDs
        let subItemIdsToShow = [];
        if (taskData.specificSubItemIds && taskData.specificSubItemIds.length > 0) {
            console.log(`[Task Progress] Tarea usa 'specificSubItemIds'.`);
            subItemIdsToShow = taskData.specificSubItemIds;
        } else {
            console.warn(`[Task Progress] Tarea ${originatingTaskId} no tiene 'specificSubItemIds'. Migrando ahora...`);
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Actualizando tarea (migración)...</td></tr>';

            const relevantPendingSubItemIds = [];
            for (const selectedItem of taskItems) {
                const itemId = selectedItem.itemId;
                const quantityNeeded = selectedItem.quantity;
                if (quantityNeeded <= 0) continue;

                const subItemsQuery = query(
                    collection(db, "projects", projectId, "items", itemId, "subItems"),
                    where("status", "!=", "Instalado"),
                    orderBy("number", "asc"),
                    limit(quantityNeeded)
                );
                const subItemsSnapshot = await getDocs(subItemsQuery);
                subItemsSnapshot.forEach(subItemDoc => {
                    relevantPendingSubItemIds.push(subItemDoc.id);
                });
            }

            if (relevantPendingSubItemIds.length === 0) {
                throw new Error("No se encontraron sub-ítems pendientes para esta tarea.");
            }

            await updateDoc(taskRef, { specificSubItemIds: relevantPendingSubItemIds });
            subItemIdsToShow = relevantPendingSubItemIds;
        }

        // 7. Cargar los sub-ítems para el modal
        title.textContent = `Registrar Avance para ${subItemIdsToShow.length} Unidad(es)`;
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Cargando sub-ítems...</td></tr>';

        const subItemsData = [];
        const itemsMap = new Map();

        for (const item of taskItems) {
            if (!itemsMap.has(item.itemId)) {
                const itemDoc = await getDoc(doc(db, "projects", currentProject.id, "items", item.itemId));
                itemsMap.set(item.itemId, itemDoc.exists() ? itemDoc.data().name : `Ítem Desconocido`);
            }

            // Particionamos la consulta en lotes de 30 (límite de Firestore)
            for (let i = 0; i < subItemIdsToShow.length; i += 30) {
                const chunkIds = subItemIdsToShow.slice(i, i + 30);
                const qSubItems = query(
                    collection(db, "projects", currentProject.id, "items", item.itemId, "subItems"),
                    where(documentId(), "in", chunkIds)
                );
                const subItemsSnapshot = await getDocs(qSubItems);
                subItemsSnapshot.forEach(docSnap => {
                    if (docSnap.data().status !== 'Instalado') {
                        subItemsData.push({ id: docSnap.id, ...docSnap.data() });
                    }
                });
            }
        }

        if (subItemsData.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Todos los sub-ítems solicitados ya están instalados o no se encontraron.</td></tr>';
            return;
        }

        // 8. Agrupar y renderizar (lógica sin cambios)
        const groupedSubItems = new Map();
        subItemsData.forEach(subItem => {
            if (!groupedSubItems.has(subItem.itemId)) {
                groupedSubItems.set(subItem.itemId, []);
            }
            groupedSubItems.get(subItem.itemId).push(subItem);
        });

        groupedSubItems.forEach((subItemsArray) => {
            subItemsArray.sort((a, b) => (a.number || 0) - (b.number || 0));
        });

        tableBody.innerHTML = ''; // Limpiamos el "Cargando..."
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
                row.dataset.itemId = subItem.itemId;
                row.innerHTML = `
                    <td class="px-4 py-2 font-bold">${subItem.number}</td>
                    <td class="px-4 py-2"><input type="text" class="location-input mt-1 block w-full px-2 py-1 border rounded-md text-sm" value="${subItem.location || ''}"></td>
                    <td class="px-4 py-2"><input type="number" class="real-width-input mt-1 block w-full px-2 py-1 border rounded-md text-sm" value="${(subItem.realWidth * 100) || ''}"></td>
                    <td class="px-4 py-2"><input type="number" class="real-height-input mt-1 block w-full px-2 py-1 border rounded-md text-sm" value="${(subItem.realHeight * 100) || ''}"></td>
                    <td class="px-4 py-2"><input type="file" class="photo-input" accept="image/*" capture="environment" style="display: block; width: 100%;"></td>
                `;
                tableBody.appendChild(row);
            });
        });

    } catch (error) {
        console.error("Error al cargar y agrupar sub-ítems:", error);
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">Error al cargar datos: ${error.message}</td></tr>`;

        // Ocultamos el botón de guardar si hay un error
        if (confirmBtn) confirmBtn.disabled = true;
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
        feedbackP.textContent = 'Validando y obteniendo datos de equipo...';
        feedbackP.className = 'text-sm mt-4 text-center text-blue-600';
    }

    let taskData = null;
    let taskTeamUids = [];

    // 1. Obtener la lista completa del equipo de la Tarea (solo una vez)
    const originatingTaskId = confirmBtn.dataset.originatingTaskId;
    if (originatingTaskId) {
        try {
            const taskRef = doc(db, "tasks", originatingTaskId);
            const taskSnap = await getDoc(taskRef);
            if (taskSnap.exists()) {
                taskData = taskSnap.data();
                if (taskData.assigneeId) taskTeamUids.push(taskData.assigneeId);
                if (Array.isArray(taskData.additionalAssigneeIds)) {
                    taskTeamUids.push(...taskData.additionalAssigneeIds.filter(uid => uid !== taskData.assigneeId));
                }
            }
        } catch (e) {
            console.warn("No se pudo cargar el equipo de la tarea:", e);
        }
    }
    taskTeamUids = taskTeamUids.filter(Boolean); // Limpiamos nulos

    let success = false;
    let validationError = null;

    if (!currentProject || !currentProject.id) {
        console.error("Error al guardar: Contexto de 'currentProject' no está definido.");
        alert("Error: No se pudo identificar el proyecto actual. Recarga la página.");
        feedbackP.textContent = 'Error de contexto.';
        feedbackP.className = 'text-sm mt-4 text-center text-red-600';
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Guardar Cambios';
        return;
    }

    currentItem = null;

    try {
        // 2. Definir quién instala (El usuario logueado)
        const commonData = {
            installDate: document.getElementById('multiple-sub-item-date').value,
            installer: currentUser.uid
        };

        const tableRows = document.querySelectorAll('#multiple-progress-table-body tr.subitem-row');
        const batch = writeBatch(db);
        const photoUploads = [];
        const updatedSubItemIds = [];
        let rowsProcessed = 0;

        // (Mapeo de subItemsMap omitido por brevedad, se mantiene igual)
        const subItemPaths = Array.from(tableRows).map(row => ({
            itemId: row.dataset.itemId,
            subItemId: row.dataset.id
        }));
        const subItemsMap = new Map();
        if (subItemPaths.length > 0) {
            const subItemPromises = subItemPaths.map(path =>
                getDoc(doc(db, "projects", currentProject.id, "items", path.itemId, "subItems", path.subItemId))
            );
            const subItemDocs = await Promise.all(subItemPromises);
            subItemDocs.forEach(docSnap => {
                if (docSnap.exists()) subItemsMap.set(docSnap.id, docSnap.data());
            });
        }

        // 5. Iterar y validar
        for (const row of tableRows) {
            const subItemId = row.dataset.id;
            const itemId = row.dataset.itemId;
            if (!itemId) continue;

            const subItemData = subItemsMap.get(subItemId) || {};

            const individualData = {
                location: row.querySelector('.location-input').value.trim(),
                realWidth: (parseFloat(row.querySelector('.real-width-input').value) / 100) || 0,
                realHeight: (parseFloat(row.querySelector('.real-height-input').value) / 100) || 0,
            };
            const photoFile = row.querySelector('.photo-input').files[0];

            if (!individualData.location) continue;

            rowsProcessed++;
            updatedSubItemIds.push(subItemId);

            let finalStatus = subItemData.status;
            if (commonData.installer) finalStatus = 'Instalado';
            else if (commonData.manufacturer) finalStatus = 'Pendiente de Instalación';

            if (finalStatus === 'Instalado') {
                if (!photoFile && !subItemData.photoURL) {
                    validationError = `Falta la foto de evidencia para la Unidad (Lugar: ${individualData.location}).`;
                    break;
                }
            }

            const dataToUpdate = {
                ...commonData,
                ...individualData,
                status: finalStatus,
                m2: subItemData.m2 || 0,
                manufacturer: subItemData.manufacturer || currentUser.uid,
                assignedTaskId: subItemData.assignedTaskId || (taskData ? originatingTaskId : null),
                installersTeam: taskTeamUids // Array del equipo para bonificación
            };

            const subItemRef = doc(db, "projects", currentProject.id, "items", itemId, "subItems", subItemId);
            batch.update(subItemRef, dataToUpdate);

            if (photoFile) {
                if (subItemData && currentProject.id && subItemData.itemId) {
                    const watermarkText = `Vidrios Exito - ${currentProject?.name} - ${commonData.installDate} - ${individualData.location}`;
                    photoUploads.push({
                        subItemId: subItemId,
                        photoFile: photoFile,
                        watermarkText: watermarkText,
                        itemId: subItemData.itemId,
                        projectId: currentProject.id
                    });
                }
            }
        }

        // 6. Validaciones
        if (validationError) {
            alert(validationError);
            throw new Error("Error de validación de usuario.");
        }

        if (rowsProcessed === 0) {
            alert("No se registró ningún avance.");
            throw new Error("No se procesaron filas.");
        }

        // 7. Guardar
        await batch.commit();
        if (feedbackP) feedbackP.textContent = `Datos guardados para ${rowsProcessed} unidad(es). Procesando fotos...`;

        // 8. Fotos
        for (const upload of photoUploads) {
            try {
                const watermarkedBlob = await addWatermark(upload.photoFile, upload.watermarkText);
                const storageRef = ref(storage, `evidence/${upload.projectId}/${upload.itemId}/${upload.subItemId}`);
                const snapshot = await uploadBytes(storageRef, watermarkedBlob);
                const downloadURL = await getDownloadURL(snapshot.ref);
                const subItemRef_photo = doc(db, "projects", upload.projectId, "items", upload.itemId, "subItems", upload.subItemId);
                await updateDoc(subItemRef_photo, { photoURL: downloadURL });
            } catch (photoError) {
                console.error(`Error foto ${upload.subItemId}:`, photoError);
            }
        }

        // 9. Lógica de verificación de tarea
        let feedbackMessage = `¡Avance registrado para ${rowsProcessed} unidad(es)!`;

        // --- CORRECCIÓN: DEFINICIÓN DE LA VARIABLE FALTANTE ---
        let feedbackClass = 'text-sm mt-4 text-center text-green-600';
        // -----------------------------------------------------

        let isTaskNowComplete = false;

        if (originatingTaskId && commonData.installer) {
            if (feedbackP) feedbackP.textContent = 'Fotos subidas. Verificando estado de la tarea...';

            if (taskData && taskData.specificSubItemIds && taskData.specificSubItemIds.length > 0 && taskData.selectedItems) {
                const allTaskSubItemIds = taskData.specificSubItemIds;
                let totalPending = 0;

                for (const item of taskData.selectedItems) {
                    const itemId = item.itemId;
                    const subItemDocs = [];
                    // Lógica de chunks para verificar estado...
                    for (let i = 0; i < allTaskSubItemIds.length; i += 30) {
                        const chunkIds = allTaskSubItemIds.slice(i, i + 30);
                        const q = query(
                            collection(db, "projects", taskData.projectId, "items", itemId, "subItems"),
                            where(documentId(), "in", chunkIds)
                        );
                        const snapshot = await getDocs(q);
                        snapshot.forEach(doc => subItemDocs.push(doc));
                    }

                    for (const docSnap of subItemDocs) {
                        if (docSnap.exists()) {
                            if (allTaskSubItemIds.includes(docSnap.id) && docSnap.data().status !== 'Instalado') {
                                totalPending++;
                            }
                        }
                    }
                }

                if (totalPending === 0) {
                    const taskRef = doc(db, "tasks", originatingTaskId);
                    await updateDoc(taskRef, { status: 'completada', completedAt: new Date(), completedBy: currentUser.uid });
                    feedbackMessage = '¡Avance registrado y tarea completada!';
                    isTaskNowComplete = true;
                } else {
                    feedbackMessage = `¡Avance registrado para ${rowsProcessed} unidad(es)! Aún quedan ${totalPending} pendientes.`;
                }
            }
        }

        // Mostrar mensaje final
        if (feedbackP) {
            feedbackP.textContent = feedbackMessage;
            feedbackP.className = feedbackClass; // Ahora sí existe la variable
        }

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
        console.error("Error al guardar el avance múltiple:", error);
        if (feedbackP && !validationError) {
            feedbackP.textContent = 'Error al guardar. Revisa la consola.';
            feedbackP.className = 'text-sm mt-4 text-center text-red-600';
        }
    } finally {
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

window.openImageModal = openImageModal;

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
        ["Ancho (cm)", "Ancho en centímetros (número entero). Ej: 150"],
        ["Alto (cm)", "Alto en centímetros (número entero). Ej: 220"],
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
            'Ancho (cm)': 80,
            'Alto (cm)': 60,
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
            'Ancho (cm)': 150,
            'Alto (cm)': 120,
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
                if (!row['Nombre del Ítem'] || !row['Cantidad'] || !row['Ancho (cm)'] || !row['Alto (cm)']) {
                    console.warn("Fila omitida por falta de datos básicos (Nombre, Cantidad, Ancho (cm), Alto (cm)):", row);
                    continue;
                }

                // Construimos el objeto de datos que espera la función createItem
                const itemData = {
                    name: row['Nombre del Ítem'],
                    quantity: row['Cantidad'],
                    // Convertimos de (cm) a (m) antes de guardar
                    width: (parseFloat(row['Ancho (cm)']) / 100) || 0,
                    height: (parseFloat(row['Alto (cm)']) / 100) || 0,
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
//      INICIO: FUNCIÓN EXPORTAR A PDF (MEMORIA DE PROYECTO) CON DATOS DE EMPRESA
// ====================================================================
async function exportProjectToPDF() {
    loadingOverlay.classList.remove('hidden');
    
    try {
        // 1. OBTENER DATOS
        const companyData = await getCompanyData(); // <--- NUEVO: Carga datos de empresa
        const projectId = currentProject.id;

        // Cargar datos del proyecto en paralelo
        const [itemsSnapshot, subItemsSnapshot, cortesSnapshot] = await Promise.all([
            getDocs(query(collection(db, "items"), where("projectId", "==", projectId))),
            getDocs(query(collection(db, "subItems"), where("projectId", "==", projectId))),
            getDocs(query(collection(db, "projects", projectId, "cortes"), where("status", "==", "aprobado"), orderBy("corteNumber")))
        ]);

        const itemsMap = new Map(itemsSnapshot.docs.map(doc => [doc.id, { id: doc.id, ...doc.data() }]));
        const subItemsMap = new Map(subItemsSnapshot.docs.map(doc => [doc.id, { id: doc.id, ...doc.data() }]));
        const approvedCortes = cortesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 2. INICIAR PDF
        const { jsPDF } = window.jspdf;
        const docPDF = new jsPDF();
        const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
        
        let yPosition = 20; // Posición inicial vertical

        // --- 3. ENCABEZADO DINÁMICO DE EMPRESA ---
        const logoUrl = companyData.logoURL;
        const companyName = companyData.nombre || "Vidrios Éxito S.A.S";
        const companyNit = companyData.nit ? `NIT: ${companyData.nit}` : "";

        // Intentar agregar logo si existe URL
        if (logoUrl) {
            try {
                // Definir dimensiones del logo en el PDF
                const logoWidth = 30; 
                const logoHeight = 30; 
                
                // Agregar imagen (X, Y, W, H)
                // Nota: jsPDF intentará descargar la imagen. Si hay error de CORS, saltará al catch.
                docPDF.addImage(logoUrl, 'PNG', 14, 10, logoWidth, logoHeight);
                
                // Mover texto a la derecha del logo
                docPDF.setFontSize(16);
                docPDF.setFont("helvetica", "bold");
                docPDF.text(companyName, 50, 20);
                
                docPDF.setFontSize(10);
                docPDF.setFont("helvetica", "normal");
                docPDF.text(companyNit, 50, 26);
                docPDF.text(`Fecha de Reporte: ${new Date().toLocaleDateString('es-CO')}`, 50, 32);
                
                yPosition = 45; // Ajustar posición Y para no solapar el logo
            } catch (e) {
                console.warn("No se pudo cargar el logo en el PDF (posible restricción de seguridad/CORS):", e);
                // Fallback: Encabezado simple sin logo
                docPDF.setFontSize(18);
                docPDF.setFont("helvetica", "bold");
                docPDF.text(companyName, 14, 22);
                docPDF.setFontSize(10);
                docPDF.setFont("helvetica", "normal");
                docPDF.text(companyNit, 14, 28);
                yPosition = 40;
            }
        } else {
            // Encabezado estándar si no hay logo configurado
            docPDF.setFontSize(18);
            docPDF.setFont("helvetica", "bold");
            docPDF.text(companyName, 14, 22);
            docPDF.setFontSize(12);
            docPDF.setTextColor(100);
            docPDF.text(companyNit, 14, 28);
            docPDF.text(`Fecha: ${new Date().toLocaleDateString('es-CO')}`, 14, 34);
            yPosition = 42;
        }

        // --- DATOS DEL PROYECTO ---
        docPDF.setDrawColor(200);
        docPDF.line(14, yPosition, 196, yPosition); // Línea separadora
        yPosition += 10;

        docPDF.setFontSize(14);
        docPDF.setTextColor(0);
        docPDF.setFont("helvetica", "bold");
        docPDF.text(`Memoria de Proyecto: ${currentProject.name}`, 14, yPosition);
        yPosition += 6;
        
        docPDF.setFontSize(11);
        docPDF.setTextColor(100);
        docPDF.setFont("helvetica", "normal");
        docPDF.text(`Constructora: ${currentProject.builderName || 'No especificada'}`, 14, yPosition);
        yPosition += 10;

        // --- TABLA RESUMEN CONTRATO ---
        const contractedValue = await calculateProjectContractedValue(projectId);
        const contractDetails = [
            ["Valor del Contrato:", currencyFormatter.format(currentProject.value || 0)],
            ["Valor Contratado (Ítems):", currencyFormatter.format(contractedValue)],
            ["Anticipo:", currencyFormatter.format(currentProject.advance || 0)],
            ["Fecha Inicio:", currentProject.startDate ? new Date(currentProject.startDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A'],
        ];

        docPDF.autoTable({
            startY: yPosition,
            head: [['Detalles del Contrato', '']],
            body: contractDetails,
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185] },
            styles: { fontSize: 10 },
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } }
        });
        yPosition = docPDF.autoTable.previous.finalY + 15;

        // --- DETALLE DE CORTES APROBADOS ---
        docPDF.setFontSize(14);
        docPDF.setTextColor(0);
        docPDF.setFont("helvetica", "bold");
        docPDF.text("Detalle de Cortes Aprobados", 14, yPosition);
        yPosition += 8;

        if (approvedCortes.length === 0) {
            docPDF.setFontSize(11);
            docPDF.setFont("helvetica", "italic");
            docPDF.setTextColor(100);
            docPDF.text("No hay cortes aprobados para mostrar.", 14, yPosition);
        }

        for (const corte of approvedCortes) {
            const tableRows = [];

            // Listar Sub-ítems del corte
            for (const subItemId of corte.subItemIds) {
                const subItem = subItemsMap.get(subItemId);
                if (subItem) {
                    const parentItem = itemsMap.get(subItem.itemId);
                    const parentName = parentItem ? parentItem.name : 'Ítem eliminado';
                    const parentWidth = parentItem ? parentItem.width : 0;
                    const parentHeight = parentItem ? parentItem.height : 0;
                    
                    const medida = `${parentWidth}m x ${parentHeight}m`;
                    const fecha = subItem.installDate ? new Date(subItem.installDate + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A';
                    tableRows.push([`${parentName} - #${subItem.number}`, subItem.location || 'Sin ubicación', medida, fecha]);
                }
            }

            // Tabla de Ítems del Corte
            docPDF.autoTable({
                startY: yPosition,
                head: [[{ content: `CORTE #${corte.corteNumber} ${corte.isFinal ? '(FINAL)' : ''}`, colSpan: 4, styles: { fillColor: [39, 174, 96], textColor: 255, fontStyle: 'bold', halign: 'center' } }]],
                body: tableRows,
                columns: [
                    { header: 'Ítem', dataKey: 0 }, 
                    { header: 'Ubicación', dataKey: 1 }, 
                    { header: 'Medida', dataKey: 2 }, 
                    { header: 'Fecha Inst.', dataKey: 3 }
                ],
                theme: 'grid',
                headStyles: { fillColor: [52, 73, 94], textColor: 255 },
                styles: { fontSize: 9 },
                // Controlar salto de página automático
                pageBreak: 'auto',
            });
            
            // Actualizar Y después de la tabla
            yPosition = docPDF.autoTable.previous.finalY;

            // Resumen Financiero del Corte (Pequeña tabla alineada a la derecha)
            const financialSummary = [
                ['Valor Bruto:', currencyFormatter.format(corte.totalValue || 0)],
            ];
            if (corte.amortizacion > 0) {
                financialSummary.push(['Amortización Anticipo:', `- ${currencyFormatter.format(corte.amortizacion)}`]);
            }
            if (corte.otrosDescuentos && Array.isArray(corte.otrosDescuentos)) {
                corte.otrosDescuentos.forEach(d => {
                    financialSummary.push([`Desc. (${d.concept || 'Varios'}):`, `- ${currencyFormatter.format(d.value)}`]);
                });
            }
            financialSummary.push(['Neto a Pagar:', currencyFormatter.format(corte.netoAPagar || 0)]);

            docPDF.autoTable({
                startY: yPosition + 2,
                body: financialSummary,
                theme: 'plain',
                styles: { fontSize: 9, cellPadding: 1 },
                columnStyles: {
                    0: { fontStyle: 'bold', halign: 'right', cellWidth: 'auto' },
                    1: { halign: 'right', cellWidth: 40 }
                },
                // Alinear tabla a la derecha
                margin: { left: 120 } 
            });
            
            yPosition = docPDF.autoTable.previous.finalY + 15;
            
            // Verificar espacio para el siguiente corte
            if (yPosition > 250) {
                docPDF.addPage();
                yPosition = 20;
            }
        }

        // --- GUARDAR ---
        docPDF.save(`Memoria_Proyecto_${currentProject.name.replace(/\s/g, '_')}.pdf`);

    } catch (error) {
        console.error("Error al exportar a PDF:", error);
        alert("Ocurrió un error al generar el PDF: " + error.message);
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}
// ====================================================================
//      FIN FUNCIÓN EXPORTAR
// ====================================================================

// --- NOTIFICACIONES ---
/**
 * Elimina la foto de evidencia de un sub-ítem y actualiza su estado.
 * Ahora maneja los errores 404 de Storage (archivos no encontrados).
 */
async function handleDeletePhoto(subItemId, itemId, installerId, projectId) {

    // Paso 1: Intentar borrar la foto de Storage
    try {
        const storageRef = ref(storage, `evidence/${projectId}/${itemId}/${subItemId}`);
        await deleteObject(storageRef);

    } catch (error) {
        if (error.code === 'storage/object-not-found') {
            console.warn(`Archivo no encontrado en Storage (probablemente migrado o ya borrado): ${error.message}`);
        } else {
            console.error("Error al eliminar la foto de Storage:", error);
            alert("No se pudo eliminar la foto de Storage. Revisa los permisos.");
            return; // Detenemos la ejecución
        }
    }

    // Paso 2: Actualizar la base de datos y enviar notificación
    try {
        // --- INICIO DE CORRECCIÓN ---
        // 1. Definir la referencia
        const subItemRef = doc(db, "projects", projectId, "items", itemId, "subItems", subItemId);

        // 2. Obtener el sub-item ANTES de actualizarlo para leer su 'location'
        let subItemLocation = `Unidad ${subItemId.substring(0, 5)}...`; // Fallback
        try {
            const subItemSnap = await getDoc(subItemRef);
            if (subItemSnap.exists() && subItemSnap.data().location) {
                subItemLocation = subItemSnap.data().location;
            }
        } catch (e) { console.warn("No se pudo leer la ubicación del sub-item."); }

        // 3. Actualizar el documento
        await updateDoc(subItemRef, { photoURL: '', status: 'Faltante de Evidencia' });

        const itemDoc = await getDoc(doc(db, "projects", projectId, "items", itemId));
        const itemName = itemDoc.exists() ? itemDoc.data().name : "un ítem";

        // 4. Crear notificación con el mensaje corregido
        const projectName = currentProject.name || "un proyecto";
        await addDoc(collection(db, "notifications"), {
            userId: installerId,
            message: `Foto rechazada para ítem #${itemName} (Lugar: ${subItemLocation}). Por favor, sube una nueva.`,
            projectName: projectName,
            subItemId: subItemId, // <-- Importante: Guarda el ID del sub-ítem
            itemId: itemId,       // <-- Importante: Guarda el ID del ítem padre
            projectId: projectId, // <-- Importante: Guarda el ID del proyecto
            read: false,
            createdAt: serverTimestamp(),
            type: 'photo_rejected' // <-- Importante: Identifica esta notificación
        });
        // --- FIN DE CORRECCIÓN ---

    } catch (error) {
        console.error("Error al actualizar la foto en Firestore:", error);
        alert("No se pudo actualizar el estado de la foto en la base de datos.");
    }
}


/**
 * Convierte un objeto Date a un formato de "hace tanto tiempo".
 * @param {Date} date - La fecha a formatear.
 * @returns {string} - El texto formateado (ej: "Hace 5 minutos").
 */
function timeAgoFormat(date) {

    // --- INICIO DE LA CORRECCIÓN ---
    // La lógica de 'if' fue desenredada.

    if (date && typeof date.toDate === 'function') {
        // 1. Si 'date' es un objeto Timestamp de Firestore, conviértelo a JS Date
        date = date.toDate();
    } else if (!date || !(date instanceof Date)) {
        // 2. Si no es un Timestamp, ni una Fecha, o es nulo, retorna un valor seguro.
        console.warn("timeAgoFormat recibió una fecha inválida:", date);
        return "hace un momento";
    }
    // --- FIN DE LA CORRECCIÓN ---

    // 3. El resto de la función ahora funciona porque 'date' SIEMPRE es un JS Date.
    const now = new Date();
    const seconds = Math.round((now - date) / 1000);

    const minute = 60;
    const hour = minute * 60;
    const day = hour * 24;
    const week = day * 7;
    const month = day * 30; // Aproximación
    const year = day * 365;

    if (seconds < 30) {
        return "Ahora mismo";
    } else if (seconds < minute) {
        return `Hace ${seconds} segundos`;
    } else if (seconds < hour) {
        const minutes = Math.floor(seconds / minute);
        return `Hace ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    } else if (seconds < day) {
        const hours = Math.floor(seconds / hour);
        return `Hace ${hours} hora${hours > 1 ? 's' : ''}`;
    } else if (seconds < week) {
        const days = Math.floor(seconds / day);
        return `Hace ${days} día${days > 1 ? 's' : ''}`;
    } else if (seconds < month) {
        const weeks = Math.floor(seconds / week);
        return `Hace ${weeks} semana${weeks > 1 ? 's' : ''}`;
    } else if (seconds < year) {
        const months = Math.floor(seconds / month);
        return `Hace ${months} mes${months > 1 ? 'es' : ''}`;
    } else {
        const years = Math.floor(seconds / year);
        return `Hace ${years} año${years > 1 ? 's' : ''}`;
    }
}
// --- FIN DE FUNCIÓN 'timeAgoFormat' ---


/**
 * Carga notificaciones (personales y de canal) en tiempo real
 * y maneja los clics de navegación.
 */
function loadNotifications() {
    console.log("DEBUG: loadNotifications() iniciada.");
    const notificationsList = document.getElementById('notifications-list');
    const notificationBadge = document.getElementById('notification-badge');

    if (!currentUser || !notificationsList || !notificationBadge) {
        console.warn("DEBUG: loadNotifications() detenida. Falta currentUser, notificationsList o notificationBadge.");
        return;
    }

    // --- 1. FUNCIÓN DE RENDERIZADO (Con data-subitem-id) ---
    // Esta función interna dibuja el HTML
    const renderNotifications = (personal, channel) => {
        console.log("DEBUG: renderNotifications() llamada.");
        // Asegurarse de que el elemento exista antes de modificarlo
        const listEl = document.getElementById('notifications-list');
        const badgeEl = document.getElementById('notification-badge');
        if (!listEl || !badgeEl) return;

        listEl.innerHTML = '';
        const allNotifications = [...personal, ...channel];

        // Ordenar por fecha (más nuevas primero)
        allNotifications.sort((a, b) => {
            // Manejar Timestamps de Firestore
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date();
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date();
            return dateB - dateA;
        });

        if (allNotifications.length === 0) {
            listEl.innerHTML = '<li class="p-4 text-sm text-gray-500 text-center">No tienes notificaciones nuevas.</li>';
            badgeEl.classList.add('hidden');
            return;
        }

        console.log("DEBUG: Renderizando notificaciones...");
        badgeEl.classList.remove('hidden');

        allNotifications.forEach(notification => {
            const li = document.createElement('li');
            li.className = 'border-b border-gray-200 last:border-b-0';

            // Usamos la función timeAgoFormat que acabamos de definir
            const timeAgo = timeAgoFormat(notification.createdAt);
            let iconSvg = '';
            let title = 'Notificación';

            // Iconos y títulos (lógica existente)
            switch (notification.type) {
                case 'task_comment':
                    iconSvg = `<svg class="h-6 w-6 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17.608V14.5A8 8 0 0110 3c4.418 0 8 3.134 8 7zm-7-1a1 1 0 11-2 0 1 1 0 012 0zm4 0a1 1 0 11-2 0 1 1 0 012 0z" clip-rule="evenodd"></path></svg>`;
                    title = notification.title || 'Nuevo Comentario';
                    break;
                case 'new_task_assignment':
                    iconSvg = `<svg class="h-6 w-6 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a6 6 0 00-6 6v3.586l-1.707 1.707A1 1 0 003 14v2a1 1 0 001 1h12a1 1 0 001-1v-2a1 1 0 00-.293-.707L16 11.586V8a6 6 0 00-6-6zM8.05 16a2 2 0 113.9 0H8.05zM10 6a2 2 0 110 4 2 2 0 010-4z"></path></svg>`;
                    title = 'Nueva Tarea Asignada';
                    break;
                case 'photo_rejected': // <-- Nuestro nuevo tipo
                    iconSvg = `<svg class="h-6 w-6 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 101.414-1.414L11.414 10l1.293-1.293z" clip-rule="evenodd"></path></svg>`;
                    title = 'Foto Rechazada';
                    break;
                default:
                    iconSvg = `<svg class="h-6 w-6 text-gray-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path></svg>`;
            }

            // Renderizar el HTML de la notificación
            li.innerHTML = `
                <div class="flex items-start px-3 py-1 hover:bg-gray-50">
                    <div class="pt-3 pr-2 flex-shrink-0">
                        ${iconSvg}
                    </div>
                    <div data-action="navigate-notification" 
                         class="flex-grow py-3 cursor-pointer min-w-0"
                         data-id="${notification.id}"
                         data-project-id="${notification.projectId || ''}"
                         data-task-id="${notification.taskId || ''}"
                         data-item-id="${notification.itemId || ''}"
                         data-subitem-id="${notification.subItemId || ''}"
                         data-link="${notification.link || ''}"
                    >
                        <p class="text-xs font-semibold text-blue-600 uppercase pointer-events-none">${notification.projectName || 'General'}</p>
                        <p class="text-sm font-semibold text-gray-900 pointer-events-none">${notification.title || title}</p>
                        <p class="mt-1 pl-3 border-l-4 border-gray-200 text-sm text-gray-600 pointer-events-none whitespace-normal break-words">${notification.message}</p>
                        <p class="text-xs text-blue-500 font-medium pointer-events-none mt-1">${timeAgo}</p>
                    </div>
                    <button data-action="delete-notification" data-id="${notification.id}" class="flex-shrink-0 p-3 text-gray-400 hover:text-red-500" title="Descartar">
                        <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path></svg>
                    </button>
                </div>
            `;
            listEl.appendChild(li);
        });
    };

    // --- 2. LISTENERS DE FIRESTORE (Sin cambios) ---
    let personalNotifs = [];
    let channelNotifs = [];

    const personalQuery = query(collection(db, "notifications"), where("userId", "==", currentUser.uid), where("read", "==", false));
    const unsubscribePersonal = onSnapshot(personalQuery, (snapshot) => {
        console.log(`DEBUG: 'personalQuery' obtuvo ${snapshot.docs.length} docs.`);
        personalNotifs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // --- INICIO CÓDIGO MEJORADO: ALERTA URGENTE CON SONIDO ---
        const urgentAlert = personalNotifs.find(n => n.type === 'admin_urgent_alert' && !n.read);

        if (urgentAlert) {
            const overlay = document.getElementById('admin-alert-overlay');
            const msgEl = document.getElementById('admin-alert-message');
            const senderEl = document.getElementById('admin-alert-sender');
            const timeEl = document.getElementById('admin-alert-time');
            const dismissBtn = document.getElementById('dismiss-alert-btn');

            if (overlay && overlay.classList.contains('hidden')) {
                // Rellenar textos
                msgEl.textContent = urgentAlert.message;
                senderEl.textContent = urgentAlert.senderName || "Administración";
                timeEl.textContent = formatTimeAgo(urgentAlert.createdAt?.toDate ? urgentAlert.createdAt.toDate().getTime() : Date.now());

                // --- LÓGICA MEJORADA DE ADJUNTO ---
                let imgContainer = document.getElementById('admin-alert-img-container');
                if (!imgContainer) {
                    // Crear contenedor si no existe
                    imgContainer = document.createElement('div');
                    imgContainer.id = 'admin-alert-img-container';
                    imgContainer.className = "mb-6 w-full rounded-xl overflow-hidden hidden shadow-lg border-2 border-white/30";
                    msgEl.parentElement.after(imgContainer);
                }

                if (urgentAlert.photoURL) {
                    imgContainer.classList.remove('hidden');

                    // Detectar si es PDF (por el campo nuevo o por la extensión si es antiguo)
                    const isPDF = urgentAlert.attachmentType === 'pdf' || urgentAlert.photoURL.toLowerCase().includes('.pdf');

                    if (isPDF) {
                        // MODO PDF: Botón grande
                        imgContainer.className = "mb-6 w-full hidden"; // Quitamos estilos de imagen, dejamos margen
                        imgContainer.classList.remove('hidden');

                        imgContainer.innerHTML = `
                            <button type="button" id="btn-view-pdf-alert" class="w-full bg-white/10 border-2 border-white/40 hover:bg-white/20 text-white py-4 rounded-xl flex flex-col items-center transition-all group">
                                <i class="fa-solid fa-file-pdf text-4xl mb-2 text-red-100 group-hover:scale-110 transition-transform"></i>
                                <span class="font-bold underline">Ver Documento PDF Adjunto</span>
                            </button>
                        `;

                        // Listener para abrir PDF
                        setTimeout(() => {
                            document.getElementById('btn-view-pdf-alert').onclick = () => {
                                viewDocument(urgentAlert.photoURL, "Documento de Alerta");
                            };
                        }, 0);

                    } else {
                        // MODO IMAGEN: Clicable para Zoom
                        imgContainer.className = "mb-6 w-full rounded-xl overflow-hidden shadow-lg border-2 border-white/30 relative group cursor-zoom-in";
                        imgContainer.classList.remove('hidden');

                        imgContainer.innerHTML = `
                            <img src="${urgentAlert.photoURL}" class="w-full h-48 object-cover" alt="Evidencia">
                            <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center pointer-events-none">
                                <i class="fa-solid fa-magnifying-glass-plus text-white opacity-0 group-hover:opacity-100 text-3xl drop-shadow-lg transform scale-50 group-hover:scale-100 transition-all"></i>
                            </div>
                        `;

                        // Listener para abrir Modal de Imagen (Zoom)
                        imgContainer.onclick = () => {
                            openImageModal(urgentAlert.photoURL);
                        };
                    }

                } else {
                    imgContainer.classList.add('hidden');
                    imgContainer.innerHTML = '';
                }
                // --------------------------------

                // Mostrar Overlay
                overlay.classList.remove('hidden');
                overlay.classList.add('flex');

                // --- LÓGICA DE SONIDO DE ALARMA ---
                // Usamos un sonido de "Sonar/Alarma" (puedes cambiar esta URL por un archivo local)
                const alertSound = new Audio('https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3');
                alertSound.volume = 1.0; // Volumen máximo

                // Función para reproducir 3 veces
                let playCount = 0;
                const playAlarm = () => {
                    if (playCount < 3) { // Sonar 3 veces
                        alertSound.play().then(() => {
                            playCount++;
                        }).catch(error => {
                            console.warn("El navegador bloqueó el audio automático (interacción requerida):", error);
                        });
                    }
                };

                // Intentar reproducir inmediatamente
                playAlarm();

                // Configurar el evento para repetir el sonido cuando termine
                alertSound.onended = () => {
                    if (playCount < 3) {
                        setTimeout(playAlarm, 500); // Esperar medio segundo entre repeticiones
                    }
                };

                // Lógica de cierre y detener sonido
                dismissBtn.onclick = async () => {
                    // Detener sonido si sigue sonando
                    alertSound.pause();
                    alertSound.currentTime = 0;
                    playCount = 99; // Evitar que siga el bucle

                    // Marcar como leída
                    await updateDoc(doc(db, "notifications", urgentAlert.id), { read: true });
                    overlay.classList.add('hidden');
                    overlay.classList.remove('flex');
                };
            }
        }
        // --- FIN CÓDIGO MEJORADO ---

        renderNotifications(personalNotifs, channelNotifs);
    }, (error) => console.error("Error en listener personal:", error));

    let unsubscribeChannel = () => { };
    if (currentUserRole === 'admin' || currentUserRole === 'bodega') {
        const channelQuery = query(collection(db, "notifications"), where("channel", "==", "admins_bodega"), where("read", "==", false));
        unsubscribeChannel = onSnapshot(channelQuery, (snapshot) => {
            console.log(`DEBUG: 'channelQuery' obtuvo ${snapshot.docs.length} docs.`);
            channelNotifs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderNotifications(personalNotifs, channelNotifs);
        }, (error) => console.error("Error en listener de canal:", error));
    }

    activeListeners.push(unsubscribePersonal, unsubscribeChannel);

    // --- 3. LISTENER DE CLICS (Con depuración) ---
    // Limpiamos listeners anteriores para evitar duplicados
    const newNotificationsList = notificationsList.cloneNode(true);
    if (notificationsList.parentNode) {
        notificationsList.parentNode.replaceChild(newNotificationsList, notificationsList);
    }

    newNotificationsList.addEventListener('click', async (e) => {
        const actionElement = e.target.closest('[data-action]');
        if (!actionElement) return;

        const action = actionElement.dataset.action;
        const notifId = actionElement.dataset.id;
        if (!notifId) return;

        // Acción: Descartar
        if (action === 'delete-notification') {
            await updateDoc(doc(db, "notifications", notifId), { read: true });
        }

        // Acción: Navegar
        if (action === 'navigate-notification') {
            const { projectId, taskId, itemId, subitemId, link } = actionElement.dataset;

            // --- INICIO DE DEPURACIÓN ---
            console.log("DEBUG: Clic en 'navigate-notification'");
            console.log("DEBUG: projectId:", projectId);
            console.log("DEBUG: taskId:", taskId);
            console.log("DEBUG: itemId:", itemId);
            console.log("DEBUG: subitemId:", subitemId);
            // --- FIN DE DEPURACIÓN ---

            document.getElementById('notifications-dropdown').classList.add('hidden');

            // Caso especial: Notificación de "Foto Rechazada"
            if (projectId && itemId && subitemId && !taskId) {
                console.log("DEBUG: ¡Condición 'Foto Rechazada' CUMPLIDA! Abriendo modal...");
                (async () => {
                    try {
                        loadingOverlay.classList.remove('hidden');
                        // 1. Cargar el proyecto (para el contexto)
                        const projectDoc = await getDoc(doc(db, "projects", projectId));
                        if (projectDoc.exists()) {
                            currentProject = { id: projectDoc.id, ...projectDoc.data() };
                        } else {
                            throw new Error("Proyecto no encontrado");
                        }

                        // 2. Cargar el ítem (para el contexto)
                        const itemDoc = await getDoc(doc(db, "projects", projectId, "items", itemId));
                        if (itemDoc.exists()) {
                            currentItem = { id: itemDoc.id, ...itemDoc.data() };
                        } else {
                            throw new Error("Ítem no encontrado");
                        }

                        // 3. Cargar el sub-ítem
                        const subItemRef = doc(db, "projects", projectId, "items", itemId, "subItems", subitemId);
                        const subItemSnap = await getDoc(subItemRef);

                        if (subItemSnap.exists()) {
                            // 4. ¡ABRIR LA VENTANA FLOTANTE!
                            openProgressModal(subItemSnap.data());
                        } else {
                            throw new Error("Sub-ítem no encontrado");
                        }
                    } catch (error) {
                        console.error("Error al navegar a sub-ítem desde notificación:", error);
                        alert(`No se pudo abrir el detalle del ítem: ${error.message}`);
                    } finally {
                        loadingOverlay.classList.add('hidden');
                    }
                })();
            }
            // Caso: Link de Catálogo
            else if (link === '/catalog') {
                console.log("DEBUG: Condición 'Catálogo' cumplida.");
                showView('catalog');
            }

            else if (link === '/herramienta') {
                console.log("DEBUG: Condición 'Herramienta' cumplida.");
                showView('herramienta');
                resetToolViewAndLoad();
            }
            // --- INICIO DE NUEVA MODIFICACIÓN ---
            else if (link === '/dotacion') {
                console.log("DEBUG: Condición 'Dotación' cumplida.");
                showView('dotacion');
                loadDotacionView(); // Carga la vista de dotación
            }

            // Caso: Tarea (comentario o asignación)
            else if (projectId && taskId) {
                console.log("DEBUG: Condición 'Tarea' cumplida.");
                showProjectDetails(null, projectId, taskId);
            }
            // Caso: Solo Proyecto
            else if (projectId) {
                console.log("DEBUG: Condición 'Proyecto' cumplida.");
                showProjectDetails(null, projectId);
            } else {
                console.warn("DEBUG: Clic en notificación, pero ninguna condición de navegación se cumplió.");
            }
        }
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
        'dashboard-general': document.getElementById('dashboard-general-view'), // <-- AÑADIR ESTA LÍNEA
        proyectos: document.getElementById('dashboard-view'),
        tareas: document.getElementById('tareas-view'),
        herramienta: document.getElementById('herramienta-view'),
        dotacion: document.getElementById('dotacion-view'),
        'cartera-view': document.getElementById('cartera-view'),
        solicitud: document.getElementById('solicitud-view'),
        empleados: document.getElementById('empleados-view'),
        'empleado-details': document.getElementById('empleado-details-view'), // <-- AÑADIDO
        'payment-history-view': document.getElementById('payment-history-view'), // <-- AÑADIDO
        'configuracion-view': document.getElementById('configuracion-view'), // <-- AÑADIDO
        proveedores: document.getElementById('proveedores-view'),
        supplierDetails: document.getElementById('supplier-details-view'),
        adminPanel: document.getElementById('admin-panel-view'),

        // --- INICIO DE LA CORRECCIÓN DEFINITIVA ---
        // La clave debe tener comillas y guion para coincidir con la llamada showView('project-details')
        'project-details': document.getElementById('project-details-view'),
        // --- FIN DE LA CORRECCIÓN DEFINITIVA ---

        subItems: document.getElementById('sub-items-view'),
        corteDetails: document.getElementById('corte-details-view'),
        catalog: document.getElementById('catalog-view'),
        compras: document.getElementById('compras-view'),
        reports: document.getElementById('reports-view'),
        'material-request-view': document.getElementById('material-request-view'),

    };

    // Inicializamos el nuevo módulo y le pasamos las dependencias globales
    initHerramientas(
        db,
        storage,
        openMainModal,
        closeMainModal,
        openConfirmModal,
        sendNotification,
        openImageModal,
        () => currentUser,
        () => usersMap,
        () => currentUserRole // <-- AÑADE ESTA LÍNEA
    );

    // Inicializamos el módulo de Dotación <-- AÑADE ESTE BLOQUE
    initDotacion(
        db,
        storage, // <-- AÑADE ESTA LÍNEA
        openMainModal,
        closeMainModal, // <-- AÑADE ESTA LÍNEA
        openConfirmModal,
        sendNotification, // <-- AÑADE ESTA LÍNEA
        openImageModal, // <-- AÑADE ESTA LÍNEA
        () => currentUser,
        () => usersMap,
        () => currentUserRole
    );

    // Inicializamos el módulo de Dashboard
    initDashboard(
        db,
        showView,
        () => usersMap, // Pasamos una "función getter" para el mapa
        () => currentUserRole, // Función getter para el rol
        () => currentUser ? currentUser.uid : null // Función getter para el ID
    );

    initEmpleados(
        db,
        () => usersMap,
        () => currentUserRole,
        showView,
        storage,
        openConfirmModal,
        (userId, containerId) => loadDotacionAsignaciones(userId, containerId),
        () => payrollConfig,
        () => currentUser ? currentUser.uid : null,
        setupCurrencyInput // <-- AÑADIR ESTA LÍNEA
    );

    initCartera(db, showView);

    initConfiguracion(
        db,
        setupCurrencyInput // Pasamos la función global de formato de moneda
    );

    initSolicitudes(
        db,
        showView,
        currentUserRole, // Variable global que ya existe en app.js
        usersMap,        // Mapa de usuarios global
        openMainModal    // Función global de modales
    );

    // --- INICIO DE NUEVO CÓDIGO ---
    // Cargar los modelos de IA para la validación de rostros
    loadFaceAPImodels();
    // --- FIN DE NUEVO CÓDIGO ---

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

const recalculateBtn = document.getElementById('recalculate-all-btn');
    if (recalculateBtn) { // <--- Verificamos si existe antes de usarlo
        recalculateBtn.addEventListener('click', async () => {
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
    }

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

        // --- INICIO DE NUEVO CÓDIGO ---
        // Manejador de clics para el Modal de Check-in
        const checkinModal = target.closest('#safety-checkin-modal');
        if (checkinModal) {

            // 1. DETECTAR EL BOTÓN CORRECTAMENTE (Corrección aquí)
            const scanBtn = target.closest('#checkin-take-photo-btn');

            // Botón: ESCANEAR ROSTRO
            if (scanBtn) {
                const faceStatus = document.getElementById('checkin-face-status');
                const videoEl = document.getElementById('checkin-video-feed');
                const canvasEl = document.getElementById('checkin-video-canvas');
                const scannerLine = document.getElementById('scanner-line');
                const confirmBtn = document.getElementById('checkin-confirm-btn');

                scanBtn.disabled = true;
                // Guardamos el contenido original por si falla
                const originalContent = scanBtn.innerHTML;
                scanBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Procesando...</span>';

                // Activar efecto láser
                if (scannerLine) {
                    scannerLine.classList.remove('hidden');
                    scannerLine.classList.add('animate-scan');
                }

                try {
                    if (!modelsLoaded) throw new Error("Cargando IA...");

                    // 1. Configurar Canvas
                    const videoWidth = videoEl.videoWidth;
                    const videoHeight = videoEl.videoHeight;
                    canvasEl.width = videoWidth;
                    canvasEl.height = videoHeight;
                    const ctx = canvasEl.getContext('2d');
                    ctx.translate(videoWidth, 0);
                    ctx.scale(-1, 1);
                    ctx.drawImage(videoEl, 0, 0, videoWidth, videoHeight);
                    ctx.setTransform(1, 0, 0, 1, 0, 0);

                    // 2. Pausar video para efecto de "captura"
                    videoEl.pause();

                    // 3. Detección Facial
                    faceStatus.textContent = 'Analizando biometría...';
                    const detection = await faceapi.detectSingleFace(canvasEl).withFaceLandmarks().withFaceDescriptor();

                    if (!detection) throw new Error("No se detectó rostro.");
                    if (detection.detection.score < 0.6) throw new Error("Imagen borrosa. Repetir.");

                    // 4. Comparación
                    if (!currentUserFaceDescriptor) {
                        faceStatus.textContent = "⚠️ Sin huella registrada. (Paso autorizado)";
                    } else {
                        const distance = faceapi.euclideanDistance(currentUserFaceDescriptor, detection.descriptor);
                        // Umbral de similitud (0.55)
                        if (distance > 0.55) throw new Error("Identidad no verificada.");
                    }

                    // --- ÉXITO ---
                    faceStatus.innerHTML = '<span class="flex items-center justify-center gap-2"><i class="fa-solid fa-circle-check"></i> Identidad Confirmada</span>';
                    faceStatus.className = "text-sm font-bold text-green-600";

                    // Detener animación
                    if (scannerLine) scannerLine.classList.add('hidden');

                    verifiedCanvas = canvasEl;

                    // Cambio de Botones: Ocultar "Escanear", Mostrar "Autorizar"
                    scanBtn.classList.add('hidden');
                    confirmBtn.classList.remove('hidden');
                    confirmBtn.disabled = false;

                } catch (err) {
                    // --- ERROR ---
                    console.error(err);
                    videoEl.play(); // Reanudar video
                    if (scannerLine) scannerLine.classList.add('hidden'); // Parar láser

                    faceStatus.textContent = err.message;
                    faceStatus.className = "text-sm font-bold text-red-500";

                    scanBtn.disabled = false;
                    scanBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> <span>Reintentar</span>';
                    verifiedCanvas = null;
                }
            }

            // Botón: Confirmar Check-in (AUTORIZAR AVANCE)
            if (target.id === 'checkin-confirm-btn') {
                const taskId = target.dataset.taskId; // Recuperamos el ID de la tarea

                // 1. Validación de Seguridad
                if (!verifiedCanvas) {
                    alert("Error de seguridad: No se ha verificado el rostro. Por favor, repite el escaneo.");
                    // Reseteamos la interfaz por seguridad
                    document.getElementById('checkin-take-photo-btn').classList.remove('hidden');
                    target.classList.add('hidden');
                    return;
                }

                target.disabled = true;
                const originalText = target.innerHTML;
                target.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Autorizando...';

                try {
                    // CASO A: Check-in de TAREA (Tiene taskId)
                    if (taskId) {
                        // 1. Convertir la foto verificada a archivo (Blob)
                        const selfieBlob = await new Promise(resolve => verifiedCanvas.toBlob(resolve, 'image/jpeg', 0.80));

                        // 2. Subir la evidencia a Storage (Ruta organizada)
                        const timestamp = Date.now();
                        const selfiePath = `checkin_evidence/${taskId}/${currentUser.uid}_${timestamp}.jpg`;
                        const selfieStorageRef = ref(storage, selfiePath);

                        await uploadBytes(selfieStorageRef, selfieBlob);
                        const downloadURL = await getDownloadURL(selfieStorageRef);

                        // 3. Registrar el evento en la bitácora de la tarea (Log inmutable)
                        await addDoc(collection(db, "tasks", taskId, "comments"), {
                            type: 'log', // Importante para que se vea gris y pequeño
                            text: `<b>Identidad Verificada.</b> El usuario autorizó un avance.`,
                            photoURL: downloadURL, // Evidencia biométrica
                            userId: currentUser.uid,
                            userName: `${usersMap.get(currentUser.uid)?.firstName || 'Usuario'} ${usersMap.get(currentUser.uid)?.lastName || ''}`,
                            createdAt: new Date() // Timestamp del servidor
                        });

                        console.log("Evidencia biométrica guardada correctamente.");
                    }

                    // CASO B: Check-in de PERFIL (Sin taskId, solo validación)
                    else {
                        console.log("Validación de perfil exitosa. Procediendo...");
                    }

                    // 4. CERRAR MODAL
                    // Detenemos la cámara para liberar memoria y luz
                    if (videoStream) videoStream.getTracks().forEach(track => track.stop());
                    document.getElementById('safety-checkin-modal').style.display = 'none';

                    // 5. EJECUTAR LA ACCIÓN FINAL (Callback)
                    // Esta es la función que realmente guarda el avance o el perfil
                    if (typeof onSafetyCheckInSuccess === 'function') {
                        onSafetyCheckInSuccess();
                    } else {
                        console.warn("No había acción posterior definida (callback).");
                    }

                } catch (err) {
                    console.error("Error crítico en autorización:", err);
                    alert("Error al autorizar: " + err.message);

                    // Restaurar botón
                    target.disabled = false;
                    target.innerHTML = originalText;
                }
            }

            // Botón: Cerrar Modal
            if (target.id === 'safety-checkin-close-btn') {
                if (videoStream) videoStream.getTracks().forEach(track => track.stop());
                document.getElementById('safety-checkin-modal').style.display = 'none';
            }
            return; // Detener el listener
        }
        // --- FIN DE NUEVO CÓDIGO ---

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

        // Si es una acción de herramienta, la ignora (herramientas.js se encarga)
        const toolActions = [
            'new-tool', 'edit-tool', 'delete-tool', 'assign-tool', 'return-tool', 'view-tool-history',
            'register-maintenance', // <-- AÑADIDO
            'decommission-tool'     // <-- AÑADIDO
        ];
        if (toolActions.includes(action)) {
            return;
        }

        const elementId = elementWithAction.dataset.id || elementWithAction.dataset.corteId || elementWithAction.dataset.poId;
        const projectIdForTask = elementWithAction.dataset.projectId; // Para "Ver Proyecto" desde tarea
        const taskIdForProgress = elementWithAction.dataset.taskId; // Específico para "Registrar Avance"

        console.log(`Action: ${action}, ElementID: ${elementId}, ProjectID(Task): ${projectIdForTask}, TaskID(Progress): ${taskIdForProgress}`);

// --- LÓGICA POR CONTEXTO ESPECÍFICO (Dentro de las tarjetas) ---
        const projectCard = elementWithAction.closest('.project-card');
        if (projectCard) {
            const projectId = projectCard.dataset.id;
            const projectName = projectCard.dataset.name;
            
            switch (action) {
                case 'view-details':
                    const docSnap = await getDoc(doc(db, "projects", projectId));
                    if (docSnap.exists()) showProjectDetails({ id: docSnap.id, ...docSnap.data() });
                    break;

                // --- AGREGAR ESTE CASO NUEVO ---
                case 'edit-project-info':
                    loadingOverlay.classList.remove('hidden');
                    try {
                        const pDoc = await getDoc(doc(db, "projects", projectId));
                        if (pDoc.exists()) {
                            // Abrimos el modal con los datos frescos del proyecto
                            openMainModal('editProjectInfo', { id: pDoc.id, ...pDoc.data() });
                        }
                    } catch (error) {
                        console.error("Error al cargar proyecto para editar:", error);
                    } finally {
                        loadingOverlay.classList.add('hidden');
                    }
                    break;
                // -------------------------------

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
            return; // Importante: Detiene la ejecución para que no busque en otros lados
        }

        // Este bloque maneja los clics en la tabla de Ítems (Ver, Editar, Eliminar)
        const itemRow = elementWithAction.closest('tr[data-id]');
        if (itemRow && itemRow.closest('#items-table-body')) {
            const itemId = itemRow.dataset.id;

            // Verificamos que el ID sea válido antes de continuar
            if (!itemId) {
                console.error("Error: Se hizo clic en un ítem pero su ID no se pudo encontrar.");
                return;
            }

            try {
                // Usamos el path de la subcolección que migramos
                const itemDoc = await getDoc(doc(db, "projects", currentProject.id, "items", itemId));

                if (itemDoc.exists()) {
                    const itemData = { id: itemDoc.id, ...itemDoc.data() };

                    // Manejamos la acción específica
                    switch (action) {
                        case 'view-item-details':
                            showSubItems(itemData); // Llama a la vista de sub-ítems
                            break;
                        case 'edit-item':
                            openMainModal('editItem', itemData); // Llama al modal de edición
                            break;
                        case 'delete-item':
                            openConfirmModal(`¿Eliminar "${itemData.name}"?`, () => deleteItem(itemId));
                            break;
                    }
                } else {
                    console.error(`Error: No se encontró el ítem con ID ${itemId} en el proyecto ${currentProject.id}`);
                    alert("Error: No se pudo encontrar el ítem seleccionado.");
                }
            } catch (error) {
                console.error("Error al procesar la acción del ítem:", error);
                alert("Ocurrió un error al obtener los datos del ítem.");
            }

            return; // Detenemos la ejecución aquí
        }

        // --- ACCIONES GENERALES Y DE MODALES (MANEJADAS POR UN SWITCH) ---
        switch (action) {


            case 'create-daily-report':
                openMainModal('create-daily-report');
                break;


            case 'send-admin-alert':
                openMainModal('send-admin-alert');
                break;

            case 'go-to-tareas':
                showView('tareas');
                loadTasksView();
                break;
            case 'go-to-dotacion':
                showView('dotacion');
                loadDotacionView();
                break;

            case 'view-empleado-details':
                const userId = elementWithAction.dataset.id;
                if (userId) {
                    showEmpleadoDetails(userId);
                }
                break;

            case 'back-to-empleados':
                loadEmpleadosView();
                showView('empleados');
                break;
            case 'view-payment-history':
                const empId = elementWithAction.dataset.id;
                if (empId) {
                    loadPaymentHistoryView(empId); // Llama a la nueva función de empleados.js
                }
                break;
            case 'back-to-empleados-from-payment':
                loadEmpleadosView(); // Recarga la vista de empleados (para que se actualice la pestaña)
                showView('empleados');
                break;

            case 'delete-payment': {
                const userId = elementWithAction.dataset.userId;
                const paymentId = elementWithAction.dataset.docId;

                openConfirmModal("¿Eliminar este registro de pago? Si tenía abonos a préstamos, estos NO se revertirán automáticamente (debes ajustar la deuda manualmente).", async () => {
                    try {
                        // 1. Obtener datos del pago antes de borrar para el log
                        const paymentRef = doc(_db, "users", userId, "paymentHistory", paymentId);
                        const paymentSnap = await getDoc(paymentRef);
                        const paymentData = paymentSnap.exists() ? paymentSnap.data() : null;

                        // 2. Borrar
                        await deleteDoc(paymentRef);

                        // 3. AUDITORÍA
                        if (paymentData) {
                            window.logAuditAction(
                                "Eliminar Pago",
                                `Se eliminó un pago por valor de ${currencyFormatter.format(paymentData.monto)} con concepto: ${paymentData.concepto}`,
                                userId,
                                paymentData, // Guardamos qué se borró
                                null
                            );
                        }

                        // 4. TOAST (Éxito)
                        window.showToast("El pago ha sido eliminado correctamente.", "success");

                    } catch (error) {
                        console.error("Error:", error);
                        // 5. TOAST (Error)
                        window.showToast("Error al eliminar el pago.", "error");
                    }
                });
                break;
            }

            case 'renew-dotacion': {
                const userId = elementWithAction.dataset.userId;
                const itemId = elementWithAction.dataset.itemId; // ID del ítem a renovar

                if (!userId || !itemId) return;

                loadingOverlay.classList.remove('hidden');

                try {
                    // 1. Obtener datos del ítem del catálogo para pre-llenar el modal
                    const itemDoc = await getDoc(doc(db, "dotacionCatalog", itemId));
                    if (!itemDoc.exists()) throw new Error("El ítem de dotación ya no existe en el catálogo.");

                    const itemData = { id: itemDoc.id, ...itemDoc.data() };

                    // 2. Abrir el modal de entrega existente, pero pre-configurado
                    openMainModal('register-dotacion-delivery', itemData);

                    // 3. (Truco de UX) Pre-seleccionar al usuario en el dropdown del modal
                    // Como el modal se construye asíncronamente, esperamos un poco
                    setTimeout(() => {
                        const userSelect = document.getElementById('dotacion-assignedTo');
                        if (userSelect && userSelect.choices) {
                            userSelect.choices.setChoiceByValue(userId);
                        }
                    }, 300); // Esperamos a que Choices.js inicialice

                } catch (error) {
                    console.error("Error al iniciar renovación:", error);
                    alert("No se pudo abrir la renovación: " + error.message);
                } finally {
                    loadingOverlay.classList.add('hidden');
                }
                break;
            }

            case 'open-loan-review':
                // El botón tiene los datos en JSON en data-loan
                const loanData = JSON.parse(elementWithAction.dataset.loan);
                // Cerramos el modal de lista primero (opcional, pero limpio)
                // closeMainModal(); 
                // Abrimos el de revisión pasando los datos
                openMainModal('review-loan', loanData);
                break;

            case 'approve-loan':
                const uidApprove = elementWithAction.dataset.uid;
                const loanIdApprove = elementWithAction.dataset.loanId;
                openConfirmModal("¿Aprobar este préstamo?", async () => {
                    try {
                        await updateDoc(doc(db, "users", uidApprove, "loans", loanIdApprove), {
                            status: 'active',
                            approvedAt: serverTimestamp(),
                            approvedBy: currentUser.uid
                        });
                        const card = elementWithAction.closest('div.bg-white');
                        if (card) card.remove();
                    } catch (e) { console.error(e); alert("Error al aprobar."); }
                });
                break;

            case 'reject-loan':
                const uidReject = elementWithAction.dataset.uid;
                const loanIdReject = elementWithAction.dataset.loanId;
                openConfirmModal("¿Rechazar esta solicitud?", async () => {
                    try {
                        await updateDoc(doc(db, "users", uidReject, "loans", loanIdReject), {
                            status: 'rejected',
                            rejectedAt: serverTimestamp(),
                            rejectedBy: currentUser.uid
                        });
                        const card = elementWithAction.closest('div.bg-white');
                        if (card) card.remove();
                    } catch (e) { console.error(e); alert("Error al rechazar."); }
                });
                break;

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
            case 'view-profile-history': {
                const userId = elementWithAction.dataset.userid;
                if (userId) {
                    loadProfileHistory(userId); // Llamamos a nuestra función modificada
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
                // Ahora, en lugar de un 'confirm', abrimos el nuevo modal de entrega
                openDeliveryModal(requestId);
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

                    // Ya no hay 'if'. Siempre llamamos al modal
                    // y le pasamos el ID de la tarea y el callback.
                    openSafetyCheckInModal(taskIdForProgress, () => {
                        closeTaskDetailsModal();
                        handleRegisterTaskProgress(taskIdForProgress);
                    });

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

            case 'back-to-project':
                // Primero, limpia el formulario
                resetMaterialRequestForm();

                console.log("Botón 'Volver' presionado, regresando a:", materialRequestReturnContext.view);

                // Lógica de Retorno
                if (materialRequestReturnContext.view === 'tareas' || materialRequestReturnContext.view === 'detalle-tarea') {
                    showView('tareas');
                    loadAndDisplayTasks('pendiente'); 
                } 
                else if (materialRequestReturnContext.view === 'proyectos' || !currentProject) {
                    showDashboard();
                }
                // --- NUEVO: Si venimos de Sub-ítems, volver a la pestaña de Ítems ---
                else if (materialRequestReturnContext.view === 'subItems') {
                    showProjectDetails(currentProject, 'items');
                }
                // --------------------------------------------------------------------
                else {
                    // Por defecto (ej: desde Solicitudes), volver a Materiales
                    showProjectDetails(currentProject, 'materiales');
                }
                break;

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
                // Leemos el projectId del botón, o usamos el global si no viene (para compatibilidad)
                const projId = elementWithAction.dataset.projectId || (currentProject ? currentProject.id : null);

                if (requestId && projId) {
                    openRequestDetailsModal(requestId, projId);
                } else {
                    console.error("Falta ID de solicitud o proyecto");
                }
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

                // AGREGAR ESTA LÍNEA:
                closePurchaseOrderModal();
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

                        // --- INICIO DE MODIFICACIÓN (Lógica de Recepción Unificada) ---
                        await runTransaction(db, async (transaction) => {

                            // --- FASE 1: TODAS LAS LECTURAS ---

                            // 1. Leer la Orden de Compra (PO)
                            const poDoc = await transaction.get(poRef);
                            if (!poDoc.exists()) throw new Error("La orden de compra no existe.");
                            const poData = poDoc.data();
                            if (poData.status !== "pendiente") throw new Error("Esta orden ya fue procesada.");
                            if (!Array.isArray(poData.items) || poData.items.length === 0) throw new Error("La orden no contiene ítems.");

                            // 2. Preparar las lecturas de los catálogos (Dotación y Herramientas)
                            const dotacionRefs = [];
                            const herramientaRefs = [];
                            const items = poData.items;

                            items.forEach(item => {
                                if (item.itemType === 'dotacion') {
                                    dotacionRefs.push(doc(db, "dotacionCatalog", item.materialId));
                                } else if (item.itemType === 'herramienta') {
                                    herramientaRefs.push(doc(db, "tools", item.materialId));
                                }
                            });

                            // 3. Ejecutar todas las lecturas restantes en paralelo
                            const [dotacionSnapshots, herramientaSnapshots] = await Promise.all([
                                Promise.all(dotacionRefs.map(ref => transaction.get(ref))),
                                Promise.all(herramientaRefs.map(ref => transaction.get(ref)))
                            ]);

                            // 4. Mapear los resultados para usarlos en la fase de escritura
                            const dotacionDataMap = new Map();
                            dotacionSnapshots.forEach(snap => {
                                if (snap.exists()) {
                                    dotacionDataMap.set(snap.id, snap.data());
                                }
                            });
                            const herramientaDataMap = new Map();
                            herramientaSnapshots.forEach(snap => {
                                if (snap.exists()) {
                                    herramientaDataMap.set(snap.id, snap.data());
                                }
                            });

                            // --- FASE 2: TODAS LAS ESCRITURAS ---
                            // (Ahora que todas las lecturas terminaron, podemos escribir)

                            for (const item of items) {
                                const itemType = item.itemType;
                                const materialId = item.materialId;
                                const quantity = item.quantity;
                                const unitCost = item.unitCost || 0;

                                switch (itemType) {
                                    case 'material': {
                                        const materialRef = doc(db, "materialCatalog", materialId);
                                        const batchRef = doc(collection(materialRef, "stockBatches"));
                                        transaction.set(batchRef, {
                                            purchaseDate: new Date(),
                                            quantityInitial: quantity,
                                            quantityRemaining: quantity,
                                            unitCost: unitCost,
                                            purchaseOrderId: elementId,
                                        });
                                        transaction.update(materialRef, { quantityInStock: increment(quantity) });
                                        break;
                                    }
                                    case 'dotacion': {
                                        const dotacionRef = doc(db, "dotacionCatalog", materialId);
                                        const historyRef = doc(collection(db, "dotacionHistory"));

                                        // Leemos el nombre del mapa (Fase 1) en lugar de transaction.get()
                                        const dotacionData = dotacionDataMap.get(materialId);
                                        const dotacionName = dotacionData ? dotacionData.itemName : 'Ítem de Dotación';

                                        transaction.update(dotacionRef, { quantityInStock: increment(quantity) });
                                        transaction.set(historyRef, {
                                            action: 'stock_added',
                                            itemId: materialId,
                                            itemName: dotacionName,
                                            quantity: quantity,
                                            adminId: currentUser.uid,
                                            timestamp: serverTimestamp(),
                                            purchaseCost: unitCost * quantity,
                                            notes: `Recibido de PO: ${poData.poNumber || elementId.substring(0, 6)}`
                                        });
                                        break;
                                    }
                                    case 'herramienta': {
                                        // Leemos los datos de la plantilla del mapa (Fase 1)
                                        const plantillaData = herramientaDataMap.get(materialId);
                                        if (!plantillaData) continue; // Si la plantilla no existe, no clonar

                                        for (let i = 0; i < quantity; i++) {
                                            const newToolRef = doc(collection(db, "tools"));
                                            transaction.set(newToolRef, {
                                                name: plantillaData.name,
                                                reference: plantillaData.reference || '',
                                                category: plantillaData.category || 'Varios',
                                                photoURL: plantillaData.photoURL || null,
                                                status: 'disponible',
                                                assignedToId: null,
                                                assignedToName: null,
                                                lastUsedBy: null,
                                                purchaseDate: new Date().toISOString().split('T')[0],
                                                purchaseCost: unitCost,
                                                createdAt: serverTimestamp(),
                                                createdBy: currentUser.uid,
                                                notes: `Comprado con PO: ${poData.poNumber || elementId.substring(0, 6)}`
                                            });
                                        }
                                        break;
                                    }
                                }
                            }

                            // Actualiza el estado de la orden (escritura final)
                            transaction.update(poRef, { status: "recibida", receivedAt: new Date(), receivedBy: currentUser.uid });
                        });
                        // --- Fin de runTransaction ---

                        alert("¡Mercancía recibida! El stock se ha actualizado.");
                        closePurchaseOrderModal();
                    } catch (error) {
                        // Esta es la línea 9558
                        console.error("Error al recibir la mercancía:", error);
                        alert("No se pudo guardar la orden de compra: " + error.message);
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

            case 'request-loan':
                openMainModal('request-loan');
                break;

            case 'view-my-loans':
                openMainModal('view-my-loans');
                break;

            case 'go-to-proyectos':
                // Redirecciona a la vista principal de proyectos
                showDashboard();
                break;

            case 'go-to-catalog':
                // Redirecciona al Catálogo de Materiales
                showView('catalog');
                loadCatalogView();
                break;

            case 'go-to-compras':
                showView('compras');
                if (typeof loadPurchaseOrders === 'function') loadPurchaseOrders();
                break;

            case 'go-to-tareas':
                showView('tareas');
                loadTasksView();
                break;

            case 'go-to-herramientas':
                showView('herramienta');
                if (typeof resetToolViewAndLoad === 'function') {
                    resetToolViewAndLoad();
                }
                break;

            case 'go-to-dotacion':
                showView('dotacion');
                loadDotacionView();
                break;

            case 'go-to-empleados':
                showView('empleados');
                // Cargar resumen de empleados si es necesario
                break;

            case 'view-pending-loans':
                openMainModal('view-pending-loans');
                break;

            case 'edit-supplier': {
                // Recuperamos el ID del botón
                const supId = elementWithAction.dataset.id;
                if (supId) {
                    loadingOverlay.classList.remove('hidden'); // Feedback visual
                    try {
                        const supplierDoc = await getDoc(doc(db, "suppliers", supId));
                        if (supplierDoc.exists()) {
                            // Abrimos el modal con los datos cargados
                            openMainModal('edit-supplier', { id: supplierDoc.id, ...supplierDoc.data() });
                        } else {
                            alert("No se encontró la información del proveedor.");
                        }
                    } catch (error) {
                        console.error("Error editando proveedor:", error);
                        alert("Error al cargar los datos.");
                    } finally {
                        loadingOverlay.classList.add('hidden');
                    }
                }
                break;
            }

            case 'delete-supplier-payment': {
                // Recuperamos el ID del pago
                const paymentId = elementWithAction.dataset.id;

                // Usamos la variable global currentSupplierId que se establece al entrar a la vista
                if (currentSupplierId && paymentId) {
                    openConfirmModal("¿Estás seguro de eliminar este pago del historial? Esta acción no se puede deshacer.", async () => {
                        try {
                            loadingOverlay.classList.remove('hidden');
                            await deleteDoc(doc(db, "suppliers", currentSupplierId, "payments", paymentId));
                            // No es necesario un alert de éxito, la tabla se actualiza sola en tiempo real
                        } catch (error) {
                            console.error("Error eliminando pago:", error);
                            alert("No se pudo eliminar el pago: " + error.message);
                        } finally {
                            loadingOverlay.classList.add('hidden');
                        }
                    });
                } else {
                    console.error("Falta ID de proveedor o pago");
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

            // --- INICIO DE CÓDIGO AÑADIDO ---
            case 'close-task-details':
                // Si el clic fue en el backdrop, verifica que el target sea el modal mismo
                if (elementWithAction.id === 'task-details-modal' && target.id !== 'task-details-modal') {
                    // No hagas nada si hicieron clic *dentro* del modal
                } else {
                    closeTaskDetailsModal();
                }
                break;
            // --- FIN DE CÓDIGO AÑADIDO ---
        }

        if (target.id === 'request-details-close-btn' || target.id === 'request-details-cancel-btn') {
            closeRequestDetailsModal();
        }
    });

    // Pestañas de Proyectos y Usuarios
    document.getElementById('active-projects-tab').addEventListener('click', () => loadProjects('active'));
    document.getElementById('archived-projects-tab').addEventListener('click', () => loadProjects('archived'));
    document.getElementById('active-users-tab').addEventListener('click', () => loadUsers('active'));
    document.getElementById('archived-users-tab').addEventListener('click', () => loadUsers('archived'));

    // Modales y otros elementos
// --- SECCIÓN CORREGIDA: Asignación Segura de Listeners ---
    
    // Función auxiliar para evitar errores si un ID no existe
    const addSafeListener = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener(event, handler);
        }
    };

    // Asignamos los eventos usando la función segura
    addSafeListener('modal-cancel-btn', 'click', closeMainModal);
    addSafeListener('modal-cancel-btn-footer', 'click', closeMainModal); // Ya no dará error si falta
    addSafeListener('progress-modal-cancel-btn', 'click', closeProgressModal);
    
    // Para el modal de importación
    const importCancelBtn = document.getElementById('import-modal-cancel-btn');
    if (importCancelBtn) {
        importCancelBtn.addEventListener('click', () => {
            const modal = document.getElementById('import-modal');
            if(modal) modal.style.display = 'none';
        });
    }

    addSafeListener('confirm-modal-cancel-btn', 'click', closeConfirmModal);
    addSafeListener('image-modal-close-btn', 'click', closeImageModal);

    // Para el modal de registro exitoso
    const registerSuccessBtn = document.getElementById('register-success-accept-btn');
    if (registerSuccessBtn) {
        registerSuccessBtn.addEventListener('click', () => {
            closeRegisterSuccessModal();
            handleLogout();
            const regForm = document.getElementById('register-form');
            if(regForm) regForm.reset();
            showAuthView('login');
        });
    }

    addSafeListener('document-viewer-close-btn', 'click', closeDocumentViewerModal);
    addSafeListener('documents-modal-close-btn', 'click', closeDocumentsModal);

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



    if (mainNav) {
        mainNav.addEventListener('click', (e) => {
            const link = e.target.closest('.nav-link');
            if (link) {
                e.preventDefault();
                const viewName = link.dataset.view; // <--- AQUÍ DEFINISTE viewName

                if (viewName === 'dashboard-general') {
                    showGeneralDashboard();

                } else if (viewName === 'proyectos') {
                    showDashboard();

                } else if (viewName === 'tareas') {
                    showView('tareas');
                    loadTasksView();

                } else if (viewName === 'herramienta') {
                    showView('herramienta');
                    resetToolViewAndLoad();

                } else if (viewName === 'dotacion') {
                    showView('dotacion');
                    loadDotacionView();

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
                } else if (viewName === 'solicitud') { // Coincide con data-view="solicitud" del HTML
                    loadSolicitudesView();

                } else if (viewName === 'empleados') {
                    loadEmpleadosView();
                    showView(viewName);

                } else if (viewName === 'configuracion') {
                    loadConfiguracionView();
                    showView('configuracion-view');

                    // --- CORRECCIÓN AQUÍ ---
                } else if (viewName === 'cartera') { // Usar viewName, no viewId
                    loadCarteraView();

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

        // Listener global para acciones del Dashboard (incluyendo el nuevo botón)
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;

            const action = btn.dataset.action;

            if (action === 'report-entry') {
                e.preventDefault();
                // Obtenemos el perfil completo del usuario para tener su foto
                const userProfile = usersMap.get(currentUser.uid);
                // Llamamos a la función importada
                handleReportEntry(db, storage, currentUser, userProfile, openMainModal, closeMainModal);
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
                    <input type="number" class="cut-length-input-view border p-2 rounded-md text-sm" placeholder="Medida (cm)">
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

                // El valor se lee en CM (ej: 700)
                const lengthInCm = parseFloat(cutItem.querySelector('.cut-length-input-view').value) || 0;
                // Se convierte a Metros (ej: 7.0)
                const lengthInMeters = lengthInCm / 100;
                const quantity = parseInt(cutItem.querySelector('.cut-quantity-input-view').value);

                const selectedMaterial = window.materialChoicesView.getValue();
                if (!selectedMaterial || !lengthInMeters || quantity <= 0) {
                    alert("Por favor, ingresa una medida y cantidad válidas.");
                    return;
                }

                // --- INICIO DE LA VALIDACIÓN AÑADIDA ---
                const defaultLengthInMeters = selectedMaterial.customProperties.defaultLength || 0; // En metros (ej: 6.0)

                // Verificamos si el material tiene una longitud estándar definida
                if (defaultLengthInMeters > 0) {
                    // Comparamos el corte (en metros) con la tira (en metros)
                    if (lengthInMeters > defaultLengthInMeters) {
                        const defaultLengthInCm = defaultLengthInMeters * 100; // ej: 600
                        alert(`Error: El corte (${lengthInCm} cm) no puede ser más largo que la tira estándar (${defaultLengthInCm} cm) para este material.`);
                        return; // Detenemos la ejecución
                    }
                }
                // --- FIN DE LA VALIDACIÓN AÑADIDA ---

                addMaterialToSummaryList({
                    materialId: selectedMaterial.value,
                    materialName: selectedMaterial.customProperties.name,
                    quantity: quantity,
                    length: lengthInMeters, // Guardamos en metros
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
                            const remnantLengthInCm = (remnant.length || 0) * 100;

                            // --- INICIO DE CORRECCIÓN ---
                            // Restauramos el formato "Retazo de..." usando cm
                            const remnantText = `Retazo de ${remnantLengthInCm} cm`;
                            // --- FIN DE CORRECCIÓN ---

                            // Aseguramos que data-remnant-length siga guardando metros
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
                case 'cut': text = `${newQuantity} corte(s) de ${item.length * 100} cm - ${item.materialName}`; break; // (Solo añadí un espacio)
                case 'remnant': text = `${newQuantity} retazo(s) ${item.materialName} ${item.remnantText}`; break;
            }
            existingItemDiv.querySelector('span').textContent = text;
        } else {
            switch (item.type) {
                case 'full_unit': text = `${item.quantity} x ${item.materialName}`; break;
                case 'cut': text = `${item.quantity} corte(s) de ${item.length * 100} cm - ${item.materialName}`; break; // (Solo añadí un espacio)
                case 'remnant': text = `${item.quantity} retazo(s) ${item.materialName} ${item.remnantText}`; break;
            }
            const itemDiv = document.createElement('div');
            itemDiv.className = 'request-summary-item flex justify-between items-center bg-gray-100 p-2 rounded-md text-sm';

            // --- INICIO DE CORRECCIÓN ---
            // Guardamos los datos explícitamente en el dataset
            itemDiv.dataset.materialId = item.materialId;
            itemDiv.dataset.materialName = item.materialName; // <-- ¡ESTA ES LA LÍNEA CLAVE!
            itemDiv.dataset.type = item.type;
            itemDiv.dataset.quantity = item.quantity;
            if (item.length) itemDiv.dataset.length = item.length;
            if (item.remnantId) itemDiv.dataset.remnantId = item.remnantId;
            if (item.remnantLength) itemDiv.dataset.remnantLength = item.remnantLength;
            if (item.remnantText) itemDiv.dataset.remnantText = item.remnantText;
            // --- FIN DE CORRECCIÓN ---

            itemDiv.innerHTML = `<span>${text}</span><button type="button" class="remove-request-item-btn-view text-red-500 font-bold text-lg leading-none">&times;</button>`;
            listDiv.appendChild(itemDiv);
        }
    }

    // --- INICIO DE LÓGICA PARA MODAL DE ENTREGA PARCIAL ---

    const deliveryModal = document.getElementById('delivery-modal');
    const deliveryModalForm = document.getElementById('delivery-modal-form');
    const deliveryModalTitle = document.getElementById('delivery-modal-title');
    const deliveryModalBody = document.getElementById('delivery-modal-body');

    /**
     * Cierra el modal de entrega parcial.
     */
    function closeDeliveryModal() {
        if (deliveryModal) deliveryModal.style.display = 'none';
        deliveryModalBody.innerHTML = '<p class="text-center text-gray-500">Cargando ítems...</p>';
        deliveryModalForm.reset();
    }

    // Listeners para cerrar el nuevo modal
    document.getElementById('delivery-modal-close-btn').addEventListener('click', closeDeliveryModal);
    document.getElementById('delivery-modal-cancel-btn').addEventListener('click', closeDeliveryModal);

    /**
     * Abre el modal de entrega parcial y calcula las cantidades pendientes.
     * @param {string} requestId - El ID de la solicitud a entregar.
     */
    async function openDeliveryModal(requestId) {
        deliveryModal.style.display = 'flex';
        deliveryModalForm.dataset.requestId = requestId;
        // Asignamos un título temporal mientras cargamos los datos
        deliveryModalTitle.textContent = `Registrar Entrega...`;

        try {
            const requestRef = doc(db, "projects", currentProject.id, "materialRequests", requestId);
            const requestSnap = await getDoc(requestRef);
            if (!requestSnap.exists()) throw new Error("No se encontró la solicitud.");

            const requestData = requestSnap.data();

            // --- INICIO DE LA MODIFICACIÓN ---
            // Verificamos si la solicitud tiene una Tarea (taskId) asociada
            if (requestData.taskId) {
                try {
                    // Si la tiene, buscamos la tarea para obtener su nombre
                    const taskSnap = await getDoc(doc(db, "tasks", requestData.taskId));
                    if (taskSnap.exists()) {
                        const taskDescription = taskSnap.data().description || "Tarea";
                        // Acortamos la descripción si es muy larga
                        const truncatedDesc = taskDescription.length > 40 ? taskDescription.substring(0, 40) + "..." : taskDescription;
                        deliveryModalTitle.textContent = `Solicitud Tarea: ${truncatedDesc}`;
                    } else {
                        // Si la tarea asociada no se encuentra, usamos el título de fallback
                        deliveryModalTitle.textContent = `Registrar Entrega (Solicitud #${requestId.substring(0, 6)}...)`;
                    }
                } catch (taskError) {
                    // Si hay un error al buscar la tarea, usamos el fallback
                    console.error("Error al buscar la tarea asociada:", taskError);
                    deliveryModalTitle.textContent = `Registrar Entrega (Solicitud #${requestId.substring(0, 6)}...)`;
                }
            } else {
                // Si la solicitud no tiene 'taskId', usamos el título de fallback
                deliveryModalTitle.textContent = `Registrar Entrega (Solicitud #${requestId.substring(0, 6)}...)`;
            }

            const itemsSolicitados = requestData.consumedItems || [];
            const itemsEntregadosHistorial = requestData.deliveryHistory || []; // Nuevo campo

            // 1. Calcular el total ya entregado para cada ítem
            const entregadoMap = new Map();
            itemsEntregadosHistorial.forEach(entrega => {
                entrega.items.forEach(item => {
                    const key = `${item.materialId}-${item.type}-${item.length || 0}`;
                    const currentQty = entregadoMap.get(key) || 0;
                    entregadoMap.set(key, currentQty + item.quantity);
                });
            });

            // 2. Calcular ítems pendientes y construir HTML
            let modalHtml = '<div class="space-y-3">';
            let itemsPendientes = false;

            for (const item of itemsSolicitados) {
                const key = `${item.materialId}-${item.type}-${item.length || 0}`;
                const totalEntregado = entregadoMap.get(key) || 0;
                const totalSolicitado = item.quantity;
                const pendiente = totalSolicitado - totalEntregado;

                if (pendiente > 0) {
                    itemsPendientes = true;
                    // Obtenemos el nombre del material (ya lo guardamos en 'consumedItems')
                    const materialName = item.itemName || `Material ID: ${item.materialId}`;
                    let description = '';
                    if (item.type === 'cut') description = `Corte de ${item.length}m`;
                    else if (item.type === 'remnant') description = `Retazo de ${item.length}m`;
                    else description = 'Unidad Completa';

                    modalHtml += `
                        <div class="bg-white p-3 border rounded-md delivery-item-row" 
                             data-material-id="${item.materialId}" 
                             data-type="${item.type}" 
                             data-length="${item.length || 0}">
                            <p class="font-semibold text-gray-800">${materialName}</p>
                            <p class="text-sm text-gray-600">${description}</p>
                            <div class="flex items-center justify-between mt-2">
                                <span class="text-sm font-medium">Pendiente: <strong class="text-red-600 text-base">${pendiente}</strong></span>
                                <div class="w-1/2">
                                    <label class="block text-xs font-medium text-gray-700">Entregar ahora:</label>
                                    <input type="number" class="delivery-quantity-input w-full border rounded-md p-2" 
                                           max="${pendiente}" min="0" placeholder="0">
                                </div>
                            </div>
                        </div>
                    `;
                }
            }

            if (!itemsPendientes) {
                modalHtml = '<p class="text-center text-green-600 font-semibold">¡Todos los ítems de esta solicitud ya han sido entregados!</p>';
                document.getElementById('delivery-modal-confirm-btn').disabled = true;
            } else {
                document.getElementById('delivery-modal-confirm-btn').disabled = false;
            }

            modalHtml += '</div>';
            deliveryModalBody.innerHTML = modalHtml;

        } catch (error) {
            console.error("Error al abrir el modal de entrega:", error);
            deliveryModalBody.innerHTML = `<p class="text-red-500">${error.message}</p>`;
        }
    }

    /**
     * Maneja el envío del formulario de entrega parcial.
     */
    async function handleDeliverySubmit(e) {
        e.preventDefault();
        const requestId = deliveryModalForm.dataset.requestId;
        const confirmBtn = document.getElementById('delivery-modal-confirm-btn');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Procesando...';
        loadingOverlay.classList.remove('hidden');

        try {
            const itemsToDeliver = [];
            document.querySelectorAll('#delivery-modal-body .delivery-item-row').forEach(row => {
                const quantity = parseInt(row.querySelector('.delivery-quantity-input').value) || 0;
                if (quantity > 0) {
                    itemsToDeliver.push({
                        materialId: row.dataset.materialId,
                        type: row.dataset.type,
                        length: parseFloat(row.dataset.length) || 0,
                        quantity: quantity
                    });
                }
            });

            if (itemsToDeliver.length === 0) {
                throw new Error("No se especificó ninguna cantidad para entregar.");
            }

            // Llamamos a la Cloud Function (que vamos a modificar)
            const deliverFunction = httpsCallable(functions, 'deliverMaterial');
            await deliverFunction({
                projectId: currentProject.id,
                requestId: requestId,
                itemsToDeliver: itemsToDeliver // El nuevo payload
            });

            alert("¡Entrega registrada con éxito! El stock ha sido actualizado.");
            closeDeliveryModal();

        } catch (error) {
            console.error("Error al registrar la entrega:", error);
            alert(`Error: ${error.message}`);
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirmar Entrega';
            loadingOverlay.classList.add('hidden');
        }
    }

    // Asignar el listener al formulario del nuevo modal
    deliveryModalForm.addEventListener('submit', handleDeliverySubmit);

    // --- FIN DE LÓGICA PARA MODAL DE ENTREGA PARCIAL ---


    // --- INICIO DE CORRECCIÓN: Manejador del historial (Botón "Atrás") ---
    // Escucha los eventos de "popstate" (clic en el botón "Atrás" del navegador/mouse)
    window.addEventListener('popstate', (event) => {
        // 'event.state' contiene el objeto { viewName: "..." } que guardamos
        if (event.state && event.state.viewName) {

            const { viewName, projectId } = event.state;

            if (viewName === 'project-details' && projectId) {
                // Si es una vista de proyecto, recargamos los datos
                // Pasamos 'null' como proyecto, el 'projectId' como ID, y 'true' para fromHistory
                showProjectDetails(null, projectId, null, true);

            } else if (viewName === 'proyectos') {
                // Si volvemos al dashboard, llamamos a showDashboard
                showDashboard();

            } else {
                // Para todas las demás vistas simples (Herramientas, Tareas, etc.)
                showView(viewName, true);
            }

        } else if (currentUser) {
            // Si no hay estado (página inicial) y estamos logueados, vamos al dashboard
            showDashboard();
        } else {
            // Si no, al login
            showAuthView('login');
        }
    });
    // --- FIN DE CORRECCIÓN ---

    // Lógica del Menú de Usuario (Dropdown)
    const userMenuBtn = document.getElementById('user-menu-btn');
    const userDropdown = document.getElementById('user-dropdown');
    const notificationsDropdown = document.getElementById('notifications-dropdown');

    if (userMenuBtn && userDropdown) {
        // Toggle al hacer clic
        userMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle('hidden');
            // Cerrar notificaciones si está abierto para evitar superposición
            if (notificationsDropdown) notificationsDropdown.classList.add('hidden');
        });

        // Cerrar al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (!userMenuBtn.contains(e.target) && !userDropdown.contains(e.target)) {
                userDropdown.classList.add('hidden');
            }
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

/**
 * Carga la pestaña de Materiales.
 * (MODIFICADO: Muestra la descripción de la tarea asociada)
 * @param {object} project - El objeto del proyecto actual.
 * @param {Array|null} taskItems - (Opcional) Array de ítems de una tarea, si se llama desde una.
 */
async function loadMaterialsTab(project, taskItems = null) {
    const canRequest = currentUserRole === 'admin' || currentUserRole === 'operario';
    const requestMaterialBtn = document.getElementById('request-material-btn');

    if (requestMaterialBtn) {
        requestMaterialBtn.classList.toggle('hidden', !canRequest);

        // Almacenamos los ítems de la tarea en el botón
        if (taskItems) {
            requestMaterialBtn.dataset.taskItems = JSON.stringify(taskItems);
        } else {
            requestMaterialBtn.dataset.taskItems = "";
        }
    }

    const requestsTableBody = document.getElementById('requests-table-body');
    if (!requestsTableBody) return;

    // --- LÓGICA DE FILTRADO OPERARIO ---
    let allowedTaskIds = new Set();
    if (currentUserRole === 'operario') {
        try {
            const q1 = query(collection(db, "tasks"), where("projectId", "==", project.id), where("assigneeId", "==", currentUser.uid));
            const q2 = query(collection(db, "tasks"), where("projectId", "==", project.id), where("additionalAssigneeIds", "array-contains", currentUser.uid));
            const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
            snap1.forEach(d => allowedTaskIds.add(d.id));
            snap2.forEach(d => allowedTaskIds.add(d.id));
        } catch (error) {
            console.error("Error cargando tareas:", error);
        }
    }
    // ------------------------------------

    if (unsubscribeMaterialRequests) unsubscribeMaterialRequests();

    const requestsQuery = query(collection(db, "projects", project.id, "materialRequests"), orderBy("createdAt", "desc"));

    unsubscribeMaterialRequests = onSnapshot(requestsQuery, async (snapshot) => {
        if (snapshot.empty) {
            requestsTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">No hay solicitudes de material.</td></tr>`;
            return;
        }

        const requestsPromises = snapshot.docs.map(async (requestDoc) => {
            const request = { id: requestDoc.id, ...requestDoc.data() };

            // Filtro de seguridad para operarios
            if (currentUserRole === 'operario') {
                const isMyRequest = request.requesterId === currentUser.uid;
                const isMyTask = request.taskId && allowedTaskIds.has(request.taskId);
                if (!isMyRequest && !isMyTask) return null;
            }

            // --- NUEVO: Cargar descripción de la tarea asociada ---
            if (request.taskId) {
                try {
                    // Consultamos la tarea para obtener su descripción
                    const taskSnap = await getDoc(doc(db, "tasks", request.taskId));
                    if (taskSnap.exists()) {
                        request.taskDescription = taskSnap.data().description;
                    }
                } catch (e) {
                    console.warn("No se pudo cargar la info de la tarea", e);
                }
            }
            // -----------------------------------------------------

            const consumedItems = request.consumedItems || [];
            if (consumedItems.length > 0 && consumedItems[0].materialId) {
                const firstItem = consumedItems[0];
                try {
                    const materialRef = doc(db, "materialCatalog", firstItem.materialId);
                    const materialDoc = await getDoc(materialRef);
                    const materialName = materialDoc.exists() ? materialDoc.data().name : 'Desconocido';
                    request.summary = `${firstItem.quantity} x ${materialName}`;
                    if (consumedItems.length > 1) {
                        request.summary += ` (y ${consumedItems.length - 1} más)`;
                    }
                } catch (e) {
                    request.summary = 'Error cargando ítem';
                }
            } else {
                request.summary = 'N/A';
            }
            return request;
        });

        const allRequests = await Promise.all(requestsPromises);
        const requestsWithData = allRequests.filter(r => r !== null);

        requestsTableBody.innerHTML = '';

        if (requestsWithData.length === 0) {
            requestsTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">No hay solicitudes visibles.</td></tr>`;
            return;
        }

        requestsWithData.forEach(request => {
            const solicitante = usersMap.get(request.requesterId)?.firstName || 'Desconocido';
            const responsable = usersMap.get(request.responsibleId)?.firstName || 'N/A';
            const baseButtonClasses = "text-sm font-semibold py-2 px-4 rounded-lg transition-colors w-40 text-center";
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
                        actionsHtml = `<button data-action="deliver-material" data-id="${request.id}" class="bg-teal-500 hover:bg-teal-600 text-white ${baseButtonClasses}">Registrar Entrega</button>`;
                    }
                    break;
                case 'entregado_parcial':
                    statusText = 'Entrega Parcial'; statusColor = 'bg-yellow-100 text-yellow-800';
                    if (currentUserRole === 'bodega' || currentUserRole === 'admin') {
                        actionsHtml = `<button data-action="deliver-material" data-id="${request.id}" class="bg-teal-500 hover:bg-teal-600 text-white ${baseButtonClasses}">Registrar Entrega</button>`;
                    }
                    if (currentUserRole === 'admin' || currentUserRole === 'operario') {
                        actionsHtml += `<button data-action="return-material" data-id="${request.id}" class="bg-yellow-500 hover:bg-yellow-600 text-white ${baseButtonClasses} mt-1">Devolver</button>`;
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

            // --- NUEVO: HTML para mostrar la Tarea ---
            const taskHtml = request.taskDescription
                ? `<div class="mt-2 flex items-start text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded border border-indigo-100">
                     <i class="fa-solid fa-thumbtack mt-0.5 mr-1.5 flex-shrink-0"></i>
                     <span class="font-medium truncate max-w-[200px]" title="${request.taskDescription}">${request.taskDescription}</span>
                   </div>`
                : '';
            // -----------------------------------------

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="px-6 py-4">${request.createdAt.toDate().toLocaleDateString('es-CO')}</td>
                <td class="px-6 py-4">${solicitante}</td>
                <td class="px-6 py-4">
                    <div>
                        <span class="block text-gray-800">${request.summary}</span>
                        ${taskHtml}
                    </div>
                </td>
                <td class="px-6 py-4 text-center"><span class="px-2 py-1 text-xs font-semibold rounded-full ${statusColor}">${statusText}</span></td>
                <td class="px-6 py-4">${responsable}</td>
                <td class="px-6 py-4 text-center">
                    <div class="flex justify-center items-center gap-2 flex-wrap">
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
 * (MODIFICADO: Ahora muestra la descripción de la tarea asociada si existe)
 * @param {string} requestId - El ID de la solicitud a mostrar.
 */
async function openRequestDetailsModal(requestId, projectId) {
    const modal = document.getElementById('request-details-modal');
    const modalBody = document.getElementById('request-details-content');

    const modalContainer = modal.querySelector('.w-11\\/12');
    if (modalContainer) {
        modalContainer.classList.remove('md:max-w-2xl');
        modalContainer.classList.add('md:max-w-4xl');
    }

    if (!modal || !modalBody || !projectId) return;

    modalBody.innerHTML = '<div class="flex justify-center items-center h-64"><div class="loader"></div></div>';
    modal.style.display = 'flex';

    const defaultTitle = document.getElementById('request-details-title');
    if (defaultTitle) defaultTitle.parentElement.style.display = 'none';

    try {
        const [requestSnap, itemsSnap] = await Promise.all([
            getDoc(doc(db, "projects", projectId, "materialRequests", requestId)),
            getDocs(collection(db, "projects", projectId, "items"))
        ]);

        if (!requestSnap.exists()) {
            modalBody.innerHTML = '<div class="p-8 text-center text-red-500"><i class="fa-solid fa-triangle-exclamation text-3xl mb-2"></i><p>No se encontró la solicitud.</p></div>';
            return;
        }

        const projectItemsMap = new Map(itemsSnap.docs.map(doc => [doc.id, doc.data()]));
        const requestData = requestSnap.data();
        const consumedItems = requestData.consumedItems || [];

        // --- NUEVO: Cargar Información de la Tarea Asociada ---
        let taskDescriptionHtml = '';
        if (requestData.taskId) {
            try {
                const taskSnap = await getDoc(doc(db, "tasks", requestData.taskId));
                if (taskSnap.exists()) {
                    const taskDesc = taskSnap.data().description || "Sin descripción";
                    // Creamos un bloque visual destacado para la tarea
                    taskDescriptionHtml = `
                        <div class="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-6 flex items-start gap-4 shadow-sm">
                            <div class="flex-shrink-0 w-10 h-10 rounded-full bg-white flex items-center justify-center text-indigo-600 shadow-sm border border-indigo-50">
                                <i class="fa-solid fa-thumbtack"></i>
                            </div>
                            <div>
                                <h5 class="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-1">Tarea Asociada (Contexto)</h5>
                                <p class="text-sm font-bold text-indigo-900 leading-relaxed">"${taskDesc}"</p>
                            </div>
                        </div>
                    `;
                }
            } catch (e) {
                console.warn("No se pudo cargar la info de la tarea:", e);
            }
        }
        // -----------------------------------------------------

        // 1. Preparar Tabla de Materiales
        const consumedItemsPromises = consumedItems.map(async (item, index) => {
            let materialName = 'Material Desconocido';
            let icon = 'fa-box';

            try {
                const materialDoc = await getDoc(doc(db, "materialCatalog", item.materialId));
                if (materialDoc.exists()) materialName = materialDoc.data().name;
            } catch (e) { console.warn("No es material de catálogo", e); }

            let description = '<span class="text-gray-400 italic">Estándar</span>';

            switch (item.type) {
                case 'full_unit':
                    description = '<span class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-semibold">Unidad Completa</span>';
                    icon = 'fa-cube';
                    break;
                case 'cut':
                    description = `<span class="bg-purple-50 text-purple-700 px-2 py-0.5 rounded text-xs font-semibold"><i class="fa-solid fa-scissors mr-1"></i> Corte: ${(item.length * 100).toFixed(0)} cm</span>`;
                    icon = 'fa-scissors';
                    break;
                case 'remnant':
                    description = `<span class="bg-orange-50 text-orange-700 px-2 py-0.5 rounded text-xs font-semibold"><i class="fa-solid fa-recycle mr-1"></i> Retazo: ${(item.length * 100).toFixed(0)} cm</span>`;
                    icon = 'fa-recycle';
                    break;
            }
            return `
                <tr class="hover:bg-gray-50 transition-colors border-b last:border-0">
                    <td class="py-3 px-4 text-center text-gray-400 font-mono text-xs">${index + 1}</td>
                    <td class="py-3 px-4">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
                                <i class="fa-solid ${icon} text-xs"></i>
                            </div>
                            <span class="font-medium text-gray-700">${materialName}</span>
                        </div>
                    </td>
                    <td class="py-3 px-4">${description}</td>
                    <td class="py-3 px-4 text-center font-bold text-gray-800 bg-gray-50/50">${item.quantity}</td>
                </tr>
            `;
        });

        const consumedItemsHtml = (await Promise.all(consumedItemsPromises)).join('');

        // 2. Datos Generales
        const requester = usersMap.get(requestData.requesterId);
        const responsible = requestData.responsibleId ? usersMap.get(requestData.responsibleId) : null;

        const formatDate = (timestamp) => {
            if (!timestamp) return null;
            return timestamp.toDate().toLocaleString('es-CO', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
        };

        const dateRequested = formatDate(requestData.createdAt);
        const dateApproved = formatDate(requestData.approvedAt);
        const dateDelivered = formatDate(requestData.deliveredAt);

        const statusConfig = {
            'pendiente': { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: 'fa-clock', label: 'Pendiente' },
            'aprobado': { bg: 'bg-blue-100', text: 'text-blue-800', icon: 'fa-thumbs-up', label: 'Aprobado' },
            'entregado': { bg: 'bg-green-100', text: 'text-green-800', icon: 'fa-check-circle', label: 'Entregado' },
            'entregado_parcial': { bg: 'bg-orange-100', text: 'text-orange-800', icon: 'fa-boxes-packing', label: 'Parcial' },
            'rechazado': { bg: 'bg-red-100', text: 'text-red-800', icon: 'fa-ban', label: 'Rechazado' },
        };
        const st = statusConfig[requestData.status] || statusConfig['pendiente'];

        // Uso Previsto
        const destinationItemsHtmlFinal = (requestData.itemsToConsume && requestData.itemsToConsume.length > 0)
            ? requestData.itemsToConsume.map(item => {
                const projectItem = projectItemsMap.get(item.itemId);
                return `
                    <div class="flex justify-between items-center p-2 bg-gray-50 rounded-md border border-gray-100 mb-2">
                        <span class="text-sm text-gray-700 font-medium flex items-center">
                            <i class="fa-solid fa-screwdriver-wrench text-gray-400 mr-2"></i>
                            ${projectItem ? projectItem.name : 'Ítem Desconocido'}
                        </span>
                        <span class="text-xs font-bold bg-white px-2 py-1 rounded border text-gray-600">x${item.quantityConsumed}</span>
                    </div>`;
            }).join('')
            : '<div class="text-center py-4 text-gray-400 italic text-sm">No se especificó uso en ítems del proyecto.</div>';

        modalBody.innerHTML = `
            <div class="-mx-6 -mt-6 mb-6 bg-gradient-to-r from-slate-800 to-slate-900 p-6 text-white rounded-t-lg shadow-md relative overflow-hidden">
                <div class="absolute top-0 right-0 opacity-10 transform translate-x-4 -translate-y-2">
                    <i class="fa-solid fa-dolly text-9xl"></i>
                </div>
                <div class="relative z-10 flex justify-between items-start">
                    <div>
                        <div class="flex items-center gap-2 mb-1 opacity-80">
                            <span class="text-xs font-mono bg-white/20 px-2 py-0.5 rounded">ID: ${requestId.substring(0, 6).toUpperCase()}</span>
                        </div>
                        <h3 class="text-2xl font-bold">Solicitud de Material</h3>
                    </div>
                    <span class="${st.bg} ${st.text} px-3 py-1.5 rounded-lg text-xs font-bold flex items-center shadow-sm">
                        <i class="fa-solid ${st.icon} mr-1.5"></i> ${st.label.toUpperCase()}
                    </span>
                </div>
                <button onclick="document.getElementById('request-details-close-btn').click()" 
                    class="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors backdrop-blur-md border border-white/10 z-20">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            ${taskDescriptionHtml}

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                <div class="lg:col-span-2 space-y-6">
                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div class="px-4 py-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                            <h4 class="font-bold text-gray-700 text-sm uppercase tracking-wide flex items-center">
                                <i class="fa-solid fa-boxes-stacked mr-2 text-blue-500"></i> Materiales Requeridos
                            </h4>
                            <span class="text-xs font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">${consumedItems.length} ítems</span>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-sm text-left">
                                <thead>
                                    <tr class="text-xs text-gray-500 border-b border-gray-100 bg-white">
                                        <th class="py-2 px-4 text-center w-10">#</th>
                                        <th class="py-2 px-4 font-medium">Material</th>
                                        <th class="py-2 px-4 font-medium">Tipo / Detalle</th>
                                        <th class="py-2 px-4 text-center font-medium">Cant.</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-gray-50">
                                    ${consumedItemsHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                        <h4 class="font-bold text-gray-700 text-sm uppercase tracking-wide mb-3 flex items-center">
                            <i class="fa-solid fa-helmet-safety mr-2 text-orange-500"></i> Uso en Obra (Destino)
                        </h4>
                        <div class="max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                            ${destinationItemsHtmlFinal}
                        </div>
                    </div>
                </div>

                <div class="space-y-4">
                    
                    <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                        <h5 class="text-xs font-bold text-gray-400 uppercase mb-4 tracking-wide">Cronología del Proceso</h5>
                        <div class="relative pl-2 space-y-6 border-l-2 border-gray-100 ml-2">
                            
                            <div class="relative">
                                <div class="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-sm"></div>
                                <div class="pl-4">
                                    <p class="text-xs text-gray-500">Solicitado</p>
                                    <p class="text-sm font-bold text-gray-800">${dateRequested || '---'}</p>
                                </div>
                            </div>

                            <div class="relative">
                                <div class="absolute -left-[9px] top-1 w-4 h-4 rounded-full ${dateApproved ? 'bg-blue-500' : 'bg-gray-200'} border-2 border-white shadow-sm"></div>
                                <div class="pl-4">
                                    <p class="text-xs text-gray-500">Aprobado</p>
                                    <p class="text-sm font-bold ${dateApproved ? 'text-gray-800' : 'text-gray-300 italic'}">${dateApproved || 'Pendiente'}</p>
                                </div>
                            </div>

                            <div class="relative">
                                <div class="absolute -left-[9px] top-1 w-4 h-4 rounded-full ${dateDelivered ? 'bg-green-500' : 'bg-gray-200'} border-2 border-white shadow-sm"></div>
                                <div class="pl-4">
                                    <p class="text-xs text-gray-500">Entregado</p>
                                    <p class="text-sm font-bold ${dateDelivered ? 'text-green-600' : 'text-gray-300 italic'}">${dateDelivered || 'Pendiente'}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <h5 class="text-xs font-bold text-gray-400 uppercase mb-3">Solicitado por</h5>
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-600 flex items-center justify-center font-bold text-sm border border-blue-50">
                                ${requester ? requester.firstName.charAt(0) : '?'}
                            </div>
                            <div>
                                <p class="text-sm font-bold text-gray-800 leading-tight">
                                    ${requester ? requester.firstName + ' ' + requester.lastName : 'Usuario Desconocido'}
                                </p>
                                <p class="text-xs text-gray-500">Operario</p>
                            </div>
                        </div>
                    </div>

                    <div class="bg-gray-50 p-4 rounded-xl border border-gray-200">
                        <h5 class="text-xs font-bold text-gray-400 uppercase mb-3">Gestionado por</h5>
                         <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400 text-xs">
                                <i class="fa-solid fa-user-gear"></i>
                            </div>
                            <p class="text-sm font-medium text-gray-600">
                                ${responsible ? responsible.firstName + ' ' + responsible.lastName : 'Pendiente de asignación'}
                            </p>
                        </div>
                    </div>
                    
                </div>
            </div>
        `;

    } catch (error) {
        console.error("Error al abrir los detalles de la solicitud:", error);
        modalBody.innerHTML = `<div class="p-8 text-center text-red-500"><p>Error crítico: ${error.message}</p></div>`;
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
            const inventorySnapshot = await getDocs(query(collection(db, "materialCatalog"), orderBy("name")));
            const inventory = inventorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // --- ¡ESTA ES LA CORRECCIÓN NECESARIA PARA ESE ERROR! ---
            // Filtra materiales corruptos (null o sin 'name') del catálogo
            const materialOptions = inventory
                .filter(mat => mat && mat.name)
                .map(mat => ({
                    value: mat.id,
                    label: `${mat.name} (Stock: ${mat.quantityInStock || 0})`, // Esta era la línea 8683
                    customProperties: { isDivisible: mat.isDivisible, name: mat.name, defaultLength: (mat.defaultSize?.length || 0) }
                }));
            // --- FIN DE LA CORRECCIÓN ---

            // (El resto de la función continúa)
            selectContainer.innerHTML = '<select id="material-choices-select-view"></select>';
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
                                const remnantLengthInCm = (remnant.length || 0) * 100;

                                // --- INICIO DE CORRECCIÓN ---
                                // Restauramos el formato "Retazo de..." usando cm
                                const remnantText = `Retazo de ${remnantLengthInCm} cm`;
                                // --- FIN DE CORRECCIÓN ---

                                // Aseguramos que data-remnant-length siga guardando metros
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

                // --- INICIO DE CORRECCIÓN ---
                // El array 'taskItems' viene de la Tarea, que usa 'itemId'.
                const itemIds = taskItems.map(item => item.itemId); // <-- CORREGIDO
                // --- FIN DE CORRECCIÓN ---

                if (itemIds.length > 0) {
                    // Usamos documentId() que es la forma correcta de consultar por ID
                    const itemsQuery = query(collection(db, "projects", currentProject.id, "items"), where(documentId(), "in", itemIds)); const itemsSnapshot = await getDocs(itemsQuery);
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
                const itemsSnapshot = await getDocs(query(collection(db, "projects", currentProject.id, "items"), orderBy("name")));
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

            // --- INICIO DE CORRECCIÓN ---
            // Leemos el 'materialName' limpio que guardamos en el dataset
            const materialName = node.dataset.materialName || "Material Desconocido";

            const data = {
                materialId: node.dataset.materialId,
                type: node.dataset.type,
                quantity: parseInt(node.dataset.quantity),
                itemName: materialName // <-- Usamos el nombre limpio
            };

            if (node.dataset.type === 'cut') {
                data.length = parseFloat(node.dataset.length);
            } else if (node.dataset.type === 'remnant') {
                // Aseguramos que 'length' se guarde (usa 'remnantLength' como fallback)
                data.length = parseFloat(node.dataset.length || node.dataset.remnantLength || 0);
                // --- FIN DE CORRECCIÓN ---
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
        } 
        // NUEVO: Si venimos del Dashboard o no hay proyecto, volver al inicio
        else if (materialRequestReturnContext.view === 'proyectos' || !currentProject) {
            showDashboard();
        }
        else {
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
 * (MODIFICADA: Se elimina la lógica de 'blockButtons' del check-in diario)
 */
function loadTasksView() {
    const newTaskBtn = document.getElementById('new-task-btn');
    const adminToggleContainer = document.getElementById('admin-task-toggle-container');


    const role = currentUserRole; // Usamos la variable global


    if (newTaskBtn && adminToggleContainer) {
        const isAdmin = (role === 'admin');
        newTaskBtn.classList.toggle('hidden', !isAdmin);
        adminToggleContainer.classList.toggle('hidden', !isAdmin);
    }

    const adminToggleCheckbox = document.getElementById('admin-task-toggle-checkbox');
    if (adminToggleCheckbox && !adminToggleCheckbox.dataset.listenerAttached) {
        adminToggleCheckbox.dataset.listenerAttached = 'true';
        adminToggleCheckbox.addEventListener('change', () => {
            const currentActiveTab = document.querySelector('#tareas-view .task-tab-button.active');
            const currentFilter = currentActiveTab ? currentActiveTab.dataset.statusFilter : 'pendiente';
            const titleElement = document.querySelector('#tareas-view h1');
            if (titleElement) {
                titleElement.textContent = adminToggleCheckbox.checked ? 'Todas las Tareas' : 'Mis Tareas Asignadas';
            }
            loadAndDisplayTasks(currentFilter); // <-- 'blockButtons' eliminado
        });
    }

    const tabsContainer = document.querySelector('#tareas-view .mb-4.border-b nav');
    if (!tabsContainer) {
        console.error('ERROR CRÍTICO: No se encontró el contenedor de pestañas (nav).');
        return;
    }

    if (!tabsContainer.dataset.listenerAttached) {
        tabsContainer.addEventListener('click', (e) => {
            const clickedButton = e.target.closest('.task-tab-button');
            if (!clickedButton) return;
            const statusFilter = clickedButton.dataset.statusFilter;
            const isActive = clickedButton.classList.contains('active');
            if (!isActive) {
                tabsContainer.querySelectorAll('.task-tab-button').forEach(btn => btn.classList.remove('active'));
                clickedButton.classList.add('active');
                loadAndDisplayTasks(statusFilter); // <-- 'blockButtons' eliminado
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

    loadAndDisplayTasks(initialFilter); // <-- 'blockButtons' eliminado
}

/**
 * Carga las tareas desde Firestore y las muestra en la interfaz.
 * (MODIFICADA: Se elimina 'blockButtons')
 * @param {string} statusFilter - 'pendiente' o 'completada'.
 */
function loadAndDisplayTasks(statusFilter = 'pendiente') { // <-- 'blockButtons' eliminado
    materialRequestReturnContext = { view: 'tareas' };
    console.log("Contexto de retorno establecido en: tareas");

    const tasksContainer = document.getElementById('tasks-container');
    let loadingDiv = document.getElementById('loading-tasks');

    // --- Manejo del Loader ---
    if (tasksContainer && !loadingDiv) {
        loadingDiv = document.createElement('div');
        loadingDiv.id = 'loading-tasks';
        loadingDiv.className = 'text-center py-10';
        loadingDiv.innerHTML = '<p class="text-gray-500">Cargando tareas...</p>';
        tasksContainer.appendChild(loadingDiv);
    }
    if (!tasksContainer || !loadingDiv || !currentUser) {
        console.error(`[Tareas] Error al iniciar loadAndDisplayTasks('${statusFilter}'): Faltan elementos esenciales.`);
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

    // --- Lógica de Consulta ---
    let tasksMap = new Map();
    let combinedTasksRendered = false;

    // --- Función de Renderizado (Modificada) ---
    const renderCombinedTasks = (tasksMap) => {
        // Ocultar loader la primera vez que se renderiza
        if (!combinedTasksRendered) {
            const currentLoadingDiv = document.getElementById('loading-tasks');
            if (currentLoadingDiv) currentLoadingDiv.classList.add('hidden');
            combinedTasksRendered = true;
        }

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

        if (tasksMap.size === 0) {
            // Si no hay tareas, mostrar mensaje y limpiar tarjetas viejas
            existingCardElements.forEach(card => card.remove()); // Eliminar las marcadas
            const noTasksMessage = document.createElement('p');
            noTasksMessage.className = 'text-gray-500 text-center py-6 no-tasks-message';
            noTasksMessage.textContent = `No se encontraron tareas ${statusFilter === 'pendiente' ? 'pendientes' : 'completadas'}.`;
            currentTasksContainer.appendChild(noTasksMessage);
            return;
        }

        // 2. Convertir Map a Array y ordenar
        const sortedTasks = Array.from(tasksMap.values()).sort((a, b) => {
            const dateA = a.dueDate ? new Date(a.dueDate) : new Date(8640000000000000);
            const dateB = b.dueDate ? new Date(b.dueDate) : new Date(8640000000000000);
            return dateA - dateB;
        });

        // 3. Iterar sobre las tareas ordenadas
        let previousCard = null; // Para insertar en el orden correcto
        sortedTasks.forEach((taskData) => {


            // Pasamos 'blockButtons' al crear la tarjeta
            const taskCard = createTaskCard(taskData); // <-- 'blockButtons' eliminado
            //             

            const existingCard = currentTasksContainer.querySelector(`.task-card[data-id="${taskData.id}"]`);

            if (existingCard) {
                // Si la tarjeta ya existe, la reemplazamos en lugar de saltarla
                existingCard.replaceWith(taskCard);
                previousCard = taskCard; // La nueva tarjeta es la referencia
            } else {
                // Si la tarjeta es nueva, la insertamos
                if (previousCard) {
                    previousCard.insertAdjacentElement('afterend', taskCard);
                } else {
                    currentTasksContainer.insertBefore(taskCard, currentTasksContainer.firstChild);
                } previousCard = taskCard; // Actualizamos la referencia 
            }

            // --- INICIO DE CORRECCIÓN (Llamada a loadTaskMaterialStatus) ---
            // Llamamos a la función que carga el estado del material (en modo 'summary')
            if (taskData.specificSubItemIds && taskData.specificSubItemIds.length > 0) {
                const placeholderId = `material-status-${taskData.id}`;
                loadTaskMaterialStatus(taskData.id, taskData.projectId, placeholderId, 'summary');
            }
            // --- FIN DE CORRECCIÓN ---
        });

        // 4. Eliminar las tarjetas que quedaron marcadas para remover
        currentTasksContainer.querySelectorAll('.task-card[data-marked-for-removal="true"]').forEach(card => {
            const materialStatusDiv = card.querySelector(`[id^="material-status-${card.dataset.id}"]`);
            if (materialStatusDiv && materialStatusListeners.has(materialStatusDiv.id)) {
                materialStatusListeners.get(materialStatusDiv.id)();
                materialStatusListeners.delete(materialStatusDiv.id);
            }
            card.remove();
        });
    };

    // --- Lógica de Consulta (Modificada para Admin View) ---
    const adminToggleCheckbox = document.getElementById('admin-task-toggle-checkbox');
    const isAdminView = adminToggleCheckbox?.checked && currentUserRole === 'admin';

    if (isAdminView) {
        // MODO ADMIN: Ver todas las tareas
        console.log(`[Tareas] Cargando en MODO ADMIN. Filtro: ${statusFilter}`);
        const allTasksQuery = query(
            collection(db, "tasks"),
            where("status", "==", statusFilter)
        );

        unsubscribeTasks = onSnapshot(allTasksQuery, (querySnapshot) => {
            let changed = false;
            tasksMap.clear(); // Limpiamos el mapa en cada actualización completa
            querySnapshot.forEach((doc) => {
                tasksMap.set(doc.id, { id: doc.id, ...doc.data() });
                changed = true;
            });

            if (changed || !combinedTasksRendered) {
                renderCombinedTasks(tasksMap);
            }
        }, (error) => {
            console.error(`Error en listener de Tareas (Admin View, ${statusFilter}): `, error);
            renderCombinedTasks(tasksMap);
        });

    } else {
        // MODO USUARIO: Ver solo "Mis Tareas"
        console.log(`[Tareas] Cargando en MODO USUARIO. Filtro: ${statusFilter}`);
        let principalTasks = new Map();
        let additionalTasks = new Map();

        // Función interna para este modo
        const renderUserTasks = (principalMap, additionalMap) => {
            const combinedMap = new Map([...principalMap, ...additionalMap]);
            renderCombinedTasks(combinedMap); // Llamamos al renderizador principal
        };

        const unsubscribePrincipal = onSnapshot(query(
            collection(db, "tasks"),
            where("assigneeId", "==", currentUser.uid),
            where("status", "==", statusFilter)
        ), (querySnapshot) => {
            let changed = false;
            querySnapshot.docChanges().forEach((change) => {
                changed = true;
                if (change.type === "removed") principalTasks.delete(change.doc.id);
                else principalTasks.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
            });
            if (changed || !combinedTasksRendered) renderUserTasks(principalTasks, additionalTasks);
        }, (error) => {
            console.error(`Error en listener de tareas principales (${statusFilter}): `, error);
            renderUserTasks(principalTasks, additionalTasks);
        });

        const unsubscribeAdditional = onSnapshot(query(
            collection(db, "tasks"),
            where("additionalAssigneeIds", "array-contains", currentUser.uid),
            where("status", "==", statusFilter)
        ), (querySnapshot) => {
            let changed = false;
            querySnapshot.docChanges().forEach((change) => {
                changed = true;
                if (change.type === "removed") additionalTasks.delete(change.doc.id);
                else additionalTasks.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
            });
            if (changed || !combinedTasksRendered) renderUserTasks(principalTasks, additionalTasks);
        }, (error) => {
            console.error(`Error en listener de tareas adicionales (${statusFilter}): `, error);
            renderUserTasks(principalTasks, additionalTasks);
        });

        // Guardamos ambos listeners para cancelarlos
        unsubscribeTasks = () => {
            unsubscribePrincipal();
            unsubscribeAdditional();
        };
    }
    // --- FIN Lógica de Consulta ---

    // Añadir el nuevo listener combinado al array de listeners activos
    if (unsubscribeTasks) {
        activeListeners = activeListeners.filter(listener => listener !== unsubscribeTasks);
        activeListeners.push(unsubscribeTasks);
    } else {
        console.error("ERROR CRÍTICO: unsubscribeTasks es null DESPUÉS de crear los listeners.");
    }
}

/**
 * Crea el elemento HTML (tarjeta) para mostrar una tarea individual.
 * (VERSIÓN FINAL: Simplificada, y botón de avance siempre activo)
 * @param {object} task - El objeto de datos de la tarea desde Firestore.
 * @returns {HTMLElement} - El elemento div de la tarjeta de tarea.
 */
function createTaskCard(task) {
    const card = document.createElement('div');
    card.className = "bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden h-full task-card";
    card.dataset.id = task.id;

    // --- Lógica de Fecha (sin cambios) ---
    const dueDate = task.dueDate ? new Date(task.dueDate + 'T00:00:00') : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let dateColor = 'text-gray-500';
    let dateText = 'Sin fecha límite';
    let dateIcon = `<svg class="h-4 w-4 mr-1 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>`;
    if (dueDate && task.status === 'pendiente') {
        const diffTime = dueDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays < 0) {
            dateColor = 'text-red-600 font-bold';
            dateText = 'Vencida';
            dateIcon = `<svg class="h-4 w-4 mr-1 inline-block text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.414-1.414L11 10.586V6z" clip-rule="evenodd"></path></svg>`;
        } else if (diffDays === 0) {
            dateColor = 'text-yellow-600 font-bold';
            dateText = 'Hoy';
            dateIcon = `<svg class="h-4 w-4 mr-1 inline-block text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.414-1.414L11 10.586V6z" clip-rule="evenodd"></path></svg>`;
        } else if (diffDays <= 3) {
            dateColor = 'text-gray-700 font-semibold';
            dateText = `Faltan ${diffDays} días`;
        } else {
            dateText = dueDate.toLocaleDateString('es-CO');
        }
    } else if (dueDate) {
        dateText = dueDate.toLocaleDateString('es-CO');
    }
    // --- FIN Lógica de Fecha ---


    // --- Barra de Progreso (Instalación) ---
    let progressBarHtml = '';
    const progressBarId = `task-progress-bar-${task.id}`;
    const progressTextId = `task-progress-text-${task.id}`;
    if (task.status === 'completada') {
        progressBarHtml = `
            <div>
                <div class="flex justify-between mb-1"><span class="text-xs font-medium text-green-700">Progreso Instalación</span><span class="text-xs font-medium text-green-700">100%</span></div>
                <div class="task-progress-bar-bg"><div class="task-progress-bar-fg bg-green-500" style="width: 100%;"></div></div>
            </div>`;
    } else if (task.specificSubItemIds && task.specificSubItemIds.length > 0) {
        progressBarHtml = `
            <div>
                <div class="flex justify-between mb-1"><span class="text-xs font-medium text-gray-500">Progreso Instalación</span><span id="${progressTextId}" class="text-xs font-medium text-blue-700">Calculando...</span></div>
                <div class="task-progress-bar-bg"><div id="${progressBarId}" class="task-progress-bar-fg" style="width: 0%;"></div></div>
            </div>`;
        const calculateProgress = async () => {
            try {
                // --- INICIO DE CORRECCIÓN ---
                const subItemIds = task.specificSubItemIds || [];
                const selectedItems = task.selectedItems || [];
                const projectId = task.projectId;

                if (subItemIds.length === 0 || selectedItems.length === 0 || !projectId) {
                    // Si no hay sub-ítems, mostramos 0% (0/0) en lugar de "Calculando..."
                    const progressTextElement = document.getElementById(progressTextId);
                    if (progressTextElement) progressTextElement.textContent = `0% (0/0)`;
                    return; // No hay nada que calcular
                }

                let installedCount = 0;
                let totalFoundInTask = 0;
                const subItemIdsSet = new Set(subItemIds); // Para búsqueda rápida

                // Iteramos sobre los items PADRE (V-01, V-02...)
                for (const itemInfo of selectedItems) {
                    const itemId = itemInfo.itemId;
                    if (!itemId) continue;

                    // Buscamos en lotes de 30 (límite 'in')
                    for (let i = 0; i < subItemIds.length; i += 30) {
                        const chunkIds = subItemIds.slice(i, i + 30);

                        // Creamos la consulta con el PATH COMPLETO y ANIDADO
                        const q = query(
                            collection(db, "projects", projectId, "items", itemId, "subItems"),
                            where(documentId(), "in", chunkIds) // Filtramos por los IDs en este chunk
                        );

                        const snapshot = await getDocs(q);

                        snapshot.forEach(docSnap => {
                            // Verificamos que el subItem encontrado SÍ pertenezca a esta tarea
                            if (docSnap.exists() && subItemIdsSet.has(docSnap.id)) {
                                totalFoundInTask++; // Lo encontramos
                                if (docSnap.data().status === 'Instalado') {
                                    installedCount++; // Está instalado
                                }
                            }
                        });
                    }
                }

                const totalSubItemsEffective = subItemIds.length; // El total es la lista completa de la tarea
                const percentage = totalSubItemsEffective > 0 ? (installedCount / totalSubItemsEffective) * 100 : 0;
                // --- FIN DE CORRECCIÓN ---

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
        progressBarHtml = '';
    }

    // --- Placeholder para el Estado de Materiales ---
    const materialStatusId = `material-status-${task.id}`;
    let materialStatusHtml = '';
    if (task.specificSubItemIds && task.specificSubItemIds.length > 0) {
        materialStatusHtml = `
            <div id="${materialStatusId}" class="mt-2 text-xs">
                <p class="text-gray-400 italic">Cargando estado de material...</p>
            </div>`;
    }

    // --- Botones (MODIFICADOS) ---
    const baseButtonClasses = "text-xs font-bold py-2 px-4 rounded-lg transition-colors flex items-center shadow-sm";
    const iconBaseClasses = "h-4 w-4 mr-1";

    const editButtonHtmlFinal = currentUserRole === 'admin' ? `
        <button data-action="edit-task" data-id="${task.id}" class="${baseButtonClasses} bg-yellow-500 hover:bg-yellow-600 text-white">
            <svg class="${iconBaseClasses}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
            Editar
        </button>
    ` : '';

    const viewTaskButtonHtmlFinal = `
        <button data-action="view-task-details" data-id="${task.id}" class="${baseButtonClasses} bg-blue-100 hover:bg-blue-200 text-blue-700">
             <svg class="${iconBaseClasses}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.478 0-8.268-2.943-9.542-7z"></path></svg>
            Ver Tarea
        </button>
    `;

    // --- Botón "Registrar Avance" (Siempre habilitado) ---
    const progressButtonClass = 'bg-blue-500 hover:bg-blue-600 text-white';
    const disabledAttribute = ''; // Ya no se deshabilita

    const registerProgressButtonHtmlFinal = task.status === 'pendiente' && task.projectId && ((task.selectedItems && task.selectedItems.length > 0) || (task.specificSubItemIds && task.specificSubItemIds.length > 0)) ? `
        <button data-action="register-task-progress" data-task-id="${task.id}" class="${baseButtonClasses} ${progressButtonClass}" ${disabledAttribute}>
            <svg class="${iconBaseClasses}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
            Registrar Avance
        </button>
    ` : '';
    // --- FIN MODIFICACIÓN ---

    const requestMaterialButtonHtml = task.status === 'pendiente' && task.projectId && task.specificSubItemIds && task.specificSubItemIds.length > 0 ? `
        <button data-action="request-material-from-task"
                data-project-id="${task.projectId}"
                data-task-id="${task.id}"
                class="${baseButtonClasses} bg-purple-500 hover:bg-purple-600 text-white">
            <svg class="${iconBaseClasses}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>
            Solicitar Material
        </button>
    ` : '';

    const completeButtonHtmlFinal = task.status === 'pendiente' ? `
        <button data-action="complete-task" data-id="${task.id}" class="${baseButtonClasses} bg-green-500 hover:bg-green-600 text-white">
            <svg class="${iconBaseClasses}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            Completada
        </button>
    ` : '';

    const adminToggleCheckbox = document.getElementById('admin-task-toggle-checkbox');
    const isAdminView = adminToggleCheckbox?.checked && currentUserRole === 'admin';
    const unreadCommentHtml = (task.unreadCommentFor && task.unreadCommentFor.includes(currentUser.uid)) ? `
        <span class="flex items-center font-medium text-blue-600 mr-2" title="Nuevos comentarios">
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17.608V14.5A8 8 0 0110 3c4.418 0 8 3.134 8 7zm-7-1a1 1 0 11-2 0 1 1 0 012 0zm4 0a1 1 0 11-2 0 1 1 0 012 0z" clip-rule="evenodd"></path></svg>
            <span class="ml-1">¡Nuevo!</span>
        </span>
    ` : '';

    // --- HTML de la Tarjeta (versión simplificada) ---
    card.innerHTML = `
        <div class="p-4 flex-grow">
            <div class="flex justify-between items-start mb-2">
                <div class="flex-grow">
                    <p class="text-xs font-semibold text-blue-600 uppercase tracking-wide">${task.projectName || 'Proyecto no especificado'}</p>
                    ${isAdminView ? `<p class="text-xs text-purple-600 font-semibold mt-1">Asignado a: ${task.assigneeName || 'N/A'}</p>` : ''}
                    <h3 class="text-lg font-bold text-gray-900 leading-tight mt-1">${task.description}</h3>
                </div>
                <div class="text-right flex-shrink-0 pl-4">
                    <p class="text-sm ${dateColor} flex items-center justify-end">${dateIcon} ${dateText}</p>
                    <p class="text-xs text-gray-400 mt-1">Por: ${usersMap.get(task.createdBy)?.firstName || 'N/A'}</p>
                </div>
            </div>

            ${unreadCommentHtml ? `<div class="mb-2">${unreadCommentHtml}</div>` : ''}

            <div class="mt-4 px-4 py-3 bg-gray-50 rounded-lg border space-y-3">
                ${progressBarHtml}
                ${materialStatusHtml}
            </div>
        </div>
        
        <div class="bg-gray-50 p-3 border-t border-gray-200 flex flex-wrap gap-2 justify-end items-center">
            <div class="flex flex-wrap gap-2 justify-end">
                ${editButtonHtmlFinal}
                ${viewTaskButtonHtmlFinal}
                ${requestMaterialButtonHtml}
                ${registerProgressButtonHtmlFinal}
                ${completeButtonHtmlFinal}
            </div>
        </div>
    `;
    return card;
}

/**
 * Inicia el proceso de registrar avance.
 * Esta función es ahora "ligera" y solo abre el modal.
 * @param {string} taskId - El ID de la tarea.
 */
async function handleRegisterTaskProgress(taskId) {
    if (!taskId) return;
    console.log(`[Task Progress] Solicitud para abrir modal para Tarea ID: ${taskId}`);

    // ¡OPTIMIZACIÓN!
    // No mostramos el overlay. No esperamos NADA.
    // Solo llamamos a la función que abre el modal.
    // El modal se encargará de su propia carga interna.
    await openMultipleProgressModal(taskId);

    // (Toda la lógica de 'getDoc', 'updateDoc' y migración se movió 
    // a 'openMultipleProgressModal')
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

        // --- INICIO DE CORRECCIÓN DE LÓGICA DE VALIDACIÓN ---

        // 1. Verificar si hay sub-ítems asociados
        if (subItemIds && subItemIds.length > 0) {

            // 2. Verificar que la tarea tenga 'selectedItems' (necesario para los paths)
            if (!taskData.selectedItems || taskData.selectedItems.length === 0) {
                console.warn(`Tarea ${taskId} tiene sub-ítems pero no 'selectedItems'. Completando sin verificar.`);
            } else {

                let totalPending = 0;
                let itemsChecked = 0;

                // 3. Iterar sobre los ítems PADRES de la tarea para encontrar los sub-ítems
                for (const item of taskData.selectedItems) {
                    const itemId = item.itemId;

                    // Preparamos los IDs de la tarea en lotes (chunks) de 30
                    const subItemDocs = [];
                    for (let i = 0; i < subItemIds.length; i += 30) {
                        const chunkIds = subItemIds.slice(i, i + 30);

                        // Buscamos los sub-ítems de esta tarea DENTRO de la subcolección de este ítem
                        const q = query(
                            collection(db, "projects", taskData.projectId, "items", itemId, "subItems"),
                            where(documentId(), "in", chunkIds) // Filtramos por los IDs de la tarea
                        );

                        const snapshot = await getDocs(q);
                        snapshot.forEach(doc => subItemDocs.push(doc));
                    }

                    // 4. Contamos cuántos de los encontrados NO están instalados
                    for (const docSnap of subItemDocs) {
                        if (docSnap.exists()) {
                            itemsChecked++; // Contamos cuántos encontramos
                            if (docSnap.data().status !== 'Instalado') {
                                totalPending++; // Sumamos los pendientes
                            }
                        }
                    }
                } // Fin del bucle 'for (const item...)'

                // 5. Verificación final
                if (itemsChecked < subItemIds.length) {
                    // Esto pasa si un sub-ítem está en la tarea pero no se encontró en la BD
                    // (lo cual no debería pasar, pero es una salvaguarda)
                    alert(`Error: No se pudieron encontrar todos los sub-ítems (${subItemIds.length - itemsChecked} faltantes). No se puede completar la tarea.`);
                    loadingOverlay.classList.add('hidden');
                    return;
                }

                if (totalPending > 0) {
                    // ¡AQUÍ ES DONDE SE BLOQUEA!
                    alert(`No se puede completar la tarea. Aún quedan ${totalPending} sub-ítem(s) pendientes de registrar avance (estado "Instalado").`);
                    loadingOverlay.classList.add('hidden'); // Oculta el loader
                    return; // Detiene la ejecución
                }
            }
        } else {
            // Si la tarea no tiene subItemIds (puede ser antigua o sin ítems)
            console.warn(`Tarea ${taskId} no tiene sub-ítems específicos asociados. Completando sin verificar avance.`);
        }
        // --- FIN DE CORRECCIÓN ---

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
 * Añade un nuevo comentario a la bitácora de una tarea y notifica a los involucrados.
 * @param {string} taskId - El ID de la tarea.
 */
async function addCommentToTask(taskId) {
    const input = document.getElementById('task-comment-input');
    const submitBtn = document.getElementById('task-comment-submit-btn');
    if (!input || !submitBtn) return;

    const commentText = input.value.trim();
    if (commentText.length === 0) return;

    const userData = usersMap.get(currentUser.uid) || { firstName: 'Usuario', lastName: 'Desconocido' };
    const authorFirstName = userData.firstName || 'Usuario';

    submitBtn.disabled = true;
    input.disabled = true;

    try {
        // 1. Obtener los datos de la tarea (los necesitamos para el projectId)
        const taskRef = doc(db, "tasks", taskId);
        const taskSnap = await getDoc(taskRef);

        if (!taskSnap.exists()) {
            throw new Error("La tarea ya no existe. No se puede comentar.");
        }
        const taskData = taskSnap.data();

        // 2. Guardar el comentario en la subcolección
        const commentData = {
            userId: currentUser.uid,
            userName: `${authorFirstName} ${userData.lastName.charAt(0)}.`,
            text: commentText,
            createdAt: new Date()
        };
        await addDoc(collection(db, "tasks", taskId, "comments"), commentData);

        // 3. Llamar a la Cloud Function para que envíe las notificaciones
        // (El backend se encargará de encontrar a los admins y asignados)
        const notifyFunction = httpsCallable(functions, 'notifyOnNewTaskComment');
        await notifyFunction({
            taskId: taskId,
            projectId: taskData.projectId,
            commentText: commentText,
            authorName: authorFirstName
        });

        input.value = ''; // Limpiar input al éxito

    } catch (error) {
        console.error("Error al añadir comentario o notificar:", error);
        alert(`No se pudo guardar el comentario: ${error.message}`);
    } finally {
        submitBtn.disabled = false;
        input.disabled = false;
        input.focus();
    }
}

/**
 * Guarda una nueva tarea en Firestore, incluyendo ítems seleccionados con cantidad
 * y envía notificaciones a los asignados.
 * (VERSIÓN ACTUALIZADA: "Estampa" el ID de la tarea en los sub-ítems y
 * calcula los M² asignados para las estadísticas del operario)
 * @param {object} taskData - Datos de la tarea obtenidos del formulario del modal.
 */
async function createTask(taskData) {
    // Validaciones básicas (se mantienen projectId, assigneeId, description)
    if (!taskData.projectId || !taskData.assigneeId || !taskData.description) {
        alert("Por favor, completa Proyecto, Asignado Principal y Descripción.");
        return;
    }

    // --- Recolectar datos de ítems y encontrar subItemIds ---
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
            alert(`Por favor, ingresa una cantidad válida (mayor a 0) para el ítem "${checkbox.nextElementSibling.textContent}".`); // <-- CORRECCIÓN: throw new Error
            return;
        }
        if (quantity > maxQuantity) {
            alert(`La cantidad para el ítem "${checkbox.nextElementSibling.textContent}" (${quantity}) excede el máximo permitido (${maxQuantity}).`); // <-- CORRECCIÓN: throw new Error
            return;
        }

        selectedItemsQueryData.push({
            itemId: itemId,
            quantityNeeded: quantity,
            itemName: checkbox.nextElementSibling.textContent
        });
    }

    // --- INICIO DE MODIFICACIÓN: Fase 2 ---
    const specificSubItemIds = [];
    const selectedItemsForTask = [];
    let totalMetrosAsignados = 0; // 1. Inicializar contador de M²
    const batchSubItemUpdates = writeBatch(db); // 2. Preparar batch para "estampar" sub-ítems
    let subItemsToStamp = []; // 3. Array para guardar las referencias a actualizar

    for (const itemQuery of selectedItemsQueryData) {

        // --- CORRECCIÓN DE BUG (Query Antigua) ---
        // La consulta anterior usaba la colección raíz "subItems".
        // Esta consulta usa la ruta de subcolección correcta.
        const subItemsQuery = query(
            collection(db, "projects", taskData.projectId, "items", itemQuery.itemId, "subItems"),
            where("status", "!=", "Instalado"),
            where("assignedTaskId", "==", null), // 4. SÓLO tomar sub-ítems que no estén ya en otra tarea
            orderBy("number", "asc"),
            limit(itemQuery.quantityNeeded)
        );
        // --- FIN DE CORRECCIÓN DE BUG ---

        const subItemsSnapshot = await getDocs(subItemsQuery);
        if (subItemsSnapshot.size < itemQuery.quantityNeeded) {
            alert(`No se pudieron asignar ${itemQuery.quantityNeeded} unidades para "${itemQuery.itemName}". Solo se encontraron ${subItemsSnapshot.size} unidades libres y pendientes.`); // <-- CORRECCIÓN: throw new Error
            return;
        }

        subItemsSnapshot.forEach(subItemDoc => {
            const subItemData = subItemDoc.data();

            specificSubItemIds.push(subItemDoc.id);

            // 5. Sumar los M² del sub-ítem (estampados en Fase 1)
            totalMetrosAsignados += (subItemData.m2 || 0);

            // 6. Guardar la referencia del sub-ítem para actualizarla después
            subItemsToStamp.push(subItemDoc.ref);
        });

        selectedItemsForTask.push({
            itemId: itemQuery.itemId,
            quantity: itemQuery.quantityNeeded
        });
    }
    // --- FIN DE MODIFICACIÓN: Fase 2 ---


    // Recolectar asignados adicionales (sin cambios)
    const additionalAssignees = taskData.additionalAssigneeIds ?
        (Array.isArray(taskData.additionalAssigneeIds) ? taskData.additionalAssigneeIds : [taskData.additionalAssigneeIds])
        : [];

    try {
        // --- Guardar la Tarea ---
        const newTaskRef = await addDoc(collection(db, "tasks"), {
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
            createdBy: currentUser.uid,
            totalMetrosAsignados: totalMetrosAsignados // 7. Guardar los M² totales en la tarea
        });
        console.log("Nueva tarea guardada en Firestore con ID:", newTaskRef.id);

        // --- INICIO DE MODIFICACIÓN: Fase 2 (Continuación) ---

        // 8. "Estampar" los sub-ítems con el ID de la tarea recién creada
        subItemsToStamp.forEach(subItemRef => {
            batchSubItemUpdates.update(subItemRef, {
                assignedTaskId: newTaskRef.id // <-- El "estampado"
            });
        });
        await batchSubItemUpdates.commit();
        console.log(`${subItemsToStamp.length} sub-items estampados con el ID de tarea: ${newTaskRef.id}`);

        // 9. Actualizar las estadísticas mensuales del operario
        if (totalMetrosAsignados > 0) {
            const assigneeId = taskData.assigneeId;
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0'); // Formato "MM"
            const statDocId = `${year}_${month}`; // Ej: "2025_11"

            // Referencia al documento de estadísticas de ese mes para ese usuario
            const statsRef = doc(db, "employeeStats", assigneeId, "monthlyStats", statDocId);

            // Usamos setDoc con merge:true para crear el documento si no existe,
            // e increment() para sumar los metros de forma segura.
            await setDoc(statsRef, {
                metrosAsignados: increment(totalMetrosAsignados),
                // Inicializamos los otros campos si no existen
                metrosCompletados: increment(0),
                metrosEnTiempo: increment(0),
                metrosFueraDeTiempo: increment(0)
            }, { merge: true });

            console.log(`Estadísticas mensuales del operario (${assigneeId} / ${statDocId}) actualizadas: +${totalMetrosAsignados}m² asignados.`);

        }
        // --- FIN DE MODIFICACIÓN ---


        // --- Lógica de Notificaciones (sin cambios) ---
        const projectName = taskData.projectName || "un proyecto";
        const notificationMessage = `Nueva tarea asignada: ${taskData.description.substring(0, 50)}${taskData.description.length > 50 ? '...' : ''}`;
        const notificationData = {
            message: notificationMessage,
            projectName: projectName,
            taskId: newTaskRef.id,
            read: false,
            createdAt: new Date(),
            type: 'new_task_assignment'
        };
        // (Notificación a principal)
        if (taskData.assigneeId && taskData.assigneeId !== currentUser.uid) {
            await addDoc(collection(db, "notifications"), {
                ...notificationData,
                userId: taskData.assigneeId
            });
        }
        // (Notificación a adicionales)
        for (const additionalId of additionalAssignees) {
            if (additionalId && additionalId !== currentUser.uid) {
                await addDoc(collection(db, "notifications"), {
                    ...notificationData,
                    userId: additionalId
                });
            }
        }
        // --- Fin Lógica de Notificaciones ---

        closeMainModal();

    } catch (error) {
        console.error("Error al guardar la nueva tarea o actualizar sub-ítems:", error);
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

    // --- INICIO DE CAMBIO: Marcar comentarios como leídos al abrir ---
    try {
        const taskRef = doc(db, "tasks", taskId);
        // Usamos arrayRemove para quitar nuestro ID del array de "no leídos".
        // Esto es "idempotente", no da error si nuestro ID no estaba.
        updateDoc(taskRef, {
            unreadCommentFor: arrayRemove(currentUser.uid)
        });
    } catch (error) {
        console.error("Error al marcar comentarios como leídos:", error);
    }
    // --- FIN DE CAMBIO ---

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

            // Esta es la versión corregida que asume que todos los subItems
            // pertenecen al primer item listado en la tarea (parche por migración)
            const loadItemDetails = async () => {
                try {
                    const subItemIds = task.specificSubItemIds || [];
                    const selectedItems = task.selectedItems || [];
                    if (subItemIds.length === 0 || selectedItems.length === 0) {
                        throw new Error("La tarea no tiene sub-ítems o ítems seleccionados.");
                    }

                    const itemsStatus = new Map();
                    const itemIds = [...new Set(selectedItems.map(i => i.itemId))];
                    const subItemIdsSet = new Set(subItemIds); // Para un filtrado rápido

                    // 1. Cargar datos de los items (para nombres) - (N lecturas)
                    const itemDocs = await Promise.all(itemIds.map(id => getDoc(doc(db, "projects", task.projectId, "items", id))));
                    const itemNames = new Map(itemDocs.map(d => [d.id, d.exists() ? d.data().name : `Ítem ID: ${d.id}`]));

                    itemIds.forEach(id => {
                        itemsStatus.set(id, { name: itemNames.get(id), total: 0, installed: 0 });
                    });

                    // 2. Cargar estado de CADA subItem (M lecturas, en lotes de 30)
                    // Iteramos sobre los ítems padres para construir los paths correctos
                    for (const itemInfo of selectedItems) {
                        const itemId = itemInfo.itemId;

                        // Preparamos los IDs de esta tarea en lotes (chunks) de 30
                        const subItemDocs = [];
                        for (let i = 0; i < subItemIds.length; i += 30) {
                            const chunkIds = subItemIds.slice(i, i + 30);
                            const q = query(
                                collection(db, "projects", task.projectId, "items", itemId, "subItems"),
                                where(documentId(), "in", chunkIds)
                            );
                            const snapshot = await getDocs(q);
                            snapshot.forEach(doc => subItemDocs.push(doc));
                        }

                        for (const docSnap of subItemDocs) {
                            if (docSnap.exists()) {
                                // Verificamos que este sub-ítem realmente esté en la lista de la tarea
                                if (!subItemIdsSet.has(docSnap.id)) continue;

                                const subItem = docSnap.data();
                                const statusInfo = itemsStatus.get(subItem.itemId);
                                if (statusInfo) {
                                    statusInfo.total++;
                                    if (subItem.status === 'Instalado') {
                                        statusInfo.installed++;
                                    }
                                }
                            }
                        }
                    }

                    // 3. Renderizar la tabla
                    let tableBodyHtml = '';
                    if (itemsStatus.size === 0) {
                        tableBodyHtml = '<tr><td colspan="3" class="text-center py-3 text-red-500">Error: No se encontraron los ítems asociados.</td></tr>';
                    } else {
                        itemsStatus.forEach((statusInfo, itemId) => {
                            // Si el total es 0, significa que los subitems no se encontraron (eran de otro item)
                            if (statusInfo.total === 0) return;

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

        // --- INICIO DE LA MODIFICACIÓN (HTML y Lógica) ---
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

                <div id="task-comments-section" class="pt-4 border-t border-gray-200">
                    <h4 class="text-md font-semibold text-gray-700 mb-3 flex items-center">
                        <svg class="h-5 w-5 mr-2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
                        </svg>
                        Bitácora / Comentarios
                    </h4>
                    <div id="task-comments-list" class="space-y-3 max-h-48 overflow-y-auto bg-gray-50 p-3 rounded-lg border">
                        <p class="text-sm text-gray-400 italic text-center">Cargando comentarios...</p>
                    </div>
                    <div class="mt-3 flex gap-2">
                        <input type="text" id="task-comment-input" class="flex-grow border rounded-md p-2 text-sm" placeholder="Escribe un comentario...">
                        <button type="button" id="task-comment-submit-btn" class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg text-sm">
                            Enviar
                        </button>
                    </div>
                </div>
                </div>
        `;

        // 2. Cargar estado de materiales (código existente)
        if (task.specificSubItemIds && task.specificSubItemIds.length > 0) {
            loadTaskMaterialStatus(task.id, task.projectId, materialStatusId);
        }

        // 3. Encontrar elementos de la bitácora (AHORA SÍ EXISTEN)
        const commentsSection = bodyEl.querySelector('#task-comments-section');
        const commentsList = bodyEl.querySelector('#task-comments-list');
        const commentSubmitBtn = bodyEl.querySelector('#task-comment-submit-btn');

        if (commentsSection && commentsList && commentSubmitBtn) {
            // 3a. Guardar taskId para la limpieza del listener
            commentsSection.dataset.taskId = task.id;

            // 3b. Añadir listener al botón de enviar
            commentSubmitBtn.addEventListener('click', () => {
                addCommentToTask(task.id);
            });

            // 3c. Limpiar listener anterior si existe (por si acaso)
            if (taskCommentListeners.has(task.id)) {
                taskCommentListeners.get(task.id)();
            }

            // 3d. Crear nuevo listener para la subcolección 'comments'
            const commentsQuery = query(collection(db, "tasks", task.id, "comments"), orderBy("createdAt", "asc"));
            const unsubscribeComments = onSnapshot(commentsQuery, (snapshot) => {
                commentsList.innerHTML = ''; // Limpiar lista
                if (snapshot.empty) {
                    commentsList.innerHTML = '<p class="text-sm text-gray-400 italic text-center">Aún no hay comentarios.</p>';
                    return;
                }
                snapshot.forEach(doc => {
                    const comment = doc.data();
                    const commentDate = comment.createdAt.toDate();
                    const formattedDate = `${commentDate.toLocaleDateString('es-CO')} ${commentDate.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`;

                    const commentEl = document.createElement('div');

                    // --- INICIO DE CORRECCIÓN (Estilo de Log) ---
                    if (comment.type === 'log') {
                        // Es un log del sistema
                        commentEl.className = "text-sm italic text-gray-500 py-2 border-t border-gray-100";
                        // Usamos 'innerHTML' para renderizar el <strong> o <b>
                        commentEl.innerHTML = `
                            <p class="inline">${comment.text}</p>
                            <span class="text-xs ml-1">(${formattedDate})</span>
                        `;
                    } else {
                        // Es un comentario normal
                        commentEl.className = "text-sm py-2 border-t border-gray-100";
                        commentEl.innerHTML = `
                            <p class="text-gray-800">${comment.text}</p>
                            <p class="text-xs text-gray-500 font-medium">
                                — ${comment.userName} <span class="font-normal">el ${formattedDate}</span>
                            </p>
                        `;
                    }
                    // --- FIN DE CORRECCIÓN ---

                    commentsList.appendChild(commentEl);
                });
                // Scroll automático al último comentario
                commentsList.scrollTop = commentsList.scrollHeight;
            }, (error) => {
                console.error("Error al cargar comentarios:", error);
                commentsList.innerHTML = '<p class="text-sm text-red-500 text-center">Error al cargar comentarios.</p>';
            });

            // 3e. Guardar la función de unsubscribe
            taskCommentListeners.set(task.id, unsubscribeComments);
        }
        // --- FIN DE LA MODIFICACIÓN ---

        // --- Añadir botones de acción (código existente) ---
        actionsEl.querySelectorAll('button:not(#task-details-cancel-btn)').forEach(btn => btn.remove());

        if (currentUserRole === 'admin') {
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.dataset.action = 'edit-task';
            editBtn.dataset.id = task.id;
            editBtn.className = 'bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg flex items-center';
            editBtn.innerHTML = `<svg class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg> Editar Tarea`;
            actionsEl.insertBefore(editBtn, actionsEl.firstChild);
        }
        if (task.status === 'pendiente' && task.specificSubItemIds && task.specificSubItemIds.length > 0) {
            const requestBtn = document.createElement('button');
            requestBtn.type = 'button';
            requestBtn.dataset.action = 'request-material-from-task';
            requestBtn.dataset.projectId = task.projectId;
            requestBtn.dataset.taskId = task.id;
            requestBtn.className = 'bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-4 rounded-lg flex items-center';
            requestBtn.innerHTML = `<svg class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg> Solicitar Material`;
            actionsEl.insertBefore(requestBtn, actionsEl.firstChild);
        }
        if (task.status === 'pendiente' && task.specificSubItemIds && task.specificSubItemIds.length > 0) {
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

        // Limpiar listeners de material activos para este modal
        const materialStatusDiv = bodyEl.querySelector('div[id^="task-detail-material-status-"]');
        if (materialStatusDiv) {
            const placeholderId = materialStatusDiv.id;
            if (materialStatusListeners.has(placeholderId)) {
                materialStatusListeners.get(placeholderId)(); // Llama a la función unsubscribe
                materialStatusListeners.delete(placeholderId);
                console.log(`Listener de material ${placeholderId} limpiado al cerrar modal.`);
            }
        }

        // --- INICIO DE LA MODIFICACIÓN (Limpieza de listener de Comentarios) ---
        const commentsSection = bodyEl.querySelector('#task-comments-section');
        if (commentsSection) {
            const taskId = commentsSection.dataset.taskId; // Obtengo el ID que guardé
            if (taskId && taskCommentListeners.has(taskId)) {
                taskCommentListeners.get(taskId)(); // Unsubscribe
                taskCommentListeners.delete(taskId);
                console.log(`Listener de comentarios para ${taskId} limpiado.`);
            }
        }
        // --- FIN DE LA MODIFICACIÓN ---

        // Limpiar el contenido para la próxima vez
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

        // --- INICIO DE CORRECCIÓN ---
        // El problema estaba en esta lógica. 
        // 'pendingItemsForTask' debe ser el array 'selectedItems' original de la tarea.
        // La función 'showMaterialRequestView' se encargará de buscar los nombres.

        if (taskData.selectedItems && taskData.selectedItems.length > 0) {
            // Simplemente pasamos los datos de la tarea directamente.
            // 'taskData.selectedItems' ya tiene el formato [{ itemId: "...", quantity: ... }]
            pendingItemsForTask = taskData.selectedItems;
        } else {
            console.warn("La tarea no tiene ítems ('selectedItems') para pre-seleccionar.");
            pendingItemsForTask = []; // Pasamos un array vacío
        }
        // --- FIN DE CORRECCIÓN ---

        // 2. Mostrar la vista de solicitud, PASANDO los ítems pendientes
        // 'pendingItemsForTask' ahora tiene el formato correcto: [{ itemId: "...", quantity: ... }]
        await showMaterialRequestView(pendingItemsForTask);

        // 3. Guardar el ID de la tarea en el formulario
        const taskIdInput = document.getElementById('material-request-task-id');
        if (taskIdInput) {
            taskIdInput.value = taskId; // Guardamos el ID de la tarea
        }

        // 4. Pre-seleccionar los ítems y cantidades en el formulario
        const itemListContainer = document.getElementById('request-item-list-container-view');

        (pendingItemsForTask || []).forEach(itemInfo => {
            // Usamos 'itemInfo.itemId' que es el formato correcto
            if (itemInfo && itemInfo.itemId) {
                const inputElement = itemListContainer.querySelector(`.request-item-quantity[data-item-id="${itemInfo.itemId}"]`);
                if (inputElement) {
                    inputElement.value = itemInfo.quantity;
                }
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
 * @param {string} renderMode - 'detail' (tabla completa) o 'summary' (barra de progreso).
 */
function loadTaskMaterialStatus(taskId, projectId, placeholderId, renderMode = 'detail') {
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

        // --- INICIO DE LÓGICA (Modificada para agrupar por tipo/medida) ---

        // 1. Agrupar materiales de todas las solicitudes de esta tarea
        const materialSummary = new Map();

        snapshot.forEach(doc => {
            const request = doc.data();
            const status = request.status; // 'pendiente', 'aprobado', 'entregado', 'entregado_parcial'
            const items = request.consumedItems || [];

            items.forEach(item => {
                // --- INICIO DE CORRECCIÓN: Clave Única ---
                // Creamos una clave única para CADA TIPO de ítem (no solo por materialId)
                const itemLength = (item.length || 0).toString(); // ej: 2.5 o 0
                const itemType = item.type || 'full_unit';
                const uniqueKey = `${item.materialId}-${itemType}-${itemLength}`;
                // --- FIN DE CORRECCIÓN ---

                const materialName = item.itemName || "Material";

                if (!materialSummary.has(uniqueKey)) {

                    // --- INICIO DE CORRECCIÓN: Guardar Descripción ---
                    let description = "Unidad Completa";
                    if (itemType === 'cut') {
                        description = `Corte de ${item.length * 100} cm`;
                    } else if (itemType === 'remnant') {
                        description = `Retazo de ${item.length * 100} cm`;
                    }
                    // --- FIN DE CORRECCIÓN ---

                    materialSummary.set(uniqueKey, {
                        name: materialName,
                        description: description, // <-- AÑADIDO
                        solicitado: 0,
                        despachado: 0 // "unidades pasadas"
                    });
                }

                const summary = materialSummary.get(uniqueKey);
                const quantity = item.quantity || 0;

                // Contamos 'solicitado' solo si está aprobado o ya entregado (no pendiente)
                if (status === 'aprobado' || status === 'entregado' || status === 'entregado_parcial') {
                    summary.solicitado += quantity;
                }

                // Contamos 'despachado' solo si está entregado
                if (status === 'entregado') {
                    summary.despachado += quantity;
                }
                // Si es parcial, contamos lo que se ha entregado del historial
                else if (status === 'entregado_parcial') {
                    const deliveryHistory = request.deliveryHistory || [];
                    deliveryHistory.forEach(delivery => {
                        delivery.items.forEach(deliveredItem => {

                            // --- INICIO DE CORRECCIÓN: Comparación de Clave Única ---
                            // Comparamos el ítem entregado con nuestra clave única
                            if (deliveredItem.materialId === item.materialId &&
                                deliveredItem.type === itemType &&
                                (deliveredItem.length || 0).toString() === itemLength) {
                                summary.despachado += deliveredItem.quantity;
                            }
                            // --- FIN DE CORRECCIÓN ---
                        });
                    });
                }
            });
        });

        // 2. Generar el HTML basado en el modo de renderizado
        let html = '';

        if (renderMode === 'detail') {
            // --- MODO DETALLE (Modificado para mostrar la descripción) ---
            if (materialSummary.size === 0) {
                html = `
                    <p class="font-semibold text-red-600 flex items-center">
                        <svg class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        No has solicitado material
                    </p>`;
            } else {
                html = `
                    <div class="overflow-hidden rounded-md border border-gray-200">
                        <table class="min-w-full text-sm">
                            <thead class="bg-gray-100">
                                <tr>
                                    <th class="px-3 py-2 text-left font-semibold text-gray-600">Material</th>
                                    <th class="px-3 py-2 text-left font-semibold text-gray-600">Descripción</th>
                                    <th class="px-3 py-2 text-center font-semibold text-gray-600">Entregado</th>
                                    <th class="px-3 py-2 text-center font-semibold text-gray-600">Pendiente</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-200 bg-white">
                `;

                materialSummary.forEach((summary) => {
                    const pendiente = Math.max(0, summary.solicitado - summary.despachado);
                    const entregado = summary.despachado;
                    const colorPendiente = pendiente > 0 ? 'text-red-600' : 'text-gray-700';

                    html += `
                        <tr>
                            <td class="px-3 py-2 font-medium text-gray-800">${summary.name}</td>
                            <td class="px-3 py-2 text-gray-600">${summary.description}</td>
                            <td class="px-3 py-2 text-center font-bold text-green-600">${entregado}</td>
                            <td class="px-3 py-2 text-center font-bold ${colorPendiente}">${pendiente}</td>
                        </tr>
                    `;
                });

                html += `
                            </tbody>
                        </table>
                    </div>
                `;
            }
        } else {
            // --- MODO RESUMEN (CON BARRA DE PROGRESO) ---

            // 1. Calculamos el estado general
            let overallStatus = 'none';
            let totalSolicitado = 0;
            let totalDespachado = 0;

            materialSummary.forEach((summary) => {
                totalSolicitado += summary.solicitado;
                totalDespachado += summary.despachado;
            });

            // 2. Calculamos el porcentaje
            const porcentaje = (totalSolicitado > 0) ? (totalDespachado / totalSolicitado) * 100 : 0;

            if (totalSolicitado === 0) {
                overallStatus = 'none';
            } else if (porcentaje === 0) {
                overallStatus = 'requested';
            } else if (porcentaje < 100) {
                overallStatus = 'partial';
            } else {
                overallStatus = 'delivered';
            }
            // Fin del cálculo

            // 3. Generar el HTML
            if (overallStatus === 'none') {
                html = `
                    <p class="font-semibold text-red-600 flex items-center">
                        <svg class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        No has solicitado material
                    </p>`;
            } else {
                let barColor = 'bg-blue-600'; // Color para 'requested'
                let barTextColor = 'text-blue-700';
                let barText = `Material Solicitado (${totalDespachado}/${totalSolicitado})`;

                if (overallStatus === 'partial') {
                    barColor = 'bg-yellow-500'; // Color para 'partial'
                    barTextColor = 'text-yellow-700';
                    barText = `Despachado Parcial (${totalDespachado}/${totalSolicitado})`;
                } else if (overallStatus === 'delivered') {
                    barColor = 'bg-green-600'; // Color para 'delivered'
                    barTextColor = 'text-green-700';
                    barText = `Material Despachado (${totalDespachado}/${totalSolicitado})`;
                }

                html = `
                    <div class="flex justify-between mb-1">
                        <span class="text-xs font-semibold text-gray-700">${barText}</span>
                        <span class="text-xs font-bold ${barTextColor}">${porcentaje.toFixed(0)}%</span>
                    </div>
                    <div class="task-progress-bar-bg"> 
                        <div class="task-progress-bar-fg ${barColor}" style="width: ${porcentaje.toFixed(0)}%;"></div>
                    </div>
                `;
            }
        }
        // --- FIN DE CAMBIO ---

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

/**
 * Crea un documento de notificación en Firestore para un usuario específico.
 * @param {string} userId - ID del usuario a notificar.
 * @param {string} title - Título de la notificación.
 * @param {string} message - Mensaje de la notificación.
 * @param {string} view - La vista a la que debe navegar (ej: 'tareas', 'herramienta').
 */
async function sendNotification(userId, title, message, view) {
    if (!userId || !message) return;

    try {
        // Asumimos que la colección de notificaciones está en la raíz
        await addDoc(collection(db, "notifications"), {
            userId: userId,
            title: title,
            message: message,
            link: `/${view}`, // Usamos un link genérico
            read: false,
            createdAt: serverTimestamp(),
            type: 'system_alert' // Un tipo genérico
        });
    } catch (error) {
        console.error("Error al enviar notificación:", error);
    }
}



/**
 * Abre el modal de Validación Biométrica (Firma Digital).
 */
async function openSafetyCheckInModal(taskId, callbackOnSuccess) {
    onSafetyCheckInSuccess = callbackOnSuccess;
    verifiedCanvas = null;

    const modal = document.getElementById('safety-checkin-modal');
    const step1 = document.getElementById('checkin-step-1-face');
    const videoEl = document.getElementById('checkin-video-feed');
    const takePhotoButton = document.getElementById('checkin-take-photo-btn');
    const faceStatus = document.getElementById('checkin-face-status');
    const confirmBtn = document.getElementById('checkin-confirm-btn');
    const scannerLine = document.getElementById('scanner-line'); // Referencia a la línea láser

    modal.style.zIndex = "60";

    // 1. Resetear estado
    step1.classList.remove('hidden');     // Mostrar botón de escanear
    confirmBtn.classList.add('hidden');   // Ocultar botón de confirmar
    confirmBtn.disabled = true;

    takePhotoButton.disabled = false;
    takePhotoButton.innerHTML = '<i class="fa-solid fa-camera"></i> <span>Iniciar Escaneo</span>';
    takePhotoButton.classList.remove('hidden');

    faceStatus.textContent = 'Listo para validar';
    faceStatus.className = 'text-sm font-bold text-slate-600';

    if (scannerLine) scannerLine.classList.add('hidden'); // Ocultar láser al inicio

    // Guardamos el taskId
    confirmBtn.dataset.taskId = taskId;

    modal.style.display = 'flex';

    // 2. Iniciar cámara
    try {
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
        }
        videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoEl.srcObject = videoStream;
    } catch (err) {
        console.error("Error cámara:", err);
        faceStatus.textContent = "Error: No se detecta la cámara.";
        faceStatus.className = "text-sm font-bold text-red-500";
    }
}

/**
 * Abre el modal de autenticación facial para la edición del perfil.
 * Reutiliza el modal de check-in pero oculta la parte de EPP.
 */
async function openProfileAuthModal() {
    onSafetyCheckInSuccess = savePendingProfileUpdate;
    verifiedCanvas = null;

    const modal = document.getElementById('safety-checkin-modal');
    const title = document.getElementById('safety-checkin-title');
    const step1 = document.getElementById('checkin-step-1-face');
    const videoEl = document.getElementById('checkin-video-feed');
    const takePhotoButton = document.getElementById('checkin-take-photo-btn');
    const faceStatus = document.getElementById('checkin-face-status');
    const confirmBtn = document.getElementById('checkin-confirm-btn');

    modal.style.zIndex = "60";

    // 1. Resetear el modal
    step1.classList.remove('hidden');
    title.textContent = 'Verificar Identidad';
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Confirmar Identidad';
    takePhotoButton.disabled = false;
    takePhotoButton.textContent = 'Tomar Foto y Verificar Rostro';
    faceStatus.textContent = '';
    confirmBtn.dataset.taskId = '';

    modal.style.display = 'flex';

    // 2. Iniciar cámara
    try {
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
        }
        videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoEl.srcObject = videoStream;
    } catch (err) {
        console.error("Error al acceder a la cámara:", err);
        faceStatus.textContent = "Error al acceder a la cámara. Revisa los permisos.";
    }
}

/**
 * Guarda los cambios pendientes del perfil (después de la autenticación facial)
 * Y crea un registro de auditoría (Historial de Cambios).
 */
async function savePendingProfileUpdate() {
    const data = pendingProfileUpdateData;
    const user = auth.currentUser;
    if (!data || !user) {
        alert("Error: No se encontraron datos para actualizar.");
        return;
    }

    loadingOverlay.classList.remove('hidden');

    try {
        const userRef = doc(db, "users", user.uid);
        const oldUserData = usersMap.get(user.uid) || {};

        // 1. Preparar los datos a actualizar
        const dataToUpdate = {
            phone: data.phone,
            address: data.address,
            tallaCamiseta: data.tallaCamiseta || '',
            tallaPantalón: data.tallaPantalón || '',
            tallaBotas: data.tallaBotas || '',
        };

        // 2. Preparar el log de auditoría (Historial)
        const changes = {};
        if (data.phone !== oldUserData.phone) changes.phone = { old: oldUserData.phone, new: data.phone };
        if (data.address !== oldUserData.address) changes.address = { old: oldUserData.address, new: data.address };
        if (data.tallaCamiseta !== (oldUserData.tallaCamiseta || '')) changes.tallaCamiseta = { old: oldUserData.tallaCamiseta || '', new: data.tallaCamiseta };
        if (data.tallaPantalón !== (oldUserData.tallaPantalón || '')) changes.tallaPantalón = { old: oldUserData.tallaPantalón || '', new: data.tallaPantalón };
        if (data.tallaBotas !== (oldUserData.tallaBotas || '')) changes.tallaBotas = { old: oldUserData.tallaBotas || '', new: data.tallaBotas };
        if (data.email !== user.email) changes.email = { old: user.email, new: data.email };

        // 3. Usar un BATCH para guardar ambos (actualización + historial)
        const batch = writeBatch(db);
        const historyRef = doc(collection(userRef, "profileHistory")); // Nueva subcolección

        batch.update(userRef, dataToUpdate);

        // Solo guardamos el log si hubo cambios
        if (Object.keys(changes).length > 0) {
            batch.set(historyRef, {
                changes: changes,
                changedBy: user.uid,
                timestamp: serverTimestamp()
            });
        }

        await batch.commit();

        // 4. Actualizar el email (si cambió)
        if (data.email !== user.email) {
            await updateEmail(user, data.email);
        }

        // 5. Actualizar la caché local
        const updatedUserCache = { ...usersMap.get(user.uid), ...dataToUpdate, email: data.email };
        usersMap.set(user.uid, updatedUserCache);

    } catch (error) {
        console.error("Error al guardar los cambios del perfil:", error);
        alert("Error al guardar el perfil. Es posible que necesites volver a iniciar sesión.");
    } finally {
        loadingOverlay.classList.add('hidden');
        pendingProfileUpdateData = null; // Limpiar los datos temporales
    }
}
// --- FIN DE CÓDIGO AÑADIDO ---
// --- SISTEMA DE NOTIFICACIONES (TOASTS) ---
window.showToast = function (message, type = 'success') {
    const container = document.getElementById('toast-container');

    // Colores según tipo
    const colors = type === 'error'
        ? 'bg-red-100 border-l-4 border-red-500 text-red-700'
        : 'bg-green-100 border-l-4 border-green-500 text-green-700';

    const icon = type === 'error'
        ? '<i class="fa-solid fa-circle-exclamation mr-2"></i>'
        : '<i class="fa-solid fa-circle-check mr-2"></i>';

    // Crear elemento
    const toast = document.createElement('div');
    toast.className = `${colors} p-4 rounded shadow-lg flex items-center transform transition-all duration-300 translate-x-10 opacity-0 pointer-events-auto min-w-[300px]`;
    toast.innerHTML = `
        ${icon}
        <p class="font-bold text-sm">${message}</p>
    `;

    container.appendChild(toast);

    // Animación de entrada
    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-10', 'opacity-0');
    });

    // Eliminar después de 3 segundos
    setTimeout(() => {
        toast.classList.add('translate-x-10', 'opacity-0');
        setTimeout(() => toast.remove(), 300); // Esperar a que termine la transición
    }, 3500);
};

// --- SISTEMA DE AUDITORÍA (LOGS) ---
window.logAuditAction = async function (action, description, targetId, previousData = null, newData = null) {
    try {
        const user = auth.currentUser; // Asumiendo que 'auth' está disponible globalmente o importado
        if (!user) return;

        // Consultar datos del admin actual para guardar su nombre
        const adminSnap = await getDoc(doc(db, "users", user.uid));
        const adminName = adminSnap.exists() ? `${adminSnap.data().firstName} ${adminSnap.data().lastName}` : user.email;

        await addDoc(collection(db, "audit_logs"), {
            action: action,           // Ej: "Eliminar Pago"
            description: description, // Ej: "Se eliminó el pago de $500.000"
            targetId: targetId,       // ID del empleado afectado
            performedBy: user.uid,
            performedByName: adminName,
            previousData: previousData ? JSON.stringify(previousData) : null, // Qué había antes
            newData: newData ? JSON.stringify(newData) : null,           // Qué hay ahora
            timestamp: serverTimestamp()
        });
        console.log("Auditoría registrada:", action);
    } catch (e) {
        console.error("Error guardando log de auditoría:", e);
    }
};

/**
 * Registra un pago a un proveedor y lo distribuye entre sus deudas más antiguas (FIFO).
 */
async function registerSupplierPayment(supplierId, amount, method, date, note) {
    // 1. Buscar órdenes pendientes de este proveedor (Ordenadas por fecha: más viejas primero)
    const q = query(
        collection(db, "purchaseOrders"),
        where("supplierId", "==", supplierId),
        orderBy("createdAt", "asc")
    );

    const snapshot = await getDocs(q);

    let remainingMoney = amount;
    let billsPaidCount = 0;

    // 2. Recorrer y pagar deudas
    for (const docSnap of snapshot.docs) {
        if (remainingMoney <= 0) break;

        const po = docSnap.data();
        const total = po.totalCost || 0;
        const paid = po.paidAmount || 0;
        const debt = total - paid;

        if (debt <= 100) continue; // Si la deuda es despreciable (por redondeo), saltar

        const paymentForThisBill = Math.min(remainingMoney, debt);

        // A. Guardar el pago dentro de la orden
        await addDoc(collection(db, "purchaseOrders", docSnap.id, "payments"), {
            amount: paymentForThisBill,
            date: date,
            paymentMethod: method,
            note: `${note} (Automático)`,
            createdAt: serverTimestamp(),
            createdBy: currentUser.uid
        });

        // B. Actualizar saldo y estado de la orden
        // Si la deuda queda en 0 (o casi 0), marcamos como 'recibida' (pagada)
        // Nota: Según tu lógica actual, 'recibida' funciona como 'pagada' en este contexto.
        const newStatus = (Math.abs(debt - paymentForThisBill) < 100) ? 'recibida' : 'pendiente';

        await updateDoc(doc(db, "purchaseOrders", docSnap.id), {
            paidAmount: increment(paymentForThisBill),
            status: newStatus
        });

        remainingMoney -= paymentForThisBill;
        billsPaidCount++;
    }

    // 3. Guardar en el historial general del proveedor
    await addDoc(collection(db, "suppliers", supplierId, "payments"), {
        amount: amount,
        paymentMethod: method,
        note: note,
        date: date,
        createdAt: new Date(),
        distributedTo: billsPaidCount
    });

    return billsPaidCount;
}

/**
 * Busca el precio unitario más bajo registrado históricamente para un ítem.
 * Retorna: { price, supplierName, date } o null.
 */
async function findBestMarketPrice(materialId) {
    try {
        // Buscamos en las últimas 100 órdenes recibidas para tener una muestra relevante
        const q = query(
            collection(db, "purchaseOrders"),
            where("status", "==", "recibida"),
            orderBy("createdAt", "desc"),
            limit(100)
        );

        const snapshot = await getDocs(q);
        let bestOffer = null;

        snapshot.forEach(doc => {
            const po = doc.data();
            if (po.items && Array.isArray(po.items)) {
                // Buscamos el ítem específico dentro de la orden
                const item = po.items.find(i => i.materialId === materialId);

                if (item && item.unitCost > 0) {
                    // Si encontramos un precio menor, lo guardamos
                    if (!bestOffer || item.unitCost < bestOffer.price) {
                        bestOffer = {
                            price: item.unitCost,
                            supplierName: po.supplierName || po.provider || 'Desconocido',
                            date: po.createdAt ? po.createdAt.toDate() : new Date()
                        };
                    }
                }
            }
        });

        return bestOffer;
    } catch (e) {
        console.error("Error buscando mejor precio de mercado:", e);
        return null;
    }
}

// --- LÓGICA DE MODO OSCURO ---
function initThemeToggle() {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const darkIcon = document.getElementById('theme-toggle-dark-icon');
    const lightIcon = document.getElementById('theme-toggle-light-icon');

    if (!themeToggleBtn) return;

    // 1. Verificar preferencia guardada o del sistema
    if (localStorage.getItem('color-theme') === 'dark' ||
        (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
        lightIcon.classList.remove('hidden');
    } else {
        document.documentElement.classList.remove('dark');
        darkIcon.classList.remove('hidden');
    }

    // 2. Evento Click
    themeToggleBtn.addEventListener('click', function () {
        // Alternar iconos
        darkIcon.classList.toggle('hidden');
        lightIcon.classList.toggle('hidden');

        // Alternar clase en HTML
        if (document.documentElement.classList.contains('dark')) {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('color-theme', 'light');
        } else {
            document.documentElement.classList.add('dark');
            localStorage.setItem('color-theme', 'dark');
        }
    });
}

// Llamar a la inicialización
initThemeToggle();