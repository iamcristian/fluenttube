/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0B1120',
        surface: {
          DEFAULT: '#111B2E',
          raised: '#172338',
        },
        border: {
          DEFAULT: '#344256',
          subtle: '#232F42',
        },
        accent: {
          DEFAULT: '#38BDF8',
          hover: '#0EA5E9',
        },
        primary: {
          500: '#38BDF8',
          600: '#0EA5E9',
        },
        success: '#34D399',
        warning: '#FBBF24',
        danger: '#FB7185',
        'text-primary': '#F1F5F9',
        'text-secondary': '#B6C3D6',
      },
      borderRadius: {
        control: '12px',
        panel: '16px',
      },
    },
  },
  plugins: [],
}
