// js/modules/facturacion.js

import { db, storage } from '../firebase-config.js';
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { allRemisiones, allClientes, showModalMessage, hideModal, showTemporaryMessage } from '../app.js';
import { formatCurrency } from '../utils.js';
import { showRetentionModal } from './remisiones.js'; 

// --- VARIABLES DE PAGINACIÓN ---
let currentPagePendientes = 1;
let currentPageRealizadas = 1;
const itemsPerPage = 20;

export function renderFacturacion() {
    const pendientesListEl = document.getElementById('facturacion-pendientes-list');
    const realizadasListEl = document.getElementById('facturacion-realizadas-list');
    const searchInput = document.getElementById('search-facturacion');
    const startDateInput = document.getElementById('factura-filter-start');
    const endDateInput = document.getElementById('factura-filter-end');

    if (!pendientesListEl || !realizadasListEl) return;

    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const startVal = startDateInput ? startDateInput.value : '';
    const endVal = endDateInput ? endDateInput.value : '';

    // 1. Aplicar Filtros Globales a TODA la lista
    let filtered = allRemisiones.filter(r => r.incluyeIVA && r.estado !== 'Anulada');

    if (startVal && endVal) {
        const startDate = new Date(startVal + '-01T00:00:00');
        const [endYear, endMonth] = endVal.split('-').map(Number);
        const endDate = new Date(endYear, endMonth, 0, 23, 59, 59);
        filtered = filtered.filter(r => {
            const rDate = new Date(r.fechaRecibido + 'T00:00:00');
            return rDate >= startDate && rDate <= endDate;
        });
    }

    if (searchTerm) {
        filtered = filtered.filter(r => 
            (r.clienteNombre && r.clienteNombre.toLowerCase().includes(searchTerm)) || 
            (r.numeroRemision && r.numeroRemision.toString().includes(searchTerm)) ||
            (r.numeroFactura && r.numeroFactura.toString().toLowerCase().includes(searchTerm))
        );
    }

    // 2. Separar en dos arreglos: Pendientes y Realizadas
    const allPendientes = filtered.filter(r => !r.facturado);
    const allRealizadas = filtered.filter(r => r.facturado === true);

    // ==========================================
    // RENDERIZAR PENDIENTES (Con Paginación)
    // ==========================================
    const totalPendientes = allPendientes.length;
    const totalPagesPendientes = Math.ceil(totalPendientes / itemsPerPage) || 1;
    if (currentPagePendientes > totalPagesPendientes) currentPagePendientes = totalPagesPendientes;
    if (currentPagePendientes < 1) currentPagePendientes = 1;
    
    const startPend = (currentPagePendientes - 1) * itemsPerPage;
    const paginatedPendientes = allPendientes.slice(startPend, startPend + itemsPerPage);

    pendientesListEl.innerHTML = '';
    if (totalPendientes === 0) {
        pendientesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No se encontraron remisiones pendientes.</p>';
    } else {
        paginatedPendientes.forEach(remision => {
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
                            rutPath = decodeURIComponent(urlString.substring(pathStartIndex + 3).split('?')[0]);
                        }
                    } catch (e) {}
                    if (rutPath) {
                        botonRUT = `<button data-file-path="${rutPath}" data-file-title="RUT de ${clienteDeRemision.nombre}" class="bg-purple-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-purple-600">RUT</button>`;
                    }
                }
                infoClienteExtra = `<p class="text-sm text-gray-500 mt-1">${clienteDeRemision.nit ? `NIT: ${clienteDeRemision.nit}` : ''}${clienteDeRemision.nit && clienteDeRemision.email ? ' &bull; ' : ''}${clienteDeRemision.email || ''}</p>`;
            }

            const remisionPdfButton = remision.pdfPath ? `<button data-file-path="${remision.pdfPath}" data-file-title="Remisión N° ${remision.numeroRemision}" class="bg-gray-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-600">Ver Remisión</button>` : `<button class="bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-semibold cursor-not-allowed">Generando...</button>`;
            
            let btnRetencion = '';
            if (!remision.retention || !remision.retention.amount) {
                btnRetencion = `<button data-remision-json='${JSON.stringify(remision)}' class="retention-btn bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-700">Retenciones</button>`;
            }

            el.innerHTML = `
                <div class="flex-grow">
                    <div class="flex items-center gap-3 flex-wrap">
                        <span class="remision-id">N° ${remision.numeroRemision}</span>
                        <p class="font-semibold text-lg">${remision.clienteNombre}</p>
                    </div>
                    ${infoClienteExtra}
                    <p class="text-sm text-gray-600 mt-1">Fecha: ${remision.fechaRecibido} &bull; Total: <span class="font-bold">${formatCurrency(remision.valorTotal)}</span></p>
                </div>
                <div class="flex-shrink-0 flex items-center gap-2 flex-wrap justify-end">
                    ${botonRUT}
                    ${remisionPdfButton}
                    ${btnRetencion}
                    <button data-remision-id="${remision.id}" class="facturar-btn bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700">Facturar</button>
                </div>`;
            pendientesListEl.appendChild(el);
        });

        // Controles de Paginación para Pendientes
        const pagPendEl = document.createElement('div');
        pagPendEl.className = 'flex justify-between items-center mt-4 pt-4 border-t border-gray-200';
        pagPendEl.innerHTML = `
            <span class="text-sm text-gray-600">Mostrando ${startPend + 1} - ${Math.min(startPend + itemsPerPage, totalPendientes)} de ${totalPendientes}</span>
            <div class="flex gap-2">
                <button id="prev-pend-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPagePendientes === 1 ? 'disabled' : ''}>Anterior</button>
                <span class="px-3 py-1 font-semibold text-gray-700">Pág ${currentPagePendientes} de ${totalPagesPendientes}</span>
                <button id="next-pend-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPagePendientes === totalPagesPendientes ? 'disabled' : ''}>Siguiente</button>
            </div>
        `;
        pendientesListEl.appendChild(pagPendEl);

        const prevPend = document.getElementById('prev-pend-btn');
        const nextPend = document.getElementById('next-pend-btn');
        if(prevPend && currentPagePendientes > 1) prevPend.addEventListener('click', () => { currentPagePendientes--; renderFacturacion(); });
        if(nextPend && currentPagePendientes < totalPagesPendientes) nextPend.addEventListener('click', () => { currentPagePendientes++; renderFacturacion(); });
    }

    // ==========================================
    // RENDERIZAR REALIZADAS (Con Paginación)
    // ==========================================
    const totalRealizadas = allRealizadas.length;
    const totalPagesRealizadas = Math.ceil(totalRealizadas / itemsPerPage) || 1;
    if (currentPageRealizadas > totalPagesRealizadas) currentPageRealizadas = totalPagesRealizadas;
    if (currentPageRealizadas < 1) currentPageRealizadas = 1;
    
    const startReal = (currentPageRealizadas - 1) * itemsPerPage;
    const paginatedRealizadas = allRealizadas.slice(startReal, startReal + itemsPerPage);

    realizadasListEl.innerHTML = '';
    if (totalRealizadas === 0) {
        realizadasListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No se encontraron facturas en este periodo.</p>';
    } else {
        paginatedRealizadas.forEach(remision => {
            const el = document.createElement('div');
            el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4';
            
            const clienteDeRemision = allClientes.find(c => c.id === remision.idCliente);
            let infoClienteExtra = '';
            if (clienteDeRemision) {
                infoClienteExtra = `<p class="text-sm text-gray-500 mt-1">${clienteDeRemision.nit ? `NIT: ${clienteDeRemision.nit}` : ''}${clienteDeRemision.nit && clienteDeRemision.email ? ' &bull; ' : ''}${clienteDeRemision.email || ''}</p>`;
            }

            const remisionPdfButton = remision.pdfPath ? `<button data-file-path="${remision.pdfPath}" data-file-title="Remisión N° ${remision.numeroRemision}" class="bg-gray-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-600">Ver Remisión</button>` : '';
            
            let facturaButtons = remision.facturaPdfPath
                ? `<button data-file-path="${remision.facturaPdfPath}" data-file-title="Factura N° ${remision.numeroFactura || remision.numeroRemision}" class="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700">Ver Factura</button>`
                : `<button data-remision-id="${remision.id}" class="facturar-btn bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-orange-600">Adjuntar Factura</button>`;

            let btnRetencion = '';
            if (!remision.retention || !remision.retention.amount) {
                 btnRetencion = `<button data-remision-json='${JSON.stringify(remision)}' class="retention-btn bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-700">Retenciones</button>`;
            }

            el.innerHTML = `
                <div class="flex-grow">
                    <div class="flex items-center gap-3 flex-wrap">
                        <span class="remision-id">N° ${remision.numeroRemision}</span>
                        <p class="font-semibold text-lg">${remision.clienteNombre}</p>
                    </div>
                    ${infoClienteExtra}
                    <p class="text-sm text-gray-600 mt-1">Fecha: ${remision.fechaRecibido} &bull; Total: <span class="font-bold">${formatCurrency(remision.valorTotal)}</span></p>
                </div>
                <div class="flex-shrink-0 flex items-center gap-2 flex-wrap justify-end">
                    <div class="text-right mr-2">
                        <span class="status-badge status-entregado">Facturado</span>
                        ${remision.numeroFactura ? `<p class="text-sm text-gray-600 mt-1">Factura N°: <span class="font-semibold">${remision.numeroFactura}</span></p>` : ''}
                    </div>
                    ${facturaButtons}
                    ${btnRetencion}
                    ${remisionPdfButton}
                </div>`;
            realizadasListEl.appendChild(el);
        });

        // Controles de Paginación para Realizadas
        const pagRealEl = document.createElement('div');
        pagRealEl.className = 'flex justify-between items-center mt-4 pt-4 border-t border-gray-200';
        pagRealEl.innerHTML = `
            <span class="text-sm text-gray-600">Mostrando ${startReal + 1} - ${Math.min(startReal + itemsPerPage, totalRealizadas)} de ${totalRealizadas}</span>
            <div class="flex gap-2">
                <button id="prev-real-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPageRealizadas === 1 ? 'disabled' : ''}>Anterior</button>
                <span class="px-3 py-1 font-semibold text-gray-700">Pág ${currentPageRealizadas} de ${totalPagesRealizadas}</span>
                <button id="next-real-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPageRealizadas === totalPagesRealizadas ? 'disabled' : ''}>Siguiente</button>
            </div>
        `;
        realizadasListEl.appendChild(pagRealEl);

        const prevReal = document.getElementById('prev-real-btn');
        const nextReal = document.getElementById('next-real-btn');
        if(prevReal && currentPageRealizadas > 1) prevReal.addEventListener('click', () => { currentPageRealizadas--; renderFacturacion(); });
        if(nextReal && currentPageRealizadas < totalPagesRealizadas) nextReal.addEventListener('click', () => { currentPageRealizadas++; renderFacturacion(); });
    }

    // Reasignar Eventos de los Botones
    document.querySelectorAll('.facturar-btn').forEach(btn => btn.addEventListener('click', (e) => showFacturaModal(e.currentTarget.dataset.remisionId)));
    document.querySelectorAll('.retention-btn').forEach(btn => 
        btn.addEventListener('click', (e) => { showRetentionModal(JSON.parse(e.currentTarget.dataset.remisionJson)); })
    );
}

export function showFacturaModal(remisionId) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-md w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Registrar Factura</h2><button id="close-factura-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button></div>
            <form id="factura-form" class="space-y-4">
                <div><label class="block text-sm font-medium">Número de Factura</label><input type="text" id="factura-numero" class="w-full p-2 border rounded-lg mt-1" required></div>
                <div><label class="block text-sm font-medium">Adjuntar PDF de la Factura</label><input type="file" id="factura-pdf" class="w-full p-2 border rounded-lg mt-1" accept=".pdf" required></div>
                <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Marcar como Facturado</button>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-factura-modal').addEventListener('click', hideModal);

    document.getElementById('factura-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const numeroFactura = document.getElementById('factura-numero').value;
        const file = document.getElementById('factura-pdf').files[0];
        if (!file) return showModalMessage("Debes seleccionar un archivo PDF.");

        const submitBtn = e.target.querySelector('button[type="submit"]');
        if(submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Procesando...'; }

        showModalMessage("Subiendo factura y actualizando...", true);
        try {
            const storagePath = `facturas/${remisionId}-${file.name}`;
            await uploadBytes(ref(storage, storagePath), file);
            await updateDoc(doc(db, "remisiones", remisionId), { 
                facturado: true, 
                numeroFactura: numeroFactura, 
                facturaPdfPath: storagePath, 
                fechaFacturado: new Date().toISOString() 
            });
            hideModal(); 
            if(window.Swal) Swal.fire('¡Éxito!', 'Remisión facturada con éxito.', 'success');
            else showTemporaryMessage("¡Remisión facturada con éxito!", "success");
        } catch (error) { 
            console.error(error);
            showModalMessage("Error al procesar la factura."); 
        } finally {
            if(submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Marcar como Facturado'; }
        }
    });
}

export function setupFacturacionEvents() {
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

    const searchFactura = document.getElementById('search-facturacion');
    const filterFactStart = document.getElementById('factura-filter-start');
    const filterFactEnd = document.getElementById('factura-filter-end');

    if (filterFactStart && filterFactEnd && searchFactura) {
        const now = new Date();
        const currentMonthStr = now.toISOString().slice(0, 7); 
        filterFactStart.value = currentMonthStr;
        filterFactEnd.value = currentMonthStr;

        // Resetear páginas cuando cambian los filtros
        const resetAndRender = () => {
            currentPagePendientes = 1;
            currentPageRealizadas = 1;
            renderFacturacion();
        };

        // Buscador con Debounce
        let debounceTimer;
        searchFactura.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(resetAndRender, 300);
        });

        filterFactStart.addEventListener('change', resetAndRender);
        filterFactEnd.addEventListener('change', resetAndRender);
    }
}