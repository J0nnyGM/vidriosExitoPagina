importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// 1. Configuración de Firebase (Usa tus mismas credenciales de app.js)
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

// 2. Recuperar instancia de mensajería
const messaging = firebase.messaging();

// 3. Manejador de notificaciones en segundo plano
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Notificación en segundo plano:', payload);

  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/recursos/LOGO PRISMA1.png', // Asegúrate que esta ruta sea correcta o usa un icono por defecto
    data: payload.data // Guardamos la data para usarla al hacer clic
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// 4. Manejar clic en la notificación
self.addEventListener('notificationclick', function(event) {
    event.notification.close(); // Cerrar la notificación
    
    const urlToOpen = event.notification.data?.url || '/App/'; // <--- CAMBIO AQUÍ: Redirigir a /App/ por defecto

    event.waitUntil(
        clients.matchAll({type: 'window', includeUncontrolled: true}).then(function(windowClients) {
            // Si ya hay una ventana abierta en esa URL, enfocarla
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                if (client.url.includes('App') && 'focus' in client) { // Buscamos que esté en la App
                    return client.focus();
                }
            }
            // Si no, abrir una nueva
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen); 
            }
        })
    );
});