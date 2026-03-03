// index.js (en tu carpeta /functions)
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer"); // <--- NUEVA LIBRERÍA
const { jsPDF } = require("jspdf");
require("jspdf-autotable");
const axios = require("axios");
const { getStorage } = require("firebase-admin/storage");
const { PDFDocument, rgb, StandardFonts, PageSizes } = require("pdf-lib");
const cors = require("cors")({ origin: true });
const ExcelJS = require('exceljs');

admin.initializeApp();
const db = admin.firestore();

// --- CONFIGURACIÓN DE NODEMAILER (cPanel SMTP) ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: parseInt(process.env.SMTP_PORT) === 465, // true para puerto 465, false para otros (587)
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
const FROM_EMAIL = process.env.SMTP_USER;

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

const BUCKET_NAME = "vidrioexpres1.firebasestorage.app";

// **** INICIO DE LA NUEVA FUNCIÓN ****
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
    const usersCollection = admin.firestore().collection("users");
    const snapshot = await usersCollection.limit(2).get();

    if (snapshot.size === 1) {
        functions.logger.log(`Asignando rol de 'admin' y estado 'active' al primer usuario: ${user.uid}`);
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
    return null; 
});

function formatCurrency(value) {
    return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        minimumFractionDigits: 0,
    }).format(value || 0);
}

exports.getFirebaseConfig = functions.https.onRequest((request, response) => {
    cors(request, response, () => {
        if (!functions.config().prisma) {
            return response.status(500).json({
                error: "La configuración de Firebase no está definida en el servidor.",
            });
        }
        return response.status(200).json(functions.config().prisma);
    });
});

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

function generarPDFCliente(remision) {
    const { jsPDF } = require("jspdf");
    require("jspdf-autotable");

    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.height;
    const headerHeight = 85;
    const footerMargin = 20;

    const addHeader = () => {
        doc.setFont("helvetica", "bold").setFontSize(18).text("Remisión de Servicio", 105, 20, { align: "center" });
        doc.setFontSize(10).setFont("helvetica", "bold").text("IMPORTADORA VIDRIO EXPRESS SAS", 105, 28, { align: "center" });
        doc.setFont("helvetica", "normal").text("Tels: 311 8109893 - 310 2557543", 105, 33, { align: "center" });
        doc.text("Cra 27 No 67-58", 105, 38, { align: "center" });
        doc.setFontSize(14).setFont("helvetica", "bold").text(`Remisión N°: ${remision.numeroRemision}`, 190, 45, { align: "right" });
    };

    const addPageNumber = (data) => {
        doc.setFontSize(8);
        doc.text(`Página ${data.pageNumber} de ${data.pageCount}`, 105, pageHeight - 10, { align: 'center' });
    };

    const addFinalSignature = () => {
        const footerY = pageHeight - 45;
        doc.line(40, footerY, 120, footerY);
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
            addPageNumber(data);

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
    const spaceNeeded = 80;

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
    if (remision.retention && remision.retention.amount > 0) {
        doc.setFont("helvetica", "bold").text("Retenciones:", 130, yPos);
        doc.setFont("helvetica", "normal").text(`-${formatCurrency(remision.retention.amount)}`, 190, yPos, { align: "right" });
        yPos += 7;
    }
    if (remision.incluyeIVA) {
        doc.setFont("helvetica", "bold").text("IVA (19%):", 130, yPos);
        doc.setFont("helvetica", "normal").text(formatCurrency(remision.valorIVA), 190, yPos, { align: "right" });
        yPos += 7;
    }
    doc.setFont("helvetica", "bold").text("TOTAL:", 130, yPos);
    doc.text(formatCurrency(remision.valorTotal), 190, yPos, { align: "right" });

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

async function generarPDF(remision, isForPlanta = false) {
    const db = admin.firestore();

    const pdfDocFinal = await PDFDocument.create();
    const font = await pdfDocFinal.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDocFinal.embedFont(StandardFonts.HelveticaBold);

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

    const addFooter = (doc, pageNumber, pageCount) => {
        const pageHeight = doc.internal.pageSize.height;
        doc.setFontSize(8);
        doc.text(`Página ${pageNumber} de ${pageCount}`, 105, pageHeight - 10, { align: 'center' });
    };

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

    let finalY = paginaResumen.lastAutoTable.finalY;
    const pageCountAfterTable = paginaResumen.internal.getNumberOfPages();
    paginaResumen.setPage(pageCountAfterTable);

    if (remision.observaciones && remision.observaciones.trim() !== '') {
        finalY += 7; 
        if (finalY > paginaResumen.internal.pageSize.height - 40) {
            paginaResumen.addPage();
            addHeader(paginaResumen, isForPlanta ? "Orden de Producción" : "Remisión de Servicio");
            addFooter(paginaResumen, pageCountAfterTable + 1, pageCountAfterTable + 1);
            finalY = headerHeight - 20;
        }
        paginaResumen.setFontSize(10).setFont("helvetica", "bold").text("Observaciones:", 20, finalY);
        finalY += 5;
        const observacionesText = paginaResumen.setFont("helvetica", "normal").setFontSize(9).splitTextToSize(remision.observaciones, 170);
        paginaResumen.text(observacionesText, 20, finalY);
        finalY += (observacionesText.length * 4);
    }

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
        if (remision.retention && remision.retention.amount > 0) {
            paginaResumen.setFont("helvetica", "bold").text("Retenciones:", 130, yPos);
            paginaResumen.setFont("helvetica", "normal").text(`-${formatCurrency(remision.retention.amount)}`, 190, yPos, { align: "right" });
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

    const itemsCortados = remision.items.filter(item => item.tipo === 'Cortada' && item.planoDespiece && item.planoDespiece.length > 0);
    if (itemsCortados.length > 0) {
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

exports.getSignedUrlForPath = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "El usuario no está autenticado.");
    const filePath = data.path;
    if (!filePath) throw new functions.https.HttpsError("invalid-argument", "La ruta del archivo es requerida.");

    try {
        const bucket = getStorage().bucket(BUCKET_NAME);
        const file = bucket.file(filePath);
        const [url] = await file.getSignedUrl({
            action: "read",
            expires: Date.now() + 15 * 60 * 1000, 
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
            const pdfBufferCliente = await generarPDFCliente(remisionData);
            const pdfBufferAdmin = await generarPDF(remisionData, false);
            const pdfBufferPlanta = await generarPDF(remisionData, true);

            const bucket = admin.storage().bucket();
            const filePathAdmin = `remisiones/${remisionData.numeroRemision}.pdf`;
            const fileAdmin = bucket.file(filePathAdmin); 
            await fileAdmin.save(pdfBufferAdmin);

            const filePathPlanta = `remisiones/planta-${remisionData.numeroRemision}.pdf`;
            await bucket.file(filePathPlanta).save(pdfBufferPlanta);

            await snap.ref.update({
                pdfPath: filePathAdmin,
                pdfPlantaPath: filePathPlanta
            });
            log("PDFs guardados y rutas almacenadas correctamente.");

// 4. Enviar notificación por correo con Nodemailer (cPanel)
            try {
                const msg = {
                    from: `"Vidrio Express" <${FROM_EMAIL}>`, // Remitente
                    to: remisionData.clienteEmail,            // Destinatario
                    subject: `Confirmación de Remisión N° ${remisionData.numeroRemision}`,
                    html: `<p>Hola ${remisionData.clienteNombre}, adjuntamos tu remisión. El estado es: <strong>${remisionData.estado}</strong>.</p>`,
                    attachments: [{
                        filename: `Remision-${remisionData.numeroRemision}.pdf`,
                        content: pdfBufferCliente,
                        contentType: "application/pdf",
                    }],
                };
                await transporter.sendMail(msg);
                emailStatus = "sent";
                log("Correo enviado al cliente exitosamente por SMTP.");
            } catch (emailError) {
                log(`Error al enviar correo (Nodemailer): ${emailError.message}`);
                emailStatus = "error";
            }
            
            // 4.1 Enviar a la impresora con Nodemailer (cPanel)
            try {
                const printerMsg = { 
                    from: `"Vidrio Express" <${FROM_EMAIL}>`, 
                    to: "oficinavidriosexito@print.brother.com", // Correo de tu impresora
                    subject: `Impresión Orden ${remisionData.numeroRemision}`,
                    text: "Imprimir archivo adjunto",
                    attachments: [{ 
                        filename: `Remision-${remisionData.numeroRemision}.pdf`, 
                        content: pdfBufferAdmin, 
                        contentType: "application/pdf" 
                    }]
                };
                await transporter.sendMail(printerMsg);
                log("Correo enviado a la impresora exitosamente.");
            } catch (printerError) { 
                log(`Error al enviar a impresora (Nodemailer): ${printerError.message}`); 
            }
            
            // 5. Enviar notificación por WhatsApp con un enlace temporal
            try {
                const [whatsappUrl] = await fileAdmin.getSignedUrl({
                    action: 'read',
                    expires: Date.now() + 15 * 60 * 1000, 
                });

                const clienteDoc = await admin.firestore().collection("clientes").doc(remisionData.idCliente).get();
                if (clienteDoc.exists) {
                    const clienteData = clienteDoc.data();
                    const telefonos = [clienteData.telefono1, clienteData.telefono2].filter(Boolean);
                    if (telefonos.length > 0) {
                        for (const telefono of telefonos) {
                            await sendWhatsAppRemision(telefono, remisionData.clienteNombre, remisionData.numeroRemision.toString(), remisionData.estado, whatsappUrl);
                        }
                        whatsappStatus = "sent";
                    } else { whatsappStatus = "no_phone"; }
                } else { whatsappStatus = "client_not_found"; }
            } catch (whatsappError) {
                log("Error en el proceso de WhatsApp:", whatsappError.message);
                whatsappStatus = "error";
            }

            return snap.ref.update({ emailStatus, whatsappStatus });

        } catch (error) {
            log("Error General en onRemisionCreate:", error);
            return snap.ref.update({ errorLog: error.message, emailStatus: "error", whatsappStatus: "error" });
        }
    });

exports.onRemisionUpdate = functions.region("us-central1").firestore
    .document("remisiones/{remisionId}")
    .onUpdate(async (change, context) => {
        const afterData = change.after.data();
        const beforeData = change.before.data();
        const remisionId = context.params.remisionId;
        const log = (message) => functions.logger.log(`[Actualización ${remisionId}] ${message}`);

        const sendNotifications = async (motivo) => {
            try {
                const bucket = admin.storage().bucket();
                const file = bucket.file(afterData.pdfPath); 
                const [whatsappUrl] = await file.getSignedUrl({
                    action: 'read',
                    expires: Date.now() + 15 * 60 * 1000, 
                });

                const clienteDoc = await admin.firestore().collection("clientes").doc(afterData.idCliente).get();
                if (clienteDoc.exists) {
                    const clienteData = clienteDoc.data();
                    const telefonos = [clienteData.telefono1, clienteData.telefono2].filter(Boolean);
                    for (const telefono of telefonos) {
                        await sendWhatsAppRemision(telefono, afterData.clienteNombre, afterData.numeroRemision.toString(), afterData.estado, whatsappUrl);
                    }
                }
            } catch (error) {
                log(`Error crítico al enviar notificaciones (${motivo}):`, error);
            }
        };

        // --- Caso 1: La remisión es ANULADA ---
        if (beforeData.estado !== "Anulada" && afterData.estado === "Anulada") {
            log("Detectada anulación. Regenerando PDFs, restaurando stock y notificando...");
            try {
                const batch = admin.firestore().batch();
                (afterData.items || []).forEach(item => {
                    if (item.itemId && item.cantidad > 0) {
                        const itemRef = db.collection("items").doc(item.itemId);
                        batch.update(itemRef, { 
                            stock: admin.firestore.FieldValue.increment(item.cantidad),
                            _lastUpdated: admin.firestore.FieldValue.serverTimestamp() 
                        });
                    }
                });
                await batch.commit();
                log("Inventario restaurado.");

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
                    pdfPlantaPath: filePathPlanta,
                    _lastUpdated: admin.firestore.FieldValue.serverTimestamp() 
                });
                log("Rutas de PDFs actualizadas para anulación.");

                try {
                    const msg = {
                        from: `"Vidrio Express" <${FROM_EMAIL}>`,
                        to: afterData.clienteEmail,
                        subject: `Anulación de Remisión N° ${afterData.numeroRemision}`,
                        html: `<p>Hola ${afterData.clienteNombre},</p><p>Te informamos que la remisión N° <strong>${afterData.numeroRemision}</strong> ha sido <strong>ANULADA</strong>.</p>`,
                        attachments: [{ filename: `Remision-ANULADA-${afterData.numeroRemision}.pdf`, content: pdfBufferCliente, contentType: "application/pdf" }],
                    };
                    await transporter.sendMail(msg);
                } catch (e) { log("Error de Nodemailer:", e.message); }
                
                await sendNotifications("Anulación");

            } catch (error) { log("Error al procesar anulación:", error); }
        }
        // --- Caso 2: La remisión es ENTREGADA ---
        else if (beforeData.estado !== "Entregado" && afterData.estado === "Entregado") {
            log("Detectada entrega. Regenerando PDFs y notificando.");
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
                    pdfPlantaPath: filePathPlanta,
                    _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                });
                log("Rutas de PDFs actualizadas por entrega.");

                try {
                    const msg = {
                         from: `"Vidrio Express" <${FROM_EMAIL}>`,
                         to: afterData.clienteEmail,
                         subject: `Tu orden N° ${afterData.numeroRemision} ha sido entregada`,
                         html: `<p>Hola ${afterData.clienteNombre},</p><p>Te informamos que tu orden N° <strong>${afterData.numeroRemision}</strong> ha sido completada y marcada como <strong>ENTREGADA</strong>.</p>`,
                         attachments: [{ filename: `Remision-ENTREGADA-${afterData.numeroRemision}.pdf`, content: pdfBufferCliente, contentType: "application/pdf" }],
                    };
                    await transporter.sendMail(msg);
                } catch (e) { log("Error de Nodemailer:", e.message); }
                
                await sendNotifications("Entrega");

            } catch (error) { log("Error al procesar entrega:", error); }
        }
        return null;
    });

exports.getFirebaseConfig = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "El usuario debe estar autenticado para solicitar la configuración.");
    return functions.config().prisma;
});

exports.applyDiscount = functions.https.onCall(async (data, context) => {
    if (!context.auth || context.auth.token.role !== 'admin') {
        throw new functions.https.HttpsError("permission-denied", "Solo los administradores pueden aplicar descuentos.");
    }

    const { remisionId, discountPercentage } = data;
    if (!remisionId || discountPercentage === undefined) {
        throw new functions.https.HttpsError("invalid-argument", "Faltan datos para aplicar el descuento.");
    }

    const remisionRef = admin.firestore().collection("remisiones").doc(remisionId);
    const log = functions.logger;

    try {
        const remisionDoc = await remisionRef.get();
        if (!remisionDoc.exists) throw new functions.https.HttpsError("not-found", "La remisión no existe.");

        const remisionData = remisionDoc.data();
        
        const subtotal = remisionData.subtotal;
        const discountAmount = subtotal * (discountPercentage / 100);
        const subtotalWithDiscount = subtotal - discountAmount;
        const newIva = remisionData.incluyeIVA ? subtotalWithDiscount * 0.19 : 0;
        const newTotal = subtotalWithDiscount + newIva;

        const updatedDataForFirestore = {
            valorTotal: newTotal,
            valorIVA: newIva,
            discount: {
                percentage: discountPercentage,
                amount: discountAmount,
                appliedBy: context.auth.uid,
                appliedAt: new Date(),
            },
        };

        const finalRemisionData = { ...remisionData, ...updatedDataForFirestore };
        const pdfBufferCliente = await generarPDFCliente(finalRemisionData);
        const pdfBufferAdmin = await generarPDF(finalRemisionData, false);
        const pdfBufferPlanta = await generarPDF(finalRemisionData, true);

        const bucket = admin.storage().bucket();
        const filePathAdmin = `remisiones/${finalRemisionData.numeroRemision}.pdf`;
        const fileAdmin = bucket.file(filePathAdmin);
        await fileAdmin.save(pdfBufferAdmin);

        const filePathPlanta = `remisiones/planta-${finalRemisionData.numeroRemision}.pdf`;
        await bucket.file(filePathPlanta).save(pdfBufferPlanta);

        await remisionRef.update({
            ...updatedDataForFirestore,
            pdfPath: filePathAdmin,
            pdfPlantaPath: filePathPlanta,
            pdfUrl: admin.firestore.FieldValue.delete(),
            pdfPlantaUrl: admin.firestore.FieldValue.delete(),
            _lastUpdated: admin.firestore.FieldValue.serverTimestamp() 
        });
        log(`Descuento aplicado y PDFs regenerados para la remisión ${remisionId}.`);
        
        try {
            const msg = {
                from: `"Vidrio Express" <${FROM_EMAIL}>`,
                to: finalRemisionData.clienteEmail,
                subject: `Descuento aplicado a tu Remisión N° ${finalRemisionData.numeroRemision}`,
                html: `<p>Hola ${finalRemisionData.clienteNombre}, se ha aplicado un descuento. El nuevo total es: <strong>${formatCurrency(newTotal)}</strong>.</p>`,
                attachments: [{
                    filename: `Remision-Actualizada-${finalRemisionData.numeroRemision}.pdf`,
                    content: pdfBufferCliente,
                    contentType: "application/pdf",
                }],
            };
            await transporter.sendMail(msg);
        } catch (e) { log("Error al notificar descuento por correo:", e.message); }

        try {
            const [whatsappUrl] = await fileAdmin.getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1000 });
            const clienteDoc = await admin.firestore().collection("clientes").doc(remisionData.idCliente).get();
            if (clienteDoc.exists) {
                const clienteData = clienteDoc.data();
                const telefonos = [clienteData.telefono1, clienteData.telefono2].filter(Boolean);
                for (const telefono of telefonos) {
                    await sendWhatsAppRemision(telefono, remisionData.clienteNombre, remisionData.numeroRemision.toString(), "Descuento Aplicado", whatsappUrl);
                }
            }
        } catch (e) { log("Error al enviar notificación de descuento por WhatsApp:", e); }

        return { success: true, message: "Descuento aplicado y notificaciones enviadas." };

    } catch (error) {
        log(`Error al aplicar descuento para ${remisionId}:`, error);
        throw new functions.https.HttpsError("internal", "No se pudo aplicar el descuento.");
    }
});

exports.onResendEmailRequest = functions.region("us-central1").firestore
    .document("resendQueue/{queueId}")
    .onCreate(async (snap, context) => {
        const request = snap.data();
        const remisionId = request.remisionId;
        const log = (message) => functions.logger.log(`[Reenvío ${remisionId}] ${message}`);

        log("Iniciando reenvío de correo.");

        try {
            const remisionDoc = await admin.firestore().collection("remisiones").doc(remisionId).get();
            if (!remisionDoc.exists) {
                log("La remisión no existe.");
                return snap.ref.delete();
            }
            const remisionData = remisionDoc.data();

            const bucket = admin.storage().bucket();
            const filePath = `remisiones/${remisionData.numeroRemision}.pdf`;
            const [pdfBuffer] = await bucket.file(filePath).download();
            log("PDF descargado desde Storage.");

            const msg = {
                from: `"Vidrio Express" <${FROM_EMAIL}>`,
                to: remisionData.clienteEmail,
                subject: `[Reenvío] Remisión N° ${remisionData.numeroRemision}`,
                html: `<p>Hola ${remisionData.clienteNombre},</p><p>Como solicitaste, aquí tienes una copia de tu remisión.</p>`,
                attachments: [{
                    filename: `Remision-${remisionData.numeroRemision}.pdf`,
                    content: pdfBuffer,
                    contentType: "application/pdf",
                }],
            };
            await transporter.sendMail(msg);
            log(`Correo reenviado a ${remisionData.clienteEmail}.`);

            return snap.ref.delete();
        } catch (error) {
            log("Error en el reenvío:", error);
            return snap.ref.update({ status: "error", error: error.message });
        }
    });

exports.updateEmployeeDocument = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "El usuario no está autenticado.");

    const uid = context.auth.uid;
    const userDoc = await admin.firestore().collection("users").doc(uid).get();
    const userData = userDoc.data();

    if (userData.role !== "admin") throw new functions.https.HttpsError("permission-denied", "El usuario no tiene permisos de administrador.");

    const { employeeId, docType, fileUrl } = data;
    if (!employeeId || !docType || !fileUrl) throw new functions.https.HttpsError("invalid-argument", "Faltan datos (employeeId, docType, fileUrl).");

    try {
        const employeeDocRef = admin.firestore().collection("users").doc(employeeId);
        const updatePayload = { [`documentos.${docType}`]: fileUrl };
        await employeeDocRef.update(updatePayload);
        return { success: true, message: `Documento '${docType}' actualizado para el empleado ${employeeId}.` };
    } catch (error) {
        functions.logger.error(`Error al actualizar documento para ${employeeId}:`, error);
        throw new functions.https.HttpsError("internal", "No se pudo actualizar el documento del empleado.");
    }
});

exports.onImportacionUpdate = functions.firestore
    .document("importaciones/{importacionId}")
    .onUpdate(async (change, context) => {
        const beforeData = change.before.data();
        const afterData = change.after.data();
        const importacionId = context.params.importacionId;
        const log = (message) => functions.logger.log(`[Imp Update ${importacionId}] ${message}`);

        const gastosAntes = beforeData.gastosNacionalizacion || {};
        const gastosDespues = afterData.gastosNacionalizacion || {};

        for (const tipoGasto of Object.keys(gastosDespues)) {
            const facturasAntes = gastosAntes[tipoGasto]?.facturas || [];
            const facturasDespues = gastosDespues[tipoGasto].facturas || [];

            facturasDespues.forEach((factura) => {
                const facturaAnterior = facturasAntes.find(f => f.id === factura.id);
                const abonosAntes = facturaAnterior?.abonos || [];
                const abonosDespues = factura.abonos || [];

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
                        facturaId: factura.id,
                        _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                    };

                    admin.firestore().collection("gastos").add(nuevoGastoDoc)
                        .then(() => log("Gasto por abono registrado con éxito."))
                        .catch(err => functions.logger.error("Error al registrar gasto por abono:", err));
                }
            });
        }
        return null;
    });

exports.setMyUserAsAdmin = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.status(204).send('');
        return;
    }

    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) return res.status(401).send({ error: 'Unauthorized: No se proporcionó token.' });

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

exports.onUserRoleChange = functions.firestore
    .document('users/{userId}')
    .onWrite(async (change, context) => {
        const userId = context.params.userId;
        const afterData = change.after.exists ? change.after.data() : null;
        const beforeData = change.before.exists ? change.before.data() : null;

        const newRole = afterData ? afterData.role : null;
        const oldRole = beforeData ? beforeData.role : null;

        if (newRole === oldRole) return null;

        try {
            const validRoles = ['admin', 'planta', 'contabilidad'];
            if (newRole && validRoles.includes(newRole)) {
                await admin.auth().setCustomUserClaims(userId, { role: newRole });
                console.log(`Permiso de '${newRole}' asignado al usuario ${userId}.`);
            } else {
                await admin.auth().setCustomUserClaims(userId, null);
                console.log(`Permisos personalizados eliminados para el usuario ${userId}.`);
            }
        } catch (error) {
            console.error(`Error al establecer permisos para ${userId}:`, error);
        }
        return null;
    });

exports.checkMyClaims = functions.https.onRequest((req, res) => {
    cors(req, res, async () => {
        try {
            const idToken = req.headers.authorization?.split("Bearer ")[1];
            if (!idToken) return res.status(401).send({ error: "No autenticado." });
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            return res.status(200).send({ data: { claims: decodedToken } });
        } catch (error) {
            console.error("Error al verificar el token:", error);
            return res.status(500).send({ error: "Error interno al procesar la solicitud." });
        }
    });
});

exports.setInitialBalances = functions.https.onCall(async (data, context) => {
    if (!context.auth || context.auth.token.role !== 'admin') {
        throw new functions.https.HttpsError("permission-denied", "Solo los administradores pueden establecer los saldos iniciales.");
    }
    const balances = data;
    for (const key in balances) {
        if (typeof balances[key] !== 'number') throw new functions.https.HttpsError("invalid-argument", `El valor para "${key}" no es un número.`);
    }

    try {
        const balanceDocRef = admin.firestore().collection("saldosIniciales").doc("current");
        await balanceDocRef.set(balances, { merge: true });
        return { success: true, message: "Saldos iniciales guardados correctamente." };
    } catch (error) {
        functions.logger.error("Error al guardar saldos iniciales:", error);
        throw new functions.https.HttpsError("internal", "No se pudo guardar la información en la base de datos.");
    }
});

exports.regenerateAllRemisionUrls = functions.https.onCall(async (data, context) => {
    if (!context.auth || context.auth.token.role !== 'admin') throw new functions.https.HttpsError("permission-denied", "Solo los administradores pueden ejecutar esta operación.");

    const log = functions.logger;
    log.info("Iniciando la REGENERACIÓN Y REPARACIÓN de todas las remisiones...");

    const remisionesRef = db.collection("remisiones");
    const snapshot = await remisionesRef.get();

    if (snapshot.empty) return { success: true, message: "No hay remisiones para actualizar." };

    const bucket = admin.storage().bucket();
    let updatedCount = 0; let repairedCount = 0;
    const batchSize = 100;
    let batch = db.batch();

    for (let i = 0; i < snapshot.docs.length; i++) {
        const doc = snapshot.docs[i];
        const remision = doc.data();
        let updates = {};

        const adminPath = `remisiones/${remision.numeroRemision}.pdf`;
        const plantaPath = `remisiones/planta-${remision.numeroRemision}.pdf`;
        const fileAdmin = bucket.file(adminPath);
        const filePlanta = bucket.file(plantaPath);

        const [existsAdmin] = await fileAdmin.exists();
        
        if (!existsAdmin) {
            log.warn(`PDF no encontrado para remisión N° ${remision.numeroRemision}. REGENERANDO...`);
            try {
                const pdfBufferAdmin = await generarPDF(remision, false);
                await fileAdmin.save(pdfBufferAdmin);
                const pdfBufferPlanta = await generarPDF(remision, true);
                await filePlanta.save(pdfBufferPlanta);

                updates.pdfPath = adminPath;
                updates.pdfPlantaPath = plantaPath;
                repairedCount++; 
                log.info(`PDF para N° ${remision.numeroRemision} REPARADO.`);
            } catch (creationError) { continue; }
        } else {
            if (!remision.pdfPath) {
                 updates.pdfPath = adminPath;
                 updates.pdfPlantaPath = plantaPath;
                 updatedCount++;
            }
        }

        if (Object.keys(updates).length > 0) batch.update(doc.ref, updates);

        if ((i + 1) % batchSize === 0) {
            await batch.commit();
            batch = db.batch();
        }
    }
    if ((repairedCount + updatedCount) > 0 && (repairedCount + updatedCount) % batchSize !== 0) await batch.commit();
    return { success: true, message: `Proceso completado. Se actualizaron ${updatedCount} enlaces y se repararon ${repairedCount} remisiones con PDFs faltantes.` };
});

exports.exportGastosToExcel = functions.https.onCall(async (data, context) => {
    const userRole = context.auth.token.role;
    const allowedRoles = ['admin', 'contabilidad'];

    if (!context.auth || !allowedRoles.includes(userRole)) throw new functions.https.HttpsError('permission-denied', 'Solo los administradores o contabilidad pueden exportar datos.');

    const { startDate, endDate } = data;
    if (!startDate || !endDate) throw new functions.https.HttpsError('invalid-argument', 'Se requieren fechas de inicio y fin.');

    try {
        const gastosRef = db.collection('gastos');
        const snapshot = await gastosRef.where('fecha', '>=', startDate).where('fecha', '<=', endDate).get();

        if (snapshot.empty) return { success: false, message: 'No se encontraron gastos en el rango de fechas seleccionado.' };

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Gastos');

        worksheet.columns = [
            { header: 'Fecha', key: 'fecha', width: 15 },
            { header: 'Proveedor', key: 'proveedorNombre', width: 30 },
            { header: 'N° Factura', key: 'numeroFactura', width: 20 },
            { header: 'Fuente de Pago', key: 'fuentePago', width: 20 },
            { header: 'Valor Total', key: 'valorTotal', width: 20, style: { numFmt: '"$"#,##0' } }
        ];

        snapshot.forEach(doc => worksheet.addRow(doc.data()));

        const buffer = await workbook.xlsx.writeBuffer();
        const fileContent = Buffer.from(buffer).toString('base64');
        return { success: true, fileContent: fileContent };

    } catch (error) { throw new functions.https.HttpsError('internal', 'No se pudo generar el archivo Excel.'); }
});

exports.deleteGastoNacionalizacion = functions.region("us-central1").https.onCall(async (data, context) => {
    if (!context.auth || context.auth.token.role !== 'admin') throw new functions.https.HttpsError('permission-denied', 'Solo los administradores pueden realizar esta acción.');

    const { importacionId, gastoTipo, facturaId } = data;
    if (!importacionId || !gastoTipo || !facturaId) throw new functions.https.HttpsError('invalid-argument', 'Faltan datos para eliminar el gasto.');

    const importacionRef = db.collection("importaciones").doc(importacionId);

    try {
        await db.runTransaction(async (transaction) => {
            const importacionDoc = await transaction.get(importacionRef);
            if (!importacionDoc.exists) throw new Error("La importación no fue encontrada.");

            const importacionData = importacionDoc.data();
            const gastosNacionalizacion = importacionData.gastosNacionalizacion || {};
            const gastoActual = gastosNacionalizacion[gastoTipo];

            if (!gastoActual || !gastoActual.facturas) throw new Error("El grupo de gasto no fue encontrado.");

            const facturaIndex = gastoActual.facturas.findIndex(f => f.id === facturaId);
            if (facturaIndex === -1) return;

            const facturaAEliminar = gastoActual.facturas[facturaIndex];
            if (facturaAEliminar.abonos && facturaAEliminar.abonos.length > 0) throw new functions.https.HttpsError('permission-denied', 'No se puede eliminar un gasto que ya tiene abonos registrados.');

            gastoActual.facturas.splice(facturaIndex, 1);

            let nuevoTotalNacionalizacionCOP = 0;
            Object.values(gastosNacionalizacion).forEach(gasto => {
                (gasto.facturas || []).forEach(factura => { nuevoTotalNacionalizacionCOP += factura.valorTotal || 0; });
            });

            transaction.update(importacionRef, {
                gastosNacionalizacion,
                totalNacionalizacionCOP: nuevoTotalNacionalizacionCOP,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        return { success: true, message: "Gasto eliminado con éxito." };
    } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', 'Ocurrió un error al intentar eliminar el gasto.');
    }
});

exports.getSignedUrl = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'El usuario debe estar autenticado para ver archivos.');
    const filePath = data.filePath;
    if (!filePath) throw new functions.https.HttpsError('invalid-argument', 'Se debe proporcionar la ruta del archivo (filePath).');

    try {
        const [url] = await admin.storage().bucket().file(filePath).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000 });
        return { url: url };
    } catch (error) { throw new functions.https.HttpsError('internal', 'No se pudo generar el enlace para el archivo.'); }
});

exports.repairRutUrls = functions.runWith({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
    if (!context.auth || context.auth.token.role !== 'admin') throw new functions.https.HttpsError("permission-denied", "Solo los administradores pueden ejecutar esta operación.");

    const log = functions.logger;
    const bucket = admin.storage().bucket();
    let updatedCount = 0;
    const NEW_PROJECT_ID = "vidrioexpres1";

    const clientesSnapshot = await db.collection("clientes").get();
    for (const doc of clientesSnapshot.docs) {
        const data = doc.data();
        if (data.rutUrl && data.rutUrl.trim() !== '') {
            if (!data.rutUrl.includes(NEW_PROJECT_ID)) {
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
                    }
                } catch (error) {}
            }
        }
    }

    const proveedoresSnapshot = await db.collection("proveedores").get();
    for (const doc of proveedoresSnapshot.docs) {
        const data = doc.data();
        if (data.rutUrl && data.rutUrl.trim() !== '') {
            if (!data.rutUrl.includes(NEW_PROJECT_ID)) {
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
                     }
                } catch (error) {}
            }
        }
    }
    return { success: true, message: `Diagnóstico completado. Se intentaron actualizar ${updatedCount} enlaces de RUTs.` };
});

exports.recordTransfer = functions.https.onCall(async (data, context) => {
    if (!context.auth || context.auth.token.role !== 'admin') throw new functions.https.HttpsError("permission-denied", "Solo los administradores pueden registrar transferencias.");

    const { cuentaOrigen, cuentaDestino, monto, referencia, fechaTransferencia } = data;
    if (!cuentaOrigen || !cuentaDestino || !monto || monto <= 0 || cuentaOrigen === cuentaDestino || !fechaTransferencia) { 
        throw new functions.https.HttpsError("invalid-argument", "Datos de transferencia inválidos o incompletos.");
    }

    try {
        await db.collection("transferencias").add({
            fechaRegistro: admin.firestore.FieldValue.serverTimestamp(),
            fechaTransferencia: fechaTransferencia,
            cuentaOrigen, cuentaDestino, monto,
            referencia: referencia || '',
            estado: 'pendiente',
            registradoPor: context.auth.uid
        });
        return { success: true };
    } catch (error) { throw new functions.https.HttpsError("internal", "No se pudo guardar la transferencia."); }
});

exports.confirmTransfer = functions.https.onCall(async (data, context) => {
    if (!context.auth || context.auth.token.role !== 'admin') throw new functions.https.HttpsError("permission-denied", "Solo los administradores pueden confirmar transferencias.");

    const { transferId } = data;
    if (!transferId) throw new functions.https.HttpsError("invalid-argument", "Falta el ID de la transferencia.");

    const transferRef = db.collection("transferencias").doc(transferId);
    const gastosRef = db.collection("gastos");

    try {
        await db.runTransaction(async (transaction) => {
            const transferDoc = await transaction.get(transferRef);
            if (!transferDoc.exists) throw new Error("La transferencia no existe.");
            
            const transferData = transferDoc.data();
            if (transferData.estado !== 'pendiente') throw new Error("Esta transferencia ya fue procesada o no está pendiente.");
            if (transferData.registradoPor === context.auth.uid) throw new Error("No puedes confirmar una transferencia registrada por ti mismo.");

            transaction.update(transferRef, {
                estado: 'confirmada',
                confirmadoPor: context.auth.uid,
                confirmadoEn: admin.firestore.FieldValue.serverTimestamp(),
                _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });

            const fechaGasto = transferData.fechaTransferencia; 
            const timestamp = admin.firestore.FieldValue.serverTimestamp(); 

            transaction.set(gastosRef.doc(), {
                fecha: fechaGasto, proveedorNombre: `Transferencia Salida -> ${transferData.cuentaDestino}`,
                valorTotal: transferData.monto, fuentePago: transferData.cuentaOrigen, registradoPor: context.auth.uid, timestamp: timestamp,
                isTransfer: true, transferId: transferId, referencia: transferData.referencia || '', _lastUpdated: timestamp
            });

            transaction.set(gastosRef.doc(), {
                fecha: fechaGasto, proveedorNombre: `Transferencia Entrada <- ${transferData.cuentaOrigen}`,
                valorTotal: -transferData.monto, fuentePago: transferData.cuentaDestino, registradoPor: context.auth.uid, timestamp: timestamp,
                isTransfer: true, transferId: transferId, referencia: transferData.referencia || '', _lastUpdated: timestamp
            });
        });
        return { success: true };
    } catch (error) { throw new functions.https.HttpsError("internal", `No se pudo confirmar la transferencia: ${error.message}`); }
});

exports.exportPagosRemisionesToExcel = functions.https.onCall(async (data, context) => {
    const userRole = context.auth.token.role;
    const allowedRoles = ['admin', 'contabilidad'];

    if (!context.auth || !allowedRoles.includes(userRole)) throw new functions.https.HttpsError('permission-denied', 'Solo los administradores o contabilidad pueden exportar estos datos.');

    const { startDate, endDate } = data;
    if (!startDate || !endDate) throw new functions.https.HttpsError('invalid-argument', 'Se requieren fechas de inicio y fin.');

    try {
        const usersRef = db.collection('users');
        const usersSnapshot = await usersRef.get();
        const userNames = {}; 
        
        usersSnapshot.forEach(doc => { userNames[doc.id] = doc.data().nombre || 'Usuario Desconocido'; });

        const remisionesRef = db.collection('remisiones');
        const snapshot = await remisionesRef.get();

        if (snapshot.empty) return { success: false, message: 'No se encontraron remisiones.' };

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Historial Pagos');

        worksheet.columns = [
            { header: 'Fecha Pago', key: 'fecha', width: 15 },
            { header: 'N° Remisión', key: 'numeroRemision', width: 15 },
            { header: 'Cliente', key: 'cliente', width: 30 },
            { header: 'Método', key: 'metodo', width: 15 },
            { header: 'Estado', key: 'estado', width: 15 },
            { header: 'Valor', key: 'valor', width: 20, style: { numFmt: '"$"#,##0' } },
            { header: 'Registrado Por', key: 'registradoPor', width: 25 },
            { header: 'Confirmado Por', key: 'confirmadoPor', width: 25 },
            { header: 'Fecha Registro', key: 'fechaRegistro', width: 20 }
        ];

        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        let pagosEncontrados = 0;

        snapshot.forEach(doc => {
            const remision = doc.data();
            const pagos = Array.isArray(remision.payments) ? remision.payments : [];

            pagos.forEach(pago => {
                const fechaPago = new Date(pago.date + 'T12:00:00');
                if (fechaPago >= start && fechaPago <= end) {
                    const nombreRegistrador = userNames[pago.registeredBy] || 'Sistema/Desconocido';
                    let nombreConfirmador = 'Pendiente';
                    if (pago.status === 'confirmado') {
                        nombreConfirmador = pago.confirmedBy ? (userNames[pago.confirmedBy] || 'Usuario Borrado') : 'N/A';
                    }

                    worksheet.addRow({
                        fecha: pago.date, numeroRemision: remision.numeroRemision, cliente: remision.clienteNombre || 'Sin Nombre',
                        metodo: pago.method, estado: pago.status === 'confirmado' ? 'Confirmado' : 'Pendiente', valor: pago.amount,
                        registradoPor: nombreRegistrador, confirmadoPor: nombreConfirmador,
                        fechaRegistro: pago.registeredAt ? new Date(pago.registeredAt.seconds * 1000).toLocaleDateString() : 'N/A'
                    });
                    pagosEncontrados++;
                }
            });
        });

        if (pagosEncontrados === 0) return { success: false, message: 'No se encontraron pagos en el rango seleccionado.' };

        const buffer = await workbook.xlsx.writeBuffer();
        const fileContent = Buffer.from(buffer).toString('base64');
        return { success: true, fileContent: fileContent };

    } catch (error) { throw new functions.https.HttpsError('internal', 'No se pudo generar el archivo Excel: ' + error.message); }
});

exports.applyRetention = functions.https.onCall(async (data, context) => {
    const userRole = context.auth.token.role;
    const allowedRoles = ['admin', 'contabilidad'];
    
    if (!context.auth || !allowedRoles.includes(userRole)) throw new functions.https.HttpsError("permission-denied", "No tienes permisos para aplicar retenciones.");

    const { remisionId, retentionAmount } = data;
    if (!remisionId || retentionAmount === undefined || retentionAmount < 0) throw new functions.https.HttpsError("invalid-argument", "Valor de retención inválido.");

    const remisionRef = admin.firestore().collection("remisiones").doc(remisionId);
    const log = functions.logger;

    try {
        const remisionDoc = await remisionRef.get();
        if (!remisionDoc.exists) throw new functions.https.HttpsError("not-found", "Remisión no encontrada.");

        const remisionData = remisionDoc.data();
        const subtotal = remisionData.subtotal || 0;
        const discountAmount = remisionData.discount ? remisionData.discount.amount : 0;
        const ivaAmount = remisionData.valorIVA || 0; 
        const totalAntesDeRetencion = subtotal - discountAmount + ivaAmount;

        if (retentionAmount > totalAntesDeRetencion) throw new functions.https.HttpsError("failed-precondition", "La retención no puede ser mayor al total de la factura.");

        const newTotal = totalAntesDeRetencion - retentionAmount;
        const updatedData = {
            valorTotal: newTotal,
            retention: { amount: retentionAmount, appliedBy: context.auth.uid, appliedAt: new Date() }
        };

        const finalRemisionData = { ...remisionData, ...updatedData };
        const pdfBufferCliente = await generarPDFCliente(finalRemisionData);
        const pdfBufferAdmin = await generarPDF(finalRemisionData, false);
        const pdfBufferPlanta = await generarPDF(finalRemisionData, true);

        const bucket = admin.storage().bucket();
        const filePathAdmin = `remisiones/${finalRemisionData.numeroRemision}.pdf`;
        await bucket.file(filePathAdmin).save(pdfBufferAdmin);

        const filePathPlanta = `remisiones/planta-${finalRemisionData.numeroRemision}.pdf`;
        await bucket.file(filePathPlanta).save(pdfBufferPlanta);

        await remisionRef.update({
            ...updatedData, pdfPath: filePathAdmin, pdfPlantaPath: filePathPlanta,
            pdfUrl: admin.firestore.FieldValue.delete(), pdfPlantaUrl: admin.firestore.FieldValue.delete(),
            _lastUpdated: admin.firestore.FieldValue.serverTimestamp() 
        });

        return { success: true, message: "Retención aplicada y total actualizado." };
    } catch (error) { throw new functions.https.HttpsError("internal", error.message); }
});

/**
 * Alterna el IVA de una remisión (Extraer o Revertir) y regenera sus PDFs sincrónicamente.
 */
exports.toggleFacturacionIVA = functions.https.onCall(async (data, context) => {
    if (!context.auth || context.auth.token.role !== 'admin') {
        throw new functions.https.HttpsError("permission-denied", "Solo los administradores pueden modificar el IVA.");
    }

    const { remisionId, action } = data; // action puede ser 'extract' o 'revert'
    const remisionRef = admin.firestore().collection("remisiones").doc(remisionId);

    try {
        const remisionDoc = await remisionRef.get();
        if (!remisionDoc.exists) throw new functions.https.HttpsError("not-found", "Remisión no encontrada.");
        
        const remisionData = remisionDoc.data();
        let updatedData = {};

        if (action === 'extract') {
            if (remisionData.incluyeIVA) return { success: true, message: "Ya incluye IVA" };
            
            const divisor = 1.19;
            const itemsActualizados = remisionData.items.map(item => ({
                ...item, valorUnitario: item.valorUnitario / divisor, valorTotal: item.valorTotal / divisor
            }));
            const cargosActualizados = (remisionData.cargosAdicionales || []).map(cargo => ({
                ...cargo, valorUnitario: cargo.valorUnitario / divisor, valorTotal: cargo.valorTotal / divisor
            }));

            const nuevoSubtotalBase = Math.round(remisionData.subtotal / divisor);
            let nuevoDescuento = null, nuevaRetencion = null;

            if (remisionData.discount && remisionData.discount.amount > 0) 
                nuevoDescuento = { ...remisionData.discount, amount: Math.round(remisionData.discount.amount / divisor) };
            if (remisionData.retention && remisionData.retention.amount > 0) 
                nuevaRetencion = { ...remisionData.retention, amount: Math.round(remisionData.retention.amount / divisor) };

            const subtotalConDescuento = nuevoSubtotalBase - (nuevoDescuento ? nuevoDescuento.amount : 0);
            const nuevoValorIVA = Math.round(subtotalConDescuento * 0.19);
            const totalRecalculado = subtotalConDescuento + nuevoValorIVA - (nuevaRetencion ? nuevaRetencion.amount : 0);
            const diferencia = remisionData.valorTotal - totalRecalculado;

            updatedData = {
                incluyeIVA: true,
                subtotal: nuevoSubtotalBase,
                valorIVA: nuevoValorIVA + diferencia,
                valorTotal: remisionData.valorTotal, // Total intacto
                items: itemsActualizados,
                cargosAdicionales: cargosActualizados
            };
            if (nuevoDescuento) updatedData.discount = nuevoDescuento;
            if (nuevaRetencion) updatedData.retention = nuevaRetencion;

        } else if (action === 'revert') {
            if (!remisionData.incluyeIVA) return { success: true, message: "Ya no incluye IVA" };

            const multiplier = 1.19;
            const itemsRevertidos = remisionData.items.map(item => ({
                ...item, valorUnitario: item.valorUnitario * multiplier, valorTotal: item.valorTotal * multiplier
            }));
            const cargosRevertidos = (remisionData.cargosAdicionales || []).map(cargo => ({
                ...cargo, valorUnitario: cargo.valorUnitario * multiplier, valorTotal: cargo.valorTotal * multiplier
            }));

            const nuevoSubtotalBase = Math.round(remisionData.subtotal * multiplier);
            let nuevoDescuento = null, nuevaRetencion = null;

            if (remisionData.discount && remisionData.discount.amount > 0) 
                nuevoDescuento = { ...remisionData.discount, amount: Math.round(remisionData.discount.amount * multiplier) };
            if (remisionData.retention && remisionData.retention.amount > 0) 
                nuevaRetencion = { ...remisionData.retention, amount: Math.round(remisionData.retention.amount * multiplier) };

            const diff = remisionData.valorTotal - (nuevoSubtotalBase - (nuevoDescuento ? nuevoDescuento.amount : 0) - (nuevaRetencion ? nuevaRetencion.amount : 0));

            updatedData = {
                incluyeIVA: false,
                subtotal: nuevoSubtotalBase + diff,
                valorIVA: 0,
                valorTotal: remisionData.valorTotal,
                items: itemsRevertidos,
                cargosAdicionales: cargosRevertidos
            };
            if (nuevoDescuento) updatedData.discount = nuevoDescuento;
            if (nuevaRetencion) updatedData.retention = nuevaRetencion;
        }

        const finalRemisionData = { ...remisionData, ...updatedData };
        
        // --- 2. REGENERAR PDFS SÍNCRONAMENTE ---
        const pdfBufferCliente = await generarPDFCliente(finalRemisionData);
        const pdfBufferAdmin = await generarPDF(finalRemisionData, false);
        const pdfBufferPlanta = await generarPDF(finalRemisionData, true);

        const bucket = admin.storage().bucket();
        const filePathAdmin = `remisiones/${finalRemisionData.numeroRemision}.pdf`;
        await bucket.file(filePathAdmin).save(pdfBufferAdmin);

        const filePathPlanta = `remisiones/planta-${finalRemisionData.numeroRemision}.pdf`;
        await bucket.file(filePathPlanta).save(pdfBufferPlanta);

        // --- 3. GUARDAR EN BASE DE DATOS ---
        await remisionRef.update({
            ...updatedData,
            pdfPath: filePathAdmin,
            pdfPlantaPath: filePathPlanta,
            pdfUrl: admin.firestore.FieldValue.delete(), 
            pdfPlantaUrl: admin.firestore.FieldValue.delete(),
            _lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, message: "IVA actualizado y PDFs regenerados." };

    } catch (error) {
        functions.logger.error(`Error en toggleFacturacionIVA para ${remisionId}:`, error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});