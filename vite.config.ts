import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000', changeOrigin: false }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173
  }
})
