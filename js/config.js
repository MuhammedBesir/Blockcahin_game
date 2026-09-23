// Denge Labirenti — ayarlar
// Supabase proje bilgilerini buraya yaz. Anon key tarayıcıda görünür; bu normal.
// Broadcast kanalları veritabanına dokunmaz, tablo gerekmez.

export const SUPABASE_URL = 'https://lpijoddaoxdmvuqeborx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwaWpvZGRhb3hkbXZ1cWVib3J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxODcyNjMsImV4cCI6MjEwNTc2MzI2M30.C_6PJrzCVaug1cKM_o_bg-l9VRcCEXWNwrJoYNsl3xM';

// 'free' veya 'pro'. Mesaj hızlarını belirler (README'de hesabı var).
// Free plan: saniyede 100 olay (gönderilen + teslim edilen), 24 oyuncuyla ancak yavaş güncellemeyle sığar.
export const PLAN = 'free';

export const RATES = {
  free: { posHz: 1, rankMinMs: 2000, heartbeatMs: 6000 },
  pro:  { posHz: 4, rankMinMs: 1000, heartbeatMs: 5000 },
}[PLAN];

export const GAME = {
  rounds: 3,
  roundSeconds: 90,       // tur süre sınırı
  countdownSeconds: 3,
  resultsSeconds: 15,     // tur sonu ekranı, sonra sonraki tur otomatik başlar
  mazeW: 8,
  mazeH: 11,
  stars: 5,
  traps: 5,
  loops: 6,               // ek kısa yollar (0 = tek çözümlü labirent)
  starBonusMs: 1000,      // her yıldız net süreden düşer
  minPlausibleMs: 4000,   // bundan hızlı bitiş hile sayılır, reddedilir
};

export const PHYSICS = {
  ballR: 0.3,             // hücre birimi
  wallHalf: 0.075,
  gravity: 20,            // tam eğimde ivme (hücre/s²)
  maxTiltDeg: 35,         // bu açıdan fazlası kırpılır
  deadzoneDeg: 1.5,
  friction: 1.1,          // saniyedeki hız kaybı katsayısı
  bounce: 0.35,
  maxSpeed: 7,
  starR: 0.26,
  finishR: 0.36,
};
