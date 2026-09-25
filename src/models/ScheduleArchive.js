import mongoose from 'mongoose';
import { SHIFT_TYPES } from '../utils/constants.js';

/**
 * Bir listenin üzerine yazılmadan önceki hâli.
 *
 * Otomatik üretim ve "Listeyi Boşalt" atamaları siliyor; bunlar geri alınamadığı
 * için elle girilmiş bir ay tek tıkla kaybedilebiliyordu. Yıkıcı her işlemden
 * önce mevcut atamalar buraya kopyalanır ve geri yüklenebilir.
 */
const archivedAssignmentSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    shiftType: { type: String, enum: SHIFT_TYPES, required: true },
    flags: [{ type: String }],
    manual: { type: Boolean, default: false },
  },
  { _id: false }
);

const scheduleArchiveSchema = new mongoose.Schema(
  {
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true, index: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    // Hangi işlem bu kopyayı aldı: 'otomatik-uretim' | 'listeyi-bosalt' | 'geri-alma'
    reason: { type: String, required: true },
    status: { type: String },
    // Kopya alındığı andaki dolu atama sayısı; listede seçim yapmayı kolaylaştırır.
    filledCount: { type: Number, default: 0 },
    assignments: [archivedAssignmentSchema],
  },
  { timestamps: true }
);

scheduleArchiveSchema.index({ unit: 1, year: 1, month: 1, createdAt: -1 });

export default mongoose.model('ScheduleArchive', scheduleArchiveSchema);
