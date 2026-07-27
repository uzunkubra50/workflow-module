# İş Akışı (Workflow) Modülü

## Proje Nedir
Dijital arşiv sistemlerine entegre edilebilecek, **bağımsız** bir Django uygulaması.
Jira benzeri bir durum makinesi mantığı: bir "iş" (WorkflowInstance) tanımlı adımlardan
(Step) geçerek ilerler, izinli geçişler (Transition) üzerinden hareket eder, her geçiş
kayıt altına alınır (Action/audit trail).

Modül belirli bir arşiv sistemine sıkı bağımlı DEĞİLDİR — kendi başına çalışabilir,
istenirse Bölüm 6'daki bağlantı noktaları üzerinden başka bir sisteme entegre edilir.

## Teknoloji Yığını
- Django (proje adı: `core`, app adı: `workflow`)
- PostgreSQL — SQLite'a düşme opsiyonu YOK, geliştirme ortamında bile Postgres kullanılır
- Docker + docker-compose (db + backend servisleri)
- Faz 1'de arayüz yok — Django admin kullanılır, ayrı bir frontend yazılmaz

## Klasör Yapısı
```
backend/            Django tarafı — core/, workflow/, manage.py, requirements.txt,
                    Dockerfile, .env (venv de burada)
frontend/           React + Vite arayüzü (Faz 1 sonrası eklendi)
docker-compose.yml  kökte durur (db + backend servislerini yönetir)
```
Django komutları `backend/` içinden çalıştırılır (örn. `cd backend && python manage.py ...`).

## Beş Temel Kavram (Bölüm 3)
| Kavram | Anlamı |
|---|---|
| Tanım (Definition) | Sürecin şablonu. Bir kere oluşturulur, birçok işte tekrar kullanılır. |
| Adım (Step) | Sürecin durakları. Örnek: "Teknik İnceleme", "Müdür Onayı". |
| Geçiş (Transition) | Adımlar arasında izin verilen hareketler. |
| Örnek (Instance) | Şablonun, gerçek bir işe uygulanmış hali. |
| Geçmiş (History) | Kim, ne zaman, hangi işlemi yaptı — audit trail. |

## Somut Senaryo (Bölüm 4) — Faz 1 test senaryosu
"Ruhsat Başvuru Süreci" örneği üzerinden kurgulanacak:

1. **Başvuru Alındı** (Evrak Birimi) → otomatik geçiş →
2. **Evrak Kontrolü** (Evrak Birimi) → "Onayla" ile ileri, "Eksik Belge" ile Adım 1'e iade →
3. **Teknik İnceleme** (Teknik Birim) → "Onayla" ile ileri, "İade" ile Adım 2'ye iade →
4. **Müdür Onayı** (Müdür) → "Onayla" ile **Sonuçlandı: Onaylandı**, "Reddet" ile **Sonuçlandı: Reddedildi**

Önemli: süreç düz bir çizgi değil — iade/geri dönüş ihtimalleri de modellenmeli. Bu geri
dönüşler `WorkflowTransition` kayıtlarıyla birebir karşılık bulur.

## Uyulması Gereken Tasarım Kararları (Bölüm 8 — TAM LİSTE)

**Karar 1 — Bağımsız geliştirme.** Modül, mevcut sistemlerden bağımsız, kendi başına
çalışabilen bir Django uygulaması olarak geliştirilecek. Gerçek bir arşiv sistemine
entegrasyon istendiğinde Bölüm 6'daki bağlantı noktaları kullanılabilir. Bu yüzden
`WorkflowInstance.document_ref` bilinçli olarak gerçek bir ForeignKey DEĞİLDİR — aksi
halde modül, belgenin tutulduğu veritabanına bağımlı olurdu.

**Karar 2 — Yapılandırılabilirlik.** Faz 1'de süreç tanımları (adımlar, geçişler) Django
admin panelinden girilecek; arayüzden ayrı bir "süreç tasarlama ekranı" YAZILMAYACAK.
Bu ekran (1.2), kapsamı belirgin şekilde artıran bir Faz 2 işidir.

**Karar 3 — Dosya ekleme.** Faz 1'de sürece dosya/belge eklenmesi kapsam dışı; yalnızca
meta veri ve belge bağlantısı olacak. Dosya yönetimi ayrı bir altyapı gerektirdiği için
Faz 3'e bırakılıyor.

**Karar 4 — Bildirim.** Faz 1'de e-posta veya uygulama içi bildirim YOK; kullanıcı
sisteme girip kendisine atanan işleri listeden görecek. Bildirim altyapısı Faz 3'e
bırakılıyor.

**Karar 5 — Onay tipi.** Faz 1'de yalnızca sıralı onay (bir adımda tek sorumlu) yeterli
kabul edilecek; paralel onay (aynı adımda birden fazla kişinin onayı) veri modelini
belirgin şekilde karmaşıklaştırdığı için Faz 3'e bırakılıyor.

**Karar 6 — Örnek süreç seçimi.** "Ruhsat Başvuru Süreci" temsili örnek olarak seçildi
(bkz. yukarıdaki Somut Senaryo). Faz 1'in test senaryosu bu örnek üzerinden kurulacak.

**Karar 7 — Geçiş doğrulama mantığı.** Bir `WorkflowInstance`'ın bir sonraki adıma geçip
geçemeyeceği, yalnızca `current_step`'ten tanımlı `WorkflowTransition` kayıtlarına
bakılarak **servis/serializer katmanında** doğrulanacaktır — veritabanı kısıtı OLARAK
DEĞİL. Neden: bu kural Faz 3'teki koşullu dallanma ile zamanla değişebilir.

**Karar 8 — Tanım değişikliği ve versiyonlama.** Bir adıma veya geçişe bağlı en az bir
aktif örnek varsa, o adım/geçiş silinemez (`current_step` alanı `on_delete=PROTECT` ile
korunur) — devam eden bir iş, tanım güncellenirken yarıda kalmaz. Tam versiyonlama
(tanımın eski/yeni sürümlerini ayrı saklamak) Faz 1 kapsamı DIŞINDADIR.

**Karar 9 — Eşzamanlılık.** Aynı iş üzerinde birden fazla kullanıcının aynı anda aksiyon
alması senaryosu (race condition) Faz 1 kapsamı DIŞINDADIR; ilk işlenen aksiyondan sonra
adım değişeceği için ikinci aksiyon geçersiz bir durum değişikliği olarak reddedilecektir.
Kilitleme (locking) mekanizması şimdilik yazılmayacak.

**Ek not — Rol/grup.** Rol ve sorumlu grup için ayrı bir model yazılmayacak; Django'nun
hazır `django.contrib.auth.models.Group` yapısı kullanılacak.

**Ek not — document_ref.** `document_ref` bilinçli olarak bir ForeignKey değil, serbest
bir kimlik alanıdır (CharField). İlgili belge başka bir veritabanında tutuluyor olabilir;
gerçek bir FK iki tablonun aynı veritabanında olmasını gerektirir ve bu, Karar 1'deki
bağımsızlık kararıyla çelişir.

## Beş Model (Bölüm 5)

**Şablon (tanım) modelleri — bir kez oluşturulur, tekrar tekrar kullanılır:**

| Model | Amaç | Alanlar |
|---|---|---|
| `WorkflowDefinition` | Süreç şablonu | `name`, `code`, `unit` (FK, opsiyonel), `is_active` |
| `WorkflowStep` | Şablona ait adımlar | `definition` (FK), `name`, `order`, `responsible_group` (FK → Group), `is_start`, `is_end` |
| `WorkflowTransition` | İzinli geçişler | `definition` (FK), `from_step` (FK → Step), `to_step` (FK → Step), `action_name`, `action_type` (enum: onayla/reddet/iade) |

**Çalışma zamanı (gerçek veri) modelleri — her iş için yeniden üretilir:**

| Model | Amaç | Alanlar |
|---|---|---|
| `WorkflowInstance` | Gerçek yürüyen süreç | `definition` (FK), `subject`, `current_step` (FK, **PROTECT**), `status` (enum: aktif/tamamlandı/iptal), `assigned_to` (FK → User), `document_ref` (opsiyonel, FK DEĞİL) |
| `WorkflowAction` | İşlem geçmişi / audit trail | `instance` (FK), `from_step`, `to_step`, `performed_by` (FK → User), `note`, `created_at` |

> Not: `WorkflowDefinition.unit` alanının neye FK olacağı doküman içinde netleşmemiş —
> modül bağımsız çalışacağı için muhtemelen app içinde basit bir `Unit` modeli ya da
> serbest bir kod alanı olacak. Bunu netleştirmeden model kodunu yazma, önce sor.

## Entegrasyon Noktaları (Bölüm 6, ileride kullanılacak)
- Belge → İş Akışı: `WorkflowInstance.document_ref` (serbest kimlik, FK değil)
- Birim → Süreç Tanımı: `WorkflowDefinition.unit`
- Kullanıcı/Grup → Adım Sorumluluğu: `WorkflowStep.responsible_group`
- Belge Meta Verisi → Süreç Ekranı: salt okunur gösterim (Faz 1'de detay ekranında)

## Faz 1 Ekran Şemaları (Bölüm 9 — sırayla geliştirilecek)

- **1.1 Süreç Tanımlama** — Django admin üzerinden, özel arayüz YAZILMAYACAK. Yönetici
  süreç adı/kodu/birimi, adımları (ad, sıra, sorumlu grup, başlangıç/bitiş işareti) ve
  geçişleri (hangi adımdan hangi adıma, aksiyon adı) burada tanımlar.
- **2.1 İş Akışlarım (Liste)** — kullanıcının kendisine/grubuna atanan işleri gördüğü ana
  ekran. Süreç adı, ilgili belge, mevcut adım, durum, atanma tarihi gösterilir; süreç
  tanımına ve duruma göre filtrelenir; satıra tıklayınca detaya gider.
- **2.2 İş Akışı Detayı** — süreç adı, mevcut adım, sorumlu grup, bağlı belge/meta veri
  (salt okunur), geçmişe bağlantı. Aksiyon butonları mevcut adımın izinli geçişlerine göre
  **dinamik** üretilir (örn. "Onayla" ileri, "İade Et" geri); aksiyon sırasında opsiyonel
  not girilebilir.
- **2.3 İşlem Geçmişi** — detay ekranının alt sekmesi (ayrı sayfa değil). Tarih/saat,
  işlemi yapan kullanıcı, hangi adımdan hangi adıma geçildiği, aksiyon tipi ve not.
- **3.1 Sürece Bağlama** — mevcut belge listesine küçük bir ek. Belge satırına "Süreç
  Başlat" aksiyonu eklenir; hangi `WorkflowDefinition`'ın kullanılacağı seçilir,
  başlangıç adımı otomatik atanır.

*(4.1 Süreç Şeması Görünümü ve tüm 10.1/10.2 maddeleri Faz 2/3 — şimdi kodlanmayacak,
sadece referans olarak CLAUDE.md'de duruyor.)*

## Faz Kapsamı (Bölüm 7)
- **Faz 1 (şu an):** süreç tanımı, adımlar, doğrusal geçişler, örnek yürütme, geçmiş
  kaydı, Django admin, ekranlar 2.1/2.2/2.3/3.1
- **Faz 2:** rol/yetki kısıtları (`WorkflowStep.required_permission`), SLA
  (`WorkflowInstance.due_date`, `is_overdue`), panom ekranı (2.4), arayüzden süreç
  tasarlama (1.2), süreç şeması görünümü (4.1)
- **Faz 3:** koşullu dallanma (`WorkflowTransition.condition`), bildirimler
  (`WorkflowNotification`), paralel onay (`WorkflowApproval`), dosya ekleme
  (`WorkflowAttachment`)

Faz 2 ve 3'teki hiçbir şey şimdi kodlanmayacak — sadece bu dosyada referans olarak duruyor.

## Çalışma Kuralları
- Migration'ları (`makemigrations` / `migrate`) BEN (kullanıcı) kendim çalıştırıyorum.
  Dosyayı yaz, komutu benim yerime koşma.
- Kod yazmadan önce ilgili tasarım kararını (yukarıdaki liste) kontrol et, sapma varsa
  bana sor, sessizce farklı bir yol seçme.
- Model alanlarında belirsizlik varsa (örn. `unit` FK'si) varsayım yapıp geçme, sor.
