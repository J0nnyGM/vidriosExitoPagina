// js/modules/gastos.js

import { db, functions } from '../firebase-config.js';
import { collection, addDoc, query, getDocs, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
import { 
    allGastos, setAllGastos, currentUser, 
    showModalMessage, hideModal, showTemporaryMessage,
    populateDateFilters, initSearchableInput, allProveedores // <--- Asegúrate de tener estos dos al final
} from '../app.js';
import { formatCurrency, unformatCurrency } from '../utils.js';

// --- CONFIGURACIÓN DE CACHÉ Y PAGINACIÓN ---
const CACHE_KEY = 'gastos_cache';
const SYNC_KEY = 'gastos_last_sync';

// Variables de Paginación
let currentPage = 1;
const itemsPerPage = 20;

export async function loadGastos() {
    // 1. Intentar cargar desde el caché local primero
    const cachedData = localStorage.getItem(CACHE_KEY);
    const lastSyncStr = localStorage.getItem(SYNC_KEY);
    
    let lastSync = null;
    let mapGastos = new Map();

    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            parsedData.forEach(g => mapGastos.set(g.id, g));
            
            setAllGastos(Array.from(mapGastos.values()));
            renderGastos();
        } catch (e) {
            console.warn("Caché de gastos corrupto. Se limpiará.", e);
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(SYNC_KEY);
        }
    }

    if (lastSyncStr) lastSync = new Date(parseInt(lastSyncStr));

    // 2. Sincronización Diferencial con Firebase
    try {
        const colRef = collection(db, "gastos");
        let q;

        if (lastSync) {
            const syncTime = new Date(lastSync.getTime() - 60000); // 1 minuto de margen
            q = query(colRef, where("_lastUpdated", ">=", syncTime));
        } else {
            q = query(colRef);
        }

        const snapshot = await getDocs(q);
        let huboCambios = false;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data._lastUpdated && typeof data._lastUpdated.toMillis === 'function') data._lastUpdated = data._lastUpdated.toMillis();
            if (data.timestamp && typeof data.timestamp.toMillis === 'function') data.timestamp = data.timestamp.toMillis();
            
            mapGastos.set(doc.id, { id: doc.id, ...data });
            huboCambios = true;
        });

        // 3. Guardar en caché si hubo cambios
        if (huboCambios || !lastSync) {
            const finalArray = Array.from(mapGastos.values());
            // Ordenar por fecha de forma descendente (los más recientes primero)
            finalArray.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

            localStorage.setItem(CACHE_KEY, JSON.stringify(finalArray));
            localStorage.setItem(SYNC_KEY, Date.now().toString());

            setAllGastos(finalArray);
            renderGastos();
            console.log(`[Caché] Gastos sincronizados. ${snapshot.size} lecturas de Firebase.`);
        }

    } catch (error) {
        console.error("Error sincronizando gastos:", error);
    }
}

// Función auxiliar para actualizar el caché localmente
function updateLocalCache(newOrUpdatedGasto) {
    const cachedData = localStorage.getItem(CACHE_KEY);
    let gastos = cachedData ? JSON.parse(cachedData) : [];
    
    const index = gastos.findIndex(g => g.id === newOrUpdatedGasto.id);
    if (index !== -1) gastos[index] = newOrUpdatedGasto;
    else gastos.push(newOrUpdatedGasto);
    
    gastos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    
    localStorage.setItem(CACHE_KEY, JSON.stringify(gastos));
    setAllGastos(gastos);
    renderGastos();
}

// --- RENDERIZADO CON PAGINACIÓN Y FILTROS ---
export function renderGastos() {
    const gastosListEl = document.getElementById('gastos-list');
    if (!gastosListEl) return;

    const month = document.getElementById('filter-gastos-month').value;
    const year = document.getElementById('filter-gastos-year').value;
    const searchInput = document.getElementById('search-gastos');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

    // 1. Aplicar todos los filtros
    let filtered = allGastos;

    if (year !== 'all') {
        filtered = filtered.filter(g => new Date(g.fecha).getFullYear() == year);
    }
    if (month !== 'all') {
        filtered = filtered.filter(g => new Date(g.fecha).getMonth() == month);
    }
    if (searchTerm) {
        filtered = filtered.filter(g => 
            (g.proveedorNombre && g.proveedorNombre.toLowerCase().includes(searchTerm)) || 
            (g.numeroFactura && g.numeroFactura.toLowerCase().includes(searchTerm))
        );
    }

    // 2. Lógica de Paginación
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedGastos = filtered.slice(startIndex, endIndex);

    gastosListEl.innerHTML = '';
    if (totalItems === 0) {
        gastosListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay gastos registrados en este periodo.</p>';
        return;
    }

    // 3. Dibujar Tarjetas
    paginatedGastos.forEach((gasto) => {
        const el = document.createElement('div');
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

    // 4. Dibujar Controles de Paginación
    const paginationEl = document.createElement('div');
    paginationEl.className = 'flex justify-between items-center mt-4 pt-4 border-t border-gray-200';
    paginationEl.innerHTML = `
        <span class="text-sm text-gray-600">Mostrando ${startIndex + 1} - ${Math.min(endIndex, totalItems)} de ${totalItems}</span>
        <div class="flex gap-2">
            <button id="prev-page-gastos-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPage === 1 ? 'disabled' : ''}>Anterior</button>
            <span class="px-3 py-1 font-semibold text-gray-700">Pág ${currentPage} de ${totalPages}</span>
            <button id="next-page-gastos-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente</button>
        </div>
    `;
    gastosListEl.appendChild(paginationEl);

    // Eventos de Paginación
    const prevBtn = document.getElementById('prev-page-gastos-btn');
    const nextBtn = document.getElementById('next-page-gastos-btn');
    
    if (prevBtn && currentPage > 1) {
        prevBtn.addEventListener('click', () => { currentPage--; renderGastos(); });
    }
    if (nextBtn && currentPage < totalPages) {
        nextBtn.addEventListener('click', () => { currentPage++; renderGastos(); });
    }
}

// --- EXPORTACIÓN A EXCEL ---
function showExportGastosModal() {
    const modal = document.getElementById('export-gastos-modal');
    if (modal) {
        const endDateInput = document.getElementById('export-end-date');
        if (endDateInput) endDateInput.valueAsDate = new Date();
        modal.classList.remove('hidden');
    }
}

async function handleExportGastos(e) {
    e.preventDefault();
    const startDate = document.getElementById('export-start-date').value;
    const endDate = document.getElementById('export-end-date').value;

    if (!startDate || !endDate) return showModalMessage("Por favor, selecciona ambas fechas.");

    showModalMessage("Generando reporte de gastos, por favor espera...", true);

    try {
        const exportFunction = httpsCallable(functions, 'exportGastosToExcel');
        const result = await exportFunction({ startDate, endDate });

        if (result.data.success) {
            const byteCharacters = atob(result.data.fileContent);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
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

export function setupGastosEvents() {
    populateDateFilters('filter-gastos');

    // Manejo de filtros con reseteo de página a la 1
    const resetAndRender = () => {
        currentPage = 1;
        renderGastos();
    };

    const filterGastosMonth = document.getElementById('filter-gastos-month');
    const filterGastosYear = document.getElementById('filter-gastos-year');
    if (filterGastosMonth) filterGastosMonth.addEventListener('change', resetAndRender);
    if (filterGastosYear) filterGastosYear.addEventListener('change', resetAndRender);

    // Buscador con Debounce
    const searchGastos = document.getElementById('search-gastos');
    let debounceTimer;
    if (searchGastos) {
        searchGastos.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(resetAndRender, 300);
        });
    }

    // --- INICIO: RESTAURACIÓN DEL BUSCADOR DE PROVEEDORES ---
    const proveedorSearchInput = document.getElementById('proveedor-search-input');
    const proveedorSearchResults = document.getElementById('proveedor-search-results');
    if (proveedorSearchInput && proveedorSearchResults) {
        initSearchableInput(
            proveedorSearchInput,
            proveedorSearchResults,
            () => allProveedores,
            (proveedor) => proveedor.nombre,
            (selectedItem) => {
                document.getElementById('proveedor-id-hidden').value = selectedItem ? selectedItem.id : '';
            }
        );
    }
    // --- FIN: RESTAURACIÓN DEL BUSCADOR DE PROVEEDORES ---

    document.body.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'export-gastos-btn') showExportGastosModal();
    });

    document.body.addEventListener('submit', async (e) => {
        // --- 1. NUEVO GASTO ---
        if (e.target && e.target.id === 'add-gasto-form') {
            e.preventDefault();
            const valorTotal = unformatCurrency(document.getElementById('gasto-valor-total').value);
            const ivaIncluido = document.getElementById('gasto-iva').checked;
            const valorBase = ivaIncluido ? valorTotal / 1.19 : valorTotal;
            const proveedorId = document.getElementById('proveedor-id-hidden').value;
            const proveedorNombre = document.getElementById('proveedor-search-input').value;

            if (!proveedorId) return showModalMessage("Por favor, selecciona un proveedor de la lista.");

            const submitBtn = e.target.querySelector('button[type="submit"]');
            if(submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Registrando...'; }

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
                timestamp: Date.now(),
                _lastUpdated: serverTimestamp() 
            };
            
            try {
                const docRef = await addDoc(collection(db, "gastos"), nuevoGasto);
                
                // Actualizar Caché Local de forma instantánea
                nuevoGasto.id = docRef.id;
                nuevoGasto._lastUpdated = Date.now();
                updateLocalCache(nuevoGasto);

                e.target.reset();
                if(window.Swal) Swal.fire('¡Éxito!', 'Gasto registrado correctamente.', 'success');
                else showTemporaryMessage('Gasto registrado', 'success');

                currentPage = 1;
                renderGastos();

            } catch (error) {
                console.error("Error al registrar gasto:", error);
                showModalMessage("Error al registrar el gasto.");
            } finally {
                if(submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Registrar'; }
            }
        }

        // --- 2. EXPORTAR GASTOS ---
        if (e.target && e.target.id === 'export-gastos-form') {
            handleExportGastos(e);
        }
    });
}