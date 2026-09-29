import { buildHole, windFor, HOLES, T, TERRAIN_NAMES } from './course.js';
import {
  simulateShot, CLUBS, PUTTER, PUTT_SCALES, SHAPES, meterWindow, lieEffect, suggestClub, suggestPuttScale, shotSeed, shotLabel, previewShot, flightParams, flightPoint,
} from './sim.js';
import { Renderer } from './render.js';
import { Sound } from './audio.js';
import { Link, makeCode, cleanCode } from './net.js';

const $ = (s) => document.querySelector(s);
const TAU = Math.PI * 2;
const COLORS = ['#e8433a', '#2f7de1'];
const METER_MIN = -0.15;
const METER_MAX = 1.1;

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
const sound = new Sound(store.get('muted', false));
const meterCv = $('#meter');
const mctx = meterCv.getContext('2d');

// ---------- shared game state (plain data, sent between devices) ----------

let G = null; // the game
let hole = null; // built hole for G
let wind = null;

function newGame(mode, names, holes, seed = (Math.random() * 2 ** 31) >>> 0) {
  const g = { v: 1, mode, seed, holes, h: 0, n: 0, turn: 0, order: names.map((_, i) => i), done: false, last: null,
    players: names.map((name) => ({ name, scores: [], strokes: 0, ball: null, holed: false, picked: false })) };
  startHole(g);
  return g;
}

function startHole(g) {
  const hl = buildHole(g.holes[g.h], g.seed);
  const t = hl.tee;
  g.players.forEach((p, i) => {
    const off = g.players.length > 1 ? (i === 0 ? -1.6 : 1.6) : 0;
    p.ball = { x: t.x + Math.cos(t.ang + Math.PI / 2) * off, y: t.y + Math.sin(t.ang + Math.PI / 2) * off, lie: T.TEE };
    p.strokes = 0;
    p.holed = false;
    p.picked = false;
  });
  g.turn = g.order[0];
}

function toPin(hl, ball) {
  return Math.hypot(hl.pin.x - ball.x, hl.pin.y - ball.y);
}

// Apply a finished shot to a copy of the game and return it.
function applyShot(g0, hl, p, res) {
  const g = JSON.parse(JSON.stringify(g0));
  const pl = g.players[p];
  pl.strokes += 1 + res.penalty;
  pl.ball = res.final;
  if (res.outcome === 'holed') pl.holed = true;
  else if (pl.strokes >= hl.par + 5) {
    pl.holed = true;
    pl.picked = true;
    pl.strokes = hl.par + 5;
  }
  g.n++;
  const left = g.players.map((x, i) => i).filter((i) => !g.players[i].holed);
  if (!left.length) {
    // Hole finished: record scores, set the honour for the next tee.
    const results = g.players.map((x) => x.strokes);
    g.players.forEach((x) => x.scores.push(x.strokes));
    g.last = { h: g.h, hole: g.holes[g.h], results, picked: g.players.map((x) => x.picked) };
    g.order = [...g.order].sort((a, b) => results[a] - results[b]);
    g.h++;
    if (g.h >= g.holes.length) g.done = true;
    else startHole(g);
    return g;
  }
  // Furthest from the hole plays next; ties go to the honour order.
  left.sort((a, b) => toPin(hl, g.players[b].ball) - toPin(hl, g.players[a].ball) || g.order.indexOf(a) - g.order.indexOf(b));
  g.turn = left[0];
  return g;
}

// ---------- device/UI state ----------

const U = {
  screen: 'title',
  phase: 'idle', // intro | aim | wait | flight | pass
  local: [0], // player indices this device controls
  online: null, // { link, role, code, peerSeen, peerName }
  club: 0,
  shape: 0,
  spin: { x: 0, y: 0 },
  sidePinned: false,
  aim: 0,
  puttScale: 10,
  swing: { phase: 'idle' },
  anim: null,
  queue: [],
  cam: { x: 0, y: 0, rot: 0, scale: 2 },
  camT: null,
  mapView: false,
  dragging: null,
  introT: 0,
  popups: [],
  time: 0,
  lastPlayer: -1,
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

function isLocal(p) {
  return U.local.includes(p);
}

function currentBall() {
  return G.players[G.turn].ball;
}

function spinMag() {
  return CLUBS[U.club].putter ? 0 : Math.hypot(U.spin.x, U.spin.y);
}

function spinName(sp) {
  const v = sp.y > 0.2 ? 'Topspin' : sp.y < -0.2 ? 'Backspin' : '';
  const h = sp.x > 0.2 ? 'fade' : sp.x < -0.2 ? 'draw' : '';
  if (v && h) return `${v} + ${h}`;
  if (v) return v;
  if (h) return h[0].toUpperCase() + h.slice(1);
  return 'No spin';
}

function clubCarry(ci, lie) {
  const c = CLUBS[ci];
  return c.putter ? U.puttScale : c.carry * lieEffect(lie, ci).dist * SHAPES[U.shape].carry;
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
  const scale = Math.min(vp.vw / (x1 - x0 + 90), vp.vh / (y1 - y0 + 50));
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  // back-rotate the midpoint into world space
  return { x: mx * c + my * s, y: -mx * s + my * c, rot, scale };
}

function aimTarget(ball, dir, span, lateral) {
  const vp = viewport();
  const rot = -Math.PI / 2 - dir;
  const scale = Math.max(0.8, Math.min(70, Math.min(vp.vh / (span * 1.28 + 6), vp.vw / Math.max(lateral, 12))));
  const fwd = span * 0.44;
  return { x: ball.x + Math.cos(dir) * fwd, y: ball.y + Math.sin(dir) * fwd, rot, scale };
}

function cameraTarget() {
  if (U.mapView || U.phase === 'intro') return mapTarget();
  const p = G.players[G.turn];
  const ball = p.ball;
  if (U.phase === 'flight' && U.anim) {
    const f = U.anim.res.frames[Math.min(U.anim.i, U.anim.res.frames.length - 1)];
    const base = U.anim.view;
    return { x: base.x + (f.x - base.bx) * 0.9, y: base.y + (f.y - base.by) * 0.9, rot: base.rot, scale: base.scale };
  }
  const dist = toPin(hole, ball);
  if (U.phase === 'aim' || U.phase === 'pass') {
    const dir = U.dragging ? U.dragging.camDir : U.aim;
    const len = CLUBS[U.club].putter ? Math.max(U.puttScale, dist) : clubCarry(U.club, ball.lie) * 1.05;
    const span = Math.max(len, CLUBS[U.club].putter ? 5 : 20);
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
  const k = snap ? 1 : 1 - Math.exp(-dt * (U.phase === 'flight' ? 5 : 3.2));
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
  updateHud();
}

function beginHole() {
  loadHoleView();
  U.phase = 'intro';
  U.introT = 1.9;
  U.mapView = false;
  const b = $('#banner');
  b.innerHTML = `<small>Hole ${G.h + 1} of ${G.holes.length}</small><strong></strong><span>Par ${hole.par} · ${hole.yards} yards · Wind ${wind.speed} mph</span>`;
  b.querySelector('strong').textContent = hole.name;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
  updateCamera(0, true);
  updatePanel();
}

function enterTurn() {
  const p = G.turn;
  const pl = G.players[p];
  U.swing = { phase: 'idle' };
  U.mapView = false;
  if (isLocal(p)) {
    const ball = pl.ball;
    const dist = toPin(hole, ball);
    U.club = suggestClub(dist, ball.lie);
    U.shape = 0;
    U.spin = { x: 0, y: 0 };
    U.puttScale = suggestPuttScale(dist);
    U.aim = defaultAim(ball, U.club);
    const needPass = G.mode === 'hotseat' && U.lastPlayer !== -1 && U.lastPlayer !== p;
    U.phase = needPass ? 'pass' : 'aim';
    if (needPass) {
      $('#passName').textContent = pl.name;
      $('#passName').style.color = COLORS[p];
      $('#pass').hidden = false;
    }
    U.lastPlayer = p;
  } else {
    U.phase = 'wait';
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
  const p = G.turn;
  const ball = G.players[p].ball;
  const putter = CLUBS[U.club].putter;
  const input = { club: U.club, aim: U.aim, power, acc, puttScale: U.puttScale, shape: putter ? 0 : U.shape, spin: putter ? { x: 0, y: 0 } : { ...U.spin } };
  const res = simulateShot(hole, ball, input, wind, shotSeed(G.seed, G.h, p, G.n));
  const after = applyShot(G, hole, p, res);
  if (U.online) U.online.link.send({ t: 'shot', n: G.n, p, input, after });
  startAnim(p, input, res, after);
}

function startAnim(p, input, res, after) {
  const ball = G.players[p].ball;
  const club = CLUBS[input.club];
  const t = cameraTarget();
  U.anim = { p, input, res, after, t: 0, i: 0, fired: 0, hold: 0, view: { ...U.cam, bx: ball.x, by: ball.y }, trail: [] };
  if (U.phase !== 'aim') U.anim.view = { ...t, bx: ball.x, by: ball.y };
  U.phase = 'flight';
  U.swing = { phase: 'idle' };
  if (club.putter) sound.putt();
  else {
    const e = input.acc;
    sound.strike(club.carry > 200 ? 'wood' : 'iron', Math.abs(e) <= 0.22 ? 'perfect' : Math.abs(e) > 1 ? 'bad' : 'ok');
    popup(shotLabel(e), Math.abs(e) <= 0.22 ? '#ffe27a' : Math.abs(e) > 1 ? '#ff9a8a' : '#ffffff', 1.3, 30);
    if (ball.lie === T.SAND) R.burst(ball.x, ball.y, 26, { colors: ['#f3e3b5', '#d9c38c'], speed: 6, up: 6, life: 0.9, size: 0.25 });
    else if (ball.lie !== T.TEE) R.burst(ball.x, ball.y, 12, { colors: ['#5c8a3a', '#7a5a33'], speed: 5, up: 5, life: 0.7, size: 0.2, angle: input.aim, spread: 0.8 });
  }
  updatePanel();
}

function stepAnim(dt) {
  const a = U.anim;
  if (!a) return;
  const frames = a.res.frames;
  if (a.i < frames.length - 1) {
    a.t += dt;
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
  if (a.hold === 0) finishShotFx(a);
  a.hold += dt;
  if (a.hold > (a.res.outcome === 'holed' ? 1.8 : 1.1)) {
    U.anim = null;
    const prevH = G.h;
    G = a.after;
    save();
    updateHud();
    if (G.h !== prevH || G.done) showCard();
    else enterTurn();
  }
}

function fireEvent(ev, a) {
  switch (ev.type) {
    case 'tree':
      sound.tree();
      R.burst(ev.x, ev.y, 18, { colors: ['#2f6e2c', '#4a9a3e', '#1f4d20'], speed: 4, up: 2, life: 1.1, size: 0.35 });
      popup('Timber!', '#c9f0b0', 1.1, 26);
      break;
    case 'land': {
      const t = ev.terrain;
      if (t === T.SAND) {
        sound.land('sand');
        R.burst(ev.x, ev.y, 22, { colors: ['#f3e3b5', '#d9c38c'], speed: 4, up: 4, life: 0.9, size: 0.3 });
      } else if (t === T.GREEN || t === T.FRINGE) sound.land('green');
      else if (t === T.ROUGH || t === T.DEEP) sound.land('rough');
      else if (t !== T.WATER) sound.land('fairway');
      if (!CLUBS[a.input.club].putter && t !== T.WATER) popup(`${Math.round(a.res.carry)} yd carry`, '#ffffff', 1.4, 20, true);
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
    case 'spinback':
      popup('Spin back!', '#9fe3ff', 1.4, 28);
      break;
    case 'dunk':
      break;
  }
}

function finishShotFx(a) {
  const res = a.res;
  const pl = G.players[a.p];
  if (res.outcome === 'holed') {
    sound.cup();
    const strokes = pl.strokes + 1 + res.penalty;
    const d = strokes - hole.par;
    const name = scoreName(strokes, hole.par);
    popup(name, d < 0 || strokes === 1 ? '#ffe27a' : '#ffffff', 2, strokes === 1 || d <= -1 ? 48 : 38);
    sound.applause(strokes === 1 ? 3 : d <= -2 ? 3 : d === -1 ? 2 : d === 0 ? 1 : 0);
    R.ring(hole.pin.x, hole.pin.y, 0.1, 2.5, 'rgba(255,255,255,0.9)', 0.8);
  } else if (res.outcome === 'water') {
    popup('In the water', '#a8e4ff', 1.8, 34);
    popup('Penalty stroke – drop behind the hazard', '#ffffff', 1.8, 18, true);
    sound.groan();
  } else if (res.outcome === 'ob') {
    popup('Out of bounds', '#ffb3a6', 1.8, 34);
    popup('Penalty stroke – replay from the same spot', '#ffffff', 1.8, 18, true);
    sound.groan();
  } else if (res.final.lie === T.SAND) {
    popup('In the bunker', '#f3e3b5', 1.2, 24);
  } else if (CLUBS[a.input.club].putter) {
    const ft = Math.round(toPin(hole, res.final) * 3);
    if (ft <= 3) popup('Tap-in range', '#ffffff', 1.1, 22);
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
  $('#cardHole').textContent = `Hole ${last.h + 1} · ${HOLES[last.hole].name} · Par ${par}`;
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
    G = newGame('practice', [G.players[0].name], G.holes);
    startPlay();
    return;
  }
  if (G.done) return showFinal();
  setScreen('play');
  beginHole();
}

function showFinal() {
  const pars = G.holes.map((h) => HOLES[h].par);
  const parTot = pars.reduce((a, b) => a + b, 0);
  const totals = G.players.map((p) => p.scores.reduce((a, b) => a + b, 0));
  let title;
  if (G.players.length === 1) {
    const best = store.get('bestRound', null);
    const isBest = G.mode === 'solo' && (best == null || totals[0] < best);
    if (isBest) store.set('bestRound', totals[0]);
    title = isBest ? 'New personal best!' : `Round complete${best != null ? ` · best ${best}` : ''}`;
  } else {
    const m = Math.min(...totals);
    const winners = totals.map((t, i) => (t === m ? i : -1)).filter((i) => i >= 0);
    title = winners.length > 1 ? 'All square!' : `${G.players[winners[0]].name} wins`;
  }
  $('#finalTitle').textContent = title;
  $('#finalCard').innerHTML = scorecardHTML(G);
  setScreen('final');
  sound.applause(2);
  if (G.mode === 'solo') store.set('solo', null);
  if (G.mode === 'online') store.set('online', null);
}

function scorecardHTML(g) {
  const holes = g.holes;
  const cell = (s, par) => {
    if (s == null) return '<td class="empty">–</td>';
    const d = s - par;
    const cls = s === 1 ? 'ace' : d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : 'dbl';
    return `<td><span class="sc ${cls}">${s}</span></td>`;
  };
  const parTot = holes.reduce((a, h) => a + HOLES[h].par, 0);
  const rows = g.players
    .map((p, i) => {
      const tot = p.scores.reduce((a, b) => a + b, 0);
      return `<tr><th><span class="dot" style="background:${COLORS[i]}"></span>${escapeHtml(p.name)}</th>${holes.map((h, k) => cell(p.scores[k], HOLES[h].par)).join('')}<td class="tot">${p.scores.length ? tot : '–'}</td><td class="tot">${p.scores.length ? fmtRel(relPar(p, g)) : ''}</td></tr>`;
    })
    .join('');
  return `<div class="sc-wrap"><table class="scorecard"><thead><tr><th>Hole</th>${holes.map((h) => `<th>${h + 1}</th>`).join('')}<th>Tot</th><th>±</th></tr></thead>
    <tbody><tr class="par-row"><th>Par</th>${holes.map((h) => `<td>${HOLES[h].par}</td>`).join('')}<td>${parTot}</td><td></td></tr>${rows}</tbody></table></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- swing meter ----------

function meterPos(now) {
  const s = U.swing;
  const up = CLUBS[U.club].up * 1000;
  if (s.phase === 'up') return (now - s.t0) / up;
  if (s.phase === 'down') return s.power - ((now - s.t1) / up) * 1.3;
  return 0;
}

function swingTap(ts) {
  if (U.phase !== 'aim' || U.anim) return;
  const now = Math.abs(ts - performance.now()) < 500 ? ts : performance.now();
  const s = U.swing;
  const putter = CLUBS[U.club].putter;
  if (s.phase === 'idle') {
    U.swing = { phase: 'up', t0: now };
    sound.tick();
  } else if (s.phase === 'up') {
    const m = Math.max(0.02, Math.min(putter ? 1 : METER_MAX, meterPos(now)));
    if (putter) return takeShot(m, 0);
    U.swing = { phase: 'down', power: m, t1: now };
    sound.tick();
  } else if (s.phase === 'down') {
    const m = meterPos(now);
    finishSwing(s.power, m);
  }
  updatePanel();
}

function finishSwing(power, m) {
  const ball = currentBall();
  const w = meterWindow(ball.lie, U.club, power, U.shape, spinMag());
  takeShot(power, m / w);
}

function tickMeter() {
  const s = U.swing;
  if (s.phase === 'idle') return;
  const now = performance.now();
  const m = meterPos(now);
  const putter = CLUBS[U.club].putter;
  if (s.phase === 'up' && m >= (putter ? 1 : METER_MAX)) {
    if (putter) return takeShot(1, 0);
    U.swing = { phase: 'down', power: METER_MAX, t1: now };
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
  if (!G || U.screen !== 'play') return;
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

  // track
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
    // overswing zone
    c.fillStyle = 'rgba(232,67,58,0.35)';
    c.fillRect(X(1), top, X(METER_MAX) - X(1), bh);
    // accuracy window
    const pw = s.phase === 'down' ? s.power : 1;
    const w = meterWindow(ball.lie, U.club, pw, U.shape, spinMag());
    c.fillStyle = 'rgba(120,230,120,0.35)';
    c.fillRect(X(-w), top, X(w) - X(-w), bh);
    c.fillStyle = 'rgba(255,240,140,0.8)';
    c.fillRect(X(-w * 0.22), top, X(w * 0.22) - X(-w * 0.22), bh);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(X(METER_MIN), top, X(-w) - X(METER_MIN), bh);
  }
  // power fill
  const fillTo = s.phase === 'up' ? m : s.phase === 'down' ? s.power : 0;
  if (fillTo > 0) {
    c.fillStyle = grad;
    c.globalAlpha = 0.85;
    c.fillRect(X(0), top + 6, Math.max(0, X(Math.min(fillTo, hi)) - X(0)), bh - 12);
    c.globalAlpha = 1;
  }
  // ticks with distances
  c.font = '700 11px Nunito, ui-rounded, system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'bottom';
  const full = clubCarry(U.club, ball.lie);
  for (const k of [0.25, 0.5, 0.75, 1]) {
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillRect(X(k) - 0.5, top, 1, bh);
    c.fillStyle = 'rgba(255,255,255,0.85)';
    const label = putter ? `${Math.round(full * k * 3)} ft` : `${Math.round(full * k)}`;
    c.fillText(label, X(k), top - 6);
  }
  if (!putter) {
    c.fillStyle = '#fff';
    c.fillRect(X(0) - 1.5, top - 2, 3, bh + 4);
  }
  // chosen power
  if (s.phase === 'down') {
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(X(s.power), top + bh + 2);
    c.lineTo(X(s.power) - 7, top + bh + 13);
    c.lineTo(X(s.power) + 7, top + bh + 13);
    c.fill();
  }
  // marker
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
  U.popups.push({ text, color, life, max: life, size, small, t: 0, row: small ? 1 : 0 });
  // keep newest on top
  if (U.popups.length > 4) U.popups.shift();
}

function drawPopups(dt) {
  const ctx = R.ctx;
  const dpr = R.dpr;
  const vp = viewport();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let y0 = vp.top + 70;
  const big = U.popups.filter((p) => !p.small).slice(-1);
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
  $('#hNum').textContent = G.h + 1 > G.holes.length ? G.holes.length : G.h + 1;
  $('#hCount').textContent = G.holes.length;
  $('#hName').textContent = hole.name;
  $('#hPar').textContent = hole.par;
  $('#hYards').textContent = hole.yards;
  $('#windSpeed').textContent = wind.speed;
  const chips = G.players
    .map((p, i) => `<div class="chip${i === G.turn ? ' on' : ''}" style="--c:${COLORS[i]}"><span class="dot"></span><span class="nm"></span><span class="st">${p.holed ? '✓ ' + p.strokes : p.strokes}</span><span class="rl">${fmtRel(relPar(p, G))}</span></div>`)
    .join('');
  $('#chips').innerHTML = chips;
  [...$('#chips').querySelectorAll('.nm')].forEach((el, i) => (el.textContent = G.players[i].name));
}

function updatePanel() {
  if (!G || !hole) return;
  const p = G.turn;
  const pl = G.players[p];
  const ball = pl.ball;
  const mine = isLocal(p) && (U.phase === 'aim' || U.phase === 'pass');
  $('#panelMine').hidden = !mine;
  $('#panelWait').hidden = mine;
  const dist = toPin(hole, ball);
  $('#toPin').textContent = ball.lie === T.GREEN || dist < 20 ? `${Math.max(1, Math.round(dist * 3))} ft` : `${Math.round(dist)} yd`;
  $('#lie').textContent = TERRAIN_NAMES[ball.lie];
  $('#lie').dataset.lie = ball.lie;
  if (!mine) {
    const who = U.phase === 'intro' ? '' : U.phase === 'flight' ? (isLocal(p) ? '' : `${pl.name}’s shot`) : isLocal(p) ? '' : `Waiting for ${pl.name}…`;
    $('#waitText').textContent = who || ' ';
    return;
  }
  const club = CLUBS[U.club];
  $('#clubName').textContent = club.name;
  if (club.putter) {
    $('#clubInfo').textContent = `Range ${U.puttScale * 3} ft`;
  } else {
    const le = lieEffect(ball.lie, U.club);
    $('#clubInfo').textContent = `${Math.round(clubCarry(U.club, ball.lie))} yd carry${le.dist < 0.99 ? ` (${TERRAIN_NAMES[ball.lie].toLowerCase()})` : ''}`;
  }
  $('#rangeBtn').hidden = !club.putter;
  $('#shapeBtn').hidden = !!club.putter;
  $('#shapeBtn').textContent = `Shot: ${SHAPES[U.shape].name}`;
  $('#shapeBtn').classList.toggle('on', U.shape !== 0);
  $('.spin-col').hidden = !!club.putter;
  const R0 = 25;
  $('#spinDot').style.transform = `translate(${U.spin.x * R0}px, ${-U.spin.y * R0}px)`;
  $('#spinLabel').textContent = spinName(U.spin);
  $('#spinLabel').classList.toggle('on', spinMag() > 0);
  const s = U.swing.phase;
  $('#swingHint').textContent = club.putter
    ? s === 'idle' ? 'Tap to start the putt' : 'Tap to set the pace'
    : s === 'idle' ? 'Tap to start your swing' : s === 'up' ? 'Tap to set power' : 'Tap on the white line!';
}

function setScreen(name) {
  U.screen = name;
  for (const id of ['title', 'lobby', 'setup', 'practice', 'card', 'final', 'pause', 'help']) $('#' + id).hidden = id !== name;
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
  if (U.screen !== 'play') return;
  if (U.phase === 'intro') {
    U.introT -= dt;
    if (U.introT <= 0) enterTurn();
  }
  tickMeter();
  stepAnim(dt);
  processQueue();
  updateCamera(dt);
  const wa = wind.dir + U.cam.rot;
  $('#windArrow').style.transform = `rotate(${(wa * 180) / Math.PI}deg)`;
}

function render(dt) {
  if (!G) return renderBackdrop(dt);
  if (!hole) return;
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
    if (U.anim && U.anim.p === i) return;
    if (p.holed) return;
    scene.balls.push({ x: p.ball.x, y: p.ball.y, z: 0, color: COLORS[i], label: multi && U.cam.scale < 6 ? p.name.slice(0, 1).toUpperCase() : null, ring: i === G.turn && isLocal(i) && U.phase === 'aim' });
  });
  if (U.anim) {
    const f = U.anim.res.frames[U.anim.i];
    scene.balls.push({ x: f.x, y: f.y, z: f.z, color: COLORS[U.anim.p] });
    scene.trails.push(U.anim.trail);
  }
  const ball = currentBall();
  if (U.screen === 'play' && U.phase === 'aim' && isLocal(G.turn)) {
    const club = CLUBS[U.club];
    scene.aim = {
      x: ball.x, y: ball.y, dir: U.aim,
      len: clubCarry(U.club, ball.lie),
      ticks: [0.25, 0.5, 0.75],
      ring: club.putter ? 0.3 : 2.5,
    };
    if (!club.putter && U.spin.x !== 0) {
      // Show the intended curve from side spin (no wind, perfect strike).
      const fp = flightParams(ball, { club: U.club, aim: U.aim, power: currentPower(), shape: U.shape, spin: U.spin, acc: 0 }, { speed: 0, dir: 0 });
      scene.aim.path = [];
      for (let i = 0; i <= 30; i++) {
        const q = flightPoint(ball, fp, i / 30);
        scene.aim.path.push([q.x, q.y, q.along / fp.carry]);
      }
    }
  }
  scene.showSlope = U.cam.scale > 7 && (ball.lie === T.GREEN || ball.lie === T.FRINGE || CLUBS[U.club].putter);
  const side = drawSide();
  if (scene.aim && side && side.hit && !side.hit.edge) scene.aim.color = 'rgba(255,140,125,0.95)';
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
  if (s.phase === 'up') return Math.max(0.02, Math.min(METER_MAX, meterPos(performance.now())));
  if (s.phase === 'down') return s.power;
  return 1;
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
  const show = U.screen === 'play' && (U.phase === 'aim') && isLocal(G.turn) && !CLUBS[U.club].putter && !U.mapView;
  if (!show) {
    wrap.hidden = true;
    return null;
  }
  const ball = currentBall();
  const power = currentPower();
  const base = { club: U.club, aim: U.aim, shape: U.shape };
  const key = [U.club, U.shape, U.aim.toFixed(4), power.toFixed(3), ball.x.toFixed(2), ball.y.toFixed(2)].join('|');
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
  if (!hole) {
    hole = buildHole(6, 3);
    wind = windFor(6, 3);
    R.setHole(hole);
    const t = mapTarget();
    U.cam = { ...t, scale: t.scale * 1.6 };
  }
  U.cam.rot += dt * 0.02;
  const pin = hole.pin;
  U.cam.x += (pin.x + 0 - U.cam.x) * 0.002;
  U.cam.y += (pin.y + 60 - U.cam.y) * 0.002;
  R.draw({ view: view(), wind, time: U.time, dt, balls: [], trails: [], aim: null, showSlope: false });
}

// ---------- online ----------

function onNetMessage(msg) {
  const o = U.online;
  if (!o) return;
  o.peerSeen = Date.now();
  if (msg.name) o.peerName = msg.name;
  updateNetPill();
  switch (msg.t) {
    case 'hello':
      if (o.role === 'host') {
        if (!G) {
          const names = [store.get('name', 'Player 1'), msg.name || 'Player 2'];
          G = newGame('online', names, [...Array(HOLES.length).keys()]);
          save();
          o.link.send({ t: 'start', game: G, name: store.get('name', 'Player 1') });
          startPlay();
        } else {
          o.link.send({ t: 'start', game: G, name: store.get('name', 'Player 1') });
        }
      }
      break;
    case 'start':
      if (o.role === 'guest') {
        clearInterval(o.helloTimer);
        const fresh = !G || G.seed !== msg.game.seed;
        if (fresh || msg.game.n > G.n) {
          G = msg.game;
          save();
          if (fresh) startPlay();
          else resync();
        }
      }
      break;
    case 'shot':
      U.queue.push(msg);
      break;
    case 'sync-req':
      if (G) o.link.send({ t: 'sync', game: G });
      break;
    case 'sync':
      if (G && msg.game.seed === G.seed && msg.game.n > G.n && !U.anim) {
        G = msg.game;
        save();
        resync();
      }
      break;
    case 'ping':
      if (G && msg.n > G.n && !U.anim && !U.queue.length) o.link.send({ t: 'sync-req' });
      break;
    case 'bye':
      popup(`${o.peerName || 'Your opponent'} left the game`, '#ffb3a6', 3, 22, true);
      break;
  }
}

function processQueue() {
  if (!U.queue.length || U.anim || U.screen !== 'play') return;
  if (U.phase !== 'wait' && U.phase !== 'aim') return;
  const msg = U.queue.shift();
  if (!G || msg.after.seed !== G.seed) return;
  if (msg.n < G.n) return; // already applied
  if (msg.n > G.n) {
    // We missed something; jump straight to the sender's state.
    G = msg.after;
    save();
    resync();
    return;
  }
  const res = simulateShot(hole, G.players[msg.p].ball, msg.input, wind, shotSeed(G.seed, G.h, msg.p, G.n));
  startAnim(msg.p, msg.input, res, msg.after);
}

function resync() {
  if (G.done) return showFinal();
  if (!hole || hole.index !== G.holes[G.h]) {
    setScreen('play');
    beginHole();
  } else {
    enterTurn();
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
  const peerOk = o.peerSeen && Date.now() - o.peerSeen < 13000;
  const up = o.status === 'online';
  pill.dataset.state = !up ? 'bad' : peerOk ? 'ok' : 'warn';
  pill.textContent = !up ? 'Reconnecting…' : peerOk ? `${o.peerName || 'Opponent'} connected` : `Waiting for ${o.peerName || 'opponent'}`;
}

async function goOnline(role, code) {
  const status = (t) => ($('#lobbyStatus').textContent = t);
  if (U.online) U.online.link.close();
  const o = { role, code, status: 'connecting', peerSeen: 0, peerName: null };
  U.online = o;
  o.link = new Link(code, {
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
    o.link.send({ t: 'ping', n: G ? G.n : -1, name: store.get('name', '') });
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
  if (await goOnline('host', code)) $('#lobbyStatus').textContent = 'Tell your friend this code, then wait here.';
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
  if (!(await goOnline('guest', code))) return;
  $('#lobbyStatus').textContent = `Joining game ${code}…`;
  const o = U.online;
  const hello = () => o.link.send({ t: 'hello', name: store.get('name', 'Player 2') });
  hello();
  o.helloTimer = setInterval(() => (G ? clearInterval(o.helloTimer) : hello()), 2000);
}

async function rejoin() {
  const saved = store.get('online', null);
  if (!saved) return;
  sound.click();
  G = saved.game;
  U.local = [saved.role === 'host' ? 0 : 1];
  setScreen('lobby');
  $('#lobbyStatus').textContent = `Reconnecting to game ${saved.code}…`;
  if (!(await goOnline(saved.role, saved.code))) return;
  startPlay();
  U.online.link.send({ t: 'sync-req', name: store.get('name', '') });
  if (saved.role === 'guest') U.online.link.send({ t: 'hello', name: store.get('name', 'Player 2') });
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
  U.anim = null;
  U.queue = [];
  U.lastPlayer = -1;
  U.popups = [];
  setScreen('play');
  if (G.done) return showFinal();
  beginHole();
  save();
}

function startSolo(fromSave) {
  sound.click();
  leaveOnline();
  U.local = [0];
  const saved = fromSave ? store.get('solo', null) : null;
  G = saved || newGame('solo', [store.get('name', 'You') || 'You'], [...Array(HOLES.length).keys()]);
  startPlay();
}

function startHotseat() {
  sound.click();
  leaveOnline();
  const a = $('#p1Input').value.trim().slice(0, 14) || 'Player 1';
  const b = $('#p2Input').value.trim().slice(0, 14) || 'Player 2';
  store.set('hotseat', [a, b]);
  U.local = [0, 1];
  G = newGame('hotseat', [a, b], [...Array(HOLES.length).keys()]);
  startPlay();
}

function startPractice(i) {
  sound.click();
  leaveOnline();
  U.local = [0];
  G = newGame('practice', [store.get('name', 'You') || 'You'], [i]);
  startPlay();
}

function toTitle() {
  leaveOnline();
  G = null;
  hole = null;
  U.anim = null;
  setScreen('title');
  refreshTitle();
}

function refreshTitle() {
  const solo = store.get('solo', null);
  $('#btnContinue').hidden = !solo;
  if (solo) $('#btnContinue').textContent = `Continue round · Hole ${solo.h + 1}`;
  const online = store.get('online', null);
  $('#btnRejoin').hidden = !online;
  if (online) $('#btnRejoin').textContent = `Rejoin online game ${online.code}`;
  const best = store.get('bestRound', null);
  const par = HOLES.reduce((a, h) => a + h.par, 0);
  $('#bestLine').textContent = best == null ? `9 holes · Par ${par}` : `Best round ${best} (${fmtRel(best - par)})`;
  $('#btnSound').textContent = sound.muted ? 'Sound off' : 'Sound on';
}

function showPracticeList() {
  sound.click();
  const grid = $('#holeGrid');
  grid.innerHTML = '';
  HOLES.forEach((h, i) => {
    const b = document.createElement('button');
    b.className = 'hole-tile';
    b.id = `hole-${i + 1}`;
    const yards = buildHole(i, 1).yards;
    b.innerHTML = `<span class="num">${i + 1}</span><span class="nm"></span><span class="meta">Par ${h.par} · ${yards} yd</span>`;
    b.querySelector('.nm').textContent = h.name;
    b.addEventListener('click', () => startPractice(i));
    grid.appendChild(b);
  });
  setScreen('practice');
}

// ---------- input ----------

const canvas = $('#game');
canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (U.screen !== 'play' || U.phase !== 'aim' || U.swing.phase !== 'idle' || U.mapView) return;
  U.dragging = { id: e.pointerId, camDir: U.aim };
  aimAt(e.clientX, e.clientY);
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {}
});
canvas.addEventListener('pointermove', (e) => {
  if (!U.dragging || e.pointerId !== U.dragging.id) return;
  aimAt(e.clientX, e.clientY);
});
const endDrag = (e) => {
  if (U.dragging && e.pointerId === U.dragging.id) U.dragging = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function aimAt(sx, sy) {
  const [wx, wy] = R.toWorld(sx, sy);
  const b = currentBall();
  if (Math.hypot(wx - b.x, wy - b.y) < 0.5) return;
  U.aim = Math.atan2(wy - b.y, wx - b.x);
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
  sound.click();
  updatePanel();
}
$('#clubPrev').addEventListener('click', () => changeClub(1));
$('#clubNext').addEventListener('click', () => changeClub(-1));
$('#rangeBtn').addEventListener('click', () => {
  const i = PUTT_SCALES.indexOf(U.puttScale);
  U.puttScale = PUTT_SCALES[(i + 1) % PUTT_SCALES.length];
  sound.click();
  updatePanel();
});
// Spin ball: where you'd strike the ball. Up = topspin, down = backspin.
{
  const el = $('#spinBall');
  let lastTap = 0, active = null;
  const set = (e) => {
    const r = el.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2 - 8);
    let y = -(e.clientY - (r.top + r.height / 2)) / (r.height / 2 - 8);
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    if (m < 0.18) { x = 0; y = 0; }
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

$('#shapeBtn').addEventListener('click', () => {
  if (U.phase !== 'aim' || U.swing.phase !== 'idle') return;
  U.shape = (U.shape + 1) % SHAPES.length;
  sound.click();
  updatePanel();
});
$('#sideBtn').addEventListener('click', () => {
  U.sidePinned = !U.sidePinned;
  sound.click();
});
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
on('#btnContinue', () => startSolo(true));
on('#btnRejoin', rejoin);
on('#btnTwo', () => {
  sound.click();
  const names = store.get('hotseat', ['Player 1', 'Player 2']);
  $('#p1Input').value = names[0];
  $('#p2Input').value = names[1];
  setScreen('setup');
});
on('#btnOnline', () => {
  sound.click();
  $('#nameInput').value = store.get('name', '');
  $('#hostBox').hidden = true;
  $('#lobbyStatus').textContent = 'Both iPads need an internet connection. Any Wi‑Fi works.';
  setScreen('lobby');
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

if ('serviceWorker' in navigator && window.top === window.self && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Test hook: lets automated checks inspect state. Harmless in normal play.
window.__pl = { get G() { return G; }, get U() { return U; }, get hole() { return hole; }, enterTurn, showFinal, showCard, setBall: (x, y, lie) => { G.players[G.turn].ball = { x, y, lie }; enterTurn(); } };

setScreen('title');
refreshTitle();
resize();
requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(frame);
});
