import { useEffect, useState } from 'react'
import { Alert, Empty, Select, Spin, Table, Tag, Typography, message } from 'antd'
import { BarChartOutlined } from '@ant-design/icons'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import api from '../api.js'

const { Title } = Typography

// Kartlara/tabloya hafif derinlik hissi veren ortak gölge (diğer sayfalarla tutarlı).
const CARD_SHADOW = '0 1px 4px rgba(0, 0, 0, 0.08)'

// Bar rengi: adımda geciken (overdue_count > 0) iş varsa kırmızı, yoksa mavi.
const BAR_COLOR_OVERDUE = '#d4380d'
const BAR_COLOR_NORMAL = '#1677ff'

// Faz 2 "panom" ekranı: bir sürecin adımlarında kaç iş var, ortalama ne kadar
// sürede geçiliyor. GET /api/definitions/{id}/analytics/ verisini görselleştirir.
function AnalyticsPage() {
  const [definitions, setDefinitions] = useState([])
  const [definitionsLoading, setDefinitionsLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedDefinition, setSelectedDefinition] = useState(null)
  const [analytics, setAnalytics] = useState([])
  const [analyticsLoading, setAnalyticsLoading] = useState(false)

  // Mount'ta süreç dropdown'ı için tanımları çek.
  useEffect(() => {
    async function run() {
      try {
        const response = await api.get('/api/definitions/')
        setDefinitions(response.data)
        setError(null)
      } catch (err) {
        console.error('Süreçler alınamadı:', err)
        setError('Süreçler yüklenemedi.')
      } finally {
        setDefinitionsLoading(false)
      }
    }
    run()
  }, [])

  // Süreç seçilince: o sürecin adım bazlı analitiğini çek.
  async function handleSelectDefinition(definitionId) {
    setSelectedDefinition(definitionId ?? null)
    setAnalytics([])
    if (!definitionId) return

    setAnalyticsLoading(true)
    try {
      const response = await api.get(`/api/definitions/${definitionId}/analytics/`)
      setAnalytics(response.data)
    } catch (err) {
      console.error('Analitik veriler alınamadı:', err)
      message.error('Analitik veriler yüklenemedi.')
    } finally {
      setAnalyticsLoading(false)
    }
  }

  // Özet tablo sütunları.
  const columns = [
    { title: 'Adım', dataIndex: 'step_name', key: 'step_name' },
    { title: 'Aktif İş', dataIndex: 'active_count', key: 'active_count' },
    {
      title: 'Geciken',
      dataIndex: 'overdue_count',
      key: 'overdue_count',
      // Geciken iş varsa kırmızı Tag ile vurgula, yoksa sade sayı.
      render: (value) => (value > 0 ? <Tag color="red">{value}</Tag> : value),
    },
    { title: 'Tamamlanan', dataIndex: 'completed_count', key: 'completed_count' },
    {
      title: 'Ort. Süre',
      dataIndex: 'avg_duration_hours',
      key: 'avg_duration_hours',
      render: (value) => (value != null ? `${value} saat` : '—'),
    },
  ]

  // Yükleniyor: ortalanmış spinner.
  if (definitionsLoading) {
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
      {/* Başlık bandı. */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <BarChartOutlined style={{ marginRight: 8 }} />
          Panom
        </Title>
      </div>

      {/* Süreç seçimi. */}
      <div style={{ marginBottom: 24, maxWidth: 360 }}>
        <Select
          placeholder="Süreç seçin"
          style={{ width: '100%' }}
          allowClear
          value={selectedDefinition}
          onChange={handleSelectDefinition}
          options={definitions.map((d) => ({ value: d.id, label: d.name }))}
        />
      </div>

      {!selectedDefinition ? (
        <Empty description="Görüntülemek için bir süreç seçin." />
      ) : analyticsLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          {/* a) Bar grafik: X ekseni adım adı, Y ekseni aktif iş sayısı. Geciken işi
              olan adımlar kırmızı, diğerleri mavi (Cell ile koşullu renk). */}
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              boxShadow: CARD_SHADOW,
              padding: 24,
              marginBottom: 24,
              height: 360,
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="step_name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="active_count" name="Aktif İş">
                  {analytics.map((entry) => (
                    <Cell
                      key={entry.step_name}
                      fill={entry.overdue_count > 0 ? BAR_COLOR_OVERDUE : BAR_COLOR_NORMAL}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* b) Özet tablo. */}
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
              dataSource={analytics}
              rowKey="order"
              pagination={false}
            />
          </div>
        </>
      )}
    </>
  )
}

export default AnalyticsPage
