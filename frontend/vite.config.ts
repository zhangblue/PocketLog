import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    ...(mode === 'development' ? {
      server: {
        proxy: {
          '/api': { target: env.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:3000', changeOrigin: true },
          '/health': { target: env.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:3000', changeOrigin: true },
        },
      },
    } : {}),
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        include: ['src/app/**/*.{ts,tsx}', 'src/domain/**/*.{ts,tsx}'],
        thresholds: { lines: 90, perFile: true },
      },
    },
  }
})
