import mongoose from 'mongoose';

const shiftRuleSchema = new mongoose.Schema(
  {
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true, unique: true },
    minRestHoursAfterDuty: { type: Number, default: 24, min: 0 },
    minDutiesPerMonth: { type: Number, default: 4, min: 0 },
    maxDutiesPerMonth: { type: Number, default: 7, min: 1 },
    maxConsecutiveDuties: { type: Number, default: 1, min: 1 },
    weekendFairnessWeight: { type: Number, default: 70, min: 0, max: 100 },
    excludeOnLeave: { type: Boolean, default: true },
    requireSeniorPairing: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('ShiftRule', shiftRuleSchema);
