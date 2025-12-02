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
    const generalForm = document.getElementById('general-config-form'); // <--- NUEVO
    const bonificationForm = document.getElementById('bonification-config-form');
    const payrollForm = document.getElementById('payroll-config-form');

    if (!bonificationForm || !payrollForm) return;

    // Formato moneda
    document.querySelectorAll('#configuracion-view .currency-input').forEach(_setupCurrencyInput);

    try {
        // 1. NUEVO: Cargar Configuración General (Empresa y Alertas)
        if (generalForm) {
            const generalRef = doc(_db, "system", "generalConfig");
            const generalSnap = await getDoc(generalRef);
            
            if (generalSnap.exists()) {
                const data = generalSnap.data();
                // Empresa
                if (data.empresa) {
                    generalForm.elements.empresaNombre.value = data.empresa.nombre || '';
                    generalForm.elements.empresaNIT.value = data.empresa.nit || '';
                    generalForm.elements.empresaLogoURL.value = data.empresa.logoURL || '';
                }
                // Alertas
                if (data.alertas) {
                    generalForm.elements.diasAlertaSST.value = data.alertas.diasVencimientoSST || 45;
                    generalForm.elements.diasAlertaHerramienta.value = data.alertas.diasMantenimiento || 30;
                }
            }
        }

        // 2. Cargar Configuración de Bonificaciones
        const bonificationRef = doc(_db, "system", "bonificationConfig");
        const bonificationSnap = await getDoc(bonificationRef);
        if (bonificationSnap.exists()) {
            const data = bonificationSnap.data();
            bonificationForm.elements.principiante_enTiempo.value = formatAsCurrency(data.principiante?.valorM2EnTiempo);
            bonificationForm.elements.principiante_fueraTiempo.value = formatAsCurrency(data.principiante?.valorM2FueraDeTiempo);
            bonificationForm.elements.intermedio_enTiempo.value = formatAsCurrency(data.intermedio?.valorM2EnTiempo);
            bonificationForm.elements.intermedio_fueraTiempo.value = formatAsCurrency(data.intermedio?.valorM2FueraDeTiempo);
            bonificationForm.elements.avanzado_enTiempo.value = formatAsCurrency(data.avanzado?.valorM2EnTiempo);
            bonificationForm.elements.avanzado_fueraTiempo.value = formatAsCurrency(data.avanzado?.valorM2FueraDeTiempo);
        }

        // 3. Cargar Configuración de Nómina
        const payrollRef = doc(_db, "system", "payrollConfig");
        const payrollSnap = await getDoc(payrollRef);
        if (payrollSnap.exists()) {
            const data = payrollSnap.data();
            payrollForm.elements.salarioMinimo.value = formatAsCurrency(data.salarioMinimo);
            payrollForm.elements.auxilioTransporte.value = formatAsCurrency(data.auxilioTransporte);
            payrollForm.elements.limiteAuxilioTransporte.value = data.limiteAuxilioTransporte || 2;
            payrollForm.elements.multiplicadorHoraExtra.value = data.multiplicadorHoraExtra || 1.25;
            payrollForm.elements.porcentajeSalud.value = data.porcentajeSalud || 4;
            payrollForm.elements.porcentajePension.value = data.porcentajePension || 4;
        }

    } catch (error) {
        console.error("Error al cargar la configuración:", error);
    }

    // 4. Configurar listeners (Clonando para limpiar eventos previos)
    
    // Listener General (NUEVO)
    if (generalForm) {
        const newGeneralForm = generalForm.cloneNode(true);
        generalForm.parentNode.replaceChild(newGeneralForm, generalForm);
        newGeneralForm.addEventListener('submit', handleSaveGeneralConfig);
    }

    // Listener Bonificaciones
    const newBonificationForm = bonificationForm.cloneNode(true);
    bonificationForm.parentNode.replaceChild(newBonificationForm, bonificationForm);
    newBonificationForm.addEventListener('submit', handleSaveBonificationConfig);
    
    // Listener Nómina
    const newPayrollForm = payrollForm.cloneNode(true);
    payrollForm.parentNode.replaceChild(newPayrollForm, payrollForm);
    newPayrollForm.addEventListener('submit', handleSavePayrollConfig);
    
    document.querySelectorAll('#configuracion-view .currency-input').forEach(_setupCurrencyInput);
}

/**
 * NUEVO: Maneja el guardado de datos de Empresa y Alertas.
 */
async function handleSaveGeneralConfig(e) {
    e.preventDefault();
    const form = e.target;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Guardando...";

    try {
        const configData = {
            empresa: {
                nombre: form.elements.empresaNombre.value.trim(),
                nit: form.elements.empresaNIT.value.trim(),
                logoURL: form.elements.empresaLogoURL.value.trim()
            },
            alertas: {
                diasVencimientoSST: parseInt(form.elements.diasAlertaSST.value) || 45,
                diasMantenimiento: parseInt(form.elements.diasAlertaHerramienta.value) || 30
            }
        };

        const configRef = doc(_db, "system", "generalConfig");
        await setDoc(configRef, configData, { merge: true }); // Merge para no borrar otros datos futuros
        
        alert("¡Configuración general actualizada!");

    } catch (error) {
        console.error("Error:", error);
        alert("Error al guardar.");
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i> Guardar Configuración General';
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