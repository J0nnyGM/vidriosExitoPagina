// js/ui/form-handlers.js

import { db, auth, storage, httpsCallable } from '../core/firebase-config.js';
import { doc, getDoc, setDoc, addDoc, updateDoc, collection, query, where, writeBatch, getDocs, orderBy, increment, serverTimestamp, arrayUnion, runTransaction } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { isUserIncapacitatedOnDate } from '../core/utils.js';

export function initFormHandlers() {
    const modalForm = document.getElementById('modal-form');
    if (!modalForm) return;

    // Remove any existing submit listeners if needed (in standard SPA, since we load once, it is fine)
    document.getElementById('modal-cancel-btn')?.addEventListener('click', window.closeMainModal);

    modalForm.addEventListener('submit', async (e) => {
        // 1. ¡LO MÁS IMPORTANTE! Evitar recarga de página
        e.preventDefault();

        const modalConfirmBtn = document.getElementById('modal-confirm-btn');
        const data = Object.fromEntries(new FormData(modalForm).entries());
        const type = modalForm.dataset.type;
        const id = modalForm.dataset.id;

        // Filtro para modales que NO usan este submit (sino lógica propia interna)
        if (['new-tool', 'edit-tool', 'assign-tool', 'return-tool', 'register-maintenance', 'new-dotacion-catalog-item', 'add-dotacion-stock', 'register-dotacion-delivery', 'return-dotacion-options'].includes(type)) {
            return;
        }

        // --- CASO: GENERAR CERTIFICACIÓN (PDF) ---
        if (type === 'generate-certification') {
            const includeSalary = document.getElementById('include-salary').checked;
            const includeLogo = document.getElementById('include-logo').checked;

            window.generateLaborCertificate({
                fullName: data.fullName,
                idNumber: data.idNumber,
                startDate: data.startDate,
                endDate: data.endDate,
                jobTitle: data.jobTitle,
                salary: parseFloat(data.salarioBasico),
                includeSalary: includeSalary,
                includeLogo: includeLogo
            });

            window.closeMainModal();
            return;
        }

        if (type === 'init-project-from-quote') {
            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = 'Creando Proyecto...';

            try {
                // 1. Obtener la configuración original de la cotización
                const configJson = document.getElementById('hidden-quote-config').value;
                const quoteConfig = JSON.parse(configJson);
                const quoteMode = quoteConfig.modo || 'MIXTO';
                const quoteAiu = quoteConfig.aiu || { admin: 10, imprev: 5, util: 5 };

                // 2. Crear el documento del Proyecto
                const projectData = {
                    name: data.name,
                    builderName: data.builderName,
                    location: data.location || '',
                    address: data.address || '',
                    value: Math.round(parseFloat(data.value.replace(/[$. ]/g, '')) || 0),
                    advance: parseFloat(data.advance.replace(/[$. ]/g, '')) || 0,
                    startDate: data.startDate,
                    pricingModel: document.querySelector('select[name="pricingModel"]').value,
                    status: 'active',
                    ownerId: window.currentUser.uid,
                    createdAt: new Date()
                };

                const projectRef = await addDoc(collection(db, "projects"), projectData);
                console.log("Proyecto creado con ID:", projectRef.id);

                // 3. Importar Ítems y Crear Sub-ítems
                const itemsJson = document.getElementById('hidden-quote-items').value;
                const items = JSON.parse(itemsJson);

                if (items && items.length > 0) {
                    modalConfirmBtn.textContent = `Importando ${items.length} ítems...`;

                    const parseImportMoney = (val) => {
                        if (!val) return 0;
                        return parseFloat(String(val).replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;
                    };

                    for (const item of items) {
                        const itemName = item.item_id || item.id || item.referencia || 'Ítem sin nombre';
                        const itemQty = parseInt(item.cantidad) || 1;
                        const itemDescription = item.descripcion || (item.ubicacion ? `Ubicación: ${item.ubicacion}` : '');

                        // 1. DIMENSIONES
                        const widthM = parseFloat(String(item.ancho).replace(',', '.')) || 0;
                        const heightM = parseFloat(String(item.alto).replace(',', '.')) || 0;

                        // A. Precio Bruto (Con todos los impuestos sumados)
                        let rowTotalBruto = parseImportMoney(item.valor_total || item.total || item.precio_total);

                        if (rowTotalBruto <= 0) {
                            const unitM2Bruto = parseImportMoney(item.valor_unitario || item.val_suministro);
                            const area = (widthM * heightM) || 1;
                            rowTotalBruto = unitM2Bruto * area * itemQty;
                        }

                        const precioUnitarioBruto = rowTotalBruto / itemQty;

                        // B. Calcular el Divisor Exacto
                        let taxDivisor = 1;

                        if (quoteMode === 'AIU' && quoteAiu) {
                            const adm = parseFloat(quoteAiu.admin) || 0;
                            const imp = parseFloat(quoteAiu.imprev) || 0;
                            const uti = parseFloat(quoteAiu.util) || 0;

                            const factorAIU = (adm + imp + uti) / 100;
                            const factorIvaSobreUtilidad = (uti / 100) * 0.19;

                            taxDivisor = 1 + factorAIU + factorIvaSobreUtilidad;

                        } else if (quoteMode === 'STD' || quoteMode === 'IVA' || quoteMode === 'IVA_GLOBAL' || quoteMode === 'MIXTO') {
                            taxDivisor = 1.19;
                        } else if (quoteMode === 'SOLO_TOTAL') {
                            taxDivisor = 1.0;
                        }

                        const finalUnitPriceBase = Math.round(precioUnitarioBruto / taxDivisor);

                        const itemData = {
                            name: itemName,
                            description: itemDescription,
                            width: widthM, height: heightM,
                            quantity: itemQty,
                            projectId: projectRef.id,
                            createdAt: new Date()
                        };

                        if (projectData.pricingModel === 'incluido') {
                            itemData.itemType = 'suministro_instalacion_incluido';
                            itemData.supplyDetails = {};
                            itemData.installationDetails = {};

                            itemData.includedDetails = {
                                unitPrice: finalUnitPriceBase,
                                taxType: quoteMode === 'AIU' ? 'aiu' : (quoteMode === 'SOLO_TOTAL' ? 'none' : 'iva'),
                                aiuA: quoteMode === 'AIU' ? (quoteAiu?.admin || 0) : 0,
                                aiuI: quoteMode === 'AIU' ? (quoteAiu?.imprev || 0) : 0,
                                aiuU: quoteMode === 'AIU' ? (quoteAiu?.util || 0) : 0
                            };
                        } else {
                            itemData.itemType = 'suministro_instalacion';
                            itemData.includedDetails = {};

                            const rawSum = parseImportMoney(item.val_suministro);
                            const rawInst = parseImportMoney(item.val_instalacion);
                            let supplyPortion = finalUnitPriceBase;
                            let installPortion = 0;

                            if ((rawSum + rawInst) > 0) {
                                const ratio = rawSum / (rawSum + rawInst);
                                supplyPortion = Math.round(finalUnitPriceBase * ratio);
                                installPortion = finalUnitPriceBase - supplyPortion;
                            }

                            itemData.supplyDetails = {
                                unitPrice: supplyPortion,
                                taxType: quoteMode === 'SOLO_TOTAL' ? 'none' : 'iva', aiuA: 0, aiuI: 0, aiuU: 0
                            };
                            itemData.installationDetails = {
                                unitPrice: installPortion,
                                taxType: quoteMode === 'AIU' ? 'aiu' : (quoteMode === 'SOLO_TOTAL' ? 'none' : 'iva'),
                                aiuA: quoteMode === 'AIU' ? (quoteAiu?.admin || 0) : 0,
                                aiuI: quoteMode === 'AIU' ? (quoteAiu?.imprev || 0) : 0,
                                aiuU: quoteMode === 'AIU' ? (quoteAiu?.util || 0) : 0
                            };
                        }

                        const itemRef = await addDoc(collection(db, "projects", projectRef.id, "items"), itemData);
                        const batch = writeBatch(db);
                        for (let i = 1; i <= itemQty; i++) {
                            const subItemRef = doc(collection(itemRef, "subItems"));
                            batch.set(subItemRef, {
                                number: i,
                                location: itemData.description,
                                width: widthM, height: heightM,
                                realWidth: 0, realHeight: 0,
                                status: 'Pendiente de Fabricación',
                                projectId: projectRef.id, itemId: itemRef.id,
                                createdAt: new Date()
                            });
                        }
                        await batch.commit();
                    }

                    try {
                        modalConfirmBtn.textContent = "Generando PDF de respaldo...";
                        const quoteDataForPDF = {
                            items: items,
                            mode: quoteMode,
                            aiu: quoteAiu,
                            clientName: projectData.clientName,
                            projectName: projectData.name
                        };
                        await window.generateAndUploadQuotePDF(quoteDataForPDF, projectRef.id, projectData.id || projectRef.id);
                    } catch (pdfError) {
                        console.error("Error generando PDF automático:", pdfError);
                    }
                }

                alert("¡Proyecto formalizado correctamente! Items importados.");
                window.closeMainModal();
                window.showDashboard();

            } catch (error) {
                console.error("Error al crear proyecto desde cotización:", error);
                alert("Hubo un error: " + error.message);
            } finally {
                modalConfirmBtn.disabled = false;
            }
            return;
        }

        if (type === 'create-daily-report') {
            const userProfile = window.usersMap && window.currentUser ? window.usersMap.get(window.currentUser.uid) : null;
            if (userProfile && isUserIncapacitatedOnDate(userProfile)) {
                alert("🚫 Te encuentras en estado de incapacidad médica activa. No tienes permitido registrar reportes diarios.");
                return;
            }

            const text = data.reportText;

            if (!text || text.trim().length < 5) {
                alert("El reporte está muy corto o vacío.");
                return;
            }

            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = "Guardando...";

            try {
                await addDoc(collection(db, "users", window.currentUser.uid, "daily_reports"), {
                    content: text.trim(),
                    createdAt: serverTimestamp(),
                    createdByName: `${window.usersMap.get(window.currentUser.uid)?.firstName} ${window.usersMap.get(window.currentUser.uid)?.lastName}`
                });

                if (window.logAuditAction) window.logAuditAction("Reporte Diario", "Creó reporte de actividad", window.currentUser.uid);

                window.showToast("Reporte guardado correctamente.", "success");
                window.closeMainModal();
            } catch (error) {
                console.error("Error:", error);
                alert("Error al guardar el reporte.");
            } finally {
                modalConfirmBtn.disabled = false;
            }
            return;
        }

        if (type === 'send-admin-alert') {
            const message = data.alertMessage;
            const sendToAll = document.getElementById('alert-send-all-toggle').checked;

            const selectElement = document.getElementById('alert-target-user');
            let selectedUserIds = [];

            if (!sendToAll && selectElement) {
                selectedUserIds = Array.from(selectElement.selectedOptions).map(option => option.value);
            }

            const fileInput = document.getElementById('alert-image-input');
            const file = fileInput ? fileInput.files[0] : null;

            if (!sendToAll && selectedUserIds.length === 0) {
                alert("Por favor selecciona al menos un destinatario o activa 'Enviar a todos'.");
                return;
            }
            if (!message) {
                alert("Escribe un mensaje.");
                return;
            }

            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = "Enviando...";

            try {
                let attachmentURL = null;
                let attachmentType = null;

                if (file) {
                    const isPDF = file.type === 'application/pdf';
                    modalConfirmBtn.textContent = isPDF ? "Subiendo documento..." : "Subiendo imagen...";

                    const storagePath = `admin_alerts/${Date.now()}_${file.name}`;
                    const storageRef = ref(storage, storagePath);

                    if (isPDF) {
                        await uploadBytes(storageRef, file);
                        attachmentType = 'pdf';
                    } else {
                        const resizedImage = await window.resizeImage(file, 1024);
                        await uploadBytes(storageRef, resizedImage);
                        attachmentType = 'image';
                    }

                    attachmentURL = await getDownloadURL(storageRef);
                }

                let recipients = [];
                if (sendToAll) {
                    window.usersMap.forEach((user, uid) => {
                        if (user.status === 'active') recipients.push(uid);
                    });
                } else {
                    recipients = selectedUserIds;
                }

                modalConfirmBtn.textContent = `Enviando a ${recipients.length} usuarios...`;

                const batch = writeBatch(db);

                recipients.forEach(uid => {
                    const notifRef = doc(collection(db, "notifications"));
                    batch.set(notifRef, {
                        userId: uid,
                        title: "📢 LLAMADO URGENTE",
                        message: message,
                        photoURL: attachmentURL,
                        attachmentType: attachmentType || 'image',
                        senderId: window.currentUser.uid,
                        senderName: window.usersMap.get(window.currentUser.uid)?.firstName || "Administrador",
                        read: false,
                        createdAt: serverTimestamp(),
                        type: 'admin_urgent_alert',
                        link: window.location.href
                    });
                });

                await batch.commit();

                window.showToast(`Alerta enviada a ${recipients.length} usuarios.`, "success");
                window.closeMainModal();

            } catch (error) {
                console.error(error);
                alert("Error al enviar alerta: " + error.message);
            } finally {
                modalConfirmBtn.disabled = false;
            }
            return;
        }

        if (type === 'new-dotacion') {
            const userId = data.userId;
            if (!userId) {
                alert("Error: No se seleccionó un usuario.");
                window.closeMainModal();
                return;
            }
            const dotacionData = {
                itemName: data.itemName,
                category: data.category,
                talla: data.talla || 'N/A',
                quantity: parseInt(data.quantity) || 1,
                fechaEntrega: data.fechaEntrega,
                observaciones: data.observaciones || '',
                assignedAt: new Date(),
                assignedBy: window.currentUser.uid
            };
            await addDoc(collection(db, "users", userId, "dotacionAsignada"), dotacionData);
            window.closeMainModal();
            return;
        }

        switch (type) {
            case 'newProject': {
                const projectData = {
                    name: data.name,
                    builderName: data.builderName,
                    location: data.location,
                    address: data.address,
                    value: parseFloat(data.value.replace(/[$. ]/g, '')) || 0,
                    advance: parseFloat(data.advance.replace(/[$. ]/g, '')) || 0,
                    startDate: data.startDate,
                    kickoffDate: data.kickoffDate,
                    endDate: data.endDate,
                    pricingModel: data.pricingModel,
                    status: 'active'
                };
                await window.createProject(projectData);
                break;
            }
            case 'editProjectInfo': {
                const updatedData = {
                    name: data.name,
                    builderName: data.builderName,
                    value: parseFloat(data.value.replace(/[$. ]/g, '')) || 0,
                    advance: parseFloat(data.advance.replace(/[$. ]/g, '')) || 0,
                    startDate: data.startDate,
                    kickoffDate: data.kickoffDate,
                    endDate: data.endDate,
                    pricingModel: data.pricingModel || (window.currentProject ? window.currentProject.pricingModel : 'separado')
                };

                await updateDoc(doc(db, "projects", id), updatedData);

                const projectComplete = {
                    id: id,
                    ...window.currentProject,
                    ...updatedData
                };

                window.currentProject = projectComplete;
                
                const projectDetailsView = document.getElementById('project-details-view');
                const isProjectDetailsVisible = projectDetailsView && !projectDetailsView.classList.contains('hidden');

                if (isProjectDetailsVisible) {
                    window.showProjectDetails(projectComplete);
                } else {
                    if (typeof window.loadProjects === 'function') {
                        window.loadProjects(projectComplete.status || 'active');
                    }
                }
                break;
            }
            case 'addInterestPerson': {
                const personData = {
                    name: data.name,
                    position: data.position,
                    email: data.email,
                    phone: data.phone
                };
                await addDoc(collection(db, "projects", window.currentProject.id, "peopleOfInterest"), personData);
                break;
            }
            case 'back-to-project-details-cortes':
                window.showProjectDetails(window.currentProject);
                window.switchProjectTab('cortes');
                break;
            case 'view-corte-details': {
                const button = e.submitter; // Use submitter to check button properties if needed
                const corteId = button?.dataset.corteId;
                if (corteId) {
                    const corteRef = doc(db, "projects", window.currentProject.id, "cortes", corteId);
                    const corteSnap = await getDoc(corteRef);
                    if (corteSnap.exists()) {
                        window.showCorteDetails({ id: corteSnap.id, ...corteSnap.data() });
                    }
                }
                break;
            }

            case 'add-catalog-item': {
                const measurementType = data.measurementType;
                const isDivisible = measurementType === 'linear' || measurementType === 'area';
                const supplierSelect = document.getElementById('catalog-supplier-select');
                const assignedSupplierId = supplierSelect ? supplierSelect.value : '';
                const assignedSupplierName = (supplierSelect && supplierSelect.selectedIndex > 0) ? supplierSelect.options[supplierSelect.selectedIndex].text : '';

                const rawName = String(data.name || '').trim();
                const formattedName = rawName ? (rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase()) : '';
                const formattedRef = String(data.reference || '').trim().toUpperCase();
                const formattedSystem = String(data.system || '').trim().toUpperCase();
                const rawColor = String(data.color || '').trim();
                const formattedColor = rawColor ? (rawColor.charAt(0).toUpperCase() + rawColor.slice(1).toLowerCase()) : '';

                const catalogData = {
                    name: formattedName,
                    reference: formattedRef,
                    system: formattedSystem || null,
                    color: formattedColor || null,
                    unit: data.unit,
                    minStockThreshold: parseInt(data.minStockThreshold) || 0,
                    basePrice: parseFloat(data.basePrice) || 0,
                    assignedSupplierId: assignedSupplierId || null,
                    assignedSupplierName: assignedSupplierName || null,
                    isDivisible: isDivisible,
                    measurementType: measurementType,
                    defaultSize: isDivisible ? {
                        length: (parseFloat(data.defaultLength) / 100) || 0,
                        width: (parseFloat(data.defaultWidth) / 100) || 0
                    } : null,
                    quantityInStock: parseInt(data.quantityInStock) || 0
                };
                await addDoc(collection(db, "materialCatalog"), catalogData);

                window.loadCatalogView();
                break;
            }

            case 'edit-catalog-item': {
                const measurementType = data.measurementType;
                const isDivisible = measurementType === 'linear' || measurementType === 'area';
                const supplierSelect = document.getElementById('catalog-supplier-select');
                const assignedSupplierId = supplierSelect ? supplierSelect.value : '';
                const assignedSupplierName = (supplierSelect && supplierSelect.selectedIndex > 0) ? supplierSelect.options[supplierSelect.selectedIndex].text : '';

                const rawName = String(data.name || '').trim();
                const formattedName = rawName ? (rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase()) : '';
                const formattedRef = String(data.reference || '').trim().toUpperCase();
                const formattedSystem = String(data.system || '').trim().toUpperCase();
                const rawColor = String(data.color || '').trim();
                const formattedColor = rawColor ? (rawColor.charAt(0).toUpperCase() + rawColor.slice(1).toLowerCase()) : '';

                const updatedData = {
                    name: formattedName,
                    reference: formattedRef,
                    system: formattedSystem || null,
                    color: formattedColor || null,
                    unit: data.unit,
                    minStockThreshold: parseInt(data.minStockThreshold) || 0,
                    basePrice: parseFloat(data.basePrice) || 0,
                    assignedSupplierId: assignedSupplierId || null,
                    assignedSupplierName: assignedSupplierName || null,
                    isDivisible: isDivisible,
                    measurementType: measurementType,
                    defaultSize: isDivisible ? {
                        length: (parseFloat(data.defaultLength) / 100) || 0,
                        width: (parseFloat(data.defaultWidth) / 100) || 0
                    } : null,
                };

                await updateDoc(doc(db, "materialCatalog", id), updatedData);

                window.loadCatalogView();
                break;
            }

            case 'return-material': {
                modalConfirmBtn.disabled = true;
                modalConfirmBtn.textContent = 'Procesando...';

                try {
                    const requestId = modalForm.dataset.id;
                    const targetProjectId = modalForm.dataset.projectId || (window.currentProject ? window.currentProject.id : null);

                    if (!targetProjectId) throw new Error("Error interno: Falta el ID del proyecto.");

                    let returnIdGenerado = '';
                    let itemsNombres = [];

                    await runTransaction(db, async (transaction) => {
                        const returnCounterRef = doc(db, "counters", "materialReturns");
                        const counterDoc = await transaction.get(returnCounterRef);
                        const currentCount = counterDoc.exists() ? (counterDoc.data().count || 0) : 0;
                        const newReturnCount = currentCount + 1;
                        const returnId = `DEV-${String(newReturnCount).padStart(4, '0')}`;

                        returnIdGenerado = returnId;

                        const returnsToProcess = [];

                        document.querySelectorAll('.material-return-item').forEach(itemDiv => {
                            const materialId = itemDiv.dataset.materialId;
                            const materialName = itemDiv.querySelector('p.font-semibold').textContent.trim();
                            const returnType = itemDiv.querySelector(`input[name="type_${materialId}"]:checked`)?.value || 'complete';

                            if (returnType === 'complete') {
                                const input = itemDiv.querySelector(`input[name="quantity_${materialId}"]`);
                                const quantityToReturn = parseInt(input.value);
                                if (quantityToReturn > 0) {
                                    returnsToProcess.push({ type: 'complete', materialId, quantity: quantityToReturn });
                                    itemsNombres.push(`${quantityToReturn}x ${materialName}`);
                                }
                            } else if (returnType === 'remnant') {
                                const remnants = [];
                                itemDiv.querySelectorAll('.remnant-item').forEach(remnantDiv => {
                                    const length = parseFloat(remnantDiv.querySelector(`input[name^="remnant_length_"]`).value);
                                    const quantity = parseInt(remnantDiv.querySelector(`input[name^="remnant_quantity_"]`).value);
                                    if (length > 0 && quantity > 0) {
                                        remnants.push({ length, quantity });
                                        itemsNombres.push(`${quantity}x Retazo ${materialName} (${length}m)`);
                                    }
                                });
                                if (remnants.length > 0) {
                                    returnsToProcess.push({ type: 'remnant', materialId, remnants });
                                }
                            }
                        });

                        if (returnsToProcess.length === 0) throw new Error("No se especificó cantidad a devolver.");

                        for (const process of returnsToProcess) {
                            const materialRef = doc(db, "materialCatalog", process.materialId);
                            if (process.type === 'complete') {
                                const batchRef = doc(collection(materialRef, "stockBatches"));
                                transaction.set(batchRef, {
                                    purchaseDate: new Date(),
                                    quantityInitial: process.quantity,
                                    quantityRemaining: process.quantity,
                                    unitCost: 0,
                                    returnId: returnId,
                                    sourceRequestId: requestId,
                                    notes: `Devolución (${returnId}) de Solicitud ${requestId.substring(0, 6)}`,
                                });
                                transaction.update(materialRef, { quantityInStock: increment(process.quantity) });
                            } else if (process.type === 'remnant') {
                                for (const remnant of process.remnants) {
                                    const remnantRef = doc(collection(materialRef, "remnantStock"));
                                    transaction.set(remnantRef, {
                                        length: remnant.length,
                                        quantity: remnant.quantity,
                                        unit: 'm',
                                        createdAt: new Date(),
                                        notes: `Sobrante Devolución (${returnId})`
                                    });
                                }
                            }
                        }

                        const requestRef = doc(db, "projects", targetProjectId, "materialRequests", requestId);
                        transaction.update(requestRef, { returnedItems: arrayUnion(...returnsToProcess) });
                        transaction.set(returnCounterRef, { count: newReturnCount }, { merge: true });
                    });

                    alert(`¡Devolución ${returnIdGenerado} registrada!\n\nItems devueltos:\n- ${itemsNombres.join('\n- ')}`);
                    window.closeMainModal();

                } catch (error) {
                    console.error("Error:", error);
                    alert("Error: " + error.message);
                } finally {
                    modalConfirmBtn.disabled = false;
                    modalConfirmBtn.textContent = 'Confirmar Devolución';
                }
                break;
            }
            case 'report-incapacidad': {
                modalConfirmBtn.disabled = true;
                modalConfirmBtn.textContent = 'Procesando...';

                try {
                    const targetUid = data.targetEmployeeId || window.currentUser.uid;
                    if (window.currentUserRole === 'admin' && !data.targetEmployeeId) {
                        throw new Error("Por favor, selecciona un colaborador.");
                    }

                    const fileInput = document.getElementById('incapacidad-file-input');
                    const file = fileInput ? fileInput.files[0] : null;

                    const certFileInput = document.getElementById('certificado-file-input');
                    const certFile = certFileInput ? certFileInput.files[0] : null;

                    if (!file) {
                        throw new Error("Por favor, selecciona una imagen o archivo PDF para la evidencia de incapacidad médica.");
                    }
                    if (!certFile) {
                        throw new Error("Por favor, selecciona una imagen o archivo PDF para el Certificado o Constancia de Asistencia a Urgencias.");
                    }

                    // Subir primer archivo (Incapacidad)
                    const isPDF = file.type === 'application/pdf';
                    const storagePath = `incapacidades/${targetUid}/${Date.now()}_${file.name}`;
                    const storageRef = ref(storage, storagePath);

                    let downloadURL = null;
                    if (isPDF) {
                        modalConfirmBtn.textContent = 'Subiendo incapacidad PDF...';
                        await uploadBytes(storageRef, file);
                    } else {
                        modalConfirmBtn.textContent = 'Redimensionando incapacidad...';
                        const resizedImage = await window.resizeImage(file, 1024);
                        modalConfirmBtn.textContent = 'Subiendo incapacidad...';
                        await uploadBytes(storageRef, resizedImage);
                    }
                    downloadURL = await getDownloadURL(storageRef);

                    // Subir segundo archivo (Certificado/Constancia)
                    const isCertPDF = certFile.type === 'application/pdf';
                    const certStoragePath = `incapacidades/${targetUid}/${Date.now()}_cert_${certFile.name}`;
                    const certStorageRef = ref(storage, certStoragePath);

                    let certDownloadURL = null;
                    if (isCertPDF) {
                        modalConfirmBtn.textContent = 'Subiendo certificado PDF...';
                        await uploadBytes(certStorageRef, certFile);
                    } else {
                        modalConfirmBtn.textContent = 'Redimensionando certificado...';
                        const certResizedImage = await window.resizeImage(certFile, 1024);
                        modalConfirmBtn.textContent = 'Subiendo certificado...';
                        await uploadBytes(certStorageRef, certResizedImage);
                    }
                    certDownloadURL = await getDownloadURL(certStorageRef);

                    const incapacidadRef = doc(collection(db, "users", targetUid, "incapacidades"));
                    await setDoc(incapacidadRef, {
                        startDate: data.startDate,
                        durationDays: parseInt(data.durationDays) || 1,
                        medicalCenter: data.medicalCenter,
                        reason: data.reason,
                        evidenceURL: downloadURL,
                        evidenceType: file.type,
                        certificateURL: certDownloadURL,
                        certificateType: certFile.type,
                        status: 'pending',
                        createdAt: serverTimestamp(),
                        createdBy: window.currentUser.uid,
                        userName: `${window.usersMap.get(targetUid)?.firstName || ''} ${window.usersMap.get(targetUid)?.lastName || ''}`.trim()
                    });

                    // Update root user document with incapacidad fields
                    const userRef = doc(db, "users", targetUid);
                    await updateDoc(userRef, {
                        incapacitado: true,
                        incapacidadStart: data.startDate,
                        incapacidadDays: parseInt(data.durationDays) || 1
                    });

                    window.showToast("Reporte de incapacidad enviado correctamente.", "success");
                    window.closeMainModal();
                } catch (error) {
                    console.error("Error al reportar incapacidad:", error);
                    alert("Error: " + error.message);
                } finally {
                    modalConfirmBtn.disabled = false;
                }
                break;
            }

            case 'request-loan': {
                const loanAmount = parseFloat(data.amount.replace(/[$. ]/g, '')) || 0;
                if (loanAmount <= 0) {
                    alert("Por favor ingresa un monto válido.");
                    return;
                }

                modalConfirmBtn.disabled = true;
                modalConfirmBtn.textContent = 'Enviando...';

                try {
                    await addDoc(collection(db, "users", window.currentUser.uid, "loans"), {
                        amount: loanAmount,
                        balance: loanAmount,
                        description: data.description,
                        date: data.date,
                        installments: parseInt(data.installments) || 1,
                        status: 'pending',
                        createdAt: serverTimestamp(),
                        createdBy: window.currentUser.uid
                    });

                    window.showToast("Solicitud enviada correctamente. Te notificaremos cuando sea aprobada.", "success");
                    window.closeMainModal();
                } catch (error) {
                    console.error("Error solicitando préstamo:", error);
                    alert("Error al enviar solicitud.");
                } finally {
                    modalConfirmBtn.disabled = false;
                }
                break;
            }

            case 'new-purchase-order': {
                modalConfirmBtn.disabled = true;
                modalConfirmBtn.textContent = 'Guardando...';
                try {
                    const supplierSelect = document.getElementById('po-supplier-select');
                    const selectedSupplierOption = supplierSelect.options[supplierSelect.selectedIndex];
                    const supplierId = selectedSupplierOption.value;
                    const supplierName = selectedSupplierOption.text;
                    const paymentMethod = modalForm.querySelector('select[name="paymentMethod"]').value;
                    const poDate = modalForm.querySelector('input[name="poDate"]').value;

                    if (!supplierId) throw new Error("Debes seleccionar un proveedor.");

                    const items = [];
                    let totalCost = 0;

                    document.querySelectorAll('#po-items-table-body tr').forEach(row => {
                        const materialId = row.dataset.itemId;
                        const itemType = row.dataset.itemType;
                        const quantity = parseFloat(row.dataset.quantity);
                        const unitCost = parseFloat(row.dataset.cost);
                        const subtotal = parseFloat(row.dataset.subtotal);

                        if (materialId && quantity > 0 && itemType) {
                            items.push({ materialId, itemType, quantity, unitCost });
                            totalCost += subtotal;
                        }
                    });

                    if (items.length === 0) throw new Error("Debes añadir al menos un ítem.");

                    const counterRef = doc(db, "counters", "purchaseOrders");
                    const newPoRef = doc(collection(db, "purchaseOrders"));
                    let newPoNumber = '';

                    await runTransaction(db, async (transaction) => {
                        const counterDoc = await transaction.get(counterRef);
                        const newCount = (counterDoc.exists() ? counterDoc.data().count : 0) + 1;
                        newPoNumber = `PO-${String(newCount).padStart(4, '0')}`;

                        const poData = {
                            poNumber: newPoNumber,
                            supplierId: supplierId,
                            supplierName: supplierName,
                            provider: supplierName,
                            paymentMethod: paymentMethod,
                            createdAt: new Date(poDate),
                            createdBy: window.currentUser.uid,
                            status: 'pendiente',
                            items: items,
                            totalCost: totalCost,
                            paidAmount: 0
                        };
                        transaction.set(newPoRef, poData);
                        transaction.update(counterRef, { count: newCount });
                    });

                    if (paymentMethod !== 'pendiente') {
                        modalConfirmBtn.textContent = 'Registrando pago...';
                        await window.registerSupplierPayment(
                            supplierId,
                            totalCost,
                            paymentMethod,
                            poDate,
                            `Pago Inmediato PO #${newPoNumber}`
                        );
                        alert(`¡Orden #${newPoNumber} creada y PAGO registrado correctamente!`);
                    } else {
                        alert(`¡Orden #${newPoNumber} creada con éxito (Pendiente de pago)!`);
                    }

                    window.closeMainModal();

                } catch (error) {
                    console.error("Fallo al guardar PO:", error);
                    alert("Error: " + error.message);
                } finally {
                    modalConfirmBtn.disabled = false;
                }
                break;
            }

            case 'new-supplier-payment': {
                if (!window.currentSupplierId) {
                    alert("Error: No se identificó el proveedor.");
                    break;
                }

                modalConfirmBtn.disabled = true;
                modalConfirmBtn.textContent = "Procesando...";

                try {
                    const amountToPay = parseFloat(data.amount.replace(/[$. ]/g, '')) || 0;
                    if (amountToPay <= 0) throw new Error("Monto inválido.");

                    const billsPaid = await window.registerSupplierPayment(
                        window.currentSupplierId,
                        amountToPay,
                        data.paymentMethod,
                        data.date,
                        data.note || 'Abono Manual'
                    );

                    let msg = `Pago registrado exitosamente.`;
                    if (billsPaid > 0) msg += ` Se aplicó a ${billsPaid} orden(es) pendiente(s).`;
                    else msg += ` (Quedó como saldo a favor o no había deudas pendientes).`;

                    alert(msg);
                    window.closeMainModal();
                    if (window.currentSupplierId) {
                        window.loadSupplierDetailsView(window.currentSupplierId);
                    }

                } catch (error) {
                    console.error("Error al guardar pago:", error);
                    alert("Error: " + error.message);
                } finally {
                    modalConfirmBtn.disabled = false;
                }
                break;
            }

            case 'receive-purchase-order': {
                const button = e.submitter;
                const poId = button?.dataset.id;
                if (!poId) break;
                const poRef = doc(db, "purchaseOrders", poId);

                try {
                    await runTransaction(db, async (transaction) => {
                        const poDoc = await transaction.get(poRef);
                        if (!poDoc.exists() || poDoc.data().status !== 'pendiente') {
                            throw "Esta orden ya fue procesada o no existe.";
                        }

                        for (const item of poDoc.data().items) {
                            const materialRef = doc(db, "materialCatalog", item.materialId);
                            const materialDoc = await transaction.get(materialRef);
                            const newStock = (materialDoc.data().quantityInStock || 0) + item.quantity;
                            transaction.update(materialRef, { quantityInStock: newStock });
                        }

                        transaction.update(poRef, { status: 'recibida', receivedAt: new Date(), receivedBy: window.currentUser.uid });
                    });
                    alert("¡Orden de compra recibida y stock actualizado con éxito!");
                } catch (error) {
                    console.error("Error al recibir la orden de compra:", error);
                    alert("Error: " + error);
                }
                break;
            }
            case 'add-anticipo-payment':
            case 'add-corte-payment':
            case 'add-other-payment': {
                const rawAmountPayment = parseFloat(data.amount.replace(/[$. ]/g, '')) || 0;

                const paymentData = {
                    amount: rawAmountPayment,
                    date: data.date,
                    type: data.type,
                    targetId: data.targetId || null,
                    concept: data.concept || `Abono a ${data.type === 'abono_anticipo' ? 'Anticipo' : `Corte #${modalForm.dataset.corteNumber || ''}`}`,
                    createdAt: new Date()
                };

                await addDoc(collection(db, "projects", window.currentProject.id, "payments"), paymentData);

                await updateDoc(doc(db, "projects", window.currentProject.id), {
                    paidAmount: increment(rawAmountPayment)
                });

                modalForm.dataset.corteNumber = '';
                break;
            }
            case 'view-image': {
                const imageUrl = e.target.getAttribute('src');
                if (imageUrl) {
                    window.openImageModal(imageUrl);
                }
                break;
            }
            case 'request-material': {
                modalConfirmBtn.disabled = true;
                modalConfirmBtn.textContent = 'Procesando...';

                try {
                    const requestedItems = [];
                    document.querySelectorAll('#request-items-list > div').forEach(itemEl => {
                        requestedItems.push({
                            isRemnant: itemEl.dataset.isRemnant === 'true',
                            materialId: itemEl.dataset.materialId,
                            quantity: parseFloat(itemEl.dataset.quantity),
                            remnantId: itemEl.dataset.remnantId || null,
                            itemName: itemEl.querySelector('span').textContent
                        });
                    });

                    const targetItems = [];
                    document.querySelectorAll('.request-item-quantity').forEach(input => {
                        const quantity = parseFloat(input.value);
                        if (quantity > 0) {
                            targetItems.push({ itemId: input.dataset.itemId, quantity: quantity });
                        }
                    });

                    const selectedRequesterId = document.getElementById('request-as-user-select')?.value || window.currentUser.uid;

                    if (requestedItems.length === 0 || targetItems.length === 0) {
                        throw new Error("Debes añadir al menos un material y especificar la cantidad para al menos un ítem de destino.");
                    }

                    const transactionPlan = {
                        batchUpdates: [],
                        remnantUpdates: [],
                        mainStockUpdates: [],
                        totalCost: 0,
                        consumedItems: [],
                        materialNames: []
                    };

                    for (const item of requestedItems) {
                        const materialRef = doc(db, "materialCatalog", item.materialId);

                        if (item.isRemnant) {
                            const remnantRef = doc(materialRef, "remnantStock", item.remnantId);
                            transactionPlan.remnantUpdates.push({ ref: remnantRef, deduct: item.quantity });
                            transactionPlan.consumedItems.push({ type: 'remnant', ...item });
                            transactionPlan.materialNames.push(item.itemName);
                        } else {
                            const batchesQuery = query(collection(materialRef, "stockBatches"), where("quantityRemaining", ">", 0), orderBy("purchaseDate", "asc"));
                            const batchesSnapshot = await getDocs(batchesQuery);

                            const availableStock = batchesSnapshot.docs.reduce((sum, doc) => sum + doc.data().quantityRemaining, 0);
                            if (availableStock < item.quantity) {
                                const materialSnap = await getDoc(materialRef);
                                const materialName = materialSnap.exists() ? materialSnap.data().name : item.materialId;
                                throw new Error(`No hay stock suficiente de ${materialName}. Solicitado: ${item.quantity}, Disponible: ${availableStock}.`);
                            }

                            let remainingToFulfill = item.quantity;
                            for (const batchDoc of batchesSnapshot.docs) {
                                if (remainingToFulfill <= 0) break;
                                const batchData = batchDoc.data();
                                const consume = Math.min(batchData.quantityRemaining, remainingToFulfill);

                                transactionPlan.batchUpdates.push({ ref: batchDoc.ref, deduct: consume });
                                transactionPlan.totalCost += consume * (batchData.unitCost || 0);
                                remainingToFulfill -= consume;
                            }

                            transactionPlan.mainStockUpdates.push({ ref: materialRef, deduct: item.quantity });
                            transactionPlan.consumedItems.push({ type: 'full_unit', ...item });
                            transactionPlan.materialNames.push(item.itemName);
                        }
                    }

                    await runTransaction(db, async (transaction) => {
                        for (const update of transactionPlan.batchUpdates) {
                            const batchDoc = await transaction.get(update.ref);
                            if (!batchDoc.exists() || batchDoc.data().quantityRemaining < update.deduct) {
                                throw new Error("El stock cambió mientras se procesaba la solicitud. Por favor, inténtalo de nuevo.");
                            }
                            transaction.update(update.ref, { quantityRemaining: increment(-update.deduct) });
                        }

                        for (const update of transactionPlan.remnantUpdates) {
                            const remnantDoc = await transaction.get(update.ref);
                            if (!remnantDoc.exists() || remnantDoc.data().quantity < update.deduct) {
                                throw new Error("El retazo solicitado ya no está disponible. Por favor, inténtalo de nuevo.");
                            }
                            transaction.update(update.ref, { quantity: increment(-update.deduct) });
                        }

                        for (const update of transactionPlan.mainStockUpdates) {
                            transaction.update(update.ref, { quantityInStock: increment(-update.deduct) });
                        }

                        const requestRef = doc(collection(db, "projects", window.currentProject.id, "materialRequests"));
                        transaction.set(requestRef, {
                            consumedItems: transactionPlan.consumedItems,
                            targetItems,
                            materialName: transactionPlan.materialNames.join(', '),
                            quantity: requestedItems.reduce((sum, item) => sum + item.quantity, 0),
                            requesterId: selectedRequesterId,
                            createdAt: new Date(),
                            status: "solicitado",
                            totalCost: transactionPlan.totalCost,
                        });
                    });

                    alert("Solicitud creada con éxito.");
                    window.closeMainModal();

                } catch (error) {
                    console.error("Error al crear la solicitud de material:", error);
                    alert("Error: " + error.message);
                } finally {
                    modalConfirmBtn.disabled = false;
                    modalConfirmBtn.textContent = 'Enviar Solicitud';
                }
                break;
            }
            case 'new-supplier': {
                modalConfirmBtn.disabled = true;
                modalConfirmBtn.textContent = 'Creando...';

                try {
                    let qrURL = null;
                    const qrFile = document.getElementById('supplier-qr-input').files[0];

                    if (qrFile) {
                        const storagePath = `suppliers/qr/${Date.now()}_${qrFile.name}`;
                        const storageRef = ref(storage, storagePath);
                        const snapshot = await uploadBytes(storageRef, qrFile);
                        qrURL = await getDownloadURL(snapshot.ref);
                    }

                    const newSupplierData = {
                        name: data.name,
                        nit: data.nit || '',
                        email: data.email || '',
                        address: data.address || '',
                        contactName: data.contactName || '',
                        contactPhone: data.contactPhone || '',
                        bankName: data.bankName || '',
                        accountType: data.accountType || 'Ahorros',
                        accountNumber: data.accountNumber || '',
                        qrCodeURL: qrURL,
                        createdAt: new Date()
                    };
                    await addDoc(collection(db, "suppliers"), newSupplierData);

                } catch (error) {
                    console.error(error);
                    alert("Error al crear proveedor: " + error.message);
                } finally {
                    modalConfirmBtn.disabled = false;
                }
                break;
            }

            case 'edit-supplier': {
                modalConfirmBtn.disabled = true;
                modalConfirmBtn.textContent = 'Guardando...';

                try {
                    const storedId = document.getElementById('hidden-supplier-id')?.value;
                    const finalId = id || storedId;

                    if (!finalId) throw new Error("No se encontró el ID del proveedor");

                    const supplierRef = doc(db, "suppliers", finalId);
                    const qrFile = document.getElementById('supplier-qr-input').files[0];

                    const updateData = {
                        name: data.name,
                        nit: data.nit || '',
                        email: data.email || '',
                        address: data.address || '',
                        contactName: data.contactName || '',
                        contactPhone: data.contactPhone || '',
                        bankName: data.bankName || '',
                        accountType: data.accountType || 'Ahorros',
                        accountNumber: data.accountNumber || ''
                    };

                    if (qrFile) {
                        const storagePath = `suppliers/qr/${Date.now()}_${qrFile.name}`;
                        const storageRef = ref(storage, storagePath);
                        const snapshot = await uploadBytes(storageRef, qrFile);
                        const qrURL = await getDownloadURL(snapshot.ref);
                        updateData.qrCodeURL = qrURL;
                    }

                    await updateDoc(supplierRef, updateData);

                    window.closeMainModal();
                    alert("Proveedor actualizado correctamente.");
                    if (window.currentSupplierId) {
                        window.loadSupplierDetailsView(window.currentSupplierId);
                    }

                } catch (error) {
                    console.error(error);
                    alert("Error al actualizar proveedor: " + error.message);
                } finally {
                    if (modalConfirmBtn) {
                        modalConfirmBtn.disabled = false;
                        modalConfirmBtn.textContent = 'Guardar Cambios';
                    }
                }
                break;
            }
            case 'addItem': {
                const itemName = data.name.trim().toLowerCase();
                if (!itemName) {
                    alert("El nombre del objeto no puede estar vacío.");
                    return;
                }

                const fileInput = modalForm.querySelector('input[name="blueprintFile"]');
                const file = fileInput ? fileInput.files[0] : null;

                if (file) {
                    modalConfirmBtn.disabled = true;
                    modalConfirmBtn.textContent = 'Subiendo plano...';
                    try {
                        const storageRef = ref(storage, `blueprints/${window.currentProject.id}/${Date.now()}_${file.name}`);
                        const snapshot = await uploadBytes(storageRef, file);
                        const url = await getDownloadURL(snapshot.ref);
                        data.blueprintURL = url;
                    } catch (err) {
                        console.error("Error subiendo plano:", err);
                        alert("Error al subir el plano. Intenta de nuevo.");
                        modalConfirmBtn.disabled = false;
                        modalConfirmBtn.textContent = 'Añadir Ítem';
                        return;
                    }
                }

                const q = query(collection(db, "projects", window.currentProject.id, "items"), where("name", "==", data.name.trim()));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    alert(`Error: Ya existe un ítem con el nombre "${data.name.trim()}" en este proyecto.`);
                    modalConfirmBtn.disabled = false;
                    modalConfirmBtn.textContent = 'Añadir Ítem';
                    return;
                }

                data.width = parseFloat(data.width) / 100;
                data.height = parseFloat(data.height) / 100;

                modalConfirmBtn.textContent = 'Guardando...';
                modalConfirmBtn.disabled = true;

                await window.createItem(data);

                const projectDoc = await getDoc(doc(db, "projects", window.currentProject.id));
                if (projectDoc.exists()) {
                    window.currentProject = { id: projectDoc.id, ...projectDoc.data() };
                    window.showProjectDetails(window.currentProject, 'items');
                }
                break;
            }

            case 'editItem': {
                const newItemName = data.name.trim();

                if (!newItemName) {
                    alert("El nombre del objeto no puede estar vacío.");
                    return;
                }

                if (!id) {
                    console.error("Error crítico: No se encontró el ID del ítem a editar.");
                    alert("Error interno: Falta el ID del ítem.");
                    return;
                }

                const q = query(collection(db, "projects", window.currentProject.id, "items"), where("name", "==", newItemName));
                const querySnapshot = await getDocs(q);

                let isDuplicate = false;
                querySnapshot.forEach(doc => {
                    if (doc.id !== id) isDuplicate = true;
                });

                if (isDuplicate) {
                    alert(`Error: Ya existe otro ítem con el nombre "${newItemName}" en este proyecto.`);
                    modalConfirmBtn.disabled = false;
                    modalConfirmBtn.textContent = 'Guardar Cambios';
                    return;
                }

                const fileInput = modalForm.querySelector('input[name="blueprintFile"]');
                const file = fileInput ? fileInput.files[0] : null;

                if (file) {
                    modalConfirmBtn.disabled = true;
                    modalConfirmBtn.textContent = 'Subiendo plano...';
                    try {
                        const storageRef = ref(storage, `blueprints/${window.currentProject.id}/${Date.now()}_${file.name}`);
                        const snapshot = await uploadBytes(storageRef, file);
                        const url = await getDownloadURL(snapshot.ref);
                        data.blueprintURL = url;

                    } catch (err) {
                        console.error("Error subiendo plano:", err);
                        alert("Error al subir el plano. Intenta de nuevo.");
                        modalConfirmBtn.disabled = false;
                        modalConfirmBtn.textContent = 'Guardar Cambios';
                        return;
                    }
                }

                data.width = parseFloat(data.width) / 100;
                data.height = parseFloat(data.height) / 100;

                modalConfirmBtn.textContent = 'Guardando...';
                modalConfirmBtn.disabled = true;

                await window.updateItem(id, data);

                const projectDoc = await getDoc(doc(db, "projects", window.currentProject.id));
                if (projectDoc.exists()) {
                    window.currentProject = { id: projectDoc.id, ...projectDoc.data() };
                    window.showProjectDetails(window.currentProject, 'items');
                }
                break;
            }

            case 'editUser': {
                try {
                    modalConfirmBtn.disabled = true;
                    modalConfirmBtn.textContent = 'Guardando...';

                    const userRef = doc(db, "users", id);
                    const oldUserData = window.usersMap.get(id) || {};
                    const changes = {};

                    const photoFile = window.processedPhotoFile;
                    window.processedPhotoFile = null;
                    let downloadURL = null;

                    if (photoFile && photoFile.size > 0) {
                        let fileToResize = photoFile;

                        const fileType = photoFile.type.toLowerCase();
                        const fileName = photoFile.name.toLowerCase();
                        const isHEIC = fileType === 'image/heic' || fileType === 'image/heif' || fileName.endsWith('.heic');

                        if (isHEIC) {
                            modalConfirmBtn.textContent = 'Convirtiendo HEIC...';
                            await window.ensureHeic2Any();
                            const convertedBlob = await heic2any({
                                blob: photoFile,
                                toType: "image/jpeg",
                                quality: 0.8,
                                width: 1024
                            });
                            fileToResize = new File([convertedBlob], "converted.jpg", { type: "image/jpeg" });
                        }

                        modalConfirmBtn.textContent = 'Redimensionando foto...';
                        const resizedBlob = await window.resizeImage(fileToResize, 400);

                        modalConfirmBtn.textContent = 'Subiendo foto...';
                        const photoPath = `profile_photos/${id}/profile.jpg`;
                        const photoStorageRef = ref(storage, photoPath);
                        await uploadBytes(photoStorageRef, resizedBlob);
                        downloadURL = await getDownloadURL(photoStorageRef);

                        changes.profilePhotoURL = { old: oldUserData.profilePhotoURL || 'ninguna', new: 'nueva foto' };
                    }

                    const customPermissions = {};
                    const targetRole = oldUserData.role || 'operario';
                    const roleDefaults = window.getRoleDefaultPermissions(targetRole);

                    const checkboxes = modalForm.querySelectorAll('.permission-checkbox');
                    checkboxes.forEach(cb => {
                        const key = cb.dataset.key;
                        const isChecked = cb.checked;
                        const defaultState = !!roleDefaults[key];

                        if (isChecked !== defaultState) {
                            customPermissions[key] = isChecked ? 'show' : 'hide';
                        }
                    });

                    let currentStatus = oldUserData.status || 'active';

                    if (data.contractEndDate) {
                        const endDate = new Date(data.contractEndDate + 'T00:00:00');
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);

                        if (endDate < today) {
                            currentStatus = 'archived';
                            alert(`AVISO: La fecha de finalización (${data.contractEndDate}) es anterior a hoy. El usuario pasará a estado ARCHIVADO automáticamente.`);
                        }
                    }

                    const dataToUpdate = {
                        firstName: data.firstName,
                        lastName: data.lastName,
                        idNumber: data.idNumber,
                        phone: data.phone,
                        address: data.address,
                        bankName: data.bankName || '',
                        accountType: data.accountType || 'Ahorros',
                        accountNumber: data.accountNumber || '',
                        tallaCamiseta: data.tallaCamiseta || '',
                        tallaPantalón: data.tallaPantalón || '',
                        tallaBotas: data.tallaBotas || ''
                    };

                    if (window.currentUserRole === 'admin' || window.currentUserRole === 'nomina') {
                        dataToUpdate.role = data.role;
                        dataToUpdate.commissionLevel = data.commissionLevel || '';
                        dataToUpdate.salarioBasico = parseFloat(data.salarioBasico.replace(/[$. ]/g, '')) || 0;
                        dataToUpdate.deduccionSobreMinimo = !!data.deduccionSobreMinimo;

                        dataToUpdate.customPermissions = customPermissions;

                        dataToUpdate.contractStartDate = data.contractStartDate || null;
                        dataToUpdate.contractEndDate = data.contractEndDate || null;
                        dataToUpdate.status = currentStatus;
                    }

                    if (downloadURL) {
                        dataToUpdate.profilePhotoURL = downloadURL;
                    }

                    const safeVal = (val) => (val === undefined ? null : val);

                    if (data.firstName !== oldUserData.firstName) changes.firstName = { old: safeVal(oldUserData.firstName), new: data.firstName };
                    if (data.lastName !== oldUserData.lastName) changes.lastName = { old: safeVal(oldUserData.lastName), new: data.lastName };
                    if (data.idNumber !== oldUserData.idNumber) changes.idNumber = { old: safeVal(oldUserData.idNumber), new: data.idNumber };
                    if (data.phone !== oldUserData.phone) changes.phone = { old: safeVal(oldUserData.phone), new: data.phone };
                    if (data.address !== oldUserData.address) changes.address = { old: safeVal(oldUserData.address), new: data.address };

                    if ((data.tallaCamiseta || '') !== (oldUserData.tallaCamiseta || '')) changes.tallaCamiseta = { old: safeVal(oldUserData.tallaCamiseta), new: data.tallaCamiseta };
                    if ((data.tallaPantalón || '') !== (oldUserData.tallaPantalón || '')) changes.tallaPantalón = { old: safeVal(oldUserData.tallaPantalón), new: data.tallaPantalón };
                    if ((data.tallaBotas || '') !== (oldUserData.tallaBotas || '')) changes.tallaBotas = { old: safeVal(oldUserData.tallaBotas), new: data.tallaBotas };

                    const oldSalario = oldUserData.salarioBasico || 0;
                    const newSalario = dataToUpdate.salarioBasico;
                    if (newSalario !== oldSalario) changes.salarioBasico = { old: oldSalario, new: newSalario };
                    if (data.commissionLevel !== (oldUserData.commissionLevel || '')) changes.commissionLevel = { old: safeVal(oldUserData.commissionLevel), new: data.commissionLevel };

                    const oldStart = oldUserData.contractStartDate || null;
                    const newStart = data.contractStartDate || null;
                    if (newStart !== oldStart) {
                        changes.contractStartDate = { old: oldStart, new: newStart };
                    }

                    const oldEnd = oldUserData.contractEndDate || null;
                    const newEnd = data.contractEndDate || null;
                    if (newEnd !== oldEnd) {
                        changes.contractEndDate = { old: oldEnd, new: newEnd };
                    }

                    if (JSON.stringify(oldUserData.customPermissions || {}) !== JSON.stringify(customPermissions)) {
                        changes.permissions = { old: 'Permisos previos', new: 'Permisos actualizados' };
                    }

                    if (currentStatus !== oldUserData.status) {
                        changes.status = { old: oldUserData.status, new: currentStatus };
                    }

                    const batch = writeBatch(db);
                    batch.update(userRef, dataToUpdate);

                    if (Object.keys(changes).length > 0) {
                        const historyRef = doc(collection(userRef, "profileHistory"));
                        batch.set(historyRef, {
                            changes: changes,
                            changedBy: window.currentUser.uid,
                            timestamp: serverTimestamp()
                        });
                    }

                    await batch.commit();

                } catch (error) {
                    console.error("Error al actualizar perfil:", error);
                    alert("Error al actualizar el perfil: " + error.message);
                } finally {
                    modalConfirmBtn.disabled = false;
                    modalConfirmBtn.textContent = 'Guardar Cambios';
                    window.closeMainModal();
                }
                break;
            }

            case 'editProfile': {
                const user = auth.currentUser;
                const oldUserData = window.usersMap.get(user.uid) || {};

                const hasChanges = (
                    data.email !== user.email ||
                    data.phone !== oldUserData.phone ||
                    data.address !== oldUserData.address ||
                    (data.tallaCamiseta || '') !== (oldUserData.tallaCamiseta || '') ||
                    (data.tallaPantalón || '') !== (oldUserData.tallaPantalón || '') ||
                    (data.tallaBotas || '') !== (oldUserData.tallaBotas || '')
                );

                if (hasChanges) {
                    console.log("Cambios detectados en el perfil. Iniciando autenticación facial...");
                    window.pendingProfileUpdateData = data;
                    window.closeMainModal();
                    window.openProfileAuthModal();
                } else {
                    console.log("No se detectaron cambios en el perfil. Cerrando modal.");
                    window.closeMainModal();
                }
                break;
            }
        }
        window.closeMainModal();
    });
}
