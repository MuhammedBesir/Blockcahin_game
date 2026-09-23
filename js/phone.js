import { GAME, PHYSICS, RATES } from './config.js';
import { generateMaze } from './maze.js';
import { createBall, stepBall, tiltToAccel, checkEvents } from './physics.js';
import { setupCanvas, buildMazeLayer, drawFrame, drawGauge } from './render.js';
import { isConfigured, joinChannel, send, ctrlTopic, playerTopic } from './net.js';

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
let room = (params.get('oda') || '').replace(/\D/g, '').slice(0, 6);
let name = store.get('dl-name') || '';

// ---------- Durum ----------
const S = {
  hostId: null, welcomed: false, phaseKey: '',
  round: 0, seed: null, rounds: GAME.rounds,
  maze: null, layer: null, ctx: null,
  ball: null, collected: new Set(), falls: 0, trail: [], lastTrailT: 0,
  falling: null, respawnAt: null, popFx: null,
  countdownEnd: 0, playing: false, startT: 0, finished: false, raw: 0, finishShownAt: 0,
  rank: null, total: 0, rankAtFinish: null,
  pendingResults: null,
  base: { b: 0, g: 0 }, samples: [],
};
let ctrlCh = null, meCh = null, helloTimer = null, posTimer = null;

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
const roomChip = $('#room-chip');
const nameInput = $('#name-input');
const roomInput = $('#room-input');
nameInput.value = name;
if (room) roomChip.textContent = `ODA ${room}`;
else { roomChip.hidden = true; $('#room-field').hidden = false; }

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
  if (!room) room = roomInput.value.replace(/\D/g, '').slice(0, 6);
  if (!room || room.length < 4) return joinError('Oda kodunu yaz. Projeksiyonda QR’ın yanında görünüyor.');
  if (!n) { nameInput.focus(); return joinError('Bir takma ad yaz, projeksiyonda bu isimle görüneceksin.'); }
  if (!granted) return joinError('Sensör izni verilmedi. Ayarlar › Safari › Hareket ve Yön Erişimi’ni aç, sayfayı yenile.');
  if (!isConfigured()) return joinError('Sunucu ayarı eksik: js/config.js içindeki Supabase bilgilerini doldur.');

  name = n; store.set('dl-name', name);
  const btn = $('#join-btn'); btn.disabled = true; btn.firstChild.textContent = 'BAĞLANIYOR';
  keepAwake();
  if (params.get('oda') !== room) history.replaceState(null, '', `?oda=${room}${TEST ? '&test' : ''}`);
  try {
    await connect();
  } catch (err) {
    console.error(err);
    return joinError('Bağlanılamadı. İnternetini kontrol edip tekrar dene.');
  }
  $('#hud-name').textContent = name;
  $('#res-name').textContent = name;
  setWait('Hazırsın, ' + name, 'Projeksiyona bağlanılıyor…');
  show('s-wait');
});

function setWait(title, text) { $('#wait-title').textContent = title; $('#wait-text').textContent = text; }

// ---------- Ağ ----------
function onChannelStatus(status) {
  $('#conn').hidden = status === 'SUBSCRIBED';
  if (status === 'SUBSCRIBED' && ctrlCh && !S.welcomed) sayHello();
}

async function connect() {
  ctrlCh = await joinChannel(ctrlTopic(room), { state: onState, ranks: onRanks, results: onResults }, onChannelStatus);
  meCh = await joinChannel(playerTopic(room, pid), { welcome: onWelcome }, onChannelStatus);
  sayHello();
  clearInterval(helloTimer);
  helloTimer = setInterval(() => { if (!S.welcomed) sayHello(); }, 3000);
}
function sayHello() { send(ctrlCh, 'hello', { pid, name }); }

function onWelcome(msg) {
  S.welcomed = true;
  S.hostId = msg.hostId;
  applyState(msg.state, true);
}

function onState(st) {
  if (st.hostId !== S.hostId) {
    // Host sayfası yenilenmiş: yeniden tanıt
    S.hostId = st.hostId; S.welcomed = false; sayHello();
  }
  applyState(st, false);
}

function applyState(st, force) {
  const key = `${st.hostId}:${st.round}:${st.seed}:${st.phase}`;
  if (!force && key === S.phaseKey) return;
  S.phaseKey = key;
  S.rounds = st.rounds || GAME.rounds;

  if (st.phase === 'LOBBY') {
    if (!S.playing) { setWait('Hazırsın, ' + name, 'Oyuncular toplanıyor. Tur başlayınca labirent ekranına geçeceksin.'); show('s-wait'); }
  } else if (st.phase === 'COUNTDOWN') {
    if (S.seed !== st.seed) startRound(st, st.countdownMs);
  } else if (st.phase === 'PLAYING') {
    if (S.seed !== st.seed) {
      // Geç katılan: kalan süre yeterliyse kısa geri sayımla hemen başlasın
      if (st.remainingMs > 20000) startRound(st, 3000);
      else { setWait('Tur bitmek üzere', 'Bir sonraki turda başlıyorsun.'); show('s-wait'); }
    }
  } else if (st.phase === 'ROUND_END' || st.phase === 'FINAL') {
    if (S.playing && !S.finished) stopPlaying();
  }
}

// ---------- Tur ----------
function startRound(st, countdownMs) {
  S.round = st.round; S.seed = st.seed;
  S.maze = generateMaze(st.seed, { w: GAME.mazeW, h: GAME.mazeH, stars: GAME.stars, traps: GAME.traps, loops: GAME.loops });
  S.ball = createBall(S.maze);
  S.collected = new Set(); S.falls = 0; S.trail = []; S.falling = null; S.respawnAt = null; S.popFx = null;
  S.finished = false; S.playing = false; S.raw = 0; S.rank = null; S.rankAtFinish = null; S.pendingResults = null;
  S.samples = [];
  S.countdownEnd = performance.now() + countdownMs;
  updateStarsHud(); updateFallsHud(); updateRankHud(null);
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

function stopPlaying() {
  S.playing = false;
  clearInterval(posTimer);
  $('#countdown').hidden = true;
  setWait('Süre doldu', 'Bu turu bitiremedin. Sonuçlar geliyor…');
  show('s-wait');
}

function sendPos() {
  if (!S.playing || S.finished || !S.ball) return;
  const b = S.falling ? S.falling : S.ball;
  send(meCh, 'pos', {
    r: S.round,
    x: Math.round(b.x * 100), y: Math.round(b.y * 100),
    p: Math.round(S.maze.progressAt(S.ball.x, S.ball.y) * 100),
    f: S.falling ? 1 : 0, s: S.collected.size,
  });
}

function finish(now) {
  S.finished = true;
  S.playing = false;
  clearInterval(posTimer);
  S.raw = Math.round(now - S.startT);
  send(meCh, 'fin', { r: S.round, raw: S.raw, stars: S.collected.size, falls: S.falls });
  if (navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 160]);
  S.rankAtFinish = null;
  const net = Math.max(0, S.raw - S.collected.size * GAME.starBonusMs);
  $('#finish-chip').textContent = `TUR ${S.round} · BİTİŞ`;
  $('#finish-net').textContent = fmt(net);
  $('#finish-detail').textContent = S.collected.size
    ? `${fmtSec(S.raw)} sn − ${fmtSec(S.collected.size * GAME.starBonusMs)} sn yıldız bonusu`
    : `${fmtSec(S.raw)} sn · yıldız bonusu yok`;
  renderStars($('#finish-stars'), S.collected.size, 22, false);
  $('#finish-stars-sub').textContent = `${S.collected.size}/${GAME.stars} yıldız`;
  updateFinishRank();
  S.finishShownAt = performance.now();
  show('s-finish');
  startConfetti();
}

// ---------- Sıralama / sonuç ----------
function onRanks(msg) {
  if (msg.round !== S.round) return;
  const r = msg.r[pid];
  S.total = msg.n;
  if (r == null) return;
  const prev = S.rank;
  S.rank = r;
  if (S.finished && S.rankAtFinish == null) S.rankAtFinish = r;
  updateRankHud(prev);
  updateFinishRank();
}

function updateRankHud(prev) {
  const badge = $('#rank-badge');
  if (S.rank == null) { $('#rank-num').textContent = '–'; $('#rank-line').textContent = 'sıra bekleniyor'; $('#rank-up').toggleAttribute('hidden', true); return; }
  $('#rank-num').textContent = `${S.rank}.`;
  $('#rank-line').textContent = `${S.rank}. sıradasın`;
  const up = prev != null && S.rank < prev;
  $('#rank-up').toggleAttribute('hidden', !up);
  if (prev != null && prev !== S.rank) { badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump'); }
}

function updateFinishRank() {
  $('#finish-rank').textContent = S.rank ? `${S.rank}.` : '–';
  $('#finish-rank-sub').textContent = S.rank ? `sıradasın · ${S.total} oyuncu` : 'sıra hesaplanıyor';
}

function onResults(res) {
  if (res.round !== S.round) {
    // Bu turu oynamadıysa sadece bekleme mesajı
    if (!S.playing) { setWait(res.final ? 'Oyun bitti' : 'Tur bitti', res.final ? 'Sonuçlar projeksiyonda.' : 'Bir sonraki turda başlıyorsun.'); show('s-wait'); }
    return;
  }
  if (S.playing && !S.finished) stopPlaying();
  S.pendingResults = res;
  // Bitirdin ekranı en az 4 sn görünsün
  const wait = S.finished ? Math.max(0, 4000 - (performance.now() - S.finishShownAt)) : 0;
  setTimeout(() => { if (S.pendingResults === res) showResults(res); }, wait);
}

function showResults(res) {
  stopConfetti();
  const mine = res.all[pid]; // [sıra, ham, net, yıldız, düşme, yüzde]
  $('#res-chip').textContent = `TUR ${res.round} / ${res.rounds}`;
  $('#res-title').textContent = res.final ? 'OYUN BİTTİ' : 'TUR SONU';
  if (mine) {
    const [rank, raw, net, stars, falls, pct] = mine;
    $('#res-rank').textContent = `${rank}.`;
    $('#res-of').textContent = `${res.total} oyuncu içinde`;
    const dl = $('#res-breakdown');
    if (raw != null) {
      $('#res-note').textContent = S.rankAtFinish && S.rankAtFinish !== rank
        ? `Bitişte ${S.rankAtFinish}. sıradaydın.` : (rank === 1 ? 'Turun en hızlısı sensin.' : '');
      dl.innerHTML = `
        <dt>Ham süre</dt><dd>${fmtSec(raw)} sn</dd>
        <dt>Yıldız bonusu (${stars} × ${GAME.starBonusMs / 1000} sn)</dt><dd class="bonus">−${fmtSec(stars * GAME.starBonusMs)} sn</dd>
        <dt>Düşme</dt><dd>${falls} kez</dd>
        <dt class="total">NET SÜRE</dt><dd class="total">${fmtSec(net)}</dd>`;
    } else {
      $('#res-note').textContent = 'Süre dolduğunda bitişe ulaşamadın.';
      dl.innerHTML = `
        <dt>İlerleme</dt><dd>%${pct}</dd>
        <dt>Yıldız</dt><dd>${stars}/${GAME.stars}</dd>
        <dt>Düşme</dt><dd>${falls} kez</dd>`;
    }
  } else {
    $('#res-rank').textContent = '–'; $('#res-of').textContent = 'Bu turda sonuç yok'; $('#res-note').textContent = ''; $('#res-breakdown').innerHTML = '';
  }
  const ol = $('#res-top');
  ol.innerHTML = '';
  res.top.forEach(([rpid, nm, net], i) => {
    const li = document.createElement('li');
    if (i === 0) li.classList.add('lead');
    if (rpid === pid) li.classList.add('me');
    li.innerHTML = `<span class="r">${i + 1}</span>${i === 0 ? crownSvg : ''}<span class="nm"></span><span class="num">${net == null ? '—' : fmtSec(net)}</span>`;
    li.querySelector('.nm').textContent = nm;
    if (rpid === pid) li.querySelector('.nm').insertAdjacentHTML('beforeend', '<span class="you">SEN</span>');
    ol.appendChild(li);
  });
  const next = $('#res-next');
  if (res.final) {
    $('#next-label').textContent = 'TEŞEKKÜRLER';
    $('#next-text').textContent = 'Oyun bitti. Kazananlar projeksiyonda.';
    $('#next-num').textContent = '✓';
    $('#next-ring').style.strokeDashoffset = 0;
  } else {
    $('#next-label').textContent = 'SONRAKİ TUR';
    $('#next-text').textContent = 'Telefonu rahat tuttuğun açıda tut, başlarken eğim sıfırlanacak.';
    const end = performance.now() + res.nextInMs;
    const ring = $('#next-ring');
    const tick = () => {
      const left = Math.max(0, end - performance.now());
      $('#next-num').textContent = Math.ceil(left / 1000);
      ring.style.strokeDashoffset = 188.5 * (1 - left / res.nextInMs);
      if (left > 0 && $('#s-results').classList.contains('active')) requestAnimationFrame(tick);
    };
    tick();
  }
  next.hidden = false;
  show('s-results');
}

const crownSvg = '<svg width="22" height="18" viewBox="0 0 28 22" aria-label="Lider"><path d="M3 18L5 6L10.5 11L14 3L17.5 11L23 6L25 18Z" fill="#FFC94D" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/><rect x="3" y="18" width="22" height="3" rx="1" fill="#FFC94D"/></svg>';

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
      if (S.playing) $('#timer').textContent = fmt(now - S.startT);
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
