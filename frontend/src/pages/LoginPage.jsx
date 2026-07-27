import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Col, Form, Input, Row, Typography } from 'antd'
import { DeploymentUnitOutlined, LockOutlined, UserOutlined } from '@ant-design/icons'
import { login } from '../api.js'

const { Title, Text } = Typography

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
    } catch {
      // login hata fırlatırsa kullanıcıya anlaşılır mesaj göster.
      setError('Kullanıcı adı veya şifre hatalı.')
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
          background: '#0f2540',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Sade dekoratif leke: köşede hafif daha açık bir lacivert radial-gradient. */}
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

        <div style={{ textAlign: 'center', padding: 40, position: 'relative' }}>
          <DeploymentUnitOutlined style={{ fontSize: 72, color: '#fff' }} />
          <Title level={2} style={{ color: '#fff', marginTop: 24, marginBottom: 12 }}>
            İş Akışı Modülü
          </Title>
          <Text
            style={{
              color: 'rgba(255,255,255,0.65)',
              fontSize: 15,
              display: 'inline-block',
              maxWidth: 320,
            }}
          >
            Süreçlerinizi tanımlayın, adım adım takip edin, geçmişi kayıt altına alın.
          </Text>
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
        <div style={{ width: '100%', maxWidth: 360, padding: 24 }}>
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
