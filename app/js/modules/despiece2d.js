import { db, auth } from '../core/firebase-config.js';
import { collection, addDoc, getDocs, getDoc, doc, updateDoc, deleteDoc, query, orderBy, where, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

let piezasList = [];
let lastId = 0;
let currentResult = null;
let currentSheetIndex = 0;
let activeHistoryId = null;

// Variables de gestión de inventario de láminas y retales
let laminasInventory = [];
let selectedLaminaId = null;
let unsubscribeLaminas = null;
let remnantsDecisions = [];
let modalRemnantsActiveSheetIndex = 0;
let modalRemnantsZoomLevel = 1.0;
let isInventoryDeducted = false;

// Variables para selección de cuadrícula y autorrelleno tipo Excel
let gridSelection = {
    isSelecting: false,
    isFilling: false,
    isMouseDown: false,
    dragStartX: 0,
    dragStartY: 0,
    startRow: null,
    startCol: null,
    endRow: null,
    endCol: null,
    fillEndRow: null,
    fillEndCol: null
};
let isGridEventsBound = false;

export function setupDespieceEvents() {
    if (window.__setupDespieceEventsInit) return;
    window.__setupDespieceEventsInit = true;

    initGridSelectionStyles();
    renderDespieceUI();

    // Mover modales directamente a document.body para evitar que los transforms/padding de contenedores padres generen franjas blancas en la parte superior
    const modalRemnants = document.getElementById('modal-remnants-visual');
    if (modalRemnants && modalRemnants.parentElement !== document.body) {
        document.body.appendChild(modalRemnants);
    }
    const modalLamina = document.getElementById('modal-lamina-item');
    if (modalLamina && modalLamina.parentElement !== document.body) {
        document.body.appendChild(modalLamina);
    }

    renderPiezasTable();
    setupListeners();
    subscribeLaminasInventory();
}

function renderDespieceUI() {
    const viewDespiece = document.getElementById('view-despiece');
    if (!viewDespiece) return;

    viewDespiece.innerHTML = `
    <div class="w-full max-w-[98%] mx-auto space-y-6 px-1 md:px-4">
        <!-- Header Card Premium -->
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col md:flex-row justify-between items-center gap-4 relative overflow-hidden">
            <div class="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full -mr-16 -mt-16 opacity-50 pointer-events-none"></div>
            <div class="flex items-center gap-4 relative z-10 w-full">
                <div class="w-12 h-12 bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-xl flex items-center justify-center text-2xl shadow-md flex-shrink-0">
                    <i class="fa-solid fa-scissors"></i>
                </div>
                <div>
                    <h1 class="text-2xl font-black text-gray-800 tracking-tight leading-none">Optimizador de Despiece 2D</h1>
                    <p class="text-xs text-gray-500 font-semibold mt-1.5">Calcula el corte óptimo de láminas de vidrio con el algoritmo de empaquetamiento 2D e impresión de planos.</p>
                </div>
            </div>
        </div>

        <!-- Tabs Navigation -->
        <div class="flex border-b border-gray-200 overflow-x-auto">
            <button id="tab-despiece-calc" class="border-b-2 border-indigo-600 px-6 py-3 text-sm font-bold text-indigo-650 transition-all flex items-center gap-2 whitespace-nowrap">
                <i class="fa-solid fa-calculator"></i> Nueva Optimización
            </button>
            <button id="tab-despiece-inventario" class="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition-all flex items-center gap-2 whitespace-nowrap">
                <i class="fa-solid fa-boxes-stacked"></i> Inventario de Láminas
                <span id="tab-inventory-badge" class="ml-1 text-[10px] font-black bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">0</span>
            </button>
            <button id="tab-despiece-history" class="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition-all flex items-center gap-2 whitespace-nowrap">
                <i class="fa-solid fa-clock-rotate-left"></i> Historial de Despieces
            </button>
        </div>

        <!-- Calculador / Optimizador Principal Container -->
        <div id="despiece-calc-container" class="space-y-6">
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Columna Parámetros (Izquierda) -->
                <div class="space-y-6 lg:col-span-1">
                    <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                        <div class="flex items-center gap-3 border-b border-gray-100 pb-4 mb-4">
                            <div class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
                                <i class="fa-solid fa-border-all"></i>
                            </div>
                            <h2 class="text-sm font-bold text-gray-800">Lámina Base</h2>
                        </div>

                        <!-- Selector de Inventario -->
                        <div class="bg-indigo-50/40 p-3 rounded-xl border border-indigo-100 space-y-1.5">
                            <label for="sheet-inventory-select" class="text-[10px] font-bold text-indigo-900 uppercase tracking-wider flex items-center justify-between">
                                <span class="flex items-center gap-1.5"><i class="fa-solid fa-boxes-stacked text-indigo-600"></i> Origen de Lámina</span>
                                <span id="sheet-inventory-stock-badge" class="hidden text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800"></span>
                            </label>
                            <select id="sheet-inventory-select" class="w-full px-3 py-2 border border-indigo-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-white font-semibold text-slate-700 cursor-pointer">
                                <option value="">Personalizado / Libre (Sin vincular a inventario)</option>
                            </select>
                            <p id="sheet-inventory-hint" class="text-[10px] text-indigo-600/70 font-medium">Selecciona una lámina o retal para descontar automáticamente su stock al optimizar.</p>
                        </div>

                        <div class="grid grid-cols-2 gap-3 pt-1">
                            <div>
                                <label for="sheet-width" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ancho (mm)</label>
                                <input type="number" id="sheet-width" class="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white font-semibold text-slate-700" value="3300" min="100">
                            </div>
                            <div>
                                <label for="sheet-height" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Alto (mm)</label>
                                <input type="number" id="sheet-height" class="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white font-semibold text-slate-700" value="2140" min="100">
                            </div>
                        </div>
                        <div class="pt-1">
                            <label for="sheet-client" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cliente / Proyecto (Opcional)</label>
                            <input type="text" id="sheet-client" class="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white font-semibold text-slate-700" placeholder="Ej: Obra 1 / Cliente X">
                        </div>
                        <div class="pt-1">
                            <label for="sheet-material" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tipo de Material</label>
                            <input type="text" id="sheet-material" class="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white font-semibold text-slate-700" value="LAMINADO 3+3" placeholder="Ej: LAMINADO 3+3">
                        </div>
                        <div class="pt-2">
                            <label for="opt-strategy" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tipo de Optimización</label>
                            <select id="opt-strategy" class="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white font-semibold text-slate-700 cursor-pointer">
                                <option value="AUTO" selected>Automático / Inteligente (Menor número de láminas - Recomendado)</option>
                                <option value="VERT_FIRST">Corte Vertical de 2140mm Primero (Fácil Manipulación + Máxima Optimización)</option>
                                <option value="GUIL_ROWS">Etapas múltiples - Guillotina Horizontal</option>
                                <option value="GUIL_COLS">Etapas múltiples - Guillotina Vertical</option>
                            </select>
                        </div>

                        <div class="space-y-3 pt-2">
                            <label class="flex items-center space-x-2.5 cursor-pointer my-0">
                                <input type="checkbox" id="opt-rotate" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/20" checked>
                                <span class="text-xs font-semibold text-slate-700 select-none">Permitir rotación de piezas</span>
                            </label>
                            <label class="flex items-start space-x-2.5 cursor-pointer my-0">
                                <input type="checkbox" id="opt-use-desperdicios" class="h-4 w-4 mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/20" checked>
                                <div>
                                    <span class="text-xs font-bold text-slate-700 select-none">Aprovechar desperdicios de inventario</span>
                                    <p class="text-[10px] text-gray-500 font-medium leading-tight">Usa retales disponibles de este material antes de abrir láminas nuevas (los desperdicios no llevan ID).</p>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Columna Agregar/Listado (Centro/Derecha) -->
                <div class="space-y-6 lg:col-span-2">
                    <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                        <!-- Encabezado y Barra de Herramientas de la Cuadrícula Excel -->
                        <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-gray-100 pb-3 mb-3">
                            <div class="flex items-center gap-2.5">
                                <div class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-base font-bold flex-shrink-0 shadow-sm border border-emerald-100">
                                    <i class="fa-solid fa-table-cells"></i>
                                </div>
                                <div>
                                    <div class="flex items-center gap-2">
                                        <h2 class="text-sm font-black text-gray-800 tracking-tight">Tabla de Medidas a Cortar</h2>
                                        <span class="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">Modo Excel</span>
                                    </div>
                                    <p class="text-[11px] text-slate-500 font-medium mt-0.5">Escribe directo en las celdas, navega con flechas y pega desde Excel o Sheets con <kbd class="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono text-slate-700 font-bold">Ctrl+V</kbd></p>
                                </div>
                            </div>
                            
                            <!-- Barra de Acciones de la Tabla -->
                            <div class="flex items-center gap-2 flex-wrap">
                                <span id="grid-stats-badge" class="bg-indigo-50 border border-indigo-100 text-indigo-750 font-bold px-2.5 py-1 rounded-xl text-xs select-none">
                                    0 piezas • 0 filas
                                </span>
                                <button type="button" id="grid-add-row-btn" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded-xl text-xs shadow-sm hover:shadow transition flex items-center gap-1.5">
                                    <i class="fa-solid fa-plus text-xs"></i> Agregar Fila
                                </button>
                                <button type="button" id="grid-paste-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded-xl text-xs shadow-sm hover:shadow transition flex items-center gap-1.5" title="Pegar contenido copiado de Excel (Ctrl+V)">
                                    <i class="fa-solid fa-paste text-xs"></i> Pegar Excel
                                </button>
                                <button type="button" id="grid-copy-btn" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-1.5 px-2.5 rounded-xl text-xs border border-slate-200 transition flex items-center gap-1.5" title="Copiar toda la tabla para pegarla en Excel">
                                    <i class="fa-solid fa-copy text-xs text-slate-500"></i> Copiar
                                </button>
                                <button type="button" id="despiece-download-template-btn" class="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition" title="Descargar plantilla .xlsx">
                                    <i class="fa-solid fa-file-excel text-emerald-600"></i> Plantilla
                                </button>
                                <button type="button" id="despiece-import-excel-btn" class="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition" title="Subir archivo Excel o CSV">
                                    <i class="fa-solid fa-file-import text-indigo-600"></i> Archivo
                                </button>
                                <input type="file" id="despiece-excel-file-input" accept=".xlsx, .xls, .csv" class="hidden">
                            </div>
                        </div>

                        <!-- Cuadrícula / Spreadsheet Table Interactiva -->
                        <div id="despiece-grid-container" class="border border-slate-300 rounded-xl overflow-hidden shadow-sm bg-white focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all">
                            <div class="overflow-x-auto max-h-[380px] overflow-y-auto" id="despiece-grid-scroll-container">
                                <table id="despiece-excel-grid" class="w-full text-left border-collapse text-xs">
                                    <thead class="sticky top-0 z-10 bg-slate-100 border-b border-slate-300 text-slate-700 text-[11px] font-bold uppercase tracking-wider shadow-sm select-none">
                                        <tr>
                                            <th class="w-10 py-2.5 px-2 text-center border-r border-slate-300 bg-slate-200/80 text-slate-600 cursor-pointer select-none" id="grid-select-all-header" title="Seleccionar toda la tabla">#</th>
                                            <th class="py-2.5 px-3 border-r border-slate-200 min-w-[150px] cursor-pointer select-none grid-col-header" data-col="0" title="Seleccionar columna Etiqueta">Etiqueta / Referencia</th>
                                            <th class="py-2.5 px-3 border-r border-slate-200 min-w-[110px] text-right cursor-pointer select-none grid-col-header" data-col="1" title="Seleccionar columna Ancho">Ancho (mm) *</th>
                                            <th class="py-2.5 px-3 border-r border-slate-200 min-w-[110px] text-right cursor-pointer select-none grid-col-header" data-col="2" title="Seleccionar columna Alto">Alto (mm) *</th>
                                            <th class="py-2.5 px-3 border-r border-slate-200 min-w-[90px] text-right cursor-pointer select-none grid-col-header" data-col="3" title="Seleccionar columna Cantidad">Cantidad</th>
                                            <th class="py-2.5 px-2 text-center w-24 select-none">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody id="piezas-list-body" class="divide-y divide-slate-200 font-semibold text-slate-800 bg-white">
                                    </tbody>
                                </table>
                            </div>
                            
                            <!-- Barra de Atajos y Pie de Tabla -->
                            <div class="bg-slate-50 px-3.5 py-2 border-t border-slate-200 flex flex-wrap items-center justify-between text-xs text-slate-600 gap-2">
                                <div class="flex items-center gap-3">
                                    <button type="button" id="grid-quick-add-btn" class="text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1.5 transition">
                                        <i class="fa-solid fa-plus-circle"></i> Nueva Fila (o pulsa Enter / Tab)
                                    </button>
                                    <span class="text-slate-300">|</span>
                                    <button type="button" id="grid-quick-paste-link" class="text-emerald-600 hover:text-emerald-800 font-bold flex items-center gap-1.5 transition">
                                        <i class="fa-solid fa-clipboard"></i> Pegar Portapapeles (Ctrl+V)
                                    </button>
                                </div>
                                <div class="hidden sm:flex items-center gap-2 text-[11px] text-slate-500 select-none">
                                    <span><kbd class="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-slate-700">↑↓←→</kbd> Flechas</span>
                                    <span><kbd class="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-slate-700">Enter</kbd> Bajar</span>
                                    <span><kbd class="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-slate-700">Tab</kbd> Siguiente</span>
                                    <span><kbd class="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-slate-700">Ctrl+V</kbd> Pegar</span>
                                </div>
                            </div>
                        </div>

                        <div class="flex flex-col sm:flex-row gap-3">
                            <button type="button" id="clear-despiece-btn" class="w-full sm:w-1/3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3.5 px-4 rounded-xl shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 text-sm">
                                <i class="fa-solid fa-trash-can"></i> Limpiar Todo
                            </button>
                            <button id="calculate-despiece-btn" class="w-full sm:w-2/3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 text-sm">
                                <i class="fa-solid fa-wand-magic-sparkles"></i> Calcular Optimización
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Resultados e Impresión en Plano 2D -->
            <div id="despiece-results-container" class="hidden grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Métricas (Izquierda) -->
                <div class="lg:col-span-1 space-y-6">
                    <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-5">
                        <div class="flex items-center gap-3 border-b border-gray-100 pb-4 mb-4">
                            <div class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
                                <i class="fa-solid fa-square-poll-vertical"></i>
                            </div>
                            <h2 class="text-sm font-bold text-gray-800">Resultados del Cálculo</h2>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4">
                            <div class="bg-indigo-50/40 p-4 rounded-xl border border-indigo-100/60 text-center shadow-sm">
                                <span class="text-[9px] font-bold text-indigo-700 uppercase tracking-wider">Láminas Necesarias</span>
                                <p id="res-sheets-count" class="text-3xl font-black text-indigo-650 mt-1">0</p>
                            </div>
                            <div class="bg-emerald-50/40 p-4 rounded-xl border border-emerald-100/60 text-center shadow-sm">
                                <span class="text-[9px] font-bold text-emerald-700 uppercase tracking-wider">Aprovechamiento</span>
                                <p id="res-utilization" class="text-3xl font-black text-emerald-650 mt-1">0%</p>
                            </div>
                        </div>

                        <div class="space-y-3 pt-2 text-xs font-semibold text-slate-600">
                            <div class="flex justify-between items-center border-b border-gray-50 pb-2">
                                <span class="flex items-center gap-1.5 text-slate-500">
                                    <i class="fa-solid fa-shapes text-gray-400 w-4"></i> Total Piezas Cortadas:
                                </span>
                                <span id="res-pieces-placed" class="text-slate-800 font-bold">0</span>
                            </div>
                            <div class="flex justify-between items-center border-b border-gray-50 pb-2">
                                <span class="flex items-center gap-1.5 text-slate-500">
                                    <i class="fa-solid fa-chart-area text-gray-400 w-4"></i> Área Útil Cortada:
                                </span>
                                <span id="res-useful-area" class="text-slate-800 font-bold">0 m²</span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="flex items-center gap-1.5 text-slate-500">
                                    <i class="fa-solid fa-trash-can text-gray-400 w-4"></i> Área de Desperdicio:
                                </span>
                                <span id="res-waste-area" class="text-slate-800 font-bold">0 m²</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Plano 2D (Centro/Derecha) -->
                <div class="lg:col-span-2 space-y-6">
                    <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-5">
                        <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-gray-100 pb-4 mb-2">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
                                    <i class="fa-solid fa-map"></i>
                                </div>
                                <h2 class="text-sm font-bold text-gray-800">Plano 2D de Corte</h2>
                            </div>
                            <div id="sheet-tabs" class="flex gap-1.5 overflow-x-auto whitespace-nowrap max-w-full sm:max-w-[70%] py-1 scrollbar-none"></div>
                        </div>

                        <div class="flex justify-center bg-gray-50 p-4 rounded-xl border border-gray-100 overflow-hidden relative min-h-[300px]">
                            <canvas id="despiece-canvas" class="max-w-full h-auto shadow-md bg-white rounded-lg"></canvas>
                        </div>
                        
                        <div class="flex flex-col sm:flex-row gap-4 justify-between sm:items-center text-xs font-semibold text-slate-500">
                            <span class="flex items-center gap-2">
                                <i class="fa-solid fa-circle-info text-indigo-500 text-sm"></i> Desplaza o haz zoom en la vista para ver los cortes detallados
                            </span>
                            <div class="flex gap-2.5 w-full sm:w-auto">
                                <button id="print-labels-btn" class="flex-1 sm:flex-initial bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-sm transition font-bold text-xs">
                                    <i class="fa-solid fa-tags"></i> Imprimir Rótulos (Stickers)
                                </button>
                                <button id="print-all-sheets-btn" class="flex-1 sm:flex-initial bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-sm transition font-bold text-xs">
                                    <i class="fa-solid fa-print"></i> Imprimir Planos
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Gestión de Láminas y Sobrantes (Retales) (Ancho completo) -->
                <div id="despiece-inventory-action-card" class="lg:col-span-3 bg-white p-6 rounded-xl border border-indigo-100 shadow-sm space-y-5">
                    <!-- Contenido renderizado por renderRemnantsDecisionCard() -->
                </div>
            </div>
        </div> <!-- Fin de despiece-calc-container -->

        <!-- Inventario de Láminas y Retales Container -->
        <div id="despiece-inventario-container" class="hidden space-y-6">
            <!-- Header inventario con acción -->
            <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center text-lg font-bold flex-shrink-0 shadow-sm">
                        <i class="fa-solid fa-boxes-stacked"></i>
                    </div>
                    <div>
                        <h2 class="text-base font-bold text-gray-800">Inventario de Láminas y Retales</h2>
                        <p class="text-xs text-gray-500 font-semibold">Gestiona el stock de hojas completas y retales aprovechables para despiece.</p>
                    </div>
                </div>
                <div class="flex gap-2.5">
                    <button id="btn-nueva-lamina" class="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow-sm hover:shadow transition-all flex items-center gap-2">
                        <i class="fa-solid fa-plus text-sm"></i> Ingresar Lámina o Retal
                    </button>
                </div>
            </div>

            <!-- KPIs de Inventario -->
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl flex-shrink-0">
                        <i class="fa-solid fa-border-all"></i>
                    </div>
                    <div>
                        <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Láminas Completas</span>
                        <p id="kpi-total-laminas" class="text-2xl font-black text-gray-800">0</p>
                    </div>
                </div>
                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-xl flex-shrink-0">
                        <i class="fa-solid fa-puzzle-piece"></i>
                    </div>
                    <div>
                        <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Retales Guardados</span>
                        <p id="kpi-total-retales" class="text-2xl font-black text-gray-800">0</p>
                    </div>
                </div>
                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl flex-shrink-0">
                        <i class="fa-solid fa-chart-area"></i>
                    </div>
                    <div>
                        <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Área Total en Stock</span>
                        <p id="kpi-total-area" class="text-2xl font-black text-gray-800">0 m²</p>
                    </div>
                </div>
                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-xl flex-shrink-0">
                        <i class="fa-solid fa-layer-group"></i>
                    </div>
                    <div>
                        <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Tipos de Material</span>
                        <p id="kpi-total-materiales" class="text-2xl font-black text-gray-800">0</p>
                    </div>
                </div>
            </div>

            <!-- Filtros y Tabla -->
            <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                <div class="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
                    <div class="relative flex-1">
                        <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                        <input type="text" id="inventory-search-input" class="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white font-semibold text-slate-700" placeholder="Buscar por material, dimensiones o ubicación...">
                    </div>
                    <div class="flex gap-2">
                        <select id="inventory-type-filter" class="px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white font-semibold text-slate-700 cursor-pointer">
                            <option value="all">Todos los Tipos</option>
                            <option value="lamina">Solo Láminas Completas</option>
                            <option value="retal">Solo Retales Guardados</option>
                        </select>
                        <select id="inventory-material-filter" class="px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white font-semibold text-slate-700 cursor-pointer">
                            <option value="all">Todos los Materiales</option>
                        </select>
                    </div>
                </div>

                <!-- Tabla de Láminas -->
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="border-b border-gray-100 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                <th class="pb-3 px-2 text-center">ID / Ref</th>
                                <th class="pb-3 px-2">Tipo</th>
                                <th class="pb-3 px-2">Material / Referencia</th>
                                <th class="pb-3 px-2">Dimensiones (Ancho x Alto)</th>
                                <th class="pb-3 px-2 text-center">Área Unit.</th>
                                <th class="pb-3 px-2 text-center">Stock Disp.</th>
                                <th class="pb-3 px-2">Ubicación / Notas</th>
                                <th class="pb-3 px-2 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="inventory-table-body" class="divide-y divide-slate-100 text-sm font-semibold text-slate-700">
                            <!-- Poblado dinámicamente -->
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Historial Container -->
        <div id="despiece-history-container" class="hidden bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
            <div class="flex items-center gap-3 border-b border-gray-100 pb-4 mb-4">
                <div class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
                    <i class="fa-solid fa-clock-rotate-left"></i>
                </div>
                <div>
                    <h2 class="text-sm font-bold text-gray-800">Historial de Optimización</h2>
                    <p class="text-[10px] text-gray-500 font-semibold mt-0.5">Consulta y recupera despieces calculados anteriormente.</p>
                </div>
            </div>
            
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="border-b border-gray-100 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                            <th class="pb-3 px-2">Fecha</th>
                            <th class="pb-3 px-2">Cliente / Proyecto</th>
                            <th class="pb-3 px-2">Material</th>
                            <th class="pb-3 px-2">Lámina Base</th>
                            <th class="pb-3 px-2">Piezas</th>
                            <th class="pb-3 px-2 text-center">Láminas Req.</th>
                            <th class="pb-3 px-2 text-center">Aprovechamiento</th>
                            <th class="pb-3 px-2 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="despiece-history-body" class="divide-y divide-slate-100 text-sm font-semibold text-slate-700">
                        <tr>
                            <td colspan="8" class="py-12 text-center text-gray-400">
                                <div class="flex flex-col items-center justify-center space-y-2">
                                    <div class="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center text-gray-300">
                                        <i class="fa-solid fa-spinner animate-spin"></i>
                                    </div>
                                    <p class="text-xs font-semibold text-gray-400">Cargando historial...</p>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Modal Ingresar / Editar Lámina o Retal -->
        <div id="modal-lamina-form" class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
            <div class="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-lg overflow-hidden animate-scale-up">
                <div class="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 flex justify-between items-center text-white">
                    <div class="flex items-center gap-2.5">
                        <i class="fa-solid fa-boxes-stacked text-lg"></i>
                        <h3 id="modal-lamina-title" class="text-base font-bold">Ingresar Lámina o Retal</h3>
                    </div>
                    <button type="button" id="modal-lamina-close-btn" class="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors">
                        <i class="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>
                <form id="form-lamina-item" class="p-6 space-y-4">
                    <input type="hidden" id="form-lamina-id" value="">
                    
                    <!-- Indicador de ID Único de Lámina -->
                    <div id="modal-lamina-id-container" class="bg-indigo-50/70 border border-indigo-200/80 rounded-xl px-4 py-2.5 flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <i class="fa-solid fa-hashtag text-indigo-600 text-sm"></i>
                            <span class="text-xs font-bold text-slate-700">ID / Referencia en Inventario:</span>
                        </div>
                        <span id="modal-lamina-id-badge" class="px-2.5 py-0.5 rounded-lg font-black text-xs bg-indigo-600 text-white">#1 (Automático)</span>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label for="form-lamina-tipo" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tipo de Vidrio</label>
                            <select id="form-lamina-tipo" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white cursor-pointer">
                                <option value="lamina">Lámina Completa (Hoja estándar)</option>
                                <option value="retal">Retal (Sobrante aprovechable)</option>
                            </select>
                        </div>
                        <div>
                            <label for="form-lamina-material" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tipo de Material</label>
                            <input type="text" id="form-lamina-material" list="lamina-material-presets" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white" placeholder="Ej: LAMINADO 3+3" required>
                            <datalist id="lamina-material-presets">
                                <option value="LAMINADO 3+3"></option>
                                <option value="LAMINADO 4+4"></option>
                                <option value="CRUDO 4mm"></option>
                                <option value="CRUDO 5mm"></option>
                                <option value="TEMPLADO 6mm"></option>
                                <option value="TEMPLADO 8mm"></option>
                                <option value="TEMPLADO 10mm"></option>
                                <option value="ESPEJO 4mm"></option>
                            </datalist>
                        </div>
                    </div>

                    <div class="grid grid-cols-3 gap-3">
                        <div>
                            <label for="form-lamina-ancho" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ancho (mm)</label>
                            <input type="number" id="form-lamina-ancho" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white" placeholder="3300" required min="50">
                        </div>
                        <div>
                            <label for="form-lamina-alto" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Alto (mm)</label>
                            <input type="number" id="form-lamina-alto" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white" placeholder="2140" required min="50">
                        </div>
                        <div>
                            <label for="form-lamina-cantidad" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cantidad (uds)</label>
                            <input type="number" id="form-lamina-cantidad" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white" value="1" required min="1">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label for="form-lamina-ubicacion" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ubicación en Bodega</label>
                            <input type="text" id="form-lamina-ubicacion" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white" placeholder="Ej: Caballete 1 / Estante Retales">
                        </div>
                        <div>
                            <label for="form-lamina-color" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Color / Espesor (Opcional)</label>
                            <input type="text" id="form-lamina-color" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white" placeholder="Ej: Incoloro / Bronce">
                        </div>
                    </div>

                    <div>
                        <label for="form-lamina-notas" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Notas Adicionales (Opcional)</label>
                        <textarea id="form-lamina-notas" rows="2" class="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white" placeholder="Detalles de la lámina o procedencia del retal..."></textarea>
                    </div>

                    <div class="pt-3 border-t border-gray-100 flex justify-end gap-2.5">
                        <button type="button" id="modal-lamina-cancel-btn" class="px-4 py-2 border border-gray-200 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-50 transition-colors">
                            Cancelar
                        </button>
                        <button type="submit" id="modal-lamina-save-btn" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-5 rounded-xl text-xs shadow-sm hover:shadow transition-all flex items-center gap-1.5">
                            <i class="fa-solid fa-floppy-disk"></i> Guardar
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Modal Visual Interactivo de Decisión de Desperdicios / Sobrantes -->
        <div id="modal-remnants-visual" class="fixed inset-0 top-0 left-0 w-screen h-screen bg-slate-950/85 backdrop-blur-md z-[99999] hidden flex items-center justify-center p-2 sm:p-4 m-0" style="z-index: 99999; margin: 0; top: 0; left: 0;">
            <div class="bg-white rounded-2xl shadow-2xl border border-slate-300 w-[98vw] max-w-[1550px] h-[95vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <!-- Encabezado del Modal -->
                <div class="px-5 py-3 bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-900 text-white flex justify-between items-center flex-shrink-0 border-b border-indigo-900/50">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white text-lg shadow-md shrink-0">
                            <i class="fa-solid fa-shapes"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2.5">
                                <h3 class="text-base sm:text-lg font-black text-white tracking-wide">Clasificación Visual de Desperdicios y Sobrantes</h3>
                                <span class="bg-emerald-500/25 text-emerald-300 border border-emerald-400/40 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">Interactivo 2D</span>
                            </div>
                            <p class="text-xs text-slate-300 mt-0.5">
                                Clic sobre los sobrantes: <b class="text-emerald-400">🟢 Verde = Se Queda</b> (guarda en inventario sin ID) | <b class="text-rose-400">🔴 Rojo = Se Va</b> (desecho)
                            </p>
                        </div>
                    </div>
                    <button type="button" id="modal-remnants-close-btn" class="text-white/70 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors" title="Cerrar modal">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                <!-- Barra de Navegación entre Láminas, Info de Lámina y Acciones Rápidas -->
                <div class="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3 flex-shrink-0">
                    <!-- Selector y Navegador de Láminas -->
                    <div class="flex items-center gap-2 max-w-full sm:max-w-[65%] min-w-0">
                        <div class="flex items-center gap-1 shrink-0 bg-white border border-slate-300 rounded-xl p-0.5 shadow-sm">
                            <button type="button" id="modal-remnants-prev-btn" class="p-2 rounded-lg text-slate-700 hover:bg-slate-100 hover:text-indigo-600 transition flex items-center justify-center" title="Lámina anterior">
                                <i class="fa-solid fa-chevron-left text-xs"></i>
                            </button>
                            <span id="modal-remnants-sheet-indicator" class="text-xs font-bold text-slate-800 px-2 select-none whitespace-nowrap">
                                Lámina 1 de 1
                            </span>
                            <button type="button" id="modal-remnants-next-btn" class="p-2 rounded-lg text-slate-700 hover:bg-slate-100 hover:text-indigo-600 transition flex items-center justify-center" title="Lámina siguiente">
                                <i class="fa-solid fa-chevron-right text-xs"></i>
                            </button>
                        </div>

                        <!-- Badge con dimensiones de la lámina activa -->
                        <div id="modal-remnants-sheet-badge" class="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs font-bold shrink-0">
                            <i class="fa-solid fa-layer-group text-indigo-600"></i>
                            <span id="modal-remnants-sheet-title">3300 x 2200 mm</span>
                        </div>

                        <!-- Carrusel de pestañas horizontales con scroll animado -->
                        <div class="relative flex items-center min-w-0 max-w-full sm:max-w-xs md:max-w-sm lg:max-w-md xl:max-w-lg bg-slate-100/90 rounded-xl p-1 border border-slate-200">
                            <!-- Botón scroll pestañas izquierda -->
                            <button type="button" id="modal-tabs-scroll-prev" class="w-6 h-7 rounded-lg text-slate-600 hover:text-indigo-600 hover:bg-white transition shrink-0 flex items-center justify-center disabled:opacity-20 disabled:pointer-events-none" title="Ver láminas anteriores">
                                <i class="fa-solid fa-chevron-left text-[10px]"></i>
                            </button>

                            <!-- Contenedor scrollable de pestañas -->
                            <div id="modal-remnants-sheet-tabs" class="flex gap-1.5 items-center overflow-x-auto py-0.5 px-1 scroll-smooth scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden select-none">
                                <!-- Pestañas dinámicas -->
                            </div>

                            <!-- Botón scroll pestañas derecha -->
                            <button type="button" id="modal-tabs-scroll-next" class="w-6 h-7 rounded-lg text-slate-600 hover:text-indigo-600 hover:bg-white transition shrink-0 flex items-center justify-center disabled:opacity-20 disabled:pointer-events-none" title="Ver más láminas">
                                <i class="fa-solid fa-chevron-right text-[10px]"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Botones de Acción Rápida y Controles de Zoom -->
                    <div class="flex items-center gap-2 flex-wrap shrink-0">
                        <!-- Zoom Controls -->
                        <div class="inline-flex items-center bg-white border border-slate-300 rounded-xl p-0.5 shadow-sm text-xs font-bold text-slate-700">
                            <button type="button" id="modal-btn-zoom-out" class="px-2 py-1 hover:bg-slate-100 rounded-lg text-slate-600" title="Alejar zoom">
                                <i class="fa-solid fa-magnifying-glass-minus text-[11px]"></i>
                            </button>
                            <button type="button" id="modal-btn-zoom-reset" class="px-2.5 py-1 hover:bg-slate-100 rounded-lg text-[11px] text-slate-700 font-bold" title="Ajustar al espacio">
                                <span id="modal-zoom-level-text">100%</span>
                            </button>
                            <button type="button" id="modal-btn-zoom-in" class="px-2 py-1 hover:bg-slate-100 rounded-lg text-slate-600" title="Acercar zoom">
                                <i class="fa-solid fa-magnifying-glass-plus text-[11px]"></i>
                            </button>
                        </div>

                        <!-- Botones por lote -->
                        <button type="button" id="modal-btn-all-save" class="text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 shadow-sm">
                            <i class="fa-solid fa-circle-check text-emerald-600"></i> Todos Se Quedan
                        </button>
                        <button type="button" id="modal-btn-all-discard" class="text-xs font-bold text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-300 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 shadow-sm">
                            <i class="fa-solid fa-circle-xmark text-rose-600"></i> Todos Se Van
                        </button>
                        <button type="button" id="modal-btn-auto-suggest" class="text-xs font-bold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-300 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 shadow-sm" title="Guardar útiles (≥250mm) y desechar menores">
                            <i class="fa-solid fa-wand-magic-sparkles text-indigo-600"></i> Sugerir
                        </button>
                    </div>
                </div>

                <!-- Banner de Alerta Dinámica (Piezas sin asignar) -->
                <div id="modal-remnants-alert-banner" class="px-4 py-2 border-b transition-all flex items-center justify-between text-xs font-bold bg-amber-50 text-amber-900 border-amber-300 flex-shrink-0">
                    <div class="flex items-center gap-2.5">
                        <span id="modal-alert-icon"><i class="fa-solid fa-triangle-exclamation text-amber-600 text-sm"></i></span>
                        <span id="modal-alert-text">Haz clic sobre cada sobrante en el plano para definir si se queda o se va.</span>
                    </div>
                    <span id="modal-alert-badge" class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-200 text-amber-900">
                        Pendientes
                    </span>
                </div>

                <!-- Contenedor del Canvas Interactivo 2D (Gran escala, visualización amplia) -->
                <div id="modal-canvas-viewport" class="flex-1 bg-slate-100/90 p-4 sm:p-6 overflow-auto flex items-center justify-center relative min-h-0">
                    <div id="modal-canvas-wrapper" class="relative inline-flex items-center justify-center">
                        <canvas id="modal-remnants-canvas" class="shadow-2xl bg-white rounded-xl border border-slate-300 cursor-pointer block"></canvas>
                        <!-- Tooltip flotante interactivo -->
                        <div id="modal-remnants-tooltip" class="absolute pointer-events-none hidden bg-slate-900/95 text-white text-xs px-3 py-2 rounded-xl shadow-2xl font-medium backdrop-blur-md z-30 transition-opacity duration-150 border border-white/10"></div>
                    </div>
                </div>

                <!-- Barra Inferior de Retales a Guardar (Altura estable para preservar simetría de la lámina) -->
                <div id="modal-remnants-drawer" class="bg-white border-t border-slate-200 px-4 py-2 min-h-[50px] max-h-24 overflow-y-auto flex-shrink-0">
                    <!-- Lista de retales verdes o mensaje de ayuda -->
                </div>

                <!-- Pie del Modal con Métricas y Botón de Confirmación -->
                <div class="px-5 py-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-3 flex-shrink-0">
                    <div class="flex items-center gap-3 text-xs font-bold flex-wrap">
                        <span id="modal-count-save" class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <i class="fa-solid fa-circle-check text-emerald-600"></i> <b>0</b> Se Quedan
                        </span>
                        <span id="modal-count-discard" class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-100 text-rose-800 border border-rose-300">
                            <i class="fa-solid fa-circle-xmark text-rose-600"></i> <b>0</b> Se Van
                        </span>
                        <span id="modal-count-unassigned" class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-200 text-slate-800 border border-slate-300">
                            <i class="fa-solid fa-circle-question text-slate-600"></i> <b>0</b> Sin Asignar
                        </span>
                    </div>

                    <div class="flex items-center gap-3 w-full sm:w-auto justify-end">
                        <button type="button" id="modal-remnants-cancel-btn" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 hover:bg-white transition shadow-sm">
                            Cerrar / Decidir luego
                        </button>
                        <button type="button" id="modal-remnants-confirm-btn" class="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-2.5 px-6 rounded-xl text-xs shadow-md hover:shadow-lg transition flex items-center gap-2">
                            <i class="fa-solid fa-check-double text-sm"></i> Confirmar y Aplicar a Inventario
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
`;
}

function updateGridStatsBadge() {
    const badge = document.getElementById('grid-stats-badge');
    if (!badge) return;
    const valid = piezasList.filter(p => p.w0 > 0 && p.h0 > 0 && p.cant > 0);
    const totalPieces = valid.reduce((sum, p) => sum + (p.cant || 1), 0);
    badge.textContent = `${totalPieces} pieza${totalPieces === 1 ? '' : 's'} • ${valid.length} fila${valid.length === 1 ? '' : 's'}`;
}

function renderPiezasTable(focusTarget = null) {
    const tbody = document.getElementById('piezas-list-body');
    if (!tbody) return;

    // Asegurar que siempre haya filas listas para editar tipo hoja de cálculo
    if (piezasList.length === 0) {
        lastId++;
        piezasList.push({ id: lastId, w0: 0, h0: 0, cant: 1, label: '', hasError: false });
        lastId++;
        piezasList.push({ id: lastId, w0: 0, h0: 0, cant: 1, label: '', hasError: false });
        lastId++;
        piezasList.push({ id: lastId, w0: 0, h0: 0, cant: 1, label: '', hasError: false });
    }

    tbody.innerHTML = piezasList.map((p, rowIdx) => {
        const isError = p.hasError;
        const rowBg = isError
            ? 'bg-rose-50/70 border-rose-300'
            : (rowIdx % 2 === 0 ? 'bg-white hover:bg-indigo-50/20' : 'bg-slate-50/40 hover:bg-indigo-50/20');
        const numColor = isError ? 'text-rose-600 font-black' : 'text-slate-500 font-mono';
        const cellFocusBorder = isError ? 'focus:bg-rose-100/40 focus:ring-rose-500' : 'focus:bg-indigo-50/50 focus:ring-indigo-500';

        return `
        <tr class="transition-colors group ${rowBg}" data-id="${p.id}" data-row="${rowIdx}">
            <!-- N° de fila (estilo Excel) -->
            <td class="text-center font-bold text-xs py-1 px-1 bg-slate-100/70 group-hover:bg-slate-200/60 border-r border-slate-200 select-none ${numColor} grid-row-header cursor-pointer" data-row="${rowIdx}" title="Clic para seleccionar fila ${rowIdx + 1}">
                ${rowIdx + 1}
            </td>

            <!-- Columna 0: Etiqueta -->
            <td class="p-0 border-r border-slate-200 relative grid-cell-td" data-row="${rowIdx}" data-col="0">
                <input type="text"
                       draggable="false"
                       class="grid-cell-input w-full h-full px-2.5 py-2 text-xs font-semibold text-slate-800 bg-transparent outline-none focus:ring-1 ${cellFocusBorder} focus:ring-inset transition-all"
                       value="${p.label || ''}"
                       placeholder="Ej: Ventana..."
                       data-field="label"
                       data-row="${rowIdx}"
                       data-col="0"
                       data-id="${p.id}">
            </td>

            <!-- Columna 1: Ancho (mm) -->
            <td class="p-0 border-r border-slate-200 relative grid-cell-td" data-row="${rowIdx}" data-col="1">
                <input type="number"
                       draggable="false"
                       class="grid-cell-input w-full h-full px-2.5 py-2 text-xs font-bold text-slate-800 bg-transparent outline-none focus:ring-1 ${cellFocusBorder} focus:ring-inset transition-all text-right pr-3"
                       value="${p.w0 > 0 ? p.w0 : ''}"
                       placeholder="1200"
                       min="1"
                       data-field="w0"
                       data-row="${rowIdx}"
                       data-col="1"
                       data-id="${p.id}">
            </td>

            <!-- Columna 2: Alto (mm) -->
            <td class="p-0 border-r border-slate-200 relative grid-cell-td" data-row="${rowIdx}" data-col="2">
                <input type="number"
                       draggable="false"
                       class="grid-cell-input w-full h-full px-2.5 py-2 text-xs font-bold text-slate-800 bg-transparent outline-none focus:ring-1 ${cellFocusBorder} focus:ring-inset transition-all text-right pr-3"
                       value="${p.h0 > 0 ? p.h0 : ''}"
                       placeholder="800"
                       min="1"
                       data-field="h0"
                       data-row="${rowIdx}"
                       data-col="2"
                       data-id="${p.id}">
            </td>

            <!-- Columna 3: Cantidad -->
            <td class="p-0 border-r border-slate-200 relative grid-cell-td" data-row="${rowIdx}" data-col="3">
                <input type="number"
                       draggable="false"
                       class="grid-cell-input w-full h-full px-2.5 py-2 text-xs font-bold text-slate-800 bg-transparent outline-none focus:ring-1 ${cellFocusBorder} focus:ring-inset transition-all text-right pr-3"
                       value="${p.cant || 1}"
                       placeholder="1"
                       min="1"
                       data-field="cant"
                       data-row="${rowIdx}"
                       data-col="3"
                       data-id="${p.id}">
            </td>

            <!-- Acciones de fila -->
            <td class="py-1 px-1.5 text-center whitespace-nowrap select-none">
                <button type="button" class="grid-dup-btn text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 p-1.5 rounded-lg transition" data-id="${p.id}" title="Duplicar fila">
                    <i class="fa-solid fa-copy text-xs pointer-events-none"></i>
                </button>
                <button type="button" class="grid-del-btn text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg transition ml-0.5" data-id="${p.id}" title="Eliminar fila">
                    <i class="fa-solid fa-trash-can text-xs pointer-events-none"></i>
                </button>
            </td>
        </tr>
        `;
    }).join('');

    updateGridStatsBadge();

    // Eventos de los inputs de la tabla (Sincronización en tiempo real y teclado)
    const inputs = tbody.querySelectorAll('.grid-cell-input');

    inputs.forEach(input => {
        // Prevenir arrastre de texto nativo que desplace texto en vez de seleccionar celdas
        input.setAttribute('draggable', 'false');
        input.addEventListener('dragstart', (e) => {
            e.preventDefault();
            return false;
        });

        // Al recibir foco, seleccionar texto solo si no fue por clic de ratón (ej: Tab, Enter, Flechas)
        input.addEventListener('focus', () => {
            if (!gridSelection.isMouseDown) {
                input.select();
            }
            const row = parseInt(input.dataset.row);
            const col = parseInt(input.dataset.col);
            if (!gridSelection.isSelecting && !gridSelection.isFilling) {
                const b = getSelectionBounds();
                if (!b || (b.minRow === b.maxRow && b.minCol === b.maxCol)) {
                    gridSelection.startRow = row;
                    gridSelection.startCol = col;
                    gridSelection.endRow = row;
                    gridSelection.endCol = col;
                    updateGridSelectionVisual();
                }
            }
        });

        // Actualización de datos en tiempo real al escribir
        input.addEventListener('input', () => {
            const id = parseInt(input.dataset.id);
            const field = input.dataset.field;
            const item = piezasList.find(p => p.id === id);
            if (!item) return;

            if (field === 'label') {
                item.label = input.value.trim();
            } else if (field === 'w0') {
                item.w0 = parseInt(input.value) || 0;
            } else if (field === 'h0') {
                item.h0 = parseInt(input.value) || 0;
            } else if (field === 'cant') {
                item.cant = Math.max(1, parseInt(input.value) || 1);
            }

            if (item.hasError) {
                item.hasError = false;
                const row = input.closest('tr');
                if (row) {
                    row.classList.remove('bg-rose-50/70', 'border-rose-300');
                }
            }

            updateGridStatsBadge();
        });

        // Navegación por Teclado Estilo Excel (Flechas, Enter, Tab)
        input.addEventListener('keydown', (e) => {
            const rowIdx = parseInt(input.dataset.row);
            const colIdx = parseInt(input.dataset.col);
            const totalRows = piezasList.length;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (rowIdx < totalRows - 1) {
                    const nextInput = tbody.querySelector(`.grid-cell-input[data-row="${rowIdx + 1}"][data-col="${colIdx}"]`);
                    if (nextInput) { nextInput.focus(); nextInput.select(); }
                } else {
                    // Si estamos en la última fila y tiene datos, crear automáticamente una nueva fila
                    const curItem = piezasList[rowIdx];
                    if (curItem && (curItem.w0 > 0 || curItem.h0 > 0 || curItem.label)) {
                        addNewPiezaRow(colIdx === 0 ? 'label' : (colIdx === 1 ? 'w0' : (colIdx === 2 ? 'h0' : 'cant')));
                    }
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (rowIdx > 0) {
                    const prevInput = tbody.querySelector(`.grid-cell-input[data-row="${rowIdx - 1}"][data-col="${colIdx}"]`);
                    if (prevInput) { prevInput.focus(); prevInput.select(); }
                }
            } else if (e.key === 'ArrowRight') {
                // Si el cursor está al final del texto o todo está seleccionado o es campo numérico
                const isAtEnd = input.selectionEnd === input.value.length;
                if (isAtEnd || (input.selectionStart === 0 && input.selectionEnd === input.value.length) || input.type === 'number') {
                    if (colIdx < 3) {
                        e.preventDefault();
                        const nextColInput = tbody.querySelector(`.grid-cell-input[data-row="${rowIdx}"][data-col="${colIdx + 1}"]`);
                        if (nextColInput) { nextColInput.focus(); nextColInput.select(); }
                    }
                }
            } else if (e.key === 'ArrowLeft') {
                // Si el cursor está al inicio del texto o todo está seleccionado o es campo numérico
                const isAtStart = input.selectionStart === 0;
                if (isAtStart || (input.selectionStart === 0 && input.selectionEnd === input.value.length) || input.type === 'number') {
                    if (colIdx > 0) {
                        e.preventDefault();
                        const prevColInput = tbody.querySelector(`.grid-cell-input[data-row="${rowIdx}"][data-col="${colIdx - 1}"]`);
                        if (prevColInput) { prevColInput.focus(); prevColInput.select(); }
                    }
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (rowIdx < totalRows - 1) {
                    const nextInput = tbody.querySelector(`.grid-cell-input[data-row="${rowIdx + 1}"][data-col="${colIdx}"]`);
                    if (nextInput) { nextInput.focus(); nextInput.select(); }
                } else {
                    // Última fila -> agregar fila nueva y enfocar Ancho (col 1)
                    addNewPiezaRow('w0');
                }
            } else if (e.key === 'Tab' && !e.shiftKey) {
                if (colIdx === 3 && rowIdx === totalRows - 1) {
                    // Tab en la última celda de la última fila -> agregar nueva fila automáticamente
                    e.preventDefault();
                    addNewPiezaRow('w0');
                }
            }
        });
    });

    // Eventos de botones de fila: Duplicar y Eliminar
    tbody.querySelectorAll('.grid-dup-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id);
            duplicatePiezaRow(id);
        });
    });

    tbody.querySelectorAll('.grid-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id);
            deletePiezaRow(id);
        });
    });

    // Enfoque programático si se solicitó (ej: tras agregar fila o importar)
    if (focusTarget) {
        setTimeout(() => {
            const target = tbody.querySelector(focusTarget);
            if (target) {
                target.focus();
                target.select();
                target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 30);
    }

    attachGridSelectionListeners();
    updateGridSelectionVisual();
}

function addNewPiezaRow(focusField = 'w0') {
    activeHistoryId = null;
    lastId++;
    piezasList.push({ id: lastId, w0: 0, h0: 0, cant: 1, label: '', hasError: false });
    const colIdx = focusField === 'label' ? 0 : (focusField === 'w0' ? 1 : (focusField === 'h0' ? 2 : 3));
    const newRowIdx = piezasList.length - 1;
    renderPiezasTable(`.grid-cell-input[data-row="${newRowIdx}"][data-col="${colIdx}"]`);
}

function duplicatePiezaRow(id) {
    const idx = piezasList.findIndex(p => p.id === id);
    if (idx === -1) return;
    const source = piezasList[idx];
    lastId++;
    const cloned = {
        id: lastId,
        w0: source.w0,
        h0: source.h0,
        cant: source.cant,
        label: source.label ? `${source.label} (copia)` : '',
        hasError: false
    };
    piezasList.splice(idx + 1, 0, cloned);
    renderPiezasTable(`.grid-cell-input[data-row="${idx + 1}"][data-col="1"]`);
    if (window.showToast) {
        window.showToast("Fila duplicada.", "info");
    }
}

function deletePiezaRow(id) {
    piezasList = piezasList.filter(p => p.id !== id);
    if (piezasList.length === 0) {
        lastId++;
        piezasList.push({ id: lastId, w0: 0, h0: 0, cant: 1, label: '', hasError: false });
    }
    renderPiezasTable();
}

// ------------------------------------------------------------
// GESTIÓN DE SELECCIÓN DE CUADRÍCULA Y AUTORRELLENO TIPO EXCEL
// ------------------------------------------------------------

function initGridSelectionStyles() {
    if (document.getElementById('despiece-grid-selection-styles')) return;
    const style = document.createElement('style');
    style.id = 'despiece-grid-selection-styles';
    style.textContent = `
        .grid-cell-td {
            position: relative;
        }
        .grid-cell-td.cell-selected {
            background-color: rgba(99, 102, 241, 0.12) !important;
        }
        .grid-cell-td.range-top {
            border-top: 2px solid #4f46e5 !important;
        }
        .grid-cell-td.range-bottom {
            border-bottom: 2px solid #4f46e5 !important;
        }
        .grid-cell-td.range-left {
            border-left: 2px solid #4f46e5 !important;
        }
        .grid-cell-td.range-right {
            border-right: 2px solid #4f46e5 !important;
        }
        .grid-fill-handle {
            position: absolute;
            bottom: -3px;
            right: -3px;
            width: 7px;
            height: 7px;
            background-color: #4f46e5;
            border: 1px solid #ffffff;
            cursor: crosshair;
            z-index: 30;
            box-shadow: 0 1px 2px rgba(0,0,0,0.25);
            transition: transform 0.1s ease;
        }
        .grid-fill-handle:hover {
            transform: scale(1.35);
            background-color: #3730a3;
        }
        .grid-cell-td.fill-preview {
            outline: 2px dashed #4f46e5 !important;
            outline-offset: -2px;
            background-color: rgba(99, 102, 241, 0.18) !important;
        }
        .grid-header-selected {
            background-color: #e0e7ff !important;
            color: #3730a3 !important;
        }
        .grid-row-header-selected {
            background-color: #e0e7ff !important;
            color: #3730a3 !important;
            font-weight: 900 !important;
        }
        #despiece-excel-grid.is-filling-active {
            user-select: none;
            cursor: crosshair !important;
        }
        #despiece-excel-grid.is-selecting-active {
            user-select: none;
        }
        #despiece-excel-grid.is-selecting-active input {
            user-select: none !important;
            pointer-events: none !important;
        }
        #despiece-excel-grid.is-filling-active input {
            user-select: none !important;
            pointer-events: none !important;
        }
        .grid-cell-input {
            user-select: text;
        }
    `;
    document.head.appendChild(style);
}

function getSelectionBounds() {
    if (gridSelection.startRow === null || gridSelection.startCol === null) return null;
    const minRow = Math.max(0, Math.min(gridSelection.startRow, gridSelection.endRow !== null ? gridSelection.endRow : gridSelection.startRow));
    const maxRow = Math.min(Math.max(0, piezasList.length - 1), Math.max(gridSelection.startRow, gridSelection.endRow !== null ? gridSelection.endRow : gridSelection.startRow));
    const minCol = Math.max(0, Math.min(gridSelection.startCol, gridSelection.endCol !== null ? gridSelection.endCol : gridSelection.startCol));
    const maxCol = Math.min(3, Math.max(gridSelection.startCol, gridSelection.endCol !== null ? gridSelection.endCol : gridSelection.startCol));
    return { minRow, maxRow, minCol, maxCol };
}

function updateGridSelectionVisual() {
    const table = document.getElementById('despiece-excel-grid');
    if (!table) return;

    // Limpiar clases anteriores
    table.querySelectorAll('.cell-selected, .range-top, .range-bottom, .range-left, .range-right').forEach(el => {
        el.classList.remove('cell-selected', 'range-top', 'range-bottom', 'range-left', 'range-right');
    });
    table.querySelectorAll('.grid-header-selected').forEach(el => el.classList.remove('grid-header-selected'));
    table.querySelectorAll('.grid-row-header-selected').forEach(el => el.classList.remove('grid-row-header-selected'));

    const oldHandle = document.getElementById('grid-fill-handle');
    if (oldHandle) oldHandle.remove();

    const bounds = getSelectionBounds();
    if (!bounds) return;

    const { minRow, maxRow, minCol, maxCol } = bounds;

    // Resaltar celdas en el rango
    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            const td = table.querySelector(`td.grid-cell-td[data-row="${r}"][data-col="${c}"]`);
            if (td) {
                td.classList.add('cell-selected');
                if (r === minRow) td.classList.add('range-top');
                if (r === maxRow) td.classList.add('range-bottom');
                if (c === minCol) td.classList.add('range-left');
                if (c === maxCol) td.classList.add('range-right');
            }
        }
        // Resaltar encabezado de fila
        const rowHeader = table.querySelector(`td.grid-row-header[data-row="${r}"]`);
        if (rowHeader) rowHeader.classList.add('grid-row-header-selected');
    }

    // Resaltar encabezados de columna si abarcan todas las filas
    if (minRow === 0 && maxRow === piezasList.length - 1) {
        for (let c = minCol; c <= maxCol; c++) {
            const colHeader = table.querySelector(`th.grid-col-header[data-col="${c}"]`);
            if (colHeader) colHeader.classList.add('grid-header-selected');
        }
    }

    // Añadir el Fill Handle en la esquina inferior derecha (maxRow, maxCol)
    const brTd = table.querySelector(`td.grid-cell-td[data-row="${maxRow}"][data-col="${maxCol}"]`);
    if (brTd) {
        const handle = document.createElement('div');
        handle.id = 'grid-fill-handle';
        handle.className = 'grid-fill-handle';
        handle.title = 'Arrastrar para autorrellenar';
        handle.onmousedown = (e) => {
            e.stopPropagation();
            e.preventDefault();
            gridSelection.isFilling = true;
            gridSelection.fillEndRow = maxRow;
            gridSelection.fillEndCol = maxCol;
            const gridTable = document.getElementById('despiece-excel-grid');
            if (gridTable) gridTable.classList.add('is-filling-active');
        };
        brTd.appendChild(handle);
    }
}

function updateFillPreviewVisual() {
    const table = document.getElementById('despiece-excel-grid');
    if (!table) return;

    table.querySelectorAll('.fill-preview').forEach(el => el.classList.remove('fill-preview'));
    const oldFloat = document.getElementById('grid-fill-floating-badge');
    if (oldFloat) oldFloat.remove();

    if (!gridSelection.isFilling) return;

    const bounds = getSelectionBounds();
    if (!bounds) return;

    const { minRow, maxRow, minCol, maxCol } = bounds;
    const endRow = gridSelection.fillEndRow !== null ? gridSelection.fillEndRow : maxRow;
    const endCol = gridSelection.fillEndCol !== null ? gridSelection.fillEndCol : maxCol;

    // Arrastre hacia abajo
    if (endRow > maxRow) {
        const clampRow = Math.min(piezasList.length - 1, endRow);
        for (let r = maxRow + 1; r <= clampRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const td = table.querySelector(`td.grid-cell-td[data-row="${r}"][data-col="${c}"]`);
                if (td) td.classList.add('fill-preview');
            }
        }

        // Si se arrastra más allá de las filas actuales, mostrar badge flotante
        if (endRow >= piezasList.length) {
            const extra = endRow - piezasList.length + 1;
            const lastTd = table.querySelector(`td.grid-cell-td[data-row="${piezasList.length - 1}"][data-col="${maxCol}"]`);
            if (lastTd) {
                const badge = document.createElement('div');
                badge.id = 'grid-fill-floating-badge';
                badge.className = 'absolute -bottom-8 right-0 bg-indigo-600 text-white font-bold text-[10px] px-2 py-0.5 rounded shadow-lg z-40 pointer-events-none whitespace-nowrap animate-bounce';
                badge.textContent = `+${extra} fila(s) nueva(s)`;
                lastTd.appendChild(badge);
            }
        }
    } else if (endRow < minRow && endRow >= 0) {
        // Arrastre hacia arriba
        for (let r = endRow; r < minRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const td = table.querySelector(`td.grid-cell-td[data-row="${r}"][data-col="${c}"]`);
                if (td) td.classList.add('fill-preview');
            }
        }
    } else if (endCol > maxCol && endCol <= 3) {
        // Arrastre hacia la derecha
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = maxCol + 1; c <= endCol; c++) {
                const td = table.querySelector(`td.grid-cell-td[data-row="${r}"][data-col="${c}"]`);
                if (td) td.classList.add('fill-preview');
            }
        }
    }
}

function executeAutofill() {
    const bounds = getSelectionBounds();
    if (!bounds) return;
    const { minRow, maxRow, minCol, maxCol } = bounds;
    const targetRow = gridSelection.fillEndRow;
    const targetCol = gridSelection.fillEndCol;

    if (targetRow === null && targetCol === null) return;

    // Arrastre hacia abajo
    if (targetRow !== null && targetRow > maxRow) {
        const srcCount = maxRow - minRow + 1;
        while (piezasList.length <= targetRow) {
            lastId++;
            piezasList.push({ id: lastId, w0: 0, h0: 0, cant: 1, label: '', hasError: false });
        }

        for (let r = maxRow + 1; r <= targetRow; r++) {
            const srcIdx = minRow + ((r - maxRow - 1) % srcCount);
            const src = piezasList[srcIdx];
            for (let c = minCol; c <= maxCol; c++) {
                if (c === 0) piezasList[r].label = src.label || '';
                else if (c === 1) piezasList[r].w0 = src.w0 || 0;
                else if (c === 2) piezasList[r].h0 = src.h0 || 0;
                else if (c === 3) piezasList[r].cant = src.cant || 1;
            }
            piezasList[r].hasError = false;
        }

        gridSelection.endRow = targetRow;
        renderPiezasTable();
        if (window.showToast) window.showToast(`✨ Se autorrellenaron ${targetRow - maxRow} fila(s).`, 'success');
        return;
    }

    // Arrastre hacia la derecha (entre columnas dentro del rango de filas)
    if (targetCol !== null && targetCol > maxCol && targetCol <= 3) {
        const srcColCount = maxCol - minCol + 1;
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = maxCol + 1; c <= targetCol; c++) {
                const srcCol = minCol + ((c - maxCol - 1) % srcColCount);
                if (c === 1 && srcCol === 2) piezasList[r].w0 = piezasList[r].h0;
                else if (c === 2 && srcCol === 1) piezasList[r].h0 = piezasList[r].w0;
                else if (c === 3) piezasList[r].cant = piezasList[r].cant;
            }
        }
        gridSelection.endCol = targetCol;
        renderPiezasTable();
        return;
    }

    // Arrastre hacia arriba
    if (targetRow !== null && targetRow < minRow && targetRow >= 0) {
        const srcCount = maxRow - minRow + 1;
        for (let r = minRow - 1; r >= targetRow; r--) {
            const srcIdx = maxRow - ((minRow - 1 - r) % srcCount);
            const src = piezasList[srcIdx];
            for (let c = minCol; c <= maxCol; c++) {
                if (c === 0) piezasList[r].label = src.label || '';
                else if (c === 1) piezasList[r].w0 = src.w0 || 0;
                else if (c === 2) piezasList[r].h0 = src.h0 || 0;
                else if (c === 3) piezasList[r].cant = src.cant || 1;
            }
            piezasList[r].hasError = false;
        }
        gridSelection.startRow = targetRow;
        renderPiezasTable();
    }
}

function attachGridSelectionListeners() {
    initGridSelectionStyles();
    const table = document.getElementById('despiece-excel-grid');
    if (!table) return;

    // Prevenir arrastre de texto nativo de HTML dentro de la tabla
    table.ondragstart = (e) => {
        e.preventDefault();
        return false;
    };
    table.ondrop = (e) => {
        if (e.target && e.target.classList.contains('grid-cell-input')) {
            e.preventDefault();
        }
    };

    // 1. Column headers click & drag selection
    table.querySelectorAll('th.grid-col-header').forEach(th => {
        th.onmousedown = (e) => {
            e.preventDefault();
            const col = parseInt(th.dataset.col);
            gridSelection.isMouseDown = true;
            gridSelection.isSelecting = true;
            gridSelection.dragStartX = e.clientX;
            gridSelection.dragStartY = e.clientY;
            gridSelection.startRow = 0;
            gridSelection.startCol = col;
            gridSelection.endRow = Math.max(0, piezasList.length - 1);
            gridSelection.endCol = col;
            updateGridSelectionVisual();
        };
    });

    // 2. Select All header '#'
    const selectAllTh = document.getElementById('grid-select-all-header');
    if (selectAllTh) {
        selectAllTh.onclick = () => {
            gridSelection.startRow = 0;
            gridSelection.startCol = 0;
            gridSelection.endRow = Math.max(0, piezasList.length - 1);
            gridSelection.endCol = 3;
            updateGridSelectionVisual();
        };
    }

    // 3. Row headers click & drag selection
    table.querySelectorAll('td.grid-row-header').forEach(td => {
        td.onmousedown = (e) => {
            e.preventDefault();
            const row = parseInt(td.dataset.row);
            gridSelection.isMouseDown = true;
            gridSelection.isSelecting = true;
            gridSelection.dragStartX = e.clientX;
            gridSelection.dragStartY = e.clientY;
            gridSelection.startRow = row;
            gridSelection.startCol = 0;
            gridSelection.endRow = row;
            gridSelection.endCol = 3;
            updateGridSelectionVisual();
        };
    });

    // 4. Cells selection
    table.querySelectorAll('td.grid-cell-td').forEach(td => {
        const row = parseInt(td.dataset.row);
        const col = parseInt(td.dataset.col);

        td.onmousedown = (e) => {
            if (e.target.id === 'grid-fill-handle') return;

            if (e.shiftKey && gridSelection.startRow !== null) {
                e.preventDefault();
                gridSelection.endRow = row;
                gridSelection.endCol = col;
                updateGridSelectionVisual();
            } else {
                gridSelection.isMouseDown = true;
                gridSelection.dragStartX = e.clientX;
                gridSelection.dragStartY = e.clientY;
                gridSelection.startRow = row;
                gridSelection.startCol = col;
                gridSelection.endRow = row;
                gridSelection.endCol = col;
                updateGridSelectionVisual();
            }
        };
    });

    // Listeners globales en window (solo una vez)
    if (!isGridEventsBound) {
        isGridEventsBound = true;

        window.addEventListener('mouseup', () => {
            gridSelection.isMouseDown = false;
            const gridTable = document.getElementById('despiece-excel-grid');

            if (gridSelection.isFilling) {
                gridSelection.isFilling = false;
                executeAutofill();
                updateFillPreviewVisual();
                if (gridTable) {
                    gridTable.classList.remove('is-filling-active');
                }
            }
            if (gridSelection.isSelecting) {
                gridSelection.isSelecting = false;
                if (gridTable) {
                    gridTable.classList.remove('is-selecting-active');
                }
            }
        });

        window.addEventListener('mousemove', (e) => {
            const gridTable = document.getElementById('despiece-excel-grid');
            if (!gridTable) return;

            // A. Arrastre de Autorrelleno (Fill handle)
            if (gridSelection.isFilling) {
                gridTable.classList.add('is-filling-active');

                const tbody = document.getElementById('piezas-list-body');
                if (tbody && tbody.lastElementChild) {
                    const rect = tbody.lastElementChild.getBoundingClientRect();
                    if (e.clientY > rect.bottom) {
                        const rowHeight = rect.height || 36;
                        const extra = Math.min(50, Math.ceil((e.clientY - rect.bottom) / rowHeight));
                        gridSelection.fillEndRow = (piezasList.length - 1) + extra;
                        updateFillPreviewVisual();
                        return;
                    }
                }

                const el = document.elementFromPoint(e.clientX, e.clientY);
                const td = el ? el.closest('td.grid-cell-td') : null;
                if (td) {
                    const r = parseInt(td.dataset.row);
                    const c = parseInt(td.dataset.col);
                    if (!isNaN(r) && !isNaN(c)) {
                        if (gridSelection.fillEndRow !== r || gridSelection.fillEndCol !== c) {
                            gridSelection.fillEndRow = r;
                            gridSelection.fillEndCol = c;
                            updateFillPreviewVisual();
                        }
                    }
                }
                return;
            }

            // B. Arrastre de Selección de Celdas (Range selection estilo Excel)
            if (gridSelection.isMouseDown) {
                const dist = Math.hypot(e.clientX - gridSelection.dragStartX, e.clientY - gridSelection.dragStartY);

                if (dist > 4 || gridSelection.isSelecting) {
                    gridSelection.isSelecting = true;
                    gridTable.classList.add('is-selecting-active');

                    // Desenfocar input y limpiar cualquier selección nativa de texto
                    if (document.activeElement && document.activeElement.classList.contains('grid-cell-input')) {
                        document.activeElement.blur();
                    }
                    if (window.getSelection) {
                        window.getSelection().removeAllRanges();
                    }

                    // Límites superior e inferior del listado de piezas si el cursor se sale
                    const tbody = document.getElementById('piezas-list-body');
                    if (tbody && tbody.firstElementChild && tbody.lastElementChild) {
                        const firstRect = tbody.firstElementChild.getBoundingClientRect();
                        const lastRect = tbody.lastElementChild.getBoundingClientRect();
                        if (e.clientY < firstRect.top) {
                            if (gridSelection.endRow !== 0) {
                                gridSelection.endRow = 0;
                                updateGridSelectionVisual();
                            }
                            return;
                        } else if (e.clientY > lastRect.bottom) {
                            const lastRowIdx = Math.max(0, piezasList.length - 1);
                            if (gridSelection.endRow !== lastRowIdx) {
                                gridSelection.endRow = lastRowIdx;
                                updateGridSelectionVisual();
                            }
                            return;
                        }
                    }

                    const el = document.elementFromPoint(e.clientX, e.clientY);
                    if (el) {
                        const td = el.closest('td.grid-cell-td');
                        if (td) {
                            const r = parseInt(td.dataset.row);
                            const c = parseInt(td.dataset.col);
                            if (!isNaN(r) && !isNaN(c)) {
                                if (gridSelection.endRow !== r || gridSelection.endCol !== c) {
                                    gridSelection.endRow = r;
                                    gridSelection.endCol = c;
                                    updateGridSelectionVisual();
                                }
                            }
                        } else {
                            const th = el.closest('th.grid-col-header');
                            if (th && gridSelection.startRow === 0) {
                                const c = parseInt(th.dataset.col);
                                if (!isNaN(c) && gridSelection.endCol !== c) {
                                    gridSelection.endCol = c;
                                    updateGridSelectionVisual();
                                }
                            } else {
                                const rowH = el.closest('td.grid-row-header');
                                if (rowH && gridSelection.startCol === 0) {
                                    const r = parseInt(rowH.dataset.row);
                                    if (!isNaN(r) && gridSelection.endRow !== r) {
                                        gridSelection.endRow = r;
                                        updateGridSelectionVisual();
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        const container = document.getElementById('despiece-grid-container');
        if (container) {
            container.addEventListener('keydown', handleGridKeydown);
        }
    }
}

function handleGridKeydown(e) {
    // 1. Ctrl+C: copiar selección
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const bounds = getSelectionBounds();
        if (bounds && (bounds.maxRow > bounds.minRow || bounds.maxCol > bounds.minCol)) {
            const activeInput = document.activeElement;
            const hasTextSelected = activeInput && activeInput.selectionStart !== activeInput.selectionEnd;
            if (!hasTextSelected) {
                e.preventDefault();
                copySelectedRangeToClipboard(bounds);
                return;
            }
        }
    }

    // 2. Delete / Supr: limpiar contenido de celdas seleccionadas
    if (e.key === 'Delete') {
        const bounds = getSelectionBounds();
        if (bounds && (bounds.maxRow > bounds.minRow || bounds.maxCol > bounds.minCol)) {
            e.preventDefault();
            for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
                for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                    if (c === 0) piezasList[r].label = '';
                    else if (c === 1) piezasList[r].w0 = 0;
                    else if (c === 2) piezasList[r].h0 = 0;
                    else if (c === 3) piezasList[r].cant = 1;
                }
                piezasList[r].hasError = false;
            }
            renderPiezasTable();
            if (window.showToast) window.showToast("Celdas seleccionadas vaciadas.", "info");
            return;
        }
    }

    // 3. Escape: desmarcar rango seleccionado
    if (e.key === 'Escape') {
        gridSelection.startRow = null;
        gridSelection.startCol = null;
        gridSelection.endRow = null;
        gridSelection.endCol = null;
        updateGridSelectionVisual();
        return;
    }

    // 4. Shift + Flechas: extender rango de selección
    if (e.shiftKey && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (gridSelection.startRow === null) {
            const activeInput = document.activeElement?.closest?.('.grid-cell-input');
            if (activeInput) {
                gridSelection.startRow = parseInt(activeInput.dataset.row) || 0;
                gridSelection.startCol = parseInt(activeInput.dataset.col) || 0;
                gridSelection.endRow = gridSelection.startRow;
                gridSelection.endCol = gridSelection.startCol;
            } else {
                return;
            }
        }
        e.preventDefault();
        if (e.key === 'ArrowDown') {
            gridSelection.endRow = Math.min(piezasList.length - 1, (gridSelection.endRow ?? gridSelection.startRow) + 1);
        } else if (e.key === 'ArrowUp') {
            gridSelection.endRow = Math.max(0, (gridSelection.endRow ?? gridSelection.startRow) - 1);
        } else if (e.key === 'ArrowRight') {
            gridSelection.endCol = Math.min(3, (gridSelection.endCol ?? gridSelection.startCol) + 1);
        } else if (e.key === 'ArrowLeft') {
            gridSelection.endCol = Math.max(0, (gridSelection.endCol ?? gridSelection.startCol) - 1);
        }
        updateGridSelectionVisual();
    }
}

function copySelectedRangeToClipboard(bounds) {
    if (!bounds) bounds = getSelectionBounds();
    if (!bounds) return;

    const { minRow, maxRow, minCol, maxCol } = bounds;
    const lines = [];

    for (let r = minRow; r <= maxRow; r++) {
        const p = piezasList[r];
        if (!p) continue;
        const rowVals = [];
        for (let c = minCol; c <= maxCol; c++) {
            if (c === 0) rowVals.push(p.label || '');
            else if (c === 1) rowVals.push(p.w0 > 0 ? p.w0 : '');
            else if (c === 2) rowVals.push(p.h0 > 0 ? p.h0 : '');
            else if (c === 3) rowVals.push(p.cant || 1);
        }
        lines.push(rowVals.join('\t'));
    }

    const tsv = lines.join('\r\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tsv).then(() => {
            const rowsCount = maxRow - minRow + 1;
            const colsCount = maxCol - minCol + 1;
            if (window.showToast) {
                window.showToast(`📋 Rango copiado (${rowsCount} × ${colsCount} celdas) para pegar en Excel con Ctrl+V.`, "success");
            }
        }).catch(() => {
            prompt("Copia las celdas seleccionadas:", tsv);
        });
    } else {
        prompt("Copia las celdas seleccionadas:", tsv);
    }
}

function copyPiezasTableToClipboard() {
    const bounds = getSelectionBounds();
    if (bounds && (bounds.maxRow > bounds.minRow || bounds.maxCol > bounds.minCol)) {
        copySelectedRangeToClipboard(bounds);
        return;
    }

    const valid = piezasList.filter(p => p.w0 > 0 && p.h0 > 0 && p.cant > 0);
    if (valid.length === 0) {
        if (window.showToast) window.showToast("No hay medidas válidas para copiar.", "warning");
        else alert("No hay medidas válidas para copiar.");
        return;
    }

    const rows = [
        ["Etiqueta", "Ancho (mm)", "Alto (mm)", "Cantidad"].join('\t'),
        ...valid.map(p => [p.label || 'Vidrio', p.w0, p.h0, p.cant].join('\t'))
    ];
    const tsv = rows.join('\r\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tsv).then(() => {
            if (window.showToast) window.showToast(`📋 Se copiaron ${valid.length} filas al portapapeles. ¡Pégalas en Excel con Ctrl+V!`, "success");
            else alert(`Se copiaron ${valid.length} filas al portapapeles.`);
        }).catch(err => {
            console.error(err);
            prompt("Copia las medidas:", tsv);
        });
    } else {
        prompt("Copia las medidas:", tsv);
    }
}

function parseExcelClipboardData(text) {
    if (!text || typeof text !== 'string') return [];
    const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return [];

    const rows = [];
    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        let cols = [];
        if (rawLine.includes('\t')) {
            cols = rawLine.split('\t').map(c => c.trim());
        } else if (rawLine.includes(';') && !rawLine.includes('\t')) {
            cols = rawLine.split(';').map(c => c.trim());
        } else if (rawLine.includes(',') && !rawLine.includes('\t')) {
            cols = rawLine.split(',').map(c => c.trim());
        } else {
            cols = rawLine.split(/\s+/).map(c => c.trim());
        }

        // Detectar si la primera fila es encabezado
        if (i === 0) {
            const joinedLower = cols.join(' ').toLowerCase();
            if (
                joinedLower.includes('ancho') ||
                joinedLower.includes('alto') ||
                joinedLower.includes('width') ||
                joinedLower.includes('height') ||
                joinedLower.includes('etiqueta') ||
                joinedLower.includes('label') ||
                joinedLower.includes('cant')
            ) {
                continue; // Saltar encabezado
            }
        }

        let label = '';
        let w = 0;
        let h = 0;
        let cant = 1;

        if (cols.length >= 4) {
            const col0Num = parseFloat(cols[0].replace(/[^0-9.]/g, ''));
            const col1Num = parseFloat(cols[1].replace(/[^0-9.]/g, ''));
            const col2Num = parseFloat(cols[2].replace(/[^0-9.]/g, ''));
            const col3Num = parseFloat(cols[3].replace(/[^0-9.]/g, ''));

            if (isNaN(col0Num) || isNaN(parseInt(cols[0]))) {
                // [Etiqueta, Ancho, Alto, Cantidad]
                label = cols[0];
                w = Math.round(col1Num) || 0;
                h = Math.round(col2Num) || 0;
                cant = Math.round(col3Num) || 1;
            } else if (isNaN(col3Num) || isNaN(parseInt(cols[3]))) {
                // [Ancho, Alto, Cantidad, Etiqueta]
                w = Math.round(col0Num) || 0;
                h = Math.round(col1Num) || 0;
                cant = Math.round(col2Num) || 1;
                label = cols[3];
            } else {
                // Todos numéricos: [Ancho, Alto, Cantidad, ...]
                w = Math.round(col0Num) || 0;
                h = Math.round(col1Num) || 0;
                cant = Math.round(col2Num) || 1;
                if (cols.length >= 5 && isNaN(parseInt(cols[4]))) {
                    label = cols[4];
                }
            }
        } else if (cols.length === 3) {
            const c0 = parseFloat(cols[0].replace(/[^0-9.]/g, ''));
            const c1 = parseFloat(cols[1].replace(/[^0-9.]/g, ''));
            const c2 = parseFloat(cols[2].replace(/[^0-9.]/g, ''));

            if (isNaN(c0)) {
                // [Etiqueta, Ancho, Alto]
                label = cols[0];
                w = Math.round(c1) || 0;
                h = Math.round(c2) || 0;
                cant = 1;
            } else {
                // [Ancho, Alto, Cantidad]
                w = Math.round(c0) || 0;
                h = Math.round(c1) || 0;
                cant = Math.round(c2) || 1;
            }
        } else if (cols.length === 2) {
            // [Ancho, Alto]
            const c0 = parseFloat(cols[0].replace(/[^0-9.]/g, ''));
            const c1 = parseFloat(cols[1].replace(/[^0-9.]/g, ''));
            w = Math.round(c0) || 0;
            h = Math.round(c1) || 0;
            cant = 1;
        }

        if (w > 0 && h > 0) {
            rows.push({
                w0: w,
                h0: h,
                cant: Math.max(1, cant),
                label: label.trim()
            });
        }
    }
    return rows;
}

function importPastedRows(newRows) {
    if (!newRows || newRows.length === 0) {
        if (window.showToast) window.showToast("No se encontraron medidas válidas para importar.", "warning");
        return;
    }

    activeHistoryId = null;

    // Si la lista actual solo contiene filas vacías sin dimensiones, reemplazarlas
    const isCurrentEmpty = piezasList.every(p => (!p.w0 || p.w0 === 0) && (!p.h0 || p.h0 === 0));
    if (isCurrentEmpty) {
        piezasList = [];
    }

    const startIdx = piezasList.length;
    newRows.forEach(item => {
        lastId++;
        piezasList.push({
            id: lastId,
            w0: item.w0,
            h0: item.h0,
            cant: item.cant || 1,
            label: item.label || '',
            hasError: false
        });
    });

    renderPiezasTable(`.grid-cell-input[data-row="${startIdx}"][data-col="1"]`);

    const msg = `✅ ${newRows.length} fila${newRows.length === 1 ? '' : 's'} importada${newRows.length === 1 ? '' : 's'} correctamente desde Excel.`;
    if (window.showToast) window.showToast(msg, "success");
    else alert(msg);
}

function handleTablePaste(e) {
    const text = (e.clipboardData || window.clipboardData)?.getData('text');
    if (!text || text.trim().length === 0) return;

    const bounds = getSelectionBounds();
    const activeInput = document.activeElement?.closest?.('.grid-cell-input');

    let anchorRow = 0;
    let anchorCol = 0;
    if (bounds) {
        anchorRow = bounds.minRow;
        anchorCol = bounds.minCol;
    } else if (activeInput) {
        anchorRow = parseInt(activeInput.dataset.row) || 0;
        anchorCol = parseInt(activeInput.dataset.col) || 0;
    }

    const rawLines = text.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
    if (rawLines.length === 0) return;

    const grid = rawLines.map(line => {
        if (line.includes('\t')) return line.split('\t').map(c => c.trim());
        if (line.includes(';') && !line.includes('\t')) return line.split(';').map(c => c.trim());
        if (line.includes(',') && !line.includes('\t')) return line.split(',').map(c => c.trim());
        return line.split(/\s+/).map(c => c.trim());
    });

    // Caso 1: Pegar un único valor en una selección múltiple (ej. 5 filas seleccionadas) -> Aplicar a todas las celdas
    if (grid.length === 1 && grid[0].length === 1 && bounds && (bounds.maxRow > bounds.minRow || bounds.maxCol > bounds.minCol)) {
        e.preventDefault();
        const singleVal = grid[0][0];
        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                if (c === 0) piezasList[r].label = singleVal;
                else if (c === 1) piezasList[r].w0 = parseInt(singleVal.replace(/[^0-9]/g, '')) || 0;
                else if (c === 2) piezasList[r].h0 = parseInt(singleVal.replace(/[^0-9]/g, '')) || 0;
                else if (c === 3) piezasList[r].cant = Math.max(1, parseInt(singleVal.replace(/[^0-9]/g, '')) || 1);
                piezasList[r].hasError = false;
            }
        }
        renderPiezasTable();
        if (window.showToast) {
            const count = (bounds.maxRow - bounds.minRow + 1) * (bounds.maxCol - bounds.minCol + 1);
            window.showToast(`✨ Valor aplicado a ${count} celdas seleccionadas.`, 'success');
        }
        return;
    }

    // Caso 2: Pegado de matriz o datos tabulares desde Excel / Sheets
    if (text.includes('\n') || text.includes('\t') || (text.includes(';') && text.length > 5) || grid.length > 1 || grid[0].length > 1) {
        e.preventDefault();

        // Si se pega desde la columna 0 y coincide con el formato de despiece completo (posible encabezado de plantilla)
        if (anchorCol === 0 && rawLines.length >= 2) {
            const parsed = parseExcelClipboardData(text);
            if (parsed.length > 0 && (parsed[0].w0 > 0 || parsed[0].h0 > 0)) {
                importPastedRows(parsed);
                return;
            }
        }

        // Pegar la cuadrícula exacta a partir de (anchorRow, anchorCol)
        let maxColPasted = anchorCol;
        for (let rIdx = 0; rIdx < grid.length; rIdx++) {
            const targetRow = anchorRow + rIdx;
            while (piezasList.length <= targetRow) {
                lastId++;
                piezasList.push({ id: lastId, w0: 0, h0: 0, cant: 1, label: '', hasError: false });
            }

            const rowTokens = grid[rIdx];
            for (let cIdx = 0; cIdx < rowTokens.length; cIdx++) {
                const targetCol = anchorCol + cIdx;
                if (targetCol > 3) continue;
                if (targetCol > maxColPasted) maxColPasted = targetCol;

                const val = rowTokens[cIdx];
                if (targetCol === 0) {
                    piezasList[targetRow].label = val;
                } else if (targetCol === 1) {
                    piezasList[targetRow].w0 = parseInt(val.replace(/[^0-9]/g, '')) || 0;
                } else if (targetCol === 2) {
                    piezasList[targetRow].h0 = parseInt(val.replace(/[^0-9]/g, '')) || 0;
                } else if (targetCol === 3) {
                    piezasList[targetRow].cant = Math.max(1, parseInt(val.replace(/[^0-9]/g, '')) || 1);
                }
            }
            piezasList[targetRow].hasError = false;
        }

        gridSelection.startRow = anchorRow;
        gridSelection.startCol = anchorCol;
        gridSelection.endRow = anchorRow + grid.length - 1;
        gridSelection.endCol = maxColPasted;

        renderPiezasTable();
        if (window.showToast) {
            window.showToast(`📋 Se pegaron ${grid.length} fila(s) en la cuadrícula.`, 'success');
        }
    }
}

async function handleQuickPasteFromClipboard() {
    if (navigator.clipboard && navigator.clipboard.readText) {
        try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim().length > 0) {
                handleTablePaste({
                    clipboardData: { getData: () => text },
                    preventDefault: () => {}
                });
                return;
            }
        } catch (err) {
            console.warn("Permiso de portapapeles denegado o no disponible:", err);
        }
    }

    // Modal de pegado alternativo si el navegador bloquea la lectura directa del portapapeles
    openPasteFallbackModal();
}

function openPasteFallbackModal() {
    let modal = document.getElementById('modal-paste-fallback');
    if (!modal) {
        const div = document.createElement('div');
        div.id = 'modal-paste-fallback';
        div.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4';
        div.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-5 space-y-4 border border-slate-200">
                <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-sm font-bold">
                            <i class="fa-solid fa-paste"></i>
                        </div>
                        <h3 class="text-sm font-black text-slate-800">Pegar Datos desde Excel / Sheets</h3>
                    </div>
                    <button type="button" id="modal-paste-close-btn" class="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                        <i class="fa-solid fa-xmark text-sm"></i>
                    </button>
                </div>
                <p class="text-xs text-slate-600">Presiona <kbd class="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono font-bold">Ctrl+V</kbd> dentro del cuadro para pegar las filas de tu Excel:</p>
                <textarea id="modal-paste-textarea" rows="6" class="w-full p-3 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none" placeholder="Etiqueta&#9;Ancho&#9;Alto&#9;Cantidad&#10;Ventana 1&#9;1200&#9;800&#9;2&#10;Puerta&#9;600&#9;400&#9;4"></textarea>
                <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
                    <button type="button" id="modal-paste-cancel-btn" class="px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition">Cancelar</button>
                    <button type="button" id="modal-paste-submit-btn" class="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition flex items-center gap-1.5">
                        <i class="fa-solid fa-check"></i> Importar Medidas
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(div);

        document.getElementById('modal-paste-close-btn')?.addEventListener('click', () => div.classList.add('hidden'));
        document.getElementById('modal-paste-cancel-btn')?.addEventListener('click', () => div.classList.add('hidden'));
        document.getElementById('modal-paste-submit-btn')?.addEventListener('click', () => {
            const val = document.getElementById('modal-paste-textarea')?.value || '';
            if (val && val.trim().length > 0) {
                handleTablePaste({
                    clipboardData: { getData: () => val },
                    preventDefault: () => {}
                });
                div.classList.add('hidden');
                document.getElementById('modal-paste-textarea').value = '';
            } else {
                if (window.showToast) window.showToast("No se ingresaron datos.", "warning");
                else alert("No se ingresaron datos.");
            }
        });
        modal = div;
    }
    modal.classList.remove('hidden');
    setTimeout(() => {
        const ta = document.getElementById('modal-paste-textarea');
        if (ta) { ta.value = ''; ta.focus(); }
    }, 50);
}

function updateTabsScrollButtons() {
    const container = document.getElementById('modal-remnants-sheet-tabs');
    const prevBtn = document.getElementById('modal-tabs-scroll-prev');
    const nextBtn = document.getElementById('modal-tabs-scroll-next');
    if (!container || !prevBtn || !nextBtn) return;

    const maxScroll = container.scrollWidth - container.clientWidth;
    const canScroll = maxScroll > 4;
    prevBtn.style.display = canScroll ? 'flex' : 'none';
    nextBtn.style.display = canScroll ? 'flex' : 'none';
    if (canScroll) {
        prevBtn.disabled = container.scrollLeft <= 4;
        prevBtn.classList.toggle('opacity-25', prevBtn.disabled);
        prevBtn.classList.toggle('cursor-not-allowed', prevBtn.disabled);
        nextBtn.disabled = container.scrollLeft >= maxScroll - 4;
        nextBtn.classList.toggle('opacity-25', nextBtn.disabled);
        nextBtn.classList.toggle('cursor-not-allowed', nextBtn.disabled);
    }
}

function loadSheetJS(callback) {
    if (window.XLSX) {
        if (callback) callback();
        return;
    }
    const script = document.createElement('script');
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload = () => {
        if (callback) callback();
    };
    script.onerror = () => {
        alert("Error cargando la librería para Excel/CSV. Por favor revisa tu conexión a internet.");
    };
    document.head.appendChild(script);
}

function downloadTemplateExcel() {
    loadSheetJS(() => {
        try {
            const wb = XLSX.utils.book_new();
            const wsData = [
                ["Etiqueta", "Ancho (mm)", "Alto (mm)", "Cantidad"],
                ["Ventana Principal", 1200, 800, 4],
                ["Puerta Baño", 600, 400, 8],
                ["Repisa Cocina", 300, 300, 12],
                ["Mampara Ducha", 1500, 1900, 2]
            ];
            const ws = XLSX.utils.aoa_to_sheet(wsData);
            
            ws['!cols'] = [
                { wch: 22 },
                { wch: 15 },
                { wch: 15 },
                { wch: 12 }
            ];
            
            XLSX.utils.book_append_sheet(wb, ws, "Medidas");
            XLSX.writeFile(wb, "Plantilla_Optimizacion_VidrioExito.xlsx");
        } catch (err) {
            console.error(err);
            alert("Error al generar la plantilla de Excel: " + err.message);
        }
    });
}

function importExcelCuts(e) {
    const file = e.target.files[0];
    if (!file) return;

    loadSheetJS(() => {
        const reader = new FileReader();
        reader.onload = function(evt) {
            try {
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                if (jsonData.length <= 1) {
                    alert("El archivo importado está vacío o no contiene filas de datos.");
                    return;
                }
                
                const firstRow = jsonData[0].map(h => String(h || '').trim().toLowerCase());
                
                let labelIdx = 0;
                let widthIdx = 1;
                let heightIdx = 2;
                let cantIdx = 3;
                
                const dLabel = firstRow.findIndex(h => h.includes('etiqueta') || h.includes('label') || h.includes('desc') || h.includes('nom') || h.includes('pieza'));
                const dWidth = firstRow.findIndex(h => h.includes('ancho') || h.includes('width') || h === 'w' || h === 'x' || h === 'anc');
                const dHeight = firstRow.findIndex(h => h.includes('alto') || h.includes('height') || h === 'h' || h === 'y' || h === 'alt');
                const dCant = firstRow.findIndex(h => h.includes('cant') || h.includes('qty') || h.includes('cantidad') || h.includes('unidades') || h.includes('uds'));
                
                if (dLabel !== -1) labelIdx = dLabel;
                if (dWidth !== -1) widthIdx = dWidth;
                if (dHeight !== -1) heightIdx = dHeight;
                if (dCant !== -1) cantIdx = dCant;
                
                let importedCount = 0;
                const newPieces = [];
                
                for (let i = 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (!row || row.length === 0) continue;
                    
                    const label = String(row[labelIdx] || 'Vidrio').trim();
                    const w = parseInt(row[widthIdx]);
                    const h = parseInt(row[heightIdx]);
                    const cant = parseInt(row[cantIdx]) || 1;
                    
                    if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
                        lastId++;
                        newPieces.push({
                            id: lastId,
                            w0: w,
                            h0: h,
                            cant: Math.max(1, cant),
                            label: label || 'Vidrio'
                        });
                        importedCount++;
                    }
                }
                
                if (newPieces.length > 0) {
                    const isCurrentEmpty = piezasList.every(p => (!p.w0 || p.w0 === 0) && (!p.h0 || p.h0 === 0));
                    if (isCurrentEmpty) piezasList = [];
                    piezasList = [...piezasList, ...newPieces];
                    activeHistoryId = null;
                    renderPiezasTable();
                    const msg = `¡Éxito! Se importaron ${importedCount} piezas del archivo Excel/CSV.`;
                    if (window.showToast) window.showToast(msg, 'success');
                    else alert(msg);
                } else {
                    alert("No se encontraron medidas válidas para importar.");
                }
            } catch (err) {
                console.error(err);
                alert("Error al procesar el archivo Excel / CSV: " + err.message);
            }
            e.target.value = '';
        };
        reader.readAsArrayBuffer(file);
    });
}

function setupListeners() {
    // Eventos de la cuadrícula interactiva estilo Excel
    const gridAddRowBtn = document.getElementById('grid-add-row-btn');
    const gridQuickAddBtn = document.getElementById('grid-quick-add-btn');
    if (gridAddRowBtn) gridAddRowBtn.addEventListener('click', () => addNewPiezaRow('w0'));
    if (gridQuickAddBtn) gridQuickAddBtn.addEventListener('click', () => addNewPiezaRow('w0'));

    const gridPasteBtn = document.getElementById('grid-paste-btn');
    const gridQuickPasteLink = document.getElementById('grid-quick-paste-link');
    if (gridPasteBtn) gridPasteBtn.addEventListener('click', handleQuickPasteFromClipboard);
    if (gridQuickPasteLink) gridQuickPasteLink.addEventListener('click', handleQuickPasteFromClipboard);

    const gridCopyBtn = document.getElementById('grid-copy-btn');
    if (gridCopyBtn) gridCopyBtn.addEventListener('click', copyPiezasTableToClipboard);

    // Evento de pegado global en la cuadrícula de despiece
    const gridContainer = document.getElementById('despiece-grid-container');
    if (gridContainer) {
        gridContainer.addEventListener('paste', handleTablePaste);
    }

    const addForm = document.getElementById('add-pieza-form');
    if (addForm) {
        addForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const w = parseInt(document.getElementById('pieza-width').value);
            const h = parseInt(document.getElementById('pieza-height').value);
            const cant = parseInt(document.getElementById('pieza-cant').value);
            const labelInput = document.getElementById('pieza-label');
            const label = labelInput ? labelInput.value.trim() : '';

            if (w <= 0 || h <= 0 || cant <= 0) return;

            activeHistoryId = null;
            lastId++;
            piezasList.push({ id: lastId, w0: w, h0: h, cant, label });
            renderPiezasTable();
            addForm.reset();
            document.getElementById('pieza-cant').value = "1";
            document.getElementById('pieza-width').focus();
        });
    }

    const calcBtn = document.getElementById('calculate-despiece-btn');
    if (calcBtn) {
        calcBtn.addEventListener('click', () => {
            calculateOptimization();
        });
    }

    const clearBtn = document.getElementById('clear-despiece-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearDespieceCalculator();
        });
    }

    const printAllBtn = document.getElementById('print-all-sheets-btn');
    if (printAllBtn) {
        printAllBtn.addEventListener('click', () => {
            printAllSheets();
        });
    }

    const printLabelsBtn = document.getElementById('print-labels-btn');
    if (printLabelsBtn) {
        printLabelsBtn.addEventListener('click', () => {
            printProductionLabels();
        });
    }

    const dlTemplateBtn = document.getElementById('despiece-download-template-btn');
    if (dlTemplateBtn) {
        dlTemplateBtn.addEventListener('click', downloadTemplateExcel);
    }

    const importBtn = document.getElementById('despiece-import-excel-btn');
    const fileInput = document.getElementById('despiece-excel-file-input');
    if (importBtn && fileInput) {
        importBtn.addEventListener('click', () => {
            fileInput.click();
        });
        fileInput.addEventListener('change', importExcelCuts);
    }

    const tabCalcBtn = document.getElementById('tab-despiece-calc');
    const tabInventarioBtn = document.getElementById('tab-despiece-inventario');
    const tabHistoryBtn = document.getElementById('tab-despiece-history');
    if (tabCalcBtn) tabCalcBtn.addEventListener('click', () => switchDespieceTab('calc'));
    if (tabInventarioBtn) tabInventarioBtn.addEventListener('click', () => switchDespieceTab('inventario'));
    if (tabHistoryBtn) tabHistoryBtn.addEventListener('click', () => switchDespieceTab('history'));

    // Selector de lámina desde inventario
    const inventorySelect = document.getElementById('sheet-inventory-select');
    if (inventorySelect) {
        inventorySelect.addEventListener('change', () => {
            selectedLaminaId = inventorySelect.value || null;
            if (selectedLaminaId) {
                const item = laminasInventory.find(l => l.id === selectedLaminaId);
                if (item) {
                    const sheetWidthInput = document.getElementById('sheet-width');
                    const sheetHeightInput = document.getElementById('sheet-height');
                    const sheetMaterialInput = document.getElementById('sheet-material');
                    if (sheetWidthInput) sheetWidthInput.value = item.ancho;
                    if (sheetHeightInput) sheetHeightInput.value = item.alto;
                    if (sheetMaterialInput && item.material) sheetMaterialInput.value = item.material;
                }
            }
            updateStockBadge();
            activeHistoryId = null;
        });
    }

    // Botón para ingresar lámina/retal y modal
    const btnNuevaLamina = document.getElementById('btn-nueva-lamina');
    if (btnNuevaLamina) {
        btnNuevaLamina.addEventListener('click', () => openLaminaModal());
    }

    const modalCloseBtn = document.getElementById('modal-lamina-close-btn');
    const modalCancelBtn = document.getElementById('modal-lamina-cancel-btn');
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeLaminaModal);
    if (modalCancelBtn) modalCancelBtn.addEventListener('click', closeLaminaModal);

    const formLamina = document.getElementById('form-lamina-item');
    if (formLamina) {
        formLamina.addEventListener('submit', handleSaveLamina);
    }

    // Eventos del modal visual de clasificación de sobrantes / desperdicios
    const modalRemnantsCloseBtn = document.getElementById('modal-remnants-close-btn');
    const modalRemnantsCancelBtn = document.getElementById('modal-remnants-cancel-btn');
    if (modalRemnantsCloseBtn) modalRemnantsCloseBtn.addEventListener('click', closeRemnantsVisualModal);
    if (modalRemnantsCancelBtn) modalRemnantsCancelBtn.addEventListener('click', closeRemnantsVisualModal);

    const modalRemnantsPrevBtn = document.getElementById('modal-remnants-prev-btn');
    const modalRemnantsNextBtn = document.getElementById('modal-remnants-next-btn');
    if (modalRemnantsPrevBtn) modalRemnantsPrevBtn.addEventListener('click', () => navigateRemnantsModalSheet(-1));
    if (modalRemnantsNextBtn) modalRemnantsNextBtn.addEventListener('click', () => navigateRemnantsModalSheet(1));

    // Controles de desplazamiento del carrusel de pestañas de láminas
    const tabsContainer = document.getElementById('modal-remnants-sheet-tabs');
    const tabsScrollPrev = document.getElementById('modal-tabs-scroll-prev');
    const tabsScrollNext = document.getElementById('modal-tabs-scroll-next');
    if (tabsScrollPrev && tabsContainer) {
        tabsScrollPrev.addEventListener('click', () => {
            tabsContainer.scrollBy({ left: -180, behavior: 'smooth' });
            setTimeout(updateTabsScrollButtons, 220);
        });
    }
    if (tabsScrollNext && tabsContainer) {
        tabsScrollNext.addEventListener('click', () => {
            tabsContainer.scrollBy({ left: 180, behavior: 'smooth' });
            setTimeout(updateTabsScrollButtons, 220);
        });
    }
    if (tabsContainer) {
        tabsContainer.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                tabsContainer.scrollBy({ left: e.deltaY * 1.5, behavior: 'smooth' });
                updateTabsScrollButtons();
            }
        }, { passive: false });
        tabsContainer.addEventListener('scroll', updateTabsScrollButtons);
    }

    // Control de rueda del ratón en el modal para evitar que se mueva la página del fondo
    const modalRemnantsEl = document.getElementById('modal-remnants-visual');
    if (modalRemnantsEl) {
        modalRemnantsEl.addEventListener('wheel', (e) => {
            // 1. Si la rueda se usa sobre las pestañas de láminas, permitimos su scroll horizontal fluido
            if (e.target.closest('#modal-remnants-sheet-tabs')) {
                return;
            }
            // 2. Si la rueda se usa sobre el área del lienzo/plano, hacer zoom interactivo
            const viewport = e.target.closest('#modal-canvas-viewport');
            if (viewport) {
                e.preventDefault();
                e.stopPropagation();
                if (e.deltaY < 0) {
                    modalRemnantsZoomLevel = Math.min(2.5, Math.round((modalRemnantsZoomLevel + 0.1) * 100) / 100);
                } else if (e.deltaY > 0) {
                    modalRemnantsZoomLevel = Math.max(0.5, Math.round((modalRemnantsZoomLevel - 0.1) * 100) / 100);
                }
                renderModalRemnantsView();
                return;
            }
            // 3. Si ocurre dentro del cajón inferior de retales y tiene scroll vertical propio
            const drawer = e.target.closest('#modal-remnants-drawer');
            if (drawer && drawer.scrollHeight > drawer.clientHeight) {
                e.stopPropagation();
                return;
            }
            // 4. En cualquier otro lugar del modal, cancelar propagación para que el fondo no se mueva
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });
    }

    // Tecla Escape para cerrar el modal de sobrantes
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('modal-remnants-visual');
            if (modal && !modal.classList.contains('hidden')) {
                closeRemnantsVisualModal();
            }
        }
    });

    const btnAllSave = document.getElementById('modal-btn-all-save');
    const btnAllDiscard = document.getElementById('modal-btn-all-discard');
    const btnAutoSuggest = document.getElementById('modal-btn-auto-suggest');
    if (btnAllSave) btnAllSave.addEventListener('click', () => setRemnantsActionForActiveSheet('save'));
    if (btnAllDiscard) btnAllDiscard.addEventListener('click', () => setRemnantsActionForActiveSheet('discard'));
    if (btnAutoSuggest) btnAutoSuggest.addEventListener('click', autoSuggestRemnantsAction);

    const modalConfirmBtn = document.getElementById('modal-remnants-confirm-btn');
    if (modalConfirmBtn) modalConfirmBtn.addEventListener('click', handleConfirmRemnantsFromModal);

    const btnZoomOut = document.getElementById('modal-btn-zoom-out');
    const btnZoomIn = document.getElementById('modal-btn-zoom-in');
    const btnZoomReset = document.getElementById('modal-btn-zoom-reset');
    if (btnZoomOut) {
        btnZoomOut.addEventListener('click', () => {
            modalRemnantsZoomLevel = Math.max(0.5, Math.round((modalRemnantsZoomLevel - 0.15) * 100) / 100);
            renderModalRemnantsView();
        });
    }
    if (btnZoomIn) {
        btnZoomIn.addEventListener('click', () => {
            modalRemnantsZoomLevel = Math.min(2.5, Math.round((modalRemnantsZoomLevel + 0.15) * 100) / 100);
            renderModalRemnantsView();
        });
    }
    if (btnZoomReset) {
        btnZoomReset.addEventListener('click', () => {
            modalRemnantsZoomLevel = 1.0;
            renderModalRemnantsView();
        });
    }

    window.addEventListener('resize', () => {
        const modal = document.getElementById('modal-remnants-visual');
        if (modal && !modal.classList.contains('hidden')) {
            renderModalRemnantsView();
        }
    });

    initModalRemnantsCanvasEvents();
    initMainCanvasRemnantsClick();

    // Filtros de búsqueda en tabla de inventario
    const invSearchInput = document.getElementById('inventory-search-input');
    if (invSearchInput) {
        invSearchInput.addEventListener('input', renderInventoryTable);
    }
    const invTypeFilter = document.getElementById('inventory-type-filter');
    if (invTypeFilter) {
        invTypeFilter.addEventListener('change', renderInventoryTable);
    }
    const invMatFilter = document.getElementById('inventory-material-filter');
    if (invMatFilter) {
        invMatFilter.addEventListener('change', renderInventoryTable);
    }

    // Resetear activeHistoryId cuando el usuario edite las láminas base o la estrategia
    const resetHistoryState = () => { activeHistoryId = null; };
    const inputs = ['sheet-width', 'sheet-height', 'sheet-client', 'sheet-material', 'opt-strategy', 'opt-rotate'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', resetHistoryState);
            el.addEventListener('change', resetHistoryState);
        }
    });

    // Desvincular selección de inventario si se editan medidas manualmente a valores distintos
    const checkUnlinkInventory = () => {
        if (selectedLaminaId) {
            const lam = laminasInventory.find(l => l.id === selectedLaminaId);
            if (lam) {
                const w = parseInt(document.getElementById('sheet-width')?.value);
                const h = parseInt(document.getElementById('sheet-height')?.value);
                const mat = (document.getElementById('sheet-material')?.value || '').trim().toUpperCase();
                if (w !== lam.ancho || h !== lam.alto || mat !== (lam.material || '').trim().toUpperCase()) {
                    selectedLaminaId = null;
                    if (inventorySelect) inventorySelect.value = '';
                    updateStockBadge();
                }
            }
        }
    };
    ['sheet-width', 'sheet-height', 'sheet-material'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', checkUnlinkInventory);
    });

    // Resetear activeHistoryId cuando el usuario edite las inputs del listado o elimine piezas
    const tbody = document.getElementById('piezas-list-body');
    if (tbody) {
        tbody.addEventListener('input', resetHistoryState);
        tbody.addEventListener('click', (e) => {
            if (e.target.closest('.delete-pieza-btn') || e.target.closest('.grid-del-btn')) {
                activeHistoryId = null;
            }
        });
    }
}

function clearDespieceCalculator() {
    const hasValidPieces = piezasList.some(p => p.w0 > 0 || p.h0 > 0);
    if (hasValidPieces && !confirm("¿Estás seguro de que deseas limpiar la lista de piezas y comenzar un nuevo despiece?")) {
        return;
    }

    lastId = 0;
    piezasList = [
        { id: ++lastId, w0: 0, h0: 0, cant: 1, label: '', hasError: false },
        { id: ++lastId, w0: 0, h0: 0, cant: 1, label: '', hasError: false },
        { id: ++lastId, w0: 0, h0: 0, cant: 1, label: '', hasError: false }
    ];
    currentResult = null;
    currentSheetIndex = 0;
    activeHistoryId = null;
    selectedLaminaId = null;
    isInventoryDeducted = false;
    remnantsDecisions = [];

    // Restablecer parámetros a los valores por defecto
    const sheetWidthInput = document.getElementById('sheet-width');
    const sheetHeightInput = document.getElementById('sheet-height');
    const sheetClientInput = document.getElementById('sheet-client');
    const sheetMaterialInput = document.getElementById('sheet-material');
    const optStrategySelect = document.getElementById('opt-strategy');
    const optRotateCheckbox = document.getElementById('opt-rotate');
    const inventorySelect = document.getElementById('sheet-inventory-select');

    if (sheetWidthInput) sheetWidthInput.value = "3300";
    if (sheetHeightInput) sheetHeightInput.value = "2140";
    if (sheetClientInput) sheetClientInput.value = "";
    if (sheetMaterialInput) sheetMaterialInput.value = "LAMINADO 3+3";
    if (optStrategySelect) optStrategySelect.value = "AUTO";
    if (optRotateCheckbox) optRotateCheckbox.checked = true;
    if (inventorySelect) inventorySelect.value = "";
    updateStockBadge();

    // Renderizar la tabla de piezas vacía
    renderPiezasTable();

    // Ocultar contenedor de resultados y tarjeta de inventario
    const resultsContainer = document.getElementById('despiece-results-container');
    if (resultsContainer) {
        resultsContainer.classList.add('hidden');
    }
    
    // Limpiar el canvas
    const canvas = document.getElementById('despiece-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
}

function calculateOptimization() {
    // Filtrar únicamente las piezas con medidas válidas (ancho > 0 y alto > 0)
    const validPieces = piezasList.filter(p => p.w0 > 0 && p.h0 > 0 && p.cant > 0);
    if (validPieces.length === 0) {
        if (window.showToast) {
            window.showToast('Agrega al menos una pieza con dimensiones válidas (ancho > 0 y alto > 0) a cortar.', 'warning');
        } else {
            alert('Agrega al menos una pieza a cortar para realizar el despiece.');
        }
        return;
    }

    const sheetW = parseInt(document.getElementById('sheet-width').value);
    const sheetH = parseInt(document.getElementById('sheet-height').value);
    const kerf = 0; // Configurado por defecto a 0 según requerimientos técnicos
    const margin = 0; // Configurado por defecto a 0 según requerimientos técnicos
    const allowRotate = document.getElementById('opt-rotate').checked;
    const strategy = document.getElementById('opt-strategy').value;

    // Restablecer errores previos antes de calcular
    piezasList.forEach(p => p.hasError = false);
    renderPiezasTable();

    // Flatten pieces list into cuts array for optimizarCortes ({ ancho, alto, cantidad, label, originalId })
    const cuts = validPieces.map(p => ({
        ancho: p.w0,
        alto: p.h0,
        cantidad: p.cant,
        label: p.label || '',
        originalId: p.id
    }));

    const opts = {
        kerf,
        margin,
        allowPieceRotation: allowRotate,
        strategy: strategy === 'GUIL_ROWS' ? 'gH' : (strategy === 'GUIL_COLS' ? 'gV' : (strategy === 'VERT_FIRST' ? 'gV_first' : 'base'))
    };

    const calculateBtn = document.getElementById('calculate-despiece-btn');
    calculateBtn.disabled = true;
    calculateBtn.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> Calculando...';

    setTimeout(() => {
        try {
            const material = document.getElementById('sheet-material')?.value?.trim() || '';
            const useDesperdicios = document.getElementById('opt-use-desperdicios')?.checked ?? false;
            const selectedLamina = selectedLaminaId ? laminasInventory.find(l => l.id === selectedLaminaId) : null;

            let result = optimizeDespieceWithDesperdicios(sheetW, sheetH, cuts, allowRotate, strategy, material, selectedLamina, useDesperdicios, laminasInventory);

            if (!result || !result.plano || result.plano.length === 0) {
                alert('No se pudieron acomodar las piezas. Verifica que las piezas no sean más grandes que la Lámina Base.');
                calculateBtn.disabled = false;
                calculateBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Calcular Optimización';
                return;
            }

            if (result.unplacedCount > 0) {
                // Marcar las piezas que no cupieron
                const unplacedIds = new Set(result.unplacedPieces.map(up => up.originalId));
                piezasList.forEach(p => {
                    if (unplacedIds.has(p.id)) {
                        p.hasError = true;
                    }
                });

                // Renderizar la tabla para mostrar los errores en rojo
                renderPiezasTable();

                // Agrupar piezas no optimizadas para el mensaje
                const grouped = {};
                for (const p of result.unplacedPieces) {
                    const label = p.label ? p.label : 'Vidrio';
                    const key = `${label} (${p.w || p.ancho}x${p.h || p.alto} mm)`;
                    grouped[key] = (grouped[key] || 0) + 1;
                }
                const listStr = Object.entries(grouped)
                    .map(([desc, qty]) => `• ${desc}: ${qty} pieza(s)`)
                    .join('\n');

                alert(`⚠️ Atención: No todas las piezas se pudieron acomodar en las láminas.\n\n` +
                      `Las siguientes piezas no se pudieron optimizar porque exceden las dimensiones de la Lámina Base o no caben en la distribución:\n\n` +
                      `${listStr}\n\n` +
                      `Por favor verifica las medidas.`);

                // Ocultar contenedor de resultados
                const resultsContainer = document.getElementById('despiece-results-container');
                if (resultsContainer) {
                    resultsContainer.classList.add('hidden');
                }

                calculateBtn.disabled = false;
                calculateBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Calcular Optimización';
                return;
            }

            currentResult = result;
            currentSheetIndex = 0;
            isInventoryDeducted = false;
            displayResults(sheetW, sheetH);

            // Guardar automáticamente en el historial de despieces
            saveDespieceToHistory(sheetW, sheetH, allowRotate, strategy, result);

            // Si se detectaron sobrantes/desperdicios, abrir el modal visual automáticamente para que el usuario decida cuáles se quedan y cuáles se van
            if (remnantsDecisions.length > 0) {
                setTimeout(() => {
                    openRemnantsVisualModal(0);
                }, 350);
            }
        } catch (err) {
            console.error(err);
            alert('Ocurrió un error en el cálculo de despiece: ' + err.message);
        } finally {
            calculateBtn.disabled = false;
            calculateBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Calcular Optimización';
        }
    }, 300);
}

function displayResults(sheetW, sheetH) {
    const resultsContainer = document.getElementById('despiece-results-container');
    if (!resultsContainer) return;
    resultsContainer.classList.remove('hidden');

    // Fill metrics
    const totalSheets = currentResult.numeroLaminas;
    const despCount = currentResult.desperdiciosUsadosCount || 0;
    const fullSheetsCount = currentResult.laminasCompletasCount ?? (totalSheets - despCount);

    if (despCount > 0) {
        document.getElementById('res-sheets-count').innerHTML = `${totalSheets} <span class="text-xs font-semibold text-amber-600 block sm:inline">(${fullSheetsCount} lám. + ${despCount} retales)</span>`;
    } else {
        document.getElementById('res-sheets-count').textContent = totalSheets;
    }

    document.getElementById('res-pieces-placed').textContent = currentResult.plano.reduce((t, s) => t + s.cortes.length, 0);

    const totalSheetArea = currentResult.totalSheetsArea || currentResult.plano.reduce((acc, s) => acc + (s.sheetW || sheetW) * (s.sheetH || sheetH), 0);
    const totalPlacedArea = currentResult.totalPlacedArea || currentResult.plano.reduce((accSheet, s) => accSheet + s.cortes.reduce((accPiece, p) => accPiece + p.ancho * p.alto, 0), 0);
    const utilPct = totalSheetArea > 0 ? ((totalPlacedArea / totalSheetArea) * 100).toFixed(1) : '0.0';

    document.getElementById('res-utilization').textContent = `${utilPct}%`;
    document.getElementById('res-useful-area').textContent = `${(totalPlacedArea / 1000000).toFixed(2)} m²`;
    document.getElementById('res-waste-area').textContent = `${((totalSheetArea - totalPlacedArea) / 1000000).toFixed(2)} m²`;

    // Render sheets pagination tabs
    const tabsContainer = document.getElementById('sheet-tabs');
    tabsContainer.innerHTML = currentResult.plano.map((sh, idx) => {
        let label = '';
        if (sh.isDesperdicio) {
            label = `<i class="fa-solid fa-recycle text-[10px] text-amber-500 mr-1"></i>Retal ${idx + 1} (${sh.sheetW}x${sh.sheetH})`;
        } else {
            const idBadge = sh.laminaIdRef ? ` [ID #${sh.laminaIdRef}]` : '';
            const ubiBadge = sh.laminaUbicacion ? ` (${sh.laminaUbicacion})` : '';
            label = `Lámina ${idx + 1}${idBadge}${ubiBadge}`;
        }
        return `
            <button class="sheet-tab-btn px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 shrink-0 ${idx === currentSheetIndex ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}" data-index="${idx}" title="${sh.laminaUbicacion ? `Ubicación: ${sh.laminaUbicacion}` : ''}">
                ${label}
            </button>
        `;
    }).join('');

    tabsContainer.querySelectorAll('.sheet-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentSheetIndex = parseInt(btn.dataset.index);
            // Toggle active styles
            tabsContainer.querySelectorAll('.sheet-tab-btn').forEach(b => {
                b.classList.remove('bg-indigo-600', 'text-white', 'shadow');
                b.classList.add('bg-gray-100', 'text-gray-700');
            });
            btn.classList.remove('bg-gray-100', 'text-gray-700');
            btn.classList.add('bg-indigo-600', 'text-white', 'shadow');
            btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            draw2DPlan(sheetW, sheetH);
        });
    });

    draw2DPlan(sheetW, sheetH);

    // Gestión de Láminas y Retales
    if (!isInventoryDeducted) {
        initRemnantsDecisions(sheetW, sheetH);
    }
    renderRemnantsDecisionCard(sheetW, sheetH);
    
    // Auto-scroll active tab into view on load
    const activeTab = tabsContainer.querySelector(`.sheet-tab-btn[data-index="${currentSheetIndex}"]`);
    if (activeTab) {
        setTimeout(() => {
            activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }, 150);
    }

    resultsContainer.scrollIntoView({ behavior: 'smooth' });
}

function draw2DPlan(sheetW, sheetH) {
    const canvas = document.getElementById('despiece-canvas');
    if (!canvas || !currentResult) return;

    const sheet = currentResult.plano[currentSheetIndex];
    if (!sheet) return;

    const curSheetW = sheet.sheetW || sheetW;
    const curSheetH = sheet.sheetH || sheetH;

    const containerWidth = Math.min(1400, canvas.parentElement.clientWidth - 32);
    const scale = (containerWidth - 40) / curSheetW;

    renderSheetToCanvas(canvas, sheet, curSheetW, curSheetH, scale, false);
}

function renderSheetToCanvas(canvas, sheet, sheetW, sheetH, scale, isForPrinting = false) {
    const margin = 40; // Margen para las reglas métricas (regletas)
    canvas.width = sheetW * scale + margin;
    canvas.height = sheetH * scale + margin;

    const ctx = canvas.getContext('2d');

    // Fondo blanco general del canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Fondo blanco del plano de corte (desplazado)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(margin, margin, sheetW * scale, sheetH * scale);

    // Borde exterior de la lámina (Negro grueso para impresión, slate para UI, desplazado)
    ctx.strokeStyle = isForPrinting ? '#000000' : '#475569';
    ctx.lineWidth = isForPrinting ? 4 : 2;
    ctx.strokeRect(margin, margin, sheetW * scale, sheetH * scale);

    // --- REGLETAS MÉTRICAS (REGLAS) ---
    // Regleta Superior
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(margin, 0, sheetW * scale, margin);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, margin);
    ctx.lineTo(margin + sheetW * scale, margin);
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let d = 0; d <= sheetW; d += 100) {
        const xPos = margin + d * scale;
        if (d % 500 === 0) {
            ctx.strokeStyle = '#64748b';
            ctx.beginPath();
            ctx.moveTo(xPos, margin - 12);
            ctx.lineTo(xPos, margin);
            ctx.stroke();
            ctx.fillText(d.toString(), xPos, 2);
        } else {
            ctx.strokeStyle = '#cbd5e1';
            ctx.beginPath();
            ctx.moveTo(xPos, margin - 6);
            ctx.lineTo(xPos, margin);
            ctx.stroke();
        }
    }

    // Regleta Izquierda
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, margin, margin, sheetH * scale);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, margin);
    ctx.lineTo(margin, margin + sheetH * scale);
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let d = 0; d <= sheetH; d += 100) {
        const yPos = margin + d * scale;
        if (d % 500 === 0) {
            ctx.strokeStyle = '#64748b';
            ctx.beginPath();
            ctx.moveTo(margin - 12, yPos);
            ctx.lineTo(margin, yPos);
            ctx.stroke();
            ctx.fillText(d.toString(), margin - 15, yPos);
        } else {
            ctx.strokeStyle = '#cbd5e1';
            ctx.beginPath();
            ctx.moveTo(margin - 6, yPos);
            ctx.lineTo(margin, yPos);
            ctx.stroke();
        }
    }

    // Esquina superior izquierda (mm)
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, margin, margin);
    ctx.strokeStyle = '#94a3b8';
    ctx.strokeRect(0, 0, margin, margin);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('mm', margin / 2, margin / 2);

    // Paleta de colores pastel
    const colors = [
        'rgba(99, 102, 241, 0.12)',  // Indigo
        'rgba(16, 185, 129, 0.12)',  // Emerald
        'rgba(245, 158, 11, 0.12)',  // Amber
        'rgba(59, 130, 246, 0.12)',  // Blue
        'rgba(236, 72, 153, 0.12)',  // Pink
        'rgba(139, 92, 246, 0.12)',  // Violet
        'rgba(20, 184, 166, 0.12)',  // Teal
        'rgba(249, 115, 22, 0.12)'   // Orange
    ];
    const strokeColors = isForPrinting
        ? ['#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000']
        : ['#6366f1', '#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6', '#f97312'];

    // --- DIBUJAR SOBRANTES (DESPERDICIOS / REMANENTES) ---
    if (sheet.sobrantes) {
        const sheetNum = sheet.numero || 1;
        const sheetIdx = sheetNum - 1;

        sheet.sobrantes.forEach((r, rIdx) => {
            const x = margin + r.x * scale;
            const y = margin + r.y * scale;
            const w = r.w * scale;
            const h = r.h * scale;

            const dec = remnantsDecisions.find(d => d.sheetIdx === sheetIdx && d.rIdx === rIdx);
            const action = dec ? dec.action : 'unassigned';

            if (action === 'save') {
                // 🟢 VERDE: SE QUEDA (Guardar en inventario)
                ctx.fillStyle = isForPrinting ? '#ecfdf5' : 'rgba(16, 185, 129, 0.32)';
                ctx.fillRect(x, y, w, h);

                ctx.strokeStyle = '#059669';
                ctx.lineWidth = isForPrinting ? 2 : 2.5;
                ctx.setLineDash([]);
                ctx.strokeRect(x, y, w, h);

                if (w >= 28 && h >= 16) {
                    if (h >= 45 && w >= 75) {
                        const pillW = Math.min(w - 10, 130);
                        const pillH = 34;
                        const pillX = x + (w - pillW) / 2;
                        const pillY = y + (h - pillH) / 2;
                        ctx.save();
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
                        ctx.strokeStyle = '#059669';
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        if (ctx.roundRect) ctx.roundRect(pillX, pillY, pillW, pillH, 6);
                        else ctx.rect(pillX, pillY, pillW, pillH);
                        ctx.fill();
                        ctx.stroke();

                        ctx.fillStyle = '#065f46';
                        ctx.font = 'bold 11px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('✓ SE QUEDA', pillX + pillW / 2, pillY + 11);

                        ctx.font = '9px sans-serif';
                        ctx.fillText(`${r.w}x${r.h}`, pillX + pillW / 2, pillY + 23);
                        ctx.restore();
                    } else {
                        ctx.fillStyle = '#065f46';
                        ctx.font = 'bold 9px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(`✓ ${r.w}x${r.h}`, x + w / 2, y + h / 2);
                    }
                }
            } else if (action === 'discard') {
                // 🔴 ROJO: SE VA (Desechar)
                ctx.fillStyle = isForPrinting ? '#fff1f2' : 'rgba(239, 68, 68, 0.28)';
                ctx.fillRect(x, y, w, h);

                ctx.strokeStyle = '#dc2626';
                ctx.lineWidth = isForPrinting ? 2 : 2.5;
                ctx.setLineDash([]);
                ctx.strokeRect(x, y, w, h);

                if (w >= 28 && h >= 16) {
                    if (h >= 45 && w >= 75) {
                        const pillW = Math.min(w - 10, 130);
                        const pillH = 34;
                        const pillX = x + (w - pillW) / 2;
                        const pillY = y + (h - pillH) / 2;
                        ctx.save();
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
                        ctx.strokeStyle = '#dc2626';
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        if (ctx.roundRect) ctx.roundRect(pillX, pillY, pillW, pillH, 6);
                        else ctx.rect(pillX, pillY, pillW, pillH);
                        ctx.fill();
                        ctx.stroke();

                        ctx.fillStyle = '#991b1b';
                        ctx.font = 'bold 11px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('✕ SE VA', pillX + pillW / 2, pillY + 11);

                        ctx.font = '9px sans-serif';
                        ctx.fillText(`${r.w}x${r.h}`, pillX + pillW / 2, pillY + 23);
                        ctx.restore();
                    } else {
                        ctx.fillStyle = '#991b1b';
                        ctx.font = 'bold 9px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(`✕ ${r.w}x${r.h}`, x + w / 2, y + h / 2);
                    }
                }
            } else {
                // ⚪ GRIS: SIN ASIGNAR (Pendiente de decisión)
                ctx.fillStyle = isForPrinting ? '#f1f5f9' : 'rgba(148, 163, 184, 0.32)';
                ctx.fillRect(x, y, w, h);

                ctx.strokeStyle = '#64748b';
                ctx.lineWidth = 2.0;
                ctx.setLineDash([5, 4]);
                ctx.strokeRect(x, y, w, h);
                ctx.setLineDash([]);

                if (w >= 28 && h >= 16) {
                    if (h >= 45 && w >= 80) {
                        const pillW = Math.min(w - 10, 140);
                        const pillH = 34;
                        const pillX = x + (w - pillW) / 2;
                        const pillY = y + (h - pillH) / 2;
                        ctx.save();
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                        ctx.strokeStyle = '#64748b';
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        if (ctx.roundRect) ctx.roundRect(pillX, pillY, pillW, pillH, 6);
                        else ctx.rect(pillX, pillY, pillW, pillH);
                        ctx.fill();
                        ctx.stroke();

                        ctx.fillStyle = '#475569';
                        ctx.font = 'bold 11px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('⚪ SIN ASIGNAR', pillX + pillW / 2, pillY + 11);

                        ctx.font = '9px sans-serif';
                        ctx.fillText(`${r.w}x${r.h}`, pillX + pillW / 2, pillY + 23);
                        ctx.restore();
                    } else {
                        ctx.fillStyle = '#475569';
                        ctx.font = 'bold 9px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(`⚪ ${r.w}x${r.h}`, x + w / 2, y + h / 2);
                    }
                }
            }
        });
    }

    // --- DIBUJAR CORTES ÚTILES ---
    sheet.cortes.forEach((p, idx) => {
        const x = margin + p.x * scale;
        const y = margin + p.y * scale;
        const w = p.ancho * scale;
        const h = p.alto * scale;

        const colorIdx = idx % colors.length;
        ctx.fillStyle = colors[colorIdx];
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = strokeColors[colorIdx];
        ctx.lineWidth = isForPrinting ? 2.5 : 1.5;
        ctx.strokeRect(x, y, w, h);

        drawPieceText(ctx, p.label || '', p.w0, p.h0, x, y, w, h, p.rot);
    });
}

function drawPieceText(ctx, label, w0, h0, x, y, w, h, rot) {
    if (w < 25 || h < 15) return; // Demasiado pequeño para mostrar algo

    ctx.fillStyle = '#000000'; // Negro puro de alto contraste
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textLabel = label || 'Vidrio';
    const textDim = `${w0}x${h0}${rot ? ' (R)' : ''}`;

    // Si la altura y el ancho son suficientes, dibujamos en 2 líneas
    if (h >= 36 && w >= 50) {
        // Línea 1: Etiqueta (bold)
        const labelFontSize = Math.max(8, Math.min(12, Math.floor(h / 4)));
        ctx.font = `bold ${labelFontSize}px sans-serif`;
        
        let labelText = textLabel;
        const maxLabelW = w - 8;
        if (ctx.measureText(labelText).width > maxLabelW) {
            while (labelText.length > 0 && ctx.measureText(labelText + '...').width > maxLabelW) {
                labelText = labelText.slice(0, -1);
            }
            labelText += '...';
        }
        ctx.fillText(labelText, x + w / 2, y + h / 2 - 7);

        // Línea 2: Dimensiones (más pequeño y color suave)
        const dimFontSize = Math.max(7, Math.min(10, Math.floor(h / 5)));
        ctx.font = `${dimFontSize}px sans-serif`;
        ctx.fillStyle = '#000000'; // Negro puro
        
        let dimText = textDim;
        const maxDimW = w - 8;
        if (ctx.measureText(dimText).width > maxDimW) {
            while (dimText.length > 0 && ctx.measureText(dimText).width > maxDimW) {
                dimText = dimText.slice(0, -1);
            }
        }
        ctx.fillText(dimText, x + w / 2, y + h / 2 + 7);
    } else {
        // Una sola línea: intentamos "Etiqueta (Dim)" o solo "Dim" o "Etiqueta" truncada
        const fontSize = Math.max(7, Math.min(10, Math.floor(h / 2.2)));
        ctx.font = `bold ${fontSize}px sans-serif`;
        
        let textToDraw = textLabel;
        if (w >= 100) {
            textToDraw = `${textLabel} (${textDim})`;
        }
        
        const maxW = w - 6;
        if (ctx.measureText(textToDraw).width > maxW) {
            textToDraw = textDim;
            if (ctx.measureText(textToDraw).width > maxW) {
                textToDraw = textLabel;
                while (textToDraw.length > 0 && ctx.measureText(textToDraw + '...').width > maxW) {
                    textToDraw = textToDraw.slice(0, -1);
                }
                textToDraw += '...';
            }
        }
        ctx.fillText(textToDraw, x + w / 2, y + h / 2);
    }
}
function printAllSheets() {
    if (!currentResult) return;
    const sheetW = parseInt(document.getElementById('sheet-width').value);
    const sheetH = parseInt(document.getElementById('sheet-height').value);
    const clientName = document.getElementById('sheet-client') ? document.getElementById('sheet-client').value.trim() : '';
    const materialName = document.getElementById('sheet-material') ? document.getElementById('sheet-material').value.trim() : 'LAMINADO 3+3';
    const printW = 1200;
    const scale = (printW - 40) / sheetW;

    // Calcular columnas dinámicas para optimizar el tamaño de la hoja (Hoja de Ruta)
    const N = piezasList.length;
    const C = Math.min(4, Math.ceil(N / 6)) || 1; // Entre 1 y 4 columnas según la cantidad de ítems
    const R = Math.ceil(N / C); // Filas por columna

    let columnsHtml = '';
    for (let colIdx = 0; colIdx < C; colIdx++) {
        const startIdx = colIdx * R;
        const endIdx = Math.min(startIdx + R, N);
        const columnPieces = piezasList.slice(startIdx, endIdx);

        if (columnPieces.length === 0) continue;

        const rowsHtml = columnPieces.map((p, idx) => {
            const globalIdx = startIdx + idx + 1;
            return `
                <tr>
                    <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: bold; color: #0066e2;">${globalIdx}</td>
                    <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;" title="${p.label || 'Vidrio'}">${p.label || 'Vidrio'}</td>
                    <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: 600; white-space: nowrap;">${p.w0} x ${p.h0}</td>
                    <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: bold; color: #0f172a;">${p.cant}</td>
                </tr>
            `;
        }).join('');

        columnsHtml += `
            <div style="border: 1px solid #cbd5e1; border-radius: 6px; background-color: #ffffff; padding: 10px; box-sizing: border-box; page-break-inside: avoid;">
                <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                    <thead>
                        <tr style="background-color: #f1f5f9; color: #475569; font-weight: bold; text-align: left;">
                            <th style="padding: 6px 8px; border-bottom: 2px solid #cbd5e1; text-align: center; width: 35px;">Item</th>
                            <th style="padding: 6px 8px; border-bottom: 2px solid #cbd5e1;">Etiqueta</th>
                            <th style="padding: 6px 8px; border-bottom: 2px solid #cbd5e1; text-align: center; width: 90px;">Medida (mm)</th>
                            <th style="padding: 6px 8px; border-bottom: 2px solid #cbd5e1; text-align: center; width: 40px;">Cant.</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    }

    const imagesHtml = currentResult.plano.map((sheet, idx) => {
        const curSheetW = sheet.sheetW || sheetW;
        const curSheetH = sheet.sheetH || sheetH;
        const curScale = (printW - 40) / curSheetW;

        const tempCanvas = document.createElement('canvas');
        renderSheetToCanvas(tempCanvas, sheet, curSheetW, curSheetH, curScale, true);
        const dataUrl = tempCanvas.toDataURL();

        const sheetArea = curSheetW * curSheetH;
        const placedArea = sheet.cortes.reduce((acc, c) => acc + c.ancho * c.alto, 0);
        const utilPct = sheetArea > 0 ? ((placedArea / sheetArea) * 100).toFixed(1) : '0.0';

        const sheetTitle = sheet.isDesperdicio 
            ? `RETAL REAPROVECHADO N° ${idx + 1} (${curSheetW}x${curSheetH} mm - Sin ID) &bull; ${sheet.material || materialName}`
            : `LÁMINA N° ${idx + 1} de ${currentResult.numeroLaminas} ${sheet.laminaIdRef ? `[ID #${sheet.laminaIdRef}]` : ''}${sheet.laminaUbicacion ? ` (${sheet.laminaUbicacion})` : ''} &bull; ${materialName}`;

        return `
            <div class="sheet-container">
                <div class="sheet-header">
                    <h2>${sheetTitle}</h2>
                    <span>Medidas: <strong>${curSheetW}x${curSheetH} mm</strong> &bull; Aprovechamiento: <strong>${utilPct}%</strong> (${(placedArea / 1000000).toFixed(2)} m²)</span>
                </div>
                <img src="${dataUrl}" />
            </div>
            ${idx < currentResult.plano.length - 1 ? '<div class="page-break"></div>' : ''}
        `;
    }).join('');

    const win = window.open();
    win.document.write(`
        <html>
        <head>
            <title>Plano de Despiece Completo - ${clientName || 'Vidrios Exito'}</title>
            <style>
                @page {
                    size: landscape;
                    margin: 8mm;
                }
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    color: #1e293b;
                    margin: 0;
                    padding: 0;
                    background-color: #ffffff;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .main-header {
                    text-align: center;
                    border-bottom: 2px solid #0066e2;
                    padding-bottom: 8px;
                    margin-bottom: 20px;
                }
                .main-header h1 {
                    margin: 0;
                    font-size: 22px;
                    color: #0066e2;
                    text-transform: uppercase;
                }
                .main-header p {
                    margin: 4px 0 0 0;
                    font-size: 13px;
                    color: #64748b;
                    font-weight: bold;
                }
                .metadata-grid {
                    display: grid;
                    grid-template-columns: repeat(5, 1fr);
                    gap: 10px;
                    margin: 10px 0;
                    font-size: 11px;
                    background: #f8fafc;
                    padding: 8px 12px;
                    border-radius: 6px;
                    border: 1px solid #e2e8f0;
                }
                .sheet-container {
                    margin-bottom: 15px;
                    page-break-inside: avoid;
                    max-height: 180mm;
                    display: flex;
                    flex-direction: column;
                    box-sizing: border-box;
                }
                .sheet-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                    border-bottom: 1px solid #e2e8f0;
                    padding-bottom: 4px;
                    flex-shrink: 0;
                }
                .sheet-header h2 {
                    margin: 0;
                    font-size: 14px;
                    color: #1e293b;
                    font-weight: bold;
                }
                .sheet-header span {
                    font-size: 11px;
                    color: #475569;
                }
                img {
                    max-width: 100%;
                    max-height: 162mm;
                    width: auto;
                    height: auto;
                    display: block;
                    margin: 0 auto;
                }
                .page-break {
                    page-break-before: always;
                }
                .no-print-btn {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    padding: 12px 24px;
                    font-weight: bold;
                    background: #0066e2;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    box-shadow: 0 4px 10px rgba(0,102,226,0.3);
                    font-size: 14px;
                    z-index: 10000;
                }
                .no-print-btn:hover {
                    background: #0052b4;
                }
                @media print {
                    .no-print-btn {
                        display: none;
                    }
                }
            </style>
        </head>
        <body>
            <div class="main-header">
                <h1>Vidrios Exito - Plano General de Despiece 2D</h1>
                <p>Reporte de Corte y Optimización de Láminas</p>
            </div>

            <div class="metadata-grid">
                <div><strong>Lámina Base:</strong> ${sheetW} x ${sheetH} mm</div>
                <div><strong>Láminas Totales:</strong> ${currentResult.numeroLaminas} uds</div>
                <div><strong>Cliente / Proyecto:</strong> ${clientName || 'N/A'}</div>
                <div><strong>Material:</strong> ${materialName}</div>
                <div><strong>Fecha de Emisión:</strong> ${new Date().toLocaleDateString('es-ES')}</div>
            </div>

            <div style="margin-top: 30px; border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 20px; background-color: #f8fafc; page-break-inside: avoid;">                <h3 style="margin-top: 0; color: #0f172a; border-bottom: 2px solid #0066e2; padding-bottom: 6px; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 800; margin-bottom: 15px;">
                    📋 Lista de Medidas a Cortar (Hoja de Ruta)
                </h3>
                <div style="display: grid; grid-template-columns: repeat(${C}, 1fr); gap: 15px;">
                    ${columnsHtml}
                </div>
            </div>

            <div class="page-break"></div>

            ${imagesHtml}

            <button class="no-print-btn" onclick="window.print()">
                🖨️ Imprimir Todos los Planos
            </button>
        </body>
        </html>
    `);
    win.document.close();
}

function printProductionLabels() {
    if (!currentResult) return;
    const clientName = document.getElementById('sheet-client') ? document.getElementById('sheet-client').value.trim() : '';
    const materialName = document.getElementById('sheet-material') ? document.getElementById('sheet-material').value.trim() : 'LAMINADO 3+3';
    let allPlacedPieces = [];
    currentResult.plano.forEach((sheet) => {
        sheet.cortes.forEach((c, idx) => {
            allPlacedPieces.push({
                ...c,
                sheetNumber: sheet.numero,
                isDesperdicioSheet: sheet.isDesperdicio,
                laminaIdRef: sheet.laminaIdRef,
                laminaUbicacion: sheet.laminaUbicacion,
                pieceIdxInSheet: idx + 1
            });
        });
    });

    const totalPieces = allPlacedPieces.length;
    if (totalPieces === 0) return;

    const chunkSize = 200;

    // Mostrar advertencia si hay más de 200 rótulos y se abrirán múltiples pestañas
    if (totalPieces > chunkSize) {
        const tabsCount = Math.ceil(totalPieces / chunkSize);
        alert(`Se abrirán ${tabsCount} pestañas de impresión para procesar los ${totalPieces} rótulos sin congelar el navegador (límite de 200 por pestaña).\n\nSi el navegador bloquea las ventanas emergentes, por favor permite los pop-ups para esta página.`);
    }

    const today = new Date();
    const fechaLabel = today.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });

    for (let chunkIdx = 0; chunkIdx < totalPieces; chunkIdx += chunkSize) {
        const chunkPieces = allPlacedPieces.slice(chunkIdx, chunkIdx + chunkSize);
        
        const labelsHtml = chunkPieces.map((p, i) => {
            const globalIdx = chunkIdx + i;
            const isLastLabel = i === chunkPieces.length - 1;
            const typeLabel = p.isDesperdicioSheet ? 'RETAL' : 'LAM';
            const idBadge = p.laminaIdRef ? ` [ID #${p.laminaIdRef}]` : '';
            return `
<div class="label${isLastLabel ? ' last' : ''}">
  <!-- ENCABEZADO SUPERIOR: Empresa | Fecha | Secuencia -->
  <div class="top-bar">
    <span class="brand">
      <img src="recursos/logove.png" class="logo-img" />
      VIDRIOS EXITO
    </span>
    <span class="fecha">${fechaLabel}</span>
    <span class="seq">#${globalIdx + 1}/${totalPieces} &bull; ${typeLabel} ${p.sheetNumber}${idBadge}</span>
  </div>
  <!-- ZONA PRINCIPAL: Dimensiones grandes + datos -->
  <div class="main-area">
    <!-- DIMENSIONES (lado izquierdo, lo más importante) -->
    <div class="dims-block">
      <div class="dim-pair">
        <span class="dim-val">${p.w0}</span>
        <span class="dim-unit">mm</span>
      </div>
      <div class="dim-x">×</div>
      <div class="dim-pair">
        <span class="dim-val">${p.h0}</span>
        <span class="dim-unit">mm</span>
      </div>
      <div class="dim-material">${materialName}</div>
    </div>

    <!-- DIVISOR VERTICAL -->
    <div class="vdivider"></div>

    <div class="meta-block">
      <div class="pieza-zone">
        <!-- Título PIEZA -->
        <div class="pieza-title">PIEZA</div>
        <!-- Nombre grande (dinámico) -->
        <div class="pieza-name">${p.label || 'Vidrio'}</div>
      </div>
      <!-- Divisor -->
      <div class="sec-divider"></div>
      <!-- Cliente y posición como fila secundaria -->
      <div class="meta-secondary">
        <div class="cliente-item">
          <span class="sec-lbl">CLIENTE</span>
          <span class="cliente-val">${clientName || '—'}</span>
        </div>
        <div class="pos-item">
          <span class="sec-lbl">POS</span>
          <span class="pos-val">X:${p.x} Y:${p.y}${p.laminaUbicacion ? ` &bull; ${p.laminaUbicacion}` : ''}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- PIE: Alerta de rotación -->
  <div class="foot-bar">
    ${p.rot
        ? '<span class="rot-alert">PIEZA ROTADA — VERIFICAR ORIENTACIÓN</span>'
        : '<span class="rot-ok">Orientación estándar</span>'
    }
  </div>
</div>
            `;
        }).join('\n');

        const win = window.open('', '_blank');
        if (!win) {
            alert('No se pudo abrir la pestaña de impresión. Por favor, habilita las ventanas emergentes (pop-ups) en tu navegador para este sitio.');
            break;
        }

        win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <base href="${window.location.href}">
  <title>Rotulos Vidrios Exito - Lote ${(chunkIdx / chunkSize) + 1}</title>
  <style>
    /* ===== CONFIGURACIÓN TÉRMICA 80mm x 40mm ===== */
    @page {
      size: 80mm 40mm;
      margin: 0;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: Arial, 'Arial Black', Helvetica, sans-serif;
      font-size: 11px;
      font-weight: bold;
      background: #fff;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ===== LABEL WRAPPER ===== */
    .label {
      position: relative;
      width: 80mm;
      height: 40mm;
      padding: 1mm 1.5mm 0.8mm 1.5mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      page-break-after: always;
      break-after: page;
      overflow: hidden;
      background: #fff;
    }
    .label.last {
      page-break-after: auto;
      break-after: auto;
    }
    /* ===== BARRA SUPERIOR ===== */
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5mm;
      font-size: 8px;
    }
    .brand {
      font-size: 8.5px;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      padding-left: 8.8mm;
      white-space: nowrap;
    }
    .logo-img {
      position: absolute;
      top: 0mm;
      left: 1.5mm;
      height: 8.0mm;
      width: auto;
      z-index: 10;
    }
    .fecha {
      font-size: 8px;
      letter-spacing: 0.2px;
      white-space: nowrap;
    }
    .seq {
      font-size: 8px;
      letter-spacing: 0.1px;
      white-space: nowrap;
    }
    /* ===== ÁREA PRINCIPAL ===== */
    .main-area {
      display: flex;
      flex-direction: row;
      align-items: center;
      height: 29.5mm;
      flex-shrink: 0;
      gap: 0;
    }
    /* BLOQUE DE DIMENSIONES */
    .dims-block {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-width: 33mm;
      width: 33mm;
      flex-shrink: 0;
      padding-right: 1mm;
    }
    .dim-pair {
      display: flex;
      align-items: baseline;
      justify-content: center;
      line-height: 1;
    }
    .dim-val {
      font-size: 32px;
      font-weight: 900;
      letter-spacing: -0.5px;
      line-height: 1;
    }
    .dim-unit {
      font-size: 11px;
      margin-left: 1px;
      line-height: 1;
      margin-bottom: 3px;
    }
    .dim-x {
      font-size: 16px;
      font-weight: 900;
      line-height: 1;
      margin: 0.1mm 0;
    }
    .dim-material {
      font-size: 8px;
      font-weight: bold;
      text-transform: uppercase;
      margin-top: 1.5mm;
      text-align: center;
      width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .vdivider {
      width: 0.8px;
      background: #000;
      align-self: stretch;
      margin: 0 1.5mm;
      flex-shrink: 0;
    }
    /* ===== BLOQUE METADATOS Y PIEZA ===== */
    .meta-block {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
      height: 29.5mm;
    }
    .pieza-zone {
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      height: 14.5mm;
      overflow: hidden;
    }
    .pieza-title {
      font-size: 12px;
      font-weight: bold;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      line-height: 1.1;
      margin-bottom: 0.3mm;
    }
    .pieza-name {
      font-size: 30px;
      font-weight: 900;
      line-height: 1.1;
      letter-spacing: -0.3px;
      overflow: hidden;
      height: 38px;
      word-break: break-word;
    }
    .meta-secondary {
      display: flex;
      flex-direction: column;
      height: 11.5mm;
      justify-content: space-between;
      overflow: hidden;
    }
    .cliente-item {
      display: block;
      max-height: 24px;
      overflow: hidden;
      line-height: 1.15;
    }
    .cliente-val {
      font-size: 11px;
      font-weight: bold;
      word-break: break-word;
    }
    .pos-item {
      display: block;
      height: 12px;
      overflow: hidden;
      line-height: 1.15;
      font-size: 11px;
      font-weight: bold;
      white-space: nowrap;
    }
    .sec-lbl {
      font-size: 7px;
      letter-spacing: 0.5px;
      margin-right: 0.5mm;
    }

    .sec-divider {
      width: 100%;
      height: 0.8px;
      background: #000;
      margin: 0.5mm 0;
      flex-shrink: 0;
    }
    /* ===== PIE DE LABEL ===== */
    .foot-bar {
      border-top: 0.8px solid #000;
      padding-top: 0.5mm;
      text-align: center;
      letter-spacing: 0.3px;
      font-size: 8px;
      white-space: nowrap;
    }
    .rot-alert {
      letter-spacing: 0.5px;
    }
    .rot-ok {

    }

    /* ===== PANTALLA: Vista previa con separación ===== */
    @media screen {
      body {
        background: #e5e7eb;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 20px;
        gap: 10px;
      }
      .label {
        border: 1px solid #000;
        box-shadow: 2px 2px 6px rgba(0,0,0,0.18);
        border-radius: 3px;
      }
      .no-print-btn {
        position: fixed;
        bottom: 24px;
        right: 24px;
        padding: 14px 28px;
        background: #1e293b;
        color: #fff;
        font-family: sans-serif;
        font-weight: 800;
        font-size: 14px;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        z-index: 9999;
        letter-spacing: 0.3px;
      }
      .no-print-btn:hover {
        background: #0f172a;
      }
    }

    /* Ocultar botón en impresión */
    @media print {
      body {
        background: #fff;
      }
      .no-print-btn {
        display: none !important;
      }
    }
  </style>
</head>
<body>

${labelsHtml}

<button class="no-print-btn" onclick="window.print()">🖨️ Imprimir Rótulos (Lote ${(chunkIdx / chunkSize) + 1})</button>
<script>
// Auto-fit: reduce font-size si el texto desborda su contenedor (horizontalmente para una línea)
function autoFitText(el, maxPx, minPx) {
  let size = maxPx;
  el.style.fontSize = size + 'px';
  while (el.scrollWidth > el.clientWidth && size > minPx) {
    size -= 0.5;
    el.style.fontSize = size + 'px';
  }
}
// Auto-fit para pieza-name que puede tener hasta 2 líneas (basado en altura vertical de su caja)
function autoFitPieceName(el, maxPx, minPx) {
  let size = maxPx;
  el.style.fontSize = size + 'px';
  while (el.scrollHeight > el.clientHeight && size > minPx) {
    size -= 0.5;
    el.style.fontSize = size + 'px';
  }
}

// Auto-fit para el cliente (basado en la altura vertical de la caja cliente-item)
function autoFitCliente(el, maxPx, minPx) {
  const valEl = el.querySelector('.cliente-val');
  if (!valEl) return;
  let size = maxPx;
  valEl.style.fontSize = size + 'px';
  while (el.scrollHeight > el.clientHeight && size > minPx) {
    size -= 0.5;
    valEl.style.fontSize = size + 'px';
  }
}

window.addEventListener('load', function () {
  // Ajustar dimensiones (max 32px, min 16px) — por cada dim-pair individualmente
  document.querySelectorAll('.dim-pair').forEach(el => autoFitText(el, 32, 16));
  // Ajustar material debajo de la medida (max 8px, min 5.5px)
  document.querySelectorAll('.dim-material').forEach(el => autoFitText(el, 8, 5.5));
  // Ajustar nombre de pieza (max 30px, min 9px)
  document.querySelectorAll('.pieza-name').forEach(el => autoFitPieceName(el, 30, 9));
  // Ajustar cliente (max 11px, min 7px)
  document.querySelectorAll('.cliente-item').forEach(el => autoFitCliente(el, 11, 7));
  // Ajustar pos (max 11px, min 7px)
  document.querySelectorAll('.pos-item').forEach(el => autoFitText(el, 11, 7));
});
</script>
</body>
</html>`);
        win.document.close();
    }
}

// --- ALGORITMOS DE OPTIMIZACIÓN POR GUILLOTINA MULTI-ETAPA (GUILLOTINE-PACKING) ---

// Funciones para la ÚLTIMA LÁMINA: Corte vertical por columnas y orientación vertical de piezas
function findBestRectForPieceVertical(freeRects, pw, ph, allowRotate, sheetH, preferVertical) {
    let orientations = [];

    if (!allowRotate || pw === ph) {
        orientations.push({ w: pw, h: ph, rot: false, isVert: (ph >= pw) });
    } else {
        const minDim = Math.min(pw, ph);
        const maxDim = Math.max(pw, ph);

        if (preferVertical) {
            // Intentar orientación VERTICAL primero (alto >= ancho) si cabe en la altura de la lámina
            if (maxDim <= sheetH) {
                orientations.push({
                    w: minDim,
                    h: maxDim,
                    rot: (pw !== minDim),
                    isVert: true
                });
            }
            // Fallback horizontal (si no cabe verticalmente o si maxDim > sheetH)
            orientations.push({
                w: maxDim,
                h: minDim,
                rot: (pw !== maxDim),
                isVert: false
            });
        } else {
            orientations.push({ w: pw, h: ph, rot: false, isVert: (ph >= pw) });
            orientations.push({ w: ph, h: pw, rot: true, isVert: (pw >= ph) });
        }
    }

    // Si preferVertical es true, intentamos colocar en orientación vertical PRIMERO
    // Solo si no cabe en ningún rectángulo libre verticalmente, pasamos al fallback horizontal
    const orientationGroups = preferVertical && orientations.length > 1
        ? [ [orientations[0]], [orientations[1]] ]
        : [ orientations ];

    for (const group of orientationGroups) {
        let bestFit = null;

        for (const rect of freeRects) {
            for (const o of group) {
                if (o.w <= rect.w && o.h <= rect.h) {
                    // Puntuación optimizada para empaquetado en columnas verticales:
                    // 1. Menor rect.x: mantenerse a la izquierda (llenar columnas abiertas antes de abrir una nueva)
                    // 2. Menor sobrante de ancho (rect.w - o.w): ajustar bien al ancho de la columna
                    // 3. Menor rect.y: apilar desde abajo hacia arriba
                    const score = {
                        x: rect.x,
                        leftoverW: rect.w - o.w,
                        y: rect.y
                    };

                    if (!bestFit ||
                        score.x < bestFit.score.x ||
                        (score.x === bestFit.score.x && score.leftoverW < bestFit.score.leftoverW) ||
                        (score.x === bestFit.score.x && score.leftoverW === bestFit.score.leftoverW && score.y < bestFit.score.y)) {
                        bestFit = {
                            rect,
                            w: o.w,
                            h: o.h,
                            rot: o.rot,
                            isVert: o.isVert,
                            score
                        };
                    }
                }
            }
        }

        if (bestFit) {
            return bestFit;
        }
    }

    return null;
}

// Función para consolidar y fusionar sobrantes contiguos (prioridad vertical a todo lo alto)
function mergeFreeRects(rects) {
    if (!rects || rects.length <= 1) return rects ? rects.map(r => ({ ...r })) : [];
    let merged = rects.map(r => ({ ...r }));
    let changed = true;

    while (changed) {
        changed = false;
        // 1. Fusión VERTICAL prioritaria (mismo X, mismo ancho, continuos en Y)
        for (let i = 0; i < merged.length; i++) {
            for (let j = 0; j < merged.length; j++) {
                if (i === j) continue;
                const r1 = merged[i];
                const r2 = merged[j];
                if (Math.abs(r1.x - r2.x) < 0.01 && Math.abs(r1.w - r2.w) < 0.01) {
                    if (Math.abs((r1.y + r1.h) - r2.y) < 0.01) {
                        r1.h += r2.h;
                        merged.splice(j, 1);
                        changed = true;
                        break;
                    }
                }
            }
            if (changed) break;
        }

        if (changed) continue;

        // 2. Fusión HORIZONTAL secundaria (mismo Y, misma altura, continuos en X)
        for (let i = 0; i < merged.length; i++) {
            for (let j = 0; j < merged.length; j++) {
                if (i === j) continue;
                const r1 = merged[i];
                const r2 = merged[j];
                if (Math.abs(r1.y - r2.y) < 0.01 && Math.abs(r1.h - r2.h) < 0.01) {
                    if (Math.abs((r1.x + r1.w) - r2.x) < 0.01) {
                        r1.w += r2.w;
                        merged.splice(j, 1);
                        changed = true;
                        break;
                    }
                }
            }
            if (changed) break;
        }
    }

    // Filtrar despuntes / refiles diminutos (< 60mm en cualquier lado)
    return merged.filter(r => r.w >= 60 && r.h >= 60);
}

function packSingleSheetVertical(sheetW, sheetH, availablePieces, allowRotate, sortFn, preferVertical) {
    const pieces = availablePieces.map(p => ({ ...p })).sort(sortFn);

    const sheet = {
        freeRects: [{ x: 0, y: 0, w: sheetW, h: sheetH }],
        placed: []
    };

    for (const p of pieces) {
        const fit = findBestRectForPieceVertical(sheet.freeRects, p.w, p.h, allowRotate, sheetH, preferVertical);
        if (fit) {
            const rect = fit.rect;
            sheet.freeRects.splice(sheet.freeRects.indexOf(rect), 1);

            const pieceW = fit.w;
            const pieceH = fit.h;

            sheet.placed.push({
                id: p.id,
                x: rect.x,
                y: rect.y,
                ancho: pieceW,
                alto: pieceH,
                w0: p.w,
                h0: p.h,
                rot: fit.rot,
                label: p.label || '',
                descripcion: (p.label ? `${p.label} (${p.w}x${p.h})` : `${p.w}x${p.h}`) + (fit.rot ? ' (R)' : '')
            });

            // Regla de corte para la última lámina:
            // Si rect.y === 0 y rect.h === sheetH -> Corte estrictamente vertical (SASV)
            // a todo lo alto de la lámina, creando una columna vertical y dejando el resto
            // de la lámina a la derecha intacta a todo lo alto.
            // Si rect.y > 0 (dentro de la columna) -> Corte horizontal (SASH) para apilar piezas.
            let actualSplitRule = 'SASV';
            if (rect.y > 0) {
                actualSplitRule = 'SASH';
            } else if (rect.h < sheetH) {
                actualSplitRule = 'SASV';
            }

            const subRects = splitFreeRect(rect, pieceW, pieceH, actualSplitRule);
            sheet.freeRects.push(...subRects);
        }
    }

    const placedArea = sheet.placed.reduce((sum, c) => sum + c.ancho * c.alto, 0);

    let maxX = 0;
    let maxY = 0;
    for (const cut of sheet.placed) {
        if (cut.x + cut.ancho > maxX) maxX = cut.x + cut.ancho;
        if (cut.y + cut.alto > maxY) maxY = cut.y + cut.alto;
    }

    return {
        freeRects: mergeFreeRects(sheet.freeRects),
        placed: sheet.placed,
        placedArea,
        maxX,
        maxY,
        compactness: maxX * maxY
    };
}

function packLastSheetOptimized(sheetW, sheetH, availablePieces, allowRotate) {
    const sortFns = [
        // 1. Dimensión máxima descendente (piezas más altas primero para anclar columnas)
        (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h),
        // 2. Ancho descendente en orientación vertical (columnas más anchas primero)
        (a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h),
        // 3. Área descendente
        (a, b) => b.area - a.area,
        // 4. Ancho ascendente (columnas delgadas primero)
        (a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h),
        // 5. Alto descendente
        (a, b) => b.h - a.h,
        // 6. Ancho descendente
        (a, b) => b.w - a.w
    ];

    let bestSheet = null;

    // Intento 1: Priorizar fuertemente que las piezas se coloquen verticalmente (alto >= ancho)
    for (const sortFn of sortFns) {
        const res = packSingleSheetVertical(sheetW, sheetH, availablePieces, allowRotate, sortFn, true);
        if (res && res.placed.length > 0) {
            if (!bestSheet ||
                res.placed.length > bestSheet.placed.length ||
                (res.placed.length === bestSheet.placed.length && res.maxX < bestSheet.maxX) ||
                (res.placed.length === bestSheet.placed.length && res.maxX === bestSheet.maxX && res.maxY < bestSheet.maxY)) {
                bestSheet = res;
            }
        }
    }

    if (bestSheet && bestSheet.placed.length === availablePieces.length) {
        return bestSheet;
    }

    // Intento 2: Si no cupieron todas con orientación vertical forzada, permitir orientación flexible pero manteniendo cortes en columnas verticales
    for (const sortFn of sortFns) {
        const res = packSingleSheetVertical(sheetW, sheetH, availablePieces, allowRotate, sortFn, false);
        if (res && res.placed.length > 0) {
            if (!bestSheet ||
                res.placed.length > bestSheet.placed.length ||
                (res.placed.length === bestSheet.placed.length && res.maxX < bestSheet.maxX)) {
                bestSheet = res;
            }
        }
    }

    return bestSheet;
}

function packSingleSheet(sheetW, sheetH, availablePieces, allowRotate, sortFn, heur, splitRule, strategy) {
    const pieces = availablePieces.map(p => ({ ...p })).sort(sortFn);
    
    const sheet = {
        freeRects: [{ x: 0, y: 0, w: sheetW, h: sheetH }],
        placed: []
    };

    for (const p of pieces) {
        const fit = findBestRectForPiece(sheet.freeRects, p.w, p.h, allowRotate, heur);
        if (fit) {
            const rect = fit.rect;
            sheet.freeRects.splice(sheet.freeRects.indexOf(rect), 1);

            const pieceW = fit.w;
            const pieceH = fit.h;

            sheet.placed.push({
                id: p.id,
                x: rect.x,
                y: rect.y,
                ancho: pieceW,
                alto: pieceH,
                w0: p.w,
                h0: p.h,
                rot: fit.rot,
                label: p.label || '',
                descripcion: (p.label ? `${p.label} (${p.w}x${p.h})` : `${p.w}x${p.h}`) + (fit.rot ? ' (R)' : '')
            });

            let actualSplitRule = splitRule;
            if (strategy === 'GUIL_ROWS') {
                actualSplitRule = (rect.y === 0 && rect.h === sheetH) ? 'SASH' : splitRule;
            } else {
                // Para cortes de guillotina en vidrio (AUTO, GUIL_COLS, VERT_FIRST):
                // Los cortes principales son estrictamente VERTICALES a todo lo alto (SASV).
                // 1. Si el rectángulo inicia en el borde superior o tiene la altura completa de la lámina (rect.y === 0 || rect.h === sheetH):
                //    El corte es VERTICAL (SASV). Deja el sobrante a la derecha intacto y COMPLETO a todo lo alto (h = sheetH).
                // 2. Si el rectángulo está dentro de una columna ya abierta (rect.y > 0):
                //    El corte es HORIZONTAL (SASH) para apilar piezas verticalmente dentro del ancho de la columna sin cortar hacia la derecha.
                if (rect.y === 0 || rect.h === sheetH) {
                    actualSplitRule = 'SASV';
                } else if (rect.y > 0) {
                    actualSplitRule = 'SASH';
                }
            }

            const subRects = splitFreeRect(rect, pieceW, pieceH, actualSplitRule);
            sheet.freeRects.push(...subRects);
        }
    }

    const placedArea = sheet.placed.reduce((sum, c) => sum + c.ancho * c.alto, 0);
    
    // Calcular compacidad de ESTA lámina
    let maxX = 0;
    let maxY = 0;
    for (const cut of sheet.placed) {
        if (cut.x + cut.ancho > maxX) maxX = cut.x + cut.ancho;
        if (cut.y + cut.alto > maxY) maxY = cut.y + cut.alto;
    }
    const compactness = maxX * maxY;

    return {
        freeRects: mergeFreeRects(sheet.freeRects),
        placed: sheet.placed,
        placedArea,
        compactness
    };
}

function guillotinePack(sheetW, sheetH, pieces, allowRotate, strategy) {
    // 1. Aplanar las piezas a cortar según su cantidad
    let flatPieces = [];
    let gid = 1;
    for (const p of pieces) {
        const qty = p.cantidad || p.cant || 1;
        for (let i = 0; i < qty; i++) {
            flatPieces.push({
                id: gid++,
                w: p.ancho,
                h: p.alto,
                area: p.ancho * p.alto,
                label: p.label || '',
                originalId: p.originalId
            });
        }
    }

    // 2. Definir funciones de ordenamiento
    const sortFns = [
        // Ordenar por área descendente
        (a, b) => b.area - a.area,
        // Ordenar por dimensión máxima descendente
        (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h),
        // Ordenar por dimensión mínima descendente
        (a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h),
        // Ordenar por altura descendente
        (a, b) => b.h - a.h,
        // Ordenar por ancho descendente
        (a, b) => b.w - a.w
    ];

    // 3. Heurísticas de selección de rectángulo libre
    const selectionHeuristics = ['BAF', 'BSSF', 'BLSF'];

    // 4. Reglas de división de espacio sobrante (priorizando cortes verticales en vidrio)
    const splitRules = ['SASV', 'SASH', 'SLAS', 'LLAS'];

    // 5. Estrategias de guillotina a evaluar:
    // Los cortes principales en vidrio son estrictamente verticales, por lo que en AUTO se prioriza GUIL_COLS
    const strategies = strategy === 'AUTO' ? ['GUIL_COLS'] : [strategy];

    let remainingPieces = flatPieces.map(p => ({ ...p }));
    const sheets = [];

    // Empaquetar lámina por lámina de forma independiente (greedy sheet-by-sheet)
    while (remainingPieces.length > 0) {
        // VERIFICAR SI ESTA ES LA ÚLTIMA LÁMINA:
        // Una lámina es la última lámina si todas las piezas restantes caben en una sola lámina.
        // Requerimiento: "solo la ultima lamina haga el corte de manera vertical... QUE INTENTE PONER EL VIDRIO DE MANERA VERTICAL"

        // 1. Probar empaquetado vertical con intento prioritario de colocar las piezas verticalmente (alto >= ancho)
        const vertResult = packLastSheetOptimized(sheetW, sheetH, remainingPieces, allowRotate);

        if (vertResult && vertResult.placed.length === remainingPieces.length) {
            // ¡Cupieron todas las piezas restantes en la última lámina con corte y orientación vertical!
            sheets.push({
                freeRects: vertResult.freeRects,
                placed: vertResult.placed
            });
            remainingPieces = [];
            break;
        }

        // 2. Si no cupieron todas con corte vertical, verificar si cabrían con empaquetado estándar
        // para garantizar que nunca se cree una lámina extra innecesaria
        let standardAllFit = null;
        for (const sortFn of sortFns) {
            for (const heur of selectionHeuristics) {
                for (const splitRule of splitRules) {
                    for (const strat of strategies) {
                        const res = packSingleSheet(sheetW, sheetH, remainingPieces, allowRotate, sortFn, heur, splitRule, strat);
                        if (res && res.placed.length === remainingPieces.length) {
                            if (!standardAllFit || res.compactness < standardAllFit.compactness) {
                                standardAllFit = res;
                            }
                        }
                    }
                }
            }
        }

        if (standardAllFit) {
            // Cabían todas con el estándar; usamos standardAllFit para no añadir una lámina extra
            sheets.push({
                freeRects: standardAllFit.freeRects,
                placed: standardAllFit.placed
            });
            remainingPieces = [];
            break;
        }

        // 3. Si NO caben todas en una sola lámina, es una LÁMINA INTERMEDIA (1 a N-1):
        // Se empaqueta con el optimizador estándar para maximizar el área colocada y compacidad.
        let bestSheetResult = null;
        for (const sortFn of sortFns) {
            for (const heur of selectionHeuristics) {
                for (const splitRule of splitRules) {
                    for (const strat of strategies) {
                        const sheetResult = packSingleSheet(sheetW, sheetH, remainingPieces, allowRotate, sortFn, heur, splitRule, strat);
                        if (sheetResult && sheetResult.placed.length > 0) {
                            if (!bestSheetResult ||
                                sheetResult.placedArea > bestSheetResult.placedArea ||
                                (sheetResult.placedArea === bestSheetResult.placedArea && sheetResult.compactness < bestSheetResult.compactness)) {
                                bestSheetResult = sheetResult;
                            }
                        }
                    }
                }
            }
        }

        if (!bestSheetResult) {
            // Si ninguna pieza cabe en una lámina vacía, salimos
            break;
        }

        // Registrar la lámina elegida
        sheets.push({
            freeRects: bestSheetResult.freeRects,
            placed: bestSheetResult.placed
        });

        // Eliminar las piezas colocadas de la lista de pendientes
        const placedIds = new Set(bestSheetResult.placed.map(p => p.id));
        remainingPieces = remainingPieces.filter(p => !placedIds.has(p.id));
    }

    // Formatear la salida idéntica al modelo de datos del visualizador
    const plano = sheets.map((sh, idx) => ({
        numero: idx + 1,
        cortes: sh.placed,
        sobrantes: mergeFreeRects(sh.freeRects)
    }));

    const totalPlacedArea = plano.reduce((acc, sh) => acc + sh.cortes.reduce((sum, c) => sum + c.ancho * c.alto, 0), 0);
    const waste = sheetW * sheetH * plano.length - totalPlacedArea;

    return {
        numeroLaminas: plano.length,
        plano,
        waste,
        unplacedCount: remainingPieces.length,
        unplacedPieces: remainingPieces
    };
}

// --- OPTIMIZACIÓN UTILIZANDO DESPERDICIOS / RETALES DE INVENTARIO PRIMERO ---
function optimizeDespieceWithDesperdicios(sheetW, sheetH, pieces, allowRotate, strategy, material, selectedLamina, useDesperdicios, inventory) {
    let flatPieces = [];
    let gid = 1;
    for (const p of pieces) {
        const qty = p.cantidad || p.cant || 1;
        for (let i = 0; i < qty; i++) {
            flatPieces.push({
                id: gid++,
                ancho: p.ancho || p.w,
                alto: p.alto || p.h,
                w: p.ancho || p.w,
                h: p.alto || p.h,
                area: (p.ancho || p.w) * (p.alto || p.h),
                label: p.label || '',
                originalId: p.originalId
            });
        }
    }

    let remainingPieces = flatPieces.map(p => ({ ...p }));
    const sheetsPlan = [];

    // PASO 1: Si useDesperdicios está activo, buscar y usar desperdicios del inventario
    if (useDesperdicios && inventory && inventory.length > 0) {
        const availableDesperdicios = [];
        inventory.forEach(item => {
            if (item.tipoItem === 'retal' && (parseInt(item.cantidad) || 0) > 0) {
                // Filtrar por material si está especificado
                const matchMaterial = !material || (item.material && item.material.trim().toUpperCase() === material.trim().toUpperCase());
                if (matchMaterial) {
                    const stock = parseInt(item.cantidad) || 1;
                    for (let s = 0; s < stock; s++) {
                        availableDesperdicios.push({ ...item, stockUnitIndex: s });
                    }
                }
            }
        });

        // Intentar colocar piezas en desperdicios disponibles
        let usedDesperdicioIndices = new Set();
        let progress = true;

        while (progress && remainingPieces.length > 0) {
            progress = false;
            let bestDespOption = null;

            for (let i = 0; i < availableDesperdicios.length; i++) {
                if (usedDesperdicioIndices.has(i)) continue;
                const desp = availableDesperdicios[i];

                const sortFns = [
                    (a, b) => b.area - a.area,
                    (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h),
                    (a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h)
                ];

                let bestPack = null;
                for (const sortFn of sortFns) {
                    const res = packSingleSheet(desp.ancho, desp.alto, remainingPieces, allowRotate, sortFn, 'BAF', 'SASV', 'AUTO');
                    if (res && res.placed.length > 0) {
                        if (!bestPack || res.placedArea > bestPack.placedArea) {
                            bestPack = res;
                        }
                    }
                }

                if (bestPack && bestPack.placed.length > 0) {
                    const despArea = desp.ancho * desp.alto;
                    const util = bestPack.placedArea / despArea;

                    if (!bestDespOption || bestPack.placedArea > bestDespOption.pack.placedArea ||
                        (bestPack.placedArea === bestDespOption.pack.placedArea && util > bestDespOption.util)) {
                        bestDespOption = {
                            despIndex: i,
                            desp,
                            pack: bestPack,
                            util
                        };
                    }
                }
            }

            if (bestDespOption) {
                const { despIndex, desp, pack } = bestDespOption;
                usedDesperdicioIndices.add(despIndex);
                progress = true;

                sheetsPlan.push({
                    numero: sheetsPlan.length + 1,
                    isDesperdicio: true,
                    desperdicioId: desp.id,
                    desperdicioLabel: desp.label || `Retal ${desp.ancho}x${desp.alto}`,
                    material: desp.material || material,
                    sheetW: desp.ancho,
                    sheetH: desp.alto,
                    laminaIdRef: null, // Los desperdicios NO llevan ID
                    cortes: pack.placed,
                    sobrantes: mergeFreeRects(pack.freeRects)
                });

                const placedIds = new Set(pack.placed.map(p => p.id));
                remainingPieces = remainingPieces.filter(p => !placedIds.has(p.id));
            }
        }
    }

    // PASO 2: Si quedan piezas restantes, empaquetarlas en láminas completas
    if (remainingPieces.length > 0) {
        const toPack = remainingPieces.map(p => ({
            id: p.id,
            ancho: p.ancho || p.w,
            alto: p.alto || p.h,
            label: p.label,
            originalId: p.originalId
        }));

        const fullSheetRes = guillotinePack(sheetW, sheetH, toPack, allowRotate, strategy);
        if (fullSheetRes && fullSheetRes.plano) {
            // Obtener láminas completas disponibles en inventario para este material
            const matKey = (material || '').trim().toUpperCase();
            const availableLaminasUnits = [];

            if (inventory && inventory.length > 0) {
                // Filtrar láminas que no sean retales, no archivadas, que coincidan con el material y tengan stock
                const matchingLaminas = inventory.filter(item => {
                    if (item.tipoItem === 'retal') return false;
                    if (item.archived === true) return false;
                    const itemMat = (item.material || '').trim().toUpperCase();
                    const matchMat = !matKey || itemMat === matKey;
                    const hasStock = (parseInt(item.cantidad) || 0) > 0;
                    return matchMat && hasStock;
                });

                // Si el usuario seleccionó una lámina inicial en el selector, colocarla primero
                if (selectedLamina && matchingLaminas.some(l => l.id === selectedLamina.id)) {
                    const selIdx = matchingLaminas.findIndex(l => l.id === selectedLamina.id);
                    const [selItem] = matchingLaminas.splice(selIdx, 1);
                    matchingLaminas.unshift(selItem);
                } else {
                    // Ordenar por idRef ascendente (#1, #2, #3...)
                    matchingLaminas.sort((a, b) => (parseInt(a.idRef) || 9999) - (parseInt(b.idRef) || 9999));
                }

                // Desglosar por unidades de stock (por si alguna tiene cantidad > 1)
                matchingLaminas.forEach(lam => {
                    const qty = parseInt(lam.cantidad) || 1;
                    for (let q = 0; q < qty; q++) {
                        availableLaminasUnits.push({
                            ...lam,
                            unitIndex: q
                        });
                    }
                });
            }

            // Encontrar el ID más alto existente en inventario para este material para continuar secuencia si falta stock
            let highestUsedId = 0;
            if (inventory) {
                inventory.forEach(item => {
                    if (item.tipoItem !== 'retal') {
                        const itemMat = (item.material || '').trim().toUpperCase();
                        if (!matKey || itemMat === matKey) {
                            const num = parseInt(item.idRef);
                            if (!isNaN(num) && num > highestUsedId) highestUsedId = num;
                        }
                    }
                });
            }

            fullSheetRes.plano.forEach((sh, sIdx) => {
                const invUnit = availableLaminasUnits[sIdx];
                let sheetIdRef = null;
                let sheetId = null;
                let sheetUbicacion = '';
                let inStock = false;

                if (invUnit) {
                    sheetIdRef = invUnit.idRef || (sIdx + 1);
                    sheetId = invUnit.id;
                    sheetUbicacion = invUnit.ubicacion || '';
                    inStock = true;
                } else {
                    // Si no hay suficiente stock físico registrado en inventario, asignar siguiente ID correlativo
                    highestUsedId++;
                    sheetIdRef = highestUsedId;
                    sheetId = null;
                    sheetUbicacion = '';
                    inStock = false;
                }

                sheetsPlan.push({
                    numero: sheetsPlan.length + 1,
                    isDesperdicio: false,
                    material: material,
                    sheetW: sheetW,
                    sheetH: sheetH,
                    laminaIdRef: sheetIdRef,
                    laminaId: sheetId,
                    laminaUbicacion: sheetUbicacion,
                    inInventoryStock: inStock,
                    cortes: sh.cortes,
                    sobrantes: mergeFreeRects(sh.sobrantes)
                });
            });
            remainingPieces = fullSheetRes.unplacedPieces || [];
        }
    }

    const totalPlacedArea = sheetsPlan.reduce((acc, sh) => acc + sh.cortes.reduce((sum, c) => sum + c.ancho * c.alto, 0), 0);
    const totalSheetsArea = sheetsPlan.reduce((acc, sh) => acc + sh.sheetW * sh.sheetH, 0);
    const waste = totalSheetsArea - totalPlacedArea;

    return {
        numeroLaminas: sheetsPlan.length,
        desperdiciosUsadosCount: sheetsPlan.filter(s => s.isDesperdicio).length,
        laminasCompletasCount: sheetsPlan.filter(s => !s.isDesperdicio).length,
        plano: sheetsPlan,
        waste,
        totalPlacedArea,
        totalSheetsArea,
        unplacedCount: remainingPieces.length,
        unplacedPieces: remainingPieces
    };
}

function findBestRectForPiece(freeRects, pw, ph, allowRotate, heur) {
    let bestFit = null;

    for (const rect of freeRects) {
        const tryOrientations = [{ w: pw, h: ph, rot: false }];
        if (allowRotate && pw !== ph) {
            tryOrientations.push({ w: ph, h: pw, rot: true });
        }

        for (const o of tryOrientations) {
            if (o.w <= rect.w && o.h <= rect.h) {
                const score = scoreRectFit(rect, o.w, o.h, heur);
                if (!bestFit || 
                    score.primary < bestFit.score.primary || 
                    (score.primary === bestFit.score.primary && score.secondary < bestFit.score.secondary)) {
                    bestFit = {
                        rect,
                        w: o.w,
                        h: o.h,
                        rot: o.rot,
                        score
                    };
                }
            }
        }
    }

    return bestFit;
}

function scoreRectFit(rect, pw, ph, heur) {
    const leftoverW = rect.w - pw;
    const leftoverH = rect.h - ph;

    switch (heur) {
        case 'BAF': { // Best Area Fit (Menor área sobrante)
            const leftoverArea = rect.w * rect.h - pw * ph;
            const minLeftoverSide = Math.min(leftoverW, leftoverH);
            return { primary: leftoverArea, secondary: minLeftoverSide };
        }
        case 'BSSF': { // Best Short Side Fit (Menor lado corto sobrante)
            const minSide = Math.min(leftoverW, leftoverH);
            const maxSide = Math.max(leftoverW, leftoverH);
            return { primary: minSide, secondary: maxSide };
        }
        case 'BLSF': { // Best Long Side Fit (Menor lado largo sobrante)
            const maxSide = Math.max(leftoverW, leftoverH);
            const minSide = Math.min(leftoverW, leftoverH);
            return { primary: maxSide, secondary: minSide };
        }
        default:
            return { primary: leftoverW * leftoverH, secondary: 0 };
    }
}

function splitFreeRect(rect, pw, ph, splitRule) {
    const leftoverW = rect.w - pw;
    const leftoverH = rect.h - ph;

    let useHorizontalSplit = true;

    switch (splitRule) {
        case 'SASH':
            useHorizontalSplit = true;
            break;
        case 'SASV':
            useHorizontalSplit = false;
            break;
        case 'SLAS': // Shorter Leftover Axis Split (Eje sobrante más corto)
            useHorizontalSplit = (leftoverW < leftoverH);
            break;
        case 'LLAS': // Longer Leftover Axis Split (Eje sobrante más largo)
            useHorizontalSplit = (leftoverW >= leftoverH);
            break;
        default:
            useHorizontalSplit = true;
            break;
    }

    const subRects = [];

    if (useHorizontalSplit) {
        // Corte horizontal completo a lo largo del rectángulo
        // Sub-rectángulo derecho: ancho = leftoverW, alto = ph
        // Sub-rectángulo superior: ancho = rect.w, alto = leftoverH
        if (leftoverW > 0 && ph > 0) {
            subRects.push({
                x: rect.x + pw,
                y: rect.y,
                w: leftoverW,
                h: ph
            });
        }
        if (rect.w > 0 && leftoverH > 0) {
            subRects.push({
                x: rect.x,
                y: rect.y + ph,
                w: rect.w,
                h: leftoverH
            });
        }
    } else {
        // Corte vertical completo a lo largo del rectángulo
        // Sub-rectángulo derecho: ancho = leftoverW, alto = rect.h
        // Sub-rectángulo superior: ancho = pw, alto = leftoverH
        if (leftoverW > 0 && rect.h > 0) {
            subRects.push({
                x: rect.x + pw,
                y: rect.y,
                w: leftoverW,
                h: rect.h
            });
        }
        if (pw > 0 && leftoverH > 0) {
            subRects.push({
                x: rect.x,
                y: rect.y + ph,
                w: pw,
                h: leftoverH
            });
        }
    }

    return subRects;
}

// --- HISTORIAL DE DESPIECE 2D EN FIRESTORE ---

async function saveDespieceToHistory(sheetW, sheetH, allowRotate, strategy, result) {
    if (activeHistoryId) {
        console.log("El despiece actual proviene del historial y no ha sido modificado, no se guarda duplicado.");
        return;
    }

    try {
        const clientVal = document.getElementById('sheet-client').value.trim();
        const materialVal = document.getElementById('sheet-material').value.trim();
        const currentUser = auth.currentUser;

        // Calcular aprovechamiento
        const totalSheetsArea = result.totalSheetsArea || (sheetW * sheetH * result.numeroLaminas);
        const totalPlacedArea = result.totalPlacedArea || result.plano.reduce((accSheet, s) => accSheet + s.cortes.reduce((accPiece, p) => accPiece + p.ancho * p.alto, 0), 0);
        const efficiency = totalSheetsArea > 0 ? parseFloat(((totalPlacedArea / totalSheetsArea) * 100).toFixed(1)) : 0;

        const selectedLamina = selectedLaminaId ? laminasInventory.find(l => l.id === selectedLaminaId) : null;

        const historyRecord = {
            clientName: clientVal || 'General',
            material: materialVal || 'LAMINADO 3+3',
            sheetW,
            sheetH,
            allowRotate,
            strategy,
            piezasList: JSON.parse(JSON.stringify(piezasList)),
            createdAt: new Date(),
            createdBy: currentUser ? currentUser.uid : 'anonimo',
            archived: false,
            results: {
                numeroLaminas: result.numeroLaminas,
                laminasCompletasCount: result.laminasCompletasCount ?? result.numeroLaminas,
                desperdiciosUsadosCount: result.desperdiciosUsadosCount ?? 0,
                efficiency: efficiency
            },
            laminaBaseId: selectedLaminaId || null,
            laminaIdRef: selectedLamina ? (selectedLamina.idRef || null) : null,
            laminasIdRefs: (result && result.plano)
                ? result.plano.filter(s => !s.isDesperdicio && s.laminaIdRef).map(s => s.laminaIdRef)
                : (selectedLamina && selectedLamina.idRef ? [selectedLamina.idRef] : []),
            inventarioDescontado: false
        };

        const docRef = await addDoc(collection(db, "despiece2d_history"), historyRecord);
        activeHistoryId = docRef.id; // Marcar como el despiece activo tras guardarse
        console.log("Despiece guardado automáticamente en el historial.");
    } catch (err) {
        console.error("Error al guardar en el historial:", err);
    }
}

function switchDespieceTab(tab) {
    const tabCalcBtn = document.getElementById('tab-despiece-calc');
    const tabInventarioBtn = document.getElementById('tab-despiece-inventario');
    const tabHistoryBtn = document.getElementById('tab-despiece-history');
    const calcContainer = document.getElementById('despiece-calc-container');
    const inventarioContainer = document.getElementById('despiece-inventario-container');
    const historyContainer = document.getElementById('despiece-history-container');

    if (!tabCalcBtn || !calcContainer || !historyContainer) return;

    // Resetear estilos de botones de pestañas
    [tabCalcBtn, tabInventarioBtn, tabHistoryBtn].forEach(btn => {
        if (!btn) return;
        btn.className = "border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition-all flex items-center gap-2 whitespace-nowrap";
    });

    // Ocultar todos los contenedores
    [calcContainer, inventarioContainer, historyContainer].forEach(cnt => {
        if (!cnt) return;
        cnt.classList.add('hidden');
    });

    if (tab === 'calc') {
        calcContainer.classList.remove('hidden');
        tabCalcBtn.className = "border-b-2 border-indigo-600 px-6 py-3 text-sm font-bold text-indigo-650 transition-all flex items-center gap-2 whitespace-nowrap";
    } else if (tab === 'inventario') {
        if (inventarioContainer) inventarioContainer.classList.remove('hidden');
        if (tabInventarioBtn) tabInventarioBtn.className = "border-b-2 border-indigo-600 px-6 py-3 text-sm font-bold text-indigo-650 transition-all flex items-center gap-2 whitespace-nowrap";
        renderInventoryKPIs();
        renderInventoryTable();
    } else if (tab === 'history') {
        historyContainer.classList.remove('hidden');
        if (tabHistoryBtn) tabHistoryBtn.className = "border-b-2 border-indigo-600 px-6 py-3 text-sm font-bold text-indigo-650 transition-all flex items-center gap-2 whitespace-nowrap";
        loadDespieceHistory();
    }
}

async function loadDespieceHistory() {
    const tbody = document.getElementById('despiece-history-body');
    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="9" class="py-12 text-center text-gray-400">
                <div class="flex flex-col items-center justify-center space-y-2">
                    <div class="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center text-gray-300">
                        <i class="fa-solid fa-spinner animate-spin"></i>
                    </div>
                    <p class="text-xs font-semibold text-gray-400">Cargando historial...</p>
                </div>
            </td>
        </tr>
    `;

    try {
        const historyQuery = query(collection(db, "despiece2d_history"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(historyQuery);

        const activeDocs = snapshot.docs.filter(docSnap => docSnap.data().archived !== true);

        if (activeDocs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="py-12 text-center text-gray-400">
                        <div class="flex flex-col items-center justify-center space-y-2">
                            <div class="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center text-gray-300">
                                <i class="fa-solid fa-clock-rotate-left text-xl"></i>
                            </div>
                            <p class="text-xs font-semibold text-gray-400">No hay despieces en el historial todavía</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = '';
        activeDocs.forEach(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;
            const date = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toLocaleString('es-CO') : 'N/A';
            const client = data.clientName || '<span class="text-gray-400 italic">No especificado</span>';
            const material = data.material || '<span class="text-gray-400 italic">Laminado</span>';
            const sheetSize = `${data.sheetW} x ${data.sheetH} mm`;
            
            // Calcular total de piezas
            const piecesCount = data.piezasList ? data.piezasList.reduce((acc, p) => acc + p.cant, 0) : 0;
            const sheetsCount = data.results ? data.results.numeroLaminas : 'N/A';
            const efficiency = data.results ? `${data.results.efficiency}%` : 'N/A';
            const despUsed = data.results?.desperdiciosUsadosCount || 0;
            const usedIds = (data.laminasIdRefs && data.laminasIdRefs.length > 0)
                ? data.laminasIdRefs
                : (data.laminasIdRefsConsumidas && data.laminasIdRefsConsumidas.length > 0)
                    ? data.laminasIdRefsConsumidas
                    : (data.laminaIdRef ? [data.laminaIdRef] : []);
            const lamRefBadge = usedIds.length > 0 
                ? `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 ml-1" title="Láminas asignadas: ${usedIds.map(id => `#${id}`).join(', ')}">${usedIds.length === 1 ? `#${usedIds[0]}` : `#${usedIds.join(', #')}`}</span>` 
                : '';
            const despUsedBadge = despUsed > 0 
                ? `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 ml-1" title="${despUsed} retal(es) de inventario reaprovechado(s)"><i class="fa-solid fa-recycle text-[9px]"></i> +${despUsed} retal</span>` 
                : '';

            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50/50 transition-colors";
            tr.innerHTML = `
                <td class="py-3.5 px-2 font-medium text-slate-500">${date}</td>
                <td class="py-3.5 px-2 font-bold text-slate-800">${client}</td>
                <td class="py-3.5 px-2 font-semibold text-indigo-650">${material} ${lamRefBadge}</td>
                <td class="py-3.5 px-2 font-mono text-xs text-slate-600">${sheetSize}</td>
                <td class="py-3.5 px-2 text-slate-600">${piecesCount} pieza(s)</td>
                <td class="py-3.5 px-2 text-center font-bold text-indigo-700">${sheetsCount} ${despUsedBadge}</td>
                <td class="py-3.5 px-2 text-center font-bold text-emerald-600">${efficiency}</td>
                <td class="py-3.5 px-2 text-center">
                    ${data.inventarioDescontado ? `
                        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800" title="${data.laminasConsumidas || 0} lámina(s) descontada(s), ${data.retalesGuardadosCount || 0} retales guardados">
                            <i class="fa-solid fa-circle-check"></i> Descontado
                        </span>
                    ` : `
                        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500">
                            Libre
                        </span>
                    `}
                </td>
                <td class="py-3.5 px-2 text-right">
                    <div class="flex gap-2 justify-end">
                        <button class="load-history-btn bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1" data-id="${id}">
                            <i class="fa-solid fa-folder-open"></i> Cargar
                        </button>
                        <button class="archive-history-btn text-amber-600 hover:text-amber-850 hover:bg-amber-50 p-2 rounded-xl transition-all" data-id="${id}" title="Archivar">
                            <i class="fa-solid fa-box-archive pointer-events-none"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Registrar eventos para los botones
        tbody.querySelectorAll('.load-history-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const docId = btn.dataset.id;
                await loadHistoryItem(docId);
            });
        });

        tbody.querySelectorAll('.archive-history-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const docId = btn.dataset.id;
                if (confirm('¿Estás seguro de que deseas archivar este despiece?')) {
                    await archiveHistoryItem(docId);
                }
            });
        });

    } catch (err) {
        console.error("Error al cargar historial:", err);
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="py-12 text-center text-red-500">
                    <p class="text-xs font-bold">Error al cargar historial: ${err.message}</p>
                </td>
            </tr>
        `;
    }
}

async function loadHistoryItem(docId) {
    if (activeHistoryId === docId) {
        if (window.showToast) {
            window.showToast("Este despiece ya está cargado y activo.", "info");
        }
        switchDespieceTab('calc');
        return;
    }

    try {
        const historyQuery = query(collection(db, "despiece2d_history"));
        const snapshot = await getDocs(historyQuery);
        const match = snapshot.docs.find(d => d.id === docId);

        if (!match) {
            alert("No se encontró el registro del historial.");
            return;
        }

        const data = match.data();
        
        // Cargar inputs
        document.getElementById('sheet-width').value = data.sheetW || 3300;
        document.getElementById('sheet-height').value = data.sheetH || 2140;
        document.getElementById('sheet-client').value = data.clientName || '';
        document.getElementById('sheet-material').value = data.material || 'LAMINADO 3+3';
        document.getElementById('opt-rotate').checked = data.allowRotate !== false;
        document.getElementById('opt-strategy').value = data.strategy || 'AUTO';

        // Vincular inventario si existía
        selectedLaminaId = data.laminaBaseId || null;
        isInventoryDeducted = data.inventarioDescontado === true;
        const selectElem = document.getElementById('sheet-inventory-select');
        if (selectElem) selectElem.value = selectedLaminaId || '';
        updateStockBadge();

        // Cargar listado de piezas
        piezasList = data.piezasList ? JSON.parse(JSON.stringify(data.piezasList)) : [];
        lastId = piezasList.reduce((max, p) => Math.max(max, p.id || 0), 0);

        // Volver a renderizar
        renderPiezasTable();

        // Establecer el ID de historial activo ANTES de ejecutar el cálculo para evitar duplicados
        activeHistoryId = docId;

        // Cambiar pestaña al calculador
        switchDespieceTab('calc');

        // Ejecutar la optimización automáticamente
        calculateOptimization();

        if (window.showToast) {
            window.showToast("Despiece cargado correctamente.", "success");
        }
    } catch (err) {
        console.error("Error al cargar el despiece:", err);
        alert("Error al cargar el despiece: " + err.message);
    }
}

async function archiveHistoryItem(docId) {
    try {
        const docRef = doc(db, "despiece2d_history", docId);
        await updateDoc(docRef, { archived: true });

        // Si el despiece que se está archivando es el activo actual, limpiamos el ID activo
        if (activeHistoryId === docId) {
            activeHistoryId = null;
        }

        if (window.showToast) {
            window.showToast("Despiece archivado correctamente.", "success");
        }
        await loadDespieceHistory();
    } catch (err) {
        console.error("Error al archivar del historial:", err);
        alert("Error al archivar del historial: " + err.message);
    }
}

// ============================================================
// FUNCIONES DE GESTIÓN DE INVENTARIO (LÁMINAS Y RETALES)
// ============================================================

function getNextLaminaIdRef(material = '') {
    const matKey = (material || '').trim().toUpperCase();
    let maxId = 0;
    laminasInventory.forEach(item => {
        if (item.tipoItem !== 'retal') {
            const itemMat = (item.material || '').trim().toUpperCase();
            if (!matKey || itemMat === matKey) {
                if (item.idRef) {
                    const num = parseInt(item.idRef);
                    if (!isNaN(num) && num > maxId) {
                        maxId = num;
                    }
                }
            }
        }
    });
    return maxId + 1;
}

function ensureLaminasSequentialIds() {
    // 1. Desperdicios / retales: asegurar que NO tengan ID (idRef === null)
    laminasInventory.forEach(item => {
        if (item.tipoItem === 'retal') {
            if (item.idRef !== null && item.idRef !== undefined) {
                item.idRef = null;
                try {
                    updateDoc(doc(db, "vidrio_laminas", item.id), { idRef: null });
                } catch (e) {
                    console.warn("Error limpiando idRef de desperdicio:", e);
                }
            }
        }
    });

    // 2. Láminas completas: asegurar que tengan un ID único secuencial empezando desde 1 POR CADA TIPO / REFERENCIA (MATERIAL)
    const laminas = laminasInventory.filter(item => item.tipoItem !== 'retal');

    // Agrupar láminas por tipo de material
    const laminasByMaterial = {};
    laminas.forEach(l => {
        const mat = (l.material || 'VIDRIO').trim().toUpperCase();
        if (!laminasByMaterial[mat]) laminasByMaterial[mat] = [];
        laminasByMaterial[mat].push(l);
    });

    Object.keys(laminasByMaterial).forEach(mat => {
        const list = laminasByMaterial[mat];

        // Ordenar láminas por fecha de creación para mantener orden histórico
        const sortedByDate = [...list].sort((a, b) => {
            const tA = a.createdAt?.seconds ? a.createdAt.seconds : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            const tB = b.createdAt?.seconds ? b.createdAt.seconds : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
            return tA - tB;
        });

        const usedIds = new Set();
        let maxId = 0;
        const needId = [];

        sortedByDate.forEach(l => {
            if (l.idRef) {
                const num = parseInt(l.idRef);
                if (!isNaN(num) && num > 0 && !usedIds.has(num)) {
                    l.idRef = num;
                    usedIds.add(num);
                    if (num > maxId) maxId = num;
                } else {
                    needId.push(l);
                }
            } else {
                needId.push(l);
            }
        });

        let curId = 1;
        needId.forEach(l => {
            while (usedIds.has(curId)) {
                curId++;
            }
            l.idRef = curId;
            usedIds.add(curId);
            if (curId > maxId) maxId = curId;

            try {
                updateDoc(doc(db, "vidrio_laminas", l.id), { idRef: curId });
            } catch (e) {
                console.warn("Error persistiendo idRef de lámina:", e);
            }
            curId++;
        });
    });
}

function subscribeLaminasInventory() {
    if (unsubscribeLaminas) {
        unsubscribeLaminas();
    }

    try {
        const q = query(collection(db, "vidrio_laminas"), orderBy("createdAt", "desc"));
        unsubscribeLaminas = onSnapshot(q, (snapshot) => {
            laminasInventory = [];
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                if (data.archived !== true) {
                    laminasInventory.push({ id: docSnap.id, ...data });
                }
            });

            // Garantizar IDs secuenciales para láminas y sin ID para desperdicios
            ensureLaminasSequentialIds();

            renderInventoryKPIs();
            renderInventoryTable();
            populateInventorySelect();
            updateStockBadge();
        }, (err) => {
            console.error("Error en onSnapshot de vidrio_laminas:", err);
        });
    } catch (e) {
        console.error("Error subscribing to vidrio_laminas:", e);
    }
}

function renderInventoryKPIs() {
    const kpiLaminas = document.getElementById('kpi-total-laminas');
    const kpiRetales = document.getElementById('kpi-total-retales');
    const kpiArea = document.getElementById('kpi-total-area');
    const kpiMateriales = document.getElementById('kpi-total-materiales');
    const tabBadge = document.getElementById('tab-inventory-badge');

    if (!kpiLaminas) return;

    let totalLaminas = 0;
    let totalRetales = 0;
    let totalAreaM2 = 0;
    const materialsSet = new Set();

    laminasInventory.forEach(item => {
        const qty = parseInt(item.cantidad) || 0;
        const w = parseInt(item.ancho) || 0;
        const h = parseInt(item.alto) || 0;
        const area = (w * h / 1000000) * qty;

        if (item.tipoItem === 'retal') {
            totalRetales += qty;
        } else {
            totalLaminas += qty;
        }
        totalAreaM2 += area;
        if (item.material) materialsSet.add(item.material.trim().toUpperCase());
    });

    kpiLaminas.textContent = totalLaminas;
    kpiRetales.textContent = totalRetales;
    kpiArea.textContent = `${totalAreaM2.toFixed(1)} m²`;
    kpiMateriales.textContent = materialsSet.size;

    if (tabBadge) {
        tabBadge.textContent = totalLaminas + totalRetales;
    }
}

function renderInventoryTable() {
    const tbody = document.getElementById('inventory-table-body');
    if (!tbody) return;

    const searchTerm = (document.getElementById('inventory-search-input')?.value || '').toLowerCase().trim();
    const typeFilter = document.getElementById('inventory-type-filter')?.value || 'all';
    const materialFilter = document.getElementById('inventory-material-filter')?.value || 'all';

    const filtered = laminasInventory.filter(item => {
        if (typeFilter !== 'all' && item.tipoItem !== typeFilter) return false;
        if (materialFilter !== 'all' && (item.material || '').toUpperCase() !== materialFilter.toUpperCase()) return false;
        if (searchTerm) {
            const refText = item.idRef ? `#${item.idRef} ${item.idRef}` : '';
            const text = `${refText} ${item.material || ''} ${item.ancho} ${item.alto} ${item.ubicacion || ''} ${item.label || ''} ${item.notas || ''}`.toLowerCase();
            if (!text.includes(searchTerm)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="py-12 text-center text-gray-400">
                    <div class="flex flex-col items-center justify-center space-y-2">
                        <div class="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center text-gray-300">
                            <i class="fa-solid fa-boxes-stacked text-xl"></i>
                        </div>
                        <p class="text-xs font-semibold text-gray-400">No se encontraron láminas o retales con los filtros aplicados</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(item => {
        const isRetal = item.tipoItem === 'retal';
        const areaM2 = ((item.ancho * item.alto) / 1000000).toFixed(2);
        const qty = item.cantidad || 0;
        const isLow = qty <= 0;

        return `
            <tr class="hover:bg-gray-50/60 transition-colors">
                <td class="py-3 px-2 text-center">
                    ${!isRetal && item.idRef ? `
                        <span class="inline-flex items-center justify-center px-2 py-0.5 rounded-lg text-xs font-black bg-indigo-100 text-indigo-800 border border-indigo-200 shadow-sm" title="ID Único de Lámina">
                            #${item.idRef}
                        </span>
                    ` : `
                        <span class="text-gray-300 text-xs font-semibold px-2 select-none" title="Los desperdicios no llevan ID">—</span>
                    `}
                </td>
                <td class="py-3 px-2">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black ${isRetal ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}">
                        <i class="fa-solid ${isRetal ? 'fa-puzzle-piece' : 'fa-border-all'} text-[9px]"></i>
                        ${isRetal ? 'Desperdicio' : 'Lámina'}
                    </span>
                </td>
                <td class="py-3 px-2">
                    <div class="font-bold text-gray-800 text-xs">${item.material}</div>
                    ${item.label ? `<div class="text-[10px] text-gray-500 font-medium">${item.label}</div>` : ''}
                </td>
                <td class="py-3 px-2 font-mono text-xs text-slate-700">
                    <b>${item.ancho}</b> x <b>${item.alto}</b> mm
                </td>
                <td class="py-3 px-2 text-center text-xs font-semibold text-slate-600">
                    ${areaM2} m²
                </td>
                <td class="py-3 px-2 text-center">
                    <div class="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg p-0.5">
                        <button type="button" class="btn-stock-minus w-6 h-6 rounded flex items-center justify-center text-gray-500 hover:bg-gray-200 transition text-xs font-black" data-id="${item.id}" title="Disminuir stock">-</button>
                        <span class="w-8 text-center font-bold text-xs ${isLow ? 'text-red-600' : 'text-slate-800'}">${qty}</span>
                        <button type="button" class="btn-stock-plus w-6 h-6 rounded flex items-center justify-center text-gray-500 hover:bg-gray-200 transition text-xs font-black" data-id="${item.id}" title="Aumentar stock">+</button>
                    </div>
                </td>
                <td class="py-3 px-2 text-xs text-gray-600">
                    ${item.ubicacion ? `<div class="flex items-center gap-1 font-semibold text-indigo-700"><i class="fa-solid fa-location-dot text-[10px]"></i> ${item.ubicacion}</div>` : ''}
                    ${item.notas ? `<div class="text-[10px] text-gray-400 truncate max-w-xs">${item.notas}</div>` : ''}
                </td>
                <td class="py-3 px-2 text-right">
                    <div class="flex gap-1.5 justify-end">
                        <button type="button" class="btn-use-despiece bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1" data-id="${item.id}" title="Usar esta lámina en el Optimizador">
                            <i class="fa-solid fa-scissors text-xs"></i> Usar
                        </button>
                        <button type="button" class="btn-edit-lamina text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 p-1.5 rounded-lg transition" data-id="${item.id}" title="Editar">
                            <i class="fa-solid fa-pen-to-square text-xs"></i>
                        </button>
                        <button type="button" class="btn-delete-lamina text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition" data-id="${item.id}" title="Eliminar">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Conectar eventos de la tabla
    tbody.querySelectorAll('.btn-stock-plus').forEach(btn => {
        btn.addEventListener('click', () => handleQuickStockAdjust(btn.dataset.id, 1));
    });
    tbody.querySelectorAll('.btn-stock-minus').forEach(btn => {
        btn.addEventListener('click', () => handleQuickStockAdjust(btn.dataset.id, -1));
    });
    tbody.querySelectorAll('.btn-use-despiece').forEach(btn => {
        btn.addEventListener('click', () => useLaminaInDespiece(btn.dataset.id));
    });
    tbody.querySelectorAll('.btn-edit-lamina').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = laminasInventory.find(l => l.id === btn.dataset.id);
            if (item) openLaminaModal(item);
        });
    });
    tbody.querySelectorAll('.btn-delete-lamina').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteLamina(btn.dataset.id));
    });
}

function populateInventorySelect() {
    const select = document.getElementById('sheet-inventory-select');
    if (!select) return;

    const currentVal = selectedLaminaId || select.value || '';
    
    const laminas = laminasInventory.filter(l => l.tipoItem !== 'retal');
    const retales = laminasInventory.filter(l => l.tipoItem === 'retal');

    let html = `<option value="">Personalizado / Libre (Sin vincular a inventario)</option>`;

    if (laminas.length > 0) {
        html += `<optgroup label="── Láminas Completas de Fábrica (Con ID Único) ──">`;
        laminas.forEach(l => {
            const sel = (l.id === currentVal) ? 'selected' : '';
            html += `<option value="${l.id}" ${sel}>[ID #${l.idRef || '—'}] ${l.material} (${l.ancho}x${l.alto} mm) - Stock: ${l.cantidad} uds ${l.ubicacion ? '[' + l.ubicacion + ']' : ''}</option>`;
        });
        html += `</optgroup>`;
    }

    if (retales.length > 0) {
        html += `<optgroup label="── Desperdicios / Retales Guardados (Sin ID) ──">`;
        retales.forEach(l => {
            const sel = (l.id === currentVal) ? 'selected' : '';
            html += `<option value="${l.id}" ${sel}>[DESPERDICIO] ${l.material} (${l.ancho}x${l.alto} mm) - Stock: ${l.cantidad} ud(s) ${l.label ? '"' + l.label + '"' : ''}</option>`;
        });
        html += `</optgroup>`;
    }

    select.innerHTML = html;
    populateInventoryMaterialFilter();
}

function populateInventoryMaterialFilter() {
    const matSelect = document.getElementById('inventory-material-filter');
    if (!matSelect) return;

    const current = matSelect.value || 'all';
    const materials = Array.from(new Set(laminasInventory.map(l => (l.material || '').trim().toUpperCase()))).filter(Boolean).sort();

    let html = `<option value="all">Todos los Materiales</option>`;
    materials.forEach(mat => {
        html += `<option value="${mat}" ${mat === current ? 'selected' : ''}>${mat}</option>`;
    });
    matSelect.innerHTML = html;
}

function updateStockBadge() {
    const badge = document.getElementById('sheet-inventory-stock-badge');
    const hint = document.getElementById('sheet-inventory-hint');
    if (!badge) return;

    if (!selectedLaminaId) {
        badge.classList.add('hidden');
        if (hint) hint.textContent = "Selecciona una lámina o retal para descontar automáticamente su stock al optimizar.";
        return;
    }

    const lam = laminasInventory.find(l => l.id === selectedLaminaId);
    if (!lam) {
        badge.classList.add('hidden');
        return;
    }

    const qty = lam.cantidad || 0;
    const isLow = qty <= 0;
    const isRetal = lam.tipoItem === 'retal';

    badge.classList.remove('hidden', 'bg-emerald-100', 'text-emerald-800', 'bg-amber-100', 'text-amber-800', 'bg-red-100', 'text-red-800', 'bg-indigo-100', 'text-indigo-800');

    if (isLow) {
        badge.classList.add('bg-red-100', 'text-red-800');
        badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1"></i> ${isRetal ? 'Desperdicio (Sin ID)' : `Lámina [ID #${lam.idRef || '—'}]`} • Sin Stock`;
    } else {
        badge.classList.add(isRetal ? 'bg-amber-100' : 'bg-indigo-100', isRetal ? 'text-amber-800' : 'text-indigo-800');
        badge.innerHTML = `<i class="fa-solid ${isRetal ? 'fa-puzzle-piece' : 'fa-border-all'} mr-1"></i> ${isRetal ? 'Desperdicio (Sin ID)' : `Lámina [ID #${lam.idRef || '—'}]`} • Stock: ${qty} uds`;
    }

    if (hint) {
        hint.innerHTML = isRetal 
            ? `<b>Desperdicio seleccionado (Sin ID):</b> Se utilizará como lámina de corte y se descontará del inventario.`
            : `<b>Lámina vinculada [ID #${lam.idRef || '—'}]:</b> Se descontarán las láminas consumidas de esta referencia.`;
    }
}

function useLaminaInDespiece(id) {
    const item = laminasInventory.find(l => l.id === id);
    if (!item) return;

    selectedLaminaId = item.id;
    document.getElementById('sheet-width').value = item.ancho;
    document.getElementById('sheet-height').value = item.alto;
    if (item.material) {
        document.getElementById('sheet-material').value = item.material;
    }

    const select = document.getElementById('sheet-inventory-select');
    if (select) select.value = item.id;
    updateStockBadge();

    switchDespieceTab('calc');

    if (window.showToast) {
        const desc = item.tipoItem === 'retal' ? `Desperdicio ${item.material}` : `Lámina [ID #${item.idRef || '—'}] ${item.material}`;
        window.showToast(`${desc} (${item.ancho}x${item.alto} mm) cargada en el Optimizador.`, "success");
    }
}

function updateModalIdBadge() {
    const badge = document.getElementById('modal-lamina-id-badge');
    const tipo = document.getElementById('form-lamina-tipo')?.value || 'lamina';
    const idInput = document.getElementById('form-lamina-id')?.value;
    const material = document.getElementById('form-lamina-material')?.value?.trim() || '';
    if (!badge) return;

    if (tipo === 'retal') {
        badge.className = "px-2.5 py-0.5 rounded-lg font-bold text-xs bg-amber-100 text-amber-800 border border-amber-200";
        badge.textContent = "Sin ID (Desperdicio)";
    } else {
        badge.className = "px-2.5 py-0.5 rounded-lg font-black text-xs bg-indigo-600 text-white shadow-sm";
        if (idInput) {
            const existing = laminasInventory.find(l => l.id === idInput);
            badge.textContent = `#${existing && existing.idRef ? existing.idRef : getNextLaminaIdRef(material)}`;
        } else {
            badge.textContent = `#${getNextLaminaIdRef(material)} (${material || 'Automático'})`;
        }
    }
}

function openLaminaModal(item = null) {
    const modal = document.getElementById('modal-lamina-form');
    if (!modal) return;

    const title = document.getElementById('modal-lamina-title');
    const idInput = document.getElementById('form-lamina-id');
    const tipo = document.getElementById('form-lamina-tipo');
    const material = document.getElementById('form-lamina-material');
    const ancho = document.getElementById('form-lamina-ancho');
    const alto = document.getElementById('form-lamina-alto');
    const cantidad = document.getElementById('form-lamina-cantidad');
    const ubicacion = document.getElementById('form-lamina-ubicacion');
    const color = document.getElementById('form-lamina-color');
    const notas = document.getElementById('form-lamina-notas');

    if (item) {
        title.textContent = item.tipoItem === 'retal' ? 'Editar Desperdicio / Retal' : `Editar Lámina [ID #${item.idRef || '—'}]`;
        idInput.value = item.id;
        tipo.value = item.tipoItem || 'lamina';
        material.value = item.material || '';
        ancho.value = item.ancho || '';
        alto.value = item.alto || '';
        cantidad.value = item.cantidad !== undefined ? item.cantidad : 1;
        ubicacion.value = item.ubicacion || '';
        color.value = item.color || '';
        notas.value = item.notas || '';
    } else {
        title.textContent = 'Ingresar Lámina o Desperdicio';
        idInput.value = '';
        tipo.value = 'lamina';
        material.value = 'LAMINADO 3+3';
        ancho.value = '3300';
        alto.value = '2140';
        cantidad.value = '1';
        ubicacion.value = '';
        color.value = '';
        notas.value = '';
    }

    updateModalIdBadge();

    // Actualizar badge cuando se cambia el tipo o el material
    tipo.onchange = updateModalIdBadge;
    material.oninput = updateModalIdBadge;
    material.onchange = updateModalIdBadge;

    modal.classList.remove('hidden');
}

function closeLaminaModal() {
    const modal = document.getElementById('modal-lamina-form');
    if (modal) modal.classList.add('hidden');
}

async function handleSaveLamina(e) {
    e.preventDefault();

    const id = document.getElementById('form-lamina-id').value;
    const tipoItem = document.getElementById('form-lamina-tipo').value;
    const material = document.getElementById('form-lamina-material').value.trim();
    const ancho = parseInt(document.getElementById('form-lamina-ancho').value);
    const alto = parseInt(document.getElementById('form-lamina-alto').value);
    const cantidad = parseInt(document.getElementById('form-lamina-cantidad').value) || 1;
    const ubicacion = document.getElementById('form-lamina-ubicacion').value.trim();
    const color = document.getElementById('form-lamina-color').value.trim();
    const notas = document.getElementById('form-lamina-notas').value.trim();

    if (!material || isNaN(ancho) || isNaN(alto) || ancho <= 0 || alto <= 0) {
        alert("Por favor completa los datos obligatorios con valores válidos.");
        return;
    }

    const btn = document.getElementById('modal-lamina-save-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Guardando...`;
    }

    try {
        const currentUser = auth.currentUser;
        const uid = currentUser ? currentUser.uid : 'anonimo';

        if (id) {
            let idRef = null;
            if (tipoItem !== 'retal') {
                const existing = laminasInventory.find(l => l.id === id);
                idRef = existing && existing.idRef ? existing.idRef : getNextLaminaIdRef(material);
            }
            const data = {
                tipoItem,
                idRef,
                material,
                ancho,
                alto,
                cantidad,
                ubicacion,
                color,
                notas,
                updatedAt: new Date()
            };
            await updateDoc(doc(db, "vidrio_laminas", id), data);
        } else {
            // Nuevo ítem: si es lámina y cantidad > 1, crear N láminas individuales con ID único correlativo por tipo
            if (tipoItem !== 'retal' && cantidad > 1) {
                let startId = getNextLaminaIdRef(material);
                for (let k = 0; k < cantidad; k++) {
                    const data = {
                        tipoItem,
                        idRef: startId + k,
                        material,
                        ancho,
                        alto,
                        cantidad: 1,
                        ubicacion,
                        color,
                        notas,
                        createdAt: new Date(),
                        createdBy: uid,
                        archived: false,
                        updatedAt: new Date()
                    };
                    await addDoc(collection(db, "vidrio_laminas"), data);
                }
            } else {
                const idRef = tipoItem === 'retal' ? null : getNextLaminaIdRef(material);
                const data = {
                    tipoItem,
                    idRef,
                    material,
                    ancho,
                    alto,
                    cantidad: tipoItem === 'retal' ? cantidad : 1,
                    ubicacion,
                    color,
                    notas,
                    createdAt: new Date(),
                    createdBy: uid,
                    archived: false,
                    updatedAt: new Date()
                };
                await addDoc(collection(db, "vidrio_laminas"), data);
            }
        }

        closeLaminaModal();
        if (window.showToast) {
            const msg = id 
                ? (tipoItem === 'retal' ? "Desperdicio actualizado correctamente" : `Lámina de ${material} actualizada`)
                : (tipoItem === 'retal' ? "Desperdicio ingresado al inventario (Sin ID)" : `Lámina(s) de ${material} ingresada(s) con ID único`);
            window.showToast(msg, "success");
        }
    } catch (err) {
        console.error("Error al guardar lámina:", err);
        alert("Error al guardar: " + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Guardar`;
        }
    }
}

async function handleDeleteLamina(id) {
    if (!confirm("¿Estás seguro de que deseas eliminar este ítem del inventario?")) return;

    try {
        await deleteDoc(doc(db, "vidrio_laminas", id));
        if (selectedLaminaId === id) {
            selectedLaminaId = null;
            updateStockBadge();
        }
        if (window.showToast) {
            window.showToast("Ítem eliminado del inventario", "success");
        }
    } catch (err) {
        console.error("Error al eliminar lámina:", err);
        alert("Error al eliminar: " + err.message);
    }
}

async function handleQuickStockAdjust(id, delta) {
    const item = laminasInventory.find(l => l.id === id);
    if (!item) return;

    const currentQty = parseInt(item.cantidad) || 0;
    const newQty = Math.max(0, currentQty + delta);

    try {
        await updateDoc(doc(db, "vidrio_laminas", id), {
            cantidad: newQty,
            updatedAt: new Date()
        });
    } catch (err) {
        console.error("Error al ajustar stock:", err);
    }
}

// ============================================================
// FUNCIONES DE GESTIÓN DE SOBRANTES / RETALES Y DESCUENTO
// ============================================================

function initRemnantsDecisions(sheetW, sheetH) {
    remnantsDecisions = [];
    if (!currentResult || !currentResult.plano) return;

    const material = document.getElementById('sheet-material')?.value?.trim() || 'Vidrio';

    currentResult.plano.forEach((sheet, sheetIdx) => {
        if (!sheet.sobrantes) return;
        sheet.sobrantes.forEach((r, rIdx) => {
            const areaM2 = (r.w * r.h) / 1000000;
            // Un sobrante se considera potencialmente útil si ambos lados >= 250mm o área >= 0.08 m²
            const isUseful = (r.w >= 250 && r.h >= 250) || areaM2 >= 0.08;
            remnantsDecisions.push({
                id: `remnant-${sheetIdx}-${rIdx}`,
                sheetIdx,
                sheetNum: sheetIdx + 1,
                isDesperdicioSheet: sheet.isDesperdicio || false,
                sheetBadge: sheet.isDesperdicio 
                    ? `Retal ${sheetIdx + 1} (${sheet.sheetW}x${sheet.sheetH})` 
                    : `Lámina ${sheetIdx + 1}${sheet.laminaIdRef ? ` [ID #${sheet.laminaIdRef}]` : ''}`,
                rIdx,
                w: r.w,
                h: r.h,
                x: r.x,
                y: r.y,
                areaM2: areaM2.toFixed(3),
                action: 'unassigned', // Inicia sin asignar para que el usuario elija visualmente
                label: `Retal ${material} ${r.w}x${r.h}`,
                ubicacion: 'Bodega Retales',
                isUseful
            });
        });
    });
}

// ------------------------------------------------------------
// HELPERS Y ESTADO DE SOBRANTES SIN ASIGNAR
// ------------------------------------------------------------

function getUnassignedRemnantsCount() {
    return remnantsDecisions.filter(r => r.action === 'unassigned').length;
}

function getUnassignedRemnantsBySheet(sheetIdx) {
    return remnantsDecisions.filter(r => r.sheetIdx === sheetIdx && r.action === 'unassigned').length;
}

function getFirstSheetWithUnassigned() {
    const item = remnantsDecisions.find(r => r.action === 'unassigned');
    return item ? item.sheetIdx : -1;
}

// ------------------------------------------------------------
// CONTROL DEL MODAL VISUAL INTERACTIVO DE SOBRANTES
// ------------------------------------------------------------

function openRemnantsVisualModal(sheetIdx = 0) {
    const modal = document.getElementById('modal-remnants-visual');
    if (!modal) return;

    // Asegurar que el modal esté adjunto a document.body para evitar que los transforms/padding
    // de contenedores padres generen franjas blancas en la parte superior
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }

    if (sheetIdx !== undefined && sheetIdx !== null && sheetIdx >= 0) {
        modalRemnantsActiveSheetIndex = sheetIdx;
    }
    modalRemnantsZoomLevel = 1.0;

    // Bloquear el scroll de la página de fondo en body, html y contenedor principal
    document.body.classList.add('overflow-hidden');
    document.documentElement.classList.add('overflow-hidden');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        mainContent.style.overflow = 'hidden';
    }

    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        renderModalRemnantsView();
    });
}

function closeRemnantsVisualModal() {
    const modal = document.getElementById('modal-remnants-visual');
    if (!modal) return;
    modal.classList.add('hidden');

    // Restaurar el scroll de la página de fondo
    document.body.classList.remove('overflow-hidden');
    document.documentElement.classList.remove('overflow-hidden');
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        mainContent.style.overflow = '';
    }

    renderSheet(currentSheetIndex);
    renderRemnantsDecisionCard(currentResult?.sheetW, currentResult?.sheetH);
}

function navigateRemnantsModalSheet(delta) {
    if (!currentResult || !currentResult.plano || currentResult.plano.length === 0) return;
    const newIdx = modalRemnantsActiveSheetIndex + delta;
    if (newIdx >= 0 && newIdx < currentResult.plano.length) {
        modalRemnantsActiveSheetIndex = newIdx;
        renderModalRemnantsView();
    }
}

function toggleRemnantAction(sheetIdx, rIdx) {
    const dec = remnantsDecisions.find(d => d.sheetIdx === sheetIdx && d.rIdx === rIdx);
    if (!dec) return;

    // Ciclo de 1 o 2 clics: Sin asignar -> Se Queda (Verde) -> Se Va (Rojo) -> Se Queda (Verde)
    if (dec.action === 'unassigned') {
        dec.action = 'save';
    } else if (dec.action === 'save') {
        dec.action = 'discard';
    } else {
        dec.action = 'save';
    }

    renderModalRemnantsView();
    if (currentSheetIndex === sheetIdx) {
        renderSheet(currentSheetIndex);
    }
    renderRemnantsDecisionCard(currentResult?.sheetW, currentResult?.sheetH);
}

function setRemnantsActionForActiveSheet(action) {
    remnantsDecisions.forEach(d => {
        if (d.sheetIdx === modalRemnantsActiveSheetIndex) {
            d.action = action;
        }
    });
    renderModalRemnantsView();
    if (currentSheetIndex === modalRemnantsActiveSheetIndex) {
        renderSheet(currentSheetIndex);
    }
    renderRemnantsDecisionCard(currentResult?.sheetW, currentResult?.sheetH);
}

function autoSuggestRemnantsAction() {
    remnantsDecisions.forEach(d => {
        if (d.sheetIdx === modalRemnantsActiveSheetIndex) {
            d.action = d.isUseful ? 'save' : 'discard';
        }
    });
    renderModalRemnantsView();
    if (currentSheetIndex === modalRemnantsActiveSheetIndex) {
        renderSheet(currentSheetIndex);
    }
    renderRemnantsDecisionCard(currentResult?.sheetW, currentResult?.sheetH);
}

function renderModalRemnantsView() {
    const modal = document.getElementById('modal-remnants-visual');
    if (!modal || modal.classList.contains('hidden')) return;
    if (!currentResult || !currentResult.plano || currentResult.plano.length === 0) return;

    if (modalRemnantsActiveSheetIndex < 0) modalRemnantsActiveSheetIndex = 0;
    if (modalRemnantsActiveSheetIndex >= currentResult.plano.length) {
        modalRemnantsActiveSheetIndex = currentResult.plano.length - 1;
    }

    const sheet = currentResult.plano[modalRemnantsActiveSheetIndex];
    if (!sheet) return;

    const curSheetW = sheet.sheetW || currentResult.sheetW;
    const curSheetH = sheet.sheetH || currentResult.sheetH;

    // 1. Botones de navegación Anterior / Siguiente e Indicador de Lámina
    const prevBtn = document.getElementById('modal-remnants-prev-btn');
    const nextBtn = document.getElementById('modal-remnants-next-btn');
    const sheetIndicator = document.getElementById('modal-remnants-sheet-indicator');
    const sheetTitle = document.getElementById('modal-remnants-sheet-title');

    if (prevBtn) {
        prevBtn.disabled = modalRemnantsActiveSheetIndex === 0;
        prevBtn.classList.toggle('opacity-30', modalRemnantsActiveSheetIndex === 0);
        prevBtn.classList.toggle('cursor-not-allowed', modalRemnantsActiveSheetIndex === 0);
    }
    if (nextBtn) {
        nextBtn.disabled = modalRemnantsActiveSheetIndex === currentResult.plano.length - 1;
        nextBtn.classList.toggle('opacity-30', modalRemnantsActiveSheetIndex === currentResult.plano.length - 1);
        nextBtn.classList.toggle('cursor-not-allowed', modalRemnantsActiveSheetIndex === currentResult.plano.length - 1);
    }
    if (sheetIndicator) {
        const typeLabel = sheet.isDesperdicio ? 'Retal' : 'Lámina';
        const idLabel = sheet.laminaIdRef ? ` [ID #${sheet.laminaIdRef}]` : '';
        sheetIndicator.textContent = `${typeLabel} ${modalRemnantsActiveSheetIndex + 1} de ${currentResult.plano.length}${idLabel}`;
    }
    if (sheetTitle) {
        const material = document.getElementById('sheet-material')?.value?.trim() || 'Vidrio';
        const idStr = sheet.laminaIdRef ? ` • ID #${sheet.laminaIdRef}` : '';
        const ubiStr = sheet.laminaUbicacion ? ` (${sheet.laminaUbicacion})` : '';
        sheetTitle.textContent = `${curSheetW} x ${curSheetH} mm (${material})${idStr}${ubiStr}`;
    }

    // 2. Pestañas de Láminas (número de lámina + ID único con animación fluida)
    const tabsContainer = document.getElementById('modal-remnants-sheet-tabs');
    if (tabsContainer) {
        tabsContainer.innerHTML = currentResult.plano.map((sh, idx) => {
            const isCur = idx === modalRemnantsActiveSheetIndex;
            const unassignedOnSheet = getUnassignedRemnantsBySheet(idx);
            const sheetNum = idx + 1;
            const badge = unassignedOnSheet > 0
                ? `<span class="ml-1 px-1.5 py-0.2 rounded-full text-[9px] font-black bg-slate-500 text-white shrink-0 animate-pulse">⚪${unassignedOnSheet}</span>`
                : `<span class="ml-1 text-emerald-500 font-bold text-[10px] shrink-0">✓</span>`;

            const activeClass = isCur
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md ring-2 ring-indigo-300 scale-105 font-black'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-600';

            const tabIdRef = sh.laminaIdRef ? `<span class="text-[9px] opacity-80 font-mono ml-0.5">#${sh.laminaIdRef}</span>` : '';
            const tabTitle = `${sh.isDesperdicio ? 'Retal' : 'Lámina'} ${sheetNum}${sh.laminaIdRef ? ` [ID #${sh.laminaIdRef}]` : ''}${sh.laminaUbicacion ? ` (${sh.laminaUbicacion})` : ''}`;

            return `
                <button type="button" class="modal-sheet-tab-btn px-2.5 py-1 rounded-xl text-xs font-bold transition-all duration-200 transform active:scale-95 flex items-center justify-center shrink-0 min-w-[34px] ${activeClass}" data-index="${idx}" data-active="${isCur}" title="${tabTitle}">
                    <span>${sheetNum}${tabIdRef}</span> ${badge}
                </button>
            `;
        }).join('');

        tabsContainer.querySelectorAll('.modal-sheet-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                modalRemnantsActiveSheetIndex = parseInt(btn.dataset.index);
                renderModalRemnantsView();
            });
        });

        // Centrado suave animado de la pestaña activa en el carrusel de láminas
        const activeTab = tabsContainer.querySelector(`.modal-sheet-tab-btn[data-index="${modalRemnantsActiveSheetIndex}"]`);
        if (activeTab) {
            activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
        updateTabsScrollButtons();
    }

    // 3. Indicador de nivel de Zoom
    const zoomText = document.getElementById('modal-zoom-level-text');
    if (zoomText) {
        zoomText.textContent = `${Math.round(modalRemnantsZoomLevel * 100)}%`;
    }

    // 4. Banner dinámico de Alerta de piezas sin asignar
    const unassignedCount = getUnassignedRemnantsCount();
    const unassignedOnActiveSheet = getUnassignedRemnantsBySheet(modalRemnantsActiveSheetIndex);
    const banner = document.getElementById('modal-remnants-alert-banner');
    const alertIcon = document.getElementById('modal-alert-icon');
    const alertText = document.getElementById('modal-alert-text');
    const alertBadge = document.getElementById('modal-alert-badge');

    if (banner && alertText && alertBadge) {
        if (unassignedCount > 0) {
            banner.className = 'px-4 py-2 border-b transition-all flex items-center justify-between text-xs font-bold bg-amber-50 text-amber-900 border-amber-300 flex-shrink-0';
            if (alertIcon) alertIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-amber-600 text-base"></i>';

            let sheetMsg = '';
            if (unassignedOnActiveSheet > 0) {
                sheetMsg = ` <span class="bg-slate-200 px-2 py-0.5 rounded text-slate-800 font-bold ml-1.5">(Esta lámina tiene ${unassignedOnActiveSheet} pendiente${unassignedOnActiveSheet > 1 ? 's' : ''})</span>`;
            } else {
                const firstUnassigned = getFirstSheetWithUnassigned();
                if (firstUnassigned !== -1) {
                    sheetMsg = ` <span class="text-emerald-700 font-bold ml-1.5">(Esta lámina está completa ✓)</span> <button type="button" id="btn-jump-to-unassigned" class="underline text-indigo-700 hover:text-indigo-900 ml-2 font-bold cursor-pointer">Ir a Lámina ${firstUnassigned + 1}</button>`;
                }
            }

            alertText.innerHTML = `Hay <b>${unassignedCount}</b> pedazo(s) sin clasificar en gris. Haz clic sobre cada sobrante para marcarlo en <b class="text-emerald-700">Verde (Se Queda)</b> o <b class="text-rose-700">Rojo (Se Va)</b>.${sheetMsg}`;
            alertBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-black bg-slate-200 text-slate-800 shrink-0';
            alertBadge.textContent = `${unassignedCount} pendiente(s)`;

            document.getElementById('btn-jump-to-unassigned')?.addEventListener('click', () => {
                const firstUnassigned = getFirstSheetWithUnassigned();
                if (firstUnassigned !== -1) {
                    modalRemnantsActiveSheetIndex = firstUnassigned;
                    renderModalRemnantsView();
                }
            });
        } else {
            banner.className = 'px-4 py-2 border-b transition-all flex items-center justify-between text-xs font-bold bg-emerald-50 text-emerald-900 border-emerald-300 flex-shrink-0';
            if (alertIcon) alertIcon.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-600 text-base"></i>';
            alertText.innerHTML = `✓ ¡Excelente! Todos los pedazos sobrantes han sido clasificados. Puedes confirmar para aplicar al inventario.`;
            alertBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-200 text-emerald-900 shrink-0';
            alertBadge.textContent = 'Todo clasificado';
        }
    }

    // 5. Contadores del pie del modal
    const saveTotal = remnantsDecisions.filter(r => r.action === 'save').length;
    const discardTotal = remnantsDecisions.filter(r => r.action === 'discard').length;
    const elCountSave = document.getElementById('modal-count-save');
    const elCountDiscard = document.getElementById('modal-count-discard');
    const elCountUnassigned = document.getElementById('modal-count-unassigned');

    if (elCountSave) elCountSave.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600"></i> <b>${saveTotal}</b> Se Quedan`;
    if (elCountDiscard) elCountDiscard.innerHTML = `<i class="fa-solid fa-circle-xmark text-rose-600"></i> <b>${discardTotal}</b> Se Van`;
    if (elCountUnassigned) elCountUnassigned.innerHTML = `<i class="fa-solid fa-circle-question text-slate-500"></i> <b>${unassignedCount}</b> Sin Asignar`;

    // 6. Actualizar panel inferior de retales a guardar (ANTES del canvas para que la altura disponible sea exacta y estable)
    const drawer = document.getElementById('modal-remnants-drawer');
    const savedOnSheet = remnantsDecisions.filter(r => r.sheetIdx === modalRemnantsActiveSheetIndex && r.action === 'save');
    if (drawer) {
        if (savedOnSheet.length === 0) {
            drawer.innerHTML = `
                <div class="flex items-center justify-between text-xs text-slate-500 py-1">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-circle-info text-indigo-500 text-sm"></i>
                        <span>Haz clic sobre cualquier sobrante en gris del plano: <b class="text-emerald-700 font-semibold">🟢 Verde (Se Queda en Inventario)</b> | <b class="text-rose-700 font-semibold">🔴 Rojo (Se Va a Desecho)</b>.</span>
                    </div>
                    <span class="text-[11px] text-slate-400 font-medium hidden sm:inline">Ningún retal a guardar en esta lámina</span>
                </div>
            `;
        } else {
            drawer.innerHTML = `
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-xs font-bold text-slate-800">Retales a guardar de esta lámina (${savedOnSheet.length}):</span>
                    <span class="text-[11px] text-slate-500">(Se guardarán sin ID en inventario)</span>
                </div>
                <div class="flex gap-2.5 overflow-x-auto pb-0.5 scrollbar-thin">
                    ${savedOnSheet.map((r) => `
                        <div class="bg-emerald-50 border border-emerald-300 rounded-xl px-2.5 py-1.5 flex items-center gap-2.5 shrink-0 shadow-sm">
                            <div>
                                <div class="text-xs font-bold text-emerald-950">${r.w} x ${r.h} mm <span class="text-emerald-700 font-medium">(${r.areaM2} m²)</span></div>
                                <div class="flex items-center gap-2 mt-0.5">
                                    <input type="text" class="modal-drawer-label-inp text-xs bg-white border border-emerald-300 rounded-lg px-2 py-0.5 w-32 focus:ring-1 focus:ring-emerald-500 outline-none" value="${r.label || ''}" data-id="${r.id}" placeholder="Etiqueta">
                                    <input type="text" class="modal-drawer-loc-inp text-xs bg-white border border-emerald-300 rounded-lg px-2 py-0.5 w-28 focus:ring-1 focus:ring-emerald-500 outline-none" value="${r.ubicacion || ''}" data-id="${r.id}" placeholder="Ubicación">
                                </div>
                            </div>
                            <button type="button" class="btn-drawer-remove-save p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-100 rounded-lg text-sm transition" title="Cambiar a Se Va (Rojo)" data-id="${r.id}">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
            `;

            drawer.querySelectorAll('.modal-drawer-label-inp').forEach(inp => {
                inp.addEventListener('input', () => {
                    const id = inp.dataset.id;
                    const r = remnantsDecisions.find(d => d.id === id);
                    if (r) r.label = inp.value;
                });
            });

            drawer.querySelectorAll('.modal-drawer-loc-inp').forEach(inp => {
                inp.addEventListener('input', () => {
                    const id = inp.dataset.id;
                    const r = remnantsDecisions.find(d => d.id === id);
                    if (r) r.ubicacion = inp.value;
                });
            });

            drawer.querySelectorAll('.btn-drawer-remove-save').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    const r = remnantsDecisions.find(d => d.id === id);
                    if (r) {
                        r.action = 'discard';
                        renderModalRemnantsView();
                        if (currentSheetIndex === r.sheetIdx) renderSheet(currentSheetIndex);
                        renderRemnantsDecisionCard(currentResult?.sheetW, currentResult?.sheetH);
                    }
                });
            });
        }
    }

    // 7. DIBUJAR LÁMINA EN EL CANVAS DEL MODAL (Cálculo simétrico y sin desbordes)
    const canvas = document.getElementById('modal-remnants-canvas');
    const viewport = document.getElementById('modal-canvas-viewport');
    if (canvas && viewport) {
        // En zoom normal 100%, ocultar scrollbars para perfecta simetría y centrado
        if (modalRemnantsZoomLevel <= 1.0) {
            viewport.classList.remove('overflow-auto');
            viewport.classList.add('overflow-hidden');
        } else {
            viewport.classList.remove('overflow-hidden');
            viewport.classList.add('overflow-auto');
        }

        // Medir ancho y alto real disponible (con la barra inferior ya colocada)
        const availW = Math.max(400, viewport.clientWidth - 48);
        const availH = Math.max(300, viewport.clientHeight - 48);
        const margin = 40;

        // Escala matemática óptima que ocupa el máximo espacio posible sin desbordar
        const scaleW = (availW - margin) / curSheetW;
        const scaleH = (availH - margin) / curSheetH;
        let baseScale = Math.min(scaleW, scaleH);
        baseScale = Math.max(0.12, Math.min(0.85, baseScale));

        const finalScale = baseScale * modalRemnantsZoomLevel;
        renderSheetToCanvas(canvas, sheet, curSheetW, curSheetH, finalScale, false);
    }
}

// ------------------------------------------------------------
// EVENTOS DE INTERACCIÓN EN CANVAS DE SOBRANTES
// ------------------------------------------------------------

function initModalRemnantsCanvasEvents() {
    const canvas = document.getElementById('modal-remnants-canvas');
    const tooltip = document.getElementById('modal-remnants-tooltip');
    if (!canvas) return;

    canvas.addEventListener('click', (e) => {
        if (!currentResult || !currentResult.plano || !currentResult.plano[modalRemnantsActiveSheetIndex]) return;
        const sheet = currentResult.plano[modalRemnantsActiveSheetIndex];
        if (!sheet.sobrantes || sheet.sobrantes.length === 0) return;

        const curSheetW = sheet.sheetW || currentResult.sheetW;
        const margin = 40;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;

        // Escala matemática real dibujada en el canvas
        const currentScale = (canvas.width - margin) / curSheetW;
        const sheetX = (canvasX - margin) / currentScale;
        const sheetY = (canvasY - margin) / currentScale;

        let matchedIdx = -1;
        let minArea = Infinity;
        sheet.sobrantes.forEach((r, rIdx) => {
            if (sheetX >= r.x && sheetX <= r.x + r.w && sheetY >= r.y && sheetY <= r.y + r.h) {
                const area = r.w * r.h;
                if (area < minArea) {
                    minArea = area;
                    matchedIdx = rIdx;
                }
            }
        });

        if (matchedIdx !== -1) {
            toggleRemnantAction(modalRemnantsActiveSheetIndex, matchedIdx);
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!currentResult || !currentResult.plano || !currentResult.plano[modalRemnantsActiveSheetIndex]) return;
        const sheet = currentResult.plano[modalRemnantsActiveSheetIndex];
        if (!sheet.sobrantes || sheet.sobrantes.length === 0) {
            canvas.style.cursor = 'default';
            if (tooltip) tooltip.classList.add('hidden');
            return;
        }

        const curSheetW = sheet.sheetW || currentResult.sheetW;
        const margin = 40;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;

        // Escala matemática real dibujada en el canvas
        const currentScale = (canvas.width - margin) / curSheetW;
        const sheetX = (canvasX - margin) / currentScale;
        const sheetY = (canvasY - margin) / currentScale;

        let hoveredRemnant = null;
        let hoveredIdx = -1;
        let minArea = Infinity;
        sheet.sobrantes.forEach((r, rIdx) => {
            if (sheetX >= r.x && sheetX <= r.x + r.w && sheetY >= r.y && sheetY <= r.y + r.h) {
                const area = r.w * r.h;
                if (area < minArea) {
                    minArea = area;
                    hoveredRemnant = r;
                    hoveredIdx = rIdx;
                }
            }
        });

        if (hoveredRemnant && tooltip) {
            canvas.style.cursor = 'pointer';
            const dec = remnantsDecisions.find(d => d.sheetIdx === modalRemnantsActiveSheetIndex && d.rIdx === hoveredIdx);
            const action = dec ? dec.action : 'unassigned';
            let badgeText = '';
            let badgeColor = '';
            if (action === 'save') {
                badgeText = '🟢 Se Queda (Guardar)';
                badgeColor = 'text-emerald-400';
            } else if (action === 'discard') {
                badgeText = '🔴 Se Va (Desechar)';
                badgeColor = 'text-rose-400';
            } else {
                badgeText = '⚪ Sin Asignar (Gris)';
                badgeColor = 'text-slate-300';
            }

            tooltip.innerHTML = `
                <div class="font-bold text-xs">${hoveredRemnant.w} x ${hoveredRemnant.h} mm <span class="text-slate-300 font-normal">(${((hoveredRemnant.w * hoveredRemnant.h)/1000000).toFixed(3)} m²)</span></div>
                <div class="mt-1 text-[11px] ${badgeColor} font-bold">${badgeText}</div>
                <div class="text-[10px] text-slate-300 mt-1">Clic para cambiar estado</div>
            `;
            tooltip.classList.remove('hidden');
            const posX = Math.min(e.clientX - rect.left + 15, rect.width - 160);
            const posY = Math.min(e.clientY - rect.top + 15, rect.height - 70);
            tooltip.style.left = `${posX}px`;
            tooltip.style.top = `${posY}px`;
        } else {
            canvas.style.cursor = 'default';
            if (tooltip) tooltip.classList.add('hidden');
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (tooltip) tooltip.classList.add('hidden');
    });
}

function initMainCanvasRemnantsClick() {
    const canvas = document.getElementById('sheet-canvas');
    if (!canvas) return;

    canvas.addEventListener('click', (e) => {
        if (!currentResult || !currentResult.plano || !currentResult.plano[currentSheetIndex]) return;
        const sheet = currentResult.plano[currentSheetIndex];
        if (!sheet.sobrantes || sheet.sobrantes.length === 0) return;

        const curSheetW = sheet.sheetW || currentResult.sheetW;
        const margin = 40;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;

        const containerWidth = Math.min(1400, canvas.parentElement.clientWidth - 32);
        const scale = (containerWidth - 40) / curSheetW;

        const sheetX = (canvasX - margin) / scale;
        const sheetY = (canvasY - margin) / scale;

        let matchedIdx = -1;
        let minArea = Infinity;
        sheet.sobrantes.forEach((r, rIdx) => {
            if (sheetX >= r.x && sheetX <= r.x + r.w && sheetY >= r.y && sheetY <= r.y + r.h) {
                const area = r.w * r.h;
                if (area < minArea) {
                    minArea = area;
                    matchedIdx = rIdx;
                }
            }
        });

        if (matchedIdx !== -1) {
            toggleRemnantAction(currentSheetIndex, matchedIdx);
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!currentResult || !currentResult.plano || !currentResult.plano[currentSheetIndex]) return;
        const sheet = currentResult.plano[currentSheetIndex];
        if (!sheet.sobrantes || sheet.sobrantes.length === 0) {
            canvas.style.cursor = 'default';
            return;
        }

        const curSheetW = sheet.sheetW || currentResult.sheetW;
        const margin = 40;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;
        const containerWidth = Math.min(1400, canvas.parentElement.clientWidth - 32);
        const scale = (containerWidth - 40) / curSheetW;
        const sheetX = (canvasX - margin) / scale;
        const sheetY = (canvasY - margin) / scale;

        const isOverRemnant = sheet.sobrantes.some(r =>
            sheetX >= r.x && sheetX <= r.x + r.w && sheetY >= r.y && sheetY <= r.y + r.h
        );
        canvas.style.cursor = isOverRemnant ? 'pointer' : 'default';
    });
}

function handleConfirmRemnantsFromModal() {
    const unassigned = getUnassignedRemnantsCount();
    if (unassigned > 0) {
        if (window.showToast) {
            window.showToast(`⚠️ Hay ${unassigned} pedazo(s) sin clasificar. Asígnalos antes de continuar.`, 'warning');
        } else {
            alert(`⚠️ Hay ${unassigned} pedazo(s) sin clasificar. Debes definir si se quedan (Verde) o se van (Rojo) antes de confirmar.`);
        }
        const targetSheet = getFirstSheetWithUnassigned();
        if (targetSheet !== -1) {
            modalRemnantsActiveSheetIndex = targetSheet;
            renderModalRemnantsView();
        }
        return;
    }

    closeRemnantsVisualModal();
    executeInventoryDeduction(currentResult?.sheetW, currentResult?.sheetH);
}

// ------------------------------------------------------------
// TARJETA DE GESTIÓN DE SOBRANTES EN EL PANEL DE RESULTADOS
// ------------------------------------------------------------

function renderRemnantsDecisionCard(sheetW, sheetH) {
    const card = document.getElementById('despiece-inventory-action-card');
    if (!card) return;

    const material = document.getElementById('sheet-material')?.value?.trim() || 'Vidrio';
    const usedDesperdicios = currentResult ? currentResult.plano.filter(s => s.isDesperdicio) : [];
    const fullSheetsConsumed = currentResult ? (currentResult.laminasCompletasCount ?? currentResult.plano.filter(s => !s.isDesperdicio).length) : 0;
    const selectedLamina = selectedLaminaId ? laminasInventory.find(l => l.id === selectedLaminaId) : null;

    let usedDespHtml = '';
    if (usedDesperdicios.length > 0) {
        const usedDespList = usedDesperdicios.map(d => `<span class="inline-block bg-white/90 px-2 py-0.5 rounded border border-amber-300 mr-1 text-[11px] font-semibold text-amber-900">${d.desperdicioLabel || 'Retal'} (${d.sheetW}x${d.sheetH} mm - Sin ID)</span>`).join('');
        usedDespHtml = `
            <div class="bg-amber-50/90 border border-amber-300 rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-lg bg-amber-200 text-amber-800 flex items-center justify-center text-lg flex-shrink-0">
                        <i class="fa-solid fa-recycle"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-amber-900">♻️ ${usedDesperdicios.length} Retal(es) de Inventario Reaprovechado(s)</span>
                            <span class="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-amber-300 text-amber-800 font-bold">Sin ID</span>
                        </div>
                        <p class="text-xs text-amber-800 font-medium mt-1">
                            ${usedDespList}
                        </p>
                    </div>
                </div>
                <div class="bg-amber-100 border border-amber-300 text-amber-900 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 flex-shrink-0">
                    <i class="fa-solid fa-check"></i> Descontará ${usedDesperdicios.length} retal(es)
                </div>
            </div>
        `;
    }

    let stockInfoHtml = '';

    if (fullSheetsConsumed === 0) {
        stockInfoHtml = usedDespHtml + `
            <div class="bg-emerald-50/80 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center text-lg flex-shrink-0">
                    <i class="fa-solid fa-leaf"></i>
                </div>
                <div>
                    <span class="text-xs font-bold text-emerald-900">¡Optimización 100% con Retales!</span>
                    <p class="text-xs text-emerald-700 font-medium mt-0.5">No se requiere consumir ninguna lámina completa nueva. Todo el trabajo se cubre con los retales existentes de inventario.</p>
                </div>
            </div>
        `;
    } else {
        const fullSheets = currentResult ? currentResult.plano.filter(s => !s.isDesperdicio) : [];
        const inStockCount = fullSheets.filter(s => s.inInventoryStock).length;
        const missingCount = fullSheets.length - inStockCount;
        const allInStock = missingCount === 0;

        const sheetBadgesHtml = fullSheets.map((sh, idx) => {
            const idBadge = sh.laminaIdRef ? `ID #${sh.laminaIdRef}` : 'Sin ID';
            const ubiBadge = sh.laminaUbicacion ? ` • ${sh.laminaUbicacion}` : '';
            const statusBadge = sh.inInventoryStock 
                ? '<span class="text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded text-[10px] font-bold">✓ En stock</span>'
                : '<span class="text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded text-[10px] font-bold">⚠️ No en stock</span>';
            return `
                <div class="inline-flex items-center gap-1.5 bg-white border border-indigo-200 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-800 shadow-2xs">
                    <span class="text-indigo-600 font-bold">Lámina ${idx + 1}:</span>
                    <span class="font-mono font-bold text-indigo-900">${idBadge}</span>
                    <span class="text-[11px] text-slate-500">${ubiBadge}</span>
                    ${statusBadge}
                </div>
            `;
        }).join('');

        if (inStockCount > 0 || selectedLamina) {
            stockInfoHtml = (usedDesperdicios.length > 0 ? usedDespHtml : '') + `
                <div class="bg-indigo-50/70 border border-indigo-200/80 rounded-xl p-4 flex flex-col justify-between gap-3">
                    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-lg ${allInStock ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'} flex items-center justify-center text-lg flex-shrink-0">
                                <i class="fa-solid fa-boxes-stacked"></i>
                            </div>
                            <div>
                                <div class="flex items-center gap-2 flex-wrap">
                                    <span class="text-xs font-bold text-gray-800">Láminas Base a Cortar (${material}):</span>
                                    <span class="text-[11px] font-bold text-indigo-700">${fullSheets.length} lámina(s) requerida(s)</span>
                                </div>
                                <p class="text-xs text-gray-500 font-medium mt-0.5">
                                    Identificación única individual por lámina para corte exacto en taller:
                                </p>
                            </div>
                        </div>
                        <div>
                            ${allInStock ? `
                                <div class="bg-emerald-50 border border-emerald-300 text-emerald-800 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5">
                                    <i class="fa-solid fa-circle-check"></i> Todas en stock (${inStockCount}/${fullSheets.length})
                                </div>
                            ` : `
                                <div class="bg-amber-50 border border-amber-300 text-amber-800 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5">
                                    <i class="fa-solid fa-triangle-exclamation"></i> Stock insuficiente (Faltan ${missingCount} láminas)
                                </div>
                            `}
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-2 pt-1 border-t border-indigo-100/70">
                        ${sheetBadgesHtml}
                    </div>
                </div>
            `;
        } else {
            stockInfoHtml = (usedDesperdicios.length > 0 ? usedDespHtml : '') + `
                <div class="bg-amber-50/70 border border-amber-200 rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center text-lg flex-shrink-0">
                            <i class="fa-solid fa-circle-question"></i>
                        </div>
                        <div>
                            <span class="text-xs font-bold text-amber-900">Lámina no vinculada al inventario (Se consumirán ${fullSheetsConsumed} lámina(s))</span>
                            <p class="text-xs text-amber-700 font-medium mt-0.5">Este despiece se calculó con medidas libres. Puedes vincularlo ahora a una lámina con ID de tu inventario si deseas descontarla:</p>
                        </div>
                    </div>
                    <div class="w-full md:w-auto">
                        <select id="quick-link-inventory-select" class="w-full px-3 py-2 border border-amber-300 rounded-lg text-xs font-bold text-slate-700 bg-white cursor-pointer outline-none">
                            <option value="">-- No descontar lámina base (Solo registrar retales si hay) --</option>
                            ${laminasInventory.filter(l => l.tipoItem !== 'retal').map(l => `
                                <option value="${l.id}">[ID #${l.idRef || '—'}] ${l.material} (${l.ancho}x${l.alto}mm) - Stock: ${l.cantidad}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>
            `;
        }
    }

    if (isInventoryDeducted) {
        card.innerHTML = `
            <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center space-y-3">
                <div class="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-2xl mx-auto">
                    <i class="fa-solid fa-circle-check"></i>
                </div>
                <h3 class="text-base font-bold text-emerald-900">¡Inventario de Despiece Aplicado con Éxito!</h3>
                <p class="text-xs font-semibold text-emerald-700 max-w-lg mx-auto">
                    Las láminas correspondientes han sido descontadas del stock y los retales seleccionados han sido ingresados al inventario (sin ID) listos para futuros proyectos.
                </p>
                <div class="pt-2">
                    <button id="view-inventory-from-action-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-sm transition">
                        <i class="fa-solid fa-boxes-stacked mr-1"></i> Ver Inventario Actualizado
                    </button>
                </div>
            </div>
        `;

        document.getElementById('view-inventory-from-action-btn')?.addEventListener('click', () => {
            switchDespieceTab('inventario');
        });
        return;
    }

    const saveCount = remnantsDecisions.filter(r => r.action === 'save').length;
    const discardCount = remnantsDecisions.filter(r => r.action === 'discard').length;
    const unassignedCount = getUnassignedRemnantsCount();

    let unassignedAlertHtml = '';
    if (unassignedCount > 0) {
        unassignedAlertHtml = `
            <div class="bg-amber-50 border border-amber-300 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-900 font-semibold">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg bg-amber-200 text-amber-800 flex items-center justify-center shrink-0">
                        <i class="fa-solid fa-triangle-exclamation text-base"></i>
                    </div>
                    <div>
                        <div class="font-bold text-amber-950">Hay ${unassignedCount} pedazo(s) sin clasificar</div>
                        <p class="text-[11px] text-amber-800 font-medium">Aparecen en gris en el plano: debes indicar si Se Quedan (Verde) o Se Van (Rojo) antes de descontar del inventario.</p>
                    </div>
                </div>
                <button type="button" id="btn-open-modal-from-banner" class="bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 shadow-sm">
                    <i class="fa-solid fa-shapes"></i> Clasificar en Plano Visual
                </button>
            </div>
        `;
    }

    let remnantsListHtml = '';
    if (remnantsDecisions.length === 0) {
        remnantsListHtml = `
            <div class="py-6 text-center text-gray-400">
                <p class="text-xs font-semibold">No se detectaron sobrantes significativos en este corte.</p>
            </div>
        `;
    } else {
        remnantsListHtml = `
            <div class="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                ${remnantsDecisions.map((r, idx) => {
                    const isSave = r.action === 'save';
                    const isDiscard = r.action === 'discard';
                    const isUnassigned = r.action === 'unassigned';

                    let rowBg = 'bg-gray-50 border-gray-200';
                    let statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-black bg-gray-200 text-gray-700">🔴 Se Va</span>';

                    if (isSave) {
                        rowBg = 'bg-emerald-50/50 border-emerald-300';
                        statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800">🟢 Se Queda</span>';
                    } else if (isUnassigned) {
                        rowBg = 'bg-slate-50 border-slate-300';
                        statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-black bg-slate-200 text-slate-700 border border-slate-300">⚪ Sin Asignar</span>';
                    }

                    return `
                        <div class="p-3 rounded-xl border transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-3 ${rowBg}">
                            <div class="flex items-center gap-3 min-w-0">
                                <span class="px-2 py-1 rounded-md text-[10px] font-black ${isSave ? 'bg-emerald-100 text-emerald-800' : (isUnassigned ? 'bg-slate-200 text-slate-700' : 'bg-gray-200 text-gray-600')}">
                                    ${r.sheetBadge || `Lámina ${r.sheetNum}`}
                                </span>
                                <div>
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <span class="text-xs font-bold text-gray-800">${r.w} x ${r.h} mm</span>
                                        <span class="text-[10px] font-semibold text-gray-500">(${r.areaM2} m²)</span>
                                        ${statusBadge}
                                        ${r.isUseful ? '<span class="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">Útil</span>' : '<span class="text-[9px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">Pequeño</span>'}
                                        <span class="text-[9px] text-gray-400 font-mono">(Sin ID al guardar)</span>
                                    </div>
                                    <div class="flex items-center gap-2 mt-1 flex-wrap">
                                        <input type="text" class="remnant-label-input text-[11px] font-medium text-gray-700 bg-white border border-gray-200 rounded px-2 py-0.5 w-44 focus:ring-1 focus:ring-indigo-500 outline-none" value="${r.label}" data-index="${idx}" placeholder="Etiqueta del retal">
                                        <input type="text" class="remnant-location-input text-[11px] font-medium text-gray-700 bg-white border border-gray-200 rounded px-2 py-0.5 w-32 focus:ring-1 focus:ring-indigo-500 outline-none" value="${r.ubicacion || ''}" data-index="${idx}" placeholder="Ubicación">
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-2 flex-shrink-0 w-full md:w-auto justify-end">
                                <button type="button" class="btn-toggle-remnant px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${isSave ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-300' : 'bg-white border border-gray-200 text-emerald-700 hover:bg-emerald-50'}" data-index="${idx}" data-action="save">
                                    <i class="fa-solid fa-circle-check text-xs"></i> Se Queda (Verde)
                                </button>
                                <button type="button" class="btn-toggle-remnant px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${isDiscard ? 'bg-rose-600 text-white shadow-sm ring-2 ring-rose-300' : 'bg-white border border-gray-200 text-rose-700 hover:bg-rose-50'}" data-index="${idx}" data-action="discard">
                                    <i class="fa-solid fa-circle-xmark text-xs"></i> Se Va (Rojo)
                                </button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    card.innerHTML = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-100 pb-4">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
                    <i class="fa-solid fa-boxes-packing"></i>
                </div>
                <div>
                    <h2 class="text-sm font-bold text-gray-800">Gestión de Inventario y Sobrantes del Despiece</h2>
                    <p class="text-[10px] text-gray-500 font-semibold mt-0.5">Controla el descuento de láminas utilizadas y decide qué retales guardar en inventario (sin ID) o desechar.</p>
                </div>
            </div>
            ${remnantsDecisions.length > 0 ? `
                <button type="button" id="btn-open-remnants-visual-modal" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow-sm hover:shadow transition flex items-center gap-2 shrink-0">
                    <i class="fa-solid fa-shapes"></i> Modal Visual (Verde/Rojo)
                </button>
            ` : ''}
        </div>

        ${stockInfoHtml}
        ${unassignedAlertHtml}

        <div class="space-y-3 pt-2">
            <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-xs font-bold text-gray-800">Sobrantes Detectados (${remnantsDecisions.length})</span>
                    <span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">${saveCount} a guardar</span>
                    <span class="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">${discardCount} a desechar</span>
                    ${unassignedCount > 0 ? `<span class="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-300">⚪ ${unassignedCount} sin asignar</span>` : ''}
                </div>
                <div class="flex gap-2 flex-wrap">
                    <button type="button" id="btn-save-all-useful" class="text-[10px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1 rounded-lg transition">
                        Guardar útiles (≥250mm)
                    </button>
                    <button type="button" id="btn-discard-all" class="text-[10px] font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-lg transition">
                        Desechar todos
                    </button>
                    <button type="button" id="btn-save-all" class="text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg transition">
                        Guardar todos
                    </button>
                </div>
            </div>

            ${remnantsListHtml}
        </div>

        <div class="pt-4 border-t border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-3">
            <div class="text-xs text-gray-500">
                <i class="fa-solid fa-circle-info text-indigo-500 mr-1"></i> Las láminas y retales se descontarán únicamente al pulsar el botón de confirmación.
            </div>
            <button type="button" id="confirm-deduct-inventory-btn" class="w-full sm:w-auto bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3 px-6 rounded-xl text-xs shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2">
                <i class="fa-solid fa-check-double text-sm"></i> Confirmar y Descontar de Inventario
            </button>
        </div>
    `;

    // Conectar eventos del botón de abrir modal visual
    const openModalBtn = document.getElementById('btn-open-remnants-visual-modal');
    if (openModalBtn) {
        openModalBtn.addEventListener('click', () => {
            const firstUnassigned = getFirstSheetWithUnassigned();
            openRemnantsVisualModal(firstUnassigned !== -1 ? firstUnassigned : 0);
        });
    }

    const openBannerBtn = document.getElementById('btn-open-modal-from-banner');
    if (openBannerBtn) {
        openBannerBtn.addEventListener('click', () => {
            const firstUnassigned = getFirstSheetWithUnassigned();
            openRemnantsVisualModal(firstUnassigned !== -1 ? firstUnassigned : 0);
        });
    }

    // Conectar eventos de la tarjeta de retales
    card.querySelectorAll('.btn-toggle-remnant').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.index);
            const act = btn.dataset.action;
            if (remnantsDecisions[idx]) {
                remnantsDecisions[idx].action = act;
                renderRemnantsDecisionCard(sheetW, sheetH);
                if (currentSheetIndex === remnantsDecisions[idx].sheetIdx) {
                    renderSheet(currentSheetIndex);
                }
            }
        });
    });

    card.querySelectorAll('.remnant-label-input').forEach(inp => {
        inp.addEventListener('input', () => {
            const idx = parseInt(inp.dataset.index);
            if (remnantsDecisions[idx]) {
                remnantsDecisions[idx].label = inp.value;
            }
        });
    });

    card.querySelectorAll('.remnant-location-input').forEach(inp => {
        inp.addEventListener('input', () => {
            const idx = parseInt(inp.dataset.index);
            if (remnantsDecisions[idx]) {
                remnantsDecisions[idx].ubicacion = inp.value;
            }
        });
    });

    document.getElementById('btn-save-all-useful')?.addEventListener('click', () => {
        remnantsDecisions.forEach(r => {
            r.action = r.isUseful ? 'save' : 'discard';
        });
        renderRemnantsDecisionCard(sheetW, sheetH);
        renderSheet(currentSheetIndex);
    });

    document.getElementById('btn-discard-all')?.addEventListener('click', () => {
        remnantsDecisions.forEach(r => { r.action = 'discard'; });
        renderRemnantsDecisionCard(sheetW, sheetH);
        renderSheet(currentSheetIndex);
    });

    document.getElementById('btn-save-all')?.addEventListener('click', () => {
        remnantsDecisions.forEach(r => { r.action = 'save'; });
        renderRemnantsDecisionCard(sheetW, sheetH);
        renderSheet(currentSheetIndex);
    });

    const quickSelect = document.getElementById('quick-link-inventory-select');
    if (quickSelect) {
        quickSelect.addEventListener('change', () => {
            selectedLaminaId = quickSelect.value || null;
            const selectElem = document.getElementById('sheet-inventory-select');
            if (selectElem) selectElem.value = selectedLaminaId || '';
            updateStockBadge();
            renderRemnantsDecisionCard(sheetW, sheetH);
        });
    }

    document.getElementById('confirm-deduct-inventory-btn')?.addEventListener('click', () => {
        executeInventoryDeduction(sheetW, sheetH);
    });
}

// ------------------------------------------------------------
// EJECUCIÓN DEL DESCUENTO DE INVENTARIO Y GUARDADO DE RETALES
// ------------------------------------------------------------

async function executeInventoryDeduction(sheetW, sheetH) {
    if (!currentResult) return;

    // Validación estricta: No se permite descontar si existen piezas sin asignar
    const unassignedCount = getUnassignedRemnantsCount();
    if (unassignedCount > 0) {
        if (window.showToast) {
            window.showToast(`⚠️ Hay ${unassignedCount} pedazo(s) sin clasificar. Define si Se Quedan o Se Van en el plano visual antes de confirmar.`, 'warning');
        } else {
            alert(`⚠️ Hay ${unassignedCount} pedazo(s) sin clasificar en el despiece.\n\nPor favor haz clic en cada pedazo sobrante del plano interactivo para clasificar si Se Queda (Verde) o Se Va (Rojo) antes de descontar del inventario.`);
        }
        const firstUnassigned = getFirstSheetWithUnassigned();
        openRemnantsVisualModal(firstUnassigned !== -1 ? firstUnassigned : 0);
        return;
    }

    const usedDesperdicios = currentResult.plano.filter(s => s.isDesperdicio);
    const fullSheets = currentResult.plano.filter(s => !s.isDesperdicio);
    const fullSheetsConsumed = currentResult.laminasCompletasCount ?? fullSheets.length;
    const material = document.getElementById('sheet-material')?.value?.trim() || 'Vidrio';
    const toSave = remnantsDecisions.filter(r => r.action === 'save');
    const toDiscard = remnantsDecisions.filter(r => r.action === 'discard');

    const inStockSheets = fullSheets.filter(s => s.laminaId);

    let confirmMsg = `¿Confirmas la aplicación del despiece al inventario?\n\n`;
    if (usedDesperdicios.length > 0) {
        confirmMsg += `• Retales reaprovechados: se descontarán ${usedDesperdicios.length} retal(es) de inventario (Sin ID).\n`;
    }
    if (fullSheets.length > 0) {
        if (inStockSheets.length > 0) {
            const idList = inStockSheets.map(s => s.laminaIdRef ? `[ID #${s.laminaIdRef}]` : '').filter(Boolean).join(', ');
            confirmMsg += `• Láminas base de inventario: se descontarán ${inStockSheets.length} lámina(s) (${material}${idList ? `: ${idList}` : ''}).\n`;
            if (fullSheets.length > inStockSheets.length) {
                confirmMsg += `  (Nota: ${fullSheets.length - inStockSheets.length} lámina(s) requerida(s) no están registradas en stock y no se descontarán).\n`;
            }
        } else if (selectedLaminaId) {
            const lam = laminasInventory.find(l => l.id === selectedLaminaId);
            const idText = lam && lam.idRef ? ` [ID #${lam.idRef}]` : '';
            confirmMsg += `• Láminas base: se descontarán ${fullSheets.length} lámina(s) (${material}${idText}).\n`;
        } else {
            confirmMsg += `• Lámina base no vinculada (se requieren ${fullSheets.length} láminas, pero no se descontarán del stock).\n`;
        }
    } else {
        confirmMsg += `• Láminas base completas consumidas: 0 (¡Optimizado 100% con retales!).\n`;
    }
    confirmMsg += `• Nuevos retales a guardar: ${toSave.length} retal(es) (se registrarán sin ID).\n`;
    confirmMsg += `• Desechos a descartar: ${toDiscard.length} pedazo(s).\n`;

    if (!confirm(confirmMsg)) return;

    const btn = document.getElementById('confirm-deduct-inventory-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-1"></i> Descontando...`;
    }

    try {
        const currentUser = auth.currentUser;
        const uid = currentUser ? currentUser.uid : 'anonimo';

        // 1. Descontar retales usados del inventario
        const despCountMap = {};
        for (const despSheet of usedDesperdicios) {
            if (despSheet.desperdicioId) {
                despCountMap[despSheet.desperdicioId] = (despCountMap[despSheet.desperdicioId] || 0) + 1;
            }
        }
        for (const [despId, countUsed] of Object.entries(despCountMap)) {
            const item = laminasInventory.find(l => l.id === despId);
            const currentQty = item ? (parseInt(item.cantidad) || 1) : 1;
            const newQty = Math.max(0, currentQty - countUsed);
            const despRef = doc(db, "vidrio_laminas", despId);
            if (newQty === 0) {
                await updateDoc(despRef, {
                    cantidad: 0,
                    archived: true,
                    updatedAt: new Date()
                });
            } else {
                await updateDoc(despRef, {
                    cantidad: newQty,
                    updatedAt: new Date()
                });
            }
        }

        // 2. Descontar láminas completas del inventario (individualmente por ID único si están registradas)
        const fullSheetCountMap = {};
        for (const sheet of currentResult.plano) {
            if (!sheet.isDesperdicio && sheet.laminaId) {
                fullSheetCountMap[sheet.laminaId] = (fullSheetCountMap[sheet.laminaId] || 0) + 1;
            }
        }

        if (Object.keys(fullSheetCountMap).length > 0) {
            for (const [lamId, countUsed] of Object.entries(fullSheetCountMap)) {
                const item = laminasInventory.find(l => l.id === lamId);
                const currentQty = item ? (parseInt(item.cantidad) || 1) : 1;
                const newQty = Math.max(0, currentQty - countUsed);
                const lamRef = doc(db, "vidrio_laminas", lamId);
                if (newQty === 0) {
                    await updateDoc(lamRef, {
                        cantidad: 0,
                        archived: true,
                        updatedAt: new Date()
                    });
                } else {
                    await updateDoc(lamRef, {
                        cantidad: newQty,
                        updatedAt: new Date()
                    });
                }
                console.log(`Lámina ${lamId} actualizada a stock ${newQty}`);
            }
        } else if (selectedLaminaId && fullSheetsConsumed > 0) {
            const lam = laminasInventory.find(l => l.id === selectedLaminaId);
            if (lam) {
                const newStock = Math.max(0, (lam.cantidad || 0) - fullSheetsConsumed);
                const lamRef = doc(db, "vidrio_laminas", selectedLaminaId);
                if (newStock === 0) {
                    await updateDoc(lamRef, {
                        cantidad: 0,
                        archived: true,
                        updatedAt: new Date()
                    });
                } else {
                    await updateDoc(lamRef, {
                        cantidad: newStock,
                        updatedAt: new Date()
                    });
                }
                console.log(`Lámina ${selectedLaminaId} actualizada a stock ${newStock}`);
            }
        }

        // 3. Guardar los retales seleccionados en vidrio_laminas (SIN ID)
        for (const r of toSave) {
            await addDoc(collection(db, "vidrio_laminas"), {
                idRef: null, // LOS DESPERDICIOS NO DEBEN TENER ID
                tipoItem: 'retal',
                material: material,
                ancho: r.w,
                alto: r.h,
                cantidad: 1,
                label: r.label || `Retal ${r.w}x${r.h}`,
                ubicacion: r.ubicacion || 'Bodega Retales',
                notas: `Generado en Despiece (${r.sheetBadge || `Lámina ${sheetW}x${sheetH} mm`})`,
                origenDespieceId: activeHistoryId || null,
                createdAt: new Date(),
                createdBy: uid,
                archived: false
            });
        }

        // 4. Actualizar el registro en historial
        if (activeHistoryId) {
            try {
                const histRef = doc(db, "despiece2d_history", activeHistoryId);
                const consumedLaminaIds = currentResult.plano
                    .filter(s => !s.isDesperdicio && s.laminaIdRef)
                    .map(s => s.laminaIdRef);
                await updateDoc(histRef, {
                    inventarioDescontado: true,
                    laminaBaseId: selectedLaminaId || null,
                    laminaIdRef: selectedLamina ? (selectedLamina.idRef || null) : (consumedLaminaIds[0] || null),
                    laminasConsumidas: fullSheetsConsumed,
                    laminasIdRefsConsumidas: consumedLaminaIds,
                    desperdiciosReutilizadosCount: usedDesperdicios.length,
                    retalesGuardadosCount: toSave.length,
                    retalesDesechadosCount: toDiscard.length,
                    updatedAt: new Date()
                });
            } catch (errHist) {
                console.warn("No se pudo actualizar registro de historial:", errHist);
            }
        }

        isInventoryDeducted = true;
        renderRemnantsDecisionCard(sheetW, sheetH);

        if (window.showToast) {
            window.showToast("Inventario actualizado: láminas y retales descontados, y nuevos retales guardados (sin ID).", "success");
        } else {
            alert("¡Inventario actualizado con éxito!");
        }
    } catch (err) {
        console.error("Error al descontar inventario:", err);
        alert("Ocurrió un error al actualizar el inventario: " + err.message);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check-double text-sm"></i> Confirmar y Descontar de Inventario`;
        }
    }
}



