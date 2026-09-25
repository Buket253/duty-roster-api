import { isoWeekKey } from '../../utils/dates.js';
import { idOf, isOnLeaveDuringWeek, violationFor } from './constraints.js';
import { idleRunIfRemoved } from './idleRun.js';
import { shiftHours } from './shiftHours.js';
import { isDailyDayStaff, isDayRotation } from './staff.js';

/**
 * Haftalık saat hedefi bu kadroyla ulaşılabilir mi?
 *
 * Tam haftalardaki toplam slot saati, o haftalarda çalışabilecek kişi sayısına
 * bölündüğünde alt sınırın altında kalıyorsa hedef aritmetik olarak imkânsızdır.
 */
export function weeklyTargetFeasible({ assignments, employees, rule, fullWeeks, leaves }) {
  const min = rule.minWeeklyHours ?? 0;
  const saat = shiftHours(rule);
  const rotasyon = employees.filter((e) => e.active !== false && !isDailyDayStaff(e, null));

  const gunlukKadro = new Set(
    employees.filter((e) => isDailyDayStaff(e, null)).map((e) => idOf(e))
  );

  for (const week of fullWeeks) {
    // Rotasyona kalan kapasite: her gün gelen personelin aldığı slotlar düşülür,
    // onlar zaten sabit ve havuzun dışındadır.
    const toplamSaat = assignments
      .filter(
        (a) => !a.history && isoWeekKey(a.date) === week && !gunlukKadro.has(idOf(a.employee))
      )
      .reduce((sum, a) => sum + (saat[a.shiftType] ?? 0), 0);

    const kisi = rotasyon.filter((e) => !isOnLeaveDuringWeek(idOf(e), week, leaves)).length;
    if (kisi > 0 && toplamSaat / kisi < min) return false;
  }
  return true;
}

/** Kişinin verilen ISO haftasındaki toplam saati. */
function weekHours(employeeId, week, assignments, rule) {
  const saat = shiftHours(rule);
  return assignments
    .filter((a) => !a.history && idOf(a.employee) === idOf(employeeId) && isoWeekKey(a.date) === week)
    .reduce((sum, a) => sum + (saat[a.shiftType] ?? 0), 0);
}

/**
 * Haftalık alt sınırın altında kalanları hedefli olarak yukarı çeker.
 *
 * Açgözlü atama gün gün ilerlediği için haftanın başında kimin açık kalacağını
 * göremez; bu geçiş ay tamamlandıktan sonra, her tam hafta için eksik kalan kişiye
 * o haftadaki bir gündüz slotunu devreder. Yalnızca:
 *   - boş slotlar, ya da slotu bırakınca kendisi alt sınırın altına düşmeyecek
 *     ve devredene göre daha çok saati olan kişilerin slotları,
 *   - hard-constraint'leri ihlal etmeyen devirler
 * kabul edilir. Nöbetler dokunulmaz — onlar kategori adaletini taşıyor.
 * Her gün gündüze gelen personelin (sadece-gündüz, sorumlu) slotları da sabittir.
 */
export function repairWeeklyHours({ assignments, employees, leaves, rule, history = [], fullWeeks }) {
  const min = rule.minWeeklyHours ?? 0;
  if (!min || !fullWeeks?.size) return assignments;
  // Hedef kadroya göre ulaşılamıyorsa bu geçiş yalnızca gürültü üretir: slotları
  // muhtaçtan muhtaca taşıyıp hiçbir açığı kapatmadan ay sonu dengesini bozar.
  // Ölçüldü: 12 kişilik bir serviste saat farkını 24'ten 40'a çıkarıyordu.
  if (!weeklyTargetFeasible({ assignments, employees, rule, fullWeeks, leaves })) return assignments;
  const maxIdle = rule.maxIdleDays ?? 3;
  const saat = shiftHours(rule);

  const byId = new Map(employees.map((e) => [idOf(e), e]));
  const aktif = employees.filter((e) => e.active !== false);
  const withHistory = [...history, ...assignments];

  for (const week of fullWeeks) {
    const haftaSlotlari = assignments.filter(
      (a) => !a.history && a.shiftType === 'mesai-8' && isoWeekKey(a.date) === week
    );
    if (haftaSlotlari.length === 0) continue;

    // Her turda en çok açığı olan bir kişiyi doyurmaya çalış; ilerleme durunca bırak.
    for (let tur = 0; tur < aktif.length * 2; tur += 1) {
      const eksikler = aktif
        // Statü tarihe bağlı olabildiği için rotasyon üyeliği hafta başına bakılır.
        .filter((e) => isDayRotation(e, new Date(`${week}T00:00:00.000Z`)))
        // O hafta izinli olan kişi zaten çizelge dışıdır; saati değerlendirilmez.
        .filter((e) => !isOnLeaveDuringWeek(idOf(e), week, leaves))
        .map((e) => ({ employee: e, açık: min - weekHours(e, week, assignments, rule) }))
        .filter((r) => r.açık > 0)
        .sort((a, b) => b.açık - a.açık || String(a.employee.name).localeCompare(String(b.employee.name), 'tr'));

      if (eksikler.length === 0) break;

      let devredildi = false;
      for (const { employee } of eksikler) {
        const slot = haftaSlotlari.find((a) => {
          if (idOf(a.employee) === idOf(employee)) return false;

          const sahip = a.employee ? byId.get(idOf(a.employee)) : null;
          if (sahip) {
            // Her gün gelmesi gereken personelin slotu devredilemez.
            if (isDailyDayStaff(sahip, a.date)) return false;
            const sahipSaat = weekHours(sahip, week, assignments, rule);
            if (sahipSaat - (saat[a.shiftType] ?? 0) < min) return false;
            if (sahipSaat <= weekHours(employee, week, assignments, rule)) return false;
            // Devir, sahibi boşluk sınırının ötesine itmemeli.
            if (idleRunIfRemoved(sahip, a, withHistory, maxIdle, rule, leaves) > maxIdle) return false;
          }

          return (
            violationFor(employee, a, { leaves, assignments: withHistory, rule, ignore: a }) === null
          );
        });

        if (slot) {
          slot.employee = idOf(employee);
          slot.flags = [];
          devredildi = true;
          break;
        }
      }

      if (!devredildi) break;
    }
  }

  return assignments;
}

export default repairWeeklyHours;
