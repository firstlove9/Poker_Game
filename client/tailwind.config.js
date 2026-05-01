/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 扑克桌配色
        'poker-green': {
          DEFAULT: '#1B4D3E',
          light: '#2D5A4A',
          dark: '#123D30',
        },
        'poker-felt': '#0F3D2E',
        // 筹码颜色
        'chip-white': '#F5F5F5',
        'chip-red': '#E74C3C',
        'chip-blue': '#3498DB',
        'chip-green': '#27AE60',
        'chip-black': '#2C3E50',
        'chip-purple': '#9B59B6',
        'chip-yellow': '#F1C40F',
        // 强调色
        'gold': {
          DEFAULT: '#FFD700',
          light: '#FFE55C',
          dark: '#D4AF37',
        },
      },
      fontFamily: {
        'casino': ['Georgia', 'serif'],
        'digital': ['Courier New', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
        'shine': 'shine 2s linear infinite',
      },
      keyframes: {
        shine: {
          '0%': { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
      },
    },
  },
  plugins: [],
}
