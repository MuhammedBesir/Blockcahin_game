# Denge Labirenti

Telefonu eğerek oynanan, çok oyunculu labirent yarışı. Statik site (Vercel) + Supabase Realtime Broadcast. Build adımı yok, sunucu kodu yok. Tek veritabanı tablosu kalıcı liderlik için (`scores`).

```
index.html      → katılımcı telefonu (/)
host.html       → projeksiyon ekranı (/host)
liderler.html   → genel liderlik sayfası (/liderler)
js/config.js    → Supabase bilgileri, oyun ve fizik ayarları
js/maze.js      → seed'li labirent üretimi (her cihaz aynı seed'den aynı labirenti üretir)
js/physics.js   → top fiziği, duvar çarpışması, yıldız/tuzak/bitiş
js/render.js    → canvas çizimleri (labirent, top, iz, pusula, mini kartlar)
js/net.js       → Supabase kanal sarmalayıcı
js/phone.js     → telefon akışı
js/host.js      → host akışı, sıralama, tur yönetimi
js/leaderboard.js → /liderler sayfası
supabase/migrations/ → liderlik tablosu (scores) ve sıralama fonksiyonları
```

## Kurulum

1. **Supabase projesi aç.** Proje açıldıktan sonra Project Settings › API sayfasından `Project URL` ve `anon` anahtarını al.
2. **Realtime ayarını kontrol et.** Realtime › Settings sayfasında public kanallara izin verildiğinden emin ol. "Private channels only" açıksa telefonlar bağlanamaz.
3. **`js/config.js` dosyasını doldur.** `SUPABASE_URL` ve `SUPABASE_ANON_KEY` alanlarını gir. `PLAN` değerini hesabına göre `'free'` ya da `'pro'` yap.
4. **Vercel'e deploy et.** İki yol var:
   - `npx vercel --prod` komutunu klasörün içinde çalıştır.
   - Ya da repoyu GitHub'a at ve Vercel'den "Import" ile bağla. Framework seçimi: **Other**. Build komutu boş, output klasörü `.` (kök).
5. **Host ekranını aç.** Projeksiyondaki bilgisayarda `https://<alan-adın>/host` adresini aç, `F` ile tam ekrana geç. Oda kodu yok: telefonlar QR'ı okutur ya da siteye girer, adını yazıp katılır. Tek bir oyun odası vardır (`js/config.js` › `ROOM`), bu yüzden aynı anda **tek host ekranı** açık olmalı. İki ayrı etkinliği aynı anda yapacaksan ikinci kopyada `ROOM` değerini değiştir.

## Test

- **Arayüz, Supabase'siz:** `/host?bots=20` 20 sahte oyuncu açar. `S` ile turu başlat. Botlar sadece host tarafında yaşar, ağ trafiği üretmez.
- **Telefonu masaüstünde denemek:** `/?test` açıp ok tuşlarıyla oynarsın.
- **Gerçek test:** En az bir iPhone ve bir Android ile dene. iOS'te sensör izni sadece HTTPS'te ve KATIL'a dokunulduğu anda istenebilir. Localhost'ta iPhone test edemezsin, deploy edilmiş adresi kullan.

## Host kontrolleri

Fareyi oynatınca sol altta kontroller belirir, 3 saniye sonra kaybolur. Projeksiyonda yer kaplamazlar.

| Tuş | İşlev |
|---|---|
| `S` | Turu başlat. Tur sonu ekranındayken bekleme süresini atlar. |
| `E` | Turu erken bitir |
| `F` | Tam ekran |
| `L` | Genel liderlik ↔ tur sonucu (tur dışındayken) |
| Oyunu sıfırla | Tur sayacını sıfırlar, oyuncular bağlı kalır |

**Tur akışı:** 3 sn geri sayım → en fazla 90 sn oyun → 15 sn sonuç ekranı → sonraki tur otomatik başlar. Herkes bitirirse tur erken kapanır. 3 turdan sonra podyum gösterilir.

## Oyun kuralları (kodda böyle)

- **Süre ölçümü:** Her telefon kendi süresini ölçer. Kronometre, geri sayım bittiği anda o telefonda başlar. Bu sayede ağ gecikmesi sıralamayı bozmaz.
- **Kalibrasyon:** Geri sayımın son saniyesindeki telefon açısı "düz" kabul edilir. Oyuncu telefonu masaya yatırmak zorunda kalmaz.
- **Net süre:** Ham süre − (yıldız × 1 sn).
- **Tuzak:** Deliğe düşen başa döner. Ayrıca ceza süresi yok, kaybedilen zaman zaten ceza.
- **Tuzak yerleşimi:** Tuzakların yarısı en kısa yol üzerindeki dönemeçlerin dış köşesinde durur (hızlı giren düşer). Diğer yarısı yan kollardadır. Yolun ortası hiçbir zaman kapanmaz. Bu, 200 seed üzerinde simülasyonla doğrulandı.
- **Canlı sıralama:** Bitirenler net süreye göre sıralanır. Bitirmeyenler ilerleme yüzdesine göre onların altına dizilir.
- **Tur sonunda bitiremeyenler:** Süre dolduğunda bitiremeyenler ilerlemelerine göre sıralanır.
- **Geç katılan:** Turun bitmesine 20 sn'den fazla varsa hemen başlar. Yoksa sonraki turu bekler.

## Genel liderlik (kalıcı)

- Her tur bittiğinde host, **bitiren** oyuncuların sürelerini Supabase'deki `scores` tablosuna yazar. Botlar ve bitiremeyenler yazılmaz. Hile filtresinden geçmeyen bitişler zaten kabul edilmez.
- Oyuncu kimliği telefonun tarayıcısındaki `dl-pid` değeridir. Aynı telefondan oynayan kişi tüm etkinlik boyunca aynı oyuncu sayılır. Liderlikte her oyuncunun **en iyi net süresi** yer alır.
- **Host:** Bekleme ekranında sağdaki tablo genel liderliği gösterir. Finalde podyumun altında ilk 5 çıkar. Tur sonunda `L` ile tur sonucu ↔ genel liderlik arasında geçilir.
- **Telefon:** Tur sonu ekranında genel sıran, en iyi süren ve "YENİ REKOR!" rozeti görünür. Karta dokununca `/liderler` yeni sekmede açılır (oyun bağlantısı kopmaz).
- **`/liderler`:** Herkese açık, 15 sn'de bir yenilenen tam liste.
- Veritabanı işlemleri Realtime mesaj bütçesine sayılmaz.
- Şema: `supabase/migrations/20260923190000_scores_leaderboard.sql`. Anon anahtar yalnızca ekleme ve okuma yapabilir; güncelleme/silme yasak. 4 sn'den kısa süreler reddedilir.
- Her tur farklı labirentte oynandığı için süreler tam eşit koşullarda değildir; labirent boyutu ve yıldız/tuzak sayısı sabit olduğundan karşılaştırma yaklaşık olarak adildir.
- Liderliği sıfırlamak için Supabase SQL editöründe: `truncate public.scores;`

## Mesaj bütçesi: bunu atlama

Supabase, gönderilen ve teslim edilen her mesajı ayrı bir olay olarak sayar. Tek bir yayın 25 kişiye gidiyorsa 25 olay yazılır. Kotayı aşan proje bağlantıları keser.

Bu yüzden kanal düzeni şöyle:

- **Konum mesajları** her oyuncunun kendi kanalında akar ve sadece host'a gider (mesaj başına 2 olay). Diğer telefonlara dağıtılmaz.
- **Sıralama** tek mesajla herkese gider. Sadece değiştiğinde ve en fazla `rankMinMs` aralıkla gönderilir.

24 oyuncuyla tahmini yük:

| | Konum | Sıralama | Durum yayını | Toplam | Plan limiti |
|---|---|---|---|---|---|
| `free` (1 Hz) | 48/s | ~12/s | ~4/s | **~65 olay/s** | 100/s |
| `pro` (4 Hz) | 192/s | ~25/s | ~5/s | **~222 olay/s** | 500/s |

**Free plandaki bedel:** Projeksiyondaki mini toplar saniyede bir güncellenir. Aradaki hareket host tarafında yumuşatılır ama akış yine de biraz kesik görünür.

**Oyuncu sayısı 24'ü geçecekse** hesabı yeniden yap:

- Free planda sınıra yaklaşırsın.
- Pro'da 60 oyuncuya kadar rahatsın.
- Host tek istemci olarak en fazla 100 kanala girebilir. Bu yüzden oyuncu sayısının üst sınırı ~99.

## Etkinlik günü kontrol listesi

- [ ] Free plan projeleri 1 hafta hareketsiz kalınca uyku moduna geçer. Bir gün önce host'u açıp projeyi uyandır.
- [ ] Salonun Wi-Fi'ı istemci izolasyonu yapıyor olabilir. Bu sorun değil, çünkü her şey internet üzerinden gider. Ama mobil veri yedeğini söyle.
- [ ] Host bilgisayarının uyku modunu kapat. Tarayıcı sekmesi arka plana düşerse zamanlayıcılar yavaşlar.
- [ ] Host sayfasını tur ortasında **yenileme**. Tur durumu sadece host'un belleğinde tutulur, yenilersen o tur kaybolur. Telefonlar kendiliğinden yeniden bağlanır.
- [ ] Başlamadan önce "ekran kilidi / düşük güç modu kapalı olsun" diye anons et. Ekran uyanık tutma (Wake Lock) çoğu telefonda çalışır ama garanti değil.

## Bilinen sınırlar

- **Hile koruması temel düzeyde.** Host, `minPlausibleMs` değerinden hızlı ve geçen tur süresinden uzun bitişleri reddeder. Tarayıcı konsolunu bilen biri sahte `fin` mesajı yollayabilir. Oryantasyon için yeterli, ödüllü yarış için değil.
- **Final podyumu son turu gösterir.** Tüm zamanların sıralaması ayrıca genel liderlikte tutulur.
- **Liderlik de temel düzeyde korunur.** Anon anahtarı bilen biri `scores` tablosuna doğrudan sahte süre ekleyebilir. Gerekirse Supabase panelinden satır silinir.
- **Sadece dikey mod.** Telefon yatay çevrilirse "Telefonu dik tut" uyarısı çıkar.
