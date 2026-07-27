import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Modal,
  Space,
  Spin,
  Steps,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd'
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons'
import api from '../api.js'

const { Title } = Typography
const { TextArea } = Input

// status koduna göre Tag rengi (liste ekranıyla aynı sözlük).
const STATUS_COLORS = {
  active: 'blue',
  completed: 'green',
  cancelled: 'red',
}

// Kartlara hafif derinlik hissi veren ortak gölge (liste ekranıyla tutarlı).
const CARD_SHADOW = '0 1px 4px rgba(0, 0, 0, 0.08)'

// Geçiş tipine göre buton görünümü: approve mavi (primary), reject kırmızı (danger),
// return ve diğerleri varsayılan.
function transitionButtonProps(actionType) {
  if (actionType === 'approve') return { type: 'primary' }
  if (actionType === 'reject') return { danger: true }
  return {}
}

// Bir işlem geçmişi kaydının Timeline noktasının rengini belirler: to_step, from_step'ten
// "geriye" (adım sırası küçülüyor) gidiyorsa kırmızı (iade), aksi halde yeşil.
// stepOrderByName: adı sıraya (order) eşleyen Map (definition_steps'ten türetilir).
// Adım isimleri Map'te yoksa (örn. "Başlangıç") antd'nin varsayılan mavi noktası kalır.
function timelineDotColor(action, stepOrderByName) {
  const fromOrder = stepOrderByName.get(action.from_step)
  const toOrder = stepOrderByName.get(action.to_step)
  if (fromOrder == null || toOrder == null) return undefined
  return toOrder < fromOrder ? 'red' : 'green'
}

// 2.2 İş Akışı Detayı + 2.3 İşlem Geçmişi (tek sayfada).
function InstanceDetailPage() {
  const { id } = useParams() // route: /instances/:id
  const navigate = useNavigate()

  const [instance, setInstance] = useState(null)
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Not modalı ile ilgili state'ler.
  const [actionModalOpen, setActionModalOpen] = useState(false)
  const [selectedTransition, setSelectedTransition] = useState(null)
  const [actionNote, setActionNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Detay ve işlem geçmişini paralel çek (Promise.all).
  // Not: setState'ler await SONRASINDA çağrılır (senkron değil) — effect'ten güvenle çağrılır.
  // Başlangıç spinner'ı loading'in initial true değerinden gelir; aksiyon sonrası yenilemede
  // eldeki veri yerinde güncellenir (tam sayfa spinner yanıp sönmez).
  const loadData = useCallback(async () => {
    try {
      const [instanceRes, actionsRes] = await Promise.all([
        api.get(`/api/instances/${id}/`),
        api.get(`/api/instances/${id}/actions/`),
      ])
      setInstance(instanceRes.data)
      setActions(actionsRes.data)
      setError(null)
    } catch (err) {
      console.error('Detay alınamadı:', err)
      setError('Detay yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [id])

  // Mount'ta ve id değişince veriyi (yeniden) yükle.
  useEffect(() => {
    // Inline async sarmalayıcı: setState'ler loadData içinde await sonrasında olur.
    async function run() {
      await loadData()
    }
    run()
  }, [loadData])

  // Bir aksiyon butonuna basılınca: geçişi seç, notu sıfırla, modalı aç.
  function openActionModal(transition) {
    setSelectedTransition(transition)
    setActionNote('')
    setActionModalOpen(true)
  }

  // Modal "Onayla": geçişi backend'e gönder.
  async function handleActionSubmit() {
    setSubmitting(true)
    try {
      await api.post(`/api/instances/${id}/perform-action/`, {
        transition_id: selectedTransition.id,
        note: actionNote,
      })
      setActionModalOpen(false)
      message.success('İşlem başarılı.')
      // Ekranı yenile: yeni adım + yeni butonlar + yeni geçmiş gelsin.
      await loadData()
    } catch (err) {
      // Backend izinsiz/geçersiz geçişte 400 + {error} (dizi olabilir) veya {detail} döndürür.
      const data = err.response?.data
      const msg = data?.error || data?.detail || 'İşlem gerçekleştirilemedi.'
      message.error(Array.isArray(msg) ? msg.join(' ') : msg)
    } finally {
      setSubmitting(false)
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

  // Hata.
  if (error) {
    return <Alert type="error" message={error} showIcon />
  }

  // Güvenlik: veri gelmediyse boş render.
  if (!instance) return null

  const definitionSteps = instance.definition_steps || []

  // Steps'in "current" indeksi: normalde is_current olan adım. İş tamamlandıysa hepsi
  // "tamamlandı" görünsün diye current'ı adım sayısına eşitliyoruz (son adım da yeşil tik olur).
  const stepsCurrent =
    instance.status === 'completed'
      ? definitionSteps.length
      : definitionSteps.findIndex((s) => s.is_current)

  // Adı sıraya (order) eşleyen harita — geçmişteki geçişlerin yönünü (ileri/geri) belirlemek için.
  const stepOrderByName = new Map(definitionSteps.map((s) => [s.name, s.order]))

  return (
    <>
      {/* 1) Geri butonu + başlık */}
      <Button
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/')}
        style={{ marginBottom: 12 }}
      >
        Geri
      </Button>
      {/* marginBottom: 24 — sayfa başlıklarında uygulama genelinde kullanılan bölüm aralığı. */}
      <Title level={3} style={{ marginTop: 0, marginBottom: 24 }}>
        {instance.subject}
      </Title>

      {/* 2) İş bilgisi */}
      <Descriptions bordered column={1} style={{ marginBottom: 24 }}>
        <Descriptions.Item
          label={
            <Space size="small">
              <ApartmentOutlined /> Süreç
            </Space>
          }
        >
          {instance.definition}
        </Descriptions.Item>
        <Descriptions.Item
          label={
            <Space size="small">
              <EnvironmentOutlined /> Mevcut Adım
            </Space>
          }
        >
          {instance.current_step}
        </Descriptions.Item>
        <Descriptions.Item label="Durum">
          <Tag color={STATUS_COLORS[instance.status]}>{instance.status_display}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Belge">{instance.document_ref || '—'}</Descriptions.Item>
        <Descriptions.Item label="Atanan">{instance.assigned_to || '—'}</Descriptions.Item>
      </Descriptions>

      {/* Süreç ilerleme çubuğu: sürecin tüm adımları + hangisinin şu an işlendiği. */}
      {definitionSteps.length > 0 && (
        <Card size="small" style={{ marginBottom: 24, boxShadow: CARD_SHADOW }}>
          <Steps
            size="default"
            responsive
            current={stepsCurrent}
            status={instance.status === 'cancelled' ? 'error' : undefined}
            items={definitionSteps.map((step) => ({ title: step.name }))}
          />
        </Card>
      )}

      {/* 3) Aksiyonlar — yalnızca iş aktifse */}
      {instance.status === 'active' ? (
        <div style={{ marginBottom: 24 }}>
          {/* Alt başlıklarda marginBottom: 16 — sayfa başlığından (24) bir tık daha az. */}
          <Title level={4} style={{ marginBottom: 16 }}>
            Aksiyonlar
          </Title>
          {instance.available_transitions.length === 0 ? (
            <Alert
              type="info"
              message="Bu adımdan yapılabilecek tanımlı bir geçiş yok."
              showIcon
            />
          ) : (
            <Space wrap size="middle">
              {instance.available_transitions.map((t) => (
                <Button
                  key={t.id}
                  {...transitionButtonProps(t.action_type)}
                  onClick={() => openActionModal(t)}
                >
                  {t.action_name}
                </Button>
              ))}
            </Space>
          )}
        </div>
      ) : (
        <Alert
          type="info"
          message="Bu iş tamamlanmış/iptal edilmiş, işlem yapılamaz."
          showIcon
          style={{ marginBottom: 24 }}
        />
      )}

      {/* 4) İşlem Geçmişi (2.3) — aynı 16'lık alt başlık aralığı. */}
      <Title level={4} style={{ marginBottom: 16 }}>
        İşlem Geçmişi
      </Title>
      {actions.length === 0 ? (
        <Empty description="Henüz işlem yok." />
      ) : (
        <Timeline
          items={actions.map((a) => ({
            color: timelineDotColor(a, stepOrderByName),
            children: (
              <div>
                {/* from_step null ise "Başlangıç" göster. */}
                <div>
                  <strong>
                    {a.from_step || 'Başlangıç'} → {a.to_step || '—'}
                  </strong>
                </div>
                <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13 }}>
                  {a.performed_by || 'Bilinmiyor'} ·{' '}
                  {new Date(a.created_at).toLocaleString('tr-TR')}
                </div>
                {a.note && <div style={{ marginTop: 4 }}>{a.note}</div>}
              </div>
            ),
          }))}
        />
      )}

      {/* Not modalı: seçilen geçişi opsiyonel notla onayla */}
      <Modal
        open={actionModalOpen}
        title={
          selectedTransition
            ? `"${selectedTransition.action_name}" işlemini onayla`
            : ''
        }
        onOk={handleActionSubmit}
        onCancel={() => setActionModalOpen(false)}
        confirmLoading={submitting}
        okText="Onayla"
        cancelText="Vazgeç"
      >
        <TextArea
          rows={4}
          value={actionNote}
          onChange={(e) => setActionNote(e.target.value)}
          placeholder="Opsiyonel açıklama notu..."
        />
      </Modal>
    </>
  )
}

export default InstanceDetailPage
