import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Dropdown,
  Empty,
  Layout,
  Menu,
  Popover,
  Typography,
} from 'antd'
import {
  BarChartOutlined,
  BellOutlined,
  DeploymentUnitOutlined,
  LogoutOutlined,
  SwapOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from '@ant-design/icons'
import api, { logout } from '../api.js'

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
  {
    key: '/analytics',
    icon: <BarChartOutlined />,
    label: <Link to="/analytics">Panom</Link>,
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
  if (pathname.startsWith('/analytics')) {
    return [{ title: 'Panom' }]
  }
  return [{ title: 'İş Akışlarım' }]
}

// Giriş sonrası ortak sayfa iskeleti: sol sidebar (marka + menü) + dar üst header
// (breadcrumb + kullanıcı avatarı) + içerik. children: sayfaya özel içerik (liste, detay vb.).
function AppLayout({ children }) {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // Bildirim (bell ikonu) state'leri.
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false)

  // Çıkış: yerel token'ları (+ kullanıcı adını, api.js logout) sil ve giriş ekranına dön.
  function handleLogout() {
    logout()
    navigate('/login')
  }

  // Okunmamış bildirim sayısını çeker (bell ikonundaki Badge için).
  async function fetchUnreadCount() {
    try {
      const { data } = await api.get('/api/notifications/unread-count/')
      setUnreadCount(data.count)
    } catch {
      // Sessizce geç — header'ın geri kalanı bu yüzden çalışmaz hale gelmesin.
    }
  }

  // Bildirim listesini çeker (dropdown açılırken tazelenir).
  async function fetchNotifications() {
    try {
      const { data } = await api.get('/api/notifications/')
      setNotifications(data)
    } catch {
      // Sessizce geç.
    }
  }

  // Mount olunca hemen çek, sonra her 30 saniyede bir tekrar çek.
  useEffect(() => {
    fetchUnreadCount()
    const interval = setInterval(fetchUnreadCount, 30000)
    return () => clearInterval(interval)
  }, [])

  // Popover açılıp kapanınca çağrılır (Bell'e tıklamak açılışı tetikler).
  // Açılırken listeyi tazele; kapanırken sadece state'i güncelle.
  function handleNotifOpenChange(open) {
    setNotifDropdownOpen(open)
    if (open) {
      fetchNotifications()
    }
  }

  // Tek bir bildirimi okundu işaretler, ilgili işe bağlıysa yönlendirir.
  async function handleNotificationClick(notification) {
    try {
      await api.post(`/api/notifications/${notification.id}/mark-read/`)
    } catch {
      // Okundu işaretleme başarısız olsa bile yönlendirmeyi engelleme.
    }
    setNotifDropdownOpen(false)
    fetchUnreadCount()
    fetchNotifications()
    if (notification.instance) {
      navigate(`/instances/${notification.instance}`)
    }
  }

  // "Tümünü okundu işaretle" — sonra listeyi ve sayacı tazele.
  async function handleMarkAllRead() {
    try {
      await api.post('/api/notifications/mark-all-read/')
      fetchNotifications()
      fetchUnreadCount()
    } catch {
      // Sessizce geç.
    }
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

  // Bell ikonunun altında açılan bildirim paneli.
  const notificationPanel = (
    <div style={{ width: 340, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 4px 8px',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <Text strong>Bildirimler</Text>
        {unreadCount > 0 && (
          <a onClick={handleMarkAllRead} style={{ fontSize: 12 }}>
            Tümünü okundu işaretle
          </a>
        )}
      </div>

      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {notifications.length === 0 ? (
          <Empty
            description="Bildirim yok."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ padding: '24px 0' }}
          />
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => handleNotificationClick(n)}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                padding: '10px 6px',
                cursor: 'pointer',
                background: n.is_read ? 'transparent' : '#e6f4ff',
                borderBottom: '1px solid #f5f5f5',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  marginTop: 6,
                  flexShrink: 0,
                  background: n.is_read ? 'transparent' : '#1677ff',
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13 }}>{n.message}</div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {new Date(n.created_at).toLocaleString('tr-TR')}
                </Text>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )

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
          selectedKeys={[
            location.pathname.startsWith('/delegations')
              ? '/delegations'
              : location.pathname.startsWith('/analytics')
                ? '/analytics'
                : '/',
          ]}
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

          {/* Sağda: bell ikonu (bildirimler) + kullanıcı avatarı/dropdown (çıkış). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <Popover
              content={notificationPanel}
              trigger="click"
              open={notifDropdownOpen}
              onOpenChange={handleNotifOpenChange}
              placement="bottomRight"
            >
              <Badge count={unreadCount} size="small" offset={[-4, 4]}>
                <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} />
              </Badge>
            </Popover>

            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              >
                <Avatar icon={<UserOutlined />} style={{ backgroundColor: '#1e3a5f' }} />
                <Text style={{ fontWeight: 500 }}>{username || 'Kullanıcı'}</Text>
              </div>
            </Dropdown>
          </div>
        </Header>

        {/* İçerik: tam genişlik (maxWidth kısıtı yok), yalnızca padding. */}
        <Content style={{ padding: '24px 32px' }}>{children}</Content>
      </Layout>
    </Layout>
  )
}

export default AppLayout
