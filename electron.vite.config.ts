import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(projectRoot, 'out/main')
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(projectRoot, 'out/preload')
    }
  },
  renderer: {
    root: resolve(projectRoot, 'src/renderer'),
    resolve: {
      // Prefer source TypeScript modules over checked-in transpiled .js snapshots.
      extensions: ['.ts', '.tsx', '.mjs', '.js', '.mts', '.jsx', '.json']
    },
    plugins: [vue(), UnoCSS()],
    build: {
      outDir: resolve(projectRoot, 'out/renderer')
    }
  }
})
