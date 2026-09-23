// Hafif parçacık motoru. Her efekt tipi için havuz kullanılır, GC baskısı düşük tutulur.
// Kullanım: const ps = createParticleSystem(); ps.emit('star', x, y); her karede ps.update(dt); ps.draw(ctx, geom);

export function createParticleSystem() {
  const pool = [];
  const MAX = 300;

  function spawn(n, cfg) {
    for (let i = 0; i < n; i++) {
      if (pool.length >= MAX) break;
      const a = cfg.angle != null ? cfg.angle + (Math.random() - 0.5) * cfg.spread : Math.random() * Math.PI * 2;
      const speed = cfg.speed * (0.6 + Math.random() * 0.8);
      pool.push({
        x: cfg.x + (Math.random() - 0.5) * (cfg.jitter || 0),
        y: cfg.y + (Math.random() - 0.5) * (cfg.jitter || 0),
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0,
        maxLife: cfg.life * (0.7 + Math.random() * 0.6),
        r: cfg.r * (0.6 + Math.random() * 0.8),
        color: cfg.colors[Math.floor(Math.random() * cfg.colors.length)],
        gravity: cfg.gravity || 0,
        friction: cfg.friction || 0,
        shape: cfg.shape || 'circle',
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 8,
      });
    }
  }

  function emit(type, x, y, cell) {
    const c = cell || 40;
    switch (type) {
      case 'star':
        spawn(18, { x, y, speed: c * 2.5, life: 0.5, r: c * 0.06, colors: ['#FFC94D', '#FFE599', '#FFFFFF', '#FFD700'], jitter: c * 0.1, gravity: c * 1.5 });
        spawn(6, { x, y, speed: c * 1.2, life: 0.7, r: c * 0.04, colors: ['#FFC94D', '#FFE599'], shape: 'star', jitter: c * 0.05 });
        break;
      case 'trap':
        spawn(14, { x, y, speed: c * 1.8, life: 0.45, r: c * 0.05, colors: ['#4FB8F0', '#1C5F95', '#081733', '#000000'], gravity: c * 3, friction: 3 });
        spawn(8, { x, y, speed: c * 0.6, life: 0.6, r: c * 0.08, colors: ['rgba(79,184,240,0.6)', 'rgba(0,0,0,0.8)'], shape: 'ring', jitter: c * 0.15 });
        break;
      case 'finish':
        for (let i = 0; i < 3; i++) {
          spawn(12, { x, y, speed: c * (2 + i * 1.5), life: 0.6 + i * 0.15, r: c * 0.05, colors: ['#4FB8F0', '#FFFFFF', '#FFC94D', '#CDEEFF'], jitter: c * 0.2, gravity: c * 0.8 });
        }
        spawn(8, { x, y, speed: c * 0.8, life: 0.9, r: c * 0.04, colors: ['#FFC94D', '#FFE599'], shape: 'star' });
        break;
      case 'trail':
        spawn(1, { x, y, speed: c * 0.3, life: 0.35, r: c * 0.035, colors: ['rgba(79,184,240,0.5)', 'rgba(79,184,240,0.3)'], jitter: c * 0.08 });
        break;
    }
  }

  function update(dt) {
    for (let i = pool.length - 1; i >= 0; i--) {
      const p = pool[i];
      p.life += dt;
      if (p.life >= p.maxLife) { pool.splice(i, 1); continue; }
      if (p.friction) {
        const f = Math.max(0, 1 - p.friction * dt);
        p.vx *= f; p.vy *= f;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }

  function draw(ctx, geom) {
    if (!pool.length) return;
    const g = geom;
    ctx.save();
    for (const p of pool) {
      const k = 1 - p.life / p.maxLife;
      const alpha = k < 0.3 ? k / 0.3 : k;
      const px = g.X(p.x), py = g.Y(p.y);
      const r = p.r * g.cell * (0.5 + k * 0.5);
      if (r < 0.3) continue;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;

      if (p.shape === 'star') {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.rot);
        drawStar(ctx, 0, 0, r, r * 0.4);
        ctx.fill();
        ctx.restore();
      } else if (p.shape === 'ring') {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(0.5, r * 0.3);
        ctx.globalAlpha = alpha * 0.7;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        if (k > 0.5) {
          ctx.globalAlpha = alpha * 0.4;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = r * 2;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }
    ctx.restore();
  }

  function drawStar(ctx, cx, cy, R, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r : R;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  return { emit, update, draw, count: () => pool.length };
}
