// js/app.js (Versión Modularizada - Controlador Principal LIMPIO)

import { auth, db, storage, functions, analytics } from './firebase-config.js';
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

import { signInWithEmailAndPassword, signOut, onAuthStateChanged, updateEmail } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
import { logEvent } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-analytics.js";

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
        funciones: document.getElementById('tab-funciones') 
    };
    const views = {
        remisiones: document.getElementById('view-remisiones'), facturacion: document.getElementById('view-facturacion'),
        inventario: document.getElementById('view-inventario'), clientes: document.getElementById('view-clientes'),
        gastos: document.getElementById('view-gastos'), proveedores: document.getElementById('view-proveedores'),
        empleados: document.getElementById('view-empleados'), items: document.getElementById('view-items'),
        funciones: document.getElementById('view-funciones') 
    };
    switchView(initialView, tabs, views);

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
            <h2 class="text-2xl font-bold text-center mb-6">Crear Cuenta</h2>
            <div class="space-y-4">
                <input type="text" id="register-name" placeholder="Nombre Completo" class="w-full p-3 border border-gray-300 rounded-lg" required>
                <input type="text" id="register-cedula" placeholder="Cédula" class="w-full p-3 border border-gray-300 rounded-lg" required>
                <input type="tel" id="register-phone" placeholder="Celular" class="w-full p-3 border border-gray-300 rounded-lg" required>
                <input type="text" id="register-address" placeholder="Dirección" class="w-full p-3 border border-gray-300 rounded-lg">
                <input type="email" id="register-email" placeholder="Correo Electrónico" class="w-full p-3 border border-gray-300 rounded-lg" required>
                <input type="password" id="register-password" placeholder="Contraseña (mín. 6 caracteres)" class="w-full p-3 border border-gray-300 rounded-lg" required>
                <div><label for="register-dob" class="block text-sm font-medium text-gray-700">Fecha de Nacimiento</label><input type="date" id="register-dob" class="w-full p-3 border border-gray-300 rounded-lg mt-1" required></div>
                <div class="flex items-center space-x-2">
                    <input type="checkbox" id="register-politica" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" required>
                    <label for="register-politica" class="text-sm text-gray-600">
                        Acepto la <a href="#" id="show-policy-link" class="font-semibold text-indigo-600 hover:underline">Política de Tratamiento de Datos</a>.
                    </label>
                </div>
                <button type="submit" class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700">Registrarse</button>
            </div>
            <p class="text-center mt-4 text-sm">¿Ya tienes una cuenta? <a href="#" id="show-login-link-register" class="font-semibold text-indigo-600 hover:underline">Inicia sesión</a></p>
        `;
    }

    const viewInventario = document.getElementById('view-inventario');
    if (viewInventario) {
        viewInventario.innerHTML = `
        <div class="bg-white p-6 rounded-xl shadow-md max-w-7xl mx-auto">
            <div class="border-b border-gray-200 mb-6">
                <nav id="inventario-nav" class="-mb-px flex space-x-6">
                    <button id="tab-importaciones" class="dashboard-tab-btn active py-3 px-1 font-semibold">Importaciones</button>
                    <button id="tab-nacional" class="dashboard-tab-btn py-3 px-1 font-semibold">Compras Nacionales</button>
                </nav>
            </div>
            <div id="view-importaciones-content">
                <div class="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
                    <h2 class="text-xl font-semibold">Gestión de Importaciones</h2>
                    <button id="add-importacion-btn" class="bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700 w-full sm:w-auto">+ Nueva Importación</button>
                </div>
                <div id="importaciones-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6"></div>
                </div>
            <div id="view-nacional-content" class="hidden">
                <div class="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
                    <h2 class="text-xl font-semibold">Gestión de Compras Nacionales</h2>
                    <button id="add-nacional-btn" class="bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700 w-full sm:w-auto">+ Nueva Compra Nacional</button>
                </div>
                <div id="nacional-list" class="space-y-4">
                    <p class="text-center text-gray-500 py-8">Aún no se han registrado compras nacionales.</p>
                </div>
            </div>
        </div>`;
    }

    const viewItems = document.getElementById('view-items');
    if (viewItems) {
        viewItems.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md">
                <h2 class="text-xl font-semibold mb-4">Añadir Nuevo Ítem</h2>
                <form id="add-item-form" class="space-y-4">
                    
                    <div class="bg-gray-50 p-3 rounded-lg border border-gray-200 mb-2">
                        <label class="flex items-center space-x-2 cursor-pointer">
                            <input type="checkbox" id="nuevo-item-es-unidad" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                            <span class="text-sm font-semibold text-gray-800">Se vende por Unidad (Ej: Silicona, Herrajes)</span>
                        </label>
                    </div>

                    <div>
                        <label for="nuevo-item-tipo" class="block text-sm font-medium text-gray-700">Tipo de Ítem</label>
                        <input type="text" id="nuevo-item-tipo" class="w-full p-2 border border-gray-300 rounded-lg mt-1" placeholder="Ej: Vidrio, Espejo, Silicona" required>
                    </div>
                    <div>
                        <label for="nuevo-item-color" class="block text-sm font-medium text-gray-700">Color o Detalle</label>
                        <input type="text" id="nuevo-item-color" class="w-full p-2 border border-gray-300 rounded-lg mt-1" placeholder="Ej: Claro, Crudo, Transparente" required>
                    </div>
                    
                    <div id="nuevo-item-medidas-container" class="grid grid-cols-2 gap-4">
                        <div>
                            <label for="nuevo-item-ancho" class="block text-sm font-medium text-gray-700">Ancho Muestra (mm)</label>
                            <input type="number" id="nuevo-item-ancho" class="w-full p-2 border border-gray-300 rounded-lg mt-1" placeholder="Ej: 3600">
                        </div>
                        <div>
                            <label for="nuevo-item-alto" class="block text-sm font-medium text-gray-700">Alto Muestra (mm)</label>
                            <input type="number" id="nuevo-item-alto" class="w-full p-2 border border-gray-300 rounded-lg mt-1" placeholder="Ej: 2600">
                        </div>
                    </div>
                    
                    <div id="nuevo-item-caja-container">
                        <label for="nuevo-item-laminas-por-caja" class="block text-sm font-medium text-gray-700">Láminas por Caja</label>
                        <input type="number" id="nuevo-item-laminas-por-caja" class="w-full p-2 border border-gray-300 rounded-lg mt-1" placeholder="Ej: 40">
                    </div>

                    <div class="bg-gray-50 p-3 rounded-lg border border-gray-200 mt-2">
                        <label class="flex items-center space-x-2 cursor-pointer mb-2">
                            <input type="checkbox" id="nuevo-item-stock-infinito" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                            <span class="text-sm font-semibold text-gray-800">Stock Infinito (Servicios / No descontar)</span>
                        </label>
                        <div id="nuevo-item-stock-container">
                            <label for="nuevo-item-stock" class="block text-sm font-medium text-gray-700">Stock Inicial</label>
                            <input type="number" id="nuevo-item-stock" class="w-full p-2 border border-gray-300 rounded-lg mt-1" required>
                        </div>
                    </div>
                    <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700 transition-colors">Guardar Ítem</button>
                </form>
            </div>
            <div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Inventario de Ítems</h2>
                    <input type="search" id="search-items" placeholder="Buscar..." class="p-2 border rounded-lg">
                </div>
                <div id="items-list" class="space-y-3"></div>
            </div>
        </div>`;
    }

    const viewRemisiones = document.getElementById('view-remisiones');
    if (viewRemisiones) {
        viewRemisiones.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div id="remision-form-container" class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md">
                <h2 class="text-xl font-semibold mb-4">Nueva Remisión</h2>
                <form id="remision-form" class="space-y-4">
                    <div class="relative">
                        <input type="text" id="cliente-search-input" autocomplete="off" placeholder="Buscar y seleccionar cliente..." class="w-full p-3 border border-gray-300 rounded-lg" required>
                        <input type="hidden" id="cliente-id-hidden" name="clienteId">
                        <div id="cliente-search-results" class="search-results hidden"></div>
                    </div>
                    <div>
                        <label for="fecha-recibido" class="block text-sm font-medium text-gray-700">Fecha Remisión</label>
                        <input type="date" id="fecha-recibido" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-gray-100" value="${new Date().toISOString().split('T')[0]}" readonly>
                    </div>
                    <div class="border-t border-b border-gray-200 py-4">
                        <h3 class="text-lg font-semibold mb-2">Ítems de la Remisión</h3>
                        <div id="items-container" class="space-y-4"></div>
                        <button type="button" id="add-item-btn" class="mt-4 w-full bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors">+ Añadir Ítem</button>
                    </div>
                    <select id="forma-pago" class="w-full p-3 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed text-gray-600 font-semibold" disabled>
                        <option value="Pendiente" selected>Pendiente</option>
                    </select>
                    <div>
                        <label for="remision-observaciones" class="block text-sm font-medium text-gray-700">Observaciones</label>
                        <textarea id="remision-observaciones" rows="3" class="w-full p-3 border border-gray-300 rounded-lg mt-1" placeholder="Añade aquí cualquier nota o instrucción especial..."></textarea>
                    </div>
                    <div class="bg-gray-50 p-4 rounded-lg space-y-2">
                        <div class="flex justify-between items-center"><span class="font-medium">Subtotal:</span><span id="subtotal" class="font-bold text-lg">$ 0</span></div>
                        <div class="flex justify-between items-center"><label for="incluir-iva" class="flex items-center space-x-2 cursor-pointer"><input type="checkbox" id="incluir-iva" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"><span>Incluir IVA (19%)</span></label><span id="valor-iva" class="font-medium text-gray-600">$ 0</span></div>
                        <hr>
                        <div class="flex justify-between items-center text-xl"><span class="font-bold">TOTAL:</span><span id="valor-total" class="font-bold text-indigo-600">$ 0</span></div>
                    </div>
                    <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 transition-colors">Guardar Remisión</button>
                </form>
            </div>
            <div id="remisiones-list-container" class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
                
                <div class="flex flex-col gap-4 mb-4">
                    
                    <div class="flex items-center justify-between w-full">
                        <h2 class="text-xl font-semibold">Historial de Remisiones</h2>
                        <button id="btn-pending-payments" class="relative bg-yellow-500 text-white p-2 rounded-full hover:bg-yellow-600 hidden transition-all shadow-md" title="Pagos por Confirmar">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1m-4.5 9h11a2 2 0 002-2v-1a2 2 0 00-2-2h-1.5M7.5 17H4a2 2 0 01-2-2v-1a2 2 0 012-2h1.5"></path>
                            </svg>
                            <span id="badge-pending-payments" class="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full shadow border-2 border-white">0</span>
                        </button>
                    </div>

                    <div class="flex flex-col sm:flex-row gap-2 w-full">
                        <select id="filter-remisiones-month" class="p-2 border border-gray-300 rounded-lg bg-white flex-1"></select>
                        <select id="filter-remisiones-year" class="p-2 border border-gray-300 rounded-lg bg-white flex-1"></select>
                        <input type="search" id="search-remisiones" placeholder="Buscar cliente o remisión..." class="p-2 border border-gray-300 rounded-lg flex-1 sm:flex-[2]">
                    </div>

                </div>

                <div id="remisiones-list" class="space-y-3"></div>
            </div>
        </div>`;
    }

    const viewFacturacion = document.getElementById('view-facturacion');
    if (viewFacturacion) {
        viewFacturacion.innerHTML = `
        <div class="bg-white p-6 rounded-xl shadow-md max-w-7xl mx-auto">
            <h2 class="text-2xl font-semibold mb-4">Gestión de Facturación</h2>
            <div class="border-b border-gray-200 mb-6 flex flex-col lg:flex-row justify-between items-end gap-4 pb-2">
                <nav id="facturacion-nav" class="-mb-px flex space-x-6">
                    <button id="tab-pendientes" class="dashboard-tab-btn active py-3 px-1 font-semibold text-gray-500 hover:text-gray-800 border-b-2 border-transparent hover:border-gray-300">Pendientes</button>
                    <button id="tab-realizadas" class="dashboard-tab-btn py-3 px-1 font-semibold text-gray-500 hover:text-gray-800 border-b-2 border-transparent hover:border-gray-300">Realizadas</button>
                </nav>
                <div class="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                    <div class="flex items-center gap-1 bg-gray-50 p-1 rounded-lg border border-gray-200">
                        <span class="text-xs font-semibold text-gray-500 pl-2">Desde:</span>
                        <input type="month" id="factura-filter-start" class="p-1 bg-white border border-gray-300 rounded text-sm focus:ring-indigo-500 focus:border-indigo-500">
                        <span class="text-xs font-semibold text-gray-500">Hasta:</span>
                        <input type="month" id="factura-filter-end" class="p-1 bg-white border border-gray-300 rounded text-sm focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                    <div class="relative flex-grow lg:flex-grow-0">
                        <input type="search" id="search-facturacion" placeholder="Buscar cliente, N° remisión..." class="w-full lg:w-64 p-2 pl-3 border border-gray-300 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                </div>
            </div>
            <div id="view-pendientes">
                <h3 class="text-xl font-semibold text-gray-800 mb-4">Remisiones Pendientes de Facturar</h3>
                <div id="facturacion-pendientes-list" class="space-y-3"></div>
            </div>
            <div id="view-realizadas" class="hidden">
                <h3 class="text-xl font-semibold text-gray-800 mb-4">Remisiones Facturadas</h3>
                <div id="facturacion-realizadas-list" class="space-y-3"></div>
            </div>
        </div>`;
    }

    const viewClientes = document.getElementById('view-clientes');
    if (viewClientes) {
        viewClientes.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md">
                <h2 class="text-xl font-semibold mb-4">Añadir Cliente</h2>
                <form id="add-cliente-form" class="space-y-4">
                    <input type="text" id="nuevo-cliente-nombre-empresa" placeholder="Nombre Empresa" class="w-full p-3 border border-gray-300 rounded-lg" required>
                    <input type="text" id="nuevo-cliente-contacto" placeholder="Nombre del Contacto" class="w-full p-3 border border-gray-300 rounded-lg">
                    <input type="email" id="nuevo-cliente-email" placeholder="Correo Electrónico" class="w-full p-3 border border-gray-300 rounded-lg">
                    <input type="tel" id="nuevo-cliente-telefono1" placeholder="Teléfono 1" class="w-full p-3 border border-gray-300 rounded-lg" required oninput="this.value = this.value.replace(/[^0-9]/g, '')">
                    <input type="tel" id="nuevo-cliente-telefono2" placeholder="Teléfono 2 (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
                    <input type="text" id="nuevo-cliente-nit" placeholder="NIT (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg">
                    <div class="space-y-1">
                        <label for="nuevo-cliente-rut" class="block text-sm font-medium text-gray-700">RUT (Opcional)</label>
                        <input type="file" id="nuevo-cliente-rut" class="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/>
                    </div>
                    <button type="submit" class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700">Registrar</button>
                </form>
            </div>
            <div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Clientes</h2>
                    <input type="search" id="search-clientes" placeholder="Buscar..." class="p-2 border rounded-lg">
                </div>
                <div id="clientes-list" class="space-y-3"></div>
            </div>
        </div>`;
    }
    
    const viewProveedores = document.getElementById('view-proveedores');
    if (viewProveedores) {
        viewProveedores.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md">
                <h2 class="text-xl font-semibold mb-4">Añadir Proveedor</h2>
                <form id="add-proveedor-form" class="space-y-4">
                    <input type="text" id="nuevo-proveedor-nombre" placeholder="Nombre del Proveedor" class="w-full p-3 border border-gray-300 rounded-lg" required>
                    <input type="text" id="nuevo-proveedor-contacto" placeholder="Nombre de Contacto" class="w-full p-3 border border-gray-300 rounded-lg">
                    <input type="tel" id="nuevo-proveedor-telefono" placeholder="Teléfono" class="w-full p-3 border border-gray-300 rounded-lg">
                    <input type="email" id="nuevo-proveedor-email" placeholder="Correo" class="w-full p-3 border border-gray-300 rounded-lg">
                    <div>
                        <label for="nuevo-proveedor-rut" class="block text-sm font-medium text-gray-700">RUT (Opcional)</label>
                        <input type="file" id="nuevo-proveedor-rut" class="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"/>
                    </div>
                    <button type="submit" class="w-full bg-teal-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-teal-700">Registrar</button>
                </form>
            </div>
            <div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Proveedores</h2>
                    <input type="search" id="search-proveedores" placeholder="Buscar..." class="p-2 border rounded-lg">
                </div>
                <div id="proveedores-list" class="space-y-3"></div>
            </div>
        </div>`;
    }

    const viewGastos = document.getElementById('view-gastos');
    if (viewGastos) {
        viewGastos.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md">
                <h2 class="text-xl font-semibold mb-4">Nuevo Gasto</h2>
                <form id="add-gasto-form" class="space-y-4">
                    <div>
                        <label for="gasto-fecha">Fecha</label>
                        <input type="date" id="gasto-fecha" class="w-full p-3 border border-gray-300 rounded-lg mt-1" required>
                    </div>
                    <div class="relative">
                        <label for="proveedor-search-input">Proveedor</label>
                        <input type="text" id="proveedor-search-input" autocomplete="off" placeholder="Buscar..." class="w-full p-3 border border-gray-300 rounded-lg mt-1" required>
                        <input type="hidden" id="proveedor-id-hidden" name="proveedorId">
                        <div id="proveedor-search-results" class="search-results hidden"></div>
                    </div>
                    <input type="text" id="gasto-factura" placeholder="N° de Factura (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg">
                    <input type="text" id="gasto-valor-total" inputmode="numeric" placeholder="Valor Total" class="w-full p-3 border border-gray-300 rounded-lg" required>
                    <label class="flex items-center space-x-2">
                        <input type="checkbox" id="gasto-iva" class="h-4 w-4 rounded border-gray-300">
                        <span>IVA del 19% incluido</span>
                    </label>
                    <div>
                        <label for="gasto-fuente">Fuente del Pago</label>
                        <select id="gasto-fuente" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-white" required>
                            ${metodosDePagoHTML}
                        </select>
                    </div>
                    <button type="submit" class="w-full bg-orange-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-orange-700">Registrar</button>
                </form>
            </div>
            <div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
                <div class="flex justify-between items-center pb-4 border-b">
                    <h2 class="text-xl font-semibold">Historial de Gastos</h2>
                    <button id="export-gastos-btn" class="bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700 flex-shrink-0">
                        Exportar a Excel
                    </button>
                </div>
                <div class="flex flex-col sm:flex-row gap-4 my-4 p-4 bg-gray-50 rounded-lg">
                    <div class="flex-1">
                        <label for="filter-gastos-month" class="text-sm font-medium text-gray-700">Mes</label>
                        <select id="filter-gastos-month" class="p-2 border rounded-lg bg-white w-full mt-1"></select>
                    </div>
                    <div class="flex-1">
                        <label for="filter-gastos-year" class="text-sm font-medium text-gray-700">Año</label>
                        <select id="filter-gastos-year" class="p-2 border rounded-lg bg-white w-full mt-1"></select>
                    </div>
                    <div class="flex-1">
                        <label for="search-gastos" class="text-sm font-medium text-gray-700">Buscar</label>
                        <input type="search" id="search-gastos" placeholder="Por proveedor o factura..." class="p-2 border rounded-lg w-full mt-1">
                    </div>
                </div>
                <div id="gastos-list" class="space-y-3"></div>
            </div>
        </div>`;
    }

    const viewEmpleados = document.getElementById('view-empleados');
    if (viewEmpleados) {
        viewEmpleados.innerHTML = `<div class="bg-white p-6 rounded-xl shadow-md max-w-4xl mx-auto"><h2 class="text-xl font-semibold mb-4">Gestión de Empleados</h2><div id="empleados-list" class="space-y-3"></div></div>`;
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
            <div class="bg-white p-6 rounded-xl shadow-md max-w-4xl mx-auto">
                <h2 class="text-xl font-semibold mb-6 text-gray-800">Funciones y Reportes del Sistema</h2>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="border p-5 rounded-lg text-center bg-gray-50 hover:bg-gray-100 transition-colors">
                        <div class="text-4xl mb-3">📊</div>
                        <h3 class="font-bold text-lg mb-2">Exportar Gastos</h3>
                        <p class="text-sm text-gray-600 mb-4">Descarga un archivo Excel detallado de todos los gastos registrados en el sistema.</p>
                        <button id="btn-func-export-gastos" class="bg-indigo-600 text-white font-bold py-2 px-6 rounded-full hover:bg-indigo-700">Exportar Gastos</button>
                    </div>
                    <div class="border p-5 rounded-lg text-center bg-gray-50 hover:bg-gray-100 transition-colors">
                        <div class="text-4xl mb-3">💰</div>
                        <h3 class="font-bold text-lg mb-2">Exportar Pagos</h3>
                        <p class="text-sm text-gray-600 mb-4">Descarga un archivo Excel con el historial de abonos y pagos de remisiones.</p>
                        <button id="btn-func-export-pagos" class="bg-green-600 text-white font-bold py-2 px-6 rounded-full hover:bg-green-700">Exportar Pagos</button>
                    </div>
                </div>
            </div>
        `;
    }
}

function updateUIVisibility(userData) {
    if (!userData) return;
    const isAdmin = userData.role?.toLowerCase() === 'admin';

    ALL_MODULES.forEach(module => {
        const tab = document.getElementById(`tab-${module}`);
        if (tab) {
            let hasPermission = isAdmin || (userData.permissions && userData.permissions[module]);
            tab.classList.toggle('hidden', !hasPermission);
        }
    });

    const viewAllLoansBtn = document.getElementById('view-all-loans-btn');
    if(viewAllLoansBtn) viewAllLoansBtn.style.display = isAdmin ? 'block' : 'none';
    
    const summaryBtn = document.getElementById('summary-btn');
    if(summaryBtn) summaryBtn.style.display = isAdmin ? 'block' : 'none';
    
    const loanReqBtn = document.getElementById('loan-request-btn');
    if(loanReqBtn) loanReqBtn.style.display = isAdmin ? 'none' : 'block';

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
    const modulePriority = ['remisiones', 'facturacion', 'inventario', 'items', 'clientes', 'gastos', 'proveedores', 'empleados'];
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
    submitButton.textContent = 'Registrando...';
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
    const nombre = document.getElementById('register-name').value;
    const cedula = document.getElementById('register-cedula').value;
    const telefono = document.getElementById('register-phone').value;
    const direccion = document.getElementById('register-address').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const dob = document.getElementById('register-dob').value;
    showModalMessage("Registrando...", true);
    try {
        const role = 'planta';
        const status = 'pending';
        const permissions = {
            remisiones: true, prestamos: true,
            facturacion: false, clientes: false,
            gastos: false, proveedores: false, empleados: false
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
        showModalMessage("Error de registro: " + error.message);
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
    const tabs = {
        remisiones: document.getElementById('tab-remisiones'), facturacion: document.getElementById('tab-facturacion'),
        inventario: document.getElementById('tab-inventario'), clientes: document.getElementById('tab-clientes'),
        gastos: document.getElementById('tab-gastos'), proveedores: document.getElementById('tab-proveedores'),
        empleados: document.getElementById('tab-empleados'), items: document.getElementById('tab-items'),
        funciones: document.getElementById('tab-funciones') // <--- AÑADIDO
    };
    const views = {
        remisiones: document.getElementById('view-remisiones'), facturacion: document.getElementById('view-facturacion'),
        inventario: document.getElementById('view-inventario'), clientes: document.getElementById('view-clientes'),
        gastos: document.getElementById('view-gastos'), proveedores: document.getElementById('view-proveedores'),
        empleados: document.getElementById('view-empleados'), items: document.getElementById('view-items'),
        funciones: document.getElementById('view-funciones') // <--- AÑADIDO
    };
    Object.keys(tabs).forEach(key => {
        if (tabs[key]) tabs[key].addEventListener('click', () => switchView(key, tabs, views));
    });

    document.getElementById('summary-btn')?.addEventListener('click', showDashboardModal);
    document.getElementById('edit-profile-btn')?.addEventListener('click', showEditProfileModal);

    document.getElementById('show-policy-link')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('policy-modal').classList.remove('hidden'); });
    document.getElementById('close-policy-modal')?.addEventListener('click', () => { document.getElementById('policy-modal').classList.add('hidden'); });
    document.getElementById('accept-policy-btn')?.addEventListener('click', () => { document.getElementById('policy-modal').classList.add('hidden'); });

    // INICIALIZAR EVENTOS DE MÓDULOS DE FORMA LIMPIA
    setupClientesEvents();
    setupProveedoresEvents();
    setupItemsEvents();
    setupGastosEvents();
    setupEmpleadosEvents();
    setupInventarioEvents();
    setupRemisionesEvents();
    setupFacturacionEvents();
    setupFuncionesEvents(); // <--- AÑADE ESTO AL FINAL
}

function switchView(viewName, tabs, views) {
    Object.values(tabs).forEach(tab => { if (tab) tab.classList.remove('active') });
    Object.values(views).forEach(view => { if (view) view.classList.add('hidden') });
    if (tabs[viewName]) tabs[viewName].classList.add('active');
    if (views[viewName]) views[viewName].classList.remove('hidden');
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

document.body.addEventListener('click', (e) => {
    const secureFileButton = e.target.closest('[data-file-path]');
    if (secureFileButton) {
        e.preventDefault();
        const path = secureFileButton.dataset.filePath;
        const title = secureFileButton.dataset.fileTitle || 'Visualizador de Archivo';
        if (path) viewSecureFile(path, title);
    }
});

async function viewSecureFile(filePath, title) {
    if (!filePath) return;
    if(window.Swal) window.Swal.fire({ title: 'Generando enlace...', allowOutsideClick: false, didOpen: () => window.Swal.showLoading() });
    try {
        const getSignedUrl = httpsCallable(functions, 'getSignedUrl');
        const result = await getSignedUrl({ filePath: filePath });
        showFileModal(result.data.url, title);
        if(window.Swal) window.Swal.close();
    } catch (error) {
        if(window.Swal) window.Swal.fire('Error', 'No se pudo obtener el enlace.', 'error');
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
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Editar Mi Perfil</h2>
                <button id="close-profile-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="edit-profile-form" class="space-y-4">
                <div>
                    <label for="profile-name" class="block text-sm font-medium">Nombre Completo</label>
                    <input type="text" id="profile-name" class="w-full p-2 border rounded-lg mt-1 ${disabledClasses}" value="${user.nombre || ''}" required ${disabledAttribute}>
                </div>
                <div>
                    <label for="profile-cedula" class="block text-sm font-medium">Cédula</label>
                    <input type="text" id="profile-cedula" class="w-full p-2 border rounded-lg mt-1 ${disabledClasses}" value="${user.cedula || ''}" required ${disabledAttribute}>
                </div>
                <div>
                    <label for="profile-dob" class="block text-sm font-medium">Fecha de Nacimiento</label>
                    <input type="date" id="profile-dob" class="w-full p-2 border rounded-lg mt-1 ${disabledClasses}" value="${user.dob || ''}" required ${disabledAttribute}>
                </div>
                <hr/>
                <div>
                    <label for="profile-phone" class="block text-sm font-medium">Celular</label>
                    <input type="tel" id="profile-phone" class="w-full p-2 border rounded-lg mt-1" value="${user.telefono || ''}" required>
                </div>
                <div>
                    <label for="profile-address" class="block text-sm font-medium">Dirección</label>
                    <input type="text" id="profile-address" class="w-full p-2 border rounded-lg mt-1" value="${user.direccion || ''}">
                </div>
                <div>
                    <label for="profile-email" class="block text-sm font-medium">Correo Electrónico</label>
                    <input type="email" id="profile-email" class="w-full p-2 border rounded-lg mt-1" value="${user.email || ''}" required>
                    <p class="text-xs text-gray-500 mt-1">Cambiar tu correo requiere que vuelvas a iniciar sesión.</p>
                </div>
                <div class="flex justify-end pt-4">
                    <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Guardar Cambios</button>
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