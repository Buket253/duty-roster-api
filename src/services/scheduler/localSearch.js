import { dutyCount, idOf, sameEmployee, violationFor } from './constraints.js';

const variance = (values) => {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
};

/**
 * Adaletsizlik maliyeti: toplam nöbet sayısı varyansı + hafta sonu nöbeti varyansı.
 * Hafta sonu bileşeni rule.weekendFairnessWeight (0-100) ile ağırlıklandırılır.
 */
export function fairnessCost(assignments, employees, rule) {
  const totals = employees.map((e) => dutyCount(e, assignments));
  const weekends = employees.map((e) => dutyCount(e, assignments, { weekendOnly: true }));
  return variance(totals) + (rule.weekendFairnessWeight / 100) * variance(weekends);
}

/** Çalışanın mevcut atamalarından herhangi biri kuralları ihlal ediyor mu? */
export function employeeHasViolation(employeeId, assignments, leaves, rule) {
  return assignments.some(
    (a) =>
      sameEmployee(a.employee, employeeId) &&
      violationFor(employeeId, a, { leaves, assignments, rule, ignore: a }) !== null
  );
}

/**
 * Açgözlü atamanın ardından rastgele ikili takaslarla adaletsizliği azaltır.
 * Sadece her iki tarafın da hard-constraint'leri sağlamaya devam ettiği ve
 * maliyeti düşüren takaslar kabul edilir.
 */
export function localSearch({
  assignments,
  employees,
  leaves,
  rule,
  iterations = 500,
  stagnantLimit = 150,
  random = Math.random,
}) {
  const current = assignments.map((a) => ({ ...a }));
  let bestCost = fairnessCost(current, employees, rule);
  let stagnant = 0;

  const filled = current.filter((a) => a.employee);
  if (filled.length < 2) return current;

  for (let i = 0; i < iterations && stagnant < stagnantLimit; i += 1) {
    const a = filled[Math.floor(random() * filled.length)];
    const b = filled[Math.floor(random() * filled.length)];

    if (a === b || a.shiftType !== b.shiftType || sameEmployee(a.employee, b.employee)) {
      stagnant += 1;
      continue;
    }

    const [left, right] = [idOf(a.employee), idOf(b.employee)];
    a.employee = right;
    b.employee = left;

    const feasible =
      !employeeHasViolation(left, current, leaves, rule) &&
      !employeeHasViolation(right, current, leaves, rule);
    const nextCost = feasible ? fairnessCost(current, employees, rule) : Infinity;

    if (nextCost < bestCost - 1e-9) {
      bestCost = nextCost;
      stagnant = 0;
    } else {
      a.employee = left;
      b.employee = right;
      stagnant += 1;
    }
  }

  return current;
}

export default localSearch;
