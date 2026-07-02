/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b1020',
        panel: '#141a2e',
        edge: '#222a44',
        accent: '#5b8cff',
        active: '#ffcc4d',
      },
    },
  },
  plugins: [],
};
