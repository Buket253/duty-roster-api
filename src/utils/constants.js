export const SHIFT_TYPES = ['nobet-24', 'mesai-8'];
export const LEAVE_TYPES = ['yillik', 'rapor', 'mazeret'];
export const SCHEDULE_STATUSES = ['taslak', 'yayinda'];

export const FLAGS = {
  UNFILLED: 'doldurulamadi',
  CONSECUTIVE: 'ardisik-nobet',
  SHORT_REST: 'yetersiz-dinlenme',
  DOUBLE_BOOKED: 'cifte-atama',
  ON_LEAVE: 'izinli',
  OVER_LIMIT: 'limit-asildi',
};

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// Bir vardiyanın saat cinsinden süresi; dinlenme hesabı bitiş saatinden itibaren işler.
export const SHIFT_DURATION_HOURS = {
  'nobet-24': 24,
  'mesai-8': 8,
};
