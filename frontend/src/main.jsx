import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import trTR from 'antd/locale/tr_TR'
import 'antd/dist/reset.css' // Ant Design CSS reset — tarayıcı varsayılan stillerini sıfırlar
import './index.css'
import App from './App.jsx'

// ConfigProvider: Ant Design'ın genel ayarları.
// - locale={trTR}: bileşen metinleri Türkçe (tablo "veri yok", tarih seçici, onay vb.).
// - theme.token.colorPrimary: kurumsal birincil renk (antd varsayılanı zaten #1677ff;
//   burada açıkça belirtiyoruz ki ileride tek yerden değiştirilebilsin).
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ConfigProvider locale={trTR} theme={{ token: { colorPrimary: '#1677ff' } }}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </StrictMode>,
)
