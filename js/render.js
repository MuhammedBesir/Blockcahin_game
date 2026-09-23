// Ortak çizim: statik labirent katmanı bir kez çizilir (offscreen), dinamik öğeler her karede.
export const COLORS = {
  navy: '#0B1E3F', deep: '#081733', deeper: '#061129', neon: '#4FB8F0', neonDark: '#1C5F95',
  white: '#FFFFFF', ink: '#05080F', gold: '#FFC94D', muted: '#A9C6E6',
};

export function setupCanvas(canvas, cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// Labirentin çizim ölçüsü: hücre boyu + kenar boşluğu
export function mazeGeometry(maze, cssW, cssH) {
  const padCells = 0.3;
  const cell = Math.min(cssW / (maze.w + padCells * 2), cssH / (maze.h + padCells * 2));
  const ox = (cssW - maze.w * cell) / 2, oy = (cssH - maze.h * cell) / 2;
  return { cell, ox, oy, X: (x) => ox + x * cell, Y: (y) => oy + y * cell };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function star(ctx, cx, cy, R, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r : R;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function checker(ctx, x, y, w, h, n) {
  const s = w / n;
  ctx.fillStyle = COLORS.white; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = COLORS.ink;
  for (let j = 0; j < Math.round(h / s); j++) for (let i = 0; i < n; i++) if ((i + j) % 2 === 0) ctx.fillRect(x + i * s, y + j * s, s, s);
}

// mini=true: projeksiyondaki küçük kartlar için sade sürüm
export function buildMazeLayer(maze, cssW, cssH, { mini = false } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = setupCanvas(canvas, cssW, cssH);
  const g = mazeGeometry(maze, cssW, cssH);
  const c = g.cell;

  if (mini) {
    ctx.fillStyle = COLORS.deeper;
    roundRect(ctx, 0, 0, cssW, cssH, 8); ctx.fill();
  }

  // Noktalı ızgara zemin
  ctx.fillStyle = mini ? 'rgba(79,184,240,0.25)' : 'rgba(79,184,240,0.33)';
  const step = mini ? 1 : 0.5;
  for (let y = step / 2; y < maze.h; y += step) for (let x = step / 2; x < maze.w; x += step) {
    ctx.beginPath(); ctx.arc(g.X(x), g.Y(y), Math.max(0.8, c * 0.035), 0, Math.PI * 2); ctx.fill();
  }

  // Başlangıç alanı
  if (!mini) {
    ctx.save();
    ctx.setLineDash([c * 0.09, c * 0.07]);
    ctx.strokeStyle = 'rgba(79,184,240,0.6)'; ctx.lineWidth = Math.max(1, c * 0.035);
    ctx.fillStyle = 'rgba(79,184,240,0.08)';
    roundRect(ctx, g.X(0.1), g.Y(0.1), c * 0.8, c * 0.8, c * 0.2); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = COLORS.neon;
    ctx.font = `${Math.round(c * 0.2)}px Silkscreen, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('BAŞLA', g.X(0.5), g.Y(0.5));
  }

  // Bitiş: damalı bayrak
  const gx = maze.goal.x - 0.5, gy = maze.goal.y - 0.5;
  if (mini) {
    checker(ctx, g.X(gx + 0.1), g.Y(gy + 0.1), c * 0.8, c * 0.8, 4);
  } else {
    ctx.save();
    ctx.fillStyle = COLORS.navy;
    ctx.setLineDash([c * 0.08, c * 0.06]);
    ctx.strokeStyle = COLORS.white; ctx.lineWidth = Math.max(1, c * 0.035);
    roundRect(ctx, g.X(gx + 0.1), g.Y(gy + 0.1), c * 0.8, c * 0.8, c * 0.16); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    // direk
    ctx.strokeStyle = COLORS.white; ctx.lineWidth = c * 0.05; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(g.X(gx + 0.3), g.Y(gy + 0.83)); ctx.lineTo(g.X(gx + 0.3), g.Y(gy + 0.18)); ctx.stroke();
    // dalgalı bayrak, damalı desenle kırpılmış
    ctx.beginPath();
    const fx = g.X(gx + 0.32), fy = g.Y(gy + 0.2), fw = c * 0.5, fh = c * 0.34;
    ctx.moveTo(fx, fy);
    ctx.bezierCurveTo(fx + fw * 0.33, fy - fh * 0.25, fx + fw * 0.66, fy + fh * 0.25, fx + fw, fy);
    ctx.lineTo(fx + fw, fy + fh);
    ctx.bezierCurveTo(fx + fw * 0.66, fy + fh * 1.25, fx + fw * 0.33, fy + fh * 0.75, fx, fy + fh);
    ctx.closePath();
    ctx.save(); ctx.clip();
    checker(ctx, fx, fy - fh * 0.3, fw, fh * 1.6, 4);
    ctx.restore();
    ctx.lineWidth = c * 0.025; ctx.stroke();
    ctx.restore();
  }

  // Tuzak delikleri (statik kısım)
  for (const t of maze.traps) {
    const R = t.r * c;
    const grd = ctx.createRadialGradient(g.X(t.x), g.Y(t.y) - R * 0.1, R * 0.2, g.X(t.x), g.Y(t.y), R);
    grd.addColorStop(0, '#000'); grd.addColorStop(0.75, '#020A16'); grd.addColorStop(1, COLORS.neonDark);
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(g.X(t.x), g.Y(t.y), R, 0, Math.PI * 2); ctx.fill();
    if (mini) { ctx.strokeStyle = 'rgba(79,184,240,0.6)'; ctx.lineWidth = 1; ctx.stroke(); }
  }

  // Duvarlar: gölge → yan yüz → üst yüz (neon) → parlak kenar
  const wallPath = new Path2D();
  for (const s of maze.segs) { wallPath.moveTo(g.X(s.x1), g.Y(s.y1)); wallPath.lineTo(g.X(s.x2), g.Y(s.y2)); }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const layer = (dx, dy, color, width, blur = 0) => {
    ctx.save(); ctx.translate(dx, dy);
    ctx.strokeStyle = color; ctx.lineWidth = width;
    if (blur) { ctx.shadowColor = 'rgba(79,184,240,0.6)'; ctx.shadowBlur = blur; }
    ctx.stroke(wallPath); ctx.restore();
  };
  layer(c * 0.05, c * 0.13, 'rgba(0,0,0,0.7)', c * 0.24);
  if (!mini) layer(0, c * 0.06, COLORS.neonDark, c * 0.2);
  layer(0, 0, COLORS.neon, c * 0.16, mini ? c * 0.15 : c * 0.3);
  if (!mini) layer(0, -c * 0.03, 'rgba(255,255,255,0.6)', c * 0.04);

  return { canvas, geom: g };
}

// Telefonun her karesi
export function drawFrame(ctx, layer, maze, st, now) {
  const { canvas, geom: g } = layer;
  const c = g.cell;
  const cw = layer._cw || (layer._cw = parseFloat(canvas.style.width));
  const ch = layer._ch || (layer._ch = parseFloat(canvas.style.height));
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(canvas, 0, 0, cw, ch);

  // Bitiş parıltısı
  const pulse = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(now / 280));
  ctx.save();
  ctx.globalAlpha = pulse; ctx.fillStyle = COLORS.neon; ctx.shadowColor = COLORS.neon; ctx.shadowBlur = c * 0.5;
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillRect(g.X(maze.goal.x - 0.45), g.Y(maze.goal.y - 0.45), c * 0.9, c * 0.9);
  ctx.restore();

  // Tuzak halkaları döner
  ctx.save();
  ctx.strokeStyle = 'rgba(79,184,240,0.8)'; ctx.lineWidth = Math.max(1, c * 0.035);
  ctx.setLineDash([c * 0.09, c * 0.09]); ctx.lineDashOffset = -now / 60;
  for (const t of maze.traps) { ctx.beginPath(); ctx.arc(g.X(t.x), g.Y(t.y), t.r * c + c * 0.07, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();

  // Yıldızlar
  maze.stars.forEach((s, i) => {
    if (st.collected.has(i)) return;
    const phase = now / 260 + i;
    const bob = Math.sin(phase) * c * 0.03;
    const sc = 1 + Math.sin(phase) * 0.06;
    ctx.save();
    ctx.shadowColor = 'rgba(255,201,77,0.85)'; ctx.shadowBlur = c * 0.25;
    star(ctx, g.X(s.x), g.Y(s.y) + bob, c * 0.3 * sc, c * 0.13 * sc);
    ctx.fillStyle = COLORS.gold; ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = c * 0.03; ctx.strokeStyle = COLORS.ink; ctx.stroke();
    ctx.restore();
  });

  // Coin'ler
  if (maze.coins) {
    maze.coins.forEach((coin, i) => {
      if (st.collectedCoins?.has(i)) return;
      const phase = now / 320 + i * 1.7;
      const bob = Math.sin(phase) * c * 0.025;
      const cx = g.X(coin.x), cy = g.Y(coin.y) + bob;
      const r = c * 0.28;
      ctx.save();
      if (coin.type === 'btc') {
        ctx.shadowColor = '#F7931A'; ctx.shadowBlur = c * 0.2;
        ctx.fillStyle = '#F7931A';
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#FFF'; ctx.font = `bold ${Math.round(r * 1.2)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('₿', cx, cy + 1);
      } else if (coin.type === 'eth') {
        ctx.shadowColor = '#627EEA'; ctx.shadowBlur = c * 0.2;
        ctx.fillStyle = '#627EEA';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.8, cy + r * 0.1);
        ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.8, cy + r * 0.1); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#FFF'; ctx.lineWidth = Math.max(1, c * 0.025); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - r * 0.55, cy + r * 0.1);
        ctx.lineTo(cx, cy - r * 0.3); ctx.lineTo(cx + r * 0.55, cy + r * 0.1);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.stroke();
      } else {
        ctx.shadowColor = '#2DD4A8'; ctx.shadowBlur = c * 0.15;
        ctx.fillStyle = '#2DD4A8';
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#FFF'; ctx.font = `bold ${Math.round(r * 0.9)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('¢', cx, cy + 1);
      }
      ctx.restore();
    });
  }

  // Toplanan yıldız için kısa "+1" patlaması
  if (st.popFx && now - st.popFx.t < 700) {
    const k = (now - st.popFx.t) / 700;
    const ease = 1 - (1 - k) * (1 - k);
    ctx.save(); ctx.globalAlpha = 1 - ease; ctx.fillStyle = COLORS.gold;
    ctx.font = `${Math.round(c * 0.4)}px "Rubik Mono One", sans-serif`; ctx.textAlign = 'center';
    ctx.shadowColor = COLORS.gold; ctx.shadowBlur = c * 0.3 * (1 - ease);
    ctx.fillText('−1 sn', g.X(st.popFx.x), g.Y(st.popFx.y) - ease * c * 0.9);
    ctx.restore();
  }

  // Coin toplama efekti
  if (st.coinFx && now - st.coinFx.t < 600) {
    const k = (now - st.coinFx.t) / 600;
    const ease = 1 - (1 - k) * (1 - k);
    const colors = { btc: '#F7931A', eth: '#627EEA', alt: '#2DD4A8' };
    ctx.save(); ctx.globalAlpha = 1 - ease; ctx.fillStyle = colors[st.coinFx.type] || '#FFC94D';
    ctx.font = `bold ${Math.round(c * 0.38)}px "Rubik Mono One", sans-serif`; ctx.textAlign = 'center';
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = c * 0.25 * (1 - ease);
    ctx.fillText(`+${st.coinFx.val}`, g.X(st.coinFx.x), g.Y(st.coinFx.y) - ease * c * 0.9);
    ctx.restore();
  }

  // Parçacıklar (varsa)
  if (st.particles) st.particles.draw(ctx, g);

  const b = st.ball;
  const fallK = st.falling ? Math.min(1, (now - st.falling.t) / 500) : 0;
  const spawnK = st.respawnAt ? Math.min(1, (now - st.respawnAt) / 300) : 1;
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  const scale = st.falling ? Math.max(0, 1 - easeOut(fallK)) : easeOut(spawnK);
  const R = 0.3 * c * scale;

  // İz: yumuşak gradient
  if (!st.falling && st.trail.length > 1) {
    for (let i = 0; i < st.trail.length; i++) {
      const p = st.trail[i], k = (i + 1) / st.trail.length;
      const alpha = 0.03 + k * k * 0.35;
      ctx.beginPath(); ctx.fillStyle = `rgba(79,184,240,${alpha})`;
      ctx.arc(g.X(p.x), g.Y(p.y), R * (0.3 + k * 0.6), 0, Math.PI * 2); ctx.fill();
    }
  }

  if (R > 0.5) {
    const bx = st.falling ? g.X(st.falling.x) : g.X(b.x), by = st.falling ? g.Y(st.falling.y) : g.Y(b.y);
    // gölge (radial gradient yerine blur filtresi — mobilde daha hafif)
    const sgrd = ctx.createRadialGradient(bx + R * 0.15, by + R * 0.4, 0, bx + R * 0.15, by + R * 0.4, R * 1.3);
    sgrd.addColorStop(0, 'rgba(0,0,0,0.45)'); sgrd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sgrd;
    ctx.beginPath(); ctx.ellipse(bx + R * 0.15, by + R * 0.4, R * 1.1, R * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    // gövde
    const grd = ctx.createRadialGradient(bx - R * 0.35, by - R * 0.4, R * 0.1, bx, by, R);
    grd.addColorStop(0, '#FFFFFF'); grd.addColorStop(0.3, '#CDEEFF'); grd.addColorStop(0.65, COLORS.neon); grd.addColorStop(1, '#154C7C');
    ctx.save(); ctx.shadowColor = 'rgba(79,184,240,0.9)'; ctx.shadowBlur = R * 0.9;
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // parlama
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.ellipse(bx - R * 0.32, by - R * 0.38, R * 0.32, R * 0.2, -0.5, 0, Math.PI * 2); ctx.fill();
  }
}

// Eğim göstergesi (pusula)
export function drawGauge(ctx, size, tx, ty, maxDeg) {
  const r = size / 2, cx = r, cy = r;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = COLORS.deep; ctx.strokeStyle = COLORS.neon; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx, cy, r - 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(79,184,240,0.55)'; ctx.lineWidth = 5;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14));
    ctx.lineTo(cx + Math.cos(a) * (r - 13), cy + Math.sin(a) * (r - 13)); ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(79,184,240,0.3)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.46, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(79,184,240,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, 22); ctx.lineTo(cx, size - 22); ctx.moveTo(22, cy); ctx.lineTo(size - 22, cy); ctx.stroke();
  ctx.font = '9px Silkscreen, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = ty < -3 ? '#FFF' : COLORS.muted; ctx.fillText('YUKARI', cx, 11);
  ctx.fillStyle = ty > 3 ? '#FFF' : COLORS.muted; ctx.fillText('AŞAĞI', cx, size - 10);
  ctx.textAlign = 'left'; ctx.fillStyle = tx < -3 ? '#FFF' : COLORS.muted; ctx.fillText('SOL', 8, cy);
  ctx.textAlign = 'right'; ctx.fillStyle = tx > 3 ? '#FFF' : COLORS.muted; ctx.fillText('SAĞ', size - 8, cy);

  const reach = r * 0.62;
  let dx = (tx / maxDeg) * reach, dy = (ty / maxDeg) * reach;
  const d = Math.hypot(dx, dy); if (d > reach) { dx *= reach / d; dy *= reach / d; }
  ctx.strokeStyle = '#FFF'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  if (Math.hypot(dx, dy) > 12) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + dx * 0.78, cy + dy * 0.78); ctx.stroke(); }
  ctx.save(); ctx.shadowColor = COLORS.neon; ctx.shadowBlur = 10;
  ctx.fillStyle = COLORS.neon; ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 11, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#FFF'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(cx + dx - 3.5, cy + dy - 3.5, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFF'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
}

// Mini kart (projeksiyon)
export function drawMini(ctx, layer, x, y, fell, now) {
  const { canvas, geom: g } = layer;
  const w = parseFloat(canvas.style.width), h = parseFloat(canvas.style.height);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0, w, h);
  if (x == null) return;
  const c = g.cell;
  const R = fell ? c * 0.18 : c * 0.34;
  const glow = 0.5 + 0.5 * Math.sin(now / 160);
  ctx.fillStyle = `rgba(79,184,240,${0.25 + glow * 0.3})`;
  ctx.beginPath(); ctx.arc(g.X(x), g.Y(y), R * 1.9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFF'; ctx.strokeStyle = COLORS.neon; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(g.X(x), g.Y(y), R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}
