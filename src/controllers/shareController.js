import crypto from 'node:crypto';
import Unit from '../models/Unit.js';
import ShareLink from '../models/ShareLink.js';
import Schedule from '../models/Schedule.js';
import DutyAssignment from '../models/DutyAssignment.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/HttpError.js';
import { daysInMonth, toIsoDay, utcDate } from '../utils/dates.js';

/** Birimin paylaşım linki; yoksa üretilir, varsa aynısı döner. */
export const getShareLink = asyncHandler(async (req, res) => {
  const unit = await Unit.findById(req.params.unitId).lean();
  if (!unit) throw notFound('Birim bulunamadı');

  let link = await ShareLink.findOne({ unit: unit._id });
  if (!link) {
    link = await ShareLink.create({ unit: unit._id, token: crypto.randomBytes(16).toString('hex') });
  }

  const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  res.json({ token: link.token, url: `${base}/paylasim/${link.token}` });
});

/**
 * Auth gerektirmeyen salt-okunur görünüm.
 * Yalnızca status 'yayinda' olan liste döner; taslak asla görünmez.
 */
export const publicSchedule = asyncHandler(async (req, res) => {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw badRequest('Geçersiz dönem');
  }

  const link = await ShareLink.findOne({ token: req.params.token }).lean();
  if (!link) throw notFound('Paylaşım linki geçersiz');

  const unit = await Unit.findById(link.unit).lean();
  if (!unit) throw notFound('Birim bulunamadı');

  const schedule = await Schedule.findOne({ unit: unit._id, year, month, status: 'yayinda' }).lean();
  if (!schedule) throw notFound('Bu dönem için yayınlanmış bir liste yok');

  const assignments = await DutyAssignment.find({ schedule: schedule._id })
    .populate('employee', 'name title')
    .sort({ date: 1 })
    .lean();

  const byDay = new Map();
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    byDay.set(toIsoDay(utcDate(year, month, day)), { date: toIsoDay(utcDate(year, month, day)), nobet: [], mesai: [] });
  }
  for (const a of assignments) {
    const entry = byDay.get(toIsoDay(a.date));
    if (!entry) continue;
    const person = a.employee ? { name: a.employee.name, title: a.employee.title } : null;
    entry[a.shiftType === 'nobet-24' ? 'nobet' : 'mesai'].push(person);
  }

  res.json({
    unit: { name: unit.name },
    year,
    month,
    publishedAt: schedule.updatedAt,
    days: [...byDay.values()],
  });
});
