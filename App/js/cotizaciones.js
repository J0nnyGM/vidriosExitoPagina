import {
    collection, query, where, getDocs, orderBy, onSnapshot, doc, getDoc,
    addDoc, serverTimestamp, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// --- Variables Globales ---
let _db, _showView, _currentUser;
let unsubscribeCotizaciones = null;
let _currencyFormatter;
let cotizacionEditandoId = null;
let empresaInfo = null; // <--- NUEVA VARIABLE PARA DATOS DE EMPRESA

// Configuración por defecto
let currentConfig = {
    modo: 'MIXTO',
    columnas: ['item', 'ubicacion', 'descripcion', 'ancho', 'alto', 'cantidad', 'm2', 'valor_unitario', 'total_global'],
    aiu: { admin: 10, imprev: 5, util: 5 },
    split: { sum: 85, inst: 15 }, 
    terminos: { pago: '50% Anticipo', validez: '15 Días', entrega: 'A convenir', notas: '' }
};

// =============================================================================
// 1. INICIALIZADOR
// =============================================================================
export function initCotizaciones(db, showView, currentUser) {
    console.log("--> [Cotizaciones] Inicializando vFinal PDF...");
    _db = db;
    _showView = showView;
    _currentUser = currentUser;
    
    _currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0
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
    const setVal = (n, v) => { const el = tr.querySelector(`[name="${n}"]`); if(el) el.value = v; };

    if (currentConfig.columnas.includes('suministro') && currentConfig.columnas.includes('instalacion')) {
        if (inputChanged && inputChanged.name === 'valor_unitario') {
            const vUnitario = getVal('valor_unitario');
            const split = currentConfig.split || { sum: 85, inst: 15 };
            setVal('val_suministro', vUnitario * (split.sum / 100)); 
            setVal('val_instalacion', vUnitario * (split.inst / 100));
        }
        else if (inputChanged && (inputChanged.name === 'val_suministro' || inputChanged.name === 'val_instalacion')) {
            const sum = getVal('val_suministro');
            const inst = getVal('val_instalacion');
            setVal('valor_unitario', sum + inst);
        }
    }

    const ancho = getVal('ancho');
    const alto = getVal('alto');
    const cant = getVal('cantidad') || 1;
    
    let m2Unit = 0;
    if (ancho > 0 && alto > 0) m2Unit = ancho * alto;
    
    if(tr.querySelector('[name="m2"]')) tr.querySelector('[name="m2"]').value = m2Unit.toFixed(2);
    if(tr.querySelector('[name="total_m2"]')) tr.querySelector('[name="total_m2"]').value = (m2Unit * cant).toFixed(2);
    
    const factor = (m2Unit > 0) ? (m2Unit * cant) : cant;

    const unitarioConImpuestos = getVal('valor_unitario');
    const totalFilaConImpuestos = unitarioConImpuestos * factor;

    let baseSuministro = 0;
    let baseInstalacion = 0;
    const { modo, aiu } = currentConfig;

    if (modo === 'IVA_GLOBAL') {
        baseSuministro = totalFilaConImpuestos / 1.19;
    } 
    else if (modo === 'AIU') {
        const factorAIU = 1 + (aiu.admin/100) + (aiu.imprev/100) + (aiu.util/100) + ((aiu.util/100)*0.19);
        baseInstalacion = totalFilaConImpuestos / factorAIU;
    }
    else if (modo === 'MIXTO') {
        const dineroSum = getVal('val_suministro') * factor;
        const dineroInst = getVal('val_instalacion') * factor;
        baseSuministro = dineroSum / 1.19;
        const factorAIU = 1 + (aiu.admin/100) + (aiu.imprev/100) + (aiu.util/100) + ((aiu.util/100)*0.19);
        baseInstalacion = dineroInst / factorAIU;
    }

    const disp = tr.querySelector('.display-total');
    if (disp) {
        disp.textContent = _currencyFormatter.format(totalFilaConImpuestos);
        disp.dataset.baseSum = baseSuministro;
        disp.dataset.baseInst = baseInstalacion;
        disp.dataset.totalVisual = totalFilaConImpuestos;
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
        const vAdmin = directo * (aiu.admin/100);
        const vImpr = directo * (aiu.imprev/100);
        const vUtil = directo * (aiu.util/100);
        const vIvaUtil = vUtil * 0.19;
        data.totalFinal = directo + vAdmin + vImpr + vUtil + vIvaUtil;

        data.html = `
            <div class="flex justify-between"><span>Costo Directo:</span> <span class="font-medium">${_currencyFormatter.format(directo)}</span></div>
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
        const vAdmin = directo * (aiu.admin/100);
        const vImpr = directo * (aiu.imprev/100);
        const vUtil = directo * (aiu.util/100);
        const vIvaInst = vUtil * 0.19;
        const totalParteInst = directo + vAdmin + vImpr + vUtil + vIvaInst;

        data.totalFinal = totalParteSum + totalParteInst;

        data.html = `
            <div class="flex justify-between text-blue-700"><span>Base Suministro:</span> <span class="font-bold">${_currencyFormatter.format(totalBaseSum)}</span></div>
            <div class="flex justify-between text-xs text-blue-400 mb-2"><span>IVA Sum (19%):</span> <span>${_currencyFormatter.format(ivaSum)}</span></div>
            
            <div class="flex justify-between text-emerald-700 border-t border-dashed pt-2"><span>Base Instalación:</span> <span class="font-bold">${_currencyFormatter.format(directo)}</span></div>
            <div class="flex justify-between text-xs text-emerald-600"><span>AIU Inst (${aiu.admin+aiu.imprev+aiu.util}%):</span> <span>${_currencyFormatter.format(vAdmin+vImpr+vUtil)}</span></div>
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

async function generarPDF() {
    if (!empresaInfo) await cargarDatosEmpresa();
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'letter'); 
    
    // --- CONFIGURACIÓN DE DIMENSIONES ---
    const PAGE_WIDTH = doc.internal.pageSize.width; // ~215.9mm
    const PAGE_HEIGHT = doc.internal.pageSize.height;
    
    // Márgenes para texto (Carta / Icontec)
    const MARGIN_LEFT = 30; 
    const MARGIN_RIGHT = 20; 

    // Márgenes para la TABLA (Más anchos para que quepan 11 columnas)
    const T_MARGIN_LEFT = 10;
    const T_MARGIN_RIGHT = 10;
    const TABLE_WIDTH = PAGE_WIDTH - T_MARGIN_LEFT - T_MARGIN_RIGHT;

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
    const fecha = document.getElementById('cot-fecha').value;
    const cliente = document.getElementById('cot-cliente').value.toUpperCase();
    const proyecto = document.getElementById('cot-proyecto').value.toUpperCase();

    doc.setFontSize(11);
    doc.text(`Bogotá D.C., ${fecha}`, MARGIN_LEFT, yPos);
    yPos += 10;

    doc.setFont("times", "bold");
    doc.text("Señores:", MARGIN_LEFT, yPos); yPos += 5;
    doc.text(cliente, MARGIN_LEFT, yPos); yPos += 5;

    doc.setFont("times", "normal");
    if(proyecto) {
        doc.text(`Proyecto: ${proyecto}`, MARGIN_LEFT, yPos); yPos += 5;
    }
    doc.text("Ciudad", MARGIN_LEFT, yPos); 
    yPos += 10;
    doc.text("Apreciados Señores, adjunto cotización según solicitud:", MARGIN_LEFT, yPos);
    yPos += 8;

    // --- C. TABLA DE ÍTEMS ---
    const configCols = currentConfig.columnas;
    const headers = [];
    const bodyData = [];
    
    // Lógica de Desglose
    const hasSum = configCols.includes('suministro');
    const hasInst = configCols.includes('instalacion');

    // 1. Encabezados
    if(configCols.includes('item')) headers.push('ITEM');
    if(configCols.includes('ubicacion')) headers.push('UBICACIÓN');
    if(configCols.includes('descripcion')) headers.push('DESCRIPCIÓN');
    if(configCols.includes('ancho')) headers.push('ANCHO');
    if(configCols.includes('alto')) headers.push('ALTO');
    if(configCols.includes('cantidad')) headers.push('CANT');
    if(configCols.includes('m2')) headers.push('M2');

    if (hasSum && hasInst) {
        // En modo desglose NO mostramos V.Unit global ni Total Global en la fila
        headers.push('VR. SUM');
        headers.push('TOTAL SUM');
        headers.push('VR. INST');
        headers.push('TOTAL INST');
    } else {
        if(configCols.includes('valor_unitario')) headers.push('V. UNIT');
        headers.push('TOTAL');
    }

    // 2. Filas
    document.querySelectorAll('#items-container tr').forEach((tr, idx) => {
        const row = [];
        const getVal = (name) => tr.querySelector(`[name="${name}"]`)?.value || '';
        const getNum = (name) => parseFloat(tr.querySelector(`[name="${name}"]`)?.value) || 0;
        
        if(!getVal('descripcion')) return;

        if(configCols.includes('item')) row.push(idx + 1);
        if(configCols.includes('ubicacion')) row.push(getVal('ubicacion'));
        if(configCols.includes('descripcion')) row.push(getVal('descripcion'));
        if(configCols.includes('ancho')) row.push(getVal('ancho'));
        if(configCols.includes('alto')) row.push(getVal('alto'));
        if(configCols.includes('cantidad')) row.push(getVal('cantidad'));
        if(configCols.includes('m2')) row.push(getVal('m2'));
        
        const m2Total = getNum('total_m2');
        const cantidad = getNum('cantidad');
        const factor = m2Total > 0 ? m2Total : (cantidad || 1);

        if (hasSum && hasInst) {
            const valSum = getNum('val_suministro');
            const valInst = getNum('val_instalacion');
            row.push(_currencyFormatter.format(valSum));
            row.push(_currencyFormatter.format(valSum * factor));
            row.push(_currencyFormatter.format(valInst));
            row.push(_currencyFormatter.format(valInst * factor));
        } else {
            if(configCols.includes('valor_unitario')) {
                row.push(_currencyFormatter.format(getNum('valor_unitario')));
            }
            row.push(tr.querySelector('.display-total').textContent);
        }
        bodyData.push(row);
    });

    // 3. Estilos de Columna (CRÍTICO PARA QUE QUEPA)
    // Definimos anchos fijos para columnas numéricas para ahorrar espacio
    const colStyles = {
        0: { cellWidth: 8, halign: 'center' }, // ITEM
        // La descripción (columna 2 usualmente) será 'auto' para llenar espacio
    };

    // Calcular índice de la columna descripción para dejarla flexible
    let descIndex = -1;
    let colIndex = 0;
    if(configCols.includes('item')) colIndex++;
    if(configCols.includes('ubicacion')) colIndex++;
    if(configCols.includes('descripcion')) { descIndex = colIndex; colIndex++; }
    
    if(descIndex > -1) colStyles[descIndex] = { cellWidth: 'auto' };

    // Alinear a la derecha las últimas columnas (financieras)
    const totalCols = headers.length;
    colStyles[totalCols - 1] = { halign: 'right', fontStyle: 'bold' }; // Total Inst o Total
    colStyles[totalCols - 2] = { halign: 'right' };
    if(hasSum && hasInst) {
        colStyles[totalCols - 3] = { halign: 'right', fontStyle: 'bold' }; // Total Sum
        colStyles[totalCols - 4] = { halign: 'right' };
    }

    doc.autoTable({
        startY: yPos,
        head: [headers],
        body: bodyData,
        theme: 'grid',
        styles: { 
            font: 'times', 
            fontSize: 6.5, // Fuente reducida para evitar desbordamiento
            cellPadding: 1.5, 
            lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0],
            valign: 'middle'
        },
        headStyles: { 
            fillColor: [0, 176, 240], // #00B0F0
            textColor: [0, 0, 0],     // Negro
            fontStyle: 'bold',        // Negrilla
            halign: 'center',
            lineWidth: 0.1, lineColor: [0, 0, 0]
        },
        columnStyles: colStyles,
        margin: { left: T_MARGIN_LEFT, right: T_MARGIN_RIGHT },
        tableWidth: 'auto' // Deja que autoTable calcule el mejor ajuste
    });

    let finalY = doc.lastAutoTable.finalY;

    // --- D. CUADRO DE TOTALES (CORREGIDO Y SEGURO) ---

    const calculos = calcularTotalesGenerales();
    const bd = calculos.breakdown;
    const aiu = currentConfig.aiu;

    let totalsBody = [];
    let totalsHead = null;
    let totalsColumnStyles = {};
    
    // 1. Valores por defecto (Fallback) para evitar el error si falla el cálculo
    let totalsTableWidth = currentConfig.modo === 'MIXTO' ? 120 : 75;
    let totalsMarginLeft = PAGE_WIDTH - T_MARGIN_RIGHT - totalsTableWidth;

    // 2. Intento de alineación dinámica segura
    try {
        const lastTable = doc.lastAutoTable;
        if (lastTable && lastTable.columns && lastTable.columns.length > 0) {
            const cols = lastTable.columns;
            const tableWidth = lastTable.table ? lastTable.table.width : (PAGE_WIDTH - T_MARGIN_LEFT - T_MARGIN_RIGHT);
            const tableRightX = T_MARGIN_LEFT + tableWidth;
            const len = cols.length;

            if (currentConfig.modo === 'MIXTO') {
                // Indices de las últimas 4 columnas (VR.SUM, TOT.SUM, VR.INST, TOT.INST)
                const idxTotInst = len - 1;
                const idxVrInst = len - 2;
                const idxTotSum = len - 3;
                const idxVrSum = len - 4;

                // VERIFICACIÓN DE SEGURIDAD: Solo accedemos a .width si las columnas existen
                if (cols[idxVrSum] && cols[idxTotSum] && cols[idxVrInst] && cols[idxTotInst]) {
                    
                    const wInst = cols[idxVrInst].width + cols[idxTotInst].width;
                    let wSum = cols[idxVrSum].width + cols[idxTotSum].width;

                    // Si es muy estrecho, tomar prestado espacio de la columna anterior (M2) si existe
                    if (wSum < 35 && len > 4 && cols[len - 5]) {
                        wSum += cols[len - 5].width;
                    }

                    totalsTableWidth = wSum + wInst;
                    totalsMarginLeft = tableRightX - totalsTableWidth;

                    totalsColumnStyles = {
                        0: { cellWidth: wSum * 0.6, halign: 'left' },
                        1: { cellWidth: wSum * 0.4, halign: 'right' },
                        2: { cellWidth: wInst * 0.5, halign: 'left' },
                        3: { cellWidth: wInst * 0.5, halign: 'right' }
                    };
                }
            } else {
                // Modo AIU o SIMPLE: Alinear con las últimas 2 columnas si es posible
                if (len >= 2 && cols[len - 1] && cols[len - 2]) {
                    let wLast = cols[len - 1].width + cols[len - 2].width;
                    if (wLast < 60) wLast = 70; // Ancho mínimo
                    
                    totalsTableWidth = wLast;
                    totalsMarginLeft = tableRightX - totalsTableWidth;
                    
                    totalsColumnStyles = {
                        0: { halign: 'left', fontStyle: 'bold' },
                        1: { halign: 'right', fontStyle: 'normal' }
                    };
                }
            }
        }
    } catch (e) {
        console.warn("Alineación automática omitida, usando defecto:", e);
    }

    // 3. Construcción del contenido (Lógica original mantenida)
    if (currentConfig.modo === 'MIXTO') {
        const totalInstalacion = bd.directo + bd.vAdmin + bd.vImpr + bd.vUtil + bd.vIvaInst;
        const totalSuministro = bd.totalBaseSum + bd.ivaSum;

        totalsHead = [[
            { content: 'SUMINISTRO', colSpan: 2, styles: { halign: 'center', fontStyle: 'bold', fillColor: [240, 240, 240] } },
            { content: 'INSTALACIÓN', colSpan: 2, styles: { halign: 'center', fontStyle: 'bold', fillColor: [240, 240, 240] } }
        ]];

        totalsBody = [
            [
                { content: 'SUB TOTAL', styles: { fontStyle: 'bold' } }, { content: _currencyFormatter.format(bd.totalBaseSum) },
                { content: 'COSTO DIRECTO', styles: { fontStyle: 'bold' } }, { content: _currencyFormatter.format(bd.directo) }
            ],
            [
                { content: 'IVA 19%', styles: { fontStyle: 'bold' } }, { content: _currencyFormatter.format(bd.ivaSum) },
                { content: `ADMIN. ${aiu.admin}%`, styles: { fontStyle: 'bold' } }, { content: _currencyFormatter.format(bd.vAdmin) }
            ],
            [
                { content: 'TOTAL SUMINISTRO', styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } },
                { content: _currencyFormatter.format(totalSuministro), styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } },
                { content: `IMPREV. ${aiu.imprev}%`, styles: { fontStyle: 'bold' } }, { content: _currencyFormatter.format(bd.vImpr) }
            ],
            [
                { content: '', styles: { lineWidth: 0 } }, { content: '', styles: { lineWidth: 0 } },
                { content: `UTILIDAD ${aiu.util}%`, styles: { fontStyle: 'bold' } }, { content: _currencyFormatter.format(bd.vUtil) }
            ],
            [
                { content: '', styles: { lineWidth: 0 } }, { content: '', styles: { lineWidth: 0 } },
                { content: 'IVA / UTILIDAD', styles: { fontStyle: 'bold' } }, { content: _currencyFormatter.format(bd.vIvaInst) }
            ],
            [
                { content: '', styles: { lineWidth: 0 } }, { content: '', styles: { lineWidth: 0 } },
                { content: 'TOTAL INSTALACIÓN', styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } },
                { content: _currencyFormatter.format(totalInstalacion), styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } }
            ],
            [
                { content: 'VALOR TOTAL DE LA PROPUESTA', colSpan: 3, styles: { fontStyle: 'bold', halign: 'right', fontSize: 9, fillColor: [0, 176, 240], textColor: 255 } },
                { content: _currencyFormatter.format(calculos.totalFinal), styles: { halign: 'right', fontStyle: 'bold', fontSize: 9, fillColor: [0, 176, 240], textColor: 255 } }
            ]
        ];
    } else {
        // MODO AIU / SIMPLE
        if (currentConfig.modo === 'AIU') {
             totalsBody.push(["COSTO DIRECTO:", _currencyFormatter.format(bd.directo)]);
             totalsBody.push([`ADMINISTRACIÓN ${aiu.admin}%:`, _currencyFormatter.format(bd.vAdmin)]);
             totalsBody.push([`IMPREVISTOS ${aiu.imprev}%:`, _currencyFormatter.format(bd.vImpr)]);
             totalsBody.push([`UTILIDAD ${aiu.util}%:`, _currencyFormatter.format(bd.vUtil)]);
             totalsBody.push(["IVA (Sobre Utilidad):", _currencyFormatter.format(bd.vIvaUtil)]);
        } else {
             totalsBody.push(["SUB TOTAL:", _currencyFormatter.format(bd.subtotal)]);
             totalsBody.push(["IVA (19%):", _currencyFormatter.format(bd.iva)]);
        }
        totalsBody.push([
            { content: "VALOR TOTAL:", styles: { fillColor: [0, 176, 240], textColor: 255, fontStyle: 'bold' } }, 
            { content: _currencyFormatter.format(calculos.totalFinal), styles: { fillColor: [0, 176, 240], textColor: 255, fontStyle: 'bold', halign: 'right' } }
        ]);
    }

    // Verificar salto de página
    const estimatedBoxHeight = 5 * totalsBody.length + 10;
    if (finalY + estimatedBoxHeight > PAGE_HEIGHT - 30) {
        doc.addPage();
        finalY = 20;
    } else {
        finalY += 2;
    }

    // Dibujar
    doc.autoTable({
        startY: finalY,
        head: totalsHead,
        body: totalsBody,
        theme: 'grid',
        styles: {
            font: 'times',
            fontSize: 7,
            cellPadding: 1.5,
            lineColor: [100, 100, 100],
            lineWidth: 0.1,
            textColor: 0
        },
        columnStyles: totalsColumnStyles,
        margin: { left: totalsMarginLeft },
        tableWidth: totalsTableWidth
    });

    finalY = doc.lastAutoTable.finalY + 10;

    // --- E. CONDICIONES Y FIRMA ---
    if (finalY > PAGE_HEIGHT - 60) { doc.addPage(); finalY = 20; }

    doc.setFontSize(9);
    doc.setFont("times", "normal");
    
    const terminos = [
        `Forma de pago: ${document.getElementById('term-pago').value}`,
        `Validez de la oferta: ${document.getElementById('term-validez').value}`,
        `Tiempo de entrega: ${document.getElementById('term-entrega').value}`
    ];
    if(document.getElementById('term-notas').value) terminos.push(`Nota: ${document.getElementById('term-notas').value}`);

    terminos.forEach(t => {
        doc.text(t, MARGIN_LEFT, finalY);
        finalY += 5;
    });

    // Firma
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
        const footerY = PAGE_HEIGHT - 20;
        doc.setFontSize(8); doc.setFont("times", "bold"); doc.setTextColor(0, 0, 0);

        const l1 = "VENTANERIA FACHADAS-DIVISIONES DE OFICINA –DIVISIONES DE BAÑO, VIDRIO TEMPLADO";
        doc.text(l1, PAGE_WIDTH/2, footerY, { align: 'center' });
        
        const l2 = "PELICULA DE SEGURIDAD- VENTANAS ACUSTICAS-VIDRIOS ACUSTICOS.";
        doc.text(l2, PAGE_WIDTH/2, footerY + 4, { align: 'center' });
        
        doc.setFont("times", "normal");
        const l3 = `${empresaInfo.direccion || ''} | ${empresaInfo.email || ''} | ${empresaInfo.telefono || ''}`;
        doc.text(l3, PAGE_WIDTH/2, footerY + 9, { align: 'center' });
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
    
    if(listView) { listView.classList.remove('hidden'); listView.style.display = 'block'; }
    if(detailView) { detailView.classList.add('hidden'); detailView.style.display = 'none'; }
    if(modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }

    cargarListaFirebase();
}

function abrirModalConfiguracion(esEdicion = false) {
    const modal = document.getElementById('modal-config-cotizacion');
    if(!modal) return alert("Falta HTML del modal");
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    if (esEdicion || cotizacionEditandoId) {
        document.getElementById('config-modo').value = currentConfig.modo;
        
        document.getElementById('conf-admin').value = currentConfig.aiu.admin;
        document.getElementById('conf-imprev').value = currentConfig.aiu.imprev;
        document.getElementById('conf-util').value = currentConfig.aiu.util;
        
        if(currentConfig.split) {
            document.getElementById('conf-split-sum').value = currentConfig.split.sum;
            document.getElementById('conf-split-inst').value = currentConfig.split.inst;
        }

        if(currentConfig.terminos) {
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

    if(document.getElementById('term-pago')) document.getElementById('term-pago').value = terminos.pago;
    if(document.getElementById('term-validez')) document.getElementById('term-validez').value = terminos.validez;
    if(document.getElementById('term-entrega')) document.getElementById('term-entrega').value = terminos.entrega;

    if (!cotizacionEditandoId) {
        abrirFormularioDetalle(null, true);
    } else {
        reconstruirTabla();
        recalcularTodo(); 
    }
}

async function abrirFormularioDetalle(id = null, esNueva = false) {
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
                if(data.config) currentConfig = data.config;
                
                document.getElementById('cot-cliente').value = data.cliente;
                document.getElementById('cot-proyecto').value = data.proyecto;
                document.getElementById('cot-fecha').value = data.fecha;
                
                if(data.terminos) {
                    document.getElementById('term-pago').value = data.terminos.pago;
                    document.getElementById('term-validez').value = data.terminos.validez;
                    document.getElementById('term-entrega').value = data.terminos.entrega;
                    document.getElementById('term-notas').value = data.terminos.notas || '';
                }

                reconstruirTabla();
                tbody.innerHTML = '';
                if(data.items) {
                    data.items.forEach(item => agregarFilaItem(item));
                }
                recalcularTodo(); 
            }
        } catch (e) {
            console.error(e);
        }
    }
    
    document.getElementById('label-modo-cobro').textContent = `MODO: ${currentConfig.modo}`;
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
        cantidad: '<th class="px-2 py-3 text-center w-16">Cant</th>',
        m2: '<th class="px-2 py-3 text-right w-20 text-slate-500">M²</th>',
        total_m2: '<th class="px-2 py-3 text-right w-20 text-slate-500">Total M²</th>',
        suministro: '<th class="px-2 py-3 text-right w-28 bg-blue-50 text-blue-800">Suministro</th>',
        instalacion: '<th class="px-2 py-3 text-right w-28 bg-emerald-50 text-emerald-800">Instalación</th>',
        valor_unitario: '<th class="px-2 py-3 text-right w-28 font-bold">V. Unitario</th>',
        total_global: '<th class="px-2 py-3 text-right w-28 font-bold">Total</th>'
    };

    currentConfig.columnas.forEach(col => { if(map[col]) html += map[col]; });
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
        if(col === 'item') html += `<td class="p-2"><span class="text-xs font-bold text-slate-400 block text-center">${tbody.children.length + 1}</span></td>`;
        else if(col === 'ubicacion') html += `<td class="p-2"><input type="text" name="ubicacion" class="w-full p-1 border rounded text-xs" value="${v('ubicacion')}"></td>`;
        else if(col === 'descripcion') html += `<td class="p-2"><textarea name="descripcion" rows="1" class="w-full p-1 border rounded text-xs resize-none">${v('descripcion')}</textarea></td>`;
        else if(col === 'ancho') html += `<td class="p-2"><input type="number" step="0.01" name="ancho" class="inputs-calc w-full p-1 border rounded text-right text-xs" placeholder="0.00" value="${v('ancho')}"></td>`;
        else if(col === 'alto') html += `<td class="p-2"><input type="number" step="0.01" name="alto" class="inputs-calc w-full p-1 border rounded text-right text-xs" placeholder="0.00" value="${v('alto')}"></td>`;
        else if(col === 'cantidad') html += `<td class="p-2"><input type="number" name="cantidad" class="inputs-calc w-full p-1 border rounded text-center text-xs font-bold" value="${vn('cantidad') || 1}"></td>`;
        else if(col === 'm2') html += `<td class="p-2"><input type="text" name="m2" readonly class="w-full p-1 bg-slate-100 text-slate-500 rounded text-right text-xs" value="0.00"></td>`;
        else if(col === 'total_m2') html += `<td class="p-2"><input type="text" name="total_m2" readonly class="w-full p-1 bg-slate-100 text-slate-500 rounded text-right text-xs" value="0.00"></td>`;
        else if(col === 'suministro') html += `<td class="p-2"><input type="number" name="val_suministro" class="inputs-calc w-full p-1 border border-blue-200 bg-blue-50/50 rounded text-right text-xs" value="${vn('val_suministro')}"></td>`;
        else if(col === 'instalacion') html += `<td class="p-2"><input type="number" name="val_instalacion" class="inputs-calc w-full p-1 border border-emerald-200 bg-emerald-50/50 rounded text-right text-xs" value="${vn('val_instalacion')}"></td>`;
        else if(col === 'valor_unitario') html += `<td class="p-2"><input type="number" name="valor_unitario" class="inputs-calc w-full p-1 border rounded text-right text-xs font-bold" value="${vn('valor_unitario')}"></td>`;
        else if(col === 'total_global') html += `<td class="p-2"><div class="display-total text-right text-xs font-bold text-slate-700" data-raw="0">$0</div></td>`;
    });

    html += `<td class="p-2 text-center"><button type="button" class="btn-remove text-slate-300 hover:text-red-500 cursor-pointer"><i class="fa-solid fa-trash"></i></button></td>`;
    
    tr.innerHTML = html;
    tbody.appendChild(tr);
    
    calcularFila(tr, null, true);
}

// --- CRUD ---
async function guardarCotizacion(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        const items = [];
        document.querySelectorAll('#items-container tr').forEach(tr => {
            const item = {};
            tr.querySelectorAll('input, textarea').forEach(i => item[i.name] = i.value);
            if(item.descripcion) items.push(item);
        });

        if(!items.length) throw new Error("La cotización está vacía.");

        const total = calcularTotalesGenerales().totalFinal;
        const data = {
            cliente: document.getElementById('cot-cliente').value,
            proyecto: document.getElementById('cot-proyecto').value,
            fecha: document.getElementById('cot-fecha').value,
            config: currentConfig,
            items,
            terminos: {
                pago: document.getElementById('term-pago').value,
                validez: document.getElementById('term-validez').value,
                entrega: document.getElementById('term-entrega').value,
                notas: document.getElementById('term-notas').value
            },
            totalFinal: total,
            updatedAt: serverTimestamp()
        };

        if(cotizacionEditandoId) {
            await updateDoc(doc(_db, "cotizaciones", cotizacionEditandoId), data);
        } else {
            data.createdAt = serverTimestamp();
            data.createdBy = _currentUser ? _currentUser.uid : 'anon';
            await addDoc(collection(_db, "cotizaciones"), data);
        }

        cerrarVistaDetalle();

    } catch (e) {
        console.error(e);
        alert(e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
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
            tr.innerHTML = `
                <td class="px-6 py-4 font-bold">${d.cliente}</td>
                <td class="px-6 py-4 text-sm">${d.proyecto}</td>
                <td class="px-6 py-4 text-sm">${d.fecha}</td>
                <td class="px-6 py-4 font-bold">${_currencyFormatter.format(d.totalFinal)}</td>
                <td class="px-6 py-4 text-right">
                    <button class="btn-edit text-blue-600 hover:bg-blue-50 p-2 rounded mr-2" data-id="${docSnap.id}"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-del text-red-600 hover:bg-red-50 p-2 rounded" data-id="${docSnap.id}"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            
            // Listeners directos a los elementos creados
            const editBtn = tr.querySelector('.btn-edit');
            const delBtn = tr.querySelector('.btn-del');
            
            if(editBtn) editBtn.onclick = () => abrirFormularioDetalle(docSnap.id);
            if(delBtn) delBtn.onclick = async () => { 
                if(confirm('¿Borrar?')) await deleteDoc(docSnap.ref); 
            };
            
            tbody.appendChild(tr);
        });
    });
}