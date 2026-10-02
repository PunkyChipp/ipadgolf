// Stylised trees, bushes and grass for the 3D view. Everything is built in
// code (no model files): soft lumpy canopies with leaf cards around the
// edge, jagged pine tiers, palm fronds, and a field of grass blades that
// follows the camera. Three.js is passed in, as it is loaded on demand.

const TAU = Math.PI * 2;

function rand(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function noise3(seed) {
  const h = (x, y, z) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
    return n - Math.floor(n);
  };
  const sm = (t) => t * t * (3 - 2 * t);
  const l = (a, b, t) => a + (b - a) * t;
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
    return l(
      l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
      w,
    );
  };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------- leaf atlas ----------
// Four slots side by side: broad leaves, pine needles, a palm frond, solid.
const SLOTS = 4;
const slotUV = (slot, u, v) => [(slot + 0.03 + u * 0.94) / SLOTS, 0.03 + v * 0.94];

export function paintAtlas() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S * SLOTS;
  cv.height = S;
  const c = cv.getContext('2d');
  const r = rand(7);
  const grey = (g, a = 1) => `rgba(${g},${g},${g},${a})`;

  // 0: a spray of broad leaves, darker underneath, lighter on top.
  c.save();
  c.translate(S / 2, S / 2);
  const leaves = [];
  for (let i = 0; i < 34; i++) {
    const a = r() * TAU, d = Math.sqrt(r()) * S * 0.34;
    leaves.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, rot: a + (r() - 0.5) * 1.1, d });
  }
  leaves.sort((p, q) => q.d - p.d);
  for (const f of leaves) {
    const L = S * (0.12 + r() * 0.06), W = L * 0.52;
    const g = Math.round(205 + (1 - f.d / (S * 0.34)) * 30 + r() * 20);
    c.save();
    c.translate(f.x, f.y);
    c.rotate(f.rot);
    c.fillStyle = grey(Math.min(255, g));
    c.beginPath();
    c.moveTo(-L * 0.5, 0);
    c.quadraticCurveTo(0, -W, L * 0.5, 0);
    c.quadraticCurveTo(0, W, -L * 0.5, 0);
    c.fill();
    c.strokeStyle = grey(255, 0.3);
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(-L * 0.42, 0);
    c.lineTo(L * 0.42, 0);
    c.stroke();
    c.restore();
  }
  c.restore();

  // 1: a hanging tuft of needles, fixed along the top edge.
  c.save();
  c.translate(S, 0);
  c.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const x0 = S / 2 + (r() - 0.5) * S * 0.55, y0 = S * 0.06 + r() * S * 0.08;
    const a = (r() - 0.5) * 1.5, len = S * (0.45 + r() * 0.42);
    c.strokeStyle = grey(Math.round(200 + r() * 55));
    c.lineWidth = 2.2 + r() * 2;
    c.beginPath();
    c.moveTo(x0, y0);
    c.quadraticCurveTo(x0 + Math.sin(a) * len * 0.6, y0 + len * 0.5, x0 + Math.sin(a) * len, y0 + Math.cos(a) * len * 0.92);
    c.stroke();
  }
  c.restore();

  // 2: a palm frond: base at the bottom, tip at the top.
  c.save();
  c.translate(S * 2, 0);
  c.lineCap = 'round';
  for (let t = 0.02; t < 0.97; t += 0.028) {
    const y = S * (0.97 - t * 0.94);
    const len = S * 0.47 * Math.pow(1 - t, 0.55) * Math.min(1, 0.35 + t * 5);
    for (const side of [-1, 1]) {
      c.strokeStyle = grey(Math.round(205 + r() * 50));
      c.lineWidth = 6 * (1 - t * 0.6);
      c.beginPath();
      c.moveTo(S / 2, y);
      c.quadraticCurveTo(S / 2 + side * len * 0.5, y - len * 0.08, S / 2 + side * len, y + len * 0.42);
      c.stroke();
    }
  }
  c.strokeStyle = grey(215);
  c.lineWidth = 7;
  c.beginPath();
  c.moveTo(S / 2, S * 0.99);
  c.lineTo(S / 2, S * 0.03);
  c.stroke();
  c.restore();

  // 3: solid, for the canopy bodies.
  c.fillStyle = '#fff';
  c.fillRect(S * 3, 0, S, S);
  return cv;
}

// ---------- geometry helpers ----------

class Builder {
  constructor() {
    this.P = [];
    this.N = [];
    this.C = [];
    this.U = [];
  }
  vert(p, n, c, uv) {
    this.P.push(p[0], p[1], p[2]);
    this.N.push(n[0], n[1], n[2]);
    this.C.push(c[0], c[1], c[2]);
    this.U.push(uv[0], uv[1]);
  }
  quad(c, t1, t2, s, n, col, slot, hang = false) {
    // A card centred on c (or hung from c when `hang`), spanning t1 × t2.
    const o = hang ? 0 : 0.5;
    const corner = (a, b) => [
      c[0] + t1[0] * s * (a - 0.5) + t2[0] * s * (b - o),
      c[1] + t1[1] * s * (a - 0.5) + t2[1] * s * (b - o),
      c[2] + t1[2] * s * (a - 0.5) + t2[2] * s * (b - o),
    ];
    // With `hang`, t2 points down from the fixed top edge (v = 1).
    const uv = (a, b) => slotUV(slot, a, hang ? 1 - b : b);
    const q = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
    for (const [a, b] of q) this.cardVert(corner(a, b), n, col, uv(a, b));
  }
  // Cut-out leaf geometry is kept apart from the solid bodies: the GPU can
  // skip hidden pixels of opaque surfaces, but not of alpha-tested ones.
  cardVert(p, n, c, uv) {
    (this.cards = this.cards || new Builder()).vert(p, n, c, uv);
  }
  cardGeometry(T) {
    return this.cards ? this.cards.geometry(T) : null;
  }
  geometry(T) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.C, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.U, 2));
    g.computeBoundingSphere();
    return g;
  }
}

// A soft canopy made of lumpy blobs. Clusters are [r, x, y, z, sx, sy, sz]
// with the tree normalised to height 1, z up.
function canopy(T, spec, b = new Builder()) {
  const { clusters, detail = 2, lump = 0.22, cards = 0, cardSize = 0.16, slot = 0, seed = 1, tint = 1, hang = false } = spec;
  const n3 = noise3(seed), r = rand(seed * 7 + 1);
  const K = clusters.map(([rr, x, y, z, sx = 1, sy = 1, sz = 1]) => ({ rr, x, y, z, sx, sy, sz }));
  let w = 0, cx = 0, cy = 0, cz = 0;
  for (const k of K) {
    const m = k.rr ** 3;
    w += m;
    cx += k.x * m;
    cy += k.y * m;
    cz += k.z * m;
  }
  cx /= w;
  cy /= w;
  cz /= w;
  let zMin = Infinity, zMax = -Infinity, rMax = 0;
  for (const k of K) {
    zMin = Math.min(zMin, k.z - k.rr * k.sz);
    zMax = Math.max(zMax, k.z + k.rr * k.sz);
    rMax = Math.max(rMax, Math.hypot(k.x - cx, k.y - cy, k.z - cz) + k.rr * Math.max(k.sx, k.sy, k.sz));
  }
  const shade = (p, extra = 1) => {
    const h = clamp01((p[2] - zMin) / (zMax - zMin));
    const rad = clamp01(Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) / rMax);
    const ao = (0.36 + 0.44 * h + 0.3 * rad * rad) * tint * extra;
    // Cool in the shade underneath, warm where the sun catches the top.
    return [ao * (0.9 + 0.14 * h), ao, ao * (1.04 - 0.18 * h)];
  };
  const sphN = (p) => norm([p[0] - cx, p[1] - cy, (p[2] - cz) * 1.3]);
  const surf = (k, d) => {
    const s = 1 + lump * (n3(d[0] * 1.9 + k.x * 5, d[1] * 1.9 + k.y * 5, d[2] * 1.9 + k.z * 5) - 0.5) * 2;
    return [k.x + d[0] * k.rr * k.sx * s, k.y + d[1] * k.rr * k.sy * s, k.z + d[2] * k.rr * k.sz * s];
  };
  const solid = slotUV(3, 0.5, 0.5);
  for (const k of K) {
    const g = new T.IcosahedronGeometry(1, detail);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const d = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const p = surf(k, d);
      const s = sphN(p);
      b.vert(p, norm([s[0] * 0.65 + d[0] * 0.35, s[1] * 0.65 + d[1] * 0.35, s[2] * 0.65 + d[2] * 0.35]), shade(p), solid);
    }
    g.dispose();
  }
  // Leaf cards poking out of the surface break up the blobby outline.
  const inside = (p, skip) =>
    K.some((k, i) => i !== skip && ((p[0] - k.x) / (k.rr * k.sx)) ** 2 + ((p[1] - k.y) / (k.rr * k.sy)) ** 2 + ((p[2] - k.z) / (k.rr * k.sz)) ** 2 < 0.75);
  const area = K.map((k) => k.rr * k.rr * k.sx * Math.max(k.sy, k.sz));
  const total = area.reduce((a, v) => a + v, 0);
  let made = 0;
  for (let tries = 0; made < cards && tries < cards * 30; tries++) {
    let pick = r() * total, ki = 0;
    while (pick > area[ki] && ki < K.length - 1) pick -= area[ki++];
    const k = K[ki];
    let d;
    do d = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
    while (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] > 1);
    d = norm(d);
    if (d[2] < -0.45 && r() < 0.75) continue;
    const p = surf(k, d);
    if (inside(p, ki)) continue;
    const s = cardSize * (0.75 + r() * 0.55);
    const sn = sphN(p);
    const o = norm([d[0] * 0.5 + sn[0] * 0.5 + (r() - 0.5) * 0.7, d[1] * 0.5 + sn[1] * 0.5 + (r() - 0.5) * 0.7, d[2] * 0.5 + sn[2] * 0.5 + (r() - 0.5) * 0.7]);
    let t1, t2;
    if (hang) {
      const down = [-o[0] * o[2], -o[1] * o[2], -1 + o[2] * o[2]];
      t2 = norm(Math.hypot(...down) < 0.1 ? [1, 0, 0] : down);
      t1 = norm(cross(t2, o));
    } else {
      const a = norm(Math.abs(o[2]) > 0.95 ? cross(o, [1, 0, 0]) : cross(o, [0, 0, 1]));
      const bb = cross(o, a), roll = r() * TAU;
      t1 = norm([a[0] * Math.cos(roll) + bb[0] * Math.sin(roll), a[1] * Math.cos(roll) + bb[1] * Math.sin(roll), a[2] * Math.cos(roll) + bb[2] * Math.sin(roll)]);
      t2 = norm(cross(o, t1));
    }
    const c = hang ? [p[0] + sn[0] * s * 0.08, p[1] + sn[1] * s * 0.08, p[2] + s * 0.12] : [p[0] + o[0] * s * 0.16, p[1] + o[1] * s * 0.16, p[2] + o[2] * s * 0.16];
    b.quad(c, t1, t2, s, norm([sn[0] * 0.8 + o[0] * 0.2, sn[1] * 0.8 + o[1] * 0.2, sn[2] * 0.8 + o[2] * 0.2]), shade(p, 1.12 + r() * 0.14), slot, hang);
    made++;
  }
  return b;
}

// A pine: stacked tiers with jagged, drooping rims and hanging needle cards.
function pine(T, { tiers = 5, segs = 16, cards = 0, seed = 3 }) {
  const b = new Builder(), r = rand(seed);
  const solid = slotUV(3, 0.5, 0.5);
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const zb = 0.2 + t * 0.6, top = zb + 0.3 - t * 0.05, rb = 0.37 * (1 - t * 0.7);
    const rim = [];
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * TAU + i * 0.7;
      const out = s % 2 ? 0.76 : 1.06 + (r() - 0.5) * 0.1;
      rim.push({ a, p: [Math.cos(a) * rb * out, Math.sin(a) * rb * out, zb - (s % 2 ? 0 : 0.06)] });
    }
    rim[segs] = { a: rim[0].a + TAU, p: rim[0].p };
    const apex = [0, 0, top];
    const lit = 0.75 + t * 0.25;
    const nOf = (a, up) => norm([Math.cos(a), Math.sin(a), up]);
    for (let s = 0; s < segs; s++) {
      const A = rim[s], B = rim[s + 1], am = (A.a + B.a) / 2;
      b.vert(apex, nOf(am, 1.4), [lit * 1.05, lit * 1.08, lit * 0.92], solid);
      b.vert(A.p, nOf(A.a, 0.5), [lit * 0.55, lit * 0.6, lit * 0.62], solid);
      b.vert(B.p, nOf(B.a, 0.5), [lit * 0.55, lit * 0.6, lit * 0.62], solid);
      // The underside, dark and slightly hollow.
      const under = [0, 0, zb + 0.07];
      b.vert(A.p, nOf(A.a, -0.6), [0.32, 0.34, 0.38], solid);
      b.vert(under, [0, 0, -1], [0.22, 0.24, 0.28], solid);
      b.vert(B.p, nOf(B.a, -0.6), [0.32, 0.34, 0.38], solid);
    }
    const per = Math.round(cards / tiers * (1.3 - t * 0.6));
    for (let k = 0; k < per; k++) {
      const a = r() * TAU, f = 0.75 + r() * 0.3;
      const p = [Math.cos(a) * rb * f, Math.sin(a) * rb * f, zb + 0.02 + r() * 0.05];
      const o = norm([Math.cos(a), Math.sin(a), 0.25]);
      const t2 = norm([Math.cos(a) * 0.35, Math.sin(a) * 0.35, -1]);
      const t1 = norm(cross(t2, o));
      b.quad(p, t1, t2, 0.13 * (1 - t * 0.4) * (0.8 + r() * 0.4), nOf(a, 0.6), [lit * 0.9, lit * 0.95, lit * 0.85], 1, true);
    }
  }
  return b;
}

// Palm fronds (the trunk is separate).
function palmTop(T, { fronds = 11, seed = 5 }) {
  const b = new Builder(), r = rand(seed);
  const crown = [0.13, 0, 0.9];
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * TAU + r() * 0.3, len = 0.5 + r() * 0.12, lift = 0.25 - r() * 0.3;
    const dir = [Math.cos(a), Math.sin(a)];
    const seg = 8, w = 0.15;
    const pts = [];
    for (let k = 0; k <= seg; k++) {
      const f = k / seg;
      const along = f * len;
      pts.push([crown[0] + dir[0] * along, crown[1] + dir[1] * along, crown[2] + f * lift * len - f * f * 0.42 * len]);
    }
    for (let k = 0; k < seg; k++) {
      const f0 = k / seg, f1 = (k + 1) / seg;
      const side = [-dir[1] * w, dir[0] * w];
      const fold = 0.035;
      const P = (p, s, f) => [p[0] + side[0] * s, p[1] + side[1] * s, p[2] + fold * (1 - f)];
      const c0 = 0.62 + f0 * 0.45, c1 = 0.62 + f1 * 0.45;
      const v = (p, s, f, c) => b.cardVert(P(p, s, f), norm([-dir[0] * 0.25, -dir[1] * 0.25, 1]), [c, c * 1.02, c * 0.9], slotUV(2, (s + 1) / 2, f));
      v(pts[k], -1, f0, c0); v(pts[k], 1, f0, c0); v(pts[k + 1], 1, f1, c1);
      v(pts[k], -1, f0, c0); v(pts[k + 1], 1, f1, c1); v(pts[k + 1], -1, f1, c1);
    }
  }
  // Coconuts.
  canopy(T, { clusters: [[0.03, 0.15, 0.02, 0.86], [0.03, 0.11, -0.03, 0.87], [0.028, 0.13, 0.04, 0.84]], detail: 1, lump: 0.05, tint: 0.45 }, b);
  return b;
}

// Trunks with a slight bend and branches reaching into the canopy.
function trunk(T, { h = 0.55, r0 = 0.07, r1 = 0.04, branches = 3, bend = 0.04, seed = 9, sides = 7 }) {
  const r = rand(seed);
  const parts = [];
  const shadeBy = (g, z0, z1) => {
    const p = g.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const f = clamp01((p.getZ(i) - z0) / (z1 - z0));
      const c = 0.5 + 0.5 * f;
      col.push(c, c * 0.97, c * 0.94);
    }
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  };
  const main = new T.CylinderGeometry(r1, r0, h, sides, 2, true).rotateX(Math.PI / 2).translate(0, 0, h / 2);
  const p = main.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const f = p.getZ(i) / h;
    p.setX(i, p.getX(i) + bend * f * f);
    // Root flare.
    const flare = 1 + Math.max(0, 0.12 - f) * 3;
    p.setX(i, p.getX(i) * flare);
    p.setY(i, p.getY(i) * flare);
  }
  main.computeVertexNormals();
  parts.push(main);
  const up = new T.Vector3(0, 1, 0);
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * TAU + r() * 0.8;
    const dir = new T.Vector3(Math.cos(a) * 0.75, Math.sin(a) * 0.75, 0.75).normalize();
    const len = 0.2 + r() * 0.08;
    const g = new T.CylinderGeometry(r1 * 0.35, r1 * 0.75, len, 5, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(up, dir));
    g.translate(bend * 0.6, 0, h * (0.72 + r() * 0.15));
    parts.push(g);
  }
  const merged = T.mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  // Bark wraps twice round the trunk and repeats up its height.
  const uv = merged.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * h * 4);
  shadeBy(merged, 0, h + 0.2);
  return merged;
}

function palmTrunk(T) {
  const g = new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(0, 0, 0), new T.Vector3(0.05, 0, 0.45), new T.Vector3(0.13, 0, 0.9)]), 10, 0.028, 6).toNonIndexed();
  const p = g.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    // Ringed bark.
    const ring = 0.82 + 0.18 * Math.abs(Math.sin(z * 70));
    const c = (0.62 + 0.38 * clamp01(z / 0.9)) * ring;
    col.push(c, c * 0.95, c * 0.86);
  }
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 2, uv.getX(i) * 6);
  return g;
}

// ---------- Augusta trees ----------
// These are modelled at their true proportions (crown diameter = 1, height
// = the kind's `aspect`) and then squashed to height 1, so that instancing
// them with scale (width, width, height), height ≈ width × aspect, gives
// undistorted needles, leaves and blossoms.

// v += 2 × flag on vertices [from, to) of a builder (see makeTreeMaterials).
const FLAG = (b, flag, from = 0, to = b.U.length / 2) => {
  for (let i = from; i < to; i++) b.U[i * 2 + 1] += 2 * flag;
};
const vcount = (b) => (b ? b.P.length / 3 : 0);

function squash(g, A) {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setZ(i, p.getZ(i) / A);
    const v = norm([n.getX(i), n.getY(i), n.getZ(i) * A]);
    n.setXYZ(i, v[0], v[1], v[2]);
  }
  g.computeBoundingSphere();
  return g;
}

// A tube along a polyline: `rad(f)` radius and `col(f, ring point)` colour,
// f = 0..1 along it. Bark v runs along the length (`vs` repeats per unit).
function tube(b, pts, rad, sides, col, vs = 3, cap = false) {
  const n = pts.length;
  let len = 0;
  const rings = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
    const t = norm([c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    const u = norm(Math.abs(t[2]) < 0.9 ? cross(t, [0, 0, 1]) : cross(t, [1, 0, 0]));
    const w = cross(u, t);
    if (i) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    const f = i / (n - 1), r = rad(f);
    const ring = [];
    for (let s = 0; s <= sides; s++) {
      const a2 = (s / sides) * TAU;
      const d = [u[0] * Math.cos(a2) + w[0] * Math.sin(a2), u[1] * Math.cos(a2) + w[1] * Math.sin(a2), u[2] * Math.cos(a2) + w[2] * Math.sin(a2)];
      const p = [pts[i][0] + d[0] * r, pts[i][1] + d[1] * r, pts[i][2] + d[2] * r];
      ring.push({ p, n: d, uv: [s / sides, len * vs], c: col(f, p, d) });
    }
    rings.push(ring);
  }
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const A = rings[i][s], B = rings[i][s + 1], C = rings[i + 1][s + 1], D = rings[i + 1][s];
      for (const v of [A, B, C, A, C, D]) b.vert(v.p, v.n, v.c, v.uv);
    }
  }
  if (cap) {
    const last = rings[n - 1], tip = pts[n - 1];
    for (let s = 0; s < sides; s++) {
      for (const v of [last[s], last[s + 1]]) b.vert(v.p, v.n, v.c, v.uv);
      b.vert(tip, norm([tip[0] - pts[n - 2][0], tip[1] - pts[n - 2][1], tip[2] - pts[n - 2][2]]), last[s].c, last[s].uv);
    }
  }
}

const bez = (a, m, e, k) => {
  const out = [];
  for (let i = 0; i <= k; i++) {
    const t = i / k, u = 1 - t;
    out.push([0, 1, 2].map((j) => u * u * a[j] + 2 * u * t * m[j] + t * t * e[j]));
  }
  return out;
};

// Scatter cards over the upper surface of ellipsoid clusters, facing mostly
// up (blossoms) or outward. Clusters: [r, x, y, z, sx, sy, sz].
function scatterCards(b, clusters, { n, size, slot, up = 0.6, seed = 1, col, minZ = -0.3 }) {
  const r = rand(seed);
  const K = clusters.map(([rr, x, y, z, sx = 1, sy = 1, sz = 1]) => ({ rr, x, y, z, sx, sy, sz }));
  const area = K.map((k) => k.rr * k.rr * k.sx * k.sy);
  const total = area.reduce((a, v) => a + v, 0);
  const inside = (p, skip) =>
    K.some((k, i) => i !== skip && ((p[0] - k.x) / (k.rr * k.sx)) ** 2 + ((p[1] - k.y) / (k.rr * k.sy)) ** 2 + ((p[2] - k.z) / (k.rr * k.sz)) ** 2 < 0.7);
  let made = 0;
  for (let tries = 0; made < n && tries < n * 40; tries++) {
    let pick = r() * total, ki = 0;
    while (pick > area[ki] && ki < K.length - 1) pick -= area[ki++];
    const k = K[ki];
    let d;
    do d = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
    while (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] > 1);
    d = norm(d);
    if (d[2] < minZ) continue;
    const p = [k.x + d[0] * k.rr * k.sx * 0.95, k.y + d[1] * k.rr * k.sy * 0.95, k.z + d[2] * k.rr * k.sz * 0.95];
    if (inside(p, ki)) continue;
    const sn = norm([d[0] / k.sx, d[1] / k.sy, d[2] / k.sz]);
    const o = norm([sn[0] * (1 - up) + (r() - 0.5) * 0.5, sn[1] * (1 - up) + (r() - 0.5) * 0.5, sn[2] * (1 - up) + up + (r() - 0.5) * 0.3]);
    const a = norm(Math.abs(o[2]) > 0.95 ? cross(o, [1, 0, 0]) : cross(o, [0, 0, 1]));
    const bb = cross(o, a), roll = r() * TAU;
    const t1 = norm([a[0] * Math.cos(roll) + bb[0] * Math.sin(roll), a[1] * Math.cos(roll) + bb[1] * Math.sin(roll), a[2] * Math.cos(roll) + bb[2] * Math.sin(roll)]);
    const t2 = norm(cross(o, t1));
    const s = size * (0.75 + r() * 0.5);
    b.quad([p[0] + o[0] * s * 0.08, p[1] + o[1] * s * 0.08, p[2] + o[2] * s * 0.08], t1, t2, s, norm([sn[0] * 0.5 + o[0] * 0.5, sn[1] * 0.5 + o[1] * 0.5, sn[2] * 0.5 + o[2] * 0.5]), col(p, d, r), slot);
    made++;
  }
  return made;
}

// Recolour a builder's vertices: fn(p, n, c, i) returns [colour, flag] or null.
function repaint(b, from, fn) {
  for (let i = from; i < b.P.length / 3; i++) {
    const p = [b.P[i * 3], b.P[i * 3 + 1], b.P[i * 3 + 2]];
    const nn = [b.N[i * 3], b.N[i * 3 + 1], b.N[i * 3 + 2]];
    const c = [b.C[i * 3], b.C[i * 3 + 1], b.C[i * 3 + 2]];
    const res = fn(p, nn, c, i);
    if (!res) continue;
    b.C[i * 3] = res[0][0];
    b.C[i * 3 + 1] = res[0][1];
    b.C[i * 3 + 2] = res[0][2];
    if (res[1]) b.U[i * 2 + 1] += 2 * res[1];
  }
}

// Loblolly pine: tall straight bare trunk, high open crown of needle clumps
// on short up-curving limbs.
const LOB_A = 3.0;
function loblollyPlan(seed) {
  const r = rand(seed), A = LOB_A;
  const lean = [(r() - 0.5) * 0.04, (r() - 0.5) * 0.04];
  const axis = (z) => [lean[0] * (z / A) ** 2, lean[1] * (z / A) ** 2];
  const limbs = [], clusters = [];
  const nb = 8;
  for (let i = 0; i < nb; i++) {
    const t = i / (nb - 1);
    const z = A * (0.58 + t * 0.3) + (r() - 0.5) * 0.08;
    const a = i * 2.399 + r() * 0.8;
    const reach = (0.3 + r() * 0.14) * (1 - t * 0.55);
    const rise = 0.12 + r() * 0.16;
    const [ax, ay] = axis(z);
    const s = [ax, ay, z];
    const e = [ax + Math.cos(a) * reach, ay + Math.sin(a) * reach, z + rise];
    const m = [ax + Math.cos(a) * reach * 0.6, ay + Math.sin(a) * reach * 0.6, z + rise * 0.12];
    limbs.push({ s, m, e, r0: 0.012 * (1 - t * 0.4) });
    const rr = (0.15 + r() * 0.05) * (1 - t * 0.3);
    clusters.push([rr, e[0], e[1], e[2] + rr * 0.2, 1.1, 1.1, 0.95]);
    if (r() < 0.5 && t < 0.75) {
      const f = 0.5;
      clusters.push([rr * 0.7, ax + Math.cos(a + 0.35) * reach * f, ay + Math.sin(a + 0.35) * reach * f, z + rise * 0.3 + rr * 0.45, 1, 1, 0.95]);
    }
  }
  const [tx, ty] = axis(A * 0.95);
  clusters.push([0.14, tx, ty, A * 0.93, 1.05, 1.05, 0.95]);
  clusters.push([0.12, tx + 0.12, ty - 0.06, A * 0.86, 1.1, 1.1, 0.85]);
  return { A, axis, limbs, clusters, seed };
}

function loblollyTrunk(T, plan) {
  const { A, axis, limbs } = plan, r = rand(plan.seed + 3), n3 = noise3(plan.seed);
  const b = new Builder();
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const z = (i / 8) * A * 0.97;
    const [x, y] = axis(z);
    pts.push([x, y, z - (i ? 0 : 0.02)]);
  }
  const barkC = (f, p) => {
    const z = p[2] / A;
    const plate = 0.85 + 0.3 * n3(p[0] * 60, p[1] * 60, p[2] * 9);
    const lit = (0.8 + 0.35 * Math.min(1, z * 1.6)) * plate;
    // Near neutral (the bark texture carries the colour), a touch warmer
    // and brighter high up where the plates are thinner.
    const o = clamp01((z - 0.55) * 3);
    return [lit * (1.4 + o * 0.1), lit * (1.38 + o * 0.02), lit * (1.4 - o * 0.12)];
  };
  tube(b, pts, (f) => 0.033 * (1 - 0.8 * f) + Math.max(0, 0.04 - f) * 0.5, 7, barkC, 4.9);
  for (const L of limbs) tube(b, bez(L.s, L.m, L.e, 2), (f) => L.r0 * (1 - f * 0.7), 3, barkC, 6);
  // Dead stubs on the bare lower trunk.
  for (let i = 0; i < 6; i++) {
    const z = A * (0.28 + r() * 0.3), a = r() * TAU, [x, y] = axis(z);
    const len = 0.03 + r() * 0.05;
    tube(b, [[x, y, z], [x + Math.cos(a) * len, y + Math.sin(a) * len, z - len * 0.25]], (f) => 0.005 * (1 - f * 0.8), 3, () => [0.45, 0.38, 0.34], 8);
  }
  return squash(b.geometry(T), A);
}

// Bristly needle tufts (blossoms.png slot 2, base at the bottom) standing
// out of the clumps' surface, tips outward and upward.
function brushCards(b, clusters, { n, size, seed, slot = 2, up = 0.45, bright = 1.3 }) {
  const r = rand(seed);
  const K = clusters.map(([rr, x, y, z, sx = 1, sy = 1, sz = 1]) => ({ rr, x, y, z, sx, sy, sz }));
  const area = K.map((k) => k.rr * k.rr * k.sx * Math.max(k.sy, k.sz));
  const total = area.reduce((a, v) => a + v, 0);
  let zMin = Infinity, zMax = -Infinity;
  for (const k of K) {
    zMin = Math.min(zMin, k.z - k.rr * k.sz);
    zMax = Math.max(zMax, k.z + k.rr * k.sz);
  }
  const inside = (p, skip) =>
    K.some((k, i) => i !== skip && ((p[0] - k.x) / (k.rr * k.sx)) ** 2 + ((p[1] - k.y) / (k.rr * k.sy)) ** 2 + ((p[2] - k.z) / (k.rr * k.sz)) ** 2 < 0.8);
  let made = 0;
  for (let tries = 0; made < n && tries < n * 40; tries++) {
    let pick = r() * total, ki = 0;
    while (pick > area[ki] && ki < K.length - 1) pick -= area[ki++];
    const k = K[ki];
    let d;
    do d = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
    while (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] > 1);
    d = norm(d);
    if (d[2] < -0.5) continue;
    const p = [k.x + d[0] * k.rr * k.sx * 0.8, k.y + d[1] * k.rr * k.sy * 0.8, k.z + d[2] * k.rr * k.sz * 0.8];
    if (inside(p, ki)) continue;
    const sn = norm([d[0] / k.sx, d[1] / k.sy, d[2] / k.sz]);
    const o = norm([sn[0] + (r() - 0.5) * 0.6, sn[1] + (r() - 0.5) * 0.6, sn[2] * 0.7 + up + (r() - 0.5) * 0.4]);
    const s = size * (0.75 + r() * 0.5);
    const tip = [p[0] + o[0] * s * 0.85, p[1] + o[1] * s * 0.85, p[2] + o[2] * s * 0.85];
    const t2 = [-o[0], -o[1], -o[2]];
    const rnd = norm([r() - 0.5, r() - 0.5, r() - 0.5]);
    const t1 = norm(cross(o, Math.abs(rnd[0] * o[0] + rnd[1] * o[1] + rnd[2] * o[2]) > 0.9 ? [0, 0, 1] : rnd));
    const h = clamp01((p[2] - zMin) / (zMax - zMin));
    const l = (0.55 + 0.5 * h + 0.15 * Math.max(0, sn[2])) * bright * (0.9 + r() * 0.2);
    b.quad(tip, t1, t2, s, norm([sn[0] * 0.6 + o[0] * 0.4, sn[1] * 0.6 + o[1] * 0.4, sn[2] * 0.6 + o[2] * 0.4]), [l * 0.98, l, l * 0.92], slot, true);
    made++;
  }
}

function loblolly(T, plan, near) {
  const { A, clusters } = plan;
  // The solid core sits a little inside; the needle tufts make the outline.
  const core = clusters.map(([rr, ...rest]) => [rr * (near ? 0.82 : 1), ...rest]);
  const b = canopy(T, near
    ? { clusters: core, detail: 1, lump: 0.38, seed: plan.seed, tint: 0.85 }
    : { clusters: core, detail: 0, lump: 0.25, seed: plan.seed, tint: 0.85 });
  const out = { body: squash(b.geometry(T), A) };
  if (near) {
    const cb = new Builder();
    brushCards(cb, core, { n: 190, size: 0.18, seed: plan.seed + 1, bright: 1.15 });
    out.cards = squash(cb.cardGeometry(T), A);
  }
  return out;
}

// Flowering dogwood: low trunk forking into spreading limbs, layered flat
// sprays of leaves crowned with white (sometimes pink) bracts.
const DOG_A = 0.85;
function dogwoodPlan(seed) {
  const r = rand(seed);
  const clusters = [], limbs = [];
  const tiers = [[0.3, 0.3, 4, 0.15], [0.5, 0.22, 4, 0.14], [0.68, 0.11, 3, 0.12], [0.8, 0, 1, 0.1]];
  tiers.forEach(([z, rad, n, rr], ti) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + ti * 0.8 + r() * 0.5;
      const d = rad * (0.85 + r() * 0.3);
      const c = [Math.cos(a) * d, Math.sin(a) * d, z + (r() - 0.5) * 0.04];
      clusters.push([rr * (0.9 + r() * 0.2), c[0], c[1], c[2], 1.25, 1.25, 0.32]);
      if (n > 1) limbs.push({ s: [0, 0, 0.16 + ti * 0.05], m: [c[0] * 0.4, c[1] * 0.4, c[2] - 0.08], e: [c[0] * 0.95, c[1] * 0.95, c[2] - 0.02], r0: 0.016 - ti * 0.003 });
    }
  });
  return { A: DOG_A, clusters, limbs, seed };
}

function dogwoodTrunk(T, plan) {
  const b = new Builder();
  const c = (f, p) => {
    const l = 0.8 + 0.5 * clamp01(p[2] / 0.6);
    return [l * 1.2, l * 1.15, l * 1.12];
  };
  tube(b, [[0, 0, -0.02], [0.01, 0, 0.1], [0, 0.01, 0.2]], (f) => 0.03 - f * 0.008, 7, c, 3);
  for (const L of plan.limbs) tube(b, bez(L.s, L.m, L.e, 3), (f) => L.r0 * (1 - f * 0.75), 4, c, 5);
  return squash(b.geometry(T), plan.A);
}

function dogwood(T, plan, near) {
  const { A, clusters, seed } = plan;
  const n3 = noise3(seed + 5);
  const core = clusters.map(([rr, ...rest]) => [rr * (near ? 0.8 : 1), ...rest]);
  const b = canopy(T, { clusters: core, detail: near ? 1 : 0, lump: 0.35, seed, tint: 1.1 });
  // Bracts: white patches over the top of each layer (most of it far away).
  repaint(b, 0, (p, n, c) => {
    const w = n3(p[0] * 9, p[1] * 9, p[2] * 9) + n[2] * 0.35;
    if (w < (near ? 0.75 : 0.55)) return [[c[0] * 1.05, c[1] * 1.1, c[2] * 0.8], 0];
    const l = 0.75 + 0.3 * Math.max(0, n[2]);
    return [[l, l, l * 0.97], 2];
  });
  const out = { body: squash(b.geometry(T), A) };
  if (near) {
    const cb = new Builder();
    scatterCards(cb, clusters, { n: 150, size: 0.12, slot: 0, up: 0.7, seed: seed + 9, col: (p, d) => { const l = 0.85 + 0.2 * d[2]; return [l, l, l]; } });
    FLAG(cb.cards, 2);
    out.cards = squash(cb.cardGeometry(T), A);
  }
  return out;
}

// Southern magnolia: a dense, broad pyramid of glossy dark leaves, skirted
// right down to the ground.
const MAG_A = 1.45;
function magnoliaPlan(seed) {
  const r = rand(seed), A = MAG_A;
  // A broad cone: a core plus masses scattered over its surface, so the
  // outline is irregular but continuous, widest at the ground.
  const clusters = [[0.31, 0, 0, 0.42, 1, 1, 1.2], [0.2, 0, 0, 0.92, 1, 1, 1.4]];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n, z = 0.16 + f * 1.06;
    const rad = 0.34 * (1 - z / (A * 1.02)) + 0.03;
    const a = i * 2.4 + r() * 0.5;
    clusters.push([0.12 + 0.05 * (1 - f) + r() * 0.03, Math.cos(a) * rad, Math.sin(a) * rad, z, 1, 1, 1.1]);
  }
  clusters.push([0.08, 0.01, 0, 1.34, 1, 1, 1.3]);
  return { A, clusters, seed };
}

function magnolia(T, plan, near) {
  const { A, clusters, seed } = plan;
  const core = clusters.map(([rr, ...rest]) => [rr * (near ? 0.88 : 1), ...rest]);
  const b = canopy(T, near
    ? { clusters: core, detail: 1, lump: 0.18, seed, tint: 0.9 }
    : { clusters: core, detail: 0, lump: 0.15, seed, tint: 0.9 });
  const out = { body: squash(b.geometry(T), A) };
  if (near) {
    // Glossy leaf rosettes all over, facing outward.
    const cb = new Builder();
    scatterCards(cb, core, { n: 170, size: 0.26, slot: 3, up: 0.2, seed: seed + 4, minZ: -0.6, col: (p, d) => { const l = 1.0 + 0.4 * clamp01(p[2] / A) + 0.2 * d[2]; return [l, l, l * 0.95]; } });
    out.cards = squash(cb.cardGeometry(T), A);
  }
  return out;
}

function stubTrunk(T, A, h, r0) {
  const b = new Builder();
  tube(b, [[0, 0, -0.02], [0, 0, h * 0.5], [0.01, 0, h]], (f) => r0 * (1 - f * 0.5), 7, (f) => { const l = 0.5 + 0.4 * f; return [l * 0.8, l * 0.76, l * 0.72]; }, 3);
  return squash(b.geometry(T), A);
}

// The big live oak: huge, low and wide, with heavy near-horizontal limbs.
const BIGOAK_A = 0.55;
function bigOak(T) {
  const r = rand(77), A = BIGOAK_A;
  const clusters = [[0.2, 0, 0, 0.42, 1.2, 1.2, 0.6]];
  const limbs = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + r() * 0.4, d = 0.3 + r() * 0.08, z = 0.3 + r() * 0.08;
    const e = [Math.cos(a) * d, Math.sin(a) * d, z];
    limbs.push({ s: [0, 0, 0.12], m: [e[0] * 0.5, e[1] * 0.5, 0.2], e, r0: 0.03 });
    clusters.push([0.15 + r() * 0.03, e[0], e[1], e[2] + 0.05, 1.25, 1.25, 0.55]);
    clusters.push([0.11, e[0] * 0.55, e[1] * 0.55, e[2] + 0.12, 1.2, 1.2, 0.6]);
  }
  const mk = (near) => canopy(T, near
    ? { clusters, detail: 1, lump: 0.28, cards: 160, cardSize: 0.07, seed: 77, tint: 0.95 }
    : { clusters, detail: 0, lump: 0.18, seed: 77, tint: 0.95 });
  const nb = mk(true), fb = mk(false);
  const tb = new Builder();
  const c = (f, p) => { const l = 0.75 + 0.45 * clamp01(p[2] / 0.4); return [l * 1.15, l * 1.1, l * 1.05]; };
  tube(tb, [[0, 0, -0.02], [0, 0, 0.08], [0, 0, 0.16]], (f) => 0.055 - f * 0.012, 9, c, 2);
  for (const L of limbs) tube(tb, bez(L.s, L.m, L.e, 4), (f) => L.r0 * (1 - f * 0.65), 5, c, 3);
  return {
    nearBody: squash(nb.geometry(T), A), nearCards: squash(nb.cardGeometry(T), A),
    far: squash(fb.geometry(T), A), trunk: squash(tb.geometry(T), A), aspect: A,
  };
}

// Azalea: a mounded shrub smothered in blossom. Instance colour = blossom
// colour; the leaves (flag 1) keep their own dark green.
function azalea(T, seed = 51) {
  const n3 = noise3(seed);
  const clusters = [[0.5, 0, 0, 0.42, 1, 1, 0.85], [0.42, 0.38, 0.1, 0.36, 1, 1, 0.85], [0.4, -0.34, -0.12, 0.35, 1, 1, 0.85],
    [0.34, 0.05, 0.34, 0.32, 1, 1, 0.85], [0.32, -0.08, -0.36, 0.3, 1, 1, 0.85]];
  const mk = (detail) => {
    const b = canopy(T, { clusters, detail, lump: 0.22, seed, tint: 1 });
    repaint(b, 0, (p, n, c) => {
      const g = n3(p[0] * 5, p[1] * 5, p[2] * 5) - n[2] * 0.25;
      const l = c[1];
      if (g > 0.52 || p[2] < 0.08) return [[l * 0.07, l * 0.16, l * 0.06], 1];
      return [[l * 1.05, l * 1.05, l * 1.05], 0];
    });
    return b;
  };
  const near = mk(1), far = mk(0);
  const cb = new Builder();
  scatterCards(cb, clusters, { n: 46, size: 0.42, slot: 1, up: 0.35, seed: seed + 3, minZ: -0.2, col: (p, d) => { const l = 0.8 + 0.25 * d[2]; return [l, l, l]; } });
  return { body: near.geometry(T), cards: cb.cardGeometry(T), cardsMat: 'bloom', far: far.geometry(T) };
}

// All the Augusta kinds; merged into makeTrees()'s result.
export function makeAugustaTrees(T) {
  const kinds = {};
  const lp = loblollyPlan(101), ln = loblolly(T, lp, true), lf = loblolly(T, lp, false);
  kinds.loblolly = { nearBody: ln.body, nearCards: ln.cards, cardsMat: 'bloom', far: lf.body, trunk: loblollyTrunk(T, lp), aspect: LOB_A };
  const lp2 = loblollyPlan(202), ln2 = loblolly(T, lp2, true), lf2 = loblolly(T, lp2, false);
  kinds.loblolly2 = { nearBody: ln2.body, nearCards: ln2.cards, cardsMat: 'bloom', far: lf2.body, trunk: loblollyTrunk(T, lp2), aspect: LOB_A };
  const dp = dogwoodPlan(61), dn = dogwood(T, dp, true), df = dogwood(T, dp, false);
  kinds.dogwood = { nearBody: dn.body, nearCards: dn.cards, cardsMat: 'bloom', far: df.body, trunk: dogwoodTrunk(T, dp), aspect: DOG_A };
  const mp = magnoliaPlan(71), mn = magnolia(T, mp, true), mf = magnolia(T, mp, false);
  kinds.magnolia = { nearBody: mn.body, nearCards: mn.cards, cardsMat: 'bloom', far: mf.body, trunk: stubTrunk(T, MAG_A, 0.5, 0.035), aspect: MAG_A };
  kinds.oak_big = bigOak(T);
  kinds.azalea = azalea(T);
  return kinds;
}

// The tree kinds, each with a detailed near model and a cheap far model.
export function makeTrees(T) {
  const oakA = [[0.26, 0, 0, 0.66], [0.2, 0.2, 0.06, 0.56], [0.19, -0.19, -0.05, 0.58], [0.19, 0.03, 0.02, 0.84],
    [0.17, 0.06, -0.2, 0.6], [0.17, -0.05, 0.2, 0.62], [0.15, 0.15, -0.12, 0.76], [0.15, -0.14, 0.12, 0.78]];
  const oakB = [[0.29, 0, 0, 0.62], [0.22, 0.02, 0, 0.86], [0.2, 0.17, 0.1, 0.5], [0.2, -0.16, -0.1, 0.52],
    [0.18, 0.12, -0.16, 0.7], [0.18, -0.12, 0.16, 0.72]];
  const cyp = [[0.3, 0, 0, 0.66, 1, 1, 0.42], [0.25, 0.24, 0.08, 0.56, 1, 1, 0.4], [0.24, -0.25, -0.06, 0.58, 1, 1, 0.4],
    [0.2, 0.05, 0.2, 0.74, 1, 1, 0.4], [0.2, -0.08, -0.2, 0.5, 1, 1, 0.38], [0.18, 0.32, -0.12, 0.48, 1, 1, 0.36]];
  // Each kind: an opaque body and cut-out leaf cards up close, a cheap
  // body-only model further away, and a trunk.
  const split = (b) => ({ nearBody: b.geometry(T), nearCards: b.cardGeometry(T) });
  const leafy = (clusters, seed, cardSize, tint = 1) => ({
    ...split(canopy(T, { clusters, detail: 2, cards: 75, cardSize: cardSize * 1.5, seed, tint })),
    // Far away: the five biggest blobs, smooth enough not to look faceted.
    far: canopy(T, { clusters: [...clusters].sort((a, b) => b[0] - a[0]).slice(0, 5), detail: 1, lump: 0.15, seed, tint }).geometry(T),
  });
  const kinds = {
    oak: { ...leafy(oakA, 11, 0.15), trunk: trunk(T, { seed: 4 }) },
    oak2: { ...leafy(oakB, 23, 0.16), trunk: trunk(T, { seed: 8, h: 0.5, branches: 3, bend: -0.03 }) },
    cypress: { ...leafy(cyp, 31, 0.14, 0.92), trunk: trunk(T, { seed: 6, h: 0.55, r0: 0.08, r1: 0.05, branches: 3, bend: 0.08 }) },
    pine: { ...split(pine(T, { cards: 70, seed: 3 })), far: pine(T, { segs: 8, seed: 3 }).geometry(T), trunk: trunk(T, { h: 1, r0: 0.045, r1: 0.02, branches: 0, bend: 0.01, sides: 6 }) },
  };
  {
    const near = palmTop(T, {}), far = palmTop(T, { fronds: 8 });
    // Palms are mostly fronds, so the far model keeps its (fewer) fronds.
    const farG = T.mergeGeometries([far.geometry(T), far.cardGeometry(T)]);
    kinds.palm = { ...split(near), far: farG, farCards: true, trunk: palmTrunk(T) };
  }
  // Bushes: azaleas and gorse.
  const bushClusters = [[0.5, 0, 0, 0.42], [0.4, 0.36, 0.1, 0.34], [0.38, -0.32, -0.1, 0.34], [0.32, 0.05, 0.3, 0.3]];
  const bush = canopy(T, { clusters: bushClusters, detail: 1, cards: 14, cardSize: 0.42, seed: 41, lump: 0.25 });
  kinds.bush = { body: bush.geometry(T), cards: bush.cardGeometry(T) };
  Object.assign(kinds, makeAugustaTrees(T));
  return kinds;
}

// Leaves and trunks: the same lighting for canopy bodies (opaque) and leaf
// cards (cut out of the atlas), with wind sway and a soft rim of light.
//
// Tint flags. Every tree geometry may tag vertices by adding 2 × flag to the
// v texture coordinate (see FLAG below); the shader strips it again before
// sampling, so the atlas look is unchanged. With per-instance colours:
//   0  colour = vertex colour × instance colour (the usual leaf tint)
//   1  colour = vertex colour only (e.g. an azalea's green leaves, whose
//      instance colour is the blossom colour)
//   2  colour = vertex colour × a blossom colour picked per instance from
//      its position (dogwood: mostly white, some pink), ignoring the tint.
// `bloomAtlas` (assets/tex/blossoms.png) may be null: the bloom material then
// starts on a clear placeholder (cards invisible) until it is assigned.
export function makeTreeMaterials(T, atlas, timeU, bloomAtlas = null) {
  const leaf = new T.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5, side: T.DoubleSide });
  const body = new T.MeshLambertMaterial({ map: atlas, vertexColors: true, side: T.DoubleSide });
  if (!bloomAtlas) {
    bloomAtlas = new T.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1);
    bloomAtlas.needsUpdate = true;
  }
  const bloom = new T.MeshLambertMaterial({ map: bloomAtlas, vertexColors: true, alphaTest: 0.5, side: T.DoubleSide });
  bloom.defines = { BLOOM: '' };
  leaf.onBeforeCompile = body.onBeforeCompile = bloom.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeU;
    sh.vertexShader = 'uniform float uTime; varying vec3 vLocal; varying vec3 vLocalN;\n' + sh.vertexShader
      .replace('#include <uv_vertex>', `#include <uv_vertex>
      float tFlag = floor(uv.y * 0.5 + 0.001);
      #ifdef USE_MAP
        vMapUv.y -= tFlag * 2.0;
      #endif`)
      .replace('#include <color_vertex>', `#include <color_vertex>
      #ifdef USE_INSTANCING_COLOR
        if (tFlag > 0.5) {
          vColor.rgb = color.rgb;
          if (tFlag > 1.5) {
            float bh = fract(sin(dot(instanceMatrix[3].xy, vec2(12.9898, 78.233))) * 43758.5453);
            vColor.rgb *= bh < 0.7 ? vec3(1.0, 0.98, 0.94) : bh < 0.9 ? vec3(1.0, 0.6, 0.7) : vec3(0.98, 0.42, 0.58);
          }
        }
      #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vLocal = position;
      vLocalN = normal;
      #ifdef USE_INSTANCING
        // Undo the instance's stretch so the wrapped foliage keeps its shape.
        vec3 isc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vLocal *= isc / max(1e-4, 0.5 * (isc.x + isc.y));
      #endif
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][1]);
      #else
        vec2 ip = vec2(0.0);
      #endif
      float hgt = max(0.0, position.z - 0.3);
      float sw = sin(uTime * 1.1 + ip.x * 0.13 + ip.y * 0.07) * 0.6 + sin(uTime * 2.7 + ip.y * 0.21 + position.x * 9.0) * 0.25;
      transformed.x += sw * 0.02 * hgt;
      transformed.y += sw * 0.013 * hgt;`);
    sh.fragmentShader = 'varying vec3 vLocal; varying vec3 vLocalN;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        // Canopy bodies (mapped to the solid slot) get the dense foliage
        // texture wrapped round them, blended across the three axes.
        #ifdef BLOOM
        // Blossom cards are painted near-white: less boost than leaf cards.
        diffuseColor.rgb *= 1.2 / 1.7;
        if (false) {
        #else
        if (vMapUv.x > 0.752) {
        #endif
          vec3 q = vLocal * 7.0;
          vec3 bw = pow(abs(normalize(vLocalN)), vec3(4.0));
          bw /= bw.x + bw.y + bw.z;
          vec2 r1 = q.yz, r2 = q.xz, r3 = q.xy;
          vec3 f1 = textureGrad(map, vec2(0.755 + fract(r1.x) * 0.24, 0.01 + fract(r1.y) * 0.98), dFdx(r1) * vec2(0.24, 0.98), dFdy(r1) * vec2(0.24, 0.98)).rgb;
          vec3 f2 = textureGrad(map, vec2(0.755 + fract(r2.x) * 0.24, 0.01 + fract(r2.y) * 0.98), dFdx(r2) * vec2(0.24, 0.98), dFdy(r2) * vec2(0.24, 0.98)).rgb;
          vec3 f3 = textureGrad(map, vec2(0.755 + fract(r3.x) * 0.24, 0.01 + fract(r3.y) * 0.98), dFdx(r3) * vec2(0.24, 0.98), dFdy(r3) * vec2(0.24, 0.98)).rgb;
          diffuseColor.rgb *= (f1 * bw.x + f2 * bw.y + f3 * bw.z) * 1.85;
        } else {
          // Leaf cards: undo the texture's average darkness.
          diffuseColor.rgb *= 1.7;
        }`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // Foliage reads best with strong sun-and-shade contrast: lean on the
        // direct light, cool the sky fill, and let backlit leaves glow.
        reflectedLight.directDiffuse *= 1.3;
        reflectedLight.indirectDiffuse *= vec3(0.78, 0.84, 0.95);
        float rim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.5);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * rim * 0.35;
        #if NUM_DIR_LIGHTS > 0
          vec3 sunV = directionalLights[0].direction;
          float back = pow(max(0.0, dot(normalize(-vViewPosition), -sunV)), 3.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * back * 0.35 * vec3(1.0, 1.08, 0.7);
        #endif`);
  };
  leaf.customProgramCacheKey = () => 'pl-leaf2';
  body.customProgramCacheKey = () => 'pl-leaf-body2';
  bloom.customProgramCacheKey = () => 'pl-bloom2';
  const bark = new T.MeshLambertMaterial({ vertexColors: true });
  return { leaf, body, bark, bloom };
}

// ---------- grass ----------

// A clump of blades, 1 unit tall: dark at the root, light at the tips.
// Each blade is a single tapering triangle.
export function makeGrassGeo(T, blades = 6) {
  const r = rand(17);
  const P = [], C = [], N = [], I = [];
  const c0 = [0.45, 0.48, 0.42], c2 = [1.2, 1.22, 1.04];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * TAU + r() * 0.8, off = 0.04 + r() * 0.1;
    const ox = Math.cos(a) * off, oy = Math.sin(a) * off;
    const la = a + (r() - 0.5) * 1.2, lean = 0.12 + r() * 0.22;
    const lx = Math.cos(la) * lean, ly = Math.sin(la) * lean;
    const w = 0.045 + r() * 0.02, pa = la + Math.PI / 2, px = (Math.cos(pa) * w) / 2, py = (Math.sin(pa) * w) / 2;
    const h = 0.75 + r() * 0.25;
    const base = P.length / 3;
    const v = (p, c) => {
      P.push(...p);
      C.push(...c);
      N.push(0, 0, 1);
    };
    // One tapering triangle per blade: cheap enough to draw thousands.
    v([ox - px * 1.2, oy - py * 1.2, 0], c0);
    v([ox + px * 1.2, oy + py * 1.2, 0], c0);
    v([ox + lx, oy + ly, h], c2);
    I.push(base, base + 1, base + 2);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  return g;
}

// Grass placed entirely on the GPU: a grid of clumps around a centre that
// follows the camera. Each clump hashes its world cell for a stable spot,
// reads the course mask to decide how tall it grows (rough, wild grass, or
// nothing on fairways, greens, sand and water), sits on the height map and
// takes its colour from the turf beneath it.
export function makeGrassMaterial(T, U) {
  const mat = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = `attribute vec2 aOff;
      uniform float uTime, uRoughH; uniform sampler2D uMask; uniform sampler2D uHeight; uniform sampler2D uTurf;
      uniform vec4 uBox; uniform vec4 uGrid; uniform vec2 uCentre; uniform float uSpacing; uniform float uFar;
      uniform vec4 uBalls[4];
      varying vec3 vTurf;
      float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }
      // Height map is half-float with hardware bilinear filtering: one fetch.
      float hAt(vec2 p) {
        vec2 tc = ((p - uGrid.xy) / uGrid.z + 0.5) / vec2(textureSize(uHeight, 0));
        return textureLod(uHeight, tc, 0.0).r;
      }
      ` + sh.vertexShader.replace('#include <begin_vertex>', `
        vec2 cell = floor(uCentre / uSpacing) + aOff;
        vec2 wp = (cell + vec2(gh(cell), gh(cell + 17.31))) * uSpacing;
        vec2 muv = (wp - uBox.xy) / uBox.zw;
        vec2 tuv = vec2(muv.x, 1.0 - muv.y);
        vec4 m = textureLod(uMask, tuv, 0.0);
        float rough = smoothstep(0.12, 0.22, m.r) * (1.0 - smoothstep(0.35, 0.6, m.r)) * (1.0 - smoothstep(0.05, 0.6, m.g));
        float wild = (1.0 - smoothstep(0.02, 0.12, m.r)) * (1.0 - smoothstep(0.1, 0.5, m.b)) * (1.0 - smoothstep(0.1, 0.5, m.g));
        float inBox = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
        float r1 = gh(cell + 3.7), r2 = gh(cell + 9.1);
        float dc = distance(wp, cameraPosition.xy);
        float fade = 1.0 - smoothstep(uFar * 0.55, uFar, dc);
        float clump = 0.45 + 0.75 * gn(wp * 0.18);
        vTurf = textureLod(uTurf, tuv, 3.0).rgb;
        // No blades through pine straw (painted red-over-green on the turf).
        float straw = smoothstep(0.0, 0.05, vTurf.r - vTurf.g * 0.92);
        float h = (rough * (0.17 + 0.15 * r1) + wild * (0.3 + 0.32 * r1)) * clump * fade * inBox * uRoughH * (1.0 - straw);
        for (int k = 0; k < 4; k++) h *= mix(1.0, smoothstep(uBalls[k].z * 0.6, uBalls[k].z * 1.6, distance(wp, uBalls[k].xy)), uBalls[k].w);
        float ang = r2 * 6.2831853;
        vec3 p = position;
        p.xy = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * p.xy * (0.75 + r1 * 0.6);
        p.z *= h;
        float sw = sin(uTime * 1.9 + wp.x * 0.31 + wp.y * 0.17) * 0.55 + sin(uTime * 3.3 + wp.y * 0.53) * 0.2;
        p.xy += vec2(0.07, 0.045) * sw * position.z * position.z * h * 2.5;
        vec3 transformed = h < 0.015 ? vec3(wp, -500.0) : vec3(wp + p.xy, hAt(wp) - 0.03 + p.z);
      `);
    sh.fragmentShader = 'varying vec3 vTurf;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vTurf * 1.35;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);');
  };
  mat.customProgramCacheKey = () => 'pl-grass';
  return mat;
}
