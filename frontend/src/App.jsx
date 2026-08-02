import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './pages/LoginPage.jsx'
import InstanceListPage from './pages/InstanceListPage.jsx'
import InstanceDetailPage from './pages/InstanceDetailPage.jsx'
import DelegationPage from './pages/DelegationPage.jsx'
import AnalyticsPage from './pages/AnalyticsPage.jsx'
import ProcessDiagramPage from './pages/ProcessDiagramPage.jsx'
import UserManagementPage from './pages/UserManagementPage.jsx'
import DefinitionPermissionsPage from './pages/DefinitionPermissionsPage.jsx'
import ProcessDesignerPage from './pages/ProcessDesignerPage.jsx'
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

      {/* Süreç Şeması (4.1 görünümü) — korumalı, ortak layout içinde. */}
      <Route
        path="/diagram"
        element={
          <ProtectedRoute>
            <AppLayout>
              <ProcessDiagramPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* Rol/Yetki Yönetimi — korumalı, ortak layout içinde. Erişim kısıtı (staff/superuser)
          menüde değil, sayfanın kendisinde: backend 403 dönerse UserManagementPage uyarı gösterir. */}
      <Route
        path="/users"
        element={
          <ProtectedRoute>
            <AppLayout>
              <UserManagementPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* Süreç Başlatma Yetkileri (grup x süreç matrisi) — korumalı, ortak layout içinde.
          Erişim kısıtı (staff/superuser) sayfanın kendisinde: backend 403 dönerse
          DefinitionPermissionsPage uyarı gösterir (UserManagementPage'deki aynı desen). */}
      <Route
        path="/definition-permissions"
        element={
          <ProtectedRoute>
            <AppLayout>
              <DefinitionPermissionsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* Süreç Tasarla (1.2, react-flow tabanlı editör) — korumalı, ortak layout içinde.
          Erişim kısıtı (staff/superuser) sayfanın kendisinde: backend admin uçları 403
          dönerse ProcessDesignerPage uyarı gösterir (aynı desen). ProcessDiagramPage
          (salt okuma, /diagram) TAMAMEN AYRI — bu route ona dokunmaz. */}
      <Route
        path="/process-designer"
        element={
          <ProtectedRoute>
            <AppLayout>
              <ProcessDesignerPage />
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
