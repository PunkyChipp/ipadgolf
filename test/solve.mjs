// Playability check: beam-searches shots on every hole and reports the fewest
// strokes found, plus how often a single shot from the tee sinks it.
// Run with: npm test
import { World, pointInPoly, STEP } from '../src/physics.js';
import { LEVELS } from '../src/levels.js';

const CELL = 10;

// Walking distance to the hole over the playable grid (ignores walls' shortcuts).
function distanceField(L) {
  const cols = 110, rows = 80;
  const field = new Float32Array(cols * rows).fill(Infinity);
  const ok = (cx, cy) => {
    const x = cx * CELL + 5, y = cy * CELL + 5;
    if (!pointInPoly(x, y, L.course)) return false;
    if ((L.walls || []).some((w) => pointInPoly(x, y, w))) return false;
    if ((L.water || []).some((w) => pointInPoly(x, y, w))) return false;
    return true;
  };
  const start = [Math.floor(L.hole[0] / CELL), Math.floor(L.hole[1] / CELL)];
  const q = [start];
  field[start[1] * cols + start[0]] = 0;
  while (q.length) {
    const [cx, cy] = q.shift();
    const d = field[cy * cols + cx];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (field[ny * cols + nx] !== Infinity || !ok(nx, ny)) continue;
      field[ny * cols + nx] = d + 1;
      q.push([nx, ny]);
    }
  }
  return (x, y) => {
    const v = field[Math.floor(y / CELL) * cols + Math.floor(x / CELL)];
    return v === undefined ? Infinity : v;
  };
}

function simulate(L, s, angle, power) {
  const w = new World(L);
  w.t = s.t;
  w.kinematics();
  w.ball.x = s.x;
  w.ball.y = s.y;
  w.shoot(angle, power);
  for (let i = 0; i < 35 / STEP && w.moving; i++) w.substep();
  const penalty = w.events.filter((e) => e.type === 'water').length;
  return { x: w.ball.x, y: w.ball.y, t: w.t, sunk: w.sunk, penalty };
}

const ANGLES = 72;
const POWERS = [0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.7, 0.8, 0.9, 1];
let failures = 0;

for (const L of LEVELS) {
  const dist = distanceField(L);
  let beam = [{ x: L.tee[0], y: L.tee[1], t: 0, strokes: 0 }];
  let best = null;
  let aces = 0, firstTotal = 0;
  for (let depth = 1; depth <= L.par + 2 && !best; depth++) {
    const next = [];
    for (const s of beam) {
      for (let a = 0; a < ANGLES; a++) {
        for (const p of POWERS) {
          const r = simulate(L, s, (a / ANGLES) * Math.PI * 2, p);
          const strokes = s.strokes + 1 + r.penalty;
          if (depth === 1) { firstTotal++; if (r.sunk) aces++; }
          if (r.sunk) { if (!best || strokes < best) best = strokes; continue; }
          next.push({ x: r.x, y: r.y, t: r.t, strokes, h: dist(r.x, r.y) + r.penalty * 20 });
        }
      }
    }
    // Keep the best few, one per grid cell so the beam stays diverse.
    next.sort((a, b) => a.h - b.h);
    const seen = new Set();
    beam = [];
    for (const n of next) {
      const key = `${Math.floor(n.x / 30)},${Math.floor(n.y / 30)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(n);
      if (beam.length >= 6) break;
    }
  }
  const ok = best !== null && best <= L.par;
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${L.name.padEnd(16)} par ${L.par}  best found ${best ?? '-'}  ` +
      `ace rate ${((aces / firstTotal) * 100).toFixed(1)}%`,
  );
}
process.exit(failures ? 1 : 0);
