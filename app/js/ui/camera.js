// js/ui/camera.js

let cameraStream = null;

/**
 * Abre el modal de la cámara y solicita acceso al dispositivo.
 */
export async function openCameraModal(targetInputId, targetPreviewId) {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-feed');
    const captureBtn = document.getElementById('camera-capture-btn');
    const cancelBtn = document.getElementById('camera-cancel-btn');

    if (!modal || !video || !captureBtn || !cancelBtn) return;

    try {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
        }
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
        });
        video.srcObject = cameraStream;
        modal.style.display = 'flex';

        captureBtn.dataset.targetInputId = targetInputId;
        captureBtn.dataset.targetPreviewId = targetPreviewId;

        cancelBtn.onclick = closeCameraModal;
        captureBtn.onclick = () => capturePhoto();

    } catch (err) {
        console.error("Error al acceder a la cámara:", err);
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
            video.srcObject = cameraStream;
            modal.style.display = 'flex';

            captureBtn.dataset.targetInputId = targetInputId;
            captureBtn.dataset.targetPreviewId = targetPreviewId;

            cancelBtn.onclick = closeCameraModal;
            captureBtn.onclick = () => capturePhoto();
        } catch (err2) {
            alert("No se pudo acceder a la cámara. Revisa los permisos.");
        }
    }
}

/**
 * Cierra el modal de la cámara y detiene el stream de video.
 */
export function closeCameraModal() {
    const modal = document.getElementById('camera-modal');
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Captura la foto desde el stream de video y la procesa.
 */
export function capturePhoto() {
    const video = document.getElementById('camera-feed');
    const canvas = document.getElementById('camera-canvas');
    const captureBtn = document.getElementById('camera-capture-btn');
    const targetInputId = captureBtn.dataset.targetInputId;
    const targetPreviewId = captureBtn.dataset.targetPreviewId;

    if (!video || !canvas || !captureBtn) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

    canvas.toBlob(async (blob) => {
        const photoFile = new File([blob], "camera_capture.jpg", { type: "image/jpeg" });
        closeCameraModal();
        await handlePhotoFile(photoFile, targetInputId, targetPreviewId);
    }, 'image/jpeg', 0.9);
}

/**
 * Procesa el archivo y actualiza la vista previa en el DOM.
 */
export async function handlePhotoFile(file, fileInputId, previewImgId) {
    const previewImg = document.getElementById(previewImgId);
    const promptEl = document.getElementById('editUser-prompt');
    const previewContainer = document.getElementById('editUser-preview');
    const statusEl = document.getElementById('editUser-photo-status');

    if (!previewImg || !promptEl || !previewContainer || !statusEl) return;

    window.processedPhotoFile = null;
    statusEl.textContent = '';
    statusEl.className = 'text-xs text-center h-4 mt-1';

    try {
        const fileType = file.type.toLowerCase();
        const fileName = file.name.toLowerCase();
        const isHEIC = fileType === 'image/heic' || fileType === 'image/heif' || fileName.endsWith('.heic') || fileName.endsWith('.heif');

        window.processedPhotoFile = file;

        if (isHEIC) {
            previewImg.src = '';
            previewContainer.classList.add('hidden');
            promptEl.classList.remove('hidden');
            statusEl.textContent = 'Archivo HEIC. Se convertirá al guardar.';
            statusEl.className = 'text-xs text-center text-blue-600 h-4 mt-1';
        } else {
            statusEl.textContent = 'Cargando vista previa...';
            const reader = new FileReader();
            reader.onload = (event) => {
                previewImg.src = event.target.result;
                previewContainer.classList.remove('hidden');
                promptEl.classList.add('hidden');
                statusEl.textContent = 'Vista previa lista.';
                statusEl.className = 'text-xs text-center text-green-600 h-4 mt-1';
            }
            reader.readAsDataURL(file);
        }

    } catch (err) {
        console.error("Error al procesar la foto:", err);
        statusEl.textContent = 'Error al leer el archivo.';
        statusEl.className = 'text-xs text-center text-red-600 h-4 mt-1';
        window.processedPhotoFile = null;
    }
}
