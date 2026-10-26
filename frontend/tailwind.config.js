/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        navy: { 50: '#EEF3F9', 100: '#D6E2F0', 200: '#AFC5E1', 500: '#1E4D80', 600: '#173E68', 700: '#123254', 800: '#0E2742', 900: '#0B1F35' },
        brand: { 50: '#ECFDF3', 100: '#D1FADF', 500: '#16A34A', 600: '#15803D', 700: '#166534' },
        surface: 'var(--surface)',
        card: 'var(--card)',
        line: 'var(--line)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
      },
      fontSize: { base: ['16px', '24px'] },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
}
