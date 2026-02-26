// js/modules/funciones.js

import { functions, db } from '../firebase-config.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
import { doc, getDoc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { showModalMessage, hideModal, showTemporaryMessage, currentUser } from '../app.js';

export function setupFuncionesEvents() {
    const exportGastosBtn = document.getElementById('btn-func-export-gastos');
    const exportPagosBtn = document.getElementById('btn-func-export-pagos');

    if (exportGastosBtn) {
        exportGastosBtn.addEventListener('click', () => showExportModal('gastos'));
    }

    if (exportPagosBtn) {
        exportPagosBtn.addEventListener('click', () => showExportModal('pagos'));
    }
}

async function canUserExport(uid) {
    const trackerRef = doc(db, 'exportTrackers', uid);
    const trackerDoc = await getDoc(trackerRef);

    if (trackerDoc.exists()) {
        const lastExportTime = trackerDoc.data().lastExport;
        if (lastExportTime) {
            const now = Date.now();
            const daysSinceLastExport = (now - lastExportTime) / (1000 * 60 * 60 * 24);
            if (daysSinceLastExport < 15) {
                const daysLeft = Math.ceil(15 - daysSinceLastExport);
                return { allowed: false, message: `Has alcanzado el límite de exportaciones. Podrás volver a exportar en ${daysLeft} días.` };
            }
        }
    }
    return { allowed: true };
}

async function logExportAction(uid) {
    const trackerRef = doc(db, 'exportTrackers', uid);
    await setDoc(trackerRef, { lastExport: Date.now() }, { merge: true });
}

function showExportModal(type) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const title = type === 'gastos' ? 'Exportar Gastos a Excel' : 'Exportar Pagos a Excel';
    
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-md w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">${title}</h2>
                <button id="close-export-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="bg-yellow-50 text-yellow-800 p-3 rounded-md text-sm mb-4">
                <p><strong>Nota:</strong> Para proteger el rendimiento del sistema:</p>
                <ul class="list-disc pl-5 mt-1">
                    <li>El rango máximo de fechas es de <strong>3 meses</strong>.</li>
                    <li>Solo puedes realizar una exportación cada <strong>15 días</strong>.</li>
                </ul>
            </div>
            <form id="export-form" data-type="${type}" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium">Fecha de Inicio</label>
                    <input type="date" id="export-start-date" class="w-full p-2 border rounded-lg mt-1" required>
                </div>
                <div>
                    <label class="block text-sm font-medium">Fecha de Fin</label>
                    <input type="date" id="export-end-date" class="w-full p-2 border rounded-lg mt-1" required>
                </div>
                <button type="submit" class="w-full bg-green-600 text-white font-bold py-2 rounded-lg hover:bg-green-700">Generar Excel</button>
            </form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-export-modal').addEventListener('click', hideModal);

    const endDateInput = document.getElementById('export-end-date');
    const startDateInput = document.getElementById('export-start-date');
    endDateInput.valueAsDate = new Date();

    document.getElementById('export-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const exportType = e.target.dataset.type;
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;

        if (!startDate || !endDate) return showModalMessage("Selecciona ambas fechas.");

        // 1. Validar Rango de 3 meses
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays > 92) { // Aprox 3 meses
            return showModalMessage("El rango de fechas no puede superar los 3 meses.");
        }

        if (start > end) {
            return showModalMessage("La fecha de inicio debe ser anterior a la de fin.");
        }

        // 2. Validar límite de 15 días por usuario
        const permission = await canUserExport(currentUser.uid);
        if (!permission.allowed) {
            return showModalMessage(permission.message);
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Generando Reporte...';

        showModalMessage("Generando Excel, por favor no cierres la ventana...", true);

        try {
            const functionName = exportType === 'gastos' ? 'exportGastosToExcel' : 'exportPagosRemisionesToExcel';
            const exportFunction = httpsCallable(functions, functionName);
            const result = await exportFunction({ startDate, endDate });

            if (result.data.success) {
                const byteCharacters = atob(result.data.fileContent);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `Reporte_${exportType.toUpperCase()}_${startDate}_a_${endDate}.xlsx`;
                document.body.appendChild(link); link.click(); document.body.removeChild(link);

                // Registrar que el usuario usó su cuota
                await logExportAction(currentUser.uid);

                hideModal(); 
                showTemporaryMessage("¡Reporte descargado con éxito!", "success");
            } else {
                throw new Error(result.data.message || "No se encontraron datos.");
            }
        } catch (error) {
            showModalMessage(`Error al generar el reporte: ${error.message}`);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Generar Excel';
        }
    });
}