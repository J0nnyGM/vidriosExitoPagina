importScripts("https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js");

// --- 1. CONFIGURACIÓN FIREBASE (NOTIFICACIONES) ---
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

// Manejador de mensajes en background
messaging.onBackgroundMessage((payload) => {
    console.log("[SW] Notificación en background:", payload);
    const notificationTitle = payload.notification?.title || 'Nueva Notificación';
    const notificationOptions = {
        body: payload.notification?.body || '',
        icon: '/recursos/LOGO PRISMA1.png',
        data: payload.data
    };
    self.registration.showNotification(notificationTitle, notificationOptions);
});

// --- 2. CACHÉ DE ARCHIVOS (MODO OFFLINE PWA) ---

const CACHE_NAME = 'vidrios-exito-cache-v2'; // Cambia este nombre si actualizas el código importante

// Lista de archivos vitales para que la app arranque sin internet
const FILES_TO_CACHE = [
    './',
    './index.html',
    './css/output.css',
    './css/styles.css',
    './js/app.js',
    './js/dotacion.js',
    './js/herramientas.js',
    './js/dashboard.js',
    './js/empleados.js',
    './js/configuracion.js',
    './js/cartera.js',
    './js/solicitudes.js', // El nuevo módulo que creamos
    './js/vendor/face-api.min.js',
    './js/vendor/FileSaver.min.js',
    './js/vendor/jszip.min.js'
];

// INSTALACIÓN: Descargar y guardar los archivos
self.addEventListener('install', (event) => {
    console.log('[SW] Instalando y cacheando archivos...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(FILES_TO_CACHE);
        })
    );
    self.skipWaiting(); // Fuerza al SW a activarse de inmediato
});

// ACTIVACIÓN: Limpiar cachés viejas
self.addEventListener('activate', (event) => {
    console.log('[SW] Activado. Limpiando cachés antiguas...');
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        })
    );
    return self.clients.claim();
});

// INTERCEPTOR DE RED: Estrategia "Cache Falling Back to Network"
// Intenta servir desde caché primero. Si no está, va a internet.
self.addEventListener('fetch', (event) => {
    // Ignoramos peticiones que no sean GET o que sean a la API de Firestore (esas las maneja el SDK)
    if (event.request.method !== 'GET' || event.request.url.includes('firestore.googleapis.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((response) => {
            // 1. Si está en caché, lo devolvemos (¡Velocidad instantánea!)
            if (response) {
                return response;
            }
            
            // 2. Si no, vamos a internet
            return fetch(event.request).catch(() => {
                // 3. Si no hay internet y no estaba en caché...
                // Podríamos devolver una página de "offline.html" si existiera
                console.log('[SW] Fallo de red y no está en caché:', event.request.url);
            });
        })
    );
});

// Manejo de clics en notificaciones
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    const urlToOpen = new URL(self.location.origin).href;
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.indexOf(urlToOpen) !== -1 && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(urlToOpen);
        })
    );
});