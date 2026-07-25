/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Salbei-/Türkis-Grün des BilderBuch-Logos (Primärfarbe der Oberfläche).
        primary: {
          50: "#eef6f2",
          100: "#d7ebe2",
          200: "#b1d7c8",
          300: "#8bbfac",
          400: "#62a68d",
          500: "#4a917a",
          600: "#3f8070",
          700: "#356757",
          800: "#2d5348",
          900: "#27453c",
        },
        // Tiefes Navy des Logos (für dunkle Flächen/Akzente).
        ink: {
          DEFAULT: "#1e2b34",
          light: "#283a45",
        },
      },
    },
  },
  plugins: [],
};
