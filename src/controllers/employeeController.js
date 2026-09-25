import Employee from '../models/Employee.js';
import LeaveRequest from '../models/LeaveRequest.js';
import DutyAssignment from '../models/DutyAssignment.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/HttpError.js';

const pickBody = ({ name, unit, title, staffType, canTakeDuty, dutyStartDate, active }) => {
  const payload = {};
  if (name !== undefined) payload.name = name;
  if (unit !== undefined) payload.unit = unit;
  if (title !== undefined) payload.title = title;
  if (staffType !== undefined) payload.staffType = staffType;
  if (canTakeDuty !== undefined) payload.canTakeDuty = canTakeDuty;
  if (dutyStartDate !== undefined) payload.dutyStartDate = dutyStartDate || null;
  if (active !== undefined) payload.active = active;
  return payload;
};

/** Her serviste en fazla bir sorumlu hemşire bulunabilir. */
const assertSingleCharge = async (unitId, { exclude = null } = {}) => {
  const filter = { unit: unitId, staffType: 'sorumlu' };
  if (exclude) filter._id = { $ne: exclude };
  const existing = await Employee.findOne(filter).lean();
  if (existing) {
    throw badRequest(`Bu birimde zaten bir sorumlu hemşire var: ${existing.name}`);
  }
};

export const listEmployees = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.unit) filter.unit = req.query.unit;
  res.json(await Employee.find(filter).sort({ name: 1 }));
});

export const createEmployee = asyncHandler(async (req, res) => {
  const payload = pickBody(req.body ?? {});
  if (!payload.name || !payload.unit) throw badRequest('Ad ve birim zorunlu');
  if (payload.staffType === 'sorumlu') await assertSingleCharge(payload.unit);
  res.status(201).json(await Employee.create(payload));
});

export const updateEmployee = asyncHandler(async (req, res) => {
  const current = await Employee.findById(req.params.id);
  if (!current) throw notFound('Çalışan bulunamadı');

  const payload = pickBody(req.body ?? {});
  if (payload.staffType === 'sorumlu' && current.staffType !== 'sorumlu') {
    await assertSingleCharge(payload.unit ?? current.unit, { exclude: current._id });
  }

  const employee = await Employee.findByIdAndUpdate(current._id, payload, {
    returnDocument: 'after',
    runValidators: true,
  });
  res.json(employee);
});

/** Çalışanı, izinlerini siler; mevcut atamalarını boşa düşürüp 'doldurulamadi' bırakır. */
export const deleteEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee) throw notFound('Çalışan bulunamadı');

  await LeaveRequest.deleteMany({ employee: employee._id });
  await DutyAssignment.updateMany(
    { employee: employee._id },
    { $set: { employee: null, flags: ['doldurulamadi'] } }
  );
  await employee.deleteOne();

  res.json({ ok: true });
});
