import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0A0A0B',
        surface: '#141416',
        border: '#2A2A2E',
        foreground: '#E8E8EC',
        muted: '#8A8A94',
        accent: '#6C5CE7',
        success: '#00D68F',
        warning: '#FFAA00',
        danger: '#FF4757',
      },
    },
  },
  plugins: [],
}
export default config
