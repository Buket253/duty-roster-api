import Employee from '../../models/Employee.js';
import LeaveRequest from '../../models/LeaveRequest.js';
import Schedule from '../../models/Schedule.js';
import DutyAssignment from '../../models/DutyAssignment.js';
import { monthRange } from '../../utils/dates.js';
import { buildSchedule } from './buildSchedule.js';
import { loadHistory } from './history.js';
import { getRuleForUnit } from '../rules.js';
import { SEARCH_TIME_BUDGET_MS } from '../../utils/constants.js';

/**
 * Yerel aramaya ayrılan süre. Sunucusuz ortamlarda fonksiyonun kendi zaman
 * sınırı var; bütçe oraya sığacak şekilde SCHEDULER_TIME_BUDGET_MS ile
 * daraltılabilir. Geçersiz bir değer sessizce yutulmaz, varsayılana düşer.
 */
function sureButcesi() {
  const ham = Number(process.env.SCHEDULER_TIME_BUDGET_MS);
  return Number.isFinite(ham) && ham > 0 ? ham : SEARCH_TIME_BUDGET_MS;
}

/** Birimin aktif çalışanları + o ayla kesişen izinleri + önceki aydan devreden atamalar. */
export async function loadUnitContext(unitId, year, month) {
  const { start, end } = monthRange(year, month);
  const employees = await Employee.find({ unit: unitId, active: true }).sort({ name: 1 }).lean();
  const leaves = await LeaveRequest.find({
    employee: { $in: employees.map((e) => e._id) },
    startDate: { $lt: end },
    endDate: { $gte: start },
  })
    .populate('employee', 'name')
    .lean();
  const rule = await getRuleForUnit(unitId);
  const history = await loadHistory(unitId, year, month);
  return { employees, leaves, rule, history };
}

/**
 * Üretim hattını (buildSchedule) çalıştırıp taslağı kalıcılaştırır; aynı ay için
 * kayıt varsa üzerine yazar.
 */
export async function generateSchedule(unit, year, month, { iterations = 20000 } = {}) {
  const { employees, leaves, rule, history } = await loadUnitContext(unit._id, year, month);

  const assignments = buildSchedule({
    shiftTypes: unit.shiftTypes ?? [],
    year,
    month,
    employees,
    leaves,
    rule,
    history,
    iterations,
    timeBudgetMs: sureButcesi(),
  });

  const schedule = await Schedule.findOneAndUpdate(
    { unit: unit._id, year, month },
    { unit: unit._id, year, month, status: 'taslak', generatedAt: new Date() },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );

  await DutyAssignment.deleteMany({ schedule: schedule._id });
  await DutyAssignment.insertMany(
    assignments.map((a) => ({
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
