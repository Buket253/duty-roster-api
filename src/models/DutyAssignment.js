import mongoose from 'mongoose';
import { SHIFT_TYPES } from '../utils/constants.js';

const dutyAssignmentSchema = new mongoose.Schema(
  {
    schedule: { type: mongoose.Schema.Types.ObjectId, ref: 'Schedule', required: true, index: true },
    date: { type: Date, required: true },
    // Uygun aday bulunamayan slotlar boş (null) kalır ve 'doldurulamadi' ile etiketlenir.
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    shiftType: { type: String, enum: SHIFT_TYPES, required: true },
    flags: [{ type: String }],
  },
  { timestamps: true }
);

export default mongoose.model('DutyAssignment', dutyAssignmentSchema);
