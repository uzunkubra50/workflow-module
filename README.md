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
| Frontend | React 19 + Vite + Ant Design 6 |
| Grafik / diyagram | Recharts (panom), React Flow (süreç şeması), Three.js (giriş ekranı) |
| Altyapı | Docker + docker compose |

## Klasör Yapısı

```
backend/            Django tarafı
  core/             proje ayarları (settings, urls, hız sınırlı giriş ucu)
  workflow/         iş akışı uygulaması
    models.py       9 model (aşağıdaki tabloya bakınız)
    services.py     iş mantığı — geçiş doğrulama, yetki kontrolü, yürütme,
                    vekalet çözümleme, iptal, eskalasyon
    serializers.py  API veri dönüşümleri
    views.py        endpoint'ler
    admin.py        Django admin kayıtları
    tests.py        66 test
    management/commands/check_overdue.py   SLA taraması (elle tetiklenir)
  Dockerfile        backend imajı
frontend/           React arayüzü
  src/pages/        9 ekran (Login, İş Listesi, İş Detayı, Panom, Süreç Şeması,
                    Süreç Tasarla, Vekalet, Rol Yönetimi, Süreç Yetkileri)
  src/components/   AppLayout, ProtectedRoute, Login3DScene
  src/api.js        axios + JWT interceptor
  Dockerfile        frontend imajı
docker-compose.yml  db + backend + frontend servisleri
CLAUDE.md           proje şartnamesi ve tasarım kararları
```

## Veri Modeli

| Model | Amaç |
|---|---|
| `Unit` | Birim — süreç tanımının bağlanabileceği opsiyonel organizasyon birimi |
| `WorkflowDefinition` | Süreç şablonu (`name`, `code`, `unit`, `is_active`) |
| `WorkflowStep` | Şablona ait adım — sorumlu grup, sıra, başlangıç/bitiş işareti, SLA süresi, eskalasyon grubu |
| `WorkflowTransition` | İzinli geçiş — hangi adımdan hangi adıma, aksiyon adı ve tipi (onayla/reddet/iade) |
| `WorkflowInstance` | Yürüyen gerçek iş — mevcut adım, durum, konu, açıklama, belge referansı |
| `WorkflowAction` | İşlem geçmişi / audit trail — kim, ne zaman, hangi adımdan hangi adıma, not |
| `Delegation` | Vekalet — bir kullanıcının belirli tarih aralığında yerine bakacak kişi |
| `GroupDefinitionPermission` | Hangi grubun hangi süreçte iş başlatabileceği |
| `Notification` | Uygulama içi bildirim (adım değişimi, eskalasyon) |

`WorkflowInstance.document_ref` bilinçli olarak ForeignKey **değildir** — ilgili belge
başka bir veritabanında tutuluyor olabilir, gerçek bir FK modülün bağımsızlığını bozardı.

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

Süreç şablonları iki yoldan tanımlanabilir:

- **Arayüzden (Süreç Tasarla ekranı)** — `http://localhost:5173/process-designer`.
  Staff/superuser yetkisi gerekir. Süreç, adımlar ve geçişler tablolardan eklenir,
  "Doğrula" düğmesi tanımın tutarlı olup olmadığını kontrol eder.
- **Django admin'den** — `http://localhost:8001/admin/` → Workflow definition →
  adımlar ve geçişler.

Her iki yolda da en az bir adımın `is_start`, en az birinin `is_end` işaretli olması
gerekir; yeni işler `is_start` adımından başlar.

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

66 test; ayrı bir test veritabanında çalışır, geliştirme verisine dokunmaz. Kapsam
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

## Yetkilendirme Modeli

Yetki tek bir yerde değil, birbirini tamamlayan dört kuralda toplanır. Hepsinin
karşılığı servis katmanındadır — arayüzdeki gizleme yalnızca kolaylıktır, asıl
kontrol sunucudadır.

| Kural | Nerede | Ne yapar |
|---|---|---|
| **Adım sorumluluğu** | `services.can_user_perform` | Kullanıcı, adımın `responsible_group`'una üye değilse aksiyon alamaz. Grup atanmamışsa adım herkese açıktır. |
| **Vekalet** | `services.get_effective_users` | Tarih aralığı bugünü kapsayan aktif vekalet varsa, vekil temsil ettiği kişinin gruplarıyla da işlem yapabilir. |
| **Süreç başlatma** | `services.get_allowed_definitions` | Bir süreç için hiç `GroupDefinitionPermission` kaydı yoksa süreç "kısıtlanmamış"tır ve genel `workflow.add_workflowinstance` izni geçerlidir. En az bir kayıt varsa süreç yalnızca o gruplara açılır. |
| **Yönetim ekranları** | `IsStaffUser` (DRF izin sınıfı) | Süreç Tasarla, Rol Yönetimi ve Süreç Yetkileri ekranlarının uçları staff/superuser ister. |

**Vekalet ile eskalasyon farklı mekanizmalardır.** Vekalet bir *yetki devridir* —
vekil, temsil ettiği kişinin yerine işlem yapar. Eskalasyon ise *ek görünürlüktür*:
süre aşıldığında iş orijinal sorumludan alınmaz, yalnızca eskalasyon grubuna bildirim
düşer.

## İş Akışı Kuralları

**Geçiş doğrulama.** Bir işin ilerleyip ilerleyemeyeceği, `current_step`'ten tanımlı
`WorkflowTransition` kayıtlarına bakılarak servis katmanında doğrulanır — veritabanı
kısıtı olarak değil (Karar 7). Böylece kural, Faz 3'teki koşullu dallanmayla birlikte
kod değiştirilerek geliştirilebilir.

**SLA ve gecikme.** `WorkflowStep.max_duration_days` doluysa, iş o adıma girdiği andan
itibaren süre işler. `WorkflowInstance.is_overdue` süre aşımını hesaplar; arayüzde iş
kırmızı vurgulanır. Alan boşsa o adımda süre takibi yapılmaz.

**Eskalasyon.** `check_overdue` komutu, süresi geçmiş ve henüz eskalasyona uğramamış
aktif işleri tarar, adımın `escalation_group`'una bildirim gönderir. Eskalasyon grubu
atanmamışsa iş **`escalated` işaretlenmeden atlanır** — ileride o adıma grup atanırsa
halen gecikmiş olan iş yeniden yakalanabilsin diye.

**İptal.** Tanımlı geçişlerden bağımsız ayrı bir akıştır: yalnızca işi açan kişi veya
superuser, yalnızca iş aktifken ve gerekçe girerek iptal edebilir. `current_step`
değişmez (hangi adımda iptal edildiği kayıtta kalır), yalnızca durum `cancelled`
olur ve işlem geçmişine `cancel` tipinde bir kayıt düşer.

## API

Tüm `/api/` uçları kimlik doğrulama gerektirir (`Authorization: Bearer <access_token>`).

**Kimlik**

| Metot | Adres | Açıklama |
|---|---|---|
| POST | `/api/token/` | Giriş — access + refresh token döner (hız sınırlı) |
| POST | `/api/token/refresh/` | Access token yenileme |
| GET | `/api/users/me/` | Oturumdaki kullanıcının bilgileri |

**İşler**

| Metot | Adres | Açıklama |
|---|---|---|
| GET | `/api/instances/` | İş listesi (kullanıcının ilgili olduğu işler) |
| POST | `/api/instances/` | Yeni iş başlat (başlangıç adımı otomatik atanır) |
| GET | `/api/instances/{id}/` | İş detayı + o an yapılabilecek geçişler |
| POST | `/api/instances/{id}/perform-action/` | Geçişi uygula (`transition_id`, opsiyonel `note`) |
| POST | `/api/instances/{id}/cancel/` | İşi iptal et (gerekçe zorunlu, yalnızca işi açan kişi veya superuser) |
| GET | `/api/instances/{id}/actions/` | İşlem geçmişi (audit trail) |
| GET | `/api/instances/can-create/` | Kullanıcı yeni iş açabilir mi (buton koşullu gösterilir) |

**Süreç tanımları**

| Metot | Adres | Açıklama |
|---|---|---|
| GET | `/api/definitions/` | Süreç tanımları (staff: pasifler dahil) |
| POST · PATCH · DELETE | `/api/definitions/` · `/{id}/` | Süreç oluştur/düzenle/sil — **staff-only** |
| GET | `/api/definitions/allowed/` | Kullanıcının iş başlatabileceği süreçler |
| GET | `/api/definitions/{id}/steps/` · `/transitions/` | Süreç şeması için adım ve geçiş listesi |
| GET | `/api/definitions/{id}/validate/` | Tanım tutarlılık kontrolü (`{"valid": bool, "errors": []}`) |
| GET | `/api/definitions/{id}/analytics/` | Panom verileri — adım dağılımı, ortalama süre |
| CRUD | `/api/admin/steps/` · `/api/admin/transitions/` | Adım ve geçiş yönetimi — **staff-only** |

**Vekalet, bildirim ve yetki**

| Metot | Adres | Açıklama |
|---|---|---|
| GET · POST · DELETE | `/api/delegations/` | Verdiğim vekaletler |
| GET | `/api/delegations/received/` | Bana verilen vekaletler (salt okuma) |
| GET | `/api/notifications/` | Bildirim listesi |
| GET | `/api/notifications/unread-count/` | Okunmamış bildirim sayısı (menü rozeti) |
| POST | `/api/notifications/{id}/mark-read/` · `/mark-all-read/` | Okundu işaretle |
| GET | `/api/users/` | Kullanıcı listesi (staff: grup/izin bilgisiyle) |
| POST | `/api/users/` | Yeni kullanıcı hesabı — **staff-only** |
| PATCH | `/api/users/{id}/groups/` · `/permissions/` · `/active/` | Grup, izin ve hesap durumu — **staff-only** |
| GET · POST · DELETE | `/api/groups/` | Grup listesi; oluşturma/silme **staff-only** |
| GET | `/api/groups/definition_matrix/` | Grup × süreç yetki matrisi — **staff-only** |
| PATCH | `/api/groups/{id}/definitions/` | Grubun süreç yetkilerini güncelle — **staff-only** |

İşler için `PUT`/`PATCH`/`DELETE` uçları **bilinçli olarak yoktur** — bir iş yalnızca
tanımlı geçişlerle ilerleyebilir, alanları doğrudan düzenlenemez. İptal bile ayrı bir
uçtan, gerekçe zorunluluğuyla ve geçmişe kaydedilerek yapılır.

> **Not.** Staff-only kısıtı DRF izin sınıfı (`IsStaffUser`) ile uygulanır. Bu kural
> önce `get_permissions()` içinden exception fırlatılarak yazılmıştı; çalışıyordu ama
> drf-spectacular şema üretirken aynı metodu istek olmadan çağırdığı için `/api/schema/`
> ucunu komple `403`'e düşürüyordu. `get_permissions()` yan etkisiz olmalı — reddetme
> işini DRF'nin kendi `has_permission` döngüsü yapar.

### API Dokümantasyonu (Swagger / Redoc)

Uçları taramak ve canlı denemek için:

| Adres | Açıklama |
|---|---|
| `/api/docs/` | Swagger UI — "Try it out" ile canlı istek atma |
| `/api/redoc/` | Redoc — okunması daha rahat, dokümantasyon görünümü |
| `/api/schema/` | Ham OpenAPI 3 şeması (Postman/Insomnia'ya import edilebilir) |

Korumalı uçları Swagger'da denemek için:

1. `POST /api/token/` → **Try it out** → kullanıcı adı ve şifre → **Execute**
2. Yanıttaki `access` değerini kopyalayın (tırnaklar hariç)
3. Sayfanın üstündeki **Authorize** düğmesine basıp değeri yapıştırın

> ⚠️ Authorize alanına **yalnızca token'ı** yapıştırın. Şema `http/bearer` olarak
> tanımlı olduğu için `Bearer ` önekini Swagger kendisi ekler; elle yazarsanız
> `Bearer Bearer <token>` gider ve istek `401` döner.

## Ekranlar

| Ekran | Adres | Açıklama |
|---|---|---|
| **Giriş** | `/login` | JWT ile kimlik doğrulama |
| **İş Akışlarım** | `/` | İstatistik kartları, arama, durum/süreç filtresi, liste ve Kanban görünümü, CSV dışa aktarma |
| **İş Detayı** | `/instances/{id}` | Süreç ilerleme çubuğu, dinamik aksiyon butonları, iptal, işlem geçmişi |
| **Panom** | `/analytics` | Süreç bazlı analitik — adım dağılımı, ortalama bekleme süresi, gecikmeler |
| **Süreç Şeması** | `/diagram` | Tanımlı sürecin kutu-ok diyagramı (React Flow) |
| **Süreç Tasarla** | `/process-designer` | Arayüzden süreç/adım/geçiş tanımlama, "Doğrula" — *staff-only* |
| **Vekaletlerim** | `/delegations` | Vekalet verme, süre belirleme, bana verilenleri görme |
| **Rol Yönetimi** | `/users` | Kullanıcı ve grup yönetimi, iş başlatma izni — *staff-only* |
| **Süreç Yetkileri** | `/definition-permissions` | Grup × süreç yetki matrisi — *staff-only* |

Aksiyon butonları sabit değildir: mevcut adımdan tanımlı `WorkflowTransition` kayıtlarına
göre üretilir. Kullanıcı adımın `responsible_group`'una üye değilse butonlar yerine yetki
uyarısı gösterilir.

Giriş ekranının sol panelindeki 3D sahne (Three.js) bir hata sınırı (error boundary)
içine alınmıştır: WebGL kullanılamayan makinelerde sahne çökse bile giriş ekranı ayakta
kalır, yerine düz bir simge gösterilir.

**Liste filtresi.** `GET /api/instances/` kullanıcının *ilgili olduğu* işleri döndürür —
iki ölçüt VEYA ile birleşir:

1. **Şu an bende olan:** mevcut adımın sorumlu grubu, kullanıcının gruplarından biri.
2. **İşlem yaptığım:** geçmişte bu işte bir aksiyon almış olmak.

Birinci ölçüt "kullanıcının grupları" değil, `services.get_effective_users(user)`
üzerinden **kendisi + vekaleten temsil ettiği kişilerin** gruplarının birleşimidir.
Bu ayrım önce atlanmıştı: `can_user_perform` vekaleti doğru uyguladığı için detay
ekranında butonlar çıkıyordu, ama liste filtresi vekaleti bilmediğinden vekil işi
listede hiç bulamıyordu. **Aynı yetki kuralı iki ayrı yerde yazılırsa biri
güncellenip diğeri unutulabilir** — yeni bir yetki kuralı eklenirken her iki yerin
de gözden geçirilmesi gerekir.

İkinci ölçüt olmadan ekran tutarsız kalıyor: iş bitince sorumlu grubu olmayan bitiş
adımına geçtiği için hiç kimsenin listesinde kalmıyor, dolayısıyla "Tamamlanan" ve
"Reddedilen" filtreleri normal kullanıcı için kalıcı olarak boş görünüyordu — kararı
veren kişi bile kendi onayladığı işi göremiyordu.

Yönetici (superuser) hepsini görür. Filtre bilinçli olarak yalnızca listeye uygulanır —
detay ucu kısıtlanmaz, çünkü 2.2 ekranı kullanıcı yetkili olmasa bile işi görüp yetki
uyarısını gösterecek şekilde tasarlandı. Aksiyon yetkisi her durumda serviste doğrulanır
(`can_user_perform`).

> **Açık kalan nokta.** `WorkflowInstance.created_by` alanı eklendi ve iş açılırken
> dolduruluyor, ancak liste filtresi henüz bu ölçütü kullanmıyor. Dolayısıyla bir işi
> açıp hiç işlem yapmayan ve sorumlu grupta olmayan kullanıcı, açtığı işi listede
> göremez. Filtreye `Q(created_by=user)` eklemek yeterli olur; kapsam sorusu olarak
> duruyor.

## Kapsam

**Faz 1 — tamamlandı.** Süreç tanımı, adımlar ve geçişler, iş yürütme, işlem geçmişi,
Django admin, arayüz ekranları.

**Faz 2 — tamamlandı.**

| Madde | Durum |
|---|---|
| Rol/yetki kısıtı (`can_user_perform`) | ✅ |
| SLA — adım bazlı süre, gecikme vurgusu | ✅ |
| Eskalasyon — süre aşılınca eskalasyon grubuna bildirim | ✅ |
| Panom / analitik ekranı | ✅ |
| Arayüzden süreç tasarlama | ✅ |
| Süreç şeması görünümü | ✅ |

Rol/yetki kısıtı: bir kullanıcı yalnızca bulunduğu adımın sorumlu grubuna üyeyse
(veya o gruptaki birine vekaleten) aksiyon alabilir. Kontrol servis katmanındadır
(`services.can_user_perform`); arayüzde butonların gizlenmesiyle yetinilmez —
yetkisiz istek sunucuda `403` ile reddedilir.

**Faz 2 kapsamı dışında eklenenler.** Vekalet (`Delegation`), uygulama içi bildirim
(`Notification`), iş iptali (gerekçeli, geçmişe kaydedilir), grup × süreç yetki
matrisi, kullanıcı/grup yönetim ekranı.

**Faz 3 — kapsam dışı.** Koşullu dallanma (`WorkflowTransition.condition`), paralel
onay (`WorkflowApproval`), dosya ekleme (`WorkflowAttachment`), e-posta bildirimi.

### Bilinen sınırlar

- **Eşzamanlılık.** Aynı iş üzerinde iki kullanıcı aynı anda aksiyon alırsa kilitleme
  yapılmaz; ilk işlem adımı değiştireceği için ikincisi geçersiz durum değişikliği
  olarak reddedilir (Karar 9).
- **Versiyonlama.** Bir süreç tanımı güncellendiğinde eski sürüm ayrıca saklanmaz.
  Devam eden işler `on_delete=PROTECT` ile korunur — kullanımdaki adım/geçiş silinemez
  (Karar 8).
- **SLA taraması zamanlanmış değil.** `check_overdue` komutu cron/Celery ile değil elle
  çalıştırılır: `docker compose exec backend python manage.py check_overdue`
- **Audit trail.** Kim/ne zaman/hangi aksiyon kaydedilir; IP adresi ve değiştirilemez
  (tamper-proof) loglama kapsam dışıdır.

Tasarım kararları, faz kapsamları ve model detayları için [CLAUDE.md](CLAUDE.md).
