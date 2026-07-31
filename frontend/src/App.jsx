import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './pages/LoginPage.jsx'
import InstanceListPage from './pages/InstanceListPage.jsx'
import InstanceDetailPage from './pages/InstanceDetailPage.jsx'
import DelegationPage from './pages/DelegationPage.jsx'
import AnalyticsPage from './pages/AnalyticsPage.jsx'
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

      {/* 2.2 İş Akışı Detayı + 2.3 İşlem Geçmişi — korumalı, ortak layout içinde. */}
      <Route
        path="/instances/:id"
        element={
          <ProtectedRoute>
            <AppLayout>
              <InstanceDetailPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* Vekaletlerim — korumalı, ortak layout içinde. */}
      <Route
        path="/delegations"
        element={
          <ProtectedRoute>
            <AppLayout>
              <DelegationPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* Panom (Faz 2 analitik) — korumalı, ortak layout içinde. */}
      <Route
        path="/analytics"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AnalyticsPage />
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
