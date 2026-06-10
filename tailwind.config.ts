import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#10141a',
        'surface-0': '#0a0e14',
        'surface-1': '#181c22',
        'surface-2': '#1c2026',
        'surface-3': '#262a31',
        'surface-4': '#31353c',
        ink: '#dfe2eb',
        'ink-dim': '#b9caca',
        'ink-mute': '#849495',
        outline: '#3a494a',
        'outline-strong': '#6E7681',
        primary: '#00f5ff',
        'primary-dim': '#00dce5',
        'on-primary': '#003739',
        secondary: '#00ffab',
        'secondary-dim': '#00e297',
        error: '#ffb4ab',
        'error-strong': '#93000a',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        'display-lg': ['32px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-md': ['20px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body-md': ['14px', { lineHeight: '20px' }],
        'body-sm': ['12px', { lineHeight: '18px' }],
        'code-md': ['13px', { lineHeight: '20px' }],
        'code-sm': ['11px', { lineHeight: '16px' }],
        'label-caps': ['11px', { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '600' }],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '2px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },
      keyframes: {
        'toast-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '15%': { opacity: '1', transform: 'translateY(0)' },
          '85%': { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(-4px)' },
        },
      },
      animation: {
        // Total duration is roughly matched to the JS-side toast TTLs in
        // ShareButton (success: 2400ms, fallback: 3200ms, error: 3600ms).
        // The 2.4s value here covers the success case smoothly; the longer
        // toasts simply stay at 100% opacity past the animation end, which
        // looks fine.
        'toast-in': 'toast-in 2400ms ease-out forwards',
      },
    },
  },
  plugins: [],
};

export default config;
