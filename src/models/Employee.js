import mongoose from 'mongoose';
import { STAFF_TYPES } from '../utils/constants.js';

const employeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true, index: true },
    title: { type: String, trim: true },
    staffType: { type: String, enum: STAFF_TYPES, default: 'standart' },
    // Yalnızca 'standart' tip için anlamlı; kapalıysa kişi gündüz rotasyonunda kalır
    // ama hiç nöbete yazılmaz. Diğer tipler zaten nöbet rotasyonuna girmez.
    canTakeDuty: { type: Boolean, default: true },
    // Yalnızca 'sadece-gunduz' tipi için: bu tarihten itibaren kişi nöbet
    // rotasyonuna katılır ve 'standart' gibi davranır. Boşsa statü süresizdir.
    dutyStartDate: { type: Date, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Employee', employeeSchema);
