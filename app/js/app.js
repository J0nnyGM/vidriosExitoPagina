import { db, auth, storage, messaging, functions, VAPID_KEY } from './core/firebase-config.js';

// --- CORE & UI MODULAR IMPORTS (OLA 5 & 6) ---
import { normalizeString, resizeImage, loadFaceAPImodels, generateProfileFaceDescriptor, formatTimeAgo, fetchMunicipalities, loadScript, timeAgoFormat, numeroALetras, registerSupplierPayment, setupCurrencyInput, loadPeopleOfInterest, initThemeToggle } from './core/utils.js';
import { getRoleDefaultPermissions, applySidebarPermissions, closeSidebar, showView, initializePushNotifications, updatePermissionUI, requestCameraPermission, requestLocationPermission, requestPushPermission, checkAllPermissionsOnLogin, SIDEBAR_CONFIG, loadNotifications } from './core/permissions.js';
import { handleLogin, handleRegister, handleLogout, showAuthView, isRegistering, setIsRegistering } from './core/auth.js';
import { openCameraModal, closeCameraModal, capturePhoto, handlePhotoFile } from './ui/camera.js';
import { openDocumentsModal, closeDocumentsModal, isMobileDevice, viewDocument, openDocumentViewerModal, closeDocumentViewerModal, uploadProjectDocument, deleteProjectDocument, subirDocumento, setupDocumentos, openOtroSiModal, closeOtroSiModal, handleOtroSiSubmit, loadOtroSiList, deleteOtroSi, openVariosModal, closeVariosModal, handleVariosSubmit, loadVariosList, deleteVarios, renderInteractiveDocumentCards, loadProjectDocuments } from './ui/documents.js';
import { openMainModal, closeMainModal, openConfirmModal, closeConfirmModal, openImageModal, closeImageModal, openRegisterSuccessModal, closeRegisterSuccessModal } from './ui/modals.js';
import { loadItems, fetchMoreItems, renderSortedItems, createItemRow, createItem, updateItem, deleteItem, showSubItems, loadSubItems, createSubItemRow, updateSubItem, exportProjectToPDF, handleDeletePhoto } from './ui/project-items.js';
import { initFormHandlers } from './ui/form-handlers.js';
import { initClickHandlers } from './ui/click-handlers.js';

// Expose core utils and permission tools to window for HTML compat
window.normalizeString = normalizeString;
window.resizeImage = resizeImage;
window.loadFaceAPImodels = loadFaceAPImodels;
window.generateProfileFaceDescriptor = generateProfileFaceDescriptor;
window.formatTimeAgo = formatTimeAgo;
window.fetchMunicipalities = fetchMunicipalities;
window.loadScript = loadScript;
window.timeAgoFormat = timeAgoFormat;
window.numeroALetras = numeroALetras;
window.registerSupplierPayment = registerSupplierPayment;
window.setupCurrencyInput = setupCurrencyInput;
window.loadPeopleOfInterest = loadPeopleOfInterest;
window.initThemeToggle = initThemeToggle;

window.getRoleDefaultPermissions = getRoleDefaultPermissions;
window.applySidebarPermissions = applySidebarPermissions;
window.closeSidebar = closeSidebar;
window.showView = showView;

async function navigateToView(viewName, fromHistory = false) {
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

    // Si la vista requiere módulos diferidos y aún no se han cargado, esperamos a la carga de fondo
    const requiresBackground = [
        'proyectos', 'herramienta', 'dotacion', 'cartera', 'cotizaciones', 
        'solicitud', 'empleados', 'proveedores', 'catalog', 'compras', 
        'reports', 'despiece', 'adminPanel', 'configuracion'
    ];
    if (requiresBackground.includes(viewName) && window.backgroundModulesPromise) {
        await window.backgroundModulesPromise;
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
    } else if (viewName === 'despiece') {
        if (typeof window.setupDespieceEvents === 'function') window.setupDespieceEvents();
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
window.loadNotifications = loadNotifications;

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
window.openConfirmModal = openConfirmModal;
window.closeConfirmModal = closeConfirmModal;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.openRegisterSuccessModal = openRegisterSuccessModal;
window.closeRegisterSuccessModal = closeRegisterSuccessModal;

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

// Import dynamic Firebase operations
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { doc, getDoc, addDoc, collection, query, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// --- DYNAMIC MODULE VARIABLES AND LOADERS ---
let initDotacion, loadDotacionView, updateDotacionFilterOptions, loadDotacionAsignaciones;
let initHerramientas, resetToolViewAndLoad, updateToolFilterOptions, TOOL_CATEGORIES;
let initDashboard, showGeneralDashboard;
let initEmpleados, loadEmpleadosView, showEmpleadoDetails, loadPaymentHistoryView;
let initConfiguracion, loadConfiguracionView;
let initCartera, loadCarteraView;
let initSolicitudes, loadSolicitudesView, closeRequestDetailsModal, setupAddMaterialButton, setupRequestItemSearch, resetMaterialRequestForm, handleViewRequestDetails, handleOpenDeliveryModal, showMaterialRequestView;
let handleReportEntry;
let initCotizaciones, loadCotizacionesView;
let initInformes, loadInformesView, loadReportsView, getCompanyData;
let initProyectos, loadProjects, createProject, deleteProject, archiveProject, restoreProject;
let initProyectoDetalles, showProjectDetails, switchProjectTab, calculateItemUnitPrice, calculateItemTotal, calculateProjectContractedValue;
let initCatalogo, loadCatalogView, fetchMoreCatalogItems, openImportModal, generateMaterialTemplate, importMaterialsFromExcel;
let initCortes, loadCortes, setupCorteSelection, generateCorte, closeCorteSelectionView, approveCorte, denyCorte, showCorteDetails, exportCorteToPDF, cleanupCortesSubscription;
let initProveedores, loadProveedoresView, loadSupplierDetailsView, findLastPurchasePrice, currentSupplierId;
let initCompras, loadComprasView, validatePoDateRange, openPurchaseOrderModal, closePurchaseOrderModal;
let initUsuarios, loadUsers;
let initTareas, openNewTaskModal, openEditTaskModal, openProgressModal, completeTask, openMultipleProgressModal, loadTasksView, loadAndDisplayTasks, createTaskCard, closeTaskDetailsModal, loadTaskMaterialStatus, openTaskDetailsModal, openSafetyCheckInModal, checkIfSafetyCheckInNeeded;
let setupDespieceEvents;

let modulesLoadedPromise = null;
async function ensureModulesLoaded(role) {
    if (modulesLoadedPromise) return modulesLoadedPromise;

    console.log(`Iniciando carga de módulos críticos para el rol: ${role || 'desconocido'}...`);
    modulesLoadedPromise = (async () => {
        try {
            await window.ensureChoices();

            const permissions = getRoleDefaultPermissions(role || 'operario');

            // FASE 1: Módulos Críticos para el inicio de la aplicación
            const criticalToLoad = {
                dashboard: './modules/dashboard.js',
                tareas: './modules/tareas.js',
                ingresopersonal: './modules/ingresopersonal.js'
            };

            const criticalPromises = Object.entries(criticalToLoad).map(async ([key, path]) => {
                const mod = await import(path);
                return { key, mod };
            });

            const criticalResults = await Promise.all(criticalPromises);
            const loadedCritical = {};
            criticalResults.forEach(({ key, mod }) => {
                loadedCritical[key] = mod;
            });

            // Asignación de variables locales de Fase 1
            if (loadedCritical.dashboard) ({ initDashboard, showGeneralDashboard } = loadedCritical.dashboard);
            if (loadedCritical.tareas) ({ initTareas, openNewTaskModal, openEditTaskModal, openProgressModal, completeTask, openMultipleProgressModal, loadTasksView, loadAndDisplayTasks, createTaskCard, closeTaskDetailsModal, loadTaskMaterialStatus, openTaskDetailsModal, openSafetyCheckInModal, checkIfSafetyCheckInNeeded } = loadedCritical.tareas);
            if (loadedCritical.ingresopersonal) ({ handleReportEntry } = loadedCritical.ingresopersonal);

            // Exponer a window Fase 1
            window.showGeneralDashboard = showGeneralDashboard;
            window.handleReportEntry = handleReportEntry;
            window.loadTasksView = loadTasksView;
            window.loadAndDisplayTasks = loadAndDisplayTasks;
            window.openTaskDetailsModal = openTaskDetailsModal;
            window.openSafetyCheckInModal = openSafetyCheckInModal;
            window.checkIfSafetyCheckInNeeded = checkIfSafetyCheckInNeeded;

            window.openNewTaskModal = openNewTaskModal;
            window.openEditTaskModal = openEditTaskModal;
            window.openProgressModal = openProgressModal;
            window.completeTask = completeTask;
            window.openMultipleProgressModal = openMultipleProgressModal;
            window.createTaskCard = createTaskCard;
            window.closeTaskDetailsModal = closeTaskDetailsModal;
            window.loadTaskMaterialStatus = loadTaskMaterialStatus;

            // FASE 2: Módulos Secundarios (Carga en segundo plano, no bloquea el loading-overlay)
            const secondaryToLoad = {
                dotacion: { path: './modules/dotacion.js', test: permissions.dotacion },
                herramientas: { path: './modules/herramientas.js', test: permissions.herramienta },
                empleados: { path: './modules/empleados.js', test: permissions.empleados },
                configuracion: { path: './modules/configuracion.js', test: permissions.configuracion },
                cartera: { path: './modules/cartera.js', test: permissions.cartera },
                solicitudes: { path: './modules/solicitudes.js', test: permissions.solicitud },
                cotizaciones: { path: './modules/cotizaciones.js', test: permissions.cotizaciones },
                informes: { path: './modules/informes.js', test: permissions.reports },
                proyectos: { path: './modules/proyectos.js', test: permissions.proyectos },
                proyectoDetalles: { path: './modules/proyecto-detalles.js', test: permissions.proyectos },
                catalogo: { path: './modules/catalogo.js', test: permissions.catalog },
                cortes: { path: './modules/cortes.js', test: permissions.proyectos },
                proveedores: { path: './modules/proveedores.js', test: permissions.proveedores },
                compras: { path: './modules/compras.js', test: permissions.compras },
                usuarios: { path: './modules/usuarios.js', test: permissions.adminPanel },
                despiece: { path: './modules/despiece2d.js', test: permissions.despiece }
            };

            window.backgroundModulesPromise = (async () => {
                console.log("Iniciando carga de módulos secundarios en segundo plano...");
                try {
                    const secPromises = [];
                    const secKeys = [];
                    for (const [key, modInfo] of Object.entries(secondaryToLoad)) {
                        if (modInfo.test) {
                            secPromises.push(import(modInfo.path));
                            secKeys.push(key);
                        }
                    }

                    const secResults = await Promise.all(secPromises);
                    const loadedSec = {};
                    secKeys.forEach((key, idx) => {
                        loadedSec[key] = secResults[idx];
                    });

                    // Inicialización / Asignación de variables locales de Fase 2
                    if (loadedSec.dotacion) ({ initDotacion, loadDotacionView, updateDotacionFilterOptions, loadDotacionAsignaciones } = loadedSec.dotacion);
                    if (loadedSec.herramientas) ({ initHerramientas, resetToolViewAndLoad, updateToolFilterOptions, TOOL_CATEGORIES } = loadedSec.herramientas);
                    if (loadedSec.empleados) ({ initEmpleados, loadEmpleadosView, showEmpleadoDetails, loadPaymentHistoryView } = loadedSec.empleados);
                    if (loadedSec.configuracion) ({ initConfiguracion, loadConfiguracionView } = loadedSec.configuracion);
                    if (loadedSec.cartera) ({ initCartera, loadCarteraView } = loadedSec.cartera);
                    if (loadedSec.solicitudes) ({ initSolicitudes, loadSolicitudesView, closeRequestDetailsModal, setupAddMaterialButton, setupRequestItemSearch, resetMaterialRequestForm, handleViewRequestDetails, handleOpenDeliveryModal, showMaterialRequestView } = loadedSec.solicitudes);
                    if (loadedSec.cotizaciones) ({ initCotizaciones, loadCotizacionesView } = loadedSec.cotizaciones);
                    if (loadedSec.informes) ({ initInformes, loadInformesView, loadReportsView, getCompanyData } = loadedSec.informes);
                    if (loadedSec.proyectos) ({ initProyectos, loadProjects, createProject, deleteProject, archiveProject, restoreProject } = loadedSec.proyectos);
                    if (loadedSec.proyectoDetalles) ({ initProyectoDetalles, showProjectDetails, switchProjectTab, calculateItemUnitPrice, calculateItemTotal, calculateProjectContractedValue } = loadedSec.proyectoDetalles);
                    if (loadedSec.catalogo) ({ initCatalogo, loadCatalogView, fetchMoreCatalogItems, openImportModal, generateMaterialTemplate, importMaterialsFromExcel } = loadedSec.catalogo);
                    if (loadedSec.cortes) ({ initCortes, loadCortes, setupCorteSelection, generateCorte, closeCorteSelectionView, approveCorte, denyCorte, showCorteDetails, exportCorteToPDF, cleanupCortesSubscription } = loadedSec.cortes);
                    if (loadedSec.proveedores) ({ initProveedores, loadProveedoresView, loadSupplierDetailsView, findLastPurchasePrice, currentSupplierId } = loadedSec.proveedores);
                    if (loadedSec.compras) ({ initCompras, loadComprasView, validatePoDateRange, openPurchaseOrderModal, closePurchaseOrderModal } = loadedSec.compras);
                    if (loadedSec.usuarios) ({ initUsuarios, loadUsers } = loadedSec.usuarios);
                    if (loadedSec.despiece) ({ setupDespieceEvents } = loadedSec.despiece);

                    // Exponer a window Fase 2
                    window.loadDotacionView = loadDotacionView;
                    window.resetToolViewAndLoad = resetToolViewAndLoad;
                    window.loadDotacionAsignaciones = loadDotacionAsignaciones;
                    window.loadEmpleadosView = loadEmpleadosView;
                    window.showEmpleadoDetails = showEmpleadoDetails;
                    window.loadPaymentHistoryView = loadPaymentHistoryView;
                    window.loadCarteraView = loadCarteraView;
                    window.loadConfiguracionView = loadConfiguracionView;
                    window.loadCotizacionesView = loadCotizacionesView;
                    
                    window.closeRequestDetailsModal = closeRequestDetailsModal;
                    window.setupAddMaterialButton = setupAddMaterialButton;
                    window.setupRequestItemSearch = setupRequestItemSearch;
                    window.resetMaterialRequestForm = resetMaterialRequestForm;
                    window.openRequestDetailsModal = handleViewRequestDetails;
                    window.openDeliveryModal = handleOpenDeliveryModal;
                    window.showMaterialRequestView = showMaterialRequestView;
                    window.loadSolicitudesView = loadSolicitudesView;

                    window.openImportModal = openImportModal;
                    window.generateMaterialTemplate = generateMaterialTemplate;
                    window.importMaterialsFromExcel = importMaterialsFromExcel;
                    window.loadCatalogView = loadCatalogView;

                    window.loadReportsView = loadReportsView;
                    window.getCompanyData = getCompanyData;

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

                    window.loadCortes = loadCortes;
                    window.setupCorteSelection = setupCorteSelection;
                    window.generateCorte = generateCorte;
                    window.closeCorteSelectionView = closeCorteSelectionView;
                    window.approveCorte = approveCorte;
                    window.denyCorte = denyCorte;
                    window.showCorteDetails = showCorteDetails;
                    window.exportCorteToPDF = exportCorteToPDF;
                    window.cleanupCortesSubscription = cleanupCortesSubscription;

                    window.loadProveedoresView = loadProveedoresView;
                    window.loadSupplierDetailsView = loadSupplierDetailsView;
                    window.findLastPurchasePrice = findLastPurchasePrice;
                    window.currentSupplierId = currentSupplierId;

                    window.loadComprasView = loadComprasView;
                    window.validatePoDateRange = validatePoDateRange;
                    window.openPurchaseOrderModal = openPurchaseOrderModal;
                    window.closePurchaseOrderModal = closePurchaseOrderModal;

                    window.loadUsers = loadUsers;
                    window.setupDespieceEvents = setupDespieceEvents;

                    // Inicializar los módulos de Fase 2
                    if (typeof initDotacion === 'function') initDotacion(db, storage, openMainModal, closeMainModal, openConfirmModal, null, openImageModal, () => currentUser, () => usersMap, () => currentUserRole);
                    if (typeof initHerramientas === 'function') initHerramientas(db, storage, openMainModal, closeMainModal, openConfirmModal, null, openImageModal, () => currentUser, () => usersMap, () => currentUserRole);
                    if (typeof initEmpleados === 'function') initEmpleados(db, () => usersMap, () => currentUserRole, showView, storage, openConfirmModal, (userId, containerId) => loadDotacionAsignaciones(userId, containerId), () => payrollConfig, () => currentUser ? currentUser.uid : null, setupCurrencyInput);
                    if (typeof initConfiguracion === 'function') initConfiguracion(db, setupCurrencyInput);
                    if (typeof initCartera === 'function') initCartera(db, showView);
                    if (typeof initSolicitudes === 'function') initSolicitudes(db, showView, currentUserRole, usersMap, openMainModal);
                    if (typeof initCotizaciones === 'function') initCotizaciones(db, storage, showView, currentUser);
                    if (typeof initInformes === 'function') initInformes(db);
                    if (typeof initProyectos === 'function') initProyectos(db, functions, () => currentUser, () => currentUserRole);
                    if (typeof initProyectoDetalles === 'function') initProyectoDetalles(db, { showView, setCurrentProject: (proj) => { currentProject = proj; }, setReturnContext: (ctx) => { materialRequestReturnContext = ctx; }, formatCurrency: (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val), openTaskDetailsModal: (typeof openTaskDetailsModal !== 'undefined' ? openTaskDetailsModal : null), loaders: { loadItems, loadMaterialsTab: (projectId) => { console.log('loadMaterialsTab'); }, loadCortes, loadPayments: (projectId) => { console.log('loadPayments'); }, loadPeopleOfInterest, renderInteractiveDocumentCards } });
                    if (typeof initCortes === 'function') initCortes(db, { formatCurrency: (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val), getCurrentProject: () => currentProject, showView, openConfirmModal, calculateItemTotal, calculateProjectContractedValue, getUsersMap: () => usersMap });
                    if (typeof initProveedores === 'function') initProveedores(db, { showView, formatCurrency: (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val) });
                    if (typeof initCompras === 'function') initCompras(db, { formatCurrency: (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val), getCurrentUserRole: () => currentUserRole });
                    if (typeof initCatalogo === 'function') initCatalogo(db);
                    if (typeof initUsuarios === 'function') initUsuarios(db, { openMainModal, openConfirmModal });

                    console.log("✅ Módulos en segundo plano cargados e inicializados.");
                } catch (err) {
                    console.error("❌ Error en la carga de fondo:", err);
                }
            })();

            console.log("Módulos esenciales del inicio cargados e inyectados.");
        } catch (error) {
            console.error("Error al cargar los módulos dinámicos esenciales:", error);
            modulesLoadedPromise = null;
            throw error;
        }
    })();

    return modulesLoadedPromise;
}

// Global script helpers
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
    await loadScript("https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js");
    return window.Chart;
};

window.ensureChoices = async function() {
    if (window.Choices) return window.Choices;
    console.log("Cargando Choices.js...");
    await loadScript("https://cdn.jsdelivr.net/npm/choices.js@10.2.0/public/assets/scripts/choices.min.js");
    return window.Choices;
};

// --- CONFIGURACIÓN Y ESTADO DE LA APP ---
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
let currentUserFaceDescriptor = null;
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
let views = {
    'dashboard-general': document.getElementById('dashboard-general-view'),
    proyectos: document.getElementById('dashboard-view'),
    tareas: document.getElementById('tareas-view'),
    herramienta: document.getElementById('herramienta-view'),
    dotacion: document.getElementById('dotacion-view'),
    'cartera': document.getElementById('cartera-view'),
    cotizaciones: document.getElementById('cotizaciones-view'),
    'cotizacion-detalle': document.getElementById('cotizacion-detalle-view'),
    solicitud: document.getElementById('solicitud-view'),
    empleados: document.getElementById('empleados-view'),
    'empleado-details': document.getElementById('empleado-details-view'),
    'payment-history-view': document.getElementById('payment-history-view'),
    'configuracion': document.getElementById('configuracion-view'),
    proveedores: document.getElementById('proveedores-view'),
    supplierDetails: document.getElementById('supplier-details-view'),
    adminPanel: document.getElementById('admin-panel-view'),
    'project-details': document.getElementById('project-details-view'),
    subItems: document.getElementById('sub-items-view'),
    corteDetails: document.getElementById('corte-details-view'),
    catalog: document.getElementById('catalog-view'),
    compras: document.getElementById('compras-view'),
    reports: document.getElementById('reports-view'),
    'material-request-view': document.getElementById('material-request-view'),
    despiece: document.getElementById('view-despiece'),
};

// --- BINDINGS DE ESTADO DINÁMICOS PARA WINDOW ---
Object.defineProperty(window, 'views', { get: () => views, set: (val) => { views = val; } });
Object.defineProperty(window, 'materialStatusListeners', { get: () => materialStatusListeners });
Object.defineProperty(window, 'taskCommentListeners', { get: () => taskCommentListeners });
Object.defineProperty(window, 'currentUser', { get: () => currentUser, set: (val) => { currentUser = val; } });
Object.defineProperty(window, 'currentUserRole', { get: () => currentUserRole, set: (val) => { currentUserRole = val; } });
Object.defineProperty(window, 'currentUserFaceDescriptor', { get: () => currentUserFaceDescriptor, set: (val) => { currentUserFaceDescriptor = val; } });
Object.defineProperty(window, 'currentProject', { get: () => currentProject, set: (val) => { currentProject = val; } });
Object.defineProperty(window, 'currentItem', { get: () => currentItem, set: (val) => { currentItem = val; } });
Object.defineProperty(window, 'usersMap', { get: () => usersMap, set: (val) => { usersMap = val; } });
Object.defineProperty(window, 'activeListeners', { get: () => activeListeners, set: (val) => { activeListeners = val; } });
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

// --- LÓGICA DE INICIO GENERAL ---
async function loadUsersMap() {
    try {
        const usersQuery = query(collection(db, "users"));
        const snapshot = await getDocs(usersQuery);
        usersMap.clear();
        snapshot.forEach(doc => {
            usersMap.set(doc.id, doc.data());
        });
        console.log("UsersMap loaded successfully.");
    } catch (e) {
        console.error("Error loading usersMap:", e);
    }
}
window.loadUsersMap = loadUsersMap;

function loadProfileHistory(userId) {
    console.log("loadProfileHistory loaded for:", userId);
}
window.loadProfileHistory = loadProfileHistory;

function showDashboard() {
    console.log("showDashboard loaded.");
}
window.showDashboard = showDashboard;

let modulesInitialized = false;
function initializeAllModules() {
    if (modulesInitialized) return;
    modulesInitialized = true;

    console.log("Inicializando módulos cargados del rol...");

    if (typeof initHerramientas === 'function') {
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
    }

    if (typeof initProyectos === 'function') {
        initProyectos(
            db, 
            functions, 
            () => currentUser, 
            () => currentUserRole
        );
    }

    if (typeof initTareas === 'function') {
        initTareas(db, storage, {
            showView: showView,
            closeMainModal: closeMainModal,
            openConfirmModal: openConfirmModal,
            getCurrentUser: () => currentUser,
            getCurrentProject: () => currentProject,
            getUsersMap: () => usersMap,
            loadTasksView: () => loadTasksView()
        });
    }

    if (typeof initProyectoDetalles === 'function') {
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
    }

    if (typeof initCortes === 'function') {
        initCortes(db, {
            formatCurrency: (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val),
            getCurrentProject: () => currentProject,
            showView: showView,
            openConfirmModal: openConfirmModal,
            calculateItemTotal: calculateItemTotal,
            calculateProjectContractedValue: calculateProjectContractedValue,
            getUsersMap: () => usersMap
        });
    }

    if (typeof initProveedores === 'function') {
        initProveedores(db, {
            showView: showView,
            formatCurrency: (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val)
        });
    }

    if (typeof initCompras === 'function') {
        initCompras(db, {
            formatCurrency: (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val),
            getCurrentUserRole: () => currentUserRole
        });
    }

    if (typeof initCatalogo === 'function') {
        initCatalogo(db);
    }

    if (typeof initDotacion === 'function') {
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
    }

    if (typeof initDashboard === 'function') {
        initDashboard(
            db,
            showView,
            () => usersMap,
            () => currentUserRole,
            () => currentUser ? currentUser.uid : null
        );
    }

    if (typeof initUsuarios === 'function') {
        initUsuarios(db, {
            openMainModal: openMainModal,
            openConfirmModal: openConfirmModal
        });
    }

    if (typeof initInformes === 'function') {
        initInformes(db);
    }

    if (typeof initEmpleados === 'function') {
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
    }

    if (typeof initCartera === 'function') {
        initCartera(db, showView);
    }

    if (typeof initConfiguracion === 'function') {
        initConfiguracion(db, setupCurrencyInput);
    }

    if (typeof initCotizaciones === 'function') {
        initCotizaciones(db, storage, showView, currentUser);
    }

    if (typeof initSolicitudes === 'function') {
        initSolicitudes(db, showView, currentUserRole, usersMap, openMainModal);
    }

    // --- INITIALIZE FORM AND CLICK LISTENERS ---
    initFormHandlers();
    initClickHandlers();
}
window.initializeAllModules = initializeAllModules;

// HTML elements references
const authContainer = document.getElementById('auth-container') || document.getElementById('auth-view') || document.getElementById('login-view');
const appContainer = document.getElementById('app-container') || document.getElementById('app-view');
const loadingOverlay = document.getElementById('loading-overlay') || { classList: { add: () => {} } };

onAuthStateChanged(auth, async (user) => {
    try {
        if (isRegistering) {
            console.log("Registro en proceso, onAuthStateChanged en pausa...");
            return;
        }

        if (user) {
            const userDoc = await getDoc(doc(db, "users", user.uid));

            if (userDoc.exists() && userDoc.data().status === 'active') {
                currentUser = user;
                const userData = userDoc.data();
                currentUserRole = userData.role;

                // 1. CARGA DINÁMICA DE MÓDULOS OBLIGATORIA POST-LOGIN (OLA 6 HACK)
                await ensureModulesLoaded(currentUserRole);
                initializeAllModules();

                // 2. Cargar mapa de usuarios (en segundo plano, no bloqueante)
                loadUsersMap();

                // --- UI HEADER ACTUALIZACIÓN ---
                const nombre = userData.firstName || 'Usuario';
                const apellido = userData.lastName || '';
                const rolFormateado = currentUserRole.charAt(0).toUpperCase() + currentUserRole.slice(1);
                const profilePhotoURL = userData.profilePhotoURL || null;
                const initials = `${nombre.charAt(0)}${apellido.charAt(0) || ''}`.toUpperCase();

                const nameEl = document.getElementById('header-user-name');
                const roleEl = document.getElementById('header-user-role');
                const photoEl = document.getElementById('header-profile-photo');
                const initialsEl = document.getElementById('header-profile-initials');

                const mobileNameEl = document.getElementById('mobile-user-name');
                const mobileEmailEl = document.getElementById('mobile-user-email');

                if (nameEl) nameEl.textContent = `${nombre} ${apellido}`;
                if (roleEl) roleEl.textContent = rolFormateado;
                if (mobileNameEl) mobileNameEl.textContent = `${nombre} ${apellido}`;
                if (mobileEmailEl) mobileEmailEl.textContent = userData.email;

                if (photoEl && initialsEl) {
                    if (profilePhotoURL) {
                        photoEl.src = profilePhotoURL;
                        photoEl.classList.remove('hidden');
                        initialsEl.classList.add('hidden');
                        if (photoEl.parentElement) photoEl.parentElement.classList.remove('bg-gray-200');
                    } else {
                        photoEl.classList.add('hidden');
                        initialsEl.textContent = initials;
                        initialsEl.classList.remove('hidden');
                        if (photoEl.parentElement) photoEl.parentElement.classList.add('bg-gray-200');
                    }
                }

                // 3. Generar descriptor facial (en segundo plano, no bloqueante)
                if (profilePhotoURL) {
                    generateProfileFaceDescriptor(profilePhotoURL)
                        .then(descriptor => {
                            currentUserFaceDescriptor = descriptor;
                        })
                        .catch(e => {
                            console.warn("No se pudo generar descriptor facial en segundo plano:", e);
                            currentUserFaceDescriptor = null;
                        });
                } else {
                    currentUserFaceDescriptor = null;
                }

                authContainer.classList.add('hidden');
                appContainer.classList.remove('hidden');

                // Cargar configuración de nómina (en segundo plano, no bloqueante)
                getDoc(doc(db, "system", "payrollConfig"))
                    .then(payrollConfigSnap => {
                        payrollConfig = payrollConfigSnap.exists() ? payrollConfigSnap.data() : {};
                    })
                    .catch(error => {
                        console.error("Error cargando nómina:", error);
                        payrollConfig = {};
                    });

                applySidebarPermissions(currentUserRole, userData.customPermissions || {});
                checkAllPermissionsOnLogin();

                // Cargar vista inicial según el hash de la URL o dashboard por defecto
                const initialHash = window.location.hash ? window.location.hash.substring(1) : '';
                if (initialHash && initialHash !== 'dashboard-general') {
                    window.navigateToView(initialHash);
                } else {
                    showGeneralDashboard();
                }
                loadNotifications();

            } else {
                await signOut(auth);
            }
        } else {
            currentUser = null;
            currentUserRole = null;
            authContainer.classList.remove('hidden');
            appContainer.classList.add('hidden');
        }
    } catch (error) {
        console.error("Error crítico en onAuthStateChanged:", error);
        authContainer.classList.remove('hidden');
        appContainer.classList.add('hidden');
    } finally {
        loadingOverlay.classList.add('hidden');
    }
});

window.forceApplicationHardReset = async function() {
    console.log('[App] Iniciando hard reset de la aplicación...');
    
    // 1. Mostrar pantalla de actualización visible
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.innerHTML = `
            <div class="flex flex-col items-center justify-center p-6 text-center">
                <div class="loader mb-6"></div>
                <h3 class="text-xl font-bold text-slate-800 mb-2">Instalando nueva versión...</h3>
                <p class="text-sm text-slate-500 max-w-sm">Limpiando la caché y reconstruyendo los datos locales para asegurar un rendimiento óptimo.</p>
            </div>
        `;
        loadingOverlay.classList.remove('hidden');
    }

    try {
        // 2. Limpiar todos los cachés del navegador (Cache Storage)
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
            console.log('[App] Todos los Cache Storage han sido purgados.');
        }

        // 3. Eliminar Service Workers antiguos
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(r => r.unregister()));
            console.log('[App] Todos los Service Workers han sido desregistrados.');
        }

        // 4. Limpiar LocalStorage y SessionStorage
        localStorage.clear();
        sessionStorage.clear();
        console.log('[App] LocalStorage y SessionStorage han sido vaciados.');

        // 5. Pequeña espera visual y recarga dura de la página
        setTimeout(() => {
            window.location.reload(true);
        }, 1200);

    } catch (error) {
        console.error('[App] Error durante el hard reset:', error);
        // Recargar de todos modos
        window.location.reload(true);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // Registrar Service Worker para PWA (Aspecto nativo de aplicación y carga instantánea)
    if ('serviceWorker' in navigator) {
        // Recargar automáticamente la aplicación para aplicar actualizaciones en caliente
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                refreshing = true;
                console.log('[App] Detectado nuevo Service Worker. Recargando para aplicar cambios...');
                window.location.reload();
            }
        });

        const registerSW = () => {
            navigator.serviceWorker.register('./firebase-messaging-sw.js?v=1.3.2')
                .then(reg => {
                    console.log('[App] Service Worker PWA registrado con éxito en el ámbito:', reg.scope);
                    
                    // Detectar actualizaciones automáticas de forma agresiva
                    reg.onupdatefound = () => {
                        const installingWorker = reg.installing;
                        if (installingWorker) {
                            installingWorker.onstatechange = () => {
                                if (installingWorker.state === 'installed') {
                                    if (navigator.serviceWorker.controller) {
                                        console.log('[App] Nueva versión disponible. Iniciando actualización agresiva...');
                                        window.forceApplicationHardReset();
                                    }
                                }
                            };
                        }
                    };
                })
                .catch(err => {
                    console.error('[App] Error al registrar Service Worker PWA:', err);
                });
        };
        
        if (document.readyState === 'complete') {
            registerSW();
        } else {
            window.addEventListener('load', registerSW);
        }
    }

    // Initialize theme toggle
    initThemeToggle();

    // --- MÉTODOS DE AUTENTICACIÓN Y NAVEGACIÓN DE LOGIN ---
    document.getElementById('login-form')?.addEventListener('submit', handleLogin);
    document.getElementById('register-form')?.addEventListener('submit', handleRegister);
    document.getElementById('show-register')?.addEventListener('click', (e) => {
        e.preventDefault();
        showAuthView('register');
    });
    document.getElementById('show-login')?.addEventListener('click', (e) => {
        e.preventDefault();
        showAuthView('login');
    });
    document.getElementById('back-to-login')?.addEventListener('click', (e) => {
        e.preventDefault();
        showAuthView('login');
    });



    // Load FaceAPI models on demand is deferred to post-login or request phase

    document.getElementById('po-details-close-btn')?.addEventListener('click', () => {
        if (typeof closePurchaseOrderModal === 'function') closePurchaseOrderModal();
    });
    document.getElementById('po-details-cancel-btn')?.addEventListener('click', () => {
        if (typeof closePurchaseOrderModal === 'function') closePurchaseOrderModal();
    });

    // Setup lost password view listeners
    const loginViewLinks = document.getElementById('login-view')?.querySelectorAll('a');
    if (loginViewLinks) {
        loginViewLinks.forEach(link => {
            if (link.textContent.includes('Olvidaste') || link.textContent.includes('contraseña')) {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    document.getElementById('login-view')?.classList.add('hidden');
                    document.getElementById('forgot-password-view')?.classList.remove('hidden');
                    const resetEmail = document.getElementById('reset-email');
                    if (resetEmail) resetEmail.value = '';
                    document.getElementById('reset-feedback')?.classList.add('hidden');
                });
            }
        });
    }

    document.getElementById('back-to-login-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('forgot-password-view')?.classList.add('hidden');
        document.getElementById('login-view')?.classList.remove('hidden');
    });

    document.getElementById('forgot-password-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('reset-email').value;
        const feedback = document.getElementById('reset-feedback');
        const submitBtn = e.target.querySelector('button[type="submit"]');

        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando...';

        try {
            await auth.sendPasswordResetEmail(email);
            feedback.textContent = 'Enlace de recuperación enviado. Revisa tu bandeja de entrada.';
            feedback.className = 'text-green-600 text-sm mt-2';
            feedback.classList.remove('hidden');
        } catch (error) {
            console.error(error);
            feedback.textContent = 'Error: ' + error.message;
            feedback.className = 'text-red-500 text-sm mt-2';
            feedback.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Enviar Enlace';
        }
    });
});

// --- SISTEMA DE NOTIFICACIONES (TOASTS) ---
window.showToast = function (message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return; // Salida de seguridad si no existe

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

    // Eliminar después de 3.5 segundos
    setTimeout(() => {
        toast.classList.add('translate-x-10', 'opacity-0');
        setTimeout(() => toast.remove(), 300); // Esperar a que termine la transición
    }, 3500);
};

// --- SISTEMA DE AUDITORÍA (LOGS) ---
window.logAuditAction = async function (action, description, targetId, previousData = null, newData = null) {
    try {
        const user = auth.currentUser;
        if (!user) return;

        // Consultar datos del admin actual para guardar su nombre
        const adminSnap = await getDoc(doc(db, "users", user.uid));
        const adminName = adminSnap.exists() ? `${adminSnap.data().firstName} ${adminSnap.data().lastName}` : user.email;

        await addDoc(collection(db, "audit_logs"), {
            action: action,           // Ej: "Eliminar Pago"
            description: description, // Ej: "Se eliminó el pago de $500.000"
            targetId: targetId,       // ID del empleado afectado
            adminId: user.uid,
            adminName: adminName,
            createdAt: new Date(),
            previousData: previousData,
            newData: newData
        });
    } catch (e) {
        console.error("Error al registrar acción de auditoría:", e);
    }
};
