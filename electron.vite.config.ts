import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), 'wechat-records-process': resolve('src/main/wechat-records-process.ts') } } },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
})
