// js/app.js (Versión Definitiva con Corrección en el Manejo de Formularios Dinámicos)

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateEmail } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, query, orderBy, onSnapshot, deleteDoc, updateDoc, addDoc, runTransaction, arrayUnion, where, writeBatch } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-analytics.js";

// --- INICIALIZACIÓN Y CONFIGURACIÓN ---
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

// --- VISTAS Y ESTADO GLOBAL ---

const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const deniedView = document.getElementById('denied-view');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
let currentUser = null;
let currentUserData = null;
let allClientes = [], allProveedores = [], allGastos = [], allRemisiones = [], allUsers = [], allItems = [], allPendingLoans = [], allImportaciones = [], profitLossChart = null, allItemAverageCosts = {}, allComprasNacionales = [];
let dynamicElementCounter = 0;
let isRegistering = false;
let modalTimeout;
let initialBalances = {};
let unsubscribePendingTransfers = null;

const METODOS_DE_PAGO_IMPORTACION = ['Efectivo', 'Nequi', 'Bancolombia', 'Transferencia'];
const METODOS_DE_PAGO = ['Efectivo', 'Nequi', 'Bancolombia'];
const ESTADOS_REMISION = ['Recibido', 'En Proceso', 'Procesado', 'Entregado'];
const ALL_MODULES = ['remisiones', 'facturacion', 'inventario', 'clientes', 'gastos', 'proveedores', 'prestamos', 'empleados', 'items'];
const RRHH_DOCUMENT_TYPES = [
    { id: 'contrato', name: 'Contrato' }, { id: 'hojaDeVida', name: 'Hoja de Vida' }, { id: 'examenMedico', name: 'Examen Médico' }, { id: 'cedula', name: 'Cédula (PDF)' }, { id: 'certificadoARL', name: 'Certificado ARL' }, { id: 'certificadoEPS', name: 'Certificado EPS' }, { id: 'certificadoAFP', name: 'Certificado AFP' }, { id: 'cartaRetiro', name: 'Carta de renuncia o despido' }, { id: 'liquidacionDoc', name: 'Liquidación' },
];
const GASTOS_IMPORTACION = [
    { id: 'pi', name: 'PI' }, { id: 'factura', name: 'Factura' }, { id: 'packingList', name: 'Packing List' }, { id: 'gastosNaviera', name: 'Gastos Naviera' }, { id: 'gastosPuerto', name: 'Gastos Puerto' }, { id: 'gastosAduana', name: 'Gastos Aduana' }, { id: 'dropOff', name: 'Drop Off' }, { id: 'gastosTransporte', name: 'Gastos Transporte' }, { id: 'gastosMontacarga', name: 'Gastos Montacarga' }
];
// AÑADE ESTAS NUEVAS CONSTANTES
const DOCUMENTOS_IMPORTACION = [
    { id: 'provideInvoice', name: 'Provide Invoice' },
    { id: 'facturaComercial', name: 'Factura Comercial' },
    { id: 'packingList', name: 'Packing List' },
    { id: 'bl', name: 'BL' },
    { id: 'seguroDoc', name: 'Póliza de Seguro' },
    { id: 'docAduana', name: 'Documentos Enviados por Aduana' } // <-- LÍNEA AÑADIDA
];

// Cerca del inicio de tu archivo, busca esta constante y reemplázala:
const GASTOS_NACIONALIZACION = [
    { id: 'iva', name: 'IVA' },           // <-- AÑADIDO
    { id: 'arancel', name: 'Arancel' },   // <-- AÑADIDO
    { id: 'naviera', name: 'Naviera' },
    { id: 'puerto', name: 'Puerto' },
    { id: 'aduana', name: 'Aduana' },
    { id: 'transporte', name: 'Transporte' },
    { id: 'montacarga', name: 'Montacarga' }

];

// --- MANEJO DE AUTENTICACIÓN Y VISTAS ---
let activeListeners = [];
function unsubscribeAllListeners() {
    activeListeners.forEach(unsubscribe => unsubscribe());
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
                authView.classList.add('hidden');
                deniedView.classList.add('hidden');
                appView.classList.remove('hidden');
                startApp();
            } else {
                let message = "Tu cuenta está pendiente de aprobación.";
                if (currentUserData.status === 'inactive') message = "Tu cuenta ha sido desactivada temporalmente.";
                if (currentUserData.status === 'archived') message = "Tu cuenta ha sido archivada y no puedes acceder.";
                document.getElementById('denied-message').textContent = message;
                authView.classList.add('hidden');
                appView.classList.add('hidden');
                deniedView.classList.remove('hidden');
            }
        } else {
            signOut(auth);
        }
    } else {
        currentUser = null;
        currentUserData = null;
        appView.classList.add('hidden');
        deniedView.classList.add('hidden');
        authView.classList.remove('hidden');
        isAppInitialized = false;
    }
});


/**
 * --- INICIO DE LA APLICACIÓN (LÓGICA FINAL Y ROBUSTA) ---
 * Esta es la nueva secuencia de inicio a prueba de errores. Se asegura de que
 * todo el HTML de las vistas exista antes de intentar asignarles eventos.
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Lo primero y más importante: construir toda la estructura HTML de las vistas.
    loadViewTemplates();

    // 2. Asignar listeners a los formularios de login/registro, que son estáticos y siempre existen.
    loginForm.addEventListener('submit', handleLoginSubmit);
    registerForm.addEventListener('submit', handleRegisterSubmit);
    document.getElementById('show-register-link').addEventListener('click', (e) => { e.preventDefault(); loginForm.classList.add('hidden'); registerForm.classList.remove('hidden'); });
    document.getElementById('logout-denied-user').addEventListener('click', () => signOut(auth));

    // 3. Dejar que Firebase maneje el estado de autenticación.
    // onAuthStateChanged se encargará de llamar a startApp() una vez que
    // el usuario esté verificado, garantizando que el HTML base ya está cargado.
});


/**
 * --- VERSIÓN CORREGIDA Y ROBUSTA ---
 * Inicia la aplicación principal DESPUÉS de que el usuario se ha autenticado
 * y el DOM inicial está listo.
 */
function startApp() {
    if (isAppInitialized) return;

    console.log("Iniciando la aplicación principal...");

    // 1. Ajustar la visibilidad de la UI según los permisos del usuario.
    updateUIVisibility(currentUserData);

    // 2. Asignar los listeners generales de la aplicación.
    setupEventListeners();

    // --- INICIO DE LA NUEVA LÓGICA ---
    // 3. Determinar y cambiar a la vista inicial correcta.
    const initialView = getInitialViewForUser(currentUserData);

    // Obtenemos las referencias a las pestañas y vistas
    const tabs = {
        remisiones: document.getElementById('tab-remisiones'),
        facturacion: document.getElementById('tab-facturacion'),
        inventario: document.getElementById('tab-inventario'),
        clientes: document.getElementById('tab-clientes'),
        gastos: document.getElementById('tab-gastos'),
        proveedores: document.getElementById('tab-proveedores'),
        empleados: document.getElementById('tab-empleados'),
        items: document.getElementById('tab-items')
    };
    const views = {
        remisiones: document.getElementById('view-remisiones'),
        facturacion: document.getElementById('view-facturacion'),
        inventario: document.getElementById('view-inventario'),
        clientes: document.getElementById('view-clientes'),
        gastos: document.getElementById('view-gastos'),
        proveedores: document.getElementById('view-proveedores'),
        empleados: document.getElementById('view-empleados'),
        items: document.getElementById('view-items')
    };

    // Usamos la función switchView para navegar a la vista inicial
    switchView(initialView, tabs, views);
    // --- FIN DE LA NUEVA LÓGICA ---

    // 4. Cargar todos los datos de la base de datos.
    loadAllData();

    // 5. Inicializar los campos de búsqueda.
    setupSearchInputs();

    isAppInitialized = true;
    console.log("Aplicación inicializada correctamente.");
}

// --- LÓGICA DE CARGA DE DATOS ---
function loadAllData() {
    activeListeners.push(loadClientes());
    activeListeners.push(loadProveedores());
    activeListeners.push(loadRemisiones());
    activeListeners.push(loadGastos());
    activeListeners.push(loadImportaciones());
    activeListeners.push(loadItems());
    activeListeners.push(loadComprasNacionales()); // <-- AÑADE ESTA LÍNEA

    if (currentUserData && currentUserData.role === 'admin') {
        activeListeners.push(loadEmpleados());
        activeListeners.push(loadAllLoanRequests());
    }
}

function loadViewTemplates() {
    // --- INICIO DE LA CORRECCIÓN ---
    // Generamos las opciones de pago una sola vez para reutilizarlas
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');
    // --- FIN DE LA CORRECCIÓN ---

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

    document.getElementById('view-inventario').innerHTML = `
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

    document.getElementById('view-items').innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
        <div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md">
            <h2 class="text-xl font-semibold mb-4">Añadir Nuevo Ítem</h2>
            <form id="add-item-form" class="space-y-4">
                <input type="text" id="nuevo-item-tipo" placeholder="Tipo (Ej: Vidrio, Espejo)" class="w-full p-3 border border-gray-300 rounded-lg" required>
                <input type="text" id="nuevo-item-color" placeholder="Color (Ej: Crudo, Bronce)" class="w-full p-3 border border-gray-300 rounded-lg" required>
                <div class="grid grid-cols-2 gap-4">
                    <input type="number" id="nuevo-item-ancho" placeholder="Ancho (mm)" class="w-full p-3 border border-gray-300 rounded-lg" required min="0">
                    <input type="number" id="nuevo-item-alto" placeholder="Alto (mm)" class="w-full p-3 border border-gray-300 rounded-lg" required min="0">
                </div>
                <input type="number" id="nuevo-item-laminas-por-caja" placeholder="Láminas por Caja" class="w-full p-3 border border-gray-300 rounded-lg" required min="1">
                <input type="number" id="nuevo-item-stock" placeholder="Stock Inicial" class="w-full p-3 border border-gray-300 rounded-lg" required min="0">
                <button type="submit" class="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700">Guardar Ítem</button>
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

    document.getElementById('view-remisiones').innerHTML = `
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
                    <select id="forma-pago" class="w-full p-3 border border-gray-300 rounded-lg bg-white" required>
                        <option value="" disabled selected>Forma de Pago</option>
                        <option value="Pendiente">Pendiente</option>
                        ${metodosDePagoHTML}
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
            <div class="flex flex-col sm:flex-row justify-between sm:items-center mb-4 flex-wrap gap-4">
            <h2 class="text-xl font-semibold">Historial de Remisiones</h2>
            <div class="flex items-center gap-2 flex-wrap w-full">
            <select id="filter-remisiones-month" class="p-2 border rounded-lg bg-white"></select>
            <select id="filter-remisiones-year" class="p-2 border rounded-lg bg-white"></select>
            <input type="search" id="search-remisiones" placeholder="Buscar..." class="p-2 border rounded-lg flex-grow"></div>
            </div><div id="remisiones-list" class="space-y-3">
            </div>
            </div>
            </div>`;

    document.getElementById('view-facturacion').innerHTML = `<div class="bg-white p-6 rounded-xl shadow-md max-w-6xl mx-auto"><h2 class="text-2xl font-semibold mb-4">Gestión de Facturación</h2><div class="border-b border-gray-200 mb-6"><nav id="facturacion-nav" class="-mb-px flex space-x-6"><button id="tab-pendientes" class="dashboard-tab-btn active py-3 px-1 font-semibold">Pendientes</button><button id="tab-realizadas" class="dashboard-tab-btn py-3 px-1 font-semibold">Realizadas</button></nav></div><div id="view-pendientes"><h3 class="text-xl font-semibold text-gray-800 mb-4">Remisiones Pendientes de Facturar</h3><div id="facturacion-pendientes-list" class="space-y-3"></div></div><div id="view-realizadas" class="hidden"><h3 class="text-xl font-semibold text-gray-800 mb-4">Remisiones Facturadas</h3><div id="facturacion-realizadas-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-clientes').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Añadir Cliente</h2><form id="add-cliente-form" class="space-y-4"><input type="text" id="nuevo-cliente-nombre-empresa" placeholder="Nombre Empresa" class="w-full p-3 border border-gray-300 rounded-lg" required><input type="text" id="nuevo-cliente-contacto" placeholder="Nombre del Contacto" class="w-full p-3 border border-gray-300 rounded-lg"><input type="email" id="nuevo-cliente-email" placeholder="Correo Electrónico" class="w-full p-3 border border-gray-300 rounded-lg"><input type="tel" id="nuevo-cliente-telefono1" placeholder="Teléfono 1" class="w-full p-3 border border-gray-300 rounded-lg" required oninput="this.value = this.value.replace(/[^0-9]/g, '')"><input type="tel" id="nuevo-cliente-telefono2" placeholder="Teléfono 2 (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg" oninput="this.value = this.value.replace(/[^0-9]/g, '')"><input type="text" id="nuevo-cliente-nit" placeholder="NIT (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg"><div class="space-y-1"><label for="nuevo-cliente-rut" class="block text-sm font-medium text-gray-700">RUT (Opcional)</label><input type="file" id="nuevo-cliente-rut" class="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/></div><button type="submit" class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700">Registrar</button></form></div><div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Clientes</h2><input type="search" id="search-clientes" placeholder="Buscar..." class="p-2 border rounded-lg"></div><div id="clientes-list" class="space-y-3"></div></div></div>`;
    document.getElementById('view-proveedores').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"><div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md"><h2 class="text-xl font-semibold mb-4">Añadir Proveedor</h2><form id="add-proveedor-form" class="space-y-4"><input type="text" id="nuevo-proveedor-nombre" placeholder="Nombre del Proveedor" class="w-full p-3 border border-gray-300 rounded-lg" required><input type="text" id="nuevo-proveedor-contacto" placeholder="Nombre de Contacto" class="w-full p-3 border border-gray-300 rounded-lg"><input type="tel" id="nuevo-proveedor-telefono" placeholder="Teléfono" class="w-full p-3 border border-gray-300 rounded-lg"><input type="email" id="nuevo-proveedor-email" placeholder="Correo" class="w-full p-3 border border-gray-300 rounded-lg"><div><label for="nuevo-proveedor-rut" class="block text-sm font-medium text-gray-700">RUT</Opcional></label><input type="file" id="nuevo-proveedor-rut" class="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"/></div><button type="submit" class="w-full bg-teal-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-teal-700">Registrar</button></form></div><div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Proveedores</h2><input type="search" id="search-proveedores" placeholder="Buscar..." class="p-2 border rounded-lg"></div><div id="proveedores-list" class="space-y-3"></div></div></div>`;

    document.getElementById('view-gastos').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
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
    document.getElementById('view-empleados').innerHTML = `<div class="bg-white p-6 rounded-xl shadow-md max-w-4xl mx-auto"><h2 class="text-xl font-semibold mb-4">Gestión de Empleados</h2><div id="empleados-list" class="space-y-3"></div></div>`;

    // Se mueven los listeners al final para asegurar que todos los elementos existan
    document.getElementById('show-policy-link').addEventListener('click', (e) => { e.preventDefault(); showPolicyModal(); });
    document.getElementById('show-login-link-register').addEventListener('click', (e) => { e.preventDefault(); registerForm.classList.add('hidden'); loginForm.classList.remove('hidden'); });
}

function updateUIVisibility(userData) {
    if (!userData) return;

    const isAdmin = userData.role?.toLowerCase() === 'admin';

    // Muestra/oculta los módulos principales según los permisos
    ALL_MODULES.forEach(module => {
        const tab = document.getElementById(`tab-${module}`);
        if (tab) {
            let hasPermission = isAdmin || (userData.permissions && userData.permissions[module]);
            tab.classList.toggle('hidden', !hasPermission);
        }
    });

    // Muestra/oculta botones específicos para administradores
    document.getElementById('view-all-loans-btn').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('summary-btn').style.display = isAdmin ? 'block' : 'none';

    // --- LÍNEA AÑADIDA AQUÍ ---
    // Muestra el botón de regenerar URLs solo si el usuario es admin
    //document.getElementById('regenerate-urls-btn').style.display = isAdmin ? 'block' : 'none';

    // Muestra/oculta botones específicos para no administradores
    document.getElementById('loan-request-btn').style.display = isAdmin ? 'none' : 'block';

    // Ajusta la vista del módulo de remisiones según el rol
    const isPlanta = userData.role?.toLowerCase() === 'planta';
    const remisionFormContainer = document.getElementById('remision-form-container');
    const remisionListContainer = document.getElementById('remisiones-list-container');
    if (remisionFormContainer && remisionListContainer) {
        remisionFormContainer.style.display = isPlanta ? 'none' : '';
        remisionListContainer.classList.toggle('lg:col-span-3', isPlanta);
        remisionListContainer.classList.toggle('lg:col-span-2', !isPlanta);
    }

    // --- INICIO DE LA NUEVA LÓGICA PARA GASTOS ---
    const isContabilidad = userData.role?.toLowerCase() === 'contabilidad';
    const gastosView = document.getElementById('view-gastos');

    if (gastosView && isContabilidad) {
        // Ocultar el formulario de "Nuevo Gasto"
        const formContainer = gastosView.querySelector('.lg\\:col-span-1');
        if (formContainer) {
            formContainer.style.display = 'none';
        }

        // Hacer que la lista de "Historial de Gastos" ocupe todo el ancho
        const listContainer = gastosView.querySelector('.lg\\:col-span-2');
        if (listContainer) {
            listContainer.classList.remove('lg:col-span-2');
            listContainer.classList.add('lg:col-span-3'); // Ocupa las 3 columnas del grid
        }
    }
    // --- FIN DE LA NUEVA LÓGICA PARA GASTOS ---
}

/**
 * Determina la vista inicial para un usuario basándose en su rol y permisos.
 * @param {object} userData - Los datos del usuario actual (currentUserData).
 * @returns {string} El nombre de la vista a la que se debe dirigir al usuario.
 */
function getInitialViewForUser(userData) {
    if (!userData) return 'remisiones'; // Fallback por si acaso

    const isAdmin = userData.role === 'admin';

    // 1. El administrador siempre empieza en Remisiones.
    if (isAdmin) {
        return 'remisiones';
    }

    // 2. Para otros roles, definimos un orden de prioridad de los módulos.
    const modulePriority = [
        'remisiones',
        'facturacion',
        'inventario',
        'items',
        'clientes',
        'gastos',
        'proveedores',
        'empleados'
    ];

    // 3. Buscamos el primer módulo en la lista de prioridades
    //    para el cual el usuario tenga permiso.
    if (userData.permissions) {
        for (const module of modulePriority) {
            if (userData.permissions[module]) {
                return module; // Devuelve el primer módulo permitido.
            }
        }
    }

    // 4. Si por alguna razón un usuario no-admin no tiene ningún permiso,
    //    lo dejamos en remisiones como última opción.
    return 'remisiones';
}

// --- LÓGICA DE LOGIN/REGISTRO/LOGOUT ---

loginForm.addEventListener('submit', handleLoginSubmit); // Asegúrate de tener la función handleLoginSubmit
registerForm.addEventListener('submit', handleRegisterSubmit); // Asegúrate de tener la función handleRegisterSubmit

/**
 * --- NUEVA FUNCIÓN ---
 * Maneja la actualización de una fecha en el documento de la importación.
 * @param {string} importacionId - El ID de la importación.
 * @param {string} fieldId - El ID del campo de fecha ('fecha-llegada-puerto' o 'fecha-llegada-bodega').
 * @param {string} newDate - La nueva fecha seleccionada.
 */
async function handleDateUpdate(importacionId, fieldId, newDate) {
    const fieldMap = {
        'fecha-llegada-puerto': 'fechaLlegadaPuerto',
        'fecha-llegada-bodega': 'fechaLlegadaBodega'
    };
    const dbField = fieldMap[fieldId];
    if (!dbField) return;

    showTemporaryMessage("Actualizando fecha...", "info");
    try {
        const importacionRef = doc(db, "importaciones", importacionId);
        const updateData = {};
        updateData[dbField] = newDate;
        await updateDoc(importacionRef, updateData);

        const importacionIndex = allImportaciones.findIndex(i => i.id === importacionId);
        if (importacionIndex !== -1) {
            allImportaciones[importacionIndex][dbField] = newDate;
        }
        showTemporaryMessage("Fecha actualizada.", "success");
    } catch (error) {
        console.error("Error al actualizar fecha:", error);
        showTemporaryMessage("Error al actualizar la fecha.", "error");
    }
}

/**
 * --- VERSIÓN FINAL Y SEGURA ---
 * Maneja la actualización del estado logístico.
 * Si el estado cambia a "En Bodega" Y la importación no ha sido procesada antes,
 * actualiza el stock de todos los ítems de forma atómica.
 * @param {string} importacionId - El ID de la importación.
 * @param {string} newStatus - El nuevo estado ('En Puerto' o 'En Bodega').
 */
async function handleEstadoUpdate(importacionId, newStatus) {
    const fecha = new Date().toISOString().split('T')[0];
    let updateData = { estadoLogistico: newStatus };
    let fieldToUpdate = '';

    if (newStatus === 'En Puerto') {
        fieldToUpdate = 'fechaLlegadaPuerto';
    } else if (newStatus === 'En Bodega') {
        fieldToUpdate = 'fechaLlegadaBodega';
    }

    if (!fieldToUpdate) return;
    updateData[fieldToUpdate] = fecha;

    const importacionActual = allImportaciones.find(i => i.id === importacionId);
    if (!importacionActual) {
        return showModalMessage("Error: No se encontró la importación para actualizar.");
    }

    // VERIFICACIÓN CLAVE: Si ya se procesó, no hacer nada.
    if (newStatus === 'En Bodega' && importacionActual.stockActualizado) {
        showModalMessage("Esta importación ya fue sumada al inventario.", "info");
        return;
    }

    showModalMessage(`Actualizando a "${newStatus}"...`, true);

    try {
        const importacionRef = doc(db, "importaciones", importacionId);
        const batch = writeBatch(db);

        // Si el estado es "En Bodega", añade la actualización de stock al batch
        if (newStatus === 'En Bodega' && importacionActual.items) {
            updateData.stockActualizado = true; // Añadir una bandera para no volver a procesar
            importacionActual.items.forEach(itemImportado => {
                const itemRef = doc(db, "items", itemImportado.itemId);
                const itemEnStock = allItems.find(i => i.id === itemImportado.itemId);

                if (itemEnStock) {
                    const nuevoStock = (itemEnStock.stock || 0) + itemImportado.cantidad;
                    batch.update(itemRef, { stock: nuevoStock });
                }
            });
            showTemporaryMessage("¡Estado y stock actualizados con éxito!", "success");
        } else {
            showTemporaryMessage("Estado actualizado con éxito.", "success");
        }

        // Actualizar el documento de la importación
        batch.update(importacionRef, updateData);

        // Ejecutar todas las operaciones
        await batch.commit();

        // Refrescar la interfaz
        hideModal();
        const importacionIndex = allImportaciones.findIndex(i => i.id === importacionId);
        if (importacionIndex !== -1) {
            allImportaciones[importacionIndex] = { ...allImportaciones[importacionIndex], ...updateData };
            showImportacionModal(allImportaciones[importacionIndex]);
        }

    } catch (error) {
        console.error(`Error al marcar "${newStatus}":`, error);
        showModalMessage("Error al actualizar el estado.");
    }
}

// --- LÓGICA DE LOGIN/REGISTRO/LOGOUT ---
function handleLoginSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    signInWithEmailAndPassword(auth, email, password).catch(error => {
        console.error(error);
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
            nombre: nombre,
            cedula: cedula,
            telefono: telefono,
            direccion: direccion,
            email: email,
            dob: dob,
            role: role,
            status: status,
            permissions: permissions,
            creadoEn: new Date()
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


loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    signInWithEmailAndPassword(auth, email, password).catch(error => {
        console.error(error);
        showModalMessage("Error: " + error.message);
    });
});


// Corregimos la función de logout

document.getElementById('logout-btn').addEventListener('click', () => {
    unsubscribeAllListeners();
    signOut(auth);
});

/**
 * --- VERSIÓN FINAL, COMPLETA Y SIN OMISIONES ---
 * Configura TODOS los event listeners de la aplicación, asegurando que no haya
 * duplicados y que todas las funcionalidades, incluyendo las nuevas pestañas de inventario
 * y el formulario dinámico de remisiones, estén correctamente conectadas.
 */
function setupEventListeners() {
    // 1. NAVEGACIÓN PRINCIPAL (PESTAÑAS)
    const tabs = {
        remisiones: document.getElementById('tab-remisiones'),
        facturacion: document.getElementById('tab-facturacion'),
        inventario: document.getElementById('tab-inventario'),
        clientes: document.getElementById('tab-clientes'),
        gastos: document.getElementById('tab-gastos'),
        proveedores: document.getElementById('tab-proveedores'),
        empleados: document.getElementById('tab-empleados'),
        items: document.getElementById('tab-items')
    };
    const views = {
        remisiones: document.getElementById('view-remisiones'),
        facturacion: document.getElementById('view-facturacion'),
        inventario: document.getElementById('view-inventario'),
        clientes: document.getElementById('view-clientes'),
        gastos: document.getElementById('view-gastos'),
        proveedores: document.getElementById('view-proveedores'),
        empleados: document.getElementById('view-empleados'),
        items: document.getElementById('view-items')
    };
    Object.keys(tabs).forEach(key => {
        if (tabs[key]) {
            tabs[key].addEventListener('click', () => switchView(key, tabs, views));
        }
    });

    // 2. NAVEGACIÓN SECUNDARIA (PESTAÑAS DE INVENTARIO Y FACTURACIÓN)
    const importacionesTab = document.getElementById('tab-importaciones');
    const nacionalTab = document.getElementById('tab-nacional');
    const importacionesView = document.getElementById('view-importaciones-content');
    const nacionalView = document.getElementById('view-nacional-content');
    if (importacionesTab && nacionalTab) {
        importacionesTab.addEventListener('click', () => {
            importacionesTab.classList.add('active');
            nacionalTab.classList.remove('active');
            importacionesView.classList.remove('hidden');
            nacionalView.classList.add('hidden');
        });
        nacionalTab.addEventListener('click', () => {
            nacionalTab.classList.add('active');
            importacionesTab.classList.remove('active');
            nacionalView.classList.remove('hidden');
            importacionesView.classList.add('hidden');
        });
    }

    const facturacionPendientesTab = document.getElementById('tab-pendientes');
    const facturacionRealizadasTab = document.getElementById('tab-realizadas');
    const facturacionPendientesView = document.getElementById('view-pendientes');
    const facturacionRealizadasView = document.getElementById('view-realizadas');
    if (facturacionPendientesTab && facturacionRealizadasTab) {
        facturacionPendientesTab.addEventListener('click', () => {
            facturacionPendientesTab.classList.add('active');
            facturacionRealizadasTab.classList.remove('active');
            facturacionPendientesView.classList.remove('hidden');
            facturacionRealizadasView.classList.add('hidden');
        });
        facturacionRealizadasTab.addEventListener('click', () => {
            facturacionRealizadasTab.classList.add('active');
            facturacionPendientesTab.classList.remove('active');
            facturacionRealizadasView.classList.remove('hidden');
            facturacionPendientesView.classList.add('hidden');
        });
    }

    // 3. LISTENER CENTRALIZADO PARA EL FORMULARIO DE REMISIONES
    const remisionForm = document.getElementById('remision-form');
    if (remisionForm) {
        remisionForm.addEventListener('click', (e) => {
            const target = e.target;
            if (target.id === 'add-item-btn') {
                document.getElementById('items-container').appendChild(createItemElement());
            }
            if (target.closest('.remove-item-btn')) {
                target.closest('.item-row').remove();
                calcularTotales();
            }
            if (target.classList.contains('tipo-corte-radio')) {
                const itemRow = target.closest('.item-row');
                const completaDiv = itemRow.querySelector('.completa-container');
                const cortadaDiv = itemRow.querySelector('.cortada-container');
                if (target.value === 'completa') {
                    completaDiv.classList.remove('hidden');
                    cortadaDiv.classList.add('hidden');
                } else {
                    completaDiv.classList.add('hidden');
                    cortadaDiv.classList.remove('hidden');
                    if (cortadaDiv.querySelector('.cortes-list').children.length === 0) {
                        cortadaDiv.querySelector('.cortes-list').appendChild(createCutElement());
                    }
                }
            }
            if (target.closest('.add-cut-btn')) {
                target.closest('.cortada-container').querySelector('.cortes-list').appendChild(createCutElement());
            }
            if (target.closest('.remove-cut-btn')) {
                target.closest('.cut-row').remove();
            }
        });
        remisionForm.addEventListener('submit', handleRemisionSubmit);
        document.getElementById('incluir-iva').addEventListener('input', calcularTotales);
    }

    // 4. LISTENERS PARA BOTONES PRINCIPALES Y FORMULARIOS DE CREACIÓN
    document.getElementById('add-importacion-btn').addEventListener('click', () => showImportacionModal());
    document.getElementById('add-nacional-btn').addEventListener('click', () => showNacionalModal());
    document.getElementById('add-cliente-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nuevoCliente = {
            nombre: document.getElementById('nuevo-cliente-nombre').value,
            email: document.getElementById('nuevo-cliente-email').value,
            telefono1: document.getElementById('nuevo-cliente-telefono1').value,
            telefono2: document.getElementById('nuevo-cliente-telefono2').value,
            nit: document.getElementById('nuevo-cliente-nit').value || '',
            creadoEn: new Date()
        };
        showModalMessage("Registrando cliente...", true);
        try {
            await addDoc(collection(db, "clientes"), nuevoCliente);
            e.target.reset();
            hideModal();
            showTemporaryMessage("¡Cliente registrado!", "success");
        } catch (error) {
            console.error(error);
            hideModal();
            showModalMessage("Error al registrar cliente.");
        }
    });
    document.getElementById('add-proveedor-form').addEventListener('submit', handleProveedorSubmit);
    document.getElementById('add-gasto-form').addEventListener('submit', handleGastoSubmit);
    document.getElementById('add-item-form').addEventListener('submit', handleItemSubmit);
    document.getElementById('summary-btn').addEventListener('click', showDashboardModal);
    document.getElementById('edit-profile-btn').addEventListener('click', showEditProfileModal);
    document.getElementById('loan-request-btn').addEventListener('click', showLoanRequestModal);

    // 5. LISTENERS PARA ACCIONES DENTRO DE LAS LISTAS (BOTONES DE EDITAR, GESTIONAR, ETC.)
    const itemsList = document.getElementById('items-list');
    if (itemsList) {
        itemsList.addEventListener('click', (e) => {
            if (e.target.closest('.edit-item-btn')) {
                const itemData = JSON.parse(e.target.closest('.edit-item-btn').dataset.itemJson);
                showEditItemModal(itemData);
            }
        });
    }
    const empleadosView = document.getElementById('view-empleados');


    // 6. LISTENERS PARA BÚSQUEDAS Y FILTROS
    document.getElementById('search-remisiones').addEventListener('input', renderRemisiones);
    document.getElementById('search-clientes').addEventListener('input', renderClientes);
    document.getElementById('search-proveedores').addEventListener('input', renderProveedores);
    document.getElementById('search-gastos').addEventListener('input', renderGastos);
    document.getElementById('search-items').addEventListener('input', renderItems);

    populateDateFilters('filter-remisiones');
    populateDateFilters('filter-gastos');
    document.getElementById('filter-remisiones-month').addEventListener('change', renderRemisiones);
    document.getElementById('filter-remisiones-year').addEventListener('change', renderRemisiones);
    document.getElementById('filter-gastos-month').addEventListener('change', renderGastos);
    document.getElementById('filter-gastos-year').addEventListener('change', renderGastos);

    // 7. LISTENERS ADICIONALES (MODAL DE POLÍTICAS, FORMATO DE MONEDA, ETC.)
    document.getElementById('show-policy-link')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('policy-modal').classList.remove('hidden'); });
    document.getElementById('close-policy-modal')?.addEventListener('click', () => { document.getElementById('policy-modal').classList.add('hidden'); });
    document.getElementById('accept-policy-btn')?.addEventListener('click', () => { document.getElementById('policy-modal').classList.add('hidden'); });
    document.getElementById('view-all-loans-btn').addEventListener('click', () => { showAllLoansModal(allPendingLoans); });


    const debugBtn = document.getElementById('debug-claims-btn');
    if (debugBtn) {
        debugBtn.addEventListener('click', async () => {
            if (!auth.currentUser) {
                return alert("Debes iniciar sesión primero.");
            }
            if (!confirm("Esto revisará tus permisos de sesión actuales. ¿Continuar?")) return;

            console.log("Llamando a la función de depuración 'checkMyClaims'...");
            alert("Revisando permisos... por favor, abre la consola del navegador para ver el resultado.");

            try {
                // Obtenemos el token de la sesión actual del usuario
                const idToken = await auth.currentUser.getIdToken(true);

                // Hacemos una llamada HTTP estándar con el token en los encabezados
                const response = await fetch('https://us-central1-importadorave-7d1a0.cloudfunctions.net/checkMyClaims', {
                    method: 'POST', // Puede ser POST o GET, pero POST es común para acciones
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error(`El servidor respondió con un error: ${response.status}`);
                }

                const result = await response.json();
                const claims = result.data.claims;

                console.log("--- RESULTADO DEL SERVIDOR ---");
                console.log("El servidor reporta que tus permisos son:", claims);

                if (claims && claims.admin === true) {
                    alert("¡Éxito! El servidor confirma que tu sesión SÍ tiene permisos de administrador.");
                } else {
                    alert("¡PROBLEMA ENCONTRADO! El servidor confirma que tu sesión NO tiene permisos de administrador. Revisa la consola.");
                }

            } catch (error) {
                console.error("Error al llamar la función de depuración:", error);
                alert("Ocurrió un error al verificar los permisos. Revisa la consola.");
            }
        });
    }
}

function switchView(viewName, tabs, views) {
    Object.values(tabs).forEach(tab => { if (tab) tab.classList.remove('active') });
    Object.values(views).forEach(view => { if (view) view.classList.add('hidden') });
    if (tabs[viewName]) tabs[viewName].classList.add('active');
    if (views[viewName]) views[viewName].classList.remove('hidden');
}

function renderAndAttachEmployeeListeners(users) {
    const empleadosListEl = document.getElementById('empleados-list');
    if (!empleadosListEl) return;

    empleadosListEl.innerHTML = '';

    users.filter(u => u.id !== currentUser.uid).forEach(empleado => {
        const el = document.createElement('div');
        el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-center gap-4';

        let statusBadge = '';
        let toggleButtonHTML = '';

        switch (empleado.status) {
            case 'active':
                statusBadge = `<span class="text-xs font-semibold bg-green-200 text-green-800 px-2 py-1 rounded-full">Activo</span>`;
                toggleButtonHTML = `<button data-uid="${empleado.id}" data-status="inactive" class="user-status-btn bg-yellow-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-yellow-600 transition w-full">Desactivar</button>`;
                break;
            case 'inactive':
                statusBadge = `<span class="text-xs font-semibold bg-gray-200 text-gray-800 px-2 py-1 rounded-full">Inactivo</span>`;
                toggleButtonHTML = `<button data-uid="${empleado.id}" data-status="active" class="user-status-btn bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-600 transition w-full">Activar</button>`;
                break;
            default:
                statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Pendiente</span>`;
                toggleButtonHTML = `<button data-uid="${empleado.id}" data-status="active" class="user-status-btn bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-600 transition w-full">Activar</button>`;
                break;
        }

        el.innerHTML = `
            <div class="flex-grow">
                <div class="flex items-center gap-2 mb-1">
                     <p class="font-semibold">${empleado.nombre}</p>
                     ${statusBadge}
                </div>
                <p class="text-sm text-gray-600">${empleado.email} <span class="text-sm font-normal text-gray-500">(${empleado.role})</span></p>
            </div>
            <div class="flex-shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-2 w-full sm:w-auto">
                <button data-user-json='${JSON.stringify(empleado)}' class="manage-rrhh-docs-btn bg-teal-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-teal-600 transition w-full">RR.HH.</button>
                <button data-user-json='${JSON.stringify(empleado)}' class="manage-user-btn bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-600 transition w-full">Gestionar</button>
                ${toggleButtonHTML}
                <button data-uid="${empleado.id}" class="delete-user-btn bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-600 transition w-full">Eliminar</button>
            </div>`;
        empleadosListEl.appendChild(el);
    });

    // Asignar listeners a los botones recién creados
    document.querySelectorAll('.user-status-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const userId = e.currentTarget.dataset.uid;
            const newStatus = e.currentTarget.dataset.status;
            if (confirm(`¿Estás seguro de que quieres cambiar el estado de este usuario a "${newStatus}"?`)) {
                showModalMessage("Actualizando estado...", true);
                const setUserStatus = httpsCallable(functions, 'setUserStatus');
                try {
                    await setUserStatus({ userId, newStatus });
                    hideModal();
                    showTemporaryMessage("Estado del usuario actualizado.", "success");
                } catch (error) {
                    console.error("Error al cambiar estado de usuario:", error);
                    showModalMessage(`Error: ${error.message}`);
                }
            }
        });
    });

    document.querySelectorAll('.manage-rrhh-docs-btn').forEach(btn => btn.addEventListener('click', (e) => showRRHHModal(JSON.parse(e.currentTarget.dataset.userJson))));
    document.querySelectorAll('.manage-user-btn').forEach(btn => btn.addEventListener('click', (e) => showAdminEditUserModal(JSON.parse(e.currentTarget.dataset.userJson))));
    document.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const uid = e.currentTarget.dataset.uid;
            if (confirm('¿Estás seguro de que quieres eliminar este usuario?')) {
                await deleteDoc(doc(db, "users", uid));
                showTemporaryMessage("Usuario eliminado.", false, 2000);
            }
        });
    });
}

function loadEmpleados() {
    if (!currentUserData || currentUserData.role !== 'admin') {
        return () => { }; // Salir si no es admin
    }
    const q = query(collection(db, "users"), orderBy("nombre"));

    return onSnapshot(q, (snapshot) => {
        allUsers = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        // Ordenar para que los pendientes/inactivos aparezcan primero
        const sortedUsers = [...allUsers].sort((a, b) => {
            const statusOrder = { 'pending': 1, 'inactive': 2, 'active': 3 };
            return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
        });

        // Llamar a la función que dibuja y asigna los listeners
        renderAndAttachEmployeeListeners(sortedUsers);
    });
}

function loadColores() {
    const q = query(collection(db, "colores"), orderBy("nombre", "asc"));
    return onSnapshot(q, (snapshot) => {
        allColores = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderColores();
    });
}

function renderColores() {
    const coloresListEl = document.getElementById('colores-list');
    if (!coloresListEl) return;
    const searchTerm = document.getElementById('search-colores').value.toLowerCase();
    const filtered = allColores.filter(c => c.nombre.toLowerCase().includes(searchTerm));

    coloresListEl.innerHTML = '';
    if (filtered.length === 0) { coloresListEl.innerHTML = '<p>No hay colores.</p>'; return; }
    filtered.forEach(color => {
        const colorDiv = document.createElement('div');
        colorDiv.className = 'border p-4 rounded-lg font-semibold';
        colorDiv.textContent = color.nombre;
        coloresListEl.appendChild(colorDiv);
    });
}

function loadItems() {
    const q = query(collection(db, "items"), orderBy("referencia", "asc"));
    return onSnapshot(q, (snapshot) => {
        allItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderItems();
    });
}

/**
 * --- NUEVA FUNCIÓN ---
 * Carga todas las compras nacionales desde Firestore y las almacena en la variable global.
 */
function loadComprasNacionales() {
    const q = query(collection(db, "comprasNacionales"), orderBy("fecha", "desc"));
    return onSnapshot(q, (snapshot) => {
        allComprasNacionales = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderComprasNacionales(); // Llama a la función para mostrar los datos
    });
}

/**
 * --- NUEVA FUNCIÓN ---
 * Renderiza la lista de compras nacionales en la pestaña de "Inventario".
 */
function renderComprasNacionales() {
    const container = document.getElementById('nacional-list');
    if (!container) return;

    if (allComprasNacionales.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-8">Aún no se han registrado compras nacionales.</p>';
        return;
    }

    container.innerHTML = ''; // Limpiar la lista antes de volver a dibujar
    allComprasNacionales.forEach(compra => {
        const totalAbonado = (compra.abonos || []).reduce((sum, abono) => sum + abono.valor, 0);
        const saldoPendiente = compra.valorTotalCompra - totalAbonado;

        let estadoPago = '';
        if (saldoPendiente <= 0) {
            estadoPago = `<span class="text-xs font-semibold bg-green-200 text-green-800 px-2 py-1 rounded-full">Pagado</span>`;
        } else if (totalAbonado > 0) {
            estadoPago = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Abono</span>`;
        } else {
            estadoPago = `<span class="text-xs font-semibold bg-red-200 text-red-800 px-2 py-1 rounded-full">Pendiente</span>`;
        }

        const card = document.createElement('div');
        card.className = 'border p-4 rounded-lg';
        card.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start">
                <div>
                    <p class="font-bold">${compra.proveedorNombre}</p>
                    <p class="text-sm text-gray-600">Fecha: ${compra.fecha}</p>
                    <p class="text-sm text-gray-500">Total: <span class="font-semibold">${formatCurrency(compra.valorTotalCompra)}</span></p>
                </div>
                <div class="flex items-center gap-2 mt-2 sm:mt-0">
                    ${estadoPago}
                    <button data-compra-json='${JSON.stringify(compra)}' class="edit-nacional-btn bg-gray-200 text-gray-700 px-3 py-1 rounded-lg text-sm font-semibold hover:bg-gray-300">
                        Gestionar
                    </button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    // Añadir listener para los nuevos botones de "Gestionar"
    container.querySelectorAll('.edit-nacional-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const compraData = JSON.parse(e.currentTarget.dataset.compraJson);
            showNacionalModal(compraData);
        });
    });
}

/**
 * --- VERSIÓN MEJORADA CON BOTÓN DE EDITAR ---
 * Renderiza la lista de ítems, mostrando ahora un botón para editar
 * cada uno de ellos.
 */
function renderItems() {
    const itemsListEl = document.getElementById('items-list');
    if (!itemsListEl) return;
    const searchTerm = document.getElementById('search-items').value.toLowerCase();

    const filtered = allItems.filter(i =>
        i.descripcion.toLowerCase().includes(searchTerm) ||
        i.referencia.toLowerCase().includes(searchTerm)
    );

    itemsListEl.innerHTML = '';
    if (filtered.length === 0) {
        itemsListEl.innerHTML = '<p class="text-center text-gray-500 py-4">No hay ítems que coincidan con la búsqueda.</p>';
        return;
    }

    filtered.forEach(item => {
        const averageCost = allItemAverageCosts[item.id] || 0;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'border p-4 rounded-lg flex justify-between items-center';

        // --- INICIO DE LA MODIFICACIÓN: Añadir botón de Editar ---
        itemDiv.innerHTML = `
            <div class="flex-grow">
                <p class="font-semibold"><span class="item-ref">${item.referencia}</span></p>
                <p class="text-sm text-gray-700">${item.descripcion}</p>
                <p class="text-sm text-blue-600 font-semibold mt-1">Costo Promedio: ${formatCurrency(averageCost)}</p>
            </div>
            <div class="flex items-center gap-4">
                <div class="text-right">
                    <p class="font-bold text-lg">${item.stock}</p>
                    <p class="text-sm text-gray-500">en stock</p>
                </div>
                <button data-item-json='${JSON.stringify(item)}' class="edit-item-btn bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-300">
                    Editar
                </button>
            </div>
        `;
        // --- FIN DE LA MODIFICACIÓN ---
        itemsListEl.appendChild(itemDiv);
    });
}
/**
 * Normaliza un texto: lo convierte a minúsculas y le quita las tildes.
 * @param {string} text - El texto a normalizar.
 * @returns {string} El texto normalizado.
 */
function normalizeText(text) {
    if (!text) return '';
    return text.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// --- FUNCIONES DE CARGA DE DATOS (ACTUALIZADAS) ---
function loadClientes() {
    const q = query(collection(db, "clientes"), orderBy("nombre", "asc"));
    return onSnapshot(q, (snapshot) => {
        allClientes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderClientes();
    });
}



function renderClientes() {
    const clientesListEl = document.getElementById('clientes-list');
    if (!clientesListEl) return;

    const normalizedSearchTerm = normalizeText(document.getElementById('search-clientes').value);

    const clientesConHistorial = allClientes.map(cliente => {
        const remisionesCliente = allRemisiones.filter(r => r.idCliente === cliente.id && r.estado !== 'Anulada');
        const totalComprado = remisionesCliente.reduce((sum, r) => sum + r.valorTotal, 0);
        let ultimaCompra = 'N/A';
        if (remisionesCliente.length > 0) {
            remisionesCliente.sort((a, b) => new Date(b.fechaRecibido) - new Date(a.fechaRecibido));
            ultimaCompra = remisionesCliente[0].fechaRecibido;
        }
        return { ...cliente, totalComprado, ultimaCompra };
    });

    const filtered = clientesConHistorial.filter(c => {
        // Se añade el campo 'contacto' a la búsqueda
        const clientDataString = [
            c.nombre,
            c.nombreEmpresa,
            c.contacto, // <-- CAMBIO AQUÍ
            c.email,
            c.telefono1,
            c.telefono2,
            c.nit
        ].join(' ');

        const normalizedClientData = normalizeText(clientDataString);
        return normalizedClientData.includes(normalizedSearchTerm);
    });

    clientesListEl.innerHTML = '';
    if (filtered.length === 0) {
        clientesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No se encontraron clientes.</p>';
        return;
    }

    filtered.forEach(cliente => {
        const clienteDiv = document.createElement('div');
        clienteDiv.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between sm:items-start gap-4';

        const telefonos = [cliente.telefono1, cliente.telefono2].filter(Boolean).join(' | ');
        const editButton = (currentUserData && currentUserData.role === 'admin')
            ? `<button data-client-json='${JSON.stringify(cliente)}' class="edit-client-btn bg-gray-200 text-gray-700 px-3 py-1 rounded-lg text-sm font-semibold hover:bg-gray-300 w-full text-center">Editar</button>`
            : '';

        // --- INICIO DEL CAMBIO ---
        // Se añade una línea para mostrar el nombre del contacto
        const nombreContactoHtml = cliente.contacto
            ? `<p class="text-sm text-gray-700"><span class="font-medium">Contacto:</span> ${cliente.contacto}</p>`
            : '';
        // --- FIN DEL CAMBIO ---

        clienteDiv.innerHTML = `
            <div class="flex-grow min-w-0">
                <p class="font-semibold text-lg truncate" title="${cliente.nombre}">${cliente.nombreEmpresa || cliente.nombre}</p>
                ${nombreContactoHtml}
                <p class="text-sm text-gray-600 mt-1">${cliente.email || 'Sin correo'} | ${telefonos}</p>
                ${cliente.nit ? `<p class="text-sm text-gray-500">NIT: ${cliente.nit}</p>` : ''}
                <div class="mt-2 pt-2 border-t border-gray-100 text-sm">
                    <p><span class="font-semibold">Última Compra:</span> ${cliente.ultimaCompra}</p>
                    <p><span class="font-semibold">Total Comprado:</span> ${formatCurrency(cliente.totalComprado)}</p>
                </div>
            </div>
            <div class="flex-shrink-0 w-full sm:w-auto">
                 ${editButton}
            </div>
        `;
        clientesListEl.appendChild(clienteDiv);
    });
    document.querySelectorAll('.edit-client-btn').forEach(btn => btn.addEventListener('click', (e) => showEditClientModal(JSON.parse(e.currentTarget.dataset.clientJson))));
}

function loadProveedores() {
    const q = query(collection(db, "proveedores"), orderBy("nombre", "asc"));
    return onSnapshot(q, (snapshot) => {
        allProveedores = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderProveedores();
    });
}

function renderProveedores() {
    const proveedoresListEl = document.getElementById('proveedores-list');
    if (!proveedoresListEl) return;
    const searchTerm = document.getElementById('search-proveedores').value.toLowerCase();
    const filtered = allProveedores.filter(p => p.nombre.toLowerCase().includes(searchTerm));

    proveedoresListEl.innerHTML = '';
    if (filtered.length === 0) { proveedoresListEl.innerHTML = '<p>No hay proveedores registrados.</p>'; return; }

    filtered.forEach(proveedor => {
        const el = document.createElement('div');
        el.className = 'border p-4 rounded-lg flex justify-between items-center';
        const editButton = (currentUserData && currentUserData.role === 'admin')
            ? `<button data-provider-json='${JSON.stringify(proveedor)}' class="edit-provider-btn bg-gray-200 text-gray-700 px-3 py-1 rounded-lg text-sm font-semibold hover:bg-gray-300">Editar</button>`
            : '';
        el.innerHTML = `
            <div class="flex-grow">
                <p class="font-semibold">${proveedor.nombre}</p>
                <p class="text-sm text-gray-600">${proveedor.email || ''} | ${proveedor.telefono || ''}</p>
            </div>
            ${editButton}
        `;
        proveedoresListEl.appendChild(el);
    });
    document.querySelectorAll('.edit-provider-btn').forEach(btn => btn.addEventListener('click', (e) => showEditProviderModal(JSON.parse(e.currentTarget.dataset.providerJson))));
}
function loadRemisiones() {
    const q = query(collection(db, "remisiones"), orderBy("numeroRemision", "desc"));
    return onSnapshot(q, (snapshot) => {
        allRemisiones = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderRemisiones();
        renderFacturacion();
        renderClientes();
    });
}
/**
 * --- VERSIÓN COMPLETA Y CORREGIDA ---
 * Renderiza la lista de remisiones y maneja la visualización de PDFs de
 * forma diferente para escritorio y dispositivos móviles.
 */
function renderRemisiones() {
    const remisionesListEl = document.getElementById('remisiones-list');
    if (!remisionesListEl) return;

    const isPlanta = currentUserData && currentUserData.role === 'planta';
    const month = document.getElementById('filter-remisiones-month').value;
    const year = document.getElementById('filter-remisiones-year').value;
    const searchTerm = document.getElementById('search-remisiones').value.toLowerCase();
    let filtered = allRemisiones;

    if (isPlanta) {
        const allowedStates = ['Recibido', 'En Proceso', 'Procesado'];
        filtered = filtered.filter(r => allowedStates.includes(r.estado));
    }
    if (year !== 'all') {
        filtered = filtered.filter(r => new Date(r.fechaRecibido).getFullYear() == year);
    }
    if (month !== 'all') {
        filtered = filtered.filter(r => new Date(r.fechaRecibido).getMonth() == month);
    }
    if (searchTerm) {
        filtered = filtered.filter(r => r.clienteNombre.toLowerCase().includes(searchTerm) || r.numeroRemision.toString().includes(searchTerm));
    }
    filtered.sort((a, b) => new Date(b.fechaRecibido) - new Date(a.fechaRecibido));

    remisionesListEl.innerHTML = '';
    if (filtered.length === 0) {
        remisionesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No se encontraron remisiones.</p>';
        return;
    }

    filtered.forEach((remision) => {
        const el = document.createElement('div');
        const esAnulada = remision.estado === 'Anulada';
        const esEntregada = remision.estado === 'Entregado';
        el.className = `border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${esAnulada ? 'remision-anulada' : ''}`;

        const totalPagadoConfirmado = (remision.payments || []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const saldoPendiente = remision.valorTotal - totalPagadoConfirmado;

        let paymentStatusBadge = '';
        if (!esAnulada) {
            if (saldoPendiente <= 0) {
                paymentStatusBadge = `<span class="payment-status payment-pagado">Pagado</span>`;
            } else if (totalPagadoConfirmado > 0) {
                paymentStatusBadge = `<span class="payment-status payment-abono">Abono</span>`;
            } else {
                paymentStatusBadge = `<span class="payment-status payment-pendiente">Pendiente</span>`;
            }
        }

        const pdfPath = isPlanta ? remision.pdfPlantaPath : remision.pdfPath;

        const pdfButton = pdfPath
            ? `<button data-file-path="${pdfPath}" data-file-title="Remisión N° ${remision.numeroRemision}" class="w-full bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 transition text-center">Ver Remisión</button>`
            : `<button class="w-full bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-semibold btn-disabled" title="El PDF para esta remisión aún no está disponible.">Generando PDF...</button>`;

        const anularButton = (esAnulada || esEntregada || isPlanta || (remision.payments && remision.payments.length > 0)) ? '' : `<button data-remision-id="${remision.id}" class="anular-btn w-full bg-yellow-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-yellow-600 transition">Anular</button>`;
        const pagosButton = esAnulada || isPlanta ? '' : `<button data-remision-json='${JSON.stringify(remision)}' class="payment-btn w-full bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-purple-700 transition">Pagos (${formatCurrency(saldoPendiente)})</button>`;
        const descuentoButton = (esAnulada || esEntregada || isPlanta || remision.discount) ? '' : `<button data-remision-json='${JSON.stringify(remision)}' class="discount-btn w-full bg-cyan-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-cyan-600 transition">Descuento</button>`;
        let discountInfo = '';
        if (remision.discount && remision.discount.percentage > 0) {
            discountInfo = `<span class="text-xs font-semibold bg-cyan-100 text-cyan-800 px-2 py-1 rounded-full">DTO ${remision.discount.percentage.toFixed(2)}%</span>`;
        }
        const statusClasses = { 'Recibido': 'status-recibido', 'En Proceso': 'status-en-proceso', 'Procesado': 'status-procesado', 'Entregado': 'status-entregado' };
        const statusBadge = `<span class="status-badge ${statusClasses[remision.estado] || ''}">${remision.estado}</span>`;
        let statusButton = '';
        const currentIndex = ESTADOS_REMISION.indexOf(remision.estado);
        if (!esAnulada && currentIndex < ESTADOS_REMISION.length - 1) {
            const nextStatus = ESTADOS_REMISION[currentIndex + 1];
            statusButton = `<button data-remision-id="${remision.id}" data-current-status="${remision.estado}" class="status-update-btn w-full bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-600 transition">Mover a ${nextStatus}</button>`;
        }
        el.innerHTML = `
            <div class="flex-grow">
                <div class="flex items-center gap-3 flex-wrap">
                    <span class="remision-id">N° ${remision.numeroRemision}</span>
                    <p class="font-semibold text-lg">${remision.clienteNombre}</p>
                    ${statusBadge} ${paymentStatusBadge} ${discountInfo}
                    ${esAnulada ? '<span class="px-2 py-1 bg-red-200 text-red-800 text-xs font-bold rounded-full">ANULADA</span>' : ''}
                </div>
                <p class="text-sm text-gray-600 mt-1">Recibido: ${remision.fechaRecibido} &bull; ${remision.fechaEntrega ? `Entregado: ${remision.fechaEntrega}` : 'Entrega: Pendiente'}</p>
                ${!isPlanta ? `<p class="text-sm text-gray-600 mt-1">Total: <span class="font-bold">${formatCurrency(remision.valorTotal)}</span></p>` : ''}
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-shrink-0 w-full sm:max-w-xs">
                ${statusButton} ${pdfButton} ${pagosButton} ${descuentoButton} ${anularButton}
            </div>`;
        remisionesListEl.appendChild(el);
    });

    // Reasignar listeners para los otros botones
    remisionesListEl.querySelectorAll('.anular-btn').forEach(button => button.addEventListener('click', (e) => { const remisionId = e.currentTarget.dataset.remisionId; if (confirm(`¿Estás seguro de que quieres ANULAR esta remisión?`)) { handleAnularRemision(remisionId); } }));
    remisionesListEl.querySelectorAll('.status-update-btn').forEach(button => button.addEventListener('click', (e) => { const remisionId = e.currentTarget.dataset.remisionId; const currentStatus = e.currentTarget.dataset.currentStatus; handleStatusUpdate(remisionId, currentStatus); }));
    remisionesListEl.querySelectorAll('.payment-btn').forEach(button => button.addEventListener('click', (e) => { const remision = JSON.parse(e.currentTarget.dataset.remisionJson); showPaymentModal(remision); }));
    remisionesListEl.querySelectorAll('.discount-btn').forEach(button => button.addEventListener('click', (e) => { const remision = JSON.parse(e.currentTarget.dataset.remisionJson); showDiscountModal(remision); }));
}
function loadGastos() {
    const q = query(collection(db, "gastos"), orderBy("fecha", "desc"));
    return onSnapshot(q, (snapshot) => {
        allGastos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderGastos();
    });
}
function renderGastos() {
    const gastosListEl = document.getElementById('gastos-list');
    if (!gastosListEl) return;

    const month = document.getElementById('filter-gastos-month').value;
    const year = document.getElementById('filter-gastos-year').value;
    const searchTerm = document.getElementById('search-gastos').value.toLowerCase();

    let filtered = allGastos;

    if (year !== 'all') {
        filtered = filtered.filter(g => new Date(g.fecha).getFullYear() == year);
    }
    if (month !== 'all') {
        filtered = filtered.filter(g => new Date(g.fecha).getMonth() == month);
    }
    if (searchTerm) {
        filtered = filtered.filter(g => g.proveedorNombre.toLowerCase().includes(searchTerm) || (g.numeroFactura && g.numeroFactura.toLowerCase().includes(searchTerm)));
    }

    gastosListEl.innerHTML = '';
    if (filtered.length === 0) {
        gastosListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay gastos registrados.</p>';
        return;
    }

    filtered.forEach((gasto) => {
        const el = document.createElement('div');
        // **** ESTA LÍNEA ES LA CORRECCIÓN ****
        el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2';
        el.innerHTML = `
            <div class="w-full sm:w-auto">
                <p class="font-semibold">${gasto.proveedorNombre}</p>
                <p class="text-sm text-gray-600">${gasto.fecha} ${gasto.numeroFactura ? `| Factura: ${gasto.numeroFactura}` : ''}</p>
            </div>
            <div class="text-left sm:text-right w-full sm:w-auto mt-2 sm:mt-0">
                <p class="font-bold text-lg text-red-600">${formatCurrency(gasto.valorTotal)}</p>
                <p class="text-sm text-gray-500">Pagado con: ${gasto.fuentePago}</p>
            </div>
        `;
        gastosListEl.appendChild(el);
    });
}

function renderFacturacion() {
    const pendientesListEl = document.getElementById('facturacion-pendientes-list');
    const realizadasListEl = document.getElementById('facturacion-realizadas-list');
    if (!pendientesListEl || !realizadasListEl) return;

    const remisionesParaFacturar = allRemisiones.filter(r => r.incluyeIVA && r.estado !== 'Anulada');
    const pendientes = remisionesParaFacturar.filter(r => !r.facturado);
    const realizadas = remisionesParaFacturar.filter(r => r.facturado === true);

    pendientesListEl.innerHTML = '';
    if (pendientes.length === 0) {
        pendientesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay remisiones pendientes de facturar.</p>';
    } else {
        pendientes.forEach(remision => {
            const el = document.createElement('div');
            el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4';
            const clienteDeRemision = allClientes.find(c => c.id === remision.idCliente);
            let botonRUT = '';
            let infoClienteExtra = '';
            if (clienteDeRemision) {
                if (clienteDeRemision.rutUrl) {
                    let rutPath = '';
                    try {
                        const urlString = clienteDeRemision.rutUrl;
                        const pathStartIndex = urlString.indexOf('/o/');
                        if (pathStartIndex !== -1) {
                            const encodedPath = urlString.substring(pathStartIndex + 3);
                            rutPath = decodeURIComponent(encodedPath.split('?')[0]);
                        }
                    } catch (e) { console.error("Error procesando URL de RUT:", e); }
                    if (rutPath) {
                        botonRUT = `<button data-file-path="${rutPath}" data-file-title="RUT de ${clienteDeRemision.nombre}" class="bg-purple-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-purple-600">RUT</button>`;
                    }
                }
                infoClienteExtra = `<p class="text-sm text-gray-500 mt-1">${clienteDeRemision.nit ? `NIT: ${clienteDeRemision.nit}` : ''}${clienteDeRemision.nit && clienteDeRemision.email ? ' &bull; ' : ''}${clienteDeRemision.email || ''}</p>`;
            }
            const remisionPdfButton = remision.pdfPath ? `<button data-file-path="${remision.pdfPath}" data-file-title="Remisión N° ${remision.numeroRemision}" class="bg-gray-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-600">Ver Remisión</button>` : `<button class="bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-semibold cursor-not-allowed">Generando...</button>`;
            el.innerHTML = `<div class="flex-grow"><div class="flex items-center gap-3 flex-wrap"><span class="remision-id">N° ${remision.numeroRemision}</span><p class="font-semibold text-lg">${remision.clienteNombre}</p></div>${infoClienteExtra}<p class="text-sm text-gray-600 mt-1">Fecha: ${remision.fechaRecibido} &bull; Total: <span class="font-bold">${formatCurrency(remision.valorTotal)}</span></p></div><div class="flex-shrink-0 flex items-center gap-2 flex-wrap justify-end">${botonRUT}${remisionPdfButton}<button data-remision-id="${remision.id}" class="facturar-btn bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700">Facturar</button></div>`;
            pendientesListEl.appendChild(el);
        });
    }

    realizadasListEl.innerHTML = '';
    if (realizadas.length === 0) {
        realizadasListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay remisiones facturadas.</p>';
    } else {
        realizadas.forEach(remision => {
            const el = document.createElement('div');
            el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4';
            const clienteDeRemision = allClientes.find(c => c.id === remision.idCliente);
            let infoClienteExtra = '';
            if (clienteDeRemision) {
                infoClienteExtra = `<p class="text-sm text-gray-500 mt-1">${clienteDeRemision.nit ? `NIT: ${clienteDeRemision.nit}` : ''}${clienteDeRemision.nit && clienteDeRemision.email ? ' &bull; ' : ''}${clienteDeRemision.email || ''}</p>`;
            }

            // --- INICIO DE LA CORRECCIÓN CLAVE ---
            // 1. Botón de Ver Remisión usa la ruta
            const remisionPdfButton = remision.pdfPath ? `<button data-file-path="${remision.pdfPath}" data-file-title="Remisión N° ${remision.numeroRemision}" class="bg-gray-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-600">Ver Remisión</button>` : '';

            // 2. Lógica de Factura ahora busca 'facturaPdfPath'
            let facturaButtons = remision.facturaPdfPath
                ? `<button data-file-path="${remision.facturaPdfPath}" data-file-title="Factura N° ${remision.numeroFactura || remision.numeroRemision}" class="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700">Ver Factura</button>`
                : `<button data-remision-id="${remision.id}" class="facturar-btn bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-orange-600">Adjuntar Factura</button>`;
            // --- FIN DE LA CORRECCIÓN CLAVE ---

            el.innerHTML = `<div class="flex-grow"><div class="flex items-center gap-3 flex-wrap"><span class="remision-id">N° ${remision.numeroRemision}</span><p class="font-semibold text-lg">${remision.clienteNombre}</p></div>${infoClienteExtra}<p class="text-sm text-gray-600 mt-1">Fecha: ${remision.fechaRecibido} &bull; Total: <span class="font-bold">${formatCurrency(remision.valorTotal)}</span></p></div><div class="flex-shrink-0 flex items-center gap-2 flex-wrap justify-end"><div class="text-right"><span class="status-badge status-entregado">Facturado</span>${remision.numeroFactura ? `<p class="text-sm text-gray-600 mt-1">Factura N°: <span class="font-semibold">${remision.numeroFactura}</span></p>` : ''}</div>${facturaButtons}${remisionPdfButton}</div>`;
            realizadasListEl.appendChild(el);
        });
    }

    document.querySelectorAll('.facturar-btn').forEach(btn => btn.addEventListener('click', (e) => showFacturaModal(e.currentTarget.dataset.remisionId)));
}

// --- FUNCIONES DEL MÓDULO DE INVENTARIO ---
function loadImportaciones() {
    const q = query(collection(db, "importaciones"), orderBy("numeroImportacion", "desc"));
    return onSnapshot(q, (snapshot) => {
        allImportaciones = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderImportaciones();
        calculateAllAverageCosts(); // <-- AÑADIDO: Llama al cálculo de costos.
    });
}


/**
 * --- VERSIÓN CORREGIDA CON DOS ESTADOS INDEPENDIENTES ---
 * Renderiza la lista de importaciones mostrando un estado para la logística y otro para la documentación.
 */
function renderImportaciones() {
    const container = document.getElementById('importaciones-list');
    if (!container) return;

    container.innerHTML = '';

    if (allImportaciones.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-4 col-span-full">No hay importaciones registradas.</p>';
        return;
    }

    allImportaciones
        .slice()
        .sort((a, b) => b.numeroImportacion - a.numeroImportacion)
        .forEach(imp => {
            // --- LÓGICA DE DOS ESTADOS ---
            const logisticaStatus = getImportacionStatus(imp); // Obtiene el estado logístico/financiero
            const documentosSubidos = Object.keys(imp.documentos || {}).length;
            const documentosRequeridos = DOCUMENTOS_IMPORTACION.length;

            let docStatusHTML = '';
            if (imp.estadoLogistico !== 'En Bodega') { // Solo muestra el estado de documentos si no ha llegado a bodega
                if (documentosSubidos === documentosRequeridos) {
                    docStatusHTML = `<span class="text-xs font-semibold px-2 py-1 rounded-full bg-teal-100 text-teal-800">Doc. Completos</span>`;
                } else {
                    docStatusHTML = `<span class="text-xs font-semibold px-2 py-1 rounded-full bg-orange-100 text-orange-800">Doc. Faltantes</span>`;
                }
            }
            // --- FIN DE LA LÓGICA ---

            const trm = imp.trmLiquidacion || 4100;
            const totalChinaUSD = imp.totalChinaUSD || 0;
            const totalNacionalizacionCOP = Math.round(imp.totalNacionalizacionCOP || 0);
            const totalAbonadoChinaUSD = (imp.abonos || []).reduce((sum, abono) => sum + (abono.valorUSD || 0), 0);
            const saldoChinaCOP = Math.round((totalChinaUSD - totalAbonadoChinaUSD) * trm);

            let totalAbonadoNacionalizacion = 0;
            if (imp.gastosNacionalizacion) {
                Object.values(imp.gastosNacionalizacion).forEach(gasto => {
                    (gasto.facturas || []).forEach(factura => {
                        totalAbonadoNacionalizacion += (factura.abonos || []).reduce((sum, abono) => sum + abono.valor, 0);
                    });
                });
            }
            const saldoNacionalizacionCOP = totalNacionalizacionCOP - Math.round(totalAbonadoNacionalizacion);
            const granTotalCOP = Math.round(totalChinaUSD * trm) + totalNacionalizacionCOP;

            const operationDays = getOperationDays(imp.fechaPedido);
            let fechasHTML = `<p class="text-xs text-gray-500">${operationDays}</p>`;
            if (imp.fechaLlegadaPuerto) fechasHTML += `<p class="text-xs text-gray-500">Puerto: ${imp.fechaLlegadaPuerto}</p>`;
            if (imp.fechaLlegadaBodega) fechasHTML += `<p class="text-xs text-gray-500">Bodega: ${imp.fechaLlegadaBodega}</p>`;

            const card = document.createElement('div');
            card.className = 'importacion-card bg-white p-4 rounded-lg shadow-sm border flex flex-col';

            card.innerHTML = `
                <div class="flex-grow">
                    <div class="flex justify-between items-start">
                        <h3 class="font-bold text-lg text-gray-800">Importación N° ${imp.numeroImportacion}</h3>
                        <div class="flex flex-col items-end gap-1">
                           <span class="text-xs font-semibold px-2 py-1 rounded-full ${logisticaStatus.color}">${logisticaStatus.text}</span>
                           ${docStatusHTML}
                        </div>
                    </div>
                    <p class="text-sm text-gray-600 mt-1">${imp.naviera || 'Proveedor no especificado'}</p>
                    <p class="text-sm text-gray-500">BL: ${imp.numeroBl || 'N/A'}</p>
                    <div class="mt-1">${fechasHTML}</div>
                </div>

                <div class="border-t mt-3 pt-3 space-y-1">
                    <div class="flex justify-between text-sm">
                        <span class="font-semibold text-gray-700">Total Importación:</span>
                        <span class="font-bold">${formatCurrency(granTotalCOP)}</span>
                    </div>
                    <div class="flex justify-between text-sm text-blue-600">
                        <span class="font-semibold">Saldo China:</span>
                        <span class="font-bold">${formatCurrency(saldoChinaCOP)}</span>
                    </div>
                    <div class="flex justify-between text-sm text-red-600">
                        <span class="font-semibold">Saldo Nacionalización:</span>
                        <span class="font-bold">${formatCurrency(saldoNacionalizacionCOP)}</span>
                    </div>
                </div>

                <button class="edit-importacion-btn mt-4 w-full flex items-center justify-center gap-2 border-2 border-indigo-500 text-indigo-500 font-semibold py-2 px-4 rounded-lg hover:bg-indigo-500 hover:text-white transition-colors duration-200 text-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg>
                    Gestionar
                </button>
            `;

            card.querySelector('.edit-importacion-btn').addEventListener('click', () => showImportacionModal(imp));
            container.appendChild(card);
        });
}

/**
 * Rellena la sección de documentos en el modal de importación.
 */
function renderDocumentosSection(importacion) {
    const container = document.getElementById('documentos-container');
    if (!container) return;
    container.innerHTML = ''; // Limpiar el contenedor
    // Clases para un grid responsive que se ajusta a diferentes tamaños de pantalla
    container.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4';

    DOCUMENTOS_IMPORTACION.forEach(docInfo => {
        const docId = docInfo.id;
        const docName = docInfo.name;
        const existingDoc = importacion?.documentos?.[docId];

        const docCard = document.createElement('div');
        docCard.id = `doc-card-${docId}`;
        docCard.className = `doc-card bg-white p-3 rounded-lg shadow-sm ${existingDoc ? 'doc-card-complete' : 'doc-card-pending'}`;

        const getIcon = (status) => {
            switch (status) {
                case 'complete': return `<svg class="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
                case 'loading': return `<svg class="h-8 w-8 animate-spin text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
                default: return `<svg class="h-8 w-8 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`;
            }
        };

        let fileInfoHTML = `<p class="text-xs text-gray-500">Aún no se ha adjuntado.</p>`;
        if (existingDoc) {
            fileInfoHTML = `<a href="${existingDoc.url}" target="_blank" class="text-sm text-blue-600 hover:underline break-all" title="${existingDoc.name}">${existingDoc.name}</a>`;
        }

        docCard.innerHTML = `
            <div class="doc-card-main">
                <div class="doc-card-icon" id="doc-icon-${docId}">${getIcon(existingDoc ? 'complete' : 'pending')}</div>
                <div class="doc-card-body">
                    <p class="font-semibold text-gray-800">${docName}</p>
                    <div id="doc-info-${docId}" class="mt-1">${fileInfoHTML}</div>
                </div>
            </div>
            <div class="doc-card-footer">
                <input type="file" id="doc-file-${docId}" class="hidden" data-doc-tipo="${docId}">
                <label for="doc-file-${docId}" class="bg-gray-200 text-gray-700 text-xs font-bold py-1 px-3 rounded-full hover:bg-gray-300 cursor-pointer">
                    ${existingDoc ? 'Reemplazar' : 'Subir'}
                </label>
            </div>
        `;
        container.appendChild(docCard);

        docCard.querySelector(`#doc-file-${docId}`).addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && importacion.id) {
                handleDocumentoUpload(importacion.id, docId, file);
            }
        });
    });
}
/**
 * Rellena la sección de gastos de nacionalización en el modal.
 */
function renderGastosNacionalizacionSection(importacion) {
    const container = document.getElementById('gastos-nacionalizacion-container');
    if (!container) return;
    container.innerHTML = '';
    GASTOS_NACIONALIZACION.forEach(gastoInfo => {
        const gastoTipo = gastoInfo.id;
        const gastoData = importacion?.gastosNacionalizacion?.[gastoTipo] || { facturas: [] };
        const facturas = gastoData.facturas || [];
        const gastoElement = document.createElement('div');
        gastoElement.className = 'gasto-nacionalizacion-card bg-gray-50 p-4 rounded-lg border';
        gastoElement.innerHTML = `
            <div class="flex justify-between items-center">
                <h4 class="text-md font-semibold text-gray-800">${gastoInfo.name}</h4>
                <button type="button" class="add-factura-btn bg-blue-500 text-white text-xs font-bold py-1 px-3 rounded-full hover:bg-blue-600" data-gasto-tipo="${gastoTipo}">+ Añadir Factura</button>
            </div>
            <div id="facturas-container-${gastoTipo}" class="mt-3 space-y-3"></div>
        `;
        container.appendChild(gastoElement);
        const facturasContainer = document.getElementById(`facturas-container-${gastoTipo}`);
        if (facturas.length > 0) {
            facturas.forEach(factura => {
                const facturaElement = createGastoFacturaElement(gastoTipo, factura);
                facturasContainer.appendChild(facturaElement);
            });
        }
    });
}

/**
 * --- VERSIÓN SIMPLIFICADA Y CORREGIDA ---
 * Crea el elemento para una factura de nacionalización. Vuelve al diseño de
 * "Valor Total" simple, aplicable a todas las categorías incluyendo IVA y Arancel.
 * @param {string} gastoTipo - El tipo de gasto.
 * @param {object} [factura=null] - El objeto de la factura existente.
 * @returns {HTMLElement} El elemento de la tarjeta de la factura.
 */
function createGastoFacturaElement(gastoTipo, factura = null) {
    const isSaved = factura && factura.id;
    const facturaId = isSaved ? factura.id : `factura_${new Date().getTime()}`;
    const facturaData = factura || { id: facturaId, numeroFactura: '', proveedorId: '', proveedorNombre: '', valorTotal: 0, abonos: [], pdfUrl: null };

    const facturaCard = document.createElement('div');
    facturaCard.className = 'factura-card bg-white p-3 rounded-md border border-gray-300';
    facturaCard.dataset.facturaId = facturaData.id;
    facturaCard.dataset.gastoTipo = gastoTipo;

    let cardContentHTML = '';

    // --- INICIO DE LA CORRECCIÓN ---
    // Generamos las opciones de pago una sola vez para reutilizarlas
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');
    // --- FIN DE LA CORRECCIÓN ---

    if (isSaved) {
        // --- DISEÑO PARA FACTURAS GUARDADAS ---
        const totalAbonado = (facturaData.abonos || []).reduce((sum, abono) => sum + abono.valor, 0);
        const saldoPendiente = facturaData.valorTotal - totalAbonado;
        let pdfSectionHTML = '';
        if (facturaData.pdfUrl) {
            pdfSectionHTML = `<div class="mt-2"><a href="${facturaData.pdfUrl}" target="_blank" class="w-full inline-block text-center bg-blue-600 text-white font-semibold py-2 px-3 rounded-lg hover:bg-blue-700 text-sm">Ver PDF</a></div>`;
        } else {
            pdfSectionHTML = `<label for="update-pdf-${facturaId}" class="text-xs font-semibold">Adjuntar PDF</label><input type="file" id="update-pdf-${facturaId}" class="update-factura-pdf-input w-full text-sm mt-1" accept=".pdf"><button type="button" class="update-pdf-btn mt-1 w-full bg-orange-500 text-white text-xs font-bold py-1 rounded hover:bg-orange-600" data-factura-id="${facturaId}" data-gasto-tipo="${gastoTipo}">Guardar PDF</button>`;
        }
        cardContentHTML = `
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div class="md:col-span-1">
                    <label class="text-xs font-semibold">Proveedor</label>
                    <input type="text" class="proveedor-search-input w-full p-2 border rounded-lg text-sm bg-gray-100" value="${facturaData.proveedorNombre || ''}" disabled>
                    <input type="hidden" class="proveedor-id-hidden" value="${facturaData.proveedorId || ''}">
                    <label class="text-xs font-semibold mt-2 block">N° Factura</label>
                    <input type="text" class="factura-numero-input w-full p-2 border rounded-lg text-sm bg-gray-100" value="${facturaData.numeroFactura || ''}" disabled>
                </div>
                <div class="md:col-span-1">
                    <label class="text-xs font-semibold">Valor Total</label>
                    <input type="text" class="factura-valor-total-input cost-input-cop w-full p-2 border rounded-lg text-sm font-bold bg-gray-100" value="${formatCurrency(facturaData.valorTotal || 0)}" disabled>
                    <div class="mt-2">${pdfSectionHTML}</div>
                </div>
                <div class="md:col-span-1 text-xs space-y-1 bg-gray-50 p-2 rounded-lg h-full flex flex-col justify-center"><div class="flex justify-between"><span>Abonado:</span> <span class="font-medium">${formatCurrency(totalAbonado)}</span></div><div class="flex justify-between text-red-600"><span>Saldo:</span> <span class="font-bold">${formatCurrency(saldoPendiente)}</span></div></div>
                <div class="bg-gray-50 p-2 rounded-lg"><label class="text-xs font-semibold">Registrar Abono</label><div class="mt-2 space-y-2"><input type="text" placeholder="Valor Abono" class="abono-valor-input cost-input-cop w-full p-1 border rounded text-xs"><select class="abono-forma-pago-input w-full p-1 border rounded text-xs bg-white">${metodosDePagoHTML}</select><button type="button" class="add-abono-gasto-btn w-full bg-green-500 text-white text-xs font-bold py-1 rounded hover:bg-green-600" data-gasto-tipo="${gastoTipo}" data-factura-id="${facturaData.id}">+ Abono</button></div></div>
            </div>`;
    } else {
        // --- DISEÑO PARA FACTURAS NUEVAS ---
        cardContentHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-3">
                     <div class="relative"><label class="text-xs font-semibold">Proveedor</label><input type="text" placeholder="Buscar..." class="proveedor-search-input w-full p-2 border rounded-lg text-sm" autocomplete="off"><input type="hidden" class="proveedor-id-hidden"><div class="search-results hidden"></div></div>
                    <div><label class="text-xs font-semibold">N° Factura</label><input type="text" placeholder="N° Factura" class="factura-numero-input w-full p-2 border rounded-lg text-sm"></div>
                </div>
                <div class="space-y-3">
                    <div><label class="text-xs font-semibold">Valor Total Factura</label><input type="text" placeholder="Valor Total" class="factura-valor-total-input cost-input-cop w-full p-2 border rounded-lg text-sm font-bold"></div>
                    <div><label class="text-xs font-semibold">Factura (PDF)</label><input type="file" class="factura-pdf-input w-full text-sm mt-1" accept=".pdf"></div>
                </div>
            </div>`;
    }

    facturaCard.innerHTML = cardContentHTML + `<div class="mt-3 flex gap-4">${!isSaved ? `<button type="button" class="save-factura-btn text-blue-600 hover:text-blue-800 font-bold text-xs" data-gasto-tipo="${gastoTipo}">Guardar Factura</button>` : ''}<button type="button" class="remove-factura-btn text-red-500 hover:text-red-700 text-xs">Eliminar Factura</button></div>`;

    if (!isSaved) {
        initSearchableInput(facturaCard.querySelector('.proveedor-search-input'), facturaCard.querySelector('.search-results'), () => allProveedores, (p) => p.nombre, (sel) => {
            facturaCard.querySelector('.proveedor-id-hidden').value = sel ? sel.id : '';
        });
    }
    return facturaCard;
}


/**
 * --- NUEVA FUNCIÓN ---
 * Calcula el costo promedio ponderado para cada ítem basándose en todas las
 * importaciones registradas.
 */
function calculateAllAverageCosts() {
    const costData = {}; // Objeto temporal para acumular costos y cantidades

    // 1. Recorrer todas las importaciones para recolectar datos
    allImportaciones.forEach(imp => {
        const trm = imp.trmLiquidacion || 4100; // Usar TRM de la importación
        if (imp.items && Array.isArray(imp.items)) {
            imp.items.forEach(item => {
                if (item.itemId && item.cantidad > 0 && item.valorTotalItemUSD > 0) {
                    if (!costData[item.itemId]) {
                        costData[item.itemId] = { totalCostCOP: 0, totalQuantity: 0 };
                    }
                    const costInCOP = item.valorTotalItemUSD * trm;
                    costData[item.itemId].totalCostCOP += costInCOP;
                    costData[item.itemId].totalQuantity += item.cantidad;
                }
            });
        }
    });

    // 2. Calcular el promedio para cada ítem y guardarlo en la variable global
    allItemAverageCosts = {}; // Limpiar los costos antiguos
    for (const itemId in costData) {
        const data = costData[itemId];
        if (data.totalQuantity > 0) {
            allItemAverageCosts[itemId] = data.totalCostCOP / data.totalQuantity;
        }
    }

    // 3. Volver a renderizar la lista de ítems para mostrar los nuevos costos
    renderItems();
}


/**
 * --- VERSIÓN CON LÓGICA DE COSTEO AVANZADA ---
 * Calcula los totales y prepara los datos para el costeo final, separando
 * los gastos por volumen y los gastos por valor.
 */
function calcularTotalesImportacionCompleto() {
    const form = document.getElementById('importacion-form');
    if (!form) return;

    const items = Array.from(form.querySelectorAll('.import-item-row')).map(row => {
        const itemId = row.querySelector('.item-id-hidden')?.value;
        const itemData = allItems.find(i => i.id === itemId);
        return {
            itemId: itemId,
            descripcion: row.querySelector('.item-descripcion-hidden')?.value || row.querySelector('.item-search-input').value,
            cantidad: parseInt(row.querySelector('.item-cantidad')?.value) || 0,
            valorTotalItemUSD: unformatCurrency(row.querySelector('.item-valor-total')?.value || '0', true),
            laminasPorCaja: itemData ? itemData.laminasPorCaja : 1
        };
    });

    // --- INICIO DE LA CORRECCIÓN ---
    const fleteUSD = unformatCurrency(form.querySelector('#importacion-flete')?.value || '0', true);
    const seguroUSD = unformatCurrency(form.querySelector('#importacion-seguro')?.value || '0', true);
    // --- FIN DE LA CORRECCIÓN ---

    let gastosPorVolumenCOP = 0;
    let gastosPorValorCOP = 0;

    form.querySelectorAll('.factura-card').forEach(card => {
        const gastoTipo = card.dataset.gastoTipo;
        // --- INICIO DE LA CORRECCIÓN ---
        const valor = unformatCurrency(card.querySelector('.factura-valor-total-input')?.textContent || card.querySelector('.factura-valor-total-input')?.value || '0');
        // --- FIN DE LA CORRECCIÓN ---

        if (gastoTipo === 'iva' || gastoTipo === 'arancel') {
            gastosPorValorCOP += valor;
        } else {
            gastosPorVolumenCOP += valor;
        }
    });

    const totalItemsUSD = items.reduce((sum, item) => sum + item.valorTotalItemUSD, 0);
    const totalChinaUSD = totalItemsUSD + fleteUSD + seguroUSD;
    const totalNacionalizacionCOP = gastosPorVolumenCOP + gastosPorValorCOP;
    const trm = parseFloat(document.getElementById('importacion-trm-hidden')?.value) || 4100;
    const totalChinaCOP = totalChinaUSD * trm;
    const granTotalCOP = totalChinaCOP + totalNacionalizacionCOP;

    document.getElementById('total-china-usd-display').textContent = `USD ${formatCurrency(totalChinaUSD, true)}`;
    document.getElementById('total-nacionalizacion-cop-display').textContent = `${formatCurrency(totalNacionalizacionCOP)}`;
    document.getElementById('resumen-total-china-cop').textContent = formatCurrency(Math.round(totalChinaCOP));
    document.getElementById('resumen-total-nacionalizacion-cop').textContent = formatCurrency(totalNacionalizacionCOP);
    document.getElementById('resumen-gran-total-cop').textContent = formatCurrency(Math.round(granTotalCOP));

    const totalItemsCOP = totalItemsUSD * trm;
    const fleteSeguroCOP = (fleteUSD + seguroUSD) * trm;
    renderCosteoFinal(items, totalItemsCOP, fleteSeguroCOP, gastosPorVolumenCOP, gastosPorValorCOP, trm);
}

/**
 * --- VERSIÓN MEJORADA ---
 * Sube un documento y actualiza la nueva interfaz de tarjeta interactiva.
 * @param {string} importacionId - El ID de la importación.
 * @param {string} docTipo - El tipo de documento (ej: 'provideInvoice').
 * @param {File} file - El archivo a subir.
 */
async function handleDocumentoUpload(importacionId, docTipo, file) {
    const docCard = document.getElementById(`doc-card-${docTipo}`);
    const iconContainer = document.getElementById(`doc-icon-${docTipo}`);
    const infoContainer = document.getElementById(`doc-info-${docTipo}`);
    const actionLabel = docCard.querySelector('label');

    if (!docCard || !iconContainer || !infoContainer) return;

    // --- Estado de Carga ---
    docCard.className = 'doc-card bg-white p-3 rounded-lg shadow-sm flex items-center gap-3 doc-card-pending';
    iconContainer.innerHTML = `<svg class="h-8 w-8 animate-spin text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
    infoContainer.innerHTML = `<p class="text-sm text-blue-600 font-semibold truncate" title="${file.name}">Subiendo: ${file.name}</p>`;
    actionLabel.textContent = '...';

    try {
        // Subir el archivo a Storage
        const storagePath = `importaciones/${importacionId}/documentos_soporte/${docTipo}_${file.name}`;
        const fileRef = ref(storage, storagePath);
        const snapshot = await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        // Actualizar el documento en Firestore
        const importacionRef = doc(db, "importaciones", importacionId);
        const updatePayload = {
            [`documentos.${docTipo}`]: { url: downloadURL, name: file.name }
        };
        await updateDoc(importacionRef, updatePayload);

        // --- Estado de Éxito ---
        docCard.className = 'doc-card bg-white p-3 rounded-lg shadow-sm flex items-center gap-3 doc-card-complete';
        iconContainer.innerHTML = `<svg class="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
        infoContainer.innerHTML = `<a href="${downloadURL}" target="_blank" class="text-sm text-blue-600 hover:underline truncate" title="${file.name}">${file.name}</a>`;
        actionLabel.textContent = 'Reemplazar';

        // Actualizar la data local
        const importacionIndex = allImportaciones.findIndex(i => i.id === importacionId);
        if (importacionIndex !== -1) {
            if (!allImportaciones[importacionIndex].documentos) {
                allImportaciones[importacionIndex].documentos = {};
            }
            allImportaciones[importacionIndex].documentos[docTipo] = { url: downloadURL, name: file.name };
        }

    } catch (error) {
        console.error("Error al subir documento:", error);
        // --- Estado de Error ---
        docCard.className = 'doc-card bg-white p-3 rounded-lg shadow-sm flex items-center gap-3 doc-card-error';
        iconContainer.innerHTML = `<svg class="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
        infoContainer.innerHTML = `<p class="text-xs text-red-600">Error al subir. Inténtalo de nuevo.</p>`;
        actionLabel.textContent = 'Reintentar';
    }
}

/**
 * Maneja el registro de un abono para una factura de nacionalización,
 * actualizando tanto Firestore como la caché local de datos (allImportaciones).
 */
async function handleGastoNacionalizacionAbonoSubmit(importacionId, gastoTipo, facturaId) {
    const facturaCard = document.querySelector(`.factura-card[data-factura-id="${facturaId}"]`);
    if (!facturaCard) {
        showModalMessage("Error: No se encontró la tarjeta de la factura en la interfaz.", "error");
        return;
    }

    const valorInput = facturaCard.querySelector('.abono-valor-input');
    const formaPagoInput = facturaCard.querySelector('.abono-forma-pago-input');
    const valorAbono = unformatCurrency(valorInput.value);

    if (isNaN(valorAbono) || valorAbono <= 0) {
        showModalMessage("El valor del abono debe ser un número mayor a cero.");
        return;
    }

    showModalMessage("Registrando abono...", true);

    try {
        const importacionRef = doc(db, "importaciones", importacionId);

        // --- INICIO DE LA CORRECCIÓN CLAVE ---
        // Usamos una transacción para leer y escribir de forma segura
        await runTransaction(db, async (transaction) => {
            const importacionDoc = await transaction.get(importacionRef);
            if (!importacionDoc.exists()) {
                throw new Error("La importación no fue encontrada.");
            }

            const importacionActual = importacionDoc.data();
            const gastosNacionalizacion = importacionActual.gastosNacionalizacion || {};
            const gastoActual = gastosNacionalizacion[gastoTipo];

            if (!gastoActual || !gastoActual.facturas) {
                throw new Error("No se encontró el tipo de gasto correspondiente.");
            }

            const facturaIndex = gastoActual.facturas.findIndex(f => f.id === facturaId);
            if (facturaIndex === -1) {
                throw new Error("No se pudo encontrar la factura para añadir el abono.");
            }

            const facturaActual = gastoActual.facturas[facturaIndex];
            const totalAbonado = (facturaActual.abonos || []).reduce((sum, abono) => sum + abono.valor, 0);
            const saldoPendiente = facturaActual.valorTotal - totalAbonado;

            if (valorAbono > saldoPendiente + 1) { // Margen de 1 peso por redondeo
                throw new Error(`El abono (${formatCurrency(valorAbono)}) no puede superar el saldo pendiente (${formatCurrency(saldoPendiente)}).`);
            }

            const nuevoAbono = {
                valor: valorAbono,
                formaPago: formaPagoInput.value,
                fecha: new Date().toISOString().split('T')[0],
                registradoPor: currentUser.uid,
                timestamp: new Date()
            };

            if (!facturaActual.abonos) {
                facturaActual.abonos = [];
            }
            facturaActual.abonos.push(nuevoAbono);

            // Actualizamos la factura dentro de la estructura de gastos
            gastosNacionalizacion[gastoTipo].facturas[facturaIndex] = facturaActual;

            // Actualizamos el documento en Firestore dentro de la transacción
            transaction.update(importacionRef, { gastosNacionalizacion });

            // Actualizamos la copia local (allImportaciones) para reflejar el cambio al instante
            const importacionIndexGlobal = allImportaciones.findIndex(i => i.id === importacionId);
            if (importacionIndexGlobal !== -1) {
                allImportaciones[importacionIndexGlobal].gastosNacionalizacion = gastosNacionalizacion;
            }
        });

        // Si la transacción fue exitosa, refrescamos el modal con los datos ya actualizados
        const importacionActualizada = allImportaciones.find(i => i.id === importacionId);
        showImportacionModal(importacionActualizada);
        showTemporaryMessage("Abono registrado con éxito.", "success");
        // --- FIN DE LA CORRECCIÓN CLAVE ---

    } catch (error) {
        console.error("Error al registrar abono:", error);
        // El hideModal() se quita para que el mensaje de error sea visible
        showModalMessage(`Error: ${error.message}`);
    }
}

/**
 * --- NUEVA FUNCIÓN ---
 * Muestra el modal para registrar una nueva compra a un proveedor nacional.
 * (Esta es la estructura inicial que construiremos más adelante).
 */
/**
 * --- VERSIÓN COMPLETA PARA COMPRAS NACIONALES ---
 * Muestra el modal para registrar o gestionar una nueva compra a un proveedor nacional.
 * @param {object} [compra=null] - El objeto de la compra existente (opcional).
 */
async function showNacionalModal(compra = null) {
    const isEditing = compra !== null;
    const title = isEditing ? `Gestionar Compra Nacional` : "Registrar Compra Nacional";
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    // --- INICIO DE LA CORRECCIÓN ---
    // Generamos las opciones de pago una sola vez para reutilizarlas
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');
    // --- FIN DE LA CORRECCIÓN ---

    let abonosHTML = '';
    if (isEditing) {
        const totalAbonado = (compra.abonos || []).reduce((sum, abono) => sum + abono.valor, 0);
        const saldoPendiente = (compra.valorTotalCompra || 0) - totalAbonado;
        const historialAbonos = (compra.abonos || []).map(abono =>
            `<li class="text-xs flex justify-between"><span>${abono.fecha}: ${abono.formaPago}</span> <span class="font-medium">${formatCurrency(abono.valor)}</span></li>`
        ).join('');

        abonosHTML = `
            <div>
                <h3 class="text-lg font-bold text-gray-800 mb-2">3. Gestión de Pagos</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="bg-gray-50 p-3 rounded-lg space-y-2">
                        <div class="flex justify-between items-center text-sm"><span class="font-semibold">Valor Total:</span><span class="font-bold">${formatCurrency(compra.valorTotalCompra)}</span></div>
                        <div class="flex justify-between items-center text-sm"><span class="font-semibold text-green-700">Total Abonado:</span><span class="font-bold text-green-700">${formatCurrency(totalAbonado)}</span></div>
                        <div class="flex justify-between items-center text-sm border-t pt-1 mt-1"><span class="font-semibold text-red-700">Saldo Pendiente:</span><span class="font-bold text-red-700">${formatCurrency(saldoPendiente)}</span></div>
                        <ul class="space-y-1 max-h-24 overflow-y-auto border-t pt-2 mt-2">${historialAbonos || '<li class="text-xs text-gray-400">Sin abonos.</li>'}</ul>
                    </div>
                    <div class="bg-gray-50 p-3 rounded-lg">
                        <div class="space-y-2">
                            <div><label class="text-xs font-semibold">Fecha Abono</label><input type="date" id="abono-nacional-fecha" class="w-full p-1 border rounded text-xs" value="${new Date().toISOString().slice(0, 10)}"></div>
                            <div><label class="text-xs font-semibold">Valor Abono (COP)</label><input type="text" id="abono-nacional-valor" class="cost-input-cop w-full p-1 border rounded text-xs"></div>
                            <div><label class="text-xs font-semibold">Forma de Pago</label><select id="abono-nacional-forma-pago" class="w-full p-1 border rounded text-xs bg-white">${metodosDePagoHTML}</select></div>
                        </div>
                        <button type="button" id="add-abono-nacional-btn" class="mt-2 w-full bg-green-600 text-white text-xs font-bold py-2 rounded hover:bg-green-700">+ Registrar Abono</button>
                    </div>
                </div>
            </div>`;
    }

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl mx-auto flex flex-col" style="max-height: 95vh;">
            <div class="flex justify-between items-center p-4 border-b">
                <h2 class="text-xl font-semibold">${title}</h2>
                <button id="close-nacional-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="p-6 overflow-y-auto flex-grow">
                <form id="nacional-form" class="space-y-6">
                    <input type="hidden" id="nacional-id" value="${isEditing ? compra.id : ''}">
                    <div>
                        <h3 class="text-lg font-bold text-gray-800 mb-2">1. Datos de la Compra</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="relative">
                                <label class="block text-sm font-medium">Proveedor</label>
                                <input type="text" id="nacional-proveedor-search" placeholder="Buscar proveedor..." class="w-full p-2 border rounded-lg mt-1" value="${compra?.proveedorNombre || ''}" ${isEditing ? 'disabled' : ''} required>
                                <input type="hidden" id="nacional-proveedor-id" value="${compra?.proveedorId || ''}">
                                <div id="nacional-proveedor-results" class="search-results hidden"></div>
                            </div>
                            <div>
                                <label class="block text-sm font-medium">Fecha de Compra</label>
                                <input type="date" id="nacional-fecha" class="w-full p-2 border rounded-lg mt-1" value="${compra?.fecha || new Date().toISOString().slice(0, 10)}" ${isEditing ? 'disabled' : ''} required>
                            </div>
                        </div>
                    </div>
                    <div>
                        <h3 class="text-lg font-bold text-gray-800 mb-2">2. Ítems de la Compra</h3>
                        <div id="nacional-items-container" class="space-y-4"></div>
                        ${!isEditing ? '<button type="button" id="add-nacional-item-btn" class="mt-4 w-full bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-300 text-sm">+ Añadir Ítem</button>' : ''}
                        <div class="text-right mt-4 bg-gray-100 p-2 rounded-lg">
                            <span class="font-bold text-lg">TOTAL COMPRA:</span>
                            <span id="nacional-total-compra" class="font-bold text-xl ml-4">${isEditing ? formatCurrency(compra.valorTotalCompra) : '$ 0'}</span>
                        </div>
                    </div>
                    ${abonosHTML}
                </form>
            </div>
            <div class="p-4 border-t text-right bg-gray-50">
                <button id="save-nacional-btn" class="bg-green-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-green-700">${isEditing ? 'Guardar Cambios' : 'Registrar Compra'}</button>
            </div>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-nacional-modal').addEventListener('click', hideModal);

    const saveBtn = document.getElementById('save-nacional-btn');
    if (isEditing) {
        saveBtn.disabled = true;
        saveBtn.classList.add('opacity-50');
    } else {
        saveBtn.addEventListener('click', handleNacionalSubmit);
    }

    if (!isEditing) {
        initSearchableInput(
            document.getElementById('nacional-proveedor-search'),
            document.getElementById('nacional-proveedor-results'),
            () => allProveedores, (p) => p.nombre, (sel) => {
                document.getElementById('nacional-proveedor-id').value = sel ? sel.id : '';
            }
        );

        const itemsContainer = document.getElementById('nacional-items-container');
        document.getElementById('add-nacional-item-btn').addEventListener('click', () => {
            itemsContainer.appendChild(createNacionalItemElement());
        });

        itemsContainer.appendChild(createNacionalItemElement());
    } else {
        const itemsContainer = document.getElementById('nacional-items-container');
        compra.items.forEach(item => {
            itemsContainer.appendChild(createNacionalItemElement(item, true));
        });

        document.getElementById('add-abono-nacional-btn')?.addEventListener('click', () => handleAbonoNacionalSubmit(compra.id));
    }
}

// Al cerrar el modal, detenemos el listener de transferencias
function hideModal() {
    const modal = document.getElementById('modal');
    if (modal) {
        modal.classList.add('hidden');
        // --- LÍNEA AÑADIDA ---
        // Detener listener de transferencias si está activo al cerrar CUALQUIER modal
        if (unsubscribePendingTransfers) {
            unsubscribePendingTransfers();
            unsubscribePendingTransfers = null;
        }
    }
}

/**
 * --- NUEVA FUNCIÓN ---
 * Calcula y muestra el total de la compra nacional en el formulario.
 */
function calcularTotalCompraNacional() {
    let total = 0;
    document.querySelectorAll('.nacional-item-row').forEach(row => {
        total += unformatCurrency(row.querySelector('.item-valor-total').value || '0');
    });
    document.getElementById('nacional-total-compra').textContent = formatCurrency(total);
}

/**
 * --- NUEVA FUNCIÓN ---
 * Guarda el registro de una nueva compra nacional en la base de datos.
 */
async function handleNacionalSubmit(e) {
    e.preventDefault();

    const proveedorId = document.getElementById('nacional-proveedor-id').value;
    if (!proveedorId) return showModalMessage("Debes seleccionar un proveedor válido.");

    let items;
    try {
        items = Array.from(document.querySelectorAll('.nacional-item-row')).map(row => {
            const itemId = row.querySelector('.item-id-hidden').value;
            if (!itemId) {
                // Lanza un error personalizado que será capturado por el bloque catch
                throw new Error("Has añadido una fila de ítem vacía o inválida. Por favor, elimínala o selecciona un ítem.");
            }
            return {
                itemId: itemId,
                descripcion: allItems.find(i => i.id === itemId)?.descripcion || 'N/A',
                cantidad: parseInt(row.querySelector('.item-cantidad').value) || 0,
                valorTotal: unformatCurrency(row.querySelector('.item-valor-total').value || '0')
            };
        });
    } catch (error) {
        // Captura el error específico de la fila de ítem vacía
        showModalMessage(error.message);
        return;
    }


    if (items.length === 0) return showModalMessage("Debes añadir al menos un ítem a la compra.");

    const valorTotalCompra = items.reduce((sum, item) => sum + item.valorTotal, 0);

    const nuevaCompra = {
        proveedorId: proveedorId,
        proveedorNombre: document.getElementById('nacional-proveedor-search').value,
        fecha: document.getElementById('nacional-fecha').value,
        items: items,
        valorTotalCompra: valorTotalCompra,
        abonos: [],
        estadoPago: 'Pendiente',
        creadoEn: new Date()
    };

    showModalMessage("Registrando compra y actualizando stock...", true);
    try {
        // --- INICIO DE LA LÓGICA DE ACTUALIZACIÓN DE STOCK ---
        const batch = writeBatch(db);

        // 1. Añadir la nueva compra al batch
        const compraDocRef = doc(collection(db, "comprasNacionales"));
        batch.set(compraDocRef, nuevaCompra);

        // 2. Actualizar el stock de cada ítem en el batch
        items.forEach(itemComprado => {
            const itemRef = doc(db, "items", itemComprado.itemId);
            const itemActual = allItems.find(i => i.id === itemComprado.itemId);
            if (itemActual) {
                const nuevoStock = (itemActual.stock || 0) + itemComprado.cantidad;
                batch.update(itemRef, { stock: nuevoStock });
            }
        });

        // 3. Ejecutar todas las operaciones de escritura a la vez
        await batch.commit();
        // --- FIN DE LA LÓGICA DE ACTUALIZACIÓN DE STOCK ---

        hideModal();
        showTemporaryMessage("¡Compra registrada y stock actualizado!", "success");

        // Se recarga el modal en modo edición para que se puedan añadir abonos
        showNacionalModal({ id: compraDocRef.id, ...nuevaCompra });

    } catch (error) {
        console.error("Error al registrar compra nacional:", error);
        showModalMessage("Error: " + error.message);
    }
}

/**
 * --- NUEVA FUNCIÓN ---
 * Registra un abono a una compra nacional y crea el gasto correspondiente.
 */
async function handleAbonoNacionalSubmit(compraId) {
    const valor = unformatCurrency(document.getElementById('abono-nacional-valor').value);
    if (isNaN(valor) || valor <= 0) return showModalMessage("El valor del abono debe ser mayor a cero.");

    const compraActual = allComprasNacionales.find(c => c.id === compraId);
    if (!compraActual) return showModalMessage("Error: No se encontró la compra.");

    const totalAbonado = (compraActual.abonos || []).reduce((sum, abono) => sum + abono.valor, 0);
    const saldoPendiente = compraActual.valorTotalCompra - totalAbonado;
    if (valor > saldoPendiente + 1) return showModalMessage(`El abono no puede superar el saldo pendiente de ${formatCurrency(saldoPendiente)}.`);

    const nuevoAbono = {
        fecha: document.getElementById('abono-nacional-fecha').value,
        valor: valor,
        formaPago: document.getElementById('abono-nacional-forma-pago').value,
        registradoPor: currentUser.uid,
        timestamp: new Date()
    };

    showModalMessage("Registrando abono y gasto...", true);
    try {
        const nuevoGasto = {
            fecha: nuevoAbono.fecha,
            proveedorId: compraActual.proveedorId,
            proveedorNombre: `Abono Compra: ${compraActual.proveedorNombre}`,
            numeroFactura: `Compra Nacional #${compraId.slice(0, 6)}`,
            valorTotal: nuevoAbono.valor,
            fuentePago: nuevoAbono.formaPago,
            registradoPor: currentUser.uid,
            timestamp: new Date(),
            isNationalPurchase: true,
            compraId: compraId
        };

        const compraRef = doc(db, "comprasNacionales", compraId);
        const gastoRef = collection(db, "gastos");

        const batch = writeBatch(db);
        batch.update(compraRef, { abonos: arrayUnion(nuevoAbono) });
        batch.set(doc(gastoRef), nuevoGasto);
        await batch.commit();

        hideModal();
        showTemporaryMessage("Abono y gasto registrados.", "success");
        const compraActualizada = { ...compraActual, abonos: [...compraActual.abonos, nuevoAbono] };
        showNacionalModal(compraActualizada);
    } catch (error) {
        console.error("Error al registrar abono nacional:", error);
        showModalMessage("Error al registrar el abono.");
    }
}

/**
 * --- VERSIÓN CON CAMPOS DE FECHA Y ESTADO RESTAURADOS ---
 * Vuelve a añadir las secciones para gestionar las fechas de llegada y
 * los botones para actualizar el estado logístico de la importación.
 */
async function showImportacionModal(importacion = null) {
    const isEditing = importacion !== null;
    const title = isEditing ? `Gestionar Importación N° ${importacion.numeroImportacion}` : "Crear Nueva Importación";
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    // --- INICIO DE LA CORRECCIÓN ---
    // Generamos las opciones de pago para importaciones desde la nueva constante
    const metodosDePagoImportacionHTML = METODOS_DE_PAGO_IMPORTACION.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');
    // --- FIN DE LA CORRECCIÓN ---

    let abonosChinaHTML = '';
    if (isEditing) {
        const totalChinaUSD = importacion.totalChinaUSD || 0;
        const totalAbonadoChinaUSD = (importacion.abonos || []).reduce((sum, abono) => sum + (abono.valorUSD || 0), 0);
        const saldoPendienteUSD = totalChinaUSD - totalAbonadoChinaUSD;

        const historialAbonos = (importacion.abonos || []).sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map(abono =>
            `<li class="text-xs flex justify-between items-center">
                <span>${abono.fecha}: ${formatCurrency(abono.valorCOP)} (${formatCurrency(abono.valorUSD, true)})</span>
                <span class="font-medium text-gray-500">TRM: ${abono.trmAbono ? abono.trmAbono.toFixed(2) : 'N/A'}</span>
            </li>`
        ).join('');

        abonosChinaHTML = `
            <div class="md:col-span-3 mt-4 pt-4 border-t">
                <h4 class="font-semibold mb-2 text-gray-800">Abonos a Costos de Origen</h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="bg-gray-50 p-3 rounded-lg space-y-2">
                        <div class="flex justify-between items-center text-sm"><span class="font-semibold">Total China (USD):</span><span class="font-bold">${formatCurrency(totalChinaUSD, true)}</span></div>
                        <div class="flex justify-between items-center text-sm"><span class="font-semibold text-green-700">Total Abonado (USD):</span><span class="font-bold text-green-700">${formatCurrency(totalAbonadoChinaUSD, true)}</span></div>
                        <div class="flex justify-between items-center text-sm border-t pt-1 mt-1"><span class="font-semibold text-red-700">Saldo Pendiente (USD):</span><span class="font-bold text-red-700">${formatCurrency(saldoPendienteUSD, true)}</span></div>
                        <ul class="space-y-1 max-h-24 overflow-y-auto border-t pt-2 mt-2">${historialAbonos || '<li class="text-xs text-gray-400">Sin abonos.</li>'}</ul>
                    </div>
                    <div class="bg-gray-50 p-3 rounded-lg">
                        <div class="space-y-2">
                            <div><label class="text-xs font-semibold">Fecha Abono</label><input type="date" id="abono-china-fecha" class="w-full p-1 border rounded text-xs" value="${new Date().toISOString().slice(0, 10)}"></div>
                            <div><label class="text-xs font-semibold">Valor Abono (COP)</label><input type="text" id="abono-china-valor-cop" class="cost-input-cop w-full p-1 border rounded text-xs"></div>
                            <div><label class="text-xs font-semibold">Valor Abono (USD)</label><input type="text" id="abono-china-valor-usd" class="cost-input-usd w-full p-1 border rounded text-xs"></div>
                            <div><label class="text-xs font-semibold">Forma de Pago</label><select id="abono-china-forma-pago" class="w-full p-1 border rounded text-xs bg-white">${metodosDePagoImportacionHTML}</select></div>
                        </div>
                        <button type="button" id="add-abono-china-btn" class="mt-2 w-full bg-green-600 text-white text-xs font-bold py-2 rounded hover:bg-green-700">+ Registrar Abono</button>
                    </div>
                </div>
            </div>`;
    }

    let logisticaHTML = '';
    if (isEditing) {
        logisticaHTML = `
            <div>
                <h3 class="text-lg font-bold text-gray-800 mb-2">5. Estado Logístico</h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg border">
                    <div>
                        <label class="block text-sm font-medium">Fecha Llegada a Puerto</label>
                        <input type="date" id="fecha-llegada-puerto" class="w-full p-2 border rounded-lg mt-1" value="${importacion.fechaLlegadaPuerto || ''}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Fecha Llegada a Bodega</label>
                        <input type="date" id="fecha-llegada-bodega" class="w-full p-2 border rounded-lg mt-1" value="${importacion.fechaLlegadaBodega || ''}">
                    </div>
                    <div class="flex flex-col justify-end space-y-2">
                        ${importacion.estadoLogistico === 'Creada' ? `<button type="button" id="set-en-puerto-btn" class="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700">Marcar "En Puerto"</button>` : ''}
                        ${importacion.estadoLogistico !== 'En Bodega' ? `<button type="button" id="set-en-bodega-btn" class="w-full bg-green-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-green-700">Marcar "En Bodega"</button>` : ''}
                    </div>
                </div>
            </div>`;
    }

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-auto flex flex-col" style="max-height: 95vh;">
            <div class="flex justify-between items-center p-4 border-b sticky top-0 bg-white z-10">
                <h2 class="text-xl font-semibold">${title}</h2>
                <button id="close-importacion-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div id="importacion-modal-body" class="p-6 overflow-y-auto flex-grow">
                <form id="importacion-form" class="space-y-8">
                    <input type="hidden" id="importacion-id" value="${isEditing ? importacion.id : ''}">
                    <input type="hidden" id="importacion-trm-hidden" value="${importacion?.trmLiquidacion || '4100'}">
                    <div><h3 class="text-lg font-bold text-gray-800 mb-2">1. Datos Generales</h3><div class="grid grid-cols-1 md:grid-cols-3 gap-4"><div><label class="block text-sm font-medium">Fecha de Pedido</label><input type="date" id="importacion-fecha-pedido" class="w-full p-2 border rounded-lg mt-1" value="${importacion?.fechaPedido || new Date().toISOString().slice(0, 10)}"></div><div><label class="block text-sm font-medium">Naviera / Proveedor</label><input type="text" id="importacion-naviera" class="w-full p-2 border rounded-lg mt-1" value="${importacion?.naviera || ''}"></div><div><label class="block text-sm font-medium">Número de BL</label><input type="text" id="importacion-bl" class="w-full p-2 border rounded-lg mt-1" value="${importacion?.numeroBl || ''}"></div></div></div>
                    <div><h3 class="text-lg font-bold text-gray-800 mb-2">2. Costos Origen (China) - Valores en USD</h3><div class="border-t pt-4"><h4 class="font-semibold mb-2">Ítems de la Importación</h4><div id="importacion-items-container" class="space-y-4"></div><button type="button" id="add-importacion-item-btn" class="mt-4 w-full bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-300 text-sm">+ Añadir Ítem</button></div><div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4"><div><label class="block text-sm font-medium">Flete Marítimo (USD)</label><input type="text" id="importacion-flete" class="cost-input-usd w-full p-2 border rounded-lg mt-1" value="${importacion?.fleteMaritimoUSD ? formatCurrency(importacion.fleteMaritimoUSD, true) : ''}"></div><div><label class="block text-sm font-medium">Seguro (USD)</label><input type="text" id="importacion-seguro" class="cost-input-usd w-full p-2 border rounded-lg mt-1" value="${importacion?.seguroUSD ? formatCurrency(importacion.seguroUSD, true) : ''}"></div><div class="p-2 bg-gray-100 rounded-lg"><label class="block text-sm font-bold text-gray-700">Total China (USD)</label><p id="total-china-usd-display" class="text-xl font-bold text-gray-900">USD 0.00</p></div>${abonosChinaHTML}</div></div>
                    <div class="${isEditing ? '' : 'hidden'}"><h3 class="text-lg font-bold text-gray-800 mb-2">3. Documentos Soporte</h3><div id="documentos-container" class="grid grid-cols-1 md:grid-cols-3 gap-4"></div></div>
                    <div class="${isEditing ? '' : 'hidden'}"><h3 class="text-lg font-bold text-gray-800 mb-2">4. Gastos de Nacionalización - Valores en COP</h3><div id="gastos-nacionalizacion-container" class="space-y-4"></div><div class="p-2 bg-gray-100 rounded-lg mt-4 text-right"><label class="block text-sm font-bold text-gray-700">Total Nacionalización (COP)</label><p id="total-nacionalizacion-cop-display" class="text-xl font-bold text-gray-900">$ 0</p></div></div>
                    <div class="p-4 bg-indigo-50 rounded-lg border-t-4 border-indigo-200"><h3 class="text-lg font-bold text-indigo-900 mb-2">Resumen Financiero</h3><div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-center"><div><label class="block text-sm font-semibold">Total China (COP)</label><p id="resumen-total-china-cop" class="text-xl font-bold">$ 0</p></div><div><label class="block text-sm font-semibold">Total Nacionalización</label><p id="resumen-total-nacionalizacion-cop" class="text-xl font-bold">$ 0</p></div><div class="p-2 bg-white rounded"><label class="block text-sm font-bold text-indigo-800">GRAN TOTAL (COP)</label><p id="resumen-gran-total-cop" class="text-2xl font-extrabold text-indigo-900">$ 0</p></div></div></div>
                    ${logisticaHTML}
                    <div class="p-4 bg-gray-100 rounded-lg border-t-4 border-gray-300"><h3 class="text-lg font-bold text-gray-900 mb-2">Costeo Final por Ítem (COP)</h3><div id="costeo-final-container" class="space-y-2"></div></div>
                </form>
            </div>
            <div class="p-4 border-t text-right sticky bottom-0 bg-white z-10"><button id="save-importacion-btn" class="bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-700">${isEditing ? 'Guardar Cambios' : 'Crear Importación'}</button></div>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-importacion-modal').addEventListener('click', hideModal);
    document.getElementById('save-importacion-btn').addEventListener('click', handleImportacionSubmit);

    const modalBody = document.getElementById('importacion-modal-body');
    setupModalEventListeners(modalBody, importacion);

    const itemsContainer = document.getElementById('importacion-items-container');
    if (isEditing) {
        renderDocumentosSection(importacion);
        renderGastosNacionalizacionSection(importacion);
        if (importacion.items && importacion.items.length > 0) {
            importacion.items.forEach(item => {
                const itemRow = createImportacionItemElement(item);
                itemsContainer.appendChild(itemRow);
                initializeItemRowSearch(itemRow);
            });
        }
    } else {
        const initialRow = createImportacionItemElement();
        itemsContainer.appendChild(initialRow);
        initializeItemRowSearch(initialRow);
    }

    getLiveTRM().then(trm => {
        const trmInput = document.getElementById('importacion-trm-hidden');
        if (trmInput) trmInput.value = trm;
        calcularTotalesImportacionCompleto();
    });
    calcularTotalesImportacionCompleto();
}

/**
 * --- VERSIÓN CON CONFIRMACIÓN DE BORRADO ---
 * Centraliza todos los event listeners del modal de importación.
 * AÑADIDO: Un diálogo de confirmación antes de eliminar una factura.
 * @param {HTMLElement} modalBody - El cuerpo del modal.
 * @param {object|null} importacion - El objeto de la importación si se está editando.
 */
function setupModalEventListeners(modalBody, importacion) {
    const importacionId = importacion ? importacion.id : null;

    modalBody.addEventListener('click', (event) => {
        const target = event.target;

        const abonoChinaBtn = target.closest('#add-abono-china-btn');
        if (abonoChinaBtn) {
            // Ahora pasamos el elemento del botón como segundo argumento
            handleAbonoChinaSubmit(importacionId, abonoChinaBtn);
        }

        if (target.closest('#set-en-puerto-btn')) {
            handleEstadoUpdate(importacionId, 'En Puerto');
        }
        else if (target.closest('#set-en-bodega-btn')) {
            handleEstadoUpdate(importacionId, 'En Bodega');
        }
        else if (target.closest('#add-abono-china-btn')) { // Listener de abonos de China
            handleAbonoChinaSubmit(importacionId);
        }

        if (target.id === 'add-importacion-item-btn') {
            const newRow = createImportacionItemElement();
            document.getElementById('importacion-items-container').appendChild(newRow);
            initializeItemRowSearch(newRow);
        }
        else if (target.closest('.remove-import-item-btn')) {
            target.closest('.import-item-row').remove();
            calcularTotalesImportacionCompleto();
        }
        else if (target.closest('.add-factura-btn')) {
            const gastoTipo = target.closest('.add-factura-btn').dataset.gastoTipo;
            document.getElementById(`facturas-container-${gastoTipo}`).appendChild(createGastoFacturaElement(gastoTipo));
        }
        else if (target.closest('.remove-factura-btn')) {
            const facturaCard = target.closest('.factura-card');
            const gastoTipo = facturaCard.dataset.gastoTipo;
            const facturaId = facturaCard.dataset.facturaId;

            if (confirm('¿Estás seguro de que quieres eliminar esta factura de forma permanente?')) {
                showModalMessage("Eliminando gasto...", true);

                const deleteGasto = httpsCallable(functions, 'deleteGastoNacionalizacion');
                deleteGasto({ importacionId: importacion.id, gastoTipo, facturaId })
                    .then(() => {
                        showTemporaryMessage("Gasto eliminado con éxito.", "success");
                        // La vista se actualizará sola gracias a onSnapshot, pero cerramos el modal de carga.
                        hideModal();
                    })
                    .catch((error) => {
                        console.error("Error al eliminar:", error);
                        // Muestra el error específico que viene del backend (ej: "No se puede eliminar...")
                        showModalMessage(`Error: ${error.message}`);
                    });
            }
        }
        else if (target.closest('.save-factura-btn')) {
            const facturaCard = target.closest('.factura-card');
            if (importacionId) {
                handleSaveFacturaGasto(importacionId, facturaCard.dataset.gastoTipo, facturaCard);
            } else {
                showModalMessage("Primero debes crear la importación para poder guardar facturas.");
            }
        }
        else if (target.closest('.add-abono-gasto-btn')) {
            const btn = target.closest('.add-abono-gasto-btn');
            handleGastoNacionalizacionAbonoSubmit(importacionId, btn.dataset.gastoTipo, btn.dataset.facturaId);
        }
        else if (target.closest('.update-pdf-btn')) {
            const btn = target.closest('.update-pdf-btn');
            handleUpdateFacturaPdf(importacionId, btn.dataset.gastoTipo, btn.dataset.facturaId);
        }
        else if (target.closest('#add-abono-china-btn')) {
            handleAbonoChinaSubmit(importacionId);
        }
    });


    modalBody.addEventListener('focusin', (e) => {
        // Añadido '#abono-china-valor-cop' al selector
        if (e.target.classList.contains('cost-input-usd') || e.target.classList.contains('cost-input-cop') || e.target.id === 'abono-china-valor-cop') {
            unformatCurrencyInput(e.target);
        }
    });

    modalBody.addEventListener('focusout', (e) => {
        if (e.target.id === 'fecha-llegada-puerto' || e.target.id === 'fecha-llegada-bodega') {
            handleDateUpdate(importacionId, e.target.id, e.target.value);
        }

        if (e.target.classList.contains('cost-input-usd') || e.target.classList.contains('cost-input-cop') || e.target.id === 'abono-china-valor-cop') {
            formatCurrencyInput(e.target);
            if (e.target.id !== 'abono-china-valor-cop') {
                calcularTotalesImportacionCompleto();
            }
        }
    });

    modalBody.addEventListener('input', (e) => {
        if (e.target.classList.contains('item-cantidad') || e.target.classList.contains('item-valor-total')) {
            calcularTotalesImportacionCompleto();
        }
    });
}

/**
 * --- VERSIÓN ROBUSTA CON BÚSQUEDA RELATIVA ---
 * Maneja el registro de un abono a Costos de Origen.
 * Ahora encuentra los campos de input relativo al botón presionado,
 * evitando errores de 'null'.
 * @param {string} importacionId - El ID de la importación.
 * @param {HTMLElement} buttonElement - El elemento del botón que fue presionado.
 */
async function handleAbonoChinaSubmit(importacionId, buttonElement) {
    // Encontrar el contenedor del formulario de abono, subiendo desde el botón
    const formContainer = buttonElement.closest('.bg-gray-50');
    if (!formContainer) {
        showModalMessage("Error: No se pudo encontrar el formulario de abono.");
        return;
    }

    // Buscar los inputs DENTRO de ese contenedor
    const valorCopInput = formContainer.querySelector('#abono-china-valor-cop');
    const valorUsdInput = formContainer.querySelector('#abono-china-valor-usd');
    const formaPagoSelect = formContainer.querySelector('#abono-china-forma-pago');
    const fechaInput = formContainer.querySelector('#abono-china-fecha');

    if (!valorCopInput || !valorUsdInput || !formaPagoSelect || !fechaInput) {
        showModalMessage("Error: Faltan campos en el formulario de abono.");
        return;
    }

    const valorCOP = unformatCurrency(valorCopInput.value);
    const valorUSD = unformatCurrency(valorUsdInput.value, true);

    if (isNaN(valorCOP) || valorCOP <= 0 || isNaN(valorUSD) || valorUSD <= 0) {
        showModalMessage("Los valores en COP y USD deben ser mayores a cero.");
        return;
    }

    const importacionActual = allImportaciones.find(i => i.id === importacionId);
    if (!importacionActual) return showModalMessage("Error: No se pudo encontrar la importación actual.");

    const totalChinaUSD = importacionActual.totalChinaUSD || 0;
    const totalAbonadoUSD = (importacionActual.abonos || []).reduce((sum, abono) => sum + (abono.valorUSD || 0), 0);
    const saldoPendienteUSD = totalChinaUSD - totalAbonadoUSD;

    if (valorUSD > saldoPendienteUSD + 0.01) {
        showModalMessage(`El abono (USD ${valorUSD.toFixed(2)}) no puede superar el saldo pendiente de ${formatCurrency(saldoPendienteUSD, true)}.`);
        return;
    }

    const nuevoAbono = {
        fecha: fechaInput.value,
        valorCOP: valorCOP,
        valorUSD: valorUSD,
        trmAbono: valorCOP / valorUSD,
        formaPago: formaPagoSelect.value,
        timestamp: new Date(),
        registradoPor: currentUser.uid
    };

    showModalMessage("Registrando abono...", true);

    try {
        const importacionRef = doc(db, "importaciones", importacionId);
        await updateDoc(importacionRef, { abonos: arrayUnion(nuevoAbono) });

        const importacionIndex = allImportaciones.findIndex(i => i.id === importacionId);
        if (importacionIndex !== -1) {
            if (!allImportaciones[importacionIndex].abonos) allImportaciones[importacionIndex].abonos = [];
            allImportaciones[importacionIndex].abonos.push(nuevoAbono);
        }

        hideModal();
        showTemporaryMessage("Abono registrado con éxito.", "success");
        showImportacionModal(allImportaciones[importacionIndex]);

    } catch (error) {
        console.error("Error al registrar abono de China:", error);
        showModalMessage("Error al guardar el abono.");
    }
}

/**
 * Maneja el registro de un nuevo abono para una importación.
 * Guarda el abono en la base de datos y actualiza la interfaz.
 * @param {string} importacionId - El ID del documento de la importación.
 * @param {object} nuevoAbono - El objeto con los datos del abono.
 */
/**
 * Maneja el registro de un nuevo abono, validando los datos y actualizando la interfaz.
 */
async function handleAbonoSubmit(importacionId, importacionActual) {
    const abonoBtn = document.getElementById('add-abono-btn');
    if (abonoBtn) abonoBtn.disabled = true;

    try {
        const valorCOP = Math.round(unformatCurrency(document.getElementById('abono-valor-cop').value));
        const valorUSD = unformatCurrency(document.getElementById('abono-valor-usd').value, true); // Permite decimales para USD

        if (isNaN(valorCOP) || valorCOP <= 0 || isNaN(valorUSD) || valorUSD <= 0) {
            showModalMessage("Los valores en COP y USD deben ser números mayores a cero.");
            return;
        }

        const saldoPendienteUSD = (importacionActual.totalUSD || 0) - (importacionActual.abonos || []).reduce((sum, abono) => sum + abono.valorUSD, 0);

        // Validar que el abono no supere el saldo pendiente (con un margen de 1 centavo)
        if (valorUSD > saldoPendienteUSD + 0.01) {
            showModalMessage(`El abono (USD ${formatCurrency(valorUSD, true)}) no puede superar el saldo pendiente (USD ${formatCurrency(saldoPendienteUSD, true)}).`);
            return;
        }

        const nuevoAbono = {
            fecha: document.getElementById('abono-fecha').value,
            valorCOP: valorCOP,
            valorUSD: valorUSD,
            trmAbono: valorCOP / valorUSD,
            formaPago: document.getElementById('abono-forma-pago').value,
            timestamp: new Date()
        };

        showModalMessage("Registrando abono...", true);
        const importacionRef = doc(db, "importaciones", importacionId);
        await updateDoc(importacionRef, { abonos: arrayUnion(nuevoAbono) });

        showTemporaryMessage("Abono registrado con éxito.", "success");

        // Actualizar la vista al instante sin recargar la página
        const importacionIndex = allImportaciones.findIndex(i => i.id === importacionId);
        if (importacionIndex !== -1) {
            if (!allImportaciones[importacionIndex].abonos) allImportaciones[importacionIndex].abonos = [];
            allImportaciones[importacionIndex].abonos.push(nuevoAbono);
            showImportacionModal(allImportaciones[importacionIndex]); // Refresca el modal
        }

    } catch (error) {
        console.error("Error al registrar abono:", error);
        showModalMessage(`Error al registrar abono: ${error.message}`);
    } finally {
        if (abonoBtn) abonoBtn.disabled = false;
    }
}

/**
 * Actualiza el estado de una importación a "En Bodega" y la fecha de llegada.
 * @param {string} importacionId - El ID de la importación a actualizar.
 */
async function handleMarcarEnBodega(importacionId) {
    if (!confirm("¿Estás seguro de que quieres marcar esta importación como recibida en bodega? Esta acción no se puede deshacer.")) {
        return;
    }
    showModalMessage("Actualizando estado...", true);
    try {
        const importacionRef = doc(db, "importaciones", importacionId);
        const fechaActual = new Date().toISOString().split('T')[0];

        await updateDoc(importacionRef, {
            estadoLogistico: 'En Bodega',
            fechaLlegadaBodega: fechaActual
        });

        // Actualizar datos locales y refrescar modal
        const importacionIndex = allImportaciones.findIndex(i => i.id === importacionId);
        if (importacionIndex !== -1) {
            allImportaciones[importacionIndex].estadoLogistico = 'En Bodega';
            allImportaciones[importacionIndex].fechaLlegadaBodega = fechaActual;
            showImportacionModal(allImportaciones[importacionIndex]);
        }
        showTemporaryMessage("¡Importación recibida en bodega!", "success");

    } catch (error) {
        console.error("Error al marcar en bodega:", error);
        showModalMessage("Error al actualizar el estado.");
    }
}


/**
 * --- VERSIÓN FINAL Y ROBUSTA CON LÓGICA DE TRANSACCIÓN CORREGIDA ---
 * Maneja el guardado de la importación (creación o edición).
 * Ya no maneja la subida de documentos de soporte, ya que ahora es automática.
 */
async function handleImportacionSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('importacion-form');
    if (!form) {
        showModalMessage("Error crítico: El formulario no se encontró.", "error");
        return;
    }

    try {
        // --- PASO 1: LEER TODOS LOS DATOS DEL FORMULARIO ---
        const importacionIdInput = form.querySelector('#importacion-id');
        const isEditing = !!importacionIdInput.value;
        const existingImportationId = isEditing ? importacionIdInput.value : null;

        const trm = parseFloat(document.getElementById('importacion-trm-hidden').value) || 4100;
        const fechaPedido = form.querySelector('#importacion-fecha-pedido').value;
        const naviera = form.querySelector('#importacion-naviera').value;
        const numeroBl = form.querySelector('#importacion-bl').value;
        const fleteUSD = unformatCurrency(form.querySelector('#importacion-flete')?.value || '0', true);
        const seguroUSD = unformatCurrency(form.querySelector('#importacion-seguro')?.value || '0', true);

        const itemsData = Array.from(form.querySelectorAll('.import-item-row')).map((row, index) => {
            const itemId = row.querySelector('.item-id-hidden').value;
            if (!itemId) throw new Error(`El ítem en la fila ${index + 1} no es válido.`);
            const cantidad = parseInt(row.querySelector('.item-cantidad').value) || 1;
            const valorTotal = unformatCurrency(row.querySelector('.item-valor-total').value, true) || 0;
            return { itemId, referencia: row.querySelector('.item-referencia-hidden').value, descripcion: row.querySelector('.item-descripcion-hidden').value, cantidad, valorTotalItemUSD: valorTotal, valorUnitarioUSD: valorTotal / cantidad };
        });

        if (itemsData.length === 0) throw new Error("Debes añadir al menos un ítem.");

        showModalMessage("Guardando datos de la importación...", true);
        const importacionRef = isEditing ? doc(db, "importaciones", existingImportationId) : doc(collection(db, 'importaciones'));

        // --- PASO 2: GUARDAR TODO DENTRO DE UNA TRANSACCIÓN ATÓMICA ---
        await runTransaction(db, async (transaction) => {
            const importacionActualDoc = isEditing ? await transaction.get(importacionRef) : null;
            const importacionActual = importacionActualDoc?.exists() ? importacionActualDoc.data() : null;

            let numeroImportacion = importacionActual?.numeroImportacion;
            if (!isEditing) {
                const counterRef = doc(db, "counters", "importacionCounter");
                const counterDoc = await transaction.get(counterRef);
                numeroImportacion = (counterDoc.exists() ? counterDoc.data().currentNumber : 0) + 1;
                transaction.set(counterRef, { currentNumber: numeroImportacion }, { merge: true });
            }

            const totalItemsUSD = itemsData.reduce((sum, item) => sum + item.valorTotalItemUSD, 0);
            const totalChinaUSD = totalItemsUSD + fleteUSD + seguroUSD;

            const dataFinal = {
                numeroImportacion, fechaPedido, naviera, numeroBl, fleteMaritimoUSD: fleteUSD, seguroUSD: seguroUSD,
                items: itemsData, totalChinaUSD, trmLiquidacion: trm,
                // Mantenemos los datos existentes que no se modifican en este formulario
                documentos: importacionActual?.documentos || {},
                estadoLogistico: importacionActual?.estadoLogistico || 'Creada',
                abonos: importacionActual?.abonos || [],
                gastosNacionalizacion: importacionActual?.gastosNacionalizacion || {},
                totalNacionalizacionCOP: importacionActual?.totalNacionalizacionCOP || 0,
                lastUpdated: new Date()
            };

            dataFinal.granTotalCOP = (dataFinal.totalChinaUSD * dataFinal.trmLiquidacion) + (dataFinal.totalNacionalizacionCOP || 0);

            transaction.set(importacionRef, dataFinal, { merge: true });
        });

        hideModal();
        showTemporaryMessage("¡Importación guardada con éxito!", "success");

    } catch (error) {
        console.error("Error al guardar importación:", error);
        showModalMessage(`Error al guardar: ${error.message}`);
    }
}

/**
 * --- VERSIÓN CORREGIDA Y SIMPLIFICADA ---
 * Simplemente lee los nuevos archivos seleccionados en el formulario.
 * @returns {object} Un objeto que contiene los nuevos archivos a subir.
 */
function leerDocumentosDelForm() {
    const newFiles = {};
    const form = document.getElementById('importacion-form');
    if (!form) return newFiles;

    form.querySelectorAll('.documento-file-input').forEach(input => {
        const docTipo = input.dataset.docTipo;
        if (input.files && input.files.length > 0) {
            newFiles[docTipo] = input.files[0];
        }
    });

    return newFiles;
}

/**
 * Despiece híbrido:
 *  - Baseline mínimo de láminas (MaxRects rápido, sin guillotina).
 *  - Intenta guillotina vertical (columnas) y horizontal (filas) con mezcla de anchos/altos.
 *  - Elige el que use MENOS láminas; si guillotina no iguala al baseline, se queda con baseline.
 *  - Caso piezas idénticas: patrón exacto (con rotación y sin kerf; si tienes kerf>0, aplica heurística).
 *
 * @param {number} sheetW
 * @param {number} sheetH
 * @param {Array<{ancho:number,alto:number,cantidad:number}>} cortes
 * @param {Object} [opts]
 *   @param {number}  [opts.kerf=0]
 *   @param {number}  [opts.margin=0]
 *   @param {boolean} [opts.allowSheetRotation=false]   // no giramos la lámina
 *   @param {boolean} [opts.allowPieceRotation=true]    // sí rotamos piezas (recomendado)
 *   @param {"BAF"|"BSSF"|"BL"} [opts.heuristic="BAF"]
 *   @param {"prefer-vertical"|"prefer-horizontal"} [opts.preference="prefer-vertical"]
 * @returns {{
 *   numeroLaminas:number,
 *   plano:Array<{numero:number,cortes:Array<{id,ancho,alto,x,y,descripcion}>}>,
 *   cortesSecuencia?:Array<any>   // líneas de corte completas (si usó guillotina)
 * }}
 */
function optimizarCortes(sheetW, sheetH, cortes, opts = {}) {
    // --- Opciones ---
    const KERF = Math.max(0, opts.kerf ?? 0);
    const MARGIN = Math.max(0, opts.margin ?? 0);
    const ALLOW_SHEET_ROTATION = opts.allowSheetRotation ?? false;
    const ALLOW_PIECE_ROTATION = opts.allowPieceRotation ?? true;
    const HEUR = opts.heuristic ?? "BAF";
    const PREFERENCE = opts.preference; // Sin valor por defecto para ser neutro

    // --- Clases y Funciones Internas ---

    class MRBin {
        constructor(W, H, kerf = 0) { this.kerf = kerf; this.free = [{ x: 0, y: 0, w: W, h: H }]; }
        _score(node, fr, heur) {
            switch (heur) {
                case 'BSSF': {
                    const ssf = Math.min(Math.abs(fr.w - node.w), Math.abs(fr.h - node.h));
                    const lsf = Math.max(Math.abs(fr.w - node.w), Math.abs(fr.h - node.h));
                    return { primary: ssf, secondary: lsf };
                }
                case 'BL': return { primary: node.y, secondary: node.x };
                default: {
                    const fit = fr.w * fr.h - node.w * node.h;
                    const ssf = Math.min(Math.abs(fr.w - node.w), Math.abs(fr.h - node.h));
                    return { primary: fit, secondary: ssf };
                }
            }
        }
        find(w, h, rotOK, heur) {
            let best = null;
            const tryR = (rw, rh, rot) => {
                for (const fr of this.free) {
                    if (rw <= fr.w && rh <= fr.h) {
                        const node = { x: fr.x, y: fr.y, w: rw, h: rh };
                        const sc = this._score(node, fr, heur);
                        if (!best || sc.primary < best.score.primary ||
                            (sc.primary === best.score.primary && sc.secondary < best.score.secondary)) {
                            best = { node, score: sc, rot };
                        }
                    }
                }
            };
            tryR(w, h, false);
            if (rotOK && w !== h) tryR(h, w, true);
            return best;
        }
        place(n) {
            const out = [];
            for (const fr of this.free) {
                if (!(n.x >= fr.x + fr.w || n.x + n.w <= fr.x || n.y >= fr.y + fr.h || n.y + n.h <= fr.y)) {
                    if (n.y > fr.y) { const h = n.y - fr.y - this.kerf; if (h > 0) out.push({ x: fr.x, y: fr.y, w: fr.w, h }); }
                    if (n.y + n.h < fr.y + fr.h) {
                        const y = n.y + n.h + this.kerf, h = fr.y + fr.h - (n.y + n.h) - this.kerf; if (h > 0) out.push({ x: fr.x, y, w: fr.w, h });
                    }
                    if (n.x > fr.x) { const w = n.x - fr.x - this.kerf; if (w > 0) out.push({ x: fr.x, y: fr.y, w, h: fr.h }); }
                    if (n.x + n.w < fr.x + fr.w) {
                        const x = n.x + n.w + this.kerf, w = fr.x + fr.w - (n.x + n.w) - this.kerf; if (w > 0) out.push({ x, y: fr.y, w, h: fr.h });
                    }
                } else out.push(fr);
            }
            const pr = [];
            for (let i = 0; i < out.length; i++) {
                let ok = true;
                for (let j = 0; j < out.length; j++) {
                    if (i !== j && out[i].x >= out[j].x && out[i].y >= out[j].y &&
                        out[i].x + out[i].w <= out[j].x + out[j].w && out[i].y + out[i].h <= out[j].y + out[j].h) { ok = false; break; }
                }
                if (ok && out[i].w > 0 && out[i].h > 0) pr.push(out[i]);
            }
            this.free = pr;
        }
    }

    function maxRectsMulti(pieces, SW, SH, { margin = 0, kerf = 0, heuristic = "BAF", allowRotate = true }) {
        const W = SW - 2 * margin, H = SH - 2 * margin, sheets = [];
        const list = pieces.slice().map(p => ({ ...p })).sort((a, b) => b.area - a.area);
        let i = 0;
        while (i < list.length) {
            const bin = new MRBin(W, H, kerf);
            const placed = [];
            let moved = true;
            while (moved && i < list.length) {
                moved = false;
                let best = null, idx = -1;
                for (let k = i; k < list.length; k++) {
                    const p = list[k];
                    const pos = bin.find(p.w0, p.h0, allowRotate, heuristic);
                    if (pos && (!best ||
                        pos.score.primary < best.score.primary ||
                        (pos.score.primary === best.score.primary && pos.score.secondary < best.score.secondary))) {
                        best = pos; idx = k;
                    }
                }
                if (best) {
                    bin.place(best.node);
                    const p = list[idx];
                    placed.push({ id: p.id, x: best.node.x + margin, y: best.node.y + margin, w: best.node.w, h: best.node.h, w0: p.w0, h0: p.h0, rot: best.rot });
                    [list[idx], list[i]] = [list[i], list[idx]]; i++; moved = true;
                }
            }
            if (placed.length > 0) sheets.push({ placed });
        }
        if (sheets.length === 0 && list.length > 0) return null;
        const waste = sheets.reduce((t, sh) => t + (W * H - sh.placed.reduce((s, r) => s + r.w * r.h, 0)), 0);
        return { count: sheets.length, sheets, waste };
    }

    function allIdentical(arr) { const a = arr[0]; return arr.every(p => p.w0 === a.w0 && p.h0 === a.h0); }

    function exactPatternCols(W, H, w, h, allowRotate) {
        const rowsU = Math.floor(H / h), rowsR = allowRotate ? Math.floor(H / w) : 0;
        let best = { cap: 0, c: 0, d: 0, modo: 'cols' };
        for (let d = 0; d <= (allowRotate ? Math.floor(W / h) : 0); d++) {
            const rem = W - d * h; if (rem < 0) break;
            const c = Math.floor(rem / w);
            const cap = c * rowsU + d * rowsR;
            if (cap > best.cap) best = { cap, c, d, modo: 'cols' };
        }
        best.cutsSeq = [{ lamina: 1, verticales: [] }];
        return best;
    }

    function exactPatternRows(W, H, w, h, allowRotate) {
        const colsU = Math.floor(W / w), colsR = allowRotate ? Math.floor(W / h) : 0;
        let best = { cap: 0, a: 0, b: 0, modo: 'rows' };
        for (let b = 0; b <= (allowRotate ? Math.floor(H / w) : 0); b++) {
            const rem = H - b * w; if (rem < 0) break;
            const a = Math.floor(rem / h);
            const cap = a * colsU + b * colsR;
            if (cap > best.cap) best = { cap, a, b, modo: 'rows' };
        }
        best.cutsSeq = [{ lamina: 1, horizontales: [] }];
        return best;
    }

    function chooseBestPattern(A, B) {
        if (A.cap > B.cap) return A;
        if (B.cap > A.cap) return B;
        return A; // En caso de empate, por defecto uno.
    }

    function renderExactPattern(pat, take, w, h, m, SW, SH) {
        const placed = []; if (take <= 0) return placed;
        if (pat.modo === 'cols') {
            let x = m;
            const rowsR = Math.floor((SH - 2 * m) / w);
            for (let j = 0; j < pat.d && placed.length < take; j++) {
                let y = m; for (let i = 0; i < rowsR && placed.length < take; i++) { placed.push({ x, y, w: h, h: w, rot: true }); y += w; }
                x += h;
            }
            const rowsU = Math.floor((SH - 2 * m) / h);
            for (let j = 0; j < pat.c && placed.length < take; j++) {
                let y = m; for (let i = 0; i < rowsU && placed.length < take; i++) { placed.push({ x, y, w: w, h: h, rot: false }); y += h; }
                x += w;
            }
            return placed;
        } else {
            let y = m;
            const colsU = Math.floor((SW - 2 * m) / w);
            for (let i = 0; i < pat.a && placed.length < take; i++) {
                let x = m; for (let j = 0; j < colsU && placed.length < take; j++) { placed.push({ x, y, w: w, h: h, rot: false }); x += w; }
                y += h;
            }
            const colsR = Math.floor((SW - 2 * m) / h);
            for (let i = 0; i < pat.b && placed.length < take; i++) {
                let x = m; for (let j = 0; j < colsR && placed.length < take; j++) { placed.push({ x, y, w: h, h: w, rot: true }); x += h; }
                y += w;
            }
            return placed;
        }
    }

    function guillotineColumns(pieces, SW, SH, { margin = 0, kerf = 0, allowRotate = true }) {
        const W = SW - 2 * margin, H = SH - 2 * margin;
        const items = pieces.map(p => ({ ...p }));
        const cols = [];
        const sorted = items.sort((a, b) => Math.max(b.w0, b.h0) - Math.max(a.w0, a.h0) || (b.w0 * b.h0 - a.w0 * a.h0));
        const orient = (p) => {
            const o = [{ w: p.w0, h: p.h0, rot: false }];
            if (allowRotate && p.w0 !== p.h0) o.push({ w: p.h0, h: p.w0, rot: true });
            return o;
        };

        for (const p of sorted) {
            let best = null, bestCol = -1, bestOpt = null;
            const opts = orient(p);
            for (let ci = 0; ci < cols.length; ci++) {
                const col = cols[ci];
                for (const o of opts) {
                    const need = (col.pieces.length ? kerf : 0) + o.h;
                    if (col.usedH + need <= H) {
                        const dW = Math.max(0, o.w - col.width);
                        const slack = H - (col.usedH + need);
                        const score = dW * 1e6 + slack;
                        if (!best || score < best.score) { best = { score }, bestCol = ci, bestOpt = o; }
                    }
                }
            }
            if (best) {
                const col = cols[bestCol];
                col.width = Math.max(col.width, bestOpt.w);
                if (col.pieces.length) col.usedH += kerf;
                col.pieces.push({ id: p.id, w: bestOpt.w, h: bestOpt.h, rot: bestOpt.rot, w0: p.w0, h0: p.h0 });
                col.usedH += bestOpt.h;
                continue;
            }
            const feas = opts.filter(o => o.h <= H).sort((a, b) => (a.w - b.w) || (b.h - a.h));
            if (!feas.length) return null;
            const o = feas[0];
            cols.push({ width: o.w, usedH: o.h, pieces: [{ id: p.id, w: o.w, h: o.h, rot: o.rot, w0: p.w0, h0: p.h0 }] });
        }

        const sheets = [];
        const colsSorted = cols.sort((a, b) => b.width - a.width);
        for (const c of colsSorted) {
            let ok = false;
            for (const sh of sheets) {
                const need = (sh.cols.length ? kerf : 0) + c.width;
                if (sh.usedW + need <= (W)) { sh.cols.push(c); sh.usedW += need; ok = true; break; }
            }
            if (!ok) sheets.push({ usedW: c.width, cols: [c] });
        }

        const outSheets = [], cutsSeq = [];
        for (let si = 0; si < sheets.length; si++) {
            const sh = sheets[si];
            let x = MARGIN;
            const placed = [];
            const vCuts = []; const hPerCol = [];
            for (let ci = 0; ci < sh.cols.length; ci++) {
                const col = sh.cols[ci];
                if (ci > 0) x += KERF;
                let y = MARGIN;
                const yCuts = [];
                for (let k = 0; k < col.pieces.length; k++) {
                    const it = col.pieces[k];
                    if (k > 0) y += KERF;
                    placed.push({ id: it.id, x, y, w: it.w, h: it.h, w0: it.w0, h0: it.h0, rot: it.rot });
                    y += it.h;
                    if (k < col.pieces.length - 1) yCuts.push(y + KERF / 2);
                }
                hPerCol.push({ columna: ci + 1, x0: x, x1: x + col.width, yCuts });
                x += col.width;
                if (ci < sh.cols.length - 1) vCuts.push(x);
            }
            outSheets.push({ placed });
            cutsSeq.push({ lamina: si + 1, verticales: vCuts, horizontalesPorColumna: hPerCol });
        }
        const areaNet = (W * H);
        const waste = outSheets.reduce((t, sh) => t + (areaNet - sh.placed.reduce((s, r) => s + r.w * r.h, 0)), 0);
        return { count: outSheets.length, sheets: outSheets, waste, cutsSeq };
    }

    function guillotineRows(pieces, SW, SH, { margin = 0, kerf = 0, allowRotate = true }) {
        const W = SW - 2 * margin, H = SH - 2 * margin;
        const items = pieces.map(p => ({ ...p }));
        const rows = [];
        const sorted = items.sort((a, b) => Math.max(b.w0, b.h0) - Math.max(a.w0, a.h0) || (b.w0 * b.h0 - a.w0 * a.h0));
        const orient = (p) => {
            const o = [{ w: p.w0, h: p.h0, rot: false }];
            if (allowRotate && p.w0 !== p.h0) o.push({ w: p.h0, h: p.w0, rot: true });
            return o;
        };

        for (const p of sorted) {
            let best = null, bestRow = -1, bestOpt = null;
            const opts = orient(p);
            for (let ri = 0; ri < rows.length; ri++) {
                const row = rows[ri];
                for (const o of opts) {
                    const need = (row.pieces.length ? kerf : 0) + o.w;
                    if (row.usedW + need <= W) {
                        const dH = Math.max(0, o.h - row.height);
                        const score = dH * 1e6 + (W - (row.usedW + need));
                        if (!best || score < best.score) { best = { score }, bestRow = ri, bestOpt = o; }
                    }
                }
            }
            if (best) {
                const row = rows[bestRow];
                row.height = Math.max(row.height, bestOpt.h);
                if (row.pieces.length) row.usedW += kerf;
                row.pieces.push({ id: p.id, w: bestOpt.w, h: bestOpt.h, rot: bestOpt.rot, w0: p.w0, h0: p.h0 });
                row.usedW += bestOpt.w;
                continue;
            }
            const feas = opts.filter(o => o.w <= W).sort((a, b) => (a.h - b.h) || (b.w - a.w));
            if (!feas.length) return null;
            const o = feas[0];
            rows.push({ height: o.h, usedW: o.w, pieces: [{ id: p.id, w: o.w, h: o.h, rot: o.rot, w0: p.w0, h0: p.h0 }] });
        }

        const sheets = [];
        const rowsSorted = rows.sort((a, b) => b.height - a.height);
        for (const r of rowsSorted) {
            let ok = false;
            for (const sh of sheets) {
                const usedH = sh.rows.reduce((s, rr) => s + rr.height, 0) + (sh.rows.length > 1 ? kerf * (sh.rows.length - 1) : 0);
                const need = (sh.rows.length ? kerf : 0) + r.height;
                if (usedH + need <= H) { sh.rows.push(r); ok = true; break; }
            }
            if (!ok) sheets.push({ rows: [r] });
        }

        const outSheets = [], cutsSeq = [];
        for (let si = 0; si < sheets.length; si++) {
            const sh = sheets[si];
            let y = MARGIN;
            const placed = []; const hCuts = []; const vPerRow = [];
            for (let ri = 0; ri < sh.rows.length; ri++) {
                const row = sh.rows[ri];
                if (ri > 0) y += KERF;
                let x = MARGIN;
                const xCuts = [];
                for (let k = 0; k < row.pieces.length; k++) {
                    const it = row.pieces[k];
                    if (k > 0) x += KERF;
                    placed.push({ id: it.id, x, y, w: it.w, h: it.h, w0: it.w0, h0: it.h0, rot: it.rot });
                    x += it.w;
                    if (k < row.pieces.length - 1) xCuts.push(x + KERF / 2);
                }
                vPerRow.push({ fila: ri + 1, y0: y, y1: y + row.height, xCuts });
                y += row.height;
                if (ri < sh.rows.length - 1) hCuts.push(y);
            }
            outSheets.push({ placed });
            cutsSeq.push({ lamina: si + 1, horizontales: hCuts, verticalesPorFila: vPerRow });
        }
        const areaNet = (W * H);
        const waste = outSheets.reduce((t, sh) => t + (areaNet - sh.placed.reduce((s, r) => s + r.w * r.h, 0)), 0);
        return { count: outSheets.length, sheets: outSheets, waste, cutsSeq };
    }

    // --- Aplanar y validar ---
    const piezas = [];
    let gid = 1;
    for (const c of cortes) for (let i = 0; i < c.cantidad; i++) {
        piezas.push({ id: gid++, w0: c.ancho, h0: c.alto, area: c.ancho * c.alto });
    }
    if (!piezas.length) return { numeroLaminas: 0, plano: [], cortesSecuencia: [] };

    const innerW = sheetW - 2 * MARGIN;
    const innerH = sheetH - 2 * MARGIN;
    const fitsAny = (p, W, H) =>
        (p.w0 <= W && p.h0 <= H) || (ALLOW_PIECE_ROTATION && p.h0 <= W && p.w0 <= H);
    const innerWrot = sheetH - 2 * MARGIN, innerHrot = sheetW - 2 * MARGIN;
    for (const p of piezas) {
        const okN = fitsAny(p, innerW, innerH);
        const okR = ALLOW_SHEET_ROTATION ? fitsAny(p, innerWrot, innerHrot) : false;
        if (!okN && !okR) throw new Error(`La pieza ${p.w0}x${p.h0} no cabe en la lámina ${sheetW}x${sheetH} (margen ${MARGIN}).`);
    }

    // --- Caso idénticas + kerf=0 ---
    if (KERF === 0 && allIdentical(piezas)) {
        const w = piezas[0].w0, h = piezas[0].h0, N = piezas.length;
        const patV = exactPatternCols(innerW, innerH, w, h, ALLOW_PIECE_ROTATION);
        const patH = exactPatternRows(innerW, innerH, w, h, ALLOW_PIECE_ROTATION);
        const bestPat = chooseBestPattern(patV, patH);
        const cap = bestPat.cap;
        if (cap === 0) return { numeroLaminas: Infinity, plano: [], error: "No se pudo colocar ninguna pieza." };
        const hojas = Math.ceil(N / cap);
        const plano = []; let used = 0;
        for (let s = 0; s < hojas; s++) {
            const take = Math.min(cap, N - used);
            const placed = renderExactPattern(bestPat, take, w, h, MARGIN, sheetW, sheetH);
            plano.push({ numero: s + 1, cortes: placed.map((r, idx) => ({ id: piezas[used + idx]?.id ?? (used + idx + 1), ancho: r.w, alto: r.h, x: r.x, y: r.y, descripcion: `${w}x${h}${r.rot ? ' (R)' : ''}` })) });
            used += take;
        }
        return { numeroLaminas: plano.length, plano, cortesSecuencia: bestPat.cutsSeq };
    }

    // --- Algoritmos y Selección ---
    const base = maxRectsMulti(piezas, sheetW, sheetH, { margin: MARGIN, kerf: KERF, heuristic: HEUR, allowRotate: ALLOW_PIECE_ROTATION });
    const gVert = guillotineColumns(piezas, sheetW, sheetH, { margin: MARGIN, kerf: KERF, allowRotate: ALLOW_PIECE_ROTATION });
    const gHorz = guillotineRows(piezas, sheetW, sheetH, { margin: MARGIN, kerf: KERF, allowRotate: ALLOW_PIECE_ROTATION });
    const baseSheets = base ? base.count : Infinity;

    const candidates = [];
    if (gVert) candidates.push({ tag: 'gV', ...gVert });
    if (gHorz) candidates.push({ tag: 'gH', ...gHorz });
    if (base) candidates.push({ tag: 'base', ...base });

    candidates.sort((a, b) => (a.count - b.count) || (a.waste - b.waste));

    let chosen = null;
    const equalOrBetter = candidates.filter(c => c.tag !== 'base' && c.count <= baseSheets);

    if (equalOrBetter.length > 0) {
        if (PREFERENCE === 'prefer-vertical') {
            const prefer = equalOrBetter.find(c => c.tag === 'gV' && c.count === equalOrBetter[0].count);
            chosen = prefer ?? equalOrBetter[0];
        } else {
            chosen = equalOrBetter[0];
        }
    } else {
        chosen = candidates.find(c => c.tag === 'base');
    }

    if (!chosen) {
        return { numeroLaminas: Infinity, plano: [], error: "No se encontró una solución de corte." };
    }

    // --- Formateo de salida ---
    const plano = chosen.sheets.map((sh, i) => ({
        numero: i + 1,
        cortes: sh.placed.map(r => ({
            id: r.id, ancho: r.w, alto: r.h, x: r.x, y: r.y,
            descripcion: `${r.w0}x${r.h0}${r.rot ? ' (R)' : ''}`
        }))
    }));
    const out = { numeroLaminas: chosen.count, plano };
    if (chosen.cutsSeq) out.cortesSecuencia = chosen.cutsSeq;
    return out;
}

/**
 * --- VERSIÓN CORREGIDA ---
 * Devuelve el costo NOMINAL del servicio de corte para UNA LÁMINA.
 * La interpretación de si este valor incluye IVA o es la base
 * se hace en la función que la llama (calcularTotales / handleRemisionSubmit).
 * @param {number} numeroDeCortesEnLamina - El número de cortes en una lámina específica.
 * @returns {number} - El costo nominal del servicio (0, 15000 o 20000).
 */
function calcularCargoPorLamina(numeroDeCortesEnLamina) {
    if (numeroDeCortesEnLamina >= 4 && numeroDeCortesEnLamina <= 10) {
        return 15000;
    }
    if (numeroDeCortesEnLamina > 10) {
        return 20000;
    }
    return 0;
}

// --- FUNCIONES DE MANEJO DE ACCIONES ---
async function handleProveedorSubmit(e) { e.preventDefault(); const nuevoProveedor = { nombre: document.getElementById('nuevo-proveedor-nombre').value, contacto: document.getElementById('nuevo-proveedor-contacto').value, telefono: document.getElementById('nuevo-proveedor-telefono').value, email: document.getElementById('nuevo-proveedor-email').value, creadoEn: new Date(), }; showModalMessage("Registrando proveedor...", true); try { await addDoc(collection(db, "proveedores"), nuevoProveedor); e.target.reset(); hideModal(); showModalMessage("¡Proveedor registrado!", false, 2000); } catch (error) { console.error("Error al registrar proveedor:", error); hideModal(); showModalMessage("Error al registrar el proveedor."); } }
async function handleGastoSubmit(e) {
    e.preventDefault();
    const valorTotal = unformatCurrency(document.getElementById('gasto-valor-total').value);
    const ivaIncluido = document.getElementById('gasto-iva').checked;
    const valorBase = ivaIncluido ? valorTotal / 1.19 : valorTotal;
    const proveedorId = document.getElementById('proveedor-id-hidden').value;
    const proveedorNombre = document.getElementById('proveedor-search-input').value;

    if (!proveedorId) {
        showModalMessage("Por favor, selecciona un proveedor de la lista.");
        return;
    }

    const nuevoGasto = {
        fecha: document.getElementById('gasto-fecha').value,
        proveedorId: proveedorId,
        proveedorNombre: proveedorNombre,
        numeroFactura: document.getElementById('gasto-factura').value,
        valorBase: valorBase,
        ivaIncluido: ivaIncluido,
        valorTotal: valorTotal,
        fuentePago: document.getElementById('gasto-fuente').value,
        registradoPor: currentUser.uid,
        timestamp: new Date(),
    };
    showModalMessage("Registrando gasto...", true);
    try {
        await addDoc(collection(db, "gastos"), nuevoGasto);
        e.target.reset();
        hideModal();
        showModalMessage("¡Gasto registrado con éxito!", false, 2000);
    } catch (error) {
        console.error("Error al registrar gasto:", error);
        hideModal();
        showModalMessage("Error al registrar el gasto.");
    }
}
async function handleStatusUpdate(remisionId, currentStatus) { const currentIndex = ESTADOS_REMISION.indexOf(currentStatus); if (currentIndex < ESTADOS_REMISION.length - 1) { const nextStatus = ESTADOS_REMISION[currentIndex + 1]; const updateData = { estado: nextStatus }; if (nextStatus === 'Entregado') { updateData.fechaEntrega = new Date().toISOString().split('T')[0]; } showModalMessage("Actualizando estado...", true); try { await updateDoc(doc(db, "remisiones", remisionId), updateData); hideModal(); } catch (error) { console.error("Error al actualizar estado:", error); showModalMessage("Error al actualizar estado."); } } }
async function handleAnularRemision(remisionId) { showModalMessage("Anulando remisión...", true); try { const remisionRef = doc(db, "remisiones", remisionId); await updateDoc(remisionRef, { estado: "Anulada" }); hideModal(); showModalMessage("¡Remisión anulada con éxito!", false, 2000); } catch (error) { console.error("Error al anular la remisión:", error); hideModal(); showModalMessage("Error al anular la remisión."); } }

async function handleItemSubmit(e) {
    e.preventDefault();

    const tipo = document.getElementById('nuevo-item-tipo').value;
    const color = document.getElementById('nuevo-item-color').value;
    const ancho = parseFloat(document.getElementById('nuevo-item-ancho').value);
    const alto = parseFloat(document.getElementById('nuevo-item-alto').value);
    const laminasPorCaja = parseInt(document.getElementById('nuevo-item-laminas-por-caja').value, 10); // <-- LEER NUEVO CAMPO
    const stock = parseInt(document.getElementById('nuevo-item-stock').value, 10);

    if (!tipo || !color || isNaN(ancho) || isNaN(alto) || isNaN(stock) || isNaN(laminasPorCaja)) { // <-- AÑADIR VALIDACIÓN
        showModalMessage("Por favor, completa todos los campos con valores válidos.");
        return;
    }

    const referencia = `${tipo.slice(0, 3).toUpperCase()}${color.slice(0, 3).toUpperCase()}-${ancho}x${alto}`;

    const nuevoItem = {
        referencia: referencia,
        tipo: tipo,
        color: color,
        ancho: ancho,
        alto: alto,
        descripcion: `${tipo} ${color} ${ancho}x${alto}mm`,
        laminasPorCaja: laminasPorCaja, // <-- GUARDAR NUEVO CAMPO
        stock: stock,
        creadoEn: new Date()
    };

    showModalMessage("Guardando ítem...", true);
    try {
        await addDoc(collection(db, "items"), nuevoItem);
        e.target.reset();
        hideModal();
        showModalMessage("¡Ítem guardado con éxito!", false, 2000);
    } catch (error) {
        console.error("Error al guardar el ítem:", error);
        hideModal();
        showModalMessage("Error al guardar el ítem.");
    }
}

/**
 * --- VERSIÓN FINAL, COMPLETA Y ROBUSTA ---
 * Maneja el guardado de la remisión con toda la nueva lógica de negocio.
 * - Valida el stock antes de procesar.
 * - Llama al algoritmo de optimización avanzado de forma asíncrona y segura.
 * - Guarda la estrategia de corte y el teléfono del cliente.
 * - Calcula cargos por corte por lámina y desglosa el IVA correctamente.
 * - Guarda la remisión y actualiza el stock de forma atómica.
 */

async function handleRemisionSubmit(e) {
    e.preventDefault();
    const clienteId = document.getElementById('cliente-id-hidden').value;
    const cliente = allClientes.find(c => c.id === clienteId);
    if (!clienteId || !cliente) {
        showModalMessage("Debes seleccionar un cliente válido de la lista.");
        return;
    }

    showModalMessage("Validando stock y procesando remisión...", true);

    try {
        const itemsParaGuardar = [];
        const cargosAdicionales = [];
        const stockUpdates = {};
        const incluyeIVA = document.getElementById('incluir-iva').checked;
        const itemRows = document.querySelectorAll('.item-row');

        // 1. PRIMERA PASADA: Calcular el total de stock necesario por ítem
        const stockNecesario = {};
        for (const itemRow of itemRows) {
            const itemId = itemRow.querySelector('.item-id-hidden').value;
            if (!itemId) continue;

            const itemSeleccionado = allItems.find(i => i.id === itemId);
            if (!itemSeleccionado) throw new Error("Has seleccionado un ítem inválido.");

            const tipoCorte = itemRow.querySelector('.tipo-corte-radio:checked').value;
            let cantidadNecesaria = 0;

            if (tipoCorte === 'completa') {
                cantidadNecesaria = parseInt(itemRow.querySelector('.item-cantidad-completa').value) || 0;
            } else {
                const cortes = Array.from(itemRow.querySelectorAll('.cut-row')).map(row => ({
                    ancho: parseInt(row.querySelector('.cut-ancho').value) || 0,
                    alto: parseInt(row.querySelector('.cut-alto').value) || 0,
                    cantidad: parseInt(row.querySelector('.cut-cantidad').value) || 1
                })).filter(c => c.ancho > 0 && c.alto > 0);

                if (cortes.length > 0) {
                    const resultadoDespiece = await optimizarCortes(itemSeleccionado.ancho, itemSeleccionado.alto, cortes);
                    cantidadNecesaria = resultadoDespiece.numeroLaminas;
                }
            }
            stockNecesario[itemId] = (stockNecesario[itemId] || 0) + cantidadNecesaria;
        }

        // 2. VALIDACIÓN DE STOCK
        for (const itemId in stockNecesario) {
            const itemEnInventario = allItems.find(i => i.id === itemId);
            const stockDisponible = itemEnInventario ? itemEnInventario.stock : 0;
            if (stockNecesario[itemId] > stockDisponible) {
                throw new Error(`Stock insuficiente para "${itemEnInventario.descripcion}". Necesitas ${stockNecesario[itemId]}, pero solo hay ${stockDisponible} disponibles.`);
            }
        }

        // 3. SI HAY STOCK, PROCEDER A CONSTRUIR LA REMISIÓN
        for (const itemRow of itemRows) {
            const itemId = itemRow.querySelector('.item-id-hidden').value;
            const itemSeleccionado = allItems.find(i => i.id === itemId);
            const valorPorLaminaConIVA = unformatCurrency(itemRow.querySelector('.item-valor-lamina').value);

            if (isNaN(valorPorLaminaConIVA) || valorPorLaminaConIVA <= 0) {
                if (itemId) throw new Error(`Debes ingresar un valor válido para el ítem: ${itemSeleccionado.descripcion}.`);
                else continue;
            }

            const valorPorLaminaBase = incluyeIVA ? valorPorLaminaConIVA / 1.19 : valorPorLaminaConIVA;
            const tipoCorte = itemRow.querySelector('.tipo-corte-radio:checked').value;

            if (tipoCorte === 'completa') {
                const cantidad = parseInt(itemRow.querySelector('.item-cantidad-completa').value) || 0;
                if (cantidad > 0) {
                    itemsParaGuardar.push({
                        itemId,
                        referencia: itemSeleccionado.referencia,
                        descripcion: itemSeleccionado.descripcion,
                        tipo: 'Completa',
                        cantidad,
                        valorUnitario: valorPorLaminaBase,
                        valorTotal: valorPorLaminaBase * cantidad
                    });
                    stockUpdates[itemId] = (stockUpdates[itemId] || 0) + cantidad;
                }
            } else {
                const cortes = Array.from(itemRow.querySelectorAll('.cut-row')).map(row => ({
                    ancho: parseInt(row.querySelector('.cut-ancho').value) || 0,
                    alto: parseInt(row.querySelector('.cut-alto').value) || 0,
                    cantidad: parseInt(row.querySelector('.cut-cantidad').value) || 1
                })).filter(c => c.ancho > 0 && c.alto > 0);

                if (cortes.length > 0) {
                    const estrategiaSeleccionada = itemRow.querySelector('.estrategia-radio:checked').value;
                    const resultadoDespiece = await optimizarCortes(itemSeleccionado.ancho, itemSeleccionado.alto, cortes);
                    const laminasNecesarias = resultadoDespiece.numeroLaminas;

                    itemsParaGuardar.push({
                        itemId,
                        referencia: itemSeleccionado.referencia,
                        descripcion: itemSeleccionado.descripcion,
                        tipo: 'Cortada',
                        cantidad: laminasNecesarias,
                        valorUnitario: valorPorLaminaBase,
                        valorTotal: valorPorLaminaBase * laminasNecesarias,
                        cortes,
                        planoDespiece: resultadoDespiece.plano,
                        estrategia: estrategiaSeleccionada
                    });
                    stockUpdates[itemId] = (stockUpdates[itemId] || 0) + laminasNecesarias;

                    resultadoDespiece.plano.forEach(lamina => {
                        const cortesEnEstaLamina = lamina.cortes.length;
                        const cargo = calcularCostoDeCortes(cortesEnEstaLamina);
                        if (cargo.costo > 0) {
                            const valorCargoBase = (incluyeIVA && cargo.ivaIncluido) ? cargo.costo / 1.19 : cargo.costo;
                            cargosAdicionales.push({ descripcion: `${cargo.descripcion} (Lámina ${lamina.numero})`, valorUnitario: valorCargoBase, valorTotal: valorCargoBase });
                        }
                    });
                }
            }
        }

        if (itemsParaGuardar.length === 0) throw new Error("No has añadido ítems válidos a la remisión.");

        // 4. Calcular totales y guardar en Firestore
        const subtotalItems = itemsParaGuardar.reduce((sum, item) => sum + item.valorTotal, 0);
        const subtotalCargos = cargosAdicionales.reduce((sum, cargo) => sum + cargo.valorTotal, 0);
        const subtotalGeneral = subtotalItems + subtotalCargos;
        const valorIVA = incluyeIVA ? subtotalGeneral * 0.19 : 0;
        const totalFinal = subtotalGeneral + valorIVA;

        const counterRef = doc(db, "counters", "remisionCounter");
        const newRemisionNumber = await runTransaction(db, async (t) => {
            const counterDoc = await t.get(counterRef);
            const newNumber = (counterDoc.exists() ? counterDoc.data().currentNumber : 0) + 1;
            t.set(counterRef, { currentNumber: newNumber }, { merge: true });
            return newNumber;
        });

        // --- INICIO DE LA CORRECCIÓN CLAVE ---
        // Leemos el valor del nuevo campo de observaciones
        const observaciones = document.getElementById('remision-observaciones').value;

        const nuevaRemision = {
            numeroRemision: newRemisionNumber,
            idCliente: clienteId,
            clienteNombre: cliente.nombre,
            clienteEmail: cliente.email,
            clienteTelefono: cliente.telefono1 || cliente.telefono2 || 'N/A',
            fechaRecibido: document.getElementById('fecha-recibido').value,
            formaPago: document.getElementById('forma-pago').value,
            observaciones: observaciones, // Y lo añadimos aquí
            incluyeIVA,
            items: itemsParaGuardar,
            cargosAdicionales,
            subtotal: Math.round(subtotalGeneral),
            valorIVA: Math.round(valorIVA),
            valorTotal: Math.round(totalFinal),
            creadoPor: currentUser.uid,
            timestamp: new Date(),
            estado: 'Recibido',
        };
        // --- FIN DE LA CORRECCIÓN CLAVE ---

        const batch = writeBatch(db);
        const remisionRef = doc(collection(db, "remisiones"));
        batch.set(remisionRef, nuevaRemision);

        for (const itemId in stockUpdates) {
            const cantidadADescontar = stockUpdates[itemId];
            const itemRef = doc(db, "items", itemId);
            const itemActual = allItems.find(i => i.id === itemId);
            if (itemActual) {
                const nuevoStock = (itemActual.stock || 0) - cantidadADescontar;
                batch.update(itemRef, { stock: nuevoStock });
            }
        }

        await batch.commit();

        e.target.reset();
        document.getElementById('items-container').innerHTML = '';
        document.getElementById('fecha-recibido').value = new Date().toISOString().split('T')[0];
        calcularTotales();
        hideModal();
        showTemporaryMessage("¡Remisión guardada con éxito!", "success");

    } catch (error) {
        console.error("Error al procesar la remisión:", error);
        showModalMessage(`Error: ${error.message}`);
    }
}


/**
 * --- FUNCIONES AUXILIARES FALTANTES ---
 * Estas funciones manejan la lógica de los campos de búsqueda con autocompletado.
 */

/**
 * Inicializa el comportamiento de búsqueda para una fila de ítem en el modal de importación.
 * @param {HTMLElement} itemRow - El elemento de la fila del ítem.
 */
function initializeItemRowSearch(itemRow) {
    const searchInput = itemRow.querySelector('.item-search-input');
    const resultsContainer = itemRow.querySelector('.search-results');
    initSearchableInput(
        searchInput,
        resultsContainer,
        () => allItems, // Usa la lista global de ítems
        (item) => `${item.referencia} - ${item.descripcion}`, // Cómo se muestra el ítem en la lista
        (selectedItem) => {
            // Qué hacer cuando se selecciona un ítem
            const idInput = itemRow.querySelector('.item-id-hidden');
            const refInput = itemRow.querySelector('.item-referencia-hidden');
            const descInput = itemRow.querySelector('.item-descripcion-hidden');
            if (selectedItem) {
                idInput.value = selectedItem.id;
                refInput.value = selectedItem.referencia;
                descInput.value = selectedItem.descripcion;
            } else {
                idInput.value = '';
                refInput.value = '';
                descInput.value = '';
            }
        }
    );
};


/**
 * --- VERSIÓN FINAL Y ROBUSTA ---
 * Se corrige un bug crítico de "closure" pasando el elemento 'searchInput'
 * directamente a la función onSelect. Esto asegura que el callback siempre
 * pueda encontrar su contexto y los elementos correctos para actualizar.
 */
function initSearchableInput(searchInput, resultsContainer, getDataFn, displayFn, onSelect) {
    searchInput.addEventListener('input', () => {
        const data = getDataFn();
        const searchTerm = searchInput.value.toLowerCase();

        if (!searchTerm) {
            // Limpiar la selección solo si el campo está vacío.
            if (onSelect) onSelect(null, searchInput);
            resultsContainer.innerHTML = '';
            resultsContainer.classList.add('hidden');
            return;
        }

        const filteredData = data.filter(item => displayFn(item).toLowerCase().includes(searchTerm));
        renderResults(filteredData);
    });

    searchInput.addEventListener('focus', () => {
        if (searchInput.value) {
            searchInput.dispatchEvent(new Event('input'));
        }
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
                // Al seleccionar, pasamos el ítem y el input
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

// --- FUNCIONES DE AYUDA Y MODALES ---

/**
 * Muestra un mensaje temporal no invasivo en la esquina de la pantalla.
 * Ideal para notificaciones que no deben interrumpir al usuario.
 * @param {string} message - El mensaje a mostrar.
 * @param {string} [type='info'] - El tipo de mensaje ('info', 'success', 'error').
 */
function showTemporaryMessage(message, type = 'info') {
    const colors = {
        info: 'bg-blue-500',
        success: 'bg-green-600',
        error: 'bg-red-500'
    };
    const messageEl = document.createElement('div');
    messageEl.className = `fixed top-5 right-5 ${colors[type]} text-white py-2 px-4 rounded-lg shadow-lg transition-opacity duration-300 z-50`;
    messageEl.textContent = message;
    document.body.appendChild(messageEl);

    // Desvanecer y eliminar el mensaje después de un tiempo
    setTimeout(() => {
        messageEl.classList.add('opacity-0');
        setTimeout(() => {
            messageEl.remove();
        }, 300); // Espera a que termine la transición de opacidad
    }, 2500); // El mensaje es visible por 2.5 segundos
}

/**
 * Sube un archivo a Firebase Storage y actualiza el documento del empleado.
 * Utiliza el mensaje temporal para no cerrar el modal de RRHH.
 */
async function handleFileUpload(employeeId, docPath, file) {
    if (!file) {
        showTemporaryMessage("No se seleccionó ningún archivo.", 'error');
        return;
    }
    showTemporaryMessage(`Subiendo ${file.name}...`, 'info');

    const storageRef = ref(storage, `empleados/${employeeId}/documentos/${docPath.split('.').pop()}_${Date.now()}_${file.name}`);
    try {
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        const updatePayload = {};
        updatePayload[docPath] = downloadURL;
        await updateDoc(doc(db, "users", employeeId), updatePayload);
        showTemporaryMessage("¡Documento subido con éxito!", 'success');
    } catch (error) {
        console.error("Error al subir el archivo:", error);
        showTemporaryMessage("Error al subir el archivo.", 'error');
    }
}



/**
 * --- NUEVA FUNCIÓN ---
 * Maneja el guardado de los cambios de un ítem.
 * Regenera la referencia y descripción basándose en los nuevos datos.
 */
async function handleEditItemSubmit(e) {
    e.preventDefault();

    const itemId = document.getElementById('edit-item-id').value;
    const tipo = document.getElementById('edit-item-tipo').value;
    const color = document.getElementById('edit-item-color').value;
    const ancho = parseFloat(document.getElementById('edit-item-ancho').value);
    const alto = parseFloat(document.getElementById('edit-item-alto').value);
    const laminasPorCaja = parseInt(document.getElementById('edit-item-laminas-por-caja').value, 10);

    if (!tipo || !color || isNaN(ancho) || isNaN(alto) || isNaN(laminasPorCaja)) {
        showModalMessage("Por favor, completa todos los campos con valores válidos.");
        return;
    }

    // Volver a generar la referencia y descripción por si cambian los datos
    const referencia = `${tipo.slice(0, 3).toUpperCase()}${color.slice(0, 3).toUpperCase()}-${ancho}x${alto}`;
    const descripcion = `${tipo} ${color} ${ancho}x${alto}mm`;

    const updatedData = {
        tipo,
        color,
        ancho,
        alto,
        laminasPorCaja,
        referencia,
        descripcion
        // No incluimos el stock, ya que no se puede editar aquí.
    };

    showModalMessage("Actualizando ítem...", true);
    try {
        const itemRef = doc(db, "items", itemId);
        await updateDoc(itemRef, updatedData);
        hideModal();
        showTemporaryMessage("¡Ítem actualizado con éxito!", "success");
    } catch (error) {
        console.error("Error al actualizar el ítem:", error);
        showModalMessage("Error al guardar los cambios.");
    }
}

// Esta función ahora se llama una sola vez
function setupSearchInputs() {
    // Cliente en Remisiones
    initSearchableInput(
        document.getElementById('cliente-search-input'),
        document.getElementById('cliente-search-results'),
        () => allClientes,
        (cliente) => cliente.nombre,
        (selectedCliente) => {
            const hiddenInput = document.getElementById('cliente-id-hidden');
            if (hiddenInput) hiddenInput.value = selectedCliente ? selectedCliente.id : '';
        }
    );

    // Proveedor en Gastos
    initSearchableInput(
        document.getElementById('proveedor-search-input'),
        document.getElementById('proveedor-search-results'),
        () => allProveedores,
        (proveedor) => proveedor.nombre,
        (selectedProveedor) => {
            const hiddenInput = document.getElementById('proveedor-id-hidden');
            if (hiddenInput) hiddenInput.value = selectedProveedor ? selectedProveedor.id : '';
        }
    );
}

/**
 * --- NUEVA FUNCIÓN ---
 * Crea el elemento HTML para una fila de ítem en el formulario de compra nacional.
 * @param {object} [item=null] - El objeto del ítem si se está editando.
 * @param {boolean} [isEditing=false] - Si la fila está en modo de solo lectura.
 * @returns {HTMLElement} El elemento de la fila del ítem.
 */
function createNacionalItemElement(item = null, isEditing = false) {
    const itemRow = document.createElement('div');
    itemRow.className = 'nacional-item-row grid grid-cols-1 md:grid-cols-4 gap-2 border-t pt-3';

    itemRow.innerHTML = `
        <div class="relative md:col-span-2">
            <label class="text-sm font-medium">Ítem</label>
            <input type="text" placeholder="Buscar ítem..." class="item-search-input w-full p-2 border rounded-lg" value="${item?.descripcion || ''}" autocomplete="off" ${isEditing ? 'disabled' : ''} required>
            <input type="hidden" class="item-id-hidden" value="${item?.itemId || ''}">
            <div class="search-results hidden"></div>
        </div>
        <div>
            <label class="text-sm font-medium">Cantidad</label>
            <input type="number" class="item-cantidad p-2 border rounded-lg w-full" placeholder="Cant." value="${item?.cantidad || ''}" min="1" ${isEditing ? 'disabled' : ''} required>
        </div>
        <div class="flex items-end gap-2">
            <div class="flex-grow">
                <label class="text-sm font-medium">Valor Total (COP)</label>
                <input type="text" class="item-valor-total cost-input-cop p-2 border rounded-lg w-full" value="${item ? formatCurrency(item.valorTotal) : ''}" placeholder="Valor Total" ${isEditing ? 'disabled' : ''} required>
            </div>
            ${!isEditing ? '<button type="button" class="remove-nacional-item-btn bg-red-500 text-white font-bold rounded-lg hover:bg-red-600 p-2 h-10 w-10 flex-shrink-0">X</button>' : ''}
        </div>
    `;

    if (!isEditing) {
        // Inicializar buscador solo en modo creación
        initSearchableInput(
            itemRow.querySelector('.item-search-input'),
            itemRow.querySelector('.search-results'),
            () => allItems, (i) => `${i.referencia} - ${i.descripcion}`, (sel) => {
                itemRow.querySelector('.item-id-hidden').value = sel ? sel.id : '';
            }
        );
        // Listener para recalcular total
        itemRow.querySelector('.item-valor-total').addEventListener('input', calcularTotalCompraNacional);
        itemRow.querySelector('.remove-nacional-item-btn').addEventListener('click', () => {
            itemRow.remove();
            calcularTotalCompraNacional();
        });
    }

    return itemRow;
}

/**
 * --- VERSIÓN SIMPLIFICADA ---
 * Crea el elemento para una fila de ítem, sin mostrar el costo unitario.
 * @param {object} [item=null] - El objeto del ítem existente (opcional).
 * @returns {HTMLElement} El elemento de la fila del ítem.
 */
function createImportacionItemElement(item = null) {
    dynamicElementCounter++;
    const itemRow = document.createElement('div');
    itemRow.className = 'import-item-row grid grid-cols-1 md:grid-cols-5 gap-2 border-t pt-3 mt-3';
    itemRow.dataset.id = dynamicElementCounter;

    const descripcion = item ? item.descripcion : '';
    const itemId = item ? item.itemId : '';
    const referencia = item ? item.referencia : '';
    const cantidad = item ? item.cantidad : '1';
    const valorTotalUSD = item ? formatCurrency(item.valorTotalItemUSD, true) : '';

    itemRow.innerHTML = `
        <div class="relative md:col-span-2">
            <label class="text-sm font-medium text-gray-600">Ítem</label>
            <input type="text" placeholder="Buscar ítem..." class="item-search-input w-full p-2 border border-gray-300 rounded-lg" value="${descripcion}" autocomplete="off" required>
            <input type="hidden" class="item-id-hidden" value="${itemId}">
            <input type="hidden" class="item-referencia-hidden" value="${referencia}">
            <input type="hidden" class="item-descripcion-hidden" value="${descripcion}">
            <div class="search-results hidden"></div>
        </div>
        <div>
            <label class="text-sm font-medium text-gray-600">Cantidad</label>
            <input type="number" class="item-cantidad p-2 border border-gray-300 rounded-lg w-full" placeholder="Cant." min="1" value="${cantidad}" required>
        </div>
        <div class="flex items-end gap-2 md:col-span-2">
            <div class="flex-grow">
                <label class="text-sm font-medium text-gray-600">Valor Total del Ítem (USD)</label>
                <input type="text" class="item-valor-total cost-input-usd p-2 border border-gray-300 rounded-lg w-full" placeholder="Valor Total" value="${valorTotalUSD}" required>
            </div>
            <button type="button" class="remove-import-item-btn bg-red-500 text-white font-bold rounded-lg hover:bg-red-600 p-2 h-10 w-10 flex-shrink-0 flex items-center justify-center">X</button>
        </div>
    `;
    return itemRow;
}

function createItemElement() {
    dynamicElementCounter++;
    const itemRow = document.createElement('div');
    itemRow.className = 'item-row border border-gray-300 p-3 rounded-lg';
    itemRow.id = `item-row-${dynamicElementCounter}`;

    itemRow.innerHTML = `
        <div class="relative">
            <input type="text" placeholder="Buscar ítem..." class="item-search-input w-full p-2 border border-gray-300 rounded-lg" autocomplete="off" required>
            <input type="hidden" class="item-id-hidden" name="itemId">
            <input type="hidden" class="item-laminas-por-caja-hidden">
            <input type="hidden" class="item-ancho-hidden">
            <input type="hidden" class="item-alto-hidden">
            <div class="search-results hidden"></div>
        </div>
        <div class="mt-3 text-sm flex items-center space-x-4">
            <label class="flex items-center"><input type="radio" name="tipo-corte-${dynamicElementCounter}" value="completa" class="tipo-corte-radio" checked> <span class="ml-2">Lámina Completa</span></label>
            <label class="flex items-center"><input type="radio" name="tipo-corte-${dynamicElementCounter}" value="cortada" class="tipo-corte-radio"> <span class="ml-2">Lámina Cortada</span></label>
        </div>
        <div class="grid grid-cols-2 gap-4 mt-2">
            <div class="completa-container">
                <label class="text-xs font-semibold">Cantidad de Láminas</label>
                <input type="number" class="item-cantidad-completa w-full p-2 border rounded-lg" placeholder="Cant." min="1">
            </div>
            <div>
                <label class="text-xs font-semibold">Valor por Lámina (COP)</label>
                <input type="text" class="item-valor-lamina cost-input-cop w-full p-2 border rounded-lg" placeholder="Valor Unit." required>
            </div>
        </div>
        <div class="cortada-container mt-2 hidden">
            <div class="bg-gray-100 p-2 rounded-md">
                <label class="text-xs font-semibold block mb-1">Estrategia de Despiece:</label>
                <div class="flex items-center space-x-3 text-xs">
                    <label class="flex items-center"><input type="radio" name="estrategia-despiece-${dynamicElementCounter}" value="minimo_desperdicio" class="estrategia-radio" checked> <span class="ml-1">Mínimo Desperdicio</span></label>
                    <label class="flex items-center"><input type="radio" name="estrategia-despiece-${dynamicElementCounter}" value="vertical" class="estrategia-radio"> <span class="ml-1">Prioridad Vertical</span></label>
                </div>
            </div>
            <label class="text-xs font-semibold mt-2 block">Cortes (Ancho x Alto en mm)</label>
            <div class="cortes-list space-y-2 mt-1"></div>
            <button type="button" class="add-cut-btn mt-2 w-full text-xs bg-blue-100 text-blue-800 font-semibold py-1 rounded hover:bg-blue-200">+ Añadir Corte</button>
        </div>
        <button type="button" class="remove-item-btn bg-red-500 text-white font-bold rounded-lg hover:bg-red-600 w-full mt-3 py-1 text-sm">Eliminar Ítem</button>
    `;

    initSearchableInput(
        itemRow.querySelector('.item-search-input'),
        itemRow.querySelector('.search-results'),
        () => allItems.filter(i => i.stock > 0),
        (item) => `${item.referencia} - ${item.descripcion} (Stock: ${item.stock})`,
        (selectedItem, searchInputElement) => {
            const row = searchInputElement.closest('.item-row');
            if (!row) return; // Salida de seguridad

            const idInput = row.querySelector('.item-id-hidden');
            const laminasInput = row.querySelector('.item-laminas-por-caja-hidden');
            const anchoInput = row.querySelector('.item-ancho-hidden');
            const altoInput = row.querySelector('.item-alto-hidden');

            if (selectedItem) {
                idInput.value = selectedItem.id;
                laminasInput.value = selectedItem.laminasPorCaja;
                anchoInput.value = selectedItem.ancho;
                altoInput.value = selectedItem.alto;
            } else {
                idInput.value = '';
                laminasInput.value = '';
                anchoInput.value = '';
                altoInput.value = '';
            }
        }
    );

    // --- LÍNEAS AÑADIDAS PARA LA SOLUCIÓN ---
    const valorLaminaInput = itemRow.querySelector('.item-valor-lamina');
    valorLaminaInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    valorLaminaInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));
    // --- FIN DE LAS LÍNEAS AÑADIDAS ---

    return itemRow;
}

/**
 * --- VERSIÓN MEJORADA CON CAMPO DE CANTIDAD ---
 * Crea el elemento HTML para una única fila de corte.
 * AHORA INCLUYE un campo para especificar la cantidad de cortes de esa medida.
 * @returns {HTMLElement} El elemento de la fila de corte.
 */
function createCutElement() {
    const cutRow = document.createElement('div');
    cutRow.className = 'cut-row flex items-center gap-2';

    // --- INICIO DE LA MODIFICACIÓN ---
    cutRow.innerHTML = `
        <input type="number" class="cut-ancho w-full p-1 border rounded-md" placeholder="Ancho">
        <span class="text-gray-400">x</span>
        <input type="number" class="cut-alto w-full p-1 border rounded-md" placeholder="Alto">
        <input type="number" class="cut-cantidad w-20 p-1 border rounded-md" placeholder="Cant." min="1" value="1">
        <button type="button" class="remove-cut-btn bg-red-100 text-red-700 font-bold rounded p-1 text-xs">X</button>
    `;
    // --- FIN DE LA MODIFICACIÓN ---

    return cutRow;
}

/**
 * Calcula los totales del formulario de remisión para la vista previa.
 * Llama a la función 'calcularCostoDeCortes' para incluir los cargos adicionales.
 */
function calcularTotales() {
    const ivaCheckbox = document.getElementById('incluir-iva');
    const subtotalEl = document.getElementById('subtotal');
    const valorIvaEl = document.getElementById('valor-iva');
    const valorTotalEl = document.getElementById('valor-total');
    if (!subtotalEl) return; // Salida segura si el formulario no está visible

    let subtotalItems = 0;
    let subtotalCargos = 0;
    const incluyeIVA = ivaCheckbox.checked;

    document.querySelectorAll('.item-row').forEach(itemRow => {
        const valorPorLaminaConIVA = unformatCurrency(itemRow.querySelector('.item-valor-lamina').value);
        const valorPorLaminaBase = incluyeIVA ? valorPorLaminaConIVA / 1.19 : valorPorLaminaConIVA;
        const tipoCorte = itemRow.querySelector('.tipo-corte-radio:checked').value;

        if (tipoCorte === 'completa') {
            const cantidad = parseInt(itemRow.querySelector('.item-cantidad-completa').value) || 0;
            subtotalItems += cantidad * valorPorLaminaBase;
        } else { // 'cortada'
            // Para la UI, estimamos el costo de al menos una lámina
            subtotalItems += valorPorLaminaBase * 1;

            const totalCortes = Array.from(itemRow.querySelectorAll('.cut-row')).reduce((sum, cutRow) => {
                return sum + (parseInt(cutRow.querySelector('.cut-cantidad').value) || 0);
            }, 0);

            const cargo = calcularCostoDeCortes(totalCortes);
            if (cargo.costo > 0) {
                const valorCargoBase = (incluyeIVA && cargo.ivaIncluido) ? cargo.costo / 1.19 : cargo.costo;
                subtotalCargos += valorCargoBase;
            }
        }
    });

    const subtotalGeneral = subtotalItems + subtotalCargos;
    const valorIVA = incluyeIVA ? subtotalGeneral * 0.19 : 0;
    const total = subtotalGeneral + valorIVA;

    subtotalEl.textContent = formatCurrency(Math.round(subtotalGeneral));
    valorIvaEl.textContent = formatCurrency(Math.round(valorIVA));
    valorTotalEl.textContent = formatCurrency(Math.round(total));

    return { subtotalGeneral, valorIVA, total };
}


/**
 * --- FUNCIÓN RESTAURADA ---
 * Calcula el costo adicional por los cortes basándose en las reglas de negocio.
 * @param {number} totalCortes - El número total de cortes individuales a realizar.
 * @returns {{costo: number, descripcion: string, ivaIncluido: boolean}} El costo y la descripción del cargo.
 */
function calcularCostoDeCortes(totalCortes) {
    if (totalCortes <= 3) {
        return { costo: 0, descripcion: "Hasta 3 cortes sin costo", ivaIncluido: false };
    }
    if (totalCortes <= 10) {
        // El valor de 15.000 ya incluye el IVA
        return { costo: 15000, descripcion: `Cargo por ${totalCortes} cortes`, ivaIncluido: true };
    }
    // El valor de 20.000 ya incluye el IVA
    return { costo: 20000, descripcion: `Cargo especial por ${totalCortes} cortes`, ivaIncluido: true };
}

// REEMPLAZA esta función en tu app.js
function showEditClientModal(cliente) {
    let rutHtml = '';

    if (cliente.rutUrl) {
        // --- INICIO DE LA CORRECCIÓN UNIVERSAL ---
        let rutPath = '';
        try {
            const urlString = cliente.rutUrl;
            // 1. Encontrar el final del nombre del bucket (después de .app/ o .com/)
            const bucketEndMarker = '.app/';
            const bucketEndIndex = urlString.indexOf(bucketEndMarker);

            if (bucketEndIndex !== -1) {
                // 2. Encontrar el inicio de los parámetros de la URL (el '?')
                const queryStartIndex = urlString.indexOf('?');
                // 3. La ruta es lo que está entre esos dos puntos
                const encodedPath = urlString.substring(bucketEndIndex + bucketEndMarker.length, queryStartIndex);
                rutPath = decodeURIComponent(encodedPath);
            } else {
                throw new Error("La URL no contiene un nombre de bucket reconocible (.app/).");
            }
        } catch (e) {
            console.error("Error al procesar la URL del RUT del cliente:", e.message, cliente.rutUrl);
            rutPath = '';
        }
        // --- FIN DE LA CORRECCIÓN UNIVERSAL ---

        rutHtml = `
            <div class="mt-4 pt-4 border-t">
                <p class="block text-sm font-medium text-gray-700 mb-2">Gestión de RUT</p>
                <div class="flex gap-2">
                    <button type="button" data-file-path="${rutPath}" data-file-title="RUT de ${cliente.nombre}" class="flex-1 text-center bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600">Ver</button>
                    <button type="button" id="btn-actualizar-rut-cliente" class="flex-1 bg-yellow-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-yellow-600">Actualizar</button>
                </div>
                <div id="rut-upload-container-cliente" class="hidden mt-2">
                    <input type="file" id="edit-cliente-rut" class="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/>
                </div>
            </div>
        `;
    } else {
        rutHtml = `
            <div class="mt-4 pt-4 border-t">
                <label for="edit-cliente-rut" class="block text-sm font-medium text-gray-700">Subir RUT (Opcional)</label>
                <input type="file" id="edit-cliente-rut" class="mt-1 w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/>
            </div>
        `;
    }

    const modalContent = `
        <div class="bg-white p-6 rounded-xl shadow-lg max-w-md mx-auto">
            <h2 class="text-xl font-semibold mb-4">Editar Cliente</h2>
            <form id="edit-cliente-form" data-id="${cliente.id}" class="space-y-3">
                <input type="text" id="edit-cliente-nombre-empresa" value="${cliente.nombreEmpresa || cliente.nombre}" placeholder="Nombre Empresa" class="w-full p-3 border rounded-lg" required>
                <input type="text" id="edit-cliente-contacto" value="${cliente.contacto || ''}" placeholder="Nombre del Contacto" class="w-full p-3 border rounded-lg">
                <input type="email" id="edit-cliente-email" value="${cliente.email || ''}" placeholder="Correo" class="w-full p-3 border rounded-lg">
                <input type="tel" id="edit-cliente-telefono1" value="${cliente.telefono1 || ''}" placeholder="Teléfono 1" class="w-full p-3 border rounded-lg" required oninput="this.value = this.value.replace(/[^0-9]/g, '')">
                <input type="tel" id="edit-cliente-telefono2" value="${cliente.telefono2 || ''}" placeholder="Teléfono 2" class="w-full p-3 border rounded-lg" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
                <input type="text" id="edit-cliente-nit" value="${cliente.nit || ''}" placeholder="NIT" class="w-full p-3 border rounded-lg">
                ${rutHtml}
                <div class="mt-6 flex justify-end gap-3">
                    <button type="button" id="cancel-edit-client" class="bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg">Cancelar</button>
                    <button type="submit" class="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Guardar Cambios</button>
                </div>
            </form>
        </div>
    `;
    document.getElementById('modal-content').innerHTML = modalContent;
    document.getElementById('modal').classList.remove('hidden');

    const btnActualizarRutCliente = document.getElementById('btn-actualizar-rut-cliente');
    if (btnActualizarRutCliente) {
        btnActualizarRutCliente.addEventListener('click', () => {
            document.getElementById('rut-upload-container-cliente').classList.remove('hidden');
            btnActualizarRutCliente.classList.add('hidden');
        });
    }

    document.getElementById('cancel-edit-client').addEventListener('click', () => {
        document.getElementById('modal').classList.add('hidden');
    });
}

function showEditProviderModal(proveedor) {
    let rutHtml = '';

    if (proveedor.rutUrl) {
        // --- INICIO DE LA CORRECCIÓN UNIVERSAL ---
        let rutPath = '';
        try {
            const urlString = proveedor.rutUrl;
            const bucketEndMarker = '.app/';
            const bucketEndIndex = urlString.indexOf(bucketEndMarker);

            if (bucketEndIndex !== -1) {
                const queryStartIndex = urlString.indexOf('?');
                const encodedPath = urlString.substring(bucketEndIndex + bucketEndMarker.length, queryStartIndex);
                rutPath = decodeURIComponent(encodedPath);
            } else {
                throw new Error("La URL no contiene un nombre de bucket reconocible (.app/).");
            }
        } catch (e) {
            console.error("Error al procesar la URL del RUT del proveedor:", e.message, proveedor.rutUrl);
            rutPath = '';
        }
        // --- FIN DE LA CORRECCIÓN UNIVERSAL ---

        rutHtml = `
            <div class="mt-4 pt-4 border-t">
                <p class="block text-sm font-medium text-gray-700 mb-2">Gestión de RUT</p>
                <div class="flex gap-2">
                    <button type="button" data-file-path="${rutPath}" data-file-title="RUT de ${proveedor.nombre}" class="flex-1 text-center bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600">Ver</button>
                    <button type="button" id="btn-actualizar-rut" class="flex-1 bg-yellow-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-yellow-600">Actualizar</button>
                </div>
                <div id="rut-upload-container" class="hidden mt-2">
                    <input type="file" id="edit-proveedor-rut" class="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"/>
                </div>
            </div>
        `;
    } else {
        rutHtml = `
            <div class="mt-4 pt-4 border-t">
                <label for="edit-proveedor-rut" class="block text-sm font-medium text-gray-700">Subir RUT (Opcional)</label>
                <input type="file" id="edit-proveedor-rut" class="mt-1 w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"/>
            </div>
        `;
    }

    const modalContent = `
        <div class="bg-white p-6 rounded-xl shadow-lg max-w-md mx-auto">
            <h2 class="text-xl font-semibold mb-4">Editar Proveedor</h2>
            <form id="edit-proveedor-form" data-id="${proveedor.id}">
                <input type="text" id="edit-proveedor-nombre" value="${proveedor.nombre}" class="w-full p-3 border rounded-lg mb-2" required>
                <input type="text" id="edit-proveedor-contacto" value="${proveedor.contacto || ''}" placeholder="Nombre de Contacto" class="w-full p-3 border rounded-lg mb-2">
                <input type="tel" id="edit-proveedor-telefono" value="${proveedor.telefono || ''}" placeholder="Teléfono" class="w-full p-3 border rounded-lg mb-2">
                <input type="email" id="edit-proveedor-email" value="${proveedor.email || ''}" placeholder="Correo" class="w-full p-3 border rounded-lg">
                ${rutHtml}
                <div class="mt-6 flex justify-end gap-3">
                    <button type="button" id="cancel-edit-provider" class="bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg">Cancelar</button>
                    <button type="submit" class="bg-teal-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-teal-700">Guardar Cambios</button>
                </div>
            </form>
        </div>
    `;
    document.getElementById('modal-content').innerHTML = modalContent;
    document.getElementById('modal').classList.remove('hidden');

    const btnActualizarRut = document.getElementById('btn-actualizar-rut');
    if (btnActualizarRut) {
        btnActualizarRut.addEventListener('click', () => {
            document.getElementById('rut-upload-container').classList.remove('hidden');
            btnActualizarRut.classList.add('hidden');
        });
    }

    document.getElementById('cancel-edit-provider').addEventListener('click', () => {
        document.getElementById('modal').classList.add('hidden');
    });
}

// UBICADA DENTRO DE /importacion/js/app.js
// ---> ESTA ES LA SOLUCIÓN FINAL Y DEFINITIVA PARA EL ERROR DE CACHÉ EN IOS <---


function showPdfModal(pdfUrl, title) {
    // --- INICIO DE LA CORRECCIÓN ---
    // 1. Verificación de seguridad: si no hay URL, muestra un error y detiene la ejecución.
    if (!pdfUrl || pdfUrl === 'undefined') {
        Swal.fire('PDF no disponible', 'El PDF para esta remisión aún se está generando. Por favor, intenta de nuevo en unos momentos.', 'info');
        return;
    }
    // --- FIN DE LA CORRECCIÓN ---

    // Lógica para abrir en modal en escritorio o nueva pestaña en móvil
    if (isMobileDevice()) {
        const separator = pdfUrl.includes('?') ? '&' : '?';
        const uniqueUrl = `${pdfUrl}${separator}cache_bust=${new Date().getTime()}`;
        window.open(uniqueUrl, '_blank');
    } else {
        // Asumiendo que tienes una función 'showFileModal' como la que creamos antes
        showFileModal(pdfUrl, title);
    }
}

function showPaymentModal(remision) {
    const totalConfirmado = (remision.payments || []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
    const totalPorConfirmar = (remision.payments || []).filter(p => p.status === 'por confirmar').reduce((sum, p) => sum + p.amount, 0);
    const saldoPendiente = remision.valorTotal - totalConfirmado;
    const saldoRealPendiente = remision.valorTotal - totalConfirmado - totalPorConfirmar;

    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');

    const paymentsHTML = (remision.payments || []).sort((a, b) => new Date(b.date) - new Date(a.date)).map((p, index) => {
        let statusBadge = '';
        let confirmButton = '';

        if (p.status === 'por confirmar') {
            statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Por Confirmar</span>`;

            // --- INICIO DE LA CORRECCIÓN CLAVE ---
            if (currentUserData.role === 'admin') {
                if (p.registeredBy !== currentUser.uid) {
                    // Si es un admin DIFERENTE, puede confirmar.
                    confirmButton = `<button data-remision-id="${remision.id}" data-payment-index="${index}" class="confirm-payment-btn bg-green-500 text-white text-xs px-2 py-1 rounded hover:bg-green-600">Confirmar</button>`;
                } else {
                    // Si es el MISMO admin, el botón está deshabilitado.
                    confirmButton = `<button class="bg-gray-400 text-white text-xs px-2 py-1 rounded cursor-not-allowed" title="Otro administrador debe confirmar este pago.">Confirmar</button>`;
                }
            }
            // Si no es admin, no se muestra ningún botón.
            // --- FIN DE LA CORRECCIÓN CLAVE ---

        } else {
            statusBadge = `<span class="text-xs font-semibold bg-green-200 text-green-800 px-2 py-1 rounded-full">Confirmado</span>`;
        }

        return `<tr class="border-b">
            <td class="p-2">${p.date}</td>
            <td class="p-2">${p.method}</td>
            <td class="p-2 text-right">${formatCurrency(p.amount)}</td>
            <td class="p-2">${statusBadge}</td>
            <td class="p-2">${confirmButton}</td>
        </tr>`;
    }).join('');

    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `<div class="bg-white rounded-lg p-6 shadow-xl max-w-3xl w-full mx-auto text-left"><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Gestionar Pagos (Remisión N° ${remision.numeroRemision})</h2><button id="close-payment-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button></div><div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 text-center"><div class="bg-blue-50 p-3 rounded-lg"><div class="text-sm text-blue-800">VALOR TOTAL</div><div class="font-bold text-lg">${formatCurrency(remision.valorTotal)}</div></div><div class="bg-green-50 p-3 rounded-lg"><div class="text-sm text-green-800">PAGADO (CONF.)</div><div class="font-bold text-lg">${formatCurrency(totalConfirmado)}</div></div><div class="bg-yellow-50 p-3 rounded-lg"><div class="text-sm text-yellow-800">POR CONFIRMAR</div><div class="font-bold text-lg">${formatCurrency(totalPorConfirmar)}</div></div><div class="bg-red-50 p-3 rounded-lg"><div class="text-sm text-red-800">SALDO PENDIENTE</div><div class="font-bold text-lg">${formatCurrency(saldoPendiente)}</div></div></div><div class="grid grid-cols-1 md:grid-cols-2 gap-6"><div><h3 class="font-semibold mb-2">Historial de Pagos</h3><div class="border rounded-lg max-h-60 overflow-y-auto"><table class="w-full text-sm"><thead class="bg-gray-50"><tr><th class="p-2 text-left">Fecha</th><th class="p-2 text-left">Método</th><th class="p-2 text-right">Monto</th><th class="p-2 text-left">Estado</th><th></th></tr></thead><tbody>${paymentsHTML || '<tr><td colspan="5" class="p-4 text-center text-gray-500">No hay pagos registrados.</td></tr>'}</tbody></table></div></div><div><h3 class="font-semibold mb-2">Registrar Nuevo Pago</h3>${saldoRealPendiente > 0 ? `<form id="add-payment-form" class="space-y-3 bg-gray-50 p-4 rounded-lg"><div><label for="new-payment-amount" class="text-sm font-medium">Monto del Abono</label><input type="text" inputmode="numeric" id="new-payment-amount" class="w-full p-2 border rounded-md mt-1" max="${saldoRealPendiente}" required></div><div><label for="new-payment-date" class="text-sm font-medium">Fecha del Pago</label><input type="date" id="new-payment-date" class="w-full p-2 border rounded-md mt-1" value="${new Date().toISOString().split('T')[0]}" required></div><div><label for="new-payment-method" class="text-sm font-medium">Método de Pago</label><select id="new-payment-method" class="w-full p-2 border rounded-md mt-1 bg-white" required>${metodosDePagoHTML}</select></div><button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Registrar Pago</button></form>` : '<div class="bg-green-100 text-green-800 p-4 rounded-lg text-center font-semibold">Esta remisión ya ha sido pagada en su totalidad.</div>'}</div></div></div>`;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-payment-modal').addEventListener('click', hideModal);

    document.querySelectorAll('.confirm-payment-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const remisionId = e.currentTarget.dataset.remisionId;
            const paymentIndex = parseInt(e.currentTarget.dataset.paymentIndex);
            const remisionToUpdate = allRemisiones.find(r => r.id === remisionId);
            if (remisionToUpdate && remisionToUpdate.payments[paymentIndex]) {
                remisionToUpdate.payments[paymentIndex].status = 'confirmado';
                remisionToUpdate.payments[paymentIndex].confirmedBy = currentUser.uid;
                remisionToUpdate.payments[paymentIndex].confirmedAt = new Date();
                showModalMessage("Confirmando pago...", true);
                try {
                    await updateDoc(doc(db, "remisiones", remisionId), { payments: remisionToUpdate.payments });
                    hideModal();
                    showModalMessage("¡Pago confirmado!", false, 1500);
                } catch (error) {
                    console.error("Error al confirmar pago:", error);
                    showModalMessage("Error al confirmar el pago.");
                }
            }
        });
    });

    if (saldoRealPendiente > 0) {
        const paymentAmountInput = document.getElementById('new-payment-amount');
        paymentAmountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
        paymentAmountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));
        document.getElementById('add-payment-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const amount = unformatCurrency(paymentAmountInput.value);
            if (amount <= 0 || !amount) { showModalMessage("El monto debe ser mayor a cero."); return; }
            if (amount > saldoRealPendiente + 0.01) {
                showModalMessage(`El monto del pago no puede superar el saldo pendiente de ${formatCurrency(saldoRealPendiente)}.`);
                return;
            }

            const newPayment = {
                amount: amount,
                date: document.getElementById('new-payment-date').value,
                method: document.getElementById('new-payment-method').value,
                registeredAt: new Date(),
                registeredBy: currentUser.uid,
                status: 'por confirmar'
            };
            showModalMessage("Registrando pago...", true);
            try {
                await updateDoc(doc(db, "remisiones", remision.id), { payments: arrayUnion(newPayment) });
                hideModal();
                showModalMessage("¡Pago registrado! Pendiente de confirmación.", false, 2000);
            } catch (error) {
                console.error("Error al registrar pago:", error);
                showModalMessage("Error al registrar el pago.");
            }
        });
    }
}
/**
 * --- VERSIÓN MEJORADA CON BOTÓN CONDICIONAL ---
 * Muestra el modal de resumen. Revisa si los saldos iniciales ya han sido
 * establecidos. Si no, muestra el botón para configurarlos; de lo contrario, lo oculta.
 */
async function showDashboardModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    const balanceDocRef = doc(db, "saldosIniciales", "current");
    const balanceDoc = await getDoc(balanceDocRef);
    const balancesExist = balanceDoc.exists();

    let initialBalanceButtonHTML = '';
    if (!balancesExist) {
        initialBalanceButtonHTML = `<button id="set-initial-balance-btn" class="bg-gray-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-gray-700">Saldos Iniciales</button>`;
    }

    // --- INICIO DE LA CORRECCIÓN ---
    // Generamos dinámicamente las tarjetas de saldos a partir de nuestra constante
    const saldosHTML = METODOS_DE_PAGO.map(metodo => `
        <div class="bg-gray-100 p-4 rounded-lg">
            <div class="text-sm font-semibold text-gray-800">${metodo.toUpperCase()}</div>
            <div id="summary-${metodo.toLowerCase()}" class="text-xl font-bold"></div>
        </div>
    `).join('');
    // --- FIN DE LA CORRECCIÓN ---

    modalContentWrapper.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-auto text-left flex flex-col" style="height: 80vh;">
        <div class="flex justify-between items-center p-4 border-b flex-wrap gap-2">
            <h2 class="text-xl font-semibold">Resumen Financiero</h2>
            <div class="flex items-center gap-4">
                ${initialBalanceButtonHTML}

                <button id="show-transfer-modal-btn" class="bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-yellow-700">Transferir Fondos</button>

                <button id="download-report-btn" class="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Descargar Reporte PDF</button>
                <button id="close-dashboard-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
        </div>
        <div class="border-b border-gray-200">
            <nav class="-mb-px flex space-x-6 px-6">
                <button id="dashboard-tab-summary" class="dashboard-tab-btn active py-4 px-1 font-semibold">Resumen Mensual</button>
                <button id="dashboard-tab-cartera" class="dashboard-tab-btn py-4 px-1 font-semibold">Cartera</button>
                <button id="dashboard-tab-clientes" class="dashboard-tab-btn py-4 px-1 font-semibold">Clientes</button>
            </nav>
        </div>
        <div id="dashboard-summary-view" class="p-6 space-y-6 overflow-y-auto flex-grow">
            <div class="flex items-center gap-4">
                <select id="summary-month" class="p-2 border rounded-lg"></select>
                <select id="summary-year" class="p-2 border rounded-lg"></select>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="bg-green-100 p-4 rounded-lg"><div class="text-sm font-semibold text-green-800">VENTAS</div><div id="summary-sales" class="text-2xl font-bold"></div></div>
                <div class="bg-red-100 p-4 rounded-lg"><div class="text-sm font-semibold text-red-800">GASTOS</div><div id="summary-expenses" class="text-2xl font-bold"></div></div>
                <div class="bg-indigo-100 p-4 rounded-lg"><div class="text-sm font-semibold text-indigo-800">UTILIDAD/PÉRDIDA</div><div id="summary-profit" class="text-2xl font-bold"></div></div>
                <div class="bg-yellow-100 p-4 rounded-lg"><div class="text-sm font-semibold text-yellow-800">CARTERA PENDIENTE (MES)</div><div id="summary-cartera" class="text-2xl font-bold"></div></div>
            </div>
            <div>
                <h3 class="font-semibold mb-2">Saldos Estimados (Total)</h3>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    ${saldosHTML}
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div class="bg-gray-100 p-4 rounded-lg">
                        <div class="text-sm font-semibold text-gray-800">CARTERA TOTAL</div>
                        <div id="summary-cartera-total" class="text-xl font-bold"></div>
                    </div>
                    <div class="bg-teal-100 p-4 rounded-lg border-l-4 border-teal-500">
                        <div class="text-sm font-semibold text-teal-800">VENTA DEL DÍA</div>
                        <div id="summary-daily-sales" class="text-xl font-bold"></div>
                    </div>
                </div>
            </div>
            <div>
                <h3 class="font-semibold mb-2">Utilidad/Pérdida (Últimos 6 Meses)</h3>
                <div class="bg-gray-50 p-4 rounded-lg"><canvas id="profitLossChart"></canvas></div>
            </div>
        </div>
        <div id="dashboard-cartera-view" class="p-6 hidden flex-grow overflow-y-auto"><h3 class="font-semibold mb-2 text-xl">Cartera Pendiente de Cobro</h3><div id="cartera-list" class="space-y-4"></div><div id="cartera-total" class="text-right font-bold text-xl mt-4"></div></div>
        <div id="dashboard-clientes-view" class="p-6 hidden flex-grow overflow-y-auto">
            <h3 class="font-semibold mb-2 text-xl">Ranking de Clientes</h3>
            <div class="flex flex-wrap items-center gap-4 mb-4 p-2 bg-gray-50 rounded-lg">
                <div class="flex items-center gap-2"><label class="text-sm font-medium">Desde:</label><select id="rank-start-month" class="p-2 border rounded-lg"></select><select id="rank-start-year" class="p-2 border rounded-lg"></select></div>
                <div class="flex items-center gap-2"><label class="text-sm font-medium">Hasta:</label><select id="rank-end-month" class="p-2 border rounded-lg"></select><select id="rank-end-year" class="p-2 border rounded-lg"></select></div>
                <button id="rank-filter-btn" class="bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700">Filtrar</button>
                <button id="rank-show-all-btn" class="bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700">Mostrar Todos</button>
            </div>
            <div id="top-clientes-list" class="space-y-3"></div>
        </div>

        <div id="dashboard-transferencias-view" class="p-6 hidden flex-grow overflow-y-auto">
            <h3 class="font-semibold mb-2 text-xl">Historial de Transferencias Confirmadas</h3>
             <div class="flex flex-col sm:flex-row gap-4 my-4 p-4 bg-gray-50 rounded-lg">
                 <div class="flex-1">
                     <label for="filter-transfer-month" class="text-sm font-medium text-gray-700">Mes</label>
                     <select id="filter-transfer-month" class="p-2 border rounded-lg bg-white w-full mt-1"></select>
                 </div>
                 <div class="flex-1">
                     <label for="filter-transfer-year" class="text-sm font-medium text-gray-700">Año</label>
                     <select id="filter-transfer-year" class="p-2 border rounded-lg bg-white w-full mt-1"></select>
                 </div>
             </div>
            <div id="transferencias-list" class="space-y-3"></div>
        </div>

        <div id="pending-transfers-section" class="p-6 border-t mt-4 hidden">
            <h3 class="font-semibold mb-2 text-lg text-yellow-800">Transferencias Pendientes de Confirmación</h3>
            <div id="pending-transfers-list" class="space-y-3"></div>
        </div>

    </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-dashboard-modal').addEventListener('click', () => {
        if (unsubscribePendingTransfers) unsubscribePendingTransfers();
        if (unsubscribeConfirmedTransfers) unsubscribeConfirmedTransfers(); // Detener nuevo listener
        hideModal();
    });

    const initialBalanceBtn = document.getElementById('set-initial-balance-btn');
    if (initialBalanceBtn) {
        initialBalanceBtn.addEventListener('click', showInitialBalanceModal);
    }

    const monthSelect = document.getElementById('summary-month');
    const yearSelect = document.getElementById('summary-year');
    const rankStartMonth = document.getElementById('rank-start-month');
    const rankStartYear = document.getElementById('rank-start-year');
    const rankEndMonth = document.getElementById('rank-end-month');
    const rankEndYear = document.getElementById('rank-end-year');

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const now = new Date();

    [monthSelect, rankStartMonth, rankEndMonth].forEach(sel => {
        for (let i = 0; i < 12; i++) { const option = document.createElement('option'); option.value = i; option.textContent = monthNames[i]; if (i === now.getMonth()) option.selected = true; sel.appendChild(option); }
    });
    [yearSelect, rankStartYear, rankEndYear].forEach(sel => {
        for (let i = 0; i < 5; i++) { const year = now.getFullYear() - i; const option = document.createElement('option'); option.value = year; option.textContent = year; sel.appendChild(option); }
    });

    const updateDashboardView = () => updateDashboard(parseInt(yearSelect.value), parseInt(monthSelect.value));
    monthSelect.addEventListener('change', updateDashboardView);
    yearSelect.addEventListener('change', updateDashboardView);

    document.getElementById('rank-filter-btn').addEventListener('click', () => {
        const startDate = new Date(rankStartYear.value, rankStartMonth.value, 1);
        const endDate = new Date(rankEndYear.value, parseInt(rankEndMonth.value) + 1, 0);
        renderTopClientes(startDate, endDate);
    });
    document.getElementById('rank-show-all-btn').addEventListener('click', () => renderTopClientes());

    const summaryTab = document.getElementById('dashboard-tab-summary');
    const carteraTab = document.getElementById('dashboard-tab-cartera');
    const clientesTab = document.getElementById('dashboard-tab-clientes');
    const summaryView = document.getElementById('dashboard-summary-view');
    const carteraView = document.getElementById('dashboard-cartera-view');
    const clientesView = document.getElementById('dashboard-clientes-view');

    summaryTab.addEventListener('click', () => {
        summaryTab.classList.add('active');
        carteraTab.classList.remove('active');
        clientesTab.classList.remove('active');
        summaryView.classList.remove('hidden');
        carteraView.classList.add('hidden');
        clientesView.classList.add('hidden');
    });
    carteraTab.addEventListener('click', () => {
        carteraTab.classList.add('active');
        summaryTab.classList.remove('active');
        clientesTab.classList.remove('active');
        carteraView.classList.remove('hidden');
        summaryView.classList.add('hidden');
        clientesView.classList.add('hidden');
    });
    clientesTab.addEventListener('click', () => {
        clientesTab.classList.add('active');
        summaryTab.classList.remove('active');
        carteraTab.classList.remove('active');
        clientesView.classList.remove('hidden');
        summaryView.classList.add('hidden');
        carteraView.classList.add('hidden');
    });

    const tabs = {
        summary: document.getElementById('dashboard-tab-summary'),
        cartera: document.getElementById('dashboard-tab-cartera'),
        clientes: document.getElementById('dashboard-tab-clientes'),
        transferencias: document.getElementById('dashboard-tab-transferencias') // Nueva pestaña
    };
    const views = {
        summary: document.getElementById('dashboard-summary-view'),
        cartera: document.getElementById('dashboard-cartera-view'),
        clientes: document.getElementById('dashboard-clientes-view'),
        transferencias: document.getElementById('dashboard-transferencias-view') // Nueva vista
    };

    Object.keys(tabs).forEach(key => {
        if (tabs[key]) {
            tabs[key].addEventListener('click', () => {
                Object.values(tabs).forEach(t => t?.classList.remove('active'));
                Object.values(views).forEach(v => v?.classList.add('hidden'));
                tabs[key].classList.add('active');
                views[key].classList.remove('hidden');
            });
        }
    });

    document.getElementById('download-report-btn').addEventListener('click', showReportDateRangeModal);
    document.getElementById('show-transfer-modal-btn')?.addEventListener('click', showTransferModal);

    renderPendingTransfers(); // (Crearemos esta función más adelante)
    updateDashboardView();
    renderCartera();
    renderTopClientes();
}

// NUEVA FUNCIÓN en app.js
function showTransferModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    // Opciones para origen y destino (excluyendo la seleccionada)
    const origenOptions = METODOS_DE_PAGO.map(m => `<option value="${m}">${m}</option>`).join('');

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-md w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Registrar Transferencia Interna</h2>
                <button id="close-transfer-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="transfer-form" class="space-y-4">
                <div>
                    <label for="transfer-origen" class="block text-sm font-medium">Cuenta Origen</label>
                    <select id="transfer-origen" class="w-full p-2 border rounded-lg mt-1 bg-white" required>
                        <option value="">-- Seleccionar --</option>
                        ${origenOptions}
                    </select>
                </div>
                <div>
                    <label for="transfer-destino" class="block text-sm font-medium">Cuenta Destino</label>
                    <select id="transfer-destino" class="w-full p-2 border rounded-lg mt-1 bg-white" required>
                        <option value="">-- Seleccionar --</option>
                        {/* Las opciones se llenarán dinámicamente */}
                    </select>
                </div>
                <div>
                    <label for="transfer-fecha" class="block text-sm font-medium">Fecha de Transferencia</label>
                    <input type="date" id="transfer-fecha" class="w-full p-2 border rounded-lg mt-1" value="${new Date().toISOString().split('T')[0]}" required>
                </div>
                 <div>
                    <label for="transfer-amount" class="block text-sm font-medium">Monto (COP)</label>
                    <input type="text" id="transfer-amount" inputmode="numeric" class="w-full p-2 border rounded-lg mt-1" required>
                </div>
                 <div>
                    <label for="transfer-reference" class="block text-sm font-medium">Referencia (Opcional)</label>
                    <input type="text" id="transfer-reference" class="w-full p-2 border rounded-lg mt-1">
                </div>
                <button type="submit" class="w-full bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-yellow-700">Registrar Transferencia</button>
            </form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-transfer-modal').addEventListener('click', hideModal);

    const origenSelect = document.getElementById('transfer-origen');
    const destinoSelect = document.getElementById('transfer-destino');
    const amountInput = document.getElementById('transfer-amount');

    // Llenar dinámicamente las opciones de destino excluyendo el origen
    origenSelect.addEventListener('change', () => {
        const origen = origenSelect.value;
        destinoSelect.innerHTML = '<option value="">-- Seleccionar --</option>'; // Limpiar
        METODOS_DE_PAGO.forEach(m => {
            if (m !== origen) {
                destinoSelect.innerHTML += `<option value="${m}">${m}</option>`;
            }
        });
    });

    amountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    amountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    document.getElementById('transfer-form').addEventListener('submit', handleTransferSubmit);
}

async function handleTransferSubmit(e) {
    e.preventDefault();
    const origen = document.getElementById('transfer-origen').value;
    const destino = document.getElementById('transfer-destino').value;
    const amount = unformatCurrency(document.getElementById('transfer-amount').value);
    const reference = document.getElementById('transfer-reference').value;
    // --- LÍNEA AÑADIDA ---
    const fechaTransferencia = document.getElementById('transfer-fecha').value;

    if (!origen || !destino || origen === destino) { /* ... (Validaciones sin cambios) ... */ }
    if (isNaN(amount) || amount <= 0) { /* ... (Validaciones sin cambios) ... */ }
    // --- NUEVA VALIDACIÓN ---
    if (!fechaTransferencia) {
        showModalMessage("Debes seleccionar la fecha de la transferencia.");
        return;
    }

    showModalMessage("Registrando transferencia...", true);
    try {
        const recordTransfer = httpsCallable(functions, 'recordTransfer');
        await recordTransfer({
            cuentaOrigen: origen,
            cuentaDestino: destino,
            monto: amount,
            referencia: reference,
            fechaTransferencia: fechaTransferencia // <-- Enviar la fecha
        });
        hideModal();
        showTemporaryMessage("Transferencia registrada. Pendiente de confirmación.", "success");
    } catch (error) {
        console.error("Error al registrar transferencia:", error);
        showModalMessage(`Error: ${error.message}`);
    }
}


function renderPendingTransfers() {
    const container = document.getElementById('pending-transfers-list');
    const section = document.getElementById('pending-transfers-section');

    // Detener cualquier listener anterior para evitar duplicados
    if (unsubscribePendingTransfers) {
        unsubscribePendingTransfers();
        unsubscribePendingTransfers = null;
    }

    if (!container || !section || !currentUserData || currentUserData.role !== 'admin') {
        section?.classList.add('hidden');
        return; // Salir si no es admin o los elementos no existen
    }

    const q = query(collection(db, "transferencias"), where("estado", "==", "pendiente"));

    // Guardamos la función para detener el listener cuando ya no sea necesario
    unsubscribePendingTransfers = onSnapshot(q, (snapshot) => {
        const pendingTransfers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (pendingTransfers.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-500">No hay transferencias pendientes.</p>';
            section.classList.add('hidden'); // Oculta si no hay pendientes
            return;
        }

        section.classList.remove('hidden'); // Muestra la sección
        container.innerHTML = ''; // Limpia la lista

        pendingTransfers.forEach(transfer => {
            const el = document.createElement('div');
            el.className = 'border p-3 rounded-lg flex justify-between items-center';

            const canConfirm = currentUser.uid !== transfer.registradoPor;
            const confirmButton = `
                <button
                    data-transfer-id="${transfer.id}"
                    class="confirm-transfer-btn bg-green-500 text-white text-xs px-3 py-1 rounded hover:bg-green-600 ${!canConfirm ? 'opacity-50 cursor-not-allowed' : ''}"
                    ${!canConfirm ? 'disabled title="Otro administrador debe confirmar esta transferencia."' : ''}>
                    Confirmar
                </button>
            `;
            // Corrección: Asegurarse de que 'transfer.fecha' existe antes de acceder a 'seconds'
            const fechaRegistro = transfer.fechaRegistro ? new Date(transfer.fechaRegistro.seconds * 1000).toLocaleDateString() : 'Fecha no disponible';
            const fechaMostrar = transfer.fechaTransferencia || fechaRegistro;


            el.innerHTML = `
                <div>
                    <p class="font-semibold">${formatCurrency(transfer.monto)}</p>
                    <p class="text-sm text-gray-600">${transfer.cuentaOrigen} &rarr; ${transfer.cuentaDestino}</p>
                    <p class="text-xs text-gray-400">Fecha Transferencia: ${fechaMostrar}</p>
                    ${transfer.referencia ? `<p class="text-xs text-gray-500">Ref: ${transfer.referencia}</p>` : ''}
                </div>
                ${confirmButton}
            `;
            container.appendChild(el);
        });

    }, (error) => { // Manejo de errores del listener
        console.error("Error en el listener de transferencias pendientes:", error);
        container.innerHTML = '<p class="text-sm text-red-500">Error al cargar transferencias.</p>';
        section.classList.remove('hidden');
    });

    // Usar Delegación de Eventos para los botones de confirmar
    container.removeEventListener('click', handleConfirmTransferClick); // Limpiar listener previo
    container.addEventListener('click', handleConfirmTransferClick);
}

// Asegúrate de que esta función auxiliar también exista
function handleConfirmTransferClick(e) {
    const confirmButton = e.target.closest('.confirm-transfer-btn:not([disabled])');
    if (confirmButton) {
        handleConfirmTransfer(e); // Llama a la función que ya tenías
    }
}


async function handleConfirmTransfer(e) {
    const transferId = e.target.dataset.transferId;
    if (!transferId) return;

    if (!confirm("¿Estás seguro de que quieres confirmar esta transferencia? Esta acción registrará los gastos correspondientes.")) {
        return;
    }

    showModalMessage("Confirmando transferencia y registrando gastos...", true);
    try {
        const confirmTransfer = httpsCallable(functions, 'confirmTransfer');
        await confirmTransfer({ transferId: transferId });
        hideModal();
        showTemporaryMessage("¡Transferencia confirmada y gastos registrados!", "success");
        // El dashboard se actualizará automáticamente porque los gastos cambiaron
    } catch (error) {
        console.error("Error al confirmar transferencia:", error);
        showModalMessage(`Error: ${error.message}`);
    }
}

/**
 * --- VERSIÓN CORREGIDA FINAL CON CÁLCULO DE REMISIONES DIARIAS ---
 * Calcula y muestra el resumen financiero. "Ventas del Día" ahora suma
 * el valor total de las remisiones creadas en el día.
 */
async function updateDashboard(year, month) {
    if (Object.keys(initialBalances).length === 0) {
        const balanceDocRef = doc(db, "saldosIniciales", "current");
        const balanceDoc = await getDoc(balanceDocRef);
        if (balanceDoc.exists()) {
            initialBalances = balanceDoc.data();
        }
    }

    // --- INICIO DE LA CORRECCIÓN ---
    // Se añade 'T00:00:00' para evitar errores de zona horaria al comparar fechas.
    const salesThisMonth = allRemisiones.flatMap(r => r.payments || []).filter(p => { const d = new Date(p.date + 'T00:00:00'); return d.getMonth() === month && d.getFullYear() === year; }).reduce((sum, p) => sum + p.amount, 0);
    const expensesThisMonth = allGastos.filter(g => { const d = new Date(g.fecha + 'T00:00:00'); return d.getMonth() === month && d.getFullYear() === year; }).reduce((sum, g) => sum + g.valorTotal, 0);
    const carteraThisMonth = allRemisiones.filter(r => { const d = new Date(r.fechaRecibido + 'T00:00:00'); return d.getMonth() === month && d.getFullYear() === year && r.estado !== 'Anulada'; }).reduce((sum, r) => { const totalPagado = (r.payments || []).reduce((s, p) => s + p.amount, 0); const saldo = r.valorTotal - totalPagado; return sum + (saldo > 0 ? saldo : 0); }, 0);
    // --- FIN DE LA CORRECCIÓN ---

    document.getElementById('summary-sales').textContent = formatCurrency(salesThisMonth);
    document.getElementById('summary-expenses').textContent = formatCurrency(expensesThisMonth);
    document.getElementById('summary-profit').textContent = formatCurrency(salesThisMonth - expensesThisMonth);
    document.getElementById('summary-cartera').textContent = formatCurrency(carteraThisMonth);

    const totalCartera = allRemisiones.filter(r => r.estado !== 'Anulada').reduce((sum, r) => { const totalPagado = (r.payments || []).reduce((s, p) => s + p.amount, 0); const saldo = r.valorTotal - totalPagado; return sum + (saldo > 0 ? saldo : 0); }, 0);
    document.getElementById('summary-cartera-total').textContent = formatCurrency(totalCartera);

    const accountBalances = {};
    METODOS_DE_PAGO.forEach(metodo => {
        accountBalances[metodo] = initialBalances[metodo] || 0;
    });

    allRemisiones.forEach(r => (r.payments || []).forEach(p => {
        if (accountBalances[p.method] !== undefined) {
            accountBalances[p.method] += p.amount;
        }
    }));
    allGastos.forEach(g => {
        if (accountBalances[g.fuentePago] !== undefined) {
            accountBalances[g.fuentePago] -= g.valorTotal;
        }
    });

    METODOS_DE_PAGO.forEach(metodo => {
        const elementId = `summary-${metodo.toLowerCase()}`;
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = formatCurrency(accountBalances[metodo]);
        }
    });

    const now = new Date();
    const localYear = now.getFullYear();
    const localMonth = (now.getMonth() + 1).toString().padStart(2, '0');
    const localDay = now.getDate().toString().padStart(2, '0');
    const today = `${localYear}-${localMonth}-${localDay}`;

    const salesToday = allRemisiones
        .filter(r => r.fechaRecibido === today && r.estado !== 'Anulada')
        .reduce((sum, r) => sum + r.valorTotal, 0);
    document.getElementById('summary-daily-sales').textContent = formatCurrency(salesToday);

    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const labels = [];
    const salesData = [];
    const expensesData = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const m = d.getMonth();
        const y = d.getFullYear();
        labels.push(monthNames[m]);

        // --- INICIO DE LA CORRECCIÓN ---
        const monthlySales = allRemisiones.flatMap(r => r.payments || []).filter(p => { const pDate = new Date(p.date + 'T00:00:00'); return pDate.getMonth() === m && pDate.getFullYear() === y; }).reduce((sum, p) => sum + p.amount, 0);
        const monthlyExpenses = allGastos.filter(g => { const gDate = new Date(g.fecha + 'T00:00:00'); return gDate.getMonth() === m && gDate.getFullYear() === y; }).reduce((sum, g) => sum + g.valorTotal, 0);
        // --- FIN DE LA CORRECCIÓN ---

        salesData.push(monthlySales);
        expensesData.push(monthlyExpenses);
    }
    const ctx = document.getElementById('profitLossChart').getContext('2d');
    if (profitLossChart) {
        profitLossChart.destroy();
    }
    profitLossChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Ventas',
                data: salesData,
                backgroundColor: 'rgba(75, 192, 192, 0.6)'
            }, {
                label: 'Gastos',
                data: expensesData,
                backgroundColor: 'rgba(255, 99, 132, 0.6)'
            }]
        },
        options: {
            scales: { y: { beginAtZero: true } }
        }
    });
}
function calculateOverdueDays(dateString) {
    const today = new Date();
    const receivedDate = new Date(dateString);
    today.setHours(0, 0, 0, 0);
    receivedDate.setHours(0, 0, 0, 0);
    const diffTime = today - receivedDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
}

function renderCartera() {
    const carteraListEl = document.getElementById('cartera-list');
    const carteraTotalEl = document.getElementById('cartera-total');
    const pendingRemisiones = allRemisiones.filter(r => {
        if (r.estado === 'Anulada') return false;
        const totalPagado = (r.payments || []).reduce((sum, p) => sum + p.amount, 0);
        return r.valorTotal - totalPagado > 0.01;
    }).sort((a, b) => new Date(a.fechaRecibido) - new Date(b.fechaRecibido));

    carteraListEl.innerHTML = ''; // Clear previous content

    if (pendingRemisiones.length === 0) {
        carteraListEl.innerHTML = '<p class="text-center text-gray-500 py-8">¡No hay cartera pendiente!</p>';
        carteraTotalEl.innerHTML = '';
        return;
    }

    let totalCartera = 0;
    pendingRemisiones.forEach(r => {
        const totalPagado = (r.payments || []).reduce((sum, p) => sum + p.amount, 0);
        const saldoPendiente = r.valorTotal - totalPagado;
        totalCartera += saldoPendiente;
        const overdueDays = calculateOverdueDays(r.fechaRecibido);
        let overdueColor = 'text-gray-600';
        if (overdueDays > 30) overdueColor = 'text-yellow-600';
        if (overdueDays > 60) overdueColor = 'text-red-600';

        const card = document.createElement('div');
        card.className = 'bg-white p-4 rounded-lg shadow-md border border-gray-200';
        card.innerHTML = `
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                    <div class="mb-2 sm:mb-0">
                        <p class="font-bold text-gray-800">${r.clienteNombre}</p>
                        <p class="text-sm text-gray-500">Remisión N° <span class="font-mono">${r.numeroRemision}</span> &bull; Recibido: ${r.fechaRecibido}</p>
                    </div>
                    <div class="text-left sm:text-right w-full sm:w-auto">
                        <p class="text-sm text-gray-500">Saldo Pendiente</p>
                        <p class="font-bold text-xl text-red-600">${formatCurrency(saldoPendiente)}</p>
                    </div>
                </div>
                <div class="mt-2 pt-2 border-t border-gray-200 text-sm flex justify-between items-center">
                    <p><span class="font-semibold">Valor Total:</span> ${formatCurrency(r.valorTotal)}</p>
                    <p class="${overdueColor} font-semibold">${overdueDays} días de vencido</p>
                </div>
            `;
        carteraListEl.appendChild(card);
    });

    carteraTotalEl.innerHTML = `Total Cartera: <span class="text-red-600">${formatCurrency(totalCartera)}</span>`;
}

/**
 * --- VERSIÓN CON LÓGICA DE COSTEO CORREGIDA ---
 * Calcula y renderiza el costeo final. Ahora distribuye correctamente TODOS los gastos
 * adicionales (flete, seguro, nacionalización) de forma proporcional entre los ítems.
 * @param {Array} items - La lista de ítems del formulario.
 * @param {number} totalItemsCOP - El costo total de SOLO los ítems (sin flete/seguro) en COP.
 * @param {number} totalGastosAdicionalesCOP - La suma de flete, seguro y nacionalización en COP.
 * @param {number} trm - La TRM utilizada para los cálculos.
 */
function renderCosteoFinal(items, totalItemsCOP, fleteSeguroCOP, gastosVolumenCOP, gastosValorCOP, trm) {
    const container = document.getElementById('costeo-final-container');
    if (!container) return;
    container.innerHTML = '';

    if (!items || items.length === 0 || totalItemsCOP <= 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 text-center">Añade ítems y costos para ver el costeo final.</p>';
        return;
    }

    // 1. Calcular el total de cajas de la importación
    const totalCajas = items.reduce((sum, item) => {
        return sum + (item.cantidad / (item.laminasPorCaja || 1));
    }, 0);

    items.forEach(item => {
        if (item.cantidad <= 0) return;

        // Costo del ítem en origen (puesto en COP)
        const costoOrigenTotalItem = item.valorTotalItemUSD * trm;

        // 2. Distribuir gastos por VOLUMEN (basado en cajas)
        const cajasDelItem = item.cantidad / (item.laminasPorCaja || 1);
        const participacionPorCajas = totalCajas > 0 ? cajasDelItem / totalCajas : 0;
        const gastosVolumenAsignados = (fleteSeguroCOP + gastosVolumenCOP) * participacionPorCajas;

        // 3. Distribuir gastos por VALOR (basado en costo)
        const participacionPorValor = totalItemsCOP > 0 ? costoOrigenTotalItem / totalItemsCOP : 0;
        const gastosValorAsignados = gastosValorCOP * participacionPorValor;

        // 4. Calcular costo final
        const costoTotalFinal = costoOrigenTotalItem + gastosVolumenAsignados + gastosValorAsignados;
        const costoUnitarioFinal = costoTotalFinal / item.cantidad;

        const itemEl = document.createElement('div');
        itemEl.className = 'grid grid-cols-2 gap-4 text-sm border-b pb-2';
        itemEl.innerHTML = `
            <div>
                <p class="font-semibold">${item.descripcion}</p>
                <p class="text-xs text-gray-600">Cantidad: ${item.cantidad} (${cajasDelItem.toFixed(2)} cajas)</p>
            </div>
            <div class="text-right">
                <p class="font-bold text-lg text-green-700">${formatCurrency(costoUnitarioFinal)}</p>
                <p class="text-xs text-gray-600">Costo Unitario Final</p>
            </div>
        `;
        container.appendChild(itemEl);
    });
}

function renderTopClientes(startDate, endDate) {
    const container = document.getElementById('top-clientes-list');
    if (!container) return;

    let remisionesToAnalyze = allRemisiones;
    if (startDate && endDate) {
        remisionesToAnalyze = allRemisiones.filter(r => {
            const d = new Date(r.fechaRecibido);
            return d >= startDate && d <= endDate;
        });
    }

    const clientesConHistorial = allClientes.map(cliente => {
        const remisionesCliente = remisionesToAnalyze.filter(r => r.idCliente === cliente.id && r.estado !== 'Anulada');
        const totalComprado = remisionesCliente.reduce((sum, r) => sum + r.valorTotal, 0);
        return { ...cliente, totalComprado, numCompras: remisionesCliente.length };
    }).filter(c => c.numCompras > 0)
        .sort((a, b) => b.totalComprado - a.totalComprado);

    container.innerHTML = '';
    if (clientesConHistorial.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-8">No hay datos de compras de clientes para el rango seleccionado.</p>';
        return;
    }

    clientesConHistorial.forEach(cliente => {
        const el = document.createElement('div');
        el.className = 'border p-4 rounded-lg';
        el.innerHTML = `
                <div class="flex justify-between items-center">
                    <p class="font-semibold text-lg">${cliente.nombre}</p>
                    <p class="font-bold text-xl text-green-600">${formatCurrency(cliente.totalComprado)}</p>
                </div>
                <p class="text-sm text-gray-600">${cliente.numCompras} ${cliente.numCompras === 1 ? 'compra' : 'compras'}</p>
            `;
        container.appendChild(el);
    });
}


/**
 * --- NUEVA FUNCIÓN ---
 * Muestra el modal con un formulario para editar un ítem existente.
 * El campo de stock no es editable desde aquí.
 * @param {object} item - El objeto del ítem a editar.
 */
function showEditItemModal(item) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Editar Ítem: ${item.referencia}</h2>
                <button id="close-edit-item-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="edit-item-form" class="space-y-4">
                <input type="hidden" id="edit-item-id" value="${item.id}">
                <div>
                    <label class="block text-sm font-medium">Tipo (Ej: Vidrio)</label>
                    <input type="text" id="edit-item-tipo" class="w-full p-2 border rounded-lg mt-1" value="${item.tipo}" required>
                </div>
                <div>
                    <label class="block text-sm font-medium">Color (Ej: Crudo)</label>
                    <input type="text" id="edit-item-color" class="w-full p-2 border rounded-lg mt-1" value="${item.color}" required>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium">Ancho (mm)</label>
                        <input type="number" id="edit-item-ancho" class="w-full p-2 border rounded-lg mt-1" value="${item.ancho}" required>
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Alto (mm)</label>
                        <input type="number" id="edit-item-alto" class="w-full p-2 border rounded-lg mt-1" value="${item.alto}" required>
                    </div>
                </div>
                <div>
                    <label class="block text-sm font-medium">Láminas por Caja</label>
                    <input type="number" id="edit-item-laminas-por-caja" class="w-full p-2 border rounded-lg mt-1" value="${item.laminasPorCaja}" required min="1">
                </div>
                <div>
                    <label class="block text-sm font-medium">Stock Actual</label>
                    <input type="number" id="edit-item-stock" class="w-full p-2 border rounded-lg mt-1 bg-gray-200" value="${item.stock}" disabled>
                    <p class="text-xs text-gray-500 mt-1">El stock solo se puede modificar a través de importaciones y remisiones.</p>
                </div>
                <div class="flex justify-end pt-4">
                    <button type="submit" class="bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-700">Guardar Cambios</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-edit-item-modal').addEventListener('click', hideModal);
    document.getElementById('edit-item-form').addEventListener('submit', handleEditItemSubmit);
}

const modal = document.getElementById('modal');
function showModalMessage(message, isLoader = false, duration = 0) {
    const modal = document.getElementById('modal'); // <-- Se obtiene el modal aquí
    if (!modal) return; // Si no existe el modal, no hacemos nada

    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `<div id="modal-content" class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-center"></div>`;
    const modalContent = document.getElementById('modal-content');

    clearTimeout(modalTimeout);

    let contentHTML = '';
    if (isLoader) {
        contentHTML = `<svg class="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p class="mt-4 text-gray-700 font-semibold">${message}</p>`;
    } else {
        contentHTML = `<p class="text-gray-800 font-semibold mb-4">${message}</p>`;
        if (duration === 0) {
            contentHTML += `<button id="close-message-modal-btn" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Cerrar</button>`;
        }
    }

    modalContent.innerHTML = contentHTML;
    modal.classList.remove('hidden');

    if (duration > 0) {
        modalTimeout = setTimeout(hideModal, duration);
    } else if (!isLoader) {
        const closeBtn = document.getElementById('close-message-modal-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', hideModal);
        }
    }
}

/**
 * Detecta si el usuario está en un dispositivo móvil (iOS o Android).
 * @returns {boolean} - Devuelve 'true' si es un móvil, 'false' si no lo es.
 */
function isMobileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function loadScript(url) {
    return new Promise((resolve, reject) => {
        console.log(`[DEBUG] Intentando cargar script: ${url}`);
        if (document.querySelector(`script[src="${url}"]`)) {
            console.log("[DEBUG] El script ya existe en el DOM.");
            return resolve();
        }
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => {
            console.log("[DEBUG] ¡Script cargado exitosamente!");
            resolve();
        };
        script.onerror = () => {
            console.error(`[DEBUG] ERROR: No se pudo cargar el script: ${url}`);
            reject(new Error(`No se pudo cargar el script: ${url}`));
        };
        document.head.appendChild(script);
    });
}

function formatCurrency(value) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value); }
function populateDateFilters(prefix) {
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
function unformatCurrency(value) {
    if (typeof value !== 'string') return parseFloat(value) || 0;
    return parseFloat(value.replace(/[^0-9]/g, '')) || 0;
}



function formatCurrencyInput(inputElement) {
    const value = unformatCurrency(inputElement.value);
    inputElement.value = value > 0 ? formatCurrency(value) : '';
}
function unformatCurrencyInput(inputElement) {
    const value = unformatCurrency(inputElement.value);
    inputElement.value = value > 0 ? value : '';
}
function showReportDateRangeModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const now = new Date();
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    let monthOptions = '';
    for (let i = 0; i < 12; i++) {
        monthOptions += `<option value="${i}" ${i === now.getMonth() ? 'selected' : ''}>${monthNames[i]}</option>`;
    }

    let yearOptions = '';
    for (let i = 0; i < 5; i++) {
        const year = now.getFullYear() - i;
        yearOptions += `<option value="${year}">${year}</option>`;
    }

    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Seleccionar Rango del Reporte</h2>
                    <button id="close-report-range-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <form id="report-range-form" class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium">Mes de Inicio</label>
                            <select id="report-start-month" class="w-full p-2 border rounded-lg">${monthOptions}</select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium">Año de Inicio</label>
                            <select id="report-start-year" class="w-full p-2 border rounded-lg">${yearOptions}</select>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium">Mes de Fin</label>
                            <select id="report-end-month" class="w-full p-2 border rounded-lg">${monthOptions}</select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium">Año de Fin</label>
                            <select id="report-end-year" class="w-full p-2 border rounded-lg">${yearOptions}</select>
                        </div>
                    </div>
                    <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Generar Reporte</button>
                </form>
            </div>
        `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-report-range-modal').addEventListener('click', hideModal);
    document.getElementById('report-range-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const startMonth = parseInt(document.getElementById('report-start-month').value);
        const startYear = parseInt(document.getElementById('report-start-year').value);
        const endMonth = parseInt(document.getElementById('report-end-month').value);
        const endYear = parseInt(document.getElementById('report-end-year').value);

        generateSummaryPDF(startYear, startMonth, endYear, endMonth);
        hideModal();
    });
}
function generateSummaryPDF(startYear, startMonth, endYear, endMonth) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const startDate = new Date(startYear, startMonth, 1);
    const endDate = new Date(endYear, endMonth + 1, 0);

    const rangeTitle = `${monthNames[startMonth]} ${startYear} - ${monthNames[endMonth]} ${endYear}`;
    doc.setFontSize(20);
    doc.text(`Reporte Financiero: ${rangeTitle}`, 105, 20, { align: "center" });

    // Resumen del período (sin cambios)
    const salesInRange = allRemisiones.flatMap(r => r.payments || []).filter(p => { const d = new Date(p.date); return d >= startDate && d <= endDate; }).reduce((sum, p) => sum + p.amount, 0);
    const expensesInRange = allGastos.filter(g => { const d = new Date(g.fecha); return d >= startDate && d <= endDate; }).reduce((sum, g) => sum + g.valorTotal, 0);
    const profitInRange = salesInRange - expensesInRange;

    const summaryData = [
        ['Ventas Totales en el Período', formatCurrency(salesInRange)],
        ['Gastos Totales en el Período', formatCurrency(expensesInRange)],
        ['Utilidad/Pérdida Total', formatCurrency(profitInRange)],
    ];

    doc.autoTable({
        startY: 30,
        head: [['Resumen del Período', 'Valor']],
        body: summaryData,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185] }
    });

    // Desglose mensual (sin cambios)
    const monthlyData = [];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const monthName = monthNames[month];

        const monthlySales = allRemisiones.flatMap(r => r.payments || []).filter(p => { const d = new Date(p.date); return d.getMonth() === month && d.getFullYear() === year; }).reduce((sum, p) => sum + p.amount, 0);
        const monthlyExpenses = allGastos.filter(g => { const d = new Date(g.fecha); return d.getMonth() === month && d.getFullYear() === year; }).reduce((sum, g) => sum + g.valorTotal, 0);
        const monthlyProfit = monthlySales - monthlyExpenses;
        const endOfMonth = new Date(year, month + 1, 0);
        const carteraAtEndOfMonth = allRemisiones.filter(r => new Date(r.fechaRecibido) <= endOfMonth && r.estado !== 'Anulada').reduce((sum, r) => { const totalPagado = (r.payments || []).filter(p => new Date(p.date) <= endOfMonth).reduce((s, p) => s + p.amount, 0); const saldo = r.valorTotal - totalPagado; return sum + (saldo > 0 ? saldo : 0); }, 0);

        monthlyData.push([
            `${monthName} ${year}`,
            formatCurrency(monthlySales),
            formatCurrency(monthlyExpenses),
            formatCurrency(monthlyProfit),
            formatCurrency(carteraAtEndOfMonth)
        ]);
        currentDate.setMonth(currentDate.getMonth() + 1);
    }

    doc.autoTable({
        startY: doc.lastAutoTable.finalY + 10,
        head: [['Mes', 'Ventas', 'Gastos', 'Utilidad/Pérdida', 'Cartera al Cierre']],
        body: monthlyData,
        theme: 'striped',
        headStyles: { fillColor: [22, 160, 133] }
    });

    // --- INICIO DE LA CORRECCIÓN ---
    // 1. Inicializamos los saldos y calculamos dinámicamente
    const accountBalances = {};
    METODOS_DE_PAGO.forEach(metodo => accountBalances[metodo] = 0);

    allRemisiones.forEach(r => (r.payments || []).forEach(p => { if (accountBalances[p.method] !== undefined) accountBalances[p.method] += p.amount; }));
    allGastos.forEach(g => { if (accountBalances[g.fuentePago] !== undefined) accountBalances[g.fuentePago] -= g.valorTotal; });

    const totalCartera = allRemisiones.filter(r => r.estado !== 'Anulada').reduce((sum, r) => { const totalPagado = (r.payments || []).reduce((s, p) => s + p.amount, 0); const saldo = r.valorTotal - totalPagado; return sum + (saldo > 0 ? saldo : 0); }, 0);

    // 2. Generamos las filas de la tabla dinámicamente
    const accountData = METODOS_DE_PAGO.map(metodo => [metodo, formatCurrency(accountBalances[metodo])]);
    accountData.push(['Cartera Total Pendiente', formatCurrency(totalCartera)]);
    // --- FIN DE LA CORRECCIÓN ---

    doc.autoTable({
        startY: doc.lastAutoTable.finalY + 10,
        head: [['Saldos y Totales Actuales', 'Valor']],
        body: accountData,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185] }
    });

    doc.save(`Reporte-Financiero-${startYear}-${startMonth + 1}_a_${endYear}-${endMonth + 1}.pdf`);
}
function showAdminEditUserModal(user) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const userPermissions = user.permissions || {};

    let permissionsHTML = ALL_MODULES.filter(m => m !== 'empleados').map(module => {
        const isChecked = userPermissions[module] || false;
        const capitalized = module.charAt(0).toUpperCase() + module.slice(1);
        return `
                <label class="flex items-center space-x-2">
                    <input type="checkbox" class="permission-checkbox h-4 w-4 rounded border-gray-300" data-module="${module}" ${isChecked ? 'checked' : ''}>
                    <span>${capitalized}</span>
                </label>
            `;
    }).join('');

    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Gestionar Empleado: ${user.nombre}</h2>
                    <button id="close-admin-edit-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <form id="admin-edit-user-form" class="space-y-4">
                    <input type="hidden" id="admin-edit-user-id" value="${user.id}">
                    <div><label class="block text-sm font-medium">Nombre Completo</label><input type="text" id="admin-edit-name" class="w-full p-2 border rounded-lg mt-1" value="${user.nombre || ''}" required></div>
                    <div><label class="block text-sm font-medium">Correo Electrónico</label><input type="email" id="admin-edit-email" class="w-full p-2 border rounded-lg mt-1" value="${user.email || ''}" required></div>
                    <div><label class="block text-sm font-medium">Teléfono</label><input type="tel" id="admin-edit-phone" class="w-full p-2 border rounded-lg mt-1" value="${user.telefono || ''}"></div>
                    <div><label class="block text-sm font-medium">Dirección</label><input type="text" id="admin-edit-address" class="w-full p-2 border rounded-lg mt-1" value="${user.direccion || ''}"></div>
                    <div><label class="block text-sm font-medium">Fecha de Nacimiento</label><input type="date" id="admin-edit-dob" class="w-full p-2 border rounded-lg mt-1" value="${user.dob || ''}"></div>
                    <div>
                        <label class="block text-sm font-medium">Rol</label>
                    <select id="admin-edit-role-select" class="w-full p-2 border rounded-lg mt-1 bg-white">
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option>
                        <option value="planta" ${user.role === 'planta' ? 'selected' : ''}>Planta</option>
                        <option value="contabilidad" ${user.role === 'contabilidad' ? 'selected' : ''}>Contabilidad</option>
                    </select>
                    </div>
                    <div id="admin-edit-permissions-container">
                        <label class="block text-sm font-medium mb-2">Permisos de Módulos</label>
                        <div class="grid grid-cols-2 gap-2">
                            ${permissionsHTML}
                        </div>
                    </div>
                    <div class="flex justify-end pt-4">
                        <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Guardar Cambios</button>
                    </div>
                </form>
            </div>
        `;

    const roleSelect = document.getElementById('admin-edit-role-select');
    const permissionsContainer = document.getElementById('admin-edit-permissions-container');

    function togglePermissionsUI(role) {
        permissionsContainer.style.display = (role === 'admin') ? 'none' : 'block';
    }

    roleSelect.addEventListener('change', (e) => togglePermissionsUI(e.target.value));
    togglePermissionsUI(user.role);

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-admin-edit-modal').addEventListener('click', hideModal);
    document.getElementById('admin-edit-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = document.getElementById('admin-edit-user-id').value;
        const newRole = document.getElementById('admin-edit-role-select').value;
        const newPermissions = {};

        document.querySelectorAll('#admin-edit-permissions-container .permission-checkbox').forEach(cb => {
            newPermissions[cb.dataset.module] = cb.checked;
        });

        const updatedData = {
            nombre: document.getElementById('admin-edit-name').value,
            email: document.getElementById('admin-edit-email').value,
            telefono: document.getElementById('admin-edit-phone').value,
            direccion: document.getElementById('admin-edit-address').value,
            dob: document.getElementById('admin-edit-dob').value,
            role: newRole,
            permissions: (newRole === 'admin') ? {} : newPermissions
        };

        showModalMessage("Guardando cambios...", true);
        try {
            await updateDoc(doc(db, "users", userId), updatedData);
            // Note: Updating email in Firebase Auth is a sensitive operation and requires re-authentication.
            // It's safer to only update it in Firestore from an admin panel.
            hideModal();
            showModalMessage("Datos del empleado actualizados.", false, 2000);
        } catch (error) {
            console.error("Error al actualizar empleado:", error);
            showModalMessage("Error al guardar los cambios.");
        }
    });
}

/**
 * Muestra el modal para editar el perfil del usuario actual, con campos deshabilitados
 * según el rol del usuario.
 */
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

        // Objeto base con los campos que todos pueden editar
        let updatedData = {
            telefono: document.getElementById('profile-phone').value,
            direccion: document.getElementById('profile-address').value,
            email: newEmail
        };

        // Si el usuario es admin, añadir los campos restringidos
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

/**
 * Renderiza la pestaña de Contratación en el modal de RRHH, incluyendo el filtro por año.
 * @param {object} empleado - El objeto del empleado.
 * @param {HTMLElement} container - El elemento contenedor de la vista.
 */
function renderContratacionTab(empleado, container) {
    const contratacionData = empleado.contratacion || {};

    // **** LÓGICA CORREGIDA PARA OBTENER LOS AÑOS ****
    // 1. Obtener los años donde hay datos de documentos.
    const yearsWithData = Object.keys(contratacionData).filter(key => !isNaN(parseInt(key)));
    // 2. Obtener el año actual.
    const currentYear = new Date().getFullYear().toString();
    // 3. Usar un Set para combinar y eliminar duplicados, luego convertir a array y ordenar.
    const availableYears = [...new Set([currentYear, ...yearsWithData])].sort((a, b) => b - a);

    const selectedYear = availableYears[0];
    let yearOptions = availableYears.map(year => `<option value="${year}" ${year === selectedYear ? 'selected' : ''}>${year}</option>`).join('');

    container.innerHTML = `
        <form id="contratacion-form">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-4">
                    <h3 class="text-lg font-semibold border-b pb-2">Información Laboral</h3>
                    <div><label class="block text-sm font-medium">Fecha de Ingreso</label><input type="date" id="rrhh-fechaIngreso" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.fechaIngreso || ''}"></div>
                    <div><label class="block text-sm font-medium">Salario</label><input type="text" id="rrhh-salario" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.salario ? formatCurrency(contratacionData.salario) : ''}"></div>
                    <div><label class="block text-sm font-medium">EPS</label><input type="text" id="rrhh-eps" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.eps || ''}"></div>
                    <div><label class="block text-sm font-medium">AFP</label><input type="text" id="rrhh-afp" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.afp || ''}"></div>
                </div>
                <div class="space-y-4">
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center border-b pb-2 gap-2">
                        <h3 class="text-lg font-semibold">Documentos</h3>
                        <div class="flex items-center gap-2">
                            <label for="rrhh-year-filter" class="text-sm font-medium">Año:</label>
                            <select id="rrhh-year-filter" class="p-1 border rounded-lg bg-white">${yearOptions}</select>
                            <button type="button" id="download-all-docs-btn" class="bg-green-600 text-white font-bold py-1 px-3 rounded-lg hover:bg-green-700 text-sm">Descargar Todo</button>
                        </div>
                    </div>
                    <div id="rrhh-documents-list" class="border rounded-lg"></div>
                </div>
            </div>
            <div class="flex justify-end mt-6">
                <button type="submit" class="bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-700">Guardar Información</button>
            </div>
        </form>
    `;

    renderDocumentList(empleado, selectedYear);

    document.getElementById('rrhh-year-filter').addEventListener('change', (e) => {
        renderDocumentList(empleado, e.target.value);
    });

    const salarioInput = document.getElementById('rrhh-salario');
    if (salarioInput) {
        salarioInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
        salarioInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));
    }

    const contratacionForm = document.getElementById('contratacion-form');
    if (contratacionForm) {
        contratacionForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const updatedData = {
                "contratacion.fechaIngreso": document.getElementById('rrhh-fechaIngreso').value,
                "contratacion.salario": unformatCurrency(document.getElementById('rrhh-salario').value),
                "contratacion.eps": document.getElementById('rrhh-eps').value,
                "contratacion.afp": document.getElementById('rrhh-afp').value
            };
            showTemporaryMessage("Guardando datos...", "info");
            try {
                await updateDoc(doc(db, "users", empleado.id), updatedData);
                showTemporaryMessage("Datos guardados con éxito.", "success");
            } catch (error) {
                console.error("Error al guardar datos:", error);
                showTemporaryMessage("Error al guardar los datos.", "error");
            }
        });
    }

    document.getElementById('download-all-docs-btn').addEventListener('click', () => {
        const selectedYear = document.getElementById('rrhh-year-filter').value;
        downloadAllDocsAsZip(empleado, selectedYear);
    });
}


/**
 * Renderiza únicamente la lista de documentos para un año específico.
 * @param {object} empleado - El objeto del empleado.
 * @param {string} year - El año seleccionado para filtrar los documentos.
 */
function renderDocumentList(empleado, year) {
    const documentsListContainer = document.getElementById('rrhh-documents-list');
    if (!documentsListContainer) return;

    const contratacionData = empleado.contratacion || {};
    const documentosDelAnio = contratacionData[year]?.documentos || {};

    let documentsHTML = RRHH_DOCUMENT_TYPES.map(docType => {
        const docUrl = documentosDelAnio[docType.id];
        const fileInputId = `file-rrhh-${docType.id}-${empleado.id}`;
        return `
            <div class="flex justify-between items-center p-3 border-b">
                <span class="font-medium">${docType.name}</span>
                <div class="flex items-center gap-2">
                    ${docUrl ? `<button type="button" data-pdf-url="${docUrl}" data-doc-name="${docType.name}" class="view-rrhh-pdf-btn bg-blue-500 text-white px-3 py-1 rounded-lg text-sm hover:bg-blue-600">Ver</button>` : '<span class="text-xs text-gray-400">No adjunto</span>'}
                    <input type="file" id="${fileInputId}" class="hidden" accept=".pdf,.jpg,.jpeg,.png">
                    <label for="${fileInputId}" class="bg-gray-200 text-gray-700 px-3 py-1 rounded-lg text-sm font-semibold cursor-pointer hover:bg-gray-300">Adjuntar</label>
                </div>
            </div>
        `;
    }).join('');

    documentsListContainer.innerHTML = documentsHTML;

    documentsListContainer.querySelectorAll('.view-rrhh-pdf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            showPdfModal(e.currentTarget.dataset.pdfUrl, e.currentTarget.dataset.docName);
        });
    });

    RRHH_DOCUMENT_TYPES.forEach(docType => {
        const fileInput = documentsListContainer.querySelector(`#file-rrhh-${docType.id}-${empleado.id}`);
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const selectedYear = document.getElementById('rrhh-year-filter').value;
                    const docPath = `contratacion.${selectedYear}.documentos.${docType.id}`;
                    handleFileUpload(empleado.id, docPath, file);
                }
            });
        }
    });
}

function renderPagosTab(empleado, container) {
    const salario = empleado.contratacion?.salario || 0;
    const pagos = empleado.pagos || [];

    // --- INICIO DE LA CORRECCIÓN ---
    // Generamos las opciones de pago dinámicamente
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');
    // --- FIN DE LA CORRECCIÓN ---

    const pagosHTML = pagos.length > 0 ? pagos.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map(p => `
        <tr class="border-b">
            <td class="p-2">${p.fecha}</td>
            <td class="p-2">${p.motivo}</td>
            <td class="p-2 text-right">${formatCurrency(p.valor)}</td>
            <td class="p-2">${p.fuentePago}</td>
        </tr>
    `).join('') : '<tr><td colspan="4" class="p-4 text-center text-gray-500">No hay pagos registrados.</td></tr>';

    const q = query(collection(db, "prestamos"), where("employeeId", "==", empleado.id), where("status", "==", "aprobado"));
    getDocs(q).then(snapshot => {
        const prestamos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        const prestamosContainer = container.querySelector('#prestamos-pendientes-container');
        if (prestamosContainer) {
            if (prestamos.length > 0) {
                prestamosContainer.innerHTML = `
                    <h4 class="font-semibold text-md mb-2">Préstamos Pendientes de Cobro</h4>
                    <div class="space-y-2">
                        ${prestamos.map(p => `
                            <div class="bg-yellow-100 p-3 rounded-lg flex justify-between items-center">
                                <div>
                                    <p class="font-semibold">${formatCurrency(p.amount)}</p>
                                    <p class="text-xs text-yellow-800">${p.reason}</p>
                                </div>
                                <button data-loan-id="${p.id}" class="cobrar-prestamo-btn bg-yellow-500 text-white text-xs px-3 py-1 rounded-full hover:bg-yellow-600">Marcar Cancelado</button>
                            </div>
                        `).join('')}
                    </div>`;
                prestamosContainer.querySelectorAll('.cobrar-prestamo-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const loanId = e.currentTarget.dataset.loanId;
                        if (confirm("¿Estás seguro de que quieres marcar este préstamo como cancelado?")) {
                            await handleLoanAction(loanId, 'cancelado');
                        }
                    });
                });
            } else {
                prestamosContainer.innerHTML = '';
            }
        }
    });

    container.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="md:col-span-1 space-y-4">
                 <div class="bg-gray-50 p-4 rounded-lg">
                    <h3 class="text-lg font-semibold mb-2">Liquidador Horas Extra</h3>
                    <div class="space-y-2">
                        <div><label class="text-sm">Salario Base (sin auxilio)</label><input type="text" id="salario-base-he" class="w-full p-2 border bg-gray-200 rounded-lg mt-1" value="${formatCurrency(salario > 200000 ? salario - 200000 : 0)}" readonly></div>
                        <div><label for="horas-extra-input" class="text-sm">Cantidad de Horas Extra</label><input type="number" id="horas-extra-input" class="w-full p-2 border rounded-lg mt-1" min="0"></div>
                        <button id="calcular-horas-btn" class="w-full bg-blue-500 text-white font-semibold py-2 rounded-lg hover:bg-blue-600">Calcular</button>
                        <div id="horas-extra-resultado" class="text-center font-bold text-xl mt-2 p-2 bg-blue-100 rounded-lg"></div>
                    </div>
                </div>
                <div class="bg-gray-50 p-4 rounded-lg">
                    <h3 class="text-lg font-semibold mb-2">Registrar Nuevo Pago</h3>
                    <form id="rrhh-pago-form" class="space-y-3">
                        <div id="prestamos-pendientes-container" class="mb-4"></div>
                        <div><label class="text-sm">Motivo</label><select id="rrhh-pago-motivo" class="w-full p-2 border rounded-lg mt-1 bg-white"><option>Sueldo</option><option>Prima</option><option>Horas Extra</option><option>Liquidación</option></select></div>
                        <div>
                            <label class="text-sm">Valor</label>
                            <input type="text" id="rrhh-pago-valor" class="w-full p-2 border rounded-lg mt-1" required>
                            <p id="pago-sugerido-info" class="text-xs text-gray-500 mt-1 hidden">Valor quincenal sugerido (salario/2 - aportes).</p>
                        </div>
                        <div><label class="text-sm">Fecha</label><input type="date" id="rrhh-pago-fecha" class="w-full p-2 border rounded-lg mt-1" value="${new Date().toISOString().split('T')[0]}" required></div>
                        <div><label class="text-sm">Fuente de Pago</label><select id="rrhh-pago-fuente" class="w-full p-2 border rounded-lg mt-1 bg-white">${metodosDePagoHTML}</select></div>
                        <button type="submit" class="w-full bg-green-600 text-white font-semibold py-2 rounded-lg hover:bg-green-700">Registrar Pago</button>
                    </form>
                </div>
            </div>
            <div class="md:col-span-2">
                <h3 class="text-lg font-semibold mb-2">Historial de Pagos</h3>
                <div class="border rounded-lg max-h-96 overflow-y-auto">
                    <table class="w-full text-sm">
                        <thead class="bg-gray-100"><tr><th class="p-2 text-left">Fecha</th><th class="p-2 text-left">Motivo</th><th class="p-2 text-right">Valor</th><th class="p-2 text-left">Fuente</th></tr></thead>
                        <tbody id="rrhh-pagos-historial">${pagosHTML}</tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    const valorPagoInput = document.getElementById('rrhh-pago-valor');
    const motivoPagoSelect = document.getElementById('rrhh-pago-motivo');
    const pagoSugeridoInfo = document.getElementById('pago-sugerido-info');

    valorPagoInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    valorPagoInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    motivoPagoSelect.addEventListener('change', (e) => {
        if (e.target.value === 'Sueldo') {
            if (salario > 0) {
                const pagoQuincenal = (salario / 2) - 56940;
                valorPagoInput.value = pagoQuincenal > 0 ? pagoQuincenal : 0;
                formatCurrencyInput(valorPagoInput);
                pagoSugeridoInfo.classList.remove('hidden');
            } else {
                valorPagoInput.value = '';
                valorPagoInput.placeholder = 'Definir salario primero';
                pagoSugeridoInfo.classList.add('hidden');
            }
        } else {
            valorPagoInput.value = '';
            valorPagoInput.placeholder = '';
            pagoSugeridoInfo.classList.add('hidden');
        }
    });

    motivoPagoSelect.dispatchEvent(new Event('change'));

    document.getElementById('calcular-horas-btn').addEventListener('click', () => {
        const horas = parseFloat(document.getElementById('horas-extra-input').value) || 0;
        if (salario > 0) {
            const salarioBase = salario > 200000 ? salario - 200000 : salario;
            const valorHoraNormal = salarioBase / 240;
            const valorHoraExtra = valorHoraNormal * 1.25;
            const totalPagar = valorHoraExtra * horas;
            document.getElementById('horas-extra-resultado').textContent = formatCurrency(totalPagar);
        } else {
            document.getElementById('horas-extra-resultado').textContent = "Salario no definido.";
        }
    });

    document.getElementById('rrhh-pago-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nuevoPago = {
            motivo: document.getElementById('rrhh-pago-motivo').value,
            valor: unformatCurrency(document.getElementById('rrhh-pago-valor').value),
            fecha: document.getElementById('rrhh-pago-fecha').value,
            fuentePago: document.getElementById('rrhh-pago-fuente').value,
            timestamp: new Date().toISOString()
        };

        if (nuevoPago.valor <= 0) {
            showModalMessage("El valor del pago debe ser mayor a cero.");
            return;
        }

        showModalMessage("Registrando pago...", true);
        try {
            await updateDoc(doc(db, "users", empleado.id), {
                pagos: arrayUnion(nuevoPago)
            });

            const nuevoGasto = {
                fecha: nuevoPago.fecha,
                proveedorId: empleado.id,
                proveedorNombre: `Empleado: ${empleado.nombre} (${nuevoPago.motivo})`,
                numeroFactura: `Pago RRHH`,
                valorTotal: nuevoPago.valor,
                fuentePago: nuevoPago.fuentePago,
                registradoPor: currentUser.uid,
                timestamp: new Date(),
                isEmployeePayment: true
            };
            await addDoc(collection(db, "gastos"), nuevoGasto);

            showModalMessage("Pago registrado y añadido a gastos.", false, 2500);
            e.target.reset();
            motivoPagoSelect.dispatchEvent(new Event('change'));
            const resultadoHoras = document.getElementById('horas-extra-resultado');
            if (resultadoHoras) resultadoHoras.textContent = '';
        } catch (error) {
            console.error("Error al registrar pago:", error);
            showModalMessage("Error al registrar el pago.");
        }
    });
}

function renderDescargosTab(empleado, container) {
    const descargos = empleado.descargos || [];

    const descargosHTML = descargos.length > 0
        ? descargos.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map((d, index) => `
                <div class="border p-4 rounded-lg">
                    <div class="flex justify-between items-start">
                        <div>
                            <p class="font-semibold">${d.motivo}</p>
                            <p class="text-sm text-gray-500">Fecha: ${d.fecha}</p>
                        </div>
                        <div class="flex items-center gap-2">
                            ${d.citacionUrl ? `<button type="button" data-pdf-url="${d.citacionUrl}" data-doc-name="Citación" class="view-rrhh-pdf-btn text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded-full hover:bg-blue-200">Citación</button>` : ''}
                            ${d.actaUrl ? `<button type="button" data-pdf-url="${d.actaUrl}" data-doc-name="Acta" class="view-rrhh-pdf-btn text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded-full hover:bg-blue-200">Acta</button>` : ''}
                            ${d.conclusionUrl ? `<button type="button" data-pdf-url="${d.conclusionUrl}" data-doc-name="Conclusión" class="view-rrhh-pdf-btn text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded-full hover:bg-blue-200">Conclusión</button>` : ''}
                        </div>
                    </div>
                </div>
            `).join('')
        : '<p class="text-center text-gray-500 py-4">No hay descargos registrados.</p>';

    container.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="md:col-span-1">
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <h3 class="text-lg font-semibold mb-2">Registrar Descargo</h3>
                        <form id="descargos-form" class="space-y-4">
                            <div><label for="descargo-fecha" class="text-sm font-medium">Fecha de Reunión</label><input type="date" id="descargo-fecha" class="w-full p-2 border rounded-lg mt-1" required></div>
                            <div><label for="descargo-motivo" class="text-sm font-medium">Motivo de Reunión</label><textarea id="descargo-motivo" class="w-full p-2 border rounded-lg mt-1" rows="3" required></textarea></div>
                            <div><label for="descargo-citacion" class="text-sm font-medium">Citación a descargos (PDF)</label><input type="file" id="descargo-citacion" class="w-full text-sm" accept=".pdf"></div>
                            <div><label for="descargo-acta" class="text-sm font-medium">Acta de descargos (PDF)</label><input type="file" id="descargo-acta" class="w-full text-sm" accept=".pdf"></div>
                            <div><label for="descargo-conclusion" class="text-sm font-medium">Conclusión de descargos (PDF)</label><input type="file" id="descargo-conclusion" class="w-full text-sm" accept=".pdf"></div>
                            <button type="submit" class="w-full bg-purple-600 text-white font-semibold py-2 rounded-lg hover:bg-purple-700">Guardar Descargo</button>
                        </form>
                    </div>
                </div>
                <div class="md:col-span-2">
                     <h3 class="text-lg font-semibold mb-2">Historial de Descargos</h3>
                     <div class="space-y-3">${descargosHTML}</div>
                </div>
            </div>
        `;

    document.querySelectorAll('.view-rrhh-pdf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const pdfUrl = e.currentTarget.dataset.pdfUrl;
            const docName = e.currentTarget.dataset.docName;
            showPdfModal(pdfUrl, docName);
        });
    });

    document.getElementById('descargos-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fecha = document.getElementById('descargo-fecha').value;
        const motivo = document.getElementById('descargo-motivo').value;
        const citacionFile = document.getElementById('descargo-citacion').files[0];
        const actaFile = document.getElementById('descargo-acta').files[0];
        const conclusionFile = document.getElementById('descargo-conclusion').files[0];

        showModalMessage("Guardando descargo y subiendo archivos...", true);

        try {
            const timestamp = Date.now();
            const uploadPromises = [];
            const fileData = {};

            if (citacionFile) {
                const citacionRef = ref(storage, `empleados/${empleado.id}/descargos/${timestamp}_citacion.pdf`);
                uploadPromises.push(uploadBytes(citacionRef, citacionFile).then(snap => getDownloadURL(snap.ref)).then(url => fileData.citacionUrl = url));
            }
            if (actaFile) {
                const actaRef = ref(storage, `empleados/${empleado.id}/descargos/${timestamp}_acta.pdf`);
                uploadPromises.push(uploadBytes(actaRef, actaFile).then(snap => getDownloadURL(snap.ref)).then(url => fileData.actaUrl = url));
            }
            if (conclusionFile) {
                const conclusionRef = ref(storage, `empleados/${empleado.id}/descargos/${timestamp}_conclusion.pdf`);
                uploadPromises.push(uploadBytes(conclusionRef, conclusionFile).then(snap => getDownloadURL(snap.ref)).then(url => fileData.conclusionUrl = url));
            }

            await Promise.all(uploadPromises);

            const nuevoDescargo = {
                fecha,
                motivo,
                ...fileData,
                timestamp: new Date().toISOString()
            };

            await updateDoc(doc(db, "users", empleado.id), {
                descargos: arrayUnion(nuevoDescargo)
            });

            e.target.reset();
            showModalMessage("Descargo registrado con éxito.", false, 2000);

        } catch (error) {
            console.error("Error al registrar descargo:", error);
            showModalMessage("Error al guardar el descargo.");
        }
    });
}

/**
 * Renderiza la pestaña de Préstamos en el modal de RRHH, incluyendo los filtros.
 * @param {object} empleado - El objeto del empleado.
 * @param {HTMLElement} container - El elemento contenedor de la vista.
 */
function renderPrestamosTab(empleado, container) {
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let monthOptions = monthNames.map((month, i) => `<option value="${i}" ${i === currentMonth ? 'selected' : ''}>${month}</option>`).join('');
    let yearOptions = '';
    for (let i = 0; i < 5; i++) {
        const year = currentYear - i;
        yearOptions += `<option value="${year}">${year}</option>`;
    }

    container.innerHTML = `
        <div class="space-y-4">
            <div class="bg-gray-50 p-3 rounded-lg border">
                <h3 class="font-semibold mb-2">Filtrar Préstamos</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium mb-1">Filtrar por Mes</label>
                        <div class="flex gap-2">
                            <select id="loan-month-filter" class="p-2 border rounded-lg bg-white w-full">${monthOptions}</select>
                            <select id="loan-year-filter" class="p-2 border rounded-lg bg-white w-full">${yearOptions}</select>
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-1">Filtrar por Rango</label>
                        <div class="flex gap-2 items-center">
                            <input type="date" id="loan-start-date" class="p-2 border rounded-lg w-full">
                            <span class="text-gray-500">-</span>
                            <input type="date" id="loan-end-date" class="p-2 border rounded-lg w-full">
                        </div>
                    </div>
                </div>
            </div>
            <div>
                <h3 class="text-lg font-semibold mb-2">Solicitudes de Préstamo</h3>
                <div id="rrhh-prestamos-list" class="space-y-3">Cargando...</div>
            </div>
        </div>
    `;

    const monthFilter = document.getElementById('loan-month-filter');
    const yearFilter = document.getElementById('loan-year-filter');
    const startDateFilter = document.getElementById('loan-start-date');
    const endDateFilter = document.getElementById('loan-end-date');

    const filterLoans = async () => {
        const startDate = startDateFilter.value;
        const endDate = endDateFilter.value;
        const month = monthFilter.value;
        const year = yearFilter.value;
        let prestamosQuery;

        if (startDate && endDate) {
            // Filtro por rango
            prestamosQuery = query(
                collection(db, "prestamos"),
                where("employeeId", "==", empleado.id),
                where("requestDate", ">=", startDate),
                where("requestDate", "<=", endDate)
            );
        } else {
            // Filtro por mes (calcula el primer y último día del mes)
            const firstDay = new Date(year, month, 1).toISOString().split('T')[0];
            const lastDay = new Date(year, parseInt(month) + 1, 0).toISOString().split('T')[0];
            prestamosQuery = query(
                collection(db, "prestamos"),
                where("employeeId", "==", empleado.id),
                where("requestDate", ">=", firstDay),
                where("requestDate", "<=", lastDay)
            );
        }

        const snapshot = await getDocs(prestamosQuery);
        const prestamos = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
        renderLoanList(prestamos);
    };

    // Listeners para los filtros
    monthFilter.addEventListener('change', () => {
        startDateFilter.value = '';
        endDateFilter.value = '';
        filterLoans();
    });
    yearFilter.addEventListener('change', () => {
        startDateFilter.value = '';
        endDateFilter.value = '';
        filterLoans();
    });
    endDateFilter.addEventListener('change', () => {
        if (startDateFilter.value) {
            monthFilter.value = now.getMonth(); // Resetea el filtro de mes
            yearFilter.value = now.getFullYear();
            filterLoans();
        }
    });

    // Carga inicial de préstamos para el mes actual
    filterLoans();
}

/**
 * Renderiza la lista de préstamos en el contenedor.
 * @param {Array} prestamos - La lista de préstamos a renderizar.
 */
function renderLoanList(prestamos) {
    const prestamosListEl = document.getElementById('rrhh-prestamos-list');
    if (!prestamosListEl) return;

    if (prestamos.length === 0) {
        prestamosListEl.innerHTML = '<p class="text-center text-gray-500 py-4">No se encontraron préstamos para el filtro seleccionado.</p>';
        return;
    }
    prestamosListEl.innerHTML = '';
    prestamos.forEach(p => {
        const el = document.createElement('div');
        el.className = 'border p-3 rounded-lg';

        let statusBadge = '';
        let actions = '';
        switch (p.status) {
            case 'solicitado':
                statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Solicitado</span>`;
                actions = `
                    <button data-loan-json='${JSON.stringify(p)}' class="approve-loan-btn bg-green-500 text-white text-xs px-3 py-1 rounded-full hover:bg-green-600">Aprobar</button>
                    <button data-loan-id="${p.id}" data-action="denegado" class="loan-action-btn bg-red-500 text-white text-xs px-3 py-1 rounded-full hover:bg-red-600">Denegar</button>
                `;
                break;
            case 'aprobado':
                statusBadge = `<span class="text-xs font-semibold bg-blue-200 text-blue-800 px-2 py-1 rounded-full">Aprobado</span>`;
                break;
            case 'cancelado':
                statusBadge = `<span class="text-xs font-semibold bg-gray-200 text-gray-800 px-2 py-1 rounded-full">Cancelado</span>`;
                break;
        }
        el.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                <div>
                    <p class="font-bold text-lg">${formatCurrency(p.amount)}</p>
                    <p class="text-sm text-gray-600">${p.reason}</p>
                    <p class="text-xs text-gray-400">Solicitado el: ${p.requestDate}</p>
                </div>
                <div class="flex items-center gap-2 mt-2 sm:mt-0">
                    ${statusBadge}
                    ${actions}
                </div>
            </div>
        `;
        prestamosListEl.appendChild(el);
    });

    prestamosListEl.querySelectorAll('.approve-loan-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showApproveLoanModal(JSON.parse(e.currentTarget.dataset.loanJson)));
    });
    prestamosListEl.querySelectorAll('.loan-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleLoanAction(e.currentTarget.dataset.loanId, e.currentTarget.dataset.action));
    });
}

function showRRHHModal(empleado) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    let unsubscribe;
    let currentEmpleadoData = empleado;

    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl w-full max-w-5xl mx-auto text-left flex flex-col" style="max-height: 90vh;">
                <div class="flex justify-between items-center p-4 border-b">
                    <h2 class="text-xl font-semibold">Recursos Humanos: ${empleado.nombre}</h2>
                    <button id="close-rrhh-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <div class="border-b border-gray-200">
                    <nav class="-mb-px flex space-x-6 px-6">
                        <button id="rrhh-tab-contratacion" class="dashboard-tab-btn active py-3 px-1 font-semibold">Datos y Contratación</button>
                        <button id="rrhh-tab-pagos" class="dashboard-tab-btn py-3 px-1 font-semibold">Pagos y Liquidaciones</button>
                        <button id="rrhh-tab-descargos" class="dashboard-tab-btn py-3 px-1 font-semibold">Descargos</button>
                        <button id="rrhh-tab-prestamos" class="dashboard-tab-btn py-3 px-1 font-semibold">Préstamos</button>
                    </nav>
                </div>
                <div class="p-6 overflow-y-auto flex-grow">
                    <div id="rrhh-view-contratacion"></div>
                    <div id="rrhh-view-pagos" class="hidden"></div>
                    <div id="rrhh-view-descargos" class="hidden"></div>
                    <div id="rrhh-view-prestamos" class="hidden"></div>
                </div>
            </div>
        `;
    document.getElementById('modal').classList.remove('hidden');

    const closeBtn = document.getElementById('close-rrhh-modal');
    closeBtn.addEventListener('click', () => {
        if (unsubscribe) unsubscribe();
        hideModal();
    });

    const contratacionTab = document.getElementById('rrhh-tab-contratacion');
    const pagosTab = document.getElementById('rrhh-tab-pagos');
    const descargosTab = document.getElementById('rrhh-tab-descargos');
    const prestamosTab = document.getElementById('rrhh-tab-prestamos');
    const contratacionView = document.getElementById('rrhh-view-contratacion');
    const pagosView = document.getElementById('rrhh-view-pagos');
    const descargosView = document.getElementById('rrhh-view-descargos');
    const prestamosView = document.getElementById('rrhh-view-prestamos');

    const tabs = [contratacionTab, pagosTab, descargosTab, prestamosTab];
    const views = [contratacionView, pagosView, descargosView, prestamosView];

    const switchRrhhTab = (activeIndex) => {
        tabs.forEach((tab, index) => tab.classList.toggle('active', index === activeIndex));
        views.forEach((view, index) => view.classList.toggle('hidden', index !== activeIndex));
    };

    contratacionTab.addEventListener('click', () => switchRrhhTab(0));
    pagosTab.addEventListener('click', () => switchRrhhTab(1));
    descargosTab.addEventListener('click', () => switchRrhhTab(2));
    prestamosTab.addEventListener('click', () => switchRrhhTab(3));

    unsubscribe = onSnapshot(doc(db, "users", empleado.id), (docSnapshot) => {
        if (docSnapshot.exists() && document.getElementById('close-rrhh-modal')) {
            currentEmpleadoData = { id: docSnapshot.id, ...docSnapshot.data() };
            renderContratacionTab(currentEmpleadoData, contratacionView);
            renderPagosTab(currentEmpleadoData, pagosView);
            renderDescargosTab(currentEmpleadoData, descargosView);
            renderPrestamosTab(currentEmpleadoData, prestamosView);
        }
    });
}

async function downloadAllDocsAsZip(empleado) {
    const documentos = empleado.contratacion?.documentos;
    if (!documentos || Object.keys(documentos).length === 0) {
        showModalMessage("Este empleado no tiene documentos para descargar.");
        return;
    }

    showModalMessage("Preparando descarga... Esto puede tardar unos segundos.", true);

    try {
        const zip = new JSZip();
        const promises = [];

        for (const docType in documentos) {
            const url = documentos[docType];
            if (url) {
                const promise = fetch(url)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        return response.blob();
                    })
                    .then(blob => {
                        const docInfo = RRHH_DOCUMENT_TYPES.find(d => d.id === docType);
                        const docName = docInfo ? docInfo.name.replace(/ /g, '_') : docType;

                        let fileExtension = 'pdf'; // default
                        try {
                            const urlPath = new URL(url).pathname;
                            const extensionMatch = urlPath.match(/\.([^.]+)$/);
                            if (extensionMatch) {
                                fileExtension = extensionMatch[1].split('?')[0];
                            } else {
                                fileExtension = blob.type.split('/')[1] || 'pdf';
                            }
                        } catch (e) {
                            console.warn("No se pudo analizar la URL para la extensión, usando el tipo de blob.", e);
                            fileExtension = blob.type.split('/')[1] || 'pdf';
                        }

                        zip.file(`${docName}.${fileExtension}`, blob);
                    })
                    .catch(error => {
                        console.error(`No se pudo descargar el archivo para ${docType}:`, error);
                        zip.file(`ERROR_${docType}.txt`, `No se pudo descargar el archivo desde la URL.\nError: ${error.message}`);
                    });
                promises.push(promise);
            }
        }

        await Promise.all(promises);

        zip.generateAsync({ type: "blob" }).then(function (content) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(content);
            a.download = `documentos_${empleado.nombre.replace(/ /g, '_')}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            hideModal();
        });
    } catch (error) {
        console.error("Error al crear el archivo zip:", error);
        showModalMessage("Error al crear el archivo ZIP.");
    }
}

function showDiscountModal(remision) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    // ELIMINAMOS la siguiente línea que calculaba el 5%
    // const maxDiscount = remision.subtotal * 0.05;

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Aplicar Descuento</h2>
                <button id="close-discount-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <p class="text-sm text-gray-600 mb-2">Remisión N°: <span class="font-bold">${remision.numeroRemision}</span></p>
            <p class="text-sm text-gray-600 mb-4">Subtotal: <span class="font-bold">${formatCurrency(remision.subtotal)}</span></p>
            <form id="discount-form" class="space-y-4">
                <div>
                    <label for="discount-amount" class="block text-sm font-medium">Valor del Descuento (COP)</label>
                    <input type="text" id="discount-amount" class="w-full p-2 border rounded-lg mt-1" inputmode="numeric" required placeholder="Ej: 10000">
                    </div>
                <button type="submit" class="w-full bg-cyan-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-cyan-700">Aplicar Descuento</button>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-discount-modal').addEventListener('click', hideModal);

    const amountInput = document.getElementById('discount-amount');
    amountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    amountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    document.getElementById('discount-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const discountAmount = unformatCurrency(amountInput.value);

        if (isNaN(discountAmount) || discountAmount <= 0) {
            showModalMessage("Por favor, ingresa un valor de descuento válido.");
            return;
        }

        // ELIMINAMOS la validación que comprobaba si el descuento superaba el límite
        // if (discountAmount > maxDiscount) { ... }

        const discountPercentage = (discountAmount / remision.subtotal) * 100;

        showModalMessage("Aplicando descuento...", true);
        const applyDiscountFn = httpsCallable(functions, 'applyDiscount');
        try {
            const result = await applyDiscountFn({ remisionId: remision.id, discountPercentage: discountPercentage });
            if (result.data.success) {
                hideModal();
                showModalMessage("¡Descuento aplicado con éxito!", false, 2000);
            } else {
                throw new Error(result.data.message || 'Error desconocido');
            }
        } catch (error) {
            console.error("Error al aplicar descuento:", error);
            showModalMessage(`Error: ${error.message}`);
        }
    });
}

/**
 * --- FUNCIÓN RESTAURADA ---
 * Muestra el modal para registrar los datos de una factura
 * y marcar una remisión como 'facturado'.
 * @param {string} remisionId - El ID de la remisión a facturar.
 */
function showFacturaModal(remisionId) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-md w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Registrar Factura</h2>
                <button id="close-factura-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="factura-form" class="space-y-4">
                <div>
                    <label for="factura-numero" class="block text-sm font-medium">Número de Factura</label>
                    <input type="text" id="factura-numero" class="w-full p-2 border rounded-lg mt-1" required>
                </div>
                <div>
                    <label for="factura-pdf" class="block text-sm font-medium">Adjuntar PDF de la Factura</label>
                    <input type="file" id="factura-pdf" class="w-full p-2 border rounded-lg mt-1" accept=".pdf" required>
                </div>
                <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Marcar como Facturado</button>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-factura-modal').addEventListener('click', hideModal);

    document.getElementById('factura-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const numeroFactura = document.getElementById('factura-numero').value;
        const fileInput = document.getElementById('factura-pdf');
        const file = fileInput.files[0];

        if (!file) {
            showModalMessage("Debes seleccionar un archivo PDF.");
            return;
        }

        showModalMessage("Subiendo factura y actualizando...", true);
        try {
            // --- INICIO DE LA CORRECCIÓN ---
            // 1. Se define la ruta del archivo en lugar de la URL
            const storagePath = `facturas/${remisionId}-${file.name}`;
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, file);

            // 2. Se guarda la ruta (facturaPdfPath) en la base de datos
            await updateDoc(doc(db, "remisiones", remisionId), {
                facturado: true,
                numeroFactura: numeroFactura,
                facturaPdfPath: storagePath, // <-- CAMBIO CLAVE
                fechaFacturado: new Date()
            });
            // --- FIN DE LA CORRECCIÓN ---

            hideModal();
            showTemporaryMessage("¡Remisión facturada con éxito!", "success");
        } catch (error) {
            console.error("Error al facturar:", error);
            showModalMessage("Error al procesar la factura.");
        }
    });
}

// +++ NUEVA FUNCIÓN: Muestra el modal de solicitud de préstamo +++
function showLoanRequestModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    modalContentWrapper.innerHTML = `
            <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Solicitud de Préstamo</h2>
                    <button id="close-loan-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <form id="loan-request-form" class="space-y-4 mb-6">
                    <div>
                        <label for="loan-amount" class="block text-sm font-medium">Monto a Solicitar</label>
                        <input type="text" id="loan-amount" class="w-full p-2 border rounded-lg mt-1" inputmode="numeric" required>
                    </div>
                    <div>
                        <label for="loan-reason" class="block text-sm font-medium">Motivo</label>
                        <textarea id="loan-reason" class="w-full p-2 border rounded-lg mt-1" rows="3" required></textarea>
                    </div>
                    <button type="submit" class="w-full bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-yellow-700">Enviar Solicitud</button>
                </form>
                <div>
                    <h3 class="text-lg font-semibold border-t pt-4">Mis Solicitudes</h3>
                    <div id="my-loans-list" class="space-y-2 mt-2 max-h-60 overflow-y-auto">Cargando...</div>
                </div>
            </div>
        `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-loan-modal').addEventListener('click', hideModal);

    const amountInput = document.getElementById('loan-amount');
    amountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    amountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    document.getElementById('loan-request-form').addEventListener('submit', handleLoanRequestSubmit);

    // Cargar historial de préstamos del usuario
    const loansListEl = document.getElementById('my-loans-list');
    // CORRECCIÓN: Se elimina el orderBy para evitar el error de índice.
    const q = query(collection(db, "prestamos"), where("employeeId", "==", currentUser.uid));
    onSnapshot(q, (snapshot) => {
        const prestamos = snapshot.docs.map(d => d.data());

        // CORRECCIÓN: Se ordena manualmente después de recibir los datos.
        prestamos.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));

        if (prestamos.length === 0) {
            loansListEl.innerHTML = '<p class="text-center text-gray-500 py-4">No tienes solicitudes de préstamo.</p>';
            return;
        }
        loansListEl.innerHTML = '';
        prestamos.forEach(p => {
            const el = document.createElement('div');
            el.className = 'border p-3 rounded-lg flex justify-between items-center';
            let statusBadge = '';
            switch (p.status) {
                case 'solicitado': statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Solicitado</span>`; break;
                case 'aprobado': statusBadge = `<span class="text-xs font-semibold bg-blue-200 text-blue-800 px-2 py-1 rounded-full">Aprobado</span>`; break;
                case 'cancelado': statusBadge = `<span class="text-xs font-semibold bg-gray-200 text-gray-800 px-2 py-1 rounded-full">Cancelado</span>`; break;
                case 'denegado': statusBadge = `<span class="text-xs font-semibold bg-red-200 text-red-800 px-2 py-1 rounded-full">Denegado</span>`; break;
            }
            el.innerHTML = `
                    <div>
                        <p class="font-bold">${formatCurrency(p.amount)}</p>
                        <p class="text-xs text-gray-500">${p.requestDate}</p>
                    </div>
                    ${statusBadge}
                `;
            loansListEl.appendChild(el);
        });
    });
}

// +++ NUEVA FUNCIÓN: Maneja el envío de la solicitud de préstamo +++
async function handleLoanRequestSubmit(e) {
    e.preventDefault();
    const amount = unformatCurrency(document.getElementById('loan-amount').value);
    const reason = document.getElementById('loan-reason').value;

    if (amount <= 0) {
        showModalMessage("El monto debe ser mayor a cero.");
        return;
    }

    const newLoan = {
        employeeId: currentUser.uid,
        employeeName: currentUserData.nombre,
        amount: amount,
        reason: reason,
        requestDate: new Date().toISOString().split('T')[0],
        status: 'solicitado' // Estados: solicitado, aprobado, denegado, cancelado
    };

    showModalMessage("Enviando solicitud...", true);
    try {
        await addDoc(collection(db, "prestamos"), newLoan);
        hideModal();
        showModalMessage("¡Solicitud enviada con éxito!", false, 2000);
    } catch (error) {
        console.error("Error al solicitar préstamo:", error);
        showModalMessage("Error al enviar la solicitud.");
    }
}

// +++ NUEVA FUNCIÓN: Muestra el modal para aprobar un préstamo y seleccionar el método de pago +++
function showApproveLoanModal(loan) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    // --- INICIO DE LA CORRECCIÓN ---
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');
    // --- FIN DE LA CORRECCIÓN ---

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-left">
            <h2 class="text-xl font-semibold mb-4">Aprobar Préstamo</h2>
            <p class="mb-1"><span class="font-semibold">Empleado:</span> ${loan.employeeName}</p>
            <p class="mb-4"><span class="font-semibold">Monto:</span> ${formatCurrency(loan.amount)}</p>
            <form id="approve-loan-form">
                <div>
                    <label for="loan-payment-method" class="block text-sm font-medium">Fuente del Pago</label>
                    <select id="loan-payment-method" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-white" required>
                        ${metodosDePagoHTML}
                    </select>
                </div>
                <div class="flex gap-4 justify-end pt-4 mt-4 border-t">
                    <button type="button" id="cancel-approve-btn" class="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-semibold">Cancelar</button>
                    <button type="submit" class="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold">Confirmar Aprobación</button>
                </div>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('cancel-approve-btn').addEventListener('click', hideModal);
    document.getElementById('approve-loan-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const paymentMethod = document.getElementById('loan-payment-method').value;
        handleApproveLoan(loan, paymentMethod);
    });
}

// +++ NUEVA FUNCIÓN: Aprueba el préstamo y lo registra como gasto +++
/**
* Aprueba el préstamo, lo registra como gasto Y lo añade al historial de pagos del empleado.
* @param {object} loan - El objeto del préstamo.
* @param {string} paymentMethod - El método de pago seleccionado.
*/
/**
 * Aprueba el préstamo, lo registra como gasto Y lo añade al historial de pagos del empleado.
 * Utiliza el mensaje temporal para no cerrar el modal de RRHH.
 */
/**
 * Aprueba un préstamo y usa el sistema de notificaciones temporales.
 */
async function handleApproveLoan(loan, paymentMethod) {
    showModalMessage("Procesando aprobación...", true);
    try {
        const approvalDate = new Date();
        const dateString = approvalDate.toISOString().split('T')[0];

        const nuevoGasto = {
            fecha: dateString,
            proveedorId: loan.employeeId,
            proveedorNombre: `Préstamo Aprobado: ${loan.employeeName}`,
            numeroFactura: `Préstamo RRHH`,
            valorTotal: loan.amount,
            fuentePago: paymentMethod,
            registradoPor: currentUser.uid,
            timestamp: approvalDate,
            isLoanAdvance: true
        };
        await addDoc(collection(db, "gastos"), nuevoGasto);

        const nuevoPago = {
            motivo: `Préstamo: ${loan.reason.substring(0, 30)}`,
            valor: loan.amount,
            fecha: dateString,
            fuentePago: paymentMethod,
            timestamp: approvalDate.toISOString()
        };
        await updateDoc(doc(db, "users", loan.employeeId), {
            pagos: arrayUnion(nuevoPago)
        });

        await updateDoc(doc(db, "prestamos", loan.id), {
            status: 'aprobado',
            paymentMethod: paymentMethod,
            aprobadoBy: currentUser.uid,
            aprobadoDate: dateString
        });

        hideModal(); // Cierra el modal de "cargando"
        showTemporaryMessage("Préstamo aprobado y registrado.", 'success'); // Muestra notificación

    } catch (error) {
        console.error("Error al aprobar préstamo:", error);
        hideModal();
        showModalMessage("Error al procesar la aprobación.");
    }
}


// +++ FUNCIÓN MODIFICADA: Maneja las acciones del admin sobre los préstamos +++
async function handleLoanAction(loanId, action) {
    // La aprobación ahora tiene su propio flujo, esta función maneja el resto.
    if (action === 'aprobado') return;

    showModalMessage("Actualizando préstamo...", true);
    try {
        if (action === 'denegado') {
            await deleteDoc(doc(db, "prestamos", loanId));
            showModalMessage("Préstamo denegado y eliminado.", false, 2000);
        } else { // 'cancelado'
            const updateData = {
                status: action,
                [`${action}By`]: currentUser.uid,
                [`${action}Date`]: new Date().toISOString().split('T')[0]
            };
            await updateDoc(doc(db, "prestamos", loanId), updateData);
            showModalMessage(`Préstamo marcado como ${action}.`, false, 2000);
        }
    } catch (error) {
        console.error(`Error al ${action} el préstamo:`, error);
        showModalMessage("Error al actualizar el estado del préstamo.");
    }
}

/**
 * Carga todas las solicitudes de préstamo pendientes desde Firestore.
 * Actualiza la notificación (badge) en el botón del encabezado.
 * Solo se ejecuta para administradores.
 */
function loadAllLoanRequests() {
    const q = query(collection(db, "prestamos"), where("status", "==", "solicitado"));
    return onSnapshot(q, (snapshot) => {
        allPendingLoans = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const badge = document.getElementById('header-loan-badge');
        if (badge) {
            if (allPendingLoans.length > 0) {
                badge.textContent = allPendingLoans.length;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    });
}

/**
 * Muestra el modal con la lista de todos los préstamos pendientes.
 * @param {Array} requests - La lista de solicitudes de préstamo.
 */
function showAllLoansModal(requests) {
    let requestsHTML = '';
    if (requests.length === 0) {
        requestsHTML = '<p class="text-center text-gray-500 py-4">No hay solicitudes de préstamo pendientes.</p>';
    } else {
        requests.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
        requestsHTML = requests.map(p => {
            // Buscamos al empleado en nuestra lista global para obtener su teléfono
            const empleado = allUsers.find(u => u.id === p.employeeId);
            const telefono = empleado ? empleado.telefono : 'No encontrado';

            return `
            <div class="border p-3 rounded-lg text-left">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                    <div>
                        <p class="font-bold text-gray-800">${p.employeeName}</p>
                        <p class="text-sm text-gray-500">${telefono}</p> 
                        <p class="font-bold text-lg mt-1">${formatCurrency(p.amount)}</p>
                        <p class="text-sm text-gray-600">${p.reason}</p>
                        <p class="text-xs text-gray-400">Solicitado el: ${p.requestDate}</p>
                    </div>
                    <div class="flex items-center gap-2 mt-2 sm:mt-0">
                        <button data-loan-json='${JSON.stringify(p)}' class="approve-loan-btn bg-green-500 text-white text-xs px-3 py-1 rounded-full hover:bg-green-700">Aprobar</button>
                        <button data-loan-id="${p.id}" data-action="denegado" class="loan-action-btn bg-red-500 text-white text-xs px-3 py-1 rounded-full hover:bg-red-600">Denegar</button>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-11/12 md:w-4/5 lg:w-3/4 mx-auto flex flex-col" style="max-height: 85vh;">
            <div class="flex justify-between items-center p-4 border-b">
                <h2 class="text-xl font-semibold">Solicitudes de Préstamo Pendientes</h2>
                <button id="close-all-loans-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="p-4 space-y-3 overflow-y-auto">
                ${requestsHTML}
            </div>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-all-loans-modal').addEventListener('click', hideModal);

    modalContentWrapper.querySelectorAll('.approve-loan-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showApproveLoanModal(JSON.parse(e.currentTarget.dataset.loanJson)));
    });
    modalContentWrapper.querySelectorAll('.loan-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleLoanAction(e.currentTarget.dataset.loanId, e.currentTarget.dataset.action));
    });
}
/**
 * Obtiene la TRM actual y la muestra en el formulario.
 */
async function getLiveTRM() {
    const trmDisplay = document.getElementById('importacion-trm');
    if (!trmDisplay) return 4100; // Valor por defecto si el campo no existe

    try {
        // En un entorno real, llamarías a una API. Para este ejemplo, usamos un valor fijo.
        // const response = await fetch('URL_DE_API_DE_TRM');
        // const data = await response.json();
        // const trm = data.valor;
        const trm = 4093.12; // Valor de TRM del 6 de agosto de 2025 para el ejemplo
        trmDisplay.value = trm.toFixed(2);
        return trm;
    } catch (error) {
        console.error("Error al obtener TRM:", error);
        trmDisplay.value = 'Error';
        return 4100; // Retornar un valor por defecto en caso de error
    }
}

/**
 * Calcula todos los totales de la importación en USD y COP.
 */
function calcularTotalImportacion() {
    const trm = parseFloat(document.getElementById('importacion-trm')?.value) || 4100;

    // Sumar costos en USD
    const fleteUSD = unformatCurrency(document.getElementById('importacion-flete')?.value || '0');
    const seguroUSD = unformatCurrency(document.getElementById('importacion-seguro')?.value || '0');
    let totalItemsUSD = 0;
    document.querySelectorAll('.import-item-row').forEach(row => {
        totalItemsUSD += unformatCurrency(row.querySelector('.item-valor-total')?.value || '0');
    });

    const totalUSD = fleteUSD + seguroUSD + totalItemsUSD;

    // Calcular totales en COP
    const totalCOP = totalUSD * trm;

    // Calcular abonos
    const importacionId = document.getElementById('importacion-id').value;
    const importacionActual = allImportaciones.find(i => i.id === importacionId);
    const totalAbonadoCOP = (importacionActual?.abonos || []).reduce((sum, abono) => sum + abono.valorCOP, 0);
    const totalAbonadoUSD = (importacionActual?.abonos || []).reduce((sum, abono) => sum + abono.valorUSD, 0);

    // Calcular saldos pendientes
    const saldoPendienteUSD = totalUSD - totalAbonadoUSD;
    const saldoPendienteCOP = saldoPendienteUSD * trm; // Estimado con TRM actual

    // Actualizar la interfaz
    document.getElementById('total-usd-display').textContent = `USD ${formatCurrency(totalUSD, true)}`;
    document.getElementById('total-cop-display').textContent = `~ ${formatCurrency(totalCOP)} COP`;
    document.getElementById('saldo-pendiente-display').textContent = `USD ${formatCurrency(saldoPendienteUSD, true)} (~${formatCurrency(saldoPendienteCOP)} COP)`;
}

/**
 * Calcula los días faltantes para una fecha y devuelve un estado con color.
 * @param {string} fechaLlegadaPuerto - La fecha de llegada en formato 'YYYY-MM-DD'.
 * @returns {{dias: number, text: string, color: string}} - Información de los días faltantes.
 */
function getDiasFaltantesInfo(fechaLlegadaPuerto) {
    if (!fechaLlegadaPuerto) {
        return { dias: null, text: '', color: '' };
    }
    const hoy = new Date();
    const llegada = new Date(fechaLlegadaPuerto + 'T00:00:00'); // Asegura que se interprete como local
    hoy.setHours(0, 0, 0, 0); // Ignorar la hora para la comparación

    const diffTime = llegada - hoy;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
        return { dias: diffDays, text: 'Atrasado', color: 'bg-red-500 text-white' };
    }
    if (diffDays === 0) {
        return { dias: 0, text: 'Llega Hoy', color: 'bg-yellow-400 text-black' };
    }
    if (diffDays <= 7) {
        return { dias: diffDays, text: `${diffDays} días`, color: 'bg-yellow-200 text-yellow-800' };
    }
    return { dias: diffDays, text: `${diffDays} días`, color: 'bg-gray-200 text-gray-800' };
}

/**
 * --- MODIFICADA ---
 * Ahora solo determina el estado logístico y financiero, ya que el estado de
 * la documentación se calcula por separado.
 * @param {object} importacion - El objeto de la importación.
 * @returns {{text: string, color: string}} - El estado principal a mostrar.
 */
function getImportacionStatus(importacion) {
    // Prioridad 1: Estados logísticos finales
    if (importacion.estadoLogistico === 'En Bodega') {
        return { text: 'En Bodega', color: 'bg-green-100 text-green-800' };
    }
    if (importacion.estadoLogistico === 'En Puerto') {
        return { text: 'En Puerto', color: 'bg-blue-100 text-blue-800' };
    }

    // Prioridad 2: Estado financiero
    const totalChinaUSD = importacion.totalChinaUSD || 0;
    const totalAbonadoChinaUSD = (importacion.abonos || []).reduce((sum, abono) => sum + (abono.valorUSD || 0), 0);
    if (totalChinaUSD > 0 && totalChinaUSD - totalAbonadoChinaUSD < 1) {
        return { text: 'Cancelado', color: 'bg-green-200 text-green-800' };
    }
    if (totalAbonadoChinaUSD > 0) {
        return { text: 'Con Abono', color: 'bg-yellow-100 text-yellow-800' };
    }

    // Estado por defecto
    return { text: 'Creada', color: 'bg-gray-100 text-gray-800' };
}

/**
 * Calcula los días transcurridos desde la fecha del pedido.
 * @param {string} fechaPedido - La fecha del pedido en formato 'YYYY-MM-DD'.
 * @returns {string} - El texto que describe los días de operación.
 */
function getOperationDays(fechaPedido) {
    if (!fechaPedido) {
        return '';
    }
    const hoy = new Date();
    const pedido = new Date(fechaPedido + 'T00:00:00');
    hoy.setHours(0, 0, 0, 0);

    const diffTime = hoy - pedido;
    if (diffTime < 0) {
        return ''; // El pedido es a futuro, no mostramos nada.
    }
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return 'Inició hoy';
    }
    if (diffDays === 1) {
        return '1 día en operación';
    }
    return `${diffDays} días en operación`;
}
/**
 * Actualiza el estado de una importación a "En Bodega" y la fecha de llegada a bodega.
 * @param {string} importacionId - El ID de la importación a actualizar.
 * @param {string} nuevaFecha - La nueva fecha de llegada a bodega.
 */
async function handleEstadoEnBodega(importacionId, nuevaFecha) {
    showModalMessage("Actualizando estado a 'En Bodega'...", true);
    try {
        const importacionRef = doc(db, "importaciones", importacionId);
        await updateDoc(importacionRef, {
            estadoLogistico: 'En Bodega',
            fechaLlegadaBodega: nuevaFecha
        });

        // Actualizar datos locales y refrescar el modal para mostrar los cambios
        const importacionIndex = allImportaciones.findIndex(i => i.id === importacionId);
        if (importacionIndex !== -1) {
            allImportaciones[importacionIndex].estadoLogistico = 'En Bodega';
            allImportaciones[importacionIndex].fechaLlegadaBodega = nuevaFecha;
            showImportacionModal(allImportaciones[importacionIndex]);
        }
        showTemporaryMessage("¡Estado actualizado a 'En Bodega'!", "success");

    } catch (error) {
        console.error("Error al marcar en bodega:", error);
        showModalMessage("Error al actualizar el estado.");
    }
}

/**
 * --- VERSIÓN SIMPLIFICADA ---
 * Guarda una factura de nacionalización, leyendo un único "Valor Total".
 */
async function handleSaveFacturaGasto(importacionId, gastoTipo, facturaCard) {
    const facturaId = facturaCard.dataset.facturaId;
    const proveedorId = facturaCard.querySelector('.proveedor-id-hidden').value;
    const proveedorNombre = facturaCard.querySelector('.proveedor-search-input').value;
    const numeroFactura = facturaCard.querySelector('.factura-numero-input').value;
    const valorTotal = unformatCurrency(facturaCard.querySelector('.factura-valor-total-input').value);
    const pdfFile = facturaCard.querySelector('.factura-pdf-input')?.files[0];

    if (!proveedorId || !numeroFactura || !(valorTotal > 0)) {
        showModalMessage("Debes seleccionar un proveedor, ingresar un N° de factura y un valor mayor a cero.");
        return;
    }

    showModalMessage("Guardando factura...", true);

    try {
        let pdfUrl = null;
        if (pdfFile) {
            const storagePath = `importaciones/${importacionId}/gastos_nacionalizacion/${facturaId}_${pdfFile.name}`;
            const fileRef = ref(storage, storagePath);
            const snapshot = await uploadBytes(fileRef, pdfFile);
            pdfUrl = await getDownloadURL(snapshot.ref);
        }

        const nuevaFactura = { id: facturaId, proveedorId, proveedorNombre, numeroFactura, valorTotal, pdfUrl: pdfUrl, abonos: [] };

        await runTransaction(db, async (transaction) => {
            const importacionRef = doc(db, "importaciones", importacionId);
            const importacionDoc = await transaction.get(importacionRef);
            if (!importacionDoc.exists()) throw new Error("La importación no fue encontrada.");

            const importacionActual = importacionDoc.data();
            const gastosNacionalizacion = importacionActual.gastosNacionalizacion || {};
            if (!gastosNacionalizacion[gastoTipo]) gastosNacionalizacion[gastoTipo] = { facturas: [] };
            gastosNacionalizacion[gastoTipo].facturas.push(nuevaFactura);

            let nuevoTotalNacionalizacionCOP = 0;
            Object.values(gastosNacionalizacion).forEach(gasto => {
                (gasto.facturas || []).forEach(factura => {
                    nuevoTotalNacionalizacionCOP += factura.valorTotal || 0;
                });
            });

            transaction.update(importacionRef, {
                gastosNacionalizacion,
                totalNacionalizacionCOP: nuevoTotalNacionalizacionCOP
            });

            const importacionIndex = allImportaciones.findIndex(i => i.id === importacionId);
            if (importacionIndex !== -1) {
                allImportaciones[importacionIndex].gastosNacionalizacion = gastosNacionalizacion;
                allImportaciones[importacionIndex].totalNacionalizacionCOP = nuevoTotalNacionalizacionCOP;
            }
        });

        hideModal();
        showTemporaryMessage("Factura guardada.", "success");
        const updatedImportacion = allImportaciones.find(i => i.id === importacionId);
        if (updatedImportacion) showImportacionModal(updatedImportacion);

    } catch (error) {
        console.error("Error al guardar la factura:", error);
        showModalMessage("Error al guardar: " + error.message);
    }
}


/**
 * --- NUEVA FUNCIÓN ---
 * Maneja la subida de un PDF para una factura de gasto que ya fue guardada.
 * @param {string} importacionId - El ID de la importación.
 * @param {string} gastoTipo - El tipo de gasto al que pertenece la factura.
 * @param {string} facturaId - El ID de la factura a actualizar.
 */
async function handleUpdateFacturaPdf(importacionId, gastoTipo, facturaId) {
    const facturaCard = document.querySelector(`.factura-card[data-factura-id="${facturaId}"]`);
    if (!facturaCard) {
        showModalMessage("Error: No se encontró la tarjeta de la factura.", "error");
        return;
    }

    const fileInput = facturaCard.querySelector(`#update-pdf-${facturaId}`);
    const file = fileInput.files[0];

    if (!file) {
        showModalMessage("Por favor, selecciona un archivo PDF para subir.", "error");
        return;
    }

    showModalMessage("Subiendo PDF...", true);

    try {
        const storagePath = `importaciones/${importacionId}/gastos_nacionalizacion/${facturaId}_${file.name}`;
        const fileRef = ref(storage, storagePath);
        const snapshot = await uploadBytes(fileRef, file);
        const pdfUrl = await getDownloadURL(snapshot.ref);

        const importacionRef = doc(db, "importaciones", importacionId);

        await runTransaction(db, async (transaction) => {
            const importacionDoc = await transaction.get(importacionRef);
            if (!importacionDoc.exists()) throw new Error("La importación no fue encontrada.");

            const importacionActual = importacionDoc.data();
            const gastosNacionalizacion = importacionActual.gastosNacionalizacion || {};

            const gasto = gastosNacionalizacion[gastoTipo];
            if (!gasto || !gasto.facturas) throw new Error("No se encontró el grupo de gasto.");

            const facturaIndex = gasto.facturas.findIndex(f => f.id === facturaId);
            if (facturaIndex === -1) throw new Error("No se encontró la factura para actualizar.");

            // Actualiza la URL del PDF en la factura específica
            gastosNacionalizacion[gastoTipo].facturas[facturaIndex].pdfUrl = pdfUrl;

            transaction.update(importacionRef, { gastosNacionalizacion });

            // Actualiza la caché local para que los cambios se reflejen
            const importacionIndexGlobal = allImportaciones.findIndex(i => i.id === importacionId);
            if (importacionIndexGlobal !== -1) {
                allImportaciones[importacionIndexGlobal].gastosNacionalizacion = gastosNacionalizacion;
            }
        });

        hideModal();
        showTemporaryMessage("PDF de factura guardado.", "success");

        // Refresca todo el modal para mostrar la tarjeta actualizada
        const updatedImportacion = allImportaciones.find(i => i.id === importacionId);
        if (updatedImportacion) {
            showImportacionModal(updatedImportacion);
        }

    } catch (error) {
        console.error("Error al actualizar el PDF de la factura:", error);
        showModalMessage(`Error al guardar PDF: ${error.message}`);
    }
}
/**
 * --- NUEVA FUNCIÓN OPTIMIZADA ---
 * Llama a una Cloud Function para obtener una URL segura y de corta duración
 * para un archivo en Storage y luego la abre.
 * @param {string} filePath - La ruta del archivo en Firebase Storage.
 * @param {string} remisionNum - El número de la remisión para el título del modal.
 */
async function handleViewPdf(filePath, remisionNum) {
    if (!filePath) {
        showModalMessage("Error: Esta remisión no tiene un PDF asociado.");
        return;
    }
    showModalMessage("Generando enlace seguro...", true);
    try {
        const getUrlFunction = httpsCallable(functions, 'getSignedUrlForPath');
        const result = await getUrlFunction({ path: filePath });
        const { url } = result.data;
        hideModal();
        showPdfModal(url, `Remisión N° ${remisionNum}`);
    } catch (error) {
        console.error("Error al obtener la URL del PDF:", error);
        showModalMessage("No se pudo cargar el PDF. Inténtalo de nuevo.");
    }
}

/**
 * --- NUEVA FUNCIÓN ---
 * Muestra el modal para establecer los saldos iniciales de las cuentas.
 */
async function showInitialBalanceModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    const balanceDocRef = doc(db, "saldosIniciales", "current");
    const balanceDoc = await getDoc(balanceDocRef);
    const balances = balanceDoc.exists() ? balanceDoc.data() : {};

    // --- INICIO DE LA CORRECCIÓN ---
    // Generamos dinámicamente los campos de saldo
    const balanceFieldsHTML = METODOS_DE_PAGO.map(metodo => `
        <div>
            <label class="block text-sm font-medium">${metodo}</label>
            <input type="text" id="balance-${metodo.toLowerCase()}" class="cost-input-cop w-full p-2 border rounded-lg mt-1" value="${formatCurrency(balances[metodo] || 0)}">
        </div>
    `).join('');
    // --- FIN DE LA CORRECCIÓN ---

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Establecer Saldos Iniciales</h2>
                <button id="close-balance-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <p class="text-sm text-gray-600 mb-4">Ingresa el saldo con el que inicia cada cuenta. Este valor se sumará al cálculo de movimientos para obtener el saldo actual.</p>
            <form id="initial-balance-form" class="space-y-3">
                ${balanceFieldsHTML}
                <div class="pt-4"><button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Guardar Saldos</button></div>
            </form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-balance-modal').addEventListener('click', hideModal);

    document.querySelectorAll('.cost-input-cop').forEach(input => {
        input.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
        input.addEventListener('blur', (e) => formatCurrencyInput(e.target));
    });

    document.getElementById('initial-balance-form').addEventListener('submit', handleInitialBalanceSubmit);
}

/**
 * --- VERSIÓN CORREGIDA FINAL ---
 * Corrige el error "Cannot read properties of null" al leer los valores
 * del formulario ANTES de mostrar el modal de carga.
 */
async function handleInitialBalanceSubmit(e) {
    e.preventDefault();
    const submitButton = e.target.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Guardando...';

    // --- INICIO DE LA CORRECCIÓN ---
    // Leemos los valores de los saldos dinámicamente
    const balancesToSave = {};
    METODOS_DE_PAGO.forEach(metodo => {
        const inputId = `balance-${metodo.toLowerCase()}`;
        const value = unformatCurrency(document.getElementById(inputId).value);
        balancesToSave[metodo] = value;
    });
    // --- FIN DE LA CORRECCIÓN ---

    try {
        const setBalances = httpsCallable(functions, 'setInitialBalances');
        await setBalances(balancesToSave);

        // Actualizamos la variable global
        initialBalances = balancesToSave;

        Swal.fire('¡Éxito!', 'Saldos iniciales guardados correctamente.', 'success');
        hideModal();
    } catch (error) {
        console.error("Error al guardar saldos:", error);
        Swal.fire('Error', 'No se pudieron guardar los saldos.', 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Guardar Saldos';
    }
}

// Listener para el nuevo botón de regeneración
/*document.getElementById('regenerate-urls-btn').addEventListener('click', async () => {
    if (!confirm('¿Estás seguro de que quieres regenerar TODAS las URLs de los PDFs? Este proceso puede tardar unos minutos.')) {
        return;
    }

    showModalMessage("Regenerando enlaces de todas las remisiones, por favor espera...", true);

    try {
        const regenerateFunction = httpsCallable(functions, 'regenerateAllRemisionUrls');
        const result = await regenerateFunction();

        showModalMessage(result.data.message, false, 5000); // Muestra el mensaje de éxito por 5 segundos
    } catch (error) {
        console.error("Error al regenerar URLs:", error);
        showModalMessage(`Error: ${error.message}`);
    }
});*/

// --- NUEVAS FUNCIONES PARA EXPORTAR GASTOS ---


/**
 * Muestra el modal para seleccionar el rango de fechas para exportar gastos.
 */
function showExportGastosModal() {
    const modal = document.getElementById('export-gastos-modal');
    if (modal) {
        const endDateInput = document.getElementById('export-end-date');
        if (endDateInput) {
            endDateInput.valueAsDate = new Date();
        }
        modal.classList.remove('hidden');
    }
}

/**
 * Maneja el envío del formulario de exportación, llama a la Cloud Function
 * y descarga el archivo Excel generado.
 */
async function handleExportGastos(e) {
    e.preventDefault();
    const startDate = document.getElementById('export-start-date').value;
    const endDate = document.getElementById('export-end-date').value;

    if (!startDate || !endDate) {
        showModalMessage("Por favor, selecciona ambas fechas.");
        return;
    }

    showModalMessage("Generando reporte de gastos, por favor espera...", true);

    try {
        const exportFunction = httpsCallable(functions, 'exportGastosToExcel');
        const result = await exportFunction({ startDate, endDate });

        if (result.data.success) {
            const byteCharacters = atob(result.data.fileContent);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `Reporte_Gastos_${startDate}_a_${endDate}.xlsx`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            hideModal();
            showTemporaryMessage("¡Reporte generado con éxito!", "success");
        } else {
            throw new Error(result.data.message || "No se encontraron datos para exportar.");
        }
    } catch (error) {
        console.error("Error al exportar gastos:", error);
        showModalMessage(`Error al generar el reporte: ${error.message}`);
    }
}

// Se añade un solo event listener al documento que maneja los eventos
// de los elementos que se crean dinámicamente.
document.addEventListener('click', function (event) {
    // 1. Manejar el clic en el botón de Exportar Gastos
    if (event.target && event.target.id === 'export-gastos-btn') {
        showExportGastosModal();
    }

    // 2. Manejar el clic en los botones para cerrar el modal
    const modal = event.target.closest('.modal');
    if (event.target && event.target.classList.contains('close-modal-btn') && modal) {
        modal.classList.add('hidden');
    }
});

// El listener para el formulario también usa delegación de eventos.
document.addEventListener('submit', function (event) {
    if (event.target && event.target.id === 'export-gastos-form') {
        handleExportGastos(event);
    }
});

// Escucha el evento de envío del formulario para añadir un nuevo proveedor
// Usamos 'body' y 'delegación de eventos' para asegurarnos de que el listener funcione
// incluso si el formulario se añade dinámicamente.
document.body.addEventListener('submit', async (e) => {
    if (e.target && e.target.id === 'add-cliente-form') {
        e.preventDefault();

        const nombreEmpresa = document.getElementById('nuevo-cliente-nombre-empresa').value;
        const contacto = document.getElementById('nuevo-cliente-contacto').value;
        const email = document.getElementById('nuevo-cliente-email').value;
        const telefono1 = document.getElementById('nuevo-cliente-telefono1').value;
        const telefono2 = document.getElementById('nuevo-cliente-telefono2').value;
        const nit = document.getElementById('nuevo-cliente-nit').value;
        const rutFile = document.getElementById('nuevo-cliente-rut').files[0];

        const submitButton = e.target.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.textContent = 'Registrando...';

        const clienteData = {
            nombre: nombreEmpresa, // Mantenemos 'nombre' como el campo principal para compatibilidad
            nombreEmpresa: nombreEmpresa,
            contacto: contacto,
            email: email,
            telefono1: telefono1,
            telefono2: telefono2,
            nit: nit,
            fechaCreacion: new Date()
        };

        try {
            if (rutFile) {
                const storageRef = ref(storage, `ruts_clientes/${Date.now()}-${rutFile.name}`);
                const snapshot = await uploadBytes(storageRef, rutFile);
                const downloadURL = await getDownloadURL(snapshot.ref);
                clienteData.rutUrl = downloadURL;
            }

            await addDoc(collection(db, 'clientes'), clienteData);

            Swal.fire('¡Cliente Registrado!', 'El nuevo cliente ha sido guardado con éxito.', 'success');

            e.target.reset();

        } catch (error) {
            console.error("Error al registrar cliente:", error);
            Swal.fire('Error', 'Hubo un problema al registrar el cliente.', 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Registrar';
        }
    }
});

document.body.addEventListener('submit', async (e) => {
    if (e.target && e.target.id === 'add-proveedor-form') {
        e.preventDefault();

        // Obtenemos los datos del formulario
        const nombre = document.getElementById('nuevo-proveedor-nombre').value;
        const contacto = document.getElementById('nuevo-proveedor-contacto').value;
        const telefono = document.getElementById('nuevo-proveedor-telefono').value;
        const email = document.getElementById('nuevo-proveedor-email').value;
        const rutFile = document.getElementById('nuevo-proveedor-rut').files[0];

        // Preparamos el objeto con los datos del proveedor
        const proveedorData = {
            nombre: nombre,
            contacto: contacto,
            telefono: telefono,
            email: email,
            fechaCreacion: new Date() // Guardamos la fecha de registro
        };

        const submitButton = e.target.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.textContent = 'Guardando...';

        try {
            // Si el usuario seleccionó un archivo RUT
            if (rutFile) {
                // Creamos una referencia única en Firebase Storage
                const storageRef = ref(storage, `ruts_proveedores/${Date.now()}-${rutFile.name}`);

                // Subimos el archivo
                const snapshot = await uploadBytes(storageRef, rutFile);

                // Obtenemos la URL de descarga
                const downloadURL = await getDownloadURL(snapshot.ref);

                // Añadimos la URL al objeto del proveedor
                proveedorData.rutUrl = downloadURL;
            }

            // Guardamos el proveedor en Firestore
            await addDoc(collection(db, 'proveedores'), proveedorData);

            // Mostramos una alerta de éxito
            Swal.fire('¡Éxito!', 'Proveedor registrado correctamente.', 'success');

            // Limpiamos el formulario
            e.target.reset();

        } catch (error) {
            console.error("Error al registrar el proveedor: ", error);
            Swal.fire('Error', 'No se pudo registrar el proveedor.', 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Registrar';
        }
    }
});
document.body.addEventListener('submit', async (e) => {
    if (e.target && e.target.id === 'edit-proveedor-form') {
        e.preventDefault();
        const form = e.target;
        const proveedorId = form.dataset.id;
        const submitButton = form.querySelector('button[type="submit"]');

        submitButton.disabled = true;
        submitButton.textContent = 'Guardando...';

        const updatedData = {
            nombre: form.querySelector('#edit-proveedor-nombre').value,
            contacto: form.querySelector('#edit-proveedor-contacto').value,
            telefono: form.querySelector('#edit-proveedor-telefono').value,
            email: form.querySelector('#edit-proveedor-email').value,
        };

        const rutFile = form.querySelector('#edit-proveedor-rut')?.files[0];

        try {
            // Si se seleccionó un nuevo archivo RUT
            if (rutFile) {
                // Primero, verificamos si ya existía un RUT para borrarlo
                const proveedorDoc = await getDoc(doc(db, 'proveedores', proveedorId));
                const proveedorActual = proveedorDoc.data();
                if (proveedorActual.rutUrl) {
                    try {
                        const oldFileRef = ref(storage, proveedorActual.rutUrl);
                        await deleteObject(oldFileRef);
                    } catch (storageError) {
                        console.warn("No se pudo eliminar el archivo antiguo, puede que ya no exista:", storageError);
                    }
                }

                // Subimos el nuevo archivo
                const newStorageRef = ref(storage, `ruts_proveedores/${Date.now()}-${rutFile.name}`);
                const snapshot = await uploadBytes(newStorageRef, rutFile);
                updatedData.rutUrl = await getDownloadURL(snapshot.ref);
            }

            // Actualizamos los datos en Firestore
            await updateDoc(doc(db, 'proveedores', proveedorId), updatedData);

            Swal.fire('¡Éxito!', 'Proveedor actualizado correctamente.', 'success');
            document.getElementById('modal').classList.add('hidden');

        } catch (error) {
            console.error("Error al actualizar proveedor: ", error);
            Swal.fire('Error', 'No se pudo actualizar el proveedor.', 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Guardar Cambios';
        }
    }
});
document.body.addEventListener('submit', async (e) => {
    if (e.target && e.target.id === 'edit-cliente-form') {
        e.preventDefault();
        const form = e.target;
        const clienteId = form.dataset.id;
        const submitButton = form.querySelector('button[type="submit"]');

        submitButton.disabled = true;
        submitButton.textContent = 'Guardando...';

        const nombreEmpresa = form.querySelector('#edit-cliente-nombre-empresa').value;

        const updatedData = {
            nombre: nombreEmpresa, // Actualizamos el campo principal
            nombreEmpresa: nombreEmpresa,
            contacto: form.querySelector('#edit-cliente-contacto').value,
            email: form.querySelector('#edit-cliente-email').value,
            telefono1: form.querySelector('#edit-cliente-telefono1').value,
            telefono2: form.querySelector('#edit-cliente-telefono2').value,
            nit: form.querySelector('#edit-cliente-nit').value,
        };

        const rutFile = form.querySelector('#edit-cliente-rut')?.files[0];

        try {
            if (rutFile) {
                const clienteDoc = await getDoc(doc(db, 'clientes', clienteId));
                const clienteActual = clienteDoc.data();
                if (clienteActual.rutUrl) {
                    try {
                        const oldFileRef = ref(storage, clienteActual.rutUrl);
                        await deleteObject(oldFileRef);
                    } catch (storageError) {
                        console.warn("No se pudo eliminar el archivo antiguo, puede que ya no exista:", storageError);
                    }
                }

                const newStorageRef = ref(storage, `ruts_clientes/${Date.now()}-${rutFile.name}`);
                const snapshot = await uploadBytes(newStorageRef, rutFile);
                updatedData.rutUrl = await getDownloadURL(snapshot.ref);
            }

            await updateDoc(doc(db, 'clientes', clienteId), updatedData);

            Swal.fire('¡Éxito!', 'Cliente actualizado correctamente.', 'success');
            document.getElementById('modal').classList.add('hidden');

        } catch (error) {
            console.error("Error al actualizar cliente: ", error);
            Swal.fire('Error', 'No se pudo actualizar el cliente.', 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Guardar Cambios';
        }
    }
});

/**
 * Muestra un modal CENTRADO con un iframe para visualizar un archivo (PDF/Imagen).
 * @param {string} url La URL del archivo a mostrar.
 * @param {string} title El título para el modal.
 */
function showFileModal(url, title = 'Visualizador de Archivos') {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const modal = document.getElementById('modal');

    // Usamos el wrapper para poder definir un tamaño más grande para el visualizador
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

    // El listener para cerrar debe estar dentro para capturar el botón recién creado
    modalContentWrapper.querySelector('#close-file-modal').addEventListener('click', () => {
        modal.classList.add('hidden');
        // Opcional: Limpiar el contenido al cerrar para no afectar otros modales
        modalContentWrapper.innerHTML = '<div id="modal-content" class="bg-white rounded-lg p-6 shadow-xl w-11/12 max-w-sm mx-auto text-center"></div>';
    });
}

document.body.addEventListener('click', (e) => {
    // Este selector busca cualquier botón que tenga el atributo data-file-path
    const secureFileButton = e.target.closest('[data-file-path]');

    if (secureFileButton) {
        e.preventDefault(); // Previene cualquier otra acción del botón
        const path = secureFileButton.dataset.filePath;
        const title = secureFileButton.dataset.fileTitle || 'Visualizador de Archivo';

        // Llama a la función segura que ya creamos
        if (path) {
            viewSecureFile(path, title);
        } else {
            console.error("El botón no tiene una ruta de archivo válida.", secureFileButton);
        }
    }
});

/**
 * Llama a la Cloud Function para obtener una URL segura y la muestra en un modal.
 * @param {string} filePath La ruta del archivo en Storage (e.g., 'remisiones/123.pdf').
 * @param {string} title El título para el modal.
 */
async function viewSecureFile(filePath, title) {
    if (!filePath) {
        Swal.fire('Error', 'La ruta del archivo no está disponible.', 'error');
        return;
    }

    // Muestra una alerta de "cargando"
    Swal.fire({
        title: 'Generando enlace seguro...',
        text: 'Por favor, espera.',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    try {
        // Prepara la llamada a la Cloud Function
        const getSignedUrl = httpsCallable(functions, 'getSignedUrl');
        const result = await getSignedUrl({ filePath: filePath });

        const secureUrl = result.data.url;

        // Muestra el archivo en el modal que ya teníamos
        showFileModal(secureUrl, title);
        Swal.close(); // Cierra la alerta de "cargando"

    } catch (error) {
        console.error("Error al obtener el enlace seguro:", error);
        Swal.fire('Error', 'No se pudo obtener el enlace para ver el archivo. Por favor, intenta de nuevo.', 'error');
    }
}

// --- HERRAMIENTA DE REPARACIÓN TEMPORAL ---
// Puedes borrar esta función después de usarla.
window.runRutRepair = async () => {
    try {
        console.log("Iniciando reparación de URLs de RUTs...");
        Swal.fire({
            title: 'Reparando enlaces de RUTs...',
            text: 'Este proceso puede tardar unos segundos. Por favor, espera.',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        // Como esta función está dentro de app.js, sí tiene acceso a 'httpsCallable' y 'functions'
        const repairFunction = httpsCallable(functions, 'repairRutUrls');
        const result = await repairFunction();

        Swal.close();
        console.log("¡Éxito!", result.data.message);
        Swal.fire('¡Reparación Completada!', result.data.message, 'success');

    } catch (error) {
        console.error("Error al ejecutar la reparación:", error);
        Swal.fire('Error', `Ocurrió un error al ejecutar la reparación: ${error.message}`, 'error');
    }
};

