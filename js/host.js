import { GAME, RATES } from './config.js';
import { generateMaze } from './maze.js';
import { setupCanvas, buildMazeLayer, drawMini } from './render.js';
import { isConfigured, joinChannel, send, ctrlTopic, playerTopic, saveScores, fetchLeaderboard } from './net.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const BOTS = Math.min(60, parseInt(params.get('bots') || '0', 10) || 0); // host.html?bots=20 → sahte oyuncularla arayüz testi

let room = (params.get('oda') || '').replace(/\D/g, '').slice(0, 6);
if (!room) { room = String(1000 + Math.floor(Math.random() * 9000)); }
history.replaceState(null, '', `?oda=${room}${BOTS ? `&bots=${BOTS}` : ''}`);
const hostId = Math.random().toString(36).slice(2, 10);

const MAX_CARDS = 24;
const LOBBY_MAZE = generateMaze(20260923, { w: GAME.mazeW, h: GAME.mazeH, stars: GAME.stars, traps: GAME.traps, loops: GAME.loops });

const H = {
  phase: 'LOBBY', round: 0, seed: 0, maze: null,
  countdownEnd: 0, playStart: 0, roundEnd: 0, nextAt: 0,
  lastRanksSent: 0, lastRanksKey: '', lastHeartbeat: 0, lastResults: null,
  showGlobal: false, // L tuşu: tur sonucu yerine genel liderliği göster
};
// Kalıcı liderlik (Supabase tablosu)
const LB = { rows: [], loadedAt: 0, loading: false, error: false };
const players = new Map(); // ekleme sırası = katılım sırası
let ctrlCh = null;

// ---------- Sahne ölçeği (her projektör çözünürlüğünde 1920×1080 düzen) ----------
const stage = $('#stage');
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(${(innerWidth - 1920 * s) / 2}px, ${(innerHeight - 1080 * s) / 2}px) scale(${s})`;
}
addEventListener('resize', fit); fit();

// ---------- Katılım alanı ----------
const joinUrl = new URL(`./?oda=${room}`, location.href).href;
$('#join-url').textContent = `${location.host}/?oda=${room}`;
$('#join-room').textContent = `ODA ${room}`;
try {
  const qr = window.qrcode(0, 'M');
  qr.addData(joinUrl); qr.make();
  $('#qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
} catch (e) { $('#qr').textContent = 'QR yüklenemedi'; console.error(e); }

// ---------- Ağ ----------
function cleanName(n) {
  return String(n || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12) || 'Oyuncu';
}

function currentState() {
  const now = performance.now();
  return {
    hostId, phase: H.phase, round: H.round, rounds: GAME.rounds, seed: H.seed,
    countdownMs: Math.max(0, Math.round(H.countdownEnd - now)),
    roundMs: GAME.roundSeconds * 1000,
    remainingMs: Math.max(0, Math.round(H.roundEnd - now)),
  };
}
function broadcastState() { send(ctrlCh, 'state', currentState()); H.lastHeartbeat = performance.now(); }

async function onHello(msg) {
  const pid = msg?.pid;
  if (typeof pid !== 'string' || !/^[a-z0-9]{3,12}$/.test(pid)) return;
  const nm = cleanName(msg.name);
  let pl = players.get(pid);
  if (!pl) { pl = makePlayer(pid, nm, false); players.set(pid, pl); layoutGrid(); }
  else if (pl.name !== nm) { pl.name = nm; pl.card && (pl.card.name.textContent = nm); }
  if (!pl.ch && !pl.joining) {
    pl.joining = true;
    pl.ch = await joinChannel(playerTopic(room, pid), { pos: (m) => onPos(pl, m), fin: (m) => onFin(pl, m) });
    pl.joining = false;
  }
  if (pl.ch) send(pl.ch, 'welcome', { hostId, state: currentState() });
}

function onPos(pl, m) {
  if (H.phase !== 'PLAYING' || m?.r !== H.round || pl.done) return;
  pl.round = H.round;
  pl.x = clamp(+m.x / 100, 0, GAME.mazeW); pl.y = clamp(+m.y / 100, 0, GAME.mazeH);
  pl.p = clamp(Math.round(+m.p) || 0, 0, 99);
  const f = !!m.f;
  if (f && !pl.fell) pl.fellAt = performance.now();
  pl.fell = f;
  pl.stars = clamp(Math.round(+m.s) || 0, 0, GAME.stars);
  pl.lastSeen = performance.now();
}

function onFin(pl, m) {
  if (H.phase !== 'PLAYING' || m?.r !== H.round || pl.done) return;
  const raw = Math.round(+m.raw);
  const elapsed = performance.now() - H.playStart;
  if (!Number.isFinite(raw) || raw < GAME.minPlausibleMs || raw > elapsed + 5000) {
    console.warn('Şüpheli bitiş reddedildi', pl.name, raw, Math.round(elapsed));
    return;
  }
  finishPlayer(pl, raw, clamp(Math.round(+m.stars) || 0, 0, GAME.stars), clamp(Math.round(+m.falls) || 0, 0, 999));
}

function finishPlayer(pl, raw, stars, falls) {
  pl.round = H.round;
  pl.done = true; pl.raw = raw; pl.stars = stars; pl.falls = falls;
  pl.net = Math.max(0, raw - stars * GAME.starBonusMs);
  pl.p = 100; pl.fell = false;
  const g = (H.maze || LOBBY_MAZE).goal;
  pl.x = g.x; pl.y = g.y;
}

function makePlayer(pid, name, bot) {
  return {
    pid, name, bot, ch: null, joining: false, joinedAt: performance.now(),
    round: 0, x: null, y: null, dx: null, dy: null, p: 0, fell: false, fellAt: 0,
    stars: 0, falls: 0, done: false, raw: null, net: null, rank: null, upUntil: 0, upBy: 0,
    card: null, status: '', bf: 0, bSpeed: 0,
  };
}

// ---------- Tur akışı ----------
function startRound() {
  if (H.phase === 'COUNTDOWN' || H.phase === 'PLAYING' || H.phase === 'FINAL') return;
  if (H.round >= GAME.rounds) return;
  H.round++;
  H.seed = (Math.random() * 4294967296) >>> 0;
  H.maze = generateMaze(H.seed, { w: GAME.mazeW, h: GAME.mazeH, stars: GAME.stars, traps: GAME.traps, loops: GAME.loops });
  layerCache.clear();
  for (const pl of players.values()) {
    Object.assign(pl, { round: 0, x: null, y: null, dx: null, dy: null, p: 0, fell: false, fellAt: 0, stars: 0, falls: 0, done: false, raw: null, net: null, rank: null, upUntil: 0, status: '' });
  }
  rowEls.forEach((el) => el.remove()); rowEls.clear();
  H.lastRanksKey = ''; H.allDoneAt = 0;
  H.phase = 'COUNTDOWN';
  H.countdownEnd = performance.now() + GAME.countdownSeconds * 1000;
  broadcastState();
  $('#winner').hidden = true;
}

function beginPlaying() {
  H.phase = 'PLAYING';
  H.playStart = performance.now();
  H.roundEnd = H.playStart + GAME.roundSeconds * 1000;
  broadcastState();
  for (const pl of players.values()) if (pl.bot) {
    pl.round = H.round; pl.bf = 0; pl.bSpeed = 1 / (22 + Math.random() * 55);
    const s = H.maze.start; pl.x = s.x; pl.y = s.y;
  }
}

function liveOrder() {
  const arr = [...players.values()].filter((p) => p.round === H.round && H.round > 0);
  arr.sort((a, b) => {
    if (a.done !== b.done) return a.done ? -1 : 1;
    if (a.done) return a.net - b.net || a.raw - b.raw;
    return b.p - a.p || a.joinedAt - b.joinedAt;
  });
  return arr;
}

function updateRanks(now) {
  const order = liveOrder();
  order.forEach((pl, i) => {
    const r = i + 1;
    // Vurgu gürültü olmasın: sadece bitirenlerin tırmanışı ya da 2+ sıralık sıçrama, ve aynı anda tek satır
    if (pl.rank != null && r < pl.rank && (pl.done || pl.rank - r >= 2)) {
      pl.upUntil = now + 3200; pl.upBy = pl.rank - r; H.upPid = pl.pid;
    }
    pl.rank = r;
  });
  const key = order.map((p) => p.pid).join(',');
  if (key !== H.lastRanksKey && now - H.lastRanksSent >= RATES.rankMinMs) {
    const r = {};
    order.forEach((pl) => { if (!pl.bot) r[pl.pid] = pl.rank; });
    if (Object.keys(r).length) send(ctrlCh, 'ranks', { round: H.round, n: order.length, r });
    H.lastRanksKey = key; H.lastRanksSent = now;
  }
  return order;
}

function endRound() {
  if (H.phase !== 'PLAYING') return;
  const order = updateRanks(performance.now());
  const final = H.round >= GAME.rounds;
  H.phase = final ? 'FINAL' : 'ROUND_END';
  H.nextAt = performance.now() + GAME.resultsSeconds * 1000;
  const all = {};
  order.forEach((pl) => { if (!pl.bot) all[pl.pid] = [pl.rank, pl.raw, pl.net, pl.stars, pl.falls, pl.p]; });
  const res = {
    round: H.round, rounds: GAME.rounds, total: order.length, final,
    nextInMs: GAME.resultsSeconds * 1000,
    top: order.slice(0, 5).map((pl) => [pl.pid, pl.name, pl.net]),
    all,
  };
  H.lastResults = { res, order };
  send(ctrlCh, 'results', res);
  broadcastState();
  saveRound(order);
  if (final) setTimeout(() => showWinner(order), 2500);
}

// Bitirenlerin süreleri kalıcı liderliğe yazılır. Botlar ve bitiremeyenler yazılmaz.
async function saveRound(order) {
  const rows = order.filter((pl) => !pl.bot && pl.done).map((pl) => ({
    pid: pl.pid, name: pl.name, net_ms: pl.net, raw_ms: pl.raw, stars: pl.stars, falls: Math.min(pl.falls, 999),
    room, round: H.round, seed: H.seed,
  }));
  if (!rows.length || !isConfigured()) return;
  try { await saveScores(rows); }
  catch (e) { console.error('Skorlar kaydedilemedi', e); return; }
  loadLeaderboard();
}

async function loadLeaderboard() {
  if (!isConfigured() || LB.loading) return;
  LB.loading = true;
  try { LB.rows = await fetchLeaderboard(10); LB.error = false; }
  catch (e) { console.warn('Liderlik alınamadı', e); LB.error = true; }
  LB.loading = false; LB.loadedAt = performance.now();
  if (H.phase === 'FINAL' && !$('#winner').hidden) renderWinnerBoard();
}

function resetGame() {
  H.phase = 'LOBBY'; H.round = 0; H.maze = null; H.seed = 0; H.lastResults = null;
  for (const pl of players.values()) Object.assign(pl, { round: 0, x: null, y: null, dx: null, dy: null, p: 0, done: false, raw: null, net: null, rank: null, status: '' });
  rowEls.forEach((el) => el.remove()); rowEls.clear();
  layerCache.clear();
  $('#winner').hidden = true;
  broadcastState();
}

// ---------- Botlar (test) ----------
const BOT_NAMES = ['Kerem', 'Elif', 'Zeynep', 'Mert', 'Ece', 'Barış', 'Selin', 'Arda', 'Onur', 'Defne', 'Irmak', 'Emir', 'Nehir', 'Can', 'Yusuf', 'Ada', 'Duru', 'Tuna', 'Kaan', 'Lara', 'Efe', 'Mina', 'Alp', 'Deniz'];
for (let i = 0; i < BOTS; i++) players.set(`bot${i}`, makePlayer(`bot${i}`, BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? i : ''), true));

function stepBots(dt, now) {
  for (const pl of players.values()) {
    if (!pl.bot || pl.done || pl.round !== H.round) continue;
    if (pl.fell) {
      if (now - pl.fellAt > 900) { pl.fell = false; }
      continue;
    }
    pl.bf += pl.bSpeed * dt * (0.6 + Math.random() * 0.8);
    if (Math.random() < 0.025 * dt * 4) { pl.fell = true; pl.fellAt = now; pl.falls++; pl.bf = Math.max(0, pl.bf - 0.2); }
    if (Math.random() < 0.02 * dt * 4) pl.stars = Math.min(GAME.stars, pl.stars + 1);
    if (pl.bf >= 1) { finishPlayer(pl, Math.round(now - H.playStart), pl.stars, pl.falls); continue; }
    const pt = H.maze.pointOnPath(pl.bf);
    pl.x = pt.x; pl.y = pt.y; pl.p = Math.min(99, Math.round(pl.bf * 100));
  }
}

// ---------- Saha ızgarası ----------
const grid = $('#grid');
const layerCache = new Map();

function layoutGrid() {
  const list = [...players.values()];
  const n = Math.min(list.length, MAX_CARDS);
  const [cols, rows] = n <= 8 ? [4, 2] : n <= 12 ? [6, 2] : [8, 3];
  grid.style.setProperty('--cols', cols); grid.style.setProperty('--rows', rows);
  $('#grid-empty').hidden = n > 0;
  const extra = list.length - MAX_CARDS;
  $('#more').hidden = extra <= 0;
  if (extra > 0) $('#more').textContent = `+${extra} oyuncu daha`;
  list.forEach((pl, i) => {
    if (i < MAX_CARDS && !pl.card) {
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = `<div class="nm"><span></span></div><div class="map"><canvas></canvas></div><div class="ft"></div>`;
      grid.appendChild(el);
      pl.card = { el, name: el.querySelector('.nm span'), nm: el.querySelector('.nm'), map: el.querySelector('.map'), canvas: el.querySelector('canvas'), ft: el.querySelector('.ft'), ctx: null, w: 0, h: 0 };
      pl.card.name.textContent = pl.name;
    }
  });
  requestAnimationFrame(sizeCards);
}

function sizeCards() {
  const maze = H.maze || LOBBY_MAZE;
  const aspect = (maze.w + 0.6) / (maze.h + 0.6);
  for (const pl of players.values()) {
    const c = pl.card; if (!c) continue;
    const mw = c.map.clientWidth, mh = c.map.clientHeight;
    if (!mw || !mh) continue;
    let w = mw, h = mw / aspect;
    if (h > mh) { h = mh; w = mh * aspect; }
    w = Math.floor(w); h = Math.floor(h);
    if (w !== c.w || h !== c.h) { c.w = w; c.h = h; c.ctx = setupCanvas(c.canvas, w, h); }
  }
}

function miniLayer(w, h) {
  const maze = H.maze || LOBBY_MAZE;
  const key = `${maze.seed}:${w}x${h}`;
  if (!layerCache.has(key)) layerCache.set(key, buildMazeLayer(maze, w, h, { mini: true }));
  return layerCache.get(key);
}

const crown = (size = 26) => `<svg width="${size}" height="${Math.round(size * 0.8)}" viewBox="0 0 28 22" aria-label="Lider"><path d="M3 18L5 6L10.5 11L14 3L17.5 11L23 6L25 18Z" fill="#FFC94D" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/><rect x="3" y="18" width="22" height="3" rx="1" fill="#FFC94D"/></svg>`;
const flame = `<svg class="flame" width="26" height="34" viewBox="0 0 24 32" aria-label="Alev"><path d="M12 1C13.5 7 20 10 20 19a8 8 0 0 1-16 0c0-3.5 1.6-6 3.4-7.6 0 3 1.4 4.8 3.2 4.8C10.6 11 9.4 6.5 12 1Z" fill="#FFC94D" stroke="#000" stroke-width="1.4"/><path d="M12 15c1 2.6 4 4 4 7a4 4 0 0 1-8 0c0-2 1.2-3 2-4 .4 1.5 1 2 2 2-.4-1.8-.6-3.2 0-5Z" fill="#fff"/></svg>`;
const flagIcon = `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><line x1="4" y1="18" x2="4" y2="2" stroke="#fff" stroke-width="2" stroke-linecap="round"/><rect x="5" y="3" width="12" height="9" fill="#fff"/><rect x="5" y="3" width="4" height="3" fill="#05080F"/><rect x="13" y="3" width="4" height="3" fill="#05080F"/><rect x="9" y="6" width="4" height="3" fill="#05080F"/><rect x="5" y="9" width="4" height="3" fill="#05080F"/><rect x="13" y="9" width="4" height="3" fill="#05080F"/></svg>`;

function updateCards(now) {
  const inRound = H.round > 0 && H.phase !== 'LOBBY';
  for (const pl of players.values()) {
    const c = pl.card; if (!c) continue;
    const playing = inRound && pl.round === H.round;
    const fellNow = pl.fell || (now - pl.fellAt < 1500 && pl.fellAt > H.playStart);
    let cls = 'card', status;
    if (!inRound) status = 'ready';
    else if (!playing) { cls += ' idle'; status = 'idle'; }
    else if (pl.done) { cls += ' done'; status = `done:${pl.net}`; }
    else if (fellNow) { cls += ' fell'; status = 'fell'; }
    else status = `p:${pl.p}`;
    if (playing && pl.rank === 1) cls += ' lead';
    if (c.el.className !== cls) c.el.className = cls;
    const hasCrown = !!c.nm.querySelector('svg');
    if (playing && pl.rank === 1 && !hasCrown) c.nm.insertAdjacentHTML('afterbegin', crown(26));
    if (!(playing && pl.rank === 1) && hasCrown) c.nm.querySelector('svg').remove();
    if (status === pl.status && !status.startsWith('p:')) continue;
    if (status.startsWith('p:') && pl.status.startsWith('p:')) {
      c.ft.querySelector('.bar i').style.width = `${pl.p}%`;
      c.ft.querySelector('.pct').textContent = `%${pl.p}`;
      pl.status = status; continue;
    }
    pl.status = status;
    if (status === 'ready') c.ft.innerHTML = `<span style="color:var(--neon)">Hazır</span>`;
    else if (status === 'idle') c.ft.innerHTML = `<span style="color:var(--muted)">Sonraki tur</span>`;
    else if (status === 'fell') c.ft.innerHTML = `<span class="fell-chip">DÜŞTÜ!</span>`;
    else if (pl.done) c.ft.innerHTML = `${flagIcon}<span class="num">${fmtSec(pl.net)}</span>`;
    else c.ft.innerHTML = `<div class="bar"><i style="width:${pl.p}%"></i></div><span class="pct num">%${pl.p}</span>`;
  }
}

// ---------- İlk 10 ----------
const rowsEl = $('#rows');
const rowEls = new Map();
const ROW_STEP = 61;

function globalBoardShown() {
  return H.phase === 'LOBBY' || (H.showGlobal && H.phase !== 'PLAYING' && H.phase !== 'COUNTDOWN');
}

function updateBoard(order, now) {
  const global = globalBoardShown();
  const top = global
    ? LB.rows.map((r) => ({ pid: `lb:${r.pid}`, name: r.name, done: true, net: r.net_ms, p: 100, upUntil: 0 }))
    : H.round > 0 ? order.slice(0, 10) : [];
  const empty = $('#board-empty');
  empty.hidden = top.length > 0;
  const emptyText = global
    ? (LB.error ? 'Liderlik tablosu yüklenemedi.' : 'Henüz kayıt yok. Bir turu bitiren ilk oyuncu buraya yazılır.')
    : 'Tur başlayınca sıralama burada canlı akacak.';
  if (empty.textContent !== emptyText) empty.textContent = emptyText;
  const keep = new Set(top.map((p) => p.pid));
  for (const [pid, el] of rowEls) if (!keep.has(pid)) { el.style.opacity = 0; setTimeout(() => el.remove(), 400); rowEls.delete(pid); }
  top.forEach((pl, i) => {
    let el = rowEls.get(pl.pid);
    if (!el) {
      el = document.createElement('div');
      el.className = 'row';
      el.style.transform = `translateY(${Math.min(10, top.length) * ROW_STEP}px)`;
      el.style.opacity = 0;
      rowsEl.appendChild(el); rowEls.set(pl.pid, el);
      el.getBoundingClientRect();
    }
    el.style.opacity = 1;
    el.style.transform = `translateY(${i * ROW_STEP}px)`;
    const lead = i === 0, up = now < pl.upUntil && H.upPid === pl.pid && H.phase === 'PLAYING';
    const cls = `row${lead ? ' lead' : ''}${up && !lead ? ' up' : ''}${pl.done ? '' : ' active'}`;
    if (el.className !== cls) el.className = cls;
    const sig = `${i}|${pl.name}|${pl.done ? pl.net : 'p' + pl.p}|${lead}|${up ? pl.upBy : 0}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.innerHTML = `<div class="rk">${i + 1}</div>${lead ? crown(34) : ''}<div class="nm"></div>${lead ? flame : ''}${up && !lead ? `<div class="chip-up">▲${pl.upBy}</div>` : ''}${
      pl.done ? `<div class="tm">${fmtSec(pl.net)}</div>` : `<div class="pg"><div class="bar"><i style="width:${pl.p}%"></i></div>%${pl.p}</div>`}`;
    el.querySelector('.nm').textContent = pl.name;
  });
}

function showWinner(order) {
  if (H.phase !== 'FINAL') return;
  const w = $('#winner');
  const top3 = order.slice(0, 3);
  if (!top3.length) return;
  const slot = (pl, r) => pl ? `<div class="p ${r === 1 ? 'first' : ''}"><div class="r">${r}.</div>${r === 1 ? crown(90) : ''}<div class="n"></div><div class="t">${pl.done ? fmtSec(pl.net) + ' sn' : '%' + pl.p}</div></div>` : '';
  w.innerHTML = `<h2>SON TURUN KAZANANLARI</h2><div class="podium">${slot(top3[1], 2)}${slot(top3[0], 1)}${slot(top3[2], 3)}</div><div class="all-time" id="all-time"></div>`;
  const names = w.querySelectorAll('.n');
  const orderIdx = [top3[1], top3[0], top3[2]].filter(Boolean);
  names.forEach((el, i) => { el.textContent = orderIdx[i].name; });
  w.hidden = false;
  renderWinnerBoard();
}

function renderWinnerBoard() {
  const el = $('#all-time'); if (!el) return;
  const rows = LB.rows.slice(0, 5);
  el.hidden = !rows.length;
  el.innerHTML = `<div class="label">GENEL LİDERLİK · TÜM ZAMANLAR</div><ol></ol>`;
  const ol = el.querySelector('ol');
  rows.forEach((r) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="r">${r.rank}</span><span class="n"></span><span class="t num">${fmtSec(r.net_ms)}</span>`;
    li.querySelector('.n').textContent = r.name;
    ol.appendChild(li);
  });
}

// ---------- Başlık ----------
function updateHeader(now, order) {
  $('#round-pill').textContent = H.phase === 'LOBBY' ? 'HAZIRLIK' : H.phase === 'FINAL' ? 'FİNAL' : `TUR ${H.round} / ${GAME.rounds}`;
  let label = '', value = '';
  if (H.phase === 'LOBBY') { label = 'OYUNCULAR BEKLENİYOR'; value = '--:--'; }
  else if (H.phase === 'COUNTDOWN') { label = 'BAŞLIYOR'; value = String(Math.max(1, Math.ceil((H.countdownEnd - now) / 1000))); }
  else if (H.phase === 'PLAYING') { label = 'KALAN SÜRE'; value = fmtClock(Math.max(0, H.roundEnd - now)); }
  else if (H.phase === 'ROUND_END') { label = 'SONRAKİ TUR'; value = fmtClock(Math.max(0, H.nextAt - now)); }
  else { label = 'OYUN BİTTİ'; value = 'SON'; }
  $('#clock-label').textContent = label; $('#clock-value').textContent = value;
  document.querySelector('.clock').classList.toggle('warn', H.phase === 'PLAYING' && H.roundEnd - now < 10000);
  $('#c-players').textContent = players.size;
  $('#c-done').textContent = order.filter((p) => p.done).length;
  $('#board-title').textContent = globalBoardShown() ? 'GENEL LİDERLİK' : H.phase === 'ROUND_END' || H.phase === 'FINAL' ? `TUR ${H.round} SONUCU` : 'İLK 10';
  $('#live').classList.toggle('off', H.phase !== 'PLAYING');
  $('#btn-start').disabled = !(H.phase === 'LOBBY' || H.phase === 'ROUND_END');
  $('#btn-end').disabled = H.phase !== 'PLAYING';
}

// Büyük geri sayım
let lastBig = '';
function updateBigCount(now) {
  const box = $('#big-count'), num = $('#big-count-num');
  let label = '';
  if (H.phase === 'COUNTDOWN') label = String(Math.max(1, Math.ceil((H.countdownEnd - now) / 1000)));
  else if (H.phase === 'PLAYING' && now - H.playStart < 800) label = 'BAŞLA!';
  box.hidden = !label;
  if (label && label !== lastBig) {
    num.textContent = label; num.classList.toggle('go', label === 'BAŞLA!');
    num.classList.remove('pop'); void num.offsetWidth; num.classList.add('pop');
  }
  lastBig = label;
}

// ---------- Döngüler ----------
let lastTick = performance.now();
let order = [];
setInterval(() => {
  const now = performance.now();
  const dt = (now - lastTick) / 1000; lastTick = now;
  if (H.phase === 'COUNTDOWN' && now >= H.countdownEnd) beginPlaying();
  if (H.phase === 'PLAYING') {
    stepBots(dt, now);
    order = updateRanks(now);
    const participants = order.length;
    const allDone = participants > 0 && order.every((p) => p.done);
    // Son bitişin sıralaması telefonlara ulaşsın diye küçük bir tampon
    if (allDone && !H.allDoneAt) H.allDoneAt = now;
    if (now >= H.roundEnd + 1000 || (H.allDoneAt && now - H.allDoneAt > 1500)) { H.allDoneAt = 0; endRound(); }
  } else if (H.phase === 'ROUND_END') {
    if (now >= H.nextAt) startRound();
  }
  if (H.phase !== 'PLAYING' && H.lastResults) order = H.lastResults.order;
  if (H.phase === 'LOBBY' || H.phase === 'COUNTDOWN') order = [];
  if (now - H.lastHeartbeat > RATES.heartbeatMs) broadcastState();
  if (globalBoardShown() && now - LB.loadedAt > 30000) loadLeaderboard();
  updateCards(now);
  updateBoard(order, now);
  updateHeader(now, order);
}, 200);

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  const k = 1 - Math.exp(-dt * RATES.posHz * 2.5);
  const start = (H.maze || LOBBY_MAZE).start;
  for (const pl of players.values()) {
    const c = pl.card; if (!c || !c.ctx) continue;
    const tx = pl.x ?? (H.phase === 'LOBBY' || H.phase === 'COUNTDOWN' ? start.x : null);
    const ty = pl.y ?? (H.phase === 'LOBBY' || H.phase === 'COUNTDOWN' ? start.y : null);
    if (tx != null) {
      if (pl.dx == null || Math.hypot(tx - pl.dx, ty - pl.dy) > 3) { pl.dx = tx; pl.dy = ty; }
      else { pl.dx += (tx - pl.dx) * k; pl.dy += (ty - pl.dy) * k; }
    }
    const fellNow = pl.fell || (now - pl.fellAt < 600 && pl.fellAt > H.playStart);
    drawMini(c.ctx, miniLayer(c.w, c.h), tx != null ? pl.dx : null, tx != null ? pl.dy : null, fellNow, now);
  }
  updateBigCount(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => requestAnimationFrame(() => sizeCards()));

// ---------- Kontroller ----------
const controls = $('#controls');
let hideT = 0;
addEventListener('mousemove', () => { controls.classList.add('show'); clearTimeout(hideT); hideT = setTimeout(() => controls.classList.remove('show'), 3000); });
$('#btn-start').addEventListener('click', startRound);
$('#btn-end').addEventListener('click', endRound);
$('#btn-reset').addEventListener('click', () => { if (confirm('Tüm turlar sıfırlansın mı? Oyuncular bağlı kalır.')) resetGame(); });
$('#btn-full').addEventListener('click', toggleFull);
$('#btn-global').addEventListener('click', toggleGlobal);
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 's') startRound();
  else if (k === 'e') endRound();
  else if (k === 'f') toggleFull();
  else if (k === 'l') toggleGlobal();
});
function toggleGlobal() { H.showGlobal = !H.showGlobal; if (H.showGlobal) loadLeaderboard(); }
function toggleFull() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); }

// ---------- Yardımcılar ----------
function clamp(v, a, b) { return Math.min(b, Math.max(a, Number.isFinite(v) ? v : a)); }
function fmtSec(ms) { return ms == null ? '—' : (ms / 1000).toFixed(2).replace('.', ','); }
function fmtClock(ms) { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

// ---------- Başlat ----------
layoutGrid();
(async () => {
  if (!isConfigured()) {
    const box = $('#setup-error');
    box.hidden = false;
    box.textContent = BOTS
      ? 'Supabase ayarlı değil: sadece bot modu çalışıyor, telefonlar bağlanamaz. js/config.js dosyasını doldur.'
      : 'Supabase ayarlı değil. js/config.js içindeki URL ve anon key’i doldur. Arayüzü denemek için adrese &bots=20 ekle.';
    return;
  }
  ctrlCh = await joinChannel(ctrlTopic(room), { hello: onHello }, (st) => {
    $('#ctrl-note').textContent = st === 'SUBSCRIBED' ? `Bağlı · oda ${room}` : `Bağlantı: ${st}`;
  });
  broadcastState();
  loadLeaderboard();
})();
