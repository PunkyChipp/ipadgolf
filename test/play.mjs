// Plays every hole with a bot golfer to check the course is fair and the
// simulation is deterministic. Run with: npm test
//   skill 0 = perfect swings, higher = sloppier timing (in accuracy-window units)
import { buildHole, windFor, T, rng, COURSES } from '../src/course.js';
import { simulateShot, CLUBS, PUTTER, PUTT_SCALES, suggestPuttScale } from '../src/sim.js';

const SEED = Number(process.env.SEED || 7);
const ROUNDS = Number(process.env.ROUNDS || 1);

function pickShot(hole, ball, wind) {
  const dx = hole.pin.x - ball.x, dy = hole.pin.y - ball.y;
  const dist = Math.hypot(dx, dy);
  if (ball.lie === T.GREEN || (ball.lie === T.FRINGE && dist < 12)) return putt(hole, ball, dist);
  // Target: the pin if in range, otherwise a lay-up point on the centre line.
  let target = { x: hole.pin.x, y: hole.pin.y };
  const longest = ball.lie === T.TEE ? 0 : 1;
  const reach = CLUBS[longest].carry + CLUBS[longest].roll;
  if (dist > reach) {
    let pt = hole.path[hole.path.length - 1];
    const sBall = hole.nearest(ball.x, ball.y)[1];
    for (const p of hole.path) if (p.s > sBall && Math.hypot(p.x - ball.x, p.y - ball.y) >= reach * 0.97) { pt = p; break; }
    target = pt;
  }
  // Like a thinking player: try clubs, aims and powers, keep the best landing.
  let best = null;
  const baseAim = Math.atan2(target.y - ball.y, target.x - ball.x);
  const want = Math.hypot(target.x - ball.x, target.y - ball.y);
  for (let c = longest; c < PUTTER; c++) {
    const club = CLUBS[c];
    if (club.carry + club.roll < want * 0.85 && c !== longest) continue;
    if (club.carry * 0.45 > want && c !== PUTTER - 1) continue;
    for (let da = -0.09; da <= 0.091; da += 0.03) {
      for (const power of [1, 0.85, 0.7, 0.55, 0.4, 0.25]) {
        const input = { club: c, aim: baseAim + da, power, acc: 0 };
        const r = simulateShot(hole, ball, input, wind, 5);
        const f = r.final;
        let cost = Math.hypot(f.x - target.x, f.y - target.y) + r.penalty * 60;
        if (f.lie === T.SAND) cost += 15;
        if (f.lie === T.DEEP) cost += 20;
        if (f.lie === T.ROUGH) cost += 6;
        if (!best || cost < best.cost) best = { cost, input };
      }
    }
  }
  return { ...best.input };
}

function putt(hole, ball, dist) {
  // A good putter: search aim and pace for the best simulated result.
  const scale = suggestPuttScale(dist);
  const base = Math.atan2(hole.pin.y - ball.y, hole.pin.x - ball.x);
  let best = null;
  for (let da = -0.2; da <= 0.2; da += 0.02) {
    for (let p = 0.05; p <= 1; p += 0.05) {
      const input = { club: PUTTER, aim: base + da, power: p, acc: 0, puttScale: scale };
      const r = simulateShot(hole, ball, input, { speed: 0, dir: 0 }, 1);
      const f = r.final;
      const miss = r.outcome === 'holed' ? 0 : Math.hypot(f.x - hole.pin.x, f.y - hole.pin.y);
      if (!best || miss < best.miss) best = { miss, input };
      if (miss === 0) return best.input;
    }
  }
  return best.input;
}

function playHole(h, skill, r) {
  const hole = buildHole(h, SEED);
  const wind = windFor(h, SEED);
  let ball = { x: hole.tee.x, y: hole.tee.y, lie: T.TEE };
  let strokes = 0;
  const log = [];
  while (strokes < hole.par + 6) {
    const shot = pickShot(hole, ball, wind);
    if (shot.club !== PUTTER) shot.acc = (r() - 0.5) * 2 * skill;
    else shot.power *= 1 + (r() - 0.5) * skill * 0.15;
    const res = simulateShot(hole, ball, shot, wind, 1000 + strokes);
    strokes += 1 + res.penalty;
    log.push(`${CLUBS[shot.club].id} p${shot.power.toFixed(2)} -> ${res.outcome} (${res.final.x.toFixed(0)},${res.final.y.toFixed(0)}) lie ${res.final.lie}`);
    ball = res.final;
    if (res.outcome === 'holed') break;
  }
  return { strokes, log, hole };
}

// Determinism: identical inputs must give identical frames.
{
  const hole = buildHole(0, SEED);
  const input = { club: 0, aim: -Math.PI / 2, power: 1, acc: 0.3 };
  const a = simulateShot(hole, { x: 0, y: 0, lie: T.TEE }, input, windFor(0, SEED), 42);
  const b = simulateShot(buildHole(0, SEED), { x: 0, y: 0, lie: T.TEE }, input, windFor(0, SEED), 42);
  if (JSON.stringify(a.final) !== JSON.stringify(b.final)) throw new Error('simulation is not deterministic');
  console.log(`determinism ok, driver carry ${a.carry.toFixed(1)} yd, final ${a.final.x.toFixed(1)},${a.final.y.toFixed(1)}`);
}

if (process.env.TRACE) {
  const h = Number(process.env.TRACE) - 1;
  const out = playHole(h, 0, rng(1));
  console.log(out.hole.name, 'pin', out.hole.pin.x.toFixed(0), out.hole.pin.y.toFixed(0), windFor(h, SEED));
  console.log(out.log.join('\n'));
  process.exit(0);
}
let fail = 0;
for (const course of COURSES) {
  for (const skill of [0, 0.8]) {
    const r = rng(99);
    let total = 0, par = 0;
    const per = [];
    for (const h of course.holes) {
      let sum = 0;
      for (let k = 0; k < ROUNDS; k++) sum += playHole(h, skill, r).strokes;
      const avg = sum / ROUNDS;
      const hole = buildHole(h, SEED);
      per.push(`${hole.par}:${avg.toFixed(1)}`);
      if (skill === 0 && avg > hole.par + 1) {
        fail++;
        console.log(`  too hard for a perfect bot: ${course.name} ${hole.name}`);
      }
      total += avg;
      par += hole.par;
    }
    console.log(`${course.name} skill ${skill}: avg ${total.toFixed(1)} vs par ${par}  [${per.join(' ')}]`);
  }
}
process.exit(fail ? 1 : 0);

export { playHole };
