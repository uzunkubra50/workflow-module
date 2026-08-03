import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Divider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { DeleteOutlined, PlusOutlined, SafetyOutlined } from '@ant-design/icons'
import api from '../api.js'

const { Title, Text } = Typography

// Kartlara/tabloya hafif derinlik hissi veren ortak gölge (diğer sayfalarla tutarlı).
const CARD_SHADOW = '0 1px 4px rgba(0, 0, 0, 0.08)'

// Rol/Yetki Yönetimi ekranı: kullanıcıların grup üyeliklerini ve iş başlatma yetkisini
// yönetir. Sadece staff/superuser görebilir — backend zaten 403 döner, bu sayfa da o
// hatayı yakalayıp uyarı gösterir (menüde ayrıca gizlemeye gerek yok).
function UserManagementPage() {
  const [users, setUsers] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [forbidden, setForbidden] = useState(false)

  // Hangi satırın şu an kaydedildiği — o satırdaki Select/Switch loading gösterir.
  const [savingUserId, setSavingUserId] = useState(null)

  // Yeni grup oluşturma modalı — Süreç Tasarla ekranındaki "Sorumlu Grup" seçimi için
  // artık Django admin'e gitmeye gerek kalmasın diye eklendi.
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [deletingGroupId, setDeletingGroupId] = useState(null)
  const [groupForm] = Form.useForm()

  // Yeni kullanıcı oluşturma modalı — yeni bir çalışan için hesap açmak üzere artık
  // Django admin'e gitmeye gerek kalmasın diye eklendi. Grup/izin ataması bu formda
  // yok — kullanıcı oluşturulduktan sonra tablodaki mevcut Gruplar/İş Başlatabilir
  // kontrolleriyle ayrıca ayarlanıyor.
  const [userModalOpen, setUserModalOpen] = useState(false)
  const [creatingUser, setCreatingUser] = useState(false)
  const [userForm] = Form.useForm()

  // Mount olunca kullanıcıları ve grupları paralel çek.
  useEffect(() => {
    async function run() {
      try {
        const [usersRes, groupsRes] = await Promise.all([
          api.get('/api/users/'),
          api.get('/api/groups/'),
        ])
        const fetchedUsers = usersRes.data
        // ÖNEMLİ: GET /api/users/ staff/superuser olmayan kullanıcı için de 200 döner
        // (vekil seçim dropdown'ı bu uca ihtiyaç duyuyor) — sadece alanları sadeleşir
        // (groups/can_create_instance/is_superuser yok). Bu sayfa yalnızca genişletilmiş
        // görünümle çalışabildiği için, o alanların yokluğunu "yetkisiz" olarak ele al
        // (staff/superuser'ın kendi kaydı da listede olduğundan boş dizi pratikte olmaz).
        if (fetchedUsers.length > 0 && !('groups' in fetchedUsers[0])) {
          setForbidden(true)
          return
        }
        setUsers(fetchedUsers)
        setGroups(groupsRes.data)
        setError(null)
      } catch (err) {
        console.error('Kullanıcı/grup listesi alınamadı:', err)
        if (err.response?.status === 403) {
          setForbidden(true)
        } else {
          setError('Kullanıcı listesi yüklenemedi.')
        }
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [])

  // Grup çoklu seçimi değişince: iyimser güncelle, PATCH gönder, hata olursa geri al.
  async function handleGroupsChange(userId, newGroupIds) {
    const previousUser = users.find((u) => u.id === userId)
    const optimisticGroups = groups.filter((g) => newGroupIds.includes(g.id))

    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, groups: optimisticGroups } : u)),
    )
    setSavingUserId(userId)

    try {
      const { data } = await api.patch(`/api/users/${userId}/groups/`, {
        group_ids: newGroupIds,
      })
      setUsers((prev) => prev.map((u) => (u.id === userId ? data : u)))
      message.success('Güncellendi')
    } catch (err) {
      console.error('Gruplar güncellenemedi:', err)
      message.error('Gruplar güncellenemedi.')
      // Eski değere geri al.
      setUsers((prev) => prev.map((u) => (u.id === userId ? previousUser : u)))
    } finally {
      setSavingUserId(null)
    }
  }

  // İş başlatma yetkisi anahtarı değişince: iyimser güncelle, PATCH gönder, hata olursa geri al.
  async function handlePermissionChange(userId, checked) {
    const previousUser = users.find((u) => u.id === userId)

    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, can_create_instance: checked } : u)),
    )
    setSavingUserId(userId)

    try {
      const { data } = await api.patch(`/api/users/${userId}/permissions/`, {
        can_create_instance: checked,
      })
      setUsers((prev) => prev.map((u) => (u.id === userId ? data : u)))
      message.success('Güncellendi')
    } catch (err) {
      console.error('İzin güncellenemedi:', err)
      message.error('İzin güncellenemedi.')
      setUsers((prev) => prev.map((u) => (u.id === userId ? previousUser : u)))
    } finally {
      setSavingUserId(null)
    }
  }

  // Hesap durumu (aktif/pasif) anahtarı değişince: iyimser güncelle, PATCH gönder,
  // hata olursa geri al. Aynı desen — savingUserId burada da satır loading'i sağlar.
  async function handleActiveChange(userId, checked) {
    const previousUser = users.find((u) => u.id === userId)

    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, is_active: checked } : u)))
    setSavingUserId(userId)

    try {
      const { data } = await api.patch(`/api/users/${userId}/active/`, {
        is_active: checked,
      })
      setUsers((prev) => prev.map((u) => (u.id === userId ? data : u)))
      message.success('Güncellendi')
    } catch (err) {
      console.error('Hesap durumu güncellenemedi:', err)
      // Backend superuser'ı pasif yapma denemesini 400 + açıklayıcı mesajla reddeder.
      message.error(err.response?.data?.error || 'Hesap durumu güncellenemedi.')
      setUsers((prev) => prev.map((u) => (u.id === userId ? previousUser : u)))
    } finally {
      setSavingUserId(null)
    }
  }

  // Yeni grup oluşturma: POST /api/groups/, başarılıysa gruplar listesine ekle (hem bu
  // sayfadaki Select hem de Süreç Tasarla'daki "Sorumlu Grup" dropdown'ı bir sonraki
  // fetch'te bunu görecek).
  async function handleCreateGroup(values) {
    setCreatingGroup(true)
    try {
      const { data } = await api.post('/api/groups/', { name: values.name })
      setGroups((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      message.success('Grup oluşturuldu.')
      setGroupModalOpen(false)
      groupForm.resetFields()
    } catch (err) {
      console.error('Grup oluşturulamadı:', err)
      message.error(err.response?.data?.name?.[0] || 'Grup oluşturulamadı.')
    } finally {
      setCreatingGroup(false)
    }
  }

  // Grup silme: DELETE /api/groups/{id}/. Bu gruba dayalı adımlar SET_NULL ile
  // sorumlu/eskalasyon grubunu kaybeder (bkz. backend GroupViewSet açıklaması) —
  // bunu Popconfirm metninde açıkça belirtiyoruz, silme kendisi engellenmiyor.
  // Başarılıysa hem gruplar listesinden hem de tablodaki kullanıcıların grup
  // etiketlerinden düşürüyoruz (o kullanıcılar zaten backend'de M2M'den otomatik çıktı).
  async function handleDeleteGroup(group) {
    setDeletingGroupId(group.id)
    try {
      await api.delete(`/api/groups/${group.id}/`)
      setGroups((prev) => prev.filter((g) => g.id !== group.id))
      setUsers((prev) =>
        prev.map((u) => ({
          ...u,
          groups: u.groups?.filter ? u.groups.filter((g) => g.id !== group.id) : u.groups,
        })),
      )
      message.success('Grup silindi.')
    } catch (err) {
      console.error('Grup silinemedi:', err)
      message.error(err.response?.data?.error || 'Grup silinemedi.')
    } finally {
      setDeletingGroupId(null)
    }
  }

  // Yeni kullanıcı oluşturma: POST /api/users/. Başarılıysa dönen kaydı (diğer
  // satırlarla aynı alan setiyle — groups: [], can_create_instance: false vb.)
  // doğrudan tabloya ekler.
  async function handleCreateUser(values) {
    setCreatingUser(true)
    try {
      const { data } = await api.post('/api/users/', {
        username: values.username,
        password: values.password,
      })
      setUsers((prev) => [...prev, data].sort((a, b) => a.username.localeCompare(b.username)))
      message.success('Kullanıcı oluşturuldu.')
      setUserModalOpen(false)
      userForm.resetFields()
    } catch (err) {
      console.error('Kullanıcı oluşturulamadı:', err)
      const data = err.response?.data
      const msg = data?.username?.[0] || data?.password?.[0] || 'Kullanıcı oluşturulamadı.'
      message.error(msg)
    } finally {
      setCreatingUser(false)
    }
  }

  const columns = [
    {
      title: 'Kullanıcı Adı',
      dataIndex: 'username',
      key: 'username',
      render: (username, record) => (
        <span style={{ fontWeight: 500 }}>
          {username}
          {record.is_superuser && (
            <Tag color="gold" style={{ marginLeft: 8 }}>
              Yönetici
            </Tag>
          )}
        </span>
      ),
    },
    {
      title: 'Gruplar',
      dataIndex: 'groups',
      key: 'groups',
      width: 360,
      render: (recordGroups, record) => {
        if (record.is_superuser) {
          return <Text type="secondary">Yönetici (tüm yetkiler)</Text>
        }
        return (
          <Select
            mode="multiple"
            style={{ width: '100%' }}
            placeholder="Grup seçin"
            value={recordGroups.map((g) => g.id)}
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
            loading={savingUserId === record.id}
            disabled={savingUserId === record.id}
            onChange={(newGroupIds) => handleGroupsChange(record.id, newGroupIds)}
          />
        )
      },
    },
    {
      title: 'İş Başlatabilir',
      dataIndex: 'can_create_instance',
      key: 'can_create_instance',
      render: (canCreate, record) => {
        if (record.is_superuser) {
          return <Text type="secondary">Yönetici (tüm yetkiler)</Text>
        }
        return (
          <Switch
            checked={canCreate}
            loading={savingUserId === record.id}
            onChange={(checked) => handlePermissionChange(record.id, checked)}
          />
        )
      },
    },
    {
      title: 'Durum',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (isActive, record) => {
        if (record.is_superuser) {
          return <Text type="secondary">Yönetici (tüm yetkiler)</Text>
        }
        return (
          <Switch
            checked={isActive}
            checkedChildren="Aktif"
            unCheckedChildren="Pasif"
            loading={savingUserId === record.id}
            onChange={(checked) => handleActiveChange(record.id, checked)}
          />
        )
      },
    },
  ]

  // Yükleniyor: ortalanmış spinner.
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    )
  }

  // Yetkisiz erişim: backend 403 döndü.
  if (forbidden) {
    return <Alert type="warning" message="Bu sayfayı görüntüleme yetkiniz yok." showIcon />
  }

  // Diğer hatalar: kırmızı uyarı.
  if (error) {
    return <Alert type="error" message={error} showIcon />
  }

  return (
    <>
      {/* Başlık bandı. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            <SafetyOutlined style={{ marginRight: 8 }} />
            Rol Yönetimi
          </Title>
          {/* Açıklama diğer ekranlarla aynı desende (başlık altı alt satır).
              "Değişiklikler anında kaydedilir" bilgisi burada kalıyor: kullanıcı
              ayrı bir Kaydet butonu aradığında kafası karışmasın. */}
          <Text type="secondary" style={{ fontSize: 13 }}>
            Kullanıcıların hangi gruplarda olduğunu ve iş başlatma yetkisini yönetin —
            değişiklikler anında kaydedilir
          </Text>
        </div>
        <Space>
          <Button icon={<PlusOutlined />} onClick={() => setUserModalOpen(true)}>
            Yeni Kullanıcı
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => setGroupModalOpen(true)}>
            Gruplar
          </Button>
        </Space>
      </div>

      {/* Kullanıcı tablosu. */}
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: CARD_SHADOW,
          overflow: 'hidden',
        }}
      >
        <Table
          columns={columns}
          dataSource={users}
          rowKey="id"
          locale={{ emptyText: 'Kullanıcı bulunamadı.' }}
        />
      </div>

      {/* Grup yönetimi modalı: yeni grup oluşturma + mevcut grupları silme. */}
      <Modal
        title="Gruplar"
        open={groupModalOpen}
        onCancel={() => {
          setGroupModalOpen(false)
          groupForm.resetFields()
        }}
        onOk={() => groupForm.submit()}
        confirmLoading={creatingGroup}
        okText="Oluştur"
        cancelText="Kapat"
      >
        <Form form={groupForm} layout="vertical" onFinish={handleCreateGroup}>
          <Form.Item
            name="name"
            label="Grup Adı"
            rules={[{ required: true, message: 'Grup adı zorunludur.' }]}
          >
            <Input placeholder="Örn. İK" autoFocus />
          </Form.Item>
        </Form>

        {groups.length > 0 && (
          <>
            <Divider style={{ margin: '8px 0 16px' }} />
            <Text type="secondary" style={{ fontSize: 13 }}>
              Mevcut gruplar
            </Text>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groups.map((g) => (
                <div
                  key={g.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 10px',
                    background: '#fafafa',
                    borderRadius: 6,
                  }}
                >
                  <span>{g.name}</span>
                  <Popconfirm
                    title="Bu grubu silmek istediğinizden emin misiniz?"
                    description={
                      <span style={{ maxWidth: 280, display: 'inline-block' }}>
                        Bu gruba bağlı süreç adımları varsa sorumlu/eskalasyon grubu
                        boşalır — o adımda herkes işlem yapabilir hale gelir.
                      </span>
                    }
                    onConfirm={() => handleDeleteGroup(g)}
                    okText="Sil"
                    okButtonProps={{ danger: true }}
                    cancelText="Vazgeç"
                  >
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      loading={deletingGroupId === g.id}
                    />
                  </Popconfirm>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>

      {/* Yeni kullanıcı oluşturma modalı. */}
      <Modal
        title="Yeni Kullanıcı"
        open={userModalOpen}
        onCancel={() => {
          setUserModalOpen(false)
          userForm.resetFields()
        }}
        onOk={() => userForm.submit()}
        confirmLoading={creatingUser}
        okText="Oluştur"
        cancelText="Vazgeç"
      >
        <Form form={userForm} layout="vertical" onFinish={handleCreateUser}>
          <Form.Item
            name="username"
            label="Kullanıcı Adı"
            rules={[{ required: true, message: 'Kullanıcı adı zorunludur.' }]}
          >
            <Input placeholder="Örn. ik_user" autoFocus />
          </Form.Item>
          <Form.Item
            name="password"
            label="Şifre"
            rules={[{ required: true, message: 'Şifre zorunludur.' }]}
          >
            <Input.Password placeholder="En az 8 karakter" />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
            Oluşturduktan sonra kullanıcıyı gruplara ve iş başlatma yetkisine, aşağıdaki
            tablodan atayabilirsiniz.
          </Typography.Paragraph>
        </Form>
      </Modal>
    </>
  )
}

export default UserManagementPage
