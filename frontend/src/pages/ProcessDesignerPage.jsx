import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, ToolOutlined } from '@ant-design/icons'
import api from '../api.js'

const { Title } = Typography

// Kartlara/tabloya hafif derinlik hissi veren ortak gölge (diğer sayfalarla tutarlı).
const CARD_SHADOW = '0 1px 4px rgba(0, 0, 0, 0.08)'

// action_type'a göre Tag rengi — ProcessDiagramPage'deki EDGE_COLORS ile aynı ton
// (o dosyaya dokunmadan, burada ayrıca tanımlı — iki sayfa tamamen bağımsız).
const ACTION_TYPE_COLORS = {
  approve: '#3f8600',
  reject: '#d4380d',
  return: '#fa8c16',
}

const ACTION_TYPE_LABELS = {
  approve: 'Onayla',
  reject: 'Reddet',
  return: 'İade',
}

const ACTION_TYPE_OPTIONS = [
  { value: 'approve', label: 'Onayla' },
  { value: 'reject', label: 'Reddet' },
  { value: 'return', label: 'İade' },
]

// Süreç Tasarla (1.2): TABLO/LİSTE tabanlı süreç editörü. İlk sürüm react-flow (canvas,
// sürükle-bırak) tabanlıydı; kullanıcı testinde bağlantı sürükleme (özellikle geri dönüş
// geçişleri) kafa karıştırıcı bulundu, bu yüzden canvas TAMAMEN kaldırılıp Adımlar/Geçişler
// için basit tablo + modal akışına geçildi — hiçbir sürükleme yok, her şey dropdown/form.
// ProcessDiagramPage (salt okuma, /diagram) TAMAMEN AYRI bir sayfa — ona dokunulmadı.
// Sadece staff/superuser erişebilir; backend admin uçları gerçekten 403 döndüğü için o
// hata yakalanıp "yetkiniz yok" gösteriliyor (DefinitionPermissionsPage'deki aynı desen).
function ProcessDesignerPage() {
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState(null)

  const [definitions, setDefinitions] = useState([])
  const [groups, setGroups] = useState([])
  // Ham adım/geçiş listeleri — TÜM süreçlere ait (backend admin uçları filtre
  // desteklemiyor), seçili sürece göre client-side süzülüyor.
  const [steps, setSteps] = useState([])
  const [transitions, setTransitions] = useState([])

  const [selectedDefinitionId, setSelectedDefinitionId] = useState(null)

  // "+ Yeni Süreç" modalı.
  const [newProcessModalOpen, setNewProcessModalOpen] = useState(false)
  const [creatingProcess, setCreatingProcess] = useState(false)
  const [newProcessForm] = Form.useForm()

  // Adım modalı (hem "yeni" hem "düzenle" için tek modal — editingStep null ise yeni).
  const [stepModalOpen, setStepModalOpen] = useState(false)
  const [editingStep, setEditingStep] = useState(null)
  const [savingStep, setSavingStep] = useState(false)
  const [deletingStepId, setDeletingStepId] = useState(null)
  const [stepForm] = Form.useForm()

  // Geçiş modalı (yalnızca "yeni" — düzenleme yok, kapsam dışı; silip yeniden eklenir).
  const [transitionModalOpen, setTransitionModalOpen] = useState(false)
  const [creatingTransition, setCreatingTransition] = useState(false)
  const [deletingTransitionId, setDeletingTransitionId] = useState(null)
  const [transitionForm] = Form.useForm()

  // "Doğrula" butonu sonucu.
  const [validateResult, setValidateResult] = useState(null)
  const [validating, setValidating] = useState(false)

  // Mount olunca: süreçler, gruplar, TÜM adımlar, TÜM geçişler paralel çekilir.
  // admin/steps veya admin/transitions staff olmayan kullanıcı için gerçekten 403
  // döndüğü için bu, sayfanın erişim kontrolü olarak da kullanılıyor.
  useEffect(() => {
    async function run() {
      try {
        const [defsRes, groupsRes, stepsRes, transitionsRes] = await Promise.all([
          api.get('/api/definitions/'),
          api.get('/api/groups/'),
          api.get('/api/admin/steps/'),
          api.get('/api/admin/transitions/'),
        ])
        setDefinitions(defsRes.data)
        setGroups(groupsRes.data)
        setSteps(stepsRes.data)
        setTransitions(transitionsRes.data)
        setError(null)
      } catch (err) {
        console.error('Süreç tasarlama verisi alınamadı:', err)
        if (err.response?.status === 403) {
          setForbidden(true)
        } else {
          setError('Veri yüklenemedi.')
        }
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [])

  function handleSelectDefinition(definitionId) {
    setSelectedDefinitionId(definitionId ?? null)
    setValidateResult(null)
  }

  // Bu sürece ait adımlar (sıraya göre) ve geçişler.
  const definitionSteps = steps
    .filter((s) => s.definition === selectedDefinitionId)
    .sort((a, b) => a.order - b.order)
  const definitionTransitions = transitions.filter((t) => t.definition === selectedDefinitionId)

  const groupNameById = new Map(groups.map((g) => [g.id, g.name]))
  const stepNameById = new Map(steps.map((s) => [s.id, s.name]))

  // "+ Yeni Süreç" modalı: name+code gönder, oluşunca listeye ekle ve seçili yap.
  async function handleCreateProcess() {
    let values
    try {
      values = await newProcessForm.validateFields()
    } catch {
      return
    }
    setCreatingProcess(true)
    try {
      const { data } = await api.post('/api/definitions/', {
        name: values.name,
        code: values.code,
      })
      setDefinitions((prev) => [...prev, data])
      setNewProcessModalOpen(false)
      message.success('Süreç oluşturuldu.')
      handleSelectDefinition(data.id)
    } catch (err) {
      const data = err.response?.data
      message.error(data?.name?.[0] || data?.code?.[0] || 'Süreç oluşturulamadı.')
    } finally {
      setCreatingProcess(false)
    }
  }

  // "+ Yeni Adım": modalı boş formla aç.
  function openNewStepModal() {
    const maxOrder = definitionSteps.reduce((max, s) => Math.max(max, s.order), 0)
    setEditingStep(null)
    stepForm.resetFields()
    stepForm.setFieldsValue({ order: maxOrder + 1, is_start: false, is_end: false })
    setStepModalOpen(true)
  }

  // Satırdaki "Düzenle": modalı seçilen adımın verileriyle aç.
  function openEditStepModal(step) {
    setEditingStep(step)
    stepForm.setFieldsValue({
      name: step.name,
      order: step.order,
      responsible_group: step.responsible_group,
      is_start: step.is_start,
      is_end: step.is_end,
      max_duration_days: step.max_duration_days,
    })
    setStepModalOpen(true)
  }

  // Adım modalı "Kaydet": editingStep doluysa PATCH, boşsa POST.
  async function handleSaveStep() {
    let values
    try {
      values = await stepForm.validateFields()
    } catch {
      return
    }
    setSavingStep(true)
    const payload = {
      name: values.name,
      order: values.order,
      responsible_group: values.responsible_group ?? null,
      is_start: !!values.is_start,
      is_end: !!values.is_end,
      max_duration_days: values.max_duration_days ?? null,
    }
    try {
      if (editingStep) {
        const { data } = await api.patch(`/api/admin/steps/${editingStep.id}/`, payload)
        setSteps((prev) => prev.map((s) => (s.id === data.id ? data : s)))
        message.success('Adım güncellendi.')
      } else {
        const { data } = await api.post('/api/admin/steps/', {
          ...payload,
          definition: selectedDefinitionId,
        })
        setSteps((prev) => [...prev, data])
        message.success('Adım eklendi.')
      }
      setStepModalOpen(false)
    } catch (err) {
      const data = err.response?.data
      message.error(data?.name?.[0] || data?.error || 'Adım kaydedilemedi.')
    } finally {
      setSavingStep(false)
    }
  }

  // Satırdaki "Sil" (Popconfirm onayından sonra): backend'in 400 hata mesajını
  // (örn. "aktif iş var") olduğu gibi göster.
  async function handleDeleteStep(step) {
    setDeletingStepId(step.id)
    try {
      await api.delete(`/api/admin/steps/${step.id}/`)
      setSteps((prev) => prev.filter((s) => s.id !== step.id))
      // Bu adıma bağlı geçişler backend'de CASCADE ile zaten silindi — client
      // state'i (transitions) de aynı şekilde temizlenir.
      setTransitions((prev) => prev.filter((t) => t.from_step !== step.id && t.to_step !== step.id))
      message.success('Adım silindi.')
    } catch (err) {
      message.error(err.response?.data?.error || 'Adım silinemedi.')
    } finally {
      setDeletingStepId(null)
    }
  }

  // "+ Yeni Geçiş" modalı: formu boşalt, aç.
  function openNewTransitionModal() {
    transitionForm.resetFields()
    setTransitionModalOpen(true)
  }

  // Geçiş modalı "Ekle": POST /api/admin/transitions/.
  async function handleCreateTransition() {
    let values
    try {
      values = await transitionForm.validateFields()
    } catch {
      return
    }
    if (values.from_step === values.to_step) {
      message.warning('Nereden ve Nereye aynı adım olamaz.')
      return
    }
    setCreatingTransition(true)
    try {
      const { data } = await api.post('/api/admin/transitions/', {
        definition: selectedDefinitionId,
        from_step: values.from_step,
        to_step: values.to_step,
        action_name: values.action_name,
        action_type: values.action_type,
      })
      setTransitions((prev) => [...prev, data])
      setTransitionModalOpen(false)
      message.success('Geçiş eklendi.')
    } catch (err) {
      const data = err.response?.data
      message.error(data?.error || data?.non_field_errors?.[0] || 'Geçiş eklenemedi.')
    } finally {
      setCreatingTransition(false)
    }
  }

  // Satırdaki "Sil" (Popconfirm onayından sonra).
  async function handleDeleteTransition(transition) {
    setDeletingTransitionId(transition.id)
    try {
      await api.delete(`/api/admin/transitions/${transition.id}/`)
      setTransitions((prev) => prev.filter((t) => t.id !== transition.id))
      message.success('Geçiş silindi.')
    } catch (err) {
      message.error(err.response?.data?.error || 'Geçiş silinemedi.')
    } finally {
      setDeletingTransitionId(null)
    }
  }

  // "Doğrula" butonu: bu sürecin yayına hazır olup olmadığını kontrol eder.
  async function handleValidate() {
    if (!selectedDefinitionId) return
    setValidating(true)
    try {
      const { data } = await api.get(`/api/definitions/${selectedDefinitionId}/validate/`)
      setValidateResult(data)
    } catch (err) {
      console.error('Doğrulama yapılamadı:', err)
      message.error('Doğrulama yapılamadı.')
    } finally {
      setValidating(false)
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

  // Yetkisiz erişim: backend 403 döndü.
  if (forbidden) {
    return <Alert type="warning" message="Bu sayfayı görüntüleme yetkiniz yok." showIcon />
  }

  // Diğer hatalar: kırmızı uyarı.
  if (error) {
    return <Alert type="error" message={error} showIcon />
  }

  const groupOptions = groups.map((g) => ({ value: g.id, label: g.name }))
  const stepOptions = definitionSteps.map((s) => ({ value: s.id, label: s.name }))

  const stepColumns = [
    { title: 'Sıra', dataIndex: 'order', key: 'order', width: 80 },
    { title: 'Ad', dataIndex: 'name', key: 'name' },
    {
      title: 'Sorumlu Grup',
      dataIndex: 'responsible_group',
      key: 'responsible_group',
      render: (groupId) => groupNameById.get(groupId) || '—',
    },
    {
      title: 'Başlangıç',
      dataIndex: 'is_start',
      key: 'is_start',
      render: (val) => (val ? <Tag color="blue">Başlangıç</Tag> : null),
    },
    {
      title: 'Bitiş',
      dataIndex: 'is_end',
      key: 'is_end',
      render: (val) => (val ? <Tag color="green">Bitiş</Tag> : null),
    },
    {
      title: 'SLA Süresi',
      dataIndex: 'max_duration_days',
      key: 'max_duration_days',
      render: (days) => (days ? `${days} gün` : '—'),
    },
    {
      title: 'İşlemler',
      key: 'actions',
      render: (_, step) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditStepModal(step)}>
            Düzenle
          </Button>
          <Popconfirm
            title="Bu adımı silmek istediğinizden emin misiniz?"
            onConfirm={() => handleDeleteStep(step)}
            okText="Sil"
            okButtonProps={{ danger: true }}
            cancelText="Vazgeç"
          >
            <Button size="small" danger icon={<DeleteOutlined />} loading={deletingStepId === step.id}>
              Sil
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const transitionColumns = [
    {
      title: 'Nereden',
      dataIndex: 'from_step',
      key: 'from_step',
      render: (stepId) => stepNameById.get(stepId) || '—',
    },
    {
      title: 'Nereye',
      dataIndex: 'to_step',
      key: 'to_step',
      render: (stepId) => stepNameById.get(stepId) || '—',
    },
    { title: 'Aksiyon Adı', dataIndex: 'action_name', key: 'action_name' },
    {
      title: 'Aksiyon Tipi',
      dataIndex: 'action_type',
      key: 'action_type',
      render: (type) => <Tag color={ACTION_TYPE_COLORS[type]}>{ACTION_TYPE_LABELS[type] || type}</Tag>,
    },
    {
      title: 'İşlemler',
      key: 'actions',
      render: (_, transition) => (
        <Popconfirm
          title="Bu geçişi silmek istediğinizden emin misiniz?"
          onConfirm={() => handleDeleteTransition(transition)}
          okText="Sil"
          okButtonProps={{ danger: true }}
          cancelText="Vazgeç"
        >
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            loading={deletingTransitionId === transition.id}
          >
            Sil
          </Button>
        </Popconfirm>
      ),
    },
  ]

  return (
    <>
      {/* Başlık bandı: solda başlık, sağda (süreç seçiliyse) Doğrula butonu. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          <ToolOutlined style={{ marginRight: 8 }} />
          Süreç Tasarla
        </Title>
        {selectedDefinitionId && (
          <Button onClick={handleValidate} loading={validating}>
            Doğrula
          </Button>
        )}
      </div>

      {/* Süreç seçimi + yeni süreç. */}
      <Space style={{ marginBottom: 24 }} wrap>
        <Select
          placeholder="Düzenlenecek süreci seçin"
          style={{ width: 320 }}
          allowClear
          value={selectedDefinitionId}
          onChange={handleSelectDefinition}
          options={definitions.map((d) => ({
            value: d.id,
            label: d.is_active ? d.name : `${d.name} (taslak)`,
          }))}
        />
        <Button
          icon={<PlusOutlined />}
          onClick={() => {
            newProcessForm.resetFields()
            setNewProcessModalOpen(true)
          }}
        >
          Yeni Süreç
        </Button>
      </Space>

      {/* Doğrulama sonucu. */}
      {validateResult && (
        <Alert
          type={validateResult.valid ? 'success' : 'error'}
          showIcon
          message={validateResult.valid ? 'Süreç yayına hazır' : 'Süreç yayına hazır değil'}
          description={
            !validateResult.valid && (
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {validateResult.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )
          }
          style={{ marginBottom: 24 }}
        />
      )}

      {!selectedDefinitionId ? (
        <Empty description="Düzenlemek için bir süreç seçin ya da yeni oluşturun." />
      ) : (
        <>
          {/* Adımlar tablosu. */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <Title level={4} style={{ margin: 0 }}>
              Adımlar
            </Title>
            <Button icon={<PlusOutlined />} onClick={openNewStepModal}>
              Yeni Adım
            </Button>
          </div>
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              boxShadow: CARD_SHADOW,
              overflow: 'hidden',
              marginBottom: 32,
            }}
          >
            <Table
              columns={stepColumns}
              dataSource={definitionSteps}
              rowKey="id"
              pagination={false}
              locale={{ emptyText: 'Henüz adım eklenmedi.' }}
            />
          </div>

          {/* Geçişler tablosu. */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <Title level={4} style={{ margin: 0 }}>
              Geçişler
            </Title>
            <Button
              icon={<PlusOutlined />}
              onClick={openNewTransitionModal}
              disabled={definitionSteps.length < 2}
            >
              Yeni Geçiş
            </Button>
          </div>
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              boxShadow: CARD_SHADOW,
              overflow: 'hidden',
            }}
          >
            <Table
              columns={transitionColumns}
              dataSource={definitionTransitions}
              rowKey="id"
              pagination={false}
              locale={{ emptyText: 'Henüz geçiş eklenmedi.' }}
            />
          </div>
        </>
      )}

      {/* "+ Yeni Süreç" modalı. */}
      <Modal
        open={newProcessModalOpen}
        title="Yeni Süreç"
        onOk={handleCreateProcess}
        onCancel={() => setNewProcessModalOpen(false)}
        confirmLoading={creatingProcess}
        okText="Oluştur"
        cancelText="Vazgeç"
      >
        <Form form={newProcessForm} layout="vertical">
          <Form.Item
            label="Süreç Adı"
            name="name"
            rules={[{ required: true, message: 'Süreç adı zorunludur.' }]}
          >
            <Input placeholder="Örn. Ruhsat Başvuru Süreci" />
          </Form.Item>
          <Form.Item
            label="Kod"
            name="code"
            rules={[{ required: true, message: 'Kod zorunludur.' }]}
          >
            <Input placeholder="Örn. RUHSAT" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Adım modalı — hem yeni ekleme hem düzenleme için. */}
      <Modal
        open={stepModalOpen}
        title={editingStep ? 'Adımı Düzenle' : 'Yeni Adım'}
        onOk={handleSaveStep}
        onCancel={() => setStepModalOpen(false)}
        confirmLoading={savingStep}
        okText={editingStep ? 'Kaydet' : 'Ekle'}
        cancelText="Vazgeç"
      >
        <Form form={stepForm} layout="vertical">
          <Form.Item
            label="Ad"
            name="name"
            rules={[{ required: true, message: 'Adım adı zorunludur.' }]}
          >
            <Input placeholder="Örn. Evrak Kontrolü" />
          </Form.Item>
          <Form.Item
            label="Sıra"
            name="order"
            rules={[{ required: true, message: 'Sıra zorunludur.' }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Sorumlu Grup" name="responsible_group">
            <Select placeholder="Grup seçin (opsiyonel)" allowClear options={groupOptions} />
          </Form.Item>
          <Form.Item
            label="SLA Süresi (gün)"
            name="max_duration_days"
            tooltip="Bu adımda geçen süre bu gün sayısını aşarsa iş 'Gecikti' olarak işaretlenir. Boş bırakılırsa süre takibi yapılmaz."
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="Opsiyonel" />
          </Form.Item>
          <Form.Item name="is_start" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>Başlangıç adımı</Checkbox>
          </Form.Item>
          <Form.Item name="is_end" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Checkbox>Bitiş adımı</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      {/* "+ Yeni Geçiş" modalı. */}
      <Modal
        open={transitionModalOpen}
        title="Yeni Geçiş"
        onOk={handleCreateTransition}
        onCancel={() => setTransitionModalOpen(false)}
        confirmLoading={creatingTransition}
        okText="Ekle"
        cancelText="Vazgeç"
      >
        <Form form={transitionForm} layout="vertical">
          <Form.Item
            label="Nereden"
            name="from_step"
            rules={[{ required: true, message: 'Nereden zorunludur.' }]}
          >
            <Select placeholder="Başlangıç adımı seçin" options={stepOptions} />
          </Form.Item>
          <Form.Item
            label="Nereye"
            name="to_step"
            rules={[{ required: true, message: 'Nereye zorunludur.' }]}
          >
            <Select placeholder="Hedef adımı seçin" options={stepOptions} />
          </Form.Item>
          <Form.Item
            label="Aksiyon Adı"
            name="action_name"
            rules={[{ required: true, message: 'Aksiyon adı zorunludur.' }]}
          >
            <Input placeholder="Örn. Onayla" />
          </Form.Item>
          <Form.Item
            label="Aksiyon Tipi"
            name="action_type"
            rules={[{ required: true, message: 'Aksiyon tipi zorunludur.' }]}
          >
            <Select options={ACTION_TYPE_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

export default ProcessDesignerPage
