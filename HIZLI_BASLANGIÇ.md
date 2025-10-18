# 🚀 HIZLI BAŞLANGIÇ - Backend v2.0

## ⚡ 1 Dakikada Başlat

```bash
# Backend'i başlat
node backend.js
```

Backend otomatik olarak http://localhost:3001 adresinde çalışmaya başlayacak.

## 🎯 Hızlı Test

```bash
# Test scriptini çalıştır
./test-backend.sh
```

veya manuel test:

```bash
# Durum kontrolü
curl http://localhost:3001/api/status

# Hizmetleri listele
curl http://localhost:3001/api/get-services

# Departmanları listele
curl http://localhost:3001/api/get-departments

# İstatistikleri gör
curl http://localhost:3001/api/get-stats
```

## 📋 En Önemli Yeni Özellikler

### 1. Otomatik Çakışma Kontrolü
```bash
POST /api/add-appointment
```
- ✅ Doktor müsait mi kontrol eder
- ✅ Aynı saatte randevu var mı kontrol eder
- ✅ Hizmet süresine göre çakışmayı hesaplar
- ❌ Çakışma varsa randevu oluşturmaz

### 2. Müsait Saatleri Getir
```bash
GET /api/get-available-slots?doktorId=123&tarih=2025-01-20&hizmetId=1004
```
Returns:
```json
{
  "slots": [
    { "time": "09:00", "duration": 90 },
    { "time": "11:00", "duration": 90 }
  ]
}
```

### 3. Departman ve Hizmet Sistemi
```bash
# Tüm departmanları listele
GET /api/get-departments

# Hizmetleri departmana göre filtrele
GET /api/get-services?departmanId=1

# Doktorun hizmetlerini listele
GET /api/get-services?doktorId=123
```

### 4. Doktora Hizmet Atama
```bash
POST /api/assign-service-to-doctor
Headers: { Authorization: "Bearer admin_secret_2025_xyz123" }
{
  "doktorId": "123",
  "hizmetId": "1004"
}
```

### 5. Dashboard İstatistikleri
```bash
GET /api/get-stats
```
Returns:
```json
{
  "totalAppointments": 150,
  "todayAppointments": 12,
  "confirmedAppointments": 120,
  "pendingAppointments": 15,
  "cancelledAppointments": 15,
  "popularServices": [...]
}
```

## 🗂️ Veri Yapısı

### Hazır Veriler
Backend ilk kez çalıştırıldığında şunları içerir:

#### 7 Departman:
1. Genel Diş Hekimliği
2. Ortodonti
3. İmplantoloji
4. Periodontoloji
5. Endodonti
6. Estetik Diş Hekimliği
7. Protez

#### 10 Hizmet:
1. Rutin Muayene (30 dk - 500 TL)
2. Dolgu (45 dk - 1500 TL)
3. Diş Temizliği (30 dk - 800 TL)
4. Kanal Tedavisi (90 dk - 3500 TL)
5. İmplant (120 dk - 15000 TL)
6. Tel Tedavisi Kontrolü (20 dk - 600 TL)
7. Diş Beyazlatma (60 dk - 2500 TL)
8. Zirkon Kaplama (30 dk - 4000 TL)
9. Diş Eti Tedavisi (60 dk - 2000 TL)
10. Çekim (30 dk - 700 TL)

## 🔧 Admin Token

Tüm admin işlemleri için header ekleyin:
```bash
Authorization: Bearer admin_secret_2025_xyz123
```

Admin gerektiren işlemler:
- Kullanıcı ekleme/güncelleme/silme
- Hizmet ekleme/güncelleme/silme
- Departman ekleme/silme
- Doktora hizmet atama

## 📊 Veritabanı Modları

### Google Sheets Modu (Aktif)
Backend otomatik olarak Google Sheets'e bağlanır.
- ✅ Gerçek zamanlı senkronizasyon
- ✅ Çok kullanıcılı erişim
- ✅ Web tabanlı düzenleme

### JSON Modu (Fallback)
Sheets bağlantısı yoksa otomatik JSON moduna geçer.
- ✅ Yerel dosya depolama
- ✅ Hızlı erişim
- ✅ İnternet gerektirmez

## 🎉 Başarı Kriterleri

Backend çalıştığında göreceğiniz çıktı:

```
✅ Backend sunucusu çalışıyor!
📍 URL: http://localhost:3001

✅ Google Sheets Modu Aktif
📊 Sheet ID: 1yHgBahZykvyGTwbtXZhjWK1_4QtFUN1K65DoVjvS_GE

📋 BACKEND v2.0 - YENİ ÖZELLİKLER:
   ✅ Çakışma Kontrolü
   ✅ Müsaitlik Kontrolü
   ✅ Departman/Hizmet Sistemi
   ✅ Doktor-Hizmet Eşleştirme
   ✅ İstatistikler ve Raporlar
   ✅ Gelişmiş Filtreleme

📊 TOPLAM: 27 Endpoint
```

## 📖 Detaylı Dokümantasyon

Tüm endpoint'lerin detaylı açıklaması için:
```bash
cat BACKEND_v2_OZET.md
```

## 🆘 Sorun Giderme

### Backend başlamıyor
```bash
# Dependencies'i yükle
npm install

# Port kullanımda mı kontrol et
lsof -i :3001

# Manuel başlat
node backend.js
```

### Google Sheets bağlanamıyor
- ✅ Normal: Otomatik JSON moduna geçer
- ⚠️ .env dosyasını kontrol et
- ⚠️ GOOGLE_SHEET_ID doğru mu?

### Çakışma kontrolü çalışmıyor
- ✅ Doktor müsaitlik tanımlandı mı? (availabilities)
- ✅ Hizmet süresi doğru mu? (services)
- ✅ Tarih formatı: YYYY-MM-DD
- ✅ Saat formatı: HH:MM

## 💡 İpuçları

1. **Müsait saatleri önce göster:** Frontend'de randevu oluşturmadan önce `/api/get-available-slots` kullan
2. **Çakışmayı frontend'de de kontrol et:** Kullanıcı deneyimi için
3. **İstatistikleri dashboard'a ekle:** `/api/get-stats` endpoint'ini kullan
4. **Doktor hizmetlerini filtreleme:** Randevu sayfasında sadece doktorun verdiği hizmetleri göster

## 🎯 Sonraki Adımlar

1. Frontend'i güncelleyerek yeni endpoint'leri entegre et
2. Admin paneline departman yönetimi ekle
3. Hasta paneline randevu iptal özelliği ekle
4. Dashboard'a istatistik kartları ekle

---

**Hazır! Backend v2.0 tüm kritik eksikliklerle birlikte çalışıyor! 🎉**
