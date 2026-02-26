// js/modules/inventario.js

import { db, storage, functions } from '../firebase-config.js';
import { collection, doc, updateDoc, addDoc, query, getDocs, where, writeBatch, runTransaction, serverTimestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { 
    allImportaciones, setAllImportaciones, allComprasNacionales, setAllComprasNacionales,
    allItems, allProveedores, currentUser, allItemAverageCosts, setAllItemAverageCosts,
    showModalMessage, hideModal, showTemporaryMessage, initSearchableInput 
} from '../app.js';
import { renderItems } from './items.js';
import { renderProveedores } from './proveedores.js';
import { formatCurrency, unformatCurrency, unformatCurrencyInput, formatCurrencyInput, getOperationDays } from '../utils.js';
import { DOCUMENTOS_IMPORTACION, GASTOS_NACIONALIZACION, METODOS_DE_PAGO, METODOS_DE_PAGO_IMPORTACION } from '../constants.js';

// --- CONFIGURACIÓN DE CACHÉ Y PAGINACIÓN ---
const IMP_CACHE_KEY = 'importaciones_cache';
const IMP_SYNC_KEY = 'importaciones_last_sync';

const NAC_CACHE_KEY = 'nacionales_cache';
const NAC_SYNC_KEY = 'nacionales_last_sync';

let currentPageImp = 1;
let currentPageNac = 1;
const itemsPerPage = 10; // Menos items por página aquí porque las tarjetas son más grandes
let dynamicElementCounter = 0;

// ==========================================
// 1. CARGA INTELIGENTE: IMPORTACIONES
// ==========================================
export async function loadImportaciones() {
    const cachedData = localStorage.getItem(IMP_CACHE_KEY);
    const lastSyncStr = localStorage.getItem(IMP_SYNC_KEY);
    let lastSync = null;
    let mapImportaciones = new Map();

    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            parsedData.forEach(imp => mapImportaciones.set(imp.id, imp));
            setAllImportaciones(Array.from(mapImportaciones.values()));
            renderImportaciones();
            calculateAllAverageCosts(); 
        } catch (e) {
            localStorage.removeItem(IMP_CACHE_KEY);
            localStorage.removeItem(IMP_SYNC_KEY);
        }
    }

    if (lastSyncStr) lastSync = new Date(parseInt(lastSyncStr));

    try {
        const colRef = collection(db, "importaciones");
        let q;
        if (lastSync) {
            const syncTime = new Date(lastSync.getTime() - 60000); 
            q = query(colRef, where("lastUpdated", ">=", syncTime)); // Usas lastUpdated en tu código actual
        } else {
            q = query(colRef);
        }

        const snapshot = await getDocs(q);
        let huboCambios = false;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.lastUpdated && typeof data.lastUpdated.toMillis === 'function') data.lastUpdated = data.lastUpdated.toMillis();
            mapImportaciones.set(doc.id, { id: doc.id, ...data });
            huboCambios = true;
        });

        if (huboCambios || !lastSync) {
            const finalArray = Array.from(mapImportaciones.values());
            finalArray.sort((a, b) => b.numeroImportacion - a.numeroImportacion);
            
            localStorage.setItem(IMP_CACHE_KEY, JSON.stringify(finalArray));
            localStorage.setItem(IMP_SYNC_KEY, Date.now().toString());

            setAllImportaciones(finalArray);
            renderImportaciones();
            calculateAllAverageCosts();
        }
    } catch (error) {
        console.error("Error sincronizando importaciones:", error);
    }
}

function updateImportacionCache(updatedImp) {
    const cachedData = localStorage.getItem(IMP_CACHE_KEY);
    let importaciones = cachedData ? JSON.parse(cachedData) : [];
    
    const index = importaciones.findIndex(i => i.id === updatedImp.id);
    if (index !== -1) importaciones[index] = updatedImp;
    else importaciones.push(updatedImp);
    
    importaciones.sort((a, b) => b.numeroImportacion - a.numeroImportacion);
    localStorage.setItem(IMP_CACHE_KEY, JSON.stringify(importaciones));
    setAllImportaciones(importaciones);
    renderImportaciones();
    calculateAllAverageCosts();
}

// ==========================================
// 2. CARGA INTELIGENTE: COMPRAS NACIONALES
// ==========================================
export async function loadComprasNacionales() {
    const cachedData = localStorage.getItem(NAC_CACHE_KEY);
    const lastSyncStr = localStorage.getItem(NAC_SYNC_KEY);
    let lastSync = null;
    let mapCompras = new Map();

    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            parsedData.forEach(c => mapCompras.set(c.id, c));
            setAllComprasNacionales(Array.from(mapCompras.values()));
            renderComprasNacionales(); 
            renderProveedores(); 
        } catch (e) {
            localStorage.removeItem(NAC_CACHE_KEY);
            localStorage.removeItem(NAC_SYNC_KEY);
        }
    }

    if (lastSyncStr) lastSync = new Date(parseInt(lastSyncStr));

    try {
        const colRef = collection(db, "comprasNacionales");
        let q;
        if (lastSync) {
            const syncTime = new Date(lastSync.getTime() - 60000); 
            q = query(colRef, where("_lastUpdated", ">=", syncTime));
        } else {
            q = query(colRef);
        }

        const snapshot = await getDocs(q);
        let huboCambios = false;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data._lastUpdated && typeof data._lastUpdated.toMillis === 'function') data._lastUpdated = data._lastUpdated.toMillis();
            if (data.creadoEn && typeof data.creadoEn.toMillis === 'function') data.creadoEn = data.creadoEn.toMillis();
            mapCompras.set(doc.id, { id: doc.id, ...data });
            huboCambios = true;
        });

        if (huboCambios || !lastSync) {
            const finalArray = Array.from(mapCompras.values());
            finalArray.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
            
            localStorage.setItem(NAC_CACHE_KEY, JSON.stringify(finalArray));
            localStorage.setItem(NAC_SYNC_KEY, Date.now().toString());

            setAllComprasNacionales(finalArray);
            renderComprasNacionales();
            renderProveedores();
        }
    } catch (error) {
        console.error("Error sincronizando compras nacionales:", error);
    }
}

function updateNacionalCache(updatedCompra) {
    const cachedData = localStorage.getItem(NAC_CACHE_KEY);
    let compras = cachedData ? JSON.parse(cachedData) : [];
    
    const index = compras.findIndex(c => c.id === updatedCompra.id);
    if (index !== -1) compras[index] = updatedCompra;
    else compras.push(updatedCompra);
    
    compras.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    localStorage.setItem(NAC_CACHE_KEY, JSON.stringify(compras));
    setAllComprasNacionales(compras);
    renderComprasNacionales();
    renderProveedores();
}

// ==========================================
// RENDERIZADO CON PAGINACIÓN: IMPORTACIONES
// ==========================================
export function renderImportaciones() {
    const container = document.getElementById('importaciones-list');
    if (!container) return;

    // Aquí podrías agregar un searchInput si lo desearas, por ahora lo dejamos sin filtro
    const totalItems = allImportaciones.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    if (currentPageImp > totalPages) currentPageImp = totalPages;
    if (currentPageImp < 1) currentPageImp = 1;

    const startIdx = (currentPageImp - 1) * itemsPerPage;
    const paginatedImportaciones = allImportaciones.slice().sort((a, b) => b.numeroImportacion - a.numeroImportacion).slice(startIdx, startIdx + itemsPerPage);

    container.innerHTML = '';
    if (totalItems === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-4 col-span-full">No hay importaciones registradas.</p>';
        return;
    }

    paginatedImportaciones.forEach(imp => {
        const logisticaStatus = getImportacionStatus(imp); 
        const documentosSubidos = Object.keys(imp.documentos || {}).length;
        const documentosRequeridos = DOCUMENTOS_IMPORTACION.length;

        let docStatusHTML = '';
        if (imp.estadoLogistico !== 'En Bodega') { 
            if (documentosSubidos === documentosRequeridos) {
                docStatusHTML = `<span class="text-xs font-semibold px-2 py-1 rounded-full bg-teal-100 text-teal-800">Doc. Completos</span>`;
            } else {
                docStatusHTML = `<span class="text-xs font-semibold px-2 py-1 rounded-full bg-orange-100 text-orange-800">Doc. Faltantes</span>`;
            }
        }

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
                Gestionar
            </button>
        `;

        card.querySelector('.edit-importacion-btn').addEventListener('click', () => showImportacionModal(imp));
        container.appendChild(card);
    });

    // Paginación Importaciones
    const pagImpEl = document.createElement('div');
    pagImpEl.className = 'col-span-full flex justify-between items-center mt-4 pt-4 border-t border-gray-200';
    pagImpEl.innerHTML = `
        <span class="text-sm text-gray-600">Mostrando ${startIdx + 1} - ${Math.min(startIdx + itemsPerPage, totalItems)} de ${totalItems}</span>
        <div class="flex gap-2">
            <button id="prev-imp-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPageImp === 1 ? 'disabled' : ''}>Anterior</button>
            <span class="px-3 py-1 font-semibold text-gray-700">Pág ${currentPageImp} de ${totalPages}</span>
            <button id="next-imp-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPageImp === totalPages ? 'disabled' : ''}>Siguiente</button>
        </div>
    `;
    container.appendChild(pagImpEl);

    const prevImpBtn = document.getElementById('prev-imp-btn');
    const nextImpBtn = document.getElementById('next-imp-btn');
    if (prevImpBtn && currentPageImp > 1) prevImpBtn.addEventListener('click', () => { currentPageImp--; renderImportaciones(); });
    if (nextImpBtn && currentPageImp < totalPages) nextImpBtn.addEventListener('click', () => { currentPageImp++; renderImportaciones(); });
}

// ==========================================
// RENDERIZADO CON PAGINACIÓN: NACIONALES
// ==========================================
export function renderComprasNacionales() {
    const container = document.getElementById('nacional-list');
    if (!container) return;

    const totalItems = allComprasNacionales.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    if (currentPageNac > totalPages) currentPageNac = totalPages;
    if (currentPageNac < 1) currentPageNac = 1;

    const startIdx = (currentPageNac - 1) * itemsPerPage;
    const paginatedNacionales = allComprasNacionales.slice(startIdx, startIdx + itemsPerPage);

    container.innerHTML = ''; 
    if (totalItems === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-8">Aún no se han registrado compras nacionales.</p>';
        return;
    }

    paginatedNacionales.forEach(compra => {
        const totalAbonado = (compra.abonos || []).reduce((sum, abono) => sum + abono.valor, 0);
        const saldoPendiente = compra.valorTotalCompra - totalAbonado;

        let estadoPago = '';
        if (saldoPendiente <= 0) estadoPago = `<span class="text-xs font-semibold bg-green-200 text-green-800 px-2 py-1 rounded-full">Pagado</span>`;
        else if (totalAbonado > 0) estadoPago = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Abono</span>`;
        else estadoPago = `<span class="text-xs font-semibold bg-red-200 text-red-800 px-2 py-1 rounded-full">Pendiente</span>`;

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

    container.querySelectorAll('.edit-nacional-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const compraData = JSON.parse(e.currentTarget.dataset.compraJson);
            showNacionalModal(compraData);
        });
    });

    // Paginación Nacionales
    const pagNacEl = document.createElement('div');
    pagNacEl.className = 'flex justify-between items-center mt-4 pt-4 border-t border-gray-200';
    pagNacEl.innerHTML = `
        <span class="text-sm text-gray-600">Mostrando ${startIdx + 1} - ${Math.min(startIdx + itemsPerPage, totalItems)} de ${totalItems}</span>
        <div class="flex gap-2">
            <button id="prev-nac-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPageNac === 1 ? 'disabled' : ''}>Anterior</button>
            <span class="px-3 py-1 font-semibold text-gray-700">Pág ${currentPageNac} de ${totalPages}</span>
            <button id="next-nac-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPageNac === totalPages ? 'disabled' : ''}>Siguiente</button>
        </div>
    `;
    container.appendChild(pagNacEl);

    const prevNacBtn = document.getElementById('prev-nac-btn');
    const nextNacBtn = document.getElementById('next-nac-btn');
    if (prevNacBtn && currentPageNac > 1) prevNacBtn.addEventListener('click', () => { currentPageNac--; renderComprasNacionales(); });
    if (nextNacBtn && currentPageNac < totalPages) nextNacBtn.addEventListener('click', () => { currentPageNac++; renderComprasNacionales(); });
}

// --- CÁLCULOS GLOBALES (COSTEO PROMEDIO) ---
export function calculateAllAverageCosts() {
    const costData = {}; 
    allImportaciones.forEach(imp => {
        const trm = imp.trmLiquidacion || 4100; 
        if (imp.items && Array.isArray(imp.items)) {
            imp.items.forEach(item => {
                if (item.itemId && item.cantidad > 0 && item.valorTotalItemUSD > 0) {
                    if (!costData[item.itemId]) costData[item.itemId] = { totalCostCOP: 0, totalQuantity: 0 };
                    const costInCOP = item.valorTotalItemUSD * trm;
                    costData[item.itemId].totalCostCOP += costInCOP;
                    costData[item.itemId].totalQuantity += item.cantidad;
                }
            });
        }
    });

    const newCosts = {};
    for (const itemId in costData) {
        const data = costData[itemId];
        if (data.totalQuantity > 0) newCosts[itemId] = data.totalCostCOP / data.totalQuantity;
    }
    
    setAllItemAverageCosts(newCosts);
    renderItems(); 
}

function getImportacionStatus(importacion) {
    if (importacion.estadoLogistico === 'En Bodega') return { text: 'En Bodega', color: 'bg-green-100 text-green-800' };
    if (importacion.estadoLogistico === 'En Puerto') return { text: 'En Puerto', color: 'bg-blue-100 text-blue-800' };
    const totalChinaUSD = importacion.totalChinaUSD || 0;
    const totalAbonadoChinaUSD = (importacion.abonos || []).reduce((sum, abono) => sum + (abono.valorUSD || 0), 0);
    if (totalChinaUSD > 0 && totalChinaUSD - totalAbonadoChinaUSD < 1) return { text: 'Cancelado', color: 'bg-green-200 text-green-800' };
    if (totalAbonadoChinaUSD > 0) return { text: 'Con Abono', color: 'bg-yellow-100 text-yellow-800' };
    return { text: 'Creada', color: 'bg-gray-100 text-gray-800' };
}

async function getLiveTRM() {
    const trmDisplay = document.getElementById('importacion-trm');
    if (!trmDisplay) return 4100; 
    try {
        const trm = 4093.12; 
        trmDisplay.value = trm.toFixed(2);
        return trm;
    } catch (error) {
        trmDisplay.value = 'Error';
        return 4100;
    }
}

// --- MODALES NACIONALES ---
export function showNacionalModal(compra = null) {
    const isEditing = compra !== null;
    const title = isEditing ? `Gestionar Compra Nacional` : "Registrar Compra Nacional";
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');

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

        const abonoBtn = document.getElementById('add-abono-nacional-btn');
        if(abonoBtn) abonoBtn.addEventListener('click', () => handleAbonoNacionalSubmit(compra.id));
    }
}

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
        initSearchableInput(
            itemRow.querySelector('.item-search-input'),
            itemRow.querySelector('.search-results'),
            () => allItems, (i) => `${i.referencia} - ${i.descripcion}`, (sel) => {
                itemRow.querySelector('.item-id-hidden').value = sel ? sel.id : '';
            }
        );
        
        const valorInput = itemRow.querySelector('.item-valor-total');
        valorInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
        valorInput.addEventListener('blur', (e) => { formatCurrencyInput(e.target); calcularTotalCompraNacional(); });
        valorInput.addEventListener('input', calcularTotalCompraNacional);

        itemRow.querySelector('.remove-nacional-item-btn').addEventListener('click', () => {
            itemRow.remove();
            calcularTotalCompraNacional();
        });
    }

    return itemRow;
}

function calcularTotalCompraNacional() {
    let total = 0;
    document.querySelectorAll('.nacional-item-row').forEach(row => {
        total += unformatCurrency(row.querySelector('.item-valor-total').value || '0');
    });
    const resultEl = document.getElementById('nacional-total-compra');
    if (resultEl) resultEl.textContent = formatCurrency(total);
}

async function handleNacionalSubmit(e) {
    e.preventDefault();

    const proveedorId = document.getElementById('nacional-proveedor-id').value;
    if (!proveedorId) return showModalMessage("Debes seleccionar un proveedor válido.");

    let items;
    try {
        items = Array.from(document.querySelectorAll('.nacional-item-row')).map(row => {
            const itemId = row.querySelector('.item-id-hidden').value;
            if (!itemId) throw new Error("Has añadido una fila de ítem vacía o inválida.");
            return {
                itemId: itemId,
                descripcion: allItems.find(i => i.id === itemId)?.descripcion || 'N/A',
                cantidad: parseInt(row.querySelector('.item-cantidad').value) || 0,
                valorTotal: unformatCurrency(row.querySelector('.item-valor-total').value || '0')
            };
        });
    } catch (error) {
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
        creadoEn: Date.now(),
        _lastUpdated: serverTimestamp() // AÑADIDO PARA CACHÉ
    };

    showModalMessage("Registrando compra y actualizando stock...", true);
    try {
        const batch = writeBatch(db);
        const compraDocRef = doc(collection(db, "comprasNacionales"));
        batch.set(compraDocRef, nuevaCompra);

        items.forEach(itemComprado => {
            const itemRef = doc(db, "items", itemComprado.itemId);
            const itemActual = allItems.find(i => i.id === itemComprado.itemId);
            if (itemActual) {
                const nuevoStock = (itemActual.stock || 0) + itemComprado.cantidad;
                batch.update(itemRef, { stock: nuevoStock, _lastUpdated: serverTimestamp() });
            }
        });

        await batch.commit();
        
        // Actualizar caché local
        nuevaCompra.id = compraDocRef.id;
        nuevaCompra._lastUpdated = Date.now();
        updateNacionalCache(nuevaCompra);

        hideModal();
        showTemporaryMessage("¡Compra registrada y stock actualizado!", "success");
        showNacionalModal(nuevaCompra);

    } catch (error) {
        console.error("Error al registrar compra nacional:", error);
        showModalMessage("Error: " + error.message);
    }
}

async function handleAbonoNacionalSubmit(compraId) {
    const valorInput = document.getElementById('abono-nacional-valor');
    if(valorInput) unformatCurrencyInput(valorInput); 

    const valor = unformatCurrency(valorInput.value);
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
        timestamp: Date.now()
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
            timestamp: Date.now(),
            isNationalPurchase: true,
            compraId: compraId,
            _lastUpdated: serverTimestamp() // AÑADIDO
        };

        const compraRef = doc(db, "comprasNacionales", compraId);
        const gastoRef = collection(db, "gastos");
        const batch = writeBatch(db);
        batch.update(compraRef, { abonos: arrayUnion(nuevoAbono), _lastUpdated: serverTimestamp() });
        batch.set(doc(gastoRef), nuevoGasto);
        await batch.commit();

        // Actualizar caché
        const compraActualizada = { ...compraActual, abonos: [...compraActual.abonos, nuevoAbono], _lastUpdated: Date.now() };
        updateNacionalCache(compraActualizada);

        hideModal();
        showTemporaryMessage("Abono y gasto registrados.", "success");
        showNacionalModal(compraActualizada);
    } catch (error) {
        console.error("Error al registrar abono nacional:", error);
        showModalMessage("Error al registrar el abono.");
    }
}

// --- MODALES DE IMPORTACIONES ---
export async function showImportacionModal(importacion = null) {
    const isEditing = importacion !== null;
    const title = isEditing ? `Gestionar Importación N° ${importacion.numeroImportacion}` : "Crear Nueva Importación";
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const metodosDePagoImportacionHTML = METODOS_DE_PAGO_IMPORTACION.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');

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
    setupImportacionModalEventListeners(modalBody, importacion);

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

function renderDocumentosSection(importacion) {
    const container = document.getElementById('documentos-container');
    if (!container) return;
    container.innerHTML = ''; 
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

function createGastoFacturaElement(gastoTipo, factura = null) {
    const isSaved = factura && factura.id;
    const facturaId = isSaved ? factura.id : `factura_${new Date().getTime()}`;
    const facturaData = factura || { id: facturaId, numeroFactura: '', proveedorId: '', proveedorNombre: '', valorTotal: 0, abonos: [], pdfUrl: null };

    const facturaCard = document.createElement('div');
    facturaCard.className = 'factura-card bg-white p-3 rounded-md border border-gray-300';
    facturaCard.dataset.facturaId = facturaData.id;
    facturaCard.dataset.gastoTipo = gastoTipo;

    let cardContentHTML = '';
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');

    if (isSaved) {
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

function initializeItemRowSearch(itemRow) {
    const searchInput = itemRow.querySelector('.item-search-input');
    const resultsContainer = itemRow.querySelector('.search-results');
    initSearchableInput(
        searchInput,
        resultsContainer,
        () => allItems, 
        (item) => `${item.referencia} - ${item.descripcion}`, 
        (selectedItem) => {
            const idInput = itemRow.querySelector('.item-id-hidden');
            const refInput = itemRow.querySelector('.item-referencia-hidden');
            const descInput = itemRow.querySelector('.item-descripcion-hidden');
            if (selectedItem) {
                idInput.value = selectedItem.id;
                refInput.value = selectedItem.referencia;
                descInput.value = selectedItem.descripcion;
            } else {
                idInput.value = ''; refInput.value = ''; descInput.value = '';
            }
        }
    );
}

// --- ACTUALIZADORES DE IMPORTACIONES ---
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

    const fleteUSD = unformatCurrency(form.querySelector('#importacion-flete')?.value || '0', true);
    const seguroUSD = unformatCurrency(form.querySelector('#importacion-seguro')?.value || '0', true);

    let gastosPorVolumenCOP = 0;
    let gastosPorValorCOP = 0;

    form.querySelectorAll('.factura-card').forEach(card => {
        const gastoTipo = card.dataset.gastoTipo;
        const valor = unformatCurrency(card.querySelector('.factura-valor-total-input')?.textContent || card.querySelector('.factura-valor-total-input')?.value || '0');

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

function renderCosteoFinal(items, totalItemsCOP, fleteSeguroCOP, gastosVolumenCOP, gastosValorCOP, trm) {
    const container = document.getElementById('costeo-final-container');
    if (!container) return;
    container.innerHTML = '';

    if (!items || items.length === 0 || totalItemsCOP <= 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 text-center">Añade ítems y costos para ver el costeo final.</p>';
        return;
    }

    const totalCajas = items.reduce((sum, item) => sum + (item.cantidad / (item.laminasPorCaja || 1)), 0);

    items.forEach(item => {
        if (item.cantidad <= 0) return;
        const costoOrigenTotalItem = item.valorTotalItemUSD * trm;
        const cajasDelItem = item.cantidad / (item.laminasPorCaja || 1);
        const participacionPorCajas = totalCajas > 0 ? cajasDelItem / totalCajas : 0;
        const gastosVolumenAsignados = (fleteSeguroCOP + gastosVolumenCOP) * participacionPorCajas;
        const participacionPorValor = totalItemsCOP > 0 ? costoOrigenTotalItem / totalItemsCOP : 0;
        const gastosValorAsignados = gastosValorCOP * participacionPorValor;
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

async function handleEstadoUpdate(importacionId, newStatus) {
    const fecha = new Date().toISOString().split('T')[0];
    let updateData = { estadoLogistico: newStatus, lastUpdated: serverTimestamp() };
    let fieldToUpdate = '';

    if (newStatus === 'En Puerto') fieldToUpdate = 'fechaLlegadaPuerto';
    else if (newStatus === 'En Bodega') fieldToUpdate = 'fechaLlegadaBodega';

    if (fieldToUpdate) updateData[fieldToUpdate] = fecha;

    const importacionActual = allImportaciones.find(i => i.id === importacionId);
    if (!importacionActual) return showModalMessage("Error: No se encontró la importación.");

    if (newStatus === 'En Bodega' && importacionActual.stockActualizado) {
        return showModalMessage("Esta importación ya fue sumada al inventario.", "info");
    }

    showModalMessage(`Actualizando a "${newStatus}"...`, true);

    try {
        const importacionRef = doc(db, "importaciones", importacionId);
        const batch = writeBatch(db);

        if (newStatus === 'En Bodega' && importacionActual.items) {
            updateData.stockActualizado = true; 
            importacionActual.items.forEach(itemImportado => {
                const itemRef = doc(db, "items", itemImportado.itemId);
                const itemEnStock = allItems.find(i => i.id === itemImportado.itemId);
                if (itemEnStock) {
                    const nuevoStock = (itemEnStock.stock || 0) + itemImportado.cantidad;
                    batch.update(itemRef, { stock: nuevoStock, _lastUpdated: serverTimestamp() });
                }
            });
            showTemporaryMessage("¡Estado y stock actualizados con éxito!", "success");
        } else {
            showTemporaryMessage("Estado actualizado con éxito.", "success");
        }

        batch.update(importacionRef, updateData);
        await batch.commit();

        hideModal();
        const updatedObj = { ...importacionActual, ...updateData, lastUpdated: Date.now() };
        updateImportacionCache(updatedObj);
        showImportacionModal(updatedObj);
    } catch (error) {
        console.error(`Error al marcar "${newStatus}":`, error);
        showModalMessage("Error al actualizar el estado.");
    }
}

async function handleDateUpdate(importacionId, fieldId, newDate) {
    const fieldMap = { 'fecha-llegada-puerto': 'fechaLlegadaPuerto', 'fecha-llegada-bodega': 'fechaLlegadaBodega' };
    const dbField = fieldMap[fieldId];
    if (!dbField) return;

    showTemporaryMessage("Actualizando fecha...", "info");
    try {
        const importacionRef = doc(db, "importaciones", importacionId);
        const updateData = { lastUpdated: serverTimestamp() }; 
        updateData[dbField] = newDate;
        await updateDoc(importacionRef, updateData);

        const importacionIndex = allImportaciones.findIndex(i => i.id === importacionId);
        if (importacionIndex !== -1) {
            const updatedObj = { ...allImportaciones[importacionIndex], ...updateData, lastUpdated: Date.now() };
            updateImportacionCache(updatedObj);
        }
        showTemporaryMessage("Fecha actualizada.", "success");
    } catch (error) {
        console.error("Error al actualizar fecha:", error);
        showTemporaryMessage("Error al actualizar la fecha.", "error");
    }
}

async function handleDocumentoUpload(importacionId, docTipo, file) {
    const docCard = document.getElementById(`doc-card-${docTipo}`);
    const iconContainer = document.getElementById(`doc-icon-${docTipo}`);
    const infoContainer = document.getElementById(`doc-info-${docTipo}`);
    const actionLabel = docCard.querySelector('label');

    if (!docCard || !iconContainer || !infoContainer) return;

    docCard.className = 'doc-card bg-white p-3 rounded-lg shadow-sm flex items-center gap-3 doc-card-pending';
    iconContainer.innerHTML = `<svg class="h-8 w-8 animate-spin text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
    infoContainer.innerHTML = `<p class="text-sm text-blue-600 font-semibold truncate" title="${file.name}">Subiendo: ${file.name}</p>`;
    actionLabel.textContent = '...';

    try {
        const storagePath = `importaciones/${importacionId}/documentos_soporte/${docTipo}_${file.name}`;
        const fileRef = ref(storage, storagePath);
        const snapshot = await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        const importacionRef = doc(db, "importaciones", importacionId);
        const updatePayload = { [`documentos.${docTipo}`]: { url: downloadURL, name: file.name }, lastUpdated: serverTimestamp() };
        await updateDoc(importacionRef, updatePayload);

        docCard.className = 'doc-card bg-white p-3 rounded-lg shadow-sm flex items-center gap-3 doc-card-complete';
        iconContainer.innerHTML = `<svg class="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
        infoContainer.innerHTML = `<a href="${downloadURL}" target="_blank" class="text-sm text-blue-600 hover:underline truncate" title="${file.name}">${file.name}</a>`;
        actionLabel.textContent = 'Reemplazar';

        const impActual = allImportaciones.find(i => i.id === importacionId);
        if (impActual) {
            const updatedDocs = { ...impActual.documentos };
            updatedDocs[docTipo] = { url: downloadURL, name: file.name };
            updateImportacionCache({ ...impActual, documentos: updatedDocs, lastUpdated: Date.now() });
        }
    } catch (error) {
        console.error("Error al subir documento:", error);
        docCard.className = 'doc-card bg-white p-3 rounded-lg shadow-sm flex items-center gap-3 doc-card-error';
        iconContainer.innerHTML = `<svg class="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
        infoContainer.innerHTML = `<p class="text-xs text-red-600">Error al subir.</p>`;
        actionLabel.textContent = 'Reintentar';
    }
}

async function handleAbonoChinaSubmit(importacionId, buttonElement) {
    const formContainer = buttonElement.closest('.bg-gray-50');
    if (!formContainer) return showModalMessage("Error: No se pudo encontrar el formulario de abono.");

    const valorCopInput = formContainer.querySelector('#abono-china-valor-cop');
    const valorUsdInput = formContainer.querySelector('#abono-china-valor-usd');
    const formaPagoSelect = formContainer.querySelector('#abono-china-forma-pago');
    const fechaInput = formContainer.querySelector('#abono-china-fecha');

    if (!valorCopInput || !valorUsdInput || !formaPagoSelect || !fechaInput) return;

    const valorCOP = unformatCurrency(valorCopInput.value);
    const valorUSD = unformatCurrency(valorUsdInput.value, true);

    if (isNaN(valorCOP) || valorCOP <= 0 || isNaN(valorUSD) || valorUSD <= 0) {
        return showModalMessage("Los valores en COP y USD deben ser mayores a cero.");
    }

    const importacionActual = allImportaciones.find(i => i.id === importacionId);
    if (!importacionActual) return showModalMessage("Error: No se pudo encontrar la importación actual.");

    const totalChinaUSD = importacionActual.totalChinaUSD || 0;
    const totalAbonadoUSD = (importacionActual.abonos || []).reduce((sum, abono) => sum + (abono.valorUSD || 0), 0);
    const saldoPendienteUSD = totalChinaUSD - totalAbonadoUSD;

    if (valorUSD > saldoPendienteUSD + 0.01) {
        return showModalMessage(`El abono (USD ${valorUSD.toFixed(2)}) no puede superar el saldo pendiente de ${formatCurrency(saldoPendienteUSD, true)}.`);
    }

    const nuevoAbono = {
        fecha: fechaInput.value, valorCOP, valorUSD, trmAbono: valorCOP / valorUSD,
        formaPago: formaPagoSelect.value, timestamp: Date.now(), registradoPor: currentUser.uid
    };

    const nuevoGasto = {
        fecha: nuevoAbono.fecha, proveedorId: importacionId, 
        proveedorNombre: `Imp. N° ${importacionActual.numeroImportacion} (Abono China)`,
        numeroFactura: `Ref: BL ${importacionActual.numeroBl || 'N/A'}`,
        valorTotal: valorCOP, fuentePago: nuevoAbono.formaPago,
        registradoPor: currentUser.uid, timestamp: Date.now(), isImportacionAbono: true, importacionId: importacionId,
        _lastUpdated: serverTimestamp()
    };

    showModalMessage("Registrando abono y gasto...", true);
    try {
        const batch = writeBatch(db);
        batch.update(doc(db, "importaciones", importacionId), { abonos: arrayUnion(nuevoAbono), lastUpdated: serverTimestamp() });
        batch.set(doc(collection(db, "gastos")), nuevoGasto);
        await batch.commit();

        const updatedAbonos = [...(importacionActual.abonos || []), nuevoAbono];
        const updatedImp = { ...importacionActual, abonos: updatedAbonos, lastUpdated: Date.now() };
        updateImportacionCache(updatedImp);

        hideModal();
        showTemporaryMessage("Abono y gasto registrados.", "success");
        showImportacionModal(updatedImp);

    } catch (error) {
        console.error("Error al registrar abono de China:", error);
        showModalMessage("Error al guardar el abono: " + error.message);
    }
}

async function handleGastoNacionalizacionAbonoSubmit(importacionId, gastoTipo, facturaId) {
    const facturaCard = document.querySelector(`.factura-card[data-factura-id="${facturaId}"]`);
    if (!facturaCard) return;

    const valorInput = facturaCard.querySelector('.abono-valor-input');
    const formaPagoInput = facturaCard.querySelector('.abono-forma-pago-input');
    const valorAbono = unformatCurrency(valorInput.value);

    if (isNaN(valorAbono) || valorAbono <= 0) return showModalMessage("El valor del abono debe ser un número mayor a cero.");

    showModalMessage("Registrando abono...", true);
    try {
        const importacionRef = doc(db, "importaciones", importacionId);
        let updatedImportacion;
        
        await runTransaction(db, async (transaction) => {
            const importacionDoc = await transaction.get(importacionRef);
            if (!importacionDoc.exists()) throw new Error("La importación no fue encontrada.");

            const importacionActual = importacionDoc.data();
            const gastosNacionalizacion = importacionActual.gastosNacionalizacion || {};
            const gastoActual = gastosNacionalizacion[gastoTipo];

            if (!gastoActual || !gastoActual.facturas) throw new Error("No se encontró el tipo de gasto correspondiente.");

            const facturaIndex = gastoActual.facturas.findIndex(f => f.id === facturaId);
            if (facturaIndex === -1) throw new Error("No se pudo encontrar la factura para añadir el abono.");

            const facturaActual = gastoActual.facturas[facturaIndex];
            const totalAbonado = (facturaActual.abonos || []).reduce((sum, abono) => sum + abono.valor, 0);
            const saldoPendiente = facturaActual.valorTotal - totalAbonado;

            if (valorAbono > saldoPendiente + 1) throw new Error(`El abono no puede superar el saldo pendiente de ${formatCurrency(saldoPendiente)}.`);

            const nuevoAbono = {
                valor: valorAbono, formaPago: formaPagoInput.value, fecha: new Date().toISOString().split('T')[0],
                registradoPor: currentUser.uid, timestamp: Date.now()
            };

            if (!facturaActual.abonos) facturaActual.abonos = [];
            facturaActual.abonos.push(nuevoAbono);
            gastosNacionalizacion[gastoTipo].facturas[facturaIndex] = facturaActual;
            
            transaction.update(importacionRef, { gastosNacionalizacion, lastUpdated: serverTimestamp() });
            
            updatedImportacion = { ...importacionActual, gastosNacionalizacion, lastUpdated: Date.now(), id: importacionId };
        });

        updateImportacionCache(updatedImportacion);
        showImportacionModal(updatedImportacion);
        showTemporaryMessage("Abono registrado con éxito.", "success");

    } catch (error) {
        console.error("Error al registrar abono:", error);
        showModalMessage(`Error: ${error.message}`);
    }
}

async function handleSaveFacturaGasto(importacionId, gastoTipo, facturaCard) {
    const facturaId = facturaCard.dataset.facturaId;
    const proveedorId = facturaCard.querySelector('.proveedor-id-hidden').value;
    const proveedorNombre = facturaCard.querySelector('.proveedor-search-input').value;
    const numeroFactura = facturaCard.querySelector('.factura-numero-input').value;
    const valorTotal = unformatCurrency(facturaCard.querySelector('.factura-valor-total-input').value);
    const pdfFile = facturaCard.querySelector('.factura-pdf-input')?.files[0];

    if (!proveedorId || !numeroFactura || !(valorTotal > 0)) {
        return showModalMessage("Debes seleccionar un proveedor, ingresar un N° de factura y un valor mayor a cero.");
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
        let updatedImportacion;

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
                (gasto.facturas || []).forEach(factura => { nuevoTotalNacionalizacionCOP += factura.valorTotal || 0; });
            });

            transaction.update(importacionRef, {
                gastosNacionalizacion, totalNacionalizacionCOP: nuevoTotalNacionalizacionCOP, lastUpdated: serverTimestamp()
            });

            updatedImportacion = { ...importacionActual, gastosNacionalizacion, totalNacionalizacionCOP: nuevoTotalNacionalizacionCOP, lastUpdated: Date.now(), id: importacionId };
        });

        updateImportacionCache(updatedImportacion);
        hideModal();
        showTemporaryMessage("Factura guardada.", "success");
        showImportacionModal(updatedImportacion);

    } catch (error) {
        console.error("Error al guardar la factura:", error);
        showModalMessage("Error al guardar: " + error.message);
    }
}

async function handleUpdateFacturaPdf(importacionId, gastoTipo, facturaId) {
    const facturaCard = document.querySelector(`.factura-card[data-factura-id="${facturaId}"]`);
    if (!facturaCard) return;

    const fileInput = facturaCard.querySelector(`#update-pdf-${facturaId}`);
    const file = fileInput.files[0];

    if (!file) return showModalMessage("Por favor, selecciona un archivo PDF para subir.", "error");

    showModalMessage("Subiendo PDF...", true);
    try {
        const storagePath = `importaciones/${importacionId}/gastos_nacionalizacion/${facturaId}_${file.name}`;
        const fileRef = ref(storage, storagePath);
        const snapshot = await uploadBytes(fileRef, file);
        const pdfUrl = await getDownloadURL(snapshot.ref);

        const importacionRef = doc(db, "importaciones", importacionId);
        let updatedImportacion;

        await runTransaction(db, async (transaction) => {
            const importacionDoc = await transaction.get(importacionRef);
            const importacionActual = importacionDoc.data();
            const gastosNacionalizacion = importacionActual.gastosNacionalizacion || {};
            const gasto = gastosNacionalizacion[gastoTipo];
            const facturaIndex = gasto.facturas.findIndex(f => f.id === facturaId);

            gastosNacionalizacion[gastoTipo].facturas[facturaIndex].pdfUrl = pdfUrl;
            transaction.update(importacionRef, { gastosNacionalizacion, lastUpdated: serverTimestamp() });
            updatedImportacion = { ...importacionActual, gastosNacionalizacion, lastUpdated: Date.now(), id: importacionId };
        });

        updateImportacionCache(updatedImportacion);
        hideModal();
        showTemporaryMessage("PDF de factura guardado.", "success");
        showImportacionModal(updatedImportacion);

    } catch (error) {
        console.error("Error al actualizar el PDF de la factura:", error);
        showModalMessage(`Error al guardar PDF: ${error.message}`);
    }
}

async function handleImportacionSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('importacion-form');
    if (!form) return;

    try {
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
        let dataFinal;

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

            dataFinal = {
                numeroImportacion, fechaPedido, naviera, numeroBl, fleteMaritimoUSD: fleteUSD, seguroUSD: seguroUSD,
                items: itemsData, totalChinaUSD, trmLiquidacion: trm,
                documentos: importacionActual?.documentos || {},
                estadoLogistico: importacionActual?.estadoLogistico || 'Creada',
                abonos: importacionActual?.abonos || [],
                gastosNacionalizacion: importacionActual?.gastosNacionalizacion || {},
                totalNacionalizacionCOP: importacionActual?.totalNacionalizacionCOP || 0,
                lastUpdated: serverTimestamp()
            };
            dataFinal.granTotalCOP = (dataFinal.totalChinaUSD * dataFinal.trmLiquidacion) + (dataFinal.totalNacionalizacionCOP || 0);

            transaction.set(importacionRef, dataFinal, { merge: true });
            dataFinal.id = importacionRef.id;
        });

        dataFinal.lastUpdated = Date.now();
        updateImportacionCache(dataFinal);

        hideModal();
        showTemporaryMessage("¡Importación guardada con éxito!", "success");

    } catch (error) {
        console.error("Error al guardar importación:", error);
        showModalMessage(`Error al guardar: ${error.message}`);
    }
}

// LÓGICA DE EVENTOS (Delegación)

function setupImportacionModalEventListeners(modalBody, importacion) {
    const importacionId = importacion ? importacion.id : null;

    modalBody.addEventListener('click', (event) => {
        const target = event.target;

        const abonoChinaBtn = target.closest('#add-abono-china-btn');
        if (abonoChinaBtn) {
            handleAbonoChinaSubmit(importacionId, abonoChinaBtn);
            return; 
        }

        if (target.closest('#set-en-puerto-btn')) handleEstadoUpdate(importacionId, 'En Puerto');
        else if (target.closest('#set-en-bodega-btn')) handleEstadoUpdate(importacionId, 'En Bodega');
        else if (target.id === 'add-importacion-item-btn') {
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
                        hideModal();
                    })
                    .catch((error) => {
                        console.error("Error al eliminar:", error);
                        showModalMessage(`Error: ${error.message}`);
                    });
            }
        }
        else if (target.closest('.save-factura-btn')) {
            const facturaCard = target.closest('.factura-card');
            if (importacionId) handleSaveFacturaGasto(importacionId, facturaCard.dataset.gastoTipo, facturaCard);
            else showModalMessage("Primero debes crear la importación para poder guardar facturas.");
        }
        else if (target.closest('.add-abono-gasto-btn')) {
            const btn = target.closest('.add-abono-gasto-btn');
            handleGastoNacionalizacionAbonoSubmit(importacionId, btn.dataset.gastoTipo, btn.dataset.facturaId);
        }
        else if (target.closest('.update-pdf-btn')) {
            const btn = target.closest('.update-pdf-btn');
            handleUpdateFacturaPdf(importacionId, btn.dataset.gastoTipo, btn.dataset.facturaId);
        }
    });

    modalBody.addEventListener('focusin', (e) => {
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

// SETUP PRINCIPAL DE INVENTARIO
export function setupInventarioEvents() {
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
            currentPageImp = 1;
            renderImportaciones();
        });
        nacionalTab.addEventListener('click', () => {
            nacionalTab.classList.add('active');
            importacionesTab.classList.remove('active');
            nacionalView.classList.remove('hidden');
            importacionesView.classList.add('hidden');
            currentPageNac = 1;
            renderComprasNacionales();
        });
    }

    const btnAddImportacion = document.getElementById('add-importacion-btn');
    if (btnAddImportacion) btnAddImportacion.addEventListener('click', () => showImportacionModal());

    const btnAddNacional = document.getElementById('add-nacional-btn');
    if (btnAddNacional) btnAddNacional.addEventListener('click', () => showNacionalModal());
}