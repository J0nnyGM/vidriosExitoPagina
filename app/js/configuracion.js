import {
    doc,
    getDoc,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// --- Variables del Módulo ---
let _db;
let _setupCurrencyInput;

/**
 * Inicializa el módulo de Configuración.
 */
export function initConfiguracion(db, setupCurrencyInput) {
    _db = db;
    _setupCurrencyInput = setupCurrencyInput;
}

/**
 * Carga la vista de Configuración.
 */
export async function loadConfiguracionView() {
    const container = document.getElementById('configuracion-view');
    
    // 1. Definimos el formateador LOCALMENTE
    const currencyFormatter = new Intl.NumberFormat('es-CO', { 
        style: 'currency', 
        currency: 'COP', 
        minimumFractionDigits: 0, 
        maximumFractionDigits: 0 
    });

    const fmt = (val) => {
        if (val === undefined || val === null || val === '') return '';
        return currencyFormatter.format(val).replace(/\s/g, ' ');
    };

    // --- 2. ESTRUCTURA HTML COMPLETA (Con campo de Firma) ---
    container.innerHTML = `
        <div class="max-w-4xl mx-auto space-y-8">
            <h2 class="text-2xl font-bold text-gray-800 flex items-center">
                <i class="fa-solid fa-gears mr-3 text-indigo-600"></i> Configuración del Sistema
            </h2>

            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 class="text-lg font-bold text-gray-700 mb-4 border-b pb-2 flex items-center">
                    <i class="fa-solid fa-building mr-2 text-gray-400"></i> Información Corporativa
                </h3>
                <form id="general-config-form" class="space-y-5">
                    <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Razón Social</label>
                                <input type="text" name="empresaNombre" class="w-full border border-gray-300 rounded p-2 text-sm" placeholder="Nombre de la empresa">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">NIT</label>
                                <input type="text" name="empresaNIT" class="w-full border border-gray-300 rounded p-2 text-sm" placeholder="000.000.000-0">
                            </div>
                            
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre Gerente</label>
                                <input type="text" name="empresaGerente" class="w-full border border-gray-300 rounded p-2 text-sm font-medium bg-white" placeholder="Ej: Yolanda Martínez">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">URL Firma Gerente (Imagen)</label>
                                <input type="text" name="empresaFirmaURL" class="w-full border border-gray-300 rounded p-2 text-xs font-mono text-gray-600" placeholder="https://firebasestorage...">
                            </div>

                            <div class="md:col-span-2">
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Dirección Principal</label>
                                <input type="text" name="empresaDireccion" class="w-full border border-gray-300 rounded p-2 text-sm" placeholder="Dirección completa">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Teléfono(s)</label>
                                <input type="text" name="empresaTelefono" class="w-full border border-gray-300 rounded p-2 text-sm" placeholder="Teléfono de contacto">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Correo Electrónico</label>
                                <input type="email" name="empresaEmail" class="w-full border border-gray-300 rounded p-2 text-sm" placeholder="email@empresa.com">
                            </div>

                             <div class="md:col-span-2 border-t pt-3 mt-2">
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Logo URL (Firebase)</label>
                                <input type="text" name="empresaLogoURL" class="w-full border border-gray-300 rounded p-2 text-xs font-mono text-gray-600" placeholder="https://...">
                            </div>
                        </div>
                    </div>

                    <div class="bg-orange-50 p-4 rounded-lg border border-orange-100">
                        <h4 class="text-sm font-bold text-orange-800 mb-3">Alertas Automáticas</h4>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-orange-700 mb-1">Vencimiento SST (Días)</label>
                                <input type="number" name="diasAlertaSST" class="w-full border border-orange-200 rounded p-2 text-sm" value="45">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-orange-700 mb-1">Mantenimiento Herramienta</label>
                                <input type="number" name="diasAlertaHerramienta" class="w-full border border-orange-200 rounded p-2 text-sm" value="30">
                            </div>
                        </div>
                    </div>

                    <div class="text-right">
                        <button type="submit" class="bg-gray-800 hover:bg-black text-white font-bold py-2 px-4 rounded shadow transition-colors">
                            Guardar General
                        </button>
                    </div>
                </form>
            </div>

            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 class="text-lg font-bold text-gray-700 mb-4 border-b pb-2 flex items-center">
                    <i class="fa-solid fa-money-bill-trend-up mr-2 text-green-500"></i> Tarifas de Bonificación (M²)
                </h3>
                <form id="bonification-config-form" class="space-y-6">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
                            <div class="text-center mb-3">
                                <span class="bg-gray-200 text-gray-700 px-2 py-1 rounded text-xs font-bold uppercase">Principiante</span>
                            </div>
                            <div class="space-y-3">
                                <div>
                                    <label class="block text-xs text-gray-500 mb-1">A Tiempo</label>
                                    <input type="text" name="principiante_enTiempo" class="currency-input w-full border border-gray-300 rounded p-2 text-sm text-right font-mono">
                                </div>
                                <div>
                                    <label class="block text-xs text-gray-500 mb-1">Fuera de Tiempo</label>
                                    <input type="text" name="principiante_fueraTiempo" class="currency-input w-full border border-gray-300 rounded p-2 text-sm text-right font-mono text-red-600">
                                </div>
                            </div>
                        </div>
                        <div class="bg-blue-50 p-4 rounded-lg border border-blue-100">
                            <div class="text-center mb-3">
                                <span class="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold uppercase">Intermedio</span>
                            </div>
                            <div class="space-y-3">
                                <div>
                                    <label class="block text-xs text-blue-700 mb-1">A Tiempo</label>
                                    <input type="text" name="intermedio_enTiempo" class="currency-input w-full border border-blue-200 rounded p-2 text-sm text-right font-mono">
                                </div>
                                <div>
                                    <label class="block text-xs text-blue-700 mb-1">Fuera de Tiempo</label>
                                    <input type="text" name="intermedio_fueraTiempo" class="currency-input w-full border border-blue-200 rounded p-2 text-sm text-right font-mono text-red-600">
                                </div>
                            </div>
                        </div>
                        <div class="bg-purple-50 p-4 rounded-lg border border-purple-100">
                            <div class="text-center mb-3">
                                <span class="bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs font-bold uppercase">Avanzado</span>
                            </div>
                            <div class="space-y-3">
                                <div>
                                    <label class="block text-xs text-purple-700 mb-1">A Tiempo</label>
                                    <input type="text" name="avanzado_enTiempo" class="currency-input w-full border border-purple-200 rounded p-2 text-sm text-right font-mono">
                                </div>
                                <div>
                                    <label class="block text-xs text-purple-700 mb-1">Fuera de Tiempo</label>
                                    <input type="text" name="avanzado_fueraTiempo" class="currency-input w-full border border-purple-200 rounded p-2 text-sm text-right font-mono text-red-600">
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="text-right">
                        <button type="submit" class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded shadow transition-colors">
                            Actualizar Tarifas
                        </button>
                    </div>
                </form>
            </div>

            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 class="text-lg font-bold text-gray-700 mb-4 border-b pb-2 flex items-center">
                    <i class="fa-solid fa-file-invoice-dollar mr-2 text-blue-600"></i> Parámetros de Nómina
                </h3>
                <form id="payroll-config-form" class="space-y-6">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Salario Mínimo (SMLV)</label>
                            <input type="text" name="salarioMinimo" class="currency-input w-full border border-gray-300 rounded p-2.5 font-bold text-gray-800">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Auxilio de Transporte</label>
                            <input type="text" name="auxilioTransporte" class="currency-input w-full border border-gray-300 rounded p-2.5 font-bold text-gray-800">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Multiplicador Hora Extra</label>
                            <input type="number" name="multiplicadorHoraExtra" step="0.01" class="w-full border border-gray-300 rounded p-2.5" value="1.25">
                        </div>
                         <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Tope Aux. Transporte (SMLV)</label>
                            <input type="number" name="limiteAuxilioTransporte" step="0.1" class="w-full border border-gray-300 rounded p-2.5" value="2">
                        </div>
                         <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Aporte Salud (%)</label>
                            <input type="number" name="porcentajeSalud" step="0.1" class="w-full border border-gray-300 rounded p-2.5" value="4">
                        </div>
                         <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Aporte Pensión (%)</label>
                            <input type="number" name="porcentajePension" step="0.1" class="w-full border border-gray-300 rounded p-2.5" value="4">
                        </div>
                    </div>
                    <div class="text-right">
                        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow transition-colors">
                            Guardar Parámetros
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;

    const generalForm = document.getElementById('general-config-form');
    const bonificationForm = document.getElementById('bonification-config-form');
    const payrollForm = document.getElementById('payroll-config-form');
    
    // --- 3. CARGA DE DATOS ---
    try {
        // A. General
        const generalRef = doc(_db, "system", "generalConfig");
        const generalSnap = await getDoc(generalRef);
        if (generalSnap.exists()) {
            const data = generalSnap.data();
            if (data.empresa) {
                generalForm.elements.empresaNombre.value = data.empresa.nombre || '';
                generalForm.elements.empresaNIT.value = data.empresa.nit || '';
                generalForm.elements.empresaGerente.value = data.empresa.gerente || '';
                generalForm.elements.empresaFirmaURL.value = data.empresa.firmaGerenteURL || ''; // <--- Carga Firma
                generalForm.elements.empresaDireccion.value = data.empresa.direccion || '';
                generalForm.elements.empresaTelefono.value = data.empresa.telefono || '';
                generalForm.elements.empresaEmail.value = data.empresa.email || '';
                generalForm.elements.empresaLogoURL.value = data.empresa.logoURL || '';
            }
            if (data.alertas) {
                generalForm.elements.diasAlertaSST.value = data.alertas.diasVencimientoSST || 45;
                generalForm.elements.diasAlertaHerramienta.value = data.alertas.diasMantenimiento || 30;
            }
        }

        // B. Bonificaciones
        const bonificationRef = doc(_db, "system", "bonificationConfig");
        const bonificationSnap = await getDoc(bonificationRef);
        if (bonificationSnap.exists()) {
            const data = bonificationSnap.data();
            bonificationForm.elements.principiante_enTiempo.value = fmt(data.principiante?.valorM2EnTiempo);
            bonificationForm.elements.principiante_fueraTiempo.value = fmt(data.principiante?.valorM2FueraDeTiempo);
            bonificationForm.elements.intermedio_enTiempo.value = fmt(data.intermedio?.valorM2EnTiempo);
            bonificationForm.elements.intermedio_fueraTiempo.value = fmt(data.intermedio?.valorM2FueraDeTiempo);
            bonificationForm.elements.avanzado_enTiempo.value = fmt(data.avanzado?.valorM2EnTiempo);
            bonificationForm.elements.avanzado_fueraTiempo.value = fmt(data.avanzado?.valorM2FueraDeTiempo);
        }

        // C. Nómina
        const payrollRef = doc(_db, "system", "payrollConfig");
        const payrollSnap = await getDoc(payrollRef);
        if (payrollSnap.exists()) {
            const data = payrollSnap.data();
            payrollForm.elements.salarioMinimo.value = fmt(data.salarioMinimo);
            payrollForm.elements.auxilioTransporte.value = fmt(data.auxilioTransporte);
            payrollForm.elements.limiteAuxilioTransporte.value = data.limiteAuxilioTransporte || 2;
            payrollForm.elements.multiplicadorHoraExtra.value = data.multiplicadorHoraExtra || 1.25;
            payrollForm.elements.porcentajeSalud.value = data.porcentajeSalud || 4;
            payrollForm.elements.porcentajePension.value = data.porcentajePension || 4;
        }
    } catch (e) {
        console.error("Error cargando config:", e);
    }

    // --- 4. LISTENERS ---
    if (_setupCurrencyInput) {
        document.querySelectorAll('#configuracion-view .currency-input').forEach(_setupCurrencyInput);
    }

    generalForm.addEventListener('submit', handleSaveGeneralConfig);
    bonificationForm.addEventListener('submit', handleSaveBonificationConfig);
    payrollForm.addEventListener('submit', handleSavePayrollConfig);
}

// --- FUNCIÓN DE GUARDADO GENERAL ACTUALIZADA ---
async function handleSaveGeneralConfig(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;
    btn.disabled = true; btn.innerText = "Guardando...";

    try {
        const formData = new FormData(e.target);
        
        const configData = {
            empresa: {
                nombre: formData.get('empresaNombre'),
                nit: formData.get('empresaNIT'),
                gerente: formData.get('empresaGerente'),
                firmaGerenteURL: formData.get('empresaFirmaURL'), // <--- Guarda Firma
                direccion: formData.get('empresaDireccion'),
                telefono: formData.get('empresaTelefono'),
                email: formData.get('empresaEmail'),
                logoURL: formData.get('empresaLogoURL')
            },
            alertas: {
                diasVencimientoSST: parseInt(formData.get('diasAlertaSST')),
                diasMantenimiento: parseInt(formData.get('diasAlertaHerramienta'))
            }
        };

        await setDoc(doc(_db, "system", "generalConfig"), configData, { merge: true });
        if (window.showToast) window.showToast("Configuración general actualizada.", "success");
        else alert("Guardado correctamente");

    } catch (error) {
        console.error(error);
        alert("Error al guardar.");
    } finally {
        btn.disabled = false; btn.innerText = originalText;
    }
}
// --- Funciones Existentes (Sin cambios lógicos mayores) ---

async function handleSaveBonificationConfig(e) {
    e.preventDefault();
    const form = e.target;
    try {
        const configData = {
            principiante: {
                valorM2EnTiempo: parseCurrency(form.elements.principiante_enTiempo.value),
                valorM2FueraDeTiempo: parseCurrency(form.elements.principiante_fueraTiempo.value)
            },
            intermedio: {
                valorM2EnTiempo: parseCurrency(form.elements.intermedio_enTiempo.value),
                valorM2FueraDeTiempo: parseCurrency(form.elements.intermedio_fueraTiempo.value)
            },
            avanzado: {
                valorM2EnTiempo: parseCurrency(form.elements.avanzado_enTiempo.value),
                valorM2FueraDeTiempo: parseCurrency(form.elements.avanzado_fueraTiempo.value)
            }
        };
        await setDoc(doc(_db, "system", "bonificationConfig"), configData);
        alert("¡Tarifas guardadas!");
    } catch (error) { console.error(error); alert("Error al guardar."); }
}

async function handleSavePayrollConfig(e) {
    e.preventDefault();
    const form = e.target;
    try {
        const configData = {
            salarioMinimo: parseCurrency(form.elements.salarioMinimo.value),
            auxilioTransporte: parseCurrency(form.elements.auxilioTransporte.value),
            limiteAuxilioTransporte: parseFloat(form.elements.limiteAuxilioTransporte.value) || 2,
            multiplicadorHoraExtra: parseFloat(form.elements.multiplicadorHoraExtra.value) || 1.25,
            porcentajeSalud: parseFloat(form.elements.porcentajeSalud.value) || 4,
            porcentajePension: parseFloat(form.elements.porcentajePension.value) || 4,
        };
        await setDoc(doc(_db, "system", "payrollConfig"), configData);
        alert("¡Variables de nómina guardadas!");
    } catch (error) { console.error(error); alert("Error al guardar."); }
}

function parseCurrency(currencyString) {
    return parseFloat(currencyString.replace(/[$. ]/g, '')) || 0;
}

function formatAsCurrency(number) {
    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
    return currencyFormatter.format(number || 0);
}