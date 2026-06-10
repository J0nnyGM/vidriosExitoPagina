// js/ui/modals.js

import { db, auth, storage } from '../core/firebase-config.js';
import { doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, getDocs, writeBatch, arrayUnion, serverTimestamp, orderBy, collectionGroup } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { TOOL_CATEGORIES } from '../modules/herramientas.js';
import { getCachedRecentPOs } from '../modules/catalogo.js';

async function loadUserAuditLogs(userId) {
    try {
        const q = query(
            collection(db, "audit_logs"),
            where("targetId", "==", userId)
        );
        const snapshot = await getDocs(q);
        const logs = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            logs.push({
                action: data.action || 'Acción',
                details: data.description || 'Sin descripción',
                date: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt)) : new Date(),
                by: data.adminName || 'Admin',
                previousData: data.previousData ? (typeof data.previousData === 'object' ? JSON.stringify(data.previousData) : String(data.previousData)) : null
            });
        });
        logs.sort((a, b) => b.date - a.date);
        return logs;
    } catch (e) {
        console.error("Error al cargar logs de auditoría:", e);
        return [];
    }
}

async function openMainModal(type, data = {}) {
    const modal = document.getElementById('main-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalForm = document.getElementById('modal-form');
    const modalContentDiv = document.getElementById('main-modal-content');

    const safeDate = (firebaseDate) => {
        if (!firebaseDate) return '';
        try {
            // 1. Si es Timestamp de Firebase
            if (typeof firebaseDate.toDate === 'function') {
                return firebaseDate.toDate().toISOString().split('T')[0];
            }
            // 2. Si es objeto Date
            if (firebaseDate instanceof Date) {
                return firebaseDate.toISOString().split('T')[0];
            }
            // 3. Si es String (ISO)
            return String(firebaseDate).split('T')[0];
        } catch (e) {
            return ''; // Si falla, retorna vacío para no romper el form
        }
    };

    // =================================================================
    // 1. RESETEO MAESTRO (CORREGIDO Y BLINDADO)
    // =================================================================

    // A. Restaurar Footer y Header (Por si se ocultaron en otros modales)
    const defaultFooter = document.getElementById('main-modal-footer');
    const defaultHeader = document.getElementById('modal-title')?.parentElement;

    if (defaultFooter) {
        defaultFooter.style.display = 'flex';
        defaultFooter.classList.remove('hidden');
        // Restauramos el HTML base del footer para asegurar que los botones existan
        defaultFooter.innerHTML = `
            <button type="button" id="modal-cancel-btn-footer" class="premium-btn-cancel">Cancelar</button>
            <button type="submit" id="modal-confirm-btn" class="premium-btn-confirm">Confirmar</button>
        `;
    }
    if (defaultHeader) {
        defaultHeader.style.display = 'flex';
    }

    // B. REINICIAR CLASES DEL CONTENEDOR (Elimina formatos "rotos")
    if (modalContentDiv) {
        // 1. Borrar todo
        modalContentDiv.className = '';
        modalContentDiv.style = '';

        // 2. Aplicar clases estándar limpias
        modalContentDiv.classList.add('bg-white', 'w-full', 'max-w-2xl', 'max-h-[90vh]', 'flex', 'flex-col', 'animate-scale-up', 'premium-modal-card', 'relative');

        // 3. Restaurar cuerpo interno
        modalBody.className = 'p-6 flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-slate-50/30';
        modalBody.style.padding = '';
        modalBody.parentElement.classList.remove('overflow-hidden');
    }

    // C. RESETEAR EL BOTÓN DE CONFIRMACIÓN (Aquí estaba el error)
    // Declaramos la variable explícitamente antes de usarla
    const confirmBtn = document.getElementById('modal-confirm-btn');

    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirmar';
        confirmBtn.className = "premium-btn-confirm";
        // Limpiamos datos residuales
        delete confirmBtn.dataset.originalText;
    }

    // D. LIMPIEZA DE DATOS DEL FORMULARIO
    modalForm.dataset.type = type;
    delete modalForm.dataset.id;
    delete modalForm.dataset.itemid;

    // E. RECONECTAR BOTÓN CANCELAR (Porque reescribimos el footer en el paso A)
    setTimeout(() => {
        const cancelBtn = document.getElementById('modal-cancel-btn-footer');
        if (cancelBtn) cancelBtn.onclick = closeMainModal;
    }, 0);

    // =================================================================

    let title = 'Título por defecto';
    let bodyHtml = '<p>Contenido...</p>';
    let btnText = 'Confirmar';
    let btnClass = 'bg-blue-600 hover:bg-blue-700 text-white';

    // --- INICIO DEL SWITCH ---
    switch (type) {
        case 'newProject': {
            // 1. Configuración
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            const defaultFooter = document.getElementById('modal-confirm-btn')?.parentElement;
            if (defaultFooter) defaultFooter.style.display = 'none';

            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-3xl', 'flex', 'flex-col', 'max-h-[90vh]', 'overflow-hidden');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            title = 'Crear Nuevo Proyecto';

            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-indigo-600 to-blue-600 px-8 py-5 shrink-0 rounded-t-xl flex justify-between items-center relative overflow-hidden">
                        <div class="absolute top-0 right-0 p-4 opacity-10 pointer-events-none transform scale-150 translate-x-4 -translate-y-2">
                            <i class="fa-solid fa-city text-6xl text-white"></i>
                        </div>
                        <div class="flex items-center gap-4 relative z-10">
                            <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl backdrop-blur-sm border border-white/10 shadow-inner text-white">
                                <i class="fa-solid fa-plus"></i>
                            </div>
                            <div>
                                <h2 class="text-xl font-bold tracking-tight text-white">Nuevo Proyecto</h2>
                                <p class="text-indigo-100 text-xs font-medium">Registrar obra y configuración inicial</p>
                            </div>
                        </div>
                        
                        <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white transition-colors relative z-10">
                            <i class="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <div class="flex-grow overflow-y-auto custom-scrollbar p-6 bg-gray-50">
                        
                        <div class="space-y-6">
                            
                            <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-4 flex items-center">
                                    <i class="fa-solid fa-info-circle mr-2 text-indigo-500"></i> Información General
                                </h4>
                                
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div class="md:col-span-2">
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Nombre del Proyecto <span class="text-red-500">*</span></label>
                                        <input type="text" name="name" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 font-bold text-gray-800 placeholder-gray-300" placeholder="Ej: Edificio Torres del Parque">
                                    </div>
                                    
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Constructora / Cliente <span class="text-red-500">*</span></label>
                                        <input type="text" name="builderName" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500" placeholder="Ej: Constructora ABC S.A.S.">
                                    </div>
                                    
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Modelo de Contrato</label>
                                        <select name="pricingModel" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer">
                                            <option value="separado">Suministro e Instalación (Separado)</option>
                                            <option value="incluido">Todo Incluido (Global)</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-4 flex items-center">
                                    <i class="fa-solid fa-location-dot mr-2 text-red-500"></i> Ubicación
                                </h4>
                                
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div class="relative">
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Municipio <span class="text-red-500">*</span></label>
                                        <div class="relative">
                                            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400"><i class="fa-solid fa-magnifying-glass"></i></div>
                                            <input type="text" id="project-location" name="location" required class="w-full pl-9 border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500" autocomplete="off" placeholder="Buscar municipio...">
                                        </div>
                                        <div id="municipalities-results" class="municipality-search-results hidden absolute z-50 w-full bg-white border border-gray-200 rounded-lg mt-1 shadow-xl max-h-40 overflow-y-auto"></div>
                                    </div>
                                    
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Dirección Obra</label>
                                        <input type="text" name="address" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500" placeholder="Calle 123 # 45-67">
                                    </div>
                                </div>
                            </div>

                            <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-4 flex items-center">
                                    <i class="fa-solid fa-sack-dollar mr-2 text-green-600"></i> Datos del Contrato
                                </h4>

                                <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-4">
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Valor Contrato (Sin IVA) <span class="text-red-500">*</span></label>
                                        <div class="relative">
                                            <span class="absolute left-3 top-2.5 text-gray-400 font-bold">$</span>
                                            <input type="text" id="project-value" name="value" required class="currency-input w-full pl-7 border-gray-300 rounded-lg p-2.5 text-lg font-bold text-gray-800 focus:ring-indigo-500 font-mono" placeholder="0">
                                        </div>
                                    </div>
                                    
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Valor Anticipo</label>
                                        <div class="relative">
                                            <span class="absolute left-3 top-2.5 text-gray-400 font-bold">$</span>
                                            <input type="text" id="project-advance" name="advance" required class="currency-input w-full pl-7 border-gray-300 rounded-lg p-2.5 text-lg font-bold text-gray-800 focus:ring-indigo-500 font-mono" placeholder="0">
                                        </div>
                                    </div>
                                </div>

                                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Inicio Contrato</label>
                                        <input type="date" name="startDate" class="w-full border-gray-300 rounded-lg p-2 text-sm focus:ring-indigo-500 text-gray-600">
                                    </div>
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Acta de Inicio</label>
                                        <input type="date" name="kickoffDate" class="w-full border-gray-300 rounded-lg p-2 text-sm focus:ring-indigo-500 text-gray-600">
                                    </div>
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Fin Estimado</label>
                                        <input type="date" name="endDate" class="w-full border-gray-300 rounded-lg p-2 text-sm focus:ring-indigo-500 text-gray-600">
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>

                    <div class="bg-white border-t border-gray-200 p-4 shrink-0 flex justify-end gap-3 rounded-b-xl">
                        <button type="button" onclick="closeMainModal()" class="px-5 py-2.5 rounded-lg text-gray-600 font-bold hover:bg-gray-100 transition-colors text-sm">
                            Cancelar
                        </button>
                        <button type="button" onclick="document.getElementById('modal-form').requestSubmit()" class="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white px-8 py-2.5 rounded-lg font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm flex items-center gap-2">
                            <i class="fa-solid fa-check"></i> Crear Proyecto
                        </button>
                    </div>
                </div>`;

            setTimeout(() => {
                // ... (Resto de la lógica JS, igual que antes) ...
                const valueInput = document.getElementById('project-value');
                const advanceInput = document.getElementById('project-advance');
                setupCurrencyInput(valueInput);
                setupCurrencyInput(advanceInput);

                const inputLocation = document.getElementById('project-location');
                const resultsContainer = document.getElementById('municipalities-results');

                fetchMunicipalities();

                inputLocation.addEventListener('input', async () => {
                    const municipalities = await fetchMunicipalities();
                    resultsContainer.innerHTML = '';
                    const query = inputLocation.value;

                    if (query.length < 2) {
                        resultsContainer.classList.add('hidden');
                        return;
                    }

                    const normalizedQuery = normalizeString(query);
                    const filtered = municipalities.filter(m => normalizeString(m).includes(normalizedQuery));

                    if (filtered.length > 0) {
                        resultsContainer.classList.remove('hidden');
                        filtered.slice(0, 10).forEach(municipality => {
                            const item = document.createElement('div');
                            item.className = 'px-4 py-2 hover:bg-indigo-50 cursor-pointer text-sm text-gray-700 border-b border-gray-50 last:border-0';
                            item.textContent = municipality;
                            item.onclick = () => {
                                inputLocation.value = municipality;
                                resultsContainer.classList.add('hidden');
                            };
                            resultsContainer.appendChild(item);
                        });
                    } else {
                        resultsContainer.classList.add('hidden');
                    }
                });

                document.addEventListener('click', (e) => {
                    if (e.target !== inputLocation) resultsContainer.classList.add('hidden');
                });

            }, 100);
            break;
        }
        case 'editProjectInfo':
            // 1. Configuración
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            const footerEdit = document.getElementById('modal-confirm-btn')?.parentElement;
            if (footerEdit) footerEdit.style.display = 'none';

            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('overflow-hidden', 'bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-3xl', 'flex', 'flex-col', 'max-h-[90vh]');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            // =========================================================
            //  🔥 CORRECCIÓN: AGREGAR ESTA LÍNEA AQUÍ
            //  Esto guarda el ID del proyecto en el formulario para que el botón Guardar lo encuentre
            // =========================================================
            modalForm.dataset.id = data.id;
            // =========================================================

            title = 'Editar Proyecto';

            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-amber-500 to-orange-600 px-8 py-5 shrink-0 rounded-t-xl flex justify-between items-center relative overflow-hidden">
                        <div class="absolute top-0 right-0 p-4 opacity-10 pointer-events-none transform scale-150 translate-x-4 -translate-y-2">
                            <i class="fa-solid fa-pen-to-square text-6xl text-white"></i>
                        </div>
                        <div class="flex items-center gap-4 relative z-10">
                            <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl backdrop-blur-sm border border-white/10 shadow-inner text-white">
                                <i class="fa-solid fa-pen"></i>
                            </div>
                            <div>
                                <h2 class="text-xl font-bold tracking-tight text-white">Editar Información</h2>
                                <p class="text-amber-100 text-xs font-medium">${data.name}</p>
                            </div>
                        </div>
                        <button onclick="closeMainModal()" class="text-white/70 hover:text-white transition-colors relative z-10"><i class="fa-solid fa-xmark text-xl"></i></button>
                    </div>

                    <div class="flex-grow overflow-y-auto custom-scrollbar p-6 bg-gray-50">
                        
                        <div class="space-y-6">
                            
                            <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-4 flex items-center">
                                    <i class="fa-solid fa-info-circle mr-2 text-amber-500"></i> Información General
                                </h4>
                                
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div class="md:col-span-2">
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Nombre del Proyecto</label>
                                        <input type="text" name="name" required value="${data.name || ''}" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-amber-500 font-bold text-gray-800">
                                    </div>
                                    
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Constructora</label>
                                        <input type="text" name="builderName" required value="${data.builderName || ''}" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-amber-500">
                                    </div>
                                    
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Modelo de Contrato</label>
                                        <select name="pricingModel" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-amber-500 bg-white cursor-pointer">
                                            <option value="separado" ${data.pricingModel === 'separado' ? 'selected' : ''}>Suministro e Instalación (Separado)</option>
                                            <option value="incluido" ${data.pricingModel === 'incluido' ? 'selected' : ''}>Todo Incluido (Global)</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-4 flex items-center">
                                    <i class="fa-solid fa-location-dot mr-2 text-red-500"></i> Ubicación
                                </h4>
                                
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div class="relative">
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Municipio</label>
                                        <div class="relative">
                                            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400"><i class="fa-solid fa-magnifying-glass"></i></div>
                                            <input type="text" id="project-location" name="location" required value="${data.location || ''}" class="w-full pl-9 border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-amber-500" autocomplete="off">
                                        </div>
                                        <div id="municipalities-results" class="municipality-search-results hidden absolute z-50 w-full bg-white border border-gray-200 rounded-lg mt-1 shadow-xl max-h-40 overflow-y-auto"></div>
                                    </div>
                                    
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Dirección Obra</label>
                                        <input type="text" name="address" required value="${data.address || ''}" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-amber-500">
                                    </div>
                                </div>
                            </div>

                            <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-4 flex items-center">
                                    <i class="fa-solid fa-sack-dollar mr-2 text-green-600"></i> Datos del Contrato
                                </h4>

                                <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-4">
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Valor Contrato (Sin IVA)</label>
                                        <div class="relative">
                                            <span class="absolute left-3 top-2.5 text-gray-400 font-bold">$</span>
                                            <input type="text" name="value" required value="${data.value || 0}" class="currency-input w-full pl-7 border-gray-300 rounded-lg p-2.5 text-lg font-bold text-gray-800 focus:ring-amber-500 font-mono">
                                        </div>
                                    </div>
                                    
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Valor Anticipo</label>
                                        <div class="relative">
                                            <span class="absolute left-3 top-2.5 text-gray-400 font-bold">$</span>
                                            <input type="text" name="advance" required value="${data.advance || 0}" class="currency-input w-full pl-7 border-gray-300 rounded-lg p-2.5 text-lg font-bold text-gray-800 focus:ring-amber-500 font-mono">
                                        </div>
                                    </div>
                                </div>

                                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Inicio Contrato</label>
                                        <input type="date" name="startDate" value="${data.startDate || ''}" class="w-full border-gray-300 rounded-lg p-2 text-sm focus:ring-amber-500 text-gray-600">
                                    </div>
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Acta de Inicio</label>
                                        <input type="date" name="kickoffDate" value="${data.kickoffDate || ''}" class="w-full border-gray-300 rounded-lg p-2 text-sm focus:ring-amber-500 text-gray-600">
                                    </div>
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Fin Estimado</label>
                                        <input type="date" name="endDate" value="${data.endDate || ''}" class="w-full border-gray-300 rounded-lg p-2 text-sm focus:ring-amber-500 text-gray-600">
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>

                    <div class="bg-white border-t border-gray-200 p-4 shrink-0 flex justify-end gap-3 rounded-b-xl">
                        <button type="button" onclick="closeMainModal()" class="px-5 py-2.5 rounded-lg text-gray-600 font-bold hover:bg-gray-100 transition-colors text-sm">
                            Cancelar
                        </button>
                        <button type="button" onclick="document.getElementById('modal-form').requestSubmit()" class="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white px-8 py-2.5 rounded-lg font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm flex items-center gap-2">
                            <i class="fa-solid fa-check"></i> Guardar Cambios
                        </button>
                    </div>
                </div>`;

            setTimeout(() => {
                const form = document.getElementById('modal-form');
                if (form) {
                    // Moneda
                    const currencyInputs = form.querySelectorAll('.currency-input');
                    currencyInputs.forEach(setupCurrencyInput);

                    // Buscador Municipios
                    const inputLocation = document.getElementById('project-location');
                    const resultsContainer = document.getElementById('municipalities-results');

                    fetchMunicipalities();

                    inputLocation.addEventListener('input', async () => {
                        const municipalities = await fetchMunicipalities();
                        resultsContainer.innerHTML = '';
                        const query = inputLocation.value;

                        if (query.length < 2) {
                            resultsContainer.classList.add('hidden');
                            return;
                        }

                        const normalizedQuery = normalizeString(query);
                        const filtered = municipalities.filter(m => normalizeString(m).includes(normalizedQuery));

                        if (filtered.length > 0) {
                            resultsContainer.classList.remove('hidden');
                            filtered.slice(0, 10).forEach(municipality => {
                                const item = document.createElement('div');
                                item.className = 'px-4 py-2 hover:bg-amber-50 cursor-pointer text-sm text-gray-700 border-b border-gray-50 last:border-0';
                                item.textContent = municipality;
                                item.onclick = () => {
                                    inputLocation.value = municipality;
                                    resultsContainer.classList.add('hidden');
                                };
                                resultsContainer.appendChild(item);
                            });
                        } else {
                            resultsContainer.classList.add('hidden');
                        }
                    });

                    document.addEventListener('click', (e) => {
                        if (e.target !== inputLocation) resultsContainer.classList.add('hidden');
                    });
                }
            }, 100);
            break;

        case 'init-project-from-quote': {
            // 1. Configuración Visual
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }
            const defaultFooter = document.getElementById('main-modal-footer');
            if (defaultFooter) defaultFooter.style.display = 'none';

            if (modalContentDiv) {
                modalContentDiv.className = '';
                // AGREGADO: clase 'modern-scrollbar' aquí
                modalContentDiv.classList.add('overflow-hidden', 'bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-3xl', 'flex', 'flex-col', 'max-h-[90vh]');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            title = 'Formalizar Proyecto';
            const quoteData = data;
            const config = quoteData.config || {};

            // Lógica de modelo (se mantiene igual)
            let targetModel = 'separado';
            let targetLabel = 'Suministro e Instalación (Separado)';
            if (config.modo === 'AIU' || config.modo === 'IVA_GLOBAL' || config.modo === 'SOLO_TOTAL') {
                targetModel = 'incluido';
                targetLabel = 'Todo Incluido (Global)';
            }

            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-indigo-600 to-purple-600 px-8 py-5 shrink-0 rounded-t-xl flex justify-between items-center relative overflow-hidden">
                        <div class="absolute top-0 right-0 p-4 opacity-10 pointer-events-none transform scale-150 translate-x-4 -translate-y-2">
                            <i class="fa-solid fa-rocket text-6xl text-white"></i>
                        </div>
                        <div class="flex items-center gap-4 relative z-10">
                            <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl backdrop-blur-sm border border-white/10 shadow-inner text-white">
                                <i class="fa-solid fa-check-double"></i>
                            </div>
                            <div>
                                <h2 class="text-xl font-bold tracking-tight text-white">Formalizar Proyecto</h2>
                                <p class="text-indigo-100 text-xs font-medium">Crear proyecto basado en cotización</p>
                            </div>
                        </div>
                        <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white transition-colors relative z-10">
                            <i class="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <div class="flex-grow overflow-y-auto modern-scrollbar p-6 bg-gray-50">
                        
                        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex items-start gap-3">
                            <i class="fa-solid fa-circle-info text-blue-600 mt-1"></i>
                            <div>
                                <p class="text-sm text-blue-800 font-bold">Importación Automática</p>
                                <p class="text-xs text-blue-700">Se creará el proyecto y se importarán automáticamente <strong>${quoteData.items ? quoteData.items.length : 0} ítems</strong> de la cotización.</p>
                            </div>
                        </div>

                        <div class="space-y-6">
                            <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-4">Información del Proyecto</h4>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div class="md:col-span-2">
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Nombre del Proyecto</label>
                                        <input type="text" name="name" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm font-bold text-gray-800" value="${quoteData.proyecto || ''}">
                                    </div>
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Cliente / Constructora</label>
                                        <input type="text" name="builderName" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm" value="${quoteData.cliente || ''}">
                                    </div>
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Modelo de Contrato</label>
                                        <select name="pricingModel" class="w-full border-gray-300 rounded-lg p-2.5 text-sm bg-gray-100 cursor-not-allowed pointer-events-none" readonly>
                                            <option value="${targetModel}" selected>${targetLabel}</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-4">Ubicación y Fechas</h4>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    
                                    <div class="relative">
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Municipio</label>
                                        <input type="text" name="location" id="project-location" required autocomplete="off" 
                                               class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                                               placeholder="Escribe para buscar..." value="${quoteData.location || ''}">
                                        
                                        <div id="municipalities-results" 
                                             class="hidden absolute z-50 w-full bg-white border border-gray-200 rounded-lg mt-1 shadow-xl max-h-40 overflow-y-auto modern-scrollbar">
                                             </div>
                                    </div>
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Dirección</label>
                                        <input type="text" name="address" class="w-full border-gray-300 rounded-lg p-2.5 text-sm" placeholder="Dirección...">
                                    </div>
                                     <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Fecha Inicio</label>
                                        <input type="date" name="startDate" class="w-full border-gray-300 rounded-lg p-2.5 text-sm" value="${quoteData.fecha || ''}">
                                    </div>
                                </div>
                            </div>

                            <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-4">Valores Financieros</h4>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div>
                                        <div>
                                            <label class="block text-xs font-bold text-gray-700 mb-1">Valor Contrato (Desde Cotización)</label>
                                            <div class="relative">
                                                <span class="absolute left-3 top-2.5 text-gray-400 font-bold">$</span>
                                                <input type="text" name="value" required class="currency-input w-full pl-7 border-gray-300 rounded-lg p-2.5 text-lg font-bold text-emerald-600 font-mono" value="${Math.round(quoteData.totalFinal || 0)}">
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Anticipo Pactado</label>
                                        <div class="relative">
                                            <span class="absolute left-3 top-2.5 text-gray-400 font-bold">$</span>
                                            <input type="text" name="advance" class="currency-input w-full pl-7 border-gray-300 rounded-lg p-2.5 text-lg font-bold text-gray-800 font-mono" placeholder="0">
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <input type="hidden" id="hidden-quote-items" value='${JSON.stringify(quoteData.items || []).replace(/'/g, "&#39;")}'>
                            <input type="hidden" id="hidden-quote-config" value='${JSON.stringify(config).replace(/'/g, "&#39;")}'>
                        </div>
                    </div>

                    <div class="bg-white border-t border-gray-200 p-4 shrink-0 flex justify-end gap-3 rounded-b-xl">
                        <button type="button" onclick="closeMainModal()" class="px-5 py-2.5 rounded-lg text-gray-600 font-bold hover:bg-gray-100 transition-colors text-sm">
                            Cancelar
                        </button>
                        <button type="button" onclick="document.getElementById('modal-form').requestSubmit()" class="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-8 py-2.5 rounded-lg font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm flex items-center gap-2">
                            <i class="fa-solid fa-rocket"></i> Crear Proyecto e Importar
                        </button>
                    </div>
                </div>`;

            // --- LÓGICA DE INICIALIZACIÓN ---
            setTimeout(() => {
                const form = document.getElementById('modal-form');
                if (form) {
                    // Inicializar inputs de moneda
                    form.querySelectorAll('.currency-input').forEach(setupCurrencyInput);
                    const valInput = form.querySelector('input[name="value"]');
                    if (valInput) valInput.dispatchEvent(new Event('input'));

                    // --- LÓGICA DE MUNICIPIOS ---
                    const locInput = document.getElementById('project-location');
                    const resultsDiv = document.getElementById('municipalities-results');
                    let cachedCities = []; // Caché local para esta instancia del modal

                    if (locInput && resultsDiv) {
                        locInput.addEventListener('input', async function () {
                            const query = this.value.toLowerCase();

                            // Ocultar si hay menos de 2 letras
                            if (query.length < 2) {
                                resultsDiv.classList.add('hidden');
                                return;
                            }

                            // Llamar a tu función (asegúrate de que esté definida globalmente o aquí mismo)
                            if (cachedCities.length === 0 && typeof fetchMunicipalities === 'function') {
                                try {
                                    // Mostramos carga visual pequeña
                                    resultsDiv.innerHTML = '<div class="p-2 text-xs text-gray-400 text-center">Cargando...</div>';
                                    resultsDiv.classList.remove('hidden');
                                    cachedCities = await fetchMunicipalities();
                                } catch (e) { console.error(e); }
                            }

                            // Filtrar
                            const filtered = cachedCities.filter(c => c.toLowerCase().includes(query));

                            // Renderizar Resultados
                            resultsDiv.innerHTML = '';
                            if (filtered.length > 0) {
                                resultsDiv.classList.remove('hidden');
                                filtered.forEach(city => {
                                    const div = document.createElement('div');
                                    div.className = 'px-3 py-2 hover:bg-indigo-50 cursor-pointer text-sm text-gray-700 border-b border-gray-50 last:border-0';
                                    div.textContent = city;
                                    div.onclick = () => {
                                        locInput.value = city;
                                        resultsDiv.classList.add('hidden');
                                    };
                                    resultsDiv.appendChild(div);
                                });
                            } else {
                                resultsDiv.innerHTML = '<div class="p-2 text-xs text-gray-400 text-center">No se encontraron resultados</div>';
                            }
                        });

                        // Cerrar al hacer clic fuera
                        document.addEventListener('click', (e) => {
                            if (!locInput.contains(e.target) && !resultsDiv.contains(e.target)) {
                                resultsDiv.classList.add('hidden');
                            }
                        });
                    }
                    // -----------------------------
                }
            }, 100);
            break;
        }

        case 'report-entry':
            title = 'Reportar Ingreso';
            btnText = 'Confirmar Ingreso';
            btnClass = 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg w-full sm:w-auto';

            // Ajustamos el ancho para que se vea bien en móviles y escritorio
            if (modalContentDiv) {
                modalContentDiv.classList.remove('max-w-2xl');
                modalContentDiv.classList.add('max-w-lg');
            }

            bodyHtml = `
                <div class="space-y-5">
                    <div class="bg-blue-50 rounded-xl p-4 border border-blue-100 relative overflow-hidden">
                        <div class="flex items-start gap-3 relative z-10">
                            <div class="bg-white p-2 rounded-full text-blue-500 shadow-sm border border-blue-50 shrink-0">
                                <i class="fa-solid fa-location-dot text-xl"></i>
                            </div>
                            <div class="w-full">
                                <h4 class="text-blue-900 font-bold text-sm uppercase tracking-wide mb-1">Ubicación Actual</h4>
                                <p id="entry-location-text" class="text-blue-700 text-xs font-medium">Obteniendo coordenadas...</p>
                                <div id="entry-map-placeholder" class="mt-3 h-32 bg-blue-100/50 rounded-lg border-2 border-dashed border-blue-200 flex items-center justify-center text-blue-300">
                                    <span class="text-xs">Mapa de ubicación</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-2 ml-1">Evidencia Fotográfica (Selfie)</label>
                        
                        <div id="entry-photo-container" class="aspect-[4/5] w-full rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-all group relative overflow-hidden">
                            
                            <div id="entry-photo-placeholder" class="text-center p-6 transition-opacity group-hover:scale-105">
                                <div class="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-3 group-hover:shadow-md transition-all">
                                    <i class="fa-solid fa-camera text-2xl text-gray-400 group-hover:text-emerald-500 transition-colors"></i>
                                </div>
                                <p class="text-sm font-bold text-gray-400 group-hover:text-emerald-600">Tocar para tomar foto</p>
                            </div>

                            <img id="entry-photo-preview" class="absolute inset-0 w-full h-full object-cover hidden" />
                        </div>
                        
                        <input type="file" id="entry-photo-input" name="photo" accept="image/*" capture="user" class="hidden">
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Observaciones (Opcional)</label>
                        <div class="relative group">
                             <div class="absolute top-3.5 left-3 text-gray-400 group-focus-within:text-emerald-500 transition-colors">
                                <i class="fa-regular fa-comment-dots"></i>
                            </div>
                            <textarea name="comments" rows="2" 
                                class="w-full pl-10 pr-4 py-3 border-2 border-gray-100 hover:border-gray-200 rounded-xl text-gray-800 bg-gray-50 focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 outline-none transition-all text-sm font-medium placeholder-gray-400 resize-none"
                                placeholder="Ej: Ingreso a obra Torre 2..."></textarea>
                        </div>
                    </div>
                </div>
            `;

            // Inicialización de eventos específicos para este modal
            setTimeout(() => {
                const container = document.getElementById('entry-photo-container');
                const input = document.getElementById('entry-photo-input');
                const preview = document.getElementById('entry-photo-preview');
                const placeholder = document.getElementById('entry-photo-placeholder');

                if (container && input) {
                    // Al hacer clic en la caja, abrir cámara
                    container.addEventListener('click', () => input.click());

                    // Al seleccionar archivo, mostrar preview
                    input.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (evt) => {
                                preview.src = evt.target.result;
                                preview.classList.remove('hidden');
                                placeholder.classList.add('hidden');
                                container.classList.remove('border-dashed', 'bg-gray-50');
                                container.classList.add('border-emerald-500');
                            };
                            reader.readAsDataURL(file);
                        }
                    });
                }
            }, 100);
            break;

        case 'compare-prices': {
            // 1. Configuración Visual
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            title = 'Comparativa de Precios';
            btnText = 'Cerrar';
            btnClass = 'bg-gray-500 hover:bg-gray-600';
            modalContentDiv.classList.add('max-w-lg');

            // 2. Lógica de Cálculo (Top 3)
            // Usamos el cachedRecentPOs que ya tenemos cargado
            const materialId = data.materialId;
            const materialName = data.name;
            const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

            // Agrupar por proveedor, tomando su MEJOR precio (el más bajo)
            const pricesBySupplier = new Map();

            // Incluir el precio base manual asignado directamente en el catálogo (si existe)
            if (data.basePrice && data.basePrice > 0) {
                const manualSupplier = data.assignedSupplierName || 'Catálogo (Manual)';
                pricesBySupplier.set(manualSupplier, {
                    price: data.basePrice,
                    date: new Date(),
                    poNumber: 'Manual'
                });
            }

            const recentPOs = getCachedRecentPOs() || [];
            recentPOs.forEach(po => {
                if (po.items && Array.isArray(po.items)) {
                    const item = po.items.find(i => i.materialId === materialId);
                    if (item && item.unitCost > 0) {
                        const supplierName = po.supplierName || po.provider || 'Desconocido';
                        const currentBest = pricesBySupplier.get(supplierName);

                        if (!currentBest || item.unitCost < currentBest.price) {
                            pricesBySupplier.set(supplierName, {
                                price: item.unitCost,
                                date: po.createdAt ? po.createdAt.toDate() : new Date(),
                                poNumber: po.poNumber || po.id.substring(0, 6)
                            });
                        }
                    }
                }
            });

            // Convertir a array, ordenar por precio ASC y tomar top 3
            const topSuppliers = Array.from(pricesBySupplier.entries())
                .map(([name, data]) => ({ name, ...data }))
                .sort((a, b) => a.price - b.price)
                .slice(0, 3);

            // 3. Generar HTML de la lista
            let listHtml = '';
            if (topSuppliers.length === 0) {
                listHtml = `
                    <div class="text-center py-10">
                        <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3 text-gray-400">
                            <i class="fa-solid fa-magnifying-glass-dollar text-3xl"></i>
                        </div>
                        <p class="text-gray-500 font-medium">No hay historial de compras para este ítem.</p>
                    </div>`;
            } else {
                listHtml = `<div class="space-y-3">`;
                topSuppliers.forEach((sup, index) => {
                    const isBest = index === 0;
                    const medalColor = isBest ? 'text-yellow-400' : (index === 1 ? 'text-gray-400' : 'text-orange-400');
                    const borderClass = isBest ? 'border-emerald-500 ring-1 ring-emerald-500/30 bg-emerald-50/30' : 'border-gray-200 bg-white';

                    listHtml += `
                        <div class="flex items-center justify-between p-4 rounded-xl border ${borderClass} relative overflow-hidden">
                            ${isBest ? '<div class="absolute top-0 left-0 bg-emerald-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-br-lg">MEJOR OPCIÓN</div>' : ''}
                            
                            <div class="flex items-center gap-4">
                                <div class="text-center w-8">
                                    <i class="fa-solid fa-medal ${medalColor} text-2xl drop-shadow-sm"></i>
                                </div>
                                <div>
                                    <p class="font-bold text-slate-800">${sup.name}</p>
                                    <p class="text-xs text-slate-500 flex items-center gap-1">
                                        <i class="fa-regular fa-clock"></i> ${sup.date.toLocaleDateString('es-CO')} 
                                        <span class="text-gray-300 mx-1">|</span> 
                                        Ref: ${sup.poNumber}
                                    </p>
                                </div>
                            </div>
                            
                            <div class="text-right">
                                <p class="text-xl font-black ${isBest ? 'text-emerald-600' : 'text-slate-700'}">${currencyFormatter.format(sup.price)}</p>
                                <p class="text-[10px] text-slate-400 font-medium uppercase">por unidad</p>
                            </div>
                        </div>
                    `;
                });
                listHtml += `</div>`;
            }

            bodyHtml = `
                <div class="-mx-6 -mt-6 mb-6 bg-indigo-600 px-6 py-5 rounded-t-lg text-white flex justify-between items-center shadow-md">
                    <div class="flex items-center gap-3">
                        <div class="p-2 bg-white/20 rounded-lg backdrop-blur-sm"><i class="fa-solid fa-scale-balanced text-xl"></i></div>
                        <div>
                            <h3 class="font-bold text-lg leading-tight">Comparativa de Precios</h3>
                            <p class="text-xs text-indigo-200 font-medium truncate max-w-[200px]">${materialName}</p>
                        </div>
                    </div>
                    <button onclick="closeMainModal()" class="text-white/70 hover:text-white"><i class="fa-solid fa-xmark text-xl"></i></button>
                </div>
                
                <div class="px-2 pb-4">
                    ${listHtml}
                    
                    <div class="mt-6 p-3 bg-blue-50 rounded-lg flex items-start gap-3 border border-blue-100">
                        <i class="fa-solid fa-circle-info text-blue-500 mt-0.5"></i>
                        <p class="text-xs text-blue-700 leading-relaxed">
                            <strong>Nota:</strong> Estos precios se basan en las últimas 200 órdenes recibidas. Los precios de mercado pueden haber cambiado.
                        </p>
                    </div>
                </div>
            `;

            // Ocultar botón de acción principal (es solo informativo)
            setTimeout(() => {
                const footerBtn = document.getElementById('modal-confirm-btn');
                if (footerBtn) footerBtn.style.display = 'none';
            }, 0);

            break;
        }

        case 'view-my-payment-history':
            title = 'Mi Historial Financiero';
            btnText = 'Cerrar';
            btnClass = 'bg-gray-500 hover:bg-gray-600';

            if (document.getElementById('modal-confirm-btn')) {
                document.getElementById('modal-confirm-btn').style.display = 'none';
            }

            bodyHtml = `
                <div class="flex flex-col h-[70vh]">
                    <div class="flex border-b border-gray-200 mb-4">
                        <button type="button" id="tab-my-payments" class="flex-1 py-3 text-sm font-bold text-blue-600 border-b-2 border-blue-600 focus:outline-none transition-colors">
                            <i class="fa-solid fa-file-invoice-dollar mr-2"></i> Nómina
                        </button>
                        <button type="button" id="tab-my-loans" class="flex-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 focus:outline-none transition-colors">
                            <i class="fa-solid fa-hand-holding-dollar mr-2"></i> Préstamos
                        </button>
                    </div>

                    <div id="my-financial-content" class="flex-grow overflow-y-auto custom-scrollbar p-1">
                        <div class="text-center py-10"><div class="loader mx-auto"></div></div>
                    </div>
                </div>
            `;

            setTimeout(() => {
                const container = document.getElementById('my-financial-content');
                const tabPayments = document.getElementById('tab-my-payments');
                const tabLoans = document.getElementById('tab-my-loans');
                const userId = data.userId;

                // Función: Cargar Nómina
                const loadPayments = async () => {
                    tabPayments.className = "flex-1 py-3 text-sm font-bold text-blue-600 border-b-2 border-blue-600 transition-colors";
                    tabLoans.className = "flex-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent transition-colors";

                    container.innerHTML = '<div class="text-center py-10"><div class="loader mx-auto"></div></div>';

                    try {
                        const q = query(collection(db, "users", userId, "paymentHistory"), orderBy("createdAt", "desc"));
                        const snapshot = await getDocs(q);

                        if (snapshot.empty) {
                            container.innerHTML = `<div class="text-center py-10 text-gray-400"><i class="fa-solid fa-folder-open text-4xl mb-2 opacity-30"></i><p>No hay pagos registrados.</p></div>`;
                            return;
                        }

                        let html = `<div class="space-y-3">`;
                        snapshot.forEach(doc => {
                            const p = doc.data();
                            const date = p.paymentDate || (p.createdAt ? p.createdAt.toDate().toISOString().split('T')[0] : 'N/A');

                            html += `
                                <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex justify-between items-center hover:shadow-md transition-all">
                                    <div>
                                        <p class="text-xs text-gray-400 font-bold uppercase">${date}</p>
                                        <h4 class="text-sm font-bold text-gray-800">${p.concepto}</h4>
                                        <p class="text-xs text-emerald-600 font-bold mt-1">${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(p.monto)}</p>
                                    </div>
                                    <button class="btn-view-voucher text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-colors" data-payment='${JSON.stringify(p)}'>
                                        <i class="fa-solid fa-eye text-lg"></i>
                                    </button>
                                </div>`;
                        });
                        html += `</div>`;
                        container.innerHTML = html;

                        // Listener para ver comprobante
                        container.querySelectorAll('.btn-view-voucher').forEach(btn => {
                            btn.addEventListener('click', async () => {
                                const paymentData = JSON.parse(btn.dataset.payment);
                                // Necesitamos los datos del usuario para el comprobante
                                const userDoc = await getDoc(doc(db, "users", userId));
                                if (userDoc.exists()) {
                                    // Reutilizamos tu función existente
                                    // (Asegúrate de que openPaymentVoucherModal esté accesible globalmente o impórtala)
                                    if (window.openPaymentVoucherModal) {
                                        window.openPaymentVoucherModal(paymentData, { id: userDoc.id, ...userDoc.data() });
                                    } else {
                                        console.error("Error: La función de comprobantes no se ha cargado desde empleados.js");
                                    }
                                }
                            });
                        });

                    } catch (e) {
                        console.error(e);
                        container.innerHTML = `<p class="text-red-500 text-center">Error al cargar pagos.</p>`;
                    }
                };

                // Función: Cargar Préstamos
                const loadLoans = async () => {
                    // 1. Gestión de Pestañas Visual
                    tabLoans.className = "flex-1 py-3 text-sm font-bold text-indigo-600 border-b-2 border-indigo-600 transition-colors bg-indigo-50/50";
                    tabPayments.className = "flex-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent transition-colors hover:bg-gray-50";

                    container.innerHTML = '<div class="text-center py-10"><div class="loader mx-auto"></div><p class="text-xs text-gray-400 mt-2">Calculando saldos...</p></div>';

                    // Formateador local para evitar errores de scope
                    const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

                    try {
                        // 2. Consulta: Todos los préstamos ordenados por fecha
                        const q = query(collection(db, "users", userId, "loans"), orderBy("createdAt", "desc"));
                        const snapshot = await getDocs(q);

                        if (snapshot.empty) {
                            container.innerHTML = `
                                <div class="flex flex-col items-center justify-center py-12 text-gray-400 border-2 border-dashed border-gray-100 rounded-xl m-4">
                                    <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                                        <i class="fa-solid fa-piggy-bank text-3xl text-gray-300"></i>
                                    </div>
                                    <p class="font-medium text-gray-600">No tienes historial de préstamos.</p>
                                    <p class="text-xs">¡Excelente salud financiera!</p>
                                </div>`;
                            return;
                        }

                        // 3. Cálculos de Totales
                        let totalDebt = 0;       // Lo que debe hoy
                        let totalBorrowed = 0;   // Lo que pidió prestado en total (histórico)
                        let totalPaid = 0;       // Lo que ya pagó (histórico)
                        let cardsHtml = '';

                        snapshot.forEach(doc => {
                            const l = doc.data();

                            // Solo sumamos a la deuda actual si está ACTIVO
                            if (l.status === 'active') {
                                totalDebt += (l.balance || 0);
                            }

                            // Sumamos históricos (excluyendo rechazados)
                            if (l.status !== 'rejected') {
                                totalBorrowed += (l.amount || 0);
                                totalPaid += ((l.amount || 0) - (l.balance || 0));
                            }

                            // Cálculos Individuales
                            const originalAmount = l.amount || 0;
                            const currentBalance = l.balance || 0;
                            const paidAmount = originalAmount - currentBalance;

                            // Porcentaje de progreso (Evitar división por 0)
                            let progress = 0;
                            if (originalAmount > 0) {
                                progress = (paidAmount / originalAmount) * 100;
                            }

                            // Configuración Visual según Estado
                            let statusConfig = { label: 'Desconocido', color: 'gray', bg: 'bg-gray-100', icon: 'fa-question' };

                            if (l.status === 'active') {
                                statusConfig = { label: 'Activo (Debiendo)', color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200', icon: 'fa-circle-play', barColor: 'bg-indigo-500' };
                            } else if (l.status === 'paid') {
                                statusConfig = { label: 'Pagado Totalmente', color: 'text-green-700', bg: 'bg-green-50 border-green-200', icon: 'fa-circle-check', barColor: 'bg-green-500' };
                                progress = 100; // Forzar visualmente
                            } else if (l.status === 'pending') {
                                statusConfig = { label: 'En Revisión', color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200', icon: 'fa-clock', barColor: 'bg-yellow-400' };
                            } else if (l.status === 'rejected') {
                                statusConfig = { label: 'Rechazado', color: 'text-red-700', bg: 'bg-red-50 border-red-200', icon: 'fa-ban', barColor: 'bg-red-400' };
                            }

                            // Fecha
                            const dateStr = l.date ? new Date(l.date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Fecha N/A';

                            // Render Tarjeta
                            cardsHtml += `
                                <div class="bg-white p-4 rounded-xl border ${statusConfig.bg.includes('border') ? '' : 'border-gray-200'} ${statusConfig.bg} shadow-sm mb-3 relative overflow-hidden group">
                                    
                                    <div class="flex justify-between items-start mb-3 relative z-10">
                                        <div>
                                            <div class="flex items-center gap-2 mb-1">
                                                <span class="text-[10px] font-bold uppercase tracking-wider ${statusConfig.color} bg-white/60 px-2 py-0.5 rounded backdrop-blur-sm border border-black/5">
                                                    <i class="fa-solid ${statusConfig.icon} mr-1"></i> ${statusConfig.label}
                                                </span>
                                                <span class="text-[10px] text-gray-500 font-medium">${dateStr}</span>
                                            </div>
                                            <p class="text-sm font-bold text-gray-800 leading-tight">${l.description || 'Sin concepto'}</p>
                                            <p class="text-[10px] text-gray-500 mt-0.5">Pactado a ${l.installments || 1} cuotas</p>
                                        </div>
                                        <div class="text-right">
                                            <p class="text-xs text-gray-400 uppercase font-bold">Monto Original</p>
                                            <p class="text-lg font-black text-gray-800">${fmt.format(originalAmount)}</p>
                                        </div>
                                    </div>
                                    
                                    <div class="relative z-10">
                                        <div class="flex justify-between text-xs mb-1 font-medium">
                                            <span class="${statusConfig.color}">${Math.round(progress)}% Pagado</span>
                                            <span class="text-gray-600">Saldo: <span class="font-bold ${l.balance > 0 ? 'text-red-600' : 'text-green-600'}">${fmt.format(currentBalance)}</span></span>
                                        </div>
                                        <div class="w-full bg-white/50 rounded-full h-2 border border-black/5">
                                            <div class="${statusConfig.barColor || 'bg-gray-400'} h-2 rounded-full transition-all duration-1000" style="width: ${progress}%"></div>
                                        </div>
                                    </div>

                                    <div class="absolute -right-4 -bottom-4 text-9xl opacity-5 pointer-events-none text-black">
                                        <i class="fa-solid fa-hand-holding-dollar"></i>
                                    </div>
                                </div>`;
                        });

                        // 4. Renderizar Contenedor Completo
                        container.innerHTML = `
                            <div class="px-2 pb-2">
                                <div class="grid grid-cols-2 gap-3 mb-4">
                                    <div class="bg-red-50 border border-red-100 p-3 rounded-xl flex flex-col justify-center text-center shadow-sm">
                                        <p class="text-[10px] font-bold text-red-400 uppercase tracking-wide">Deuda Actual</p>
                                        <p class="text-xl font-black text-red-600 tracking-tight">${fmt.format(totalDebt)}</p>
                                    </div>
                                    <div class="bg-emerald-50 border border-emerald-100 p-3 rounded-xl flex flex-col justify-center text-center shadow-sm">
                                        <p class="text-[10px] font-bold text-emerald-500 uppercase tracking-wide">Total Pagado</p>
                                        <p class="text-xl font-black text-emerald-700 tracking-tight">${fmt.format(totalPaid)}</p>
                                    </div>
                                </div>

                                <div class="space-y-1">
                                    ${cardsHtml}
                                </div>
                            </div>
                        `;

                    } catch (e) {
                        console.error(e);
                        container.innerHTML = `<div class="p-6 text-center"><p class="text-red-500 text-sm font-bold">Error al cargar préstamos.</p><p class="text-xs text-gray-400">${e.message}</p></div>`;
                    }
                };

                // Event Listeners
                tabPayments.onclick = loadPayments;
                tabLoans.onclick = loadLoans;

                // Carga inicial
                loadPayments();

            }, 100);
            break;

        case 'camera_entry': // <--- ESTE ES EL CASO QUE FALTA
            title = '📸 Validación de Ingreso';
            // Ocultamos el botón por defecto porque ingresopersonal.js tiene sus propios botones
            btnText = '';
            btnClass = 'hidden';

            // Ocultamos el footer estándar del modal para usar los botones personalizados
            if (document.getElementById('main-modal-footer')) {
                document.getElementById('main-modal-footer').style.display = 'none';
            }

            bodyHtml = `
                <div class="flex flex-col items-center justify-center space-y-6 py-4">
                    <div class="relative w-64 h-64 sm:w-80 sm:h-80 bg-black rounded-full overflow-hidden shadow-2xl border-4 border-emerald-500 ring-4 ring-emerald-100">
                        <video id="entry-camera-video" autoplay playsinline class="w-full h-full object-cover transform scale-x-[-1]"></video>
                        <canvas id="entry-camera-canvas" class="absolute top-0 left-0 w-full h-full hidden"></canvas>
                        <div class="absolute inset-0 border-2 border-white/40 rounded-full m-8 pointer-events-none border-dashed animate-pulse"></div>
                    </div>
                    
                    <div id="entry-status-msg" class="text-center min-h-[2.5rem] flex items-center justify-center px-4">
                        <p class="text-slate-600 font-medium text-sm bg-slate-100 px-4 py-1 rounded-full">
                            <i class="fa-solid fa-face-viewfinder mr-2"></i>Ubica tu rostro en el círculo
                        </p>
                    </div>

                    <div class="flex gap-4 w-full justify-center px-4">
                        <button type="button" id="btn-cancel-entry" class="flex-1 max-w-[120px] bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 py-3 rounded-xl font-bold transition-colors shadow-sm">
                            Cancelar
                        </button>
                        <button id="btn-capture-entry" class="flex-1 max-w-[200px] bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white py-3 rounded-xl font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
                            <i class="fa-solid fa-camera"></i> 
                            <span>Validar Ingreso</span>
                        </button>
                    </div>
                    
                    <div class="text-[10px] text-slate-400 text-center mt-2">
                        <i class="fa-solid fa-location-dot mr-1"></i> Se registrará tu ubicación y biometría.
                    </div>
                </div>
            `;
            break;

        case 'generate-certification':
            // 1. RESETEO DE FORMATO (CRÍTICO)
            if (modalContentDiv) {
                // Borramos todas las clases de layout que pudieron quedar de 'editUser'
                modalContentDiv.className = '';
                // Aplicamos clases base limpias para un modal pequeño
                modalContentDiv.classList.add('bg-white', 'rounded-lg', 'shadow-xl', 'transform', 'transition-all', 'w-full', 'max-w-md', 'p-6', 'relative', 'overflow-hidden');

                // Restauramos padding del body
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.parentElement.classList.remove('overflow-hidden');
                modalBody.style.padding = '';
            }

            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            title = 'Generar Certificación Laboral';
            btnText = 'Descargar PDF';
            btnClass = 'bg-blue-600 hover:bg-blue-700 text-white w-full shadow-md';

            // 2. FECHAS SUGERIDAS
            // Inicio: Contrato > Creación > Hoy
            const startDateVal = data.contractStartDate || (data.createdAt ? new Date(data.createdAt.seconds * 1000).toISOString().split('T')[0] : '');
            // Fin: Contrato > Vacío
            const endDateVal = data.contractEndDate || '';

            // 3. LÓGICA SALARIO
            const isSalaryLocked = !!data.forceNoSalary;
            const salaryChecked = isSalaryLocked ? '' : 'checked';
            const salaryStateClass = isSalaryLocked ? 'opacity-60 cursor-not-allowed bg-gray-100' : 'hover:bg-gray-50 cursor-pointer';
            const salaryHelp = isSalaryLocked ? 'Deshabilitado: Formato sin sueldo.' : `Mostrar sueldo básico mensual ($ ${new Intl.NumberFormat('es-CO').format(data.salarioBasico || 0)})`;

            bodyHtml = `
                <div class="space-y-5">
                    <div class="text-center border-b border-gray-100 pb-4 mb-2">
                        <div class="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-2xl mx-auto mb-2">
                            <i class="fa-solid fa-file-contract"></i>
                        </div>
                        <h3 class="text-lg font-bold text-gray-800">Certificación Laboral</h3>
                        <p class="text-xs text-gray-500 font-medium">${data.firstName} ${data.lastName}</p>
                    </div>

                    <div class="bg-blue-50 p-3 rounded-lg border border-blue-100 flex items-start gap-3">
                        <i class="fa-solid fa-circle-info text-blue-500 mt-0.5 text-sm"></i>
                        <p class="text-xs text-blue-700">
                            Si hay fecha de fin, se generará como <strong>Término Fijo</strong>. <br>
                            Si se deja vacía, se generará como <strong>Hasta la fecha</strong>.
                        </p>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Inicio</label>
                            <input type="date" name="startDate" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value="${startDateVal}" required>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Fin</label>
                            <input type="date" name="endDate" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value="${endDateVal}">
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Cargo</label>
                        <input type="text" name="jobTitle" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm font-bold text-gray-700" value="${data.jobTitle || 'Operario de Vidrio y Aluminio'}" required>
                    </div>
                    
                    <div class="flex items-center justify-between p-3 border rounded-lg transition-colors ${salaryStateClass}" ${isSalaryLocked ? '' : 'onclick="document.getElementById(\'include-salary\').click()"'}>
                        <div>
                            <p class="text-sm font-bold text-gray-700">Incluir Salario</p>
                            <p class="text-xs text-gray-500">${salaryHelp}</p>
                        </div>
                        <input type="checkbox" id="include-salary" name="includeSalary" class="w-5 h-5 text-blue-600 rounded focus:ring-blue-500" ${salaryChecked} ${isSalaryLocked ? 'disabled' : ''}>
                    </div>
                    
                    <div class="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors" onclick="document.getElementById('include-logo').click()">
                        <div>
                            <p class="text-sm font-bold text-gray-700">Usar Papelería (Logo)</p>
                            <p class="text-xs text-gray-500">Incluir encabezado y pie de página</p>
                        </div>
                        <input type="checkbox" id="include-logo" name="includeLogo" class="w-5 h-5 text-blue-600 rounded focus:ring-blue-500" checked>
                    </div>

                    <input type="hidden" name="salarioBasico" value="${data.salarioBasico || 0}">
                    <input type="hidden" name="fullName" value="${data.firstName} ${data.lastName}">
                    <input type="hidden" name="idNumber" value="${data.idNumber}">
                </div>
            `;
            break;



        // --- CASO: REVISIÓN DE PRÉSTAMO (MODAL DE APROBACIÓN) ---
        case 'review-loan': {
            // 1. Configuración Visual
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            // Ocultamos el footer por defecto para usar el personalizado
            const defaultFooter = document.getElementById('main-modal-footer');
            if (defaultFooter) defaultFooter.style.display = 'none';

            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-3xl', 'flex', 'flex-col', 'max-h-[90vh]', 'overflow-hidden');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            title = 'Aprobar Préstamo';
            const fmtMoney = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-emerald-600 to-green-600 px-6 py-5 shrink-0 rounded-t-xl flex justify-between items-center relative overflow-hidden">
                        <div class="flex items-center gap-4 text-white relative z-10">
                            <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl border border-white/10 shadow-inner">
                                <i class="fa-solid fa-file-signature"></i>
                            </div>
                            <div>
                                <h2 class="text-xl font-bold">Aprobación de Crédito</h2>
                                <p class="text-emerald-100 text-xs font-medium">Revisión final y autorización</p>
                            </div>
                        </div>
                        <button onclick="closeMainModal()" class="text-white/70 hover:text-white transition-colors relative z-10">
                            <i class="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <div class="p-6 bg-gray-50 flex-grow overflow-y-auto custom-scrollbar space-y-6">
                        
                        <input type="hidden" name="loanId" value="${data.id}">
                        <input type="hidden" name="userId" value="${data.uid}">

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            
                            <div class="space-y-4">
                                <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                                    <img src="${data.userPhoto}" alt="Perfil" class="w-14 h-14 rounded-full object-cover border-2 border-emerald-100 p-0.5">
                                    <div>
                                        <p class="text-[10px] text-gray-400 uppercase font-bold tracking-wide">Solicitante</p>
                                        <p class="font-bold text-gray-800 text-lg leading-tight">${data.userName}</p>
                                    </div>
                                </div>

                                <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                    <p class="text-xs text-gray-400 uppercase font-bold mb-3 border-b border-gray-100 pb-1">Solicitud Original</p>
                                    <div class="flex justify-between items-end mb-2">
                                        <span class="text-2xl font-black text-gray-700">${fmtMoney.format(data.amount)}</span>
                                        <span class="text-xs bg-gray-100 px-2 py-1 rounded text-gray-500 font-bold">${data.installments} Cuotas</span>
                                    </div>
                                    <div class="bg-gray-50 p-3 rounded-lg border border-gray-100 text-sm text-gray-600 italic">
                                        "${data.description}"
                                    </div>
                                </div>
                            </div>

                            <div class="space-y-4">
                                <div class="bg-emerald-50 p-5 rounded-xl border border-emerald-100 shadow-sm">
                                    <h4 class="text-sm font-bold text-emerald-800 mb-4 flex items-center">
                                        <i class="fa-solid fa-gavel mr-2"></i> Condiciones de Aprobación
                                    </h4>

                                    <div class="space-y-4">
                                        <div>
                                            <label class="block text-xs font-bold text-emerald-700 mb-1 uppercase">Monto Aprobado</label>
                                            <div class="relative">
                                                <span class="absolute left-3 top-2.5 text-emerald-500 font-bold text-lg">$</span>
                                                <input type="text" name="approvedAmount" required 
                                                    class="currency-input w-full pl-7 border border-emerald-200 rounded-lg p-2.5 text-xl font-black text-emerald-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none bg-white shadow-sm" 
                                                    value="${data.amount}">
                                            </div>
                                        </div>
                                        
                                        <div>
                                            <label class="block text-xs font-bold text-emerald-700 mb-1 uppercase">Cuotas Finales</label>
                                            <input type="number" name="approvedInstallments" min="1" max="24" required 
                                                class="w-full border border-emerald-200 rounded-lg p-2.5 text-emerald-900 font-bold focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-white shadow-sm" 
                                                value="${data.installments}">
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Nota Interna (Opcional)</label>
                                    <textarea name="adminNotes" rows="2" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none resize-none" placeholder="Ej: Aprobado según capacidad de pago..."></textarea>
                                </div>
                            </div>
                        </div>

                        <div class="bg-indigo-50 rounded-xl p-4 border border-indigo-100 flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <div class="p-2 bg-white rounded-lg text-indigo-600 shadow-sm"><i class="fa-solid fa-building-columns"></i></div>
                                <div>
                                    <p class="text-[10px] text-indigo-400 uppercase font-bold">Girar a:</p>
                                    <p class="text-sm font-bold text-indigo-900">${data.bankName} - ${data.accountType}</p>
                                </div>
                            </div>
                            <div class="text-right">
                                <div class="flex items-center gap-2 bg-white px-3 py-1.5 rounded border border-indigo-100 shadow-sm cursor-pointer hover:bg-indigo-50 transition-colors" onclick="navigator.clipboard.writeText('${data.accountNumber}'); window.showToast('Cuenta copiada', 'success')">
                                    <span class="font-mono text-sm font-bold text-gray-700 select-all">${data.accountNumber}</span>
                                    <i class="fa-regular fa-copy text-xs text-indigo-400"></i>
                                </div>
                            </div>
                        </div>

                    </div>

                    <div class="bg-white border-t border-gray-200 p-4 shrink-0 flex justify-between items-center rounded-b-xl">
                        <button type="button" id="btn-reject-loan-modal" class="text-red-500 hover:text-red-700 hover:bg-red-50 px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2">
                            <i class="fa-solid fa-ban"></i> Rechazar
                        </button>

                        <div class="flex gap-3">
                            <button type="button" onclick="closeMainModal()" class="px-5 py-2.5 rounded-lg text-gray-600 font-bold hover:bg-gray-100 transition-colors text-sm">
                                Cancelar
                            </button>
                            <button type="button" id="btn-approve-final" class="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-2.5 rounded-lg font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm flex items-center gap-2">
                                <i class="fa-solid fa-check"></i> Aprobar
                            </button>
                        </div>
                    </div>
                </div>
            `;

            setTimeout(() => {
                // Configurar moneda
                const amountInput = modalForm.querySelector('input[name="approvedAmount"]');
                setupCurrencyInput(amountInput);

                // Referencias
                const loanId = modalForm.querySelector('input[name="loanId"]').value;
                const userId = modalForm.querySelector('input[name="userId"]').value;
                const notesInput = modalForm.querySelector('textarea[name="adminNotes"]');
                const installmentsInput = modalForm.querySelector('input[name="approvedInstallments"]');

                // --- LÓGICA DE APROBACIÓN ---
                const approveBtn = document.getElementById('btn-approve-final');
                approveBtn.addEventListener('click', async () => {
                    const approvedVal = parseFloat(amountInput.value.replace(/[$. ]/g, '')) || 0;
                    const approvedInstallments = parseInt(installmentsInput.value) || 1;
                    const notes = notesInput.value;
                    const currentUser = auth.currentUser; // <-- CORRECCIÓN: Usamos auth.currentUser

                    if (approvedVal <= 0) {
                        window.showToast("El monto aprobado debe ser mayor a 0.", "error");
                        return;
                    }

                    approveBtn.disabled = true;
                    approveBtn.innerHTML = '<div class="loader-small-white mx-auto"></div>';

                    try {
                        // Actualizar en Firestore
                        await updateDoc(doc(db, "users", userId, "loans", loanId), {
                            status: 'active', // Pasa de pending a active
                            amount: approvedVal, // Puede haber cambiado
                            balance: approvedVal, // El saldo inicial es el monto aprobado
                            installments: approvedInstallments,
                            approvedAt: serverTimestamp(),
                            approvedBy: currentUser ? currentUser.uid : 'admin',
                            adminNotes: notes
                        });

                        window.showToast("Préstamo aprobado y activado.", "success");
                        closeMainModal();

                        // Refrescar lista de pendientes
                        setTimeout(() => openMainModal('view-pending-loans'), 500);

                    } catch (error) {
                        console.error("Error aprobando:", error);
                        window.showToast("Error al aprobar.", "error");
                        approveBtn.disabled = false;
                        approveBtn.textContent = "Aprobar";
                    }
                });

                // --- LÓGICA DE RECHAZO ---
                document.getElementById('btn-reject-loan-modal').addEventListener('click', () => {
                    const currentUser = auth.currentUser; // <-- CORRECCIÓN

                    openConfirmModal("¿Rechazar solicitud definitivamente?", async () => {
                        try {
                            await updateDoc(doc(db, "users", userId, "loans", loanId), {
                                status: 'rejected',
                                rejectedAt: serverTimestamp(),
                                rejectedBy: currentUser ? currentUser.uid : 'admin',
                                adminNotes: notesInput.value || 'Rechazado por administración'
                            });
                            window.showToast("Solicitud rechazada.", "success");
                            closeMainModal();
                            setTimeout(() => openMainModal('view-pending-loans'), 500);
                        } catch (e) {
                            console.error(e);
                            window.showToast("Error al rechazar.", "error");
                        }
                    });
                });
            }, 100);
            break;
        }

        // --- CASO: HISTORIAL COMPLETO DE PRÉSTAMOS (NUEVO) ---
        case 'view-loan-history': {
            // 1. Configuración Visual
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }
            const defaultFooter = document.getElementById('main-modal-footer');
            if (defaultFooter) defaultFooter.style.display = 'none';

            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-2xl', 'flex', 'flex-col', 'max-h-[85vh]');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            title = 'Historial de Créditos';
            const fmtMoney = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-5 shrink-0 rounded-t-xl flex justify-between items-center relative overflow-hidden">
                        <div class="flex items-center gap-3 text-white z-10 relative">
                            <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-xl border border-white/10">
                                <i class="fa-solid fa-clock-rotate-left"></i>
                            </div>
                            <div>
                                <h2 class="text-lg font-bold">Historial de Créditos</h2>
                                <p class="text-slate-300 text-xs font-medium">Trazabilidad completa de préstamos</p>
                            </div>
                        </div>
                        <button onclick="closeMainModal()" class="text-white/70 hover:text-white transition-colors relative z-10">
                            <i class="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <div id="loan-history-list" class="p-6 bg-gray-50 flex-grow overflow-y-auto custom-scrollbar space-y-4">
                        <div class="flex justify-center items-center h-32">
                            <div class="loader"></div>
                        </div>
                    </div>
                </div>
            `;

            setTimeout(async () => {
                const listContainer = document.getElementById('loan-history-list');
                const userId = data.userId; // ID del usuario pasado al abrir el modal

                try {
                    // Consultar TODOS los préstamos ordenados por fecha (más reciente primero)
                    const q = query(
                        collection(db, "users", userId, "loans"),
                        orderBy("date", "desc") // O createdAt
                    );
                    const snapshot = await getDocs(q);

                    if (snapshot.empty) {
                        listContainer.innerHTML = `
                            <div class="text-center py-10 text-gray-400">
                                <i class="fa-solid fa-folder-open text-4xl mb-2 opacity-30"></i>
                                <p>Este usuario no tiene historial de préstamos.</p>
                            </div>`;
                        return;
                    }

                    listContainer.innerHTML = '';

                    snapshot.forEach(doc => {
                        const loan = doc.data();

                        // Configuración de Estilos según Estado
                        let statusConfig = {
                            color: 'gray',
                            bg: 'bg-gray-100',
                            text: 'text-gray-600',
                            label: 'Desconocido',
                            icon: 'fa-circle-question'
                        };

                        let footerHtml = '';

                        if (loan.status === 'active') {
                            statusConfig = { color: 'emerald', bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Activo', icon: 'fa-circle-play' };
                            // Barra de progreso para activos
                            const progress = Math.max(0, ((loan.amount - (loan.balance || 0)) / loan.amount) * 100);
                            footerHtml = `
                                <div class="mt-3">
                                    <div class="flex justify-between text-[10px] text-gray-500 mb-1">
                                        <span>Progreso Pago</span>
                                        <span class="font-bold text-emerald-600">${fmtMoney.format(loan.balance)} Pendiente</span>
                                    </div>
                                    <div class="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                        <div class="bg-emerald-500 h-1.5 rounded-full transition-all" style="width: ${progress}%"></div>
                                    </div>
                                </div>
                            `;
                        } else if (loan.status === 'paid') {
                            statusConfig = { color: 'blue', bg: 'bg-blue-50', text: 'text-blue-700', label: 'Pagado', icon: 'fa-circle-check' };

                            // FECHA DE CANCELACIÓN
                            const paidDate = loan.paidAt ? new Date(loan.paidAt.seconds * 1000).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Fecha desconocida';

                            footerHtml = `
                                <div class="mt-3 pt-2 border-t border-blue-100 flex items-center gap-2 text-xs text-blue-800 bg-blue-50/50 p-2 rounded-lg">
                                    <i class="fa-solid fa-calendar-check text-blue-500"></i>
                                    <span>Cancelado el: <strong>${paidDate}</strong></span>
                                </div>
                            `;
                        } else if (loan.status === 'rejected') {
                            statusConfig = { color: 'red', bg: 'bg-red-50', text: 'text-red-700', label: 'Rechazado', icon: 'fa-ban' };
                            footerHtml = `
                                <div class="mt-2 text-xs text-red-600 italic">
                                    "${loan.adminNotes || 'Sin motivo registrado'}"
                                </div>
                            `;
                        } else if (loan.status === 'pending') {
                            statusConfig = { color: 'yellow', bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Pendiente', icon: 'fa-clock' };
                        }

                        const dateStr = new Date(loan.date).toLocaleDateString('es-CO');

                        // Renderizar Tarjeta
                        const card = document.createElement('div');
                        card.className = `bg-white p-4 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-all`;

                        card.innerHTML = `
                            <div class="absolute top-0 left-0 w-1 h-full bg-${statusConfig.color}-500"></div>
                            <div class="flex justify-between items-start mb-2 pl-2">
                                <div>
                                    <p class="text-xs text-gray-400 font-bold uppercase tracking-wide">${dateStr}</p>
                                    <h4 class="font-bold text-gray-800 text-lg">${fmtMoney.format(loan.amount)}</h4>
                                </div>
                                <span class="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border border-${statusConfig.color}-200 ${statusConfig.bg} ${statusConfig.text} flex items-center gap-1">
                                    <i class="fa-solid ${statusConfig.icon}"></i> ${statusConfig.label}
                                </span>
                            </div>
                            
                            <div class="pl-2">
                                <p class="text-sm text-gray-600 italic">"${loan.description}"</p>
                                <p class="text-[10px] text-gray-400 mt-1">Pactado a ${loan.installments || 1} cuotas</p>
                            </div>

                            <div class="pl-2">
                                ${footerHtml}
                            </div>
                        `;
                        listContainer.appendChild(card);
                    });

                } catch (error) {
                    console.error("Error historial préstamos:", error);
                    listContainer.innerHTML = `<div class="text-center text-red-500 py-4">Error al cargar historial.</div>`;
                }
            }, 100);
            break;
        }

        case 'create-daily-report':
            title = 'Nuevo Reporte de Actividad';
            btnText = 'Guardar Reporte';
            btnClass = 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg';

            const todayStr = new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

            bodyHtml = `
            <div class="space-y-4">
                <div class="bg-gradient-to-r from-indigo-50 to-blue-50 p-4 rounded-xl border border-indigo-100 flex items-center gap-3">
                    <div class="p-2 bg-white rounded-full shadow-sm text-indigo-500"><i class="fa-regular fa-calendar-check"></i></div>
                    <div>
                        <p class="text-sm text-indigo-900 font-bold capitalize">${todayStr}</p>
                        <p class="text-xs text-indigo-600">Reporta tus actividades del día.</p>
                    </div>
                </div>

                <div>
                    <div class="flex justify-between items-end mb-2">
                        <label class="block text-sm font-bold text-gray-700">Descripción de Actividades</label>
                        <span id="mic-status" class="text-xs font-bold text-gray-400 italic transition-colors">Listo para escribir</span>
                    </div>
                    
                    <div class="relative">
                        <textarea id="daily-report-text" name="reportText" rows="6" 
                            class="w-full p-4 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-none text-gray-700 leading-relaxed transition-all placeholder-gray-400" 
                            placeholder="Escribe aquí o presiona el micrófono para dictar..."></textarea>
                        
                        <button type="button" id="btn-voice-record" 
                            class="absolute bottom-3 right-3 bg-gray-100 hover:bg-red-500 hover:text-white text-gray-500 p-3 rounded-xl transition-all shadow-sm border border-gray-200 group">
                            <i class="fa-solid fa-microphone text-lg group-hover:scale-110 transition-transform"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

            // Lógica del Micrófono (Web Speech API)
            setTimeout(() => {
                const btnRecord = document.getElementById('btn-voice-record');
                const textArea = document.getElementById('daily-report-text');
                const statusText = document.getElementById('mic-status');
                let recognition;

                if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                    recognition = new SpeechRecognition();
                    recognition.lang = 'es-CO';
                    recognition.interimResults = false;
                    recognition.continuous = false;

                    recognition.onstart = () => {
                        btnRecord.classList.add('bg-red-500', 'text-white', 'animate-pulse', 'ring-4', 'ring-red-200');
                        btnRecord.classList.remove('bg-gray-100', 'text-gray-500');
                        statusText.textContent = "Escuchando... habla ahora";
                        statusText.className = "text-xs font-bold text-red-500 italic animate-pulse";
                        textArea.classList.add('border-red-300');
                    };

                    recognition.onend = () => {
                        btnRecord.classList.remove('bg-red-500', 'text-white', 'animate-pulse', 'ring-4', 'ring-red-200');
                        btnRecord.classList.add('bg-gray-100', 'text-gray-500');
                        statusText.textContent = "Dictado finalizado";
                        statusText.className = "text-xs font-bold text-green-600 italic";
                        textArea.classList.remove('border-red-300');
                        setTimeout(() => { statusText.textContent = "Listo para escribir"; statusText.className = "text-xs font-bold text-gray-400 italic"; }, 2000);
                    };

                    recognition.onresult = (event) => {
                        const transcript = event.results[0][0].transcript;
                        const currentText = textArea.value.trim();
                        // Añade el texto dictado con un espacio si ya había texto
                        textArea.value = currentText + (currentText.length > 0 ? " " : "") + transcript.charAt(0).toUpperCase() + transcript.slice(1) + ".";
                        textArea.scrollTop = textArea.scrollHeight; // Auto-scroll al final
                    };

                    recognition.onerror = (event) => {
                        console.error("Error voz:", event.error);
                        statusText.textContent = "No te escuché bien. Intenta de nuevo.";
                        statusText.className = "text-xs font-bold text-orange-500 italic";
                    };

                    btnRecord.addEventListener('click', () => {
                        try { recognition.start(); } catch (e) { recognition.stop(); }
                    });
                } else {
                    btnRecord.style.display = 'none'; // Navegador no soporta
                }
            }, 100);
            break;

        // --- NUEVO CASO: VER HISTORIAL DE AUDITORÍA ---
        case 'view-audit-logs':
            title = 'Historial de Cambios y Auditoría';
            btnText = 'Cerrar';
            btnClass = 'bg-gray-500 hover:bg-gray-600';

            bodyHtml = `
                <div id="audit-log-list" class="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar p-1">
                    <div class="flex justify-center py-10"><div class="loader"></div></div>
                </div>
            `;

            setTimeout(async () => {
                const listContainer = document.getElementById('audit-log-list');

                // LLAMADA A TU FUNCIÓN RECUPERADA
                const logs = await loadUserAuditLogs(data.userId);

                listContainer.innerHTML = '';

                if (logs.length === 0) {
                    listContainer.innerHTML = `<p class="text-gray-400 text-center py-4">No hay registros de cambios recientes.</p>`;
                    return;
                }

                logs.forEach(log => {
                    const dateStr = log.date.toLocaleString('es-CO');

                    // Icono según acción
                    let iconColor = 'text-gray-500';
                    let icon = 'fa-info-circle';
                    if (log.action.includes('Eliminar')) { icon = 'fa-trash-can'; iconColor = 'text-red-500'; }
                    if (log.action.includes('Editar') || log.action.includes('Cambio')) { icon = 'fa-pen-to-square'; iconColor = 'text-yellow-600'; }
                    if (log.action.includes('Pago')) { icon = 'fa-money-bill'; iconColor = 'text-green-600'; }

                    const item = document.createElement('div');
                    item.className = "bg-white p-3 rounded border border-gray-200 shadow-sm text-sm";
                    item.innerHTML = `
                        <div class="flex justify-between items-start">
                            <div class="flex items-center gap-2 font-bold text-gray-700">
                                <i class="fa-solid ${icon} ${iconColor}"></i>
                                <span>${log.action}</span>
                            </div>
                            <span class="text-xs text-gray-400">${dateStr}</span>
                        </div>
                        <p class="text-gray-600 mt-1">${log.details}</p>
                        <div class="mt-2 pt-2 border-t border-gray-100 flex justify-between items-center text-xs">
                            <span class="text-gray-400">Por: <span class="font-semibold text-gray-600">${log.by}</span></span>
                            ${log.previousData ? `<button class="text-blue-500 hover:underline" onclick="alert('Detalle técnico: ' + '${log.previousData.replace(/'/g, "")}')">Ver Detalle</button>` : ''}
                        </div>
                    `;
                    listContainer.appendChild(item);
                });
            }, 100);
            break;


        case 'check-permissions':
            title = 'Verificación de Permisos';
            btnText = 'Continuar a la App';
            btnClass = 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed';

            // Hacemos que el modal no se pueda cerrar con la X ni cancelar si es crítico
            if (document.getElementById('modal-cancel-btn')) document.getElementById('modal-cancel-btn').style.display = 'none';

            bodyHtml = `
                <div class="space-y-4">
                    <p class="text-sm text-gray-600 mb-4">Para utilizar el Gestor de Proyectos, necesitamos activar las siguientes funciones del dispositivo:</p>
                    
                    <div class="flex items-center justify-between p-4 border rounded-xl bg-gray-50" id="perm-card-camera">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xl">
                                <i class="fa-solid fa-camera"></i>
                            </div>
                            <div>
                                <p class="font-bold text-gray-800 text-sm">Cámara</p>
                                <p class="text-xs text-gray-500">Para reporte de ingreso y evidencia.</p>
                            </div>
                        </div>
                        <div id="perm-status-camera">
                            <button type="button" onclick="requestCameraPermission()" class="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-blue-700 transition-colors">Activar</button>
                        </div>
                    </div>

                    <div class="flex items-center justify-between p-4 border rounded-xl bg-gray-50" id="perm-card-location">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xl">
                                <i class="fa-solid fa-location-dot"></i>
                            </div>
                            <div>
                                <p class="font-bold text-gray-800 text-sm">Ubicación</p>
                                <p class="text-xs text-gray-500">Para validar el sitio de trabajo.</p>
                            </div>
                        </div>
                        <div id="perm-status-location">
                            <button type="button" onclick="requestLocationPermission()" class="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-green-700 transition-colors">Activar</button>
                        </div>
                    </div>

                    <div class="flex items-center justify-between p-4 border rounded-xl bg-gray-50" id="perm-card-notification">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xl">
                                <i class="fa-solid fa-bell"></i>
                            </div>
                            <div>
                                <p class="font-bold text-gray-800 text-sm">Notificaciones</p>
                                <p class="text-xs text-gray-500">Para alertas y llamados urgentes.</p>
                            </div>
                        </div>
                        <div id="perm-status-notification">
                            <button type="button" onclick="requestPushPermission()" class="text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-red-700 transition-colors">Activar</button>
                        </div>
                    </div>
                </div>
            `;

            // Verificamos el estado inicial al abrir el modal
            setTimeout(updatePermissionUI, 100);
            break;

        case 'return-material': {
            title = 'Registrar Devolución de Material';
            btnText = 'Confirmar Devolución';
            btnClass = 'bg-yellow-500 hover:bg-yellow-600';


            const { request, materials } = data;

            // Generamos una sección para cada material en la solicitud
            const materialFormsHtml = materials.map(material => {
                // Buscamos si ya hay devoluciones para este material específico
                const returnedInfo = (request.returnedItems || []).find(item => item.materialId === material.materialId);
                const alreadyReturned = returnedInfo ? returnedInfo.quantity : 0;
                const maxReturn = material.quantity - alreadyReturned;

                // Si ya no se puede devolver más de este item, lo mostramos como deshabilitado
                if (maxReturn <= 0) {
                    return `
                        <div class="p-3 border rounded-md bg-gray-100 opacity-60">
                            <p class="font-semibold text-gray-800">${material.name}</p>
                            <p class="text-sm text-green-600">Todas las unidades fueron devueltas.</p>
                        </div>
                    `;
                }

                // Si el material NO es divisible
                if (!material.isDivisible) {
                    return `
                        <div class="material-return-item p-3 border rounded-md" data-material-id="${material.materialId}">
                            <p class="font-semibold text-gray-800">${material.name}</p>
                            <p class="text-xs text-gray-500 mb-2">Máximo a devolver: ${maxReturn} unidades</p>
                            <label class="block text-sm font-medium">Cantidad a Devolver</label>
                            <input type="number" name="quantity_${material.materialId}" class="return-quantity mt-1 w-full border p-2 rounded-md" max="${maxReturn}" min="0" placeholder="0">
                            <input type="hidden" name="type_${material.materialId}" value="complete">
                        </div>
                    `;
                }
                // Si SÍ es divisible
                else {
                    return `
                        <div class="material-return-item p-3 border rounded-md" data-material-id="${material.materialId}">
                            <p class="font-semibold text-gray-800">${material.name}</p>
                            <div class="mt-2 space-y-2">
                                <label class="flex items-center"><input type="radio" name="type_${material.materialId}" value="complete" class="return-type mr-2" checked> Unidades Completas</label>
                                <label class="flex items-center"><input type="radio" name="type_${material.materialId}" value="remnant" class="return-type mr-2"> Retazos</label>
                            </div>
                            
                            <div class="return-complete-section mt-2">
                                <p class="text-xs text-gray-500 mb-1">Máximo a devolver: ${maxReturn} unidades</p>
                                <input type="number" name="quantity_${material.materialId}" class="return-quantity w-full border p-2 rounded-md" max="${maxReturn}" min="0" placeholder="0">
                            </div>
                            
                            <div class="return-remnant-section hidden mt-2 space-y-2">
                                <div class="remnant-fields-container space-y-2">
                                    <div class="remnant-item grid grid-cols-3 gap-2 items-center">
                                        <input type="number" step="0.01" name="remnant_length_${material.materialId}" placeholder="Medida" class="border p-2 rounded-md text-sm">
                                        <input type="number" name="remnant_quantity_${material.materialId}" placeholder="Cantidad" class="border p-2 rounded-md text-sm">
                                        <button type="button" class="remove-remnant-btn text-red-500 text-xs">Eliminar</button>
                                    </div>
                                </div>
                                <button type="button" class="add-remnant-btn text-sm text-blue-600 font-semibold">+ Añadir otro tamaño</button>
                            </div>
                        </div>
                    `;
                }
            }).join('');

            bodyHtml = `<div class="space-y-4">${materialFormsHtml}</div>`;

            setTimeout(() => {
                const form = document.getElementById('modal-form');
                form.addEventListener('change', (e) => {
                    if (e.target.classList.contains('return-type')) {
                        const container = e.target.closest('.material-return-item');
                        const completeSection = container.querySelector('.return-complete-section');
                        const remnantSection = container.querySelector('.return-remnant-section');
                        if (e.target.value === 'complete') {
                            completeSection.classList.remove('hidden');
                            remnantSection.classList.add('hidden');
                        } else {
                            completeSection.classList.add('hidden');
                            remnantSection.classList.remove('hidden');
                        }
                    }
                });

                form.addEventListener('click', (e) => {
                    if (e.target.classList.contains('add-remnant-btn')) {
                        const container = e.target.closest('.material-return-item').querySelector('.remnant-fields-container');
                        const newItem = container.firstElementChild.cloneNode(true);
                        newItem.querySelectorAll('input').forEach(input => input.value = '');
                        container.appendChild(newItem);
                    }
                    if (e.target.classList.contains('remove-remnant-btn')) {
                        const container = e.target.closest('.remnant-fields-container');
                        if (container.children.length > 1) {
                            e.target.closest('.remnant-item').remove();
                        }
                    }
                });
            }, 100);

            // Guardamos los datos necesarios en el formulario para usarlos al guardar

            modalForm.dataset.id = request.id;
            modalForm.dataset.projectId = data.projectId; // <--- AGREGAR ESTA LÍNEA
            break;
        }

        case 'send-admin-alert':
            // Ocultamos encabezado estándar
            if (document.getElementById('modal-title')) document.getElementById('modal-title').parentElement.style.display = 'none';

            title = 'Llamado Urgente';
            btnText = 'Enviar Alerta';
            btnClass = 'bg-red-600 hover:bg-red-700 text-white shadow-lg w-full sm:w-auto';

            if (modalContentDiv) {
                modalContentDiv.classList.remove('max-w-2xl');
                modalContentDiv.classList.add('max-w-md');
            }

            // Preparamos datos de usuarios
            const activeUsersData = Array.from(usersMap.entries())
                .filter(([id, user]) => user.status === 'active')
                .sort((a, b) => a[1].firstName.localeCompare(b[1].firstName))
                .map(([id, user]) => ({
                    value: id,
                    label: `${user.firstName} ${user.lastName}`
                }));

            bodyHtml = `
                <div class="-mx-6 -mt-6 mb-6 bg-gradient-to-b from-red-600 to-red-700 px-6 py-6 flex flex-col items-center justify-center relative rounded-t-lg shadow-md text-white">
                    <button type="button" id="custom-close-alert" class="absolute top-4 right-4 text-white/60 hover:text-white hover:bg-white/10 rounded-full p-1 transition-all">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                    <div class="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center text-3xl mb-2 backdrop-blur-sm shadow-inner border border-white/10">
                         <i class="fa-solid fa-tower-broadcast animate-pulse"></i>
                    </div>
                    <h2 class="text-xl font-black uppercase tracking-wider text-center leading-tight">Llamado Urgente</h2>
                </div>

                <div class="space-y-4 px-2">
                    
                    <div class="flex items-center justify-between p-3 bg-red-50 border border-red-100 rounded-lg">
                        <div class="flex items-center gap-2">
                            <div class="bg-white p-1.5 rounded text-red-500 shadow-sm"><i class="fa-solid fa-users"></i></div>
                            <span class="text-sm font-bold text-gray-700">Enviar a todo el personal</span>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="alert-send-all-toggle" class="sr-only peer">
                            <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                        </label>
                    </div>

                    <div id="alert-target-container" class="transition-all duration-300">
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Destinatarios Específicos</label>
                        <select id="alert-target-user" name="targetUserId" multiple class="w-full">
                            <option value="" placeholder>Cargando lista...</option>
                        </select>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Adjunto (Foto o PDF)</label>
                        <div class="relative group">
                            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 group-hover:text-red-500 transition-colors">
                                <i class="fa-solid fa-paperclip"></i>
                            </div>
                            <input type="file" id="alert-image-input" accept="image/*,.pdf" 
                                class="block w-full pl-10 text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100 cursor-pointer border rounded-lg py-2 border-gray-200 hover:border-red-300 transition-colors"/>
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Instrucción</label>
                        <div class="relative group">
                             <div class="absolute top-3.5 left-3 text-gray-400 group-focus-within:text-red-500 transition-colors">
                                <i class="fa-regular fa-comment-dots"></i>
                            </div>
                            <textarea name="alertMessage" rows="3" required 
                                class="w-full pl-10 pr-4 py-3 border-2 border-gray-100 hover:border-gray-200 rounded-xl text-gray-800 bg-gray-50 focus:bg-white focus:border-red-500 focus:ring-4 focus:ring-red-500/10 outline-none transition-all text-base font-medium placeholder-gray-400 resize-none"
                                placeholder="Ej: Favor presentarse en oficina..."></textarea>
                        </div>
                    </div>
                </div>
            `;

            // Inicialización Interactiva
            setTimeout(() => {
                // 1. Choices.js Configurado para Múltiple
                const selectElement = document.getElementById('alert-target-user');
                let choicesInstance = null;
                if (selectElement) {
                    choicesInstance = new Choices(selectElement, {
                        choices: activeUsersData,
                        searchEnabled: true,
                        placeholder: true,
                        placeholderValue: 'Seleccionar colaboradores...',
                        itemSelectText: '',
                        allowHTML: false,
                        removeItemButton: true, // <-- AÑADIDO: Permite borrar seleccionados con una X
                    });
                }

                // 2. Lógica del Toggle "Enviar a Todos"
                const toggle = document.getElementById('alert-send-all-toggle');
                const targetContainer = document.getElementById('alert-target-container');

                if (toggle) {
                    toggle.addEventListener('change', (e) => {
                        if (e.target.checked) {
                            targetContainer.classList.add('opacity-50', 'pointer-events-none');
                            if (choicesInstance) choicesInstance.disable();
                        } else {
                            targetContainer.classList.remove('opacity-50', 'pointer-events-none');
                            if (choicesInstance) choicesInstance.enable();
                        }
                    });
                }

                // 3. Botón cerrar custom
                const closeBtn = document.getElementById('custom-close-alert');
                if (closeBtn) closeBtn.addEventListener('click', closeMainModal);
            }, 100);
            break;

        case 'add-catalog-item':
        case 'edit-catalog-item': {
            // 1. Ocultar título por defecto del modal
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            modalForm.dataset.id = data.id;

            const isEditing = type === 'edit-catalog-item';

            // Configuración visual según la acción (Crear = Azul, Editar = Amarillo)
            const headerTitle = isEditing ? 'Editar Material' : 'Nuevo Material';
            const headerIcon = isEditing ? 'fa-pen-to-square' : 'fa-box-open';
            const headerGradient = isEditing ? 'from-amber-500 to-orange-600' : 'from-blue-600 to-indigo-700';
            const subTitle = isEditing ? 'Modificar ficha técnica' : 'Añadir al catálogo global';

            title = headerTitle; // Fallback interno
            btnText = isEditing ? 'Guardar Cambios' : 'Añadir Material';
            btnClass = isEditing
                ? 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-md'
                : 'bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white shadow-md';

            modalContentDiv.classList.add('max-w-3xl'); // Un poco más ancho para que respire

            bodyHtml = `
                <div class="flex flex-col h-full max-h-[85vh]">
                    
                    <div class="-mx-6 -mt-6 mb-6 bg-gradient-to-r ${headerGradient} px-8 py-5 rounded-t-lg text-white shadow-md flex justify-between items-center relative overflow-hidden">
                        <div class="absolute top-0 right-0 p-4 opacity-10 pointer-events-none transform scale-150 translate-x-4 -translate-y-2">
                            <i class="fa-solid ${headerIcon} text-6xl"></i>
                        </div>
                        
                        <div class="flex items-center gap-4 relative z-10">
                            <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl backdrop-blur-sm border border-white/10 shadow-inner">
                                <i class="fa-solid ${headerIcon}"></i>
                            </div>
                            <div>
                                <h2 class="text-2xl font-bold tracking-tight text-white">${headerTitle}</h2>
                                <p class="text-blue-50 text-xs font-medium opacity-90">${subTitle}</p>
                            </div>
                        </div>
                        <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors relative z-10">
                            <i class="fa-solid fa-xmark text-2xl"></i>
                        </button>
                    </div>

                    <div class="flex-grow overflow-y-auto custom-scrollbar p-1 pr-2 space-y-6 pb-4">
                        
                        <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                            <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-4 flex items-center">
                                <i class="fa-solid fa-tag mr-2"></i> Identificación
                            </h4>
                             
                            <div class="grid grid-cols-1 md:grid-cols-4 gap-5">
                                <div class="col-span-4 md:col-span-2">
                                    <label class="block text-xs font-bold text-gray-700 mb-1.5">Nombre del Material</label>
                                    <input type="text" name="name" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50 focus:bg-white transition-all placeholder-gray-400 font-medium" placeholder="Ej: Vidrio Templado 10mm" value="${isEditing ? data.name : ''}">
                                </div>
                                <div class="col-span-4 md:col-span-2">
                                    <label class="block text-xs font-bold text-gray-700 mb-1.5">Referencia / SKU <span class="text-gray-400 font-normal text-[10px]">(Opcional)</span></label>
                                    <input type="text" name="reference" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50 focus:bg-white transition-all placeholder-gray-400" placeholder="REF-000" value="${isEditing ? data.reference || '' : ''}">
                                </div>
                                <div class="col-span-4 md:col-span-2">
                                    <label class="block text-xs font-bold text-gray-700 mb-1.5">Sistema <span class="text-gray-400 font-normal text-[10px]">(Opcional)</span></label>
                                    <input type="text" name="system" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50 focus:bg-white transition-all placeholder-gray-400" placeholder="Ej: 5020, PREMIUM" value="${isEditing ? data.system || '' : ''}">
                                </div>
                                <div class="col-span-4 md:col-span-2">
                                    <label class="block text-xs font-bold text-gray-700 mb-1.5">Color <span class="text-gray-400 font-normal text-[10px]">(Opcional)</span></label>
                                    <input type="text" name="color" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50 focus:bg-white transition-all placeholder-gray-400" placeholder="Ej: Anodizado, Negro" value="${isEditing ? data.color || '' : ''}">
                                </div>
                                <div class="col-span-4 md:col-span-2">
                                    <label class="block text-xs font-bold text-gray-700 mb-1.5">Costo Base / Precio ($)</label>
                                    <input type="number" name="basePrice" step="any" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50 focus:bg-white transition-all placeholder-gray-400 font-bold" placeholder="0" value="${isEditing ? data.basePrice || '' : ''}">
                                </div>
                                <div class="col-span-4 md:col-span-2">
                                    <label class="block text-xs font-bold text-gray-700 mb-1.5">Proveedor Asignado <span class="text-gray-400 font-normal text-[10px]">(Opcional)</span></label>
                                    <select id="catalog-supplier-select" name="assignedSupplierId" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50 focus:bg-white transition-all">
                                        <option value="">Seleccione un proveedor...</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                            <div class="bg-slate-50 p-5 rounded-xl border border-slate-200">
                             <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4 flex items-center">
                                <i class="fa-solid fa-boxes-stacked mr-2"></i> Control de Stock
                             </h4>

                             <div class="grid grid-cols-1 md:grid-cols-${!isEditing ? '3' : '2'} gap-5 mb-5">
                                <div>
                                    <label class="block text-xs font-bold text-slate-700 mb-1.5">Unidad de Medida</label>
                                    <div class="relative">
                                        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><i class="fa-solid fa-ruler"></i></div>
                                        <input type="text" name="unit" required class="w-full pl-9 border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Unidad, Metro..." value="${isEditing ? data.unit : ''}">
                                    </div>
                                </div>
                                
                                ${!isEditing ? `
                                <div>
                                    <label class="block text-xs font-bold text-green-700 mb-1.5">Stock Inicial</label>
                                     <div class="relative">
                                        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-green-500"><i class="fa-solid fa-cube"></i></div>
                                        <input type="number" name="quantityInStock" class="w-full pl-9 border-green-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-green-50" placeholder="0" value="0">
                                    </div>
                                    <p class="text-[10px] text-green-600 mt-1">Solo se asigna al crear.</p>
                                </div>
                                ` : ''}

                                <div>
                                    <label class="block text-xs font-bold text-slate-700 mb-1.5">Alerta de Stock Bajo</label>
                                     <div class="relative">
                                        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><i class="fa-solid fa-bell"></i></div>
                                        <input type="number" name="minStockThreshold" class="w-full pl-9 border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Mínimo (Ej: 5)" value="${isEditing ? data.minStockThreshold || '' : ''}">
                                    </div>
                                </div>
                            </div>

                            <div class="bg-white p-4 rounded-lg border border-slate-200 shadow-sm ring-1 ring-slate-100">
                                <div>
                                    <label for="measurementType-select" class="block text-xs font-bold text-blue-700 mb-2">¿Cómo se gestiona este material?</label>
                                    <select id="measurementType-select" name="measurementType" class="w-full border-blue-200 rounded-lg p-2.5 text-sm bg-blue-50/50 focus:ring-2 focus:ring-blue-500 text-slate-700 font-medium cursor-pointer">
                                        <option value="unit" ${isEditing && data.measurementType === 'unit' ? 'selected' : ''}>📦 Por Unidad (Indivisible: Tornillos, Herrajes)</option>
                                        <option value="linear" ${isEditing && data.measurementType === 'linear' ? 'selected' : ''}>📏 Lineal (Se corta: Perfiles, Tiras)</option>
                                        <option value="area" ${isEditing && data.measurementType === 'area' ? 'selected' : ''}>📐 Por Área (Se corta: Vidrio, Láminas)</option>
                                    </select>
                                </div>

                                <div id="dimensions-container" class="hidden mt-4 pt-4 border-t border-slate-100 animate-fade-in">
                                    <div class="flex items-start gap-3 mb-4 bg-orange-50 p-3 rounded-md border border-orange-100">
                                        <i class="fa-solid fa-scissors text-orange-500 mt-0.5"></i>
                                        <p class="text-xs text-orange-800 leading-snug">
                                            <strong>Configuración de Corte:</strong><br>
                                            Define el tamaño original (estándar) con el que compras este material. El sistema descontará los cortes de estas unidades.
                                        </p>
                                    </div>
                                    
                                    <div class="grid grid-cols-2 gap-4">
                                        <div id="length-field">
                                            <label class="block text-xs font-bold text-slate-700 mb-1">Largo Estándar (cm)</label>
                                            <input type="number" name="defaultLength" class="w-full border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 font-bold text-gray-700" placeholder="0" value="${isEditing && data.defaultSize ? (data.defaultSize.length * 100) || '' : ''}">
                                        </div>
                                        <div id="width-field" class="hidden">
                                            <label class="block text-xs font-bold text-slate-700 mb-1">Ancho Estándar (cm)</label>
                                            <input type="number" name="defaultWidth" class="w-full border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 font-bold text-gray-700" placeholder="0" value="${isEditing && data.defaultSize ? (data.defaultSize.width * 100) || '' : ''}">
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>`;

            // Lógica para mostrar/ocultar los campos de dimensiones y cargar proveedores
            setTimeout(async () => {
                const measurementSelect = document.getElementById('measurementType-select');
                const dimensionsContainer = document.getElementById('dimensions-container');
                const lengthField = document.getElementById('length-field');
                const widthField = document.getElementById('width-field');
                const supplierSelect = document.getElementById('catalog-supplier-select');

                const toggleDimensionFields = () => {
                    const selectedType = measurementSelect.value;
                    if (selectedType === 'linear' || selectedType === 'area') {
                        dimensionsContainer.classList.remove('hidden');
                        lengthField.classList.remove('hidden');
                        widthField.classList.toggle('hidden', selectedType !== 'area');
                    } else {
                        dimensionsContainer.classList.add('hidden');
                    }
                };

                measurementSelect.addEventListener('change', toggleDimensionFields);
                toggleDimensionFields(); // Ejecutar al abrir para establecer el estado inicial

                // Cargar proveedores
                if (supplierSelect) {
                    try {
                        const { collection, getDocs, query, orderBy } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
                        const suppliersSnap = await getDocs(query(collection(db, "suppliers"), orderBy("name")));
                        suppliersSnap.forEach(sDoc => {
                            const opt = document.createElement('option');
                            opt.value = sDoc.id;
                            opt.textContent = sDoc.data().name;
                            if (isEditing && data && data.assignedSupplierId === sDoc.id) {
                                opt.selected = true;
                            }
                            supplierSelect.appendChild(opt);
                        });
                    } catch (err) {
                        console.error("Error al cargar proveedores en catálogo:", err);
                    }
                }
            }, 100);
            break;
        }

        case 'addInterestPerson':
            title = 'Añadir Persona de Interés';
            btnText = 'Guardar Persona';
            btnClass = 'bg-blue-500 hover:bg-blue-600';
            bodyHtml = `
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium">Nombre Completo</label>
                        <input type="text" name="name" required class="mt-1 w-full border rounded-md p-2">
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Cargo</label>
                        <select name="position" required class="mt-1 w-full border rounded-md p-2 bg-white">
                            <option value="" disabled selected>Selecciona un cargo...</option>
                            <option value="Director de obra">Director de obra</option>
                            <option value="Residente de obra">Residente de obra</option>
                            <option value="Maestro de obra">Maestro de obra</option>
                            <option value="SST residente">SST residente</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Correo Electrónico</label>
                        <input type="email" name="email" class="mt-1 w-full border rounded-md p-2">
                    </div>
                    <div>
                        <label class="block text-sm font-medium">Teléfono</label>
                        <input type="tel" name="phone" class="mt-1 w-full border rounded-md p-2">
                    </div>
                </div>`;
            break;
        case 'add-anticipo-payment':
            title = 'Abonar al Anticipo';
            btnText = 'Guardar Abono';
            btnClass = 'bg-blue-500 hover:bg-blue-600';
            bodyHtml = `
                <p class="text-sm mb-4">Estás a punto de registrar un pago que se aplicará directamente al <strong>anticipo</strong> del contrato.</p>
                <input type="hidden" name="type" value="abono_anticipo">
                <div><label class="block text-sm font-medium">Valor del Abono</label><input type="text" name="amount" required class="currency-input mt-1 w-full border rounded-md p-2"></div>
                <div class="mt-4"><label class="block text-sm font-medium">Fecha del Abono</label><input type="date" name="date" required class="mt-1 w-full border rounded-md p-2"></div>`;

            setTimeout(() => {
                setupCurrencyInput(modalForm.querySelector('input[name="amount"]'));
                modalForm.querySelector('input[name="date"]').value = new Date().toISOString().split('T')[0];
            }, 100);
            break;

        // --- NUEVO CASO: HISTORIAL DE PRÉSTAMOS (USUARIO) ---
        case 'view-my-loans':
            title = 'Historial de Mis Préstamos';
            btnText = 'Cerrar';
            btnClass = 'bg-gray-500 hover:bg-gray-600';
            // Ocultamos el botón de submit porque es solo lectura, el usuario cierra con la X o Cancelar

            bodyHtml = `
                <div id="my-loans-list" class="space-y-4 min-h-[200px]">
                    <div class="flex justify-center items-center h-32">
                        <div class="loader"></div>
                    </div>
                </div>
            `;

            setTimeout(async () => {
                const listContainer = document.getElementById('my-loans-list');
                const fmtMoney = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

                try {
                    // 1. Consultar SOLO los préstamos del usuario actual
                    const q = query(
                        collection(db, "users", currentUser.uid, "loans"),
                        orderBy("date", "desc") // De más nuevo a más viejo
                    );
                    const snapshot = await getDocs(q);

                    if (snapshot.empty) {
                        listContainer.innerHTML = `
                            <div class="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                                <i class="fa-solid fa-folder-open text-3xl mb-2"></i>
                                <p>No tienes historial de préstamos.</p>
                            </div>`;
                        return;
                    }

                    listContainer.innerHTML = '';

                    snapshot.forEach(doc => {
                        const loan = doc.data();
                        const dateStr = loan.date ? new Date(loan.date).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Fecha desconocida';

                        // Lógica de Estado
                        let statusBadge = '';
                        let cardBorder = 'border-gray-200';
                        let icon = '';
                        let footerInfo = '';

                        if (loan.status === 'paid') {
                            // ESTADO: PAGADO
                            cardBorder = 'border-green-200 bg-green-50';
                            statusBadge = '<span class="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded">PAGADO</span>';
                            icon = '<i class="fa-solid fa-circle-check text-green-500 text-xl"></i>';

                            // Obtenemos fecha de pago (paidAt)
                            let paidDateStr = 'Fecha desconocida';
                            if (loan.paidAt) {
                                paidDateStr = loan.paidAt.toDate().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
                            }

                            footerInfo = `
                                <div class="mt-3 pt-2 border-t border-green-200 text-sm text-green-800 flex items-start">
                                    <i class="fa-solid fa-money-bill-transfer mt-1 mr-2"></i>
                                    <div>
                                        <p class="font-bold">Cancelado en Nómina</p>
                                        <p class="text-xs">Descontado el: ${paidDateStr}</p>
                                    </div>
                                </div>`;

                        } else if (loan.status === 'active') {
                            // ESTADO: ACTIVO (Debiendo)
                            cardBorder = 'border-indigo-200 bg-white';
                            statusBadge = '<span class="bg-indigo-100 text-indigo-800 text-xs font-bold px-2 py-0.5 rounded">ACTIVO</span>';
                            icon = '<i class="fa-solid fa-circle-play text-indigo-500 text-xl"></i>';

                            footerInfo = `
                                <div class="mt-2 flex justify-between items-center text-sm">
                                    <span class="text-gray-500">Saldo Pendiente:</span>
                                    <span class="font-bold text-red-600">${fmtMoney.format(loan.balance)}</span>
                                </div>`;

                        } else if (loan.status === 'rejected') {
                            // ESTADO: RECHAZADO
                            cardBorder = 'border-red-100 bg-gray-50 opacity-75';
                            statusBadge = '<span class="bg-red-100 text-red-800 text-xs font-bold px-2 py-0.5 rounded">RECHAZADO</span>';
                            icon = '<i class="fa-solid fa-circle-xmark text-red-400 text-xl"></i>';

                            if (loan.adminNotes) {
                                footerInfo = `<p class="mt-2 text-xs text-red-600 italic bg-red-50 p-1 rounded">Nota Admin: "${loan.adminNotes}"</p>`;
                            }

                        } else {
                            // ESTADO: PENDIENTE (Revisión)
                            cardBorder = 'border-yellow-200 bg-yellow-50';
                            statusBadge = '<span class="bg-yellow-100 text-yellow-800 text-xs font-bold px-2 py-0.5 rounded">EN REVISIÓN</span>';
                            icon = '<i class="fa-solid fa-clock text-yellow-500 text-xl"></i>';
                            footerInfo = `<p class="mt-2 text-xs text-yellow-700 italic">Esperando aprobación del administrador.</p>`;
                        }

                        const card = document.createElement('div');
                        card.className = `rounded-lg border p-4 shadow-sm transition-all ${cardBorder}`;

                        card.innerHTML = `
                            <div class="flex justify-between items-start">
                                <div class="flex-1 pr-4">
                                    <div class="flex items-center gap-2 mb-1">
                                        ${statusBadge}
                                        <span class="text-xs text-gray-500">${dateStr}</span>
                                    </div>
                                    <h4 class="font-bold text-gray-800 text-lg">${fmtMoney.format(loan.amount)}</h4>
                                    <p class="text-sm text-gray-600 mt-1">"${loan.description}"</p>
                                </div>
                                <div>${icon}</div>
                            </div>
                            ${footerInfo}
                        `;
                        listContainer.appendChild(card);
                    });

                } catch (error) {
                    console.error("Error cargando historial:", error);
                    listContainer.innerHTML = `<p class="text-red-500 text-center">Error al cargar tus datos.</p>`;
                }
            }, 100);
            break;

        case 'add-corte-payment':
            title = `Abonar al Corte #${data.corteNumber}`;
            btnText = 'Guardar Abono';
            btnClass = 'bg-blue-500 hover:bg-blue-600';
            bodyHtml = `
                <p class="text-sm mb-4">Estás registrando un pago para el <strong>Corte #${data.corteNumber}</strong>.</p>
                <input type="hidden" name="type" value="abono_corte">
                <input type="hidden" name="targetId" value="${data.corteId}">
                <div><label class="block text-sm font-medium">Valor del Abono</label><input type="text" name="amount" required class="currency-input mt-1 w-full border rounded-md p-2"></div>
                <div class="mt-4"><label class="block text-sm font-medium">Fecha del Abono</label><input type="date" name="date" required class="mt-1 w-full border rounded-md p-2"></div>`;

            setTimeout(() => {
                setupCurrencyInput(modalForm.querySelector('input[name="amount"]'));
                modalForm.querySelector('input[name="date"]').value = new Date().toISOString().split('T')[0];
            }, 100);
            break;
        case 'new-purchase-order': {
            // 1. Configuración Visual
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            title = 'Nueva Orden de Compra';
            btnText = 'Generar Orden';
            btnClass = 'bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white shadow-lg transform hover:-translate-y-0.5 transition-all';

            if (modalContentDiv) {
                modalContentDiv.classList.remove('max-w-2xl');
                modalContentDiv.style.width = '90vw';
                modalContentDiv.style.maxWidth = '1200px';
            }

            // 2. HTML Estructurado (Con correcciones de Z-INDEX y Contenedor de Alerta)
            bodyHtml = `
                <div id="material-request-loader" class="text-center py-12">
                    <div class="loader mx-auto mb-4"></div>
                    <p class="text-sm text-gray-500 animate-pulse">Cargando catálogo y proveedores...</p>
                </div>

                <div id="material-request-form-content" class="hidden flex flex-col h-full max-h-[80vh]">
                    
                    <div class="-mx-6 -mt-6 bg-gradient-to-r from-blue-600 to-indigo-700 px-8 py-6 rounded-t-lg text-white shadow-md mb-6 flex justify-between items-center">
                        <div class="flex items-center gap-4">
                            <div class="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center text-2xl backdrop-blur-sm border border-white/10">
                                <i class="fa-solid fa-cart-flatbed"></i>
                            </div>
                            <div>
                                <h2 class="text-2xl font-bold tracking-tight">Nueva Orden de Compra</h2>
                                <p class="text-blue-100 text-xs font-medium">Gestión de Abastecimiento</p>
                            </div>
                        </div>
                        <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white hover:bg-white/10 p-2 rounded-full transition-colors">
                            <i class="fa-solid fa-xmark text-2xl"></i>
                        </button>
                    </div>

                    <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm mb-6 grid grid-cols-1 md:grid-cols-3 gap-6 relative z-40">
                        
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Proveedor</label>
                            <select id="po-supplier-select" class="w-full" required></select>
                        </div>

                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Condición de Pago</label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                                    <i class="fa-solid fa-credit-card"></i>
                                </div>
                                <select name="paymentMethod" class="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white appearance-none cursor-pointer">
                                    <option value="pendiente" selected>Crédito / Pendiente</option>
                                    <option value="transferencia">Transferencia Inmediata</option>
                                    <option value="efectivo">Efectivo</option>
                                    <option value="tarjeta">Tarjeta Corporativa</option>
                                </select>
                                <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-500">
                                    <i class="fa-solid fa-chevron-down text-xs"></i>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Fecha de Emisión</label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                                    <i class="fa-regular fa-calendar"></i>
                                </div>
                                <input type="date" name="poDate" 
                                    class="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                                    value="${new Date().toISOString().split('T')[0]}">
                            </div>
                        </div>
                    </div>

                    <div class="flex flex-col flex-grow bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden relative z-0">
                        
                    <div class="bg-gray-50 p-4 border-b border-gray-200 relative z-50">
                            
                            <div class="flex flex-col lg:flex-row gap-3 items-end"> <div class="flex-grow w-full lg:w-auto">
                                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Buscar Ítem</label>
                                    <select id="po-add-item-select" class="w-full"></select>
                                </div>
                                
                                <div class="w-full lg:w-32">
                                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Cantidad</label>
                                    <input type="number" id="po-add-quantity" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 outline-none text-center font-bold" step="any" min="0" placeholder="0">
                                </div>
                                
                                <div class="w-full lg:w-48">
                                    <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Costo Unitario</label>
                                    <div class="relative">
                                        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                                        <input type="text" id="po-add-cost" class="currency-input w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 outline-none font-mono text-right" placeholder="0">
                                    </div>
                                </div>

                                <button type="button" id="po-add-item-btn" class="w-full lg:w-auto bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-sm transition-all flex items-center justify-center h-[38px] mb-[1px]">
                                    <i class="fa-solid fa-plus mr-2"></i> Añadir
                                </button>
                            </div>

                            <div id="po-price-info-card" class="hidden mt-4 p-3 rounded-lg border-l-4 text-sm shadow-sm flex items-start gap-3 transition-all duration-300"></div>

                        </div>

                        <div class="flex-grow overflow-y-auto bg-white relative min-h-[250px] z-0">
                            <table class="w-full text-sm text-left border-collapse">
                                <thead class="text-xs text-gray-500 uppercase bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th class="px-6 py-3 bg-gray-50/95 backdrop-blur">Descripción</th>
                                        <th class="px-6 py-3 text-center bg-gray-50/95 backdrop-blur">Cant.</th>
                                        <th class="px-6 py-3 text-right bg-gray-50/95 backdrop-blur">Unitario</th>
                                        <th class="px-6 py-3 text-right bg-gray-50/95 backdrop-blur">Subtotal</th>
                                        <th class="px-6 py-3 text-center bg-gray-50/95 backdrop-blur w-16"></th>
                                    </tr>
                                </thead>
                                <tbody id="po-items-table-body" class="divide-y divide-gray-50 text-gray-700">
                                    </tbody>
                            </table>
                            
                            <div id="po-empty-state" class="absolute inset-0 flex flex-col items-center justify-center text-gray-300 pointer-events-none">
                                <i class="fa-solid fa-basket-shopping text-6xl mb-4 opacity-20"></i>
                                <p class="text-sm font-medium">La orden está vacía</p>
                                <p class="text-xs">Usa la barra superior para agregar ítems</p>
                            </div>
                        </div>

                        <div class="bg-gray-50 p-4 border-t border-gray-200 flex justify-end items-center gap-4 relative z-20">
                            <div class="text-right">
                                <p class="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Orden</p>
                                <p id="po-total-display" class="text-3xl font-black text-gray-800 leading-none tracking-tight">$ 0</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // 3. Lógica de Carga y Eventos
            const loadDataAndBuildForm = async () => {
                try {
                    const loader = document.getElementById('material-request-loader');
                    const formContent = document.getElementById('material-request-form-content');

                    // Carga inicial de datos
                    const [materialSnap, dotacionSnap, toolsSnap, suppliersSnapshot] = await Promise.all([
                        getDocs(query(collection(db, "materialCatalog"), orderBy("name"))),
                        getDocs(query(collection(db, "dotacionCatalog"), orderBy("itemName"))),
                        getDocs(query(collection(db, "tools"), orderBy("name"))),
                        getDocs(query(collection(db, "suppliers"), orderBy("name")))
                    ]);

                    // Configurar Selector de Proveedor
                    const supplierSelect = document.getElementById('po-supplier-select');
                    const suppliers = suppliersSnapshot.docs.map(doc => ({ value: doc.id, label: doc.data().name }));
                    new Choices(supplierSelect, {
                        choices: suppliers,
                        itemSelectText: '',
                        searchPlaceholderValue: 'Buscar proveedor...',
                        placeholder: true,
                        placeholderValue: 'Selecciona un proveedor',
                        shouldSort: false
                    });

                    // Unificar Ítems y Clasificar
                    const unifiedItemOptions = [];

                    materialSnap.forEach(doc => {
                        const m = doc.data();
                        unifiedItemOptions.push({ value: doc.id, label: `${m.name} (${m.reference || '-'})`, customProperties: { type: 'material', unit: m.unit } });
                    });
                    dotacionSnap.forEach(doc => {
                        const d = doc.data();
                        unifiedItemOptions.push({ value: doc.id, label: `[DOT] ${d.itemName} (T: ${d.talla})`, customProperties: { type: 'dotacion', unit: 'Und' } });
                    });
                    toolsSnap.forEach(doc => {
                        const t = doc.data();
                        if (t.status === 'disponible' || t.status === 'mantenimiento') {
                            unifiedItemOptions.push({ value: doc.id, label: `[HER] ${t.name}`, customProperties: { type: 'herramienta', unit: 'Und' } });
                        }
                    });

                    // Ordenamiento Personalizado (1.Material, 2.Dotación, 3.Herramienta)
                    const typePriority = { 'material': 1, 'dotacion': 2, 'herramienta': 3 };
                    unifiedItemOptions.sort((a, b) => {
                        const priorityA = typePriority[a.customProperties.type] || 99;
                        const priorityB = typePriority[b.customProperties.type] || 99;
                        if (priorityA !== priorityB) return priorityA - priorityB;
                        return a.label.localeCompare(b.label);
                    });

                    // Inicializar Selector de Ítems
                    const itemSelect = document.getElementById('po-add-item-select');
                    const itemChoices = new Choices(itemSelect, {
                        choices: unifiedItemOptions,
                        itemSelectText: 'Seleccionar',
                        searchPlaceholderValue: 'Buscar material...',
                        placeholder: true,
                        placeholderValue: 'Escribe para buscar...',
                        searchResultLimit: 50000,
                        shouldSort: false
                    });

                    // Mostrar formulario
                    loader.classList.add('hidden');
                    formContent.classList.remove('hidden');

                    // --- Lógica Interactiva ---
                    const addBtn = document.getElementById('po-add-item-btn');
                    const tableBody = document.getElementById('po-items-table-body');
                    const totalDisplay = document.getElementById('po-total-display');
                    const quantityInput = document.getElementById('po-add-quantity');
                    const costInput = document.getElementById('po-add-cost');
                    const emptyState = document.getElementById('po-empty-state');

                    setupCurrencyInput(costInput);

                    const updatePOTotal = () => {
                        let total = 0;
                        const rows = tableBody.querySelectorAll('tr');
                        rows.forEach(row => total += parseFloat(row.dataset.subtotal) || 0);
                        totalDisplay.textContent = currencyFormatter.format(total);
                        if (rows.length === 0) emptyState.classList.remove('hidden');
                        else emptyState.classList.add('hidden');
                    };

                    // Lógica Inteligente de Precios y Tarjeta Informativa
                    itemSelect.addEventListener('change', async () => {
                        const item = itemChoices.getValue();
                        const currentSupplierId = supplierSelect.value;

                        // Referencia a la nueva tarjeta fija
                        const infoCard = document.getElementById('po-price-info-card');

                        // 1. Resetear interfaz
                        if (infoCard) {
                            infoCard.classList.add('hidden');
                            infoCard.className = "hidden mt-4 p-3 rounded-lg border-l-4 text-sm shadow-sm flex items-start gap-3 transition-all duration-300";
                            infoCard.innerHTML = '';
                        }
                        costInput.classList.remove('border-green-500', 'text-green-700', 'border-yellow-500', 'bg-green-50');
                        costInput.placeholder = "0";

                        if (!item || !currentSupplierId) return;

                        costInput.placeholder = "Buscando...";

                        // 2. Consultar precios
                        const [myPrice, bestMarketOption] = await Promise.all([
                            findLastPurchasePrice(currentSupplierId, item.value),
                            findBestMarketPrice(item.value)
                        ]);

                        // 3. Rellenar input
                        let currentPriceVal = 0;
                        if (myPrice) {
                            currentPriceVal = myPrice;
                            costInput.value = currencyFormatter.format(myPrice).replace(/\s/g, ' ');
                        } else {
                            costInput.value = '';
                        }

                        // 4. Lógica de la Tarjeta Informativa
                        if (bestMarketOption) {
                            const marketPrice = bestMarketOption.price;
                            const marketSupplier = bestMarketOption.supplierName;
                            const marketDate = bestMarketOption.date ? new Date(bestMarketOption.date).toLocaleDateString() : 'Reciente';

                            if (currentPriceVal > 0 && marketPrice < currentPriceVal) {
                                // CASO A: MÁS CARO (Tarjeta Roja/Amarilla de Advertencia)
                                const diff = currentPriceVal - marketPrice;
                                const percent = Math.round((diff / marketPrice) * 100);

                                infoCard.className = "mt-4 p-3 rounded-lg border border-red-200 border-l-4 border-l-red-500 bg-red-50 text-red-800 flex items-start gap-3 animate-pulse-slow";
                                infoCard.innerHTML = `
                                    <div class="mt-0.5 text-red-600 text-lg"><i class="fa-solid fa-circle-exclamation"></i></div>
                                    <div class="flex-grow">
                                        <p class="font-bold">¡Opción más económica disponible!</p>
                                        <p class="mt-1">
                                            El proveedor <strong>${marketSupplier}</strong> vendió este ítem a 
                                            <span class="font-black bg-white px-1 rounded border border-red-200">${currencyFormatter.format(marketPrice)}</span> 
                                            (${marketDate}).
                                        </p>
                                        <p class="mt-1 text-xs font-semibold text-red-700">
                                            <i class="fa-solid fa-chart-line"></i> Estás pagando un 
                                            <span class="underline">${percent}% más caro</span> (${currencyFormatter.format(diff)} extra/und).
                                        </p>
                                    </div>
                                `;
                                infoCard.classList.remove('hidden');
                                costInput.classList.add('border-yellow-500');

                            } else if (currentPriceVal === 0) {
                                // CASO B: NUEVO (Tarjeta Azul de Referencia)
                                infoCard.className = "mt-4 p-3 rounded-lg border border-blue-200 border-l-4 border-l-blue-500 bg-blue-50 text-blue-800 flex items-start gap-3";
                                infoCard.innerHTML = `
                                    <div class="mt-0.5 text-blue-600 text-lg"><i class="fa-solid fa-circle-info"></i></div>
                                    <div class="flex-grow">
                                        <p class="font-bold">Referencia de Mercado</p>
                                        <p class="mt-1">
                                            No tienes historial con este proveedor. El mejor precio registrado es 
                                            <span class="font-bold text-blue-700">${currencyFormatter.format(marketPrice)}</span> 
                                            (por ${marketSupplier}).
                                        </p>
                                    </div>
                                `;
                                infoCard.classList.remove('hidden');

                            } else {
                                // CASO C: MEJOR PRECIO (Tarjeta Verde de Confirmación)
                                infoCard.className = "mt-4 p-3 rounded-lg border border-green-200 border-l-4 border-l-green-500 bg-green-50 text-green-800 flex items-start gap-3";
                                infoCard.innerHTML = `
                                    <div class="mt-0.5 text-green-600 text-lg"><i class="fa-solid fa-circle-check"></i></div>
                                    <div>
                                        <p class="font-bold">¡Excelente Precio!</p>
                                        <p class="text-xs mt-0.5">Este es el precio más bajo del mercado registrado en tu historial.</p>
                                    </div>
                                `;
                                infoCard.classList.remove('hidden');
                                costInput.classList.add('border-green-500', 'text-green-700', 'bg-green-50');
                            }
                        } else {
                            // CASO D: Ítem totalmente nuevo (nunca comprado)
                            infoCard.className = "mt-4 p-3 rounded-lg border border-gray-200 border-l-4 border-l-gray-400 bg-white text-gray-600 flex items-start gap-3";
                            infoCard.innerHTML = `
                                <div class="mt-0.5 text-gray-400 text-lg"><i class="fa-solid fa-asterisk"></i></div>
                                <div>
                                    <p class="font-bold">Primer Registro</p>
                                    <p class="text-xs mt-0.5">Este ítem no tiene historial de compra previo en el sistema.</p>
                                </div>
                            `;
                            infoCard.classList.remove('hidden');
                        }

                        quantityInput.focus();
                    });

                    // Ocultar alerta al escribir manual
                    costInput.addEventListener('input', () => {
                        const alert = document.getElementById('price-alert-container');
                        if (alert) alert.classList.add('hidden');
                    });

                    // Agregar a la tabla
                    addBtn.addEventListener('click', () => {
                        const item = itemChoices.getValue();
                        const qty = parseFloat(quantityInput.value);
                        const cost = parseFloat(costInput.value.replace(/[$. ]/g, '')) || 0;

                        if (!item || !qty || qty <= 0 || cost <= 0) {
                            alert("Por favor completa el ítem, cantidad y costo.");
                            return;
                        }

                        // Verificar duplicado para sumar
                        const existingRow = tableBody.querySelector(`tr[data-item-id="${item.value}"][data-cost="${cost}"]`);
                        if (existingRow) {
                            const oldQty = parseFloat(existingRow.dataset.quantity);
                            const newQty = oldQty + qty;
                            const newSub = newQty * cost;
                            existingRow.dataset.quantity = newQty;
                            existingRow.dataset.subtotal = newSub;
                            existingRow.classList.add('bg-blue-50');
                            setTimeout(() => existingRow.classList.remove('bg-blue-50'), 300);
                            existingRow.cells[1].innerHTML = `<span class="font-bold text-blue-600">${newQty}</span>`;
                            existingRow.cells[3].textContent = currencyFormatter.format(newSub);
                        } else {
                            const subtotal = qty * cost;
                            const tr = document.createElement('tr');
                            tr.className = "hover:bg-gray-50 group transition-colors";
                            tr.dataset.itemId = item.value;
                            tr.dataset.itemType = item.customProperties.type;
                            tr.dataset.quantity = qty;
                            tr.dataset.cost = cost;
                            tr.dataset.subtotal = subtotal;

                            tr.innerHTML = `
                                <td class="px-6 py-3">
                                    <p class="font-bold text-gray-800 text-sm">${item.label}</p>
                                    <p class="text-[10px] text-gray-400 uppercase">${item.customProperties.type}</p>
                                </td>
                                <td class="px-6 py-3 text-center font-bold text-gray-700">${qty}</td>
                                <td class="px-6 py-3 text-right text-gray-600 font-mono text-xs">${currencyFormatter.format(cost)}</td>
                                <td class="px-6 py-3 text-right font-bold text-gray-800">${currencyFormatter.format(subtotal)}</td>
                                <td class="px-6 py-3 text-center">
                                    <button type="button" class="remove-row-btn text-gray-300 hover:text-red-500 transition-colors p-2">
                                        <i class="fa-solid fa-trash-can"></i>
                                    </button>
                                </td>
                            `;
                            tableBody.appendChild(tr);
                            tableBody.parentElement.scrollTop = tableBody.parentElement.scrollHeight;
                        }
                        // Reset
                        quantityInput.value = '';
                        costInput.value = '';
                        itemChoices.setChoiceByValue('');
                        updatePOTotal();


                        const infoCard = document.getElementById('po-price-info-card');
                        if (infoCard) infoCard.classList.add('hidden'); // Ocultar tarjeta al agregar
                        costInput.classList.remove('border-green-500', 'text-green-700', 'border-yellow-500', 'bg-green-50'); // Reset inputs

                    });

                    // Borrar fila
                    tableBody.addEventListener('click', (e) => {
                        const btn = e.target.closest('.remove-row-btn');
                        if (btn) {
                            btn.closest('tr').remove();
                            updatePOTotal();
                        }
                    });

                } catch (error) {
                    console.error(error);
                    document.getElementById('material-request-form-content').innerHTML = `<p class="text-red-500 text-center p-4">Error al cargar: ${error.message}</p>`;
                }
            };

            setTimeout(loadDataAndBuildForm, 100);
            break;
        }

        case 'request-loan': {
            // 1. Configuración Visual
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            // Aseguramos que el footer estándar esté visible
            const defaultFooter = document.getElementById('main-modal-footer');
            if (defaultFooter) defaultFooter.style.display = 'flex';

            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-xl', 'flex', 'flex-col', 'max-h-[90vh]');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            title = 'Solicitar Préstamo / Adelanto';
            btnText = 'Enviar Solicitud';
            btnClass = 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md';

            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-5 shrink-0 rounded-t-xl flex justify-between items-center relative overflow-hidden">
                        <div class="absolute top-0 right-0 p-4 opacity-10 pointer-events-none transform scale-150 translate-x-2 -translate-y-2">
                            <i class="fa-solid fa-hand-holding-dollar text-6xl text-white"></i>
                        </div>
                        
                        <div class="flex items-center gap-4 relative z-10">
                            <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-white text-2xl border border-white/10 shadow-inner">
                                <i class="fa-solid fa-sack-dollar"></i>
                            </div>
                            <div>
                                <h2 class="text-xl font-bold tracking-tight text-white">Nuevo Préstamo</h2>
                                <p class="text-emerald-100 text-xs font-medium">Solicitud de anticipo o libranza</p>
                            </div>
                        </div>
                        <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white transition-colors relative z-10">
                            <i class="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <div class="p-6 bg-gray-50 flex-grow overflow-y-auto custom-scrollbar space-y-5">
                        
                        <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <label class="block text-xs font-bold text-emerald-800 mb-2 uppercase tracking-wide">Monto Solicitado</label>
                            <div class="relative">
                                <span class="absolute left-3 top-2 text-emerald-600 font-black text-xl">$</span>
                                <input type="text" id="loan-request-amount" name="amount" required 
                                    class="currency-input w-full pl-8 pr-4 py-2 border-b-2 border-gray-200 focus:border-emerald-500 bg-transparent text-2xl font-black text-gray-800 placeholder-gray-300 outline-none transition-colors text-right" 
                                    placeholder="0">
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-600 mb-1.5">Fecha Deseada</label>
                                <input type="date" name="date" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-gray-600" value="${new Date().toISOString().split('T')[0]}">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-600 mb-1.5">Cuotas</label>
                                <div class="relative">
                                    <input type="number" id="loan-request-installments" name="installments" value="1" min="1" max="24" 
                                        class="w-full border border-gray-300 rounded-lg p-2.5 text-sm font-bold text-center focus:ring-2 focus:ring-emerald-500 outline-none">
                                </div>
                            </div>
                        </div>

                        <div class="bg-emerald-50 rounded-xl p-4 border border-emerald-100 flex justify-between items-center">
                            <div>
                                <p class="text-xs text-emerald-700 font-bold uppercase flex items-center gap-2">
                                    <i class="fa-solid fa-calculator"></i> Cuota Estimada
                                </p>
                                <p class="text-[10px] text-emerald-600">Descuento aproximado por pago</p>
                            </div>
                            <div class="text-right">
                                <p id="loan-request-quota" class="text-xl font-black text-emerald-800">$ 0</p>
                            </div>
                        </div>

                        <div>
                            <label class="block text-xs font-bold text-gray-600 mb-1.5">Motivo / Descripción</label>
                            <textarea name="description" rows="3" required class="w-full border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none resize-none" placeholder="Ej: Calamidad doméstica, arreglo vehículo..."></textarea>
                        </div>

                        <div class="flex gap-3 items-start p-3 bg-blue-50 text-blue-700 rounded-lg text-xs border border-blue-100">
                            <i class="fa-solid fa-circle-info mt-0.5"></i>
                            <p>La solicitud pasará a revisión por administración. Una vez aprobada, el saldo se descontará automáticamente de tus próximos pagos de nómina según las cuotas pactadas.</p>
                        </div>
                    </div>
                </div>
            `;

            setTimeout(() => {
                const amountInput = document.getElementById('loan-request-amount');
                const installmentsInput = document.getElementById('loan-request-installments');
                const quotaDisplay = document.getElementById('loan-request-quota');

                // Configurar formato moneda
                setupCurrencyInput(amountInput);

                // Lógica de cálculo en tiempo real
                const calculate = () => {
                    const amount = parseFloat(amountInput.value.replace(/[$. ]/g, '')) || 0;
                    const installments = parseInt(installmentsInput.value) || 1;

                    if (amount > 0 && installments > 0) {
                        const quota = amount / installments;
                        // Formateador local simple
                        quotaDisplay.textContent = new Intl.NumberFormat('es-CO', {
                            style: 'currency', currency: 'COP', minimumFractionDigits: 0
                        }).format(quota);
                    } else {
                        quotaDisplay.textContent = '$ 0';
                    }
                };

                amountInput.addEventListener('input', calculate);
                installmentsInput.addEventListener('input', calculate);
            }, 100);
            break;
        }

        // --- CASO: VER PRÉSTAMOS PENDIENTES (ADMIN) ---
        case 'view-pending-loans':
            // 1. Configuración Visual
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            const footerPending = document.getElementById('modal-confirm-btn')?.parentElement;
            if (footerPending) footerPending.style.display = 'none';

            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-4xl', 'flex', 'flex-col', 'max-h-[85vh]');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            title = 'Solicitudes de Préstamo Pendientes';

            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-slate-700 to-slate-900 px-6 py-5 shrink-0 rounded-t-xl flex justify-between items-center">
                        <div class="flex items-center gap-3 text-white">
                            <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-xl border border-white/10">
                                <i class="fa-solid fa-inbox"></i>
                            </div>
                            <div>
                                <h2 class="text-lg font-bold">Solicitudes Pendientes</h2>
                                <p class="text-slate-300 text-xs font-medium">Revisión y aprobación de créditos</p>
                            </div>
                        </div>
                        <button onclick="closeMainModal()" class="text-white/70 hover:text-white"><i class="fa-solid fa-xmark text-xl"></i></button>
                    </div>

                    <div id="pending-loans-list" class="p-6 bg-gray-50 flex-grow overflow-y-auto custom-scrollbar space-y-4">
                        <div class="flex justify-center items-center h-32">
                            <div class="loader"></div>
                        </div>
                    </div>
                </div>
            `;

            setTimeout(async () => {
                const listContainer = document.getElementById('pending-loans-list');
                const fmtMoney = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

                try {
                    const q = query(collectionGroup(db, 'loans'), where('status', '==', 'pending'));
                    const snapshot = await getDocs(q);

                    if (snapshot.empty) {
                        listContainer.innerHTML = `
                            <div class="flex flex-col items-center justify-center py-12 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl bg-white/50">
                                <div class="bg-white p-4 rounded-full shadow-sm mb-3">
                                    <i class="fa-solid fa-check text-3xl text-emerald-500"></i>
                                </div>
                                <p class="font-bold text-gray-600 text-lg">¡Todo al día!</p>
                                <p class="text-sm">No hay solicitudes por revisar.</p>
                            </div>`;
                        return;
                    }

                    listContainer.innerHTML = '';

                    if (!window.pendingLoansMap) {
                        window.pendingLoansMap = new Map();
                    }
                    window.pendingLoansMap.clear();

                    for (const loanDoc of snapshot.docs) {
                        const loan = loanDoc.data();
                        const userRef = loanDoc.ref.parent.parent;
                        const userSnap = await getDoc(userRef);

                        let userData = {
                            firstName: 'Usuario', lastName: 'Desconocido',
                            bankName: '---', accountType: '', accountNumber: '---',
                            photoURL: null
                        };
                        if (userSnap.exists()) userData = userSnap.data();

                        const userName = `${userData.firstName} ${userData.lastName}`;
                        const dateObj = loan.date ? new Date(loan.date) : new Date();
                        const dateStr = dateObj.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });

                        // Generador de avatar si no hay foto
                        const userPhoto = userData.photoURL || `https://ui-avatars.com/api/?name=${userData.firstName}+${userData.lastName}&background=random&color=fff`;

                        // Guardar datos en el mapa global usando el ID del préstamo
                        const loanId = loanDoc.id;
                        window.pendingLoansMap.set(loanId, {
                            id: loanId, uid: userRef.id, userName: userName,
                            amount: loan.amount, date: loan.date,
                            description: loan.description || 'Sin motivo especificado',
                            installments: loan.installments || 1,
                            bankName: userData.bankName || 'No registrado',
                            accountType: userData.accountType || '',
                            accountNumber: userData.accountNumber || '---',
                            userPhoto: userPhoto
                        });

                        // Tarjeta
                        const card = document.createElement('div');
                        card.className = "bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all overflow-hidden group mb-4";

                        card.innerHTML = `
                            <div class="px-5 py-3 border-b border-gray-100 bg-slate-50/50 flex justify-between items-center">
                                <div class="flex items-center gap-3">
                                    <img src="${userPhoto}" alt="${userName}" class="w-8 h-8 rounded-full object-cover border border-slate-200 shadow-sm">
                                    <div>
                                        <h4 class="text-sm font-bold text-gray-800 leading-tight">${userName}</h4>
                                        <p class="text-[10px] text-gray-500">Solicitado el ${dateStr}</p>
                                    </div>
                                </div>
                                <span class="px-2.5 py-1 bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wider rounded-md border border-amber-200 flex items-center gap-1">
                                    <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span> Pendiente
                                </span>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2">
                                <div class="p-5 flex flex-col justify-between">
                                    <div>
                                        <p class="text-xs text-gray-400 uppercase font-bold tracking-wide mb-1">Monto Solicitado</p>
                                        <p class="text-2xl font-black text-gray-800 mb-3 tracking-tight">${fmtMoney.format(loan.amount || 0)} <span class="text-xs font-normal text-gray-400 align-middle">(${loan.installments || 1} pagos)</span></p>
                                        
                                        <div class="bg-gray-50 p-3 rounded-lg border border-gray-100 relative">
                                            <i class="fa-solid fa-quote-left text-gray-300 absolute top-2 left-2 text-xs"></i>
                                            <p class="text-xs text-gray-600 italic leading-relaxed pl-4">${loan.description || 'Sin motivo especificado'}</p>
                                        </div>
                                    </div>
                                </div>
                                
                                <div class="bg-indigo-50/50 p-5 border-t md:border-t-0 md:border-l border-indigo-100 flex flex-col justify-center relative overflow-hidden">
                                    <i class="fa-solid fa-building-columns absolute bottom-[-10px] right-[-10px] text-6xl text-indigo-100 opacity-50 pointer-events-none"></i>
                                    
                                    <div class="relative z-10">
                                        <p class="text-[10px] text-indigo-400 uppercase font-bold mb-2">Cuenta de Destino</p>
                                        <div class="flex items-start gap-3">
                                            <div class="p-2 bg-white rounded-lg text-indigo-600 shadow-sm border border-indigo-50"><i class="fa-solid fa-money-bill-transfer text-lg"></i></div>
                                            <div class="flex-1 min-w-0">
                                                <p class="text-sm font-bold text-indigo-900 truncate">${userData.bankName}</p>
                                                <p class="text-xs text-indigo-600 mb-1">${userData.accountType}</p>
                                                <div class="flex items-center gap-2 bg-white px-2 py-1 rounded border border-indigo-100 w-fit shadow-sm cursor-pointer hover:bg-indigo-50 transition-colors" onclick="navigator.clipboard.writeText('${userData.accountNumber}'); window.showToast('Cuenta copiada', 'success')">
                                                    <span class="font-mono text-xs font-bold text-gray-600 select-all">${userData.accountNumber}</span>
                                                    <i class="fa-regular fa-copy text-[10px] text-indigo-400"></i>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="px-5 py-3 bg-gray-50 border-t border-gray-200 flex justify-end">
                                <button type="button" data-action="open-loan-review" data-loan-id="${loanId}" 
                                    class="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-xs font-bold shadow-sm hover:shadow-md transition-all flex items-center gap-2 transform active:scale-95">
                                    Revisar y Aprobar <i class="fa-solid fa-arrow-right"></i>
                                </button>
                            </div>
                        `;
                        listContainer.appendChild(card);
                    }
                } catch (error) {
                    console.error("Error cargando préstamos:", error);
                    listContainer.innerHTML = `<div class="p-6 text-center text-red-500 bg-red-50 rounded-xl border border-red-100">Error al cargar datos.</div>`;
                }
            }, 100);
            break;

        case 'add-other-payment':
            title = 'Registrar Otro Movimiento';
            btnText = 'Guardar Movimiento';
            btnClass = 'bg-green-500 hover:bg-green-600';
            bodyHtml = `
                <p class="text-sm mb-4">Usa esta opción para registrar movimientos que no son abonos a cortes, como <strong>adelantos</strong>.</p>
                <input type="hidden" name="type" value="otro">
                <div><label class="block text-sm font-medium">Concepto</label><input type="text" name="concept" required class="mt-1 w-full border rounded-md p-2" placeholder="Ej: Adelanto semana 25"></div>
                <div class="mt-4"><label class="block text-sm font-medium">Valor</label><input type="text" name="amount" required class="currency-input mt-1 w-full border rounded-md p-2"></div>
                <div class="mt-4"><label class="block text-sm font-medium">Fecha</label><input type="date" name="date" required class="mt-1 w-full border rounded-md p-2"></div>`;

            setTimeout(() => {
                setupCurrencyInput(modalForm.querySelector('input[name="amount"]'));
                modalForm.querySelector('input[name="date"]').value = new Date().toISOString().split('T')[0];
            }, 100);
            break;

        case 'new-dotacion-catalog-item': {
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            const defaultFooter = document.getElementById('modal-confirm-btn')?.parentElement;
            if (defaultFooter) defaultFooter.style.display = 'none';

            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('overflow-hidden', 'bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-4xl', 'flex', 'flex-col', 'max-h-[90vh]');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            title = 'Nuevo Ítem de Dotación';

            // Lista de tallas comunes
            const sizeOptions = [
                'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Única',
                '28', '30', '32', '34', '36',
                '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45'
            ];

            bodyHtml = `
                <div class="flex flex-col h-full">
                    
                    <div class="bg-gradient-to-r from-cyan-600 to-blue-600 px-8 py-5 shrink-0 relative overflow-hidden rounded-t-xl flex justify-between items-center">
                        <div class="flex items-center gap-4 relative z-10">
                            <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl backdrop-blur-sm border border-white/10 shadow-inner text-white">
                                <i class="fa-solid fa-box-open"></i>
                            </div>
                            <div>
                                <h2 class="text-xl font-bold tracking-tight text-white">Nuevo Ítem de Dotación</h2>
                                <p class="text-cyan-100 text-xs font-medium">Registrar EPP, Uniforme o Insumo</p>
                            </div>
                        </div>
                        <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors relative z-10">
                            <i class="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <div class="flex-grow overflow-y-auto custom-scrollbar p-6 bg-gray-50">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            
                            <div class="md:col-span-1 space-y-4">
                                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm text-center">
                                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-4">Foto del Elemento</h4>
                                    
                                    <div id="dotacion-item-dropzone" class="aspect-square w-full max-w-[200px] mx-auto rounded-lg border-4 border-gray-100 shadow-inner flex items-center justify-center bg-gray-50 relative overflow-hidden group cursor-pointer hover:border-cyan-200 transition-all">
                                        <div id="dotacion-item-preview" class="hidden absolute inset-0">
                                            <img src="" id="dotacion-item-img-preview" class="w-full h-full object-contain">
                                        </div>
                                        <div id="dotacion-item-prompt" class="absolute inset-0 flex flex-col items-center justify-center bg-black/0 group-hover:bg-black/5 transition-all">
                                            <i class="fa-solid fa-camera text-3xl text-gray-300 group-hover:text-cyan-600 drop-shadow-md transition-all"></i>
                                            <span class="text-xs text-gray-400 mt-2 font-medium group-hover:text-cyan-700">Subir Foto</span>
                                        </div>
                                    </div>

                                    <input type="file" id="dotacion-item-photo-input" name="photo" accept="image/*,.heic,.heif" class="hidden">
                                    
                                    <div class="mt-4">
                                        <button type="button" id="dotacion-item-upload-btn" class="bg-cyan-50 hover:bg-cyan-100 text-cyan-700 text-xs font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors mx-auto w-full max-w-[200px]">
                                            <i class="fa-solid fa-upload"></i> Seleccionar Imagen
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div class="md:col-span-1 space-y-4">
                                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-2">Identificación</h4>

                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Nombre <span class="text-red-500">*</span></label>
                                        <input type="text" name="itemName" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-cyan-500 outline-none font-bold text-gray-800" placeholder="Ej: Botas Dielectrícas">
                                    </div>

                                    <div class="grid grid-cols-2 gap-4">
                                        <div>
                                            <label class="block text-xs font-bold text-gray-700 mb-1">Categoría <span class="text-red-500">*</span></label>
                                            <select name="category" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-cyan-500 bg-white">
                                                <option value="" disabled selected>Seleccionar...</option>
                                                <option value="epp">🦺 EPP</option>
                                                <option value="uniforme">👕 Uniforme</option>
                                                <option value="calzado">🥾 Calzado</option>
                                                <option value="herramienta_asignada">🛠️ Herramienta</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-gray-700 mb-1">Género</label>
                                            <select name="gender" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-cyan-500 bg-white">
                                                <option value="unisex">Unisex</option>
                                                <option value="hombre">Hombre</option>
                                                <option value="mujer">Mujer</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Referencia</label>
                                        <input type="text" name="reference" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-cyan-500 outline-none" placeholder="Ej: REF-123">
                                    </div>
                                </div>

                                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-4">Parámetros</h4>
                                    <div class="grid grid-cols-2 gap-4">
                                        <div>
                                            <label class="block text-xs font-bold text-gray-700 mb-1">Vida Útil (Días)</label>
                                            <input type="number" name="vidaUtilDias" required min="1" value="180" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 font-mono text-center">
                                        </div>
                                        
                                        <div>
                                            <label class="block text-xs font-bold text-gray-700 mb-1">Stock Inicial</label>
                                            <input type="number" name="initialStock" value="0" min="0" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 font-mono text-center font-bold bg-gray-50">
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="mt-6 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                            <label class="block text-xs font-bold text-gray-700 mb-2">Tallas / Variantes Manejadas</label>
                            <div class="flex flex-wrap gap-2 max-h-40 overflow-y-auto custom-scrollbar p-1">
                                ${sizeOptions.map(size => `
                                    <label class="cursor-pointer select-none">
                                        <input type="checkbox" name="sizes_common" value="${size}" class="peer sr-only" ${['S', 'M', 'L', 'Única'].includes(size) ? 'checked' : ''}>
                                        <div class="px-3 py-1.5 rounded border border-gray-200 text-xs font-bold text-gray-500 peer-checked:bg-cyan-600 peer-checked:text-white peer-checked:border-cyan-600 transition-all hover:border-cyan-300">
                                            ${size}
                                        </div>
                                    </label>
                                `).join('')}
                                <input type="hidden" name="tallas" id="tallas-input">
                            </div>
                        </div>
                    </div>

                    <div class="bg-white border-t border-gray-200 p-4 shrink-0 flex justify-end gap-3 z-20 rounded-b-xl">
                        <button type="button" onclick="closeMainModal()" class="px-5 py-2.5 rounded-lg text-gray-600 font-bold hover:bg-gray-100 transition-colors text-sm">Cancelar</button>
                        <button type="button" onclick="document.getElementById('modal-form').requestSubmit()" class="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white px-8 py-2.5 rounded-lg font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm flex items-center gap-2">
                            <i class="fa-solid fa-floppy-disk"></i> Guardar Ítem
                        </button>
                    </div>
                </div>
            `;

            // Lógica de Foto y Tallas
            setTimeout(() => {
                // 1. Tallas
                const form = document.getElementById('modal-form');
                if (form) {
                    form.addEventListener('submit', (e) => {
                        const checkedSizes = Array.from(form.querySelectorAll('input[name="sizes_common"]:checked')).map(cb => cb.value);
                        const hiddenInput = document.getElementById('tallas-input');
                        if (hiddenInput) hiddenInput.value = checkedSizes.join(',');
                    });
                }

                // 2. Foto (Lógica reutilizable)
                const dropzone = document.getElementById('dotacion-item-dropzone');
                const fileInput = document.getElementById('dotacion-item-photo-input');
                const uploadBtn = document.getElementById('dotacion-item-upload-btn');
                const preview = document.getElementById('dotacion-item-preview');
                const previewImg = document.getElementById('dotacion-item-img-preview');
                const prompt = document.getElementById('dotacion-item-prompt');

                const triggerUpload = () => fileInput.click();

                if (dropzone) dropzone.onclick = triggerUpload;
                if (uploadBtn) uploadBtn.onclick = triggerUpload;

                if (fileInput) {
                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                                previewImg.src = ev.target.result;
                                preview.classList.remove('hidden');
                                prompt.classList.add('hidden');
                                dropzone.classList.add('border-cyan-500');
                            };
                            reader.readAsDataURL(file);
                        }
                    };
                }
            }, 100);

            break;
        }

        case 'edit-dotacion-catalog-item': {
            // 1. Configuración Visual
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            const defaultFooter = document.getElementById('modal-confirm-btn')?.parentElement;
            if (defaultFooter) defaultFooter.style.display = 'none';

            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-4xl', 'flex', 'flex-col', 'max-h-[90vh]');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            title = 'Editar Ítem de Dotación';

            // Datos de Tallas
            const currentSizes = (data.tallas || '').split(',').map(s => s.trim());
            const sizeOptions = [
                'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Única',
                '28', '30', '32', '34', '36',
                '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45'
            ];

            // --- LÓGICA DE VISUALIZACIÓN DE STOCK POR TALLA (INVERTIDA) ---
            let stockDisplayHtml = `<p class="text-3xl font-black text-cyan-700">${data.quantityInStock || 0}</p>`;

            try {
                // Parseamos el JSON que viene del dataset
                const stockData = data.stockMap ? JSON.parse(data.stockMap) : {};
                const entries = Object.entries(stockData).filter(([k, v]) => v > 0);

                if (entries.length > 0) {
                    let badges = entries.map(([talla, cant]) =>
                        `<span class="inline-block bg-white/80 border border-cyan-200 text-cyan-800 text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm">${talla}: ${cant}</span>`
                    ).join(' ');

                    // CAMBIO AQUÍ: Total Arriba, Badges Abajo
                    stockDisplayHtml = `
                        <div class="flex items-baseline gap-2 border-b border-cyan-200 pb-2 mb-2">
                            <p class="text-3xl font-black text-cyan-700 leading-none">${data.quantityInStock}</p>
                            <span class="text-xs font-bold text-cyan-600 opacity-70">Total</span>
                        </div>
                        <div class="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar pr-1">${badges}</div>
                    `;
                }
            } catch (e) { console.warn("Error parseando stock map", e); }
            // --------------------------------------------------

            bodyHtml = `
                <div class="flex flex-col h-full">
                    
                    <div class="bg-gradient-to-r from-cyan-600 to-blue-600 px-8 py-5 shrink-0 relative overflow-hidden rounded-t-xl flex justify-between items-center">
                        <div class="flex items-center gap-4 relative z-10">
                            <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl backdrop-blur-sm border border-white/10 shadow-inner text-white">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </div>
                            <div>
                                <h2 class="text-xl font-bold tracking-tight text-white">Editar Ítem</h2>
                                <p class="text-cyan-100 text-xs font-medium">${data.itemName || data.name}</p>
                            </div>
                        </div>

                        <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors relative z-10">
                            <i class="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <div class="flex-grow overflow-y-auto custom-scrollbar p-6 bg-gray-50">
                        
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            
                            <div class="md:col-span-1 space-y-6">
                                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm text-center">
                                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-4">Foto del Elemento</h4>
                                    
                                    <div id="dotacion-item-dropzone" class="aspect-square w-full max-w-[200px] mx-auto rounded-lg border-4 ${data.itemPhotoURL ? 'border-cyan-500' : 'border-gray-100'} shadow-inner flex items-center justify-center bg-gray-50 relative overflow-hidden group cursor-pointer hover:border-cyan-200 transition-all">
                                        
                                        <div id="dotacion-item-preview" class="${data.itemPhotoURL ? '' : 'hidden'} absolute inset-0">
                                            <img src="${data.itemPhotoURL || ''}" id="dotacion-item-img-preview" class="w-full h-full object-contain">
                                            <div class="absolute bottom-0 left-0 w-full bg-black/50 text-white text-xs py-1 text-center opacity-0 group-hover:opacity-100 transition-opacity">Clic para cambiar</div>
                                        </div>

                                        <div id="dotacion-item-prompt" class="${data.itemPhotoURL ? 'hidden' : ''} absolute inset-0 flex flex-col items-center justify-center bg-black/0 group-hover:bg-black/5 transition-all">
                                            <i class="fa-solid fa-camera text-3xl text-gray-300 group-hover:text-cyan-600 drop-shadow-md transition-all"></i>
                                            <span class="text-xs text-gray-400 mt-2 font-medium group-hover:text-cyan-700">Subir Foto</span>
                                        </div>
                                    </div>

                                    <input type="file" id="dotacion-item-photo-input" name="photo" accept="image/*,.heic,.heif" class="hidden">
                                    
                                    <div class="mt-4">
                                        <button type="button" id="dotacion-item-upload-btn" class="bg-cyan-50 hover:bg-cyan-100 text-cyan-700 text-xs font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors mx-auto w-full max-w-[200px]">
                                            <i class="fa-solid fa-upload"></i> Cambiar Imagen
                                        </button>
                                    </div>
                                </div>

                                <div class="bg-cyan-50 p-4 rounded-xl border border-cyan-100 flex items-start gap-4">
                                    <div class="bg-white p-3 rounded-full text-cyan-600 shadow-sm mt-1 shrink-0"><i class="fa-solid fa-boxes-stacked text-xl"></i></div>
                                    <div class="flex-grow min-w-0">
                                        <p class="text-[10px] font-bold text-cyan-800 uppercase mb-2 tracking-wide">Inventario Actual</p>
                                        ${stockDisplayHtml}
                                    </div>
                                </div>
                            </div>

                            <div class="md:col-span-1 space-y-4">
                                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-2">Identificación</h4>

                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Nombre <span class="text-red-500">*</span></label>
                                        <input type="text" name="itemName" required value="${data.itemName || data.name || ''}" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-cyan-500 outline-none font-bold text-gray-800">
                                    </div>

                                    <div class="grid grid-cols-2 gap-4">
                                        <div>
                                            <label class="block text-xs font-bold text-gray-700 mb-1">Categoría</label>
                                            <select name="category" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-cyan-500 bg-white">
                                                <option value="epp" ${data.category === 'epp' ? 'selected' : ''}>🦺 EPP</option>
                                                <option value="uniforme" ${data.category === 'uniforme' ? 'selected' : ''}>👕 Uniforme</option>
                                                <option value="calzado" ${data.category === 'calzado' ? 'selected' : ''}>🥾 Calzado</option>
                                                <option value="herramienta_asignada" ${data.category === 'herramienta_asignada' ? 'selected' : ''}>🛠️ Herramienta</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-gray-700 mb-1">Género</label>
                                            <select name="gender" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-cyan-500 bg-white">
                                                <option value="unisex" ${data.gender === 'unisex' ? 'selected' : ''}>Unisex</option>
                                                <option value="hombre" ${data.gender === 'hombre' ? 'selected' : ''}>Hombre</option>
                                                <option value="mujer" ${data.gender === 'mujer' ? 'selected' : ''}>Mujer</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1">Referencia</label>
                                        <input type="text" name="reference" value="${data.reference || ''}" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-cyan-500 outline-none">
                                    </div>
                                </div>

                                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-4">Parámetros</h4>
                                    <div class="grid grid-cols-2 gap-4">
                                        <div>
                                            <label class="block text-xs font-bold text-gray-700 mb-1">Vida Útil (Días)</label>
                                            <input type="number" name="vidaUtilDias" required min="1" value="${data.vidaUtilDias || 180}" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 font-mono text-center">
                                        </div>
                                        
                                        <div>
                                            <label class="block text-xs font-bold text-gray-700 mb-1">Stock Mínimo</label>
                                            <input type="number" name="minStock" value="${data.minStock || 5}" min="0" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 font-mono text-center">
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="mt-6 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                            <label class="block text-xs font-bold text-gray-700 mb-2">Tallas / Variantes Manejadas</label>
                            <div class="flex flex-wrap gap-2 max-h-40 overflow-y-auto custom-scrollbar p-1">
                                ${sizeOptions.map(size => {
                const checked = currentSizes.includes(size) ? 'checked' : '';
                return `
                                    <label class="cursor-pointer select-none">
                                        <input type="checkbox" name="sizes_common" value="${size}" class="peer sr-only" ${checked}>
                                        <div class="px-3 py-1.5 rounded border border-gray-200 text-xs font-bold text-gray-500 peer-checked:bg-cyan-600 peer-checked:text-white peer-checked:border-cyan-600 transition-all hover:border-cyan-300 shadow-sm">
                                            ${size}
                                        </div>
                                    </label>
                                    `;
            }).join('')}
                                <input type="hidden" name="tallas" id="tallas-input" value="${data.tallas || ''}">
                                <input type="hidden" name="itemId" value="${data.id}">
                            </div>
                            <p class="text-[10px] text-gray-400 mt-2">Nota: Estas son las tallas disponibles para asignar en futuras entregas.</p>
                        </div>

                    </div>

                    <div class="bg-white border-t border-gray-200 p-4 shrink-0 flex justify-end gap-3 z-20 rounded-b-xl">
                        <button type="button" onclick="closeMainModal()" class="px-5 py-2.5 rounded-lg text-gray-600 font-bold hover:bg-gray-100 transition-colors text-sm">
                            Cancelar
                        </button>
                        <button type="button" onclick="document.getElementById('modal-form').requestSubmit()" class="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white px-8 py-2.5 rounded-lg font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm flex items-center gap-2">
                            <i class="fa-solid fa-check"></i> Actualizar Ítem
                        </button>
                    </div>
                </div>
            `;

            // Lógica
            setTimeout(() => {
                const form = document.getElementById('modal-form');
                if (form) {
                    form.addEventListener('submit', (e) => {
                        const checkedSizes = Array.from(form.querySelectorAll('input[name="sizes_common"]:checked')).map(cb => cb.value);
                        const hiddenInput = document.getElementById('tallas-input');
                        if (hiddenInput) hiddenInput.value = checkedSizes.join(',');
                    });
                }

                // Foto
                const dropzone = document.getElementById('dotacion-item-dropzone');
                const fileInput = document.getElementById('dotacion-item-photo-input');
                const uploadBtn = document.getElementById('dotacion-item-upload-btn');
                const preview = document.getElementById('dotacion-item-preview');
                const previewImg = document.getElementById('dotacion-item-img-preview');
                const prompt = document.getElementById('dotacion-item-prompt');

                const triggerUpload = () => fileInput.click();

                if (dropzone) dropzone.onclick = triggerUpload;
                if (uploadBtn) uploadBtn.onclick = triggerUpload;

                if (fileInput) {
                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                                previewImg.src = ev.target.result;
                                preview.classList.remove('hidden');
                                prompt.classList.add('hidden');
                                dropzone.classList.add('border-cyan-500');
                            };
                            reader.readAsDataURL(file);
                        }
                    };
                }
            }, 100);

            break;
        }

        // --- FIN DE NUEVO CÓDIGO ---

        case 'add-dotacion-stock': {
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            const defaultFooter = document.getElementById('modal-confirm-btn')?.parentElement;
            if (defaultFooter) defaultFooter.style.display = 'none';

            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-2xl', 'flex', 'flex-col', 'max-h-[90vh]');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            title = 'Añadir Stock a Inventario';

            // 1. Obtener las tallas configuradas para este ítem
            let availableSizes = [];
            if (data.tallas) {
                availableSizes = data.tallas.split(',').map(s => s.trim());
            } else {
                // Fallback si es un ítem antiguo sin tallas definidas
                availableSizes = [data.talla || 'Única'];
            }

            // 2. Crear opciones del select
            const sizeOptionsHtml = availableSizes.map(s => `<option value="${s}">${s}</option>`).join('');

            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-5 shrink-0 rounded-t-xl flex justify-between items-center">
                        <div class="flex items-center gap-3 text-white">
                            <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-xl backdrop-blur-sm border border-white/10">
                                <i class="fa-solid fa-boxes-stacked"></i>
                            </div>
                            <div>
                                <h2 class="text-lg font-bold">Entrada de Mercancía</h2>
                                <p class="text-emerald-100 text-xs font-medium">Registrar nuevo stock</p>
                            </div>
                        </div>
                        <button onclick="closeMainModal()" class="text-white/70 hover:text-white"><i class="fa-solid fa-xmark text-xl"></i></button>
                    </div>

                    <div class="p-6 bg-gray-50 flex-grow overflow-y-auto custom-scrollbar">
                        
                        <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex gap-5 mb-5">
                            <div class="w-20 h-20 rounded-lg border border-gray-100 p-1 bg-gray-50 flex-shrink-0">
                                <img src="${data.itemPhotoURL || 'https://via.placeholder.com/150?text=Sin+Foto'}" class="w-full h-full object-contain rounded-md">
                            </div>
                            <div class="flex-grow">
                                <h3 class="text-base font-bold text-gray-800 leading-tight">${data.itemName}</h3>
                                <p class="text-xs text-gray-500 mt-1">Categoría: ${data.category}</p>
                                
                                <div class="mt-2 flex flex-wrap gap-1" id="current-stock-display">
                                    <span class="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded border border-emerald-100 font-bold">
                                        Total: ${data.quantityInStock}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <input type="hidden" name="itemId" value="${data.id}">
                        <input type="hidden" name="itemName" value="${data.itemName}">
                        
                        <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                            
                            <div>
                                <label class="block text-xs font-bold text-gray-700 mb-1 uppercase">Seleccionar Talla / Variante <span class="text-red-500">*</span></label>
                                <select name="targetSize" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm font-bold text-gray-800 focus:ring-2 focus:ring-emerald-500 bg-white">
                                    ${sizeOptionsHtml}
                                </select>
                                <p class="text-[10px] text-gray-400 mt-1">Solo se muestran las tallas configuradas para este ítem.</p>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-xs font-bold text-gray-700 mb-1 uppercase">Cantidad a Ingresar <span class="text-red-500">*</span></label>
                                    <input type="number" name="quantity" required class="w-full border-gray-300 rounded-lg p-2.5 text-lg font-bold text-gray-800 focus:ring-emerald-500 focus:border-emerald-500 text-center" min="1" placeholder="0">
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-gray-700 mb-1 uppercase">Costo Total Compra</label>
                                    <div class="relative">
                                        <span class="absolute left-3 top-2.5 text-gray-400 font-bold">$</span>
                                        <input type="text" id="dotacion-purchase-cost" name="purchaseCost" class="currency-input w-full border-gray-300 rounded-lg p-2.5 pl-7 text-sm focus:ring-emerald-500 focus:border-emerald-500 font-mono" placeholder="0">
                                    </div>
                                    <p class="text-[10px] text-gray-400 mt-1 text-right">Opcional</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white border-t border-gray-200 p-4 flex justify-end gap-3 rounded-b-xl">
                        <button type="button" onclick="closeMainModal()" class="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
                        <button type="button" onclick="document.getElementById('modal-form').requestSubmit()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-md transition-transform active:scale-95">
                            <i class="fa-solid fa-plus mr-1"></i> Añadir Stock
                        </button>
                    </div>
                </div>
            `;

            setTimeout(() => {
                setupCurrencyInput(document.getElementById('dotacion-purchase-cost'));
            }, 100);
            break;
        }

        case 'register-dotacion-delivery': {
            // 1. Configuración Visual
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            const defaultFooter = document.getElementById('modal-confirm-btn')?.parentElement;
            if (defaultFooter) defaultFooter.style.display = 'none';

            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-3xl', 'flex', 'flex-col', 'max-h-[90vh]');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            title = 'Registrar Entrega de Dotación';

            const userChoices = Array.from(usersMap.entries())
                .filter(([id, user]) => user.status === 'active')
                .sort((a, b) => a[1].firstName.localeCompare(b[1].firstName))
                .map(([id, user]) => ({
                    value: id,
                    label: `${user.firstName} ${user.lastName}`,
                    customProperties: {
                        tallaCamisa: user.tallaCamiseta || '',
                        tallaPantalon: user.tallaPantalón || user.tallaPantalon || '',
                        tallaBotas: user.tallaBotas || ''
                    }
                }));

            // Validación de stock para bloquear UI si es 0
            const hasStock = data.quantityInStock > 0;

            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-cyan-600 to-blue-600 px-6 py-5 shrink-0 rounded-t-xl flex justify-between items-center">
                        <div class="flex items-center gap-3 text-white">
                            <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-xl backdrop-blur-sm border border-white/10">
                                <i class="fa-solid fa-box-open"></i>
                            </div>
                            <div>
                                <h2 class="text-lg font-bold">Entrega de Dotación</h2>
                                <p class="text-cyan-100 text-xs font-medium">Asignar ítem a colaborador</p>
                            </div>
                        </div>
                        <button onclick="closeMainModal()" class="text-white/70 hover:text-white"><i class="fa-solid fa-xmark text-xl"></i></button>
                    </div>

                    <div class="p-6 bg-gray-50 flex-grow overflow-y-auto custom-scrollbar">
                        
                        <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-6 relative overflow-hidden">
                            <div class="absolute top-0 left-0 w-1 h-full bg-cyan-500"></div>
                            <div class="flex flex-col md:flex-row gap-5 items-start md:items-center">
                                <div class="w-16 h-16 rounded-lg border border-gray-100 p-1 bg-gray-50 flex-shrink-0">
                                    <img src="${data.itemPhotoURL || 'https://via.placeholder.com/150?text=Sin+Foto'}" class="w-full h-full object-contain rounded-md">
                                </div>
                                
                                <div class="flex-grow min-w-0 space-y-1">
                                    <h3 class="text-sm font-bold text-gray-800 leading-tight">${data.itemName}</h3>
                                    <p class="text-xs text-gray-500 uppercase tracking-wide">${data.category || 'General'}</p>
                                    
                                    <div class="flex items-center gap-2 mt-2">
                                        <label class="text-xs font-bold text-gray-600">Talla a Entregar:</label>
                                        <select id="delivery-talla-select" name="talla" class="text-xs border-gray-300 rounded focus:ring-cyan-500 font-bold text-cyan-700 bg-cyan-50 border py-1 pl-2 pr-6">
                                            <option value="" disabled selected>Cargando...</option>
                                        </select>
                                    </div>
                                </div>

                                <div class="text-right min-w-[80px]">
                                    <p class="text-[10px] text-gray-400 uppercase font-bold">Disponible</p>
                                    <p id="delivery-stock-display" class="text-2xl font-black text-gray-300">---</p>
                                </div>
                            </div>
                        </div>

                        <input type="hidden" name="itemId" value="${data.id}">
                        <input type="hidden" name="itemName" value="${data.itemName}">

                        <div class="space-y-5">
                            <div>
                                <label class="block text-xs font-bold text-gray-700 mb-1 uppercase">1. Colaborador <span class="text-red-500">*</span></label>
                                <select id="dotacion-assignedTo" name="assignedTo" class="w-full border-gray-300 rounded-lg"></select>
                                
                                <div id="preferred-talla-suggestion" class="hidden mt-2 p-2 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-2 text-xs text-blue-700 animate-fade-in">
                                    <i class="fa-solid fa-ruler-combined"></i>
                                    <span>El usuario usa talla: <strong id="suggestion-value">M</strong></span>
                                </div>
                            </div>

                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-xs font-bold text-gray-700 mb-1 uppercase">2. Cantidad <span class="text-red-500">*</span></label>
                                    <input type="number" id="delivery-quantity-input" name="quantity" class="w-full border-gray-300 rounded-lg p-2.5 text-sm font-bold text-center" min="1" value="1" disabled>
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-gray-700 mb-1 uppercase">3. Serial (Opcional)</label>
                                    <input type="text" name="serialNumber" class="w-full border-gray-300 rounded-lg p-2.5 text-sm" placeholder="Ej: SN-12345">
                                </div>
                            </div>

                            <div>
                                <label class="block text-xs font-bold text-gray-700 mb-2 uppercase">4. Evidencia de Entrega <span class="text-red-500">*</span></label>
                                <div id="assign-dotacion-dropzone" class="h-40 w-full rounded-xl border-2 border-dashed border-gray-300 hover:border-cyan-500 bg-white flex flex-col items-center justify-center cursor-pointer transition-all group relative overflow-hidden">
                                    <div id="assign-dotacion-preview" class="hidden absolute inset-0 bg-gray-100">
                                        <img src="" id="assign-dotacion-img-preview" class="w-full h-full object-contain">
                                        <div class="absolute bottom-0 left-0 w-full bg-black/50 text-white text-xs py-1 text-center">Clic para cambiar</div>
                                    </div>
                                    <div id="assign-dotacion-prompt" class="text-center p-4 group-hover:scale-105 transition-transform">
                                        <div class="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2 text-gray-400 group-hover:text-cyan-600 group-hover:bg-cyan-50 transition-colors">
                                            <i class="fa-solid fa-camera text-lg"></i>
                                        </div>
                                        <p class="text-sm font-bold text-gray-600 group-hover:text-cyan-700">Subir Foto</p>
                                        <p class="text-[10px] text-gray-400 mt-1">Formato de entrega firmado o foto del ítem.</p>
                                    </div>
                                </div>
                                <input type="file" id="dotacion-assign-photo" name="assignPhoto" accept="image/*" class="hidden">
                            </div>

                            <div>
                                <label class="block text-xs font-bold text-gray-700 mb-1 uppercase">5. Fecha de Entrega</label>
                                <input type="date" name="fechaEntrega" class="w-full border-gray-300 rounded-lg p-2.5 text-sm text-gray-600">
                            </div>
                        </div>
                    </div>

                    <div class="bg-white border-t border-gray-200 p-4 flex justify-end gap-3 rounded-b-xl">
                        <button type="button" onclick="closeMainModal()" class="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
                        <button type="button" id="btn-confirm-delivery" onclick="document.getElementById('modal-form').requestSubmit()" 
                            class="bg-cyan-600 hover:bg-cyan-700 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-md transition-transform active:scale-95 flex items-center gap-2 disabled:bg-gray-300 disabled:cursor-not-allowed" disabled>
                            <i class="fa-solid fa-check"></i> Confirmar Entrega
                        </button>
                    </div>
                </div>
            `;

            setTimeout(async () => {
                const tallaSelect = document.getElementById('delivery-talla-select');
                const stockDisplay = document.getElementById('delivery-stock-display');
                const quantityInput = document.getElementById('delivery-quantity-input');
                const confirmBtn = document.getElementById('btn-confirm-delivery');
                const dateInput = modalForm.querySelector('input[name="fechaEntrega"]');

                if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

                // --- 1. DEFINIR LISTENER PRIMERO ---
                tallaSelect.addEventListener('change', () => {
                    const selectedOption = tallaSelect.options[tallaSelect.selectedIndex];
                    if (!selectedOption) return;

                    const stock = parseInt(selectedOption.dataset.stock || 0);

                    stockDisplay.textContent = stock;
                    stockDisplay.className = `text-2xl font-black ${stock > 0 ? 'text-cyan-600' : 'text-red-500'}`;

                    quantityInput.max = stock;
                    quantityInput.value = 1;

                    if (stock > 0) {
                        quantityInput.disabled = false;
                        confirmBtn.disabled = false; // Habilitar botón
                    } else {
                        quantityInput.disabled = true;
                        confirmBtn.disabled = true;
                    }
                });

                // --- 2. CARGAR DATOS ---
                try {
                    const itemDoc = await getDoc(doc(db, "dotacionCatalog", data.id));
                    const itemReal = itemDoc.data();
                    const stockMap = itemReal.stock || {};

                    tallaSelect.innerHTML = '';
                    let hasStock = false;

                    for (const [talla, cantidad] of Object.entries(stockMap)) {
                        if (cantidad > 0) {
                            const option = document.createElement('option');
                            option.value = talla;
                            option.textContent = talla;
                            option.dataset.stock = cantidad;
                            tallaSelect.appendChild(option);
                            hasStock = true;
                        }
                    }

                    // Fallback para ítems antiguos
                    if (!hasStock && itemReal.quantityInStock > 0) {
                        const t = data.talla && data.talla !== 'N/A' ? data.talla : 'Única';
                        const option = document.createElement('option');
                        option.value = t;
                        option.textContent = t;
                        option.dataset.stock = itemReal.quantityInStock;
                        tallaSelect.appendChild(option);
                        hasStock = true;
                    }

                    if (!hasStock) {
                        tallaSelect.innerHTML = '<option value="" disabled selected>Sin Stock</option>';
                        tallaSelect.disabled = true;
                        stockDisplay.textContent = "0";
                        stockDisplay.className = "text-2xl font-black text-red-500";
                        confirmBtn.disabled = true;
                    } else {
                        // Disparar evento manualmente para activar el botón
                        tallaSelect.dispatchEvent(new Event('change'));
                    }

                } catch (e) {
                    console.error("Error cargando stock:", e);
                    tallaSelect.innerHTML = '<option>Error</option>';
                }

                // Inicializar Choices (Colaborador)
                const selectEl = document.getElementById('dotacion-assignedTo');
                if (selectEl) {
                    new Choices(selectEl, {
                        choices: userChoices,
                        itemSelectText: '',
                        placeholder: true,
                        placeholderValue: 'Buscar colaborador...',
                        searchPlaceholderValue: 'Nombre...'
                    });

                    // Sugerencia Talla
                    selectEl.addEventListener('change', (e) => {
                        const userId = e.detail.value;
                        const selectedUser = userChoices.find(u => u.value === userId);
                        const suggestionBox = document.getElementById('preferred-talla-suggestion');
                        const suggestionVal = document.getElementById('suggestion-value');

                        if (selectedUser && selectedUser.customProperties) {
                            let userTalla = '';
                            const itemName = data.itemName.toLowerCase();
                            if (itemName.includes('camisa') || itemName.includes('camiseta')) userTalla = selectedUser.customProperties.tallaCamisa;
                            else if (itemName.includes('pantalon') || itemName.includes('jean')) userTalla = selectedUser.customProperties.tallaPantalon;
                            else if (itemName.includes('bota') || itemName.includes('calzado')) userTalla = selectedUser.customProperties.tallaBotas;

                            if (userTalla) {
                                suggestionVal.textContent = userTalla;
                                suggestionBox.classList.remove('hidden');
                            } else {
                                suggestionBox.classList.add('hidden');
                            }
                        }
                    });
                }

                // Foto Dropzone
                const dropzone = document.getElementById('assign-dotacion-dropzone');
                const fileInput = document.getElementById('dotacion-assign-photo');
                const preview = document.getElementById('assign-dotacion-preview');
                const previewImg = document.getElementById('assign-dotacion-img-preview');
                const prompt = document.getElementById('assign-dotacion-prompt');

                if (dropzone) {
                    dropzone.onclick = () => fileInput.click();
                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                                previewImg.src = ev.target.result;
                                preview.classList.remove('hidden');
                                prompt.classList.add('hidden');
                                dropzone.classList.add('border-cyan-500');
                            };
                            reader.readAsDataURL(file);
                        }
                    };
                }

            }, 200);
            break;
        }

        // --- INICIO DE CÓDIGO AÑADIDO (MEJORA 1 - DEVOLUCIONES) ---
        case 'return-dotacion-options': {
            // 1. Configuración Visual
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            const defaultFooter = document.getElementById('modal-confirm-btn')?.parentElement;
            if (defaultFooter) defaultFooter.style.display = 'none';

            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-2xl', 'flex', 'flex-col', 'max-h-[90vh]');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            title = 'Registrar Devolución';

            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-orange-500 to-red-600 px-6 py-5 shrink-0 rounded-t-xl flex justify-between items-center">
                        <div class="flex items-center gap-3 text-white">
                            <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-xl backdrop-blur-sm border border-white/10">
                                <i class="fa-solid fa-arrow-rotate-left"></i>
                            </div>
                            <div>
                                <h2 class="text-lg font-bold">Devolución de Dotación</h2>
                                <p class="text-orange-100 text-xs font-medium">Reingreso o baja de inventario</p>
                            </div>
                        </div>
                        <button onclick="closeMainModal()" class="text-white/70 hover:text-white"><i class="fa-solid fa-xmark text-xl"></i></button>
                    </div>

                    <div class="p-6 bg-gray-50 flex-grow overflow-y-auto custom-scrollbar">
                        
                        <input type="hidden" name="itemId" value="${data.itemId}">
                        <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-6 flex items-center gap-4">
                            <div class="w-12 h-12 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center text-2xl">
                                <i class="fa-solid fa-shirt"></i>
                            </div>
                            <div>
                                <h3 class="font-bold text-gray-800 text-sm uppercase tracking-wide">Ítem a Devolver</h3>
                                <p class="text-lg font-black text-gray-900 leading-none">${data.itemName}</p>
                            </div>
                        </div>

                        <div class="space-y-6">
                            
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-3">1. ¿Qué destino tiene el ítem?</label>
                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    
                                    <label class="cursor-pointer group relative">
                                        <input type="radio" name="returnType" value="stock" class="peer sr-only">
                                        <div class="p-4 rounded-xl border-2 border-gray-200 bg-white hover:border-blue-400 peer-checked:border-blue-600 peer-checked:bg-blue-50 transition-all h-full flex flex-col items-center text-center shadow-sm">
                                            <div class="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mb-2 text-lg">
                                                <i class="fa-solid fa-warehouse"></i>
                                            </div>
                                            <p class="font-bold text-gray-700 peer-checked:text-blue-800 text-sm">Reingresar a Stock</p>
                                            <p class="text-[10px] text-gray-400 mt-1">Buen estado. Se puede reasignar.</p>
                                        </div>
                                        <div class="absolute top-2 right-2 text-blue-600 opacity-0 peer-checked:opacity-100 transition-opacity">
                                            <i class="fa-solid fa-circle-check"></i>
                                        </div>
                                    </label>

                                    <label class="cursor-pointer group relative">
                                        <input type="radio" name="returnType" value="descarte" class="peer sr-only">
                                        <div class="p-4 rounded-xl border-2 border-gray-200 bg-white hover:border-red-400 peer-checked:border-red-600 peer-checked:bg-red-50 transition-all h-full flex flex-col items-center text-center shadow-sm">
                                            <div class="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center mb-2 text-lg">
                                                <i class="fa-solid fa-trash-can"></i>
                                            </div>
                                            <p class="font-bold text-gray-700 peer-checked:text-red-800 text-sm">Dar de Baja (Descarte)</p>
                                            <p class="text-[10px] text-gray-400 mt-1">Dañado o vida útil cumplida.</p>
                                        </div>
                                        <div class="absolute top-2 right-2 text-red-600 opacity-0 peer-checked:opacity-100 transition-opacity">
                                            <i class="fa-solid fa-circle-check"></i>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-2">2. Evidencia del Estado <span class="text-red-500">*</span></label>
                                <div id="return-dotacion-dropzone" class="h-32 w-full rounded-xl border-2 border-dashed border-gray-300 hover:border-orange-500 bg-white flex flex-col items-center justify-center cursor-pointer transition-all group relative overflow-hidden">
                                    <div id="return-dotacion-preview" class="hidden absolute inset-0 bg-gray-100">
                                        <img src="" id="return-dotacion-img-preview" class="w-full h-full object-contain">
                                        <div class="absolute bottom-0 left-0 w-full bg-black/50 text-white text-xs py-1 text-center">Clic para cambiar</div>
                                    </div>
                                    <div id="return-dotacion-prompt" class="text-center p-4 group-hover:scale-105 transition-transform">
                                        <i class="fa-solid fa-camera text-2xl text-gray-300 group-hover:text-orange-500 mb-1"></i>
                                        <p class="text-xs font-bold text-gray-500 group-hover:text-orange-700">Subir Foto</p>
                                    </div>
                                </div>
                                <input type="file" id="dotacion-return-photo" name="returnPhoto" required accept="image/*" class="hidden">
                            </div>

                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">3. Observaciones</label>
                                <textarea name="observaciones" rows="2" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 outline-none resize-none" placeholder="Ej: Desgaste natural, rotura en manga..."></textarea>
                            </div>

                        </div>
                    </div>

                    <div class="bg-white border-t border-gray-200 p-4 flex justify-end gap-3 rounded-b-xl">
                        <button type="button" onclick="closeMainModal()" class="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
                        <button type="button" id="btn-confirm-return" onclick="document.getElementById('modal-form').requestSubmit()" 
                            class="bg-orange-600 hover:bg-orange-700 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-md transition-transform active:scale-95 flex items-center gap-2 disabled:bg-gray-300 disabled:cursor-not-allowed" disabled>
                            <i class="fa-solid fa-check"></i> Procesar Devolución
                        </button>
                    </div>
                </div>
            `;

            // IDs ocultos en el dataset (Respaldo)
            modalForm.dataset.id = data.historyId;
            modalForm.dataset.itemid = data.itemId;

            setTimeout(() => {
                const fileInput = document.getElementById('dotacion-return-photo');
                const confirmBtn = document.getElementById('btn-confirm-return');
                const dropzone = document.getElementById('return-dotacion-dropzone');
                const preview = document.getElementById('return-dotacion-preview');
                const previewImg = document.getElementById('return-dotacion-img-preview');
                const prompt = document.getElementById('return-dotacion-prompt');
                const radios = document.querySelectorAll('input[name="returnType"]');

                // Validación en tiempo real para activar botón
                const validateForm = () => {
                    const hasType = Array.from(radios).some(r => r.checked);
                    const hasFile = fileInput.files.length > 0;
                    confirmBtn.disabled = !(hasType && hasFile);
                };

                radios.forEach(r => r.addEventListener('change', validateForm));

                if (dropzone) {
                    dropzone.onclick = () => fileInput.click();
                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                                previewImg.src = ev.target.result;
                                preview.classList.remove('hidden');
                                prompt.classList.add('hidden');
                                dropzone.classList.add('border-orange-500');
                                validateForm();
                            };
                            reader.readAsDataURL(file);
                        }
                    };
                }
            }, 100);
            break;
        }
        // --- FIN DE CÓDIGO AÑADIDO ---

        // --- INICIO DE NUEVO CÓDIGO AÑADIDO ---
        case 'new-tool': {
            // 1. Ocultar elementos por defecto
            if (document.getElementById('modal-title')) document.getElementById('modal-title').parentElement.style.display = 'none';
            const defaultFooter = document.getElementById('modal-confirm-btn')?.parentElement;
            if (defaultFooter) defaultFooter.style.display = 'none';

            // 2. Configurar contenedor
            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('overflow-hidden', 'bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-3xl', 'flex', 'flex-col', 'max-h-[90vh]');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            title = 'Crear Nueva Herramienta';

            // Opciones de categoría
            const categoryOptions = TOOL_CATEGORIES.map(cat =>
                `<option value="${cat.value}">${cat.label}</option>`
            ).join('');

            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-blue-600 to-indigo-700 px-8 py-5 shrink-0 rounded-t-xl flex justify-between items-center relative overflow-hidden">
                        <div class="flex items-center gap-4 relative z-10">
                            <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl backdrop-blur-sm border border-white/10 shadow-inner text-white">
                                <i class="fa-solid fa-hammer"></i>
                            </div>
                            <div>
                                <h2 class="text-xl font-bold tracking-tight text-white">Nueva Herramienta</h2>
                                <p class="text-blue-100 text-xs font-medium">Registrar activo en inventario</p>
                            </div>
                        </div>
                        <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white transition-colors relative z-10">
                            <i class="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <div class="flex-grow overflow-y-auto custom-scrollbar p-6 bg-gray-50">
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                            
                            <div class="md:col-span-1 space-y-3">
                                <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm text-center">
                                    <label class="block text-xs font-bold text-gray-400 uppercase mb-3">Foto del Activo</label>
                                    
                                    <div id="new-tool-dropzone" class="aspect-square w-full rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-all bg-gray-50 relative overflow-hidden group">
                                        <div id="new-tool-preview" class="hidden absolute inset-0">
                                            <img src="" id="new-tool-img-preview" class="w-full h-full object-contain">
                                        </div>
                                        <div id="new-tool-prompt" class="text-center p-4">
                                            <div class="w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-2 text-blue-500 group-hover:scale-110 transition-transform">
                                                <i class="fa-solid fa-camera"></i>
                                            </div>
                                            <p class="text-xs font-bold text-gray-500 group-hover:text-blue-600">Subir Foto</p>
                                        </div>
                                    </div>
                                    <input type="file" id="tool-photo" name="photo" accept="image/*" class="hidden" required> 
                                </div>
                            </div>
                            
                            <div class="md:col-span-2 space-y-5">
                                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-2">Detalles Generales</h4>
                                    
                                    <div>
                                        <label for="tool-name" class="block text-xs font-bold text-gray-700 mb-1">Nombre de la Herramienta <span class="text-red-500">*</span></label>
                                        <input type="text" id="tool-name" name="name" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Ej: Taladro Percutor Dewalt">
                                    </div>

                                    <div class="grid grid-cols-2 gap-4">
                                        <div>
                                            <label for="tool-reference" class="block text-xs font-bold text-gray-700 mb-1">Referencia / Serial</label>
                                            <input type="text" id="tool-reference" name="reference" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Ej: DCD796">
                                        </div>
                                        <div>
                                            <label for="tool-category" class="block text-xs font-bold text-gray-700 mb-1">Categoría <span class="text-red-500">*</span></label>
                                            <select id="tool-category" name="category" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                                                <option value="" disabled selected>Seleccionar...</option>
                                                ${categoryOptions}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-2">Adquisición</h4>
                                    
                                    <div class="grid grid-cols-2 gap-4">
                                        <div>
                                            <label for="tool-purchaseDate" class="block text-xs font-bold text-gray-700 mb-1">Fecha de Compra</label>
                                            <input type="date" id="tool-purchaseDate" name="purchaseDate" class="w-full border-gray-300 rounded-lg p-2.5 text-sm text-gray-600 focus:ring-2 focus:ring-blue-500 outline-none">
                                        </div>
                                        <div>
                                            <label for="tool-purchaseCost" class="block text-xs font-bold text-gray-700 mb-1">Costo (Opcional)</label>
                                            <div class="relative">
                                                <span class="absolute left-3 top-2.5 text-gray-400 font-bold">$</span>
                                                <input type="text" id="tool-purchaseCost" name="purchaseCost" class="currency-input w-full pl-7 border-gray-300 rounded-lg p-2.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none" placeholder="0">
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white border-t border-gray-200 p-4 shrink-0 flex justify-end gap-3 rounded-b-xl">
                        <button type="button" onclick="closeMainModal()" class="px-5 py-2.5 rounded-lg text-gray-600 font-bold hover:bg-gray-100 transition-colors text-sm">
                            Cancelar
                        </button>
                        <button type="button" onclick="document.getElementById('modal-form').requestSubmit()" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm flex items-center gap-2">
                            <i class="fa-solid fa-plus"></i> Crear Herramienta
                        </button>
                    </div>
                </div>
            `;

            // Lógica JS (se mantiene igual, solo ajustamos IDs si es necesario)
            setTimeout(() => {
                const dropzone = document.getElementById('new-tool-dropzone');
                const fileInput = document.getElementById('tool-photo');
                const previewContainer = document.getElementById('new-tool-preview');
                const previewImg = document.getElementById('new-tool-img-preview');
                const promptEl = document.getElementById('new-tool-prompt');

                if (dropzone) {
                    dropzone.addEventListener('click', () => fileInput.click());
                    fileInput.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                                previewImg.src = event.target.result;
                                previewContainer.classList.remove('hidden');
                                promptEl.classList.add('hidden');
                                dropzone.classList.remove('border-dashed');
                                dropzone.classList.add('border-blue-500');
                            }
                            reader.readAsDataURL(file);
                        }
                    });
                }

                const costInput = document.getElementById('tool-purchaseCost');
                if (costInput) setupCurrencyInput(costInput);

                const dateInput = document.getElementById('tool-purchaseDate');
                if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

            }, 100);
            break;
        }
        // --- FIN DE NUEVO CÓDIGO AÑADIDO ---

        case 'edit-tool': {
            // 1. Ocultar elementos por defecto
            if (document.getElementById('modal-title')) document.getElementById('modal-title').parentElement.style.display = 'none';
            const defaultFooter = document.getElementById('modal-confirm-btn')?.parentElement;
            if (defaultFooter) defaultFooter.style.display = 'none';

            // 2. Configurar contenedor
            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-4xl', 'flex', 'flex-col', 'max-h-[90vh]');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            title = 'Editar Herramienta';

            // Opciones de categoría
            const categoryOptions = TOOL_CATEGORIES.map(cat =>
                `<option value="${cat.value}" ${data.category === cat.value ? 'selected' : ''}>${cat.label}</option>`
            ).join('');

            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-amber-500 to-orange-600 px-8 py-5 shrink-0 rounded-t-xl flex justify-between items-center relative overflow-hidden">
                        <div class="flex items-center gap-4 relative z-10">
                            <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl backdrop-blur-sm border border-white/10 shadow-inner text-white">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </div>
                            <div>
                                <h2 class="text-xl font-bold tracking-tight text-white">Editar Herramienta</h2>
                                <p class="text-amber-100 text-xs font-medium">${data.name || 'Sin Nombre'}</p>
                            </div>
                        </div>
                        <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white transition-colors relative z-10">
                            <i class="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <div class="flex-grow overflow-y-auto custom-scrollbar p-6 bg-gray-50">
                        
                        <div class="grid grid-cols-1 md:grid-cols-12 gap-6">
                            
                            <div class="md:col-span-4 space-y-3">
                                <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm text-center h-full flex flex-col justify-center">
                                    <label class="block text-xs font-bold text-gray-400 uppercase mb-3">Foto Actual</label>
                                    
                                    <div class="aspect-square w-full rounded-lg border-4 border-gray-100 bg-gray-50 overflow-hidden relative group shadow-inner mx-auto max-w-[220px]">
                                        ${data.photoURL
                    ? `<img src="${data.photoURL}" class="w-full h-full object-contain cursor-zoom-in hover:scale-105 transition-transform duration-500" onclick="openImageModal('${data.photoURL}')">`
                    : `<div class="flex flex-col items-center justify-center h-full text-gray-300"><i class="fa-solid fa-image text-4xl mb-2"></i><p class="text-xs">Sin imagen</p></div>`
                }
                                        ${data.photoURL ? `<div class="absolute bottom-2 right-2 bg-black/50 text-white p-1.5 rounded-lg backdrop-blur-sm"><i class="fa-solid fa-magnifying-glass-plus text-xs"></i></div>` : ''}
                                    </div>
                                    
                                    <div class="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
                                        <p class="text-[10px] text-amber-700 leading-tight">
                                            <i class="fa-solid fa-circle-info mr-1"></i>
                                            Para cambiar la foto, elimina la herramienta y créala de nuevo, o contacta al administrador.
                                        </p>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="md:col-span-8 space-y-5">
                                <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-2">Información Básica</h4>
                                    
                                    <div class="grid grid-cols-1 gap-4">
                                        <div>
                                            <label for="tool-name" class="block text-xs font-bold text-gray-700 mb-1">Nombre de la Herramienta <span class="text-red-500">*</span></label>
                                            <input type="text" id="tool-name" name="name" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm font-bold text-gray-800 focus:ring-2 focus:ring-amber-500 outline-none" value="${data.name || ''}">
                                        </div>
                                    </div>

                                    <div class="grid grid-cols-2 gap-4">
                                        <div>
                                            <label for="tool-reference" class="block text-xs font-bold text-gray-700 mb-1">Referencia / Serial</label>
                                            <input type="text" id="tool-reference" name="reference" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-amber-500 outline-none" value="${data.reference || ''}">
                                        </div>
                                        <div>
                                            <label for="tool-category" class="block text-xs font-bold text-gray-700 mb-1">Categoría <span class="text-red-500">*</span></label>
                                            <select id="tool-category" name="category" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-amber-500 outline-none">
                                                <option value="" disabled>Seleccione...</option>
                                                ${categoryOptions}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide border-b pb-2 mb-2">Detalles de Adquisición</h4>
                                    
                                    <div class="grid grid-cols-2 gap-4">
                                        <div>
                                            <label for="tool-purchaseDate" class="block text-xs font-bold text-gray-700 mb-1">Fecha de Compra</label>
                                            <input type="date" id="tool-purchaseDate" name="purchaseDate" class="w-full border-gray-300 rounded-lg p-2.5 text-sm text-gray-600 focus:ring-2 focus:ring-amber-500 outline-none" value="${data.purchaseDate || ''}">
                                        </div>
                                        <div>
                                            <label for="tool-purchaseCost" class="block text-xs font-bold text-gray-700 mb-1">Costo (Opcional)</label>
                                            <div class="relative">
                                                <span class="absolute left-3 top-2.5 text-gray-400 font-bold">$</span>
                                                <input type="text" id="tool-purchaseCost" name="purchaseCost" class="currency-input w-full pl-7 border-gray-300 rounded-lg p-2.5 text-sm font-mono focus:ring-2 focus:ring-amber-500 outline-none" placeholder="0" value="${data.purchaseCost || 0}">
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                <p class="text-xs text-gray-400 italic text-center">
                                    <i class="fa-solid fa-arrows-rotate mr-1"></i> El estado ("En uso", "Disponible") se gestiona automáticamente con las acciones de Asignar/Recibir.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white border-t border-gray-200 p-4 shrink-0 flex justify-end gap-3 rounded-b-xl">
                        <button type="button" onclick="closeMainModal()" class="px-5 py-2.5 rounded-lg text-gray-600 font-bold hover:bg-gray-100 transition-colors text-sm">
                            Cancelar
                        </button>
                        <button type="button" onclick="document.getElementById('modal-form').requestSubmit()" class="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white px-6 py-2.5 rounded-lg font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm flex items-center gap-2">
                            <i class="fa-solid fa-floppy-disk"></i> Guardar Cambios
                        </button>
                    </div>
                </div>
            `;

            // Lógica JS (Formateo de moneda)
            setTimeout(() => {
                const costInput = document.getElementById('tool-purchaseCost');
                if (costInput) setupCurrencyInput(costInput);
            }, 100);

            break;
        }

        case 'assign-tool': {
            // 1. Ocultar defaults

            if (document.getElementById('modal-title')) document.getElementById('modal-title').parentElement.style.display = 'none';
            const defaultFooter = document.getElementById('modal-confirm-btn')?.parentElement;
            if (defaultFooter) defaultFooter.style.display = 'none';

            // 2. Configurar contenedor
            if (modalContentDiv) {
                modalContentDiv.className = '';
                modalContentDiv.classList.add('bg-white', 'rounded-xl', 'shadow-2xl', 'transform', 'transition-all', 'w-full', 'max-w-3xl', 'flex', 'flex-col', 'max-h-[90vh]');
                modalBody.classList.remove('p-0', 'overflow-hidden');
                modalBody.style.padding = '0';
            }

            modalForm.dataset.id = data.id;

            title = 'Asignar Herramienta';

            // Datos de usuarios (Choices)
            const userChoices = Array.from(usersMap.entries())
                .filter(([id, user]) => user.status === 'active')
                .sort((a, b) => a[1].firstName.localeCompare(b[1].firstName))
                .map(([id, user]) => ({
                    value: id,
                    label: `${user.firstName} ${user.lastName}`
                }));

            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-emerald-600 to-teal-700 px-8 py-5 shrink-0 rounded-t-xl flex justify-between items-center relative overflow-hidden">
                        <div class="flex items-center gap-4 relative z-10">
                            <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl backdrop-blur-sm border border-white/10 shadow-inner text-white">
                                <i class="fa-solid fa-hand-holding-hand"></i>
                            </div>
                            <div>
                                <h2 class="text-xl font-bold tracking-tight text-white">Asignar Herramienta</h2>
                                <p class="text-emerald-100 text-xs font-medium">Entregar activo a colaborador</p>
                            </div>
                        </div>
                        <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white transition-colors relative z-10">
                            <i class="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <div class="flex-grow overflow-y-auto custom-scrollbar p-6 bg-gray-50">
                        
                        <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-6 flex items-center gap-4">
                            <div class="w-16 h-16 rounded-lg bg-gray-100 border border-gray-100 shrink-0 p-1">
                                <img src="${data.photoURL || 'https://via.placeholder.com/150'}" class="w-full h-full object-contain rounded-md">
                            </div>
                            <div>
                                <p class="text-xs font-bold text-gray-400 uppercase tracking-wide">Activo a entregar</p>
                                <h3 class="text-lg font-bold text-gray-800 leading-tight">${data.name || 'Herramienta'}</h3>
                                <p class="text-xs text-gray-500 font-mono mt-0.5">${data.reference || 'Sin referencia'}</p>
                            </div>
                        </div>
                        <input type="hidden" name="toolName" value="${data.name || ''}">

                        <div class="space-y-6">
                            <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <label class="block text-xs font-bold text-gray-700 mb-1 uppercase">1. Seleccionar Colaborador <span class="text-red-500">*</span></label>
                                <select id="tool-assignedTo" name="assignedTo" required class="w-full"></select>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                    <label class="block text-xs font-bold text-gray-700 mb-3 uppercase">2. Evidencia de Entrega <span class="text-red-500">*</span></label>
                                    
                                    <div id="assign-tool-dropzone" class="h-40 w-full rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-emerald-500 hover:bg-emerald-50 transition-all bg-gray-50 relative overflow-hidden group">
                                        <div id="assign-tool-preview" class="hidden absolute inset-0">
                                            <img src="" id="assign-tool-img-preview" class="w-full h-full object-contain">
                                        </div>
                                        <div id="assign-tool-prompt" class="text-center p-4">
                                            <div class="w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-2 text-emerald-500 group-hover:scale-110 transition-transform">
                                                <i class="fa-solid fa-camera"></i>
                                            </div>
                                            <p class="text-xs font-bold text-gray-500 group-hover:text-emerald-700">Subir Foto / Acta</p>
                                        </div>
                                    </div>
                                    <input type="file" id="tool-assign-photo" name="assignPhoto" required accept="image/*" class="hidden">
                                </div>

                                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                    <label class="block text-xs font-bold text-gray-700 mb-2 uppercase">3. Observaciones</label>
                                    <textarea name="assignComments" rows="4" class="w-full border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none resize-none bg-gray-50 focus:bg-white transition-colors" placeholder="Estado actual, accesorios incluidos, etc..."></textarea>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white border-t border-gray-200 p-4 shrink-0 flex justify-end gap-3 rounded-b-xl">
                        <button type="button" onclick="closeMainModal()" class="px-5 py-2.5 rounded-lg text-gray-600 font-bold hover:bg-gray-100 transition-colors text-sm">
                            Cancelar
                        </button>
                        <button type="button" onclick="document.getElementById('modal-form').requestSubmit()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-lg font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm flex items-center gap-2">
                            <i class="fa-solid fa-check"></i> Confirmar Asignación
                        </button>
                    </div>
                </div>
            `;

            // Lógica JS (Preview y Choices)
            setTimeout(() => {
                const dropzone = document.getElementById('assign-tool-dropzone');
                const fileInput = document.getElementById('tool-assign-photo');
                const previewContainer = document.getElementById('assign-tool-preview');
                const previewImg = document.getElementById('assign-tool-img-preview');
                const promptEl = document.getElementById('assign-tool-prompt');

                if (dropzone) {
                    dropzone.addEventListener('click', () => fileInput.click());
                    fileInput.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                                previewImg.src = event.target.result;
                                previewContainer.classList.remove('hidden');
                                promptEl.classList.add('hidden');
                                dropzone.classList.remove('border-dashed');
                                dropzone.classList.add('border-emerald-500');
                            }
                            reader.readAsDataURL(file);
                        }
                    });
                }

                const assigneeSelect = document.getElementById('tool-assignedTo');
                if (assigneeSelect) {
                    new Choices(assigneeSelect, {
                        choices: userChoices,
                        itemSelectText: 'Seleccionar',
                        searchPlaceholderValue: 'Buscar...',
                        placeholder: true,
                        placeholderValue: 'Buscar colaborador...',
                        allowHTML: false,
                    });
                }
            }, 100);
            break;
        }

        case 'return-tool': {

            modalForm.dataset.id = data.id;

            title = 'Recibir Herramienta (Devolución)';
            btnText = 'Confirmar Devolución';
            btnClass = 'bg-blue-500 hover:bg-blue-600';

            const assignedToUser = usersMap.get(data.assignedToId);
            const assignedToName = assignedToUser ? `${assignedToUser.firstName} ${assignedToUser.lastName}` : 'N/D';

            // --- INICIO DE MODIFICACIÓN: DISEÑO 2 COLUMNAS ---
            bodyHtml = `
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        
                        <div class="md:col-span-1">
                            <label class="block text-sm font-medium text-gray-700 mb-1">Foto de Devolución (Req.)</label>
                            
                            <div id="return-tool-dropzone" class="aspect-square w-full rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-500 bg-gray-50 relative overflow-hidden">
                                
                                <div id="return-tool-preview" class="hidden absolute inset-0">
                                    <img src="" id="return-tool-img-preview" class="w-full h-full object-contain">
                                </div>
                                
                                <div id="return-tool-prompt" class="text-center p-4">
                                    <svg class="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                                    <p class="mt-2 text-sm text-gray-500">Subir foto de devolución</p>
                                </div>
                            </div>
                            <input type="file" id="tool-return-photo" name="returnPhoto" required accept="image/*" class="hidden">
                        </div>
                        
                        <div class="md:col-span-2 space-y-4">
                            <input type="hidden" name="toolName" value="${data.name || ''}">
                            <input type="hidden" name="originalAssigneeId" value="${data.assignedToId || ''}">
                            
                            <div>
                                <p class="text-sm font-medium text-gray-700">Recibiendo:</p>
                                <p class="text-lg font-semibold text-gray-900">${data.name || 'N/A'}</p>
                            </div>
                            <div>
                                <p class="text-sm font-medium text-gray-700">Devuelta por:</p>
                                <p class="text-lg font-semibold text-gray-900">${assignedToName}</p>
                            </div>

                            <div>
                                <label for="tool-return-status" class="block text-sm font-medium text-gray-700">Estado de Devolución</label>
                                <select id="tool-return-status" name="returnStatus" required class="mt-1 w-full border rounded-md p-2 bg-white">
                                    <option value="bueno" selected>Bueno (Operativo)</option>
                                    <option value="con_defecto">Con Defecto (Funciona pero requiere revisión)</option>
                                    <option value="dañado">Dañado (No operativo, para reparación)</option>
                                </select>
                            </div>
                            <div>
                                <label for="tool-return-comments" class="block text-sm font-medium text-gray-700">Comentarios (Opcional)</label>
                                <textarea id="tool-return-comments" name="returnComments" rows="3" class="mt-1 w-full border rounded-md p-2" placeholder="Describa cualquier defecto o detalle..."></textarea>
                            </div>
                        </div>
                    </div>
                `;

            // --- AÑADIMOS LA LÓGICA JS PARA LA VISTA PREVIA ---
            setTimeout(() => {
                const dropzone = document.getElementById('return-tool-dropzone');
                const fileInput = document.getElementById('tool-return-photo');
                const previewContainer = document.getElementById('return-tool-preview');
                const previewImg = document.getElementById('return-tool-img-preview');
                const promptEl = document.getElementById('return-tool-prompt');

                if (!dropzone) return;

                dropzone.addEventListener('click', () => {
                    fileInput.click();
                });

                fileInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            previewImg.src = event.target.result;
                            previewContainer.classList.remove('hidden');
                            promptEl.classList.add('hidden');
                        }
                        reader.readAsDataURL(file);
                    }
                });
            }, 100); // Espera a que el modal se renderice


            break;
        }

        // --- INICIO DE CÓDIGO AÑADIDO ---
        case 'register-maintenance': {

            modalForm.dataset.id = data.id;

            title = 'Registrar Mantenimiento';
            btnText = 'Finalizar Mantenimiento';
            btnClass = 'bg-green-500 hover:bg-green-600';

            // Aquí puedes añadir un dropdown de proveedores si lo deseas
            // Por ahora, usaremos un input de texto simple.

            bodyHtml = `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    
                    <div class="md:col-span-1">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Herramienta</label>
                        <div class="aspect-square w-full rounded-lg bg-gray-100 overflow-hidden border">
                            <img src="${data.photoURL || 'https://via.placeholder.com/300'}" 
                                 alt="${data.name || ''}" 
                                 class="w-full h-full object-contain">
                        </div>
                        <p class="text-center font-bold text-lg mt-2">${data.name || 'N/A'}</p>
                    </div>
                    
                    <div class="md:col-span-2 space-y-4">
                        <input type="hidden" name="toolName" value="${data.name || ''}">
                        
                        <div>
                            <label for="maintenance-provider" class="block text-sm font-medium">Proveedor / Taller (Opcional)</label>
                            <input type="text" id="maintenance-provider" name="maintenanceProvider" class="mt-1 w-full border rounded-md p-2" placeholder="Ej: Taller Pepito">
                        </div>

                        <div>
                            <label for="maintenance-cost" class="block text-sm font-medium">Costo de Reparación (Opcional)</label>
                            <input type="text" id="maintenance-cost" name="maintenanceCost" class="currency-input mt-1 w-full border rounded-md p-2" placeholder="$ 0">
                        </div>

                        <div>
                            <label for="maintenance-notes" class="block text-sm font-medium">Notas (Opcional)</label>
                            <textarea id="maintenance-notes" name="maintenanceNotes" rows="3" class="mt-1 w-full border rounded-md p-2" placeholder="Describa qué se reparó..."></textarea>
                        </div>

                        <p class="text-xs text-gray-500 pt-2">Al finalizar, la herramienta volverá a estar "Disponible".</S>
                    </div>

                </div>
            `;

            // Activamos el formateador de moneda para el campo de costo
            setTimeout(() => {
                const costInput = document.getElementById('maintenance-cost');
                setupCurrencyInput(costInput); // (Esta función ya existe en tu app.js)
            }, 100);

            break;
        }
        // --- FIN DE CÓDIGO AÑADIDO ---

        case 'addItem':
        case 'editItem': {
            modalForm.dataset.id = data.id;

            const isEditing = type === 'editItem';
            title = isEditing ? 'Editar Ítem' : 'Añadir Nuevo Ítem';
            btnText = isEditing ? 'Guardar Cambios' : 'Añadir Ítem';
            btnClass = isEditing ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-green-500 hover:bg-green-600';

            // --- INICIO DE PLANTILLA MODERNA (Secciones) ---

            // Plantilla para la sección de costo SEPARADO
            const costSectionSeparated = (section, title, data = {}) => `
                <div class="border rounded-lg p-3 mt-2 bg-white">
                    <p class="font-semibold">${title}</p>
                    <div class="grid grid-cols-2 gap-4 mt-2">
                        <div>
                            <label class="block text-xs font-medium">Precio Unitario</label>
                            <input type="text" name="${section}_unitPrice" class="currency-input mt-1 w-full border rounded-md p-2" value="${data.unitPrice || ''}">
                        </div>
                        <div>
                            <label class="block text-xs font-medium">Impuesto</label>
                            <div class="mt-2 flex space-x-2">
                                <label class="flex items-center text-xs"><input type="radio" name="${section}_taxType" value="iva" class="mr-1 tax-type-radio" ${data.taxType === 'iva' ? 'checked' : ''}> IVA</label>
                                <label class="flex items-center text-xs"><input type="radio" name="${section}_taxType" value="aiu" class="mr-1 tax-type-radio" ${data.taxType === 'aiu' ? 'checked' : ''}> AIU</label>
                                <label class="flex items-center text-xs"><input type="radio" name="${section}_taxType" value="none" class="mr-1 tax-type-radio" ${data.taxType === 'none' || !data.taxType || data.taxType === 'exento' ? 'checked' : ''}> Ninguno</label>
                            </div>
                        </div>
                    </div>
                    <div class="aiu-fields hidden space-y-2 mt-3">
                        <div class="grid grid-cols-3 gap-2">
                            <div><label class="block text-xs">A(%)</label><input type="number" name="${section}_aiuA" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuA || ''}"></div>
                            <div><label class="block text-xs">I(%)</label><input type="number" name="${section}_aiuI" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuI || ''}"></div>
                            <div><label class="block text-xs">U(%)</label><input type="number" name="${section}_aiuU" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuU || ''}"></div>
                        </div>
                    </div>
                </div>`;

            // Plantilla para la sección de costo INCLUIDO
            const costSectionIncluded = (data = {}) => `
                <div class="border rounded-lg p-3 mt-2 bg-white">
                    <p class="font-semibold">Precio Total Incluido</p>
                    <div class="grid grid-cols-2 gap-4 mt-2">
                        <div>
                            <label class="block text-xs font-medium">Precio Unitario Total</label>
                            <input type="text" name="included_unitPrice" class="currency-input mt-1 w-full border rounded-md p-2" value="${data.unitPrice || ''}">
                        </div>
                        <div>
                            <label class="block text-xs font-medium">Impuesto</label>
                            <div class="mt-2 flex space-x-2">
                                <label class="flex items-center text-xs"><input type="radio" name="included_taxType" value="iva" class="mr-1 tax-type-radio" ${data.taxType === 'iva' ? 'checked' : ''}> IVA</label>
                                <label class="flex items-center text-xs"><input type="radio" name="included_taxType" value="aiu" class="mr-1 tax-type-radio" ${data.taxType === 'aiu' ? 'checked' : ''}> AIU</label>
                                <label class="flex items-center text-xs"><input type="radio" name="included_taxType" value="none" class="mr-1 tax-type-radio" ${data.taxType === 'none' || !data.taxType || data.taxType === 'exento' ? 'checked' : ''}> Ninguno</label>
                            </div>
                        </div>
                    </div>
                    <div class="aiu-fields hidden space-y-2 mt-3">
                        <div class="grid grid-cols-3 gap-2">
                            <div><label class="block text-xs">A(%)</label><input type="number" name="included_aiuA" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuA || ''}"></div>
                            <div><label class="block text-xs">I(%)</label><input type="number" name="included_aiuI" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuI || ''}"></div>
                            <div><label class="block text-xs">U(%)</label><input type="number" name="included_aiuU" min="0" class="mt-1 w-full border rounded-md p-2" value="${data.aiuU || ''}"></div>
                        </div>
                    </div>
                </div>`;

            // --- LÓGICA PRINCIPAL: Decide qué formulario de precios mostrar ---
            let pricingModelHtml = '';
            const projectPricingModel = currentProject.pricingModel || 'separado';

            if (projectPricingModel === 'incluido') {
                pricingModelHtml = costSectionIncluded(isEditing ? data.includedDetails : {});
            } else {
                pricingModelHtml = `
            ${costSectionSeparated('supply', 'Detalles de Suministro', isEditing ? data.supplyDetails : {})}
            ${costSectionSeparated('installation', 'Detalles de Instalación', isEditing ? data.installationDetails : {})}
        `;
            }

            // --- Estructura HTML moderna con secciones ---
            bodyHtml = `
                <div class="space-y-5">
                    <div class="bg-gray-50 p-4 rounded-lg border">
                        <h4 class="text-md font-semibold text-gray-700 mb-3 border-b pb-2">1. Información del Ítem</h4>
                        <div class="space-y-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Nombre</label>
                                <input type="text" name="name" required class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.name : ''}">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Descripción</label>
                                <textarea name="description" rows="2" class="mt-1 w-full border rounded-md p-2" placeholder="Ej: Ventana corrediza sistema 744...">${isEditing ? (data.description || '') : ''}</textarea>
                            </div>
                            
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Plano o Diseño (PDF / Imagen)</label>
                                ${isEditing && data.blueprintURL ? `
                                    <div class="flex items-center gap-2 mb-2 mt-1">
                                        <a href="#" onclick="viewDocument('${data.blueprintURL}', '${data.name}'); return false;" class="text-xs text-blue-600 font-bold hover:underline flex items-center">
                                            <i class="fa-solid fa-eye mr-1"></i> Ver Plano Actual
                                        </a>
                                    </div>
                                ` : ''}
                                <input type="file" name="blueprintFile" accept="image/*,.pdf" class="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer border rounded-lg mt-1"/>
                            </div>

                        </div>
                    </div>

                    <div class="bg-gray-50 p-4 rounded-lg border">
                        <h4 class="text-md font-semibold text-gray-700 mb-3 border-b pb-2">2. Medidas y Cantidad</h4>
                        <div class="grid grid-cols-3 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Cantidad</label>
                                <input type="number" name="quantity" required min="1" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? data.quantity : ''}" ${isEditing ? 'readonly' : ''}>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Ancho (cm)</label>
                                <input type="number" name="width" required min="0" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? (data.width * 100) : ''}">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Alto (cm)</label>
                                <input type="number" name="height" required min="0" class="mt-1 w-full border rounded-md p-2" value="${isEditing ? (data.height * 100) : ''}">
                            </div>
                        </div>
                    </div>

                    <div class="p-4 rounded-lg border">
                        <h4 class="text-md font-semibold text-gray-700 mb-2">3. Valoración (Costos)</h4>
                        ${pricingModelHtml}
                    </div>
                </div>`;

            // --- FIN DE PLANTILLA MODERNA ---

            setTimeout(() => {
                const modalContent = document.getElementById('modal-body');
                const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });

                modalContent.querySelectorAll('.currency-input').forEach(input => {
                    const formatCurrency = (e) => {
                        let value = e.target.value.replace(/[$. ]/g, '');
                        if (!isNaN(value) && value) e.target.value = currencyFormatter.format(value).replace(/\s/g, ' ');
                        else e.target.value = '';
                    };
                    input.addEventListener('input', formatCurrency);
                    if (input.value) formatCurrency({ target: input });
                });

                modalContent.querySelectorAll('.tax-type-radio').forEach(radio => {
                    const aiuFields = radio.closest('.border').querySelector('.aiu-fields');
                    if (aiuFields) {
                        const toggleAiu = () => aiuFields.classList.toggle('hidden', radio.value !== 'aiu');
                        radio.addEventListener('change', toggleAiu);
                        if (radio.checked) toggleAiu();
                    }
                });
            }, 100);
            break;
        }
        case 'new-supplier-payment': {
            title = 'Registrar Pago a Proveedor';
            btnText = 'Confirmar Pago';
            btnClass = 'bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white shadow-lg';

            // Ajustamos el ancho para que se vea elegante
            if (modalContentDiv) {
                modalContentDiv.classList.remove('max-w-2xl');
                modalContentDiv.classList.add('max-w-md');
            }

            // Ocultamos el título por defecto para usar nuestro propio header personalizado
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            bodyHtml = `
                <div class="-mx-6 -mt-6 mb-6 bg-gradient-to-r from-orange-500 to-red-600 px-6 py-5 flex justify-between items-center rounded-t-lg">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white backdrop-blur-sm shadow-sm">
                            <i class="fa-solid fa-money-bill-wave"></i>
                        </div>
                        <div>
                            <h3 class="text-lg font-bold text-white leading-tight">Nuevo Pago</h3>
                            <p class="text-xs text-orange-100 font-medium opacity-90">Abono a cuenta del proveedor</p>
                        </div>
                    </div>
                    </div>

                <div class="space-y-5">
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Monto a Pagar</label>
                        <div class="relative">
                            <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                <span class="text-gray-400 font-bold text-xl">$</span>
                            </div>
                            <input type="text" name="amount" required 
                                class="currency-input w-full pl-9 pr-4 py-3 border-2 border-gray-200 rounded-xl text-2xl font-bold text-gray-800 focus:border-orange-500 focus:ring-0 outline-none transition-colors placeholder-gray-300" 
                                placeholder="0">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Fecha</label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400"><i class="fa-regular fa-calendar"></i></div>
                                <input type="date" name="date" required class="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 focus:border-orange-500 focus:ring-2 focus:ring-orange-100 outline-none transition-all" value="${new Date().toISOString().split('T')[0]}">
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Método</label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400"><i class="fa-solid fa-wallet"></i></div>
                                <select name="paymentMethod" class="w-full pl-9 pr-8 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white focus:border-orange-500 focus:ring-2 focus:ring-orange-100 outline-none transition-all appearance-none">
                                    <option value="Transferencia">Transferencia</option>
                                    <option value="Efectivo">Efectivo</option>
                                    <option value="Tarjeta">Tarjeta</option>
                                </select>
                                <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-400"><i class="fa-solid fa-chevron-down text-xs"></i></div>
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Referencia / Nota (Opcional)</label>
                        <div class="relative">
                             <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400"><i class="fa-solid fa-pen"></i></div>
                            <input type="text" name="note" class="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 focus:border-orange-500 focus:ring-2 focus:ring-orange-100 outline-none transition-all" placeholder="Ej: Comprobante #1234">
                        </div>
                    </div>
                    
                    <div class="bg-blue-50 p-3 rounded-lg flex items-start gap-3 text-xs text-blue-700 border border-blue-100">
                        <i class="fa-solid fa-circle-info mt-0.5"></i>
                        <p>El pago se distribuirá automáticamente a las órdenes de compra más antiguas pendientes (FIFO) y se guardará en el historial.</p>
                    </div>
                </div>
            `;

            // Inicializar formato de moneda
            setTimeout(() => {
                setupCurrencyInput(modalForm.querySelector('input[name="amount"]'));
            }, 100);
            break;
        }

        case 'editUser':
            // 1. Configuración Visual
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            // Ocultar footer por defecto (usaremos uno personalizado)
            const defaultFooter = document.getElementById('modal-confirm-btn')?.parentElement;
            if (defaultFooter) defaultFooter.style.display = 'none';

            // Configurar contenedor sin paddings para diseño completo
            modalBody.classList.add('p-0', 'overflow-hidden');
            modalBody.style.padding = '0';
            modalBody.parentElement.classList.add('overflow-hidden');
            modalForm.dataset.id = data.id; // <--- ESTA LÍNEA ES CRUCIAL

            title = 'Editar Usuario';
            // Aseguramos clases limpias para evitar conflictos visuales
            modalContentDiv.className = 'relative bg-white rounded-lg shadow-xl transform transition-all w-full max-w-5xl h-[90vh] flex flex-col';

            bodyHtml = `
                <div class="flex flex-col h-full">
                    
                    <div class="bg-gradient-to-r from-amber-500 to-orange-600 px-8 py-5 flex justify-between items-center shrink-0 relative overflow-hidden shadow-md z-10">
                        <div class="absolute top-0 right-0 p-4 opacity-10 pointer-events-none transform scale-150 translate-x-4 -translate-y-2">
                            <i class="fa-solid fa-user-pen text-6xl text-white"></i>
                        </div>
                        
                        <div class="flex items-center gap-4 relative z-10">
                            <div class="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center border-2 border-white/30 shadow-inner overflow-hidden backdrop-blur-sm">
                                ${data.profilePhotoURL
                    ? `<img src="${data.profilePhotoURL}" class="w-full h-full object-cover">`
                    : `<span class="text-xl font-bold text-white">${(data.firstName?.[0] || '').toUpperCase()}${(data.lastName?.[0] || '').toUpperCase()}</span>`
                }
                            </div>
                            <div>
                                <h2 class="text-xl font-bold tracking-tight text-white leading-tight">Editar Perfil</h2>
                                <p class="text-amber-100 text-xs font-medium">${data.firstName} ${data.lastName}</p>
                            </div>
                        </div>
                        <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors relative z-10">
                            <i class="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <div class="flex-grow overflow-y-auto custom-scrollbar bg-gray-50 p-6">
                        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            
                            <div class="lg:col-span-1 space-y-6">
                                <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm text-center">
                                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-4">Foto de Perfil</h4>
                                    
                                    <div id="editUser-dropzone" class="aspect-square w-full max-w-[180px] mx-auto rounded-full border-4 border-gray-100 shadow-inner flex items-center justify-center bg-gray-50 relative overflow-hidden group cursor-pointer hover:border-amber-200 transition-all">
                                        <div id="editUser-preview" class="absolute inset-0 ${data.profilePhotoURL ? '' : 'hidden'}">
                                            <img src="${data.profilePhotoURL || ''}" id="editUser-img-preview" class="w-full h-full object-cover">
                                        </div>
                                        <div id="editUser-prompt" class="absolute inset-0 flex flex-col items-center justify-center bg-black/0 group-hover:bg-black/10 transition-all">
                                            <i class="fa-solid fa-camera text-3xl text-gray-300 group-hover:text-white drop-shadow-md transition-all ${data.profilePhotoURL ? 'opacity-0 group-hover:opacity-100' : ''}"></i>
                                        </div>
                                    </div>

                                    <input type="file" id="editUser-photo-input" name="photo" accept="image/*,.heic,.heif" class="hidden">
                                    <p id="editUser-photo-status" class="text-xs text-center text-amber-600 h-4 mt-3 font-medium"></p>

                                    <div class="grid grid-cols-2 gap-2 mt-4">
                                        <button type="button" id="editUser-camera-btn" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-colors">
                                            <i class="fa-solid fa-camera"></i> Cámara
                                        </button>
                                        <button type="button" id="editUser-upload-btn" class="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-colors">
                                            <i class="fa-solid fa-upload"></i> Subir
                                        </button>
                                    </div>
                                </div>
                                
                                <div class="bg-white p-2 rounded-xl border border-gray-200 shadow-sm">
                                    <button type="button" data-action="view-profile-history" data-userid="${data.id}" class="w-full bg-white hover:bg-slate-50 text-slate-600 hover:text-indigo-600 text-sm font-bold py-3 px-4 rounded-lg border border-transparent hover:border-indigo-100 transition-all flex items-center justify-between group">
                                        <span class="flex items-center gap-3">
                                            <div class="w-8 h-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                                                <i class="fa-solid fa-clock-rotate-left"></i>
                                            </div>
                                            Ver Historial
                                        </span>
                                        <i class="fa-solid fa-chevron-right text-xs text-gray-300 group-hover:text-indigo-400"></i>
                                    </button>
                                </div>
                            </div>

                            <div class="lg:col-span-2 space-y-6">
                                
                                <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
                                    <div class="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                                    <h4 class="text-sm font-bold text-gray-800 mb-5 flex items-center"><i class="fa-regular fa-id-card mr-2 text-blue-500"></i> Información Personal y Contrato</h4>
                                    
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <div>
                                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre</label>
                                            <input type="text" name="firstName" value="${data.firstName}" required class="w-full border-gray-200 bg-gray-50 focus:bg-white rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium text-gray-700">
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Apellido</label>
                                            <input type="text" name="lastName" value="${data.lastName}" required class="w-full border-gray-200 bg-gray-50 focus:bg-white rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium text-gray-700">
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Cédula / ID</label>
                                            <input type="text" name="idNumber" value="${data.idNumber}" required class="w-full border-gray-200 bg-gray-50 focus:bg-white rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Correo (Solo lectura)</label>
                                            <input type="email" name="email" value="${data.email}" required class="w-full border-gray-200 bg-gray-100 rounded-lg p-2.5 text-sm text-gray-500 cursor-not-allowed" readonly>
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Celular</label>
                                            <input type="tel" name="phone" value="${data.phone}" required class="w-full border-gray-200 bg-gray-50 focus:bg-white rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Dirección</label>
                                            <input type="text" name="address" value="${data.address}" required class="w-full border-gray-200 bg-gray-50 focus:bg-white rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
                                        </div>

                                        <div class="md:col-span-2 grid grid-cols-2 gap-5 pt-4 mt-2 border-t border-gray-100">
                                            <div>
                                                <label class="block text-xs font-bold text-blue-600 uppercase mb-1">Fecha Inicio Contrato</label>
                                                <input type="date" name="contractStartDate" value="${safeDate(data.contractStartDate)}" class="w-full border-blue-200 bg-blue-50 focus:bg-white rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
                                            </div>
                                            <div>
                                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Fin Contrato</label>
                                                <input type="date" name="contractEndDate" value="${safeDate(data.contractEndDate)}" class="w-full border-gray-200 bg-gray-50 focus:bg-white rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-gray-500 outline-none transition-all">
                                                <p class="text-[9px] text-gray-400 mt-1">Dejar vacío si es indefinido.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative">
                                        <div class="absolute top-0 left-0 w-1 h-full bg-emerald-500 rounded-l-xl"></div>
                                        <h4 class="text-xs font-bold text-gray-400 uppercase mb-4"><i class="fa-solid fa-building-columns mr-2 text-emerald-500"></i> Datos Bancarios</h4>
                                        <div class="space-y-3">
                                            <div>
                                                <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Banco</label>
                                                <input type="text" name="bankName" value="${data.bankName || ''}" class="w-full border-gray-200 rounded-lg p-2 text-sm focus:border-emerald-500 outline-none" placeholder="Ej: Bancolombia">
                                            </div>
                                            <div>
                                                <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Tipo de Cuenta</label>
                                                <select name="accountType" class="w-full border-gray-200 rounded-lg p-2 text-sm bg-white focus:border-emerald-500 outline-none">
                                                    <option value="Ahorros" ${data.accountType === 'Ahorros' ? 'selected' : ''}>Ahorros</option>
                                                    <option value="Corriente" ${data.accountType === 'Corriente' ? 'selected' : ''}>Corriente</option>
                                                    <option value="Nequi/Daviplata" ${data.accountType === 'Nequi/Daviplata' ? 'selected' : ''}>Nequi / Daviplata</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Número</label>
                                                <input type="text" name="accountNumber" value="${data.accountNumber || ''}" class="w-full border-gray-200 rounded-lg p-2 text-sm font-mono focus:border-emerald-500 outline-none" placeholder="000-00000-00">
                                            </div>
                                        </div>
                                    </div>

                                    <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative">
                                        <div class="absolute top-0 left-0 w-1 h-full bg-purple-500 rounded-l-xl"></div>
                                        <h4 class="text-xs font-bold text-gray-400 uppercase mb-4"><i class="fa-solid fa-shirt mr-2 text-purple-500"></i> Tallas Dotación</h4>
                                        <div class="grid grid-cols-3 gap-3">
                                            <div>
                                                <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Camisa</label>
                                                <input type="text" name="tallaCamiseta" class="w-full border-gray-200 rounded-lg p-2 text-sm text-center font-bold uppercase focus:border-purple-500 outline-none" value="${data.tallaCamiseta || ''}" placeholder="L">
                                            </div>
                                            <div>
                                                <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Pantalón</label>
                                                <input type="text" name="tallaPantalón" class="w-full border-gray-200 rounded-lg p-2 text-sm text-center font-bold uppercase focus:border-purple-500 outline-none" value="${data.tallaPantalón || data.tallaPantalon || ''}" placeholder="32">
                                            </div>
                                            <div>
                                                <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Calzado</label>
                                                <input type="text" name="tallaBotas" class="w-full border-gray-200 rounded-lg p-2 text-sm text-center font-bold uppercase focus:border-purple-500 outline-none" value="${data.tallaBotas || ''}" placeholder="40">
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="bg-slate-50 p-6 rounded-xl border border-slate-200">
                                    <h4 class="text-sm font-bold text-slate-700 mb-4 flex items-center">
                                        <i class="fa-solid fa-user-gear mr-2 text-slate-500"></i> Configuración de Rol y Acceso
                                    </h4>
                                    
                                    <div class="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
                                        <div>
                                            <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Rol de Usuario</label>
                                            <select id="user-role-select" name="role" class="w-full bg-white border border-slate-300 text-slate-700 py-2.5 px-3 rounded-lg focus:outline-none focus:border-slate-500 text-sm font-bold cursor-pointer">
                                                <option value="operario" ${data.role === 'operario' ? 'selected' : ''}>Operario</option>
                                                <option value="admin" ${data.role === 'admin' ? 'selected' : ''}>Administrador</option>
                                                <option value="bodega" ${data.role === 'bodega' ? 'selected' : ''}>Bodega</option>
                                                <option value="sst" ${data.role === 'sst' ? 'selected' : ''}>SST</option>
                                                <option value="nomina" ${data.role === 'nomina' ? 'selected' : ''}>Nómina</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Nivel Comisión</label>
                                            <select name="commissionLevel" class="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm focus:border-slate-500 outline-none">
                                                <option value="principiante" ${data.commissionLevel === 'principiante' ? 'selected' : ''}>Principiante</option>
                                                <option value="intermedio" ${data.commissionLevel === 'intermedio' ? 'selected' : ''}>Intermedio</option>
                                                <option value="avanzado" ${data.commissionLevel === 'avanzado' ? 'selected' : ''}>Avanzado</option>
                                                <option value="" ${!data.commissionLevel ? 'selected' : ''}>No aplica</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Salario Básico</label>
                                            <div class="relative">
                                                <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold">$</span>
                                                <input type="text" id="user-salarioBasico" name="salarioBasico" class="currency-input w-full pl-7 border border-slate-300 rounded-lg p-2.5 text-sm font-mono font-bold text-slate-700 focus:border-slate-500 outline-none" value="${data.salarioBasico || 0}">
                                            </div>
                                        </div>
                                    </div>

                                    <div class="flex items-center mb-4">
                                        <label class="inline-flex items-center cursor-pointer">
                                            <input type="checkbox" name="deduccionSobreMinimo" class="sr-only peer" ${data.deduccionSobreMinimo ? 'checked' : ''}>
                                            <div class="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                            <span class="ms-3 text-xs font-medium text-slate-600">Aplicar deducciones sobre el Salario Mínimo</span>
                                        </label>
                                    </div>

                                    <div class="border-t border-slate-200 pt-4">
                                        <p class="text-xs font-bold text-slate-400 uppercase mb-3">Permisos de Módulos</p>
                                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                            ${(() => {
                    const roleDefaults = getRoleDefaultPermissions(data.role || 'operario');
                    return SIDEBAR_CONFIG.map(mod => {
                        const currentPerm = (data.customPermissions && data.customPermissions[mod.key]);
                        const isChecked = (currentPerm === 'show') || (roleDefaults[mod.key] && currentPerm !== 'hide');
                        let styleClass = isChecked ? "bg-white border-indigo-200 text-indigo-700 shadow-sm" : "bg-slate-100 border-transparent text-slate-400";

                        return `
                                                    <label class="cursor-pointer select-none">
                                                        <input type="checkbox" name="perm_${mod.key}" class="permission-checkbox hidden" ${isChecked ? 'checked' : ''} data-key="${mod.key}">
                                                        <div class="permission-card px-3 py-2 rounded-lg border text-xs font-bold text-center transition-all ${styleClass} hover:border-indigo-300">
                                                            ${mod.label}
                                                        </div>
                                                    </label>`;
                    }).join('');
                })()}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white border-t border-gray-200 p-4 shrink-0 flex justify-end gap-3 z-20">
                        <button type="button" onclick="closeMainModal()" class="px-5 py-2.5 rounded-lg text-gray-600 font-bold hover:bg-gray-100 transition-colors text-sm">
                            Cancelar
                        </button>
                        <button type="button" onclick="document.getElementById('modal-form').requestSubmit()" class="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white px-8 py-2.5 rounded-lg font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm flex items-center gap-2">
                            <i class="fa-solid fa-check"></i> Guardar Cambios
                        </button>
                    </div>
                </div>
            `;

            // Lógica JS de inicialización (CON VALIDACIÓN)
            setTimeout(() => {
                const salarioInput = document.getElementById('user-salarioBasico');
                if (salarioInput) setupCurrencyInput(salarioInput);

                processedPhotoFile = null;
                const dropzone = document.getElementById('editUser-dropzone');
                const fileInput = document.getElementById('editUser-photo-input');
                const uploadBtn = document.getElementById('editUser-upload-btn');
                const cameraBtn = document.getElementById('editUser-camera-btn');
                const previewImg = document.getElementById('editUser-img-preview');
                const promptEl = document.getElementById('editUser-prompt');
                const previewDiv = document.getElementById('editUser-preview');
                const statusText = document.getElementById('editUser-photo-status');

                const handleFileSelection = async (file) => {
                    if (!file) return;
                    if (statusText) {
                        statusText.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Analizando rostro...';
                        statusText.className = "text-xs text-center text-blue-600 h-4 mt-3 font-bold animate-pulse";
                    }
                    promptEl.classList.add('hidden');

                    try {
                        const imgUrl = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = (e) => resolve(e.target.result);
                            reader.readAsDataURL(file);
                        });
                        const img = await faceapi.fetchImage(imgUrl);
                        const detections = await faceapi.detectSingleFace(img);

                        if (!detections) {
                            alert("⚠️ Error de Validación:\n\nNo se detectó un rostro humano claro.");
                            fileInput.value = '';
                            processedPhotoFile = null;
                            previewImg.src = '';
                            previewDiv.classList.add('hidden');
                            promptEl.classList.remove('hidden', 'opacity-0');
                            if (statusText) {
                                statusText.textContent = "Foto rechazada (Sin rostro)";
                                statusText.className = "text-xs text-center text-red-500 h-4 mt-3 font-bold";
                            }
                            return;
                        }
                        handlePhotoFile(file, 'editUser-photo-input', 'editUser-img-preview');
                        if (!file.name.toLowerCase().endsWith('.heic')) {
                            previewImg.src = imgUrl;
                            previewDiv.classList.remove('hidden');
                            promptEl.classList.remove('hidden');
                            promptEl.classList.add('opacity-0', 'group-hover:opacity-100');
                        }
                        if (statusText) {
                            statusText.innerHTML = '<i class="fa-solid fa-check-circle"></i> Rostro verificado';
                            statusText.className = "text-xs text-center text-emerald-600 h-4 mt-3 font-bold";
                        }
                    } catch (error) {
                        console.error("Error validando rostro:", error);
                        alert("Ocurrió un error al procesar la imagen.");
                        if (statusText) statusText.textContent = "";
                    }
                };

                if (dropzone) dropzone.addEventListener('click', () => fileInput.click());
                if (uploadBtn) uploadBtn.addEventListener('click', () => fileInput.click());
                if (fileInput) fileInput.addEventListener('change', (e) => handleFileSelection(e.target.files[0]));
                if (cameraBtn) {
                    cameraBtn.addEventListener('click', () => {
                        openCameraModal('editUser-photo-input', 'editUser-img-preview', async (blob) => {
                            const file = new File([blob], "camera_capture.jpg", { type: "image/jpeg" });
                            await handleFileSelection(file);
                        });
                    });
                }

                const permissionCheckboxes = document.querySelectorAll('.permission-checkbox');
                permissionCheckboxes.forEach(chk => {
                    chk.addEventListener('change', (e) => {
                        const card = e.target.nextElementSibling;
                        if (e.target.checked) {
                            card.className = "permission-card px-3 py-2 rounded-lg border text-xs font-bold text-center transition-all bg-white border-indigo-200 text-indigo-700 shadow-sm hover:border-indigo-300";
                        } else {
                            card.className = "permission-card px-3 py-2 rounded-lg border text-xs font-bold text-center transition-all bg-slate-100 border-transparent text-slate-400 hover:border-indigo-300";
                        }
                    });
                });

                const roleSelect = document.getElementById('user-role-select');
                if (roleSelect) {
                    roleSelect.addEventListener('change', (e) => {
                        const newDefaults = getRoleDefaultPermissions(e.target.value);
                        permissionCheckboxes.forEach(chk => {
                            chk.checked = !!newDefaults[chk.dataset.key];
                            chk.dispatchEvent(new Event('change'));
                        });
                    });
                }
            }, 150);
            break;

        case 'view-profile-history': { // <--- LLAVE DE APERTURA AÑADIDA
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            // Configurar Modal
            modalBody.classList.add('p-0', 'overflow-hidden');
            modalBody.style.padding = '0';
            modalBody.parentElement.classList.add('overflow-hidden');

            title = 'Historial de Cambios';
            btnText = 'Cerrar';
            btnClass = 'bg-gray-600 hover:bg-gray-700 text-white';
            modalContentDiv.classList.add('max-w-2xl', 'h-[80vh]', 'flex', 'flex-col');

            // Loader inicial
            bodyHtml = `
                <div class="flex flex-col h-full">
                    <div class="bg-gradient-to-r from-blue-600 to-cyan-600 px-6 py-5 flex justify-between items-center shrink-0 shadow-md">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm border border-white/20">
                                <i class="fa-solid fa-clock-rotate-left text-white text-lg"></i>
                            </div>
                            <div>
                                <h2 class="text-xl font-bold text-white tracking-tight">Historial de Perfil</h2>
                                <p class="text-blue-100 text-xs font-medium">${data.firstName} ${data.lastName}</p>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button id="back-to-edit-btn" class="text-white/80 hover:text-white hover:bg-white/10 px-3 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2">
                                <i class="fa-solid fa-arrow-left"></i> Volver
                            </button>
                            <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white p-1.5 rounded-full hover:bg-white/10 transition-colors">
                                <i class="fa-solid fa-xmark text-xl"></i>
                            </button>
                        </div>
                    </div>

                    <div id="history-timeline-container" class="flex-grow overflow-y-auto custom-scrollbar bg-slate-50 p-6 relative">
                        <div class="loader mx-auto mt-10"></div>
                    </div>
                </div>
            `;

            // Lógica JS
            setTimeout(() => {
                // Ocultar botón footer
                const footerBtn = document.getElementById('modal-confirm-btn');
                if (footerBtn) footerBtn.style.display = 'none';

                // Botón Volver
                const backBtn = document.getElementById('back-to-edit-btn');
                if (backBtn) {
                    backBtn.addEventListener('click', () => {
                        // data ya contiene la info del usuario gracias a openMainModal
                        openMainModal('editUser', data);
                    });
                }

                // Cargar datos
                // Aquí es donde estaba el conflicto de variable, ahora está protegido por las llaves {}
                loadProfileHistory(data.id);

            }, 50);
            break;
        } // <--- LLAVE DE CIERRE AÑADIDA

        case 'add-purchase':
            title = 'Registrar Compra en Inventario';
            btnText = 'Añadir a Inventario';
            btnClass = 'bg-blue-500 hover:bg-blue-600';
            bodyHtml = `
            <div class="space-y-4">
                <div><label class="block text-sm font-medium">Nombre del Material</label><input type="text" name="name" required class="mt-1 w-full border p-2 rounded-md"></div>
                <div><label class="block text-sm font-medium">Referencia (Opcional)</label><input type="text" name="reference" class="mt-1 w-full border p-2 rounded-md"></div>
                <div class="grid grid-cols-2 gap-4">
                    <div><label class="block text-sm font-medium">Cantidad Comprada</label><input type="number" name="quantity" required class="mt-1 w-full border p-2 rounded-md"></div>
                    <div><label class="block text-sm font-medium">Unidad</label><input type="text" name="unit" required class="mt-1 w-full border p-2 rounded-md" placeholder="Metros, Unidades..."></div>
                </div>
            </div>`;
            break;
        case 'new-supplier':
        case 'edit-supplier': {
            // 1. Ocultar título por defecto
            if (document.getElementById('modal-title')) {
                document.getElementById('modal-title').parentElement.style.display = 'none';
            }

            const isEditing = type === 'edit-supplier';

            // --- CORRECCIÓN AQUÍ: Extraemos el ID de 'data' de forma segura ---
            const supplierId = data ? data.id : '';

            // Configuración visual
            const headerTitle = isEditing ? 'Editar Proveedor' : 'Nuevo Proveedor';
            const headerIcon = isEditing ? 'fa-pen-to-square' : 'fa-handshake';
            const headerGradient = isEditing ? 'from-purple-600 to-indigo-600' : 'from-indigo-500 to-purple-600';
            const subTitle = isEditing ? 'Modificar datos del aliado' : 'Registrar nuevo aliado estratégico';

            title = headerTitle;
            btnText = isEditing ? 'Guardar Cambios' : 'Crear Proveedor';
            btnClass = 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-md transform hover:-translate-y-0.5 transition-all';

            modalContentDiv.classList.add('max-w-4xl');

            bodyHtml = `
                <div class="flex flex-col h-full max-h-[85vh]">
                    
                    <input type="hidden" id="hidden-supplier-id" value="${supplierId}">

                    <div class="-mx-6 -mt-6 mb-6 bg-gradient-to-r ${headerGradient} px-8 py-5 rounded-t-lg text-white shadow-md flex justify-between items-center relative overflow-hidden">
                        <div class="absolute top-0 right-0 p-4 opacity-10 pointer-events-none transform scale-150 translate-x-4 -translate-y-2">
                            <i class="fa-solid ${headerIcon} text-6xl"></i>
                        </div>
                        
                        <div class="flex items-center gap-4 relative z-10">
                            <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl backdrop-blur-sm border border-white/10 shadow-inner">
                                <i class="fa-solid ${headerIcon}"></i>
                            </div>
                            <div>
                                <h2 class="text-2xl font-bold tracking-tight text-white">${headerTitle}</h2>
                                <p class="text-purple-100 text-xs font-medium opacity-90">${subTitle}</p>
                            </div>
                        </div>
                        <button type="button" onclick="closeMainModal()" class="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors relative z-10">
                            <i class="fa-solid fa-xmark text-2xl"></i>
                        </button>
                    </div>

                    <div class="flex-grow overflow-y-auto custom-scrollbar p-1 pr-2 pb-4 space-y-6">
                        <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                             <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-4 flex items-center">
                                <i class="fa-solid fa-id-card mr-2 text-purple-500"></i> Información Fiscal
                            </h4>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div class="md:col-span-2">
                                    <label class="block text-xs font-bold text-gray-700 mb-1.5">Razón Social / Nombre</label>
                                    <input type="text" name="name" required class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none font-bold text-gray-800" placeholder="Ej: Ferretería El Tornillo S.A.S." value="${isEditing ? data.name || '' : ''}">
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-gray-700 mb-1.5">NIT / Cédula</label>
                                    <input type="text" name="nit" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none" placeholder="Ej: 900.123.456-7" value="${isEditing ? data.nit || '' : ''}">
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-gray-700 mb-1.5">Dirección</label>
                                    <div class="relative">
                                         <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400"><i class="fa-solid fa-location-dot"></i></div>
                                        <input type="text" name="address" class="w-full pl-9 border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none" placeholder="Calle 123 # 45-67" value="${isEditing ? data.address || '' : ''}">
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="bg-slate-50 p-5 rounded-xl border border-slate-200">
                             <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4 flex items-center">
                                <i class="fa-solid fa-address-book mr-2"></i> Datos de Contacto
                            </h4>
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
                                <div>
                                    <label class="block text-xs font-bold text-slate-600 mb-1.5">Nombre Contacto</label>
                                    <input type="text" name="contactName" class="w-full border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none bg-white" placeholder="Ej: Juan Pérez" value="${isEditing ? data.contactName || '' : ''}">
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-600 mb-1.5">Teléfono / Celular</label>
                                    <div class="relative">
                                        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><i class="fa-solid fa-phone"></i></div>
                                        <input type="tel" name="contactPhone" class="w-full pl-9 border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none bg-white" placeholder="300 123 4567" value="${isEditing ? data.contactPhone || '' : ''}">
                                    </div>
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-600 mb-1.5">Correo Electrónico</label>
                                    <div class="relative">
                                        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><i class="fa-solid fa-envelope"></i></div>
                                        <input type="email" name="email" class="w-full pl-9 border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none bg-white" placeholder="contacto@empresa.com" value="${isEditing ? data.email || '' : ''}">
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
                             <div class="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-indigo-400 to-purple-600"></div>
                             <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-4 flex items-center ml-2">
                                <i class="fa-solid fa-building-columns mr-2 text-indigo-500"></i> Información Bancaria
                            </h4>
                            
                            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 pl-2">
                                <div class="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div class="md:col-span-2">
                                        <label class="block text-xs font-bold text-gray-700 mb-1.5">Banco</label>
                                        <input type="text" name="bankName" class="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Ej: Bancolombia" value="${isEditing ? data.bankName || '' : ''}">
                                    </div>
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1.5">Tipo de Cuenta</label>
                                        <select name="accountType" class="w-full border-gray-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer">
                                            <option value="Ahorros" ${isEditing && data.accountType === 'Ahorros' ? 'selected' : ''}>Ahorros</option>
                                            <option value="Corriente" ${isEditing && data.accountType === 'Corriente' ? 'selected' : ''}>Corriente</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label class="block text-xs font-bold text-gray-700 mb-1.5">Número de Cuenta</label>
                                        <input type="text" name="accountNumber" class="w-full border-gray-300 rounded-lg p-2.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="000-00000-00" value="${isEditing ? data.accountNumber || '' : ''}">
                                    </div>
                                </div>

                                <div class="lg:col-span-4 flex flex-col items-center justify-center bg-indigo-50 rounded-xl border border-indigo-100 p-4">
                                    <label class="block text-xs font-bold text-indigo-600 mb-3 uppercase tracking-wide text-center">Código QR Bancario</label>
                                    
                                    <div id="qr-preview-container" class="w-32 h-32 bg-white border-2 border-dashed border-indigo-300 rounded-xl flex items-center justify-center overflow-hidden relative cursor-pointer hover:border-indigo-500 hover:shadow-md transition-all group">
                                        <img id="qr-img-preview" src="${isEditing ? data.qrCodeURL || '' : ''}" class="w-full h-full object-cover ${isEditing && data.qrCodeURL ? '' : 'hidden'}">
                                        
                                        <div id="qr-placeholder-icon" class="text-center ${isEditing && data.qrCodeURL ? 'hidden' : ''}">
                                            <i class="fa-solid fa-qrcode text-4xl text-indigo-200 group-hover:text-indigo-500 transition-colors mb-2"></i>
                                            <p class="text-[10px] text-indigo-400 font-bold group-hover:text-indigo-600">SUBIR IMAGEN</p>
                                        </div>

                                        <div class="absolute inset-0 bg-indigo-900/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <i class="fa-solid fa-camera text-white text-2xl drop-shadow-md"></i>
                                        </div>
                                    </div>
                                    
                                    <input type="file" id="supplier-qr-input" name="qrFile" accept="image/*" class="hidden">
                                    <button type="button" id="btn-remove-qr" class="mt-2 text-[10px] text-red-400 hover:text-red-600 underline ${isEditing && data.qrCodeURL ? '' : 'hidden'}">Eliminar imagen</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // ... (Lógica JS del timeout se mantiene igual)
            setTimeout(() => {
                const qrContainer = document.getElementById('qr-preview-container');
                const fileInput = document.getElementById('supplier-qr-input');
                const imgPreview = document.getElementById('qr-img-preview');
                const iconPlaceholder = document.getElementById('qr-placeholder-icon');
                const btnRemove = document.getElementById('btn-remove-qr');

                if (qrContainer && fileInput) {
                    // Click en el contenedor abre el selector
                    qrContainer.onclick = () => fileInput.click();

                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (evt) => {
                                imgPreview.src = evt.target.result;
                                imgPreview.classList.remove('hidden');
                                iconPlaceholder.classList.add('hidden');
                                qrContainer.classList.remove('border-dashed', 'border-indigo-300');
                                qrContainer.classList.add('border-solid', 'border-indigo-600', 'shadow-md');
                                btnRemove.classList.remove('hidden');
                            };
                            reader.readAsDataURL(file);
                        }
                    };

                    // Botón de eliminar (Visual)
                    if (btnRemove) {
                        btnRemove.onclick = (e) => {
                            e.stopPropagation(); // Evitar abrir el selector
                            fileInput.value = '';
                            imgPreview.src = '';
                            imgPreview.classList.add('hidden');
                            iconPlaceholder.classList.remove('hidden');
                            qrContainer.classList.add('border-dashed', 'border-indigo-300');
                            qrContainer.classList.remove('border-solid', 'border-indigo-600', 'shadow-md');
                            btnRemove.classList.add('hidden');
                        }
                    }
                }
            }, 150);

            break;
        }
        case 'request-material': {
            title = 'Crear Solicitud de Material';
            btnText = 'Enviar Solicitud';
            btnClass = 'bg-green-500 hover:bg-green-600';

            // El HTML de carga sigue siendo útil por si se usa en el futuro
            bodyHtml = `
                <div id="material-request-loader" class="text-center py-8">
                <div class="loader mx-auto"></div>
                <p class="mt-2 text-sm text-gray-500">Cargando datos del proyecto...</p>
                </div>
                <div id="material-request-form-content" class="hidden"></div>
            `;

            // --- LÓGICA DUPLICADA ELIMINADA ---
            // Se eliminó la función const loadDataAndBuildForm = async () => { ... }
            // y la llamada setTimeout(loadDataAndBuildForm, 50);
            // ya que esta lógica se maneja en showMaterialRequestView()
            // --- FIN DE LA LIMPIEZA ---

            break;
        }
        case 'editProfile':
            title = 'Mi Perfil';
            btnText = 'Guardar Cambios';
            btnClass = 'bg-blue-500 hover:bg-blue-600';
            modalContentDiv.classList.add('max-w-2xl');

            bodyHtml = `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    
                    <div class="md:col-span-1">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Foto de Perfil</label>
                        <div class="aspect-square w-full rounded-lg bg-gray-100 overflow-hidden border">
                            <img src="${data.profilePhotoURL || 'https://via.placeholder.com/300'}" alt="Foto de perfil" class="w-full h-full object-cover">
                        </div>
                        <p class="text-xs text-center text-gray-500 mt-2">La foto de perfil solo puede ser actualizada por un administrador.</p>
                    </div>

                    <div class="md:col-span-2 space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-500">Nombre</label>
                            <p class="mt-1 p-2 bg-gray-100 rounded-md border">${data.firstName} ${data.lastName}</p>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-500">Cédula</label>
                            <p class="mt-1 p-2 bg-gray-100 rounded-md border">${data.idNumber}</p>
                        </div>
                        
                        <div>
                            <label for="profile-email" class="block text-sm font-medium text-gray-700">Correo</label>
                            <input type="email" id="profile-email" name="email" value="${data.email}" 
                                required readonly 
                                class="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-100 text-gray-500 cursor-not-allowed">
                        </div>
                        <div>
                            <label for="profile-phone" class="block text-sm font-medium text-gray-700">Celular</label>
                            <input type="tel" id="profile-phone" name="phone" value="${data.phone}" required class="mt-1 block w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500">
                        </div>
                        <div>
                            <label for="profile-address" class="block text-sm font-medium text-gray-700">Dirección</label>
                            <input type="text" id="profile-address" name="address" value="${data.address}" required class="mt-1 block w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500">
                        </div>
                    </div>

                    <div class="md:col-span-3 border-t pt-4">
                        <h4 class="text-md font-semibold text-gray-700 mb-2">Tallas Preferidas</h4>
                        <div class="grid grid-cols-3 gap-4">
                            <div>
                                <label class="block text-sm font-medium">Camiseta</label>
                                <input type="text" name="tallaCamiseta" class="mt-1 w-full border rounded-md p-2" value="${data.tallaCamiseta || ''}" placeholder="Ej: L">
                            </div>
                            <div>
                                <label class="block text-sm font-medium">Pantalón</label>
                                <input type="text" name="tallaPantalón" class="mt-1 w-full border rounded-md p-2" value="${data.tallaPantalón || data.tallaPantalon || ''}" placeholder="Ej: 32">
                            </div>
                            <div>
                                <label class="block text-sm font-medium">Botas</label>
                                <input type="text" name="tallaBotas" class="mt-1 w-full border rounded-md p-2" value="${data.tallaBotas || ''}" placeholder="Ej: 42">
                            </div>
                        </div>
                    </div>


                </div>
            `;

            //Boton de ver historial de cambios
            /*<div class="md:col-span-3 border-t pt-4">
                <button type="button" data-action="view-profile-history" data-userid="${currentUser.uid}" class="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg transition-colors">
                    <i class="fa-solid fa-clock-rotate-left mr-2"></i> Ver Mi Historial de Cambios
                </button>
            </div>*/

            // Corregido (envuelto en un setTimeout):
            setTimeout(() => {
            }, 100);

            break;
    }
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    confirmBtn.textContent = btnText;
    confirmBtn.className = `text-white font-bold py-2 px-4 rounded-lg transition-all ${btnClass}`;
    modal.style.display = 'flex';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (modalBody) {
        modalBody.scrollTop = 0;
    }
}

// --- EXPOSICIÓN DE FUNCIONES GLOBALES ---
window.openMainModal = openMainModal;   // <--- ESTO HACE QUE EL BOTÓN DE LOGS FUNCIONE
window.closeMainModal = closeMainModal; // (Recomendado para evitar futuros errores de cierre)

/**
 * Configura la lógica para añadir nuevos ítems a la PO y buscar precios.
 * (VERSIÓN CORREGIDA: Crea el HTML de la fila en lugar de clonarlo)
 * @param {Array} unifiedItemOptions - El array de opciones de ítems unificados.
 */
function setupPOItemLogic(unifiedItemOptions) {
    const container = document.getElementById('po-items-container');
    if (!container) return;

    const addBtn = document.getElementById('add-po-item-btn');

    /**
     * Función interna para crear una nueva fila de ítem
     */
    const addPOItemRow = () => {
        // 1. Crear un nuevo div
        const newItem = document.createElement('div');

        // 2. Establecer sus clases y HTML (con layout Grid y z-10)
        newItem.className = "po-item grid grid-cols-12 gap-2 items-center p-2 border rounded-md relative z-10 bg-white";
        newItem.innerHTML = `
            <div class="col-span-12 sm:col-span-6">
                <label class="block text-xs sm:hidden">Ítem</label>
                <select name="itemId" class="po-item-select w-full border p-2 rounded-md bg-white"></select>
            </div>
            
            <div class="col-span-6 sm:col-span-2">

            
                <label class="block text-xs sm:hidden">Cantidad</label>

            
                <input type="number" name="quantity" step="any" required class="w-full border p-2 rounded-md" placeholder="Cant.">
            </div>
            
            <div class="col-span-6 sm:col-span-3">
                <label class="block text-xs sm:hidden">Costo Unitario</label>
                <input type="text" name="unitCost" required class="currency-input w-full border p-2 rounded-md" placeholder="Costo Unit.">
            </div>

            <div class="col-span-12 sm:col-span-1 text-right sm:text-center">
                <button type="button" class="remove-po-item-btn text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-100">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        `;

        // 3. Añadir el nuevo elemento
        container.appendChild(newItem);

        // 4. Encontrar el <select> DENTRO del nuevo elemento
        const newSelect = newItem.querySelector('select[name="itemId"]');

        // 5. Inicializar Choices.js en el <select>
        new Choices(newSelect, {
            choices: unifiedItemOptions,
            itemSelectText: 'Seleccionar',
            searchPlaceholderValue: 'Buscar ítem...',
            searchResultLimit: 500 // <-- LÍNEA AÑADIDA
        });
    };

    // --- FIN DE LA FUNCIÓN INTERNA ---

    // Llamamos a la función para añadir la primera fila al cargar
    addPOItemRow();

    // El botón "+ Añadir ítem" ahora solo llama a esa función
    addBtn.onclick = addPOItemRow;

    // Listener para el nuevo botón "Eliminar"
    container.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove-po-item-btn');
        if (removeBtn) {
            if (container.querySelectorAll('.po-item').length > 1) {
                removeBtn.closest('.po-item').remove();
            } else {
                alert("Debes tener al menos un ítem en la orden.");
            }
        }
    });

    // Listener para buscar precios y guardar el tipo de ítem (Sin cambios)
    container.addEventListener('change', async (e) => {
        if (e.target.name === 'itemId') {
            // ... (lógica de findLastPurchasePrice - sin cambios) ...
            const selectEl = e.target;
            let itemType = null;
            try {
                const choicesInstance = selectEl.choices;
                const selectedChoice = choicesInstance?.getValue(true);
                itemType = selectedChoice?.customProperties?.type || null;
            } catch (error) {
                console.warn("No se pudo obtener la instancia de Choices.js, reintentando por dataset.");
                const selectedOption = selectEl.options[selectEl.selectedIndex];
                if (selectedOption && selectedOption.dataset.customProperties) {
                    itemType = JSON.parse(selectedOption.dataset.customProperties).type;
                }
            }
            if (itemType) {
                selectEl.dataset.itemType = itemType;
            }
            const materialId = selectEl.value;
            const supplierId = document.getElementById('po-supplier-select').value;
            if (!supplierId || !materialId) return;
            const costInput = e.target.closest('.po-item').querySelector('.currency-input');
            const lastPrice = await findLastPurchasePrice(supplierId, materialId);
            if (lastPrice !== null) {
                costInput.value = currencyFormatter.format(lastPrice).replace(/\s/g, ' ');
            } else {
                costInput.value = '';
            }
        }
    });

    // Formateador de moneda (Sin cambios)
    container.addEventListener('input', (e) => {
        if (e.target.classList.contains('currency-input')) {
            setupCurrencyInput(e.target);
        }
    });
}


function closeMainModal() {
    const mainModal = document.getElementById('main-modal');
    if (mainModal) mainModal.style.display = 'none';
}

// --- CONFIRM, IMAGE, AND SUCCESS MODALS ---

const confirmModal = document.getElementById('confirm-modal');
const confirmModalBody = document.getElementById('confirm-modal-body');
const confirmModalCancelBtn = document.getElementById('confirm-modal-cancel-btn');
const confirmModalConfirmBtn = document.getElementById('confirm-modal-confirm-btn');
let onConfirmCallback = () => { };
// ESTA ES LA FUNCIÓN MEJORADA
function openConfirmModal(message, callback) {
    confirmModalBody.textContent = message;
    onConfirmCallback = callback;

    // CAMBIO: Aseguramos que sea el más alto (70)
    confirmModal.style.zIndex = "70";

    confirmModal.style.display = 'flex';
}
function closeConfirmModal() { confirmModal.style.display = 'none'; }
confirmModalCancelBtn.addEventListener('click', closeConfirmModal);
confirmModalConfirmBtn.addEventListener('click', () => { onConfirmCallback(); closeConfirmModal(); });

const imageModal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');
const imageModalCloseBtn = document.getElementById('image-modal-close-btn');
const registerSuccessModal = document.getElementById('register-success-modal');

function openImageModal(imageUrl) {
    modalImage.src = imageUrl;
    imageModal.style.display = 'flex';
}

window.openImageModal = openImageModal;

function closeImageModal() {
    imageModal.style.display = 'none';
    modalImage.src = '';
}

function openRegisterSuccessModal() {
    registerSuccessModal.style.display = 'flex';
}

function closeRegisterSuccessModal() {
    registerSuccessModal.style.display = 'none';
}

document.getElementById('register-success-accept-btn').addEventListener('click', async () => {
    closeRegisterSuccessModal();
    await signOut(auth);
    document.getElementById('register-form').reset();
    showAuthView('login');
});
export { openMainModal, closeMainModal, openConfirmModal, closeConfirmModal, openImageModal, closeImageModal, openRegisterSuccessModal, closeRegisterSuccessModal };
