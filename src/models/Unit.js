import mongoose from 'mongoose';
import { SHIFT_TYPES } from '../utils/constants.js';

const unitSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    shiftTypes: [{ type: String, enum: SHIFT_TYPES }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Unit', unitSchema);
