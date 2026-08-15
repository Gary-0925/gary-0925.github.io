import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset URLs work both at / and at a GitHub Pages project path.
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
})
