// EN App/firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

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
    icon: '/recursos/LOGO PRISMA1.png',
    data: payload.data
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Manejar clic en la notificación
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    const urlToOpen = event.notification.data?.url || '/App/'; 
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

// --- 2. LÓGICA DE CACHÉ OFFLINE (PWA) ---
const CACHE_NAME = 'vidrios-exito-v1';

// Lista de archivos CRÍTICOS
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './css/output.css',
    './css/styles.css',
    './js/app.js',
    './js/dashboard.js',
    './js/empleados.js',
    './js/dotacion.js',
    './js/herramientas.js',
    './js/solicitudes.js',
    './js/cartera.js',
    './js/configuracion.js',
    './js/ingresopersonal.js',
    './js/vendor/face-api.min.js',
    './js/vendor/jszip.min.js',
    './js/vendor/FileSaver.min.js'
    // './recursos/LOGO PRISMA1.png' <--- COMENTADO PORQUE PROBABLEMENTE NO EXISTE EN APP/
];

// A. INSTALACIÓN (Versión depurada)
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            console.log('[Service Worker] Intentando cachear archivos...');
            
            // Intentamos cachear uno por uno para ver cuál falla
            // (En producción usaríamos cache.addAll, pero esto ayuda a depurar)
            const promises = ASSETS_TO_CACHE.map(async (url) => {
                try {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`Status: ${response.status}`);
                    await cache.put(url, response);
                    console.log(`[OK] Cacheado: ${url}`);
                } catch (error) {
                    console.error(`[ERROR] No se pudo cachear: ${url}`, error);
                    // No lanzamos error aquí para permitir que los demás se guarden
                }
            });

            await Promise.all(promises);
        })
    );
    self.skipWaiting(); 
});

// B. ACTIVACIÓN (Sin cambios)
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[Service Worker] Borrando caché antiguo:', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    self.clients.claim();
});

// C. INTERCEPTOR (Sin cambios)
self.addEventListener('fetch', (event) => {
    const url = event.request.url;
    if (url.includes('firestore.googleapis.com') || url.includes('firebasestorage')) {
        return; 
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Si estamos offline y no hay caché, retornamos algo (opcional)
            });
            return cachedResponse || fetchPromise;
        })
    );
});