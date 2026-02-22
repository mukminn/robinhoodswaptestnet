/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0f19',
      },
      boxShadow: {
        card: '0 30px 80px rgba(0,0,0,0.45)',
      },
    },
  },
  plugins: [],
}
