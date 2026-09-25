import { addDays, sameUtcDay, startOfUtcDay } from '../../utils/dates.js';
import { idOf, yokSayilanGun } from './constraints.js';

/**
 * Slot elinden alınırsa kişinin o tarihi içine alan kesintisiz boşluğu kaç gün olur?
 *
 * Devir hamleleri (haftalık saat onarımı, gündüz sayısı dengelemesi) birinin
 * açığını kapatırken bir başkasını bekleme sınırının ötesine itmemeli. Sayım
 * yalnızca kişinin gerçekten gelebileceği günleri kapsar: izinli olduğu ya da
 * kadronun hiç slot açmadığı günler boşluk sayılmaz.
 */
export function idleRunIfRemoved(employee, slot, assignments, limit, rule, leaves) {
  const employeeId = idOf(employee);
  const busy = (date) =>
    assignments.some(
      (a) => a !== slot && idOf(a.employee) === idOf(employeeId) && sameUtcDay(a.date, date)
    );
  const yokSay = yokSayilanGun(employee, rule, leaves);

  let run = 1; // boşalan günün kendisi
  let adim = 0;
  for (
    let c = addDays(startOfUtcDay(slot.date), -1);
    run <= limit + 1 && adim < 40 && !busy(c);
    c = addDays(c, -1)
  ) {
    adim += 1;
    if (!yokSay(c)) run += 1;
  }
  for (
    let c = addDays(startOfUtcDay(slot.date), 1);
    run <= limit + 1 && adim < 80 && !busy(c);
    c = addDays(c, 1)
  ) {
    adim += 1;
    if (!yokSay(c)) run += 1;
  }
  return run;
}

export default idleRunIfRemoved;
