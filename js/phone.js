import { GAME, PHYSICS, RATES, ROOM } from './config.js';
import { generateMaze } from './maze.js';
import { createBall, stepBall, tiltToAccel, checkEvents } from './physics.js';
import { setupCanvas, buildMazeLayer, drawFrame, drawGauge } from './render.js';
import { isConfigured, joinChannel, send, ctrlTopic, playerTopic, saveScores, fetchStanding, fetchLeaderboard, isBanned } from './net.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const TEST = params.has('test'); // masaüstünde ok tuşlarıyla test

// ---------- Kimlik ----------
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
let pid = store.get('dl-pid');
if (!pid) { pid = Math.random().toString(36).slice(2, 8); store.set('dl-pid', pid); }
const room = ROOM;
let name = store.get('dl-name') || '';

// ---------- Durum ----------
const S = {
  hostId: null, plays: 0, best: null, seed: 0, banned: false, // best: { best_ms, rank, total, runs } (genel liderlik)
  maze: null, layer: null, ctx: null,
  ball: null, collected: new Set(), falls: 0, trail: [], lastTrailT: 0,
  falling: null, respawnAt: null, popFx: null,
  countdownEnd: 0, playing: false, startT: 0, finished: false, raw: 0, finishShownAt: 0,
  base: { b: 0, g: 0 }, samples: [],
};
let ctrlCh = null, meCh = null, posTimer = null;

// ---------- Ekran yönetimi ----------
function show(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
  if (id === 's-game') requestAnimationFrame(layoutMaze);
}

// ---------- Sensör ----------
const ori = { beta: 0, gamma: 0, has: false };
window.addEventListener('deviceorientation', (e) => {
  if (e.beta == null || e.gamma == null) return;
  ori.beta = e.beta; ori.gamma = e.gamma; ori.has = true;
});
const keys = new Set();
window.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow') && S.playing) { keys.add(e.key); e.preventDefault(); } });
window.addEventListener('keyup', (e) => keys.delete(e.key));

function rawTilt() {
  if (keys.size || (TEST && !ori.has)) {
    return { g: (keys.has('ArrowRight') ? 18 : 0) - (keys.has('ArrowLeft') ? 18 : 0), b: (keys.has('ArrowDown') ? 18 : 0) - (keys.has('ArrowUp') ? 18 : 0), kb: true };
  }
  return { g: ori.gamma, b: ori.beta, kb: false };
}
function tilt() {
  const r = rawTilt();
  if (r.kb) return { x: r.g, y: r.b };
  return { x: r.g - S.base.g, y: r.b - S.base.b };
}

async function askSensorPermission() {
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    try {
      const res = await DOE.requestPermission();
      return res === 'granted';
    } catch { return false; }
  }
  return true; // Android / masaüstü: izin gerekmez
}

let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeLock) keepAwake(); });

// ---------- Katılım ----------
const nameInput = $('#name-input');
nameInput.value = name;

function joinError(msg) {
  $('#join-note').classList.add('error');
  $('#join-msg').textContent = msg;
  const btn = $('#join-btn'); btn.disabled = false; btn.firstChild.textContent = 'KATIL';
}

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  // İzin isteği kullanıcı dokunuşunun içinde, ilk await olarak çağrılmalı (iOS kuralı)
  const granted = await askSensorPermission();
  const n = nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 12);
  if (!n) { nameInput.focus(); return joinError('Bir takma ad yaz, liderlikte bu isimle görüneceksin.'); }
  if (!granted) return joinError('Sensör izni verilmedi. Ayarlar › Safari › Hareket ve Yön Erişimi’ni aç, sayfayı yenile.');
  if (!isConfigured()) return joinError('Sunucu ayarı eksik: js/config.js içindeki Supabase bilgilerini doldur.');

  const btn = $('#join-btn'); btn.disabled = true; btn.firstChild.textContent = 'BAĞLANIYOR';
  try { S.banned = await isBanned(pid); } catch { /* ağ hatasında oyuna izin ver, skor yazımı yine engellenir */ }
  btn.disabled = false; btn.firstChild.textContent = 'KATIL';
  if (S.banned) return showBanned();

  name = n; store.set('dl-name', name);
  nameInput.blur();
  keepAwake();
  $('#hud-name').textContent = name;
  $('#res-name').textContent = name;
  connect(); // projeksiyon açıksa canlı izlensin; oyun bunu beklemez
  refreshBest();
  startGame();
});

// ---------- Projeksiyon (isteğe bağlı) ----------
// Host açıksa oyuncunun topu projeksiyonda canlı görünür. Host yoksa oyun aynen çalışır.
async function connect() {
  if (ctrlCh) return;
  try {
    ctrlCh = await joinChannel(ctrlTopic(room), { state: onHostState }, onChannelStatus);
    meCh = await joinChannel(playerTopic(room, pid), { ban: showBanned }, () => {});
    sayHello();
  } catch (err) { console.warn('Projeksiyona bağlanılamadı', err); }
}
function onChannelStatus(status) { if (status === 'SUBSCRIBED' && ctrlCh) sayHello(); }
function onHostState(st) {
  // Host sayfası açıldı ya da yenilendi: kendini tanıt
  if (st.hostId !== S.hostId) { S.hostId = st.hostId; sayHello(); }
}
function sayHello() { send(ctrlCh, 'hello', { pid, name }); }

// ---------- Oyun ----------
// Her oyunda yeni labirent. Seed konum mesajıyla projeksiyona gider, o da aynı labirenti çizer.
function startGame() {
  if (S.banned) return showBanned();
  S.plays++;
  S.seed = (Math.random() * 4294967296) >>> 0;
  S.maze = generateMaze(S.seed, { w: GAME.mazeW, h: GAME.mazeH, stars: GAME.stars, traps: GAME.traps, loops: GAME.loops });
  S.ball = createBall(S.maze);
  S.collected = new Set(); S.falls = 0; S.trail = []; S.falling = null; S.respawnAt = null; S.popFx = null;
  S.finished = false; S.playing = false; S.raw = 0;
  S.samples = [];
  S.countdownEnd = performance.now() + GAME.countdownSeconds * 1000;
  updateStarsHud(); updateFallsHud(); updateBestHud();
  $('#timer').textContent = fmt(0);
  $('#countdown').hidden = false;
  show('s-game');
}

function goPlaying() {
  // Kalibrasyon: geri sayımın son saniyesindeki ortalama açı "düz" kabul edilir
  if (ori.has && S.samples.length) {
    S.base.b = S.samples.reduce((a, s) => a + s.b, 0) / S.samples.length;
    S.base.g = S.samples.reduce((a, s) => a + s.g, 0) / S.samples.length;
  } else { S.base.b = ori.beta; S.base.g = ori.gamma; }
  S.playing = true;
  S.startT = performance.now();
  clearInterval(posTimer);
  posTimer = setInterval(sendPos, 1000 / RATES.posHz);
  sendPos();
}

function sendPos() {
  if (!S.playing || S.finished || !S.ball || !meCh) return;
  const b = S.falling ? S.falling : S.ball;
  send(meCh, 'pos', {
    r: S.plays, sd: S.seed,
    x: Math.round(b.x * 100), y: Math.round(b.y * 100),
    p: Math.round(S.maze.progressAt(S.ball.x, S.ball.y) * 100),
    f: S.falling ? 1 : 0, s: S.collected.size,
  });
}

// Süre sınırı doldu
function timeUp() {
  S.playing = false;
  clearInterval(posTimer);
  send(meCh, 'out', { r: S.plays });
  if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
  const pct = Math.round(S.maze.progressAt(S.ball.x, S.ball.y) * 100);
  loadBoard().then(({ st, top }) => showResults({ timeout: true, pct, stars: S.collected.size, falls: S.falls, st, top }));
}

function finish(now) {
  S.finished = true;
  S.playing = false;
  clearInterval(posTimer);
  S.raw = Math.round(now - S.startT);
  const stars = S.collected.size, falls = S.falls, raw = S.raw;
  const net = Math.max(0, raw - stars * GAME.starBonusMs);
  send(meCh, 'fin', { r: S.plays, sd: S.seed, raw, stars, falls });
  if (navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 160]);
  $('#finish-chip').textContent = `OYUN ${S.plays} · BİTİŞ`;
  $('#finish-net').textContent = fmt(net);
  $('#finish-detail').textContent = stars
    ? `${fmtSec(raw)} sn − ${fmtSec(stars * GAME.starBonusMs)} sn yıldız bonusu`
    : `${fmtSec(raw)} sn · yıldız bonusu yok`;
  renderStars($('#finish-stars'), stars, 22, false);
  $('#finish-stars-sub').textContent = `${stars}/${GAME.stars} yıldız`;
  $('#finish-rank').textContent = '–';
  $('#finish-rank-sub').textContent = 'genel sıra hesaplanıyor';
  S.finishShownAt = performance.now();
  show('s-finish');
  startConfetti();
  saveAndShow({ raw, net, stars, falls });
}

// ---------- Skor / liderlik ----------
async function refreshBest() {
  try { S.best = await fetchStanding(pid); } catch { /* ağ yoksa rekor gösterilmez */ }
  updateBestHud();
}

async function loadBoard() {
  try {
    const [st, top] = await Promise.all([fetchStanding(pid), fetchLeaderboard(5)]);
    S.best = st;
    return { st, top };
  } catch (e) { console.warn('Liderlik alınamadı', e); return { st: null, top: [] }; }
}

async function saveAndShow(r) {
  const prevBest = S.best?.best_ms ?? null;
  let saved = true, tooFast = false;
  if (r.raw < GAME.minPlausibleMs) { saved = false; tooFast = true; }
  else {
    try {
      await saveScores([{ pid, name, net_ms: r.net, raw_ms: r.raw, stars: r.stars, falls: Math.min(r.falls, 999), room, round: S.plays, seed: S.seed }]);
    } catch (e) { console.error('Skor kaydedilemedi', e); saved = false; }
  }
  const { st, top } = await loadBoard();
  if (st) {
    $('#finish-rank').textContent = `${st.rank}.`;
    $('#finish-rank-sub').textContent = `genel sıra · ${st.total} oyuncu`;
  }
  // Bitirdin ekranı en az 3,5 sn görünsün
  const wait = Math.max(0, 3500 - (performance.now() - S.finishShownAt));
  setTimeout(() => showResults({ ...r, saved, tooFast, prevBest, st, top }), wait);
}

function showResults(r) {
  stopConfetti();
  const record = !r.timeout && r.saved && prevBestBeaten(r);
  const first = !r.timeout && r.saved && r.prevBest == null;
  $('#res-chip').textContent = `OYUN ${S.plays}`;
  $('#res-title').textContent = r.timeout ? 'SÜRE DOLDU' : record ? 'YENİ REKOR!' : 'BİTİRDİN';
  if (r.st) {
    $('#res-rank').textContent = `${r.st.rank}.`;
    $('#res-of').textContent = `genel sıra · ${r.st.total} oyuncu`;
  } else {
    $('#res-rank').textContent = '–';
    $('#res-of').textContent = r.timeout ? 'henüz skorun yok' : 'genel sıra alınamadı';
  }
  let note = '';
  if (r.timeout) note = 'Süre dolmadan bitişe ulaşamadın.';
  else if (r.tooFast) note = 'Bu bitiş olağandışı hızlı, skor sayılmadı.';
  else if (!r.saved) note = 'Skor kaydedilemedi. İnternetini kontrol et.';
  else if (record) note = `Önceki rekorun ${fmtSec(r.prevBest)} sn idi.`;
  else if (first) note = 'İlk skorun liderliğe yazıldı.';
  else if (r.st) note = `Rekorun ${fmtSec(r.st.best_ms)} sn.`;
  $('#res-note').textContent = note;
  const dl = $('#res-breakdown');
  if (!r.timeout) {
    dl.innerHTML = `
      <dt>Ham süre</dt><dd>${fmtSec(r.raw)} sn</dd>
      <dt>Yıldız bonusu (${r.stars} × ${GAME.starBonusMs / 1000} sn)</dt><dd class="bonus">−${fmtSec(r.stars * GAME.starBonusMs)} sn</dd>
      <dt>Düşme</dt><dd>${r.falls} kez</dd>
      <dt class="total">NET SÜRE</dt><dd class="total">${fmtSec(r.net)}</dd>`;
  } else {
    dl.innerHTML = `
      <dt>İlerleme</dt><dd>%${r.pct}</dd>
      <dt>Yıldız</dt><dd>${r.stars}/${GAME.stars}</dd>
      <dt>Düşme</dt><dd>${r.falls} kez</dd>`;
  }
  const ol = $('#res-top');
  ol.innerHTML = '';
  r.top.forEach((row) => {
    const li = document.createElement('li');
    if (row.rank === 1) li.classList.add('lead');
    if (row.pid === pid) li.classList.add('me');
    li.innerHTML = `<span class="r">${row.rank}</span>${row.rank === 1 ? crownSvg : ''}<span class="nm"></span><span class="num">${fmtSec(row.net_ms)}</span>`;
    li.querySelector('.nm').textContent = row.name;
    if (row.pid === pid) li.querySelector('.nm').insertAdjacentHTML('beforeend', '<span class="you">SEN</span>');
    ol.appendChild(li);
  });
  $('#res-top-wrap').hidden = !r.top.length;
  updateBestHud();
  show('s-results');
}
// Yönetici bu cihazı engelledi
function showBanned() {
  S.banned = true;
  S.playing = false; S.countdownEnd = 0;
  clearInterval(posTimer);
  stopConfetti();
  setWait('Engellendin', 'Bu cihaz yönetici tarafından oyundan çıkarıldı. Bir hata olduğunu düşünüyorsan görevliye söyle.');
  $('#wait-tip').hidden = true; $('#wait-lb').hidden = true;
  show('s-wait');
}

// Başlık fontunda küçük "ı" yok: Türkçe büyük harfe çevir
function setWait(title, text) { $('#wait-title').textContent = title.toLocaleUpperCase('tr-TR'); $('#wait-text').textContent = text; }

function prevBestBeaten(r) { return r.prevBest != null && r.net < r.prevBest; }

$('#again-btn').addEventListener('click', () => startGame());

const crownSvg = '<svg width="22" height="18" viewBox="0 0 28 22" aria-label="Lider"><path d="M3 18L5 6L10.5 11L14 3L17.5 11L23 6L25 18Z" fill="#FFC94D" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/><rect x="3" y="18" width="22" height="3" rx="1" fill="#FFC94D"/></svg>';

// Oyun ekranındaki rozet: genel sıran ve rekorun
function updateBestHud() {
  const b = S.best;
  $('#rank-num').textContent = b ? `${b.rank}.` : '–';
  $('#rank-small').textContent = b ? 'Rekorun' : 'İlk oyunun';
  $('#rank-line').textContent = b ? `${fmtSec(b.best_ms)} sn` : 'rekorunu koy';
}

// ---------- HUD ----------
const starPoly = '<polygon points="12,0 15.06,7.79 23.41,8.29 16.95,13.61 19.05,21.71 12,17.2 4.95,21.71 7.05,13.61 .59,8.29 8.94,7.79"/>';
const starPolyOff = '<polygon points="12,1.5 14.8,8.4 22,8.8 16.4,13.5 18.2,20.6 12,16.7 5.8,20.6 7.6,13.5 2,8.8 9.2,8.4"/>';
function renderStars(el, n, size, withCount) {
  let html = '';
  for (let i = 0; i < GAME.stars; i++) html += `<svg class="star-icon ${i < n ? 'on' : 'off'}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${i < n ? starPoly : starPolyOff}</svg>`;
  if (withCount) html += `<span class="count">${n}/${GAME.stars}</span>`;
  el.innerHTML = html;
}
function updateStarsHud() { renderStars($('#hud-stars'), S.collected.size, 20, true); }
function updateFallsHud() { $('#hud-falls').textContent = `${S.falls} düşme`; }

function fmt(ms) {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), cs = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(cs).padStart(2, '0')}`;
}
function fmtSec(ms) { return (ms / 1000).toFixed(2).replace('.', ','); }

// ---------- Çizim ----------
const canvas = $('#maze-canvas');
const gaugeSizeFor = () => (matchMedia('(max-height: 720px)').matches ? 96 : 132);
let gaugeSize = gaugeSizeFor();
const gaugeCtx = setupCanvas($('#gauge'), gaugeSize, gaugeSize);

function layoutMaze() {
  if (!S.maze) return;
  const card = $('#maze-card');
  const w = card.clientWidth - 14, h = card.clientHeight - 14;
  if (w < 50 || h < 50) return;
  const aspect = (S.maze.w + 0.6) / (S.maze.h + 0.6);
  let cw = w, ch = w / aspect;
  if (ch > h) { ch = h; cw = h * aspect; }
  S.ctx = setupCanvas(canvas, Math.floor(cw), Math.floor(ch));
  S.layer = buildMazeLayer(S.maze, Math.floor(cw), Math.floor(ch));
  gaugeSize = gaugeSizeFor();
  setupCanvas($('#gauge'), gaugeSize, gaugeSize);
}
window.addEventListener('resize', () => { if ($('#s-game').classList.contains('active')) layoutMaze(); });

let lastT = performance.now(), lastGaugeText = '';
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  if ($('#s-game').classList.contains('active') && S.maze) {
    // Geri sayım
    if (!S.playing && !S.finished && S.countdownEnd) {
      const left = S.countdownEnd - now;
      const cd = $('#countdown-num');
      const label = left > 0 ? String(Math.ceil(left / 1000)) : 'BAŞLA!';
      if (cd.textContent !== label) {
        cd.textContent = label; cd.classList.toggle('go', left <= 0);
        cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
        if (navigator.vibrate && left > 0) navigator.vibrate(30);
      }
      if (left < 1000 && left > 0 && ori.has) S.samples.push({ b: ori.beta, g: ori.gamma });
      if (left <= 0) { S.countdownEnd = 0; goPlaying(); setTimeout(() => { $('#countdown').hidden = true; }, 500); }
    }

    const t = S.playing ? tilt() : { x: 0, y: 0 };

    if (S.playing && !S.finished) {
      if (S.falling) {
        if (now - S.falling.t > 550) {
          S.ball.x = S.maze.start.x; S.ball.y = S.maze.start.y; S.ball.vx = 0; S.ball.vy = 0;
          S.falling = null; S.respawnAt = now; S.trail = [];
        }
      } else {
        const { ax, ay } = tiltToAccel(t.x, t.y);
        stepBall(S.ball, S.maze, ax, ay, dt);
        if (now - S.lastTrailT > 28) {
          S.trail.push({ x: S.ball.x, y: S.ball.y }); S.lastTrailT = now;
          if (S.trail.length > 9) S.trail.shift();
        }
        const ev = checkEvents(S.ball, S.maze, S.collected);
        if (ev?.type === 'star') {
          S.collected.add(ev.i); S.popFx = { t: now, x: S.maze.stars[ev.i].x, y: S.maze.stars[ev.i].y };
          updateStarsHud(); if (navigator.vibrate) navigator.vibrate(25);
        } else if (ev?.type === 'trap') {
          const tr = S.maze.traps[ev.i];
          S.falling = { t: now, x: tr.x, y: tr.y }; S.falls++; updateFallsHud(); S.trail = [];
          const card = $('#maze-card'); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
          if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
        } else if (ev?.type === 'finish') {
          finish(now);
        }
      }
      if (S.playing) {
        $('#timer').textContent = fmt(now - S.startT);
        if (now - S.startT >= GAME.roundSeconds * 1000) timeUp();
      }
    }

    if (S.ctx && S.layer) drawFrame(S.ctx, S.layer, S.maze, S, now);

    // Pusula
    const gt = S.playing ? t : (ori.has ? { x: ori.gamma - S.base.g, y: ori.beta - S.base.b } : { x: 0, y: 0 });
    drawGauge(gaugeCtx, gaugeSize, gt.x, gt.y, PHYSICS.maxTiltDeg);
    const tx = Math.round(gt.x), ty = Math.round(gt.y);
    const txt = `${tx}|${ty}`;
    if (txt !== lastGaugeText) {
      lastGaugeText = txt;
      $('#tilt-x').textContent = Math.abs(tx) < 2 ? 'DÜZ' : `${tx > 0 ? 'SAĞA' : 'SOLA'} ${Math.abs(tx)}°`;
      $('#tilt-y').textContent = Math.abs(ty) < 2 ? '\u00a0' : `${ty > 0 ? 'AŞAĞI' : 'YUKARI'} ${Math.abs(ty)}°`;
    }
  }

  if (confetti.running) stepConfetti(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- Konfeti ----------
const confetti = { running: false, parts: [], ctx: null, w: 0, h: 0, until: 0 };
function startConfetti() {
  const c = $('#confetti');
  confetti.w = c.clientWidth || innerWidth; confetti.h = c.clientHeight || innerHeight;
  confetti.ctx = setupCanvas(c, confetti.w, confetti.h);
  const colors = ['#4FB8F0', '#FFFFFF', '#FFC94D', '#1C5F95'];
  confetti.parts = Array.from({ length: 140 }, (_, i) => ({
    x: Math.random() * confetti.w, y: -20 - Math.random() * confetti.h,
    vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 200,
    rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10,
    w: 6 + Math.random() * 6, h: 10 + Math.random() * 10, round: Math.random() < 0.25,
    c: colors[i % colors.length], flip: Math.random() * 6,
  }));
  confetti.until = performance.now() + 6000;
  confetti.running = true;
}
function stopConfetti() { confetti.running = false; confetti.ctx?.clearRect(0, 0, confetti.w, confetti.h); }
function stepConfetti(dt) {
  const { ctx, w, h } = confetti;
  const now = performance.now();
  ctx.clearRect(0, 0, w, h);
  let alive = 0;
  for (const p of confetti.parts) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.flip += dt * 8;
    p.vx += Math.sin(p.flip) * 8 * dt;
    if (p.y > h + 30) { if (now < confetti.until) { p.y = -20; p.x = Math.random() * w; } else continue; }
    alive++;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.flip));
    ctx.fillStyle = p.c;
    if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  if (!alive) stopConfetti();
}

// Bitirdin ışınları
const rays = $('#rays');
for (let i = 0; i < 12; i++) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M110 110L100 0H120Z'); p.setAttribute('transform', `rotate(${i * 30} 110 110)`);
  rays.appendChild(p);
}
