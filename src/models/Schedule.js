import mongoose from 'mongoose';
import { SCHEDULE_STATUSES } from '../utils/constants.js';

const scheduleSchema = new mongoose.Schema(
  {
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    status: { type: String, enum: SCHEDULE_STATUSES, default: 'taslak' },
    generatedAt: { type: Date },
  },
  { timestamps: true }
);

scheduleSchema.index({ unit: 1, year: 1, month: 1 }, { unique: true });

export default mongoose.model('Schedule', scheduleSchema);
