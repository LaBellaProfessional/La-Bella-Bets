/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        fundo: '#0d0f14',
        card: '#161a22',
        borda: '#242a36',
        t1: '#e8eaed',
        t2: '#9aa3b2',
        t3: '#5c6575',
        verde: '#1a9e5f',
        vermelho: '#d94040',
        ambar: '#c47d10',
        azul: '#29b8e0',
        rosa: '#f0357a',
        roxo: '#8b5cf6',
        laranja: '#e8843c',
      },
    },
  },
  plugins: [],
};
