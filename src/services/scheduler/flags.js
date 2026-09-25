import { DUTY_CATEGORIES, FLAGS } from '../../utils/constants.js';
import { shiftHours } from './shiftHours.js';
import { daysInMonth, fullWeekKeys, isoWeekKey, toIsoDay, utcDate } from '../../utils/dates.js';
import { holidaySet, staffingFor } from './calendar.js';
import {
  dayShiftCount,
  dutyCount,
  idOf,
  isOnLeaveDuringWeek,
  yokSayilanGun,
  isDoubleBooked,
  isOnLeave,
  isPreLeaveWeekend,
  hasShortRest,
  tightGapCount,
  totalHours,
} from './constraints.js';
import { isCharge, isDailyDayStaff, isDutyPool, neverOnDuty, staffTypeOf } from './staff.js';

const lookup = (employees) => new Map((employees ?? []).map((e) => [idOf(e), e]));

/**
 * Tüm atama setini kurallara göre yeniden değerlendirir ve her atamanın
 * `flags` alanını günceller. Hem otomatik üretimden sonra hem de manuel
 * düzenleme kaydedilirken çalışır. `history` verilirse ay geçişi kuralları da
 * denetlenir; geçmiş kayıtların kendisi etiketlenmez.
 */
export function evaluateFlags(assignments, { leaves, rule, employees = [], history = [] }) {
  const people = lookup(employees);
  const all = [...history, ...assignments];

  for (const assignment of assignments) {
    const flags = [];
    const employeeId = idOf(assignment.employee);
    const employee = people.get(employeeId) ?? assignment.employee;

    if (!employeeId) {
      flags.push(FLAGS.UNFILLED);
    } else {
      if (rule.excludeOnLeave && isOnLeave(employeeId, assignment.date, leaves)) {
        flags.push(FLAGS.ON_LEAVE);
      } else if (rule.excludeOnLeave && isPreLeaveWeekend(employeeId, assignment.date, leaves)) {
        // Zaten izinli olan gün ayrıca işaretlenmez; bu bayrak yalnızca izne
        // girmeden önceki Cumartesi/Pazar için anlamlı.
        flags.push(FLAGS.PRE_LEAVE_WEEKEND);
      }
      if (isDoubleBooked(employeeId, assignment.date, all, { ignore: assignment })) {
        flags.push(FLAGS.DOUBLE_BOOKED);
      }
      if (hasShortRest(employeeId, assignment.date, all, rule, { ignore: assignment })) {
        flags.push(FLAGS.SHORT_REST);
      }
      if (assignment.shiftType === 'nobet-24') {
        if (employee && typeof employee === 'object' && employee.name !== undefined) {
          if (neverOnDuty(employee, assignment.date)) flags.push(FLAGS.NO_DUTY);
          else if (isCharge(employee)) flags.push(FLAGS.BACKUP_USED);
        }
        if (tightGapCount(employeeId, all, rule) > (rule.maxTightGapsPerMonth ?? 1)) {
          flags.push(FLAGS.TIGHT_GAP);
        }
        if (dutyCount(employeeId, assignments) > rule.maxDutiesPerMonth) {
          flags.push(FLAGS.OVER_LIMIT);
        }
      }
    }

    assignment.flags = flags;
  }

  return assignments;
}

/** Ekip listesi ve "bu ayın etkisi" paneli için kişi bazlı sayaçlar. */
export function employeeStats(employees, assignments, rule, { year, month } = {}) {
  const monthStart = year && month ? utcDate(year, month, 1) : null;
  const monthEnd = year && month ? utcDate(year, month, daysInMonth(year, month)) : null;

  return employees.map((employee) => {
    const duties = dutyCount(employee, assignments);
    // Ay içinde bir gün bile nöbet havuzundaysa aylık min/maks ölçütleri geçerli.
    const inDutyPool = isDutyPool(employee, monthEnd) || isDutyPool(employee, monthStart);
    return {
      employee: idOf(employee),
      name: employee.name,
      title: employee.title,
      staffType: staffTypeOf(employee),
      canTakeDuty: employee.canTakeDuty !== false,
      dutyStartDate: employee.dutyStartDate ?? null,
      duties,
      weekendDuties: dutyCount(employee, assignments, { weekendOnly: true }),
      shifts: dayShiftCount(employee, assignments),
      hours: totalHours(employee, assignments, { rule }),
      // Aylık minimum yalnızca nöbet rotasyonundaki personel için anlamlı.
      belowMin: inDutyPool && duties < rule.minDutiesPerMonth,
      atLimit: inDutyPool && duties >= rule.maxDutiesPerMonth,
    };
  });
}

/**
 * Ay sonu puantajı: kişi başına gündüz gün sayısı, kategori bazlı nöbet sayıları
 * ve toplam çalışma saati (gündüz 8, nöbet 24 saat üzerinden).
 */
export function puantaj(employees, assignments, rule, { year, month, leaves = [] } = {}) {
  // Ayın kesildiği yarım haftalar "eksik" sayılmaz.
  const tamHaftalar = year && month ? fullWeekKeys(year, month) : null;
  const saat = shiftHours(rule);

  const satirlar = employees.map((employee) => {
    const id = idOf(employee);
    const nobet = Object.fromEntries(
      DUTY_CATEGORIES.map((category) => [category, dutyCount(id, assignments, { category })])
    );
    const duties = dutyCount(id, assignments);
    const gunduz = dayShiftCount(id, assignments);
    return {
      employee: id,
      name: employee.name,
      title: employee.title,
      staffType: staffTypeOf(employee),
      gunduzGun: gunduz,
      nobet,
      nobetToplam: duties,
      gunduzSaat: gunduz * saat['mesai-8'],
      nobetSaat: duties * saat['nobet-24'],
      toplamSaat: totalHours(id, assignments, { rule }),
      haftalikSaat: haftalikSaatler(id, assignments, rule),
      eksikHafta: eksikHaftalar(id, assignments, rule, tamHaftalar, leaves),
    };
  });

  const toplam = (alan) => satirlar.reduce((sum, r) => sum + r[alan], 0);
  return {
    satirlar,
    toplam: {
      gunduzGun: toplam('gunduzGun'),
      nobetToplam: toplam('nobetToplam'),
      toplamSaat: toplam('toplamSaat'),
    },
  };
}

/** Kişinin ISO haftası -> saat dökümü. */
function haftalikSaatler(employeeId, assignments, rule) {
  const saat = shiftHours(rule);
  const byWeek = {};
  for (const a of assignments) {
    if (a.history || idOf(a.employee) !== idOf(employeeId)) continue;
    const key = isoWeekKey(a.date);
    byWeek[key] = (byWeek[key] ?? 0) + (saat[a.shiftType] ?? 0);
  }
  return byWeek;
}

/**
 * Haftalık alt sınırın altında kalan haftalar. `tamHaftalar` verilirse yalnızca
 * ayın tamamını kapsayan haftalar denetlenir; kişinin o haftada hiç kaydı yoksa
 * (ör. tüm hafta izinli) hafta 0 saatle raporlanır.
 */
function eksikHaftalar(employeeId, assignments, rule, tamHaftalar = null, leaves = []) {
  const min = rule.minWeeklyHours ?? 0;
  if (!min) return [];

  const saatler = haftalikSaatler(employeeId, assignments, rule);
  const haftalar = tamHaftalar ?? new Set(Object.keys(saatler));

  return [...haftalar]
    .filter((week) => !isOnLeaveDuringWeek(employeeId, week, leaves))
    .map((week) => ({ week, hours: saatler[week] ?? 0 }))
    .filter((h) => h.hours < min)
    .sort((a, b) => a.week.localeCompare(b.week));
}

/**
 * Bir gündeki gündüz sayısının kadroyu aştığı günler. Bu ancak her gün gündüze
 * gelen personel (sadece-gündüz + sorumlu) kadrodan fazlaysa oluşur: onlar her gün
 * gelmek zorunda olduğu için yine de yazılırlar, durum uyarı olarak raporlanır.
 */
export function overCapacityDays(assignments, rule) {
  const holidays = holidaySet(rule);
  const byDate = new Map();
  for (const a of assignments) {
    // Elle eklenen atamalar bilerek kadro dışıdır; aşım sayılmaz.
    if (a.history || a.manual || a.shiftType !== 'mesai-8') continue;
    const key = toIsoDay(a.date);
    if (!byDate.has(key)) byDate.set(key, { date: key, raw: a.date, count: 0 });
    byDate.get(key).count += 1;
  }

  const rows = [];
  for (const gun of byDate.values()) {
    const kadro = staffingFor(gun.raw, rule, holidays)['mesai-8'];
    if (gun.count > kadro) rows.push({ date: gun.date, count: gun.count, kadro });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Boş bekleme sınırını aşan aralıklar: kişinin hastaneye hiç gelmeden geçirdiği
 * ardışık gün sayısı. Nöbet de gündüz mesaisi de gelme sayılır.
 */
export function idleViolations(assignments, employees, rule, { year, month, leaves = [] } = {}) {
  if (!year || !month) return [];
  const sinir = rule.maxIdleDays ?? 3;
  const toplam = daysInMonth(year, month);
  const satirlar = [];

  for (const employee of employees) {
    const atla = yokSayilanGun(employee, rule, leaves);
    const gelisGunleri = new Set(
      assignments
        .filter((a) => idOf(a.employee) === idOf(employee))
        .map((a) => toIsoDay(a.date))
    );
    if (gelisGunleri.size === 0) continue;

    let bekleme = 0;
    let enUzun = 0;
    for (let g = 1; g <= toplam; g += 1) {
      const gun = utcDate(year, month, g);
      if (gelisGunleri.has(toIsoDay(gun))) bekleme = 0;
      else if (!atla(gun)) enUzun = Math.max(enUzun, (bekleme += 1));
    }

    if (enUzun > sinir) {
      satirlar.push({ employee: idOf(employee), name: employee.name, days: enUzun, limit: sinir });
    }
  }

  return satirlar.sort((a, b) => b.days - a.days);
}

/** Liste genelindeki ihlal özeti; dashboard uyarı sayacı bunu kullanır. */
export function summarizeWarnings(assignments, employees, rule, { year, month, leaves = [] } = {}) {
  const byFlag = {};
  for (const assignment of assignments) {
    for (const flag of assignment.flags ?? []) {
      byFlag[flag] = (byFlag[flag] ?? 0) + 1;
    }
  }

  const belowMin = employees
    .filter((e) => isDutyPool(e, null) && dutyCount(e, assignments) < rule.minDutiesPerMonth)
    .map((e) => ({ employee: idOf(e), name: e.name, duties: dutyCount(e, assignments) }));

  // 'sorumlu-yedek' bir ihlal değil, sadece dikkat çekilen durum; toplama girmez.
  const flagged = assignments.filter((a) =>
    (a.flags ?? []).some((f) => f !== FLAGS.BACKUP_USED)
  ).length;

  const overCapacity = overCapacityDays(assignments, rule);

  // Haftalık alt sınırın altında kalan kişi-hafta çiftleri; kapasite yetmediğinde
  // kural sağlanamayabilir, bu yüzden sessizce geçilmeyip raporlanır.
  const tamHaftalar = year && month ? fullWeekKeys(year, month) : null;
  const weeklyShort = tamHaftalar
    ? employees.flatMap((e) =>
        eksikHaftalar(idOf(e), assignments, rule, tamHaftalar, leaves).map((h) => ({
          employee: idOf(e),
          name: e.name,
          ...h,
        }))
      )
    : [];

  const idleExceeded = idleViolations(assignments, employees, rule, { year, month, leaves });

  return {
    total:
      flagged + belowMin.length + overCapacity.length + weeklyShort.length + idleExceeded.length,
    flagged,
    byFlag,
    belowMin,
    overCapacity,
    weeklyShort,
    idleExceeded,
  };
}
