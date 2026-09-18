import { FLAGS, HOUR_MS, SHIFT_DURATION_HOURS } from '../../utils/constants.js';
import { addDays, isWeekend, sameUtcDay, startOfUtcDay } from '../../utils/dates.js';

/** Mongoose ObjectId / string farkını yutan kimlik karşılaştırması. */
export const idOf = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

export const sameEmployee = (a, b) => idOf(a) !== null && idOf(a) === idOf(b);

/** Çalışanın verilen tarihte onaylı bir izni var mı? */
export function isOnLeave(employeeId, date, leaves) {
  const day = startOfUtcDay(date).getTime();
  return leaves.some(
    (leave) =>
      sameEmployee(leave.employee, employeeId) &&
      startOfUtcDay(leave.startDate).getTime() <= day &&
      startOfUtcDay(leave.endDate).getTime() >= day
  );
}

/** Aynı gün içinde çalışana zaten bir vardiya verilmiş mi? */
export function isDoubleBooked(employeeId, date, assignments, { ignore = null } = {}) {
  return assignments.some(
    (a) => a !== ignore && sameEmployee(a.employee, employeeId) && sameUtcDay(a.date, date)
  );
}

/**
 * Nöbet sonrası zorunlu dinlenme ihlali.
 * nobet-24 vardiyası tarihin 00:00'ında başlar, süresi kadar sürer; bitişin üzerinden
 * rule.minRestHoursAfterDuty geçmeden yeni vardiya verilemez.
 */
export function hasShortRest(employeeId, date, assignments, rule, { ignore = null } = {}) {
  const slotStart = startOfUtcDay(date).getTime();
  return assignments.some((a) => {
    if (a === ignore || !sameEmployee(a.employee, employeeId)) return false;
    if (a.shiftType !== 'nobet-24') return false;
    const start = startOfUtcDay(a.date).getTime();
    if (start >= slotStart) return false;
    const end = start + SHIFT_DURATION_HOURS[a.shiftType] * HOUR_MS;
    return slotStart < end + rule.minRestHoursAfterDuty * HOUR_MS;
  });
}

/** Verilen tarihten hemen önce kesintisiz devam eden nöbet gün sayısı. */
export function consecutiveRunBefore(employeeId, date, assignments, { ignore = null } = {}) {
  let run = 0;
  let cursor = addDays(startOfUtcDay(date), -1);
  while (
    assignments.some(
      (a) =>
        a !== ignore &&
        a.shiftType === 'nobet-24' &&
        sameEmployee(a.employee, employeeId) &&
        sameUtcDay(a.date, cursor)
    )
  ) {
    run += 1;
    cursor = addDays(cursor, -1);
  }
  return run;
}

/** Çalışanın listedeki nöbet (nobet-24) sayısı. */
export function dutyCount(employeeId, assignments, { weekendOnly = false, ignore = null } = {}) {
  return assignments.filter(
    (a) =>
      a !== ignore &&
      a.shiftType === 'nobet-24' &&
      sameEmployee(a.employee, employeeId) &&
      (!weekendOnly || isWeekend(a.date))
  ).length;
}

/** Çalışanın toplam iş yükü: nöbet + mesai. Adalet sıralamasında kullanılır. */
export function workloadCount(employeeId, assignments, { weekendOnly = false } = {}) {
  return assignments.filter(
    (a) => sameEmployee(a.employee, employeeId) && (!weekendOnly || isWeekend(a.date))
  ).length;
}

/**
 * Bir çalışanın belirli bir slotu alabilmesi için sağlaması gereken hard-constraint'ler.
 * İhlal varsa ilgili flag'i, uygunsa null döner.
 */
export function violationFor(employee, slot, { leaves, assignments, rule, ignore = null }) {
  const id = idOf(employee);
  if (rule.excludeOnLeave && isOnLeave(id, slot.date, leaves)) return FLAGS.ON_LEAVE;
  if (isDoubleBooked(id, slot.date, assignments, { ignore })) return FLAGS.DOUBLE_BOOKED;
  if (hasShortRest(id, slot.date, assignments, rule, { ignore })) return FLAGS.SHORT_REST;

  if (slot.shiftType === 'nobet-24') {
    if (consecutiveRunBefore(id, slot.date, assignments, { ignore }) + 1 > rule.maxConsecutiveDuties) {
      return FLAGS.CONSECUTIVE;
    }
    if (dutyCount(id, assignments, { ignore }) + 1 > rule.maxDutiesPerMonth) {
      return FLAGS.OVER_LIMIT;
    }
  }
  return null;
}

export const isFeasible = (employee, slot, context) => violationFor(employee, slot, context) === null;
