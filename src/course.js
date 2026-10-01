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

const LINKS = [
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

// Augusta National, from the Masters tees scaled to this game's clubs (about
// 93% of the real yardage). Pines line every hole, the sand is white, the
// greens are fast and tiered, and Rae's Creek runs through Amen Corner.
const AUGUSTA = [
  {
    name: 'Tea Olive', par: 4,
    path: [[0, 0], [0, -150], [12, -300], [18, -415]],
    fairway: { from: 45, endGap: 24, width: 44 },
    green: { x: 18, y: -418, rx: 12, ry: 15, rot: 0.1 },
    bunkers: [
      { x: 42, y: -292, rx: 11, ry: 6, rot: 0.3 },
      { x: 4, y: -406, rx: 6, ry: 4, rot: 0.5 },
    ],
    flowers: [{ x: -40, y: -380, rx: 9, ry: 5 }],
    bounds: 70, trees: 0.75,
    slope: { tilt: [0.004, -0.012], bumps: [{ dx: -3, dy: -6, r: 5, h: 0.08 }], tiers: [{ dx: 0, dy: 9, ang: Math.PI / 2, h: -0.35, w: 1.4 }] },
  },
  {
    name: 'Pink Dogwood', par: 5,
    path: [[0, 0], [5, -250], [-38, -400], [-82, -535]],
    fairway: { from: 45, endGap: 30, width: 46 },
    green: { x: -84, y: -539, rx: 11, ry: 17, rot: 0.3 },
    bunkers: [
      { x: 38, y: -268, rx: 12, ry: 7, rot: 0.2 },
      { x: -100, y: -530, rx: 5, ry: 7, rot: 0.3 },
      { x: -68, y: -532, rx: 5, ry: 6, rot: 0.2 },
    ],
    treeClusters: [{ x: -48, y: -262, n: 20, spread: 26 }],
    flowers: [{ x: -110, y: -560, rx: 10, ry: 5 }, { x: 30, y: -150, rx: 8, ry: 4 }],
    bounds: 72, trees: 0.75,
    slope: { tilt: [0.006, 0.012], bumps: [{ dx: 3, dy: 4, r: 5, h: -0.08 }] },
  },
  {
    name: 'Flowering Peach', par: 4,
    path: [[0, 0], [-3, -160], [2, -330]],
    fairway: { from: 40, endGap: 22, width: 40 },
    green: { x: 3, y: -333, rx: 9, ry: 14, rot: -0.5 },
    bunkers: [
      { x: -24, y: -236, rx: 4, ry: 3, rot: 0 },
      { x: -15, y: -248, rx: 4, ry: 3, rot: 0.4 },
      { x: -27, y: -256, rx: 4, ry: 3, rot: 0.2 },
      { x: -14, y: -266, rx: 4, ry: 3, rot: 0.6 },
      { x: -9, y: -326, rx: 5, ry: 4, rot: 0.4 },
    ],
    flowers: [{ x: 30, y: -350, rx: 8, ry: 5 }],
    bounds: 66, trees: 0.7,
    slope: { tilt: [0.004, 0.009], bumps: [{ dx: -2, dy: -6, r: 4, h: -0.08 }], tiers: [{ dx: 0, dy: 8, ang: Math.PI / 2, h: -0.4, w: 1.2 }] },
  },
  {
    name: 'Flowering Crab Apple', par: 3,
    path: [[0, 0], [0, -220]],
    fairway: { from: 170, endGap: 14, width: 26 },
    green: { x: 0, y: -222, rx: 15, ry: 12, rot: 0 },
    bunkers: [
      { x: 15, y: -208, rx: 8, ry: 5, rot: 0.4 },
      { x: -13, y: -237, rx: 7, ry: 3.5, rot: -0.2 },
    ],
    bounds: 60, trees: 0.7,
    slope: { tilt: [0.0, -0.012], bumps: [], tiers: [{ dx: 0, dy: 1, ang: Math.PI / 2, h: -0.3, w: 1.6 }] },
  },
  {
    name: 'Magnolia', par: 4,
    path: [[0, 0], [5, -230], [-15, -350], [-30, -460]],
    fairway: { from: 45, endGap: 26, width: 42 },
    green: { x: -31, y: -463, rx: 13, ry: 14, rot: 0 },
    bunkers: [
      { x: -30, y: -276, rx: 8, ry: 5, rot: 0.3 },
      { x: -25, y: -297, rx: 7, ry: 5, rot: 0.2 },
      { x: -30, y: -481, rx: 9, ry: 3.5, rot: 0 },
    ],
    treeClusters: [{ x: -45, y: -230, n: 12, spread: 20 }],
    bounds: 68, trees: 0.75,
    slope: { tilt: [0.003, 0.008], bumps: [{ dx: 5, dy: 2, r: 5, h: 0.14 }, { dx: -5, dy: -4, r: 4, h: -0.06 }] },
  },
  {
    name: 'Juniper', par: 3,
    path: [[0, 0], [0, -175]],
    fairway: { from: 120, endGap: 16, width: 30 },
    green: { x: 0, y: -178, rx: 16, ry: 13, rot: 0.2 },
    bunkers: [{ x: -16, y: -167, rx: 6, ry: 5, rot: 0.3 }],
    flowers: [{ x: -36, y: -120, rx: 10, ry: 5 }, { x: 34, y: -190, rx: 8, ry: 5 }],
    bounds: 60, trees: 0.65,
    slope: { tilt: [-0.004, -0.008], bumps: [], tiers: [{ dx: 4, dy: -3, ang: -Math.PI / 4, h: 0.45, w: 1.3 }] },
  },
  {
    name: 'Pampas', par: 4,
    path: [[0, 0], [0, -210], [-4, -420]],
    fairway: { from: 45, endGap: 22, width: 30 },
    green: { x: -4, y: -424, rx: 10, ry: 15, rot: 0.1 },
    bunkers: [
      { x: -16, y: -413, rx: 4, ry: 6, rot: 0.1 },
      { x: -3, y: -405, rx: 6, ry: 2.5, rot: 0 },
      { x: 9, y: -414, rx: 3.5, ry: 5, rot: 0.1 },
      { x: -13, y: -441, rx: 5, ry: 3, rot: 0.3 },
      { x: 7, y: -441, rx: 5, ry: 3, rot: -0.3 },
    ],
    bounds: 46, trees: 1, roughW: 7,
    slope: { tilt: [0.002, -0.014], bumps: [{ dx: 2, dy: -6, r: 4, h: 0.08 }] },
  },
  {
    name: 'Yellow Jasmine', par: 5,
    path: [[0, 0], [5, -260], [-10, -420], [-20, -530]],
    fairway: { from: 45, endGap: 18, width: 44 },
    green: { x: -20, y: -533, rx: 12, ry: 13, rot: 0 },
    bunkers: [{ x: 36, y: -265, rx: 12, ry: 7, rot: -0.2 }],
    treeClusters: [{ x: -42, y: -380, n: 14, spread: 18 }],
    bounds: 70, trees: 0.7,
    slope: { tilt: [-0.006, 0.006], bumps: [{ dx: -12, dy: 0, r: 4, h: 0.3 }, { dx: 12, dy: 2, r: 4, h: 0.3 }, { dx: 0, dy: -12, r: 4, h: 0.25 }] },
  },
  {
    name: 'Carolina Cherry', par: 4,
    path: [[0, 0], [4, -230], [-25, -340], [-45, -430]],
    fairway: { from: 45, endGap: 24, width: 42 },
    green: { x: -46, y: -434, rx: 12, ry: 13, rot: 0.2 },
    bunkers: [
      { x: -59, y: -425, rx: 5, ry: 4, rot: 0.2 },
      { x: -50, y: -417, rx: 5, ry: 3, rot: 0.6 },
    ],
    treeClusters: [{ x: -40, y: -235, n: 12, spread: 18 }],
    flowers: [{ x: -20, y: -460, rx: 9, ry: 5 }],
    bounds: 68, trees: 0.75,
    slope: { tilt: [0.005, -0.01], bumps: [], tiers: [{ dx: 0, dy: 7, ang: Math.PI / 2 - 0.4, h: -0.35, w: 1.3 }] },
  },
  {
    name: 'Camellia', par: 4,
    path: [[0, 0], [-10, -200], [-60, -330], [-110, -440]],
    fairway: { from: 45, endGap: 26, width: 46 },
    green: { x: -112, y: -444, rx: 12, ry: 14, rot: 0.4 },
    bunkers: [
      { x: -66, y: -372, rx: 12, ry: 7, rot: 0.6 },
      { x: -97, y: -451, rx: 5, ry: 7, rot: 0.4 },
    ],
    treeClusters: [{ x: -60, y: -200, n: 20, spread: 24 }],
    flowers: [{ x: -140, y: -450, rx: 10, ry: 6 }],
    bounds: 72, trees: 0.8,
    slope: { tilt: [0.01, 0.004], bumps: [{ dx: -4, dy: -4, r: 5, h: 0.1 }] },
  },
  {
    name: 'White Dogwood', par: 4,
    path: [[0, 0], [0, -250], [15, -380], [20, -480]],
    fairway: { from: 45, endGap: 26, width: 42 },
    green: { x: 22, y: -484, rx: 13, ry: 14, rot: -0.3 },
    water: [{ x: 0, y: -474, rx: 10, ry: 18, rot: 0.1 }],
    bunkers: [{ x: 37, y: -496, rx: 5, ry: 4, rot: 0.4 }],
    treeClusters: [{ x: -25, y: -300, n: 10, spread: 16 }],
    bounds: 70, trees: 0.75,
    slope: { tilt: [0.012, 0.004], bumps: [] },
  },
  {
    name: 'Golden Bell', par: 3,
    path: [[0, 0], [0, -150]],
    fairway: { from: 136, endGap: 10, width: 34 },
    green: { x: 0, y: -153, rx: 17, ry: 7, rot: 0.22 },
    water: [{ line: [[-70, -122], [-30, -131], [0, -136], [30, -138], [70, -144]], w: 7 }],
    bunkers: [
      { x: 1, y: -144.5, rx: 6, ry: 2.4, rot: 0.2 },
      { x: -12, y: -164, rx: 6, ry: 2.6, rot: 0.25 },
      { x: 11, y: -165, rx: 6, ry: 2.6, rot: 0.25 },
    ],
    bridges: [{ x: -38, y: -129, ang: Math.PI / 2 - 0.2, len: 11 }],
    flowers: [{ x: -26, y: -176, rx: 14, ry: 5 }, { x: 26, y: -181, rx: 12, ry: 5 }, { x: 0, y: -186, rx: 10, ry: 4 }],
    bounds: 56, trees: 0.6,
    slope: { tilt: [0.003, -0.01], bumps: [] },
  },
  {
    name: 'Azalea', par: 5,
    path: [[0, 0], [0, -220], [-40, -320], [-110, -400], [-165, -465]],
    fairway: { from: 45, endGap: 36, width: 44 },
    green: { x: -167, y: -470, rx: 16, ry: 9, rot: -0.45 },
    water: [{ line: [[-46, -40], [-48, -170], [-70, -260], [-112, -330], [-140, -390], [-148, -430], [-140, -452], [-150, -458], [-178, -455], [-215, -460]], w: 6 }],
    bunkers: [
      { x: -183, y: -485, rx: 4, ry: 3, rot: 0.3 },
      { x: -172, y: -489, rx: 4, ry: 3, rot: 0 },
      { x: -160, y: -486, rx: 4, ry: 3, rot: -0.3 },
      { x: -150, y: -479, rx: 4, ry: 3, rot: -0.6 },
    ],
    bridges: [{ x: -144, y: -446, ang: 0.4, len: 9 }],
    flowers: [{ x: -70, y: -150, rx: 14, ry: 26 }, { x: -110, y: -270, rx: 18, ry: 12, rot: 0.6 }, { x: -200, y: -490, rx: 12, ry: 6 }],
    bounds: 72, trees: 0.7,
    slope: { tilt: [0.008, -0.004], bumps: [{ dx: 6, dy: 0, r: 5, h: 0.08 }], tiers: [{ dx: -2, dy: 0, ang: -0.45, h: 0.3, w: 1.4 }] },
  },
  {
    name: 'Chinese Fir', par: 4,
    path: [[0, 0], [3, -220], [-12, -410]],
    fairway: { from: 45, endGap: 22, width: 44 },
    green: { x: -13, y: -414, rx: 13, ry: 14, rot: 0 },
    bounds: 70, trees: 0.75,
    slope: { tilt: [-0.006, -0.008], bumps: [{ dx: 4, dy: -3, r: 4, h: 0.16 }, { dx: -5, dy: 3, r: 4, h: -0.12 }, { dx: -2, dy: -8, r: 3, h: 0.1 }], tiers: [{ dx: 0, dy: 10, ang: Math.PI / 2, h: -0.4, w: 1.2 }] },
  },
  {
    name: 'Firethorn', par: 5,
    path: [[0, 0], [5, -260], [-5, -420], [-8, -505]],
    fairway: { from: 45, endGap: 46, width: 44 },
    green: { x: -8, y: -508, rx: 10, ry: 15, rot: 0 },
    water: [{ x: -8, y: -480, rx: 24, ry: 8, rot: 0.03 }, { x: -12, y: -540, rx: 34, ry: 9, rot: 0.05 }],
    bunkers: [{ x: 7, y: -511, rx: 4, ry: 6, rot: 0 }],
    treeClusters: [{ x: 40, y: -330, n: 12, spread: 18 }],
    bounds: 70, trees: 0.7,
    slope: { tilt: [0.002, -0.012], bumps: [{ dx: 0, dy: -8, r: 4, h: 0.1 }] },
  },
  {
    name: 'Redbud', par: 3,
    path: [[0, 0], [-4, -165]],
    fairway: null,
    green: { x: -4, y: -168, rx: 15, ry: 11, rot: -0.35 },
    water: [{ x: -26, y: -95, rx: 22, ry: 82, rot: -0.04 }],
    bunkers: [
      { x: 12, y: -162, rx: 4, ry: 6, rot: -0.2 },
      { x: 6, y: -180, rx: 6, ry: 3, rot: -0.3 },
      { x: -20, y: -163, rx: 4, ry: 3, rot: 0.3 },
    ],
    flowers: [{ x: 30, y: -120, rx: 8, ry: 5 }],
    bounds: 62, trees: 0.6,
    slope: { tilt: [0.022, 0.003], bumps: [{ dx: 6, dy: -5, r: 4, h: 0.08 }], tiers: [{ dx: 0, dy: 0, ang: -0.35 + Math.PI / 2, h: -0.25, w: 1.5 }] },
  },
  {
    name: 'Nandina', par: 4,
    path: [[0, 0], [0, -210], [5, -410]],
    fairway: { from: 45, endGap: 22, width: 42 },
    green: { x: 5, y: -413, rx: 13, ry: 12, rot: 0 },
    bunkers: [
      { x: -6, y: -398, rx: 6, ry: 3.5, rot: -0.2 },
      { x: 15, y: -399, rx: 5, ry: 3.5, rot: 0.2 },
    ],
    bounds: 66, trees: 0.75,
    slope: { tilt: [-0.004, 0.01], bumps: [{ dx: -3, dy: 0, r: 5, h: 0.1 }] },
  },
  {
    name: 'Holly', par: 4,
    path: [[0, 0], [0, -230], [20, -330], [40, -430]],
    fairway: { from: 50, endGap: 24, width: 34 },
    green: { x: 41, y: -434, rx: 12, ry: 15, rot: -0.2 },
    bunkers: [
      { x: -18, y: -278, rx: 9, ry: 6, rot: 0.2 },
      { x: -10, y: -300, rx: 8, ry: 5, rot: 0.3 },
      { x: 28, y: -426, rx: 5, ry: 8, rot: 0.3 },
      { x: 55, y: -441, rx: 4, ry: 5, rot: -0.2 },
    ],
    flowers: [{ x: 80, y: -470, rx: 10, ry: 5 }],
    bounds: 50, trees: 1, roughW: 8,
    slope: { tilt: [0.002, -0.012], bumps: [], tiers: [{ dx: 0, dy: 1, ang: Math.PI / 2 + 0.2, h: -0.35, w: 1.3 }] },
  },
].map((h) => ({ ...h, course: 'augusta', treeStyle: 'pine', greenDecel: 0.5 }));


// St Andrews, the Old Course: nine of its most famous holes. No trees, just
// gorse, huge double greens, deep pot bunkers, firm fairways and sea wind.
const STANDREWS = [
  {
    name: 'Burn', par: 4,
    path: [[0, 0], [0, -200], [0, -350]],
    fairway: { from: 25, endGap: 26, width: 80 },
    green: { x: 0, y: -353, rx: 17, ry: 12, rot: 0 },
    water: [{ line: [[-70, -327], [-20, -333], [20, -330], [70, -326]], w: 5 }],
    bridges: [{ x: -34, y: -329, ang: Math.PI / 2, len: 8 }],
    bunkers: [],
    bounds: 70,
    slope: { tilt: [0.003, -0.006], bumps: [{ dx: -4, dy: -3, r: 5, h: 0.06 }] },
  },
  {
    name: 'Dyke', par: 4,
    path: [[0, 0], [5, -220], [25, -420]],
    fairway: { from: 30, endGap: 22, width: 52 },
    green: { x: 28, y: -424, rx: 23, ry: 14, rot: -0.3 },
    bunkers: [
      { x: -12, y: -182, rx: 3, ry: 2.6, rot: 0 },
      { x: 22, y: -258, rx: 3, ry: 3, rot: 0 },
      { x: 8, y: -300, rx: 3, ry: 2.6, rot: 0 },
      { x: 14, y: -402, rx: 3, ry: 2.6, rot: 0 },
    ],
    bounds: 66,
    slope: { tilt: [-0.006, -0.004], bumps: [{ dx: 8, dy: 2, r: 5, h: 0.14 }, { dx: -8, dy: -3, r: 4, h: -0.1 }] },
  },
  {
    name: "Hole O'Cross", par: 5,
    path: [[0, 0], [0, -250], [-10, -400], [-5, -530]],
    fairway: { from: 30, endGap: 26, width: 56 },
    green: { x: -5, y: -534, rx: 26, ry: 16, rot: 0.2 },
    bunkers: [
      { x: -14, y: -300, rx: 3, ry: 2.6, rot: 0 },
      { x: -6, y: -308, rx: 3, ry: 2.6, rot: 0 },
      { x: 8, y: -298, rx: 3, ry: 2.6, rot: 0 },
      { x: -18, y: -478, rx: 3.2, ry: 2.6, rot: 0 },
      { x: -10, y: -480, rx: 3.2, ry: 2.6, rot: 0 },
    ],
    bounds: 70,
    slope: { tilt: [0.004, 0.006], bumps: [{ dx: 10, dy: 0, r: 6, h: 0.14 }, { dx: -12, dy: 2, r: 5, h: -0.1 }] },
  },
  {
    name: 'High', par: 3,
    path: [[0, 0], [0, -162]],
    fairway: { from: 110, endGap: 14, width: 34 },
    green: { x: 0, y: -165, rx: 18, ry: 10, rot: 0.3 },
    bunkers: [
      { x: 8, y: -154, rx: 3.5, ry: 3, rot: 0 },
      { x: -15, y: -167, rx: 4, ry: 3, rot: 0 },
    ],
    bounds: 60,
    slope: { tilt: [0.004, -0.024], bumps: [] },
  },
  {
    name: 'Heathery', par: 4,
    path: [[0, 0], [0, -325]],
    fairway: { from: 30, endGap: 18, width: 56 },
    green: { x: 0, y: -328, rx: 20, ry: 9, rot: 0.1 },
    bunkers: [
      { x: -6, y: -210, rx: 3, ry: 2.6, rot: 0 },
      { x: 8, y: -232, rx: 3, ry: 2.6, rot: 0 },
      { x: -2, y: -256, rx: 3, ry: 2.6, rot: 0 },
      { x: 12, y: -276, rx: 3, ry: 2.6, rot: 0 },
    ],
    bounds: 64,
    slope: { tilt: [0.002, -0.004], bumps: [], tiers: [{ dx: 0, dy: 0, ang: Math.PI / 2 - 0.1, h: -0.22, w: 1.6 }] },
  },
  {
    name: 'Long', par: 5,
    path: [[0, 0], [10, -250], [0, -430], [-15, -575]],
    fairway: { from: 30, endGap: 26, width: 54 },
    green: { x: -16, y: -579, rx: 24, ry: 16, rot: 0 },
    bunkers: [
      { x: -14, y: -228, rx: 3, ry: 2.6, rot: 0 },
      { x: -7, y: -236, rx: 3, ry: 2.6, rot: 0 },
      { x: -18, y: -240, rx: 3, ry: 2.6, rot: 0 },
      { x: -4, y: -430, rx: 12, ry: 8, rot: 0.1 },
      { x: -28, y: -560, rx: 3, ry: 2.6, rot: 0 },
    ],
    bounds: 70,
    slope: { tilt: [0.006, 0.008], bumps: [{ dx: 0, dy: -6, r: 6, h: 0.16 }] },
  },
  {
    name: 'Corner of the Dyke', par: 4,
    path: [[0, 0], [0, -200], [6, -390]],
    fairway: { from: 30, endGap: 22, width: 50 },
    green: { x: 6, y: -393, rx: 20, ry: 13, rot: 0.2 },
    bunkers: [
      { x: -12, y: -230, rx: 3, ry: 3, rot: 0 },
      { x: -5, y: -238, rx: 3, ry: 3, rot: 0 },
      { x: 2, y: -226, rx: 3, ry: 2.6, rot: 0 },
      { x: -8, y: -378, rx: 3, ry: 2.6, rot: 0 },
    ],
    bounds: 58,
    slope: { tilt: [-0.008, 0.004], bumps: [{ dx: 5, dy: 3, r: 5, h: 0.1 }] },
  },
  {
    name: 'Road', par: 4,
    path: [[0, 0], [-15, -220], [0, -350], [15, -455]],
    fairway: { from: 30, endGap: 22, width: 46 },
    green: { x: 16, y: -458, rx: 20, ry: 6, rot: -0.5 },
    bunkers: [{ x: 6, y: -453, rx: 3.5, ry: 3.5, rot: 0 }],
    bounds: 52,
    slope: { tilt: [-0.012, 0.004], bumps: [] },
  },
  {
    name: 'Tom Morris', par: 4,
    path: [[0, 0], [0, -335]],
    fairway: { from: 20, endGap: 20, width: 84 },
    green: { x: 0, y: -339, rx: 18, ry: 14, rot: 0 },
    water: [{ line: [[-60, -38], [0, -42], [60, -40]], w: 4.5 }],
    bridges: [{ x: -12, y: -41, ang: Math.PI / 2, len: 9 }],
    bunkers: [],
    bounds: 66,
    slope: { tilt: [0.002, -0.006], bumps: [], tiers: [{ dx: 0, dy: 10, ang: Math.PI / 2, h: -0.5, w: 2 }] },
  },
].map((h) => ({ ...h, course: 'standrews', treeStyle: 'gorse', trees: 0, firm: 1.35, windMul: 1.5 }));

// Pebble Beach: holes along the Pacific cliffs. The ocean is on the right
// for most of them, and the 18th hugs the sea down the left.
const sea = (x, y, rx, ry, rot = 0) => ({ x, y, rx, ry, rot, sea: true });
const PEBBLE = [
  {
    name: 'Stillwater Cove', par: 4,
    path: [[0, 0], [0, -180], [5, -310]],
    fairway: { from: 40, endGap: 20, width: 34 },
    green: { x: 5, y: -313, rx: 9, ry: 12, rot: 0 },
    water: [sea(70, -230, 30, 120, -0.05)],
    bunkers: [{ x: -14, y: -180, rx: 6, ry: 4, rot: 0 }, { x: -7, y: -306, rx: 4, ry: 6, rot: 0 }],
    bounds: 62, trees: 0.4,
    slope: { tilt: [0.004, -0.012], bumps: [] },
  },
  {
    name: 'Ocean Rise', par: 3,
    path: [[0, 0], [2, -180]],
    fairway: { from: 120, endGap: 14, width: 26 },
    green: { x: 2, y: -183, rx: 12, ry: 10, rot: 0.2 },
    water: [sea(52, -130, 22, 90)],
    bunkers: [{ x: -10, y: -172, rx: 5, ry: 4, rot: 0.2 }],
    bounds: 58, trees: 0.5,
    slope: { tilt: [0.008, -0.006], bumps: [] },
  },
  {
    name: 'The Hill', par: 5,
    path: [[0, 0], [0, -250], [-10, -400], [-5, -480]],
    fairway: { from: 40, endGap: 24, width: 40 },
    green: { x: -5, y: -483, rx: 11, ry: 12, rot: 0 },
    water: [sea(62, -260, 28, 130, 0.08)],
    bunkers: [{ x: -26, y: -230, rx: 8, ry: 5, rot: 0.2 }, { x: 8, y: -489, rx: 4, ry: 5, rot: 0 }],
    bounds: 64, trees: 0.45,
    slope: { tilt: [0.006, 0.008], bumps: [] },
  },
  {
    name: 'The Little Seventh', par: 3,
    path: [[0, 0], [2, -100]],
    fairway: null,
    green: { x: 2, y: -102, rx: 8, ry: 9, rot: 0 },
    water: [sea(30, -100, 18, 40), sea(-26, -118, 14, 24), sea(2, -135, 40, 14)],
    bunkers: [
      { x: -7, y: -96, rx: 3.5, ry: 6, rot: 0 },
      { x: 11, y: -98, rx: 3, ry: 5, rot: 0 },
      { x: 0, y: -113, rx: 6, ry: 2.5, rot: 0 },
    ],
    bounds: 44, trees: 0.2,
    slope: { tilt: [0.0, 0.006], bumps: [] },
  },
  {
    name: 'The Chasm', par: 4,
    path: [[0, 0], [0, -250], [-8, -400]],
    fairway: { from: 40, endGap: 70, width: 38 },
    green: { x: -8, y: -403, rx: 10, ry: 11, rot: 0 },
    water: [sea(50, -330, 50, 26, 0.3), sea(70, -230, 26, 100)],
    bunkers: [{ x: 6, y: -398, rx: 4, ry: 6, rot: 0 }, { x: -20, y: -412, rx: 5, ry: 3, rot: 0.3 }],
    bounds: 62, trees: 0.4,
    slope: { tilt: [0.004, 0.014], bumps: [] },
  },
  {
    name: 'Carmel Bay', par: 4,
    path: [[0, 0], [0, -250], [-6, -470]],
    fairway: { from: 40, endGap: 22, width: 36 },
    green: { x: -6, y: -473, rx: 10, ry: 13, rot: 0 },
    water: [sea(60, -260, 26, 210)],
    bunkers: [{ x: -20, y: -470, rx: 5, ry: 7, rot: 0 }],
    bounds: 62, trees: 0.4,
    slope: { tilt: [0.012, 0.004], bumps: [] },
  },
  {
    name: 'Cliff Edge', par: 4,
    path: [[0, 0], [-5, -230], [5, -415]],
    fairway: { from: 40, endGap: 22, width: 36 },
    green: { x: 5, y: -418, rx: 11, ry: 12, rot: 0 },
    water: [sea(62, -240, 26, 200)],
    bunkers: [{ x: -26, y: -250, rx: 9, ry: 5, rot: 0.2 }, { x: -8, y: -412, rx: 4, ry: 6, rot: 0 }],
    bounds: 62, trees: 0.4,
    slope: { tilt: [0.012, -0.004], bumps: [] },
  },
  {
    name: 'Hourglass', par: 3,
    path: [[0, 0], [0, -166]],
    fairway: { from: 110, endGap: 16, width: 30 },
    green: { x: 0, y: -169, rx: 18, ry: 7, rot: 0.6 },
    water: [sea(0, -205, 70, 18)],
    bunkers: [
      { x: -6, y: -158, rx: 9, ry: 3, rot: 0.6 },
      { x: 12, y: -178, rx: 4, ry: 3, rot: 0.6 },
    ],
    bounds: 60, trees: 0.4,
    slope: { tilt: [0.004, 0.006], bumps: [], tiers: [{ dx: 0, dy: 0, ang: 0.6, h: 0.3, w: 1.4 }] },
  },
  {
    name: 'The Cypress Finish', par: 5,
    path: [[0, 0], [10, -230], [0, -400], [10, -505]],
    fairway: { from: 40, endGap: 24, width: 40 },
    green: { x: 11, y: -508, rx: 11, ry: 13, rot: 0 },
    water: [sea(-60, -260, 26, 270)],
    bunkers: [
      { x: -14, y: -500, rx: 5, ry: 9, rot: 0 },
      { x: 26, y: -505, rx: 4, ry: 5, rot: 0 },
      { x: 30, y: -300, rx: 8, ry: 5, rot: 0.2 },
    ],
    treeClusters: [{ x: 15, y: -240, n: 1, spread: 1 }],
    bounds: 62, trees: 0.4,
    slope: { tilt: [-0.006, -0.01], bumps: [] },
  },
].map((h) => ({ ...h, course: 'pebble', treeStyle: 'cypress', windMul: 1.3 }));

// TPC Sawgrass, the Stadium Course: water on almost every hole, sandy waste
// areas, palms, and the island-green 17th.
const SAWGRASS = [
  {
    name: 'Lagoon', par: 4,
    path: [[0, 0], [0, -200], [-6, -360]],
    fairway: { from: 40, endGap: 22, width: 34 },
    green: { x: -6, y: -363, rx: 10, ry: 13, rot: 0 },
    water: [{ x: -34, y: -350, rx: 14, ry: 30, rot: 0 }],
    bunkers: [{ x: 10, y: -370, rx: 4, ry: 5, rot: 0 }, { x: 24, y: -190, rx: 7, ry: 5, rot: 0 }],
    bounds: 56, trees: 0.5,
    slope: { tilt: [-0.008, 0.004], bumps: [] },
  },
  {
    name: 'Waste Area', par: 4,
    path: [[0, 0], [0, -230], [10, -410]],
    fairway: { from: 40, endGap: 22, width: 34 },
    green: { x: 10, y: -413, rx: 11, ry: 12, rot: 0 },
    bunkers: [{ x: -26, y: -260, rx: 9, ry: 60, rot: 0.05 }, { x: 24, y: -410, rx: 4, ry: 6, rot: 0 }],
    bounds: 58, trees: 0.55,
    slope: { tilt: [0.004, -0.01], bumps: [] },
  },
  {
    name: 'Long Iron', par: 3,
    path: [[0, 0], [0, -220]],
    fairway: { from: 160, endGap: 14, width: 26 },
    green: { x: 0, y: -223, rx: 13, ry: 11, rot: 0 },
    bunkers: [{ x: -14, y: -215, rx: 5, ry: 7, rot: 0 }, { x: 13, y: -232, rx: 5, ry: 3, rot: 0 }],
    bounds: 56, trees: 0.55,
    slope: { tilt: [0.006, -0.006], bumps: [] },
  },
  {
    name: 'Long Ninth', par: 5,
    path: [[0, 0], [0, -260], [-15, -420], [-20, -540]],
    fairway: { from: 40, endGap: 24, width: 36 },
    green: { x: -20, y: -543, rx: 10, ry: 13, rot: 0 },
    water: [{ line: [[-60, -330], [-10, -335], [40, -330]], w: 5 }],
    bunkers: [{ x: 22, y: -265, rx: 7, ry: 5, rot: 0 }, { x: -8, y: -535, rx: 4, ry: 6, rot: 0 }],
    bounds: 60, trees: 0.5,
    slope: { tilt: [-0.006, 0.008], bumps: [] },
  },
  {
    name: 'Risk and Reward', par: 5,
    path: [[0, 0], [0, -240], [20, -400], [20, -520]],
    fairway: { from: 40, endGap: 24, width: 36 },
    green: { x: 20, y: -523, rx: 11, ry: 12, rot: 0 },
    water: [{ x: -14, y: -480, rx: 18, ry: 60, rot: 0.05 }],
    bunkers: [{ x: 36, y: -520, rx: 4, ry: 6, rot: 0 }, { x: 36, y: -260, rx: 7, ry: 6, rot: 0 }],
    bounds: 60, trees: 0.5,
    slope: { tilt: [-0.01, 0.002], bumps: [] },
  },
  {
    name: 'Pond Thirteen', par: 3,
    path: [[0, 0], [0, -168]],
    fairway: null,
    green: { x: 0, y: -171, rx: 13, ry: 10, rot: 0.2 },
    water: [{ x: -26, y: -150, rx: 16, ry: 40, rot: 0.1 }],
    bunkers: [{ x: 14, y: -178, rx: 4, ry: 5, rot: 0 }],
    bounds: 54, trees: 0.5,
    slope: { tilt: [-0.012, -0.004], bumps: [] },
  },
  {
    name: 'Sixteen', par: 5,
    path: [[0, 0], [0, -250], [-20, -390], [-15, -490]],
    fairway: { from: 40, endGap: 24, width: 38 },
    green: { x: -15, y: -493, rx: 11, ry: 13, rot: 0 },
    water: [{ x: 22, y: -470, rx: 16, ry: 50, rot: 0 }],
    bunkers: [{ x: -30, y: -490, rx: 4, ry: 6, rot: 0 }],
    treeClusters: [{ x: -34, y: -410, n: 3, spread: 4 }],
    bounds: 60, trees: 0.5,
    slope: { tilt: [0.01, -0.004], bumps: [] },
  },
  {
    name: 'Island Green', par: 3,
    path: [[0, 0], [0, -128]],
    fairway: null,
    green: { x: 0, y: -129, rx: 12, ry: 10, rot: 0 },
    water: [{ x: 0, y: -116, rx: 34, ry: 40, rot: 0 }],
    bunkers: [{ x: -4, y: -116, rx: 3, ry: 1.8, rot: 0.3 }],
    bounds: 56, trees: 0.4,
    slope: { tilt: [0.004, -0.008], bumps: [] },
  },
  {
    name: 'The Finisher', par: 4,
    path: [[0, 0], [-10, -230], [-30, -420]],
    fairway: { from: 40, endGap: 22, width: 34 },
    green: { x: -31, y: -423, rx: 11, ry: 13, rot: 0 },
    water: [{ line: [[-40, -40], [-44, -150], [-50, -260], [-62, -360], [-58, -440]], w: 18 }],
    bunkers: [{ x: -16, y: -428, rx: 4, ry: 6, rot: 0 }, { x: 18, y: -240, rx: 7, ry: 5, rot: 0 }],
    bounds: 60, trees: 0.5,
    slope: { tilt: [0.008, -0.006], bumps: [] },
  },
].map((h) => ({ ...h, course: 'sawgrass', treeStyle: 'palm' }));

export const HOLES = [...LINKS, ...AUGUSTA, ...STANDREWS, ...PEBBLE, ...SAWGRASS];

const range = (a, n) => [...Array(n).keys()].map((i) => a + i);
export const COURSES = [
  {
    id: 'links', name: 'Pocket Links', holes: range(0, LINKS.length),
    blurb: 'Nine friendly holes with ponds, creeks and an island green.',
    signature: 6,
  },
  {
    id: 'augusta', name: 'Augusta National', holes: range(LINKS.length, AUGUSTA.length),
    blurb: 'Towering pines, white sand, Amen Corner and lightning-fast, tiered greens.',
    nines: true, signature: 11,
  },
  {
    id: 'standrews', name: 'St Andrews', holes: range(LINKS.length + AUGUSTA.length, STANDREWS.length),
    blurb: 'Nine famous holes of the Old Course: no trees, gorse, pot bunkers, huge greens, firm ground and strong sea wind.',
    signature: 8,
  },
  {
    id: 'pebble', name: 'Pebble Beach', holes: range(LINKS.length + AUGUSTA.length + STANDREWS.length, PEBBLE.length),
    blurb: 'Clifftop holes beside the Pacific, from the tiny 7th to the 18th along the sea wall.',
    signature: 3,
  },
  {
    id: 'sawgrass', name: 'TPC Sawgrass', holes: range(LINKS.length + AUGUSTA.length + STANDREWS.length + PEBBLE.length, SAWGRASS.length),
    blurb: 'Stadium golf: water on nearly every hole, sandy waste areas, palms and the island-green 17th.',
    signature: 7,
  },
];

export function courseOf(holeIndex) {
  return COURSES.find((c) => c.holes.includes(holeIndex)) || COURSES[0];
}

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
    course: spec.course || 'links', greenDecel: spec.greenDecel ?? null, firm: spec.firm || 1,
    style: spec.treeStyle || 'oak',
    flowers: spec.flowers || [], bridges: spec.bridges || [],
  };
  hole.lieName = (t) => {
    if (t === T.DEEP && spec.treeStyle === 'pine') return 'Pine straw';
    if (t === T.DEEP && spec.treeStyle === 'gorse') return 'Gorse';
    if (t === T.WATER && hole.water.some((w) => w.sea)) return 'Ocean';
    return TERRAIN_NAMES[t];
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
  // Tiers: a smooth step of height h across a line through (dx, dy), rising
  // in direction ang over a width of about w yards.
  for (const t of h.slope.tiers || []) {
    const c = Math.cos(t.ang), s = Math.sin(t.ang);
    const u = ((x - g.x - t.dx) * c + (y - g.y - t.dy) * s) / t.w;
    const th = Math.tanh(u);
    const d = (t.h * 0.5 * (1 - th * th)) / t.w;
    gx += d * c;
    gy += d * s;
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
  const style = spec.treeStyle || 'oak';
  const pine = style === 'pine';
  const add = (x, y, big = 1) => {
    // base: height of the lowest branches; a punch shot can run under them.
    // Augusta's tall pines have high branches, so you can often punch under.
    if (pine) h.trees.push({ x, y, r: (3.6 + r() * 2.4) * big, h: 20 + r() * 12, base: 4.5 + r() * 3, shade: r(), pine: true });
    else if (style === 'palm') h.trees.push({ x, y, r: (2.6 + r() * 1.2) * big, h: 10 + r() * 6, base: 6 + r() * 2, shade: r(), palm: true });
    else if (style === 'cypress') h.trees.push({ x, y, r: (4.5 + r() * 3) * big, h: 9 + r() * 5, base: 2.2 + r() * 1.5, shade: r(), cypress: true });
    else h.trees.push({ x, y, r: (3.2 + r() * 3.2) * big, h: 11 + r() * 9, base: 2.6 + r() * 1.8, shade: r() });
  };
  const clearOf = (x, y) => {
    if (Math.hypot(x - h.tee.x, y - h.tee.y) < 22 || inEllipse(x, y, h.green, FRINGE_W + 7)) return false;
    for (const f of spec.flowers || []) if (inEllipse(x, y, f, 1)) return false;
    const [d, s] = h.nearest(x, y);
    return d > h.halfWidth(s) + 5; // keep the line of play open
  };
  // Links courses have no trees at all, only gorse (painted, not solid).
  for (let y = style === 'gorse' ? Infinity : minY; y < maxY; y += step) {
    for (let x = minX; x < maxX; x += step) {
      const px = x + (r() - 0.5) * step, py = y + (r() - 0.5) * step;
      const roll = r();
      const t = terrainAt(h, px, py);
      if (!clearOf(px, py)) continue;
      if (t === T.DEEP && roll < density * (pine ? 0.3 : style === 'palm' || style === 'cypress' ? 0.25 : 0.45)) add(px, py);
      else if (t === T.OB && roll < 0.35) add(px, py, 1.15);
      else if (t === T.ROUGH && roll < density * 0.04) add(px, py);
    }
  }
  for (const c of spec.treeClusters || []) {
    for (let i = 0; i < c.n; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * c.spread;
      const px = c.x + Math.cos(a) * d, py = c.y + Math.sin(a) * d;
      const t = terrainAt(h, px, py);
      // A single-tree cluster (like Pebble's cypress on 18) may stand in the fairway.
      if (c.n === 1 ? t !== T.WATER : t !== T.FAIRWAY && t !== T.WATER && t !== T.SAND && clearOf(px, py)) add(px, py, 1.1);
    }
  }
  // Trees overlap water or bunkers badly; keep them on grass.
  const lone = new Set((spec.treeClusters || []).filter((c) => c.n === 1).map((c) => `${c.x},${c.y}`));
  h.trees = h.trees.filter((t) => {
    const k = terrainAt(h, t.x, t.y);
    if (k === T.FAIRWAY && [...lone].some((key) => { const [cx, cy] = key.split(',').map(Number); return Math.hypot(t.x - cx, t.y - cy) < 3; })) return true;
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
  // Links and clifftop courses are windier.
  const speed = Math.round((2 + r() * 13) * (HOLES[index] && HOLES[index].windMul ? HOLES[index].windMul : 1));
  return { speed, dir: r() * Math.PI * 2 };
}
