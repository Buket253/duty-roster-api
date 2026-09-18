import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { createApp } from '../src/app.js';
import Admin from '../src/models/Admin.js';
import Unit from '../src/models/Unit.js';
import Employee from '../src/models/Employee.js';
import ShiftRule from '../src/models/ShiftRule.js';

const YEAR = 2026;
const MONTH = 10;

let mongod;
let server;
let base;
let token;
let unitId;

const api = async (path, { method = 'GET', body, auth = true } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.JWT_SECRET = 'test-secret';
  await mongoose.connect(mongod.getUri());

  await Admin.create({ email: 'admin@test.local', passwordHash: await bcrypt.hash('sifre123', 10) });
  const unit = await Unit.create({ name: 'Dahiliye', shiftTypes: ['nobet-24', 'mesai-8'] });
  unitId = String(unit._id);
  await ShiftRule.create({ unit: unit._id });
  await Employee.insertMany(
    ['Dr. Elif Yılmaz', 'Dr. Mert Kaya', 'Dr. Zeynep Demir', 'Dr. Can Öztürk', 'Dr. Selin Arslan'].map(
      (name) => ({ name, unit: unit._id, title: 'Uzman', active: true })
    )
  );

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await mongoose.disconnect();
  await mongod?.stop();
});

test('JWT olmadan /api/admin/* 401 döner', async () => {
  const res = await api('/api/admin/units', { auth: false });
  assert.equal(res.status, 401);
});

test('hatalı şifre 401, doğru şifre token döner', async () => {
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { email: 'admin@test.local', password: 'yanlis' }, auth: false })).status, 401);

  const ok = await api('/api/auth/login', { method: 'POST', body: { email: 'admin@test.local', password: 'sifre123' }, auth: false });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  token = ok.body.token;
});

test('birim listesi çalışan sayısıyla döner', async () => {
  const res = await api('/api/admin/units');
  assert.equal(res.status, 200);
  assert.equal(res.body[0].employeeCount, 5);
});

test('kural varsayılanları Bölüm 8 ile uyumlu', async () => {
  const { body } = await api(`/api/admin/rules/${unitId}`);
  assert.equal(body.minRestHoursAfterDuty, 24);
  assert.equal(body.minDutiesPerMonth, 4);
  assert.equal(body.maxDutiesPerMonth, 7);
  assert.equal(body.maxConsecutiveDuties, 1);
  assert.equal(body.weekendFairnessWeight, 70);
  assert.equal(body.excludeOnLeave, true);
  assert.equal(body.requireSeniorPairing, false);
});

test('izin eklenebiliyor', async () => {
  const employees = (await api(`/api/admin/employees?unit=${unitId}`)).body;
  const res = await api('/api/admin/leaves', {
    method: 'POST',
    body: {
      employee: employees[0]._id,
      startDate: `${YEAR}-10-06`,
      endDate: `${YEAR}-10-10`,
      type: 'yillik',
    },
  });
  assert.equal(res.status, 201);
});

test('taslak üretimi gerçek atama seti çıkarıyor, izinliyi atlıyor', async () => {
  const res = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/generate`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(res.body.schedule.status, 'taslak');

  const { assignments } = res.body;
  assert.equal(assignments.filter((a) => a.shiftType === 'nobet-24').length, 31);
  assert.equal(assignments.filter((a) => a.shiftType === 'mesai-8').length, 22);
  assert.equal(res.body.warnings.total, 0, 'varsayılan kurallarla ihlalsiz çözüm bulunmalı');

  // İzinli kişi izin günlerinde atanmamış olmalı
  const onLeave = String(res.body.leaves[0].employee);
  const clash = assignments.filter(
    (a) => a.employee && String(a.employee._id) === onLeave && a.date >= `${YEAR}-10-06` && a.date <= `${YEAR}-10-10T23:59`
  );
  assert.equal(clash.length, 0);
});

test('kural değişikliği bir sonraki üretimde etkili oluyor', async () => {
  await api(`/api/admin/rules/${unitId}`, { method: 'PUT', body: { maxDutiesPerMonth: 5 } });
  const { body } = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/generate`, { method: 'POST' });

  const perEmployee = {};
  for (const a of body.assignments) {
    if (a.employee && a.shiftType === 'nobet-24') {
      perEmployee[a.employee._id] = (perEmployee[a.employee._id] ?? 0) + 1;
    }
  }
  assert.ok(Math.max(...Object.values(perEmployee)) <= 5, 'kimse 5 nöbeti aşmamalı');
  assert.ok(body.warnings.byFlag['doldurulamadi'] > 0, '5x5=25 < 31 → doldurulamayan slot olmalı');

  await api(`/api/admin/rules/${unitId}`, { method: 'PUT', body: { maxDutiesPerMonth: 7 } });
  await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/generate`, { method: 'POST' });
});

test('manuel atama kural kontrolünü tetikliyor ve flag üretiyor', async () => {
  const before = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}`);
  const duties = before.body.assignments.filter((a) => a.shiftType === 'nobet-24' && a.employee);

  // 2. günün nöbetçisini 1. günün nöbetçisiyle değiştir → ardışık nöbet
  const day1 = duties[0];
  const day2 = duties[1];

  const candidates = await api(`/api/admin/assignments/${day2._id}/candidates`);
  assert.equal(candidates.status, 200);
  assert.equal(candidates.body.reasons[day1.employee._id], 'yetersiz-dinlenme');

  const res = await api(`/api/admin/assignments/${day2._id}`, {
    method: 'PUT',
    body: { employee: day1.employee._id },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.updatedAssignment.flags.sort(), ['ardisik-nobet', 'yetersiz-dinlenme']);
  assert.ok(res.body.warnings.total > 0);

  // Geri al
  await api(`/api/admin/assignments/${day2._id}`, { method: 'PUT', body: { employee: day2.employee._id } });
  const after = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}`);
  assert.equal(after.body.warnings.flagged, 0, 'geri alınca flag temizlenmeli');
});

test('başka birimin çalışanı atanamıyor', async () => {
  const other = await api('/api/admin/units', { method: 'POST', body: { name: 'Acil', shiftTypes: ['nobet-24'] } });
  const outsider = await api('/api/admin/employees', { method: 'POST', body: { name: 'Dr. Yabancı', unit: other.body._id } });
  const { body } = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}`);

  const res = await api(`/api/admin/assignments/${body.assignments[0]._id}`, {
    method: 'PUT',
    body: { employee: outsider.body._id },
  });
  assert.equal(res.status, 400);
});

test('paylaşım linki taslağı göstermiyor, yayınlandıktan sonra gösteriyor', async () => {
  const link = await api(`/api/admin/share-links/${unitId}`);
  assert.equal(link.status, 200);
  assert.match(link.body.token, /^[a-f0-9]{32}$/);

  const draft = await api(`/api/public/${link.body.token}/${YEAR}/${MONTH}`, { auth: false });
  assert.equal(draft.status, 404, 'taslak public route\'tan görünmemeli');

  const { body } = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}`);
  const published = await api(`/api/admin/schedules/${body.schedule._id}/publish`, { method: 'POST' });
  assert.equal(published.body.status, 'yayinda');

  const view = await api(`/api/public/${link.body.token}/${YEAR}/${MONTH}`, { auth: false });
  assert.equal(view.status, 200);
  assert.equal(view.body.unit.name, 'Dahiliye');
  assert.equal(view.body.days.length, 31);
  assert.ok(view.body.days.every((d) => d.nobet.length === 1));
  assert.ok(view.body.days[0].nobet[0].name);

  const bad = await api(`/api/public/gecersiz-token/${YEAR}/${MONTH}`, { auth: false });
  assert.equal(bad.status, 404);
});
