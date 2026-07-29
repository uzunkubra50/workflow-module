"""Kimlik doğrulama uçları için hız sınırlı (throttled) sarmalayıcılar.

Giriş ucu, şifre deneme saldırısının (brute force) birincil hedefidir. DRF'in
varsayılan ayarında hiçbir sınır yoktur — yani saniyede yüzlerce şifre denenebilir.
Burada iki sınır BİRLİKTE uygulanır, çünkü tek başına ikisi de eksiktir:

  - Kullanıcı adı başına: tek bir hesaba yoğunlaşan denemeyi durdurur.
    IP başına sınır bunu kaçırır, saldırgan IP değiştirebilir.
  - IP başına: denemeyi farklı kullanıcı adlarına yayan saldırıyı durdurur.
    Kullanıcı adı başına sınır bunu kaçırır, her denemede farklı ad kullanılır.

IP sınırı bilinçli olarak daha gevşek: bir kurumun tüm kullanıcıları tek bir dış
IP'nin arkasından gelebilir, sıkı bir sınır meşru girişleri de engellerdi.

Yenileme (refresh) ucu bilinçli olarak sınırlanmadı: şifre denemesi değil, arka
planda otomatik çalışıyor ve ortak IP arkasındaki kullanıcıları sessizce oturumdan
düşürme riski taşıyor.

NOT — canlı ortam için iki koşul:
  1. Sayaç önbellekte tutulur. Django'nun varsayılanı süreç içi önbellektir
     (LocMemCache); birden fazla worker çalışırsa her biri kendi sayacını tutar ve
     etkin sınır worker sayısı kadar katlanır. Ortak bir önbellek (Redis/Memcached)
     tanımlanmalıdır.
  2. Ters vekil (reverse proxy) arkasında REMOTE_ADDR vekilin IP'sidir. Gerçek
     istemci IP'si için vekil başlıkları yapılandırılmalıdır, aksi halde IP sınırı
     tüm kullanıcıları tek kovaya koyar.
"""

from rest_framework.throttling import SimpleRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView


class LoginUsernameThrottle(SimpleRateThrottle):
    """Denenen kullanıcı adı başına sınır — tek hesaba yoğunlaşan saldırıya karşı.

    Sayaç, isteğin gövdesindeki `username` değerine göre tutulur; oturum açmış
    kullanıcı yoktur (giriş ucu anonimdir), bu yüzden hazır throttle sınıfları
    (AnonRateThrottle/UserRateThrottle) bu ayrımı yapamaz.
    """

    scope = 'login'

    def get_cache_key(self, request, view):
        username = request.data.get('username') if hasattr(request, 'data') else None
        if not username:
            # Kullanıcı adı yoksa sınırlama yapılmaz (None = throttle uygulanmaz);
            # istek zaten doğrulamadan geçemez, ayrıca IP sınırı devrede kalır.
            return None
        return self.cache_format % {
            'scope': self.scope,
            # Büyük/küçük harf farkıyla sınırın atlatılmaması için normalize edilir.
            'ident': str(username).lower(),
        }


class LoginIPThrottle(SimpleRateThrottle):
    """İstemci IP'si başına sınır — denemeyi farklı hesaplara yayan saldırıya karşı."""

    scope = 'login_ip'

    def get_cache_key(self, request, view):
        return self.cache_format % {
            'scope': self.scope,
            'ident': self.get_ident(request),
        }


class ThrottledTokenObtainPairView(TokenObtainPairView):
    """POST /api/token/ — SimpleJWT'nin giriş ucu, hız sınırı eklenmiş hali.

    Sınır aşıldığında DRF `429 Too Many Requests` döndürür. Sınır kontrolü kimlik
    doğrulamasından ÖNCE çalışır: doğru şifre de sınıra tabidir, saldırgan şifreyi
    bulsa bile sınır dolmuşsa geçemez.
    """

    throttle_classes = [LoginUsernameThrottle, LoginIPThrottle]
