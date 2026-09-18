import { FLAGS } from '../../utils/constants.js';
import { filterCandidates } from './filterCandidates.js';
import { idOf, sameEmployee, workloadCount } from './constraints.js';
import { isWeekend } from '../../utils/dates.js';

/** Çalışanın o ana kadar aldığı, verilen tipteki vardiya sayısı. */
const typeCount = (employee, assignments, shiftType, { weekendOnly = false } = {}) =>
  assignments.filter(
    (a) =>
      a.shiftType === shiftType &&
      sameEmployee(a.employee, employee) &&
      (!weekendOnly || isWeekend(a.date))
  ).length;

/**
 * Slotları tarih sırasına göre gezer; her slotta uygun adaylar arasından o ana
 * kadar aynı tipte en az vardiya almış olanı seçer (nöbet slotunda "en az nöbeti
 * olan"). Eşitlikte sırasıyla hafta sonu sayısı, toplam yük ve ad karşılaştırılır
 * — sonuç deterministiktir.
 * Adayı olmayan slot boş bırakılır ve 'doldurulamadi' ile etiketlenir.
 */
export function greedyAssign({ slots, employees, leaves, rule }) {
  const assignments = [];

  for (const slot of slots) {
    const candidates = filterCandidates(slot, employees, leaves, assignments, rule);

    if (candidates.length === 0) {
      assignments.push({ ...slot, employee: null, flags: [FLAGS.UNFILLED] });
      continue;
    }

    const best = candidates
      .map((employee) => ({
        employee,
        sameType: typeCount(employee, assignments, slot.shiftType),
        weekend: typeCount(employee, assignments, slot.shiftType, { weekendOnly: true }),
        workload: workloadCount(employee, assignments),
      }))
      .sort(
        (a, b) =>
          a.sameType - b.sameType ||
          a.weekend - b.weekend ||
          a.workload - b.workload ||
          String(a.employee.name).localeCompare(String(b.employee.name), 'tr')
      )[0].employee;

    assignments.push({ ...slot, employee: idOf(best), flags: [] });
  }

  return assignments;
}

export default greedyAssign;
