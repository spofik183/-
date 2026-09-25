/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: '#176B4D',
        leaf: '#31B675',
        lime: '#B7E36A',
        paper: '#F7F5ED',
        ink: '#17352B',
      },
      boxShadow: { soft: '0 12px 36px rgba(23, 53, 43, .10)' },
    },
  },
  plugins: [],
}
