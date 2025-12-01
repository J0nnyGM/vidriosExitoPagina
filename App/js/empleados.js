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

    // 2. Inicializar Storage de forma segura (Ahora que la App existe)
    try {
        _storage = getStorage();
    } catch (e) {
        console.warn("Advertencia: Storage no se pudo inicializar aún (normal si no has configurado buckets).", e);
    }

    // 3. Guardar referencia a función externa
    window.loadDotacionAsignaciones = loadDotacionFunc;

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

// 1. ACTUALIZAR loadEmpleadosView (Nuevos Nombres)
export function loadEmpleadosView() {
    const role = _getCurrentUserRole();
    const tabsNav = document.getElementById('empleados-tabs-nav');
    const viewContainer = document.getElementById('empleados-view');
    if (!tabsNav || !viewContainer) return;

    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    // (Selector de mes se mantiene igual...)
    if (!viewContainer.querySelector('#empleado-month-selector')) {
        const header = viewContainer.querySelector('.flex.justify-between.items-center');
        header.insertAdjacentHTML('beforeend', `
            <div>
                <label for="empleado-month-selector" class="block text-sm font-medium text-gray-700">Seleccionar Mes:</label>
                <input type="month" id="empleado-month-selector"
                       class="mt-1 block w-full md:w-auto px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500">
            </div>
        `);
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        document.getElementById('empleado-month-selector').value = `${year}-${month}`;
        document.getElementById('empleado-month-selector').addEventListener('change', () => {
            const activeTabKey = tabsNav.querySelector('.active')?.dataset.tab || 'productividad';
            switchEmpleadosTab(activeTabKey);
        });
    }

    // DEFINICIÓN DE PESTAÑAS
    const allTabs = {
        productividad: { label: 'Productividad', roles: ['admin'] },
        documentos: { label: 'RRHH', roles: ['admin', 'sst'] }, // <-- CAMBIO: RRHH
        sst: { label: 'SST', roles: ['admin', 'sst'] }, // <-- CAMBIO: Solo SST
        nomina: { label: 'Nómina', roles: ['admin', 'nomina'] },
        historial_global: { label: 'Historial Pagos', roles: ['admin', 'nomina'] }
    };

    const availableTabs = Object.keys(allTabs).filter(key =>
        allTabs[key].roles.includes(role)
    );

    tabsNav.innerHTML = '';
    availableTabs.forEach(tabKey => {
        tabsNav.innerHTML += `
            <button data-tab="${tabKey}"
                class="empleados-tab-button whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
                ${allTabs[tabKey].label}
            </button>
        `;
    });

    if (availableTabs.length > 0) {
        const currentActiveTab = tabsNav.querySelector('.active')?.dataset.tab;
        const defaultTab = availableTabs[0];
        switchEmpleadosTab(defaultTab);
    } else {
        document.getElementById('empleados-content-container').innerHTML =
            '<p class="text-gray-500">Esta sección no está disponible para tu rol.</p>';
    }
}

// 2. ACTUALIZAR switchEmpleadosTab
function switchEmpleadosTab(tabName) {
    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    const container = document.getElementById('empleados-content-container');
    container.innerHTML = '<div class="p-8 text-center"><div class="loader mx-auto"></div></div>';

    document.querySelectorAll('.empleados-tab-button').forEach(button => {
        const isActive = button.dataset.tab === tabName;
        button.classList.toggle('active', isActive);
        button.classList.toggle('border-blue-500', isActive);
        button.classList.toggle('text-blue-600', isActive);
        button.classList.toggle('border-transparent', !isActive);
        button.classList.toggle('text-gray-500', !isActive);
    });

    switch (tabName) {
        case 'productividad':
            const prodDiv = document.createElement('div');
            container.innerHTML = ''; container.appendChild(prodDiv);
            loadProductividadTab(prodDiv);
            break;

        case 'documentos':
            const docsDiv = document.createElement('div');
            container.innerHTML = ''; container.appendChild(docsDiv);
            loadDocumentosTab(docsDiv); // Ahora carga solo documentos
            break;

        case 'sst': // <-- NUEVO CASO
            const sstDiv = document.createElement('div');
            container.innerHTML = ''; container.appendChild(sstDiv);
            loadSSTTab(sstDiv); // Función dedicada a alertas
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

    // --- LÓGICA BUSCADOR ---
    const usersMap = _getUsersMap();
    const usersArray = Array.from(usersMap.values()).filter(u => u.status === 'active');

    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        resultsBox.innerHTML = '';
        if (term.length < 2) { resultsBox.classList.add('hidden'); return; }
        const filtered = usersArray.filter(u => `${u.firstName} ${u.lastName}`.toLowerCase().includes(term) || u.idNumber.includes(term));

        if (filtered.length === 0) resultsBox.innerHTML = '<div class="p-3 text-sm text-gray-500">No encontrado</div>';
        else {
            filtered.forEach(user => {
                const div = document.createElement('div');
                div.className = "p-3 hover:bg-indigo-50 cursor-pointer border-b border-gray-100 flex items-center gap-3";
                div.innerHTML = `<div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-xs font-bold">${user.firstName[0]}${user.lastName[0]}</div><div><p class="text-sm font-bold text-gray-800">${user.firstName} ${user.lastName}</p><p class="text-xs text-gray-500">CC: ${user.idNumber}</p></div>`;
                div.onclick = () => {
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
    // Usamos una colección nueva: 'company_documents' con filtro type == 'sst'
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

            // Listeners: Borrar Archivos
            card.querySelectorAll('.btn-delete-sst-doc').forEach(btn => {
                btn.addEventListener('click', function () {
                    const docId = this.dataset.id;
                    const path = this.dataset.path;
                    const name = this.dataset.name;

                    openConfirmModal(`¿Eliminar "${name}" del sistema?`, async () => {
                        try {
                            await deleteObject(ref(_storage, path)); // Borrar de Storage
                            await deleteDoc(doc(_db, "company_documents", docId)); // Borrar de BD

                            window.showToast("Documento eliminado.", "success");
                            if (window.logAuditAction) window.logAuditAction("Eliminar Doc SST", `Borrado: ${name}`, _getCurrentUserId());

                        } catch (e) {
                            console.error(e);
                            window.showToast("Error al eliminar.", "error");
                        }
                    });
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

        if (file.size > 10 * 1024 * 1024) { // 10MB límite para docs generales
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
                system: 'sst', // Identificador del sistema
                category: activeCategoryId, // politica, matriz, etc.
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
            window.showToast("Error en la carga.", "error");
        } finally {
            fileInput.value = '';
            activeCategoryId = null;
        }
    });
}

// ----------------------------------------------------------
// SUB-MÓDULO 2: SEGUIMIENTO COLABORADORES (SEMÁFORO)
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

    // 2. OBTENER DATOS (Usuarios y sus Documentos SST)
    const usersMap = _getUsersMap();
    const activeUsers = Array.from(usersMap.values()).filter(u => u.status === 'active');

    // Preparar consulta de documentos SST para todos los usuarios activos
    // (Optimizacion: Consultamos la colección 'documents' de cada usuario es pesado, 
    // para MVP iteramos. Para producción masiva se recomienda una collectionGroup o campo en user)

    tableBody.innerHTML = '';

    // Renderizamos fila por fila
    for (const user of activeUsers) {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-blue-50 transition-colors group";
        tr.dataset.name = `${user.firstName} ${user.lastName} ${user.idNumber}`.toLowerCase();

        // Marcadores de carga inicial
        tr.innerHTML = `
            <td class="px-4 py-3 font-medium text-gray-900">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                        ${user.firstName[0]}${user.lastName[0]}
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

        // Listener para abrir detalle
        tr.querySelector('.btn-manage-sst').addEventListener('click', () => {
            loadSSTUserProfile(user.id, container);
        });

        tableBody.appendChild(tr);

        // 3. CARGA ASÍNCRONA DE ESTADOS (Lazy Load por fila)
        checkUserSSTStatus(user.id);
    }

    // Buscador Local
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
async function checkUserSSTStatus(userId) {
    try {
        // Consultar documentos de categoría SST
        const q = query(collection(_db, "users", userId, "documents"),
            where("category", "in", ["sst_alturas", "sst_medico", "sst_induccion"]));

        const snapshot = await getDocs(q);
        const docs = {};
        snapshot.forEach(d => docs[d.data().category] = d.data());

        // Helper para generar el badge HTML
        const getBadge = (category) => {
            const doc = docs[category];
            if (!doc) return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700"><i class="fa-solid fa-xmark"></i> Falta</span>`;

            // Verificar Vencimiento si aplica
            if (doc.expiresAt) {
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const expiration = doc.expiresAt.toDate(); // Firestore Timestamp
                const diffTime = expiration - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays < 0) return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700" title="Venció el ${expiration.toLocaleDateString()}"><i class="fa-solid fa-triangle-exclamation"></i> Vencido</span>`;
                if (diffDays <= 30) return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800" title="Vence en ${diffDays} días"><i class="fa-solid fa-clock"></i> Vence pronto</span>`;
            }

            return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700"><i class="fa-solid fa-check"></i> Al día</span>`;
        };

        // Actualizar celdas
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
    const user = usersMap.get(userId);

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

/**
 * Carga el contenido de la pestaña "Productividad" (TABLA ACTUALIZADA).
 * Corrección: Ahora muestra el ROL real del usuario en lugar de un texto fijo.
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
                    </tbody>
                </table>
            </div>
            <p class="text-xs text-gray-400 mt-2 text-right">* Días no reportados calcula días hábiles (Lun-Sáb) sin registro de ingreso.</p>
        </div>
    `;

    // 2. Referencias
    const monthSelector = document.getElementById('empleado-month-selector');
    const tableBody = document.getElementById('empleados-prod-table-body');

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
            if (dayOfWeek !== 0) { // Excluir Domingo
                count++;
            }
            curDate.setDate(curDate.getDate() + 1);
        }
        return count;
    };

    // Carga de datos
    const loadTableData = async () => {
        const selectedMonthYear = monthSelector.value;
        const [selYear, selMonth] = selectedMonthYear.split('-').map(Number);
        const currentStatDocId = selectedMonthYear.replace('-', '_');

        const startOfMonth = new Date(selYear, selMonth - 1, 1);
        const endOfMonth = new Date(selYear, selMonth, 0, 23, 59, 59);
        const businessDays = countBusinessDays(selYear, selMonth);

        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10"><div class="loader mx-auto"></div><p class="mt-2 text-gray-500">Calculando reporte...</p></td></tr>`;

        try {
            const usersMap = _getUsersMap();
            const activeUsers = [];
            usersMap.forEach((user, id) => {
                if (user.status === 'active') {
                    activeUsers.push({ id, ...user });
                }
            });

            if (activeUsers.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-500">No se encontraron operarios activos.</td></tr>`;
                return;
            }

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
                row.className = 'bg-white border-b hover:bg-gray-50 cursor-pointer';
                row.dataset.action = "view-empleado-details";
                row.dataset.id = data.id;

                const level = data.commissionLevel || 'principiante';
                const levelText = level.charAt(0).toUpperCase() + level.slice(1);

                // --- CORRECCIÓN AQUÍ: Usamos data.role ---
                const roleRaw = data.role || 'operario';
                // Capitalizar primera letra (ej: "admin" -> "Admin")
                const roleDisplay = roleRaw.charAt(0).toUpperCase() + roleRaw.slice(1);

                // Estilo visual de días no reportados
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
                tableBody.appendChild(row);
            });

        } catch (error) {
            console.error("Error al cargar reporte:", error);
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-red-500">Error: ${error.message}</td></tr>`;
        }
    };

    loadTableData();
}


/**
 * Carga el contenido de la pestaña "Nómina" (VERSIÓN SEGURA Y COMPLETA).
 */
async function loadNominaTab(container) {
    // 1. Renderizar el "Shell" (Estructura HTML)
    container.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-md">
            
            <div class="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
                <div class="w-full md:w-1/3">
                    <input type="text" id="nomina-search" class="block w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-blue-500 focus:border-blue-500 shadow-sm" placeholder="Buscar empleado...">
                </div>
                
                <button id="btn-export-nomina-excel" class="w-full md:w-auto bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center shadow transition-colors">
                    <i class="fa-solid fa-file-excel mr-2"></i> Exportar Sábana (Excel)
                </button>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left" id="nomina-table">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                        <tr>
                            <th class="px-6 py-3">Operario</th>
                            <th class="px-6 py-3 text-center">Nivel Comisión</th>
                            <th class="px-6 py-3 text-right">Salario Básico</th>
                            <th class="px-6 py-3 text-right text-lime-600">Bonificación M² (Mes)</th>
                            <th class="px-6 py-3 text-right text-red-600">Desc. Préstamos (Est.)</th>
                            <th class="px-6 py-3 text-right text-blue-700">Total a Pagar (Est.)</th>
                        </tr>
                    </thead>
                    <tbody id="empleados-nomina-table-body" class="divide-y divide-gray-100">
                        </tbody>
                    <tfoot id="empleados-nomina-table-foot" class="bg-gray-100 font-bold text-gray-800 border-t-2 border-gray-200">
                        <tr>
                            <td colspan="2" class="px-6 py-4 text-right uppercase text-xs tracking-wider">Totales del Mes:</td>
                            <td id="total-basico" class="px-6 py-4 text-right">---</td>
                            <td id="total-bonificacion" class="px-6 py-4 text-right text-lime-700">---</td>
                            <td id="total-deducciones" class="px-6 py-4 text-right text-red-700">---</td>
                            <td id="total-pagar" class="px-6 py-4 text-right text-blue-800 text-base">---</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <p class="text-xs text-gray-400 mt-2 text-right">* La deducción de préstamos es un estimado basado en (Saldo / Cuotas). El valor final se ajusta al registrar el pago.</p>
        </div>
    `;

    // 2. Obtener referencias a elementos del DOM
    const monthSelector = document.getElementById('empleado-month-selector');
    const tableBody = document.getElementById('empleados-nomina-table-body');
    const searchInput = document.getElementById('nomina-search');
    const exportBtn = document.getElementById('btn-export-nomina-excel');

    // Validación básica
    if (!monthSelector || !tableBody) return;

    const selectedMonthYear = monthSelector.value;
    const currentStatDocId = selectedMonthYear.replace('-', '_');

    // Loader inicial
    tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10"><div class="loader mx-auto"></div><p class="mt-2 text-gray-500">Cargando reporte para ${selectedMonthYear}...</p></td></tr>`;

    try {
        // 3. Obtener usuarios activos del sistema
        const usersMap = _getUsersMap();
        const activeUsers = [];
        usersMap.forEach((user, id) => {
            if (user.status === 'active') {
                activeUsers.push({ id, ...user });
            }
        });

        if (activeUsers.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-500">No se encontraron operarios activos.</td></tr>`;
            return;
        }

        // 4. Obtener TODOS los Préstamos Activos (Consulta Global Optimizada)
        const loansQuery = query(collectionGroup(_db, 'loans'), where('status', '==', 'active'));
        const loansSnapshot = await getDocs(loansQuery);

        // --- CHECK DE SEGURIDAD 1: Si el usuario cambió de pestaña, detenemos aquí ---
        if (!document.getElementById('total-basico')) return;
        // ---------------------------------------------------------------------------

        // Mapear préstamos por usuario
        const userLoansMap = new Map(); // userId -> { totalBalance, estimatedDeduction }

        loansSnapshot.forEach(doc => {
            const loan = doc.data();
            const userId = doc.ref.parent.parent.id; // El "abuelo" es el usuario

            if (!userLoansMap.has(userId)) {
                userLoansMap.set(userId, { totalBalance: 0, estimatedDeduction: 0 });
            }

            const userData = userLoansMap.get(userId);
            userData.totalBalance += (loan.balance || 0);

            // Cálculo de cuota sugerida: Si hay cuotas, dividimos. Si no, sugerimos todo o 1 cuota.
            const installments = loan.installments && loan.installments > 0 ? loan.installments : 1;
            const deduction = (loan.balance || 0) / installments;

            userData.estimatedDeduction += deduction;
        });

        // 5. Obtener estadísticas de productividad del mes seleccionado
        const statPromises = activeUsers.map(op => getDoc(doc(_db, "employeeStats", op.id, "monthlyStats", currentStatDocId)));
        const statSnapshots = await Promise.all(statPromises);

        // --- CHECK DE SEGURIDAD 2 ---
        if (!document.getElementById('total-basico')) return;
        // -----------------------------

        // Acumuladores globales
        let sumBasico = 0;
        let sumBonificacion = 0;
        let sumDeducciones = 0;
        let sumTotal = 0;

        // 6. Procesar datos combinados
        const empleadoData = activeUsers.map((operario, index) => {
            const statDoc = statSnapshots[index];
            const stats = statDoc.exists() ? statDoc.data() : { totalBonificacion: 0 };
            const loanInfo = userLoansMap.get(operario.id) || { totalBalance: 0, estimatedDeduction: 0 };

            const basico = parseFloat(operario.salarioBasico) || 0;
            const bono = stats.totalBonificacion || 0;

            // La deducción estimada no puede ser mayor a lo que debe
            const deduction = Math.min(loanInfo.estimatedDeduction, loanInfo.totalBalance);

            // Neto Estimado
            const total = basico + bono - deduction;

            sumBasico += basico;
            sumBonificacion += bono;
            sumDeducciones += deduction;
            sumTotal += total;

            return {
                id: operario.id,
                fullName: `${operario.firstName} ${operario.lastName}`,
                cedula: operario.idNumber || 'N/A',
                bankName: operario.bankName || 'N/A',
                accountType: operario.accountType || 'N/A',
                accountNumber: operario.accountNumber || 'N/A',
                commissionLevel: operario.commissionLevel || 'principiante',
                salarioBasico: basico,
                bonificacion: bono,
                deduccionPrestamos: deduction,
                deudaTotal: loanInfo.totalBalance,
                totalPagar: total
            };
        });

        // Ordenar por total a pagar (mayor a menor)
        empleadoData.sort((a, b) => b.totalPagar - a.totalPagar);

        // 7. Función de Renderizado
        const renderTable = (dataToRender) => {
            // Referencia fresca al cuerpo de la tabla
            const tBodyRef = document.getElementById('empleados-nomina-table-body');
            if (!tBodyRef) return; // Seguridad extra

            tBodyRef.innerHTML = '';
            if (dataToRender.length === 0) {
                tBodyRef.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-500">No se encontraron resultados.</td></tr>`;
                return;
            }

            dataToRender.forEach(data => {
                const row = document.createElement('tr');
                row.className = 'bg-white hover:bg-blue-50 cursor-pointer transition-colors searchable-row';
                row.dataset.action = "view-payment-history";
                row.dataset.id = data.id;

                const levelText = data.commissionLevel.charAt(0).toUpperCase() + data.commissionLevel.slice(1);

                // Estilo rojo si hay deducción
                const dedHtml = data.deduccionPrestamos > 0
                    ? `<span class="text-red-600 font-semibold">- ${currencyFormatter.format(data.deduccionPrestamos)}</span>`
                    : `<span class="text-gray-400">-</span>`;

                row.innerHTML = `
                    <td class="px-6 py-4 font-medium text-gray-900">
                        ${data.fullName}
                        ${data.deudaTotal > 0 ? `<div class="text-xs text-red-400">Deuda Total: ${currencyFormatter.format(data.deudaTotal)}</div>` : ''}
                    </td>
                    <td class="px-6 py-4 text-center text-xs uppercase text-gray-500 font-semibold">${levelText}</td>
                    <td class="px-6 py-4 text-right font-medium text-gray-600">${currencyFormatter.format(data.salarioBasico)}</td>
                    <td class="px-6 py-4 text-right font-bold text-lime-600">${currencyFormatter.format(data.bonificacion)}</td>
                    <td class="px-6 py-4 text-right">${dedHtml}</td>
                    <td class="px-6 py-4 text-right font-bold text-blue-700">${currencyFormatter.format(data.totalPagar)}</td>
                `;
                tBodyRef.appendChild(row);
            });
        };

        // Render inicial
        renderTable(empleadoData);

        // 8. Actualizar Footer con Totales (CON VALIDACIÓN DE EXISTENCIA)
        const footerBasico = document.getElementById('total-basico');
        if (footerBasico) {
            footerBasico.textContent = currencyFormatter.format(sumBasico);
            document.getElementById('total-bonificacion').textContent = currencyFormatter.format(sumBonificacion);
            document.getElementById('total-deducciones').textContent = "- " + currencyFormatter.format(sumDeducciones);
            document.getElementById('total-pagar').textContent = currencyFormatter.format(sumTotal);
        }

        // 9. Configurar Buscador
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filteredData = empleadoData.filter(emp =>
                emp.fullName.toLowerCase().includes(term) ||
                emp.cedula.includes(term)
            );
            renderTable(filteredData);
        });

        // 10. Configurar Exportación Excel
        exportBtn.addEventListener('click', () => {
            try {
                const exportData = empleadoData.map(emp => ({
                    "Cédula": emp.cedula,
                    "Nombre Completo": emp.fullName,
                    "Banco": emp.bankName,
                    "Cuenta": emp.accountNumber,
                    "Nivel": emp.commissionLevel,
                    "Salario Básico": emp.salarioBasico,
                    "Bonificación Mes": emp.bonificacion,
                    "Deducción Préstamos (Est.)": emp.deduccionPrestamos,
                    "Deuda Total Restante": emp.deudaTotal - emp.deduccionPrestamos,
                    "Total a Pagar (Est.)": emp.totalPagar,
                    "Mes": selectedMonthYear
                }));

                // Fila de Totales para Excel
                exportData.push({
                    "Cédula": "", "Nombre Completo": "TOTALES", "Banco": "", "Cuenta": "", "Nivel": "",
                    "Salario Básico": sumBasico,
                    "Bonificación Mes": sumBonificacion,
                    "Deducción Préstamos (Est.)": sumDeducciones,
                    "Deuda Total Restante": "",
                    "Total a Pagar (Est.)": sumTotal,
                    "Mes": ""
                });

                const ws = XLSX.utils.json_to_sheet(exportData);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Nomina " + selectedMonthYear);

                // Ajustar anchos de columna
                const wscols = [{ wch: 15 }, { wch: 30 }, { wch: 20 }, { wch: 20 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }];
                ws['!cols'] = wscols;

                XLSX.writeFile(wb, `Sabana_Nomina_${selectedMonthYear}.xlsx`);

            } catch (error) {
                console.error("Error al exportar Excel:", error);
                alert("No se pudo generar el archivo Excel.");
            }
        });

    } catch (error) {
        console.error("Error al cargar el reporte de nómina:", error);
        // Si el error ocurre, intentamos mostrarlo en la tabla si aún existe
        const tb = document.getElementById('empleados-nomina-table-body');
        if (tb) tb.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-red-500">Error: ${error.message}</td></tr>`;
    }
}

/**
 * Muestra la vista de detalle de un empleado específico.
 * VERSIÓN SEGURA: No se rompe si faltan elementos en el HTML.
 */
export async function showEmpleadoDetails(userId) {
    _showView('empleado-details');

    if (typeof destroyActiveChart === 'function') {
        destroyActiveChart();
    }

    const usersMap = _getUsersMap();
    const user = usersMap.get(userId);

    // Helper para evitar el error "Cannot set properties of null"
    const safeSetText = (id, text) => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = text;
        } else {
            console.warn(`Elemento faltante en HTML: ${id}`); // Aviso en consola para depurar
        }
    };

    if (!user) {
        safeSetText('empleado-details-name', 'Error: Usuario no encontrado');
        return;
    }

    // --- 1. RENDERIZAR ENCABEZADO ---
    const level = user.commissionLevel || 'principiante';
    const levelText = level.charAt(0).toUpperCase() + level.slice(1);

    // Nombre y ID
    safeSetText('empleado-details-name', `${user.firstName} ${user.lastName}`);
    const nameEl = document.getElementById('empleado-details-name');
    if (nameEl) nameEl.dataset.userId = userId;

    // Botón Logs (Solo se agrega si existe el nombre)
    if (nameEl) {
        const headerContainer = nameEl.parentElement;
        let btnAudit = headerContainer.querySelector('.btn-audit-log');
        if (!btnAudit) {
            btnAudit = document.createElement('button');
            btnAudit.className = "btn-audit-log ml-3 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded border border-gray-300 transition-colors align-middle";
            btnAudit.innerHTML = '<i class="fa-solid fa-clock-rotate-left mr-1"></i> Logs';
            nameEl.insertAdjacentElement('afterend', btnAudit);
            btnAudit.onclick = () => {
                if (typeof window.openMainModal === 'function') window.openMainModal('view-audit-logs', { userId: userId });
            };
        }
    }

    // Datos Personales
    safeSetText('empleado-details-level', `Nivel: ${levelText}`);
    safeSetText('empleado-details-idNumber', user.idNumber || 'N/A');
    safeSetText('empleado-details-email', user.email || 'N/A');
    safeSetText('empleado-details-phone', user.phone || 'N/A');
    safeSetText('empleado-details-address', user.address || 'N/A');

    // Datos Bancarios (Estos son los que probablemente causaban el error)
    safeSetText('empleado-details-bank', user.bankName || 'No registrado');
    safeSetText('empleado-details-account-type', user.accountType || 'N/A');
    safeSetText('empleado-details-account-number', user.accountNumber || '---');

    // --- 2. CONFIGURACIÓN DE PESTAÑAS ---
    const tabsNav = document.getElementById('empleado-details-tabs-nav');
    if (tabsNav) {
        const newTabsNav = tabsNav.cloneNode(false);
        tabsNav.parentNode.replaceChild(newTabsNav, tabsNav);

        newTabsNav.innerHTML = `
            <button data-tab="resumen" class="empleado-details-tab-button active whitespace-nowrap py-4 px-4 border-b-2 font-medium text-sm text-blue-600 border-blue-500 hover:text-blue-800 transition-colors">
                <i class="fa-solid fa-chart-pie mr-2"></i> Resumen
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

    // --- 3. CONFIGURAR BOTONES DE RANGO ---
    // Usamos un timeout pequeño para asegurar que el DOM se actualizó si acabamos de crear la pestaña
    setTimeout(() => {
        const rangeContainer = document.querySelector('#empleado-tab-asistencia .flex.gap-2');
        if (rangeContainer) {
            const newRangeContainer = rangeContainer.cloneNode(true);
            rangeContainer.parentNode.replaceChild(newRangeContainer, rangeContainer);

            newRangeContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('.range-btn');
                if (!btn) return;

                newRangeContainer.querySelectorAll('.range-btn').forEach(b => {
                    b.classList.remove('bg-blue-100', 'text-blue-700', 'border-blue-200');
                    b.classList.add('bg-gray-100', 'text-gray-600', 'border-gray-200');
                });

                btn.classList.remove('bg-gray-100', 'text-gray-600', 'border-gray-200');
                btn.classList.add('bg-blue-100', 'text-blue-700', 'border-blue-200');

                const days = parseInt(btn.dataset.range);
                loadAttendanceTab(userId, days);
            });
        }
    }, 500);

    // --- 4. CARGA INICIAL ---
    switchEmpleadoDetailsTab('resumen', userId);
}


/**
 * Cambia el contenido visible en el detalle del empleado.
 * Crea dinámicamente los contenedores de las pestañas si no existen.
 */
function switchEmpleadoDetailsTab(tabName, userId) {
    // 1. Ocultar todos los contenidos
    document.querySelectorAll('.empleado-details-tab-content').forEach(content => {
        content.classList.add('hidden');
    });

    // 2. Buscar o Crear Contenedor
    let activeContent = document.getElementById(`empleado-tab-${tabName}`);

    // Si no existe el div de la pestaña, lo creamos dinámicamente
    if (!activeContent) {
        const parentContainer = document.getElementById('empleado-details-content-container') ||
            document.getElementById('empleado-details');
        if (parentContainer) {
            activeContent = document.createElement('div');
            activeContent.id = `empleado-tab-${tabName}`;
            activeContent.className = 'empleado-details-tab-content mt-6 space-y-6';
            parentContainer.appendChild(activeContent);
        }
    }

    // 3. Mostrar el contenedor
    if (activeContent) activeContent.classList.remove('hidden');

    // 4. Lógica por pestaña
    switch (tabName) {
        case 'resumen':
            // --- CORRECCIÓN: Verificamos si falta la NUEVA sección específica ---
            // Si no encuentra el ID 'resumen-asistencia-kpi', sobrescribe todo el HTML
            // para asegurar que tengamos la estructura completa (Gráfica + Reporte).
            if (!activeContent.querySelector('#resumen-asistencia-kpi')) {
                activeContent.innerHTML = `
                    <div class="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                        <h4 class="text-sm font-bold text-gray-500 uppercase mb-4">Productividad (Últimos 6 Meses)</h4>
                        <div class="relative h-64">
                            <canvas id="empleado-productivity-chart"></canvas>
                        </div>
                    </div>

                    <div class="bg-white p-6 rounded-lg shadow-md border border-gray-200 mt-6">
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
                                    <tr>
                                        <th class="px-4 py-2">Fecha</th>
                                        <th class="px-4 py-2">Hora Llegada</th>
                                        <th class="px-4 py-2 text-center">Evidencia</th>
                                        <th class="px-4 py-2 text-center">Ubicación</th>
                                    </tr>
                                </thead>
                                <tbody id="resumen-asistencia-tbody" class="divide-y divide-gray-50">
                                    </tbody>
                            </table>
                        </div>
                        
                        <div class="mt-3 text-right">
                            <button class="text-xs text-blue-600 hover:text-blue-800 font-bold hover:underline transition-colors" 
                                onclick="document.querySelector('[data-tab=asistencia]').click()">
                                Ver historial completo →
                            </button>
                        </div>
                    </div>
                `;
            }

            // Cargar los datos (Ahora sí encontrará los contenedores)
            loadEmpleadoResumenTab(userId);
            break;

        case 'asistencia':
            // Inyectamos la estructura de la pestaña completa de asistencia
            if (!activeContent.innerHTML.trim()) {
                activeContent.innerHTML = `
                    <div class="flex justify-between items-center bg-white p-4 rounded-lg shadow border border-gray-200 mb-6">
                        <h3 class="text-lg font-bold text-gray-800">Historial de Asistencia</h3>
                        <div class="flex gap-2">
                            <button data-range="7" class="range-btn bg-blue-100 text-blue-700 px-3 py-1 rounded-md text-sm font-bold border border-blue-200">7 Días</button>
                            <button data-range="15" class="range-btn bg-gray-100 text-gray-600 px-3 py-1 rounded-md text-sm font-bold border border-gray-200">15 Días</button>
                            <button data-range="30" class="range-btn bg-gray-100 text-gray-600 px-3 py-1 rounded-md text-sm font-bold border border-gray-200">30 Días</button>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                        <div class="bg-white p-4 rounded-lg shadow border border-gray-200">
                            <h4 class="text-sm font-bold text-gray-500 uppercase mb-4">Tendencia</h4>
                            <div class="relative h-64"><canvas id="attendance-chart"></canvas></div>
                        </div>
                        <div class="bg-white p-4 rounded-lg shadow border border-gray-200 flex flex-col">
                            <h4 class="text-sm font-bold text-gray-500 uppercase mb-4">Mapa</h4>
                            <div id="attendance-map" class="flex-grow w-full h-64 rounded-lg border border-gray-300 z-0"></div>
                        </div>
                    </div>
                    <div class="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                        <div class="px-6 py-4 border-b border-gray-100 bg-gray-50"><h4 class="text-sm font-bold text-gray-700">Bitácora</h4></div>
                        <div class="overflow-x-auto max-h-80">
                            <table class="w-full text-sm text-left">
                                <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10">
                                    <tr><th class="px-6 py-3">Fecha</th><th class="px-6 py-3">Hora</th><th class="px-6 py-3 text-center">Evidencia</th><th class="px-6 py-3 text-center">Mapa</th><th class="px-6 py-3">Disp.</th></tr>
                                </thead>
                                <tbody id="attendance-list-body" class="divide-y divide-gray-100"></tbody>
                            </table>
                        </div>
                    </div>
                `;
            }
            loadAttendanceTab(userId, 7);
            setTimeout(() => { if (attendanceMapInstance) attendanceMapInstance.invalidateSize(); }, 200);
            break;

        case 'documentos':
            loadEmpleadoDocumentosTab(userId, activeContent);
            break;

        case 'dotacion':
            if (typeof window.loadDotacionAsignaciones === 'function') {
                window.loadDotacionAsignaciones(userId, `empleado-tab-dotacion`);
            } else {
                console.error("Función de dotación no encontrada.");
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
 * Abre el modal de Comprobante de Nómina (Versión Profesional con Ajuste Salarial).
 * @param {object} payment - Objeto con los datos del pago.
 * @param {object} user - Objeto completo del usuario.
 */
function openPaymentVoucherModal(payment, user) {
    const modal = document.getElementById('payment-voucher-modal');
    const earningsList = document.getElementById('voucher-earnings-list');
    const deductionsList = document.getElementById('voucher-deductions-list');

    if (!modal) return;

    // 1. Llenar datos básicos
    const dateStr = payment.createdAt ? payment.createdAt.toDate().toLocaleDateString('es-CO') : payment.paymentDate;
    document.getElementById('voucher-date').textContent = `Fecha de Pago: ${dateStr}`;

    // Nombre y Cédula
    document.getElementById('voucher-employee-name').textContent = `${user.firstName} ${user.lastName}`;
    document.getElementById('voucher-employee-id').textContent = user.idNumber || 'N/A';

    document.getElementById('voucher-concept').textContent = payment.concepto;
    document.getElementById('voucher-total').textContent = currencyFormatter.format(payment.monto);

    // 2. Limpiar listas
    earningsList.innerHTML = '';
    deductionsList.innerHTML = '';
    earningsList.classList.remove('space-y-2');
    deductionsList.classList.remove('space-y-2');

    // 3. Helper de filas
    const createItemRow = (label, value, isBold = false) => {
        return `
            <li class="flex justify-between items-center py-3 border-b border-gray-100 last:border-0 ${isBold ? 'font-bold text-gray-800 text-base' : 'text-gray-600'}">
                <span>${label}</span>
                <span>${currencyFormatter.format(value)}</span>
            </li>`;
    };

    // 4. Desglosar datos
    const d = payment.desglose || {};
    const horas = payment.horas || {};

    // --- INICIO DE LA LÓGICA DE VISUALIZACIÓN (Salario Mínimo vs Real) ---
    let displaySalario = d.salarioProrrateado;
    let displayBonificacion = d.bonificacionM2 || 0;

    // Si el pago se calculó sobre la base del mínimo (deduccionSobreMinimo = true)
    if (d.deduccionSobreMinimo && d.baseDeduccion > 0) {
        // En este modo, 'baseDeduccion' guarda exactamente el Salario Mínimo * Días Trabajados.
        const salarioMinimoProrrateado = d.baseDeduccion;

        // Solo aplicamos el cambio si el salario real es mayor al mínimo (para no afectar a quienes ganan menos)
        if (displaySalario > salarioMinimoProrrateado) {
            const excedente = displaySalario - salarioMinimoProrrateado;

            // 1. El salario básico visual pasa a ser el mínimo
            displaySalario = salarioMinimoProrrateado;

            // 2. El excedente se suma a la bonificación existente
            displayBonificacion += excedente;
        }
    }
    // --- FIN DE LA LÓGICA ---

    // --- INGRESOS ---
    if (displaySalario > 0) {
        earningsList.innerHTML += createItemRow(`Salario Básico (${payment.diasPagados} días)`, displaySalario);
    }

    if (d.auxilioTransporteProrrateado > 0) {
        earningsList.innerHTML += createItemRow(`Aux. Transporte`, d.auxilioTransporteProrrateado);
    }

    if (d.horasExtra > 0) {
        earningsList.innerHTML += createItemRow(`Horas Extra (${horas.totalHorasExtra || 0}h)`, d.horasExtra);
    }

    if (displayBonificacion > 0) {
        // Cambiamos la etiqueta para que refleje que incluye auxilios/bonos
        earningsList.innerHTML += createItemRow(`Bonificación / Aux. No Salarial`, displayBonificacion, true);
    }

    if (d.otros > 0) {
        earningsList.innerHTML += createItemRow(`Otros Pagos`, d.otros);
    }

    // --- DEDUCCIONES ---
    if (d.deduccionSalud < 0) {
        deductionsList.innerHTML += createItemRow(`Aporte Salud (4%)`, Math.abs(d.deduccionSalud));
    }

    if (d.deduccionPension < 0) {
        deductionsList.innerHTML += createItemRow(`Aporte Pensión (4%)`, Math.abs(d.deduccionPension));
    }

    if (d.abonoPrestamos > 0) {
        deductionsList.innerHTML += createItemRow(`Abono a Préstamos/Adelantos`, d.abonoPrestamos, true); // true para negrita
    }

    if (d.otros < 0) {
        deductionsList.innerHTML += createItemRow(`Otros Descuentos`, Math.abs(d.otros));
    }

    if (deductionsList.innerHTML === '') {
        deductionsList.innerHTML = '<li class="py-3 text-gray-400 italic text-center text-xs">No hay deducciones registradas</li>';
    }

    // 5. Mostrar Modal
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    const closeModal = () => { modal.style.display = 'none'; };
    document.getElementById('voucher-close-btn').onclick = closeModal;
    document.getElementById('voucher-close-footer-btn').onclick = closeModal;
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
 * Abre el modal de creación de préstamo.
 */
function openLoanModal(userId) {
    const modal = document.getElementById('loan-modal');
    const form = document.getElementById('loan-form');
    if (!modal || !form) return;

    form.reset();
    // Formato de moneda para el input
    const amountInput = form.querySelector('input[name="amount"]');
    _setupCurrencyInput(amountInput);

    // Fecha hoy
    form.querySelector('input[name="date"]').value = new Date().toISOString().split('T')[0];

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // Manejo del submit (una sola vez)
    form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Guardando...';

        try {
            const amount = parseFloat(amountInput.value.replace(/[$. ]/g, '')) || 0;
            const description = form.querySelector('textarea[name="description"]').value;
            const installments = parseInt(form.querySelector('input[name="installments"]').value) || 1;
            const date = form.querySelector('input[name="date"]').value;

            if (amount <= 0) throw new Error("El monto debe ser mayor a 0");

            // Guardar en subcolección 'loans'
            await addDoc(collection(_db, "users", userId, "loans"), {
                amount: amount,
                balance: amount, // Al inicio, el saldo es igual al monto
                description: description,
                installments: installments,
                date: date,
                status: 'active', // active | paid
                createdAt: serverTimestamp()
            });

            alert("Préstamo registrado exitosamente.");
            modal.style.display = 'none';
            // Recargar vista para actualizar deuda
            loadPaymentHistoryView(userId);

        } catch (error) {
            console.error(error);
            alert("Error al guardar: " + error.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Guardar Préstamo';
        }
    };

    document.getElementById('loan-modal-cancel').onclick = () => {
        modal.style.display = 'none';
    };
}

/**
 * (FUNCIÓN MAESTRA) Carga el historial, datos bancarios, navegación y GESTIÓN DE PRÉSTAMOS.
 */
export async function loadPaymentHistoryView(userId) {
    _showView('payment-history-view');

    // Limpiar listener anterior
    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    // --- 1. REFERENCIAS DOM ---
    const nameEl = document.getElementById('payment-history-name');
    const tableBody = document.getElementById('payment-history-table-body');

    // Bancarios
    const bankInfoContainer = document.getElementById('payment-header-bank-info');
    const bankNameEl = document.getElementById('ph-bank-name');
    const accountTypeEl = document.getElementById('ph-account-type');
    const accountNumberEl = document.getElementById('ph-account-number');

    // Navegación
    const btnPrev = document.getElementById('btn-prev-employee');
    const btnNext = document.getElementById('btn-next-employee');

    // Formulario
    const form = document.getElementById('payment-register-form');
    const salarioEl = document.getElementById('payment-salario-basico');
    const bonificacionEl = document.getElementById('payment-bonificacion-mes');
    const liquidarCheckbox = document.getElementById('payment-liquidar-bonificacion');
    const diasPagarInput = document.getElementById('payment-dias-pagar');

    // Préstamos (Elementos nuevos)
    const debtEl = document.getElementById('payment-total-debt');
    // Nota: El contenedor de la lista se genera dinámicamente abajo, 
    // asegurándonos de reemplazar el fieldset estático si aún existe.

    // Estado de carga inicial
    nameEl.textContent = 'Cargando datos...';
    tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-500"><div class="loader mx-auto"></div></td></tr>`;
    bankInfoContainer.classList.add('hidden');

    let user = null;

    try {
        // --- 2. DATOS FRESCOS ---
        const userRef = doc(_db, "users", userId);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            user = { id: userSnap.id, ...userSnap.data() };
            _getUsersMap().set(userId, user);
        } else {
            throw new Error("Usuario no encontrado.");
        }

        // --- 3. UI ENCABEZADO Y BANCO ---
        nameEl.textContent = `${user.firstName} ${user.lastName}`;

        if (user.bankName && user.accountNumber) {
            bankNameEl.textContent = user.bankName;
            accountTypeEl.textContent = user.accountType || 'Cuenta';
            accountNumberEl.textContent = user.accountNumber;
            bankInfoContainer.classList.remove('hidden');

            const accountContainer = accountNumberEl.parentElement;
            const newAccountContainer = accountContainer.cloneNode(true);
            accountContainer.parentNode.replaceChild(newAccountContainer, accountContainer);

            newAccountContainer.onclick = () => {
                navigator.clipboard.writeText(user.accountNumber).then(() => {
                    const icon = newAccountContainer.querySelector('i');
                    const originalClass = "fa-regular fa-copy ml-2 text-gray-400 group-hover:text-gray-600";
                    icon.className = "fa-solid fa-check ml-2 text-green-600 scale-125 transition-transform";
                    setTimeout(() => { icon.className = originalClass; }, 1500);
                }).catch(console.error);
            };
        } else {
            bankInfoContainer.classList.add('hidden');
        }

        // --- 4. NAVEGACIÓN ---
        const usersMap = _getUsersMap();
        const activeUsers = Array.from(usersMap.values())
            .filter(u => u.status === 'active')
            .sort((a, b) => a.firstName.localeCompare(b.firstName));

        let currentIndex = -1;
        if (activeUsers.length > 0) currentIndex = activeUsers.findIndex(u => u.id === userId);

        if (btnPrev) {
            const newBtnPrev = btnPrev.cloneNode(true);
            btnPrev.parentNode.replaceChild(newBtnPrev, btnPrev);
            if (currentIndex > 0) {
                const prevUser = activeUsers[currentIndex - 1];
                newBtnPrev.disabled = false;
                newBtnPrev.title = `Ir a: ${prevUser.firstName} ${prevUser.lastName}`;
                newBtnPrev.onclick = () => loadPaymentHistoryView(prevUser.id);
            } else { newBtnPrev.disabled = true; }
        }

        if (btnNext) {
            const newBtnNext = btnNext.cloneNode(true);
            btnNext.parentNode.replaceChild(newBtnNext, btnNext);
            if (currentIndex !== -1 && currentIndex < activeUsers.length - 1) {
                const nextUser = activeUsers[currentIndex + 1];
                newBtnNext.disabled = false;
                newBtnNext.title = `Ir a: ${nextUser.firstName} ${nextUser.lastName}`;
                newBtnNext.onclick = () => loadPaymentHistoryView(nextUser.id);
            } else { newBtnNext.disabled = true; }
        }

        // --- 5. GESTIÓN DE PRÉSTAMOS (DISEÑO COMPACTO SIN DESCRIPCIÓN) ---

        // 1. Búsqueda robusta del contenedor
        let loanFieldset = document.getElementById('loan-management-fieldset');
        if (!loanFieldset) {
            loanFieldset = form.querySelector('fieldset.bg-indigo-50');
            if (!loanFieldset) {
                const legends = form.querySelectorAll('legend');
                for (const legend of legends) {
                    if (legend.textContent.includes('Deducción') || legend.textContent.includes('Préstamos')) {
                        loanFieldset = legend.parentElement;
                        break;
                    }
                }
            }
        }

        if (loanFieldset) {
            loanFieldset.id = 'loan-management-fieldset';
            // Contenedor blanco limpio con borde suave
            loanFieldset.className = "mt-6 border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden";
            loanFieldset.style = "";

            loanFieldset.innerHTML = `
                <div class="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                    <h4 class="text-sm font-bold text-gray-700 flex items-center">
                        <i class="fa-solid fa-hand-holding-dollar mr-2 text-gray-500"></i>
                        Préstamos Activos
                    </h4>
                    <div class="text-right">
                         <span class="text-[10px] uppercase text-gray-400 font-bold tracking-wider block">Total Deuda</span>
                         <span id="payment-total-debt" class="text-sm font-bold text-red-600">$ 0</span>
                    </div>
                </div>

                <div id="active-loans-list" class="max-h-60 overflow-y-auto custom-scrollbar divide-y divide-gray-100">
                    <div class="text-center py-8">
                        <div class="loader-small mx-auto mb-2"></div>
                        <p class="text-xs text-gray-400">Cargando...</p>
                    </div>
                </div>

                <div class="bg-indigo-50 px-4 py-3 flex justify-between items-center border-t border-indigo-100">
                    <span class="text-xs font-bold text-indigo-900 uppercase">A Descontar:</span>
                    <span id="payment-total-loan-deduction-display" class="text-lg font-bold text-indigo-700">$ 0</span>
                </div>
            `;

            // 2. Consultar y Renderizar Préstamos
            const activeLoansList = document.getElementById('active-loans-list');
            const totalDebtElDisplay = document.getElementById('payment-total-debt');

            const loansQuery = query(collection(_db, "users", userId, "loans"), where("status", "==", "active"), orderBy("date", "asc"));
            const loansSnap = await getDocs(loansQuery);

            let totalActiveDebt = 0;
            activeLoansList.innerHTML = '';

            if (loansSnap.empty) {
                activeLoansList.innerHTML = `
                    <div class="py-6 text-center">
                        <p class="text-sm text-gray-500">No hay préstamos activos.</p>
                    </div>`;
            } else {
                loansSnap.forEach(doc => {
                    const loan = { id: doc.id, ...doc.data() };
                    totalActiveDebt += (loan.balance || 0);

                    // Formato de fecha legible (ej: 15 de Noviembre)
                    const dateStr = new Date(loan.date).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });

                    const row = document.createElement('div');
                    // Fila limpia: Flexbox simple
                    row.className = "px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors";

                    // --- HTML SIMPLIFICADO (SIN DESCRIPCIÓN) ---
                    row.innerHTML = `
                        <div class="flex flex-col justify-center">
                            <span class="text-sm font-bold text-gray-700 capitalize">
                                ${dateStr} 
                                ${loan.installments > 1 ? '<span class="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200 align-middle">Cuotas</span>' : ''}
                            </span>
                            <span class="text-xs text-gray-500 mt-0.5">
                                Saldo: <span class="text-red-500 font-semibold">${currencyFormatter.format(loan.balance)}</span>
                            </span>
                        </div>

                        <div class="relative w-32">
                            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <span class="text-gray-400 text-sm font-bold">$</span>
                            </div>
                            <input type="text" 
                                class="loan-deduction-input block w-full pl-6 pr-3 py-1.5 text-right border-gray-300 rounded-md text-sm font-bold text-gray-900 focus:ring-indigo-500 focus:border-indigo-500 placeholder-gray-300 shadow-sm" 
                                placeholder="0"
                                data-loan-id="${loan.id}"
                                data-balance="${loan.balance}">
                        </div>
                    `;
                    activeLoansList.appendChild(row);
                });
            }

            totalDebtElDisplay.textContent = currencyFormatter.format(totalActiveDebt);

            // Activar eventos
            activeLoansList.querySelectorAll('.loan-deduction-input').forEach(input => {
                _setupCurrencyInput(input);
                input.addEventListener('focus', function () { this.select(); });
                input.addEventListener('input', () => updatePaymentTotal());
            });
        }

    } catch (e) {
        console.error("Error al cargar datos:", e);
        nameEl.textContent = 'Error';
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-red-500">${e.message}</td></tr>`;
        return;
    }

    // --- 6. CONFIGURAR FORMULARIO ---
    const config = _getPayrollConfig();
    const salario = parseFloat(user.salarioBasico) || 0;
    let auxTransporte = 0;

    if (config && config.salarioMinimo && salario > 0) {
        const limiteSMLV = (config.salarioMinimo) * (config.limiteAuxilioTransporte || 2);
        if (salario <= limiteSMLV) auxTransporte = config.auxilioTransporte || 0;
    }

    salarioEl.textContent = currencyFormatter.format(salario) + " (Mensual)";
    salarioEl.dataset.value = salario;
    salarioEl.dataset.auxTransporte = auxTransporte;

    form.dataset.deduccionSobreMinimo = user.deduccionSobreMinimo || false;

    // Bonificación
    const today = new Date();
    const currentStatDocId = `${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}`;
    const statRef = doc(_db, "employeeStats", userId, "monthlyStats", currentStatDocId);
    const statSnap = await getDoc(statRef);

    let bonificacion = 0;
    let pagada = false;
    if (statSnap.exists()) {
        bonificacion = statSnap.data().totalBonificacion || 0;
        pagada = statSnap.data().bonificacionPagada || false;
    }

    bonificacionEl.dataset.value = bonificacion;
    if (pagada) {
        bonificacionEl.textContent = currencyFormatter.format(bonificacion) + " (Ya liquidada)";
        bonificacionEl.classList.replace('text-lime-600', 'text-gray-400');
        liquidarCheckbox.checked = true; liquidarCheckbox.disabled = true;
    } else {
        bonificacionEl.textContent = currencyFormatter.format(bonificacion) + " (Pendiente)";
        bonificacionEl.classList.replace('text-gray-400', 'text-lime-600');
        liquidarCheckbox.checked = false; liquidarCheckbox.disabled = false;
    }

    if (!diasPagarInput.value) diasPagarInput.value = 15;
    // Llamamos al recálculo inicial
    if (typeof updatePaymentTotal === 'function') updatePaymentTotal();

    // --- 7. TABLA HISTORIAL (Snapshot) ---
    const q = query(collection(_db, "users", userId, "paymentHistory"), orderBy("createdAt", "desc"));
    unsubscribeEmpleadosTab = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-500">No hay pagos.</td></tr>`;
            return;
        }
        tableBody.innerHTML = '';
        snapshot.forEach(docSnap => {
            const payment = docSnap.data();
            const row = document.createElement('tr');
            row.className = 'bg-white border-b hover:bg-gray-50 transition-colors';
            const date = payment.createdAt ? payment.createdAt.toDate().toLocaleDateString('es-CO') : payment.paymentDate;

            row.innerHTML = `
                <td class="px-6 py-4 font-medium text-gray-900">${date}</td>
                <td class="px-6 py-4">${payment.concepto}</td>
                <td class="px-6 py-4 text-right font-medium text-gray-900">${currencyFormatter.format(payment.monto)}</td>
                <td class="px-6 py-4 text-center">
                    <div class="flex justify-center items-center gap-2">
                        <button class="view-voucher-btn bg-blue-100 hover:bg-blue-200 text-blue-700 p-2 rounded-full transition-colors" title="Ver Comprobante">
                            <i class="fa-solid fa-file-invoice-dollar"></i>
                        </button>
                        <button data-action="delete-payment" data-user-id="${userId}" data-doc-id="${docSnap.id}" class="bg-red-100 hover:bg-red-200 text-red-600 p-2 rounded-full transition-colors" title="Eliminar">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </td>
            `;

            const viewBtn = row.querySelector('.view-voucher-btn');
            if (viewBtn) {
                // Aseguramos que openPaymentVoucherModal esté disponible
                viewBtn.addEventListener('click', () => {
                    // Suponiendo que esta función existe en el mismo archivo o es global
                    // Si es interna, la llamamos directo.
                    openPaymentVoucherModal(payment, user);
                });
            }
            tableBody.appendChild(row);
        });
    });

    // --- 8. LISTENERS DEL FORMULARIO ---
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);

    newForm.addEventListener('submit', (e) => handleRegisterPayment(e, userId));

    newForm.querySelectorAll('.payment-horas-input, .currency-input, .payment-dias-input, #payment-liquidar-bonificacion').forEach(input => {
        input.addEventListener('input', () => {
            if (typeof updatePaymentTotal === 'function') updatePaymentTotal();
        });
    });

    newForm.querySelectorAll('.currency-input').forEach(_setupCurrencyInput);
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
 * (FUNCIÓN COMPLETA) Registra el pago, aplica deducciones y AMORTIZA PRÉSTAMOS ESPECÍFICOS.
 */
async function handleRegisterPayment(e, userId) {
    e.preventDefault();
    const submitButton = document.getElementById('payment-submit-button');
    submitButton.disabled = true;
    submitButton.innerHTML = '<div class="loader-small mx-auto"></div>';

    const config = _getPayrollConfig();
    const form = document.getElementById('payment-register-form');

    try {
        // 1. Obtener valores generales
        const diasPagar = parseFloat(document.getElementById('payment-dias-pagar').value) || 0;
        const salarioMensual = parseFloat(document.getElementById('payment-salario-basico').dataset.value || 0);
        const auxTransporteMensual = parseFloat(document.getElementById('payment-salario-basico').dataset.auxTransporte || 0);

        const salarioProrrateado = (salarioMensual / 30) * diasPagar;
        const auxTransporteProrrateado = (auxTransporteMensual / 30) * diasPagar;

        const otros = parseFloat(document.getElementById('payment-otros').value.replace(/[$. ]/g, '')) || 0;
        const totalHorasExtra = parseFloat(document.getElementById('payment-total-horas').textContent.replace(/[$. ]/g, '')) || 0;
        const concepto = document.getElementById('payment-concepto').value;

        // 2. PROCESAR DEDUCCIÓN DE PRÉSTAMOS (Lógica Individual)
        let totalLoanDeduction = 0;
        const loanPayments = []; // Array para guardar qué préstamos se pagaron

        const loanInputs = document.querySelectorAll('.loan-deduction-input');
        for (const input of loanInputs) {
            const val = parseFloat(input.value.replace(/[$. ]/g, '')) || 0;
            const loanId = input.dataset.loanId;
            const currentBalance = parseFloat(input.dataset.balance);

            if (val > 0) {
                if (val > currentBalance) {
                    throw new Error(`El abono a uno de los préstamos supera su saldo pendiente (${currencyFormatter.format(currentBalance)}).`);
                }

                totalLoanDeduction += val;
                loanPayments.push({
                    loanId: loanId,
                    amount: val,
                    previousBalance: currentBalance
                });
            }
        }

        // 3. Checkbox Liquidación
        const liquidarBonificacion = document.getElementById('payment-liquidar-bonificacion').checked;
        const bonificacionPotencial = parseFloat(document.getElementById('payment-bonificacion-mes').dataset.value || 0);
        const bonificacionPagada = liquidarBonificacion ? bonificacionPotencial : 0;

        // 4. Validaciones
        if (!concepto) throw new Error("Ingresa un concepto para el pago.");
        if (diasPagar <= 0) throw new Error("Días a pagar inválidos.");

        // 5. Calcular Deducciones de Ley
        const deduccionSobreMinimo = form.dataset.deduccionSobreMinimo === 'true';
        let baseDeduccion = 0;

        if (deduccionSobreMinimo) {
            baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
        } else {
            baseDeduccion = salarioProrrateado + totalHorasExtra + bonificacionPagada;
        }

        if (baseDeduccion > 0 && baseDeduccion < (config.salarioMinimo / 30) * diasPagar) {
            baseDeduccion = (config.salarioMinimo / 30) * diasPagar;
        }

        const deduccionSalud = baseDeduccion * (config.porcentajeSalud / 100);
        const deduccionPension = baseDeduccion * (config.porcentajePension / 100);
        const totalDeduccionesLey = deduccionSalud + deduccionPension;

        // 6. CALCULAR NETO A PAGAR FINAL
        // (Ingresos) - (Salud + Pension) - (Total Préstamos)
        const totalDevengado = salarioProrrateado + auxTransporteProrrateado + bonificacionPagada + totalHorasExtra + otros;
        const totalPagar = totalDevengado - totalDeduccionesLey - totalLoanDeduction;

        if (totalPagar < 0) throw new Error("El total a pagar no puede ser negativo. Revisa las deducciones.");

        // 7. Obtener datos de registro
        const currentUserId = _getCurrentUserId();
        const usersMap = _getUsersMap();
        const currentUser = usersMap.get(currentUserId);
        const registeredByName = currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : 'Sistema';

        // 8. Construir Objeto Payment
        const paymentData = {
            userId: userId,
            paymentDate: new Date().toISOString().split('T')[0],
            concepto: concepto,
            monto: totalPagar,
            diasPagados: diasPagar,
            desglose: {
                salarioProrrateado: salarioProrrateado,
                auxilioTransporteProrrateado: auxTransporteProrrateado,
                bonificacionM2: bonificacionPagada,
                horasExtra: totalHorasExtra,
                otros: otros,
                abonoPrestamos: totalLoanDeduction, // Total descontado
                detallesPrestamos: loanPayments,    // Detalle específico (NUEVO)
                deduccionSalud: -deduccionSalud,
                deduccionPension: -deduccionPension,
                baseDeduccion: baseDeduccion,
                deduccionSobreMinimo: deduccionSobreMinimo
            },
            horas: {
                totalHorasExtra: parseFloat(document.getElementById('payment-horas-diurnas').value) || 0
            },
            createdAt: serverTimestamp(),
            registeredBy: currentUserId,
            registeredByName: registeredByName
        };

        const batch = writeBatch(_db);

        // A. Guardar el documento de Pago
        const paymentHistoryRef = doc(collection(_db, "users", userId, "paymentHistory"));
        batch.set(paymentHistoryRef, paymentData);

        // B. Actualizar Bonificación (si aplica)
        if (liquidarBonificacion) {
            const today = new Date();
            const currentStatDocId = `${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}`;
            const statRef = doc(_db, "employeeStats", userId, "monthlyStats", currentStatDocId);
            batch.set(statRef, { bonificacionPagada: true }, { merge: true });
        }

        // C. AMORTIZAR PRÉSTAMOS ESPECÍFICOS
        loanPayments.forEach(pago => {
            const loanRef = doc(_db, "users", userId, "loans", pago.loanId);
            const newBalance = pago.previousBalance - pago.amount;

            const updateData = { balance: newBalance };
            if (newBalance <= 0) {
                updateData.status = 'paid';
                updateData.paidAt = serverTimestamp();
            }
            batch.update(loanRef, updateData);
        });

        // Ejecutar todas las escrituras
        await batch.commit();

        // 9. Resetear y Recargar
        document.getElementById('payment-concepto').value = '';
        document.getElementById('payment-horas-diurnas').value = '0';
        document.getElementById('payment-otros').value = '$ 0';
        // Los inputs de préstamos se limpiarán al recargar la vista
        document.getElementById('payment-dias-pagar').value = '15';

        document.querySelectorAll('#payment-register-form .currency-input').forEach(_setupCurrencyInput);

        // Recargar vista para ver el pago en la tabla y actualizar las deudas
        loadPaymentHistoryView(userId);

    } catch (error) {
        console.error("Error al registrar el pago:", error);
        window.showToast(error.message, "error");
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
 */
async function openBatchDownloadModal(user) {
    const userId = user.id;
    const userName = `${user.firstName}_${user.lastName}`.replace(/\s+/g, '_');

    // 1. Definir qué categorías de RRHH nos interesan (Las de SST se traen todas)
    const RELEVANT_RRHH = ['cedula', 'hoja_vida', 'certificados', 'seguridad_social'];
    const RRHH_LABELS = {
        'cedula': 'Cédula de Ciudadanía',
        'hoja_vida': 'Hoja de Vida',
        'certificados': 'Certificados de Estudio',
        'seguridad_social': 'Certificados ARL/EPS/CCF'
    };

    // 2. Modal UI (Loading inicial)
    let modalId = 'zip-download-modal';
    // Eliminar si existe previo
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

                <div class="mt-6 pt-4 border-t border-gray-100 flex justify-between items-center">
                    <div class="text-xs text-gray-500">
                        <span id="zip-selected-count">0</span> seleccionados
                    </div>
                    <button id="btn-start-download" disabled class="bg-gray-300 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center transition-colors">
                        Descargar ZIP
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Cerrar modal
    document.getElementById('close-zip-modal').onclick = () => document.getElementById(modalId).remove();

    try {
        // 3. Consultar TODOS los documentos del usuario
        const q = query(collection(_db, "users", userId, "documents"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            document.getElementById('zip-modal-content').innerHTML = `<p class="text-center text-gray-500 py-8">Este usuario no tiene documentos cargados.</p>`;
            return;
        }

        // 4. Clasificar Documentos
        const rrhhDocs = [];
        const sstDocs = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            // Filtro RRHH
            if (RELEVANT_RRHH.includes(data.category)) {
                rrhhDocs.push(data);
            }
            // Filtro SST (Todo lo que empiece por sst_)
            else if (data.category.startsWith('sst_')) {
                sstDocs.push(data);
            }
        });

        // 5. Renderizar Lista con Checkboxes
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
            contentDiv.innerHTML = `<p class="text-center text-gray-500 py-8">No hay documentos de las categorías requeridas disponibles.</p>`;
            return;
        }

        // 6. Lógica de Selección
        const checkboxes = contentDiv.querySelectorAll('.zip-checkbox');
        const btnDownload = document.getElementById('btn-start-download');
        const countLabel = document.getElementById('zip-selected-count');

        const updateCount = () => {
            const count = contentDiv.querySelectorAll('.zip-checkbox:checked').length;
            countLabel.textContent = count;
            if (count > 0) {
                btnDownload.disabled = false;
                btnDownload.classList.remove('bg-gray-300', 'cursor-not-allowed');
                btnDownload.classList.add('bg-indigo-600', 'hover:bg-indigo-700', 'shadow-lg');
            } else {
                btnDownload.disabled = true;
                btnDownload.classList.add('bg-gray-300');
                btnDownload.classList.remove('bg-indigo-600', 'hover:bg-indigo-700', 'shadow-lg');
            }
        };

        checkboxes.forEach(cb => cb.addEventListener('change', updateCount));

        // 7. Lógica de Descarga y Compresión (JSZip)
        btnDownload.onclick = async () => {
            const selected = Array.from(contentDiv.querySelectorAll('.zip-checkbox:checked'));
            if (selected.length === 0) return;

            // UI Loading state
            btnDownload.disabled = true;
            btnDownload.innerHTML = `<div class="loader-small-white mr-2"></div> Comprimiendo...`;

            const zip = new JSZip();
            const folderName = `Documentos_${userName}`;
            const folder = zip.folder(folderName);

            try {
                // Iterar y descargar cada archivo
                const promises = selected.map(async (checkbox) => {
                    const url = checkbox.dataset.url;
                    const originalName = checkbox.dataset.name;
                    const category = checkbox.dataset.cat;

                    // Limpiar nombre para evitar errores en el zip
                    const safeName = originalName.replace(/[^a-z0-9.\-_]/gi, '_');
                    // Opcional: Prefijo de categoría para ordenar carpeta
                    const fileName = `${category}_${safeName}`;

                    // Fetch del BLOB (Binario)
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`Error descargando ${originalName}`);
                    const blob = await response.blob();

                    folder.file(fileName, blob);
                });

                await Promise.all(promises);

                // Generar ZIP
                const content = await zip.generateAsync({ type: "blob" });

                // Guardar
                saveAs(content, `${folderName}.zip`);

                window.showToast("Archivo descargado correctamente.", "success");
                document.getElementById(modalId).remove();

            } catch (error) {
                console.error("Error generando ZIP:", error);
                window.showToast("Error al descargar algunos archivos. Revisa los permisos o CORS.", "error");
                btnDownload.innerHTML = "Reintentar Descarga";
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