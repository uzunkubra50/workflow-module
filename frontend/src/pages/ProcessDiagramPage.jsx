import { useEffect, useState } from 'react'
import { Alert, Empty, Select, Spin, Typography, message } from 'antd'
import { PartitionOutlined } from '@ant-design/icons'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import api from '../api.js'

const { Title, Text } = Typography

// Kartlara/tabloya hafif derinlik hissi veren ortak gölge (diğer sayfalarla tutarlı).
const CARD_SHADOW = '0 1px 4px rgba(0, 0, 0, 0.08)'

// Kurumsal lacivert — düğüm (step) kutularının kenarlığı, diğer sayfalardaki NAVY ile aynı.
const NAVY = '#0f2540'

// action_type'a göre ok/kenar rengi: onay yeşil, ret kırmızı, iade turuncu.
const EDGE_COLORS = {
  approve: '#3f8600',
  reject: '#d4380d',
  return: '#fa8c16',
}

// Minimal özel node. React Flow'un yerleşik 'default' tipi yalnızca TEK kaynak + TEK
// hedef handle destekliyor. Bütün adımlar aynı Y'deyken (düz sıra) hem İLERİ hem GERİ
// geçişler bu tek çift handle'ı paylaşsaydı, React Flow'un bezier/smoothstep hesabı
// ikisini de aynı yatay çizgiye indirgiyor (kaynak/hedef aynı yükseklikte olduğu için
// kontrol noktaları da aynı Y'de kalıyor — kavis oluşmuyor, ok üst üste biniyor).
// Üç ayrı "bant" için üç handle çifti:
//  - sol/sağ: İLERİ geçişler — düz/yatay ok.
//  - alt: GERİ (iade/reddet) geçişler — kutuların ALTINDAN kavis yapar.
//  - üst: aynı iki adım arasında BİRDEN FAZLA geçiş varsa (örn. "Onayla" + "Reddet"
//    ikisi de aynı çiftte), ikincisi kutuların ÜSTÜNDEN kavis yapar — aksi halde
//    ikisi de sol/sağ handle'ı paylaşıp tam üst üste biniyor, etiketler karışıyordu.
// Görünüm öncekiyle aynı (lacivert kenarlık, beyaz zemin, yuvarlak köşe).
function DiagramNode({ data }) {
  return (
    <div
      style={{
        border: `1px solid ${NAVY}`,
        borderRadius: 8,
        background: '#fff',
        padding: '8px 14px',
        fontWeight: 500,
      }}
    >
      {/* İleri geçişler: sağdan çık, soldan gir — düz/yatay ok. */}
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
      {/* Geri (iade/reddet) geçişler: alttan çık/gir. */}
      <Handle type="source" position={Position.Bottom} id="bottom-source" style={{ left: '35%' }} />
      <Handle type="target" position={Position.Bottom} id="bottom-target" style={{ left: '65%' }} />
      {/* Aynı çiftteki tekrar eden (2.) geçiş: üstten çık/gir. */}
      <Handle type="source" position={Position.Top} id="top-source" style={{ left: '35%' }} />
      <Handle type="target" position={Position.Top} id="top-target" style={{ left: '65%' }} />
      {data.label}
    </div>
  )
}

// Bileşen dışında sabit referans — her render'da yeniden oluşursa React Flow
// gereksiz yeniden hesaplama uyarısı verir.
const nodeTypes = { diagram: DiagramNode }

// 4.1 Süreç Şeması Görünümü: seçilen sürecin adımlarını (node) ve geçişlerini (edge)
// React Flow ile görselleştirir. Yalnızca salt okuma — sürüklenip düzenlenmiyor.
function ProcessDiagramPage() {
  const [definitions, setDefinitions] = useState([])
  const [definitionsLoading, setDefinitionsLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedDefinition, setSelectedDefinition] = useState(null)
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [diagramLoading, setDiagramLoading] = useState(false)

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

  // Süreç seçilince: adımları ve geçişleri PARALEL çek, node/edge'lere çevir.
  async function handleSelectDefinition(definitionId) {
    setSelectedDefinition(definitionId ?? null)
    setNodes([])
    setEdges([])
    if (!definitionId) return

    setDiagramLoading(true)
    try {
      const [stepsRes, transitionsRes] = await Promise.all([
        api.get(`/api/definitions/${definitionId}/steps/`),
        api.get(`/api/definitions/${definitionId}/transitions/`),
      ])
      const steps = stepsRes.data
      const transitions = transitionsRes.data

      // Node'lar: TÜMÜ aynı Y'de (y: 100) düz bir sırada. X ekseni order*280 — oklara
      // nefes payı bıraksın diye önceki 220'den geniş tutuldu.
      const newNodes = steps.map((step) => ({
        id: String(step.id),
        type: 'diagram',
        data: { label: step.name },
        position: { x: step.order * 280, y: 100 },
      }))

      // İleri/geri ayrımı ADIM SIRASINA (order) göre yapılır, id'ye göre DEĞİL — id
      // sırası her zaman order ile birebir örtüşmek zorunda değil.
      const orderById = new Map(steps.map((s) => [s.id, s.order]))

      // Aynı (from,to) çiftini paylaşan geçiş sayısını izler — örn. bir adımdan
      // diğerine hem "Onayla" hem "Reddet" gidiyorsa, ikisi de fromOrder<toOrder
      // (ikisi de "ileri") olduğu için aksi halde aynı sağ/sol handle'ı paylaşıp tam
      // üst üste biner, etiketleri birbirine karışırdı (örn. "İm Reddet /la" gibi).
      const pairOccurrences = new Map()

      // Edge'ler: renk action_type'a göre (onay/ret/iade). Üç bant:
      //  - İLERİ + TEK (fromOrder < toOrder, çiftte ilk geçiş): 'default' (bezier),
      //    sağ/sol handle → düz, satırın üzerinde bir ok.
      //  - GERİ (fromOrder >= toOrder, iade/döngü): 'smoothstep', ALT handle çifti →
      //    kutuların altından kavis yaparak geçer.
      //  - Aynı çiftte TEKRAR eden geçiş (2. ve sonrası, ileri ya da geri fark etmez):
      //    'smoothstep', ÜST handle çifti → kutuların üstünden kavis yaparak geçer,
      //    ilk geçişle asla çakışmaz.
      const newEdges = transitions.map((t) => {
        const isBackward = orderById.get(t.from_step_id) >= orderById.get(t.to_step_id)
        const pairKey = `${t.from_step_id}->${t.to_step_id}`
        const occurrence = pairOccurrences.get(pairKey) ?? 0
        pairOccurrences.set(pairKey, occurrence + 1)
        const isDuplicatePair = occurrence > 0

        let sourceHandle
        let targetHandle
        let type
        if (isDuplicatePair) {
          sourceHandle = 'top-source'
          targetHandle = 'top-target'
          type = 'smoothstep'
        } else if (isBackward) {
          sourceHandle = 'bottom-source'
          targetHandle = 'bottom-target'
          type = 'smoothstep'
        } else {
          sourceHandle = 'right'
          targetHandle = 'left'
          type = 'default'
        }

        const color = EDGE_COLORS[t.action_type] || '#999'
        return {
          id: String(t.id),
          source: String(t.from_step_id),
          target: String(t.to_step_id),
          sourceHandle,
          targetHandle,
          label: t.action_name,
          type,
          style: { stroke: color },
          markerEnd: { type: MarkerType.ArrowClosed, color },
          // Etiket okunabilirliği: metnin altına beyaz dolgu, biraz daha büyük/kalın
          // yazı — aksi halde etiket, üzerinden geçtiği çizgiyle karışıyordu.
          labelStyle: { fontSize: 12, fontWeight: 500 },
          labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
          labelBgPadding: [6, 4],
        }
      })

      setNodes(newNodes)
      setEdges(newEdges)
    } catch (err) {
      console.error('Süreç şeması alınamadı:', err)
      message.error('Süreç şeması yüklenemedi.')
    } finally {
      setDiagramLoading(false)
    }
  }

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
      {/* Başlık bandı — ekranın ne gösterdiğini tek cümleyle anlatan alt başlıkla. */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <PartitionOutlined style={{ marginRight: 8 }} />
          Süreç Şeması
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Seçtiğiniz sürecin adımlarını ve aralarındaki izinli geçişleri akış
          diyagramı olarak gösterir (salt görüntüleme)
        </Text>
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
      ) : diagramLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      ) : (
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            boxShadow: CARD_SHADOW,
            height: 600,
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            // Salt okuma ekran: handle sayısı arttığı için (4/node) yanlışlıkla yeni
            // bağlantı sürüklenmesin diye bağlantı oluşturma kapatıldı.
            nodesConnectable={false}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
      )}
    </>
  )
}

export default ProcessDiagramPage
