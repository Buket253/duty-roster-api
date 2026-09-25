import { violationFor } from './constraints.js';

/**
 * Bir slot için çalışanları hard-constraint'lere göre ayırır.
 * `eligible`: atanabilir olanlar, `reasons`: elenenlerin sebebi (izin, dinlenme,
 * gün aşırı limiti, aylık limit, personel tipi) — manuel atama ekranında gösterilir.
 * `allowBackup` açıkken sorumlu hemşire de nöbet adayı sayılır.
 */
export function explainCandidates(slot, employees, leaves, assignmentsSoFar, rule, { allowBackup = false } = {}) {
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
      allowBackup,
    });
    if (violation) reasons[String(employee._id)] = violation;
    else eligible.push(employee);
  }

  return { eligible, reasons };
}

/** Slot için uygun adayların listesi. */
export function filterCandidates(slot, employees, leaves, assignmentsSoFar, rule, options) {
  return explainCandidates(slot, employees, leaves, assignmentsSoFar, rule, options).eligible;
}

export default filterCandidates;
