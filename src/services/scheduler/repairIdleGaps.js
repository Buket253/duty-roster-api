import {
  addDays,
  daysInMonth,
  isoWeekKey,
  startOfUtcDay,
  toIsoDay,
  utcDate,
} from '../../utils/dates.js';
import {
  idOf,
  isOnLeaveDuringWeek,
  tightGapCount,
  tightGapCountWith,
  violationFor,
  yokSayilanGun,
} from './constraints.js';
import { isDailyDayStaff } from './staff.js';
import { shiftHours } from './shiftHours.js';

/**
 * Bekleme sınırını zorunlu kural olarak uygular.
 *
 * Açgözlü atama ve yerel arama bunu yalnızca tercih/ceza olarak gözetiyordu;
 * kural "must" olduğu için burada açık açık onarılır: sınırı aşan her boşlukta,
 * o boşluğa düşen bir güne ait bir slot, onu verebilecek birinden alınıp bekleyen
 * kişiye devredilir.
 *
 * Devir yalnızca şu koşullarda yapılır:
 *  - devralan kişi hard-constraint'leri sağlıyorsa,
 *  - devreden kişi her gün gelmesi gereken personel değilse (sadece-gündüz, sorumlu),
 *  - devreden kişinin kendisi bu yüzden sınırı aşmıyorsa,
 *  - devreden kişi bu yüzden haftalık saat alt sınırının altına düşmüyorsa.
 *
 * Kapasite el vermiyorsa (o günlerde hiç uygun slot yoksa) boşluk kalır ve
 * `warnings.idleExceeded` altında raporlanır.
 */
export function repairIdleGaps({ assignments, employees, leaves, rule, history = [], year, month }) {
  const sinir = rule.maxIdleDays ?? 3;
  const toplamGun = daysInMonth(year, month);
  const aktif = employees.filter((e) => e.active !== false);
  const byId = new Map(employees.map((e) => [idOf(e), e]));
  const withHistory = [...history, ...assignments];
  const saat = shiftHours(rule);
  const minHafta = rule.minWeeklyHours ?? 0;

  /** Kişinin ay boyunca toplam çalışma saati. */
  const toplamSaat = (employee) =>
    employee
      ? assignments
          .filter((a) => !a.history && idOf(a.employee) === idOf(employee))
          .reduce((sum, a) => sum + (saat[a.shiftType] ?? 0), 0)
      : 0;

  /** Kişinin verilen ISO haftasındaki toplam saati. */
  const haftaSaati = (employee, week) =>
    assignments
      .filter(
        (a) => !a.history && idOf(a.employee) === idOf(employee) && isoWeekKey(a.date) === week
      )
      .reduce((sum, a) => sum + (saat[a.shiftType] ?? 0), 0);

  /** Kişinin sınırı aşan ilk boşluğu: [ilkGun, sonGun] ya da null. */
  const ilkAsim = (employee, atla) => {
    const gelisler = new Set(
      assignments.filter((a) => idOf(a.employee) === idOf(employee)).map((a) => toIsoDay(a.date))
    );
    let bas = null;
    let sayac = 0;
    for (let g = 1; g <= toplamGun; g += 1) {
      const gun = utcDate(year, month, g);
      if (gelisler.has(toIsoDay(gun))) {
        bas = null;
        sayac = 0;
        continue;
      }
      if (atla(gun)) continue;
      if (sayac === 0) bas = gun;
      sayac += 1;
      if (sayac > sinir) return [bas, gun];
    }
    return null;
  };

  // Her turda bir boşluk kapatılır; ilerleme durunca bırakılır.
  for (let tur = 0; tur < aktif.length * (toplamGun + 1); tur += 1) {
    let onarildi = false;

    for (const employee of aktif) {
      const atla = yokSayilanGun(employee, rule, leaves);
      const asim = ilkAsim(employee, atla);
      if (!asim) continue;

      const [bas, son] = asim;
      // İki turda aranır: önce devredeni haftalık alt sınırın altına düşürmeyen
      // bir slot; bulunamazsa bu koruma gevşetilir. Bekleme sınırı zorunlu kural,
      // haftalık alt sınır ise hedeftir — çakıştıklarında zorunlu olan kazanır.
      for (const haftalikKoru of [true, false]) {
        if (onarildi) break;

        // Boşluğun içindeki günlerde, devredilebilecek bir slot ara.
        for (let gun = startOfUtcDay(bas); gun <= son && !onarildi; gun = addDays(gun, 1)) {
          if (atla(gun)) continue;

          // Sıralama iki ölçüte göre: önce gündüz mesaisi (nöbetler kategori
          // adaletini ve gün aşırı yapısını taşıdığı için onları devretmek dengeyi
          // daha çok bozar), sonra saati en çok olan sahipten al — böylece onarım
          // ay sonu saat dengesini bozmak yerine düzeltir.
          const oGun = assignments
            .filter((a) => toIsoDay(a.date) === toIsoDay(gun))
            .sort(
              (x, y) =>
                (x.shiftType === 'mesai-8' ? 0 : 1) - (y.shiftType === 'mesai-8' ? 0 : 1) ||
                toplamSaat(y.employee) - toplamSaat(x.employee)
            );

          const aday = oGun.find((a) => {
            if (idOf(a.employee) === idOf(employee)) return false;

            const sahip = a.employee ? byId.get(idOf(a.employee)) : null;
            // Her gün gelmesi gereken personelin slotu devredilemez.
            if (sahip && isDailyDayStaff(sahip, a.date)) return false;

            // Devralınan nöbet, devralanda gün aşırı aralık yaratmamalı: gün aşırı
            // son çaredir ve bekleme onarımı onu üretmemeli.
            if (
              a.shiftType === 'nobet-24' &&
              tightGapCountWith(idOf(employee), a.date, withHistory, rule, { ignore: a }) >
                tightGapCount(idOf(employee), withHistory, rule, { ignore: a })
            ) {
              return false;
            }

            // Devir, devredeni haftalık alt sınırın altına düşürüyorsa ilk turda
            // atlanır. (Kişi o hafta izinliyse saati zaten değerlendirilmez.)
            const week = isoWeekKey(a.date);
            if (
              haftalikKoru &&
              sahip &&
              minHafta > 0 &&
              !isOnLeaveDuringWeek(idOf(sahip), week, leaves) &&
              haftaSaati(sahip, week) - (saat[a.shiftType] ?? 0) < minHafta
            ) {
              return false;
            }

            return (
              violationFor(employee, a, {
                leaves,
                assignments: withHistory,
                rule,
                ignore: a,
                allowBackup: true,
              }) === null
            );
          });

          if (!aday) continue;

          const eski = aday.employee;
          const sahip = eski ? byId.get(idOf(eski)) : null;

          aday.employee = idOf(employee);
          aday.flags = [];

          // Devir, devredeni bekleme sınırının ötesine itiyorsa geri al.
          if (sahip && ilkAsim(sahip, yokSayilanGun(sahip, rule, leaves))) {
            aday.employee = eski;
            continue;
          }

          onarildi = true;
        }
      }

      if (onarildi) break;
    }

    if (!onarildi) break;
  }

  return assignments;
}

export default repairIdleGaps;
