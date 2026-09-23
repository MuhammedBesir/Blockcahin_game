# Denge Labirenti

Telefonu eğerek oynanan, serbest giriş-çıkışlı labirent yarışı. Statik site (Vercel) + Supabase (Realtime Broadcast + Postgres). Build adımı yok, sunucu kodu yok.

```
index.html      → katılımcı telefonu (/)
host.html       → projeksiyon ekranı (/host)
liderler.html   → genel liderlik sayfası (/liderler)
js/config.js    → Supabase bilgileri, oyun ve fizik ayarları
js/maze.js      → seed'li labirent üretimi (her cihaz aynı seed'den aynı labirenti üretir)
js/physics.js   → top fiziği, duvar çarpışması, yıldız/tuzak/bitiş
js/render.js    → canvas çizimleri (labirent, top, iz, pusula, mini kartlar)
js/net.js       → Supabase kanal + veritabanı sarmalayıcı
js/phone.js     → telefon akışı (katıl → oyna → sonuç → tekrar oyna)
js/host.js      → host akışı: izleme ekranı, liderlik, yönetici engelleme
js/leaderboard.js → /liderler sayfası
supabase/migrations/ → scores + banned tabloları, liderlik ve yönetici fonksiyonları
```

## Oyun akışı

Tur yok, host oyunu başlatmaz. Her oyuncu telefonundan istediği zaman **KATIL**'a basar, 3 sn geri sayımdan sonra kendi labirentinde oynar, bitirince (ya da süre dolunca) sonucu görür ve **TEKRAR OYNA**'ya basıp yeni bir labirentte devam eder. Herkes aynı anda, birbirinden bağımsız oynar.

Projeksiyon (`/host`) bir izleme ekranıdır: o an oynayanların topu kendi labirentinde canlı görünür, sağda kalıcı genel liderlik akar.

## Kurulum

1. **Supabase projesi aç.** Project Settings › API sayfasından `Project URL` ve `anon` anahtarını al.
2. **Realtime ayarını kontrol et.** Realtime › Settings sayfasında public kanallara izin verildiğinden emin ol. "Private channels only" açıksa telefonlar projeksiyona bağlanamaz (oyunun kendisi yine çalışır, sadece host'ta görünmez).
3. **Veritabanı şemasını uygula.** `supabase/migrations/` klasöründeki dosyaları sırayla Supabase SQL editöründe çalıştır (ya da Supabase CLI ile `supabase db push`).
4. **Yönetici kodunu belirle.** Rastgele bir kod seç (örn. 10 karakter) ve SQL editöründe çalıştır:
   ```sql
   insert into private.settings (key, value) values
     ('admin_hash', extensions.crypt('KODUN-BURADA', extensions.gen_salt('bf', 10)))
   on conflict (key) do update set value = excluded.value;
   ```
   Kodun kendisi hiçbir yerde düz metin olarak saklanmaz, sadece bu bcrypt özeti tutulur. Kodu unutursan aynı komutu yeni bir kodla tekrar çalıştırman yeterli.
5. **`js/config.js` dosyasını doldur.** `SUPABASE_URL` ve `SUPABASE_ANON_KEY` alanlarını gir. `PLAN` değerini hesabına göre `'free'` ya da `'pro'` yap.
6. **Vercel'e deploy et.** İki yol var:
   - `npx vercel --prod` komutunu klasörün içinde çalıştır.
   - Ya da repoyu GitHub'a at ve Vercel'den "Import" ile bağla. Framework seçimi: **Other**. Build komutu boş, output klasörü `.` (kök).
7. **Host ekranını aç.** Projeksiyondaki bilgisayarda `https://<alan-adın>/host` adresini aç, `F` ile tam ekrana geç. Oda kodu yok: telefonlar QR'ı okutur ya da siteye girer, adını yazıp hemen oynar. Tek bir oyun odası vardır (`js/config.js` › `ROOM`), bu yüzden aynı anda **tek host ekranı** açık olmalı. İki ayrı etkinliği aynı anda yapacaksan ikinci kopyada `ROOM` değerini değiştir.

## Test

- **Arayüz, Supabase'siz:** `/host?bots=6` sahte oyuncularla izleme ekranını açar. Botlar sadece host tarafında yaşar, ağ trafiği üretmez. Skor kaydı ve liderlik için gerçek Supabase bağlantısı şart.
- **Telefonu masaüstünde denemek:** `/?test` açıp ok tuşlarıyla oynarsın.
- **Gerçek test:** En az bir iPhone ve bir Android ile dene. iOS'te sensör izni sadece HTTPS'te ve KATIL'a dokunulduğu anda istenebilir. Localhost'ta iPhone test edemezsin, deploy edilmiş adresi kullan.

## Host kontrolleri

Fareyi oynatınca sol altta kontroller belirir, 3 saniye sonra kaybolur. Projeksiyonda yer kaplamazlar.

| Buton | İşlev |
|---|---|
| Tam ekran (`F`) | Tam ekrana geçer |
| Yönetici girişi | Kod ister; doğruysa yönetici modunu açar (bir dahaki açılışta hatırlanır, bu bilgisayara özeldir) |
| Engellenenler | Yönetici modundayken görünür: engellenen oyuncuları listeler, tek tek engeli kaldırabilirsin |

**Yönetici modunda** bir oyuncu kartına ya da liderlik satırına tıklamak, onay istedikten sonra o oyuncuyu **anında** engeller: telefonu oyundan atılır, geçmiş skorları liderlikten düşer, yeni skor yazamaz. Argo/uygunsuz isim gördüğünde bunu kullan.

## Oyun kuralları (kodda böyle)

- **Süre ölçümü:** Telefon kendi süresini ölçer. Kronometre, geri sayım bittiği anda başlar.
- **Kalibrasyon:** Geri sayımın son saniyesindeki telefon açısı "düz" kabul edilir. Oyuncu telefonu masaya yatırmak zorunda kalmaz.
- **Net süre:** Ham süre − (yıldız × 1 sn).
- **Tuzak:** Deliğe düşen başa döner. Ayrıca ceza süresi yok, kaybedilen zaman zaten ceza.
- **Tuzak yerleşimi:** Tuzakların yarısı en kısa yol üzerindeki dönemeçlerin dış köşesinde durur (hızlı giren düşer). Diğer yarısı yan kollardadır. Yolun ortası hiçbir zaman kapanmaz. Bu, 200 seed üzerinde simülasyonla doğrulandı.
- **Süre sınırı:** `GAME.roundSeconds` (varsayılan 90 sn) dolunca oyun biter, o ana kadarki ilerleme sonuç ekranında görünür. Skor yazılmaz.
- **Her oyun farklı labirentte geçer**, seed rastgele seçilir. İstersen tekrar tekrar oynayabilirsin; liderlikte her oyuncunun **en iyi net süresi** yer alır.

## Genel liderlik (kalıcı)

- Her bitirilen oyun, sonucunu Supabase'deki `scores` tablosuna yazar. Bitiremeyenler ve hile filtresinden geçmeyen (çok hızlı) bitişler yazılmaz.
- Oyuncu kimliği telefonun tarayıcısındaki `dl-pid` değeridir. Aynı telefondan oynayan kişi tüm etkinlik boyunca aynı oyuncu sayılır, adını değiştirse bile.
- **Telefon:** Her oyundan sonra genel sıran, rekorun ve varsa "YENİ REKOR!" rozeti görünür. **TEKRAR OYNA** ile hemen yeni bir oyuna başlarsın.
- **Host:** Sağdaki tablo canlı genel liderliği gösterir.
- **`/liderler`:** Herkese açık, 15 sn'de bir yenilenen tam liste; kendi satırın vurgulanır.
- Veritabanı işlemleri Realtime mesaj bütçesine sayılmaz.
- Şema: `supabase/migrations/`. Anon anahtar skor tablosuna yalnızca ekleme ve okuma yapabilir; güncelleme/silme yasak. 4 sn'den kısa süreler reddedilir. Engellenen oyuncunun `pid`'i skor ekleyemez (veritabanı düzeyinde, sadece arayüzde değil).
- Liderliği sıfırlamak için Supabase SQL editöründe: `truncate public.scores;`

## Mesaj bütçesi: bunu atlama

Supabase, gönderilen ve teslim edilen her mesajı ayrı bir olay olarak sayar. Tek bir yayın 25 kişiye gidiyorsa 25 olay yazılır. Kotayı aşan proje bağlantıları keser.

Konum mesajları her oyuncunun kendi kanalında akar ve sadece host'a gider (mesaj başına 2 olay), diğer telefonlara dağıtılmaz. Liderlik Realtime üzerinden değil, doğrudan veritabanından okunur; bu yüzden oyuncu sayısı arttıkça asıl yük konum mesajlarından gelir.

Aynı anda oynayan oyuncu sayısıyla tahmini yük:

| | Konum | Plan limiti |
|---|---|---|
| `free` (1 Hz) | ~2/s/oyuncu | 100/s → ~50 eşzamanlı oyuncuya kadar rahat |
| `pro` (4 Hz) | ~8/s/oyuncu | 500/s → ~60 eşzamanlı oyuncuya kadar rahat |

**Free plandaki bedel:** Projeksiyondaki mini toplar saniyede bir güncellenir. Aradaki hareket host tarafında yumuşatılır ama akış yine de biraz kesik görünür.

Host tek istemci olarak en fazla 100 kanala girebilir, bu yüzden **toplam katılımcı sayısının** (aynı anda oynamasa da) üst sınırı ~99'dur.

## Ses

Telefonda ve host'ta geri sayım, yıldız, tuzak, bitiş ve rekor için kısa sesler çalar. Harici ses dosyası yok, hepsi `js/sound.js` içinde Web Audio API ile anlık üretilir. Sağ üstteki hoparlör düğmesiyle (host'ta kontrol çubuğunda "Ses kapat") herkes kendi cihazında kapatabilir, tercih o cihazda hatırlanır. iOS kuralı gereği ses ancak bir dokunuşun içinde açılır; telefonda KATIL'a basınca, host'ta ilk tıklama ya da tuşa basmada otomatik açılır.

## Etkinlik günü kontrol listesi

- [ ] Free plan projeleri 1 hafta hareketsiz kalınca uyku moduna geçer. Bir gün önce host'u açıp projeyi uyandır.
- [ ] Salonun Wi-Fi'ı istemci izolasyonu yapıyor olabilir. Bu sorun değil, çünkü her şey internet üzerinden gider. Ama mobil veri yedeğini söyle.
- [ ] Host bilgisayarının uyku modunu kapat. Tarayıcı sekmesi arka plana düşerse zamanlayıcılar yavaşlar.
- [ ] Host sayfasını **yenile**: sorun olmaz, izleme durumu kısa sürede kendiliğinden toparlanır (telefonlar tekrar bağlanır), skorlar zaten veritabanında.
- [ ] Başlamadan önce "ekran kilidi / düşük güç modu kapalı olsun" diye anons et. Ekran uyanık tutma (Wake Lock) çoğu telefonda çalışır ama garanti değil.
- [ ] Yönetici kodunu masaüstü/projeksiyon bilgisayarında bir kez gir; o cihazda hatırlanır.

## Bilinen sınırlar

- **Hile koruması temel düzeyde.** Host, `minPlausibleMs` değerinden hızlı bitişleri reddeder. Tarayıcı konsolunu bilen biri sahte `fin` mesajı yollayabilir. Oryantasyon için yeterli, ödüllü yarış için değil.
- **Her oyun farklı labirentte geçtiği için** süreler tam eşit koşullarda değildir; labirent boyutu ve yıldız/tuzak sayısı sabit olduğundan karşılaştırma yaklaşık olarak adildir.
- **Liderlik de temel düzeyde korunur.** Anon anahtarı bilen biri `scores` tablosuna doğrudan sahte süre eklemeyi dener, ama engellenmiş bir `pid` ile yazamaz; engellenmemiş biri yine de sahte satır ekleyebilir. Gerekirse Supabase panelinden satır silinir.
- **Yönetici kodu tek ve paylaşılır.** Kod bilen herkes engelleme yapabilir/kaldırabilir. Yalnızca güvendiğin görevlilerle paylaş.
- **Sadece dikey mod.** Telefon yatay çevrilirse "Telefonu dik tut" uyarısı çıkar.
