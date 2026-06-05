// js/proyecto-detalles.js
import { doc, getDoc, collection, query, getDocs, where, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Dependencias que inyectaremos desde app.js
let db, showView, setCurrentProject, setReturnContext, formatCurrency, loaders, openTaskDetailsModal;

// Variables de estado local para suscripciones en tiempo real
let unsubscribePayments = null;
let unsubscribeMaterialRequests = null;

const currencyFormatter = new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
});

export function initProyectoDetalles(firestoreDb, dependencies) {
    db = firestoreDb;
    showView = dependencies.showView;
    setCurrentProject = dependencies.setCurrentProject;
    setReturnContext = dependencies.setReturnContext;
    formatCurrency = dependencies.formatCurrency;
    loaders = dependencies.loaders; // Funciones para cargar las otras pestañas
    openTaskDetailsModal = dependencies.openTaskDetailsModal;
}

export function setupResponsiveTabs() {
    const desktopButtons = document.querySelectorAll('#project-details-tabs .tab-button');
    const dropdownMenuContainer = document.getElementById('dropdown-menu-items');
    
    if (!dropdownMenuContainer || !desktopButtons.length) return;

    dropdownMenuContainer.innerHTML = '';
    desktopButtons.forEach(button => {
        const menuItem = document.createElement('a');
        menuItem.href = '#';
        menuItem.dataset.tab = button.dataset.tab;
        menuItem.textContent = button.textContent;
        menuItem.className = 'block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100';
        dropdownMenuContainer.appendChild(menuItem);
    });
}

export function syncTabsState(tabName) {
    const dropdownButtonText = document.getElementById('dropdown-btn-text');
    let activeTabText = '';

    document.querySelectorAll('#project-details-tabs .tab-button').forEach(button => {
        const isActive = button.dataset.tab === tabName;
        button.classList.toggle('active', isActive);
        if (isActive) activeTabText = button.textContent;
    });

    if (dropdownButtonText) dropdownButtonText.textContent = activeTabText;
}

export function switchProjectTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });

    const activeContent = document.getElementById(`${tabName}-content`);
    if (activeContent) activeContent.classList.remove('hidden');

    syncTabsState(tabName);
}

export function calculateItemUnitPrice(item) {
    let unitPrice = 0;
    if (item.itemType === 'suministro_instalacion_incluido') {
        unitPrice = item.includedDetails?.unitPrice || 0;
    } else {
        if (item.itemType === 'suministro_instalacion') {
            unitPrice += item.supplyDetails?.unitPrice || 0;
            unitPrice += item.installationDetails?.unitPrice || 0;
        }
    }
    return Math.round(unitPrice);
}

export function calculateItemTotal(item) {
    let details = item.includedDetails;
    if (item.itemType === 'suministro_instalacion') {
        const supplyPrice = item.supplyDetails?.unitPrice || 0;
        const installPrice = item.installationDetails?.unitPrice || 0;
        const supplyTax = item.supplyDetails?.taxType === 'iva' ? (supplyPrice * 0.19) : 0;
        let installTax = 0;
        if (item.installationDetails?.taxType === 'aiu') {
            const admin = installPrice * ((item.installationDetails.aiuA || 0) / 100);
            const imprev = installPrice * ((item.installationDetails.aiuI || 0) / 100);
            const util = installPrice * ((item.installationDetails.aiuU || 0) / 100);
            installTax = admin + imprev + util + (util * 0.19);
        } else {
            installTax = installPrice * 0.19;
        }
        return (supplyPrice + supplyTax + installPrice + installTax) * (item.quantity || 1);
    } else if (details) {
        const basePrice = details.unitPrice || 0;
        let tax = 0;
        if (details.taxType === 'aiu') {
            const admin = basePrice * ((details.aiuA || 0) / 100);
            const imprev = basePrice * ((details.aiuI || 0) / 100);
            const util = basePrice * ((details.aiuU || 0) / 100);
            tax = admin + imprev + util + (util * 0.19);
        } else {
            tax = basePrice * 0.19;
        }
        return (basePrice + tax) * (item.quantity || 1);
    }
    return 0;
}

export async function calculateProjectContractedValue(projectId) {
    let totalValue = 0;
    const itemsQuery = query(collection(db, "projects", projectId, "items"));
    const querySnapshot = await getDocs(itemsQuery);
    querySnapshot.forEach(doc => {
        totalValue += calculateItemTotal(doc.data());
    });
    return Math.round(totalValue);
}

export async function loadProjectInfoTab(project) {
    if (!project) return;

    const infoInitialContract = document.getElementById('info-initial-contract-value');
    const infoContracted = document.getElementById('info-contracted-value');
    const infoExecuted = document.getElementById('info-executed-value');
    const pricingModelEl = document.getElementById('project-details-pricingModel');
    const startDateEl = document.getElementById('project-details-startDate');
    const kickoffDateEl = document.getElementById('project-kickoffDate');
    const endDateEl = document.getElementById('project-endDate');
    const anticipoTotalEl = document.getElementById('info-anticipo-total');
    const anticipoAmortizadoEl = document.getElementById('info-anticipo-amortizado');
    const anticipoPorAmortizarEl = document.getElementById('info-anticipo-por-amortizar');
    const installedItemsEl = document.getElementById('project-details-installedItems');
    const executedM2El = document.getElementById('project-details-executedM2');

    try {
        const stats = project.progressSummary || { totalM2: 0, executedM2: 0, totalItems: 0, executedItems: 0, executedValue: 0 };
        const contractedValue = await calculateProjectContractedValue(project.id);
        
        const paymentsQuery = query(collection(db, "projects", project.id, "payments"));
        const paymentsSnapshot = await getDocs(paymentsQuery);
        const allPayments = paymentsSnapshot.docs.map(doc => doc.data());

        const totalAnticipo = project.advance || 0;
        const anticipoPayments = allPayments.filter(p => p.type === 'abono_anticipo' || p.type === 'amortizacion_anticipo');
        const totalAmortizado = anticipoPayments.reduce((sum, p) => sum + p.amount, 0);

        if (infoInitialContract) infoInitialContract.textContent = formatCurrency(project.value || 0);
        if (infoContracted) infoContracted.textContent = formatCurrency(contractedValue);
        if (infoExecuted) infoExecuted.textContent = formatCurrency(stats.executedValue || 0);

        if (pricingModelEl) {
            pricingModelEl.textContent = project.pricingModel === 'incluido'
                ? 'Suministro e Instalación (Incluido)'
                : 'Suministro e Instalación (Separado)';
        }

        const formatDate = (dateStr) => dateStr ? new Date(dateStr + 'T00:00:00').toLocaleDateString('es-CO') : 'N/A';
        if (startDateEl) startDateEl.textContent = formatDate(project.startDate);
        if (kickoffDateEl) kickoffDateEl.textContent = formatDate(project.kickoffDate);
        if (endDateEl) endDateEl.textContent = formatDate(project.endDate);

        if (anticipoTotalEl) anticipoTotalEl.textContent = formatCurrency(totalAnticipo);
        if (anticipoAmortizadoEl) anticipoAmortizadoEl.textContent = formatCurrency(totalAmortizado);
        if (anticipoPorAmortizarEl) anticipoPorAmortizarEl.textContent = formatCurrency(totalAnticipo - totalAmortizado);

        if (installedItemsEl) installedItemsEl.textContent = `${stats.executedItems} / ${stats.totalItems}`;
        if (executedM2El) executedM2El.textContent = `${stats.executedM2.toFixed(2)} m² / ${stats.totalM2.toFixed(2)} m²`;

    } catch (error) {
        console.error("Error cargando pestaña Información General:", error);
    }
}

export async function showProjectDetails(project, defaultTabOrProjectId = 'info-general', openTaskId = null, fromHistory = false) {
    const projectTitle = document.getElementById('project-details-name');
    const projectBuilder = document.getElementById('project-details-builder');
    const loadingOverlay = document.getElementById('loading-overlay');

    showView('project-details');

    if (!fromHistory && project) {
        history.pushState({ viewName: 'project-details', projectId: project.id }, `Proyecto - ${project.name}`, `#project-details/${project.id}`);
    }

    loadingOverlay.classList.remove('hidden');
    let defaultTab = 'info-general';
    let currentProjectData = project;

    try {
        if (project && typeof project === 'object') {
            defaultTab = defaultTabOrProjectId;
        } else if (project === null && typeof defaultTabOrProjectId === 'string') {
            const projectId = defaultTabOrProjectId;
            const projectDoc = await getDoc(doc(db, "projects", projectId));
            if (projectDoc.exists()) {
                currentProjectData = { id: projectDoc.id, ...projectDoc.data() };
            } else {
                throw new Error("El proyecto no existe.");
            }
        } else {
            throw new Error("No se proporcionó proyecto ni ID.");
        }

        // Actualizamos el estado global en app.js
        setCurrentProject(currentProjectData);

        if (projectTitle) projectTitle.textContent = currentProjectData.name;
        if (projectBuilder) projectBuilder.textContent = currentProjectData.builderName || 'Constructora no especificada';

        setReturnContext({ view: 'proyecto-detalle', projectId: currentProjectData.id });

        setupResponsiveTabs();
        
        // Ejecutar los loaders de las pestañas
        loadProjectInfoTab(currentProjectData);
        loaders.loadItems(currentProjectData.id);
        loadMaterialsTab(currentProjectData);
        loaders.loadCortes(currentProjectData);
        loadPayments(currentProjectData);
        loaders.loadPeopleOfInterest(currentProjectData.id);
        loaders.renderInteractiveDocumentCards(currentProjectData.id);

        if (openTaskId) {
            switchProjectTab('items');
            setTimeout(() => {
                if(openTaskDetailsModal) openTaskDetailsModal(openTaskId);
            }, 500);
        } else {
            switchProjectTab(defaultTab);
        }

    } catch (error) {
        console.error("Error al mostrar detalles del proyecto:", error);
        showView('proyectos');
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

export async function loadPayments(project) {
    if (unsubscribePayments) unsubscribePayments();

    const cortesQuery = query(collection(db, "projects", project.id, "cortes"), where("status", "==", "aprobado"));
    const paymentsQuery = query(collection(db, "projects", project.id, "payments"), orderBy("date", "desc"));

    const approvedCortesSnapshot = await getDocs(cortesQuery);
    const allApprovedCortes = approvedCortesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    unsubscribePayments = onSnapshot(paymentsQuery, (paymentsSnapshot) => {
        // Obtenemos las referencias a los elementos del DOM CON LOS NUEVOS IDs
        const anticipoTotalEl = document.getElementById('pagos-anticipo-total-value');
        const anticipoAmortizadoEl = document.getElementById('pagos-anticipo-amortizado-value');
        const anticipoPorAmortizarEl = document.getElementById('pagos-anticipo-por-amortizar-value');
        const cortesListContainer = document.getElementById('cortes-payment-list');
        const otrosPagosTableBody = document.getElementById('other-payments-table-body');

        if (!anticipoTotalEl) return; // Salida de seguridad

        const allPayments = paymentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 1. Procesar Anticipo
        const totalAnticipo = project.advance || 0;
        const anticipoPayments = allPayments.filter(p => p.type === 'abono_anticipo' || p.type === 'amortizacion_anticipo');
        const totalAmortizado = anticipoPayments.reduce((sum, p) => sum + p.amount, 0);

        anticipoTotalEl.textContent = currencyFormatter.format(totalAnticipo);
        anticipoAmortizadoEl.textContent = currencyFormatter.format(totalAmortizado);
        anticipoPorAmortizarEl.textContent = currencyFormatter.format(totalAnticipo - totalAmortizado);

        // 2. Procesar Abonos a Cortes
        cortesListContainer.innerHTML = '';
        if (allApprovedCortes.length === 0) {
            cortesListContainer.innerHTML = '<p class="text-center py-4 text-gray-500">No hay cortes aprobados.</p>';
        } else {
            allApprovedCortes.forEach(corte => {
                const cortePayments = allPayments.filter(p => p.type === 'abono_corte' && p.targetId === corte.id);
                const totalPagadoCorte = cortePayments.reduce((sum, p) => sum + p.amount, 0);
                const saldoCorte = (corte.netoAPagar || 0) - totalPagadoCorte;

                const corteCard = document.createElement('div');
                corteCard.className = 'bg-white p-5 rounded-2xl border border-slate-100 shadow-sm transition-all hover:scale-[1.01] hover:shadow-md';
                corteCard.innerHTML = `
                    <div class="flex flex-col sm:flex-row justify-between items-start">
                        <div>
                            <p class="text-xs font-bold text-slate-400 uppercase mb-1">Registro de Obra</p>
                            <p class="font-black text-slate-800 text-lg">Corte #${corte.corteNumber}</p>
                            <p class="text-2xl font-black text-slate-800 tracking-tight mt-1">${currencyFormatter.format(corte.netoAPagar || 0)}</p>
                        </div>
                        <div class="text-left sm:text-right mt-3 sm:mt-0 w-full sm:w-auto">
                            <p class="text-xs font-medium text-slate-500">Pagado: <span class="font-bold text-emerald-600">${currencyFormatter.format(totalPagadoCorte)}</span></p>
                            <p class="text-xs font-medium text-slate-500 mt-0.5">Saldo: <span class="font-bold text-rose-600">${currencyFormatter.format(saldoCorte)}</span></p>
                            <button data-action="add-corte-payment" data-corte-id="${corte.id}" data-corte-number="${corte.corteNumber}" class="mt-3 premium-btn-confirm py-1.5 px-4 text-xs bg-gradient-to-r from-indigo-600 to-blue-600 shadow-indigo-50 w-full sm:w-auto">
                                <i class="fa-solid fa-plus mr-1"></i> Registrar Abono
                            </button>
                        </div>
                    </div>`;
                cortesListContainer.appendChild(corteCard);
            });
        }

        // 3. Procesar Otros Pagos
        const otrosPagos = allPayments.filter(p => !p.type || p.type === 'otro');
        otrosPagosTableBody.innerHTML = '';
        if (otrosPagos.length === 0) {
            otrosPagosTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-500">No hay otros movimientos.</td></tr>`;
        } else {
            otrosPagos.forEach(pago => {
                const row = document.createElement('tr');
                row.className = 'border-b border-slate-100 hover:bg-slate-50/50 transition-colors duration-150';
                row.innerHTML = `
                    <td class="px-6 py-4 font-medium text-slate-600">${new Date(pago.date).toLocaleDateString('es-CO')}</td>
                    <td class="px-6 py-4 font-bold text-slate-850">${pago.concept}</td>
                    <td class="px-6 py-4 text-right font-black text-slate-850">${currencyFormatter.format(pago.amount)}</td>
                    <td class="px-6 py-4 text-center">
                        <button data-action="delete-payment" data-id="${pago.id}" class="text-rose-600 hover:text-rose-800 font-bold transition-all hover:scale-105">
                            <i class="fa-solid fa-trash mr-1"></i> Eliminar
                        </button>
                    </td>`;
                otrosPagosTableBody.appendChild(row);
            });
        }
    });
}

export async function loadMaterialsTab(project, taskItems = null) {
    const currentUserRole = window.currentUserRole;
    const currentUser = window.currentUser;
    const usersMap = window.usersMap;
    const canRequest = currentUserRole === 'admin' || currentUserRole === 'operario';
    const requestMaterialBtn = document.getElementById('request-material-btn');

    if (requestMaterialBtn) {
        requestMaterialBtn.classList.toggle('hidden', !canRequest);

        // Almacenamos los ítems de la tarea en el botón
        if (taskItems) {
            requestMaterialBtn.dataset.taskItems = JSON.stringify(taskItems);
        } else {
            requestMaterialBtn.dataset.taskItems = "";
        }
    }

    const requestsTableBody = document.getElementById('requests-table-body');
    if (!requestsTableBody) return;

    // --- LÓGICA DE FILTRADO OPERARIO ---
    let allowedTaskIds = new Set();
    if (currentUserRole === 'operario' && currentUser) {
        try {
            const q1 = query(collection(db, "tasks"), where("projectId", "==", project.id), where("assigneeId", "==", currentUser.uid));
            const q2 = query(collection(db, "tasks"), where("projectId", "==", project.id), where("additionalAssigneeIds", "array-contains", currentUser.uid));
            const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
            snap1.forEach(d => allowedTaskIds.add(d.id));
            snap2.forEach(d => allowedTaskIds.add(d.id));
        } catch (error) {
            console.error("Error cargando tareas:", error);
        }
    }
    // ------------------------------------

    if (unsubscribeMaterialRequests) unsubscribeMaterialRequests();

    const requestsQuery = query(collection(db, "projects", project.id, "materialRequests"), orderBy("createdAt", "desc"));

    unsubscribeMaterialRequests = onSnapshot(requestsQuery, async (snapshot) => {
        if (snapshot.empty) {
            requestsTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">No hay solicitudes de material.</td></tr>`;
            return;
        }

        const requestsPromises = snapshot.docs.map(async (requestDoc) => {
            const request = { id: requestDoc.id, ...requestDoc.data() };

            // Filtro de seguridad para operarios
            if (currentUserRole === 'operario' && currentUser) {
                const isMyRequest = request.requesterId === currentUser.uid;
                const isMyTask = request.taskId && allowedTaskIds.has(request.taskId);
                if (!isMyRequest && !isMyTask) return null;
            }

            // --- NUEVO: Cargar descripción de la tarea asociada ---
            if (request.taskId) {
                try {
                    // Consultamos la tarea para obtener su descripción
                    const taskSnap = await getDoc(doc(db, "tasks", request.taskId));
                    if (taskSnap.exists()) {
                        request.taskDescription = taskSnap.data().description;
                    }
                } catch (e) {
                    console.warn("No se pudo cargar la info de la tarea", e);
                }
            }
            // -----------------------------------------------------

            const consumedItems = request.consumedItems || [];
            if (consumedItems.length > 0 && consumedItems[0].materialId) {
                const firstItem = consumedItems[0];
                try {
                    const materialRef = doc(db, "materialCatalog", firstItem.materialId);
                    const materialDoc = await getDoc(materialRef);
                    const materialName = materialDoc.exists() ? materialDoc.data().name : 'Desconocido';
                    request.summary = `${firstItem.quantity} x ${materialName}`;
                    if (consumedItems.length > 1) {
                        request.summary += ` (y ${consumedItems.length - 1} más)`;
                    }
                } catch (e) {
                    request.summary = 'Error cargando ítem';
                }
            } else {
                request.summary = 'N/A';
            }
            return request;
        });

        const allRequests = await Promise.all(requestsPromises);
        const requestsWithData = allRequests.filter(r => r !== null);

        requestsTableBody.innerHTML = '';

        if (requestsWithData.length === 0) {
            requestsTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">No hay solicitudes visibles.</td></tr>`;
            return;
        }

        requestsWithData.forEach(request => {
            const solicitante = (usersMap && usersMap.get(request.requesterId)?.firstName) || 'Desconocido';
            const responsable = (usersMap && usersMap.get(request.responsibleId)?.firstName) || 'N/A';
            const baseBtnStyle = "text-xs font-bold py-1.5 px-3 rounded-lg shadow-sm transition-all text-center flex items-center justify-center shrink-0 w-28";
            const viewDetailsBtn = `<button data-action="view-request-details" data-id="${request.id}" class="premium-btn-confirm ${baseBtnStyle} bg-gradient-to-r from-blue-600 to-indigo-600 shadow-blue-50">Ver Detalles</button>`;

            let statusText, statusColor, actionsHtml = '';
            switch (request.status) {
                case 'pendiente':
                    statusText = 'Pendiente'; statusColor = 'badge-premium-amber';
                    if (currentUserRole === 'admin' || currentUserRole === 'bodega') {
                        actionsHtml = `
                            <button data-action="approve-request" data-id="${request.id}" class="premium-btn-confirm ${baseBtnStyle} bg-gradient-to-r from-emerald-600 to-teal-600 shadow-emerald-50">Aprobar</button>
                            <button data-action="reject-request" data-id="${request.id}" class="premium-btn-cancel text-xs py-1.5 px-3 font-bold border border-rose-100 bg-rose-50 hover:bg-rose-100 text-rose-600 w-28">Rechazar</button>
                        `;
                    }
                    break;
                case 'aprobado':
                    statusText = 'Aprobado'; statusColor = 'badge-premium-indigo';
                    if (currentUserRole === 'bodega' || currentUserRole === 'admin') {
                        actionsHtml = `<button data-action="deliver-material" data-id="${request.id}" class="premium-btn-confirm ${baseBtnStyle} bg-gradient-to-r from-teal-600 to-emerald-600 shadow-teal-50">Entregar</button>`;
                    }
                    break;
                case 'entregado_parcial':
                    statusText = 'Entrega Parcial'; statusColor = 'badge-premium-amber';
                    if (currentUserRole === 'bodega' || currentUserRole === 'admin') {
                        actionsHtml = `<button data-action="deliver-material" data-id="${request.id}" class="premium-btn-confirm ${baseBtnStyle} bg-gradient-to-r from-teal-600 to-emerald-600 shadow-teal-50">Entregar</button>`;
                    }
                    if (currentUserRole === 'admin' || currentUserRole === 'operario') {
                        actionsHtml += `<button data-action="return-material" data-id="${request.id}" class="premium-btn-confirm ${baseBtnStyle} bg-gradient-to-r from-amber-500 to-orange-500 shadow-amber-50 mt-1">Devolver</button>`;
                    }
                    break;
                case 'entregado':
                    statusText = 'Entregado'; statusColor = 'badge-premium-emerald';
                    if (currentUserRole === 'admin' || currentUserRole === 'operario') {
                        actionsHtml = `<button data-action="return-material" data-id="${request.id}" class="premium-btn-confirm ${baseBtnStyle} bg-gradient-to-r from-amber-500 to-orange-500 shadow-amber-50">Devolver</button>`;
                    }
                    break;
                case 'rechazado':
                    statusText = 'Rechazado'; statusColor = 'badge-premium-rose';
                    break;
                default:
                    statusText = request.status || 'Desconocido'; statusColor = 'bg-slate-100 text-slate-800 border border-slate-200';
            }

            // --- NUEVO: HTML para mostrar la Tarea ---
            const taskHtml = request.taskDescription
                ? `<div class="mt-2 flex items-start text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded border border-indigo-100">
                     <i class="fa-solid fa-thumbtack mt-0.5 mr-1.5 flex-shrink-0"></i>
                     <span class="font-medium truncate max-w-[200px]" title="${request.taskDescription}">${request.taskDescription}</span>
                   </div>`
                : '';
            // -----------------------------------------

            const row = document.createElement('tr');
            row.className = "border-b border-slate-100 hover:bg-slate-50/50 transition-colors";
            
            let formattedDate = 'N/A';
            if (request.createdAt) {
                try {
                    formattedDate = request.createdAt.toDate().toLocaleDateString('es-CO');
                } catch (e) {
                    formattedDate = new Date(request.createdAt).toLocaleDateString('es-CO');
                }
            }

            row.innerHTML = `
                <td class="px-6 py-4">${formattedDate}</td>
                <td class="px-6 py-4">${solicitante}</td>
                <td class="px-6 py-4">
                    <div>
                        <span class="block text-gray-800">${request.summary}</span>
                        ${taskHtml}
                    </div>
                </td>
                <td class="px-6 py-4 text-center"><span class="px-2 py-1 text-xs font-semibold rounded-full ${statusColor}">${statusText}</span></td>
                <td class="px-6 py-4">${responsable}</td>
                <td class="px-6 py-4 text-center">
                    <div class="flex justify-center items-center gap-2 flex-wrap">
                        ${viewDetailsBtn}
                        ${actionsHtml}
                    </div>
                </td>
            `;
            requestsTableBody.appendChild(row);
        });
    });
}