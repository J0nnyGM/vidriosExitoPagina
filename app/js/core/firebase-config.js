// js/firebase-config.js

// 1. Importamos SOLO las funciones de inicialización de Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app-check.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { getMessaging } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging.js";

// 2. Configuración de tu proyecto
const firebaseConfig = {
    apiKey: "AIzaSyC693QE-O4rdx6qPcZRyvgZUwSWDofBFWw",
    authDomain: "vidriosexitoorganizador.firebaseapp.com",
    projectId: "vidriosexitoorganizador",
    storageBucket: "vidriosexitoorganizador.firebasestorage.app",
    messagingSenderId: "872898185887",
    appId: "1:872898185887:web:0a6a8c209527a19c2ff0aa",
    measurementId: "G-DMVHCCV44M"
};

// 3. Inicialización Principal
const app = initializeApp(firebaseConfig);

// 4. Configuración de App Check (Seguridad)
export const VAPID_KEY = "BKdSH8VAjrl0Fpzc-FZmIVvahDsXV_BlIXU440PWRL3CBkqHiNCg3tav-Lf2kZFOy99sfTHfA5L2e-yXpf-eMiQ";

const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider('6Lc-090rAAAAAKkE09k5txsrVWXG3Xelxnrpb7Ty'),
    isTokenAutoRefreshEnabled: true
});

// 5. Inicialización de Base de Datos con persistencia
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager() // Permite múltiples pestañas sin error
    })
});

// 6. Inicialización del resto de servicios
const auth = getAuth(app);
const storage = getStorage(app);
const messaging = getMessaging(app);
const functions = getFunctions(app, 'us-central1');

// 7. Exportamos los servicios ya listos para usar en cualquier otro archivo
export { app, db, auth, storage, messaging, functions, httpsCallable, getFunctions };