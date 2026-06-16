/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warmer Terrakotta-Akzent (Primärfarbe der Oberfläche).
        primary: {
          50: "#fbf4f0",
          100: "#f6e4d9",
          200: "#eac6b1",
          300: "#dda588",
          400: "#cf7d58",
          500: "#c66a45",
          600: "#c2603f",
          700: "#a44b30",
          800: "#87402a",
          900: "#6e3626",
        },
      },
    },
  },
  plugins: [],
};
