# Denge Labirenti

Telefonu eğerek oynanan, çok oyunculu labirent yarışı. Statik site (Vercel) + Supabase Realtime Broadcast. Build adımı yok, sunucu kodu yok, veritabanı tablosu yok.

```
index.html      → katılımcı telefonu (/?oda=4827)
host.html       → projeksiyon ekranı (/host)
js/config.js    → Supabase bilgileri, oyun ve fizik ayarları
js/maze.js      → seed'li labirent üretimi (her cihaz aynı seed'den aynı labirenti üretir)
js/physics.js   → top fiziği, duvar çarpışması, yıldız/tuzak/bitiş
js/render.js    → canvas çizimleri (labirent, top, iz, pusula, mini kartlar)
js/net.js       → Supabase kanal sarmalayıcı
js/phone.js     → telefon akışı
js/host.js      → host akışı, sıralama, tur yönetimi
```

## Kurulum

1. **Supabase projesi aç.** Proje açıldıktan sonra Project Settings › API sayfasından `Project URL` ve `anon` anahtarını al.
2. **Realtime ayarını kontrol et.** Realtime › Settings sayfasında public kanallara izin verildiğinden emin ol. "Private channels only" açıksa telefonlar bağlanamaz.
3. **`js/config.js` dosyasını doldur.** `SUPABASE_URL` ve `SUPABASE_ANON_KEY` alanlarını gir. `PLAN` değerini hesabına göre `'free'` ya da `'pro'` yap.
4. **Vercel'e deploy et.** İki yol var:
   - `npx vercel --prod` komutunu klasörün içinde çalıştır.
   - Ya da repoyu GitHub'a at ve Vercel'den "Import" ile bağla. Framework seçimi: **Other**. Build komutu boş, output klasörü `.` (kök).
5. **Host ekranını aç.** Projeksiyondaki bilgisayarda `https://<alan-adın>/host` adresini aç, `F` ile tam ekrana geç. Oda kodu otomatik üretilir ve adres çubuğuna yazılır. Sayfayı yenilemek aynı odayı korur.

## Test

- **Arayüz, Supabase'siz:** `/host?bots=20` 20 sahte oyuncu açar. `S` ile turu başlat. Botlar sadece host tarafında yaşar, ağ trafiği üretmez.
- **Telefonu masaüstünde denemek:** `/?oda=XXXX&test` açıp ok tuşlarıyla oynarsın. Oda kodu host ekranındaki kodla aynı olmalı.
- **Gerçek test:** En az bir iPhone ve bir Android ile dene. iOS'te sensör izni sadece HTTPS'te ve KATIL'a dokunulduğu anda istenebilir. Localhost'ta iPhone test edemezsin, deploy edilmiş adresi kullan.

## Host kontrolleri

Fareyi oynatınca sol altta kontroller belirir, 3 saniye sonra kaybolur. Projeksiyonda yer kaplamazlar.

| Tuş | İşlev |
|---|---|
| `S` | Turu başlat. Tur sonu ekranındayken bekleme süresini atlar. |
| `E` | Turu erken bitir |
| `F` | Tam ekran |
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
- **Tur puanları toplanmıyor.** Her tur kendi sıralamasına sahip, final podyumu son turu gösterir. Genel klasman istersen `host.js` › `endRound` içinde puanları biriktir.
- **Sadece dikey mod.** Telefon yatay çevrilirse "Telefonu dik tut" uyarısı çıkar.
