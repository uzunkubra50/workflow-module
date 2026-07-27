import { Navigate } from 'react-router-dom'

// Korumalı route sarmalayıcısı: yalnızca giriş yapmış kullanıcıya children'ı gösterir.
function ProtectedRoute({ children }) {
  // Giriş yapılmış mı? localStorage'da access_token varlığına bakarız.
  const isAuthenticated = Boolean(localStorage.getItem('access_token'))

  if (!isAuthenticated) {
    // Token yoksa giriş ekranına yönlendir.
    // replace: geçmişe /login eklenmez, geri tuşu koruma döngüsüne girmez.
    return <Navigate to="/login" replace />
  }

  // Token varsa korunan içeriği göster.
  return children
}

export default ProtectedRoute
