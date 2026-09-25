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
let izinli;

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
  const unit = await Unit.create({ name: 'Nöroloji Yoğun Bakım', shiftTypes: ['nobet-24', 'mesai-8'] });
  unitId = String(unit._id);
  await ShiftRule.create({ unit: unit._id });
  // Üç personel tipi de temsil edilsin: 1 sorumlu, 1 sadece-gündüz, 6 nöbet havuzu,
  // 1 de nöbeti kapatılmış standart personel.
  await Employee.insertMany(
    [
      { name: 'Elif Yılmaz', staffType: 'sorumlu' },
      { name: 'Nalan Acar', staffType: 'sadece-gunduz' },
      { name: 'Pınar Ateş', staffType: 'standart', canTakeDuty: false },
      { name: 'Ayla Kurt' },
      { name: 'Berk Doğan' },
      { name: 'Ceren Işık' },
      { name: 'Deniz Yıldırım' },
      { name: 'Emre Tan' },
      { name: 'Funda Ok' },
    ].map((e) => ({ staffType: 'standart', title: 'Hemşire', ...e, unit: unit._id, active: true }))
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
  assert.equal(res.body[0].employeeCount, 9);
});

test('kural varsayılanları: kadro, dinlenme ve adalet alanları', async () => {
  const { body } = await api(`/api/admin/rules/${unitId}`);
  assert.equal(body.weekdayDayStaff, 4);
  assert.equal(body.weekdayDutyStaff, 1);
  assert.equal(body.weekendDayStaff, 0);
  assert.equal(body.weekendDutyStaff, 1);
  assert.equal(body.minRestDaysAfterDuty, 1);
  assert.equal(body.maxTightGapsPerMonth, 1);
  assert.equal(body.maxIdleDays, 3);
  assert.equal(body.minDutiesPerMonth, 4);
  assert.equal(body.maxDutiesPerMonth, 7);
  assert.equal(body.minWeeklyHours, 32);
  assert.equal(body.excludeOnLeave, true);
});

test('birimde ikinci sorumlu hemşire kabul edilmiyor', async () => {
  const res = await api('/api/admin/employees', {
    method: 'POST',
    body: { name: 'İkinci Sorumlu', unit: unitId, staffType: 'sorumlu' },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /zaten bir sorumlu hemşire/);
});

test('kadro 9 kişilik ekibe göre ayarlanabiliyor', async () => {
  // Varsayılan 4 gündüz, 2 her gün gelen personelle rotasyona yalnızca 2 yer
  // bırakıyor; haftalık 32 saat kuralının tutması için 5'e çıkarılıyor.
  const res = await api(`/api/admin/rules/${unitId}`, {
    method: 'PUT',
    body: { weekdayDayStaff: 5 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.weekdayDayStaff, 5);
  assert.equal(res.body.maxIdleDays, 3, 'varsayılan bekleme sınırı');
});

test('bekleme sınırı sağlanamadığında uyarı olarak raporlanıyor', async () => {
  // Hafta sonu gündüz kadrosu 0 olduğu için sınır 1'e çekilince sağlanamaz.
  await api(`/api/admin/rules/${unitId}`, { method: 'PUT', body: { maxIdleDays: 1 } });
  const { body } = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/generate`, { method: 'POST' });

  assert.ok(body.warnings.idleExceeded.length > 0, 'aşım raporlanmalı');
  assert.ok(body.warnings.idleExceeded.every((r) => r.days > 1 && r.limit === 1));

  await api(`/api/admin/rules/${unitId}`, { method: 'PUT', body: { maxIdleDays: 3 } });
});

test('sabit resmi tatiller hazır gelir, o günlere yalnızca nöbetçi yazılır', async () => {
  const { body } = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/generate`, { method: 'POST' });

  // 29 Ekim Cumhuriyet Bayramı kural setine elle eklenmeden tanınmalı.
  assert.ok(
    body.holidays.some((h) => h.date === `${YEAR}-10-29` && h.name === 'Cumhuriyet Bayramı'),
    `takvimde işaretlenmeli: ${JSON.stringify(body.holidays)}`
  );

  const tatil = body.assignments.filter((a) => a.date.startsWith(`${YEAR}-10-29`));
  assert.equal(tatil.filter((a) => a.shiftType === 'mesai-8').length, 0, 'tatilde gündüz yok');
  assert.equal(tatil.filter((a) => a.shiftType === 'nobet-24').length, 1, 'nöbetçi var');

  const gecersiz = await api(`/api/admin/rules/${unitId}`, {
    method: 'PUT',
    body: { holidays: ['29.10.2026'] },
  });
  assert.equal(gecersiz.status, 400);
});

test('izin eklenebiliyor', async () => {
  const employees = (await api(`/api/admin/employees?unit=${unitId}`)).body;
  izinli = employees.find((e) => e.name === 'Ayla Kurt');
  // 5 Ekim 2026 Pazartesi - 11 Ekim Pazar; dönüş 12 Ekim Pazartesi (kurala uygun).
  const res = await api('/api/admin/leaves', {
    method: 'POST',
    body: { employee: izinli._id, startDate: `${YEAR}-10-05`, endDate: `${YEAR}-10-11`, type: 'yillik' },
  });
  assert.equal(res.status, 201);
});

test('taslak üretimi gerçek atama seti çıkarıyor, izinliyi atlıyor', async () => {
  const res = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/generate`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(res.body.schedule.status, 'taslak');

  const { assignments } = res.body;
  assert.equal(assignments.filter((a) => a.shiftType === 'nobet-24').length, 31, 'her gün 1 nöbetçi');
  // Gündüz sayısı kadroya eşit: 21 gün × 5. (29 Ekim Cumhuriyet Bayramı sabit
  // resmi tatil olarak hazır gelir, o gün gündüz kadrosu açılmaz.) Her gün gelen
  // personel bu sayının içinden sayılır, üstüne eklenmez.
  assert.equal(assignments.filter((a) => a.shiftType === 'mesai-8').length, 105);
  const uyari = res.body.warnings;
  // Sert kurallar (dinlenme, çifte atama, izin, limit) hiç ihlal edilmemeli.
  assert.deepEqual(uyari.byFlag, {}, `atama ihlali beklenmiyor: ${JSON.stringify(uyari.byFlag)}`);
  assert.deepEqual(uyari.belowMin, []);
  assert.deepEqual(uyari.overCapacity, []);
  assert.deepEqual(uyari.weeklyShort, []);

  // Bekleme sınırı hedeftir, sert kural değil: hafta sonu gündüz kadrosu 0 olduğu
  // için Cumartesi-Pazar zaten 2 gün boşluk demek ve sınır 3'e çok yaklaşıyor.
  // Aşım olursa bile 1 günü geçmemeli.
  assert.ok(
    uyari.idleExceeded.every((r) => r.days <= r.limit + 1),
    `bekleme aşımı 1 günü geçmemeli: ${JSON.stringify(uyari.idleExceeded)}`
  );

  // İzinli kişi izin günlerinde ne nöbete ne mesaiye yazılmalı
  const clash = assignments.filter(
    (a) =>
      a.employee &&
      String(a.employee._id) === String(izinli._id) &&
      a.date >= `${YEAR}-10-05` &&
      a.date <= `${YEAR}-10-11T23:59`
  );
  assert.equal(clash.length, 0);

  // Sorumlu ve sadece-gündüz personeli nöbet havuzu yeterliyken nöbete yazılmaz.
  const nobetciAdlari = new Set(
    assignments.filter((a) => a.shiftType === 'nobet-24' && a.employee).map((a) => a.employee.name)
  );
  for (const ad of ['Elif Yılmaz', 'Nalan Acar', 'Pınar Ateş']) {
    assert.ok(!nobetciAdlari.has(ad), `${ad} nöbete yazılmamalı`);
  }
});

test('puantaj ve izin uyarıları listeyle birlikte dönüyor', async () => {
  const { body } = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}`);

  assert.equal(body.puantaj.toplam.nobetToplam, 31);
  const gunducu = body.puantaj.satirlar.find((r) => r.name === 'Nalan Acar');
  assert.equal(gunducu.gunduzGun, 21);
  assert.equal(gunducu.toplamSaat, 21 * 8);

  // Kadro 2 iken her gün gelen 2 kişi kadroyu tam dolduruyor: aşım olmamalı.
  assert.deepEqual(body.warnings.overCapacity, []);

  const ayla = body.puantaj.satirlar.find((r) => r.name === 'Ayla Kurt');
  assert.equal(ayla.toplamSaat, ayla.gunduzGun * 8 + ayla.nobetToplam * 24);

  // Kurala uygun (Pazartesi-Pazartesi) izin uyarı üretmemeli.
  assert.equal(
    body.leaveWarnings.filter((w) => w.warnings.includes('izin-pazartesi-baslamiyor')).length,
    0
  );
});

test('Pazartesi dışında başlayan izin uyarı üretir ama kabul edilir', async () => {
  const employees = (await api(`/api/admin/employees?unit=${unitId}`)).body;
  const kisi = employees.find((e) => e.name === 'Berk Doğan');
  const olustur = await api('/api/admin/leaves', {
    method: 'POST',
    body: { employee: kisi._id, startDate: `${YEAR}-10-20`, endDate: `${YEAR}-10-22`, type: 'rapor' },
  });
  assert.equal(olustur.status, 201, 'kural ihlali izni engellemez');

  const { body } = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}`);
  const uyari = body.leaveWarnings.find((w) => w.leave === olustur.body._id);
  assert.deepEqual(uyari.warnings.sort(), ['donus-pazartesi-degil', 'izin-pazartesi-baslamiyor']);

  await api(`/api/admin/leaves/${olustur.body._id}`, { method: 'DELETE' });
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
  // Nöbet havuzu 6 kişi × 5 = 30 < 31; kalan slotu sorumlu hemşire yedek olarak alır.
  const yedek = body.assignments.filter((a) => (a.flags ?? []).includes('sorumlu-yedek'));
  assert.ok(
    yedek.length > 0 || body.warnings.byFlag['doldurulamadi'] > 0,
    'limit daraldığında ya yedek devreye girmeli ya da slot boş kalmalı'
  );

  await api(`/api/admin/rules/${unitId}`, { method: 'PUT', body: { maxDutiesPerMonth: 7 } });
  await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/generate`, { method: 'POST' });
});

test('manuel atama kural kontrolünü tetikliyor ve flag üretiyor', async () => {
  const before = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}`);
  const duties = before.body.assignments.filter((a) => a.shiftType === 'nobet-24' && a.employee);

  // 2. günün nöbetçisini 1. günün nöbetçisiyle değiştir → dinlenme kuralı ihlali
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
  assert.deepEqual(res.body.updatedAssignment.flags, ['yetersiz-dinlenme']);
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
  assert.equal(view.body.unit.name, 'Nöroloji Yoğun Bakım');
  assert.equal(view.body.days.length, 31);
  assert.ok(view.body.days.every((d) => d.nobet.length === 1));
  assert.ok(view.body.days[0].nobet[0].name);

  const bad = await api(`/api/public/gecersiz-token/${YEAR}/${MONTH}`, { auth: false });
  assert.equal(bad.status, 404);
});


test('elle doldurmak için boş liste oluşturulabiliyor', async () => {
  // Otomasyona geçilen aydan önceki ay elle girilir ki ay geçişi kuralları işlesin.
  const res = await api(`/api/admin/schedules/${unitId}/${YEAR}/9/blank`, { method: 'POST' });
  assert.equal(res.status, 201);

  const { assignments } = res.body;
  assert.equal(assignments.filter((a) => a.shiftType === 'nobet-24').length, 30, 'Eylül 30 gün');
  assert.ok(assignments.every((a) => a.employee === null), 'hepsi boş başlamalı');
  assert.ok(assignments.every((a) => a.flags.includes('doldurulamadi')));

  // Üzerine ikinci kez oluşturmaya çalışmak veriyi silmemeli.
  const tekrar = await api(`/api/admin/schedules/${unitId}/${YEAR}/9/blank`, { method: 'POST' });
  assert.equal(tekrar.status, 201, 'tamamı boşken yeniden oluşturulabilir');
});

test('elle girilen önceki ay, sonraki ayın ay geçişi kuralına besleniyor', async () => {
  const eylul = (await api(`/api/admin/schedules/${unitId}/${YEAR}/9`)).body;
  const employees = (await api(`/api/admin/employees?unit=${unitId}`)).body;
  const kisi = employees.find((e) => e.name === 'Ceren Işık');

  // 30 Eylül nöbetini elle ver.
  const sonGun = eylul.assignments.find(
    (a) => a.shiftType === 'nobet-24' && a.date.startsWith(`${YEAR}-09-30`)
  );
  const atama = await api(`/api/admin/assignments/${sonGun._id}`, {
    method: 'PUT',
    body: { employee: kisi._id },
  });
  assert.equal(atama.status, 200);

  // Ekim üretildiğinde 1 Ekim o kişiye kapalı olmalı (dinlenme günü).
  const ekim = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/generate`, { method: 'POST' });
  const ilkGun = ekim.body.assignments.filter(
    (a) => a.date.startsWith(`${YEAR}-10-01`) && a.employee && a.employee._id === kisi._id
  );
  assert.deepEqual(ilkGun, [], '30 Eylül nöbetinin ertesi günü boş kalmalı');
});

test('dolu liste kazara boşaltılmıyor, force ile boşaltılıyor', async () => {
  // Ekim dolu; force'suz istek reddedilmeli.
  const korumali = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/blank`, { method: 'POST' });
  assert.equal(korumali.status, 400);
  assert.match(korumali.body.error, /Listeyi Boşalt/);

  const bosalt = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/blank?force=1`, { method: 'POST' });
  assert.equal(bosalt.status, 201);
  assert.ok(bosalt.body.assignments.every((a) => a.employee === null), 'hepsi boşalmalı');
  assert.ok(bosalt.body.assignments.length > 0, 'slotlar kadro kadar yeniden kurulmalı');
});

test('o güne özel, kadro dışı ek atama yapılabiliyor', async () => {
  await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/generate`, { method: 'POST' });
  const once = (await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}`)).body;

  const gun = `${YEAR}-10-13`;
  const nobetciSayisi = (liste) =>
    liste.assignments.filter((a) => a.shiftType === 'nobet-24' && a.date.startsWith(gun)).length;
  assert.equal(nobetciSayisi(once), 1, 'kadro günde 1 nöbetçi');

  // O gün nöbette olmayan birini ikinci nöbetçi olarak ekle.
  const mesgul = new Set(
    once.assignments.filter((a) => a.date.startsWith(gun) && a.employee).map((a) => a.employee._id)
  );
  const kisi = (await api(`/api/admin/employees?unit=${unitId}`)).body.find(
    (e) => e.staffType === 'standart' && e.canTakeDuty !== false && !mesgul.has(e._id)
  );

  const ekle = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/assignments`, {
    method: 'POST',
    body: { date: gun, shiftType: 'nobet-24', employee: kisi._id },
  });
  assert.equal(ekle.status, 201);
  assert.equal(nobetciSayisi(ekle.body), 2, 'o gün kadro dışı ikinci nöbetçi');

  const eklenen = ekle.body.assignments.find(
    (a) => a.date.startsWith(gun) && a.employee?._id === kisi._id && a.shiftType === 'nobet-24'
  );
  assert.equal(eklenen.manual, true, 'elle eklendi olarak işaretlenmeli');

  // Geri alınabilmeli.
  const sil = await api(`/api/admin/assignments/${eklenen._id}`, { method: 'DELETE' });
  assert.equal(sil.status, 200);
  assert.equal(nobetciSayisi(sil.body), 1, 'kaldırınca kadroya dönmeli');
});

test('elle eklenen gündüz personeli kadro aşımı uyarısı üretmiyor', async () => {
  const gun = `${YEAR}-10-14`;
  const bosta = (await api(`/api/admin/employees?unit=${unitId}`)).body.find(
    (e) => e.name === 'Pınar Ateş'
  );

  const ekle = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/assignments`, {
    method: 'POST',
    body: { date: gun, shiftType: 'mesai-8', employee: bosta._id },
  });
  assert.equal(ekle.status, 201);

  const asim = ekle.body.warnings.overCapacity.filter((o) => o.date === gun);
  assert.deepEqual(asim, [], 'bilerek yapılan ekleme kadro aşımı sayılmamalı');

  const eklenen = ekle.body.assignments.find((a) => a.manual && a.date.startsWith(gun));
  await api(`/api/admin/assignments/${eklenen._id}`, { method: 'DELETE' });
});

test('ek atamada tarih ve vardiya tipi doğrulanıyor', async () => {
  const kisi = (await api(`/api/admin/employees?unit=${unitId}`)).body[0];
  const gecersizTip = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/assignments`, {
    method: 'POST',
    body: { date: `${YEAR}-10-05`, shiftType: 'mesai-12', employee: kisi._id },
  });
  assert.equal(gecersizTip.status, 400);

  const baskaAy = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/assignments`, {
    method: 'POST',
    body: { date: `${YEAR}-11-05`, shiftType: 'nobet-24', employee: kisi._id },
  });
  assert.equal(baskaAy.status, 400);
  assert.match(baskaAy.body.error, /döneme ait/);
});

test('kadrosu olmayan güne de (hafta sonu gündüz) ek atama yapılabiliyor', async () => {
  // weekendDayStaff 0 olduğu için 17 Ekim Cumartesi hiç gündüz slotu yok.
  const cumartesi = `${YEAR}-10-17`;
  const once = (await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}`)).body;
  assert.equal(
    once.assignments.filter((a) => a.shiftType === 'mesai-8' && a.date.startsWith(cumartesi)).length,
    0,
    'hafta sonu gündüz kadrosu 0'
  );

  const kisi = (await api(`/api/admin/employees?unit=${unitId}`)).body.find(
    (e) => e.name === 'Pınar Ateş'
  );
  const ekle = await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/assignments`, {
    method: 'POST',
    body: { date: cumartesi, shiftType: 'mesai-8', employee: kisi._id },
  });
  assert.equal(ekle.status, 201);

  const eklenen = ekle.body.assignments.filter(
    (a) => a.shiftType === 'mesai-8' && a.date.startsWith(cumartesi)
  );
  assert.equal(eklenen.length, 1);
  assert.equal(eklenen[0].manual, true);

  await api(`/api/admin/assignments/${eklenen[0]._id}`, { method: 'DELETE' });
});

test('atama sırası kararlı: aynı slot her yüklemede aynı satırda kalır', async () => {
  await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/generate`, { method: 'POST' });

  const sira = (liste) => liste.assignments.map((a) => String(a._id)).join(',');
  const ilk = (await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}`)).body;

  // Art arda okumalar aynı sırayı vermeli.
  for (let i = 0; i < 3; i += 1) {
    const tekrar = (await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}`)).body;
    assert.equal(sira(tekrar), sira(ilk), 'okumalar arasında sıra değişmemeli');
  }

  // Bir atamayı değiştirmek de sırayı bozmamalı; seçilen kişi kendi slotunda kalmalı.
  const gun = `${YEAR}-10-13`;
  const hedef = ilk.assignments.find((a) => a.shiftType === 'mesai-8' && a.date.startsWith(gun));
  const bosta = (await api(`/api/admin/employees?unit=${unitId}`)).body.find(
    (e) => !ilk.assignments.some((a) => a.date.startsWith(gun) && a.employee?._id === e._id)
  );

  const sonuc = await api(`/api/admin/assignments/${hedef._id}`, {
    method: 'PUT',
    body: { employee: bosta._id },
  });
  assert.equal(sira(sonuc.body), sira(ilk), 'güncelleme sonrası sıra korunmalı');

  const guncel = sonuc.body.assignments.find((a) => String(a._id) === String(hedef._id));
  assert.equal(guncel.employee._id, bosta._id, 'seçilen kişi kendi slotunda kalmalı');
});

test('kadro dışı ekleme öncesi aday ve sebep listesi alınabiliyor', async () => {
  await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/generate`, { method: 'POST' });

  const gun = `${YEAR}-10-13`;
  const res = await api(
    `/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/candidates?date=${gun}&shiftType=nobet-24`
  );
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.eligible));

  // O gün zaten nöbette olan kişi çifte atama sebebiyle elenmiş olmalı.
  const liste = (await api(`/api/admin/schedules/${unitId}/${YEAR}/${MONTH}`)).body;
  const nobetci = liste.assignments.find(
    (a) => a.shiftType === 'nobet-24' && a.date.startsWith(gun) && a.employee
  ).employee;
  assert.equal(res.body.reasons[nobetci._id], 'cifte-atama');
  assert.ok(!res.body.eligible.some((e) => e._id === nobetci._id));

  // Sadece-gündüz personeli nöbete giremez sebebiyle elenmeli. Hafta içi günlerde
  // zaten mesaide olduğu için önce 'cifte-atama' yakalanır; hafta sonu gündüz
  // kadrosu 0 olduğundan Cumartesi boştadır ve asıl sebep görünür.
  const cumartesi = `${YEAR}-10-17`;
  const haftaSonu = await api(
    `/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/candidates?date=${cumartesi}&shiftType=nobet-24`
  );
  const gunducu = (await api(`/api/admin/employees?unit=${unitId}`)).body.find(
    (e) => e.staffType === 'sadece-gunduz'
  );
  assert.equal(haftaSonu.body.reasons[gunducu._id], 'nobete-giremez');

  const gecersiz = await api(
    `/api/admin/schedules/${unitId}/${YEAR}/${MONTH}/candidates?date=${gun}&shiftType=yok`
  );
  assert.equal(gecersiz.status, 400);
});

test('otomatik üretim öncesi liste arşivlenir ve geri alınabilir', async () => {
  // Eylülü boşalt, elle bir atama gir — "manuel girilen liste" senaryosu.
  await api(`/api/admin/schedules/${unitId}/${YEAR}/9/blank?force=1`, { method: 'POST' });
  const eylul = (await api(`/api/admin/schedules/${unitId}/${YEAR}/9`)).body;
  const kisi = (await api(`/api/admin/employees?unit=${unitId}`)).body.find(
    (e) => e.name === 'Berk Doğan'
  );
  const slot = eylul.assignments.find((a) => a.shiftType === 'nobet-24');
  await api(`/api/admin/assignments/${slot._id}`, { method: 'PUT', body: { employee: kisi._id } });

  const elle = (await api(`/api/admin/schedules/${unitId}/${YEAR}/9`)).body;
  const elleDolu = elle.assignments.filter((a) => a.employee).length;
  assert.equal(elleDolu, 1, 'elle girilen tek atama');

  // Kazara otomatik üretim: elle girilen liste kaybolur.
  await api(`/api/admin/schedules/${unitId}/${YEAR}/9/generate`, { method: 'POST' });
  const otomatik = (await api(`/api/admin/schedules/${unitId}/${YEAR}/9`)).body;
  assert.ok(otomatik.assignments.filter((a) => a.employee).length > elleDolu);

  // Arşivde üretim öncesi kopya durmalı.
  const kopyalar = (await api(`/api/admin/schedules/${unitId}/${YEAR}/9/archives`)).body;
  assert.ok(kopyalar.length > 0, 'kopya alınmış olmalı');
  assert.equal(kopyalar[0].reason, 'otomatik-uretim');
  assert.equal(kopyalar[0].filledCount, elleDolu);

  // Geri al: elle girilen liste geri gelmeli.
  const geri = await api(`/api/admin/schedules/${unitId}/${YEAR}/9/restore/${kopyalar[0]._id}`, {
    method: 'POST',
  });
  assert.equal(geri.status, 200);
  const geriDolu = geri.body.assignments.filter((a) => a.employee);
  assert.equal(geriDolu.length, elleDolu);
  assert.equal(geriDolu[0].employee._id, kisi._id);

  // Geri almanın kendisi de geri alınabilmeli.
  const sonrasi = (await api(`/api/admin/schedules/${unitId}/${YEAR}/9/archives`)).body;
  assert.equal(sonrasi[0].reason, 'geri-alma', 'geri alma öncesi hâl de saklanmalı');
});

test('tamamen boş liste arşivlenmez', async () => {
  await api(`/api/admin/schedules/${unitId}/${YEAR}/9/blank?force=1`, { method: 'POST' });
  const once = (await api(`/api/admin/schedules/${unitId}/${YEAR}/9/archives`)).body.length;
  await api(`/api/admin/schedules/${unitId}/${YEAR}/9/blank?force=1`, { method: 'POST' });
  const sonra = (await api(`/api/admin/schedules/${unitId}/${YEAR}/9/archives`)).body.length;
  assert.equal(sonra, once, 'geri alınacak bir şey yokken kopya alınmamalı');
});
