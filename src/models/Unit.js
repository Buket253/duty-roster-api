import mongoose from 'mongoose';
import { SHIFT_TYPES } from '../utils/constants.js';

const unitSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    shiftTypes: [{ type: String, enum: SHIFT_TYPES }],
    minStaffPerDay: { type: Number, default: 1, min: 1 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Unit', unitSchema);
