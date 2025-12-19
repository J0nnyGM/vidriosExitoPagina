import {
    doc,
    getDoc,
    collection,
    query,
    where,
    getDocs,
    orderBy,
    limit,
    onSnapshot,
    addDoc,
    serverTimestamp,
    deleteDoc,
    setDoc,
    writeBatch,
    collectionGroup, // Vital para el historial global
    increment,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Importaciones de Storage (Asegúrate de que esta línea sea exacta)
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

// --- Variables del Módulo (Dependencias de app.js) ---
let _db;
let _getUsersMap;
let _getCurrentUserRole;
let _showView;
let _openConfirmModal;
let _getPayrollConfig;
let _getCurrentUserId;
let _setupCurrencyInput;

// Variables locales
let activeEmpleadoChart = null;
let unsubscribeEmpleadosTab = null;

// --- CORRECCIÓN CRÍTICA: Declarar pero NO inicializar aquí ---
let _storage = null;

// Formateador de moneda
const currencyFormatter = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
});

/**
 * Calcula la diferencia de días entre dos fechas usando el año comercial de 360 días.
 * (Meses de 30 días).
 * @param {Date} startDate 
 * @param {Date} endDate 
 * @returns {number} Días totales (inclusivo)
 */
function calculateDays360(startDate, endDate) {
    if (!startDate || !endDate) return 0;

    const start = new Date(startDate);
    const end = new Date(endDate);

    let day1 = start.getDate();
    let month1 = start.getMonth();
    let year1 = start.getFullYear();

    let day2 = end.getDate();
    let month2 = end.getMonth();
    let year2 = end.getFullYear();

    // Ajuste día 31 a 30
    if (day1 === 31) day1 = 30;
    if (day2 === 31) day2 = 30;

    // Ajuste Febrero: Si la fecha fin es el último día de febrero, se toma como 30
    // (Opcional según criterio contable, pero estándar para nómina mensual completa)
    const isEndFeb = (month2 === 1) && (day2 === 28 || day2 === 29);
    if (isEndFeb) {
        day2 = 30;
    }

    const days = ((year2 - year1) * 360) + ((month2 - month1) * 30) + (day2 - day1) + 1; // +1 inclusivo
    return Math.max(0, days);
}

/**
 * Inicializa el módulo de Empleados.
 * Esta función se llama desde app.js CUANDO Firebase ya está listo.
 */
export function initEmpleados(
    db,
    getUsersMap,
    getCurrentUserRole,
    showView,
    storage, // (Ignoramos este argumento para evitar conflictos)
    openConfirmModal,
    loadDotacionFunc,
    getPayrollConfig,
    getCurrentUserId,
    setupCurrencyInput
) {
    // 1. Recibir dependencias
    _db = db;
    _getUsersMap = getUsersMap;
    _getCurrentUserRole = getCurrentUserRole;
    _showView = showView;
    _openConfirmModal = openConfirmModal;
    _getPayrollConfig = getPayrollConfig;
    _getCurrentUserId = getCurrentUserId;
    _setupCurrencyInput = setupCurrencyInput;
    _storage = getStorage(); // (o tu lógica de try/catch actual)

    // 2. Inicializar Storage de forma segura (Ahora que la App existe)
    try {
        _storage = getStorage();
    } catch (e) {
        console.warn("Advertencia: Storage no se pudo inicializar aún (normal si no has configurado buckets).", e);
    }

    // 3. Guardar referencia a función externa
    window.openPaymentVoucherModal = openPaymentVoucherModal;
    window.loadDotacionAsignaciones = loadDotacionFunc;

    window.showEmpleadoDetails = showEmpleadoDetails;

    // 4. Activar las pestañas (Esto hace que los botones funcionen)
    const tabsNav = document.getElementById('empleados-tabs-nav');
    if (tabsNav) {
        // Limpiamos listeners viejos clonando el elemento (truco para evitar duplicados)
        const newTabsNav = tabsNav.cloneNode(true);
        tabsNav.parentNode.replaceChild(newTabsNav, tabsNav);

        newTabsNav.addEventListener('click', (e) => {
            const button = e.target.closest('.empleados-tab-button');
            if (button && !button.classList.contains('active')) {
                switchEmpleadosTab(button.dataset.tab);
            }
        });
    } else {
        console.log("El menú de pestañas de empleados no está en el DOM todavía (se cargará al entrar a la vista).");
    }

    console.log("Módulo de Empleados inicializado correctamente.");
}

// 1. ACTUALIZAR loadEmpleadosView (Diseño Moderno)
export function loadEmpleadosView() {
    const role = _getCurrentUserRole();
    const tabsNav = document.getElementById('empleados-tabs-nav');
    const viewContainer = document.getElementById('empleados-view');

    if (!tabsNav || !viewContainer) return;

    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    // --- CONFIGURACIÓN DEL SELECTOR DE MES ---
    // Ya no lo inyectamos, solo configuramos el valor y el listener
    const monthSelector = document.getElementById('empleado-month-selector');
    if (monthSelector) {
        // Si está vacío, poner el mes actual
        if (!monthSelector.value) {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            monthSelector.value = `${year}-${month}`;
        }

        // Listener para recargar la pestaña actual al cambiar fecha
        // Usamos una propiedad personalizada para evitar múltiples listeners
        if (!monthSelector.dataset.listenerAttached) {
            monthSelector.addEventListener('change', () => {
                const activeTabKey = tabsNav.querySelector('.active')?.dataset.tab || 'productividad';
                switchEmpleadosTab(activeTabKey);
            });
            monthSelector.dataset.listenerAttached = "true";
        }
    }

    // DEFINICIÓN DE PESTAÑAS
    const allTabs = {
        productividad: { label: 'Productividad', roles: ['admin'] },
        documentos: { label: 'RRHH (Expedientes)', roles: ['admin', 'sst'] },
        sst: { label: 'Centro de Control SST', roles: ['admin', 'sst'] },
        nomina: { label: 'Nómina', roles: ['admin', 'nomina'] },
        historial_global: { label: 'Historial de Pagos', roles: ['admin', 'nomina'] }
    };

    // Filtrar pestañas según rol
    const availableTabs = Object.keys(allTabs).filter(key => {
        if (!allTabs[key].roles) return true; // Si no tiene roles definidos, es pública
        return allTabs[key].roles.includes(role);
    });

    // Generar HTML de los botones
    tabsNav.innerHTML = '';
    availableTabs.forEach(tabKey => {
        const tab = allTabs[tabKey];
        // Estilo base para botones inactivos
        tabsNav.innerHTML += `
            <button data-tab="${tabKey}"
                class="empleados-tab-button whitespace-nowrap py-4 px-2 border-b-2 font-bold text-sm transition-all duration-200 text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300">
                ${tab.label}
            </button>
        `;
    });

    // Activar la primera pestaña por defecto
    if (availableTabs.length > 0) {
        // Intentamos mantener la pestaña activa si ya había una
        const previousActive = document.querySelector('.empleados-tab-button.active');
        const defaultTab = previousActive ? previousActive.dataset.tab : availableTabs[0];

        // Verificamos que la pestaña previa siga siendo válida para el rol
        if (availableTabs.includes(defaultTab)) {
            switchEmpleadosTab(defaultTab);
        } else {
            switchEmpleadosTab(availableTabs[0]);
        }
    } else {
        document.getElementById('empleados-content-container').innerHTML =
            '<div class="p-10 text-center bg-gray-50 rounded-lg border border-gray-200"><p class="text-gray-500">No tienes permisos para ver ninguna sección de este módulo.</p></div>';
    }
}

// 2. ACTUALIZAR switchEmpleadosTab (Estilos Activos)

function switchEmpleadosTab(tabName) {
    // 1. Limpiar listener de productividad si existe
    if (typeof unsubscribeProductividad !== 'undefined' && unsubscribeProductividad) {
        unsubscribeProductividad();
        unsubscribeProductividad = null;
    }

    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    // Limpiar el mapa de asistencia si venimos de ahí (importante)
    if (typeof attendanceMapInstance !== 'undefined' && attendanceMapInstance) {
        attendanceMapInstance.remove();
        attendanceMapInstance = null;
    }

    const container = document.getElementById('empleados-content-container');
    container.innerHTML = '<div class="py-16 text-center"><div class="loader mx-auto mb-2"></div><p class="text-xs text-gray-400">Cargando módulo...</p></div>';

    // Actualizar estilos de los botones (Visualización Activa)
    document.querySelectorAll('.empleados-tab-button').forEach(button => {
        const isActive = button.dataset.tab === tabName;

        if (isActive) {
            button.classList.add('active', 'border-slate-800', 'text-slate-800');
            button.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
        } else {
            button.classList.remove('active', 'border-slate-800', 'text-slate-800');
            button.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
        }
    });

    // Cargar contenido
    switch (tabName) {
        case 'productividad':
            const prodDiv = document.createElement('div');
            container.innerHTML = ''; container.appendChild(prodDiv);
            loadProductividadTab(prodDiv);
            break;

        case 'documentos':
            const docsDiv = document.createElement('div');
            container.innerHTML = ''; container.appendChild(docsDiv);
            loadDocumentosTab(docsDiv);
            break;

        case 'sst':
            const sstDiv = document.createElement('div');
            container.innerHTML = ''; container.appendChild(sstDiv);
            loadSSTTab(sstDiv);
            break;

        case 'nomina':
            const nominaDiv = document.createElement('div');
            container.innerHTML = ''; container.appendChild(nominaDiv);
            loadNominaTab(nominaDiv);
            break;

        case 'historial_global':
            const historyDiv = document.createElement('div');
            container.innerHTML = ''; container.appendChild(historyDiv);
            loadGlobalHistoryTab(historyDiv);
            break;

        default:
            container.innerHTML = '<p class="text-red-500 text-center p-4">Módulo no encontrado.</p>';
    }
}

// 3. ACTUALIZAR loadDocumentosTab (MODO RRHH)
async function loadDocumentosTab(container) {
    // --- CONFIGURACIÓN RRHH ---
    const REQUIRED_DOCS = [
        { id: 'contrato', label: 'Contrato Laboral', icon: 'fa-file-signature', color: 'text-blue-600', bg: 'bg-blue-50' },
        { id: 'cedula', label: 'Cédula Ciudadanía', icon: 'fa-id-card', color: 'text-indigo-600', bg: 'bg-indigo-50' },
        { id: 'hoja_vida', label: 'Hoja de Vida', icon: 'fa-user-tie', color: 'text-slate-600', bg: 'bg-slate-50' },
        { id: 'examen_medico', label: 'Examen Médico (Ingreso)', icon: 'fa-user-doctor', color: 'text-emerald-600', bg: 'bg-emerald-50' },
        { id: 'certificados', label: 'Certificados (ARL, EPS, CCF)', icon: 'fa-file-shield', color: 'text-rose-600', bg: 'bg-rose-50' }
        // Nota: "Otros" se maneja dinámicamente para permitir múltiples
    ];

    const currentYear = new Date().getFullYear();

    container.innerHTML = `
        <div class="max-w-6xl mx-auto space-y-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Buscar Colaborador (RRHH)</label>
                <div class="relative mt-1">
                    <input type="text" id="docs-employee-search" 
                        class="block w-full p-3 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-shadow shadow-sm" 
                        placeholder="Escribe el nombre o número de cédula...">
                </div>
                <div id="docs-search-results" class="hidden absolute z-20 bg-white border border-gray-200 rounded-lg shadow-xl mt-1 w-full max-w-2xl max-h-60 overflow-y-auto"></div>
            </div>

            <div id="selected-expediente-container" class="hidden space-y-6">
                <div class="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                    <div>
                        <h3 id="expediente-user-name" class="font-bold text-gray-800 text-lg">Nombre Colaborador</h3>
                        <p class="text-xs text-gray-500">Expediente Laboral (RRHH)</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <label class="text-sm font-bold text-gray-600">Vigencia:</label>
                        <select id="expediente-year-filter" class="border border-indigo-300 bg-indigo-50 text-indigo-900 font-bold text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2">
                            <option value="${currentYear + 1}">${currentYear + 1}</option>
                            <option value="${currentYear}" selected>${currentYear}</option>
                            <option value="${currentYear - 1}">${currentYear - 1}</option>
                        </select>
                    </div>
                </div>

                <div id="documents-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
                
                <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                    <div class="flex justify-between items-center mb-4">
                        <h4 class="font-bold text-gray-700 flex items-center"><i class="fa-solid fa-folder-open mr-2 text-gray-400"></i> Otros Documentos</h4>
                        <button id="btn-upload-other" class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2 px-3 rounded flex items-center transition-colors">
                            <i class="fa-solid fa-plus mr-1"></i> Agregar Otro
                        </button>
                    </div>
                    <div id="documents-others-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        </div>
                </div>
            </div>
            
            <div id="initial-state-msg" class="bg-slate-50 rounded-xl border-2 border-dashed border-slate-300 p-10 text-center min-h-[300px] flex flex-col items-center justify-center">
                <div class="bg-white p-5 rounded-full shadow-sm mb-4"><i class="fa-solid fa-folder-tree text-5xl text-indigo-200"></i></div>
                <h4 class="text-slate-600 font-bold text-lg">Selecciona un colaborador</h4>
            </div>
        </div>
        
        <input type="file" id="global-doc-upload" class="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp">
    `;

    // Referencias DOM
    const searchInput = document.getElementById('docs-employee-search');
    const resultsBox = document.getElementById('docs-search-results');
    const expedienteContainer = document.getElementById('selected-expediente-container');
    const initialStateMsg = document.getElementById('initial-state-msg');
    const gridContainer = document.getElementById('documents-grid');
    const othersGridContainer = document.getElementById('documents-others-grid');
    const yearFilter = document.getElementById('expediente-year-filter');
    const fileInput = document.getElementById('global-doc-upload');
    const userNameLabel = document.getElementById('expediente-user-name');
    const btnUploadOther = document.getElementById('btn-upload-other');

    let selectedUserId = null;
    let activeSlotId = null;

    // --- LÓGICA BUSCADOR (CORREGIDA) ---
    const usersMap = _getUsersMap();

    // CORRECCIÓN: Convertimos el Map a un array asegurándonos de incluir el 'id'
    const usersArray = Array.from(usersMap.entries())
        .map(([id, data]) => ({ id: id, ...data })) // <-- AQUÍ ESTABA EL PROBLEMA
        .filter(u => u.status === 'active');

    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        resultsBox.innerHTML = '';
        if (term.length < 2) { resultsBox.classList.add('hidden'); return; }

        const filtered = usersArray.filter(u =>
            `${u.firstName} ${u.lastName}`.toLowerCase().includes(term) ||
            (u.idNumber && u.idNumber.includes(term))
        );

        if (filtered.length === 0) resultsBox.innerHTML = '<div class="p-3 text-sm text-gray-500">No encontrado</div>';
        else {
            filtered.forEach(user => {
                const div = document.createElement('div');
                div.className = "p-3 hover:bg-indigo-50 cursor-pointer border-b border-gray-100 flex items-center gap-3";

                // Validación de iniciales para evitar errores si faltan nombres
                const initials = (user.firstName?.[0] || '') + (user.lastName?.[0] || '');

                div.innerHTML = `
                    <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-xs font-bold">${initials}</div>
                    <div>
                        <p class="text-sm font-bold text-gray-800">${user.firstName} ${user.lastName}</p>
                        <p class="text-xs text-gray-500">CC: ${user.idNumber || 'N/A'}</p>
                    </div>
                `;

                div.onclick = () => {
                    // Ahora 'user.id' SÍ existe gracias al mapeo de arriba
                    if (!user.id) {
                        console.error("Error: Usuario sin ID", user);
                        alert("Error al seleccionar usuario.");
                        return;
                    }
                    searchInput.value = `${user.firstName} ${user.lastName}`;
                    resultsBox.classList.add('hidden');
                    loadUserExpediente(user.id, user.firstName + ' ' + user.lastName);
                };
                resultsBox.appendChild(div);
            });
        }
        resultsBox.classList.remove('hidden');
    });

    // --- CARGA DE EXPEDIENTE ---
    const loadUserExpediente = (userId, userName) => {
        selectedUserId = userId;
        userNameLabel.textContent = userName;
        initialStateMsg.classList.add('hidden');
        expedienteContainer.classList.remove('hidden');
        renderSlots(yearFilter.value);
    };

    const renderSlots = async (year) => {
        gridContainer.innerHTML = `<div class="col-span-full text-center py-4"><div class="loader-small mx-auto"></div></div>`;
        othersGridContainer.innerHTML = '';

        try {
            const q = query(collection(_db, "users", selectedUserId, "documents"));
            const snapshot = await getDocs(q);
            const docsMap = new Map(); // Para fijos
            const otherDocs = [];      // Para otros

            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                let docYear = data.year || (data.uploadedAt ? data.uploadedAt.toDate().getFullYear() : null);

                if (String(docYear) === String(year)) {
                    if (data.category === 'otros_rrhh') {
                        otherDocs.push({ id: docSnap.id, ...data });
                    } else {
                        docsMap.set(data.category, { id: docSnap.id, ...data });
                    }
                }
            });

            gridContainer.innerHTML = '';

            // A. RENDERIZAR DOCUMENTOS FIJOS
            REQUIRED_DOCS.forEach(slot => {
                const existingDoc = docsMap.get(slot.id);
                const card = createDocCard(slot, existingDoc, year);
                gridContainer.appendChild(card);
            });

            // B. RENDERIZAR OTROS (Múltiples)
            if (otherDocs.length === 0) {
                othersGridContainer.innerHTML = `<p class="col-span-full text-center text-xs text-gray-400 italic py-4">No hay documentos adicionales para este año.</p>`;
            } else {
                otherDocs.forEach(doc => {
                    // Creamos un objeto slot simulado para usar la misma función de renderizado
                    const slotSim = { id: 'otros_rrhh', label: doc.description || 'Otro Documento', icon: 'fa-file', color: 'text-gray-600', bg: 'bg-gray-100' };
                    const card = createDocCard(slotSim, doc, year, true);
                    othersGridContainer.appendChild(card);
                });
            }

        } catch (error) {
            console.error(error);
            gridContainer.innerHTML = `<p class="text-red-500">Error cargando.</p>`;
        }
    };

    // Helper para crear tarjetas
    const createDocCard = (slot, existingDoc, year, isOther = false) => {
        const card = document.createElement('div');

        if (existingDoc) {
            // --- ESTADO: LLENO (DOCUMENTO EXISTE) ---
            const dateStr = existingDoc.uploadedAt ? existingDoc.uploadedAt.toDate().toLocaleDateString('es-CO') : 'N/A';
            let fileIcon = existingDoc.type?.includes('pdf') ? 'fa-file-pdf text-red-500' : 'fa-file-image text-blue-500';

            card.className = "bg-white border border-gray-200 rounded-xl p-3 shadow-sm hover:shadow-md transition-all relative group overflow-hidden";
            card.innerHTML = `
                <div class="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
                <div class="flex justify-between items-start mb-2 pl-2">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg ${slot.bg} flex items-center justify-center"><i class="fa-solid ${slot.icon} ${slot.color}"></i></div>
                        <div>
                            <h5 class="text-xs font-bold text-gray-800 truncate max-w-[120px]" title="${isOther ? existingDoc.description : slot.label}">${isOther ? existingDoc.description : slot.label}</h5>
                            <span class="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">CARGADO</span>
                        </div>
                    </div>
                    <i class="fa-solid ${fileIcon}"></i>
                </div>
                <div class="pl-2 mb-2"><p class="text-[10px] text-gray-400">Subido: ${dateStr}</p></div>
                <div class="flex gap-2 pl-2">
                    <a href="${existingDoc.url}" target="_blank" class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold py-1.5 rounded text-center transition-colors">Ver</a>
                    <button class="btn-delete-doc flex-1 bg-red-50 hover:bg-red-100 text-red-600 text-[10px] font-bold py-1.5 rounded text-center transition-colors" 
                        data-id="${existingDoc.id}" data-path="${existingDoc.storagePath}">Borrar</button>
                </div>`;

            // LISTENER DE BORRADO (CORREGIDO AQUÍ)
            card.querySelector('.btn-delete-doc').addEventListener('click', () => {
                // Usamos la variable con guion bajo que definimos al inicio del módulo
                if (_openConfirmModal) {
                    _openConfirmModal(`¿Eliminar este documento de forma permanente?`, async () => {
                        try {
                            // Usamos _storage y _db (variables del módulo)
                            await deleteObject(ref(_storage, existingDoc.storagePath));
                            await deleteDoc(doc(_db, "users", selectedUserId, "documents", existingDoc.id));

                            window.showToast("Documento eliminado.", "success");

                            // Registrar auditoría si existe la función
                            if (window.logAuditAction) {
                                window.logAuditAction("Eliminar Doc RRHH", `Borrado: ${existingDoc.name}`, selectedUserId);
                            }

                            renderSlots(year); // Recargar la vista
                        } catch (e) {
                            console.error(e);
                            window.showToast("Error al eliminar.", "error");
                        }
                    });
                } else {
                    // Fallback de emergencia por si la función no se inyectó
                    if (confirm("¿Eliminar este documento?")) {
                        // Misma lógica de borrado...
                        // (Por brevedad, mejor asegurar que _openConfirmModal esté bien iniciada)
                    }
                }
            });

        } else {
            // --- ESTADO: VACÍO (SUBIR) ---
            card.className = "border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center text-center hover:border-indigo-400 hover:bg-indigo-50 transition-all cursor-pointer group min-h-[140px]";
            card.innerHTML = `
                <i class="fa-solid ${slot.icon} text-gray-300 group-hover:text-indigo-500 text-2xl mb-2"></i>
                <h5 class="text-xs font-bold text-gray-500 group-hover:text-indigo-800">${slot.label}</h5>
                <p class="text-[10px] text-gray-400 mt-1">Vacío</p>
            `;
            card.onclick = () => {
                activeSlotId = slot.id;
                fileInput.click();
            };
        }
        return card;
    };

    // Listeners Subida
    btnUploadOther.addEventListener('click', () => {
        activeSlotId = 'otros_rrhh';
        fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !activeSlotId) return;

        // Si cancela el modal, necesitamos limpiar el input para poder reintentar
        const resetInput = () => { fileInput.value = ''; activeSlotId = null; };

        const selectedYear = yearFilter.value;

        // Lógica para "Otros Documentos"
        let description = 'Documento RRHH';

        if (activeSlotId === 'otros_rrhh') {
            // USAMOS EL NUEVO MODAL FLOTANTE
            description = await openCustomInputModal(
                "Nuevo Documento Adicional",
                "Descripción del documento:",
                "text",
                "Ej: Memo Disciplinario, Carta de Recomendación..."
            );

            if (!description) { resetInput(); return; } // Si el usuario canceló
        } else {
            // Si es fijo (Cédula, Contrato), usamos la etiqueta predefinida
            const slot = REQUIRED_DOCS.find(s => s.id === activeSlotId);
            if (slot) description = slot.label;
        }

        window.showToast("Subiendo documento...", "info");

        try {
            const storagePath = `expedientes/${selectedUserId}/${selectedYear}/${activeSlotId}_${Date.now()}_${file.name}`;
            const storageRef = ref(_storage, storagePath);
            const snap = await uploadBytes(storageRef, file);
            const url = await getDownloadURL(snap.ref);

            await addDoc(collection(_db, "users", selectedUserId, "documents"), {
                name: file.name,
                category: activeSlotId,
                description: description,
                year: parseInt(selectedYear),
                url: url,
                storagePath: storagePath,
                type: file.type,
                uploadedAt: serverTimestamp(),
                uploadedBy: _getCurrentUserId()
            });

            window.showToast("Documento guardado exitosamente.", "success");
            renderSlots(selectedYear);

        } catch (error) {
            console.error(error);
            window.showToast("Error al subir archivo.", "error");
        } finally {
            resetInput();
        }
    });

    yearFilter.addEventListener('change', (e) => renderSlots(e.target.value));
}


// ==============================================================
//       MÓDULO SST: CENTRO DE CONTROL (NUEVA ESTRUCTURA)
// ==============================================================

/**
 * Carga el "Shell" del Centro de Control SST con navegación interna.
 */
function loadSSTTab(container) {
    // 1. Estructura del Menú Principal SST
    container.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-md min-h-[600px]">
            
            <div class="flex flex-col md:flex-row justify-between items-center mb-6 border-b border-gray-100 pb-4 gap-4">
                <div>
                    <h2 class="text-2xl font-bold text-gray-800 flex items-center">
                        <i class="fa-solid fa-shield-halved text-emerald-500 mr-3"></i>
                        Centro de Control SG-SST
                    </h2>
                    <p class="text-sm text-gray-500 mt-1">Gestión integral de seguridad y salud en el trabajo.</p>
                </div>
                
                <div id="sst-nav-buttons" class="flex bg-gray-100 p-1 rounded-lg">
                    <button data-subtab="general" class="sst-nav-btn px-4 py-2 text-sm font-bold rounded-md text-gray-600 hover:text-emerald-600 transition-all">
                        <i class="fa-solid fa-folder-open mr-2"></i> Documentación
                    </button>
                    <button data-subtab="colaboradores" class="sst-nav-btn px-4 py-2 text-sm font-bold rounded-md text-gray-600 hover:text-blue-600 transition-all">
                        <i class="fa-solid fa-users-viewfinder mr-2"></i> Seguimiento
                    </button>
                    <button data-subtab="dotacion" class="sst-nav-btn px-4 py-2 text-sm font-bold rounded-md text-gray-600 hover:text-yellow-600 transition-all">
                        <i class="fa-solid fa-helmet-safety mr-2"></i> Dotación (EPP)
                    </button>
                </div>
            </div>

            <div id="sst-content-area" class="relative">
                </div>
        </div>
    `;

    // 2. Configurar Listeners del Menú SST
    const navContainer = document.getElementById('sst-nav-buttons');
    navContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.sst-nav-btn');
        if (btn) {
            switchSSTSubTab(btn.dataset.subtab);
        }
    });

    // 3. Cargar pestaña por defecto (General)
    switchSSTSubTab('general');
}

/**
 * Cambia entre las sub-pestañas de SST.
 */
function switchSSTSubTab(subTabName) {
    // A. Limpiar listeners anteriores (para evitar fugas de memoria en Dotación)
    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    // B. Actualizar Estilos de Botones
    document.querySelectorAll('.sst-nav-btn').forEach(btn => {
        if (btn.dataset.subtab === subTabName) {
            btn.classList.add('bg-white', 'shadow-sm', 'text-gray-800');
            btn.classList.remove('text-gray-600', 'hover:text-emerald-600'); // Limpiar hovers específicos si quieres
        } else {
            btn.classList.remove('bg-white', 'shadow-sm', 'text-gray-800');
            btn.classList.add('text-gray-600');
        }
    });

    // C. Renderizar Contenido
    const contentArea = document.getElementById('sst-content-area');
    contentArea.innerHTML = '<div class="py-20 text-center"><div class="loader mx-auto"></div></div>';

    switch (subTabName) {
        case 'general':
            loadSSTGeneralSubTab(contentArea);
            break;
        case 'colaboradores':
            loadSSTColaboradoresSubTab(contentArea);
            break;
        case 'dotacion':
            loadSSTDotacionSubTab(contentArea);
            break;
    }
}

// ----------------------------------------------------------
// SUB-MÓDULO 1: DOCUMENTACIÓN GENERAL (LÓGICA COMPLETA)
// ----------------------------------------------------------
function loadSSTGeneralSubTab(container) {
    // 1. CONFIGURACIÓN DE CATEGORÍAS SG-SST
    const SST_CATEGORIES = [
        { id: 'politicas', label: 'Políticas y Reglamentos', icon: 'fa-scale-balanced', color: 'text-blue-600', bg: 'bg-blue-50' },
        { id: 'matriz', label: 'Matriz de Riesgos (IPERC)', icon: 'fa-table-list', color: 'text-orange-600', bg: 'bg-orange-50' },
        { id: 'emergencias', label: 'Plan de Emergencias', icon: 'fa-truck-medical', color: 'text-red-600', bg: 'bg-red-50' },
        { id: 'copasst', label: 'Actas COPASST / Vigía', icon: 'fa-users-line', color: 'text-indigo-600', bg: 'bg-indigo-50' },
        { id: 'capacitacion', label: 'Plan de Capacitación', icon: 'fa-chalkboard-user', color: 'text-emerald-600', bg: 'bg-emerald-50' },
        { id: 'legal', label: 'Requisitos Legales', icon: 'fa-gavel', color: 'text-slate-600', bg: 'bg-slate-50' },
        { id: 'otros_sst', label: 'Otros Documentos SST', icon: 'fa-folder-open', color: 'text-gray-600', bg: 'bg-gray-50' }
    ];

    // 2. ESTRUCTURA HTML
    container.innerHTML = `
        <div class="space-y-6">
            <div class="bg-indigo-50 border-l-4 border-indigo-500 p-4 rounded-r-lg flex justify-between items-start">
                <div>
                    <h4 class="text-indigo-900 font-bold text-sm">Repositorio Central SG-SST</h4>
                    <p class="text-indigo-700 text-xs mt-1">Los documentos cargados aquí son visibles para la gestión administrativa de la empresa.</p>
                </div>
                <div class="text-right">
                     <span id="sst-total-docs" class="bg-white text-indigo-600 px-3 py-1 rounded-full text-xs font-bold shadow-sm">0 Archivos</span>
                </div>
            </div>

            <div id="sst-docs-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div class="col-span-full text-center py-12">
                    <div class="loader mx-auto"></div>
                    <p class="text-gray-400 mt-3 text-sm">Sincronizando documentación...</p>
                </div>
            </div>
        </div>

        <input type="file" id="sst-doc-upload" class="hidden" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx">
    `;

    const gridContainer = document.getElementById('sst-docs-grid');
    const fileInput = document.getElementById('sst-doc-upload');
    const totalCountEl = document.getElementById('sst-total-docs');

    let activeCategoryId = null; // Para saber en qué caja estamos subiendo

    // 3. LISTENER DE DOCUMENTOS (REAL-TIME)
    const q = query(collection(_db, "company_documents"), where("system", "==", "sst"), orderBy("uploadedAt", "desc"));

    unsubscribeEmpleadosTab = onSnapshot(q, (snapshot) => {
        totalCountEl.textContent = `${snapshot.size} Archivos`;

        // Agrupar documentos por categoría en memoria
        const docsByCategory = {};
        SST_CATEGORIES.forEach(cat => docsByCategory[cat.id] = []); // Inicializar arrays

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            // Si la categoría existe en nuestro mapa, lo agregamos, si no, a 'otros_sst'
            const targetCat = docsByCategory[data.category] ? data.category : 'otros_sst';
            docsByCategory[targetCat].push({ id: docSnap.id, ...data });
        });

        // Renderizar el Grid
        gridContainer.innerHTML = '';

        SST_CATEGORIES.forEach(category => {
            const files = docsByCategory[category.id];
            const hasFiles = files.length > 0;

            // Generar lista de archivos HTML
            let filesHtml = '';
            if (hasFiles) {
                filesHtml = `<ul class="space-y-2 mt-3 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                    ${files.map(file => {
                    let icon = 'fa-file text-gray-400';
                    if (file.type?.includes('pdf')) icon = 'fa-file-pdf text-red-500';
                    else if (file.type?.includes('sheet') || file.name.endsWith('xlsx')) icon = 'fa-file-excel text-green-600';
                    else if (file.type?.includes('word') || file.name.endsWith('docx')) icon = 'fa-file-word text-blue-600';

                    return `
                        <li class="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100 transition-colors group">
                            <div class="flex items-center gap-2 min-w-0">
                                <i class="fa-solid ${icon} text-sm"></i>
                                <a href="${file.url}" target="_blank" class="text-xs text-gray-700 font-medium truncate hover:text-indigo-600 hover:underline" title="${file.name}">
                                    ${file.name}
                                </a>
                            </div>
                            <button class="btn-delete-sst-doc text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 px-2" 
                                data-id="${file.id}" data-path="${file.storagePath}" data-name="${file.name}">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </li>`;
                }).join('')}
                </ul>`;
            } else {
                filesHtml = `<div class="mt-4 py-6 text-center border-2 border-dashed border-gray-100 rounded-lg">
                    <p class="text-[10px] text-gray-400">Carpeta vacía</p>
                </div>`;
            }

            // Construir la Tarjeta de Categoría
            const card = document.createElement('div');
            card.className = "bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col hover:shadow-md transition-shadow";
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-lg ${category.bg} flex items-center justify-center text-lg">
                            <i class="fa-solid ${category.icon} ${category.color}"></i>
                        </div>
                        <div>
                            <h5 class="font-bold text-gray-800 text-sm">${category.label}</h5>
                            <span class="text-[10px] text-gray-500">${files.length} documentos</span>
                        </div>
                    </div>
                    <button class="btn-add-sst-doc bg-indigo-50 text-indigo-600 hover:bg-indigo-100 w-8 h-8 rounded-full flex items-center justify-center transition-colors" title="Subir archivo aquí" data-cat="${category.id}">
                        <i class="fa-solid fa-plus text-xs font-bold"></i>
                    </button>
                </div>
                
                ${filesHtml}
            `;

            // Listener: Subir Archivo en esta categoría
            card.querySelector('.btn-add-sst-doc').addEventListener('click', (e) => {
                activeCategoryId = e.currentTarget.dataset.cat;
                fileInput.click();
            });

            // Listeners: Borrar Archivos (CORREGIDO)
            card.querySelectorAll('.btn-delete-sst-doc').forEach(btn => {
                btn.addEventListener('click', function () {
                    const docId = this.dataset.id;
                    const path = this.dataset.path;
                    const name = this.dataset.name;

                    // --- AQUÍ ESTÁ EL CAMBIO IMPORTANTE: Usar _openConfirmModal ---
                    if (_openConfirmModal) {
                        _openConfirmModal(`¿Eliminar "${name}" del sistema?`, async () => {
                            try {
                                await deleteObject(ref(_storage, path)); // Borrar de Storage
                                await deleteDoc(doc(_db, "company_documents", docId)); // Borrar de BD

                                window.showToast("Documento eliminado.", "success");
                                
                                if (typeof window.logAuditAction === 'function') {
                                    window.logAuditAction("Eliminar Doc SST", `Borrado: ${name}`, _getCurrentUserId());
                                }

                            } catch (e) {
                                console.error(e);
                                window.showToast("Error al eliminar.", "error");
                            }
                        });
                    } else {
                        // Fallback simple
                        if(confirm(`¿Eliminar "${name}"?`)){
                           // Lógica de borrado directa si el modal no carga
                           deleteObject(ref(_storage, path)).then(() => deleteDoc(doc(_db, "company_documents", docId)));
                        }
                    }
                });
            });

            gridContainer.appendChild(card);
        });

    }, (error) => {
        console.error("Error cargando docs SST:", error);
        gridContainer.innerHTML = `<div class="col-span-full text-center text-red-500">Error de conexión: ${error.message}</div>`;
    });

    // 4. LÓGICA DE SUBIDA (FILE INPUT)
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !activeCategoryId) return;

        if (file.size > 10 * 1024 * 1024) { // 10MB límite
            window.showToast("El archivo supera los 10MB.", "error");
            fileInput.value = '';
            return;
        }

        window.showToast("Subiendo al sistema...", "info");

        try {
            // Ruta: company_docs/sst/categoria/timestamp_nombre
            const storagePath = `company_docs/sst/${activeCategoryId}/${Date.now()}_${file.name}`;
            const storageRef = ref(_storage, storagePath);

            const snapshot = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);

            // Guardar en Firestore
            await addDoc(collection(_db, "company_documents"), {
                name: file.name,
                system: 'sst',
                category: activeCategoryId,
                url: downloadURL,
                storagePath: storagePath,
                type: file.type,
                size: file.size,
                uploadedAt: serverTimestamp(),
                uploadedBy: _getCurrentUserId()
            });

            window.showToast("Documento publicado correctamente.", "success");

        } catch (error) {
            console.error("Error subiendo doc SST:", error);
            window.showToast("Error en la carga: " + error.message, "error");
        } finally {
            fileInput.value = '';
            activeCategoryId = null;
        }
    });
}

// ----------------------------------------------------------
// SUB-MÓDULO 2: SEGUIMIENTO COLABORADORES (CORREGIDO)
// ----------------------------------------------------------
async function loadSSTColaboradoresSubTab(container) {
    // 1. ESTRUCTURA DE LA TABLA
    container.innerHTML = `
        <div class="space-y-4">
            <div class="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                <h3 class="font-bold text-gray-700"><i class="fa-solid fa-traffic-light mr-2 text-blue-500"></i> Estado de Cumplimiento</h3>
                <input type="text" id="sst-colab-search" class="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-blue-500 focus:border-blue-500" placeholder="Filtrar empleado...">
            </div>

            <div class="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                            <tr>
                                <th class="px-4 py-3">Colaborador</th>
                                <th class="px-4 py-3 text-center">Curso Alturas</th>
                                <th class="px-4 py-3 text-center">Examen Médico</th>
                                <th class="px-4 py-3 text-center">Inducción SST</th>
                                <th class="px-4 py-3 text-center">Acción</th>
                            </tr>
                        </thead>
                        <tbody id="sst-colab-table-body" class="divide-y divide-gray-100">
                            <tr><td colspan="5" class="text-center py-10"><div class="loader mx-auto"></div></td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    const tableBody = document.getElementById('sst-colab-table-body');
    const searchInput = document.getElementById('sst-colab-search');

    // --- CAMBIO 1: Cargar Configuración de Alertas ---
    let diasAlerta = 45; // Valor por defecto
    try {
        const configSnap = await getDoc(doc(_db, "system", "generalConfig"));
        if (configSnap.exists() && configSnap.data().alertas) {
            diasAlerta = configSnap.data().alertas.diasVencimientoSST || 45;
        }
    } catch (e) { console.warn("Usando alerta por defecto (45 días)", e); }
    // -----------------------------------------------

    const usersMap = _getUsersMap();

    // Mapeamos entries() para asegurar que el ID vaya dentro del objeto
    const activeUsers = Array.from(usersMap.entries())
        .map(([id, data]) => ({ id: id, ...data }))
        .filter(u => u.status === 'active');

    tableBody.innerHTML = '';

    if (activeUsers.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-400">No hay colaboradores activos.</td></tr>';
        return;
    }

    for (const user of activeUsers) {
        if (!user.id) continue;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-blue-50 transition-colors group";
        tr.dataset.name = `${user.firstName || ''} ${user.lastName || ''} ${user.idNumber || ''}`.toLowerCase();

        const initials = (user.firstName?.[0] || '') + (user.lastName?.[0] || '');

        tr.innerHTML = `
            <td class="px-4 py-3 font-medium text-gray-900">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                        ${initials}
                    </div>
                    <div>
                        <p>${user.firstName} ${user.lastName}</p>
                        <p class="text-[10px] text-gray-400">${user.jobTitle || 'Operario'}</p>
                    </div>
                </div>
            </td>
            <td class="px-4 py-3 text-center" id="status-alturas-${user.id}"><div class="loader-small mx-auto"></div></td>
            <td class="px-4 py-3 text-center" id="status-medico-${user.id}"><div class="loader-small mx-auto"></div></td>
            <td class="px-4 py-3 text-center" id="status-induccion-${user.id}"><div class="loader-small mx-auto"></div></td>
            <td class="px-4 py-3 text-center">
                <button class="btn-manage-sst text-blue-600 hover:bg-blue-100 p-2 rounded-full transition-colors" title="Gestionar Carpeta SST">
                    <i class="fa-solid fa-folder-open"></i>
                </button>
            </td>
        `;

        tr.querySelector('.btn-manage-sst').addEventListener('click', () => {
            loadSSTUserProfile(user.id, container);
        });

        tableBody.appendChild(tr);

        // --- CAMBIO 2: Pasamos 'diasAlerta' a la función ---
        checkUserSSTStatus(user.id, diasAlerta);
    }

    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const rows = tableBody.querySelectorAll('tr');
        rows.forEach(row => {
            const name = row.dataset.name || "";
            row.style.display = name.includes(term) ? '' : 'none';
        });
    });
}

/**
 * Verifica los documentos SST de un usuario y actualiza los semáforos en la tabla.
 */
async function checkUserSSTStatus(userId, alertDays = 30) {
    if (!userId) return;

    try {
        const q = query(collection(_db, "users", userId, "documents"),
            where("category", "in", ["sst_alturas", "sst_medico", "sst_induccion"]));

        const snapshot = await getDocs(q);
        const docs = {};
        snapshot.forEach(d => docs[d.data().category] = d.data());

        // Helper para generar el badge
        const getBadge = (category) => {
            const doc = docs[category];
            if (!doc) return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700"><i class="fa-solid fa-xmark"></i> Falta</span>`;

            if (doc.expiresAt) {
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const expiration = doc.expiresAt.toDate();
                const diffTime = expiration - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays < 0) return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700" title="Venció el ${expiration.toLocaleDateString()}"><i class="fa-solid fa-triangle-exclamation"></i> Vencido</span>`;

                // --- USAMOS LA VARIABLE DINÁMICA AQUÍ ---
                if (diffDays <= alertDays) return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800" title="Vence en ${diffDays} días (Alerta: ${alertDays}d)"><i class="fa-solid fa-clock"></i> Vence pronto</span>`;
            }

            return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700"><i class="fa-solid fa-check"></i> Al día</span>`;
        };

        const cellAlturas = document.getElementById(`status-alturas-${userId}`);
        const cellMedico = document.getElementById(`status-medico-${userId}`);
        const cellInduccion = document.getElementById(`status-induccion-${userId}`);

        if (cellAlturas) cellAlturas.innerHTML = getBadge('sst_alturas');
        if (cellMedico) cellMedico.innerHTML = getBadge('sst_medico');
        if (cellInduccion) cellInduccion.innerHTML = getBadge('sst_induccion');

    } catch (error) {
        console.error(`Error loading SST for ${userId}`, error);
    }
}

/**
 * Vista Detallada de Gestión SST para un Usuario.
 */
async function loadSSTUserProfile(userId, container) {
    const usersMap = _getUsersMap();
    const rawUserData = usersMap.get(userId);

    // --- CORRECCIÓN: Validar y construir el objeto con ID explícito ---
    if (!rawUserData) {
        container.innerHTML = `<div class="p-10 text-center text-red-500">Error: Usuario no encontrado en el sistema local.</div>`;
        return;
    }

    // Aquí fusionamos el ID que viene como parámetro con los datos del mapa
    const user = { id: userId, ...rawUserData };
    // ----------------------------------------------------------------

    const SST_USER_CATS = [
        { id: 'sst_alturas', label: 'Curso de Alturas', icon: 'fa-person-falling', color: 'text-orange-600', requiresDate: true, dateLabel: 'Realización', validityMonths: 18 },
        { id: 'sst_aptitud', label: 'Certificado de Aptitud', icon: 'fa-clipboard-check', color: 'text-emerald-600', requiresDate: true, dateLabel: 'Realización', validityMonths: 12 },
        { id: 'sst_medico', label: 'Examen Médico', icon: 'fa-user-doctor', color: 'text-blue-600', requiresDate: true, dateLabel: 'Realización', validityMonths: 12 },
        { id: 'sst_otros', label: 'Otros (SST)', icon: 'fa-folder-plus', color: 'text-gray-600', requiresDate: false }
    ];

    container.innerHTML = `
        <div class="max-w-4xl mx-auto space-y-6">
            
            <div class="flex justify-between items-center mb-4">
                <button id="btn-back-sst-table" class="text-sm text-gray-500 hover:text-indigo-600 font-bold flex items-center transition-colors">
                    <i class="fa-solid fa-arrow-left mr-2"></i> Volver a la lista
                </button>
                
                <button id="btn-download-zip" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 px-4 rounded-lg shadow-md flex items-center transition-all">
                    <i class="fa-solid fa-file-zipper mr-2"></i> Descargar Documentos (.ZIP)
                </button>
            </div>

            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex items-center gap-4">
                <div class="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center text-2xl font-bold text-indigo-600 border-2 border-indigo-200">
                    ${user.firstName[0]}${user.lastName[0]}
                </div>
                <div>
                    <h2 class="text-xl font-bold text-gray-800">${user.firstName} ${user.lastName}</h2>
                    <p class="text-sm text-gray-500">Carpeta de Seguridad y Salud en el Trabajo</p>
                    <p class="text-xs text-gray-400 mt-1">Cédula: ${user.idNumber}</p>
                </div>
            </div>

            <div id="sst-user-cards" class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="col-span-3 text-center py-10"><div class="loader mx-auto"></div></div>
            </div>
            
            <div class="bg-white p-4 rounded-xl border border-gray-200">
                <div class="flex justify-between items-center mb-3">
                    <h4 class="font-bold text-gray-700">Otros Documentos SST</h4>
                    <button id="btn-sst-add-other" class="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded font-bold">+ Agregar</button>
                </div>
                <div id="sst-others-grid" class="grid grid-cols-1 md:grid-cols-3 gap-4"></div>
            </div>
        </div>
        
        <input type="file" id="sst-user-upload-input" class="hidden" accept=".pdf,.jpg,.png,.jpeg">
    `;

    document.getElementById('btn-back-sst-table').addEventListener('click', () => {
        // Recargamos la tabla en el MISMO contenedor para no borrar el menú superior
        loadSSTColaboradoresSubTab(container);
    });

    // --- NUEVO LISTENER PARA EL BOTÓN ZIP ---
    document.getElementById('btn-download-zip').addEventListener('click', () => {
        openBatchDownloadModal(user);
    });

    const cardsContainer = document.getElementById('sst-user-cards');
    const othersContainer = document.getElementById('sst-others-grid');
    const fileInput = document.getElementById('sst-user-upload-input');

    let activeCatConfig = null;

    const renderCards = async () => {
        const q = query(collection(_db, "users", userId, "documents"), where("category", "in", ["sst_alturas", "sst_aptitud", "sst_medico", "sst_otros"]));
        const snapshot = await getDocs(q);
        const docsMap = new Map();
        const otherDocs = [];

        snapshot.forEach(d => {
            if (d.data().category === 'sst_otros') otherDocs.push({ id: d.id, ...d.data() });
            else docsMap.set(d.data().category, { id: d.id, ...d.data() });
        });

        cardsContainer.innerHTML = '';
        othersContainer.innerHTML = '';

        SST_USER_CATS.filter(c => c.id !== 'sst_otros').forEach(cat => {
            const docData = docsMap.get(cat.id);
            const card = document.createElement('div');

            if (docData) {
                let statusHtml = '<span class="text-xs font-bold text-green-600 bg-green-100 px-2 py-1 rounded">Vigente</span>';
                let dateInfo = '';

                if (docData.expiresAt) {
                    const expDate = docData.expiresAt.toDate();
                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));

                    dateInfo = `<p class="text-xs text-gray-500 mt-1">Vence: <strong>${expDate.toLocaleDateString('es-CO')}</strong></p>`;

                    if (diffDays < 0) statusHtml = '<span class="text-xs font-bold text-red-600 bg-red-100 px-2 py-1 rounded">VENCIDO</span>';
                    else if (diffDays <= 30) statusHtml = '<span class="text-xs font-bold text-yellow-700 bg-yellow-100 px-2 py-1 rounded">Vence Pronto</span>';
                }

                card.className = "bg-white p-5 rounded-xl border border-green-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-all";
                card.innerHTML = `
                    <div class="absolute top-0 left-0 w-full h-1 bg-green-500"></div>
                    <div class="flex justify-between items-start mb-4">
                        <div class="w-12 h-12 rounded-lg bg-gray-50 flex items-center justify-center text-xl">
                            <i class="fa-solid ${cat.icon} ${cat.color}"></i>
                        </div>
                        ${statusHtml}
                    </div>
                    <h4 class="font-bold text-gray-800 text-sm h-10">${cat.label}</h4>
                    <div class="min-h-[40px]">${dateInfo}</div>
                    
                    <a href="${docData.url}" target="_blank" class="text-xs text-blue-600 hover:underline mt-3 block truncate bg-blue-50 p-2 rounded border border-blue-100">
                        <i class="fa-solid fa-paperclip mr-1"></i> ${docData.name}
                    </a>
                    
                    <div class="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                        <button class="btn-delete-sst flex-1 text-xs text-red-500 hover:bg-red-50 py-2 rounded font-bold transition-colors" data-id="${docData.id}" data-path="${docData.storagePath}">
                            <i class="fa-solid fa-trash mr-1"></i> Eliminar
                        </button>
                    </div>
                `;

                card.querySelector('.btn-delete-sst').addEventListener('click', function () {
                    if (_openConfirmModal) _openConfirmModal("¿Eliminar este certificado? Se perderá el historial.", async () => {
                        try {
                            await deleteObject(ref(_storage, this.dataset.path));
                            await deleteDoc(doc(_db, "users", userId, "documents", this.dataset.id));
                            window.showToast("Certificado eliminado.", "success");
                            renderCards();
                        } catch (e) { console.error(e); window.showToast("Error al borrar.", "error"); }
                    });
                });

            } else {
                card.className = "border-2 border-dashed border-gray-300 rounded-xl p-5 flex flex-col items-center justify-center text-center hover:border-indigo-400 hover:bg-indigo-50 transition-all cursor-pointer group min-h-[240px]";
                card.innerHTML = `
                    <div class="w-14 h-14 rounded-full bg-gray-100 group-hover:bg-white flex items-center justify-center mb-3 shadow-sm transition-colors">
                        <i class="fa-solid ${cat.icon} text-gray-400 group-hover:text-indigo-600 text-2xl"></i>
                    </div>
                    <h5 class="font-bold text-gray-600 group-hover:text-indigo-800 text-sm mb-1">${cat.label}</h5>
                    <p class="text-xs text-gray-400 mt-1">No cargado</p>
                    ${cat.requiresDate ? `<p class="text-[10px] text-indigo-400 mt-2 font-medium">Vigencia: ${cat.validityMonths} meses</p>` : ''}
                `;
                card.onclick = () => {
                    activeCatConfig = cat;
                    fileInput.click();
                };
            }
            cardsContainer.appendChild(card);
        });

        // Renderizar Otros
        if (otherDocs.length === 0) othersContainer.innerHTML = '<p class="col-span-3 text-center text-xs text-gray-400 italic">No hay otros documentos.</p>';

        otherDocs.forEach(doc => {
            const card = document.createElement('div');
            card.className = "bg-white p-3 rounded border border-gray-200 shadow-sm flex justify-between items-center";
            card.innerHTML = `
                <div class="min-w-0 pr-2">
                    <p class="text-xs font-bold text-gray-700 truncate" title="${doc.description}">${doc.description}</p>
                    <p class="text-[10px] text-gray-400">${doc.uploadedAt ? doc.uploadedAt.toDate().toLocaleDateString() : ''}</p>
                </div>
                <div class="flex gap-1">
                    <button type="button" onclick="window.viewDocument('${doc.url}', '${doc.name}')" class="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition-colors" title="Ver documento">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                    <button class="btn-del p-1.5 text-red-600 bg-red-50 rounded" data-path="${doc.storagePath}" data-id="${doc.id}"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            card.querySelector('.btn-del').addEventListener('click', function () {
                if (_openConfirmModal) _openConfirmModal("¿Borrar?", async () => {
                    await deleteObject(ref(_storage, this.dataset.path));
                    await deleteDoc(doc(_db, "users", userId, "documents", this.dataset.id));
                    renderCards();
                });
            });
            othersContainer.appendChild(card);
        });
    };

    document.getElementById('btn-sst-add-other').addEventListener('click', () => {
        activeCatConfig = { id: 'sst_otros', requiresDate: false, label: 'Otros' };
        fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !activeCatConfig) return;

        const resetInput = () => { fileInput.value = ''; activeCatConfig = null; };

        let executedDate = null;
        let expDate = null;
        let desc = activeCatConfig.label;

        if (activeCatConfig.requiresDate) {
            // USAMOS EL MODAL TIPO FECHA
            const dStr = await openCustomInputModal(
                `Registrar ${activeCatConfig.label}`,
                `Fecha de ${activeCatConfig.dateLabel || 'Realización'} (AAAA-MM-DD):`,
                "date"
            );

            if (!dStr) { resetInput(); return; }

            executedDate = new Date(dStr + 'T00:00:00');
            if (isNaN(executedDate.getTime())) {
                window.showToast("Fecha inválida.", "error");
                resetInput();
                return;
            }

            expDate = new Date(executedDate);
            expDate.setMonth(expDate.getMonth() + activeCatConfig.validityMonths);

            window.showToast(`Vencimiento calculado: ${expDate.toLocaleDateString()}`, "info");

        } else if (activeCatConfig.id === 'sst_otros') {
            desc = await openCustomInputModal(
                "Nuevo Documento SST",
                "Descripción del documento:",
                "text",
                "Ej: Entrega de EPP especial..."
            );
            if (!desc) { resetInput(); return; }
        }

        window.showToast("Subiendo...", "info");

        try {
            const path = `expedientes/${userId}/SST/${activeCatConfig.id}_${Date.now()}_${file.name}`;
            const snap = await uploadBytes(ref(_storage, path), file);
            const url = await getDownloadURL(snap.ref);

            const data = {
                name: file.name, category: activeCatConfig.id, description: desc,
                url: url, storagePath: path, uploadedAt: serverTimestamp(), uploadedBy: _getCurrentUserId()
            };
            if (executedDate) { data.executedAt = executedDate; data.expiresAt = expDate; }

            await addDoc(collection(_db, "users", userId, "documents"), data);
            window.showToast("Guardado.", "success");
            renderCards();
        } catch (e) {
            console.error(e);
            window.showToast("Error en la subida.", "error");
        } finally {
            resetInput();
        }
    });

    renderCards();
}

// ----------------------------------------------------------
// SUB-MÓDULO 3: CONTROL DOTACIÓN (Lógica Existente Migrada)
// ----------------------------------------------------------
function loadSSTDotacionSubTab(container) {
    // Renderizamos el contenedor específico de alertas
    container.innerHTML = `
        <div class="flex justify-between items-center mb-4">
            <h3 class="font-bold text-gray-700">Inventario Asignado & Alertas</h3>
            <span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded border border-yellow-200">
                Vencimientos < 45 días
            </span>
        </div>
        <div id="sst-dotacion-alerts-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div class="col-span-full text-center text-gray-400 italic">Analizando datos...</div>
        </div>
    `;

    // Reutilizamos la lógica de query que ya funcionaba
    const q = query(
        collection(_db, "dotacionHistory"),
        where("action", "==", "asignada"),
        where("status", "==", "activo")
    );

    unsubscribeEmpleadosTab = onSnapshot(q, async (snapshot) => {
        const alertsContainer = document.getElementById('sst-dotacion-alerts-grid');
        if (!alertsContainer) return;

        if (snapshot.empty) {
            alertsContainer.innerHTML = `
                <div class="col-span-full py-10 text-center bg-green-50 rounded-lg border border-green-100">
                    <p class="text-green-700 font-bold">Todo al día</p>
                    <p class="text-green-600 text-xs">No hay dotación por vencer.</p>
                </div>`;
            return;
        }

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const alerts = [];
        const usersMap = _getUsersMap();

        // Carga eficiente de catálogo
        const catalogRefs = new Set(snapshot.docs.map(d => d.data().itemId));
        const catalogMap = new Map();
        for (const itemId of catalogRefs) {
            const snap = await getDoc(doc(_db, "dotacionCatalog", itemId));
            if (snap.exists()) catalogMap.set(itemId, snap.data());
        }

        snapshot.forEach(doc => {
            const entry = doc.data();
            const catalogItem = catalogMap.get(entry.itemId);

            if (catalogItem && catalogItem.vidaUtilDias && entry.fechaEntrega) {
                const delivery = new Date(entry.fechaEntrega + 'T00:00:00');
                const expiration = new Date(delivery);
                expiration.setDate(expiration.getDate() + catalogItem.vidaUtilDias);
                const diffDays = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24));

                if (diffDays <= 45) {
                    const user = usersMap.get(entry.userId);
                    alerts.push({
                        userId: entry.userId,
                        itemId: entry.itemId,
                        userName: user ? `${user.firstName} ${user.lastName}` : 'Desconocido',
                        itemName: entry.itemName,
                        fechaEntrega: delivery.toLocaleDateString('es-CO'),
                        diffDays: diffDays
                    });
                }
            }
        });

        if (alerts.length === 0) {
            alertsContainer.innerHTML = `
                <div class="col-span-full py-10 text-center bg-gray-50 rounded-lg border border-gray-200 border-dashed">
                    <p class="text-gray-500">Ningún EPP vence próximamente.</p>
                </div>`;
            return;
        }

        alerts.sort((a, b) => a.diffDays - b.diffDays);

        alertsContainer.innerHTML = alerts.map(item => {
            const isExpired = item.diffDays <= 0;
            const borderClass = isExpired ? 'border-red-500' : (item.diffDays <= 15 ? 'border-orange-500' : 'border-yellow-500');
            const statusText = isExpired ? `VENCIDO (${Math.abs(item.diffDays)}d)` : `Vence en ${item.diffDays}d`;
            const statusColor = isExpired ? 'text-red-600' : 'text-yellow-700';

            return `
                <div class="bg-white rounded-lg shadow-sm border-l-4 ${borderClass} p-3 hover:shadow transition-shadow border border-gray-100">
                    <div class="flex justify-between mb-1">
                        <span class="text-[10px] font-bold ${statusColor} uppercase tracking-wide">${statusText}</span>
                        <i class="fa-solid fa-triangle-exclamation ${statusColor}"></i>
                    </div>
                    <h4 class="font-bold text-gray-800 text-sm truncate">${item.itemName}</h4>
                    <p class="text-xs text-gray-500 mb-2">${item.userName}</p>
                    <button data-action="renew-dotacion" data-user-id="${item.userId}" data-item-id="${item.itemId}"
                            class="w-full mt-1 bg-gray-50 hover:bg-white border border-gray-200 text-gray-600 text-xs font-bold py-1.5 rounded transition-colors">
                        Renovar
                    </button>
                </div>
            `;
        }).join('');
    });
}

// Función auxiliar de alertas (sin cambios lógicos, solo render)
function loadSSTAlertsInSidePanel() {
    const q = query(collection(_db, "dotacionHistory"), where("action", "==", "asignada"), where("status", "==", "activo"));
    const usersMap = _getUsersMap();

    onSnapshot(q, async (snapshot) => {
        const alertsContainer = document.getElementById('sst-alerts-container');
        if (!alertsContainer) return;

        if (snapshot.empty) {
            alertsContainer.innerHTML = '<div class="p-3 bg-green-50 text-green-700 rounded text-xs text-center">Todo en orden.</div>';
            return;
        }

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const alerts = [];
        const catalogRefs = new Set(snapshot.docs.map(d => d.data().itemId));
        const catalogMap = new Map();

        for (const itemId of catalogRefs) {
            const snap = await getDoc(doc(_db, "dotacionCatalog", itemId));
            if (snap.exists()) catalogMap.set(itemId, snap.data());
        }

        snapshot.forEach(doc => {
            const entry = doc.data();
            const catalogItem = catalogMap.get(entry.itemId);
            if (catalogItem && catalogItem.vidaUtilDias && entry.fechaEntrega) {
                const delivery = new Date(entry.fechaEntrega + 'T00:00:00');
                const expiration = new Date(delivery);
                expiration.setDate(expiration.getDate() + catalogItem.vidaUtilDias);
                const diffDays = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24));

                if (diffDays <= 30) {
                    const user = usersMap.get(entry.userId);
                    alerts.push({
                        userId: entry.userId, itemId: entry.itemId,
                        userName: user ? `${user.firstName} ${user.lastName}` : '?',
                        itemName: entry.itemName, diffDays: diffDays
                    });
                }
            }
        });

        if (alerts.length === 0) {
            alertsContainer.innerHTML = '<div class="p-3 bg-green-50 text-green-700 rounded text-xs text-center">Sin vencimientos próximos.</div>';
            return;
        }

        alerts.sort((a, b) => a.diffDays - b.diffDays);

        alertsContainer.innerHTML = alerts.map(item => {
            const isExpired = item.diffDays <= 0;
            return `
                <div class="p-2 rounded border-l-2 ${isExpired ? 'border-red-500 bg-red-50' : 'border-yellow-500 bg-yellow-50'} shadow-sm">
                    <div class="flex justify-between items-start">
                        <div>
                            <p class="text-[10px] font-bold text-gray-500 uppercase">${item.userName}</p>
                            <p class="text-xs font-bold text-gray-800">${item.itemName}</p>
                            <p class="text-[10px] ${isExpired ? 'text-red-600 font-bold' : 'text-yellow-700'}">
                                ${isExpired ? `Venció hace ${Math.abs(item.diffDays)}d` : `Vence en ${item.diffDays}d`}
                            </p>
                        </div>
                    </div>
                    <button data-action="renew-dotacion" data-user-id="${item.userId}" data-item-id="${item.itemId}"
                        class="mt-2 w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 text-[10px] font-bold py-1 rounded transition-colors">
                        Renovar
                    </button>
                </div>
            `;
        }).join('');
    });
}

// 4. FUNCIÓN CORREGIDA: loadGlobalHistoryTab (Sin eval)
async function loadGlobalHistoryTab(container) {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];

    // 1. Estructura HTML
    container.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-md space-y-4">
            <div class="flex flex-col md:flex-row justify-between items-end gap-4 pb-4 border-b border-gray-100">
                <div>
                    <h3 class="text-lg font-bold text-gray-800">Historial Global de Pagos</h3>
                    <p class="text-sm text-gray-500">Consulta todos los movimientos de nómina.</p>
                </div>
                <div class="flex gap-2 items-end">
                    <div>
                        <label class="block text-xs font-medium text-gray-700">Desde</label>
                        <input type="date" id="global-history-start" class="border rounded px-2 py-1 text-sm" value="${firstDayOfMonth}">
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-700">Hasta</label>
                        <input type="date" id="global-history-end" class="border rounded px-2 py-1 text-sm" value="${todayStr}">
                    </div>
                    <button id="btn-filter-global-history" class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-1.5 px-4 rounded shadow transition-colors">
                        Filtrar
                    </button>
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                        <tr>
                            <th class="px-4 py-3">Fecha</th>
                            <th class="px-4 py-3">Empleado</th>
                            <th class="px-4 py-3">Concepto</th>
                            <th class="px-4 py-3 text-right">Valor Pagado</th>
                            <th class="px-4 py-3 text-center">Soporte</th>
                        </tr>
                    </thead>
                    <tbody id="global-history-table-body" class="divide-y divide-gray-100">
                        <tr><td colspan="5" class="text-center py-8 text-gray-400">Selecciona un rango y filtra para ver datos.</td></tr>
                    </tbody>
                    <tfoot class="bg-gray-50 font-bold text-gray-800">
                        <tr>
                            <td colspan="3" class="px-4 py-3 text-right">TOTAL PERIODO:</td>
                            <td id="global-history-total" class="px-4 py-3 text-right text-indigo-700">$ 0</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;

    const tbody = document.getElementById('global-history-table-body');
    const totalEl = document.getElementById('global-history-total');
    const btnFilter = document.getElementById('btn-filter-global-history');

    const fetchGlobalPayments = async () => {
        const start = document.getElementById('global-history-start').value;
        const end = document.getElementById('global-history-end').value;

        if (!start || !end) return;

        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-10"><div class="loader-small mx-auto"></div></td></tr>`;

        try {
            const startDate = new Date(start);
            const endDate = new Date(end);
            endDate.setHours(23, 59, 59);

            const q = query(
                collectionGroup(_db, 'paymentHistory'),
                where('createdAt', '>=', startDate),
                where('createdAt', '<=', endDate),
                orderBy('createdAt', 'desc')
            );

            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-gray-500">No se encontraron pagos en este rango.</td></tr>`;
                totalEl.textContent = "$ 0";
                return;
            }

            let totalPeriodo = 0;
            tbody.innerHTML = '';

            const usersMap = _getUsersMap();

            snapshot.forEach(docSnap => {
                const payment = docSnap.data();
                const userId = payment.userId || docSnap.ref.parent.parent.id;
                const user = usersMap.get(userId);
                const userName = user ? `${user.firstName} ${user.lastName}` : 'Usuario Desconocido';

                totalPeriodo += (payment.monto || 0);

                const dateStr = payment.createdAt ? payment.createdAt.toDate().toLocaleDateString('es-CO') : 'N/A';

                const tr = document.createElement('tr');
                tr.className = "hover:bg-gray-50 transition-colors";
                tr.innerHTML = `
                    <td class="px-4 py-3 text-gray-600">${dateStr}</td>
                    <td class="px-4 py-3 font-medium text-gray-900">${userName}</td>
                    <td class="px-4 py-3 text-gray-600">${payment.concepto}</td>
                    <td class="px-4 py-3 text-right font-bold text-gray-800">${currencyFormatter.format(payment.monto)}</td>
                    <td class="px-4 py-3 text-center">
                         <button class="view-global-voucher-btn text-blue-600 hover:text-blue-800 hover:bg-blue-50 p-1.5 rounded transition-colors" title="Ver Comprobante">
                            <i class="fa-solid fa-file-invoice-dollar text-lg"></i>
                        </button>
                    </td>
                `;

                // --- CORRECCIÓN AQUÍ: Llamada directa, sin eval ---
                tr.querySelector('.view-global-voucher-btn').addEventListener('click', () => {
                    // Asumimos que openPaymentVoucherModal está definida en este módulo o alcance
                    if (typeof openPaymentVoucherModal === 'function') {
                        openPaymentVoucherModal(payment, user || { firstName: 'Usuario', lastName: 'Eliminado', idNumber: 'N/A' });
                    } else {
                        console.error("Error: La función openPaymentVoucherModal no se encuentra.");
                        alert("No se pudo abrir el comprobante. Recarga la página e intenta de nuevo.");
                    }
                });
                // --------------------------------------------------

                tbody.appendChild(tr);
            });

            totalEl.textContent = currencyFormatter.format(totalPeriodo);

        } catch (error) {
            console.error("Error historial global:", error);
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-red-500 py-4">Error al cargar datos: ${error.message}</td></tr>`;
        }
    };

    btnFilter.addEventListener('click', fetchGlobalPayments);
    fetchGlobalPayments();
}

let unsubscribeProductividad = null;

/**
 * Muestra la vista de detalle de un empleado específico.
 * VERSIÓN SEGURA: No se rompe si faltan elementos en el HTML.
 */
export async function showEmpleadoDetails(userId) {
    _showView('empleado-details');

    // --- LIMPIEZA DE COMPONENTES (CORREGIDO) ---

    // 1. Limpiar Gráfica
    if (typeof destroyActiveChart === 'function') {
        destroyActiveChart();
    }

    // 2. Limpiar Mapa de Asistencia
    // IMPORTANTE: Usamos la variable local 'attendanceMapInstance', SIN 'window.'
    if (attendanceMapInstance) {
        attendanceMapInstance.remove();
        attendanceMapInstance = null;
        // También limpiamos la capa de marcadores por si acaso
        if (typeof attendanceMarkersLayer !== 'undefined') attendanceMarkersLayer = null;
    }
    // -----------------------------------------------

    // Guardar ID para las pestañas
    const detailsView = document.getElementById('empleado-details-view');
    if (detailsView) detailsView.dataset.currentUserId = userId;

    // --- CORRECCIÓN CLAVE: LIMPIAR CONTENEDOR DE PESTAÑAS ---
    const contentContainer = document.getElementById('empleado-details-content-container');
    if (contentContainer) {
        contentContainer.innerHTML = '';
    }

    const usersMap = _getUsersMap();
    const user = usersMap.get(userId);

    // Helper seguro
    const safeSetText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    if (!user) {
        safeSetText('empleado-details-name', 'Error: Usuario no encontrado');
        return;
    }

    // 1. Renderizar Encabezado
    const level = user.commissionLevel || 'principiante';
    const levelText = level.charAt(0).toUpperCase() + level.slice(1);

    safeSetText('empleado-details-name', `${user.firstName} ${user.lastName}`);
    const nameEl = document.getElementById('empleado-details-name');
    if (nameEl) nameEl.dataset.userId = userId;

    // Botón Logs
    if (nameEl) {
        const headerContainer = nameEl.parentElement;
        // Limpiar botón previo si existe
        const oldBtn = headerContainer.querySelector('.btn-audit-log');
        if (oldBtn) oldBtn.remove();

        const btnAudit = document.createElement('button');
        btnAudit.className = "btn-audit-log ml-3 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded border border-gray-300 transition-colors align-middle";
        btnAudit.innerHTML = '<i class="fa-solid fa-clock-rotate-left mr-1"></i> Logs';
        nameEl.insertAdjacentElement('afterend', btnAudit);
        btnAudit.onclick = () => {
            if (typeof window.openMainModal === 'function') window.openMainModal('view-audit-logs', { userId: userId });
        };
    }

    safeSetText('empleado-details-level', `Nivel: ${levelText}`);

    // (Los textos de cédula, email, etc. se llenarán al cargar la pestaña resumen)

    // 2. Configurar Navegación
    const tabsNav = document.getElementById('empleado-details-tabs-nav');
    if (tabsNav) {
        const newTabsNav = tabsNav.cloneNode(false);
        tabsNav.parentNode.replaceChild(newTabsNav, tabsNav);

        newTabsNav.innerHTML = `
            <button data-tab="resumen" class="empleado-details-tab-button active whitespace-nowrap py-4 px-4 border-b-2 font-medium text-sm text-blue-600 border-blue-500 hover:text-blue-800 transition-colors">
                <i class="fa-solid fa-chart-pie mr-2"></i> Resumen
            </button>
            <button data-tab="bitacora" class="empleado-details-tab-button whitespace-nowrap py-4 px-4 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors">
                <i class="fa-solid fa-book-journal-whills mr-2"></i> Bitácora
            </button>
            <button data-tab="asistencia" class="empleado-details-tab-button whitespace-nowrap py-4 px-4 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors">
                <i class="fa-solid fa-location-dot mr-2"></i> Reporte de Ingreso
            </button>
            <button data-tab="documentos" class="empleado-details-tab-button whitespace-nowrap py-4 px-4 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors">
                <i class="fa-solid fa-folder-open mr-2"></i> Expediente
            </button>
            <button data-tab="dotacion" class="empleado-details-tab-button whitespace-nowrap py-4 px-4 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors">
                <i class="fa-solid fa-helmet-safety mr-2"></i> Dotación
            </button>
        `;

        newTabsNav.addEventListener('click', (e) => {
            const button = e.target.closest('.empleado-details-tab-button');
            if (!button) return;

            newTabsNav.querySelectorAll('.empleado-details-tab-button').forEach(btn => {
                btn.classList.remove('active', 'border-blue-500', 'text-blue-600');
                btn.classList.add('border-transparent', 'text-gray-500');
            });

            button.classList.add('active', 'border-blue-500', 'text-blue-600');
            button.classList.remove('border-transparent', 'text-gray-500');

            const tabName = button.dataset.tab;
            switchEmpleadoDetailsTab(tabName, userId);
        });
    }

    // Carga inicial
    switchEmpleadoDetailsTab('resumen', userId);
}

/**
 * Carga el contenido de la pestaña "Productividad" (TABLA ACTUALIZADA EN TIEMPO REAL).
 */
async function loadProductividadTab(container) {

    // 1. Renderizar el "Shell"
    container.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-md">
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-50">
                        <tr>
                            <th class="px-6 py-3">Operario</th>
                            <th class="px-6 py-3 text-center">Nivel Comisión</th>
                            <th class="px-6 py-3 text-right">M² Asignados</th>
                            <th class="px-6 py-3 text-right">M² Completados</th>
                            <th class="px-6 py-3 text-center text-red-600">Días No Reportados</th>
                            <th class="px-6 py-3 text-right text-blue-600">Bonificación (Mes)</th>
                        </tr>
                    </thead>
                    <tbody id="empleados-prod-table-body">
                        <tr><td colspan="6" class="text-center py-10"><div class="loader mx-auto"></div><p class="mt-2 text-gray-500">Sincronizando datos...</p></td></tr>
                    </tbody>
                </table>
            </div>
            <p class="text-xs text-gray-400 mt-2 text-right">* Días no reportados calcula días hábiles (Lun-Sáb) sin registro de ingreso.</p>
        </div>
    `;

    // 2. Referencias
    const monthSelector = document.getElementById('empleado-month-selector');
    const tableBody = document.getElementById('empleados-prod-table-body');

    // Limpiar listener anterior si existe
    if (unsubscribeProductividad) {
        unsubscribeProductividad();
        unsubscribeProductividad = null;
    }

    // Función auxiliar días hábiles
    const countBusinessDays = (year, month) => {
        let count = 0;
        const startDate = new Date(year, month - 1, 1);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let endDate = new Date(year, month, 0);
        if (year === today.getFullYear() && (month - 1) === today.getMonth()) {
            endDate = today;
        } else if (endDate > today) {
            return 0;
        }

        let curDate = new Date(startDate);
        while (curDate <= endDate) {
            const dayOfWeek = curDate.getDay();
            if (dayOfWeek !== 0) count++; // Excluir Domingo
            curDate.setDate(curDate.getDate() + 1);
        }
        return count;
    };

    // --- CARGA DE DATOS EN TIEMPO REAL ---
    const qUsers = query(collection(_db, "users"), where("status", "==", "active"));
    
    unsubscribeProductividad = onSnapshot(qUsers, async (snapshot) => {
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-500">No se encontraron operarios activos.</td></tr>`;
            return;
        }

        // Obtener usuarios activos actualizados
        const activeUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Preparar fechas para consulta de stats
        const selectedMonthYear = monthSelector.value;
        const [selYear, selMonth] = selectedMonthYear.split('-').map(Number);
        const currentStatDocId = selectedMonthYear.replace('-', '_');
        
        const startOfMonth = new Date(selYear, selMonth - 1, 1);
        const endOfMonth = new Date(selYear, selMonth, 0, 23, 59, 59);
        const businessDays = countBusinessDays(selYear, selMonth);

        // Consultar Stats y Asistencia en paralelo para todos los usuarios activos
        const statPromises = activeUsers.map(op => getDoc(doc(_db, "employeeStats", op.id, "monthlyStats", currentStatDocId)));
        
        const attendancePromises = activeUsers.map(op => {
            const q = query(
                collection(_db, "users", op.id, "attendance_reports"),
                where("type", "==", "ingreso"),
                where("timestamp", ">=", startOfMonth),
                where("timestamp", "<=", endOfMonth)
            );
            return getDocs(q);
        });

        try {
            const [statSnapshots, attendanceSnapshots] = await Promise.all([
                Promise.all(statPromises),
                Promise.all(attendancePromises)
            ]);

            const empleadoData = activeUsers.map((operario, index) => {
                const statDoc = statSnapshots[index];
                const stats = statDoc.exists() ? statDoc.data() : {
                    metrosAsignados: 0, metrosCompletados: 0, totalBonificacion: 0
                };
                const attendanceCount = attendanceSnapshots[index].size;
                const missingDays = Math.max(0, businessDays - attendanceCount);

                return { ...operario, stats, missingDays };
            });

            empleadoData.sort((a, b) => b.stats.metrosCompletados - a.stats.metrosCompletados);

            tableBody.innerHTML = '';
            if (empleadoData.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-500">No hay datos para ${selectedMonthYear}.</td></tr>`;
            }

            empleadoData.forEach(data => {
                const row = document.createElement('tr');
                row.className = 'bg-white border-b hover:bg-gray-50 cursor-pointer transition-colors';
                row.dataset.action = "view-empleado-details";
                row.dataset.id = data.id;

                const level = data.commissionLevel || 'principiante';
                const levelText = level.charAt(0).toUpperCase() + level.slice(1);
                const roleRaw = data.role || 'operario';
                const roleDisplay = roleRaw.charAt(0).toUpperCase() + roleRaw.slice(1);

                let missingDaysHtml = `<span class="text-gray-400 font-bold">-</span>`;
                if (data.missingDays > 0) {
                    missingDaysHtml = `<span class="bg-red-100 text-red-700 px-2 py-1 rounded-full font-bold text-xs">${data.missingDays} días</span>`;
                } else {
                    missingDaysHtml = `<span class="text-green-600 font-bold text-xs"><i class="fa-solid fa-check"></i> Completo</span>`;
                }

                row.innerHTML = `
                    <td class="px-6 py-4 font-medium text-gray-900">
                        ${data.firstName} ${data.lastName}
                        <div class="text-[10px] text-gray-400 uppercase tracking-wide">${roleDisplay}</div>
                    </td>
                    <td class="px-6 py-4 text-center text-gray-600">${levelText}</td>
                    <td class="px-6 py-4 text-right font-medium text-gray-500">${(data.stats.metrosAsignados || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 text-right font-bold text-indigo-700 text-base">${(data.stats.metrosCompletados || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 text-center">${missingDaysHtml}</td>
                    <td class="px-6 py-4 text-right font-bold text-green-600">${currencyFormatter.format(data.stats.totalBonificacion || 0)}</td>
                `;
                
                // Listener de clic para detalles
                row.addEventListener('click', () => {
                     // Asumimos que showEmpleadoDetails está expuesta
                     if(window.showEmpleadoDetails) window.showEmpleadoDetails(data.id);
                     else console.warn("Función showEmpleadoDetails no encontrada");
                });

                tableBody.appendChild(row);
            });
            
        } catch (err) {
            console.error("Error procesando datos:", err);
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-red-500">Error de sincronización.</td></tr>`;
        }

    }, (error) => {
        console.error("Error en listener de usuarios:", error);
    });
}


/**
 * Carga el contenido de la pestaña "Nómina" (CON INTERRUPTOR DE PRÉSTAMOS).
 */
async function loadNominaTab(container) {
    // 1. ESTRUCTURA HTML MEJORADA
    container.innerHTML = `
        <div class="space-y-6">
            
            <div id="nomina-kpi-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 animate-pulse h-24"></div>
                <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 animate-pulse h-24"></div>
                <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 animate-pulse h-24"></div>
                <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 animate-pulse h-24"></div>
            </div>

            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                
                    <div class="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                        <button data-action="back-to-empleados-from-payment" class="text-slate-500 hover:text-blue-600 font-bold text-sm flex items-center gap-2 transition-colors">
                            <i class="fa-solid fa-arrow-left"></i> Volver a Lista
                        </button>
                        
                        <div class="flex bg-white rounded-lg shadow-sm border border-gray-200 p-1">
                        
                        <label class="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors h-[42px]">
                            <input type="checkbox" id="toggle-apply-loans" checked class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer">
                            <span class="text-xs font-bold text-slate-600 select-none">Aplicar Préstamos</span>
                        </label>

                        <div class="relative flex-grow md:flex-grow-0 group">
                             <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 group-focus-within:text-blue-500 transition-colors">
                                <i class="fa-solid fa-magnifying-glass"></i>
                            </div>
                            <input type="text" id="nomina-search" 
                                class="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full md:w-56 transition-all outline-none h-[42px]" 
                                placeholder="Buscar operario...">
                        </div>
                        
                        <button id="btn-export-nomina-excel" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-lg shadow-sm transition-all flex items-center gap-2 text-sm transform hover:-translate-y-0.5 h-[42px]">
                            <i class="fa-solid fa-file-excel"></i> Exportar
                        </button>
                    </div>
                </div>

                <div class="overflow-hidden rounded-xl border border-gray-200">
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm text-left" id="nomina-table">
                            <thead class="text-xs text-gray-500 uppercase bg-slate-50 border-b border-gray-200">
                                <tr>
                                    <th class="px-6 py-4 font-extrabold tracking-wider">Colaborador</th>
                                    <th class="px-6 py-4 font-extrabold tracking-wider text-center">Nivel</th>
                                    <th class="px-6 py-4 font-extrabold tracking-wider text-right">Básico</th>
                                    <th class="px-6 py-4 font-extrabold tracking-wider text-right text-emerald-600">Bonos (M²)</th>
                                    <th class="px-6 py-4 font-extrabold tracking-wider text-right text-rose-600">Deducciones</th>
                                    <th class="px-6 py-4 font-extrabold tracking-wider text-right text-blue-700">Neto a Pagar</th>
                                    <th class="px-6 py-4 font-extrabold tracking-wider text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody id="empleados-nomina-table-body" class="divide-y divide-gray-50">
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <div class="mt-4 flex justify-end items-center gap-2 text-xs text-gray-400 bg-gray-50 p-2 rounded-lg border border-gray-100 inline-block float-right">
                    <i class="fa-solid fa-circle-info text-blue-400"></i>
                    <p>Nota: Las deducciones de préstamos son estimadas. El valor final se ajusta al registrar el pago individual.</p>
                </div>
            </div>
        </div>
    `;

    // 2. Referencias DOM
    const monthSelector = document.getElementById('empleado-month-selector');
    const tableBody = document.getElementById('empleados-nomina-table-body');
    const kpiContainer = document.getElementById('nomina-kpi-container');
    const searchInput = document.getElementById('nomina-search');
    const exportBtn = document.getElementById('btn-export-nomina-excel');
    const toggleLoans = document.getElementById('toggle-apply-loans'); // <-- Nuevo Switch

    if (!monthSelector || !tableBody) return;

    const selectedMonthYear = monthSelector.value;
    const currentStatDocId = selectedMonthYear.replace('-', '_');

    // Loader
    tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-12"><div class="loader mx-auto mb-2"></div><p class="text-xs text-gray-400">Calculando nómina...</p></td></tr>`;

    try {
        const usersMap = _getUsersMap();
        const activeUsers = [];
        usersMap.forEach((user, id) => {
            if (user.status === 'active') activeUsers.push({ id, ...user });
        });

        if (activeUsers.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-gray-500">No se encontraron operarios activos.</td></tr>`;
            kpiContainer.innerHTML = '';
            return;
        }

        // 4. Obtener PRÉSTAMOS (Global)
        const loansQuery = query(collectionGroup(_db, 'loans'), where('status', '==', 'active'));
        const loansSnapshot = await getDocs(loansQuery);

        if (!document.getElementById('nomina-table')) return;

        const userLoansMap = new Map();
        loansSnapshot.forEach(doc => {
            const loan = doc.data();
            const userId = doc.ref.parent.parent.id;
            if (!userLoansMap.has(userId)) userLoansMap.set(userId, { totalBalance: 0, estimatedDeduction: 0 });

            const userData = userLoansMap.get(userId);
            userData.totalBalance += (loan.balance || 0);
            const installments = loan.installments > 0 ? loan.installments : 1;
            userData.estimatedDeduction += (loan.balance || 0) / installments;
        });

        // 5. Obtener ESTADÍSTICAS
        const statPromises = activeUsers.map(op => getDoc(doc(_db, "employeeStats", op.id, "monthlyStats", currentStatDocId)));
        const statSnapshots = await Promise.all(statPromises);

        if (!document.getElementById('nomina-table')) return;

        // 6. Procesar Datos BASE (Sin cálculos finales de totales todavía)
        const rawEmpleadoData = activeUsers.map((operario, index) => {
            const statDoc = statSnapshots[index];
            const stats = statDoc.exists() ? statDoc.data() : { totalBonificacion: 0 };
            const loanInfo = userLoansMap.get(operario.id) || { totalBalance: 0, estimatedDeduction: 0 };

            const basico = parseFloat(operario.salarioBasico) || 0;
            const bono = stats.totalBonificacion || 0;
            // Calculamos la deducción potencial (la máxima posible)
            const deductionPotential = Math.min(loanInfo.estimatedDeduction, loanInfo.totalBalance);

            return {
                id: operario.id,
                fullName: `${operario.firstName} ${operario.lastName}`,
                initials: (operario.firstName[0] + operario.lastName[0]).toUpperCase(),
                cedula: operario.idNumber || 'N/A',
                bankName: operario.bankName || 'N/A',
                accountNumber: operario.accountNumber || 'N/A',
                commissionLevel: operario.commissionLevel || 'principiante',
                role: operario.role || 'operario',
                salarioBasico: basico,
                bonificacion: bono,
                deduccionPotencial: deductionPotential, // Guardamos el valor potencial
                deudaTotal: loanInfo.totalBalance
            };
        });

        // --- FUNCIÓN CENTRALIZADA DE ACTUALIZACIÓN ---
        const updateView = () => {
            const applyLoans = toggleLoans.checked;
            const searchTerm = searchInput.value.toLowerCase();

            // A. Recalcular datos dinámicos
            const processedData = rawEmpleadoData.map(emp => {
                // Si el switch está apagado, la deducción aplicada es 0
                const deduccionAplicada = applyLoans ? emp.deduccionPotencial : 0;
                const totalPagar = emp.salarioBasico + emp.bonificacion - deduccionAplicada;

                return {
                    ...emp,
                    deduccionAplicada,
                    totalPagar
                };
            });

            // B. Filtrar
            const filteredData = processedData.filter(emp =>
                emp.fullName.toLowerCase().includes(searchTerm) ||
                emp.cedula.includes(searchTerm)
            );

            // C. Ordenar
            filteredData.sort((a, b) => b.totalPagar - a.totalPagar);

            // D. Calcular Totales Globales (de toda la lista procesada, no solo la filtrada, para los KPIs)
            let sumBasico = 0, sumBonificacion = 0, sumDeducciones = 0, sumTotal = 0;

            // Usamos 'processedData' para los KPIs generales, o 'filteredData' si quieres que los KPIs respondan a la búsqueda.
            // Usualmente en dashboards, los KPIs superiores muestran el total general.
            processedData.forEach(p => {
                sumBasico += p.salarioBasico;
                sumBonificacion += p.bonificacion;
                sumDeducciones += p.deduccionAplicada;
                sumTotal += p.totalPagar;
            });

            // E. Renderizar KPIs
            kpiContainer.innerHTML = `
                <div class="bg-white p-4 rounded-xl shadow-sm border border-blue-100 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xl"><i class="fa-solid fa-money-bill-wave"></i></div>
                    <div>
                        <p class="text-[10px] font-bold text-gray-400 uppercase">Nómina Estimada</p>
                        <h3 class="text-xl font-black text-gray-800">${currencyFormatter.format(sumTotal)}</h3>
                    </div>
                </div>
                <div class="bg-white p-4 rounded-xl shadow-sm border border-emerald-100 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl"><i class="fa-solid fa-chart-line"></i></div>
                    <div>
                        <p class="text-[10px] font-bold text-gray-400 uppercase">Bonificaciones</p>
                        <h3 class="text-xl font-black text-emerald-600">+ ${currencyFormatter.format(sumBonificacion)}</h3>
                    </div>
                </div>
                <div class="bg-white p-4 rounded-xl shadow-sm border border-red-100 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center text-xl"><i class="fa-solid fa-hand-holding-dollar"></i></div>
                    <div>
                        <p class="text-[10px] font-bold text-gray-400 uppercase">Deducciones ${applyLoans ? '' : '(Inactivas)'}</p>
                        <h3 class="text-xl font-black ${applyLoans ? 'text-red-600' : 'text-gray-300'}">- ${currencyFormatter.format(sumDeducciones)}</h3>
                    </div>
                </div>
                <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-slate-50 text-slate-600 flex items-center justify-center text-xl"><i class="fa-solid fa-users"></i></div>
                    <div>
                        <p class="text-[10px] font-bold text-gray-400 uppercase">Personal Activo</p>
                        <h3 class="text-xl font-black text-gray-800">${activeUsers.length}</h3>
                    </div>
                </div>
            `;

            // F. Renderizar Tabla
            tableBody.innerHTML = '';
            if (filteredData.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-gray-500">No se encontraron resultados.</td></tr>`;
            } else {
                filteredData.forEach(data => {
                    const row = document.createElement('tr');
                    row.className = 'bg-white hover:bg-blue-50 cursor-pointer transition-colors border-b border-slate-50 last:border-0 group';
                    row.dataset.action = "view-payment-history";
                    row.dataset.id = data.id;

                    const levelText = data.commissionLevel.charAt(0).toUpperCase() + data.commissionLevel.slice(1);

                    // Visualización condicional de la deducción
                    let dedHtml = `<span class="text-gray-300">-</span>`;
                    if (data.deduccionAplicada > 0) {
                        dedHtml = `<span class="text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded">- ${currencyFormatter.format(data.deduccionAplicada)}</span>`;
                    } else if (!applyLoans && data.deduccionPotencial > 0) {
                        // Si hay deuda pero el switch está apagado, mostramos un indicador gris
                        dedHtml = `<span class="text-gray-400 text-xs italic" title="Deuda existente no aplicada">(${currencyFormatter.format(data.deduccionPotencial)})</span>`;
                    }

                    row.innerHTML = `
                        <td class="px-6 py-4">
                            <div class="flex items-center gap-3">
                                <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold border border-indigo-200">
                                    ${data.initials}
                                </div>
                                <div>
                                    <p class="font-bold text-gray-800 text-sm leading-tight">${data.fullName}</p>
                                    <p class="text-[10px] text-gray-400 uppercase mt-0.5">${data.role}</p>
                                </div>
                            </div>
                        </td>
                        <td class="px-6 py-4 text-center">
                            <span class="px-2 py-1 rounded text-[10px] font-bold uppercase bg-gray-100 text-gray-600 border border-gray-200">${levelText}</span>
                        </td>
                        <td class="px-6 py-4 text-right font-medium text-gray-600 text-sm">${currencyFormatter.format(data.salarioBasico)}</td>
                        <td class="px-6 py-4 text-right font-bold text-emerald-600 text-sm">${currencyFormatter.format(data.bonificacion)}</td>
                        <td class="px-6 py-4 text-right text-sm">${dedHtml}</td>
                        <td class="px-6 py-4 text-right">
                            <span class="font-black text-blue-700 text-base">${currencyFormatter.format(data.totalPagar)}</span>
                        </td>
                        <td class="px-6 py-4 text-center">
                            <button class="btn-cert-laboral text-slate-400 hover:text-blue-600 hover:bg-blue-50 w-8 h-8 rounded-lg transition-all inline-flex items-center justify-center shadow-sm border border-transparent hover:border-blue-200" 
                                title="Generar Certificación" 
                                data-userid="${data.id}">
                                <i class="fa-solid fa-file-contract"></i>
                            </button>
                        </td>
                    `;

                    const certBtn = row.querySelector('.btn-cert-laboral');
                    if (certBtn) {
                        certBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const userFullData = _getUsersMap().get(data.id);
                            if (typeof window.openMainModal === 'function') window.openMainModal('generate-certification', userFullData);
                        });
                    }

                    tableBody.appendChild(row);
                });
            }
        };

        // 7. Listeners para interactividad
        toggleLoans.addEventListener('change', updateView);
        searchInput.addEventListener('input', updateView);

        exportBtn.addEventListener('click', () => {
            const applyLoans = toggleLoans.checked;
            // Recalculamos para exportación asegurándonos de tener la data fresca
            const dataForExport = rawEmpleadoData.map(emp => ({
                "Cédula": emp.cedula,
                "Nombre": emp.fullName,
                "Banco": emp.bankName,
                "Cuenta": emp.accountNumber,
                "Básico": emp.salarioBasico,
                "Bonos": emp.bonificacion,
                "Deducción": applyLoans ? emp.deduccionPotencial : 0,
                "Neto a Pagar": emp.salarioBasico + emp.bonificacion - (applyLoans ? emp.deduccionPotencial : 0)
            }));

            try {
                const ws = XLSX.utils.json_to_sheet(dataForExport);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Nomina");
                XLSX.writeFile(wb, `Nomina_${selectedMonthYear}.xlsx`);
            } catch (e) { alert("Error exportando Excel."); }
        });

        // 8. Renderizado Inicial
        updateView();

    } catch (error) {
        console.error("Error nómina:", error);
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-red-500">Error: ${error.message}</td></tr>`;
    }
}

// --- FUNCIÓN ACTUALIZADA: CARGAR BITÁCORA CON FILTRO ---
let unsubscribeBitacora = null;

function loadEmployeeBitacora(userId, startDateInput = null, endDateInput = null) {
    const container = document.getElementById('bitacora-list-container');
    if (!container) return;

    container.innerHTML = '<div class="flex justify-center py-10"><div class="loader"></div></div>';

    if (unsubscribeBitacora) unsubscribeBitacora();

    let q;
    if (startDateInput && endDateInput) {
        const start = new Date(startDateInput);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDateInput);
        end.setHours(23, 59, 59, 999);

        q = query(collection(_db, "users", userId, "daily_reports"), where("createdAt", ">=", start), where("createdAt", "<=", end), orderBy("createdAt", "desc"));
    } else {
        q = query(collection(_db, "users", userId, "daily_reports"), orderBy("createdAt", "desc"), limit(20));
    }

    unsubscribeBitacora = onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        if (snapshot.empty) {
            container.innerHTML = `<div class="text-center py-10 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-300"><i class="fa-solid fa-filter-circle-xmark text-2xl mb-2 text-gray-300"></i><p>No hay reportes.</p></div>`;
            return;
        }
        snapshot.forEach(doc => {
            const r = doc.data();
            const dateObj = r.createdAt ? r.createdAt.toDate() : new Date();
            const dateStr = dateObj.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
            const timeStr = dateObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

            const card = document.createElement('div');
            card.className = "bg-white p-4 rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-indigo-500 mb-3";
            card.innerHTML = `
                <div class="flex justify-between mb-2">
                    <h4 class="font-bold text-gray-800 capitalize">${dateStr}</h4>
                    <span class="text-xs bg-gray-100 px-2 py-1 rounded font-mono text-gray-500">${timeStr}</span>
                </div>
                <p class="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">${r.content}</p>
                <p class="text-[10px] text-right text-gray-400 mt-2 italic">Por: ${r.createdByName || 'Usuario'}</p>
            `;
            container.appendChild(card);
        });
    });
}



/**
 * Cambia el contenido visible en el detalle del empleado.
 * Crea dinámicamente los contenedores de las pestañas si no existen.
 */
function switchEmpleadoDetailsTab(tabName, userId) {
    // 1. Ocultar todos los contenidos previos
    document.querySelectorAll('.empleado-details-tab-content').forEach(content => {
        content.classList.add('hidden');
    });

    // 2. Buscar o Crear Contenedor de la pestaña
    let activeContent = document.getElementById(`empleado-tab-${tabName}`);

    if (!activeContent) {
        const parentContainer = document.getElementById('empleado-details-content-container');
        if (parentContainer) {
            activeContent = document.createElement('div');
            activeContent.id = `empleado-tab-${tabName}`;
            activeContent.className = 'empleado-details-tab-content mt-6 space-y-6';
            parentContainer.appendChild(activeContent);
        }
    }

    if (activeContent) activeContent.classList.remove('hidden');
    const user = _getUsersMap().get(userId);

    // 3. Lógica por pestaña
    switch (tabName) {
        case 'resumen':
            // Información del Resumen y Gráficas
            activeContent.innerHTML = `
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div class="lg:col-span-2 space-y-6">
                        <div class="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                            <h4 class="text-sm font-bold text-gray-500 uppercase mb-4">Productividad (Últimos 6 Meses)</h4>
                            <div class="relative h-64">
                                <canvas id="empleado-productivity-chart"></canvas>
                            </div>
                        </div>
                        
                        <div class="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                            <h4 class="text-sm font-bold text-gray-500 uppercase mb-4 flex items-center">
                                <i class="fa-solid fa-clock-rotate-left mr-2 text-blue-500"></i>
                                Reporte de Ingreso (Mes Actual)
                            </h4>
                            <div id="resumen-asistencia-kpi" class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                                <div class="text-center py-4"><div class="loader-small mx-auto"></div></div>
                            </div>
                            <div class="overflow-hidden rounded-lg border border-gray-100">
                                <table class="w-full text-sm text-left">
                                    <thead class="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
                                        <tr><th class="px-4 py-2">Fecha</th><th class="px-4 py-2">Hora</th><th class="px-4 py-2 text-center">Evidencia</th><th class="px-4 py-2 text-center">Ubicación</th></tr>
                                    </thead>
                                    <tbody id="resumen-asistencia-tbody" class="divide-y divide-gray-50"></tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div class="lg:col-span-1 space-y-6">
                        <div class="p-4 bg-white rounded-lg shadow border border-gray-200">
                            <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">Información de Contacto</h3>
                            <div class="space-y-2 text-sm text-gray-700">
                                <p><strong>Cédula:</strong> <span>${user?.idNumber || 'N/A'}</span></p>
                                <p><strong>Email:</strong> <span class="break-all">${user?.email || 'N/A'}</span></p>
                                <p><strong>Teléfono:</strong> <span>${user?.phone || 'N/A'}</span></p>
                                <p><strong>Dirección:</strong> <span>${user?.address || 'N/A'}</span></p>
                            </div>

                            <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-4 mt-6">Datos de Pago</h3>
                            <div class="space-y-2 text-sm text-gray-700">
                                <p><strong>Banco:</strong> <span>${user?.bankName || 'N/A'}</span></p>
                                <p><strong>Cuenta:</strong> <span>${user?.accountType || 'N/A'}</span></p>
                                <p><strong>Número:</strong> <span class="font-mono bg-gray-100 px-1 rounded select-all">${user?.accountNumber || 'N/A'}</span></p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            loadEmpleadoResumenTab(userId);
            break;

        case 'bitacora':
            // --- CORRECCIÓN CRÍTICA: Verificamos si existe el INPUT, no el contenedor ---
            // Esto obliga a redibujar si faltan los filtros
            if (!activeContent.querySelector('#bitacora-start')) {

                // Fechas: Mañana y 15 días atrás
                const dateTomorrow = new Date();
                dateTomorrow.setDate(dateTomorrow.getDate() + 1);
                const tomorrowStr = dateTomorrow.toISOString().split('T')[0];

                const datePast = new Date();
                datePast.setDate(datePast.getDate() - 15);
                const pastStr = datePast.toISOString().split('T')[0];

                activeContent.innerHTML = `
                    <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200 min-h-[500px]">
                        
                        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-gray-100 pb-4 gap-4">
                            <div>
                                <h3 class="text-xl font-bold text-gray-800 flex items-center">
                                    <i class="fa-solid fa-book-journal-whills text-indigo-600 mr-2"></i> Bitácora de Actividades
                                </h3>
                                <p class="text-sm text-gray-500">Historial de reportes diarios.</p>
                            </div>

                            <div class="flex flex-wrap items-end gap-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
                                <div>
                                    <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Desde</label>
                                    <input type="date" id="bitacora-start" class="border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500" value="${pastStr}">
                                </div>
                                <div>
                                    <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Hasta</label>
                                    <input type="date" id="bitacora-end" class="border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500" value="${tomorrowStr}">
                                </div>
                                <button id="btn-filter-bitacora" class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold py-1.5 px-4 rounded-md shadow-sm transition-colors h-[30px]">
                                    Filtrar
                                </button>
                            </div>
                        </div>

                        <div id="bitacora-list-container" class="space-y-4">
                            <p class="text-center text-gray-400 py-10">Cargando bitácora...</p>
                        </div>
                    </div>
                `;

                // Listener del Botón Filtrar
                const filterBtn = document.getElementById('btn-filter-bitacora');
                if (filterBtn) {
                    filterBtn.addEventListener('click', () => {
                        const s = document.getElementById('bitacora-start');
                        const e = document.getElementById('bitacora-end');
                        if (s && e) loadEmployeeBitacora(userId, s.value, e.value);
                    });
                }
            }

            // Carga inicial segura (usando los valores de los inputs creados)
            setTimeout(() => {
                const sInput = document.getElementById('bitacora-start');
                const eInput = document.getElementById('bitacora-end');

                if (sInput && eInput) {
                    loadEmployeeBitacora(userId, sInput.value, eInput.value);
                } else {
                    // Fallback de seguridad
                    const dT = new Date(); dT.setDate(dT.getDate() + 1);
                    const dP = new Date(); dP.setDate(dP.getDate() - 15);
                    loadEmployeeBitacora(userId, dP.toISOString().split('T')[0], dT.toISOString().split('T')[0]);
                }
            }, 100);
            break;

        case 'asistencia':
            // PASO 1: Limpieza TOTAL del mapa previo usando la variable LOCAL
            if (attendanceMapInstance) {
                attendanceMapInstance.remove(); // Destruye el mapa viejo correctamente
                attendanceMapInstance = null;
            }

            // PASO 2: Reconstruir HTML SIEMPRE
            activeContent.innerHTML = `
                <div class="flex justify-between items-center bg-white p-4 rounded-lg shadow border border-gray-200 mb-6">
                    <h3 class="text-lg font-bold text-gray-800">Historial de Asistencia</h3>
                    <div class="flex gap-2" id="attendance-controls-group">
                        <button type="button" data-range="7" class="range-btn bg-blue-100 text-blue-700 px-3 py-1 rounded-md text-sm font-bold border border-blue-200 transition-colors shadow-sm">7 Días</button>
                        <button type="button" data-range="15" class="range-btn bg-gray-100 text-gray-600 px-3 py-1 rounded-md text-sm font-bold border border-gray-200 transition-colors hover:bg-gray-200">15 Días</button>
                        <button type="button" data-range="30" class="range-btn bg-gray-100 text-gray-600 px-3 py-1 rounded-md text-sm font-bold border border-gray-200 transition-colors hover:bg-gray-200">30 Días</button>
                    </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    <div class="bg-white p-4 rounded-lg shadow border border-gray-200">
                        <h4 class="text-sm font-bold text-gray-500 uppercase mb-4">Tendencia de Llegada</h4>
                        <div class="relative h-64 w-full">
                            <canvas id="attendance-chart"></canvas>
                        </div>
                    </div>
                    
                    <div class="bg-white p-4 rounded-lg shadow border border-gray-200 flex flex-col">
                        <h4 class="text-sm font-bold text-gray-500 uppercase mb-4">Mapa de Reportes</h4>
                        <div id="attendance-map" class="flex-grow w-full h-64 rounded-lg border border-gray-300 z-0 relative bg-gray-100"></div>
                    </div>
                </div>

                <div class="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                    <div class="px-6 py-4 border-b border-gray-100 bg-gray-50">
                        <h4 class="text-sm font-bold text-gray-700">Bitácora de Registros</h4>
                    </div>
                    <div class="overflow-x-auto max-h-80 custom-scrollbar">
                        <table class="w-full text-sm text-left">
                            <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th class="px-6 py-3">Fecha</th>
                                    <th class="px-6 py-3">Hora</th>
                                    <th class="px-6 py-3 text-center">Evidencia</th>
                                    <th class="px-6 py-3 text-center">Mapa</th>
                                    <th class="px-6 py-3">Dispositivo</th>
                                </tr>
                            </thead>
                            <tbody id="attendance-list-body" class="divide-y divide-gray-100">
                                <tr><td colspan="5" class="text-center py-4 text-gray-400">Cargando datos...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            // PASO 3: Asignar Listeners a los botones
            const controls = activeContent.querySelector('#attendance-controls-group');
            if (controls) {
                controls.addEventListener('click', (e) => {
                    const btn = e.target.closest('.range-btn');
                    if (!btn) return;

                    // Estilos Visuales
                    controls.querySelectorAll('.range-btn').forEach(b => {
                        b.className = "range-btn bg-gray-100 text-gray-600 px-3 py-1 rounded-md text-sm font-bold border border-gray-200 transition-colors hover:bg-gray-200";
                    });
                    btn.className = "range-btn bg-blue-100 text-blue-700 px-3 py-1 rounded-md text-sm font-bold border border-blue-200 transition-colors shadow-sm";

                    // Cargar Datos
                    const range = parseInt(btn.dataset.range);
                    loadAttendanceTab(userId, range);
                });
            }

            // PASO 4: Carga Inicial (7 días)
            loadAttendanceTab(userId, 7);

            // Fix Mapa Leaflet
            setTimeout(() => {
                if (attendanceMapInstance) { // Sin window.
                    attendanceMapInstance.invalidateSize();
                }
            }, 300);
            break;

        case 'documentos':
            loadEmpleadoDocumentosTab(userId, activeContent);
            break;

        case 'dotacion':
            if (typeof window.loadDotacionAsignaciones === 'function') {
                window.loadDotacionAsignaciones(userId, `empleado-tab-dotacion`);
            }
            break;
    }
}


/**
 * Carga el contenido de la pestaña "Resumen":
 * 1. Gráfico de Productividad.
 * 2. Resumen de Asistencia (KPIs y Mini Tabla).
 */
async function loadEmpleadoResumenTab(userId) {
    // --- PARTE 1: GRÁFICO DE PRODUCTIVIDAD (Lógica existente) ---
    try {
        const labels = [];
        const dataBonificacion = [];
        const dataEnTiempo = [];
        const dataFueraTiempo = [];

        const today = new Date();
        const monthlyStatRefs = [];
        const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

        for (let i = 5; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const statDocId = `${year}_${month}`;

            labels.push(`${monthNames[d.getMonth()]} ${year}`);
            monthlyStatRefs.push(getDoc(doc(_db, "employeeStats", userId, "monthlyStats", statDocId)));
        }

        const statSnapshots = await Promise.all(monthlyStatRefs);

        statSnapshots.forEach(snap => {
            if (snap.exists()) {
                const stats = snap.data();
                dataBonificacion.push(stats.totalBonificacion || 0);
                dataEnTiempo.push(stats.metrosEnTiempo || 0);
                dataFueraTiempo.push(stats.metrosFueraDeTiempo || 0);
            } else {
                dataBonificacion.push(0);
                dataEnTiempo.push(0);
                dataFueraTiempo.push(0);
            }
        });

        const ctx = document.getElementById('empleado-productivity-chart');
        if (ctx) {
            createProductivityChart(ctx.getContext('2d'), labels, dataBonificacion, dataEnTiempo, dataFueraTiempo);
        }

    } catch (error) {
        console.error("Error al cargar gráfico de productividad:", error);
    }

    // --- PARTE 2: RESUMEN DE ASISTENCIA (NUEVA LÓGICA) ---
    const kpiContainer = document.getElementById('resumen-asistencia-kpi');
    const tableBody = document.getElementById('resumen-asistencia-tbody');

    if (!kpiContainer || !tableBody) return;

    try {
        // Consultar los últimos 30 registros de ingreso
        const q = query(
            collection(_db, "users", userId, "attendance_reports"),
            where("type", "==", "ingreso"),
            orderBy("timestamp", "desc"),
            limit(30)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            kpiContainer.innerHTML = `<div class="col-span-3 text-center text-gray-400 text-sm italic">Sin registros de ingreso recientes.</div>`;
            tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-400 text-xs">No hay datos.</td></tr>`;
            return;
        }

        const reports = snapshot.docs.map(d => d.data());
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        // A. Calcular KPIs del Mes Actual
        let daysWorked = 0;
        let totalMinutes = 0;
        let countForAvg = 0;

        const currentMonthReports = reports.filter(r => {
            const d = r.timestamp.toDate();
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        });

        daysWorked = currentMonthReports.length;

        currentMonthReports.forEach(r => {
            const d = r.timestamp.toDate();
            // Convertir hora a minutos desde medianoche (ej: 8:30 = 510 min)
            totalMinutes += (d.getHours() * 60) + d.getMinutes();
            countForAvg++;
        });

        let avgTimeStr = "---";
        if (countForAvg > 0) {
            const avgTotalMinutes = Math.round(totalMinutes / countForAvg);
            const avgH = Math.floor(avgTotalMinutes / 60);
            const avgM = avgTotalMinutes % 60;
            const ampm = avgH >= 12 ? 'PM' : 'AM';
            const displayH = avgH > 12 ? avgH - 12 : avgH;
            avgTimeStr = `${displayH}:${avgM.toString().padStart(2, '0')} ${ampm}`;
        }

        const lastReport = reports[0]; // El primero es el más reciente por el orderBy desc
        const lastDateStr = lastReport.timestamp.toDate().toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
        const lastTimeStr = lastReport.timestamp.toDate().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

        // Renderizar KPIs
        kpiContainer.innerHTML = `
            <div class="bg-blue-50 p-3 rounded-lg border border-blue-100 text-center">
                <p class="text-xs text-blue-500 font-bold uppercase">Días Trabajados</p>
                <p class="text-2xl font-bold text-blue-800">${daysWorked}</p>
                <p class="text-[10px] text-blue-400">Mes Actual</p>
            </div>
            <div class="bg-indigo-50 p-3 rounded-lg border border-indigo-100 text-center">
                <p class="text-xs text-indigo-500 font-bold uppercase">Promedio Llegada</p>
                <p class="text-2xl font-bold text-indigo-800">${avgTimeStr}</p>
                <p class="text-[10px] text-indigo-400">Hora estimada</p>
            </div>
            <div class="bg-green-50 p-3 rounded-lg border border-green-100 text-center">
                <p class="text-xs text-green-600 font-bold uppercase">Último Ingreso</p>
                <p class="text-lg font-bold text-green-800">${lastDateStr}</p>
                <p class="text-sm font-bold text-green-600">${lastTimeStr}</p>
            </div>
        `;

        // B. Renderizar Mini Tabla (Últimos 5)
        const last5 = reports.slice(0, 5);
        tableBody.innerHTML = last5.map(r => {
            const dateObj = r.timestamp.toDate();
            const dateStr = dateObj.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
            const timeStr = dateObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            const lat = r.location?.lat;
            const lng = r.location?.lng;

            return `
                <tr class="border-b border-gray-50 hover:bg-gray-50">
                    <td class="px-4 py-2 font-medium text-gray-700">${dateStr}</td>
                    <td class="px-4 py-2 text-blue-600 font-bold">${timeStr}</td>
                    <td class="px-4 py-2 text-center">
                        ${r.photoURL ?
                    `<button onclick="window.openImageModal('${r.photoURL}')" class="text-gray-400 hover:text-indigo-600 transition-colors" title="Ver Evidencia"><i class="fa-regular fa-image"></i></button>`
                    : '<span class="text-gray-300">-</span>'}
                    </td>
                    <td class="px-4 py-2 text-center">
                        ${lat && lng ?
                    `<a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" class="text-gray-400 hover:text-green-600 transition-colors" title="Ver Mapa"><i class="fa-solid fa-map-location-dot"></i></a>`
                    : '<span class="text-gray-300">-</span>'}
                    </td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error("Error al cargar resumen de asistencia:", error);
        kpiContainer.innerHTML = `<div class="col-span-3 text-center text-red-500 text-xs">Error cargando datos.</div>`;
    }
}

// 4. ACTUALIZAR loadEmpleadoDocumentosTab (EXPEDIENTE ESTRUCTURADO)
async function loadEmpleadoDocumentosTab(userId, container) {
    // --- CONFIGURACIÓN DE CASILLAS FIJAS ---
    const REQUIRED_DOCS = [
        { id: 'contrato', label: 'Contrato Laboral', icon: 'fa-file-signature', color: 'text-blue-600', bg: 'bg-blue-50' },
        { id: 'cedula', label: 'Cédula Ciudadanía', icon: 'fa-id-card', color: 'text-indigo-600', bg: 'bg-indigo-50' },
        { id: 'hoja_vida', label: 'Hoja de Vida', icon: 'fa-user-tie', color: 'text-slate-600', bg: 'bg-slate-50' },
        { id: 'examenes', label: 'Exámenes Médicos', icon: 'fa-user-doctor', color: 'text-emerald-600', bg: 'bg-emerald-50' },
        { id: 'seguridad_social', label: 'Seguridad Social', icon: 'fa-shield-heart', color: 'text-rose-600', bg: 'bg-rose-50' },
        { id: 'certificados', label: 'Certificados', icon: 'fa-graduation-cap', color: 'text-amber-600', bg: 'bg-amber-50' },
        { id: 'otros', label: 'Otros', icon: 'fa-folder-open', color: 'text-gray-600', bg: 'bg-gray-50' }
    ];

    const currentYear = new Date().getFullYear();

    container.innerHTML = `
        <div class="space-y-6">
            <div class="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                <div>
                    <h3 class="font-bold text-gray-800 flex items-center text-lg">
                        <i class="fa-solid fa-folder-tree mr-2 text-indigo-600"></i> Expediente Digital
                    </h3>
                </div>
                <div class="flex items-center gap-2">
                    <label class="text-sm font-bold text-gray-600">Vigencia:</label>
                    <select id="expediente-year-filter" class="border border-indigo-300 bg-indigo-50 text-indigo-900 font-bold text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2">
                        <option value="${currentYear + 1}">${currentYear + 1}</option>
                        <option value="${currentYear}" selected>${currentYear}</option>
                        <option value="${currentYear - 1}">${currentYear - 1}</option>
                        <option value="${currentYear - 2}">${currentYear - 2}</option>
                    </select>
                </div>
            </div>

            <div id="documents-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
        </div>
        
        <input type="file" id="global-doc-upload" class="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp">
    `;

    const gridContainer = document.getElementById('documents-grid');
    const yearFilter = document.getElementById('expediente-year-filter');
    const fileInput = document.getElementById('global-doc-upload');

    let activeSlotId = null;

    const renderSlots = async (year) => {
        gridContainer.innerHTML = `<div class="col-span-full text-center py-10"><div class="loader-small mx-auto"></div></div>`;

        try {
            const q = query(collection(_db, "users", userId, "documents"));
            const snapshot = await getDocs(q);
            const docsMap = new Map();

            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                let docYear = data.year;
                // Fallback para documentos viejos sin año: usar fecha de subida
                if (!docYear && data.uploadedAt) docYear = data.uploadedAt.toDate().getFullYear();

                if (String(docYear) === String(year)) {
                    docsMap.set(data.category, { id: docSnap.id, ...data });
                }
            });

            gridContainer.innerHTML = '';

            REQUIRED_DOCS.forEach(slot => {
                const existingDoc = docsMap.get(slot.id);
                const card = document.createElement('div');

                if (existingDoc) {
                    // LLENO
                    const dateStr = existingDoc.uploadedAt ? existingDoc.uploadedAt.toDate().toLocaleDateString('es-CO') : 'N/A';
                    let fileIcon = existingDoc.type?.includes('pdf') ? 'fa-file-pdf text-red-500' : 'fa-file-image text-blue-500';

                    card.className = "bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-all relative group overflow-hidden";
                    card.innerHTML = `
                        <div class="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
                        <div class="flex justify-between items-start mb-3 pl-2">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-lg ${slot.bg} flex items-center justify-center">
                                    <i class="fa-solid ${slot.icon} ${slot.color} text-lg"></i>
                                </div>
                                <div>
                                    <h5 class="text-sm font-bold text-gray-800">${slot.label}</h5>
                                    <span class="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold">CARGADO</span>
                                </div>
                            </div>
                            <div class="text-right"><i class="fa-solid ${fileIcon} text-xl"></i></div>
                        </div>
                        <div class="pl-2 mb-3">
                            <p class="text-xs text-gray-500 truncate" title="${existingDoc.name}">${existingDoc.name}</p>
                            <p class="text-[10px] text-gray-400">Subido: ${dateStr}</p>
                        </div>
                        <div class="flex gap-2 pl-2">
                            <a href="${existingDoc.url}" target="_blank" class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold py-2 rounded text-center transition-colors"><i class="fa-solid fa-eye mr-1"></i> Ver</a>
                            <button class="btn-delete-doc flex-1 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold py-2 rounded text-center transition-colors" 
                                data-id="${existingDoc.id}" data-path="${existingDoc.storagePath}" data-name="${existingDoc.name}">
                                <i class="fa-solid fa-trash mr-1"></i> Borrar
                            </button>
                        </div>
                    `;
                    card.querySelector('.btn-delete-doc').addEventListener('click', function () {
                        openConfirmModal(`¿Eliminar documento?`, async () => {
                            try {
                                await deleteObject(ref(_storage, this.dataset.path));
                                await deleteDoc(doc(_db, "users", userId, "documents", this.dataset.id));
                                window.showToast("Eliminado.", "success");
                                renderSlots(year);
                            } catch (e) { console.error(e); window.showToast("Error al eliminar.", "error"); }
                        });
                    });
                } else {
                    // VACÍO
                    card.className = "border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center text-center hover:border-indigo-400 hover:bg-gray-50 transition-all cursor-pointer group min-h-[160px]";
                    card.innerHTML = `
                        <div class="w-12 h-12 rounded-full bg-gray-100 group-hover:bg-indigo-100 flex items-center justify-center mb-3 transition-colors">
                            <i class="fa-solid ${slot.icon} text-gray-400 group-hover:text-indigo-600 text-xl"></i>
                        </div>
                        <h5 class="text-sm font-bold text-gray-600 group-hover:text-indigo-800 mb-1">${slot.label}</h5>
                        <p class="text-xs text-gray-400 mb-3">Pendiente ${year}</p>
                        <span class="bg-white border border-gray-300 text-gray-600 text-xs font-bold py-1 px-3 rounded-full shadow-sm group-hover:border-indigo-500 group-hover:text-indigo-600">
                            <i class="fa-solid fa-cloud-arrow-up mr-1"></i> Subir
                        </span>
                    `;
                    card.onclick = () => {
                        activeSlotId = slot.id;
                        fileInput.click();
                    };
                }
                gridContainer.appendChild(card);
            });
        } catch (error) {
            console.error(error);
            gridContainer.innerHTML = `<p class="col-span-full text-red-500 text-center">Error cargando expediente.</p>`;
        }
    };

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !activeSlotId) return;
        const selectedYear = yearFilter.value;
        const slotInfo = REQUIRED_DOCS.find(s => s.id === activeSlotId);

        if (file.size > 5 * 1024 * 1024) {
            window.showToast("Archivo muy pesado (Máx 5MB).", "error");
            return;
        }

        window.showToast("Subiendo...", "info");
        try {
            const storagePath = `expedientes/${userId}/${selectedYear}/${activeSlotId}_${Date.now()}_${file.name}`;
            const storageRef = ref(_storage, storagePath);
            const snapshot = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);

            await addDoc(collection(_db, "users", userId, "documents"), {
                name: file.name,
                category: activeSlotId,
                description: slotInfo ? slotInfo.label : 'Documento',
                year: parseInt(selectedYear),
                url: downloadURL,
                storagePath: storagePath,
                type: file.type,
                size: file.size,
                uploadedAt: serverTimestamp(),
                uploadedBy: _getCurrentUserId()
            });

            window.showToast("Subido con éxito.", "success");
            renderSlots(selectedYear);
        } catch (error) {
            console.error(error);
            window.showToast("Error en subida.", "error");
        } finally {
            fileInput.value = '';
            activeSlotId = null;
        }
    });

    yearFilter.addEventListener('change', (e) => renderSlots(e.target.value));
    renderSlots(currentYear);
}

/**
 * Abre el modal de Comprobante de Pago.
 * ADAPTADO: Incluye Vacaciones, Liquidación detallada, Logos y Firmas dinámicas.
 */
async function openPaymentVoucherModal(payment, user) {
    const modal = document.getElementById('payment-voucher-modal');
    
    const earningsList = document.getElementById('voucher-earnings-list');
    const deductionsList = document.getElementById('voucher-deductions-list');

    if (!modal) return;

    // ============================================================
    // 1. LIMPIEZA DE DOM
    // ============================================================
    const modalBody = modal.querySelector('.p-8') || modal.querySelector('.bg-white');

    const existingDynamic = document.getElementById('voucher-dynamic-header');
    if (existingDynamic) existingDynamic.remove();

    const oldSigs = document.getElementById('voucher-dynamic-signatures');
    if (oldSigs) oldSigs.remove();
    
    const oldDateEl = document.getElementById('voucher-date');
    if (oldDateEl) oldDateEl.innerHTML = '';
    
    const oldContractDates = document.getElementById('voucher-contract-dates');
    if (oldContractDates) oldContractDates.remove();

    modalBody.querySelectorAll('h3, h2').forEach(el => {
        if (el.textContent.includes('Comprobante') || (el.id !== 'voucher-concept' && el.id !== 'voucher-employee-name')) {
             if (!el.id) el.style.display = 'none'; 
        }
    });

    // ============================================================
    // 2. CONFIGURAR TEMA
    // ============================================================
    let title = 'COMPROBANTE DE NÓMINA';
    let subtitle = 'Pago Periódico';
    let themeColor = 'text-blue-600';
    let themeBg = 'bg-blue-50';
    let themeBorder = 'border-blue-200';
    let icon = 'fa-money-check-dollar';

    const concepto = (payment.concepto || '').toLowerCase();

    if (concepto.includes('prima')) {
        title = 'PRIMA DE SERVICIOS';
        subtitle = 'Prestación Social';
        themeColor = 'text-indigo-700';
        themeBg = 'bg-indigo-50';
        themeBorder = 'border-indigo-200';
        icon = 'fa-gift';
    } else if (concepto.includes('cesant')) {
        title = 'CESANTÍAS (FONDO)';
        subtitle = 'Liquidación Anual';
        themeColor = 'text-emerald-700';
        themeBg = 'bg-emerald-50';
        themeBorder = 'border-emerald-200';
        icon = 'fa-piggy-bank';
    } else if (concepto.includes('vacaciones')) {
        title = 'COMPROBANTE DE VACACIONES';
        subtitle = 'Novedad de Nómina';
        themeColor = 'text-cyan-700';
        themeBg = 'bg-cyan-50';
        themeBorder = 'border-cyan-200';
        icon = 'fa-umbrella-beach';
    } else if (concepto.includes('liquidaci')) {
        title = 'LIQUIDACIÓN FINAL';
        subtitle = 'Cierre de Contrato';
        themeColor = 'text-red-700';
        themeBg = 'bg-red-50';
        themeBorder = 'border-red-200';
        icon = 'fa-door-open';
    }

    // ============================================================
    // CORRECCIÓN DE FECHA: Soporte para Timestamp, JSON o String
    // ============================================================
    let dateObj = new Date();

    if (payment.createdAt) {
        // Caso A: Es un Timestamp de Firestore real (tiene la función)
        if (typeof payment.createdAt.toDate === 'function') {
            dateObj = payment.createdAt.toDate();
        } 
        // Caso B: Es un objeto plano recuperado de JSON (tiene seconds)
        else if (payment.createdAt.seconds) {
            dateObj = new Date(payment.createdAt.seconds * 1000);
        } 
        // Caso C: Es un string ISO o un objeto Date
        else {
            dateObj = new Date(payment.createdAt);
        }
    } else if (payment.paymentDate) {
        // Caso D: Fecha manual tipo "2023-12-31"
        dateObj = new Date(payment.paymentDate + 'T00:00:00');
    }

    const dateStr = dateObj.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });

    // ============================================================
    // 3. OBTENER DATOS EMPRESA
    // ============================================================
    let companyName = "Empresa";
    let companyNit = "";
    let companyLogo = null;
    let managerSignature = null;

    try {
        if (window.companyHeaderCache) {
            companyName = window.companyHeaderCache.nombre;
            companyNit = window.companyHeaderCache.nit;
            companyLogo = window.companyHeaderCache.logo;
            managerSignature = window.companyHeaderCache.signature;
        } else {
            const snap = await getDoc(doc(_db, "system", "generalConfig"));
            if(snap.exists()) {
                const data = snap.data();
                const emp = data.empresa || {}; 
                
                companyName = emp.nombre || companyName;
                companyNit = emp.nit ? `NIT: ${emp.nit}` : "";
                
                // Buscar Logo (Prioridad a tu configuración 'logoURL')
                companyLogo = emp.logoURL || data.logoURL || emp.empresaLogoURL || data.empresaLogoURL || emp.logo || null;
                
                // Buscar Firma
                managerSignature = emp.firmaGerenteURL || data.firmaGerenteURL || emp.empresaFirmaURL || data.empresaFirmaURL || null;
                
                window.companyHeaderCache = { nombre: companyName, nit: companyNit, logo: companyLogo, signature: managerSignature };
            }
        }
    } catch(e) { console.log("Error config", e); }

    // ============================================================
    // 4. HEADER UI
    // ============================================================
    let visualElementHtml = '';
    if (companyLogo) {
        visualElementHtml = `<div class="mb-4 flex justify-center"><img src="${companyLogo}" alt="Logo" class="h-24 w-auto object-contain p-1 bg-white"></div>`;
    } else {
        visualElementHtml = `<div class="flex justify-center mb-3"><div class="w-14 h-14 ${themeBg} rounded-full flex items-center justify-center ${themeColor} text-2xl shadow-sm border-2 ${themeBorder}"><i class="fa-solid ${icon}"></i></div></div>`;
    }

    const headerDiv = document.createElement('div');
    headerDiv.id = 'voucher-dynamic-header';
    headerDiv.className = `text-center mb-6 pb-4 border-b-2 border-dashed ${themeBorder}`;
    headerDiv.innerHTML = `${visualElementHtml}<h2 class="text-xl font-black text-gray-800 uppercase tracking-tight leading-none mb-1">${companyName}</h2><p class="text-xs text-gray-500 font-mono mb-4">${companyNit}</p><div class="flex flex-wrap justify-center items-center gap-3"><div class="inline-block ${themeBg} ${themeColor} px-4 py-1.5 rounded-lg border ${themeBorder} shadow-sm"><p class="text-xs font-bold uppercase tracking-widest">${title}</p></div><div class="h-8 w-px bg-gray-300 hidden sm:block"></div><div class="text-left bg-gray-50 px-3 py-1 rounded border border-gray-100"><p class="text-[9px] text-gray-400 uppercase leading-none font-bold">Fecha de Emisión</p><p class="text-xs font-bold text-gray-700 leading-tight mt-0.5">${dateStr}</p></div></div><p class="text-[10px] text-gray-400 mt-2 uppercase tracking-wide">${subtitle}</p>`;
    
    if (modalBody.firstChild) modalBody.insertBefore(headerDiv, modalBody.firstChild);

    // ============================================================
    // 5. DATOS BASE Y HELPERS (IMPORTANTE: Definidos AQUÍ)
    // ============================================================
    document.getElementById('voucher-employee-name').textContent = `${user.firstName} ${user.lastName}`;
    document.getElementById('voucher-employee-id').textContent = user.idNumber ? `CC: ${user.idNumber}` : '';
    document.getElementById('voucher-concept').textContent = payment.concepto;
    
    const totalEl = document.getElementById('voucher-total');
    totalEl.textContent = currencyFormatter.format(payment.monto);
    totalEl.className = `text-3xl font-black ${themeColor}`;

    // Helper: Parsear moneda
    const parseMoney = (val) => {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        return parseFloat(String(val).replace(/[$. \u00A0]/g, '').replace(',', '.')) || 0;
    };

    // Helper: Crear Fila (DEFINIDO ANTES DE USAR)
    const createRow = (label, val, isBold = false, formula = '') => {
        const displayVal = typeof val === 'number' ? currencyFormatter.format(val) : val;
        let formulaHtml = formula ? `<div class="text-[9px] text-gray-400 mt-0.5 italic tracking-tight">${formula}</div>` : '';

        return `<li class="flex justify-between items-start py-2 border-b border-gray-50 last:border-0 text-sm">
            <div class="flex flex-col pr-2">
                <span class="${isBold ? 'font-bold text-gray-700' : 'text-gray-500'} leading-tight">${label}</span>
                ${formulaHtml}
            </div>
            <span class="font-bold text-gray-800 whitespace-nowrap">${displayVal}</span>
        </li>`;
    };
    
    earningsList.innerHTML = '';
    deductionsList.innerHTML = '';
    const det = payment.details || {};
    const d = payment.desglose || {};

    // ============================================================
    // 6. RENDERIZADO DE CONCEPTOS
    // ============================================================

    // --- FECHAS DE CONTRATO (Solo Liquidación) ---
    if (concepto.includes('liquidaci') && det.fechaIngreso && det.fechaRetiro) {
        const datesDiv = document.createElement('div');
        datesDiv.id = 'voucher-contract-dates';
        datesDiv.className = "mb-6 grid grid-cols-2 gap-4 bg-gray-50 p-3 rounded-lg border border-gray-100";
        datesDiv.innerHTML = `
            <div class="text-center border-r border-gray-200"><p class="text-[10px] text-gray-400 uppercase font-bold">Inicio Contrato</p><p class="text-sm font-bold text-gray-800">${det.fechaIngreso}</p></div>
            <div class="text-center"><p class="text-[10px] text-gray-400 uppercase font-bold">Fecha Retiro</p><p class="text-sm font-bold text-gray-800">${det.fechaRetiro}</p></div>
        `;
        const empBlock = document.getElementById('voucher-employee-name').parentElement.parentElement;
        empBlock.insertAdjacentElement('afterend', datesDiv);
    }

    if (concepto.includes('prima')) {
        earningsList.innerHTML += createRow('Valor Prima', payment.monto, true);
        if (det.rangoFechas) earningsList.innerHTML += createRow('Periodo', det.rangoFechas);
        if (det.diasSemestre) earningsList.innerHTML += createRow('Días Liquidados', `${det.diasSemestre}`);
        if (det.baseCalculo) earningsList.innerHTML += createRow('Base Promedio', det.baseCalculo);
        deductionsList.innerHTML = '<li class="text-xs text-gray-300 text-center py-2 italic">Sin deducciones</li>';

    } else if (concepto.includes('cesant')) {
        earningsList.innerHTML += createRow('Valor Fondo', payment.monto, true);
        if (det.periodo) earningsList.innerHTML += createRow('Periodo', det.periodo);
        if (det.base) earningsList.innerHTML += createRow('Base', det.base);
        if (det.dias) earningsList.innerHTML += createRow('Días', `${det.dias}`);
        if (det.interesesCalculados) {
             earningsList.innerHTML += `<li class="mt-2 p-2 bg-yellow-50 text-xs text-center text-yellow-800 rounded border border-yellow-100">Intereses (12%): <strong>${currencyFormatter.format(det.interesesCalculados)}</strong><br>(Pagados aparte)</li>`;
        }
        deductionsList.innerHTML = '<li class="text-xs text-gray-300 text-center py-2 italic">Consignación Fondo</li>';

    } else if (concepto.includes('vacaciones')) {
        // --- VACACIONES ---
        earningsList.innerHTML += createRow('Pago Vacaciones', payment.monto, true);
        if (det.diasPagados) earningsList.innerHTML += createRow('Días Pagados', `${det.diasPagados} días`);
        if (det.tipoVacaciones) {
            const labelTipo = det.tipoVacaciones === 'dinero' ? 'Compensadas en Dinero' : 'Disfrute (Tiempo)';
            earningsList.innerHTML += createRow('Modalidad', labelTipo);
        }
        if (det.periodoNota) earningsList.innerHTML += createRow('Nota', det.periodoNota);
        deductionsList.innerHTML = '<li class="text-xs text-gray-300 text-center py-2 italic">Sin deducciones</li>';

    } else if (concepto.includes('liquidaci')) {
        // --- LIQUIDACIÓN DETALLADA ---
        const baseP = det.basePrestacional ? currencyFormatter.format(det.basePrestacional) : 'Base';
        const baseS = det.baseSalarial ? currencyFormatter.format(det.baseSalarial) : 'Salario';
        const dias = det.diasLiquidados || 'Días';

        // Cesantías
        if(det.cesantias && parseMoney(det.cesantias) > 0) 
            earningsList.innerHTML += createRow('Cesantías', det.cesantias, false, `${baseP} x ${dias} / 360`);
        
        // Intereses
        if(det.intereses && parseMoney(det.intereses) > 0) 
            earningsList.innerHTML += createRow('Intereses Cesantías', det.intereses, false, `12% sobre Cesantías`);
        
        // Prima
        if(det.prima && parseMoney(det.prima) > 0) 
            earningsList.innerHTML += createRow('Prima Servicios', det.prima, false, `Proporcional (Menos anticipos)`);
        
        // Vacaciones
        if(det.vacaciones && parseMoney(det.vacaciones) > 0) 
            earningsList.innerHTML += createRow('Vacaciones', det.vacaciones, false, `${baseS} x Días Pend. / 720`);
        
        // Indemnización (Solo si > 0)
        if(parseMoney(det.indemnizacion) > 0) 
            earningsList.innerHTML += createRow('Indemnización', det.indemnizacion, true, 'Despido sin justa causa');

        // Deducciones
        let totalDed = 0;
        if(det.deducciones) totalDed += parseMoney(det.deducciones);
        if(totalDed > 0) deductionsList.innerHTML += createRow('Préstamos Pendientes', totalDed, true);
        else deductionsList.innerHTML = '<li class="text-xs text-gray-300 text-center py-2 italic">Sin deducciones</li>';

    } else {
        // --- NÓMINA NORMAL ---
        let displaySalario = d.salarioProrrateado;
        let displayBonificacion = d.bonificacionM2 || 0;
        let labelSalario = `Salario Básico (${payment.diasPagados} días)`;

        if (d.deduccionSobreMinimo && d.baseDeduccion > 0) {
             if (displaySalario > d.baseDeduccion) {
                const excedente = displaySalario - d.baseDeduccion;
                displaySalario = d.baseDeduccion; 
                labelSalario = `Salario Básico (Min. Legal)`;
                displayBonificacion += excedente; 
            }
        }

        if (displaySalario > 0) earningsList.innerHTML += createRow(labelSalario, displaySalario);
        if (d.auxilioTransporteProrrateado > 0) earningsList.innerHTML += createRow('Aux. Transporte', d.auxilioTransporteProrrateado);
        if (d.horasExtra > 0) earningsList.innerHTML += createRow('Horas Extra', d.horasExtra);
        
        if (displayBonificacion > 0) {
            const labelBono = (d.deduccionSobreMinimo) ? 'Bonificación / Aux. No Salarial' : 'Bonificación';
            earningsList.innerHTML += createRow(labelBono, displayBonificacion, true);
        }
        
        if (d.otros) earningsList.innerHTML += createRow('Otros', d.otros);

        if (d.deduccionSalud) deductionsList.innerHTML += createRow('Salud', Math.abs(d.deduccionSalud));
        if (d.deduccionPension) deductionsList.innerHTML += createRow('Pensión', Math.abs(d.deduccionPension));
        if (d.abonoPrestamos) deductionsList.innerHTML += createRow('Préstamos', d.abonoPrestamos);
        if (d.otros < 0) deductionsList.innerHTML += createRow('Otras', Math.abs(d.otros));
    }

    // --- 7. FIRMAS ---
    const signaturesDiv = document.createElement('div');
    signaturesDiv.id = 'voucher-dynamic-signatures';
    signaturesDiv.className = "mt-12 flex justify-around text-center items-end";
    
    let managerSigHtml = '<div class="h-16 w-full"></div>';
    if (managerSignature) {
        managerSigHtml = `<img src="${managerSignature}" alt="Firma" class="h-16 w-auto object-contain mx-auto mb-1">`;
    }

    signaturesDiv.innerHTML = `
        <div class="w-1/3 flex flex-col justify-end">
            ${managerSigHtml}
            <div class="border-t border-gray-400 mb-2 w-full"></div>
            <p class="text-[10px] font-bold text-gray-600 uppercase">Firma Empresa</p>
            <p class="text-[9px] text-gray-400 truncate">${companyName}</p>
        </div>
        <div class="w-1/3 flex flex-col justify-end">
            <div class="h-16 w-full"></div>
            <div class="border-t border-gray-400 mb-2 w-full"></div>
            <p class="text-[10px] font-bold text-gray-600 uppercase">Recibí Conforme</p>
            <p class="text-[9px] text-gray-400">C.C. ${user.idNumber || '---'}</p>
        </div>
    `;
    modalBody.appendChild(signaturesDiv);

    // --- 8. MOSTRAR ---
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    const closeModal = () => { modal.style.display = 'none'; };
    const btnX = document.getElementById('voucher-close-btn');
    const btnF = document.getElementById('voucher-close-footer-btn');
    
    if(btnX) { const n = btnX.cloneNode(true); btnX.parentNode.replaceChild(n, btnX); n.onclick = closeModal; }
    if(btnF) { const n = btnF.cloneNode(true); btnF.parentNode.replaceChild(n, btnF); n.onclick = closeModal; }
}

/** * (FUNCIÓN CORREGIDA) 
 * Maneja la subida de un documento de empleado.
 */
async function handleDocumentUpload(e) {
    if (!e.target.classList.contains('upload-empleado-doc-input')) return;

    const file = e.target.files[0];
    const docType = e.target.dataset.docType;
    const userId = document.getElementById('empleado-details-name').dataset.userId;

    if (!file || !docType || !userId) return;

    const label = e.target.closest('label');
    label.textContent = 'Subiendo...';
    label.style.pointerEvents = 'none';

    try {
        const storageRef = ref(_storage, `employee_documents/${userId}/${docType}/${file.name}`);
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        // Usamos setDoc con el docType como ID para evitar duplicados
        // Esto sobrescribirá el documento anterior si suben uno nuevo
        const docRef = doc(_db, "users", userId, "documents", docType);

        await setDoc(docRef, {
            type: docType,
            name: file.name,
            url: downloadURL,
            uploadedAt: serverTimestamp()
        });

    } catch (error) {
        console.error("Error al subir documento de empleado:", error);
        alert("Error al subir documento.");
    } finally {
        label.textContent = 'Subir';
        label.style.pointerEvents = 'auto';
    }
}

/** * (FUNCIÓN CORREGIDA) 
 * Maneja el borrado de un documento de empleado.
 */
async function handleDocumentDelete(e) {
    const button = e.target.closest('[data-action="delete-empleado-doc"]');
    if (!button) return;

    const docId = button.dataset.docId; // Este es el ID del documento (ej. "cedula")
    const docUrl = button.dataset.docUrl; // URL del archivo en Storage
    const userId = document.getElementById('empleado-details-name').dataset.userId;

    if (!docId || !userId) return;

    _openConfirmModal("¿Seguro que quieres eliminar este documento?", async () => {
        try {
            // 1. Borrar el registro de Firestore
            await deleteDoc(doc(_db, "users", userId, "documents", docId));

            // 2. Borrar el archivo de Storage (si tenemos la URL)
            if (docUrl) {
                try {
                    const fileRef = ref(_storage, docUrl);
                    await deleteObject(fileRef);
                } catch (storageError) {
                    console.error("Error al borrar archivo de Storage (puede que ya no exista):", storageError);
                    // No detenemos el proceso si falla el borrado de Storage,
                    // lo principal es borrar el registro de Firestore.
                }
            }
        } catch (error) {
            console.error("Error al borrar documento:", error);
            alert("Error al borrar documento.");
        }
    });
}


/**
 * (FUNCIÓN EXISTENTE - SIN CAMBIOS)
 * Destruye la instancia del gráfico de empleado activa.
 */
function destroyActiveChart() {
    if (activeEmpleadoChart) {
        activeEmpleadoChart.destroy();
        activeEmpleadoChart = null;
    }
}

/**
 * (FUNCIÓN EXISTENTE - SIN CAMBIOS)
 * Crea un gráfico de barras para la productividad.
 */
function createProductivityChart(ctx, labels, dataBonificacion, dataEnTiempo, dataFueraTiempo) {
    if (!window.Chart) {
        console.error("Chart.js no está cargado.");
        return;
    }

    destroyActiveChart();

    activeEmpleadoChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Bonificación ($)',
                    data: dataBonificacion,
                    backgroundColor: '#84CC16', // lime-500
                    yAxisID: 'yBonificacion',
                    order: 3
                },
                {
                    label: 'M² a Tiempo',
                    data: dataEnTiempo,
                    backgroundColor: '#10B981', // green-500
                    yAxisID: 'yMetros',
                    order: 1,
                    stack: 'Stack 0',
                },
                {
                    label: 'M² Fuera de Tiempo',
                    data: dataFueraTiempo,
                    backgroundColor: '#EF4444', // red-500
                    yAxisID: 'yMetros',
                    order: 2,
                    stack: 'Stack 0',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                },
                yMetros: {
                    type: 'linear',
                    position: 'left',
                    stacked: true,
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Metros Cuadrados (M²)'
                    }
                },
                yBonificacion: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Bonificación (COP)'
                    },
                    grid: {
                        drawOnChartArea: false,
                    },
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                }
            }
        }
    });
}

/**
 * Abre el modal de creación de préstamo con calculadora en tiempo real.
 */
function openLoanModal(userId) {
    const modal = document.getElementById('loan-modal');
    const form = document.getElementById('loan-form');

    if (!modal || !form) return;

    // 1. Reset
    form.reset();

    // 2. Referencias UI
    const dateInput = form.querySelector('input[name="date"]');
    const amountInput = document.getElementById('loan-amount');
    const installmentsInput = document.getElementById('loan-installments');
    const quotaDisplay = document.getElementById('loan-estimated-quota');

    // 3. Configuración Inicial
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    if (amountInput) {
        amountInput.value = '';
        if (_setupCurrencyInput) _setupCurrencyInput(amountInput);
    }
    if (quotaDisplay) quotaDisplay.textContent = '$ 0';

    // 4. Calculadora en Tiempo Real
    const calculateQuota = () => {
        const amount = parseFloat(amountInput.value.replace(/[$. ]/g, '')) || 0;
        const installments = parseInt(installmentsInput.value) || 1;

        if (amount > 0 && installments > 0) {
            const quota = amount / installments;
            quotaDisplay.textContent = currencyFormatter.format(quota);
        } else {
            quotaDisplay.textContent = '$ 0';
        }
    };

    amountInput.addEventListener('input', calculateQuota);
    installmentsInput.addEventListener('input', calculateQuota);

    // 5. Mostrar
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // 6. Cierre
    const closeModal = () => {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    };
    document.getElementById('loan-modal-cancel').onclick = closeModal;
    const closeX = document.getElementById('loan-modal-close-x');
    if (closeX) closeX.onclick = closeModal;

    // 7. Submit
    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="loader-small-white mx-auto"></div>';

        try {
            const amount = parseFloat(amountInput.value.replace(/[$. ]/g, '')) || 0;
            const description = form.querySelector('textarea[name="description"]').value;
            const installments = parseInt(installmentsInput.value) || 1;
            const date = form.querySelector('input[name="date"]').value;

            if (amount <= 0) throw new Error("El monto debe ser mayor a 0");
            if (!description) throw new Error("El motivo es obligatorio.");

            await addDoc(collection(_db, "users", userId, "loans"), {
                amount: amount,
                balance: amount,
                description: description,
                installments: installments,
                date: date,
                status: 'active',
                createdAt: serverTimestamp(),
                createdBy: _getCurrentUserId ? _getCurrentUserId() : 'admin'
            });

            if (window.showToast) window.showToast("Préstamo registrado.", "success");
            closeModal();
            loadPaymentHistoryView(userId); // Refrescar lista

        } catch (error) {
            console.error(error);
            if (window.showToast) window.showToast(error.message, "error");
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    };
}

/**
 * (FUNCIÓN ACTUALIZADA) Carga historial con ANCHO COMPLETO (Full Width).
 */
export async function loadPaymentHistoryView(userId) {
    _showView('payment-history-view');

    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    const nameEl = document.getElementById('payment-history-name');
    const tableBody = document.getElementById('payment-history-table-body');
    const bankInfoContainer = document.getElementById('payment-header-bank-info');
    
    nameEl.textContent = 'Cargando datos...';
    bankInfoContainer.classList.add('hidden');

    try {
        // 1. Obtener Datos
        const userRef = doc(_db, "users", userId);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) throw new Error("Usuario no encontrado.");
        const user = { id: userSnap.id, ...userSnap.data() };
        _getUsersMap().set(userId, user);

        // 2. Encabezado UI
        nameEl.textContent = `${user.firstName} ${user.lastName}`;
        const bankNameEl = document.getElementById('ph-bank-name');
        const acctNumEl = document.getElementById('ph-account-number');
        const acctTypeEl = document.getElementById('ph-account-type');

        if (user.accountNumber) {
            bankNameEl.textContent = user.bankName || 'Banco no registrado';
            acctNumEl.textContent = user.accountNumber;
            acctTypeEl.textContent = user.accountType || 'Cuenta';
            bankInfoContainer.classList.remove('hidden');

            const setupCopyBtn = (btnId) => {
                const btn = document.getElementById(btnId);
                if (btn) {
                    const newBtn = btn.cloneNode(true);
                    btn.parentNode.replaceChild(newBtn, btn);
                    newBtn.onclick = () => {
                        const textToCopy = user.accountNumber ? user.accountNumber.toString().trim() : '';
                        navigator.clipboard.writeText(textToCopy).then(() => {
                            if (window.showToast) window.showToast(`Cuenta ${textToCopy} copiada`, 'success');
                        });
                    };
                }
            };
            setupCopyBtn('btn-quick-copy-bank');
            const acctContainer = acctNumEl.parentElement.parentElement;
            if(acctContainer) acctContainer.onclick = () => document.getElementById('btn-quick-copy-bank').click();
        } else {
            bankInfoContainer.classList.add('hidden');
        }

        // 3. Navegación
        const usersMap = _getUsersMap();
        const activeUsers = Array.from(usersMap.entries())
            .map(([key, val]) => ({ id: key, ...val }))
            .filter(u => u.status === 'active')
            .sort((a, b) => (a.firstName || '').localeCompare(b.firstName || ''));

        const currentIndex = activeUsers.findIndex(u => u.id === userId);
        const btnPrev = document.getElementById('btn-prev-employee');
        const btnNext = document.getElementById('btn-next-employee');

        if (btnPrev) {
            const newBtnPrev = btnPrev.cloneNode(true);
            btnPrev.parentNode.replaceChild(newBtnPrev, btnPrev);
            if (currentIndex > 0) {
                newBtnPrev.disabled = false;
                newBtnPrev.classList.remove('opacity-30', 'cursor-not-allowed');
                newBtnPrev.onclick = () => loadPaymentHistoryView(activeUsers[currentIndex - 1].id);
            } else {
                newBtnPrev.disabled = true;
                newBtnPrev.classList.add('opacity-30', 'cursor-not-allowed');
            }
        }

        if (btnNext) {
            const newBtnNext = btnNext.cloneNode(true);
            btnNext.parentNode.replaceChild(newBtnNext, btnNext);
            if (currentIndex !== -1 && currentIndex < activeUsers.length - 1) {
                newBtnNext.disabled = false;
                newBtnNext.classList.remove('opacity-30', 'cursor-not-allowed');
                newBtnNext.onclick = () => loadPaymentHistoryView(activeUsers[currentIndex + 1].id);
            } else {
                newBtnNext.disabled = true;
                newBtnNext.classList.add('opacity-30', 'cursor-not-allowed');
            }
        }

        // 4. Inyectar HTML Principal (ESTRUCTURA DE PÁGINA COMPLETA)
        // Buscamos el contenedor padre del formulario original para reemplazar todo el contenido interno de la vista
        const mainContainer = document.getElementById('payment-history-view');
        
        // --- CAMBIO CLAVE: Eliminamos max-w-7xl y mx-auto del grid ---
        // También reconstruimos la cabecera de navegación aquí para asegurar que todo el layout fluya
        
        // Nota: Mantenemos el botón de "Volver" y los controles de navegación que ya están en el HTML estático (index.html),
        // pero necesitamos re-inyectar la estructura de columnas con el nuevo ancho.
        
        // Buscamos el contenedor específico de las columnas (grid) que está dentro de payment-history-view
        // Como no tiene ID fácil, lo mejor es reemplazar el contenido dinámico conocido.
        // Sin embargo, para ser precisos y no romper los listeners de los botones "Volver" que están arriba,
        // vamos a buscar el div que contiene la clase "grid-cols-12".

        let gridContainer = mainContainer.querySelector('.grid.grid-cols-1.lg\\:grid-cols-12');
        
        if (!gridContainer) {
            // Si no lo encuentra (porque quizás ya lo modificamos o es la primera carga), buscamos por estructura
            // Ojo: En tu index.html original, este div tiene 'max-w-7xl mx-auto'.
            // Vamos a forzar el estilo directamente en el elemento si ya existe.
            const potentialGrids = mainContainer.querySelectorAll('.grid');
            potentialGrids.forEach(el => {
                if (el.classList.contains('lg:grid-cols-12')) {
                    gridContainer = el;
                }
            });
        }

        if (gridContainer) {
            // --- APLICAR ANCHO COMPLETO ---
            gridContainer.classList.remove('max-w-7xl', 'mx-auto');
            gridContainer.classList.add('w-full');
            // ------------------------------
        }

        // 5. Contenedor de Formularios (Tarjeta Izquierda)
        let paymentFormContainer = document.getElementById('payment-card-container');
        if (!paymentFormContainer) {
            const form = document.getElementById('payment-register-form');
            const dynamicContent = document.getElementById('payment-dynamic-content');
            
            if (form) paymentFormContainer = form.parentElement;
            else if (dynamicContent) paymentFormContainer = dynamicContent.parentElement;
            else {
                const fallback = document.querySelector('#payment-register-form');
                if (fallback) paymentFormContainer = fallback.parentElement;
            }
            if (paymentFormContainer) paymentFormContainer.id = 'payment-card-container';
        }

        if (!paymentFormContainer) { console.error("Error: Contenedor no encontrado"); return; }

        // 6. Inyectar Nuevo Diseño de Pestañas
        if (!paymentFormContainer.querySelector('nav')) {
            paymentFormContainer.innerHTML = `
                <div class="px-4 py-4 border-b border-gray-100 bg-white">
                    <div class="flex flex-col sm:flex-row justify-between items-center mb-2 px-1">
                        <span class="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-2 sm:mb-0">Tipo de Liquidación</span>
                    </div>
                    <nav class="flex p-1.5 space-x-1 bg-slate-100 rounded-xl overflow-x-auto custom-scrollbar" aria-label="Tabs">
                        <button id="tab-payment-nomina" class="payment-tab-btn active flex-1 min-w-[90px] flex items-center justify-center px-3 py-2 text-xs font-bold rounded-lg transition-all focus:outline-none whitespace-nowrap"><i class="fa-solid fa-money-bill-1-wave mr-2"></i>Nómina</button>
                        <button id="tab-payment-prima" class="payment-tab-btn flex-1 min-w-[90px] flex items-center justify-center px-3 py-2 text-xs font-medium rounded-lg transition-all focus:outline-none whitespace-nowrap text-gray-500 hover:text-gray-700"><i class="fa-solid fa-gift mr-2"></i>Prima</button>
                        <button id="tab-payment-cesantias" class="payment-tab-btn flex-1 min-w-[90px] flex items-center justify-center px-3 py-2 text-xs font-medium rounded-lg transition-all focus:outline-none whitespace-nowrap text-gray-500 hover:text-gray-700"><i class="fa-solid fa-piggy-bank mr-2"></i>Cesantías</button>
                        
                        <button id="tab-payment-vacaciones" class="payment-tab-btn flex-1 min-w-[90px] flex items-center justify-center px-3 py-2 text-xs font-medium rounded-lg transition-all focus:outline-none whitespace-nowrap text-gray-500 hover:text-cyan-600">
                            <i class="fa-solid fa-umbrella-beach mr-2"></i>Vacaciones
                        </button>
                        
                        <button id="tab-payment-liquidacion" class="payment-tab-btn flex-1 min-w-[90px] flex items-center justify-center px-3 py-2 text-xs font-medium rounded-lg transition-all focus:outline-none whitespace-nowrap text-gray-500 hover:text-red-600"><i class="fa-solid fa-door-open mr-2"></i>Liquidación</button>
                    </nav>
                </div>
                <div id="payment-dynamic-content" class="p-6 md:p-8 bg-white min-h-[400px]"></div>
            `;
        }
        // --- 7. REINICIALIZAR NAVEGACIÓN Y LISTENERS ---
        const navContainer = paymentFormContainer.querySelector('nav');
        const newNav = navContainer.cloneNode(true);
        navContainer.parentNode.replaceChild(newNav, navContainer);

        const tabs = newNav.querySelectorAll('.payment-tab-btn');
        const contentDiv = document.getElementById('payment-dynamic-content');

        const switchPaymentTab = (type) => {
            tabs.forEach(btn => {
                const isTarget = btn.id === `tab-payment-${type}`;
                if (isTarget) {
                    btn.className = "payment-tab-btn active flex-1 min-w-[90px] flex items-center justify-center px-3 py-2 text-xs font-extrabold rounded-lg transition-all bg-white shadow-sm ring-1 ring-black/5 scale-[1.02]";
                    if(type === 'liquidacion') btn.classList.add('text-red-600');
                    else if(type === 'cesantias') btn.classList.add('text-emerald-600');
                    else if(type === 'prima') btn.classList.add('text-indigo-600');
                    else if(type === 'vacaciones') btn.classList.add('text-cyan-600'); // Color Cyan para vacaciones
                    else btn.classList.add('text-blue-600'); 
                } else {
                    btn.className = "payment-tab-btn flex-1 min-w-[90px] flex items-center justify-center px-3 py-2 text-xs font-medium rounded-lg transition-all text-slate-500 hover:text-slate-700 hover:bg-white/50";
                }
            });
            
            contentDiv.innerHTML = ''; 
            switch (type) {
                case 'nomina': renderStandardPayrollForm(contentDiv, user); break;
                case 'prima': renderPrimaForm(contentDiv, user); break;
                case 'cesantias': renderCesantiasForm(contentDiv, user); break;
                case 'vacaciones': renderVacacionesForm(contentDiv, user); break; // <--- NUEVA FUNCIÓN
                case 'liquidacion': renderLiquidacionForm(contentDiv, user); break;
            }
        };

        newNav.querySelector('#tab-payment-nomina').onclick = () => switchPaymentTab('nomina');
        newNav.querySelector('#tab-payment-prima').onclick = () => switchPaymentTab('prima');
        newNav.querySelector('#tab-payment-cesantias').onclick = () => switchPaymentTab('cesantias');
        newNav.querySelector('#tab-payment-vacaciones').onclick = () => switchPaymentTab('vacaciones');
        newNav.querySelector('#tab-payment-liquidacion').onclick = () => switchPaymentTab('liquidacion');

        // Default
        switchPaymentTab('nomina');

        // 8. Cargar Historial
        loadPaymentHistoryList(userId, tableBody, user); 

    } catch (e) {
        console.error("Error loadPaymentHistoryView:", e);
        nameEl.textContent = 'Error';
    }
}

/**
 * Busca de forma robusta la fecha de INICIO de labores.
 * Prioridad: contractStartDate > contractDate > fechaIngreso > createdAt
 */
function getEmployeeStartDate(user) {
    // Lista de posibles campos, con contractStartDate como prioridad absoluta
    const possibleFields = [
        user.contractStartDate, // <--- TU CAMPO CORRECTO
        user.contractDate, 
        user.fechaIngreso, 
        user.fechaInicio,
        user.startDate,
        user.createdAt
    ];
    
    for (const raw of possibleFields) {
        if (raw) {
            // Soporte para Timestamp de Firebase
            if (typeof raw.toDate === 'function') {
                return raw.toDate();
            }
            // Soporte para String/Date estándar
            const d = new Date(raw);
            if (!isNaN(d.getTime())) {
                // Ajuste de zona horaria simple (evitar desfase de 1 día)
                const userTimezoneOffset = d.getTimezoneOffset() * 60000;
                return new Date(d.getTime() + userTimezoneOffset);
            }
        }
    }
    
    // Fallback de seguridad (1 Enero del año actual)
    return new Date(new Date().getFullYear(), 0, 1);
}

// --- FORMULARIO NÓMINA ESTÁNDAR (CORREGIDO) ---
async function renderStandardPayrollForm(container, user) {
    container.innerHTML = `
        <form id="payment-register-form" class="space-y-8" data-deduccion-sobre-minimo="${user.deduccionSobreMinimo || false}">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Periodo</label>
                    <div class="relative">
                        <select id="payment-concepto" class="w-full border-gray-300 rounded-lg p-3 text-sm font-medium bg-gray-50 focus:bg-white transition-colors cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500"></select>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Días</label>
                        <input type="number" id="payment-dias-pagar" class="payment-dias-input w-full border-gray-300 rounded-lg p-3 text-center font-bold text-gray-700" value="15" min="1" max="30">
                    </div>
                    <div class="flex items-end pb-3">
                         <span id="payment-salario-basico" class="text-xs font-bold text-gray-400 bg-gray-100 px-3 py-1.5 rounded-full w-full text-center border border-gray-200" 
                            data-value="${user.salarioBasico || 0}" 
                            data-aux-transporte="${_getPayrollConfig()?.auxilioTransporte || 0}">
                            ${currencyFormatter.format(user.salarioBasico || 0)}
                        </span>
                    </div>
                </div>
            </div>

             <div>
                <h4 class="text-xs font-black text-emerald-600 uppercase tracking-widest mb-4 border-b border-emerald-100 pb-1 w-fit">Ingresos Adicionales</h4>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="space-y-2">
                        <div class="flex items-center gap-2">
                            <input type="checkbox" id="payment-liquidar-bonificacion" class="w-4 h-4 text-emerald-600 rounded cursor-pointer focus:ring-emerald-500">
                            <label for="payment-liquidar-bonificacion" class="text-sm font-bold text-gray-700 cursor-pointer select-none">Pagar Bonificación</label>
                        </div>
                        <p id="payment-bonificacion-mes" class="text-sm font-mono text-gray-500 pl-6" data-value="0">$ 0</p>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 mb-1">Horas Extra (Cant.)</label>
                        <div class="flex items-center gap-2">
                            <input type="number" id="payment-horas-diurnas" class="payment-horas-input w-20 border-gray-300 rounded-lg p-2 text-center text-sm focus:ring-indigo-500" placeholder="0" min="0">
                            <span id="payment-total-horas" class="text-sm font-bold text-gray-600 font-mono flex-grow text-right bg-gray-50 p-2 rounded border border-gray-200">$ 0</span>
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 mb-1">Otros</label>
                        <input type="text" id="payment-otros" class="currency-input w-full border-gray-300 rounded-lg p-2 text-right font-mono text-sm focus:ring-emerald-500" placeholder="$ 0">
                    </div>
                </div>
            </div>

            <div id="deductions-container-wrapper" class="bg-red-50/50 rounded-xl p-5 border border-red-100">
                 <h4 class="text-xs font-black text-rose-600 uppercase tracking-widest mb-4 border-b border-rose-100 pb-1 w-fit">Deducciones</h4>
                 <div id="loan-management-fieldset-placeholder"></div>
            </div>

            <div class="bg-slate-800 text-white p-6 rounded-xl shadow-lg flex justify-between items-center transform transition-transform hover:scale-[1.01]">
                <div>
                    <p class="text-slate-400 text-xs font-bold uppercase tracking-wider">Neto a Pagar</p>
                </div>
                <div class="text-right">
                    <p id="payment-total-pagar" class="text-4xl font-black tracking-tight text-white">$ 0</p>
                </div>
            </div>

            <div class="flex justify-end">
                <button type="submit" id="payment-submit-button" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-md transition-all flex items-center gap-2">
                    <i class="fa-solid fa-floppy-disk"></i> Registrar Nómina
                </button>
            </div>
        </form>
    `;

    // 1. Cargar Préstamos
    await loadActiveLoansForForm(user.id);
    
    // 2. Configurar Bonificación (Stats)
    const today = new Date();
    const currentStatDocId = `${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}`;
    const statRef = doc(_db, "employeeStats", user.id, "monthlyStats", currentStatDocId);
    
    // Default bonif
    const bonifEl = document.getElementById('payment-bonificacion-mes');
    const chk = document.getElementById('payment-liquidar-bonificacion');
    
    try {
        const statSnap = await getDoc(statRef);
        let bonifVal = 0;
        if(statSnap.exists()) {
            bonifVal = statSnap.data().totalBonificacion || 0;
            const pagada = statSnap.data().bonificacionPagada || false;
            bonifEl.dataset.value = bonifVal;
            
            if(pagada) {
                bonifEl.textContent = currencyFormatter.format(bonifVal) + " (Pagada)";
                bonifEl.classList.add('line-through', 'text-gray-400');
                chk.disabled = true;
                chk.checked = false;
            } else {
                bonifEl.textContent = currencyFormatter.format(bonifVal);
                chk.checked = false; 
            }
        }
    } catch(e) { console.warn("No stats yet"); }

    // 3. Rellenar Select de Periodo (Opciones Inteligentes)
    const conceptoSelect = document.getElementById('payment-concepto');
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const currentMonth = months[today.getMonth()];
    const year = today.getFullYear();
    
    conceptoSelect.innerHTML = `
        <option value="Primera Quincena de ${currentMonth} ${year}">1ª Quincena - ${currentMonth}</option>
        <option value="Segunda Quincena de ${currentMonth} ${year}">2ª Quincena - ${currentMonth}</option>
        <option value="Nómina Mensual ${currentMonth} ${year}">Mes Completo</option>
    `;

    // Pre-selección inteligente basada en la fecha del día
    const dayOfMonth = today.getDate();
    if (dayOfMonth > 15) {
        conceptoSelect.value = `Segunda Quincena de ${currentMonth} ${year}`;
    }

    // --- CORRECCIÓN: LISTENER PARA CAMBIAR DÍAS AUTOMÁTICAMENTE ---
    conceptoSelect.addEventListener('change', function() {
        const val = this.value;
        const daysInput = document.getElementById('payment-dias-pagar');
        
        if (val.includes('Mensual') || val.includes('Completo')) {
            daysInput.value = 30; // Siempre 30, incluso en Febrero
        } else if (val.includes('Segunda')) {
            daysInput.value = 15; // La 2da quincena siempre cierra el mes contable de 30
        } else {
            daysInput.value = 15; // 1ra quincena siempre es 15
        }
        
        // Importante: Recalcular totales inmediatamente
        updatePaymentTotal();
    });

    // 4. Listeners Generales
    const form = document.getElementById('payment-register-form');
    
    // Listener unificado para inputs que afectan el cálculo
    form.addEventListener('input', (e) => {
        // Si es el input de horas extra, validar negativos en tiempo real
        if (e.target.id === 'payment-horas-diurnas') {
            if (e.target.value < 0) e.target.value = 0;
        }
        updatePaymentTotal();
    });
    
    form.addEventListener('change', (e) => { // Para checkbox y select
        updatePaymentTotal();
    });

    form.addEventListener('submit', (e) => handleRegisterPayment(e, user.id));
    
    // 5. Setup Inputs Moneda
    form.querySelectorAll('.currency-input').forEach(_setupCurrencyInput);
    
    // Cálculo inicial
    updatePaymentTotal();
}


// --- B. FORMULARIO PRIMA DE SERVICIOS (CON FECHAS EXACTAS PARA EL RECIBO) ---
async function renderPrimaForm(container, user) {
    const currentYear = new Date().getFullYear();
    const baseInfo = calculateBaseForBenefits(user);
    
    // 1. Obtener Fechas Reales del Contrato
    const startDate = getEmployeeStartDate(user);
    
    let endDate = null;
    if (user.contractEndDate) {
        endDate = (typeof user.contractEndDate.toDate === 'function') 
            ? user.contractEndDate.toDate() 
            : new Date(user.contractEndDate);
    }

    const startDateStr = startDate.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
    
    const badgeHtml = baseInfo.isMinimum 
        ? `<span class="bg-orange-100 text-orange-800 text-[10px] font-bold px-2 py-1 rounded border border-orange-200 block mt-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Ajustado a Mínimo</span>`
        : `<span class="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-1 rounded border border-blue-200 block mt-1">${baseInfo.label}</span>`;

    container.innerHTML = `
        <form id="prima-form" class="space-y-6">
            <div class="bg-indigo-50 border-l-4 border-indigo-500 p-4 rounded-r-lg flex justify-between items-center">
                <div>
                    <h4 class="font-bold text-indigo-900">Prima de Servicios</h4>
                    <p class="text-sm text-indigo-700">Calculada según fechas de contrato.</p>
                </div>
                <div class="text-right text-xs">
                    <p class="text-indigo-500 font-bold uppercase">Inicio Contrato</p>
                    <p class="font-mono font-bold text-indigo-800">${startDateStr}</p>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Periodo a Liquidar</label>
                    <select id="prima-periodo-select" class="w-full border-gray-300 rounded-lg p-3 text-sm font-bold text-gray-700 focus:ring-indigo-500 cursor-pointer bg-white shadow-sm">
                        <option value="1">1° Semestre (Ene - Jun) ${currentYear}</option>
                        <option value="2">2° Semestre (Jul - Dic) ${currentYear}</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Base Salarial Promedio</label>
                    <input type="text" id="prima-base" class="currency-input w-full border-gray-300 rounded-lg p-3 font-bold text-right focus:ring-indigo-500" value="${currencyFormatter.format(baseInfo.value)}">
                    ${badgeHtml}
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Días a Pagar</label>
                    <input type="number" id="prima-dias" class="w-full border-gray-300 rounded-lg p-3 font-bold text-center focus:ring-indigo-500 bg-gray-50" readonly>
                    <p id="prima-dias-info" class="text-[10px] text-gray-400 mt-1 italic text-right"></p>
                </div>
                <div class="flex flex-col justify-end">
                    <div class="bg-white border-2 border-indigo-100 p-4 rounded-xl text-right shadow-sm">
                        <p class="text-xs text-indigo-400 font-bold uppercase tracking-wider">Total Prima</p>
                        <p id="prima-total" class="text-2xl font-black text-indigo-700">$ 0</p>
                    </div>
                </div>
            </div>

            <div class="flex justify-end pt-4">
                <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-xl shadow-md transition-all flex items-center">
                    <i class="fa-solid fa-gift mr-2"></i> Registrar Pago de Prima
                </button>
            </div>
        </form>
    `;

    const inputBase = document.getElementById('prima-base');
    const inputDias = document.getElementById('prima-dias');
    const totalEl = document.getElementById('prima-total');
    const selectPeriodo = document.getElementById('prima-periodo-select');
    const diasInfo = document.getElementById('prima-dias-info');

    _setupCurrencyInput(inputBase);
    const currentMonth = new Date().getMonth();
    if (currentMonth > 5) selectPeriodo.value = "2";

    // Variables para guardar el rango exacto
    let currentRange = { start: null, end: null };

    const calculateDays = () => {
        const semestre = selectPeriodo.value; 
        const year = currentYear;
        
        let startPeriod, endPeriod;
        if (semestre === "1") {
            startPeriod = new Date(year, 0, 1); // 1 Ene
            endPeriod = new Date(year, 5, 30);  // 30 Jun
        } else {
            startPeriod = new Date(year, 6, 1); // 1 Jul
            endPeriod = new Date(year, 11, 30); // 30 Dic
        }
        
        startPeriod.setHours(0,0,0,0);
        endPeriod.setHours(23,59,59,999);
        const startContract = new Date(startDate); startContract.setHours(0,0,0,0);
        
        if (startContract > endPeriod) {
            inputDias.value = 0;
            diasInfo.textContent = "Contrato posterior al periodo.";
            currentRange = { start: null, end: null };
            calcTotal();
            return;
        }

        // Inicio efectivo:
        let effectiveStart = startContract > startPeriod ? startContract : startPeriod;

        // Fin efectivo:
        let effectiveEnd = endPeriod;
        if (endDate) {
            const endContract = new Date(endDate); endContract.setHours(23,59,59,999);
            if (endContract < startPeriod) {
                inputDias.value = 0;
                diasInfo.textContent = "Contrato finalizado antes.";
                currentRange = { start: null, end: null };
                calcTotal();
                return;
            }
            if (endContract < endPeriod) effectiveEnd = endContract;
        }

        // Guardamos las fechas exactas para enviarlas al guardar
        currentRange = { start: effectiveStart, end: effectiveEnd };

        // --- CAMBIO: USAR CÁLCULO 360 DÍAS ---
        // Antes: const diffTime = Math.abs(effectiveEnd - effectiveStart);
        // Antes: let days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; 
        
        let days = calculateDays360(effectiveStart, effectiveEnd); 
        
        // Ajuste: Si el cálculo da 181 o más (por desfases de fechas), limitar a 180 (semestre)
        if (days > 180) days = 180;
        
        inputDias.value = days;
        
        if (days === 180) diasInfo.textContent = "Semestre completo.";
        else diasInfo.textContent = `Proporcional (${effectiveStart.toLocaleDateString()} - ${effectiveEnd.toLocaleDateString()})`;
        
        calcTotal();
    };

    const calcTotal = () => {
        const base = parseFloat(inputBase.value.replace(/[$. ]/g, '')) || 0;
        const dias = parseFloat(inputDias.value) || 0;
        const total = (base * dias) / 360;
        totalEl.textContent = currencyFormatter.format(total);
    };

    selectPeriodo.addEventListener('change', calculateDays);
    inputBase.addEventListener('input', calcTotal);
    inputDias.addEventListener('input', calcTotal);
    
    calculateDays();

    document.getElementById('prima-form').onsubmit = async (e) => {
        e.preventDefault();
        const base = parseFloat(inputBase.value.replace(/[$. ]/g, '')) || 0;
        const dias = parseFloat(inputDias.value) || 0;
        const total = (base * dias) / 360;
        const periodoTexto = selectPeriodo.options[selectPeriodo.selectedIndex].text;

        // Formatear fechas para guardar
        const rangoTexto = currentRange.start && currentRange.end 
            ? `${currentRange.start.toLocaleDateString('es-CO')} al ${currentRange.end.toLocaleDateString('es-CO')}` 
            : 'N/A';

        _openConfirmModal(`¿Pagar Prima (${periodoTexto}) por ${currencyFormatter.format(total)}?`, async () => {
             await saveSpecialPayment(user.id, {
                tipo: 'Prima de Servicios',
                periodo: periodoTexto,
                monto: total,
                detalles: { 
                    baseCalculo: base, 
                    diasSemestre: dias, 
                    semestre: selectPeriodo.value,
                    rangoFechas: rangoTexto // <--- AQUÍ GUARDAMOS EL RANGO
                }
            });
        });
    };
}

// --- C. FORMULARIO CESANTÍAS (CORTE ANUAL OBLIGATORIO) ---
async function renderCesantiasForm(container, user) {
    const baseInfo = calculateBaseForBenefits(user);
    const currentYear = new Date().getFullYear();
    const realStartDate = getEmployeeStartDate(user);
    
    // --- LÓGICA DE FECHAS ANUALIZADA ---
    
    // 1. Determinar Inicio del Periodo a Liquidar (El mayor entre 1 Ene y Contrato)
    const jan1 = new Date(currentYear, 0, 1);
    // Si el contrato es viejo, arrancamos el 1 de Enero. Si es nuevo de este año, su fecha real.
    const effectiveStart = realStartDate > jan1 ? realStartDate : jan1;
    const startDateVal = effectiveStart.toISOString().split('T')[0];

    // 2. Determinar Fin del Periodo (El menor entre 31 Dic y Fin Contrato si existe)
    const dec31 = new Date(currentYear, 11, 31);
    let effectiveEnd = dec31;

    // Si el contrato ya tiene fecha fin y es este año, cortamos ahí
    if (user.contractEndDate) {
        const endDate = (typeof user.contractEndDate.toDate === 'function') 
            ? user.contractEndDate.toDate() 
            : new Date(user.contractEndDate);
            
        if (endDate < dec31) {
            effectiveEnd = endDate;
        }
    }
    const endDateVal = effectiveEnd.toISOString().split('T')[0];
    
    // -------------------------------------

    const badgeHtml = baseInfo.isMinimum 
        ? `<span class="bg-orange-100 text-orange-800 text-[10px] font-bold px-2 py-1 rounded border border-orange-200 block mt-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Ajustado a Mínimo</span>`
        : `<span class="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded border border-emerald-200 block mt-1">${baseInfo.label}</span>`;

    container.innerHTML = `
        <form id="cesantias-form" class="space-y-6">
            <div class="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg">
                <h4 class="font-bold text-blue-900">Consignación Anual de Cesantías (${currentYear})</h4>
                <p class="text-sm text-blue-700">Liquidación del año corriente para traslado al fondo.</p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="col-span-1 md:col-span-2">
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Base Salarial</label>
                    <input type="text" id="ces-base" class="currency-input w-full border-gray-300 rounded-lg p-3 font-bold text-right text-gray-800" value="${currencyFormatter.format(baseInfo.value)}">
                    ${badgeHtml}
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Fecha Inicio (Año ${currentYear})</label>
                    <input type="date" id="ces-inicio" class="w-full border-gray-300 rounded-lg p-3 text-sm font-medium bg-gray-50" value="${startDateVal}" readonly>
                    <p class="text-[10px] text-gray-400 mt-1">Automático: 1 Ene o Ingreso.</p>
                </div>
                 <div>
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Fecha Corte (Año ${currentYear})</label>
                    <input type="date" id="ces-fin" class="w-full border-gray-300 rounded-lg p-3 text-sm font-medium" value="${endDateVal}">
                    <p class="text-[10px] text-gray-400 mt-1">Por defecto: 31 Dic.</p>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-white p-4 rounded-xl border-2 border-blue-600 shadow-lg relative overflow-hidden transform transition-all hover:scale-[1.01]">
                    <div class="absolute top-0 right-0 bg-blue-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg uppercase tracking-wider">A Consignar</div>
                    <p class="text-xs text-gray-500 mb-1">Días Liquidados: <span id="ces-dias-calc" class="font-bold text-gray-800">0</span></p>
                    <p class="text-sm font-bold text-gray-700">Valor Cesantías</p>
                    <p id="ces-valor-fondo" class="text-3xl font-black text-blue-700 mt-1">$ 0</p>
                    <div class="mt-3 flex items-center text-[10px] text-blue-800 bg-blue-50 p-2 rounded">
                        <i class="fa-solid fa-building-columns mr-2"></i> Transferir a Fondo (Antes 14 Feb)
                    </div>
                </div>

                <div class="bg-gray-50 p-4 rounded-xl border border-gray-200 border-dashed relative">
                    <div class="absolute top-0 right-0 bg-gray-200 text-gray-600 text-[10px] font-bold px-3 py-1 rounded-bl-lg uppercase">Informativo</div>
                    <p class="text-xs text-gray-500 mb-1">Intereses (12%): <span id="ces-valor-intereses" class="font-bold text-gray-800">$ 0</span></p>
                    
                    <div class="mt-4 p-3 bg-yellow-50 border-l-4 border-yellow-400 rounded-r text-xs text-yellow-800">
                        <p class="font-bold"><i class="fa-solid fa-hand-holding-dollar mr-1"></i> ¡Atención!</p>
                        <p class="mt-1">Pagar directamente al empleado (Nómina Enero).</p>
                    </div>
                </div>
            </div>

            <button type="submit" id="btn-save-cesantias" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-md transition-all flex items-center justify-center text-lg">
                <i class="fa-solid fa-file-invoice-dollar mr-2"></i> Registrar Consignación Anual
            </button>
        </form>
    `;

    const inputBase = document.getElementById('ces-base');
    const inputInicio = document.getElementById('ces-inicio');
    const inputFin = document.getElementById('ces-fin');
    
    _setupCurrencyInput(inputBase);

    const calc = () => {
        const base = parseFloat(inputBase.value.replace(/[$. ]/g, '')) || 0;
        const d1 = new Date(inputInicio.value); d1.setHours(0,0,0,0);
        const d2 = new Date(inputFin.value); d2.setHours(23,59,59,999);
        
        // Validación: No permitir fechas fuera del año actual para evitar errores contables
        if (d2.getFullYear() !== currentYear && d2.getFullYear() !== currentYear + 1) { 
             // Permitimos Enero del año siguiente como fecha de pago, pero el cálculo es del año anterior
             // Para simplificar, advertimos si la fecha corte se aleja mucho.
        }

        if (d1 && d2 && !isNaN(d1) && !isNaN(d2)) {
            // --- CAMBIO: USAR CÁLCULO 360 DÍAS ---
            // Antes: const diffTime = d2.getTime() - d1.getTime(); ...
            
            let days = calculateDays360(d1, d2);
            
            // Tope anual
            if (days > 360) days = 360;

            document.getElementById('ces-dias-calc').textContent = days;

            const valorCesantias = (base * days) / 360;
            const valorIntereses = (valorCesantias * days * 0.12) / 360;

            document.getElementById('ces-valor-fondo').textContent = currencyFormatter.format(valorCesantias);
            document.getElementById('ces-valor-intereses').textContent = currencyFormatter.format(valorIntereses);
            
            return { valorCesantias, valorIntereses, days, base };
        }
        return null;
    };

    inputBase.addEventListener('input', calc);
    inputInicio.addEventListener('change', calc);
    inputFin.addEventListener('change', calc);
    calc();

    document.getElementById('cesantias-form').onsubmit = (e) => {
        e.preventDefault();
        const data = calc();
        if(!data || data.valorCesantias <= 0) {
            window.showToast("Datos inválidos.", "error");
            return;
        }

        _openConfirmModal(`Confirmar consignación ANUAL (${currentYear}):\n\nValor Fondo: ${currencyFormatter.format(data.valorCesantias)}\nIntereses a Pagar: ${currencyFormatter.format(data.valorIntereses)}`, async () => {
             await saveSpecialPayment(user.id, {
                tipo: `Consignación Cesantías ${currentYear}`,
                periodo: `${inputInicio.value} al ${inputFin.value}`,
                monto: data.valorCesantias, 
                detalles: { 
                    base: data.base, 
                    dias: data.days, 
                    interesesCalculados: data.valorIntereses, 
                    nota: "Intereses pagados aparte al empleado",
                    anioLiquidado: currentYear
                }
            });
        });
    };
}

// --- D. FORMULARIO LIQUIDACIÓN FINAL (LÓGICA BLINDADA POR PERIODOS) ---
async function renderLiquidacionForm(container, user) {
    container.innerHTML = `<div class="py-12 text-center"><div class="loader mx-auto"></div><p class="text-sm text-gray-400 mt-2">Analizando cortes y periodos...</p></div>`;

    try {
        const config = _getPayrollConfig() || { salarioMinimo: 1300000 }; 
        const currentYear = new Date().getFullYear();
        
        // 1. BASES
        const baseBenefits = calculateBaseForBenefits(user); 
        let vacationBase = parseFloat(user.salarioBasico) || 0;
        let vacationBaseLabel = "Salario Básico";
        if (user.deduccionSobreMinimo) {
            vacationBase = config.salarioMinimo;
            vacationBaseLabel = "Salario Mínimo (Config)";
        }
        
        // 2. CARGA DE DATOS (Traemos TODO el historial para buscar cortes antiguos)
        const [loansSnap, paymentsSnap] = await Promise.all([
            getDocs(query(collection(_db, "users", user.id, "loans"), where("status", "==", "active"))),
            getDocs(query(collection(_db, "users", user.id, "paymentHistory"), orderBy("createdAt", "desc")))
        ]);

        let totalLoans = 0;
        loansSnap.forEach(doc => totalLoans += (doc.data().balance || 0));

        // 3. ANÁLISIS DE PERIODOS (AQUÍ ESTÁ LA LÓGICA DE SEPARACIÓN DE AÑOS)
        let primaPagadaSemestre = 0;
        let lastCesantiasYear = 0; 
        let anticiposCesantias = 0; 
        let diasVacacionesTomados = 0; 

        const payments = paymentsSnap.docs.map(d => d.data());

        // A. Buscar el último año que se cerró (Consignación a Fondo)
        payments.forEach(p => {
            const concepto = (p.concepto || '').toLowerCase();
            const det = p.details || {};
            if (concepto.includes('fondo') && (concepto.includes('cesant'))) {
                let year = det.anioLiquidado ? parseInt(det.anioLiquidado) : (p.createdAt ? p.createdAt.toDate().getFullYear() - 1 : 0);
                if (year > lastCesantiasYear) lastCesantiasYear = year;
            }
        });

        // B. Definir Fecha Inicio Cesantías (El corte limpio)
        const realStartDate = getEmployeeStartDate(user);
        let cesantiasStartDate = new Date(realStartDate); 

        // Si ya pagamos 2023, arrancamos LIMPIOS el 1 Ene 2024
        if (lastCesantiasYear > 0) {
            const potentialStart = new Date(lastCesantiasYear + 1, 0, 1);
            if (potentialStart > cesantiasStartDate) cesantiasStartDate = potentialStart;
        }
        // Normalizar hora para comparaciones exactas
        cesantiasStartDate.setHours(0,0,0,0);

        // C. Definir Inicio del Semestre Actual (Para la Prima)
        const startOfCurrentSemester = new Date(currentYear, new Date().getMonth() > 5 ? 6 : 0, 1);
        startOfCurrentSemester.setHours(0,0,0,0);

        // D. Filtrar pagos (SOLO RESTAR LO QUE PERTENECE AL PERIODO ACTUAL)
        payments.forEach(p => {
            const pDate = p.createdAt ? p.createdAt.toDate() : new Date(p.paymentDate);
            pDate.setHours(0,0,0,0);
            
            const concepto = (p.concepto || '').toLowerCase();
            const det = p.details || {};

            // --- FILTRO DE PRIMA ---
            // Solo restamos pagos hechos DESPUÉS del inicio del semestre. 
            // Si pagaste una prima en Enero y estamos en Julio, NO se resta.
            if (concepto.includes('prima') && pDate >= startOfCurrentSemester) {
                primaPagadaSemestre += (p.monto || 0);
            }

            // --- FILTRO DE CESANTÍAS ---
            // Solo restamos anticipos hechos DESPUÉS del último corte anual.
            // Si diste un anticipo en 2023 y ya cerraste el año, ese anticipo NO cuenta aquí.
            if (concepto.includes('cesant') && !concepto.includes('interes') && !concepto.includes('fondo')) {
                if (pDate >= cesantiasStartDate) {
                    anticiposCesantias += (p.monto || 0);
                }
            }

            // Vacaciones (Acumulado histórico total)
            if (concepto.includes('vacaciones')) {
                if (det.diasPagados) diasVacacionesTomados += parseFloat(det.diasPagados);
                else if (det.dias) diasVacacionesTomados += parseFloat(det.dias);
            }
        });

        // 4. FECHAS UI
        const todayStr = new Date().toISOString().split('T')[0];
        let agreedEndDate = null;
        if (user.contractEndDate) {
            agreedEndDate = (typeof user.contractEndDate.toDate === 'function') 
                ? user.contractEndDate.toDate() : new Date(user.contractEndDate);
        }
        const contractEndStr = agreedEndDate ? agreedEndDate.toISOString().split('T')[0] : '';
        const defaultContractType = user.contractType || (agreedEndDate ? 'fijo' : 'indefinido');

        // --- RENDERIZADO ---
        container.innerHTML = `
            <form id="liq-form" class="space-y-6">
                <div class="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg flex justify-between items-center">
                    <div>
                        <h4 class="font-bold text-red-900">Liquidación Final</h4>
                        <p class="text-sm text-red-700">Calculando saldo pendiente a la fecha.</p>
                    </div>
                    <div class="text-right text-xs">
                        <p class="text-red-400 font-bold uppercase">Ingreso</p>
                        <p class="font-mono font-bold text-red-800">${realStartDate.toLocaleDateString('es-CO')}</p>
                    </div>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Motivo Retiro</label>
                        <select id="liq-motivo" class="w-full border-gray-300 rounded-lg p-2 text-sm bg-white">
                            <option value="voluntario">Renuncia Voluntaria</option>
                            <option value="terminacion">Terminación de Contrato</option>
                            <option value="justa_causa">Despido Justa Causa</option>
                            <option value="sin_justa_causa">Despido Sin Justa Causa</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo Contrato</label>
                        <select id="liq-tipo-contrato" class="w-full border-gray-300 rounded-lg p-2 text-sm bg-white">
                            <option value="indefinido" ${defaultContractType === 'indefinido' ? 'selected' : ''}>Indefinido</option>
                            <option value="fijo" ${defaultContractType === 'fijo' ? 'selected' : ''}>Término Fijo</option>
                        </select>
                    </div>
                     <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Retiro</label>
                        <input type="date" id="liq-fecha-fin" class="w-full border-gray-300 rounded-lg p-2 text-sm font-bold text-gray-700 focus:ring-red-500" value="${todayStr}">
                    </div>
                </div>
                
                <div id="div-fecha-pactada" class="hidden">
                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Fin Pactada</label>
                    <input type="date" id="liq-fecha-pactada" class="w-full border-gray-300 rounded-lg p-2 text-sm bg-gray-50" value="${contractEndStr}">
                </div>

                <div class="space-y-4 border-t border-gray-200 pt-4">
                    <h5 class="font-bold text-gray-700 text-sm">Detalle de Valores</h5>
                    
                    <div class="grid grid-cols-2 gap-2 mb-2">
                        <div class="bg-indigo-50 p-2 rounded border border-indigo-100">
                            <p class="text-[10px] text-indigo-400 uppercase font-bold">Corte Cesantías</p>
                            <p class="text-xs font-bold text-indigo-800" id="lbl-inicio-cesantias">${cesantiasStartDate.toLocaleDateString('es-CO')}</p>
                            <p class="text-[9px] text-indigo-400 italic">Fecha base del cálculo</p>
                        </div>
                        <div class="bg-blue-50 p-2 rounded border border-blue-100">
                             <p class="text-[10px] text-blue-400 uppercase font-bold">Base Prestacional</p>
                             <p class="text-xs font-bold text-blue-800">${currencyFormatter.format(baseBenefits.value)}</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-12 gap-2 items-center bg-gray-50 p-2 rounded-lg border border-gray-200">
                        <div class="col-span-5">
                            <p class="text-xs font-bold text-gray-600">Cesantías</p>
                            <p class="text-[10px] text-gray-400">Días: <span id="lbl-dias-cesantias">0</span> | Menos: ${currencyFormatter.format(anticiposCesantias)}</p>
                        </div>
                        <div class="col-span-7">
                            <input type="text" id="liq-cesantias" class="currency-input w-full border-gray-200 rounded p-1 text-right text-sm font-bold bg-white" placeholder="$ 0">
                        </div>
                    </div>

                    <div class="grid grid-cols-12 gap-2 items-center bg-gray-50 p-2 rounded-lg">
                        <div class="col-span-5">
                            <p class="text-xs font-bold text-gray-600">Intereses Cesantías</p>
                            <p class="text-[10px] text-gray-400">12% sobre saldo Cesantías</p>
                        </div>
                        <div class="col-span-7">
                            <input type="text" id="liq-intereses" class="currency-input w-full border-gray-200 rounded p-1 text-right text-sm font-bold bg-white" placeholder="$ 0">
                        </div>
                    </div>

                    <div class="grid grid-cols-12 gap-2 items-center bg-gray-50 p-2 rounded-lg border border-gray-200">
                        <div class="col-span-5">
                            <p class="text-xs font-bold text-gray-600">Prima Servicios</p>
                            <p class="text-[10px] text-gray-400">Semestre Actual | Menos: ${currencyFormatter.format(primaPagadaSemestre)}</p>
                        </div>
                        <div class="col-span-7">
                            <input type="text" id="liq-prima" class="currency-input w-full border-gray-200 rounded p-1 text-right text-sm font-bold bg-white" placeholder="$ 0">
                        </div>
                    </div>

                    <div class="grid grid-cols-12 gap-2 items-center bg-blue-50/50 p-2 rounded-lg border border-blue-100">
                        <div class="col-span-5">
                            <p class="text-xs font-bold text-gray-600">Vacaciones</p>
                            <p class="text-[10px] text-gray-400">Total: <span id="lbl-total-vac">0</span> - Tomados: <span class="text-red-500 font-bold">${diasVacacionesTomados.toFixed(1)}</span></p>
                        </div>
                        <div class="col-span-7">
                            <input type="text" id="liq-vacaciones" class="currency-input w-full border-blue-200 rounded p-1 text-right text-sm font-bold text-blue-800 bg-white" placeholder="$ 0">
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-12 gap-2 items-center bg-yellow-50 p-2 rounded-lg border border-yellow-200 transition-colors" id="row-indemnizacion">
                        <div class="col-span-5">
                            <p class="text-xs font-bold text-yellow-800">Indemnización</p>
                            <p class="text-[10px] text-yellow-600" id="lbl-indemnizacion-info">Sin Justa Causa</p>
                        </div>
                        <div class="col-span-7">
                            <input type="text" id="liq-indemnizacion" class="currency-input w-full border-yellow-300 rounded p-1 text-right text-sm font-bold text-yellow-800" placeholder="$ 0">
                        </div>
                    </div>

                     <div class="grid grid-cols-12 gap-2 items-center bg-red-50 p-2 rounded-lg border border-red-100">
                        <div class="col-span-5">
                            <p class="text-xs font-bold text-red-600">Total Deducciones</p>
                            <p class="text-[10px] text-red-400">Préstamos pendientes</p>
                        </div>
                        <div class="col-span-7">
                            <input type="text" id="liq-deducciones" class="currency-input w-full border-red-200 rounded p-1 text-right text-sm font-bold text-red-600 bg-white" value="${currencyFormatter.format(totalLoans)}">
                        </div>
                    </div>
                </div>

                 <div class="bg-gray-800 text-white p-5 rounded-xl flex justify-between items-center shadow-lg">
                    <div>
                        <span class="block text-[10px] text-gray-400 uppercase tracking-widest">Total a Pagar</span>
                        <span class="text-xs text-gray-500">Liquidación Neta</span>
                    </div>
                    <span id="liq-total" class="font-black text-3xl tracking-tight">$ 0</span>
                </div>

                <button type="submit" class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl shadow-md transition-all flex items-center justify-center gap-2">
                    <i class="fa-solid fa-gavel mr-2"></i> Finalizar Contrato y Archivar
                </button>
            </form>
        `;

        const inputs = {
            motivo: document.getElementById('liq-motivo'),
            tipoContrato: document.getElementById('liq-tipo-contrato'),
            fecha: document.getElementById('liq-fecha-fin'),
            fechaPactada: document.getElementById('liq-fecha-pactada'),
            divFechaPactada: document.getElementById('div-fecha-pactada'),
            cesantias: document.getElementById('liq-cesantias'),
            intereses: document.getElementById('liq-intereses'),
            prima: document.getElementById('liq-prima'),
            vacaciones: document.getElementById('liq-vacaciones'),
            indem: document.getElementById('liq-indemnizacion'),
            deducciones: document.getElementById('liq-deducciones'),
            total: document.getElementById('liq-total')
        };
        
        container.querySelectorAll('.currency-input').forEach(i => {
            _setupCurrencyInput(i);
            i.addEventListener('input', updateLiqTotal);
        });

        let liquidacionData = { diasCesantias: 0 };

        function calculateValues() {
            const endDate = new Date(inputs.fecha.value);
            endDate.setHours(23, 59, 59, 999);
            if (isNaN(endDate.getTime())) return;

            // 1. DÍAS CESANTÍAS (Desde el corte detectado)
            const startC = new Date(cesantiasStartDate); startC.setHours(0,0,0,0);
            const endC = new Date(endDate); endC.setHours(0,0,0,0);
            
            // --- CAMBIO: USAR 360 ---
            let diasCesantias = calculateDays360(startC, endC);
            
            document.getElementById('lbl-dias-cesantias').textContent = diasCesantias;
            liquidacionData.diasCesantias = diasCesantias;

            // VALOR CESANTÍAS (NETO: Generado - Anticipos del periodo)
            const valCesantiasTotal = (baseBenefits.value * diasCesantias) / 360;
            const valCesantiasNeto = Math.max(0, valCesantiasTotal - anticiposCesantias);
            inputs.cesantias.value = currencyFormatter.format(valCesantiasNeto);

            // INTERESES (Sobre el NETO que se debe hoy, asumiendo que anticipos pagaron intereses)
            const valIntereses = (valCesantiasNeto * diasCesantias * 0.12) / 360;
            inputs.intereses.value = currencyFormatter.format(valIntereses);


            // 2. PRIMA (Semestral)
            const startSemestre = new Date(currentYear, new Date().getMonth() > 5 ? 6 : 0, 1);
            // Si el contrato empezó en medio del semestre, se usa la fecha contrato
            const effectiveStartPrima = realStartDate > startSemestre ? realStartDate : startSemestre;
            
            const diffPrima = Math.abs(endC - effectiveStartPrima);

            let diasPrima = calculateDays360(effectiveStartPrima, endC);
            if (diasPrima > 180) diasPrima = 180; // Tope semestral

            const valPrimaTotal = (baseBenefits.value * diasPrima) / 360;
            const valPrimaNeto = Math.max(0, valPrimaTotal - primaPagadaSemestre);
            inputs.prima.value = currencyFormatter.format(valPrimaNeto);

            // 3. VACACIONES (Históricas)
            const startHistory = new Date(realStartDate); startHistory.setHours(0,0,0,0);
            
            // --- CAMBIO: USAR 360 PARA VACACIONES TAMBIÉN ---
            // Nota: Aunque vacaciones suelen ser calendario, para provisión contable se suele usar 360.
            // Si prefieres calendario estricto para vacaciones, deja la fórmula anterior.
            // Para consistencia con nómina:
            const totalDaysWorked = calculateDays360(startHistory, endC);

            const totalVacacionesGeneradas = (totalDaysWorked * 15) / 360;

            const diasVacPendientes = Math.max(0, totalVacacionesGeneradas - diasVacacionesTomados);
            
            document.getElementById('lbl-total-vac').textContent = totalVacacionesGeneradas.toFixed(1);
            inputs.vacaciones.value = currencyFormatter.format((vacationBase / 30) * diasVacPendientes);


            // 4. INDEMNIZACIÓN
            const motivo = inputs.motivo.value;
            const tipo = inputs.tipoContrato.value;
            if (tipo === 'fijo') inputs.divFechaPactada.classList.remove('hidden');
            else inputs.divFechaPactada.classList.add('hidden');

            if (motivo === 'sin_justa_causa') {
                const indemnizacion = calculateIndemnificationValue(
                    tipo, realStartDate, endDate,       
                    inputs.fechaPactada.value ? new Date(inputs.fechaPactada.value) : null,
                    parseFloat(user.salarioBasico) || 0 
                );
                inputs.indem.value = currencyFormatter.format(indemnizacion);
                document.getElementById('row-indemnizacion').classList.add('bg-yellow-100', 'border-yellow-400');
                document.getElementById('lbl-indemnizacion-info').textContent = "Calculada Automáticamente";
            } else {
                inputs.indem.value = "$ 0";
                document.getElementById('row-indemnizacion').classList.remove('bg-yellow-100', 'border-yellow-400');
                document.getElementById('lbl-indemnizacion-info').textContent = "No aplica";
            }
            updateLiqTotal();
        }

        function updateLiqTotal() {
            let total = 0;
            ['liq-cesantias', 'liq-intereses', 'liq-prima', 'liq-vacaciones', 'liq-indemnizacion'].forEach(id => {
                total += parseFloat(document.getElementById(id).value.replace(/[$. ]/g, '')) || 0;
            });
            const deductions = parseFloat(inputs.deducciones.value.replace(/[$. ]/g, '')) || 0;
            inputs.total.textContent = currencyFormatter.format(total - deductions);
        }

        inputs.fecha.addEventListener('change', calculateValues);
        inputs.motivo.addEventListener('change', calculateValues);
        inputs.tipoContrato.addEventListener('change', calculateValues);
        inputs.fechaPactada.addEventListener('change', calculateValues);
        calculateValues();

        document.getElementById('liq-form').onsubmit = (e) => {
            e.preventDefault();
            const totalText = inputs.total.textContent;
            const monto = parseFloat(totalText.replace(/[$. \u00A0]/g, '').replace(',', '.')) || 0;
            
            const fechaRetiroInput = inputs.fecha.value;
            let fechaRetiroFmt = fechaRetiroInput;
            if (fechaRetiroInput) {
                const parts = fechaRetiroInput.split('-'); 
                if (parts.length === 3) fechaRetiroFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
            }

            _openConfirmModal(`CONFIRMAR LIQUIDACIÓN:\n\nTotal: ${totalText}\n\nEl usuario será ARCHIVADO.`, async () => {
                 await saveSpecialPayment(user.id, {
                    tipo: 'Liquidación Final de Contrato',
                    monto: monto,
                    detalles: { 
                        motivo: inputs.motivo.value,
                        fechaIngreso: realStartDate.toLocaleDateString('es-CO'), 
                        fechaRetiro: fechaRetiroFmt,
                        
                        diasLiquidados: liquidacionData.diasCesantias, 
                        
                        cesantias: inputs.cesantias.value,
                        cesantiasDescontadas: anticiposCesantias,
                        intereses: inputs.intereses.value,
                        prima: inputs.prima.value,
                        primaDescontada: primaPagadaSemestre,
                        vacaciones: inputs.vacaciones.value,
                        vacacionesTomadas: diasVacacionesTomados,
                        indemnizacion: inputs.indem.value,
                        deducciones: inputs.deducciones.value,
                        
                        basePrestacional: baseBenefits.value,
                        baseSalarial: vacationBase 
                    }
                });
                
                if (totalLoans > 0) {
                   const batch = writeBatch(_db);
                   loansSnap.forEach(doc => batch.update(doc.ref, { status: 'paid', paidAt: serverTimestamp(), note: 'Cancelado Liquidación' }));
                   await batch.commit();
                }

                await updateDoc(doc(_db, "users", user.id), { 
                    status: 'archived', 
                    contractEndDate: new Date(inputs.fecha.value)
                });
                
                window.showToast("Liquidación registrada.", "success");
                loadEmpleadosView(); 
            });
        };

    } catch (error) {
        console.error("Error liquidación:", error);
    }
}

// --- E. FORMULARIO VACACIONES (NUEVO MÓDULO) ---
async function renderVacacionesForm(container, user) {
    container.innerHTML = `<div class="py-12 text-center"><div class="loader mx-auto"></div><p class="text-sm text-gray-400 mt-2">Calculando días disponibles...</p></div>`;

    try {
        const config = _getPayrollConfig() || { salarioMinimo: 1300000 };
        
        // 1. BASE: Vacaciones siempre es sobre el básico (sin auxilio), salvo que sea salario mínimo.
        let vacationBase = parseFloat(user.salarioBasico) || 0;
        let vacationBaseLabel = "Salario Básico";
        if (user.deduccionSobreMinimo) {
            vacationBase = config.salarioMinimo;
            vacationBaseLabel = "Salario Mínimo (Config)";
        }

        // 2. FECHAS
        const realStartDate = getEmployeeStartDate(user);
        const today = new Date();
        const diffTime = Math.abs(today - realStartDate);
        const daysWorkedTotal = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Días totales contrato

        // 3. HISTORIAL: Buscar días ya pagados/disfrutados
        // Buscamos en TOOOODO el historial de pagos
        const q = query(collection(_db, "users", user.id, "paymentHistory"));
        const snapshot = await getDocs(q);
        
        let diasTomados = 0;
        snapshot.forEach(doc => {
            const p = doc.data();
            const concepto = (p.concepto || '').toLowerCase();
            const det = p.details || {};

            // Sumamos si es un pago específico de vacaciones o si fue una liquidación final previa
            if (concepto.includes('vacaciones')) {
                // Si guardamos "diasPagados" en details, lo usamos. Si no, inferimos por monto (menos preciso)
                if (det.diasPagados) {
                    diasTomados += parseFloat(det.diasPagados);
                } else if (det.dias) {
                    diasTomados += parseFloat(det.dias); // Compatibilidad
                }
            }
            // También revisar si hubo una liquidación final anterior que pagó vacaciones
            if (concepto.includes('liquidaci') && det.vacaciones && det.diasLiquidados) {
                 // Nota: Esto es complejo si se re-contrató. 
                 // Asumimos que si hay una liquidación, el contrato se reinició y la fecha de inicio cambió.
                 // Si la fecha de inicio es la misma, sumamos esos días.
            }
        });

        // 4. CÁLCULO DE DÍAS
        // Fórmula: 15 días por cada 360 días trabajados
        const diasGenerados = (daysWorkedTotal * 15) / 360;
        const diasPendientes = Math.max(0, diasGenerados - diasTomados);
        
        // Valor monetario de los días pendientes
        const valorPendiente = (vacationBase / 30) * diasPendientes;


        // --- HTML UI ---
        container.innerHTML = `
            <form id="vacaciones-form" class="space-y-6">
                <div class="bg-cyan-50 border-l-4 border-cyan-500 p-4 rounded-r-lg flex justify-between items-center">
                    <div>
                        <h4 class="font-bold text-cyan-900">Gestión de Vacaciones</h4>
                        <p class="text-sm text-cyan-700">Disfrute o compensación en dinero.</p>
                    </div>
                     <div class="text-right text-xs hidden sm:block">
                        <p class="text-cyan-500 font-bold uppercase">Base Cálculo</p>
                        <p class="font-mono font-bold text-cyan-800">${currencyFormatter.format(vacationBase)}</p>
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-4 text-center">
                    <div class="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                        <p class="text-[10px] text-gray-400 uppercase font-bold">Generados</p>
                        <p class="text-lg font-bold text-gray-700" title="Total contrato">${diasGenerados.toFixed(1)} <span class="text-xs font-normal">días</span></p>
                    </div>
                    <div class="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                        <p class="text-[10px] text-gray-400 uppercase font-bold">Tomados</p>
                        <p class="text-lg font-bold text-orange-500">${diasTomados.toFixed(1)} <span class="text-xs font-normal">días</span></p>
                    </div>
                    <div class="bg-cyan-50 p-3 rounded-lg border border-cyan-200 shadow-sm">
                        <p class="text-[10px] text-cyan-600 uppercase font-bold">Disponibles</p>
                        <p class="text-xl font-black text-cyan-700" id="vac-saldo-dias">${diasPendientes.toFixed(1)}</p>
                    </div>
                </div>

                <div class="border-t border-gray-100 pt-4">
                    <h5 class="font-bold text-gray-700 text-sm mb-4">Registrar Novedad</h5>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Días a Pagar / Disfrutar</label>
                            <div class="flex items-center gap-2">
                                <input type="number" id="vac-dias-pagar" class="w-full border-gray-300 rounded-lg p-3 text-center font-bold text-gray-700 focus:ring-cyan-500" placeholder="0" min="0.5" step="0.5">
                                <button type="button" id="btn-max-vac" class="bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold px-3 py-3 rounded-lg border border-gray-200">MAX</button>
                            </div>
                        </div>
                        
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Valor a Pagar</label>
                            <input type="text" id="vac-valor" class="currency-input w-full border-gray-300 rounded-lg p-3 font-bold text-right text-cyan-700 focus:ring-cyan-500" value="$ 0">
                        </div>
                    </div>
                    
                    <div class="mt-4">
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Periodo / Nota</label>
                        <input type="text" id="vac-nota" class="w-full border-gray-300 rounded-lg p-3 text-sm" placeholder="Ej: Vacaciones adelantadas, Semana Santa, etc.">
                    </div>
                    
                     <div class="mt-4 flex gap-4">
                        <label class="flex items-center gap-2 cursor-pointer bg-gray-50 p-2 rounded border border-gray-100 flex-1">
                            <input type="radio" name="tipo_vac" value="disfrute" checked class="text-cyan-600 focus:ring-cyan-500">
                            <div class="text-sm">
                                <span class="block font-bold text-gray-700">Disfrute (Tiempo)</span>
                                <span class="block text-[10px] text-gray-400">El empleado sale a descansar.</span>
                            </div>
                        </label>
                         <label class="flex items-center gap-2 cursor-pointer bg-gray-50 p-2 rounded border border-gray-100 flex-1">
                            <input type="radio" name="tipo_vac" value="dinero" class="text-cyan-600 focus:ring-cyan-500">
                             <div class="text-sm">
                                <span class="block font-bold text-gray-700">Compensadas (Dinero)</span>
                                <span class="block text-[10px] text-gray-400">Se pagan sin dejar de trabajar.</span>
                            </div>
                        </label>
                    </div>
                </div>

                <div class="bg-gray-800 text-white p-5 rounded-xl flex justify-between items-center shadow-lg">
                    <div>
                        <span class="block text-[10px] text-gray-400 uppercase tracking-widest">Total a Girar</span>
                        <span class="text-xs text-gray-500">Neto Vacaciones</span>
                    </div>
                    <span id="vac-total" class="font-black text-3xl tracking-tight">$ 0</span>
                </div>

                <button type="submit" class="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 rounded-xl shadow-md transition-all flex items-center justify-center gap-2">
                    <i class="fa-solid fa-umbrella-beach"></i> Registrar Vacaciones
                </button>
            </form>
        `;
        
        // Listeners
        const inputDias = document.getElementById('vac-dias-pagar');
        const inputValor = document.getElementById('vac-valor');
        const inputNota = document.getElementById('vac-nota');
        const displayTotal = document.getElementById('vac-total');
        
        _setupCurrencyInput(inputValor);

        // Auto-calcular valor al cambiar días
        inputDias.addEventListener('input', () => {
            const dias = parseFloat(inputDias.value) || 0;
            const valor = (vacationBase / 30) * dias;
            inputValor.value = currencyFormatter.format(valor);
            displayTotal.textContent = currencyFormatter.format(valor);
        });

        // Permitir editar valor manual y actualizar total
        inputValor.addEventListener('input', () => {
             displayTotal.textContent = inputValor.value;
        });

        // Botón MAX
        document.getElementById('btn-max-vac').onclick = () => {
            inputDias.value = diasPendientes.toFixed(1);
            inputDias.dispatchEvent(new Event('input')); // Disparar recalculo
        };

        // Guardar
        document.getElementById('vacaciones-form').onsubmit = (e) => {
            e.preventDefault();
            const diasAPagar = parseFloat(inputDias.value) || 0;
            const valorTotal = parseFloat(inputValor.value.replace(/[$. ]/g, '')) || 0;
            const tipo = document.querySelector('input[name="tipo_vac"]:checked').value;
            const nota = inputNota.value || (tipo === 'disfrute' ? 'Vacaciones disfrutadas' : 'Vacaciones compensadas en dinero');

            if (diasAPagar <= 0) { window.showToast("Ingresa días válidos.", "error"); return; }

            const tituloConcepto = tipo === 'disfrute' ? 'Pago de Vacaciones (Disfrute)' : 'Vacaciones Compensadas (Dinero)';

            _openConfirmModal(`¿Registrar pago de ${diasAPagar} días de vacaciones por ${currencyFormatter.format(valorTotal)}?`, async () => {
                await saveSpecialPayment(user.id, {
                    tipo: tituloConcepto,
                    monto: valorTotal,
                    detalles: {
                        diasPagados: diasAPagar, // CLAVE: Este dato se leerá en la liquidación para descontar
                        baseCalculo: vacationBase,
                        tipoVacaciones: tipo,
                        periodoNota: nota,
                        saldoAnteriorDias: diasPendientes
                    }
                });
            });
        };

    } catch (e) {
        console.error(e);
        container.innerHTML = `<p class="text-red-500 text-center">Error cargando vacaciones.</p>`;
    }
}

/**
 * Calcula la indemnización por despido sin justa causa (Norma Colombia).
 * @param {string} type - 'fijo' o 'indefinido'
 * @param {Date} startDate - Fecha inicio contrato
 * @param {Date} endDate - Fecha de despido
 * @param {Date} contractEndDate - Fecha fin pactada (Solo para fijo)
 * @param {number} salary - Salario base
 */
function calculateIndemnificationValue(type, startDate, endDate, contractEndDate, salary) {
    if (!startDate || !endDate || !salary) return 0;
    
    // Normalizar horas
    const start = new Date(startDate); start.setHours(0,0,0,0);
    const end = new Date(endDate); end.setHours(0,0,0,0);
    
    // Diferencia en días calendario
    const diffTime = end.getTime() - start.getTime();
    // --- CAMBIO: USAR 360 ---
    const daysWorked = calculateDays360(start, end);

    if (daysWorked <= 0) return 0;

    // 1. CONTRATO A TÉRMINO FIJO
    if (type === 'fijo') {
        if (!contractEndDate) return 0; 
        
        const pactadoEnd = new Date(contractEndDate); pactadoEnd.setHours(0,0,0,0);
        if (end >= pactadoEnd) return 0;

        // Días faltantes (Base 30)
        const daysRemaining = calculateDays360(end, pactadoEnd) - 1; // Restamos 1 porque calculateDays360 es inclusivo y queremos el remanente
        
        // (salary / 30) es el valor del día
        return (salary / 30) * daysRemaining;
    }

    // 2. CONTRATO A TÉRMINO INDEFINIDO
    if (type === 'indefinido') {
        let indemnizacionDias = 0;

        if (daysWorked <= 360) {
            // Menos o igual a 1 año: Proporcional a 30 días
            // Usamos base 360 para la proporción
            indemnizacionDias = (30 * daysWorked) / 360;
        } else {
            // Más de 1 año
            indemnizacionDias = 30; // Primer año
            
            const daysRemaining = daysWorked - 360;
            const diasExtra = (20 * daysRemaining) / 360;
            indemnizacionDias += diasExtra;
        }

        return (salary / 30) * indemnizacionDias;
    }

    return 0;
}

// --- HELPER PARA GUARDAR PAGOS ESPECIALES ---
async function saveSpecialPayment(userId, data) {
    const paymentData = {
        userId: userId,
        paymentDate: new Date().toISOString().split('T')[0],
        concepto: data.tipo,
        monto: data.monto,
        details: data.detalles || {},
        createdAt: serverTimestamp(),
        registeredBy: _getCurrentUserId(),
        isSpecial: true // Flag para diferenciar en reportes
    };

    await addDoc(collection(_db, "users", userId, "paymentHistory"), paymentData);
    window.showToast("Pago registrado correctamente.", "success");
    loadPaymentHistoryView(userId); // Recargar
}

/**
 * Carga los préstamos activos dentro del formulario de nómina para aplicar deducciones.
 * Se llama automáticamente al renderizar la pestaña "Nómina".
 */
async function loadActiveLoansForForm(userId) {
    const fieldset = document.getElementById('loan-management-fieldset-placeholder');
    if (!fieldset) return;

    // 1. Mostrar estado de carga
    fieldset.innerHTML = `
        <div class="flex justify-center items-center py-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            <div class="loader-small mx-auto"></div>
            <span class="ml-2 text-xs text-gray-400">Buscando préstamos activos...</span>
        </div>`;

    try {
        // 2. Consulta a Firebase (Solo préstamos con status "active")
        const q = query(
            collection(_db, "users", userId, "loans"),
            where("status", "==", "active"),
            orderBy("date", "asc")
        );
        
        const snapshot = await getDocs(q);

        // 3. Si no hay préstamos, limpiar y salir
        if (snapshot.empty) {
            fieldset.innerHTML = `
                <div class="text-center py-3 bg-green-50 rounded-lg border border-green-100">
                    <p class="text-xs text-green-700 font-bold"><i class="fa-solid fa-check mr-1"></i> Paz y Salvo</p>
                    <p class="text-[10px] text-green-600">Este usuario no tiene deudas activas.</p>
                </div>`;
            return;
        }

        // 4. Generar HTML de la lista
        let html = `<div class="space-y-2">`;
        let totalDebt = 0;

        snapshot.forEach(doc => {
            const loan = doc.data();
            const loanId = doc.id;
            
            totalDebt += (loan.balance || 0);

            // Calcular Cuota Sugerida: (Monto Total / Cuotas Pactadas)
            // Si la cuota sugerida es mayor al saldo restante, usamos el saldo.
            let installmentVal = (loan.amount / (loan.installments || 1));
            if (installmentVal > loan.balance) {
                installmentVal = loan.balance;
            }

            html += `
                <div class="flex justify-between items-center bg-white p-2 rounded-lg border border-gray-200 shadow-sm hover:border-indigo-300 transition-colors">
                    <div class="flex-1 min-w-0 pr-3">
                        <div class="flex justify-between items-start">
                            <p class="text-xs font-bold text-gray-700 truncate" title="${loan.description}">
                                ${loan.description}
                            </p>
                            <span class="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200">
                                ${new Date(loan.date).toLocaleDateString('es-CO', {month:'short', day:'numeric'})}
                            </span>
                        </div>
                        <div class="flex justify-between items-center mt-1">
                            <p class="text-[10px] text-gray-400">
                                Cuotas: ${loan.installments}
                            </p>
                            <p class="text-[10px] font-medium text-gray-500">
                                Saldo: <span class="text-rose-600 font-bold">${currencyFormatter.format(loan.balance)}</span>
                            </p>
                        </div>
                    </div>

                    <div class="w-28">
                        <label class="block text-[9px] text-indigo-400 font-bold uppercase text-right mb-0.5">A Descontar</label>
                        <input type="text" 
                            class="loan-deduction-input w-full border border-gray-300 rounded-md py-1 px-2 text-right text-xs font-bold text-gray-800 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
                            value="${currencyFormatter.format(installmentVal)}"
                            data-loan-id="${loanId}"
                            data-balance="${loan.balance}">
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        
        // Agregar footer con totales dentro del recuadro
        html += `
            <div class="mt-3 flex justify-between items-center pt-2 border-t border-red-100">
                <span class="text-[10px] text-gray-500">Deuda Total: <strong>${currencyFormatter.format(totalDebt)}</strong></span>
                <div class="text-right">
                    <span class="text-[10px] font-bold text-rose-500 uppercase mr-1">Total Descuento:</span>
                    <span id="payment-total-loan-deduction-display" class="text-sm font-black text-rose-700">$ 0</span>
                </div>
            </div>
        `;

        fieldset.innerHTML = html;

        // 5. Configurar Listeners e Inputs
        const inputs = fieldset.querySelectorAll('.loan-deduction-input');
        inputs.forEach(input => {
            // Aplicar formato de moneda al escribir
            if (_setupCurrencyInput) _setupCurrencyInput(input);
            
            // Recalcular el total general de la nómina cuando cambia el valor
            input.addEventListener('input', () => {
                if (typeof updatePaymentTotal === 'function') {
                    updatePaymentTotal();
                }
            });
        });

        // 6. Ejecutar cálculo inicial para que el input muestre el valor correcto en el total
        if (typeof updatePaymentTotal === 'function') {
            updatePaymentTotal();
        }

    } catch (error) {
        console.error("Error cargando préstamos para formulario:", error);
        fieldset.innerHTML = `<p class="text-center text-xs text-red-500 py-2">Error al cargar datos de préstamos.</p>`;
    }
}


// --- LISTADO DE HISTORIAL (CORREGIDO PARA ABRIR COMPROBANTE) ---
function loadPaymentHistoryList(userId, tableBody, user) {
    const q = query(collection(_db, "users", userId, "paymentHistory"), orderBy("createdAt", "desc"));
    
    // Usamos la variable global de suscripción para poder limpiarla después
    unsubscribeEmpleadosTab = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td class="p-8 text-center text-sm text-gray-400 border-b border-gray-50">No hay pagos registrados aún.</td></tr>`;
            return;
        }
        
        tableBody.innerHTML = '';
        
        snapshot.forEach(docSnap => {
            const payment = { id: docSnap.id, ...docSnap.data() };
            const date = payment.createdAt ? payment.createdAt.toDate().toLocaleDateString('es-CO') : '---';
            const isSpecial = payment.isSpecial ? '<span class="inline-block bg-yellow-100 text-yellow-800 text-[9px] font-bold px-1.5 py-0.5 rounded ml-2 uppercase tracking-wide">Especial</span>' : '';
            
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50 transition-colors group";
            tr.innerHTML = `
                <td class="p-4 border-b border-gray-100">
                    <div class="flex justify-between items-start mb-1">
                        <span class="text-xs font-bold text-gray-500 font-mono">${date}</span>
                        <span class="text-sm font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">${currencyFormatter.format(payment.monto)}</span>
                    </div>
                    <p class="text-xs text-gray-700 font-medium truncate max-w-[200px]">${payment.concepto} ${isSpecial}</p>
                    
                    <div class="flex justify-end gap-2 mt-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                         <button class="view-voucher-btn text-[10px] font-bold bg-white text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors shadow-sm flex items-center">
                            <i class="fa-regular fa-eye mr-1"></i> Ver
                         </button>
                         <button class="delete-payment-btn text-[10px] font-bold bg-white text-rose-500 border border-rose-200 px-3 py-1.5 rounded-lg hover:bg-rose-50 transition-colors shadow-sm flex items-center">
                            <i class="fa-solid fa-trash mr-1"></i>
                         </button>
                    </div>
                </td>`;
            
             // Asignar listeners directamente al elemento creado
             const viewBtn = tr.querySelector('.view-voucher-btn');
             const delBtn = tr.querySelector('.delete-payment-btn');

             // CORRECCIÓN PRINCIPAL: Pasamos 'user' que viene como argumento
             viewBtn.onclick = () => openPaymentVoucherModal(payment, user);
             
             delBtn.onclick = () => {
                 _openConfirmModal("¿Eliminar este registro de pago de forma permanente?", async() => {
                    try {
                        await deleteDoc(doc(_db, "users", userId, "paymentHistory", payment.id));
                        window.showToast("Registro eliminado", "success");
                    } catch(e) {
                        console.error(e);
                        window.showToast("Error al eliminar", "error");
                    }
                 });
             };
             
             tableBody.appendChild(tr);
        });
    });
}

// Función global o exportada para borrar
window.deletePayment = (uid, pid) => {
    _openConfirmModal("¿Eliminar registro de pago?", async() => {
        await deleteDoc(doc(_db, "users", uid, "paymentHistory", pid));
    });
};

/**
 * Calcula la base para prestaciones (Prima/Cesantías)
 * Regla: Si cotiza mínimo -> (SMMLV + Aux). Si no -> (Sueldo + Aux si aplica).
 */
function calculateBaseForBenefits(user) {
    const config = _getPayrollConfig() || { salarioMinimo: 1300000, auxilioTransporte: 162000 }; // Fallback
    const minWage = config.salarioMinimo;
    const aux = config.auxilioTransporte;
    
    // CASO 1: Empleado configurado para cotizar sobre el mínimo
    if (user.deduccionSobreMinimo === true) {
        return {
            value: minWage + aux,
            isMinimum: true,
            label: 'Salario Mínimo + Aux. Transporte'
        };
    }

    // CASO 2: Empleado normal
    let base = parseFloat(user.salarioBasico) || 0;
    
    // Regla de ley: Si gana menos de 2 SMMLV, se suma auxilio
    if (base <= (minWage * 2)) {
        return {
            value: base + aux,
            isMinimum: false,
            label: 'Salario Básico + Aux. Transporte'
        };
    }

    // CASO 3: Gana más de 2 SMMLV (Salario integral o alto sin auxilio)
    return {
        value: base,
        isMinimum: false,
        label: 'Salario Básico (Sin Auxilio)'
    };
}


/**
 * (FUNCIÓN ACTUALIZADA - FASE 3: LÓGICA DE LIQUIDACIÓN)
 * Calcula el total a pagar en el formulario de registro de pago en tiempo real.
 */
function updatePaymentTotal() {
    const config = _getPayrollConfig();
    if (!config || !config.salarioMinimo) {
        console.warn("Configuración de nómina no cargada. Los cálculos pueden ser incorrectos.");
        return;
    }

    const form = document.getElementById('payment-register-form');
    const salarioEl = document.getElementById('payment-salario-basico');
    const bonificacionEl = document.getElementById('payment-bonificacion-mes');
    const diasPagar = parseFloat(document.getElementById('payment-dias-pagar').value) || 0;

    // --- INICIO DE MODIFICACIÓN (FASE 3) ---
    // 1. Obtener el checkbox de liquidación
    const liquidarCheckbox = document.getElementById('payment-liquidar-bonificacion');
    const liquidarBonificacion = liquidarCheckbox.checked; // true si está marcado
    // --- FIN DE MODIFICACIÓN ---

    // 2. Obtener valores MENSUALES
    const salarioMensual = parseFloat(salarioEl.dataset.value || 0);
    const auxTransporteMensual = parseFloat(salarioEl.dataset.auxTransporte || 0);

    // 3. Calcular valores PRORRATEADOS
    const salarioProrrateado = (salarioMensual / 30) * diasPagar;
    const auxTransporteProrrateado = (auxTransporteMensual / 30) * diasPagar;

    // 4. Obtener valores que NO se prorratean
    const otros = parseFloat(document.getElementById('payment-otros').value.replace(/[$. ]/g, '')) || 0;

    let loanDeduction = 0;
    document.querySelectorAll('.loan-deduction-input').forEach(input => {
        const val = parseFloat(input.value.replace(/[$. ]/g, '')) || 0;
        loanDeduction += val;
    });

    // Actualizar el display del total a descontar en el fieldset
    const loanTotalDisplay = document.getElementById('payment-total-loan-deduction-display');
    if (loanTotalDisplay) loanTotalDisplay.textContent = currencyFormatter.format(loanDeduction);

    // --- INICIO DE MODIFICACIÓN (FASE 3) ---
    // 5. Determinar la bonificación a pagar
    const bonificacionPotencial = parseFloat(bonificacionEl.dataset.value || 0);
    let bonificacionAPagar = 0; // Por defecto es 0 (ej. primera quincena)

    // Solo incluimos la bonificación si el checkbox está marcado
    if (liquidarBonificacion) {
        bonificacionAPagar = bonificacionPotencial;
    }
    // --- FIN DE MODIFICACIÓN ---

    // 6. Calcular Horas Extra
    const horasExtra = parseFloat(document.getElementById('payment-horas-diurnas').value) || 0;
    const valorHora = (salarioMensual / 235);
    const multiplicador = config.multiplicadorHoraExtra || 1.25;
    const totalHorasExtra = (horasExtra * valorHora * multiplicador);

    document.getElementById('payment-total-horas').textContent = currencyFormatter.format(totalHorasExtra);

    // 7. Calcular Deducciones (usando bonificacionAPagar)
    const deduccionSobreMinimo = form.dataset.deduccionSobreMinimo === 'true';
    let baseDeduccion = 0;

    if (deduccionSobreMinimo) {
        baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
    } else {
        // Base es: Básico + H.Extra + BONIFICACIÓN (solo si se paga)
        baseDeduccion = salarioProrrateado + totalHorasExtra + bonificacionAPagar;
    }

    if (baseDeduccion > 0 && baseDeduccion < (config.salarioMinimo / 30) * diasPagar) {
        baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
    }

    const deduccionSalud = baseDeduccion * (config.porcentajeSalud / 100);
    const deduccionPension = baseDeduccion * (config.porcentajePension / 100);
    const totalDeducciones = deduccionSalud + deduccionPension;

    // 8. Calcular Total Final (usando bonificacionAPagar)
    const totalDevengado = salarioProrrateado + auxTransporteProrrateado + bonificacionAPagar + totalHorasExtra + otros;
    const totalPagar = totalDevengado - totalDeducciones - loanDeduction; // Se usa la suma calculada

    document.getElementById('payment-total-pagar').textContent = currencyFormatter.format(totalPagar);
}

/**
 * (FUNCIÓN COMPLETA CORREGIDA) Registra el pago, aplica deducciones y AMORTIZA PRÉSTAMOS.
 */
async function handleRegisterPayment(e, userId) {
    e.preventDefault();
    const submitButton = document.getElementById('payment-submit-button');
    submitButton.disabled = true;
    submitButton.innerHTML = '<div class="loader-small-white mx-auto"></div>';

    const config = _getPayrollConfig();
    
    // Función auxiliar para limpiar moneda
    const parseMoney = (idOrValue) => {
        let val = typeof idOrValue === 'string' ? idOrValue : document.getElementById(idOrValue).value;
        return parseFloat(val.replace(/[$. ]/g, '')) || 0;
    };

    try {
        const diasPagar = parseFloat(document.getElementById('payment-dias-pagar').value) || 0;
        
        // 1. LEER DATOS BASE
        const salarioEl = document.getElementById('payment-salario-basico');
        const salarioMensual = parseFloat(salarioEl.dataset.value || 0);
        const auxTransporteMensual = parseFloat(salarioEl.dataset.auxTransporte || 0);

        // 2. CÁLCULOS PRORRATEADOS (DEFINICIÓN DE VARIABLES FALTANTES)
        const salarioProrrateado = (salarioMensual / 30) * diasPagar;
        const auxTransporteProrrateado = (auxTransporteMensual / 30) * diasPagar; // <--- AQUÍ SE DEFINE LA VARIABLE

        const otros = parseMoney('payment-otros');
        // Aseguramos leer el texto del span de horas
        const totalHorasExtra = parseMoney(document.getElementById('payment-total-horas').textContent); 
        const concepto = document.getElementById('payment-concepto').value;

        // 3. Préstamos
        let totalLoanDeduction = 0;
        const loanPayments = []; 
        document.querySelectorAll('.loan-deduction-input').forEach(input => {
            const val = parseFloat(input.value.replace(/[$. ]/g, '')) || 0;
            if (val > 0) {
                totalLoanDeduction += val;
                loanPayments.push({
                    loanId: input.dataset.loanId,
                    amount: val,
                    previousBalance: parseFloat(input.dataset.balance)
                });
            }
        });

        // 4. Bonificación
        const liquidarBonificacion = document.getElementById('payment-liquidar-bonificacion').checked;
        const bonificacionPotencial = parseFloat(document.getElementById('payment-bonificacion-mes').dataset.value || 0);
        const bonificacionPagada = liquidarBonificacion ? bonificacionPotencial : 0;

        // Validaciones
        if (!concepto) throw new Error("Ingresa un concepto.");
        if (diasPagar <= 0) throw new Error("Días a pagar inválidos.");

        // 5. Deducciones Ley
        const deduccionSobreMinimo = document.getElementById('payment-register-form').dataset.deduccionSobreMinimo === 'true';
        let baseDeduccion = 0;
        
        if (deduccionSobreMinimo && config.salarioMinimo) {
            baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
        } else {
            baseDeduccion = salarioProrrateado + totalHorasExtra + bonificacionPagada;
        }

        // Validación extra para no cotizar por debajo del mínimo proporcional
        if (config.salarioMinimo && baseDeduccion > 0 && baseDeduccion < (config.salarioMinimo / 30) * diasPagar) {
            baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
        }

        const deduccionSalud = baseDeduccion * (config.porcentajeSalud / 100);
        const deduccionPension = baseDeduccion * (config.porcentajePension / 100);
        const totalDeduccionesLey = deduccionSalud + deduccionPension;

        // 6. NETO FINAL
        const totalDevengado = salarioProrrateado + auxTransporteProrrateado + bonificacionPagada + totalHorasExtra + otros;
        const totalPagar = totalDevengado - totalDeduccionesLey - totalLoanDeduction;

        if (totalPagar < 0) {
            throw new Error(`El total es negativo ($${totalPagar.toLocaleString()}). Los descuentos superan el sueldo. Reduce el abono a préstamos.`);
        }

        // 7. Guardar
        const currentUserId = _getCurrentUserId();
        const usersMap = _getUsersMap();
        const currentUser = usersMap.get(currentUserId);
        const registeredByName = currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : 'Sistema';

        const paymentData = {
            userId: userId,
            paymentDate: new Date().toISOString().split('T')[0],
            concepto: concepto,
            monto: totalPagar,
            diasPagados: diasPagar,
            desglose: {
                salarioProrrateado: salarioProrrateado,
                auxilioTransporteProrrateado: auxTransporteProrrateado, // <--- AHORA SÍ EXISTE
                bonificacionM2: bonificacionPagada,
                horasExtra: totalHorasExtra, 
                otros: otros, 
                abonoPrestamos: totalLoanDeduction,
                detallesPrestamos: loanPayments, 
                deduccionSalud: -deduccionSalud,
                deduccionPension: -deduccionPension, 
                baseDeduccion: baseDeduccion, 
                deduccionSobreMinimo: deduccionSobreMinimo
            },
            horas: { totalHorasExtra: parseFloat(document.getElementById('payment-horas-diurnas').value) || 0 },
            createdAt: serverTimestamp(),
            registeredBy: currentUserId,
            registeredByName: registeredByName
        };

        const batch = writeBatch(_db);
        const paymentHistoryRef = doc(collection(_db, "users", userId, "paymentHistory"));
        batch.set(paymentHistoryRef, paymentData);

        if (liquidarBonificacion) {
            const today = new Date();
            const currentStatDocId = `${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}`;
            const statRef = doc(_db, "employeeStats", userId, "monthlyStats", currentStatDocId);
            batch.set(statRef, { bonificacionPagada: true }, { merge: true });
        }

        loanPayments.forEach(pago => {
            const loanRef = doc(_db, "users", userId, "loans", pago.loanId);
            const newBalance = pago.previousBalance - pago.amount;
            const updateData = { balance: newBalance };
            if (newBalance <= 0) { updateData.status = 'paid'; updateData.paidAt = serverTimestamp(); }
            batch.update(loanRef, updateData);
        });

        await batch.commit();

        if(window.showToast) window.showToast("Pago registrado exitosamente.", "success");
        
        // Reset
        document.getElementById('payment-horas-diurnas').value = '0';
        document.getElementById('payment-otros').value = '$ 0';
        loadPaymentHistoryView(userId);

    } catch (error) {
        console.error(error);
        if(window.showToast) window.showToast(error.message, "error");
        else alert(error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i>Registrar Pago';
    }
}


/**
 * Crea una ventana flotante temporal para pedir datos (Reemplazo de prompt)
 * Retorna una Promesa que se resuelve con el valor o null si cancela.
 */
function openCustomInputModal(title, label, inputType = 'text', placeholder = '') {
    return new Promise((resolve) => {
        // 1. Crear el Overlay
        const overlay = document.createElement('div');
        overlay.className = "fixed inset-0 bg-gray-900 bg-opacity-50 z-[9999] flex items-center justify-center transition-opacity opacity-0";

        // 2. Crear la Tarjeta Modal
        const modal = document.createElement('div');
        modal.className = "bg-white rounded-xl shadow-2xl w-full max-w-md p-6 transform scale-95 transition-transform duration-200";

        modal.innerHTML = `
            <h3 class="text-lg font-bold text-gray-800 mb-4">${title}</h3>
            <div class="mb-5">
                <label class="block text-xs font-bold text-gray-500 uppercase mb-2">${label}</label>
                <input type="${inputType}" id="custom-modal-input" 
                    class="w-full border border-gray-300 rounded-lg p-3 text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    placeholder="${placeholder}">
            </div>
            <div class="flex justify-end gap-3">
                <button id="btn-cancel-custom" class="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
                    Cancelar
                </button>
                <button id="btn-confirm-custom" class="px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-md transition-transform transform active:scale-95">
                    Confirmar
                </button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Animación de entrada
        requestAnimationFrame(() => {
            overlay.classList.remove('opacity-0');
            modal.classList.remove('scale-95');
            modal.classList.add('scale-100');
            document.getElementById('custom-modal-input').focus();
        });

        // Lógica de Cierre
        const close = (val) => {
            overlay.classList.add('opacity-0');
            modal.classList.remove('scale-100');
            modal.classList.add('scale-95');
            setTimeout(() => { if (document.body.contains(overlay)) document.body.removeChild(overlay); }, 200);
            resolve(val);
        };

        // Listeners
        document.getElementById('btn-cancel-custom').onclick = () => close(null);

        const confirmBtn = document.getElementById('btn-confirm-custom');
        const input = document.getElementById('custom-modal-input');

        const handleConfirm = () => {
            const val = input.value.trim();
            if (!val) {
                input.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                input.focus();
                return;
            }
            close(val);
        };

        confirmBtn.onclick = handleConfirm;

        // Permitir Enter para confirmar
        input.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') handleConfirm();
            if (e.key === 'Escape') close(null);
        });
    });
}

/**
 * Abre un modal para seleccionar documentos y descargarlos como ZIP.
 * (CORREGIDO: Usa _db y agrega opción de Certificado sin sueldo)
 */
async function openBatchDownloadModal(user) {
    const userId = user.id;
    const userName = `${user.firstName}_${user.lastName}`.replace(/\s+/g, '_');

    // 1. Definir categorías RRHH
    const RELEVANT_RRHH = ['cedula', 'hoja_vida', 'certificados', 'seguridad_social'];
    const RRHH_LABELS = {
        'cedula': 'Cédula de Ciudadanía',
        'hoja_vida': 'Hoja de Vida',
        'certificados': 'Certificados de Estudio',
        'seguridad_social': 'Certificados ARL/EPS/CCF'
    };

    // 2. Modal UI
    let modalId = 'zip-download-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const modalHtml = `
        <div id="${modalId}" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-[60] flex items-center justify-center transition-opacity">
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 m-4 transform transition-all scale-100">
                <div class="flex justify-between items-center mb-4 border-b pb-2">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-file-zipper text-indigo-600 mr-2"></i> Compilar Documentos</h3>
                    <button id="close-zip-modal" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-xl"></i></button>
                </div>
                
                <div id="zip-modal-content" class="max-h-[60vh] overflow-y-auto custom-scrollbar p-1">
                    <div class="text-center py-10"><div class="loader mx-auto"></div><p class="text-xs text-gray-400 mt-2">Buscando documentos...</p></div>
                </div>

                <div class="mt-6 pt-4 border-t border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                    
                    <button id="btn-gen-cert-sst" class="text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors border border-transparent hover:border-indigo-100 w-full sm:w-auto justify-center">
                        <i class="fa-solid fa-file-contract"></i> Certificado (Solo Cargo)
                    </button>

                    <div class="flex items-center gap-4 w-full sm:w-auto justify-end">
                        <div class="text-xs text-gray-500 text-right hidden sm:block">
                            <span id="zip-selected-count">0</span> seleccionados
                        </div>
                        <button id="btn-start-download" disabled class="bg-gray-300 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center justify-center transition-colors shadow-sm w-full sm:w-auto">
                            Descargar ZIP
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Listener para cerrar
    document.getElementById('close-zip-modal').onclick = () => document.getElementById(modalId).remove();

    // --- LISTENER DEL NUEVO BOTÓN DE CERTIFICADO ---
    document.getElementById('btn-gen-cert-sst').onclick = () => {
        document.getElementById(modalId).remove();

        // Usamos window.openMainModal porque estamos en un módulo
        if (window.openMainModal) {
            window.openMainModal('generate-certification', {
                ...user,
                forceNoSalary: true, // <--- ESTO ACTIVA EL MODO SIN SUELDO
                jobTitle: user.jobTitle || 'Operario'
            });
        }
    };

    try {
        // 3. Consultar documentos (USANDO _db)
        const q = query(collection(_db, "users", userId, "documents")); // <--- CORRECCIÓN AQUÍ (_db)
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            document.getElementById('zip-modal-content').innerHTML = `<p class="text-center text-gray-500 py-8">Este usuario no tiene documentos cargados.</p>`;
            return;
        }

        // 4. Clasificar
        const rrhhDocs = [];
        const sstDocs = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            if (RELEVANT_RRHH.includes(data.category)) rrhhDocs.push(data);
            else if (data.category.startsWith('sst_')) sstDocs.push(data);
        });

        const contentDiv = document.getElementById('zip-modal-content');
        contentDiv.innerHTML = '';

        const renderSection = (title, docs, color) => {
            if (docs.length === 0) return '';
            let html = `<h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2 mt-4 border-b pb-1">${title}</h4>`;
            html += docs.map(doc => {
                const date = doc.uploadedAt ? doc.uploadedAt.toDate().toLocaleDateString() : '';
                const label = RRHH_LABELS[doc.category] || doc.description || doc.name;
                return `
                    <label class="flex items-center p-3 rounded-lg border border-gray-100 hover:bg-${color}-50 cursor-pointer transition-colors group">
                        <input type="checkbox" class="zip-checkbox form-checkbox h-5 w-5 text-${color}-600 rounded border-gray-300 focus:ring-${color}-500" 
                            data-url="${doc.url}" data-name="${doc.name}" data-cat="${doc.category}">
                        <div class="ml-3 flex-1 min-w-0">
                            <p class="text-sm font-bold text-gray-700 group-hover:text-${color}-700 truncate">${label}</p>
                            <p class="text-xs text-gray-400">${doc.name} • ${date}</p>
                        </div>
                        <i class="fa-solid fa-file-arrow-down text-gray-300 group-hover:text-${color}-400"></i>
                    </label>
                `;
            }).join('');
            return html;
        };

        contentDiv.innerHTML += renderSection('Documentos Personales (RRHH)', rrhhDocs, 'blue');
        contentDiv.innerHTML += renderSection('Seguridad y Salud (SST)', sstDocs, 'indigo');

        if (rrhhDocs.length === 0 && sstDocs.length === 0) {
            contentDiv.innerHTML = `<p class="text-center text-gray-500 py-8">No hay documentos de las categorías requeridas.</p>`;
            return;
        }

        // 5. Lógica de Selección
        const checkboxes = contentDiv.querySelectorAll('.zip-checkbox');
        const btnDownload = document.getElementById('btn-start-download');
        const countLabel = document.getElementById('zip-selected-count');

        const updateCount = () => {
            const count = contentDiv.querySelectorAll('.zip-checkbox:checked').length;
            countLabel.textContent = count;
            if (count > 0) {
                btnDownload.disabled = false;
                btnDownload.classList.remove('bg-gray-300');
                btnDownload.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
            } else {
                btnDownload.disabled = true;
                btnDownload.classList.add('bg-gray-300');
                btnDownload.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            }
        };

        checkboxes.forEach(cb => cb.addEventListener('change', updateCount));

        btnDownload.onclick = async () => {
            const selected = Array.from(contentDiv.querySelectorAll('.zip-checkbox:checked'));
            if (selected.length === 0) return;
            btnDownload.disabled = true;
            btnDownload.innerHTML = `<div class="loader-small-white mr-2"></div> Comprimiendo...`;

            const zip = new JSZip();
            const folderName = `Documentos_${userName}`;
            const folder = zip.folder(folderName);

            try {
                const promises = selected.map(async (checkbox) => {
                    const url = checkbox.dataset.url;
                    const originalName = checkbox.dataset.name;
                    const category = checkbox.dataset.cat;
                    const safeName = originalName.replace(/[^a-z0-9.\-_]/gi, '_');
                    const fileName = `${category}_${safeName}`;

                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`Error descargando ${originalName}`);
                    const blob = await response.blob();
                    folder.file(fileName, blob);
                });

                await Promise.all(promises);
                const content = await zip.generateAsync({ type: "blob" });
                saveAs(content, `${folderName}.zip`);

                if (window.showToast) window.showToast("Descarga iniciada.", "success");
                document.getElementById(modalId).remove();

            } catch (error) {
                console.error("Error ZIP:", error);
                if (window.showToast) window.showToast("Error en descarga.", "error");
                btnDownload.innerHTML = "Reintentar";
                btnDownload.disabled = false;
            }
        };

    } catch (error) {
        console.error("Error loading for zip:", error);
        document.getElementById('zip-modal-content').innerHTML = `<p class="text-red-500 text-center">Error cargando documentos.</p>`;
    }
}

// --- VARIABLES GLOBALES PARA ASISTENCIA ---
let attendanceChartInstance = null;
let attendanceMapInstance = null;
let attendanceMarkersLayer = null;

/**
 * Carga la pestaña de Asistencia / Reporte de Ingreso.
 * @param {string} userId - ID del empleado.
 * @param {number} days - Días a consultar (7, 15, 30).
 */
async function loadAttendanceTab(userId, days = 7) {
    const listBody = document.getElementById('attendance-list-body');
    const chartCanvas = document.getElementById('attendance-chart');

    if (!listBody || !chartCanvas) return;

    // 1. Calcular rango de fechas
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0); // Aseguramos inicio del día

    // Limpiar UI
    listBody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><div class="loader mx-auto"></div></td></tr>';

    try {
        // 2. Consultar Firestore (CORREGIDO: Usamos _db en lugar de db)
        const q = query(
            collection(_db, "users", userId, "attendance_reports"),
            where("type", "==", "ingreso"),
            where("timestamp", ">=", startDate),
            orderBy("timestamp", "desc")
        );

        const snapshot = await getDocs(q);
        const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 3. Procesar datos para Grafica y Mapa
        const chartLabels = [];
        const chartData = [];
        const mapPoints = [];

        listBody.innerHTML = ''; // Limpiar loader

        if (reports.length === 0) {
            listBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">No hay registros en este periodo.</td></tr>';
            if (attendanceChartInstance) attendanceChartInstance.destroy();

            // Limpiar mapa si existe
            if (attendanceMarkersLayer) attendanceMarkersLayer.clearLayers();
            return;
        }

        // Recorremos en orden inverso (cronológico para la gráfica)
        const reportsForChart = [...reports].reverse();

        reportsForChart.forEach(report => {
            const dateObj = report.timestamp.toDate();
            const dateStr = dateObj.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

            // Convertir hora a decimal para la gráfica (Ej: 8:30 -> 8.5)
            const hours = dateObj.getHours();
            const minutes = dateObj.getMinutes();
            const timeDecimal = hours + (minutes / 60);

            chartLabels.push(dateStr);
            chartData.push(timeDecimal);
        });

        // Llenar Tabla (El más reciente primero)
        reports.forEach(report => {
            const dateObj = report.timestamp.toDate();
            const dateStr = dateObj.toLocaleDateString('es-CO');
            const timeStr = dateObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });

            const lat = report.location?.lat;
            const lng = report.location?.lng;
            const hasLocation = lat && lng;

            if (hasLocation) {
                mapPoints.push({ lat, lng, date: `${dateStr} - ${timeStr}` });
            }

            // Detectar dispositivo simplificado
            let deviceName = "Móvil";
            if (report.device && report.device.includes("Windows")) deviceName = "PC";
            if (report.device && report.device.includes("Macintosh")) deviceName = "Mac";
            if (report.device && report.device.includes("Linux")) deviceName = "Linux";

            const row = document.createElement('tr');
            row.className = "bg-white border-b hover:bg-gray-50";
            row.innerHTML = `
                <td class="px-6 py-4 font-medium text-gray-900">${dateStr}</td>
                <td class="px-6 py-4 font-bold text-blue-600">${timeStr}</td>
                <td class="px-6 py-4 text-center">
                    ${report.photoURL ?
                    `<button onclick="window.openImageModal('${report.photoURL}')" class="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded border border-indigo-100 hover:bg-indigo-100 transition-colors">Ver Foto</button>`
                    : '<span class="text-gray-400">-</span>'}
                </td>
                <td class="px-6 py-4 text-center">
                    ${hasLocation ?
                    `<a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" class="text-green-500 hover:text-green-700" title="Abrir en Google Maps"><i class="fa-solid fa-map-location-dot text-xl"></i></a>`
                    : '<span class="text-gray-300"><i class="fa-solid fa-location-slash"></i></span>'}
                </td>
                <td class="px-6 py-4 text-xs text-gray-500 truncate max-w-[150px]" title="${report.device || ''}">${deviceName}</td>
            `;
            listBody.appendChild(row);
        });

        // 4. Renderizar Gráfica
        renderAttendanceChart(chartCanvas, chartLabels, chartData);

        // 5. Renderizar Mapa (con pequeño delay para asegurar que el div es visible)
        setTimeout(() => {
            renderAttendanceMap(mapPoints);
        }, 200);

    } catch (error) {
        console.error("Error cargando asistencia:", error);
        listBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">Error cargando datos: ${error.message}</td></tr>`;
    }
}

function renderAttendanceChart(canvas, labels, data) {
    if (attendanceChartInstance) {
        attendanceChartInstance.destroy();
    }

    attendanceChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Hora de Ingreso',
                data: data,
                borderColor: '#2563eb', // Blue 600
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                borderWidth: 2,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#2563eb',
                pointRadius: 4,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 6, // 6:00 AM
                    max: 12, // 12:00 PM (ajustable)
                    ticks: {
                        callback: function (value) {
                            const hours = Math.floor(value);
                            const minutes = Math.round((value - hours) * 60);
                            const ampm = hours >= 12 ? 'PM' : 'AM';
                            const displayHour = hours > 12 ? hours - 12 : hours;
                            return `${displayHour}:${minutes.toString().padStart(2, '0')} ${ampm}`;
                        }
                    },
                    title: { display: true, text: 'Hora (AM)' }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const value = context.raw;
                            const hours = Math.floor(value);
                            const minutes = Math.round((value - hours) * 60);
                            return `Llegada: ${hours}:${minutes.toString().padStart(2, '0')}`;
                        }
                    }
                }
            }
        }
    });
}

function renderAttendanceMap(points) {
    const mapContainer = document.getElementById('attendance-map');
    if (!mapContainer) return;

    // Si el mapa no está inicializado, crearlo
    if (!attendanceMapInstance) {
        // Coordenadas por defecto (Colombia) o la primera del punto
        const center = points.length > 0 ? [points[0].lat, points[0].lng] : [4.6097, -74.0817];
        attendanceMapInstance = L.map('attendance-map').setView(center, 12);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(attendanceMapInstance);

        attendanceMarkersLayer = L.layerGroup().addTo(attendanceMapInstance);
    } else {
        // Si ya existe, invalidar tamaño (fix común de Leaflet en pestañas ocultas)
        attendanceMapInstance.invalidateSize();
    }

    // Limpiar marcadores anteriores
    if (attendanceMarkersLayer) attendanceMarkersLayer.clearLayers();

    if (points.length > 0) {
        const group = new L.featureGroup();

        points.forEach(p => {
            const marker = L.marker([p.lat, p.lng])
                .bindPopup(`<b>${p.date}</b>`)
                .addTo(attendanceMarkersLayer);
            group.addLayer(marker);
        });

        // Ajustar zoom para ver todos los puntos
        attendanceMapInstance.fitBounds(group.getBounds().pad(0.1));
    }
}