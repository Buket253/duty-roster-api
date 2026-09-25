import { SHIFT_DURATION_HOURS } from '../../utils/constants.js';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 'HH:MM' -> gün başından itibaren dakika. Geçersizse null. */
export function parseTime(value) {
  const match = HHMM.exec(String(value ?? '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export const isValidTime = (value) => parseTime(value) !== null;

/**
 * İki saat arasındaki süre. Bitiş başlangıca eşit ya da ondan küçükse vardiya
 * ertesi güne sarkar (ör. 16:00 → 08:00 = 16 saat; 08:00 → 08:00 = 24 saat).
 */
export function durationHours(start, end) {
  const a = parseTime(start);
  const b = parseTime(end);
  if (a === null || b === null) return null;
  const dakika = b > a ? b - a : b - a + 24 * 60;
  return dakika / 60;
}

/**
 * Birimin vardiya süreleri, kural setindeki saatlerden türetilir.
 * Her departmanın çalışma prensibi farklı olabilir; saatler tanımlı değilse
 * (eski kayıtlar) şemadaki klasik 8/24 değerlerine düşülür.
 */
export function shiftHours(rule) {
  return {
    'mesai-8': durationHours(rule?.dayShiftStart, rule?.dayShiftEnd) ?? SHIFT_DURATION_HOURS['mesai-8'],
    'nobet-24': durationHours(rule?.dutyStart, rule?.dutyEnd) ?? SHIFT_DURATION_HOURS['nobet-24'],
  };
}

/** Bir atamanın kural setine göre saat karşılığı. */
export const hoursOfWith = (assignment, rule) => shiftHours(rule)[assignment.shiftType] ?? 0;

export default shiftHours;
