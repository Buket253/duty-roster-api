import mongoose from 'mongoose';

const shareLinkSchema = new mongoose.Schema(
  {
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true, unique: true },
    token: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

export default mongoose.model('ShareLink', shareLinkSchema);
