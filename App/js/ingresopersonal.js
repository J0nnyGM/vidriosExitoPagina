// App/js/ingresopersonal.js

import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

let videoStream = null;

/**
 * Inicia el flujo de reporte de ingreso.
 * @param {Object} db - Instancia de Firestore.
 * @param {Object} storage - Instancia de Storage.
 * @param {Object} currentUser - Usuario autenticado de Firebase Auth.
 * @param {Object} userProfile - Datos del usuario (Firestore) incluyendo foto de perfil y descriptor.
 * @param {Function} openMainModalFunc - Función global para abrir el modal.
 * @param {Function} closeMainModalFunc - Función global para cerrar el modal.
 */
export async function handleReportEntry(db, storage, currentUser, userProfile, openMainModalFunc, closeMainModalFunc) {
    
    // 1. Validaciones iniciales
    if (!currentUser || !userProfile) {
        alert("Error: No se detecta una sesión activa o perfil de usuario.");
        return;
    }

    if (!userProfile.profilePhotoURL) {
        alert("⚠️ Error: No tienes una foto de perfil registrada. Por favor, edita tu perfil y sube una selfie clara.");
        return;
    }

    // 2. Preparar el Modal
    const modalBodyHTML = `
        <div class="flex flex-col items-center justify-center space-y-6 py-4">
            <div class="relative w-64 h-64 sm:w-80 sm:h-80 bg-black rounded-full overflow-hidden shadow-2xl border-4 border-emerald-500 ring-4 ring-emerald-100">
                <video id="entry-camera-video" autoplay playsinline class="w-full h-full object-cover transform scale-x-[-1]"></video>
                <canvas id="entry-camera-canvas" class="absolute top-0 left-0 w-full h-full hidden"></canvas>
                <div class="absolute inset-0 border-2 border-white/40 rounded-full m-8 pointer-events-none border-dashed animate-pulse"></div>
            </div>
            
            <div id="entry-status-msg" class="text-center min-h-[2.5rem] flex items-center justify-center px-4">
                <p class="text-slate-600 font-medium text-sm bg-slate-100 px-4 py-1 rounded-full">
                    <i class="fa-solid fa-face-viewfinder mr-2"></i>Ubica tu rostro en el círculo
                </p>
            </div>

            <div class="flex gap-4 w-full justify-center px-4">
                <button type="button" id="btn-cancel-entry" class="flex-1 max-w-[120px] bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 py-3 rounded-xl font-bold transition-colors shadow-sm">
                    Cancelar
                </button>
                <button id="btn-capture-entry" class="flex-1 max-w-[200px] bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white py-3 rounded-xl font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
                    <i class="fa-solid fa-camera"></i> 
                    <span>Validar Ingreso</span>
                </button>
            </div>
            
            <div class="text-[10px] text-slate-400 text-center mt-2">
                <i class="fa-solid fa-location-dot mr-1"></i> Se registrará tu ubicación actual y biometría.
            </div>
        </div>
    `;

    // Usamos el modal genérico de la app
    // Hack: Modificamos el título manualmente antes de llamar a openMainModal si es necesario, 
    // o pasamos un tipo dummy si openMainModal maneja lógica específica.
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalFooter = document.getElementById('main-modal-footer'); // Ocultamos el footer por defecto
    
    if(modalTitle) modalTitle.textContent = "📸 Validación de Ingreso";
    if(modalBody) modalBody.innerHTML = modalBodyHTML;
    if(modalFooter) modalFooter.style.display = 'none';
    
    // Mostrar el modal
    const mainModal = document.getElementById('main-modal');
    mainModal.style.display = 'flex';

    // 3. Iniciar Cámara
    const videoEl = document.getElementById('entry-camera-video');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        videoStream = stream;
        videoEl.srcObject = stream;
    } catch (err) {
        console.error("Error cámara:", err);
        alert("No se pudo acceder a la cámara. Verifica los permisos del navegador.");
        closeAndCleanup(closeMainModalFunc);
        return;
    }

    // 4. Listeners
    document.getElementById('btn-cancel-entry').addEventListener('click', () => closeAndCleanup(closeMainModalFunc));
    
    document.getElementById('btn-capture-entry').addEventListener('click', async () => {
        const captureBtn = document.getElementById('btn-capture-entry');
        const statusMsg = document.getElementById('entry-status-msg');
        
        captureBtn.disabled = true;
        captureBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

        try {
            // A. Validar que FaceAPI esté listo
            // @ts-ignore (faceapi global)
            if (typeof faceapi === 'undefined') throw new Error("Librería de reconocimiento facial no cargada.");

            // B. Obtener GPS
            updateStatus(statusMsg, 'blue', 'Obteniendo ubicación GPS...');
            const location = await getCurrentLocation();

            // C. Capturar Foto (Canvas)
            const canvas = document.getElementById('entry-camera-canvas');
            canvas.width = videoEl.videoWidth;
            canvas.height = videoEl.videoHeight;
            const ctx = canvas.getContext('2d');
            // Espejo horizontal para que coincida con el video css transform
            ctx.translate(videoEl.videoWidth, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(videoEl, 0, 0);
            // Restaurar contexto
            ctx.setTransform(1, 0, 0, 1, 0, 0);

            // D. Detección Facial
            updateStatus(statusMsg, 'indigo', 'Analizando biometría...');
            
            // Detección Live
            const detection = await faceapi.detectSingleFace(canvas)
                .withFaceLandmarks()
                .withFaceDescriptor();

            if (!detection) {
                throw new Error("No se detectó ningún rostro. Ajusta la iluminación.");
            }

            // E. Comparación Facial
            // Necesitamos cargar la foto de perfil de referencia para sacar su descriptor
            // NOTA: Idealmente el descriptor debería guardarse en Firestore al subir la foto de perfil para no recalcularlo siempre.
            // Aquí lo recalculamos al vuelo para asegurar compatibilidad con datos viejos.
            updateStatus(statusMsg, 'indigo', 'Verificando identidad...');
            
            const referenceImage = await faceapi.fetchImage(userProfile.profilePhotoURL);
            const referenceDetection = await faceapi.detectSingleFace(referenceImage)
                .withFaceLandmarks()
                .withFaceDescriptor();

            if (!referenceDetection) {
                throw new Error("Tu foto de perfil no tiene un rostro claro. Por favor actualízala.");
            }

            const faceMatcher = new faceapi.FaceMatcher(referenceDetection);
            const match = faceMatcher.findBestMatch(detection.descriptor);
            
            // Umbral de distancia (menor es más parecido). 0.6 es el estándar, 0.5 es más estricto.
            if (match.distance > 0.55) {
                throw new Error(`Rostro no coincide (${(match.distance).toFixed(2)}). Intenta de nuevo.`);
            }

            // F. Subir Evidencia y Guardar
            updateStatus(statusMsg, 'emerald', 'Guardando reporte...');
            
            const photoBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
            const filename = `attendance/${currentUser.uid}_${Date.now()}.jpg`;
            const storageRef = ref(storage, filename);
            
            await uploadBytes(storageRef, photoBlob);
            const photoURL = await getDownloadURL(storageRef);

            // Guardar en Firestore
            await addDoc(collection(db, "attendance_reports"), {
                userId: currentUser.uid,
                userName: `${userProfile.firstName} ${userProfile.lastName}`,
                role: userProfile.role || 'operario',
                type: 'ingreso', // Tipo de reporte
                timestamp: serverTimestamp(),
                location: {
                    lat: location.coords.latitude,
                    lng: location.coords.longitude,
                    accuracy: location.coords.accuracy
                },
                photoURL: photoURL,
                biometricDistance: match.distance, // Guardamos qué tan preciso fue el match
                device: navigator.userAgent
            });

            updateStatus(statusMsg, 'green', '¡Ingreso registrado exitosamente!');
            if (navigator.vibrate) navigator.vibrate(200);
            
            setTimeout(() => {
                closeAndCleanup(closeMainModalFunc);
            }, 2000);

        } catch (error) {
            console.error(error);
            updateStatus(statusMsg, 'red', error.message || "Error desconocido");
            captureBtn.disabled = false;
            captureBtn.innerHTML = '<i class="fa-solid fa-camera"></i> Reintentar';
        }
    });
}

// Función auxiliar para cerrar y limpiar cámara
function closeAndCleanup(closeModalFunc) {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    // Restaurar el footer del modal por si se usa para otra cosa
    const modalFooter = document.getElementById('main-modal-footer');
    if(modalFooter) modalFooter.style.display = 'flex';
    
    closeModalFunc();
}

// Función auxiliar para GPS
function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Geolocalización no soportada."));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            resolve,
            (err) => {
                let msg = "Error de ubicación.";
                if(err.code === 1) msg = "Permiso de GPS denegado.";
                else if(err.code === 2) msg = "Señal GPS no encontrada.";
                else if(err.code === 3) msg = "Tiempo de espera GPS agotado.";
                reject(new Error(msg));
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    });
}

// Función auxiliar para mensajes visuales
function updateStatus(element, color, text) {
    // Mapeo simple de colores de Tailwind
    const colorClasses = {
        'blue': 'text-blue-600 bg-blue-50',
        'indigo': 'text-indigo-600 bg-indigo-50',
        'emerald': 'text-emerald-600 bg-emerald-50',
        'green': 'text-green-600 bg-green-50',
        'red': 'text-red-600 bg-red-50'
    };
    
    const classes = colorClasses[color] || 'text-gray-600 bg-gray-50';
    
    element.innerHTML = `
        <p class="${classes} font-bold text-sm px-4 py-2 rounded-full shadow-sm transition-all">
            ${text}
        </p>
    `;
}