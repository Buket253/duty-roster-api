import { FLAGS } from '../../utils/constants.js';
import {
  addDays,
  diffDays,
  dutyCategory,
  isoWeekday,
  isoWeekKey,
  isWeekend,
  sameUtcDay,
  startOfUtcDay,
} from '../../utils/dates.js';
import { holidaySet, staffingFor } from './calendar.js';
import { isDutyPool, neverOnDuty } from './staff.js';
import { shiftHours } from './shiftHours.js';

/** Mongoose ObjectId / string farkını yutan kimlik karşılaştırması. */
export const idOf = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

export const sameEmployee = (a, b) => idOf(a) !== null && idOf(a) === idOf(b);

/**
 * Önceki aydan taşınan atamalar `history: true` ile işaretlenir. Dinlenme, gün aşırı
 * ve boşluk hesapları bunları görür — ay geçişinde kurallar bozulmasın diye — ama
 * aylık sayaçlara ve adalet dengesine girmezler.
 */
const scored = (assignments) => assignments.filter((a) => !a.history);

const isDuty = (a) => a.shiftType === 'nobet-24';

export const hoursOf = (assignment, rule) => shiftHours(rule)[assignment.shiftType] ?? 0;

/**
 * İznin fiilî bitişi. Cuma ya da Cumartesi biten bir izinde kişi hafta sonuna
 * çağrılmaz, işe Pazartesi döner; bu yüzden izin araya giren hafta sonunu da
 * kapsayacak şekilde uzatılır.
 */
export function effectiveLeaveEnd(leave) {
  const son = startOfUtcDay(leave.endDate);
  const gun = isoWeekday(son);
  if (gun === 5) return addDays(son, 2); // Cuma -> Pazar
  if (gun === 6) return addDays(son, 1); // Cumartesi -> Pazar
  return son;
}

/** Çalışanın verilen tarihte onaylı bir izni var mı? */
export function isOnLeave(employeeId, date, leaves) {
  const day = startOfUtcDay(date).getTime();
  return leaves.some(
    (leave) =>
      sameEmployee(leave.employee, employeeId) &&
      startOfUtcDay(leave.startDate).getTime() <= day &&
      effectiveLeaveEnd(leave).getTime() >= day
  );
}

/** Aynı gün içinde çalışana zaten bir vardiya verilmiş mi? */
export function isDoubleBooked(employeeId, date, assignments, { ignore = null } = {}) {
  return assignments.some(
    (a) => a !== ignore && sameEmployee(a.employee, employeeId) && sameUtcDay(a.date, date)
  );
}

/** Çalışanın nöbetleri, tarih sırasında. */
export function dutiesOf(employeeId, assignments, { ignore = null } = {}) {
  return assignments
    .filter((a) => a !== ignore && isDuty(a) && sameEmployee(a.employee, employeeId))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * Nöbet sonrası zorunlu dinlenme ihlali.
 * Nöbet gününden sonraki `minRestDaysAfterDuty` gün tamamen boş kalmalıdır; bu
 * pencereye düşen nöbet de gündüz mesaisi de ihlaldir.
 */
export function hasShortRest(employeeId, date, assignments, rule, { ignore = null } = {}) {
  const rest = rule.minRestDaysAfterDuty ?? 1;
  return dutiesOf(employeeId, assignments, { ignore }).some((a) => {
    const gap = diffDays(date, a.date);
    return gap > 0 && gap - 1 < rest;
  });
}

/**
 * "Gün aşırı" nöbet: iki nöbet arasında tam olarak alt sınır kadar boş gün kalması.
 * Ayda `maxTightGapsPerMonth` kez istisna olarak yapılabilir.
 * Sayım, aralığın ikinci (sonraki) nöbetine yazılır; önceki ay devri de sayılır.
 */
export function tightGapCount(employeeId, assignments, rule, { ignore = null } = {}) {
  const rest = rule.minRestDaysAfterDuty ?? 1;
  const duties = dutiesOf(employeeId, assignments, { ignore });
  let count = 0;
  for (let i = 1; i < duties.length; i += 1) {
    if (duties[i].history) continue;
    if (diffDays(duties[i].date, duties[i - 1].date) - 1 === rest) count += 1;
  }
  return count;
}

/** Verilen tarihe nöbet eklenirse oluşacak gün aşırı aralık sayısı. */
export function tightGapCountWith(employeeId, date, assignments, rule, { ignore = null } = {}) {
  return tightGapCount(
    employeeId,
    [...assignments, { date, shiftType: 'nobet-24', employee: employeeId }],
    rule,
    { ignore }
  );
}

/** Çalışanın nöbet sayısı; kategori ya da yalnızca hafta sonu ile daraltılabilir. */
export function dutyCount(employeeId, assignments, { weekendOnly = false, category = null, ignore = null } = {}) {
  return scored(assignments).filter(
    (a) =>
      a !== ignore &&
      isDuty(a) &&
      sameEmployee(a.employee, employeeId) &&
      (!weekendOnly || isWeekend(a.date)) &&
      (!category || dutyCategory(a.date) === category)
  ).length;
}

/** Çalışanın gündüz mesaisi (mesai-8) sayısı. */
export function dayShiftCount(employeeId, assignments, { ignore = null } = {}) {
  return scored(assignments).filter(
    (a) => a !== ignore && a.shiftType === 'mesai-8' && sameEmployee(a.employee, employeeId)
  ).length;
}

/** Çalışanın toplam vardiya sayısı: nöbet + mesai. */
export function workloadCount(employeeId, assignments, { weekendOnly = false } = {}) {
  return scored(assignments).filter(
    (a) => sameEmployee(a.employee, employeeId) && (!weekendOnly || isWeekend(a.date))
  ).length;
}

/** Çalışanın toplam çalışma saati; `week` verilirse yalnızca o ISO haftası. */
export function totalHours(employeeId, assignments, { week = null, rule = null } = {}) {
  const saat = shiftHours(rule);
  return scored(assignments)
    .filter(
      (a) => sameEmployee(a.employee, employeeId) && (!week || isoWeekKey(a.date) === week)
    )
    .reduce((sum, a) => sum + (saat[a.shiftType] ?? 0), 0);
}

/**
 * Verilen tarihten hemen önce, çalışanın hastaneye hiç gelmediği kesintisiz gün
 * sayısı.
 *
 * Nöbet de gündüz mesaisi de "geldi" sayılır ve beklemeyi sıfırlar; kural ikisini
 * birlikte değerlendirir. Nöbet sonrası zorunlu dinlenme günü beklemeye dahildir.
 *
 * Yürüyüş `limit` gününde durur — eşiği aşıp aşmadığını bilmek yeterli, ayın ilk
 * günlerinde geçmiş veri yokken sonsuza gitmesin.
 */
export function idleDaysBefore(
  employeeId,
  date,
  assignments,
  { limit = 8, ignore = null, skipDay = null } = {}
) {
  let idle = 0;
  let cursor = addDays(startOfUtcDay(date), -1);
  let steps = 0;
  // Atlanan günler sayaca girmediği için yürüyüş uzayabilir; adım sayısını da sınırla.
  while (idle < limit && steps < limit * 3 + 7) {
    steps += 1;
    const geldi = assignments.some(
      (a) => a !== ignore && sameEmployee(a.employee, employeeId) && sameUtcDay(a.date, cursor)
    );
    if (geldi) break;
    // Kişinin o gün hiçbir şekilde atanamayacağı günler beklemeye sayılmaz.
    if (!skipDay?.(cursor)) idle += 1;
    cursor = addDays(cursor, -1);
  }
  return idle;
}

/**
 * Kişi verilen ISO haftasının herhangi bir gününde izinli mi?
 * İzin, kişiyi hem nöbetten hem mesaiden tamamen çıkardığı için o haftanın saati
 * haftalık alt sınıra göre değerlendirilmez.
 */
export function isOnLeaveDuringWeek(employeeId, week, leaves) {
  const start = new Date(`${week}T00:00:00.000Z`);
  for (let i = 0; i < 7; i += 1) {
    if (isOnLeave(employeeId, addDays(start, i), leaves)) return true;
  }
  return false;
}

/**
 * Kişinin o gün hastaneye gelmesi zaten mümkün değil miydi? Böyle günler beklemeye
 * sayılmaz, çünkü bekleme değil yapının kendisidir:
 *  - kişi izinlidir,
 *  - o gün kişinin girebileceği hiçbir tipten slot açılmamıştır (ör. hafta sonu
 *    gündüz kadrosu 0 iken nöbete giremeyen personel).
 *
 * Nöbet sonrası zorunlu dinlenme günü BURADA dışlanmaz: kişi o gün hastaneye
 * gelmiyordur ve kural "gelmeden geçirilen gün" sayar.
 */
export const yokSayilanGun = (employee, rule, leaves = []) => {
  const holidays = holidaySet(rule);
  return (date) => {
    if (rule.excludeOnLeave !== false && isOnLeave(idOf(employee), date, leaves)) return true;

    const kadro = staffingFor(date, rule, holidays);
    const nobetMumkun = kadro['nobet-24'] > 0 && !neverOnDuty(employee, date);
    const mesaiMumkun = kadro['mesai-8'] > 0;
    return !nobetMumkun && !mesaiMumkun;
  };
};

/**
 * Bir çalışanın belirli bir slotu alabilmesi için sağlaması gereken hard-constraint'ler.
 * İhlal varsa ilgili flag'i, uygunsa null döner.
 * `allowBackup` açıkken sorumlu hemşire de nöbet adayı sayılır (yedek turu).
 */
export function violationFor(employee, slot, { leaves, assignments, rule, ignore = null, allowBackup = false }) {
  const id = idOf(employee);
  if (rule.excludeOnLeave && isOnLeave(id, slot.date, leaves)) return FLAGS.ON_LEAVE;
  if (isDoubleBooked(id, slot.date, assignments, { ignore })) return FLAGS.DOUBLE_BOOKED;
  if (hasShortRest(id, slot.date, assignments, rule, { ignore })) return FLAGS.SHORT_REST;

  if (slot.shiftType === 'nobet-24') {
    // Personel tipi kontrolü yalnızca tam kayıt elde varken yapılabilir; sadece id
    // geldiğinde (yeniden değerlendirme) bu kontrol flags tarafında yapılır.
    if (typeof employee === 'object' && employee?.name !== undefined) {
      if (neverOnDuty(employee, slot.date)) return FLAGS.NO_DUTY;
      if (!allowBackup && !isDutyPool(employee, slot.date)) return FLAGS.BACKUP_USED;
    }
    if (tightGapCountWith(id, slot.date, assignments, rule, { ignore }) > (rule.maxTightGapsPerMonth ?? 1)) {
      return FLAGS.TIGHT_GAP;
    }
    if (dutyCount(id, assignments, { ignore }) + 1 > rule.maxDutiesPerMonth) {
      return FLAGS.OVER_LIMIT;
    }
  }
  return null;
}

export const isFeasible = (employee, slot, context) => violationFor(employee, slot, context) === null;
