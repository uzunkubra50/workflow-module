import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Breadcrumb, Dropdown, Layout, Menu, Typography } from 'antd'
import {
  DeploymentUnitOutlined,
  LogoutOutlined,
  SwapOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { logout } from '../api.js'

const { Sider, Header, Content } = Layout
const { Text } = Typography

// Kurumsal lacivert — Sider/Menu/marka alanının ortak zemin rengi.
const NAVY = '#0f2540'

const menuItems = [
  {
    key: '/',
    icon: <UnorderedListOutlined />,
    label: <Link to="/">İş Akışlarım</Link>,
  },
  {
    key: '/delegations',
    icon: <SwapOutlined />,
    label: <Link to="/delegations">Vekalet</Link>,
  },
]

// URL yoluna göre breadcrumb öğelerini üretir.
function getBreadcrumbItems(pathname) {
  if (pathname.startsWith('/instances/')) {
    return [{ title: <Link to="/">İş Akışlarım</Link> }, { title: 'İş Detayı' }]
  }
  if (pathname.startsWith('/delegations')) {
    return [{ title: 'Vekaletlerim' }]
  }
  return [{ title: 'İş Akışlarım' }]
}

// Giriş sonrası ortak sayfa iskeleti: sol sidebar (marka + menü) + dar üst header
// (breadcrumb + kullanıcı avatarı) + içerik. children: sayfaya özel içerik (liste, detay vb.).
function AppLayout({ children }) {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // Çıkış: yerel token'ları (+ kullanıcı adını, api.js logout) sil ve giriş ekranına dön.
  function handleLogout() {
    logout()
    navigate('/login')
  }

  // Avatar dropdown'ında göstermek için — login sırasında api.js tarafından kaydedildi.
  const username = localStorage.getItem('username')

  const userMenuItems = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Çıkış Yap',
      onClick: handleLogout,
    },
  ]

  const breadcrumbItems = getBreadcrumbItems(location.pathname)

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Sol sidebar: marka + menü. collapsible=true -> antd'nin varsayılan daralt/genişlet
          oku Sider'ın alt köşesinde otomatik belirir, ayrıca özel bir trigger yazmaya gerek yok. */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={240}
        collapsedWidth={80}
        theme="dark"
        style={{ background: NAVY }}
      >
        {/* Marka alanı: daraltılınca sadece ikon kalır. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 10,
            height: 56,
            padding: collapsed ? 0 : '0 20px',
            color: '#fff',
            fontWeight: 600,
            fontSize: 16,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          <DeploymentUnitOutlined style={{ fontSize: 22, flexShrink: 0 }} />
          {!collapsed && <span>İş Akışı Modülü</span>}
        </div>

        <Menu
          theme="dark"
          mode="inline"
          // Hangi sayfadaysak o menü seçili görünsün (/instances detay sayfaları da '/' altında vurgulanır).
          selectedKeys={[location.pathname.startsWith('/delegations') ? '/delegations' : '/']}
          items={menuItems}
          style={{ background: NAVY }}
        />
      </Sider>

      <Layout>
        {/* Üst header: dar, açık renk — marka artık Sider'da olduğu için burada yok. */}
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#fff',
            padding: '0 24px',
            height: 56,
            lineHeight: '56px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
          }}
        >
          {/* Solda: breadcrumb (mevcut sayfaya göre). */}
          <Breadcrumb items={breadcrumbItems} />

          {/* Sağda: kullanıcı avatarı + dropdown (çıkış). */}
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
            >
              <Avatar icon={<UserOutlined />} style={{ backgroundColor: '#1e3a5f' }} />
              <Text style={{ fontWeight: 500 }}>{username || 'Kullanıcı'}</Text>
            </div>
          </Dropdown>
        </Header>

        {/* İçerik: tam genişlik (maxWidth kısıtı yok), yalnızca padding. */}
        <Content style={{ padding: '24px 32px' }}>{children}</Content>
      </Layout>
    </Layout>
  )
}

export default AppLayout
