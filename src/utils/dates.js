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
