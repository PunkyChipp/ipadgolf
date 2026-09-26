// Ball physics for Pocket Putt.
// No DOM access here, so the same code runs in the browser and in Node (see test/solve.mjs).

export const BALL_R = 8;
export const HOLE_R = 13;
export const MAX_SPEED = 1500;
export const PORTAL_R = 22;
export const STEP = 1 / 240;

const GRASS = { a: 170, k: 0.85 }; // constant + speed-proportional deceleration
const SAND = { a: 1300, k: 3.2 };
const WALL_E = 0.78; // wall restitution
const SINK_SPEED = 620; // faster than this and the ball lips out
const HOLE_PULL = 2400;
const BUMPER_KICK = 260;

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function closestPoint(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [ax + abx * t, ay + aby * t];
}

export function edges(poly, out = []) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    out.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1] });
  }
  return out;
}

export function distToPoly(x, y, poly) {
  let best = Infinity;
  for (const s of edges(poly)) {
    const [qx, qy] = closestPoint(x, y, s.ax, s.ay, s.bx, s.by);
    best = Math.min(best, Math.hypot(x - qx, y - qy));
  }
  return best;
}

export class World {
  constructor(level) {
    this.level = level;
    this.t = 0;
    this.acc = 0;
    this.segs = edges(level.course);
    for (const w of level.walls || []) edges(w, this.segs);
    this.walls = level.walls || [];
    this.sand = level.sand || [];
    this.water = level.water || [];
    this.slopes = level.slopes || [];
    this.portals = level.portals || [];
    this.bumpers = (level.bumpers || []).map((b) => ({ ...b, flash: 0 }));
    this.movers = (level.movers || []).map((m) => ({ phase: 0, ...m, ox: 0, oy: 0, vx: 0, vy: 0 }));
    this.spinners = (level.spinners || []).map((s) => ({ blades: 4, w: 12, phase: 0, ...s, angle: 0 }));
    this.hole = { x: level.hole[0], y: level.hole[1] };
    this.ball = { x: level.tee[0], y: level.tee[1], vx: 0, vy: 0 };
    this.lastShot = { x: this.ball.x, y: this.ball.y };
    this.sinkFrom = null;
    this.moving = false;
    this.sunk = false;
    this.inSand = false;
    this.overHole = false;
    this.slowT = 0;
    this.shotT = 0;
    this.portalLock = null;
    this.events = [];
    this.kinematics();
  }

  emit(type, x, y, s = 0, extra = null) {
    this.events.push({ type, x, y, s, extra });
  }

  canShoot() {
    return !this.moving && !this.sunk;
  }

  // power is 0..1; the curve gives finer control over short putts.
  shoot(angle, power) {
    if (!this.canShoot()) return false;
    const b = this.ball;
    const sp = MAX_SPEED * Math.pow(Math.max(0, Math.min(1, power)), 1.3);
    this.lastShot = { x: b.x, y: b.y };
    b.vx = Math.cos(angle) * sp;
    b.vy = Math.sin(angle) * sp;
    this.moving = true;
    this.slowT = 0;
    this.shotT = 0;
    return true;
  }

  kinematics() {
    for (const m of this.movers) {
      const w = (Math.PI * 2) / m.period;
      const a = w * this.t + m.phase;
      const s = Math.sin(a), c = Math.cos(a);
      m.ox = m.dx * s;
      m.oy = m.dy * s;
      m.vx = m.dx * c * w;
      m.vy = m.dy * c * w;
    }
    for (const s of this.spinners) s.angle = s.phase + s.speed * this.t;
  }

  moverPoly(m) {
    const x = m.x + m.ox, y = m.y + m.oy;
    return [[x, y], [x + m.w, y], [x + m.w, y + m.h], [x, y + m.h]];
  }

  bladeEnds(s) {
    const out = [];
    for (let i = 0; i < s.blades; i++) {
      const a = s.angle + (i * Math.PI * 2) / s.blades;
      out.push([s.x + Math.cos(a) * s.len, s.y + Math.sin(a) * s.len]);
    }
    return out;
  }

  update(dt) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.substep();
    }
  }

  substep() {
    this.t += STEP;
    this.kinematics();
    for (const bp of this.bumpers) if (bp.flash > 0) bp.flash = Math.max(0, bp.flash - STEP * 4);
    if (this.sunk) return;
    const b = this.ball;

    if (!this.moving) {
      // Windmills and sliding blocks can still knock a resting ball.
      if (this.collideDynamic() > 0) {
        this.moving = true;
        this.slowT = 0;
        this.shotT = 0;
      }
      return;
    }
    this.shotT += STEP;

    let fr = GRASS;
    let sloped = false;
    let sandNow = false;
    for (const s of this.sand) if (pointInPoly(b.x, b.y, s)) { sandNow = true; break; }
    if (sandNow) {
      fr = SAND;
      if (!this.inSand) this.emit('sand', b.x, b.y, Math.hypot(b.vx, b.vy));
    }
    this.inSand = sandNow;

    for (const s of this.slopes) {
      if (s.poly) {
        if (pointInPoly(b.x, b.y, s.poly)) {
          b.vx += s.force[0] * STEP;
          b.vy += s.force[1] * STEP;
          sloped = true;
        }
      } else {
        const dx = b.x - s.x, dy = b.y - s.y, d = Math.hypot(dx, dy);
        if (d > s.r0 && d < s.r1) {
          b.vx += (dx / d) * s.strength * STEP;
          b.vy += (dy / d) * s.strength * STEP;
          sloped = true;
        }
      }
    }

    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) {
      const ns = Math.max(0, sp - (fr.a + fr.k * sp) * STEP);
      b.vx *= ns / sp;
      b.vy *= ns / sp;
    }
    b.x += b.vx * STEP;
    b.y += b.vy * STEP;

    let impact = 0;
    for (const s of this.segs) impact = Math.max(impact, this.collideSeg(s.ax, s.ay, s.bx, s.by, 0, 0, 0, null));
    impact = Math.max(impact, this.collideDynamic());
    if (impact > 50) this.emit('hit', b.x, b.y, impact);
    this.collideBumpers();
    this.checkPortals();
    if (this.checkHole()) return;
    if (this.checkHazards()) return;
    this.checkRest(sloped);
  }

  collideSeg(ax, ay, bx, by, rad, wvx, wvy, spin) {
    const b = this.ball;
    const [qx, qy] = closestPoint(b.x, b.y, ax, ay, bx, by);
    let dx = b.x - qx, dy = b.y - qy;
    const min = BALL_R + rad;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return 0;
    let d = Math.sqrt(d2);
    if (d < 1e-6) {
      dx = -(by - ay);
      dy = bx - ax;
      d = Math.hypot(dx, dy) || 1;
    }
    const nx = dx / d, ny = dy / d;
    b.x = qx + nx * min;
    b.y = qy + ny * min;
    if (spin) {
      wvx = -spin.speed * (qy - spin.y);
      wvy = spin.speed * (qx - spin.x);
    }
    const rvx = b.vx - wvx, rvy = b.vy - wvy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return 0;
    const tx = rvx - vn * nx, ty = rvy - vn * ny;
    b.vx = wvx + tx * 0.96 - vn * WALL_E * nx;
    b.vy = wvy + ty * 0.96 - vn * WALL_E * ny;
    return -vn;
  }

  collideDynamic() {
    let impact = 0;
    for (const m of this.movers) {
      const p = this.moverPoly(m);
      for (let i = 0; i < 4; i++) {
        const a = p[i], c = p[(i + 1) % 4];
        impact = Math.max(impact, this.collideSeg(a[0], a[1], c[0], c[1], 0, m.vx, m.vy, null));
      }
    }
    for (const s of this.spinners) {
      for (const [ex, ey] of this.bladeEnds(s)) {
        impact = Math.max(impact, this.collideSeg(s.x, s.y, ex, ey, s.w / 2, 0, 0, s));
      }
    }
    return impact;
  }

  collideBumpers() {
    const b = this.ball;
    for (const bp of this.bumpers) {
      const dx = b.x - bp.x, dy = b.y - bp.y;
      const min = BALL_R + bp.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1;
      const nx = dx / d, ny = dy / d;
      b.x = bp.x + nx * min;
      b.y = bp.y + ny * min;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        const out = -vn * 0.9 + BUMPER_KICK;
        b.vx += (-vn + out) * nx;
        b.vy += (-vn + out) * ny;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > MAX_SPEED) {
          b.vx *= MAX_SPEED / sp;
          b.vy *= MAX_SPEED / sp;
        }
        bp.flash = 1;
        this.emit('bumper', bp.x + nx * bp.r, bp.y + ny * bp.r, out);
      }
    }
  }

  checkPortals() {
    const b = this.ball;
    if (this.portalLock) {
      if (Math.hypot(b.x - this.portalLock.x, b.y - this.portalLock.y) > PORTAL_R + BALL_R) this.portalLock = null;
      return;
    }
    for (const p of this.portals) {
      for (const [from, to] of [[p.a, p.b], [p.b, p.a]]) {
        if (Math.hypot(b.x - from[0], b.y - from[1]) < PORTAL_R * 0.6) {
          this.emit('portal', from[0], from[1], 0, to);
          b.x = to[0];
          b.y = to[1];
          this.portalLock = { x: to[0], y: to[1] };
          return;
        }
      }
    }
  }

  checkHole() {
    const b = this.ball, h = this.hole;
    const dx = h.x - b.x, dy = h.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d >= HOLE_R) {
      this.overHole = false;
      return false;
    }
    const sp = Math.hypot(b.vx, b.vy);
    if ((d < HOLE_R * 0.8 && sp < SINK_SPEED) || sp < 150) {
      this.sunk = true;
      this.moving = false;
      this.sinkFrom = { x: b.x, y: b.y };
      b.vx = b.vy = 0;
      this.emit('sink', h.x, h.y, sp);
      return true;
    }
    if (!this.overHole) this.emit('lip', b.x, b.y, sp);
    this.overHole = true;
    if (d > 0.01) {
      b.vx += (dx / d) * HOLE_PULL * STEP;
      b.vy += (dy / d) * HOLE_PULL * STEP;
    }
    return false;
  }

  checkHazards() {
    const b = this.ball;
    for (const w of this.water) {
      if (pointInPoly(b.x, b.y, w)) {
        this.emit('water', b.x, b.y);
        this.resetBall();
        return true;
      }
    }
    let out = !pointInPoly(b.x, b.y, this.level.course);
    if (!out) out = this.walls.some((w) => pointInPoly(b.x, b.y, w));
    if (!out) out = this.movers.some((m) => pointInPoly(b.x, b.y, this.moverPoly(m)));
    if (out) {
      this.emit('oob', b.x, b.y);
      this.resetBall();
      return true;
    }
    return false;
  }

  resetBall() {
    const b = this.ball;
    b.x = this.lastShot.x;
    b.y = this.lastShot.y;
    b.vx = b.vy = 0;
    this.moving = false;
    this.inSand = false;
    this.portalLock = null;
    this.slowT = 0;
  }

  checkRest(sloped) {
    const b = this.ball;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp < 1 && !sloped) return this.stop();
    if (sp < 10) {
      this.slowT += STEP;
      if (this.slowT > 0.4) return this.stop();
    } else {
      this.slowT = 0;
    }
    if (this.shotT > 30) this.stop();
  }

  stop() {
    const b = this.ball;
    b.vx = b.vy = 0;
    this.moving = false;
    this.inSand = false;
    this.emit('rest', b.x, b.y);
  }

  // Preview of the shot line: follows the ball's path through one wall bounce.
  aimPath(angle, length) {
    const b = this.ball;
    let x = b.x, y = b.y;
    let dx = Math.cos(angle), dy = Math.sin(angle);
    const pts = [[x, y]];
    let left = length;
    let bounces = 0;
    const step = 3;
    while (left > 0) {
      const nx = x + dx * step, ny = y + dy * step;
      if (Math.hypot(nx - this.hole.x, ny - this.hole.y) < HOLE_R * 0.6) {
        pts.push([nx, ny]);
        return pts;
      }
      const n = this.probe(nx, ny);
      if (n && dx * n[0] + dy * n[1] < 0) {
        pts.push([x, y]);
        if (bounces++ >= 1) return pts;
        const dot = dx * n[0] + dy * n[1];
        dx -= 2 * dot * n[0];
        dy -= 2 * dot * n[1];
        left -= step;
        continue;
      }
      x = nx;
      y = ny;
      left -= step;
    }
    pts.push([x, y]);
    return pts;
  }

  probe(x, y) {
    for (const s of this.segs) {
      const [qx, qy] = closestPoint(x, y, s.ax, s.ay, s.bx, s.by);
      const d = Math.hypot(x - qx, y - qy);
      if (d < BALL_R) return d > 1e-6 ? [(x - qx) / d, (y - qy) / d] : [0, 0];
    }
    for (const bp of this.bumpers) {
      const d = Math.hypot(x - bp.x, y - bp.y);
      if (d < BALL_R + bp.r) return [(x - bp.x) / d, (y - bp.y) / d];
    }
    return null;
  }
}
