import { daysInMonth, isWeekend, utcDate } from '../../utils/dates.js';

const TYPE_ORDER = { 'nobet-24': 0, 'mesai-8': 1 };

/**
 * Ay içindeki her gün için birimin kullandığı her vardiya tipinden slot üretir.
 *  - nobet-24 : her gün, birimin minStaffPerDay değeri kadar
 *  - mesai-8  : yalnızca hafta içi (Pzt-Cum), günde bir
 * Sonuç tarih sırasına göre (aynı gün içinde önce nöbet) sıralı döner.
 */
export function buildSlots(unit, year, month) {
  const slots = [];
  const total = daysInMonth(year, month);
  const shiftTypes = [...(unit.shiftTypes ?? [])].sort((a, b) => TYPE_ORDER[a] - TYPE_ORDER[b]);

  for (let day = 1; day <= total; day += 1) {
    const date = utcDate(year, month, day);
    for (const shiftType of shiftTypes) {
      if (shiftType === 'mesai-8' && isWeekend(date)) continue;
      const count = shiftType === 'nobet-24' ? Math.max(1, unit.minStaffPerDay || 1) : 1;
      for (let i = 0; i < count; i += 1) slots.push({ date, shiftType });
    }
  }
  return slots;
}

export default buildSlots;
