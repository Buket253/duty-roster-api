import { DAY_MS } from './constants.js';

/** Yıl/ay/gün değerlerinden UTC gece yarısı Date üretir (saat dilimi kaymasını önler). */
export function utcDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Verilen Date'i UTC gece yarısına indirger. */
export function startOfUtcDay(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Ayın ilk gününü (dahil) ve takip eden ayın ilk gününü (hariç) döner. */
export function monthRange(year, month) {
  return {
    start: utcDate(year, month, 1),
    end: utcDate(year, month, daysInMonth(year, month) + 1),
  };
}

export function isWeekend(date) {
  const day = new Date(date).getUTCDay();
  return day === 0 || day === 6;
}

export function isWeekday(date) {
  return !isWeekend(date);
}

export function addDays(date, count) {
  return new Date(new Date(date).getTime() + count * DAY_MS);
}

export function diffDays(a, b) {
  return Math.round((startOfUtcDay(a).getTime() - startOfUtcDay(b).getTime()) / DAY_MS);
}

export function sameUtcDay(a, b) {
  return startOfUtcDay(a).getTime() === startOfUtcDay(b).getTime();
}

export function toIsoDay(date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

/** Pazartesi = 1 … Pazar = 7 (ISO). */
export function isoWeekday(date) {
  return new Date(date).getUTCDay() || 7;
}

export const isMonday = (date) => isoWeekday(date) === 1;

/**
 * Nöbet adaletinin dengelendiği dört kategoriden hangisi?
 * Cmt-Paz ve resmi tatiller 'hafta-sonu', Perşembe 'persembe', Cuma 'cuma',
 * Pzt-Çar 'hafta-ici'. Perşembe ve Cuma kendi içlerinde dengelenir.
 */
export function dutyCategory(date, holidays = null) {
  if (holidays?.has?.(toIsoDay(date))) return 'hafta-sonu';
  const day = isoWeekday(date);
  if (day >= 6) return 'hafta-sonu';
  if (day === 5) return 'cuma';
  if (day === 4) return 'persembe';
  return 'hafta-ici';
}

/** Tarihin içinde bulunduğu ISO haftasının Pazartesi'si — haftalık saat toplamı bunun üzerinden gruplanır. */
export function startOfIsoWeek(date) {
  return addDays(startOfUtcDay(date), -(isoWeekday(date) - 1));
}

export const isoWeekKey = (date) => toIsoDay(startOfIsoWeek(date));

/**
 * Ayın tamamını kapsayan ISO haftalarının anahtarları.
 * Ay başındaki/sonundaki yarım haftalar dışarıda bırakılır: o haftalarda kişinin
 * saatinin düşük olması kural ihlali değil, ayın kesildiği yerdir.
 */
export function fullWeekKeys(year, month) {
  const { start, end } = monthRange(year, month);
  const keys = new Set();
  for (let cursor = startOfIsoWeek(start); cursor < end; cursor = addDays(cursor, 7)) {
    if (cursor >= start && addDays(cursor, 7) <= end) keys.add(toIsoDay(cursor));
  }
  return keys;
}
