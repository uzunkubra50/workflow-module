import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Docker container içinden host'a erişilebilsin diye tüm arayüzlerde dinle
    // (varsayılan sadece container'ın kendi loopback'inde dinler, dışarıdan görünmez).
    host: true,
    watch: {
      // Docker Desktop (Windows) bind-mount'larında native dosya sistemi olayları
      // (inotify) container'a ulaşmayabiliyor — host'ta yapılan değişiklik container
      // içindeki Vite'a hiç bildirilmiyor, dev server eski dosyayı sunmaya devam
      // ediyor. Polling, container'ın dosyaları periyodik olarak kendisi kontrol
      // etmesini sağlayarak bu senkronizasyon sorununu kalıcı çözer.
      usePolling: true,
    },
  },
})
