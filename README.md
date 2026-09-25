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
POST   /api/admin/schedules/:unitId/:year/:month/blank       kadro kadar boş slot; elle doldurmak için
                                                            ?force=1 dolu listeyi boşaltır
GET    /api/admin/schedules/:unitId/:year/:month/archives    geri alınabilir kopyalar
POST   /api/admin/schedules/:unitId/:year/:month/restore/:archiveId   kopyayı geri yükler
GET    /api/admin/schedules/:unitId/:year/:month/candidates?date=&shiftType=
                                                            henüz olmayan slot için aday + sebep
GET    /api/admin/assignments/:assignmentId/candidates     manuel atama için uygun adaylar
PUT    /api/admin/assignments/:assignmentId                kaydederken tüm listeyi yeniden kontrol eder
POST   /api/admin/schedules/:unitId/:year/:month/assignments  o güne özel, kadro dışı ek atama
DELETE /api/admin/assignments/:assignmentId                atamayı listeden tamamen kaldırır
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
  "employees": [{ "name": "...", "staffType": "standart", "duties": 6, "weekendDuties": 2, "shifts": 4, "hours": 176, "belowMin": false, "atLimit": false }],
  "warnings": { "total": 0, "flagged": 0, "byFlag": {}, "belowMin": [], "overCapacity": [], "weeklyShort": [] },
  "puantaj": {
    "satirlar": [{ "name": "...", "gunduzGun": 8, "nobet": { "hafta-ici": 3, "per-cuma": 2, "hafta-sonu": 1 },
                   "nobetToplam": 6, "toplamSaat": 208, "haftalikSaat": {...}, "eksikHafta": [] }],
    "toplam": { "gunduzGun": 110, "nobetToplam": 31, "toplamSaat": 1624 }
  },
  "leaveWarnings": [{ "name": "...", "startDate": "...", "returnDate": "...", "warnings": ["izin-pazartesi-baslamiyor"] }]
}
```

## Vardiya Saatleri

Her departmanın çalışma prensibi farklı olabilir; saatler kural setinde tutulur:

| Alan | Varsayılan |
|---|---|
| `dayShiftStart` / `dayShiftEnd` | `08:00` / `16:00` (8 saat) |
| `dutyStart` / `dutyEnd` | `08:00` / `08:00` (24 saat) |

Bitiş saati başlangıca eşit ya da ondan küçükse vardiya ertesi güne sarkar
(`16:00 → 08:00` = 16 saat). Süreler haftalık saat alt sınırına, toplam saat
dengesine ve puantaja doğrudan yansır (`shiftHours`). Vardiya tipi anahtarları
(`nobet-24`, `mesai-8`) geriye dönük uyumluluk için sabit kaldı; süreleri artık
addan değil kural setinden gelir.

## Personel Tipleri

| Tip | Gündüz mesaisi | Nöbet |
|---|---|---|
| `standart` | Adil rotasyondan pay alır | Adil rotasyondan pay alır |
| `sadece-gunduz` | Öngörülen **her gün** otomatik, rotasyon dışı | Hiç girmez |
| `sorumlu` | Öngörülen **her gün** otomatik, rotasyon dışı | Yalnızca başka aday kalmadığında yedek |

Her birimde en fazla bir `sorumlu` bulunabilir; ikincisi `400` ile reddedilir.
`sadece-gunduz` ve `sorumlu` personel kadronun **içinden** sayılır: bir gündeki
gündüz sayısı kural setindeki kadroya eşittir. Önce her gün gelenler yerleşir,
rotasyon kalan slotları doldurur. Sayıları kadrodan fazlaysa (her gün gelmek
zorunda oldukları için) yine hepsi yazılır ve o gün `warnings.overCapacity`
altında raporlanır.

Kişiye özel `canTakeDuty` anahtarı yalnızca `standart` tipte anlamlıdır: kapalıyken
kişi gündüz rotasyonunda kalır ama hiç nöbete yazılmaz.

`sadece-gunduz` personeline **`dutyStartDate`** verilebilir: o tarihten itibaren
kişi nöbet rotasyonuna katılır ve `standart` gibi davranır. Personel tipi bu yüzden
tarihe bağlıdır — `staffTypeOn(employee, date)` her yerde tarihle sorulur.

## Çizelgeleme Algoritması

`src/services/scheduler/buildSchedule.js` — hazır kısıt çözücü kullanılmadı.
Veritabanından bağımsızdır; `generateSchedule` onu çağırıp sonucu kalıcılaştırır,
testler aynı hattı doğrudan kullanır.

1. **`buildSlots`** — Ayın her günü için kadro kadar slot. Hafta içi/hafta sonu
   sayıları kural setinden ayrı okunur (`weekdayDayStaff`, `weekdayDutyStaff`,
   `weekendDayStaff`, `weekendDutyStaff`); 0 ise o gün o tipten slot açılmaz.
   Bu sayı o gün yazılacak **toplam** kişiyi verir.
2. **`history`** — Önceki ayın son 14 günündeki atamalar `history: true` ile
   yüklenir. Dinlenme, gün aşırı ve boşluk hesapları bunları görür (ay geçişinde
   kurallar bozulmaz), aylık sayaçlara ve adalet dengesine girmezler.
3. **`availabilityShares`** — Her kişinin ay içinde o rotasyona kaç gün uygun
   olduğu. Adalet ham sayı yerine bu paya göre ölçülür: ay ortasında nöbete
   başlayan ya da iki hafta izinli olan kişi, yarım ayda tam yükü taşımaya
   zorlanmaz. Hem açgözlü sıralama hem yerel arama maliyeti bu payı kullanır;
   paylar eşitse ham sayı varyansına indirgenir.
4. **`assignDuties`** — Nöbetler. Sıralama: boşluk sınırını aşmak üzere olan →
   izin tercihi (Perşembe nöbeti / dönüş günü) → kategori bazlı nöbet sayısı →
   toplam nöbet → haftalık saat açığı → toplam saat → ad. Deterministiktir. Aday
   çıkmazsa sorumlu hemşire yedek olarak devreye girer, atama `sorumlu-yedek`
   etiketlenir.
5. **`localSearch` (yalnızca nöbet)** — Kategori adaleti burada, gündüz mesaisi
   **yerleşmeden önce** optimize edilir. Sebebi ölçülerek bulundu: mesailer
   yerleştikten sonra bir nöbeti devretmek neredeyse her zaman devralan kişinin
   komşu günkü mesaisiyle dinlenme kuralını çiğniyor ve takasların tamamı
   reddediliyordu.
6. **`assignDayShifts`** — Önce her gün gündüze gelen personel (sadece-gündüz,
   sorumlu), sonra kalan kadro rotasyondan. Sıralama: derecelendirilmiş bekleme
   önceliği → izin tercihi → mesai sayısı → haftalık saat açığı → toplam saat → ad.
7. **`localSearch` (yalnızca mesai)** — Gündüz sayısı, toplam saat ve bekleme
   dengesi. Takaslar vardiya tipine göre kovalanır; düz listeden rastgele çift
   seçmek nöbetleri ihmal ediyordu.
8. **`repairWeeklyHours`** — Haftalık alt sınırın altında kalanlara, o haftadaki
   bir gündüz slotunu hedefli olarak devreder. Açgözlü atama gün gün ilerlediği
   için haftanın başında kimin açık kalacağını göremez; bu geçiş ay tamamlandıktan
   sonra çalışır. Yalnızca slotu bırakınca kendisi alt sınırın altına düşmeyecek,
   bekleme sınırını aşmayacak ve daha çok saati olan kişilerden devralınır.
   Nöbetler dokunulmaz — kategori adaletini onlar taşıyor.
9. **`repairIdleGaps`** — Bekleme sınırını zorunlu kural olarak uygular (aşağıya bakın).
10. **`localSearch` (son dengeleme)** — Onarım, slotları muhtaç kişilere devrederken
   ay sonu toplam saatlerini bozabiliyor (ölçüldü: fark 8 saatten 24 saate çıkıyordu).
   Bu tur saatleri yeniden yaklaştırır, ama kazanılan haftalık alt sınırı ve bekleme
   sınırını koruyacak şekilde kısıtlanmıştır.
11. **`repairIdleGaps` (ikinci kez)** — Dengeleme yine bir boşluk açtıysa son kez onarır.
12. **`repairDayBalance`** — Gündüz mesaisi sayılarını nöbet havuzunda eşitler
   (aşağıya bakın).
13. **`flags`** — Tüm set yeniden değerlendirilir; hem üretimden sonra hem manuel
   düzenleme kaydedilirken çalışır. `puantaj()` ay sonu dökümünü üretir.

### Yerel aramanın erken durması

`stagnantLimit` başlangıçta 400'dü ve arama, reddedilen birkaç yüz hamleden sonra
pes ediyordu. Bu problemde hamlelerin ezici çoğunluğu kısıtlara takılıp reddediliyor
— ölçüldü: nöbet turu **342 denemede 0 kabul** ile duruyordu, yani nöbet dengelemesi
fiilen hiç çalışmıyordu. Perşembe/Cuma dağılımının bozuk çıkmasının sebebi buydu.
Eşik kaldırıldı, iterasyon 20 000'e çıkarıldı.

Bu, maliyet değerlendirmesini üretim başına on binlerce kez çağırdığı için
`fairnessCost` tek geçişlik bir `snapshot` üzerine taşındı: önceden her terim kendi
`filter`'ını tüm atamalar üzerinde her kişi için ayrı çalıştırıyordu. Gün kontrolleri
de önbelleğe alındı. 14 kişilik bir serviste tek çizelge üretimi **16,2 s → 4,5 s**.

### Haftalık yük dengesi

Yalnızca aylık toplam dengelenince bir kişi bir hafta tek nöbetle (24 saat) gelip
başka hafta yığılabiliyordu. `weeklyImbalance` her tam hafta için kişiler arası saat
varyansını ölçer. Ağırlık taraması yapıldı: 15'te haftalar 16–40 saat arasında
salınıyor (11 hafta 16 saatte), 45'te 16–32 aralığına iniyor ve 16 saatlik hafta
sayısı 3'e düşüyor. Ağırlık 45 seçildi.

### Gündüz mesaisi sayılarının eşitlenmesi

Yerel arama bunu tek başına yapamıyordu: son dengeleme turunda haftalık yük dengesi
terimi (ağırlık 45) gündüz sayısı teriminden çok daha güçlü olduğu için arama,
haftalık dengeyi biraz iyileştirmek uğruna gündüz sayısını bozan hamleleri kabul
ediyordu. Aşama aşama ölçüldü (12 kişilik rotasyon, Ekim 2026, kişi başı hedef 7):

| Aşama | Gündüz sayıları | Fark |
| --- | --- | --- |
| `assignDayShifts` | 7,8,6,7,7,7,7,7,7,7,7,7 | 2 |
| `localSearch` (mesai) | 7,7,7,7,7,7,7,7,7,7,7,7 | **0** |
| `localSearch` (son dengeleme) | 6,8,5,6,8,7,8,7,7,6,9,7 | **4** |

Ağırlık artırmak çözmedi: gündüz terimi 16'ya çıkarıldığında fark yine 2'de
takılıyor, buna karşılık ay sonu saat farkı 24'ten 40'a çıkıyordu.

`repairDayBalance` bu yüzden rastgele değil hedefli çalışır: yalnızca sayı farkını
gerçekten kapatan devirleri (sapma farkı 1'i aşanları) dener ve aralarından **toplam
maliyeti en az artıranı** seçer. Böylece gündüz sayısı aritmetik alt sınırına inerken
haftalık denge, bekleme sınırı ve saat adaleti korunur. Sonuç: 12 kişinin 10'u tam
hedefte, fark 4 → 2; ay sonu saat farkı ve nöbet kategorileri değişmedi.

Kalan 1 kişilik sapma kapasite kaynaklı: sınırı aşan kişinin **hangi** gündüzü
alınırsa alınsın geriye 4–5 günlük bir boşluk kalıyor, yani bekleme sınırı (zorunlu
kural) devri engelliyor.

Eşitleme yalnızca **nöbete giren** personel arasında yapılır. Nöbet anahtarı kapalı
olan kişi ayını yalnızca 8 saatlik gündüzlerle doldurmak zorundadır; ona da aynı
gündüz sayısını dayatmak onu ayda 128 saat yerine 56 saate düşürürdü. Onun gündüz
sayısı eskiden olduğu gibi saat adaleti ve haftalık alt sınır terimleriyle belirlenir.

### Ulaşılamayan haftalık hedef

`minWeeklyHours` kadroya göre imkânsızsa `repairWeeklyHours` atlanır
(`weeklyTargetFeasible`). Hedef ulaşılamazken bu geçiş slotları muhtaçtan muhtaca
taşıyıp hiçbir açığı kapatmadan ay sonu dengesini bozuyordu — ölçüldü: 12 kişilik
bir serviste saat farkını 24'ten 40'a çıkarıyordu. Hedef ulaşılamadığında yük
dengesi (`weeklyImbalance`) yine aranır, alt sınır kovalanmaz.

Kapasite hesabı, her gün gündüze gelen personelin aldığı slotları düşer: onlar
sabittir ve rotasyon havuzunun dışındadır.

### Takas ve devretme

Yerel arama iki hamle kullanır. **Takas** iki kişinin günlerini değiştirir ama
vardiya sayılarını değiştirmez — bu yüzden toplam saat dengesi takaslarla *hiç*
düzelemiyordu. **Devretme** bir slotu başka kişiye verir ve sayıları değiştirir;
saat ve kategori dengesini asıl bu hamle sağlıyor.

### Güne özel ek atama

Kural setindeki kadro ayın **her gününe** aynı sayıyı uygular. Tek bir günde
fazladan bir nöbetçi ya da gündüz personeli gerektiğinde
`POST .../assignments` ile kadro dışı bir atama eklenir; `DELETE /assignments/:id`
geri alır. Bu atamalar `manual: true` ile işaretlenir:

- Kadro aşımı uyarısına **girmezler** — bilerek yapılmışlardır.
- Kadrosu 0 olan bir güne de eklenebilirler (ör. hafta sonu gündüz mesaisi).
- Kural ihlali engellemez; atama kaydedilir ve ilgili uyarıyla etiketlenir.
  Ekleme listesi açılmadan önce `GET .../candidates` ile kimin uygun olduğu ve
  uymayanların sebebi getirilir.
- **"Otomatik Taslak Oluştur" listeyi baştan kurar, elle eklenenler de silinir.**

### Yükleme göstergeleri

API'den yanıt beklenen her an sayfanın en üstünde ince bir ilerleme çubuğu görünür
(`IstekCubugu`). Her ekrana ayrı bayrak koymak yerine istemcideki uçuştaki istek
sayacı dinlenir: `istekleriIzle` aboneliği, `request` sarmalayıcısındaki sayaç
`finally` içinde azaldığı için hata yolunda da sıfıra döner. Çok kısa isteklerde
yanıp sönmesin diye çubuk 150 ms gecikmeyle açılır.

Bunun üstüne yerel göstergeler: içerik beklenen yerlerde iskelet satırlar
(`Iskelet`) ve metinli dönen gösterge (`Yukleniyor`), iş yapan düğmelerde
`DugmeDonen`. Gün düzenleyici modalinde aday listeleri gelene kadar başlıkta
"Uygun adaylar yükleniyor…" ve her seçicinin altında iskelet görünür; kaydedilen
slotun yanında dönen gösterge durur.

### Elle atamanın hızı

Elle bir atama kaydetmek listenin tamamının kural kontrolünü yeniden çalıştırır.
`reevaluate` ve `buildPayload` aynı yükü (birim bağlamı, önceki ay geçmişi,
atamalar) ikişer kez okuyordu; uzak veritabanında bu, her seçimde saniyelerce
gecikme demekti. `reevaluate` artık yüklediği bağlamı ve atamaları döner,
`buildPayload` onları tekrar okumaz: kaydetme başına **21 sorgudan 13'e**.

Ekran tarafında seçim iyimser olarak hemen gösterilir ve sunucu yanıtıyla
uzlaştırılır; hata olursa geri alınır. Aday listeleri de yalnızca sunucudan
onaylı bir değişiklikten sonra tazelenir — doğrudan `assignments`e bağlıyken
iyimser güncelleme de tetikliyor ve sorgular iki kez gidiyordu.

### Geri alma

Otomatik üretim ve "Listeyi Boşalt" mevcut atamaları siler. Bu işlemler geri
alınamadığı için elle girilmiş bir ay tek tıkla kaybedilebiliyordu; **bu fiilen
yaşandı ve veri kurtarılamadı.**

Artık yıkıcı her işlemden önce listenin o anki hâli `ScheduleArchive` altına
kopyalanır. Kopyalar `GET .../archives` ile listelenir, `POST .../restore/:id` ile
geri yüklenir. Geri yükleme de öncesinde kopya aldığı için kendisi de geri
alınabilir. Birim-dönem başına son 10 kopya saklanır; tamamen boş listeler
kopyalanmaz (geri alınacak bir şey yoktur).

### Otomasyona geçiş

Ay geçişi kuralları (dinlenme, gün aşırı, bekleme) önceki ayın son haftasına
baktığı için **ilk otomatik ay ancak bir önceki ay kayıtlıysa doğru çıkar**.
Önceki ay `POST .../blank` ile boş açılıp ekrandan elle doldurulur; elle girişte
kurala uymayan kişiler de seçilebilir (amaç fiilen olanı kaydetmek), atama
yalnızca ilgili uyarıyla etiketlenir.

Dolu bir listenin üzerine kazara yazılmaz: `blank` dolu liste görürse `400` döner.
Bilerek boşaltmak için `?force=1` gerekir — ekranda "Listeyi Boşalt" düğmesi bunu
onay sorarak yapar.

### Haftalık saat alt sınırı

`minWeeklyHours` (varsayılan 32) gündüz + nöbet toplamının haftalık tabanıdır.
Değerlendirme dışında kalan haftalar:

- **Ayın kesildiği yarım haftalar** — ilk/son ISO hafta ay sınırının dışına
  taşıyorsa saat düşük çıkar; bu ihlal değildir (`fullWeekKeys`).
- **Kişinin izinli olduğu haftalar** — izin kişiyi hem nöbetten hem mesaiden
  tamamen çıkarır, o haftanın saati ölçülmez.

### İzin — hafta sonuna taşma

Cuma ya da Cumartesi biten bir izinde kişi araya giren hafta sonuna çağrılmaz;
izin fiilen Pazar'a kadar uzatılır ve ilk çalışma günü Pazartesi olur
(`effectiveLeaveEnd`).

Kadro yetmediğinde sınır sağlanamayabilir; kalan açık sessizce geçilmez,
`warnings.weeklyShort` ve puantajdaki `eksikHafta` altında raporlanır.

### Bekleme sınırı — zorunlu kural

`maxIdleDays`, kişinin hastaneye **hiç gelmeden** geçirdiği ardışık gün sayısıdır.
Nöbet de gündüz mesaisi de "geldi" sayılır ve beklemeyi sıfırlar. Nöbet sonrası
zorunlu dinlenme günü beklemeye dahildir.

Sayılmayan günler (`yokSayilanGun`): kişi izinliyse ya da o gün kişinin
girebileceği hiçbir tipten slot açılmamışsa (ör. hafta sonu gündüz kadrosu 0 iken
nöbete giremeyen personel için Cumartesi-Pazar).

Kural **zorunludur**. Sıralama önceliği ve maliyet cezasının yanında, üretim
hattının sonunda `repairIdleGaps` geçişi çalışır: sınırı aşan her boşlukta, o
boşluğa düşen bir güne ait slot, onu verebilecek birinden alınıp bekleyen kişiye
devredilir. Gündüz mesaisi önce denenir — nöbetler kategori adaletini taşıdığı
için onları devretmek dengeyi daha çok bozar. Devir, devredeni sınırın ötesine
itiyorsa geri alınır. Kapasite hiç el vermiyorsa boşluk kalır ve
`warnings.idleExceeded` altında raporlanır.

### Arka arkaya çalışmanın dağıtılması

Bekleme sınırı yalnızca boşlukları kısıtlar; hiçbir şey kişiyi üç gün üst üste
çalıştırıp sonra sınırın tam ucunda bekletmeye engel değildi. İki yerde önlenir:
açgözlü sıralamada üst üste çalışmış aday geri plana düşer, yerel arama
maliyetinde de iki günden uzun her kesintisiz dizi uzadıkça artan ceza alır.
Her gün gündüze gelen personel (sadece-gündüz, sorumlu) bu cezanın dışındadır —
onların Pazartesi-Cuma dizisi tanım gereğidir.

### Gün aşırı nöbet — son çare

Gün aşırı (iki nöbet arasında yalnızca alt sınır kadar boş gün kalan) aralık
istenmeyen bir durumdur. Açgözlü sıralamada "gün aşırı yaratmayan aday" en üst
ölçüttür — beklemesi dolan kişiden bile önce gelir, çünkü alternatif varken
mecburiyet yoktur. Yerel arama maliyetinde de ayrıca cezalandırılır.
`maxTightGapsPerMonth`, mecbur kalındığında ayda kaç kez izin verileceğidir.

### Resmi tatiller

Türkiye'nin **sabit tarihli resmi tatilleri** (1 Ocak, 23 Nisan, 1 Mayıs,
19 Mayıs, 15 Temmuz, 30 Ağustos, 29 Ekim) her birimde hazır gelir; kural setindeki
`useNationalHolidays` ile kapatılabilir. Dinî bayramlar ay takvimine göre kaydığı
için `rule.holidays` (`YYYY-AA-GG` dizisi) altına elle eklenir.

Liste yanıtındaki `holidays` alanı o aya düşen fiilî tatilleri adlarıyla döner;
takvim bunları işaretler. Tatil günlerinde:

- gündüz kadrosu **0**'dır; yalnızca nöbetçi yazılır,
- her gün gündüze gelen personel (sadece-gündüz, sorumlu) de çağrılmaz,
- nöbet adaletinde **hafta sonu** kategorisinde sayılırlar,
- nöbetçi sayısı hafta sonu kadrosundan okunur.

### Hard constraint'ler

| Kural | Kapsam |
|---|---|
| İzinli personel (`excludeOnLeave`) | her vardiya — hem nöbet hem mesai |
| Aynı gün ikinci vardiya | her vardiya |
| `minRestDaysAfterDuty` | Nöbet sonrası bu kadar gün **hiçbir** vardiya verilmez |
| `maxTightGapsPerMonth` | Tam alt sınırda kalan ("gün aşırı") nöbet aralığının aylık üst sınırı |
| `maxDutiesPerMonth` | `nobet-24` |
| Personel tipi | `sadece-gunduz` ve `canTakeDuty: false` hiç nöbet almaz |

`minRestDaysAfterDuty = 1` iken ertesi gün (D+1) nöbet **her zaman** yasaktır.
Tam alt sınırda kalan aralık (D+2) "gün aşırı" sayılır ve ayda `maxTightGapsPerMonth`
kez istisna edilir; normal hedef en az iki boş gündür.

`minDutiesPerMonth`, `minWeeklyHours` ve `maxIdleDays` slot atamasını bloklamaz;
sıralamada öncelik üretir ve sağlanamadıklarında uyarı olarak raporlanırlar.

### Flag'ler

| Flag | Anlamı |
|---|---|
| `doldurulamadi` | Slota uygun aday yok, boş bırakıldı |
| `yetersiz-dinlenme` | Nöbet sonrası zorunlu dinlenme dolmadan atanmış |
| `gun-asiri-limit` | Aylık gün aşırı nöbet hakkı aşıldı |
| `cifte-atama` | Aynı gün ikinci vardiya |
| `izinli` | Kişi o tarihte izinli |
| `limit-asildi` | Aylık nöbet limiti aşıldı |
| `nobete-giremez` | Nöbete giremeyen personel nöbete yazılmış |
| `sorumlu-yedek` | Sorumlu hemşire yedek olarak nöbete girdi (ihlal değil, bilgi) |

### İzin kuralı

İznin Pazartesi başlaması, dönüş gününün (bitişin ertesi) Pazartesi olması ve
izne girmeden önceki Perşembe nöbetinin tutulmuş olması beklenir. Hiçbiri
**engelleyici değildir** — ihlal `leaveWarnings` altında uyarı olarak döner
(`izin-pazartesi-baslamiyor`, `donus-pazartesi-degil`,
`izin-oncesi-persembe-nobeti-yok`). Çizelgeleme bu yerleşimi sıralamada tercih eder.

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
- **`Unit.minStaffPerDay` kaldırıldı.** Kadro artık kural setinde hafta içi/hafta
  sonu ve vardiya tipi kırılımıyla tutuluyor; tek bir birim alanı bunu anlatamıyordu.
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
    leaveWarnings.js  İzin yerleşim kuralı uyarıları
    scheduler/  buildSchedule (hat) · buildSlots · filterCandidates · greedyAssign
                localSearch · repairWeeklyHours · repairIdleGaps ·
                repairDayBalance · idleRun · flags · history
                staff · calendar · shiftHours · generateSchedule
  scripts/      seed.js
  utils/        tarih, sabitler, resmi tatiller, hata yardımcıları
tests/          scheduler (motor, DB'siz) · smoke + seed (in-memory MongoDB)
```
