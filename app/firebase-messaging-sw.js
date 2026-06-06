// EN app/firebase-messaging-sw.js

const SW_VERSION = 'v1.2.7'; // Versión del Service Worker para forzar actualizaciones y evitar cachés obsoletas
const CACHE_NAME = `vidrios-exito-cache-${SW_VERSION}`;

// Recursos principales que se descargan inmediatamente en la instalación para carga instantánea
const PRECACHE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './css/output.css',
    './css/all.min.css',
    './js/app.js',
    './js/core/firebase-config.js',
    './js/core/utils.js',
    './js/core/permissions.js',
    './js/core/auth.js',
    './js/ui/camera.js',
    './js/ui/documents.js',
    './js/ui/modals.js',
    './js/ui/project-items.js',
    './js/ui/form-handlers.js',
    './js/ui/click-handlers.js',
    './js/modules/dashboard.js',
    './js/modules/tareas.js',
    './recursos/logo.png',
    './recursos/logove.png',
    './webfonts/fa-brands-400.woff2',
    './webfonts/fa-regular-400.woff2',
    './webfonts/fa-solid-900.woff2',
    './webfonts/fa-v4compatibility.woff2',
    'https://cdn.jsdelivr.net/npm/choices.js@10.2.0/public/assets/styles/choices.min.css',
    'https://cdn.jsdelivr.net/npm/choices.js@10.2.0/public/assets/scripts/choices.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
    'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js',
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=60&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1497366216548-37526070297c?q=60&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=60&w=1000&auto=format&fit=crop'
];

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// Evento de Instalación: Fuerza al Service Worker a activarse inmediatamente y precarga recursos
self.addEventListener('install', (event) => {
    console.log(`[Service Worker] Instalando versión: ${SW_VERSION}`);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(async (cache) => {
                console.log('[Service Worker] Precachando recursos principales...');
                // Intentamos precachar en lote; si falla, precachamos uno por uno para guardar los disponibles
                try {
                    await cache.addAll(PRECACHE_ASSETS);
                } catch (e) {
                    console.warn('[Service Worker] Error en precarga masiva, reintentando de forma individual:', e);
                    for (const asset of PRECACHE_ASSETS) {
                        try {
                            await cache.add(asset);
                        } catch (singleErr) {
                            console.error(`[Service Worker] Falló precarga de: ${asset}`, singleErr);
                        }
                    }
                }
            })
            .then(() => {
                console.log('[Service Worker] Recursos principales precachados correctamente.');
                return self.skipWaiting();
            })
            .catch((err) => {
                console.error('[Service Worker] Error al precachar recursos principales:', err);
                return self.skipWaiting();
            })
    );
});

// --- 1. CONFIGURACIÓN DE FIREBASE (Para Notificaciones) ---
const firebaseConfig = {
    apiKey: "AIzaSyC693QE-O4rdx6qPcZRyvgZUwSWDofBFWw",
    authDomain: "vidriosexitoorganizador.firebaseapp.com",
    projectId: "vidriosexitoorganizador",
    storageBucket: "vidriosexitoorganizador.firebasestorage.app",
    messagingSenderId: "872898185887",
    appId: "1:872898185887:web:0a6a8c209527a19c2ff0aa",
    measurementId: "G-DMVHCCV44M"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Manejador de notificaciones en segundo plano
messaging.onBackgroundMessage((payload) => {
  console.log('[Service Worker] Notificación en segundo plano:', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/app/recursos/logo.png',
    data: payload.data
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Manejar clic en la notificación
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    const urlToOpen = event.notification.data?.url || '/app/'; 
    event.waitUntil(
        clients.matchAll({type: 'window', includeUncontrolled: true}).then(function(windowClients) {
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                if (client.url.includes('App') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(urlToOpen);
        })
    );
});

// --- 2. OPTIMIZACIÓN DE CACHÉ DE ARCHIVOS ESTÁTICOS ---
// Usamos una estrategia Stale-While-Revalidate para archivos estáticos
// para lograr una carga casi instantánea en dispositivos móviles,
// mientras que las APIs dinámicas (Firestore, Auth, Functions) se saltan la caché.

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    try {
        const url = new URL(event.request.url);

        // Excluir llamadas de Firebase Auth, Firestore, Cloud Functions y otros endpoints de base de datos
        if (
            url.hostname.includes('firestore.googleapis.com') ||
            url.hostname.includes('identitytoolkit.googleapis.com') ||
            url.hostname.includes('securetoken.googleapis.com') ||
            url.pathname.includes('/__/auth/') ||
            url.pathname.includes('firebase-messaging-sw.js')
        ) {
            return;
        }

        // Interceptar archivos estáticos: HTML, CSS, JS, fuentes, imágenes, CDNs
        const isStaticAsset = 
            url.pathname.endsWith('.html') || 
            url.pathname.endsWith('.css') || 
            url.pathname.endsWith('.js') || 
            url.pathname.endsWith('.png') || 
            url.pathname.endsWith('.jpg') || 
            url.pathname.endsWith('.jpeg') || 
            url.pathname.endsWith('.svg') || 
            url.pathname.endsWith('.ico') || 
            url.pathname.endsWith('.json') || // manifest.json
            url.pathname.endsWith('.woff') || 
            url.pathname.endsWith('.woff2') || 
            url.pathname.endsWith('.ttf') || 
            url.pathname.includes('/css/') ||
            url.pathname.includes('/js/') ||
            url.pathname.includes('/recursos/') ||
            url.pathname.includes('/models/') ||
            url.hostname.includes('cdn.jsdelivr.net') ||
            url.hostname.includes('unpkg.com') ||
            url.hostname.includes('kit.fontawesome.com') ||
            url.hostname.includes('fonts.googleapis.com') ||
            url.hostname.includes('fonts.gstatic.com') ||
            url.hostname.includes('images.unsplash.com');

        const isAppPath = 
            url.pathname === '/' || 
            url.pathname === '/index.html' || 
            url.pathname === '/app/' || 
            url.pathname === '/app/index.html';

        if (isStaticAsset || isAppPath) {
            event.respondWith(
                caches.open(CACHE_NAME).then((cache) => {
                    return cache.match(event.request).then((cachedResponse) => {
                        // Construir la petición de red. Si es un archivo JS/CSS propio de nuestra app,
                        // le agregamos un parámetro de consulta de versión para evadir la caché HTTP de cPanel.
                        let fetchRequest = event.request;
                        if (url.origin === location.origin && 
                            !url.pathname.includes('firebase-messaging-sw.js') &&
                            (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))
                        ) {
                            const newUrl = new URL(event.request.url);
                            newUrl.searchParams.set('sw-bypass', SW_VERSION);
                            fetchRequest = new Request(newUrl.toString(), {
                                method: event.request.method,
                                headers: event.request.headers,
                                credentials: event.request.credentials,
                                mode: event.request.mode === 'navigate' ? 'same-origin' : event.request.mode,
                                redirect: event.request.redirect
                            });
                        }

                        const fetchPromise = fetch(fetchRequest).then((networkResponse) => {
                            if (networkResponse.status === 200) {
                                cache.put(event.request, networkResponse.clone());
                            }
                            return networkResponse;
                        }).catch((err) => {
                            console.warn('[Service Worker] Falló red al actualizar caché:', err);
                        });
                        
                        // Retornar la versión en caché inmediatamente si existe, si no esperar a la red
                        return cachedResponse || fetchPromise;
                    });
                })
            );
        }
    } catch (e) {
        console.error('[Service Worker] Error en fetch handler:', e);
    }
});

// Evento de Activación: Se encarga de purgar por completo cualquier caché antigua de archivos y reclamar control
self.addEventListener('activate', (event) => {
    console.log(`[Service Worker] Activando versión: ${SW_VERSION}`);
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[Service Worker] Purgando caché de archivos antigua para liberar espacio:', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    self.clients.claim();
});