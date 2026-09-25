import { isWeekend, toIsoDay } from '../../utils/dates.js';
import { TUM_RESMI_TATILLER } from '../../utils/holidays.js';

/**
 * Birimin tatil günleri: sabit resmi tatiller + kural setine elle eklenenler.
 *
 * Sabit resmi tatiller (29 Ekim, 23 Nisan, …) her birimde hazır gelir; dinî
 * bayramlar ay takvimine göre kaydığı için elle eklenir. `useNationalHolidays`
 * kapatılırsa yalnızca elle eklenenler geçerli olur.
 */
export const holidaySet = (rule) => {
  const elle = rule?.holidays ?? [];
  if (rule?.useNationalHolidays === false) return new Set(elle);
  return new Set([...TUM_RESMI_TATILLER, ...elle]);
};

export const isHoliday = (date, holidays) => Boolean(holidays?.has(toIsoDay(date)));

/**
 * O gün gündüz mesaisi açılmayan bir gün mü? Hafta sonu ve resmi tatiller böyledir.
 * Resmi tatillerde yalnızca nöbetçi bulunur; gündüz kadrosu açılmaz.
 */
export const isOffDay = (date, holidays) => isWeekend(date) || isHoliday(date, holidays);

/**
 * Verilen günün kadrosu: kaç nöbetçi, kaç gündüz personeli.
 * Resmi tatiller hafta sonu gibi çalışır ve gündüz kadrosu her hâlükârda 0'dır —
 * tatil günlerine yalnızca nöbetçi yazılır.
 */
export function staffingFor(date, rule, holidays) {
  const tatil = isHoliday(date, holidays);
  const haftaSonu = isWeekend(date);

  const duty = Number(haftaSonu || tatil ? rule.weekendDutyStaff : rule.weekdayDutyStaff) || 0;
  const day = tatil ? 0 : Number(haftaSonu ? rule.weekendDayStaff : rule.weekdayDayStaff) || 0;

  return { 'nobet-24': Math.max(0, duty), 'mesai-8': Math.max(0, day) };
}

export default staffingFor;
