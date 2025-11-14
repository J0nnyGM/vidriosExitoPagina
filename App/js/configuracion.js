import {
    doc,
    getDoc,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// --- Variables del Módulo (Dependencias de app.js) ---
let _db;
let _setupCurrencyInput; // Función de app.js para formatear moneda

/**
 * Inicializa el módulo de Configuración.
 */
export function initConfiguracion(db, setupCurrencyInput) {
    _db = db;
    _setupCurrencyInput = setupCurrencyInput;
}

/**
 * Carga la vista de Configuración.
 * Carga los datos de Firestore y los pone en los formularios.
 */
export async function loadConfiguracionView() {
    const bonificationForm = document.getElementById('bonification-config-form');
    const payrollForm = document.getElementById('payroll-config-form');

    if (!bonificationForm || !payrollForm) return;

    // Aplicar formato de moneda a todos los campos
    document.querySelectorAll('#configuracion-view .currency-input').forEach(_setupCurrencyInput);

    try {
        // 1. Cargar Configuración de Bonificaciones
        const bonificationRef = doc(_db, "system", "bonificationConfig");
        const bonificationSnap = await getDoc(bonificationRef);
        if (bonificationSnap.exists()) {
            const data = bonificationSnap.data();
            // Llenar el formulario (con formato de moneda)
            bonificationForm.elements.principiante_enTiempo.value = formatAsCurrency(data.principiante.valorM2EnTiempo);
            bonificationForm.elements.principiante_fueraTiempo.value = formatAsCurrency(data.principiante.valorM2FueraDeTiempo);
            bonificationForm.elements.intermedio_enTiempo.value = formatAsCurrency(data.intermedio.valorM2EnTiempo);
            bonificationForm.elements.intermedio_fueraTiempo.value = formatAsCurrency(data.intermedio.valorM2FueraDeTiempo);
            bonificationForm.elements.avanzado_enTiempo.value = formatAsCurrency(data.avanzado.valorM2EnTiempo);
            bonificationForm.elements.avanzado_fueraTiempo.value = formatAsCurrency(data.avanzado.valorM2FueraDeTiempo);
        }

        // 2. Cargar Configuración de Nómina
        const payrollRef = doc(_db, "system", "payrollConfig");
        const payrollSnap = await getDoc(payrollRef);
        if (payrollSnap.exists()) {
            const data = payrollSnap.data();
            // Llenar el formulario (números y moneda)
            payrollForm.elements.salarioMinimo.value = formatAsCurrency(data.salarioMinimo);
            payrollForm.elements.auxilioTransporte.value = formatAsCurrency(data.auxilioTransporte);
            payrollForm.elements.limiteAuxilioTransporte.value = data.limiteAuxilioTransporte || 2;
            payrollForm.elements.multiplicadorHoraExtra.value = data.multiplicadorHoraExtra || 1.25;
            payrollForm.elements.porcentajeSalud.value = data.porcentajeSalud || 4;
            payrollForm.elements.porcentajePension.value = data.porcentajePension || 4;
            // payrollForm.elements.baseDeduccion.value = data.baseDeduccion || 'basico';
        }

    } catch (error) {
        console.error("Error al cargar la configuración:", error);
        alert("No se pudo cargar la configuración existente.");
    }

    // 3. Configurar los listeners de guardado (asegurándonos de que solo se añadan una vez)
    // Usamos .replaceWith(.cloneNode(true)) para limpiar listeners antiguos
    const newBonificationForm = bonificationForm.cloneNode(true);
    bonificationForm.parentNode.replaceChild(newBonificationForm, bonificationForm);
    newBonificationForm.addEventListener('submit', handleSaveBonificationConfig);
    
    const newPayrollForm = payrollForm.cloneNode(true);
    payrollForm.parentNode.replaceChild(newPayrollForm, payrollForm);
    newPayrollForm.addEventListener('submit', handleSavePayrollConfig);
    
    // Volver a aplicar el formato de moneda a los campos clonados
    document.querySelectorAll('#configuracion-view .currency-input').forEach(_setupCurrencyInput);
}

/**
 * Maneja el guardado de la configuración de bonificaciones.
 */
async function handleSaveBonificationConfig(e) {
    e.preventDefault();
    const form = e.target;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;

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

        const configRef = doc(_db, "system", "bonificationConfig");
        await setDoc(configRef, configData); // setDoc sobrescribe
        
        alert("¡Tarifas de bonificación guardadas!");

    } catch (error) {
        console.error("Error al guardar tarifas de bonificación:", error);
        alert("Error al guardar las tarifas.");
    } finally {
        button.disabled = false;
    }
}

/**
 * Maneja el guardado de la configuración de nómina.
 */
async function handleSavePayrollConfig(e) {
    e.preventDefault();
    const form = e.target;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;

    try {
        const configData = {
            salarioMinimo: parseCurrency(form.elements.salarioMinimo.value),
            auxilioTransporte: parseCurrency(form.elements.auxilioTransporte.value),
            limiteAuxilioTransporte: parseFloat(form.elements.limiteAuxilioTransporte.value) || 2,
            multiplicadorHoraExtra: parseFloat(form.elements.multiplicadorHoraExtra.value) || 1.25,
            porcentajeSalud: parseFloat(form.elements.porcentajeSalud.value) || 4,
            porcentajePension: parseFloat(form.elements.porcentajePension.value) || 4,
            // baseDeduccion: form.elements.baseDeduccion.value
        };
        
        const configRef = doc(_db, "system", "payrollConfig");
        await setDoc(configRef, configData); // setDoc sobrescribe

        alert("¡Variables de nómina guardadas!");

    } catch (error) {
        console.error("Error al guardar variables de nómina:", error);
        alert("Error al guardar las variables.");
    } finally {
        button.disabled = false;
    }
}

// --- Funciones auxiliares (podrían moverse a un 'utils.js' global) ---

/**
 * Limpia un string de moneda (ej. "$ 1.300.000") y lo convierte en número.
 * @param {string} currencyString - El string formateado.
 * @returns {number}
 */
function parseCurrency(currencyString) {
    return parseFloat(currencyString.replace(/[$. ]/g, '')) || 0;
}

/**
 * Formatea un número como moneda COP.
 * @param {number} number - El número.
 * @returns {string}
 */
function formatAsCurrency(number) {
    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
    return currencyFormatter.format(number || 0);
}