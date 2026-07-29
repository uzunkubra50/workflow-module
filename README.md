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
    services.py     iş mantığı — geçiş doğrulama, yetki kontrolü, yürütme
    serializers.py  API veri dönüşümleri
    views.py        endpoint'ler
    admin.py        Django admin kayıtları
  Dockerfile        backend imajı
frontend/           React arayüzü
  src/pages/        Login, İş Listesi, İş Detayı ekranları
  src/api.js        axios + JWT interceptor
  Dockerfile        frontend imajı
docker-compose.yml  db + backend + frontend servisleri
CLAUDE.md           proje şartnamesi ve tasarım kararları
```

## Kurulum

**Gereksinimler:** yalnızca Docker. Veritabanı, backend ve frontend'in üçü de
container içinde çalışır; Python veya Node.js kurmanız gerekmez.

### 1. Ortam değişkenleri

```bash
cp backend/.env.example backend/.env
```

`backend/.env` dosyasını açıp değerleri doldurun. `SECRET_KEY` üretmek için:

```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

### 2. Tüm servisleri başlat

```bash
docker compose up -d --build
```

Tek komut üç servisi birden ayağa kaldırır: `db`, `backend`, `frontend`.

Veritabanı şemasını oluşturun ve bir yönetici kullanıcı ekleyin:

```bash
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
```

### 3. Süreç tanımı

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

## Geliştirme

Backend ve frontend kaynak kodu container'a bağlıdır (bind mount) — dosyayı kaydettiğinizde
değişiklik anında yansır, yeniden başlatmaya gerek yoktur.

```bash
docker compose up                     # hepsi, loglar ekranda (Ctrl+C durdurur)
docker compose up -d                  # hepsi, arka planda
docker compose logs -f backend        # tek servisin logunu izle
docker compose stop frontend          # tek servisi durdur
docker compose down                   # hepsini durdur ve kaldır (veri korunur)
```

Bağımlılık eklediğinizde (`requirements.txt` veya `package.json`) imajın yeniden
kurulması gerekir:

```bash
docker compose up -d --build
```

### Testler

```bash
docker compose exec backend python manage.py test workflow
```

57 test; ayrı bir test veritabanında çalışır, geliştirme verisine dokunmaz. Kapsam
servis katmanında yoğunlaşır (`get_available_transitions`, `can_user_perform`,
`perform_transition`) — iş kuralları orada olduğu için (Karar 7). Ayrıca aynı
kuralların HTTP katmanında doğru koda çevrildiği doğrulanır: yetkisiz aksiyon `403`,
tanımsız geçiş `400`, `PUT`/`PATCH`/`DELETE` uçlarının bulunmadığı `405`, aşılan
giriş denemesi sınırı `429`.

## Güvenlik

**Giriş denemesi sınırı.** `POST /api/token/` hız sınırlıdır (bkz. `core/views.py`).
İki sınır birlikte uygulanır, çünkü tek başına ikisi de eksiktir:

| Sınır | Oran | Neyi engeller |
|---|---|---|
| Kullanıcı adı başına | 5/dk | Tek bir hesaba yoğunlaşan deneme |
| İstemci IP'si başına | 20/dk | Denemeyi farklı hesaplara yayan saldırı |

Sınır kontrolü kimlik doğrulamasından **önce** çalışır: kova doluyken doğru şifre de
`429` alır. Yenileme ucu (`/api/token/refresh/`) bilinçli olarak sınırlanmadı — şifre
denemesi değil, arka planda otomatik çalışıyor ve ortak IP arkasındaki kullanıcıları
sessizce oturumdan düşürme riski taşıyor.

> ⚠️ **Canlı ortam için iki koşul:** (1) sayaç önbellekte tutulur; Django'nun
> varsayılanı süreç içi önbellektir, birden fazla worker'da etkin sınır katlanır —
> ortak bir önbellek (Redis/Memcached) tanımlanmalı. (2) Ters vekil arkasında
> `REMOTE_ADDR` vekilin IP'sidir; gerçek istemci IP'si için vekil başlıkları
> yapılandırılmalı, aksi halde IP sınırı tüm kullanıcıları tek kovaya koyar.

Veri, `postgres_data` adlı kalıcı bir volume'de tutulur; `docker compose down`
container'ları siler ama veriyi silmez.

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

Aksiyon butonları sabit değildir: mevcut adımdan tanımlı `WorkflowTransition` kayıtlarına
göre üretilir. Kullanıcı adımın `responsible_group`'una üye değilse butonlar yerine yetki
uyarısı gösterilir.

**Liste filtresi.** `GET /api/instances/` yalnızca kullanıcının grubunun sorumlu olduğu
adımdaki işleri döndürür; yönetici (superuser) hepsini görür. Filtre bilinçli olarak
yalnızca listeye uygulanır — detay ucu kısıtlanmaz, çünkü 2.2 ekranı kullanıcı yetkili
olmasa bile işi görüp yetki uyarısını gösterecek şekilde tasarlandı. Aksiyon yetkisi her
durumda serviste doğrulanır (`can_user_perform`).

> ⚠️ Bilinen sınırlama: sorumlu grubu olmayan bir adımda (örn. bitiş adımı) duran iş
> hiçbir grubun listesinde görünmez, yalnızca yönetici görür. "Geçmişte işlem yaptığım
> işler de listemde kalsın" kuralı kapsam onayı bekliyor.

## Kapsam

**Faz 1 — tamamlandı.** Süreç tanımı, adımlar ve geçişler, iş yürütme, işlem geçmişi,
Django admin, arayüz ekranları.

**Faz 2 — devam ediyor.** Rol/yetki kısıtı tamamlandı: bir kullanıcı yalnızca bulunduğu
adımın sorumlu grubuna üyeyse aksiyon alabilir. Kontrol servis katmanındadır
(`services.can_user_perform`), arayüzde butonların gizlenmesiyle yetinilmez — yetkisiz
istek sunucuda `403` ile reddedilir.

Tasarım kararları, faz kapsamları ve model detayları için [CLAUDE.md](CLAUDE.md).
