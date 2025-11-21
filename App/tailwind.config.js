/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./js/app.js",
    "./js/cartera.js",
    "./js/configuracion.js",
    "./js/dashboard.js",
    "./js/dotacion.js",
    "./js/empleados.js",
    "./js/solicitudes.js", 
    "./js/herramientas.js" // <-- Asegúrate que esta línea esté
  ],
  theme: {
    extend: {
      // --- INICIO DE MODIFICACIÓN ---
      // Añade este bloque para crear la clase z-60
      zIndex: {
        '60': '60',
      },
      // --- FIN DE MODIFICACIÓN ---
      aspectRatio: {
        '1': '1',
        'square': '1 / 1',
      }
    },
  },
  plugins: [
    require('@tailwindcss/aspect-ratio'), // <-- Asegúrate que esta línea esté
  ],
}