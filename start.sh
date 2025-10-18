#!/bin/bash

# 🚀 Randevu Sistemi - Hızlı Başlatma Script'i

echo "🏥 Randevu Sistemi Başlatılıyor..."
echo ""

# Renk kodları
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Backend'i kontrol et
if ! command -v node &> /dev/null
then
    echo "❌ Node.js yüklü değil. Lütfen Node.js yükleyin."
    exit 1
fi

# npm paketlerini kontrol et
if [ ! -d "node_modules" ]; then
    echo "📦 NPM paketleri yükleniyor..."
    npm install
    echo ""
fi

# Backend'i başlat
echo -e "${BLUE}🔵 Backend başlatılıyor (Port 3001)...${NC}"
node backend.js &
BACKEND_PID=$!
sleep 2

# Backend kontrolü
if ! lsof -i:3001 > /dev/null 2>&1; then
    echo "❌ Backend başlatılamadı!"
    exit 1
fi

echo -e "${GREEN}✅ Backend çalışıyor: http://localhost:3001${NC}"
echo ""

# Frontend'i başlat
echo -e "${BLUE}🔵 Frontend başlatılıyor (Port 8000)...${NC}"
python3 -m http.server 8000 &
FRONTEND_PID=$!
sleep 2

# Frontend kontrolü
if ! lsof -i:8000 > /dev/null 2>&1; then
    echo "❌ Frontend başlatılamadı!"
    kill $BACKEND_PID
    exit 1
fi

echo -e "${GREEN}✅ Frontend çalışıyor: http://localhost:8000${NC}"
echo ""

# Başarı mesajı
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${GREEN}🎉 SİSTEM BAŞARIYLA BAŞLATILDI! 🎉${NC}"
echo ""
echo "📍 Ana Sayfa: http://localhost:8000/index.html"
echo ""
echo "👥 Test Kullanıcıları:"
echo "   🔴 Admin: Admin Kullanıcı (şifre: admin123)"
echo "   🟢 Doktor: Ahmet Yılmaz (şifre: doktor123)"
echo "   🔵 Hasta: Mehmet Demir (şifre yok)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${YELLOW}Durdurmak için Ctrl+C yapın${NC}"
echo ""

# Tarayıcıda aç (opsiyonel)
if command -v xdg-open &> /dev/null
then
    echo "🌐 Tarayıcı açılıyor..."
    xdg-open http://localhost:8000/index.html 2>/dev/null
elif command -v open &> /dev/null
then
    echo "🌐 Tarayıcı açılıyor..."
    open http://localhost:8000/index.html
fi

# Cleanup fonksiyonu
cleanup() {
    echo ""
    echo "🛑 Sistem kapatılıyor..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    echo "✅ Başarıyla kapatıldı!"
    exit 0
}

# Ctrl+C yakalandığında cleanup çağır
trap cleanup INT

# Sonsuz döngü (Ctrl+C bekle)
while true; do
    sleep 1
done
