import { daysInMonth, dutyCategory, utcDate } from '../../utils/dates.js';
import { holidaySet, staffingFor } from './calendar.js';

/**
 * Ay içindeki her gün için kadro kadar slot üretir. Hafta içi, hafta sonu ve
 * resmi tatil ayrımı kural setinden okunur:
 *   nobet-24 -> weekdayDutyStaff / weekendDutyStaff
 *   mesai-8  -> weekdayDayStaff  / weekendDayStaff
 * Sayı 0 ise o gün o tipten slot açılmaz (ör. hafta sonu gündüz mesaisi yoksa).
 *
 * Her gün gündüz mesaisine gelen personel (sadece-gündüz, sorumlu) bu kadronun
 * İÇİNDEN sayılır: greedyAssign önce onları yerleştirir, rotasyon kalan slotları
 * doldurur. Böylece bir gündeki gündüz sayısı buradaki kadroya eşit kalır.
 */
export function buildSlots(unit, year, month, rule) {
  const slots = [];
  const total = daysInMonth(year, month);
  const types = new Set(unit.shiftTypes ?? []);
  const holidays = holidaySet(rule);

  for (let day = 1; day <= total; day += 1) {
    const date = utcDate(year, month, day);
    const counts = staffingFor(date, rule, holidays);
    // Nöbet önce üretilir: kısıtı en sıkı olan tip, gündüz mesaisi etrafına yerleşir.
    for (const shiftType of ['nobet-24', 'mesai-8']) {
      if (!types.has(shiftType)) continue;
      for (let i = 0; i < counts[shiftType]; i += 1) {
        slots.push({ date, shiftType, category: dutyCategory(date, holidays) });
      }
    }
  }
  return slots;
}

export default buildSlots;
