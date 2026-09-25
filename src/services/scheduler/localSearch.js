import { DUTY_CATEGORIES } from '../../utils/constants.js';
import { dutyCategory, daysInMonth, isoWeekKey, startOfUtcDay, utcDate } from '../../utils/dates.js';
import { DAY_MS } from '../../utils/constants.js';
import { holidaySet, staffingFor } from './calendar.js';
import { shiftHours } from './shiftHours.js';
import {
  dayShiftCount,
  dutyCount,
  idOf,
  isOnLeaveDuringWeek,
  isUnavailable,
  sameEmployee,
  tightGapCount,
  totalHours,
  violationFor,
  yokSayilanGun,
} from './constraints.js';
import { isDailyDayStaff, isDayRotation, isDutyPool } from './staff.js';

const variance = (values) => {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
};

/**
 * Kişinin ay içinde kaç gün o rotasyona uygun olduğu. Adalet ham sayılar yerine
 * bu paya göre ölçülür; yoksa ay ortasında nöbete başlayan ya da iki hafta izinli
 * olan kişi, yarım ayda tam yükü taşımaya zorlanırdı.
 */
export function availabilityShares({ employees, leaves, rule, year, month }) {
  const gunler = [];
  for (let d = 1; d <= daysInMonth(year, month); d += 1) gunler.push(utcDate(year, month, d));

  const holidays = holidaySet(rule);
  const kadro = (date, type) => staffingFor(date, rule, holidays)[type];
  // İzin öncesi hafta sonu da müsait sayılmaz: o iki gün kişiye slot verilemiyor,
  // paya dahil edilirse adalet ölçüsü kişiyi olduğundan müsait görür.
  const musait = (employee, date) =>
    !(rule.excludeOnLeave && isUnavailable(idOf(employee), date, leaves));

  const duty = {};
  for (const category of DUTY_CATEGORIES) {
    duty[category] = new Map(
      employees.map((e) => [
        idOf(e),
        gunler.filter(
          (d) =>
            dutyCategory(d, holidays) === category &&
            kadro(d, 'nobet-24') > 0 &&
            isDutyPool(e, d) &&
            musait(e, d)
        ).length,
      ])
    );
  }

  const day = new Map(
    employees.map((e) => [
      idOf(e),
      gunler.filter((d) => kadro(d, 'mesai-8') > 0 && isDayRotation(e, d) && musait(e, d)).length,
    ])
  );

  const hours = new Map(
    employees.map((e) => [
      idOf(e),
      gunler.filter((d) => !isDailyDayStaff(e, d) && musait(e, d)).length,
    ])
  );

  return { duty, day, hours };
}

/**
 * Bir grubun dengesizliği: her kişinin gerçek sayısı ile payına düşen beklenen
 * sayının farkının varyansı. Paylar eşitse bu, ham sayı varyansına indirgenir.
 */
function imbalance(ids, counts, shares) {
  const toplamPay = ids.reduce((sum, id) => sum + (shares.get(id) ?? 0), 0);
  if (toplamPay === 0) return 0;
  const toplamSayi = ids.reduce((sum, id) => sum + counts(id), 0);

  return variance(ids.map((id) => counts(id) - (toplamSayi * (shares.get(id) ?? 0)) / toplamPay));
}

/**
 * Atama setinin kişi bazlı özeti — maliyetin tek pahalı adımı.
 *
 * Maliyet fonksiyonu yerel aramada on binlerce kez çağrılıyor. Önceden her terim
 * kendi `filter`'ını tüm atamalar üzerinde, her kişi için ayrı ayrı çalıştırıyordu;
 * bu, 14 kişilik bir serviste tek çizelge üretimini 16 saniyeye çıkarıyordu.
 * Artık atamalar bir kez taranıp bütün terimlerin okuduğu özet çıkarılıyor.
 */
function snapshot(assignments, rule, fullWeeks) {
  const saat = shiftHours(rule);
  const kisiler = new Map();

  const al = (id) => {
    let k = kisiler.get(id);
    if (!k) {
      k = { gunler: [], nobetGunleri: [], kategori: {}, mesai: 0, saat: 0, hafta: new Map() };
      kisiler.set(id, k);
    }
    return k;
  };

  for (const a of assignments) {
    if (a.history || !a.employee) continue;
    const k = al(idOf(a.employee));
    const ms = startOfUtcDay(a.date).getTime();
    const sure = saat[a.shiftType] ?? 0;

    k.gunler.push(ms);
    k.saat += sure;
    if (a.shiftType === 'nobet-24') {
      k.nobetGunleri.push(ms);
      const kat = a.category ?? dutyCategory(a.date);
      k.kategori[kat] = (k.kategori[kat] ?? 0) + 1;
    } else {
      k.mesai += 1;
    }

    if (fullWeeks?.size) {
      const w = isoWeekKey(a.date);
      if (fullWeeks.has(w)) k.hafta.set(w, (k.hafta.get(w) ?? 0) + sure);
    }
  }

  for (const k of kisiler.values()) {
    k.gunler = [...new Set(k.gunler)].sort((x, y) => x - y);
    k.nobetGunleri.sort((x, y) => x - y);
  }
  return kisiler;
}

const BOS = { gunler: [], nobetGunleri: [], kategori: {}, mesai: 0, saat: 0, hafta: new Map() };
const kisi = (ozet, id) => ozet.get(id) ?? BOS;

/** Bekleme sınırını aşan boş aralıkların toplam fazlası (gün). */
function idleExcess(ozet, ids, rule, atlaFn) {
  const sinir = rule.maxIdleDays ?? 3;
  let toplam = 0;

  for (const id of ids) {
    const gunler = kisi(ozet, id).gunler;
    const atla = atlaFn(id);
    for (let i = 1; i < gunler.length; i += 1) {
      let bekleme = 0;
      for (let ms = gunler[i - 1] + DAY_MS; ms < gunler[i]; ms += DAY_MS) {
        if (!atla(ms)) bekleme += 1;
      }
      if (bekleme > sinir) toplam += bekleme - sinir;
    }
  }
  return toplam;
}

/**
 * Hafta bazında kişiler arası yük dengesizliği.
 *
 * Yalnızca aylık toplam dengelenince bir kişi bir hafta tek nöbetle (24 saat)
 * gelip başka hafta yığılabiliyordu — "bu hafta sadece nöbete geldi" şikâyeti
 * buradan doğuyor. Her tam hafta için kişiler arası saat varyansı ölçülür.
 */
function weeklyImbalance(ozet, ids, fullWeeks, izinliHafta) {
  if (!fullWeeks?.size) return 0;
  let toplam = 0;

  for (const week of fullWeeks) {
    const degerler = [];
    for (const id of ids) {
      if (izinliHafta(id, week)) continue;
      degerler.push((kisi(ozet, id).hafta.get(week) ?? 0) / 8);
    }
    toplam += variance(degerler);
  }
  return toplam;
}

/**
 * Arka arkaya çalışılan gün kümelerinin cezası. İki günden uzun her kesintisiz
 * dizi, uzadıkça artan ceza alır — böylece vardiyalar ay boyunca yayılır.
 */
function clusterPenalty(ozet, ids) {
  let toplam = 0;
  for (const id of ids) {
    const gunler = kisi(ozet, id).gunler;
    let dizi = 1;
    for (let i = 1; i < gunler.length; i += 1) {
      dizi = gunler[i] - gunler[i - 1] === DAY_MS ? dizi + 1 : 1;
      if (dizi > 2) toplam += dizi - 2;
    }
  }
  return toplam;
}

/** Gün aşırı (tam alt sınırda) nöbet aralıklarının toplamı. */
function tightGapTotal(ozet, ids, rule) {
  const rest = rule.minRestDaysAfterDuty ?? 1;
  let toplam = 0;
  for (const id of ids) {
    const gunler = kisi(ozet, id).nobetGunleri;
    for (let i = 1; i < gunler.length; i += 1) {
      if (Math.round((gunler[i] - gunler[i - 1]) / DAY_MS) - 1 === rest) toplam += 1;
    }
  }
  return toplam;
}

/** Haftalık alt sınırın altında kalan saatlerin karesel toplamı. */
function weeklyShortfall(ozet, ids, rule, fullWeeks, izinliHafta) {
  const min = rule.minWeeklyHours ?? 0;
  if (!min || !fullWeeks?.size) return 0;

  let cost = 0;
  for (const id of ids) {
    for (const week of fullWeeks) {
      if (izinliHafta(id, week)) continue;
      cost += Math.max(0, min - (kisi(ozet, id).hafta.get(week) ?? 0)) ** 2;
    }
  }
  return cost;
}

/**
 * Adaletsizlik maliyeti. Bileşenler ayrı ayrı ölçülür: nöbet sayısı dört
 * kategoride (hafta sonu weekendFairnessWeight ile), gündüz mesaisi sayısı,
 * toplam çalışma saati (hoursFairnessWeight ile) ve — istendiğinde — bekleme
 * sınırı, arka arkaya çalışma kümeleri, haftalık alt sınır ve haftalık denge.
 * Her bileşen müsaitlik payına göre normalize edilir.
 */
export function fairnessCost(
  assignments,
  employees,
  rule,
  shares,
  {
    leaves = [],
    enforceIdle = false,
    // Haftalık alt sınır (hedef ulaşılabilirse); haftalık denge ise her hâlükârda.
    enforceWeekly = false,
    balanceWeekly = false,
    fullWeeks = null,
    ctx = null,
  } = {}
) {
  if (!shares) return 0;
  const c = ctx ?? buildContext(employees, rule, shares, leaves, fullWeeks);
  const ozet = snapshot(assignments, rule, fullWeeks);

  let cost = 0;
  for (const category of DUTY_CATEGORIES) {
    const weight = category === 'hafta-sonu' ? (rule.weekendFairnessWeight ?? 0) / 100 : 1;
    cost +=
      weight *
      imbalance(c.dutyIds, (id) => kisi(ozet, id).kategori[category] ?? 0, shares.duty[category]);
  }
  cost += imbalance(c.dayIds, (id) => kisi(ozet, id).mesai, shares.day);
  // Ay sonu toplam saat farkı kullanıcı için en görünür adaletsizlik; bu yüzden
  // sayı varyanslarıyla karşılaştırılabilir olsun diye 4 kat ağırlıkla giriyor.
  cost +=
    4 * ((rule.hoursFairnessWeight ?? 0) / 100) *
    imbalance(c.hoursIds, (id) => kisi(ozet, id).saat / 8, shares.hours);
  cost += 3 * tightGapTotal(ozet, c.dutyIds, rule);

  if (enforceIdle) {
    cost += 6 * idleExcess(ozet, c.hoursIds, rule, c.atla);
    cost += 2 * clusterPenalty(ozet, c.hoursIds);
  }
  if (enforceWeekly) cost += 2 * weeklyShortfall(ozet, c.hoursIds, rule, fullWeeks, c.izinliHafta);
  if (balanceWeekly) cost += 45 * weeklyImbalance(ozet, c.hoursIds, fullWeeks, c.izinliHafta);

  return cost;
}

/**
 * Maliyet değerlendirmeleri arasında değişmeyen her şey: kişi kümeleri ve
 * önbelleklenmiş yardımcılar. Yerel arama bunu bir kez kurup tekrar tekrar geçer.
 */
export function buildContext(employees, rule, shares, leaves, fullWeeks) {
  const varPay = (harita, e) => (harita.get(idOf(e)) ?? 0) > 0;

  // Aynı (kişi, gün) sorusu on binlerce kez soruluyor; sonucu önbelleğe al ve
  // Date nesnesi üretimini gün başına bire indir.
  const atlaOnbellek = new Map();
  const atla = (id) => {
    let f = atlaOnbellek.get(id);
    if (!f) {
      const e = employees.find((x) => idOf(x) === id);
      const ham = yokSayilanGun(e ?? id, rule, leaves);
      const gunler = new Map();
      f = (ms) => {
        let v = gunler.get(ms);
        if (v === undefined) {
          v = ham(new Date(ms));
          gunler.set(ms, v);
        }
        return v;
      };
      atlaOnbellek.set(id, f);
    }
    return f;
  };

  const izinOnbellek = new Map();
  const izinliHafta = (id, week) => {
    const anahtar = `${id}|${week}`;
    if (!izinOnbellek.has(anahtar)) {
      izinOnbellek.set(anahtar, isOnLeaveDuringWeek(id, week, leaves));
    }
    return izinOnbellek.get(anahtar);
  };

  return {
    dutyIds: employees
      .filter((e) => DUTY_CATEGORIES.some((k) => (shares.duty[k].get(idOf(e)) ?? 0) > 0))
      .map(idOf),
    dayIds: employees.filter((e) => varPay(shares.day, e)).map(idOf),
    hoursIds: employees.filter((e) => varPay(shares.hours, e)).map(idOf),
    atla,
    izinliHafta,
    fullWeeks,
  };
}

export function employeeHasViolation(employee, assignments, leaves, rule) {
  return assignments.some(
    (a) =>
      !a.history &&
      sameEmployee(a.employee, employee) &&
      violationFor(employee, a, { leaves, assignments, rule, ignore: a, allowBackup: true }) !== null
  );
}

/**
 * Açgözlü atamanın ardından rastgele ikili takaslarla adaletsizliği azaltır.
 * Sadece her iki tarafın da hard-constraint'leri sağlamaya devam ettiği ve
 * maliyeti düşüren takaslar kabul edilir. Geçmiş ay kayıtları (history) takasa
 * girmez ama kısıt kontrolünde görünür.
 */
export function localSearch({
  assignments,
  employees,
  leaves,
  rule,
  history = [],
  shares,
  // Yalnızca bu vardiya tiplerini takasa aç; boşsa hepsi.
  types = null,
  // Bekleme sınırı maliyete girsin mi? Yalnızca tüm vardiyalar yerleştikten sonra.
  enforceIdle = false,
  // Haftalık saat alt sınırı korunsun mu? Onarım sonrası dengeleme turunda.
  enforceWeekly = false,
  balanceWeekly = false,
  fullWeeks = null,
  iterations = 20000,
  // Erken durma kapalı: bu problemde hamlelerin ezici çoğunluğu kısıtlara takılıp
  // reddediliyor (ölçüldü: nöbet turunda 342 denemede 0 kabul), bu yüzden durgunluk
  // "optimuma ulaşıldı" anlamına gelmiyor. Eski 400'lük eşik aramayı daha ilk yüz
  // denemede bırakıyor, dengelemeyi fiilen hiç yapmıyordu. 6000'lik bir eşik bile
  // aylık saat farkını 24'ten 40'a çıkarıyor (ölçüldü); iterasyon sınırı yeterli.
  stagnantLimit = Number.POSITIVE_INFINITY,
  // Duvar saati sınırı (Date.now() ölçeğinde bir an). İterasyon sınırı makineden
  // makineye çok farklı süreler demek oluyor; sunucusuz ortamda aynı iterasyon
  // sayısı fonksiyonu zaman aşımına düşürüyordu. Bütçe dolduğunda arama o anki
  // en iyi çözümle durur — yarım kalmış bir liste dönmez.
  deadline = null,
  random = Math.random,
}) {
  const current = assignments.map((a) => ({ ...a }));
  const withHistory = [...history, ...current];
  // Bağlam bir kez kurulur; on binlerce maliyet çağrısı boyunca aynı kalır.
  const ctx = buildContext(employees, rule, shares, leaves, fullWeeks);
  const opts = { leaves, enforceIdle, enforceWeekly, balanceWeekly, fullWeeks, ctx };
  let bestCost = fairnessCost(current, employees, rule, shares, opts);
  let stagnant = 0;

  const byId = new Map(employees.map((e) => [idOf(e), e]));
  // Her gün gündüze gelen personelin atamaları sabittir, takasa açılmaz.
  const swappable = current.filter(
    (a) =>
      a.employee &&
      // Kurala göre tek bir kişiye ayrılmış slot (izin öncesi Perşembe nöbeti)
      // takasa açılmaz; aksi hâlde adalet maliyeti onu geri alabiliyor.
      !a.locked &&
      !isDailyDayStaff(byId.get(idOf(a.employee)), a.date) &&
      (!types || types.includes(a.shiftType))
  );
  if (swappable.length < 2) return current;

  // Takas yalnızca aynı tipteki iki vardiya arasında anlamlı. Çiftleri düz listeden
  // seçmek nöbetleri ihmal ediyordu: nöbetler atamaların azınlığı olduğu için
  // rastgele çiftlerin çok azı iki nöbete denk geliyor ve kategori adaleti
  // optimize edilemiyordu. Tipe göre kovalayıp kovayı eşit olasılıkla seçiyoruz.
  const buckets = [...new Set(swappable.map((a) => a.shiftType))]
    .map((type) => swappable.filter((a) => a.shiftType === type))
    .filter((bucket) => bucket.length >= 2);
  if (buckets.length === 0) return current;

  // Aday havuzu: devretme hamlesinde slotun verilebileceği kişiler.
  const havuz = employees.filter((e) => e.active !== false);

  // Saat her iterasyonda değil, blok başına bir kez okunur: tek bir maliyet
  // hesabının yanında Date.now() pahalı değil ama 60000 çağrı ölçülebilir bir
  // yük bindiriyor ve bütçenin bu çözünürlükte olmasına gerek yok.
  const SAAT_ARALIGI = 256;

  for (let i = 0; i < iterations && stagnant < stagnantLimit; i += 1) {
    if (deadline && i % SAAT_ARALIGI === 0 && Date.now() >= deadline) break;

    const bucket = buckets[Math.floor(random() * buckets.length)];
    const a = bucket[Math.floor(random() * bucket.length)];

    // İki hamle tipi. Takas iki kişinin GÜNLERİNİ değiştirir ama vardiya
    // sayılarını değiştirmez — bu yüzden toplam saat dengesi takaslarla asla
    // düzelmiyordu. Devretme bir slotu başka kişiye verir ve sayıları değiştirir.
    const devret = random() < 0.5;

    if (devret) {
      const yeni = havuz[Math.floor(random() * havuz.length)];
      if (sameEmployee(a.employee, yeni) || isDailyDayStaff(yeni, a.date)) {
        stagnant += 1;
        continue;
      }

      const eski = idOf(a.employee);
      a.employee = idOf(yeni);

      const feasible = !employeeHasViolation(yeni, withHistory, leaves, rule);
      const nextCost = feasible ? fairnessCost(current, employees, rule, shares, opts) : Infinity;

      if (nextCost < bestCost - 1e-9) {
        bestCost = nextCost;
        stagnant = 0;
      } else {
        a.employee = eski;
        stagnant += 1;
      }
      continue;
    }

    const b = bucket[Math.floor(random() * bucket.length)];
    if (a === b || sameEmployee(a.employee, b.employee)) {
      stagnant += 1;
      continue;
    }

    const [left, right] = [idOf(a.employee), idOf(b.employee)];
    a.employee = right;
    b.employee = left;

    const feasible =
      !employeeHasViolation(byId.get(left) ?? left, withHistory, leaves, rule) &&
      !employeeHasViolation(byId.get(right) ?? right, withHistory, leaves, rule);
    const nextCost = feasible ? fairnessCost(current, employees, rule, shares, opts) : Infinity;

    if (nextCost < bestCost - 1e-9) {
      bestCost = nextCost;
      stagnant = 0;
    } else {
      a.employee = left;
      b.employee = right;
      stagnant += 1;
    }
  }

  return current;
}

export default localSearch;
