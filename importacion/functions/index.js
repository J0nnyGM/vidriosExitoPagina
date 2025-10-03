// index.js (en tu carpeta /functions)
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");
const { jsPDF } = require("jspdf");
require("jspdf-autotable");
const axios = require("axios");
const { getStorage } = require("firebase-admin/storage");
const { PDFDocument, rgb, StandardFonts, PageSizes } = require("pdf-lib");
const cors = require("cors")({ origin: true });


admin.initializeApp();
const db = admin.firestore();

// Configurar SendGrid
sgMail.setApiKey(process.env.SENDGRID_KEY);
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL;

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

const BUCKET_NAME = "vidrioexpres1.firebasestorage.app";

// **** INICIO DE LA NUEVA FUNCIÓN ****
/**
 * Se activa cuando un nuevo usuario se crea en Firebase Authentication.
 * Revisa si es el primer usuario y, si es así, le asigna el rol de 'admin' y lo activa.
 */
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
    const usersCollection = admin.firestore().collection("users");

    // Revisa cuántos documentos hay en la colección de usuarios.
    const snapshot = await usersCollection.limit(2).get();

    // Si solo hay 1 documento (el que se acaba de crear en el app.js), es el primer usuario.
    if (snapshot.size === 1) {
        functions.logger.log(`Asignando rol de 'admin' y estado 'active' al primer usuario: ${user.uid}`);
        // Actualiza el documento del usuario para cambiar su rol y estado.
        return usersCollection.doc(user.uid).update({
            role: "admin",
            status: "active",
            "permissions.facturacion": true,
            "permissions.clientes": true,
            "permissions.items": true,
            "permissions.colores": true,
            "permissions.gastos": true,
            "permissions.proveedores": true,
            "permissions.empleados": true,
        });
    }

    functions.logger.log(`El nuevo usuario ${user.uid} se ha registrado con rol 'planta' y estado 'pending'.`);
    return null; // No hace nada para los siguientes usuarios.
});

/**
 * Formatea un número como moneda colombiana (COP).
 * @param {number} value El valor numérico a formatear.
 * @return {string} El valor formateado como moneda.
 */
function formatCurrency(value) {
    return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        minimumFractionDigits: 0,
    }).format(value || 0);
}

// Función HTTP que devuelve la configuración de Firebase del lado del cliente.
exports.getFirebaseConfig = functions.https.onRequest((request, response) => {
    // Usamos cors para permitir que tu página web llame a esta función.
    cors(request, response, () => {
        // Verifica que la configuración exista antes de enviarla.
        if (!functions.config().prisma) {
            return response.status(500).json({
                error: "La configuración de Firebase no está definida en el servidor.",
            });
        }
        // Envía la configuración como una respuesta JSON.
        return response.status(200).json(functions.config().prisma);
    });
});

/**
 * --- NUEVO: Formatea un número de teléfono de Colombia al formato E.164. ---
 * @param {string} phone El número de teléfono.
 * @return {string|null} El número formateado o null si es inválido.
 */
function formatColombianPhone(phone) {
    if (!phone || typeof phone !== "string") {
        return null;
    }
    let cleanPhone = phone.replace(/[\s-()]/g, "");
    if (cleanPhone.startsWith("57")) {
        return cleanPhone;
    }
    if (cleanPhone.length === 10) {
        return `57${cleanPhone}`;
    }
    return null;
}

/**
 * --- VERSIÓN CORREGIDA Y ROBUSTA ---
 * Envía un mensaje de plantilla de WhatsApp con un documento.
 * AÑADIDO: .trim() para limpiar espacios en blanco en las variables de texto.
 * @param {string} toPhoneNumber Número del destinatario en formato E.164.
 * @param {string} customerName Nombre del cliente para la plantilla.
 * @param {string} remisionNumber Número de la remisión.
 * @param {string} status Estado actual de la remisión.
 * @param {string} pdfUrl URL pública del PDF a enviar.
 * @return {Promise<object>} La respuesta de la API de Meta.
 */
async function sendWhatsAppRemision(toPhoneNumber, customerName, remisionNumber, status, pdfUrl) {
    const formattedPhone = formatColombianPhone(toPhoneNumber);
    if (!formattedPhone) {
        functions.logger.error(`Número de teléfono inválido o no se pudo formatear a E.164: ${toPhoneNumber}`);
        return;
    }

    const API_VERSION = "v19.0";
    const url = `https://graph.facebook.com/${API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const payload = {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "template",
        template: {
            name: "envio_remision",
            language: { code: "es" },
            components: [
                {
                    type: "header",
                    parameters: [{
                        type: "document",
                        document: { link: pdfUrl, filename: `Remision-${String(remisionNumber)}.pdf` },
                    }],
                },
                {
                    type: "body",
                    parameters: [
                        { type: "text", text: String(customerName) },
                        { type: "text", text: String(remisionNumber) },
                        { type: "text", text: String(status) },
                    ],
                },
            ],
        },
    };

    const headers = {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
    };

    try {
        // --- LÍNEA DE DIAGNÓSTICO AÑADIDA ---
        // Esto nos mostrará el paquete de datos completo que se envía a Meta.
        functions.logger.info("Enviando el siguiente payload a WhatsApp:", JSON.stringify(payload, null, 2));

        await axios.post(url, payload, { headers });
        functions.logger.info(`Solicitud de envío a WhatsApp para ${formattedPhone} fue aceptada por Meta.`);
    } catch (error) {
        if (error.response) {
            functions.logger.error(`WhatsApp API Error Detallado para ${formattedPhone}:`, JSON.stringify(error.response.data, null, 2));
        }
        throw new Error(`Falló el envío de WhatsApp a ${formattedPhone}: ${error.message}`);
    }
}
/**
 * --- VERSIÓN FINAL Y DEFINITIVA ---
 * 1.  Corrige el error de la firma repetida, asegurando que la sección
 * "Firma y Sello" aparezca UNA SOLA VEZ en la última página del documento.
 * 2.  Mantiene todas las demás funcionalidades intactas.
 * @param {object} remision El objeto con los datos de la remisión.
 * @return {Buffer} El PDF como un buffer de datos.
 */
function generarPDFCliente(remision) {
    const { jsPDF } = require("jspdf");
    require("jspdf-autotable");

    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.height;
    const headerHeight = 85;
    const footerMargin = 20; // Espacio solo para el número de página

    const addHeader = () => {
        doc.setFont("helvetica", "bold").setFontSize(18).text("Remisión de Servicio", 105, 20, { align: "center" });
        doc.setFontSize(10).setFont("helvetica", "bold").text("IMPORTADORA VIDRIO EXPRESS SAS", 105, 28, { align: "center" });
        doc.setFont("helvetica", "normal").text("Tels: 311 8109893 - 310 2557543", 105, 33, { align: "center" });
        doc.text("Cra 27 No 67-58", 105, 38, { align: "center" });
        doc.setFontSize(14).setFont("helvetica", "bold").text(`Remisión N°: ${remision.numeroRemision}`, 190, 45, { align: "right" });
    };

    // --- LÓGICA DE PIE DE PÁGINA CORREGIDA ---
    const addPageNumber = (data) => {
        doc.setFontSize(8);
        doc.text(`Página ${data.pageNumber} de ${data.pageCount}`, 105, pageHeight - 10, { align: 'center' });
    };

    const addFinalSignature = () => {
        const footerY = pageHeight - 45;
        doc.line(40, footerY, 120, footerY); // Línea de Firma
        doc.setFontSize(10).setFont("helvetica", "normal").text("Firma y Sello de Recibido", 75, footerY + 5, { align: "center" });
        doc.setLineCap(2).line(20, footerY + 20, 190, footerY + 20);
        doc.setFontSize(8).setFont("helvetica", "bold");
        doc.text("NO SE ENTREGA TRABAJO SINO HA SIDO CANCELADO.", 105, footerY + 25, { align: "center" });
        doc.text("DESPUES DE 8 DIAS NO SE RESPONDE POR MERCANCIA.", 105, footerY + 29, { align: "center" });
    };

    const headColumns = [['Referencia', 'Descripción', 'Cant.', 'Vlr. Unit.', 'Subtotal']];
    const bodyRows = [];
    remision.items.forEach(item => {
        const desc = item.tipo === 'Cortada' ? `${item.descripcion} (Cortes)` : item.descripcion;
        bodyRows.push([item.referencia, desc, item.cantidad, formatCurrency(item.valorUnitario), formatCurrency(item.valorTotal)]);
    });
    if (remision.cargosAdicionales && remision.cargosAdicionales.length > 0) {
        remision.cargosAdicionales.forEach(cargo => {
            bodyRows.push(['N/A', cargo.descripcion, 1, formatCurrency(cargo.valorUnitario), formatCurrency(cargo.valorTotal)]);
        });
    }

    doc.autoTable({
        head: headColumns,
        body: bodyRows,
        startY: headerHeight,
        theme: 'grid',
        headStyles: { fillColor: [22, 160, 133] },
        margin: { top: 50, bottom: footerMargin },
        didDrawPage: function (data) {
            addHeader();
            addPageNumber(data); // Solo el número de página se dibuja aquí

            if (data.pageNumber === 1) {
                doc.setFontSize(11).setFont("helvetica", "bold").text("Cliente:", 20, 60).setFont("helvetica", "normal").text(remision.clienteNombre, 55, 60);
                doc.setFont("helvetica", "bold").text("Correo:", 20, 66).setFont("helvetica", "normal").text(remision.clienteEmail || 'N/A', 55, 66);
                doc.setFont("helvetica", "bold").text("Teléfono:", 20, 72).setFont("helvetica", "normal").text(remision.clienteTelefono || 'N/A', 55, 72);
                doc.setFont("helvetica", "bold").text("Fecha Recibido:", 120, 60).setFont("helvetica", "normal").text(remision.fechaRecibido, 160, 60);
                doc.setFont("helvetica", "bold").text("Fecha Entrega:", 120, 66).setFont("helvetica", "normal").text(remision.fechaEntrega || "Pendiente", 160, 66);
                doc.setFont("helvetica", "bold").text("Forma de Pago:", 120, 72).setFont("helvetica", "normal").text(remision.formaPago, 160, 72);
                doc.setFont("helvetica", "bold").text("Estado:", 120, 78).setFont("helvetica", "normal").text(remision.estado, 160, 78);
            }
        }
    });

    const finalY = doc.lastAutoTable.finalY;
    const pageCount = doc.internal.getNumberOfPages();
    doc.setPage(pageCount);
    let yPos = finalY + 15;
    const spaceNeeded = 80; // Espacio para totales y firma

    if (yPos > pageHeight - spaceNeeded) {
        doc.addPage();
        addHeader();
        addPageNumber({ pageNumber: pageCount + 1, pageCount: pageCount + 1 });
        yPos = headerHeight;
    }

    doc.setFontSize(12).setFont("helvetica", "bold").text("Subtotal:", 130, yPos);
    doc.setFont("helvetica", "normal").text(formatCurrency(remision.subtotal), 190, yPos, { align: "right" });
    yPos += 7;
    if (remision.discount && remision.discount.amount > 0) {
        doc.setFont("helvetica", "bold").text("Descuento:", 130, yPos);
        doc.setFont("helvetica", "normal").text(`-${formatCurrency(remision.discount.amount)}`, 190, yPos, { align: "right" });
        yPos += 7;
    }
    if (remision.incluyeIVA) {
        doc.setFont("helvetica", "bold").text("IVA (19%):", 130, yPos);
        doc.setFont("helvetica", "normal").text(formatCurrency(remision.valorIVA), 190, yPos, { align: "right" });
        yPos += 7;
    }
    doc.setFont("helvetica", "bold").text("TOTAL:", 130, yPos);
    doc.text(formatCurrency(remision.valorTotal), 190, yPos, { align: "right" });

    // Se llama a la función de la firma UNA SOLA VEZ, al final de todo.
    addFinalSignature();

    if (remision.estado === "Anulada") {
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFontSize(80).setTextColor(255, 0, 0);
            doc.text("ANULADA", 105, 160, { align: "center", angle: 45, opacity: 0.4 });
            doc.setTextColor(0, 0, 0);
        }
    }

    return Buffer.from(doc.output("arraybuffer"));
}

/**
 * --- VERSIÓN COMPLETA Y FINAL BASADA EN TU CÓDIGO ---
 * Integra el campo de "observaciones" en tu lógica de generación de PDF existente.
 * Mantiene intacta toda la funcionalidad de anexos, planos de corte y manejo de multi-páginas.
 * @param {object} remision El objeto con los datos de la remisión.
 * @param {boolean} isForPlanta Indica si el PDF es para el rol de planta.
 * @return {Buffer} El PDF como un buffer de datos.
 */
async function generarPDF(remision, isForPlanta = false) {
    const db = admin.firestore();

    const pdfDocFinal = await PDFDocument.create();
    const font = await pdfDocFinal.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDocFinal.embedFont(StandardFonts.HelveticaBold);

    // --- FUNCIÓN REUTILIZABLE PARA AÑADIR ENCABEZADOS A CADA PÁGINA ---
    const addHeader = (doc, title) => {
        doc.setFont("helvetica", "bold").setFontSize(18).text(title, 105, 20, { align: "center" });
        if (remision.estado === "Anulada") {
            doc.setFontSize(80).setTextColor(255, 0, 0);
            doc.text("ANULADA", 105, 160, { align: "center", angle: 45 });
            doc.setTextColor(0, 0, 0);
        }
        if (!title.toLowerCase().includes("anexo")) {
            doc.setFontSize(10).setFont("helvetica", "bold").text("IMPORTADORA VIDRIO EXPRESS SAS", 105, 28, { align: "center" });
            doc.setFont("helvetica", "normal").text("Tels: 311 8109893 - 310 2557543", 105, 33, { align: "center" });
            doc.text("Cra 27 No 67-58", 105, 38, { align: "center" });
        }
        doc.setFontSize(14).setFont("helvetica", "bold").text(`Remisión N°: ${remision.numeroRemision}`, 190, 45, { align: "right" });
    };

    // --- FUNCIÓN REUTILIZABLE PARA AÑADIR PIE DE PÁGINA ---
    const addFooter = (doc, pageNumber, pageCount) => {
        const pageHeight = doc.internal.pageSize.height;
        doc.setFontSize(8);
        doc.text(`Página ${pageNumber} de ${pageCount}`, 105, pageHeight - 10, { align: 'center' });
    };

    // --- PÁGINA(S) 1: RESUMEN DE MATERIALES ---
    const paginaResumen = new jsPDF();
    const headerHeight = 85;
    const footerHeight = 20;

    const headColumns = [['Referencia', 'Descripción del Material', 'Cant. Láminas']];
    if (!isForPlanta) {
        headColumns[0].push('Vlr. Unit.', 'Subtotal');
    }

    const bodyRows = [];
    remision.items.forEach(item => {
        const row = [item.referencia, item.descripcion, item.cantidad];
        if (!isForPlanta) {
            row.push(formatCurrency(item.valorUnitario), formatCurrency(item.valorTotal));
        }
        bodyRows.push(row);
    });

    if (!isForPlanta && remision.cargosAdicionales) {
        remision.cargosAdicionales.forEach(cargo => {
            bodyRows.push(['N/A', cargo.descripcion, 1, formatCurrency(cargo.valorUnitario), formatCurrency(cargo.valorTotal)]);
        });
    }

    paginaResumen.autoTable({
        head: headColumns,
        body: bodyRows,
        startY: headerHeight,
        theme: 'grid',
        headStyles: { fillColor: [22, 160, 133] },
        margin: { top: 50, bottom: footerHeight },
        didDrawPage: function (data) {
            addHeader(paginaResumen, isForPlanta ? "Orden de Producción" : "Remisión de Servicio");
            addFooter(paginaResumen, data.pageNumber, data.pageCount);

            if (data.pageNumber === 1) {
                paginaResumen.setFontSize(11).setFont("helvetica", "bold").text("Cliente:", 20, 60).setFont("helvetica", "normal").text(remision.clienteNombre, 55, 60);
                paginaResumen.setFont("helvetica", "bold").text("Fecha Recibido:", 120, 60).setFont("helvetica", "normal").text(remision.fechaRecibido, 160, 60);
                if (!isForPlanta) {
                    paginaResumen.setFont("helvetica", "bold").text("Teléfono:", 20, 66).setFont("helvetica", "normal").text(remision.clienteTelefono || 'N/A', 55, 66);
                }
            }
        }
    });

    // --- OBTENER POSICIÓN FINAL DE LA TABLA ---
    let finalY = paginaResumen.lastAutoTable.finalY;
    const pageCountAfterTable = paginaResumen.internal.getNumberOfPages();
    paginaResumen.setPage(pageCountAfterTable);

    // ▼▼▼ INICIO DE LA MODIFICACIÓN CLAVE ▼▼▼
    // Dibuja las observaciones DESPUÉS de la tabla de ítems
    if (remision.observaciones && remision.observaciones.trim() !== '') {
        finalY += 7; // Añadir un pequeño espacio

        // Comprobar si hay espacio suficiente en la página actual
        if (finalY > paginaResumen.internal.pageSize.height - 40) { // 40 es un margen de seguridad
            paginaResumen.addPage();
            addHeader(paginaResumen, isForPlanta ? "Orden de Producción" : "Remisión de Servicio");
            // Se actualiza el número de página en el pie de la nueva página
            addFooter(paginaResumen, pageCountAfterTable + 1, pageCountAfterTable + 1);
            finalY = headerHeight - 20; // Posición inicial en la nueva página
        }

        paginaResumen.setFontSize(10).setFont("helvetica", "bold").text("Observaciones:", 20, finalY);
        finalY += 5;

        // Dibuja el texto de las observaciones con saltos de línea automáticos
        const observacionesText = paginaResumen.setFont("helvetica", "normal").setFontSize(9).splitTextToSize(remision.observaciones, 170); // 170 es el ancho del cuadro de texto
        paginaResumen.text(observacionesText, 20, finalY);

        // Actualiza la posición 'y' final después de añadir las observaciones
        finalY += (observacionesText.length * 4); // 4 es un estimado de la altura de línea
    }
    // ▲▲▲ FIN DE LA MODIFICACIÓN CLAVE ▲▲▲

    // --- DIBUJAR TOTALES Y FIRMA ---
    if (!isForPlanta) {
        const pageCount = paginaResumen.internal.getNumberOfPages();
        paginaResumen.setPage(pageCount);

        let yPos = finalY + 15;
        const spaceNeededForTotalsAndSignature = 80;

        if (yPos > paginaResumen.internal.pageSize.height - spaceNeededForTotalsAndSignature) {
            paginaResumen.addPage();
            addHeader(paginaResumen, "Remisión de Servicio");
            addFooter(paginaResumen, pageCount + 1, pageCount + 1);
            yPos = headerHeight;
        }

        paginaResumen.setFontSize(12).setFont("helvetica", "bold").text("Subtotal:", 130, yPos);
        paginaResumen.setFont("helvetica", "normal").text(formatCurrency(remision.subtotal), 190, yPos, { align: "right" });
        yPos += 7;
        if (remision.discount && remision.discount.amount > 0) {
            paginaResumen.setFont("helvetica", "bold").text("Descuento:", 130, yPos);
            paginaResumen.setFont("helvetica", "normal").text(`-${formatCurrency(remision.discount.amount)}`, 190, yPos, { align: "right" });
            yPos += 7;
        }
        if (remision.incluyeIVA) {
            paginaResumen.setFont("helvetica", "bold").text("IVA (19%):", 130, yPos);
            paginaResumen.setFont("helvetica", "normal").text(formatCurrency(remision.valorIVA), 190, yPos, { align: "right" });
            yPos += 7;
        }
        paginaResumen.setFont("helvetica", "bold").text("TOTAL:", 130, yPos);
        paginaResumen.text(formatCurrency(remision.valorTotal), 190, yPos, { align: "right" });

        const pageHeight = paginaResumen.internal.pageSize.height;
        const signatureY = pageHeight - 45;
        paginaResumen.line(40, signatureY, 120, signatureY);
        paginaResumen.setFontSize(10).setFont("helvetica", "normal").text("Firma y Sello de Recibido", 75, signatureY + 5, { align: "center" });
        paginaResumen.setLineCap(2).line(20, signatureY + 20, 190, signatureY + 20);
        paginaResumen.setFontSize(8).setFont("helvetica", "bold");
        paginaResumen.text("NO SE ENTREGA TRABAJO SINO HA SIDO CANCELADO.", 105, signatureY + 25, { align: "center" });
        paginaResumen.text("DESPUES DE 8 DIAS NO SE RESPONDE POR MERCANCIA.", 105, signatureY + 29, { align: "center" });
    }

    const resumenPdfBytes = await PDFDocument.load(paginaResumen.output('arraybuffer'));
    for (let i = 0; i < resumenPdfBytes.getPageCount(); i++) {
        const [copiedPage] = await pdfDocFinal.copyPages(resumenPdfBytes, [i]);
        pdfDocFinal.addPage(copiedPage);
    }

    // --- LÓGICA DE ANEXOS Y PLANOS DE CORTE (SIN CAMBIOS) ---
    const itemsCortados = remision.items.filter(item => item.tipo === 'Cortada' && item.planoDespiece && item.planoDespiece.length > 0);
    if (itemsCortados.length > 0) {
        // --- ANEXO DE PRODUCCIÓN (4 COLUMNAS) ---
        const paginaAnexo = new jsPDF();
        addHeader(paginaAnexo, "Anexo: Despiece Detallado");

        const allCortes = [];
        let corteIdGlobal = 1;
        itemsCortados.forEach(item => {
            (item.cortes || []).forEach(corte => {
                for (let i = 0; i < corte.cantidad; i++) {
                    allCortes.push({ id: corteIdGlobal++, material: item.descripcion, medida: `${corte.ancho} x ${corte.alto} mm` });
                }
            });
        });

        const margenSuperior = 60, margenInferior = 20, margenLateral = 15, espacioEntreColumnas = 5;
        const numColumnas = 4, altoTarjeta = 22;
        const anchoColumna = (paginaAnexo.internal.pageSize.width - (margenLateral * 2) - (espacioEntreColumnas * (numColumnas - 1))) / numColumnas;
        let yActual = margenSuperior, columnaActual = 0;

        allCortes.forEach((corte) => {
            if (yActual + altoTarjeta > paginaAnexo.internal.pageSize.height - margenInferior) {
                columnaActual++;
                yActual = margenSuperior;
                if (columnaActual >= numColumnas) {
                    paginaAnexo.addPage();
                    addHeader(paginaAnexo, "Anexo: Despiece (Continuación)");
                    columnaActual = 0;
                    yActual = margenSuperior;
                }
            }
            const xActual = margenLateral + (columnaActual * (anchoColumna + espacioEntreColumnas));
            paginaAnexo.setDrawColor(200, 200, 200).rect(xActual, yActual, anchoColumna, altoTarjeta);
            paginaAnexo.setFontSize(16).setFont("helvetica", "bold").text(`${corte.id}`, xActual + 3, yActual + 8);
            paginaAnexo.setFontSize(7).setFont("helvetica", "normal").text(corte.medida, xActual + 3, yActual + 13);
            paginaAnexo.text(corte.material, xActual + 3, yActual + 18, { maxWidth: anchoColumna - 4 });
            yActual += altoTarjeta + 3;
        });

        const anexoPdfBytes = await PDFDocument.load(paginaAnexo.output('arraybuffer'));
        for (let i = 0; i < anexoPdfBytes.getPageCount(); i++) {
            const [copiedPage] = await pdfDocFinal.copyPages(anexoPdfBytes, [i]);
            pdfDocFinal.addPage(copiedPage);
        }

        // --- PLANOS 2D (VERTICALES Y SIN DESPERDICIO) ---
        let planoCorteId = 1;
        for (const item of itemsCortados) {
            const itemDataSnap = await db.collection('items').doc(item.itemId).get();
            if (!itemDataSnap.exists) continue;
            const itemData = itemDataSnap.data();
            const anchoMaestra = itemData.ancho, altoMaestra = itemData.alto;

            for (const lamina of item.planoDespiece) {
                const page = pdfDocFinal.addPage(PageSizes.A4);
                const { width, height } = page.getSize();

                page.drawText(`Plano de Corte - Lámina ${lamina.numero} de ${item.planoDespiece.length}`, { x: 50, y: height - 40, font: fontBold, size: 16 });
                page.drawText(`Remisión N°: ${remision.numeroRemision}`, { x: width - 200, y: height - 40, font: fontBold, size: 12 });
                page.drawText(`Material: ${item.descripcion} (${anchoMaestra}x${altoMaestra}mm)`, { x: 50, y: height - 60, font, size: 10 });
                const nombreEstrategia = (item.estrategia || 'minimo_desperdicio') === 'minimo_desperdicio' ? 'Mínimo Desperdicio' : 'Prioridad Vertical';
                page.drawText(`Estrategia: ${nombreEstrategia}`, { x: 50, y: height - 75, font, size: 10, color: rgb(0.3, 0.3, 0.3) });

                const escala = (width - 120) / anchoMaestra;
                const xOffset = 60, yOffset = height - 95 - (altoMaestra * escala);

                page.drawRectangle({ x: xOffset, y: yOffset, width: anchoMaestra * escala, height: altoMaestra * escala, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 1 });

                (lamina.cortes || []).forEach(corte => {
                    page.drawRectangle({
                        x: xOffset + corte.x * escala,
                        y: yOffset + ((altoMaestra - corte.y - corte.alto) * escala),
                        width: corte.ancho * escala,
                        height: corte.alto * escala,
                        borderColor: rgb(0, 0, 0),
                        borderWidth: 0.5,
                        color: rgb(0.2, 0.6, 0.8),
                        opacity: 0.2
                    });
                    const centroX = xOffset + (corte.x + corte.ancho / 2) * escala;
                    const centroY = yOffset + ((altoMaestra - corte.y - corte.alto / 2) * escala);
                    page.drawText(`${planoCorteId}`, { x: centroX - 4, y: centroY + 4, font: fontBold, size: 10, color: rgb(0, 0, 0) });
                    page.drawText(corte.descripcion.replace(' (R)', 'R'), { x: centroX - 15, y: centroY - 8, font, size: 7, color: rgb(0, 0, 0) });
                    planoCorteId++;
                });
            }
        }
    }

    const finalPdfBytes = await pdfDocFinal.save();
    return Buffer.from(finalPdfBytes);
}

// AGREGA ESTA NUEVA FUNCIÓN
exports.getSignedUrlForPath = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "El usuario no está autenticado.");
    }
    const filePath = data.path;
    if (!filePath) {
        throw new functions.https.HttpsError("invalid-argument", "La ruta del archivo es requerida.");
    }

    try {
        const bucket = getStorage().bucket(BUCKET_NAME);
        const file = bucket.file(filePath);
        const [url] = await file.getSignedUrl({
            action: "read",
            expires: Date.now() + 15 * 60 * 1000, // La URL expira en 15 minutos
        });
        return { url: url };
    } catch (error) {
        functions.logger.error(`Error al generar URL para ${filePath}:`, error);
        throw new functions.https.HttpsError("internal", "No se pudo obtener la URL del archivo.");
    }
});

exports.onRemisionCreate = functions.region("us-central1").firestore
    .document("remisiones/{remisionId}")
    .onCreate(async (snap, context) => {
        const remisionData = snap.data();
        const remisionId = context.params.remisionId;
        const log = (message) => functions.logger.log(`[${remisionId}] ${message}`);

        log("Iniciando creación de remisión y notificaciones...");
        let emailStatus = "pending", whatsappStatus = "pending";

        try {
            // 1. Generar los diferentes PDFs en memoria
            const pdfBufferCliente = await generarPDFCliente(remisionData);
            const pdfBufferAdmin = await generarPDF(remisionData, false);
            const pdfBufferPlanta = await generarPDF(remisionData, true);

            // 2. Guardar los PDFs en Storage y obtener sus referencias
            const bucket = admin.storage().bucket();
            const filePathAdmin = `remisiones/${remisionData.numeroRemision}.pdf`;
            const fileAdmin = bucket.file(filePathAdmin); // Referencia al archivo principal
            await fileAdmin.save(pdfBufferAdmin);

            const filePathPlanta = `remisiones/planta-${remisionData.numeroRemision}.pdf`;
            await bucket.file(filePathPlanta).save(pdfBufferPlanta);

            // 3. Actualizar el documento de la remisión solo con las RUTAS
            await snap.ref.update({
                pdfPath: filePathAdmin,
                pdfPlantaPath: filePathPlanta
            });
            log("PDFs guardados y rutas almacenadas correctamente.");

            // 4. Intentar enviar notificaciones por correo (puede fallar por créditos)
            try {
                const msg = {
                    to: remisionData.clienteEmail,
                    from: FROM_EMAIL,
                    subject: `Confirmación de Remisión N° ${remisionData.numeroRemision}`,
                    html: `<p>Hola ${remisionData.clienteNombre}, adjuntamos tu remisión. El estado es: <strong>${remisionData.estado}</strong>.</p>`,
                    attachments: [{
                        content: pdfBufferCliente.toString("base64"),
                        filename: `Remision-${remisionData.numeroRemision}.pdf`,
                        type: "application/pdf",
                        disposition: "attachment",
                    }],
                };
                await sgMail.send(msg);
                emailStatus = "sent";
            } catch (emailError) {
                log("Error al enviar correo (SendGrid):", emailError.message);
                emailStatus = "error";
            }
            try {
                const printerMsg = { to: "oficinavidriosexito@print.brother.com", from: FROM_EMAIL, /* ... */ };
                await sgMail.send(printerMsg);
            } catch (printerError) {
                log("Error al enviar a impresora (SendGrid):", printerError.message);
            }
            
            // 5. Enviar notificación por WhatsApp con un enlace temporal
            try {
                // Generamos un enlace temporal SOLO para este envío
                const [whatsappUrl] = await fileAdmin.getSignedUrl({
                    action: 'read',
                    expires: Date.now() + 15 * 60 * 1000, // Válido por 15 minutos
                });

                const clienteDoc = await admin.firestore().collection("clientes").doc(remisionData.idCliente).get();
                if (clienteDoc.exists) {
                    const clienteData = clienteDoc.data();
                    const telefonos = [clienteData.telefono1, clienteData.telefono2].filter(Boolean);
                    if (telefonos.length > 0) {
                        for (const telefono of telefonos) {
                            // Pasamos el enlace temporal a la función de envío
                            await sendWhatsAppRemision(telefono, remisionData.clienteNombre, remisionData.numeroRemision.toString(), remisionData.estado, whatsappUrl);
                        }
                        whatsappStatus = "sent";
                    } else { whatsappStatus = "no_phone"; }
                } else { whatsappStatus = "client_not_found"; }
            } catch (whatsappError) {
                log("Error en el proceso de WhatsApp:", whatsappError.message);
                whatsappStatus = "error";
            }

            // 6. Actualizar el estado final de las notificaciones
            return snap.ref.update({ emailStatus, whatsappStatus });

        } catch (error) {
            log("Error General en onRemisionCreate:", error);
            return snap.ref.update({ errorLog: error.message, emailStatus: "error", whatsappStatus: "error" });
        }
    });

/**
 * --- VERSIÓN FINAL CON RESTAURACIÓN DE INVENTARIO ---
 * 1.  Detecta cuando una remisión cambia su estado a "Anulada" y devuelve
 * las láminas al inventario de forma automática y segura.
 * 2.  Regenera todos los PDFs (simple para cliente, completos para la app)
 * cuando hay un cambio de estado relevante.
 * 3.  Envía las notificaciones actualizadas al cliente por correo y WhatsApp.
 */
exports.onRemisionUpdate = functions.region("us-central1").firestore
    .document("remisiones/{remisionId}")
    .onUpdate(async (change, context) => {
        const afterData = change.after.data();
        const beforeData = change.before.data();
        const remisionId = context.params.remisionId;
        const log = (message) => functions.logger.log(`[Actualización ${remisionId}] ${message}`);

        // --- INICIO DE LA CORRECCIÓN CLAVE ---
        // La función de notificación ahora genera su propio enlace temporal
        const sendNotifications = async (motivo) => {
            try {
                // Generamos un enlace temporal para el PDF actualizado
                const bucket = admin.storage().bucket();
                const file = bucket.file(afterData.pdfPath); // Usa la ruta del archivo ya guardada
                const [whatsappUrl] = await file.getSignedUrl({
                    action: 'read',
                    expires: Date.now() + 15 * 60 * 1000, // Válido por 15 minutos
                });

                const clienteDoc = await admin.firestore().collection("clientes").doc(afterData.idCliente).get();
                if (clienteDoc.exists) {
                    const clienteData = clienteDoc.data();
                    const telefonos = [clienteData.telefono1, clienteData.telefono2].filter(Boolean);
                    for (const telefono of telefonos) {
                        // Pasamos el enlace temporal a la función de envío
                        await sendWhatsAppRemision(telefono, afterData.clienteNombre, afterData.numeroRemision.toString(), afterData.estado, whatsappUrl);
                    }
                }
            } catch (error) {
                log(`Error crítico al enviar notificaciones (${motivo}):`, error);
            }
        };
        // --- FIN DE LA CORRECCIÓN CLAVE ---

        const estadoCambio = beforeData.estado !== afterData.estado;
        const pagoFinalizado = false; // Asume tu lógica de pagos aquí si es necesario

        // --- Caso 1: La remisión es ANULADA ---
        if (beforeData.estado !== "Anulada" && afterData.estado === "Anulada") {
            log("Detectada anulación. Regenerando PDFs, restaurando stock y notificando...");
            try {
                // Restaurar inventario
                const batch = admin.firestore().batch();
                (afterData.items || []).forEach(item => {
                    if (item.itemId && item.cantidad > 0) {
                        const itemRef = db.collection("items").doc(item.itemId);
                        batch.update(itemRef, { stock: admin.firestore.FieldValue.increment(item.cantidad) });
                    }
                });
                await batch.commit();
                log("Inventario restaurado.");

                // Regenerar y guardar PDFs
                const pdfBufferCliente = await generarPDFCliente(afterData);
                const pdfBufferAdmin = await generarPDF(afterData, false);
                const pdfBufferPlanta = await generarPDF(afterData, true);

                const bucket = admin.storage().bucket();
                const filePathAdmin = `remisiones/${afterData.numeroRemision}.pdf`;
                await bucket.file(filePathAdmin).save(pdfBufferAdmin);

                const filePathPlanta = `remisiones/planta-${afterData.numeroRemision}.pdf`;
                await bucket.file(filePathPlanta).save(pdfBufferPlanta);

                // Actualizar Firestore solo con las rutas
                await change.after.ref.update({
                    pdfPath: filePathAdmin,
                    pdfPlantaPath: filePathPlanta
                });
                log("Rutas de PDFs actualizadas para anulación.");

                // Enviar notificaciones
                try {
                    const msg = { /* ... configuración del correo de anulación ... */ };
                    await sgMail.send(msg);
                } catch (e) { log("Error de SendGrid:", e.message); }
                
                await sendNotifications("Anulación");

            } catch (error) {
                log("Error al procesar anulación:", error);
            }
        }
        // --- Caso 2: Otro cambio de estado ---
        else if (estadoCambio && afterData.estado !== "Anulada") {
            log("Detectado cambio de estado. Regenerando PDFs y notificando.");
            try {
                const pdfBufferCliente = await generarPDFCliente(afterData);
                const pdfBufferAdmin = await generarPDF(afterData, false);
                const pdfBufferPlanta = await generarPDF(afterData, true);

                const bucket = admin.storage().bucket();
                const filePathAdmin = `remisiones/${afterData.numeroRemision}.pdf`;
                await bucket.file(filePathAdmin).save(pdfBufferAdmin);

                const filePathPlanta = `remisiones/planta-${afterData.numeroRemision}.pdf`;
                await bucket.file(filePathPlanta).save(pdfBufferPlanta);

                await change.after.ref.update({
                    pdfPath: filePathAdmin,
                    pdfPlantaPath: filePathPlanta
                });
                log("Rutas de PDFs actualizadas por cambio de estado.");

                // Enviar notificaciones
                if (afterData.estado === "Entregado") {
                    try {
                        const msg = { /* ... configuración del correo de entrega ... */ };
                        await sgMail.send(msg);
                    } catch (e) { log("Error de SendGrid:", e.message); }
                }
                await sendNotifications("Actualización de Estado");

            } catch (error) {
                log("Error al procesar actualización:", error);
            }
        }

        return null;
    });

// Función HTTP invocable que devuelve la configuración de Firebase del lado del cliente.
exports.getFirebaseConfig = functions.https.onCall((data, context) => {
    // Asegurarse de que el usuario esté autenticado para solicitar la configuración es una buena práctica.
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "El usuario debe estar autenticado para solicitar la configuración."
        );
    }

    // Devuelve la configuración guardada en el entorno.
    return functions.config().prisma;
});

exports.applyDiscount = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "El usuario no está autenticado.");
    }

    const { remisionId, discountPercentage } = data;
    if (!remisionId || discountPercentage === undefined) {
        throw new functions.https.HttpsError("invalid-argument", "Faltan datos (remisionId, discountPercentage).");
    }

    const remisionRef = admin.firestore().collection("remisiones").doc(remisionId);

    try {
        const remisionDoc = await remisionRef.get();
        const docExists = remisionDoc && (typeof remisionDoc.exists === "function" ? remisionDoc.exists() : remisionDoc.exists);
        if (!docExists) {
            throw new functions.https.HttpsError("not-found", "La remisión no existe.");
        }

        const remisionData = remisionDoc.data();
        const subtotal = remisionData.subtotal;
        const discountAmount = subtotal * (discountPercentage / 100);
        const subtotalWithDiscount = subtotal - discountAmount;
        const newIva = remisionData.incluyeIVA ? subtotalWithDiscount * 0.19 : 0;
        const newTotal = subtotalWithDiscount + newIva;

        const updatedData = {
            valorTotal: newTotal,
            valorIVA: newIva,
            discount: {
                percentage: discountPercentage,
                amount: discountAmount,
                appliedBy: context.auth.uid,
                appliedAt: new Date(),
            },
        };

        await remisionRef.update(updatedData);

        const finalRemisionData = { ...remisionData, ...updatedData };
        const pdfBuffer = generarPDF(finalRemisionData, false);
        const pdfPlantaBuffer = generarPDF(finalRemisionData, true);

        const bucket = admin.storage().bucket();

        const filePath = `remisiones/${finalRemisionData.numeroRemision}.pdf`;
        const file = bucket.file(filePath);
        await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });

        const filePathPlanta = `remisiones/planta-${finalRemisionData.numeroRemision}.pdf`;
        const filePlanta = bucket.file(filePathPlanta);
        await filePlanta.save(pdfPlantaBuffer, { metadata: { contentType: "application/pdf" } });

        const [url] = await file.getSignedUrl({ action: "read", expires: "03-09-2491" });
        const [urlPlanta] = await filePlanta.getSignedUrl({ action: "read", expires: "03-09-2491" });

        await remisionRef.update({ pdfUrl: url, pdfPlantaUrl: urlPlanta });

        const msg = {
            to: finalRemisionData.clienteEmail,
            from: FROM_EMAIL,
            subject: `Descuento aplicado a tu Remisión N° ${finalRemisionData.numeroRemision}`,
            html: `<p>Hola ${finalRemisionData.clienteNombre},</p>
                   <p>Se ha aplicado un descuento del <strong>${discountPercentage.toFixed(2)}%</strong> a tu remisión N° ${finalRemisionData.numeroRemision}.</p>
                   <p>El nuevo total es: <strong>${formatCurrency(newTotal)}</strong>.</p>
                   <p>Adjuntamos la remisión actualizada.</p>
                   <p><strong>Importadora Vidrio Express</strong></p>`,
            attachments: [{
                content: pdfBuffer.toString("base64"),
                filename: `Remision-Actualizada-${finalRemisionData.numeroRemision}.pdf`,
                type: "application/pdf",
                disposition: "attachment",
            }],
        };

        await sgMail.send(msg);

        return { success: true, message: "Descuento aplicado y correo enviado." };

    } catch (error) {
        functions.logger.error(`Error al aplicar descuento para ${remisionId}:`, error);
        throw new functions.https.HttpsError("internal", "No se pudo aplicar el descuento.");
    }
});

exports.onResendEmailRequest = functions.region("us-central1").firestore
    .document("resendQueue/{queueId}")
    .onCreate(async (snap, context) => {
        const request = snap.data();
        const remisionId = request.remisionId;
        const log = (message) => {
            functions.logger.log(`[Reenvío ${remisionId}] ${message}`);
        };
        log("Iniciando reenvío de correo.");

        try {
            const remisionDoc = await admin.firestore()
                .collection("remisiones").doc(remisionId).get();
            const docExists = remisionDoc && (typeof remisionDoc.exists === "function" ? remisionDoc.exists() : remisionDoc.exists);
            if (!docExists) {
                log("La remisión no existe.");
                return snap.ref.delete();
            }
            const remisionData = remisionDoc.data();

            const bucket = admin.storage().bucket();

            const filePath = `remisiones/${remisionData.numeroRemision}.pdf`;
            const [pdfBuffer] = await bucket.file(filePath).download();
            log("PDF descargado desde Storage.");

            const msg = {
                to: remisionData.clienteEmail,
                from: FROM_EMAIL,
                subject: `[Reenvío] Remisión N° ${remisionData.numeroRemision}`,
                html: `<p>Hola ${remisionData.clienteNombre},</p>
          <p>Como solicitaste, aquí tienes una copia de tu remisión.</p>`,
                attachments: [{
                    content: pdfBuffer.toString("base64"),
                    filename: `Remision-${remisionData.numeroRemision}.pdf`,
                    type: "application/pdf",
                    disposition: "attachment",
                }],
            };
            await sgMail.send(msg);
            log(`Correo reenviado a ${remisionData.clienteEmail}.`);

            return snap.ref.delete();
        } catch (error) {
            log("Error en el reenvío:", error);
            return snap.ref.update({ status: "error", error: error.message });
        }
    });

/**
 * NUEVA FUNCIÓN: Actualiza el documento de un empleado con la URL de un archivo.
 * Se invoca desde el cliente después de subir un archivo a Firebase Storage.
 */
exports.updateEmployeeDocument = functions.https.onCall(async (data, context) => {
    // 1. Autenticación y Verificación de Permisos
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "El usuario no está autenticado.");
    }

    const uid = context.auth.uid;
    const userDoc = await admin.firestore().collection("users").doc(uid).get();
    const userData = userDoc.data();

    if (userData.role !== "admin") {
        throw new functions.https.HttpsError("permission-denied", "El usuario no tiene permisos de administrador.");
    }

    // 2. Validación de Datos de Entrada
    const { employeeId, docType, fileUrl } = data;
    if (!employeeId || !docType || !fileUrl) {
        throw new functions.https.HttpsError("invalid-argument", "Faltan datos (employeeId, docType, fileUrl).");
    }

    // 3. Lógica de Actualización
    try {
        const employeeDocRef = admin.firestore().collection("users").doc(employeeId);

        // Usamos notación de punto para actualizar un campo dentro de un mapa.
        // Esto crea el mapa 'documentos' si no existe.
        const updatePayload = {
            [`documentos.${docType}`]: fileUrl
        };

        await employeeDocRef.update(updatePayload);

        return { success: true, message: `Documento '${docType}' actualizado para el empleado ${employeeId}.` };
    } catch (error) {
        functions.logger.error(`Error al actualizar documento para ${employeeId}:`, error);
        throw new functions.https.HttpsError("internal", "No se pudo actualizar el documento del empleado.");
    }
});

/**
 * Se activa cuando se actualiza una importación (ej. al añadir un abono).
 * Registra el abono como un gasto en COP.
 */
exports.onImportacionUpdate = functions.firestore
    .document("importaciones/{importacionId}")
    .onUpdate(async (change, context) => {
        const beforeData = change.before.data();
        const afterData = change.after.data();
        const importacionId = context.params.importacionId;
        const log = (message) => functions.logger.log(`[Imp Update ${importacionId}] ${message}`);

        const gastosAntes = beforeData.gastosNacionalizacion || {};
        const gastosDespues = afterData.gastosNacionalizacion || {};

        // Iterar sobre cada tipo de gasto (naviera, puerto, etc.)
        for (const tipoGasto of Object.keys(gastosDespues)) {
            const facturasAntes = gastosAntes[tipoGasto]?.facturas || [];
            const facturasDespues = gastosDespues[tipoGasto].facturas || [];

            // Iterar sobre cada factura de ese tipo de gasto
            facturasDespues.forEach((factura, index) => {
                const facturaAnterior = facturasAntes.find(f => f.id === factura.id);
                const abonosAntes = facturaAnterior?.abonos || [];
                const abonosDespues = factura.abonos || [];

                // Si se añadió un nuevo abono a esta factura
                if (abonosDespues.length > abonosAntes.length) {
                    const nuevoAbono = abonosDespues[abonosDespues.length - 1];
                    log(`Nuevo abono de ${nuevoAbono.valor} para factura ${factura.numeroFactura} de ${tipoGasto}`);

                    const nuevoGastoDoc = {
                        fecha: nuevoAbono.fecha,
                        proveedorNombre: `${factura.proveedorNombre} (Imp. ${afterData.numeroImportacion})`,
                        proveedorId: factura.proveedorId,
                        numeroFactura: factura.numeroFactura,
                        valorTotal: nuevoAbono.valor,
                        fuentePago: nuevoAbono.formaPago,
                        registradoPor: nuevoAbono.registradoPor,
                        timestamp: new Date(),
                        isImportacionGasto: true,
                        isAbono: true,
                        importacionId: importacionId,
                        gastoTipo: tipoGasto,
                        facturaId: factura.id
                    };

                    // Crear el documento en la colección de gastos
                    admin.firestore().collection("gastos").add(nuevoGastoDoc)
                        .then(() => log("Gasto por abono registrado con éxito."))
                        .catch(err => functions.logger.error("Error al registrar gasto por abono:", err));
                }
            });
        }
        return null;
    });


// Reemplaza la función setMyUserAsAdmin con esta versión más explícita
exports.setMyUserAsAdmin = functions.https.onRequest(async (req, res) => {
    // --- INICIO DE LA LÓGICA MANUAL DE PERMISOS (CORS) ---
    // Le decimos al navegador que confiamos en cualquier origen (para desarrollo)
    res.set('Access-Control-Allow-Origin', '*');

    // Manejar la solicitud de "inspección" (preflight) que hace el navegador
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.status(204).send('');
        return;
    }
    // --- FIN DE LA LÓGICA MANUAL DE PERMISOS (CORS) ---

    // El resto de la lógica para verificar y asignar el permiso de admin
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
        return res.status(401).send({ error: 'Unauthorized: No se proporcionó token.' });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;
        await admin.auth().setCustomUserClaims(userId, { admin: true });

        console.log(`Permiso de 'admin' OTORGADO al usuario ${userId}.`);
        return res.status(200).send({ data: { message: `¡Éxito! El usuario ${userId} ahora tiene permisos de admin.` } });

    } catch (error) {
        console.error("Error al establecer permisos de administrador:", error);
        return res.status(500).send({ error: 'Error interno del servidor.' });
    }
});


/**
* NUEVA FUNCIÓN: Cambia el estado de un usuario (active, inactive).
* Invocable solo por administradores.
*/
exports.setUserStatus = functions.https.onCall(async (data, context) => {
    // 1. Verificar que el que llama es un administrador
    if (!context.auth || !context.auth.token.admin) {
        throw new functions.https.HttpsError(
            "permission-denied",
            "Solo los administradores pueden cambiar el estado de un usuario."
        );
    }

    // 2. Validar los datos de entrada
    const { userId, newStatus } = data;
    if (!userId || !['active', 'inactive', 'pending'].includes(newStatus)) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "Faltan datos o el nuevo estado no es válido (userId, newStatus)."
        );
    }

    try {
        // 3. Actualizar el documento del usuario en Firestore
        const userRef = admin.firestore().collection("users").doc(userId);
        await userRef.update({ status: newStatus });

        return { success: true, message: `Estado del usuario ${userId} actualizado a ${newStatus}.` };
    } catch (error) {
        functions.logger.error(`Error al actualizar estado para ${userId}:`, error);
        throw new functions.https.HttpsError(
            "internal",
            "No se pudo actualizar el estado del usuario."
        );
    }
});
/**
 * --- VERSIÓN MEJORADA ---
 * Se activa cuando se escribe en un documento de usuario.
 * Sincroniza el rol de Firestore con un "custom claim" en Firebase Auth,
 * guardando el rol exacto para mayor flexibilidad.
 */
exports.onUserRoleChange = functions.firestore
    .document('users/{userId}')
    .onWrite(async (change, context) => {
        const userId = context.params.userId;
        const afterData = change.after.exists ? change.after.data() : null;
        const beforeData = change.before.exists ? change.before.data() : null;

        const newRole = afterData ? afterData.role : null;
        const oldRole = beforeData ? beforeData.role : null;

        // Si el rol no cambió o el usuario fue eliminado, no hacer nada.
        if (newRole === oldRole) {
            return null;
        }

        try {
            // --- INICIO DE LA MODIFICACIÓN ---
            // Definimos los roles válidos para el sistema
            const validRoles = ['admin', 'planta', 'contabilidad'];

            if (newRole && validRoles.includes(newRole)) {
                // Si el nuevo rol es válido, lo estampamos en los permisos del usuario.
                // Esto es más potente que solo tener "admin: true".
                await admin.auth().setCustomUserClaims(userId, { role: newRole });
                console.log(`Permiso de '${newRole}' asignado al usuario ${userId}.`);
            } else {
                // Si el rol no es válido o es nulo, le quitamos cualquier permiso especial.
                await admin.auth().setCustomUserClaims(userId, null);
                console.log(`Permisos personalizados eliminados para el usuario ${userId}.`);
            }
            // --- FIN DE LA MODIFICACIÓN ---
        } catch (error) {
            console.error(`Error al establecer permisos para ${userId}:`, error);
        }
        return null;
    });


/**
* --- FUNCIÓN DE DEPURACIÓN ---
* Permite a un usuario autenticado verificar los permisos (custom claims)
* que están presentes en su token de sesión actual.
*/
exports.checkMyClaims = functions.https.onRequest((req, res) => {
    // Usa el middleware de CORS para manejar los permisos del navegador.
    cors(req, res, async () => {
        try {
            // Obtener el token del encabezado de la solicitud
            const idToken = req.headers.authorization?.split("Bearer ")[1];
            if (!idToken) {
                console.log("No se proporcionó token de autorización.");
                return res.status(401).send({ error: "No autenticado." });
            }

            // Verificar el token usando el Admin SDK
            const decodedToken = await admin.auth().verifyIdToken(idToken);

            console.log(`Revisando claims para el UID: ${decodedToken.uid}`);
            console.log("Claims completos en el token del servidor:", decodedToken);

            // Devolver los claims al cliente
            return res.status(200).send({ data: { claims: decodedToken } });

        } catch (error) {
            console.error("Error al verificar el token:", error);
            return res.status(500).send({ error: "Error interno al procesar la solicitud." });
        }
    });
});

/**
 * --- NUEVA FUNCIÓN ---
 * Guarda o actualiza los saldos iniciales de las cuentas.
 * Solo puede ser llamada por un administrador.
 */
exports.setInitialBalances = functions.https.onCall(async (data, context) => {
    // --- INICIO DE LA CORRECCIÓN ---
    // Se ajusta la verificación para que coincida con el rol del usuario.
    if (!context.auth || context.auth.token.role !== 'admin') {
        throw new functions.https.HttpsError(
            "permission-denied",
            "Solo los administradores pueden establecer los saldos iniciales."
        );
    }
    // --- FIN DE LA CORRECCIÓN ---

    const balances = data;
    for (const key in balances) {
        if (typeof balances[key] !== 'number') {
            throw new functions.https.HttpsError(
                "invalid-argument",
                `El valor para "${key}" no es un número.`
            );
        }
    }

    try {
        const balanceDocRef = admin.firestore().collection("saldosIniciales").doc("current");
        await balanceDocRef.set(balances, { merge: true });

        return { success: true, message: "Saldos iniciales guardados correctamente." };
    } catch (error) {
        functions.logger.error("Error al guardar saldos iniciales:", error);
        throw new functions.https.HttpsError(
            "internal",
            "No se pudo guardar la información en la base de datos."
        );
    }
});

/**
 * --- NUEVA FUNCIÓN DE MANTENIMIENTO ---
 * Recorre todas las remisiones y regenera sus URLs de PDF para que sean permanentes.
 * Se activa manualmente desde la aplicación.
 */
exports.regenerateAllRemisionUrls = functions.https.onCall(async (data, context) => {
    // Verificación de permisos (sin cambios)
    if (!context.auth || context.auth.token.role !== 'admin') {
        throw new functions.https.HttpsError("permission-denied", "Solo los administradores pueden ejecutar esta operación.");
    }

    const log = functions.logger;
    log.info("Iniciando la REGENERACIÓN Y REPARACIÓN de todas las remisiones...");

    const remisionesRef = db.collection("remisiones");
    const snapshot = await remisionesRef.get();

    if (snapshot.empty) {
        log.info("No se encontraron remisiones para procesar.");
        return { success: true, message: "No hay remisiones para actualizar." };
    }

    const bucket = admin.storage().bucket();

    let updatedCount = 0;
    let repairedCount = 0;
    const batchSize = 100;
    let batch = db.batch();

    for (let i = 0; i < snapshot.docs.length; i++) {
        const doc = snapshot.docs[i];
        const remision = doc.data();
        let updates = {};

        // --- INICIO DE LA LÓGICA DE REPARACIÓN MEJORADA ---
        const adminPath = `remisiones/${remision.numeroRemision}.pdf`;
        const plantaPath = `remisiones/planta-${remision.numeroRemision}.pdf`;

        const fileAdmin = bucket.file(adminPath);
        const filePlanta = bucket.file(plantaPath);

        const [existsAdmin] = await fileAdmin.exists();
        
        // Si el archivo NO existe, lo creamos desde cero.
        if (!existsAdmin) {
            log.warn(`PDF no encontrado para remisión N° ${remision.numeroRemision}. REGENERANDO...`);
            try {
                const pdfBufferAdmin = await generarPDF(remision, false);
                await fileAdmin.save(pdfBufferAdmin);
                
                const pdfBufferPlanta = await generarPDF(remision, true);
                await filePlanta.save(pdfBufferPlanta);

                updates.pdfPath = adminPath;
                updates.pdfPlantaPath = plantaPath;
                repairedCount++; // Contamos como una reparación
                log.info(`PDF para N° ${remision.numeroRemision} REPARADO.`);

            } catch (creationError) {
                log.error(`FALLO al regenerar PDF para N° ${remision.numeroRemision}:`, creationError);
                continue; // Saltamos a la siguiente remisión si la creación falla
            }
        } else {
            // Si el archivo SÍ existe, solo nos aseguramos de que la ruta esté guardada.
            if (!remision.pdfPath) {
                 updates.pdfPath = adminPath;
                 updates.pdfPlantaPath = plantaPath;
                 updatedCount++;
            }
        }
        // --- FIN DE LA LÓGICA DE REPARACIÓN ---

        if (Object.keys(updates).length > 0) {
            batch.update(doc.ref, updates);
        }

        if ((i + 1) % batchSize === 0) {
            await batch.commit();
            batch = db.batch();
            log.info(`Lote de ${batchSize} remisiones procesado...`);
        }
    }

    // Commitear el último lote si queda algo
    if ((repairedCount + updatedCount) > 0 && (repairedCount + updatedCount) % batchSize !== 0) {
        await batch.commit();
    }

    const resultMessage = `Proceso completado. Se actualizaron ${updatedCount} enlaces y se repararon ${repairedCount} remisiones con PDFs faltantes.`;
    log.info(resultMessage);
    return { success: true, message: resultMessage };
});

const ExcelJS = require('exceljs');


/**
 * --- VERSIÓN CORREGIDA ---
 * Exporta los gastos a un archivo Excel.
 * Ahora permite el acceso a los roles 'admin' y 'contabilidad'.
 */
exports.exportGastosToExcel = functions.https.onCall(async (data, context) => {
    // --- INICIO DE LA CORRECCIÓN DE PERMISOS ---
    const userRole = context.auth.token.role;
    const allowedRoles = ['admin', 'contabilidad'];

    if (!context.auth || !allowedRoles.includes(userRole)) {
        throw new functions.https.HttpsError(
            'permission-denied',
            'Solo los administradores o contabilidad pueden exportar datos.'
        );
    }
    // --- FIN DE LA CORRECCIÓN DE PERMISOS ---

    const { startDate, endDate } = data;
    if (!startDate || !endDate) {
        throw new functions.https.HttpsError('invalid-argument', 'Se requieren fechas de inicio y fin.');
    }

    try {
        const gastosRef = db.collection('gastos');
        const snapshot = await gastosRef.where('fecha', '>=', startDate).where('fecha', '<=', endDate).get();

        if (snapshot.empty) {
            return { success: false, message: 'No se encontraron gastos en el rango de fechas seleccionado.' };
        }

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Gastos');

        // Definir las columnas
        worksheet.columns = [
            { header: 'Fecha', key: 'fecha', width: 15 },
            { header: 'Proveedor', key: 'proveedorNombre', width: 30 },
            { header: 'N° Factura', key: 'numeroFactura', width: 20 },
            { header: 'Fuente de Pago', key: 'fuentePago', width: 20 },
            { header: 'Valor Total', key: 'valorTotal', width: 20, style: { numFmt: '"$"#,##0' } }
        ];

        // Añadir las filas
        snapshot.forEach(doc => {
            worksheet.addRow(doc.data());
        });

        // Generar el archivo en memoria
        const buffer = await workbook.xlsx.writeBuffer();
        const fileContent = Buffer.from(buffer).toString('base64');

        return { success: true, fileContent: fileContent };

    } catch (error) {
        console.error("Error al generar el reporte de gastos:", error);
        throw new functions.https.HttpsError('internal', 'No se pudo generar el archivo Excel.');
    }
});
/**
 * Elimina una factura de gasto de nacionalización de una importación.
 * Verifica que la factura no tenga abonos antes de borrarla.
 * Solo puede ser llamada por un administrador.
 */
exports.deleteGastoNacionalizacion = functions.region("us-central1").https.onCall(async (data, context) => {
    if (!context.auth || context.auth.token.role !== 'admin') {
        throw new functions.https.HttpsError('permission-denied', 'Solo los administradores pueden realizar esta acción.');
    }

    const { importacionId, gastoTipo, facturaId } = data;
    if (!importacionId || !gastoTipo || !facturaId) {
        throw new functions.https.HttpsError('invalid-argument', 'Faltan datos para eliminar el gasto.');
    }

    const importacionRef = db.collection("importaciones").doc(importacionId);

    try {
        await db.runTransaction(async (transaction) => {
            const importacionDoc = await transaction.get(importacionRef);

            // --- INICIO DE LA CORRECCIÓN ---
            // Se usa '.exists' como una propiedad, sin paréntesis ().
            if (!importacionDoc.exists) {
            // --- FIN DE LA CORRECCIÓN ---
                throw new Error("La importación no fue encontrada.");
            }

            const importacionData = importacionDoc.data();
            const gastosNacionalizacion = importacionData.gastosNacionalizacion || {};
            const gastoActual = gastosNacionalizacion[gastoTipo];

            if (!gastoActual || !gastoActual.facturas) {
                throw new Error("El grupo de gasto no fue encontrado.");
            }

            const facturaIndex = gastoActual.facturas.findIndex(f => f.id === facturaId);
            if (facturaIndex === -1) {
                console.log(`Factura ${facturaId} no encontrada, probablemente ya fue eliminada.`);
                return;
            }

            const facturaAEliminar = gastoActual.facturas[facturaIndex];
            if (facturaAEliminar.abonos && facturaAEliminar.abonos.length > 0) {
                throw new functions.https.HttpsError('permission-denied', 'No se puede eliminar un gasto que ya tiene abonos registrados.');
            }

            gastoActual.facturas.splice(facturaIndex, 1);

            let nuevoTotalNacionalizacionCOP = 0;
            Object.values(gastosNacionalizacion).forEach(gasto => {
                (gasto.facturas || []).forEach(factura => {
                    nuevoTotalNacionalizacionCOP += factura.valorTotal || 0;
                });
            });

            transaction.update(importacionRef, {
                gastosNacionalizacion,
                totalNacionalizacionCOP: nuevoTotalNacionalizacionCOP
            });
        });

        return { success: true, message: "Gasto eliminado con éxito." };

    } catch (error) {
        console.error("Error al eliminar gasto:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Ocurrió un error al intentar eliminar el gasto.');
    }
});

/**
 * Función Callable: Genera una URL firmada y temporal para un archivo en Storage.
 * @param {object} data - Objeto con la propiedad `filePath`.
 * @param {object} context - Información de autenticación del usuario.
 * @returns {Promise<{url: string}>} - La URL firmada y temporal.
 */
exports.getSignedUrl = functions.https.onCall(async (data, context) => {
    // 1. Verificar que el usuario está autenticado
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'El usuario debe estar autenticado para ver archivos.'
        );
    }

    const filePath = data.filePath;
    if (!filePath) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Se debe proporcionar la ruta del archivo (filePath).'
        );
    }

    // 2. Configurar la duración del enlace (15 minutos)
    const options = {
        version: 'v4',
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000, // 15 minutos
    };

    try {
        // 3. Generar y devolver la URL firmada
        const [url] = await admin.storage().bucket().file(filePath).getSignedUrl(options);
        return { url: url };
    } catch (error) {
        console.error("Error al generar la URL firmada:", error);
        throw new functions.https.HttpsError(
            'internal',
            'No se pudo generar el enlace para el archivo.'
        );
    }
});

exports.repairRutUrls = functions.runWith({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
    if (!context.auth || context.auth.token.role !== 'admin') {
        throw new functions.https.HttpsError("permission-denied", "Solo los administradores pueden ejecutar esta operación.");
    }

    const log = functions.logger;
    log.info("--- INICIANDO DIAGNÓSTICO DE URLs DE RUTs ---");

    const bucket = admin.storage().bucket();
    let updatedCount = 0;
    const NEW_PROJECT_ID = "vidrioexpres1";

    // --- DIAGNÓSTICO PARA CLIENTES ---
    log.info("--- Revisando Clientes ---");
    const clientesSnapshot = await db.collection("clientes").get();
    log.info(`Encontrados ${clientesSnapshot.docs.length} clientes.`);

    for (const doc of clientesSnapshot.docs) {
        const data = doc.data();
        log.info(`[Cliente: ${doc.id}] Revisando...`);

        if (data.rutUrl && data.rutUrl.trim() !== '') {
            log.info(` -> URL encontrada: ${data.rutUrl}`);
            const isIncorrect = !data.rutUrl.includes(NEW_PROJECT_ID);
            log.info(` -> ¿La URL es incorrecta? (No incluye '${NEW_PROJECT_ID}'): ${isIncorrect}`);

            if (isIncorrect) {
                log.warn(` -> ¡URL INCORRECTA DETECTADA! Intentando actualizar...`);
                try {
                    const oldUrl = new URL(data.rutUrl);
                    const decodedPath = decodeURIComponent(oldUrl.pathname);
                    const fileName = decodedPath.substring(decodedPath.lastIndexOf('/') + 1);
                    const file = bucket.file(`ruts_clientes/${fileName}`);
                    const [exists] = await file.exists();

                    if(exists) {
                        const [newUrl] = await file.getSignedUrl({ action: 'read', expires: '03-09-2491' });
                        await doc.ref.update({ rutUrl: newUrl });
                        updatedCount++;
                        log.info(` -> ÉXITO: URL del cliente ${doc.id} actualizada.`);
                    } else {
                        log.error(` -> ERROR DE REPARACIÓN: El archivo 'ruts_clientes/${fileName}' no existe en el nuevo Storage.`);
                    }
                } catch (error) {
                    log.error(` -> ERROR DE REPARACIÓN: Falló la actualización para el cliente ${doc.id}:`, error.message);
                }
            }
        } else {
            log.info(` -> No tiene 'rutUrl' o está vacía. Saltando.`);
        }
    }

    // --- DIAGNÓSTICO PARA PROVEEDORES (lógica idéntica) ---
    log.info("--- Revisando Proveedores ---");
    const proveedoresSnapshot = await db.collection("proveedores").get();
    log.info(`Encontrados ${proveedoresSnapshot.docs.length} proveedores.`);
    for (const doc of proveedoresSnapshot.docs) {
        const data = doc.data();
        log.info(`[Proveedor: ${doc.id}] Revisando...`);
        if (data.rutUrl && data.rutUrl.trim() !== '') {
            log.info(` -> URL encontrada: ${data.rutUrl}`);
            const isIncorrect = !data.rutUrl.includes(NEW_PROJECT_ID);
            log.info(` -> ¿La URL es incorrecta? (No incluye '${NEW_PROJECT_ID}'): ${isIncorrect}`);
            if (isIncorrect) {
                log.warn(` -> ¡URL INCORRECTA DETECTADA! Intentando actualizar...`);
                 try {
                    const oldUrl = new URL(data.rutUrl);
                    const decodedPath = decodeURIComponent(oldUrl.pathname);
                    const fileName = decodedPath.substring(decodedPath.lastIndexOf('/') + 1);
                    const file = bucket.file(`ruts_proveedores/${fileName}`);
                     const [exists] = await file.exists();
                     if(exists) {
                        const [newUrl] = await file.getSignedUrl({ action: 'read', expires: '03-09-2491' });
                        await doc.ref.update({ rutUrl: newUrl });
                        updatedCount++;
                        log.info(` -> ÉXITO: URL del proveedor ${doc.id} actualizada.`);
                     } else {
                         log.error(` -> ERROR DE REPARACIÓN: El archivo 'ruts_proveedores/${fileName}' no existe en el nuevo Storage.`);
                     }
                } catch (error) {
                    log.error(` -> ERROR DE REPARACIÓN: Falló la actualización para el proveedor ${doc.id}:`, error.message);
                }
            }
        } else {
             log.info(` -> No tiene 'rutUrl' o está vacía. Saltando.`);
        }
    }

    const resultMessage = `Diagnóstico completado. Se intentaron actualizar ${updatedCount} enlaces de RUTs.`;
    log.info(resultMessage);
    return { success: true, message: resultMessage };
});