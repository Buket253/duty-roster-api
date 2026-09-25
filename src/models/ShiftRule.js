import mongoose from 'mongoose';

const shiftRuleSchema = new mongoose.Schema(
  {
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true, unique: true },

    // --- Vardiya saatleri: her departmanın çalışma prensibi farklı olabilir ---
    // Bitiş başlangıca eşit ya da ondan küçükse vardiya ertesi güne sarkar.
    dayShiftStart: { type: String, default: '08:00' },
    dayShiftEnd: { type: String, default: '16:00' },
    dutyStart: { type: String, default: '08:00' },
    dutyEnd: { type: String, default: '08:00' },

    // --- Kadro / kapasite: hafta içi ve hafta sonu için ayrı ayrı ---
    weekdayDayStaff: { type: Number, default: 4, min: 0 },
    weekdayDutyStaff: { type: Number, default: 1, min: 0 },
    weekendDayStaff: { type: Number, default: 0, min: 0 },
    weekendDutyStaff: { type: Number, default: 1, min: 0 },

    // --- Dinlenme ve boşluk ---
    // Nöbetten sonra hiçbir vardiya verilmeyecek tam gün sayısı. 1 => ertesi gün boş.
    minRestDaysAfterDuty: { type: Number, default: 1, min: 0 },
    // Tam bu alt sınırda kalan ("gün aşırı") nöbet aralığının aylık üst sınırı.
    maxTightGapsPerMonth: { type: Number, default: 1, min: 0 },
    // Kişinin hiç vardiya almadan bekleyebileceği en fazla gün; aşacaksa öncelikli atanır.
    maxIdleDays: { type: Number, default: 3, min: 1 },

    // --- Aylık nöbet sınırları ---
    minDutiesPerMonth: { type: Number, default: 4, min: 0 },
    maxDutiesPerMonth: { type: Number, default: 7, min: 1 },

    // --- Adil dağıtım ---
    weekendFairnessWeight: { type: Number, default: 70, min: 0, max: 100 },
    hoursFairnessWeight: { type: Number, default: 50, min: 0, max: 100 },
    // Haftalık gündüz + nöbet saat toplamı için hedef alt sınır (boş slot varsa doldurulur).
    minWeeklyHours: { type: Number, default: 32, min: 0 },

    // Sabit resmi tatiller (29 Ekim, 23 Nisan, …) hazır gelir; kapatılabilir.
    useNationalHolidays: { type: Boolean, default: true },
    // Ek tatiller ('YYYY-AA-GG') — dinî bayramlar gibi kayan günler buraya girilir.
    // Tatillerde gündüz kadrosu açılmaz, yalnızca nöbetçi yazılır; nöbet
    // adaletinde hafta sonu sayılırlar.
    holidays: [{ type: String }],

    excludeOnLeave: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('ShiftRule', shiftRuleSchema);
