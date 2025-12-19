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

// B. ACTIVACIÓN
self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            // --- SOLUCIÓN: COMENTAR O BORRAR ESTAS LÍNEAS ---
            // Si tu estrategia es "Cache First", esto gasta datos innecesariamente y causa el warning.
            /* if (self.registration.navigationPreload) {
                await self.registration.navigationPreload.enable();
            }
            */
            // ------------------------------------------------
            
            // Limpiar caché antiguo
            const keyList = await caches.keys();
            await Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[Service Worker] Borrando caché antiguo:', key);
                    return caches.delete(key);
                }
            }));
        })()
    );
    self.clients.claim();
});

// C. INTERCEPTOR (Simplificado para Cache First)
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Ignorar peticiones a la base de datos o storage de Firebase (importante para no romper la app)
    if (url.includes('firestore.googleapis.com') || url.includes('firebasestorage')) {
        return; 
    }

    // Solo interceptamos peticiones GET (las POST/PUT a APIs no se deben cachear así)
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(async function() {
        // 1. Intentar obtener del caché primero
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
            return cachedResponse;
        }

        // 2. Si no está en caché, ir a la red
        try {
            const networkResponse = await fetch(event.request);
            
            // Solo cacheamos peticiones válidas (status 200) y de tipo basic (del mismo origen)
            // OJO: networkResponse.type === 'basic' a veces filtra recursos externos necesarios (como fuentes o scripts CDN)
            // Si usas scripts externos como face-api desde CDN, quizás quieras permitir 'cors' también.
            if (networkResponse && networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                const cache = await caches.open(CACHE_NAME);
                cache.put(event.request, responseToCache);
            }
            
            return networkResponse;
        } catch (error) {
            console.log('[Service Worker] Error en fetch (Offline):', error);
            // Opcional: Retornar una página offline personalizada si es una navegación HTML
        }
    }());
});