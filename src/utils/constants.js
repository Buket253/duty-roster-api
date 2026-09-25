export const SHIFT_TYPES = ['nobet-24', 'mesai-8'];
export const LEAVE_TYPES = ['yillik', 'rapor', 'mazeret'];
export const SCHEDULE_STATUSES = ['taslak', 'yayinda'];

/**
 * Personel tipleri:
 *  - standart      : hem gündüz mesaisine hem nöbete girer, adil rotasyona dahildir.
 *  - sadece-gunduz : nöbete hiç girmez, gündüz mesaisi öngörülen her gün otomatik yazılır.
 *  - sorumlu       : serviste 1 kişi; her gün gündüzdedir, nöbet yalnızca başka aday
 *                    kalmadığında yedek olarak kendisine verilir.
 */
export const STAFF_TYPES = ['standart', 'sadece-gunduz', 'sorumlu'];

/** Her gün gündüz mesaisine gelen, adil rotasyonun dışında tutulan tipler. */
export const DAILY_DAY_STAFF_TYPES = ['sadece-gunduz', 'sorumlu'];

/**
 * Nöbet adaleti bu dört kategoride ayrı ayrı dengelenir.
 * Perşembe ve Cuma kendi içlerinde değerlendirilir (birlikte değil): izin öncesi
 * nöbet bu günlere denk geldiği için yükleri hem birbirinden hem de diğer hafta
 * içi günlerinden farklı dağılır. Resmi tatiller 'hafta-sonu' sayılır.
 */
export const DUTY_CATEGORIES = ['hafta-ici', 'persembe', 'cuma', 'hafta-sonu'];

export const FLAGS = {
  UNFILLED: 'doldurulamadi',
  SHORT_REST: 'yetersiz-dinlenme',
  TIGHT_GAP: 'gun-asiri-limit',
  DOUBLE_BOOKED: 'cifte-atama',
  ON_LEAVE: 'izinli',
  OVER_LIMIT: 'limit-asildi',
  NO_DUTY: 'nobete-giremez',
  BACKUP_USED: 'sorumlu-yedek',
};

/** İzin kuralı ihlalleri; atamaya değil izin kaydına iliştirilir, engellemez. */
export const LEAVE_WARNINGS = {
  START_NOT_MONDAY: 'izin-pazartesi-baslamiyor',
  RETURN_NOT_MONDAY: 'donus-pazartesi-degil',
  NO_THURSDAY_DUTY: 'izin-oncesi-persembe-nobeti-yok',
};

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// Bir vardiyanın saat cinsinden süresi; dinlenme hesabı bitiş saatinden itibaren işler.
export const SHIFT_DURATION_HOURS = {
  'nobet-24': 24,
  'mesai-8': 8,
};
