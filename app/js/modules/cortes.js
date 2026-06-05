// js/cortes.js
import { collection, query, orderBy, onSnapshot, where, getDocs, collectionGroup, doc, getDoc, addDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Dependencias inyectadas
let db, formatCurrency, getCurrentProject, showView, openConfirmModal, calculateItemTotal, calculateProjectContractedValue, getUsersMap;

// Variables de estado del módulo
let unsubscribeCortes = null;
let currentCorteType = 'nosotros'; // 'nosotros' o 'obra'
export let currentCorte = null;

/**
 * Inicializa el módulo inyectando dependencias.
 */
export function initCortes(firestoreDb, deps) {
    db = firestoreDb;
    formatCurrency = deps.formatCurrency;
    getCurrentProject = deps.getCurrentProject;
    showView = deps.showView;
    openConfirmModal = deps.openConfirmModal;
    calculateItemTotal = deps.calculateItemTotal;
    calculateProjectContractedValue = deps.calculateProjectContractedValue;
    getUsersMap = deps.getUsersMap;
}

export function loadCortes(project) {
    const container = document.getElementById('cortes-list-container');
    if (!container) return;

    const q = query(collection(db, "projects", project.id, "cortes"), orderBy("createdAt", "desc"));
    if (unsubscribeCortes) unsubscribeCortes();

    unsubscribeCortes = onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        if (snapshot.empty) {
            container.innerHTML = '<p class="text-gray-500 text-center py-4">No se han creado cortes para este proyecto.</p>';
            return;
        }

        snapshot.forEach(doc => {
            const corte = { id: doc.id, ...doc.data() };
            const corteCard = document.createElement('div');
            corteCard.className = 'bg-white p-4 rounded-lg shadow-md border';

            let statusColor, statusText;
            switch (corte.status) {
                case 'aprobado': statusColor = 'bg-green-100 text-green-800'; statusText = 'Aprobado'; break;
                default: statusColor = 'bg-yellow-100 text-yellow-800'; statusText = 'Preliminar'; break;
            }

            corteCard.innerHTML = `
                <div class="flex flex-col sm:flex-row justify-between">
                    <div>
                        <p class="font-bold text-lg text-gray-800">Corte #${corte.corteNumber || 'N/A'} ${corte.isFinal ? '<span class="text-xs text-red-600 font-semibold">(FINAL)</span>' : ''}</p>
                        <p class="text-sm text-gray-600">Creado el: ${corte.createdAt && corte.createdAt.toDate ? corte.createdAt.toDate().toLocaleDateString('es-CO') : 'Fecha desconocida'}</p>
                        <span class="mt-2 inline-block text-sm font-semibold px-3 py-1 rounded-full ${statusColor}">${statusText}</span>
                    </div>
                    <div class="bg-gray-50 p-3 rounded-lg flex justify-between items-center mt-3 sm:mt-0 sm:flex-col sm:items-end sm:justify-center">
                        <span class="text-base font-bold text-gray-800">Neto a Pagar:</span>
                        <span class="text-2xl font-bold text-green-600">${formatCurrency(corte.netoAPagar || 0)}</span>
                    </div>
                </div>

                <div class="flex flex-col sm:flex-row sm:flex-wrap gap-2 justify-end mt-4 pt-3 border-t">
                    <button data-action="view-corte-details" data-corte-id="${corte.id}" class="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Ver Detalles</button>
                    ${corte.status === 'preliminar' ? `
                        ${project.pricingModel === 'separado' ? `
                            <button data-action="export-corte-pdf" data-corte-id="${corte.id}" data-type="suministro" class="bg-gray-500 hover:bg-gray-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Previsualizar Suministro</button>
                            <button data-action="export-corte-pdf" data-corte-id="${corte.id}" data-type="instalacion" class="bg-gray-500 hover:bg-gray-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Previsualizar Instalación</button>
                        ` : `
                            <button data-action="export-corte-pdf" data-corte-id="${corte.id}" data-type="completo" class="bg-gray-500 hover:bg-gray-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Previsualizar</button>
                        `}
                        <button data-action="approve-corte" data-corte-id="${corte.id}" class="bg-green-500 hover:bg-green-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Aprobar</button>
                        <button data-action="deny-corte" data-corte-id="${corte.id}" class="bg-red-500 hover:bg-red-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Denegar</button>
                    ` : ''}
                    ${corte.status === 'aprobado' ?
                    (project.pricingModel === 'separado' ? `
                            <button data-action="export-corte-pdf" data-corte-id="${corte.id}" data-type="suministro" class="bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Memoria Suministro</button>
                            <button data-action="export-corte-pdf" data-corte-id="${corte.id}" data-type="instalacion" class="bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Memoria Instalación</button>
                        ` : `
                            <button data-action="export-corte-pdf" data-corte-id="${corte.id}" data-type="completo" class="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-2 px-3 rounded w-full sm:w-auto">Exportar Memoria</button>
                        `)
                    : ''}
                </div>
            `;
            container.appendChild(corteCard);
        });
    });
}

export async function setupCorteSelection(type) {
    currentCorteType = type;
    const currentProject = getCurrentProject();
    const selectionView = document.getElementById('corte-items-selection-view');
    const description = document.getElementById('corte-selection-description');
    const accordionContainer = document.getElementById('corte-items-accordion');

    if (selectionView) selectionView.classList.remove('hidden');
    if (accordionContainer) accordionContainer.innerHTML = '<div class="text-center py-10"><div class="loader mx-auto"></div><p class="text-gray-500 mt-2">Analizando ítems...</p></div>';

    const validStates = type === 'nosotros' ? ['Instalado', 'Suministrado'] : ['Instalado'];

    if (description) {
        description.textContent = type === 'nosotros'
            ? "Selecciona los sub-ítems suministrados o instalados para incluir en el corte."
            : "Selecciona los sub-ítems que la obra va a pagar en este corte.";
    }

    try {
        const subItemsQuery = query(
            collectionGroup(db, "subItems"),
            where("projectId", "==", currentProject.id),
            where("status", "in", validStates)
        );

        const subItemsSnapshot = await getDocs(subItemsQuery);
        const allValidSubItems = subItemsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        const cortesQuery = query(collection(db, "projects", currentProject.id, "cortes"), where("status", "in", ["aprobado", "preliminar"]));
        const cortesSnapshot = await getDocs(cortesQuery);
        const subItemsInCortes = new Set();
        cortesSnapshot.forEach(corteDoc => {
            const data = corteDoc.data();
            if (data.subItemIds) {
                data.subItemIds.forEach(id => subItemsInCortes.add(id));
            }
        });

        const availableSubItems = allValidSubItems.filter(subItem => !subItemsInCortes.has(subItem.id));

        if (availableSubItems.length === 0) {
            accordionContainer.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <i class="fa-solid fa-clipboard-check text-3xl mb-2 text-gray-300"></i>
                    <p>No hay nuevos sub-ítems disponibles para cortar.</p>
                </div>`;
            return;
        }

        const groupedByItem = new Map();
        availableSubItems.forEach(si => {
            if (!groupedByItem.has(si.itemId)) groupedByItem.set(si.itemId, []);
            groupedByItem.get(si.itemId).push(si);
        });

        const allItemsSnap = await getDocs(collection(db, "projects", currentProject.id, "items"));
        const itemsMap = new Map(allItemsSnap.docs.map(d => [d.id, d.data()]));

        accordionContainer.innerHTML = '';

        groupedByItem.forEach((subItems, itemId) => {
            const item = itemsMap.get(itemId);
            if (!item) return;

            subItems.sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0));

            const accordionItem = document.createElement('div');
            accordionItem.className = 'border border-gray-200 rounded-lg mb-2 overflow-hidden';
            accordionItem.innerHTML = `
                <div class="accordion-header flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors">
                    <label class="flex items-center space-x-3 font-semibold text-gray-700 cursor-pointer select-none">
                        <input type="checkbox" class="corte-item-select-all w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500">
                        <span>${item.name} <span class="text-xs font-normal text-gray-500 ml-1">(${subItems.length} unds disponibles)</span></span>
                    </label>
                    <svg class="h-5 w-5 text-gray-400 transition-transform transform" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                </div>
                <div class="accordion-content hidden bg-white divide-y divide-gray-100">
                    ${subItems.map(si => `
                        <label class="flex items-center justify-between p-3 hover:bg-gray-50 cursor-pointer">
                            <div class="flex items-center space-x-3">
                                <input type="checkbox" class="corte-subitem-checkbox w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500" data-subitem-id="${si.id}" data-item-id="${si.itemId}">
                                <span class="text-sm text-gray-700">Unidad <strong>#${si.number}</strong></span>
                            </div>
                            <div class="text-right">
                                <span class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded block mb-1">${si.location || 'Sin ubicación'}</span>
                                ${si.realWidth && si.realHeight ? `<span class="text-[10px] text-purple-600 bg-purple-50 px-1 rounded border border-purple-100">Real: ${si.realWidth}x${si.realHeight}</span>` : ''}
                            </div>
                        </label>
                    `).join('')}
                </div>
            `;
            accordionContainer.appendChild(accordionItem);

            const header = accordionItem.querySelector('.accordion-header');
            const content = accordionItem.querySelector('.accordion-content');
            const icon = accordionItem.querySelector('svg');

            header.addEventListener('click', (e) => {
                if (e.target.type !== 'checkbox') {
                    content.classList.toggle('hidden');
                    icon.classList.toggle('rotate-180');
                }
            });

            const selectAll = accordionItem.querySelector('.corte-item-select-all');
            const checkboxes = accordionItem.querySelectorAll('.corte-subitem-checkbox');

            selectAll.addEventListener('change', () => {
                checkboxes.forEach(cb => cb.checked = selectAll.checked);
            });

            checkboxes.forEach(cb => {
                cb.addEventListener('change', () => {
                    const allChecked = Array.from(checkboxes).every(c => c.checked);
                    selectAll.checked = allChecked;
                });
            });
        });

    } catch (error) {
        console.error("Error al preparar la selección de corte:", error);
        accordionContainer.innerHTML = `<p class="text-red-500 text-center py-4">Error cargando sub-ítems.</p>`;
    }
}

export async function generateCorte() {
    const currentProject = getCurrentProject();
    const selectedSubItemsCheckboxes = document.querySelectorAll('.corte-subitem-checkbox:checked');
    if (selectedSubItemsCheckboxes.length === 0) {
        alert("Por favor, selecciona al menos un sub-ítem para generar el corte.");
        return;
    }

    const usarMedidaReal = document.getElementById('corte-usar-medida-real').checked;
    const amortizarAnticipo = document.getElementById('corte-amortizar-anticipo').checked;
    const esCorteFinal = document.getElementById('corte-es-final').checked;
    const agregarOtrosDescuentos = document.getElementById('corte-add-other-discounts-checkbox').checked;

    openConfirmModal(`Se creará un nuevo corte preliminar con ${selectedSubItemsCheckboxes.length} sub-ítems. ¿Deseas continuar?`, async () => {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.classList.remove('hidden');

        try {
            const subItemIds = Array.from(selectedSubItemsCheckboxes).map(cb => cb.dataset.subitemId);
            const allItemsQuery = query(collection(db, "projects", currentProject.id, "items"));
            const allSubItemsQuery = query(collectionGroup(db, "subItems"), where("projectId", "==", currentProject.id));
            const [itemsSnapshot, subItemsSnapshot] = await Promise.all([getDocs(allItemsQuery), getDocs(allSubItemsQuery)]);

            const itemsMap = new Map(itemsSnapshot.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
            const subItemsMap = new Map(subItemsSnapshot.docs.map(d => [d.id, { id: d.id, ...d.data() }]));

            let valorBrutoCorte = 0;

            for (const subItemId of subItemIds) {
                const subItem = subItemsMap.get(subItemId);
                if (!subItem) continue;
                const parentItem = itemsMap.get(subItem.itemId);

                if (parentItem) {
                    const totalItemValue = calculateItemTotal(parentItem);
                    const valorUnitarioFull = totalItemValue / (parentItem.quantity || 1); 
                    let valorSubItemParaCorte = valorUnitarioFull;

                    if (usarMedidaReal && subItem.realWidth > 0 && subItem.realHeight > 0) {
                        const areaContratada = (parentItem.width || 0) * (parentItem.height || 0);
                        const areaReal = (subItem.realWidth || 0) * (subItem.realHeight || 0);
                        if (areaContratada > 0) {
                            valorSubItemParaCorte = (valorUnitarioFull / areaContratada) * areaReal;
                        }
                    }
                    valorBrutoCorte += valorSubItemParaCorte;
                }
            }

            let valorAmortizacion = 0;
            const anticipoTotal = parseFloat(currentProject.advance) || 0;

            if (amortizarAnticipo && anticipoTotal > 0) {
                const contractedValue = await calculateProjectContractedValue(currentProject.id);
                let factorAmortizacion = contractedValue > 0 ? (anticipoTotal / contractedValue) : 0;
                valorAmortizacion = valorBrutoCorte * factorAmortizacion;

                const cortesQuery = query(collection(db, "projects", currentProject.id, "cortes"), where("status", "==", "aprobado"));
                const cortesSnapshot = await getDocs(cortesQuery);
                let totalAmortizadoPrevio = 0;
                cortesSnapshot.forEach(doc => { totalAmortizadoPrevio += doc.data().amortizacion || 0; });

                const saldoAnticipoPendiente = anticipoTotal - totalAmortizadoPrevio;
                if (esCorteFinal) {
                    valorAmortizacion = Math.min(saldoAnticipoPendiente, valorBrutoCorte);
                } else if (valorAmortizacion > saldoAnticipoPendiente) {
                    valorAmortizacion = saldoAnticipoPendiente;
                }
            }

            let totalOtrosDescuentos = 0;
            const otrosDescuentos = [];
            if (agregarOtrosDescuentos) {
                document.querySelectorAll('#corte-descuentos-section .flex').forEach(div => {
                    const concept = div.querySelector('.discount-concept')?.value.trim();
                    const valueStr = div.querySelector('.discount-value')?.value.replace(/[$. ]/g, '') || '0';
                    const value = parseFloat(valueStr);
                    if (concept && value > 0) {
                        otrosDescuentos.push({ concept, value });
                        totalOtrosDescuentos += value;
                    }
                });
            }

            const valorNeto = valorBrutoCorte - valorAmortizacion - totalOtrosDescuentos;

            const cortesQueryTotal = query(collection(db, "projects", currentProject.id, "cortes"));
            const cortesSnapshotTotal = await getDocs(cortesQueryTotal);
            const newCorteNumber = cortesSnapshotTotal.size + 1;

            const newCorte = {
                corteNumber: newCorteNumber,
                createdAt: new Date(),
                subItemIds: subItemIds,
                totalValue: Math.round(valorBrutoCorte),
                amortizacion: Math.round(valorAmortizacion),
                otrosDescuentos: otrosDescuentos,
                netoAPagar: Math.round(valorNeto),
                isFinal: esCorteFinal,
                usadoMedidaReal: usarMedidaReal,
                projectId: currentProject.id,
                status: 'preliminar',
                type: currentCorteType
            };

            await addDoc(collection(db, "projects", currentProject.id, "cortes"), newCorte);

            alert(`¡Corte preliminar #${newCorteNumber} creado con éxito!`);
            closeCorteSelectionView();

        } catch (error) {
            console.error("Error al generar el corte:", error);
            alert("Ocurrió un error al generar el corte.");
        } finally {
            if (loadingOverlay) loadingOverlay.classList.add('hidden');
        }
    });
}

export function closeCorteSelectionView() {
    const selectionView = document.getElementById('corte-items-selection-view');
    if (selectionView) selectionView.classList.add('hidden');
    document.querySelectorAll('.corte-type-btn').forEach(btn => {
        btn.classList.remove('bg-blue-500', 'text-white');
        btn.classList.add('bg-gray-200', 'text-gray-700');
    });
}

export async function approveCorte(projectId, corteId) {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    try {
        const corteRef = doc(db, "projects", projectId, "cortes", corteId);
        const corteSnap = await getDoc(corteRef);

        if (!corteSnap.exists()) throw new Error("No se encontró el corte.");

        const corte = corteSnap.data();
        const montoAmortizar = corte.amortizacion || 0;

        if (montoAmortizar > 0) {
            await addDoc(collection(db, "projects", projectId, "payments"), {
                amount: montoAmortizar,
                date: new Date().toISOString().split('T')[0],
                type: 'amortizacion_anticipo',
                concept: `Amortización Corte #${corte.corteNumber}`,
                targetId: corteId,
            });
        }

        await updateDoc(corteRef, { status: 'aprobado' });
        alert("¡Corte aprobado con éxito!");
    } catch (error) {
        console.error("Error al aprobar:", error);
        alert("Error: " + error.message);
    } finally {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }
}

export async function denyCorte(projectId, corteId) {
    const corteRef = doc(db, "projects", projectId, "cortes", corteId);
    await deleteDoc(corteRef);
    alert("El corte ha sido denegado y eliminado.");
}

export async function showCorteDetails(corteData) {
    currentCorte = corteData;
    const currentProject = getCurrentProject();
    showView('corteDetails');

    const titleEl = document.getElementById('corte-details-title');
    const summaryEl = document.getElementById('corte-details-summary');
    const listContainer = document.getElementById('corte-details-list');

    const dateStr = corteData.createdAt ? new Date(corteData.createdAt.seconds * 1000).toLocaleDateString('es-CO') : 'N/A';
    
    const statusBadge = corteData.status === 'aprobado'
        ? '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-green-100 text-green-700 border border-green-200 shadow-sm"><i class="fa-solid fa-check-circle mr-1"></i> Aprobado</span>'
        : '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-amber-100 text-amber-700 border border-amber-200 shadow-sm"><i class="fa-solid fa-clock mr-1"></i> Preliminar</span>';

    const finalBadge = corteData.isFinal
        ? '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-red-100 text-red-700 border border-red-200 shadow-sm"><i class="fa-solid fa-flag-checkered mr-1"></i> Corte Final</span>'
        : '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-blue-50 text-blue-600 border border-blue-100 shadow-sm"><i class="fa-solid fa-arrows-rotate mr-1"></i> Corte Parcial</span>';

    const measureBadge = corteData.usadoMedidaReal
        ? '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-purple-100 text-purple-700 border border-purple-200 shadow-sm"><i class="fa-solid fa-ruler-combined mr-1"></i> Medidas Reales</span>'
        : '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-gray-100 text-gray-600 border border-gray-200 shadow-sm"><i class="fa-solid fa-file-contract mr-1"></i> Medidas Contrato</span>';

    const originBadge = corteData.type === 'obra'
        ? '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-orange-100 text-orange-700 border border-orange-200 shadow-sm"><i class="fa-solid fa-hard-hat mr-1"></i> Reporte de Obra</span>'
        : '<span class="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-sm"><i class="fa-solid fa-building-user mr-1"></i> Reporte Interno</span>';

    titleEl.innerHTML = `
        <div class="flex flex-col gap-3">
            <div class="flex items-center gap-3">
                <div class="p-3 bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-xl shadow-md">
                    <i class="fa-solid fa-file-invoice-dollar text-2xl"></i>
                </div>
                <div>
                    <span class="text-2xl font-black text-gray-900 tracking-tight">Corte de Obra #${corteData.corteNumber}</span>
                    <p class="text-xs text-gray-500 font-medium flex items-center gap-1 mt-0.5">
                        <i class="fa-regular fa-calendar"></i> Generado el: ${dateStr}
                    </p>
                </div>
            </div>
            <div class="flex flex-wrap gap-2 pl-1">
                ${statusBadge} ${finalBadge} ${measureBadge} ${originBadge}
            </div>
        </div>
    `;

    summaryEl.innerHTML = `
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6 mt-6">
            <div class="p-4 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="flex flex-col justify-center p-4 rounded-xl border border-gray-100 bg-gray-50/50">
                    <p class="text-xs text-gray-400 uppercase font-bold mb-1">Valor Bruto (Ejecutado)</p>
                    <p class="text-xl font-bold text-gray-800">${formatCurrency(corteData.totalValue || 0)}</p>
                </div>
                <div class="space-y-2 p-4 rounded-xl border border-red-100 bg-red-50/30">
                    <p class="text-xs text-red-800 uppercase font-bold mb-2 flex items-center"><i class="fa-solid fa-minus-circle mr-1"></i> Deducciones y Amortización</p>
                    <div class="flex justify-between text-sm text-red-700 border-b border-red-100/50 pb-1">
                        <span>Amortización Anticipo:</span>
                        <span class="font-medium">${formatCurrency(corteData.amortizacion || 0)}</span>
                    </div>
                    ${(corteData.otrosDescuentos || []).map(d => `
                        <div class="flex justify-between text-sm text-red-600">
                            <span class="truncate max-w-[150px]" title="${d.concept}">${d.concept}:</span>
                            <span class="font-medium">${formatCurrency(d.value)}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="flex flex-col justify-center p-4 rounded-xl border border-emerald-200 bg-emerald-50 relative overflow-hidden group">
                    <div class="absolute right-0 top-0 p-2 text-emerald-200 opacity-40 group-hover:opacity-60 transition-opacity transform group-hover:scale-110"><i class="fa-solid fa-money-bill-1-wave text-5xl"></i></div>
                    <p class="text-xs text-emerald-800 uppercase font-bold mb-1 relative z-10">Total Neto a Pagar</p>
                    <p class="text-3xl font-black text-emerald-700 relative z-10 tracking-tight">${formatCurrency(corteData.netoAPagar || 0)}</p>
                </div>
            </div>
        </div>
    `;

    listContainer.innerHTML = `<div class="loader-container py-10"><div class="loader"></div><p class="text-center text-gray-400 text-sm mt-2">Cargando detalle de ítems...</p></div>`;

    try {
        const [itemsSnapshot, subItemsSnapshot] = await Promise.all([
            getDocs(query(collection(db, "projects", currentProject.id, "items"))),
            getDocs(query(collectionGroup(db, "subItems"), where("projectId", "==", currentProject.id)))
        ]);
        const itemsMap = new Map(itemsSnapshot.docs.map(doc => [doc.id, doc.data()]));
        const subItemsMap = new Map(subItemsSnapshot.docs.map(doc => [doc.id, doc.data()]));
        const usersMap = getUsersMap(); // Usar el mapa inyectado

        listContainer.innerHTML = '';

        if (!corteData.subItemIds || corteData.subItemIds.length === 0) {
            listContainer.innerHTML = `
                <div class="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
                    <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                        <i class="fa-solid fa-box-open text-gray-300 text-3xl"></i>
                    </div>
                    <p class="text-gray-500 font-medium">Este corte no tiene ítems asociados.</p>
                </div>`;
            return;
        }

        const itemsGrid = document.createElement('div');
        itemsGrid.className = "grid grid-cols-1 lg:grid-cols-2 gap-4";
        listContainer.appendChild(itemsGrid);

        for (const subItemId of corteData.subItemIds) {
            const subItem = subItemsMap.get(subItemId);
            if (!subItem) continue;

            const parentItem = itemsMap.get(subItem.itemId);
            if (!parentItem) continue;

            const valorUnitarioContratado = calculateItemTotal(parentItem) / (parentItem.quantity || 1);
            let valorSubItemEnCorte = valorUnitarioContratado;

            if (corteData.usadoMedidaReal && subItem.realWidth > 0 && subItem.realHeight > 0) {
                const areaContratada = (parentItem.width || 0) * (parentItem.height || 0);
                const areaReal = (subItem.realWidth || 0) * (subItem.realHeight || 0);
                if (areaContratada > 0) {
                    valorSubItemEnCorte = (valorUnitarioContratado / areaContratada) * areaReal;
                }
            }

            let installerName = 'N/A';
            if (usersMap.has(subItem.installer)) {
                const installerData = usersMap.get(subItem.installer);
                installerName = `${installerData.firstName} ${installerData.lastName}`;
            }

            let statusText = subItem.status || 'Pendiente';
            let statusBadgeClass = 'bg-gray-100 text-gray-600 border-gray-200';
            if (statusText === 'Instalado') statusBadgeClass = 'bg-emerald-100 text-emerald-700 border-emerald-200';

            const itemCard = document.createElement('div');
            itemCard.className = 'bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col hover:shadow-md transition-shadow';

            itemCard.innerHTML = `
                <div class="px-4 py-3 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                    <div class="min-w-0 pr-2">
                        <p class="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-0.5 truncate" title="${parentItem.name}">
                            <i class="fa-solid fa-layer-group mr-1"></i> ${parentItem.name}
                        </p>
                        <p class="font-bold text-gray-800 text-sm">Unidad #${subItem.number}</p>
                    </div>
                    <span class="px-2 py-0.5 text-[10px] font-bold uppercase rounded border flex-shrink-0 ${statusBadgeClass}">${statusText}</span>
                </div>
                <div class="p-4 flex gap-4">
                    <div class="flex-grow space-y-2 text-sm">
                        <div class="flex justify-between items-center">
                            <span class="text-gray-500 text-xs"><i class="fa-solid fa-location-dot w-4 text-center mr-1"></i> Ubicación:</span>
                            <span class="font-medium text-gray-800 text-right truncate max-w-[140px]" title="${subItem.location}">${subItem.location || 'N/A'}</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-gray-500 text-xs"><i class="fa-solid fa-ruler-combined w-4 text-center mr-1"></i> Medidas:</span>
                            <span class="font-medium text-gray-800 text-right font-mono bg-gray-50 px-1.5 rounded border border-gray-100 text-xs">
                                ${(subItem.realWidth ? (subItem.realWidth * 100).toFixed(0) : '0')} x ${(subItem.realHeight ? (subItem.realHeight * 100).toFixed(0) : '0')} cm
                            </span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-gray-500 text-xs"><i class="fa-solid fa-user-gear w-4 text-center mr-1"></i> Instalador:</span>
                            <span class="font-medium text-gray-800 text-right truncate max-w-[140px]" title="${installerName}">${installerName}</span>
                        </div>
                        <div class="pt-2 mt-1 border-t border-dashed border-gray-100 flex justify-between items-end">
                            <span class="text-xs text-gray-400 font-medium">Valor en Corte</span>
                            <span class="text-base font-bold text-green-600 leading-none">${formatCurrency(valorSubItemEnCorte)}</span>
                        </div>
                    </div>
                    <div class="flex-shrink-0 w-20 h-20">
                        <div class="w-full h-full bg-gray-100 rounded-lg border border-gray-200 overflow-hidden relative group cursor-pointer shadow-inner">
                            ${subItem.photoURL ?
                    `<img src="${subItem.photoURL}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" data-action="view-image">
                                     <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
                                        <i class="fa-solid fa-magnifying-glass-plus text-white opacity-0 group-hover:opacity-100 drop-shadow-md"></i>
                                     </div>`
                    : `<div class="w-full h-full flex flex-col items-center justify-center text-gray-300">
                                             <i class="fa-regular fa-image text-xl"></i>
                                             <span class="text-[9px] mt-1">Sin Foto</span>
                                      </div>`
                }
                        </div>
                    </div>
                </div>
            `;
            itemsGrid.appendChild(itemCard);
        }
    } catch (error) {
        console.error("Error al cargar detalles del corte:", error);
        listContainer.innerHTML = `<p class="text-red-500 text-center py-4">Error al cargar detalles.</p>`;
    }
}

export async function exportCorteToPDF(proyecto, corte, exportType) {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    try {
        if (window.ensurePDF) {
            await window.ensurePDF();
        }
        const { jsPDF } = window.jspdf;
        const pdfDoc = new jsPDF({ orientation: 'landscape', format: 'letter' });

        const addTaxToTotal = (target, source) => {
            target.base += source.base; target.admin += source.admin;
            target.imprev += source.imprev; target.util += source.util;
            target.ivaUtil += source.ivaUtil; target.iva += source.iva;
            target.totalBruto += source.totalTax + source.base;
        };

        const calculateRowValues = (details, baseValue) => {
            const res = { base: baseValue, admin: 0, imprev: 0, util: 0, ivaUtil: 0, iva: 0, totalTax: 0 };
            if (!details || baseValue <= 0) return res;
            if (details.taxType === 'aiu') {
                res.admin = baseValue * ((details.aiuA || 0) / 100);
                res.imprev = baseValue * ((details.aiuI || 0) / 100);
                res.util = baseValue * ((details.aiuU || 0) / 100);
                res.ivaUtil = res.util * 0.19;
                res.totalTax = res.admin + res.imprev + res.util + res.ivaUtil;
            } else if (details.taxType === 'iva') {
                res.iva = baseValue * 0.19;
                res.totalTax = res.iva;
            }
            return res;
        };

        const [configSnap, itemsSnap, subItemsSnap, prevCortesSnap] = await Promise.all([
            getDoc(doc(db, "system", "generalConfig")),
            getDocs(query(collection(db, "projects", proyecto.id, "items"))),
            getDocs(query(collectionGroup(db, "subItems"), where("projectId", "==", proyecto.id))),
            getDocs(query(collection(db, "projects", proyecto.id, "cortes"), where("status", "==", "aprobado"), where("corteNumber", "<", corte.corteNumber)))
        ]);

        let empresaInfo = { nombre: "VIDRIOS Y ALUMINIOS EXITO", nit: "" };
        if (configSnap.exists() && configSnap.data().empresa) {
            empresaInfo.nombre = configSnap.data().empresa.nombre || empresaInfo.nombre;
            empresaInfo.nit = configSnap.data().empresa.nit || "";
        }

        const allItems = new Map(itemsSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
        const allSubItems = subItemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const subItemsPagadosAntesIds = new Set();
        let acumuladoAmortizacionAnterior = 0;
        let acumuladoDescuentosAnterior = 0;

        prevCortesSnap.forEach(c => {
            const d = c.data();
            if (d.subItemIds) d.subItemIds.forEach(id => subItemsPagadosAntesIds.add(id));
            acumuladoAmortizacionAnterior += (d.amortizacion || 0);
            if (d.otrosDescuentos) d.otrosDescuentos.forEach(desc => acumuladoDescuentosAnterior += (desc.value || 0));
        });

        const subItemsEsteCorteIds = new Set(corte.subItemIds || []);
        const body = [];

        const initTotalObj = () => ({ base: 0, admin: 0, imprev: 0, util: 0, ivaUtil: 0, iva: 0, totalBruto: 0 });
        const totals = { contrato: initTotalObj(), corte: initTotalObj(), acumulado: initTotalObj(), saldo: initTotalObj() };
        const totalsAntes = initTotalObj();

        allItems.forEach(item => {
            const misSubItems = allSubItems.filter(si => si.itemId === item.id);
            const cantEnEsteCorte = misSubItems.filter(si => subItemsEsteCorteIds.has(si.id));
            const cantAntes = misSubItems.filter(si => subItemsPagadosAntesIds.has(si.id)).length;
            const cantAhora = cantEnEsteCorte.length;
            const cantAcumulada = cantAntes + cantAhora;
            const saldoCant = item.quantity - cantAcumulada;

            if (cantAcumulada === 0 && saldoCant === 0) return;

            let details = exportType === 'suministro' ? item.supplyDetails : (exportType === 'instalacion' ? item.installationDetails : item.includedDetails);
            if (!details && proyecto.pricingModel === 'separado' && exportType === 'completo') {
                details = { unitPrice: (item.supplyDetails?.unitPrice || 0) + (item.installationDetails?.unitPrice || 0), taxType: 'mix' };
            }

            const baseUnitario = details ? details.unitPrice : 0;

            const valContratadoBase = baseUnitario * item.quantity;
            addTaxToTotal(totals.contrato, calculateRowValues(details, valContratadoBase));

            const valAntesBase = baseUnitario * cantAntes;
            addTaxToTotal(totalsAntes, calculateRowValues(details, valAntesBase));

            let valBaseCorteItem = 0;
            cantEnEsteCorte.forEach(subItem => {
                let baseRealSubItem = baseUnitario;
                if (corte.usadoMedidaReal && subItem.realWidth > 0 && subItem.realHeight > 0 && item.width * item.height > 0) {
                    baseRealSubItem = (baseUnitario / (item.width * item.height)) * (subItem.realWidth * subItem.realHeight);
                }
                valBaseCorteItem += baseRealSubItem;
            });
            addTaxToTotal(totals.corte, calculateRowValues(details, valBaseCorteItem));

            const valSaldoBase = baseUnitario * saldoCant;
            addTaxToTotal(totals.saldo, calculateRowValues(details, valSaldoBase));

            body.push([
                item.name, (item.description || item.name).substring(0, 200), item.quantity, formatCurrency(baseUnitario), formatCurrency(valContratadoBase),
                cantAhora, formatCurrency(valBaseCorteItem), cantAcumulada, formatCurrency(valAntesBase + valBaseCorteItem), saldoCant, formatCurrency(valSaldoBase)
            ]);
        });

        addTaxToTotal(totals.acumulado, totalsAntes);
        addTaxToTotal(totals.acumulado, totals.corte);

        const amortizacionActual = corte.amortizacion || 0;
        let descuentosActuales = 0;
        if (corte.otrosDescuentos) corte.otrosDescuentos.forEach(d => descuentosActuales += (d.value || 0));

        const totalAmortizacionAcumulada = acumuladoAmortizacionAnterior + amortizacionActual;
        const totalDescuentosAcumulados = acumuladoDescuentosAnterior + descuentosActuales;
        const anticipoTotal = parseFloat(proyecto.advance) || 0;
        const saldoPorAmortizar = anticipoTotal - totalAmortizacionAcumulada;

        const netoCorte = totals.corte.totalBruto - amortizacionActual - descuentosActuales;
        const netoAcumulado = totals.acumulado.totalBruto - totalAmortizacionAcumulada - totalDescuentosAcumulados;
        const netoSaldo = totals.saldo.totalBruto - saldoPorAmortizar;

        const pageWidth = pdfDoc.internal.pageSize.getWidth();
        const pageMargin = 14;

        let reportTitle = exportType === 'suministro' ? 'ACTA DE CORTE DE SUMINISTRO' : (exportType === 'instalacion' ? 'ACTA DE CORTE DE INSTALACIÓN' : 'ACTA DE CORTE DE OBRA');

        pdfDoc.setFontSize(14); pdfDoc.setFont("helvetica", "bold");
        pdfDoc.text(`${reportTitle} NO. ${corte.corteNumber}`, pageWidth / 2, 15, { align: 'center' });

        pdfDoc.setFontSize(10);
        pdfDoc.setFont("helvetica", "bold"); pdfDoc.text(`CONTRATISTA:`, pageMargin, 25);
        pdfDoc.setFont("helvetica", "normal"); pdfDoc.text(empresaInfo.nombre, pageMargin + 30, 25);

        pdfDoc.setFont("helvetica", "bold"); pdfDoc.text(`CONTRATANTE:`, pageMargin, 30);
        pdfDoc.setFont("helvetica", "normal"); pdfDoc.text(proyecto.clientName || proyecto.builderName || 'General', pageMargin + 30, 30);

        pdfDoc.setFont("helvetica", "bold"); pdfDoc.text(`PROYECTO:`, pageMargin, 35);
        pdfDoc.setFont("helvetica", "normal"); pdfDoc.text(proyecto.name, pageMargin + 30, 35);

        pdfDoc.setFont("helvetica", "bold"); pdfDoc.text(`FECHA:`, pageWidth - pageMargin - 30, 25);
        pdfDoc.setFont("helvetica", "normal"); pdfDoc.text(new Date().toLocaleDateString('es-CO'), pageWidth - pageMargin, 25, { align: 'right' });

        const mainHeadStyles = { fontStyle: 'bold', halign: 'center', valign: 'middle', textColor: 255, lineWidth: 0.1, lineColor: [200, 200, 200] };
        const subHeadStyles = { fontStyle: 'bold', halign: 'center', valign: 'middle', fillColor: [255, 255, 255], textColor: 0, lineWidth: 0.1, lineColor: [200, 200, 200] };
        const footStyles = { halign: 'center', fontStyle: 'bold', fillColor: [240, 240, 240], textColor: 0, lineWidth: 0.1, lineColor: [200, 200, 200] };

        pdfDoc.autoTable({
            startY: 45,
            head: [
                [
                    { content: 'DESCRIPCIÓN', colSpan: 2, styles: { ...mainHeadStyles, fillColor: [41, 128, 185] } },
                    { content: 'CONTRATO (BASE)', colSpan: 3, styles: { ...mainHeadStyles, fillColor: [52, 73, 94] } },
                    { content: 'ESTE CORTE (BASE)', colSpan: 2, styles: { ...mainHeadStyles, fillColor: [39, 174, 96] } },
                    { content: 'ACUMULADO (BASE)', colSpan: 2, styles: { ...mainHeadStyles, fillColor: [211, 84, 0] } },
                    { content: 'SALDO (BASE)', colSpan: 2, styles: { ...mainHeadStyles, fillColor: [192, 57, 43] } }
                ],
                ['Ítem', 'Detalle', 'Cant', 'Unitario', 'Total', 'Cant', 'Valor Total', 'Cant', 'Valor Total', 'Cant', 'Valor Total']
            ],
            body: body,
            foot: [[
                { content: 'SUBTOTAL (BASE):', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold', textColor: 0, fillColor: [240, 240, 240] } },
                { content: formatCurrency(totals.contrato.base), styles: footStyles },
                { content: '', styles: { fillColor: [240, 240, 240] } },
                { content: formatCurrency(totals.corte.base), styles: footStyles },
                { content: '', styles: { fillColor: [240, 240, 240] } },
                { content: formatCurrency(totals.acumulado.base), styles: footStyles },
                { content: '', styles: { fillColor: [240, 240, 240] } },
                { content: formatCurrency(totals.saldo.base), styles: footStyles }
            ]],
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 1.5, halign: 'center', valign: 'middle', lineWidth: 0.1, lineColor: [200, 200, 200], overflow: 'linebreak' },
            headStyles: subHeadStyles,
            columnStyles: { 1: { cellWidth: 50, halign: 'left' } },
            margin: { left: pageMargin, right: pageMargin }
        });

        const distinctColumnStyles = {};
        if (pdfDoc.lastAutoTable && pdfDoc.lastAutoTable.columns) {
            pdfDoc.lastAutoTable.columns.forEach((col, index) => { distinctColumnStyles[index] = { cellWidth: col.width }; });
        }

        const summaryBody = [];
        const noBorder = { lineWidth: 0 };
        const valStyle = { halign: 'center', fontStyle: 'normal', lineWidth: 0.1, lineColor: [200, 200, 200] };

        const addSummaryRow = (label, valContrato, valCorte, valAcum, valSaldo, isBold = false, isTotal = false) => {
            const labelStyle = { halign: 'right', fontStyle: isBold ? 'bold' : 'normal' };
            const currentValStyle = { ...valStyle, fontStyle: isBold ? 'bold' : 'normal' };
            if (isTotal) { labelStyle.fillColor = [240, 240, 240]; currentValStyle.fillColor = [240, 240, 240]; }

            summaryBody.push([
                { content: '', styles: noBorder }, { content: '', styles: noBorder }, { content: label, colSpan: 2, styles: labelStyle },
                { content: formatCurrency(valContrato), styles: currentValStyle }, { content: '', styles: noBorder },
                { content: formatCurrency(valCorte), styles: currentValStyle }, { content: '', styles: noBorder },
                { content: formatCurrency(valAcum), styles: currentValStyle }, { content: '', styles: noBorder },
                { content: formatCurrency(valSaldo), styles: currentValStyle }
            ]);
        };

        if (totals.contrato.admin > 0 || totals.corte.admin > 0) addSummaryRow('Administración', totals.contrato.admin, totals.corte.admin, totals.acumulado.admin, totals.saldo.admin);
        if (totals.contrato.imprev > 0 || totals.corte.imprev > 0) addSummaryRow('Imprevistos', totals.contrato.imprev, totals.corte.imprev, totals.acumulado.imprev, totals.saldo.imprev);
        if (totals.contrato.util > 0 || totals.corte.util > 0) addSummaryRow('Utilidad', totals.contrato.util, totals.corte.util, totals.acumulado.util, totals.saldo.util);
        if (totals.contrato.ivaUtil > 0 || totals.corte.ivaUtil > 0) addSummaryRow('IVA sobre Utilidad', totals.contrato.ivaUtil, totals.corte.ivaUtil, totals.acumulado.ivaUtil, totals.saldo.ivaUtil);
        if (totals.contrato.iva > 0 || totals.corte.iva > 0) addSummaryRow('IVA (19%)', totals.contrato.iva, totals.corte.iva, totals.acumulado.iva, totals.saldo.iva);

        addSummaryRow('TOTAL BRUTO ACTA', totals.contrato.totalBruto, totals.corte.totalBruto, totals.acumulado.totalBruto, totals.saldo.totalBruto, true, true);

        if (anticipoTotal > 0 || amortizacionActual > 0 || totalAmortizacionAcumulada > 0) {
            summaryBody.push([
                { content: '', styles: noBorder }, { content: '', styles: noBorder }, { content: 'Amortización Anticipo', colSpan: 2, styles: { halign: 'center' } },
                { content: `(${formatCurrency(anticipoTotal)})`, styles: valStyle }, { content: '', styles: noBorder },
                { content: `(${formatCurrency(amortizacionActual)})`, styles: valStyle }, { content: '', styles: noBorder },
                { content: `(${formatCurrency(totalAmortizacionAcumulada)})`, styles: valStyle }, { content: '', styles: noBorder },
                { content: `(${formatCurrency(saldoPorAmortizar)})`, styles: valStyle }
            ]);
        }

        if (totalDescuentosAcumulados > 0 || descuentosActuales > 0) {
            summaryBody.push([
                { content: '', styles: noBorder }, { content: '', styles: noBorder }, { content: 'Otros Descuentos', colSpan: 2, styles: { halign: 'right' } },
                { content: '-', styles: valStyle }, { content: '', styles: noBorder }, { content: `(${formatCurrency(descuentosActuales)})`, styles: valStyle },
                { content: '', styles: noBorder }, { content: `(${formatCurrency(totalDescuentosAcumulados)})`, styles: valStyle }, { content: '', styles: noBorder },
                { content: '-', styles: valStyle }
            ]);
        }

        const netoStyle = { fontStyle: 'bold', fillColor: [46, 204, 113], textColor: 255, halign: 'center', lineWidth: 0.1, lineColor: [200, 200, 200] };
        summaryBody.push([
            { content: '', styles: noBorder }, { content: '', styles: noBorder },
            { content: 'NETO A PAGAR', colSpan: 2, styles: { halign: 'right', fontStyle: 'bold', fillColor: [46, 204, 113], textColor: 255 } },
            { content: '-', styles: { ...netoStyle, fillColor: null, textColor: 0 } }, { content: '', styles: noBorder },
            { content: formatCurrency(netoCorte), styles: netoStyle }, { content: '', styles: noBorder },
            { content: formatCurrency(netoAcumulado), styles: netoStyle }, { content: '', styles: noBorder },
            { content: formatCurrency(netoSaldo), styles: netoStyle }
        ]);

        pdfDoc.autoTable({
            startY: pdfDoc.lastAutoTable.finalY,
            head: [], body: summaryBody, theme: 'grid', columnStyles: distinctColumnStyles,
            styles: { fontSize: 8, cellPadding: 1.5, lineWidth: 0.1, lineColor: [200, 200, 200], overflow: 'linebreak' },
            margin: { left: pageMargin, right: pageMargin }, pageBreak: 'avoid'
        });

        const yFirma = pdfDoc.lastAutoTable.finalY + 40;
        const colWidth = (pageWidth - (pageMargin * 2)) / 3;
        const x1 = pageMargin + (colWidth / 2);
        const x2 = pageMargin + colWidth + (colWidth / 2);
        const x3 = pageMargin + (colWidth * 2) + (colWidth / 2);
        const lineWidth = 60;

        if (yFirma > 190) pdfDoc.addPage();

        pdfDoc.line(x1 - (lineWidth / 2), yFirma, x1 + (lineWidth / 2), yFirma);
        pdfDoc.text(empresaInfo.nombre, x1, yFirma + 5, { align: "center", maxWidth: 60 });
        pdfDoc.line(x2 - (lineWidth / 2), yFirma, x2 + (lineWidth / 2), yFirma);
        pdfDoc.text("Interventoría", x2, yFirma + 5, { align: "center" });
        pdfDoc.line(x3 - (lineWidth / 2), yFirma, x3 + (lineWidth / 2), yFirma);
        pdfDoc.text("Director Obra", x3, yFirma + 5, { align: "center" });

        pdfDoc.save(`Corte_${corte.corteNumber}_${proyecto.name}_${exportType}.pdf`);

    } catch (e) {
        console.error("Error PDF:", e);
        alert("Error generando PDF: " + e.message);
    } finally {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }
}

/**
 * Apaga la escucha de la base de datos para los cortes
 * para ahorrar memoria cuando salimos del proyecto.
 */
export function cleanupCortesSubscription() {
    if (unsubscribeCortes) {
        unsubscribeCortes();
        unsubscribeCortes = null;
    }
}