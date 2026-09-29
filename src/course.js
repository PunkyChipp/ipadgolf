// Hole layouts and terrain. World units are yards; each hole plays from the tee
// at (0, 0) roughly toward negative y. No DOM access, so tests can run it in Node.

export const T = { OB: 0, DEEP: 1, ROUGH: 2, FAIRWAY: 3, FRINGE: 4, GREEN: 5, SAND: 6, WATER: 7, TEE: 8 };
export const TERRAIN_NAMES = ['Out of bounds', 'Deep rough', 'Rough', 'Fairway', 'Fringe', 'Green', 'Bunker', 'Water', 'Tee'];

const ROUGH_W = 11; // width of the first cut of rough either side of the fairway
const FRINGE_W = 2.6;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts) {
  let h = 2166136261;
  for (const p of parts.join('|')) h = Math.imul(h ^ p.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ---------- geometry helpers ----------

function catmull(pts, step) {
  const out = [];
  const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(seg / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1].slice());
  let s = 0;
  return out.map((p, i) => {
    if (i) s += Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]);
    return { x: p[0], y: p[1], s };
  });
}

export function inEllipse(x, y, e, grow = 0) {
  const c = Math.cos(-(e.rot || 0)), s = Math.sin(-(e.rot || 0));
  const dx = x - e.x, dy = y - e.y;
  const u = dx * c - dy * s, v = dx * s + dy * c;
  const rx = e.rx + grow, ry = e.ry + grow;
  return (u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1;
}

function segDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [Math.hypot(px - ax - abx * t, py - ay - aby * t), t];
}

function polyDist(x, y, line) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    best = Math.min(best, segDist(x, y, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1])[0]);
  }
  return best;
}

// ---------- hole specs ----------
// path: centre line from tee to green. fairway: where it starts (yards from
// tee), how far short of the green it stops, and its width. water entries are
// ellipses or creeks ({ line, w }). slope: green gradient in yards of rise per
// yard; bumps add local humps (h in yards).

export const HOLES = [
  {
    name: 'The Opener', par: 4,
    path: [[0, 0], [3, -120], [-6, -250], [0, -372]],
    fairway: { from: 70, endGap: 28, width: 38 },
    green: { x: 0, y: -375, rx: 13, ry: 16, rot: 0.1 },
    bunkers: [
      { x: 25, y: -232, rx: 11, ry: 6, rot: 0.3 },
      { x: -19, y: -367, rx: 6, ry: 4, rot: 1.2 },
      { x: 16, y: -388, rx: 6, ry: 4, rot: -0.5 },
    ],
    bounds: 62, trees: 0.6,
    slope: { tilt: [0.004, 0.013], bumps: [{ dx: 5, dy: -4, r: 6, h: 0.1 }] },
  },
  {
    name: 'Carry the Pond', par: 3,
    path: [[0, 0], [0, -168]],
    fairway: { from: 128, endGap: 14, width: 30 },
    green: { x: 0, y: -171, rx: 15, ry: 11, rot: 0 },
    water: [{ x: 0, y: -92, rx: 34, ry: 27, rot: 0.15 }],
    bunkers: [
      { x: -2, y: -187, rx: 12, ry: 4.5, rot: 0 },
      { x: -20, y: -164, rx: 5, ry: 7, rot: 0.2 },
    ],
    bounds: 55, trees: 0.5,
    slope: { tilt: [-0.012, 0.008], bumps: [{ dx: -5, dy: 2, r: 5, h: -0.08 }] },
  },
  {
    name: 'The Long Road', par: 5,
    path: [[0, 0], [0, -240], [-30, -360], [-100, -455], [-150, -500]],
    fairway: { from: 60, endGap: 32, width: 40 },
    green: { x: -152, y: -503, rx: 14, ry: 13, rot: 0.6 },
    bunkers: [
      { x: 30, y: -262, rx: 12, ry: 7, rot: 0.4 },
      { x: -72, y: -448, rx: 8, ry: 5, rot: 0.7 },
      { x: -140, y: -519, rx: 8, ry: 4, rot: -0.6 },
      { x: -169, y: -491, rx: 5, ry: 7, rot: 0.3 },
    ],
    treeClusters: [{ x: -58, y: -262, n: 16, spread: 24 }],
    bounds: 66, trees: 0.7,
    slope: { tilt: [0.012, 0.004], bumps: [{ dx: -4, dy: -3, r: 5, h: 0.09 }] },
  },
  {
    name: 'Creek Crossing', par: 4,
    path: [[0, 0], [0, -225], [35, -320], [62, -405]],
    fairway: { from: 55, endGap: 28, width: 36 },
    green: { x: 63, y: -408, rx: 12, ry: 15, rot: -0.3 },
    water: [{ line: [[-90, -258], [-30, -272], [30, -266], [80, -281], [150, -276]], w: 7 }],
    bunkers: [
      { x: 79, y: -398, rx: 5, ry: 8, rot: 0.2 },
      { x: 50, y: -421, rx: 6, ry: 4, rot: 0 },
    ],
    bounds: 62, trees: 0.6,
    slope: { tilt: [-0.006, -0.014], bumps: [{ dx: 3, dy: 5, r: 6, h: 0.1 }] },
  },
  {
    name: 'Fortress', par: 3,
    path: [[0, 0], [0, -196]],
    fairway: { from: 150, endGap: 15, width: 26 },
    green: { x: 0, y: -199, rx: 13, ry: 12, rot: 0 },
    bunkers: [
      { x: -17, y: -196, rx: 5, ry: 9, rot: 0 },
      { x: 17, y: -202, rx: 5, ry: 9, rot: 0 },
      { x: 0, y: -216, rx: 11, ry: 4.5, rot: 0 },
      { x: -10, y: -183, rx: 7, ry: 3.5, rot: -0.3 },
    ],
    bounds: 55, trees: 0.7,
    slope: { tilt: [0.0, 0.016], bumps: [{ dx: 0, dy: -5, r: 4, h: 0.1 }, { dx: -5, dy: 4, r: 4, h: -0.06 }] },
  },
  {
    name: 'The Chute', par: 4,
    path: [[0, 0], [2, -170], [-2, -345]],
    fairway: { from: 60, endGap: 24, width: 26 },
    green: { x: -2, y: -349, rx: 11, ry: 13, rot: 0 },
    bunkers: [{ x: 14, y: -341, rx: 5, ry: 7, rot: 0.1 }],
    bounds: 42, trees: 1, roughW: 7,
    slope: { tilt: [-0.014, 0.006], bumps: [{ dx: 3, dy: -2, r: 5, h: 0.08 }] },
  },
  {
    name: 'Lakeside', par: 5,
    path: [[0, 0], [-5, -200], [-20, -380], [-10, -540]],
    fairway: { from: 60, endGap: 34, width: 42 },
    green: { x: -10, y: -544, rx: 14, ry: 14, rot: 0 },
    water: [{ x: -76, y: -300, rx: 26, ry: 170, rot: 0.03 }],
    bunkers: [
      { x: 24, y: -262, rx: 12, ry: 6, rot: -0.3 },
      { x: 8, y: -555, rx: 7, ry: 4, rot: -0.5 },
      { x: -27, y: -536, rx: 5, ry: 7, rot: 0.2 },
    ],
    bounds: 72, trees: 0.5,
    slope: { tilt: [-0.013, -0.006], bumps: [{ dx: 4, dy: 3, r: 6, h: 0.1 }] },
  },
  {
    name: 'The Island', par: 3,
    path: [[0, 0], [0, -142]],
    fairway: null,
    green: { x: 0, y: -143, rx: 12, ry: 11, rot: 0.2 },
    water: [{ x: 0, y: -132, rx: 40, ry: 50, rot: 0 }],
    bunkers: [{ x: 10, y: -154, rx: 4, ry: 2.5, rot: 0.5 }],
    bounds: 60, trees: 0.45,
    slope: { tilt: [0.009, -0.01], bumps: [] },
  },
  {
    name: 'Homeward', par: 5,
    path: [[0, 0], [8, -230], [-6, -380], [0, -492]],
    fairway: { from: 60, endGap: 62, width: 38 },
    green: { x: 0, y: -495, rx: 15, ry: 12, rot: 0 },
    water: [{ x: 0, y: -448, rx: 27, ry: 10, rot: 0.05 }],
    bunkers: [
      { x: -25, y: -250, rx: 10, ry: 6, rot: 0.2 },
      { x: 0, y: -511, rx: 12, ry: 4, rot: 0 },
      { x: 20, y: -489, rx: 4, ry: 6, rot: 0 },
    ],
    bounds: 66, trees: 0.6,
    slope: { tilt: [0.008, 0.012], bumps: [{ dx: -5, dy: -2, r: 5, h: 0.1 }] },
  },
];

// ---------- building a playable hole ----------

export function buildHole(index, gameSeed = 1) {
  const spec = HOLES[index];
  const r = rng(hashSeed(gameSeed, 'hole', index));
  const path = catmull(spec.path, 2.5);
  const length = path[path.length - 1].s;
  const roughW = spec.roughW ?? ROUGH_W;
  const phase = r() * 100;
  const fw = spec.fairway;
  const fwBase = fw ? fw.width / 2 : 0;
  const halfWidth = (s) => (fwBase || 16) * (1 + 0.12 * Math.sin(s / 37 + phase) + 0.07 * Math.sin(s / 13 + phase * 2));
  const fwFrom = fw ? fw.from : Infinity;
  const fwTo = fw ? length - fw.endGap : -Infinity;

  const green = { ...spec.green };
  // Pin somewhere in the inner 55% of the green, different every game.
  const pa = r() * Math.PI * 2, pr = Math.sqrt(r()) * 0.55;
  const gc = Math.cos(green.rot || 0), gs = Math.sin(green.rot || 0);
  const pu = Math.cos(pa) * green.rx * pr, pv = Math.sin(pa) * green.ry * pr;
  const pin = { x: green.x + pu * gc - pv * gs, y: green.y + pu * gs + pv * gc };

  const t0 = path[0], t1 = path[3];
  const teeAng = Math.atan2(t1.y - t0.y, t1.x - t0.x);
  const tee = { x: t0.x, y: t0.y, rx: 4, ry: 7, rot: teeAng + Math.PI / 2, ang: teeAng };

  const hole = {
    index, spec, name: spec.name, par: spec.par, path, length, green, pin, tee,
    bunkers: spec.bunkers || [], water: spec.water || [], bounds: spec.bounds, roughW,
    halfWidth, fwFrom, fwTo, slope: spec.slope, trees: [],
  };

  hole.nearest = (x, y, from = 0, to = Infinity) => {
    let best = Infinity, bs = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      if (b.s < from || a.s > to) continue;
      const [d, t] = segDist(x, y, a.x, a.y, b.x, b.y);
      if (d < best) { best = d; bs = a.s + (b.s - a.s) * t; }
    }
    return [best, bs];
  };

  hole.terrainAt = (x, y) => terrainAt(hole, x, y);
  hole.slopeAt = (x, y) => slopeAt(hole, x, y);

  // Yardage from tee along the centre line to the pin.
  hole.yards = Math.round(length);
  placeTrees(hole, r, spec);
  return hole;
}

function terrainAt(h, x, y) {
  if (inEllipse(x, y, h.tee)) return T.TEE;
  if (inEllipse(x, y, h.green)) return T.GREEN;
  for (const b of h.bunkers) if (inEllipse(x, y, b)) return T.SAND;
  for (const w of h.water) {
    if (w.line ? polyDist(x, y, w.line) < w.w / 2 : inEllipse(x, y, w)) return T.WATER;
  }
  if (inEllipse(x, y, h.green, FRINGE_W)) return T.FRINGE;
  const [d, s] = h.nearest(x, y);
  if (d > h.bounds) return T.OB;
  if (h.fwFrom < h.fwTo) {
    const [df, sf] = h.nearest(x, y, h.fwFrom, h.fwTo);
    const hw = h.halfWidth(sf);
    if (df < hw) return T.FAIRWAY;
    if (df < hw + h.roughW) return T.ROUGH;
  }
  if (d < h.halfWidth(s) + h.roughW) return T.ROUGH;
  return T.DEEP;
}

function slopeAt(h, x, y) {
  const g = h.green;
  if (!inEllipse(x, y, g, FRINGE_W + 1)) return [0, 0];
  let gx = h.slope.tilt[0], gy = h.slope.tilt[1];
  for (const b of h.slope.bumps) {
    const bx = g.x + b.dx, by = g.y + b.dy;
    const dx = x - bx, dy = y - by;
    const e = b.h * Math.exp(-(dx * dx + dy * dy) / (b.r * b.r));
    gx += (e * -2 * dx) / (b.r * b.r);
    gy += (e * -2 * dy) / (b.r * b.r);
  }
  return [gx, gy];
}

function placeTrees(h, r, spec) {
  const density = spec.trees ?? 0.6;
  const minX = Math.min(...h.path.map((p) => p.x)) - h.bounds - 30;
  const maxX = Math.max(...h.path.map((p) => p.x)) + h.bounds + 30;
  const minY = Math.min(...h.path.map((p) => p.y)) - h.bounds - 30;
  const maxY = Math.max(...h.path.map((p) => p.y)) + h.bounds + 30;
  const step = 8;
  const add = (x, y, big = 1) => {
    h.trees.push({ x, y, r: (3.2 + r() * 3.2) * big, h: 11 + r() * 9, shade: r() });
  };
  const clearOf = (x, y) => {
    if (Math.hypot(x - h.tee.x, y - h.tee.y) < 22 || inEllipse(x, y, h.green, FRINGE_W + 7)) return false;
    const [d, s] = h.nearest(x, y);
    return d > h.halfWidth(s) + 5; // keep the line of play open
  };
  for (let y = minY; y < maxY; y += step) {
    for (let x = minX; x < maxX; x += step) {
      const px = x + (r() - 0.5) * step, py = y + (r() - 0.5) * step;
      const roll = r();
      const t = terrainAt(h, px, py);
      if (!clearOf(px, py)) continue;
      if (t === T.DEEP && roll < density * 0.5) add(px, py);
      else if (t === T.OB && roll < 0.35) add(px, py, 1.15);
      else if (t === T.ROUGH && roll < density * 0.04) add(px, py);
    }
  }
  for (const c of spec.treeClusters || []) {
    for (let i = 0; i < c.n; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * c.spread;
      const px = c.x + Math.cos(a) * d, py = c.y + Math.sin(a) * d;
      const t = terrainAt(h, px, py);
      if (t !== T.FAIRWAY && t !== T.WATER && t !== T.SAND && clearOf(px, py)) add(px, py, 1.1);
    }
  }
  // Trees overlap water or bunkers badly; keep them on grass.
  h.trees = h.trees.filter((t) => {
    const k = terrainAt(h, t.x, t.y);
    return k !== T.WATER && k !== T.SAND && k !== T.GREEN && k !== T.FRINGE && k !== T.FAIRWAY;
  });
  // Bucket trees for fast collision checks during ball flight.
  h.treeGrid = new Map();
  for (const t of h.trees) {
    const k = `${Math.floor(t.x / 20)},${Math.floor(t.y / 20)}`;
    if (!h.treeGrid.has(k)) h.treeGrid.set(k, []);
    h.treeGrid.get(k).push(t);
  }
  h.treesNear = (x, y) => {
    const out = [];
    const cx = Math.floor(x / 20), cy = Math.floor(y / 20);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const b = h.treeGrid.get(`${cx + i},${cy + j}`);
      if (b) out.push(...b);
    }
    return out;
  };
}

// Wind is the same for everyone in a game (seeded), different per hole.
export function windFor(index, gameSeed) {
  const r = rng(hashSeed(gameSeed, 'wind', index));
  const speed = Math.round(2 + r() * 13);
  return { speed, dir: r() * Math.PI * 2 };
}
