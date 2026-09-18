import { FLAGS } from '../../utils/constants.js';
import {
  consecutiveRunBefore,
  dutyCount,
  idOf,
  isDoubleBooked,
  isOnLeave,
  hasShortRest,
  workloadCount,
} from './constraints.js';

/**
 * Tüm atama setini kurallara göre yeniden değerlendirir ve her atamanın
 * `flags` alanını günceller. Hem otomatik üretimden sonra hem de manuel
 * düzenleme kaydedilirken çalışır.
 */
export function evaluateFlags(assignments, { leaves, rule }) {
  for (const assignment of assignments) {
    const flags = [];
    const employeeId = idOf(assignment.employee);

    if (!employeeId) {
      flags.push(FLAGS.UNFILLED);
    } else {
      if (rule.excludeOnLeave && isOnLeave(employeeId, assignment.date, leaves)) {
        flags.push(FLAGS.ON_LEAVE);
      }
      if (isDoubleBooked(employeeId, assignment.date, assignments, { ignore: assignment })) {
        flags.push(FLAGS.DOUBLE_BOOKED);
      }
      if (hasShortRest(employeeId, assignment.date, assignments, rule, { ignore: assignment })) {
        flags.push(FLAGS.SHORT_REST);
      }
      if (assignment.shiftType === 'nobet-24') {
        if (consecutiveRunBefore(employeeId, assignment.date, assignments) + 1 > rule.maxConsecutiveDuties) {
          flags.push(FLAGS.CONSECUTIVE);
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
export function employeeStats(employees, assignments, rule) {
  return employees.map((employee) => {
    const duties = dutyCount(employee, assignments);
    return {
      employee: idOf(employee),
      name: employee.name,
      title: employee.title,
      duties,
      weekendDuties: dutyCount(employee, assignments, { weekendOnly: true }),
      shifts: workloadCount(employee, assignments) - duties,
      belowMin: duties < rule.minDutiesPerMonth,
      atLimit: duties >= rule.maxDutiesPerMonth,
    };
  });
}

/** Liste genelindeki ihlal özeti; dashboard uyarı sayacı bunu kullanır. */
export function summarizeWarnings(assignments, employees, rule) {
  const byFlag = {};
  for (const assignment of assignments) {
    for (const flag of assignment.flags ?? []) {
      byFlag[flag] = (byFlag[flag] ?? 0) + 1;
    }
  }

  const belowMin = employees
    .filter((e) => dutyCount(e, assignments) < rule.minDutiesPerMonth)
    .map((e) => ({ employee: idOf(e), name: e.name, duties: dutyCount(e, assignments) }));

  const flagged = assignments.filter((a) => (a.flags ?? []).length > 0).length;

  return { total: flagged + belowMin.length, flagged, byFlag, belowMin };
}
