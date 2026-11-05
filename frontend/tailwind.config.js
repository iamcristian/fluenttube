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
        background: 'rgb(var(--rgb-bg-base) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--rgb-bg-surface) / <alpha-value>)',
          raised: 'rgb(var(--rgb-bg-surface-raised) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--rgb-border) / <alpha-value>)',
          subtle: 'rgb(var(--rgb-border-subtle) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--rgb-accent) / <alpha-value>)',
          hover: 'rgb(var(--rgb-accent-hover) / <alpha-value>)',
        },
        primary: {
          500: 'rgb(var(--rgb-accent) / <alpha-value>)',
          600: 'rgb(var(--rgb-accent-hover) / <alpha-value>)',
        },
        success: 'rgb(var(--rgb-success) / <alpha-value>)',
        warning: 'rgb(var(--rgb-warning) / <alpha-value>)',
        danger: 'rgb(var(--rgb-danger) / <alpha-value>)',
        'text-primary': 'rgb(var(--rgb-text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--rgb-text-secondary) / <alpha-value>)',
        'text-muted': 'rgb(var(--rgb-text-muted) / <alpha-value>)',
      },
      borderRadius: {
        control: 'var(--radius-control)',
        panel: 'var(--radius-panel)',
        xl: '12px',
        '2xl': '14px',
        '3xl': '16px',
      },
    },
  },
  plugins: [],
}
