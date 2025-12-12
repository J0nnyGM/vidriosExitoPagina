import {
    collection, query, where, getDocs, orderBy, onSnapshot, doc, getDoc,
    addDoc, serverTimestamp, updateDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { 
    getStorage, ref, uploadBytes, getDownloadURL 
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

// --- Variables Globales ---
let _db, _showView, _currentUser, _storage;
let unsubscribeCotizaciones = null;
let _currencyFormatter;
let cotizacionEditandoId = null;
let empresaInfo = null; // <--- NUEVA VARIABLE PARA DATOS DE EMPRESA

// Configuración por defecto
let currentConfig = {
    modo: 'MIXTO',
    columnas: ['item', 'ubicacion', 'descripcion', 'ancho', 'alto', 'm2', 'cantidad', 'valor_unitario', 'total_global'],
    aiu: { admin: 10, imprev: 5, util: 5 },
    split: { sum: 85, inst: 15 },
    terminos: { pago: '50% Anticipo', validez: '15 Días', entrega: 'A convenir', notas: '' }
};

// =============================================================================
// 1. INICIALIZADOR
// =============================================================================
export function initCotizaciones(db, storage, showView, currentUser) {
    console.log("--> [Cotizaciones] Inicializando vFinal PDF...");
    _db = db;
    _storage = storage; // <--- Guárdalo
    _showView = showView;
    _currentUser = currentUser;

    _currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0 // <--- AGREGA ESTO para forzar 0 decimales
    });

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.id === 'btn-nueva-cotizacion') {
            e.preventDefault();
            abrirModalConfiguracion();
        }
        else if (btn.id === 'btn-exportar-pdf') { // <--- NUEVO LISTENER
            generarPDF();
        }
        else if (btn.id === 'btn-cerrar-config' || btn.id === 'btn-cancelar-config') {
            cerrarModalConfiguracion();
        }
        else if (btn.id === 'btn-iniciar-cotizacion') {
            aplicarConfiguracionEIniciar();
            refrescarTablaItems(); // <--- ¡Esto hace la magia!
        }
        else if (btn.id === 'btn-volver-cotizacion' || btn.id === 'btn-cancelar-cotizacion') {
            cerrarVistaDetalle();
        }
        else if (btn.id === 'btn-agregar-item-cot') {
            agregarFilaItem();
        }
        else if (btn.id === 'btn-editar-config-header') {
            abrirModalConfiguracion(true);
        }
        else if (btn.classList.contains('btn-remove')) {
            btn.closest('tr').remove();
            calcularTotalesGenerales();
        }
        else if (btn.classList.contains('btn-edit')) {
            // Edición gestionada en tabla
        }
    });

    cargarDatosEmpresa(); // <--- AGREGAR ESTA LÍNEA AQUÍ

    // Delegación Inputs
    const container = document.getElementById('cotizacion-detalle-view');
    if (container) {
        container.addEventListener('input', (e) => {
            const t = e.target;
            if (t.classList.contains('inputs-calc')) {
                const tr = t.closest('tr');
                if (tr) calcularFila(tr, t);
            }
            else if (t.id === 'cot-modo' || t.id.startsWith('conf-') || t.id.startsWith('cot-')) {
                if (t.id === 'cot-modo') actualizarVisibilidadSegunModo();
                recalcularTodo();
            }
        });
    }

    const form = document.getElementById('form-cotizacion');
    if (form) form.onsubmit = guardarCotizacion;

    // --- LÓGICA BOTÓN ATRÁS DEL NAVEGADOR ---
    window.addEventListener('popstate', function(event) {
        // Identifica tus vistas (Ajusta los IDs si son diferentes)
        const viewEditor = document.getElementById('nueva-cotizacion-view'); // El formulario
        const viewLista = document.getElementById('cotizaciones-view');      // La tabla de lista

        // Si estamos viendo el editor, volvemos a la lista
        if (viewEditor && !viewEditor.classList.contains('hidden')) {
            // Ocultar editor
            viewEditor.classList.add('hidden');
            // Mostrar lista
            viewLista.classList.remove('hidden');
            
            // Opcional: Si tienes una función para limpiar el form, llámala aquí
            // limpiarFormulario();
        }
    });

    // AGREGA ESTE LISTENER PARA EL INPUT DE ARCHIVOS (Lo crearemos más adelante)
    document.addEventListener('change', (e) => {
        if(e.target && e.target.id === 'input-adjuntos-cot') {
            manejarSeleccionArchivos(e.target.files);
        }
    });

}

// --- NUEVO: Lógica de Ortografía y Tipo Oración ---

const container = document.getElementById('items-container');

if (container) {
    // Usamos 'focusout' (cuando te sales de la casilla)
    container.addEventListener('focusout', function (e) {

        // Verificamos si el elemento es la descripción
        if (e.target && e.target.name === 'descripcion') {
            let texto = e.target.value;

            if (texto && texto.length > 0) {
                // 1. Convertir a Tipo Oración (Primera Mayúscula, resto igual)
                // Nota: Usamos slice(1) sin toLowerCase() para respetar siglas como "Vidrio TEMPLADO"
                // Si quieres forzar todo minuscula excepto la primera, agrega .toLowerCase() al final.
                const textoCorregido = texto.charAt(0).toUpperCase() + texto.slice(1);

                // Solo actualizamos si cambió algo
                if (texto !== textoCorregido) {
                    e.target.value = textoCorregido;
                }
            }
        }
    });

    // Opcional: Asegurar que todos los inputs tengan corrector activado
    // Esto sirve si no quieres buscar la función agregarFilaItem manualmnete
    container.addEventListener('mouseover', function (e) {
        if (e.target && e.target.name === 'descripcion') {
            e.target.setAttribute('spellcheck', 'true');
            e.target.setAttribute('lang', 'es');
        }
    });
}

// =============================================================================
// 2. LÓGICA DE CÁLCULO
// =============================================================================

function recalcularTodo() {
    document.querySelectorAll('#items-container tr').forEach(tr => {
        calcularFila(tr, null, true);
    });
    calcularTotalesGenerales();
}

function calcularFila(tr, inputChanged = null, skipTotals = false) {
    const getVal = (n) => parseFloat(tr.querySelector(`[name="${n}"]`)?.value) || 0;
    
    const setVal = (n, v) => { 
        const el = tr.querySelector(`[name="${n}"]`); 
        if(el) {
            // Redondeo para evitar decimales en los inputs visuales
            const valorSeguro = isNaN(v) ? 0 : Math.round(v);
            el.value = valorSeguro; 
        }
    };

    // Factores de Impuestos
    const { modo, aiu } = currentConfig;
    const factorIVA = 1.19; 
    const factorAIU = 1 + (aiu.admin/100) + (aiu.imprev/100) + (aiu.util/100) + ((aiu.util/100)*0.19);

    // --- 1. Lógica de Desglose (Solo aplica en Modo Mixto) ---
    // Si cambio el Unitario Global, reparto y quito impuestos para llenar Suministro/Instalación
    if (currentConfig.columnas.includes('suministro') && currentConfig.columnas.includes('instalacion')) {
        if (inputChanged && inputChanged.name === 'valor_unitario') {
            const vUnitarioBruto = getVal('valor_unitario');
            const split = currentConfig.split || { sum: 85, inst: 15 };
            
            const brutoSum = vUnitarioBruto * (split.sum / 100);
            const brutoInst = vUnitarioBruto * (split.inst / 100);
            
            // Convertir a Base
            const baseSum = brutoSum / factorIVA;
            let baseInst = (modo === 'MIXTO' || modo === 'AIU') ? (brutoInst / factorAIU) : (brutoInst / factorIVA);

            setVal('val_suministro', baseSum); 
            setVal('val_instalacion', baseInst);
        }
        else if (inputChanged && (inputChanged.name === 'val_suministro' || inputChanged.name === 'val_instalacion')) {
            const baseSum = getVal('val_suministro');
            const baseInst = getVal('val_instalacion');
            
            // Convertir a Bruto para sumar al unitario global
            const brutoSum = baseSum * factorIVA;
            let brutoInst = (modo === 'MIXTO' || modo === 'AIU') ? (baseInst * factorAIU) : (baseInst * factorIVA);

            setVal('valor_unitario', brutoSum + brutoInst);
        }
    }

    // --- 2. Cálculos de la Fila ---
    const ancho = getVal('ancho');
    const alto = getVal('alto');
    const cant = getVal('cantidad') || 1;
    
    let m2Unit = 0;
    if (ancho > 0 && alto > 0) m2Unit = ancho * alto;
    
    if(tr.querySelector('[name="m2"]')) tr.querySelector('[name="m2"]').value = m2Unit.toFixed(2);
    if(tr.querySelector('[name="total_m2"]')) tr.querySelector('[name="total_m2"]').value = (m2Unit * cant).toFixed(2);
    
    const factor = (m2Unit > 0) ? (m2Unit * cant) : cant;

    // Variables para guardar las BASES (Valores sin impuestos)
    let totalBaseSumFila = 0;
    let totalBaseInstFila = 0;

    if (modo === 'MIXTO') {
        // En mixto, los inputs SUM/INST ya son BASES (limpios)
        totalBaseSumFila = getVal('val_suministro') * factor;
        totalBaseInstFila = getVal('val_instalacion') * factor;
    } 
    else if (modo === 'AIU') {
        // En AIU, el input 'valor_unitario' es BRUTO (con impuestos)
        const unitarioBruto = getVal('valor_unitario');
        const totalBruto = unitarioBruto * factor;
        
        // Descontamos factor AIU para obtener la Base
        totalBaseInstFila = totalBruto / factorAIU; 
        totalBaseSumFila = 0;
    }
    else { 
        // IVA GLOBAL (Modo Simple por defecto)
        // El input 'valor_unitario' es BRUTO (con IVA)
        const unitarioBruto = getVal('valor_unitario'); 
        const totalBruto = unitarioBruto * factor;
        
        // Descontamos 1.19 para obtener la Base
        totalBaseSumFila = totalBruto / factorIVA;
        totalBaseInstFila = 0;
    }

    // --- 3. ACTUALIZAR UI ---
    const disp = tr.querySelector('.display-total');
    if (disp) {
        // Validación de seguridad para no mostrar NaN
        const safeBaseSum = isNaN(totalBaseSumFila) ? 0 : totalBaseSumFila;
        const safeBaseInst = isNaN(totalBaseInstFila) ? 0 : totalBaseInstFila;
        
        // CAMBIO CLAVE: Mostramos la suma de las BASES (Sin impuestos)
        const totalBaseVisual = safeBaseSum + safeBaseInst;
        
        disp.textContent = _currencyFormatter.format(totalBaseVisual);
        
        // Guardamos en dataset para que el Total General sume bases primero
        disp.dataset.baseSum = safeBaseSum;
        disp.dataset.baseInst = safeBaseInst;
    }

    if (!skipTotals) {
        calcularTotalesGenerales();
    }
}

function calcularTotalesGenerales() {
    let totalBaseSum = 0;
    let totalBaseInst = 0;

    document.querySelectorAll('#items-container tr').forEach(tr => {
        const disp = tr.querySelector('.display-total');
        if (disp) {
            totalBaseSum += parseFloat(disp.dataset.baseSum) || 0;
            totalBaseInst += parseFloat(disp.dataset.baseInst) || 0;
        }
    });

    const { modo, aiu } = currentConfig;
    const bodyResumen = document.getElementById('resumen-financiero-body');
    let data = { totalFinal: 0 };

    if (modo === 'IVA_GLOBAL') {
        const subtotal = totalBaseSum;
        const iva = subtotal * 0.19;
        data.totalFinal = subtotal + iva;
        data.html = `
            <div class="flex justify-between"><span>Subtotal Base:</span> <span class="font-medium">${_currencyFormatter.format(subtotal)}</span></div>
            <div class="flex justify-between text-slate-500"><span>IVA (19%):</span> <span>${_currencyFormatter.format(iva)}</span></div>
        `;
        data.breakdown = { subtotal, iva };
    }
    else if (modo === 'AIU') {
        const directo = totalBaseInst;
        const vAdmin = directo * (aiu.admin / 100);
        const vImpr = directo * (aiu.imprev / 100);
        const vUtil = directo * (aiu.util / 100);
        const vIvaUtil = vUtil * 0.19;
        data.totalFinal = directo + vAdmin + vImpr + vUtil + vIvaUtil;

        data.html = `
            <div class="flex justify-between"><span>SUB TOTAL:</span> <span class="font-medium">${_currencyFormatter.format(directo)}</span></div>
            <div class="flex justify-between text-xs text-slate-500"><span>Admin ${aiu.admin}%:</span> <span>${_currencyFormatter.format(vAdmin)}</span></div>
            <div class="flex justify-between text-xs text-slate-500"><span>Imprev ${aiu.imprev}%:</span> <span>${_currencyFormatter.format(vImpr)}</span></div>
            <div class="flex justify-between text-xs text-slate-500"><span>Util ${aiu.util}%:</span> <span>${_currencyFormatter.format(vUtil)}</span></div>
            <div class="flex justify-between border-t border-dashed mt-1 pt-1 text-slate-600"><span>IVA s/Util:</span> <span>${_currencyFormatter.format(vIvaUtil)}</span></div>
        `;
        data.breakdown = { directo, vAdmin, vImpr, vUtil, vIvaUtil };
    }
    else if (modo === 'MIXTO') {
        const ivaSum = totalBaseSum * 0.19;
        const totalParteSum = totalBaseSum + ivaSum;

        const directo = totalBaseInst;
        const vAdmin = directo * (aiu.admin / 100);
        const vImpr = directo * (aiu.imprev / 100);
        const vUtil = directo * (aiu.util / 100);
        const vIvaInst = vUtil * 0.19;
        const totalParteInst = directo + vAdmin + vImpr + vUtil + vIvaInst;

        data.totalFinal = totalParteSum + totalParteInst;

        data.html = `
            <div class="flex justify-between text-blue-700"><span>Base Suministro:</span> <span class="font-bold">${_currencyFormatter.format(totalBaseSum)}</span></div>
            <div class="flex justify-between text-xs text-blue-400 mb-2"><span>IVA Sum (19%):</span> <span>${_currencyFormatter.format(ivaSum)}</span></div>
            
            <div class="flex justify-between text-emerald-700 border-t border-dashed pt-2"><span>Base Instalación:</span> <span class="font-bold">${_currencyFormatter.format(directo)}</span></div>
            <div class="flex justify-between text-xs text-emerald-600"><span>AIU Inst (${aiu.admin + aiu.imprev + aiu.util}%):</span> <span>${_currencyFormatter.format(vAdmin + vImpr + vUtil)}</span></div>
            <div class="flex justify-between text-xs text-emerald-600"><span>IVA Inst (s/Util):</span> <span>${_currencyFormatter.format(vIvaInst)}</span></div>
        `;
        data.breakdown = { totalBaseSum, ivaSum, directo, vAdmin, vImpr, vUtil, vIvaInst };
    }

    if (bodyResumen) bodyResumen.innerHTML = data.html;
    const displayTotal = document.getElementById('display-total-final');
    if (displayTotal) displayTotal.textContent = _currencyFormatter.format(data.totalFinal);

    return data;
}


// =============================================================================
// 3. GENERACIÓN DE PDF
// =============================================================================

const getBase64ImageFromURL = (url) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = url;
        img.onload = () => {
            const canvas = document.createElement("canvas");
            // Mantener proporción pero limitar tamaño para calidad
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => resolve(null);
    });
};


async function generarPDF(datosExternos = null) {
    if (!empresaInfo) await cargarDatosEmpresa();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'letter');

    // --- CONFIGURACIÓN DE DIMENSIONES ---
    const PAGE_WIDTH = doc.internal.pageSize.width;
    const PAGE_HEIGHT = doc.internal.pageSize.height;
    const MARGIN_LEFT = 30;
    const MARGIN_RIGHT = 20;
    const T_MARGIN_LEFT = 10;
    const T_MARGIN_RIGHT = 10;
    const TABLE_WIDTH = PAGE_WIDTH - T_MARGIN_LEFT - T_MARGIN_RIGHT;

    // --- 0. DETERMINAR FUENTE DE DATOS ---
    const configUsada = datosExternos ? datosExternos.config : currentConfig;

    const leerDato = (idDom, keyObj) => {
        if (datosExternos) return datosExternos[keyObj] || '';
        const el = document.getElementById(idDom);
        return el ? el.value : '';
    };

    doc.setFont("times", "normal");
    let yPos = 10;

    // --- A. ENCABEZADO ---
    const logoW = 85.5;
    const logoH = 30.4;

    if (empresaInfo && empresaInfo.logoURL) {
        try {
            const logoBase64 = await getBase64ImageFromURL(empresaInfo.logoURL);
            if (logoBase64) {
                const logoX = (PAGE_WIDTH - logoW) / 2;
                doc.addImage(logoBase64, 'PNG', logoX, yPos, logoW, logoH);
            }
        } catch (e) { console.warn("Error logo:", e); }
    }
    yPos += logoH + 5;

    // --- B. DATOS CLIENTE ---
    const rawFecha = leerDato('cot-fecha', 'fecha');
    const cliente = leerDato('cot-cliente', 'cliente').toUpperCase();
    const proyecto = leerDato('cot-proyecto', 'proyecto').toUpperCase();

    let fechaTexto = rawFecha;
    if (rawFecha) {
        const parts = rawFecha.split('-');
        if (parts.length === 3) {
            const [year, month, day] = parts;
            const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
            fechaTexto = `${day} de ${meses[parseInt(month) - 1]} de ${year}`;
        }
    }

    doc.setFontSize(11);
    doc.text(`Bogotá D.C, ${fechaTexto}`, MARGIN_LEFT, yPos);
    yPos += 10;

    doc.setFont("times", "bold");
    doc.text("Señores:", MARGIN_LEFT, yPos); yPos += 5;
    doc.text(cliente, MARGIN_LEFT, yPos); yPos += 5;

    doc.setFont("times", "normal");
    if (proyecto) {
        doc.text(`Proyecto: ${proyecto}`, MARGIN_LEFT, yPos); yPos += 5;
    }
    doc.text("Ciudad", MARGIN_LEFT, yPos);
    yPos += 10;

    doc.text("Apreciados Señores", MARGIN_LEFT, yPos);
    yPos += 10;

    const textoProyecto = proyecto ? proyecto : "________________";
    doc.text(`Adjunto cotización según solicitud para el proyecto ${textoProyecto}:`, MARGIN_LEFT, yPos);
    yPos += 8;

    // --- C. TABLA DE ÍTEMS ---
    const configCols = configUsada.columnas;
    const headers = [];
    const bodyData = [];

    const hasSum = configCols.includes('suministro');
    const hasInst = configCols.includes('instalacion');

    // 1. Encabezados
    if (configCols.includes('item')) headers.push('ITEM');
    if (configCols.includes('ubicacion')) headers.push('UBICACIÓN');
    if (configCols.includes('descripcion')) headers.push('DESCRIPCIÓN');
    if (configCols.includes('ancho')) headers.push('ANCHO');
    if (configCols.includes('alto')) headers.push('ALTO');
    if (configCols.includes('m2')) headers.push('M2');
    if (configCols.includes('cantidad')) headers.push('CANT');

    if (hasSum && hasInst) {
        headers.push('VR. SUM');
        headers.push('TOTAL SUM');
        headers.push('VR. INST');
        headers.push('TOTAL INST');
    } else {
        if (configCols.includes('valor_unitario')) headers.push('V. UNIT');
        headers.push('TOTAL');
    }

    // 2. Filas (LÓGICA CORREGIDA PARA SIMPLE Y MIXTO)
    const itemsSource = datosExternos ? datosExternos.items : document.querySelectorAll('#items-container tr');
    const listaItems = datosExternos ? itemsSource : Array.from(itemsSource);
    
    let accumBaseSum = 0;
    let accumBaseInst = 0;

    // Factores de Impuestos
    const factorIVA = 1.19;
    const aiuConf = configUsada.aiu || { admin:10, imprev:5, util:5 };
    const factorAIU = 1 + (aiuConf.admin/100) + (aiuConf.imprev/100) + (aiuConf.util/100) + ((aiuConf.util/100)*0.19);

    listaItems.forEach((itemObj, idx) => {
        const row = [];
        
        const getVal = (name) => {
            if (datosExternos) return itemObj[name] || '';
            return itemObj.querySelector(`[name="${name}"]`)?.value || '';
        };
        const getNum = (name) => parseFloat(getVal(name)) || 0;

        if (!getVal('descripcion')) return;

        // Datos Texto
        if (configCols.includes('item')) row.push(idx + 1);
        if (configCols.includes('ubicacion')) row.push(getVal('ubicacion'));
        if (configCols.includes('descripcion')) row.push(getVal('descripcion'));
        if (configCols.includes('ancho')) row.push(getVal('ancho'));
        if (configCols.includes('alto')) row.push(getVal('alto'));
        if (configCols.includes('m2')) row.push(getVal('m2')); 
        if (configCols.includes('cantidad')) row.push(getVal('cantidad'));

        // --- CÁLCULOS ---
        const cantidad = getNum('cantidad') || 1;
        const cantDivisor = cantidad > 0 ? cantidad : 1;
        const ancho = getNum('ancho');
        const alto = getNum('alto');
        
        let m2UnitarioItem = 0;
        if (ancho > 0 && alto > 0) m2UnitarioItem = ancho * alto;
        const multiplicadorItem = m2UnitarioItem > 0 ? m2UnitarioItem : 1;

        if (hasSum && hasInst) {
            // --- MODO MIXTO ---
            const baseSumInput = getNum('val_suministro');
            const baseInstInput = getNum('val_instalacion');

            const valorItemSum = Math.round(baseSumInput * multiplicadorItem);
            const valorItemInst = Math.round(baseInstInput * multiplicadorItem);

            const totalFilaSum = valorItemSum * cantidad;
            const totalFilaInst = valorItemInst * cantidad;

            accumBaseSum += totalFilaSum;
            accumBaseInst += totalFilaInst;

            row.push(_currencyFormatter.format(valorItemSum));
            row.push(_currencyFormatter.format(totalFilaSum));
            row.push(_currencyFormatter.format(valorItemInst));
            row.push(_currencyFormatter.format(totalFilaInst));

        } else {
            // --- MODO SIMPLE (CORREGIDO: Descontamos Impuestos) ---
            const valUnitInput = getNum('valor_unitario'); // Este input tiene impuestos incluidos
            
            // 1. Calcular el Total Bruto de la fila (con impuestos)
            const totalFilaGross = (valUnitInput * multiplicadorItem) * cantidad;
            
            // 2. Quitar impuestos para obtener el Total BASE (Sin IVA/AIU)
            let totalFilaBase = 0;
            
            if (configUsada.modo === 'AIU') {
                totalFilaBase = totalFilaGross / factorAIU;
                accumBaseInst += totalFilaBase; // Todo a instalación
            } else {
                // IVA Global (Por defecto)
                totalFilaBase = totalFilaGross / factorIVA;
                accumBaseSum += totalFilaBase; // Todo a suministro/subtotal
            }

            // 3. Calcular Unitario BASE (para mostrar en la columna V. Unit)
            const unitBase = totalFilaBase / cantDivisor;

            if (configCols.includes('valor_unitario')) {
                row.push(_currencyFormatter.format(unitBase));
            }
            row.push(_currencyFormatter.format(totalFilaBase));
        }
        bodyData.push(row);
    });

    // 3. Estilos de Columna
    const colStyles = {};
    let colIdx = 0;

    if (configCols.includes('item')) { colStyles[colIdx] = { cellWidth: 9, halign: 'center' }; colIdx++; }
    if (configCols.includes('ubicacion')) { colStyles[colIdx] = { cellWidth: 16, halign: 'center' }; colIdx++; }
    if (configCols.includes('descripcion')) { colStyles[colIdx] = { cellWidth: 'auto', halign: 'center' }; colIdx++; }
    if (configCols.includes('ancho')) { colStyles[colIdx] = { cellWidth: 12, halign: 'center' }; colIdx++; }
    if (configCols.includes('alto')) { colStyles[colIdx] = { cellWidth: 12, halign: 'center' }; colIdx++; }
    if (configCols.includes('m2')) { colStyles[colIdx] = { cellWidth: 11, halign: 'center' }; colIdx++; }
    if (configCols.includes('cantidad')) { colStyles[colIdx] = { cellWidth: 12, halign: 'center' }; colIdx++; }

    const totalCols = headers.length;
    if (hasSum && hasInst) {
        colStyles[totalCols - 4] = { cellWidth: 16, halign: 'center' };
        colStyles[totalCols - 3] = { cellWidth: 22, halign: 'center', fontStyle: 'bold' };
        colStyles[totalCols - 2] = { cellWidth: 23, halign: 'center' };
        colStyles[totalCols - 1] = { cellWidth: 25, halign: 'center', fontStyle: 'bold' };
    } else {
        if (configCols.includes('valor_unitario')) {
            colStyles[totalCols - 2] = { cellWidth: 25, halign: 'center' };
        }
        colStyles[totalCols - 1] = { cellWidth: 25, halign: 'center', fontStyle: 'bold' };
    }

    doc.autoTable({
        startY: yPos,
        head: [headers],
        body: bodyData,
        theme: 'grid',
        styles: {
            font: 'times', fontSize: 6.5, cellPadding: 1.5,
            lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0],
            valign: 'middle'
        },
        headStyles: {
            fillColor: [0, 176, 240], textColor: [0, 0, 0], fontStyle: 'bold',
            halign: 'center', lineWidth: 0.1, lineColor: [0, 0, 0]
        },
        columnStyles: colStyles,
        margin: { left: T_MARGIN_LEFT, right: T_MARGIN_RIGHT, bottom: 35 },
        tableWidth: TABLE_WIDTH 
    });

    let finalY = doc.lastAutoTable.finalY;

    // --- D. CUADRO DE TOTALES ---
    
    // Ahora accumBaseSum es realmente la BASE (Sin IVA), por lo que podemos calcular los impuestos
    // de nuevo sin duplicarlos.
    const bd = {
        totalBaseSum: accumBaseSum,
        directo: accumBaseInst, 
        ivaSum: 0, vAdmin: 0, vImpr: 0, vUtil: 0, vIvaInst: 0, subtotal: 0, iva: 0
    };
    
    const aiu = configUsada.aiu;
    let totalFinalCalc = 0;

    if (configUsada.modo === 'MIXTO') {
        bd.ivaSum = bd.totalBaseSum * 0.19;
        
        bd.vAdmin = bd.directo * (aiu.admin/100);
        bd.vImpr = bd.directo * (aiu.imprev/100);
        bd.vUtil = bd.directo * (aiu.util/100);
        bd.vIvaInst = bd.vUtil * 0.19; 
        
        const totalSum = bd.totalBaseSum + bd.ivaSum;
        const totalInst = bd.directo + bd.vAdmin + bd.vImpr + bd.vUtil + bd.vIvaInst;
        totalFinalCalc = totalSum + totalInst;
    } 
    else if (configUsada.modo === 'AIU') {
        bd.vAdmin = bd.directo * (aiu.admin/100);
        bd.vImpr = bd.directo * (aiu.imprev/100);
        bd.vUtil = bd.directo * (aiu.util/100);
        bd.vIvaUtil = bd.vUtil * 0.19;
        totalFinalCalc = bd.directo + bd.vAdmin + bd.vImpr + bd.vUtil + bd.vIvaUtil;
    } 
    else { // IVA GLOBAL
        // Modo simple: accumBaseSum es el subtotal limpio
        bd.subtotal = accumBaseSum;
        bd.iva = bd.subtotal * 0.19;
        totalFinalCalc = bd.subtotal + bd.iva;
    }

    let totalsBody = [];
    let totalsHead = null;
    let totalsColumnStyles = {};
    let totalsTableWidth = 0;

    const wVrSum = 28; const wTotSum = 22; const wVrInst = 23; const wTotInst = 25;
    const wSimpleLabel = 37; const wSimpleVal = 25;

    if (configUsada.modo === 'MIXTO') {
        totalsTableWidth = wVrSum + wTotSum + wVrInst + wTotInst;
        totalsColumnStyles = {
            0: { cellWidth: wVrSum, halign: 'center' }, 1: { cellWidth: wTotSum, halign: 'center' }, 
            2: { cellWidth: wVrInst, halign: 'center' }, 3: { cellWidth: wTotInst, halign: 'center' } 
        };
    } else {
        totalsTableWidth = wSimpleLabel + wSimpleVal; 
        totalsColumnStyles = {
            0: { cellWidth: wSimpleLabel, halign: 'center', fontStyle: 'bold' },
            1: { cellWidth: wSimpleVal, halign: 'center' }
        };
    }

    let totalsMarginLeft = PAGE_WIDTH - T_MARGIN_RIGHT - totalsTableWidth;

    if (configUsada.modo === 'MIXTO') {
        const totalInstalacion = bd.directo + bd.vAdmin + bd.vImpr + bd.vUtil + bd.vIvaInst;
        const totalSuministro = bd.totalBaseSum + bd.ivaSum;

        totalsHead = null;
        totalsBody = [
            [
                { content: 'SUB TOTAL', styles: { fontStyle: 'bold' } }, 
                { content: _currencyFormatter.format(bd.totalBaseSum) },
                { content: 'SUB TOTAL', styles: { fontStyle: 'bold' } }, 
                { content: _currencyFormatter.format(bd.directo) }
            ],
            [
                { content: '', styles: { lineWidth: { top: 0.1, bottom: 0, left: 0.1, right: 0.1 } } }, 
                { content: '', styles: { lineWidth: { top: 0.1, bottom: 0, left: 0.1, right: 0.1 } } },
                { content: `ADMIN. ${aiu.admin}%`, styles: { fontStyle: 'bold' } }, { content: _currencyFormatter.format(bd.vAdmin) }
            ],
            [
                { content: '', styles: { lineWidth: { top: 0, bottom: 0, left: 0.1, right: 0.1 } } }, 
                { content: '', styles: { lineWidth: { top: 0, bottom: 0, left: 0.1, right: 0.1 } } },
                { content: `IMPREV. ${aiu.imprev}%`, styles: { fontStyle: 'bold' } }, { content: _currencyFormatter.format(bd.vImpr) }
            ],
            [
                { content: '', styles: { lineWidth: { top: 0, bottom: 0, left: 0.1, right: 0.1 } } }, 
                { content: '', styles: { lineWidth: { top: 0, bottom: 0, left: 0.1, right: 0.1 } } },
                { content: `UTILIDAD ${aiu.util}%`, styles: { fontStyle: 'bold' } }, { content: _currencyFormatter.format(bd.vUtil) }
            ],
            [
                { content: 'IVA 19%', styles: { fontStyle: 'bold' } }, { content: _currencyFormatter.format(bd.ivaSum) },
                { content: 'IVA / UTILIDAD', styles: { fontStyle: 'bold' } }, { content: _currencyFormatter.format(bd.vIvaInst) }
            ],
            [
                { content: 'T. SUMINISTRO', styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } },
                { content: _currencyFormatter.format(totalSuministro), styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } },
                { content: 'T. INSTALACION', styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } },
                { content: _currencyFormatter.format(totalInstalacion), styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } }
            ],
            [
                { 
                    content: 'VALOR TOTAL DE LA PROPUESTA', colSpan: 3, 
                    styles: { fontStyle: 'bold', halign: 'center', fontSize: 9, fillColor: [0, 176, 240], textColor: 0 } 
                },
                { 
                    content: _currencyFormatter.format(totalFinalCalc), 
                    styles: { halign: 'center', fontStyle: 'bold', fontSize: 9, fillColor: [0, 176, 240], textColor: 0 } 
                }
            ]
        ];
    } else {
        if (configUsada.modo === 'AIU') {
             totalsBody.push(["SUB TOTAL:", _currencyFormatter.format(bd.directo)]);
             totalsBody.push([`ADMINISTRACIÓN ${aiu.admin}%:`, _currencyFormatter.format(bd.vAdmin)]);
             totalsBody.push([`IMPREVISTOS ${aiu.imprev}%:`, _currencyFormatter.format(bd.vImpr)]);
             totalsBody.push([`UTILIDAD ${aiu.util}%:`, _currencyFormatter.format(bd.vUtil)]);
             totalsBody.push(["IVA (Sobre Utilidad):", _currencyFormatter.format(bd.vIvaUtil)]);
        } else {
             totalsBody.push(["SUB TOTAL:", _currencyFormatter.format(bd.subtotal)]);
             totalsBody.push(["IVA (19%):", _currencyFormatter.format(bd.iva)]);
        }
        totalsBody.push([
            { content: "VALOR TOTAL:", styles: { fillColor: [0, 176, 240], textColor: 0, fontStyle: 'bold', halign: 'center' } }, 
            { content: _currencyFormatter.format(totalFinalCalc), styles: { fillColor: [0, 176, 240], textColor: 0, fontStyle: 'bold', halign: 'center' } }
        ]);
    }

    let startYTotales = doc.lastAutoTable.finalY;
    const estimatedBoxHeight = 5 * totalsBody.length + 10;
    if (startYTotales + estimatedBoxHeight > PAGE_HEIGHT - 20) {
        doc.addPage();
        startYTotales = 20;
    }

    doc.autoTable({
        startY: startYTotales,
        head: totalsHead,
        body: totalsBody,
        theme: 'grid',
        styles: {
            font: 'times', fontSize: 7, cellPadding: 1.5, 
            lineColor: [0, 0, 0], lineWidth: 0.1, textColor: 0, valign: 'middle'
        },
        columnStyles: totalsColumnStyles,
        margin: { left: totalsMarginLeft },
        tableWidth: totalsTableWidth,
        showHead: totalsHead ? 'everyPage' : 'never' 
    });

    finalY = doc.lastAutoTable.finalY + 10;

    // --- E. CONDICIONES Y FIRMA ---
    if (finalY > PAGE_HEIGHT - 60) { doc.addPage(); finalY = 20; }

    doc.setFontSize(11);
    doc.setFont("times", "normal");
    
    const terminosObj = datosExternos ? datosExternos.terminos : {
        pago: document.getElementById('term-pago')?.value,
        validez: document.getElementById('term-validez')?.value,
        entrega: document.getElementById('term-entrega')?.value,
        notas: document.getElementById('term-notas')?.value
    };

    const terminosArr = [
        `Forma de pago: ${terminosObj.pago || ''}`,
        `Validez de la oferta: ${terminosObj.validez || ''}`,
        `Tiempo de entrega: ${terminosObj.entrega || ''}`
    ];
    if (terminosObj.notas) terminosArr.push(`Nota: ${terminosObj.notas}`);

    terminosArr.forEach(t => {
        doc.text(t, MARGIN_LEFT, finalY);
        finalY += 5;
    });

    finalY += 10;
    if (finalY + 40 > PAGE_HEIGHT - 25) { doc.addPage(); finalY = 30; }

    doc.text("Atentamente,", MARGIN_LEFT, finalY);
    const firmaY = finalY + 5;
    
    if (empresaInfo.firmaGerenteURL) {
        try {
            const firmaImg = await getBase64ImageFromURL(empresaInfo.firmaGerenteURL);
            if(firmaImg) doc.addImage(firmaImg, 'PNG', MARGIN_LEFT, firmaY, 40, 20);
        } catch(e) {}
    }
    
    const textFirmaY = firmaY + 25;
    doc.setFont("times", "bold");
    doc.text(empresaInfo.gerente || "Gerente General", MARGIN_LEFT, textFirmaY);
    doc.setFont("times", "normal");
    doc.text("Gerente General", MARGIN_LEFT, textFirmaY + 5);

    // --- F. PIE DE PÁGINA ---
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        const footerY = PAGE_HEIGHT - 25;

        doc.setFontSize(9); doc.setFont("times", "bold"); doc.setTextColor(0, 0, 0);

        const l1 = "VENTANERIA FACHADAS-DIVISIONES DE OFICINA –DIVISIONES DE BAÑO, VIDRIO TEMPLADO";
        doc.text(l1, PAGE_WIDTH/2, footerY, { align: 'center' });
        
        const l2 = "PELICULA DE SEGURIDAD- VENTANAS ACUSTICAS-VIDRIOS ACUSTICOS.";
        doc.text(l2, PAGE_WIDTH/2, footerY + 4, { align: 'center' });
        
        doc.setFontSize(10); 
        doc.setFont("times", "normal");
        const l3 = `${empresaInfo.direccion || ''} | ${empresaInfo.email || ''} | ${empresaInfo.telefono || ''}`;
        doc.text(l3, PAGE_WIDTH/2, footerY + 8, { align: 'center' });
        
        const telefono = empresaInfo.telefono || '';
        doc.text(telefono, PAGE_WIDTH / 2, footerY + 12, { align: 'center' });
    }

    doc.save(`Cotizacion_${cliente}.pdf`);
}

// =============================================================================
// 3. VISTAS Y NAVEGACIÓN
// =============================================================================

export function loadCotizacionesView() {
    _showView('cotizaciones');

    const listView = document.getElementById('cotizaciones-view');
    const detailView = document.getElementById('cotizacion-detalle-view');
    const modal = document.getElementById('modal-config-cotizacion');

    if (listView) { listView.classList.remove('hidden'); listView.style.display = 'block'; }
    if (detailView) { detailView.classList.add('hidden'); detailView.style.display = 'none'; }
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }

    cargarListaFirebase();
}

function abrirModalConfiguracion(esEdicion = false) {
    history.pushState({ view: 'editor' }, "Editar Cotización", "#editar");
    const modal = document.getElementById('modal-config-cotizacion');
    if (!modal) return alert("Falta HTML del modal");

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    if (esEdicion || cotizacionEditandoId) {
        document.getElementById('config-modo').value = currentConfig.modo;

        document.getElementById('conf-admin').value = currentConfig.aiu.admin;
        document.getElementById('conf-imprev').value = currentConfig.aiu.imprev;
        document.getElementById('conf-util').value = currentConfig.aiu.util;

        if (currentConfig.split) {
            document.getElementById('conf-split-sum').value = currentConfig.split.sum;
            document.getElementById('conf-split-inst').value = currentConfig.split.inst;
        }

        if (currentConfig.terminos) {
            document.getElementById('conf-pago').value = currentConfig.terminos.pago;
            document.getElementById('conf-validez').value = currentConfig.terminos.validez;
            document.getElementById('conf-entrega').value = currentConfig.terminos.entrega;
        }

        document.querySelectorAll('.col-check').forEach(chk => {
            chk.checked = currentConfig.columnas.includes(chk.value);
        });
    }
}

// --- AGREGAR ESTA FUNCIÓN AL FINAL DEL ARCHIVO O JUNTO A OTRAS DE CARGA ---
async function cargarDatosEmpresa() {
    try {
        console.log("--> Cargando datos de empresa para PDF...");
        const docRef = doc(_db, "system", "generalConfig"); // Ruta correcta
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            // Tu estructura guarda los datos dentro de la propiedad 'empresa'
            empresaInfo = data.empresa || data;
            console.log("--> Datos empresa cargados:", empresaInfo);
        } else {
            console.warn("--> No se encontró configuración. Usando valores por defecto.");
        }
    } catch (error) {
        console.error("Error cargando empresa:", error);
    }
}

function cerrarModalConfiguracion() {
    const modal = document.getElementById('modal-config-cotizacion');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function aplicarConfiguracionEIniciar() {
    const columnas = Array.from(document.querySelectorAll('.col-check:checked')).map(c => c.value);
    const modo = document.getElementById('config-modo').value;
    const aiu = {
        admin: parseFloat(document.getElementById('conf-admin').value) || 0,
        imprev: parseFloat(document.getElementById('conf-imprev').value) || 0,
        util: parseFloat(document.getElementById('conf-util').value) || 0
    };
    const split = {
        sum: parseFloat(document.getElementById('conf-split-sum').value) || 85,
        inst: parseFloat(document.getElementById('conf-split-inst').value) || 15
    };
    const terminos = {
        pago: document.getElementById('conf-pago').value,
        validez: document.getElementById('conf-validez').value,
        entrega: document.getElementById('conf-entrega').value,
        notas: document.getElementById('term-notas')?.value || ''
    };

    currentConfig = { columnas, modo, aiu, split, terminos };
    cerrarModalConfiguracion();

    if (document.getElementById('term-pago')) document.getElementById('term-pago').value = terminos.pago;
    if (document.getElementById('term-validez')) document.getElementById('term-validez').value = terminos.validez;
    if (document.getElementById('term-entrega')) document.getElementById('term-entrega').value = terminos.entrega;

    if (!cotizacionEditandoId) {
        abrirFormularioDetalle(null, true);
    } else {
        reconstruirTabla();
        recalcularTodo();
    }
}

async function abrirFormularioDetalle(id = null, esNueva = false) {
    history.pushState({ view: 'editor' }, "Editar Cotización", "#editar");
    const listView = document.getElementById('cotizaciones-view');
    const detailView = document.getElementById('cotizacion-detalle-view');

    listView.style.display = 'none';
    detailView.style.display = 'block';
    detailView.classList.remove('hidden');

    const form = document.getElementById('form-cotizacion');
    const tbody = document.getElementById('items-container');

    if (esNueva) {
        form.reset();
        tbody.innerHTML = '';
        cotizacionEditandoId = null;
        document.getElementById('titulo-pagina-cot').textContent = "Nueva Cotización";
        document.getElementById('cot-fecha').valueAsDate = new Date();

        document.getElementById('term-pago').value = currentConfig.terminos.pago;
        document.getElementById('term-validez').value = currentConfig.terminos.validez;
        document.getElementById('term-entrega').value = currentConfig.terminos.entrega;

        reconstruirTabla();
        agregarFilaItem();
    }

    if (id) {
        cotizacionEditandoId = id;
        document.getElementById('titulo-pagina-cot').textContent = "Editar Cotización";

        try {
            const docSnap = await getDoc(doc(_db, "cotizaciones", id));
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.config) currentConfig = data.config;

                document.getElementById('cot-cliente').value = data.cliente;
                document.getElementById('cot-proyecto').value = data.proyecto;
                document.getElementById('cot-fecha').value = data.fecha;

                if (data.terminos) {
                    document.getElementById('term-pago').value = data.terminos.pago;
                    document.getElementById('term-validez').value = data.terminos.validez;
                    document.getElementById('term-entrega').value = data.terminos.entrega;
                    document.getElementById('term-notas').value = data.terminos.notas || '';
                }

                reconstruirTabla();
                tbody.innerHTML = '';
                if (data.items) {
                    data.items.forEach(item => agregarFilaItem(item));
                }
                recalcularTodo();
                archivosExistentes = data.archivos || [];
                renderizarSeccionArchivos();
            }
        } catch (e) {
            console.error(e);
        }
    }

    document.getElementById('label-modo-cobro').textContent = `MODO: ${currentConfig.modo}`;
    setTimeout(inyectarBotonHistorial, 100); // Pequeño delay para asegurar que el DOM esté listo

    // --- GESTIÓN DE ARCHIVOS: INYECTAR UI Y CARGAR DATOS ---
    
    // 1. Inyectar HTML si no existe
    const containerTerminos = document.getElementById('term-notas').closest('.grid') || document.getElementById('form-cotizacion');
    let areaArchivos = document.getElementById('area-archivos-container');
    
    if (!areaArchivos && containerTerminos) {
        areaArchivos = document.createElement('div');
        areaArchivos.id = 'area-archivos-container';
        areaArchivos.className = "mt-6 border-t pt-4 col-span-1 md:col-span-3"; // Ajusta col-span según tu grid
        areaArchivos.innerHTML = `
            <h3 class="text-lg font-bold text-slate-700 mb-3"><i class="fa-solid fa-folder-open mr-2"></i>Documentos y Planos</h3>
            
            <div class="mb-4">
                <label class="inline-block cursor-pointer bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-4 py-2 rounded border border-indigo-200 transition">
                    <i class="fa-solid fa-paperclip mr-2"></i> Adjuntar Archivos
                    <input type="file" id="input-adjuntos-cot" multiple class="hidden">
                </label>
                <span class="text-xs text-slate-400 ml-2">PDF, Imágenes, CAD (Max 10MB)</span>
            </div>

            <div id="seccion-archivos-adjuntos" class="grid grid-cols-1 md:grid-cols-2 gap-3">
                </div>
        `;
        // Insertar después de las notas o al final del formulario
        containerTerminos.parentNode.appendChild(areaArchivos); 
    }

    // 2. Resetear estados
    archivosParaSubir = [];
    archivosExistentes = [];

    // 3. Cargar archivos si es edición
    if (id && cotizacionEditandoId) {
        // Nota: Asegúrate de que 'data' (del getDoc anterior) esté disponible aquí 
        // O vuelve a leerlo de la variable global si la tienes, o usa el snapshot.
        // Asumiremos que puedes acceder a la data cargada arriba en la función:
        
        // Si no tienes acceso a 'data' aquí, muévelo dentro del bloque `if (docSnap.exists())` de arriba
    }
    setTimeout(inyectarControlesExcel, 100);
}

function cerrarVistaDetalle() {
    document.getElementById('cotizacion-detalle-view').style.display = 'none';
    document.getElementById('cotizaciones-view').style.display = 'block';
    cotizacionEditandoId = null;
}

// --- CONSTRUCCIÓN DE TABLA ---
function reconstruirTabla() {
    const head = document.getElementById('tabla-cotizacion-head');
    let html = '<tr>';

    const map = {
        item: '<th class="px-2 py-3 w-10">#</th>',
        ubicacion: '<th class="px-2 py-3 text-left">Ubicación</th>',
        descripcion: '<th class="px-2 py-3 text-left">Descripción</th>',
        ancho: '<th class="px-2 py-3 text-right w-20">Ancho</th>',
        alto: '<th class="px-2 py-3 text-right w-20">Alto</th>',
        m2: '<th class="px-2 py-3 text-right w-20 text-slate-500">M²</th>',
        cantidad: '<th class="px-2 py-3 text-center w-16">Cant</th>',
        total_m2: '<th class="px-2 py-3 text-right w-20 text-slate-500">Total M²</th>',
        suministro: '<th class="px-2 py-3 text-right w-28 bg-blue-50 text-blue-800">Suministro</th>',
        instalacion: '<th class="px-2 py-3 text-right w-28 bg-emerald-50 text-emerald-800">Instalación</th>',
        valor_unitario: '<th class="px-2 py-3 text-right w-28 font-bold">V. Unitario</th>',
        total_global: '<th class="px-2 py-3 text-right w-28 font-bold">Total</th>'
    };

    currentConfig.columnas.forEach(col => { if (map[col]) html += map[col]; });
    html += '<th class="px-2 py-3 w-10"></th></tr>';
    head.innerHTML = html;
}

function agregarFilaItem(data = {}) {
    const tbody = document.getElementById('items-container');
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-50 border-b border-slate-50 group";

    let html = '';
    const v = (k) => data[k] || '';
    const vn = (k) => data[k] || 0;

    currentConfig.columnas.forEach(col => {
        if (col === 'item') {
            html += `<td class="p-2"><span class="text-xs font-bold text-slate-400 block text-center">${tbody.children.length + 1}</span></td>`;
        }
        else if (col === 'ubicacion') {
            // --- CAMBIO 1: Ubicación pequeña (w-20) y centrada ---
            html += `<td class="p-2">
                        <input type="text" name="ubicacion" 
                        class="w-20 p-1 border rounded text-xs text-center" 
                        value="${v('ubicacion')}" 
                        placeholder="Ubic.">
                     </td>`;
        }
        else if (col === 'descripcion') {
            // --- CAMBIO 2: Descripción ancha (min-w-[300px]) para absorber el espacio ---
            html += `<td class="p-2">
                        <textarea name="descripcion" rows="1" spellcheck="true" lang="es" 
                        class="w-full min-w-[300px] p-1 border rounded text-xs resize-none overflow-hidden" 
                        style="min-height: 28px;"
                        placeholder="Descripción...">${v('descripcion')}</textarea>
                     </td>`;
        }
        else if (col === 'ancho') html += `<td class="p-2"><input type="number" step="0.01" name="ancho" class="inputs-calc w-full p-1 border rounded text-right text-xs" placeholder="0.00" value="${v('ancho')}"></td>`;
        else if (col === 'alto') html += `<td class="p-2"><input type="number" step="0.01" name="alto" class="inputs-calc w-full p-1 border rounded text-right text-xs" placeholder="0.00" value="${v('alto')}"></td>`;
        else if (col === 'm2') html += `<td class="p-2"><input type="text" name="m2" readonly class="w-full p-1 bg-slate-100 text-slate-500 rounded text-right text-xs" value="0.00"></td>`;
        else if (col === 'cantidad') html += `<td class="p-2"><input type="number" name="cantidad" class="inputs-calc w-full p-1 border rounded text-center text-xs font-bold" value="${vn('cantidad') || 1}"></td>`;
        else if (col === 'total_m2') html += `<td class="p-2"><input type="text" name="total_m2" readonly class="w-full p-1 bg-slate-100 text-slate-500 rounded text-right text-xs" value="0.00"></td>`;
        else if (col === 'suministro') html += `<td class="p-2"><input type="number" name="val_suministro" class="inputs-calc w-full p-1 border border-blue-200 bg-blue-50/50 rounded text-right text-xs" value="${vn('val_suministro')}"></td>`;
        else if (col === 'instalacion') html += `<td class="p-2"><input type="number" name="val_instalacion" class="inputs-calc w-full p-1 border border-emerald-200 bg-emerald-50/50 rounded text-right text-xs" value="${vn('val_instalacion')}"></td>`;
        else if (col === 'valor_unitario') html += `<td class="p-2"><input type="number" name="valor_unitario" class="inputs-calc w-full p-1 border rounded text-right text-xs font-bold" value="${vn('valor_unitario')}"></td>`;
        else if (col === 'total_global') html += `<td class="p-2"><div class="display-total text-right text-xs font-bold text-slate-700" data-raw="0">$0</div></td>`;
    });

    html += `<td class="p-2 text-center"><button type="button" class="btn-remove text-slate-300 hover:text-red-500 cursor-pointer"><i class="fa-solid fa-trash"></i></button></td>`;

    tr.innerHTML = html;
    tbody.appendChild(tr);

    // Lógica auto-resize para descripción
    const textarea = tr.querySelector('textarea[name="descripcion"]');
    if (textarea) {
        const autoResize = () => {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        };
        textarea.addEventListener('input', autoResize);

        // Ajuste inicial retardado para asegurar renderizado
        requestAnimationFrame(autoResize);
    }

    calcularFila(tr, null, true);
}

// --- CRUD PRINCIPAL (FUSIONADO: ARCHIVOS + VERSIONAMIENTO) ---
async function guardarCotizacion(e) {
    e.preventDefault();
    
    // 1. Feedback visual (Bloquear botón)
    const btn = e.target.querySelector('button[type="submit"]');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

    try {
        // 2. Recopilar Ítems de la tabla
        const items = [];
        document.querySelectorAll('#items-container tr').forEach(tr => {
            const item = {};
            // Recoger todos los inputs y textareas de la fila
            tr.querySelectorAll('input, textarea').forEach(i => item[i.name] = i.value);
            // Solo agregar si tiene descripción
            if(item.descripcion) items.push(item);
        });

        if (!items.length) throw new Error("La cotización está vacía. Agrega al menos un ítem.");

        // 3. Calcular Total Final Actual
        const total = calcularTotalesGenerales().totalFinal;

        // 4. Gestión de Archivos y Generación de ID
        // Si es nueva, necesitamos generar el ID antes para saber dónde guardar los archivos
        let docRef;
        let idDocumento = cotizacionEditandoId;

        if (!idDocumento) {
            // Generamos una referencia nueva vacía para obtener su ID
            docRef = doc(collection(_db, "cotizaciones"));
            idDocumento = docRef.id;
        } else {
            docRef = doc(_db, "cotizaciones", idDocumento);
        }

        // Subir archivos nuevos a Storage (usando el ID del documento)
        // Nota: subirArchivosPendientes devuelve array vacío si no hay nada nuevo
        const nuevosArchivos = await subirArchivosPendientes(idDocumento);
        
        // Combinar archivos viejos (que ya estaban en BD) con los nuevos subidos
        // 'archivosExistentes' es la variable global que llenamos al abrir el formulario
        const listaCompletaArchivos = [...archivosExistentes, ...nuevosArchivos];

        // 5. Preparar el Objeto de Datos
        const data = {
            cliente: document.getElementById('cot-cliente').value,
            proyecto: document.getElementById('cot-proyecto').value,
            fecha: document.getElementById('cot-fecha').value,
            config: currentConfig,
            items: items,
            terminos: {
                pago: document.getElementById('term-pago').value,
                validez: document.getElementById('term-validez').value,
                entrega: document.getElementById('term-entrega').value,
                notas: document.getElementById('term-notas').value
            },
            totalFinal: total,
            archivos: listaCompletaArchivos, // <--- Guardamos la lista de archivos
            updatedAt: serverTimestamp()
        };

        // 6. Guardado con Lógica de Versionamiento
        if (cotizacionEditandoId) {
            // --- MODO EDICIÓN: VERSIONAR ANTES DE GUARDAR ---
            
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const currentData = docSnap.data();
                const currentVersion = currentData.version || 1; // Si no tiene versión, es la 1
                
                // A) Guardar copia en subcolección 'historial'
                const historyRef = collection(_db, "cotizaciones", cotizacionEditandoId, "historial");
                await addDoc(historyRef, {
                    ...currentData, // Copia exacta de lo que había
                    archivedAt: serverTimestamp(),
                    versionLabel: `Versión ${currentVersion}`
                });

                // B) Incrementar versión en los datos nuevos
                data.version = currentVersion + 1;
                
                // C) Actualizar documento principal
                await updateDoc(docRef, data);
                
                alert(`Cotización actualizada correctamente a la Versión ${data.version}`);
            }
        } else {
            // --- MODO NUEVA COTIZACIÓN ---
            data.version = 1;
            data.createdAt = serverTimestamp();
            data.createdBy = _currentUser ? _currentUser.uid : 'anon';
            
            // Usamos setDoc porque generamos el ID manualmente arriba (para los archivos)
            // Importamos setDoc dinámicamente por si no estaba en los imports iniciales
            const { setDoc } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
            await setDoc(docRef, data);
        }

        // 7. Limpieza y Cierre
        cerrarVistaDetalle();

    } catch (e) {
        console.error("Error al guardar:", e);
        alert("Error al guardar: " + e.message);
    } finally {
        // Restaurar botón
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

async function cargarListaFirebase() {
    const tbody = document.getElementById('lista-cotizaciones-body');
    if(!tbody) return;
    
    if(unsubscribeCotizaciones) unsubscribeCotizaciones();
    
    const q = query(collection(_db, "cotizaciones"), orderBy("createdAt", "desc"));
    unsubscribeCotizaciones = onSnapshot(q, (snap) => {
        tbody.innerHTML = '';
        snap.forEach(docSnap => {
            const d = docSnap.data();
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50 border-b border-slate-100";
            
            // --- CAMBIO AQUÍ: Agregamos el botón de PDF (btn-pdf) ---
            tr.innerHTML = `
                <td class="px-6 py-4 font-bold">${d.cliente || 'Sin Cliente'}</td>
                <td class="px-6 py-4 text-sm">${d.proyecto || 'Sin Proyecto'}</td>
                <td class="px-6 py-4 text-sm">${d.fecha}</td>
                <td class="px-6 py-4 font-bold">${_currencyFormatter.format(d.totalFinal)}</td>
                <td class="px-6 py-4 text-right flex justify-end gap-2">
                    
                    <button class="btn-pdf text-emerald-600 hover:bg-emerald-50 p-2 rounded" title="Descargar PDF">
                        <i class="fa-solid fa-file-pdf"></i>
                    </button>
                    
                    <button class="btn-clone text-indigo-600 hover:bg-indigo-50 p-2 rounded" title="Clonar Cotización">
                        <i class="fa-solid fa-copy"></i>
                    </button>

                    <button class="btn-edit text-blue-600 hover:bg-blue-50 p-2 rounded" title="Editar">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    
                    <button class="btn-del text-red-600 hover:bg-red-50 p-2 rounded" title="Eliminar">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            
            // Listeners
            const btnPdf = tr.querySelector('.btn-pdf');
            const btnClone = tr.querySelector('.btn-clone'); // <--- Capturamos botón
            const editBtn = tr.querySelector('.btn-edit');
            const delBtn = tr.querySelector('.btn-del');
            
            // Lógica PDF (Ya la tienes)
            if(btnPdf) btnPdf.onclick = async () => { /* ... tu código pdf ... */ };

            // --- LÓGICA CLONAR ---
            if(btnClone) btnClone.onclick = async () => {
                if(confirm(`¿Deseas crear una COPIA de la cotización para "${d.proyecto}"?`)) {
                    await clonarCotizacion(d);
                }
            };

            if(editBtn) editBtn.onclick = () => abrirFormularioDetalle(docSnap.id);
            if(delBtn) delBtn.onclick = async () => { 
                if(confirm('¿Borrar?')) await deleteDoc(docSnap.ref); 
            };
            
            tbody.appendChild(tr);
        });
    });
}

// --- FUNCIÓN NUEVA: REFRESCA LA TABLA AL CAMBIAR CONFIGURACIÓN ---
function refrescarTablaItems() {
    const tbody = document.getElementById('items-container');
    const rows = tbody.querySelectorAll('tr');
    const savedData = [];

    // 1. Guardar datos actuales (Snapshot)
    rows.forEach(tr => {
        const getVal = (n) => {
            const el = tr.querySelector(`[name="${n}"]`);
            return el ? (parseFloat(el.value) || 0) : 0;
        };
        const getStr = (n) => {
            const el = tr.querySelector(`[name="${n}"]`);
            return el ? el.value : '';
        };

        savedData.push({
            // Textos
            ubicacion: getStr('ubicacion'),
            descripcion: getStr('descripcion'),
            // Dimensiones
            ancho: getVal('ancho'),
            alto: getVal('alto'),
            m2: getVal('m2'),
            cantidad: getVal('cantidad'),
            // Valores Financieros (Guardamos todo lo que haya)
            vUnitarioGross: getVal('valor_unitario'),   // Si veníamos de modo simple
            vSumBase: getVal('val_suministro'),         // Si veníamos de modo mixto
            vInstBase: getVal('val_instalacion')        // Si veníamos de modo mixto
        });
    });

    // 2. Reconstruir Encabezados (THEAD)
    const headerRow = document.querySelector('#items-table thead tr');
    if (headerRow) {
        let html = '';
        const cols = currentConfig.columnas;

        if (cols.includes('item')) html += '<th class="px-2 py-2 text-center">Item</th>';
        if (cols.includes('ubicacion')) html += '<th class="px-2 py-2 text-center">Ubicación</th>';
        if (cols.includes('descripcion')) html += '<th class="px-2 py-2 text-center w-1/3">Descripción</th>';
        if (cols.includes('ancho')) html += '<th class="px-2 py-2 text-center">Ancho</th>';
        if (cols.includes('alto')) html += '<th class="px-2 py-2 text-center">Alto</th>';
        if (cols.includes('m2')) html += '<th class="px-2 py-2 text-center">M2</th>';
        if (cols.includes('cantidad')) html += '<th class="px-2 py-2 text-center">Cant</th>';

        // Columnas Financieras Dinámicas
        if (cols.includes('suministro') && cols.includes('instalacion')) {
            html += '<th class="px-2 py-2 text-center">Vr. Sum (Base)</th>';
            html += '<th class="px-2 py-2 text-center">Vr. Inst (Base)</th>';
        } else if (cols.includes('valor_unitario')) {
            html += '<th class="px-2 py-2 text-center">V. Unitario</th>';
        }

        html += '<th class="px-2 py-2 text-center">Total</th>';
        html += '<th class="px-2 py-2 text-center">...</th>';

        headerRow.innerHTML = html;
    }

    // 3. Limpiar y Reconstruir Filas (TBODY)
    tbody.innerHTML = '';

    // Factores para conversión (Mismos que usamos en calcularFila)
    const { modo, aiu } = currentConfig;
    const factorIVA = 1.19;
    const factorAIU = 1 + (aiu.admin / 100) + (aiu.imprev / 100) + (aiu.util / 100) + ((aiu.util / 100) * 0.19);
    const split = currentConfig.split || { sum: 85, inst: 15 };

    savedData.forEach(data => {
        agregarFilaItem(); // Crea la fila vacía con la NUEVA estructura
        const newRow = tbody.lastElementChild;

        // Restaurar Textos y Dimensiones
        const setVal = (n, v) => { const el = newRow.querySelector(`[name="${n}"]`); if (el) el.value = v; };
        setVal('ubicacion', data.ubicacion);
        setVal('descripcion', data.descripcion);
        setVal('ancho', data.ancho);
        setVal('alto', data.alto);
        setVal('m2', data.m2);
        setVal('cantidad', data.cantidad);

        // --- MIGRACIÓN INTELIGENTE DE PRECIOS ---
        const esMixtoAhora = currentConfig.columnas.includes('suministro');

        if (esMixtoAhora) {
            // AHORA ES MIXTO (Inputs deben ser BASE)
            if (data.vSumBase > 0 || data.vInstBase > 0) {
                // Ya venía de mixto, pasamos directo
                setVal('val_suministro', data.vSumBase);
                setVal('val_instalacion', data.vInstBase);
            } else if (data.vUnitarioGross > 0) {
                // Venía de simple (Gross), hay que desglosar y quitar impuestos
                const brutoSum = data.vUnitarioGross * (split.sum / 100);
                const brutoInst = data.vUnitarioGross * (split.inst / 100);
                setVal('val_suministro', (brutoSum / factorIVA).toFixed(2));

                let baseInst = (modo === 'MIXTO' || modo === 'AIU') ? (brutoInst / factorAIU) : (brutoInst / factorIVA);
                setVal('val_instalacion', baseInst.toFixed(2));
            }
        } else {
            // AHORA ES SIMPLE (Input debe ser GROSS/CON IMPUESTOS)
            if (data.vUnitarioGross > 0) {
                // Ya venía de simple
                setVal('valor_unitario', data.vUnitarioGross);
            } else if (data.vSumBase > 0 || data.vInstBase > 0) {
                // Venía de mixto (Base), hay que sumar impuestos y unificar
                const brutoSum = data.vSumBase * factorIVA;
                let brutoInst = 0;
                if (modo === 'MIXTO' || modo === 'AIU') brutoInst = data.vInstBase * factorAIU;
                else brutoInst = data.vInstBase * factorIVA;

                setVal('valor_unitario', (brutoSum + brutoInst).toFixed(2));
            }
        }

        // Recalcular fila para actualizar visuales
        calcularFila(newRow);
    });

    // 4. Totales finales
    calcularTotalesGenerales();
}

// =============================================================================
// 4. GESTIÓN DE HISTORIAL (VERSIONES)
// =============================================================================

// Función para inyectar el botón en la cabecera (se llama desde abrirFormularioDetalle)
function inyectarBotonHistorial() {
    const headerActions = document.querySelector('#cotizacion-detalle-view .flex.justify-between div'); 
    // Buscamos el contenedor de botones de la cabecera (donde está volver/exportar)
    
    if (headerActions && !document.getElementById('btn-ver-historial')) {
        const btnHist = document.createElement('button');
        btnHist.id = 'btn-ver-historial';
        btnHist.type = 'button';
        btnHist.className = 'bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow ml-2 transition';
        btnHist.innerHTML = '<i class="fa-solid fa-clock-rotate-left mr-2"></i> Historial';
        btnHist.onclick = mostrarModalHistorial;
        
        // Lo insertamos antes del botón de exportar o al final
        headerActions.appendChild(btnHist);
    }
}

async function mostrarModalHistorial() {
    if (!cotizacionEditandoId) return alert("Guarda la cotización primero para tener historial.");

    const modalId = 'modal-historial-dinamico';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();

    // Estructura del Modal
    const modalHtml = `
    <div id="${modalId}" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6 relative">
            <button onclick="document.getElementById('${modalId}').remove()" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
                <i class="fa-solid fa-times text-xl"></i>
            </button>
            <h3 class="text-xl font-bold mb-4 text-gray-800">Historial de Versiones</h3>
            <div id="lista-historial" class="space-y-3 max-h-96 overflow-y-auto pr-2">
                <div class="text-center py-4"><i class="fa-solid fa-spinner fa-spin text-2xl text-indigo-500"></i></div>
            </div>
        </div>
    </div>`;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    try {
        // Consultar historial
        const historyRef = collection(_db, "cotizaciones", cotizacionEditandoId, "historial");
        const q = query(historyRef, orderBy("archivedAt", "desc"));
        const snapshot = await getDocs(q);
        
        const container = document.getElementById('lista-historial');
        container.innerHTML = '';

        if (snapshot.empty) {
            container.innerHTML = '<p class="text-gray-500 text-center">No hay versiones anteriores guardadas.</p>';
            return;
        }

        snapshot.forEach(docSnap => {
            const d = docSnap.data(); // Estos son los datos históricos (snapshot de ese momento)
            const fecha = d.archivedAt ? new Date(d.archivedAt.seconds * 1000).toLocaleString() : 'Fecha desc.';
            const total = d.totalFinal ? _currencyFormatter.format(d.totalFinal) : '$0';
            
            const item = document.createElement('div');
            item.className = 'p-3 border rounded hover:bg-slate-50 transition'; // Quitamos cursor pointer global
            
            // --- DISEÑO: Dos botones (PDF y Restaurar) ---
            item.innerHTML = `
                <div class="flex justify-between items-start">
                    <div>
                        <span class="font-bold text-indigo-700 block">${d.versionLabel || 'Versión antigua'}</span>
                        <span class="text-xs text-gray-500">${fecha}</span>
                    </div>
                    <div class="text-right">
                        <div class="font-bold text-gray-700 mb-2">${total}</div>
                        <div class="flex gap-2 justify-end">
                            <button class="btn-pdf-historial text-xs bg-red-50 border border-red-200 text-red-600 px-2 py-1 rounded hover:bg-red-600 hover:text-white transition" title="Ver PDF de esta versión">
                                <i class="fa-solid fa-file-pdf"></i> PDF
                            </button>
                            
                            <button class="btn-restaurar-historial text-xs bg-indigo-50 border border-indigo-200 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-600 hover:text-white transition">
                                Restaurar
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            // --- LÓGICA DEL BOTÓN PDF ---
            const btnPdf = item.querySelector('.btn-pdf-historial');
            btnPdf.onclick = async (e) => {
                e.stopPropagation();
                
                // Feedback de carga
                const htmlOriginal = btnPdf.innerHTML;
                btnPdf.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                btnPdf.disabled = true;

                try {
                    // LLAMAMOS A NUESTRA FUNCIÓN HÍBRIDA PASÁNDOLE LOS DATOS VIEJOS
                    await generarPDF(d); 
                } catch (err) {
                    console.error(err);
                    alert("Error generando el PDF histórico.");
                } finally {
                    btnPdf.innerHTML = htmlOriginal;
                    btnPdf.disabled = false;
                }
            };

            // --- LÓGICA DEL BOTÓN RESTAURAR ---
            const btnRestaurar = item.querySelector('.btn-restaurar-historial');
            btnRestaurar.onclick = (e) => {
                e.stopPropagation();
                if(confirm(`¿Seguro que deseas restaurar la ${d.versionLabel}?\n(Se cargará en el editor y si guardas, crearás una nueva versión superior)`)) {
                    cargarDatosEnEditor(d);
                    document.getElementById(modalId).remove();
                }
            };
            
            container.appendChild(item);
        });

    } catch (error) {
        console.error("Error historial:", error);
        document.getElementById('lista-historial').innerHTML = '<p class="text-red-500">Error cargando historial.</p>';
    }
}

// Función auxiliar para restaurar datos en el formulario
function cargarDatosEnEditor(data) {
    // 1. Restaurar Config
    if(data.config) currentConfig = data.config;
    
    // 2. Restaurar Campos Texto
    document.getElementById('cot-cliente').value = data.cliente || '';
    document.getElementById('cot-proyecto').value = data.proyecto || '';
    
    if(data.terminos) {
        if(document.getElementById('term-pago')) document.getElementById('term-pago').value = data.terminos.pago;
        if(document.getElementById('term-validez')) document.getElementById('term-validez').value = data.terminos.validez;
        if(document.getElementById('term-entrega')) document.getElementById('term-entrega').value = data.terminos.entrega;
        if(document.getElementById('term-notas')) document.getElementById('term-notas').value = data.terminos.notas || '';
    }

    // 3. Reconstruir Tabla
    reconstruirTabla();
    const tbody = document.getElementById('items-container');
    tbody.innerHTML = '';
    
    if(data.items && data.items.length > 0) {
        data.items.forEach(item => agregarFilaItem(item));
    } else {
        agregarFilaItem();
    }
    
    recalcularTodo();
    
    // Feedback visual
    const titulo = document.getElementById('titulo-pagina-cot');
    titulo.innerHTML = `Editar Cotización <span class="text-sm bg-yellow-100 text-yellow-800 px-2 py-1 rounded ml-2">Restaurado: ${data.versionLabel}</span>`;
}

// =============================================================================
// 5. GESTIÓN DE ARCHIVOS (PLANOS Y DOCUMENTOS)
// =============================================================================

let archivosParaSubir = []; // Cola temporal de archivos nuevos
let archivosExistentes = []; // URLs de archivos ya guardados

function renderizarSeccionArchivos() {
    const contenedor = document.getElementById('seccion-archivos-adjuntos');
    if(!contenedor) return;

    contenedor.innerHTML = '';
    
    // Lista de archivos existentes (Guardados en BD)
    archivosExistentes.forEach((doc, idx) => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-2 bg-slate-50 border rounded mb-2 text-sm";
        item.innerHTML = `
            <div class="flex items-center overflow-hidden">
                <i class="fa-solid fa-file-contract text-indigo-500 mr-2"></i>
                <a href="${doc.url}" target="_blank" class="text-blue-600 hover:underline truncate mr-2" title="${doc.nombre}">
                    ${doc.nombre}
                </a>
            </div>
            <button type="button" class="text-red-400 hover:text-red-600" onclick="eliminarArchivoExistente(${idx})">
                <i class="fa-solid fa-times"></i>
            </button>
        `;
        contenedor.appendChild(item);
    });

    // Lista de archivos nuevos (Por subir)
    archivosParaSubir.forEach((file, idx) => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-2 bg-yellow-50 border border-yellow-200 rounded mb-2 text-sm";
        item.innerHTML = `
            <div class="flex items-center overflow-hidden">
                <i class="fa-solid fa-upload text-yellow-600 mr-2"></i>
                <span class="text-slate-700 truncate mr-2">${file.name}</span>
                <span class="text-xs text-slate-400">(${(file.size/1024/1024).toFixed(2)} MB)</span>
            </div>
            <button type="button" class="text-red-400 hover:text-red-600" onclick="removerArchivoCola(${idx})">
                <i class="fa-solid fa-times"></i>
            </button>
        `;
        contenedor.appendChild(item);
    });
}

function manejarSeleccionArchivos(fileList) {
    for (let i = 0; i < fileList.length; i++) {
        archivosParaSubir.push(fileList[i]);
    }
    renderizarSeccionArchivos();
    // Limpiar input para permitir seleccionar el mismo archivo si se borró
    document.getElementById('input-adjuntos-cot').value = ''; 
}

// Funciones globales (window) para que el onclick del HTML las encuentre
window.eliminarArchivoExistente = (idx) => {
    if(confirm("¿Quitar este archivo de la cotización? (No se borrará del historial)")) {
        archivosExistentes.splice(idx, 1);
        renderizarSeccionArchivos();
    }
};

window.removerArchivoCola = (idx) => {
    archivosParaSubir.splice(idx, 1);
    renderizarSeccionArchivos();
};

async function subirArchivosPendientes(cotizacionId) {
    if (archivosParaSubir.length === 0) return [];
    
    const nuevosAdjuntos = [];
    
    for (const file of archivosParaSubir) {
        // Crear referencia: cotizaciones/ID/timestamp_nombre
        const path = `cotizaciones/${cotizacionId}/${Date.now()}_${file.name}`;
        const storageRef = ref(_storage, path);
        
        try {
            const snapshot = await uploadBytes(storageRef, file);
            const url = await getDownloadURL(snapshot.ref);
            
            nuevosAdjuntos.push({
                nombre: file.name,
                url: url,
                path: path,
                tipo: file.type,
                subidoEn: new Date().toISOString()
            });
        } catch (error) {
            console.error("Error subiendo archivo:", file.name, error);
            alert(`Error al subir ${file.name}`);
        }
    }
    
    archivosParaSubir = []; // Limpiar cola tras subida exitosa
    return nuevosAdjuntos;
}

// =============================================================================
// 6. MÓDULO EXCEL AVANZADO (IMPORTAR / EXPORTAR CON FÓRMULAS)
// =============================================================================

const MAPA_COLUMNAS_EXCEL = {
    item: 'ITEM',
    ubicacion: 'UBICACIÓN',
    descripcion: 'DESCRIPCIÓN',
    ancho: 'ANCHO',
    alto: 'ALTO',
    m2: 'M2',
    cantidad: 'CANTIDAD',
    total_m2: 'TOTAL M2',
    suministro: 'VR. SUMINISTRO (BASE)',
    instalacion: 'VR. INSTALACIÓN (BASE)',
    valor_unitario: 'VALOR UNITARIO',
    total_global: 'TOTAL'
};

// --- A. INYECTAR BOTONES ---
function inyectarControlesExcel() {
    const btnAgregar = document.getElementById('btn-agregar-item-cot');
    if (!btnAgregar) return;
    
    const parent = btnAgregar.parentNode;
    if (document.getElementById('btn-excel-container')) return;

    const container = document.createElement('div');
    container.id = 'btn-excel-container';
    container.className = "inline-flex gap-2 ml-2";
    
    container.innerHTML = `
        <input type="file" id="input-importar-excel" accept=".xlsx, .xls" class="hidden">
        
        <button type="button" onclick="document.getElementById('input-importar-excel').click()" 
            class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm transition flex items-center gap-2" 
            title="Importar ítems desde Excel">
            <i class="fa-solid fa-file-import"></i> Importar
        </button>

        <button type="button" onclick="exportarExcelConFormulas()" 
            class="bg-white border border-green-600 text-green-600 hover:bg-green-50 px-3 py-1 rounded text-sm transition flex items-center gap-2" 
            title="Descargar Excel con datos y fórmulas">
            <i class="fa-solid fa-file-excel"></i> Exportar / Plantilla
        </button>
    `;

    parent.insertBefore(container, btnAgregar.nextSibling);
    document.getElementById('input-importar-excel').addEventListener('change', procesarArchivoExcel);
}

// --- UTILIDAD: Convertir índice a Letra Excel (0->A, 1->B, 26->AA) ---
function indexToLetter(c) {
    let letter = '';
    while (c >= 0) {
        letter = String.fromCharCode((c % 26) + 65) + letter;
        c = Math.floor(c / 26) - 1;
    }
    return letter;
}

// --- B. EXPORTAR EXCEL CON FÓRMULAS E INFORMACIÓN ---
window.exportarExcelConFormulas = () => {
    if (!window.XLSX) return alert("Error: Librería XLSX no cargada.");

    // 1. Configurar Columnas Activas
    // Filtramos las que no queremos editar directamente si son calculadas puras en web, 
    // pero en excel las incluiremos para ponerles fórmulas.
    const cols = currentConfig.columnas; 
    
    // Mapeamos índice -> Clave para saber dónde poner qué
    const mapColIndex = {};
    const headers = [];
    
    cols.forEach((key, idx) => {
        headers.push(MAPA_COLUMNAS_EXCEL[key] || key.toUpperCase());
        mapColIndex[key] = idx; // Guardamos que 'ancho' es la columna 3 (D), etc.
    });

    // 2. Preparar Datos (Rows)
    const rows = document.querySelectorAll('#items-container tr');
    const dataRows = []; // Array de Arrays (o celdas con metadata)

    // Agregamos encabezado primero
    dataRows.push(headers);

    // Iteramos filas del HTML
    rows.forEach((tr, rIdx) => {
        const rowNum = rIdx + 2; // En Excel fila 1 es header, así que datos empiezan en 2
        const rowData = [];
        
        // Helper para leer valor numérico del input
        const getNum = (n) => {
            const val = parseFloat(tr.querySelector(`[name="${n}"]`)?.value);
            return isNaN(val) ? 0 : val;
        };
        const getStr = (n) => tr.querySelector(`[name="${n}"]`)?.value || '';

        // Construir celdas
        cols.forEach((colKey, cIdx) => {
            const colLetter = indexToLetter(cIdx);
            let cell = { v: '', t: 's' }; // Por defecto string vacío

            // --- LÓGICA DE CELDAS ---
            
            // 1. Texto Simple
            if (['item', 'ubicacion', 'descripcion'].includes(colKey)) {
                if (colKey === 'item') cell = { v: rIdx + 1, t: 'n' };
                else cell = { v: getStr(colKey), t: 's' };
            }
            
            // 2. Inputs Numéricos (Datos)
            else if (['ancho', 'alto', 'cantidad', 'suministro', 'instalacion', 'valor_unitario'].includes(colKey)) {
                // Mapeo de nombres internos
                let inputName = colKey;
                if(colKey === 'suministro') inputName = 'val_suministro';
                if(colKey === 'instalacion') inputName = 'val_instalacion';
                
                cell = { v: getNum(inputName), t: 'n' };
            }

            // 3. FÓRMULAS (La Magia)
            else if (colKey === 'm2') {
                // Fórmula: Ancho * Alto
                if (mapColIndex.ancho !== undefined && mapColIndex.alto !== undefined) {
                    const lAncho = indexToLetter(mapColIndex.ancho);
                    const lAlto = indexToLetter(mapColIndex.alto);
                    cell = { f: `${lAncho}${rowNum}*${lAlto}${rowNum}`, t: 'n' };
                } else {
                    cell = { v: 0, t: 'n' };
                }
            }
            else if (colKey === 'total_m2') {
                // Fórmula: M2 * Cantidad
                if (mapColIndex.m2 !== undefined && mapColIndex.cantidad !== undefined) {
                    const lM2 = indexToLetter(mapColIndex.m2);
                    const lCant = indexToLetter(mapColIndex.cantidad);
                    cell = { f: `IF(${lM2}${rowNum}>0, ${lM2}${rowNum}*${lCant}${rowNum}, 0)`, t: 'n' };
                } else {
                    cell = { v: 0, t: 'n' };
                }
            }
            else if (colKey === 'total_global') {
                // Fórmula compleja dependiendo del modo
                // Factor = Si(TotalM2 > 0, TotalM2, Cantidad)
                // Total = (Sum + Inst) * Factor
                
                const lCant = mapColIndex.cantidad !== undefined ? indexToLetter(mapColIndex.cantidad) : null;
                const lTotM2 = mapColIndex.total_m2 !== undefined ? indexToLetter(mapColIndex.total_m2) : null;
                
                // Determinamos la celda "Factor" (Cantidad o Metros)
                let formulaFactor = lCant ? `${lCant}${rowNum}` : '1';
                if (lTotM2) {
                    // Si hay columna Total M2, la usamos prioritariamente si es > 0
                    formulaFactor = `IF(${lTotM2}${rowNum}>0, ${lTotM2}${rowNum}, ${formulaFactor})`;
                }

                // Determinamos Precio Unitario Sumado
                let formulaPrecio = '0';
                
                if (mapColIndex.valor_unitario !== undefined) {
                    // Modo Simple
                    const lUnit = indexToLetter(mapColIndex.valor_unitario);
                    formulaPrecio = `${lUnit}${rowNum}`;
                } 
                else if (mapColIndex.suministro !== undefined && mapColIndex.instalacion !== undefined) {
                    // Modo Mixto (Sumamos las bases y aplicamos impuestos aproximados en la fórmula??)
                    // OJO: Tu excel exporta BASES. El total debe reflejar bases o total con impuestos?
                    // Usualmente en Excel de trabajo quieres ver el total neto.
                    // Vamos a sumar Suministro + Instalacion y multiplicar por factor.
                    const lSum = indexToLetter(mapColIndex.suministro);
                    const lInst = indexToLetter(mapColIndex.instalacion);
                    
                    // Nota: Aquí sumamos bases. Si quieres que el Excel calcule IVA, necesitarías más columnas auxiliares.
                    // Por ahora: (BaseSum + BaseInst) * Factor
                    formulaPrecio = `(${lSum}${rowNum}+${lInst}${rowNum})`;
                }

                cell = { f: `${formulaPrecio}*${formulaFactor}`, t: 'n' };
            }

            rowData.push(cell);
        });
        
        dataRows.push(rowData);
    });

    // 3. Crear Libro
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(dataRows); // Convierte nuestro array avanzado a hoja

    // Ajustar anchos de columna visualmente
    ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 5, 12) }));

    XLSX.utils.book_append_sheet(wb, ws, "Cotización");
    
    // Nombre de archivo con cliente si existe
    const cliente = document.getElementById('cot-cliente')?.value || 'Export';
    XLSX.writeFile(wb, `Cotizacion_${cliente}.xlsx`);
};

// --- AUXILIAR: Actualiza una fila existente sin crear una nueva ---
function actualizarFilaExistente(tr, data) {
    const v = (k) => data[k] || '';
    const vn = (k) => data[k] || 0;

    // Helper para asignar valor
    const setInput = (name, val) => {
        const input = tr.querySelector(`[name="${name}"]`);
        if (input) input.value = val;
    };

    // Actualizamos campos de texto
    setInput('ubicacion', v('ubicacion'));
    
    // Descripción (manteniendo el auto-resize)
    const txtDesc = tr.querySelector('[name="descripcion"]');
    if (txtDesc) {
        txtDesc.value = v('descripcion');
        // Disparar evento para ajustar altura si es necesario
        txtDesc.style.height = 'auto';
        txtDesc.style.height = txtDesc.scrollHeight + 'px';
    }

    // Actualizamos campos numéricos
    setInput('ancho', vn('ancho'));
    setInput('alto', vn('alto'));
    setInput('cantidad', vn('cantidad')); // Si viene vacío ponemos 0, calcularFila pondrá 1 si es necesario

    // Actualizamos financieros
    // Nota: El Excel trae nombres de columna mapeados, asegúrate de enviar los correctos
    if (data.val_suministro !== undefined) setInput('val_suministro', vn('val_suministro'));
    if (data.val_instalacion !== undefined) setInput('val_instalacion', vn('val_instalacion'));
    if (data.valor_unitario !== undefined) setInput('valor_unitario', vn('valor_unitario'));

    // Recalcular esta fila específica para que se actualicen totales y m2
    calcularFila(tr, null, true);
}

// --- C. IMPORTAR ITEMS (INTELIGENTE: ACTUALIZA O CREA) ---
async function procesarArchivoExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!window.XLSX) return alert("Error: Librería XLSX no cargada.");

    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
            
            if (jsonData.length < 2) throw new Error("Archivo vacío.");

            // 1. Mapeo de Encabezados
            const headersExcel = jsonData[0].map(h => (h || '').toString().trim().toUpperCase());
            const mapIndexToKey = {};
            const DICCIONARIO = {};
            
            // Invertir mapa para buscar por nombre de columna Excel
            Object.keys(MAPA_COLUMNAS_EXCEL).forEach(k => {
                DICCIONARIO[MAPA_COLUMNAS_EXCEL[k]] = k;
            });

            headersExcel.forEach((h, i) => {
                if (DICCIONARIO[h]) mapIndexToKey[i] = DICCIONARIO[h];
            });

            // 2. Procesar Filas
            let actualizados = 0;
            let creados = 0;
            const tbody = document.getElementById('items-container');
            const filasExistentes = tbody.children; // Colección en vivo de TRs

            for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row || row.length === 0) continue;

                const itemData = {};
                let tieneData = false;

                row.forEach((val, colIdx) => {
                    const key = mapIndexToKey[colIdx];
                    if (key) {
                        itemData[key] = val;
                        tieneData = true;
                    }
                });

                if (tieneData) {
                    // Normalizar nombres financieros
                    if(itemData.suministro !== undefined) itemData.val_suministro = itemData.suministro;
                    if(itemData.instalacion !== undefined) itemData.val_instalacion = itemData.instalacion;

                    // --- LÓGICA DE ACTUALIZACIÓN ---
                    // El Excel tiene una columna 'item' (ej: 1, 2, 3).
                    // Restamos 1 para obtener el índice del array (0, 1, 2).
                    const indiceFila = (parseInt(itemData.item) || 0) - 1;

                    if (indiceFila >= 0 && indiceFila < filasExistentes.length) {
                        // CASO A: La fila existe -> ACTUALIZAR
                        const trExistente = filasExistentes[indiceFila];
                        
                        // Añadimos un efecto visual para saber que se actualizó
                        trExistente.classList.add('bg-green-50');
                        setTimeout(() => trExistente.classList.remove('bg-green-50'), 2000);
                        
                        actualizarFilaExistente(trExistente, itemData);
                        actualizados++;
                    } else {
                        // CASO B: La fila no existe (ítem nuevo o mayor) -> CREAR
                        agregarFilaItem(itemData);
                        creados++;
                    }
                }
            }
            
            // 3. Recalcular Totales Generales
            recalcularTodo();
            
            alert(`Proceso completado:\n🔄 Actualizados: ${actualizados}\n✨ Nuevos agregados: ${creados}`);

        } catch (error) {
            console.error(error);
            alert("Error al leer Excel: " + error.message);
        } finally {
            e.target.value = ''; // Limpiar input
        }
    };
    reader.readAsArrayBuffer(file);
}

// =============================================================================
// 7. FUNCIÓN CLONAR COTIZACIÓN
// =============================================================================
async function clonarCotizacion(dataOriginal) {
    // 1. Copia profunda de los datos para no afectar la referencia original
    const nuevaData = JSON.parse(JSON.stringify(dataOriginal));

    // 2. Limpieza y Ajustes para la nueva copia
    
    // a) Fecha: Ponemos la de hoy
    const hoy = new Date().toISOString().split('T')[0];
    nuevaData.fecha = hoy;
    
    // b) Proyecto: Le agregamos "(Copia)" para diferenciarla visualmente
    nuevaData.proyecto = `${nuevaData.proyecto} (Copia)`;
    
    // c) Versionamiento: Reiniciamos a Versión 1
    nuevaData.version = 1;
    
    // d) Metadatos del sistema
    nuevaData.createdAt = serverTimestamp();
    nuevaData.updatedAt = serverTimestamp();
    nuevaData.createdBy = _currentUser ? _currentUser.uid : 'anon';
    
    // e) Archivos: ¿Qué hacemos con los archivos adjuntos?
    // Opción A (Segura): No copiarlos, porque los archivos pertenecen a la cotización vieja.
    // Opción B (Riesgosa): Copiar el array. PERO si borras la copia y el sistema borra el archivo de Storage, dañas la original.
    // -> Usaremos Opción A: Empezar sin archivos adjuntos para evitar conflictos.
    nuevaData.archivos = []; 

    // f) Eliminar ID si viniera en la data (Firestore pondrá uno nuevo)
    delete nuevaData.id; 

    try {
        // 3. Guardar en Firestore
        // Importante: No copiamos la subcolección 'historial', así que nace sin historial previo.
        const docRef = await addDoc(collection(_db, "cotizaciones"), nuevaData);
        
        // 4. Feedback y Acción
        // Opción: Abrir la nueva cotización inmediatamente para editarla
        if(confirm("✅ Cotización clonada con éxito.\n¿Deseas abrir la copia para editarla ahora?")) {
            abrirFormularioDetalle(docRef.id);
        }
        
    } catch (error) {
        console.error("Error al clonar:", error);
        alert("Hubo un error al intentar clonar la cotización.");
    }
}