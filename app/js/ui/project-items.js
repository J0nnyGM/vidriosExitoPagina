// js/ui/project-items.js

import { db, storage, functions, httpsCallable } from '../core/firebase-config.js';
import { doc, getDoc, addDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, writeBatch, getDocs, orderBy, collectionGroup, limit, serverTimestamp, startAfter } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, deleteObject } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

const ITEMS_PER_PAGE = 20;

export function loadItems(projectId) {
    const itemsTableBody = document.getElementById('items-table-body');
    if (!itemsTableBody) return;

    window.lastVisibleItemDoc = null;
    itemsTableBody.innerHTML = '';

    if (window.unsubscribeItems) window.unsubscribeItems();

    fetchMoreItems(projectId);
}

export async function fetchMoreItems(projectId) {
    const itemsTableBody = document.getElementById('items-table-body');
    const loadMoreBtn = document.getElementById('load-more-items-btn');

    if (window.isFetchingItems || !window.currentProject) return;
    window.isFetchingItems = true;
    loadMoreBtn.textContent = 'Cargando...';
    loadMoreBtn.classList.remove('hidden');

    try {
        let q = query(
            collection(db, "projects", projectId, "items"),
            orderBy(window.itemSortState.key, window.itemSortState.direction),
            limit(ITEMS_PER_PAGE)
        );

        if (window.lastVisibleItemDoc) {
            q = query(q, startAfter(window.lastVisibleItemDoc));
        }

        const itemsSnapshot = await getDocs(q);

        if (itemsSnapshot.empty && !window.lastVisibleItemDoc) {
            itemsTableBody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-gray-500">No hay ítems.</td></tr>`;
            loadMoreBtn.classList.add('hidden');
            return;
        }

        const items = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const itemIds = items.map(item => item.id);
        const executedCounts = new Map(itemIds.map(id => [id, 0]));

        if (itemIds.length > 0) {
            const subItemsQuery = query(collectionGroup(db, "subItems"), where("itemId", "in", itemIds), where("status", "==", "Instalado"));
            const subItemsSnapshot = await getDocs(subItemsQuery);
            subItemsSnapshot.forEach(doc => {
                const subItem = doc.data();
                executedCounts.set(subItem.itemId, (executedCounts.get(subItem.itemId) || 0) + 1);
            });
        }

        items.forEach(itemData => {
            const executedCount = executedCounts.get(itemData.id) || 0;
            const percentage = itemData.quantity > 0 ? (executedCount / itemData.quantity) : 0;
            itemData.status = percentage === 0 ? 'Pendiente' : (percentage < 1 ? 'En Proceso' : 'Instalado');

            const row = createItemRow(itemData, executedCount);
            itemsTableBody.appendChild(row);
        });

        window.lastVisibleItemDoc = itemsSnapshot.docs[itemsSnapshot.docs.length - 1];

        if (itemsSnapshot.docs.length < ITEMS_PER_PAGE) {
            loadMoreBtn.classList.add('hidden');
        } else {
            loadMoreBtn.classList.remove('hidden');
        }

    } catch (error) {
        console.error("Error al cargar más ítems:", error);
    } finally {
        window.isFetchingItems = false;
        loadMoreBtn.textContent = 'Cargar Más';
    }
}

export function renderSortedItems() {
    document.querySelectorAll('.sortable-header').forEach(header => {
        const indicator = header.querySelector('.sort-indicator');
        if (header.dataset.sort === window.itemSortState.key) {
            indicator.textContent = window.itemSortState.direction === 'asc' ? '↑' : '↓';
            indicator.style.opacity = '1';
        } else {
            indicator.textContent = '';
            indicator.style.opacity = '0.5';
        }
    });
}

export function createItemRow(item, executedCount) {
    const row = document.createElement('tr');
    row.className = 'bg-white border-b hover:bg-gray-50';
    row.dataset.id = item.id;

    const unitPrice = window.calculateItemUnitPrice(item);
    const totalValue = window.calculateItemTotal(item);
    const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });

    let statusColor;
    if (item.status === 'Pendiente') { statusColor = 'bg-red-100 text-red-800'; }
    else if (item.status === 'En Proceso') { statusColor = 'bg-yellow-100 text-yellow-800'; }
    else { statusColor = 'bg-green-100 text-green-800'; }

    const actionBlueprintBtn = item.blueprintURL
        ? `<button onclick="viewDocument('${item.blueprintURL}', '${item.name}')" 
             class="text-indigo-600 hover:bg-indigo-50 p-2 rounded-lg transition-colors border border-transparent hover:border-indigo-100" 
             title="Ver Plano">
             <i class="fa-solid fa-file-contract"></i>
           </button>`
        : '';

    row.innerHTML = `
        <td class="px-6 py-4" data-label="Objeto">
            <div class="font-bold text-gray-900">${item.name}</div>
            </td>
        
        <td class="px-6 py-4 text-sm text-gray-600 align-top" data-label="Descripción">
            <div class="whitespace-normal break-words leading-snug">
                ${item.description || '<span class="text-gray-300 italic">---</span>'}
            </div>
        </td>

        <td class="px-6 py-4 text-center font-bold text-gray-800" data-label="Cant.">${item.quantity}</td>
        <td class="px-6 py-4 text-center" data-label="Ancho (m)">${item.width}</td>
        <td class="px-6 py-4 text-center" data-label="Alto (m)">${item.height}</td>
        <td class="px-6 py-4 text-center text-xs" data-label="Vlr. Unitario">${currencyFormatter.format(unitPrice)}</td>
        <td class="px-6 py-4 text-center font-bold text-gray-900" data-label="Vlr. Total">${currencyFormatter.format(totalValue)}</td>
        <td class="px-6 py-4 text-center" data-label="Estado">
            <span class="text-xs font-medium px-2.5 py-0.5 rounded-full ${statusColor}">${item.status}</span>
        </td>
        
        <td class="px-6 py-4 text-center" data-label="Acciones">
            <div class="flex justify-center items-center gap-2">
                ${actionBlueprintBtn} <button data-action="view-item-details" class="text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-colors" title="Ver Sub-ítems">
                    <i class="fa-solid fa-eye"></i>
                </button>
                ${window.currentUserRole === 'admin' ? `
                <button data-action="edit-item" class="text-amber-500 hover:bg-amber-50 p-2 rounded-lg transition-colors" title="Editar">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button data-action="delete-item" class="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors" title="Eliminar">
                    <i class="fa-solid fa-trash"></i>
                </button>
                ` : ''}
            </div>
        </td>`;

    return row;
}

export async function createItem(data) {
    try {
        const createProjectItemFunction = httpsCallable(functions, 'createProjectItem');
        const projectPricingModel = window.currentProject.pricingModel || 'separado';
        const newItemData = {
            name: data.name,
            description: data.description,
            blueprintURL: data.blueprintURL || null,
            quantity: parseInt(data.quantity),
            width: parseFloat(data.width) || 0,
            height: parseFloat(data.height) || 0,
            itemType: projectPricingModel === 'incluido' ? 'suministro_instalacion_incluido' : 'suministro_instalacion',
            projectId: window.currentProject.id,
        };

        if (projectPricingModel === 'incluido') {
            newItemData.includedDetails = {
                unitPrice: parseFloat(data.included_unitPrice?.replace(/[$. ]/g, '')) || 0,
                taxType: data.included_taxType || 'none',
                aiuA: parseFloat(data.included_aiuA) || 0,
                aiuI: parseFloat(data.included_aiuI) || 0,
                aiuU: parseFloat(data.included_aiuU) || 0
            };
            newItemData.supplyDetails = {};
            newItemData.installationDetails = {};
        } else {
            newItemData.supplyDetails = {
                unitPrice: parseFloat(data.supply_unitPrice?.replace(/[$. ]/g, '')) || 0,
                taxType: data.supply_taxType || 'none',
                aiuA: parseFloat(data.supply_aiuA) || 0,
                aiuI: parseFloat(data.supply_aiuI) || 0,
                aiuU: parseFloat(data.supply_aiuU) || 0
            };
            newItemData.installationDetails = {
                unitPrice: parseFloat(data.installation_unitPrice?.replace(/[$. ]/g, '')) || 0,
                taxType: data.installation_taxType || 'none',
                aiuA: parseFloat(data.installation_aiuA) || 0,
                aiuI: parseFloat(data.installation_aiuI) || 0,
                aiuU: parseFloat(data.installation_aiuU) || 0
            };
            newItemData.includedDetails = {};
        }

        await createProjectItemFunction(newItemData);

    } catch (error) {
        console.error("Error al llamar a la función createProjectItem:", error);
        alert(`Error al crear el ítem: ${error.message}`);
    }
}

export async function updateItem(itemId, data) {
    const projectPricingModel = window.currentProject.pricingModel || 'separado';

    const updatedData = {
        name: data.name,
        description: data.description,
        ...(data.blueprintURL ? { blueprintURL: data.blueprintURL } : {}),
        width: parseFloat(data.width) || 0,
        height: parseFloat(data.height) || 0,
        quantity: parseInt(data.quantity) || 1,
        itemType: projectPricingModel === 'incluido' ? 'suministro_instalacion_incluido' : 'suministro_instalacion',
        projectId: window.currentProject.id,
    };

    if (projectPricingModel === 'incluido') {
        updatedData.includedDetails = {
            unitPrice: parseFloat(data.included_unitPrice?.replace(/[$. ]/g, '')) || 0,
            taxType: data.included_taxType || 'none',
            aiuA: parseFloat(data.included_aiuA) || 0,
            aiuI: parseFloat(data.included_aiuI) || 0,
            aiuU: parseFloat(data.included_aiuU) || 0
        };
        updatedData.supplyDetails = {};
        updatedData.installationDetails = {};
    } else {
        updatedData.supplyDetails = {
            unitPrice: parseFloat(data.supply_unitPrice?.replace(/[$. ]/g, '')) || 0,
            taxType: data.supply_taxType || 'none',
            aiuA: parseFloat(data.supply_aiuA) || 0,
            aiuI: parseFloat(data.supply_aiuI) || 0,
            aiuU: parseFloat(data.supply_aiuU) || 0
        };
        updatedData.installationDetails = {
            unitPrice: parseFloat(data.installation_unitPrice?.replace(/[$. ]/g, '')) || 0,
            taxType: data.installation_taxType || 'none',
            aiuA: parseFloat(data.installation_aiuA) || 0,
            aiuI: parseFloat(data.installation_aiuI) || 0,
            aiuU: parseFloat(data.installation_aiuU) || 0
        };
        updatedData.includedDetails = {};
    }

    try {
        const updateProjectItemFunction = httpsCallable(functions, 'updateProjectItem');
        await updateProjectItemFunction({
            itemId: itemId,
            updatedData: updatedData
        });

    } catch (error) {
        console.error("Error al llamar a la función updateProjectItem:", error);
        alert(`Error al actualizar el ítem: ${error.message}`);
        throw error;
    }
}

export async function deleteItem(itemId) {
    const batch = writeBatch(db);
    const itemRef = doc(db, "projects", window.currentProject.id, "items", itemId);
    const subItemsQuery = query(collection(itemRef, "subItems"));

    const subItemsSnapshot = await getDocs(subItemsQuery);
    subItemsSnapshot.forEach(doc => batch.delete(doc.ref));
    batch.delete(itemRef);
    await batch.commit();
}

export function showSubItems(item) {
    window.currentItem = item;
    window.materialRequestReturnContext = { view: 'subItems' };

    window.showView('subItems');
    document.getElementById('item-name-header').textContent = `Detalle de: ${item.name}`;
    document.getElementById('item-summary-header').textContent = `Total de ${item.quantity} unidades.`;
    loadSubItems(item.id);
}

export function loadSubItems(itemId) {
    const loadingDiv = document.getElementById('loading-sub-items');
    if (loadingDiv) loadingDiv.classList.remove('hidden');
    const subItemsTableBody = document.getElementById('sub-items-table-body');

    const selectAllCheckbox = document.getElementById('select-all-subitems-checkbox');
    const registerMultipleBtn = document.getElementById('register-multiple-progress-btn');

    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    if (registerMultipleBtn) registerMultipleBtn.disabled = true;

    if (subItemsTableBody && !subItemsTableBody.dataset.listenerAttached) {
        subItemsTableBody.dataset.listenerAttached = 'true';

        const updateMultipleProgressButtonState = () => {
            const selectedCheckboxes = document.querySelectorAll('.subitem-checkbox:checked');
            if (registerMultipleBtn) {
                registerMultipleBtn.disabled = selectedCheckboxes.length === 0;
            }
        };

        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', () => {
                document.querySelectorAll('.subitem-checkbox').forEach(checkbox => {
                    checkbox.checked = selectAllCheckbox.checked;
                });
                updateMultipleProgressButtonState();
            });
        }

        subItemsTableBody.addEventListener('change', (e) => {
            if (e.target.classList.contains('subitem-checkbox')) {
                updateMultipleProgressButtonState();
                
                if (selectAllCheckbox && !e.target.checked) {
                    selectAllCheckbox.checked = false;
                } else if (selectAllCheckbox) {
                    const allCheckboxes = document.querySelectorAll('.subitem-checkbox');
                    const allChecked = document.querySelectorAll('.subitem-checkbox:checked');
                    selectAllCheckbox.checked = (allCheckboxes.length === allChecked.length && allCheckboxes.length > 0);
                }
            }
        });

        if (registerMultipleBtn) {
            registerMultipleBtn.addEventListener('click', () => {
                const selectedCheckboxes = document.querySelectorAll('.subitem-checkbox:checked');
                const selectedIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.id);
                if (typeof window.openMultipleProgressModal === 'function') {
                    window.openMultipleProgressModal(selectedIds);
                } else {
                    console.error("window.openMultipleProgressModal is not defined");
                }
            });
        }
    }

    if (!window.currentProject || !window.currentProject.id) {
        console.error("Error: currentProject no está definido al cargar subItems");
        return;
    }
    const q = query(collection(db, "projects", window.currentProject.id, "items", itemId, "subItems"));

    if (window.unsubscribeSubItems) window.unsubscribeSubItems();

    window.unsubscribeSubItems = onSnapshot(q, (querySnapshot) => {
        if (loadingDiv) loadingDiv.classList.add('hidden');
        subItemsTableBody.innerHTML = '';

        const docs = querySnapshot.docs.sort((a, b) => {
            const numA = a.data()?.number || 0;
            const numB = b.data()?.number || 0;
            return numA - numB;
        });

        if (docs.length === 0) {
            subItemsTableBody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-gray-500">No hay sub-ítems para mostrar.</td></tr>`;
            return;
        }

        docs.forEach(subItemDoc => {
            try {
                const subItem = { id: subItemDoc.id, ...subItemDoc.data() };
                subItemsTableBody.appendChild(createSubItemRow(subItem));
            } catch (error) {
                console.error("Error al procesar el subítem:", subItemDoc.id, error);
                const errorRow = document.createElement('tr');
                errorRow.innerHTML = `<td colspan="8" class="text-center py-4 text-red-500 font-semibold">Error al cargar este subítem (ID: ${subItemDoc.id}).</td>`;
                subItemsTableBody.appendChild(errorRow);
            }
        });
    }, (error) => {
        console.error("Error al cargar la lista de sub-ítems:", error);
        subItemsTableBody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-red-500">Ocurrió un error al cargar los datos.</td></tr>`;
    });
}

export function createSubItemRow(subItem) {
    const row = document.createElement('tr');
    row.className = 'border-b border-slate-150 hover:bg-slate-50/50 transition-colors duration-150';

    const manufacturerData = window.usersMap.get(subItem.manufacturer);
    const installerData = window.usersMap.get(subItem.installer);

    const manufacturerName = manufacturerData ? `${manufacturerData.firstName} ${manufacturerData.lastName}` : 'N/A';
    const installerName = installerData ? `${installerData.firstName} ${installerData.lastName}` : 'N/A';

    let statusText = subItem.status || 'Pendiente de Fabricación';
    let statusColor;
    switch (statusText) {
        case 'Instalado': statusColor = 'badge-premium-emerald'; break;
        case 'Pendiente de Instalación': statusColor = 'badge-premium-amber'; break;
        case 'Faltante de Evidencia': statusColor = 'badge-premium-rose'; break;
        default: statusColor = 'badge-premium-rose'; break;
    }

    let photoHtml = '<span class="text-xs text-slate-400 font-medium">Sin Evidencia</span>';
    if (subItem.photoURL) {
        photoHtml = `<button class="view-photo-btn px-2 py-1 text-[11px] font-bold bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-all" data-photourl="${subItem.photoURL}"><i class="fa-solid fa-image mr-1"></i> Ver</button>`;
        if (window.currentUserRole === 'admin') {
            photoHtml += `<button class="delete-photo-btn px-2 py-1 text-[11px] font-bold bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition-all ml-1.5" data-subitemid="${subItem.id}" data-itemid="${subItem.itemId}" data-projectid="${window.currentProject.id}" data-installerid="${subItem.installer}"><i class="fa-solid fa-trash-can"></i></button>`;
        }
    }

    row.innerHTML = `
        <td class="px-6 py-4 align-middle">
            <input type="checkbox" class="subitem-checkbox h-4 w-4 text-indigo-600 border-slate-350 rounded focus:ring-indigo-500 transition-all cursor-pointer" data-id="${subItem.id}">
        </td>
        <td class="px-6 py-4 font-bold text-slate-800 align-middle">${subItem.number || 'N/A'}</td>
        <td class="px-6 py-4 font-semibold text-slate-700 align-middle">${subItem.location || 'N/A'}</td>
        <td class="px-6 py-4 text-slate-600 align-middle">${manufacturerName}</td>
        <td class="px-6 py-4 text-slate-600 align-middle">${installerName}</td>
        <td class="px-6 py-4 text-slate-650 align-middle font-medium">${subItem.installDate || 'N/A'}</td>
        <td class="px-6 py-4 text-center align-middle"><span class="text-xs font-bold px-2.5 py-1 rounded-full ${statusColor}">${statusText}</span></td>
        <td class="px-6 py-4 text-center align-middle">${photoHtml}</td>
        <td class="px-6 py-4 text-center align-middle"><button class="register-progress-btn premium-btn-confirm py-1.5 px-3 bg-gradient-to-r from-blue-600 to-indigo-600 shadow-blue-50 text-xs w-full sm:w-auto">Avance Individual</button></td>
    `;

    if (subItem.photoURL) {
        row.querySelector('.view-photo-btn').addEventListener('click', (e) => {
            window.openImageModal(e.target.dataset.photourl);
        });
        if (window.currentUserRole === 'admin') {
            const deleteBtn = row.querySelector('.delete-photo-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    window.openConfirmModal(`¿Seguro que quieres eliminar esta foto de evidencia?`, () => {
                        window.handleDeletePhoto(e.target.dataset.subitemid, e.target.dataset.itemid, e.target.dataset.installerid, e.target.dataset.projectid);
                    });
                });
            }
        }
    }

    row.querySelector('.register-progress-btn').addEventListener('click', () => window.openProgressModal(subItem));
    return row;
}

export async function updateSubItem(itemId, subItemId, data) {
    const subItemRef = doc(db, "projects", window.currentProject.id, "items", itemId, "subItems", subItemId);
    await updateDoc(subItemRef, data);
}

export async function exportProjectToPDF() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    try {
        await window.ensurePDF();
        const { jsPDF } = window.jspdf;
        const docPDF = new jsPDF();

        // Cargar datos de la empresa
        const companyDoc = await getDoc(doc(db, "settings", "company"));
        let companyData = {
            name: "VIDRIOS ÉXITO S.A.S.",
            nit: "901.123.456-7",
            phone: "+57 (300) 123-4567",
            email: "contacto@vidriosexito.com",
            address: "Calle Ficticia #123, Bogotá, Colombia"
        };
        if (companyDoc.exists()) {
            companyData = { ...companyData, ...companyDoc.data() };
        }

        // Estilos e Inicialización del PDF
        docPDF.setFont("helvetica", "normal");
        let yPosition = 20;

        // Encabezado
        docPDF.setFontSize(16);
        docPDF.setFont("helvetica", "bold");
        docPDF.text(companyData.name, 14, yPosition);
        docPDF.setFontSize(10);
        docPDF.setFont("helvetica", "normal");
        yPosition += 6;
        docPDF.text(`NIT: ${companyData.nit} | Tel: ${companyData.phone}`, 14, yPosition);
        yPosition += 5;
        docPDF.text(`Email: ${companyData.email} | Dir: ${companyData.address}`, 14, yPosition);
        yPosition += 7;

        // Línea divisoria
        docPDF.setDrawColor(200, 200, 200);
        docPDF.line(14, yPosition, 196, yPosition);
        yPosition += 10;

        // Título del reporte
        docPDF.setFontSize(14);
        docPDF.setFont("helvetica", "bold");
        docPDF.text(`MEMORIA OPERATIVA Y AVANCE DE OBRA`, 14, yPosition);
        docPDF.setFontSize(10);
        docPDF.setFont("helvetica", "normal");
        yPosition += 6;
        docPDF.text(`Proyecto: ${window.currentProject.name}`, 14, yPosition);
        yPosition += 5;
        docPDF.text(`Fecha de Reporte: ${new Date().toLocaleDateString('es-CO')}`, 14, yPosition);
        yPosition += 10;

        // Cargar Ítems y renderizar tablas
        const itemsSnapshot = await getDocs(collection(db, "projects", window.currentProject.id, "items"));
        if (itemsSnapshot.empty) {
            docPDF.text("No se encontraron ítems en este proyecto.", 14, yPosition);
            docPDF.save(`Memoria_Proyecto_${window.currentProject.name.replace(/\s/g, '_')}.pdf`);
            return;
        }

        const items = itemsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        const itemsHeaders = [["Ítem / Descripción", "Cant.", "Dim (m)", "M2 Total", "Estado"]];
        const itemsRows = items.map(item => {
            const m2 = (item.width * item.height * item.quantity).toFixed(2);
            return [
                `${item.name}\n${item.description || ''}`,
                item.quantity,
                `${item.width} x ${item.height}`,
                m2,
                item.status || 'Pendiente'
            ];
        });

        docPDF.autoTable({
            startY: yPosition,
            head: itemsHeaders,
            body: itemsRows,
            theme: 'grid',
            headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
            styles: { fontSize: 8, cellPadding: 3 },
            columnStyles: { 0: { cellWidth: 80 } }
        });

        yPosition = docPDF.autoTable.previous.finalY + 15;

        // Detalle por Ítem
        docPDF.setFontSize(12);
        docPDF.setFont("helvetica", "bold");
        docPDF.text("DETALLE DE AVANCES INDIVIDUALES POR ÍTEM:", 14, yPosition);
        yPosition += 8;

        for (const item of items) {
            const subItemsSnapshot = await getDocs(collection(db, "projects", window.currentProject.id, "items", item.id, "subItems"));
            if (subItemsSnapshot.empty) continue;

            const subItems = subItemsSnapshot.docs.map(d => d.data()).sort((a, b) => (a.number || 0) - (b.number || 0));

            // Verificar si hay espacio suficiente en la página actual
            if (yPosition > 230) {
                docPDF.addPage();
                yPosition = 20;
            }

            docPDF.setFontSize(10);
            docPDF.setFont("helvetica", "bold");
            docPDF.text(`Ítem: ${item.name}`, 14, yPosition);
            yPosition += 5;

            const subHeaders = [["N°", "Ubicación", "Fabricante", "Instalador", "Fecha Inst.", "Estado"]];
            const subRows = subItems.map(si => {
                const fab = window.usersMap.get(si.manufacturer);
                const inst = window.usersMap.get(si.installer);
                return [
                    si.number || '-',
                    si.location || '-',
                    fab ? `${fab.firstName} ${fab.lastName}` : '-',
                    inst ? `${inst.firstName} ${inst.lastName}` : '-',
                    si.installDate || '-',
                    si.status || 'Pendiente'
                ];
            });

            docPDF.autoTable({
                startY: yPosition,
                head: subHeaders,
                body: subRows,
                theme: 'striped',
                headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255] },
                styles: { fontSize: 7, cellPadding: 2 }
            });

            yPosition = docPDF.autoTable.previous.finalY + 15;

            if (yPosition > 250) {
                docPDF.addPage();
                yPosition = 20;
            }
        }

        docPDF.save(`Memoria_Proyecto_${window.currentProject.name.replace(/\s/g, '_')}.pdf`);

    } catch (error) {
        console.error("Error al exportar a PDF:", error);
        alert("Ocurrió un error al generar el PDF: " + error.message);
    } finally {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }
}

export async function handleDeletePhoto(subItemId, itemId, installerId, projectId) {
    try {
        const storageRef = ref(storage, `evidence/${projectId}/${itemId}/${subItemId}`);
        await deleteObject(storageRef);
    } catch (error) {
        if (error.code === 'storage/object-not-found') {
            console.warn("La foto no existía en Storage (404), procediendo a borrar en Firestore...");
        } else {
            throw error;
        }
    }

    try {
        const subItemRef = doc(db, "projects", projectId, "items", itemId, "subItems", subItemId);
        await updateDoc(subItemRef, {
            photoURL: "",
            status: "Faltante de Evidencia"
        });

        const itemDoc = await getDoc(doc(db, "projects", projectId, "items", itemId));
        const itemName = itemDoc.exists() ? itemDoc.data().name : itemId;

        const subItemDoc = await getDoc(subItemRef);
        const subItemLocation = subItemDoc.exists() ? (subItemDoc.data().location || 'N/A') : 'N/A';

        const projectDoc = await getDoc(doc(db, "projects", projectId));
        const projectName = projectDoc.exists() ? projectDoc.data().name : 'Proyecto';

        await addDoc(collection(db, "notifications"), {
            userId: installerId,
            message: `Foto rechazada para ítem #${itemName} (Lugar: ${subItemLocation}). Por favor, sube una nueva.`,
            projectName: projectName,
            subItemId: subItemId,
            itemId: itemId,
            projectId: projectId,
            read: false,
            createdAt: serverTimestamp(),
            type: 'photo_rejected'
        });

    } catch (error) {
        console.error("Error al actualizar la foto en Firestore:", error);
        alert("No se pudo actualizar el estado de la foto en la base de datos.");
    }
}
