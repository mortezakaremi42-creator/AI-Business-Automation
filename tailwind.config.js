/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/client/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'Tahoma', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        phantom: {
          DEFAULT: '#AB9FF2',
          dark: '#7C66DC',
          deep: '#1C1829',
        },
        solana: {
          green: '#14F195',
          purple: '#9945FF',
          cyan: '#00C2FF',
        },
      },
    },
  },
  plugins: [],
};
