import { asyncHandler } from '../utils/asyncHandler.js';
import { getRuleForUnit } from '../services/rules.js';
import Unit from '../models/Unit.js';
import { notFound } from '../utils/HttpError.js';

const EDITABLE = [
  'minRestHoursAfterDuty',
  'minDutiesPerMonth',
  'maxDutiesPerMonth',
  'maxConsecutiveDuties',
  'weekendFairnessWeight',
  'excludeOnLeave',
  'requireSeniorPairing',
];

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
    if (req.body?.[field] !== undefined) rule[field] = req.body[field];
  }
  await rule.save();

  res.json(rule);
});
