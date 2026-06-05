// js/core/auth.js

import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Bandera global para indicar el proceso de registro
export let isRegistering = false;

export function setIsRegistering(value) {
    isRegistering = value;
    window.isRegistering = value;
}

/**
 * Muestra u oculta los formularios de login y registro.
 */
export function showAuthView(viewName) {
    const loginView = document.getElementById('login-view');
    const registerView = document.getElementById('register-view');

    if (!loginView || !registerView) return;

    if (viewName === 'login') {
        loginView.classList.remove('hidden');
        registerView.classList.add('hidden');
    } else if (viewName === 'register') {
        loginView.classList.add('hidden');
        registerView.classList.remove('hidden');
    }
}

/**
 * Maneja el envío del formulario de inicio de sesión.
 */
export async function handleLogin(e) {
    e.preventDefault();

    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const errorDiv = document.getElementById('login-error');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;

    if (!emailInput || !passwordInput || !errorDiv) return;

    errorDiv.classList.add('hidden');
    errorDiv.innerHTML = '';
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Ingresando...';

    const email = emailInput.value;
    const password = passwordInput.value;

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        const userDoc = await getDoc(doc(db, "users", user.uid));

        if (userDoc.exists() && userDoc.data().status === 'pending') {
            errorDiv.innerHTML = `
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-user-clock text-lg"></i>
                    <div class="text-left">
                        <span class="font-bold block">Acceso en espera</span>
                        Tu cuenta está pendiente de aprobación por el administrador.
                    </div>
                </div>
            `;
            errorDiv.className = "text-orange-700 text-sm font-medium bg-orange-50 p-4 rounded-xl border border-orange-100 flex justify-center animate-fade-in";
            errorDiv.classList.remove('hidden');

            await signOut(auth);
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
            return;
        }

    } catch (error) {
        console.error("Error de inicio de sesión:", error.code);

        errorDiv.classList.remove('hidden');
        errorDiv.className = "text-red-600 text-sm font-medium bg-red-50 p-3 rounded-lg border border-red-100 text-center animate-shake";

        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            errorDiv.textContent = "Credenciales incorrectas. Verifica tu correo y contraseña.";
        } else if (error.code === 'auth/too-many-requests') {
            errorDiv.textContent = "Demasiados intentos fallidos. Intenta más tarde.";
        } else {
            errorDiv.textContent = "No se pudo iniciar sesión. Intenta nuevamente.";
        }

        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
    }
}

/**
 * Maneja el envío del formulario de registro de usuario nuevo.
 */
export async function handleRegister(e) {
    e.preventDefault();

    const errorDiv = document.getElementById('register-error');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;

    if (!errorDiv || !submitBtn) return;

    if (!document.getElementById('accept-terms').checked) {
        errorDiv.textContent = 'Debes aceptar los términos y condiciones.';
        errorDiv.classList.remove('hidden');
        errorDiv.className = "text-red-600 text-sm font-medium bg-red-50 p-3 rounded-lg text-center";
        return;
    }

    setIsRegistering(true);

    errorDiv.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Creando cuenta...';

    try {
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);

        await setDoc(doc(db, "users", userCredential.user.uid), {
            firstName: document.getElementById('register-firstName').value,
            lastName: document.getElementById('register-lastName').value,
            idNumber: document.getElementById('register-idNumber').value,
            phone: document.getElementById('register-phone').value,
            address: document.getElementById('register-address').value,
            email: email,
            role: 'operario',
            status: 'pending',
            createdAt: new Date()
        });

        const successModal = document.getElementById('register-success-modal');
        if (successModal) {
            successModal.style.display = 'flex';
        } else {
            alert("Cuenta creada exitosamente. Esperando aprobación.");
            window.location.reload();
        }

        e.target.reset();

    } catch (error) {
        console.error("Error de registro:", error);
        setIsRegistering(false);

        errorDiv.classList.remove('hidden');
        errorDiv.className = "text-red-600 text-sm font-medium bg-red-50 p-3 rounded-lg text-center animate-shake";

        if (error.code === 'auth/email-already-in-use') {
            errorDiv.textContent = "Este correo ya está registrado.";
        } else if (error.code === 'auth/weak-password') {
            errorDiv.textContent = "Contraseña muy débil.";
        } else if (error.code === 'permission-denied') {
            errorDiv.textContent = "Error de permisos al guardar datos.";
        } else {
            errorDiv.textContent = "Error al crear la cuenta: " + error.message;
        }
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
    }
}

/**
 * Cierra la sesión activa del usuario actual y refresca la SPA.
 */
export async function handleLogout() {
    try {
        if (window.activeListeners) {
            window.activeListeners.forEach(unsubscribe => unsubscribe());
            window.activeListeners = [];
        }

        await signOut(auth);
        console.log('Usuario cerró sesión exitosamente');
        window.location.reload();

    } catch (error) {
        console.error('Error al cerrar sesión: ', error);
    }
}
