// Course layouts. World units: every hole fits inside roughly 1000 x 700.
//
// Level fields
//   course   outer boundary polygon (the ball stays inside it)
//   walls    solid obstacle polygons
//   sand     bunkers (heavy friction)
//   water    hazards (+1 stroke, ball returns to where it was hit from)
//   slopes   { poly, force:[fx,fy] } or radial { x, y, r0, r1, strength } (positive = hill)
//   bumpers  { x, y, r }
//   movers   sliding blocks { x, y, w, h, dx, dy, period, phase }
//   spinners windmill blades { x, y, len, speed, blades, w }
//   portals  { a:[x,y], b:[x,y] }

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

function ellipse(cx, cy, rx, ry, n = 28, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return pts;
}

// Round off every corner of a polygon with a short arc.
function soft(poly, r = 24, n = 4) {
  const out = [];
  const len = poly.length;
  for (let i = 0; i < len; i++) {
    const p = poly[i], a = poly[(i - 1 + len) % len], b = poly[(i + 1) % len];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const rr = Math.min(r, la / 2.2, lb / 2.2);
    const s = [p[0] + ((a[0] - p[0]) / la) * rr, p[1] + ((a[1] - p[1]) / la) * rr];
    const e = [p[0] + ((b[0] - p[0]) / lb) * rr, p[1] + ((b[1] - p[1]) / lb) * rr];
    for (let k = 0; k <= n; k++) {
      const t = k / n, u = 1 - t;
      out.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]);
    }
  }
  return out;
}

export const THEMES = {
  meadow: {
    rough: '#2c6431',
    grass: ['#5bb34b', 'rgba(255,255,255,0.055)'],
    rail: ['#4a2f18', '#7c5230', '#b3804f'],
    trees: [
      ['#1c4d24', '#2a7132', '#3f9444'],
      ['#1f5a2a', '#2f8039', '#4caa4e'],
      ['#244b1d', '#3a6e28', '#5b9338'],
    ],
  },
  autumn: {
    rough: '#4b6a2b',
    grass: ['#62b24a', 'rgba(255,255,255,0.05)'],
    rail: ['#4a2c16', '#80502a', '#bf8a55'],
    trees: [
      ['#8e3a17', '#c75b22', '#ef8c3a'],
      ['#7a2418', '#ad3b25', '#dd6440'],
      ['#8a6412', '#c49420', '#eec64a'],
      ['#2f5a24', '#467d30', '#64a044'],
    ],
  },
  dusk: {
    rough: '#1a3a39',
    grass: ['#3f9b58', 'rgba(255,255,255,0.045)'],
    rail: ['#2a2238', '#4a3b63', '#7a68a0'],
    trees: [
      ['#0f2a2a', '#18423d', '#24604f'],
      ['#142a38', '#1e4152', '#2e5f72'],
    ],
    fireflies: true,
  },
};

export const LEVELS = [
  {
    name: 'Opening Drive',
    par: 2,
    theme: 'meadow',
    tee: [210, 350],
    hole: [790, 350],
    course: soft(rect(120, 250, 760, 200), 40),
  },
  {
    name: 'Dogleg Right',
    par: 3,
    theme: 'meadow',
    tee: [185, 200],
    hole: [795, 530],
    course: soft([[100, 110], [620, 110], [900, 390], [900, 610], [690, 610], [690, 440], [540, 290], [100, 290]], 30),
    bumpers: [{ x: 640, y: 250, r: 20 }],
  },
  {
    name: 'Bunker Hill',
    par: 3,
    theme: 'autumn',
    tee: [170, 350],
    hole: [835, 350],
    course: soft(rect(80, 140, 840, 420), 40),
    walls: [soft(rect(450, 265, 100, 170), 14)],
    sand: [ellipse(735, 350, 40, 85), ellipse(500, 195, 85, 38), ellipse(500, 505, 85, 38)],
  },
  {
    name: 'The Windmill',
    par: 3,
    theme: 'meadow',
    tee: [180, 350],
    hole: [820, 350],
    course: soft(
      [[90, 190], [330, 190], [380, 250], [620, 250], [670, 190], [910, 190], [910, 510], [670, 510], [620, 450], [380, 450], [330, 510], [90, 510]],
      26,
    ),
    walls: [soft(rect(470, 236, 60, 86), 8), soft(rect(470, 378, 60, 86), 8)],
    spinners: [{ x: 500, y: 290, len: 110, speed: 1.5, blades: 4, w: 12 }],
  },
  {
    name: 'Lake Crossing',
    par: 3,
    theme: 'meadow',
    tee: [180, 470],
    hole: [830, 230],
    course: soft(rect(80, 100, 840, 500), 40),
    water: [
      [[330, 80], [650, 80], [650, 300], [330, 420]],
      [[330, 480], [650, 360], [650, 620], [330, 620]],
    ],
    sand: [ellipse(770, 430, 60, 34)],
  },
  {
    name: 'Pinball Wizard',
    par: 3,
    theme: 'dusk',
    tee: [160, 350],
    hole: [845, 350],
    course: soft([[210, 80], [790, 80], [920, 210], [920, 490], [790, 620], [210, 620], [80, 490], [80, 210]], 22),
    bumpers: [
      { x: 330, y: 230, r: 24 },
      { x: 330, y: 470, r: 24 },
      { x: 480, y: 350, r: 26 },
      { x: 480, y: 160, r: 22 },
      { x: 480, y: 540, r: 22 },
      { x: 630, y: 230, r: 24 },
      { x: 630, y: 470, r: 24 },
      { x: 790, y: 262, r: 20 },
      { x: 790, y: 438, r: 20 },
    ],
  },
  {
    name: 'The Volcano',
    par: 3,
    theme: 'autumn',
    tee: [160, 350],
    hole: [500, 350],
    course: ellipse(500, 350, 430, 280, 44),
    slopes: [{ x: 500, y: 350, r0: 28, r1: 160, strength: 420 }],
    walls: [ellipse(270, 200, 38, 28, 14, 0.4), ellipse(300, 520, 44, 30, 14, -0.3), ellipse(760, 490, 40, 28, 14, 0.2), ellipse(740, 200, 30, 24, 14)],
    sand: [ellipse(500, 580, 80, 28)],
  },
  {
    name: 'Wormhole',
    par: 2,
    theme: 'dusk',
    tee: [180, 420],
    hole: [830, 190],
    course: soft(rect(80, 100, 840, 500), 36),
    walls: [rect(470, 80, 60, 540)],
    portals: [{ a: [370, 190], b: [630, 510] }],
    movers: [{ x: 700, y: 260, w: 36, h: 90, dx: 0, dy: 120, period: 3.2 }],
  },
  {
    name: 'Grand Finale',
    par: 4,
    theme: 'meadow',
    tee: [195, 160],
    hole: [800, 530],
    course: soft(rect(80, 80, 840, 540), 36),
    walls: [soft(rect(310, 60, 40, 400), 12), soft(rect(630, 240, 40, 400), 12)],
    slopes: [{ poly: rect(350, 260, 280, 190), force: [0, 260] }],
    spinners: [{ x: 490, y: 170, len: 75, speed: -1.8, blades: 2, w: 12 }],
    movers: [{ x: 630, y: 95, w: 40, h: 44, dx: 0, dy: 48, period: 2.6 }],
    water: [ellipse(855, 300, 55, 62)],
    sand: [ellipse(760, 420, 55, 30)],
  },
];
