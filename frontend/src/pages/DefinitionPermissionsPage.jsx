import { useEffect, useState } from 'react'
import { Alert, Checkbox, Spin, Table, Typography, message } from 'antd'
import { FileProtectOutlined } from '@ant-design/icons'
import api from '../api.js'

const { Title } = Typography

// Kartlara/tabloya hafif derinlik hissi veren ortak gölge (diğer sayfalarla tutarlı).
const CARD_SHADOW = '0 1px 4px rgba(0, 0, 0, 0.08)'

// Süreç Başlatma Yetkileri ekranı: grup x süreç matrisi. Bir süreç için hiç grup
// işaretlenmezse "kısıtlanmamış" sayılır (genel 'İş Başlatabilir' izni geçerli olur);
// en az bir grup işaretlenirse süreç yalnızca işaretli gruplara açılır (bkz. backend
// services.get_allowed_definitions). Sadece staff/superuser görebilir — backend
// definition_matrix ucu 403 döner, bu sayfa da o hatayı yakalayıp uyarı gösterir.
function DefinitionPermissionsPage() {
  const [groups, setGroups] = useState([])
  const [definitions, setDefinitions] = useState([])
  // matrix: { [group_id]: [definition_id, ...] } — o grubun izinli olduğu süreçler.
  const [matrix, setMatrix] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [forbidden, setForbidden] = useState(false)

  // Hangi grubun satırı şu an kaydediliyor — o satırdaki checkbox'lar loading/disabled olur.
  const [savingGroupId, setSavingGroupId] = useState(null)

  // Mount olunca grupları, süreçleri ve mevcut izin matrisini paralel çek.
  useEffect(() => {
    async function run() {
      try {
        const [groupsRes, definitionsRes, matrixRes] = await Promise.all([
          api.get('/api/groups/'),
          api.get('/api/definitions/'),
          api.get('/api/groups/definition_matrix/'),
        ])
        setGroups(groupsRes.data)
        setDefinitions(definitionsRes.data)

        const matrixMap = {}
        matrixRes.data.forEach((row) => {
          matrixMap[row.group_id] = row.definition_ids
        })
        setMatrix(matrixMap)
        setError(null)
      } catch (err) {
        console.error('Süreç yetki matrisi alınamadı:', err)
        if (err.response?.status === 403) {
          setForbidden(true)
        } else {
          setError('Süreç yetki matrisi yüklenemedi.')
        }
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [])

  // Bir hücre (grup x süreç) işaretlenince/kaldırılınca: o grubun TÜM listesini
  // güncelleyip PATCH gönder (backend "tamamen bu listeyle değiştir" mantığında).
  async function handleCheckboxChange(groupId, definitionId, checked) {
    const previousIds = matrix[groupId] || []
    const newIds = checked
      ? [...previousIds, definitionId]
      : previousIds.filter((id) => id !== definitionId)

    setMatrix((prev) => ({ ...prev, [groupId]: newIds }))
    setSavingGroupId(groupId)

    try {
      await api.patch(`/api/groups/${groupId}/definitions/`, { definition_ids: newIds })
      message.success('Güncellendi')
    } catch (err) {
      console.error('Süreç yetkisi güncellenemedi:', err)
      message.error('Süreç yetkisi güncellenemedi.')
      // Eski değere geri al.
      setMatrix((prev) => ({ ...prev, [groupId]: previousIds }))
    } finally {
      setSavingGroupId(null)
    }
  }

  // Sütunlar: sabit "Grup" sütunu + her süreç için bir checkbox sütunu (dinamik).
  const columns = [
    {
      title: 'Grup',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      width: 220,
      render: (name) => <span style={{ fontWeight: 500 }}>{name}</span>,
    },
    ...definitions.map((definition) => ({
      title: definition.name,
      key: `definition-${definition.id}`,
      width: 180,
      align: 'center',
      render: (_, group) => (
        <Checkbox
          checked={(matrix[group.id] || []).includes(definition.id)}
          disabled={savingGroupId === group.id}
          onChange={(e) => handleCheckboxChange(group.id, definition.id, e.target.checked)}
        />
      ),
    })),
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
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          <FileProtectOutlined style={{ marginRight: 8 }} />
          Süreç Başlatma Yetkileri
        </Title>
      </div>

      {/* Bilgilendirme mesajı. */}
      <Alert
        type="info"
        message="Bir süreç için hiç işaretleme yapılmazsa, o süreç 'kısıtlanmamış' sayılır ve genel 'İş Başlatabilir' iznine sahip herkes başlatabilir. En az bir grup işaretlenirse, süreç yalnızca işaretli gruplara açılır."
        showIcon
        style={{ marginBottom: 24 }}
      />

      {/* Grup x Süreç matrisi. */}
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
          dataSource={groups}
          rowKey="id"
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'Grup bulunamadı.' }}
        />
      </div>
    </>
  )
}

export default DefinitionPermissionsPage
