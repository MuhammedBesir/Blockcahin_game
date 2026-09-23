// Top fiziği: eğimden ivme, sürtünme, duvarlarla kapsül çarpışması, alt adımlarla tünellemesiz hareket.
import { PHYSICS as P } from './config.js';

export function createBall(maze) {
  return { x: maze.start.x, y: maze.start.y, vx: 0, vy: 0 };
}

// tiltX/tiltY derece cinsinden (sağa +, aşağı +), kalibre edilmiş.
export function tiltToAccel(tiltX, tiltY) {
  const f = (deg) => {
    const a = Math.abs(deg) < P.deadzoneDeg ? 0 : Math.max(-P.maxTiltDeg, Math.min(P.maxTiltDeg, deg));
    return Math.sin((a * Math.PI) / 180) * P.gravity;
  };
  return { ax: f(tiltX), ay: f(tiltY) };
}

export function stepBall(ball, maze, ax, ay, dt) {
  dt = Math.min(dt, 1 / 20); // sekme sonrası dev adımları önle
  ball.vx += ax * dt;
  ball.vy += ay * dt;
  const damp = Math.max(0, 1 - P.friction * dt);
  ball.vx *= damp; ball.vy *= damp;
  const sp = Math.hypot(ball.vx, ball.vy);
  if (sp > P.maxSpeed) { ball.vx *= P.maxSpeed / sp; ball.vy *= P.maxSpeed / sp; }

  const steps = Math.max(1, Math.ceil((Math.hypot(ball.vx, ball.vy) * dt) / (P.ballR * 0.35)));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    ball.x += ball.vx * sdt;
    ball.y += ball.vy * sdt;
    collide(ball, maze);
  }
}

function collide(ball, maze) {
  const R = P.ballR + P.wallHalf;
  const cx = Math.min(maze.w - 1, Math.max(0, Math.floor(ball.x)));
  const cy = Math.min(maze.h - 1, Math.max(0, Math.floor(ball.y)));
  const list = maze.buckets[cy * maze.w + cx];
  for (let pass = 0; pass < 2; pass++) {
    for (const si of list) {
      const s = maze.segs[si];
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((ball.x - s.x1) * dx + (ball.y - s.y1) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = s.x1 + dx * t, py = s.y1 + dy * t;
      let nx = ball.x - px, ny = ball.y - py;
      const d = Math.hypot(nx, ny);
      if (d >= R || d === 0) continue;
      nx /= d; ny /= d;
      ball.x = px + nx * R;
      ball.y = py + ny * R;
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        ball.vx -= (1 + P.bounce) * vn * nx;
        ball.vy -= (1 + P.bounce) * vn * ny;
      }
    }
  }
  // Güvenlik: dış sınırdan asla çıkmasın
  ball.x = Math.min(maze.w - R, Math.max(R, ball.x));
  ball.y = Math.min(maze.h - R, Math.max(R, ball.y));
}

export function checkEvents(ball, maze, collectedCoins) {
  if (maze.coins && collectedCoins) {
    for (let i = 0; i < maze.coins.length; i++) {
      if (collectedCoins.has(i)) continue;
      const c = maze.coins[i];
      if (Math.hypot(ball.x - c.x, ball.y - c.y) < P.ballR + P.coinR * 0.6) return { type: 'coin', i };
    }
  }
  for (let i = 0; i < maze.traps.length; i++) {
    const t = maze.traps[i];
    if (Math.hypot(ball.x - t.x, ball.y - t.y) < t.r) return { type: 'trap', i };
  }
  if (Math.hypot(ball.x - maze.goal.x, ball.y - maze.goal.y) < P.finishR) return { type: 'finish' };
  return null;
}
