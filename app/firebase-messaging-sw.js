// EN app/firebase-messaging-sw.js

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
    icon: '/importacion/recursos/LOGO VIDRIO EXPRESS.png',
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

// --- 2. OPTIMIZACIÓN: SOLE-PURPOSE PUSH NOTIFICATIONS ---
// Hemos eliminado por completo el caché de archivos estáticos (HTML/CSS/JS)
// para evitar el consumo de ancho de banda y almacenamiento en caché de archivos.
// Toda la caché de datos (ahorro de lecturas de base de datos) está delegada
// en la persistencia nativa local de Firestore (IndexedDB).

// Evento de Activación: Se encarga de purgar por completo cualquier caché antigua de archivos
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                console.log('[Service Worker] Purgando caché de archivos antigua para liberar espacio:', key);
                return caches.delete(key);
            }));
        })
    );
    self.clients.claim();
});