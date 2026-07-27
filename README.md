# İş Akışı (Workflow) Modülü

Dijital arşiv sistemlerine entegre edilebilen, **bağımsız** çalışan bir iş akışı modülü.
Jira benzeri bir durum makinesi mantığıyla çalışır: bir "iş" tanımlı adımlardan geçer,
yalnızca izin verilen geçişler üzerinden ilerler ve her hareket kayıt altına alınır.

Modül belirli bir arşiv sistemine bağımlı değildir; istenirse bağlantı noktaları
(`document_ref`, `unit`, `responsible_group`) üzerinden başka bir sisteme entegre edilir.

## Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| Backend | Django 6 + Django REST Framework |
| Veritabanı | PostgreSQL 16 |
| Kimlik doğrulama | JWT (SimpleJWT) + Session (admin için) |
| API dokümantasyonu | drf-spectacular (Swagger UI + Redoc) |
| Frontend | React 19 + Vite + Ant Design |
| Altyapı | Docker + docker compose |

## Klasör Yapısı

```
backend/            Django tarafı
  core/             proje ayarları (settings, urls)
  workflow/         iş akışı uygulaması
    models.py       6 model (Unit, Definition, Step, Transition, Instance, Action)
    services.py     iş mantığı — geçiş doğrulama ve yürütme
    serializers.py  API veri dönüşümleri
    views.py        endpoint'ler
    admin.py        Django admin kayıtları
frontend/           React arayüzü
  src/pages/        Login, İş Listesi, İş Detayı ekranları
  src/api.js        axios + JWT interceptor
docker-compose.yml  db + backend servisleri
CLAUDE.md           proje şartnamesi ve tasarım kararları
```

## Kurulum

**Gereksinimler:** Docker, Node.js

### 1. Ortam değişkenleri

```bash
cp backend/.env.example backend/.env
```

`backend/.env` dosyasını açıp değerleri doldurun. `SECRET_KEY` üretmek için:

```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

### 2. Backend (Docker)

```bash
docker compose up -d --build
```

Veritabanı şemasını oluşturun ve bir yönetici kullanıcı ekleyin:

```bash
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

### 4. Süreç tanımı

Faz 1'de süreç şablonları Django admin üzerinden girilir:
`http://localhost:8001/admin/` → Workflow definition (süreç) → adımlar ve geçişler.
En az bir adımın `is_start` işaretli olması gerekir; yeni işler o adımdan başlar.

## Portlar

| Servis | Adres |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8001 |
| Django admin | http://localhost:8001/admin/ |
| Swagger UI | http://localhost:8001/api/docs/ |
| PostgreSQL | localhost:5433 |

## API

Tüm `/api/` uçları kimlik doğrulama gerektirir (`Authorization: Bearer <access_token>`).

| Metot | Adres | Açıklama |
|---|---|---|
| POST | `/api/token/` | Giriş — access + refresh token döner |
| POST | `/api/token/refresh/` | Access token yenileme |
| GET | `/api/instances/` | İş listesi |
| POST | `/api/instances/` | Yeni iş başlat (başlangıç adımı otomatik atanır) |
| GET | `/api/instances/{id}/` | İş detayı + o an yapılabilecek geçişler |
| POST | `/api/instances/{id}/perform-action/` | Geçişi uygula (`transition_id`, opsiyonel `note`) |
| GET | `/api/instances/{id}/actions/` | İşlem geçmişi (audit trail) |
| GET | `/api/definitions/` | Aktif süreç tanımları |

İş akışı bütünlüğü için `PUT`/`PATCH`/`DELETE` uçları **bilinçli olarak yoktur** — bir iş
yalnızca tanımlı geçişlerle ilerleyebilir.

### API Dokümantasyonu (Swagger / Redoc)

Uçları taramak ve canlı denemek için:

| Adres | Açıklama |
|---|---|
| `/api/docs/` | Swagger UI — "Try it out" ile canlı istek atma |
| `/api/redoc/` | Redoc — okunması daha rahat, dokümantasyon görünümü |
| `/api/schema/` | Ham OpenAPI 3 şeması (Postman/Insomnia'ya import edilebilir) |

Korumalı uçları Swagger'da denemek için: `POST /api/token/` ile giriş yapıp dönen
`access` değerini sayfanın üstündeki **Authorize** düğmesine `Bearer <access_token>`
biçiminde girin.

## Ekranlar

- **Giriş** — JWT ile kimlik doğrulama
- **İş Akışlarım** — istatistik kartları, durum filtresi, iş listesi, yeni iş başlatma
- **İş Detayı** — süreç ilerleme çubuğu, dinamik aksiyon butonları, işlem geçmişi

## Kapsam

Faz 1 tamamlandı: süreç tanımı, adımlar ve geçişler, iş yürütme, işlem geçmişi,
Django admin, arayüz ekranları.

Tasarım kararları, faz kapsamları ve model detayları için [CLAUDE.md](CLAUDE.md).
