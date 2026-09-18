import mongoose from 'mongoose';

const employeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true, index: true },
    title: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Employee', employeeSchema);
