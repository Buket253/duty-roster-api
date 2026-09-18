import Employee from '../models/Employee.js';
import LeaveRequest from '../models/LeaveRequest.js';
import DutyAssignment from '../models/DutyAssignment.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/HttpError.js';

const pickBody = ({ name, unit, title, active }) => {
  const payload = {};
  if (name !== undefined) payload.name = name;
  if (unit !== undefined) payload.unit = unit;
  if (title !== undefined) payload.title = title;
  if (active !== undefined) payload.active = active;
  return payload;
};

export const listEmployees = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.unit) filter.unit = req.query.unit;
  res.json(await Employee.find(filter).sort({ name: 1 }));
});

export const createEmployee = asyncHandler(async (req, res) => {
  const payload = pickBody(req.body ?? {});
  if (!payload.name || !payload.unit) throw badRequest('Ad ve birim zorunlu');
  res.status(201).json(await Employee.create(payload));
});

export const updateEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findByIdAndUpdate(req.params.id, pickBody(req.body ?? {}), {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!employee) throw notFound('Çalışan bulunamadı');
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
