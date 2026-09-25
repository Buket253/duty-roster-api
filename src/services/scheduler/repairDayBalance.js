import { DUTY_CATEGORIES } from '../../utils/constants.js';
import { idOf, violationFor } from './constraints.js';
import { idleRunIfRemoved } from './idleRun.js';
import { buildContext, fairnessCost } from './localSearch.js';
import { isDailyDayStaff } from './staff.js';

/**
 * Gündüz mesaisi sayılarını hedefli olarak eşitler.
 *
 * Yerel arama bunu tek başına yapamıyordu: son turda haftalık yük dengesi terimi
 * (ağırlık 45) gündüz sayısı teriminden çok daha güçlü, bu yüzden arama gündüz
 * sayısını bozan hamleleri kabul ediyordu. Ölçüldü (12 kişilik rotasyon, Ekim
 * 2026): açgözlü atama 6–8 aralığıyla başlıyor, ara dengeleme turu 7–7'ye kadar
 * indiriyor, son tur ise 5–9'a geri açıyordu.
 *
 * Bu geçiş rastgele değil: yalnızca sayı farkını gerçekten kapatan devirleri
 * dener ve aralarından TOPLAM maliyeti en az artıranı seçer. Böylece gündüz
 * sayısı aritmetik alt sınırına inerken haftalık denge, bekleme sınırı ve saat
 * adaleti mümkün olduğunca korunur.
 *
 * Eşitleme yalnızca nöbete giren personel arasında yapılır. Nöbete hiç girmeyen
 * kişi (nöbet anahtarı kapalı olan) ayını yalnızca 8 saatlik gündüzlerle
 * doldurmak zorundadır; ona da aynı gündüz sayısını dayatmak onu ayda 56 saate
 * düşürürdü. Onun gündüz sayısı, eskiden olduğu gibi saat adaleti ve haftalık
 * alt sınır terimleriyle belirlenir.
 *
 * Devir yalnızca şu koşullarda yapılır:
 *  - devralan kişi hard-constraint'leri sağlıyorsa,
 *  - iki taraf da her gün gelmesi gereken personel değilse (sadece-gündüz, sorumlu),
 *  - devreden kişi bu yüzden bekleme sınırını aşmıyorsa.
 */
export function repairDayBalance({
  assignments,
  employees,
  leaves,
  rule,
  history = [],
  shares,
  fullWeeks = null,
  enforceWeekly = false,
}) {
  if (!shares?.day) return assignments;

  const pay = (id) => shares.day.get(id) ?? 0;
  // Ay içinde bir noktada nöbet rotasyonuna giren personel: karşılaştırılabilir
  // yükü olanlar. Böyle kimse yoksa (yalnız gündüz çalışan bir servis) herkes
  // aynı durumdadır ve tüm gündüz rotasyonu birlikte değerlendirilir.
  const nobetli = (e) => DUTY_CATEGORIES.some((k) => (shares.duty?.[k]?.get(idOf(e)) ?? 0) > 0);
  const gunduzcu = employees.filter((e) => pay(idOf(e)) > 0);
  const grup = gunduzcu.filter(nobetli);
  const ids = (grup.length >= 2 ? grup : gunduzcu).map(idOf);
  if (ids.length < 2) return assignments;

  const byId = new Map(employees.map((e) => [idOf(e), e]));
  const withHistory = [...history, ...assignments];
  const maxIdle = rule.maxIdleDays ?? 3;

  const ctx = buildContext(employees, rule, shares, leaves, fullWeeks);
  const opts = { leaves, enforceIdle: true, enforceWeekly, balanceWeekly: true, fullWeeks, ctx };
  const maliyet = () => fairnessCost(assignments, employees, rule, shares, opts);

  const sayi = (id) =>
    assignments.filter((a) => !a.history && a.shiftType === 'mesai-8' && idOf(a.employee) === id)
      .length;

  const toplamPay = ids.reduce((sum, id) => sum + pay(id), 0);

  for (let tur = 0; tur < ids.length * 20; tur += 1) {
    const sayilar = new Map(ids.map((id) => [id, sayi(id)]));
    const toplamSayi = ids.reduce((sum, id) => sum + sayilar.get(id), 0);
    // Payına düşenden sapma: paylar eşitse bu, ortalamadan farktır.
    const sapma = (id) => sayilar.get(id) - (toplamSayi * pay(id)) / toplamPay;

    // Bir slotu d'den r'ye taşımak kareler toplamını ancak sapma farkı 1'i
    // aşıyorsa azaltır; eşit farkta taşımak dengeyi yalnızca ters yöne çevirir.
    const verenler = ids.filter((id) => sapma(id) > 0).sort((a, b) => sapma(b) - sapma(a));
    const alanlar = ids.filter((id) => sapma(id) < 0).sort((a, b) => sapma(a) - sapma(b));
    if (verenler.length === 0 || alanlar.length === 0) break;

    let enIyi = null;
    for (const veren of verenler) {
      const slotlar = assignments.filter(
        (a) => !a.history && a.shiftType === 'mesai-8' && idOf(a.employee) === veren
      );

      for (const alan of alanlar) {
        if (sapma(veren) - sapma(alan) <= 1 + 1e-9) continue;
        const alanKisi = byId.get(alan);
        if (!alanKisi) continue;

        for (const slot of slotlar) {
          if (isDailyDayStaff(alanKisi, slot.date)) continue;
          if (isDailyDayStaff(byId.get(veren), slot.date)) continue;
          // Devir, devredeni bekleme sınırının ötesine itmemeli.
          if (idleRunIfRemoved(byId.get(veren), slot, withHistory, maxIdle, rule, leaves) > maxIdle) {
            continue;
          }
          if (
            violationFor(alanKisi, slot, {
              leaves,
              assignments: withHistory,
              rule,
              ignore: slot,
              allowBackup: true,
            }) !== null
          ) {
            continue;
          }

          const eski = slot.employee;
          slot.employee = alan;
          const bedel = maliyet();
          slot.employee = eski;

          if (!enIyi || bedel < enIyi.bedel) enIyi = { slot, alan, bedel };
        }
      }
    }

    if (!enIyi) break;
    enIyi.slot.employee = enIyi.alan;
    enIyi.slot.flags = [];
  }

  return assignments;
}

export default repairDayBalance;
