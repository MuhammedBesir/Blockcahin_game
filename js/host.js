import { GAME, RATES, ROOM } from './config.js';
import { generateMaze } from './maze.js';
import { setupCanvas, buildMazeLayer, drawMini } from './render.js';
import { isConfigured, joinChannel, send, ctrlTopic, playerTopic, fetchLeaderboard, checkAdmin, banPlayer, unbanPlayer, listBans } from './net.js';
import { createSoundKit } from './sound.js';

// Projeksiyon ekranı: serbest oyunu izler. Tur yönetmez; her oyuncu telefonundan istediği zaman oynar.
// Kartlarda şu an oynayanların topu kendi labirentinde canlı görünür, sağda genel liderlik akar.
// Yönetici kodu girildiyse karta ya da liderlik satırına tıklayarak oyuncu engellenir.

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const BOTS = Math.min(60, parseInt(params.get('bots') || '0', 10) || 0); // host.html?bots=20 → sahte oyuncularla arayüz testi

const room = ROOM;
const hostId = Math.random().toString(36).slice(2, 10);

const MAX_CARDS = 24;
const ACTIVE_MS = 5000;      // bu kadar süre konum gelmezse oyuncu "beklemede" sayılır
const DONE_SHOW_MS = 12000;  // bitiş kartı bu kadar görünür
const mazeOpts = { w: GAME.mazeW, h: GAME.mazeH, stars: GAME.stars, traps: GAME.traps, loops: GAME.loops };
const IDLE_MAZE = generateMaze(20260923, mazeOpts); // oyunda olmayan kartlarda görünen labirent

const players = new Map(); // ekleme sırası = katılım sırası
let ctrlCh = null, lastHeartbeat = 0;
// Kalıcı liderlik (Supabase tablosu). Skorları telefonlar yazar.
const LB = { rows: [], loadedAt: 0, loading: false, error: false, prevRank: new Map() };
let topEverNet = null; // en iyi süre kaydını takip eder, kırılınca fanfar çalar
const snd = createSoundKit('dl-mute-host');
// Projeksiyonda ses ilk kullanıcı dokunuşuyla açılır (host kimse görmeden kimse dokunmamış olabilir,
// bu yüzden herhangi bir tıklama ya da tuşa basma sesi açmaya yeter)
const unlockSndOnce = () => { snd.unlock(); removeEventListener('pointerdown', unlockSndOnce); removeEventListener('keydown', unlockSndOnce); };
addEventListener('pointerdown', unlockSndOnce, { once: true });
addEventListener('keydown', unlockSndOnce, { once: true });

// ---------- Sahne ölçeği (her projektör çözünürlüğünde 1920×1080 düzen) ----------
const stage = $('#stage');
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(${(innerWidth - 1920 * s) / 2}px, ${(innerHeight - 1080 * s) / 2}px) scale(${s})`;
}
addEventListener('resize', fit); fit();

// ---------- Katılım alanı ----------
const joinUrl = new URL('./', location.href).href;
$('#join-url').textContent = location.host;
try {
  const qr = window.qrcode(0, 'M');
  qr.addData(joinUrl); qr.make();
  $('#qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
} catch (e) { $('#qr').textContent = 'QR yüklenemedi'; console.error(e); }

// ---------- Ağ ----------
function cleanName(n) {
  return String(n || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12) || 'Oyuncu';
}
function broadcastState() { send(ctrlCh, 'state', { hostId }); lastHeartbeat = performance.now(); }

async function onHello(msg) {
  const pid = msg?.pid;
  if (typeof pid !== 'string' || !/^[a-z0-9]{3,12}$/.test(pid)) return;
  if (bannedPids.has(pid)) return;
  const nm = cleanName(msg.name);
  let pl = players.get(pid);
  if (!pl) { pl = makePlayer(pid, nm, false); players.set(pid, pl); layoutGrid(); }
  else if (pl.name !== nm) { pl.name = nm; pl.card && (pl.card.name.textContent = nm); }
  if (!pl.ch && !pl.joining) {
    pl.joining = true;
    pl.ch = await joinChannel(playerTopic(room, pid), { pos: (m) => onPos(pl, m), fin: (m) => onFin(pl, m), out: (m) => onOut(pl, m) });
    pl.joining = false;
  }
}

// Yeni bir oyun numarası geldiyse oyuncunun kartı o oyunun labirentine geçer
function syncGame(pl, m) {
  const r = m?.r;
  if (!Number.isInteger(r) || r === pl.r) return;
  const sd = Number.isInteger(m.sd) ? m.sd >>> 0 : null;
  Object.assign(pl, { r, seed: sd, maze: sd != null ? generateMaze(sd, mazeOpts) : null, x: null, y: null, dx: null, dy: null, p: 0, fell: false, fellAt: 0, stars: 0, falls: 0, done: false, net: null, doneAt: 0, out: false });
}

function onPos(pl, m) {
  syncGame(pl, m);
  if (pl.done) return;
  pl.x = clamp(+m.x / 100, 0, GAME.mazeW); pl.y = clamp(+m.y / 100, 0, GAME.mazeH);
  pl.p = clamp(Math.round(+m.p) || 0, 0, 99);
  const f = !!m.f;
  if (f && !pl.fell) pl.fellAt = performance.now();
  pl.fell = f;
  pl.stars = clamp(Math.round(+m.s) || 0, 0, GAME.stars);
  pl.lastSeen = performance.now();
}

function onFin(pl, m) {
  syncGame(pl, m);
  const raw = Math.round(+m.raw);
  if (pl.done || !Number.isFinite(raw) || raw < GAME.minPlausibleMs) return;
  finishPlayer(pl, raw, clamp(Math.round(+m.stars) || 0, 0, GAME.stars));
  // Telefon skoru kaydettikten sonra liderlik güncellensin
  setTimeout(loadLeaderboard, 1500);
}

function onOut(pl, m) { syncGame(pl, m); pl.out = true; pl.lastSeen = 0; }

function finishPlayer(pl, raw, stars) {
  pl.done = true; pl.stars = stars;
  pl.net = Math.max(0, raw - stars * GAME.starBonusMs);
  pl.p = 100; pl.fell = false; pl.doneAt = performance.now();
  const g = (pl.maze || IDLE_MAZE).goal;
  pl.x = g.x; pl.y = g.y;
}

function makePlayer(pid, name, bot) {
  return {
    pid, name, bot, ch: null, joining: false, r: null, seed: null, maze: null, lastSeen: 0,
    x: null, y: null, dx: null, dy: null, p: 0, fell: false, fellAt: 0,
    stars: 0, falls: 0, done: false, net: null, doneAt: 0, out: false,
    card: null, status: '', bf: 0, bSpeed: 0, bWait: 0,
  };
}

const isActive = (pl, now) => !pl.done && now - pl.lastSeen < ACTIVE_MS;
const showsDone = (pl, now) => pl.done && now - pl.doneAt < DONE_SHOW_MS;

// ---------- Liderlik ----------
async function loadLeaderboard() {
  if (!isConfigured() || LB.loading) return;
  LB.loading = true;
  try {
    const rows = await fetchLeaderboard(10);
    const now = performance.now();
    // Sıra yükselen ya da yeni giren satır kısa süre vurgulanır
    for (const r of rows) {
      const prev = LB.prevRank.get(r.pid);
      if (LB.loadedAt && (prev == null || r.rank < prev)) { r.upUntil = now + 4000; r.upBy = prev == null ? 0 : prev - r.rank; }
    }
    LB.prevRank = new Map(rows.map((r) => [r.pid, r.rank]));
    LB.rows = rows; LB.error = false;
    const best = rows[0];
    if (best && (topEverNet == null || best.net_ms < topEverNet) && LB.loadedAt) {
      snd.record();
      toast(`Yeni rekor! ${best.name} · ${fmtSec(best.net_ms)} sn`);
    }
    if (best) topEverNet = best.net_ms;
  } catch (e) { console.warn('Liderlik alınamadı', e); LB.error = true; }
  LB.loading = false; LB.loadedAt = performance.now();
}

// ---------- Yönetici: engelleme ----------
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} },
};
let adminCode = store.get('dl-admin');
const bannedPids = new Set();

function updateAdminUi() {
  document.body.classList.toggle('admin', !!adminCode);
  $('#btn-admin').textContent = adminCode ? 'Yönetici çıkışı' : 'Yönetici girişi';
  $('#btn-bans').hidden = !adminCode;
}

async function adminLogin() {
  if (adminCode) { adminCode = null; store.set('dl-admin', null); updateAdminUi(); return; }
  const code = (prompt('Yönetici kodu:') || '').trim();
  if (!code) return;
  let ok = false;
  try { ok = await checkAdmin(code); } catch (e) { console.error(e); alert('Kod doğrulanamadı, bağlantıyı kontrol et.'); return; }
  if (!ok) { alert('Kod yanlış.'); return; }
  adminCode = code; store.set('dl-admin', code); updateAdminUi();
  toast('Yönetici modu açık: engellemek için oyuncu kartına ya da liderlik satırına tıkla.');
}

async function askBan(pid, name) {
  if (!adminCode || pid.startsWith('bot')) return;
  if (!confirm(`"${name}" engellensin mi?\n\nSkorları liderlikten düşer, oyunu kesilir ve bu telefondan tekrar katılamaz.`)) return;
  try { await banPlayer(adminCode, pid, name); }
  catch (e) { console.error(e); alert('Engellenemedi. Yönetici kodu değişmiş olabilir.'); return; }
  snd.tap();
  bannedPids.add(pid);
  const pl = players.get(pid);
  if (pl) {
    send(pl.ch, 'ban', {});
    pl.card?.el.remove();
    players.delete(pid);
    layoutGrid();
  } else {
    // Liderlikten engellenen oyuncu şu an bağlıysa kanalı yok; yine de oyunu kesilsin
    joinChannel(playerTopic(room, pid)).then((ch) => send(ch, 'ban', {})).catch(() => {});
  }
  loadLeaderboard();
  toast(`${name} engellendi.`);
}

async function showBans() {
  const dlg = $('#bans');
  const list = $('#bans-list');
  list.innerHTML = '<li class="muted">Yükleniyor…</li>';
  dlg.showModal();
  let rows = [];
  try { rows = await listBans(adminCode); } catch (e) { list.innerHTML = '<li class="muted">Liste alınamadı.</li>'; return; }
  list.innerHTML = rows.length ? '' : '<li class="muted">Engellenen oyuncu yok.</li>';
  for (const r of rows) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="n"></span><span class="d"></span><button type="button">Engeli kaldır</button>`;
    li.querySelector('.n').textContent = r.name || r.pid;
    li.querySelector('.d').textContent = new Date(r.created_at).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    li.querySelector('button').addEventListener('click', async () => {
      try { await unbanPlayer(adminCode, r.pid); } catch { alert('Engel kaldırılamadı.'); return; }
      bannedPids.delete(r.pid);
      li.remove();
      if (!list.children.length) list.innerHTML = '<li class="muted">Engellenen oyuncu yok.</li>';
      loadLeaderboard();
    });
    list.appendChild(li);
  }
}

let toastT = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 4000);
}

// ---------- Botlar (test) ----------
const BOT_NAMES = ['Kerem', 'Elif', 'Zeynep', 'Mert', 'Ece', 'Barış', 'Selin', 'Arda', 'Onur', 'Defne', 'Irmak', 'Emir', 'Nehir', 'Can', 'Yusuf', 'Ada', 'Duru', 'Tuna', 'Kaan', 'Lara', 'Efe', 'Mina', 'Alp', 'Deniz'];
for (let i = 0; i < BOTS; i++) {
  const pl = makePlayer(`bot${i}`, BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? i : ''), true);
  pl.bWait = performance.now() + Math.random() * 8000; // botlar farklı zamanlarda başlasın
  players.set(pl.pid, pl);
}

function stepBots(dt, now) {
  for (const pl of players.values()) {
    if (!pl.bot) continue;
    if (pl.done || pl.r == null) {
      if (now < pl.bWait) continue;
      syncGame(pl, { r: (pl.r || 0) + 1, sd: (Math.random() * 4294967296) >>> 0 });
      pl.bf = 0; pl.bSpeed = 1 / (22 + Math.random() * 55); pl.startedAt = now;
    }
    pl.lastSeen = now;
    if (pl.fell) { if (now - pl.fellAt > 900) pl.fell = false; continue; }
    pl.bf += pl.bSpeed * dt * (0.6 + Math.random() * 0.8);
    if (Math.random() < 0.025 * dt * 4) { pl.fell = true; pl.fellAt = now; pl.falls++; pl.bf = Math.max(0, pl.bf - 0.2); }
    if (Math.random() < 0.02 * dt * 4) pl.stars = Math.min(GAME.stars, pl.stars + 1);
    if (pl.bf >= 1) { finishPlayer(pl, Math.round(now - pl.startedAt), pl.stars); pl.bWait = now + 6000 + Math.random() * 10000; continue; }
    const pt = pl.maze.pointOnPath(pl.bf);
    pl.x = pt.x; pl.y = pt.y; pl.p = Math.min(99, Math.round(pl.bf * 100));
  }
}

// ---------- Saha ızgarası ----------
const grid = $('#grid');
const layerCache = new Map(); // `${seed}:${w}x${h}` → katman

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
      el.addEventListener('click', () => askBan(pl.pid, pl.name));
      grid.appendChild(el);
      pl.card = { el, name: el.querySelector('.nm span'), nm: el.querySelector('.nm'), map: el.querySelector('.map'), canvas: el.querySelector('canvas'), ft: el.querySelector('.ft'), ctx: null, w: 0, h: 0 };
      pl.card.name.textContent = pl.name;
    }
  });
  requestAnimationFrame(sizeCards);
}

function sizeCards() {
  // Labirent boyutu her oyunda aynı, sadece duvarlar değişir
  const aspect = (GAME.mazeW + 0.6) / (GAME.mazeH + 0.6);
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

function miniLayer(maze, w, h) {
  const key = `${maze.seed}:${w}x${h}`;
  let layer = layerCache.get(key);
  if (!layer) {
    if (layerCache.size > 80) layerCache.delete(layerCache.keys().next().value);
    layer = buildMazeLayer(maze, w, h, { mini: true });
    layerCache.set(key, layer);
  }
  return layer;
}

const crown = (size = 26) => `<svg width="${size}" height="${Math.round(size * 0.8)}" viewBox="0 0 28 22" aria-label="Lider"><path d="M3 18L5 6L10.5 11L14 3L17.5 11L23 6L25 18Z" fill="#FFC94D" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/><rect x="3" y="18" width="22" height="3" rx="1" fill="#FFC94D"/></svg>`;
const flame = `<svg class="flame" width="26" height="34" viewBox="0 0 24 32" aria-label="Alev"><path d="M12 1C13.5 7 20 10 20 19a8 8 0 0 1-16 0c0-3.5 1.6-6 3.4-7.6 0 3 1.4 4.8 3.2 4.8C10.6 11 9.4 6.5 12 1Z" fill="#FFC94D" stroke="#000" stroke-width="1.4"/><path d="M12 15c1 2.6 4 4 4 7a4 4 0 0 1-8 0c0-2 1.2-3 2-4 .4 1.5 1 2 2 2-.4-1.8-.6-3.2 0-5Z" fill="#fff"/></svg>`;
const flagIcon = `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><line x1="4" y1="18" x2="4" y2="2" stroke="#fff" stroke-width="2" stroke-linecap="round"/><rect x="5" y="3" width="12" height="9" fill="#fff"/><rect x="5" y="3" width="4" height="3" fill="#05080F"/><rect x="13" y="3" width="4" height="3" fill="#05080F"/><rect x="9" y="6" width="4" height="3" fill="#05080F"/><rect x="5" y="9" width="4" height="3" fill="#05080F"/><rect x="13" y="9" width="4" height="3" fill="#05080F"/></svg>`;

function updateCards(now) {
  const leaderPid = LB.rows[0]?.pid;
  for (const pl of players.values()) {
    const c = pl.card; if (!c) continue;
    const fellNow = pl.fell || now - pl.fellAt < 1500;
    let cls = 'card', status;
    if (showsDone(pl, now)) { cls += ' done'; status = `done:${pl.net}`; }
    else if (isActive(pl, now)) {
      if (fellNow) { cls += ' fell'; status = 'fell'; } else status = `p:${pl.p}`;
    } else { cls += ' idle'; status = pl.out ? 'out' : 'idle'; }
    const lead = pl.pid === leaderPid;
    if (lead) cls += ' lead';
    if (c.el.className !== cls) c.el.className = cls;
    const hasCrown = !!c.nm.querySelector('svg');
    if (lead && !hasCrown) c.nm.insertAdjacentHTML('afterbegin', crown(26));
    if (!lead && hasCrown) c.nm.querySelector('svg').remove();
    if (status.startsWith('p:') && pl.status.startsWith('p:')) {
      c.ft.querySelector('.bar i').style.width = `${pl.p}%`;
      c.ft.querySelector('.pct').textContent = `%${pl.p}`;
      pl.status = status; continue;
    }
    if (status === pl.status) continue;
    pl.status = status;
    if (status === 'idle') c.ft.innerHTML = `<span style="color:var(--muted)">Beklemede</span>`;
    else if (status === 'out') c.ft.innerHTML = `<span style="color:var(--muted)">Süre doldu</span>`;
    else if (status === 'fell') c.ft.innerHTML = `<span class="fell-chip">DÜŞTÜ!</span>`;
    else if (pl.done) c.ft.innerHTML = `${flagIcon}<span class="num">${fmtSec(pl.net)}</span>`;
    else c.ft.innerHTML = `<div class="bar"><i style="width:${pl.p}%"></i></div><span class="pct num">%${pl.p}</span>`;
  }
}

// ---------- Genel liderlik (ilk 10) ----------
const rowsEl = $('#rows');
const rowEls = new Map();
const ROW_STEP = 61;

function updateBoard(now) {
  const top = LB.rows;
  const empty = $('#board-empty');
  empty.hidden = top.length > 0;
  const emptyText = LB.error ? 'Liderlik tablosu yüklenemedi.' : 'Henüz kayıt yok. Labirenti ilk bitiren buraya yazılır.';
  if (empty.textContent !== emptyText) empty.textContent = emptyText;
  const keep = new Set(top.map((r) => r.pid));
  for (const [pid, el] of rowEls) if (!keep.has(pid)) { el.style.opacity = 0; setTimeout(() => el.remove(), 400); rowEls.delete(pid); }
  top.forEach((r, i) => {
    let el = rowEls.get(r.pid);
    if (!el) {
      el = document.createElement('div');
      el.className = 'row';
      el.style.transform = `translateY(${Math.min(10, top.length) * ROW_STEP}px)`;
      el.style.opacity = 0;
      el.addEventListener('click', () => askBan(r.pid, el.dataset.name));
      rowsEl.appendChild(el); rowEls.set(r.pid, el);
      el.getBoundingClientRect();
    }
    el.dataset.name = r.name;
    el.style.opacity = 1;
    el.style.transform = `translateY(${i * ROW_STEP}px)`;
    const lead = i === 0, up = now < (r.upUntil || 0);
    const cls = `row${lead ? ' lead' : ''}${up && !lead ? ' up' : ''}`;
    if (el.className !== cls) el.className = cls;
    const sig = `${r.rank}|${r.name}|${r.net_ms}|${lead}|${up ? r.upBy : -1}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.innerHTML = `<div class="rk">${r.rank}</div>${lead ? crown(34) : ''}<div class="nm"></div>${lead ? flame : ''}${
      up && !lead ? `<div class="chip-up">${r.upBy ? `▲${r.upBy}` : 'YENİ'}</div>` : ''}<div class="tm">${fmtSec(r.net_ms)}</div>`;
    el.querySelector('.nm').textContent = r.name;
  });
}

// ---------- Başlık ----------
function updateHeader(now) {
  const active = [...players.values()].filter((pl) => isActive(pl, now)).length;
  const best = LB.rows[0];
  const label = best ? `REKOR · ${best.name.toLocaleUpperCase('tr-TR')}` : 'REKOR';
  if ($('#clock-label').textContent !== label) $('#clock-label').textContent = label;
  $('#clock-value').textContent = best ? fmtSec(best.net_ms) : '--,--';
  $('#c-players').textContent = active;
  $('#c-done').textContent = players.size;
}

// ---------- Döngüler ----------
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = (now - lastTick) / 1000; lastTick = now;
  stepBots(dt, now);
  if (now - lastHeartbeat > RATES.heartbeatMs) broadcastState();
  if (now - LB.loadedAt > 10000) loadLeaderboard();
  updateCards(now);
  updateBoard(now);
  updateHeader(now);
}, 200);

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  const k = 1 - Math.exp(-dt * RATES.posHz * 2.5);
  for (const pl of players.values()) {
    const c = pl.card; if (!c || !c.ctx) continue;
    const shown = (isActive(pl, now) || showsDone(pl, now)) && pl.maze;
    const maze = shown ? pl.maze : IDLE_MAZE;
    const tx = shown && pl.x != null ? pl.x : maze.start.x;
    const ty = shown && pl.y != null ? pl.y : maze.start.y;
    if (pl.dx == null || Math.hypot(tx - pl.dx, ty - pl.dy) > 3) { pl.dx = tx; pl.dy = ty; }
    else { pl.dx += (tx - pl.dx) * k; pl.dy += (ty - pl.dy) * k; }
    const fellNow = pl.fell || now - pl.fellAt < 600;
    drawMini(c.ctx, miniLayer(maze, c.w, c.h), pl.dx, pl.dy, fellNow, now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => requestAnimationFrame(() => sizeCards()));

// ---------- Kontroller ----------
const controls = $('#controls');
let hideT = 0;
addEventListener('mousemove', () => { controls.classList.add('show'); clearTimeout(hideT); hideT = setTimeout(() => controls.classList.remove('show'), 3000); });
$('#btn-full').addEventListener('click', toggleFull);
$('#btn-admin').addEventListener('click', adminLogin);
$('#btn-bans').addEventListener('click', showBans);
$('#bans-close').addEventListener('click', () => $('#bans').close());
$('#btn-mute').addEventListener('click', () => { snd.unlock(); const m = snd.toggleMuted(); $('#btn-mute').textContent = m ? 'Ses aç' : 'Ses kapat'; });
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, dialog')) return;
  if (e.key.toLowerCase() === 'f') toggleFull();
});
function toggleFull() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); }

// ---------- Yardımcılar ----------
function clamp(v, a, b) { return Math.min(b, Math.max(a, Number.isFinite(v) ? v : a)); }
function fmtSec(ms) { return ms == null ? '—' : (ms / 1000).toFixed(2).replace('.', ','); }

// ---------- Başlat ----------
updateAdminUi();
$('#btn-mute').textContent = snd.isMuted() ? 'Ses aç' : 'Ses kapat';
layoutGrid();
(async () => {
  if (!isConfigured()) {
    const box = $('#setup-error');
    box.hidden = false;
    box.textContent = BOTS
      ? 'Supabase ayarlı değil: sadece bot modu çalışıyor, telefonlar bağlanamaz. js/config.js dosyasını doldur.'
      : 'Supabase ayarlı değil. js/config.js içindeki URL ve anon key’i doldur. Arayüzü denemek için adrese ?bots=20 ekle.';
    return;
  }
  loadLeaderboard();
  // Kayıtlı yönetici kodu hâlâ geçerli mi
  if (adminCode) checkAdmin(adminCode).then((ok) => { if (!ok) { adminCode = null; store.set('dl-admin', null); updateAdminUi(); } }).catch(() => {});
  ctrlCh = await joinChannel(ctrlTopic(room), { hello: onHello }, (st) => {
    $('#ctrl-note').textContent = st === 'SUBSCRIBED' ? 'Bağlı' : `Bağlantı: ${st}`;
  });
  broadcastState();
})();
