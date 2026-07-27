import { useNavigate } from 'react-router-dom'
import { Button, Layout, Space, Typography } from 'antd'
import { DeploymentUnitOutlined, LogoutOutlined } from '@ant-design/icons'
import { logout } from '../api.js'

const { Header, Content } = Layout
const { Title } = Typography

// Giriş sonrası ortak sayfa iskeleti: üstte marka header'ı, altında içerik.
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
      {/* Header arka planı temadan gelir (Layout.headerBg = #0f2540). Hafif gölge = derinlik. */}
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          // İçerikle aynı yatay kenar boşluğu (hizalı görünsün).
          padding: '0 40px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        }}
      >
        {/* Solda: marka (ikon + metin), beyaz ve hizalı. */}
        <Space size="small">
          <DeploymentUnitOutlined style={{ fontSize: 22, color: '#fff' }} />
          <Title level={4} style={{ color: '#fff', margin: 0, fontWeight: 600 }}>
            İş Akışı Modülü
          </Title>
        </Space>

        {/* Sağda: çıkış butonu — koyu header üzerinde okunaklı beyaz metin (type text). */}
        <Button
          type="text"
          icon={<LogoutOutlined />}
          onClick={handleLogout}
          style={{ color: '#fff' }}
        >
          Çıkış
        </Button>
      </Header>

      {/* İçerik: tam genişlik (maxWidth kısıtı yok); yalnızca kenarlarda nefes payı. */}
      <Content style={{ padding: '24px 40px' }}>{children}</Content>
    </Layout>
  )
}

export default AppLayout
