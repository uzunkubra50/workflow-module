import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import trTR from 'antd/locale/tr_TR'
import 'antd/dist/reset.css' // Ant Design CSS reset — tarayıcı varsayılan stillerini sıfırlar
import './index.css'
import App from './App.jsx'

// ConfigProvider: Ant Design'ın genel ayarları (locale + tema).
// - locale={trTR}: bileşen metinleri Türkçe.
// - Tema kurumsal lacivert üzerine kurulu; tüm bileşenler bu token'ları devralır.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ConfigProvider
      locale={trTR}
      theme={{
        token: {
          colorPrimary: '#1e3a5f', // kurumsal lacivert — birincil renk (butonlar, linkler)
          borderRadius: 8, // hafif yuvarlak köşeler — modern his
          fontSize: 14,
          colorBgLayout: '#f0f2f5', // sayfa/layout arka planı: hafif gri
        },
        components: {
          // Header: lacivertin koyu tonu (eski sabit #001529 yerine temayla uyumlu).
          Layout: { headerBg: '#0f2540' },
          // Kartlar biraz daha yuvarlak (daha yumuşak görünüm).
          Card: { borderRadiusLG: 12 },
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </StrictMode>,
)
