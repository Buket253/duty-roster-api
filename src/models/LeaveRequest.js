import mongoose from 'mongoose';
import { LEAVE_TYPES } from '../utils/constants.js';

const leaveRequestSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    type: { type: String, enum: LEAVE_TYPES, default: 'yillik' },
  },
  { timestamps: true }
);

export default mongoose.model('LeaveRequest', leaveRequestSchema);
