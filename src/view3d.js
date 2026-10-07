// The 3D view, built on three.js (bundled in src/vendor so it works offline).
//
// Art direction: a bright, clean, stylised look in the spirit of modern
// sports games: crisp course edges, textured turf, sun shadows and sky
// light, textured trees, long grass in the rough, reflective water.
//
// Built for a steady 60 fps on tablets: one pass straight to the screen
// with hardware MSAA (the colour grade lives in the tone mapping), Lambert
// lighting with a sky probe, shadows re-drawn only when the view moves on,
// and quality that adapts to the device.
//
// The simulation still plays on flat ground; the terrain heights here are
// visual, and anything drawn on the course is lifted to the ground under it.
// World units are yards with z up.

const TAU = Math.PI * 2;
const EDGE = 6; // terrain height at the edge of the course area
const STEP = 1; // terrain grid spacing, yards
import { paintAtlas, makeTrees, makeTreeMaterials, makeGrassGeo, makeGrassMaterial } from './flora.js?v=20';
import { makeProps, makePropMaterial } from './props.js?v=20';
const VERSIONED = new URL(import.meta.url).search; // same ?v= as this file

// Colours and light for each course (sRGB hex).
const LOOKS = {
  links: {
    skyTop: '#3d8fe0', skyHorizon: '#cfe7f7', sun: '#fff1d6', sunI: 2.6, hemiSky: '#cfe6ff', hemiGround: '#5a7d3a', hemiI: 1.3, exposure: 1.0,
    ob: '#4f9a3f', deep: '#5aa646', rough: '#66b34c', fairway: '#86cf5c', fairway2: '#79c352', fringe: '#7fcb59', green: '#97de6c', green2: '#8bd462',
    sand: '#f3e2b2', sandLip: '#c9b07a', bed: '#2f6f80', water: '#2fa3c4', deepWater: '#1a6c8f', tree: ['#3f8f3a', '#4ea544', '#2f7a3a'], trunk: '#7a5634',
    hills: ['#5aa04d', '#6fb35a', '#4f8f48'], sunEl: 0.85, cloud: 1, fogNear: 260, fogFar: 1700, hillsH: 1, env: 'park',
  },
  augusta: {
    skyTop: '#2f84df', skyHorizon: '#d6ecf8', sun: '#fff3dd', sunI: 2.7, hemiSky: '#d2e8ff', hemiGround: '#4c7a37', hemiI: 1.25, exposure: 1.0,
    ob: '#3b8238', deep: '#43893a', rough: '#4f9c40', fairway: '#62bb4c', fairway2: '#58ae45', fringe: '#5fb449', green: '#76ca5a', green2: '#6cbf52',
    sand: '#fbf6ea', sandLip: '#d2c8b0', bed: '#2a5f63', water: '#2a9fb8', deepWater: '#176a86', tree: ['#2e7a3c', '#3c8f46', '#256a36'], trunk: '#8a5a3a',
    hills: ['#3f8a45', '#56a04f', '#357a40'], sunEl: 0.9, cloud: 0.8, fogNear: 260, fogFar: 1700, hillsH: 1.2, straw: '#8e5c34', flowers: true, aug: true, env: 'park',
  },
  standrews: {
    skyTop: '#6f8aa6', skyHorizon: '#d3dbe1', sun: '#f6efe2', sunI: 2.1, hemiSky: '#e4ecf2', hemiGround: '#8c8f55', hemiI: 1.4, exposure: 0.95,
    ob: '#9aa25a', deep: '#a3a660', rough: '#b0b56a', fairway: '#8fcf63', fairway2: '#84c35a', fringe: '#88c85e', green: '#98d86c', green2: '#8ccd63',
    sand: '#ead8a6', sandLip: '#8d7a4c', bed: '#3a6a76', water: '#3b8fa6', deepWater: '#245f74', tree: ['#3b6f35', '#4a7f3a', '#355f2f'], trunk: '#6a5233',
    hills: ['#93a05a', '#a6ad66', '#7f8f50'], sunEl: 0.95, cloud: 2.2, fogNear: 320, fogFar: 1600, hillsH: 0.4, gorse: true, env: 'sky', envI: 0.7,
  },
  pebble: {
    skyTop: '#4a74c9', skyHorizon: '#ffd7a8', sun: '#ffd29a', sunI: 2.5, hemiSky: '#ffd9b8', hemiGround: '#4f7a3f', hemiI: 1.15, exposure: 1.0,
    ob: '#4f9440', deep: '#5aa046', rough: '#64ac4c', fairway: '#82cd5c', fairway2: '#74bf52', fringe: '#7cc858', green: '#94dc6a', green2: '#87d160',
    sand: '#f2e1b5', sandLip: '#b9a072', bed: '#1d4f73', water: '#2f8fc8', deepWater: '#1a5c94', tree: ['#2b5f3f', '#336b45', '#285738'], trunk: '#6b5040',
    hills: ['#4f8f45', '#5f9f50', '#477f40'], sunEl: 0.42, cloud: 1.1, fogNear: 260, fogFar: 1700, hillsH: 0.8, rock: '#a69a86', env: 'sunset',
  },
  sawgrass: {
    skyTop: '#2b8ff0', skyHorizon: '#cdeeff', sun: '#fff6e2', sunI: 2.8, hemiSky: '#d6efff', hemiGround: '#5a8a3c', hemiI: 1.25, exposure: 1.0,
    ob: '#4c9a3e', deep: '#57a644', rough: '#62b14b', fairway: '#82d35d', fairway2: '#73c552', fringe: '#7ccc57', green: '#95e06b', green2: '#88d562',
    sand: '#f6ead0', sandLip: '#cbb88f', bed: '#285f6c', water: '#2aa8c0', deepWater: '#167089', tree: ['#3e9642', '#4aa64b', '#33843b'], trunk: '#8a6e4c',
    hills: ['#4f9a48', '#62ad55', '#468a43'], sunEl: 0.95, cloud: 1.2, fogNear: 260, fogFar: 1700, hillsH: 0.5, env: 'park',
  },
};

function seeded(n) {
  let a = n >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const r = seeded(seed);
  const perm = new Float32Array(512);
  for (let i = 0; i < 512; i++) perm[i] = r();
  const h = (x, y) => perm[((x * 73856093) ^ (y * 19349663)) & 511];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

// '#rrggbb' or 'rgba(r,g,b,a)' to [r, g, b, a] in 0..1 (used by the game too).
const colorCache = new Map();
export function parseColor(s) {
  let c = colorCache.get(s);
  if (c) return c;
  if (s[0] === '#') {
    const n = parseInt(s.slice(1), 16);
    c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  } else {
    const p = s.match(/[\d.]+/g).map(Number);
    c = [p[0] / 255, p[1] / 255, p[2] / 255, p[3] ?? 1];
  }
  colorCache.set(s, c);
  return c;
}

// ---------- the painted surface: clean stylised turf ----------

function ellipse(c, e, grow = 0) {
  c.beginPath();
  c.ellipse(e.x, e.y, Math.max(0.01, e.rx + grow), Math.max(0.01, e.ry + grow), e.rot || 0, 0, TAU);
}

function pointAt(P, s) {
  let i = 1;
  while (i < P.length - 1 && P[i].s < s) i++;
  const a = P[i - 1], b = P[i];
  const t = Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s || 1)));
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  return { x: a.x + dx * t, y: a.y + dy * t, nx: -dy / l, ny: dx / l };
}

function paintTurf(hole, box, px, L) {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(box.w * px);
  cv.height = Math.ceil(box.h * px);
  const c = cv.getContext('2d');
  c.setTransform(px, 0, 0, px, -box.x * px, -box.y * px);
  const r = seeded(hole.index * 31 + 7);
  const P = hole.path;
  c.fillStyle = L.ob;
  c.fillRect(box.x, box.y, box.w, box.h);
  c.lineCap = c.lineJoin = 'round';
  c.strokeStyle = L.deep;
  c.lineWidth = hole.bounds * 2;
  c.beginPath();
  P.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.stroke();
  // Big soft patches of lighter and darker grass.
  for (let i = 0; i < 140; i++) {
    const x = box.x + r() * box.w, y = box.y + r() * box.h, rr = 8 + r() * 26;
    const g = c.createRadialGradient(x, y, 0, x, y, rr);
    const light = r() < 0.5;
    g.addColorStop(0, light ? 'rgba(255,255,210,0.09)' : 'rgba(0,40,0,0.09)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  const discs = (from, to, extra) => {
    c.beginPath();
    for (const p of P) {
      if (p.s < from || p.s > to) continue;
      const rr = hole.halfWidth(p.s) + extra;
      c.moveTo(p.x + rr, p.y);
      c.arc(p.x, p.y, rr, 0, TAU);
    }
  };
  // Pine straw under Augusta's trees.
  if (L.straw) {
    // Beds of straw under the pines, with ragged edges, spreading into one
    // carpet through the woods beyond the corridor.
    c.fillStyle = L.straw;
    c.beginPath();
    for (const t of hole.trees) {
      const rr = t.r * (1.9 + r() * 0.6);
      for (let k = 0; k < 3; k++) {
        const a = r() * TAU, d = r() * t.r * 0.5, x = t.x + Math.cos(a) * d, y = t.y + Math.sin(a) * d, q = rr * (0.75 + r() * 0.3);
        c.moveTo(x + q, y);
        c.arc(x, y, q, 0, TAU);
      }
    }
    c.fill('nonzero');
    // Fallen needles thin out onto the grass at the edge of each bed.
    for (const t of hole.trees) {
      for (let k = 0; k < 6; k++) {
        const a = r() * TAU, d = t.r * (1.7 + r() * 1.1), q = 1.5 + r() * 3;
        c.globalAlpha = 0.35 + r() * 0.3;
        c.beginPath();
        c.arc(t.x + Math.cos(a) * d, t.y + Math.sin(a) * d, q, 0, TAU);
        c.fill();
      }
    }
    c.globalAlpha = 1;
  }
  discs(0, Infinity, hole.roughW);
  c.fillStyle = L.rough;
  c.fill('nonzero');
  if (hole.fwFrom < hole.fwTo) {
    // A darker first cut, then the fairway with broad mown stripes.
    discs(hole.fwFrom, hole.fwTo, 1.2);
    c.fillStyle = L.fairway2;
    c.fill('nonzero');
    c.save();
    discs(hole.fwFrom, hole.fwTo, 0);
    c.fillStyle = L.fairway;
    c.fill('nonzero');
    c.clip('nonzero');
    let on = false;
    for (let s = hole.fwFrom - 30; s < hole.fwTo + 30; s += 9) {
      on = !on;
      if (!on) continue;
      const a = pointAt(P, s), b = pointAt(P, s + 9);
      const w = hole.halfWidth(s) + 6;
      c.beginPath();
      c.moveTo(a.x + a.nx * w, a.y + a.ny * w);
      c.lineTo(b.x + b.nx * w, b.y + b.ny * w);
      c.lineTo(b.x - b.nx * w, b.y - b.ny * w);
      c.lineTo(a.x - a.nx * w, a.y - a.ny * w);
      c.fillStyle = L.fairway2;
      c.fill();
    }
    c.restore();
  }
  // Tee box with stripes.
  const t = hole.tee;
  c.save();
  c.translate(t.x, t.y);
  c.rotate(t.rot);
  c.fillStyle = L.fairway;
  c.beginPath();
  c.roundRect ? c.roundRect(-t.rx, -t.ry, t.rx * 2, t.ry * 2, 1.5) : c.rect(-t.rx, -t.ry, t.rx * 2, t.ry * 2);
  c.fill();
  c.clip();
  c.fillStyle = L.fairway2;
  for (let i = -t.ry; i < t.ry; i += 3) c.fillRect(-t.rx, i, t.rx * 2, 1.5);
  c.restore();
  // Soft shade under every tree, so they sit in the ground even beyond the
  // reach of the sun's shadow map.
  for (const t of hole.trees) {
    const rr = t.r * 1.5;
    const sh = c.createRadialGradient(t.x, t.y, 0, t.x, t.y, rr);
    sh.addColorStop(0, 'rgba(10,30,5,0.42)');
    sh.addColorStop(0.55, 'rgba(10,30,5,0.22)');
    sh.addColorStop(1, 'rgba(10,30,5,0)');
    c.fillStyle = sh;
    c.fillRect(t.x - rr, t.y - rr, rr * 2, rr * 2);
  }
  // Water beds and sea cliffs (the water surface is drawn separately).
  for (const w of hole.water) {
    if (w.line) {
      c.strokeStyle = L.sandLip;
      c.lineWidth = w.w + 2;
      c.beginPath();
      w.line.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.stroke();
      c.strokeStyle = L.bed;
      c.lineWidth = w.w;
      c.stroke();
    } else {
      if (w.sea && L.rock) {
        ellipse(c, w, 4);
        c.fillStyle = L.rock;
        c.fill();
      } else {
        ellipse(c, w, 1.2);
        c.fillStyle = L.sandLip;
        c.fill();
      }
      ellipse(c, w);
      c.fillStyle = L.bed;
      c.fill();
    }
  }
  // Fringe and green with a checkerboard cut.
  const g = hole.green;
  ellipse(c, g, 2.6);
  c.fillStyle = L.fringe;
  c.fill();
  c.save();
  ellipse(c, g);
  c.fillStyle = L.green;
  c.fill();
  c.clip();
  c.translate(g.x, g.y);
  c.rotate((g.rot || 0) + 0.6);
  c.fillStyle = L.green2;
  const R = Math.max(g.rx, g.ry) + 3;
  for (let y = -R; y < R; y += 2.5) for (let x = -R; x < R; x += 2.5) if (((Math.floor(x / 2.5) + Math.floor(y / 2.5)) & 1) === 0) c.fillRect(x, y, 2.5, 2.5);
  c.restore();
  // Bunkers: a darker lip and bright sand.
  for (const b of hole.bunkers) {
    ellipse(c, b, 0.7);
    c.fillStyle = L.sandLip;
    c.fill();
    ellipse(c, b);
    const gr = c.createRadialGradient(b.x - b.rx * 0.2, b.y - b.ry * 0.25, 0, b.x, b.y, Math.max(b.rx, b.ry));
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.35, L.sand);
    gr.addColorStop(1, L.sand);
    c.fillStyle = gr;
    c.fill();
  }
  // Bridges.
  for (const br of hole.bridges || []) {
    if (br.style === 'stone') continue; // modelled in 3D
    c.save();
    c.translate(br.x, br.y);
    c.rotate(br.ang);
    c.fillStyle = '#d8d0bf';
    c.fillRect(-br.len / 2, -1.1, br.len, 2.2);
    c.fillStyle = '#a79f8c';
    c.fillRect(-br.len / 2, -1.1, br.len, 0.35);
    c.fillRect(-br.len / 2, 0.75, br.len, 0.35);
    c.restore();
  }
  return cv;
}

// ---------- crisp course edges ----------
// Signed distances (yards, negative inside) to each kind of surface, at two
// texels per yard. Sampled with bilinear filtering they give razor-sharp,
// smooth edges at any zoom, which a painted texture can't.
const SDF_PX = 2;
const SDF_MAX = 16;

function ellipseSD(e, x, y, grow = 0) {
  const c = Math.cos(-(e.rot || 0)), sn = Math.sin(-(e.rot || 0));
  const dx = x - e.x, dy = y - e.y;
  const u = dx * c - dy * sn, v = dx * sn + dy * c;
  const rx = e.rx + grow, ry = e.ry + grow;
  const k = Math.sqrt((u * u) / (rx * rx) + (v * v) / (ry * ry));
  if (k < 0.05) return -Math.min(rx, ry);
  const gx = u / (rx * rx), gy = v / (ry * ry);
  return ((k - 1) * k) / Math.hypot(gx, gy);
}

function segSD(x, y, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay, l2 = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / l2));
  return Math.hypot(x - ax - abx * t, y - ay - aby * t);
}

// Float to IEEE half (no NaN/denormal care needed for these ranges).
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 112;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | ((x >>> 13) & 0x3ff);
}

function buildCourseSDF(hole, box) {
  const W = Math.ceil(box.w * SDF_PX), H = Math.ceil(box.h * SDF_PX);
  const n = W * H;
  const F = new Float32Array(n).fill(SDF_MAX), Gd = new Float32Array(n).fill(SDF_MAX);
  const S = new Float32Array(n).fill(SDF_MAX), Wd = new Float32Array(n).fill(SDF_MAX);
  const along = new Float32Array(n);
  const X = (i) => box.x + (i + 0.5) / SDF_PX, Y = (j) => box.y + (j + 0.5) / SDF_PX;
  // Run f over the texels inside a bounding box (world units).
  const each = (x0, y0, x1, y1, f) => {
    const i0 = Math.max(0, Math.floor((x0 - box.x) * SDF_PX)), i1 = Math.min(W - 1, Math.ceil((x1 - box.x) * SDF_PX));
    const j0 = Math.max(0, Math.floor((y0 - box.y) * SDF_PX)), j1 = Math.min(H - 1, Math.ceil((y1 - box.y) * SDF_PX));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * W + i, X(i), Y(j));
  };
  const ellBox = (e, m) => {
    const r = Math.max(e.rx, e.ry) + m;
    return [e.x - r, e.y - r, e.x + r, e.y + r];
  };
  // Fairway: distance to the centre line minus the (varying) half width,
  // splatted segment by segment into the texels each one can affect.
  if (hole.fwFrom < hole.fwTo) {
    const P = hole.path;
    for (let q = 0; q < P.length - 1; q++) {
      const A = P[q], B = P[q + 1];
      if (B.s < hole.fwFrom || A.s > hole.fwTo) continue;
      const hwA = hole.halfWidth(Math.max(hole.fwFrom, A.s)), hwB = hole.halfWidth(Math.min(hole.fwTo, B.s));
      const reach = Math.max(hwA, hwB) + SDF_MAX;
      const abx = B.x - A.x, aby = B.y - A.y, l2 = abx * abx + aby * aby || 1;
      const s0 = Math.max(hole.fwFrom, A.s), s1 = Math.min(hole.fwTo, B.s);
      const t0 = (s0 - A.s) / (B.s - A.s || 1), t1 = (s1 - A.s) / (B.s - A.s || 1);
      each(Math.min(A.x, B.x) - reach, Math.min(A.y, B.y) - reach, Math.max(A.x, B.x) + reach, Math.max(A.y, B.y) + reach, (k, x, y) => {
        const t = Math.max(t0, Math.min(t1, ((x - A.x) * abx + (y - A.y) * aby) / l2));
        const d = Math.hypot(x - A.x - abx * t, y - A.y - aby * t) - (hwA + (hwB - hwA) * t);
        if (d < F[k]) {
          F[k] = Math.max(-SDF_MAX, d);
          along[k] = A.s + (B.s - A.s) * t;
        }
      });
    }
  }
  const g = hole.green;
  each(...ellBox(g, SDF_MAX), (k, x, y) => {
    Gd[k] = Math.max(-SDF_MAX, Math.min(Gd[k], ellipseSD(g, x, y)));
  });
  for (const b of hole.bunkers) {
    each(...ellBox(b, 6), (k, x, y) => {
      S[k] = Math.max(-SDF_MAX, Math.min(S[k], ellipseSD(b, x, y)));
    });
  }
  for (const w of hole.water) {
    if (w.line) {
      const xs = w.line.map((p) => p[0]), ys = w.line.map((p) => p[1]);
      each(Math.min(...xs) - w.w - 6, Math.min(...ys) - w.w - 6, Math.max(...xs) + w.w + 6, Math.max(...ys) + w.w + 6, (k, x, y) => {
        let d = Infinity;
        for (let q = 1; q < w.line.length; q++) d = Math.min(d, segSD(x, y, w.line[q - 1][0], w.line[q - 1][1], w.line[q][0], w.line[q][1]));
        Wd[k] = Math.max(-SDF_MAX, Math.min(Wd[k], d - w.w / 2));
      });
    } else {
      each(...ellBox(w, 6), (k, x, y) => {
        Wd[k] = Math.max(-SDF_MAX, Math.min(Wd[k], ellipseSD(w, x, y)));
      });
    }
  }
  return { W, H, F, G: Gd, S, Wd, along };
}

// ---------- the view ----------

export class View3D {
  constructor(canvas) {
    this.cv = canvas;
    this.ok = false;
    this.hole = null;
    this.grid = null;
    this.ready = this.init().catch((e) => {
      console.warn('3D view unavailable', e);
      this.ok = false;
    });
  }

  async init() {
    const T = await import('./vendor/three.bundle.min.js' + VERSIONED);
    this.T = T;
    // Colour grade inside tone mapping: ACES, then a little extra saturation
    // and contrast. It runs in every material's own shader, so it costs
    // nothing extra (no post-processing passes at all).
    T.ShaderChunk.tonemapping_pars_fragment = T.ShaderChunk.tonemapping_pars_fragment.replace(
      'vec3 CustomToneMapping( vec3 color ) { return color; }',
      `vec3 CustomToneMapping( vec3 color ) {
        color = max(color, 0.0);
        color = color * (1.0 + 0.12 * (color - 0.18) / (color + 0.18));
        color = ACESFilmicToneMapping(color);
        float l = dot(color, vec3(0.299, 0.587, 0.114));
        return clamp(mix(vec3(l), color, 1.07), 0.0, 1.0);
      }`,
    );
    // Drawn straight to the screen with the GPU's own multisampling: the
    // cheapest path on tablets (no off-screen buffers to fill and resolve).
    const probe = document.createElement('canvas').getContext('webgl2');
    const dbg0 = probe && probe.getExtension('WEBGL_debug_renderer_info');
    const soft = /swiftshader|llvmpipe|software/i.test(dbg0 ? String(probe.getParameter(dbg0.UNMASKED_RENDERER_WEBGL)) : '');
    const renderer = new T.WebGLRenderer({ canvas: this.cv, antialias: !soft, powerPreference: 'high-performance', alpha: false, stencil: false });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 needed');
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false; // re-rendered only when the view moves on
    renderer.toneMapping = T.CustomToneMapping;
    renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer = renderer;
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(56, 1, 0.15, 6000);
    this.camera.up.set(0, 0, 1);
    this.camera.layers.enable(1);

    // Lights: sun with soft shadows, plus sky light.
    this.hemi = new T.HemisphereLight(0xffffff, 0x446622, 1.2);
    this.hemi.up = new T.Vector3(0, 0, 1);
    this.hemi.position.set(0, 0, 1);
    this.scene.add(this.hemi);
    const sun = new T.DirectionalLight(0xffffff, 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 1; sc.far = 600;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    this.sunLight = sun;

    // Sky light from real HDRIs (assets/env, CC0 Poly Haven), baked into a
    // spherical-harmonics probe: rich ambient colour for almost no cost.
    this.envCache = {};
    this.probe = new T.LightProbe();
    this.scene.add(this.probe);

    // Quality tiers: 2 = High (reflections, sharper, longer grass and tree
    // detail), 1 = Medium, 0 = Low. Auto starts on Medium (Low for software
    // GL), climbs when there's headroom and drops if frames run slow.
    let forced = null;
    try { forced = localStorage.getItem('pocketlinks.gfx'); } catch {}
    const dbg = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? String(renderer.getContext().getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    this.soft = /swiftshader|llvmpipe|software/i.test(gpu);
    this.mode = forced === '0' || forced === '1' || forced === '2' ? +forced : 'auto';
    this.quality = this.mode === 'auto' ? (this.soft ? 0 : 1) : this.mode;
    this.autoQuality = this.mode === 'auto';
    this.resScale = 1; // dynamic resolution, 0.6 to 1
    this.frameMs = 16;
    this.speedT = 0;
    this.settleUntil = 0;
    this.noClimbUntil = 0;
    this.lastFrame = 0;

    this.buildShared();
    this.ok = true;
    this.setQuality(this.quality);
  }

  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    if (!this.renderer) return;
    const pr = Math.max(0.7, Math.min(dpr, [1, 1.3, 1.6][this.quality]) * this.resScale);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
  }

  // Tiling detail textures for the ground (assets/tex, made by
  // tools/gen_textures.py). Neutral stand-ins are used until they arrive.
  loadDetail() {
    const T = this.T;
    const one = (r, g, b) => {
      const t = new T.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
      t.needsUpdate = true;
      return t;
    };
    const grey = one(128, 128, 128), flat = one(128, 128, 255);
    const files = {
      uDFairA: 'grass_fairway', uDFairN: 'grass_fairway_n', uDGreenA: 'grass_green', uDGreenN: 'grass_green_n',
      uDRoughA: 'grass_rough', uDRoughN: 'grass_rough_n', uDSandA: 'sand', uDSandN: 'sand_n',
      uDSoilA: 'soil', uDSoilN: 'soil_n', uDMacro: 'macro',
    };
    this.detU = { uDetOn: { value: 0 } };
    // The painted cloud band for the sky (transparent until it loads).
    const clear = new T.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1);
    clear.needsUpdate = true;
    this.cloudsU = { value: clear };
    new T.TextureLoader().load(new URL('../assets/tex/clouds.png', import.meta.url).href + VERSIONED, (t) => {
      t.wrapS = T.RepeatWrapping;
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 4;
      this.cloudsU.value = t;
    });
    for (const [u, f] of Object.entries(files)) this.detU[u] = { value: f.endsWith('_n') ? flat : grey };
    const loader = new T.TextureLoader();
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const load = (f) =>
      new Promise((ok, fail) =>
        loader.load(new URL(`../assets/tex/${f}.webp`, import.meta.url).href + VERSIONED, ok, undefined, fail));
    Promise.all(
      Object.entries(files).map(([u, f]) =>
        load(f).then((t) => {
          t.wrapS = t.wrapT = T.RepeatWrapping;
          t.colorSpace = T.NoColorSpace; // detail is centred on 0.5 in linear terms
          t.anisotropy = Math.min(16, aniso);
          return [u, t];
        }),
      ),
    )
      .then((list) => {
        for (const [u, t] of list) this.detBase[u] = t;
        this.applyDetail();
        this.detU.uDetOn.value = 1;
      })
      .catch(() => {}); // keep the plain look if they can't load
    // Augusta swaps its own surfaces into the same slots rather than adding
    // samplers: iPads allow only 16 textures per shader, and the terrain is
    // at 15. Fairway -> Augusta turf, sand -> white sand, and soil (only seen
    // under water) -> pine straw, which is a colour texture.
    const straw = one(142, 92, 52);
    straw.colorSpace = T.SRGBColorSpace;
    this.detBase = {};
    this.detAug = { uDSoilA: straw, uDSoilN: flat };
    this.detAugOn = false;
    const extra = {
      uDSoilA: 'pinestraw', uDSoilN: 'pinestraw_n', uDSandA: 'sand_white', uDSandN: 'sand_white_n',
      uDFairA: 'turf_augusta', uDFairN: 'turf_augusta_n',
    };
    for (const [u, f] of Object.entries(extra)) {
      load(f)
        .then((t) => {
          t.wrapS = t.wrapT = T.RepeatWrapping;
          t.colorSpace = f === 'pinestraw' ? T.SRGBColorSpace : T.NoColorSpace;
          t.anisotropy = Math.min(16, aniso);
          this.detAug[u] = t;
          this.applyDetail();
        })
        .catch(() => {});
    }
  }

  // Point the shared detail slots at this course's textures.
  applyDetail(aug = this.detAugOn) {
    this.detAugOn = aug;
    for (const u of Object.keys(this.detU)) {
      if (u === 'uDetOn') continue;
      const t = (aug && this.detAug[u]) || this.detBase[u];
      if (t) this.detU[u].value = t;
    }
  }

  // Pieces that don't depend on the hole: geometries, materials, pools.
  buildShared() {
    const T = this.T;
    this.timeU = { value: 0 };
    this.loadDetail();
    // Trees, bushes and grass (see flora.js).
    {
      // Upload the atlas as raw pixels, with leaf colour bled into the clear
      // areas so mipmaps don't darken the leaf edges.
      const cv = paintAtlas();
      const W = cv.width, H = cv.height;
      const src = cv.getContext('2d').getImageData(0, 0, W, H).data;
      const px = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4, o = ((H - 1 - y) * W + x) * 4; // flip: canvas top is v = 1
          const a = src[i + 3];
          px[o] = a ? src[i] : 215;
          px[o + 1] = a ? src[i + 1] : 215;
          px[o + 2] = a ? src[i + 2] : 215;
          px[o + 3] = a;
        }
      }
      this.atlasTex = new T.DataTexture(px, W, H, T.RGBAFormat, T.UnsignedByteType);
      this.atlasTex.generateMipmaps = true;
      this.atlasTex.minFilter = T.LinearMipmapLinearFilter;
      this.atlasTex.magFilter = T.LinearFilter;
      this.atlasTex.needsUpdate = true;
    }
    this.atlasTex.colorSpace = T.SRGBColorSpace;
    this.atlasTex.anisotropy = 4;
    this.treeKinds = makeTrees(T);
    this.props = makeProps(T);
    this.propMat = makePropMaterial(T);
    const mats = makeTreeMaterials(T, this.atlasTex, this.timeU);
    this.leafMat = mats.leaf;
    this.bodyMat = mats.body;
    this.barkMat = mats.bark;
    this.bloomMat = mats.bloom;
    // Loblolly pines get their own plated bark.
    this.barkLMat = this.barkMat.clone();
    this.barkLMat.onBeforeCompile = this.barkMat.onBeforeCompile;
    this.barkLMat.customProgramCacheKey = this.barkMat.customProgramCacheKey;
    // Swap in the painted foliage atlas and bark when they arrive.
    const tl0 = new T.TextureLoader(), waits = [];
    // Each load resolves (loaded or not) so distant-tree impostors can be
    // baked once the real textures are in.
    const tl = { load: (url, cb) => waits.push(new Promise((ok) => tl0.load(url, (t) => { cb(t); ok(); }, undefined, ok))) };
    tl.load(new URL('../assets/tex/foliage.png', import.meta.url).href + VERSIONED, (t) => {
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 4;
      this.leafMat.map = this.bodyMat.map = t;
      this.leafMat.needsUpdate = this.bodyMat.needsUpdate = true;
    });
    tl.load(new URL('../assets/tex/blossoms.png', import.meta.url).href + VERSIONED, (t) => {
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 4;
      this.bloomMat.map = t;
      this.bloomMat.needsUpdate = true;
    });
    tl.load(new URL('../assets/tex/bark_loblolly.webp', import.meta.url).href + VERSIONED, (t) => {
      t.colorSpace = T.SRGBColorSpace;
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.anisotropy = 4;
      this.barkLMat.map = t;
      this.barkLMat.color.setScalar(1.25);
      this.barkLMat.needsUpdate = true;
    });
    tl.load(new URL('../assets/tex/bark.webp', import.meta.url).href + VERSIONED, (t) => {
      t.colorSpace = T.SRGBColorSpace;
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.anisotropy = 4;
      this.barkMat.map = t;
      this.barkMat.color.setScalar(1.35);
      this.barkMat.needsUpdate = true;
    });
    this.treeTexReady = Promise.all(waits);
    this.grassU = {
      uTime: this.timeU, uMask: { value: null }, uHeight: { value: null }, uTurf: { value: null },
      uBox: { value: new T.Vector4() }, uGrid: { value: new T.Vector4() }, uCentre: { value: new T.Vector2() },
      uSpacing: { value: 0.55 }, uFar: { value: 44 }, uRoughH: { value: 1 },
      uBalls: { value: [0, 1, 2, 3].map(() => new T.Vector4()) },
    };
    {
      const N = 160;
      const geo = makeGrassGeo(T);
      const ig = new T.InstancedBufferGeometry();
      for (const k of ['position', 'normal', 'color']) ig.setAttribute(k, geo.attributes[k]);
      ig.setIndex(geo.index);
      // Nearest cells first, so drawing fewer instances shrinks the field
      // around its centre rather than cutting off a strip.
      const cells = [];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) cells.push([i - N / 2, j - N / 2]);
      cells.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
      const off = new Float32Array(N * N * 2);
      cells.forEach((c, k) => off.set(c, k * 2));
      ig.setAttribute('aOff', new T.InstancedBufferAttribute(off, 2));
      ig.instanceCount = N * N;
      this.grass = new T.Mesh(ig, makeGrassMaterial(T, this.grassU));
      this.grass.frustumCulled = false;
      this.grass.layers.set(1); // kept out of the water's reflection pass
      this.grass.receiveShadow = true;
      this.grass.visible = false;
      this.scene.add(this.grass);
    }

    // Ball and friends.
    this.ballGeo = new T.SphereGeometry(1, 20, 14);
    {
      // A ball with a putting line round it and a soft dimple grain, so you
      // can see it roll.
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 128;
      const c = cv.getContext('2d');
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 900; i++) {
        c.fillStyle = `rgba(0,0,0,${0.025 + Math.random() * 0.03})`;
        c.beginPath();
        c.arc(Math.random() * 256, Math.random() * 128, 1.6, 0, TAU);
        c.fill();
      }
      c.fillStyle = '#1f4fbf';
      c.fillRect(0, 59, 256, 10);
      c.fillStyle = '#d8282c';
      c.fillRect(0, 63, 256, 2);
      const tex = new T.CanvasTexture(cv);
      tex.colorSpace = T.SRGBColorSpace;
      this.ballMat = new T.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0, emissive: 0x222222 });
    }
    {
      const cvs = document.createElement('canvas');
      cvs.width = cvs.height = 64;
      const c = cvs.getContext('2d');
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(0,0,0,0.75)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
      this.blobTex = new T.CanvasTexture(cvs);
    }
    this.blobMat = new T.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.ringGeo = new T.RingGeometry(0.82, 1, 48);
    this.discGeo = new T.CircleGeometry(1, 24);
  }

  // ---------- building a hole ----------

  setHole(hole, R) {
    if (!this.ok) return;
    const T = this.T;
    const t0 = performance.now();
    if (this.holeGroup) {
      this.scene.remove(this.holeGroup);
      this.holeGroup.traverse((o) => {
        if (o.geometry && !o.userData.shared) o.geometry.dispose();
        if (o.material && o.userData.ownMat) o.material.dispose();
      });
      for (const t of this.holeTextures || []) t.dispose();
      if (this.terrainMat) this.terrainMat.dispose();
      if (this.reflector) this.reflector.dispose();
      this.reflector = null;
    }
    this.hole = hole;
    this.box = R.box;
    this.shadowKey = '';
    this.slopePts = R.slopePts;
    const L = (this.look = LOOKS[hole.course] || LOOKS.links);
    const group = new T.Group();
    this.holeGroup = group;
    this.holeTextures = [];
    this.scene.add(group);

    // Light and air.
    const el = L.sunEl, az = Math.atan2(-0.8, -0.6);
    this.sunDir = new T.Vector3(Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)).normalize();
    this.sunLight.color.set(L.sun);
    this.sunLight.intensity = L.sunI;
    this.hemi.color.set(L.hemiSky);
    this.hemi.groundColor.set(L.hemiGround);
    this.hemi.intensity = L.hemiI;
    this.renderer.toneMappingExposure = L.exposure;
    this.scene.fog = new T.Fog(new T.Color(L.skyHorizon), L.fogNear, L.fogFar);
    this.useEnv(L.env || 'park', L);

    // Terrain.
    const mask = R.paintMask(R.box, 1);
    this.maskTex = new T.CanvasTexture(mask);
    this.maskTex.colorSpace = T.NoColorSpace;
    this.maskTex.generateMipmaps = false;
    this.maskTex.minFilter = T.LinearFilter;
    this.holeTextures.push(this.maskTex);
    this.applyDetail(!!L.aug); // Augusta's turf, sand and straw in the shared slots
    this.buildTerrain(hole, mask, L, group);
    // Sky, clouds, distant hills.
    this.buildSky(L, group, hole);
    // Water.
    this.buildWater(mask, L, group);
    // Trees, bushes and grass.
    this.buildTrees(hole, L, group);
    this.buildProps(hole, L, group);
    this.buildGrass();
    // Flag, cup, tee markers.
    this.buildPin(hole, L, group);
    // Dynamic pieces.
    this.buildDynamic(group);
    this.buildMs = Math.round(performance.now() - t0);
  }

  buildTerrain(hole, mask, L, group) {
    const T = this.T;
    const box = this.box;
    const sd = buildCourseSDF(hole, box);
    const sdAt = (a, x, y) => {
      const fx = (x - box.x) * SDF_PX - 0.5, fy = (y - box.y) * SDF_PX - 0.5;
      const i = Math.max(0, Math.min(sd.W - 2, Math.floor(fx))), j = Math.max(0, Math.min(sd.H - 2, Math.floor(fy)));
      const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fy - j)), k = j * sd.W + i;
      return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + sd.W] * (1 - u) + a[k + sd.W + 1] * u) * v;
    };
    const step = STEP;
    const gw = Math.ceil(box.w / step) + 1, gh = Math.ceil(box.h / step) + 1;
    const img = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
    const N = gw * gh;
    const play = new Float32Array(N), base = new Float32Array(N);
    const noise = makeNoise(hole.index * 97 + 3);
    const sea = hole.water.some((w) => w.sea);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const x = box.x + i * step, y = box.y + j * step;
        const o = (Math.max(0, Math.min(mask.height - 1, Math.floor(y - box.y))) * mask.width + Math.max(0, Math.min(mask.width - 1, Math.floor(x - box.x)))) * 4;
        const Rr = img[o], G = img[o + 1], B = img[o + 2];
        const k = j * gw + i;
        play[k] = Rr > 30 || G > 128 || B > 128 ? 1 : 0;
        let h = 0;
        if (Rr > 200) h = -0.2;
        else if (B > 128) h = sea ? -3.5 : -1.2;
        else if (G < 128 && Rr > 30) h = (noise(x / 9, y / 9) - 0.5) * 0.6;
        base[k] = h;
      }
    }
    // Gaussian-ish blur: three passes of a separable running-sum box blur
    // with radius r grid cells (clamped at the edges).
    const blur = (a, r) => {
      if (r < 1) return;
      const t = new Float32Array(N);
      const line = (src, dst, n, stride, base) => {
        let acc = 0;
        const at = (q) => src[base + Math.max(0, Math.min(n - 1, q)) * stride];
        for (let q = -r; q <= r; q++) acc += at(q);
        for (let q = 0; q < n; q++) {
          dst[base + q * stride] = acc / (2 * r + 1);
          acc += at(q + r + 1) - at(q - r);
        }
      };
      for (let pass = 0; pass < 3; pass++) {
        for (let j = 0; j < gh; j++) line(a, t, gw, 1, j * gw);
        for (let i = 0; i < gw; i++) line(t, a, gh, gw, i);
      }
    };
    blur(play, Math.round(4 / step));
    const H = new Float32Array(N);
    const t = hole.tee;
    // The lie of the land: an elevation profile along the hole (spec.elev,
    // [[yards along the line, height], ...]) lifts or drops everything
    // around it, so 10 falls away from the tee and 18 climbs to the green.
    const elev = hole.elev || (hole.spec && hole.spec.elev);
    const hasLand = elev || (hole.mounds && hole.mounds.length);
    const E = new Float32Array(N);
    let eMean = 0;
    if (hasLand) {
      const at = (sv) => {
        if (!elev) return 0;
        if (sv <= elev[0][0]) return elev[0][1];
        for (let q = 1; q < elev.length; q++) {
          if (sv <= elev[q][0]) {
            const a = elev[q - 1], b = elev[q], u = (sv - a[0]) / (b[0] - a[0] || 1);
            return a[1] + (b[1] - a[1]) * (u * u * (3 - 2 * u));
          }
        }
        return elev[elev.length - 1][1];
      };
      // Distance along the line on a coarse grid, then smoothed onto the grid.
      const C = 4, cw = Math.ceil(box.w / C) + 2, ch = Math.ceil(box.h / C) + 2;
      const ce = new Float32Array(cw * ch);
      for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) ce[j * cw + i] = hole.heightAt ? hole.heightAt(box.x + i * C, box.y + j * C) : at(hole.nearest(box.x + i * C, box.y + j * C)[1]);
      for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
          const fx = (i * step) / C, fy = (j * step) / C;
          const ci = Math.min(cw - 2, Math.floor(fx)), cj = Math.min(ch - 2, Math.floor(fy)), u = fx - ci, v = fy - cj, c = cj * cw + ci;
          E[j * gw + i] = (ce[c] * (1 - u) + ce[c + 1] * u) * (1 - v) + (ce[c + cw] * (1 - u) + ce[c + cw + 1] * u) * v;
        }
      }
      blur(E, Math.round(3 / step));
      // Ponds lie flat: level the land under each one (and its banks) to the
      // pond's average height, so the water sits in a basin, not on a slope.
      for (const wt of hole.water) {
        if (wt.line) continue; // creeks run downhill with the land
        const c = Math.cos(-(wt.rot || 0)), sn = Math.sin(-(wt.rot || 0)), grow = 8;
        const at = (x, y, g) => {
          const dx = x - wt.x, dy = y - wt.y;
          const u = (dx * c - dy * sn) / (wt.rx + g), v = (dx * sn + dy * c) / (wt.ry + g);
          return u * u + v * v;
        };
        const i0 = Math.max(0, Math.floor((wt.x - wt.rx - wt.ry - grow - box.x) / step)), i1 = Math.min(gw - 1, Math.ceil((wt.x + wt.rx + wt.ry + grow - box.x) / step));
        const j0 = Math.max(0, Math.floor((wt.y - wt.rx - wt.ry - grow - box.y) / step)), j1 = Math.min(gh - 1, Math.ceil((wt.y + wt.rx + wt.ry + grow - box.y) / step));
        let sum = 0, n = 0;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (at(box.x + i * step, box.y + j * step, 0) <= 1) { sum += E[j * gw + i]; n++; }
        if (!n) continue;
        const level = sum / n;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const x = box.x + i * step, y = box.y + j * step;
            if (at(x, y, 0) <= 1) { E[j * gw + i] = level; continue; }
            // Ease back into the slope over the banks.
            const q = Math.sqrt(at(x, y, grow));
            if (q >= 1) continue;
            const r0 = Math.sqrt(at(x, y, 0)), t = Math.min(1, (r0 - 1) / Math.max(1e-3, r0 / q - 1)) || 0;
            const w = 1 - t * t * (3 - 2 * t);
            E[j * gw + i] += (level - E[j * gw + i]) * w;
          }
        }
      }
      for (let k = 0; k < N; k++) eMean += E[k];
      eMean /= N;
    }
    // Augusta rolls gently into the woods; elsewhere the land rises at the edges.
    this.edgeZ = (L.aug ? 1.5 : EDGE) + eMean;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        const x = box.x + i * step, y = box.y + j * step;
        const far = Math.pow(1 - Math.min(1, play[k] * 1.6), 1.4);
        const hills = L.aug
          ? far * far * (0.6 + 2.2 * noise(x / 70, y / 70) + 0.8 * noise(x / 22, y / 22))
          : far * (2.4 + 7 * noise(x / 80, y / 80) + 1.8 * noise(x / 24, y / 24)) * L.hillsH;
        const edge = Math.min(i, j, gw - 1 - i, gh - 1 - j) * step;
        const toEdge = Math.max(0, 1 - edge / 40);
        let h = base[k] + hills + E[k];
        h = h * (1 - toEdge) + this.edgeZ * toEdge;
        if (Math.hypot(x - t.x, y - t.y) < t.ry + 2) h += 0.35;
        H[k] = h;
      }
    }
    blur(H, Math.max(1, Math.round(1.5 / step)));
    // Bunkers: a proper bowl with a steep face and a grassy lip.
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const x = box.x + i * step, y = box.y + j * step;
        const d = sdAt(sd.S, x, y);
        if (d > 2) continue;
        const k = j * gw + i;
        // A smooth dish: a sharp drop at the edge saws up on the 1 yd mesh;
        // the shader's face lighting gives the crisp flashed edge instead.
        const t = Math.min(1, Math.max(0, -d) / 2.6);
        const bowl = -0.75 * t * t * (3 - 2 * t);
        const lip = d > 0 ? 0.16 * (1 - d / 2) : 0.16 * Math.max(0, 1 + d / 0.35);
        H[k] += bowl + lip; // relative to the lie of the land around it
      }
    }
    // The green's real contours (the same ones the putts roll on), a touch
    // exaggerated so the breaks read, easing out into the surrounds.
    const g = hole.green, sl = hole.slope;
    if (sl) {
      const c = Math.cos(-(g.rot || 0)), sn = Math.sin(-(g.rot || 0));
      const rx = g.rx + 3.6, ry = g.ry + 3.6;
      const elev = (x, y) => {
        let e = sl.tilt[0] * (x - g.x) + sl.tilt[1] * (y - g.y);
        for (const b of sl.bumps) {
          const dx = x - g.x - b.dx, dy = y - g.y - b.dy;
          e += b.h * Math.exp(-(dx * dx + dy * dy) / (b.r * b.r));
        }
        for (const t of sl.tiers || []) {
          const u = ((x - g.x - t.dx) * Math.cos(t.ang) + (y - g.y - t.dy) * Math.sin(t.ang)) / t.w;
          e += t.h * 0.5 * Math.tanh(u);
        }
        return e;
      };
      for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
          const x = box.x + i * step, y = box.y + j * step;
          const dx = x - g.x, dy = y - g.y;
          const u = dx * c - dy * sn, v = dx * sn + dy * c;
          const out = (Math.sqrt((u * u) / (rx * rx) + (v * v) / (ry * ry)) - 1) * Math.min(rx, ry);
          if (out > 9) continue;
          const k = Math.max(0, Math.min(1, out / 9));
          H[j * gw + i] += elev(x, y) * 1.5 * (1 - k * k * (3 - 2 * k));
        }
      }
    }
    this.grid = { H, E, gw, gh, step, x: box.x, y: box.y };

    const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        pos[k * 3] = box.x + i * step;
        pos[k * 3 + 1] = box.y + j * step;
        pos[k * 3 + 2] = H[k];
        uv[k * 2] = (i * step) / box.w;
        uv[k * 2 + 1] = 1 - (j * step) / box.h;
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    // Normals straight from the height grid (central differences).
    const nrm = new Float32Array(N * 3);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        const hx = H[j * gw + Math.min(gw - 1, i + 1)] - H[j * gw + Math.max(0, i - 1)];
        const hy = H[Math.min(gh - 1, j + 1) * gw + i] - H[Math.max(0, j - 1) * gw + i];
        const nx = -hx / (2 * step), ny = -hy / (2 * step), l = Math.hypot(nx, ny, 1);
        nrm[k * 3] = nx / l;
        nrm[k * 3 + 1] = ny / l;
        nrm[k * 3 + 2] = 1 / l;
      }
    }
    geo.setAttribute('normal', new T.BufferAttribute(nrm, 3));

    const maxTex = Math.min(this.renderer.capabilities.maxTextureSize, 4096);
    const px = Math.min(4, maxTex / Math.max(box.w, box.h));
    const turf = new T.CanvasTexture(paintTurf(hole, box, px, L));
    this.turfTex = turf;
    turf.colorSpace = T.SRGBColorSpace;
    turf.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    turf.generateMipmaps = true;
    turf.minFilter = T.LinearMipmapLinearFilter;
    this.holeTextures.push(turf);
    // Crisp surfaces from signed distances (see buildCourseSDF).
    const half = new Uint16Array(sd.W * sd.H * 4), halfS = new Uint16Array(sd.W * sd.H);
    for (let k = 0; k < sd.W * sd.H; k++) {
      half[k * 4] = toHalf(sd.F[k]);
      half[k * 4 + 1] = toHalf(sd.G[k]);
      half[k * 4 + 2] = toHalf(sd.S[k]);
      half[k * 4 + 3] = toHalf(sd.Wd[k]);
      halfS[k] = toHalf(sd.along[k]);
    }
    const sdfTex = new T.DataTexture(half, sd.W, sd.H, T.RGBAFormat, T.HalfFloatType);
    const alongTex = new T.DataTexture(halfS, sd.W, sd.H, T.RedFormat, T.HalfFloatType);
    for (const t of [sdfTex, alongTex]) {
      t.minFilter = t.magFilter = T.LinearFilter;
      t.needsUpdate = true;
      this.holeTextures.push(t);
    }
    this.sdf = sd;
    const tee = hole.tee, gr = hole.green;
    const col = (c) => new T.Color(c);
    const mat = new T.MeshLambertMaterial({ map: turf });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.detU, {
        uSdf: { value: sdfTex }, uAlong: { value: alongTex },
        uBox: { value: new T.Vector4(box.x, box.y, box.w, box.h) },
        uTee: { value: new T.Vector4(tee.x, tee.y, tee.rot, 0) }, uTeeR: { value: new T.Vector2(tee.rx, tee.ry) },
        uGreen: { value: new T.Vector3(gr.x, gr.y, (gr.rot || 0) + 0.6) },
        uFw: { value: new T.Vector2(hole.fwFrom, hole.fwFrom < hole.fwTo ? 1 : 0) },
        cFair: { value: col(L.fairway) }, cFair2: { value: col(L.fairway2) }, cFringe: { value: col(L.fringe) },
        cGreen: { value: col(L.green) }, cGreen2: { value: col(L.green2) }, cSand: { value: col(L.sand) },
        cLip: { value: col(L.sandLip) }, cBed: { value: col(L.bed) }, cRock: { value: col(L.rock || L.sandLip) },
        uSea: { value: hole.water.some((w) => w.sea) ? 1 : 0 }, uAug: { value: L.aug ? 1 : 0 },
        cStraw: { value: col(L.straw || L.sandLip) },
      });
      sh.vertexShader = 'varying vec3 vWP; varying vec3 vWN;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = `varying vec3 vWP; varying vec3 vWN;
        uniform sampler2D uSdf, uAlong;
        uniform vec4 uBox, uTee; uniform vec2 uTeeR, uFw; uniform vec3 uGreen;
        uniform vec3 cFair, cFair2, cFringe, cGreen, cGreen2, cSand, cLip, cBed, cRock, cStraw; uniform float uSea, uAug;
        uniform sampler2D uDFairA, uDFairN, uDGreenA, uDGreenN, uDRoughA, uDRoughN, uDSandA, uDSandN, uDSoilA, uDSoilN, uDMacro;
        uniform float uDetOn;
        float inside(float d) { float w = max(fwidth(d) * 0.75, 0.003); return 1.0 - smoothstep(-w, w, d); }
        mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
        // Two differently scaled and rotated lookups, switched by a slow
        // noise, so tiling never lines up.
        vec4 det(sampler2D t, vec2 p, float size, float sel) {
          if (sel < 0.02) return texture2D(t, p / size);
          vec4 b = texture2D(t, rot2(1.1) * p / (size * 1.37) + vec2(0.37, 0.71));
          if (sel > 0.98) return b;
          return mix(texture2D(t, p / size), b, sel);
        }
        ` + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec2 suv = (vWP.xy - uBox.xy) / uBox.zw;
          vec4 sdv = texture2D(uSdf, suv);
          float dF = sdv.r, dG = sdv.g, dS = sdv.b, dW = sdv.a;
          vec2 tq = rot2(-uTee.z) * (vWP.xy - uTee.xy);
          vec2 tb = abs(tq) - uTeeR + 1.0;
          float dT = length(max(tb, 0.0)) + min(max(tb.x, tb.y), 0.0) - 1.0;
          vec3 col = diffuseColor.rgb;
          // Fairway: a darker first cut, then broad mown stripes across the line.
          float alongS = texture2D(uAlong, suv).r;
          float su = (alongS - uFw.x + 30.0) / 9.0;
          float sw = clamp(fwidth(su) * 1.5, 0.02, 0.5);
          float stripe = smoothstep(0.5 - sw, 0.5 + sw, abs(fract(su * 0.5) - 0.5) * 2.0);
          if (uAug > 0.5) {
            // Augusta mows from green to tee: long passes that follow the
            // fairway's shape, light and dark only by a whisker.
            float pu = -dF / 4.2;
            float pw = clamp(fwidth(pu) * 1.5, 0.02, 0.5);
            float pass = smoothstep(0.5 - pw, 0.5 + pw, abs(fract(pu * 0.5) - 0.5) * 2.0);
            stripe = mix(pass, stripe, 0.18) * 0.55;
          }
          col = mix(col, cFair2 * (uAug > 0.5 ? 0.9 : 0.96), inside(dF - (uAug > 0.5 ? 2.2 : 1.2)) * uFw.y);
          float wFair = inside(dF) * uFw.y;
          col = mix(col, mix(cFair, cFair2, stripe), wFair);
          // Tee box with fine stripes.
          float tu = tq.y / 3.0, tw = clamp(fwidth(tu) * 1.5, 0.02, 0.5);
          float tst = smoothstep(0.5 - tw, 0.5 + tw, abs(fract(tu) - 0.5) * 2.0);
          float wTee = inside(dT);
          col = mix(col, mix(cFair, cFair2, tst), wTee);
          wFair = max(wFair, wTee);
          // Water beds with a sandy or rocky margin.
          float wBank = inside(dW - (uSea > 0.5 ? 4.0 : 1.2));
          col = mix(col, uSea > 0.5 ? cRock : cLip, wBank);
          float wBed = inside(dW);
          col = mix(col, cBed, wBed);
          // Fringe, then the green with a checkerboard cut.
          float wFringe = inside(dG - 2.6);
          col = mix(col, cFringe, wFringe);
          vec2 gq = rot2(-uGreen.z) * (vWP.xy - uGreen.xy) / 2.5;
          float chk = sin(gq.x * 3.14159) * sin(gq.y * 3.14159);
          float cw = clamp(fwidth(chk) * 1.5, 0.02, 1.0);
          float checker = smoothstep(-cw, cw, chk);
          if (uAug > 0.5) {
            float gu = gq.x * 0.8;
            float gw2 = clamp(fwidth(gu) * 1.5, 0.02, 0.5);
            checker = 0.35 + 0.3 * smoothstep(0.5 - gw2, 0.5 + gw2, abs(fract(gu * 0.5) - 0.5) * 2.0);
          }
          float wGreen = inside(dG);
          col = mix(col, mix(cGreen, cGreen2, checker), wGreen);
          wFringe -= wGreen;
          // Bunkers: a dark lip, then sand that brightens toward the middle.
          // Augusta's bunkers are flashed right up to a clean grass edge.
          col = mix(col, cLip, inside(dS - 0.55) * (1.0 - uAug * 0.85));
          float wSand = inside(dS);
          vec3 sandCol = mix(cSand * vec3(0.9, 0.84, 0.72), cSand * vec3(1.1, 1.04, 0.9), smoothstep(0.0, 2.5, -dS));
          if (uAug > 0.5) sandCol = cSand * mix(0.93, 1.03, smoothstep(0.0, 1.8, -dS));
          // The face of each bunker: sloping up to the lip, lit by the sun.
          vec2 sGrad = vec2(0.0);
          if (abs(dS) < 3.0) {
            vec2 e = vec2(0.5 / uBox.z, 0.0), f = vec2(0.0, 0.5 / uBox.w);
            sGrad = vec2(texture2D(uSdf, suv + e).b - texture2D(uSdf, suv - e).b, texture2D(uSdf, suv + f).b - texture2D(uSdf, suv - f).b);
          }
          float face = wSand * (1.0 - smoothstep(0.0, 2.4, -dS));
          col = mix(col, sandCol, wSand);
          // Grass banks around bunkers and greens catch a little shade.
          col *= 1.0 - 0.12 * (inside(dS - 1.6) - inside(dS)) * (1.0 - wGreen);
          float wStraw = uAug * smoothstep(0.0, 0.06, diffuseColor.r - diffuseColor.g * 0.92) * (1.0 - wFair) * (1.0 - wSand) * (1.0 - wBed);
          // Needles keep the painted shade under the trees.
          if (wStraw > 0.002) {
            float sh = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)) / max(dot(cStraw, vec3(0.3, 0.59, 0.11)), 0.01);
            vec3 sa = det(uDSoilA, vWP.xy, 2.5, smoothstep(0.42, 0.58, texture2D(uDMacro, vWP.xy / 23.0 + 0.5).r)).rgb;
            sa = mix(sa, vec3(dot(sa, vec3(0.3, 0.59, 0.11))), 0.25) * vec3(0.82, 0.8, 0.82);
            col = mix(col, sa * clamp(sh, 0.3, 1.1), wStraw);
          }
          diffuseColor.rgb = col;

          // Crisp detail textures on every surface, fading with distance.
          float dCam = distance(cameraPosition, vWP);
          float macro = texture2D(uDMacro, vWP.xy / 61.0).r;
          float sel = smoothstep(0.42, 0.58, texture2D(uDMacro, vWP.xy / 23.0 + 0.5).r);
          float wRough = clamp(1.0 - wFair - wGreen - max(wFringe, 0.0) - wSand - wBed - wStraw, 0.0, 1.0);
          vec4 dA = vec4(0.5), dN = vec4(0.5, 0.5, 1.0, 1.0);
          // Detail only where it can be seen; normal maps only up close.
          bool nearN = dCam < 140.0;
          if (uDetOn > 0.5 && dCam < 220.0) {
            dA = vec4(0.0);
            if (nearN) dN = vec4(0.0);
            float wf = wFair + max(wFringe, 0.0);
            if (wf > 0.002) {
              dA += wf * det(uDFairA, vWP.xy, 1.1, sel); if (nearN) dN += wf * det(uDFairN, vWP.xy, 1.1, sel);
            }
            if (wGreen > 0.002) { dA += wGreen * det(uDGreenA, vWP.xy, 0.9, sel); if (nearN) dN += wGreen * det(uDGreenN, vWP.xy, 0.9, sel); }
            if (wRough > 0.002) { dA += wRough * det(uDRoughA, vWP.xy, 1.8, sel); if (nearN) dN += wRough * det(uDRoughN, vWP.xy, 1.8, sel); }
            if (wSand > 0.002) {
              float ss = uAug > 0.5 ? 1.6 : 2.0;
              dA += wSand * det(uDSandA, vWP.xy, ss, sel); if (nearN) dN += wSand * det(uDSandN, vWP.xy, ss, sel);
            }
            if (wStraw > 0.002) { dA += wStraw * vec4(0.5); if (nearN) dN += wStraw * det(uDSoilN, vWP.xy, 2.5, sel); }
            // At Augusta the soil slot holds pine straw, so lake beds go plain.
            if (wBed > 0.002) {
              if (uAug > 0.5) { dA += wBed * vec4(0.5); if (nearN) dN += wBed * vec4(0.5, 0.5, 1.0, 1.0); }
              else { dA += wBed * det(uDSoilA, vWP.xy, 3.0, sel); if (nearN) dN += wBed * det(uDSoilN, vWP.xy, 3.0, sel); }
            }
          }
          // A coarser pass of the same grass so the mid-distance isn't flat.
          if (uDetOn > 0.5 && dCam > 4.0 && dCam < 160.0) {
            float wg = 1.0 - wSand - wBed - wStraw;
            vec2 mp = rot2(0.7) * vWP.xy / 6.3;
            vec3 midA = mix(texture2D(uDFairA, mp).rgb, texture2D(uDRoughA, mp).rgb, wRough);
            dA.rgb = mix(dA.rgb, dA.rgb * midA * 2.0, 0.6 * wg * smoothstep(4.0, 18.0, dCam));
          }
          float detFade = 1.0 - smoothstep(60.0, 220.0, dCam);
          diffuseColor.rgb *= mix(vec3(1.0), dA.rgb * 2.0, detFade) * (1.0 + (macro - 0.5) * (0.25 + 0.3 * wRough));
          vec3 tN = dN.xyz * 2.0 - 1.0;
          float nStr = (0.6 + 0.4 * wRough + 0.9 * wSand + 0.8 * wStraw) * (1.0 - smoothstep(30.0, 140.0, dCam));
          vec3 wN = normalize(vWN + (vec3(1.0, 0.0, 0.0) * tN.x + vec3(0.0, 1.0, 0.0) * tN.y) * nStr);
          // Bunker faces tilt toward the middle; the gradient points outward.
          if (face > 0.0) {
            float gl = length(sGrad);
            if (gl > 1e-4) wN = normalize(wN - vec3(sGrad / gl, 0.0) * face * 0.9);
          }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(mat3(viewMatrix) * wN);`)
;
    };
    mat.customProgramCacheKey = () => 'pl-terrain';
    // Split into tiles that share the vertex data, so the GPU skips any part
    // of the course that's off screen.
    const TILE = 40;
    for (let tj = 0; tj < gh - 1; tj += TILE) {
      for (let ti = 0; ti < gw - 1; ti += TILE) {
        const i1 = Math.min(gw - 1, ti + TILE), j1 = Math.min(gh - 1, tj + TILE);
        const idx = new Uint32Array((i1 - ti) * (j1 - tj) * 6);
        let o = 0, zmin = Infinity, zmax = -Infinity;
        for (let j = tj; j < j1; j++) {
          for (let i = ti; i < i1; i++) {
            const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
            idx[o++] = a; idx[o++] = b; idx[o++] = d;
            idx[o++] = a; idx[o++] = d; idx[o++] = c;
            zmin = Math.min(zmin, H[a]); zmax = Math.max(zmax, H[a]);
          }
        }
        const tg = new T.BufferGeometry();
        for (const k of ['position', 'uv', 'normal']) tg.setAttribute(k, geo.attributes[k]);
        tg.setIndex(new T.BufferAttribute(idx, 1));
        const x0 = box.x + ti * step, y0 = box.y + tj * step, x1 = box.x + i1 * step, y1 = box.y + j1 * step;
        tg.boundingSphere = new T.Sphere(new T.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (zmin + zmax) / 2), Math.hypot(x1 - x0, y1 - y0, zmax - zmin) / 2 + 1);
        tg.boundingBox = new T.Box3(new T.Vector3(x0, y0, zmin - 1), new T.Vector3(x1, y1, zmax + 1));
        const mesh = new T.Mesh(tg, mat);
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
    this.terrainMat = mat;

    // The land beyond: a frame around the course area.
    const big = 6000, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const outer = new T.MeshLambertMaterial({ color: L.ob });
    const bx0 = box.x, by0 = box.y, bx1 = box.x + box.w, by1 = box.y + box.h;
    for (const [x0, y0, x1, y1] of [[cx - big, cy - big, cx + big, by0], [cx - big, by1, cx + big, cy + big], [cx - big, by0, bx0, by1], [bx1, by0, cx + big, by1]]) {
      const pl = new T.Mesh(new T.PlaneGeometry(x1 - x0, y1 - y0), outer);
      pl.position.set((x0 + x1) / 2, (y0 + y1) / 2, this.edgeZ - 0.05);
      pl.receiveShadow = true;
      group.add(pl);
    }
  }

  buildSky(L, group, hole) {
    const T = this.T;
    const r = seeded(hole.index * 7 + 2);
    const skyMat = new T.ShaderMaterial({
      uniforms: {
        uTop: { value: new T.Color(L.skyTop) }, uHorizon: { value: new T.Color(L.skyHorizon) }, uSun: { value: this.sunDir }, uSunCol: { value: new T.Color(L.sun) },
        uClouds: this.cloudsU, uCloudAmt: { value: Math.min(1, 0.45 + L.cloud * 0.35) }, uCloudRot: { value: r() }, uTime: this.timeU,
      },
      vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunCol; varying vec3 vD;
        uniform sampler2D uClouds; uniform float uCloudAmt, uCloudRot, uTime;
        void main() {
          vec3 d = normalize(vD);
          float e = clamp(d.z, 0.0, 1.0);
          vec3 c = mix(uHorizon, uTop, pow(e, 0.45));
          float s = max(dot(d, uSun), 0.0);
          c += uSunCol * (pow(s, 900.0) * 6.0 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
          // Painted cloud band: azimuth across, 0-40 degrees up.
          float el = asin(clamp(d.z, 0.0, 1.0)) / 0.698;
          if (el < 1.0) {
            float az = atan(d.y, d.x) / 6.2831853 + 0.5 + uCloudRot + uTime * 0.0004;
            vec4 cl = texture2D(uClouds, vec2(az, el));
            float lit = pow(s, 4.0);
            vec3 cc = cl.rgb * mix(vec3(1.0), uSunCol, 0.35) * (1.0 + lit * 0.5);
            cc = mix(cc, uHorizon * 1.05, (1.0 - el) * 0.25);
            c = mix(c, cc, cl.a * uCloudAmt * smoothstep(0.0, 0.04, el));
          }
          if (vD.z < 0.0) c = uHorizon;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: T.BackSide, depthWrite: false, fog: false,
    });
    const sky = new T.Mesh(new T.SphereGeometry(3000, 48, 24), skyMat);
    sky.userData.ownMat = true;
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.sky = sky;
    group.add(sky);

    // Rounded hills on the horizon.
    const cx = this.box.x + this.box.w / 2, cy = this.box.y + this.box.h / 2;
    const hillMat = new T.MeshLambertMaterial({ color: 0xffffff });
    const hills = new T.InstancedMesh(new T.SphereGeometry(1, 28, 14), hillMat, 44);
    const m = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), p = new T.Vector3();
    const col = new T.Color();
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * TAU + r() * 0.1, d = 1300 + r() * 900;
      const rx = 180 + r() * 260, rz = (40 + r() * 90) * (0.4 + L.hillsH * 0.6);
      sc.set(rx, rx * (0.6 + r() * 0.5), rz);
      p.set(cx + Math.cos(a) * d, cy + Math.sin(a) * d, (this.edgeZ ?? EDGE) - rz * 0.35);
      q.setFromAxisAngle(new T.Vector3(0, 0, 1), r() * TAU);
      m.compose(p, q, sc);
      hills.setMatrixAt(i, m);
      hills.setColorAt(i, col.set(L.hills[i % L.hills.length]));
    }
    group.add(hills);
  }

  buildWater(mask, L, group) {
    const T = this.T;
    const tex = this.maskTex;
    const box = this.box;
    // A soft "distance from the shore" field: the water mask blurred, so the
    // shader knows the shallows from the deep and where to draw the surf.
    const W = mask.width, Hh = mask.height;
    const src = mask.getContext('2d').getImageData(0, 0, W, Hh).data;
    let f = new Float32Array(W * Hh);
    let any = false;
    for (let i = 0; i < W * Hh; i++) {
      f[i] = src[i * 4 + 2] > 128 ? 1 : 0;
      if (f[i]) any = true;
    }
    if (!any) return;
    const tmp = new Float32Array(W * Hh);
    const blur1 = (a, out, rad, horiz) => {
      const n = horiz ? W : Hh, m = horiz ? Hh : W;
      for (let j = 0; j < m; j++) {
        let acc = 0;
        const at = (i) => a[horiz ? j * W + i : i * W + j];
        for (let i = -rad; i <= rad; i++) acc += at(Math.max(0, Math.min(n - 1, i)));
        for (let i = 0; i < n; i++) {
          out[horiz ? j * W + i : i * W + j] = acc / (rad * 2 + 1);
          acc += at(Math.min(n - 1, i + rad + 1)) - at(Math.max(0, i - rad));
        }
      }
    };
    for (let pass = 0; pass < 3; pass++) {
      blur1(f, tmp, 5, true);
      blur1(tmp, f, 5, false);
    }
    const bytes = new Uint8Array(W * Hh);
    for (let i = 0; i < W * Hh; i++) bytes[i] = Math.round(f[i] * 255);
    // Rows run from box.y down, like the canvas: flip to match the mask's UVs.
    const shore = new T.DataTexture(bytes, W, Hh, T.RedFormat, T.UnsignedByteType);
    shore.flipY = false;
    shore.minFilter = shore.magFilter = T.LinearFilter;
    shore.needsUpdate = true;
    this.holeTextures.push(shore);
    const sea = this.hole.water.some((w) => w.sea);
    const mat = new T.ShaderMaterial({
      uniforms: {
        uMask: { value: tex }, uShore: { value: shore }, uBox: { value: new T.Vector4(box.x, box.y, box.w, box.h) }, uTime: this.timeU,
        uShallow: { value: new T.Color(L.water) }, uDeep: { value: new T.Color(L.deepWater) }, uSky: { value: new T.Color(L.skyHorizon) }, uSkyTop: { value: new T.Color(L.skyTop) },
        uSun: { value: this.sunDir }, uSunCol: { value: new T.Color(L.sun) }, uSea: { value: sea ? 1 : 0 },
        uFog: { value: new T.Color(L.skyHorizon) }, uFogRange: { value: new T.Vector2(L.fogNear, L.fogFar) },
        tRefl: { value: null }, textureMatrix: { value: new T.Matrix4() }, uRefl: { value: 0 },
      },
      vertexShader: `uniform mat4 textureMatrix; varying vec3 vW; varying vec4 vRefl;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vRefl = textureMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D uMask; uniform sampler2D uShore; uniform vec4 uBox; uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSkyTop;
        uniform vec3 uSun; uniform vec3 uSunCol; uniform float uSea; uniform vec3 uFog; uniform vec2 uFogRange; varying vec3 vW;
        uniform sampler2D tRefl; uniform float uRefl; varying vec4 vRefl;
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec2 uv = (vW.xy - uBox.xy) / uBox.zw;
          float edge = texture2D(uMask, vec2(uv.x, 1.0 - uv.y)).b;
          float m = texture2D(uShore, uv).r;
          float a = smoothstep(0.3, 0.55, edge);
          if (a < 0.01) discard;
          float d = distance(cameraPosition, vW);
          float nearW = 1.0 - smoothstep(25.0, 200.0, d);
          vec2 p = vW.xy;
          float t = uTime;
          // Two layers of drifting ripples, plus long swells at sea.
          vec2 n = vec2(vn(p * 0.35 + vec2(t * 0.22, t * 0.08)) - 0.5, vn(p * 0.37 + vec2(3.0, 7.0) - t * 0.18) - 0.5) * 0.5
                 + vec2(vn(p * 1.4 - t * 0.5) - 0.5, vn(p * 1.5 + vec2(5.0, 1.0) + t * 0.45) - 0.5) * 0.3 * nearW;
          n += uSea * vec2(sin(m * 30.0 - t * 1.3), cos(m * 26.0 - t * 1.1)) * 0.12;
          vec3 N = normalize(vec3(n, 1.0));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
          // Colour by depth: bright turquoise shallows to rich deep blue.
          float depth = smoothstep(0.45, 0.95, m);
          vec3 shallow = uShallow * 1.25 + vec3(0.02, 0.08, 0.06);
          vec3 col = mix(shallow, uDeep * 0.8, depth);
          // Caustic light dancing on the shallow bed.
          float c1 = 1.0 - abs(vn(p * 0.9 + vec2(t * 0.3, -t * 0.2)) * 2.0 - 1.0);
          float c2 = 1.0 - abs(vn(p * 1.3 - vec2(t * 0.25, t * 0.15) + 9.0) * 2.0 - 1.0);
          col += vec3(0.55, 0.75, 0.7) * pow(c1 * c2, 6.0) * (1.0 - depth) * 0.6 * nearW;
          // Sky in the surface.
          vec3 R = reflect(-V, N);
          vec3 sky = mix(uSky, uSkyTop, clamp(R.z * 1.5, 0.0, 1.0));
          if (uRefl > 0.5) {
            // The real scene mirrored in the surface, wobbled by the ripples.
            vec4 rp = vRefl;
            rp.xy += n * rp.w * (0.3 + 0.7 * nearW) * 0.022;
            sky = texture2DProj(tRefl, rp).rgb;
          }
          col = mix(col, sky, clamp(0.16 + fres * 0.7, 0.0, 0.8));
          // Sun: a soft sheen and crisp cartoon glints.
          float sp = max(dot(R, uSun), 0.0);
          col += uSunCol * (pow(sp, 60.0) * 0.5 + step(0.992, sp) * 1.6 * (0.3 + 0.7 * nearW));
          float glint = step(0.93, vn(p * 2.4 + vec2(t * 0.9, -t * 0.7))) * step(0.5, vn(p * 0.5 - t * 0.1)) * nearW;
          col += vec3(glint * 0.8);
          // Surf: a bright line along the shore and bands rolling in.
          float shoreLine = 1.0 - smoothstep(0.0, 0.12, abs(m - 0.5 + 0.03 * sin(t * 1.4 + p.x * 0.3)));
          float bands = smoothstep(0.75, 0.95, sin((1.0 - m) * (28.0 + uSea * 10.0) + t * (1.6 + uSea * 0.6) + vn(p * 0.2) * 4.0))
                      * (1.0 - smoothstep(0.5, 0.72 + uSea * 0.12, m)) * step(0.35, vn(p * 0.6 + t * 0.1));
          float foam = max(shoreLine * 0.9, bands * 0.75 * (0.15 + 0.85 * nearW)) * (0.6 + 0.4 * nearW);
          col = mix(col, vec3(1.0), foam);
          float fogF = clamp((d - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
          col = mix(col, uFog, fogF);
          gl_FragColor = vec4(col, a * mix(0.82, 0.97, depth));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    // The surface only covers the water itself, so it (and its mirror pass)
    // is skipped whenever no water is in view.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const wt of this.hole.water) {
      if (wt.line) {
        for (const [px, py] of wt.line) {
          x0 = Math.min(x0, px - wt.w); y0 = Math.min(y0, py - wt.w);
          x1 = Math.max(x1, px + wt.w); y1 = Math.max(y1, py + wt.w);
        }
      } else {
        const rr = Math.max(wt.rx, wt.ry) + 2;
        x0 = Math.min(x0, wt.x - rr); y0 = Math.min(y0, wt.y - rr);
        x1 = Math.max(x1, wt.x + rr); y1 = Math.max(y1, wt.y + rr);
      }
    }
    x0 = Math.max(x0, box.x); y0 = Math.max(y0, box.y);
    x1 = Math.min(x1, box.x + box.w); y1 = Math.min(y1, box.y + box.h);
    // The surface follows the lie of the land: flat on the (levelled) ponds,
    // stepping down with the creeks, always just below the banks.
    const g = this.grid, E = g.E;
    const segX = Math.min(240, Math.max(1, Math.ceil((x1 - x0) / 2))), segY = Math.min(240, Math.max(1, Math.ceil((y1 - y0) / 2)));
    const geo = new T.PlaneGeometry(x1 - x0, y1 - y0, segX, segY);
    let zMid = 0;
    if (E) {
      const eAt = (x, y) => {
        const fx = Math.max(0, Math.min(g.gw - 1.001, (x - g.x) / g.step)), fy = Math.max(0, Math.min(g.gh - 1.001, (y - g.y) / g.step));
        const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, k = j * g.gw + i;
        return (E[k] * (1 - u) + E[k + 1] * u) * (1 - v) + (E[k + g.gw] * (1 - u) + E[k + g.gw + 1] * u) * v;
      };
      const pa = geo.attributes.position, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      zMid = eAt(cx, cy);
      for (let k = 0; k < pa.count; k++) pa.setZ(k, eAt(cx + pa.getX(k), cy + pa.getY(k)) - zMid);
      geo.computeBoundingSphere();
    }
    // A planar mirror renders the scene (minus the grass) for reflections;
    // only on High, at reduced resolution.
    const size = new T.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const w = new T.Reflector(geo, { textureWidth: Math.round(size.x * 0.4), textureHeight: Math.round(size.y * 0.4), clipBias: 0.02, multisample: 0 });
    const own = w.material;
    mat.uniforms.tRefl.value = own.uniforms.tDiffuse.value;
    mat.uniforms.textureMatrix = own.uniforms.textureMatrix;
    w.material = mat;
    own.dispose();
    const reflect = w.onBeforeRender;
    w.onBeforeRender = (...args) => {
      const on = this.quality >= 2;
      mat.uniforms.uRefl.value = on ? 1 : 0;
      if (on) reflect.apply(w, args);
    };
    this.reflector = w;
    w.position.set((x0 + x1) / 2, (y0 + y1) / 2, zMid - 0.12);
    w.userData.ownMat = true;
    w.renderOrder = 2;
    group.add(w);
  }

  buildTrees(hole, L, group) {
    const T = this.T;
    const r = seeded(hole.index * 13 + 5);
    const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), zAxis = new T.Vector3(0, 0, 1);
    const col = new T.Color();
    // The bark texture carries the colour; the course's trunk colour just tints it.
    const trunkCol = new T.Color(L.trunk);
    trunkCol.multiplyScalar(0.92 / Math.max(trunkCol.r, trunkCol.g, trunkCol.b)).lerp(new T.Color(1, 1, 1), 0.35);
    // Each kind has a detailed model for nearby trees and a cheap one for the
    // rest; updateTrees() sorts them as the camera moves.
    this.treeKindsLive = [];
    const lists = {};
    hole.trees.forEach((t) => {
      let kind = t.pine ? 'pine' : t.palm ? 'palm' : t.cypress ? 'cypress' : r() < 0.5 ? 'oak' : 'oak2';
      if (L.aug) {
        // Augusta: tall loblollies, with dogwoods, magnolias and the like
        // where the course data plants them.
        const sp = { dogwood: 'dogwood', cherry: 'dogwood', magnolia: 'magnolia', holly: 'magnolia' }[t.kind];
        kind = sp || (t.pine ? (r() < 0.5 ? 'loblolly' : 'loblolly2') : kind);
      }
      if (!this.treeKinds[kind]) kind = 'oak';
      (lists[kind] = lists[kind] || []).push(t);
    });
    for (const [kind, list] of Object.entries(lists)) {
      const g = this.treeKinds[kind];
      const mk = (geo, mat) => {
        const im = new T.InstancedMesh(geo, mat, list.length);
        im.userData.shared = true;
        im.castShadow = im.receiveShadow = true;
        im.frustumCulled = false;
        im.count = 0;
        im.setColorAt(0, col.set(1, 1, 1));
        group.add(im);
        return im;
      };
      const barkM = kind.startsWith('loblolly') ? this.barkLMat : this.barkMat;
      const live = {
        trunk: mk(g.trunk, barkM), near: mk(g.nearBody, this.bodyMat),
        cards: g.nearCards ? mk(g.nearCards, g.cardsMat === 'bloom' ? this.bloomMat : this.leafMat) : null,
        far: mk(g.far, g.farCards ? this.leafMat : this.bodyMat), items: [],
      };
      if (g.aspect) {
        // Augusta's woods run to a thousand trees a hole: mid-distance trees
        // get a plain trunk, and the furthest a baked billboard.
        const lod = this.treeLod(kind, g);
        live.trunkFar = mk(lod.trunkFar, barkM);
        live.imp = mk(lod.quads, lod.mat);
        live.imp.castShadow = true;
        live.impBake = { kind, g, barkM };
      }
      for (const t of list) {
        const h = t.h * (kind.startsWith('oak') ? 1.05 : 1);
        // Models built at true proportions say how wide they want to be.
        let width = kind === 'pine' ? t.r * 2.6 : kind === 'cypress' ? t.r * 2.3 : kind === 'palm' ? t.r * 2.2 : t.r * 2.3;
        if (g.aspect) width = Math.max(width * 0.8, h / g.aspect);
        p.set(t.x, t.y, this.heightAt(t.x, t.y) - 0.15);
        q.setFromAxisAngle(zAxis, r() * TAU);
        s.set(width * (0.92 + r() * 0.16), width * (0.92 + r() * 0.16), h);
        m.compose(p, q, s);
        const leaf = col.set(L.tree[Math.floor(r() * L.tree.length)]).multiplyScalar(0.88 + r() * 0.24);
        const bark = kind.startsWith('loblolly') ? [0.95, 0.92, 0.9] : [trunkCol.r, trunkCol.g, trunkCol.b];
        // Billboards are baked with the course's mean leaf colour.
        const mean = this.meanLeaf(L);
        const imp = [leaf.r / mean.r, leaf.g / mean.g, leaf.b / mean.b];
        live.items.push({ x: t.x, y: t.y, w: width, m: m.toArray(), leaf: [leaf.r, leaf.g, leaf.b], bark, imp });
      }
      this.treeKindsLive.push(live);
    }
    this.treeEye = null;
    this.bakeImpostors(L);

    // Azalea beds at Augusta, gorse at St Andrews.
    const bushes = [];
    for (const f of hole.flowers || []) {
      const n = Math.round(f.rx * f.ry * (L.aug ? 0.5 : 0.9));
      for (let i = 0; i < n; i++) {
        const a = r() * TAU, d = Math.sqrt(r());
        const u = Math.cos(a) * f.rx * d, v = Math.sin(a) * f.ry * d, rot = f.rot || 0;
        const x = f.x + u * Math.cos(rot) - v * Math.sin(rot), y = f.y + u * Math.sin(rot) + v * Math.cos(rot);
        bushes.push([x, y, 0.7 + r() * 0.6, ['#ff5fa2', '#e23a86', '#ff8fbf', '#ffffff', '#ff6f8a', '#d81b60'][Math.floor(r() * 6)]]);
      }
    }
    if (L.aug) {
      // Banks of azaleas among the pines; each bank keeps mostly one colour.
      const AZ = ['#ff4fa0', '#e2237f', '#ff7f9f', '#ffffff', '#f2545b', '#c2185b', '#ff9ec6'];
      for (const f of hole.species || []) {
        if (f.kind !== 'azalea') continue;
        const main = AZ[Math.floor(r() * AZ.length)];
        const n = Math.min(Math.round(f.rx * f.ry * 0.3), Math.max(f.n || 0, Math.round(f.rx * f.ry * 0.15)));
        for (let i = 0; i < n; i++) {
          const a = r() * TAU, d = Math.sqrt(r());
          const u = Math.cos(a) * f.rx * d, v = Math.sin(a) * f.ry * d, rot = f.rot || 0;
          const x = f.x + u * Math.cos(rot) - v * Math.sin(rot), y = f.y + u * Math.sin(rot) + v * Math.cos(rot);
          bushes.push([x, y, 0.9 + r() * 0.7, r() < 0.7 ? main : AZ[Math.floor(r() * AZ.length)]]);
        }
      }
    }
    if (L.gorse) {
      // Gorse grows in clumps, not as an even scatter.
      const box = this.box;
      const gn = makeNoise(hole.index * 5 + 11);
      for (let y = box.y; y < box.y + box.h; y += 3.2) {
        for (let x = box.x; x < box.x + box.w; x += 3.2) {
          const gx = x + (r() - 0.5) * 3, gy = y + (r() - 0.5) * 3;
          if (gn(gx / 26, gy / 26) < 0.58 || r() > 0.75) continue;
          const t = hole.terrainAt(gx, gy);
          if (t !== 1 && t !== 0) continue; // deep rough or out of bounds
          bushes.push([gx, gy, 0.8 + r() * 0.9, r() < 0.35 ? '#e8c832' : r() < 0.6 ? '#4f6b2c' : '#5f7d33']);
        }
      }
    }
    if (bushes.length && L.aug && this.treeKinds.azalea) {
      // Azaleas share the trees' near/far switching (no trunk).
      const ka = this.treeKinds.azalea;
      const mk = (geo, mat) => {
        const im = new T.InstancedMesh(geo, mat, bushes.length);
        im.userData.shared = true;
        im.castShadow = im.receiveShadow = true;
        im.frustumCulled = false;
        im.count = 0;
        im.setColorAt(0, col.set(1, 1, 1));
        group.add(im);
        return im;
      };
      const live = { trunk: null, near: mk(ka.body, this.bodyMat), cards: mk(ka.cards, this.bloomMat), far: mk(ka.far, this.bodyMat), items: [], bushes: true };
      for (const [x, y, sz, c] of bushes) {
        p.set(x, y, this.heightAt(x, y) - 0.08);
        q.setFromAxisAngle(zAxis, r() * TAU);
        s.set(sz * 1.2 * (1 + r() * 0.3), sz, sz * 0.9);
        m.compose(p, q, s);
        col.set(c);
        live.items.push({ x, y, w: 0, m: m.toArray(), leaf: [col.r, col.g, col.b] });
      }
      this.treeKindsLive.push(live);
    } else if (bushes.length) {
      const kb = this.treeKinds.bush;
      const body = new T.InstancedMesh(kb.body, this.bodyMat, bushes.length);
      const cards = new T.InstancedMesh(kb.cards, this.leafMat, bushes.length);
      for (const inst of [body, cards]) {
        inst.userData.shared = true;
        inst.castShadow = true;
        inst.receiveShadow = true;
      }
      bushes.forEach(([x, y, sz, c], i) => {
        p.set(x, y, this.heightAt(x, y) - 0.08);
        q.setFromAxisAngle(zAxis, r() * TAU);
        s.set(sz * (1 + r() * 0.4), sz, sz * 0.9);
        m.compose(p, q, s);
        col.set(c);
        for (const inst of [body, cards]) {
          inst.setMatrixAt(i, m);
          inst.setColorAt(i, col);
        }
      });
      group.add(body, cards);
    }
  }

  meanLeaf(L) {
    const c = new this.T.Color(0, 0, 0), t = new this.T.Color();
    for (const h of L.tree) c.add(t.set(h));
    return c.multiplyScalar(1 / L.tree.length);
  }

  // Cheap stand-ins for a tree kind: a plain tapered trunk and two crossed
  // quads for a billboard (the quads' texture is baked per hole).
  treeLod(kind, g) {
    this.lodCache = this.lodCache || {};
    if (this.lodCache[kind]) return this.lodCache[kind];
    const T = this.T;
    // Trunk radius at the base, and the crown's reach, from the real models.
    const tp = g.trunk.attributes.position.array;
    let r0 = 0.01;
    for (let i = 0; i < tp.length; i += 3) if (tp[i + 2] < 0.03) r0 = Math.max(r0, Math.hypot(tp[i], tp[i + 1]));
    let R = 0.05, top = 0.5;
    for (const geo of [g.far, g.trunk]) {
      const a = geo.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) { R = Math.max(R, Math.abs(a[i]), Math.abs(a[i + 1])); top = Math.max(top, a[i + 2]); }
    }
    const tH = kind.startsWith('loblolly') ? 0.78 : 0.45;
    const trunkFar = new T.CylinderGeometry(r0 * 0.45, r0, tH, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, tH / 2);
    const quads = new T.BufferGeometry();
    const P = [], U = [], N = [];
    for (const [ax, ay] of [[1, 0], [0, 1]]) {
      const c = [[-R, 0], [R, 0], [R, top], [-R, top]];
      const pts = c.map(([u, z]) => [ax * u, ay * u, z]);
      for (const k of [0, 1, 2, 0, 2, 3]) {
        P.push(...pts[k]);
        U.push((c[k][0] + R) / (2 * R), c[k][1] / top);
        N.push(0, 0, 1); // lit from above; the bake carries the shading
      }
    }
    quads.setAttribute('position', new T.Float32BufferAttribute(P, 3));
    quads.setAttribute('uv', new T.Float32BufferAttribute(U, 2));
    quads.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
    const mat = new T.MeshBasicMaterial({ alphaTest: 0.5, side: T.DoubleSide, visible: false });
    return (this.lodCache[kind] = { trunkFar, quads, mat, R, top });
  }

  // Render each Augusta tree kind once, side on, under this hole's light,
  // into the texture its distant billboards use.
  bakeImpostors(L) {
    const T = this.T, holeGroup = this.holeGroup;
    const jobs = (this.treeKindsLive || []).filter((k) => k.impBake);
    if (!jobs.length) return;
    this.treeTexReady.then(() => {
      if (this.holeGroup !== holeGroup) return; // moved on to another hole
      const scene = new T.Scene();
      const sun = new T.DirectionalLight(this.sunLight.color, this.sunLight.intensity);
      sun.position.copy(this.sunDir).multiplyScalar(100);
      const hemi = this.hemi.clone();
      const probe = new T.LightProbe(this.probe.sh.clone(), this.probe.intensity);
      scene.add(sun, sun.target, hemi, probe);
      const mean = this.meanLeaf(L);
      const prevRT = this.renderer.getRenderTarget(), prevClear = this.renderer.getClearAlpha();
      const prevCol = new T.Color();
      this.renderer.getClearColor(prevCol);
      for (const k of jobs) {
        const { kind, g, barkM } = k.impBake, lod = this.treeLod(kind, g);
        const h = 26, w = h / g.aspect;
        const rt = new T.WebGLRenderTarget(256, 512, { type: T.HalfFloatType, samples: 4 });
        rt.texture.generateMipmaps = true;
        rt.texture.minFilter = T.LinearMipmapLinearFilter;
        const parts = [[g.trunk, barkM, [0.95, 0.92, 0.9]], [g.far, g.farCards ? this.leafMat : this.bodyMat, [mean.r, mean.g, mean.b]]];
        const meshes = parts.map(([geo, mt, c]) => {
          const im = new T.InstancedMesh(geo, mt, 1);
          im.setMatrixAt(0, new T.Matrix4().makeScale(w, w, h));
          im.setColorAt(0, new T.Color(c[0], c[1], c[2]));
          im.frustumCulled = false;
          scene.add(im);
          return im;
        });
        const cam = new T.OrthographicCamera(-lod.R * w, lod.R * w, lod.top * h, 0, 1, 400);
        cam.up.set(0, 0, 1);
        cam.position.set(0, 200, 0);
        cam.lookAt(0, 0, 0);
        this.renderer.setRenderTarget(rt);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.clear();
        this.renderer.render(scene, cam);
        for (const im of meshes) { scene.remove(im); im.dispose(); }
        // A fresh material per hole, so the next hole's bake can't reuse it.
        const mat = lod.mat.clone();
        mat.map = rt.texture;
        mat.visible = true;
        k.imp.material = mat;
        this.holeTextures.push(rt);
        k.imp.userData.ownMat = true;
      }
      this.renderer.setRenderTarget(prevRT);
      this.renderer.setClearColor(prevCol, prevClear);
      this.treeEye = null;
      this.shadowKey = '';
    });
  }

  // Patrons behind the ropes, the clubhouse, scoreboards, TV towers and the
  // stone bridges (Augusta's course data lists them; other courses don't).
  buildProps(hole, L, group) {
    const T = this.T, P = this.props, mat = this.propMat;
    const r = seeded(hole.index * 17 + 3);
    const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), zAxis = new T.Vector3(0, 0, 1);
    const place = (geo, x, y, ang, sc = 1, shared = true, z = null) => {
      const o = new T.Mesh(geo, mat);
      o.position.set(x, y, z ?? this.heightAt(x, y) - 0.05);
      o.rotation.z = ang - Math.PI / 2; // props face +y
      o.scale.setScalar(sc);
      o.castShadow = o.receiveShadow = true;
      o.userData.shared = shared;
      group.add(o);
      return o;
    };
    // The crowd: rows of patrons behind each rope line, facing the play.
    const spacing = [1.5, 1.15, 0.95][this.quality] || 1.15;
    const variants = ['stand', 'stand2', 'stand3', 'sit'];
    for (const g of hole.gallery || []) {
      const pts = g.line;
      if (!pts || pts.length < 2) continue;
      const rope = new T.Mesh(P.makeRopeLine(pts, { heightAt: (x, y) => this.heightAt(x, y) }), mat);
      rope.castShadow = rope.receiveShadow = true;
      group.add(rope);
      const lists = [[], [], [], []];
      const rows = Math.max(1, Math.min(5, g.rows || 2));
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        const len = Math.hypot(bx - ax, by - ay) || 1, dx = (bx - ax) / len, dy = (by - ay) / len;
        // side +1 is the right-hand normal (-dy, dx), pointing away from the hole.
        const nx = -dy * (g.side || 1), ny = dx * (g.side || 1);
        const face = Math.atan2(-ny, -nx);
        for (let row = 0; row < rows; row++) {
          // Thinner further back, with gaps here and there.
          const fill = row === 0 ? 0.92 : 0.82 - row * 0.1;
          for (let u = r() * spacing; u < len; u += spacing * (0.85 + r() * 0.3)) {
            if (r() > fill) continue;
            const off = 1.3 + row * 1.15 + (r() - 0.5) * 0.5, j = (r() - 0.5) * 0.35;
            const x = ax + dx * (u + j) + nx * off, y = ay + dy * (u + j) + ny * off;
            const v = row === 0 && r() < 0.22 ? 3 : Math.floor(r() * 3);
            lists[v].push([x, y, face + (r() - 0.5) * 0.9, 0.92 + r() * 0.16]);
          }
        }
      }
      lists.forEach((list, v) => {
        if (!list.length) return;
        const im = new T.InstancedMesh(P.patron[variants[v]], mat, list.length);
        im.userData.shared = true;
        im.castShadow = this.quality > 0;
        im.receiveShadow = true;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, zs = 0;
        list.forEach(([x, y, a, sc], i) => {
          const z = this.heightAt(x, y);
          p.set(x, y, z - 0.03);
          q.setFromAxisAngle(zAxis, a - Math.PI / 2);
          s.setScalar(sc);
          im.setMatrixAt(i, m.compose(p, q, s));
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); zs += z;
        });
        im.boundingSphere = new T.Sphere(new T.Vector3((x0 + x1) / 2, (y0 + y1) / 2, zs / list.length + 1), Math.hypot(x1 - x0, y1 - y0) / 2 + 3);
        group.add(im);
      });
    }
    // Set pieces.
    for (const lm of hole.landmarks || []) {
      const a = lm.ang ?? -Math.PI / 2;
      if (lm.kind === 'clubhouse') place(P.clubhouse, lm.x, lm.y, a, 1, true, this.heightAt(lm.x, lm.y) - 0.6);
      else if (lm.kind === 'leaderboard') place(P.leaderboard, lm.x, lm.y, a);
      else if (lm.kind === 'scoreboard-small') place(P.leaderboard, lm.x, lm.y, a, 0.55);
      else if (lm.kind === 'camera-tower') place(P.cameraTower, lm.x, lm.y, a);
      else if (lm.kind === 'oak' && this.treeKinds.oak_big) {
        const k = this.treeKinds.oak_big, h = 14, w = h / (k.aspect || 0.55);
        p.set(lm.x, lm.y, this.heightAt(lm.x, lm.y) - 0.15);
        q.setFromAxisAngle(zAxis, a);
        m.compose(p, q, s.set(w, w, h));
        for (const [geo, mt] of [[k.trunk, this.barkMat], [k.nearBody, this.bodyMat], [k.nearCards, this.leafMat]]) {
          if (!geo) continue;
          const im = new T.InstancedMesh(geo, mt, 1);
          im.setMatrixAt(0, m);
          im.setColorAt(0, new T.Color(mt === this.barkMat ? L.trunk : L.tree[0]));
          im.userData.shared = true;
          im.castShadow = im.receiveShadow = true;
          im.frustumCulled = false;
          group.add(im);
        }
      }
    }
    // Stone footbridges over the creeks.
    for (const br of hole.bridges || []) {
      if (br.style !== 'stone') continue;
      const geo = P.makeStoneBridge({ length: br.len + 2, width: br.name === 'sarazen' ? 3.2 : 2.8, rise: Math.min(1.6, 0.6 + br.len * 0.05), seed: Math.round(br.x * 7 + br.y) });
      const c = Math.cos(br.ang), sn = Math.sin(br.ang), e = br.len / 2 + 1.5;
      const z = Math.max(this.heightAt(br.x + c * e, br.y + sn * e), this.heightAt(br.x - c * e, br.y - sn * e));
      const o = new T.Mesh(geo, mat);
      o.position.set(br.x, br.y, z - 0.1);
      o.rotation.z = br.ang;
      o.castShadow = o.receiveShadow = true;
      group.add(o);
    }
  }

  // Grass tufts in the rough near the line of play.
  // The grass field is shared between holes: point it at this hole's maps.
  buildGrass() {
    const T = this.T, g = this.grid, U = this.grassU;
    const hh = new Uint16Array(g.H.length);
    for (let k = 0; k < hh.length; k++) hh[k] = toHalf(g.H[k]);
    const ht = new T.DataTexture(hh, g.gw, g.gh, T.RedFormat, T.HalfFloatType);
    ht.minFilter = ht.magFilter = T.LinearFilter;
    ht.needsUpdate = true;
    this.holeTextures.push(ht);
    U.uMask.value = this.maskTex;
    U.uHeight.value = ht;
    U.uTurf.value = this.turfTex;
    U.uRoughH.value = this.look.aug ? 0.6 : 1; // Augusta's second cut is short
    U.uBox.value.set(this.box.x, this.box.y, this.box.w, this.box.h);
    U.uGrid.value.set(g.x, g.y, g.step, 0);
    this.grass.visible = true;
    this.settleUntil = performance.now() + 3000;
  }

  buildPin(hole, L, group) {
    const T = this.T;
    const pin = hole.pin;
    const z = this.heightAt(pin.x, pin.y);
    const cupCv = document.createElement('canvas');
    cupCv.width = cupCv.height = 64;
    {
      const c = cupCv.getContext('2d');
      const g = c.createRadialGradient(36, 38, 2, 32, 32, 32);
      g.addColorStop(0, '#000000');
      g.addColorStop(0.7, '#0b140b');
      g.addColorStop(0.92, '#3a4a36');
      g.addColorStop(1, '#6f7f68');
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
    }
    const cupTex = new T.CanvasTexture(cupCv);
    cupTex.colorSpace = T.SRGBColorSpace;
    this.holeTextures.push(cupTex);
    const cup = new T.Mesh(new T.CircleGeometry(0.075, 32), new T.MeshBasicMaterial({ map: cupTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    cup.position.set(pin.x, pin.y, z + 0.012);
    cup.userData.ownMat = true;
    const liner = new T.Mesh(new T.RingGeometry(0.075, 0.09, 24), new T.MeshBasicMaterial({ color: 0xf2f2ea }));
    liner.position.copy(cup.position);
    liner.userData.ownMat = true;
    const flag = new T.Group();
    flag.position.set(pin.x, pin.y, z);
    const pole = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 2.4, 8).rotateX(Math.PI / 2).translate(0, 0, 1.2), new T.MeshStandardMaterial({ color: 0xf4f4ee, roughness: 0.4 }));
    pole.castShadow = true;
    pole.userData.ownMat = true;
    const clothGeo = new T.PlaneGeometry(0.75, 0.5, 10, 4);
    const cloth = new T.Mesh(clothGeo, new T.MeshStandardMaterial({ color: hole.course === 'standrews' ? 0xd8282c : 0xffd23f, roughness: 0.7, side: T.DoubleSide }));
    cloth.castShadow = true;
    cloth.userData.ownMat = true;
    this.cloth = { mesh: cloth, base: clothGeo.attributes.position.array.slice() };
    flag.add(pole, cloth);
    this.flag = flag;
    this.flagZ = z;
    this.flagLift = 0;
    group.add(cup, liner, flag);
    // Tee markers.
    const t = hole.tee;
    const mc = hole.course === 'augusta' ? 0x2e8a4f : hole.course === 'standrews' ? 0xd8282c : 0xf6f6f0;
    const mm = new T.MeshStandardMaterial({ color: mc, roughness: 0.35 });
    for (const k of [-1, 1]) {
      const x = t.x + Math.cos(t.ang + Math.PI / 2) * 3 * k, y = t.y + Math.sin(t.ang + Math.PI / 2) * 3 * k;
      const b = new T.Mesh(this.ballGeo, mm);
      b.userData.shared = true;
      b.scale.setScalar(0.09);
      b.position.set(x, y, this.heightAt(x, y) + 0.09);
      b.castShadow = true;
      group.add(b);
    }
  }

  // Balls, shadows, rings, ribbons, slope arrows and particles, reused each frame.
  buildDynamic(group) {
    const T = this.T;
    const sh = (o) => {
      o.userData.shared = true;
      return o;
    };
    this.balls = [];
    for (let i = 0; i < 6; i++) {
      const ball = sh(new T.Mesh(this.ballGeo, this.ballMat));
      ball.castShadow = false; // it has its own soft blob shadow
      const blob = sh(new T.Mesh(this.discGeo, this.blobMat));
      const ringMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      const ring = sh(new T.Mesh(this.ringGeo, ringMat));
      ring.userData.ownMat = true;
      group.add(ball, blob, ring);
      this.balls.push({ ball, blob, ring });
    }
    const ribbonMat = (blend) => new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide, blending: blend });
    this.ribbons = {};
    for (const [name, blend] of [['tracer', T.AdditiveBlending], ['tracerCore', T.NormalBlending], ['arc', T.NormalBlending], ['arcShadow', T.NormalBlending], ['roll', T.NormalBlending]]) {
      const geo = new T.BufferGeometry();
      const n = 1600;
      geo.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 4), 4).setUsage(T.DynamicDrawUsage));
      const mesh = new T.Mesh(geo, ribbonMat(blend));
      mesh.frustumCulled = false;
      mesh.userData.ownMat = true;
      mesh.renderOrder = 5;
      group.add(mesh);
      this.ribbons[name] = mesh;
    }
    const decal = () => new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.landRing = new T.Mesh(this.ringGeo, decal());
    this.endRing = new T.Mesh(this.ringGeo, decal());
    for (const o of [this.landRing, this.endRing]) {
      o.userData.shared = true;
      o.userData.ownMat = true;
      o.renderOrder = 4;
      group.add(o);
    }
    // Slope arrows on the green.
    const n = Math.max(1, (this.slopePts || []).length);
    this.slopeMesh = new T.InstancedMesh(new T.PlaneGeometry(0.42, 0.06), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false, blending: T.AdditiveBlending }), n);
    this.slopeMesh.userData.ownMat = true;
    this.slopeMesh.frustumCulled = false;
    group.add(this.slopeMesh);
    // Particles.
    const pg = new T.BufferGeometry();
    pg.setAttribute('position', new T.BufferAttribute(new Float32Array(600 * 3), 3).setUsage(T.DynamicDrawUsage));
    pg.setAttribute('color', new T.BufferAttribute(new Float32Array(600 * 3), 3).setUsage(T.DynamicDrawUsage));
    this.points = new T.Points(pg, new T.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, blending: T.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.points.userData.ownMat = true;
    group.add(this.points);
    this.splashRings = [];
    for (let i = 0; i < 6; i++) {
      const o = new T.Mesh(this.ringGeo, decal());
      o.userData.shared = true;
      o.userData.ownMat = true;
      group.add(o);
      this.splashRings.push(o);
    }
  }

  // Terrain height at a point (bilinear), for placing things on the ground.
  // Sky light from an HDRI, loaded once per course look and baked into
  // spherical harmonics (the HDRIs are y-up, so they're turned z-up first).
  useEnv(name, L) {
    const T = this.T;
    const apply = (e) => {
      if (this.look !== L) return;
      this.probe.sh.copy(e.sh);
      // Each HDRI is scaled to the same average brightness (sun excluded),
      // so the sky light is consistent from course to course.
      this.probe.intensity = (L.envI ?? 0.8) * (0.28 / e.mean);
      this.hemi.intensity = L.hemiI * 0.45;
    };
    if (this.envCache[name]) return apply(this.envCache[name]);
    new T.EXRLoader().load(new URL(`../assets/env/${name}.exr`, import.meta.url).href + VERSIONED, (eq) => {
      const d = eq.image.data, half = d instanceof Uint16Array;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 7) {
        const v = (k) => (half ? T.DataUtils.fromHalfFloat(d[k]) : d[k]);
        sum += Math.min(3, (v(i) + v(i + 1) + v(i + 2)) / 3);
        n++;
      }
      const tmp = new T.Scene();
      const ball = new T.Mesh(new T.SphereGeometry(1, 32, 16), new T.MeshBasicMaterial({ map: eq, side: T.BackSide }));
      ball.rotation.x = Math.PI / 2;
      tmp.add(ball);
      const rt = new T.WebGLCubeRenderTarget(32, { type: T.HalfFloatType });
      const cam = new T.CubeCamera(0.1, 10, rt);
      cam.update(this.renderer, tmp);
      const pr = T.LightProbeGenerator.fromCubeRenderTarget(this.renderer, rt);
      const done = (lp) => {
        // Keep the sky's light but tame its colour cast, or everything in
        // shade turns blue.
        const sh = lp.sh.clone();
        for (const c of sh.coefficients) {
          const l = (c.x + c.y + c.z) / 3;
          c.lerp(new T.Vector3(l, l, l), 0.55);
        }
        const e = { sh, mean: Math.max(0.05, sum / n) };
        rt.dispose();
        ball.geometry.dispose();
        ball.material.dispose();
        eq.dispose();
        this.envCache[name] = e;
        apply(e);
      };
      if (pr && typeof pr.then === 'function') pr.then(done);
      else done(pr);
    });
  }

  // Sort trees into near (detailed) and far (simple) models, and hide any
  // right beside the camera so they don't fill the screen.
  updateTrees(eye) {
    if (this.treeEye && Math.hypot(eye.x - this.treeEye[0], eye.y - this.treeEye[1]) < 3) return;
    this.treeEye = [eye.x, eye.y];
    const nearD = [35, 60, 95][this.quality];
    for (const k of this.treeKindsLive) {
      let a = 0, n = 0, f = 0;
      const NA = k.near.instanceMatrix.array, FA = k.far.instanceMatrix.array;
      const NC = k.near.instanceColor.array, FC = k.far.instanceColor.array;
      const TA = k.trunk && k.trunk.instanceMatrix.array, TC = k.trunk && k.trunk.instanceColor.array;
      const nd = k.bushes ? nearD * 0.6 : nearD;
      const midD = [110, 150, 200][this.quality];
      let tf = 0, im = 0;
      const imp = k.imp && k.imp.material.visible ? k.imp : null;
      let idx = 0;
      for (const t of k.items) {
        idx++;
        const d = Math.hypot(t.x - eye.x, t.y - eye.y);
        if (d < t.w * 0.5 + 2.5 && !k.bushes) continue;
        if (k.bushes && d > 140 && idx & 1) continue; // distant azalea banks overlap anyway
        if (k.trunkFar && d >= nd) {
          if (imp && d >= midD) {
            imp.instanceMatrix.array.set(t.m, im * 16);
            imp.instanceColor.array.set(t.imp, im * 3);
            im++;
          } else {
            k.trunkFar.instanceMatrix.array.set(t.m, tf * 16);
            k.trunkFar.instanceColor.array.set(t.bark, tf * 3);
            tf++;
            FA.set(t.m, f * 16);
            FC.set(t.leaf, f * 3);
            f++;
          }
          continue;
        }
        if (TA) {
          TA.set(t.m, a * 16);
          TC.set(t.bark, a * 3);
          a++;
        }
        if (d < nd) {
          NA.set(t.m, n * 16);
          NC.set(t.leaf, n * 3);
          n++;
        } else {
          FA.set(t.m, f * 16);
          FC.set(t.leaf, f * 3);
          f++;
        }
      }
      if (k.trunk) k.trunk.count = a;
      if (k.trunkFar) k.trunkFar.count = tf;
      if (k.imp) k.imp.count = im;
      k.near.count = n;
      k.far.count = f;
      if (k.cards) {
        // Leaf cards go with the detailed bodies.
        k.cards.instanceMatrix.array.set(NA.subarray(0, n * 16));
        k.cards.instanceColor.array.set(NC.subarray(0, n * 3));
        k.cards.count = n;
      }
      for (const m of [k.trunk, k.near, k.far, k.cards, k.trunkFar, k.imp].filter(Boolean)) {
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.needsUpdate = true;
      }
    }
  }

  heightAt(x, y) {
    const g = this.grid;
    if (!g) return 0;
    const fx = (x - g.x) / g.step, fy = (y - g.y) / g.step;
    if (fx < 0 || fy < 0 || fx >= g.gw - 1 || fy >= g.gh - 1) return this.edgeZ ?? EDGE;
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const H = g.H, w = g.gw;
    const a = H[j * w + i], b = H[j * w + i + 1], c = H[(j + 1) * w + i], d = H[(j + 1) * w + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  setNear() {}

  // ---------- camera ----------

  setCamera(cam) {
    const c = this.camera;
    const aspect = this.w / this.h;
    c.fov = cam.fov || (aspect < 1 ? 66 : 56);
    c.aspect = aspect;
    c.position.set(cam.eye[0], cam.eye[1], cam.eye[2]);
    c.lookAt(cam.target[0], cam.target[1], cam.target[2]);
    c.updateProjectionMatrix();
    // Centre the picture in the visible area between the top bar and the panel.
    const top = cam.insetTop || 0, bottom = cam.insetBottom || 0;
    c.projectionMatrix.elements[9] = -(1 - (top + this.h - bottom) / this.h);
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    c.updateMatrixWorld();
  }

  project(x, y, z = 0) {
    if (!this.ok || !this.hole) return null;
    const v = new this.T.Vector3(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z > -0.05) return null;
    v.applyMatrix4(this.camera.projectionMatrix);
    // The canvas is mirrored (see styles.css), so screen x runs the other way.
    return [(0.5 - v.x * 0.5) * this.w, (1 - (v.y * 0.5 + 0.5)) * this.h];
  }

  toWorld(sx, sy, h = 0) {
    const T = this.T;
    const ndc = new T.Vector3(1 - (sx / this.w) * 2, 1 - (sy / this.h) * 2, 0.5);
    const p = ndc.clone().unproject(this.camera);
    const o = this.camera.position;
    const d = p.sub(o).normalize();
    let t = d.z < -1e-6 ? (h - o.z) / d.z : 1500;
    if (t < 0 || t > 1500) t = 1500;
    return [o.x + d.x * t, o.y + d.y * t];
  }

  // ---------- per-frame ----------

  ribbon(name, pts, { width = 0.004, color = [1, 1, 1, 1], dash = 0, fade = false, fadeIn = 0, flat = false } = {}) {
    const mesh = this.ribbons[name];
    const pos = mesh.geometry.attributes.position, col = mesh.geometry.attributes.color;
    const P = pos.array, C = col.array;
    let n = 0;
    const eye = this.camera.position;
    const maxSeg = Math.floor(P.length / 18);
    for (let i = 1; i < pts.length && n / 6 < maxSeg; i++) {
      if (dash && Math.floor(i / dash) % 2) continue;
      const a = pts[i - 1], b = pts[i];
      let sx, sy, sz;
      const ex = a[0] - eye.x, ey = a[1] - eye.y, ez = a[2] - eye.z;
      const dist = Math.hypot(ex, ey, ez);
      const w = Math.max(0.025, dist * width) / 2;
      if (flat) {
        sx = -(b[1] - a[1]); sy = b[0] - a[0]; sz = 0;
      } else {
        const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
        sx = ty * ez - tz * ey; sy = tz * ex - tx * ez; sz = tx * ey - ty * ex;
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      sx = (sx / l) * w; sy = (sy / l) * w; sz = (sz / l) * w;
      const k = fadeIn ? Math.min(1, i / (pts.length * fadeIn)) : 1;
      const alpha = color[3] * (fade ? i / pts.length : 1) * (fadeIn ? 0.15 + 0.85 * k : 1);
      const quad = [[a[0] - sx, a[1] - sy, a[2] - sz], [a[0] + sx, a[1] + sy, a[2] + sz], [b[0] + sx, b[1] + sy, b[2] + sz], [b[0] - sx, b[1] - sy, b[2] - sz]];
      for (const vi of [0, 1, 2, 0, 2, 3]) {
        P[n * 3] = quad[vi][0]; P[n * 3 + 1] = quad[vi][1]; P[n * 3 + 2] = quad[vi][2];
        C[n * 4] = color[0]; C[n * 4 + 1] = color[1]; C[n * 4 + 2] = color[2]; C[n * 4 + 3] = alpha;
        n++;
      }
    }
    mesh.geometry.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    mesh.visible = n > 0;
  }

  draw(sc) {
    if (!this.ok || !this.hole) return;
    const T = this.T;
    this.timeU.value = sc.time;
    this.setCamera(sc.cam);
    const eye = this.camera.position;
    const H = (x, y) => this.heightAt(x, y);
    this.sky.position.copy(eye);

    // The sun's shadow follows the area the camera is looking at.
    const tgt = sc.cam.target;
    const fx = tgt[0] - eye.x, fy = tgt[1] - eye.y, fl = Math.hypot(fx, fy) || 1;
    // Snapped to a coarse grid, and the shadow map is only re-drawn when the
    // snapped spot (or the set of trees) changes, not every frame.
    const cx = Math.round((eye.x + (fx / fl) * 55) / 18) * 18, cy = Math.round((eye.y + (fy / fl) * 55) / 18) * 18, cz = H(cx, cy);
    const key = `${cx},${cy}`;
    if (key !== this.shadowKey) {
      this.shadowKey = key;
      this.sunLight.target.position.set(cx, cy, cz);
      this.sunLight.position.set(cx + this.sunDir.x * 250, cy + this.sunDir.y * 250, cz + this.sunDir.z * 250);
      this.sunLight.target.updateMatrixWorld();
      this.renderer.shadowMap.needsUpdate = true;
    }

    this.updateTrees(eye);
    // The grass field sits a little ahead of the camera and parts round balls.
    this.grassU.uCentre.value.set(eye.x + (fx / fl) * 18, eye.y + (fy / fl) * 18);
    this.grassU.uBalls.value.forEach((v, i) => {
      const b = sc.balls[i];
      if (b) v.set(b.x, b.y, 0.55, 1);
      else v.set(0, 0, 0, 0);
    });

    const dtF = Math.max(0, Math.min(0.1, sc.time - (this.lastTime ?? sc.time)));
    this.lastTime = sc.time;
    // The flagstick comes out for putts.
    if (this.flag) {
      this.flagLift += ((sc.pinOut ? 1 : 0) - this.flagLift) * Math.min(1, dtF * 3);
      this.flag.position.z = this.flagZ + this.flagLift * 2.4;
      this.flag.visible = this.flagLift < 0.97;
    }

    // Balls.
    this.balls.forEach((b, i) => {
      const s0 = sc.balls[i];
      if (s0) {
        // Roll the ball over the distance it moved along the ground.
        const mx = s0.x - (b.px ?? s0.x), my = s0.y - (b.py ?? s0.y), md = Math.hypot(mx, my);
        const onGround = s0.zAbs == null ? s0.z < 0.05 : s0.zAbs - H(s0.x, s0.y) < 0.05;
        if (md > 1e-4 && md < 4 && onGround) {
          b.ball.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(-my / md, mx / md, 0), md / Math.max(0.0233, b.ball.scale.x)));
        }
        b.px = s0.x;
        b.py = s0.y;
      }
      const s = sc.balls[i];
      b.ball.visible = b.blob.visible = b.ring.visible = !!s;
      if (!s) return;
      const g = H(s.x, s.y);
      const z = s.zAbs != null ? s.zAbs : g + s.z;
      const d = Math.hypot(s.x - eye.x, s.y - eye.y, z - eye.z);
      const r = Math.max(0.05, d * 0.0058);
      b.ball.scale.setScalar(r);
      b.ball.position.set(s.x, s.y, z + r);
      const bs = Math.max(0.16, r * 2.6) * (1 + (z - g) * 0.04);
      b.blob.scale.setScalar(bs);
      b.blob.position.set(s.x, s.y, g + 0.03);
      if (z < g - 0.005) b.blob.visible = false; // dropping into the cup
      b.blob.material.opacity = Math.max(0.15, 0.85 - (z - g) * 0.03);
      b.ring.visible = !!s.ring;
      if (s.ring) {
        const rr = Math.max(0.55, d * 0.032) * (0.92 + Math.sin(sc.time * 4) * 0.08);
        b.ring.scale.setScalar(rr);
        b.ring.position.set(s.x, s.y, g + 0.04);
        b.ring.material.color.setRGB(s.col[0], s.col[1], s.col[2]);
      }
    });

    // Tracers.
    const trails = sc.trails || [];
    const tr = trails.length ? trails[trails.length - 1] : [];
    this.ribbon('tracer', tr, { width: 0.006, color: [1, 0.82, 0.45, 0.9], fade: true });
    this.ribbon('tracerCore', tr, { width: 0.0018, color: [1, 1, 1, 1], fade: true });

    // Aim guide.
    const aim = sc.aim;
    if (aim) {
      const c = aim.color || [1, 1, 1, 0.95];
      if (aim.arc && aim.arc.length > 1) {
        this.ribbon('arc', aim.arc, { width: 0.0056, color: c, dash: 3, fadeIn: 0.25 });
        this.ribbon('arcShadow', aim.arc.map((p) => [p[0], p[1], H(p[0], p[1]) + 0.05]), { width: 0.0065, color: [0, 0, 0, 0.22], dash: 3, flat: true });
      } else {
        this.ribbon('arc', []);
        this.ribbon('arcShadow', []);
      }
      const roll = aim.roll && aim.roll.length > 1 ? aim.roll.map((p) => [p[0], p[1], H(p[0], p[1]) + 0.05]) : [];
      this.ribbon('roll', roll, { width: aim.putt ? 0.003 : 0.004, color: aim.putt ? [1, 0.95, 0.6, 0.95] : [c[0], c[1], c[2], 0.85], dash: 2, flat: true });
      const ringAt = (mesh, p, rr) => {
        mesh.visible = !!p;
        if (!p) return;
        mesh.scale.setScalar(rr);
        mesh.position.set(p.x, p.y, H(p.x, p.y) + 0.05);
        mesh.material.color.setRGB(c[0], c[1], c[2]);
        mesh.material.opacity = 0.95;
      };
      ringAt(this.landRing, aim.ring, aim.ring ? Math.max(aim.ring.r, Math.hypot(aim.ring.x - eye.x, aim.ring.y - eye.y) * 0.018) : 1);
      ringAt(this.endRing, aim.end, aim.end ? Math.max(0.25, Math.hypot(aim.end.x - eye.x, aim.end.y - eye.y) * 0.009) : 1);
    } else {
      for (const n of ['arc', 'arcShadow', 'roll']) this.ribbon(n, []);
      this.landRing.visible = this.endRing.visible = false;
    }

    // Flag: scales up a little in the distance so it stays readable; the cloth waves.
    {
      const pin = this.hole.pin;
      const d = Math.hypot(pin.x - eye.x, pin.y - eye.y);
      const big = Math.max(1, d * 0.01);
      this.flag.scale.set(big, big, big);
      const wind = sc.wind || { speed: 5, dir: 0 };
      const { mesh, base } = this.cloth;
      const P = mesh.geometry.attributes.position;
      const len = 0.75 * (0.6 + Math.min(1, wind.speed / 16) * 0.4);
      for (let i = 0; i < P.count; i++) {
        const u = (base[i * 3] + 0.375) / 0.75; // 0 at the pole
        const v = base[i * 3 + 1];
        const ph = sc.time * (4 + wind.speed * 0.35) - u * 5;
        const wave = Math.sin(ph) * 0.1 * u;
        const x = Math.cos(wind.dir) * len * u - Math.sin(wind.dir) * wave;
        const y = Math.sin(wind.dir) * len * u + Math.cos(wind.dir) * wave;
        P.setXYZ(i, x, y, 2.15 + v - u * 0.06);
      }
      P.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }

    // Slope arrows.
    {
      const pts = sc.slope ? this.slopePts || [] : [];
      const mesh = this.slopeMesh;
      const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(1, 1, 1), p = new T.Vector3(), z = new T.Vector3(0, 0, 1), col = new T.Color();
      const n = Math.min(pts.length, mesh.count);
      for (let i = 0; i < n; i++) {
        const sp = pts[i];
        const strength = Math.min(1, sp.m / 0.03);
        const ph = (sc.time * (0.3 + strength * 0.9) + sp.ph) % 1;
        const len = 0.35 + strength * 0.7;
        const ox = sp.x + sp.dx * len * (ph - 0.5), oy = sp.y + sp.dy * len * (ph - 0.5);
        const a = Math.sin(ph * Math.PI) * (0.25 + strength * 0.5);
        p.set(ox, oy, H(ox, oy) + 0.03);
        q.setFromAxisAngle(z, Math.atan2(sp.dy, sp.dx));
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, strength > 0.6 ? col.setRGB(a, a * 0.95, a * 0.6) : col.setRGB(a, a, a));
      }
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Particles and splash rings.
    {
      const P = this.points.geometry.attributes.position, C = this.points.geometry.attributes.color;
      let n = 0, ri = 0;
      for (const pt of sc.particles || []) {
        const f = Math.max(0, pt.life / pt.max);
        const c = parseColor(pt.color);
        if (pt.ring) {
          if (ri >= this.splashRings.length) continue;
          const o = this.splashRings[ri++];
          o.visible = true;
          o.scale.setScalar((pt.r1 + (pt.r0 - pt.r1) * f) * 1.2);
          o.position.set(pt.x, pt.y, Math.max(H(pt.x, pt.y), -0.1) + 0.05);
          o.material.color.setRGB(c[0], c[1], c[2]);
          o.material.opacity = c[3] * f;
          continue;
        }
        if (n >= P.count) continue;
        P.setXYZ(n, pt.x, pt.y, H(pt.x, pt.y) + pt.z * 0.6 + 0.05);
        C.setXYZ(n, c[0] * f * c[3], c[1] * f * c[3], c[2] * f * c[3]);
        n++;
      }
      for (; ri < this.splashRings.length; ri++) this.splashRings[ri].visible = false;
      this.points.geometry.setDrawRange(0, n);
      P.needsUpdate = true;
      C.needsUpdate = true;
    }

    this.trackSpeed();
    this.renderer.render(this.scene, this.camera);
  }

  // Drop a quality level when frames stay slow for a couple of seconds.
  // Hold 60 fps. When frames run slow, trim the resolution a little at a
  // time, then drop a quality tier. A display capped at 60 Hz can't show
  // spare headroom, so climbing is a trial: try the next tier up for a few
  // seconds and keep it only if frames stay smooth. Frames just after
  // loading a hole or changing settings are ignored (shader compiles).
  trackSpeed() {
    const now = performance.now();
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    if (!this.autoQuality || dt > 500 || now < this.settleUntil) return;
    this.frameMs += (dt - this.frameMs) * 0.06;
    this.speedT += dt;
    const slow = this.frameMs > 18.8;
    if (this.trial) {
      if (slow && this.speedT > 800) {
        // The trial tier is too much for this device: go back and stay.
        this.noClimbUntil = Infinity;
        const back = this.trial.from;
        this.trial = null;
        this.speedT = 0;
        return this.setQuality(back);
      }
      if (now > this.trial.until) this.trial = null; // passed
      return;
    }
    if (slow && this.speedT > 1500) {
      this.speedT = 0;
      if (this.resScale > 0.75) this.setResScale(this.resScale - 0.1);
      else if (this.quality > 0) {
        this.noClimbUntil = now + 120000;
        this.setQuality(this.quality - 1);
      }
    } else if (!slow && this.frameMs < 17.4 && this.speedT > 6000) {
      this.speedT = 0;
      if (this.resScale < 1) this.setResScale(Math.min(1, this.resScale + 0.1));
      else if (this.quality < 2 && !this.soft && now > this.noClimbUntil) {
        const from = this.quality;
        this.setQuality(from + 1);
        this.trial = { from, until: performance.now() + 2500 + 4000 };
      }
    } else if (this.speedT > 8000) this.speedT = 0;
  }

  setResScale(k) {
    this.resScale = k;
    this.frameMs = 16.7;
    this.speedT = 0;
    this.settleUntil = performance.now() + 800;
    if (this.w) this.resize(this.w, this.h, this.dpr);
  }

  // 'auto' or a fixed tier 0-2 (remembered on this device).
  setGraphics(mode) {
    this.mode = mode;
    this.autoQuality = mode === 'auto';
    try {
      if (mode === 'auto') localStorage.removeItem('pocketlinks.gfx');
      else localStorage.setItem('pocketlinks.gfx', String(mode));
    } catch {}
    this.resScale = 1;
    this.setQuality(mode === 'auto' ? (this.soft ? 0 : 1) : mode);
  }

  setQuality(q) {
    this.quality = q;
    this.treeEye = null;
    this.frameMs = 16.7;
    this.speedT = 0;
    this.settleUntil = performance.now() + 2500;
    // Soft leaf edges when there is MSAA to resolve them.
    if (this.leafMat.alphaToCoverage !== !this.soft) {
      for (const mt of [this.leafMat, this.bloomMat]) {
        mt.alphaToCoverage = !this.soft; // soft leaf edges with the canvas MSAA
        mt.needsUpdate = true;
      }
    }
    // Shadow detail by tier.
    const sm = [1024, 1536, 2048][q];
    if (this.sunLight.shadow.mapSize.x !== sm) {
      this.sunLight.shadow.mapSize.set(sm, sm);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    }
    this.shadowKey = '';
    if (this.grass) {
      // Grass at every tier: just sparser on the lower ones.
      this.grass.visible = !!this.hole;
      const far = [22, 30, 40][q], sp = [0.7, 0.62, 0.55][q];
      this.grassU.uSpacing.value = sp;
      this.grassU.uFar.value = far;
      const r = far / sp + 3;
      this.grass.geometry.instanceCount = Math.min(160 * 160, Math.ceil(Math.PI * r * r));
    }
    if (this.w) this.resize(this.w, this.h, this.dpr);
  }
}
