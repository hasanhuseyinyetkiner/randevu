require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Veri dosyaları
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const APPOINTMENTS_FILE = path.join(DATA_DIR, 'appointments.json');
const SERVICES_FILE = path.join(DATA_DIR, 'services.json');
const AVAILABILITIES_FILE = path.join(DATA_DIR, 'availabilities.json');
const DEPARTMENTS_FILE = path.join(DATA_DIR, 'departments.json');
const DOCTOR_SERVICES_FILE = path.join(DATA_DIR, 'doctor_services.json');

// Admin secret token
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'Bearer admin_secret_2025_xyz123';
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Google Sheets yapılandırması
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ],
});

// Global değişkenler
let doc = null;
let sheets = {};
let useGoogleSheets = false;

// ==================== HELPER FUNCTIONS ====================

// Helper: Google Sheets başlat
async function initializeSheets() {
  try {
    if (!SHEET_ID) {
      console.warn('⚠️ GOOGLE_SHEET_ID ortam değişkeni ayarlanmamış. JSON modu kullanılacak.');
      return false;
    }

    doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    
    sheets = {
      users: doc.sheetsByTitle['Kullanicilar'],
      appointments: doc.sheetsByTitle['Randevular'],
      services: doc.sheetsByTitle['Hizmetler'],
      availabilities: doc.sheetsByTitle['Musaitlikler'],
    };

    const requiredSheets = ['Kullanicilar', 'Randevular', 'Hizmetler', 'Musaitlikler'];
    const loadedSheets = Object.values(sheets).filter(s => s);
    
    if (loadedSheets.length !== requiredSheets.length) {
      console.warn('⚠️ Bazı sheet\'ler bulunamadı. JSON modu kullanılacak.');
      return false;
    }

    console.log('✅ Google Sheets bağlantısı başarılı!');
    return true;
  } catch (error) {
    console.error('❌ Google Sheets bağlantı hatası:', error.message);
    console.warn('⚠️ JSON dosyaları modu aktif edilecek.');
    return false;
  }
}

// Helper: Veri okuma (JSON desteği)
async function readData(file) {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const data = await fs.readFile(file, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Helper: Veri yazma (JSON desteği)
async function writeData(file, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// Helper: ID oluştur (Milisaniye tabanlı, çakışma riski düşük)
function generateId() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `${timestamp}${random}`;
}

// Helper: Admin kontrolü
function isAdmin(req) {
  return req.headers.authorization === ADMIN_TOKEN;
}

// Helper: Telefon formatı validasyonu ve temizleme
function validateAndCleanPhone(phone) {
  if (!phone) return null;
  
  // Boşluk ve özel karakterleri kaldır
  let cleaned = phone.replace(/\D/g, '');
  
  // TR formatı kontrolü: 90XXXXXXXXXX veya 5XXXXXXXXXX
  if (cleaned.startsWith('90')) {
    cleaned = cleaned.substring(2); // 90'ı kaldır
  }
  
  // 5XXXXXXXXXX formatında ve 10 hane
  if (!/^5\d{9}$/.test(cleaned)) {
    return null; // Geçersiz
  }
  
  return cleaned;
}

// Helper: Doktor slug oluştur
function generateDoctorSlug(name) {
  return name
    .toLowerCase()
    .replace(/[çğıöşü]/g, c => ({
      'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u'
    })[c])
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

// Helper: Tarih ve saat manipülasyonu
function parseTime(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes; // Dakikaya çevir
}

function addMinutesToTime(timeStr, minutes) {
  const totalMinutes = parseTime(timeStr) + minutes;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// Helper: Randevu çakışma kontrolü
async function checkAppointmentConflict(doktorId, tarih, saat, hizmetSuresi, excludeAppointmentId = null) {
  let appointments;
  
  if (useGoogleSheets) {
    const rows = await sheets.appointments.getRows();
    appointments = rows.map(row => row._rawData);
  } else {
    appointments = await readData(APPOINTMENTS_FILE);
  }
  
  // Aynı doktor ve tarihteki randevuları filtrele (iptal edilmemiş)
  const doctorAppointments = appointments.filter(apt => 
    String(apt.DoktorID) === String(doktorId) &&
    apt.Tarih === tarih &&
    apt.Durum !== 'iptal edildi' &&
    (!excludeAppointmentId || String(apt.ID) !== String(excludeAppointmentId))
  );

  const newStartTime = parseTime(saat);
  const newEndTime = newStartTime + parseInt(hizmetSuresi);

  for (const apt of doctorAppointments) {
    const aptStartTime = parseTime(apt.Saat);
    
    // Hizmet süresini bul
    let aptDuration = 30; // Varsayılan
    if (apt.HizmetID) {
      const services = useGoogleSheets 
        ? (await sheets.services.getRows()).map(row => row._rawData)
        : await readData(SERVICES_FILE);
      const service = services.find(s => String(s.ID) === String(apt.HizmetID));
      if (service) aptDuration = parseInt(service.Sure);
    }
    
    const aptEndTime = aptStartTime + aptDuration;

    // Çakışma kontrolü
    if ((newStartTime >= aptStartTime && newStartTime < aptEndTime) ||
        (newEndTime > aptStartTime && newEndTime <= aptEndTime) ||
        (newStartTime <= aptStartTime && newEndTime >= aptEndTime)) {
      return {
        conflict: true,
        message: `Bu saatte başka bir randevu var (${apt.Saat} - ${addMinutesToTime(apt.Saat, aptDuration)})`,
        conflictingAppointment: apt
      };
    }
  }

  return { conflict: false };
}

// Helper: Müsaitlik kontrolü
async function checkDoctorAvailability(doktorId, tarih, saat) {
  let availabilities;
  
  if (useGoogleSheets) {
    const rows = await sheets.availabilities.getRows();
    availabilities = rows.map(row => row._rawData);
  } else {
    availabilities = await readData(AVAILABILITIES_FILE);
  }
  
  const doctorAvailabilities = availabilities.filter(a => 
    String(a.DoktorID) === String(doktorId) &&
    a.Tarih === tarih &&
    a.Musait === 'TRUE'
  );

  if (doctorAvailabilities.length === 0) {
    return {
      available: false,
      message: 'Doktor bu tarihte müsait değil'
    };
  }

  const requestTime = parseTime(saat);
  
  for (const availability of doctorAvailabilities) {
    const startTime = parseTime(availability.BaslangicSaati);
    const endTime = parseTime(availability.BitisSaati);
    
    if (requestTime >= startTime && requestTime < endTime) {
      return { available: true };
    }
  }

  return {
    available: false,
    message: 'Seçilen saat doktorun çalışma saatleri dışında'
  };
}

// Helper: Müsait saatleri hesapla
async function getAvailableTimeSlots(doktorId, tarih, hizmetId) {
  // Hizmet süresini al
  let serviceDuration = 30;
  if (hizmetId) {
    const services = await readData(SERVICES_FILE);
    const service = services.find(s => String(s.ID) === String(hizmetId));
    if (service) serviceDuration = parseInt(service.Sure);
  }

  // Doktorun müsaitlik aralıklarını al
  const availabilities = await readData(AVAILABILITIES_FILE);
  const doctorAvailabilities = availabilities.filter(a =>
    String(a.DoktorID) === String(doktorId) &&
    a.Tarih === tarih &&
    a.Musait === 'TRUE'
  );

  if (doctorAvailabilities.length === 0) {
    return [];
  }

  // Mevcut randevuları al
  const appointments = await readData(APPOINTMENTS_FILE);
  const doctorAppointments = appointments.filter(apt =>
    String(apt.DoktorID) === String(doktorId) &&
    apt.Tarih === tarih &&
    apt.Durum !== 'iptal edildi'
  );

  const availableSlots = [];

  for (const availability of doctorAvailabilities) {
    const startTime = parseTime(availability.BaslangicSaati);
    const endTime = parseTime(availability.BitisSaati);
    
    // Her 15 dakikalık slot için kontrol
    for (let time = startTime; time + serviceDuration <= endTime; time += 15) {
      const timeStr = addMinutesToTime('00:00', time);
      const slotEndTime = time + serviceDuration;
      
      // Bu slotta randevu var mı kontrol et
      let hasConflict = false;
      for (const apt of doctorAppointments) {
        const aptStart = parseTime(apt.Saat);
        let aptDuration = 30;
        
        if (apt.HizmetID) {
          const services = await readData(SERVICES_FILE);
          const service = services.find(s => String(s.ID) === String(apt.HizmetID));
          if (service) aptDuration = parseInt(service.Sure);
        }
        
        const aptEnd = aptStart + aptDuration;
        
        // Çakışma kontrolü
        if ((time >= aptStart && time < aptEnd) ||
            (slotEndTime > aptStart && slotEndTime <= aptEnd) ||
            (time <= aptStart && slotEndTime >= aptEnd)) {
          hasConflict = true;
          break;
        }
      }
      
      if (!hasConflict) {
        availableSlots.push({
          time: timeStr,
          duration: serviceDuration
        });
      }
    }
  }

  return availableSlots;
}

// ==================== KULLANICI ENDPOİNTLERİ ====================

// Kullanıcı kontrolü (login)
app.post('/api/check-user', async (req, res) => {
  try {
    const { isim, soyisim, sifre, telefon } = req.body;
    let users;

    if (useGoogleSheets) {
      const rows = await sheets.users.getRows();
      users = rows.map(row => row._rawData);
    } else {
      users = await readData(USERS_FILE);
    }
    
    // İsim+Soyisim veya Telefon ile ara
    let user = null;
    
    if (telefon) {
      const cleanPhone = validateAndCleanPhone(telefon);
      if (cleanPhone) {
        user = users.find(u => validateAndCleanPhone(u.Telefon) === cleanPhone);
      }
    }
    
    if (!user && isim && soyisim) {
      user = users.find(u => 
        u.Isim?.toLowerCase() === isim?.toLowerCase() && 
        u.Soyisim?.toLowerCase() === soyisim?.toLowerCase()
      );
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı' });
    }

    if (user.Rol === 'hasta') {
      return res.json({
        success: true,
        user: { 
          id: user.ID, 
          isim: user.Isim, 
          soyisim: user.Soyisim, 
          rol: user.Rol, 
          telefon: user.Telefon,
          doktorId: user.DoktorID || '' 
        }
      });
    }

    if (user.Sifre !== sifre) {
      return res.status(401).json({ success: false, message: 'Şifre yanlış' });
    }

    res.json({
      success: true,
      user: { 
        id: user.ID, 
        isim: user.Isim, 
        soyisim: user.Soyisim, 
        rol: user.Rol, 
        doktorId: user.DoktorID || '',
        slug: user.Slug || generateDoctorSlug(`${user.Isim} ${user.Soyisim}`)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Kullanıcıları getir
app.get('/api/get-users', async (req, res) => {
  try {
    const { rol } = req.query;
    let users;

    if (useGoogleSheets) {
      const rows = await sheets.users.getRows();
      users = rows.map(row => row._rawData);
    } else {
      users = await readData(USERS_FILE);
    }
    
    if (rol) {
      users = users.filter(u => u.Rol?.toLowerCase() === rol.toLowerCase());
    }

    const sanitizedUsers = users.map(u => ({
      id: u.ID, isim: u.Isim, soyisim: u.Soyisim, telefon: u.Telefon, rol: u.Rol
    }));

    res.json(sanitizedUsers);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Kullanıcı ekle
app.post('/api/add-user', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Sadece admin kullanıcı ekleyebilir' });
    }

    const { isim, soyisim, rol, telefon, sifre, doktorId } = req.body;
    
    // Telefon formatı kontrolü
    const cleanPhone = validateAndCleanPhone(telefon);
    if (!cleanPhone) {
      return res.status(400).json({ 
        success: false, 
        error: 'Geçersiz telefon numarası',
        message: 'Lütfen geçerli bir Türk telefon numarası girin (5XXXXXXXXXX)' 
      });
    }

    const newUserId = generateId();
    const slug = rol === 'doktor' ? generateDoctorSlug(`${isim} ${soyisim}`) : null;

    if (useGoogleSheets) {
      await sheets.users.addRow({
        ID: newUserId, 
        Isim: isim, 
        Soyisim: soyisim, 
        Rol: rol,
        Telefon: cleanPhone,
        Sifre: sifre || '', 
        Slug: slug || '',
        DoktorID: doktorId || '',
        KayitTarihi: new Date().toISOString()
      });
    } else {
      const users = await readData(USERS_FILE);
      users.push({
        ID: newUserId, 
        Isim: isim, 
        Soyisim: soyisim, 
        Rol: rol,
        Telefon: cleanPhone,
        Sifre: sifre || '', 
        Slug: slug || '',
        DoktorID: doktorId || '',
        KayitTarihi: new Date().toISOString()
      });
      await writeData(USERS_FILE, users);
    }

    res.json({ 
      success: true, 
      id: newUserId,
      slug: slug,
      cleanPhone: cleanPhone 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Kullanıcı güncelle
app.post('/api/update-user', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.query;
    const { isim, soyisim, telefon, sifre } = req.body;

    if (useGoogleSheets) {
      const rows = await sheets.users.getRows();
      const rowIndex = rows.findIndex(r => String(r.ID) === String(id));
      
      if (rowIndex === -1) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const row = rows[rowIndex];
      if (isim) row.Isim = isim;
      if (soyisim) row.Soyisim = soyisim;
      if (telefon) row.Telefon = telefon;
      if (sifre && row.Rol !== 'hasta') row.Sifre = sifre;
      await row.save();
    } else {
      const users = await readData(USERS_FILE);
      const userIndex = users.findIndex(u => String(u.ID) === String(id));
      
      if (userIndex === -1) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      if (isim) users[userIndex].Isim = isim;
      if (soyisim) users[userIndex].Soyisim = soyisim;
      if (telefon) users[userIndex].Telefon = telefon;
      if (sifre && users[userIndex].Rol !== 'hasta') users[userIndex].Sifre = sifre;
      await writeData(USERS_FILE, users);
    }

    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Kullanıcı sil
app.delete('/api/delete-user', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id } = req.query;

    if (useGoogleSheets) {
      const rows = await sheets.users.getRows();
      const rowIndex = rows.findIndex(r => String(r.ID) === String(id));
      
      if (rowIndex === -1) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      await rows[rowIndex].delete();
    } else {
      let users = await readData(USERS_FILE);
      users = users.filter(u => String(u.ID) !== String(id));
      await writeData(USERS_FILE, users);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== RANDEVU ENDPOİNTLERİ ====================

// Randevu ekle (Çakışma ve müsaitlik kontrolü ile)
app.post('/api/add-appointment', async (req, res) => {
  try {
    const { hastaId, hastaIsim, hastaTelefon, doktorId, doktorAdi, hizmetId, hizmet, tarih, saat, durum } = req.body;
    
    if (!hastaIsim || !hastaTelefon || !doktorId || !doktorAdi || !tarih || !saat) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Hizmet süresini al
    let hizmetSuresi = 30; // Varsayılan
    if (hizmetId) {
      let services;
      if (useGoogleSheets) {
        const rows = await sheets.services.getRows();
        services = rows.map(row => row._rawData);
      } else {
        services = await readData(SERVICES_FILE);
      }
      const service = services.find(s => String(s.ID) === String(hizmetId));
      if (service) {
        hizmetSuresi = parseInt(service.Sure);
      }
    }

    // Müsaitlik kontrolü
    const availabilityCheck = await checkDoctorAvailability(doktorId, tarih, saat);
    if (!availabilityCheck.available) {
      return res.status(409).json({
        success: false,
        error: 'Doktor müsait değil',
        message: availabilityCheck.message
      });
    }

    // Çakışma kontrolü
    const conflictCheck = await checkAppointmentConflict(doktorId, tarih, saat, hizmetSuresi);
    if (conflictCheck.conflict) {
      return res.status(409).json({
        success: false,
        error: 'Randevu çakışması',
        message: conflictCheck.message,
        conflictingAppointment: conflictCheck.conflictingAppointment
      });
    }

    const newAppointmentId = generateId();

    if (useGoogleSheets) {
      await sheets.appointments.addRow({
        ID: newAppointmentId, HastaID: hastaId || hastaTelefon, HastaAdi: hastaIsim, HastaTelefon: hastaTelefon,
        DoktorID: doktorId, DoktorAdi: doktorAdi, HizmetID: hizmetId || '', Hizmet: hizmet || '',
        Tarih: tarih, Saat: saat, Durum: durum || 'onaylandı', OlusturmaTarihi: new Date().toISOString()
      });
    } else {
      const appointments = await readData(APPOINTMENTS_FILE);
      appointments.push({
        ID: newAppointmentId, HastaID: hastaId || hastaTelefon, HastaAdi: hastaIsim, HastaTelefon: hastaTelefon,
        DoktorID: doktorId, DoktorAdi: doktorAdi, HizmetID: hizmetId || '', Hizmet: hizmet || '',
        Tarih: tarih, Saat: saat, Durum: durum || 'onaylandı', OlusturmaTarihi: new Date().toISOString()
      });
      await writeData(APPOINTMENTS_FILE, appointments);
    }

    res.json({ success: true, id: newAppointmentId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Randevuları getir (Filtreleme ile)
app.get('/api/get-appointments', async (req, res) => {
  try {
    const { baslangic, bitis, doktorId, hastaId, durum } = req.query;
    let appointments;

    if (useGoogleSheets) {
      const rows = await sheets.appointments.getRows();
      appointments = rows.map(row => row._rawData);
    } else {
      appointments = await readData(APPOINTMENTS_FILE);
    }
    
    if (baslangic) appointments = appointments.filter(apt => apt.Tarih >= baslangic);
    if (bitis) appointments = appointments.filter(apt => apt.Tarih <= bitis);
    if (doktorId) appointments = appointments.filter(apt => String(apt.DoktorID) === String(doktorId));
    if (hastaId) appointments = appointments.filter(apt => String(apt.HastaID) === String(hastaId));
    if (durum) appointments = appointments.filter(apt => apt.Durum === durum);

    res.json(appointments);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Randevu güncelle (Çakışma kontrolü ile)
app.post('/api/update-appointment', async (req, res) => {
  try {
    const { id } = req.query;
    const updateData = req.body;

    if (useGoogleSheets) {
      const rows = await sheets.appointments.getRows();
      const rowIndex = rows.findIndex(r => String(r.ID) === String(id));
      
      if (rowIndex === -1) {
        return res.status(404).json({ success: false, error: 'Appointment not found' });
      }

      const row = rows[rowIndex];
      
      // Tarih/saat değişikliği varsa çakışma kontrolü yap
      if (updateData.tarih || updateData.saat) {
        const newTarih = updateData.tarih || row.Tarih;
        const newSaat = updateData.saat || row.Saat;
        const doktorId = updateData.doktorId || row.DoktorID;
        
        let hizmetSuresi = 30;
        if (row.HizmetID) {
          const services = (await sheets.services.getRows()).map(r => r._rawData);
          const service = services.find(s => String(s.ID) === String(row.HizmetID));
          if (service) hizmetSuresi = parseInt(service.Sure);
        }
        
        const availCheck = await checkDoctorAvailability(doktorId, newTarih, newSaat);
        if (!availCheck.available) {
          return res.status(409).json({
            success: false,
            error: 'Doktor müsait değil',
            message: availCheck.message
          });
        }
        
        const conflictCheck = await checkAppointmentConflict(doktorId, newTarih, newSaat, hizmetSuresi, id);
        if (conflictCheck.conflict) {
          return res.status(409).json({
            success: false,
            error: 'Randevu çakışması',
            message: conflictCheck.message
          });
        }
      }
      
      if (updateData.doktorId) row.DoktorID = updateData.doktorId;
      if (updateData.doktorAdi) row.DoktorAdi = updateData.doktorAdi;
      if (updateData.hizmetId !== undefined) row.HizmetID = updateData.hizmetId;
      if (updateData.hizmet !== undefined) row.Hizmet = updateData.hizmet;
      if (updateData.tarih) row.Tarih = updateData.tarih;
      if (updateData.saat) row.Saat = updateData.saat;
      if (updateData.durum) row.Durum = updateData.durum;
      await row.save();
    } else {
      const appointments = await readData(APPOINTMENTS_FILE);
      const appointmentIndex = appointments.findIndex(apt => String(apt.ID) === String(id));
      
      if (appointmentIndex === -1) {
        return res.status(404).json({ success: false, error: 'Appointment not found' });
      }

      const appointment = appointments[appointmentIndex];
      
      // Tarih/saat değişikliği varsa çakışma kontrolü yap
      if (updateData.tarih || updateData.saat) {
        const newTarih = updateData.tarih || appointment.Tarih;
        const newSaat = updateData.saat || appointment.Saat;
        const doktorId = updateData.doktorId || appointment.DoktorID;
        
        let hizmetSuresi = 30;
        if (appointment.HizmetID) {
          const services = await readData(SERVICES_FILE);
          const service = services.find(s => String(s.ID) === String(appointment.HizmetID));
          if (service) hizmetSuresi = parseInt(service.Sure);
        }
        
        const availCheck = await checkDoctorAvailability(doktorId, newTarih, newSaat);
        if (!availCheck.available) {
          return res.status(409).json({
            success: false,
            error: 'Doktor müsait değil',
            message: availCheck.message
          });
        }
        
        const conflictCheck = await checkAppointmentConflict(doktorId, newTarih, newSaat, hizmetSuresi, id);
        if (conflictCheck.conflict) {
          return res.status(409).json({
            success: false,
            error: 'Randevu çakışması',
            message: conflictCheck.message
          });
        }
      }
      
      if (updateData.doktorId) appointment.DoktorID = updateData.doktorId;
      if (updateData.doktorAdi) appointment.DoktorAdi = updateData.doktorAdi;
      if (updateData.hizmetId !== undefined) appointment.HizmetID = updateData.hizmetId;
      if (updateData.hizmet !== undefined) appointment.Hizmet = updateData.hizmet;
      if (updateData.tarih) appointment.Tarih = updateData.tarih;
      if (updateData.saat) appointment.Saat = updateData.saat;
      if (updateData.durum) appointment.Durum = updateData.durum;
      await writeData(APPOINTMENTS_FILE, appointments);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Randevu sil/iptal et
app.delete('/api/delete-appointment', async (req, res) => {
  try {
    const { id } = req.query;

    if (useGoogleSheets) {
      const rows = await sheets.appointments.getRows();
      const rowIndex = rows.findIndex(r => String(r.ID) === String(id));
      
      if (rowIndex === -1) {
        return res.status(404).json({ success: false, error: 'Appointment not found' });
      }

      await rows[rowIndex].delete();
    } else {
      let appointments = await readData(APPOINTMENTS_FILE);
      appointments = appointments.filter(apt => String(apt.ID) !== String(id));
      await writeData(APPOINTMENTS_FILE, appointments);
    }

    res.json({ success: true, message: 'Randevu silindi' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Randevu iptal et (Soft delete - durum değiştir)
app.post('/api/cancel-appointment', async (req, res) => {
  try {
    const { id } = req.query;

    if (useGoogleSheets) {
      const rows = await sheets.appointments.getRows();
      const rowIndex = rows.findIndex(r => String(r.ID) === String(id));
      
      if (rowIndex === -1) {
        return res.status(404).json({ success: false, error: 'Appointment not found' });
      }

      rows[rowIndex].Durum = 'iptal edildi';
      await rows[rowIndex].save();
    } else {
      const appointments = await readData(APPOINTMENTS_FILE);
      const appointmentIndex = appointments.findIndex(apt => String(apt.ID) === String(id));
      
      if (appointmentIndex === -1) {
        return res.status(404).json({ success: false, error: 'Appointment not found' });
      }

      appointments[appointmentIndex].Durum = 'iptal edildi';
      await writeData(APPOINTMENTS_FILE, appointments);
    }

    res.json({ success: true, message: 'Randevu iptal edildi' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== HASTA PANELİ ENDPOİNTLERİ ====================

// Hastanın kendi randevularını görüntüleme
app.get('/api/patient/appointments', async (req, res) => {
  try {
    const { telefon, hastaId } = req.query;
    
    if (!telefon && !hastaId) {
      return res.status(400).json({
        success: false,
        error: 'Gerekli parametreler eksik',
        message: 'telefon veya hastaId parametresi gerekli'
      });
    }

    let appointments = await readData(APPOINTMENTS_FILE);
    
    if (telefon) {
      const cleanPhone = validateAndCleanPhone(telefon);
      if (!cleanPhone) {
        return res.status(400).json({
          success: false,
          error: 'Geçersiz telefon numarası'
        });
      }
      appointments = appointments.filter(apt => 
        validateAndCleanPhone(apt.HastaTelefon) === cleanPhone
      );
    }
    
    if (hastaId) {
      appointments = appointments.filter(apt => 
        String(apt.HastaID) === String(hastaId)
      );
    }

    // Sadece iptal edilmeyen randevuları ve geçmiş olanları ayırt et
    const today = new Date().toISOString().split('T')[0];
    const upcoming = appointments.filter(apt => apt.Tarih >= today && apt.Durum !== 'iptal edildi');
    const past = appointments.filter(apt => apt.Tarih < today || apt.Durum === 'iptal edildi');

    res.json({
      success: true,
      upcoming: upcoming.sort((a, b) => new Date(`${a.Tarih}T${a.Saat}`) - new Date(`${b.Tarih}T${b.Saat}`)),
      past: past.sort((a, b) => new Date(`${b.Tarih}T${b.Saat}`) - new Date(`${a.Tarih}T${a.Saat}`)),
      total: appointments.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== DOKTOR LINK VE SLUG ENDPOİNTLERİ ====================

// Doktor bilgisini slug ile getir
app.get('/api/doctor/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    let users = await readData(USERS_FILE);

    // Slug ile doktoru bul
    let doctor = users.find(u => u.Slug === slug && u.Rol === 'doktor');
    
    if (!doctor) {
      return res.status(404).json({
        success: false,
        error: 'Doktor bulunamadı',
        message: `Slug '${slug}' ile ilişkili doktor bulunamadı`
      });
    }

    // Doktorun hizmetlerini getir
    const doctorServices = await readData(DOCTOR_SERVICES_FILE);
    const services = await readData(SERVICES_FILE);
    
    const doctorServiceIds = doctorServices
      .filter(ds => String(ds.DoktorID) === String(doctor.ID))
      .map(ds => String(ds.HizmetID));

    const availableServices = services.filter(s => doctorServiceIds.includes(String(s.ID)));

    // Doktor müsaitliklerini getir
    const availabilities = await readData(AVAILABILITIES_FILE);
    const doctorAvailabilities = availabilities
      .filter(a => String(a.DoktorID) === String(doctor.ID) && a.Musait === 'TRUE')
      .sort((a, b) => new Date(a.Tarih) - new Date(b.Tarih));

    res.json({
      success: true,
      doctor: {
        id: doctor.ID,
        isim: doctor.Isim,
        soyisim: doctor.Soyisim,
        slug: doctor.Slug,
        telefon: doctor.Telefon
      },
      services: availableServices,
      availabilities: doctorAvailabilities,
      randevuLink: `/randevu/${slug}`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Tüm doktorların slug listesini getir
app.get('/api/doctors/list/all', async (req, res) => {
  try {
    let users = await readData(USERS_FILE);

    const doctors = users
      .filter(u => u.Rol === 'doktor')
      .map(u => ({
        id: u.ID,
        isim: u.Isim,
        soyisim: u.Soyisim,
        slug: u.Slug,
        randevuLink: `/randevu/${u.Slug}`
      }));

    res.json({
      success: true,
      total: doctors.length,
      doctors: doctors
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== BİLDİRİM VE TEMPLATE SİSTEMİ ====================

// Email template'i (Simüle)
app.get('/api/notification/email-template', async (req, res) => {
  try {
    const { appointmentId, type } = req.query;

    if (!appointmentId || !type) {
      return res.status(400).json({
        success: false,
        error: 'Gerekli parametreler eksik'
      });
    }

    let appointments = await readData(APPOINTMENTS_FILE);
    const appointment = appointments.find(apt => String(apt.ID) === String(appointmentId));

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Randevu bulunamadı'
      });
    }

    let template = '';
    let subject = '';

    switch (type) {
      case 'confirmation':
        subject = `Randevu Onaylandı - ${appointment.Tarih} ${appointment.Saat}`;
        template = `
Merhaba ${appointment.HastaAdi},

Randevu başarıyla onaylanmıştır.

📋 Randevu Detayları:
Tarih: ${appointment.Tarih}
Saat: ${appointment.Saat}
Doktor: ${appointment.DoktorAdi}
Hizmet: ${appointment.Hizmet}

📞 İptal etmek için: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/hasta/randevularim

Bizi tercih ettiğiniz için teşekkür ederiz!
        `;
        break;

      case 'reminder':
        subject = `Randevu Hatırlatması - Yarın ${appointment.Saat}`;
        template = `
Merhaba ${appointment.HastaAdi},

Yarın saat ${appointment.Saat}'de randevunuz bulunmaktadır.

Doktor: ${appointment.DoktorAdi}
Hizmet: ${appointment.Hizmet}

Lütfen 10 dakika erken gelmeniz gerekmektedir.
        `;
        break;

      case 'cancellation':
        subject = `Randevu İptal Edildi - ${appointment.Tarih}`;
        template = `
Merhaba ${appointment.HastaAdi},

Randevunuz iptal edilmiştir.

İptal Edilen Randevu:
Tarih: ${appointment.Tarih}
Saat: ${appointment.Saat}
Doktor: ${appointment.DoktorAdi}

Yeni randevu almak için ${process.env.FRONTEND_URL || 'http://localhost:3000'} adresini ziyaret edin.
        `;
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Geçersiz template türü',
          validTypes: ['confirmation', 'reminder', 'cancellation']
        });
    }

    res.json({
      success: true,
      type: type,
      subject: subject,
      body: template.trim(),
      to: appointment.HastaTelefon,
      appointmentId: appointment.ID
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// SMS template'i (Simüle)
app.get('/api/notification/sms-template', async (req, res) => {
  try {
    const { appointmentId, type } = req.query;

    if (!appointmentId || !type) {
      return res.status(400).json({
        success: false,
        error: 'Gerekli parametreler eksik'
      });
    }

    let appointments = await readData(APPOINTMENTS_FILE);
    const appointment = appointments.find(apt => String(apt.ID) === String(appointmentId));

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Randevu bulunamadı'
      });
    }

    let message = '';

    switch (type) {
      case 'confirmation':
        message = `Randevu onaylandı. ${appointment.Tarih} ${appointment.Saat}'de ${appointment.DoktorAdi} ile ${appointment.Hizmet}. İptal: http://example.com`;
        break;

      case 'reminder':
        message = `Hatırlatma: Yarın saat ${appointment.Saat}'de ${appointment.DoktorAdi} ile randevunuz var. Lütfen 10 dakika erken gelin.`;
        break;

      case 'cancellation':
        message = `Randevu iptal edildi (${appointment.Tarih} ${appointment.Saat}). Yeni randevu: http://example.com`;
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Geçersiz template türü',
          validTypes: ['confirmation', 'reminder', 'cancellation']
        });
    }

    res.json({
      success: true,
      type: type,
      message: message,
      to: appointment.HastaTelefon,
      characterCount: message.length,
      smsCount: Math.ceil(message.length / 160),
      appointmentId: appointment.ID
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== HİZMET ENDPOİNTLERİ ====================

// Hizmetleri getir
app.get('/api/get-services', async (req, res) => {
  try {
    const { doktorId, departmanId } = req.query;
    let services;

    if (useGoogleSheets) {
      const rows = await sheets.services.getRows();
      services = rows.map(row => row._rawData);
    } else {
      services = await readData(SERVICES_FILE);
    }

    // Doktor filtresi - doktor-hizmet eşleştirmesi
    if (doktorId) {
      const doctorServices = await readData(DOCTOR_SERVICES_FILE);
      const doctorServiceIds = doctorServices
        .filter(ds => String(ds.DoktorID) === String(doktorId))
        .map(ds => String(ds.HizmetID));
      
      services = services.filter(s => doctorServiceIds.includes(String(s.ID)));
    }

    // Departman filtresi
    if (departmanId) {
      services = services.filter(s => String(s.DepartmanID) === String(departmanId));
    }

    res.json(services);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Hizmet ekle
app.post('/api/add-service', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { isim, sure, departmanId, fiyat } = req.body;
    const newServiceId = generateId();

    if (useGoogleSheets) {
      await sheets.services.addRow({
        ID: newServiceId, Isim: isim, Sure: sure, 
        DepartmanID: departmanId || '', Fiyat: fiyat || '',
        OlusturmaTarihi: new Date().toISOString()
      });
    } else {
      const services = await readData(SERVICES_FILE);
      services.push({
        ID: newServiceId, Isim: isim, Sure: sure,
        DepartmanID: departmanId || '', Fiyat: fiyat || '',
        OlusturmaTarihi: new Date().toISOString()
      });
      await writeData(SERVICES_FILE, services);
    }

    res.json({ success: true, id: newServiceId, isim, sure });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Hizmet güncelle
app.post('/api/update-service', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.query;
    const { isim, sure, departmanId, fiyat } = req.body;

    const services = await readData(SERVICES_FILE);
    const serviceIndex = services.findIndex(s => String(s.ID) === String(id));
    
    if (serviceIndex === -1) {
      return res.status(404).json({ success: false, error: 'Service not found' });
    }

    if (isim) services[serviceIndex].Isim = isim;
    if (sure) services[serviceIndex].Sure = sure;
    if (departmanId !== undefined) services[serviceIndex].DepartmanID = departmanId;
    if (fiyat !== undefined) services[serviceIndex].Fiyat = fiyat;

    await writeData(SERVICES_FILE, services);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Hizmet sil
app.delete('/api/delete-service', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.query;

    if (useGoogleSheets) {
      const rows = await sheets.services.getRows();
      const rowIndex = rows.findIndex(r => String(r.ID) === String(id));
      
      if (rowIndex === -1) {
        return res.status(404).json({ success: false, error: 'Service not found' });
      }

      await rows[rowIndex].delete();
    } else {
      let services = await readData(SERVICES_FILE);
      services = services.filter(s => String(s.ID) !== String(id));
      await writeData(SERVICES_FILE, services);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== DEPARTMAN ENDPOİNTLERİ ====================

// Departmanları getir
app.get('/api/get-departments', async (req, res) => {
  try {
    const departments = await readData(DEPARTMENTS_FILE);
    res.json(departments);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Departman ekle
app.post('/api/add-department', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { isim, aciklama } = req.body;
    const departments = await readData(DEPARTMENTS_FILE);
    
    const newDepartment = {
      ID: generateId(),
      Isim: isim,
      Aciklama: aciklama || '',
      OlusturmaTarihi: new Date().toISOString()
    };

    departments.push(newDepartment);
    await writeData(DEPARTMENTS_FILE, departments);

    res.json({ success: true, id: newDepartment.ID });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Departman sil
app.delete('/api/delete-department', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.query;
    let departments = await readData(DEPARTMENTS_FILE);
    
    departments = departments.filter(d => String(d.ID) !== String(id));
    await writeData(DEPARTMENTS_FILE, departments);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== DOKTOR-HİZMET EŞLEŞTİRME ====================

// Doktorun hizmetlerini getir
app.get('/api/get-doctor-services', async (req, res) => {
  try {
    const { doktorId } = req.query;
    const doctorServices = await readData(DOCTOR_SERVICES_FILE);
    
    let filtered = doctorServices;
    if (doktorId) {
      filtered = doctorServices.filter(ds => String(ds.DoktorID) === String(doktorId));
    }

    res.json(filtered);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Doktora hizmet ata
app.post('/api/assign-service-to-doctor', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { doktorId, hizmetId } = req.body;
    const doctorServices = await readData(DOCTOR_SERVICES_FILE);
    
    // Zaten atanmış mı kontrol et
    const exists = doctorServices.find(ds => 
      String(ds.DoktorID) === String(doktorId) && 
      String(ds.HizmetID) === String(hizmetId)
    );

    if (exists) {
      return res.json({ success: true, message: 'Hizmet zaten atanmış' });
    }

    const newAssignment = {
      ID: generateId(),
      DoktorID: doktorId,
      HizmetID: hizmetId,
      OlusturmaTarihi: new Date().toISOString()
    };

    doctorServices.push(newAssignment);
    await writeData(DOCTOR_SERVICES_FILE, doctorServices);

    res.json({ success: true, id: newAssignment.ID });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Doktordan hizmet kaldır
app.delete('/api/remove-service-from-doctor', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { doktorId, hizmetId } = req.query;
    let doctorServices = await readData(DOCTOR_SERVICES_FILE);
    
    doctorServices = doctorServices.filter(ds => 
      !(String(ds.DoktorID) === String(doktorId) && String(ds.HizmetID) === String(hizmetId))
    );

    await writeData(DOCTOR_SERVICES_FILE, doctorServices);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== MÜSAİTLİK ENDPOİNTLERİ ====================

// Müsaitleri getir
app.get('/api/get-availabilities', async (req, res) => {
  try {
    const { doktorId, tarih } = req.query;
    let availabilities;

    if (useGoogleSheets) {
      const rows = await sheets.availabilities.getRows();
      availabilities = rows.map(row => row._rawData);
    } else {
      availabilities = await readData(AVAILABILITIES_FILE);
    }

    if (doktorId) availabilities = availabilities.filter(a => String(a.DoktorID) === String(doktorId));
    if (tarih) availabilities = availabilities.filter(a => a.Tarih === tarih);

    res.json(availabilities);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Müsait saatleri getir (Randevular ile birlikte hesaplanmış)
app.get('/api/get-available-slots', async (req, res) => {
  try {
    const { doktorId, tarih, hizmetId } = req.query;
    
    if (!doktorId || !tarih) {
      return res.status(400).json({ 
        success: false, 
        error: 'doktorId ve tarih parametreleri gerekli' 
      });
    }

    const availableSlots = await getAvailableTimeSlots(doktorId, tarih, hizmetId);

    res.json({
      success: true,
      doktorId,
      tarih,
      hizmetId: hizmetId || null,
      slots: availableSlots
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Müsaitlik ekle
app.post('/api/add-availability', async (req, res) => {
  try {
    const { doktorId, doktorAdi, tarih, baslangicSaati, bitisSaati } = req.body;
    const newAvailabilityId = generateId();

    if (useGoogleSheets) {
      await sheets.availabilities.addRow({
        ID: newAvailabilityId, DoktorID: doktorId, DoktorAdi: doktorAdi, Tarih: tarih,
        BaslangicSaati: baslangicSaati, BitisSaati: bitisSaati, Musait: 'TRUE',
        OlusturulmaTarihi: new Date().toISOString().split('T')[0]
      });
    } else {
      const availabilities = await readData(AVAILABILITIES_FILE);
      availabilities.push({
        ID: newAvailabilityId, DoktorID: doktorId, DoktorAdi: doktorAdi, Tarih: tarih,
        BaslangicSaati: baslangicSaati, BitisSaati: bitisSaati, Musait: 'TRUE',
        OlusturulmaTarihi: new Date().toISOString().split('T')[0]
      });
      await writeData(AVAILABILITIES_FILE, availabilities);
    }

    res.json({ success: true, id: newAvailabilityId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Müsaitlik sil
app.delete('/api/delete-availability', async (req, res) => {
  try {
    const { id } = req.query;

    if (useGoogleSheets) {
      const rows = await sheets.availabilities.getRows();
      const rowIndex = rows.findIndex(r => String(r.ID) === String(id));
      
      if (rowIndex === -1) {
        return res.status(404).json({ success: false, error: 'Availability not found' });
      }

      await rows[rowIndex].delete();
    } else {
      let availabilities = await readData(AVAILABILITIES_FILE);
      availabilities = availabilities.filter(a => String(a.ID) !== String(id));
      await writeData(AVAILABILITIES_FILE, availabilities);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== İSTATİSTİK ENDPOİNTLERİ ====================

// Dashboard istatistikleri
app.get('/api/get-stats', async (req, res) => {
  try {
    const appointments = await readData(APPOINTMENTS_FILE);
    const users = await readData(USERS_FILE);
    const services = await readData(SERVICES_FILE);

    const today = new Date().toISOString().split('T')[0];
    
    // Bugünkü randevular
    const todayAppointments = appointments.filter(apt => apt.Tarih === today);
    
    // Durum bazlı sayılar
    const confirmedCount = appointments.filter(apt => apt.Durum === 'onaylandı').length;
    const pendingCount = appointments.filter(apt => apt.Durum === 'beklemede').length;
    const cancelledCount = appointments.filter(apt => apt.Durum === 'iptal edildi').length;

    // Doktor sayıları
    const doctors = users.filter(u => u.Rol === 'doktor');
    
    // En popüler hizmetler
    const serviceCounts = {};
    appointments.forEach(apt => {
      if (apt.Hizmet) {
        serviceCounts[apt.Hizmet] = (serviceCounts[apt.Hizmet] || 0) + 1;
      }
    });
    
    const popularServices = Object.entries(serviceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([service, count]) => ({ service, count }));

    res.json({
      success: true,
      totalAppointments: appointments.length,
      todayAppointments: todayAppointments.length,
      confirmedAppointments: confirmedCount,
      pendingAppointments: pendingCount,
      cancelledAppointments: cancelledCount,
      totalDoctors: doctors.length,
      totalServices: services.length,
      popularServices
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Doktor performans raporu
app.get('/api/get-doctor-performance', async (req, res) => {
  try {
    const { doktorId, baslangic, bitis } = req.query;
    let appointments = await readData(APPOINTMENTS_FILE);

    if (doktorId) {
      appointments = appointments.filter(apt => String(apt.DoktorID) === String(doktorId));
    }
    
    if (baslangic) {
      appointments = appointments.filter(apt => apt.Tarih >= baslangic);
    }
    
    if (bitis) {
      appointments = appointments.filter(apt => apt.Tarih <= bitis);
    }

    // Doktorlara göre grupla
    const doctorStats = {};
    appointments.forEach(apt => {
      const doctorKey = apt.DoktorID;
      if (!doctorStats[doctorKey]) {
        doctorStats[doctorKey] = {
          doktorId: apt.DoktorID,
          doktorAdi: apt.DoktorAdi,
          totalAppointments: 0,
          confirmed: 0,
          cancelled: 0,
          pending: 0
        };
      }
      
      doctorStats[doctorKey].totalAppointments++;
      
      if (apt.Durum === 'onaylandı') doctorStats[doctorKey].confirmed++;
      if (apt.Durum === 'iptal edildi') doctorStats[doctorKey].cancelled++;
      if (apt.Durum === 'beklemede') doctorStats[doctorKey].pending++;
    });

    res.json({
      success: true,
      doctors: Object.values(doctorStats)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== GOOGLE SHEETS EXPORT ENDPOİNTİ ====================

// Google Sheets'e tüm verileri senkronize et
app.post('/api/export/sync-to-sheets', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Sadece admin senkronizasyon yapabilir' });
    }

    if (!useGoogleSheets) {
      return res.status(400).json({ 
        error: 'Google Sheets aktif değil', 
        message: 'Lütfen .env dosyasında GOOGLE_SHEET_ID ayarlayın' 
      });
    }

    // Tüm verileri oku
    const users = await readData(USERS_FILE);
    const appointments = await readData(APPOINTMENTS_FILE);
    const services = await readData(SERVICES_FILE);
    const availabilities = await readData(AVAILABILITIES_FILE);

    // Her sheet'i güncelle
    if (sheets.users) {
      await sheets.users.clearRows();
      if (users.length > 0) {
        await sheets.users.addRows(users);
      }
    }

    if (sheets.appointments) {
      await sheets.appointments.clearRows();
      if (appointments.length > 0) {
        await sheets.appointments.addRows(appointments);
      }
    }

    if (sheets.services) {
      await sheets.services.clearRows();
      if (services.length > 0) {
        await sheets.services.addRows(services);
      }
    }

    if (sheets.availabilities) {
      await sheets.availabilities.clearRows();
      if (availabilities.length > 0) {
        await sheets.availabilities.addRows(availabilities);
      }
    }

    res.json({ 
      success: true, 
      message: 'Tüm veriler Google Sheets\'e aktarıldı',
      sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}`
    });

  } catch (error) {
    console.error('❌ Google Sheets senkronizasyon hatası:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== DURUM ENDPOİNTİ ====================

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    database: useGoogleSheets ? 'Google Sheets' : 'JSON Files',
    mode: process.env.NODE_ENV || 'development',
    version: '2.1.0',
    features: {
      conflictCheck: true,
      availabilityCheck: true,
      departmentSystem: true,
      doctorServiceMapping: true,
      statistics: true,
      doctorLinks: true,
      phoneValidation: true,
      patientPanel: true,
      notificationTemplates: true,
      googleSheetsSync: true
    }
  });
});

// ==================== SUNUCU ====================

app.listen(PORT, async () => {
  console.log(`\n✅ Backend sunucusu çalışıyor!`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`\n🔄 Veritabanı Modunu Kontrol Ediliyor...`);
  
  // Google Sheets'i başlat
  const sheetsInitialized = await initializeSheets();
  useGoogleSheets = sheetsInitialized;

  if (useGoogleSheets) {
    console.log(`✅ Google Sheets Modu Aktif`);
    console.log(`📊 Sheet ID: ${SHEET_ID}`);
    console.log(`🔗 Sheets URL: https://docs.google.com/spreadsheets/d/${SHEET_ID}`);
  } else {
    console.log(`✅ JSON Dosya Modu Aktif`);
    console.log(`📁 Veri Klasörü: ./data/`);
    console.log(`💡 Google Sheets kullanmak için .env dosyasında GOOGLE_SHEET_ID ayarlayın`);
  }

  console.log(`\n📋 BACKEND v2.1 - TÜKÜNE HAZIRLANDI:`);
  console.log(`   ✅ Çakışma Kontrolü`);
  console.log(`   ✅ Müsaitlik Kontrolü`);
  console.log(`   ✅ Departman/Hizmet Sistemi`);
  console.log(`   ✅ Doktor-Hizmet Eşleştirme`);
  console.log(`   ✅ İstatistikler ve Raporlar`);
  console.log(`   ✅ Gelişmiş Filtreleme`);
  console.log(`   ✅ Doktor Benzersiz Linkleri (Slug)`);
  console.log(`   ✅ Telefon Validasyonu`);
  console.log(`   ✅ Hasta Paneli (Kendi Randevuları)`);
  console.log(`   ✅ Email/SMS Template Sistemi\n`);

  console.log(`📋 API Endpointleri (${useGoogleSheets ? 'Google Sheets' : 'JSON'} modu):\n`);
  console.log(`   KULLANICI (5):`);
  console.log(`   ✓ POST   /api/check-user (telefon ile arama)`);
  console.log(`   ✓ GET    /api/get-users`);
  console.log(`   ✓ POST   /api/add-user (telefon validasyonu)`);
  console.log(`   ✓ POST   /api/update-user`);
  console.log(`   ✓ DELETE /api/delete-user\n`);
  
  console.log(`   RANDEVU (6):`);
  console.log(`   ✓ POST   /api/add-appointment (+ çakışma kontrolü)`);
  console.log(`   ✓ GET    /api/get-appointments (+ filtreleme)`);
  console.log(`   ✓ POST   /api/update-appointment (+ çakışma kontrolü)`);
  console.log(`   ✓ DELETE /api/delete-appointment`);
  console.log(`   ✓ POST   /api/cancel-appointment`);
  console.log(`   ✓ GET    /api/get-available-slots\n`);
  
  console.log(`   HİZMET (4):`);
  console.log(`   ✓ GET    /api/get-services (+ doktor filtresi)`);
  console.log(`   ✓ POST   /api/add-service`);
  console.log(`   ✓ POST   /api/update-service`);
  console.log(`   ✓ DELETE /api/delete-service\n`);
  
  console.log(`   DEPARTMAN (3):`);
  console.log(`   ✓ GET    /api/get-departments`);
  console.log(`   ✓ POST   /api/add-department`);
  console.log(`   ✓ DELETE /api/delete-department\n`);
  
  console.log(`   DOKTOR-HİZMET EŞLEŞTİRME (3):`);
  console.log(`   ✓ GET    /api/get-doctor-services`);
  console.log(`   ✓ POST   /api/assign-service-to-doctor`);
  console.log(`   ✓ DELETE /api/remove-service-from-doctor\n`);
  
  console.log(`   MÜSAİTLİK (3):`);
  console.log(`   ✓ GET    /api/get-availabilities`);
  console.log(`   ✓ POST   /api/add-availability`);
  console.log(`   ✓ DELETE /api/delete-availability\n`);
  
  console.log(`   İSTATİSTİK (2):`);
  console.log(`   ✓ GET    /api/get-stats`);
  console.log(`   ✓ GET    /api/get-doctor-performance\n`);

  console.log(`   HASTA PANELİ (1) - YENİ:`);
  console.log(`   ✓ GET    /api/patient/appointments\n`);

  console.log(`   DOKTOR LINKLERI (2) - YENİ:`);
  console.log(`   ✓ GET    /api/doctor/:slug`);
  console.log(`   ✓ GET    /api/doctors/list/all\n`);

  console.log(`   BİLDİRİM TEMPLATLERİ (2) - YENİ:`);
  console.log(`   ✓ GET    /api/notification/email-template`);
  console.log(`   ✓ GET    /api/notification/sms-template\n`);

  console.log(`   GOOGLE SHEETS SYNC (1) - YENİ:`);
  console.log(`   ✓ POST   /api/export/sync-to-sheets (Admin only)\n`);
  
  console.log(`   DURUM (1):`);
  console.log(`   ✓ GET    /api/status\n`);
  
  console.log(`📊 TOPLAM: 33 Endpoint\n`);
});
