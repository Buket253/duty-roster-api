import { DAILY_DAY_STAFF_TYPES } from '../../utils/constants.js';
import { startOfUtcDay } from '../../utils/dates.js';

/** Kayıttaki ham personel tipi; eski kayıtlarda alan yoksa 'standart' varsayılır. */
export const staffTypeOf = (employee) => employee?.staffType ?? 'standart';

/**
 * Personel tipinin belirli bir tarihteki hâli.
 *
 * Sadece-gündüz personeline nöbete başlama tarihi verilebilir: o tarihten
 * itibaren kişi nöbet rotasyonuna katılır ve 'standart' gibi davranır. Tarih
 * verilmemişse statü süresizdir.
 */
export function staffTypeOn(employee, date) {
  const base = staffTypeOf(employee);
  if (base !== 'sadece-gunduz') return base;

  const start = employee?.dutyStartDate;
  if (!start || !date) return base;
  return startOfUtcDay(date).getTime() >= startOfUtcDay(start).getTime() ? 'standart' : base;
}

/** Kişi ay içinde bir noktada nöbet rotasyonuna katılıyor mu? */
export const joinsDutyDuring = (employee) =>
  staffTypeOf(employee) === 'sadece-gunduz' && Boolean(employee?.dutyStartDate);

/** O tarihte her gün gündüze gelen, adil rotasyonun dışındaki personel. */
export const isDailyDayStaff = (employee, date) =>
  DAILY_DAY_STAFF_TYPES.includes(staffTypeOn(employee, date));

/** Sorumlu hemşire: normalde gündüzde, nöbette yalnızca yedek. */
export const isCharge = (employee) => staffTypeOf(employee) === 'sorumlu';

/** O tarihte nöbet rotasyonuna normal şartlarda giren personel. */
export const isDutyPool = (employee, date) =>
  staffTypeOn(employee, date) === 'standart' && employee?.canTakeDuty !== false;

/** O tarihte nöbete hiç yazılamayacak personel. */
export const neverOnDuty = (employee, date) =>
  staffTypeOn(employee, date) === 'sadece-gunduz' || employee?.canTakeDuty === false;

/** O tarihte gündüz mesaisi rotasyonuna giren personel. */
export const isDayRotation = (employee, date) => !isDailyDayStaff(employee, date);
