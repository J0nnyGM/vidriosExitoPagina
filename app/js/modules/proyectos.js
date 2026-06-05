// js/proyectos.js
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { httpsCallable } from "../core/firebase-config.js";

// Variables de estado interno del módulo
let unsubscribeProjects = null;

// Referencias a dependencias externas que inyectaremos desde app.js
let db, functions, getCurrentUser, getCurrentUserRole;

/**
 * Inicializa el módulo de proyectos inyectando las dependencias necesarias.
 */
export function initProyectos(firestoreDb, firebaseFunctions, userGetter, roleGetter) {
    db = firestoreDb;
    functions = firebaseFunctions;
    getCurrentUser = userGetter;
    getCurrentUserRole = roleGetter;
}

/**
 * Carga y renderiza la lista de proyectos según su estado.
 */
export function loadProjects(status = 'active') {
    const projectsContainer = document.getElementById('projects-container');
    if (!projectsContainer) return;

    projectsContainer.innerHTML = `<div class="col-span-full flex justify-center py-12"><div class="loader"></div></div>`;

    // Actualización visual de pestañas
    const activeTab = document.getElementById('active-projects-tab');
    const archivedTab = document.getElementById('archived-projects-tab');

    const selectedClasses = ['bg-white', 'text-indigo-600', 'shadow-sm'];
    const unselectedClasses = ['text-gray-500', 'hover:text-gray-700', 'bg-transparent', 'shadow-none'];
    const baseClass = "flex-1 sm:flex-none px-4 py-1.5 text-xs font-bold rounded-md transition-all duration-200";
    
    if(activeTab && archivedTab) {
        activeTab.className = baseClass;
        archivedTab.className = baseClass;
        if (status === 'active') {
            activeTab.classList.add(...selectedClasses);
            archivedTab.classList.add(...unselectedClasses);
        } else {
            archivedTab.classList.add(...selectedClasses);
            activeTab.classList.add(...unselectedClasses);
        }
    }

    const q = query(collection(db, "projects"), where("status", "==", status));
    
    if (unsubscribeProjects) unsubscribeProjects();

    unsubscribeProjects = onSnapshot(q, (querySnapshot) => {
        projectsContainer.innerHTML = '';

        if (querySnapshot.empty) {
            projectsContainer.innerHTML = `
                <div class="col-span-full flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                    <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-400">
                        <i class="fa-regular fa-folder-open text-3xl"></i>
                    </div>
                    <h3 class="text-lg font-bold text-gray-700">No hay proyectos ${status === 'active' ? 'activos' : 'archivados'}</h3>
                    <p class="text-sm text-gray-500 mt-1">Comienza creando uno nuevo o cambia el filtro.</p>
                </div>`;
            return;
        }

        querySnapshot.forEach(doc => {
            const projectData = { id: doc.id, ...doc.data() };
            const stats = projectData.progressSummary || { totalM2: 0, executedM2: 0, totalItems: 0, executedItems: 0, executedValue: 0 };
            const progress = stats.totalM2 > 0 ? (stats.executedM2 / stats.totalM2) * 100 : 0;

            const card = createProjectCard(projectData, progress, stats);
            projectsContainer.appendChild(card);
        });

    }, (error) => {
        console.error("Error cargando proyectos: ", error);
        projectsContainer.innerHTML = '<p class="text-red-500 text-center col-span-full">Error al cargar los proyectos.</p>';
    });
}

/**
 * Crea el HTML de la tarjeta de un proyecto.
 */
function createProjectCard(project, progress, stats) {
    const card = document.createElement('div');
    card.className = "bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-lg hover:border-indigo-300 transition-all duration-300 project-card group flex flex-col h-full overflow-hidden";
    card.dataset.id = project.id;
    card.dataset.name = project.name;

    const currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
    });

    const physicalProgress = Math.min(progress, 100);
    let physicalColor = physicalProgress >= 100 ? 'bg-emerald-500' : (physicalProgress > 0 ? 'bg-blue-600' : 'bg-slate-300');

    const contractValue = project.value || 1;
    const executedValue = stats.executedValue || 0;
    const financialPercent = Math.min((executedValue / contractValue) * 100, 100);
    let financialColor = 'bg-indigo-600';
    if (financialPercent >= 100) financialColor = 'bg-emerald-500';

    const formatDate = (dateStr) => dateStr ? new Date(dateStr + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' }) : '--';

    let actionButtons = '';
    const btnClass = "p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors border border-transparent hover:border-slate-200";

    if (project.status === 'active') {
        actionButtons = `
            <button data-action="edit-project-info" class="${btnClass}" title="Editar Info">
                <i class="fa-solid fa-pen"></i>
            </button>
            <button data-action="archive" class="${btnClass}" title="Archivar">
                <i class="fa-solid fa-box-archive"></i>
            </button>
        `;
    } else if (project.status === 'archived') {
        actionButtons = `
            <button data-action="restore" class="${btnClass} text-emerald-600 hover:bg-emerald-50" title="Restaurar">
                <i class="fa-solid fa-trash-arrow-up"></i>
            </button>
            ${getCurrentUserRole() === 'admin' ? `
                <button data-action="delete" class="${btnClass} text-red-500 hover:bg-red-50" title="Eliminar">
                    <i class="fa-solid fa-trash"></i>
                </button>` : ''}
        `;
    }

    card.innerHTML = `
        <div class="p-5 pb-2 flex-grow">
            <div class="flex justify-between items-start gap-3 mb-4">
                <div class="flex gap-3 items-center overflow-hidden">
                    <div class="w-12 h-12 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl border border-indigo-100 flex-shrink-0">
                        <i class="fa-regular fa-building"></i>
                    </div>
                    <div class="min-w-0">
                        <h2 class="text-lg font-bold text-slate-800 truncate leading-tight" title="${project.name}">${project.name}</h2>
                        <p class="text-xs text-slate-500 truncate flex items-center gap-1 mt-1">
                             <i class="fa-solid fa-hard-hat text-slate-400"></i> ${project.builderName || 'Sin Constructora'}
                        </p>
                    </div>
                </div>
                <button data-action="view-details" class="text-slate-300 hover:text-indigo-600 transition-colors p-1 transform hover:scale-110" title="Ir al Proyecto">
                    <i class="fa-solid fa-arrow-right-to-bracket text-xl"></i>
                </button>
            </div>
            
            <div class="mb-4">
                <p class="text-xs text-slate-400 uppercase font-bold mb-1">Ubicación</p>
                <div class="flex items-start gap-2 text-xs text-slate-600">
                    <i class="fa-solid fa-location-dot text-indigo-400 mt-0.5"></i>
                    <span class="truncate-2-lines leading-snug" title="${project.address || ''}">
                        <span class="font-semibold text-slate-700">${project.location}</span>
                        ${project.address ? `<br><span class="text-slate-500">${project.address}</span>` : ''}
                    </span>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-2 mb-4 border-t border-b border-slate-50 py-2">
                <div>
                    <p class="text-[10px] text-slate-400 uppercase font-bold">Inicio</p>
                    <p class="text-xs font-medium text-slate-700"><i class="fa-regular fa-calendar text-slate-400 mr-1"></i> ${formatDate(project.startDate)}</p>
                </div>
                <div>
                    <p class="text-[10px] text-slate-400 uppercase font-bold">Fin</p>
                    <p class="text-xs font-medium text-slate-700"><i class="fa-regular fa-flag text-slate-400 mr-1"></i> ${formatDate(project.endDate)}</p>
                </div>
            </div>

            <div class="bg-slate-50 rounded-lg p-3 border border-slate-100 mb-4 space-y-1.5">
                <div class="flex justify-between items-center">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Contrato</span>
                    <span class="text-xs font-bold text-slate-700">${currencyFormatter.format(project.value || 0)}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-[10px] font-bold text-emerald-600 uppercase tracking-wide">Ejecutado</span>
                    <span class="text-sm font-black text-emerald-600">${currencyFormatter.format(stats.executedValue || 0)}</span>
                </div>
                <div class="w-full bg-slate-200 rounded-full h-1.5 mt-1">
                    <div class="${financialColor} h-1.5 rounded-full transition-all duration-1000" style="width: ${financialPercent}%"></div>
                </div>
            </div>

            <div>
                <div class="flex justify-between items-end mb-1">
                    <span class="text-xs font-semibold text-slate-600">Avance Físico</span>
                    <span class="text-xs font-bold text-blue-600">${physicalProgress.toFixed(1)}%</span>
                </div>
                <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div class="${physicalColor} h-1.5 rounded-full transition-all duration-1000" style="width: ${physicalProgress}%"></div>
                </div>
            </div>
        </div>

        <div class="px-4 py-3 bg-slate-50 border-t border-slate-100 mt-auto flex justify-between items-center">
             <div class="text-xs text-slate-500 font-bold flex items-center gap-1.5">
                <i class="fa-solid fa-layer-group text-indigo-400"></i> 
                <span>${stats.executedItems}/${stats.totalItems} Ítems</span>
             </div>
             <div class="flex gap-1">
                ${actionButtons}
             </div>
        </div>
    `;
    return card;
}

export async function createProject(projectData) {
    const user = getCurrentUser();
    await addDoc(collection(db, "projects"), {
        ...projectData,
        ownerId: user.uid,
        createdAt: new Date()
    });
}

export async function deleteProject(projectId) {
    try {
        const deleteProjectFunction = httpsCallable(functions, 'deleteArchivedProject');
        await deleteProjectFunction({ projectId: projectId });
    } catch (error) {
        console.error("Error al eliminar el proyecto:", error);
        throw error;
    }
}

export async function archiveProject(projectId) {
    await updateDoc(doc(db, "projects", projectId), { status: 'archived' });
}

export async function restoreProject(projectId) {
    await updateDoc(doc(db, "projects", projectId), { status: 'active' });
}