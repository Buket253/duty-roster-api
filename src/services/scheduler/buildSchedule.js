import { buildSlots } from './buildSlots.js';
import { assignDayShifts, assignDuties } from './greedyAssign.js';
import { availabilityShares, localSearch } from './localSearch.js';
import { repairWeeklyHours, weeklyTargetFeasible } from './repairWeeklyHours.js';
import { repairIdleGaps } from './repairIdleGaps.js';
import { repairDayBalance } from './repairDayBalance.js';
import { evaluateFlags } from './flags.js';
import { fullWeekKeys } from '../../utils/dates.js';

/**
 * Tüm üretim hattı, veritabanından bağımsız. generateSchedule bunu çağırıp
 * sonucu kalıcılaştırır; testler aynı hattı doğrudan kullanır.
 *
 * Nöbet dengelemesi gündüz mesaisi yerleşmeden ÖNCE yapılır. Sebep: bir nöbeti
 * başka birine devretmek, o kişinin komşu gündeki gündüz mesaisiyle dinlenme
 * kuralını çiğniyordu; gündüzler henüz yokken neredeyse her takas uygulanabilir
 * oluyor ve kategori adaleti gerçekten optimize edilebiliyor.
 */
export function buildSchedule({
  shiftTypes,
  year,
  month,
  employees,
  leaves,
  rule,
  history = [],
  iterations = 20000,
  random,
}) {
  const slots = buildSlots({ shiftTypes }, year, month, rule);
  const fullWeeks = fullWeekKeys(year, month);
  // Adalet payları bir kez hesaplanır: ay ortasında nöbete başlayan ya da izinli
  // olan kişi yarım ayda tam yük taşımasın.
  const shares = availabilityShares({ employees, leaves, rule, year, month });
  const ortak = { employees, leaves, rule, history };

  // 1) Nöbetler + yalnızca nöbet takaslarıyla kategori adaleti.
  const duties = assignDuties({ slots, ...ortak, shares });
  const balancedDuties = localSearch({
    assignments: duties,
    ...ortak,
    shares,
    types: ['nobet-24'],
    iterations,
    random,
  });

  // 2) Gündüz mesaisi + yalnızca mesai takaslarıyla gündüz ve saat dengesi.
  const all = assignDayShifts({
    slots,
    ...ortak,
    shares,
    duties: balancedDuties,
    year,
    month,
    shiftTypes,
  });
  const balanced = localSearch({
    assignments: all,
    ...ortak,
    shares,
    types: ['mesai-8'],
    // Tüm vardiyalar yerleşti: bekleme sınırı artık ölçülebilir.
    enforceIdle: true,
    iterations,
    random,
  });

  // 3) Kalan haftalık saat açıklarını hedefli kapat (hedef ulaşılabilirse).
  repairWeeklyHours({ assignments: balanced, ...ortak, fullWeeks });
  const haftalikUlasilabilir = weeklyTargetFeasible({
    assignments: balanced,
    employees,
    rule,
    fullWeeks,
    leaves,
  });

  // 4) Bekleme sınırı zorunlu kuraldır: kalan aşımları açıkça onar.
  repairIdleGaps({ assignments: balanced, ...ortak, year, month });

  // 5) Son dengeleme. Onarım geçişleri slotları muhtaç kişilere devrederken ay
  // sonu toplam saatlerini bozabiliyor ve arka arkaya çalışma kümeleri
  // oluşturabiliyor. Bu tur ikisini de toparlar; bekleme, haftalık alt sınır ve
  // küme cezaları açık olduğu için kazanılanları geri bozmaz.
  const son = localSearch({
    assignments: balanced,
    ...ortak,
    shares,
    types: ['mesai-8'],
    enforceIdle: true,
    // Alt sınır ancak ulaşılabilirse kovalanır; yük dengesi her koşulda aranır.
    enforceWeekly: haftalikUlasilabilir,
    balanceWeekly: true,
    fullWeeks,
    iterations,
    random,
  });

  // 6) Dengeleme yine de bir boşluk açtıysa son kez onar; kural tavizsizdir.
  repairIdleGaps({ assignments: son, ...ortak, year, month });

  // 7) Gündüz mesaisi sayılarını hedefli olarak eşitle. En sonda durmasının sebebi
  // ölçüm: son yerel arama turu haftalık denge terimi (45) uğruna gündüz sayısını
  // 7–7'den 5–9'a açıyordu. Bu geçiş yalnızca farkı kapatan devirleri dener ve
  // aralarından toplam maliyeti en az bozanı seçer, böylece kazanılanı korur.
  repairDayBalance({
    assignments: son,
    ...ortak,
    shares,
    fullWeeks,
    enforceWeekly: haftalikUlasilabilir,
  });

  evaluateFlags(son, { leaves, rule, employees, history });

  return son;
}

export default buildSchedule;
