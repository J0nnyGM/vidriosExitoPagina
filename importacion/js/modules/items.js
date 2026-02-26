                // js/modules/items.js

                import { db } from '../firebase-config.js';
                import { collection, doc, addDoc, updateDoc, query, getDocs, where, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
                import { allItems, setAllItems, allItemAverageCosts, showModalMessage, hideModal, showTemporaryMessage } from '../app.js';
                import { formatCurrency } from '../utils.js';

                // --- CONFIGURACIÓN DE CACHÉ Y PAGINACIÓN ---
                const CACHE_KEY = 'items_cache';
                const SYNC_KEY = 'items_last_sync';

                // Variables de Paginación
                let currentPage = 1;
                const itemsPerPage = 20;

                // --- CARGA DE DATOS (INTELIGENTE + TIEMPO REAL INFALIBLE) ---
                export function loadItems() {
                    const cachedData = localStorage.getItem(CACHE_KEY);
                    
                    let mapItems = new Map();
                    let maxLastUpdated = 0; // Guardará la fecha exacta del documento más reciente

                    // 1. Cargar desde el caché local (Velocidad instantánea)
                    if (cachedData) {
                        try {
                            const parsedData = JSON.parse(cachedData);
                            parsedData.forEach(i => {
                                mapItems.set(i.id, i);
                                // Buscamos cuál es el timestamp más reciente que tenemos guardado
                                if (i._lastUpdated && i._lastUpdated > maxLastUpdated) {
                                    maxLastUpdated = i._lastUpdated;
                                }
                            });
                            setAllItems(Array.from(mapItems.values()));
                            renderItems();
                        } catch (e) {
                            console.warn("Caché de ítems corrupto. Se limpiará.", e);
                            localStorage.removeItem(CACHE_KEY);
                            localStorage.removeItem(SYNC_KEY);
                        }
                    }

                    // 2. onSnapshot Diferencial basado en la información real del servidor
                    const colRef = collection(db, "items");
                    let q;

                    if (maxLastUpdated > 0) {
                        // Restamos 2 minutos de margen de seguridad a la fecha del último documento
                        const syncTime = new Date(maxLastUpdated - 120000); 
                        q = query(colRef, where("_lastUpdated", ">=", syncTime));
                    } else {
                        // Si no hay caché, descarga todo
                        q = query(colRef);
                    }

                    // 3. Quedarse escuchando los cambios en vivo
                    const unsubscribe = onSnapshot(q, (snapshot) => {
                        let huboCambios = false;

                        snapshot.docChanges().forEach((change) => {
                            const doc = change.doc;
                            const data = doc.data();

                            // Limpieza de Timestamps para poder serializar en JSON local
                            if (data._lastUpdated && typeof data._lastUpdated.toMillis === 'function') data._lastUpdated = data._lastUpdated.toMillis();
                            if (data.creadoEn && typeof data.creadoEn.toMillis === 'function') data.creadoEn = data.creadoEn.toMillis();
                            
                            if (change.type === "added" || change.type === "modified") {
                                mapItems.set(doc.id, { id: doc.id, ...data });
                                huboCambios = true;
                            }
                            if (change.type === "removed") {
                                mapItems.delete(doc.id);
                                huboCambios = true;
                            }
                        });

                        // 4. Si hubo un cambio, actualizamos la memoria, el caché local y la pantalla
                        if (huboCambios) {
                            const finalArray = Array.from(mapItems.values());
                            
                            // Ordenamos alfabéticamente por la referencia
                            finalArray.sort((a, b) => (a.referencia || '').localeCompare(b.referencia || ''));
                            
                            localStorage.setItem(CACHE_KEY, JSON.stringify(finalArray));
                            setAllItems(finalArray);
                            
                            renderItems();
                            
                            // Si el usuario está creando una remisión y tiene el buscador desplegado,
                            // esto asegura que los nuevos ítems y su stock estén disponibles de inmediato.
                            console.log(`[Ítems] ${snapshot.docChanges().length} cambios detectados en tiempo real.`);
                        }
                    }, (error) => {
                        console.error("Error en onSnapshot diferencial de ítems:", error);
                    });

                    return unsubscribe;
                }

                function updateLocalCache(newOrUpdatedItem) {
                    const cachedData = localStorage.getItem(CACHE_KEY);
                    let items = cachedData ? JSON.parse(cachedData) : [];
                    
                    const index = items.findIndex(i => i.id === newOrUpdatedItem.id);
                    if (index !== -1) items[index] = newOrUpdatedItem;
                    else items.push(newOrUpdatedItem);
                    
                    items.sort((a, b) => (a.referencia || '').localeCompare(b.referencia || ''));
                    
                    localStorage.setItem(CACHE_KEY, JSON.stringify(items));
                    setAllItems(items);
                    renderItems();
                }

                export function renderItems() {
                    const itemsListEl = document.getElementById('items-list');
                    if (!itemsListEl) return;
                    
                    const searchInput = document.getElementById('search-items');
                    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

                    let filtered = allItems;
                    if (searchTerm) {
                        filtered = filtered.filter(i =>
                            (i.descripcion && i.descripcion.toLowerCase().includes(searchTerm)) ||
                            (i.referencia && i.referencia.toLowerCase().includes(searchTerm))
                        );
                    }

                    const totalItemsCount = filtered.length;
                    const totalPages = Math.ceil(totalItemsCount / itemsPerPage) || 1;

                    if (currentPage > totalPages) currentPage = totalPages;
                    if (currentPage < 1) currentPage = 1;

                    const startIndex = (currentPage - 1) * itemsPerPage;
                    const endIndex = startIndex + itemsPerPage;
                    const paginatedItems = filtered.slice(startIndex, endIndex);

                    itemsListEl.innerHTML = '';
                    if (totalItemsCount === 0) {
                        itemsListEl.innerHTML = '<p class="text-center text-gray-500 py-4">No hay ítems que coincidan con la búsqueda.</p>';
                        return;
                    }

                    paginatedItems.forEach(item => {
                        const averageCost = allItemAverageCosts[item.id] || 0;
                        
                        // Etiqueta visual para distinguir si es unidad o medida
                        const badgeUnidad = item.esUnidad 
                            ? `<span class="bg-purple-100 text-purple-800 text-xs font-semibold px-2 py-0.5 rounded ml-2">Unidad</span>` 
                            : '';

                        const itemDiv = document.createElement('div');
                        itemDiv.className = 'border p-4 rounded-lg flex justify-between items-center';

                        itemDiv.innerHTML = `
                            <div class="flex-grow">
                                <p class="font-semibold flex items-center"><span class="item-ref">${item.referencia}</span> ${badgeUnidad}</p>
                                <p class="text-sm text-gray-700">${item.descripcion}</p>
                                <p class="text-sm text-blue-600 font-semibold mt-1">Costo Promedio: ${formatCurrency(averageCost)}</p>
                            </div>
                            <div class="flex items-center gap-4">
                                <div class="text-right">
                                    <p class="font-bold text-2xl">${item.stockInfinito ? '∞' : item.stock}</p>
                                    <p class="text-sm text-gray-500">${item.stockInfinito ? 'ilimitado' : 'en stock'}</p>
                                </div>
                                <button data-item-json='${JSON.stringify(item)}' class="edit-item-btn bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-300">
                                    Editar
                                </button>
                            </div>
                        `;
                        itemsListEl.appendChild(itemDiv);
                    });

                    const paginationEl = document.createElement('div');
                    paginationEl.className = 'flex justify-between items-center mt-4 pt-4 border-t border-gray-200';
                    paginationEl.innerHTML = `
                        <span class="text-sm text-gray-600">Mostrando ${startIndex + 1} - ${Math.min(endIndex, totalItemsCount)} de ${totalItemsCount}</span>
                        <div class="flex gap-2">
                            <button id="prev-page-items-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPage === 1 ? 'disabled' : ''}>Anterior</button>
                            <span class="px-3 py-1 font-semibold text-gray-700">Pág ${currentPage} de ${totalPages}</span>
                            <button id="next-page-items-btn" class="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente</button>
                        </div>
                    `;
                    itemsListEl.appendChild(paginationEl);

                    const prevBtn = document.getElementById('prev-page-items-btn');
                    const nextBtn = document.getElementById('next-page-items-btn');
                    
                    if (prevBtn && currentPage > 1) {
                        prevBtn.addEventListener('click', () => { currentPage--; renderItems(); });
                    }
                    if (nextBtn && currentPage < totalPages) {
                        nextBtn.addEventListener('click', () => { currentPage++; renderItems(); });
                    }
                }

                export function showEditItemModal(item) {
                    const modalContentWrapper = document.getElementById('modal-content-wrapper');

                    modalContentWrapper.innerHTML = `
                        <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
                            <div class="flex justify-between items-center mb-4">
                                <h2 class="text-xl font-semibold">Editar Ítem: ${item.referencia}</h2>
                                <button id="close-edit-item-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                            </div>
                            <form id="edit-item-form" class="space-y-4">
                                <input type="hidden" id="edit-item-id" value="${item.id}">
                                
                                <div class="bg-gray-50 p-3 rounded-lg border border-gray-200 mb-2">
                                    <label class="flex items-center space-x-2 cursor-pointer">
                                        <input type="checkbox" id="edit-item-es-unidad" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" ${item.esUnidad ? 'checked' : ''}>
                                        <span class="text-sm font-semibold text-gray-800">Se vende por Unidad (Sin medidas Ancho x Alto)</span>
                                    </label>
                                </div>

                                <div>
                                    <label class="block text-sm font-medium">Tipo (Ej: Vidrio, Silicona)</label>
                                    <input type="text" id="edit-item-tipo" class="w-full p-2 border rounded-lg mt-1" value="${item.tipo}" required>
                                </div>
                                <div>
                                    <label class="block text-sm font-medium">Color o Detalle (Ej: Crudo, Transparente)</label>
                                    <input type="text" id="edit-item-color" class="w-full p-2 border rounded-lg mt-1" value="${item.color}" required>
                                </div>

                                <div id="edit-item-medidas-container" class="grid grid-cols-2 gap-4 ${item.esUnidad ? 'hidden' : ''}">
                                    <div>
                                        <label class="block text-sm font-medium">Ancho (mm)</label>
                                        <input type="number" id="edit-item-ancho" class="w-full p-2 border rounded-lg mt-1" value="${item.ancho || ''}">
                                    </div>
                                    <div>
                                        <label class="block text-sm font-medium">Alto (mm)</label>
                                        <input type="number" id="edit-item-alto" class="w-full p-2 border rounded-lg mt-1" value="${item.alto || ''}">
                                    </div>
                                </div>
                                <div id="edit-item-caja-container" class="${item.esUnidad ? 'hidden' : ''}">
                                    <label class="block text-sm font-medium">Láminas por Caja</label>
                                    <input type="number" id="edit-item-laminas-por-caja" class="w-full p-2 border rounded-lg mt-1" value="${item.laminasPorCaja || 1}">
                                </div>

                                <div class="bg-gray-50 p-3 rounded-lg border border-gray-200">
                                    <label class="flex items-center space-x-2 cursor-pointer mb-2">
                                        <input type="checkbox" id="edit-item-stock-infinito" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" ${item.stockInfinito ? 'checked' : ''}>
                                        <span class="text-sm font-semibold text-gray-800">Stock Infinito</span>
                                    </label>
                                    <label class="block text-sm font-medium">Stock Actual</label>
                                    <input type="number" id="edit-item-stock" class="w-full p-2 border rounded-lg mt-1 bg-gray-200" value="${item.stockInfinito ? '' : item.stock}" disabled>
                                    <p class="text-xs text-gray-500 mt-1">El stock numérico solo se modifica a través de remisiones e importaciones.</p>
                                </div>
                                <div class="flex justify-end pt-4">
                                    <button type="submit" class="bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-700">Guardar Cambios</button>
                                </div>
                            </form>
                        </div>
                    `;

                    document.getElementById('modal').classList.remove('hidden');
                    document.getElementById('close-edit-item-modal').addEventListener('click', hideModal);

                    // Lógica para mostrar/ocultar medidas dinámicamente
                    const isUnitCheckbox = document.getElementById('edit-item-es-unidad');
                    const medidasContainer = document.getElementById('edit-item-medidas-container');
                    const cajaContainer = document.getElementById('edit-item-caja-container');

                    isUnitCheckbox.addEventListener('change', (e) => {
                        if (e.target.checked) {
                            medidasContainer.classList.add('hidden');
                            cajaContainer.classList.add('hidden');
                        } else {
                            medidasContainer.classList.remove('hidden');
                            cajaContainer.classList.remove('hidden');
                        }
                    });
                }

                export function setupItemsEvents() {
                    const searchInput = document.getElementById('search-items');
                    let debounceTimer;

                    if (searchInput) {
                        searchInput.addEventListener('input', () => {
                            clearTimeout(debounceTimer);
                            debounceTimer = setTimeout(() => {
                                currentPage = 1;
                                renderItems();
                            }, 300);
                        });
                    }

                    document.body.addEventListener('click', (e) => {
                        const editBtn = e.target.closest('.edit-item-btn');
                        if (editBtn) {
                            const itemData = JSON.parse(editBtn.dataset.itemJson);
                            showEditItemModal(itemData);
                        }
                    });

                    document.body.addEventListener('submit', async (e) => {
                        // --- 1. CREAR NUEVO ÍTEM ---
                        if (e.target && e.target.id === 'add-item-form') {
                            e.preventDefault();
                            
                            // Evaluamos si el checkbox de unidad existe en el HTML de app.js y si está marcado
                            const checkboxUnidad = document.getElementById('nuevo-item-es-unidad');
                            const esUnidad = checkboxUnidad ? checkboxUnidad.checked : false;

const tipo = document.getElementById('nuevo-item-tipo').value;
            const color = document.getElementById('nuevo-item-color').value;
            
            // PRIMERO declaramos y leemos si es infinito
            const esStockInfinito = document.getElementById('nuevo-item-stock-infinito').checked;
            
            // LUEGO, ahora que ya existe la variable, la usamos para decidir el stock
            const stock = esStockInfinito ? 0 : parseInt(document.getElementById('nuevo-item-stock').value, 10);

            if (!tipo || !color || (!esStockInfinito && isNaN(stock))) {
                return showModalMessage("Por favor, completa los campos requeridos.");
            }

                            let ancho = 0, alto = 0, laminasPorCaja = 1;
                            let referencia, descripcion;

                            if (esUnidad) {
                                // Si es por unidad, no pedimos medidas
                                referencia = `${tipo.slice(0, 3).toUpperCase()}${color.slice(0, 3).toUpperCase()}-UND`;
                                descripcion = `${tipo} ${color} (Unidad)`;
                            } else {
                                // Si es vidrio/espejo, exigimos medidas
                                ancho = parseFloat(document.getElementById('nuevo-item-ancho').value);
                                alto = parseFloat(document.getElementById('nuevo-item-alto').value);
                                laminasPorCaja = parseInt(document.getElementById('nuevo-item-laminas-por-caja').value, 10);

                                if (isNaN(ancho) || isNaN(alto) || isNaN(laminasPorCaja)) {
                                    return showModalMessage("Al no ser unidad, debes completar Ancho, Alto y Láminas por caja.");
                                }
                                referencia = `${tipo.slice(0, 3).toUpperCase()}${color.slice(0, 3).toUpperCase()}-${ancho}x${alto}`;
                                descripcion = `${tipo} ${color} ${ancho}x${alto}mm`;
                            }

                            const submitBtn = e.target.querySelector('button[type="submit"]');
                            if(submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Guardando...'; }

                            const nuevoItem = {
                                referencia, tipo, color, ancho, alto, descripcion, laminasPorCaja, 
                                stock: stock, 
                                esUnidad, 
                                stockInfinito: esStockInfinito, // <-- ESTO ES NUEVO
                                creadoEn: Date.now(),
                                _lastUpdated: serverTimestamp() 
                            };

                            try {
                                const docRef = await addDoc(collection(db, "items"), nuevoItem);
                                
                                nuevoItem.id = docRef.id;
                                nuevoItem._lastUpdated = Date.now();
                                updateLocalCache(nuevoItem);

                                e.target.reset();
                                // Ocultar los campos de medidas si estaba marcado
                                if(checkboxUnidad) checkboxUnidad.dispatchEvent(new Event('change'));

                                if(window.Swal) Swal.fire('¡Éxito!', 'Ítem guardado con éxito.', 'success');
                                else showTemporaryMessage('Ítem guardado', 'success');

                                currentPage = 1;
                                renderItems();

                            } catch (error) {
                                console.error("Error al guardar el ítem:", error);
                                showModalMessage("Error al guardar el ítem.");
                            } finally {
                                if(submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Guardar Ítem'; }
                            }
                        }

                        // --- 2. EDITAR ÍTEM ---
                        if (e.target && e.target.id === 'edit-item-form') {
                            e.preventDefault();
                            const itemId = document.getElementById('edit-item-id').value;
                            const esUnidad = document.getElementById('edit-item-es-unidad').checked;
                            const tipo = document.getElementById('edit-item-tipo').value;
                            const color = document.getElementById('edit-item-color').value;
                            const esStockInfinito = document.getElementById('edit-item-stock-infinito').checked;

                            if (!tipo || !color) return showModalMessage("El tipo y el color son obligatorios.");

                            let ancho = 0, alto = 0, laminasPorCaja = 1;
                            let referencia, descripcion;

                            if (esUnidad) {
                                referencia = `${tipo.slice(0, 3).toUpperCase()}${color.slice(0, 3).toUpperCase()}-UND`;
                                descripcion = `${tipo} ${color} (Unidad)`;
                            } else {
                                ancho = parseFloat(document.getElementById('edit-item-ancho').value);
                                alto = parseFloat(document.getElementById('edit-item-alto').value);
                                laminasPorCaja = parseInt(document.getElementById('edit-item-laminas-por-caja').value, 10);

                                if (isNaN(ancho) || isNaN(alto) || isNaN(laminasPorCaja)) {
                                    return showModalMessage("Al no ser unidad, debes completar Ancho, Alto y Láminas por caja.");
                                }
                                referencia = `${tipo.slice(0, 3).toUpperCase()}${color.slice(0, 3).toUpperCase()}-${ancho}x${alto}`;
                                descripcion = `${tipo} ${color} ${ancho}x${alto}mm`;
                            }

                            const submitBtn = e.target.querySelector('button[type="submit"]');
                            if(submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Guardando...'; }

                            const updatedData = {
                                tipo, color, ancho, alto, laminasPorCaja, referencia, descripcion, esUnidad,
                                stockInfinito: esStockInfinito, // <-- ESTO ES NUEVO
                                _lastUpdated: serverTimestamp() 
                            };

                            try {
                                const itemRef = doc(db, "items", itemId);
                                await updateDoc(itemRef, updatedData);
                                
                                const existingItem = allItems.find(i => i.id === itemId) || {};
                                const updatedForCache = { ...existingItem, ...updatedData, id: itemId, _lastUpdated: Date.now() };
                                updateLocalCache(updatedForCache);

                                hideModal();
                                if(window.Swal) Swal.fire('¡Éxito!', 'Ítem actualizado con éxito.', 'success');
                                else showTemporaryMessage('Ítem actualizado', 'success');

                            } catch (error) {
                                console.error("Error al actualizar el ítem:", error);
                                showModalMessage("Error al guardar los cambios.");
                            } finally {
                                if(submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Guardar Cambios'; }
                            }
                        }
                    });
                }