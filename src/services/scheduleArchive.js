import DutyAssignment from '../models/DutyAssignment.js';
import Schedule from '../models/Schedule.js';
import ScheduleArchive from '../models/ScheduleArchive.js';

/** Bir birim-dönem için saklanan en fazla kopya sayısı. */
export const MAX_ARCHIVES = 10;

/**
 * Listenin mevcut hâlini arşivler. Yıkıcı her işlemden (otomatik üretim,
 * listeyi boşaltma, geri alma) hemen önce çağrılır.
 *
 * Liste yoksa ya da tamamen boşsa kopya alınmaz — geri alınacak bir şey yoktur.
 */
export async function archiveSchedule(unitId, year, month, reason) {
  const schedule = await Schedule.findOne({ unit: unitId, year, month }).lean();
  if (!schedule) return null;

  const assignments = await DutyAssignment.find({ schedule: schedule._id })
    .sort({ date: 1, shiftType: 1, _id: 1 })
    .lean();

  const filledCount = assignments.filter((a) => a.employee).length;
  if (filledCount === 0) return null;

  const archive = await ScheduleArchive.create({
    unit: unitId,
    year,
    month,
    reason,
    status: schedule.status,
    filledCount,
    assignments: assignments.map((a) => ({
      date: a.date,
      employee: a.employee,
      shiftType: a.shiftType,
      flags: a.flags,
      manual: a.manual ?? false,
    })),
  });

  // Yalnızca son MAX_ARCHIVES kopya tutulur.
  const eskiler = await ScheduleArchive.find({ unit: unitId, year, month })
    .sort({ createdAt: -1 })
    .skip(MAX_ARCHIVES)
    .select('_id')
    .lean();
  if (eskiler.length > 0) {
    await ScheduleArchive.deleteMany({ _id: { $in: eskiler.map((e) => e._id) } });
  }

  return archive;
}

/** Bir birim-dönem için saklanan kopyalar, yenisi önce. */
export function listArchives(unitId, year, month) {
  return ScheduleArchive.find({ unit: unitId, year, month })
    .sort({ createdAt: -1 })
    .select('reason status filledCount createdAt')
    .lean();
}

/**
 * Kopyayı listeye geri yükler. Geri yüklemeden önce mevcut hâl de arşivlenir,
 * böylece geri alma işleminin kendisi de geri alınabilir.
 */
export async function restoreArchive(unitId, year, month, archiveId) {
  const archive = await ScheduleArchive.findOne({ _id: archiveId, unit: unitId, year, month });
  if (!archive) return null;

  await archiveSchedule(unitId, year, month, 'geri-alma');

  const schedule = await Schedule.findOneAndUpdate(
    { unit: unitId, year, month },
    { unit: unitId, year, month, status: archive.status ?? 'taslak' },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );

  await DutyAssignment.deleteMany({ schedule: schedule._id });
  await DutyAssignment.insertMany(
    archive.assignments.map((a) => ({
      schedule: schedule._id,
      date: a.date,
      employee: a.employee,
      shiftType: a.shiftType,
      flags: a.flags,
      manual: a.manual,
    }))
  );

  return schedule;
}
