// js/core/utils.js

import { db } from './firebase-config.js';
import { 
    collection, query, where, orderBy, getDocs, addDoc, 
    serverTimestamp, updateDoc, doc, increment, onSnapshot 
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const loadedScripts = new Map();
const currencyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
let unsubscribePeopleOfInterest = null;


/**
 * Carga un script dinámicamente agregándolo al body.
 * Devuelve una promesa resuelta una vez cargado.
 */
export function loadScript(url) {
    if (loadedScripts.has(url)) return loadedScripts.get(url);

    const promise = new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = url;
        script.defer = true;
        script.onload = () => {
            console.log(`Script cargado: ${url}`);
            resolve();
        };
        script.onerror = (err) => {
            console.error(`Error de script: ${url}`, err);
            loadedScripts.delete(url);
            reject(err);
        };
        document.body.appendChild(script);
    });

    loadedScripts.set(url, promise);
    return promise;
}

/**
 * Normaliza un string removiendo acentos y convirtiéndolo a minúsculas.
 */
export function normalizeString(str) {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Redimensiona una imagen usando canvas para optimizar su peso antes de subirla.
 */
export function resizeImage(file, maxWidth = 800) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                let width = img.width, height = img.height;
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Error al convertir canvas a Blob.'));
                    }
                }, 'image/jpeg', 0.85);
            };
            img.onerror = reject;
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Variables locales para estado de IA
let modelsLoaded = false;
let modelsPromise = null;
window.modelsLoaded = false;

/**
 * Carga los modelos de reconocimiento facial en caliente (bajo demanda).
 */
export async function loadFaceAPImodels() {
    if (window.modelsLoaded) return;
    if (modelsPromise) return modelsPromise;

    console.log("Cargando modelos de reconocimiento facial...");
    modelsPromise = (async () => {
        try {
            if (typeof faceapi === 'undefined') {
                console.log("Cargando face-api.min.js bajo demanda...");
                await loadScript("js/vendor/face-api.min.js");
            }
            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri('models'),
                faceapi.nets.faceLandmark68Net.loadFromUri('models'),
                faceapi.nets.faceRecognitionNet.loadFromUri('models')
            ]);
            console.log("Modelos cargados.");
            modelsLoaded = true;
            window.modelsLoaded = true;
        } catch (error) {
            console.error("Error cargando IA:", error);
            modelsPromise = null; // Permitir reintento
            throw error;
        }
    })();
    return modelsPromise;
}

/**
 * Genera el descriptor facial (huella facial) a partir de la URL de una foto.
 */
export async function generateProfileFaceDescriptor(imageUrl) {
    if (!window.modelsLoaded) {
        console.warn("Los modelos de IA aún no han cargado. Intentando cargarlos ahora...");
        await loadFaceAPImodels();
    }


    try {
        const img = await faceapi.fetchImage(imageUrl);
        const detection = await faceapi.detectSingleFace(img)
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (detection) {
            console.log("Descriptor de perfil (huella facial) generado y guardado.");
            return detection.descriptor;
        } else {
            console.warn("No se detectó un rostro en la foto de perfil. El reconocimiento facial se saltará.");
            return null;
        }
    } catch (error) {
        console.error("Error al generar el descriptor de perfil:", error);
        return null;
    }
}

/**
 * Convierte un timestamp a una representación de tiempo relativo legible.
 */
export function formatTimeAgo(timestamp) {
    const now = Date.now();
    const seconds = Math.floor((now - Number(timestamp)) / 1000);

    if (isNaN(seconds) || seconds < 0) {
        return "justo ahora";
    }

    let interval = seconds / 31536000; // Años
    if (interval > 1) return `hace ${Math.floor(interval)}a`;
    interval = seconds / 2592000; // Meses
    if (interval > 1) return `hace ${Math.floor(interval)}m`;
    interval = seconds / 86400; // Días
    if (interval > 1) return `hace ${Math.floor(interval)}d`;
    interval = seconds / 3600; // Horas
    if (interval > 1) return `hace ${Math.floor(interval)}h`;
    interval = seconds / 60; // Minutos
    if (interval > 1) return `hace ${Math.floor(interval)} min`;

    return "justo ahora";
}

let cachedMunicipalities = []; // Guardar municipios en caché local de módulo

/**
 * Consume la API pública de Colombia para obtener los municipios ordenados.
 */
export async function fetchMunicipalities() {
    if (cachedMunicipalities.length > 0) {
        return cachedMunicipalities;
    }

    try {
        const response = await fetch('https://api-colombia.com/api/v1/City');
        if (!response.ok) {
            throw new Error(`Error de red: ${response.statusText}`);
        }
        const cities = await response.json();
        cachedMunicipalities = cities.map(city => city.name).sort();
        return cachedMunicipalities;
    } catch (error) {
        console.error("Error al obtener los municipios:", error);
        return [];
    }
}


// --- EXTRACTION FROM APP.JS (OLA 6 MODULARIZATION) ---

export function timeAgoFormat(date) {
    // 1. Manejo de 'null' (Latencia de serverTimestamp)
    // Si es null, significa que se acaba de crear y Firebase aún no devuelve la hora.
    if (!date) return "Ahora mismo";

    // 2. Si es Timestamp de Firestore, convertir a Date JS
    if (typeof date.toDate === 'function') {
        date = date.toDate();
    }

    // 3. Validación final: Si no es fecha válida, retornar string vacío (sin error)
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return "Hace un momento";
    }

    const now = new Date();
    const seconds = Math.round((now - date) / 1000);

    const minute = 60;
    const hour = minute * 60;
    const day = hour * 24;
    const week = day * 7;
    const month = day * 30;
    const year = day * 365;

    if (seconds < 30) {
        return "Ahora mismo";
    } else if (seconds < minute) {
        return `Hace ${seconds} segundos`;
    } else if (seconds < hour) {
        const minutes = Math.floor(seconds / minute);
        return `Hace ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    } else if (seconds < day) {
        const hours = Math.floor(seconds / hour);
        return `Hace ${hours} hora${hours > 1 ? 's' : ''}`;
    } else if (seconds < week) {
        const days = Math.floor(seconds / day);
        return `Hace ${days} día${days > 1 ? 's' : ''}`;
    } else if (seconds < month) {
        const weeks = Math.floor(seconds / week);
        return `Hace ${weeks} semana${weeks > 1 ? 's' : ''}`;

    } else if (seconds < year) {
        const months = Math.floor(seconds / month);
        return `Hace ${months} mes${months > 1 ? 'es' : ''}`;
    } else {
        const years = Math.floor(seconds / year);
        return `Hace ${years} año${years > 1 ? 's' : ''}`;
    }
}

export function numeroALetras(num) {
    const unidades = ['', 'UN ', 'DOS ', 'TRES ', 'CUATRO ', 'CINCO ', 'SEIS ', 'SIETE ', 'OCHO ', 'NUEVE '];
    const decenas = ['DIEZ ', 'ONCE ', 'DOCE ', 'TRECE ', 'CATORCE ', 'QUINCE ', 'DIECISEIS ', 'DIECISIETE ', 'DIECIOCHO ', 'DIECINUEVE ', 'VEINTE ', 'TREINTA ', 'CUARENTA ', 'CINCUENTA ', 'SESENTA ', 'SETENTA ', 'OCHENTA ', 'NOVENTA '];
    const centenas = ['', 'CIENTO ', 'DOSCIENTOS ', 'TRESCIENTOS ', 'CUATROCIENTOS ', 'QUINIENTOS ', 'SEISCIENTOS ', 'SETECIENTOS ', 'OCHOCIENTOS ', 'NOVECIENTOS '];

    if (num === 0) return 'CERO';

    if (num < 10) return unidades[num];
    if (num < 20) return decenas[num - 10];
    if (num < 30) return 'VEINTI' + unidades[num - 20];
    if (num < 100) {
        const d = Math.floor(num / 10);
        const u = num % 10;
        return decenas[d + 8] + (u > 0 ? 'Y ' + unidades[u] : '');
    }

    // Para simplificar, manejamos millones y miles de forma básica para salarios
    if (num >= 1000000) {
        const millones = Math.floor(num / 1000000);
        const resto = num % 1000000;
        const strMillones = millones === 1 ? 'UN MILLON ' : numeroALetras(millones) + ' MILLONES ';
        return strMillones + (resto > 0 ? numeroALetras(resto) : '');
    }

    if (num >= 1000) {
        const miles = Math.floor(num / 1000);
        const resto = num % 1000;
        const strMiles = miles === 1 ? 'MIL ' : numeroALetras(miles) + ' MIL ';
        return strMiles + (resto > 0 ? numeroALetras(resto) : '');
    }

    if (num >= 100) {
        if (num === 100) return 'CIEN ';
        const c = Math.floor(num / 100);
        const resto = num % 100;
        return centenas[c] + (resto > 0 ? numeroALetras(resto) : '');
    }

    return '';
}

export async function registerSupplierPayment(supplierId, amount, method, date, note) {
    // 1. Buscar órdenes pendientes de este proveedor (Ordenadas por fecha: más viejas primero)
    const q = query(
        collection(db, "purchaseOrders"),
        where("supplierId", "==", supplierId),
        orderBy("createdAt", "asc")
    );

    const snapshot = await getDocs(q);

    let remainingMoney = amount;
    let billsPaidCount = 0;

    // 2. Recorrer y pagar deudas
    for (const docSnap of snapshot.docs) {
        if (remainingMoney <= 0) break;

        const po = docSnap.data();
        const total = po.totalCost || 0;
        const paid = po.paidAmount || 0;
        const debt = total - paid;

        if (debt <= 100) continue; // Si la deuda es despreciable (por redondeo), saltar

        const paymentForThisBill = Math.min(remainingMoney, debt);

        // A. Guardar el pago dentro de la orden
        try {
            await addDoc(collection(db, "purchaseOrders", docSnap.id, "payments"), {
                amount: paymentForThisBill,
                date: date,
                paymentMethod: method,
                note: `${note} (Automático)`,
                createdAt: serverTimestamp(),
                createdBy: window.currentUser ? window.currentUser.uid : 'system'
            });
        } catch (e) {
            console.error("Error registrando pago en subcolección de PO:", e);
        }

        // B. Actualizar saldo y estado de la orden
        const newStatus = (Math.abs(debt - paymentForThisBill) < 100) ? 'recibida' : 'pendiente';

        try {
            await updateDoc(doc(db, "purchaseOrders", docSnap.id), {
                paidAmount: increment(paymentForThisBill),
                status: newStatus
            });
        } catch (e) {
            console.error("Error actualizando saldo de PO:", e);
        }

        remainingMoney -= paymentForThisBill;
        billsPaidCount++;
    }

    // 3. Guardar en el historial general del proveedor
    try {
        await addDoc(collection(db, "suppliers", supplierId, "payments"), {
            amount: amount,
            paymentMethod: method,
            note: note,
            date: date,
            createdAt: serverTimestamp(),
            distributedTo: billsPaidCount
        });
    } catch (e) {
        console.error("Error registrando pago en subcolección de proveedores:", e);
    }

    return billsPaidCount;
}

export function setupCurrencyInput(inputElement) {
    if (!inputElement) return;

    // Función que se ejecuta cada vez que el usuario escribe
    const formatValue = () => {
        // 1. Limpia el valor actual de cualquier caracter que no sea un número
        let value = inputElement.value.replace(/[$. ]/g, '');

        // 2. Si es un número válido, lo formatea
        if (!isNaN(value) && value) {
            // Usamos el formateador y reemplazamos espacios raros para consistencia
            inputElement.value = currencyFormatter.format(value).replace(/\s/g, ' ');
        } else {
            // Si no es un número, limpia el campo
            inputElement.value = '';
        }
    };

    // 3. Asigna la función al evento 'input'
    inputElement.addEventListener('input', formatValue);

    // 4. Formatea el valor inicial que pueda tener el campo
    if (inputElement.value) {
        formatValue();
    }
}


// --- RECOVERY OF MISSING FUNCTIONS (OLA 6) ---

export function loadPeopleOfInterest(projectId) {
    const listContainer = document.getElementById('interest-people-list');
    if (!listContainer) return;

    const q = query(collection(db, "projects", projectId, "peopleOfInterest"));
    if (unsubscribePeopleOfInterest) unsubscribePeopleOfInterest();

    unsubscribePeopleOfInterest = onSnapshot(q, (snapshot) => {
        listContainer.innerHTML = ''; // Limpia la lista
        if (snapshot.empty) {
            listContainer.innerHTML = '<p class="text-gray-500 text-sm">No se han añadido personas de interés.</p>';
            return;
        }

        snapshot.forEach(doc => {
            const person = { id: doc.id, ...doc.data() };
            const personCard = document.createElement('div');
            personCard.className = 'p-3 border rounded-lg bg-gray-50 flex justify-between items-start';

            personCard.innerHTML = `
                <div class="flex-grow">
                    <p class="font-bold text-gray-800">${person.name}</p>
                    <p class="text-sm text-gray-600">${person.position || 'Sin cargo'}</p>
                    <div class="mt-2 text-xs">
                        <p><strong>Correo:</strong> <a href="mailto:${person.email}" class="text-blue-600">${person.email || 'N/A'}</a></p>
                        <p><strong>Teléfono:</strong> <a href="tel:${person.phone}" class="text-blue-600">${person.phone || 'N/A'}</a></p>
                    </div>
                </div>
                <button data-action="delete-interest-person" data-id="${person.id}" class="text-red-500 hover:text-red-700 font-semibold text-sm ml-4">
                    Eliminar
                </button>
            `;
            listContainer.appendChild(personCard);
        });
    });
}

export function initThemeToggle() {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const darkIcon = document.getElementById('theme-toggle-dark-icon');
    const lightIcon = document.getElementById('theme-toggle-light-icon');

    if (!themeToggleBtn) return;

    // 1. Verificar preferencia guardada o del sistema
    if (localStorage.getItem('color-theme') === 'dark' ||
        (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
        lightIcon.classList.remove('hidden');
    } else {
        document.documentElement.classList.remove('dark');
        darkIcon.classList.remove('hidden');
    }

    // 2. Evento Click
    themeToggleBtn.addEventListener('click', function () {
        // Alternar iconos
        darkIcon.classList.toggle('hidden');
        lightIcon.classList.toggle('hidden');

        // Alternar clase en HTML
        if (document.documentElement.classList.contains('dark')) {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('color-theme', 'light');
        } else {
            document.documentElement.classList.add('dark');
            localStorage.setItem('color-theme', 'dark');
        }
    });
}
