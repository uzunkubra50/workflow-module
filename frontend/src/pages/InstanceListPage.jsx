import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
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

// 2.1 İş Akışlarım (liste) + 3.1 Yeni İş Başlatma (modal).
function InstanceListPage() {
  const [instances, setInstances] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // 3.1 Yeni iş modalı ile ilgili state'ler.
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [definitions, setDefinitions] = useState([]) // süreç dropdown'ı
  const [creating, setCreating] = useState(false) // form gönderiliyor mu

  const [form] = Form.useForm()
  const navigate = useNavigate()

  // Liste verisini çek. useCallback ile sabit referans — hem mount'ta hem create sonrası kullanılır.
  // setState'ler await SONRASINDA (senkron değil); başlangıç spinner'ı loading initial true'dan gelir.
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
      // Zorunlu alanlar geçmezse validateFields reject eder; hatalar formda görünür.
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
      // DRF çeşitli hata biçimleri döndürebilir: düz liste (["..."]),
      // {detail}, {non_field_errors:[...]} ya da düz string.
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

  // Veri geldi: başlık + "Yeni İş" butonu + tablo + modal.
  return (
    <>
      {/* Başlık solda, "Yeni İş Başlat" butonu sağda (aynı satır). */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          İş Akışlarım
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          Yeni İş Başlat
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={instances}
        rowKey="id"
        // Satıra tıklayınca detaya git + tıklanabilir imleç.
        onRow={(record) => ({
          onClick: () => navigate(`/instances/${record.id}`),
          style: { cursor: 'pointer' },
        })}
      />

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
