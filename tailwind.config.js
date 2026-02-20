/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}', './index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#000000',
          1: '#0a0a0a',
          2: '#141414',
          3: '#1c1c1e',
          4: '#2c2c2e',
          5: '#3a3a3c',
          glass: 'rgba(255,255,255,0.04)',
          'glass-hover': 'rgba(255,255,255,0.07)',
          'glass-active': 'rgba(255,255,255,0.10)',
          'glass-border': 'rgba(255,255,255,0.08)',
          'glass-border-hover': 'rgba(255,255,255,0.14)',
        },
        label: {
          primary: '#ffffff',
          secondary: '#c5c5ca',
          tertiary: '#a0a0a5',
          quaternary: '#7c7c80',
        },
        accent: {
          DEFAULT: '#ffffff',
          hover: '#DDDDDD',
          subtle: 'rgba(42, 149, 255, 0.49)',
          glow: 'rgba(10,132,255,0.25)',
        },
        semantic: {
          success: '#30D158',
          'success-subtle': 'rgba(48,209,88,0.12)',
          warning: '#FF9F0A',
          'warning-subtle': 'rgba(255,159,10,0.12)',
          error: '#FF453A',
          'error-subtle': 'rgba(255,69,58,0.12)',
          info: '#64D2FF',
          'info-subtle': 'rgba(100,210,255,0.12)',
          purple: '#BF5AF2',
          'purple-subtle': 'rgba(191,90,242,0.12)',
        },
      },
      fontFamily: {
        sans: ['"DM Sans Variable"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        display: ['"Syne"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '20px',
        '4xl': '24px',
      },
      boxShadow: {
        'glass': '0 0 0 1px rgba(255,255,255,0.06), 0 8px 40px rgba(0,0,0,0.4)',
        'glass-sm': '0 0 0 1px rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.3)',
        'glass-lg': '0 0 0 1px rgba(255,255,255,0.06), 0 24px 80px rgba(0,0,0,0.6)',
        'glow-accent': '0 0 20px rgba(10,132,255,0.3)',
        'glow-success': '0 0 12px rgba(48,209,88,0.3)',
        'inner-light': 'inset 0 1px 0 rgba(255,255,255,0.06)',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'slide-up': 'slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fade-in 0.3s ease-out',
        'scale-in': 'scale-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'progress-flow': 'progress-flow 1.5s linear infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.97)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'progress-flow': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      backdropBlur: {
        'glass': '40px',
      },
      transitionTimingFunction: {
        'apple': 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        'apple-spring': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
