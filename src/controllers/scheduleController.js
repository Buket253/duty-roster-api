import Unit from '../models/Unit.js';
import Employee from '../models/Employee.js';
import Schedule from '../models/Schedule.js';
import DutyAssignment from '../models/DutyAssignment.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/HttpError.js';
import { generateSchedule, loadUnitContext } from '../services/scheduler/generateSchedule.js';
import { evaluateFlags, employeeStats, summarizeWarnings } from '../services/scheduler/flags.js';
import { explainCandidates } from '../services/scheduler/filterCandidates.js';

const parsePeriod = (req) => {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('Geçersiz yıl');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw badRequest('Geçersiz ay');
  return { year, month };
};

const findUnit = async (unitId) => {
  const unit = await Unit.findById(unitId).lean();
  if (!unit) throw notFound('Birim bulunamadı');
  return unit;
};

const loadAssignments = (scheduleId) =>
  DutyAssignment.find({ schedule: scheduleId })
    .populate('employee', 'name title active')
    .sort({ date: 1, shiftType: 1 })
    .lean();

/** Nöbet listesi ekranının ihtiyaç duyduğu tüm veri: liste, atamalar, ekip sayaçları, uyarılar. */
async function buildPayload(unit, year, month) {
  const { employees, leaves, rule } = await loadUnitContext(unit._id, year, month);
  const schedule = await Schedule.findOne({ unit: unit._id, year, month }).lean();
  const assignments = schedule ? await loadAssignments(schedule._id) : [];

  return {
    unit,
    year,
    month,
    schedule: schedule ?? null,
    rule,
    leaves,
    assignments,
    employees: employeeStats(employees, assignments, rule),
    warnings: summarizeWarnings(assignments, employees, rule),
  };
}

export const getSchedule = asyncHandler(async (req, res) => {
  const { year, month } = parsePeriod(req);
  const unit = await findUnit(req.params.unitId);
  res.json(await buildPayload(unit, year, month));
});

/** Algoritmayı çalıştırıp yeni taslak üretir; aynı dönem için varsa üzerine yazar. */
export const generate = asyncHandler(async (req, res) => {
  const { year, month } = parsePeriod(req);
  const unit = await findUnit(req.params.unitId);

  if (!unit.shiftTypes?.length) throw badRequest('Birim için vardiya tipi tanımlı değil');

  await generateSchedule(unit, year, month);
  res.json(await buildPayload(unit, year, month));
});

/** Manuel yeniden atama; kaydederken tüm listenin kural kontrolü yeniden çalışır. */
export const updateAssignment = asyncHandler(async (req, res) => {
  const assignment = await DutyAssignment.findById(req.params.assignmentId);
  if (!assignment) throw notFound('Atama bulunamadı');

  const schedule = await Schedule.findById(assignment.schedule);
  if (!schedule) throw notFound('Liste bulunamadı');

  if (req.body?.employee !== undefined) {
    if (req.body.employee === null || req.body.employee === '') {
      assignment.employee = null;
    } else {
      const employee = await Employee.findById(req.body.employee);
      if (!employee) throw notFound('Çalışan bulunamadı');
      if (String(employee.unit) !== String(schedule.unit)) {
        throw badRequest('Çalışan bu birime ait değil');
      }
      assignment.employee = employee._id;
    }
  }
  await assignment.save();

  const { leaves, rule } = await loadUnitContext(schedule.unit, schedule.year, schedule.month);
  const all = await loadAssignments(schedule._id);
  evaluateFlags(all, { leaves, rule });

  await DutyAssignment.bulkWrite(
    all.map((a) => ({ updateOne: { filter: { _id: a._id }, update: { $set: { flags: a.flags } } } }))
  );

  const unit = await findUnit(schedule.unit);
  res.json({
    ...(await buildPayload(unit, schedule.year, schedule.month)),
    updatedAssignment: all.find((a) => String(a._id) === String(assignment._id)),
  });
});

/** Bir slot için seçilebilecek çalışanlar + seçilemeyenlerin sebebi. */
export const assignmentCandidates = asyncHandler(async (req, res) => {
  const assignment = await DutyAssignment.findById(req.params.assignmentId).lean();
  if (!assignment) throw notFound('Atama bulunamadı');

  const schedule = await Schedule.findById(assignment.schedule).lean();
  if (!schedule) throw notFound('Liste bulunamadı');

  const { employees, leaves, rule } = await loadUnitContext(schedule.unit, schedule.year, schedule.month);
  const others = (await loadAssignments(schedule._id)).filter(
    (a) => String(a._id) !== String(assignment._id)
  );

  const { eligible, reasons } = explainCandidates(assignment, employees, leaves, others, rule);
  res.json({ eligible, reasons });
});

export const publish = asyncHandler(async (req, res) => {
  const schedule = await Schedule.findByIdAndUpdate(
    req.params.scheduleId,
    { status: 'yayinda' },
    { returnDocument: 'after' }
  );
  if (!schedule) throw notFound('Liste bulunamadı');
  res.json(schedule);
});
