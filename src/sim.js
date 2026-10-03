// Shot simulation. Pure and deterministic: the same inputs and seed always
// give the same result, so two iPads can replay each other's shots exactly.
import { T, TERRAIN_NAMES, rng, hashSeed } from './course.js?v=19';

export const G = 10.72; // gravity, yards/s²
export const CUP_R = 0.075; // a little larger than a real cup (0.059 yd)

// The ball falling into the cup: it carries on over the lip toward the
// middle, catches the far side and drops below the surface (z < 0).
function sink(hole, frames, x, y, vx = 0, vy = 0) {
  const n = 22;
  const sp = Math.hypot(vx, vy);
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const e = 1 - (1 - k) * (1 - k);
    // A touch of momentum past centre, pulled back by the far wall.
    const over = sp > 0 ? Math.sin(k * Math.PI) * Math.min(0.03, sp * 0.012) : 0;
    frames.push({
      x: x + (hole.pin.x - x) * e + (vx / (sp || 1)) * over,
      y: y + (hole.pin.y - y) * e + (vy / (sp || 1)) * over,
      z: -0.13 * k * k,
    });
  }
}
export const FPS = 60;

// Fun mode: silly, overpowered physics (some of them old bugs brought back
// on purpose). Set for the length of one simulateShot call from input.fun,
// so every device replays a player's shots the way they were hit.
let FUN = false;
const funEvent = (res, label, f) => res.events.push({ type: 'fun', label, f: Math.max(0, f) });

// carry/roll in yards on a flat fairway with no wind; up = time for the swing
// meter to reach 100% (smaller is faster and harder); win = accuracy window scale.
export const CLUBS = [
  { id: 'D', chip: 2.6, name: 'Driver', carry: 250, roll: 22, apex: 32, time: 6.4, up: 0.8, win: 0.8 },
  { id: '3W', chip: 2.5, name: '3 Wood', carry: 226, roll: 16, apex: 30, time: 6.0, up: 0.84, win: 0.86 },
  { id: '3H', chip: 2.4, name: '3 Hybrid', carry: 205, roll: 11, apex: 29, time: 5.6, up: 0.87, win: 0.92 },
  { id: '4I', chip: 2.3, name: '4 Iron', carry: 191, roll: 9, apex: 28, time: 5.4, up: 0.9, win: 0.95 },
  { id: '5I', chip: 2.2, name: '5 Iron', carry: 181, roll: 8, apex: 29, time: 5.3, up: 0.91, win: 0.97 },
  { id: '6I', chip: 2.1, name: '6 Iron', carry: 171, roll: 7, apex: 30, time: 5.2, up: 0.92, win: 1 },
  { id: '7I', chip: 2.0, name: '7 Iron', carry: 160, roll: 6, apex: 31, time: 5.1, up: 0.94, win: 1 },
  { id: '8I', chip: 1.7, name: '8 Iron', carry: 148, roll: 5, apex: 32, time: 5.0, up: 0.95, win: 1.03 },
  { id: '9I', chip: 1.4, name: '9 Iron', carry: 136, roll: 4, apex: 33, time: 4.9, up: 0.97, win: 1.05 },
  { id: 'PW', chip: 1.1, name: 'Pitching Wedge', carry: 124, roll: 3, apex: 33, time: 4.8, up: 0.99, win: 1.08, wedge: true },
  { id: 'GW', chip: 0.8, name: 'Gap Wedge', carry: 105, roll: 2.2, apex: 30, time: 4.5, up: 1.01, win: 1.1, wedge: true },
  { id: 'SW', chip: 0.5, name: 'Sand Wedge', carry: 85, roll: 1.5, apex: 28, time: 4.2, up: 1.04, win: 1.12, wedge: true },
  { id: 'LW', chip: 0.28, name: 'Lob Wedge', carry: 64, roll: 1, apex: 26, time: 3.9, up: 1.07, win: 1.15, wedge: true },
  { id: 'P', name: 'Putter', putter: true, up: 1.15, win: 1 },
];
export const PUTTER = CLUBS.length - 1;

// Shot shapes. Punch stays under the branches and runs out; High climbs over
// trouble but loses distance and is harder to time. Around the green, Chip
// flies low and runs like a putt, and Flop floats up and lands softly.
// chip: how much more (or less) a short shot releases than a normal one.
export const SHAPES = [
  { id: 'normal', name: 'Normal', carry: 1, apex: 1, time: 1, roll: 1, rollAdd: 0, win: 1, chip: 1 },
  { id: 'punch', name: 'Punch', carry: 0.6, apex: 0.13, maxApex: 2.3, time: 0.62, roll: 2.4, rollAdd: 7, win: 1.15, chip: 1.4 },
  { id: 'high', name: 'High', carry: 0.88, apex: 1.45, time: 1.1, roll: 0.35, rollAdd: 0, win: 0.85, chip: 0.6 },
  { id: 'chip', name: 'Chip', carry: 0.62, apex: 0.3, time: 0.78, roll: 1, rollAdd: 0, win: 1.12, chip: 1.8, short: true },
  { id: 'flop', name: 'Flop', carry: 0.6, apex: 2.1, time: 1.3, roll: 0.2, rollAdd: 0, win: 0.78, chip: 0.15, short: true, bite: 1.6 },
];
export const FULL_SHAPES = [0, 1, 2];
export const SHORT_SHAPES = [0, 3, 4];

// Equipment. Each choice trades distance, forgiveness (timing window), curve,
// spin and roll. carry/roll/apex multiply; win widens or narrows the timing
// window; curve scales hooks and slices from timing; shape scales deliberate
// side spin; spin scales back and top spin.
const N = { carry: 1, win: 1, curve: 1, shape: 1, spin: 1, roll: 1, apex: 1 };
export const GEAR = [
  {
    slot: 'd', label: 'Driver', options: [
      { id: 'tour', name: 'Tour 9°', desc: 'Balanced distance and control.', stats: [3, 3, 3] },
      { id: 'bomber', name: 'Bomber XL', desc: 'Monster drives, but a tight window and big curves.', stats: [5, 1, 2], carry: 1.09, win: 0.74, curve: 1.35, roll: 1.2, apex: 1.05 },
      { id: 'finder', name: 'Fairway Finder', desc: 'Shorter, but very easy to keep straight.', stats: [2, 5, 3], carry: 0.95, win: 1.3, curve: 0.6, apex: 0.95 },
    ],
  },
  {
    slot: 'i', label: 'Woods & irons', options: [
      { id: 'cavity', name: 'Cavity Backs', desc: 'Forgiving all-rounders.', stats: [3, 3, 3] },
      { id: 'blades', name: 'Tour Blades', desc: 'More spin and much more shaping, but a tighter window.', stats: [3, 2, 5], win: 0.82, spin: 1.3, shape: 1.6 },
      { id: 'gi', name: 'Game Improvement', desc: 'Longer and easier to hit, with less spin and shaping.', stats: [4, 5, 1], carry: 1.05, win: 1.2, spin: 0.7, shape: 0.7, roll: 1.15 },
    ],
  },
  {
    slot: 'w', label: 'Wedges', options: [
      { id: 'std', name: 'All-Purpose', desc: 'Solid from anywhere.', stats: [3, 3, 3] },
      { id: 'spin', name: 'Spin Milled', desc: 'Huge backspin: zips back on the greens. Fussier timing.', stats: [3, 2, 5], spin: 1.6, win: 0.9, bite: 1.5 },
      { id: 'bounce', name: 'High Bounce', desc: 'Glides through sand and rough, but spins less.', stats: [3, 5, 2], spin: 0.8, rescue: 1.35 },
    ],
  },
  {
    slot: 'b', label: 'Ball', options: [
      { id: 'tour', name: 'Tour Ball', desc: 'Balanced spin and distance.', stats: [3, 3, 3] },
      { id: 'distance', name: 'Distance Ball', desc: 'Flies further and rolls out, but barely spins.', stats: [5, 3, 1], carry: 1.04, roll: 1.25, spin: 0.6, shape: 0.85 },
      { id: 'spin', name: 'Spin Ball', desc: 'Grabs the greens and curves on demand, a little shorter.', stats: [2, 3, 5], carry: 0.98, spin: 1.3, shape: 1.25, bite: 1.2 },
    ],
  },
];
export const GEAR_STATS = ['Distance', 'Forgiveness', 'Spin & shaping'];
export const DEFAULT_GEAR = { d: 'tour', i: 'cavity', w: 'std', b: 'tour' };

// Combined effect of the bag on one club from one lie.
export function gearFor(gear, ci, lie) {
  const club = CLUBS[ci];
  const out = { ...N, bite: 1 };
  if (!gear || club.putter) return out;
  const slots = [club.id === 'D' ? 'd' : club.wedge ? 'w' : 'i', 'b'];
  for (const slot of slots) {
    const def = GEAR.find((g) => g.slot === slot);
    const o = def.options.find((k) => k.id === gear[slot]) || def.options[0];
    for (const k of Object.keys(N)) if (o[k] != null) out[k] *= o[k];
    if (o.bite) out.bite *= o.bite;
    // High bounce wedges are kinder from sand and rough.
    if (o.rescue && (lie === T.SAND || lie === T.ROUGH || lie === T.DEEP)) {
      out.win *= o.rescue;
      out.carry *= 1.06;
    }
  }
  return out;
}
export const PUTT_SCALES = [5, 10, 20, 35]; // yards covered at 100% on a flat green

// How each surface slows a rolling ball (yd/s²) and how much it lets a
// landing ball release forward.
const DECEL = { [T.TEE]: 2.2, [T.FAIRWAY]: 2.2, [T.FRINGE]: 1.5, [T.GREEN]: 0.62, [T.ROUGH]: 6.5, [T.DEEP]: 13, [T.SAND]: 26, [T.OB]: 6, [T.WATER]: 30 };
const RELEASE = { [T.TEE]: 1, [T.FAIRWAY]: 1, [T.FRINGE]: 0.7, [T.GREEN]: 0.55, [T.ROUGH]: 0.35, [T.DEEP]: 0.15, [T.SAND]: 0.02, [T.OB]: 0.3 };

// Some courses (Augusta) have faster greens than others.
function decelAt(hole, ter) {
  // Fun: off the greens everything rolls three times faster for the same
  // distance, so a 400 yd rocket roll doesn't take half a minute to watch.
  // The rough doesn't grab the ball either; only sand stops it.
  if (FUN && ter !== T.GREEN) return baseDecel(hole, ter === T.SAND ? T.SAND : T.FAIRWAY) * 3;
  return baseDecel(hole, ter);
}

function baseDecel(hole, ter) {
  if (ter === T.GREEN && hole.greenDecel) return hole.greenDecel;
  // Firm links turf lets the ball run much further.
  if (hole.firm > 1 && (ter === T.FAIRWAY || ter === T.FRINGE || ter === T.TEE)) return DECEL[ter] / hole.firm;
  return DECEL[ter] ?? 3;
}

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
export function meterWindow(lie, club, power, shape = 0, spinMag = 0, gear = null) {
  let w = 0.07 * CLUBS[club].win * lieEffect(lie, club).win * (CLUBS[club].putter ? 1 : SHAPES[shape].win) * gearFor(gear, club, lie).win;
  w *= 1 - 0.12 * Math.min(1, spinMag); // shaping the ball is harder
  if (power > 1) w *= 1 - (power - 1) * 4; // overswing narrows the window
  return Math.max(0.012, w);
}

// Timing error e is in accuracy-window units: inside +-1 is a good strike.
// Missing the window mostly bends the ball (hooks and slices); only a swing
// that is wildly off becomes a shank or a duff.
export const MISHIT = 2.2;

export function shotLabel(e) {
  return strikeOf(e).label;
}

// What kind of strike a timing error gives, for a right-handed golfer.
// The timing error acc is positive when the tap comes early (before the
// line). Releasing early shuts the face: draws and hooks, and the thin and
// fat strikes. Releasing late leaves it open: fades and slices, and with
// irons the dreaded shank off the hosel. Inside, e > 0 means open (right).
// Deliberate shaping pays off when it is timed well, gets overcooked when
// mistimed the same way, and can double-cross when mistimed the other way.
export function strikeOf(acc, spinX = 0, clubIdx = 6, lie = T.FAIRWAY) {
  const e = -acc;
  const a = Math.abs(e);
  const club = CLUBS[clubIdx] || CLUBS[6];
  const wood = club.carry >= 200;
  const teed = lie === T.TEE;
  const k = { kind: 'ok', label: '', carry: 1, apex: 1, flight: 1, push: 0, timing: 1, intended: 1, roll: 1, bite: 1, curveAdd: 0 };
  if (a > MISHIT) {
    let h = Math.sin(e * 9137.13) * 43758.5453;
    h -= Math.floor(h);
    let kind;
    if (e > 0) kind = wood ? (teed && h < 0.5 ? 'sky' : 'banana') : 'shank';
    else kind = teed && wood ? (h < 0.5 ? 'sky' : 'top') : h < 0.5 ? 'top' : 'duff';
    k.kind = kind;
    k.timing = 0;
    k.intended = 0.2;
    if (kind === 'shank') Object.assign(k, { label: 'Shank!', carry: 0.38, apex: 0.35, flight: 0.7, push: 1.15, roll: 1.3, bite: 0 });
    if (kind === 'banana') Object.assign(k, { label: 'Banana slice', carry: 0.72, apex: 0.85, curveAdd: 0.42, roll: 0.8, bite: 0 });
    if (kind === 'sky') Object.assign(k, { label: 'Skied it!', carry: 0.42, apex: 2.3, flight: 1.25, roll: 0.15, bite: 0, push: (h - 0.25) * 0.1 });
    if (kind === 'top') Object.assign(k, { label: 'Topped it', carry: 0.1, apex: 0.05, flight: 0.4, roll: 1.1, bite: 0, push: -0.03 });
    if (kind === 'duff') Object.assign(k, { label: 'Chunked it', carry: 0.3, apex: 0.4, flight: 0.6, roll: 0.5, bite: 0 });
    return k;
  }
  const side = e > 0 ? 1 : -1;
  if (Math.abs(spinX) >= 0.1) {
    const want = spinX > 0 ? (spinX > 0.7 ? 'slice' : 'fade') : spinX > -0.7 ? 'draw' : 'hook';
    if (a <= 0.35) {
      // Pure: the ball does exactly what was asked, with a bonus.
      k.kind = 'pure';
      k.label = 'Pure ' + want + '!';
      k.timing = 0.1;
      if (spinX < 0) { k.carry = 1.04; k.roll = 1.25; } // draws bore through and run
      else { k.bite = 1.4; k.apex = 1.06; } // fades fly high and sit down
      return k;
    }
    if (side === Math.sign(spinX)) {
      k.kind = 'overcooked';
      k.label = side > 0 ? (a > 1.1 ? 'Overcooked slice' : 'Too much fade') : a > 1.1 ? 'Overcooked hook' : 'Too much draw';
      k.timing = 1.7;
    } else {
      k.kind = 'double';
      k.label = 'Double cross!';
      k.intended = -0.55;
      k.timing = 0.6;
    }
  } else if (a <= 0.22) {
    k.kind = 'perfect';
    k.label = 'Perfect';
    return k;
  } else {
    k.kind = a <= 0.55 ? 'shape' : 'miss';
    k.label = a <= 0.55 ? (side > 0 ? 'Fade' : 'Draw') : a <= 1.1 ? (side > 0 ? 'Slice' : 'Hook') : side > 0 ? 'Big slice' : 'Snap hook';
  }
  // Unwanted curve costs: slices balloon and lose distance, hooks dive and
  // run hot.
  const over = Math.max(0, a - 0.45);
  if (side > 0) {
    k.carry *= 1 - Math.min(0.24, over * 0.13);
    k.apex *= 1 + Math.min(0.2, over * 0.1);
    k.roll *= 1 - Math.min(0.5, over * 0.3);
  } else {
    k.carry *= 1 - Math.min(0.12, over * 0.06);
    k.apex *= 1 - Math.min(0.35, over * 0.2);
    k.roll *= 1 + Math.min(0.8, over * 0.45);
  }
  return k;
}

// Sideways curve as a fraction of carry for a timing error.
function timingCurve(e) {
  const a = Math.abs(e);
  if (a > MISHIT) return 0;
  const c = a <= 1 ? a * 0.12 : 0.12 + (a - 1) * 0.14;
  return Math.sign(e) * c;
}

const dirOf = (a) => [Math.cos(a), Math.sin(a)];

// Main entry: returns animation frames plus the outcome.
// ball: { x, y, lie }; input: { club, aim, power, acc, puttScale }; wind: { speed, dir }
export function simulateShot(hole, ball, input, wind, seed) {
  FUN = !!input.fun;
  try {
    return simulate(hole, ball, input, wind, seed);
  } finally {
    FUN = false;
  }
}

function simulate(hole, ball, input, wind, seed) {
  const r = rng(seed);
  const club = CLUBS[input.club];
  const frames = [];
  const res = { frames, penalty: 0, outcome: 'ok', label: '', carry: 0, events: [] };
  const [dx, dy] = dirOf(input.aim);
  const [rx, ry] = [-dy, dx]; // unit vector to the right of the aim line

  if (club.putter) {
    const dist = Math.max(0, input.power) * (input.puttScale || 10);
    const decel = decelAt(hole, T.GREEN);
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
    // Fun: the trees fire it back out like a pinball bumper.
    const v = FUN ? 14 + r() * 16 : 1 + r() * 2;
    if (FUN) funEvent(res, 'Pinball!', frames.length - 1);
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
    sink(hole, frames, last.x, last.y);
    return finish(hole, ball, res, { x: hole.pin.x, y: hole.pin.y });
  }

  // Release: how far it runs depends on the club, the power and where it lands.
  // The ball runs on along its line of flight, turned a little further the
  // way it was curving. (The tangent at touchdown is no good: the model's
  // forward speed fades to nothing there while the curve is still at work.)
  let hx = last.x - ball.x, hy = last.y - ball.y;
  const hl = Math.hypot(hx, hy) || 1;
  hx /= hl; hy /= hl;
  const bend = Math.sign(fp.curve) * Math.min(0.22, (Math.abs(fp.curve) / Math.max(carry, 1)) * 1.1);
  [hx, hy] = [hx * Math.cos(bend) - hy * Math.sin(bend), hx * Math.sin(bend) + hy * Math.cos(bend)];
  const release = (RELEASE[land] ?? 0.3) * (land === T.FAIRWAY || land === T.ROUGH ? hole.firm || 1 : 1);
  let rollDist = (club.roll * fp.shape.roll + fp.shape.rollAdd) * release * Math.min(1, p) * fp.strike.roll;
  // Short shots come in low and release like a chip: a 9 iron runs out,
  // a lob wedge barely moves. Full swings carry their spin and stop.
  // Chip and Flop are measured against the club's normal full swing.
  const swing = p * (fp.shape.short ? fp.shape.carry : 1);
  // (Only near the green: a long running shot fades out above ~25 yd of carry.)
  const nearGreen = Math.max(0, Math.min(1, 1 - (carry - 25) / 50));
  rollDist += carry * club.chip * fp.shape.chip * Math.pow(Math.max(0, 1 - swing), 2) * (release / RELEASE[T.GREEN]) * nearGreen;
  if (p > 1) rollDist *= 1.15;
  rollDist *= fp.g.roll;
  // Topspin releases the ball; backspin grips, and a wedge can zip it backwards.
  rollDist *= 1 + 1.2 * fp.top;
  if (FUN) {
    // Rocket roll: the softer you hit it with topspin, the further it goes.
    const rocket = fp.top * 260 * Math.pow(Math.max(0, 1 - Math.min(1, p)), 1.3);
    rollDist += rocket;
    if (rocket > 25) funEvent(res, 'Rocket roll!', frames.length + 20);
    // Topped shots skitter on forever.
    if (fp.strike.kind === 'top') {
      rollDist = rollDist * 3 + 70;
      funEvent(res, 'Skimmer!', frames.length + 20);
    }
  }
  const bite = (club.wedge ? 1 : club.carry > 200 ? 0.25 : 0.6) * (SPIN_GRIP[land] ?? 0) * Math.min(1, 0.35 + p) * fp.strike.bite * fp.g.bite * (fp.shape.bite || 1);
  const zip = fp.back * bite * 8 * (FUN ? 8 : 1);
  rollDist -= zip;
  if (FUN && zip > 12) funEvent(res, 'Super zip!', frames.length + 40);
  // Side spin kicks the ball sideways as it lands (hard, in fun mode).
  const kick = fp.spin.x * (FUN ? 1.1 : 0.06);
  if (FUN && Math.abs(fp.spin.x) > 0.3 && rollDist > 0) {
    // ...and shoots off that way like it's been fired from a cannon.
    rollDist += Math.abs(fp.spin.x) * 30;
    funEvent(res, fp.spin.x > 0 ? 'Kicked right!' : 'Kicked left!', frames.length + 10);
  }
  [hx, hy] = [hx * Math.cos(kick) - hy * Math.sin(kick), hx * Math.sin(kick) + hy * Math.cos(kick)];
  // How the ball arrives: steeper for high shots, flatter for drivers and
  // punches; faster for longer shots.
  const descent = Math.min(1.2, Math.max(0.1, Math.atan((5 * apex) / Math.max(carry, 1))));
  const inH = (0.6 * carry) / Math.max(0.6, flight);
  bounceAndRoll(hole, last.x, last.y, hx, hy, rollDist, land, inH * Math.tan(descent), frames, res, mishit);
  return finish(hole, ball, res);
}

// Surface bounce: e = how much vertical speed survives a bounce, mu = how
// much forward speed each bounce takes away. Sand plugs; greens are soft;
// firm links fairways are lively.
const BOUNCE = {
  [T.GREEN]: { e: 0.2, mu: 0.3 },
  [T.FRINGE]: { e: 0.24, mu: 0.26 },
  [T.FAIRWAY]: { e: 0.36, mu: 0.14 },
  [T.TEE]: { e: 0.34, mu: 0.15 },
  [T.ROUGH]: { e: 0.16, mu: 0.4 },
  [T.DEEP]: { e: 0.08, mu: 0.6 },
  [T.SAND]: { e: 0.03, mu: 0.85 },
  [T.OB]: { e: 0.2, mu: 0.3 },
};

function bounceOf(hole, ter) {
  const b = BOUNCE[ter] || BOUNCE[T.ROUGH];
  // Fun: a superball, even out of the sand.
  if (FUN) return { e: Math.min(0.8, b.e * 2 + 0.25), mu: b.mu * 0.5 };
  if (hole.firm > 1 && (ter === T.FAIRWAY || ter === T.FRINGE)) return { e: b.e * 1.25, mu: b.mu * 0.7 };
  return b;
}

// Distance covered by bounces then roll, on flat ground of one surface, for
// a forward speed vh just after the first bounce.
function runDistance(hole, ter, vh, vz) {
  const { e, mu } = bounceOf(hole, ter);
  let d = 0;
  for (let k = 0; k < 8 && vz > 1.1; k++) {
    d += vh * ((2 * vz) / G);
    vh *= 1 - mu;
    vz *= e;
  }
  return d + (vh * vh) / (2 * decelAt(hole, ter));
}

// Bounce, then roll. The forward speed after the first bounce is chosen so
// the total run matches `run` (negative = spin pulls it back), keeping the
// game's tuned distances while the motion is real.
function bounceAndRoll(hole, x, y, hx, hy, run, land, inV, frames, res, mishit) {
  const back = run < 0;
  let { e } = bounceOf(hole, land);
  let vz = inV * e * (mishit ? 0.6 : 1);
  let dirx = hx, diry = hy;
  let vh;
  if (back) {
    // Check, then zip back: a short hop forward, then the spin bites.
    vh = Math.min(2, inV * 0.12);
  } else {
    let lo = 0, hi = 80;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (runDistance(hole, land, mid, vz) < run) lo = mid;
      else hi = mid;
    }
    vh = lo;
  }
  let ter = land;
  for (let k = 0; k < 10 && vz > 1.1; k++) {
    const t = (2 * vz) / G;
    const n = Math.max(2, Math.round(t * FPS));
    for (let i = 1; i <= n; i++) {
      const tt = (i / n) * t;
      frames.push({ x: x + dirx * vh * tt, y: y + diry * vh * tt, z: vz * tt - 0.5 * G * tt * tt });
    }
    x += dirx * vh * t;
    y += diry * vh * t;
    ter = hole.terrainAt(x, y);
    if (ter === T.WATER || ter === T.OB) {
      res.landedOn = ter;
      res.rolledInto = ter;
      return;
    }
    // Dropping straight into the cup on a gentle bounce.
    if (ter === T.GREEN && Math.hypot(x - hole.pin.x, y - hole.pin.y) < CUP_R * 1.3 && vz < 3) {
      sink(hole, frames, x, y, dirx * vh, diry * vh);
      res.outcome = 'holed';
      return;
    }
    res.events.push({ type: 'bounce', f: frames.length - 1, terrain: ter, v: vz });
    const b = bounceOf(hole, ter);
    vz *= b.e;
    vh *= 1 - b.mu;
    if (back && k === 0) {
      // The spin takes hold: reverse, with enough pace to cover the zip back.
      dirx = -dirx;
      diry = -diry;
      const want = -run + vh * ((2 * vz) / G) * 0.5;
      let lo = 0, hi = FUN ? 80 : 30;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (runDistance(hole, ter, mid, vz) < want) lo = mid;
        else hi = mid;
      }
      vh = lo;
      if (-run > 0.8) res.events.push({ type: 'spinback', f: frames.length - 1 });
    }
  }
  roll(hole, x, y, dirx * vh, diry * vh, frames, res, 0);
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
      const decel = decelAt(hole, ter);
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
      // Fun: the old cup magnet. Anything slow and close snaps in.
      if (FUN && cd < 0.45 && Math.hypot(vx, vy) < 2.6 && ter === T.GREEN) {
        sink(hole, frames, x, y, vx, vy);
        res.outcome = 'holed';
        funEvent(res, 'Magnet!', frames.length - 1);
        return;
      }
      if (cd < CUP_R) {
        const s = Math.hypot(vx, vy);
        if (s < 1.35 || (cd < CUP_R * 0.5 && s < 2.1)) {
          sink(hole, frames, x, y, vx, vy);
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
  const st = strikeOf(e, (input.spin || {}).x || 0, input.club, ball.lie);
  const p = input.power;
  const powerDist = p <= 1 ? p : 1 + (p - 1) * 0.8;
  const spin = input.spin || { x: 0, y: 0 };
  const g = gearFor(input.gear, input.club, ball.lie);
  const top = Math.max(0, spin.y) * g.spin, back = Math.max(0, -spin.y) * g.spin;
  let carry = club.carry * shape.carry * powerDist * lie.dist * g.carry * (1 + (r() - 0.5) * 2 * lie.spread);
  carry *= 1 - 0.05 * Math.min(1, Math.hypot(spin.x, spin.y));
  carry *= st.carry;
  const flight = club.time * shape.time * (0.45 + 0.55 * Math.min(1, p)) * st.flight;
  let apex = club.apex * shape.apex * g.apex * (0.4 + 0.6 * Math.min(1, p)) * st.apex;
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
    curve: (timingCurve(-e) * g.curve * st.timing + spin.x * 0.17 * g.shape * st.intended + st.curveAdd) * carry,
    spin, top, back, g, strike: st,
    // Start line a touch off with mistimed swings; way off with a shank.
    push: st.push || Math.max(-0.05, Math.min(0.05, -e * 0.018)),
  };
}

export function flightPoint(ball, fp, s) {
  // Drag slows the ball, but it still comes in moving forward.
  const alongD = fp.carry * (0.3 * s + 0.7 * (1 - Math.pow(1 - s, 1.6)));
  // Curve builds late in the flight, as the ball slows and the spin takes over.
  const lat = fp.push * alongD + fp.curve * Math.pow(s, 2.3) + fp.drift * Math.pow(s, 1.5);
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
export function suggestClub(dist, lie, gear = null) {
  if (lie === T.GREEN) return PUTTER;
  for (let i = CLUBS.length - 2; i >= 0; i--) {
    if (i === 0 && lie !== T.TEE) continue;
    const c = CLUBS[i];
    if (c.carry * lieEffect(lie, i).dist * gearFor(gear, i, lie).carry + c.roll * 0.5 >= dist) return i;
  }
  return lie === T.TEE ? 0 : 1;
}

export function suggestPuttScale(dist) {
  for (const s of PUTT_SCALES) if (dist * 1.25 <= s) return s;
  return PUTT_SCALES[PUTT_SCALES.length - 1];
}

export const terrainName = (t) => TERRAIN_NAMES[t];
