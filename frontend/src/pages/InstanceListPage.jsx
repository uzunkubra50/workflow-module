import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Badge,
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
  CloseCircleOutlined,
  DownloadOutlined,
  PlusOutlined,
  ProfileOutlined,
  StopOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import api from '../api.js'

const { Title } = Typography
const { Search } = Input

// status koduna göre Tag rengi (doküman 2.1: Aktif mavi, Tamamlandı yeşil;
// Reddedildi, Faz 2 Müdür Onayı düzeltmesiyle eklendi — turuncu-kırmızı).
// cancelled: iş iptali özelliğiyle eklendi — InstanceDetailPage'deki STATUS_COLORS
// ile tutarlı, nötr gri (diğer üç renkten ayrışan "süreç dışına çıkarıldı" tonu).
const STATUS_COLORS = {
  active: 'blue',
  completed: 'green',
  rejected: 'volcano',
  cancelled: '#8c8c8c',
}

// status koduna göre Tag ikonu (renklerle aynı anlam).
const STATUS_ICONS = {
  active: <ClockCircleOutlined />,
  completed: <CheckCircleOutlined />,
  rejected: <StopOutlined />,
  cancelled: <StopOutlined />,
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
    // Renk + ikon status koduna göre; metin status_display'den. Faz 2 SLA:
    // is_overdue true ise yanına ayrı bir "Gecikti" Tag'i eklenir (mevcut Tag'e
    // dokunulmadan) — satırın kendisini/rowClassName'i değiştirmek yerine bu,
    // mevcut tabloya en az riskli ekleme.
    render: (text, record) => (
      <>
        <Tag icon={STATUS_ICONS[record.status]} color={STATUS_COLORS[record.status]}>
          {text}
        </Tag>
        {record.is_overdue && (
          <Tag icon={<WarningOutlined />} color="red">
            Gecikti
          </Tag>
        )}
      </>
    ),
  },
  {
    title: 'Oluşturulma',
    dataIndex: 'created_at',
    key: 'created_at',
    // Sunucu ISO 8601 (UTC) gönderir; tarayıcının yerel saatine çevrilip gösterilir.
    render: (value) =>
      value
        ? new Date(value).toLocaleString('tr-TR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—',
  },
]

// 2.1 İş Akışlarım (liste + istatistik + filtre) + 3.1 Yeni İş Başlatma (modal).
function InstanceListPage() {
  const [instances, setInstances] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Client-side durum filtresi (yeni API çağrısı yapmaz; sadece görüntülemeyi süzer).
  const [statusFilter, setStatusFilter] = useState('all')

  // Client-side arama metni (konu/belge numarası). Az veri olduğu için debounce gerekmez.
  const [searchText, setSearchText] = useState('')

  // Liste <-> Kanban görünüm anahtarı.
  const [viewMode, setViewMode] = useState('list')

  // Kanban görünümü state'leri: seçilen süreç + o sürecin TÜM adımları (sırayla).
  const [selectedDefinition, setSelectedDefinition] = useState(null)
  const [definitionSteps, setDefinitionSteps] = useState([])
  const [stepsLoading, setStepsLoading] = useState(false)

  // 3.1 Yeni iş modalı ile ilgili state'ler. definitions Kanban'daki süreç
  // dropdown'ı için de kullanılır (tek çekim, iki yerde paylaşılır) — Kanban salt
  // görüntüleme amaçlı olduğu için TÜM aktif süreçleri listelemeye devam eder.
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [definitions, setDefinitions] = useState([]) // Kanban süreç dropdown'ı
  // Yeni İş Başlat modalının süreç dropdown'ı ise AYRI bir state: yalnızca
  // kullanıcının başlatmaya yetkili olduğu süreçler (grup bazlı süreç yetkisi,
  // Faz 2). Kanban'dan farklı veri kaynağı olduğu için definitions ile paylaşılmaz.
  const [allowedDefinitions, setAllowedDefinitions] = useState([])
  const [creating, setCreating] = useState(false) // form gönderiliyor mu

  // Kullanıcının yeni iş başlatma yetkisi olup olmadığı (can-create endpoint'inden gelir).
  const [canCreate, setCanCreate] = useState(false)

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

  // Mount'ta veriyi yükle + yetki kontrolünü çek.
  useEffect(() => {
    async function run() {
      await fetchInstances()

      // Kullanıcının iş başlatma yetkisini kontrol et. Hata olursa sessizce false kalır.
      try {
        const res = await api.get('/api/instances/can-create/')
        setCanCreate(res.data.can_create)
      } catch {
        // Yetki bilgisi alınamazsa buton gizli kalır — güvenli varsayılan.
      }
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
      cancelled: instances.filter((i) => i.status === 'cancelled').length,
    }
  }, [instances])

  // Tabloda gösterilecek (filtrelenmiş) veri. Orijinal instances bozulmaz.
  // Durum filtresi + arama metni birlikte (AND) uygulanır.
  const filteredInstances = useMemo(() => {
    let result =
      statusFilter === 'all' ? instances : instances.filter((i) => i.status === statusFilter)

    const query = searchText.trim().toLowerCase()
    if (query) {
      result = result.filter(
        (i) =>
          i.subject?.toLowerCase().includes(query) ||
          i.document_ref?.toLowerCase().includes(query),
      )
    }

    return result
  }, [instances, statusFilter, searchText])

  // Süreç listesini (henüz çekilmediyse) çeker — Kanban görünümündeki süreç
  // dropdown'ı için (salt görüntüleme, TÜM aktif süreçler). "Yeni İş Başlat" modalı
  // artık ayrı bir uçtan (allowedDefinitions) besleniyor, bkz. aşağısı.
  async function ensureDefinitionsLoaded() {
    if (definitions.length > 0) return
    try {
      const response = await api.get('/api/definitions/')
      setDefinitions(response.data)
    } catch (err) {
      console.error('Süreçler alınamadı:', err)
      message.error('Süreçler yüklenemedi.')
    }
  }

  // Yeni İş Başlat modalı için izinli süreçleri (henüz çekilmediyse) çeker.
  // /api/definitions/ değil /api/definitions/allowed/ kullanılır — kullanıcı yalnızca
  // başlatmaya yetkili olduğu süreçleri görsün (grup bazlı süreç yetkisi, Faz 2).
  async function ensureAllowedDefinitionsLoaded() {
    if (allowedDefinitions.length > 0) return
    try {
      const response = await api.get('/api/definitions/allowed/')
      setAllowedDefinitions(response.data)
    } catch (err) {
      console.error('İzinli süreçler alınamadı:', err)
      message.error('Süreçler yüklenemedi.')
    }
  }

  // "Yeni İş Başlat" tıklanınca: modalı aç ve izinli süreçleri (henüz çekilmediyse) çek.
  async function openCreateModal() {
    setCreateModalOpen(true)
    await ensureAllowedDefinitionsLoaded()
  }

  // Kanban görünümüne geçilince süreç dropdown'ı için tanımları çek (henüz yoksa).
  useEffect(() => {
    if (viewMode === 'kanban') {
      ensureDefinitionsLoaded()
    }
    // ensureDefinitionsLoaded her render'da yeniden oluşuyor ama içeride kendi
    // guard'ı (definitions.length > 0) var; sadece viewMode değişince tetiklenmesi yeterli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  // Kanban'da süreç seçilince: adımlarını çek, sütunları oluştur.
  async function handleSelectDefinition(definitionId) {
    setSelectedDefinition(definitionId ?? null)
    setDefinitionSteps([])
    if (!definitionId) return

    setStepsLoading(true)
    try {
      const response = await api.get(`/api/definitions/${definitionId}/steps/`)
      setDefinitionSteps(response.data)
    } catch (err) {
      console.error('Süreç adımları alınamadı:', err)
      message.error('Süreç adımları yüklenemedi.')
    } finally {
      setStepsLoading(false)
    }
  }

  // Seçilen sürecin adı (instances'taki 'definition' alanı isim olarak geliyor,
  // eşleştirme id üzerinden değil isim üzerinden yapılmak zorunda).
  const selectedDefinitionName = useMemo(
    () => definitions.find((d) => d.id === selectedDefinition)?.name,
    [definitions, selectedDefinition],
  )

  // Kanban'da gösterilecek işler: TÜM instances içinden yalnızca seçilen sürece ait
  // olanlar (durum filtresi/arama Kanban'ı etkilemez — Liste görünümünden bağımsız).
  const kanbanInstances = useMemo(() => {
    if (!selectedDefinitionName) return []
    return instances.filter((i) => i.definition === selectedDefinitionName)
  }, [instances, selectedDefinitionName])

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
      // description opsiyonel — boşsa göndermiyoruz, backend zaten kabul ediyor.
      const payload = {
        definition: values.definition,
        subject: values.subject,
        document_ref: values.document_ref || '',
      }
      if (values.description) {
        payload.description = values.description
      }
      await api.post('/api/instances/', payload)
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

  // CSV alanını kaçışlar: virgül/tırnak/satır sonu içeriyorsa çift tırnak içine al,
  // içindeki çift tırnağı ikiye katla (standart CSV escaping).
  function escapeCsvField(value) {
    const str = String(value ?? '')
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  // O an görüntülenen (filtrelenmiş) işleri CSV'ye çevirip indirir.
  function handleExportCsv() {
    if (filteredInstances.length === 0) {
      message.info('Dışa aktarılacak iş yok.')
      return
    }

    const headers = ['Konu', 'Süreç', 'Mevcut Adım', 'Belge', 'Durum', 'Oluşturulma Tarihi']
    const rows = filteredInstances.map((i) => [
      i.subject,
      i.definition,
      i.current_step,
      i.document_ref,
      i.status_display,
      i.created_at ? new Date(i.created_at).toLocaleString('tr-TR') : '',
    ])

    const csvContent = [headers, ...rows]
      .map((row) => row.map(escapeCsvField).join(','))
      .join('\r\n')

    // Başına UTF-8 BOM: Excel'de Türkçe karakterlerin (ş, ğ, ı ...) bozulmasını önler.
    const BOM = '\uFEFF'
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    link.href = url
    link.download = `is-akislarim-${today}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
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
    {
      // İş iptali özelliğiyle eklenen beşinci kart — diğer dördüne dokunulmadı.
      title: 'İptal Edilen',
      value: stats.cancelled,
      icon: <CloseCircleOutlined />,
      color: '#8c8c8c',
      bgColor: '#f5f5f5',
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
        <div style={{ display: 'flex', gap: 12 }}>
          {/* CSV dışa aktarma: o an filtrelenmiş (görüntülenen) işleri indirir. */}
          <Button icon={<DownloadOutlined />} onClick={handleExportCsv}>
            Dışa Aktar
          </Button>
          {/* Yeni iş başlatma butonu yalnızca yetkili kullanıcılara gösterilir. */}
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              Yeni İş Başlat
            </Button>
          )}
        </div>
      </div>

      {/* Liste <-> Kanban görünüm anahtarı. Başlık bandının altında, tüm filtre/tablo
          bloklarının üstünde — iki görünüm birbirinden bağımsız çalışır. */}
      <div style={{ marginBottom: 24 }}>
        <Segmented
          value={viewMode}
          onChange={setViewMode}
          options={[
            { label: 'Liste', value: 'list' },
            { label: 'Kanban', value: 'kanban' },
          ]}
        />
      </div>

      {viewMode === 'list' && (
        <>
          {/* a) İstatistik kartları (responsive). Yatay+dikey gutter: mobilde alt alta
              dizilince kartlar arasında da bosluk kalsin. */}
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            {statCards.map((s) => (
              <Col xs={24} sm={12} md={{ flex: '1 1 0' }} key={s.title}>
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

          {/* b) Durum filtresi (client-side) + arama kutusu. İkisi de filteredInstances'ı
              birlikte (AND) besler. Bolum araligi 24 - diger bloklarla tutarli. */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 24,
            }}
          >
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { label: 'Tümü', value: 'all' },
                { label: 'Aktif', value: 'active' },
                { label: 'Tamamlanan', value: 'completed' },
                { label: 'Reddedilen', value: 'rejected' },
                { label: 'İptal Edilen', value: 'cancelled' },
              ]}
            />
            <Search
              placeholder="Konu veya belge numarasına göre ara..."
              allowClear
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ maxWidth: 320 }}
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
        </>
      )}

      {viewMode === 'kanban' && (
        <>
          {/* Süreç seçimi: hangi sürecin adımları sütun olacak. */}
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
            <Empty description="Görüntülemek için bir süreç seçin" />
          ) : stepsLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
              <Spin size="large" />
            </div>
          ) : (
            // Sütunlar yatayda yan yana, taşarsa yatay scroll. Her sütun sabit genişlik.
            <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8 }}>
              {definitionSteps.map((step) => {
                const stepInstances = kanbanInstances.filter(
                  (i) => i.current_step === step.name,
                )
                return (
                  <div
                    key={step.id}
                    style={{
                      flex: '0 0 280px',
                      width: 280,
                      background: '#fff',
                      borderRadius: 12,
                      boxShadow: CARD_SHADOW,
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {/* Sütun başlığı: adım adı + iş sayısı. */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 16px',
                        borderBottom: '1px solid #f0f0f0',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{step.name}</span>
                      <Badge count={stepInstances.length} showZero color="#1e3a5f" />
                    </div>

                    {/* Kart listesi: dikey scroll, sabit maksimum yükseklik. */}
                    <div style={{ padding: 12, overflowY: 'auto', maxHeight: 500 }}>
                      {stepInstances.length === 0 ? (
                        <div
                          style={{
                            textAlign: 'center',
                            color: 'rgba(0, 0, 0, 0.35)',
                            padding: '24px 0',
                            fontSize: 13,
                          }}
                        >
                          Boş
                        </div>
                      ) : (
                        stepInstances.map((instance) => (
                          <Card
                            key={instance.id}
                            size="small"
                            hoverable
                            onClick={() => navigate(`/instances/${instance.id}`)}
                            style={{ marginBottom: 10, cursor: 'pointer' }}
                          >
                            <div style={{ fontWeight: 500, marginBottom: 4 }}>
                              {instance.subject}
                            </div>
                            {instance.document_ref && (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: 'rgba(0, 0, 0, 0.45)',
                                  marginBottom: 6,
                                }}
                              >
                                {instance.document_ref}
                              </div>
                            )}
                            <Tag
                              icon={STATUS_ICONS[instance.status]}
                              color={STATUS_COLORS[instance.status]}
                              style={{ fontSize: 11 }}
                            >
                              {instance.status_display}
                            </Tag>
                            {/* Faz 2 SLA: liste tablosundakiyle aynı mantık — ayrı bir
                                küçük "Gecikti" Tag'i, kartın kendi border'ını değiştirmek
                                yerine daha az riskli bir ekleme. */}
                            {instance.is_overdue && (
                              <Tag icon={<WarningOutlined />} color="red" style={{ fontSize: 11 }}>
                                Gecikti
                              </Tag>
                            )}
                          </Card>
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

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
            {/* name gösterilir, id gönderilir. Yalnızca izinli süreçler listelenir. */}
            <Select
              placeholder={
                allowedDefinitions.length === 0
                  ? 'Başlatabileceğiniz süreç yok'
                  : 'Süreç seçin'
              }
              options={allowedDefinitions.map((d) => ({ value: d.id, label: d.name }))}
            />
          </Form.Item>

          <Form.Item
            label="Konu"
            name="subject"
            rules={[{ required: true, message: 'Konu zorunludur.' }]}
          >
            <Input placeholder="İşin konusu" />
          </Form.Item>

          {/* Açıklama alanı — opsiyonel, backend boş kabul eder. */}
          <Form.Item label="Açıklama" name="description">
            <Input.TextArea
              rows={3}
              placeholder="İşle ilgili açıklama/detay (opsiyonel)"
            />
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
