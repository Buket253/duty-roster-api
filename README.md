# Nöbet Sistemi — API

Hastane nöbet listesi yönetim sisteminin backend'i. Birim bazlı nöbetçi havuzları,
kural setine göre otomatik taslak üretimi, manuel düzenleme ve auth gerektirmeyen
salt-okunur paylaşım görünümü.

## Kurulum

```bash
npm install
cp .env.example .env     # MONGODB_URI ve JWT_SECRET'ı doldurun
npm run seed             # Dahiliye + 5 çalışan + varsayılan kurallar
npm run dev              # http://localhost:4000
```

`npm test` in-memory MongoDB üzerinde uçtan uca akışı çalıştırır (Atlas gerekmez).

## Ortam Değişkenleri

| Değişken | Açıklama |
|---|---|
| `MONGODB_URI` | MongoDB Atlas bağlantı dizesi (zorunlu) |
| `JWT_SECRET` | JWT imzalama anahtarı (zorunlu) |
| `PORT` | Varsayılan `4000` |
| `CORS_ORIGIN` | İzinli origin'ler, virgülle ayrılır |
| `PUBLIC_BASE_URL` | Paylaşım linklerinin öneki |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Seed yöneticisi |
| `SEED_YEAR` | Örnek izinlerin yılı (varsayılan: içinde bulunulan yıl) |

## Uç Noktalar

```
POST   /api/auth/login                                     {email, password} -> {token}

GET    /api/admin/units                                    (+ employeeCount)
POST   /api/admin/units
PUT    /api/admin/units/:id
DELETE /api/admin/units/:id                                bağlı kayıtları da siler

GET    /api/admin/employees?unit=:unitId
POST   /api/admin/employees
PUT    /api/admin/employees/:id
DELETE /api/admin/employees/:id

GET    /api/admin/leaves?employee=:id | ?unit=:id
POST   /api/admin/leaves
DELETE /api/admin/leaves/:id

GET    /api/admin/rules/:unitId                            kayıt yoksa varsayılanlarla oluşturur
PUT    /api/admin/rules/:unitId

GET    /api/admin/schedules/:unitId/:year/:month
POST   /api/admin/schedules/:unitId/:year/:month/generate
GET    /api/admin/assignments/:assignmentId/candidates     manuel atama için uygun adaylar
PUT    /api/admin/assignments/:assignmentId                kaydederken tüm listeyi yeniden kontrol eder
POST   /api/admin/schedules/:scheduleId/publish

GET    /api/admin/share-links/:unitId                      yoksa oluşturur
GET    /api/public/:token/:year/:month                     auth yok, yalnızca 'yayinda'
```

`/api/admin/*` altındaki her şey `Authorization: Bearer <token>` ister; token yoksa
veya geçersizse `401` döner. `/api/public/*` hiçbir auth istemez ve taslak listeyi
**asla** döndürmez.

### Liste yanıtı

`GET`/`generate` aynı gövdeyi döner: ekranın ihtiyaç duyduğu her şey tek çağrıda.

```jsonc
{
  "unit": {...}, "year": 2026, "month": 10,
  "schedule": { "status": "taslak", "generatedAt": "..." },
  "rule": {...},
  "leaves": [...],
  "assignments": [{ "date": "...", "employee": {...}|null, "shiftType": "nobet-24", "flags": [] }],
  "employees": [{ "name": "...", "duties": 6, "weekendDuties": 2, "shifts": 4, "belowMin": false, "atLimit": false }],
  "warnings": { "total": 0, "flagged": 0, "byFlag": {}, "belowMin": [] }
}
```

## Çizelgeleme Algoritması

`src/services/scheduler/` — hazır kısıt çözücü kullanılmadı.

1. **`buildSlots`** — Ayın her günü için slot: `nobet-24` her gün (birimin
   `minStaffPerDay` sayısı kadar), `mesai-8` yalnızca hafta içi.
2. **`filterCandidates`** — Hard-constraint'leri geçen adaylar. Eleme sebepleri
   (`explainCandidates`) manuel atama ekranında gösterilir.
3. **`greedyAssign`** — Tarih sırasıyla; her slotta o ana kadar aynı tipte en az
   vardiya almış aday seçilir. Eşitlikte hafta sonu sayısı → toplam yük → ad.
   Deterministiktir.
4. **`localSearch`** — 500 iterasyon rastgele ikili takas; yalnızca her iki tarafın
   da kuralları sağladığı ve maliyeti düşüren takaslar kabul edilir.
   Maliyet = nöbet sayısı varyansı + `weekendFairnessWeight/100` × hafta sonu
   nöbeti varyansı. 150 başarısız denemeden sonra durur.
5. **`flags`** — Tüm set yeniden değerlendirilir; hem üretimden sonra hem manuel
   düzenleme kaydedilirken çalışır.

### Hard constraint'ler

| Kural | Kapsam |
|---|---|
| İzinli personel (`excludeOnLeave`) | her vardiya |
| Aynı gün ikinci vardiya | her vardiya |
| `minRestHoursAfterDuty` | `nobet-24` bitişinden itibaren, sonraki her vardiyayı bloklar |
| `maxConsecutiveDuties` | `nobet-24` |
| `maxDutiesPerMonth` | `nobet-24` |

`minDutiesPerMonth` bir alt sınır değil, uyarıdır: altında kalan kişiler
`warnings.belowMin` içinde döner.

### Flag'ler

| Flag | Anlamı |
|---|---|
| `doldurulamadi` | Slota uygun aday yok, boş bırakıldı |
| `ardisik-nobet` | `maxConsecutiveDuties` aşıldı |
| `yetersiz-dinlenme` | Önceki nöbetten sonra zorunlu dinlenme dolmadan atanmış |
| `cifte-atama` | Aynı gün ikinci vardiya |
| `izinli` | Kişi o tarihte izinli |
| `limit-asildi` | Aylık nöbet limiti aşıldı |

## Şartnameden Sapmalar

Hepsi şartnamedeki bir gereksinimi karşılamak için:

- **`DutyAssignment.employee` zorunlu değil.** Bölüm 7.5 doldurulamayan slotların
  boş bırakılıp `doldurulamadi` ile etiketlenmesini istiyor; `required` bunu
  imkânsız kılardı.
- **`GET /api/admin/assignments/:id/candidates` eklendi.** Bölüm 10.3'teki "bir güne
  tıklayınca uygun adaylardan birini seçme" akışı aday listesi olmadan yazılamıyor.
- **`GET /api/admin/units` yanıtına `employeeCount`** eklendi — dashboard'daki birim
  kartları kişi sayısını gösteriyor (yeni uç nokta değil, mevcut yanıt zenginleştirildi).
- **`GET /api/admin/leaves` `?unit=` filtresini de kabul ediyor** — Çalışanlar & İzin
  ekranı birimin tüm izinlerini listeliyor.
- **Adalet sıralaması vardiya tipi bazında.** "Toplam nöbet sayısı en az olan"
  kuralı nöbet ve mesai sayaçları ayrı tutulmadığında bir kişinin tüm mesaileri
  toplayıp neredeyse hiç nöbet tutmamasına yol açıyordu.
- **Tarihler UTC gece yarısına sabitlendi** — saat dilimi kayması gün atlamalarına
  neden oluyordu.

## Yapı

```
src/
  models/       Mongoose şemaları
  routes/       Express router'ları
  controllers/  İstek işleyicileri
  middleware/   requireAuth, hata yakalama
  services/
    rules.js    Birim kural seti erişimi
    scheduler/  buildSlots · filterCandidates · greedyAssign · localSearch · flags · generateSchedule
  scripts/      seed.js
  utils/        tarih, sabitler, hata yardımcıları
tests/          uçtan uca testler (in-memory MongoDB)
```
