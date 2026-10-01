import { buildHole as buildHoleRaw, windFor, HOLES, COURSES, courseOf, T, TERRAIN_NAMES } from './course.js?v=14';
import {
  simulateShot, CLUBS, PUTTER, PUTT_SCALES, SHAPES, FULL_SHAPES, SHORT_SHAPES, GEAR, GEAR_STATS, DEFAULT_GEAR, gearFor, MISHIT, meterWindow, lieEffect, suggestClub, suggestPuttScale, shotSeed, shotLabel, strikeOf, previewShot, flightParams, flightPoint,
} from './sim.js?v=14';
import { Renderer } from './render.js?v=14';
import { Sound } from './audio.js?v=14';
import { Link, makeCode, cleanCode } from './net.js?v=14';
import { View3D, parseColor } from './view3d.js?v=14';

const $ = (s) => document.querySelector(s);

// Every file is stamped with the same ?v= version (see tools/bump.mjs).
const APP_VERSION = new URL(import.meta.url).searchParams.get('v') || 'dev';

// Building a hole places its trees, which is slow, so each layout is built once.
const holeCache = new Map();
function buildHole(i, seed) {
  const key = i + '|' + seed;
  let h = holeCache.get(key);
  if (!h) {
    if (holeCache.size > 24) holeCache.clear();
    h = buildHoleRaw(i, seed);
    holeCache.set(key, h);
  }
  return h;
}
const TAU = Math.PI * 2;
const COLORS = ['#e8433a', '#2f7de1', '#f2b705', '#a45de0'];
const MAX_ONLINE = 4;
// Bump when online messages change, so mismatched copies of the game say so instead of stalling.
const NET_VERSION = 5;
const METER_MIN = -0.15;
const METER_MAX = 1.1;
const DIFFICULTY = { casual: 1.5, standard: 1, pro: 0.72 };

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('pocketlinks.' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      if (v == null) localStorage.removeItem('pocketlinks.' + k);
      else localStorage.setItem('pocketlinks.' + k, JSON.stringify(v));
    } catch {}
  },
};

const R = new Renderer($('#game'));
const V3 = new View3D($('#game3d'));
const sound = new Sound(store.get('muted', false));
const meterCv = $('#meter');
const mctx = meterCv.getContext('2d');

// ---------- shared game state (plain data, sent between devices) ----------
//
// Each player owns their own ball, stroke count and shot counter. Only that
// player's shots change their entry, so two devices can merge each other's
// shots in any order. That is what makes "play at the same time" work.

let G = null; // the game
let hole = null; // built hole for the current hole index
let wind = null;

function newGame(mode, names, holes, { simul = false, seed = (Math.random() * 2 ** 31) >>> 0, ck = null } = {}) {
  const g = {
    v: 2, mode, simul, seed, holes, ck, h: 0, n: 0, turn: 0, done: false, last: null,
    players: names.map((name) => ({ name, h: 0, shots: 0, strokes: 0, ball: null, holed: false, picked: false, scores: [], stats: [], cur: null })),
  };
  g.players.forEach((p, i) => resetForHole(g, i));
  computeTurn(g);
  return g;
}

function teeSpot(g, hl, i) {
  const t = hl.tee;
  const n = g.players.length;
  const off = (i - (n - 1) / 2) * (n > 2 ? 2.4 : 3.2);
  return { x: t.x + Math.cos(t.ang + Math.PI / 2) * off, y: t.y + Math.sin(t.ang + Math.PI / 2) * off, lie: T.TEE };
}

function resetForHole(g, i) {
  const pl = g.players[i];
  if (pl.h >= g.holes.length) return;
  const hl = buildHole(g.holes[pl.h], g.seed);
  pl.ball = teeSpot(g, hl, i);
  pl.strokes = 0;
  pl.holed = false;
  pl.picked = false;
  pl.cur = { putts: 0, fir: null, gir: false };
}

function toPin(hl, ball) {
  return Math.hypot(hl.pin.x - ball.x, hl.pin.y - ball.y);
}

// Move everyone on to the next hole once all players have finished this one.
function settle(g) {
  for (;;) {
    const h = Math.min(...g.players.map((p) => p.h));
    if (h >= g.holes.length) break;
    const behind = g.players.filter((p) => p.h === h);
    if (!behind.every((p) => p.holed)) break;
    g.last = { h, hole: g.holes[h], results: g.players.map((p) => p.scores[h] ?? p.strokes), picked: g.players.map((p) => (p.h === h ? p.picked : false)) };
    g.players.forEach((p, i) => {
      if (p.h !== h) return;
      p.scores[h] = p.strokes;
      p.stats[h] = p.cur;
      p.h++;
      resetForHole(g, i);
    });
  }
  g.h = Math.min(...g.players.map((p) => p.h));
  g.done = g.h >= g.holes.length;
}

// Turn order when taking turns: furthest from the hole plays; on the tee the
// best score on the previous hole goes first.
function computeTurn(g) {
  if (g.done) return;
  const hl = buildHole(g.holes[g.h], g.seed);
  const prev = g.h - 1;
  const honour = g.players.map((_, i) => i).sort((a, b) => (prev >= 0 ? (g.players[a].scores[prev] ?? 0) - (g.players[b].scores[prev] ?? 0) : 0) || a - b);
  const left = honour.filter((i) => !g.players[i].holed);
  if (!left.length) return;
  // Everyone tees off in honour order, then whoever is furthest away plays.
  const onTee = left.filter((i) => g.players[i].strokes === 0);
  if (onTee.length) {
    g.turn = onTee[0];
    return;
  }
  left.sort((a, b) => toPin(hl, g.players[b].ball) - toPin(hl, g.players[a].ball) || honour.indexOf(a) - honour.indexOf(b));
  g.turn = left[0];
}

// Apply a finished shot to a copy of the game and return it.
function applyShot(g0, p, input, res) {
  const g = JSON.parse(JSON.stringify(g0));
  const pl = g.players[p];
  const hl = buildHole(g.holes[pl.h], g.seed);
  const startLie = pl.ball.lie;
  pl.strokes += 1 + res.penalty;
  pl.shots++;
  pl.ball = res.final;
  const cur = pl.cur || (pl.cur = { putts: 0, fir: null, gir: false });
  if (CLUBS[input.club].putter && (startLie === T.GREEN || startLie === T.FRINGE)) cur.putts++;
  if (pl.strokes === 1 + res.penalty && hl.par > 3 && cur.fir === null) cur.fir = res.final.lie === T.FAIRWAY && !res.penalty;
  if ((res.final.lie === T.GREEN || res.outcome === 'holed') && pl.strokes <= hl.par - 2) cur.gir = true;
  if (res.outcome === 'holed') pl.holed = true;
  else if (pl.strokes >= hl.par + 5) {
    pl.holed = true;
    pl.picked = true;
    pl.strokes = hl.par + 5;
  }
  g.n++;
  settle(g);
  computeTurn(g);
  return g;
}

// ---------- device/UI state ----------

const U = {
  screen: 'title',
  phase: 'idle', // intro | aim | wait | flight | pass
  local: [0], // player indices this device controls
  online: null, // { link, role, code, peers, roster }
  club: 0,
  shape: 0,
  spin: { x: 0, y: 0 },
  sidePinned: false,
  aim: 0,
  aimFor: '',
  puttScale: 10,
  target: 0, // yards: where a full shot should land, or how far a putt should roll
  preview: null,
  previewKey: '',
  previewT: 0,
  swing: { phase: 'idle' },
  anims: [],
  queue: [],
  cam: { x: 0, y: 0, rot: 0, scale: 2 },
  cam3: null, // 3D camera { eye, target }
  introDur: 1.9,
  zoom: 1,
  mapView: false,
  dragging: null,
  pinch: null,
  introT: 0,
  popups: [],
  time: 0,
  lastPlayer: -1,
  pendingCard: false,
};

// ---------- helpers ----------

function relPar(pl, g) {
  let d = 0;
  pl.scores.forEach((s, i) => (d += s - HOLES[g.holes[i]].par));
  return d;
}
const fmtRel = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `−${-n}`);

function scoreName(strokes, par) {
  if (strokes === 1) return 'Hole in One!';
  const d = strokes - par;
  return { '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double Bogey', 3: 'Triple Bogey' }[d] ?? (d < 0 ? 'Condor!' : `+${d}`);
}

// A stable id for this device, so a player keeps their seat when they rejoin.
function deviceId() {
  let id = store.get('device', null);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
    store.set('device', id);
  }
  return id;
}

function isLocal(p) {
  return U.local.includes(p);
}

// The player this device is looking after right now.
function me() {
  if (!G) return 0;
  if (G.simul) return U.local[0];
  return G.turn;
}

function currentBall() {
  return G.players[me()].ball;
}

function animFor(p) {
  return U.anims.find((a) => a.p === p);
}

function canAct(p) {
  if (!G || G.done || U.screen !== 'play' || U.phase === 'intro' || U.pendingCard) return false;
  const pl = G.players[p];
  if (!isLocal(p) || pl.holed || pl.h !== G.h || animFor(p)) return false;
  if (!G.simul && (G.turn !== p || U.anims.length)) return false;
  return true;
}

// ---------- courses ----------

const PARTS = { all: 'All 18', front: 'Front 9', back: 'Back 9' };

function coursePick() {
  const c = store.get('course', null) || {};
  const course = COURSES.find((k) => k.id === c.id) || COURSES[0];
  const part = course.nines && PARTS[c.part] ? c.part : 'all';
  return { course, part };
}

function courseHoles(pick = coursePick()) {
  const h = pick.course.holes;
  if (pick.part === 'front') return h.slice(0, 9);
  if (pick.part === 'back') return h.slice(9);
  return h.slice();
}

const courseKey = (pick = coursePick()) => `${pick.course.id}.${pick.part}`;

// The hole's number on its own course's card (Augusta's 12th is 12, even on the back nine).
function holeNo(idx) {
  return courseOf(idx).holes.indexOf(idx) + 1;
}

function courseLabel(pick = coursePick()) {
  const holes = courseHoles(pick);
  const par = holes.reduce((a, i) => a + HOLES[i].par, 0);
  const part = pick.course.nines ? (pick.part === 'all' ? '18 holes' : PARTS[pick.part]) : `${holes.length} holes`;
  return { name: pick.course.name, meta: `${part} · Par ${par}`, par };
}

function bestFor(key) {
  const all = store.get('bests', null) || {};
  // Scores from before there was more than one course count for Pocket Links.
  if (all[key] == null && key === 'links.all') return store.get('bestRound', null);
  return all[key] ?? null;
}

function setBest(key, score) {
  const all = store.get('bests', null) || {};
  all[key] = score;
  store.set('bests', all);
}

function difficulty() {
  return DIFFICULTY[store.get('difficulty', 'standard')] || 1;
}

function spinMag() {
  return CLUBS[U.club].putter ? 0 : Math.hypot(U.spin.x, U.spin.y);
}

function spinName(sp) {
  const v = sp.y > 0.2 ? 'Topspin' : sp.y < -0.2 ? 'Backspin' : '';
  const h = sp.x > 0.7 ? 'slice' : sp.x > 0.2 ? 'fade' : sp.x < -0.7 ? 'hook' : sp.x < -0.2 ? 'draw' : '';
  if (v && h) return `${v} + ${h}`;
  if (v) return v;
  if (h) return h[0].toUpperCase() + h.slice(1);
  return 'Straight';
}

function myGear() {
  return { ...DEFAULT_GEAR, ...(store.get('gear', null) || {}) };
}

function clubCarry(ci, lie, shape = U.shape) {
  const c = CLUBS[ci];
  return c.putter ? U.puttScale : c.carry * lieEffect(lie, ci).dist * SHAPES[shape].carry * gearFor(myGear(), ci, lie).carry;
}

// ---------- short game: targets and previews ----------

function isShortGame(ball = currentBall()) {
  return !CLUBS[U.club].putter && ball.lie !== T.TEE && toPin(hole, ball) <= 70;
}

function shapeList() {
  if (CLUBS[U.club].putter) return [0];
  return isShortGame() ? SHORT_SHAPES : FULL_SHAPES;
}

function targetPower() {
  if (CLUBS[U.club].putter) return Math.min(1, U.target / U.puttScale);
  return Math.min(1, U.target / clubCarry(U.club, currentBall().lie));
}

// Short shots get a magnified meter, so the gold target sits about 70% along
// and the marker moves slowly enough to stop on it.
function meterScale() {
  if (CLUBS[U.club].putter) return 1;
  const tp = targetPower();
  return tp < 0.6 ? Math.max(0.1, tp / 0.7) : 1;
}

// Shaped shots start offline and bend back: aim the start line so that, with
// no wind and a pure strike, the curve brings the ball onto the target line.
function startLine(power) {
  if (CLUBS[U.club].putter || Math.abs(U.spin.x) < 0.01) return U.aim;
  const fp = flightParams(currentBall(), { club: U.club, aim: U.aim, power, acc: 0, shape: U.shape, spin: U.spin, gear: myGear() }, CALM);
  return U.aim - Math.atan2(fp.curve, fp.carry);
}

function shotInput(power, acc) {
  const putter = CLUBS[U.club].putter;
  return {
    club: U.club, aim: startLine(power), power, acc, puttScale: U.puttScale,
    shape: putter ? 0 : U.shape, spin: putter ? { x: 0, y: 0 } : { ...U.spin }, gear: myGear(),
  };
}

const CALM = { speed: 0, dir: 0 };

// The carry (or putt pace) that leaves the ball closest to the pin, with no
// wind and a pure strike. Used to set a sensible target for every new shot.
function defaultTarget() {
  const ball = currentBall();
  const dist = toPin(hole, ball);
  if (CLUBS[U.club].putter) return puttPlaysLike(ball);
  const full = clubCarry(U.club, ball.lie);
  if (dist > full + 45) return full;
  // Full shots search proper swings only; short shots any length.
  let lo = isShortGame(ball) ? 1.5 : full * 0.45, hi = full, best = full, bestD = Infinity;
  for (let i = 0; i < 11; i++) {
    const t = (lo + hi) / 2;
    const res = simulateShot(hole, ball, shotInput(t / full, 0), CALM, 1);
    const f = res.frames[res.frames.length - 1];
    if (res.outcome === 'holed') return t;
    const d = Math.hypot(f.x - hole.pin.x, f.y - hole.pin.y);
    if (d < bestD && !res.penalty) {
      bestD = d;
      best = t;
    }
    const along = (f.x - ball.x) * Math.cos(U.aim) + (f.y - ball.y) * Math.sin(U.aim);
    if (along > dist) hi = t;
    else lo = t;
  }
  // Blocked by trees or hazards everywhere: just aim to land at the flag.
  if (bestD > dist * 0.5) return Math.min(full, dist);
  return best;
}

// The pace for a putt to finish a foot past, allowing for the slope: uphill
// putts play longer, downhill ones shorter.
function puttPlaysLike(ball) {
  const dist = toPin(hole, ball);
  const rise = readPutt(ball).inches / 36;
  const decel = hole.greenDecel || 0.62;
  return Math.max(0.3, dist + 0.35 + (10.72 * rise) / decel);
}

// How much of a putt's path the preview shows, by difficulty.
function puttPreviewShare() {
  const d = store.get('difficulty', 'standard');
  return d === 'casual' ? 0.75 : d === 'pro' ? 0.25 : 0.45;
}

function updatePreview() {
  if (!G || !hole || U.screen !== 'play' || U.phase !== 'aim' || U.swing.phase !== 'idle') return;
  const ball = currentBall();
  const inp = shotInput(targetPower(), 0);
  const key = [ball.x, ball.y, inp.club, Math.round(inp.aim * 3000), Math.round(U.target * 20), inp.shape, inp.spin.x, inp.spin.y, inp.puttScale].join('|');
  if (key === U.previewKey) return;
  const now = performance.now();
  if (U.dragging && now - U.previewT < 50) return;
  U.previewKey = key;
  U.previewT = now;
  const res = simulateShot(hole, ball, inp, CALM, 1);
  const land = res.events.find((e) => e.type === 'land' || e.type === 'tree');
  U.preview = {
    frames: res.frames,
    landF: CLUBS[U.club].putter ? 0 : land ? land.f : res.frames.length - 1,
    end: res.frames[res.frames.length - 1],
    outcome: res.outcome,
    tree: res.events.some((e) => e.type === 'tree'),
    treeHit: (() => {
      const t = res.events.find((e) => e.type === 'tree');
      return t ? { x: t.x, y: t.y, z: res.frames[t.f] ? res.frames[t.f].z : 0, d: Math.hypot(t.x - ball.x, t.y - ball.y) } : null;
    })(),
  };
}

// Height difference to the hole (inches, + = uphill) and which way the putt
// breaks, from the green's slope along the straight line.
function readPutt(ball) {
  const dx = hole.pin.x - ball.x, dy = hole.pin.y - ball.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  let rise = 0, side = 0;
  const n = Math.max(4, Math.ceil(d / 0.25));
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n;
    const [gx, gy] = hole.slopeAt(ball.x + dx * k, ball.y + dy * k);
    rise += (gx * ux + gy * uy) * (d / n);
    side += -gx * uy + gy * ux; // + means higher on the right, so it breaks left
  }
  return { inches: rise * 36, breaks: Math.abs(side / n) < 0.004 ? 'straight' : side > 0 ? 'left' : 'right' };
}

function save() {
  if (!G) return;
  if (G.mode === 'solo') store.set('solo', G.done ? null : G);
  if (G.mode === 'online' && U.online) store.set('online', G.done ? null : { code: U.online.code, role: U.online.role, game: G });
}

// ---------- layout / camera ----------

function viewport() {
  const w = window.innerWidth, h = window.innerHeight;
  const top = $('#hud').hidden ? 0 : $('#hud').getBoundingClientRect().bottom;
  const bot = $('#panel').hidden ? h : $('#panel').getBoundingClientRect().top;
  return { w, h, top, bot, sx: w / 2, sy: top + (bot - top) / 2, vw: w, vh: Math.max(120, bot - top) };
}

function resize() {
  R.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 2));
  V3.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 2));
  const r = meterCv.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  meterCv.width = Math.round(r.width * dpr);
  meterCv.height = Math.round(r.height * dpr);
}

function mapTarget() {
  const P = hole.path;
  const a = Math.atan2(P[P.length - 1].y - P[0].y, P[P.length - 1].x - P[0].x);
  const rot = -Math.PI / 2 - a;
  const c = Math.cos(rot), s = Math.sin(rot);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of P) {
    const u = p.x * c - p.y * s, v = p.x * s + p.y * c;
    x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
  }
  const vp = viewport();
  const scale = Math.min(vp.vw / (x1 - x0 + 90), vp.vh / (y1 - y0 + 50)) * U.zoom;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return { x: mx * c + my * s, y: -mx * s + my * c, rot, scale };
}

function aimTarget(ball, dir, span, lateral) {
  const vp = viewport();
  const rot = -Math.PI / 2 - dir;
  const scale = Math.max(0.8, Math.min(90, Math.min(vp.vh / (span * 1.28 + 6), vp.vw / Math.max(lateral, 12)) * U.zoom));
  const fwd = span * 0.44;
  return { x: ball.x + Math.cos(dir) * fwd, y: ball.y + Math.sin(dir) * fwd, rot, scale };
}

// How much course the aiming view should show: the whole shot, roll-out included.
function aimSpan(ball, dist) {
  const putter = CLUBS[U.club].putter;
  const pv = U.preview;
  let len = putter ? Math.max(dist, U.target) * 1.15 : U.target * 1.08;
  if (pv && !putter) len = Math.max(len, Math.hypot(pv.end.x - ball.x, pv.end.y - ball.y) * 1.08);
  if (!putter && !isShortGame(ball)) len = Math.max(len, clubCarry(U.club, ball.lie) * 0.7);
  return Math.max(len, putter ? 5 : 16);
}

function cameraTarget() {
  if (U.mapView || U.phase === 'intro') return mapTarget();
  const p = me();
  // Follow a shot in the air: ours first, otherwise the one being watched.
  const a = animFor(p) || (!G.simul ? U.anims[0] : null) || (G.players[p].holed ? U.anims[0] : null);
  if (a) {
    const f = a.res.frames[Math.min(a.i, a.res.frames.length - 1)];
    const base = a.view;
    return { x: base.x + (f.x - base.bx) * 0.9, y: base.y + (f.y - base.by) * 0.9, rot: base.rot, scale: base.scale };
  }
  const watch = G.players[p].holed && G.simul ? G.players.findIndex((q) => !q.holed) : p;
  const ball = G.players[watch >= 0 ? watch : p].ball;
  const dist = toPin(hole, ball);
  if ((U.phase === 'aim' || U.phase === 'pass') && watch === p) {
    const dir = U.dragging ? U.dragging.camDir : U.aim;
    const span = U.dragging ? U.dragging.span : aimSpan(ball, dist);
    return aimTarget(ball, dir, span, span * 0.62 + 14);
  }
  // Watching someone else: look from their ball toward the pin.
  const dir = Math.atan2(hole.pin.y - ball.y, hole.pin.x - ball.x);
  const span = Math.min(dist, ball.lie === T.GREEN ? Math.max(dist, 5) : 260);
  return aimTarget(ball, dir, Math.max(span, 6), Math.max(span, 6) * 0.62 + 14);
}

function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function updateCamera(dt, snap = false) {
  const t = cameraTarget();
  const k = snap ? 1 : 1 - Math.exp(-dt * (U.anims.length ? 5 : 3.2));
  const c = U.cam;
  c.x += (t.x - c.x) * k;
  c.y += (t.y - c.y) * k;
  c.rot += angDiff(c.rot, t.rot) * k;
  c.scale *= Math.exp(Math.log(t.scale / c.scale) * k);
}

function view() {
  const vp = viewport();
  return { ...U.cam, sx: vp.sx, sy: vp.sy };
}

// ---------- turn flow ----------

function loadHoleView() {
  hole = buildHole(G.holes[G.h], G.seed);
  wind = windFor(G.holes[G.h], G.seed);
  R.setHole(hole);
  V3.setHole(hole, R, R.palette);
  sound.setScene(hole.course);
  updateHud();
}

function beginHole() {
  loadHoleView();
  U.phase = 'intro';
  // The 3D view opens with a flyover of the hole; tap to skip it.
  U.introDur = use3D() ? 3.6 : 1.9;
  U.introT = U.introDur;
  U.cam3 = null;
  U.mapView = false;
  U.zoom = 1;
  U.aimFor = '';
  U.pendingCard = false;
  const b = $('#banner');
  b.innerHTML = `<small>${escapeHtml(courseOf(G.holes[G.h]).name)} · Hole ${holeNo(G.holes[G.h])}</small><strong></strong><span>Par ${hole.par} · ${hole.yards} yards · Wind ${wind.speed} mph</span>`;
  b.querySelector('strong').textContent = hole.name;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
  updateCamera(0, true);
  updatePanel();
}

// Work out what this device should be doing now.
function refreshPhase() {
  if (!G || U.screen !== 'play' || U.phase === 'intro' || U.phase === 'pass') return;
  const p = me();
  const pl = G.players[p];
  if (canAct(p)) {
    const key = `${p}:${pl.shots}`;
    if (U.aimFor !== key) {
      U.aimFor = key;
      const ball = pl.ball;
      const dist = toPin(hole, ball);
      U.club = suggestClub(dist, ball.lie, myGear());
      U.shape = 0;
      U.spin = { x: 0, y: 0 };
      U.zoom = 1;
      U.swing = { phase: 'idle' };
      U.puttScale = suggestPuttScale(dist);
      U.aim = defaultAim(ball, U.club);
      U.target = defaultTarget();
      if (CLUBS[U.club].putter) U.puttScale = suggestPuttScale(U.target);
      U.previewKey = '';
      const needPass = G.mode === 'hotseat' && U.lastPlayer !== -1 && U.lastPlayer !== p;
      U.lastPlayer = p;
      if (needPass) {
        U.phase = 'pass';
        $('#passName').textContent = pl.name;
        $('#passName').style.color = COLORS[p];
        $('#pass').hidden = false;
        updatePanel();
        updateHud();
        return;
      }
    }
    U.phase = 'aim';
  } else {
    U.phase = animFor(p) || (!G.simul && U.anims.length) ? 'flight' : 'wait';
  }
  updatePanel();
  updateHud();
}

function defaultAim(ball, ci) {
  const dist = toPin(hole, ball);
  const reach = CLUBS[ci].putter ? Infinity : clubCarry(ci, ball.lie) + CLUBS[ci].roll;
  if (dist <= reach + 15) return Math.atan2(hole.pin.y - ball.y, hole.pin.x - ball.x);
  // Out of range: aim down the centre line at the club's distance.
  const [, sBall] = hole.nearest(ball.x, ball.y);
  let pt = hole.path[hole.path.length - 1];
  for (const q of hole.path) if (q.s > sBall && Math.hypot(q.x - ball.x, q.y - ball.y) >= reach * 0.95) { pt = q; break; }
  return Math.atan2(pt.y - ball.y, pt.x - ball.x);
}

function takeShot(power, acc) {
  const p = me();
  const pl = G.players[p];
  const input = shotInput(power, acc);
  if (!CLUBS[U.club].putter) sound.whoosh(power);
  const res = simulateShot(hole, pl.ball, input, wind, shotSeed(G.seed, pl.h, p, pl.shots));
  // The shooter's device is the authority on where the ball ends up: other
  // devices replay the shot for the animation, but floating-point maths can
  // differ between iPads, so they take this result as final.
  if (U.online) U.online.link.send({ t: 'shot', p, k: pl.shots, h: pl.h, input, name: pl.name, out: { final: res.final, outcome: res.outcome, penalty: res.penalty } });
  U.swing = { phase: 'idle' };
  startAnim(p, input, res);
}

function startAnim(p, input, res) {
  const ball = G.players[p].ball;
  const club = CLUBS[input.club];
  const mine = isLocal(p);
  const a = { p, input, res, k: G.players[p].shots, t: 0, i: 0, hold: 0, trail: [], view: { ...U.cam, bx: ball.x, by: ball.y } };
  if (!mine || U.phase !== 'aim') a.view = { ...cameraTarget(), bx: ball.x, by: ball.y };
  U.anims.push(a);
  const who = G.players.length > 1 && (G.simul || !mine) ? `${G.players[p].name}: ` : '';
  if (club.putter) sound.putt();
  else {
    const e = input.acc;
    const ae = Math.abs(e);
    sound.strike(club.carry > 200 ? 'wood' : 'iron', ae <= 0.22 ? 'perfect' : ae > 1.1 ? 'bad' : 'ok');
    const st = strikeOf(e, (input.spin || {}).x || 0, input.club, ball.lie);
    const good = st.kind === 'perfect' || st.kind === 'pure';
    const awful = ae > MISHIT || st.kind === 'double';
    popup(who + st.label, good ? '#ffe27a' : awful ? '#ff9a8a' : ae > 0.55 ? '#ffc9a8' : '#ffffff', good && st.kind === 'pure' ? 1.6 : 1.3, who ? 24 : 30);
    if (st.kind === 'pure' && mine) sound.applause(0.35);
    else if (ae > MISHIT && mine) sound.groan();
    if (ae <= 0.22 && mine) R.ring(ball.x, ball.y, 0.3, 4, 'rgba(255,226,122,0.95)', 0.5);
    if (ball.lie === T.SAND) R.burst(ball.x, ball.y, 26, { colors: ['#f3e3b5', '#d9c38c'], speed: 6, up: 6, life: 0.9, size: 0.25 });
    else if (ball.lie !== T.TEE) R.burst(ball.x, ball.y, 12, { colors: ['#5c8a3a', '#7a5a33'], speed: 5, up: 5, life: 0.7, size: 0.2, angle: input.aim, spread: 0.8 });
  }
  refreshPhase();
}

function stepAnims(dt) {
  for (const a of [...U.anims]) stepAnim(a, dt);
}

function stepAnim(a, dt) {
  const frames = a.res.frames;
  if (a.i < frames.length - 1) {
    // Slow motion for the last moments of a ball that's going in (and all of a replay).
    const slow = a.res.outcome === 'holed' && frames.length - 1 - a.i < 50 && frames.length > 70;
    a.t += (slow ? dt * 0.38 : dt) * (a.replay ? 0.6 : 1);
    a.i = Math.min(frames.length - 1, Math.floor(a.t * 60));
    const f = frames[a.i];
    a.trail.push({ x: f.x, y: f.y, z: f.z });
    if (a.trail.length > 36) a.trail.shift();
    for (const ev of a.res.events) {
      if (ev.f > a.i || ev.done) continue;
      ev.done = true;
      fireEvent(ev, a);
    }
    return;
  }
  if (a.trail.length) a.trail.shift();
  if (a.hold === 0) {
    if (a.replay) sound.cup();
    else finishShotFx(a);
  }
  a.hold += dt;
  if (a.hold > (a.res.outcome === 'holed' ? 1.8 : 1.1)) {
    U.anims = U.anims.filter((x) => x !== a);
    if (a.replay) {
      if (U.pendingCard && !U.anims.length) {
        U.pendingCard = false;
        showCard();
      } else refreshPhase();
      return;
    }
    // A shot worth seeing again gets a broadcast replay from behind the cup.
    if (worthReplay(a)) {
      U.anims.push({ ...a, replay: true, t: 0, i: 0, hold: 0, trail: [], cut: false, res: { ...a.res, events: a.res.events.map((e) => ({ ...e, done: false })) } });
      popup('Replay', '#ffffff', 1.6, 22, true);
    }
    const prevH = G.h;
    if (G.players[a.p].shots === a.k) G = applyShot(G, a.p, a.input, a.res);
    save();
    updateHud();
    if (G.h !== prevH || G.done) U.pendingCard = true;
    if (U.pendingCard && !U.anims.length) {
      U.pendingCard = false;
      showCard();
    } else refreshPhase();
  }
}

function worthReplay(a) {
  if (a.replay || a.res.outcome !== 'holed' || !use3D() || !isLocal(a.p)) return false;
  const s0 = a.res.frames[0];
  const from = Math.hypot(s0.x - hole.pin.x, s0.y - hole.pin.y);
  return CLUBS[a.input.club].putter ? from >= 8 : from > 4;
}

function fireEvent(ev, a) {
  const mine = isLocal(a.p);
  switch (ev.type) {
    case 'tree':
      sound.tree();
      R.burst(ev.x, ev.y, 18, { colors: ['#2f6e2c', '#4a9a3e', '#1f4d20'], speed: 4, up: 2, life: 1.1, size: 0.35 });
      if (mine) popup('Timber!', '#c9f0b0', 1.1, 26);
      break;
    case 'land': {
      const t = ev.terrain;
      if (t === T.SAND) {
        sound.land('sand');
        R.burst(ev.x, ev.y, 22, { colors: ['#f3e3b5', '#d9c38c'], speed: 4, up: 4, life: 0.9, size: 0.3 });
      } else if (t === T.GREEN || t === T.FRINGE) sound.land('green');
      else if (t === T.ROUGH || t === T.DEEP) sound.land('rough');
      else if (t !== T.WATER) sound.land('fairway');
      if (mine && !CLUBS[a.input.club].putter && t !== T.WATER) popup(`${Math.round(a.res.carry)} yd carry`, '#ffffff', 1.4, 20, true);
      break;
    }
    case 'splash':
      sound.splash();
      R.ring(ev.x, ev.y, 0.4, 5, 'rgba(255,255,255,0.9)', 0.9);
      R.ring(ev.x, ev.y, 0.2, 3, 'rgba(200,240,255,0.9)', 0.7);
      R.burst(ev.x, ev.y, 20, { colors: ['#d6f1ff', '#ffffff', '#7cc6f2'], speed: 3, up: 7, life: 0.8, size: 0.25 });
      break;
    case 'lip':
      sound.lip();
      break;
    case 'bounce':
      if (ev.v > 2) sound.land(ev.terrain === T.GREEN || ev.terrain === T.FRINGE ? 'green' : ev.terrain === T.SAND ? 'sand' : ev.terrain === T.ROUGH || ev.terrain === T.DEEP ? 'rough' : 'fairway');
      break;
    case 'spinback':
      if (mine || !G.simul) popup('Spin back!', '#9fe3ff', 1.4, 28);
      break;
  }
}

function finishShotFx(a) {
  const res = a.res;
  const pl = G.players[a.p];
  const mine = isLocal(a.p) || !G.simul;
  const who = G.players.length > 1 && (G.simul || !isLocal(a.p)) ? `${pl.name}: ` : '';
  if (res.outcome === 'holed') {
    sound.cup();
    const strokes = pl.strokes + 1 + res.penalty;
    const d = strokes - hole.par;
    const start = res.frames[0];
    const from = Math.hypot(start.x - hole.pin.x, start.y - hole.pin.y);
    const putt = CLUBS[a.input.club].putter;
    // Name the shot when it deserves it.
    const flair = strokes === 1 ? '' : !putt ? (from < 60 ? 'Chip-in!' : 'Holed out!') : from >= 10 ? 'Monster putt!' : from >= 5 ? 'Great putt!' : '';
    if (flair) popup(who + flair, '#9fe3ff', 1.8, 30);
    popup(who + scoreName(strokes, hole.par), d < 0 || strokes === 1 ? '#ffe27a' : '#ffffff', 2, strokes === 1 || d <= -1 ? 44 : 34);
    const big = strokes === 1 || d <= -2 ? 3 : d === -1 || flair ? 2 : d === 0 ? 1 : 0;
    if (mine || d < 0 || flair) {
      if (big >= 2) sound.roar(big - 1);
      else sound.applause(big);
    }
    R.ring(hole.pin.x, hole.pin.y, 0.1, 2.5, 'rgba(255,255,255,0.9)', 0.8);
    R.ring(hole.pin.x, hole.pin.y, 0.05, 1.4, 'rgba(255,226,122,0.95)', 0.6);
    R.burst(hole.pin.x, hole.pin.y, 26, { colors: ['#ffe27a', '#fff6c8', '#ffffff'], speed: 2.5, up: 5, life: 1.1, size: 0.12 });
    if (d < 0 || strokes === 1) R.burst(hole.pin.x, hole.pin.y, strokes === 1 ? 90 : 46, { colors: ['#ffd23f', '#ff5fa2', '#7fd3ff', '#ffffff', '#8be08b'], speed: 7, up: 9, life: 1.6, size: 0.3 });
  } else if (res.outcome === 'water') {
    popup(who + 'In the water', '#a8e4ff', 1.8, 30);
    if (mine) popup('Penalty stroke – drop behind the hazard', '#ffffff', 1.8, 18, true);
    if (mine) sound.groan();
  } else if (res.outcome === 'ob') {
    popup(who + 'Out of bounds', '#ffb3a6', 1.8, 30);
    if (mine) popup('Penalty stroke – replay from the same spot', '#ffffff', 1.8, 18, true);
    if (mine) sound.groan();
  } else if (!mine) {
    // quiet for the other player's ordinary shots
  } else if (res.final.lie === T.SAND) {
    popup('In the bunker', '#f3e3b5', 1.2, 24);
  } else if (CLUBS[a.input.club].putter) {
    const ft = Math.round(toPin(hole, res.final) * 3);
    if (ft <= 3) popup('Tap-in range', '#ffffff', 1.1, 22);
    else {
      // Pace feedback: how far short or past the hole it finished.
      const s0 = res.frames[0];
      const ux = hole.pin.x - s0.x, uy = hole.pin.y - s0.y, ul = Math.hypot(ux, uy) || 1;
      const past = ((res.final.x - hole.pin.x) * ux + (res.final.y - hole.pin.y) * uy) / ul;
      const pft = Math.round(Math.abs(past) * 3);
      popup(pft < 1 ? `${ft} ft left` : `${pft} ft ${past > 0 ? 'past' : 'short'} · ${ft} ft left`, '#ffffff', 1.6, 20, true);
    }
  } else if (res.final.lie === T.GREEN && toPin(hole, res.final) <= 3.4) {
    // An approach or chip that finishes close gets the gallery going.
    const ft = Math.max(1, Math.round(toPin(hole, res.final) * 3));
    popup(ft <= 4 ? 'Stiff!' : 'Close!', '#ffe27a', 1.5, 30);
    popup(`${ft} ft to go`, '#ffffff', 1.6, 20, true);
    if (hole.course === 'augusta') sound.roar(ft <= 4 ? 1 : 0.5);
    else sound.applause(ft <= 4 ? 2 : 1);
  } else {
    // Where it finished: total distance and what's left.
    const start = res.frames[0];
    const went = Math.hypot(res.final.x - start.x, res.final.y - start.y);
    const left = toPin(hole, res.final);
    const leftTxt = res.final.lie === T.GREEN || left < 20 ? `${Math.max(1, Math.round(left * 3))} ft` : `${Math.round(left)} yd`;
    popup(`${Math.round(went)} yd · ${leftTxt} to go`, '#ffffff', 1.6, 20, true);
  }
}

function showCard() {
  const last = G.last;
  if (!last) return;
  const par = HOLES[last.hole].par;
  const lines = G.players.map((p, i) => {
    const s = last.results[i];
    return `<div class="card-row"><span class="dot" style="background:${COLORS[i]}"></span><span class="nm"></span><b>${last.picked[i] ? 'Picked up' : scoreName(s, par)}</b><span class="num">${s}</span><span class="rel">${fmtRel(relPar(p, G))}</span></div>`;
  });
  $('#cardHole').textContent = `Hole ${holeNo(last.hole)} · ${HOLES[last.hole].name} · Par ${par}`;
  $('#cardRows').innerHTML = lines.join('');
  [...$('#cardRows').querySelectorAll('.nm')].forEach((el, i) => (el.textContent = G.players[i].name));
  const best = Math.min(...last.results);
  const single = G.players.length === 1;
  $('#cardTitle').textContent = single ? scoreName(last.results[0], par) : last.results.filter((s) => s === best).length > 1 ? 'Hole halved' : `${G.players[last.results.indexOf(best)].name} wins the hole`;
  $('#cardNext').textContent = G.done ? 'See final scorecard' : G.mode === 'practice' ? 'Play it again' : 'Next hole';
  $('#cardMenu').hidden = G.mode !== 'practice';
  setScreen('card');
}

function nextFromCard() {
  sound.click();
  if (G.mode === 'practice') {
    G = newGame('practice', [G.players[0].name], G.holes, { ck: G.ck });
    startPlay();
    return;
  }
  if (G.done) return showFinal();
  setScreen('play');
  beginHole();
}

function statsHTML(g) {
  const rows = g.players.map((p, i) => {
    let fir = 0, firN = 0, gir = 0, putts = 0;
    p.stats.forEach((s, k) => {
      if (!s) return;
      if (HOLES[g.holes[k]].par > 3) {
        firN++;
        if (s.fir) fir++;
      }
      if (s.gir) gir++;
      putts += s.putts;
    });
    const n = p.stats.filter(Boolean).length;
    return `<tr><th><span class="dot" style="background:${COLORS[i]}"></span>${escapeHtml(p.name)}</th><td>${fir}/${firN}</td><td>${gir}/${n}</td><td>${putts}</td><td>${n ? (putts / n).toFixed(1) : '–'}</td></tr>`;
  });
  return `<div class="sc-wrap"><table class="scorecard stats"><thead><tr><th>Stats</th><th>Fairways</th><th>Greens in reg.</th><th>Putts</th><th>Per hole</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function showFinal() {
  const totals = G.players.map((p) => p.scores.reduce((a, b) => a + b, 0));
  let title;
  if (G.players.length === 1) {
    const key = G.ck || 'links.all';
    const best = bestFor(key);
    const isBest = G.mode === 'solo' && (best == null || totals[0] < best);
    if (isBest) setBest(key, totals[0]);
    title = isBest ? 'New personal best!' : `Round complete${best != null ? ` · best ${best}` : ''}`;
  } else {
    const m = Math.min(...totals);
    const winners = totals.map((t, i) => (t === m ? i : -1)).filter((i) => i >= 0);
    title = winners.length > 1 ? 'All square!' : `${G.players[winners[0]].name} wins`;
  }
  $('#finalTitle').textContent = title;
  $('#finalCard').innerHTML = scorecardHTML(G) + statsHTML(G);
  setScreen('final');
  sound.applause(2);
  if (G.mode === 'solo') store.set('solo', null);
  if (G.mode === 'online') store.set('online', null);
}

function scorecardHTML(g) {
  const cell = (s, par) => {
    if (s == null) return '<td class="empty">–</td>';
    const d = s - par;
    const cls = s === 1 ? 'ace' : d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : 'dbl';
    return `<td><span class="sc ${cls}">${s}</span></td>`;
  };
  // Eighteen holes go on two cards, front and back, like a real scorecard.
  const parts = g.holes.length > 9 ? [[0, 9, 'Out'], [9, g.holes.length, 'In']] : [[0, g.holes.length, null]];
  return parts
    .map(([from, to, label], pi) => {
      const holes = g.holes.slice(from, to);
      const last = pi === parts.length - 1;
      const parSum = holes.reduce((a, h) => a + HOLES[h].par, 0);
      const parTot = g.holes.reduce((a, h) => a + HOLES[h].par, 0);
      const head = `<th>Hole</th>${holes.map((h) => `<th>${holeNo(h)}</th>`).join('')}${label ? `<th>${label}</th>` : ''}${last ? '<th>Tot</th><th>±</th>' : ''}`;
      const parRow = `<th>Par</th>${holes.map((h) => `<td>${HOLES[h].par}</td>`).join('')}${label ? `<td>${parSum}</td>` : ''}${last ? `<td>${parTot}</td><td></td>` : ''}`;
      const rows = g.players
        .map((p, i) => {
          const mine = p.scores.slice(from, to);
          const sub = mine.reduce((a, b) => a + (b || 0), 0);
          const tot = p.scores.reduce((a, b) => a + b, 0);
          return `<tr><th><span class="dot" style="background:${COLORS[i]}"></span>${escapeHtml(p.name)}</th>${holes.map((h, k) => cell(p.scores[from + k], HOLES[h].par)).join('')}${label ? `<td class="tot">${mine.length ? sub : '–'}</td>` : ''}${last ? `<td class="tot">${p.scores.length ? tot : '–'}</td><td class="tot">${p.scores.length ? fmtRel(relPar(p, g)) : ''}</td>` : ''}</tr>`;
        })
        .join('');
      return `<div class="sc-wrap"><table class="scorecard"><thead><tr>${head}</tr></thead><tbody><tr class="par-row">${parRow}</tr>${rows}</tbody></table></div>`;
    })
    .join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- swing meter ----------

function meterPos(now) {
  const s = U.swing;
  const up = CLUBS[U.club].up * 1000;
  if (s.phase === 'up') return (now - s.t0) / up;
  if (s.phase === 'down') return s.m - ((now - s.t1) / up) * 1.3;
  return 0;
}

function swingWindow(power) {
  return meterWindow(currentBall().lie, U.club, power, U.shape, spinMag(), myGear()) * difficulty();
}

function swingTap(ts) {
  if (U.phase !== 'aim' || !canAct(me())) return;
  const now = Math.abs(ts - performance.now()) < 500 ? ts : performance.now();
  const s = U.swing;
  const putter = CLUBS[U.club].putter;
  if (s.phase === 'idle') {
    U.swing = { phase: 'up', t0: now, scale: meterScale() };
    sound.tick();
  } else if (s.phase === 'up') {
    const m = Math.max(0.02, Math.min(putter ? 1 : METER_MAX, meterPos(now)));
    if (putter) return takeShot(m, 0);
    U.swing = { phase: 'down', m, power: m * s.scale, scale: s.scale, t1: now };
    sound.tick();
  } else if (s.phase === 'down') {
    finishSwing(s.power, meterPos(now));
  }
  updatePanel();
}

function finishSwing(power, m) {
  takeShot(power, m / swingWindow(power));
}

function tickMeter() {
  const s = U.swing;
  if (s.phase === 'idle') return;
  if (U.phase !== 'aim') {
    U.swing = { phase: 'idle' };
    return;
  }
  const now = performance.now();
  const m = meterPos(now);
  const putter = CLUBS[U.club].putter;
  if (s.phase === 'up' && m >= (putter ? 1 : METER_MAX)) {
    if (putter) return takeShot(1, 0);
    U.swing = { phase: 'down', m: METER_MAX, power: METER_MAX * s.scale, scale: s.scale, t1: now };
  } else if (s.phase === 'down' && m <= METER_MIN) {
    finishSwing(s.power, METER_MIN);
  }
}

function drawMeter() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = meterCv.getBoundingClientRect();
  if (Math.round(rect.width * dpr) !== meterCv.width || Math.round(rect.height * dpr) !== meterCv.height) {
    meterCv.width = Math.round(rect.width * dpr);
    meterCv.height = Math.round(rect.height * dpr);
  }
  const W = meterCv.width / dpr, H = meterCv.height / dpr;
  if (!W || !H) return;
  const c = mctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  if (!G || U.screen !== 'play' || U.phase !== 'aim') return;
  const ball = currentBall();
  const club = CLUBS[U.club];
  const putter = !!club.putter;
  const pad = 14;
  const top = 26, bh = H - top - 18;
  const lo = putter ? 0 : METER_MIN, hi = putter ? 1 : METER_MAX;
  const X = (m) => pad + ((m - lo) / (hi - lo)) * (W - pad * 2);
  const s = U.swing;
  const now = performance.now();
  const m = s.phase === 'idle' ? 0 : meterPos(now);

  c.fillStyle = 'rgba(0,0,0,0.35)';
  rr(c, pad - 4, top - 4, W - pad * 2 + 8, bh + 8, 12);
  c.fill();
  const grad = c.createLinearGradient(X(0), 0, X(1), 0);
  grad.addColorStop(0, '#2d6b3a');
  grad.addColorStop(0.7, '#c9b33d');
  grad.addColorStop(1, '#d9612f');
  c.fillStyle = 'rgba(255,255,255,0.08)';
  rr(c, pad, top, W - pad * 2, bh, 9);
  c.fill();
  if (!putter) {
    c.fillStyle = 'rgba(232,67,58,0.35)';
    c.fillRect(X(1), top, X(METER_MAX) - X(1), bh);
    const pw = s.phase === 'down' ? s.power : targetPower();
    const w = swingWindow(pw);
    // Outside the good window the ball hooks or slices; far outside, a mishit.
    c.fillStyle = 'rgba(255,180,90,0.22)';
    c.fillRect(X(-Math.min(0.15, w * MISHIT)), top, X(w * MISHIT) - X(-Math.min(0.15, w * MISHIT)), bh);
    c.fillStyle = 'rgba(120,230,120,0.38)';
    c.fillRect(X(-w), top, X(w) - X(-w), bh);
    c.fillStyle = 'rgba(255,240,140,0.85)';
    c.fillRect(X(-w * 0.22), top, X(w * 0.22) - X(-w * 0.22), bh);
  }
  const fillTo = s.phase === 'up' ? m : s.phase === 'down' ? s.m : 0;
  if (fillTo > 0) {
    c.fillStyle = grad;
    c.globalAlpha = 0.85;
    c.fillRect(X(0), top + 6, Math.max(0, X(Math.min(fillTo, hi)) - X(0)), bh - 12);
    c.globalAlpha = 1;
  }
  c.font = '700 11px Nunito, ui-rounded, system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'bottom';
  const scale = s.phase === 'idle' ? meterScale() : s.scale || 1;
  const full = clubCarry(U.club, ball.lie) * scale;
  const tk = targetPower() / scale;
  const near = (k) => Math.abs(X(k) - X(tk)) < 44;
  for (const k of [0.25, 0.5, 0.75, 1]) {
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillRect(X(k) - 0.5, top, 1, bh);
    if (near(k)) continue;
    c.fillStyle = 'rgba(255,255,255,0.7)';
    const label = putter ? `${Math.round(full * k * 3)} ft` : `${Math.round(full * k)}`;
    c.fillText(label, X(k), top - 6);
  }
  // The gold target: stop the power here to land on your target.
  if (tk > 0 && tk <= hi) {
    const tx = X(tk);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(tx - 2, top, 5, bh);
    c.fillStyle = '#ffd23f';
    c.fillRect(tx - 1.5, top, 3, bh);
    c.beginPath();
    c.moveTo(tx, top + 7);
    c.lineTo(tx - 6, top - 1);
    c.lineTo(tx + 6, top - 1);
    c.fill();
    c.font = '800 12px Nunito, ui-rounded, system-ui, sans-serif';
    const lbl = putter ? `${Math.round(U.target * 3)} ft` : `${Math.round(U.target)} yd`;
    c.fillText(lbl, tx, top - 4);
  }
  if (!putter) {
    c.fillStyle = '#fff';
    c.fillRect(X(0) - 1.5, top - 2, 3, bh + 4);
  }
  if (s.phase === 'down') {
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(X(s.m), top + bh + 2);
    c.lineTo(X(s.m) - 7, top + bh + 13);
    c.lineTo(X(s.m) + 7, top + bh + 13);
    c.fill();
  }
  if (s.phase !== 'idle') {
    const x = X(Math.max(lo, Math.min(hi, m)));
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fillRect(x - 2, top - 6, 6, bh + 12);
    c.fillStyle = '#ffffff';
    c.fillRect(x - 3, top - 7, 6, bh + 14);
  }
}

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---------- popups ----------

function popup(text, color, life = 1.5, size = 30, small = false) {
  U.popups.push({ text, color, life, max: life, size, small, t: 0 });
  if (U.popups.length > 5) U.popups.shift();
}

function drawPopups(dt) {
  const ctx = R.ctx;
  const dpr = R.dpr;
  const vp = viewport();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let y0 = vp.top + 70;
  const big = U.popups.filter((p) => !p.small).slice(-2);
  const small = U.popups.filter((p) => p.small).slice(-1);
  for (const p of [...big, ...small]) {
    const f = p.t / p.max;
    const a = f < 0.1 ? f / 0.1 : f > 0.75 ? (1 - f) / 0.25 : 1;
    ctx.globalAlpha = Math.max(0, a);
    ctx.font = `${p.small ? 800 : 400} ${p.size}px ${p.small ? 'Nunito, ui-rounded, system-ui, sans-serif' : '"Lilita One", ui-rounded, system-ui, sans-serif'}`;
    ctx.lineWidth = p.size * 0.2;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(8,24,14,0.75)';
    ctx.strokeText(p.text, vp.sx, y0);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, vp.sx, y0);
    y0 += p.size + 10;
  }
  ctx.globalAlpha = 1;
  for (const p of U.popups) p.t += dt;
  U.popups = U.popups.filter((p) => p.t < p.max);
}

// ---------- HUD & panel ----------

function updateHud() {
  if (!G || !hole) return;
  $('#hNum').textContent = holeNo(G.holes[Math.min(G.h, G.holes.length - 1)]);
  $('#hCount').textContent = courseOf(G.holes[0]).holes.length;
  $('#hName').textContent = hole.name;
  $('#hPar').textContent = hole.par;
  $('#hYards').textContent = hole.yards;
  $('#windSpeed').textContent = wind.speed;
  const chips = G.players
    .map((p, i) => {
      const on = G.simul ? isLocal(i) : i === G.turn;
      const st = p.h > G.h ? '✓' : p.holed ? `✓ ${p.strokes}` : p.strokes;
      return `<div class="chip${on ? ' on' : ''}" style="--c:${COLORS[i]}"><span class="dot"></span><span class="nm"></span><span class="st">${st}</span><span class="rl">${fmtRel(relPar(p, G))}</span></div>`;
    })
    .join('');
  $('#chips').innerHTML = chips;
  $('#chips').classList.toggle('many', G.players.length > 2);
  [...$('#chips').querySelectorAll('.nm')].forEach((el, i) => (el.textContent = G.players[i].name));
}

function updatePanel() {
  if (!G || !hole) return;
  const p = me();
  const pl = G.players[p];
  const ball = pl.ball;
  const mine = U.phase === 'aim' || U.phase === 'pass';
  $('#panelMine').hidden = !mine;
  $('#panelWait').hidden = mine;
  const dist = toPin(hole, ball);
  $('#toPin').textContent = pl.holed ? 'In' : ball.lie === T.GREEN || dist < 20 ? `${Math.max(1, Math.round(dist * 3))} ft` : `${Math.round(dist)} yd`;
  $('#lie').textContent = pl.holed ? 'Holed' : hole.lieName(ball.lie);
  $('#lie').dataset.lie = pl.holed ? 5 : ball.lie;
  if (!mine) {
    let who = '';
    if (U.phase !== 'intro') {
      if (G.simul && pl.holed) {
        const left = G.players.filter((q) => !q.holed && q.h === G.h);
        who = left.length === 1 ? `Waiting for ${left[0].name} to finish the hole…` : left.length ? `Waiting for ${left.length} players to finish the hole…` : '';
      } else if (U.phase === 'flight') {
        const a = U.anims[0];
        who = a && !isLocal(a.p) ? `${G.players[a.p].name}’s shot` : '';
      } else if (!G.simul && !isLocal(G.turn)) who = `Waiting for ${G.players[G.turn].name}…`;
    }
    $('#waitText').textContent = who || ' ';
    return;
  }
  const club = CLUBS[U.club];
  $('#clubName').textContent = club.name;
  if (club.putter) {
    $('#clubInfo').textContent = `Range ${U.puttScale * 3} ft`;
  } else {
    const le = lieEffect(ball.lie, U.club);
    $('#clubInfo').textContent = `${Math.round(clubCarry(U.club, ball.lie))} yd carry${le.dist < 0.99 ? ` (${hole.lieName(ball.lie).toLowerCase()})` : ''}`;
  }
  $('#rangeBtn').hidden = !club.putter;
  $('#shapeBtn').hidden = !!club.putter;
  $('#shapeBtn').textContent = `Shot: ${U.shape === 0 && isShortGame() ? 'Pitch' : SHAPES[U.shape].name}`;
  $('#shapeBtn').classList.toggle('on', U.shape !== 0);
  $('.spin-col').hidden = !!club.putter;
  const R0 = 25;
  $('#spinDot').style.transform = `translate(${U.spin.x * R0}px, ${-U.spin.y * R0}px)`;
  $('#spinLabel').textContent = spinName(U.spin);
  $('#spinLabel').classList.toggle('on', spinMag() > 0);
  const s = U.swing.phase;
  let read = '';
  if (club.putter && (ball.lie === T.GREEN || ball.lie === T.FRINGE)) {
    const pr = readPutt(ball);
    const inch = Math.round(Math.abs(pr.inches));
    const plays = Math.round(puttPlaysLike(ball) * 3);
    read = ` · ${inch < 1 ? 'Level' : `${inch} in ${pr.inches > 0 ? 'uphill' : 'downhill'}, plays ${plays} ft`}${pr.breaks === 'straight' ? ', straight' : `, breaks ${pr.breaks}`}`;
  }
  $('#swingHint').textContent = club.putter
    ? s === 'idle' ? `Tap to start the putt${read}` : 'Tap on the gold line for perfect pace'
    : s === 'idle' ? 'Tap to start your swing' : s === 'up' ? 'Tap on the gold line to land on your target' : 'Tap on the white line!';
}

function setScreen(name) {
  U.screen = name;
  for (const id of ['title', 'courses', 'bag', 'lobby', 'setup', 'practice', 'card', 'final', 'pause', 'help']) {
    const el = $('#' + id);
    if (el) el.hidden = id !== name;
  }
  const inGame = name === 'play' || name === 'card' || name === 'pause' || name === 'final';
  $('#hud').hidden = !inGame || name === 'final';
  $('#panel').hidden = name !== 'play';
  if (name !== 'play') $('#pass').hidden = true;
  requestAnimationFrame(resize);
}

// ---------- main loop ----------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  U.time += dt;
  try {
    update(dt);
    render(dt);
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(frame);
}

function update(dt) {
  if (!G || !hole) return;
  if (U.screen === 'play' || U.screen === 'card' || U.screen === 'pause') sound.ambient(dt);
  // Shots keep flying (and arriving from the other iPad) behind menus and cards.
  stepAnims(dt);
  processQueue();
  // Waiting online with nothing moving: now and then ask the others for their copy,
  // in case a message went missing.
  if (U.online && U.screen === 'play' && U.phase === 'wait' && !U.anims.length) {
    U.waitT = (U.waitT || 0) + dt;
    if (U.waitT > 6) {
      U.waitT = 0;
      requestSync();
    }
  } else U.waitT = 0;
  if (U.screen !== 'play') return;
  if (U.phase === 'intro') {
    U.introT -= dt;
    if (U.introT <= 0) {
      U.phase = 'wait';
      refreshPhase();
    }
  }
  tickMeter();
  updatePreview();
  if (U.fly) {
    U.fly.t += dt;
    if (U.fly.t > U.fly.dur || U.phase !== 'aim' || U.swing.phase !== 'idle') endFly();
  }
  updateCamera(dt);
  if (use3D()) updateCamera3D(dt);
  const wa = wind.dir + (use3D() && U.cam3 ? -Math.PI / 2 - Math.atan2(U.cam3.target[1] - U.cam3.eye[1], U.cam3.target[0] - U.cam3.eye[0]) : U.cam.rot);
  $('#windArrow').style.transform = `rotate(${(wa * 180) / Math.PI}deg)`;
}

function render(dt) {
  R.stepParticles(dt);
  if (!G) return renderBackdrop(dt);
  if (!hole) return;
  show3D(use3D());
  if (use3D()) return render3D(dt);
  const scene = {
    view: view(),
    wind,
    time: U.time,
    dt,
    balls: [],
    trails: [],
    aim: null,
    showSlope: false,
  };
  const multi = G.players.length > 1;
  G.players.forEach((p, i) => {
    if (animFor(i)) return;
    if (p.holed || p.h !== G.h) return;
    scene.balls.push({ x: p.ball.x, y: p.ball.y, z: 0, color: COLORS[i], label: multi && U.cam.scale < 6 ? p.name.slice(0, 1).toUpperCase() : null, ring: i === me() && U.phase === 'aim' });
  });
  for (const a of U.anims) {
    const f = a.res.frames[a.i];
    scene.balls.push({ x: f.x, y: f.y, z: f.z, color: COLORS[a.p] });
    scene.trails.push(a.trail);
  }
  const ball = currentBall();
  if (U.screen === 'play' && U.phase === 'aim' && U.preview) {
    const club = CLUBS[U.club];
    const pv = U.preview;
    const fr = pv.frames;
    const pts = (from, to, step) => {
      const out = [];
      for (let i = from; i < to; i += step) out.push([fr[i].x, fr[i].y]);
      out.push([fr[to].x, fr[to].y]);
      return out;
    };
    if (club.putter) {
      // Only the start of the putt's path: enough to see it begin to break.
      const last = Math.max(1, Math.round((fr.length - 1) * puttPreviewShare()));
      scene.aim = { putt: true, flight: [[ball.x, ball.y]], roll: pts(0, Math.min(last, fr.length - 1), 3) };
    } else {
      const lf = Math.max(1, Math.min(pv.landF, fr.length - 1));
      const showRoll = store.get('difficulty', 'standard') !== 'pro' || isShortGame();
      scene.aim = {
        flight: pts(0, lf, 2),
        ring: 2.2,
        label: `${Math.round(U.target)}`,
        roll: showRoll && fr.length - 1 > lf ? pts(lf, fr.length - 1, 4) : null,
        end: showRoll && pv.outcome !== 'water' ? pv.end : null,
      };
    }
  }
  scene.showSlope = U.cam.scale > 7 && (ball.lie === T.GREEN || ball.lie === T.FRINGE || (U.phase === 'aim' && CLUBS[U.club].putter));
  const side = drawSide();
  if (scene.aim && ((side && side.hit && !side.hit.edge) || (U.preview && (U.preview.tree || U.preview.outcome === 'water' || U.preview.outcome === 'ob')))) scene.aim.color = 'rgba(255,140,125,0.95)';
  R.draw(scene);
  drawPopups(dt);
  drawMeter();
}


// ---------- side view ----------

const sideCv = $('#side');
const sctx = sideCv.getContext('2d');
let sideCache = { key: '', data: null };

function currentPower() {
  const s = U.swing;
  if (s.phase === 'up') return Math.max(0.02, Math.min(METER_MAX, meterPos(performance.now()))) * (s.scale || 1);
  if (s.phase === 'down') return s.power;
  return targetPower();
}

// Trees whose canopy crosses the aim line within reach.
function corridorTrees(ball, dir, reach) {
  const dx = Math.cos(dir), dy = Math.sin(dir);
  const out = [];
  for (const t of hole.trees) {
    const vx = t.x - ball.x, vy = t.y - ball.y;
    const a = vx * dx + vy * dy;
    const l = vx * -dy + vy * dx;
    if (Math.abs(l) < t.r && a > -3 && a < reach) out.push({ t, a, l, w: Math.sqrt(t.r * t.r - l * l) });
  }
  return out;
}

function drawSide() {
  const wrap = $('#sideWrap');
  const show = U.screen === 'play' && (U.phase === 'aim') && !CLUBS[U.club].putter && !U.mapView;
  if (!show) {
    wrap.hidden = true;
    return null;
  }
  const ball = currentBall();
  const power = currentPower();
  const base = { club: U.club, aim: U.aim, shape: U.shape, spin: U.spin, gear: myGear() };
  const key = [U.club, U.shape, U.aim.toFixed(4), power.toFixed(3), ball.x.toFixed(2), ball.y.toFixed(2), U.spin.x, U.spin.y].join('|');
  if (sideCache.key !== key) {
    const full = previewShot(hole, ball, { ...base, power: 1 });
    const main = Math.abs(power - 1) < 1e-3 ? full : previewShot(hole, ball, { ...base, power });
    const ghosts = [0.75, 0.5].map((p) => previewShot(hole, ball, { ...base, power: p }));
    const reach = Math.max(full.carry * 1.12, 25);
    sideCache = { key, data: { full, main, ghosts, reach, trees: corridorTrees(ball, U.aim, reach) } };
  }
  const d = sideCache.data;
  wrap.hidden = !(U.sidePinned || d.trees.length);
  $('#sideBtn').classList.toggle('on', U.sidePinned);
  if (wrap.hidden) return d.main;
  const hud = $('#hud').getBoundingClientRect();
  wrap.style.top = `${hud.bottom + 10}px`;

  const status = $('#sideStatus');
  if (!d.trees.length) {
    status.textContent = 'No trees in the way';
    status.dataset.s = 'ok';
  } else if (!d.main.hit) {
    status.textContent = 'Clears the trees';
    status.dataset.s = 'ok';
  } else if (d.main.hit.edge) {
    status.textContent = `May clip a tree at ${Math.round(d.main.hit.d)} yd`;
    status.dataset.s = 'warn';
  } else {
    status.textContent = `Hits a tree at ${Math.round(d.main.hit.d)} yd`;
    status.dataset.s = 'bad';
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = sideCv.getBoundingClientRect();
  if (Math.round(rect.width * dpr) !== sideCv.width || Math.round(rect.height * dpr) !== sideCv.height) {
    sideCv.width = Math.round(rect.width * dpr);
    sideCv.height = Math.round(rect.height * dpr);
  }
  const W = rect.width, H = rect.height;
  const c = sctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const padL = 6, padR = 8, padT = 6, ground = H - 18;
  const tallest = Math.max(8, d.full.apex, d.main.apex, ...d.trees.map((x) => x.t.h));
  const maxZ = tallest * 1.12;
  const X = (a) => padL + (a / d.reach) * (W - padL - padR);
  const Y = (z) => ground - (z / maxZ) * (ground - padT);

  // Ground coloured by what the ball would land on.
  const colors = { [T.TEE]: '#86cc68', [T.FAIRWAY]: '#69b24f', [T.FRINGE]: '#74bf57', [T.GREEN]: '#82d064', [T.ROUGH]: '#4f913f', [T.DEEP]: '#3d7534', [T.SAND]: '#e9d7a2', [T.WATER]: '#2f84c4', [T.OB]: '#7a8a7a' };
  const step = d.reach / 80;
  const dx = Math.cos(U.aim), dy = Math.sin(U.aim);
  for (let a = 0; a < d.reach; a += step) {
    c.fillStyle = colors[hole.terrainAt(ball.x + dx * a, ball.y + dy * a)] || '#3d7534';
    c.fillRect(X(a), ground, X(a + step) - X(a) + 0.5, 6);
  }
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.font = '700 10px Nunito, ui-rounded, system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'top';
  const tick = d.reach > 150 ? 50 : d.reach > 60 ? 25 : 10;
  for (let a = tick; a < d.reach; a += tick) {
    c.fillRect(X(a) - 0.5, ground + 6, 1, 3);
    c.fillText(`${a}`, X(a), ground + 8);
  }

  // Trees: trunk up to the lowest branches, canopy above. Paler = only the edge crosses the line.
  for (const x of d.trees) {
    const t = x.t;
    const edgeOnly = Math.abs(x.l) > t.r * 0.7;
    c.globalAlpha = edgeOnly ? 0.45 : 0.9;
    if (Math.abs(x.l) < 1.5) {
      c.fillStyle = '#6b4a2b';
      c.fillRect(X(x.a) - 1.5, Y(t.base), 3, ground - Y(t.base));
    }
    c.fillStyle = '#2f6e2c';
    const x0 = X(x.a - x.w), x1 = X(x.a + x.w), y0 = Y(t.h), y1 = Y(t.base);
    c.beginPath();
    c.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.max(2, (x1 - x0) / 2), (y1 - y0) / 2, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;

  // Pin, if it sits on the line.
  const pa = (hole.pin.x - ball.x) * dx + (hole.pin.y - ball.y) * dy;
  const pl = (hole.pin.x - ball.x) * -dy + (hole.pin.y - ball.y) * dx;
  if (Math.abs(pl) < 6 && pa > 0 && pa < d.reach) {
    c.strokeStyle = '#f1efe6';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(X(pa), ground);
    c.lineTo(X(pa), ground - 22);
    c.stroke();
    c.fillStyle = '#ffd23f';
    c.beginPath();
    c.moveTo(X(pa), ground - 22);
    c.lineTo(X(pa) + 11, ground - 18);
    c.lineTo(X(pa), ground - 14);
    c.fill();
  }

  const arc = (pv, style, width, dash) => {
    c.setLineDash(dash || []);
    c.lineWidth = width;
    c.lineCap = 'round';
    const cut = pv.hit ? pv.hit.d : Infinity;
    c.strokeStyle = style;
    c.beginPath();
    let first = true;
    for (const q of pv.pts) {
      if (q.d > cut) break;
      if (first) c.moveTo(X(q.d), Y(q.z));
      else c.lineTo(X(q.d), Y(q.z));
      first = false;
    }
    c.stroke();
    if (pv.hit) {
      c.strokeStyle = pv.hit.edge ? '#ffcf5a' : '#ff8a7a';
      c.beginPath();
      first = true;
      for (const q of pv.pts) {
        if (q.d < cut) continue;
        if (first) c.moveTo(X(q.d), Y(q.z));
        else c.lineTo(X(q.d), Y(q.z));
        first = false;
      }
      c.stroke();
    }
    c.setLineDash([]);
  };
  for (const g of d.ghosts) arc(g, 'rgba(255,255,255,0.35)', 1.2, [3, 4]);
  if (d.main !== d.full) arc(d.full, 'rgba(255,255,255,0.35)', 1.2, [3, 4]);
  arc(d.main, '#ffffff', 2.4);
  if (d.main.hit) {
    const hx = X(d.main.hit.d), hy = Y(d.main.hit.z);
    c.strokeStyle = d.main.hit.edge ? '#ffcf5a' : '#ff8a7a';
    c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(hx - 5, hy - 5); c.lineTo(hx + 5, hy + 5);
    c.moveTo(hx + 5, hy - 5); c.lineTo(hx - 5, hy + 5);
    c.stroke();
  }
  // Ball.
  c.fillStyle = '#fff';
  c.beginPath();
  c.arc(X(0), ground - 2, 3.2, 0, Math.PI * 2);
  c.fill();
  return d.main;
}


// Menus show a slowly turning view of a hole behind them.
function renderBackdrop(dt) {
  // Behind the menus: a signature hole from the chosen course.
  const { course } = coursePick();
  const show = course.holes[course.signature || 0];
  if (!hole || hole.index !== show) {
    hole = buildHole(show, 3);
    wind = windFor(show, 3);
    R.setHole(hole);
    const t = mapTarget();
    U.cam = { ...t, scale: t.scale * 1.6 };
  }
  U.cam.rot += dt * 0.02;
  const pin = hole.pin;
  U.cam.x += (pin.x + 0 - U.cam.x) * 0.002;
  U.cam.y += (pin.y + 60 - U.cam.y) * 0.002;
  if (V3.ok && store.get('view3d', true)) {
    // A slow helicopter orbit around the green.
    if (V3.hole !== hole) V3.setHole(hole, R, R.palette);
    show3D(true);
    const a = U.time * 0.05 + 1;
    const g = hole.green;
    V3.draw({
      cam: { eye: [g.x + Math.cos(a) * 125, g.y + Math.sin(a) * 125, 62], target: [g.x, g.y, 0] },
      time: U.time, wind, balls: [], trails: [], particles: [], aim: null, flagColor: flagColor(),
    });
    R.clearOverlay();
    return;
  }
  show3D(false);
  R.draw({ view: view(), wind, time: U.time, dt, balls: [], trails: [], aim: null, showSlope: false });
}

// ---------- the 3D view ----------

function use3D() {
  return V3.ok && store.get('view3d', true) && !U.mapView;
}

let shown3D = null;
function show3D(on) {
  if (shown3D === on) return;
  shown3D = on;
  $('#game3d').style.visibility = on ? 'visible' : 'hidden';
  if (!on) {
    $('#flyBtn').hidden = true;
    if (U.fly) endFly();
  }
}

function flagColor() {
  return hole && hole.course === 'standrews' ? [0.86, 0.15, 0.15, 1] : [1, 0.82, 0.25, 1];
}

const d2 = (a) => [Math.cos(a), Math.sin(a)];
const groundZ = (x, y) => (V3.ok && V3.hole === hole ? V3.heightAt(x, y) : 0);

function landIndex(res, putter) {
  if (putter) return 0;
  const land = res.events.find((e) => e.type === 'land' || e.type === 'tree');
  return land ? land.f : res.frames.length - 1;
}

// The 3D ground has hills the simulation doesn't know about. A ball in the air
// flies on a line from the ground where it started to where it lands; once
// down, it follows the ground.
function lifted(fr, landF, i) {
  if (i > landF || landF === 0) return fr[i].z + groundZ(fr[i].x, fr[i].y);
  const h0 = groundZ(fr[0].x, fr[0].y), L = fr[landF];
  return fr[i].z + h0 + (groundZ(L.x, L.y) - h0) * (i / landF);
}

// The camera director: where the 3D camera wants to be right now.
function camera3DTarget() {
  const p = me();
  const pl = G.players[p];
  // Opening flyover: sweep down the hole toward the green.
  if (U.phase === 'intro') {
    const t = 1 - Math.max(0, U.introT) / U.introDur;
    const P = hole.path, len = P[P.length - 1].s;
    const at = (s) => {
      let i = 1;
      while (i < P.length - 1 && P[i].s < s) i++;
      const a = P[i - 1], b = P[i], k = Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s || 1)));
      return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k];
    };
    const e = at(len * (-0.05 + t * 0.72));
    const ease = t * t * (3 - 2 * t);
    return { eye: [e[0], e[1], groundZ(e[0], e[1]) + 46 - ease * 22], target: [hole.green.x, hole.green.y, groundZ(hole.green.x, hole.green.y)], speed: 0 };
  }
  // A shot in the air: chase it, then cut to a camera by the landing spot.
  const a = animFor(p) || (!G.simul ? U.anims[0] : null) || (pl.holed ? U.anims[0] : null);
  if (a) return chaseCam(a);
  if (U.fly) return flyCam();
  if (U.dragging && U.dragging.cam3) return U.dragging.cam3;
  const watch = pl.holed && G.simul ? G.players.findIndex((q) => !q.holed && q.h === G.h) : p;
  const ball = G.players[watch >= 0 ? watch : p].ball;
  const aiming = (U.phase === 'aim' || U.phase === 'pass') && watch === p;
  const dir = aiming ? (U.dragging ? U.dragging.camDir : U.aim) : Math.atan2(hole.pin.y - ball.y, hole.pin.x - ball.x);
  const [dx, dy] = d2(dir);
  const dist = toPin(hole, ball);
  const z = Math.max(0.55, Math.min(2.5, U.zoom));
  let back, high, ahead;
  if ((aiming && CLUBS[U.club].putter) || (!aiming && ball.lie === T.GREEN)) {
    const k = Math.min(dist, 16);
    back = 2.2 + k * 0.25; high = 1.5 + k * 0.24; ahead = Math.max(1.2, Math.min(dist, 16) * 0.45);
  } else if ((aiming && isShortGame(ball)) || dist < 70) {
    back = 7.5; high = 3; ahead = Math.min(aiming ? U.target : dist, 60) * 0.55;
  } else {
    back = 10; high = 3.6; ahead = 22;
  }
  back /= z; high /= z;
  // Stand a little to the side, like a TV camera behind the player, so the
  // flight arc reads as a curve rather than a straight line.
  const side = back * 0.12;
  const gz = groundZ(ball.x, ball.y);
  return { eye: [ball.x - dx * back + dy * side, ball.y - dy * back - dx * side, gz + high], target: [ball.x + dx * ahead, ball.y + dy * ahead, gz], speed: 3.2 };
}

function chaseCam(a) {
  const fr = a.res.frames;
  const f = fr[Math.min(a.i, fr.length - 1)];
  if (a.replay) {
    // The cup cam: low behind the hole, looking back up the line of the ball.
    const s0 = fr[0];
    const ux = hole.pin.x - s0.x, uy = hole.pin.y - s0.y, ul = Math.hypot(ux, uy) || 1;
    const back = Math.min(5, 1.5 + ul * 0.08);
    const ex = hole.pin.x + (ux / ul) * back - (uy / ul) * 0.6, ey = hole.pin.y + (uy / ul) * back + (ux / ul) * 0.6;
    const fz = lifted(fr, landIndex(a.res, CLUBS[a.input.club].putter), Math.min(a.i, fr.length - 1));
    return { eye: [ex, ey, groundZ(ex, ey) + 0.45 + back * 0.08], target: [f.x, f.y, fz + 0.05], speed: a.i < 3 ? 0 : 6 };
  }
  const club = CLUBS[a.input.club];
  const [dx, dy] = d2(a.input.aim);
  if (club.putter) {
    // When a putt is going in, or coming close, cut down beside the cup and
    // watch it arrive.
    if (a.cupCut == null) {
      let near = Infinity, at = -1;
      fr.forEach((q, i) => {
        const d = Math.hypot(q.x - hole.pin.x, q.y - hole.pin.y);
        if (d < near) near = d;
        if (at < 0 && d < 2.6) at = i;
      });
      const from = Math.hypot(fr[0].x - hole.pin.x, fr[0].y - hole.pin.y);
      a.cupCut = (a.res.outcome === 'holed' || near < 0.3) && from > 3.2 && at > 0 ? at : -1;
    }
    if (a.cupCut > 0 && a.i >= a.cupCut) {
      if (!a.cupEye) {
        const s0 = fr[a.cupCut], ux = hole.pin.x - s0.x, uy = hole.pin.y - s0.y, ul = Math.hypot(ux, uy) || 1;
        const ex = hole.pin.x + (ux / ul) * 1.1 + (uy / ul) * 1.3, ey = hole.pin.y + (uy / ul) * 1.1 - (ux / ul) * 1.3;
        a.cupEye = [ex, ey, groundZ(ex, ey) + 0.28];
        U.cam3 = { eye: a.cupEye.slice(), target: [f.x, f.y, groundZ(f.x, f.y)] };
      }
      const tx = (f.x + hole.pin.x) / 2, ty = (f.y + hole.pin.y) / 2;
      return { eye: a.cupEye, target: [tx, ty, groundZ(tx, ty) + 0.02], speed: 5, low: true };
    }
    const ex = f.x - dx * 3, ey = f.y - dy * 3;
    return { eye: [ex, ey, groundZ(ex, ey) + 1.0], target: [f.x + dx * 3, f.y + dy * 3, groundZ(f.x, f.y)], speed: 4, low: true };
  }
  if (a.landF == null) {
    a.landF = landIndex(a.res, false);
    let apex = 0;
    for (let i = 0; i < a.landF; i++) if (fr[i].z > fr[apex].z) apex = i;
    a.apexF = apex;
  }
  const L = fr[a.landF];
  const carry = Math.hypot(L.x - fr[0].x, L.y - fr[0].y);
  const fz = lifted(fr, a.landF, Math.min(a.i, fr.length - 1));
  const gz = groundZ(f.x, f.y);
  // Broadcast style: for a long shot, cut to a camera beyond the landing area
  // looking back as the ball drops in.
  if (carry > 110 && a.i >= a.apexF + (a.landF - a.apexF) * 0.3) {
    if (!a.cut) {
      a.cut = true;
      const side = (a.p + G.n) % 2 ? 1 : -1;
      const cx = L.x + dx * 30 - dy * 10 * side, cy = L.y + dy * 30 + dx * 10 * side;
      a.cutEye = [cx, cy, Math.max(groundZ(cx, cy), groundZ(L.x, L.y)) + 6.5];
      U.cam3 = { eye: a.cutEye.slice(), target: [f.x, f.y, fz] };
    }
    return { eye: a.cutEye, target: [f.x, f.y, gz + (fz - gz) * 0.8], speed: 6 };
  }
  return { eye: [f.x - dx * 15, f.y - dy * 15, gz + 4 + (fz - gz) * 0.75], target: [f.x + dx * 20, f.y + dy * 20, gz + (fz - gz) * 0.6], speed: 5 };
}

function updateCamera3D(dt) {
  const want = camera3DTarget();
  // Never let the camera sink into a hill.
  want.eye = want.eye.slice();
  want.eye[2] = Math.max(want.eye[2], groundZ(want.eye[0], want.eye[1]) + (want.low ? 0.22 : 1.3));
  if (!U.cam3 || want.speed === 0) {
    U.cam3 = { eye: want.eye.slice(), target: want.target.slice() };
    return;
  }
  const k = 1 - Math.exp(-dt * want.speed);
  for (const key of ['eye', 'target']) for (let i = 0; i < 3; i++) U.cam3[key][i] += (want[key][i] - U.cam3[key][i]) * k;
  U.cam3.eye[2] = Math.max(U.cam3.eye[2], groundZ(U.cam3.eye[0], U.cam3.eye[1]) + (want.low ? 0.2 : 1.1));
}

// ---------- fly the line / read the green ----------
// "Fly" sends the camera along the planned flight like a drone, with a ghost
// ball, so you can see whether it threads the trees. On the green, "Read"
// crouches down and walks the line to the hole to show the contours.

function startFly() {
  if (!use3D() || U.phase !== 'aim' || !U.preview || U.swing.phase !== 'idle') return;
  if (U.fly) return endFly();
  const putt = !!CLUBS[U.club].putter;
  const pv = U.preview, ball = currentBall();
  let travel;
  if (putt) travel = Math.min(4.2, 1.8 + toPin(hole, ball) * 0.14);
  else {
    const L = pv.frames[Math.max(1, Math.min(pv.landF, pv.frames.length - 1))];
    travel = Math.min(3.4, 1.4 + Math.hypot(L.x - ball.x, L.y - ball.y) / 110);
  }
  U.fly = { t: 0, lead: 0.5, travel, dur: 0.5 + travel + 1.6, putt, pv, said: false };
  $('#flyBtn').classList.add('on');
  sound.whoosh(0.6);
}

function endFly() {
  U.fly = null;
  $('#flyBtn').classList.remove('on');
}

function flyPoint(k) {
  const fr = U.fly.pv.frames, lf = Math.max(1, Math.min(U.fly.pv.landF, fr.length - 1));
  const x = Math.max(0, Math.min(1, k)) * lf, i = Math.floor(x), j = Math.min(lf, i + 1), u = x - i;
  const A = fr[i], B = fr[j];
  return [A.x + (B.x - A.x) * u, A.y + (B.y - A.y) * u, lifted(fr, lf, i) * (1 - u) + lifted(fr, lf, j) * u];
}

function flyProgress() {
  const f = U.fly;
  const s = Math.max(0, Math.min(1, (f.t - f.lead) / f.travel));
  return s * s * (3 - 2 * s);
}

function flyCam() {
  const f = U.fly, ball = currentBall();
  const e = flyProgress();
  const done = f.t > f.lead + f.travel;
  if (f.putt) {
    const dx = hole.pin.x - ball.x, dy = hole.pin.y - ball.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    if (done) {
      // Crouched behind the cup, looking back up the line.
      const ex = hole.pin.x + ux * 2.2 + uy * 0.4, ey = hole.pin.y + uy * 2.2 - ux * 0.4;
      return { eye: [ex, ey, groundZ(ex, ey) + 0.35], target: [ball.x, ball.y, groundZ(ball.x, ball.y)], speed: 2.4, low: true };
    }
    const along = -1.6 + e * (L - 0.6);
    const ex = ball.x + ux * along, ey = ball.y + uy * along;
    const tx = ex + ux * 3, ty = ey + uy * 3;
    return { eye: [ex, ey, groundZ(ex, ey) + 0.3], target: [tx, ty, groundZ(tx, ty)], speed: 6, low: true };
  }
  if (done) {
    const Lp = flyPoint(1), P = flyPoint(0.9);
    const dx = Lp[0] - P[0], dy = Lp[1] - P[1], l = Math.hypot(dx, dy) || 1;
    return { eye: [Lp[0] - (dx / l) * 16, Lp[1] - (dy / l) * 16, Lp[2] + 8], target: Lp, speed: 2.2 };
  }
  const p = flyPoint(e), q = flyPoint(Math.min(1, e + 0.08)), b = flyPoint(Math.max(0, e - 0.03));
  const dx = q[0] - b[0], dy = q[1] - b[1], l = Math.hypot(dx, dy) || 1;
  return { eye: [b[0] - (dx / l) * 5, b[1] - (dy / l) * 5, Math.max(b[2], p[2]) + 2.4], target: [q[0], q[1], q[2]], speed: 7 };
}

function render3D(dt) {
  {
    const fb = $('#flyBtn');
    const want = U.screen === 'play' && U.phase === 'aim' && !U.anims.length && !!U.preview;
    if (fb.hidden === want) fb.hidden = !want;
    const label = CLUBS[U.club].putter ? 'Read' : 'Fly';
    if (fb.textContent !== label) fb.textContent = label;
  }
  if (!U.cam3) updateCamera3D(0);
  if (V3.hole !== hole) V3.setHole(hole, R, R.palette);
  // Repaint a sharp patch of course around the ball the camera is behind.
  const nb = currentBall();
  const nearKey = `${hole.index}|${Math.round(nb.x)}|${Math.round(nb.y)}`;
  if (U.nearKey !== nearKey && U.phase !== 'flight') {
    U.nearKey = nearKey;
    const box = { x: nb.x - 40, y: nb.y - 40, w: 80, h: 80 };
    V3.setNear(R.paint(box, 9, { markers: false }), box);
  }
  const multi = G.players.length > 1;
  const vp = viewport();
  const scene = { cam: { ...U.cam3, insetTop: vp.top, insetBottom: vp.h - vp.bot }, time: U.time, wind, balls: [], trails: [], particles: R.particles, aim: null, flagColor: flagColor() };
  scene.pinOut = (U.phase === 'aim' && !!CLUBS[U.club].putter) || U.anims.some((x) => CLUBS[x.input.club].putter);
  const labels = [];
  G.players.forEach((p, i) => {
    if (animFor(i) || p.holed || p.h !== G.h) return;
    scene.balls.push({ x: p.ball.x, y: p.ball.y, z: 0, col: parseColor(COLORS[i]), ring: i === me() && U.phase === 'aim' });
    if (multi) labels.push({ x: p.ball.x, y: p.ball.y, text: p.name.slice(0, 1).toUpperCase(), color: COLORS[i] });
  });
  for (const a of U.anims) {
    const fr = a.res.frames;
    const f = fr[a.i];
    const lf = landIndex(a.res, CLUBS[a.input.club].putter);
    scene.balls.push({ x: f.x, y: f.y, z: f.z, zAbs: lifted(fr, lf, a.i), col: parseColor(COLORS[a.p]) });
    const t = [];
    for (let i = 0; i <= a.i; i += 2) t.push([fr[i].x, fr[i].y, lifted(fr, lf, i) + 0.05]);
    t.push([f.x, f.y, lifted(fr, lf, a.i) + 0.05]);
    scene.trails.push(t.slice(-160));
  }
  const ball = currentBall();
  if (U.screen === 'play' && U.phase === 'aim' && U.preview) {
    const pv = U.preview, fr = pv.frames;
    const club = CLUBS[U.club];
    const hazard = pv.tree || pv.outcome === 'water' || pv.outcome === 'ob';
    const color = hazard ? [1, 0.55, 0.5, 0.95] : [1, 1, 1, 0.95];
    if (club.putter) {
      const last = Math.max(1, Math.round((fr.length - 1) * puttPreviewShare()));
      const roll = [];
      for (let i = 0; i <= last; i += 3) roll.push([fr[i].x, fr[i].y]);
      scene.aim = { putt: true, roll, color };
    } else {
      const lf = Math.max(1, Math.min(pv.landF, fr.length - 1));
      const arc = [];
      for (let i = 0; i <= lf; i += 2) arc.push([fr[i].x, fr[i].y, lifted(fr, lf, i) + 0.06]);
      arc.push([fr[lf].x, fr[lf].y, lifted(fr, lf, lf) + 0.06]);
      const showRoll = store.get('difficulty', 'standard') !== 'pro' || isShortGame();
      const roll = [];
      if (showRoll) for (let i = lf; i < fr.length; i += 4) roll.push([fr[i].x, fr[i].y]);
      scene.aim = {
        arc, color,
        roll: roll.length > 1 ? roll : null,
        ring: { x: fr[lf].x, y: fr[lf].y, r: 1.1 },
        end: showRoll && pv.outcome !== 'water' ? pv.end : null,
      };
      labels.push({ x: fr[lf].x, y: fr[lf].y, text: `${Math.round(U.target)}`, tag: true });
    }
  }
  if (U.fly && !U.fly.putt) {
    // The ghost ball flying the line, and the verdict when it gets there.
    const e = flyProgress(), p = flyPoint(e), pv = U.fly.pv;
    if (U.fly.t > U.fly.lead) scene.balls.push({ x: p[0], y: p[1], z: 0, zAbs: p[2], col: [1, 1, 1, 0.75] });
    if (pv.treeHit) labels.push({ x: pv.treeHit.x, y: pv.treeHit.y, z: pv.treeHit.z + 1.2, text: 'Tree!', color: 'rgba(215,45,45,0.92)' });
    if (!U.fly.said && U.fly.t > U.fly.lead + U.fly.travel) {
      U.fly.said = true;
      if (pv.treeHit) popup(`Hits a tree at ${Math.round(pv.treeHit.d)} yd`, '#ff9a8a', 1.1, 24);
      else if (pv.outcome === 'water') popup('Finds the water', '#ff9a8a', 1.1, 24);
      else popup('Clear line ✓', '#bff5a8', 1.1, 24);
    }
  }
  scene.slope = (ball.lie === T.GREEN || ball.lie === T.FRINGE || (U.phase === 'aim' && CLUBS[U.club].putter)) && toPin(hole, ball) < 30;
  drawSide();
  V3.draw(scene);
  // 2D overlay: a soft lens vignette, then labels and popups.
  R.clearOverlay();
  const ctx = R.ctx;
  ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
  {
    const w = window.innerWidth, h = window.innerHeight;
    const g = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.45, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  for (const l of labels) {
    const p = V3.project(l.x, l.y, l.z != null ? l.z : groundZ(l.x, l.y) + (l.tag ? 0 : 0.3));
    if (!p) continue;
    ctx.font = '800 13px "Nunito", ui-rounded, system-ui, sans-serif';
    const w = ctx.measureText(l.text).width + 12;
    const x = l.tag ? p[0] + 16 : p[0] - w / 2, y = l.tag ? p[1] - 10 : p[1] - 34;
    ctx.fillStyle = l.tag ? 'rgba(10,30,16,0.75)' : l.color;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, 20, 10) : ctx.rect(x, y, w, 20);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.text, x + 6, y + 10.5);
  }
  if (U.anims.some((x) => x.replay)) {
    ctx.font = '400 22px "Lilita One", ui-rounded, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(200,30,40,0.9)';
    ctx.beginPath();
    const top = viewport().top + 12;
    ctx.roundRect ? ctx.roundRect(16, top, 118, 34, 8) : ctx.rect(16, top, 118, 34);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('▶ REPLAY', 26, top + 18);
  }
  drawPopups(dt);
  drawMeter();
}

// ---------- online ----------

function onNetMessage(msg) {
  const o = U.online;
  if (!o) return;
  if (msg.to && msg.to !== deviceId()) return;
  if (msg.pv !== NET_VERSION) return warnVersion(msg);
  if (msg.from) {
    const peer = o.peers.get(msg.from) || {};
    peer.seen = Date.now();
    if (msg.name) peer.name = msg.name;
    o.peers.set(msg.from, peer);
  }
  updateNetPill();
  switch (msg.t) {
    case 'hello':
      if (o.role !== 'host') break;
      if (!G) {
        if (!o.roster.some((r) => r.id === msg.from)) {
          if (o.roster.length >= MAX_ONLINE) {
            o.link.send({ t: 'full', to: msg.from });
            break;
          }
          o.roster.push({ id: msg.from, name: msg.name || `Player ${o.roster.length + 1}` });
          sound.click();
        } else if (msg.name) o.roster.find((r) => r.id === msg.from).name = msg.name;
        sendRoster();
      } else if (G.ids && G.ids.includes(msg.from)) {
        o.link.send({ t: 'start', game: G, to: msg.from });
      } else {
        o.link.send({ t: 'started', to: msg.from });
      }
      break;
    case 'lobby':
      if (o.role === 'guest' && !G) {
        o.roster = msg.roster;
        renderRoster();
        $('#lobbyStatus').textContent = msg.roster.some((r) => r.id === deviceId())
          ? `You're in! Waiting for ${msg.roster[0].name} to start the game…`
          : `Joining game ${o.code}…`;
      }
      break;
    case 'full':
      if (!G) $('#lobbyStatus').textContent = `That game already has ${MAX_ONLINE} players.`;
      break;
    case 'started':
      if (!G) $('#lobbyStatus').textContent = 'That game has already started without you.';
      break;
    case 'start': {
      if (o.role !== 'guest') break;
      const idx = msg.game.ids ? msg.game.ids.indexOf(deviceId()) : 1;
      if (idx < 0) break;
      clearInterval(o.helloTimer);
      if (!G || G.seed !== msg.game.seed) {
        G = msg.game;
        U.local = [idx];
        save();
        startPlay();
      } else merge(msg.game);
      break;
    }
    case 'shot':
      U.queue.push(msg);
      break;
    case 'sync-req':
      if (G) sendSync();
      break;
    case 'sync':
      merge(msg.game, msg.from);
      break;
    case 'ping':
      if (G && msg.seed === G.seed && Array.isArray(msg.shots)) {
        // Anyone further along than us: ask for their copy. Anyone behind: send ours.
        let behind = msg.shots.some((k, i) => G.players[i] && k > G.players[i].shots + (animFor(i) ? 1 : 0));
        // Same shot count but a different idea of where the sender's own
        // player is (or whether they've holed out): the sender is right.
        if (Array.isArray(msg.sigs) && G.ids)
          msg.sigs.forEach((sg, i) => {
            if (sg && G.ids[i] === msg.from && G.players[i] && !animFor(i) && msg.shots[i] === G.players[i].shots && sg !== playerSig(G.players[i])) behind = true;
          });
        const ahead = msg.shots.some((k, i) => G.players[i] && k < G.players[i].shots);
        if (behind) requestSync();
        if (ahead) sendSync();
      }
      break;
    case 'bye': {
      const peer = o.peers.get(msg.from);
      if (peer) peer.seen = 0;
      if (G) popup(`${(peer && peer.name) || 'A player'} left the game`, '#ffb3a6', 3, 22, true);
      else if (o.role === 'host') {
        o.roster = o.roster.filter((r) => r.id !== msg.from);
        sendRoster();
      }
      updateNetPill();
      break;
    }
  }
}

function warnVersion(msg) {
  const now = Date.now();
  if (now - (U.versionWarned || 0) < 8000) return;
  U.versionWarned = now;
  const who = msg.name || 'Someone';
  const text = `${who} has a different version of the game. Everyone should close the game fully, reopen it and start a new game.`;
  if (U.screen === 'lobby') $('#lobbyStatus').textContent = text;
  else popup(`${who} needs to update: close and reopen the game`, '#ffb3a6', 4, 20, true);
}

function sendRoster() {
  const o = U.online;
  if (!o) return;
  renderRoster();
  o.link.send({ t: 'lobby', roster: o.roster });
  const n = o.roster.length;
  $('#btnStart').disabled = n < 2;
  $('#lobbyStatus').textContent = n < 2 ? 'Tell your friends this code, then wait here.' : n < MAX_ONLINE ? `${n} players in. Start when everyone has joined.` : 'The lobby is full. Start when you’re ready.';
}

function renderRoster() {
  const o = U.online;
  const list = $('#roster');
  const roster = (o && o.roster) || [];
  list.hidden = !roster.length;
  list.innerHTML = roster.map((r, i) => `<li><span class="dot" style="background:${COLORS[i]}"></span><span class="nm"></span>${i === 0 ? '<small>Host</small>' : ''}</li>`).join('');
  [...list.querySelectorAll('.nm')].forEach((el, i) => (el.textContent = roster[i].name + (roster[i].id === deviceId() ? ' (you)' : '')));
}

function sendSync() {
  const now = Date.now();
  if (!U.online || !G || now - (U.lastSyncSent || 0) < 1500) return;
  U.lastSyncSent = now;
  U.online.link.send({ t: 'sync', game: G });
}

function requestSync() {
  const now = Date.now();
  if (!U.online || now - (U.lastSyncReq || 0) < 2500) return;
  U.lastSyncReq = now;
  U.online.link.send({ t: 'sync-req' });
}

// Make a locally replayed shot finish exactly where the shooter's device
// says it did. If the replay drifted, the ball glides to the true spot.
function adoptResult(res, out) {
  const f = out.final;
  if (!f) return;
  const last = res.frames[res.frames.length - 1];
  const off = Math.hypot(last.x - f.x, last.y - f.y);
  if (off > 0.01) {
    const n = Math.min(40, Math.max(6, Math.round(off * 8)));
    for (let i = 1; i <= n; i++) {
      const k = i / n, e = k * k * (3 - 2 * k);
      res.frames.push({ x: last.x + (f.x - last.x) * e, y: last.y + (f.y - last.y) * e, z: (last.z || 0) * (1 - k) });
    }
  }
  if (res.outcome !== out.outcome) res.events = res.events.filter((e) => e.type !== 'dunk');
  res.final = f;
  res.outcome = out.outcome;
  res.penalty = out.penalty;
}

// A short fingerprint of a player's state, to spot copies that disagree
// even though they have the same number of shots.
function playerSig(pl) {
  const b = pl.ball || { x: 0, y: 0 };
  return `${pl.h}|${pl.holed ? 1 : 0}|${pl.strokes}|${Math.round(b.x * 4)},${Math.round(b.y * 4)}`;
}

// Take the other device's copy of any player that is further along than ours,
// and the owner's copy of their own player when ours disagrees with it.
function merge(remote, from) {
  if (!G || !remote || remote.seed !== G.seed) return;
  const prevH = G.h;
  let changed = false;
  remote.players.forEach((rp, i) => {
    if (!G.players[i] || animFor(i)) return;
    const owner = from && G.ids && G.ids[i] === from;
    if (rp.shots > G.players[i].shots || (owner && rp.shots === G.players[i].shots && playerSig(rp) !== playerSig(G.players[i]))) {
      G.players[i] = rp;
      changed = true;
    }
  });
  if (!changed) return;
  settle(G);
  computeTurn(G);
  save();
  updateHud();
  if (G.done) return showFinal();
  if (G.h !== prevH && G.last) {
    if (U.screen === 'play' && !U.anims.length) showCard();
    else U.pendingCard = true;
  } else refreshPhase();
}

function processQueue() {
  if (!U.queue.length || !G || !hole) return;
  if (U.screen !== 'play' && U.screen !== 'pause') return;
  if (U.phase === 'intro') return;
  for (let qi = 0; qi < U.queue.length; qi++) {
    const msg = U.queue[qi];
    const pl = G.players[msg.p];
    if (!pl) {
      U.queue.splice(qi--, 1);
      continue;
    }
    const expected = pl.shots + (animFor(msg.p) ? 1 : 0);
    if (msg.k < expected) {
      U.queue.splice(qi--, 1); // already have it
      continue;
    }
    if (msg.k > expected) {
      U.queue.splice(qi--, 1); // we missed one; ask for the full state
      requestSync();
      continue;
    }
    if (animFor(msg.p)) continue; // wait for their previous shot to land
    if (msg.h !== pl.h || G.holes[msg.h] !== hole.index) continue; // next hole: wait until we get there
    if (!G.simul && U.anims.length) continue;
    U.queue.splice(qi--, 1);
    const res = simulateShot(hole, pl.ball, msg.input, wind, shotSeed(G.seed, pl.h, msg.p, pl.shots));
    if (msg.out) adoptResult(res, msg.out);
    startAnim(msg.p, msg.input, res);
  }
}

function updateNetPill() {
  const pill = $('#netPill');
  const o = U.online;
  if (!o) {
    pill.hidden = true;
    return;
  }
  pill.hidden = false;
  const now = Date.now();
  const ids = G && G.ids ? G.ids.filter((id) => id !== deviceId()) : [...o.peers.keys()];
  const live = ids.filter((id) => o.peers.get(id) && now - o.peers.get(id).seen < 13000);
  const lost = ids.filter((id) => !live.includes(id));
  const up = o.status === 'online';
  const nameOf = (id) => {
    const k = G && G.ids ? G.ids.indexOf(id) : -1;
    return k >= 0 ? G.players[k].name : (o.peers.get(id) && o.peers.get(id).name) || 'player';
  };
  pill.dataset.state = !up ? 'bad' : ids.length && !lost.length ? 'ok' : 'warn';
  pill.textContent = !up
    ? 'Reconnecting…'
    : !ids.length
      ? 'Waiting for players'
      : lost.length
        ? `Waiting for ${lost.length > 1 ? lost.length + ' players' : nameOf(lost[0])}`
        : live.length > 1
          ? `${live.length} players connected`
          : `${nameOf(live[0])} connected`;
}

async function goOnline(role, code) {
  const status = (t) => ($('#lobbyStatus').textContent = t);
  if (U.online) U.online.link.close();
  const o = { role, code, status: 'connecting', peers: new Map(), roster: [] };
  U.online = o;
  o.link = new Link(code, {
    id: deviceId(),
    version: NET_VERSION,
    onMessage: onNetMessage,
    onStatus: (s) => {
      o.status = s;
      updateNetPill();
    },
  });
  status('Connecting…');
  try {
    await o.link.connect();
  } catch (e) {
    status(e.message || 'Could not connect.');
    o.link.close();
    U.online = null;
    return false;
  }
  clearInterval(o.pingTimer);
  o.pingTimer = setInterval(() => {
    if (U.online !== o) return;
    o.link.send({
      t: 'ping', seed: G ? G.seed : 0, shots: G ? G.players.map((p) => p.shots) : [], name: store.get('name', ''),
      sigs: G ? G.players.map((p, i) => (isLocal(i) ? playerSig(p) : null)) : [],
    });
    if (o.role === 'host' && !G) {
      // Drop anyone who left the lobby without saying so.
      const before = o.roster.length;
      o.roster = o.roster.filter((r, i) => i === 0 || (o.peers.get(r.id) && Date.now() - o.peers.get(r.id).seen < 12000));
      if (o.roster.length !== before) sendRoster();
    }
    updateNetPill();
  }, 4000);
  return true;
}

async function hostGame() {
  sound.click();
  saveName();
  const code = makeCode();
  G = null;
  U.local = [0];
  $('#codeShow').textContent = code;
  $('#hostBox').hidden = false;
  $('#btnHost').hidden = true;
  $('#btnStart').disabled = true;
  if (!(await goOnline('host', code))) return;
  U.online.roster = [{ id: deviceId(), name: store.get('name', 'Player 1') || 'Player 1' }];
  sendRoster();
}

function startOnlineGame() {
  const o = U.online;
  if (!o || o.role !== 'host' || G || o.roster.length < 2) return;
  sound.click();
  const roster = o.roster.slice(0, MAX_ONLINE);
  G = newGame('online', roster.map((r) => r.name), courseHoles(), { simul: store.get('onlineSimul', true), ck: courseKey() });
  G.ids = roster.map((r) => r.id);
  U.local = [0];
  save();
  o.link.send({ t: 'start', game: G });
  startPlay();
}

async function joinGame() {
  sound.click();
  saveName();
  const code = cleanCode($('#codeInput').value);
  if (code.length !== 4) {
    $('#lobbyStatus').textContent = 'Codes are 4 letters or numbers.';
    return;
  }
  G = null;
  U.local = [1];
  $('#hostBox').hidden = true;
  if (!(await goOnline('guest', code))) return;
  $('#lobbyStatus').textContent = `Joining game ${code}…`;
  const o = U.online;
  const hello = () => o.link.send({ t: 'hello', name: store.get('name', '') || 'Player' });
  hello();
  o.helloTimer = setInterval(() => (G ? clearInterval(o.helloTimer) : hello()), 2000);
}

async function rejoin() {
  const saved = store.get('online', null);
  if (!saved) return;
  sound.click();
  if (!saved.game || saved.game.v !== 2) {
    store.set('online', null);
    refreshTitle();
    return;
  }
  G = saved.game;
  const idx = G.ids ? G.ids.indexOf(deviceId()) : -1;
  U.local = [idx >= 0 ? idx : saved.role === 'host' ? 0 : 1];
  setScreen('lobby');
  $('#lobbyStatus').textContent = `Reconnecting to game ${saved.code}…`;
  if (!(await goOnline(saved.role, saved.code))) return;
  startPlay();
  U.online.link.send({ t: 'sync-req', name: store.get('name', '') });
  if (saved.role === 'guest') U.online.link.send({ t: 'hello', name: store.get('name', '') });
}

function leaveOnline() {
  if (!U.online) return;
  U.online.link.send({ t: 'bye' });
  clearInterval(U.online.pingTimer);
  clearInterval(U.online.helloTimer);
  const link = U.online.link;
  setTimeout(() => link.close(), 300);
  U.online = null;
  updateNetPill();
}

function saveName() {
  const n = $('#nameInput').value.trim().slice(0, 14);
  if (n) store.set('name', n);
}

// ---------- starting games ----------

function startPlay() {
  U.anims = [];
  U.queue = [];
  U.lastPlayer = -1;
  U.popups = [];
  U.pendingCard = false;
  U.aimFor = '';
  setScreen('play');
  if (G.done) return showFinal();
  beginHole();
  save();
}

function startSolo(fromSave) {
  sound.click();
  leaveOnline();
  U.local = [0];
  let saved = fromSave ? store.get('solo', null) : null;
  if (saved && saved.v !== 2) saved = null;
  G = saved || newGame('solo', [store.get('name', 'You') || 'You'], courseHoles(), { ck: courseKey() });
  startPlay();
}

function startHotseat() {
  sound.click();
  leaveOnline();
  // Players 1 and 2 always play; 3 and 4 join when they have a name.
  const names = [1, 2, 3, 4]
    .map((n) => [n, $(`#p${n}Input`).value.trim().slice(0, 14)])
    .filter(([n, v]) => n <= 2 || v)
    .map(([n, v]) => v || `Player ${n}`);
  store.set('hotseat', names);
  U.local = names.map((_, i) => i);
  G = newGame('hotseat', names, courseHoles(), { ck: courseKey() });
  startPlay();
}

function startPractice(i) {
  sound.click();
  leaveOnline();
  U.local = [0];
  G = newGame('practice', [store.get('name', 'You') || 'You'], [i], { ck: courseKey() });
  startPlay();
}

function toTitle() {
  if (updateReady) return location.reload();
  leaveOnline();
  G = null;
  hole = null;
  U.anims = [];
  U.queue = [];
  setScreen('title');
  refreshTitle();
}

function refreshTitle() {
  const solo = store.get('solo', null);
  const soloOk = solo && solo.v === 2;
  $('#btnContinue').hidden = !soloOk;
  if (soloOk) $('#btnContinue').textContent = `Continue round · ${courseOf(solo.holes[0]).name}, hole ${holeNo(solo.holes[Math.min(solo.h, solo.holes.length - 1)])}`;
  const online = store.get('online', null);
  const onlineOk = online && online.game && online.game.v === 2;
  $('#btnRejoin').hidden = !onlineOk;
  if (onlineOk) $('#btnRejoin').textContent = `Rejoin online game ${online.code}`;
  const cl = courseLabel();
  const best = bestFor(courseKey());
  $('#courseName').textContent = cl.name;
  $('#courseMeta').textContent = cl.meta + (best == null ? '' : ` · Best ${best} (${fmtRel(best - cl.par)})`);
  $('#btnSound').textContent = sound.muted ? 'Sound off' : 'Sound on';
  const d = store.get('difficulty', 'standard');
  $('#btnDiff').textContent = `Timing: ${d[0].toUpperCase() + d.slice(1)}`;
}

function showCourses() {
  sound.click();
  const list = $('#courseList');
  const pick = coursePick();
  list.innerHTML = '';
  for (const course of COURSES) {
    const card = document.createElement('div');
    card.className = 'course-card' + (course === pick.course ? ' on' : '');
    const yards = course.holes.reduce((a, i) => a + buildHole(i, 1).yards, 0);
    const par = course.holes.reduce((a, i) => a + HOLES[i].par, 0);
    const parts = course.nines ? ['all', 'front', 'back'] : ['all'];
    const bests = parts.map((p) => [p, bestFor(`${course.id}.${p}`)]).filter(([, b]) => b != null);
    card.innerHTML = `<div class="cc-head"><b></b><span>${course.holes.length} holes · Par ${par} · ${yards.toLocaleString()} yd</span></div><p></p>
      ${bests.length ? `<small class="cc-best">Best: ${bests.map(([p, b]) => `${course.nines ? PARTS[p] + ' ' : ''}${b}`).join(' · ')}</small>` : ''}
      ${course.nines ? `<div class="seg">${parts.map((p) => `<button class="seg-btn${course === pick.course && pick.part === p ? ' on' : ''}" data-part="${p}">${PARTS[p]}</button>`).join('')}</div>` : ''}`;
    card.querySelector('b').textContent = course.name;
    card.querySelector('p').textContent = course.blurb;
    const choose = (part) => {
      store.set('course', { id: course.id, part });
      sound.click();
      showCourses();
    };
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-part]');
      choose(btn ? btn.dataset.part : course === pick.course ? pick.part : 'all');
    });
    list.appendChild(card);
  }
  setScreen('courses');
}

function showBag() {
  sound.click();
  const gear = myGear();
  const list = $('#bagList');
  list.innerHTML = '';
  for (const slot of GEAR) {
    const row = document.createElement('div');
    row.className = 'bag-row';
    row.innerHTML = `<h3></h3><div class="bag-opts"></div>`;
    row.querySelector('h3').textContent = slot.label;
    for (const o of slot.options) {
      const b = document.createElement('button');
      b.className = 'bag-opt' + (gear[slot.slot] === o.id ? ' on' : '');
      b.innerHTML = `<b></b><span class="bo-desc"></span><span class="bo-stats">${GEAR_STATS.map((n, k) => `<span class="bo-stat"><small>${n}</small><i style="--v:${o.stats[k] / 5}"></i></span>`).join('')}</span>`;
      b.querySelector('b').textContent = o.name;
      b.querySelector('.bo-desc').textContent = o.desc;
      b.addEventListener('click', () => {
        store.set('gear', { ...myGear(), [slot.slot]: o.id });
        showBag();
      });
      row.querySelector('.bag-opts').appendChild(b);
    }
    list.appendChild(row);
  }
  setScreen('bag');
}

function showPracticeList() {
  sound.click();
  const grid = $('#holeGrid');
  grid.innerHTML = '';
  const { course } = coursePick();
  $('#practiceSub').textContent = `${course.name}: play any single hole as often as you like.`;
  course.holes.forEach((i, k) => {
    const h = HOLES[i];
    const b = document.createElement('button');
    b.className = 'hole-tile';
    b.id = `hole-${k + 1}`;
    const yards = buildHole(i, 1).yards;
    b.innerHTML = `<span class="num">${k + 1}</span><span class="nm"></span><span class="meta">Par ${h.par} · ${yards} yd</span>`;
    b.querySelector('.nm').textContent = h.name;
    b.addEventListener('click', () => startPractice(i));
    grid.appendChild(b);
  });
  setScreen('practice');
}

// ---------- input ----------

const canvas = $('#game');
const pointers = new Map();
const pinchDist = () => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
};
canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {}
  if (pointers.size === 2 && U.screen === 'play') {
    // Two fingers: pinch to zoom instead of aiming.
    U.dragging = null;
    U.pinch = { d: pinchDist(), z: U.zoom };
    return;
  }
  // Tap during a replay to skip it.
  const rep = U.anims.find((x) => x.replay);
  if (U.screen === 'play' && rep) {
    rep.i = rep.res.frames.length - 1;
    rep.t = rep.i / 60;
    rep.hold = 0.01;
    return;
  }
  // Tap during the flyover to skip it.
  if (U.screen === 'play' && U.phase === 'intro' && U.introT > 0.6) {
    U.introT = 0.01;
    return;
  }
  if (U.screen !== 'play' || U.phase !== 'aim' || U.swing.phase !== 'idle' || U.mapView) return;
  const b0 = currentBall();
  U.dragging = { id: e.pointerId, camDir: U.aim, span: aimSpan(b0, toPin(hole, b0)), cam3: null };
  // Hold the 3D camera still while dragging, so the course stays under the finger.
  if (use3D()) U.dragging.cam3 = { ...camera3DTarget(), speed: 3.2 };
  aimAt(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (U.pinch && pointers.size >= 2) {
    U.zoom = Math.max(0.35, Math.min(4, (U.pinch.z * pinchDist()) / U.pinch.d));
    return;
  }
  if (!U.dragging || e.pointerId !== U.dragging.id) return;
  aimAt(e.clientX, e.clientY);
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) U.pinch = null;
  if (U.dragging && e.pointerId === U.dragging.id) U.dragging = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  if (U.screen !== 'play') return;
  e.preventDefault();
  U.zoom = Math.max(0.35, Math.min(4, U.zoom * Math.exp(-e.deltaY * 0.0015)));
}, { passive: false });

function aimAt(sx, sy) {
  const bz = currentBall();
  const [wx, wy] = use3D() ? V3.toWorld(sx, sy, groundZ(bz.x, bz.y)) : R.toWorld(sx, sy);
  const b = currentBall();
  const d = Math.hypot(wx - b.x, wy - b.y);
  if (d < 0.5) return;
  U.aim = Math.atan2(wy - b.y, wx - b.x);
  // Drag to where you want it to land: that sets the target (and the gold
  // line on the meter). Putts keep their pace target at the hole.
  if (!CLUBS[U.club].putter) U.target = Math.max(1.5, Math.min(clubCarry(U.club, b.lie), d));
}

// The swing responds on pointerdown for precise timing.
$('#meterBox').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sound.unlock();
  swingTap(e.timeStamp);
});

function nudgeAim(dir) {
  if (U.phase !== 'aim' || U.swing.phase !== 'idle') return;
  const step = CLUBS[U.club].putter ? 0.0035 : 0.0025;
  U.aim += dir * step;
}
for (const [id, d] of [['#aimLeft', -1], ['#aimRight', 1]]) {
  const el = $(id);
  let timer = null;
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    nudgeAim(d);
    stop();
    let n = 0;
    timer = setInterval(() => nudgeAim(d * (++n > 12 ? 4 : 1)), 60);
  });
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('pointercancel', stop);
}

function changeClub(d) {
  if (U.phase !== 'aim' || U.swing.phase !== 'idle') return;
  const lie = currentBall().lie;
  let c = U.club;
  for (let k = 0; k < CLUBS.length; k++) {
    c = (c + d + CLUBS.length) % CLUBS.length;
    if (c === 0 && lie !== T.TEE && lie !== T.FAIRWAY) continue; // driver only off tee or fairway
    break;
  }
  U.club = c;
  if (CLUBS[c].putter) U.puttScale = suggestPuttScale(toPin(hole, currentBall()));
  if (!shapeList().includes(U.shape)) U.shape = 0;
  U.target = defaultTarget();
  if (CLUBS[c].putter) U.puttScale = suggestPuttScale(U.target);
  sound.click();
  updatePanel();
}
$('#clubPrev').addEventListener('click', () => changeClub(1));
$('#clubNext').addEventListener('click', () => changeClub(-1));
$('#rangeBtn').addEventListener('click', () => {
  const i = PUTT_SCALES.indexOf(U.puttScale);
  U.puttScale = PUTT_SCALES[(i + 1) % PUTT_SCALES.length];
  U.target = defaultTarget();
  sound.click();
  updatePanel();
});
// Shape & spin ball: where you'd strike the ball. Up = topspin, down =
// backspin, left/right = draw/fade.
{
  const el = $('#spinBall');
  let lastTap = 0, active = null;
  const set = (e) => {
    const r = el.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2 - 8);
    let y = -(e.clientY - (r.top + r.height / 2)) / (r.height / 2 - 8);
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    if (m < 0.12) { x = 0; y = 0; }
    U.spin = { x: Math.round(x * 20) / 20, y: Math.round(y * 20) / 20 };
    updatePanel();
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (U.phase !== 'aim' || U.swing.phase !== 'idle') return;
    const now = performance.now();
    if (now - lastTap < 320) {
      U.spin = { x: 0, y: 0 };
      lastTap = 0;
      updatePanel();
      sound.click();
      return;
    }
    lastTap = now;
    active = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch {}
    set(e);
    sound.tick();
  });
  el.addEventListener('pointermove', (e) => {
    if (active === e.pointerId) set(e);
  });
  const end = (e) => {
    if (active === e.pointerId) active = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// Tap the shape name to cycle preset shapes; the spin ball fine-tunes them.
const SHAPE_PRESETS = [0, -0.45, -0.9, 0.45, 0.9];
$('#spinLabel').addEventListener('click', () => {
  if (U.phase !== 'aim' || U.swing.phase !== 'idle' || CLUBS[U.club].putter) return;
  const i = SHAPE_PRESETS.findIndex((v) => Math.abs(v - U.spin.x) < 0.05);
  U.spin = { x: SHAPE_PRESETS[(i + 1) % SHAPE_PRESETS.length], y: U.spin.y };
  sound.click();
  updatePanel();
});

$('#shapeBtn').addEventListener('click', () => {
  if (U.phase !== 'aim' || U.swing.phase !== 'idle') return;
  const list = shapeList();
  U.shape = list[(list.indexOf(U.shape) + 1) % list.length];
  U.target = defaultTarget();
  sound.click();
  updatePanel();
});
$('#sideBtn').addEventListener('click', () => {
  U.sidePinned = !U.sidePinned;
  sound.click();
});
$('#flyBtn').addEventListener('click', () => {
  sound.click();
  startFly();
});
$('#viewBtn').addEventListener('click', () => {
  store.set('view3d', !store.get('view3d', true));
  U.cam3 = null;
  sound.click();
  refreshViewBtn();
});
function refreshViewBtn() {
  $('#viewBtn').hidden = !V3.ok;
  $('#viewBtn').textContent = store.get('view3d', true) ? '2D' : '3D';
}
refreshViewBtn();
// Three.js loads in the background; switch the 3D view on once it is ready.
V3.ready.then(() => { refreshViewBtn(); U.cam3 = null; U.nearKey = null; });
$('#mapBtn').addEventListener('click', () => {
  U.mapView = !U.mapView;
  $('#mapBtn').classList.toggle('on', U.mapView);
  sound.click();
});

document.addEventListener('keydown', (e) => {
  if (U.screen !== 'play') return;
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    swingTap(e.timeStamp);
  } else if (e.key === 'ArrowLeft') nudgeAim(-1);
  else if (e.key === 'ArrowRight') nudgeAim(1);
  else if (e.key === 'ArrowUp') changeClub(-1);
  else if (e.key === 'ArrowDown') changeClub(1);
  else if (e.key === 'm') $('#mapBtn').click();
  else if (e.key === 's') $('#shapeBtn').click();
  else if (e.key === '=' || e.key === '+') U.zoom = Math.min(4, U.zoom * 1.2);
  else if (e.key === '-') U.zoom = Math.max(0.35, U.zoom / 1.2);
});

$('#pass').addEventListener('click', () => {
  sound.unlock();
  sound.click();
  $('#pass').hidden = true;
  U.phase = 'aim';
  updatePanel();
});

// Stop iOS zoom gestures from hijacking the game.
for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => {
  if (e.target === canvas) e.preventDefault();
}, { passive: false });
document.addEventListener('pointerdown', () => sound.unlock(), { capture: true });

let rq = false;
window.addEventListener('resize', () => {
  if (rq) return;
  rq = true;
  requestAnimationFrame(() => {
    rq = false;
    resize();
  });
});

// ---------- buttons ----------

const on = (id, fn) => $(id).addEventListener('click', fn);
on('#btnSolo', () => startSolo(false));
on('#btnCourse', showCourses);
on('#btnBag', showBag);
on('#btnBagDone', () => {
  sound.click();
  setScreen('title');
  refreshTitle();
});
on('#btnCoursesDone', () => {
  sound.click();
  setScreen('title');
  refreshTitle();
});
on('#btnContinue', () => startSolo(true));
on('#btnRejoin', rejoin);
on('#btnTwo', () => {
  sound.click();
  const names = store.get('hotseat', ['Player 1', 'Player 2']);
  for (let n = 1; n <= 4; n++) $(`#p${n}Input`).value = names[n - 1] || '';
  setScreen('setup');
});
function refreshModeButtons() {
  const simul = store.get('onlineSimul', true);
  $('#modeSimul').classList.toggle('on', simul);
  $('#modeTurns').classList.toggle('on', !simul);
  $('#modeSimul').setAttribute('aria-pressed', String(simul));
  $('#modeTurns').setAttribute('aria-pressed', String(!simul));
}
on('#btnOnline', () => {
  sound.click();
  $('#nameInput').value = store.get('name', '');
  $('#hostBox').hidden = true;
  $('#btnHost').hidden = false;
  $('#roster').hidden = true;
  $('#lobbyStatus').textContent = `Up to ${MAX_ONLINE} players. Every iPad needs internet, on any Wi‑Fi or mobile data.`;
  refreshModeButtons();
  setScreen('lobby');
});
on('#modeSimul', () => {
  store.set('onlineSimul', true);
  refreshModeButtons();
  sound.click();
});
on('#modeTurns', () => {
  store.set('onlineSimul', false);
  refreshModeButtons();
  sound.click();
});
on('#btnDiff', () => {
  const order = ['casual', 'standard', 'pro'];
  const d = store.get('difficulty', 'standard');
  store.set('difficulty', order[(order.indexOf(d) + 1) % order.length]);
  refreshTitle();
  sound.click();
});
on('#btnPractice', showPracticeList);
on('#btnHelp', () => {
  sound.click();
  U.helpBack = U.screen;
  setScreen('help');
});
on('#btnHelpBack', () => {
  sound.click();
  setScreen(U.helpBack || 'title');
});
on('#btnSound', () => {
  sound.unlock();
  sound.setMuted(!sound.muted);
  store.set('muted', sound.muted);
  refreshTitle();
  sound.click();
});
on('#btnHost', hostGame);
on('#btnJoin', joinGame);
on('#btnStart', startOnlineGame);
on('#btnLobbyBack', () => {
  sound.click();
  leaveOnline();
  setScreen('title');
});
on('#btnSetupStart', startHotseat);
on('#btnSetupBack', () => {
  sound.click();
  setScreen('title');
});
on('#btnPracticeBack', () => {
  sound.click();
  setScreen('title');
});
on('#menuBtn', () => {
  if (U.screen !== 'play') return;
  sound.click();
  $('#pauseCard').innerHTML = scorecardHTML(G);
  $('#btnPauseSound').textContent = sound.muted ? 'Sound: Off' : 'Sound: On';
  setScreen('pause');
});
on('#btnResume', () => {
  sound.click();
  setScreen('play');
  if (U.pendingCard && !U.anims.length) {
    U.pendingCard = false;
    showCard();
  } else refreshPhase();
});
on('#btnPauseHelp', () => {
  sound.click();
  U.helpBack = 'pause';
  setScreen('help');
});
on('#btnPauseSound', () => {
  sound.unlock();
  sound.setMuted(!sound.muted);
  store.set('muted', sound.muted);
  $('#btnPauseSound').textContent = sound.muted ? 'Sound: Off' : 'Sound: On';
});
on('#btnQuit', () => {
  sound.click();
  toTitle();
});
on('#cardNext', nextFromCard);
on('#cardMenu', showPracticeList);
on('#btnFinalMenu', () => {
  sound.click();
  toTitle();
});
$('#codeInput').addEventListener('input', (e) => (e.target.value = cleanCode(e.target.value)));

// When a newer version is published, reload into it: straight away at
// startup, otherwise the next time the title screen shows.
let updateReady = false;
async function checkForUpdate() {
  if (APP_VERSION === 'dev' || location.protocol !== 'https:') return;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const v = String((await res.json()).v);
    if (v === APP_VERSION) return;
    let tried = null;
    try {
      tried = sessionStorage.getItem('pl.reloadFor');
      if (tried !== v) sessionStorage.setItem('pl.reloadFor', v);
    } catch {}
    if (tried === v) return; // already reloaded once for this version
    updateReady = true;
    if (U.screen === 'title' || !G) location.reload();
  } catch {}
}
checkForUpdate();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
});

if ('serviceWorker' in navigator && window.top === window.self && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Test hook: lets automated checks inspect state. Harmless in normal play.
window.__pl = {
  get G() { return G; }, get U() { return U; }, get hole() { return hole; }, showFinal, showCard, refreshPhase,
  club: () => CLUBS[U.club],
  V3,
  targetMeter: () => targetPower() / meterScale(),
  shoot: () => takeShot(targetPower(), 0),
  updatePreview,
  setBall: (x, y, lie) => { G.players[me()].ball = { x, y, lie }; U.aimFor = ''; refreshPhase(); },
};

setScreen('title');
refreshTitle();
resize();
requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(frame);
});
