import { db, auth } from '../core/firebase-config.js';
import { collection, addDoc, getDocs, doc, updateDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

let piezasList = [];
let lastId = 0;
let currentResult = null;
let currentSheetIndex = 0;
let activeHistoryId = null;

export function setupDespieceEvents() {
    if (window.__setupDespieceEventsInit) return;
    window.__setupDespieceEventsInit = true;

    renderDespieceUI();
    renderPiezasTable();
    setupListeners();
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
        <div class="flex border-b border-gray-200">
            <button id="tab-despiece-calc" class="border-b-2 border-indigo-600 px-6 py-3 text-sm font-bold text-indigo-650 transition-all flex items-center gap-2">
                <i class="fa-solid fa-calculator"></i> Nueva Optimización
            </button>
            <button id="tab-despiece-history" class="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition-all flex items-center gap-2">
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

                        <div class="grid grid-cols-2 gap-3">
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

                        <div class="space-y-2 pt-2">
                            <label class="flex items-center space-x-2.5 cursor-pointer my-0">
                                <input type="checkbox" id="opt-rotate" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/20" checked>
                                <span class="text-xs font-semibold text-slate-700 select-none">Permitir rotación de piezas</span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Columna Agregar/Listado (Centro/Derecha) -->
                <div class="space-y-6 lg:col-span-2">
                    <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                        <div class="flex items-center gap-3 border-b border-gray-100 pb-4 mb-4">
                            <div class="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
                                <i class="fa-solid fa-puzzle-piece"></i>
                            </div>
                            <h2 class="text-sm font-bold text-gray-800">Añadir Piezas a Cortar</h2>
                        </div>
                        
                        <form id="add-pieza-form" class="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                            <div class="sm:col-span-3">
                                <label for="pieza-width" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ancho pieza (mm)</label>
                                <input type="number" id="pieza-width" class="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white font-semibold text-slate-700" placeholder="Ej: 1200" required min="10">
                            </div>
                            <div class="sm:col-span-3">
                                <label for="pieza-height" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Alto pieza (mm)</label>
                                <input type="number" id="pieza-height" class="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white font-semibold text-slate-700" placeholder="Ej: 800" required min="10">
                            </div>
                            <div class="sm:col-span-2">
                                <label for="pieza-cant" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cantidad (uds)</label>
                                <input type="number" id="pieza-cant" class="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white font-semibold text-slate-700" value="1" required min="1">
                            </div>
                            <div class="sm:col-span-2">
                                <label for="pieza-label" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Etiqueta (Opcional)</label>
                                <input type="text" id="pieza-label" class="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all bg-gray-50 focus:bg-white font-semibold text-slate-700" placeholder="Ej: Ventana">
                            </div>
                            <div class="sm:col-span-2">
                                <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow-sm hover:shadow-md transition-all h-[42px] flex items-center justify-center gap-1.5">
                                    <i class="fa-solid fa-plus text-sm"></i> Agregar
                                </button>
                            </div>
                        </form>

                        <!-- Utilidades de Importación Excel/CSV -->
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-gray-100 pt-6 pb-2">
                            <span class="text-xs font-bold text-gray-700 flex items-center gap-2">
                                <i class="fa-solid fa-list-check text-indigo-500 text-sm"></i> Listado de Piezas a Optimizar
                            </span>
                            <div class="flex gap-2.5">
                                <button id="despiece-download-template-btn" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-750 border border-emerald-200 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition">
                                    <i class="fa-solid fa-file-excel text-sm"></i> Plantilla Excel
                                </button>
                                <button id="despiece-import-excel-btn" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-755 border border-indigo-200 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition">
                                    <i class="fa-solid fa-file-import text-sm"></i> Importar Excel
                                </button>
                                <input type="file" id="despiece-excel-file-input" accept=".xlsx, .xls, .csv" class="hidden">
                            </div>
                        </div>

                        <div class="pt-2">
                            <div class="overflow-x-auto">
                                <table class="w-full text-left border-collapse">
                                    <thead>
                                        <tr class="border-b border-gray-100 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                            <th class="pb-3">Pieza</th>
                                            <th class="pb-3">Etiqueta</th>
                                            <th class="pb-3">Ancho (mm)</th>
                                            <th class="pb-3">Alto (mm)</th>
                                            <th class="pb-3">Cantidad</th>
                                            <th class="pb-3 text-right">Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody id="piezas-list-body" class="divide-y divide-slate-100 text-sm font-semibold text-slate-700">
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <button id="calculate-despiece-btn" class="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 text-sm">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Calcular Optimización
                        </button>
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
            </div>
        </div> <!-- Fin de despiece-calc-container -->

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
    </div>
`;
}

function renderPiezasTable() {
    const tbody = document.getElementById('piezas-list-body');
    if (!tbody) return;

    if (piezasList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-12 text-center text-gray-400">
                    <div class="flex flex-col items-center justify-center space-y-2">
                        <div class="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center text-gray-300">
                            <i class="fa-solid fa-shapes text-xl"></i>
                        </div>
                        <p class="text-xs font-semibold text-gray-400">No hay piezas agregadas todavía</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = piezasList.map((p, idx) => {
        const isError = p.hasError;
        const rowClass = isError ? 'bg-red-50/70 border border-red-200 hover:bg-red-50 transition-colors' : 'hover:bg-gray-50/50 transition-colors';
        const numColorClass = isError ? 'text-red-650' : 'text-indigo-600';
        const inputBgClass = isError ? 'bg-red-100/30 border border-red-200 focus:ring-red-500/20 focus:border-red-500' : 'bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500';

        return `
        <tr class="${rowClass}">
            <td class="py-3 font-bold ${numColorClass}">${idx + 1}</td>
            <td class="py-3">
                <input type="text" class="edit-label-input w-full max-w-[140px] px-3 py-1.5 border border-gray-200 rounded-xl text-xs ${inputBgClass} outline-none transition-all font-semibold text-slate-700" value="${p.label || ''}" data-id="${p.id}" placeholder="Ej: Ventana">
            </td>
            <td class="py-3">
                <input type="number" class="edit-width-input w-24 px-3 py-1.5 border border-gray-200 rounded-xl text-xs ${inputBgClass} outline-none transition-all font-semibold text-slate-700" value="${p.w0}" data-id="${p.id}" min="10">
            </td>
            <td class="py-3">
                <input type="number" class="edit-height-input w-24 px-3 py-1.5 border border-gray-200 rounded-xl text-xs ${inputBgClass} outline-none transition-all font-semibold text-slate-700" value="${p.h0}" data-id="${p.id}" min="10">
            </td>
            <td class="py-3">
                <input type="number" class="edit-cant-input w-24 px-3 py-1.5 border border-gray-200 rounded-xl text-xs ${inputBgClass} outline-none transition-all font-semibold text-slate-700" value="${p.cant}" data-id="${p.id}" min="1">
            </td>
            <td class="py-3 text-right">
                <button class="delete-pieza-btn text-red-500 hover:text-red-750 hover:bg-red-50 p-2 rounded-xl transition-all" data-id="${p.id}" title="Eliminar">
                    <i class="fa-solid fa-trash-can text-sm pointer-events-none"></i>
                </button>
            </td>
        </tr>
        `;
    }).join('');

    const clearRowErrorStyles = (input) => {
        const id = parseInt(input.dataset.id);
        const item = piezasList.find(p => p.id === id);
        if (item) {
            item.hasError = false;
        }
        const row = input.closest('tr');
        if (row) {
            row.className = 'hover:bg-gray-50/50 transition-colors';
            const numCol = row.querySelector('td');
            if (numCol) {
                numCol.className = 'py-3 font-bold text-indigo-600';
            }
            row.querySelectorAll('input').forEach(inp => {
                inp.classList.remove('bg-red-100/30', 'border-red-200', 'focus:ring-red-500/20', 'focus:border-red-500');
                inp.classList.add('bg-gray-50', 'focus:bg-white', 'focus:ring-2', 'focus:ring-indigo-500/20', 'focus:border-indigo-500');
            });
        }
    };

    // Guardado en tiempo real en la lista al escribir en los inputs
    tbody.querySelectorAll('.edit-label-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const id = parseInt(input.dataset.id);
            const item = piezasList.find(p => p.id === id);
            if (item) {
                item.label = input.value.trim();
                clearRowErrorStyles(input);
            }
        });
    });

    tbody.querySelectorAll('.edit-width-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const id = parseInt(input.dataset.id);
            const item = piezasList.find(p => p.id === id);
            if (item) {
                item.w0 = parseInt(input.value) || 0;
                clearRowErrorStyles(input);
            }
        });
    });

    tbody.querySelectorAll('.edit-height-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const id = parseInt(input.dataset.id);
            const item = piezasList.find(p => p.id === id);
            if (item) {
                item.h0 = parseInt(input.value) || 0;
                clearRowErrorStyles(input);
            }
        });
    });

    tbody.querySelectorAll('.edit-cant-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const id = parseInt(input.dataset.id);
            const item = piezasList.find(p => p.id === id);
            if (item) {
                item.cant = parseInt(input.value) || 1;
                clearRowErrorStyles(input);
            }
        });
    });

    tbody.querySelectorAll('.delete-pieza-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id);
            piezasList = piezasList.filter(p => p.id !== id);
            renderPiezasTable();
        });
    });
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
                    piezasList = [...piezasList, ...newPieces];
                    activeHistoryId = null;
                    renderPiezasTable();
                    alert(`¡Éxito! Se importaron ${importedCount} piezas del archivo Excel/CSV.`);
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

            activeHistoryId = null; // Resetear ID cuando se agrega una pieza nueva
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
    const tabHistoryBtn = document.getElementById('tab-despiece-history');
    if (tabCalcBtn && tabHistoryBtn) {
        tabCalcBtn.addEventListener('click', () => switchDespieceTab('calc'));
        tabHistoryBtn.addEventListener('click', () => switchDespieceTab('history'));
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

    // Resetear activeHistoryId cuando el usuario edite las inputs del listado o elimine piezas
    const tbody = document.getElementById('piezas-list-body');
    if (tbody) {
        tbody.addEventListener('input', resetHistoryState);
        tbody.addEventListener('click', (e) => {
            if (e.target.closest('.delete-pieza-btn')) {
                activeHistoryId = null;
            }
        });
    }
}

function calculateOptimization() {
    if (piezasList.length === 0) {
        alert('Agrega al menos una pieza a cortar para realizar el despiece.');
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
    const cuts = piezasList.map(p => ({
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
            let result = guillotinePack(sheetW, sheetH, cuts, allowRotate, strategy);

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
                    const key = `${label} (${p.w}x${p.h} mm)`;
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
            displayResults(sheetW, sheetH);

            // Guardar automáticamente en el historial de despieces
            saveDespieceToHistory(sheetW, sheetH, allowRotate, strategy, result);
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
    document.getElementById('res-sheets-count').textContent = currentResult.numeroLaminas;
    document.getElementById('res-pieces-placed').textContent = currentResult.plano.reduce((t, s) => t + s.cortes.length, 0);

    const totalSheetArea = sheetW * sheetH * currentResult.numeroLaminas;
    const totalPlacedArea = currentResult.plano.reduce((accSheet, s) => accSheet + s.cortes.reduce((accPiece, p) => accPiece + p.ancho * p.alto, 0), 0);
    const utilPct = ((totalPlacedArea / totalSheetArea) * 100).toFixed(1);

    document.getElementById('res-utilization').textContent = `${utilPct}%`;
    document.getElementById('res-useful-area').textContent = `${(totalPlacedArea / 1000000).toFixed(2)} m²`;
    document.getElementById('res-waste-area').textContent = `${((totalSheetArea - totalPlacedArea) / 1000000).toFixed(2)} m²`;

    // Render sheets pagination tabs
    const tabsContainer = document.getElementById('sheet-tabs');
    tabsContainer.innerHTML = currentResult.plano.map((_, idx) => `
        <button class="sheet-tab-btn px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${idx === currentSheetIndex ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}" data-index="${idx}">
            Lámina ${idx + 1}
        </button>
    `).join('');

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

    const containerWidth = Math.min(1400, canvas.parentElement.clientWidth - 32);
    const scale = (containerWidth - 40) / sheetW;

    renderSheetToCanvas(canvas, sheet, sheetW, sheetH, scale, false);
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
        sheet.sobrantes.forEach((r) => {
            const x = margin + r.x * scale;
            const y = margin + r.y * scale;
            const w = r.w * scale;
            const h = r.h * scale;

            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(x, y, w, h);

            ctx.strokeStyle = isForPrinting ? '#a1a1aa' : '#cbd5e1';
            ctx.lineWidth = isForPrinting ? 1.5 : 1.0;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);

            if (w >= 20 && h >= 15) {
                ctx.fillStyle = '#000000';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                if (h >= 36 && w >= 50) {
                    ctx.font = 'bold 16px sans-serif';
                    ctx.fillText('*', x + w / 2, y + h / 2 - 6);

                    ctx.font = '8px sans-serif';
                    ctx.fillText(`${r.w}x${r.h}`, x + w / 2, y + h / 2 + 8);
                } else {
                    ctx.font = 'bold 10px sans-serif';
                    ctx.fillText('*', x + w / 2, y + h / 2);
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
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = sheetW * scale;
        tempCanvas.height = sheetH * scale;

        renderSheetToCanvas(tempCanvas, sheet, sheetW, sheetH, scale, true);
        const dataUrl = tempCanvas.toDataURL();

        const sheetArea = sheetW * sheetH;
        const placedArea = sheet.cortes.reduce((acc, c) => acc + c.ancho * c.alto, 0);
        const utilPct = ((placedArea / sheetArea) * 100).toFixed(1);

        return `
            <div class="sheet-container">
                <div class="sheet-header">
                    <h2>LÁMINA N° ${idx + 1} de ${currentResult.numeroLaminas} &bull; ${materialName}</h2>
                    <span>Aprovechamiento: <strong>${utilPct}%</strong> (${(placedArea / 1000000).toFixed(2)} m²)</span>
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
            return `
<div class="label${isLastLabel ? ' last' : ''}">
  <!-- ENCABEZADO SUPERIOR: Empresa | Fecha | Secuencia -->
  <div class="top-bar">
    <span class="brand">
      <img src="recursos/logove.png" class="logo-img" />
      VIDRIOS EXITO
    </span>
    <span class="fecha">${fechaLabel}</span>
    <span class="seq">#${globalIdx + 1}/${totalPieces} &bull; LAM ${p.sheetNumber}</span>
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
          <span class="pos-val">X:${p.x} Y:${p.y}</span>
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
            if (strategy === 'VERT_FIRST') {
                const isFirstCut = (rect.x === 0 && rect.y === 0 && rect.w === sheetW && rect.h === sheetH);
                if (isFirstCut) {
                    actualSplitRule = 'SASV'; // Primer corte estrictamente vertical para separar la lámina
                }
            } else {
                const isFirstCut = (rect.x === 0 && rect.y === 0 && rect.w === sheetW && rect.h === sheetH);
                if (isFirstCut) {
                    if (strategy === 'GUIL_ROWS') {
                        actualSplitRule = 'SASH';
                    } else if (strategy === 'GUIL_COLS') {
                        actualSplitRule = 'SASV';
                    }
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
        freeRects: sheet.freeRects,
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

    // 4. Reglas de división de espacio sobrante
    const splitRules = ['SASH', 'SASV', 'SLAS', 'LLAS'];

    // 5. Estrategias de guillotina a evaluar
    const strategies = strategy === 'AUTO' ? ['GUIL_ROWS', 'GUIL_COLS'] : [strategy];

    let remainingPieces = flatPieces.map(p => ({ ...p }));
    const sheets = [];

    // Empaquetar lámina por lámina de forma independiente (greedy sheet-by-sheet)
    while (remainingPieces.length > 0) {
        let bestSheetResult = null;

        // Probamos todas las combinaciones para llenar ESTA lámina
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
        sobrantes: sh.freeRects
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
        const totalSheetArea = sheetW * sheetH * result.numeroLaminas;
        const totalPlacedArea = result.plano.reduce((accSheet, s) => accSheet + s.cortes.reduce((accPiece, p) => accPiece + p.ancho * p.alto, 0), 0);
        const efficiency = parseFloat(((totalPlacedArea / totalSheetArea) * 100).toFixed(1));

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
                efficiency: efficiency
            }
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
    const tabHistoryBtn = document.getElementById('tab-despiece-history');
    const calcContainer = document.getElementById('despiece-calc-container');
    const historyContainer = document.getElementById('despiece-history-container');

    if (!tabCalcBtn || !tabHistoryBtn || !calcContainer || !historyContainer) return;

    if (tab === 'calc') {
        calcContainer.classList.remove('hidden');
        historyContainer.classList.add('hidden');
        
        tabCalcBtn.className = "border-b-2 border-indigo-650 px-6 py-3 text-sm font-bold text-indigo-600 transition-all flex items-center gap-2";
        tabHistoryBtn.className = "border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition-all flex items-center gap-2";
    } else {
        calcContainer.classList.add('hidden');
        historyContainer.classList.remove('hidden');
        
        tabHistoryBtn.className = "border-b-2 border-indigo-650 px-6 py-3 text-sm font-bold text-indigo-600 transition-all flex items-center gap-2";
        tabCalcBtn.className = "border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition-all flex items-center gap-2";
        
        loadDespieceHistory();
    }
}

async function loadDespieceHistory() {
    const tbody = document.getElementById('despiece-history-body');
    if (!tbody) return;

    tbody.innerHTML = `
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
    `;

    try {
        const historyQuery = query(collection(db, "despiece2d_history"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(historyQuery);

        const activeDocs = snapshot.docs.filter(docSnap => docSnap.data().archived !== true);

        if (activeDocs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="py-12 text-center text-gray-400">
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

            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50/50 transition-colors";
            tr.innerHTML = `
                <td class="py-3.5 px-2 font-medium text-slate-500">${date}</td>
                <td class="py-3.5 px-2 font-bold text-slate-800">${client}</td>
                <td class="py-3.5 px-2 font-semibold text-indigo-650">${material}</td>
                <td class="py-3.5 px-2 font-mono text-xs text-slate-600">${sheetSize}</td>
                <td class="py-3.5 px-2 text-slate-600">${piecesCount} pieza(s)</td>
                <td class="py-3.5 px-2 text-center font-bold text-indigo-700">${sheetsCount}</td>
                <td class="py-3.5 px-2 text-center font-bold text-emerald-600">${efficiency}</td>
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
                <td colspan="8" class="py-12 text-center text-red-500">
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

