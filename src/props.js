// Course furniture and people for the 3D view: patrons, gallery ropes, stone
// footbridges, the big manual scoreboard, the clubhouse, TV towers and the
// flagstick. Everything is built in code as small flat-shaded meshes with
// vertex colours (no textures), in yards with z up, ready for instancing
// with one shared material (makePropMaterial).
//
// Palette channels: a vertex colour's red channel may carry a flag, stored as
// r + 2 × flag (colours themselves stay in 0..1). The prop material decodes it
// and swaps in a colour per instance, so thousands of patrons can share one
// geometry and one material yet all dress differently:
//   0  baked colour as is
//   1  shirt     (× the instance colour if the mesh has instance colours,
//                 else a colour picked from SHIRTS by a hash of the position)
//   2  trousers  (picked from TROUSERS)
//   3  skin      (picked from SKIN)
//   4  hat/hair  (picked from HATS)
// The baked colour is kept as a shading factor (e.g. darker under the arms).

const TAU = Math.PI * 2;

const srgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
};
const sh = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => a + (b - a) * t;

function rand(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A colour with a palette flag (see above): white × flag-palette by default.
const F = (flag, k = 1) => [k + 2 * flag, k, k];

class PB {
  constructor() {
    this.P = [];
    this.N = [];
    this.C = [];
  }
  get tris() {
    return this.P.length / 9;
  }
  // One flat triangle; colours per corner (or one for all).
  tri(a, b, c, col, cb = col, cc = col) {
    const n = norm(cross(sub(b, a), sub(c, a)));
    for (const [p, k] of [[a, col], [b, cb], [c, cc]]) {
      this.P.push(p[0], p[1], p[2]);
      this.N.push(n[0], n[1], n[2]);
      this.C.push(k[0], k[1], k[2]);
    }
  }
  // Quad a-b-c-d (counter-clockwise seen from the front).
  quad(a, b, c, d, col, c2 = col) {
    this.tri(a, b, c, col, col, c2);
    this.tri(a, c, d, col, c2, c2);
  }
  // Axis-aligned box from min corner to max corner, optional rotation about
  // z (around `pivot`); `faces` skips sides ('-z' etc.); colour per face.
  box(min, max, col, { skip = '', top = col, rot = 0, pivot = [0, 0, 0] } = {}) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const R = (p) => {
      if (!rot) return p;
      const c = Math.cos(rot), s = Math.sin(rot), x = p[0] - pivot[0], y = p[1] - pivot[1];
      return [pivot[0] + x * c - y * s, pivot[1] + x * s + y * c, p[2]];
    };
    const v = (x, y, z) => R([x, y, z]);
    const side = sh(col, 0.92);
    if (!skip.includes('+z')) this.quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), top);
    if (!skip.includes('-z')) this.quad(v(x0, y1, z0), v(x1, y1, z0), v(x1, y0, z0), v(x0, y0, z0), sh(col, 0.7));
    if (!skip.includes('-y')) this.quad(v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1), col);
    if (!skip.includes('+y')) this.quad(v(x1, y1, z0), v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1), col);
    if (!skip.includes('-x')) this.quad(v(x0, y1, z0), v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), side);
    if (!skip.includes('+x')) this.quad(v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1), side);
  }
  // A prism from a to b with `sides` sides, radii r0 → r1; `sx` squashes the
  // section along the local x axis. Colours: start, end. Optional end caps.
  prism(a, b, r0, r1, sides, c0, c1 = c0, { cap0 = false, cap1 = false, rot = 0, sx = 1, ref = null } = {}) {
    const t = norm(sub(b, a));
    const u = norm(ref ? cross(t, cross(ref, t)) : Math.abs(t[2]) < 0.9 ? cross(t, [0, 0, 1]) : cross(t, [1, 0, 0]));
    const w = cross(t, u);
    const ring = (c, r) => {
      const out = [];
      for (let s = 0; s < sides; s++) {
        const an = rot + (s / sides) * TAU;
        out.push(add(c, add(mul(u, Math.cos(an) * r * sx), mul(w, Math.sin(an) * r))));
      }
      return out;
    };
    const A = ring(a, r0), B = ring(b, r1);
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      this.tri(A[s], A[s2], B[s2], c0, c0, c1);
      this.tri(A[s], B[s2], B[s], c0, c1, c1);
    }
    if (cap1) for (let s = 1; s < sides - 1; s++) this.tri(B[0], B[s], B[s + 1], c1);
    if (cap0) for (let s = 1; s < sides - 1; s++) this.tri(A[0], A[s + 1], A[s], c0);
  }
  // A ribbon/strip between two polylines (same length).
  strip(L, R, col) {
    for (let i = 0; i < L.length - 1; i++) this.quad(L[i], R[i], R[i + 1], L[i + 1], typeof col === 'function' ? col(i) : col);
  }
  // Mirror in x (keeping faces facing outward).
  mirrorX() {
    for (let i = 0; i < this.P.length; i += 9) {
      for (let k = 0; k < 9; k += 3) {
        this.P[i + k] *= -1;
        this.N[i + k] *= -1;
      }
      for (const A of [this.P, this.N, this.C]) {
        for (let k = 0; k < 3; k++) {
          const t = A[i + 3 + k];
          A[i + 3 + k] = A[i + 6 + k];
          A[i + 6 + k] = t;
        }
      }
    }
    return this;
  }
  merge(o) {
    this.P.push(...o.P);
    this.N.push(...o.N);
    this.C.push(...o.C);
    return this;
  }
  transform(fn) {
    for (let i = 0; i < this.P.length; i += 3) {
      const [p, n] = fn([this.P[i], this.P[i + 1], this.P[i + 2]], [this.N[i], this.N[i + 1], this.N[i + 2]]);
      this.P[i] = p[0]; this.P[i + 1] = p[1]; this.P[i + 2] = p[2];
      this.N[i] = n[0]; this.N[i + 1] = n[1]; this.N[i + 2] = n[2];
    }
    return this;
  }
  geometry(T) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.C, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------- patrons ----------
// About 1.9 yd tall, standing on z = 0 and facing +y. Feet apart a little.

function head(b, c, rad = 0.1, brim = true) {
  // A pentagonal head: chin point (skin), a band from cheek to crown (face
  // at the front in skin, the rest hat/hair) and a flat crown.
  const lo = [], hi = [];
  for (let s = 0; s < 5; s++) {
    const a = (s / 5) * TAU + Math.PI / 2;
    lo.push([c[0] + Math.cos(a) * rad, c[1] + Math.sin(a) * rad * 1.1, c[2] - 0.05]);
    hi.push([c[0] + Math.cos(a) * rad * 0.9, c[1] + Math.sin(a) * rad, c[2] + 0.09]);
  }
  const chin = [c[0], c[1] + 0.03, c[2] - 0.15];
  for (let s = 0; s < 5; s++) {
    const s2 = (s + 1) % 5;
    b.tri(lo[s2], lo[s], chin, F(3, 0.95), F(3, 0.95), F(3, 0.8));
    // s = 0 is the front vertex: its two neighbouring faces show the face.
    const face = s === 0 || s === 4;
    const k = face ? F(3, 1) : F(4, 0.95);
    b.tri(lo[s], lo[s2], hi[s2], k, k, face ? F(4, 1) : k);
    b.tri(lo[s], hi[s2], hi[s], k, face ? F(4, 1) : k, face ? F(4, 1) : k);
  }
  // Slightly domed crown: the front vertex lifted.
  hi[0] = [hi[0][0], hi[0][1], hi[0][2] + 0.03];
  for (let s = 1; s < 4; s++) b.tri(hi[0], hi[s], hi[s + 1], F(4, 1.05));
  if (brim) {
    // A cap's peak, poking forward.
    const z = c[2] + 0.08, y = c[1] + rad * 1.0;
    b.tri([c[0] - rad * 0.8, y - 0.04, z], [c[0] + rad * 0.8, y - 0.04, z], [c[0], y + 0.09, z - 0.025], F(4, 0.9));
  }
}

function patronStand(variant = 0) {
  const b = new PB();
  const hip = 0.96, sh0 = 1.5;
  // Legs (trousers), square sections, a little apart.
  for (const s of [-1, 1]) {
    const foot = [s * 0.1 + (variant === 1 ? s * 0.03 : 0), 0.02, 0], top = [s * 0.085, 0, hip + 0.02];
    b.prism(foot, top, 0.075, 0.095, 3, F(2, 0.55), F(2, 1), { rot: Math.PI / 2, ref: [0, 1, 0] });
  }
  // Torso: a tapered hexagonal prism, flattened front to back, with a
  // shoulder cap. Belt line darker.
  const t0 = b.P.length;
  b.prism([0, 0, hip - 0.04], [0, 0, sh0 + 0.04], 0.19, 0.24, 6, F(1, 0.75), F(1, 1.05), { cap1: true, ref: [1, 0, 0] });
  // Squash its depth.
  for (let i = t0; i < b.P.length; i += 3) b.P[i + 1] *= 0.6;
  // Arms: shirt sleeve at the shoulder fading to skin at the hand.
  for (const s of [-1, 1]) {
    const shd = [s * 0.235, 0, sh0 - 0.02];
    const hand = variant === 1 ? [s * 0.07, 0.17, 1.2] : variant === 2 ? [s * 0.16, -0.14, 1.0] : [s * 0.28, 0.03, 0.98];
    b.prism(shd, hand, 0.055, 0.042, 3, F(1, 1), F(3, 0.9), { ref: [0, 1, 0] });
  }
  head(b, [0, 0.01, 1.73], 0.1, variant !== 2);
  return b;
}

function chair(b = new PB(), x = 0, y = 0) {
  // The classic green folding spectator chair: canvas seat and back.
  const g = srgb('#1f5a32'), dg = srgb('#163f24');
  const sz = 0.42;
  b.quad([x - 0.24, y - 0.22, sz], [x + 0.24, y - 0.22, sz], [x + 0.24, y + 0.2, sz], [x - 0.24, y + 0.2, sz], g);
  b.quad([x - 0.24, y - 0.28, sz + 0.05], [x + 0.24, y - 0.28, sz + 0.05], [x + 0.24, y - 0.33, sz + 0.5], [x - 0.24, y - 0.33, sz + 0.5], sh(g, 0.95));
  for (const s of [-1, 1]) {
    const xx = x + s * 0.25;
    // X-frame legs on each side.
    b.quad([xx, y - 0.24, 0], [xx, y - 0.2, 0], [xx, y + 0.22, sz], [xx, y + 0.18, sz], dg);
    b.quad([xx, y + 0.18, 0], [xx, y + 0.22, 0], [xx, y - 0.3, sz + 0.5], [xx, y - 0.34, sz + 0.5], dg);
  }
  return b;
}

function patronSit() {
  const b = new PB();
  const seat = 0.47, hip = [0, -0.05, seat + 0.04];
  // Shins (both legs as one block), thighs, torso, arms resting on lap.
  const s0 = b.P.length;
  b.prism([0, 0.36, 0], [0, 0.36, seat], 0.15, 0.17, 3, F(2, 0.5), F(2, 0.95), { rot: -Math.PI / 2, ref: [0, 1, 0] });
  for (let i = s0; i < b.P.length; i += 3) b.P[i + 1] = 0.36 + (b.P[i + 1] - 0.36) * 0.5;
  b.prism([0, -0.12, seat + 0.06], [0, 0.42, seat + 0.06], 0.17, 0.16, 3, F(2, 0.85), F(2, 1), { rot: Math.PI / 2, ref: [1, 0, 0], sx: 1.3 });
  const t0 = b.P.length;
  b.prism([0, -0.12, seat + 0.03], [0, -0.17, seat + 0.62], 0.19, 0.24, 6, F(1, 0.75), F(1, 1.05), { cap1: true, ref: [1, 0, 0] });
  for (let i = t0; i < b.P.length; i += 3) b.P[i + 1] = -0.14 + (b.P[i + 1] + 0.14) * 0.6;
  for (const s of [-1, 1]) b.prism([s * 0.235, -0.16, seat + 0.58], [s * 0.15, 0.22, seat + 0.12], 0.055, 0.042, 3, F(1, 1), F(3, 0.9), { ref: [0, 1, 0] });
  head(b, [0, -0.15, seat + 0.81]);
  chair(b, 0, -0.06);
  return b;
}

// ---------- gallery ropes ----------

function stake(b = new PB(), x = 0, y = 0, z = 0, h = 0.9) {
  const g = srgb('#1d5b34'), w = srgb('#f2f2ec');
  b.prism([x, y, z - 0.05], [x, y, z + h * 0.8], 0.028, 0.024, 4, sh(g, 0.8), g, { rot: Math.PI / 4 });
  b.prism([x, y, z + h * 0.8], [x, y, z + h - 0.03], 0.024, 0.022, 4, w, w, { rot: Math.PI / 4 });
  b.prism([x, y, z + h - 0.03], [x, y, z + h], 0.022, 0.0, 4, w, w, { rot: Math.PI / 4 });
  return b;
}

// Stakes every `spacing` yards along a polyline [[x, y], ...] with a sagging
// rope between them; `heightAt(x, y)` puts them on the ground.
export function makeRopeLine(T, pts, { spacing = 3.5, height = 0.9, ropeAt = 0.82, sag = 0.09, heightAt = () => 0, rope = '#efe9d6', thick = 0.035 } = {}) {
  const b = new PB();
  const posts = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / spacing));
    for (let k = i ? 1 : 0; k <= n; k++) posts.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  const rc = srgb(rope);
  for (const [x, y] of posts) stake(b, x, y, heightAt(x, y), height);
  for (let i = 0; i < posts.length - 1; i++) {
    const [ax, ay] = posts[i], [bx, by] = posts[i + 1];
    const za = heightAt(ax, ay) + height * ropeAt, zb = heightAt(bx, by) + height * ropeAt;
    const seg = 4, line = [];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      line.push([lerp(ax, bx, t), lerp(ay, by, t), lerp(za, zb, t) - sag * 4 * t * (1 - t)]);
    }
    const d = norm([bx - ax, by - ay, 0]), side = [-d[1] * thick * 0.5, d[0] * thick * 0.5, 0], up = [0, 0, thick * 0.5];
    // Two crossed ribbons read as a round rope from any side.
    b.strip(line.map((p) => sub(p, up)), line.map((p) => add(p, up)), rc);
    b.strip(line.map((p) => sub(p, side)), line.map((p) => add(p, side)), sh(rc, 1.05));
  }
  return b.geometry(T);
}

// ---------- stone footbridge ----------
// Spans x from -length/2 to +length/2 (the crossing direction), centred on
// y = 0, ground/bank level z = 0 at both ends; the arch's springing sits
// `depth` below, so the creek bed should be lower than about -0.5.

export function makeStoneBridge(T, { length = 18, width = 3, rise = 1.3, wall = 0.6, wallT = 0.38, depth = 1.6, span = 0.5, seed = 3, stone = 0.7 } = {}) {
  const b = new PB(), r = rand(seed);
  const L2 = length / 2, W2 = width / 2;
  const deck = (x) => rise * Math.pow(Math.max(0, 1 - (x / L2) ** 2), 0.75);
  const a = (length * span) / 2;
  const crown = rise - 0.55, spring = -depth * 0.6;
  const arch = (x) => (Math.abs(x) < a ? spring + (crown - spring) * Math.sqrt(1 - (x / a) ** 2) : -depth);
  const pal = ['#a59d8f', '#9a9284', '#b4ab9b', '#8e877b', '#aaa08c', '#9f9a90', '#b8b0a2', '#8b8478'].map(srgb);
  const mortar = srgb('#6e695f');
  const stoneCol = (k = 1) => sh(pal[Math.floor(r() * pal.length)], (0.9 + r() * 0.2) * k);
  const hq = stone * 0.5; // course height
  const joint = 0.035;

  // A vertical wall face in the plane y = yf (facing ±y), between bot(x) and
  // top(x), laid in horizontal courses of irregular stones with mortar joints.
  const face = (yf, dir, bot, top, x0 = -L2, x1 = L2) => {
    const zMin = -depth, zMax = rise + wall + 0.1;
    const P = (x, z) => [x, yf, z];
    const q = (xa, xb, za, zb, col) => {
      // Clip to the wall's outline, corner by corner.
      const c = (x, z) => Math.min(top(x), Math.max(bot(x), z));
      const A = [xa, c(xa, za)], B = [xb, c(xb, za)], C = [xb, c(xb, zb)], D = [xa, c(xa, zb)];
      if (C[1] - B[1] < 0.01 && D[1] - A[1] < 0.01) return;
      if (dir > 0) b.quad(P(...A), P(...B), P(...C), P(...D), col);
      else b.quad(P(...B), P(...A), P(...D), P(...C), col);
    };
    let row = 0;
    for (let z = zMin; z < zMax; z += hq, row++) {
      const h = hq;
      let x = x0 - (row % 2) * stone * 0.5;
      while (x < x1) {
        const w = stone * (0.7 + r() * 0.7);
        const xa = Math.max(x0, x), xb = Math.min(x1, x + w);
        if (xb - xa > 0.02) {
          // Cut long stones at the arch so they follow its curve.
          const steps = Math.max(1, Math.ceil((xb - xa) / 0.35));
          const col = stoneCol();
          for (let s = 0; s < steps; s++) {
            const sa = lerp(xa, xb - joint, s / steps), sb = lerp(xa, xb - joint, (s + 1) / steps);
            q(sa, sb, z + joint, z + h, col);
          }
          q(xb - joint, xb, z, z + h, mortar);
        }
        q(xa, xb, z, z + joint, mortar);
        x += w;
      }
    }
  };
  const top = (x) => deck(x) + wall;
  face(W2, 1, arch, top);
  face(-W2, -1, arch, top);
  face(W2 - wallT, -1, deck, top);
  face(-W2 + wallT, 1, deck, top);

  // Arch ring: lighter voussoirs standing slightly proud on both faces.
  const vous = srgb('#c2b9a8');
  const nv = Math.max(9, Math.round((Math.PI * a) / 0.45)) | 1;
  for (const [yf, dir] of [[W2 + 0.03, 1], [-W2 - 0.03, -1]]) {
    for (let i = 0; i < nv; i++) {
      const p = (k) => {
        const t = Math.PI * (1 - k / nv);
        const x = Math.cos(t) * a, z = spring + (crown - spring) * Math.sin(t);
        const nx = Math.cos(t) / a, nz = Math.sin(t) / (crown - spring);
        const l = Math.hypot(nx, nz);
        return [x, z, nx / l, nz / l];
      };
      const [xa, za, na, ma] = p(i), [xb, zb, nb, mb] = p(i + 1);
      const d = 0.42 * (i % 2 ? 1 : 1.15);
      const A = [xa, yf, za], B = [xb, yf, zb], C = [xb + nb * d, yf, zb + mb * d], D = [xa + na * d, yf, za + ma * d];
      const col = sh(vous, 0.88 + r() * 0.2);
      const g = 0.02;
      const A2 = [lerp(A[0], B[0], g), yf, lerp(A[2], B[2], g)], B2 = [lerp(B[0], A[0], g), yf, lerp(B[2], A[2], g)];
      const D2 = [lerp(D[0], C[0], g), yf, lerp(D[2], C[2], g)], C2 = [lerp(C[0], D[0], g), yf, lerp(C[2], D[2], g)];
      if (dir > 0) b.quad(B2, A2, D2, C2, col);
      else b.quad(A2, B2, C2, D2, col);
      // Its thickness, seen on the underside.
      const yi = yf - dir * 0.03;
      if (dir > 0) b.quad([A2[0], yi, A2[2]], [B2[0], yi, B2[2]], B2, A2, sh(col, 0.7));
      else b.quad([B2[0], yi, B2[2]], [A2[0], yi, A2[2]], A2, B2, sh(col, 0.7));
    }
  }
  // The arch's barrel underside.
  {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const xa = -a + (2 * a * i) / n, xb = -a + (2 * a * (i + 1)) / n;
      const col = sh(stoneCol(), 0.62);
      b.quad([xa, -W2, arch(xa)], [xb, -W2, arch(xb)], [xb, W2, arch(xb)], [xa, W2, arch(xa)], col);
    }
  }
  // Walkway: flagstones, with a slightly lighter, warmer tone.
  {
    const n = Math.round(length / 0.75), yi = W2 - wallT;
    const flag = ['#b9b09e', '#c4bba8', '#aea594', '#bdb5a5'].map(srgb);
    for (let i = 0; i < n; i++) {
      const xa = -L2 + (length * i) / n, xb = -L2 + (length * (i + 1)) / n;
      const split = r() < 0.5 ? 0 : (r() - 0.5) * yi;
      const pick = () => sh(flag[Math.floor(r() * flag.length)], 0.92 + r() * 0.12);
      const gap = 0.025;
      const qd = (ya, yb, c) => b.quad([xa + gap, ya, deck(xa + gap) + 0.01], [xb - gap, ya, deck(xb - gap) + 0.01], [xb - gap, yb, deck(xb - gap) + 0.01], [xa + gap, yb, deck(xa + gap) + 0.01], c);
      if (split) {
        qd(-yi, split - gap, pick());
        qd(split + gap, yi, pick());
      } else qd(-yi, yi, pick());
      b.quad([xa, -yi, deck(xa)], [xb, -yi, deck(xb)], [xb, yi, deck(xb)], [xa, yi, deck(xa)], mortar);
    }
  }
  // Coping stones along the top of each parapet, overhanging a little.
  {
    const cop = ['#cfc7b6', '#c6bead', '#d6cfbf'].map(srgb);
    for (const s of [-1, 1]) {
      const yo = s * (W2 + 0.06), yi = s * (W2 - wallT - 0.06);
      const n = Math.round(length / 0.9);
      for (let i = 0; i < n; i++) {
        const xa = -L2 + (length * i) / n + 0.015, xb = -L2 + (length * (i + 1)) / n - 0.015;
        const za = top(xa), zb = top(xb), h = 0.13;
        const col = sh(cop[i % 3], 0.94 + r() * 0.1);
        const [y0, y1] = s > 0 ? [yi, yo] : [yo, yi];
        b.quad([xa, y0, za + h], [xb, y0, zb + h], [xb, y1, zb + h], [xa, y1, za + h], col);
        b.quad([xa, y1, za], [xb, y1, zb], [xb, y1, zb + h], [xa, y1, za + h], sh(col, 0.85));
        b.quad([xb, y0, zb], [xa, y0, za], [xa, y0, za + h], [xb, y0, zb + h], sh(col, 0.85));
        if (i === 0) b.quad([xa, y0, za], [xa, y1, za], [xa, y1, za + h], [xa, y0, za + h], sh(col, 0.8));
        if (i === n - 1) b.quad([xb, y1, zb], [xb, y0, zb], [xb, y0, zb + h], [xb, y1, zb + h], sh(col, 0.8));
      }
      // Wall ends.
      for (const e of [-1, 1]) {
        const x = e * L2, z0 = -0.2, z1 = top(x);
        const [ya, yb] = (s > 0) === (e > 0) ? [W2 - wallT, W2] : [W2, W2 - wallT];
        b.quad([x, s * ya, z0], [x, s * yb, z0], [x, s * yb, z1], [x, s * ya, z1], sh(stoneCol(), 0.85));
      }
    }
  }
  const g = b.geometry(T);
  g.userData.deckHeight = deck; // walkway height along x, for placing players/carts
  return g;
}

// ---------- the big manual scoreboard ----------
// Faces +y, centred on x = 0, standing on z = 0. About 12 × 6 yd.

export function makeLeaderboard(T, { width = 12, height = 6, rows = 10, cols = 18, seed = 5 } = {}) {
  const b = new PB(), r = rand(seed);
  const white = srgb('#f4f4ee'), green = srgb('#145a32'), dgreen = srgb('#0f4527'), cell = srgb('#ffffff');
  // Laid out with names at -x, then mirrored so they read left to right
  // from the front (+y).
  const ink = srgb('#1a1a1a'), red = srgb('#c8102e'), grn = srgb('#1b6e3b'), slot = srgb('#e2e3dc');
  const W2 = width / 2, z0 = 1.6, z1 = height - 0.35, D = 0.45;
  // Posts and a cross beam, dark green.
  for (const x of [-W2 + 0.8, 0, W2 - 0.8]) b.box([x - 0.14, -0.14 - D * 0.5, 0], [x + 0.14, 0.14 - D * 0.5, z0 + 0.4], dgreen);
  // The board itself: white front, green sides and back.
  b.box([-W2, -D, z0], [W2, 0, z1], green, { skip: '+y' });
  b.quad([-W2, 0, z0], [W2, 0, z0], [W2, 0, z1], [-W2, 0, z1], white);
  // Roof overhang, sloping back.
  b.quad([-W2 - 0.25, 0.45, z1 + 0.12], [W2 + 0.25, 0.45, z1 + 0.12], [W2 + 0.25, -D - 0.2, z1 + 0.45], [-W2 - 0.25, -D - 0.2, z1 + 0.45], dgreen);
  b.quad([W2 + 0.25, 0.45, z1 + 0.12], [-W2 - 0.25, 0.45, z1 + 0.12], [-W2 - 0.25, 0.45, z1], [W2 + 0.25, 0.45, z1], green);
  b.quad([-W2 - 0.25, 0.45, z1 + 0.12], [-W2 - 0.25, -D - 0.2, z1 + 0.45], [-W2 - 0.25, -D - 0.2, z1 + 0.33], [-W2 - 0.25, 0.45, z1], sh(green, 0.8));
  b.quad([W2 + 0.25, -D - 0.2, z1 + 0.45], [W2 + 0.25, 0.45, z1 + 0.12], [W2 + 0.25, 0.45, z1], [W2 + 0.25, -D - 0.2, z1 + 0.33], sh(green, 0.8));
  // Green trim round the face.
  const t = 0.12, f = 0.04;
  b.box([-W2, 0, z0], [W2, f, z0 + t], green);
  b.box([-W2, 0, z1 - t], [W2, f, z1], green);
  b.box([-W2, 0, z0], [-W2 + t, f, z1], green);
  b.box([W2 - t, 0, z0], [W2, f, z1], green);
  // Header band (green, white blocks standing in for lettering) and the row
  // of hole numbers.
  const hz0 = z1 - 0.75;
  b.quad([-W2 + t, 0.02, hz0], [W2 - t, 0.02, hz0], [W2 - t, 0.02, z1 - t], [-W2 + t, 0.02, z1 - t], green);
  {
    let x = -1.8;
    for (let i = 0; i < 9; i++) {
      const w = i === 4 ? 0.18 : 0.26 + r() * 0.08;
      if (i !== 4) b.quad([x, 0.03, hz0 + 0.18], [x + w, 0.03, hz0 + 0.18], [x + w, 0.03, hz0 + 0.5], [x, 0.03, hz0 + 0.5], white);
      x += w + 0.1;
    }
  }
  const nameW = width * 0.27, gx0 = -W2 + 0.3, gx1 = W2 - 0.3, cw = (gx1 - gx0 - nameW - 0.1) / cols;
  const gz1 = hz0 - 0.15, rh = (gz1 - z0 - 0.3) / (rows + 1);
  for (let row = 0; row <= rows; row++) {
    const zt = gz1 - row * rh, zb = zt - rh * 0.82;
    if (row === 0) {
      // Hole numbers: small dark marks above each column.
      for (let c = 0; c < cols; c++) {
        const x = gx0 + nameW + 0.1 + c * cw;
        b.quad([x + cw * 0.3, 0.02, zb + rh * 0.2], [x + cw * 0.7, 0.02, zb + rh * 0.2], [x + cw * 0.7, 0.02, zt - rh * 0.1], [x + cw * 0.3, 0.02, zt - rh * 0.1], ink);
      }
      continue;
    }
    // Name slot with a few "letters", then a score card per hole.
    b.quad([gx0, 0.02, zb], [gx0 + nameW, 0.02, zb], [gx0 + nameW, 0.02, zt], [gx0, 0.02, zt], slot);
    {
      let x = gx0 + 0.12;
      const words = 2 + Math.floor(r() * 2);
      for (let w = 0; w < words && x < gx0 + nameW - 0.4; w++) {
        const len = Math.min(gx0 + nameW - 0.1 - x, 0.4 + r() * 1.1);
        b.quad([x, 0.03, zb + rh * 0.18], [x + len, 0.03, zb + rh * 0.18], [x + len, 0.03, zt - rh * 0.18], [x, 0.03, zt - rh * 0.18], ink);
        x += len + 0.15;
      }
    }
    const played = Math.floor(cols * (0.4 + r() * 0.6));
    for (let c = 0; c < cols; c++) {
      const x = gx0 + nameW + 0.1 + c * cw;
      b.quad([x + 0.02, 0.02, zb], [x + cw - 0.02, 0.02, zb], [x + cw - 0.02, 0.02, zt], [x + 0.02, 0.02, zt], c < played ? cell : slot);
      if (c < played) {
        const ink2 = r() < 0.55 ? red : r() < 0.5 ? grn : ink;
        b.quad([x + cw * 0.3, 0.03, zb + rh * 0.15], [x + cw * 0.7, 0.03, zb + rh * 0.15], [x + cw * 0.7, 0.03, zt - rh * 0.15], [x + cw * 0.3, 0.03, zt - rh * 0.15], ink2);
      }
    }
  }
  b.mirrorX();
  return b.geometry(T);
}

// ---------- clubhouse ----------
// White antebellum house with two-storey verandas, dark roof and a cupola.
// Front faces +y; footprint about 40 × 20 yd centred on the origin.

export function makeClubhouse(T, { seed = 9 } = {}) {
  const b = new PB(), r = rand(seed);
  const white = srgb('#f3f1ea'), trim = srgb('#ffffff'), roof = srgb('#2f3a36'), win = srgb('#2a3440'), shut = srgb('#1f4a32');
  const floorC = srgb('#c9c3b5'), chimney = srgb('#e8e4da'), shadowW = srgb('#d8d5cc');
  const W = 30, D = 13, H1 = 4.3, H2 = 8.6, x0 = -W / 2, y0 = -D / 2 - 2;
  // Main block.
  b.box([x0, y0, 0], [x0 + W, y0 + D, H2 + 0.6], white, { skip: '-z' });
  // Wings either side, a storey lower.
  for (const s of [-1, 1]) {
    const xa = s < 0 ? x0 - 6 : x0 + W, xb = s < 0 ? x0 : x0 + W + 6;
    b.box([xa, y0 + 1, 0], [xb, y0 + D - 2, H1 + 1.2], white, { skip: '-z' });
    // Wing roof: low hip.
    const za = H1 + 1.2, zt = za + 1.6;
    const A = [xa - 0.3, y0 + 0.7, za], B = [xb + 0.3, y0 + 0.7, za], C = [xb + 0.3, y0 + D - 1.7, za], Dd = [xa - 0.3, y0 + D - 1.7, za];
    const ra = [xa + 2, y0 + D / 2 - 0.5, zt], rb = [xb - 2, y0 + D / 2 - 0.5, zt];
    b.quad(Dd, C, rb, ra, roof);
    b.quad(B, A, ra, rb, sh(roof, 0.8));
    b.tri(A, Dd, ra, sh(roof, 0.9));
    b.tri(C, B, rb, sh(roof, 0.9));
  }
  // Main hip roof.
  {
    const z = H2 + 0.6, zt = z + 3.4, o = 0.5;
    const A = [x0 - o, y0 - o, z], B = [x0 + W + o, y0 - o, z], C = [x0 + W + o, y0 + D + o, z], Dd = [x0 - o, y0 + D + o, z];
    const ra = [x0 + 5, y0 + D / 2, zt], rb = [x0 + W - 5, y0 + D / 2, zt];
    b.quad(Dd, C, rb, ra, roof);
    b.quad(B, A, ra, rb, sh(roof, 0.75));
    b.tri(A, Dd, ra, sh(roof, 0.9));
    b.tri(C, B, rb, sh(roof, 0.9));
    // Eaves fascia.
    b.quad([x0 - o, y0 + D + o, z - 0.35], [x0 + W + o, y0 + D + o, z - 0.35], C, Dd, trim);
    // Chimneys.
    for (const cx of [x0 + 6, x0 + W - 6]) b.box([cx - 0.6, y0 + D / 2 - 0.6, z], [cx + 0.6, y0 + D / 2 + 0.6, zt + 1.4], chimney);
    // Cupola: white lantern with windows, dark cap and a finial.
    const cz = zt - 0.2, cs = 1.6;
    b.box([-cs, y0 + D / 2 - cs, cz], [cs, y0 + D / 2 + cs, cz + 2.4], white);
    for (const [nx, ny] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      for (const k of [-0.6, 0.6]) {
        const c = [nx * (cs + 0.01) + (ny ? k : 0), y0 + D / 2 + ny * (cs + 0.01) + (nx ? k : 0), cz + 0.6];
        const t = ny ? [1, 0, 0] : [0, 1, 0];
        const n2 = [nx, ny, 0];
        const P = (u, v) => [c[0] + t[0] * u, c[1] + t[1] * u, c[2] + v];
        const q = [P(-0.3, 0), P(0.3, 0), P(0.3, 1.3), P(-0.3, 1.3)];
        if (cross(sub(q[1], q[0]), sub(q[2], q[0]))[0] * n2[0] + cross(sub(q[1], q[0]), sub(q[2], q[0]))[1] * n2[1] > 0) b.quad(...q, win);
        else b.quad(q[1], q[0], q[3], q[2], win);
      }
    }
    const cap = cz + 2.4, ctop = cap + 1.5, cc = [0, y0 + D / 2];
    const pts = [[-cs - 0.25, -cs - 0.25], [cs + 0.25, -cs - 0.25], [cs + 0.25, cs + 0.25], [-cs - 0.25, cs + 0.25]].map(([x, y]) => [cc[0] + x, cc[1] + y, cap]);
    for (let i = 0; i < 4; i++) b.tri(pts[i], pts[(i + 1) % 4], [cc[0], cc[1], ctop], sh(roof, 0.85 + 0.1 * (i % 2)));
    b.prism([cc[0], cc[1], ctop - 0.1], [cc[0], cc[1], ctop + 1.2], 0.06, 0.02, 4, trim);
  }
  // Windows with dark green shutters on the front and back, two storeys.
  const windows = (yf, dir) => {
    for (const zc of [1.2, H1 + 1.1]) {
      for (let x = x0 + 2; x < x0 + W - 1; x += 2.6) {
        const P = (u, v, d = 0) => [x + u, yf + dir * (0.02 + d), zc + v];
        const qd = (a, b2, c, d2, col) => (dir > 0 ? b.quad(a, b2, c, d2, col) : b.quad(b2, a, d2, c, col));
        if (Math.abs(x) < 1.3 && zc < 2) {
          // Front door.
          qd(P(-0.7, -1.2), P(0.7, -1.2), P(0.7, 1.6), P(-0.7, 1.6), shut);
          continue;
        }
        qd(P(-0.55, 0), P(0.55, 0), P(0.55, 2.0), P(-0.55, 2.0), win);
        // Mullions.
        qd(P(-0.03, 0, 0.01), P(0.03, 0, 0.01), P(0.03, 2, 0.01), P(-0.03, 2, 0.01), trim);
        qd(P(-0.55, 0.97, 0.01), P(0.55, 0.97, 0.01), P(0.55, 1.03, 0.01), P(-0.55, 1.03, 0.01), trim);
        for (const s of [-1, 1]) qd(P(s > 0 ? 0.62 : -1.1, 0, 0.02), P(s > 0 ? 1.1 : -0.62, 0, 0.02), P(s > 0 ? 1.1 : -0.62, 2.0, 0.02), P(s > 0 ? 0.62 : -1.1, 2.0, 0.02), shut);
      }
    }
  };
  windows(y0 + D, 1);
  windows(y0, -1);
  // Front veranda: two floors on slender columns, railings upstairs.
  {
    const vy0 = y0 + D, vy1 = vy0 + 3.4, vx0 = x0 - 0.5, vx1 = x0 + W + 0.5;
    b.box([vx0, vy0, 0], [vx1, vy1, 0.5], floorC, { top: floorC });
    // Steps.
    for (let i = 0; i < 3; i++) b.box([-2.5, vy1 + i * 0.35, 0], [2.5, vy1 + 0.35 + i * 0.35, 0.5 - (i + 1) * 0.15], floorC);
    b.box([vx0, vy0, H1], [vx1, vy1 + 0.1, H1 + 0.35], trim, { top: floorC });
    // Roof over the veranda, a shallow lean-to.
    b.quad([vx0 - 0.2, vy1 + 0.4, H2 + 0.1], [vx1 + 0.2, vy1 + 0.4, H2 + 0.1], [vx1 + 0.2, vy0, H2 + 0.75], [vx0 - 0.2, vy0, H2 + 0.75], sh(roof, 1.1));
    b.quad([vx1 + 0.2, vy1 + 0.4, H2 + 0.1], [vx0 - 0.2, vy1 + 0.4, H2 + 0.1], [vx0 - 0.2, vy1 + 0.4, H2 - 0.3], [vx1 + 0.2, vy1 + 0.4, H2 - 0.3], trim);
    b.quad([vx0 - 0.2, vy1 + 0.4, H2 - 0.3], [vx1 + 0.2, vy1 + 0.4, H2 - 0.3], [vx1 + 0.2, vy0, H2 - 0.3], [vx0 - 0.2, vy0, H2 - 0.3], shadowW);
    const n = 13;
    for (let i = 0; i < n; i++) {
      const x = lerp(vx0 + 0.3, vx1 - 0.3, i / (n - 1)), y = vy1 - 0.25;
      b.prism([x, y, 0.5], [x, y, H1], 0.17, 0.14, 6, trim, trim);
      b.prism([x, y, H1 + 0.35], [x, y, H2 - 0.3], 0.15, 0.12, 6, trim, trim);
    }
    // Railing upstairs: top rail + a pale balustrade band.
    b.box([vx0, vy1 - 0.3, H1 + 0.35], [vx1, vy1 - 0.2, H1 + 1.25], shadowW, { skip: '-z' });
    b.box([vx0, vy1 - 0.34, H1 + 1.2], [vx1, vy1 - 0.16, H1 + 1.32], trim);
  }
  // Side windows on the main block.
  for (const s of [-1, 1]) {
    const xf = s < 0 ? x0 : x0 + W;
    for (const zc of [H1 + 1.1]) {
      for (let y = y0 + 2; y < y0 + D - 1; y += 3) {
        const P = (u, v) => [xf + s * 0.02, y + u, zc + v];
        if (s > 0) b.quad(P(0.55, 0), P(-0.55, 0), P(-0.55, 2), P(0.55, 2), win);
        else b.quad(P(-0.55, 0), P(0.55, 0), P(0.55, 2), P(-0.55, 2), win);
      }
    }
  }
  return b.geometry(T);
}

// ---------- TV camera tower ----------
// Scaffold with a platform, green wind skirt, a roof, camera and operator.
// Centred on the origin, camera looking along +y.

export function makeCameraTower(T, { height = 10, size = 2.4 } = {}) {
  const b = new PB();
  const steel = srgb('#9aa0a4'), dsteel = srgb('#6c7276'), skirt = srgb('#1d4d2f'), plank = srgb('#8a7454'), roofC = srgb('#2d3133');
  const s2 = size / 2, H = height;
  const corners = [[-s2, -s2], [s2, -s2], [s2, s2], [-s2, s2]];
  for (const [x, y] of corners) b.prism([x, y, 0], [x, y, H + 2.2], 0.05, 0.05, 4, steel, steel);
  const levels = Math.max(2, Math.round(H / 2));
  for (let l = 1; l <= levels; l++) {
    const z = (H * l) / levels, zp = (H * (l - 1)) / levels;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
      b.prism([ax, ay, z], [bx, by, z], 0.035, 0.035, 3, dsteel);
      // Diagonal bracing, alternating direction.
      if (l % 2) b.prism([ax, ay, zp], [bx, by, z], 0.025, 0.025, 3, dsteel);
      else b.prism([bx, by, zp], [ax, ay, z], 0.025, 0.025, 3, dsteel);
    }
  }
  // Platform deck (overhanging) with a green skirt around the rail.
  const o = 0.35;
  b.box([-s2 - o, -s2 - o, H - 0.12], [s2 + o, s2 + o, H], plank);
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i].map((v) => v * (1 + (2 * o) / size)), [bx, by] = corners[(i + 1) % 4].map((v) => v * (1 + (2 * o) / size));
    b.quad([ax, ay, H - 0.12], [bx, by, H - 0.12], [bx, by, H + 1.0], [ax, ay, H + 1.0], skirt);
    b.quad([bx, by, H - 0.12], [ax, ay, H - 0.12], [ax, ay, H + 1.0], [bx, by, H + 1.0], sh(skirt, 0.7));
  }
  // Roof.
  b.box([-s2 - o - 0.2, -s2 - o - 0.2, H + 2.2], [s2 + o + 0.2, s2 + o + 0.2, H + 2.32], roofC);
  // Camera on a tripod head, and its operator (standing, palette-dressed).
  b.box([-0.18, 0.1, H + 1.05], [0.18, 0.75, H + 1.45], srgb('#2a2a2a'));
  b.prism([0, 0.75, H + 1.25], [0, 1.15, H + 1.25], 0.13, 0.15, 6, srgb('#151515'), srgb('#151515'), { cap1: true });
  b.prism([0, 0.4, H], [0, 0.4, H + 1.05], 0.05, 0.05, 4, srgb('#333333'));
  const op = patronStand(1).transform((p, n) => [[p[0] + 0.15, p[1] - 0.45, p[2] + H], n]);
  b.merge(op);
  return b.geometry(T);
}

// ---------- flagstick ----------
// A white pole with a plain yellow flag, standing in the cup at the origin.
// `pole` and `flag` are separate so the flag can flutter (its vertices
// carry x = distance from the pole in `uv.x`-free form: x along the flag).

export function makeCupFlag(T, { pole = 2.35, w = 0.6, h = 0.42 } = {}) {
  const pb = new PB(), fb = new PB();
  const white = srgb('#f6f6f2'), yellow = srgb('#f4d21c');
  pb.prism([0, 0, -0.1], [0, 0, pole], 0.014, 0.012, 6, white, white, { cap1: true });
  const n = 4;
  const L = [], R = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, y = Math.sin(t * Math.PI * 1.3) * 0.05 * t;
    L.push([t * w, y, pole - h - 0.02]);
    R.push([t * w, y, pole - 0.02]);
  }
  fb.strip(L, R, (i) => sh(yellow, 0.92 + 0.1 * (i % 2)));
  return { pole: pb.geometry(T), flag: fb.geometry(T), all: pb.merge(fb).geometry(T) };
}

// ---------- material ----------

const GLSL_PAL = (name, list) => `vec3 ${name}(float h) {
  ${list.map((c, i) => `if (h < ${((i + 1) / list.length).toFixed(4)}) return vec3(${srgb(c).map((v) => v.toFixed(4)).join(', ')});`).join('\n  ')}
  return vec3(1.0);
}`;
export const SHIRTS = ['#ffffff', '#f5f5f0', '#f7b6c8', '#9cc8ec', '#fbe58a', '#b8e08a', '#1f3a68', '#d7263d', '#c9b6e4', '#8fdcc2', '#ff9466', '#2e7d4f', '#ffffff', '#6fa8dc'];
export const TROUSERS = ['#c8b48a', '#d6c7a1', '#2b3a55', '#f2f0e8', '#7a7f86', '#5c6b4a', '#3a3a3c', '#bfae86'];
export const SKIN = ['#f1c7a5', '#e0ac85', '#c68b62', '#a26a45', '#7a4b2e', '#f3d2b8'];
export const HATS = ['#ffffff', '#f2efe6', '#d9c79c', '#1e5a35', '#203a66', '#d4b06a', '#3b2a1e', '#1c1c1c', '#8a8a88', '#c9a25e'];

// One Lambert material for every prop. Two-sided (some props are single
// quads), vertex colours with the palette flags decoded per instance.
export function makePropMaterial(T) {
  const mat = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = [GLSL_PAL('palShirt', SHIRTS), GLSL_PAL('palTrousers', TROUSERS), GLSL_PAL('palSkin', SKIN), GLSL_PAL('palHat', HATS)].join('\n') +
      '\nfloat propHash(vec2 p, float k) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + k * 17.17) * 43758.5453); }\n' +
      sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
      {
        float pf = floor(color.r * 0.5 + 0.001);
        vec3 base = vec3(color.r - pf * 2.0, color.g, color.b);
        #ifdef USE_INSTANCING
          vec2 ip = instanceMatrix[3].xy;
        #else
          vec2 ip = modelMatrix[3].xy;
        #endif
        vec3 pal = vec3(1.0);
        if (pf > 0.5 && pf < 1.5) {
          #ifdef USE_INSTANCING_COLOR
            pal = instanceColor;
          #else
            pal = palShirt(propHash(ip, 1.0));
          #endif
        } else if (pf > 1.5 && pf < 2.5) pal = palTrousers(propHash(ip, 2.0));
        else if (pf > 2.5 && pf < 3.5) pal = palSkin(propHash(ip, 3.0));
        else if (pf > 3.5) pal = palHat(propHash(ip, 4.0));
        vColor.rgb = base * pal;
      }`);
  };
  mat.customProgramCacheKey = () => 'pl-prop';
  return mat;
}

// ---------- everything ----------

export function makeProps(T) {
  const geo = (b) => b.geometry(T);
  const flag = makeCupFlag(T);
  return {
    patron: { stand: geo(patronStand(0)), stand2: geo(patronStand(1)), stand3: geo(patronStand(2)), sit: geo(patronSit()) },
    chair: geo(chair()),
    ropeStake: geo(stake()),
    makeRopeLine: (pts, opts) => makeRopeLine(T, pts, opts),
    stoneBridge: makeStoneBridge(T, {}),
    makeStoneBridge: (opts) => makeStoneBridge(T, opts),
    leaderboard: makeLeaderboard(T, {}),
    clubhouse: makeClubhouse(T, {}),
    cameraTower: makeCameraTower(T, {}),
    makeCameraTower: (opts) => makeCameraTower(T, opts),
    cupFlag: flag,
  };
}
