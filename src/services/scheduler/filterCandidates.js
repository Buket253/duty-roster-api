import { violationFor } from './constraints.js';

/**
 * Bir slot için çalışanları hard-constraint'lere göre ayırır.
 * `eligible`: atanabilir olanlar, `reasons`: elenenlerin sebebi (izin, dinlenme,
 * ardışıklık, aylık limit) — manuel atama ekranında gösterilir.
 */
export function explainCandidates(slot, employees, leaves, assignmentsSoFar, rule) {
  const eligible = [];
  const reasons = {};

  for (const employee of employees) {
    if (employee.active === false) {
      reasons[String(employee._id)] = 'pasif';
      continue;
    }
    const violation = violationFor(employee, slot, {
      leaves,
      assignments: assignmentsSoFar,
      rule,
    });
    if (violation) reasons[String(employee._id)] = violation;
    else eligible.push(employee);
  }

  return { eligible, reasons };
}

/** Slot için uygun adayların listesi. */
export function filterCandidates(slot, employees, leaves, assignmentsSoFar, rule) {
  return explainCandidates(slot, employees, leaves, assignmentsSoFar, rule).eligible;
}

export default filterCandidates;
