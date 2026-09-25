import { FLAGS } from '../../utils/constants.js';
import { shiftHours } from './shiftHours.js';
import { holidaySet, staffingFor } from './calendar.js';
import { effectiveLeaveEnd, tightGapCount, violationFor } from './constraints.js';
import { explainCandidates } from './filterCandidates.js';
import {
  dayShiftCount,
  dutyCount,
  idOf,
  idleDaysBefore,
  isOnLeave,
  isDoubleBooked,
  hasShortRest,
  tightGapCountWith,
  totalHours,
  yokSayilanGun,
} from './constraints.js';
import { isCharge, isDailyDayStaff, isDayRotation } from './staff.js';
import {
  addDays,
  daysInMonth,
  diffDays,
  dutyCategory,
  isMonday,
  isoWeekday,
  isoWeekKey,
  sameUtcDay,
  startOfUtcDay,
  toIsoDay,
  utcDate,
} from '../../utils/dates.js';

/**
 * İzin kuralının atama tercihine yansıyan tarafı:
 *  - Pazartesi başlayan bir iznin hemen öncesindeki Perşembe nöbeti,
 *  - İzin bitişinin ertesi günü olan dönüş gününe verilen vardiya
 * tercih edilir. Zorlayıcı değildir, yalnızca sıralamada öne alır.
 */
export function leavePreference(employee, slot, leaves) {
  const own = leaves.filter((l) => idOf(l.employee) === idOf(employee));

  for (const leave of own) {
    if (slot.shiftType === 'nobet-24' && isoWeekday(slot.date) === 4) {
      // Perşembe nöbeti, 4 gün sonra (Pazartesi) başlayan izin için.
      if (isMonday(leave.startDate) && diffDays(leave.startDate, slot.date) === 4) return 2;
    }
    // İzin dönüşü: FİİLÎ bitişin ertesi günü. Kayıttaki bitişe bakmak yanlış günü
    // işaret ediyordu: Cuma biten bir izinde hafta sonu da izne dahil olduğu için
    // (effectiveLeaveEnd) "ertesi gün" Cumartesiye denk geliyor ve kişi o gün
    // hiçbir slot alamadığı için tercih boşa gidiyordu. Dönüş günü Pazartesidir.
    if (diffDays(slot.date, effectiveLeaveEnd(leave)) === 1) return 1;
  }
  return 0;
}

/**
 * Sayıları müsaitlik payına böler: ay ortasında nöbete başlayan ya da uzun izinli
 * olan kişi sıfırdan başladığı için ham sayıya bakıldığında ardı ardına seçilir ve
 * yarım ayda tam yükü toplar. Oranla karşılaştırınca yükü payıyla orantılı kalır.
 */
const oran = (count, share) => count / Math.max(1, share ?? 1);

/** Slot için adayları sıralayıp en uygununu seçer. */
function pickBest(candidates, slot, { assignments, leaves, rule, shares }) {
  const week = isoWeekKey(slot.date);
  const slotHours = shiftHours(rule)[slot.shiftType] ?? 0;
  const maxIdle = rule.maxIdleDays ?? 3;

  return candidates
    .map((employee) => {
      const id = idOf(employee);
      const weekHours = totalHours(id, assignments, { week, rule });
      // Hemen önceki günlerde kaç gün üst üste çalışmış? Kümelenmeyi baştan
      // caydırmak için: bekleme sınırı yalnızca boşlukları kısıtlıyor, hiçbir şey
      // kişiyi üç gün üst üste çalıştırıp sonra sınırın ucunda bekletmeye engel
      // değildi. Vardiyalar ay boyunca yayılsın.
      let ardArda = 0;
      for (let geri = 1; geri <= 4; geri += 1) {
        const onceki = addDays(startOfUtcDay(slot.date), -geri);
        const calisti = assignments.some(
          (x) => idOf(x.employee) === id && sameUtcDay(x.date, onceki)
        );
        if (!calisti) break;
        ardArda += 1;
      }

      const idle = idleDaysBefore(id, slot.date, assignments, {
        limit: maxIdle + 2,
        skipDay: yokSayilanGun(employee, rule, leaves),
      });
      // Bu slot verilirse "gün aşırı" (tam alt sınırda) bir nöbet aralığı oluşur mu?
      const gunAsiri =
        slot.shiftType === 'nobet-24' &&
        tightGapCountWith(id, slot.date, assignments, rule) >
          tightGapCount(id, assignments, rule);
      return {
        employee,
        // Boşluk sınırını aşmak üzere olan kişi önceliklidir.
        urgent: idle >= maxIdle ? 0 : 1,
        // Gün aşırı nöbet son çaredir: aralığı sıkışmayan her aday önce gelir.
        gunAsiri: gunAsiri ? 1 : 0,
        ardArda,
        // Gündüz turunda aciliyet derecelendirilir: en uzun bekleyen önce gelir.
        // Nöbet turunda ikili kalır, yoksa kategori adaletini ezip nöbet
        // dağılımını bozuyor — boşluğu kapatmanın doğru aracı 8 saatlik mesai.
        urgentGraded: -Math.max(0, idle - maxIdle + 1),
        leave: -leavePreference(employee, slot, leaves),
        category: oran(dutyCount(id, assignments, { category: slot.category }), shares?.duty?.[slot.category]?.get(id)),
        duties: oran(dutyCount(id, assignments), shares?.hours?.get(id)),
        dayShifts: oran(dayShiftCount(id, assignments), shares?.day?.get(id)),
        // Bu slotu alsa bile haftalık alt sınıra ne kadar eksik kalacağı.
        // Büyük değer = daha çok muhtaç; sıralamada negatiflenerek öne alınır.
        weekShort: -Math.max(0, (rule.minWeeklyHours ?? 0) - (weekHours + slotHours)),
        hours: totalHours(id, assignments, { rule }),
        name: String(employee.name ?? ''),
      };
    })
    .sort((a, b) => {
      if (slot.shiftType === 'nobet-24') {
        return (
          // Gün aşırı aralık yaratmayan aday her koşulda önceliklidir; bu yüzden
          // beklemesi dolan kişiden bile önce gelir. Kural "mecbur kalmadıkça
          // gün aşırı verme" diyor, alternatif varken mecburiyet yoktur.
          a.gunAsiri - b.gunAsiri ||
          a.urgent - b.urgent ||
          a.leave - b.leave ||
          a.category - b.category ||
          a.duties - b.duties ||
          a.weekShort - b.weekShort ||
          a.hours - b.hours ||
          a.name.localeCompare(b.name, 'tr')
        );
      }
      // Haftalık açık burada yalnızca eşitlik bozucu: tek başına sıralamayı ele
      // geçirirse hiç nöbet almayan kişi tüm mesaileri toplar. Kalan açığı
      // üretimin sonundaki repairWeeklyHours geçişi hedefli olarak kapatır.
      return (
        a.urgentGraded - b.urgentGraded ||
        a.leave - b.leave ||
        // İki gün üst üste çalışmış olan, çalışmamış birine göre geri plana düşer.
        Math.min(a.ardArda, 2) - Math.min(b.ardArda, 2) ||
        a.dayShifts - b.dayShifts ||
        a.weekShort - b.weekShort ||
        a.hours - b.hours ||
        a.name.localeCompare(b.name, 'tr')
      );
    })[0].employee;
}

/** Bir slotu doldurur; aday yoksa boş bırakıp 'doldurulamadi' etiketler. */
function fillSlot(slot, pool, { assignments, leaves, rule, shares, allowBackup = false }) {
  const { eligible } = explainCandidates(slot, pool, leaves, assignments, rule, { allowBackup });
  if (eligible.length === 0) return null;
  const best = pickBest(eligible, slot, { assignments, leaves, rule, shares });
  const entry = { ...slot, employee: idOf(best), flags: allowBackup && isCharge(best) ? [FLAGS.BACKUP_USED] : [] };
  assignments.push(entry);
  return entry;
}

/**
 * Pazartesi başlayan izinlerin hemen öncesindeki Perşembe nöbetlerini, genel tur
 * başlamadan önce sahiplerine ayırır.
 *
 * Tercih olarak sıralamada yer alması yetmiyordu (ölçüldü): nöbet sıralamasında
 * `gunAsiri` ve `urgent` anahtarları izin tercihinden ÖNCE geliyor, bu yüzden
 * izne çıkacak kişi Perşembe nöbetini düzenli olarak kaybedip yerine Cuma
 * nöbetini alıyordu. Kural bu slotu tek bir kişiye bağladığı için pazarlığa
 * açmak yerine önce ayrılıyor.
 *
 * Ayrılan atama `locked` ile işaretlenir: yerel arama ve bekleme onarımı onu
 * devretmez. Alan yoksa (aynı Pazartesi birden fazla kişi izne çıkıyor ve o
 * Perşembe kadrosu yetmiyor, ya da kişi o slotu alamıyor) zorlanmaz — izin kaydı
 * `izin-oncesi-persembe-nobeti-yok` uyarısıyla görünür kalır.
 */
function reservePreLeaveDuties(dutySlots, { assignments, pool, leaves, rule, shares }) {
  const ayrilan = new Set();
  const byId = new Map(pool.map((e) => [idOf(e), e]));

  // Sıra belirlenimci olmalı: aynı Perşembeye iki kişi talip olduğunda hep aynı
  // kişi kazansın, yoksa liste her üretimde değişir.
  const sirali = leaves
    .filter((l) => isMonday(l.startDate))
    .sort((x, y) => String(idOf(x.employee)).localeCompare(String(idOf(y.employee))));

  for (const leave of sirali) {
    const employee = byId.get(idOf(leave.employee));
    if (!employee) continue;

    const persembe = addDays(leave.startDate, -4);
    const slot = dutySlots.find(
      (s) => !ayrilan.has(s) && sameUtcDay(s.date, persembe) && isoWeekday(s.date) === 4
    );
    if (!slot) continue;
    if (violationFor(employee, slot, { leaves, assignments, rule })) continue;

    assignments.push({ ...slot, employee: idOf(employee), flags: [], locked: true });
    ayrilan.add(slot);
  }

  return ayrilan;
}

/**
 * 1. faz — nöbetler. En sıkı kısıt bunlar olduğu için önce yerleşirler ve gündüz
 * mesaisi etraflarına kurulur. Önce normal havuz denenir; hiç aday çıkmazsa
 * sorumlu hemşire yedek olarak devreye girer ve atama 'sorumlu-yedek' etiketlenir.
 */
export function assignDuties({ slots, employees, leaves, rule, history = [], shares }) {
  const assignments = [...history];
  const pool = employees.filter((e) => e.active !== false);
  const dutySlots = slots.filter((s) => s.shiftType === 'nobet-24');

  // İzin öncesi Perşembe nöbetleri genel turdan önce ayrılır.
  const ayrilan = reservePreLeaveDuties(dutySlots, { assignments, pool, leaves, rule, shares });

  for (const slot of dutySlots) {
    if (ayrilan.has(slot)) continue;
    const placed =
      fillSlot(slot, pool, { assignments, leaves, rule, shares }) ??
      fillSlot(slot, pool, { assignments, leaves, rule, shares, allowBackup: true });
    if (!placed) assignments.push({ ...slot, employee: null, flags: [FLAGS.UNFILLED] });
  }

  return assignments.filter((a) => !a.history);
}

/**
 * 2. faz — gündüz mesaisi. Önce her gün gündüze gelen personel (sadece-gündüz,
 * sorumlu) yerleşir, sonra kalan kadro rotasyondan doldurulur. Her gün gelenler
 * kadronun İÇİNDEN sayılır: bir gündeki gündüz sayısı kadroya eşit kalır.
 */
export function assignDayShifts({
  slots,
  employees,
  leaves,
  rule,
  history = [],
  duties = [],
  shares,
  year,
  month,
  shiftTypes = [],
}) {
  const assignments = [...history, ...duties];
  const aktif = employees.filter((e) => e.active !== false);

  // O gün gündüz kadrosu açılmıyorsa (hafta sonu kadrosu 0 ya da resmi tatil)
  // her gün gelen personel de yazılmaz — tatillerde yalnızca nöbetçi bulunur.
  const holidays = holidaySet(rule);
  if (shiftTypes.includes('mesai-8')) {
    for (let day = 1; day <= daysInMonth(year, month); day += 1) {
      const date = utcDate(year, month, day);
      if (staffingFor(date, rule, holidays)['mesai-8'] === 0) continue;

      // Statü tarihe bağlı: nöbete başlama tarihi gelmiş sadece-gündüz personeli
      // artık her gün gelenlerden değil, rotasyondandır.
      for (const employee of aktif.filter((e) => isDailyDayStaff(e, date))) {
        const id = idOf(employee);
        if (rule.excludeOnLeave && isOnLeave(id, date, leaves)) continue;
        // Yedek nöbet aldıysa o gün ve dinlenme penceresi gündüze yazılmaz.
        if (isDoubleBooked(id, date, assignments)) continue;
        if (hasShortRest(id, date, assignments, rule)) continue;
        assignments.push({
          date,
          shiftType: 'mesai-8',
          category: dutyCategory(date, holidays),
          employee: id,
          flags: [],
        });
      }
    }
  }

  const gunlukSlotlar = new Map();
  for (const slot of slots.filter((s) => s.shiftType === 'mesai-8')) {
    const key = toIsoDay(slot.date);
    if (!gunlukSlotlar.has(key)) gunlukSlotlar.set(key, []);
    gunlukSlotlar.get(key).push(slot);
  }

  for (const [key, gunSlotlari] of gunlukSlotlar) {
    const dolu = assignments.filter(
      (a) => !a.history && a.shiftType === 'mesai-8' && toIsoDay(a.date) === key
    ).length;
    const gunPool = aktif.filter((e) => isDayRotation(e, gunSlotlari[0].date));
    for (const slot of gunSlotlari.slice(dolu)) {
      const placed = fillSlot(slot, gunPool, { assignments, leaves, rule, shares });
      if (!placed) assignments.push({ ...slot, employee: null, flags: [FLAGS.UNFILLED] });
    }
  }

  return assignments.filter((a) => !a.history);
}

/** İki fazı arada dengeleme yapmadan arka arkaya çalıştırır. */
export function greedyAssign({ slots, employees, leaves, rule, history = [], year, month, shiftTypes = [] }) {
  const duties = assignDuties({ slots, employees, leaves, rule, history });
  return assignDayShifts({ slots, employees, leaves, rule, history, duties, year, month, shiftTypes });
}

export default greedyAssign;
