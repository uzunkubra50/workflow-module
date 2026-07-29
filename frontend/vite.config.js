import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Docker container içinden host'a erişilebilsin diye tüm arayüzlerde dinle
    // (varsayılan sadece container'ın kendi loopback'inde dinler, dışarıdan görünmez).
    host: true,
  },
})
