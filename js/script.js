document.addEventListener('DOMContentLoaded', function() {
    const data = {
        services: [
            { icon: '🪟', title: 'Suministro e Instalación de Ventanería', description: 'Soluciones a medida que combinan estética, funcionalidad y seguridad para todo tipo de proyectos.' },
            { icon: '🔩', title: 'Fabricación de Herrajes en Acero Inoxidable', description: 'Piezas de alta durabilidad y diseño superior para complementar y asegurar cualquier instalación.' },
            { icon: '🏢', title: 'Instalación de Vidrio Templado y Laminado', description: 'Máxima seguridad y resistencia para fachadas, divisiones de baño, barandas y cerramientos especiales.' },
            { icon: '🎨', title: 'Planta de Pintura Electrostática', description: 'Acabados perfectos, uniformes y de gran resistencia para perfiles de aluminio en una amplia gama de colores.' },
            { icon: '🏗️', title: 'Suministro de Perfilería y Vidrios', description: 'Un extenso catálogo de perfiles de aluminio y vidrios (templados, laminados, crudos) para sus proyectos.' },
            { icon: '💡', title: 'Asesoría Técnica Especializada', description: 'Acompañamiento profesional para seleccionar la solución ideal que cumpla con la norma NSR-10.' }
        ],
        systems: [
            { name: 'Sistema 5020', category: 'Corredizos', description: 'Ideal para ventanas residenciales de baja altura. Un balance perfecto entre rendimiento y costo.', performance: { wind: 3, water: 3, air: 2, sound: 2 } },
            { name: 'Sistema 744', category: 'Corredizos', description: 'Perfecto para puertas y ventanas de hasta 1.90 m, con un diseño optimizado para la evacuación de agua.', performance: { wind: 3, water: 3, air: 2, sound: 2 } },
            { name: 'Sistema 8025', category: 'Corredizos', description: 'Solución robusta para puertas y ventanas de altura media (hasta 2.10 m), con excelente desempeño acústico.', performance: { wind: 3, water: 3, air: 2, sound: 4 } },
            { name: 'Sistema Monumental 7038', category: 'Corredizos', description: 'Diseñado para grandes vanos (hasta 2.40 m), ideal para uso residencial e institucional de altas especificaciones.', performance: { wind: 4, water: 4, air: 4, sound: 4 } },
            { name: 'Sistema Proyectante 3831', category: 'Proyectantes y Fachadas', description: 'Versátil y hermético, ideal para construcciones residenciales e institucionales. Permite vidrios de hasta 23 mm.', performance: { wind: 2, water: 2, air: 2, sound: 2 } },
            { name: 'Fachada Stick Serie 45', category: 'Proyectantes y Fachadas', description: 'Solución modular para grandes cerramientos arquitectónicos. Máxima eficiencia en instalación con un desempeño superior.', performance: { wind: 5, water: 5, air: 5, sound: 5 } },
            { name: 'Paneles de Aluminio Compuesto', category: 'Revestimientos', description: 'Ligeros, versátiles y de gran durabilidad. La solución ideal para revestimientos interiores y exteriores.', performance: null }
        ],
        projects: [
            { name: 'AVANTI CLUB HOUSE', image: 'https://images.pexels.com/photos/1109541/pexels-photo-1109541.jpeg?auto=compress&cs=tinysrgb&w=600', work: 'Suministro e instalación de ventanería, divisiones de baño, fachada flotante y espejos.', location: 'Bogotá D.C.', builder: 'RESTAURA CONSTRUCTORA' },
            { name: 'HOTEL GRAND SIRENIS', image: 'https://images.pexels.com/photos/261102/pexels-photo-261102.jpeg?auto=compress&cs=tinysrgb&w=600', work: 'Suministro e instalación de ventanería acústica, espejos, divisiones de baño y cortavientos.', location: 'San Andrés Isla', builder: 'HITOS URBANOS' },
            { name: 'EDIFICIO FONTTANA 105', image: 'https://images.pexels.com/photos/271624/pexels-photo-271624.jpeg?auto=compress&cs=tinysrgb&w=600', work: 'Suministro e instalación de ventanería, divisiones de baño, espejos y puertas de vidrio templado.', location: 'Bogotá D.C.', builder: 'CGR CONSTRUCTORES' },
            { name: 'PROYECTO SERENDIPIA', image: 'https://images.pexels.com/photos/1643383/pexels-photo-1643383.jpeg?auto=compress&cs=tinysrgb&w=600', work: 'Suministro e instalación de ventanería y divisiones de baño.', location: 'Bogotá D.C.', builder: 'Fores Formas + Espacios' },
            { name: 'KD SAN FERNANDO', image: 'https://images.pexels.com/photos/276724/pexels-photo-276724.jpeg?auto=compress&cs=tinysrgb&w=600', work: 'Suministro e instalación de ventanería y puertas de vidrio templado.', location: 'Bogotá D.C.', builder: 'KING DAVID SAN FERNANDO' },
            { name: 'CABO VERDE RICAURTE', image: 'https://images.pexels.com/photos/259962/pexels-photo-259962.jpeg?auto=compress&cs=tinysrgb&w=600', work: 'Suministro e instalación de ventanería, divisiones de baño y espejos.', location: 'Ricaurte, Cundinamarca', builder: 'OIKOS CONSTRUCTORA' },
            { name: 'EDIFICIOS CRZ 2-3-4', image: 'https://images.pexels.com/photos/1396122/pexels-photo-1396122.jpeg?auto=compress&cs=tinysrgb&w=600', work: 'Suministro e instalación de ventanería, divisiones de baño, espejos y puertas de vidrio templado.', location: 'Bogotá D.C.', builder: 'CONSTRUCTORA TORRES DE LOS ANDES' },
            { name: 'MONTEBELLO', image: 'https://images.pexels.com/photos/208736/pexels-photo-208736.jpeg?auto=compress&cs=tinysrgb&w=600', work: 'Suministro e instalación de ventanería, divisiones de baño, espejos y puertas de vidrio templado.', location: 'La Calera, Cundinamarca', builder: 'TRAMONTANA CONSTRUCTORA' },
            { name: 'BAHIA SOLERO', image: 'https://images.pexels.com/photos/221024/pexels-photo-221024.jpeg?auto=compress&cs=tinysrgb&w=600', work: 'Suministro e instalación de ventanería, divisiones de baño y espejos.', location: 'Villeta, Cundinamarca', builder: 'OIKOS CONSTRUCTORA' },
            { name: 'CAMINOS DE IGUA', image: 'https://images.pexels.com/photos/210617/pexels-photo-210617.jpeg?auto=compress&cs=tinysrgb&w=600', work: 'Suministro e instalación de ventanería, divisiones de baño y espejos.', location: 'Ricaurte, Cundinamarca', builder: 'URBARK' },
            { name: 'TORRES DAMASCO', image: 'https://images.pexels.com/photos/209296/pexels-photo-209296.jpeg?auto=compress&cs=tinysrgb&w=600', work: 'Suministro e instalación de ventanería, divisiones de baño y espejos.', location: 'Bogotá D.C.', builder: 'PRO. Y CONST. DAMASCO' },
            { name: 'PALMONOVA', image: 'https://images.pexels.com/photos/1571460/pexels-photo-1571460.jpeg?auto=compress&cs=tinysrgb&w=600', work: 'Suministro e instalación de ventanería, divisiones de baño y espejos.', location: 'Villeta, Cundinamarca', builder: 'AMBIENTTI' }
        ],
        clients: [
            { name: 'OIKOS CONSTRUCTORA', logoUrl: 'https://www.oikos.com.co/constructora/images/logo_oikos_constructora.svg' },
            { name: 'AMBIENTTI', logoUrl: 'https://www.ambientti.com.co/wp-content/uploads/2021/11/logo-ambientti-constructora-inmobiliaria.svg' },
            { name: 'CONSTRUCTORA BOLIVAR', logoUrl: 'https://constructorabolivar.com/sites/all/themes/constructorabolivar/logo.png' },
            { name: 'AMARILO', logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/10/Amarilo_logo.svg/2560px-Amarilo_logo.svg.png' },
            { name: 'CGR CONSTRUCTORES', logoUrl: 'https://www.cgrconstructores.com/wp-content/uploads/2020/08/logo-cgr.png' },
            { name: 'TRAMONTANA', logoUrl: 'https://tramontanaconstructora.com/wp-content/uploads/2022/08/logo-tramontana-constructora.svg' },
            { name: 'HITOS URBANOS', logoUrl: 'https://www.hitosurbanos.com/wp-content/uploads/2022/02/logo-hitos-urbanos.svg' },
            { name: 'RESTAURA CONSTRUCTORA', logoUrl: 'https://static.wixstatic.com/media/a4f47c_e63c7bd2587548c3a9d90d562137681c~mv2.png/v1/fill/w_286,h_74,al_c,q_85,usm_0.66_1.00_0.01,enc_auto/RESTAURA%20LOGO%20PNG.png' },
            { name: 'CONSTRUCTORA TORRES DE LOS ANDES', logoUrl: 'https://constructoratorresdelosandes.com/wp-content/uploads/2021/04/LOGO-TORRES-DE-LOS-ANDES_Mesa-de-trabajo-1.png' },
            { name: 'URBARK', logoUrl: 'https://urbark.com.co/wp-content/uploads/2021/08/logo-urbark-constructora.svg' },
            { name: 'DAMASCO', logoUrl: 'https://damascoproyectos.com/wp-content/uploads/2021/08/logo-damasco-proyectos-y-construcciones.svg' },
            { name: 'FORES', logoUrl: 'https://fores.com.co/wp-content/uploads/2023/07/logo-fores-formas-espacios-constructora.svg' }
        ]
    };

    const navLinks = document.querySelectorAll('.nav-link');
    const pages = document.querySelectorAll('.page-content');
    const mobileMenu = document.getElementById('mobile-menu');
    let countersAnimated = false;

    function showPage(pageId) {
        pages.forEach(page => {
            page.classList.add('hidden');
        });
        document.getElementById(`page-${pageId}`).classList.remove('hidden');

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.dataset.target === pageId) {
                link.classList.add('active');
            }
        });

        if (pageId === 'nosotros' && !countersAnimated) {
            const counters = document.querySelectorAll('[data-counter-target]');
            counters.forEach(animateCounter);
            countersAnimated = true;
        }
        
        window.scrollTo(0, 0);
        mobileMenu.classList.add('hidden');
    }

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = link.dataset.target;
            showPage(pageId);
        });
    });
    
    showPage('inicio');

    const servicesGrid = document.getElementById('services-grid');
    data.services.forEach(service => {
        const serviceEl = document.createElement('div');
        serviceEl.className = 'bg-white p-6 rounded-lg shadow-md hover:shadow-xl transition-shadow duration-300 h-full';
        serviceEl.innerHTML = `
            <div class="text-4xl mb-4">${service.icon}</div>
            <h3 class="text-xl font-bold mb-2">${service.title}</h3>
            <p class="text-gray-600">${service.description}</p>
        `;
        servicesGrid.appendChild(serviceEl);
    });
    
    const featuredServicesGrid = document.getElementById('featured-services-grid');
    data.services.slice(0, 3).forEach(service => {
        const serviceEl = document.createElement('div');
        serviceEl.className = 'bg-white p-6 rounded-lg shadow-md h-full';
        serviceEl.innerHTML = `
            <div class="text-4xl mb-4">${service.icon}</div>
            <h3 class="text-xl font-bold mb-2">${service.title}</h3>
            <p class="text-gray-600">${service.description}</p>
        `;
        featuredServicesGrid.appendChild(serviceEl);
    });

    const featuredProjectContainer = document.getElementById('featured-project-container');
    const featuredProject = data.projects[0];
    featuredProjectContainer.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl overflow-hidden md:flex">
            <div class="md:w-1/2">
                <img src="${featuredProject.image}" alt="${featuredProject.name}" class="w-full h-64 md:h-full object-cover">
            </div>
            <div class="p-8 md:w-1/2 flex flex-col justify-center">
                <h3 class="font-bold text-2xl mb-2">${featuredProject.name}</h3>
                <p class="text-sm text-gray-500 mb-4">${featuredProject.builder}</p>
                <p class="text-gray-700 mb-4">${featuredProject.work}</p>
                <p class="text-gray-600"><span class="font-semibold">Ubicación:</span> ${featuredProject.location}</p>
            </div>
        </div>
    `;


    const systemsGrid = document.getElementById('systems-grid');
    const filterBtns = document.querySelectorAll('.filter-btn');
    let chartInstance = null;

    function renderSystems(filter = 'all') {
        systemsGrid.innerHTML = '';
        const filteredSystems = filter === 'all' ? data.systems : data.systems.filter(s => s.category === filter);
        
        filteredSystems.forEach((system) => {
            const systemEl = document.createElement('div');
            systemEl.className = 'bg-gray-100 p-6 rounded-lg shadow-md flex flex-col';
            systemEl.innerHTML = `
                <h3 class="text-xl font-bold mb-2">${system.name}</h3>
                <p class="text-gray-600 flex-grow">${system.description}</p>
                ${system.performance ? `<button class="details-btn mt-4 bg-blue-600 text-white px-4 py-2 rounded-full hover:bg-blue-700 transition-colors w-full" data-name="${system.name}">Ver Detalles</button>` : ''}
            `;
            systemsGrid.appendChild(systemEl);
        });
        
        document.querySelectorAll('.details-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const systemName = this.dataset.name;
                const system = data.systems.find(s => s.name === systemName);
                
                const modalBody = document.getElementById('modal-body');
                modalBody.innerHTML = `
                    <h3 class="text-2xl font-bold mb-2">${system.name}</h3>
                    <p class="text-gray-600 mb-6">${system.description}</p>
                    <div class="chart-container">
                        <canvas id="performanceChart"></canvas>
                    </div>
                `;
                openModal();

                const ctx = document.getElementById('performanceChart').getContext('2d');
                if (chartInstance) chartInstance.destroy();
                chartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: ['Resistencia al Viento', 'Estanqueidad al Agua', 'Impermeabilidad al Aire', 'Reducción Acústica'],
                        datasets: [{
                            label: 'Nivel de Desempeño (de 5)',
                            data: [system.performance.wind, system.performance.water, system.performance.air, system.performance.sound],
                            backgroundColor: ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'],
                            borderColor: '#1e40af',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                        scales: { x: { beginAtZero: true, max: 5, grid: { display: false } }, y: { grid: { display: false } } },
                        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` Nivel: ${c.raw}` } } }
                    }
                });
            });
        });
    }

    filterBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            filterBtns.forEach(b => b.classList.replace('bg-blue-600', 'bg-gray-200') || b.classList.replace('text-white', 'text-gray-700'));
            this.classList.replace('bg-gray-200', 'bg-blue-600');
            this.classList.replace('text-gray-700', 'text-white');
            renderSystems(this.dataset.filter);
        });
    });

    const projectsGrid = document.getElementById('projects-grid');
    data.projects.forEach((project) => {
        const projectEl = document.createElement('div');
        projectEl.className = 'bg-white rounded-lg shadow-lg overflow-hidden cursor-pointer group';
        projectEl.innerHTML = `
            <div class="relative"><img src="${project.image}" alt="${project.name}" class="w-full h-48 object-cover group-hover:scale-110 transition-transform duration-300"><div class="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300"><span class="text-white text-lg font-bold">Ver Proyecto</span></div></div>
            <div class="p-4"><h3 class="font-bold text-lg">${project.name}</h3><p class="text-sm text-gray-500">${project.builder}</p></div>
        `;
        projectEl.addEventListener('click', () => {
            const modalBody = document.getElementById('modal-body');
            modalBody.innerHTML = `<img src="${project.image}" alt="${project.name}" class="w-full h-64 object-cover rounded-lg mb-4"><h3 class="text-2xl font-bold mb-2">${project.name}</h3><p class="text-gray-600 mb-1"><span class="font-semibold">Ubicación:</span> ${project.location}</p><p class="text-gray-600 mb-4"><span class="font-semibold">Constructor:</span> ${project.builder}</p><p class="text-gray-800"><span class="font-semibold">Trabajo Realizado:</span> ${project.work}</p>`;
            openModal();
        });
        projectsGrid.appendChild(projectEl);
    });

    const logoContainer = document.getElementById('logo-container');
    const allClientsForTicker = [...data.clients, ...data.clients]; 
    logoContainer.innerHTML = '';
    allClientsForTicker.forEach(client => {
        const logoEl = document.createElement('div');
        logoEl.className = 'flex-shrink-0 mx-8 flex items-center justify-center h-20 client-logo';
        logoEl.innerHTML = `<img src="${client.logoUrl}" alt="${client.name}" class="max-h-16 w-auto object-contain" onerror="this.style.display='none'; this.parentElement.innerHTML='<p class=\\'text-gray-400 text-sm\\'>${client.name}</p>';">`;
        logoContainer.appendChild(logoEl);
    });

    const modal = document.getElementById('modal');
    const modalClose = document.getElementById('modal-close');
    function openModal() { modal.classList.remove('hidden'); }
    function closeModal() { modal.classList.add('hidden'); }
    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    function animateCounter(el) {
        const target = +el.dataset.counterTarget;
        let current = 0;
        const increment = target / 100;
        function updateCounter() {
            if (current < target) {
                current += increment;
                let displayValue = Math.ceil(current);
                if (el.id === 'pro-counter') {
                    el.innerText = '+' + displayValue;
                } else {
                    el.innerText = displayValue;
                }
                requestAnimationFrame(updateCounter);
            } else {
                if (el.id === 'pro-counter') {
                    el.innerText = '+' + target;
                } else {
                    el.innerText = target;
                }
            }
        }
        updateCounter();
    }

    const mobileMenuButton = document.getElementById('mobile-menu-button');
    mobileMenuButton.addEventListener('click', () => {
        mobileMenu.classList.toggle('hidden');
    });
    
    renderSystems();
    
    // AI Advisor Logic
    const aiAdvisorModal = document.getElementById('ai-advisor-modal');
    const openAiAdvisorBtn = document.getElementById('open-ai-advisor-btn');
    const closeAiAdvisorBtn = document.getElementById('ai-advisor-modal-close');
    const getRecommendationBtn = document.getElementById('get-recommendation-btn');
    const projectDescription = document.getElementById('project-description');
    const aiResultContainer = document.getElementById('ai-result-container');
    const aiLoading = document.getElementById('ai-loading');
    const aiResult = document.getElementById('ai-result');

    openAiAdvisorBtn.addEventListener('click', () => aiAdvisorModal.classList.remove('hidden'));
    closeAiAdvisorBtn.addEventListener('click', () => aiAdvisorModal.classList.add('hidden'));
    aiAdvisorModal.addEventListener('click', (e) => {
        if (e.target === aiAdvisorModal) aiAdvisorModal.classList.add('hidden');
    });

    getRecommendationBtn.addEventListener('click', async () => {
        const description = projectDescription.value;
        if (!description.trim()) {
            aiResult.innerHTML = '<p class="text-red-500">Por favor, describa su proyecto.</p>';
            return;
        }

        aiLoading.classList.remove('hidden');
        aiResult.classList.add('hidden');
        getRecommendationBtn.disabled = true;

        const systemsInfo = data.systems.map(s => {
            let info = `Sistema: ${s.name} (Categoría: ${s.category}). Descripción: ${s.description}.`;
            if (s.performance) {
                info += ` Desempeño (1-5): Viento=${s.performance.wind}, Agua=${s.performance.water}, Aire=${s.performance.air}, Acústica=${s.performance.sound}.`;
            }
            return info;
        }).join('\n');

        const prompt = `
            Eres un asistente experto para "Vidrios Exito S.A.S.", una empresa colombiana proveedora de sistemas de aluminio y vidrio para construcción.
            Un cliente ha descrito su proyecto. Tu tarea es analizar su necesidad y recomendar los sistemas más adecuados de la siguiente lista.
            Justifica brevemente por qué cada sistema es una buena opción para el cliente. Sé amable y profesional.

            Lista de Sistemas Disponibles:
            ${systemsInfo}

            Descripción del Proyecto del Cliente:
            "${description}"

            Tu recomendación:
        `;

        try {
            let chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
            const payload = { contents: chatHistory };
            const apiKey = ""; 
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Error de API: ${response.statusText}`);
            }

            const result = await response.json();
            
            if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                aiResult.innerHTML = text.replace(/\n/g, '<br>');
            } else {
                throw new Error("Respuesta inesperada de la API.");
            }

        } catch (error) {
            aiResult.innerHTML = `<p class="text-red-500">Lo sentimos, ha ocurrido un error al generar la recomendación. Por favor, intente de nuevo más tarde.</p><p class="text-xs text-gray-500 mt-2">${error.message}</p>`;
        } finally {
            aiLoading.classList.add('hidden');
            aiResult.classList.remove('hidden');
            getRecommendationBtn.disabled = false;
        }
    });

    const contactForm = document.getElementById('contact-form');
    const formFeedback = document.getElementById('form-feedback');
    contactForm.addEventListener('submit', (e) => {
        e.preventDefault();
        formFeedback.innerHTML = '<p class="text-green-600">¡Gracias! Su mensaje ha sido enviado. Nos pondremos en contacto pronto.</p>';
        contactForm.reset();
        setTimeout(() => {
            formFeedback.innerHTML = '';
        }, 5000);
    });
});
