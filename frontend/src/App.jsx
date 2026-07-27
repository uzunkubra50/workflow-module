import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './pages/LoginPage.jsx'
import InstanceListPage from './pages/InstanceListPage.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import AppLayout from './components/AppLayout.jsx'

// Uygulamanın route (yol) yapısı.
function App() {
  return (
    <Routes>
      {/* Herkese açık: giriş ekranı. AppLayout KULLANMAZ (login'de header/çıkış olmamalı). */}
      <Route path="/login" element={<LoginPage />} />

      {/* 2.1 İş Akışlarım (Liste) — korumalı, ortak layout içinde. */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout>
              <InstanceListPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* 2.2 İş Akışı Detayı — şimdilik placeholder; asıl ekran sonraki adım.
          Route buradan kırılmasın diye ekli. */}
      <Route
        path="/instances/:id"
        element={
          <ProtectedRoute>
            <AppLayout>
              <h1>Detay yakında</h1>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* Bilinmeyen adresler ana sayfaya yönlensin. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
