// Seed'li labirent üretimi. Aynı seed her cihazda birebir aynı labirenti üretir.
// Koordinatlar hücre biriminde: (0,0) sol üst köşe, hücre merkezi x+0.5.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 1, E = 2, S = 4, W_ = 8;
const DIRS = [
  { dx: 0, dy: -1, bit: N, opp: S },
  { dx: 1, dy: 0, bit: E, opp: W_ },
  { dx: 0, dy: 1, bit: S, opp: N },
  { dx: -1, dy: 0, bit: W_, opp: E },
];

export function generateMaze(seed, opts) {
  const { w, h, stars: nStars, traps: nTraps, loops, coins: coinCfg } = opts;
  const rnd = mulberry32(seed);
  const idx = (x, y) => y * w + x;
  const walls = new Uint8Array(w * h).fill(N | E | S | W_);

  // 1) Recursive backtracker
  const vis = new Uint8Array(w * h);
  const stack = [[0, 0]];
  vis[0] = 1;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const opts2 = DIRS.filter(d => {
      const nx = x + d.dx, ny = y + d.dy;
      return nx >= 0 && ny >= 0 && nx < w && ny < h && !vis[idx(nx, ny)];
    });
    if (!opts2.length) { stack.pop(); continue; }
    const d = opts2[Math.floor(rnd() * opts2.length)];
    const nx = x + d.dx, ny = y + d.dy;
    walls[idx(x, y)] &= ~d.bit;
    walls[idx(nx, ny)] &= ~d.opp;
    vis[idx(nx, ny)] = 1;
    stack.push([nx, ny]);
  }

  // 2) Birkaç duvarı kaldırıp alternatif yol aç (yarış daha taktiksel olur)
  let removed = 0, guard = 0;
  while (removed < loops && guard++ < 500) {
    const x = Math.floor(rnd() * w), y = Math.floor(rnd() * h);
    const d = DIRS[1 + Math.floor(rnd() * 2)]; // E veya S
    const nx = x + d.dx, ny = y + d.dy;
    if (nx >= w || ny >= h) continue;
    if (!(walls[idx(x, y)] & d.bit)) continue;
    walls[idx(x, y)] &= ~d.bit;
    walls[idx(nx, ny)] &= ~d.opp;
    removed++;
  }

  const open = (x, y, d) => !(walls[idx(x, y)] & d.bit);

  // 3) Hedefe BFS mesafesi (ilerleme yüzdesi için)
  const goal = { x: w - 1, y: h - 1 };
  const dist = new Int16Array(w * h).fill(-1);
  dist[idx(goal.x, goal.y)] = 0;
  const q = [[goal.x, goal.y]];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const d of DIRS) {
      if (!open(x, y, d)) continue;
      const nx = x + d.dx, ny = y + d.dy;
      if (dist[idx(nx, ny)] === -1) { dist[idx(nx, ny)] = dist[idx(x, y)] + 1; q.push([nx, ny]); }
    }
  }

  // 4) Başlangıçtan en kısa yol
  const path = [[0, 0]];
  let cx = 0, cy = 0;
  while (!(cx === goal.x && cy === goal.y)) {
    const cur = dist[idx(cx, cy)];
    const d = DIRS.find(d => open(cx, cy, d) && dist[idx(cx + d.dx, cy + d.dy)] === cur - 1);
    cx += d.dx; cy += d.dy;
    path.push([cx, cy]);
  }
  const onPath = new Set(path.map(([x, y]) => idx(x, y)));

  // 5) Yıldız ve tuzak yerleşimi
  const blocked = new Set([idx(0, 0), idx(1, 0), idx(0, 1), idx(goal.x, goal.y), idx(goal.x - 1, goal.y), idx(goal.x, goal.y - 1)]);
  const used = new Set();
  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  const wallCount = (i) => { let c = 0, v = walls[i]; while (v) { c += v & 1; v >>= 1; } return c; };

  const stars = [];
  const pathMid = shuffle(path.slice(Math.floor(path.length * 0.2), Math.floor(path.length * 0.9)));
  const deadEnds = shuffle([...Array(w * h).keys()].filter(i => wallCount(i) === 3 && !onPath.has(i) && !blocked.has(i)));
  const onPathStars = Math.min(2, nStars);
  for (const [x, y] of pathMid) {
    if (stars.length >= onPathStars) break;
    const i = idx(x, y);
    if (blocked.has(i) || used.has(i)) continue;
    stars.push({ x: x + 0.5, y: y + 0.5 }); used.add(i);
  }
  for (const i of deadEnds) {
    if (stars.length >= nStars) break;
    if (used.has(i)) continue;
    stars.push({ x: (i % w) + 0.5, y: Math.floor(i / w) + 0.5 }); used.add(i);
  }

  // Tuzakların yarısı yol üstündeki dönemeçlerin dış köşesine (hızlı giren düşer),
  // yarısı yola komşu çıkmaz hücrelerin ortasına.
  const traps = [];
  const turnCount = Math.ceil(nTraps / 2);
  const turns = [];
  for (let k = 1; k < path.length - 1; k++) {
    const [px, py] = path[k - 1], [x, y] = path[k], [nx, ny] = path[k + 1];
    const inD = [x - px, y - py], outD = [nx - x, ny - y];
    if (inD[0] === outD[0] && inD[1] === outD[1]) continue;
    const i = idx(x, y);
    if (blocked.has(i) || used.has(i)) continue;
    turns.push({ i, x: x + 0.5 + 0.27 * (inD[0] - outD[0]), y: y + 0.5 + 0.27 * (inD[1] - outD[1]) });
  }
  for (const t of shuffle(turns)) {
    if (traps.length >= turnCount) break;
    traps.push({ x: t.x, y: t.y, r: 0.2 }); used.add(t.i);
  }
  const offPath = shuffle([...Array(w * h).keys()].filter(i => !onPath.has(i) && !blocked.has(i) && !used.has(i)));
  for (const i of offPath) {
    if (traps.length >= nTraps) break;
    traps.push({ x: (i % w) + 0.5, y: Math.floor(i / w) + 0.5, r: 0.33 }); used.add(i);
  }

  // 6) Coin yerleşimi
  const coins = [];
  if (coinCfg) {
    // BTC: yoldan uzak, zor erişilen çıkmaz hücreler
    const farDead = shuffle([...Array(w * h).keys()].filter(i =>
      wallCount(i) >= 2 && !onPath.has(i) && !blocked.has(i) && !used.has(i) && dist[i] > dist[0] * 0.3
    ));
    for (const i of farDead) {
      if (coins.filter(c => c.type === 'btc').length >= (coinCfg.btc || 0)) break;
      coins.push({ x: (i % w) + 0.5, y: Math.floor(i / w) + 0.5, type: 'btc' }); used.add(i);
    }
    // ETH: yol üzerinde ama başlangıç/bitiş civarında değil
    const midPath = shuffle(path.slice(Math.floor(path.length * 0.25), Math.floor(path.length * 0.75)));
    for (const [x, y] of midPath) {
      if (coins.filter(c => c.type === 'eth').length >= (coinCfg.eth || 0)) break;
      const i = idx(x, y);
      if (used.has(i) || blocked.has(i)) continue;
      coins.push({ x: x + 0.5, y: y + 0.5, type: 'eth' }); used.add(i);
    }
    // Altcoin: kalan boş hücreler
    const remaining = shuffle([...Array(w * h).keys()].filter(i => !blocked.has(i) && !used.has(i)));
    for (const i of remaining) {
      if (coins.filter(c => c.type === 'alt').length >= (coinCfg.alt || 0)) break;
      coins.push({ x: (i % w) + 0.5, y: Math.floor(i / w) + 0.5, type: 'alt' }); used.add(i);
    }
  }

  // 7) Duvar segmentleri (çizim + çarpışma). Birleşik yatay/dikey çizgiler.
  const segs = [];
  for (let y = 0; y <= h; y++) {
    let run = null;
    for (let x = 0; x <= w; x++) {
      const wall = x < w && (y === h ? !!(walls[idx(x, h - 1)] & S) : !!(walls[idx(x, y)] & N));
      if (wall && run === null) run = x;
      if (!wall && run !== null) { segs.push({ x1: run, y1: y, x2: x, y2: y }); run = null; }
    }
  }
  for (let x = 0; x <= w; x++) {
    let run = null;
    for (let y = 0; y <= h; y++) {
      const wall = y < h && (x === w ? !!(walls[idx(w - 1, y)] & E) : !!(walls[idx(x, y)] & W_));
      if (wall && run === null) run = y;
      if (!wall && run !== null) { segs.push({ x1: x, y1: run, x2: x, y2: y }); run = null; }
    }
  }

  // Çarpışma için hücre başına yakın segment listesi
  const buckets = Array.from({ length: w * h }, () => []);
  segs.forEach((s, si) => {
    const x0 = Math.max(0, Math.floor(Math.min(s.x1, s.x2)) - 1), x1 = Math.min(w - 1, Math.ceil(Math.max(s.x1, s.x2)));
    const y0 = Math.max(0, Math.floor(Math.min(s.y1, s.y2)) - 1), y1 = Math.min(h - 1, Math.ceil(Math.max(s.y1, s.y2)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) buckets[idx(x, y)].push(si);
  });

  return {
    w, h, seed, walls, dist, path, stars, traps, coins, segs, buckets,
    start: { x: 0.5, y: 0.5 },
    goal: { x: goal.x + 0.5, y: goal.y + 0.5 },
    startDist: dist[0],
    progressAt(x, y) {
      const cx = Math.min(w - 1, Math.max(0, Math.floor(x)));
      const cy = Math.min(h - 1, Math.max(0, Math.floor(y)));
      return Math.max(0, Math.min(1, 1 - dist[idx(cx, cy)] / dist[0]));
    },
    // Botlar için: yol boyunca 0..1 arası konum
    pointOnPath(f) {
      const pts = path.map(([x, y]) => [x + 0.5, y + 0.5]);
      let s = Math.max(0, Math.min(1, f)) * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(s));
      const t = s - i;
      return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t };
    },
  };
}
