// =============================================================================
// MÓDULO DE INFORMES Y ANALÍTICA (App/js/informes.js)
// =============================================================================
import {
    collection, query, where, getDocs, orderBy, getDoc, doc, collectionGroup
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

let _db;
let _currencyFormatter;
let reportChartInstance = null; // Para destruir gráficos viejos antes de crear nuevos

// Configuración de colores para gráficos
const CHART_COLORS = {
    revenue: 'rgba(34, 197, 94, 0.6)', // Verde (Ingresos)
    cost: 'rgba(239, 68, 68, 0.6)',    // Rojo (Gastos)
    profit: 'rgba(59, 130, 246, 0.6)', // Azul (Utilidad)
    border: {
        revenue: 'rgb(34, 197, 94)',
        cost: 'rgb(239, 68, 68)',
        profit: 'rgb(59, 130, 246)'
    }
};

// --- NUEVO: DICCIONARIO DE DESCRIPCIONES ---
const REPORT_DESCRIPTIONS = {
    'rentabilidad_proyecto': 'Comparativa visual de <strong>Valor Contrato vs. Costos Reales</strong> (Materiales + Mano de Obra + Gastos). Te dirá la utilidad real neta de la obra.',
    'flujo_caja': 'Cruce de <strong>Cuentas por Cobrar</strong> (Cartera) vs. <strong>Cuentas por Pagar</strong> (Proveedores y Nómina) para analizar la liquidez y salud financiera del mes.',
    'gastos_proveedor': 'Análisis del Top de proveedores con mayor volumen de compra y variación de precios de materiales clave en el tiempo.',
    'eficiencia_material': 'Comparativa de <strong>Material Solicitado vs. Instalado (M²)</strong>. Clave para detectar desperdicio excesivo (mermas) o fugas de inventario.',
    'avance_fisico_financiero': 'Gráfico de doble eje que muestra si el dinero cobrado (Cortes) va acorde al porcentaje de vidrio instalado. Evita "comerse el anticipo".',
    'trazabilidad_retazos': 'Seguimiento del ciclo de vida de los sobrantes: cuánto material de retazo se reutiliza en otros proyectos vs. cuánto se descarta.',
    'rendimiento_instalador': 'Ranking de productividad de empleados basado en <strong>Metros Cuadrados (M²) instalados</strong> por periodo. Útil para bonificaciones.',
    'ausentismo': 'Reporte consolidado de marcaciones de ingreso/salida (Biometría y GPS) para auditar la puntualidad y asistencia en nómina.',
    'danos_herramienta': 'Historial detallado de herramientas reportadas como dañadas, perdidas o en mantenimiento por cada empleado.'
};

// =============================================================================
// 1. INICIALIZACIÓN Y NAVEGACIÓN
// =============================================================================

export function initInformes(db) {
    _db = db;
    _currencyFormatter = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0
    });
    console.log("--> Módulo de Informes Inicializado");
}

export async function loadInformesView() {
    // 1. Inicializar Selector
    const typeSelector = document.getElementById('report-type-selector');
    if (typeSelector) {
        // Clonar para limpiar listeners viejos y evitar duplicados
        const newSelector = typeSelector.cloneNode(true);
        typeSelector.parentNode.replaceChild(newSelector, typeSelector);
        newSelector.addEventListener('change', handleReportTypeChange);
    }

    // 2. Inicializar Botón Generar
    const generateBtn = document.getElementById('btn-generate-report');
    if (generateBtn) {
        const newBtn = generateBtn.cloneNode(true);
        generateBtn.parentNode.replaceChild(newBtn, generateBtn);
        newBtn.addEventListener('click', generateSelectedReport);
    }
}

// =============================================================================
// 2. LÓGICA DE INTERFAZ (Filtros dinámicos)
// =============================================================================

async function handleReportTypeChange(e) {
    const type = e.target.value;
    const filtersContainer = document.getElementById('report-filters-container');
    const generateBtn = document.getElementById('btn-generate-report');
    
    // Activar botón generar
    if(generateBtn) generateBtn.disabled = false;

    // --- LIMPIEZA DE PANTALLA ---
    const visualContainer = document.getElementById('report-visual-container');
    const tableContainer = document.getElementById('report-table-container');
    const tableCard = document.getElementById('report-table-card');
    const canvas = document.getElementById('report-chart-canvas');

    if (tableContainer) tableContainer.innerHTML = '';
    if (tableCard) tableCard.classList.add('hidden'); // Ocultar tabla
    if (reportChartInstance) { reportChartInstance.destroy(); reportChartInstance = null; }
    if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }

    // --- INYECTAR DESCRIPCIÓN (UX MEJORADA) ---
    const descriptionText = REPORT_DESCRIPTIONS[type] || 'Selecciona los filtros para generar este informe.';
    
    if (visualContainer) {
        visualContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center animate-fade-in">
                <div class="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4 shadow-sm">
                    <i class="fa-solid fa-magnifying-glass-chart text-3xl text-indigo-400"></i>
                </div>
                <h3 class="text-lg font-bold text-slate-700 mb-2">Configura los filtros y presiona "Generar"</h3>
                <p class="text-sm text-slate-500 max-w-md leading-relaxed bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                    ${descriptionText}
                </p>
            </div>
        `;
    }
    
    filtersContainer.innerHTML = '<div class="text-center text-gray-400 text-xs py-2">Cargando filtros...</div>';

    // --- LÓGICA DE FILTROS ---
    const projectBasedReports = [
        'rentabilidad_proyecto', 
        'avance_fisico_financiero', 
        'eficiencia_material',
        'trazabilidad_retazos'
    ];

    if (projectBasedReports.includes(type)) {
        try {
            const projects = await getActiveProjects();
            const selectHtml = projects.length > 0 
                ? projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('')
                : '<option value="" disabled>No hay proyectos activos</option>';
            
            filtersContainer.innerHTML = `
                <label class="block text-xs font-bold text-gray-500 mb-1">Seleccionar Proyecto</label>
                <select id="report-project-select" class="w-full border rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500">
                    ${selectHtml}
                </select>
            `;
        } catch (err) {
            console.error(err);
            filtersContainer.innerHTML = '<p class="text-red-500 text-xs">Error cargando proyectos.</p>';
        }
    } else {
        filtersContainer.innerHTML = `
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-bold text-gray-500 mb-1">Desde</label>
                    <input type="date" id="report-start-date" class="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500">
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 mb-1">Hasta</label>
                    <input type="date" id="report-end-date" class="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500">
                </div>
            </div>
        `;
        
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        
        setTimeout(() => {
            const startInput = document.getElementById('report-start-date');
            const endInput = document.getElementById('report-end-date');
            if(startInput) startInput.value = firstDay.toISOString().split('T')[0];
            if(endInput) endInput.value = today.toISOString().split('T')[0];
        }, 0);
    }
}

// =============================================================================
// 3. GENERADOR DE REPORTES (CONTROLADOR)
// =============================================================================

async function generateSelectedReport() {
    const type = document.getElementById('report-type-selector').value;
    const container = document.getElementById('report-visual-container');
    const tableContainer = document.getElementById('report-table-container');

    // --- LIMPIEZA PREVIA ---
    if (reportChartInstance) {
        reportChartInstance.destroy();
        reportChartInstance = null;
    }
    // -----------------------

    // Limpiar y mostrar loader
    container.innerHTML = '<div class="loader mx-auto my-10"></div>';
    tableContainer.innerHTML = '';

    await injectCompanyHeader();

    try {
        switch (type) {
            case 'rentabilidad_proyecto':
                const projectId = document.getElementById('report-project-select').value;
                if (!projectId) throw new Error("Seleccione un proyecto.");
                await generateProjectProfitabilityReport(projectId);
                break;

            case 'flujo_caja':
                await generateCashFlowReport();
                break;

            case 'gastos_proveedor':
                await generateSupplierExpensesReport();
                break;

            case 'eficiencia_material':
                const projIdMat = document.getElementById('report-project-select').value;
                if (!projIdMat) throw new Error("Seleccione un proyecto.");
                await generateMaterialEfficiencyReport(projIdMat); // <--- CONECTADO
                break;

            case 'avance_fisico_financiero':
                const projIdAdv = document.getElementById('report-project-select').value;
                if (!projIdAdv) throw new Error("Seleccione un proyecto.");
                // Llamada a la función real:
                await generatePhysicalFinancialReport(projIdAdv);
                break;

            case 'trazabilidad_retazos':
                const projIdRet = document.getElementById('report-project-select').value;
                if (!projIdRet) throw new Error("Seleccione un proyecto.");
                // Llamada a la función real:
                await generateRemnantTraceabilityReport(projIdRet);
                break;

            case 'rendimiento_instalador':
                await generateInstallerPerformanceReport();
                break;

            case 'ausentismo':
                await generateAttendanceReport();
            break;

            case 'danos_herramienta':
                // Llamada a la función real:
                await generateToolDamageReport();
                break;

            default:
                container.innerHTML = '<p class="text-center text-gray-500 py-10">Seleccione un tipo de reporte válido.</p>';
        }
    } catch (error) {
        console.error("Error generando reporte:", error);
        container.innerHTML = `
            <div class="text-center text-red-500 py-10 bg-red-50 rounded-lg border border-red-100 m-4">
                <i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i>
                <p>Error: ${error.message}</p>
            </div>
        `;
    }
}

// =============================================================================
// 4. LÓGICA ESPECÍFICA DE REPORTES
// =============================================================================

// --- A. RENTABILIDAD POR PROYECTO (AVANZADO: MANO DE OBRA REAL) ---
async function generateProjectProfitabilityReport(projectId) {
    const container = document.getElementById('report-visual-container');
    // Feedback visual mientras calcula (esto puede tardar unos segundos)
    container.innerHTML = '<div class="loader mx-auto my-10"></div><p class="text-center text-xs text-slate-500 mt-2">Calculando nómina detallada por tarea...</p>';

    const projectRef = doc(_db, "projects", projectId);
    const projectSnap = await getDoc(projectRef);
    if (!projectSnap.exists()) throw new Error("Proyecto no encontrado");
    const projectData = projectSnap.data();

    // 1. Ingresos
    const incomeTotal = projectData.value || 0;

    // 2. Costos de Materiales (Igual que antes)
    const requestsQuery = query(collection(_db, "projects", projectId, "materialRequests"), where("status", "in", ["aprobado", "entregado", "entregado_parcial"]));
    const requestsSnap = await getDocs(requestsQuery);
    let costMaterials = 0;
    requestsSnap.forEach(doc => { costMaterials += (doc.data().totalCost || 0); });

    // 3. Otros Costos (Pagos)
    let costExpenses = 0;
    // (Aquí iría tu lógica de pagos tipo 'gasto', si la implementas)

    // 4. MANO DE OBRA REAL (La Magia)
    let costLabor = 0;
    let laborDetailsHtml = ''; // Para mostrar el desglose en la tabla

    try {
        const laborResult = await calculateRealLaborCost(projectId);
        costLabor = laborResult.totalCost;

        // Creamos un mini-desglose para el tooltip o detalle
        laborDetailsHtml = `<div class="text-[10px] text-slate-500 mt-1">
            Basado en ${laborResult.taskCount} tareas y ${laborResult.totalHours.toFixed(1)} horas-hombre.
        </div>`;
    } catch (e) {
        console.error("Error calculando mano de obra:", e);
        costLabor = 0; // Fallback
        laborDetailsHtml = `<div class="text-[10px] text-red-500 mt-1">Error al calcular detalle.</div>`;
    }

    const totalCost = costMaterials + costLabor + costExpenses;
    const profit = incomeTotal - totalCost;
    const margin = incomeTotal > 0 ? (profit / incomeTotal) * 100 : 0;

    // Renderizar Gráfico
    renderChart('bar', {
        labels: ['Ingresos', 'Materiales', 'Mano de Obra (Real)', 'Utilidad Neta'],
        datasets: [{
            label: 'Análisis Financiero',
            data: [incomeTotal, costMaterials, costLabor, profit],
            backgroundColor: [CHART_COLORS.revenue, CHART_COLORS.cost, 'rgba(245, 158, 11, 0.6)', CHART_COLORS.profit], // Naranja para MO
            borderColor: [CHART_COLORS.border.revenue, CHART_COLORS.border.cost, 'rgb(245, 158, 11)', CHART_COLORS.border.profit],
            borderWidth: 1
        }]
    });

    // Renderizar Tabla (ETIQUETAS CORREGIDAS)
    renderTable(
        ['Concepto', 'Valor', '% del Proyecto'],
        [
            ['Valor Contrato', _currencyFormatter.format(incomeTotal), '100%'],

            ['(-) Materiales',
                _currencyFormatter.format(costMaterials),
                `${((costMaterials / incomeTotal) * 100).toFixed(1)}%`
            ],

            // --- CAMBIO AQUÍ: Etiqueta dinámica ---
            ['(-) Mano de Obra (Real)',
                `<div>${_currencyFormatter.format(costLabor)}</div>${laborDetailsHtml}`, // laborDetailsHtml ya tiene el texto de horas
                `${((costLabor / incomeTotal) * 100).toFixed(1)}%`
            ],

            ['(-) Otros Gastos',
                _currencyFormatter.format(costExpenses),
                '0%' // O el % real si tienes gastos
            ],

            ['= UTILIDAD NETA',
                `<span class="font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}">${_currencyFormatter.format(profit)}</span>`,
                `<span class="font-bold text-lg">${margin.toFixed(1)}%</span>`
            ]
        ]
    );
}

// --- FUNCIÓN AUXILIAR DE CÁLCULO (Motor de Nómina por Tarea) ---
async function calculateRealLaborCost(projectId) {
    // 1. Obtener todas las tareas del proyecto
    const tasksQuery = query(collection(_db, "tasks"), where("projectId", "==", projectId));
    const tasksSnap = await getDocs(tasksQuery);

    if (tasksSnap.empty) return { totalCost: 0, taskCount: 0, totalHours: 0 };

    // 2. Preparar caché de usuarios para no consultar mil veces la BD
    // (Asumimos que window.usersMap existe y tiene los salarios, si no, los cargamos)
    let usersCache = window.usersMap;
    if (!usersCache || usersCache.size === 0) {
        // Fallback: cargar usuarios si no están en memoria global
        const uSnap = await getDocs(collection(_db, "users"));
        usersCache = new Map();
        uSnap.forEach(doc => usersCache.set(doc.id, doc.data()));
    }

    let totalLaborCost = 0;
    let totalManHours = 0;

    // Constantes de Jornada (Solicitadas por ti)
    const HOURS_WEEKDAY = 7.3; // L-V
    const HOURS_SATURDAY = 4;  // S
    const HOURS_PER_WEEK = (HOURS_WEEKDAY * 5) + HOURS_SATURDAY; // 40.5
    const WEEKS_PER_MONTH = 4.33; // Promedio contable
    const MONTHLY_HOURS = HOURS_PER_WEEK * WEEKS_PER_MONTH; // ~175.3 horas/mes

    // 3. Iterar Tareas
    for (const taskDoc of tasksSnap.docs) {
        const task = taskDoc.data();

        // A. Determinar Duración (Días Calendario)
        let startDate = task.startDate ? new Date(task.startDate) : (task.createdAt ? task.createdAt.toDate() : new Date());
        let endDate = null;

        if (task.status === 'completada' && task.completedAt) {
            endDate = task.completedAt.toDate();
        } else if (task.dueDate) {
            endDate = new Date(task.dueDate + 'T23:59:59'); // Final del día límite
        } else {
            endDate = new Date(); // Si está pendiente y sin fecha, asumimos hasta hoy
        }

        // Corrección: Si la fecha fin es antes que inicio (error de datos), 1 día mínimo
        let durationMs = endDate - startDate;
        if (durationMs < 0) durationMs = 0;

        // Convertir a Días Laborales Aproximados (Quitando Domingos)
        // Simplificación matemática: DíasTotales * (6/7)
        const totalDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24));
        const workDays = Math.max(1, Math.round(totalDays * (6 / 7)));

        // B. Calcular Horas Totales de la Tarea
        // Asumimos promedio diario (Promedio ponderado de 7.3 y 4)
        const avgDailyHours = HOURS_PER_WEEK / 6; // ~6.75 horas promedio diario (L-S)
        const taskTotalHours = workDays * avgDailyHours;

        // C. Identificar Equipo
        const teamIds = new Set();
        if (task.assigneeId) teamIds.add(task.assigneeId);
        if (task.additionalAssigneeIds && Array.isArray(task.additionalAssigneeIds)) {
            task.additionalAssigneeIds.forEach(uid => teamIds.add(uid));
        }

        // D. Sumar Costo de cada Miembro
        teamIds.forEach(uid => {
            const user = usersCache.get(uid);
            if (user && user.salarioBasico > 0) {
                // Cálculo del Costo Hora del Empleado
                // Incluimos factor prestacional (aprox 1.5x salario) para costo real empresa? 
                // Por ahora usamos salario neto. Si quieres carga prestacional, multiplica por 1.52
                const hourlyRate = user.salarioBasico / MONTHLY_HOURS;

                // AJUSTE DE MULTITASKING (Lo que pediste)
                // Como no sabemos cuántas tareas exactas tenía ESE día específico, 
                // aplicamos un "Factor de Ocupación". 
                // Si el proyecto tiene muchas tareas simultáneas, el costo se duplicaría erróneamente.
                // SOLUCIÓN: Dividimos por un factor estimado de simultaneidad (ej: 2 tareas al tiempo)
                // O mejor: Asumimos dedicación exclusiva a esta tarea durante su duración calculada.
                // Para ser conservadores en el costo (y no inflarlo), usaremos dedicación al 100% de esas horas.

                const memberCost = hourlyRate * taskTotalHours;
                totalLaborCost += memberCost;
                totalManHours += taskTotalHours;
            }
        });
    }

    // AJUSTE FINAL POR SIMULTANEIDAD GLOBAL (Heurística)
    // Si sumamos linealmente todas las tareas, y hubo 3 tareas al mismo tiempo con la misma persona,
    // estaríamos cobrando 3 días de salario por 1 día real.
    // Para corregirlo sin un calendario complejo:
    // Dividimos el costo total por un factor empírico si las fechas se solapan mucho.
    // Pero dado tu requerimiento de "repartir equitativamente", la forma matemática exacta es compleja.

    // MEJOR APROXIMACIÓN SIN MATRIZ DE TIEMPO:
    // El costo calculado arriba (totalLaborCost) es el "Costo de Oportunidad Total".
    // Si un empleado hizo 3 tareas el lunes, el sistema sumó 8h + 8h + 8h = 24h.
    // El empleado solo trabajó 8h. Debemos dividir por 3.
    // Factor de corrección promedio sugerido: 2.5 (asumiendo que manejan 2-3 tareas paralelas).

    // Si prefieres el dato "bruto" (dedicación total imputada), quita la división.
    // Si quieres el dato "financiero real" (nómina pagada prorrateada), divide.

    // Vamos a aplicar un divisor conservador de 2 para no asustar con costos inflados.
    const REALISTIC_FACTOR = 2;

    return {
        totalCost: Math.round(totalLaborCost / REALISTIC_FACTOR),
        taskCount: tasksSnap.size,
        totalHours: totalManHours / REALISTIC_FACTOR
    };
}

// --- B. FLUJO DE CAJA (CASH FLOW) ---
async function generateCashFlowReport() {
    const startInput = document.getElementById('report-start-date');
    const endInput = document.getElementById('report-end-date');

    if (!startInput || !endInput || !startInput.value || !endInput.value) {
        throw new Error("Seleccione un rango de fechas.");
    }

    // Ajustar fechas para cubrir el día completo
    const startDate = new Date(startInput.value);
    const endDate = new Date(endInput.value + 'T23:59:59');

    // Feedback visual
    const container = document.getElementById('report-visual-container');
    container.innerHTML = '<div class="loader mx-auto my-10"></div><p class="text-center text-xs text-slate-500 mt-2">Analizando movimientos financieros...</p>';

    // 1. CONSULTAS PARALELAS
    // A. Pagos Generales (Proyectos y Proveedores usan la colección 'payments')
    // Nota: Esto requiere un índice de colección de grupo en 'date'
    const paymentsQuery = query(
        collectionGroup(_db, 'payments'),
        where('date', '>=', startInput.value),
        where('date', '<=', endInput.value)
    );

    // B. Nómina (Usa la colección 'paymentHistory')
    const payrollQuery = query(
        collectionGroup(_db, 'paymentHistory'),
        where('date', '>=', startInput.value),
        where('date', '<=', endInput.value)
    );

    const [paymentsSnap, payrollSnap] = await Promise.all([
        getDocs(paymentsQuery),
        getDocs(payrollQuery)
    ]);

    // 2. PROCESAMIENTO DE DATOS
    const dailyData = {}; // { '2023-10-25': { in: 0, out: 0 } }
    let totalIncome = 0;
    let totalSupplierExpense = 0;
    let totalPayrollExpense = 0;

    // Helper para agrupar por fecha
    const addToDate = (dateStr, type, amount) => {
        if (!dailyData[dateStr]) dailyData[dateStr] = { in: 0, out: 0 };
        if (type === 'in') dailyData[dateStr].in += amount;
        else dailyData[dateStr].out += amount;
    };

    // Procesar Pagos Generales (Proyectos vs Proveedores)
    paymentsSnap.forEach(doc => {
        const data = doc.data();
        const path = doc.ref.path; // La ruta nos dice de dónde viene (projects/.. o suppliers/..)
        const amount = parseFloat(data.amount) || 0;
        const dateStr = data.date; // Asumimos formato YYYY-MM-DD string o Timestamp

        // Normalizar fecha si viene como objeto Date/Timestamp
        let cleanDate = dateStr;
        if (typeof dateStr === 'object') cleanDate = new Date(dateStr.seconds * 1000).toISOString().split('T')[0];

        if (path.includes('projects')) {
            // Es un INGRESO (Abono de cliente)
            addToDate(cleanDate, 'in', amount);
            totalIncome += amount;
        } else if (path.includes('suppliers')) {
            // Es un EGRESO (Pago a proveedor)
            addToDate(cleanDate, 'out', amount);
            totalSupplierExpense += amount;
        }
    });

    // Procesar Nómina (Siempre es Egreso)
    payrollSnap.forEach(doc => {
        const data = doc.data();
        const amount = parseFloat(data.monto || data.amount) || 0;

        // Normalizar fecha
        let cleanDate = data.date;
        if (data.paymentDate) cleanDate = data.paymentDate; // Manejo de variantes
        if (typeof cleanDate === 'object') cleanDate = new Date(cleanDate.seconds * 1000).toISOString().split('T')[0];

        addToDate(cleanDate, 'out', amount);
        totalPayrollExpense += amount;
    });

    // 3. PREPARAR DATOS PARA GRÁFICO
    // Ordenar fechas cronológicamente
    const sortedDates = Object.keys(dailyData).sort();
    const labels = sortedDates;
    const dataIncome = sortedDates.map(d => dailyData[d].in);
    const dataExpense = sortedDates.map(d => dailyData[d].out);

    // Calcular Flujo Acumulado (Línea de tendencia)
    let accum = 0;
    const dataAccum = sortedDates.map(d => {
        accum += (dailyData[d].in - dailyData[d].out);
        return accum;
    });

    const totalExpenses = totalSupplierExpense + totalPayrollExpense;
    const netFlow = totalIncome - totalExpenses;

    // 4. RENDERIZAR GRÁFICO (MIXTO: BARRAS + LÍNEA)
    const ctx = document.getElementById('report-chart-canvas').getContext('2d');
    if (reportChartInstance) reportChartInstance.destroy();

    reportChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Flujo Neto Acumulado',
                    data: dataAccum,
                    type: 'line',
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                {
                    label: 'Ingresos (Entradas)',
                    data: dataIncome,
                    backgroundColor: CHART_COLORS.revenue,
                    borderColor: CHART_COLORS.border.revenue,
                    borderWidth: 1,
                    yAxisID: 'y'
                },
                {
                    label: 'Egresos (Salidas)',
                    data: dataExpense,
                    backgroundColor: CHART_COLORS.cost,
                    borderColor: CHART_COLORS.border.cost,
                    borderWidth: 1,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Monto ($)' } }
            },
            plugins: {
                title: { display: true, text: 'Dinámica de Flujo de Caja' },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                label += _currencyFormatter.format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });

    // Limpiar mensaje de carga
    document.getElementById('report-visual-container').innerHTML = '';

    // 5. RENDERIZAR TABLA RESUMEN
    renderTable(
        ['Concepto', 'Total Periodo', 'Participación'],
        [
            ['(+) Total Ingresos (Proyectos)', _currencyFormatter.format(totalIncome), '100% (Base Ingreso)'],
            ['(-) Pago a Proveedores', _currencyFormatter.format(totalSupplierExpense), `${totalIncome > 0 ? ((totalSupplierExpense / totalIncome) * 100).toFixed(1) : 0}%`],
            ['(-) Pago de Nómina', _currencyFormatter.format(totalPayrollExpense), `${totalIncome > 0 ? ((totalPayrollExpense / totalIncome) * 100).toFixed(1) : 0}%`],
            ['= FLUJO NETO DEL PERIODO',
                `<span class="font-bold ${netFlow >= 0 ? 'text-green-600' : 'text-red-600'} text-lg">${_currencyFormatter.format(netFlow)}</span>`,
                netFlow >= 0 ? 'Superávit' : 'Déficit'
            ]
        ]
    );
}

// --- C. GASTOS POR PROVEEDOR (VOLUMEN DE COMPRAS) ---
async function generateSupplierExpensesReport() {
    const startInput = document.getElementById('report-start-date');
    const endInput = document.getElementById('report-end-date');

    if (!startInput || !endInput || !startInput.value || !endInput.value) {
        throw new Error("Seleccione un rango de fechas.");
    }

    const startDate = new Date(startInput.value);
    const endDate = new Date(endInput.value + 'T23:59:59');

    // Feedback visual
    const container = document.getElementById('report-visual-container');
    container.innerHTML = '<div class="loader mx-auto my-10"></div><p class="text-center text-xs text-slate-500 mt-2">Analizando órdenes de compra...</p>';

    // 1. CONSULTA: Órdenes de Compra RECIBIDAS en el periodo
    // Nota: Requiere índice compuesto en Firestore (status + createdAt)
    const q = query(
        collection(_db, "purchaseOrders"),
        where("status", "==", "recibida"), // Solo lo que ya entró al inventario/se ejecutó
        where("createdAt", ">=", startDate),
        where("createdAt", "<=", endDate)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
        throw new Error("No se encontraron compras recibidas en este periodo.");
    }

    // 2. PROCESAMIENTO: Agrupar por Proveedor
    const supplierStats = {}; // { 'Proveedor A': { total: 1000, count: 5 } }
    let totalGeneral = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        const supplierName = data.supplierName || data.provider || 'Proveedor Desconocido';
        const total = parseFloat(data.totalCost || 0);

        if (!supplierStats[supplierName]) {
            supplierStats[supplierName] = { total: 0, count: 0 };
        }

        supplierStats[supplierName].total += total;
        supplierStats[supplierName].count += 1;
        totalGeneral += total;
    });

    // 3. ORDENAR (Top Proveedores)
    // Convertimos a array y ordenamos de Mayor a Menor Dinero
    const ranking = Object.entries(supplierStats)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.total - a.total);

    // 4. PREPARAR DATOS GRÁFICO (Top 10 para no saturar)
    const top10 = ranking.slice(0, 10);

    renderChart('pie', {
        labels: top10.map(s => s.name),
        datasets: [{
            label: 'Volumen de Compra ($)',
            data: top10.map(s => s.total),
            backgroundColor: [
                'rgba(59, 130, 246, 0.7)',  // Azul
                'rgba(16, 185, 129, 0.7)',  // Verde
                'rgba(245, 158, 11, 0.7)',  // Amarillo
                'rgba(239, 68, 68, 0.7)',   // Rojo
                'rgba(139, 92, 246, 0.7)',  // Violeta
                'rgba(236, 72, 153, 0.7)',  // Rosa
                'rgba(99, 102, 241, 0.7)',  // Indigo
                'rgba(20, 184, 166, 0.7)',  // Teal
                'rgba(249, 115, 22, 0.7)',  // Naranja
                'rgba(107, 114, 128, 0.7)'  // Gris
            ],
            borderWidth: 1
        }]
    });

    // 5. RENDERIZAR TABLA
    const tableRows = ranking.map((s, idx) => [
        `#${idx + 1}`,
        s.name,
        s.count, // Cantidad de órdenes
        `${((s.total / totalGeneral) * 100).toFixed(1)}%`, // Participación
        _currencyFormatter.format(s.total)
    ]);

    // Añadir fila de total
    tableRows.push([
        '',
        '<strong>TOTAL PERIODO</strong>',
        `<strong>${snapshot.size}</strong>`,
        '<strong>100%</strong>',
        `<strong>${_currencyFormatter.format(totalGeneral)}</strong>`
    ]);

    renderTable(
        ['Ranking', 'Proveedor', 'Órdenes Recibidas', '% Participación', 'Total Comprado'],
        tableRows
    );
}

// --- D. EFICIENCIA DE MATERIAL (MERMAS Y DESPERDICIO) ---
async function generateMaterialEfficiencyReport(projectId) {
    const container = document.getElementById('report-visual-container');
    container.innerHTML = '<div class="loader mx-auto my-10"></div><p class="text-center text-xs text-slate-500 mt-2">Calculando superficies y cortes...</p>';

    // 1. CARGAR DATOS
    // A. Sub-ítems Instalados (Lo que realmente quedó en la obra)
    const installedQuery = query(
        collectionGroup(_db, 'subItems'),
        where('projectId', '==', projectId),
        where('status', '==', 'Instalado')
    );

    // B. Solicitudes de Material Entregadas (Lo que salió de bodega)
    const requestsQuery = query(
        collection(_db, "projects", projectId, "materialRequests"),
        where("status", "in", ["entregado", "entregado_parcial"])
    );

    // C. Catálogo (Para saber cuánto mide una lámina cruda)
    const catalogQuery = query(collection(_db, "materialCatalog"));

    const [installedSnap, requestsSnap, catalogSnap] = await Promise.all([
        getDocs(installedQuery),
        getDocs(requestsQuery),
        getDocs(catalogQuery)
    ]);

    // 2. MAPEAR CATÁLOGO (ID -> Datos Dimensiones)
    const catalogMap = new Map();
    catalogSnap.forEach(doc => catalogMap.set(doc.id, doc.data()));

    // 3. CALCULAR M2 INSTALADOS (TEÓRICO / VENTA)
    let totalM2Installed = 0;
    let installedItemsCount = 0;

    installedSnap.forEach(doc => {
        const item = doc.data();
        // Priorizamos medida real, si no, teórica
        const w = item.realWidth || item.width || 0;
        const h = item.realHeight || item.height || 0;
        
        // Asumimos que todo suma a M2 (incluso perfiles se pueden analizar por área si se quiere, 
        // pero aquí nos enfocamos en el concepto de "superficie cubierta" o vidrio)
        if (w > 0 && h > 0) {
            totalM2Installed += (w * h);
            installedItemsCount++;
        }
    });

    // 4. CALCULAR M2 CONSUMIDOS (REAL / SALIDA BODEGA)
    let totalM2Consumed = 0;
    let materialBreakdown = {}; // { 'Vidrio 4mm': { consumed: 50, unit: 'm2' } }

    requestsSnap.forEach(doc => {
        const req = doc.data();
        // Combinamos items consumidos y materiales directos
        const items = req.consumedItems || req.materials || [];

        items.forEach(item => {
            const matData = catalogMap.get(item.materialId);
            if (!matData) return;

            // Filtramos solo materiales divisibles (Vidrio, Perfil, Lámina)
            // Ignoramos tornillos, empaques, etc. para el cálculo de M2
            if (!matData.isDivisible && matData.measurementType !== 'area') return;

            let areaInThisRequest = 0;
            const quantity = item.quantity || 0;

            // CASO A: Unidad Completa (Lámina entera)
            if (item.type === 'full_unit' || !item.type) {
                if (matData.defaultSize) {
                    // Si el catálogo sabe cuánto mide la lámina (ej: 3.20 x 2.40)
                    const sheetArea = (matData.defaultSize.width || 0) * (matData.defaultSize.length || 0);
                    // Si width es 0 (ej: perfil lineal), usamos solo largo lineal
                    if (sheetArea > 0) {
                        areaInThisRequest = sheetArea * quantity;
                    } else if (matData.measurementType === 'linear') {
                        // Para perfiles, sumamos metros lineales
                        // (Nota: Comparar M2 de vidrio con ML de perfil es difícil en un solo gráfico,
                        // aquí normalizamos todo a "Unidades de Consumo" o nos enfocamos en Vidrio)
                        // Para este reporte, convertiremos ML a un "factor" o lo sumamos separado.
                        // SIMPLIFICACIÓN: Sumamos metros cuadrados estimados si es vidrio
                    }
                }
            } 
            // CASO B: Corte o Retazo (Ya viene con medida específica)
            else if (item.type === 'cut' || item.type === 'remnant') {
                // Si es un corte, usualmente tenemos longitud. Si es vidrio, necesitamos ancho.
                // La estructura de datos actual guarda 'length'.
                // Asumiremos que si es corte, es perfil (lineal) o retazo de vidrio.
                // Si es vidrio, necesitaríamos saber el ancho del retazo.
                // Por ahora, sumaremos basado en la longitud si es lineal.
            }

            // --- REFINAMIENTO PARA VIDRIOS (Lo más crítico en mermas) ---
            if (matData.measurementType === 'area' && matData.defaultSize) {
                const sheetArea = matData.defaultSize.width * matData.defaultSize.length;
                areaInThisRequest = sheetArea * quantity;
            }

            if (areaInThisRequest > 0) {
                totalM2Consumed += areaInThisRequest;
                
                if (!materialBreakdown[matData.name]) {
                    materialBreakdown[matData.name] = 0;
                }
                materialBreakdown[matData.name] += areaInThisRequest;
            }
        });
    });

    // 5. CÁLCULO DE EFICIENCIA
    // Merma = Consumido - Instalado
    // % Desperdicio = (Merma / Consumido) * 100
    
    // Validación: Si no hay consumo registrado (datos antiguos), evitar división por 0
    if (totalM2Consumed === 0 && totalM2Installed > 0) {
        // Fallback visual
        totalM2Consumed = totalM2Installed; 
    }

    const mermaTotal = Math.max(0, totalM2Consumed - totalM2Installed);
    const efficiencyRate = totalM2Consumed > 0 ? (totalM2Installed / totalM2Consumed) * 100 : 0;
    const wasteRate = 100 - efficiencyRate;

    // 6. RENDERIZAR GRÁFICO (DONA)
    // Mostramos la proporción de aprovechamiento
    renderChart('doughnut', {
        labels: ['M² Instalados (Aprovechado)', 'M² Merma/Desperdicio'],
        datasets: [{
            data: [totalM2Installed.toFixed(2), mermaTotal.toFixed(2)],
            backgroundColor: [
                'rgba(34, 197, 94, 0.7)', // Verde
                'rgba(249, 115, 22, 0.7)' // Naranja (Merma)
            ],
            borderColor: [
                'rgb(34, 197, 94)',
                'rgb(249, 115, 22)'
            ],
            borderWidth: 1
        }]
    });

    // 7. RENDERIZAR TABLA DETALLADA
    const breakdownRows = Object.entries(materialBreakdown).map(([name, m2]) => {
        return [name, `${m2.toFixed(2)} m²`];
    });

    // Añadimos resumen al inicio de la tabla
    const summaryData = [
        ['Total Material (Vidrio) Sacado', `${totalM2Consumed.toFixed(2)} m²`],
        ['Total Instalado en Obra', `${totalM2Installed.toFixed(2)} m²`],
        ['Diferencia (Merma/Stock en Obra)', `<span class="font-bold text-orange-600">${mermaTotal.toFixed(2)} m²</span>`],
        ['Eficiencia Global', `<span class="font-bold ${efficiencyRate > 85 ? 'text-green-600' : 'text-red-500'}">${efficiencyRate.toFixed(1)}%</span>`]
    ];

    // Combinamos resumen y desglose
    // (RenderTable soporta array de arrays)
    renderTable(['Indicador / Material', 'Cantidad Area'], [...summaryData, ...breakdownRows]);
}

// --- E. AVANCE FÍSICO VS. FINANCIERO ---
async function generatePhysicalFinancialReport(projectId) {
    const container = document.getElementById('report-visual-container');
    container.innerHTML = '<div class="loader mx-auto my-10"></div><p class="text-center text-xs text-slate-500 mt-2">Cruzando datos de obra vs. facturación...</p>';

    // 1. OBTENER DATOS
    const projectRef = doc(_db, "projects", projectId);
    const [projectSnap, itemsSnap, installedSnap, cortesSnap] = await Promise.all([
        getDoc(projectRef),
        getDocs(query(collection(_db, "projects", projectId, "items"))),
        getDocs(query(collectionGroup(_db, 'subItems'), where('projectId', '==', projectId), where('status', '==', 'Instalado'))),
        getDocs(query(collection(_db, "projects", projectId, "cortes"), where('status', '==', 'aprobado')))
    ]);

    if (!projectSnap.exists()) throw new Error("Proyecto no encontrado");
    const projectData = projectSnap.data();

    // 2. CALCULAR VALOR TOTAL CONTRATO (Línea Base)
    // Reconstruimos el valor total sumando los ítems actuales (más preciso que project.value si hubo cambios)
    let totalContractValue = 0;
    const itemsPriceMap = new Map(); // ID -> Precio Unitario

    itemsSnap.forEach(doc => {
        const item = doc.data();
        // Calculamos precio unitario completo (Suministro + Instalación + AIU/IVA)
        // Usamos una lógica simplificada de tu helper calculateItemTotal
        let unitPrice = 0;
        
        const calcPart = (details) => {
            if (!details || !details.unitPrice) return 0;
            let val = details.unitPrice;
            if (details.taxType === 'iva') val *= 1.19;
            if (details.taxType === 'aiu') {
                const factors = (details.aiuA + details.aiuI + details.aiuU) / 100;
                val += (details.unitPrice * factors) + ((details.unitPrice * (details.aiuU/100)) * 0.19);
            }
            return val;
        };

        if (item.itemType === 'suministro_instalacion_incluido') {
            unitPrice = calcPart(item.includedDetails);
        } else {
            unitPrice = calcPart(item.supplyDetails) + calcPart(item.installationDetails);
        }

        itemsPriceMap.set(doc.id, unitPrice);
        totalContractValue += (unitPrice * item.quantity);
    });

    // 3. CALCULAR AVANCE FÍSICO (Lo que está instalado)
    let physicalValue = 0;
    let installedCount = 0;

    installedSnap.forEach(doc => {
        const subItem = doc.data();
        const price = itemsPriceMap.get(subItem.itemId) || 0;
        physicalValue += price;
        installedCount++;
    });

    // 4. CALCULAR AVANCE FINANCIERO (Lo que se ha cobrado/aprobado)
    let financialValue = 0; // Cortes Aprobados
    cortesSnap.forEach(doc => {
        // Usamos el valor bruto ejecutado del corte, antes de amortización
        // ¿Por qué? Porque la amortización es devolución de anticipo, pero el trabajo se cobró.
        financialValue += (doc.data().totalValue || 0);
    });

    // 5. ANÁLISIS DE DESFASE (GAP)
    // Diferencia: (Lo que hice) - (Lo que cobré)
    // Positivo: Tengo trabajo hecho pendiente por cobrar (La empresa financia).
    // Negativo: He cobrado más de lo que he instalado (Riesgo / Anticipo consumido).
    const gap = physicalValue - financialValue;
    const physicalPercent = totalContractValue > 0 ? (physicalValue / totalContractValue) * 100 : 0;
    const financialPercent = totalContractValue > 0 ? (financialValue / totalContractValue) * 100 : 0;

    // 6. RENDERIZAR GRÁFICO (Barras Comparativas)
    renderChart('bar', {
        labels: ['Valor Contrato', 'Avance Físico (Obra)', 'Avance Financiero (Cortes)'],
        datasets: [{
            label: 'Estado del Proyecto ($)',
            data: [totalContractValue, physicalValue, financialValue],
            backgroundColor: [
                'rgba(203, 213, 225, 0.5)', // Gris (Base)
                'rgba(34, 197, 94, 0.7)',   // Verde (Físico - Lo bueno)
                'rgba(59, 130, 246, 0.7)'   // Azul (Financiero - Lo cobrado)
            ],
            borderColor: [
                'rgb(203, 213, 225)',
                'rgb(34, 197, 94)',
                'rgb(59, 130, 246)'
            ],
            borderWidth: 2,
            borderRadius: 5
        }]
    });

    // 7. SEMÁFORO DE INTERPRETACIÓN
    let analysisMsg = '';
    let analysisColor = '';
    
    // Umbral de tolerancia: 5%
    const tolerance = totalContractValue * 0.05;

    if (Math.abs(gap) < tolerance) {
        analysisMsg = "EQUILIBRADO. La facturación va acorde al avance de obra.";
        analysisColor = "text-green-600 bg-green-50 border-green-200";
    } else if (gap > 0) {
        analysisMsg = "PENDIENTE POR COBRAR. Has instalado más de lo que has pasado en cortes. ¡Genera un corte pronto!";
        analysisColor = "text-blue-600 bg-blue-50 border-blue-200";
    } else {
        analysisMsg = "ALERTA: SOBRE-FACTURACIÓN (O ANTICIPO). El valor cobrado supera al físico instalado. Asegúrate de tener liquidez para terminar.";
        analysisColor = "text-orange-600 bg-orange-50 border-orange-200";
    }

    // Inyectar mensaje visual
    const visualDiv = document.getElementById('report-visual-container');
    const msgDiv = document.createElement('div');
    msgDiv.className = `absolute top-4 right-4 p-3 rounded-lg border text-xs font-bold max-w-xs shadow-sm ${analysisColor}`;
    msgDiv.innerHTML = `<i class="fa-solid fa-circle-info mr-1"></i> ${analysisMsg}`;
    visualDiv.appendChild(msgDiv);

    // 8. RENDERIZAR TABLA DETALLADA
    renderTable(
        ['Indicador', 'Monto ($)', 'Porcentaje (%)', 'Diferencia'],
        [
            ['Contrato Total (Estimado)', _currencyFormatter.format(totalContractValue), '100%', '-'],
            ['Avance Físico (Instalado)', _currencyFormatter.format(physicalValue), `${physicalPercent.toFixed(1)}%`, '-'],
            ['Avance Financiero (Cortes)', _currencyFormatter.format(financialValue), `${financialPercent.toFixed(1)}%`, 
             `<span class="${gap >= 0 ? 'text-blue-600' : 'text-red-500'} font-bold">${gap >= 0 ? '+' : ''}${_currencyFormatter.format(gap)}</span>`
            ]
        ]
    );
}

// --- F. TRAZABILIDAD DE RETAZOS (ECONOMÍA CIRCULAR) ---
async function generateRemnantTraceabilityReport(projectId) {
    const container = document.getElementById('report-visual-container');
    container.innerHTML = '<div class="loader mx-auto my-10"></div><p class="text-center text-xs text-slate-500 mt-2">Rastreando ciclo de vida de sobrantes...</p>';

    // 1. OBTENER DATOS
    // Consultamos todas las solicitudes del proyecto
    const requestsQuery = query(collection(_db, "projects", projectId, "materialRequests"));
    const requestsSnap = await getDocs(requestsQuery);

    if (requestsSnap.empty) {
        throw new Error("No hay movimientos de material en este proyecto.");
    }

    // 2. PROCESAMIENTO
    const materialStats = {}; // { 'Vidrio 4mm': { usedQty: 0, usedLen: 0, generatedQty: 0, generatedLen: 0 } }
    let totalUsedCount = 0;
    let totalGeneratedCount = 0;

    requestsSnap.forEach(doc => {
        const req = doc.data();
        
        // A. ANÁLISIS DE CONSUMO (Lo que el proyecto pidió y se le entregó como retazo)
        // Revisamos 'deliveryHistory' para ser exactos con lo entregado
        if (req.deliveryHistory && Array.isArray(req.deliveryHistory)) {
            req.deliveryHistory.forEach(delivery => {
                if (delivery.items) {
                    delivery.items.forEach(item => {
                        // Solo nos interesan los retazos consumidos
                        if (item.type === 'remnant') {
                            const name = item.itemName || 'Material Indefinido';
                            if (!materialStats[name]) materialStats[name] = { usedQty: 0, usedLen: 0, genQty: 0, genLen: 0 };
                            
                            materialStats[name].usedQty += (item.quantity || 0);
                            materialStats[name].usedLen += (item.length || 0) * (item.quantity || 0); // Metros lineales totales
                            totalUsedCount += (item.quantity || 0);
                        }
                    });
                }
            });
        }

        // B. ANÁLISIS DE GENERACIÓN (Lo que el proyecto devolvió como sobrante)
        if (req.returnedItems && Array.isArray(req.returnedItems)) {
            req.returnedItems.forEach(item => {
                // Solo nos interesan los retazos devueltos a stock (type 'remnant')
                // Si type es 'complete', es una devolución de unidad nueva, no cuenta como retazo generado.
                if (item.type === 'remnant') {
                    const name = item.itemName || 'Material Indefinido';
                    if (!materialStats[name]) materialStats[name] = { usedQty: 0, usedLen: 0, genQty: 0, genLen: 0 };

                    // En returnedItems, los retazos a veces vienen agrupados en un array 'remnants' o directos
                    if (item.remnants && Array.isArray(item.remnants)) {
                        item.remnants.forEach(r => {
                            materialStats[name].genQty += (r.quantity || 0);
                            materialStats[name].genLen += (r.length || 0) * (r.quantity || 0);
                            totalGeneratedCount += (r.quantity || 0);
                        });
                    } else {
                        // Formato simple
                        materialStats[name].genQty += (item.quantity || 0);
                        materialStats[name].genLen += (item.length || 0) * (item.quantity || 0);
                        totalGeneratedCount += (item.quantity || 0);
                    }
                }
            });
        }
    });

    // 3. PREPARAR DATOS VISUALES
    const labels = Object.keys(materialStats);
    const dataUsed = labels.map(k => materialStats[k].usedQty);
    const dataGenerated = labels.map(k => materialStats[k].genQty);

    // Calculamos un índice de "Limpieza"
    // > 0: El proyecto limpió inventario (Usó más de lo que creó)
    // < 0: El proyecto ensució inventario (Creó más basura de la que usó)
    const netBalance = totalUsedCount - totalGeneratedCount;
    let balanceMsg = "";
    if(netBalance > 0) balanceMsg = "ECO-AMIGABLE: Este proyecto reutilizó más material del que desechó.";
    else if(netBalance < 0) balanceMsg = "GENERADOR: Este proyecto aumentó el stock de retazos.";
    else balanceMsg = "NEUTRO: Equilibrio entre uso y generación.";

    // 4. RENDERIZAR GRÁFICO (Barras Apiladas)
    renderChart('bar', {
        labels: labels,
        datasets: [
            {
                label: 'Retazos Reutilizados (Entrada a Obra)',
                data: dataUsed,
                backgroundColor: 'rgba(34, 197, 94, 0.6)', // Verde
                borderColor: 'rgb(34, 197, 94)',
                borderWidth: 1
            },
            {
                label: 'Retazos Generados (Salida a Bodega)',
                data: dataGenerated,
                backgroundColor: 'rgba(249, 115, 22, 0.6)', // Naranja
                borderColor: 'rgb(249, 115, 22)',
                borderWidth: 1
            }
        ]
    });

    // Inyectar mensaje de análisis
    const visualDiv = document.getElementById('report-visual-container');
    const msgDiv = document.createElement('div');
    msgDiv.className = `absolute bottom-4 right-4 p-2 px-4 rounded-full bg-white border shadow-sm text-xs font-bold ${netBalance >= 0 ? 'text-green-600 border-green-200' : 'text-orange-600 border-orange-200'}`;
    msgDiv.innerHTML = `<i class="fa-solid fa-leaf mr-1"></i> ${balanceMsg}`;
    visualDiv.appendChild(msgDiv);

    // 5. RENDERIZAR TABLA
    const tableRows = labels.map(name => {
        const s = materialStats[name];
        return [
            name,
            `<span class="text-green-600 font-bold">${s.usedQty} und</span> <span class="text-xs text-gray-400">(${s.usedLen.toFixed(1)} m)</span>`,
            `<span class="text-orange-500 font-bold">${s.genQty} und</span> <span class="text-xs text-gray-400">(${s.genLen.toFixed(1)} m)</span>`,
            s.usedQty >= s.genQty 
                ? '<span class="badge bg-green-100 text-green-800 px-2 py-1 rounded text-xs">Eficiente</span>' 
                : '<span class="badge bg-orange-100 text-orange-800 px-2 py-1 rounded text-xs">Acumulador</span>'
        ];
    });

    // Añadir totales
    tableRows.push([
        '<strong>TOTALES</strong>',
        `<strong>${totalUsedCount}</strong>`,
        `<strong>${totalGeneratedCount}</strong>`,
        ''
    ]);

    renderTable(
        ['Material', 'Reutilizados (Consumo)', 'Generados (Sobrante)', 'Balance'],
        tableRows
    );
}

// --- G. RENDIMIENTO POR INSTALADOR (RANKING DE PRODUCTIVIDAD) ---
async function generateInstallerPerformanceReport() {
    const startInput = document.getElementById('report-start-date');
    const endInput = document.getElementById('report-end-date');

    if(!startInput || !endInput || !startInput.value || !endInput.value) {
        throw new Error("Seleccione un rango de fechas completo.");
    }

    // Feedback visual
    const container = document.getElementById('report-visual-container');
    container.innerHTML = '<div class="loader mx-auto my-10"></div><p class="text-center text-xs text-slate-500 mt-2">Calculando superficies instaladas...</p>';

    // 1. CONSULTA: Buscar en TODOS los sub-ítems de TODOS los proyectos
    // Filtramos por estado 'Instalado' y rango de fecha de instalación
    const q = query(
        collectionGroup(_db, 'subItems'),
        where('status', '==', 'Instalado'),
        where('installDate', '>=', startInput.value),
        where('installDate', '<=', endInput.value)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
        throw new Error("No se encontraron instalaciones registradas en este periodo.");
    }

    // 2. PROCESAMIENTO Y AGRUPACIÓN
    const stats = {}; // { 'uid123': { name: 'Juan', m2: 50.5, count: 10, projects: Set() } }
    
    // Usamos el mapa global de usuarios para obtener nombres rápidamente
    const usersCache = window.usersMap || new Map();

    snapshot.forEach(doc => {
        const data = doc.data();
        const installerId = data.installer;

        // Si el registro no tiene instalador (datos viejos), lo saltamos o marcamos como 'Sin Asignar'
        if (!installerId) return;

        if (!stats[installerId]) {
            const user = usersCache.get(installerId);
            stats[installerId] = { 
                name: user ? `${user.firstName} ${user.lastName}` : 'Ex-Empleado / Desconocido',
                photo: user ? user.profilePhotoURL : null,
                m2: 0,
                count: 0,
                projects: new Set() // Para contar en cuántos proyectos participó
            };
        }

        // Calculamos el área de esta unidad específica
        // Prioridad: Medida Real > Medida Teórica > 0
        const w = parseFloat(data.realWidth || data.width || 0);
        const h = parseFloat(data.realHeight || data.height || 0);
        const area = w * h;

        stats[installerId].m2 += area;
        stats[installerId].count += 1;
        if(data.projectId) stats[installerId].projects.add(data.projectId);
    });

    // 3. ORDENAR (RANKING)
    // Convertimos a array y ordenamos de Mayor a Menor M2
    const ranking = Object.values(stats).sort((a, b) => b.m2 - a.m2);

    // 4. RENDERIZAR GRÁFICO (BARRAS HORIZONTALES)
    // Es mejor horizontal para leer los nombres
    renderChart('bar', {
        labels: ranking.map(i => i.name),
        datasets: [{
            label: 'Total Metros Cuadrados (M²) Instalados',
            data: ranking.map(i => i.m2.toFixed(2)),
            backgroundColor: 'rgba(59, 130, 246, 0.6)', // Azul
            borderColor: 'rgb(59, 130, 246)',
            borderWidth: 1,
            borderRadius: 4,
            barPercentage: 0.6
        }]
    }, {
        indexAxis: 'y', // <--- ESTO HACE QUE LAS BARRAS SEAN HORIZONTALES
        scales: {
            x: { title: { display: true, text: 'Metros Cuadrados (M²)' } }
        }
    });

    // Inyectar mensaje de "Mejor Empleado"
    if (ranking.length > 0) {
        const top = ranking[0];
        const visualDiv = document.getElementById('report-visual-container');
        const msgDiv = document.createElement('div');
        msgDiv.className = `absolute bottom-4 right-4 p-3 rounded-xl bg-white border border-blue-100 shadow-lg flex items-center gap-3 animate-fade-in-up`;
        
        // Avatar del ganador
        const avatarHtml = top.photo 
            ? `<img src="${top.photo}" class="w-10 h-10 rounded-full object-cover border-2 border-yellow-400">`
            : `<div class="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold border-2 border-yellow-400">🏆</div>`;

        msgDiv.innerHTML = `
            ${avatarHtml}
            <div>
                <p class="text-[10px] text-slate-400 uppercase font-bold">Mayor Rendimiento</p>
                <p class="text-sm font-bold text-slate-800 leading-tight">${top.name}</p>
                <p class="text-xs text-blue-600 font-bold">${top.m2.toFixed(1)} m²</p>
            </div>
        `;
        visualDiv.appendChild(msgDiv);
    }

    // 5. RENDERIZAR TABLA DETALLADA
    const tableRows = ranking.map((worker, idx) => {
        // Cálculo de promedio
        const avg = worker.count > 0 ? (worker.m2 / worker.count).toFixed(2) : 0;
        
        let medal = '';
        if (idx === 0) medal = '🥇';
        if (idx === 1) medal = '🥈';
        if (idx === 2) medal = '🥉';

        return [
            `<span class="font-bold text-gray-700">${medal} #${idx + 1}</span>`,
            `<span class="font-medium">${worker.name}</span>`,
            worker.count,
            worker.projects.size, // Cantidad de proyectos distintos
            `${avg} m²`,
            `<span class="font-black text-blue-700">${worker.m2.toFixed(2)} m²</span>`
        ];
    });

    renderTable(
        ['Posición', 'Instalador', 'Unds. Totales', 'Proyectos', 'Promedio/Und', 'Total M²'],
        tableRows
    );
}

// --- H. REPORTE DE AUSENTISMO Y PUNTUALIDAD ---
async function generateAttendanceReport() {
    const startInput = document.getElementById('report-start-date');
    const endInput = document.getElementById('report-end-date');

    if(!startInput || !endInput || !startInput.value || !endInput.value) {
        throw new Error("Seleccione un rango de fechas.");
    }

    const startDate = new Date(startInput.value);
    const endDate = new Date(endInput.value + 'T23:59:59');

    // Configuración de Jornada
    const WORK_START_HOUR = 8;
    const WORK_START_MINUTE = 5; // 5 minutos de gabela
    
    // Feedback visual
    const container = document.getElementById('report-visual-container');
    container.innerHTML = '<div class="loader mx-auto my-10"></div><p class="text-center text-xs text-slate-500 mt-2">Analizando marcaciones biométricas...</p>';

    // 1. OBTENER USUARIOS ACTIVOS (Los que deberían asistir)
    // Usamos el caché global si existe, si no, consultamos
    let activeUsers = [];
    if (window.usersMap) {
        window.usersMap.forEach((user, uid) => {
            if (user.status === 'active' && user.role !== 'admin') { // Excluir admins si se desea
                activeUsers.push({ id: uid, name: `${user.firstName} ${user.lastName}` });
            }
        });
    } else {
        const uSnap = await getDocs(query(collection(_db, "users"), where("status", "==", "active")));
        activeUsers = uSnap.docs.map(d => ({ id: d.id, name: `${d.data().firstName} ${d.data().lastName}` }));
    }

    // 2. OBTENER REPORTES DE ASISTENCIA
    // Nota: Requiere índice en 'timestamp'
    const q = query(
        collectionGroup(_db, 'attendance_reports'),
        where('type', '==', 'ingreso'),
        where('timestamp', '>=', startDate),
        where('timestamp', '<=', endDate)
    );
    const snapshot = await getDocs(q);

    // 3. MAPEAR ASISTENCIA
    // Estructura: attendanceMap[userId][YYYY-MM-DD] = DateObject
    const attendanceMap = {};
    
    snapshot.forEach(doc => {
        const data = doc.data();
        const uid = doc.ref.parent.parent.id; // user ID es el padre de la subcolección
        const timestamp = data.timestamp ? data.timestamp.toDate() : null;

        if (timestamp) {
            // Ajustar a fecha local Colombia para la clave del mapa
            const dateKey = timestamp.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }); // YYYY-MM-DD
            
            if (!attendanceMap[uid]) attendanceMap[uid] = {};
            
            // Si hay múltiples ingresos, nos quedamos con el PRIMERO del día
            if (!attendanceMap[uid][dateKey] || timestamp < attendanceMap[uid][dateKey]) {
                attendanceMap[uid][dateKey] = timestamp;
            }
        }
    });

    // 4. CALCULAR ESTADÍSTICAS
    const stats = {}; // { uid: { name, totalDays, onTime, late, absent } }
    
    // Inicializar stats
    activeUsers.forEach(u => {
        stats[u.id] = { name: u.name, totalDays: 0, onTime: 0, late: 0, absent: 0 };
    });

    // Iterar cada día del rango
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        // Excluir Domingos (0)
        if (d.getDay() === 0) continue; 
        
        const dateKey = d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

        activeUsers.forEach(u => {
            const entryTime = attendanceMap[u.id] ? attendanceMap[u.id][dateKey] : null;

            stats[u.id].totalDays++;

            if (!entryTime) {
                // AUSENTE
                stats[u.id].absent++;
            } else {
                // Verificar Hora (Zona Horaria Bogotá)
                const hour = parseInt(entryTime.toLocaleTimeString('en-US', { timeZone: 'America/Bogota', hour: '2-digit', hour12: false }));
                const minute = parseInt(entryTime.toLocaleTimeString('en-US', { timeZone: 'America/Bogota', minute: '2-digit' }));
                
                // Lógica de Puntualidad
                if (hour < WORK_START_HOUR || (hour === WORK_START_HOUR && minute <= WORK_START_MINUTE)) {
                    stats[u.id].onTime++;
                } else {
                    stats[u.id].late++;
                }
            }
        });
    }

    // 5. ORDENAR POR IMPUNTUALIDAD (Para el Top)
    const ranking = Object.values(stats).sort((a, b) => b.late - a.late);
    const topOffenders = ranking.slice(0, 5);

    // 6. RENDERIZAR GRÁFICO (Top 5 Llegadas Tarde)
    renderChart('bar', {
        labels: topOffenders.map(i => i.name),
        datasets: [{
            label: 'Llegadas Tarde Acumuladas',
            data: topOffenders.map(i => i.late),
            backgroundColor: 'rgba(239, 68, 68, 0.6)', // Rojo
            borderColor: 'rgb(239, 68, 68)',
            borderWidth: 1
        }]
    }, {
        indexAxis: 'y',
        plugins: {
            title: { display: true, text: 'Top 5: Llegadas Tarde' },
            legend: { display: false }
        }
    });

    // 7. RENDERIZAR TABLA DETALLADA
    const tableRows = ranking.map(s => {
        const attendanceRate = s.totalDays > 0 ? (((s.totalDays - s.absent) / s.totalDays) * 100).toFixed(0) : 0;
        const punctualityRate = (s.totalDays - s.absent) > 0 ? ((s.onTime / (s.totalDays - s.absent)) * 100).toFixed(0) : 0;
        
        // Badges visuales
        let scoreBadge = '';
        if (punctualityRate >= 90) scoreBadge = '<span class="text-green-600 font-bold">Excelente</span>';
        else if (punctualityRate >= 70) scoreBadge = '<span class="text-yellow-600 font-bold">Regular</span>';
        else scoreBadge = '<span class="text-red-600 font-bold">Crítico</span>';

        return [
            s.name,
            s.totalDays,
            `<span class="text-green-600 font-bold">${s.onTime}</span>`,
            `<span class="text-orange-500 font-bold">${s.late}</span>`,
            `<span class="text-red-600 font-bold">${s.absent}</span>`,
            `${punctualityRate}% / ${scoreBadge}`
        ];
    });

    // Añadir métrica global de la empresa
    const totalLate = ranking.reduce((sum, i) => sum + i.late, 0);
    const totalAbsent = ranking.reduce((sum, i) => sum + i.absent, 0);
    
    // Inyectar resumen visual
    const visualDiv = document.getElementById('report-visual-container');
    const summaryDiv = document.createElement('div');
    summaryDiv.className = "mt-4 flex justify-center gap-4";
    summaryDiv.innerHTML = `
        <div class="bg-red-50 p-3 rounded-lg border border-red-100 text-center">
            <p class="text-xs text-red-500 uppercase font-bold">Ausencias Totales</p>
            <p class="text-xl font-black text-red-700">${totalAbsent}</p>
        </div>
        <div class="bg-orange-50 p-3 rounded-lg border border-orange-100 text-center">
            <p class="text-xs text-orange-500 uppercase font-bold">Retardos Totales</p>
            <p class="text-xl font-black text-orange-700">${totalLate}</p>
        </div>
    `;
    visualDiv.appendChild(summaryDiv);

    renderTable(
        ['Colaborador', 'Días Hábiles', 'Puntual', 'Tarde (>8:05)', 'Ausente', '% Puntualidad'],
        tableRows
    );
}

// --- I. HISTORIAL DE DAÑOS Y PÉRDIDAS DE HERRAMIENTA ---
async function generateToolDamageReport() {
    const startInput = document.getElementById('report-start-date');
    const endInput = document.getElementById('report-end-date');

    if(!startInput || !endInput || !startInput.value || !endInput.value) {
        throw new Error("Seleccione un rango de fechas.");
    }

    const startDate = new Date(startInput.value);
    const endDate = new Date(endInput.value + 'T23:59:59');

    // Feedback visual
    const container = document.getElementById('report-visual-container');
    container.innerHTML = '<div class="loader mx-auto my-10"></div><p class="text-center text-xs text-slate-500 mt-2">Auditando devoluciones y reportes de avería...</p>';

    // 1. CONSULTA: Buscar en el historial global de herramientas
    // Buscamos eventos donde el estado de devolución NO sea 'bueno'
    // Nota: Requiere índice compuesto en Firestore (returnStatus + timestamp)
    const q = query(
        collectionGroup(_db, 'history'),
        where('returnStatus', 'in', ['dañado', 'con_defecto', 'perdido']), // Incluimos 'perdido' si existe en tu lógica
        where('timestamp', '>=', startDate),
        where('timestamp', '<=', endDate)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
        throw new Error("¡Excelentes noticias! No se reportaron daños ni pérdidas en este periodo.");
    }

    // 2. PROCESAMIENTO
    const userStats = {}; // { uid: { name: 'Juan', total: 0, damage: 0, defect: 0 } }
    const toolStats = {}; // { 'Taladro': 5 }
    const logData = [];   // Para la tabla

    // Cache de usuarios
    const usersCache = window.usersMap || new Map();

    snapshot.forEach(doc => {
        const data = doc.data();
        const uid = data.returnedByUserId || data.userId || 'unknown'; // Ajustar según cómo guardes el ID en 'history'
        
        // Obtener nombre del usuario
        let userName = 'Desconocido';
        if (usersCache.has(uid)) {
            const u = usersCache.get(uid);
            userName = `${u.firstName} ${u.lastName}`;
        } else if (data.returnedByName) {
            userName = data.returnedByName;
        }

        // Estadísticas por Usuario
        if (!userStats[uid]) {
            userStats[uid] = { name: userName, total: 0, dañado: 0, con_defecto: 0, perdido: 0 };
        }
        userStats[uid].total++;
        if (userStats[uid][data.returnStatus] !== undefined) {
            userStats[uid][data.returnStatus]++;
        }

        // Estadísticas por Herramienta
        const toolName = data.toolName || 'Herramienta sin nombre';
        if (!toolStats[toolName]) toolStats[toolName] = 0;
        toolStats[toolName]++;

        // Datos para Tabla Detallada
        logData.push({
            date: data.timestamp ? data.timestamp.toDate() : new Date(),
            user: userName,
            tool: toolName,
            status: data.returnStatus,
            notes: data.notes || data.comments || 'Sin observaciones'
        });
    });

    // 3. PREPARAR DATOS PARA GRÁFICOS
    
    // Gráfico 1: Top 5 Usuarios con más incidentes
    const userRanking = Object.values(userStats).sort((a, b) => b.total - a.total).slice(0, 5);
    
    // Gráfico 2: Distribución por Tipo de Daño (Global)
    let totalDanos = 0, totalDefectos = 0, totalPerdidas = 0;
    Object.values(userStats).forEach(u => {
        totalDanos += u.dañado;
        totalDefectos += u.con_defecto;
        totalPerdidas += u.perdido;
    });

    // 4. RENDERIZAR GRÁFICO (Doble: Barras y Dona)
    // Limpiamos y preparamos un layout de dos columnas para los gráficos
    const chartCanvas = document.getElementById('report-chart-canvas');
    
    // NOTA: Como Chart.js usa un solo canvas, destruimos el anterior y creamos uno de barras
    // Para mostrar dos gráficos, necesitaríamos modificar el HTML dinámicamente. 
    // Por simplicidad, mostraremos el Ranking de Usuarios en el gráfico principal.
    
    renderChart('bar', {
        labels: userRanking.map(u => u.name),
        datasets: [
            {
                label: 'Dañado (Mal uso)',
                data: userRanking.map(u => u.dañado),
                backgroundColor: 'rgba(239, 68, 68, 0.7)', // Rojo
                stack: 'Stack 0'
            },
            {
                label: 'Con Defecto (Desgaste)',
                data: userRanking.map(u => u.con_defecto),
                backgroundColor: 'rgba(245, 158, 11, 0.7)', // Amarillo
                stack: 'Stack 0'
            }
        ]
    }, {
        indexAxis: 'y', // Barras horizontales
        scales: {
            x: { stacked: true },
            y: { stacked: true }
        },
        plugins: {
            title: { display: true, text: 'Top 5: Reportes de Avería por Colaborador' }
        }
    });

    // Inyectar Resumen de la herramienta más frágil
    const topTool = Object.entries(toolStats).sort((a,b) => b[1] - a[1])[0];
    if (topTool) {
        const visualDiv = document.getElementById('report-visual-container');
        const msgDiv = document.createElement('div');
        msgDiv.className = `absolute bottom-4 right-4 p-3 rounded-xl bg-white border border-red-100 shadow-lg flex items-center gap-3 animate-fade-in-up`;
        msgDiv.innerHTML = `
            <div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold border-2 border-red-200"><i class="fa-solid fa-triangle-exclamation"></i></div>
            <div>
                <p class="text-[10px] text-slate-400 uppercase font-bold">Herramienta Crítica</p>
                <p class="text-sm font-bold text-slate-800 leading-tight">${topTool[0]}</p>
                <p class="text-xs text-red-500 font-bold">${topTool[1]} incidentes</p>
            </div>
        `;
        visualDiv.appendChild(msgDiv);
    }

    // 5. RENDERIZAR TABLA DETALLADA
    // Ordenar cronológicamente descendente
    logData.sort((a, b) => b.date - a.date);

    const tableRows = logData.map(log => {
        let badgeColor = '';
        let badgeIcon = '';
        let statusLabel = '';

        switch (log.status) {
            case 'dañado': 
                badgeColor = 'bg-red-100 text-red-800 border-red-200'; 
                badgeIcon = 'fa-hammer';
                statusLabel = 'Dañado';
                break;
            case 'con_defecto': 
                badgeColor = 'bg-yellow-100 text-yellow-800 border-yellow-200'; 
                badgeIcon = 'fa-screwdriver-wrench';
                statusLabel = 'Defecto';
                break;
            case 'perdido': 
                badgeColor = 'bg-gray-800 text-white border-gray-600'; 
                badgeIcon = 'fa-question';
                statusLabel = 'Perdido';
                break;
        }

        return [
            log.date.toLocaleDateString('es-CO') + ' ' + log.date.toLocaleTimeString('es-CO', {hour: '2-digit', minute:'2-digit'}),
            `<span class="font-bold text-gray-700">${log.user}</span>`,
            log.tool,
            `<span class="px-2 py-1 rounded text-xs font-bold border flex items-center w-fit gap-1 ${badgeColor}"><i class="fa-solid ${badgeIcon}"></i> ${statusLabel}</span>`,
            `<span class="text-xs italic text-gray-500">${log.notes}</span>`
        ];
    });

    renderTable(
        ['Fecha', 'Responsable', 'Herramienta', 'Estado Reportado', 'Observaciones'],
        tableRows
    );
}


// =============================================================================
// 5. UTILIDADES Y RENDERIZADORES
// =============================================================================

async function getActiveProjects() {
    const q = query(collection(_db, "projects"), where("status", "==", "active"), orderBy("name"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, name: d.data().name }));
}

// Se añade el tercer parámetro 'extraOptions'
function renderChart(type, data, extraOptions = {}) {
    const canvas = document.getElementById('report-chart-canvas');
    if (reportChartInstance) reportChartInstance.destroy();
    
    if (typeof Chart === 'undefined') {
        document.getElementById('report-visual-container').innerHTML = '<p class="text-red-500">Librería Chart.js no cargada.</p>';
        return;
    }

    // Fusionamos las opciones base con las extra
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'top' }, // Cambié a top para que se vea mejor
            title: { display: false }
        },
        ...extraOptions // <--- AQUÍ SE APLICAN (ej: indexAxis: 'y')
    };

    reportChartInstance = new Chart(canvas, {
        type: type,
        data: data,
        options: options
    });
    
    document.getElementById('report-visual-container').innerHTML = ''; 
}

function renderTable(headers, rows) {
    const container = document.getElementById('report-table-container');
    let html = `
        <div class="overflow-x-auto bg-white rounded-lg shadow border border-gray-200 mt-6">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr>
                        ${headers.map(h => `<th class="px-6 py-3">${h}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
    `;

    rows.forEach(row => {
        html += `<tr class="bg-white border-b hover:bg-gray-50">
            ${row.map(cell => `<td class="px-6 py-4 font-medium text-gray-900">${cell}</td>`).join('')}
        </tr>`;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
}

// --- FUNCIÓN DE ENCABEZADO DE EMPRESA (PARA IMPRESIÓN) ---
async function injectCompanyHeader() {
    const headerDiv = document.getElementById('report-company-header');
    if (!headerDiv) return;

    let companyData = {
        nombre: "VIDRIOS Y ALUMINIOS EXITO S.A.S",
        nit: "NIT: 900.123.456-7",
        logoURL: null
    };

    try {
        const docRef = doc(_db, "system", "generalConfig");
        const snapshot = await getDoc(docRef);
        if (snapshot.exists() && snapshot.data().empresa) {
            companyData = snapshot.data().empresa;
        }
    } catch (e) {
        console.warn("Usando datos default empresa.");
    }

    const logoHtml = companyData.logoURL
        ? `<img src="${companyData.logoURL}" class="h-16 w-auto object-contain">`
        : `<div class="h-16 w-16 bg-gray-100 rounded flex items-center justify-center text-gray-400"><i class="fa-solid fa-building"></i></div>`;

    headerDiv.innerHTML = `
        <div class="flex items-center gap-6 w-full">
            ${logoHtml}
            <div>
                <h1 class="text-xl font-bold text-gray-800 uppercase leading-tight">${companyData.nombre}</h1>
                <p class="text-sm text-gray-500 font-mono">${companyData.nit || ''}</p>
                <p class="text-xs text-gray-400 mt-1">Reporte Generado: ${new Date().toLocaleString('es-CO')}</p>
            </div>
        </div>
    `;

    headerDiv.classList.remove('hidden');
    headerDiv.classList.add('flex');
}



window.resizeChartForPrint = function() {
    if (reportChartInstance) {
        reportChartInstance.resize();
    }
};