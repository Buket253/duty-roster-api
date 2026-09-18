import Unit from '../models/Unit.js';
import Employee from '../models/Employee.js';
import ShiftRule from '../models/ShiftRule.js';
import Schedule from '../models/Schedule.js';
import DutyAssignment from '../models/DutyAssignment.js';
import ShareLink from '../models/ShareLink.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/HttpError.js';
import { SHIFT_TYPES } from '../utils/constants.js';

const pickBody = ({ name, shiftTypes, minStaffPerDay, active }) => {
  const payload = {};
  if (name !== undefined) payload.name = name;
  if (shiftTypes !== undefined) {
    if (!Array.isArray(shiftTypes) || shiftTypes.some((t) => !SHIFT_TYPES.includes(t))) {
      throw badRequest(`shiftTypes yalnızca ${SHIFT_TYPES.join(', ')} değerlerini alabilir`);
    }
    payload.shiftTypes = shiftTypes;
  }
  if (minStaffPerDay !== undefined) payload.minStaffPerDay = minStaffPerDay;
  if (active !== undefined) payload.active = active;
  return payload;
};

/** Birim listesi; dashboard kartları için çalışan sayısıyla zenginleştirilir. */
export const listUnits = asyncHandler(async (req, res) => {
  const units = await Unit.find().sort({ name: 1 }).lean();
  const counts = await Employee.aggregate([
    { $match: { active: true } },
    { $group: { _id: '$unit', count: { $sum: 1 } } },
  ]);
  const byUnit = new Map(counts.map((c) => [String(c._id), c.count]));

  res.json(units.map((unit) => ({ ...unit, employeeCount: byUnit.get(String(unit._id)) ?? 0 })));
});

export const createUnit = asyncHandler(async (req, res) => {
  const payload = pickBody(req.body ?? {});
  if (!payload.name) throw badRequest('Birim adı zorunlu');

  const unit = await Unit.create(payload);
  await ShiftRule.create({ unit: unit._id });
  res.status(201).json(unit);
});

export const updateUnit = asyncHandler(async (req, res) => {
  const unit = await Unit.findByIdAndUpdate(req.params.id, pickBody(req.body ?? {}), {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!unit) throw notFound('Birim bulunamadı');
  res.json(unit);
});

/** Birimi ve ona bağlı tüm kayıtları (çalışan, kural, liste, atama, link) siler. */
export const deleteUnit = asyncHandler(async (req, res) => {
  const unit = await Unit.findById(req.params.id);
  if (!unit) throw notFound('Birim bulunamadı');

  const schedules = await Schedule.find({ unit: unit._id }).select('_id').lean();
  await DutyAssignment.deleteMany({ schedule: { $in: schedules.map((s) => s._id) } });
  await Schedule.deleteMany({ unit: unit._id });
  await Employee.deleteMany({ unit: unit._id });
  await ShiftRule.deleteOne({ unit: unit._id });
  await ShareLink.deleteOne({ unit: unit._id });
  await unit.deleteOne();

  res.json({ ok: true });
});
