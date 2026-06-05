// EN app/firebase-messaging-sw.js

const SW_VERSION = 'v1.1.0'; // Versión del Service Worker para forzar actualizaciones y evitar cachés obsoletas
const CACHE_NAME = `vidrios-exito-cache-${SW_VERSION}`;

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// Evento de Instalación: Fuerza al Service Worker a activarse inmediatamente
self.addEventListener('install', (event) => {
    console.log(`[Service Worker] Instalando versión: ${SW_VERSION}`);
    self.skipWaiting();
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
            url.pathname.includes('/__/auth/')
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
            url.pathname.endsWith('.woff') || 
            url.pathname.endsWith('.woff2') || 
            url.pathname.endsWith('.ttf') || 
            url.pathname.includes('/css/') ||
            url.pathname.includes('/js/') ||
            url.pathname.includes('/recursos/') ||
            url.hostname.includes('cdn.jsdelivr.net') ||
            url.hostname.includes('unpkg.com') ||
            url.hostname.includes('kit.fontawesome.com') ||
            url.hostname.includes('fonts.googleapis.com') ||
            url.hostname.includes('fonts.gstatic.com');

        if (isStaticAsset || url.pathname === '/app/' || url.pathname === '/app/index.html') {
            event.respondWith(
                caches.open(CACHE_NAME).then((cache) => {
                    return cache.match(event.request).then((cachedResponse) => {
                        const fetchPromise = fetch(event.request).then((networkResponse) => {
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