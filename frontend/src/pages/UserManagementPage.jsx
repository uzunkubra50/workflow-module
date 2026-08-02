import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, SafetyOutlined } from '@ant-design/icons'
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
  const [groupForm] = Form.useForm()

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
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          <SafetyOutlined style={{ marginRight: 8 }} />
          Rol ve Yetki Yönetimi
        </Title>
        <Button icon={<PlusOutlined />} onClick={() => setGroupModalOpen(true)}>
          Yeni Grup
        </Button>
      </div>

      {/* Bilgilendirme mesajı. */}
      <Alert
        type="info"
        message="Kullanıcıların hangi gruplarda olduğunu ve yeni iş başlatma yetkisini buradan yönetebilirsiniz. Değişiklikler anında kaydedilir."
        showIcon
        style={{ marginBottom: 24 }}
      />

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

      {/* Yeni grup oluşturma modalı. */}
      <Modal
        title="Yeni Grup"
        open={groupModalOpen}
        onCancel={() => {
          setGroupModalOpen(false)
          groupForm.resetFields()
        }}
        onOk={() => groupForm.submit()}
        confirmLoading={creatingGroup}
        okText="Oluştur"
        cancelText="Vazgeç"
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
      </Modal>
    </>
  )
}

export default UserManagementPage
