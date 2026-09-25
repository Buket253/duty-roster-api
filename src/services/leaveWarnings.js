import { LEAVE_WARNINGS } from '../utils/constants.js';
import { addDays, isMonday, isoWeekday, sameUtcDay, toIsoDay } from '../utils/dates.js';
import { idOf } from './scheduler/constraints.js';

/**
 * İzin yerleşim kuralı: izin Pazartesi başlamalı, dönüş günü (bitişin ertesi) de
 * Pazartesi olmalı ve kişi izne girmeden önceki Perşembe nöbetini tutmuş olmalı.
 * Hiçbiri engelleyici değildir — yalnızca uyarı üretir.
 */
export function leaveWarnings(leaves, assignments = []) {
  return leaves
    .map((leave) => {
      const codes = [];
      const donus = addDays(leave.endDate, 1);

      if (!isMonday(leave.startDate)) codes.push(LEAVE_WARNINGS.START_NOT_MONDAY);
      if (!isMonday(donus)) codes.push(LEAVE_WARNINGS.RETURN_NOT_MONDAY);

      // Pazartesi başlayan izinlerde, hemen öncesindeki Perşembe nöbeti beklenir.
      if (isMonday(leave.startDate)) {
        const persembe = addDays(leave.startDate, -4);
        const tuttu = assignments.some(
          (a) =>
            a.shiftType === 'nobet-24' &&
            idOf(a.employee) === idOf(leave.employee) &&
            sameUtcDay(a.date, persembe)
        );
        if (!tuttu && isoWeekday(persembe) === 4) codes.push(LEAVE_WARNINGS.NO_THURSDAY_DUTY);
      }

      return {
        leave: String(leave._id),
        employee: idOf(leave.employee),
        name: leave.employee?.name ?? null,
        startDate: toIsoDay(leave.startDate),
        endDate: toIsoDay(leave.endDate),
        returnDate: toIsoDay(donus),
        warnings: codes,
      };
    })
    .filter((row) => row.warnings.length > 0);
}

export default leaveWarnings;
