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
        background: '#0C1219',
        surface: {
          DEFAULT: '#131D27',
          raised: '#1C2A37',
        },
        border: {
          DEFAULT: '#384959',
          subtle: '#263440',
        },
        accent: {
          DEFAULT: '#7DE0C7',
          hover: '#A3EBD9',
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
