const fs = require('fs');
const path = require('path');

const baseFile = 'C:\\Users\\johny\\OneDrive\\Escritorio\\PROGRAMAS FINALES\\VidriosExito\\app\\js\\app.js';
const outputFile = 'C:\\Users\\johny\\OneDrive\\Escritorio\\PROGRAMAS FINALES\\VidriosExito\\app\\js\\app.js';

function extractFunction(content, name) {
    const regex = new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`, 'g');
    const match = regex.exec(content);
    if (!match) return null;
    
    const startIdx = match.index;
    let braceCount = 0;
    let foundStart = false;
    let endIdx = -1;
    
    for (let i = startIdx; i < content.length; i++) {
        if (content[i] === '{') {
            braceCount++;
            foundStart = true;
        } else if (content[i] === '}') {
            braceCount--;
            if (foundStart && braceCount === 0) {
                endIdx = i;
                break;
            }
        }
    }
    
    if (endIdx === -1) return null;
    return content.substring(startIdx, endIdx + 1);
}

function runRebuild() {
    console.log('Rebuilding app.js with modular architecture...');
    let content = fs.readFileSync(baseFile, 'utf8');

    // 1. Define modular imports and window bindings
    const header = `import { db, auth, storage, messaging, functions, VAPID_KEY } from './core/firebase-config.js';

// --- IMPORTACIONES DE MÓDULOS DEL CORE Y UI (OLA 5) ---
import { normalizeString, resizeImage, loadFaceAPImodels, generateProfileFaceDescriptor, formatTimeAgo, fetchMunicipalities, loadScript } from './core/utils.js';
import { getRoleDefaultPermissions, applySidebarPermissions, closeSidebar, showView, initializePushNotifications, updatePermissionUI, requestCameraPermission, requestLocationPermission, requestPushPermission, checkAllPermissionsOnLogin, SIDEBAR_CONFIG } from './core/permissions.js';
import { handleLogin, handleRegister, handleLogout, showAuthView, isRegistering, setIsRegistering } from './core/auth.js';
import { openCameraModal, closeCameraModal, capturePhoto, handlePhotoFile } from './ui/camera.js';
import { openDocumentsModal, closeDocumentsModal, isMobileDevice, viewDocument, openDocumentViewerModal, closeDocumentViewerModal, uploadProjectDocument, deleteProjectDocument, subirDocumento, setupDocumentos, openOtroSiModal, closeOtroSiModal, handleOtroSiSubmit, loadOtroSiList, deleteOtroSi, openVariosModal, closeVariosModal, handleVariosSubmit, loadVariosList, deleteVarios, renderInteractiveDocumentCards, loadProjectDocuments } from './ui/documents.js';
import { openMainModal, closeMainModal } from './ui/modals.js';

// Exponer a window para mantener compatibilidad total con HTML y sub-módulos
window.normalizeString = normalizeString;
window.resizeImage = resizeImage;
window.loadFaceAPImodels = loadFaceAPImodels;
window.generateProfileFaceDescriptor = generateProfileFaceDescriptor;
window.formatTimeAgo = formatTimeAgo;
window.fetchMunicipalities = fetchMunicipalities;
window.loadScript = loadScript;
window.getRoleDefaultPermissions = getRoleDefaultPermissions;
window.applySidebarPermissions = applySidebarPermissions;
window.closeSidebar = closeSidebar;
window.showView = showView;

function navigateToView(viewName, fromHistory = false) {
    if (!viewName) return;
    
    // Normalizar alias comunes de vistas
    if (viewName === 'paymentHistory') viewName = 'payment-history-view';
    if (viewName === 'empleadoDetails') viewName = 'empleado-details';
    if (viewName === 'proyecto-detalle') viewName = 'project-details';
    if (viewName === 'corteDetails') viewName = 'corte-details';

    // 1. Mostrar la vista
    if (typeof window.showView === 'function') {
        window.showView(viewName, fromHistory);
    }

    // 2. Cargar/actualizar datos correspondientes del módulo al cambiar de vista
    if (viewName === 'proyectos') {
        if (typeof window.loadProjects === 'function') window.loadProjects('active');
    } else if (viewName === 'tareas') {
        if (typeof window.loadTasksView === 'function') window.loadTasksView();
    } else if (viewName === 'herramienta') {
        if (typeof window.resetToolViewAndLoad === 'function') window.resetToolViewAndLoad();
    } else if (viewName === 'dotacion') {
        if (typeof window.loadDotacionView === 'function') window.loadDotacionView();
    } else if (viewName === 'cartera') {
        if (typeof window.loadCarteraView === 'function') window.loadCarteraView();
    } else if (viewName === 'cotizaciones') {
        if (typeof window.loadCotizacionesView === 'function') window.loadCotizacionesView();
    } else if (viewName === 'solicitud') {
        if (typeof window.loadSolicitudesView === 'function') window.loadSolicitudesView();
    } else if (viewName === 'empleados') {
        if (typeof window.loadEmpleadosView === 'function') window.loadEmpleadosView();
    } else if (viewName === 'proveedores') {
        if (typeof window.loadProveedoresView === 'function') window.loadProveedoresView();
    } else if (viewName === 'catalog') {
        if (typeof window.loadCatalogView === 'function') window.loadCatalogView();
    } else if (viewName === 'compras') {
        if (typeof window.loadComprasView === 'function') window.loadComprasView();
    } else if (viewName === 'reports') {
        if (typeof window.loadReportsView === 'function') window.loadReportsView();
    } else if (viewName === 'adminPanel') {
        if (typeof window.loadUsers === 'function') window.loadUsers('active');
    } else if (viewName === 'dashboard-general') {
        if (typeof window.showGeneralDashboard === 'function') window.showGeneralDashboard();
    } else if (viewName === 'configuracion') {
        if (typeof window.loadConfiguracionView === 'function') window.loadConfiguracionView();
    }
}
window.navigateToView = navigateToView;

window.addEventListener('popstate', (event) => {
    const hash = window.location.hash ? window.location.hash.substring(1) : '';
    if (hash) {
        window.navigateToView(hash, true);
    } else {
        window.navigateToView('dashboard-general', true);
    }
});
window.initializePushNotifications = initializePushNotifications;
window.updatePermissionUI = updatePermissionUI;
window.requestCameraPermission = requestCameraPermission;
window.requestLocationPermission = requestLocationPermission;
window.requestPushPermission = requestPushPermission;
window.checkAllPermissionsOnLogin = checkAllPermissionsOnLogin;
window.SIDEBAR_CONFIG = SIDEBAR_CONFIG;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleLogout = handleLogout;
window.showAuthView = showAuthView;
window.isRegistering = isRegistering;
window.openCameraModal = openCameraModal;
window.closeCameraModal = closeCameraModal;
window.capturePhoto = capturePhoto;
window.handlePhotoFile = handlePhotoFile;
window.openDocumentsModal = openDocumentsModal;
window.closeDocumentsModal = closeDocumentsModal;
window.isMobileDevice = isMobileDevice;
window.viewDocument = viewDocument;
window.openDocumentViewerModal = openDocumentViewerModal;
window.closeDocumentViewerModal = closeDocumentViewerModal;
window.uploadProjectDocument = uploadProjectDocument;
window.deleteProjectDocument = deleteProjectDocument;
window.subirDocumento = subirDocumento;
window.setupDocumentos = setupDocumentos;
window.openOtroSiModal = openOtroSiModal;
window.closeOtroSiModal = closeOtroSiModal;
window.handleOtroSiSubmit = handleOtroSiSubmit;
window.loadOtroSiList = loadOtroSiList;
window.deleteOtroSi = deleteOtroSi;
window.openVariosModal = openVariosModal;
window.closeVariosModal = closeVariosModal;
window.handleVariosSubmit = handleVariosSubmit;
window.loadVariosList = loadVariosList;
window.deleteVarios = deleteVarios;
window.renderInteractiveDocumentCards = renderInteractiveDocumentCards;
window.loadProjectDocuments = loadProjectDocuments;
window.openMainModal = openMainModal;
window.closeMainModal = closeMainModal;

// --- NUEVOS MÓDULOS MODULARIZADOS (OLA 6) ---
import { loadItems, fetchMoreItems, renderSortedItems, createItemRow, createItem, updateItem, deleteItem, showSubItems, loadSubItems, createSubItemRow, updateSubItem, exportProjectToPDF, handleDeletePhoto } from './ui/project-items.js';
import { initFormHandlers } from './ui/form-handlers.js';
import { initClickHandlers } from './ui/click-handlers.js';

window.loadItems = loadItems;
window.fetchMoreItems = fetchMoreItems;
window.renderSortedItems = renderSortedItems;
window.createItemRow = createItemRow;
window.createItem = createItem;
window.updateItem = updateItem;
window.deleteItem = deleteItem;
window.showSubItems = showSubItems;
window.loadSubItems = loadSubItems;
window.createSubItemRow = createSubItemRow;
window.updateSubItem = updateSubItem;
window.exportProjectToPDF = exportProjectToPDF;
window.handleDeletePhoto = handleDeletePhoto;

// Importamos funciones operativas de Firebase
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateEmail, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, writeBatch, getDocs, arrayUnion, orderBy, runTransaction, collectionGroup, increment, limit, serverTimestamp, arrayRemove, documentId } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { getToken, onMessage } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging.js";
`;

    const loadersCode = `// --- DYNAMIC MODULE VARIABLES AND LOADERS ---
let initDotacion, loadDotacionView, updateDotacionFilterOptions, loadDotacionAsignaciones;
let initHerramientas, resetToolViewAndLoad, updateToolFilterOptions, TOOL_CATEGORIES;
let initDashboard, showGeneralDashboard;
let initEmpleados, loadEmpleadosView, showEmpleadoDetails, loadPaymentHistoryView;
let initConfiguracion, loadConfiguracionView;
let initCartera, loadCarteraView;
let initSolicitudes, loadSolicitudesView;
let handleReportEntry;
let initCotizaciones, loadCotizacionesView;
let initInformes, loadInformesView;
let initProyectos, loadProjects, createProject, deleteProject, archiveProject, restoreProject;
let initProyectoDetalles, showProjectDetails, switchProjectTab, calculateItemUnitPrice, calculateItemTotal, calculateProjectContractedValue;
let initCatalogo, loadCatalogView, fetchMoreCatalogItems;
let initCortes, loadCortes, setupCorteSelection, generateCorte, closeCorteSelectionView, approveCorte, denyCorte, showCorteDetails, exportCorteToPDF, cleanupCortesSubscription;
let initProveedores, loadProveedoresView, loadSupplierDetailsView, findLastPurchasePrice, currentSupplierId;
let initCompras, loadComprasView, validatePoDateRange, openPurchaseOrderModal, closePurchaseOrderModal;
let initUsuarios, loadUsers;
let initTareas, openNewTaskModal, openEditTaskModal, openProgressModal, completeTask, openMultipleProgressModal;

let modulesLoadedPromise = null;
async function ensureModulesLoaded() {
    if (modulesLoadedPromise) return modulesLoadedPromise;

    console.log("Iniciando carga de módulos bajo demanda...");
    modulesLoadedPromise = (async () => {
        try {
            const [
                dotacion, herramientas, dashboard, empleados, configuracion, cartera, solicitudes,
                ingresopersonal, cotizaciones, informes, proyectos, proyectoDetalles, catalogo,
                cortes, proveedores, compras, usuarios, tareas
            ] = await Promise.all([
                import('./modules/dotacion.js'),
                import('./modules/herramientas.js'),
                import('./modules/dashboard.js'),
                import('./modules/empleados.js'),
                import('./modules/configuracion.js'),
                import('./modules/cartera.js'),
                import('./modules/solicitudes.js'),
                import('./modules/ingresopersonal.js'),
                import('./modules/cotizaciones.js'),
                import('./modules/informes.js'),
                import('./modules/proyectos.js'),
                import('./modules/proyecto-detalles.js'),
                import('./modules/catalogo.js'),
                import('./modules/cortes.js'),
                import('./modules/proveedores.js'),
                import('./modules/compras.js'),
                import('./modules/usuarios.js'),
                import('./modules/tareas.js')
            ]);

            // Asignamos las variables destructuradas
            ({ initDotacion, loadDotacionView, updateDotacionFilterOptions, loadDotacionAsignaciones } = dotacion);
            ({ initHerramientas, resetToolViewAndLoad, updateToolFilterOptions, TOOL_CATEGORIES } = herramientas);
            ({ initDashboard, showGeneralDashboard } = dashboard);
            ({ initEmpleados, loadEmpleadosView, showEmpleadoDetails, loadPaymentHistoryView } = empleados);
            ({ initConfiguracion, loadConfiguracionView } = configuracion);
            ({ initCartera, loadCarteraView } = cartera);
            ({ initSolicitudes, loadSolicitudesView } = solicitudes);
            ({ handleReportEntry } = ingresopersonal);
            ({ initCotizaciones, loadCotizacionesView } = cotizaciones);
            ({ initInformes, loadInformesView } = informes);
            ({ initProyectos, loadProjects, createProject, deleteProject, archiveProject, restoreProject } = proyectos);
            ({ initProyectoDetalles, showProjectDetails, switchProjectTab, calculateItemUnitPrice, calculateItemTotal, calculateProjectContractedValue } = proyectoDetalles);
            ({ initCatalogo, loadCatalogView, fetchMoreCatalogItems } = catalogo);
            ({ initCortes, loadCortes, setupCorteSelection, generateCorte, closeCorteSelectionView, approveCorte, denyCorte, showCorteDetails, exportCorteToPDF, cleanupCortesSubscription } = cortes);
            ({ initProveedores, loadProveedoresView, loadSupplierDetailsView, findLastPurchasePrice, currentSupplierId } = proveedores);
            ({ initCompras, loadComprasView, validatePoDateRange, openPurchaseOrderModal, closePurchaseOrderModal } = compras);
            ({ initUsuarios, loadUsers } = usuarios);
            ({ initTareas, openNewTaskModal, openEditTaskModal, openProgressModal, completeTask, openMultipleProgressModal } = tareas);

            // Exponer a window para compatibilidad
            window.loadDotacionView = loadDotacionView;
            window.loadDotacionAsignaciones = loadDotacionAsignaciones;
            window.showGeneralDashboard = showGeneralDashboard;
            window.loadEmpleadosView = loadEmpleadosView;
            window.showEmpleadoDetails = showEmpleadoDetails;
            window.loadPaymentHistoryView = loadPaymentHistoryView;
            window.handleReportEntry = handleReportEntry;
            window.loadCarteraView = loadCarteraView;
            window.loadConfiguracionView = loadConfiguracionView;
            window.loadCotizacionesView = loadCotizacionesView;
            window.loadReportsView = loadInformesView;
            window.loadProjects = loadProjects;
            window.createProject = createProject;
            window.deleteProject = deleteProject;
            window.archiveProject = archiveProject;
            window.restoreProject = restoreProject;
            window.showProjectDetails = showProjectDetails;
            window.switchProjectTab = switchProjectTab;
            window.calculateItemUnitPrice = calculateItemUnitPrice;
            window.calculateItemTotal = calculateItemTotal;
            window.calculateProjectContractedValue = calculateProjectContractedValue;
            window.loadCatalogView = loadCatalogView;
            window.loadCortes = loadCortes;
            window.exportCorteToPDF = exportCorteToPDF;
            window.cleanupCortesSubscription = cleanupCortesSubscription;
            window.loadProveedoresView = loadProveedoresView;
            window.loadSupplierDetailsView = loadSupplierDetailsView;
            window.loadComprasView = loadComprasView;
            window.loadUsers = loadUsers;
            window.openNewTaskModal = openNewTaskModal;
            window.openEditTaskModal = openEditTaskModal;
            window.openProgressModal = openProgressModal;
            window.completeTask = completeTask;
            window.openMultipleProgressModal = openMultipleProgressModal;

            console.log("Todos los módulos de la aplicación se han cargado correctamente.");
        } catch (error) {
            console.error("Error al cargar los módulos dinámicos:", error);
            modulesLoadedPromise = null;
            throw error;
        }
    })();

    return modulesLoadedPromise;
}

window.ensureXLSX = async function() {
    if (window.XLSX) return window.XLSX;
    console.log("Cargando XLSX...");
    await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    return window.XLSX;
};

window.ensurePDF = async function() {
    if (window.jspdf && window.jspdf.API && window.jspdf.API.autoTable) return window.jspdf;
    console.log("Cargando jsPDF...");
    await loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
    await loadScript("https://cdn.jsdelivr.net/npm/jspdf-autotable@3.5.23/dist/jspdf.plugin.autotable.min.js");
    return window.jspdf;
};

window.ensureHtml2Pdf = async function() {
    if (window.html2pdf) return window.html2pdf;
    console.log("Cargando html2pdf...");
    await loadScript("https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js");
    return window.html2pdf;
};

window.ensureHeic2Any = async function() {
    if (window.heic2any) return window.heic2any;
    console.log("Cargando heic2any...");
    await loadScript("https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js");
    return window.heic2any;
};

window.ensureLeaflet = async function() {
    if (window.L) return window.L;
    console.log("Cargando Leaflet...");
    await loadScript("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js");
    return window.L;
};

window.ensureJSZip = async function() {
    if (window.JSZip) return window.JSZip;
    console.log("Cargando JSZip...");
    await loadScript("js/vendor/jszip.min.js");
    return window.JSZip;
};

window.ensureFileSaver = async function() {
    if (window.saveAs) return window.saveAs;
    console.log("Cargando FileSaver...");
    await loadScript("js/vendor/FileSaver.min.js");
    return window.saveAs;
};

window.ensureChart = async function() {
    if (window.Chart) return window.Chart;
    console.log("Cargando Chart.js...");
    await loadScript("https://cdn.jsdelivr.net/npm/chart.js");
    return window.Chart;
};

window.ensureChoices = async function() {
    if (window.Choices) return window.Choices;
    console.log("Cargando Choices.js...");
    await loadScript("https://cdn.jsdelivr.net/npm/choices.js/public/assets/scripts/choices.min.js");
    return window.Choices;
};
`;

    const stateVariables = `// --- CONFIGURACIÓN Y ESTADO DE LA APP ---
let unsubscribeTasks = null;
let unsubscribeReports = null;
let unsubscribeInventory = null;
let unsubscribeStock = null;
let unsubscribeMaterialRequests = null;
const materialStatusListeners = new Map();
const taskCommentListeners = new Map();
let materialRequestReturnContext = { view: 'proyectos' };
let currentCorte = null;
let unsubscribePeopleOfInterest = null;
let unsubscribePayments = null;
let activeListeners = [];
let currentUser = null;
let currentUserRole = null;
let processedPhotoFile = null;
let usersMap = new Map();
let payrollConfig = null;
let selectedProjectId = null;
let currentProject = null;
let currentItem = null;
let unsubscribeProjects = null;
let unsubscribeItems = null;
let unsubscribeSubItems = null;
let itemSortState = { key: 'name', direction: 'asc' };
let currentItemsData = [];
let onSafetyCheckInSuccess = () => { };
let videoStream = null;
let verifiedCanvas = null;
let pendingProfileUpdateData = null;
let lastVisibleItemDoc = null;
let isFetchingItems = false;
const ITEMS_PER_PAGE = 20;
let views = {};

// --- BINDINGS DE ESTADO DINÁMICOS PARA WINDOW ---
Object.defineProperty(window, 'currentUser', { get: () => currentUser, set: (val) => { currentUser = val; } });
Object.defineProperty(window, 'currentUserRole', { get: () => currentUserRole, set: (val) => { currentUserRole = val; } });
Object.defineProperty(window, 'currentProject', { get: () => currentProject, set: (val) => { currentProject = val; } });
Object.defineProperty(window, 'currentItem', { get: () => currentItem, set: (val) => { currentItem = val; } });
Object.defineProperty(window, 'usersMap', { get: () => usersMap, set: (val) => { usersMap = val; } });
Object.defineProperty(window, 'payrollConfig', { get: () => payrollConfig, set: (val) => { payrollConfig = val; } });
Object.defineProperty(window, 'materialRequestReturnContext', { get: () => materialRequestReturnContext, set: (val) => { materialRequestReturnContext = val; } });
Object.defineProperty(window, 'itemSortState', { get: () => itemSortState, set: (val) => { itemSortState = val; } });
Object.defineProperty(window, 'lastVisibleItemDoc', { get: () => lastVisibleItemDoc, set: (val) => { lastVisibleItemDoc = val; } });
Object.defineProperty(window, 'isFetchingItems', { get: () => isFetchingItems, set: (val) => { isFetchingItems = val; } });
Object.defineProperty(window, 'unsubscribeItems', { get: () => unsubscribeItems, set: (val) => { unsubscribeItems = val; } });
Object.defineProperty(window, 'unsubscribeSubItems', { get: () => unsubscribeSubItems, set: (val) => { unsubscribeSubItems = val; } });
Object.defineProperty(window, 'unsubscribeTasks', { get: () => unsubscribeTasks, set: (val) => { unsubscribeTasks = val; } });
Object.defineProperty(window, 'onSafetyCheckInSuccess', { get: () => onSafetyCheckInSuccess, set: (val) => { onSafetyCheckInSuccess = val; } });
Object.defineProperty(window, 'videoStream', { get: () => videoStream, set: (val) => { videoStream = val; } });
Object.defineProperty(window, 'verifiedCanvas', { get: () => verifiedCanvas, set: (val) => { verifiedCanvas = val; } });
Object.defineProperty(window, 'pendingProfileUpdateData', { get: () => pendingProfileUpdateData, set: (val) => { pendingProfileUpdateData = val; } });
Object.defineProperty(window, 'processedPhotoFile', { get: () => processedPhotoFile, set: (val) => { processedPhotoFile = val; } });
`;

    // List of core functions to extract and keep
    const functionsToKeep = [
        'loadProfileHistory',
        'showDashboard',
        'openConfirmModal',
        'closeConfirmModal',
        'openImageModal',
        'closeImageModal',
        'openRegisterSuccessModal',
        'closeRegisterSuccessModal',
        'timeAgoFormat',
        'loadNotifications',
        'setupCurrencyInput',
        'loadPeopleOfInterest',
        'closeRequestDetailsModal',
        'setupAddMaterialButton',
        'setupRequestItemSearch',
        'resetMaterialRequestForm',
        'loadTasksView',
        'loadAndDisplayTasks',
        'createTaskCard',
        'closeTaskDetailsModal',
        'loadTaskMaterialStatus',
        'initThemeToggle',
        'numeroALetras',
        'openImportModal',
        'generateMaterialTemplate',
        'importMaterialsFromExcel',
        'loadReportsView',
        'getCompanyData',
        'registerSupplierPayment',
        'loadUsersMap'
    ];

    let extractedCode = '\n// --- FUNCIONES LÓGICAS CORE --- \n';
    for (const name of functionsToKeep) {
        const body = extractFunction(content, name);
        if (body) {
            extractedCode += `\n${body}\nwindow.${name} = ${name};\n`;
        } else {
            console.warn(`Could not extract function: ${name}`);
        }
    }

    // Extract auth state listener
    const onAuthRegex = /onAuthStateChanged\s*\(\s*auth\s*,\s*async\s*\(user\)\s*=>\s*\{/g;
    const authMatch = onAuthRegex.exec(content);
    let authListenerCode = '';
    if (authMatch) {
        const startIdx = authMatch.index;
        let braceCount = 0;
        let foundStart = false;
        let endIdx = -1;
        for (let i = startIdx; i < content.length; i++) {
            if (content[i] === '{') {
                braceCount++;
                foundStart = true;
            } else if (content[i] === '}') {
                braceCount--;
                if (foundStart && braceCount === 0) {
                    endIdx = i;
                    break;
                }
            }
        }
        if (endIdx !== -1) {
            authListenerCode = `\n${content.substring(startIdx, endIdx + 1)}\n`;
        }
    }

    // Reconstruct the DOMContentLoaded event listener (General UI, no monolithic clics/submits)
    const domLoadedRegex = /document\.addEventListener\(\s*['"]DOMContentLoaded['"]\s*,\s*\(\)\s*=>\s*\{/g;
    const domLoadedMatch = domLoadedRegex.exec(content);
    let domLoadedCode = '';
    if (domLoadedMatch) {
        const startIdx = domLoadedMatch.index;
        let braceCount = 0;
        let foundStart = false;
        let endIdx = -1;
        for (let i = startIdx; i < content.length; i++) {
            if (content[i] === '{') {
                braceCount++;
                foundStart = true;
            } else if (content[i] === '}') {
                braceCount--;
                if (foundStart && braceCount === 0) {
                    endIdx = i;
                    break;
                }
            }
        }
        if (endIdx !== -1) {
            domLoadedCode = `\n${content.substring(startIdx, endIdx + 1)}\n`;
        }
    }

    // Custom initializeAllModules definition
    const initAllModulesCode = `
let modulesInitialized = false;
function initializeAllModules() {
    if (modulesInitialized) return;
    modulesInitialized = true;

    console.log("Inicializando todos los módulos de la aplicación...");

    initHerramientas(
        db,
        storage,
        openMainModal,
        closeMainModal,
        openConfirmModal,
        null,
        openImageModal,
        () => currentUser,
        () => usersMap,
        () => currentUserRole
    );

    initProyectos(
        db, 
        functions, 
        () => currentUser, 
        () => currentUserRole
    );

    initTareas(db, storage, {
        showView: showView,
        closeMainModal: closeMainModal,
        openConfirmModal: openConfirmModal,
        getCurrentUser: () => currentUser,
        getCurrentProject: () => currentProject,
        getUsersMap: () => usersMap,
        loadTasksView: () => loadTasksView()
    });

    initProyectoDetalles(db, {
        showView: showView,
        setCurrentProject: (proj) => { currentProject = proj; },
        setReturnContext: (ctx) => { materialRequestReturnContext = ctx; },
        formatCurrency: (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val),
        openTaskDetailsModal: (typeof openTaskDetailsModal !== 'undefined' ? openTaskDetailsModal : null),
        loaders: {
            loadItems: loadItems,
            loadMaterialsTab: (projectId) => { console.log('loadMaterialsTab'); },
            loadCortes: loadCortes,
            loadPayments: (projectId) => { console.log('loadPayments'); },
            loadPeopleOfInterest: loadPeopleOfInterest,
            renderInteractiveDocumentCards: renderInteractiveDocumentCards
        }
    });

    initCortes(db, {
        formatCurrency: (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val),
        getCurrentProject: () => currentProject,
        showView: showView,
        openConfirmModal: openConfirmModal,
        calculateItemTotal: calculateItemTotal,
        calculateProjectContractedValue: calculateProjectContractedValue,
        getUsersMap: () => usersMap
    });

    initProveedores(db, {
        showView: showView,
        formatCurrency: (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val)
    });

    initCompras(db, {
        formatCurrency: (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val),
        getCurrentUserRole: () => currentUserRole
    });

    initCatalogo(db);

    initDotacion(
        db,
        storage,
        openMainModal,
        closeMainModal,
        openConfirmModal,
        null,
        openImageModal,
        () => currentUser,
        () => usersMap,
        () => currentUserRole
    );

    initDashboard(
        db,
        showView,
        () => usersMap,
        () => currentUserRole,
        () => currentUser ? currentUser.uid : null
    );

    initUsuarios(db, {
        openMainModal: openMainModal,
        openConfirmModal: openConfirmModal
    });

    initInformes(db);

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
        setupCurrencyInput
    );

    initCartera(db, showView);

    initConfiguracion(db, setupCurrencyInput);

    initCotizaciones(db, storage, showView, currentUser);

    initSolicitudes(db, showView, currentUserRole, usersMap, openMainModal);

    // --- INICIALIZACIÓN DE FORM HANDLERS Y CLICK HANDLERS UNIFICADOS (OLA 6) ---
    initFormHandlers();
    initClickHandlers();
}
window.initializeAllModules = initializeAllModules;
`;

    // 7. Assemble the final modular app.js
    let finalContent = ``;
    finalContent += header;
    finalContent += loadersCode;
    finalContent += stateVariables;
    finalContent += extractedCode;
    finalContent += authListenerCode;
    finalContent += initAllModulesCode;
    finalContent += domLoadedCode;

    // Remove any leftover document.body click listener inside DOMContentLoaded
    const clickRegex = /document\.body\.addEventListener\(\s*['"]click['"]\s*,\s*async\s*\(e\)\s*=>\s*\{/;
    const clickMatch = clickRegex.exec(finalContent);
    if (clickMatch) {
        const startIdx = clickMatch.index;
        let braceCount = 0;
        let foundStart = false;
        let endIdx = -1;
        for (let i = startIdx; i < finalContent.length; i++) {
            if (finalContent[i] === '{') {
                braceCount++;
                foundStart = true;
            } else if (finalContent[i] === '}') {
                braceCount--;
                if (foundStart && braceCount === 0) {
                    endIdx = i;
                    break;
                }
            }
        }
        if (endIdx !== -1) {
            const fullClickBlock = finalContent.substring(startIdx, endIdx + 1);
            finalContent = finalContent.replace(fullClickBlock, `// --- EL MANEJADOR DE CLICS DELEGADOS FUE MODULARIZADO A click-handlers.js ---`);
        }
    }

    // Remove any leftover modalForm submit listener inside DOMContentLoaded
    const submitRegex = /modalForm\.addEventListener\(\s*['"]submit['"]\s*,\s*async\s*\(e\)\s*=>\s*\{/;
    const submitMatch = submitRegex.exec(finalContent);
    if (submitMatch) {
        const startIdx = submitMatch.index;
        let braceCount = 0;
        let foundStart = false;
        let endIdx = -1;
        for (let i = startIdx; i < finalContent.length; i++) {
            if (finalContent[i] === '{') {
                braceCount++;
                foundStart = true;
            } else if (finalContent[i] === '}') {
                braceCount--;
                if (foundStart && braceCount === 0) {
                    endIdx = i;
                    break;
                }
            }
        }
        if (endIdx !== -1) {
            const fullSubmitBlock = finalContent.substring(startIdx, endIdx + 1);
            finalContent = finalContent.replace(fullSubmitBlock, `// --- EL MANEJADOR DE ENVIOS DE FORMULARIO FUE MODULARIZADO A form-handlers.js ---`);
        }
    }

    fs.writeFileSync(outputFile, finalContent);
    console.log(`Rebuild complete! Reconstructed app.js size: ${finalContent.length} chars, ${finalContent.split('\n').length} lines.`);
}

runRebuild();
