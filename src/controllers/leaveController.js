import LeaveRequest from '../models/LeaveRequest.js';
import Employee from '../models/Employee.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/HttpError.js';
import { LEAVE_TYPES } from '../utils/constants.js';
import { startOfUtcDay } from '../utils/dates.js';

/** ?employee=:id ile tek kişinin, ?unit=:id ile birimin tüm izinleri. */
export const listLeaves = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.employee) filter.employee = req.query.employee;
  if (req.query.unit) {
    const employees = await Employee.find({ unit: req.query.unit }).select('_id').lean();
    filter.employee = { $in: employees.map((e) => e._id) };
  }

  res.json(
    await LeaveRequest.find(filter).populate('employee', 'name title unit').sort({ startDate: 1 })
  );
});

export const createLeave = asyncHandler(async (req, res) => {
  const { employee, startDate, endDate, type = 'yillik' } = req.body ?? {};
  if (!employee || !startDate || !endDate) throw badRequest('Çalışan, başlangıç ve bitiş tarihi zorunlu');
  if (!LEAVE_TYPES.includes(type)) throw badRequest(`İzin tipi ${LEAVE_TYPES.join(', ')} olmalı`);

  const start = startOfUtcDay(new Date(startDate));
  const end = startOfUtcDay(new Date(endDate));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw badRequest('Geçersiz tarih');
  if (end < start) throw badRequest('Bitiş tarihi başlangıçtan önce olamaz');

  res.status(201).json(await LeaveRequest.create({ employee, startDate: start, endDate: end, type }));
});

export const deleteLeave = asyncHandler(async (req, res) => {
  const leave = await LeaveRequest.findByIdAndDelete(req.params.id);
  if (!leave) throw notFound('İzin kaydı bulunamadı');
  res.json({ ok: true });
});
