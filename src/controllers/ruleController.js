import { asyncHandler } from '../utils/asyncHandler.js';
import { getRuleForUnit } from '../services/rules.js';
import Unit from '../models/Unit.js';
import { badRequest, notFound } from '../utils/HttpError.js';
import { isValidTime } from '../services/scheduler/shiftHours.js';

const EDITABLE = [
  'dayShiftStart',
  'dayShiftEnd',
  'dutyStart',
  'dutyEnd',
  'weekdayDayStaff',
  'weekdayDutyStaff',
  'weekendDayStaff',
  'weekendDutyStaff',
  'minRestDaysAfterDuty',
  'maxTightGapsPerMonth',
  'maxIdleDays',
  'minDutiesPerMonth',
  'maxDutiesPerMonth',
  'weekendFairnessWeight',
  'hoursFairnessWeight',
  'minWeeklyHours',
  'excludeOnLeave',
  'holidays',
  'useNationalHolidays',
];

const TIME_FIELDS = ['dayShiftStart', 'dayShiftEnd', 'dutyStart', 'dutyEnd'];

/** Birimin kural seti; kayıt yoksa varsayılanlarla oluşturulup döner. */
export const getRule = asyncHandler(async (req, res) => {
  const unit = await Unit.findById(req.params.unitId);
  if (!unit) throw notFound('Birim bulunamadı');
  res.json(await getRuleForUnit(unit._id));
});

export const updateRule = asyncHandler(async (req, res) => {
  const unit = await Unit.findById(req.params.unitId);
  if (!unit) throw notFound('Birim bulunamadı');

  const rule = await getRuleForUnit(unit._id);
  for (const field of EDITABLE) {
    if (req.body?.[field] === undefined) continue;
    if (TIME_FIELDS.includes(field) && !isValidTime(req.body[field])) {
      throw badRequest(`${field} 'SS:DD' biçiminde olmalı (ör. 08:00)`);
    }
    if (field === 'holidays') {
      const gunler = req.body.holidays;
      if (!Array.isArray(gunler) || gunler.some((g) => !/^\d{4}-\d{2}-\d{2}$/.test(String(g)))) {
        throw badRequest("holidays 'YYYY-AA-GG' biçiminde tarihlerden oluşan bir dizi olmalı");
      }
      rule.holidays = [...new Set(gunler.map(String))].sort();
      continue;
    }
    rule[field] = req.body[field];
  }
  await rule.save();

  res.json(rule);
});
