import 'dotenv/config';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';

import Admin from '../models/Admin.js';
import Unit from '../models/Unit.js';
import Employee from '../models/Employee.js';
import LeaveRequest from '../models/LeaveRequest.js';
import ShiftRule from '../models/ShiftRule.js';
import Schedule from '../models/Schedule.js';
import DutyAssignment from '../models/DutyAssignment.js';
import ShareLink from '../models/ShareLink.js';
import { utcDate } from '../utils/dates.js';

const {
  MONGODB_URI,
  SEED_ADMIN_EMAIL = 'admin@hastane.local',
  SEED_ADMIN_PASSWORD = 'Nobet2025!',
  SEED_YEAR = String(new Date().getUTCFullYear()),
} = process.env;

const YEAR = Number(SEED_YEAR);
const MONTH = 10; // Ekim — örnek dönem

// Üç personel tipinin hepsi örnek veride temsil edilir.
const EMPLOYEES = [
  { name: 'Elif Yılmaz', title: 'Sorumlu hemşire', staffType: 'sorumlu' },
  { name: 'Nalan Acar', title: 'Hemşire', staffType: 'sadece-gunduz' },
  { name: 'Mert Kaya', title: 'Hemşire', staffType: 'standart' },
  { name: 'Zeynep Demir', title: 'Hemşire', staffType: 'standart' },
  { name: 'Can Öztürk', title: 'Hemşire', staffType: 'standart' },
  { name: 'Selin Arslan', title: 'Hemşire', staffType: 'standart' },
  { name: 'Burak Şahin', title: 'Hemşire', staffType: 'standart' },
  { name: 'Deniz Yıldırım', title: 'Hemşire', staffType: 'standart' },
  // Gebelik raporu: gündüz rotasyonunda kalır, nöbete yazılmaz.
  { name: 'Pınar Ateş', title: 'Hemşire', staffType: 'standart', canTakeDuty: false },
];

if (!MONGODB_URI) {
  console.error('MONGODB_URI tanımlı değil (.env dosyasına bakın)');
  process.exit(1);
}

await mongoose.connect(MONGODB_URI);

// Seed tekrar çalıştırılabilir olsun diye mevcut örnek veri temizlenir.
await Promise.all([
  Admin.deleteMany({}),
  Unit.deleteMany({}),
  Employee.deleteMany({}),
  LeaveRequest.deleteMany({}),
  ShiftRule.deleteMany({}),
  Schedule.deleteMany({}),
  DutyAssignment.deleteMany({}),
  ShareLink.deleteMany({}),
]);

await Admin.create({
  email: SEED_ADMIN_EMAIL.toLowerCase(),
  passwordHash: await bcrypt.hash(SEED_ADMIN_PASSWORD, 10),
});

const unit = await Unit.create({
  name: 'Nöroloji Yoğun Bakım',
  shiftTypes: ['nobet-24', 'mesai-8'],
  active: true,
});

// Kadro: hafta içi 5 gündüz + 1 nöbetçi, hafta sonu yalnızca 1 nöbetçi.
// Sorumlu ve sadece-gündüz personeli bu 5 kişinin İÇİNDEN sayılır; kalan 3 yeri
// rotasyon doldurur. Haftalık 32 saat kuralının tutması için gereken alan budur.
const rule = await ShiftRule.create({
  unit: unit._id,
  weekdayDayStaff: 5,
  weekdayDutyStaff: 1,
  weekendDayStaff: 0,
  weekendDutyStaff: 1,
});

const employees = await Employee.insertMany(
  EMPLOYEES.map((e) => ({ ...e, unit: unit._id, active: true }))
);

const byName = (name) => employees.find((e) => e.name === name)._id;

await LeaveRequest.insertMany([
  // Kurala uygun izin: Pazartesi başlar, dönüş günü de Pazartesi.
  {
    employee: byName('Zeynep Demir'),
    startDate: utcDate(YEAR, MONTH, 5),
    endDate: utcDate(YEAR, MONTH, 11),
    type: 'yillik',
  },
  // Kurala uymayan izin: Salı başlıyor — uyarı üretir ama engellenmez.
  {
    employee: byName('Can Öztürk'),
    startDate: utcDate(YEAR, MONTH, 20),
    endDate: utcDate(YEAR, MONTH, 22),
    type: 'rapor',
  },
]);

console.log('Seed tamamlandı');
console.log(`  Yönetici : ${SEED_ADMIN_EMAIL} / ${SEED_ADMIN_PASSWORD}`);
console.log(`  Birim    : ${unit.name} (${unit._id})`);
console.log(`  Çalışan  : ${employees.length} kişi`);
console.log(`  İzin     : 2 kayıt (${MONTH}/${YEAR})`);
console.log(`  Kadro    : hafta içi ${rule.weekdayDayStaff} gündüz + ${rule.weekdayDutyStaff} nöbetçi, hafta sonu ${rule.weekendDayStaff} gündüz + ${rule.weekendDutyStaff} nöbetçi`);
console.log(`  Kural    : min ${rule.minDutiesPerMonth} / maks ${rule.maxDutiesPerMonth} nöbet, ${rule.minRestDaysAfterDuty} gün dinlenme`);
console.log(`\n  Taslak üretmek için: POST /api/admin/schedules/${unit._id}/${YEAR}/${MONTH}/generate`);

await mongoose.disconnect();
