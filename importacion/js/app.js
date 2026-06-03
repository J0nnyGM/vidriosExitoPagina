// js/app.js (Versión Modularizada - Controlador Principal LIMPIO)

import { auth, db, storage, functions, analytics, httpsCallable } from './firebase-config.js';
import { METODOS_DE_PAGO, ALL_MODULES } from './constants.js';
import { isMobileDevice } from './utils.js';

import { loadClientes, setupClientesEvents } from './modules/clientes.js';
import { loadProveedores, setupProveedoresEvents } from './modules/proveedores.js';
import { loadItems, setupItemsEvents } from './modules/items.js';
import { loadGastos, setupGastosEvents } from './modules/gastos.js';
import { loadEmpleados, loadAllLoanRequests, setupEmpleadosEvents } from './modules/empleados.js';
import { loadImportaciones, loadComprasNacionales, setupInventarioEvents } from './modules/inventario.js';
import { loadRemisiones, setupRemisionesEvents } from './modules/remisiones.js';
import { showDashboardModal, cleanupDashboardListeners } from './modules/dashboard.js';
import { setupFacturacionEvents } from './modules/facturacion.js';
import { setupFuncionesEvents } from './modules/funciones.js';
import { loadChats, setupWhatsAppEvents } from './modules/whatsapp.js'; // <--- IMPORTACIÓN DE WHATSAPP
import { setupDespieceEvents } from './modules/despiece2d.js?v=1.8';

import { signInWithEmailAndPassword, signOut, onAuthStateChanged, updateEmail, createUserWithEmailAndPassword, fetchSignInMethodsForEmail } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { doc, getDoc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { logEvent } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-analytics.js";
import { ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

// --- VISTAS Y ESTADO GLOBAL ---
const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const deniedView = document.getElementById('denied-view');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');

// Variables Globales
export let currentUser = null;
export let currentUserData = null;
export let allClientes = [], allProveedores = [], allGastos = [], allRemisiones = [], allUsers = [], allItems = [], allPendingLoans = [], allImportaciones = [], profitLossChart = null, allItemAverageCosts = {}, allComprasNacionales = [];
export let dynamicElementCounter = 0;
export let isRegistering = false;
export let modalTimeout;
export let initialBalances = {};
export let unsubscribePendingTransfers = null;
export let unsubscribeConfirmedTransfers = null;

// Setters Globales
export const setAllClientes = (data) => allClientes = data;
export const setAllProveedores = (data) => allProveedores = data;
export const setAllGastos = (data) => allGastos = data;
export const setAllRemisiones = (data) => allRemisiones = data;
export const setAllUsers = (data) => allUsers = data;
export const setAllItems = (data) => allItems = data;
export const setAllImportaciones = (data) => allImportaciones = data;
export const setAllComprasNacionales = (data) => allComprasNacionales = data;
export const setAllItemAverageCosts = (data) => allItemAverageCosts = data;
export const setAllPendingLoans = (data) => allPendingLoans = data;

// --- MANEJO DE AUTENTICACIÓN ---
let activeListeners = [];
export function unsubscribeAllListeners() {
    activeListeners.forEach(unsubscribe => {
        if (typeof unsubscribe === 'function') {
            unsubscribe();
        }
    });
    activeListeners = [];
}

let isAppInitialized = false;

onAuthStateChanged(auth, async (user) => {
    unsubscribeAllListeners();
    if (user) {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            currentUser = user;
            currentUserData = { id: user.uid, ...userDoc.data() };
            if (currentUserData.status === 'active') {
                document.getElementById('user-info').textContent = `Usuario: ${currentUserData.nombre} (${currentUserData.role})`;
                logEvent(analytics, 'login', { method: 'email', user_role: currentUserData.role });
                
                // Mostrar la app
                if(authView) authView.classList.add('hidden');
                if(deniedView) deniedView.classList.add('hidden');
                if(appView) appView.classList.remove('hidden');
                
                startApp();
            } else {
                let message = "Tu cuenta está pendiente de aprobación.";
                if (currentUserData.status === 'inactive') message = "Tu cuenta ha sido desactivada temporalmente.";
                if (currentUserData.status === 'archived') message = "Tu cuenta ha sido archivada y no puedes acceder.";
                document.getElementById('denied-message').textContent = message;
                if(authView) authView.classList.add('hidden');
                if(appView) appView.classList.add('hidden');
                if(deniedView) deniedView.classList.remove('hidden');
            }
        } else {
            signOut(auth);
        }
    } else {
        currentUser = null;
        currentUserData = null;
        if(appView) appView.classList.add('hidden');
        if(deniedView) deniedView.classList.add('hidden');
        if(authView) authView.classList.remove('hidden');
        isAppInitialized = false;
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // 1. INYECTAR EL HTML ANTES DE HACER NADA
    loadViewTemplates();

    if(loginForm) loginForm.addEventListener('submit', handleLoginSubmit);
    if(registerForm) registerForm.addEventListener('submit', handleRegisterSubmit);
    
    const showRegisterLink = document.getElementById('show-register-link');
    if(showRegisterLink) {
        showRegisterLink.addEventListener('click', (e) => { 
            e.preventDefault(); 
            loginForm.classList.add('hidden'); 
            registerForm.classList.remove('hidden'); 
        });
    }
    
    const logoutDeniedBtn = document.getElementById('logout-denied-user');
    if(logoutDeniedBtn) logoutDeniedBtn.addEventListener('click', () => signOut(auth));
});

function startApp() {
    if (isAppInitialized) return;

    updateUIVisibility(currentUserData);
    setupEventListeners();

    const initialView = getInitialViewForUser(currentUserData);
    const tabs = {
        remisiones: document.getElementById('tab-remisiones'), facturacion: document.getElementById('tab-facturacion'),
        inventario: document.getElementById('tab-inventario'), clientes: document.getElementById('tab-clientes'),
        gastos: document.getElementById('tab-gastos'), proveedores: document.getElementById('tab-proveedores'),
        empleados: document.getElementById('tab-empleados'), items: document.getElementById('tab-items'),
        funciones: document.getElementById('tab-funciones'), whatsapp: document.getElementById('tab-whatsapp'),
        despiece: document.getElementById('tab-despiece')
    };
    const views = {
        remisiones: document.getElementById('view-remisiones'), facturacion: document.getElementById('view-facturacion'),
        inventario: document.getElementById('view-inventario'), clientes: document.getElementById('view-clientes'),
        gastos: document.getElementById('view-gastos'), proveedores: document.getElementById('view-proveedores'),
        empleados: document.getElementById('view-empleados'), items: document.getElementById('view-items'),
        funciones: document.getElementById('view-funciones'), whatsapp: document.getElementById('view-whatsapp'),
        despiece: document.getElementById('view-despiece')
    };
        const mobileTabs = {
        remisiones: document.getElementById('mobile-tab-remisiones'), facturacion: document.getElementById('mobile-tab-facturacion'),
        inventario: document.getElementById('mobile-tab-inventario'), clientes: document.getElementById('mobile-tab-clientes'),
        gastos: document.getElementById('mobile-tab-gastos'), proveedores: document.getElementById('mobile-tab-proveedores'),
        empleados: document.getElementById('mobile-tab-empleados'), items: document.getElementById('mobile-tab-items'),
        funciones: document.getElementById('mobile-tab-funciones'), whatsapp: document.getElementById('mobile-tab-whatsapp'),
        despiece: document.getElementById('mobile-tab-despiece')
    };
    switchView(initialView, tabs, views, mobileTabs);

    loadAllData();
    isAppInitialized = true;
}

function loadAllData() {
    // Como ahora usan Caché Inteligente (getDocs), estas funciones 
    // ya no devuelven listeners, solo se ejecutan una vez al iniciar.
    loadClientes();
    loadProveedores();
    loadRemisiones();
    loadGastos();
    loadImportaciones();
    loadItems();
    loadComprasNacionales();

    // CARGAR CHATS DE WHATSAPP
    if (currentUserData && (currentUserData.role === 'admin' || currentUserData.permissions?.whatsapp)) {
        loadChats();
    }

    if (currentUserData && currentUserData.role === 'admin') {
        loadEmpleados();
        
        // Esta es la única que conservó el onSnapshot (en vivo), 
        // por lo que SÍ se guarda en la lista para apagarla al salir.
        activeListeners.push(loadAllLoanRequests());
    }
}

function loadViewTemplates() {
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');

    if (registerForm) {
        registerForm.innerHTML = `
            <div class="text-center mb-6">
                <h2 class="text-2xl font-extrabold text-slate-800 mb-1">Crear Cuenta</h2>
                <p class="text-xs text-slate-400 font-semibold">Completa los campos para registrarte en el sistema</p>
            </div>
            <div class="space-y-4">
                <input type="text" id="register-name" placeholder="Nombre Completo" class="w-full p-3 border border-gray-300 rounded-lg" required>
                <input type="text" id="register-cedula" placeholder="Cédula" class="w-full p-3 border border-gray-300 rounded-lg" required>
                <input type="tel" id="register-phone" placeholder="Celular" class="w-full p-3 border border-gray-300 rounded-lg" required>
                <input type="text" id="register-address" placeholder="Dirección" class="w-full p-3 border border-gray-300 rounded-lg">
                <input type="email" id="register-email" placeholder="Correo Electrónico" class="w-full p-3 border border-gray-300 rounded-lg" required>
                <input type="password" id="register-password" placeholder="Contraseña (mín. 6 caracteres)" class="w-full p-3 border border-gray-300 rounded-lg" required>
                <div>
                    <label for="register-dob" class="block text-xs font-semibold text-slate-500 uppercase mb-1">Fecha de Nacimiento</label>
                    <input type="date" id="register-dob" class="w-full p-3 border border-gray-300 rounded-lg mt-1" required>
                </div>
                <div class="flex items-center space-x-2">
                    <input type="checkbox" id="register-politica" class="h-4 w-4 rounded border-gray-300 text-[#0066e2] focus:ring-[#0066e2]" required>
                    <label for="register-politica" class="text-xs font-semibold text-slate-500 my-0 cursor-pointer">
                        Acepto la <a href="#" id="show-policy-link" class="font-extrabold text-[#0066e2] hover:underline">Política de Tratamiento de Datos</a>.
                    </label>
                </div>
                <button type="submit" class="w-full bg-[#0066e2] text-white font-extrabold py-3.5 px-4 rounded-xl hover:bg-blue-700 transition shadow-md">Registrarse</button>
            </div>
            <p class="text-center mt-6 text-sm text-slate-500 font-semibold">¿Ya tienes una cuenta? <a href="#" id="show-login-link-register" class="font-extrabold text-[#0066e2] hover:underline">Inicia sesión</a></p>
        `;
    }

    const viewInventario = document.getElementById('view-inventario');
    if (viewInventario) {
        viewInventario.innerHTML = `
        <div class="max-w-7xl mx-auto space-y-6">
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2">
                <div>
                    <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Gestión de Inventario</h1>
                    <p class="text-xs font-semibold text-slate-450 mt-1">Controla y realiza el seguimiento de las importaciones y compras nacionales de la empresa.</p>
                </div>
            </div>
            <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <div class="border-b border-gray-150 mb-6">
                    <nav id="inventario-nav" class="-mb-px flex space-x-6">
                        <button id="tab-importaciones" class="dashboard-tab-btn active py-3 px-1 font-bold text-sm uppercase tracking-wide">🚢 Importaciones</button>
                        <button id="tab-nacional" class="dashboard-tab-btn py-3 px-1 font-bold text-sm uppercase tracking-wide">🇨🇴 Compras Nacionales</button>
                    </nav>
                </div>
                <div id="view-importaciones-content">
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center mb-6 gap-4">
                        <h2 class="text-lg font-bold text-slate-800">Historial de Importaciones</h2>
                        <button id="add-importacion-btn" class="bg-indigo-650 hover:bg-indigo-755 text-white font-extrabold py-2 px-5 rounded-full text-xs shadow-md transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-1.5 w-full sm:w-auto">
                            <span class="text-base font-medium leading-none">+</span> Nueva Importación
                        </button>
                    </div>
                    <div id="importaciones-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6"></div>
                </div>
                <div id="view-nacional-content" class="hidden">
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center mb-6 gap-4">
                        <h2 class="text-lg font-bold text-slate-800">Compras Nacionales</h2>
                        <button id="add-nacional-btn" class="bg-teal-650 hover:bg-teal-755 text-white font-extrabold py-2 px-5 rounded-full text-xs shadow-md transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-1.5 w-full sm:w-auto">
                            <span class="text-base font-medium leading-none">+</span> Nueva Compra Nacional
                        </button>
                    </div>
                    <div id="nacional-list" class="space-y-4">
                        <p class="text-center text-gray-500 py-8">Aún no se han registrado compras nacionales.</p>
                    </div>
                </div>
            </div>
        </div>`;
    }

    const viewItems = document.getElementById('view-items');
    if (viewItems) {
        viewItems.innerHTML = `
        <div class="max-w-6xl mx-auto space-y-6">
            <div id="item-form-container" class="mobile-form-modal">
                <div class="modal-card max-w-md">
                    <div class="modal-header-fixed">
                        <h2 class="text-xl font-bold text-slate-800">Añadir Nuevo Ítem</h2>
                        <button type="button" class="mobile-close-form-btn text-gray-400 hover:text-gray-600 text-2xl font-bold" data-target="item-form-container">&times;</button>
                    </div>
                    <form id="add-item-form" class="modal-body-scroll space-y-4">
                        <div class="bg-indigo-50/50 p-3.5 rounded-lg border border-indigo-100 mb-2">
                            <label class="flex items-center space-x-2 cursor-pointer">
                                <input type="checkbox" id="nuevo-item-es-unidad" class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
                                <span class="text-xs font-bold text-indigo-950">Se vende por Unidad (Silicona, Herrajes)</span>
                            </label>
                        </div>
                        <div>
                            <label for="nuevo-item-tipo" class="block text-xs font-semibold text-slate-600 uppercase">Tipo de Ítem</label>
                            <input type="text" id="nuevo-item-tipo" class="w-full p-2 border border-gray-300 rounded-lg mt-1" placeholder="Ej: Vidrio, Espejo, Silicona" required>
                        </div>
                        <div>
                            <label for="nuevo-item-color" class="block text-xs font-semibold text-slate-600 uppercase">Color o Detalle</label>
                            <input type="text" id="nuevo-item-color" class="w-full p-2 border border-gray-300 rounded-lg mt-1" placeholder="Ej: Claro, Crudo, Transparente" required>
                        </div>
                        <div id="nuevo-item-medidas-container" class="grid grid-cols-2 gap-4">
                            <div>
                                <label for="nuevo-item-ancho" class="block text-xs font-semibold text-slate-600 uppercase">Ancho (mm)</label>
                                <input type="number" id="nuevo-item-ancho" class="w-full p-2 border border-gray-300 rounded-lg mt-1" placeholder="Ej: 3600">
                            </div>
                            <div>
                                <label for="nuevo-item-alto" class="block text-xs font-semibold text-slate-600 uppercase">Alto (mm)</label>
                                <input type="number" id="nuevo-item-alto" class="w-full p-2 border border-gray-300 rounded-lg mt-1" placeholder="Ej: 2600">
                            </div>
                        </div>
                        <div id="nuevo-item-caja-container">
                            <label for="nuevo-item-laminas-por-caja" class="block text-xs font-semibold text-slate-600 uppercase">Láminas por Caja</label>
                            <input type="number" id="nuevo-item-laminas-por-caja" class="w-full p-2 border border-gray-300 rounded-lg mt-1" placeholder="Ej: 40">
                        </div>
                        <div class="bg-slate-50 p-3.5 rounded-lg border border-slate-200 mt-2">
                            <label class="flex items-center space-x-2 cursor-pointer mb-2">
                                <input type="checkbox" id="nuevo-item-stock-infinito" class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
                                <span class="text-xs font-bold text-slate-800">Stock Infinito (Servicios / No descontar)</span>
                            </label>
                            <div id="nuevo-item-stock-container">
                                <label for="nuevo-item-stock" class="block text-xs font-semibold text-slate-600 uppercase mt-2">Stock Inicial</label>
                                <input type="number" id="nuevo-item-stock" class="w-full p-2 border border-gray-300 rounded-lg mt-1" required>
                            </div>
                        </div>
                        <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2.5 px-4 rounded-lg hover:bg-indigo-700 transition shadow-sm">Guardar Ítem</button>
                    </form>
                </div>
            </div>
            
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2">
                <div>
                    <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Inventario de Ítems</h1>
                    <p class="text-xs font-semibold text-slate-450 mt-1">Monitorea el catálogo de vidrios, herrajes y siliconas, así como su stock en tiempo real.</p>
                </div>
                <div class="flex items-center gap-3 w-full md:w-auto">
                    <div class="relative flex-grow md:flex-grow-0">
                        <input type="search" id="search-items" placeholder="Buscar ítem..." class="w-full md:w-64 pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-full text-sm font-semibold text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm transition">
                        <svg class="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </div>
                    <button id="mobile-add-item-btn" class="bg-indigo-650 hover:bg-indigo-755 text-white font-extrabold py-2 px-5 rounded-full text-xs shadow-md transition-all transform hover:-translate-y-0.5 flex items-center gap-1.5 flex-shrink-0">
                        <span class="text-base font-medium leading-none">+</span> Nuevo Ítem
                    </button>
                </div>
            </div>

            <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <div id="items-list" class="space-y-3"></div>
            </div>
        </div>`;
    }

    const viewRemisiones = document.getElementById('view-remisiones');
    if (viewRemisiones) {
        viewRemisiones.innerHTML = `
        <div class="max-w-6xl mx-auto space-y-6">
            <div id="remision-form-container" class="mobile-form-modal">
                <div class="modal-card max-w-md lg:max-w-4xl">
                    <div class="modal-header-fixed">
                        <h2 class="text-xl font-bold text-slate-800">Nueva Remisión</h2>
                        <button type="button" class="mobile-close-form-btn text-gray-400 hover:text-gray-600 text-2xl font-bold" data-target="remision-form-container">&times;</button>
                    </div>
                    <form id="remision-form" class="modal-body-scroll space-y-4">
                        <div class="relative">
                            <label class="block text-xs font-semibold text-slate-600 uppercase mb-1">Cliente</label>
                            <input type="text" id="cliente-search-input" autocomplete="off" placeholder="Buscar y seleccionar cliente..." class="w-full p-3 border border-gray-300 rounded-lg" required>
                            <input type="hidden" id="cliente-id-hidden" name="clienteId">
                            <div id="cliente-search-results" class="search-results hidden"></div>
                        </div>
                        <div>
                            <label for="fecha-recibido" class="block text-xs font-semibold text-slate-600 uppercase mb-1">Fecha Remisión</label>
                            <input type="date" id="fecha-recibido" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-slate-100 text-slate-600 cursor-not-allowed font-medium" value="${new Date().toISOString().split('T')[0]}" readonly>
                        </div>
                        <div class="border-t border-b border-slate-100 py-4 my-2">
                            <h3 class="text-md font-bold text-slate-800 mb-3">Ítems de la Remisión</h3>
                            <div id="items-container" class="space-y-4"></div>
                            <button type="button" id="add-item-btn" class="mt-4 w-full bg-slate-100 text-slate-700 font-bold py-2.5 px-4 rounded-lg hover:bg-slate-200 transition">+ Añadir Ítem</button>
                        </div>
                        <select id="forma-pago" class="w-full p-3 border border-gray-300 rounded-lg bg-slate-100 cursor-not-allowed text-slate-500 font-bold hidden" disabled>
                            <option value="Pendiente" selected>Pendiente</option>
                        </select>
                        <div>
                            <label for="remision-observaciones" class="block text-xs font-semibold text-slate-600 uppercase mb-1">Observaciones</label>
                            <textarea id="remision-observaciones" rows="3" class="w-full p-3 border border-gray-300 rounded-lg mt-1" placeholder="Añade aquí cualquier nota o instrucción especial..."></textarea>
                        </div>
                        <div class="bg-slate-50 p-4 rounded-lg space-y-2 border border-slate-200">
                            <div class="flex justify-between items-center"><span class="font-medium text-slate-600">Subtotal:</span><span id="subtotal" class="font-bold text-slate-900">$ 0</span></div>
                            <div class="flex justify-between items-center"><label for="incluir-iva" class="flex items-center space-x-2 cursor-pointer my-0"><input type="checkbox" id="incluir-iva" class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"><span class="text-xs font-bold text-slate-600">Incluir IVA (19%)</span></label><span id="valor-iva" class="font-medium text-slate-600">$ 0</span></div>
                            <hr class="border-slate-200">
                            <div class="flex justify-between items-center text-lg"><span class="font-extrabold text-slate-800">TOTAL:</span><span id="valor-total" class="font-extrabold text-indigo-600 text-xl">$ 0</span></div>
                        </div>
                        <button type="submit" class="w-full bg-indigo-600 text-white font-extrabold py-3 px-4 rounded-lg hover:bg-indigo-700 transition shadow-md">Guardar Remisión</button>
                    </form>
                </div>
            </div>
            
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2">
                <div>
                    <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Historial de Remisiones</h1>
                    <p class="text-xs font-semibold text-slate-450 mt-1">Genera, imprime y realiza el seguimiento de las remisiones y abonos de clientes.</p>
                </div>
                <div class="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
                    <div class="flex items-center gap-2 w-full sm:w-auto bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
                        <select id="filter-remisiones-month" class="bg-transparent border-0 font-bold text-slate-700 text-xs focus:ring-0 cursor-pointer"></select>
                        <span class="text-slate-300 font-light">|</span>
                        <select id="filter-remisiones-year" class="bg-transparent border-0 font-bold text-slate-700 text-xs focus:ring-0 cursor-pointer"></select>
                    </div>
                    <div class="relative flex-grow sm:flex-grow-0 w-full sm:w-auto">
                        <input type="search" id="search-remisiones" placeholder="Buscar cliente o remisión..." class="w-full sm:w-60 pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-full text-sm font-semibold text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm transition">
                        <svg class="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </div>
                    <div class="flex gap-2 flex-shrink-0">
                        <button id="btn-pending-payments" class="relative bg-amber-500 text-white w-10 h-10 rounded-full hover:bg-amber-600 hidden transition-all shadow-md flex items-center justify-center" title="Pagos por Confirmar">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1m-4.5 9h11a2 2 0 002-2v-1a2 2 0 00-2-2h-1.5M7.5 17H4a2 2 0 01-2-2v-1a2 2 0 012-2h1.5"></path>
                            </svg>
                            <span id="badge-pending-payments" class="absolute -top-1 -right-1 bg-red-600 text-white text-[9px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow border border-white">0</span>
                        </button>
                        <button id="mobile-add-remision-btn" class="bg-indigo-650 hover:bg-indigo-755 text-white font-extrabold py-2 px-5 rounded-full text-xs shadow-md transition-all transform hover:-translate-y-0.5 flex items-center gap-1.5">
                            <span class="text-base font-medium leading-none">+</span> Nueva Remisión
                        </button>
                    </div>
                </div>
            </div>

            <div id="remisiones-list-container" class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <div id="remisiones-list" class="space-y-4"></div>
            </div>
        </div>`;
    }

    const viewFacturacion = document.getElementById('view-facturacion');
    if (viewFacturacion) {
        viewFacturacion.innerHTML = `
        <div class="max-w-7xl mx-auto space-y-6">
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2">
                <div>
                    <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Gestión de Facturación</h1>
                    <p class="text-xs font-semibold text-slate-450 mt-1">Consulta y genera la facturación de las remisiones pendientes y archivadas.</p>
                </div>
            </div>
            
            <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <div class="border-b border-gray-150 mb-6 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-4">
                    <nav id="facturacion-nav" class="-mb-px flex space-x-6 overflow-x-auto w-full lg:w-auto">
                        <button id="tab-pendientes" class="dashboard-tab-btn active py-3 px-1 font-bold text-sm uppercase tracking-wide">🧾 Pendientes</button>
                        <button id="tab-realizadas" class="dashboard-tab-btn py-3 px-1 font-bold text-sm uppercase tracking-wide">📦 Realizadas</button>
                    </nav>
                    <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
                        <div class="flex flex-wrap sm:flex-nowrap items-center justify-between sm:justify-start gap-3 bg-white border border-slate-200 rounded-full px-4 py-1.5 shadow-sm w-full sm:w-auto">
                            <div class="flex items-center gap-1.5">
                                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Desde:</span>
                                <input type="month" id="factura-filter-start" class="bg-transparent border-0 p-0 text-xs font-bold text-slate-700 focus:ring-0 w-[135px] sm:w-auto cursor-pointer">
                            </div>
                            <span class="text-slate-300 font-light">|</span>
                            <div class="flex items-center gap-1.5">
                                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Hasta:</span>
                                <input type="month" id="factura-filter-end" class="bg-transparent border-0 p-0 text-xs font-bold text-slate-700 focus:ring-0 w-[135px] sm:w-auto cursor-pointer">
                            </div>
                        </div>
                        <div class="relative w-full sm:w-auto flex-grow lg:flex-grow-0">
                            <input type="search" id="search-facturacion" placeholder="Buscar cliente, remisión..." class="w-full lg:w-64 pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-full text-sm font-semibold text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm transition">
                            <svg class="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                        </div>
                    </div>
                </div>

                <div id="view-pendientes">
                    <h3 class="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><span>📌</span> Remisiones Pendientes de Facturar</h3>
                    <div id="facturacion-pendientes-list" class="space-y-3"></div>
                </div>
                <div id="view-realizadas" class="hidden">
                    <h3 class="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><span>✅</span> Remisiones Facturadas</h3>
                    <div id="facturacion-realizadas-list" class="space-y-3"></div>
                </div>
            </div>
        </div>`;
    }

    const viewClientes = document.getElementById('view-clientes');
    if (viewClientes) {
        viewClientes.innerHTML = `
        <div class="max-w-6xl mx-auto space-y-6">
            <div id="cliente-form-container" class="mobile-form-modal">
                <div class="modal-card max-w-md">
                    <div class="modal-header-fixed">
                        <h2 class="text-xl font-bold text-slate-800">Añadir Cliente</h2>
                        <button type="button" class="mobile-close-form-btn text-gray-400 hover:text-gray-600 text-2xl font-bold" data-target="cliente-form-container">&times;</button>
                    </div>
                    <form id="add-cliente-form" class="modal-body-scroll space-y-4">
                        <input type="text" id="nuevo-cliente-nombre-empresa" placeholder="Nombre Empresa" class="w-full p-3 border border-gray-300 rounded-lg" required>
                        <input type="text" id="nuevo-cliente-contacto" placeholder="Nombre del Contacto" class="w-full p-3 border border-gray-300 rounded-lg">
                        <input type="email" id="nuevo-cliente-email" placeholder="Correo Electrónico" class="w-full p-3 border border-gray-300 rounded-lg">
                        <input type="tel" id="nuevo-cliente-telefono1" placeholder="Teléfono 1" class="w-full p-3 border border-gray-300 rounded-lg" required oninput="this.value = this.value.replace(/[^0-9]/g, '')">
                        <input type="tel" id="nuevo-cliente-telefono2" placeholder="Teléfono 2 (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
                        <input type="text" id="nuevo-cliente-nit" placeholder="NIT (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg">
                        <div class="space-y-1">
                            <label for="nuevo-cliente-rut" class="block text-xs font-semibold text-slate-500 uppercase">RUT (Opcional)</label>
                            <input type="file" id="nuevo-cliente-rut" class="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/>
                        </div>
                        <button type="submit" class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 shadow-sm transition">Registrar Cliente</button>
                    </form>
                </div>
            </div>
            
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2">
                <div>
                    <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Directorio de Clientes</h1>
                    <p class="text-xs font-semibold text-slate-450 mt-1">Administra, busca y registra la información de tus clientes y sus compras.</p>
                </div>
                <div class="flex items-center gap-3 w-full md:w-auto">
                    <div class="relative flex-grow md:flex-grow-0">
                        <input type="search" id="search-clientes" placeholder="Buscar cliente..." class="w-full md:w-64 pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-full text-sm font-semibold text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition">
                        <svg class="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </div>
                    <button id="mobile-add-cliente-btn" class="bg-blue-650 hover:bg-blue-755 text-white font-extrabold py-2 px-5 rounded-full text-xs shadow-md transition-all transform hover:-translate-y-0.5 flex items-center gap-1.5 flex-shrink-0">
                        <span class="text-base font-medium leading-none">+</span> Nuevo Cliente
                    </button>
                </div>
            </div>

            <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <div id="clientes-list" class="space-y-3"></div>
            </div>
        </div>`;
    }
    
    const viewProveedores = document.getElementById('view-proveedores');
    if (viewProveedores) {
        viewProveedores.innerHTML = `
        <div class="max-w-6xl mx-auto space-y-6">
            <div id="proveedor-form-container" class="mobile-form-modal">
                <div class="modal-card max-w-md">
                    <div class="modal-header-fixed">
                        <h2 class="text-xl font-bold text-slate-800">Añadir Proveedor</h2>
                        <button type="button" class="mobile-close-form-btn text-gray-400 hover:text-gray-600 text-2xl font-bold" data-target="proveedor-form-container">&times;</button>
                    </div>
                    <form id="add-proveedor-form" class="modal-body-scroll space-y-4">
                        <input type="text" id="nuevo-proveedor-nombre" placeholder="Nombre del Proveedor" class="w-full p-3 border border-gray-300 rounded-lg" required>
                        <input type="text" id="nuevo-proveedor-contacto" placeholder="Nombre de Contacto" class="w-full p-3 border border-gray-300 rounded-lg">
                        <input type="tel" id="nuevo-proveedor-telefono" placeholder="Teléfono" class="w-full p-3 border border-gray-300 rounded-lg">
                        <input type="email" id="nuevo-proveedor-email" placeholder="Correo" class="w-full p-3 border border-gray-300 rounded-lg">
                        <div>
                            <label for="nuevo-proveedor-rut" class="block text-xs font-semibold text-slate-500 uppercase">RUT (Opcional)</label>
                            <input type="file" id="nuevo-proveedor-rut" class="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"/>
                        </div>
                        <button type="submit" class="w-full bg-teal-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-teal-700 shadow-sm transition">Registrar Proveedor</button>
                    </form>
                </div>
            </div>
            
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2">
                <div>
                    <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Directorio de Proveedores</h1>
                    <p class="text-xs font-semibold text-slate-450 mt-1">Registra y administra los proveedores nacionales de la empresa.</p>
                </div>
                <div class="flex items-center gap-3 w-full md:w-auto">
                    <div class="relative flex-grow md:flex-grow-0">
                        <input type="search" id="search-proveedores" placeholder="Buscar proveedor..." class="w-full md:w-64 pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-full text-sm font-semibold text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 shadow-sm transition">
                        <svg class="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </div>
                    <button id="mobile-add-proveedor-btn" class="bg-teal-650 hover:bg-teal-755 text-white font-extrabold py-2 px-5 rounded-full text-xs shadow-md transition-all transform hover:-translate-y-0.5 flex items-center gap-1.5 flex-shrink-0">
                        <span class="text-base font-medium leading-none">+</span> Nuevo Proveedor
                    </button>
                </div>
            </div>

            <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <div id="proveedores-list" class="space-y-3"></div>
            </div>
        </div>`;
    }

    const viewGastos = document.getElementById('view-gastos');
    if (viewGastos) {
        viewGastos.innerHTML = `
        <div class="max-w-6xl mx-auto space-y-6">
            <div id="gasto-form-container" class="mobile-form-modal">
                <div class="modal-card max-w-md">
                    <div class="modal-header-fixed">
                        <h2 class="text-xl font-bold text-slate-800">Nuevo Gasto</h2>
                        <button type="button" class="mobile-close-form-btn text-gray-400 hover:text-gray-600 text-2xl font-bold" data-target="gasto-form-container">&times;</button>
                    </div>
                    <form id="add-gasto-form" class="modal-body-scroll space-y-4">
                        <div>
                            <label for="gasto-fecha" class="text-xs font-semibold text-slate-500 uppercase">Fecha</label>
                            <input type="date" id="gasto-fecha" class="w-full p-3 border border-gray-300 rounded-lg mt-1" required>
                        </div>
                        <div class="relative">
                            <label for="proveedor-search-input" class="text-xs font-semibold text-slate-500 uppercase">Proveedor</label>
                            <input type="text" id="proveedor-search-input" autocomplete="off" placeholder="Buscar..." class="w-full p-3 border border-gray-300 rounded-lg mt-1" required>
                            <input type="hidden" id="proveedor-id-hidden" name="proveedorId">
                            <div id="proveedor-search-results" class="search-results hidden"></div>
                        </div>
                        <div>
                            <label for="gasto-factura" class="text-xs font-semibold text-slate-500 uppercase">Factura (Opcional)</label>
                            <input type="text" id="gasto-factura" placeholder="N° de Factura" class="w-full p-3 border border-gray-300 rounded-lg mt-1">
                        </div>
                        <div>
                            <label for="gasto-valor-total" class="text-xs font-semibold text-slate-500 uppercase">Valor Total</label>
                            <input type="text" id="gasto-valor-total" inputmode="numeric" placeholder="Valor Total (COP)" class="w-full p-3 border border-gray-300 rounded-lg mt-1" required>
                        </div>
                        <div class="bg-orange-50/50 p-3 rounded-lg border border-orange-100 mb-1">
                            <label class="flex items-center space-x-2 cursor-pointer my-0">
                                <input type="checkbox" id="gasto-iva" class="h-4 w-4 rounded border-orange-300 text-orange-600 focus:ring-orange-500">
                                <span class="text-xs font-bold text-orange-950">IVA del 19% incluido</span>
                            </label>
                        </div>
                        <div>
                            <label for="gasto-fuente" class="text-xs font-semibold text-slate-500 uppercase">Fuente del Pago</label>
                            <select id="gasto-fuente" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-white" required>
                                ${metodosDePagoHTML}
                            </select>
                        </div>
                        <button type="submit" class="w-full bg-orange-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-orange-700 shadow-sm transition">Registrar Gasto</button>
                    </form>
                </div>
            </div>
            
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2">
                <div>
                    <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Historial de Gastos</h1>
                    <p class="text-xs font-semibold text-slate-450 mt-1">Registra y controla los egresos y gastos operativos de la empresa.</p>
                </div>
                <div class="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
                    <div class="flex items-center gap-2 w-full sm:w-auto bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
                        <select id="filter-gastos-month" class="bg-transparent border-0 font-bold text-slate-700 text-xs focus:ring-0 cursor-pointer"></select>
                        <span class="text-slate-300 font-light">|</span>
                        <select id="filter-gastos-year" class="bg-transparent border-0 font-bold text-slate-700 text-xs focus:ring-0 cursor-pointer"></select>
                    </div>
                    
                    <div class="relative flex-grow sm:flex-grow-0 w-full sm:w-auto">
                        <input type="search" id="search-gastos" placeholder="Buscar gasto..." class="w-full sm:w-60 pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-full text-sm font-semibold text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 shadow-sm transition">
                        <svg class="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </div>

                    <div class="flex gap-2 flex-shrink-0">
                        <button id="view-deleted-gastos-btn" class="bg-red-50 text-red-600 w-10 h-10 rounded-full hover:bg-red-100 flex items-center justify-center border border-red-100 shadow-sm transition" title="Ver Papelera de Gastos">🗑️</button>
                        <button id="sync-gastos-btn" class="bg-slate-50 text-slate-700 w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center border border-slate-100 shadow-sm transition" title="Forzar Sincronización">↻</button>
                        <button id="mobile-add-gasto-btn" class="bg-orange-650 hover:bg-orange-755 text-white font-extrabold py-2 px-5 rounded-full text-xs shadow-md transition-all transform hover:-translate-y-0.5 flex items-center gap-1.5">
                            <span class="text-base font-medium leading-none">+</span> Nuevo Gasto
                        </button>
                    </div>
                </div>
            </div>

            <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <div id="gastos-list" class="space-y-3"></div>
            </div>
        </div>`;
    }

    const viewEmpleados = document.getElementById('view-empleados');
    if (viewEmpleados) {
        viewEmpleados.innerHTML = `
        <div class="max-w-4xl mx-auto space-y-6">
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2">
                <div>
                    <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Gestión de Empleados</h1>
                    <p class="text-xs font-semibold text-slate-450 mt-1">Administra las cuentas de usuario de tus colaboradores, sus roles y permisos en el sistema.</p>
                </div>
            </div>
            <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <div id="empleados-list" class="space-y-4"></div>
            </div>
        </div>`;
    }

    // Volver a asignar el listener de login-register links que acabamos de recrear
    const linkRegister = document.getElementById('show-login-link-register');
    if (linkRegister) {
        linkRegister.addEventListener('click', (e) => { 
            e.preventDefault(); 
            registerForm.classList.add('hidden'); 
            loginForm.classList.remove('hidden'); 
        });
    }

    const viewFunciones = document.getElementById('view-funciones');
    if (viewFunciones) {
        viewFunciones.innerHTML = `
            <div class="bg-white p-6 rounded-xl shadow-md max-w-4xl mx-auto border-t-4 border-indigo-600">
                <h2 class="text-xl font-bold mb-6 text-slate-800">Funciones y Reportes del Sistema</h2>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="border border-slate-200 p-5 rounded-lg text-center bg-slate-50/50 hover:bg-slate-50 hover:shadow-md transition">
                        <div class="text-4xl mb-3">📊</div>
                        <h3 class="font-bold text-lg mb-2 text-slate-800">Exportar Gastos</h3>
                        <p class="text-sm text-slate-500 mb-4">Descarga un archivo Excel detallado de todos los gastos registrados en el sistema.</p>
                        <button id="btn-func-export-gastos" class="bg-indigo-600 text-white font-bold py-2 px-6 rounded-full hover:bg-indigo-700 transition shadow-sm">Exportar Gastos</button>
                    </div>
                    <div class="border border-slate-200 p-5 rounded-lg text-center bg-slate-50/50 hover:bg-slate-50 hover:shadow-md transition">
                        <div class="text-4xl mb-3">💰</div>
                        <h3 class="font-bold text-lg mb-2 text-slate-800">Exportar Pagos</h3>
                        <p class="text-sm text-slate-500 mb-4">Descarga un archivo Excel con el historial de abonos y pagos de remisiones.</p>
                        <button id="btn-func-export-pagos" class="bg-green-600 text-white font-bold py-2 px-6 rounded-full hover:bg-green-700 transition shadow-sm">Exportar Pagos</button>
                    </div>
                </div>
            </div>
        `;
    }

    // --- HTML DEL CHAT DE WHATSAPP ---
    const viewWhatsapp = document.getElementById('view-whatsapp');
    if (viewWhatsapp) {
        viewWhatsapp.innerHTML = `
        <div class="flex h-[calc(100vh-120px)] sm:h-[calc(100vh-180px)] w-full bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden relative border-t-4 border-indigo-600">
            
            <div class="w-full md:w-1/3 flex flex-col border-r border-slate-100" id="whatsapp-sidebar">
                <div class="p-3 sm:p-4 border-b bg-slate-50 flex justify-between items-center">
                    <h2 class="text-lg font-bold text-slate-800">Mensajes</h2>
                </div>
                <div class="flex bg-slate-50 border-b border-slate-100">
                    <button id="wa-tab-activos" class="flex-1 py-2 text-xs font-extrabold uppercase text-indigo-600 border-b-2 border-indigo-600 transition">Activos</button>
                    <button id="wa-tab-resueltos" class="flex-1 py-2 text-xs font-extrabold uppercase text-slate-450 border-b-2 border-transparent hover:text-slate-700 transition">Resueltos</button>
                </div>
                <div class="p-2 border-b">
                    <input type="text" id="whatsapp-search" placeholder="Buscar chat..." class="w-full p-2 border rounded-lg text-xs bg-slate-100 focus:outline-none focus:border-indigo-300">
                </div>
                <div id="chats-list" class="flex-grow overflow-y-auto">
                    <p class="text-center text-slate-400 mt-10 text-xs font-semibold">Cargando chats...</p>
                </div>
            </div>
 
            <div class="hidden md:flex flex-col w-full md:w-2/3 bg-[#f8fafc] relative" id="whatsapp-chat-area">
                <div class="p-2 sm:p-3 bg-white border-b flex items-center justify-between shadow-sm z-10 min-h-[60px] sm:min-h-[70px]">
                    <div class="flex items-center gap-2 sm:gap-3 overflow-hidden flex-grow">
                        <button id="wa-back-btn" class="md:hidden text-slate-650 font-bold text-xl pr-1">&larr;</button>
                        <div class="w-9 h-9 sm:w-10 sm:h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold text-base sm:text-lg flex-shrink-0" id="wa-avatar">?</div>
                        <div class="flex flex-col overflow-hidden w-full">
                          <h3 class="font-bold text-slate-800 text-sm sm:text-base truncate" id="wa-contact-name">Selecciona un chat</h3>
                          <p class="text-xs text-slate-400 flex items-center truncate" id="wa-contact-phone"></p>
                        </div>
                    </div>
                    <div id="wa-chat-header-actions" class="flex items-center flex-shrink-0 ml-1 sm:ml-2"></div>
                </div>
 
                <div id="wa-messages-container" class="flex-grow overflow-y-auto p-3 sm:p-4 space-y-2 sm:space-y-3 relative"></div>
 
                <div id="wa-24h-warning" class="hidden bg-amber-50 text-amber-800 text-[10px] sm:text-xs p-2 text-center border-t border-amber-200 font-semibold">
                    ⚠️ Han pasado más de 24h. Solo puedes enviar plantillas pre-aprobadas.
                </div>
 
                <form id="wa-send-form" class="p-2 sm:p-3 bg-white border-t flex items-end gap-1 sm:gap-2 hidden">
                    <input type="hidden" id="wa-current-phone">
                    <label class="cursor-pointer text-slate-400 hover:text-indigo-600 p-2 transition flex-shrink-0 my-0" title="Adjuntar archivo">
                        <input type="file" id="wa-file-input" class="hidden" accept="*/*">
                        <svg class="w-6 h-6 transform rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                    </label>
                    <textarea id="wa-msg-input" rows="1" placeholder="Mensaje..." class="flex-grow p-2.5 sm:p-3 rounded-full border border-slate-200 shadow-sm focus:outline-none focus:border-indigo-400 resize-none max-h-24 sm:max-h-32 bg-slate-50 text-sm" required></textarea>
                    <button type="submit" id="wa-send-btn" class="bg-indigo-600 text-white p-2.5 sm:p-3 rounded-full hover:bg-indigo-700 transition shadow-sm h-10 w-10 sm:h-11 sm:w-11 flex items-center justify-center flex-shrink-0">
                        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path></svg>
                    </button>
                </form>
            </div>
        </div>`;
    }
}

function updateUIVisibility(userData) {
    if (!userData) return;
    const isAdmin = userData.role?.toLowerCase() === 'admin';

    ALL_MODULES.forEach(module => {
        const tabDesktop = document.getElementById(`tab-${module}`);
        const tabMobile = document.getElementById(`mobile-tab-${module}`);
        let hasPermission = isAdmin || (userData.permissions && userData.permissions[module]);
        
        if (tabDesktop) tabDesktop.classList.toggle('hidden', !hasPermission);
        if (tabMobile) tabMobile.classList.toggle('hidden', !hasPermission);
    });

    // Control de botones superiores Desktop
    const viewAllLoansBtn = document.getElementById('view-all-loans-btn');
    if(viewAllLoansBtn) viewAllLoansBtn.style.display = isAdmin ? 'block' : 'none';
    
    const summaryBtn = document.getElementById('summary-btn');
    if(summaryBtn) summaryBtn.style.display = isAdmin ? 'block' : 'none';
    
    const loanReqBtn = document.getElementById('loan-request-btn');
    if(loanReqBtn) loanReqBtn.style.display = isAdmin ? 'none' : 'block';

    // Control de botones en el Menú Móvil (Mi Cuenta)
    const mobileSummaryBtn = document.getElementById('mobile-summary-btn');
    if(mobileSummaryBtn) mobileSummaryBtn.style.display = isAdmin ? 'flex' : 'none';

    const mobileLoansBtn = document.getElementById('mobile-loans-btn');
    if(mobileLoansBtn) mobileLoansBtn.style.display = isAdmin ? 'flex' : 'none';

    const mobileLoanReqBtn = document.getElementById('mobile-loan-request-btn');
    if(mobileLoanReqBtn) mobileLoanReqBtn.style.display = isAdmin ? 'none' : 'flex';

    // Módulos específicos según rol
    const isPlanta = userData.role?.toLowerCase() === 'planta';
    const remisionFormContainer = document.getElementById('remision-form-container');
    const remisionListContainer = document.getElementById('remisiones-list-container');
    if (remisionFormContainer && remisionListContainer) {
        remisionFormContainer.style.display = isPlanta ? 'none' : '';
        remisionListContainer.classList.toggle('lg:col-span-3', isPlanta);
        remisionListContainer.classList.toggle('lg:col-span-2', !isPlanta);
    }

    const isContabilidad = userData.role?.toLowerCase() === 'contabilidad';
    const gastosView = document.getElementById('view-gastos');
    if (gastosView && isContabilidad) {
        const formContainer = gastosView.querySelector('.lg\\:col-span-1');
        if (formContainer) formContainer.style.display = 'none';
        const listContainer = gastosView.querySelector('.lg\\:col-span-2');
        if (listContainer) {
            listContainer.classList.remove('lg:col-span-2');
            listContainer.classList.add('lg:col-span-3');
        }
    }

    const tabFunciones = document.getElementById('tab-funciones');
    if (tabFunciones) tabFunciones.classList.toggle('hidden', !isAdmin);
}

function getInitialViewForUser(userData) {
    if (!userData) return 'remisiones';
    if (userData.role === 'admin') return 'remisiones';
    const modulePriority = ['remisiones', 'whatsapp', 'facturacion', 'inventario', 'items', 'clientes', 'gastos', 'proveedores', 'empleados'];
    if (userData.permissions) {
        for (const module of modulePriority) {
            if (userData.permissions[module]) return module;
        }
    }
    return 'remisiones';
}

function handleLoginSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    signInWithEmailAndPassword(auth, email, password).catch(error => {
        showModalMessage("Error: " + error.message);
    });
}

async function handleRegisterSubmit(e) {
    e.preventDefault();
    if (isRegistering) return;
    isRegistering = true;
    
    const submitButton = e.target.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Verificando datos...';
    submitButton.classList.add('opacity-50', 'cursor-not-allowed');
    
    const politicaCheckbox = document.getElementById('register-politica');
    if (!politicaCheckbox.checked) {
        showModalMessage("Debes aceptar la Política de Tratamiento de Datos.");
        isRegistering = false;
        submitButton.disabled = false;
        submitButton.textContent = 'Registrarse';
        submitButton.classList.remove('opacity-50', 'cursor-not-allowed');
        return;
    }

    const email = document.getElementById('register-email').value.trim().toLowerCase();
    
    showModalMessage("Verificando disponibilidad del correo...", true);

    try {
        const signInMethods = await fetchSignInMethodsForEmail(auth, email);
        
        if (signInMethods.length > 0) {
            throw new Error("Este correo electrónico ya se encuentra registrado en el sistema. Por favor, inicia sesión o utiliza un correo diferente.");
        }

        const nombre = document.getElementById('register-name').value;
        const cedula = document.getElementById('register-cedula').value;
        const telefono = document.getElementById('register-phone').value;
        const direccion = document.getElementById('register-address').value;
        const password = document.getElementById('register-password').value;
        const dob = document.getElementById('register-dob').value;
        
        showModalMessage("Creando tu cuenta...", true);
        
        const role = 'planta';
        const status = 'pending';
        const permissions = {
            remisiones: true, prestamos: true,
            facturacion: false, clientes: false,
            gastos: false, proveedores: false, empleados: false, whatsapp: false
        };
        
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        await setDoc(doc(db, "users", user.uid), {
            nombre: nombre, cedula: cedula, telefono: telefono, direccion: direccion, email: email, dob: dob,
            role: role, status: status, permissions: permissions, creadoEn: new Date()
        });
        
        hideModal();
        showModalMessage("¡Registro exitoso! Tu cuenta está pendiente de aprobación.", false, 5000);
        registerForm.reset();
        registerForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        await signOut(auth);
        
    } catch (error) {
        hideModal();
        console.error("Error de registro:", error);
        let errorMsg = error.message;
        if (error.code === 'auth/invalid-email') errorMsg = "El formato del correo electrónico no es válido.";
        if (error.code === 'auth/weak-password') errorMsg = "La contraseña debe tener al menos 6 caracteres.";
        showModalMessage(errorMsg);
    } finally {
        isRegistering = false;
        submitButton.disabled = false;
        submitButton.textContent = 'Registrarse';
        submitButton.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

document.getElementById('logout-btn')?.addEventListener('click', () => {
    unsubscribeAllListeners();
    signOut(auth);
});

function setupEventListeners() {
    if (window.__setupEventListenersInit) return;
    window.__setupEventListenersInit = true;

    const tabs = {
        remisiones: document.getElementById('tab-remisiones'), facturacion: document.getElementById('tab-facturacion'),
        inventario: document.getElementById('tab-inventario'), clientes: document.getElementById('tab-clientes'),
        gastos: document.getElementById('tab-gastos'), proveedores: document.getElementById('tab-proveedores'),
        empleados: document.getElementById('tab-empleados'), items: document.getElementById('tab-items'),
        funciones: document.getElementById('tab-funciones'), whatsapp: document.getElementById('tab-whatsapp'),
        despiece: document.getElementById('tab-despiece')
    };

    const mobileTabs = {
        remisiones: document.getElementById('mobile-tab-remisiones'), facturacion: document.getElementById('mobile-tab-facturacion'),
        inventario: document.getElementById('mobile-tab-inventario'), clientes: document.getElementById('mobile-tab-clientes'),
        gastos: document.getElementById('mobile-tab-gastos'), proveedores: document.getElementById('mobile-tab-proveedores'),
        empleados: document.getElementById('mobile-tab-empleados'), items: document.getElementById('mobile-tab-items'),
        funciones: document.getElementById('mobile-tab-funciones'), whatsapp: document.getElementById('mobile-tab-whatsapp'),
        despiece: document.getElementById('mobile-tab-despiece')
    };

    const views = {
        remisiones: document.getElementById('view-remisiones'), facturacion: document.getElementById('view-facturacion'),
        inventario: document.getElementById('view-inventario'), clientes: document.getElementById('view-clientes'),
        gastos: document.getElementById('view-gastos'), proveedores: document.getElementById('view-proveedores'),
        empleados: document.getElementById('view-empleados'), items: document.getElementById('view-items'),
        funciones: document.getElementById('view-funciones'), whatsapp: document.getElementById('view-whatsapp'),
        despiece: document.getElementById('view-despiece')
    };

    // Navegación Desktop
    Object.keys(tabs).forEach(key => {
        if (tabs[key]) tabs[key].addEventListener('click', () => switchView(key, tabs, views, mobileTabs));
    });

    // Lógica del Menú Móvil Animado (Bottom Sheet)
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
    const mobileMenuBackdrop = document.getElementById('mobile-menu-backdrop');
    const mobileMenuContent = document.getElementById('mobile-menu-content');

    function openMobileMenu() {
        mobileMenuOverlay.classList.remove('pointer-events-none');
        mobileMenuBackdrop.classList.remove('opacity-0');
        mobileMenuContent.classList.remove('translate-y-full');
    }

    function closeMobileMenu() {
        mobileMenuBackdrop.classList.add('opacity-0');
        mobileMenuContent.classList.add('translate-y-full');
        setTimeout(() => mobileMenuOverlay.classList.add('pointer-events-none'), 300);
    }

    if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openMobileMenu);
    if (mobileMenuBackdrop) mobileMenuBackdrop.addEventListener('click', closeMobileMenu);

    // Navegación Móvil
    Object.keys(mobileTabs).forEach(key => {
        if (mobileTabs[key]) {
            mobileTabs[key].addEventListener('click', () => {
                switchView(key, tabs, views, mobileTabs);
                closeMobileMenu();
            });
        }
    });

    // Conectar los botones del menú móvil a sus funciones principales
    document.getElementById('mobile-summary-btn')?.addEventListener('click', () => { closeMobileMenu(); showDashboardModal(); });
    document.getElementById('mobile-edit-profile-btn')?.addEventListener('click', () => { closeMobileMenu(); showEditProfileModal(); });
    document.getElementById('mobile-logout-btn')?.addEventListener('click', () => { closeMobileMenu(); signOut(auth); });
    document.getElementById('mobile-loans-btn')?.addEventListener('click', () => { closeMobileMenu(); document.getElementById('view-all-loans-btn').click(); });
    document.getElementById('mobile-loan-request-btn')?.addEventListener('click', () => { closeMobileMenu(); document.getElementById('loan-request-btn').click(); });

    // Sincronizar las notificaciones rojas (badges) de préstamos entre Desktop y Móvil
    const desktopBadge = document.getElementById('header-loan-badge');
    const mobileBadge = document.getElementById('mobile-loan-badge');
    if (desktopBadge && mobileBadge) {
        const observer = new MutationObserver(() => {
            mobileBadge.textContent = desktopBadge.textContent;
            mobileBadge.className = desktopBadge.className; // Copia el estado 'hidden' si aplica
        });
        observer.observe(desktopBadge, { attributes: true, childList: true, characterData: true });
    }

    document.getElementById('summary-btn')?.addEventListener('click', showDashboardModal);
    document.getElementById('edit-profile-btn')?.addEventListener('click', showEditProfileModal);

    document.getElementById('show-policy-link')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('policy-modal').classList.remove('hidden'); });
    document.getElementById('close-policy-modal')?.addEventListener('click', () => { document.getElementById('policy-modal').classList.add('hidden'); });
    document.getElementById('accept-policy-btn')?.addEventListener('click', () => { document.getElementById('policy-modal').classList.add('hidden'); });

    // --- EVENT DELEGATION FOR RESPONSIVE MOBILE FORM MODALS ---
    document.body.addEventListener('click', (e) => {
        // Handle trigger buttons
        if (e.target && e.target.id === 'mobile-add-cliente-btn') {
            document.getElementById('cliente-form-container')?.classList.add('show-modal');
        }
        if (e.target && e.target.id === 'mobile-add-proveedor-btn') {
            document.getElementById('proveedor-form-container')?.classList.add('show-modal');
        }
        if (e.target && e.target.id === 'mobile-add-gasto-btn') {
            document.getElementById('gasto-form-container')?.classList.add('show-modal');
        }
        if (e.target && e.target.id === 'mobile-add-item-btn') {
            document.getElementById('item-form-container')?.classList.add('show-modal');
        }
        if (e.target && e.target.id === 'mobile-add-remision-btn') {
            document.getElementById('remision-form-container')?.classList.add('show-modal');
        }

        // Handle close buttons inside modals
        const closeBtn = e.target.closest('.mobile-close-form-btn');
        if (closeBtn) {
            const targetId = closeBtn.dataset.target;
            if (targetId) {
                document.getElementById(targetId)?.classList.remove('show-modal');
            }
        }
    });

    setupClientesEvents();
    setupProveedoresEvents();
    setupItemsEvents();
    setupGastosEvents();
    setupEmpleadosEvents();
    setupInventarioEvents();
    setupRemisionesEvents();
    setupFacturacionEvents();
    setupFuncionesEvents();
    setupWhatsAppEvents();
    setupDespieceEvents();
}

function switchView(viewName, tabs, views, mobileTabs = null) {
    Object.values(tabs).forEach(tab => { if (tab) tab.classList.remove('active') });
    if (tabs[viewName]) tabs[viewName].classList.add('active');

    // Cambiar color del icono inferior seleccionado
    if (mobileTabs) {
        Object.values(mobileTabs).forEach(tab => { 
            if (tab) {
                tab.classList.remove('text-blue-600');
                tab.classList.add('text-gray-500');
            }
        });
        if (mobileTabs[viewName]) {
            mobileTabs[viewName].classList.remove('text-gray-500');
            mobileTabs[viewName].classList.add('text-blue-600');
        }
    }

    Object.values(views).forEach(view => { if (view) view.classList.add('hidden') });
    if (views[viewName]) views[viewName].classList.remove('hidden');

    // Expandir/contraer dinámicamente el contenedor principal <main> para el módulo de WhatsApp
    const mainContainer = document.querySelector('main');
    const body = document.body;
    if (mainContainer) {
        if (viewName === 'whatsapp') {
            mainContainer.classList.remove('max-w-7xl', 'md:p-8', 'p-4', 'pb-24');
            mainContainer.classList.add('max-w-none', 'md:p-2', 'p-1', 'pb-0');
            if (body) body.classList.add('overflow-hidden');
        } else {
            mainContainer.classList.add('max-w-7xl', 'md:p-8', 'p-4', 'pb-24');
            mainContainer.classList.remove('max-w-none', 'md:p-2', 'p-1', 'pb-0');
            if (body) body.classList.remove('overflow-hidden');
        }
    }
}

export function hideModal() {
    const primaryModal = document.getElementById('modal');
    if (primaryModal) {
        primaryModal.classList.add('hidden');
        primaryModal.querySelector('#modal-content-wrapper').innerHTML = '';
        cleanupDashboardListeners();
    }
}

// --- UTILIDADES EXPORTADAS ---
export function populateDateFilters(prefix) {
    const monthSelect = document.getElementById(`${prefix}-month`);
    const yearSelect = document.getElementById(`${prefix}-year`);
    if (!monthSelect || !yearSelect) return;

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    monthSelect.innerHTML = '<option value="all">Todos los Meses</option>';
    for (let i = 0; i < 12; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = monthNames[i];
        monthSelect.appendChild(option);
    }

    yearSelect.innerHTML = '<option value="all">Todos los Años</option>';
    const currentYear = new Date().getFullYear();
    for (let i = 0; i < 5; i++) {
        const year = currentYear - i;
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    }
}

export function initSearchableInput(searchInput, resultsContainer, getDataFn, displayFn, onSelect) {
    searchInput.addEventListener('input', () => {
        const data = getDataFn();
        const searchTerm = searchInput.value.toLowerCase();
        if (!searchTerm) {
            if (onSelect) onSelect(null, searchInput);
            resultsContainer.innerHTML = '';
            resultsContainer.classList.add('hidden');
            return;
        }
        const filteredData = data.filter(item => displayFn(item).toLowerCase().includes(searchTerm));
        renderResults(filteredData);
    });

    searchInput.addEventListener('focus', () => {
        if (searchInput.value) searchInput.dispatchEvent(new Event('input'));
    });

    function renderResults(results) {
        resultsContainer.innerHTML = '';
        if (results.length === 0) {
            resultsContainer.classList.add('hidden');
            return;
        }
        results.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.textContent = displayFn(item);
            div.addEventListener('mousedown', (e) => {
                e.preventDefault();
                searchInput.value = displayFn(item);
                resultsContainer.classList.add('hidden');
                if (onSelect) onSelect(item, searchInput);
            });
            resultsContainer.appendChild(div);
        });
        resultsContainer.classList.remove('hidden');
    }
    
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.classList.add('hidden');
        }
    });
}

export function showTemporaryMessage(message, type = 'info') {
    const colors = { info: 'bg-blue-500', success: 'bg-green-600', error: 'bg-red-500' };
    const messageEl = document.createElement('div');
    messageEl.className = `fixed top-5 right-5 ${colors[type]} text-white py-2 px-4 rounded-lg shadow-lg transition-opacity duration-300 z-50`;
    messageEl.textContent = message;
    document.body.appendChild(messageEl);
    setTimeout(() => {
        messageEl.classList.add('opacity-0');
        setTimeout(() => messageEl.remove(), 300);
    }, 2500);
}

export function showModalMessage(message, isLoader = false, duration = 0) {
    const modal = document.getElementById('modal');
    if (!modal) return;
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `<div id="modal-content" class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-center"></div>`;
    const modalContent = document.getElementById('modal-content');
    clearTimeout(modalTimeout);

    let contentHTML = '';
    if (isLoader) {
        contentHTML = `<svg class="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p class="mt-4 text-gray-700 font-semibold">${message}</p>`;
    } else {
        contentHTML = `<p class="text-gray-800 font-semibold mb-4">${message}</p>`;
        if (duration === 0) contentHTML += `<button id="close-message-modal-btn" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Cerrar</button>`;
    }
    modalContent.innerHTML = contentHTML;
    modal.classList.remove('hidden');

    if (duration > 0) {
        modalTimeout = setTimeout(hideModal, duration);
    } else if (!isLoader) {
        const closeBtn = document.getElementById('close-message-modal-btn');
        if (closeBtn) closeBtn.addEventListener('click', hideModal);
    }
}

export function showPdfModal(pdfUrl, title) {
    if (!pdfUrl || pdfUrl === 'undefined') {
        if(window.Swal) window.Swal.fire('PDF no disponible', 'El PDF aún se está generando.', 'info');
        return;
    }
    if (isMobileDevice()) {
        const separator = pdfUrl.includes('?') ? '&' : '?';
        window.open(`${pdfUrl}${separator}cache_bust=${new Date().getTime()}`, '_blank');
    } else {
        showFileModal(pdfUrl, title);
    }
}

function showFileModal(url, title = 'Visualizador de Archivos') {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const modal = document.getElementById('modal');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl flex flex-col mx-auto" style="height: 90vh;">
            <div class="flex justify-between items-center p-4 border-b">
                <h2 class="text-xl font-semibold">${title}</h2>
                <button id="close-file-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="p-2 flex-grow">
                <iframe src="${url}" class="w-full h-full" frameborder="0"></iframe>
            </div>
        </div>
    `;
    modal.classList.remove('hidden');
    modalContentWrapper.querySelector('#close-file-modal').addEventListener('click', () => {
        modal.classList.add('hidden');
        modalContentWrapper.innerHTML = '<div id="modal-content" class="bg-white rounded-lg p-6 shadow-xl w-11/12 max-w-sm mx-auto text-center"></div>';
    });
}

// --- OPTIMIZACIÓN PREMIUM DE VER PDF (CACHÉ Y PRE-FETCHING) ---
const URL_CACHE_KEY = 'secure_file_url_cache';

// Cargar caché desde localStorage
function loadUrlCache() {
    try {
        const cached = localStorage.getItem(URL_CACHE_KEY);
        return cached ? JSON.parse(cached) : {};
    } catch (e) {
        return {};
    }
}

// Guardar caché a localStorage
function saveUrlCache(cache) {
    try {
        localStorage.setItem(URL_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
}

const activePrefetches = new Map();

// Resolver enlace de Storage (con pool de promesas y caché inteligente)
async function getSecureFileUrl(filePath) {
    if (!filePath) return '';
    const cache = loadUrlCache();
    const cachedEntry = cache[filePath];
    
    // Verificar si el enlace está en caché y sigue siendo válido
    if (cachedEntry) {
        if (cachedEntry.type === 'direct') {
            return cachedEntry.url;
        }
        if (cachedEntry.type === 'signed' && cachedEntry.expiresAt > Date.now()) {
            return cachedEntry.url;
        }
    }
    
    // Si ya hay una solicitud en vuelo para este mismo archivo, reutilizar su promesa
    if (activePrefetches.has(filePath)) {
        return activePrefetches.get(filePath);
    }
    
    const fetchPromise = (async () => {
        try {
            // Método 1: SDK Cliente Directo (Carga ultra veloz ~100ms)
            const fileRef = ref(storage, filePath);
            const url = await getDownloadURL(fileRef);
            
            const freshCache = loadUrlCache();
            freshCache[filePath] = {
                url: url,
                type: 'direct',
                expiresAt: null
            };
            saveUrlCache(freshCache);
            return url;
        } catch (error) {
            console.warn(`Fallo al obtener enlace directo para ${filePath}, reintentando con Cloud Function...`, error);
            try {
                // Método 2: Respaldo de Cloud Function (Expiración en 10 minutos)
                const getSignedUrl = httpsCallable(functions, 'getSignedUrl');
                const result = await getSignedUrl({ filePath: filePath });
                const url = result.data.url;
                
                const freshCache = loadUrlCache();
                freshCache[filePath] = {
                    url: url,
                    type: 'signed',
                    expiresAt: Date.now() + 10 * 60 * 1000 // Válido por 10 minutos
                };
                saveUrlCache(freshCache);
                return url;
            } catch (cfError) {
                console.error(`Fallo crítico al resolver enlace de archivo seguro para ${filePath}:`, cfError);
                throw cfError;
            }
        } finally {
            activePrefetches.delete(filePath);
        }
    })();
    
    activePrefetches.set(filePath, fetchPromise);
    return fetchPromise;
}

// Prefetch en segundo plano de manera silenciosa
export function prefetchSecureFile(filePath) {
    if (!filePath) return;
    const cache = loadUrlCache();
    const cachedEntry = cache[filePath];
    const isExpired = cachedEntry && cachedEntry.type === 'signed' && cachedEntry.expiresAt <= Date.now();
    
    if (!cachedEntry || isExpired) {
        getSecureFileUrl(filePath).catch(() => {});
    }
}

// Escanear el DOM y precargar todos los PDF visibles con delay staggered (evita ráfagas de red)
export function scanAndPrefetchSecureFiles() {
    const elements = document.querySelectorAll('[data-file-path]');
    let delay = 150;
    elements.forEach(el => {
        const path = el.dataset.filePath;
        if (path) {
            const cache = loadUrlCache();
            const cachedEntry = cache[path];
            const isExpired = cachedEntry && cachedEntry.type === 'signed' && cachedEntry.expiresAt <= Date.now();
            
            if (!cachedEntry || isExpired) {
                setTimeout(() => {
                    prefetchSecureFile(path);
                }, delay);
                delay += 300; // Espaciar solicitudes 300ms
            }
        }
    });
}
window.scanAndPrefetchSecureFiles = scanAndPrefetchSecureFiles;

// Evento Global Click: Apertura instantánea (0ms) si está en caché
document.body.addEventListener('click', (e) => {
    const secureFileButton = e.target.closest('[data-file-path]');
    if (secureFileButton) {
        e.preventDefault();
        const path = secureFileButton.dataset.filePath;
        const title = secureFileButton.dataset.fileTitle || 'Visualizador de Archivo';
        if (path) viewSecureFile(path, title);
    }
});

// Evento Global Hover (PointerOver): Pre-fetch inteligente antes de hacer clic
document.body.addEventListener('pointerover', (e) => {
    const secureFileButton = e.target.closest('[data-file-path]');
    if (secureFileButton) {
        const path = secureFileButton.dataset.filePath;
        if (path) prefetchSecureFile(path);
    }
});

// Evento Global Touch (TouchStart): Pre-fetch inteligente en móviles
document.body.addEventListener('touchstart', (e) => {
    const secureFileButton = e.target.closest('[data-file-path]');
    if (secureFileButton) {
        const path = secureFileButton.dataset.filePath;
        if (path) prefetchSecureFile(path);
    }
}, { passive: true });

async function viewSecureFile(filePath, title) {
    if (!filePath) return;
    
    // Verificar si ya está cargado en el caché para abrir de manera inmediata
    const cache = loadUrlCache();
    const cachedEntry = cache[filePath];
    if (cachedEntry && (cachedEntry.type === 'direct' || (cachedEntry.type === 'signed' && cachedEntry.expiresAt > Date.now()))) {
        showPdfModal(cachedEntry.url, title);
        return;
    }
    
    // Si no está en caché, mostrar modal SweetAlert mientras se resuelve
    if (window.Swal) {
        window.Swal.fire({
            title: 'Generando enlace...',
            allowOutsideClick: false,
            didOpen: () => window.Swal.showLoading()
        });
    }
    
    try {
        const url = await getSecureFileUrl(filePath);
        showPdfModal(url, title);
        if (window.Swal) window.Swal.close();
    } catch (error) {
        if (window.Swal) {
            window.Swal.fire('Error', 'No se pudo obtener el enlace del archivo.', 'error');
        }
    }
}

function showEditProfileModal() {
    const user = currentUserData;
    if (!user) return;

    const isAdmin = user.role?.toLowerCase() === 'admin';
    const disabledAttribute = isAdmin ? '' : 'disabled';
    const disabledClasses = isAdmin ? '' : 'bg-gray-100 cursor-not-allowed';

    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-lg w-full mx-auto text-left">
            <div class="modal-header-fixed">
                <h2 class="text-xl font-bold text-slate-800">Editar Mi Perfil</h2>
                <button id="close-profile-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="edit-profile-form" class="modal-body-scroll space-y-4">
                <div class="space-y-4">
                    <div>
                        <label for="profile-name" class="block text-sm font-semibold text-slate-700">Nombre Completo</label>
                        <input type="text" id="profile-name" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all ${disabledClasses}" value="${user.nombre || ''}" required ${disabledAttribute}>
                    </div>
                    <div>
                        <label for="profile-cedula" class="block text-sm font-semibold text-slate-700">Cédula</label>
                        <input type="text" id="profile-cedula" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all ${disabledClasses}" value="${user.cedula || ''}" required ${disabledAttribute}>
                    </div>
                    <div>
                        <label for="profile-dob" class="block text-sm font-semibold text-slate-700">Fecha de Nacimiento</label>
                        <input type="date" id="profile-dob" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all ${disabledClasses}" value="${user.dob || ''}" required ${disabledAttribute}>
                    </div>
                </div>
                <hr class="border-slate-200 my-4" />
                <div class="space-y-4">
                    <div>
                        <label for="profile-phone" class="block text-sm font-semibold text-slate-700">Celular</label>
                        <input type="tel" id="profile-phone" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all" value="${user.telefono || ''}" required>
                    </div>
                    <div>
                        <label for="profile-address" class="block text-sm font-semibold text-slate-700">Dirección</label>
                        <input type="text" id="profile-address" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all" value="${user.direccion || ''}">
                    </div>
                    <div>
                        <label for="profile-email" class="block text-sm font-semibold text-slate-700">Correo Electrónico</label>
                        <input type="email" id="profile-email" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all" value="${user.email || ''}" required>
                        <p class="text-xs text-slate-500 mt-1">Cambiar tu correo requiere que vuelvas a iniciar sesión.</p>
                    </div>
                </div>
                <div class="flex justify-end pt-4">
                    <button type="submit" class="w-full bg-indigo-650 text-white font-bold py-3 px-4 rounded-xl hover:bg-indigo-700 transition-colors shadow-sm">Guardar Cambios</button>
                </div>
            </form>
        </div>`;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-profile-modal').addEventListener('click', hideModal);

    document.getElementById('edit-profile-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newEmail = document.getElementById('profile-email').value;

        let updatedData = {
            telefono: document.getElementById('profile-phone').value,
            direccion: document.getElementById('profile-address').value,
            email: newEmail
        };

        if (isAdmin) {
            updatedData.nombre = document.getElementById('profile-name').value;
            updatedData.cedula = document.getElementById('profile-cedula').value;
            updatedData.dob = document.getElementById('profile-dob').value;
        }

        showModalMessage("Guardando cambios...", true);
        try {
            await updateDoc(doc(db, "users", currentUser.uid), updatedData);
            if (currentUser.email !== newEmail) {
                await updateEmail(auth.currentUser, newEmail);
            }
            hideModal();
            showModalMessage("Perfil actualizado con éxito.", false, 2000);
        } catch (error) {
            console.error("Error al actualizar perfil:", error);
            let errorMessage = "Error al guardar los cambios.";
            if (error.code === 'auth/requires-recent-login') {
                errorMessage = "Para cambiar tu correo, debes cerrar sesión y volver a entrar por seguridad."
            }
            showModalMessage(errorMessage);
        }
    });
}

// Lógica visual para habilitar/deshabilitar input de stock si es Infinito
document.body.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'nuevo-item-stock-infinito') {
        const stockInput = document.getElementById('nuevo-item-stock');
        if (e.target.checked) {
            stockInput.value = '';
            stockInput.disabled = true;
            stockInput.required = false;
            stockInput.classList.add('bg-gray-200', 'cursor-not-allowed');
        } else {
            stockInput.disabled = false;
            stockInput.required = true;
            stockInput.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    }
});