import { World, BALL_R, HOLE_R, PORTAL_R, pointInPoly, distToPoly } from './physics.js';
import { LEVELS, THEMES } from './levels.js';
import { Sound } from './audio.js';

const $ = (s) => document.querySelector(s);
const TAU = Math.PI * 2;
const MAX_STROKES = 10;
const FONT = '"Lilita One", ui-rounded, "SF Pro Rounded", system-ui, sans-serif';

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('pocketputt.' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      if (v == null) localStorage.removeItem('pocketputt.' + k);
      else localStorage.setItem('pocketputt.' + k, JSON.stringify(v));
    } catch {}
  },
};

const canvas = $('#game');
const ctx = canvas.getContext('2d');
const sound = new Sound(store.get('muted', false));

const S = {
  mode: 'title', // title | play | card | paused | final | practice
  practice: false,
  hole: 0,
  strokes: 0,
  scores: [],
  world: null,
  view: null,
  layer: null,
  aim: null,
  trail: [],
  particles: [],
  confetti: [],
  popups: [],
  fireflies: [],
  hidden: 0,
  sinkT: 0,
  finishing: false,
  token: 0, // bumps whenever a hole (re)loads so stale timers are ignored
  demoT: 0,
  demoShots: 0,
  time: 0,
};

/* ---------- helpers ---------- */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pathPoly(c, poly) {
  c.beginPath();
  c.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) c.lineTo(poly[i][0], poly[i][1]);
  c.closePath();
}

function circle(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
}

function bounds(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function setM(c, m) {
  c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const par = (i) => LEVELS[i].par;

function relScore(n) {
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `−${-n}`;
}

function scoreTerm(strokes, p) {
  if (strokes === 1) return 'Hole in One!';
  const d = strokes - p;
  const names = { '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double Bogey', 3: 'Triple Bogey' };
  return names[d] ?? (d < 0 ? 'Condor!' : `${d} Over`);
}

/* ---------- view / layout ---------- */

function hudBottom() {
  const hud = $('#hud');
  if (hud.hidden) return 12;
  return hud.getBoundingClientRect().bottom + 6;
}

function buildView() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  const L = S.world.level;
  const b = bounds(L.course);
  const pad = 30;
  const top = S.mode === 'title' ? 12 : hudBottom();
  const availW = w - 24, availH = h - top - 16;
  const bw = b.w + pad * 2, bh = b.h + pad * 2;
  const s0 = Math.min(availW / bw, availH / bh);
  const s90 = Math.min(availW / bh, availH / bw);
  const rot = s90 > s0 * 1.08 ? 90 : 0;
  const scale = rot ? s90 : s0;
  const m = new DOMMatrix()
    .translate(w / 2, top + availH / 2)
    .rotate(rot)
    .scale(scale)
    .translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
  const inv = m.inverse();
  // A screen-space "down-right" direction expressed in world units, for shadows.
  const shx = inv.a * 0.6 + inv.c * 0.8, shy = inv.b * 0.6 + inv.d * 0.8;
  const shl = Math.hypot(shx, shy) || 1;
  S.view = { w, h, dpr, m, inv, scale, rot, wm: new DOMMatrix().scale(dpr).multiply(m), sh: { x: shx / shl, y: shy / shl } };
  buildLayer();
  initFireflies();
}

function toScreen(x, y) {
  const p = S.view.m.transformPoint(new DOMPoint(x, y));
  return [p.x, p.y];
}

function visibleWorld(margin) {
  const { inv, w, h } = S.view;
  const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => inv.transformPoint(new DOMPoint(x, y)));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs) - margin, y0 = Math.min(...ys) - margin;
  return { x: x0, y: y0, w: Math.max(...xs) + margin - x0, h: Math.max(...ys) + margin - y0 };
}

/* ---------- static layer (drawn once per hole / resize) ---------- */

function buildLayer() {
  const { w, h, dpr, wm } = S.view;
  const cv = S.layer || document.createElement('canvas');
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const c = cv.getContext('2d');
  setM(c, wm);
  const L = S.world.level;
  const T = THEMES[L.theme] || THEMES.meadow;
  drawRough(c, L, T);
  drawCourse(c, L, T);
  S.layer = cv;
}

function drawRough(c, L, T) {
  const vis = visibleWorld(80);
  const sh = S.view.sh;
  c.fillStyle = T.rough;
  c.fillRect(vis.x, vis.y, vis.w, vis.h);
  const r = rng(hash(L.name));
  const R = { x: -1200, y: -1000, w: 3400, h: 2700 }; // fixed area keeps the scenery identical across resizes
  for (let i = 0; i < 260; i++) {
    const x = R.x + r() * R.w, y = R.y + r() * R.h, rad = 30 + r() * 110;
    c.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
    circle(c, x, y, rad);
    c.fill();
  }
  c.lineCap = 'round';
  c.lineWidth = 1.6;
  for (let i = 0; i < 4200; i++) {
    const x = R.x + r() * R.w, y = R.y + r() * R.h;
    const light = r() < 0.5;
    if (x < vis.x || y < vis.y || x > vis.x + vis.w || y > vis.y + vis.h) continue;
    c.strokeStyle = light ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)';
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + 2, y - 5);
    c.stroke();
  }

  const trees = [];
  const step = 64;
  for (let gx = R.x; gx < R.x + R.w; gx += step) {
    for (let gy = R.y; gy < R.y + R.h; gy += step) {
      const x = gx + r() * step, y = gy + r() * step, rad = 20 + r() * 20;
      const pal = T.trees[Math.floor(r() * T.trees.length)];
      const skip = r() < 0.3;
      const flowers = r() < 0.15;
      const seed = r() * TAU;
      if (skip) continue;
      if (x < vis.x - 60 || y < vis.y - 60 || x > vis.x + vis.w + 60 || y > vis.y + vis.h + 60) continue;
      if (pointInPoly(x, y, L.course) || distToPoly(x, y, L.course) < rad + 20) continue;
      trees.push({ x, y, rad, pal, flowers, seed });
    }
  }
  c.fillStyle = 'rgba(0,0,0,0.25)';
  for (const t of trees) {
    circle(c, t.x + sh.x * t.rad * 0.45, t.y + sh.y * t.rad * 0.45, t.rad * 1.02);
    c.fill();
  }
  trees.sort((a, b) => a.y - b.y);
  for (const t of trees) drawTree(c, t, sh);
}

function drawTree(c, t, sh) {
  const [dark, mid, light] = t.pal;
  c.fillStyle = dark;
  for (let k = 0; k < 6; k++) {
    const a = t.seed + (k * TAU) / 6;
    circle(c, t.x + Math.cos(a) * t.rad * 0.42, t.y + Math.sin(a) * t.rad * 0.42, t.rad * 0.6);
    c.fill();
  }
  c.fillStyle = mid;
  for (let k = 0; k < 4; k++) {
    const a = t.seed + (k * TAU) / 4;
    circle(c, t.x - sh.x * t.rad * 0.15 + Math.cos(a) * t.rad * 0.3, t.y - sh.y * t.rad * 0.15 + Math.sin(a) * t.rad * 0.3, t.rad * 0.45);
    c.fill();
  }
  c.fillStyle = light;
  circle(c, t.x - sh.x * t.rad * 0.35, t.y - sh.y * t.rad * 0.35, t.rad * 0.3);
  c.fill();
  if (t.flowers) {
    const r = rng(Math.floor(t.seed * 1e6));
    for (let k = 0; k < 7; k++) {
      c.fillStyle = r() < 0.5 ? '#ffd6e6' : '#fff4c2';
      circle(c, t.x + (r() - 0.5) * t.rad * 1.3, t.y + (r() - 0.5) * t.rad * 1.3, 2.2);
      c.fill();
    }
  }
}

function drawCourse(c, L, T) {
  const sh = S.view.sh;
  const b = bounds(L.course);
  c.lineJoin = 'round';

  // Rail: stroked on the boundary; the grass later covers its inner half.
  c.save();
  c.translate(sh.x * 7, sh.y * 7);
  pathPoly(c, L.course);
  c.lineWidth = 30;
  c.strokeStyle = 'rgba(0,0,0,0.3)';
  c.stroke();
  c.restore();
  pathPoly(c, L.course);
  c.lineWidth = 28;
  c.strokeStyle = T.rail[0];
  c.stroke();
  c.lineWidth = 22;
  c.strokeStyle = T.rail[1];
  c.stroke();
  c.lineWidth = 11;
  c.strokeStyle = T.rail[2];
  c.stroke();

  c.save();
  pathPoly(c, L.course);
  c.clip();
  c.fillStyle = T.grass[0];
  c.fillRect(b.x - 10, b.y - 10, b.w + 20, b.h + 20);
  // Mowing stripes
  c.save();
  c.translate(b.x + b.w / 2, b.y + b.h / 2);
  c.rotate(-0.45);
  c.fillStyle = T.grass[1];
  const ext = Math.hypot(b.w, b.h);
  for (let x = -ext; x < ext; x += 92) c.fillRect(x, -ext, 46, ext * 2);
  c.restore();
  const r = rng(hash(L.name) ^ 0x9e37);
  for (let i = 0; i < (b.w * b.h) / 260; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    c.fillRect(b.x + r() * b.w, b.y + r() * b.h, 1.6, 1.6);
  }

  for (const s of L.slopes || []) drawSlopeBase(c, s);
  for (const s of L.sand || []) drawSand(c, s, r);
  for (const w of L.water || []) drawWater(c, w);
  drawTee(c, L);
  drawCup(c, L);

  // Soft inner shadow along the rails gives the course some depth.
  pathPoly(c, L.course);
  c.lineWidth = 22;
  c.strokeStyle = 'rgba(0,0,0,0.07)';
  c.stroke();
  c.lineWidth = 10;
  c.strokeStyle = 'rgba(0,0,0,0.12)';
  c.stroke();
  c.restore();

  for (const w of L.walls || []) drawBlock(c, w, T, sh);
}

function drawSlopeBase(c, s) {
  c.save();
  if (s.poly) {
    pathPoly(c, s.poly);
    c.clip();
    const b = bounds(s.poly);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const f = Math.hypot(...s.force), dx = s.force[0] / f, dy = s.force[1] / f;
    const ext = Math.abs(dx) * b.w / 2 + Math.abs(dy) * b.h / 2;
    const g = c.createLinearGradient(cx - dx * ext, cy - dy * ext, cx + dx * ext, cy + dy * ext);
    g.addColorStop(0, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0.16)');
    c.fillStyle = g;
    c.fillRect(b.x, b.y, b.w, b.h);
  } else {
    const hill = s.strength > 0;
    const g = c.createRadialGradient(s.x, s.y, s.r0, s.x, s.y, s.r1);
    g.addColorStop(0, hill ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)');
    g.addColorStop(0.7, hill ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    circle(c, s.x, s.y, s.r1);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 2;
    circle(c, s.x, s.y, s.r0 + 4);
    c.stroke();
  }
  c.restore();
}

function drawSand(c, poly, r) {
  c.save();
  pathPoly(c, poly);
  c.lineWidth = 7;
  c.strokeStyle = 'rgba(255,255,255,0.18)';
  c.stroke();
  c.fillStyle = '#e8d196';
  c.fill();
  c.clip();
  const b = bounds(poly);
  for (let i = 0; i < (b.w * b.h) / 40; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(160,120,50,0.25)' : 'rgba(255,250,225,0.5)';
    c.fillRect(b.x + r() * b.w, b.y + r() * b.h, 1.8, 1.8);
  }
  // rake lines
  c.strokeStyle = 'rgba(160,120,50,0.18)';
  c.lineWidth = 1.5;
  for (let y = b.y + 6; y < b.y + b.h; y += 9) {
    c.beginPath();
    for (let x = b.x; x <= b.x + b.w; x += 8) c.lineTo(x, y + Math.sin(x * 0.05 + y) * 2.5);
    c.stroke();
  }
  pathPoly(c, poly);
  c.lineWidth = 9;
  c.strokeStyle = 'rgba(120,85,30,0.35)';
  c.stroke();
  c.restore();
}

function drawWater(c, poly) {
  const b = bounds(poly);
  pathPoly(c, poly);
  c.lineWidth = 12;
  c.strokeStyle = 'rgba(25,60,20,0.45)';
  c.stroke();
  c.save();
  pathPoly(c, poly);
  c.clip();
  const g = c.createLinearGradient(b.x, b.y, b.x + b.w * 0.4, b.y + b.h);
  g.addColorStop(0, '#48b3ef');
  g.addColorStop(1, '#1b65b0');
  c.fillStyle = g;
  c.fillRect(b.x, b.y, b.w, b.h);
  pathPoly(c, poly);
  c.lineWidth = 16;
  c.strokeStyle = 'rgba(170,230,255,0.35)';
  c.stroke();
  c.restore();
  pathPoly(c, poly);
  c.lineWidth = 2.5;
  c.strokeStyle = 'rgba(255,255,255,0.75)';
  c.stroke();
}

function drawTee(c, L) {
  const [tx, ty] = L.tee;
  const dx = L.hole[0] - tx, dy = L.hole[1] - ty, d = Math.hypot(dx, dy);
  const px = -dy / d, py = dx / d;
  c.fillStyle = 'rgba(255,255,255,0.1)';
  circle(c, tx, ty, 24);
  c.fill();
  c.setLineDash([4, 5]);
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  c.lineWidth = 1.5;
  circle(c, tx, ty, 24);
  c.stroke();
  c.setLineDash([]);
  for (const k of [-1, 1]) {
    const x = tx + px * 30 * k, y = ty + py * 30 * k;
    c.fillStyle = 'rgba(0,0,0,0.25)';
    circle(c, x + 1.5, y + 2, 5);
    c.fill();
    c.fillStyle = '#f2f0ea';
    circle(c, x, y, 5);
    c.fill();
    c.fillStyle = '#e8433a';
    circle(c, x, y, 2.4);
    c.fill();
  }
}

function drawCup(c, L) {
  const [x, y] = L.hole;
  const g = c.createRadialGradient(x, y, HOLE_R, x, y, 60);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  circle(c, x, y, 60);
  c.fill();
  c.fillStyle = '#0c140c';
  circle(c, x, y, HOLE_R);
  c.fill();
  const ig = c.createRadialGradient(x + 3, y + 4, 1, x, y, HOLE_R);
  ig.addColorStop(0, 'rgba(0,0,0,0.6)');
  ig.addColorStop(0.7, 'rgba(40,50,40,0.4)');
  ig.addColorStop(1, 'rgba(90,100,90,0.5)');
  c.fillStyle = ig;
  circle(c, x, y, HOLE_R - 0.5);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.85)';
  c.lineWidth = 1.8;
  circle(c, x, y, HOLE_R);
  c.stroke();
}

function drawBlock(c, poly, T, sh, lift = 1) {
  c.save();
  c.translate(sh.x * 8 * lift, sh.y * 8 * lift);
  pathPoly(c, poly);
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.fill();
  c.restore();
  c.save();
  c.translate(sh.x * 3.5, sh.y * 3.5);
  pathPoly(c, poly);
  c.fillStyle = T.rail[0];
  c.fill();
  c.restore();
  pathPoly(c, poly);
  c.fillStyle = T.rail[1];
  c.fill();
  c.save();
  c.clip();
  c.lineWidth = 6;
  c.strokeStyle = T.rail[2];
  c.globalAlpha = 0.55;
  c.stroke();
  c.restore();
}

/* ---------- per-frame drawing ---------- */

function render() {
  const { dpr, wm } = S.view;
  const W = S.world;
  const L = W.level;
  const T = THEMES[L.theme] || THEMES.meadow;
  const t = S.time;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(S.layer, 0, 0);
  setM(ctx, wm);

  ctx.save();
  pathPoly(ctx, L.course);
  ctx.clip();
  for (const w of L.water || []) drawWaterShimmer(w, t);
  for (const s of L.slopes || []) drawSlopeAnim(s, t);
  ctx.restore();

  for (const p of W.portals) drawPortalPair(p, t);
  for (const bp of W.bumpers) drawBumper(bp);
  for (const m of W.movers) drawBlock(ctx, W.moverPoly(m), { rail: ['#34404c', '#5d6d7c', '#9fb0bf'] }, S.view.sh, 1.2);
  drawTrail();
  drawBall();
  for (const s of W.spinners) drawSpinner(s);
  drawAim();
  drawParticles();
  if (T.fireflies) drawFireflies(t);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawFlag(t);
  drawDragIndicator();
  drawPopups();
  drawConfetti();
}

function drawWaterShimmer(poly, t) {
  const b = bounds(poly);
  ctx.save();
  pathPoly(ctx, poly);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.setLineDash([14, 26]);
  let k = 0;
  for (let y = b.y + 10; y < b.y + b.h; y += 22, k++) {
    ctx.lineDashOffset = -t * 18 - k * 13;
    ctx.beginPath();
    for (let x = b.x - 10; x <= b.x + b.w + 10; x += 10) ctx.lineTo(x, y + Math.sin(x * 0.035 + t * 1.6 + k) * 3.5);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawSlopeAnim(s, t) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.poly) {
    pathPoly(ctx, s.poly);
    ctx.clip();
    const b = bounds(s.poly);
    const f = Math.hypot(...s.force), dx = s.force[0] / f, dy = s.force[1] / f;
    const px = -dy, py = dx;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const ext = Math.hypot(b.w, b.h) / 2 + 40;
    const off = (t * 28) % 48;
    for (let a = -ext; a < ext; a += 48) {
      for (let q = -ext; q < ext; q += 60) {
        const x = cx + dx * (a + off) + px * q, y = cy + dy * (a + off) + py * q;
        ctx.beginPath();
        ctx.moveTo(x - dx * 6 + px * 9, y - dy * 6 + py * 9);
        ctx.lineTo(x + dx * 3, y + dy * 3);
        ctx.lineTo(x - dx * 6 - px * 9, y - dy * 6 - py * 9);
        ctx.stroke();
      }
    }
  } else {
    const span = s.r1 - s.r0;
    for (let k = 0; k < 4; k++) {
      const f = ((t * 0.25 + k / 4) % 1);
      const rr = s.strength > 0 ? s.r0 + f * span : s.r1 - f * span;
      ctx.globalAlpha = Math.sin(f * Math.PI) * 0.8;
      circle(ctx, s.x, s.y, rr);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const PORTAL_HUES = [285, 190, 30];

function drawPortalPair(p, t) {
  const hue = PORTAL_HUES[S.world.portals.indexOf(p) % PORTAL_HUES.length];
  for (const [x, y] of [p.a, p.b]) {
    const g = ctx.createRadialGradient(x, y, 2, x, y, PORTAL_R * 1.9);
    g.addColorStop(0, `hsla(${hue},100%,70%,0.55)`);
    g.addColorStop(1, `hsla(${hue},100%,60%,0)`);
    ctx.fillStyle = g;
    circle(ctx, x, y, PORTAL_R * 1.9);
    ctx.fill();
    const core = ctx.createRadialGradient(x, y, 0, x, y, PORTAL_R);
    core.addColorStop(0, '#05010d');
    core.addColorStop(0.75, `hsl(${hue},70%,18%)`);
    core.addColorStop(1, `hsl(${hue},90%,45%)`);
    ctx.fillStyle = core;
    circle(ctx, x, y, PORTAL_R);
    ctx.fill();
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = t * 2.6 + (i * TAU) / 3;
      ctx.strokeStyle = `hsl(${hue},100%,${72 - i * 6}%)`;
      ctx.lineWidth = 3 - i * 0.5;
      ctx.beginPath();
      ctx.arc(x, y, PORTAL_R * (0.9 - i * 0.22), a, a + 1.6);
      ctx.stroke();
    }
  }
}

function drawBumper(bp) {
  const { sh } = S.view;
  const k = 1 + bp.flash * 0.18;
  const r = bp.r * k;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  circle(ctx, bp.x + sh.x * 6, bp.y + sh.y * 6, bp.r);
  ctx.fill();
  if (bp.flash > 0) {
    ctx.fillStyle = `rgba(255,120,140,${bp.flash * 0.45})`;
    circle(ctx, bp.x, bp.y, r * 1.6);
    ctx.fill();
  }
  ctx.fillStyle = '#b3172d';
  circle(ctx, bp.x, bp.y, r);
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#fff3f0';
  circle(ctx, bp.x, bp.y, r - 4);
  ctx.stroke();
  const g = ctx.createRadialGradient(bp.x - sh.x * r * 0.3, bp.y - sh.y * r * 0.3, 1, bp.x, bp.y, r * 0.55);
  g.addColorStop(0, bp.flash > 0.2 ? '#fff' : '#ff9aa6');
  g.addColorStop(1, '#e8354d');
  ctx.fillStyle = g;
  circle(ctx, bp.x, bp.y, r * 0.55);
  ctx.fill();
}

function drawSpinner(s) {
  const { sh } = S.view;
  const ends = S.world.bladeEnds(s);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = s.w;
  for (const [ex, ey] of ends) {
    ctx.beginPath();
    ctx.moveTo(s.x + sh.x * 12, s.y + sh.y * 12);
    ctx.lineTo(ex + sh.x * 12, ey + sh.y * 12);
    ctx.stroke();
  }
  for (const [ex, ey] of ends) {
    ctx.strokeStyle = '#6b4424';
    ctx.lineWidth = s.w;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // sail: cream panel along the outer two-thirds with lattice
    const dx = (ex - s.x) / s.len, dy = (ey - s.y) / s.len;
    const px = -dy, py = dx;
    const a = s.len * 0.3, bEnd = s.len * 0.96, wdt = s.w * 0.95;
    ctx.fillStyle = '#f3ead2';
    ctx.beginPath();
    ctx.moveTo(s.x + dx * a, s.y + dy * a);
    ctx.lineTo(s.x + dx * bEnd, s.y + dy * bEnd);
    ctx.lineTo(s.x + dx * bEnd + px * wdt, s.y + dy * bEnd + py * wdt);
    ctx.lineTo(s.x + dx * a + px * wdt, s.y + dy * a + py * wdt);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(107,68,36,0.7)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    for (let q = a + 12; q < bEnd; q += 12) {
      ctx.moveTo(s.x + dx * q, s.y + dy * q);
      ctx.lineTo(s.x + dx * q + px * wdt, s.y + dy * q + py * wdt);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#4a2f18';
  circle(ctx, s.x, s.y, s.w * 0.9);
  ctx.fill();
  ctx.fillStyle = '#c99a5b';
  circle(ctx, s.x, s.y, s.w * 0.45);
  ctx.fill();
}

function ballDrawPos() {
  const W = S.world, b = W.ball;
  if (!W.sunk) return { x: b.x, y: b.y, k: 1 };
  const f = clamp(S.sinkT / 0.22, 0, 1);
  return { x: lerp(W.sinkFrom.x, W.hole.x, f), y: lerp(W.sinkFrom.y, W.hole.y, f), k: 1 - 0.45 * f };
}

function drawTrail() {
  const n = S.trail.length;
  if (n < 2) return;
  ctx.lineCap = 'round';
  for (let i = 1; i < n; i++) {
    const a = S.trail[i - 1], b = S.trail[i];
    ctx.strokeStyle = `rgba(255,255,255,${(i / n) * 0.35})`;
    ctx.lineWidth = BALL_R * 1.4 * (i / n);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
}

function drawBall() {
  const W = S.world;
  if (S.hidden > 0) return;
  if (W.sunk && S.sinkT > 0.4) return;
  const { sh } = S.view;
  const { x, y, k } = ballDrawPos();
  const r = BALL_R * k;
  if (!W.sunk) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    circle(ctx, x + sh.x * 3.5, y + sh.y * 3.5, r);
    ctx.fill();
  }
  // "your turn" pulse
  if (S.mode === 'play' && W.canShoot() && !S.aim) {
    const p = (S.time * 1.2) % 1;
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - p)})`;
    ctx.lineWidth = 2;
    circle(ctx, x, y, r + 4 + p * 14);
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(x - sh.x * r * 0.4, y - sh.y * r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, '#eef1f2');
  g.addColorStop(1, '#b7c0c5');
  ctx.fillStyle = g;
  circle(ctx, x, y, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function aimInfo() {
  const a = S.aim;
  if (!a) return null;
  const dx = a.x0 - a.x, dy = a.y0 - a.y;
  const len = Math.hypot(dx, dy);
  const { inv, w, h } = S.view;
  const maxDrag = clamp(Math.min(w, h) * 0.32, 150, 280);
  const power = clamp(len / maxDrag, 0, 1);
  const wx = inv.a * dx + inv.c * dy, wy = inv.b * dx + inv.d * dy;
  return { power, angle: Math.atan2(wy, wx), len };
}

function powerColor(p, a = 1) {
  return `hsla(${130 - p * 125}, 90%, ${58 - p * 6}%, ${a})`;
}

function drawAim() {
  const info = aimInfo();
  if (!info || info.power < 0.03) return;
  const W = S.world, b = W.ball;
  const { power, angle } = info;
  const pts = W.aimPath(angle, 70 + power * 380);

  // dotted guide along the predicted path
  let acc = 0, total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const gap = 15;
  let next = BALL_R + 8;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    while (next <= acc + seg) {
      const f = (next - acc) / seg;
      const k = 1 - next / (total + 1);
      ctx.fillStyle = powerColor(power, 0.25 + k * 0.75);
      circle(ctx, lerp(x0, x1, f), lerp(y0, y1, f), 2 + k * 2.6);
      ctx.fill();
      next += gap;
    }
    acc += seg;
  }
  // power ring
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 5;
  circle(ctx, b.x, b.y, BALL_R + 9);
  ctx.stroke();
  ctx.strokeStyle = powerColor(power);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(b.x, b.y, BALL_R + 9, angle - power * Math.PI, angle + power * Math.PI);
  ctx.stroke();
}

function drawDragIndicator() {
  const a = S.aim;
  const info = aimInfo();
  if (!a || !info) return;
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  circle(ctx, a.x0, a.y0, 22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([3, 6]);
  ctx.beginPath();
  ctx.moveTo(a.x0, a.y0);
  ctx.lineTo(a.x, a.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = powerColor(info.power, 0.9);
  circle(ctx, a.x, a.y, 12);
  ctx.fill();
  const label = info.power < 0.03 ? 'cancel' : `${Math.round(info.power * 100)}%`;
  ctx.font = `20px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.strokeText(label, a.x, a.y - 20);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, a.x, a.y - 20);
}

function drawFlag(t) {
  const W = S.world;
  const [hx, hy] = toScreen(W.hole.x, W.hole.y);
  const s = clamp(S.view.scale, 0.45, 1.3);
  const H = 64 * s, fw = 30 * s, fh = 19 * s;
  const b = ballDrawPos();
  const near = Math.hypot(b.x - W.hole.x, b.y - W.hole.y) < 60 && !W.sunk;
  let lift = 0;
  if (W.sunk) lift = clamp((S.sinkT - 0.2) / 0.3, 0, 1) * Math.abs(Math.sin(S.sinkT * 10)) * 6 * s * clamp(2 - S.sinkT, 0, 1);
  ctx.save();
  ctx.globalAlpha = near ? 0.45 : 1;
  // pole shadow along the ground
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2.5 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + H * 0.55, hy + H * 0.3);
  ctx.stroke();
  const top = hy - H - lift;
  ctx.strokeStyle = '#e9e6dc';
  ctx.lineWidth = 2.6 * s;
  ctx.beginPath();
  ctx.moveTo(hx, hy - lift);
  ctx.lineTo(hx, top);
  ctx.stroke();
  // waving flag
  ctx.fillStyle = '#e8433a';
  ctx.beginPath();
  ctx.moveTo(hx, top);
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    ctx.lineTo(hx + f * fw, top + f * fh * 0.5 + Math.sin(t * 5 - f * 4) * 2.4 * s * f);
  }
  for (let i = n; i >= 0; i--) {
    const f = i / n;
    ctx.lineTo(hx + f * fw, top + fh - f * fh * 0.5 + Math.sin(t * 5 - f * 4) * 2.4 * s * f);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.round(11 * s)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(S.mode === 'title' ? '' : S.hole + 1), hx + fw * 0.38, top + fh * 0.48);
  ctx.fillStyle = '#f5d76e';
  circle(ctx, hx, top, 2.4 * s);
  ctx.fill();
  ctx.restore();
}

/* ---------- particles & popups ---------- */

function burst(x, y, n, o) {
  for (let i = 0; i < n; i++) {
    const a = o.angle != null ? o.angle + (Math.random() - 0.5) * (o.spread ?? TAU) : Math.random() * TAU;
    const sp = (o.speed ?? 120) * (0.4 + Math.random() * 0.8);
    const life = (o.life ?? 0.6) * (0.6 + Math.random() * 0.6);
    const colors = o.colors || [o.color || '#fff'];
    S.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: (o.size ?? 3) * (0.6 + Math.random() * 0.8), color: colors[i % colors.length], drag: o.drag ?? 3 });
  }
}

function ring(x, y, r0, r1, color, life = 0.5, width = 3) {
  S.particles.push({ ring: true, x, y, r0, r1, color, life, max: life, width });
}

function drawParticles() {
  for (const p of S.particles) {
    const f = p.life / p.max;
    ctx.globalAlpha = clamp(f, 0, 1);
    if (p.ring) {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.width * f;
      circle(ctx, p.x, p.y, lerp(p.r1, p.r0, f));
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      circle(ctx, p.x, p.y, p.size * (0.5 + f * 0.5));
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function popup(text, x, y, o = {}) {
  S.popups.push({ text, x, y, t: 0, life: o.life ?? 1.4, size: o.size ?? 26, color: o.color ?? '#fff' });
}

function popupAtWorld(text, wx, wy, o) {
  const [x, y] = toScreen(wx, wy);
  popup(text, x, y - 24, o);
}

function drawPopups() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of S.popups) {
    const f = p.t / p.life;
    const pop = f < 0.12 ? f / 0.12 : 1;
    const size = p.size * (0.6 + 0.4 * pop) * (f < 0.12 ? 1 + (1 - pop) * 0.3 : 1);
    ctx.globalAlpha = f > 0.7 ? (1 - f) / 0.3 : 1;
    ctx.font = `${Math.round(size)}px ${FONT}`;
    const y = p.y - f * 40;
    ctx.lineWidth = size * 0.22;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(10,30,15,0.7)';
    ctx.strokeText(p.text, p.x, y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, y);
  }
  ctx.globalAlpha = 1;
}

const CONFETTI = ['#f5d76e', '#e8433a', '#4fc3f7', '#ffffff', '#8be08b', '#ff9ec7'];

function confettiBurst(n) {
  const { w } = S.view;
  for (let i = 0; i < n; i++) {
    S.confetti.push({
      x: Math.random() * w,
      y: -20 - Math.random() * 200,
      vx: (Math.random() - 0.5) * 120,
      vy: 80 + Math.random() * 160,
      rot: Math.random() * TAU,
      vr: (Math.random() - 0.5) * 10,
      w: 6 + Math.random() * 6,
      h: 10 + Math.random() * 8,
      color: CONFETTI[i % CONFETTI.length],
      life: 4,
    });
  }
}

function drawConfetti() {
  for (const c of S.confetti) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.scale(1, Math.cos(c.rot * 2));
    ctx.fillStyle = c.color;
    ctx.globalAlpha = clamp(c.life, 0, 1);
    ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.restore();
  }
}

function initFireflies() {
  const L = S.world.level;
  S.fireflies = [];
  if (!(THEMES[L.theme] || {}).fireflies) return;
  const vis = visibleWorld(0);
  const r = rng(7);
  for (let i = 0; i < 26; i++) S.fireflies.push({ x: vis.x + r() * vis.w, y: vis.y + r() * vis.h, p: r() * TAU, s: 0.5 + r() });
}

function drawFireflies(t) {
  for (const f of S.fireflies) {
    const x = f.x + Math.sin(t * 0.4 * f.s + f.p) * 30;
    const y = f.y + Math.cos(t * 0.3 * f.s + f.p * 2) * 24;
    const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.5 * f.s + f.p));
    const g = ctx.createRadialGradient(x, y, 0, x, y, 10);
    g.addColorStop(0, `rgba(250,255,170,${a})`);
    g.addColorStop(1, 'rgba(250,255,170,0)');
    ctx.fillStyle = g;
    circle(ctx, x, y, 10);
    ctx.fill();
  }
}

/* ---------- game flow ---------- */

function loadHole(i, mode) {
  S.hole = i;
  S.world = new World(LEVELS[i]);
  S.strokes = 0;
  S.trail = [];
  S.aim = null;
  S.particles = [];
  S.popups = [];
  S.hidden = 0;
  S.sinkT = 0;
  S.finishing = false;
  S.token++;
  S.demoT = 0;
  S.demoShots = 0;
  if (mode) setMode(mode);
  updateHud();
  buildView();
  if (S.mode === 'play') showBanner(i);
}

function setMode(mode) {
  S.mode = mode;
  $('#hud').hidden = !(mode === 'play' || mode === 'card' || mode === 'paused');
  for (const id of ['title', 'practice', 'card', 'pause', 'final']) $('#' + id).hidden = true;
  const screen = { title: 'title', practice: 'practice', card: 'card', paused: 'pause', final: 'final' }[mode];
  if (screen) $('#' + screen).hidden = false;
  if (mode !== 'play') $('#hint').hidden = true;
}

function totalRel() {
  let rel = 0;
  S.scores.forEach((s, i) => { if (s != null) rel += s - par(i); });
  return rel;
}

function updateHud() {
  const L = LEVELS[S.hole];
  $('#hNum').textContent = S.hole + 1;
  $('#hCount').textContent = LEVELS.length;
  $('#hName').textContent = L.name;
  $('#hPar').textContent = L.par;
  $('#hStrokes').textContent = S.strokes;
  const tot = $('#hTotalWrap');
  tot.hidden = S.practice;
  $('#hTotal').textContent = relScore(totalRel());
}

function showBanner(i) {
  const el = $('#banner');
  const L = LEVELS[i];
  el.innerHTML = `<small>Hole ${i + 1}</small><strong></strong><span>Par ${L.par}</span>`;
  el.querySelector('strong').textContent = L.name;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  if (i === 0 && !store.get('tutorialDone', false)) setTimeout(() => { if (S.mode === 'play' && S.strokes === 0) $('#hint').hidden = false; }, 900);
}

function shoot(info) {
  const W = S.world;
  if (!W.shoot(info.angle, info.power)) return;
  S.strokes++;
  sound.putt(info.power);
  const b = W.ball;
  burst(b.x, b.y, 8, { angle: info.angle + Math.PI, spread: 1.4, speed: 60 + info.power * 80, color: 'rgba(210,255,190,0.9)', size: 2, life: 0.4 });
  updateHud();
  if (!$('#hint').hidden) {
    $('#hint').hidden = true;
    store.set('tutorialDone', true);
  }
}

function handleEvents() {
  const W = S.world;
  const audible = S.mode !== 'title';
  for (const e of W.events) {
    switch (e.type) {
      case 'hit':
        if (audible) sound.hit(e.s);
        if (e.s > 250) burst(e.x, e.y, 5, { speed: 70, color: 'rgba(255,255,255,0.8)', size: 1.8, life: 0.3 });
        break;
      case 'bumper':
        if (audible) sound.bumper();
        ring(e.x, e.y, 6, 34, '#ffd0d6', 0.35, 4);
        burst(e.x, e.y, 8, { speed: 160, colors: ['#ff8a9a', '#fff'], size: 2.4, life: 0.35 });
        break;
      case 'sand':
        if (audible) sound.sand();
        burst(e.x, e.y, 16, { speed: 40 + e.s * 0.12, colors: ['#e8d196', '#cfb170', '#fff3cc'], size: 2.4, life: 0.6 });
        break;
      case 'lip':
        if (audible) sound.lip();
        if (S.mode === 'play') popupAtWorld('Lipped out!', e.x, e.y, { size: 22, color: '#ffe9a8' });
        break;
      case 'water':
        if (audible) sound.splash();
        ring(e.x, e.y, 4, 40, 'rgba(255,255,255,0.9)', 0.8, 3);
        ring(e.x, e.y, 2, 24, 'rgba(200,240,255,0.9)', 0.6, 2);
        burst(e.x, e.y, 22, { speed: 140, colors: ['#bfe9ff', '#ffffff', '#6cc6f7'], size: 2.6, life: 0.7 });
        S.hidden = 0.9;
        S.trail = [];
        if (S.mode === 'play') {
          S.strokes++;
          updateHud();
          popupAtWorld('Splash! +1', e.x, e.y, { color: '#a8e4ff' });
        }
        break;
      case 'oob':
        S.hidden = 0.5;
        S.trail = [];
        if (S.mode === 'play') popupAtWorld('Out of bounds', e.x, e.y, { size: 22 });
        break;
      case 'portal': {
        if (audible) sound.portal();
        const [tx, ty] = e.extra;
        ring(e.x, e.y, PORTAL_R, 4, '#e2c6ff', 0.4, 3);
        ring(tx, ty, 4, PORTAL_R * 1.8, '#e2c6ff', 0.5, 3);
        burst(tx, ty, 14, { speed: 150, colors: ['#e2c6ff', '#b388ff', '#fff'], size: 2.2, life: 0.5 });
        S.trail = [];
        break;
      }
      case 'sink':
        S.sinkT = 0;
        onSink();
        break;
      case 'rest':
        if (S.mode === 'play' && S.strokes >= MAX_STROKES && !W.sunk) {
          popupAtWorld('Picked up', W.ball.x, W.ball.y, { size: 24 });
          S.finishing = true;
          const token = S.token;
          setTimeout(() => token === S.token && finishHole(true), 900);
        }
        break;
    }
  }
  W.events.length = 0;
}

function onSink() {
  const W = S.world;
  if (S.mode === 'title') return;
  sound.sink();
  ring(W.hole.x, W.hole.y, HOLE_R, 50, 'rgba(255,255,255,0.9)', 0.6, 4);
  const d = S.strokes - par(S.hole);
  const term = scoreTerm(S.strokes, par(S.hole));
  const good = S.strokes === 1 || d < 0;
  popupAtWorld(term, W.hole.x, W.hole.y, { size: good ? 40 : 30, color: good ? '#ffe27a' : '#ffffff', life: 1.6 });
  if (S.strokes === 1) { sound.fanfare(3); confettiBurst(180); }
  else if (d <= -1) { sound.fanfare(2); confettiBurst(110); }
  else if (d === 0) { sound.fanfare(1); confettiBurst(40); }
  else sound.womp();
  S.finishing = true;
  const token = S.token;
  setTimeout(() => token === S.token && finishHole(false), 1500);
}

function finishHole(pickedUp) {
  if (S.mode !== 'play' && S.mode !== 'paused') return;
  const strokes = pickedUp ? MAX_STROKES : S.strokes;
  S.scores[S.hole] = strokes;
  const bests = store.get('holeBests', {});
  if (!bests[S.hole] || strokes < bests[S.hole]) bests[S.hole] = strokes;
  store.set('holeBests', bests);
  const last = S.hole === LEVELS.length - 1;
  if (!S.practice) store.set('round', last ? null : { hole: S.hole + 1, scores: S.scores });

  const p = par(S.hole);
  const d = strokes - p;
  const card = $('#card');
  card.dataset.tone = strokes === 1 || d < 0 ? 'great' : d === 0 ? 'good' : 'meh';
  $('#cardTerm').textContent = pickedUp ? 'Picked Up' : scoreTerm(strokes, p);
  $('#cardSub').textContent = `${strokes} ${strokes === 1 ? 'stroke' : 'strokes'} on a par ${p}`;
  $('#cardHole').textContent = `Hole ${S.hole + 1} · ${LEVELS[S.hole].name}`;
  $('#cardTotal').hidden = S.practice;
  $('#cardTotal').textContent = `Round: ${relScore(totalRel())} after ${S.hole + 1} of ${LEVELS.length}`;
  $('#btnNext').textContent = S.practice ? 'Play Again' : last ? 'See Scorecard' : 'Next Hole';
  $('#btnCardMenu').hidden = !S.practice;
  setMode('card');
  updateHud();
}

function nextFromCard() {
  sound.click();
  if (S.practice) return loadHole(S.hole, 'play');
  if (S.hole >= LEVELS.length - 1) return showFinal();
  loadHole(S.hole + 1, 'play');
}

function scorecardHTML(scores) {
  const cells = (fn) => LEVELS.map((L, i) => fn(L, i)).join('');
  let tot = 0, parTot = 0;
  scores.forEach((s, i) => { if (s != null) { tot += s; parTot += par(i); } });
  const mark = (s, i) => {
    if (s == null) return '<td class="empty">–</td>';
    const d = s - par(i);
    const cls = s === 1 ? 'ace' : d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : 'dbl';
    return `<td><span class="sc ${cls}">${s}</span></td>`;
  };
  return `<div class="sc-wrap"><table class="scorecard">
    <thead><tr><th>Hole</th>${cells((L, i) => `<th>${i + 1}</th>`)}<th>Tot</th></tr></thead>
    <tbody>
      <tr class="par-row"><th>Par</th>${cells((L) => `<td>${L.par}</td>`)}<td>${LEVELS.reduce((a, L) => a + L.par, 0)}</td></tr>
      <tr><th>You</th>${cells((L, i) => mark(scores[i], i))}<td class="tot">${tot || '–'}</td></tr>
    </tbody></table></div>
    <div class="sc-legend"><span><i class="sc birdie"></i>Birdie or better</span><span><i class="sc bogey"></i>Bogey or worse</span></div>`;
}

function showFinal() {
  const total = S.scores.reduce((a, b) => a + (b || 0), 0);
  const rel = totalRel();
  const best = store.get('bestRound', null);
  const isBest = best == null || total < best;
  if (isBest) store.set('bestRound', total);
  store.set('round', null);
  $('#finalScore').textContent = total;
  $('#finalRel').textContent = rel === 0 ? 'Even par' : `${relScore(rel)} ${rel > 0 ? 'over' : 'under'} par`;
  $('#finalBest').textContent = isBest ? 'New personal best!' : `Personal best: ${best}`;
  $('#finalBest').classList.toggle('new', isBest);
  $('#finalCard').innerHTML = scorecardHTML(S.scores);
  setMode('final');
  if (rel <= 0) { sound.fanfare(3); confettiBurst(200); }
}

function startRound(fromSave) {
  sound.click();
  S.practice = false;
  const saved = fromSave ? store.get('round', null) : null;
  S.scores = saved ? saved.scores : [];
  loadHole(saved ? saved.hole : 0, 'play');
}

function toTitle() {
  S.token++;
  S.finishing = false;
  S.practice = false;
  S.scores = [];
  setMode('title');
  refreshTitle();
  startDemo(Math.floor(Math.random() * LEVELS.length));
}

function refreshTitle() {
  const saved = store.get('round', null);
  const cont = $('#btnContinue');
  cont.hidden = !saved;
  if (saved) cont.textContent = `Continue · Hole ${saved.hole + 1}`;
  const best = store.get('bestRound', null);
  const parTot = LEVELS.reduce((a, L) => a + L.par, 0);
  $('#bestLine').textContent = best == null ? `${LEVELS.length} holes · Par ${parTot}` : `Best round: ${best} (${relScore(best - parTot)})`;
  $('#btnSound').setAttribute('aria-pressed', String(!sound.muted));
  $('#btnSound').textContent = sound.muted ? 'Sound off' : 'Sound on';
}

function startDemo(i) {
  S.hole = i;
  S.world = new World(LEVELS[i]);
  S.trail = [];
  S.sinkT = 0;
  S.demoT = 0;
  S.demoShots = 0;
  S.hidden = 0;
  buildView();
}

function demoTick(dt) {
  const W = S.world;
  if (W.sunk) {
    if (S.sinkT > 1.6) startDemo((S.hole + 1) % LEVELS.length);
    return;
  }
  if (!W.canShoot() || S.hidden > 0) return;
  S.demoT += dt;
  if (S.demoT < 1.1) return;
  S.demoT = 0;
  if (S.demoShots++ > 6) return startDemo((S.hole + 1) % LEVELS.length);
  const b = W.ball;
  const d = Math.hypot(W.hole.x - b.x, W.hole.y - b.y);
  const angle = Math.atan2(W.hole.y - b.y, W.hole.x - b.x) + (Math.random() - 0.5) * 0.5;
  W.shoot(angle, clamp(0.3 + d / 1400 + Math.random() * 0.15, 0.25, 0.85));
}

function showPractice() {
  sound.click();
  const bests = store.get('holeBests', {});
  const grid = $('#holeGrid');
  grid.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const btn = document.createElement('button');
    btn.className = 'hole-tile';
    btn.id = `hole-${i + 1}`;
    const best = bests[i];
    btn.innerHTML = `<span class="num">${i + 1}</span><span class="nm"></span><span class="meta">Par ${L.par}${best ? ` · Best ${best}` : ''}</span>`;
    btn.querySelector('.nm').textContent = L.name;
    btn.addEventListener('click', () => {
      sound.click();
      S.practice = true;
      S.scores = [];
      loadHole(i, 'play');
    });
    grid.appendChild(btn);
  });
  setMode('practice');
}

function pause() {
  if (S.mode !== 'play') return;
  sound.click();
  S.aim = null;
  $('#pauseCard').innerHTML = S.practice ? '' : scorecardHTML(S.scores);
  $('#btnPauseSound').textContent = sound.muted ? 'Sound: Off' : 'Sound: On';
  setMode('paused');
}

/* ---------- main loop ---------- */

let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

function update(dt) {
  S.time += dt;
  const W = S.world;
  if (S.mode !== 'paused') {
    const wasHidden = S.hidden > 0;
    if (S.hidden > 0) S.hidden -= dt;
    if (wasHidden && S.hidden <= 0) ring(W.ball.x, W.ball.y, 2, 22, 'rgba(255,255,255,0.8)', 0.4, 2);
    W.update(dt);
    handleEvents();
    if (W.sunk) S.sinkT += dt;
    if (W.moving) {
      S.trail.push([W.ball.x, W.ball.y]);
      if (S.trail.length > 12) S.trail.shift();
    } else if (S.trail.length) {
      S.trail.shift();
    }
    if (S.mode === 'title') demoTick(dt);
  }
  for (const p of S.particles) {
    p.life -= dt;
    if (!p.ring) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
    }
  }
  S.particles = S.particles.filter((p) => p.life > 0);
  for (const p of S.popups) p.t += dt;
  S.popups = S.popups.filter((p) => p.t < p.life);
  for (const c of S.confetti) {
    c.vy += 260 * dt;
    c.vy = Math.min(c.vy, 260);
    c.vx *= 1 - 0.8 * dt;
    c.x += (c.vx + Math.sin(c.rot) * 30) * dt;
    c.y += c.vy * dt;
    c.rot += c.vr * dt;
    if (c.y > S.view.h + 20) c.life = 0;
    else if (c.y > S.view.h * 0.7) c.life -= dt;
  }
  S.confetti = S.confetti.filter((c) => c.life > 0);
}

/* ---------- input ---------- */

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (S.mode !== 'play' || S.aim || S.finishing) return;
  if (!S.world.canShoot() || S.hidden > 0) return;
  S.aim = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});

canvas.addEventListener('pointermove', (e) => {
  if (!S.aim || e.pointerId !== S.aim.id) return;
  S.aim.x = e.clientX;
  S.aim.y = e.clientY;
});

canvas.addEventListener('pointerup', (e) => {
  if (!S.aim || e.pointerId !== S.aim.id) return;
  S.aim.x = e.clientX;
  S.aim.y = e.clientY;
  const info = aimInfo();
  S.aim = null;
  if (info.power >= 0.03 && S.mode === 'play') shoot(info);
});

canvas.addEventListener('pointercancel', () => { S.aim = null; });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (S.mode === 'play') pause();
    else if (S.mode === 'paused') { setMode('play'); }
  }
  if (e.key === 'r' && S.mode === 'play' && !S.finishing) loadHole(S.hole, 'play');
});

// Stop iOS pinch-zoom and double-tap zoom from hijacking the game.
for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (e.target === canvas) e.preventDefault(); }, { passive: false });
document.addEventListener('pointerdown', () => sound.unlock(), { capture: true });

let resizeQueued = false;
function onResize() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    buildView();
  });
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 150));

/* ---------- buttons ---------- */

const on = (id, fn) => $(id).addEventListener('click', fn);
on('#btnPlay', () => startRound(false));
on('#btnContinue', () => startRound(true));
on('#btnPractice', showPractice);
on('#btnPracticeBack', () => { sound.click(); setMode('title'); });
on('#btnSound', () => {
  sound.unlock();
  sound.setMuted(!sound.muted);
  store.set('muted', sound.muted);
  refreshTitle();
  sound.click();
});
on('#btnMenu', pause);
on('#btnRestart', () => {
  if (S.mode !== 'play' || S.finishing) return;
  sound.click();
  loadHole(S.hole, 'play');
});
on('#btnResume', () => { sound.click(); setMode('play'); });
on('#btnPauseRestart', () => { sound.click(); loadHole(S.hole, 'play'); });
on('#btnPauseSound', () => {
  sound.unlock();
  sound.setMuted(!sound.muted);
  store.set('muted', sound.muted);
  $('#btnPauseSound').textContent = sound.muted ? 'Sound: Off' : 'Sound: On';
  sound.click();
});
on('#btnQuit', () => { sound.click(); toTitle(); });
on('#btnNext', nextFromCard);
on('#btnCardMenu', () => { sound.click(); showPractice(); });
on('#btnAgain', () => startRound(false));
on('#btnFinalMenu', () => { sound.click(); toTitle(); });

/* ---------- boot ---------- */

if ('serviceWorker' in navigator && window.top === window.self && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

toTitle();
requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(frame);
});
