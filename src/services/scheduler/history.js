import Schedule from '../../models/Schedule.js';
import DutyAssignment from '../../models/DutyAssignment.js';
import { addDays, dutyCategory, monthRange } from '../../utils/dates.js';

/**
 * Ay geçişinde kuralların bozulmaması için önceki ayın son günlerindeki atamalar.
 * Dinlenme, gün aşırı ve boşluk hesapları bunları görür; `history: true` işareti
 * sayesinde aylık sayaçlara ve adalet dengesine girmezler.
 */
export async function loadHistory(unitId, year, month, { days = 14 } = {}) {
  const { start } = monthRange(year, month);
  const from = addDays(start, -days);

  const schedules = await Schedule.find({ unit: unitId }).select('_id').lean();
  if (schedules.length === 0) return [];

  const rows = await DutyAssignment.find({
    schedule: { $in: schedules.map((s) => s._id) },
    date: { $gte: from, $lt: start },
    employee: { $ne: null },
  })
    .select('date employee shiftType')
    .lean();

  return rows.map((a) => ({
    date: a.date,
    employee: a.employee,
    shiftType: a.shiftType,
    category: dutyCategory(a.date),
    history: true,
    flags: [],
  }));
}

export default loadHistory;
