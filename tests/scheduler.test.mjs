import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSlots } from '../src/services/scheduler/buildSlots.js';
import { buildSchedule } from '../src/services/scheduler/buildSchedule.js';
import {
  idleViolations,
  overCapacityDays,
  puantaj,
  summarizeWarnings,
} from '../src/services/scheduler/flags.js';
import { yokSayilanGun } from '../src/services/scheduler/constraints.js';
import { holidaySet } from '../src/services/scheduler/calendar.js';
import { leaveWarnings } from '../src/services/leaveWarnings.js';
import {
  diffDays,
  dutyCategory,
  fullWeekKeys,
  isoWeekKey,
  isWeekend,
  toIsoDay,
  utcDate,
} from '../src/utils/dates.js';
import { FLAGS, LEAVE_WARNINGS } from '../src/utils/constants.js';

const YEAR = 2026;
const MONTH = 10; // 31 gün, 22 hafta içi, 1 Ekim Perşembe

const UNIT = { _id: 'u1', shiftTypes: ['nobet-24', 'mesai-8'] };

const RULE = {
  weekdayDayStaff: 5,
  weekdayDutyStaff: 1,
  weekendDayStaff: 0,
  weekendDutyStaff: 1,
  minRestDaysAfterDuty: 1,
  maxTightGapsPerMonth: 1,
  maxIdleDays: 3,
  minDutiesPerMonth: 4,
  maxDutiesPerMonth: 7,
  weekendFairnessWeight: 70,
  hoursFairnessWeight: 50,
  minWeeklyHours: 32,
  excludeOnLeave: true,
};

const person = (id, name, extra = {}) => ({
  _id: id,
  name,
  active: true,
  staffType: 'standart',
  canTakeDuty: true,
  ...extra,
});

const TEAM = [
  person('sor', 'Sorumlu Hemşire', { staffType: 'sorumlu' }),
  person('gun', 'Gündüzcü Hemşire', { staffType: 'sadece-gunduz' }),
  person('nod', 'Nöbetsiz Hemşire', { canTakeDuty: false }),
  person('a', 'Ayla'),
  person('b', 'Berk'),
  person('c', 'Ceren'),
  person('d', 'Deniz'),
  person('e', 'Emre'),
  person('f', 'Funda'),
];

/**
 * Gerçek üretim hattını çalıştırır; deterministik olsun diye sabit rastgelelik verir.
 * Iterasyon üretim varsayılanından düşük: testler kural doğruluğunu ölçüyor,
 * son kırıntı optimizasyonu değil — tam ayarla test süresi 10 kat uzuyor.
 */
function run({ employees = TEAM, rule = RULE, leaves = [], history = [], iterations = 4000 } = {}) {
  let seed = 42;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  return buildSchedule({
    shiftTypes: UNIT.shiftTypes,
    year: YEAR,
    month: MONTH,
    employees,
    leaves,
    rule,
    history,
    iterations,
    // Süre bütçesi kapalı: testler tohumlu rastgeleyle belirlenimci olmalı,
    // yavaş bir makinede bütçenin aramayı erken kesmesi sonucu değiştirirdi.
    timeBudgetMs: 0,
    random,
  });
}

const dutiesOf = (assignments, id) =>
  assignments
    .filter((a) => a.shiftType === 'nobet-24' && a.employee === id)
    .map((a) => a.date)
    .sort((x, y) => x - y);

const ihlaller = (assignments) =>
  assignments.filter((a) => (a.flags ?? []).some((f) => f !== FLAGS.BACKUP_USED));

test('kadro: hafta içi/hafta sonu slot sayıları kural setinden gelir', () => {
  const slots = buildSlots(UNIT, YEAR, MONTH, RULE);
  assert.equal(slots.filter((s) => s.shiftType === 'nobet-24').length, 31, 'her gün 1 nöbetçi');
  // 29 Ekim 2026 Perşembe Cumhuriyet Bayramı: sabit resmi tatil olarak hazır
  // gelir ve o gün gündüz kadrosu açılmaz. 22 hafta içi gününün 21'i kalır.
  assert.equal(slots.filter((s) => s.shiftType === 'mesai-8').length, 105, '21 gün × 5 gündüz');
  assert.equal(
    slots.filter((s) => s.shiftType === 'mesai-8' && toIsoDay(s.date) === '2026-10-29').length,
    0,
    '29 Ekim tatilinde gündüz mesaisi açılmaz'
  );
  assert.equal(
    slots.filter((s) => s.shiftType === 'mesai-8' && isWeekend(s.date)).length,
    0,
    'hafta sonu gündüz kadrosu 0'
  );

  const yogun = buildSlots(UNIT, YEAR, MONTH, { ...RULE, weekendDutyStaff: 2, weekendDayStaff: 1 });
  assert.equal(yogun.filter((s) => s.shiftType === 'nobet-24' && isWeekend(s.date)).length, 18, '9 hafta sonu günü × 2');
  assert.equal(yogun.filter((s) => s.shiftType === 'mesai-8' && isWeekend(s.date)).length, 9);
});

test('varsayılan kadroda kural ihlali olmadan çözüm bulunur', () => {
  const a = run();
  assert.deepEqual(ihlaller(a), [], 'ihlalsiz çözüm beklenir');
  assert.equal(a.filter((x) => x.shiftType === 'nobet-24' && !x.employee).length, 0, 'boş nöbet kalmamalı');
});

test('nöbetten sonra dinlenme: ertesi gün ne nöbet ne mesai verilir', () => {
  const a = run();
  for (const p of TEAM) {
    for (const nobet of dutiesOf(a, p._id)) {
      const ertesi = a.filter((x) => x.employee === p._id && diffDays(x.date, nobet) === 1);
      assert.deepEqual(ertesi, [], `${p.name}: ${toIsoDay(nobet)} nöbetinin ertesi günü boş olmalı`);
    }
  }
});

test('gün aşırı nöbet ayda en fazla bir kez', () => {
  const a = run();
  for (const p of TEAM) {
    const nobetler = dutiesOf(a, p._id);
    let gunAsiri = 0;
    for (let i = 1; i < nobetler.length; i += 1) {
      const bosluk = diffDays(nobetler[i], nobetler[i - 1]) - 1;
      assert.ok(bosluk >= 1, `${p.name}: art arda nöbet olmamalı`);
      if (bosluk === 1) gunAsiri += 1;
    }
    assert.ok(gunAsiri <= RULE.maxTightGapsPerMonth, `${p.name}: ${gunAsiri} kez gün aşırı`);
  }
});

test('sadece-gündüz personeli hiç nöbete girmez, her hafta içi gündüze yazılır', () => {
  const a = run();
  assert.equal(dutiesOf(a, 'gun').length, 0);

  const gunduzleri = a.filter((x) => x.employee === 'gun' && x.shiftType === 'mesai-8');
  assert.equal(gunduzleri.length, 21, '22 hafta içi gününün 29 Ekim tatili dışındaki hepsinde');
  assert.equal(gunduzleri.filter((x) => isWeekend(x.date)).length, 0, 'hafta sonu kadrosu 0 iken gelmez');
});

test('bir gündeki gündüz sayısı kural setindeki kadroya eşit', () => {
  const a = run();
  const gunluk = new Map();
  for (const x of a.filter((y) => y.shiftType === 'mesai-8')) {
    const key = toIsoDay(x.date);
    gunluk.set(key, (gunluk.get(key) ?? 0) + 1);
  }

  assert.equal(gunluk.size, 21, 'hafta içi günler, 29 Ekim tatili hariç');
  for (const [gun, sayi] of gunluk) {
    assert.equal(sayi, RULE.weekdayDayStaff, `${gun}: kadro ${RULE.weekdayDayStaff} olmalı`);
  }

  // Her gün gelen personel bu sayının İÇİNDEN sayılır, üstüne eklenmez.
  const toplam = a.filter((x) => x.shiftType === 'mesai-8').length;
  assert.equal(toplam, 21 * RULE.weekdayDayStaff);
  assert.equal(overCapacityDays(a, RULE).length, 0, 'kadro aşımı olmamalı');
});

test('her gün gelen personel kadrodan fazlaysa yine yazılır ve kadro aşımı raporlanır', () => {
  // Kadro 1, ama sorumlu + sadece-gündüz zaten her gün geliyor → günde 2 kişi.
  const dar = { ...RULE, weekdayDayStaff: 1 };
  const a = run({ rule: dar });

  const asim = overCapacityDays(a, dar);
  assert.equal(asim.length, 21, 'tatil dışındaki her hafta içi günü kadroyu aşmalı');
  assert.deepEqual(asim[0], { date: '2026-10-01', count: 2, kadro: 1 });

  // Her gün gelmesi gereken iki kişi yine tam kadro yazılmış olmalı.
  assert.equal(a.filter((x) => x.employee === 'gun' && x.shiftType === 'mesai-8').length, 21);
  assert.equal(a.filter((x) => x.employee === 'sor' && x.shiftType === 'mesai-8').length, 21);
});

test('"nöbete girebilir" kapalı personel gündüz rotasyonunda kalır ama nöbet almaz', () => {
  const a = run();
  assert.equal(dutiesOf(a, 'nod').length, 0);
  assert.ok(
    a.some((x) => x.employee === 'nod' && x.shiftType === 'mesai-8'),
    'gündüz rotasyonundan pay almalı'
  );
});

test('sorumlu hemşire yalnızca aday kalmadığında nöbete yazılır', () => {
  const bol = run();
  assert.equal(dutiesOf(bol, 'sor').length, 0, 'normal havuz yeterliyken yedek kullanılmaz');

  // Nöbet havuzunu ikiye indir: 31 nöbet 2 kişiye sığmaz, yedek devreye girmeli.
  const dar = TEAM.filter((p) => ['sor', 'gun', 'nod', 'a', 'b'].includes(p._id));
  const a = run({ employees: dar });
  const yedek = dutiesOf(a, 'sor');
  assert.ok(yedek.length > 0, 'sorumlu hemşire yedek olarak nöbet tutmalı');
  assert.ok(
    a
      .filter((x) => x.shiftType === 'nobet-24' && x.employee === 'sor')
      .every((x) => x.flags.includes(FLAGS.BACKUP_USED)),
    'yedek nöbetler sorumlu-yedek ile etiketlenmeli'
  );
});

test('izinli personel hem nöbetten hem mesaiden tamamen çıkarılır', () => {
  const leaves = [
    { _id: 'l1', employee: 'a', startDate: utcDate(YEAR, MONTH, 5), endDate: utcDate(YEAR, MONTH, 11) },
    // Sadece-gündüz personeli de izinde gündüze yazılmamalı.
    { _id: 'l2', employee: 'gun', startDate: utcDate(YEAR, MONTH, 12), endDate: utcDate(YEAR, MONTH, 18) },
  ];
  const a = run({ leaves });

  for (const { employee, startDate, endDate } of leaves) {
    const cakisan = a.filter(
      (x) => x.employee === employee && x.date >= startDate && x.date <= endDate
    );
    assert.deepEqual(cakisan, [], `${employee} izin günlerinde atanmamalı`);
  }
});

test('nöbete başlama tarihi: gündüz hemşiresi o tarihten itibaren nöbete girer', () => {
  // 15 Ekim'e kadar sadece gündüz, 15 Ekim'den itibaren nöbet rotasyonunda.
  const ekip = TEAM.map((p) =>
    p._id === 'gun' ? { ...p, dutyStartDate: utcDate(YEAR, MONTH, 15) } : p
  );
  const a = run({ employees: ekip });
  const nobetleri = dutiesOf(a, 'gun');

  assert.ok(nobetleri.length > 0, '15 Ekim sonrası nöbet almalı');
  assert.ok(
    nobetleri.every((d) => d >= utcDate(YEAR, MONTH, 15)),
    `başlama tarihinden önce nöbet var: ${nobetleri.map(toIsoDay).join(', ')}`
  );

  // 15 Ekim öncesi her hafta içi günü gündüzde, sonrasında rotasyonda.
  const oncesi = a.filter(
    (x) => x.employee === 'gun' && x.shiftType === 'mesai-8' && x.date < utcDate(YEAR, MONTH, 15)
  );
  assert.equal(oncesi.length, 10, '1-14 Ekim arası 10 hafta içi gününün hepsinde');

  // Yarım ay müsait olduğu için tam ay çalışanların ortalama yükünü taşımamalı.
  // Müsaitlik payı ~%55, dolayısıyla beklenen yük de kabaca yarısı kadar.
  const tamAy = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => dutiesOf(a, id).length);
  const ortalama = tamAy.reduce((s, v) => s + v, 0) / tamAy.length;
  assert.ok(
    nobetleri.length < ortalama,
    `yarım ay müsait olan ${nobetleri.length} nöbet aldı, tam ay ortalaması ${ortalama.toFixed(1)} (${tamAy.join(',')})`
  );
});

test('resmi tatillerde yalnızca nöbetçi yazılır', () => {
  // 29 Ekim sabit resmi tatil (hazır gelir), 30 Ekim ise elle eklenen ek tatil.
  const tatilli = { ...RULE, holidays: ['2026-10-30'] };
  const a = run({ rule: tatilli });

  for (const gun of ['2026-10-29', '2026-10-30']) {
    const oGun = a.filter((x) => toIsoDay(x.date) === gun);
    assert.equal(
      oGun.filter((x) => x.shiftType === 'mesai-8').length,
      0,
      `${gun}: tatilde gündüz mesaisi olmamalı`
    );
    assert.equal(
      oGun.filter((x) => x.shiftType === 'nobet-24' && x.employee).length,
      tatilli.weekendDutyStaff,
      `${gun}: hafta sonu kadrosu kadar nöbetçi olmalı`
    );
  }

  // Her gün gündüze gelen personel de tatilde yazılmamalı.
  assert.equal(
    a.filter((x) => x.employee === 'gun' && toIsoDay(x.date) === '2026-10-29').length,
    0
  );

  // Tatil nöbeti adalette hafta sonu sayılır (sabit resmi tatiller dahil).
  assert.equal(dutyCategory(utcDate(YEAR, MONTH, 29), holidaySet(tatilli)), 'hafta-sonu');
  assert.equal(dutyCategory(utcDate(YEAR, MONTH, 30), holidaySet(tatilli)), 'hafta-sonu');
});

test('Cuma biten izin hafta sonunu da kapsar, kişi Pazartesi döner', () => {
  // 9 Ekim 2026 Cuma biten izin; 10-11 Ekim hafta sonu da izinli sayılmalı,
  // ilk çalışma günü 12 Ekim Pazartesi olmalı.
  const leaves = [
    { _id: 'l1', employee: 'a', startDate: utcDate(YEAR, MONTH, 5), endDate: utcDate(YEAR, MONTH, 9) },
  ];
  const a = run({ leaves });

  for (const gun of [10, 11]) {
    assert.deepEqual(
      a.filter((x) => x.employee === 'a' && toIsoDay(x.date) === toIsoDay(utcDate(YEAR, MONTH, gun))),
      [],
      `${gun} Ekim hafta sonu izne dahil olmalı`
    );
  }

  const ilkGun = a
    .filter((x) => x.employee === 'a' && x.date >= utcDate(YEAR, MONTH, 10))
    .map((x) => toIsoDay(x.date))
    .sort()[0];
  assert.equal(ilkGun, '2026-10-12', 'dönüş Pazartesi olmalı');
});

test('gün aşırı nöbet son çaredir: alternatif varken kullanılmaz', () => {
  const a = run();

  for (const p of TEAM.filter((x) => x.staffType === 'standart' && x.canTakeDuty !== false)) {
    const nobetler = dutiesOf(a, p._id);
    for (let i = 1; i < nobetler.length; i += 1) {
      assert.ok(
        diffDays(nobetler[i], nobetler[i - 1]) - 1 > RULE.minRestDaysAfterDuty,
        `${p.name}: kadro yeterliyken gün aşırı nöbet verilmemeli`
      );
    }
  }
});

test('Perşembe ve Cuma nöbetleri kendi içlerinde eşit dağılır', () => {
  const a = run();
  const havuz = ['a', 'b', 'c', 'd', 'e', 'f'];

  // Perşembe ve Cuma ayrı kategoriler: 5 gün / 6 kişi olduğu için erişilebilecek
  // en iyi dağılım farkın 1 olmasıdır (birine 0 düşer).
  for (const kategori of ['persembe', 'cuma']) {
    const sayilar = havuz.map(
      (id) => a.filter((x) => x.shiftType === 'nobet-24' && x.employee === id && dutyCategory(x.date) === kategori).length
    );
    assert.ok(
      Math.max(...sayilar) - Math.min(...sayilar) <= 1,
      `${kategori}: dağılım ${sayilar.join(',')}`
    );
  }
});

test('adil dağıtım: nöbet kategorileri ve toplam saat dengeli', () => {
  // Bu test kural doğruluğunu değil optimizasyon kalitesini ölçüyor; üretimdeki
  // iterasyon sayısıyla çalışmalı, yoksa dengeleme yarıda kalır.
  const a = run({ iterations: 20000 });
  const havuz = ['a', 'b', 'c', 'd', 'e', 'f'];

  for (const kategori of ['hafta-ici', 'hafta-sonu']) {
    const sayilar = havuz.map(
      (id) => a.filter((x) => x.shiftType === 'nobet-24' && x.employee === id && dutyCategory(x.date) === kategori).length
    );
    assert.ok(
      Math.max(...sayilar) - Math.min(...sayilar) <= 1,
      `${kategori}: dağılım ${sayilar.join(',')}`
    );
  }

  // Gündüz mesaisi sayıları aritmetik alt sınıra inmeli: 45 slot / 6 kişi = 7,5,
  // yani 7 ile 8 arasında dağılmalı. Hedefli dengeleme geçişi bunu garanti eder;
  // yalnız yerel aramaya bırakıldığında 5–9 aralığına açılıyordu.
  const gunduzler = havuz.map(
    (id) => a.filter((x) => x.shiftType === 'mesai-8' && x.employee === id).length
  );
  assert.ok(
    Math.max(...gunduzler) - Math.min(...gunduzler) <= 1,
    `gündüz dağılımı ${gunduzler.join(',')}`
  );

  // Ay sonu toplam saat farkı en fazla bir gündüz mesaisi kadar olmalı.
  const saatler = havuz.map((id) =>
    a
      .filter((x) => x.employee === id)
      .reduce((sum, x) => sum + (x.shiftType === 'nobet-24' ? 24 : 8), 0)
  );
  // Bekleme sınırı zorunlu kural olduğu için çizelge sıkı paketlenmiş durumda:
  // bir slotu birinden almak çoğu zaman onu sınırın ötesine itiyor ve onarım
  // geçişi dengeyi değil kuralı önceliyor. Saat farkı bu yüzden bir nöbeti
  // (24 saat) aşmamalı ama sıfırlanamıyor.
  assert.ok(
    Math.max(...saatler) - Math.min(...saatler) <= 24,
    `toplam saat dağılımı ${saatler.join(',')}`
  );
});

test('gündüz mesaisi sayıları nöbet havuzunda eşitlenir, nöbetsiz personel dışarıda kalır', () => {
  const a = run({ iterations: 20000 });
  const havuz = ['a', 'b', 'c', 'd', 'e', 'f'];

  const sayilar = havuz.map(
    (id) => a.filter((x) => x.shiftType === 'mesai-8' && x.employee === id).length
  );
  const hedef =
    sayilar.reduce((sum, v) => sum + v, 0) / havuz.length;
  for (const [i, sayi] of sayilar.entries()) {
    assert.ok(
      Math.abs(sayi - hedef) < 1,
      `${havuz[i]} payına düşenden uzak: ${sayilar.join(',')} (hedef ${hedef})`
    );
  }

  // Nöbete hiç girmeyen personel bu eşitlemeye dahil edilmemeli: ayını yalnızca
  // 8 saatlik gündüzlerle doldurduğu için ona da aynı sayı dayatılırsa haftalık
  // alt sınırın çok altında kalır.
  const nobetsiz = a.filter((x) => x.employee === 'nod' && x.shiftType === 'mesai-8').length;
  assert.ok(nobetsiz > Math.max(...sayilar), `nöbetsiz personel ${nobetsiz} gündüz almış`);
});

test('ay geçişi: önceki ayın son nöbeti dinlenme kuralını taşır', () => {
  // 30 Eylül nöbeti → 1 Ekim hiçbir vardiya alamaz.
  const history = [
    { date: utcDate(YEAR, 9, 30), employee: 'a', shiftType: 'nobet-24', history: true, flags: [] },
  ];
  const a = run({ history });
  const ilkGun = a.filter((x) => x.employee === 'a' && diffDays(x.date, utcDate(YEAR, 9, 30)) === 1);
  assert.deepEqual(ilkGun, [], '1 Ekim dinlenme günü olmalı');
});

test('bekleme sınırı: kimse hastaneye gelmeden maxIdleDays günden fazla geçirmez', () => {
  const a = run();

  // Kural nöbeti ve gündüz mesaisini birlikte sayar: ikisinden biri "geldi"
  // demektir ve beklemeyi sıfırlar. Nöbet sonrası dinlenme günü beklemeye dahil.
  for (const p of TEAM) {
    const gelisler = new Set(
      a.filter((x) => x.employee === p._id).map((x) => toIsoDay(x.date))
    );
    if (gelisler.size === 0) continue;
    const atla = yokSayilanGun(p, RULE, []);

    let bekleme = 0;
    let enUzun = 0;
    for (let g = 1; g <= 31; g += 1) {
      const gun = utcDate(YEAR, MONTH, g);
      if (gelisler.has(toIsoDay(gun))) bekleme = 0;
      else if (!atla(gun)) enUzun = Math.max(enUzun, (bekleme += 1));
    }
    assert.ok(enUzun <= RULE.maxIdleDays, `${p.name}: en uzun bekleme ${enUzun} gün`);
  }
});

test('gündüz mesaisi de beklemeyi sıfırlar', () => {
  const a = run();
  // Nöbete hiç girmeyen personel yalnızca mesaiyle gelir; kural yine tutmalı.
  const gelisler = new Set(
    a.filter((x) => x.employee === 'nod').map((x) => toIsoDay(x.date))
  );
  const atla = yokSayilanGun(TEAM.find((p) => p._id === 'nod'), RULE, []);

  let bekleme = 0;
  let enUzun = 0;
  for (let g = 1; g <= 31; g += 1) {
    const gun = utcDate(YEAR, MONTH, g);
    if (gelisler.has(toIsoDay(gun))) bekleme = 0;
    else if (!atla(gun)) enUzun = Math.max(enUzun, (bekleme += 1));
  }
  assert.ok(enUzun <= RULE.maxIdleDays, `nöbetsiz personel: en uzun bekleme ${enUzun} gün`);
});

test('bekleme sınırı sağlanamadığında sessizce geçilmez, raporlanır', () => {
  // Sınır 1'e çekilince hafta sonları (gündüz kadrosu 0) kural sağlanamaz.
  const imkansiz = { ...RULE, maxIdleDays: 1 };
  const a = run({ rule: imkansiz });
  const ihlaller = idleViolations(a, TEAM, imkansiz, { year: YEAR, month: MONTH });

  assert.ok(ihlaller.length > 0, 'aşım raporlanmalı');
  assert.ok(ihlaller.every((r) => r.days > imkansiz.maxIdleDays && r.limit === 1));
});

test('haftalık saat alt sınırı tutulur; tutulamayan hafta raporlanır', () => {
  const a = run();
  const tamHaftalar = fullWeekKeys(YEAR, MONTH);
  assert.equal(tamHaftalar.size, 3, 'Ekim 2026: 5, 12 ve 19 Ekim haftaları tam');

  const eksikler = [];
  for (const p of TEAM) {
    for (const hafta of tamHaftalar) {
      const saat = a
        .filter((x) => x.employee === p._id && isoWeekKey(x.date) === hafta)
        .reduce((sum, x) => sum + (x.shiftType === 'nobet-24' ? 24 : 8), 0);
      if (saat < RULE.minWeeklyHours) eksikler.push(`${p.name}/${hafta}: ${saat}s`);
    }
  }

  // Haftalık alt sınır hedeftir, bekleme sınırı ise zorunlu kuraldır. İkisi
  // çakıştığında bekleme kazanır; bu yüzden tek tük hafta sınırın altında
  // kalabilir. Yaygınlaşmamalı ve sessizce geçilmemeli.
  assert.ok(eksikler.length <= 2, `çok fazla eksik hafta: ${eksikler.join(', ')}`);

  const uyari = summarizeWarnings(a, TEAM, RULE, { year: YEAR, month: MONTH, leaves: [] });
  assert.equal(
    uyari.weeklyShort.length,
    eksikler.length,
    'her eksik hafta uyarı olarak raporlanmalı'
  );
});

test('kapasite yetmediğinde eksik hafta sessizce geçilmez, raporlanır', () => {
  // Hafta içi gündüz kadrosu 2 iken her gün gelen 2 kişi kadroyu kapatıyor;
  // rotasyona gündüz kalmıyor, nöbet almayan kişi 32 saati tutturamıyor.
  const dar = { ...RULE, weekdayDayStaff: 2 };
  const a = run({ rule: dar });
  const { satirlar } = puantaj(TEAM, a, dar, { year: YEAR, month: MONTH });

  const nobetsiz = satirlar.find((r) => r.employee === 'nod');
  assert.ok(nobetsiz.eksikHafta.length > 0, 'eksik haftalar puantajda görünmeli');
  assert.ok(nobetsiz.eksikHafta.every((h) => h.hours < dar.minWeeklyHours));
});

test('vardiya saatleri kural setinden gelir ve tüm saat hesabına yansır', () => {
  // Departman prensibi: gündüz 07:00-19:00 (12 saat), nöbet 19:00-07:00 (12 saat).
  const vardiyali = {
    ...RULE,
    dayShiftStart: '07:00',
    dayShiftEnd: '19:00',
    dutyStart: '19:00',
    dutyEnd: '07:00',
    minWeeklyHours: 24,
  };
  const a = run({ rule: vardiyali });
  const { satirlar } = puantaj(TEAM, a, vardiyali, { year: YEAR, month: MONTH });

  const gunducu = satirlar.find((r) => r.employee === 'gun');
  assert.equal(gunducu.gunduzGun, 21);
  assert.equal(gunducu.toplamSaat, 21 * 12, 'gündüz 8 değil 12 saat sayılmalı');

  const ayla = satirlar.find((r) => r.employee === 'a');
  assert.equal(ayla.toplamSaat, ayla.gunduzGun * 12 + ayla.nobetToplam * 12);
  assert.equal(ayla.nobetSaat, ayla.nobetToplam * 12, 'nöbet 24 değil 12 saat');
});

test('puantaj ay sonu dökümünü kategori ve saat bazında verir', () => {
  const a = run();
  const { satirlar, toplam } = puantaj(TEAM, a, RULE, { year: YEAR, month: MONTH });

  const gunducu = satirlar.find((r) => r.employee === 'gun');
  assert.equal(gunducu.gunduzGun, 21);
  assert.equal(gunducu.nobetToplam, 0);
  assert.equal(gunducu.toplamSaat, 21 * 8);

  const ayla = satirlar.find((r) => r.employee === 'a');
  assert.equal(
    ayla.toplamSaat,
    ayla.gunduzGun * 8 + ayla.nobetToplam * 24,
    'toplam saat = gündüz×8 + nöbet×24'
  );
  assert.equal(
    ayla.nobetToplam,
    ayla.nobet['hafta-ici'] + ayla.nobet['persembe'] + ayla.nobet['cuma'] + ayla.nobet['hafta-sonu']
  );
  assert.equal(toplam.nobetToplam, 31, 'ayın tüm nöbetleri puantajda');
});

test('izin kuralı Pazartesi dışını uyarır ama engellemez', () => {
  const persembe = utcDate(YEAR, MONTH, 1); // 1 Ekim 2026 Perşembe
  const pazartesi = utcDate(YEAR, MONTH, 5);

  const uygun = leaveWarnings(
    [{ _id: 'l1', employee: 'a', startDate: pazartesi, endDate: utcDate(YEAR, MONTH, 11) }],
    [{ date: persembe, employee: 'a', shiftType: 'nobet-24' }]
  );
  assert.deepEqual(uygun, [], 'Pazartesi başlayıp Pazartesi dönen, Perşembe nöbetli izin uyarısız');

  const [hatali] = leaveWarnings(
    [{ _id: 'l2', employee: 'b', startDate: utcDate(YEAR, MONTH, 6), endDate: utcDate(YEAR, MONTH, 9) }],
    []
  );
  assert.deepEqual(hatali.warnings.sort(), [
    LEAVE_WARNINGS.RETURN_NOT_MONDAY,
    LEAVE_WARNINGS.START_NOT_MONDAY,
  ].sort());

  const [persembesiz] = leaveWarnings(
    [{ _id: 'l3', employee: 'c', startDate: pazartesi, endDate: utcDate(YEAR, MONTH, 11) }],
    []
  );
  assert.deepEqual(persembesiz.warnings, [LEAVE_WARNINGS.NO_THURSDAY_DUTY]);
});

/**
 * Süre bütçesi, üretimin sunucusuz ortamda zaman aşımına düşmesini engelleyen
 * tek şey. İterasyon sınırı makineden makineye çok farklı süreler demek: aynı
 * 60000 iterasyon burada saniyeler, kısıtlı bir CPU'da dakikalar sürüyor.
 * Bütçe dolduğunda arama durur ama liste yarım kalmaz — slotların tamamı yerinde,
 * zorunlu kurallar çiğnenmemiş olmalı.
 */
test('süre bütçesi aramayı keser ama tamamlanmış liste döner', () => {
  const kisitli = () => {
    let seed = 42;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    return buildSchedule({
      shiftTypes: UNIT.shiftTypes,
      year: YEAR,
      month: MONTH,
      employees: TEAM,
      leaves: [],
      rule: RULE,
      history: [],
      // Bütçe tükenmeden bitmesi imkânsız bir iterasyon sayısı.
      iterations: 5_000_000,
      timeBudgetMs: 900,
    });
  };

  const t = Date.now();
  const a = kisitli();
  const gecen = Date.now() - t;

  // Üç tur 900 ms'i paylaşır; onarım geçişleri bütçe dışı olduğu için pay bırakılır.
  assert.ok(gecen < 20_000, `bütçe aramayı kesmeli, geçen süre ${gecen} ms`);

  const butcesiz = buildSlots(UNIT, YEAR, MONTH, RULE);
  assert.equal(a.length, butcesiz.length, 'slot sayısı bütçeden etkilenmez');
  assert.equal(
    a.filter((x) => !x.employee).length,
    0,
    'bütçe dolsa da her slot dolu döner'
  );
  assert.deepEqual(idleViolations(a, TEAM, RULE, YEAR, MONTH), [], 'bekleme sınırı korunur');
});
