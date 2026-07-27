import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { login } from '../api.js'

const { Title } = Typography

// Giriş ekranı (Ant Design). Kullanıcı adı + şifre alır, api.js'teki login() ile JWT token alır.
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
    // Sayfayı dikey + yatay ortala, hafif gri arka plan.
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Card style={{ width: 360 }}>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
          İş Akışı Modülü
        </Title>

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
      </Card>
    </div>
  )
}

export default LoginPage
