import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  ApartmentOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  ProfileOutlined,
  StopOutlined,
} from '@ant-design/icons'
import api from '../api.js'

const { Title } = Typography

// status koduna göre Tag rengi (doküman 2.1: Aktif mavi, Tamamlandı yeşil;
// Reddedildi, Faz 2 Müdür Onayı düzeltmesiyle eklendi — turuncu-kırmızı).
const STATUS_COLORS = {
  active: 'blue',
  completed: 'green',
  rejected: 'volcano',
}

// status koduna göre Tag ikonu (renklerle aynı anlam).
const STATUS_ICONS = {
  active: <ClockCircleOutlined />,
  completed: <CheckCircleOutlined />,
  rejected: <StopOutlined />,
}

// Kartlara/tabloya hafif derinlik hissi veren ortak gölge.
const CARD_SHADOW = '0 1px 4px rgba(0, 0, 0, 0.08)'

// Tablo sütunları. Bileşen dışında sabit tanımlı — her render'da yeniden üretilmez.
const columns = [
  {
    title: 'Konu',
    dataIndex: 'subject',
    key: 'subject',
    // Konu biraz vurgulu.
    render: (value) => <span style={{ fontWeight: 500 }}>{value}</span>,
  },
  {
    title: 'Süreç',
    dataIndex: 'definition',
    key: 'definition',
    // Süreç adının başında soluk bir hiyerarşi ikonu.
    render: (value) => (
      <span>
        <ApartmentOutlined style={{ color: 'rgba(0,0,0,0.25)', marginRight: 6 }} />
        {value}
      </span>
    ),
  },
  { title: 'Mevcut Adım', dataIndex: 'current_step', key: 'current_step' },
  {
    title: 'Belge',
    dataIndex: 'document_ref',
    key: 'document_ref',
    // Belge bağlantısı boşsa tire göster.
    render: (value) => value || '—',
  },
  {
    title: 'Durum',
    dataIndex: 'status_display',
    key: 'status',
    // Renk + ikon status koduna göre; metin status_display'den.
    render: (text, record) => (
      <Tag icon={STATUS_ICONS[record.status]} color={STATUS_COLORS[record.status]}>
        {text}
      </Tag>
    ),
  },
]

// 2.1 İş Akışlarım (liste + istatistik + filtre) + 3.1 Yeni İş Başlatma (modal).
function InstanceListPage() {
  const [instances, setInstances] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Client-side durum filtresi (yeni API çağrısı yapmaz; sadece görüntülemeyi süzer).
  const [statusFilter, setStatusFilter] = useState('all')

  // 3.1 Yeni iş modalı ile ilgili state'ler.
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [definitions, setDefinitions] = useState([]) // süreç dropdown'ı
  const [creating, setCreating] = useState(false) // form gönderiliyor mu

  const [form] = Form.useForm()
  const navigate = useNavigate()

  // Liste verisini çek. useCallback ile sabit referans — hem mount'ta hem create sonrası kullanılır.
  const fetchInstances = useCallback(async () => {
    try {
      const response = await api.get('/api/instances/')
      setInstances(response.data)
      setError(null)
    } catch (err) {
      console.error('İş akışları alınamadı:', err)
      setError('İş akışları yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Mount'ta veriyi yükle (inline async sarmalayıcı — effect'ten güvenli çağrı).
  useEffect(() => {
    async function run() {
      await fetchInstances()
    }
    run()
  }, [fetchInstances])

  // İstatistikler — instances'tan türetilir (yalnızca veri değişince yeniden hesaplanır).
  const stats = useMemo(() => {
    return {
      total: instances.length,
      active: instances.filter((i) => i.status === 'active').length,
      completed: instances.filter((i) => i.status === 'completed').length,
      rejected: instances.filter((i) => i.status === 'rejected').length,
    }
  }, [instances])

  // Tabloda gösterilecek (filtrelenmiş) veri. Orijinal instances bozulmaz.
  const filteredInstances = useMemo(() => {
    if (statusFilter === 'all') return instances
    return instances.filter((i) => i.status === statusFilter)
  }, [instances, statusFilter])

  // "Yeni İş Başlat" tıklanınca: modalı aç ve süreçleri (henüz çekilmediyse) çek.
  async function openCreateModal() {
    setCreateModalOpen(true)
    if (definitions.length === 0) {
      try {
        const response = await api.get('/api/definitions/')
        setDefinitions(response.data)
      } catch (err) {
        console.error('Süreçler alınamadı:', err)
        message.error('Süreçler yüklenemedi.')
      }
    }
  }

  // Modalı kapat + formu temizle (Vazgeç ya da başarılı gönderim sonrası).
  function closeCreateModal() {
    setCreateModalOpen(false)
    form.resetFields()
  }

  // Modal "Başlat": formu doğrula, yeni işi oluştur.
  async function handleCreate() {
    let values
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    setCreating(true)
    try {
      // Backend başlangıç adımını + status'u kendisi atar; biz yalnızca şunları göndeririz.
      await api.post('/api/instances/', {
        definition: values.definition,
        subject: values.subject,
        document_ref: values.document_ref || '',
      })
      closeCreateModal()
      message.success('Yeni iş başlatıldı.')
      await fetchInstances() // liste yenilensin, yeni iş görünsün
    } catch (err) {
      // DRF çeşitli hata biçimleri döndürebilir.
      const data = err.response?.data
      let msg = 'İş oluşturulamadı.'
      if (Array.isArray(data) && data.length) {
        msg = data[0]
      } else if (data && typeof data === 'object') {
        msg = data.detail || data.non_field_errors?.[0] || msg
      } else if (typeof data === 'string' && data) {
        msg = data
      }
      message.error(msg)
    } finally {
      setCreating(false)
    }
  }

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

  // İstatistik kartı yapılandırması: ikon rengi (koyu ton) + dairenin soluk zemin rengi.
  const statCards = [
    {
      title: 'Toplam İş',
      value: stats.total,
      icon: <ProfileOutlined />,
      color: '#1e3a5f',
      bgColor: '#eef1f6',
    },
    {
      title: 'Aktif',
      value: stats.active,
      icon: <ClockCircleOutlined />,
      color: '#1677ff',
      bgColor: '#e6f4ff',
    },
    {
      title: 'Tamamlanan',
      value: stats.completed,
      icon: <CheckCircleOutlined />,
      color: '#3f8600',
      bgColor: '#f6ffed',
    },
    {
      title: 'Reddedilen',
      value: stats.rejected,
      icon: <StopOutlined />,
      color: '#d4380d',
      bgColor: '#fff2e8',
    },
  ]

  return (
    <>
      {/* d) Başlık bandı: solda başlık, sağda "Yeni İş Başlat". */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          İş Akışlarım
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          Yeni İş Başlat
        </Button>
      </div>

      {/* a) İstatistik kartları (responsive). Yatay+dikey gutter: mobilde alt alta
          dizilince kartlar arasında da bosluk kalsin. */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {statCards.map((s) => (
          <Col xs={24} sm={12} md={6} key={s.title}>
            <Card size="small" style={{ boxShadow: CARD_SHADOW }}>
              {/* Solda renkli ikon dairesi, sağda Statistic (başlık üstte, değer altta —
                  Statistic'in kendi varsayılan dikey düzeni zaten bunu sağlıyor). */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: s.bgColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <span style={{ color: s.color, fontSize: 22 }}>{s.icon}</span>
                </div>
                <Statistic
                  title={s.title}
                  value={s.value}
                  valueStyle={{ color: s.color, fontWeight: 600 }}
                />
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* b) Durum filtresi (client-side). Bolum araligi 24 - diger bloklarla tutarli. */}
      <div style={{ marginBottom: 24 }}>
        <Segmented
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { label: 'Tümü', value: 'all' },
            { label: 'Aktif', value: 'active' },
            { label: 'Tamamlanan', value: 'completed' },
            { label: 'Reddedilen', value: 'rejected' },
          ]}
        />
      </div>

      {/* c) Tablo — beyaz kart hissi (gölge + yuvarlak köşe). */}
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
          dataSource={filteredInstances}
          rowKey="id"
          // Filtre sonucu boşsa özel boş durum.
          locale={{ emptyText: <Empty description="Bu filtrede iş yok" /> }}
          // Satıra tıklayınca detaya git + tıklanabilir imleç.
          onRow={(record) => ({
            onClick: () => navigate(`/instances/${record.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      </div>

      {/* 3.1 Yeni İş Başlatma modalı */}
      <Modal
        open={createModalOpen}
        title="Yeni İş Başlat"
        onOk={handleCreate}
        onCancel={closeCreateModal}
        confirmLoading={creating}
        okText="Başlat"
        cancelText="Vazgeç"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="Süreç"
            name="definition"
            rules={[{ required: true, message: 'Süreç seçin.' }]}
          >
            {/* name gösterilir, id gönderilir. */}
            <Select
              placeholder="Süreç seçin"
              options={definitions.map((d) => ({ value: d.id, label: d.name }))}
            />
          </Form.Item>

          <Form.Item
            label="Konu"
            name="subject"
            rules={[{ required: true, message: 'Konu zorunludur.' }]}
          >
            <Input placeholder="İşin konusu" />
          </Form.Item>

          <Form.Item label="Belge Referansı" name="document_ref">
            <Input placeholder="Belge kodu/barkod (opsiyonel)" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

export default InstanceListPage
