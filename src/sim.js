// Shot simulation. Pure and deterministic: the same inputs and seed always
// give the same result, so two iPads can replay each other's shots exactly.
import { T, TERRAIN_NAMES, rng, hashSeed } from './course.js';

export const G = 10.72; // gravity, yards/s²
export const CUP_R = 0.075; // a little larger than a real cup (0.059 yd)
export const FPS = 60;

// carry/roll in yards on a flat fairway with no wind; up = time for the swing
// meter to reach 100% (smaller is faster and harder); win = accuracy window scale.
export const CLUBS = [
  { id: 'D', name: 'Driver', carry: 250, roll: 22, apex: 32, time: 6.4, up: 0.8, win: 0.8 },
  { id: '3W', name: '3 Wood', carry: 226, roll: 16, apex: 30, time: 6.0, up: 0.84, win: 0.86 },
  { id: '3H', name: '3 Hybrid', carry: 205, roll: 11, apex: 29, time: 5.6, up: 0.87, win: 0.92 },
  { id: '4I', name: '4 Iron', carry: 191, roll: 9, apex: 28, time: 5.4, up: 0.9, win: 0.95 },
  { id: '5I', name: '5 Iron', carry: 181, roll: 8, apex: 29, time: 5.3, up: 0.91, win: 0.97 },
  { id: '6I', name: '6 Iron', carry: 171, roll: 7, apex: 30, time: 5.2, up: 0.92, win: 1 },
  { id: '7I', name: '7 Iron', carry: 160, roll: 6, apex: 31, time: 5.1, up: 0.94, win: 1 },
  { id: '8I', name: '8 Iron', carry: 148, roll: 5, apex: 32, time: 5.0, up: 0.95, win: 1.03 },
  { id: '9I', name: '9 Iron', carry: 136, roll: 4, apex: 33, time: 4.9, up: 0.97, win: 1.05 },
  { id: 'PW', name: 'Pitching Wedge', carry: 124, roll: 3, apex: 33, time: 4.8, up: 0.99, win: 1.08, wedge: true },
  { id: 'GW', name: 'Gap Wedge', carry: 105, roll: 2.2, apex: 30, time: 4.5, up: 1.01, win: 1.1, wedge: true },
  { id: 'SW', name: 'Sand Wedge', carry: 85, roll: 1.5, apex: 28, time: 4.2, up: 1.04, win: 1.12, wedge: true },
  { id: 'LW', name: 'Lob Wedge', carry: 64, roll: 1, apex: 26, time: 3.9, up: 1.07, win: 1.15, wedge: true },
  { id: 'P', name: 'Putter', putter: true, up: 1.15, win: 1 },
];
export const PUTTER = CLUBS.length - 1;

// Shot shapes. Punch stays under the branches and runs out; High climbs over
// trouble but loses distance and is harder to time.
export const SHAPES = [
  { id: 'normal', name: 'Normal', carry: 1, apex: 1, time: 1, roll: 1, rollAdd: 0, win: 1 },
  { id: 'punch', name: 'Punch', carry: 0.6, apex: 0.13, maxApex: 2.3, time: 0.62, roll: 2.4, rollAdd: 7, win: 1.15 },
  { id: 'high', name: 'High', carry: 0.88, apex: 1.45, time: 1.1, roll: 0.35, rollAdd: 0, win: 0.85 },
];
export const PUTT_SCALES = [5, 10, 20, 35]; // yards covered at 100% on a flat green

// How each surface slows a rolling ball (yd/s²) and how much it lets a
// landing ball release forward.
const DECEL = { [T.TEE]: 2.2, [T.FAIRWAY]: 2.2, [T.FRINGE]: 1.5, [T.GREEN]: 0.62, [T.ROUGH]: 6.5, [T.DEEP]: 13, [T.SAND]: 26, [T.OB]: 6, [T.WATER]: 30 };
const RELEASE = { [T.TEE]: 1, [T.FAIRWAY]: 1, [T.FRINGE]: 0.7, [T.GREEN]: 0.55, [T.ROUGH]: 0.35, [T.DEEP]: 0.15, [T.SAND]: 0.02, [T.OB]: 0.3 };

// How much backspin can grip on each surface.
const SPIN_GRIP = { [T.GREEN]: 1, [T.FRINGE]: 0.7, [T.FAIRWAY]: 0.55, [T.TEE]: 0.5, [T.ROUGH]: 0.15 };

// Lie effects: distance multiplier, random "flyer" spread, accuracy window.
export function lieEffect(lie, club) {
  const c = CLUBS[club];
  if (c.putter) return { dist: 1, spread: 0, win: 1 };
  switch (lie) {
    case T.TEE: return { dist: 1, spread: 0, win: 1.1 };
    case T.FAIRWAY: return { dist: c.id === 'D' ? 0.92 : 1, spread: 0, win: c.id === 'D' ? 0.7 : 1 };
    case T.FRINGE: return { dist: 0.98, spread: 0, win: 1 };
    case T.GREEN: return { dist: 0.95, spread: 0, win: 1 };
    case T.ROUGH: return { dist: 0.87, spread: 0.06, win: c.id === 'D' ? 0.55 : 0.85 };
    case T.DEEP: return { dist: c.carry > 190 ? 0.55 : 0.7, spread: 0.1, win: 0.62 };
    case T.SAND: return c.wedge ? { dist: 0.88, spread: 0.05, win: 0.8 } : { dist: 0.5, spread: 0.12, win: 0.55 };
    default: return { dist: 1, spread: 0, win: 1 };
  }
}

// Accuracy window half-width in meter units (0 = sweet spot, 1 = full power).
export function meterWindow(lie, club, power, shape = 0, spinMag = 0) {
  let w = 0.07 * CLUBS[club].win * lieEffect(lie, club).win * (CLUBS[club].putter ? 1 : SHAPES[shape].win);
  w *= 1 - 0.12 * Math.min(1, spinMag); // shaping the ball is harder
  if (power > 1) w *= 1 - (power - 1) * 4; // overswing narrows the window
  return Math.max(0.012, w);
}

// Timing error e is in accuracy-window units: inside +-1 is a good strike.
// Missing the window mostly bends the ball (hooks and slices); only a swing
// that is wildly off becomes a shank or a duff.
export const MISHIT = 2.2;

export function shotLabel(e) {
  const a = Math.abs(e);
  if (a <= 0.22) return 'Perfect';
  if (a <= 0.55) return e > 0 ? 'Fade' : 'Draw';
  if (a <= 1.1) return e > 0 ? 'Slice' : 'Hook';
  if (a <= MISHIT) return e > 0 ? 'Big slice' : 'Snap hook';
  return e > 0 ? 'Shank' : 'Duff';
}

// Sideways curve as a fraction of carry for a timing error.
function timingCurve(e) {
  const a = Math.abs(e);
  if (a > MISHIT) return Math.sign(e) * (e > 0 ? 0.33 : 0.05);
  const c = a <= 1 ? a * 0.12 : 0.12 + (a - 1) * 0.14;
  return Math.sign(e) * c;
}

const dirOf = (a) => [Math.cos(a), Math.sin(a)];

// Main entry: returns animation frames plus the outcome.
// ball: { x, y, lie }; input: { club, aim, power, acc, puttScale }; wind: { speed, dir }
export function simulateShot(hole, ball, input, wind, seed) {
  const r = rng(seed);
  const club = CLUBS[input.club];
  const frames = [];
  const res = { frames, penalty: 0, outcome: 'ok', label: '', carry: 0, events: [] };
  const [dx, dy] = dirOf(input.aim);
  const [rx, ry] = [-dy, dx]; // unit vector to the right of the aim line

  if (club.putter) {
    const dist = Math.max(0, input.power) * (input.puttScale || 10);
    const decel = DECEL[T.GREEN];
    const v0 = Math.sqrt(2 * decel * dist);
    res.label = 'Putt';
    roll(hole, ball.x, ball.y, dx * v0, dy * v0, frames, res, 0);
    return finish(hole, ball, res);
  }

  const fp = flightParams(ball, input, wind, r);
  const { carry, flight, apex, mishit } = fp;
  res.label = shotLabel(input.acc);
  res.carry = carry;
  const p = input.power;
  const passed = new Set();

  const n = Math.max(2, Math.round(flight * FPS));
  let hitTree = null;
  for (let i = 0; i <= n; i++) {
    const { x, y, z } = flightPoint(ball, fp, i / n);
    // Branches stop the ball; it can pass under the canopy or clip the edge.
    if (i > 2) {
      const t = treeAt(hole, x, y, z, passed, r);
      if (t) hitTree = { x, y, z, t: t.t };
    }
    frames.push({ x, y, z });
    if (hitTree) break;
  }

  if (hitTree) {
    res.events.push({ type: 'tree', x: hitTree.x, y: hitTree.y, f: frames.length - 1 });
    // Drop out of the branches.
    const drop = Math.round(0.35 * FPS);
    const a = r() * Math.PI * 2;
    for (let i = 1; i <= drop; i++) {
      const k = i / drop;
      frames.push({ x: hitTree.x + Math.cos(a) * k * 2, y: hitTree.y + Math.sin(a) * k * 2, z: hitTree.z * (1 - k * k) });
    }
    const last = frames[frames.length - 1];
    const land = hole.terrainAt(last.x, last.y);
    res.landedOn = land;
    if (land === T.WATER) return water(hole, ball, res, last);
    if (land === T.OB) return ob(ball, res);
    const v = 1 + r() * 2;
    roll(hole, last.x, last.y, Math.cos(a) * v, Math.sin(a) * v, frames, res, 0);
    return finish(hole, ball, res);
  }

  const last = frames[frames.length - 1];
  const land = hole.terrainAt(last.x, last.y);
  res.landedOn = land;
  res.events.push({ type: 'land', x: last.x, y: last.y, f: frames.length - 1, terrain: land });
  if (land === T.WATER) return water(hole, ball, res, last);
  if (land === T.OB) return ob(ball, res);
  if (land === T.GREEN && Math.hypot(last.x - hole.pin.x, last.y - hole.pin.y) < CUP_R * 1.6) {
    res.outcome = 'holed';
    res.events.push({ type: 'dunk', f: frames.length - 1 });
    return finish(hole, ball, res, { x: hole.pin.x, y: hole.pin.y });
  }

  // Release: how far it runs depends on the club, the power and where it lands.
  const prev = frames[Math.max(0, frames.length - 4)];
  let hx = last.x - prev.x, hy = last.y - prev.y;
  const hl = Math.hypot(hx, hy) || 1;
  hx /= hl; hy /= hl;
  let rollDist = (club.roll * fp.shape.roll + fp.shape.rollAdd) * (RELEASE[land] ?? 0.3) * Math.min(1, p) * (mishit ? 2 : 1);
  if (p > 1) rollDist *= 1.15;
  // Topspin releases the ball; backspin grips, and a wedge can zip it backwards.
  rollDist *= 1 + 1.2 * fp.top;
  const bite = (club.wedge ? 1 : club.carry > 200 ? 0.25 : 0.6) * (SPIN_GRIP[land] ?? 0) * Math.min(1, p) * (mishit ? 0 : 1);
  rollDist -= fp.back * bite * 8;
  // Side spin kicks the ball sideways as it lands.
  const kick = fp.spin.x * 0.22;
  [hx, hy] = [hx * Math.cos(kick) - hy * Math.sin(kick), hx * Math.sin(kick) + hy * Math.cos(kick)];
  if (rollDist < 0) {
    hx = -hx;
    hy = -hy;
    rollDist = -rollDist;
    if (rollDist > 0.8) res.events.push({ type: 'spinback', f: frames.length - 1 });
  }
  const v0 = Math.sqrt(2 * DECEL[land] * rollDist);
  roll(hole, last.x, last.y, hx * v0, hy * v0, frames, res, Math.min(apex * 0.06, 1.6));
  return finish(hole, ball, res);
}

// Ground roll with surface friction, green slopes and the cup.
function roll(hole, x, y, vx, vy, frames, res, hop) {
  const sub = 4, dt = 1 / (FPS * sub);
  let t = 0, overCup = false;
  for (let frame = 0; frame < FPS * 40; frame++) {
    for (let k = 0; k < sub; k++) {
      t += dt;
      const ter = hole.terrainAt(x, y);
      if (ter === T.WATER || ter === T.OB) {
        frames.push({ x, y, z: 0 });
        res.landedOn = ter;
        res.rolledInto = ter;
        return;
      }
      const decel = DECEL[ter] ?? 3;
      const [gx, gy] = hole.slopeAt(x, y);
      const ax = -G * gx, ay = -G * gy;
      const sp = Math.hypot(vx, vy);
      if (sp < 0.02) {
        // Static friction: only a steep slope gets a stopped ball moving.
        if (Math.hypot(ax, ay) < decel * 0.9) {
          frames.push({ x, y, z: 0 });
          return;
        }
      }
      vx += ax * dt;
      vy += ay * dt;
      const sp2 = Math.hypot(vx, vy);
      if (sp2 > 0) {
        const ns = Math.max(0, sp2 - decel * dt);
        vx *= ns / sp2;
        vy *= ns / sp2;
      }
      x += vx * dt;
      y += vy * dt;
      // The cup: slow enough and it drops, too fast and it lips out.
      const cx = hole.pin.x - x, cy = hole.pin.y - y;
      const cd = Math.hypot(cx, cy);
      if (cd < CUP_R) {
        const s = Math.hypot(vx, vy);
        if (s < 1.35 || (cd < CUP_R * 0.5 && s < 2.1)) {
          frames.push({ x: hole.pin.x, y: hole.pin.y, z: 0 });
          res.outcome = 'holed';
          return;
        }
        if (!overCup) res.events.push({ type: 'lip', f: frames.length });
        overCup = true;
        vx += (cx / (cd || 1)) * 9 * dt;
        vy += (cy / (cd || 1)) * 9 * dt;
      } else {
        overCup = false;
      }
    }
    // Little hops just after landing, purely visual.
    const z = hop > 0 && t < 0.9 ? Math.abs(Math.sin((t / 0.45) * Math.PI)) * hop * (t < 0.45 ? 1 : 0.35) : 0;
    frames.push({ x, y, z });
  }
}

function water(hole, ball, res, last) {
  // Drop behind the hazard on the line back towards where the shot came from.
  res.outcome = 'water';
  res.penalty = 1;
  res.events.push({ type: 'splash', x: last.x, y: last.y, f: res.frames.length - 1 });
  let px = last.x, py = last.y;
  const dx = ball.x - px, dy = ball.y - py, d = Math.hypot(dx, dy) || 1;
  let steps = 0;
  while (steps++ < 600) {
    px += (dx / d) * 1;
    py += (dy / d) * 1;
    const t = hole.terrainAt(px, py);
    if (t !== T.WATER && t !== T.OB) break;
  }
  px += (dx / d) * 2;
  py += (dy / d) * 2;
  res.final = { x: px, y: py, lie: hole.terrainAt(px, py) };
  return res;
}

function ob(ball, res) {
  res.outcome = 'ob';
  res.penalty = 1;
  res.final = { x: ball.x, y: ball.y, lie: ball.lie };
  return res;
}

function finish(hole, ball, res, at) {
  const last = at || res.frames[res.frames.length - 1];
  if (res.rolledInto === T.WATER) return water(hole, ball, res, last);
  if (res.rolledInto === T.OB) return ob(ball, res);
  if (res.outcome === 'holed') {
    res.final = { x: hole.pin.x, y: hole.pin.y, lie: T.GREEN };
    return res;
  }
  res.final = { x: last.x, y: last.y, lie: hole.terrainAt(last.x, last.y) };
  return res;
}

// Everything that shapes a full shot's flight. r supplies the lie's random
// spread (a neutral 0.5 for previews).
export function flightParams(ball, input, wind, r = () => 0.5) {
  const club = CLUBS[input.club];
  const shape = SHAPES[input.shape || 0];
  const lie = lieEffect(ball.lie, input.club);
  const e = input.acc || 0;
  const mishit = Math.abs(e) > MISHIT;
  const p = input.power;
  const powerDist = p <= 1 ? p : 1 + (p - 1) * 0.8;
  const spin = input.spin || { x: 0, y: 0 };
  const top = Math.max(0, spin.y), back = Math.max(0, -spin.y);
  let carry = club.carry * shape.carry * powerDist * lie.dist * (1 + (r() - 0.5) * 2 * lie.spread);
  carry *= 1 - 0.05 * Math.min(1, Math.hypot(spin.x, spin.y));
  if (mishit) carry *= e > 0 ? 0.55 : 0.35;
  else carry *= 1 - Math.min(0.1, Math.max(0, Math.abs(e) - 0.22) * 0.05);
  const flight = club.time * shape.time * (0.45 + 0.55 * Math.min(1, p));
  let apex = club.apex * shape.apex * (0.4 + 0.6 * Math.min(1, p)) * (mishit && e < 0 ? 0.35 : 1);
  apex *= (1 - 0.25 * top) * (1 + 0.12 * back);
  if (shape.maxApex) apex = Math.min(apex, shape.maxApex);
  const [dx, dy] = dirOf(input.aim);
  const [rx, ry] = [-dy, dx];
  // Wind: component along the aim line changes carry, crosswind drifts the ball.
  const wx = Math.cos(wind.dir) * wind.speed, wy = Math.sin(wind.dir) * wind.speed;
  const along = wx * dx + wy * dy;
  const cross = wx * rx + wy * ry;
  carry = Math.max(3, carry + along * 0.26 * flight * (apex / 30));
  return {
    carry, flight, apex, mishit, shape, dx, dy, rx, ry,
    drift: cross * 0.3 * flight * (apex / 30),
    // side spin bends the ball on purpose; timing errors add to it
    curve: (timingCurve(e) + spin.x * 0.17) * carry,
    spin, top, back,
    push: Math.max(-0.05, Math.min(0.05, e * 0.018)), // start line a touch off with mistimed swings
  };
}

export function flightPoint(ball, fp, s) {
  const alongD = fp.carry * (1 - Math.pow(1 - s, 1.6));
  const lat = fp.push * alongD + fp.curve * s * s + fp.drift * Math.pow(s, 1.5);
  const sp = Math.pow(s, 1.25);
  return {
    x: ball.x + fp.dx * alongD + fp.rx * lat,
    y: ball.y + fp.dy * alongD + fp.ry * lat,
    z: 4 * fp.apex * sp * (1 - sp),
    along: alongD,
  };
}

// Does a ball at (x, y, z) hit a tree? Trunks stop low balls; the canopy
// only matters between its base and top. Near the canopy edge a ball gets
// through half the time (only when r is given; previews count it as a hit).
export function treeAt(hole, x, y, z, passed, r) {
  for (const t of hole.treesNear(x, y)) {
    if (passed && passed.has(t)) continue;
    const d = Math.hypot(x - t.x, y - t.y);
    if (d < 0.5 && z < t.h) return { t, edge: false };
    if (d < t.r && z >= t.base && z < t.h) {
      const edge = d > t.r * 0.7;
      if (edge && r) {
        if (r() < 0.5) {
          passed.add(t);
          continue;
        }
      }
      return { t, edge };
    }
  }
  return null;
}

// Side-view preview of a shot with no wind and a perfect strike.
export function previewShot(hole, ball, input) {
  const fp = flightParams(ball, { ...input, acc: 0 }, { speed: 0, dir: 0 });
  const pts = [];
  let hit = null;
  const n = Math.max(40, Math.round(fp.carry * 1.5));
  for (let i = 0; i <= n; i++) {
    const q = flightPoint(ball, fp, i / n);
    pts.push({ d: q.along, z: q.z });
    if (!hit && i > 0) {
      const t = treeAt(hole, q.x, q.y, q.z, null, null);
      if (t) hit = { d: q.along, z: q.z, edge: t.edge };
    }
  }
  return { carry: fp.carry, apex: fp.apex, pts, hit };
}

export function shotSeed(gameSeed, hole, player, stroke) {
  return hashSeed(gameSeed, 'shot', hole, player, stroke);
}

// Club suggestion for a given distance to the pin, allowing for the lie.
export function suggestClub(dist, lie) {
  if (lie === T.GREEN) return PUTTER;
  for (let i = CLUBS.length - 2; i >= 0; i--) {
    if (i === 0 && lie !== T.TEE) continue;
    const c = CLUBS[i];
    if (c.carry * lieEffect(lie, i).dist + c.roll * 0.5 >= dist) return i;
  }
  return lie === T.TEE ? 0 : 1;
}

export function suggestPuttScale(dist) {
  for (const s of PUTT_SCALES) if (dist * 1.25 <= s) return s;
  return PUTT_SCALES[PUTT_SCALES.length - 1];
}

export const terrainName = (t) => TERRAIN_NAMES[t];
