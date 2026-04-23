/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#0f1115',
          800: '#161921',
          700: '#20242f',
          600: '#2c3140',
        },
        brand: {
          DEFAULT: '#3b82f6',
          dark: '#1d4ed8',
        }
      }
    },
  },
  plugins: [],
}
