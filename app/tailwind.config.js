/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // KIZUNA 2026 / TWIZA palette: 70 % light neutrals, 20 % ink, 10 % red; green / teal only for data
        brand: '#B5121B', // vermilion red
        blush: '#E9C9CD',
        plane: '#F7F6F3', // rice paper
        panel: '#FFFFFF',
        panel2: '#F1EFEA',
        line: '#DEDBD4',
        ink: '#171717', // ink black
        ink2: '#45423E',
        mute: '#6F6B66', // warm gray, darkened for text contrast
        // data colours
        s1: '#1C7A89', // water teal
        s2: '#B5121B',
        s3: '#8A8580', // warm gray
        s4: '#C77700',
        s7: '#171717',
        good: '#37795D', // oasis green
        warn: '#C77700',
        serious: '#D0575E',
        crit: '#B5121B',
        // farmer app
        sand: '#F7F6F3',
        palm: '#1C7A89',
        oasis: '#37795D',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Tajawal', 'sans-serif'],
        ar: ['Tajawal', 'Noto Sans Arabic', 'Tahoma', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
