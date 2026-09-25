/**
 * Türkiye'nin sabit tarihli resmi tatilleri.
 *
 * Dinî bayramlar (Ramazan, Kurban) ay takvimine göre kaydığı için burada yer
 * almaz; onlar kural setindeki `holidays` listesine elle eklenir. Buradaki
 * günler her yıl aynı tarihe denk geldiği için güvenle üretilebilir.
 */
export const SABIT_RESMI_TATILLER = [
  { ay: 1, gun: 1, ad: 'Yılbaşı' },
  { ay: 4, gun: 23, ad: 'Ulusal Egemenlik ve Çocuk Bayramı' },
  { ay: 5, gun: 1, ad: 'Emek ve Dayanışma Günü' },
  { ay: 5, gun: 19, ad: "Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
  { ay: 7, gun: 15, ad: 'Demokrasi ve Millî Birlik Günü' },
  { ay: 8, gun: 30, ad: 'Zafer Bayramı' },
  { ay: 10, gun: 29, ad: 'Cumhuriyet Bayramı' },
];

const iki = (n) => String(n).padStart(2, '0');

/** Verilen yılın sabit resmi tatilleri: [{ date: 'YYYY-AA-GG', ad }]. */
export function nationalHolidays(year) {
  return SABIT_RESMI_TATILLER.map(({ ay, gun, ad }) => ({
    date: `${year}-${iki(ay)}-${iki(gun)}`,
    ad,
  }));
}

/** Tatil adı; bilinmeyen tarihlerde null. */
export function holidayName(iso) {
  const [, ay, gun] = String(iso).split('-').map(Number);
  return SABIT_RESMI_TATILLER.find((h) => h.ay === ay && h.gun === gun)?.ad ?? null;
}

// Uygulamanın makul ömrünü kapsayan aralık; tarih başına yıl taşımaktan kurtarır.
const YIL_ARALIGI = { bas: 2024, son: 2040 };

/** Aralıktaki tüm yılların sabit resmi tatilleri, tek Set. */
export const TUM_RESMI_TATILLER = new Set(
  Array.from({ length: YIL_ARALIGI.son - YIL_ARALIGI.bas + 1 }, (_, i) => YIL_ARALIGI.bas + i)
    .flatMap((y) => nationalHolidays(y))
    .map((h) => h.date)
);
