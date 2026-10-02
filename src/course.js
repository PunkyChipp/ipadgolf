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

// Augusta National as it plays at the Masters (2024-26 tees, real yardages:
// the centre line from tee to green centre is the card yardage). Pines line
// every hole, the sand is white, the greens are fast and tiered, there is no
// water on the front nine, and Rae's Creek runs through Amen Corner.
//
// Coordinates as everywhere else: yards, tee at (0, 0), play heads towards
// -y, and +x is the player's RIGHT when standing on the tee looking at the
// green (sim.js: right of aim (dx, dy) is (-dy, dx)). Angles are atan2(dy, dx)
// in these world coordinates (so -PI/2 points from the tee towards the green
// on a straight hole). Extra optional fields, used only by the renderers (the
// simulation ignores them; other courses leave them out):
//
//   elev: [[s, h], ...]  Ground height along the centre line: s = yards along
//     the path from the tee, h = height in yards relative to the tee. Smooth
//     it (e.g. monotone cubic or cosine) between points; clamp beyond the
//     ends. hole.heightAt(x, y) / hole.elevAt(s) give ready-made samples.
//   cant: [[s, c], ...]  Optional cross-slope along the hole: rise in yards
//     per yard towards the player's right (10 and 13 fall right-to-left).
//   mounds: [{ x, y, rx, ry, rot, h }]  Grassy humps (h yards high at the
//     centre, smooth falloff to the ellipse edge), e.g. around the 8th green.
//   gallery: [{ line: [[x, y], ...], side: 1 | -1, rows: 1..5 }]  Patrons
//     standing behind the ropes. The line is the rope (front row); the crowd
//     extends `rows` deep (about 1.2 yd per row) to the side given by `side`:
//     +1 = the right-hand normal (-dy, dx) of the line's direction of travel
//     from its first point to its last, -1 = the left-hand normal. It always
//     points away from the hole. Trees are kept off the crowd band.
//   landmarks: [{ kind, x, y, ang, len? }]  Fixed set pieces. ang is the way
//     the object faces (its front points along ang). kinds: 'clubhouse' (the
//     white antebellum clubhouse, behind 9/18 greens and the 1st tee), 'oak'
//     (the Big Oak Tree on the clubhouse lawn), 'leaderboard' (big white
//     manual scoreboard), 'scoreboard-small', 'camera-tower' (TV scaffold),
//     'hogan-bridge' (12), 'nelson-bridge' (13 tee), 'sarazen-bridge' (15).
//     The three bridge landmarks carry `len` and sit exactly on the matching
//     `bridges` entry (which has the same position, ang and len, plus
//     style: 'stone' and name: 'hogan' | 'nelson' | 'sarazen'); draw the
//     named model there instead of the plain plank.
//   bridges[].style: 'stone'  Stone footbridge (all Augusta bridges).
//   species: [{ kind, x, y, rx, ry, n }]  Patches of notable plantings among
//     the pines: 'dogwood' | 'magnolia' | 'azalea' | 'loblolly' | 'cherry' |
//     'holly'. Except for 'azalea' (low shrubs, drawn with or like `flowers`
//     beds; no collision), buildHole places n real, collidable trees inside
//     the ellipse with t.kind set (and t.pine for loblolly), and keeps the
//     default pines out of every patch. Default trees stay tall loblolly
//     pines (treeStyle 'pine').
//   secondCut: true (course-wide)  Augusta's "rough" is a short second cut
//     (roughW 6-8 yd); beyond it is pine straw (T.DEEP, lieName 'Pine straw').
const AUGUSTA = [
  {
    name: 'Tea Olive', par: 4,
    path: [[0, 0], [0, -159.7], [8, -299.4], [22, -444.1]],
    fairway: { from: 40, endGap: 22, width: 40 },
    green: { x: 22, y: -444.1, rx: 11, ry: 15, rot: 0.102 },
    bunkers: [{ x: 39.9, y: -309.1, rx: 8, ry: 16, rot: 0.134 }, { x: 7.5, y: -439.6, rx: 5, ry: 8, rot: 0.452 }],
    treeClusters: [{ x: -38.8, y: -232.4, n: 10, spread: 16 }],
    flowers: [{ x: -5.2, y: -473, rx: 9, ry: 4, rot: 0.402 }],
    mounds: [{ x: 32.4, y: -467.2, rx: 9, ry: 5, rot: 0.102, h: 1.2 }, { x: 44.3, y: -445.8, rx: 6, ry: 9, rot: 0.102, h: 1 }],
    species: [{ kind: 'magnolia', x: -39.9, y: 30.1, rx: 10, ry: 8, n: 3 }, { kind: 'dogwood', x: -12.8, y: -457.7, rx: 10, ry: 7, n: 4 }],
    bounds: 70,
    trees: 0.75,
    roughW: 7,
    slope: { tilt: [-0.002, -0.011], bumps: [{ dx: -6.3, dy: 2.4, r: 5, h: 0.1 }], tiers: [{ dx: -0.9, dy: 9, ang: -1.469, h: 0.32, w: 1.4 }] },
    elev: [[0, 0], [120, -3], [250, 0], [350, 5], [445, 10]],
    gallery: [
      { line: [[15.8, 2.7], [14.5, 6.7], [12.3, 10.3], [9.2, 13.1], [5.5, 15], [1.4, 15.9], [-2.7, 15.8], [-6.7, 14.5], [-10.3, 12.3], [-13.1, 9.2], [-15, 5.5]], side: -1, rows: 4 },
      { line: [[-35.5, -201.7], [-34.3, -224.5], [-32.9, -247.3], [-31.3, -270], [-29.6, -292.6], [-27.8, -315.3], [-25.8, -338], [-23.7, -360.6], [-21.4, -383.1]], side: -1, rows: 2 },
      { line: [[38.4, -198.2], [39.6, -220.3], [41, -242.5], [42.5, -264.7], [44.2, -287], [53.9, -308.4], [47.9, -331.2], [50, -353.4], [52.2, -375.7]], side: 1, rows: 2 },
      { line: [[1.1, -461.3], [4.8, -466], [9.3, -469.8], [14.3, -472.4], [19.6, -473.8], [25.1, -473.9], [30.4, -472.7], [35.3, -470.3], [39.7, -466.7], [43.3, -462.1], [45.9, -456.7], [47.5, -450.8], [48, -444.6], [47.4, -438.4], [45.7, -432.4], [42.9, -426.9]], side: -1, rows: 3 },
    ],
    landmarks: [
      { kind: 'oak', x: -29.9, y: 40.1, ang: -0.929 },
      { kind: 'clubhouse', x: -14.8, y: 95, ang: -1.516 },
      { kind: 'scoreboard-small', x: 53.6, y: -266.3, ang: -3.069 },
    ],
  },
  {
    name: 'Pink Dogwood', par: 5,
    path: [[0, 0], [3, -208.9], [-11.9, -328.3], [-69.6, -457.6], [-124.3, -557.1]],
    fairway: { from: 50, endGap: 26, width: 44 },
    green: { x: -124.3, y: -557.1, rx: 16, ry: 11, rot: -0.517 },
    bunkers: [
      { x: 27.7, y: -306.1, rx: 10, ry: 19, rot: -0.149 },
      { x: -133.8, y: -541.4, rx: 7, ry: 9, rot: -0.917 },
      { x: -107.7, y: -564.3, rx: 6, ry: 10, rot: -0.267 },
    ],
    treeClusters: [{ x: -51.7, y: -290, n: 18, spread: 22 }],
    flowers: [{ x: -160.7, y: -568.6, rx: 10, ry: 5, rot: -0.317 }],
    species: [
      { kind: 'dogwood', x: -37.7, y: -90.9, rx: 12, ry: 22, n: 7 },
      { kind: 'dogwood', x: 43.2, y: -139.4, rx: 10, ry: 18, n: 5 },
      { kind: 'dogwood', x: -121.7, y: -593.1, rx: 12, ry: 8, n: 4 },
    ],
    bounds: 72,
    trees: 0.75,
    roughW: 8,
    slope: { tilt: [0.001, -0.01], bumps: [{ dx: -6.2, dy: 1.2, r: 5, h: -0.08 }, { dx: 6.6, dy: -2.6, r: 4, h: 0.06 }] },
    elev: [[0, 0], [120, -6], [260, -14], [330, -16], [450, -22], [585, -26]],
    gallery: [
      { line: [[15.7, 3], [14.4, 7], [12.1, 10.5], [9, 13.3], [5.2, 15.1], [1.1, 16], [-3, 15.7], [-7, 14.4], [-10.5, 12.1], [-13.3, 9], [-15.1, 5.2]], side: -1, rows: 3 },
      { line: [[-37.8, -218.4], [-38.5, -235.6], [-39.4, -252.2], [-40.7, -268.2], [-42.7, -282.9], [-45.7, -297.9], [-49.5, -312.8], [-54, -327.4], [-59.5, -342]], side: -1, rows: 2 },
      { line: [[43.6, -200.8], [43.1, -218.9], [42.4, -236.7], [41.4, -254.9], [39.9, -273.8], [41.4, -294], [41.6, -314.7], [29, -332.2], [23.3, -351]], side: 1, rows: 2 },
      { line: [[-10.4, -429.3], [-17.2, -443], [-23.9, -456.5], [-30.5, -469.8], [-37.4, -483.6], [-44.6, -497.5], [-51.9, -511.1], [-59.4, -524.6], [-66.9, -537.9]], side: 1, rows: 2 },
      { line: [[-155, -550.3], [-155, -556.1], [-153.6, -562], [-150.9, -567.7], [-147.1, -572.9], [-142.3, -577.5], [-136.7, -581.1], [-130.5, -583.7], [-124.1, -585.1], [-117.7, -585.3], [-111.6, -584.3], [-106, -582.1], [-101.2, -578.8], [-97.5, -574.5], [-94.9, -569.5], [-93.6, -563.9]], side: -1, rows: 3 },
    ],
    landmarks: [{ kind: 'scoreboard-small', x: -65.4, y: -544.5, ang: -2.932 }],
  },
  {
    name: 'Flowering Peach', par: 4,
    path: [[0, 0], [1, -169.8], [-7, -264.6], [-3, -349.5]],
    fairway: { from: 40, endGap: 20, width: 40 },
    green: { x: -3, y: -349.5, rx: 9, ry: 14, rot: -0.488 },
    bunkers: [
      { x: -19.9, y: -236, rx: 4, ry: 3.5, rot: 0.087 },
      { x: -31.1, y: -247.7, rx: 4, ry: 3.5, rot: -0.379 },
      { x: -18.9, y: -261.2, rx: 3.5, ry: 3, rot: 0.463 },
      { x: -29.1, y: -273.8, rx: 4, ry: 3, rot: 0.007 },
      { x: -13.5, y: -341.1, rx: 6, ry: 4, rot: 0.562 },
    ],
    flowers: [{ x: 26.1, y: -365.7, rx: 8, ry: 5, rot: 0.262 }],
    mounds: [{ x: -18, y: -366.5, rx: 8, ry: 5, rot: 0.062, h: 1.2 }],
    species: [{ kind: 'cherry', x: 28.3, y: -369.6, rx: 12, ry: 8, n: 5 }, { kind: 'cherry', x: 34.8, y: -59.6, rx: 10, ry: 10, n: 3 }],
    bounds: 66,
    trees: 0.7,
    roughW: 7,
    slope: { tilt: [0.005, -0.006], bumps: [{ dx: -4.1, dy: 1.7, r: 4, h: -0.08 }], tiers: [{ dx: -0.5, dy: 8, ang: -1.509, h: 0.38, w: 1.2 }] },
    elev: [[0, 0], [150, 1], [260, 4], [350, 9]],
    gallery: [
      { line: [[15.7, 2.9], [14.4, 6.9], [12.2, 10.4], [9.1, 13.2], [5.4, 15.1], [1.3, 15.9], [-2.9, 15.7], [-6.9, 14.4], [-10.4, 12.2], [-13.2, 9.1], [-15.1, 5.4]], side: -1, rows: 2 },
      { line: [[-36.3, -178.2], [-37.2, -192], [-38.5, -205.8], [-40.2, -220.3], [-42, -235.6], [-43.5, -252.3], [-44.1, -269.3], [-43.9, -285.7], [-43.2, -301.5]], side: -1, rows: 2 },
      { line: [[37.6, -181.8], [36.6, -197.9], [35.1, -213.9], [33.3, -229.3], [31.5, -243.7], [30.4, -257], [29.9, -269.9], [30.1, -283.5], [30.7, -297.7]], side: 1, rows: 2 },
      { line: [[-25.3, -355.8], [-23.6, -361.3], [-21.1, -366.3], [-17.7, -370.6], [-13.7, -374], [-9.2, -376.2], [-4.5, -377.4], [0.3, -377.3], [5, -376], [9.3, -373.5], [13.1, -370], [16.2, -365.6], [18.4, -360.5], [19.7, -354.9], [20, -349.1], [19.3, -343.2], [17.6, -337.7]], side: -1, rows: 3 },
    ],
    landmarks: [],
  },
  {
    name: 'Flowering Crab Apple', par: 3,
    path: [[0, 0], [0, -240]],
    fairway: { from: 175, endGap: 14, width: 28 },
    green: { x: 0, y: -240, rx: 15, ry: 12, rot: 0.05 },
    bunkers: [{ x: 15, y: -229, rx: 8, ry: 6, rot: -0.4 }, { x: -13, y: -252, rx: 7, ry: 3.5, rot: 0.3 }],
    species: [{ kind: 'dogwood', x: -30, y: -275, rx: 10, ry: 8, n: 3 }, { kind: 'magnolia', x: 30, y: 20, rx: 8, ry: 8, n: 2 }],
    bounds: 60,
    trees: 0.7,
    roughW: 7,
    slope: { tilt: [0, -0.009], bumps: [], tiers: [{ dx: 0, dy: 0, ang: -1.571, h: 0.3, w: 1.6 }] },
    elev: [[0, 0], [120, -4], [240, -7]],
    gallery: [
      { line: [[15.8, 2.8], [14.5, 6.8], [12.3, 10.3], [9.2, 13.1], [5.5, 15], [1.4, 15.9], [-2.8, 15.8], [-6.8, 14.5], [-10.3, 12.3], [-13.1, 9.2], [-15, 5.5]], side: -1, rows: 4 },
      { line: [[-30, -160], [-30, -172], [-30, -184], [-30, -196], [-30, -208], [-30, -220]], side: -1, rows: 2 },
      { line: [[30, -160], [30, -172], [30, -184], [30, -196], [30, -208], [30, -220]], side: 1, rows: 2 },
      { line: [[-27.3, -248.9], [-24.6, -253.8], [-20.9, -258.1], [-16.2, -261.6], [-10.9, -264.1], [-5, -265.6], [1, -266], [7, -265.2], [12.7, -263.4], [17.9, -260.5], [22.2, -256.7], [25.6, -252.2]], side: -1, rows: 3 },
    ],
    landmarks: [],
  },
  {
    name: 'Magnolia', par: 4,
    path: [[0, 0], [5, -238], [-9.9, -362], [-37.7, -490.9]],
    fairway: { from: 45, endGap: 24, width: 42 },
    green: { x: -37.7, y: -490.9, rx: 13, ry: 14, rot: -0.225 },
    bunkers: [
      { x: -31.8, y: -306.9, rx: 8, ry: 9, rot: 0.046 },
      { x: -32.4, y: -334.4, rx: 8, ry: 10, rot: 0.12 },
      { x: -44.6, y: -507.8, rx: 10, ry: 4, rot: -0.225 },
    ],
    treeClusters: [{ x: -46.4, y: -266.5, n: 12, spread: 18 }],
    species: [{ kind: 'magnolia', x: -40.8, y: -41.4, rx: 12, ry: 20, n: 5 }, { kind: 'magnolia', x: -20, y: -525.7, rx: 10, ry: 8, n: 3 }],
    bounds: 68,
    trees: 0.75,
    roughW: 7,
    slope: { tilt: [0.001, -0.008], bumps: [{ dx: 6, dy: 3.8, r: 5, h: -0.08 }], tiers: [{ dx: -1.1, dy: -4.9, ang: -1.796, h: 0.35, w: 1.3 }] },
    elev: [[0, 0], [120, -3], [250, 1], [380, 7], [495, 11]],
    gallery: [
      { line: [[15.7, 3.1], [14.3, 7.1], [12, 10.6], [8.9, 13.3], [5.1, 15.2], [1, 16], [-3.1, 15.7], [-7.1, 14.3], [-10.6, 12], [-13.3, 8.9], [-15.2, 5.1]], side: -1, rows: 2 },
      { line: [[-32.9, -219.7], [-33.1, -231.3], [-33.4, -242.7], [-33.8, -254], [-34.5, -265.3], [-35.3, -276.5]], side: -1, rows: 2 },
      { line: [[43.4, -199.7], [43.5, -222.7], [43, -246.2], [41.8, -270], [39.7, -293.9], [36.6, -318], [32.6, -341.1], [28.7, -363], [24.6, -385.8]], side: 1, rows: 2 },
      { line: [[-65, -484.7], [-65.7, -490.7], [-65.3, -496.7], [-63.6, -502.5], [-60.8, -507.7], [-56.9, -512.3], [-52.3, -515.9], [-47, -518.4], [-41.3, -519.7], [-35.4, -519.7], [-29.6, -518.5], [-24.2, -516.1], [-19.4, -512.6], [-15.4, -508.1], [-12.3, -502.9], [-10.4, -497.1], [-9.7, -491.1]], side: -1, rows: 3 },
    ],
    landmarks: [],
  },
  {
    name: 'Juniper', par: 3,
    path: [[0, 0], [0, -180]],
    fairway: { from: 125, endGap: 16, width: 30 },
    green: { x: 0, y: -180, rx: 16, ry: 13, rot: 0.2 },
    bunkers: [{ x: -12, y: -167, rx: 8, ry: 5, rot: 0.4 }],
    flowers: [{ x: -36, y: -110, rx: 10, ry: 5, rot: 0.2 }, { x: 28, y: -206, rx: 8, ry: 5, rot: -0.3 }],
    species: [{ kind: 'dogwood', x: -40, y: -70, rx: 10, ry: 16, n: 4 }, { kind: 'holly', x: 30, y: -210, rx: 10, ry: 8, n: 4 }],
    bounds: 60,
    trees: 0.65,
    roughW: 7,
    slope: { tilt: [0.003, -0.006], bumps: [], tiers: [{ dx: 5, dy: -4, ang: -0.785, h: 0.42, w: 1.3 }] },
    elev: [[0, 0], [90, -8], [180, -15]],
    gallery: [
      { line: [[15.8, 2.8], [14.5, 6.8], [12.3, 10.3], [9.2, 13.1], [5.5, 15], [1.4, 15.9], [-2.8, 15.8], [-6.8, 14.5], [-10.3, 12.3], [-13.1, 9.2], [-15, 5.5]], side: -1, rows: 4 },
      { line: [[-29.5, -175.3], [-30, -180.9], [-29.1, -186.5], [-27, -191.8], [-23.6, -196.6], [-19.3, -200.7], [-14.1, -203.8], [-8.3, -206], [-2.1, -206.9], [4.2, -206.7], [10.3, -205.4], [15.9, -202.9], [20.8, -199.4], [24.9, -195.1], [27.8, -190.1], [29.5, -184.7], [30, -179.1]], side: -1, rows: 4 },
      { line: [[-30, -40], [-30, -52.5], [-30, -65], [-30, -77.5], [-30, -90], [-30, -102.5], [-30, -115], [-30, -127.5], [-30, -140]], side: -1, rows: 3 },
    ],
    landmarks: [{ kind: 'scoreboard-small', x: -48, y: -60, ang: 0 }],
  },
  {
    name: 'Pampas', par: 4,
    path: [[0, 0], [1, -220], [-4, -449.9]],
    fairway: { from: 45, endGap: 24, width: 32 },
    green: { x: -4, y: -449.9, rx: 13, ry: 10, rot: -0.025 },
    bunkers: [
      { x: -4.7, y: -436.9, rx: 8, ry: 3, rot: -0.025 },
      { x: -18.8, y: -441.5, rx: 4, ry: 6, rot: 0.375 },
      { x: 11.1, y: -444.3, rx: 4, ry: 6, rot: -0.425 },
      { x: -14.3, y: -460.6, rx: 6, ry: 3.5, rot: -0.425 },
      { x: 5.7, y: -461.1, rx: 6, ry: 3.5, rot: 0.375 },
    ],
    bounds: 48,
    trees: 1,
    roughW: 6,
    slope: { tilt: [-0.002, -0.012], bumps: [{ dx: 5.1, dy: 2.9, r: 4, h: 0.08 }], tiers: [{ dx: -0.1, dy: -2, ang: -1.596, h: 0.25, w: 1.4 }] },
    elev: [[0, 0], [150, -2], [300, 1], [450, 8]],
    gallery: [
      { line: [[15.7, 2.9], [14.5, 6.8], [12.2, 10.4], [9.1, 13.2], [5.4, 15.1], [1.3, 15.9], [-2.9, 15.7], [-6.8, 14.5], [-10.4, 12.2], [-13.2, 9.1], [-15.1, 5.4]], side: -1, rows: 2 },
      { line: [[-30.2, -219.7], [-30.4, -239.6], [-30.7, -259.5], [-31.1, -279.4], [-31.5, -299.3], [-31.9, -319.3], [-32.4, -339.2], [-32.9, -359.2], [-33.4, -379.2]], side: -1, rows: 2 },
      { line: [[32.2, -220.3], [32, -240.4], [31.7, -260.5], [31.3, -280.6], [30.9, -300.7], [30.4, -320.7], [30, -340.7], [29.5, -360.7], [29, -380.8]], side: 1, rows: 2 },
      { line: [[-32, -449.2], [-31.5, -454.4], [-29.8, -459.4], [-27, -464], [-23.2, -468], [-18.5, -471.2], [-13.3, -473.4], [-7.6, -474.7], [-1.7, -474.8], [4, -473.9], [9.4, -471.9], [14.3, -468.9], [18.3, -465.2], [21.3, -460.7], [23.2, -455.8], [24, -450.6]], side: -1, rows: 3 },
    ],
    landmarks: [],
  },
  {
    name: 'Yellow Jasmine', par: 5,
    path: [[0, 0], [6, -259], [-4, -418.5], [-25.9, -567.9]],
    fairway: { from: 50, endGap: 18, width: 44 },
    green: { x: -25.9, y: -567.9, rx: 12, ry: 14, rot: -0.058 },
    bunkers: [{ x: 38.1, y: -301, rx: 10, ry: 18, rot: -0.034 }],
    treeClusters: [{ x: -55.8, y: -414.1, n: 12, spread: 18 }],
    mounds: [
      { x: -46.7, y: -558.5, rx: 6, ry: 9, rot: 0.042, h: 2.2 },
      { x: -48.9, y: -572.3, rx: 5, ry: 7, rot: -0.158, h: 1.8 },
      { x: -41.9, y: -541, rx: 6, ry: 10, rot: 0.142, h: 1.8 },
      { x: -22.5, y: -584.6, rx: 7, ry: 5, rot: -0.158, h: 1.3 },
      { x: -5.9, y: -556.9, rx: 5, ry: 6, rot: -0.158, h: 1 },
    ],
    species: [{ kind: 'holly', x: 45.6, y: -118.7, rx: 10, ry: 14, n: 3 }],
    bounds: 70,
    trees: 0.7,
    roughW: 8,
    slope: { tilt: [0.003, -0.004], bumps: [{ dx: -8.9, dy: 1.4, r: 4, h: 0.22 }, { dx: 8.9, dy: -1.4, r: 4, h: 0.18 }, { dx: 1.4, dy: 8.9, r: 4, h: 0.14 }, { dx: 1.5, dy: -3.3, r: 4, h: -0.08 }] },
    elev: [[0, 0], [150, 3], [300, 7], [450, 12], [570, 16]],
    gallery: [
      { line: [[15.7, 3.2], [14.3, 7.1], [12, 10.6], [8.9, 13.3], [5.1, 15.2], [1, 16], [-3.2, 15.7], [-7.1, 14.3], [-10.6, 12], [-13.3, 8.9], [-15.2, 5.1]], side: -1, rows: 2 },
      { line: [[-34.5, -220.4], [-34.4, -237.6], [-34.4, -254.6], [-34.6, -271.7], [-34.9, -288.8], [-35.5, -305.8], [-36.3, -322.7], [-37.3, -339.6], [-38.6, -356.5]], side: -1, rows: 2 },
      { line: [[46.3, -219.4], [46.4, -237.2], [46.4, -255.2], [46.2, -273.1], [51.8, -291.2], [51.2, -309.3], [44.4, -327.1], [43.3, -345.1], [41.9, -363.1]], side: 1, rows: 2 },
      { line: [[33.7, -444.4], [32, -457.2], [30.3, -469.8], [28.4, -482.5], [26.6, -495], [24.6, -507.5], [22.7, -520], [20.7, -532.4], [18.7, -544.8]], side: 1, rows: 2 },
      { line: [[-51.8, -591.7], [-46.7, -596.8], [-40.6, -600.6], [-33.9, -603], [-26.8, -603.8], [-19.8, -603.1], [-12.9, -600.9], [-6.7, -597.2], [-1.2, -592.2], [3.1, -586.2], [6.2, -579.4], [7.9, -572], [8.1, -564.5], [6.8, -557.1]], side: -1, rows: 3 },
    ],
    landmarks: [],
  },
  {
    name: 'Carolina Cherry', par: 4,
    path: [[0, 0], [3.9, -241.7], [-17.8, -350.2], [-45.4, -453.8]],
    fairway: { from: 45, endGap: 22, width: 42 },
    green: { x: -45.4, y: -453.8, rx: 13, ry: 13, rot: -0.069 },
    bunkers: [{ x: -56.5, y: -441.4, rx: 6, ry: 4, rot: 0.331 }, { x: -61.4, y: -451.5, rx: 4, ry: 6, rot: -0.169 }],
    treeClusters: [{ x: -42.5, y: -246.7, n: 14, spread: 18 }],
    flowers: [{ x: -31.1, y: -484.7, rx: 9, ry: 5, rot: -0.469 }],
    species: [{ kind: 'cherry', x: -82.3, y: -474.8, rx: 12, ry: 8, n: 5 }, { kind: 'cherry', x: 39.7, y: -58.8, rx: 10, ry: 14, n: 3 }],
    bounds: 68,
    trees: 0.75,
    roughW: 7,
    slope: { tilt: [-0.005, -0.011], bumps: [{ dx: 3.1, dy: -4, r: 5, h: 0.06 }], tiers: [{ dx: 2.1, dy: 7.7, ang: -1.84, h: 0.42, w: 1.2 }] },
    elev: [[0, 0], [120, -6], [250, -14], [330, -15], [400, -10], [460, -4]],
    gallery: [
      { line: [[15.7, 3.1], [14.4, 7], [12.1, 10.5], [8.9, 13.3], [5.2, 15.1], [1.1, 16], [-3.1, 15.7], [-7, 14.4], [-10.5, 12.1], [-13.3, 8.9], [-15.1, 5.2]], side: -1, rows: 3 },
      { line: [[-33.5, -199.9], [-33.6, -214.5], [-33.8, -228.9], [-34.4, -242.8], [-35.4, -256.2], [-36.9, -269.7], [-39, -282.3], [-41.8, -294.5], [-45.6, -307.7]], side: -1, rows: 2 },
      { line: [[42.9, -199.9], [42.8, -217.9], [42.4, -236.3], [41.3, -255.1], [39.5, -274.5], [36.5, -294], [32.1, -313.9], [26.9, -332.1], [22.2, -348]], side: 1, rows: 2 },
      { line: [[-68.2, -437.6], [-71.1, -442.7], [-72.8, -448.3], [-73.4, -454.1], [-72.7, -459.9], [-70.9, -465.5], [-67.9, -470.5], [-63.9, -474.8], [-59.1, -478.2], [-53.8, -480.5], [-48, -481.7], [-42.2, -481.6], [-36.5, -480.3], [-31.1, -477.9], [-26.4, -474.4], [-22.6, -470], [-19.7, -464.9], [-18, -459.3], [-17.4, -453.5], [-18.1, -447.7]], side: -1, rows: 4 },
    ],
    landmarks: [{ kind: 'clubhouse', x: -9.8, y: -588.1, ang: 1.83 }, { kind: 'oak', x: -25.9, y: -552.5, ang: 1.766 }],
  },
  {
    name: 'Camellia', par: 4,
    path: [[0, 0], [-5.7, -189.7], [-42.7, -303.5], [-94.8, -398.3], [-123.3, -469.5]],
    fairway: { from: 45, endGap: 24, width: 48 },
    green: { x: -123.3, y: -469.5, rx: 13, ry: 14, rot: -0.268 },
    bunkers: [{ x: -59.8, y: -402.5, rx: 13, ry: 17, rot: -0.306 }, { x: -106.4, y: -472.8, rx: 6, ry: 9, rot: -0.468 }],
    treeClusters: [{ x: -66.8, y: -214.6, n: 20, spread: 24 }],
    flowers: [{ x: -157.6, y: -486.3, rx: 10, ry: 6, rot: -0.168 }],
    species: [{ kind: 'dogwood', x: 8.9, y: -315.1, rx: 12, ry: 20, n: 5 }, { kind: 'magnolia', x: -162.8, y: -488.6, rx: 12, ry: 8, n: 3 }],
    bounds: 72,
    trees: 0.8,
    roughW: 8,
    slope: { tilt: [-0.008, -0.007], bumps: [{ dx: -2.3, dy: 5.2, r: 5, h: 0.1 }] },
    elev: [[0, 0], [100, -6], [200, -15], [300, -24], [400, -31], [495, -34]],
    cant: [[0, 0], [150, 0.06], [350, 0.05], [460, 0]],
    gallery: [
      { line: [[15.8, 2.4], [14.7, 6.4], [12.5, 10], [9.5, 12.9], [5.8, 14.9], [1.8, 15.9], [-2.4, 15.8], [-6.4, 14.7], [-10, 12.5], [-12.9, 9.5], [-14.9, 5.8]], side: -1, rows: 3 },
      { line: [[-63.1, -242.1], [-68.2, -254.8], [-73.9, -267.9], [-80, -281.8], [-85.5, -294.4], [-91.4, -305.9], [-97.9, -317.8], [-105.1, -330.1], [-112.8, -342.9]], side: -1, rows: 2 },
      { line: [[27.6, -240.1], [21.2, -260.8], [13.8, -280.5], [6, -298.8], [-1.4, -315.9], [-10, -334.8], [-19.7, -353.3], [-29.6, -370.6], [-39.4, -386.9]], side: 1, rows: 2 },
      { line: [[-147.2, -454.9], [-149.8, -460.4], [-151.2, -466.3], [-151.4, -472.3], [-150.3, -478.2], [-148.1, -483.8], [-144.8, -488.7], [-140.5, -492.7], [-135.5, -495.8], [-130, -497.7], [-124.2, -498.4], [-118.3, -497.8], [-112.6, -496], [-107.5, -493], [-103, -489], [-99.4, -484.1], [-96.8, -478.6], [-95.4, -472.7]], side: -1, rows: 3 },
    ],
    landmarks: [{ kind: 'scoreboard-small', x: -106.8, y: -302.6, ang: -0.5 }],
  },
  {
    name: 'White Dogwood', par: 4,
    path: [[0, 0], [-2, -239.4], [14, -399], [6, -518.7]],
    fairway: { from: 50, endGap: 26, width: 42 },
    green: { x: 6, y: -518.7, rx: 13, ry: 14, rot: -0.298 },
    bunkers: [{ x: 21, y: -529.2, rx: 5, ry: 6, rot: 0.102 }],
    water: [{ x: -22.3, y: -509.9, rx: 13, ry: 19, rot: -0.248 }, { line: [[-86.9, -543.7], [-36.9, -546.6], [3.1, -548.6], [42.5, -556.4]], w: 6 }],
    treeClusters: [{ x: 44.6, y: -294.8, n: 12, spread: 16 }, { x: -42.7, y: -179.9, n: 8, spread: 14 }],
    species: [
      { kind: 'dogwood', x: -37.1, y: -59.3, rx: 12, ry: 24, n: 7 },
      { kind: 'dogwood', x: 34.7, y: -70.7, rx: 12, ry: 24, n: 6 },
      { kind: 'dogwood', x: 43.7, y: -482.2, rx: 10, ry: 10, n: 4 },
    ],
    bounds: 70,
    trees: 0.75,
    roughW: 7,
    slope: { tilt: [0.011, -0.005], bumps: [] },
    elev: [[0, 0], [150, -5], [300, -12], [420, -17], [520, -20]],
    gallery: [
      { line: [[15.8, 2.6], [14.6, 6.6], [12.4, 10.2], [9.3, 13], [5.6, 15], [1.6, 15.9], [-2.6, 15.8], [-6.6, 14.6], [-10.2, 12.4], [-13, 9.3], [-15, 5.6]], side: -1, rows: 2 },
      { line: [[-39.1, -262.4], [-37.6, -281], [-35.7, -299.1], [-33.5, -317.1], [-31.1, -334.7], [-28.7, -351.9], [-26.6, -368.6], [-25, -384.7], [-24.2, -400]], side: -1, rows: 2 },
      { line: [[37.2, -257.4], [38.7, -276.1], [40.8, -295.2], [43.3, -314.5], [46, -334.2], [48.6, -354.6], [50.9, -375.8], [52.2, -398.2], [52.2, -419.8]], side: 1, rows: 2 },
      { line: [[-1.9, -547.6], [4.1, -548.6], [10.1, -548.4], [16, -546.8], [21.5, -544], [26.2, -540.1], [30.1, -535.2], [32.9, -529.7], [34.6, -523.6], [35, -517.4], [34.1, -511.2], [32, -505.3], [28.8, -500], [24.6, -495.5], [19.5, -492.1], [13.9, -489.8]], side: -1, rows: 5 },
    ],
    landmarks: [{ kind: 'leaderboard', x: 49.9, y: -563.2, ang: 1.769 }, { kind: 'camera-tower', x: -71.7, y: -491, ang: -0.343 }],
  },
  {
    name: 'Golden Bell', par: 3,
    path: [[0, 0], [0, -155]],
    fairway: { from: 141, endGap: 9, width: 36 },
    green: { x: 0, y: -155, rx: 18, ry: 7.5, rot: -0.15 },
    bunkers: [
      { x: -2, y: -145.5, rx: 6.5, ry: 2.4, rot: -0.15 },
      { x: -10, y: -165, rx: 6, ry: 2.8, rot: -0.15 },
      { x: 11, y: -164.5, rx: 5, ry: 2.6, rot: -0.15 },
    ],
    water: [{ line: [[-90, -120], [-50, -126], [-20, -131], [5, -136], [30, -139], [60, -143], [95, -148]], w: 7 }],
    bridges: [{ x: -28, y: -128, ang: -1.571, len: 11, style: 'stone', name: 'hogan' }],
    flowers: [
      { x: -18, y: -177, rx: 14, ry: 5, rot: -0.15 },
      { x: 14, y: -179, rx: 12, ry: 5, rot: -0.15 },
      { x: -2, y: -185, rx: 14, ry: 4, rot: -0.15 },
      { x: 34, y: -189, rx: 10, ry: 5, rot: -0.4 },
    ],
    species: [
      { kind: 'azalea', x: 0, y: -181, rx: 40, ry: 8, n: 60 },
      { kind: 'dogwood', x: -20, y: -195, rx: 20, ry: 8, n: 4 },
      { kind: 'loblolly', x: 15, y: -200, rx: 25, ry: 8, n: 5 },
    ],
    bounds: 56,
    trees: 0.6,
    roughW: 6,
    slope: { tilt: [-0.003, -0.006], bumps: [{ dx: 6, dy: 0, r: 4, h: 0.06 }] },
    elev: [[0, 0], [100, -2], [130, -4], [155, -2]],
    gallery: [{ line: [[16.9, -6.2], [17.9, -1.6], [17.7, 3.1], [16.3, 7.6], [13.8, 11.6], [10.3, 14.7], [6.2, 16.9], [1.6, 17.9], [-3.1, 17.7], [-7.6, 16.3], [-11.6, 13.8], [-14.7, 10.3], [-16.9, 6.2], [-17.9, 1.6], [-17.7, -3.1]], side: -1, rows: 5 }, { line: [[-45, -40], [-45, -100]], side: -1, rows: 4 }],
    landmarks: [
      { kind: 'hogan-bridge', x: -28, y: -128, ang: -1.571, len: 11 },
      { kind: 'camera-tower', x: 45, y: -30, ang: -1.916 },
      { kind: 'leaderboard', x: -60, y: 30, ang: -0.464 },
    ],
  },
  {
    name: 'Azalea', par: 5,
    path: [[0, 0], [0, -238.7], [-31.1, -332.1], [-103.8, -415.2], [-176.4, -477.5]],
    fairway: { from: 50, endGap: 34, width: 44 },
    green: { x: -176.4, y: -477.5, rx: 18, ry: 10, rot: -0.631 },
    bunkers: [
      { x: -196.6, y: -473.4, rx: 4, ry: 3, rot: -0.581 },
      { x: -191.8, y: -482.4, rx: 4, ry: 3, rot: -0.781 },
      { x: -184.8, y: -490.9, rx: 4, ry: 3, rot: -0.981 },
      { x: -176.1, y: -496.7, rx: 4, ry: 3, rot: -1.181 },
    ],
    water: [{ line: [[-135.4, -502], [-155.3, -479.5], [-164.1, -467.3], [-174.7, -452.8], [-177, -439.1], [-118.6, -359.3], [-78.2, -305.6], [-56.8, -243.6], [-49.7, -150.2], [-47, -61], [-46, 9.8]], w: 6 }, { line: [[-90.2, 49.7], [-58.1, 24.8], [-46, 9.8], [-70, -5.5], [-109.8, -21.9]], w: 8 }],
    bridges: [{ x: -52.1, y: 13.8, ang: 0.404, len: 12, style: 'stone', name: 'nelson' }, { x: -170.9, y: -457.4, ang: -2.352, len: 9, style: 'stone' }],
    treeClusters: [{ x: 49, y: -267.1, n: 16, spread: 22 }],
    flowers: [
      { x: -68, y: -120.8, rx: 14, ry: 30, rot: 0.012 },
      { x: -72.7, y: -241.8, rx: 14, ry: 30, rot: -0.013 },
      { x: -104.9, y: -312, rx: 14, ry: 26, rot: -0.387 },
      { x: -202.8, y: -486.3, rx: 16, ry: 6, rot: -0.881 },
      { x: -223.5, y: -464.5, rx: 10, ry: 6, rot: -0.681 },
    ],
    species: [
      { kind: 'azalea', x: -70.1, y: -111, rx: 12, ry: 36, n: 40 },
      { kind: 'azalea', x: -74.7, y: -216.5, rx: 13, ry: 30, n: 40 },
      { kind: 'azalea', x: -93.5, y: -284.5, rx: 13, ry: 22, n: 40 },
      { kind: 'dogwood', x: -88.1, y: -197.8, rx: 12, ry: 60, n: 8 },
      { kind: 'azalea', x: -204.4, y: -487.6, rx: 24, ry: 8, n: 30 },
    ],
    bounds: 78,
    trees: 0.7,
    roughW: 8,
    slope: { tilt: [-0.001, -0.006], bumps: [{ dx: 6.6, dy: -4.9, r: 5, h: 0.08 }], tiers: [{ dx: -0.8, dy: -0.6, ang: -2.714, h: 0.32, w: 1.4 }] },
    elev: [[0, 0], [150, 3], [300, 5], [420, 0], [490, -4], [545, -1]],
    cant: [[0, 0], [150, 0.06], [400, 0.07], [500, 0.02]],
    gallery: [{ line: [[42.7, -160], [42.5, -188], [41.8, -216.6], [39.8, -246.3], [35.7, -276.7], [26.1, -311.1], [10.5, -341.3], [-5.5, -366.8], [-25.2, -391.9]], side: 1, rows: 3 }, { line: [[-201.6, -490.2], [-197.2, -496.3], [-191.8, -501.5], [-185.8, -505.7], [-179.3, -508.6], [-172.7, -510.2], [-166.3, -510.4], [-160.3, -509.1], [-155.1, -506.4], [-150.7, -502.5], [-147.5, -497.5], [-145.5, -491.6], [-144.9, -485.1], [-145.7, -478.3], [-147.8, -471.4]], side: -1, rows: 4 }],
    landmarks: [{ kind: 'nelson-bridge', x: -52.1, y: 13.8, ang: 0.404, len: 12 }, { kind: 'camera-tower', x: -192, y: -529.3, ang: 1.278 }],
  },
  {
    name: 'Chinese Fir', par: 4,
    path: [[0, 0], [3, -219.6], [-14, -439.3]],
    fairway: { from: 45, endGap: 22, width: 44 },
    green: { x: -14, y: -439.3, rx: 14, ry: 14, rot: 0.01 },
    bunkers: [],
    species: [{ kind: 'holly', x: 41, y: -38.8, rx: 10, ry: 16, n: 3 }],
    bounds: 70,
    trees: 0.75,
    roughW: 8,
    slope: { tilt: [0.005, -0.007], bumps: [{ dx: 3.7, dy: -3.3, r: 4, h: 0.16 }, { dx: -4.7, dy: 3.4, r: 4, h: -0.12 }, { dx: -2.7, dy: -7.8, r: 3, h: 0.1 }], tiers: [{ dx: 0.9, dy: 10, ang: -1.661, h: 0.4, w: 1.2 }] },
    elev: [[0, 0], [150, 2], [300, 3], [440, 8]],
    gallery: [
      { line: [[15.7, 3], [14.4, 7], [12.1, 10.5], [9, 13.3], [5.2, 15.1], [1.1, 16], [-3, 15.7], [-7, 14.4], [-10.5, 12.1], [-13.3, 9], [-15.1, 5.2]], side: -1, rows: 2 },
      { line: [[-37.4, -218.6], [-38, -233.1], [-38.7, -247.7], [-39.6, -262.3], [-40.6, -277], [-41.6, -291.8], [-42.8, -306.6], [-44, -321.4], [-45.3, -336.2]], side: -1, rows: 2 },
      { line: [[43.4, -221.3], [42.6, -239.3], [41.7, -257.3], [40.6, -275.1], [39.3, -292.8], [38, -310.5], [36.5, -328.1], [35, -345.7], [33.5, -363.2]], side: 1, rows: 2 },
      { line: [[-42.9, -436.7], [-42.8, -442.7], [-41.4, -448.7], [-38.9, -454.2], [-35.3, -459], [-30.7, -463], [-25.4, -466], [-19.6, -467.8], [-13.6, -468.3], [-7.6, -467.6], [-1.8, -465.6], [3.4, -462.5], [7.8, -458.4], [11.3, -453.4], [13.7, -447.9], [14.9, -441.9], [14.8, -435.9], [13.4, -429.9]], side: -1, rows: 3 },
    ],
    landmarks: [],
  },
  {
    name: 'Firethorn', par: 5,
    path: [[0, 0], [4, -289.8], [-6, -449.6], [-10, -549.5]],
    fairway: { from: 45, endGap: 40, width: 44 },
    green: { x: -10, y: -549.5, rx: 11, ry: 14, rot: -0.036 },
    bunkers: [{ x: 4.9, y: -553, rx: 4, ry: 7, rot: -0.036 }],
    water: [{ x: -11.1, y: -525.4, rx: 24, ry: 8, rot: 0.004 }, { x: -37.3, y: -586.6, rx: 30, ry: 10, rot: 0.164 }],
    bridges: [{ x: -35.1, y: -524.6, ang: -1.606, len: 22, style: 'stone', name: 'sarazen' }],
    treeClusters: [{ x: 43.8, y: -300.7, n: 14, spread: 18 }, { x: -48.2, y: -375.9, n: 10, spread: 16 }],
    bounds: 70,
    trees: 0.7,
    roughW: 8,
    slope: { tilt: [-0.002, -0.011], bumps: [{ dx: 0.2, dy: 5, r: 4, h: 0.06 }] },
    elev: [[0, 0], [150, 2], [290, 3], [400, -4], [500, -10], [550, -11]],
    gallery: [
      { line: [[15.7, 3], [14.4, 7], [12.1, 10.5], [9, 13.2], [5.2, 15.1], [1.2, 16], [-3, 15.7], [-7, 14.4], [-10.5, 12.1], [-13.2, 9], [-15.1, 5.2]], side: -1, rows: 2 },
      { line: [[-36.3, -240.2], [-36.3, -255.1], [-36.3, -269.9], [-36.3, -284.6], [-36.6, -299.2], [-37, -313.7], [-37.5, -328.2], [-38.2, -342.7], [-39.2, -357.1]], side: -1, rows: 2 },
      { line: [[44.5, -239.7], [44.5, -254.9], [44.5, -270], [44.5, -285.4], [44.2, -300.8], [43.8, -316.3], [43.2, -331.7], [42.4, -347.2], [41.5, -362.7]], side: 1, rows: 2 },
      { line: [[-45.7, -436.9], [-46.4, -449.5], [-47.1, -461.6], [-47.6, -473.8], [-48.2, -485.9], [-48.6, -498], [-49.1, -510.1]], side: -1, rows: 3 },
      { line: [[2.6, -575.9], [7.3, -572.4], [11.2, -567.9], [14.2, -562.6], [16.2, -556.7], [17, -550.5], [16.6, -544.2], [15.1, -538.2], [12.5, -532.7]], side: -1, rows: 4 },
    ],
    landmarks: [
      { kind: 'sarazen-bridge', x: -35.1, y: -524.6, ang: -1.606, len: 22 },
      { kind: 'camera-tower', x: 28.9, y: -580.9, ang: 2.463 },
      { kind: 'leaderboard', x: -63.2, y: -497.6, ang: 0.698 },
    ],
  },
  {
    name: 'Redbud', par: 3,
    path: [[0, 0], [-5, -169.9]],
    fairway: null,
    green: { x: -5, y: -169.9, rx: 16, ry: 11, rot: -0.379 },
    bunkers: [
      { x: 12, y: -169.4, rx: 5, ry: 7, rot: -0.129 },
      { x: 7.7, y: -181.3, rx: 6, ry: 3, rot: -0.429 },
      { x: -16.6, y: -157.6, rx: 4, ry: 3, rot: 0.371 },
    ],
    water: [{ x: -26.7, y: -91.3, rx: 22, ry: 82, rot: 0.011 }],
    flowers: [{ x: 32.5, y: -121, rx: 8, ry: 5, rot: -0.029 }],
    species: [{ kind: 'dogwood', x: 40.8, y: -41.2, rx: 10, ry: 20, n: 5 }, { kind: 'loblolly', x: -6.2, y: -209.9, rx: 30, ry: 10, n: 6 }],
    bounds: 62,
    trees: 0.6,
    roughW: 7,
    slope: { tilt: [0.02, -0.005], bumps: [{ dx: 4.8, dy: -6.1, r: 4, h: 0.08 }], tiers: [{ dx: 0, dy: 0, ang: -0.378, h: 0.22, w: 1.5 }] },
    elev: [[0, 0], [80, -3], [170, -4]],
    gallery: [
      { line: [[18, -0.5], [17.5, 4.1], [15.8, 8.5], [13.1, 12.3], [9.5, 15.3], [5.2, 17.2], [0.5, 18], [-4.1, 17.5], [-8.5, 15.8], [-12.3, 13.1], [-15.3, 9.5], [-17.2, 5.2], [-18, 0.5]], side: -1, rows: 5 },
      { line: [[29.1, -30.9], [28.7, -45.9], [28.2, -60.9], [27.8, -75.9], [27.3, -90.8], [26.9, -105.8], [26.5, -120.8], [26, -135.8], [25.6, -150.8]], side: 1, rows: 5 },
      { line: [[-11.7, -198.3], [-4.7, -198.9], [2.4, -198.3], [9.1, -196.4], [15.3, -193.4], [20.5, -189.3], [24.6, -184.4], [27.4, -178.9], [28.8, -172.9], [28.8, -166.9], [27.2, -160.9]], side: -1, rows: 5 },
      { line: [[-61.2, -38.2], [-64.9, -98.1], [-64.7, -158.2]], side: -1, rows: 5 },
    ],
    landmarks: [{ kind: 'camera-tower', x: 23.8, y: -210.8, ang: 2.185 }, { kind: 'leaderboard', x: 50.6, y: 18.5, ang: -1.858 }],
  },
  {
    name: 'Nandina', par: 4,
    path: [[0, 0], [2, -229.9], [-6, -439.8]],
    fairway: { from: 45, endGap: 22, width: 42 },
    green: { x: -6, y: -439.8, rx: 14, ry: 11, rot: -0.046 },
    bunkers: [{ x: -16.5, y: -428.3, rx: 6, ry: 4, rot: 0.354 }, { x: 4.5, y: -429.3, rx: 6, ry: 4, rot: -0.446 }],
    species: [{ kind: 'holly', x: -42, y: -150.3, rx: 10, ry: 16, n: 3 }],
    bounds: 66,
    trees: 0.75,
    roughW: 7,
    slope: { tilt: [0.003, -0.009], bumps: [{ dx: -2.9, dy: 3.1, r: 5, h: 0.1 }] },
    elev: [[0, 0], [150, -2], [300, 3], [440, 8]],
    gallery: [
      { line: [[15.7, 2.9], [14.4, 6.9], [12.2, 10.4], [9, 13.2], [5.3, 15.1], [1.2, 16], [-2.9, 15.7], [-6.9, 14.4], [-10.4, 12.2], [-13.2, 9], [-15.1, 5.3]], side: -1, rows: 2 },
      { line: [[-36.1, -219.7], [-36.3, -236.8], [-36.7, -254], [-37.1, -271.3], [-37.7, -288.7], [-38.3, -306], [-39, -323.4], [-39.7, -340.8], [-40.5, -358.2]], side: -1, rows: 2 },
      { line: [[40.3, -220.3], [40.1, -238.1], [39.7, -255.9], [39.2, -273.6], [38.7, -291.3], [38, -308.9], [37.3, -326.5], [36.6, -344.1], [35.8, -361.6]], side: 1, rows: 2 },
      { line: [[-35, -438.5], [-34.6, -443.9], [-32.9, -449.2], [-30.1, -454], [-26.3, -458.2], [-21.5, -461.6], [-16.1, -464.1], [-10.2, -465.5], [-4.2, -465.8], [1.8, -464.9], [7.5, -463], [12.5, -460], [16.7, -456.1], [20, -451.6], [22.1, -446.5], [23, -441.1]], side: -1, rows: 3 },
    ],
    landmarks: [],
  },
  {
    name: 'Holly', par: 4,
    path: [[0, 0], [0, -218.2], [17.9, -327.3], [41.7, -461.3]],
    fairway: { from: 55, endGap: 22, width: 36 },
    green: { x: 41.7, y: -461.3, rx: 12, ry: 15, rot: 0.127 },
    bunkers: [
      { x: -13.2, y: -304.7, rx: 8, ry: 10, rot: 0.424 },
      { x: -3, y: -330, rx: 8, ry: 9, rot: 0.473 },
      { x: 25.9, y: -458, rx: 7, ry: 10, rot: 0.427 },
      { x: 57.2, y: -462.6, rx: 4, ry: 6, rot: 0.077 },
    ],
    flowers: [{ x: 76.9, y: -487.5, rx: 10, ry: 5, rot: 0.177 }],
    species: [{ kind: 'holly', x: 28.8, y: -120.2, rx: 8, ry: 30, n: 6 }, { kind: 'holly', x: -31.2, y: -119.8, rx: 8, ry: 30, n: 6 }],
    bounds: 52,
    trees: 1,
    roughW: 7,
    slope: { tilt: [0.004, -0.009], bumps: [], tiers: [{ dx: 0.2, dy: -1, ang: -1.219, h: 0.35, w: 1.3 }] },
    elev: [[0, 0], [100, -4], [200, -2], [300, 6], [400, 14], [465, 19]],
    gallery: [
      { line: [[15.8, 2.7], [14.5, 6.7], [12.3, 10.3], [9.2, 13.1], [5.5, 15], [1.4, 15.9], [-2.7, 15.8], [-6.7, 14.5], [-10.3, 12.3], [-13.1, 9.2], [-15, 5.5]], side: -1, rows: 3 },
      { line: [[-32.8, -243.3], [-30.1, -265.1], [-26.1, -286.7], [-25.5, -307.5], [-17.7, -325], [-14.3, -344.1], [-10.8, -363.9], [-7.3, -383.6], [-3.8, -403.4]], side: -1, rows: 3 },
      { line: [[36.1, -236.6], [38.3, -254.4], [41.6, -272.1], [45.9, -291.2], [50.3, -312], [53.9, -332.3], [57.3, -351.9], [60.8, -371.5], [64.3, -391.2]], side: 1, rows: 3 },
      { line: [[15.1, -450.3], [13.8, -456.6], [13.7, -463], [14.9, -469.4], [17.2, -475.4], [20.6, -480.8], [24.9, -485.4], [29.9, -488.9], [35.5, -491.2], [41.3, -492.2], [47.2, -491.8], [52.8, -490.1], [57.9, -487.2], [62.3, -483.1], [65.8, -478], [68.3, -472.3], [69.6, -466], [69.7, -459.6], [68.5, -453.2], [66.2, -447.2], [62.8, -441.8]], side: -1, rows: 5 },
    ],
    landmarks: [
      { kind: 'clubhouse', x: 81.7, y: -571, ang: 1.92 },
      { kind: 'oak', x: 100.1, y: -532.1, ang: 2.26 },
      { kind: 'leaderboard', x: -25.7, y: -397.1, ang: 0.176 },
      { kind: 'camera-tower', x: 9.4, y: -507.7, ang: 0.963 },
    ],
  },
].map((h) => ({ ...h, course: 'augusta', treeStyle: 'pine', greenDecel: 0.5, secondCut: true }));


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
    // Renderer-only extras (Augusta); empty elsewhere.
    elev: spec.elev || null, cant: spec.cant || null, mounds: spec.mounds || [],
    gallery: spec.gallery || [], landmarks: spec.landmarks || [], species: spec.species || [],
    secondCut: !!spec.secondCut,
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

  // Ground height (yards above the tee) for the renderers: the centre-line
  // profile, plus the cross-slope and mounds. Flat on holes without `elev`.
  hole.elevAt = (s) => profileAt(spec.elev, s);
  hole.heightAt = (x, y) => {
    if (!spec.elev && !spec.mounds) return 0;
    let best = Infinity, bs = 0, side = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const [d, t] = segDist(x, y, a.x, a.y, b.x, b.y);
      if (d < best) {
        best = d; bs = a.s + (b.s - a.s) * t;
        side = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) > 0 ? 1 : -1;
      }
    }
    let h = profileAt(spec.elev, bs) + profileAt(spec.cant, bs) * best * side;
    for (const m of spec.mounds || []) {
      const c = Math.cos(-m.rot), sn = Math.sin(-m.rot);
      const dx = x - m.x, dy = y - m.y;
      const u = (dx * c - dy * sn) / m.rx, v = (dx * sn + dy * c) / m.ry;
      const q = u * u + v * v;
      if (q < 1) h += m.h * (1 - q) * (1 - q);
    }
    return h;
  };

  hole.terrainAt = (x, y) => terrainAt(hole, x, y);
  hole.slopeAt = (x, y) => slopeAt(hole, x, y);

  // Yardage from tee along the centre line to the pin.
  hole.yards = Math.round(length);
  placeTrees(hole, r, spec);
  return hole;
}

// Piecewise profile [[s, v], ...] with smooth (cosine) easing between points.
function profileAt(prof, s) {
  if (!prof || !prof.length) return 0;
  if (s <= prof[0][0]) return prof[0][1];
  for (let i = 1; i < prof.length; i++) {
    const [s1, v1] = prof[i];
    if (s <= s1) {
      const [s0, v0] = prof[i - 1];
      const t = (s - s0) / (s1 - s0 || 1);
      return v0 + (v1 - v0) * (1 - Math.cos(t * Math.PI)) / 2;
    }
  }
  return prof[prof.length - 1][1];
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
    // The loblollies are bare for the lower ~55% of their height.
    if (pine) { const rr = (3.6 + r() * 2.4) * big, th = 20 + r() * 12; h.trees.push({ x, y, r: rr, h: th, base: th * (0.5 + r() * 0.08), shade: r(), pine: true }); }
    else if (style === 'palm') h.trees.push({ x, y, r: (2.6 + r() * 1.2) * big, h: 10 + r() * 6, base: 6 + r() * 2, shade: r(), palm: true });
    else if (style === 'cypress') h.trees.push({ x, y, r: (4.5 + r() * 3) * big, h: 9 + r() * 5, base: 2.2 + r() * 1.5, shade: r(), cypress: true });
    else h.trees.push({ x, y, r: (3.2 + r() * 3.2) * big, h: 11 + r() * 9, base: 2.6 + r() * 1.8, shade: r() });
  };
  const clearOf = (x, y) => {
    if (Math.hypot(x - h.tee.x, y - h.tee.y) < 22 || inEllipse(x, y, h.green, FRINGE_W + 7)) return false;
    for (const f of spec.flowers || []) if (inEllipse(x, y, f, 1)) return false;
    for (const f of spec.species || []) if (inEllipse(x, y, f, 1)) return false;
    for (const g of spec.gallery || []) if (inGallery(g, x, y)) return false;
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
  // Notable plantings among the pines (Augusta): dogwoods, magnolias...
  // Azaleas are low shrubs, drawn by the renderer, so they get no trees.
  const SPECIES = {
    dogwood: [2.4, 1.2, 6, 3, 1.4], magnolia: [4, 2, 10, 5, 0.8], cherry: [2.8, 1.2, 6, 3, 1.5],
    holly: [2.4, 1, 7, 4, 0.6], loblolly: [3.6, 2.4, 20, 12, 4.5],
  };
  for (const p of spec.species || []) {
    const k = SPECIES[p.kind];
    if (!k) continue;
    for (let i = 0; i < p.n; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r());
      const px = p.x + Math.cos(a) * p.rx * d, py = p.y + Math.sin(a) * p.ry * d;
      const t = terrainAt(h, px, py);
      if (t === T.FAIRWAY || t === T.WATER || t === T.SAND || t === T.GREEN || t === T.FRINGE || t === T.TEE) continue;
      if (Math.hypot(px - h.tee.x, py - h.tee.y) < 18 || inEllipse(px, py, h.green, FRINGE_W + 5)) continue;
      if ((spec.gallery || []).some((g) => inGallery(g, px, py))) continue;
      const th = k[2] + r() * k[3];
      const base = p.kind === 'loblolly' ? th * (0.5 + r() * 0.08) : k[4] * (0.7 + r() * 0.6);
      h.trees.push({ x: px, y: py, r: k[0] + r() * k[1], h: th, base, shade: r(), kind: p.kind, pine: p.kind === 'loblolly' });
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

// Is (x, y) within the patrons' band behind a gallery rope?
function inGallery(g, x, y) {
  const depth = 1.5 + (g.rows || 2) * 1.2;
  const L = g.line;
  for (let i = 0; i < L.length - 1; i++) {
    const [ax, ay] = L[i], [bx, by] = L[i + 1];
    const [d, t] = segDist(x, y, ax, ay, bx, by);
    if (d > depth + 1) continue;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    // Signed offset along the crowd side (right-hand normal is (-dy, dx)).
    const off = ((x - ax) * -(by - ay) + (y - ay) * (bx - ax)) / len * g.side;
    if (off > -1 && off < depth + 1 && t >= 0) return true;
  }
  return false;
}

// Wind is the same for everyone in a game (seeded), different per hole.
export function windFor(index, gameSeed) {
  const r = rng(hashSeed(gameSeed, 'wind', index));
  // Links and clifftop courses are windier.
  const speed = Math.round((2 + r() * 13) * (HOLES[index] && HOLES[index].windMul ? HOLES[index].windMul : 1));
  return { speed, dir: r() * Math.PI * 2 };
}
