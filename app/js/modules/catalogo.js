// js/catalogo.js
import { collection, query, where, orderBy, limit, getDocs, onSnapshot, doc, writeBatch } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";


// --- VARIABLES DE ESTADO DEL CATÁLOGO ---
let db;
let cachedRecentPOs = [];
let unsubscribeCatalog = null;
let allCatalogItems = [];
let catalogCurrentPage = 1;
const catalogItemsPerPage = 10;
export let catalogSearchTerm = ''; // Exportada por si app.js la necesita

export function getCachedRecentPOs() {
    return cachedRecentPOs;
}

/**
 * Inicializa el módulo inyectando la base de datos
 */
export function initCatalogo(firestoreDb) {
    db = firestoreDb;
}

/**
 * Carga la vista principal del catálogo, incluyendo historial de precios y búsqueda con paginación.
 */
export async function loadCatalogView() {
    const tableBody = document.getElementById('catalog-table-body');
    const searchInput = document.getElementById('catalog-search-input');

    if (!tableBody) return;

    catalogCurrentPage = 1; // Reset a primera página al cargar
    catalogSearchTerm = searchInput ? searchInput.value.trim() : '';

    // PRE-CARGA DE HISTORIAL (Optimización: Una sola consulta para toda la tabla)
    try {
        const historyQuery = query(
            collection(db, "purchaseOrders"),
            where("status", "==", "recibida"),
            orderBy("createdAt", "desc"),
            limit(200)
        );
        const historySnap = await getDocs(historyQuery);
        cachedRecentPOs = historySnap.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`Historial de precios cargado: ${cachedRecentPOs.length} órdenes procesadas.`);
    } catch (e) {
        console.warn("No se pudo cargar historial de precios:", e);
        cachedRecentPOs = [];
    }

    if (unsubscribeCatalog) unsubscribeCatalog();

    tableBody.innerHTML = '<tr><td colspan="7" class="text-center py-12"><div class="loader mx-auto"></div></td></tr>';

    const catalogQuery = query(collection(db, "materialCatalog"), orderBy("name"));
    unsubscribeCatalog = onSnapshot(catalogQuery, (snapshot) => {
        allCatalogItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
        renderCatalogTable(term);
    }, (error) => {
        console.error("Error al suscribirse al catálogo:", error);
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-red-500">Error al conectar con el inventario.</td></tr>`;
    });

    if (searchInput && !searchInput.dataset.listening) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            catalogCurrentPage = 1; // Reset a primera página al buscar
            renderCatalogTable(term);
        });
        searchInput.dataset.listening = "true";
    }
}

/**
 * Renderiza la tabla de catálogo filtrada y paginada en memoria.
 */
function renderCatalogTable(searchTerm = '') {
    const tableBody = document.getElementById('catalog-table-body');
    const pagContainer = document.getElementById('catalog-pagination-container');

    if (!tableBody) return;
    tableBody.innerHTML = '';

    // A. Filtrado en memoria
    let filtered = allCatalogItems;
    if (searchTerm) {
        filtered = allCatalogItems.filter(material => {
            const nameMatch = material.name?.toLowerCase().includes(searchTerm);
            const refMatch = material.reference?.toLowerCase().includes(searchTerm);
            const systemMatch = material.system?.toLowerCase().includes(searchTerm);
            const colorMatch = material.color?.toLowerCase().includes(searchTerm);
            return nameMatch || refMatch || systemMatch || colorMatch;
        });
    }

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-12 text-gray-400 flex flex-col items-center justify-center"><i class="fa-solid fa-box-open text-3xl mb-2 opacity-50"></i><p>No se encontraron coincidencias.</p></td></tr>`;
        if (pagContainer) pagContainer.innerHTML = '';
        return;
    }

    // B. Paginación en memoria
    const totalPages = Math.ceil(filtered.length / catalogItemsPerPage) || 1;
    if (catalogCurrentPage > totalPages) {
        catalogCurrentPage = totalPages;
    }
    if (catalogCurrentPage < 1) {
        catalogCurrentPage = 1;
    }

    const startIdx = (catalogCurrentPage - 1) * catalogItemsPerPage;
    const endIdx = startIdx + catalogItemsPerPage;
    const paginatedItems = filtered.slice(startIdx, endIdx);

    // Pintar controles de paginación
    if (pagContainer) {
        const regStart = startIdx + 1;
        const regEnd = Math.min(endIdx, filtered.length);
        
        pagContainer.innerHTML = `
            <div>
                Mostrando <span class="font-bold text-slate-700">${regStart}</span> a <span class="font-bold text-slate-700">${regEnd}</span> de <span class="font-bold text-slate-700">${filtered.length}</span> materiales
            </div>
            <div class="flex items-center gap-2">
                <button id="btn-cat-pag-prev" ${catalogCurrentPage === 1 ? 'disabled' : ''} 
                    class="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-bold transition-all disabled:opacity-40 disabled:hover:bg-white cursor-pointer disabled:cursor-not-allowed text-xs flex items-center gap-1">
                    <i class="fa-solid fa-angle-left"></i> Anterior
                </button>
                <span class="text-xs font-bold text-slate-400 px-2">Página ${catalogCurrentPage} de ${totalPages}</span>
                <button id="btn-cat-pag-next" ${catalogCurrentPage === totalPages ? 'disabled' : ''} 
                    class="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-bold transition-all disabled:opacity-40 disabled:hover:bg-white cursor-pointer disabled:cursor-not-allowed text-xs flex items-center gap-1">
                    Siguiente <i class="fa-solid fa-angle-right"></i>
                </button>
            </div>
        `;

        const btnPrev = document.getElementById('btn-cat-pag-prev');
        const btnNext = document.getElementById('btn-cat-pag-next');

        if (btnPrev && catalogCurrentPage > 1) {
            btnPrev.onclick = () => {
                catalogCurrentPage--;
                renderCatalogTable(searchTerm);
            };
        }
        if (btnNext && catalogCurrentPage < totalPages) {
            btnNext.onclick = () => {
                catalogCurrentPage++;
                renderCatalogTable(searchTerm);
            };
        }
    }

    paginatedItems.forEach(material => {
        tableBody.appendChild(createModernCatalogRow(material, cachedRecentPOs));
    });
}

/**
 * Paginación obsoleta: Mantenida como stub vacío para compatibilidad de importación
 */
export async function fetchMoreCatalogItems() {
    // Deprecated: client-side pagination is now used.
}

/**
 * Crea una fila de tabla moderna para el catálogo de materiales.
 */
function createModernCatalogRow(material, priceHistory = []) {
    const stock = material.quantityInStock || 0;
    const minStock = material.minStockThreshold || 0;
    const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

    let minPrice = material.basePrice && material.basePrice > 0 ? material.basePrice : Infinity;
    let bestSupplier = minPrice !== Infinity ? (material.assignedSupplierName || 'Catálogo') : '';
    let priceSource = minPrice !== Infinity ? 'catalog' : 'none';
    let bestPriceHtml = '<span class="text-xs text-gray-400 italic font-medium">Sin cotización</span>';

    if (priceHistory.length > 0) {
        priceHistory.forEach(po => {
            if (po.items && Array.isArray(po.items)) {
                const itemInPO = po.items.find(i => i.materialId === material.id);
                if (itemInPO && itemInPO.unitCost > 0) {
                    if (itemInPO.unitCost < minPrice) {
                        minPrice = itemInPO.unitCost;
                        bestSupplier = po.supplierName || po.provider || 'Prov. Desconocido';
                        priceSource = 'supplier';
                    }
                }
            }
        });
    }

    if (minPrice !== Infinity) {
        if (priceSource === 'catalog') {
            bestPriceHtml = `
                <div class="flex flex-col items-center justify-center gap-1">
                    <span class="font-black text-blue-700 text-base tracking-tight shadow-sm bg-white/50 px-2 rounded">
                        ${currencyFormatter.format(minPrice)}
                    </span>
                    <div class="flex items-center gap-1.5 bg-white border border-blue-200 rounded-md px-2 py-1 shadow-sm w-full max-w-[140px] justify-center" title="Precio asignado manualmente en el catálogo">
                        <i class="fa-solid fa-tag text-blue-400 text-[10px]"></i>
                        <span class="text-[10px] font-bold text-slate-700 uppercase tracking-wide truncate">
                            ${bestSupplier}
                        </span>
                    </div>
                </div>
            `;
        } else {
            const displaySupplier = bestSupplier.length > 18 ? bestSupplier.substring(0, 16) + '...' : bestSupplier;
            bestPriceHtml = `
                <div class="flex flex-col items-center justify-center gap-1">
                    <span class="font-black text-emerald-700 text-base tracking-tight shadow-sm bg-white/50 px-2 rounded">
                        ${currencyFormatter.format(minPrice)}
                    </span>
                    <div class="flex items-center gap-1.5 bg-white border border-emerald-200 rounded-md px-2 py-1 shadow-sm w-full max-w-[140px] justify-center" title="${bestSupplier}">
                        <i class="fa-solid fa-truck-fast text-emerald-400 text-[10px]"></i>
                        <span class="text-[10px] font-bold text-slate-700 uppercase tracking-wide truncate">
                            ${displaySupplier}
                        </span>
                    </div>
                </div>
            `;
        }
    }

    let statusBadge;
    if (stock <= 0) {
        statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-red-50 text-red-600 border border-red-100"><i class="fa-solid fa-circle-xmark"></i> Agotado</span>`;
    } else if (stock <= minStock) {
        statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-600 border border-amber-100"><i class="fa-solid fa-triangle-exclamation"></i> Bajo</span>`;
    } else {
        statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-600 border border-emerald-100"><i class="fa-solid fa-check-circle"></i> OK</span>`;
    }

    const viewInventoryBtn = material.isDivisible
        ? `<button data-action="view-inventory" data-id="${material.id}" data-name="${material.name}" 
             class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all" title="Ver Lotes">
             <i class="fa-solid fa-layer-group"></i>
           </button>`
        : `<span class="w-8 inline-block"></span>`;

    const compareBtn = `
        <button data-action="compare-prices" data-id="${material.id}" data-name="${material.name}" 
            class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all" title="Comparar Precios">
            <i class="fa-solid fa-tags"></i>
        </button>
    `;

    const row = document.createElement('tr');
    row.className = 'bg-white hover:bg-slate-50 transition-colors group border-b border-slate-50 last:border-0';

    row.innerHTML = `
        <td class="px-6 py-4">
            <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center text-lg border border-slate-200 group-hover:border-indigo-200 group-hover:bg-indigo-50 group-hover:text-indigo-500 transition-all shadow-sm">
                    <i class="fa-solid fa-box"></i>
                </div>
                <div>
                    <p class="font-bold text-slate-700 text-sm leading-tight">${material.name}</p>
                    <div class="flex items-center gap-2 mt-1 flex-wrap">
                        <span class="text-[9px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200" title="Referencia">
                            <i class="fa-solid fa-barcode text-[8px] opacity-70"></i> ${material.reference || '---'}
                        </span>
                        ${material.system ? `
                        <span class="text-[9px] font-medium bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100" title="Sistema">
                            <i class="fa-solid fa-gears text-[8px] opacity-70"></i> ${material.system}
                        </span>
                        ` : ''}
                        ${material.color ? `
                        <span class="text-[9px] font-medium bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded border border-purple-100" title="Color">
                            <i class="fa-solid fa-palette text-[8px] opacity-70"></i> ${material.color}
                        </span>
                        ` : ''}
                    </div>
                </div>
            </div>
        </td>
        <td class="px-6 py-4 text-center">
             <span class="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                ${material.measurementType === 'linear' ? 'Lineal' : (material.measurementType === 'area' ? 'Área' : 'Unidad')}
             </span>
        </td>
        <td class="px-6 py-4 text-center text-sm font-bold text-slate-600">${material.unit}</td>
        <td class="px-6 py-4 text-center">
            <span class="font-black text-slate-800 text-base">${stock}</span>
        </td>
        <td class="px-4 py-4 text-center bg-emerald-50/40 border-l border-r border-dashed border-emerald-100 min-w-[160px]">
            ${bestPriceHtml}
        </td>
        <td class="px-6 py-4 text-center">${statusBadge}</td>
        <td class="px-6 py-4 text-right">
            <div class="flex justify-end items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                ${compareBtn}
                ${viewInventoryBtn}
                <button data-action="edit-catalog-item" data-id="${material.id}" 
                    class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-all" title="Editar">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
            </div>
        </td>
    `;
    return row;
}

// --- EXTRACTION FROM APP.JS (OLA 6 MODULARIZATION) ---

export function openImportModal(projectIdOverride = null) {
    // --- LÓGICA DE SEGURIDAD PARA EL PROYECTO ---
    let targetProjectId = projectIdOverride;
    
    // Intentamos leer la variable 'currentProject' del scope de app.js
    if (!targetProjectId && typeof currentProject !== 'undefined' && currentProject) {
        targetProjectId = currentProject.id;
    }

    // --- HTML DEL MODAL ---
    const overlay = document.createElement('div');
    overlay.className = "fixed inset-0 bg-gray-900 bg-opacity-60 z-[80] flex items-center justify-center opacity-0 transition-opacity duration-300 backdrop-blur-sm";
    overlay.id = "import-materials-modal";

    const modalHtml = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-0 transform scale-95 transition-transform duration-300 flex flex-col overflow-hidden">
            <div class="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-white">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-xl">
                        <i class="fa-solid fa-file-import"></i>
                    </div>
                    <div>
                        <h3 class="text-lg font-bold text-gray-800">Importar Materiales</h3>
                        <p class="text-xs text-gray-500">
                            ${targetProjectId ? 'Asociando al Proyecto Actual' : 'Carga al Inventario Global'}
                        </p>
                    </div>
                </div>
                <button id="close-import-modal" class="text-gray-400 hover:text-gray-600 transition-colors"><i class="fa-solid fa-xmark text-xl"></i></button>
            </div>

            <div class="p-6 space-y-6">
                <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-4">
                    <div class="text-blue-500 mt-1"><i class="fa-solid fa-download text-lg"></i></div>
                    <div class="flex-1">
                        <h4 class="text-sm font-bold text-blue-800 mb-1">Descarga la plantilla</h4>
                        <p class="text-xs text-blue-600 mb-3">Usa este archivo base. No cambies los encabezados.</p>
                        <button id="btn-download-template" class="bg-white text-blue-600 border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-2">
                            <i class="fa-solid fa-download"></i> Descargar Plantilla .xlsx
                        </button>
                    </div>
                </div>

                ${!targetProjectId ? `
                <div class="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex items-start gap-4">
                    <div class="text-indigo-500 mt-1"><i class="fa-solid fa-file-excel text-lg"></i></div>
                    <div class="flex-1">
                        <h4 class="text-sm font-bold text-indigo-800 mb-1">Exportar catálogo actual con IDs</h4>
                        <p class="text-xs text-indigo-600 mb-3">Descarga todos los materiales del catálogo maestro con sus identificadores únicos para editarlos en Excel y volverlos a importar sin romper las solicitudes existentes.</p>
                        <button id="btn-export-catalog" class="bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-2">
                            <i class="fa-solid fa-file-excel"></i> Descargar Catálogo Actual .xlsx
                        </button>
                    </div>
                </div>
                ` : ''}

                <div class="space-y-2">
                    <label class="block text-sm font-bold text-gray-700">Sube tu archivo diligenciado</label>
                    <div class="relative group">
                        <input type="file" id="excel-upload-input" accept=".xlsx, .xls, .csv" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10">
                        <div id="drop-zone" class="border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center justify-center text-center group-hover:border-green-400 group-hover:bg-green-50 transition-all">
                            <div class="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3 group-hover:bg-white text-gray-400 group-hover:text-green-500 transition-colors">
                                <i class="fa-solid fa-cloud-arrow-up text-2xl"></i>
                            </div>
                            <p class="text-sm font-medium text-gray-600 group-hover:text-green-700"><span class="text-green-600 font-bold">Haz clic para subir</span></p>
                            <p id="file-name-display" class="text-sm font-bold text-gray-800 mt-3 hidden bg-white px-3 py-1 rounded shadow-sm border"></p>
                        </div>
                    </div>
                </div>
            </div>

            <div class="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                <button id="cancel-import" class="px-4 py-2 rounded-lg text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100">Cancelar</button>
                <button id="confirm-import" disabled class="px-4 py-2 rounded-lg text-sm font-bold text-white bg-gray-300 cursor-not-allowed transition-all flex items-center gap-2">
                    <i class="fa-solid fa-upload"></i> Importar Datos
                </button>
            </div>
        </div>
    `;

    overlay.innerHTML = modalHtml;
    document.body.appendChild(overlay);

    // Animación entrada (Con validación de existencia)
    requestAnimationFrame(() => {
        if (overlay) {
            overlay.classList.remove('opacity-0');
            const innerDiv = overlay.querySelector('div');
            if (innerDiv) {
                innerDiv.classList.remove('scale-95');
                innerDiv.classList.add('scale-100');
            }
        }
    });

    // --- MANEJO DE EVENTOS (USANDO SELECTORES INTERNOS) ---
    // Buscamos DENTRO del overlay, no en todo el documento. Es más seguro.
    const fileInput = overlay.querySelector('#excel-upload-input');
    const fileNameDisplay = overlay.querySelector('#file-name-display');
    const confirmBtn = overlay.querySelector('#confirm-import');
    const downloadBtn = overlay.querySelector('#btn-download-template');
    const closeBtn = overlay.querySelector('#close-import-modal');
    const cancelBtn = overlay.querySelector('#cancel-import');
    const dropZone = overlay.querySelector('#drop-zone');

    const closeModal = () => {
        overlay.classList.add('opacity-0');
        const innerDiv = overlay.querySelector('div');
        if (innerDiv) {
            innerDiv.classList.remove('scale-100');
            innerDiv.classList.add('scale-95');
        }
        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 300);
    };

    // 1. Descargar Plantilla
    if (downloadBtn) {
        downloadBtn.onclick = () => generateMaterialTemplate();
    }

    // 1b. Exportar Catálogo Actual
    const exportBtn = overlay.querySelector('#btn-export-catalog');
    if (exportBtn) {
        exportBtn.onclick = () => exportAllCatalogToExcel();
    }

    // 2. Seleccionar Archivo
    if (fileInput) {
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                if (fileNameDisplay) {
                    fileNameDisplay.textContent = `📄 ${file.name}`;
                    fileNameDisplay.classList.remove('hidden');
                }
                if (dropZone) dropZone.classList.add('border-green-500', 'bg-green-50');
                
                if (confirmBtn) {
                    confirmBtn.disabled = false;
                    confirmBtn.classList.remove('bg-gray-300', 'cursor-not-allowed');
                    confirmBtn.classList.add('bg-green-600', 'hover:bg-green-700', 'shadow-md');
                }
            }
        };
    }

    // 3. Confirmar Importación
if (confirmBtn) {
        confirmBtn.onclick = async () => {
            const file = fileInput.files[0];
            if (!file) return;

            confirmBtn.innerHTML = '<div class="loader-xs border-white mr-2"></div> Procesando...';
            confirmBtn.disabled = true;

            try {
                // Usamos la variable targetProjectId que calculamos al inicio
                await importMaterialsFromExcel(file, targetProjectId);
                closeModal();
                
                // --- RECARGA DE VISTAS (Lógica corregida) ---
                
                // 1. Si estamos en un proyecto específico, recargamos su inventario
                if (targetProjectId && typeof loadItems === 'function') {
                    console.log("Recargando inventario de proyecto...");
                    loadItems(targetProjectId);
                } 
                // 2. Si estamos en el catálogo global (Inventory), recargamos esa vista
                else if (typeof loadCatalogView === 'function') {
                    console.log("Recargando catálogo global...");
                    
                    // Reseteamos la paginación para ver los nuevos items al principio si ordenas por fecha o nombre
                    if (typeof lastVisibleCatalogDoc !== 'undefined') {
                        lastVisibleCatalogDoc = null; 
                    }
                    
                    // Llamamos a la función principal de carga
                    loadCatalogView();
                }

                // Notificación visual extra (opcional)
                const successToast = document.createElement('div');
                successToast.className = "fixed bottom-5 right-5 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-[100] animate-fade-in-up flex items-center gap-3";
                successToast.innerHTML = '<i class="fa-solid fa-check-circle text-xl"></i> Datos actualizados';
                document.body.appendChild(successToast);
                setTimeout(() => successToast.remove(), 3000);

            } catch (error) {
                console.error(error);
                alert("Error: " + error.message);
                confirmBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Reintentar';
                confirmBtn.disabled = false;
            }
        };
    }

    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;
}

export async function generateMaterialTemplate() {
    try {
        await window.ensureXLSX();
    } catch (err) {
        alert("Error al cargar la librería de Excel: " + err.message);
        return;
    }

    const headers = [
        { 
            "Referencia": "TRN-001", 
            "Sistema": "GENERAL",
            "Nombre": "Tornillo 3x1 Pulgada", 
            "Color": "Zinc",
            "Unidad": "Caja", 
            "Stock Inicial": 100,
            "Stock Mínimo": 10,
            "Tipo Medición": "unit",
            "Largo Estándar (cm)": "", 
            "Ancho Estándar (cm)": ""
        },
        { 
            "Referencia": "ALU-502", 
            "Sistema": "5020",
            "Nombre": "Perfil Aluminio 2x1", 
            "Color": "Mate",
            "Unidad": "Tira", 
            "Stock Inicial": 50,
            "Stock Mínimo": 5,
            "Tipo Medición": "linear",
            "Largo Estándar (cm)": 600,
            "Ancho Estándar (cm)": ""
        },
        { 
            "Referencia": "VID-TEM-6", 
            "Sistema": "TEMPLADO",
            "Nombre": "Vidrio Templado 6mm", 
            "Color": "Incoloro",
            "Unidad": "Lámina", 
            "Stock Inicial": 20,
            "Stock Mínimo": 3,
            "Tipo Medición": "area",
            "Largo Estándar (cm)": 240,
            "Ancho Estándar (cm)": 320
        }
    ];

    const worksheet = XLSX.utils.json_to_sheet(headers);
    
    // Ajustar anchos
    worksheet['!cols'] = [
        {wch: 30}, {wch: 15}, {wch: 10}, 
        {wch: 12}, {wch: 12}, // Stock Inicial y Mínimo
        {wch: 15}, {wch: 18}, {wch: 18}
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Plantilla Materiales");
    XLSX.writeFile(workbook, "Plantilla_Materiales_V3.xlsx");
}

export async function exportAllCatalogToExcel() {
    try {
        await window.ensureXLSX();
    } catch (err) {
        alert("Error al cargar la librería de Excel: " + err.message);
        return;
    }

    try {
        const querySnapshot = await getDocs(collection(db, "materialCatalog"));
        const materials = querySnapshot.docs.map(doc => {
            const data = doc.data();
            const name = String(data.name || '').trim();
            const reference = String(data.reference || '').trim();
            const formattedName = name ? (name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()) : '';
            const formattedRef = reference ? reference.toUpperCase() : '';
            const system = String(data.system || '').trim().toUpperCase();
            const color = String(data.color || '').trim();
            const formattedColor = color ? (color.charAt(0).toUpperCase() + color.slice(1).toLowerCase()) : '';

            return {
                "ID": doc.id,
                "Referencia": formattedRef,
                "Sistema": system,
                "Nombre": formattedName,
                "Color": formattedColor,
                "Unidad": data.unit || 'Unidad',
                "Stock Inicial": data.quantityInStock || 0,
                "Stock Mínimo": data.minStockThreshold || 0,
                "Costo Base": data.basePrice || 0,
                "Proveedor ID": data.assignedSupplierId || '',
                "Proveedor Nombre": data.assignedSupplierName || '',
                "Tipo Medición": data.measurementType || 'unit',
                "Largo Estándar (cm)": (data.defaultSize && data.defaultSize.length) ? (data.defaultSize.length * 100) : '',
                "Ancho Estándar (cm)": (data.defaultSize && data.defaultSize.width) ? (data.defaultSize.width * 100) : ''
            };
        });

        materials.sort((a, b) => a.Nombre.localeCompare(b.Nombre));

        const worksheet = XLSX.utils.json_to_sheet(materials);

        worksheet['!cols'] = [
            {wch: 25}, // ID
            {wch: 15}, // Referencia
            {wch: 15}, // Sistema
            {wch: 30}, // Nombre
            {wch: 15}, // Color
            {wch: 10}, // Unidad
            {wch: 12}, // Stock Inicial
            {wch: 12}, // Stock Mínimo
            {wch: 12}, // Costo Base
            {wch: 25}, // Proveedor ID
            {wch: 20}, // Proveedor Nombre
            {wch: 15}, // Tipo Medición
            {wch: 18}, // Largo Estándar
            {wch: 18}  // Ancho Estándar
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Catálogo Completo");
        XLSX.writeFile(workbook, "Exportacion_Catalogo_Maestro.xlsx");
        
        console.log("Catálogo exportado exitosamente.");
    } catch (error) {
        console.error("Error al exportar catálogo:", error);
        alert("Error al exportar catálogo: " + error.message);
    }
}

export async function importMaterialsFromExcel(file, projectId = null) {
    try {
        await window.ensureXLSX();
    } catch (err) {
        throw new Error("Librería XLSX no encontrada: " + err.message);
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                if (!jsonData || jsonData.length === 0) {
                    alert("El archivo está vacío.");
                    return resolve();
                }

                const batchSize = 400;
                let batches = [];
                let currentBatch = writeBatch(db);
                let opCount = 0;
                let totalCount = 0;

                // Tipos permitidos
                const validTypes = ['unit', 'linear', 'area'];

                for (const row of jsonData) {
                    // Helper para leer columnas (ignora mayúsculas/minúsculas)
                    const getCol = (key) => row[key] || row[key.toLowerCase()] || row[key.toUpperCase()] || '';

                    const rawName = String(getCol('Nombre') || getCol('Material')).trim();
                    if (!rawName) continue;
                    const name = rawName ? (rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase()) : '';

                    // 1. VALIDACIÓN TIPO DE MEDICIÓN
                    let rawType = String(getCol('Tipo Medición')).toLowerCase().trim();
                    let measurementType = validTypes.includes(rawType) ? rawType : 'unit';

                    // 2. DIMENSIONES
                    const lengthCm = parseFloat(getCol('Largo Estándar (cm)')) || 0;
                    const widthCm = parseFloat(getCol('Ancho Estándar (cm)')) || 0;

                    let defaultSize = null;
                    if (measurementType === 'linear') {
                        defaultSize = { length: lengthCm > 0 ? lengthCm / 100 : 0, width: 0 };
                    } else if (measurementType === 'area') {
                        defaultSize = { length: lengthCm > 0 ? lengthCm / 100 : 0, width: widthCm > 0 ? widthCm / 100 : 0 };
                    }

                    const id = String(getCol('ID') || getCol('id') || '').trim();
                    const basePrice = parseFloat(getCol('Costo Base')) || parseFloat(getCol('Costo')) || 0;
                    const assignedSupplierId = String(getCol('Proveedor ID') || getCol('ProveedorID') || '').trim();
                    const assignedSupplierName = String(getCol('Proveedor Nombre') || getCol('ProveedorNombre') || '').trim();
                    const reference = String(getCol('Referencia')).trim().toUpperCase();
                    const system = String(getCol('Sistema')).trim().toUpperCase();
                    const rawColor = String(getCol('Color')).trim();
                    const color = rawColor ? (rawColor.charAt(0).toUpperCase() + rawColor.slice(1).toLowerCase()) : '';

                    // 3. ESTRUCTURA EXACTA PARA /materialCatalog
                        const materialData = {
                            name: name,
                            reference: reference,
                            system: system || null,
                            color: color || null,
                            unit: String(getCol('Unidad') || 'Unidad').trim(),
                            minStockThreshold: parseInt(getCol('Stock Mínimo')) || 5,
                            basePrice: basePrice,
                            assignedSupplierId: assignedSupplierId || null,
                            assignedSupplierName: assignedSupplierName || null,
                            
                            measurementType: measurementType,
                            defaultSize: defaultSize,

                            quantityInStock: parseInt(getCol('Stock Inicial')) || 0, 
                            
                            isDivisible: measurementType !== 'unit',
                            createdAt: new Date()
                        };

                    // --- CORRECCIÓN DE RUTA ---
                    // Si no hay proyecto, va al catálogo global 'materialCatalog'
                    const collectionPath = projectId ? `projects/${projectId}/items` : "materialCatalog";
                    
                    let newRef;
                    if (id && !projectId) {
                        newRef = doc(db, collectionPath, id);
                    } else {
                        newRef = doc(collection(db, collectionPath));
                    }
                    currentBatch.set(newRef, materialData);
                    
                    opCount++;
                    totalCount++;

                    if (opCount >= batchSize) {
                        batches.push(currentBatch.commit());
                        currentBatch = writeBatch(db);
                        opCount = 0;
                    }
                }

                if (opCount > 0) batches.push(currentBatch.commit());
                await Promise.all(batches);
                
                alert(`✅ Se importaron ${totalCount} materiales correctamente a ${projectId ? 'Proyecto' : 'Catálogo Global'}.`);
                resolve();

            } catch (error) {
                console.error("Error importando:", error);
                reject(error);
                alert("Error procesando el archivo: " + error.message);
            }
        };
        reader.readAsArrayBuffer(file);
    });
}
