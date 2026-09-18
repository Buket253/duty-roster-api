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

const EMPLOYEES = [
  { name: 'Dr. Elif Yılmaz', title: 'Uzman' },
  { name: 'Dr. Mert Kaya', title: 'Uzman' },
  { name: 'Dr. Zeynep Demir', title: 'Asistan' },
  { name: 'Dr. Can Öztürk', title: 'Asistan' },
  { name: 'Dr. Selin Arslan', title: 'Asistan' },
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
  name: 'Dahiliye',
  shiftTypes: ['nobet-24', 'mesai-8'],
  minStaffPerDay: 1,
  active: true,
});

// Bölüm 8'deki varsayılanlar; şema default'ları ile birebir aynı.
const rule = await ShiftRule.create({ unit: unit._id });

const employees = await Employee.insertMany(
  EMPLOYEES.map((e) => ({ ...e, unit: unit._id, active: true }))
);

const byName = (name) => employees.find((e) => e.name === name)._id;

await LeaveRequest.insertMany([
  {
    employee: byName('Dr. Zeynep Demir'),
    startDate: utcDate(YEAR, MONTH, 6),
    endDate: utcDate(YEAR, MONTH, 10),
    type: 'yillik',
  },
  {
    employee: byName('Dr. Can Öztürk'),
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
console.log(`  Kural    : min ${rule.minDutiesPerMonth} / maks ${rule.maxDutiesPerMonth} nöbet`);
console.log(`\n  Taslak üretmek için: POST /api/admin/schedules/${unit._id}/${YEAR}/${MONTH}/generate`);

await mongoose.disconnect();
