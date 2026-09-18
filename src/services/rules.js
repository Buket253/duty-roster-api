import ShiftRule from '../models/ShiftRule.js';

/** Birimin kural seti; yoksa şema varsayılanlarıyla oluşturulur. */
export async function getRuleForUnit(unitId) {
  const existing = await ShiftRule.findOne({ unit: unitId });
  if (existing) return existing;
  return ShiftRule.create({ unit: unitId });
}
