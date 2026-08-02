import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  DatePicker,
  Divider,
  Form,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, DeleteOutlined, SwapOutlined } from '@ant-design/icons'
import api from '../api.js'

const { Title } = Typography

// Kartlara/tabloya hafif derinlik hissi veren ortak gölge (diğer sayfalarla tutarlı).
const CARD_SHADOW = '0 1px 4px rgba(0, 0, 0, 0.08)'

// Vekaletin GERÇEK durumu: is_active bayrağı tek başına yeterli değil — backend
// (get_effective_users) vekaleti yalnızca start_date-end_date aralığı bugünü
// kapsıyorsa uyguluyor. Bayrak True olsa bile tarih aralığı geçmişse/gelecekse
// burada da "Aktif" göstermek yanıltıcı olur (vekalet fiilen işlemiyor olur).
function getDelegationStatus(record) {
  if (!record.is_active) {
    return { label: 'Pasif', color: 'default' }
  }
  const today = new Date().toISOString().slice(0, 10)
  if (today < record.start_date) {
    return { label: 'Henüz Başlamadı', color: 'blue' }
  }
  if (today > record.end_date) {
    return { label: 'Süresi Doldu', color: 'orange' }
  }
  return { label: 'Aktif', color: 'green' }
}

// Vekalet yönetim ekranı: kullanıcının verdiği vekaletleri listeler, yeni oluşturur, siler.
function DelegationPage() {
  const [delegations, setDelegations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // "Vekili Olduğum Kişiler" bölümü için: bana verilen vekaletler (salt okuma).
  const [receivedDelegations, setReceivedDelegations] = useState([])

  // Modal ile ilgili state'ler.
  const [modalOpen, setModalOpen] = useState(false)
  const [users, setUsers] = useState([]) // vekil seçimi dropdown'ı için kullanıcı listesi
  const [creating, setCreating] = useState(false)

  const [form] = Form.useForm()

  // Vekaletleri backend'den çek.
  const fetchDelegations = useCallback(async () => {
    try {
      const response = await api.get('/api/delegations/')
      setDelegations(response.data)
      setError(null)
    } catch (err) {
      console.error('Vekaletler alınamadı:', err)
      setError('Vekaletler yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Bana verilen (vekili olduğum) vekaletleri backend'den çek.
  const fetchReceivedDelegations = useCallback(async () => {
    try {
      const response = await api.get('/api/delegations/received/')
      setReceivedDelegations(response.data)
    } catch (err) {
      console.error('Vekili olunan kayıtlar alınamadı:', err)
    }
  }, [])

  // Mount'ta verileri yükle.
  useEffect(() => {
    fetchDelegations()
    fetchReceivedDelegations()
  }, [fetchDelegations, fetchReceivedDelegations])

  // "Yeni Vekalet" butonuna basılınca: modalı aç, kullanıcı listesini çek.
  async function openModal() {
    setModalOpen(true)
    if (users.length === 0) {
      try {
        const response = await api.get('/api/users/')
        setUsers(response.data)
      } catch (err) {
        console.error('Kullanıcılar alınamadı:', err)
        message.error('Kullanıcı listesi yüklenemedi.')
      }
    }
  }

  // Modalı kapat + formu temizle.
  function closeModal() {
    setModalOpen(false)
    form.resetFields()
  }

  // Yeni vekalet oluştur.
  async function handleCreate() {
    let values
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    setCreating(true)
    try {
      await api.post('/api/delegations/', {
        delegate: values.delegate,
        // antd DatePicker dayjs nesnesi döndürür; backend 'YYYY-MM-DD' bekler.
        start_date: values.start_date.format('YYYY-MM-DD'),
        end_date: values.end_date.format('YYYY-MM-DD'),
      })
      closeModal()
      message.success('Vekalet oluşturuldu.')
      await fetchDelegations()
    } catch (err) {
      // Backend validasyon hatalarını göster.
      const data = err.response?.data
      let msg = 'Vekalet oluşturulamadı.'
      if (Array.isArray(data) && data.length) {
        msg = data[0]
      } else if (data && typeof data === 'object') {
        // DRF non_field_errors veya alan bazlı hatalar.
        const errors = data.non_field_errors || Object.values(data).flat()
        msg = errors[0] || msg
      } else if (typeof data === 'string' && data) {
        msg = data
      }
      message.error(msg)
    } finally {
      setCreating(false)
    }
  }

  // Vekalet sil.
  async function handleDelete(id) {
    try {
      await api.delete(`/api/delegations/${id}/`)
      message.success('Vekalet silindi.')
      await fetchDelegations()
    } catch (err) {
      console.error('Vekalet silinemedi:', err)
      message.error('Vekalet silinemedi.')
    }
  }

  // Tablo sütunları.
  const columns = [
    {
      title: 'Vekil',
      dataIndex: 'delegate_username',
      key: 'delegate_username',
      render: (value) => <span style={{ fontWeight: 500 }}>{value}</span>,
    },
    {
      title: 'Başlangıç',
      dataIndex: 'start_date',
      key: 'start_date',
    },
    {
      title: 'Bitiş',
      dataIndex: 'end_date',
      key: 'end_date',
    },
    {
      title: 'Durum',
      key: 'status',
      render: (_, record) => {
        const { label, color } = getDelegationStatus(record)
        return <Tag color={color}>{label}</Tag>
      },
    },
    {
      title: 'İşlem',
      key: 'action',
      render: (_, record) => (
        <Popconfirm
          title="Bu vekaleti silmek istediğinizden emin misiniz?"
          onConfirm={() => handleDelete(record.id)}
          okText="Evet"
          cancelText="Hayır"
        >
          <Button type="text" danger icon={<DeleteOutlined />} size="small">
            Sil
          </Button>
        </Popconfirm>
      ),
    },
  ]

  // "Vekili Olduğum Kişiler" tablosu sütunları — salt okuma, silme/düzenleme yok.
  const receivedColumns = [
    {
      title: 'Vekalet Veren',
      dataIndex: 'delegator',
      key: 'delegator',
      render: (value) => <span style={{ fontWeight: 500 }}>{value}</span>,
    },
    {
      title: 'Başlangıç',
      dataIndex: 'start_date',
      key: 'start_date',
    },
    {
      title: 'Bitiş',
      dataIndex: 'end_date',
      key: 'end_date',
    },
    {
      title: 'Durum',
      key: 'status',
      render: (_, record) => {
        const { label, color } = getDelegationStatus(record)
        return <Tag color={color}>{label}</Tag>
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

  // Hata: kırmızı uyarı.
  if (error) {
    return <Alert type="error" message={error} showIcon />
  }

  return (
    <>
      {/* Başlık bandı: solda başlık, sağda "Yeni Vekalet". */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          <SwapOutlined style={{ marginRight: 8 }} />
          Vekaletlerim
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openModal}>
          Yeni Vekalet
        </Button>
      </div>

      {/* Bilgilendirme mesajı. */}
      <Alert
        type="info"
        message="İzinli olduğunuz dönemde işlerinize bakacak kişiyi belirleyin. Vekiliniz, siz yokken sizin adınıza işlem yapabilir."
        showIcon
        style={{ marginBottom: 24 }}
      />

      {/* Vekalet tablosu. */}
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
          dataSource={delegations}
          rowKey="id"
          locale={{ emptyText: 'Henüz vekalet kaydı yok.' }}
        />
      </div>

      <Divider />

      {/* "Vekili Olduğum Kişiler" bölümü: bana verilen vekaletler, salt okuma. */}
      <Title level={4}>Vekili Olduğum Kişiler</Title>
      <Typography.Paragraph type="secondary">
        Aşağıdaki kişiler size vekalet verdi. Onların sorumlu olduğu adımlarda da
        işlem yapabilirsiniz.
      </Typography.Paragraph>

      {receivedDelegations.length === 0 ? (
        <Typography.Text type="secondary">
          Şu an kimseye vekil değilsiniz.
        </Typography.Text>
      ) : (
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            boxShadow: CARD_SHADOW,
            overflow: 'hidden',
          }}
        >
          <Table
            columns={receivedColumns}
            dataSource={receivedDelegations}
            rowKey="id"
            pagination={false}
          />
        </div>
      )}

      {/* Yeni Vekalet modalı. */}
      <Modal
        open={modalOpen}
        title="Yeni Vekalet"
        onOk={handleCreate}
        onCancel={closeModal}
        confirmLoading={creating}
        okText="Kaydet"
        cancelText="Vazgeç"
      >
        <Form form={form} layout="vertical">
          {/* Vekil seçimi — kullanıcı listesinden. */}
          <Form.Item
            label="Vekil"
            name="delegate"
            rules={[{ required: true, message: 'Vekil seçin.' }]}
          >
            <Select
              placeholder="Vekil olarak atanacak kullanıcıyı seçin"
              showSearch
              optionFilterProp="label"
              options={users.map((u) => ({ value: u.id, label: u.username }))}
            />
          </Form.Item>

          {/* Başlangıç tarihi. */}
          <Form.Item
            label="Başlangıç Tarihi"
            name="start_date"
            rules={[{ required: true, message: 'Başlangıç tarihi zorunludur.' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          {/* Bitiş tarihi. */}
          <Form.Item
            label="Bitiş Tarihi"
            name="end_date"
            rules={[{ required: true, message: 'Bitiş tarihi zorunludur.' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

export default DelegationPage
