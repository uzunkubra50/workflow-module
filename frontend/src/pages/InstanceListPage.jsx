import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Spin, Table, Tag, Typography } from 'antd'
import api from '../api.js'

const { Title } = Typography

// status koduna göre Tag rengi (doküman 2.1: Aktif mavi, Tamamlandı yeşil, İptal kırmızı).
const STATUS_COLORS = {
  active: 'blue',
  completed: 'green',
  cancelled: 'red',
}

// Tablo sütunları. Bileşen dışında sabit tanımlı — her render'da yeniden üretilmez.
const columns = [
  { title: 'Konu', dataIndex: 'subject', key: 'subject' },
  { title: 'Süreç', dataIndex: 'definition', key: 'definition' },
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
    // Renk status koduna (active/completed/cancelled) göre; metin status_display'den.
    render: (text, record) => <Tag color={STATUS_COLORS[record.status]}>{text}</Tag>,
  },
]

// 2.1 İş Akışlarım: GET /api/instances/ ile işleri çekip Table'da listeler.
function InstanceListPage() {
  const [instances, setInstances] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const navigate = useNavigate()

  // Component mount olunca bir kez veriyi çek.
  useEffect(() => {
    // ignore: StrictMode'un çift effect çağrısında ayrılmış component'e setState'i önler.
    let ignore = false

    async function fetchInstances() {
      try {
        const response = await api.get('/api/instances/')
        if (!ignore) setInstances(response.data)
      } catch (err) {
        // Konsola detaylı logla, kullanıcıya sade mesaj göster.
        console.error('İş akışları alınamadı:', err)
        if (!ignore) setError('İş akışları yüklenemedi.')
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    fetchInstances()
    return () => {
      ignore = true
    }
  }, [])

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

  // Veri geldi: başlık + tablo.
  return (
    <>
      <Title level={3}>İş Akışlarım</Title>
      <Table
        columns={columns}
        dataSource={instances}
        rowKey="id"
        // Satıra tıklayınca detaya git (route sonraki adımda dolacak) + tıklanabilir imleç.
        onRow={(record) => ({
          onClick: () => navigate(`/instances/${record.id}`),
          style: { cursor: 'pointer' },
        })}
      />
    </>
  )
}

export default InstanceListPage
