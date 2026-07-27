import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import {
  DeploymentUnitOutlined,
  LockOutlined,
  UserOutlined,
} from '@ant-design/icons'
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
    // Sayfayı dikey + yatay ortala; temayla uyumlu, sade lacivert-gri gradient arka plan.
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #eef1f6 0%, #f0f2f5 50%, #e6ecf3 100%)',
      }}
    >
      {/* Kart: biraz genişçe + yumuşak gölge, ortada şık dursun. */}
      <Card style={{ width: 400, boxShadow: '0 8px 24px rgba(15, 37, 64, 0.12)' }}>
        {/* Marka / logo hissi: büyük lacivert ikon + başlık. */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <DeploymentUnitOutlined style={{ fontSize: 44, color: '#1e3a5f' }} />
          <Title level={3} style={{ marginTop: 12, marginBottom: 0 }}>
            İş Akışı Modülü
          </Title>
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
      </Card>
    </div>
  )
}

export default LoginPage
