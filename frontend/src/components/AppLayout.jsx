import { useNavigate } from 'react-router-dom'
import { Button, Layout, Typography } from 'antd'
import { LogoutOutlined } from '@ant-design/icons'
import { logout } from '../api.js'

const { Header, Content } = Layout
const { Title } = Typography

// Giriş sonrası ortak sayfa iskeleti: üstte header (başlık + çıkış), altında içerik.
// children: sayfaya özel içerik (liste, detay vb.) buraya gelir.
function AppLayout({ children }) {
  const navigate = useNavigate()

  // Çıkış: yerel token'ları sil (api.js logout) ve giriş ekranına dön.
  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Koyu header; içindeki metin/ikonlar açık renk okunur. */}
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#001529',
        }}
      >
        {/* Solda: uygulama başlığı (beyaz metin). */}
        <Title level={4} style={{ color: '#fff', margin: 0 }}>
          İş Akışı Modülü
        </Title>

        {/* Sağda: çıkış butonu. */}
        <Button icon={<LogoutOutlined />} onClick={handleLogout}>
          Çıkış
        </Button>
      </Header>

      {/* İçerik: ortalanmış, maxWidth ~1100px, padding'li kapsayıcı. */}
      <Content style={{ padding: 24 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>{children}</div>
      </Content>
    </Layout>
  )
}

export default AppLayout
