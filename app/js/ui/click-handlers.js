import { db, storage, functions, httpsCallable } from '../core/firebase-config.js';
import { doc, getDoc, addDoc, updateDoc, collection, query, orderBy, getDocs, where, writeBatch, increment } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

export function initClickHandlers() {
    document.body.addEventListener('click', async (e) => {
        const target = e.target;

        // Toggle del menú de usuario y notificaciones
        const userMenuBtn = target.closest('#user-menu-btn');
        const notificationsBtn = target.closest('#notifications-btn');
        const userDropdown = document.getElementById('user-dropdown');
        const notificationsDropdown = document.getElementById('notifications-dropdown');

        if (userMenuBtn) {
            e.preventDefault();
            e.stopPropagation();
            if (userDropdown) userDropdown.classList.toggle('hidden');
            if (notificationsDropdown) notificationsDropdown.classList.add('hidden');
            return;
        }

        if (notificationsBtn) {
            e.preventDefault();
            e.stopPropagation();
            if (notificationsDropdown) notificationsDropdown.classList.toggle('hidden');
            if (userDropdown) userDropdown.classList.add('hidden');
            return;
        }

        // Cerrar dropdowns si se hace clic afuera
        if (userDropdown && !userDropdown.classList.contains('hidden') && !target.closest('#user-menu-container')) {
            userDropdown.classList.add('hidden');
        }
        if (notificationsDropdown && !notificationsDropdown.classList.contains('hidden') && !target.closest('#notifications-btn') && !target.closest('#notifications-dropdown')) {
            notificationsDropdown.classList.add('hidden');
        }

        // Interceptar clics en pestañas de proyectos activos y archivados
        const activeProjectsTab = target.closest('#active-projects-tab');
        const archivedProjectsTab = target.closest('#archived-projects-tab');
        if (activeProjectsTab) {
            e.preventDefault();
            if (typeof window.loadProjects === 'function') {
                window.loadProjects('active');
            }
            return;
        }
        if (archivedProjectsTab) {
            e.preventDefault();
            if (typeof window.loadProjects === 'function') {
                window.loadProjects('archived');
            }
            return;
        }

        // Interceptar clic en botón de recalcular estadísticas de proyectos
        const recalculateBtn = target.closest('#recalculate-all-btn');
        if (recalculateBtn) {
            e.preventDefault();
            window.openConfirmModal("Esto recalculará las estadísticas de TODOS los proyectos. Puede tardar un momento. ¿Continuar?", async () => {
                const loadingOverlay = document.getElementById('loading-overlay');
                if (loadingOverlay) loadingOverlay.classList.remove('hidden');
                try {
                    const runRecalculation = httpsCallable(functions, 'runFullRecalculation');
                    const result = await runRecalculation();
                    window.showToast(result.data.message || "Estadísticas recalculadas exitosamente.", "success");
                } catch (error) {
                    console.error("Error al ejecutar el recálculo:", error);
                    window.showToast("Error: " + error.message, "error");
                } finally {
                    if (loadingOverlay) loadingOverlay.classList.add('hidden');
                }
            });
            return;
        }

        // Manejador de clics para enlaces de navegación del Sidebar (#main-nav .nav-link y .mobile-nav-link)
        const navLink = target.closest('#main-nav .nav-link, .mobile-nav-link');
        if (navLink && navLink.id !== 'mobile-more-menu-btn') {
            e.preventDefault();
            const viewName = navLink.dataset.view;
            if (viewName && typeof window.navigateToView === 'function') {
                window.navigateToView(viewName);
            }
            return;
        }

        // Abrir/cerrar sidebar (menú de cajón en móvil)
        const toggleMenuBtn = target.closest('#menu-toggle-btn, #mobile-more-menu-btn');
        if (toggleMenuBtn) {
            e.preventDefault();
            e.stopPropagation();
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            if (sidebar) {
                const isOpen = !sidebar.classList.contains('-translate-x-full');
                if (isOpen) {
                    if (typeof window.closeSidebar === 'function') {
                        window.closeSidebar();
                    } else {
                        sidebar.classList.add('-translate-x-full');
                        if (overlay) {
                            overlay.classList.remove('opacity-100', 'pointer-events-auto');
                            overlay.classList.add('opacity-0', 'pointer-events-none');
                        }
                    }
                } else {
                    sidebar.classList.remove('-translate-x-full');
                    if (overlay) {
                        overlay.classList.remove('opacity-0', 'pointer-events-none');
                        overlay.classList.add('opacity-100', 'pointer-events-auto');
                    }
                    
                    // Sincronizar iconos a estado abierto (X con rotación)
                    const mobileIcon = document.querySelector('#mobile-more-menu-btn i');
                    const mobileSpan = document.querySelector('#mobile-more-menu-btn span');
                    const mobileBtn = document.getElementById('mobile-more-menu-btn');
                    const headerIcon = document.querySelector('#menu-toggle-btn i');
                    
                    if (mobileIcon) {
                        mobileIcon.classList.remove('fa-bars');
                        mobileIcon.classList.add('fa-xmark', 'rotate-90');
                    }
                    if (mobileSpan) {
                        mobileSpan.textContent = 'Cerrar';
                    }
                    if (mobileBtn) {
                        mobileBtn.classList.add('text-blue-500', 'active');
                    }
                    if (headerIcon) {
                        headerIcon.classList.remove('fa-bars');
                        headerIcon.classList.add('fa-xmark', 'rotate-90');
                    }
                }
            }
            return;
        }

        // Cerrar sidebar
        const sidebarToggleBtn = target.closest('#sidebar-toggle-btn');
        if (sidebarToggleBtn) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.closeSidebar === 'function') window.closeSidebar();
            return;
        }

        // Cerrar sidebar si se hace clic fuera de él en móvil
        if (window.innerWidth < 768) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar && !sidebar.classList.contains('-translate-x-full') && !target.closest('#sidebar') && !target.closest('#menu-toggle-btn') && !target.closest('#mobile-more-menu-btn')) {
                if (typeof window.closeSidebar === 'function') window.closeSidebar();
            }
        }

        // Manejador de clics para el Modal de Check-in
        const checkinModal = target.closest('#safety-checkin-modal');
        if (checkinModal) {
            const scanBtn = target.closest('#checkin-take-photo-btn');

            // Botón: ESCANEAR ROSTRO
            if (scanBtn) {
                const faceStatus = document.getElementById('checkin-face-status');
                const videoEl = document.getElementById('checkin-video-feed');
                const canvasEl = document.getElementById('checkin-video-canvas');
                const scannerLine = document.getElementById('scanner-line');
                const confirmBtn = document.getElementById('checkin-confirm-btn');

                scanBtn.disabled = true;
                const originalContent = scanBtn.innerHTML;
                scanBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Procesando...</span>';

                if (scannerLine) {
                    scannerLine.classList.remove('hidden');
                    scannerLine.classList.add('animate-scan');
                }

                try {
                    if (!window.modelsLoaded) throw new Error("Cargando IA...");

                    const videoWidth = videoEl.videoWidth;
                    const videoHeight = videoEl.videoHeight;
                    canvasEl.width = videoWidth;
                    canvasEl.height = videoHeight;
                    const ctx = canvasEl.getContext('2d', { willReadFrequently: true });

                    ctx.translate(videoWidth, 0);
                    ctx.scale(-1, 1);
                    ctx.drawImage(videoEl, 0, 0, videoWidth, videoHeight);
                    ctx.setTransform(1, 0, 0, 1, 0, 0);

                    videoEl.pause();

                    faceStatus.textContent = 'Analizando...';

                    const detection = await faceapi.detectSingleFace(canvasEl).withFaceLandmarks().withFaceDescriptor();

                    if (!detection) throw new Error("No se detectó rostro.");
                    if (detection.detection.score < 0.6) throw new Error("Imagen borrosa. Repetir.");

                    if (window.currentUserFaceDescriptor) {
                        const distance = faceapi.euclideanDistance(window.currentUserFaceDescriptor, detection.descriptor);
                        if (distance > 0.55) throw new Error("Identidad no verificada.");
                    }

                    window.verifiedCanvas = canvasEl;

                    requestAnimationFrame(() => {
                        scanBtn.classList.add('hidden');
                        confirmBtn.classList.remove('hidden');
                        confirmBtn.disabled = false;
                        confirmBtn.focus();
                    });

                    faceStatus.innerHTML = '<span class="flex items-center justify-center gap-2"><i class="fa-solid fa-circle-check"></i> Identidad Confirmada</span>';
                    faceStatus.className = "text-sm font-bold text-green-600";

                    if (scannerLine) scannerLine.classList.add('hidden');

                    if (navigator.vibrate) navigator.vibrate(50);

                } catch (err) {
                    console.error(err);
                    videoEl.play();
                    if (scannerLine) scannerLine.classList.add('hidden');

                    faceStatus.textContent = err.message;
                    faceStatus.className = "text-sm font-bold text-red-500";

                    scanBtn.disabled = false;
                    scanBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> <span>Reintentar</span>';
                    window.verifiedCanvas = null;
                }
            }

            // Botón: Confirmar Check-in (AUTORIZAR AVANCE)
            if (target.id === 'checkin-confirm-btn') {
                const taskId = target.dataset.taskId;

                if (!window.verifiedCanvas) {
                    alert("Error de seguridad: No se ha verificado el rostro. Por favor, repite el escaneo.");
                    document.getElementById('checkin-take-photo-btn').classList.remove('hidden');
                    target.classList.add('hidden');
                    return;
                }

                // Cerrar modal e iniciar la callback inmediatamente
                localStorage.setItem('lastSafetyCheckIn', new Date().toISOString());

                if (window.videoStream) window.videoStream.getTracks().forEach(track => track.stop());
                document.getElementById('safety-checkin-modal').style.display = 'none';

                if (typeof window.onSafetyCheckInSuccess === 'function') {
                    window.onSafetyCheckInSuccess();
                }

                // Guardar la evidencia en segundo plano
                if (taskId) {
                    (async () => {
                        try {
                            const selfieBlob = await new Promise(resolve => window.verifiedCanvas.toBlob(resolve, 'image/jpeg', 0.80));
                            if (!selfieBlob) throw new Error("No se pudo obtener el blob de la imagen");

                            const timestamp = Date.now();
                            const selfiePath = `checkin_evidence/${taskId}/${window.currentUser.uid}_${timestamp}.jpg`;
                            const selfieStorageRef = ref(storage, selfiePath);

                            await uploadBytes(selfieStorageRef, selfieBlob);
                            const downloadURL = await getDownloadURL(selfieStorageRef);

                            await addDoc(collection(db, "tasks", taskId, "comments"), {
                                type: 'log',
                                text: `<b>Identidad Verificada.</b> El usuario autorizó un avance.`,
                                photoURL: downloadURL,
                                userId: window.currentUser.uid,
                                userName: `${window.usersMap.get(window.currentUser.uid)?.firstName || 'Usuario'} ${window.usersMap.get(window.currentUser.uid)?.lastName || ''}`,
                                createdAt: new Date()
                            });

                            console.log("Evidencia biométrica guardada en segundo plano correctamente.");
                        } catch (bgError) {
                            console.error("Error al guardar evidencia biométrica en segundo plano:", bgError);
                        }
                    })();
                }
            }

            if (target.id === 'safety-checkin-close-btn') {
                if (window.videoStream) window.videoStream.getTracks().forEach(track => track.stop());
                document.getElementById('safety-checkin-modal').style.display = 'none';
            }
            return;
        }

        // --- MANEJO DE CLICS QUE NO SON BOTONES DE ACCIÓN ---
        const inventoryTab = target.closest('.inventory-tab');
        if (inventoryTab) {
            const tabName = inventoryTab.dataset.tab;
            document.querySelectorAll('.inventory-tab-content').forEach(content => content.classList.add('hidden'));
            document.querySelectorAll('.inventory-tab').forEach(tab => tab.classList.remove('active'));
            const contentToShow = document.getElementById(`${tabName}-content`);
            if (contentToShow) contentToShow.classList.remove('hidden');
            inventoryTab.classList.add('active');
            return;
        }

        // Menú desplegable de pestañas de proyectos en Móvil
        const projectTabsDropdownBtn = target.closest('#project-tabs-dropdown-btn');
        const projectTabsDropdownMenu = document.getElementById('project-tabs-dropdown-menu');

        if (projectTabsDropdownBtn) {
            e.preventDefault();
            e.stopPropagation();
            if (projectTabsDropdownMenu) {
                projectTabsDropdownMenu.classList.toggle('hidden');
            }
            return;
        }

        const projectTabDropdownLink = target.closest('#dropdown-menu-items a[data-tab]');
        if (projectTabDropdownLink) {
            e.preventDefault();
            const tabName = projectTabDropdownLink.dataset.tab;
            if (typeof window.switchProjectTab === 'function') {
                window.switchProjectTab(tabName);
            }
            if (projectTabsDropdownMenu) {
                projectTabsDropdownMenu.classList.add('hidden');
            }
            return;
        }

        // Cerrar dropdown de pestañas de proyectos si se hace clic afuera
        if (projectTabsDropdownMenu && !projectTabsDropdownMenu.classList.contains('hidden') && !target.closest('#project-tabs-dropdown-btn') && !target.closest('#project-tabs-dropdown-menu')) {
            projectTabsDropdownMenu.classList.add('hidden');
        }

        const tabButton = target.closest('#project-details-tabs .tab-button');
        if (tabButton) {
            e.preventDefault();
            if (typeof window.switchProjectTab === 'function') {
                window.switchProjectTab(tabButton.dataset.tab);
            } else {
                console.error("window.switchProjectTab is not defined");
            }
            return;
        }

        if (target.dataset.action === 'view-image' && target.tagName === 'IMG') {
            window.openImageModal(target.getAttribute('src'));
            return;
        }

        const elementWithAction = target.closest('[data-action]');

        const uploadCard = target.closest('.document-upload-card[data-action="upload-doc"]');
        if (uploadCard && !target.closest('button')) {
            uploadCard.querySelector('input[type="file"]')?.click();
            return;
        }

        if (!elementWithAction) return;

        const action = elementWithAction.dataset.action;

        const toolActions = [
            'new-tool', 'edit-tool', 'delete-tool', 'assign-tool', 'return-tool', 'view-tool-history',
            'register-maintenance',
            'decommission-tool'
        ];
        if (toolActions.includes(action)) {
            return;
        }

        const elementId = elementWithAction.dataset.id || elementWithAction.dataset.corteId || elementWithAction.dataset.poId;
        const projectIdForTask = elementWithAction.dataset.projectId;
        const taskIdForProgress = elementWithAction.dataset.taskId;

        console.log(`Action: ${action}, ElementID: ${elementId}, ProjectID(Task): ${projectIdForTask}, TaskID(Progress): ${taskIdForProgress}`);

        const projectCard = elementWithAction.closest('.project-card');
        if (projectCard) {
            const projectId = projectCard.dataset.id;
            const projectName = projectCard.dataset.name;

            switch (action) {
                case 'view-details': {
                    const docSnap = await getDoc(doc(db, "projects", projectId));
                    if (docSnap.exists()) window.showProjectDetails({ id: docSnap.id, ...docSnap.data() });
                    break;
                }

                case 'edit-project-info': {
                    const loadingOverlay = document.getElementById('loading-overlay');
                    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
                    try {
                        const pDoc = await getDoc(doc(db, "projects", projectId));
                        if (pDoc.exists()) {
                            window.openMainModal('editProjectInfo', { id: pDoc.id, ...pDoc.data() });
                        }
                    } catch (error) {
                        console.error("Error al preparar edición del proyecto:", error);
                    } finally {
                        if (loadingOverlay) loadingOverlay.classList.add('hidden');
                    }
                    break;
                }

                case 'archive':
                    window.openConfirmModal(`¿Estás seguro de que quieres archivar el proyecto "${projectName}"?`, async () => {
                        try {
                            await window.archiveProject(projectId);
                            window.showToast("Proyecto archivado.", "success");
                            window.loadProjects('active');
                        } catch (err) {
                            alert("Error al archivar proyecto: " + err.message);
                        }
                    });
                    break;

                case 'restore':
                    window.openConfirmModal(`¿Restaurar el proyecto "${projectName}"?`, async () => {
                        try {
                            await window.restoreProject(projectId);
                            window.showToast("Proyecto restaurado.", "success");
                            window.loadProjects('archived');
                        } catch (err) {
                            alert("Error al restaurar proyecto: " + err.message);
                        }
                    });
                    break;

                case 'delete':
                    window.openConfirmModal(`⚠️ ¡ATENCIÓN! ¿Eliminar permanentemente "${projectName}"? Se borrarán todos los ítems y sub-ítems. Esta acción no se puede deshacer.`, async () => {
                        try {
                            await window.deleteProject(projectId);
                            window.showToast("Proyecto eliminado permanentemente.", "success");
                            window.loadProjects('active');
                        } catch (err) {
                            alert("Error al eliminar proyecto: " + err.message);
                        }
                    });
                    break;
            }
            return;
        }

        const projectItemsSection = elementWithAction.closest('#items-table-body, #sub-items-table-body');
        if (projectItemsSection) {
            const itemRow = elementWithAction.closest('tr[data-id]');
            const itemId = itemRow ? itemRow.dataset.id : elementId;
            if (!itemId) {
                console.error("No se pudo identificar el ID del ítem");
                return;
            }
            switch (action) {
                case 'view-item-details': {
                    const itemDoc = await getDoc(doc(db, "projects", window.currentProject.id, "items", itemId));
                    if (itemDoc.exists()) {
                        window.showSubItems({ id: itemDoc.id, ...itemDoc.data() });
                    }
                    break;
                }
                case 'edit-item': {
                    const itemDoc = await getDoc(doc(db, "projects", window.currentProject.id, "items", itemId));
                    if (itemDoc.exists()) {
                        window.openMainModal('editItem', { id: itemDoc.id, ...itemDoc.data() });
                    }
                    break;
                }
                case 'delete-item':
                    window.openConfirmModal(`¿Estás seguro de eliminar este ítem y todos sus sub-ítems?`, async () => {
                        try {
                            await window.deleteItem(itemId);
                            window.showToast("Ítem eliminado.", "success");
                        } catch (err) {
                            alert("Error al eliminar ítem: " + err.message);
                        }
                    });
                    break;
            }
            return;
        }

        switch (action) {
            case 'edit-profile': {
                if (window.usersMap && window.currentUser) {
                    const userData = window.usersMap.get(window.currentUser.uid);
                    if (userData) {
                        window.openMainModal('editProfile', userData);
                    } else {
                        console.error("Error: No se encontró la información del perfil del usuario.");
                    }
                }
                break;
            }
            case 'logout':
                if (typeof window.handleLogout === 'function') {
                    window.handleLogout();
                }
                break;
            case 'report-entry': {
                if (typeof window.handleReportEntry === 'function' && window.currentUser && window.usersMap) {
                    const userData = window.usersMap.get(window.currentUser.uid);
                    window.handleReportEntry(
                        db,
                        storage,
                        window.currentUser,
                        userData,
                        window.openMainModal,
                        window.closeMainModal
                    );
                } else {
                    console.error("Error: handleReportEntry or required globals not ready.");
                }
                break;
            }
            case 'new-project':
                window.openMainModal('newProject');
                break;
            case 'view-pending-loans':
                window.openMainModal('view-pending-loans');
                break;
            case 'new-tool':
                window.openMainModal('new-tool');
                break;
            case 'new-dotacion-catalog-item':
                window.openMainModal('new-dotacion-catalog-item');
                break;
            case 'add-catalog-item':
                window.openMainModal('add-catalog-item');
                break;
            case 'request-loan':
                window.openMainModal('request-loan');
                break;
            case 'go-to-proyectos':
                window.showView('proyectos');
                if (typeof window.loadProjects === 'function') window.loadProjects('active');
                break;
            case 'go-to-catalog':
                window.showView('catalog');
                if (typeof window.loadCatalogView === 'function') window.loadCatalogView();
                break;
            case 'go-to-herramientas':
                window.showView('herramienta');
                if (typeof window.resetToolViewAndLoad === 'function') window.resetToolViewAndLoad();
                break;
            case 'go-to-solicitudes':
                window.showView('solicitud');
                if (typeof window.loadSolicitudesView === 'function') window.loadSolicitudesView();
                break;
            case 'go-to-compras':
                window.showView('compras');
                if (typeof window.loadComprasView === 'function') window.loadComprasView();
                break;
            case 'create-daily-report':
                window.openMainModal('create-daily-report');
                break;
            case 'view-my-payment-history':
                window.openMainModal('view-my-payment-history', { userId: window.currentUser.uid });
                break;
            case 'send-admin-alert':
                window.openMainModal('send-admin-alert');
                break;
            case 'go-to-tareas':
                window.showView('tareas');
                window.loadTasksView();
                break;
            case 'go-to-dotacion':
                window.showView('dotacion');
                window.loadDotacionView();
                break;
            case 'view-empleado-details':
                window.showView('empleadoDetails');
                window.showEmpleadoDetails(elementId);
                break;
            case 'back-to-empleados':
                window.showView('empleados');
                window.loadEmpleadosView();
                break;
            case 'view-payment-history':
                window.showView('paymentHistory');
                window.loadPaymentHistoryView(elementId);
                break;
            case 'back-to-empleados-from-payment':
                window.showView('empleados');
                window.loadEmpleadosView();
                break;
            case 'delete-payment': {
                window.openConfirmModal("¿Eliminar este registro de abono?", async () => {
                    const loadingOverlay = document.getElementById('loading-overlay');
                    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
                    try {
                        const batch = writeBatch(db);
                        const paymentRef = doc(db, "projects", window.currentProject.id, "payments", elementId);
                        const paymentSnap = await getDoc(paymentRef);

                        if (paymentSnap.exists()) {
                            const paymentAmount = paymentSnap.data().amount || 0;
                            batch.delete(paymentRef);
                            batch.update(doc(db, "projects", window.currentProject.id), {
                                paidAmount: increment(-paymentAmount)
                            });
                            await batch.commit();
                            window.showToast("El pago ha sido eliminado correctamente.", "success");
                        }
                    } catch (error) {
                        console.error("Error al borrar abono:", error);
                        window.showToast("Error al eliminar el pago.", "error");
                    } finally {
                        if (loadingOverlay) loadingOverlay.classList.add('hidden');
                    }
                });
                break;
            }
            case 'renew-dotacion': {
                const button = elementWithAction;
                const dotacionId = button.dataset.dotacionId;
                const userId = button.dataset.userId;

                window.openConfirmModal("¿Marcar dotación como renovada (creará un registro idéntico con la fecha de hoy)?", async () => {
                    const loadingOverlay = document.getElementById('loading-overlay');
                    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
                    try {
                        const originalDoc = await getDoc(doc(db, "users", userId, "dotacionAsignada", dotacionId));
                        if (originalDoc.exists()) {
                            const originalData = originalDoc.data();
                            const newDotacion = {
                                ...originalData,
                                fechaEntrega: new Date().toISOString().split('T')[0],
                                assignedAt: new Date(),
                                assignedBy: window.currentUser.uid
                            };
                            await addDoc(collection(db, "users", userId, "dotacionAsignada"), newDotacion);
                            window.showToast("Dotación renovada exitosamente.", "success");
                            window.loadDotacionAsignaciones(userId, 'dotacion-history-container');
                        }
                    } catch (error) {
                        console.error("Error:", error);
                        window.showToast("Error al renovar dotación.", "error");
                    } finally {
                        if (loadingOverlay) loadingOverlay.classList.add('hidden');
                    }
                });
                break;
            }
            case 'open-loan-review':
                window.openMainModal('reviewLoan', { loanId: elementId, userId: elementWithAction.dataset.userId });
                break;

            case 'add-corte-payment':
                window.openMainModal('add-corte-payment', { corteId: elementId, corteNumber: elementWithAction.dataset.corteNumber });
                break;

            case 'view-request-details': {
                const requestId = elementWithAction.dataset.id;
                const projId = elementWithAction.dataset.projectId || (window.currentProject ? window.currentProject.id : null);
                if (requestId && projId) {
                    window.openRequestDetailsModal(requestId, projId);
                } else {
                    console.error("Falta ID de solicitud o proyecto");
                }
                break;
            }

            case 'approve-request': {
                const requestId = elementWithAction.dataset.id;
                const projectId = elementWithAction.dataset.projectId || (window.currentProject ? window.currentProject.id : null);
                if (!projectId) {
                    alert("Error: No se pudo identificar el proyecto de esta solicitud.");
                    break;
                }
                window.openConfirmModal('¿Aprobar esta solicitud de material?', async () => {
                    try {
                        const requestRef = doc(db, "projects", projectId, "materialRequests", requestId);
                        await updateDoc(requestRef, {
                            status: 'aprobado',
                            approvedAt: new Date(),
                            responsibleId: window.currentUser.uid
                        });
                        window.showToast("Solicitud aprobada.", "success");
                    } catch (e) {
                        console.error(e);
                        alert("Error al aprobar: " + e.message);
                    }
                });
                break;
            }

            case 'reject-request': {
                const requestId = elementWithAction.dataset.id;
                const projectId = elementWithAction.dataset.projectId || (window.currentProject ? window.currentProject.id : null);
                if (!projectId) {
                    alert("Error: No se pudo identificar el proyecto.");
                    break;
                }
                window.openConfirmModal('¿Rechazar esta solicitud?', async () => {
                    try {
                        const requestRef = doc(db, "projects", projectId, "materialRequests", requestId);
                        await updateDoc(requestRef, {
                            status: 'rechazado',
                            rejectedAt: new Date(),
                            responsibleId: window.currentUser.uid
                        });
                        window.showToast("Solicitud rechazada.", "success");
                    } catch (e) {
                        console.error(e);
                        alert("Error al rechazar: " + e.message);
                    }
                });
                break;
            }

            case 'deliver-material': {
                const requestId = elementWithAction.dataset.id;
                const projectId = elementWithAction.dataset.projectId || (window.currentProject ? window.currentProject.id : null);
                if (typeof window.openDeliveryModal === 'function') {
                    window.openDeliveryModal(requestId, projectId);
                } else {
                    console.error("openDeliveryModal no está disponible");
                }
                break;
            }

            case 'return-material': {
                const requestId = elementWithAction.dataset.id;
                const targetProjectId = elementWithAction.dataset.projectId || (window.currentProject ? window.currentProject.id : null);
                if (!targetProjectId) {
                    alert("Error: No se pudo identificar el proyecto asociado a esta solicitud.");
                    break;
                }

                const loadingOverlay = document.getElementById('loading-overlay');
                if (loadingOverlay) loadingOverlay.classList.remove('hidden');

                try {
                    const requestRef = doc(db, "projects", targetProjectId, "materialRequests", requestId);
                    const requestSnap = await getDoc(requestRef);

                    if (!requestSnap.exists()) throw new Error("La solicitud original no se encontró.");

                    const requestData = requestSnap.data();
                    let itemsInRequest = [];

                    if (Array.isArray(requestData.consumedItems)) {
                        itemsInRequest = requestData.consumedItems;
                    } else if (Array.isArray(requestData.materials)) {
                        itemsInRequest = requestData.materials;
                    } else if (requestData.materialId && requestData.quantity) {
                        itemsInRequest = [{ materialId: requestData.materialId, quantity: requestData.quantity }];
                    }

                    if (itemsInRequest.length === 0) throw new Error("Esta solicitud no contiene ítems válidos para devolver.");

                    const materialPromises = itemsInRequest.map(m =>
                        m.materialId ? getDoc(doc(db, "materialCatalog", m.materialId)) : Promise.resolve(null)
                    );

                    const materialSnapshots = await Promise.all(materialPromises);

                    const materialsWithDetails = materialSnapshots.map((snap, index) => {
                        return (snap && snap.exists())
                            ? { ...itemsInRequest[index], ...snap.data() }
                            : null;
                    }).filter(m => m);

                    if (materialsWithDetails.length === 0) throw new Error("No se pudieron encontrar los materiales originales en el catálogo.");

                    window.openMainModal('return-material', {
                        request: { id: requestId, ...requestData },
                        materials: materialsWithDetails,
                        projectId: targetProjectId
                    });

                    const form = document.getElementById('modal-form');
                    if (form) {
                        form.dataset.projectId = targetProjectId;
                        form.dataset.id = requestId;
                    }

                } catch (error) {
                    console.error("Error al preparar devolución:", error);
                    alert("Error: " + error.message);
                } finally {
                    if (loadingOverlay) loadingOverlay.classList.add('hidden');
                }
                break;
            }

            case 'view-task-details': {
                const taskId = elementId;
                if (taskId) {
                    window.openTaskDetailsModal(taskId);
                } else {
                    console.error("view-task-details: elementId is missing.");
                }
                break;
            }

            case 'edit-task': {
                const taskId = elementId;
                if (taskId) {
                    if (elementWithAction.closest('#task-details-modal')) {
                        window.closeTaskDetailsModal();
                    }
                    window.openEditTaskModal({ id: taskId });
                } else {
                    console.error("edit-task: elementId is missing.");
                }
                break;
            }

            case 'complete-task': {
                const taskId = elementId;
                if (taskId) {
                    window.openConfirmModal("¿Marcar esta tarea como completada?", async () => {
                        await window.completeTask(taskId);
                    });
                } else {
                    console.error("complete-task: elementId is missing.");
                }
                break;
            }

            case 'register-task-progress': {
                const taskId = taskIdForProgress || elementId;
                if (taskId) {
                    if (elementWithAction.closest('#task-details-modal')) {
                        window.closeTaskDetailsModal();
                    }

                    if (typeof window.checkIfSafetyCheckInNeeded === 'function' && window.checkIfSafetyCheckInNeeded()) {
                        window.openSafetyCheckInModal(() => {
                            window.openMultipleProgressModal(taskId);
                        }, taskId);
                    } else {
                        window.openMultipleProgressModal(taskId);
                    }
                } else {
                    console.error("register-task-progress: taskId is missing.");
                }
                break;
            }

            case 'request-material':
            case 'request-material-from-task': {
                const loadingOverlay = document.getElementById('loading-overlay');
                if (loadingOverlay) loadingOverlay.classList.remove('hidden');
                try {
                    const isFromTask = (action === 'request-material-from-task');
                    const projectId = projectIdForTask || window.currentProject?.id;
                    const taskId = taskIdForProgress || elementId;

                    if (!projectId) {
                        alert("Error: No se pudo identificar el ID del proyecto.");
                        return;
                    }

                    // Cargar el proyecto si no está en el window o si es diferente
                    if (!window.currentProject || window.currentProject.id !== projectId) {
                        const projDoc = await getDoc(doc(db, "projects", projectId));
                        if (projDoc.exists()) {
                            window.currentProject = { id: projDoc.id, ...projDoc.data() };
                        } else {
                            throw new Error("No se encontró el proyecto.");
                        }
                    }

                    let taskItems = null;
                    if (isFromTask && taskId) {
                        const taskSnap = await getDoc(doc(db, "tasks", taskId));
                        if (taskSnap.exists()) {
                            const taskData = taskSnap.data();
                            taskItems = taskData.selectedItems || null;
                        }
                    } else if (projectIdForTask && elementWithAction.closest('#task-details-modal')) {
                        // Si viene del modal de detalles de tarea
                        const taskDetailsModal = elementWithAction.closest('#task-details-modal');
                        const modalTaskId = taskDetailsModal.dataset.taskId || taskId;
                        if (modalTaskId) {
                            const taskSnap = await getDoc(doc(db, "tasks", modalTaskId));
                            if (taskSnap.exists()) {
                                taskItems = taskSnap.data().selectedItems || null;
                            }
                        }
                    }

                    const isInsideModal = !!elementWithAction.closest('#task-details-modal');
                    if (isFromTask && taskId) {
                        window.materialRequestReturnContext = {
                            view: isInsideModal ? 'detalle-tarea' : 'tareas',
                            taskId: taskId
                        };
                    }

                    // Establecer el contexto de retorno en solicitudes.js
                    if (typeof window.showMaterialRequestView === 'function') {
                        // Ejecutar la vista
                        await window.showMaterialRequestView(taskItems);

                        // Establecer el taskId en el input
                        const taskIdInput = document.getElementById('material-request-task-id');
                        if (taskIdInput) {
                            taskIdInput.value = isFromTask ? taskId : (isInsideModal ? (elementWithAction.closest('#task-details-modal')?.dataset.taskId || '') : '');
                        }

                        // Cerrar el modal de detalle de tarea si estaba abierto
                        if (isInsideModal && typeof window.closeTaskDetailsModal === 'function') {
                            window.closeTaskDetailsModal();
                        }
                    } else {
                        console.error("window.showMaterialRequestView is not defined");
                    }
                } catch (error) {
                    console.error("Error al preparar la solicitud de material:", error);
                    alert("Error al cargar los datos necesarios: " + error.message);
                } finally {
                    if (loadingOverlay) loadingOverlay.classList.add('hidden');
                }
                break;
            }
            case 'edit-project-info': {
                const loadingOverlay = document.getElementById('loading-overlay');
                if (loadingOverlay) loadingOverlay.classList.remove('hidden');
                try {
                    const projectId = window.currentProject?.id || elementId;
                    if (!projectId) throw new Error("No se pudo identificar el ID del proyecto.");
                    const pDoc = await getDoc(doc(db, "projects", projectId));
                    if (pDoc.exists()) {
                        window.openMainModal('editProjectInfo', { id: pDoc.id, ...pDoc.data() });
                    }
                } catch (error) {
                    console.error("Error al preparar edición del proyecto:", error);
                } finally {
                    if (loadingOverlay) loadingOverlay.classList.add('hidden');
                }
                break;
            }

            case 'add-interest-person':
                window.openMainModal('addInterestPerson');
                break;

            case 'delete-interest-person':
                window.openConfirmModal("¿Seguro que quieres eliminar a esta persona?", async () => {
                    try {
                        await deleteDoc(doc(db, "projects", window.currentProject.id, "peopleOfInterest", elementId));
                        window.showToast("Persona eliminada.", "success");
                    } catch (e) {
                        alert("Error al eliminar: " + e.message);
                    }
                });
                break;

            case 'add-item':
                window.openMainModal('addItem');
                break;

            case 'import-items': {
                const importModal = document.getElementById('import-modal');
                if (importModal) {
                    importModal.classList.remove('hidden');
                    importModal.classList.add('flex');
                }
                break;
            }

            case 'export-pdf':
                if (typeof window.exportProjectToPDF === 'function') {
                    window.exportProjectToPDF();
                } else {
                    console.error("window.exportProjectToPDF is not defined");
                }
                break;

            case 'add-other-payment':
                window.openMainModal('add-other-payment');
                break;

            case 'set-corte-type': {
                const type = elementWithAction.dataset.type;
                document.querySelectorAll('.corte-type-btn').forEach(btn => {
                    const isSelected = btn.dataset.type === type;
                    btn.classList.toggle('bg-blue-500', isSelected);
                    btn.classList.toggle('text-white', isSelected);
                    btn.classList.toggle('bg-gray-200', !isSelected);
                    btn.classList.toggle('text-gray-700', !isSelected);
                });
                if (typeof window.setupCorteSelection === 'function') {
                    window.setupCorteSelection(type);
                } else {
                    console.error("window.setupCorteSelection is not defined");
                }
                break;
            }

            case 'generate-corte':
                if (typeof window.generateCorte === 'function') {
                    window.generateCorte();
                } else {
                    console.error("window.generateCorte is not defined");
                }
                break;

            case 'cancel-corte-selection':
                if (typeof window.closeCorteSelectionView === 'function') {
                    window.closeCorteSelectionView();
                } else {
                    console.error("window.closeCorteSelectionView is not defined");
                }
                break;

            case 'view-corte-details':
            case 'approve-corte':
            case 'deny-corte':
            case 'export-corte-pdf': {
                const projectId = window.currentProject?.id;
                if (!projectId) {
                    console.error("No current project ID found");
                    break;
                }
                const corteRef = doc(db, "projects", projectId, "cortes", elementId);
                const corteSnap = await getDoc(corteRef);
                if (corteSnap.exists()) {
                    const corteData = { id: corteSnap.id, ...corteSnap.data() };
                    if (action === 'view-corte-details') {
                        if (typeof window.showCorteDetails === 'function') {
                            window.showCorteDetails(corteData);
                        }
                    }
                    if (action === 'approve-corte') {
                        window.openConfirmModal("¿Aprobar este corte?", async () => {
                            if (typeof window.approveCorte === 'function') {
                                await window.approveCorte(projectId, elementId);
                                window.showToast("Corte aprobado.", "success");
                            }
                        });
                    }
                    if (action === 'deny-corte') {
                        window.openConfirmModal("¿Denegar y eliminar este corte?", async () => {
                            if (typeof window.denyCorte === 'function') {
                                await window.denyCorte(projectId, elementId);
                                window.showToast("Corte denegado y eliminado.", "success");
                            }
                        });
                    }
                    if (action === 'export-corte-pdf') {
                        if (typeof window.exportCorteToPDF === 'function') {
                            window.exportCorteToPDF(window.currentProject, corteData, elementWithAction.dataset.type);
                        }
                    }
                }
                break;
            }
            case 'new-purchase-order': {
                const loadingOverlay = document.getElementById('loading-overlay');
                if (loadingOverlay) loadingOverlay.classList.remove('hidden');
                try {
                    const [catalogSnapshot, suppliersSnapshot] = await Promise.all([
                        getDocs(query(collection(db, "materialCatalog"))),
                        getDocs(query(collection(db, "suppliers"), orderBy("name")))
                    ]);

                    const catalog = catalogSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    const suppliers = suppliersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                    window.openMainModal('new-purchase-order', { catalog, suppliers });

                } catch (error) {
                    console.error("Error al preparar la PO:", error);
                    alert("Error al cargar los datos necesarios: " + error.message);
                } finally {
                    if (loadingOverlay) loadingOverlay.classList.add('hidden');
                }
                break;
            }
            case 'close-details-modal':
                if (typeof window.closeRequestDetailsModal === 'function') {
                    window.closeRequestDetailsModal();
                }
                if (typeof window.closePurchaseOrderModal === 'function') {
                    window.closePurchaseOrderModal();
                }
                break;

            case 'back-to-dashboard':
                window.showView('proyectos');
                if (typeof window.loadProjects === 'function') {
                    window.loadProjects('active');
                }
                break;

            case 'back-to-project': {
                const returnCtx = window.materialRequestReturnContext;
                const isFromTasks = returnCtx && (returnCtx.view === 'tareas' || returnCtx.view === 'detalle-tarea');

                if (isFromTasks) {
                    window.showView('tareas');
                    if (typeof window.loadTasksView === 'function') {
                        window.loadTasksView();
                    }
                    if (returnCtx.view === 'detalle-tarea' && returnCtx.taskId && typeof window.openTaskDetailsModal === 'function') {
                        window.openTaskDetailsModal(returnCtx.taskId);
                    }
                } else if (window.currentUserRole === 'admin' && window.currentProject) {
                    const isMaterialRequest = !document.getElementById('material-request-view')?.classList.contains('hidden');
                    window.showProjectDetails(window.currentProject, isMaterialRequest ? 'materiales' : 'items');
                } else {
                    if (returnCtx && returnCtx.view && window.currentUserRole === 'admin') {
                        window.showView(returnCtx.view);
                        if (returnCtx.view === 'tareas' && typeof window.loadTasksView === 'function') {
                            window.loadTasksView();
                        }
                    } else {
                        window.showView('dashboard-general');
                        if (typeof window.showGeneralDashboard === 'function') {
                            window.showGeneralDashboard();
                        }
                    }
                }
                
                // Limpiar contexto de retorno al salir
                window.materialRequestReturnContext = { view: 'proyectos' };
                break;
            }

            case 'new-supplier':
                window.openMainModal('new-supplier');
                break;

            case 'edit-supplier': {
                const supplierId = elementId || window.currentSupplierId;
                if (!supplierId) {
                    console.error("No se especificó ID de proveedor para editar");
                    break;
                }
                const loadingOverlay = document.getElementById('loading-overlay');
                if (loadingOverlay) loadingOverlay.classList.remove('hidden');
                try {
                    const supDoc = await getDoc(doc(db, "suppliers", supplierId));
                    if (supDoc.exists()) {
                        window.openMainModal('edit-supplier', { id: supDoc.id, ...supDoc.data() });
                    } else {
                        console.error("Proveedor no encontrado:", supplierId);
                    }
                } catch (error) {
                    console.error("Error al cargar proveedor para edición:", error);
                } finally {
                    if (loadingOverlay) loadingOverlay.classList.add('hidden');
                }
                break;
            }

            case 'quick-pay-supplier': {
                window.currentSupplierId = elementId;
                window.openMainModal('new-supplier-payment');
                break;
            }

            case 'new-supplier-payment': {
                if (elementId) {
                    window.currentSupplierId = elementId;
                }
                window.openMainModal('new-supplier-payment');
                break;
            }

            case 'view-supplier-details': {
                if (typeof window.loadSupplierDetailsView === 'function') {
                    window.loadSupplierDetailsView(elementId);
                } else {
                    console.error("loadSupplierDetailsView no está definido");
                }
                break;
            }

            case 'back-to-suppliers':
                window.showView('proveedores');
                if (typeof window.loadProveedoresView === 'function') {
                    window.loadProveedoresView();
                }
                break;

            case 'view-purchase-order': {
                if (typeof window.openPurchaseOrderModal === 'function') {
                    window.openPurchaseOrderModal(elementId);
                } else {
                    console.error("openPurchaseOrderModal no está definido");
                }
                break;
            }

            case 'delete-supplier-payment': {
                const paymentId = elementId;
                const supplierId = window.currentSupplierId;
                if (!supplierId || !paymentId) break;

                window.openConfirmModal("¿Eliminar este registro de pago al proveedor? Esto borrará el registro del historial.", async () => {
                    const loadingOverlay = document.getElementById('loading-overlay');
                    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
                    try {
                        const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
                        await deleteDoc(doc(db, "suppliers", supplierId, "payments", paymentId));
                        window.showToast("El registro de pago ha sido eliminado.", "success");
                    } catch (error) {
                        console.error("Error al borrar pago de proveedor:", error);
                        window.showToast("Error al eliminar el pago.", "error");
                    } finally {
                        if (loadingOverlay) loadingOverlay.classList.add('hidden');
                    }
                });
                break;
            }

            case 'receive-purchase-order': {
                const poId = elementId;
                if (!poId) break;
                const poRef = doc(db, "purchaseOrders", poId);
                const loadingOverlay = document.getElementById('loading-overlay');
                if (loadingOverlay) loadingOverlay.classList.remove('hidden');

                try {
                    const { runTransaction } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
                    await runTransaction(db, async (transaction) => {
                        const poDoc = await transaction.get(poRef);
                        if (!poDoc.exists() || poDoc.data().status !== 'pendiente') {
                            throw new Error("Esta orden ya fue procesada o no existe.");
                        }

                        for (const item of poDoc.data().items) {
                            let collectionName = 'materialCatalog';
                            if (item.itemType === 'dotacion') collectionName = 'dotacionCatalog';
                            if (item.itemType === 'herramienta') collectionName = 'tools';

                            const materialRef = doc(db, collectionName, item.materialId);
                            const materialDoc = await transaction.get(materialRef);
                            if (materialDoc.exists()) {
                                const newStock = (materialDoc.data().quantityInStock || 0) + item.quantity;
                                transaction.update(materialRef, { quantityInStock: newStock });
                            }
                        }

                        transaction.update(poRef, { 
                            status: 'recibida', 
                            receivedAt: new Date(), 
                            receivedBy: window.currentUser.uid 
                        });
                    });
                    window.showToast("¡Orden de compra recibida y stock actualizado con éxito!", "success");
                    if (typeof window.closePurchaseOrderModal === 'function') {
                        window.closePurchaseOrderModal();
                    }
                    if (typeof window.loadComprasView === 'function') {
                        window.loadComprasView();
                    }
                    if (window.currentSupplierId) {
                        window.loadSupplierDetailsView(window.currentSupplierId);
                    }
                } catch (error) {
                    console.error("Error al recibir la orden de compra:", error);
                    window.showToast("Error: " + error.message, "error");
                } finally {
                    if (loadingOverlay) loadingOverlay.classList.add('hidden');
                }
                break;
            }

            case 'reject-purchase-order': {
                const poId = elementId;
                if (!poId) break;
                window.openConfirmModal("¿Estás seguro de que quieres rechazar esta orden de compra?", async () => {
                    const loadingOverlay = document.getElementById('loading-overlay');
                    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
                    try {
                        await updateDoc(doc(db, "purchaseOrders", poId), {
                            status: 'anulada',
                            rejectedAt: new Date(),
                            rejectedBy: window.currentUser.uid
                        });
                        window.showToast("Orden de compra anulada.", "success");
                        if (typeof window.closePurchaseOrderModal === 'function') {
                            window.closePurchaseOrderModal();
                        }
                        if (typeof window.loadComprasView === 'function') {
                            window.loadComprasView();
                        }
                        if (window.currentSupplierId) {
                            window.loadSupplierDetailsView(window.currentSupplierId);
                        }
                    } catch (error) {
                        console.error("Error al anular orden de compra:", error);
                        window.showToast("Error al anular la orden.", "error");
                    } finally {
                        if (loadingOverlay) loadingOverlay.classList.add('hidden');
                    }
                });
                break;
            }

            case 'edit-catalog-item': {
                const loadingOverlay = document.getElementById('loading-overlay');
                if (loadingOverlay) loadingOverlay.classList.remove('hidden');
                try {
                    const matDoc = await getDoc(doc(db, "materialCatalog", elementId));
                    if (matDoc.exists()) {
                        window.openMainModal('edit-catalog-item', { id: matDoc.id, ...matDoc.data() });
                    } else {
                        console.error("Material no encontrado:", elementId);
                    }
                } catch (error) {
                    console.error("Error al cargar material para edición:", error);
                } finally {
                    if (loadingOverlay) loadingOverlay.classList.add('hidden');
                }
                break;
            }

            case 'compare-prices': {
                const loadingOverlay = document.getElementById('loading-overlay');
                if (loadingOverlay) loadingOverlay.classList.remove('hidden');
                try {
                    const matDoc = await getDoc(doc(db, "materialCatalog", elementId));
                    if (matDoc.exists()) {
                        const matData = matDoc.data();
                        window.openMainModal('compare-prices', { 
                            materialId: matDoc.id, 
                            name: matData.name, 
                            basePrice: matData.basePrice,
                            assignedSupplierName: matData.assignedSupplierName
                        });
                    } else {
                        console.error("Material no encontrado:", elementId);
                    }
                } catch (error) {
                    console.error("Error al cargar material para comparación:", error);
                } finally {
                    if (loadingOverlay) loadingOverlay.classList.add('hidden');
                }
                break;
            }

            case 'close-task-details':
                if (elementWithAction.id === 'task-details-modal' && target.id !== 'task-details-modal') {
                    // Clic dentro del modal, ignorar
                } else {
                    window.closeTaskDetailsModal();
                }
                break;
        }

        if (target.id === 'request-details-close-btn' || target.id === 'request-details-cancel-btn') {
            window.closeRequestDetailsModal();
        }
    });

    // Import Items Modal Event Listeners
    const importModal = document.getElementById('import-modal');
    
    document.getElementById('import-modal-cancel-btn')?.addEventListener('click', () => {
        if (importModal) {
            importModal.classList.add('hidden');
            importModal.classList.remove('flex');
        }
    });

    document.getElementById('import-modal-close-icon')?.addEventListener('click', () => {
        if (importModal) {
            importModal.classList.add('hidden');
            importModal.classList.remove('flex');
        }
    });

    document.getElementById('download-template-btn')?.addEventListener('click', async () => {
        try {
            const XLSX = await window.ensureXLSX();
            const wb = XLSX.utils.book_new();

            // --- HOJA 1: INSTRUCCIONES ---
            const instructions = [
                ["Columna", "Descripción y Ejemplo"],
                ["Nombre del Ítem", "Nombre descriptivo del objeto. Ej: 'Ventana Sala'"],
                ["Cantidad", "Número total de unidades de este ítem. Ej: 5"],
                ["Ancho (cm)", "Ancho en centímetros (número entero). Ej: 150"],
                ["Alto (cm)", "Alto en centímetros (número entero). Ej: 220"],
            ];

            // --- HOJA 2: PLANTILLA PARA LLENAR (DINÁMICA) ---
            let exampleData = [];
            const projectPricingModel = window.currentProject?.pricingModel || 'separado';

            if (projectPricingModel === 'incluido') {
                instructions.push(
                    ["Precio Unitario (Incluido)", "Costo total por unidad, SIN impuestos. Ej: 200000"],
                    ["Impuesto", "Opciones válidas: IVA, AIU, Ninguno"],
                    ["AIU Admin %", "Llenar solo si el impuesto es AIU. Ingresar solo el número (sin %). Ej: 10"],
                    ["AIU Imprev %", "Llenar solo si el impuesto es AIU. Ingresar solo el número (sin %). Ej: 5"],
                    ["AIU Utilidad %", "Llenar solo si el impuesto es AIU. Ingresar solo el número (sin %). Ej: 5"]
                );

                exampleData = [{
                    'Nombre del Ítem': "Ventana Fija Baño",
                    'Cantidad': 2,
                    'Ancho (cm)': 80,
                    'Alto (cm)': 60,
                    'Precio Unitario (Incluido)': 200000,
                    'Impuesto': "IVA",
                    'AIU Admin %': null,
                    'AIU Imprev %': null,
                    'AIU Utilidad %': null
                }];
            } else {
                instructions.push(
                    ["Precio Suministro (Unitario)", "Costo del material por unidad, SIN impuestos."],
                    ["Impuesto Suministro", "Opciones válidas: IVA, AIU, Ninguno"],
                    ["AIU Admin % (Suministro)", "Llenar solo si el impuesto es AIU."],
                    ["AIU Imprev % (Suministro)", "Llenar solo si el impuesto es AIU."],
                    ["AIU Utilidad % (Suministro)", "Llenar solo si el impuesto es AIU."],
                    ["Precio Instalación (Unitario)", "Costo de mano de obra por unidad, SIN impuestos."],
                    ["Impuesto Instalación", "Opciones válidas: IVA, AIU, Ninguno"],
                    ["AIU Admin % (Instalación)", "Llenar solo si el impuesto es AIU."],
                    ["AIU Imprev % (Instalación)", "Llenar solo si el impuesto es AIU."],
                    ["AIU Utilidad % (Instalación)", "Llenar solo si el impuesto es AIU."]
                );

                exampleData = [{
                    'Nombre del Ítem': "Ventana Corrediza Sala",
                    'Cantidad': 5,
                    'Ancho (cm)': 150,
                    'Alto (cm)': 120,
                    'Precio Suministro (Unitario)': 150000,
                    'Impuesto Suministro': "AIU",
                    'AIU Admin % (Suministro)': 5,
                    'AIU Imprev % (Suministro)': 2,
                    'AIU Utilidad % (Suministro)': 10,
                    'Precio Instalación (Unitario)': 50000,
                    'Impuesto Instalación': "IVA",
                    'AIU Admin % (Instalación)': null,
                    'AIU Imprev % (Instalación)': null,
                    'AIU Utilidad % (Instalación)': null
                }];
            }

            const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
            wsInstructions['!cols'] = [{ wch: 30 }, { wch: 80 }];
            XLSX.utils.book_append_sheet(wb, wsInstructions, "Instrucciones");

            const wsData = XLSX.utils.json_to_sheet(exampleData);
            wsData['!cols'] = Array(Object.keys(exampleData[0]).length).fill({ wch: 25 });
            XLSX.utils.book_append_sheet(wb, wsData, "Plantilla Items");

            XLSX.writeFile(wb, `Plantilla_Items_${(window.currentProject?.name || 'proyecto').replace(/\s/g, '_')}.xlsx`);
        } catch (error) {
            console.error("Error al descargar la plantilla:", error);
            alert("Error al descargar la plantilla. Verifique la conexión o intente nuevamente.");
        }
    });

    document.getElementById('import-modal-confirm-btn')?.addEventListener('click', async () => {
        const fileInput = document.getElementById('excel-file-input');
        const feedbackDiv = document.getElementById('import-feedback');
        if (!fileInput || fileInput.files.length === 0) {
            if (feedbackDiv) feedbackDiv.textContent = 'Por favor, selecciona un archivo.';
            return;
        }

        try {
            const XLSX = await window.ensureXLSX();
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheet = workbook.Sheets["Plantilla Items"];
                    if (!sheet) {
                        if (feedbackDiv) feedbackDiv.textContent = 'Error: No se encontró la hoja "Plantilla Items".';
                        return;
                    }
                    const json = XLSX.utils.sheet_to_json(sheet);

                    if (feedbackDiv) feedbackDiv.textContent = `Importando ${json.length} ítems...`;
                    const projectPricingModel = window.currentProject?.pricingModel || 'separado';

                    for (const row of json) {
                        if (!row['Nombre del Ítem'] || !row['Cantidad'] || !row['Ancho (cm)'] || !row['Alto (cm)']) {
                            console.warn("Fila omitida por falta de datos básicos (Nombre, Cantidad, Ancho, Alto):", row);
                            continue;
                        }

                        const itemData = {
                            name: row['Nombre del Ítem'],
                            quantity: parseInt(row['Cantidad'], 10) || 1,
                            width: (parseFloat(row['Ancho (cm)']) / 100) || 0,
                            height: (parseFloat(row['Alto (cm)']) / 100) || 0,
                        };

                        if (projectPricingModel === 'incluido') {
                            itemData.itemType = 'suministro_instalacion_incluido';
                            itemData.included_unitPrice = String(row['Precio Unitario (Incluido)'] || 0);
                            itemData.included_taxType = (row['Impuesto'] || 'none').toLowerCase();
                            itemData.included_aiuA = parseFloat(row['AIU Admin %']) || 0;
                            itemData.included_aiuI = parseFloat(row['AIU Imprev %']) || 0;
                            itemData.included_aiuU = parseFloat(row['AIU Utilidad %']) || 0;
                        } else {
                            itemData.itemType = 'suministro_instalacion';
                            itemData.supply_unitPrice = String(row['Precio Suministro (Unitario)'] || 0);
                            itemData.supply_taxType = (row['Impuesto Suministro'] || 'none').toLowerCase();
                            itemData.supply_aiuA = parseFloat(row['AIU Admin % (Suministro)']) || 0;
                            itemData.supply_aiuI = parseFloat(row['AIU Imprev % (Suministro)']) || 0;
                            itemData.supply_aiuU = parseFloat(row['AIU Utilidad % (Suministro)']) || 0;
                            
                            itemData.installation_unitPrice = String(row['Precio Instalación (Unitario)'] || 0);
                            itemData.installation_taxType = (row['Impuesto Instalación'] || 'none').toLowerCase();
                            itemData.installation_aiuA = parseFloat(row['AIU Admin % (Instalación)']) || 0;
                            itemData.installation_aiuI = parseFloat(row['AIU Imprev % (Instalación)']) || 0;
                            itemData.installation_aiuU = parseFloat(row['AIU Utilidad % (Instalación)']) || 0;
                        }

                        await window.createItem(itemData);
                    }

                    if (feedbackDiv) feedbackDiv.textContent = '¡Importación completada!';
                    setTimeout(() => {
                        if (importModal) {
                            importModal.classList.add('hidden');
                            importModal.classList.remove('flex');
                        }
                        if (feedbackDiv) feedbackDiv.textContent = '';
                        fileInput.value = '';
                    }, 2000);

                } catch (error) {
                    console.error("Error al importar el archivo:", error);
                    if (feedbackDiv) feedbackDiv.textContent = 'Error al procesar el archivo. Verifique el formato.';
                }
            };
            reader.readAsArrayBuffer(fileInput.files[0]);
        } catch (error) {
            console.error("Error al cargar XLSX:", error);
            if (feedbackDiv) feedbackDiv.textContent = 'Error al cargar la librería XLSX.';
        }
    });
}
