import axios from 'axios';

// Backend'in temel adresi. Tüm istekler bu adresin üzerine bindirilir.
const BASE_URL = 'http://localhost:8001';

// Merkezî axios instance — uygulamadaki tüm API çağrıları bunu kullanır.
const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// localStorage'daki token'ları temizler (oturum kapatma / geçersiz oturum durumları).
function clearTokens() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
}

// --- Request interceptor: her isteğe (varsa) JWT access token'ı ekle ---
api.interceptors.request.use(
  (config) => {
    const accessToken = localStorage.getItem('access_token');
    if (accessToken) {
      // Token varsa Authorization header'ına 'Bearer <token>' olarak koy.
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    // Token yoksa header eklenmez (login gibi token gerektirmeyen istekler için).
    return config;
  },
  (error) => Promise.reject(error),
);

// --- Response interceptor: 401 alınca access token'ı refresh ile yenile ---
api.interceptors.response.use(
  // Başarılı yanıtları olduğu gibi geçir.
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Yalnızca 401 VE bu istek daha önce retry edilmediyse yenilemeyi dene.
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true; // sonsuz döngüyü önlemek için işaretle

      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        // Yenilenecek refresh token yok -> oturumu düşür.
        clearTokens();
        return Promise.reject(error);
      }

      try {
        // Refresh çağrısını instance yerine DÜZ axios ile yap: böylece bu istek
        // yeniden interceptor'a girip döngü oluşturmaz.
        const { data } = await axios.post(`${BASE_URL}/api/token/refresh/`, {
          refresh: refreshToken,
        });

        // Yeni access token'ı sakla.
        localStorage.setItem('access_token', data.access);

        // Orijinal isteği yeni token ile tekrar dene.
        originalRequest.headers.Authorization = `Bearer ${data.access}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh de başarısız -> token'ları temizle ve hatayı fırlat
        // (çağıran taraf kullanıcıyı login'e yönlendirsin).
        clearTokens();
        return Promise.reject(refreshError);
      }
    }

    // 401 dışındaki (veya zaten retry edilmiş) hatalar olduğu gibi yukarı gider.
    return Promise.reject(error);
  },
);

// --- Yardımcı fonksiyonlar ---

// login: kullanıcı adı + şifre ile token al, access + refresh'i localStorage'a kaydet.
// Başarılıysa true döner; başarısızsa hata fırlatır (çağıran taraf yakalar).
export async function login(username, password) {
  const { data } = await api.post('/api/token/', { username, password });
  localStorage.setItem('access_token', data.access);
  localStorage.setItem('refresh_token', data.refresh);
  // Kullanıcı adını da sakla — AppLayout'taki avatar/dropdown'da göstermek için.
  localStorage.setItem('username', username);
  return true;
}

// logout: yerel token'ları (+ kullanıcı adını) siler (sunucuya istek göndermez).
export function logout() {
  clearTokens();
  localStorage.removeItem('username');
}

export default api;
