import Unit from '../models/Unit.js';
import Employee from '../models/Employee.js';
import Schedule from '../models/Schedule.js';
import DutyAssignment from '../models/DutyAssignment.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/HttpError.js';
import { FLAGS, SHIFT_TYPES } from '../utils/constants.js';
import { generateSchedule, loadUnitContext } from '../services/scheduler/generateSchedule.js';
import { buildSlots } from '../services/scheduler/buildSlots.js';
import { evaluateFlags, employeeStats, puantaj, summarizeWarnings } from '../services/scheduler/flags.js';
import { leaveWarnings } from '../services/leaveWarnings.js';
import { explainCandidates } from '../services/scheduler/filterCandidates.js';
import { dutyCategory } from '../utils/dates.js';
import { holidaySet } from '../services/scheduler/calendar.js';
import { archiveSchedule, listArchives, restoreArchive } from '../services/scheduleArchive.js';
import { holidayName } from '../utils/holidays.js';

/** Ayın tatil günleri, adlarıyla. */
const monthHolidays = (rule, year, month) => {
  const onek = `${year}-${String(month).padStart(2, '0')}-`;
  return [...holidaySet(rule)]
    .filter((g) => g.startsWith(onek))
    .sort()
    .map((date) => ({ date, name: holidayName(date) }));
};

const parsePeriod = (req) => {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('Geçersiz yıl');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw badRequest('Geçersiz ay');
  return { year, month };
};

const findUnit = async (unitId) => {
  const unit = await Unit.findById(unitId).lean();
  if (!unit) throw notFound('Birim bulunamadı');
  return unit;
};

/**
 * Sıralamanın son anahtarı _id: slotlar tek insertMany ile yazıldığı için
 * createdAt değerleri aynı milisaniyeye düşüyor ve eşitlik durumunda Mongo'nun
 * döndürdüğü sıra garantisiz oluyordu. Bu, ekranda bir slota atanan kişinin
 * sonraki yüklemede başka satırda görünmesine yol açıyordu. ObjectId artan
 * ürediği için _id hem kararlı hem de oluşturma sırasını koruyor.
 */
const loadAssignments = (scheduleId) =>
  DutyAssignment.find({ schedule: scheduleId })
    .populate('employee', 'name title active')
    .sort({ date: 1, shiftType: 1, manual: 1, _id: 1 })
    .lean();

/**
 * Listedeki tüm atamaların kural kontrolünü yeniden çalıştırıp flag'leri yazar.
 *
 * Yüklenen bağlamı ve atamaları da döner: çağıran buildPayload'a geçirip aynı
 * sorguları ikinci kez çalıştırmaktan kurtulur. Elle atama sırasında birim
 * bağlamı ve atamalar iki kez okunuyordu; uzak veritabanında bu, her seçimde
 * saniyelerce gecikme demekti.
 */
async function reevaluate(schedule) {
  const context = await loadUnitContext(schedule.unit, schedule.year, schedule.month);
  const { employees, leaves, rule, history } = context;
  const all = await loadAssignments(schedule._id);
  evaluateFlags(all, { leaves, rule, employees, history });

  await DutyAssignment.bulkWrite(
    all.map((a) => ({ updateOne: { filter: { _id: a._id }, update: { $set: { flags: a.flags } } } }))
  );
  return { all, context };
}

/** Nöbet listesi ekranının ihtiyaç duyduğu tüm veri: liste, atamalar, ekip sayaçları, uyarılar. */
async function buildPayload(unit, year, month, onceden = {}) {
  const { employees, leaves, rule } =
    onceden.context ?? (await loadUnitContext(unit._id, year, month));
  const schedule =
    onceden.schedule ?? (await Schedule.findOne({ unit: unit._id, year, month }).lean());
  const assignments =
    onceden.assignments ?? (schedule ? await loadAssignments(schedule._id) : []);

  return {
    unit,
    year,
    month,
    schedule: schedule ?? null,
    rule,
    leaves,
    assignments,
    employees: employeeStats(employees, assignments, rule, { year, month }),
    warnings: summarizeWarnings(assignments, employees, rule, { year, month, leaves }),
    puantaj: puantaj(employees, assignments, rule, { year, month, leaves }),
    // O aya düşen fiilî tatiller (sabit resmi tatiller + kural setine eklenenler);
    // takvim bunları işaretler.
    holidays: monthHolidays(rule, year, month),
    leaveWarnings: leaveWarnings(leaves, assignments),
  };
}

export const getSchedule = asyncHandler(async (req, res) => {
  const { year, month } = parsePeriod(req);
  const unit = await findUnit(req.params.unitId);
  res.json(await buildPayload(unit, year, month));
});

/** Algoritmayı çalıştırıp yeni taslak üretir; aynı dönem için varsa üzerine yazar. */
export const generate = asyncHandler(async (req, res) => {
  const { year, month } = parsePeriod(req);
  const unit = await findUnit(req.params.unitId);

  if (!unit.shiftTypes?.length) throw badRequest('Birim için vardiya tipi tanımlı değil');

  // Üretim mevcut atamaları siler; öncesinde geri alınabilir bir kopya bırak.
  await archiveSchedule(unit._id, year, month, 'otomatik-uretim');
  await generateSchedule(unit, year, month);
  res.json(await buildPayload(unit, year, month));
});

/**
 * Elle doldurulacak boş liste. Kadro kadar slot açar, hepsini boş bırakır.
 *
 * Otomasyona geçilen ilk aydan önceki ayı sisteme girmek için gerekir: ay geçişi
 * kuralları (dinlenme, gün aşırı, bekleme) önceki ayın son haftasına baktığı için
 * ilk otomatik ay ancak bir önceki ay kayıtlıysa doğru çıkar.
 *
 * Dolu bir listenin üzerine kazara yazmaz; bilerek boşaltmak için `?force=1`
 * gerekir (ekranda onay sorulur).
 */
export const createBlank = asyncHandler(async (req, res) => {
  const { year, month } = parsePeriod(req);
  const unit = await findUnit(req.params.unitId);

  if (!unit.shiftTypes?.length) throw badRequest('Birim için vardiya tipi tanımlı değil');

  // Tamamı boş bir liste yeniden kurulabilir (ör. kadro değişti); dolu olan
  // yalnızca açık istekle boşaltılır.
  const force = req.query.force === '1' || req.query.force === 'true';
  const mevcut = await Schedule.findOne({ unit: unit._id, year, month }).lean();
  if (mevcut && !force) {
    const dolu = await DutyAssignment.countDocuments({
      schedule: mevcut._id,
      employee: { $ne: null },
    });
    if (dolu > 0) {
      throw badRequest(
        'Bu dönem için dolu bir liste var. Boşaltmak için “Listeyi Boşalt” işlemini kullanın.'
      );
    }
  }

  // Boşaltma da atamaları siler; öncesinde geri alınabilir bir kopya bırak.
  await archiveSchedule(unit._id, year, month, 'listeyi-bosalt');

  const { rule } = await loadUnitContext(unit._id, year, month);
  const slots = buildSlots(unit, year, month, rule);

  const schedule =
    mevcut ??
    (await Schedule.findOneAndUpdate(
      { unit: unit._id, year, month },
      { unit: unit._id, year, month, status: 'taslak' },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    ));

  await DutyAssignment.deleteMany({ schedule: schedule._id });
  await DutyAssignment.insertMany(
    slots.map((s) => ({
      schedule: schedule._id,
      date: s.date,
      employee: null,
      shiftType: s.shiftType,
      flags: [FLAGS.UNFILLED],
    }))
  );

  res.status(201).json(await buildPayload(unit, year, month));
});

/**
 * O güne özel, kadro dışı ek atama. Kural setindeki kadro ayın her gününe aynı
 * sayıyı uygular; tek bir günde fazladan bir nöbetçi ya da gündüz personeli
 * gerektiğinde bu uç nokta kullanılır.
 *
 * Kural ihlali engellemez — atama yine kaydedilir ve ilgili uyarıyla etiketlenir.
 * Not: "Otomatik Taslak Oluştur" listeyi baştan kurduğu için elle eklenenler de silinir.
 */
export const addAssignment = asyncHandler(async (req, res) => {
  const { year, month } = parsePeriod(req);
  const unit = await findUnit(req.params.unitId);

  const schedule = await Schedule.findOne({ unit: unit._id, year, month });
  if (!schedule) throw notFound('Önce bu dönem için bir liste oluşturun');

  const { date, shiftType, employee: employeeId } = req.body ?? {};

  if (!SHIFT_TYPES.includes(shiftType)) {
    throw badRequest(`shiftType yalnızca ${SHIFT_TYPES.join(', ')} olabilir`);
  }
  if (!unit.shiftTypes?.includes(shiftType)) {
    throw badRequest('Bu vardiya tipi birimde tanımlı değil');
  }

  const gun = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(gun.getTime())) throw badRequest('Geçersiz tarih');
  if (gun.getUTCFullYear() !== year || gun.getUTCMonth() + 1 !== month) {
    throw badRequest('Tarih bu döneme ait olmalı');
  }

  let employee = null;
  if (employeeId) {
    employee = await Employee.findById(employeeId);
    if (!employee) throw notFound('Çalışan bulunamadı');
    if (String(employee.unit) !== String(unit._id)) throw badRequest('Çalışan bu birime ait değil');
  }

  await DutyAssignment.create({
    schedule: schedule._id,
    date: gun,
    employee: employee?._id ?? null,
    shiftType,
    manual: true,
    flags: [],
  });

  const { all, context } = await reevaluate(schedule);
  res.status(201).json(
    await buildPayload(unit, year, month, { context, assignments: all, schedule: schedule.toObject() })
  );
});

/**
 * Bir atamayı listeden tamamen kaldırır. Elle eklenen ek slotları geri almak için;
 * kadro slotları da kaldırılabilir, o gün kadronun altına düşer.
 */
export const removeAssignment = asyncHandler(async (req, res) => {
  const assignment = await DutyAssignment.findById(req.params.assignmentId);
  if (!assignment) throw notFound('Atama bulunamadı');

  const schedule = await Schedule.findById(assignment.schedule);
  if (!schedule) throw notFound('Liste bulunamadı');

  await assignment.deleteOne();
  const { all, context } = await reevaluate(schedule);

  const unit = await findUnit(schedule.unit);
  res.json(
    await buildPayload(unit, schedule.year, schedule.month, {
      context,
      assignments: all,
      schedule: schedule.toObject(),
    })
  );
});

/** Manuel yeniden atama; kaydederken tüm listenin kural kontrolü yeniden çalışır. */
export const updateAssignment = asyncHandler(async (req, res) => {
  const assignment = await DutyAssignment.findById(req.params.assignmentId);
  if (!assignment) throw notFound('Atama bulunamadı');

  const schedule = await Schedule.findById(assignment.schedule);
  if (!schedule) throw notFound('Liste bulunamadı');

  if (req.body?.employee !== undefined) {
    if (req.body.employee === null || req.body.employee === '') {
      assignment.employee = null;
    } else {
      const employee = await Employee.findById(req.body.employee);
      if (!employee) throw notFound('Çalışan bulunamadı');
      if (String(employee.unit) !== String(schedule.unit)) {
        throw badRequest('Çalışan bu birime ait değil');
      }
      assignment.employee = employee._id;
    }
  }
  await assignment.save();

  const { all, context } = await reevaluate(schedule);

  const unit = await findUnit(schedule.unit);
  res.json({
    ...(await buildPayload(unit, schedule.year, schedule.month, {
      context,
      assignments: all,
      schedule: schedule.toObject(),
    })),
    updatedAssignment: all.find((a) => String(a._id) === String(assignment._id)),
  });
});

/** Bir slot için seçilebilecek çalışanlar + seçilemeyenlerin sebebi. */
export const assignmentCandidates = asyncHandler(async (req, res) => {
  const assignment = await DutyAssignment.findById(req.params.assignmentId).lean();
  if (!assignment) throw notFound('Atama bulunamadı');

  const schedule = await Schedule.findById(assignment.schedule).lean();
  if (!schedule) throw notFound('Liste bulunamadı');

  const { employees, leaves, rule, history } = await loadUnitContext(
    schedule.unit,
    schedule.year,
    schedule.month
  );
  const others = (await loadAssignments(schedule._id)).filter(
    (a) => String(a._id) !== String(assignment._id)
  );

  // Manuel ekranda sorumlu hemşire de seçilebilir olsun; yedek olduğu ayrıca etiketlenir.
  const { eligible, reasons } = explainCandidates(
    assignment,
    employees,
    leaves,
    [...history, ...others],
    rule,
    { allowBackup: true }
  );
  res.json({ eligible, reasons });
});

/**
 * Henüz var olmayan bir slot için aday değerlendirmesi: belirli bir gün ve vardiya
 * tipine kadro dışı kişi eklenirken, kimin kurallara uyduğu ve uymayanların sebebi
 * daha seçim yapılmadan gösterilebilsin diye.
 *
 * `assignmentCandidates` var olan bir atamanın kimliğini ister; ekleme anında böyle
 * bir kayıt henüz yok.
 */
export const slotCandidates = asyncHandler(async (req, res) => {
  const { year, month } = parsePeriod(req);
  const unit = await findUnit(req.params.unitId);

  const { date, shiftType } = req.query;
  if (!SHIFT_TYPES.includes(shiftType)) {
    throw badRequest(`shiftType yalnızca ${SHIFT_TYPES.join(', ')} olabilir`);
  }

  const gun = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(gun.getTime())) throw badRequest('Geçersiz tarih');
  if (gun.getUTCFullYear() !== year || gun.getUTCMonth() + 1 !== month) {
    throw badRequest('Tarih bu döneme ait olmalı');
  }

  const { employees, leaves, rule, history } = await loadUnitContext(unit._id, year, month);
  const schedule = await Schedule.findOne({ unit: unit._id, year, month }).lean();
  const mevcut = schedule ? await loadAssignments(schedule._id) : [];

  const slot = { date: gun, shiftType, category: dutyCategory(gun) };
  const { eligible, reasons } = explainCandidates(
    slot,
    employees,
    leaves,
    [...history, ...mevcut],
    rule,
    { allowBackup: true }
  );

  res.json({ eligible, reasons });
});

/** Bu dönem için saklanan geri alınabilir kopyalar. */
export const scheduleArchives = asyncHandler(async (req, res) => {
  const { year, month } = parsePeriod(req);
  const unit = await findUnit(req.params.unitId);
  res.json(await listArchives(unit._id, year, month));
});

/**
 * Seçilen kopyayı geri yükler. Geri yüklemeden önce mevcut hâl de arşivlenir,
 * böylece yanlış kopyayı seçmek de geri alınabilir.
 */
export const restoreSchedule = asyncHandler(async (req, res) => {
  const { year, month } = parsePeriod(req);
  const unit = await findUnit(req.params.unitId);

  const schedule = await restoreArchive(unit._id, year, month, req.params.archiveId);
  if (!schedule) throw notFound('Kopya bulunamadı');

  res.json(await buildPayload(unit, year, month));
});

export const publish = asyncHandler(async (req, res) => {
  const schedule = await Schedule.findByIdAndUpdate(
    req.params.scheduleId,
    { status: 'yayinda' },
    { returnDocument: 'after' }
  );
  if (!schedule) throw notFound('Liste bulunamadı');
  res.json(schedule);
});
