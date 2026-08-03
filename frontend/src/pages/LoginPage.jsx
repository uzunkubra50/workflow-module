import { Component, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Col, Form, Input, Row, Typography } from 'antd'
import {
  DeploymentUnitOutlined,
  HistoryOutlined,
  LockOutlined,
  PartitionOutlined,
  SwapOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { login } from '../api.js'
import Login3DScene from '../components/Login3DScene.jsx'

const { Title, Text } = Typography

// Sol paneldeki kısa özellik listesi - sürecin ne olduğunu tek bakışta özetler.
const FEATURES = [
  { icon: <PartitionOutlined />, text: 'Tanımlı adımlarla ilerleyen süreçler' },
  { icon: <SwapOutlined />, text: 'İzinli geçişler, keyfi atlama yok' },
  { icon: <HistoryOutlined />, text: 'Her işlem geçmişe kaydedilir' },
]

// WebGL bazı ortamlarda (eski GPU sürücüsü, sanal makine, bazı kurumsal
// makineler) kullanılamayabilir. 3D sahne çökerse - özellikle sunum sırasında -
// tüm giriş ekranını götürmesin diye düz simge rozetine sessizce geri düşülüyor.
class Scene3DBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback
    }
    return this.props.children
  }
}

// Giriş ekranı (Ant Design, split-screen). Kullanıcı adı + şifre alır, api.js'teki
// login() ile JWT token alır. Bu bileşenin mantığı (state/handleFinish) değişmedi —
// yalnızca görsel yapı (JSX) split-screen olarak yeniden düzenlendi.
function LoginPage() {
  const [error, setError] = useState('') // hata mesajı (varsa)
  const [loading, setLoading] = useState(false) // istek sürüyor mu
  const navigate = useNavigate()

  // Form doğrulamayı (zorunlu alanlar) geçip gönderilince çalışır. values = { username, password }.
  async function handleFinish(values) {
    setError('')
    setLoading(true)
    try {
      // Başarılıysa login() token'ları localStorage'a yazar.
      await login(values.username, values.password)
      navigate('/') // korumalı ana sayfaya yönlendir
    } catch (err) {
      // 429 = hız sınırı devreye girdi (çok fazla başarısız deneme). Bunu "şifre
      // hatalı" olarak göstermek yanıltıcı olur — kullanıcı beklemesi gerektiğini
      // bilmeli, aksi halde denemeye devam eder. Bekleme süresi Retry-After
      // başlığından okunur (sunucunun mesajı İngilizce olduğu için kullanılmaz).
      if (err.response?.status === 429) {
        const retryAfter = Number(err.response.headers?.['retry-after'])
        const saniye = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null
        setError(
          saniye
            ? `Çok fazla başarısız giriş denemesi. ${saniye} saniye sonra tekrar deneyin.`
            : 'Çok fazla başarısız giriş denemesi. Lütfen bir süre sonra tekrar deneyin.',
        )
      } else {
        setError('Kullanıcı adı veya şifre hatalı.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Row style={{ minHeight: '100vh' }}>
      {/* SOL panel: marka/görsel taraf. xs=0 -> mobilde tamamen gizlenir, sadece form kalır. */}
      <Col
        xs={0}
        md={12}
        style={{
          minHeight: '100vh',
          background: 'linear-gradient(160deg, #0f2540 0%, #16324f 55%, #1e3a5f 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Sade dekoratif lekeler: köşelerde hafif daha açık lacivert radial-gradient'ler. */}
        <div
          style={{
            position: 'absolute',
            top: -80,
            right: -80,
            width: 320,
            height: 320,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 70%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -100,
            left: -100,
            width: 280,
            height: 280,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 70%)',
          }}
        />

        <div style={{ textAlign: 'center', padding: '24px 40px', position: 'relative', maxWidth: 420 }}>
          <div style={{ width: '100%', height: 300, position: 'relative', marginBottom: -12 }}>
            <Scene3DBoundary
              fallback={
                <div
                  className="login-icon-badge"
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    boxShadow: '0 0 40px rgba(255,255,255,0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '86px auto 0',
                  }}
                >
                  <DeploymentUnitOutlined style={{ fontSize: 44, color: '#fff' }} />
                </div>
              }
            >
              <Login3DScene />
            </Scene3DBoundary>
          </div>

          {/* login-breathe: giriş animasyonu bitince de panel durağan kalmasın diye
              sürekli hafifçe süzülür. login-fade-in ayrı elemanlarda olduğu için
              (Title/Text) tek seferlik giriş animasyonuyla çakışmaz, üst üste biner. */}
          <div className="login-breathe">
            <Title
              level={2}
              className="login-fade-in"
              style={{ color: '#fff', marginTop: 12, marginBottom: 12, animationDelay: '0.1s' }}
            >
              İş Akışı Modülü
            </Title>
            <Text
              className="login-fade-in"
              style={{
                color: 'rgba(255,255,255,0.65)',
                fontSize: 15,
                display: 'inline-block',
                maxWidth: 320,
                animationDelay: '0.2s',
              }}
            >
              Süreçlerinizi tanımlayın, adım adım takip edin, geçmişi kayıt altına alın.
            </Text>
          </div>

          <div style={{ marginTop: 32, textAlign: 'left' }}>
            {FEATURES.map((f, i) => (
              <div
                key={f.text}
                className="login-fade-in"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 14,
                  animationDelay: `${0.3 + i * 0.1}s`,
                }}
              >
                <div
                  className="login-step-pulse"
                  style={{
                    width: 28,
                    height: 28,
                    minWidth: 28,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 13,
                    animationDelay: `${-(i * 1.2)}s`,
                  }}
                >
                  {f.icon}
                </div>
                <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13.5 }}>{f.text}</Text>
              </div>
            ))}
          </div>
        </div>
      </Col>

      {/* SAĞ panel: form. Beyaz zemin, dikey+yatay ortalanmış, max-width sınırlı. */}
      <Col
        xs={24}
        md={12}
        style={{
          minHeight: '100vh',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="login-fade-in" style={{ width: '100%', maxWidth: 360, padding: 24 }}>
          <div style={{ marginBottom: 24 }}>
            <Title level={3} style={{ marginBottom: 4 }}>
              Giriş Yap
            </Title>
            <Text style={{ color: 'rgba(0, 0, 0, 0.45)' }}>
              Devam etmek için giriş yapın
            </Text>
          </div>

          {/* Hata varsa formun üstünde göster. */}
          {error && (
            <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />
          )}

          {/* disabled={loading}: istek sürerken tüm alanlar kilitlenir. Enter da formu gönderir. */}
          <Form layout="vertical" onFinish={handleFinish} disabled={loading}>
            <Form.Item
              label="Kullanıcı Adı"
              name="username"
              rules={[{ required: true, message: 'Bu alan zorunludur.' }]}
            >
              <Input prefix={<UserOutlined />} autoComplete="username" />
            </Form.Item>

            <Form.Item
              label="Şifre"
              name="password"
              rules={[{ required: true, message: 'Bu alan zorunludur.' }]}
            >
              <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              {/* loading: istek sürerken buton spinner gösterir. */}
              <Button type="primary" htmlType="submit" block loading={loading}>
                Giriş Yap
              </Button>
            </Form.Item>
          </Form>

          {/* Soluk dipnot. */}
          <div
            style={{
              textAlign: 'center',
              marginTop: 16,
              color: 'rgba(0, 0, 0, 0.35)',
              fontSize: 12,
            }}
          >
            © 2026 İş Akışı Modülü
          </div>
        </div>
      </Col>
    </Row>
  )
}

export default LoginPage
