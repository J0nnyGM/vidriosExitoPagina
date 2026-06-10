// js/core/permissions.js

import { messaging, db, VAPID_KEY } from './firebase-config.js';
import { doc, updateDoc, query, collection, where, onSnapshot, getDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { getToken } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging.js";

// --- CONFIGURACIÓN DE MÓDULOS DEL SIDEBAR ---
export const SIDEBAR_CONFIG = [
    { key: 'dashboard', selector: '#dashboard-general-nav-link', label: 'Dashboard General' },
    { key: 'proyectos', selector: '#proyectos-nav-link', label: 'Proyectos' },
    { key: 'tareas', selector: 'a[data-view="tareas"]', label: 'Tareas Asignadas' },
    { key: 'herramienta', selector: 'a[data-view="herramienta"]', label: 'Herramienta' },
    { key: 'dotacion', selector: 'a[data-view="dotacion"]', label: 'Dotación' },
    { key: 'cartera', selector: 'a[data-view="cartera"]', label: 'Cartera' },
    { key: 'cotizaciones', selector: 'a[data-view="cotizaciones"]', label: 'Cotizaciones' },
    { key: 'solicitud', selector: 'a[data-view="solicitud"]', label: 'Solicitud Material' },
    { key: 'empleados', selector: 'a[data-view="empleados"]', label: 'Empleados' },
    { key: 'proveedores', selector: 'a[data-view="proveedores"]', label: 'Proveedores' },
    { key: 'catalog', selector: 'a[data-view="catalog"]', label: 'Catálogo Materiales' },
    { key: 'compras', selector: 'a[data-view="compras"]', label: 'Órdenes Compra' },
    { key: 'reports', selector: 'a[data-view="reports"]', label: 'Reportes' },
    { key: 'despiece', selector: 'a[data-view="despiece"]', label: 'Despiece 2D' },
    { key: 'adminPanel', selector: 'a[data-view="adminPanel"]', label: 'Gestionar Usuarios' },
    { key: 'configuracion', selector: '#configuracion-nav-link', label: 'Configuración' }
];

/**
 * Obtiene el mapa base de visibilidad según el rol.
 */
export function getRoleDefaultPermissions(role) {
    const isAdmin = role === 'admin';
    const isBodega = role === 'bodega';
    const isSST = role === 'sst';
    const isOperario = role === 'operario';
    const isNomina = role === 'nomina';

    return {
        dashboard: true,
        proyectos: isAdmin,
        tareas: true,
        herramienta: isAdmin || isBodega || isSST || isOperario,
        dotacion: isAdmin || isBodega || isSST || isOperario,
        cartera: isAdmin,
        cotizaciones: isAdmin,
        solicitud: isAdmin || isBodega || isSST,
        empleados: isAdmin || isSST || isNomina,
        proveedores: isAdmin || isBodega || isNomina,
        catalog: isAdmin || isBodega,
        compras: isAdmin || isBodega || isNomina,
        reports: isAdmin || isNomina,
        despiece: isAdmin,
        adminPanel: isAdmin,
        configuracion: isAdmin
    };
}

/**
 * Aplica los permisos de visibilidad visualmente al sidebar y al navbar móvil de la interfaz.
 */
export function applySidebarPermissions(role, customPermissions = {}) {
    const defaultVisibility = getRoleDefaultPermissions(role);

    SIDEBAR_CONFIG.forEach(module => {
        let shouldShow = defaultVisibility[module.key];

        if (customPermissions[module.key] === 'show') shouldShow = true;
        if (customPermissions[module.key] === 'hide') shouldShow = false;

        const viewValue = module.key === 'dashboard' ? 'dashboard-general' : module.key;

        // 1. Aplicar en Sidebar
        const sidebarElement = document.querySelector(`#sidebar [data-view="${viewValue}"]`) || document.querySelector(module.selector);
        if (sidebarElement) {
            if (shouldShow) {
                sidebarElement.classList.remove('hidden');
                if (sidebarElement.parentElement && sidebarElement.parentElement.tagName === 'LI') {
                    sidebarElement.parentElement.classList.remove('hidden');
                }
            } else {
                sidebarElement.classList.add('hidden');
                if (sidebarElement.parentElement && sidebarElement.parentElement.tagName === 'LI') {
                    sidebarElement.parentElement.classList.add('hidden');
                }
            }
        }

        // 2. Aplicar en Barra de navegación Móvil (Bottom Navbar)
        const mobileElement = document.querySelector(`#mobile-bottom-nav [data-view="${viewValue}"]`);
        if (mobileElement) {
            if (shouldShow) {
                mobileElement.classList.remove('hidden');
            } else {
                mobileElement.classList.add('hidden');
            }
        }
    });
}

/**
 * Colapsa el panel de menú lateral móvil (sidebar).
 */
export function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.add('-translate-x-full');
    }
    const overlay = document.getElementById('sidebar-overlay');
    if (overlay) {
        overlay.classList.remove('opacity-100', 'pointer-events-auto');
        overlay.classList.add('opacity-0', 'pointer-events-none');
    }
    
    // Sincronizar el icono de menú móvil y cabecera a su estado cerrado
    const mobileIcon = document.querySelector('#mobile-more-menu-btn i');
    const mobileSpan = document.querySelector('#mobile-more-menu-btn span');
    const mobileBtn = document.getElementById('mobile-more-menu-btn');
    const headerIcon = document.querySelector('#menu-toggle-btn i');

    if (mobileIcon) {
        mobileIcon.classList.remove('fa-xmark', 'rotate-90');
        mobileIcon.classList.add('fa-bars');
    }
    if (mobileSpan) {
        mobileSpan.textContent = 'Menú';
    }
    if (mobileBtn) {
        mobileBtn.classList.remove('text-blue-500', 'active');
    }
    if (headerIcon) {
        headerIcon.classList.remove('fa-xmark', 'rotate-90');
        headerIcon.classList.add('fa-bars');
    }
}

/**
 * Cambia la vista del aplicativo ocultando el resto y marcando la sección activa.
 */
export function showView(viewName, fromHistory = false) {
    // Normalizar alias comunes de vistas
    if (viewName === 'paymentHistory') viewName = 'payment-history-view';
    if (viewName === 'empleadoDetails') viewName = 'empleado-details';
    if (viewName === 'proyecto-detalle') viewName = 'project-details';
    if (viewName === 'corteDetails') viewName = 'corte-details';

    const role = window.currentUserRole;
    if (role) {
        const permissions = getRoleDefaultPermissions(role);
        
        let permissionKey = viewName;
        if (viewName === 'project-details' || viewName === 'subItems' || viewName === 'corte-details') {
            permissionKey = 'proyectos';
        } else if (viewName === 'empleado-details' || viewName === 'payment-history-view') {
            permissionKey = 'empleados';
        }

        if (permissions[permissionKey] === false) {
            console.warn(`Acceso denegado a la vista "${viewName}" (permiso: "${permissionKey}") para el rol "${role}". Redirigiendo al dashboard...`);
            if (viewName !== 'dashboard') {
                showView('dashboard', fromHistory);
            }
            return;
        }
    }

    const views = window.views || {};
    
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
        console.warn(`Advertencia: No se encontró la vista "${viewName}"`);
    }

    document.querySelectorAll('#main-nav .nav-link').forEach(link => {
        link.classList.remove('active');
        link.classList.remove('bg-slate-800', 'text-white');
        link.classList.add('text-slate-500');
    });

    const activeLink = document.querySelector(`#main-nav .nav-link[data-view="${viewName}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
        activeLink.classList.remove('text-slate-500');
        activeLink.classList.add('bg-slate-800', 'text-white');
        activeLink.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Sincronizar también el navbar inferior móvil
    document.querySelectorAll('.mobile-nav-link').forEach(link => {
        link.classList.remove('active');
    });
    const activeMobileLink = document.querySelector(`.mobile-nav-link[data-view="${viewName}"]`);
    if (activeMobileLink) {
        activeMobileLink.classList.add('active');
    }

    if (window.innerWidth < 768) {
        closeSidebar();
    }

    if (!fromHistory && viewName !== 'project-details' && viewName !== 'empleado-details') {
        const state = { viewName: viewName };
        const title = `Gestor - ${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`;
        if (history.state?.viewName !== viewName) {
            history.pushState(state, title, `#${viewName}`);
        }
    }
}

/**
 * Inicializa y registra el FCM Token para el usuario en Firestore.
 */
export async function initializePushNotifications(user) {
    try {
        if (!('Notification' in window) || !('serviceWorker' in navigator)) {
            console.warn("Este navegador no soporta notificaciones.");
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.warn("Permiso de notificaciones denegado.");
            return;
        }

        const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js?v=1.2.5');
        const token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: registration
        });

        if (token) {
            console.log("FCM Token obtenido:", token);
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

/**
 * Actualiza visualmente las tarjetas de estado de permisos en el panel.
 */
export async function updatePermissionUI() {
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

    const notifGranted = Notification.permission === 'granted';
    updateCard('notification', notifGranted);

    try {
        const camStatus = await navigator.permissions.query({ name: 'camera' });
        updateCard('camera', camStatus.state === 'granted');
    } catch (e) {}

    try {
        const locStatus = await navigator.permissions.query({ name: 'geolocation' });
        updateCard('location', locStatus.state === 'granted');
    } catch (e) {}
}

/**
 * Solicita acceso a la cámara.
 */
export async function requestCameraPermission() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop());
        updatePermissionUI();
    } catch (error) {
        alert("Permiso denegado. Por favor habilita la cámara en la configuración del navegador.");
    }
}

/**
 * Solicita acceso a la geolocalización.
 */
export function requestLocationPermission() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        () => { updatePermissionUI(); },
        () => { alert("Permiso denegado. Habilita la ubicación en el candado de la barra de dirección."); }
    );
}

/**
 * Solicita permiso para recibir notificaciones Push.
 */
export async function requestPushPermission(currentUser) {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        if (currentUser) initializePushNotifications(currentUser);
        updatePermissionUI();
    } else {
        alert("Permiso denegado. Habilita las notificaciones en el navegador.");
    }
}

/**
 * Audita y audita si falta algún permiso tras el login para disparar el modal.
 */
export async function checkAllPermissionsOnLogin(currentUser) {
    let missing = false;

    if (Notification.permission !== 'granted') missing = true;

    try {
        const camStatus = await navigator.permissions.query({ name: 'camera' });
        if (camStatus.state !== 'granted') missing = true;

        const locStatus = await navigator.permissions.query({ name: 'geolocation' });
        if (locStatus.state !== 'granted') missing = true;
    } catch (e) {
        missing = true;
    }

    if (missing) {
        if (window.openMainModal) window.openMainModal('check-permissions');
    } else {
        console.log("Todos los permisos están habilitados. Continuando.");
        if (currentUser) initializePushNotifications(currentUser);
    }
}


// --- EXTRACTION FROM APP.JS (OLA 6 MODULARIZATION) ---

export function loadNotifications() {
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
                    iconSvg = `<svg class="h-6 w-6 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l-4.293 1.293a1 1 0 101.414-1.414L11.414 10l1.293-1.293z" clip-rule="evenodd"></path></svg>`;
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

    // --- 2. LISTENERS DE FIRESTORE (Con depuración) ---
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
                            const btnView = document.getElementById('btn-view-pdf-alert');
                            if (btnView) {
                                btnView.onclick = () => {
                                    window.viewDocument(urgentAlert.photoURL, "Documento de Alerta");
                                };
                            }
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
                            window.openImageModal(urgentAlert.photoURL);
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

    if (window.activeListeners) {
        window.activeListeners.push(unsubscribePersonal, unsubscribeChannel);
    }

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
                    const loadingOverlay = document.getElementById('loading-overlay');
                    try {
                        if (loadingOverlay) loadingOverlay.classList.remove('hidden');
                        // 1. Cargar el proyecto (para el contexto)
                        const projectDoc = await getDoc(doc(db, "projects", projectId));
                        if (projectDoc.exists()) {
                            window.currentProject = { id: projectDoc.id, ...projectDoc.data() };
                        } else {
                            throw new Error("Proyecto no encontrado");
                        }

                        // 2. Cargar el ítem (para el contexto)
                        const itemDoc = await getDoc(doc(db, "projects", projectId, "items", itemId));
                        if (itemDoc.exists()) {
                            window.currentItem = { id: itemDoc.id, ...itemDoc.data() };
                        } else {
                            throw new Error("Ítem no encontrado");
                        }

                        // 3. Cargar el sub-ítem
                        const subItemRef = doc(db, "projects", projectId, "items", itemId, "subItems", subitemId);
                        const subItemSnap = await getDoc(subItemRef);

                        if (subItemSnap.exists()) {
                            // 4. ¡ABRIR LA VENTANA FLOTANTE!
                            if (typeof window.openProgressModal === 'function') {
                                window.openProgressModal(subItemSnap.data());
                            } else {
                                throw new Error("La función openProgressModal no está disponible.");
                            }
                        } else {
                            throw new Error("Sub-ítem no encontrado");
                        }
                    } catch (error) {
                        console.error("Error al navegar a sub-ítem desde notificación:", error);
                        alert(`No se pudo abrir el detalle del ítem: ${error.message}`);
                    } finally {
                        if (loadingOverlay) loadingOverlay.classList.add('hidden');
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
                if (typeof window.resetToolViewAndLoad === 'function') {
                    window.resetToolViewAndLoad();
                } else {
                    console.error("Error: window.resetToolViewAndLoad no está definido.");
                }
            }
            // --- INICIO DE NUEVA MODIFICACIÓN ---
            else if (link === '/dotacion') {
                console.log("DEBUG: Condición 'Dotación' cumplida.");
                showView('dotacion');
                if (typeof window.loadDotacionView === 'function') {
                    window.loadDotacionView(); // Carga la vista de dotación
                } else {
                    console.error("Error: window.loadDotacionView no está definido.");
                }
            }

            // Caso: Tarea (comentario o asignación)
            else if (projectId && taskId) {
                console.log("DEBUG: Condición 'Tarea' cumplida.");
                if (typeof window.showProjectDetails === 'function') {
                    window.showProjectDetails(null, projectId, taskId);
                } else {
                    console.error("Error: window.showProjectDetails no está definido.");
                }
            }
            // Caso: Solo Proyecto
            else if (projectId) {
                console.log("DEBUG: Condición 'Proyecto' cumplida.");
                if (typeof window.showProjectDetails === 'function') {
                    window.showProjectDetails(null, projectId);
                } else {
                    console.error("Error: window.showProjectDetails no está definido.");
                }
            } else {
                console.warn("DEBUG: Clic en notificación, pero ninguna condición de navegación se cumplió.");
            }
        }
    });
}

export function timeAgoFormat(date) {
    // 1. Manejo de 'null' (Latencia de serverTimestamp)
    // Si es null, significa que se acaba de crear y Firebase aún no devuelve la hora.
    if (!date) return "Ahora mismo";

    // 2. Si es Timestamp de Firestore, convertir a Date JS
    if (typeof date.toDate === 'function') {
        date = date.toDate();
    }

    // 3. Validación final: Si no es fecha válida, retornar string vacío (sin error)
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return "Hace un momento";
    }

    const now = new Date();
    const seconds = Math.round((now - date) / 1000);

    const minute = 60;
    const hour = minute * 60;
    const day = hour * 24;
    const week = day * 7;
    const month = day * 30;
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
