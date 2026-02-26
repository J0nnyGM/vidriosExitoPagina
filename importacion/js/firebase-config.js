// js/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-analytics.js";

const firebaseConfig = {
    apiKey: "AIzaSyCBTjIT0q2X5K_aSnyTgZSRSyZc6Cc3FJ4",
    authDomain: "vidrioexpres1.firebaseapp.com",
    projectId: "vidrioexpres1",
    storageBucket: "vidrioexpres1.firebasestorage.app",
    messagingSenderId: "59380378063",
    appId: "1:59380378063:web:de9accc5f9ddc48d274aba",
    measurementId: "G-BXZJWX9ZKG"
};

let app, auth, db, storage, functions, analytics;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    functions = getFunctions(app, 'us-central1');
    analytics = getAnalytics(app);
} catch (e) {
    console.error("Error al inicializar Firebase.", e);
    document.body.innerHTML = `<h1>Error Crítico: No se pudo inicializar la aplicación.</h1>`;
}

export { app, auth, db, storage, functions, analytics };