/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // <--- AGREGAR ESTA LÍNEA
  content: [
    "./index.html",
    "./js/**/*.js" // <--- ¡Asegúrate de tener esta línea!
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