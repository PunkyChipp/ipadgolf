// Drawing. The course is painted once per hole into offscreen canvases (one
// for the whole hole, one sharper one around the green); each frame draws
// those through a rotating, zooming camera and adds balls, flag and effects.
import { T, inEllipse, rng, hashSeed } from './course.js';
import { CUP_R } from './sim.js';

const PX = 3; // pixels per yard for the whole-hole layer
const PXG = 16; // pixels per yard for the green layer
const TAU = Math.PI * 2;
const FRINGE_W = 2.6;

const C = {
  ob: '#2c5427',
  deep: '#3d7534',
  rough: '#4f913f',
  fairway: '#69b24f',
  fairwayStripe: 'rgba(255,255,255,0.075)',
  fringe: '#74bf57',
  green: '#82d064',
  sand: '#e9d7a2',
  sandDark: '#c9b27a',
  water: '#2f84c4',
  waterDeep: '#1d5f99',
  tee: '#86cc68',
};

function ellipsePath(ctx, e, grow = 0) {
  ctx.beginPath();
  ctx.ellipse(e.x, e.y, e.rx + grow, e.ry + grow, e.rot || 0, 0, TAU);
}

function linePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

function noiseTile() {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const x = c.getContext('2d');
  const r = rng(11);
  for (let i = 0; i < 1400; i++) {
    x.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    x.fillRect(Math.floor(r() * 96), Math.floor(r() * 96), 1 + Math.floor(r() * 2), 1);
  }
  return c;
}

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.noise = noiseTile();
  }

  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
  }

  setHole(hole) {
    this.hole = hole;
    const pad = hole.bounds + 45;
    const xs = hole.path.map((p) => p.x), ys = hole.path.map((p) => p.y);
    const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad };
    box.w = Math.max(...xs) + pad - box.x;
    box.h = Math.max(...ys) + pad - box.y;
    this.box = box;
    this.base = this.paint(box, PX);
    const g = hole.green;
    const gr = Math.max(g.rx, g.ry) + 14;
    this.gbox = { x: g.x - gr, y: g.y - gr, w: gr * 2, h: gr * 2 };
    this.gLayer = this.paint(this.gbox, PXG);
    // Sample the green's slope for the putting overlay.
    this.slopePts = [];
    for (let y = g.y - gr; y < g.y + gr; y += 1.7) {
      for (let x = g.x - gr; x < g.x + gr; x += 1.7) {
        if (!inEllipse(x, y, g, FRINGE_W)) continue;
        const [sx, sy] = hole.slopeAt(x, y);
        const m = Math.hypot(sx, sy);
        if (m > 0.002) this.slopePts.push({ x, y, dx: -sx / m, dy: -sy / m, m, ph: (x * 0.37 + y * 0.71) % 1 });
      }
    }
  }

  // Paint the course into a canvas covering `box` (world yards) at `px` px/yd.
  paint(box, px) {
    const hole = this.hole;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(box.w * px);
    cv.height = Math.ceil(box.h * px);
    const c = cv.getContext('2d');
    c.setTransform(px, 0, 0, px, -box.x * px, -box.y * px);
    const r = rng(hashSeed(hole.index, 'paint'));
    const P = hole.path;

    c.fillStyle = C.ob;
    c.fillRect(box.x, box.y, box.w, box.h);
    // In-bounds area is everything within `bounds` of the centre line.
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = C.deep;
    c.lineWidth = hole.bounds * 2;
    linePath(c, P.map((p) => [p.x, p.y]));
    c.stroke();

    // First cut of rough, then fairway, as unions of discs along the path.
    const discs = (from, to, extra) => {
      c.beginPath();
      for (const p of P) {
        if (p.s < from || p.s > to) continue;
        const rr = hole.halfWidth(p.s) + extra;
        c.moveTo(p.x + rr, p.y);
        c.arc(p.x, p.y, rr, 0, TAU);
      }
    };
    discs(0, Infinity, hole.roughW);
    c.fillStyle = C.rough;
    c.fill('nonzero');
    if (hole.fwFrom < hole.fwTo) {
      discs(hole.fwFrom, hole.fwTo, 0);
      c.fillStyle = C.fairway;
      c.fill('nonzero');
      c.save();
      discs(hole.fwFrom, hole.fwTo, 0);
      c.clip('nonzero');
      // Mowing stripes across the fairway.
      const stripe = 9;
      let on = false;
      for (let s = hole.fwFrom - 30; s < hole.fwTo + 30; s += stripe) {
        on = !on;
        if (!on) continue;
        const a = pointAt(P, s), b = pointAt(P, s + stripe);
        const w = hole.halfWidth(s) + 6;
        c.beginPath();
        c.moveTo(a.x + a.nx * w, a.y + a.ny * w);
        c.lineTo(b.x + b.nx * w, b.y + b.ny * w);
        c.lineTo(b.x - b.nx * w, b.y - b.ny * w);
        c.lineTo(a.x - a.nx * w, a.y - a.ny * w);
        c.closePath();
        c.fillStyle = C.fairwayStripe;
        c.fill();
      }
      c.restore();
    }

    // Tee box.
    const t = hole.tee;
    c.save();
    c.translate(t.x, t.y);
    c.rotate(t.rot);
    c.fillStyle = C.tee;
    roundRect(c, -t.rx, -t.ry, t.rx * 2, t.ry * 2, 1.5);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = -t.ry; i < t.ry; i += 2.4) c.fillRect(-t.rx, i, t.rx * 2, 1.2);
    c.restore();
    for (const k of [-1, 1]) {
      const mx = t.x + Math.cos(t.ang + Math.PI / 2) * 3 * k, my = t.y + Math.sin(t.ang + Math.PI / 2) * 3 * k;
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.beginPath();
      c.arc(mx + 0.15, my + 0.2, 0.45, 0, TAU);
      c.fill();
      c.fillStyle = '#f4f1e6';
      c.beginPath();
      c.arc(mx, my, 0.45, 0, TAU);
      c.fill();
    }

    // Fringe and green with checkerboard mowing.
    const g = hole.green;
    ellipsePath(c, g, FRINGE_W);
    c.fillStyle = C.fringe;
    c.fill();
    ellipsePath(c, g);
    c.fillStyle = C.green;
    c.fill();
    c.save();
    ellipsePath(c, g);
    c.clip();
    c.translate(g.x, g.y);
    c.rotate((g.rot || 0) + 0.5);
    c.fillStyle = 'rgba(255,255,255,0.06)';
    const R = Math.max(g.rx, g.ry) + 2;
    for (let y = -R; y < R; y += 3) for (let x = -R; x < R; x += 3) if (((x + y) / 3) & 1) c.fillRect(x, y, 3, 3);
    c.restore();
    ellipsePath(c, g);
    c.strokeStyle = 'rgba(40,90,30,0.25)';
    c.lineWidth = 0.25;
    c.stroke();

    // Water: ellipses and creeks.
    for (const w of hole.water) {
      const shape = () => {
        if (w.line) {
          linePath(c, w.line);
        } else ellipsePath(c, w);
      };
      c.save();
      if (w.line) {
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.strokeStyle = 'rgba(30,60,20,0.45)';
        c.lineWidth = w.w + 2.2;
        shape();
        c.stroke();
        c.strokeStyle = C.water;
        c.lineWidth = w.w;
        shape();
        c.stroke();
        c.strokeStyle = 'rgba(200,235,255,0.35)';
        c.lineWidth = w.w * 0.25;
        c.setLineDash([3, 5]);
        shape();
        c.stroke();
      } else {
        ellipsePath(c, w, 1.2);
        c.fillStyle = 'rgba(30,60,20,0.45)';
        c.fill();
        shape();
        const gr = c.createRadialGradient(w.x, w.y, 0, w.x, w.y, Math.max(w.rx, w.ry));
        gr.addColorStop(0, C.waterDeep);
        gr.addColorStop(1, C.water);
        c.fillStyle = gr;
        c.fill();
        c.clip();
        c.strokeStyle = 'rgba(190,230,255,0.45)';
        c.lineWidth = 1.6;
        shape();
        c.stroke();
        c.strokeStyle = 'rgba(255,255,255,0.14)';
        c.lineWidth = 0.35;
        for (let i = 0; i < 18; i++) {
          const ax = w.x + (r() - 0.5) * w.rx * 1.6, ay = w.y + (r() - 0.5) * w.ry * 1.6;
          c.beginPath();
          c.moveTo(ax, ay);
          c.quadraticCurveTo(ax + 2, ay - 0.6, ax + 4, ay);
          c.stroke();
        }
      }
      c.restore();
    }

    // Bunkers: sand with a shaded lip.
    for (const b of hole.bunkers) {
      ellipsePath(c, b, 0.6);
      c.fillStyle = 'rgba(60,90,40,0.5)';
      c.fill();
      ellipsePath(c, b);
      c.fillStyle = C.sand;
      c.fill();
      c.save();
      ellipsePath(c, b);
      c.clip();
      c.strokeStyle = C.sandDark;
      c.lineWidth = 1.4;
      c.beginPath();
      c.ellipse(b.x - 0.5, b.y - 0.6, b.rx, b.ry, b.rot || 0, 0, TAU);
      c.stroke();
      for (let i = 0; i < b.rx * b.ry * 3; i++) {
        c.fillStyle = r() < 0.5 ? 'rgba(255,250,230,0.55)' : 'rgba(150,120,60,0.25)';
        c.fillRect(b.x + (r() - 0.5) * b.rx * 2, b.y + (r() - 0.5) * b.ry * 2, 0.25, 0.25);
      }
      c.restore();
    }

    // Grain texture over the grass.
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = c.createPattern(this.noise, 'repeat');
    c.fillRect(0, 0, cv.width, cv.height);
    c.restore();

    // Out-of-bounds stakes along the boundary.
    c.fillStyle = '#f7f7f2';
    for (let s = 0; s < hole.length; s += 16) {
      const p = pointAt(P, s);
      for (const k of [-1, 1]) {
        const x = p.x + p.nx * hole.bounds * k, y = p.y + p.ny * hole.bounds * k;
        c.fillStyle = 'rgba(0,0,0,0.3)';
        c.fillRect(x + 0.1, y + 0.1, 0.5, 0.5);
        c.fillStyle = '#f7f7f2';
        c.fillRect(x - 0.25, y - 0.25, 0.5, 0.5);
      }
    }

    // Trees: shadows first, then canopies.
    const trees = hole.trees.filter((tr) => tr.x + tr.r > box.x && tr.x - tr.r < box.x + box.w && tr.y + tr.r > box.y && tr.y - tr.r < box.y + box.h);
    c.fillStyle = 'rgba(0,0,0,0.28)';
    for (const tr of trees) {
      c.beginPath();
      c.ellipse(tr.x + tr.h * 0.18, tr.y + tr.h * 0.24, tr.r * 1.05, tr.r * 0.95, 0.6, 0, TAU);
      c.fill();
    }
    trees.sort((a, b) => a.y - b.y);
    for (const tr of trees) drawTree(c, tr);
    return cv;
  }

  // Camera: screen = centre + rot(scale * (world - view.c))
  matrix(view) {
    return new DOMMatrix()
      .translate(view.sx, view.sy)
      .rotate((view.rot * 180) / Math.PI)
      .scale(view.scale)
      .translate(-view.x, -view.y);
  }

  draw(scene) {
    const { ctx, dpr } = this;
    const hole = this.hole;
    const m = this.matrix(scene.view);
    this.m = m;
    this.inv = m.inverse();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.ob;
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    const wm = new DOMMatrix().scale(dpr).multiply(m);
    ctx.setTransform(wm.a, wm.b, wm.c, wm.d, wm.e, wm.f);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, this.box.x, this.box.y, this.box.w, this.box.h);
    if (scene.view.scale > PX * 1.3) ctx.drawImage(this.gLayer, this.gbox.x, this.gbox.y, this.gbox.w, this.gbox.h);

    if (scene.showSlope) this.drawSlope(scene.time, scene.view.scale);
    if (scene.aim) this.drawAim(scene.aim, scene.view.scale);

    // Cup.
    const cr = Math.max(CUP_R, 2.2 / scene.view.scale);
    ctx.fillStyle = '#0d150d';
    ctx.beginPath();
    ctx.arc(hole.pin.x, hole.pin.y, cr, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = Math.max(0.01, 0.8 / scene.view.scale);
    ctx.stroke();

    this.drawParticles(scene.dt, scene.view.scale);

    // Screen-space layer.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawFlag(scene);
    for (const t of scene.trails || []) this.drawTrail(t, scene.view.scale);
    for (const b of scene.balls) this.drawBall(b, scene.view.scale);
  }

  toScreen(x, y, z = 0, scale = 1) {
    const p = this.m.transformPoint(new DOMPoint(x, y));
    return [p.x, p.y - z * Math.min(scale, 4) * 0.9];
  }

  toWorld(sx, sy) {
    const p = this.inv.transformPoint(new DOMPoint(sx, sy));
    return [p.x, p.y];
  }

  drawAim(aim, scale) {
    const ctx = this.ctx;
    const { x, y, dir, len, ticks, ring, color } = aim;
    const dx = Math.cos(dir), dy = Math.sin(dir);
    const px = 1 / scale;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 4 * px;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx * len, y + dy * len);
    ctx.stroke();
    ctx.setLineDash([8 * px, 7 * px]);
    ctx.strokeStyle = color || 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx * len, y + dy * len);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const t of ticks || []) {
      const tx = x + dx * len * t, ty = y + dy * len * t;
      ctx.beginPath();
      ctx.moveTo(tx - dy * 6 * px, ty + dx * 6 * px);
      ctx.lineTo(tx + dy * 6 * px, ty - dx * 6 * px);
      ctx.stroke();
    }
    if (ring) {
      const ex = x + dx * len, ey = y + dy * len;
      const rr = Math.max(ring, 9 * px);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.arc(ex, ey, rr, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex, ey, 2.5 * px, 0, TAU);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
    ctx.restore();
  }

  drawSlope(time, scale) {
    const ctx = this.ctx;
    const px = 1 / scale;
    ctx.save();
    ctx.lineCap = 'round';
    for (const p of this.slopePts) {
      const strength = Math.min(1, p.m / 0.03);
      const len = 0.35 + strength * 0.7;
      const ph = (time * (0.3 + strength * 0.9) + p.ph) % 1;
      const ox = p.x + p.dx * len * (ph - 0.5), oy = p.y + p.dy * len * (ph - 0.5);
      ctx.globalAlpha = Math.sin(ph * Math.PI) * (0.25 + strength * 0.5);
      ctx.strokeStyle = strength > 0.6 ? '#fff2a8' : '#ffffff';
      ctx.lineWidth = Math.max(1.4 * px, 0.07);
      ctx.beginPath();
      ctx.moveTo(ox - p.dx * 0.18, oy - p.dy * 0.18);
      ctx.lineTo(ox + p.dx * 0.18, oy + p.dy * 0.18);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFlag(scene) {
    const ctx = this.ctx;
    const hole = this.hole;
    const [x, y] = this.toScreen(hole.pin.x, hole.pin.y);
    const s = scene.view.scale;
    const H = Math.min(90, Math.max(34, s * 2.6));
    const wind = scene.wind;
    const wa = wind.dir + scene.view.rot;
    const wl = Math.min(1, 0.35 + wind.speed / 16);
    const fx = Math.cos(wa), fy = Math.sin(wa);
    ctx.save();
    ctx.globalAlpha = scene.flagAlpha ?? 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + H * 0.45, y + H * 0.25);
    ctx.stroke();
    ctx.strokeStyle = '#f1efe6';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - H);
    ctx.stroke();
    // Flag streams downwind (screen direction), longer in stronger wind.
    const L = 34 * wl, D = 20;
    const t = scene.time;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      const wave = Math.sin(t * (4 + wind.speed * 0.4) - k * 5) * 3 * k;
      pts.push([x + fx * L * k - fy * wave, y - H + Math.max(-L * 0.6, fy * L * k) * 0.6 + fx * wave * 0.4 + k * 2]);
    }
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(x, y - H);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1] + D * (1 - i / 8) * 0.9 + 1);
    ctx.lineTo(x, y - H + D);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawTrail(trail, scale) {
    const ctx = this.ctx;
    if (trail.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = this.toScreen(trail[i - 1].x, trail[i - 1].y, trail[i - 1].z, scale);
      const b = this.toScreen(trail[i].x, trail[i].y, trail[i].z, scale);
      ctx.strokeStyle = `rgba(255,255,255,${(i / trail.length) * 0.55})`;
      ctx.lineWidth = 1 + (i / trail.length) * 2;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBall(b, scale) {
    const ctx = this.ctx;
    const [gx, gy] = this.toScreen(b.x, b.y);
    const [bx, by] = this.toScreen(b.x, b.y, b.z || 0, scale);
    const r = Math.min(7.5, Math.max(3.4, scale * 0.3)) * (1 + (b.z || 0) / 45);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(gx + 1.2, gy + 1.4, r * 0.95, r * 0.75, 0, 0, TAU);
    ctx.fill();
    if (b.ring) {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(gx, gy, r + 5 + Math.sin(performance.now() / 250) * 1.5, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const g = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.35, r * 0.1, bx, by, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.65, '#eef0ef');
    g.addColorStop(1, '#b9c1c3');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    if (b.label) {
      ctx.font = '700 12px "Nunito", ui-rounded, system-ui, sans-serif';
      const w = ctx.measureText(b.label).width + 12;
      const ly = by - r - 16;
      ctx.fillStyle = b.color;
      roundRect(ctx, bx - w / 2, ly - 9, w, 18, 9);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, bx, ly + 0.5);
    }
  }

  burst(x, y, n, o) {
    const r = Math.random;
    for (let i = 0; i < n; i++) {
      const a = (o.angle ?? r() * TAU) + (o.angle != null ? (r() - 0.5) * (o.spread ?? 1) : 0);
      const sp = (o.speed ?? 3) * (0.4 + r() * 0.8);
      const life = (o.life ?? 0.8) * (0.6 + r() * 0.6);
      this.particles.push({ x, y, z: o.z ?? 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (o.up ?? 4) * (0.5 + r()), life, max: life, size: (o.size ?? 0.25) * (0.6 + r() * 0.8), color: o.colors[i % o.colors.length], ring: false });
    }
  }

  ring(x, y, r0, r1, color, life = 0.6) {
    this.particles.push({ x, y, r0, r1, color, life, max: life, ring: true });
  }

  drawParticles(dt, scale) {
    const ctx = this.ctx;
    const px = 1 / scale;
    for (const p of this.particles) {
      p.life -= dt;
      const f = Math.max(0, p.life / p.max);
      ctx.globalAlpha = f;
      if (p.ring) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1.5 * px, 0.08);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r1 + (p.r0 - p.r1) * f, 0, TAU);
        ctx.stroke();
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vz -= 12 * dt;
        p.z = Math.max(0, p.z + p.vz * dt);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y - p.z * 0.3, Math.max(p.size, 1.2 * px), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);
  }
}

function pointAt(P, s) {
  let i = 1;
  while (i < P.length - 1 && P[i].s < s) i++;
  const a = P[i - 1], b = P[i];
  const t = Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s || 1)));
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  return { x: a.x + dx * t, y: a.y + dy * t, nx: -dy / l, ny: dx / l };
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawTree(c, t) {
  const pal = t.shade < 0.33 ? ['#1d4a22', '#2b6a2f', '#3f8a3c'] : t.shade < 0.66 ? ['#224f1f', '#32712c', '#4b923a'] : ['#1a4630', '#27664a', '#3a8660'];
  const r = t.r;
  c.fillStyle = pal[0];
  for (let k = 0; k < 6; k++) {
    const a = t.shade * 9 + (k * TAU) / 6;
    c.beginPath();
    c.arc(t.x + Math.cos(a) * r * 0.42, t.y + Math.sin(a) * r * 0.42, r * 0.6, 0, TAU);
    c.fill();
  }
  c.fillStyle = pal[1];
  for (let k = 0; k < 4; k++) {
    const a = t.shade * 5 + (k * TAU) / 4;
    c.beginPath();
    c.arc(t.x - r * 0.12 + Math.cos(a) * r * 0.28, t.y - r * 0.15 + Math.sin(a) * r * 0.28, r * 0.46, 0, TAU);
    c.fill();
  }
  c.fillStyle = pal[2];
  c.beginPath();
  c.arc(t.x - r * 0.3, t.y - r * 0.32, r * 0.3, 0, TAU);
  c.fill();
}
