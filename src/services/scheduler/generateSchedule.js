import Employee from '../../models/Employee.js';
import LeaveRequest from '../../models/LeaveRequest.js';
import Schedule from '../../models/Schedule.js';
import DutyAssignment from '../../models/DutyAssignment.js';
import { monthRange } from '../../utils/dates.js';
import { buildSlots } from './buildSlots.js';
import { greedyAssign } from './greedyAssign.js';
import { localSearch } from './localSearch.js';
import { evaluateFlags } from './flags.js';
import { getRuleForUnit } from '../rules.js';

/** Birimin aktif çalışanları + o ayla kesişen izinleri. */
export async function loadUnitContext(unitId, year, month) {
  const { start, end } = monthRange(year, month);
  const employees = await Employee.find({ unit: unitId, active: true }).sort({ name: 1 }).lean();
  const leaves = await LeaveRequest.find({
    employee: { $in: employees.map((e) => e._id) },
    startDate: { $lt: end },
    endDate: { $gte: start },
  }).lean();
  const rule = await getRuleForUnit(unitId);
  return { employees, leaves, rule };
}

/**
 * Bölüm 7'deki beş adımı sırayla çalıştırır:
 * slot üret → aday filtrele → açgözlü ata → yerel arama ile dengele → flag'le,
 * ardından taslağı kalıcılaştırır (aynı ay için varsa eskisinin üzerine yazar).
 */
export async function generateSchedule(unit, year, month, { iterations = 500 } = {}) {
  const { employees, leaves, rule } = await loadUnitContext(unit._id, year, month);

  const slots = buildSlots(unit, year, month);
  const greedy = greedyAssign({ slots, employees, leaves, rule });
  const balanced = localSearch({ assignments: greedy, employees, leaves, rule, iterations });
  evaluateFlags(balanced, { leaves, rule });

  const schedule = await Schedule.findOneAndUpdate(
    { unit: unit._id, year, month },
    { unit: unit._id, year, month, status: 'taslak', generatedAt: new Date() },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );

  await DutyAssignment.deleteMany({ schedule: schedule._id });
  await DutyAssignment.insertMany(
    balanced.map((a) => ({
      schedule: schedule._id,
      date: a.date,
      employee: a.employee,
      shiftType: a.shiftType,
      flags: a.flags,
    }))
  );

  return schedule;
}

export default generateSchedule;
