// app/js/ingresopersonal.js

import { collection, addDoc, serverTimestamp, query, where, getDocs, limit } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

let videoStream = null;

/**
 * Calcula el rango del "día operativo" actual.
 * El día comienza a la 1:00 AM y termina a la 1:00 AM del día siguiente.
 */
function getDailyShiftRange() {
    const now = new Date();
    const start = new Date(now);
    
    // Configuramos el inicio a la 1:00 AM de "hoy"
    start.setHours(1, 0, 0, 0);

    // Si la hora actual es menor a la 1:00 AM (ej: 00:30), 
    // entonces todavía estamos en el turno del día anterior.
    if (now < start) {
        start.setDate(start.getDate() - 1);
    }

    // El final es 24 horas después del inicio
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return { start, end };
}

/**
 * Verifica si el usuario ya reportó ingreso en el turno actual.
 */
async function hasReportedToday(db, userId) {
    const { start, end } = getDailyShiftRange();
    
    // Buscamos en la subcolección del usuario
    const q = query(
        collection(db, "users", userId, "attendance_reports"),
        where("type", "==", "ingreso"),
        where("timestamp", ">=", start),
        where("timestamp", "<", end),
        limit(1)
    );

    const snapshot = await getDocs(q);
    return !snapshot.empty;
}

/**
 * Inicia el flujo de reporte de ingreso.
 */
export async function handleReportEntry(db, storage, currentUser, userProfile, openMainModalFunc, closeMainModalFunc) {
    
    // 1. Validaciones de Sesión
    if (!currentUser || !userProfile) {
        alert("Error: No se detecta una sesión activa.");
        return;
    }
    if (!userProfile.profilePhotoURL) {
        alert("⚠️ Error: No tienes una foto de perfil registrada. Sube una selfie en tu perfil para validar tu identidad.");
        return;
    }

    // 2. VALIDACIÓN DE INGRESO ÚNICO (Nueva Lógica)
    // Verificamos si ya marcó entre la 1:00 AM de hoy y mañana
    const alreadyReported = await hasReportedToday(db, currentUser.uid);
    if (alreadyReported) {
        // Mostramos un modal de error o alerta simple
        alert("🚫 Ya registraste tu ingreso el día de hoy.\n\nEl sistema se reinicia a la 1:00 AM.");
        return; // Detenemos la ejecución aquí
    }

    // 3. Preparar el Modal (Si pasó la validación)
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
                <i class="fa-solid fa-location-dot mr-1"></i> Se registrará tu ubicación y biometría.
            </div>
        </div>
    `;

    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalFooter = document.getElementById('main-modal-footer'); 
    
    if(modalTitle) modalTitle.textContent = "📸 Validación de Ingreso";
    if(modalBody) modalBody.innerHTML = modalBodyHTML;
    if(modalFooter) modalFooter.style.display = 'none';
    
    openMainModalFunc('camera_entry');

    // 4. Iniciar Cámara
    const videoEl = document.getElementById('entry-camera-video');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        videoStream = stream;
        videoEl.srcObject = stream;
    } catch (err) {
        console.error("Error cámara:", err);
        alert("No se pudo acceder a la cámara. Verifica permisos.");
        closeAndCleanup(closeMainModalFunc);
        return;
    }

    // 5. Listeners
    document.getElementById('btn-cancel-entry').addEventListener('click', () => closeAndCleanup(closeMainModalFunc));
    
    document.getElementById('btn-capture-entry').addEventListener('click', async () => {
        const captureBtn = document.getElementById('btn-capture-entry');
        const statusMsg = document.getElementById('entry-status-msg');
        
        captureBtn.disabled = true;
        captureBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

        try {
            // @ts-ignore
            if (typeof faceapi === 'undefined') throw new Error("Error: IA Facial no cargada.");

            updateStatus(statusMsg, 'blue', 'Obteniendo ubicación GPS...');
            const location = await getCurrentLocation();

            const canvas = document.getElementById('entry-camera-canvas');
            canvas.width = videoEl.videoWidth;
            canvas.height = videoEl.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.translate(videoEl.videoWidth, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(videoEl, 0, 0);
            ctx.setTransform(1, 0, 0, 1, 0, 0);

            updateStatus(statusMsg, 'indigo', 'Analizando rostro en vivo...');
            const detection = await faceapi.detectSingleFace(canvas).withFaceLandmarks().withFaceDescriptor();

            if (!detection) throw new Error("No se detectó un rostro. Ajusta la luz.");

            updateStatus(statusMsg, 'indigo', 'Verificando identidad...');
            const referenceImage = await faceapi.fetchImage(userProfile.profilePhotoURL);
            const referenceDetection = await faceapi.detectSingleFace(referenceImage).withFaceLandmarks().withFaceDescriptor();

            if (!referenceDetection) throw new Error("Tu foto de perfil no es válida. Actualízala.");

            const faceMatcher = new faceapi.FaceMatcher(referenceDetection);
            const match = faceMatcher.findBestMatch(detection.descriptor);
            
            if (match.distance > 0.55) throw new Error(`Rostro no coincide (${(match.distance).toFixed(2)}).`);

            updateStatus(statusMsg, 'emerald', 'Guardando reporte...');
            
            const photoBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
            const filename = `attendance/${currentUser.uid}/${Date.now()}.jpg`;
            const storageRef = ref(storage, filename);
            
            await uploadBytes(storageRef, photoBlob);
            const photoURL = await getDownloadURL(storageRef);

            // Guardar en la colección del usuario
            await addDoc(collection(db, "users", currentUser.uid, "attendance_reports"), {
                type: 'ingreso',
                timestamp: serverTimestamp(),
                location: {
                    lat: location.coords.latitude,
                    lng: location.coords.longitude,
                    accuracy: location.coords.accuracy
                },
                photoURL: photoURL,
                biometricScore: match.distance,
                device: navigator.userAgent
            });

            updateStatus(statusMsg, 'green', '¡Ingreso registrado!');
            if (navigator.vibrate) navigator.vibrate(200);
            
            setTimeout(() => { closeAndCleanup(closeMainModalFunc); }, 1500);

        } catch (error) {
            console.error(error);
            updateStatus(statusMsg, 'red', error.message || "Error desconocido");
            captureBtn.disabled = false;
            captureBtn.innerHTML = '<i class="fa-solid fa-camera"></i> Reintentar';
        }
    });
}

function closeAndCleanup(closeModalFunc) {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    const modalFooter = document.getElementById('main-modal-footer');
    if(modalFooter) modalFooter.style.display = 'flex';
    closeModalFunc();
}

/**
 * Obtiene la ubicación actual con estrategia de respaldo.
 * Intenta primero GPS preciso; si falla o tarda, usa redes (Wi-Fi/Celdas).
 */
function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error("Tu navegador no soporta geolocalización."));

        // Opciones A: Alta Precisión (GPS) - Tiempo límite 7s
        const highAccuracyOptions = {
            enableHighAccuracy: true,
            timeout: 7000, 
            maximumAge: 0
        };

        // Opciones B: Baja Precisión (Redes) - Tiempo límite 10s
        const lowAccuracyOptions = {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 30000 // Acepta caché de hasta 30 seg
        };

        // 1. Primer Intento: GPS Preciso
        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log("Ubicación obtenida por GPS.");
                resolve(position);
            },
            (errorHigh) => {
                console.warn("Fallo GPS preciso (" + errorHigh.message + "). Intentando modo red...");

                // 2. Segundo Intento: Redes (Fallback)
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        console.log("Ubicación obtenida por Red.");
                        resolve(position);
                    },
                    (errorLow) => {
                        // Si ambos fallan, rechazamos
                        reject(new Error("No se pudo obtener ubicación. Enciende el GPS o dales permisos al navegador."));
                    },
                    lowAccuracyOptions
                );
            },
            highAccuracyOptions
        );
    });
}
function updateStatus(element, color, text) {
    const colorClasses = {
        'blue': 'text-blue-700 bg-blue-100 border-blue-200',
        'indigo': 'text-indigo-700 bg-indigo-100 border-indigo-200',
        'emerald': 'text-emerald-700 bg-emerald-100 border-emerald-200',
        'green': 'text-green-700 bg-green-100 border-green-200',
        'red': 'text-red-700 bg-red-100 border-red-200'
    };
    element.innerHTML = `<p class="${colorClasses[color] || 'text-gray-600'} border font-bold text-sm px-6 py-2 rounded-full shadow-sm transition-all animate-pulse">${text}</p>`;
}