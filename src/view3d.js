// The 3D view: a WebGL camera behind the ball. The ground is the same painted
// course texture the top-down view uses, laid flat; trees are upright
// billboards; the ball, flag, tracer, flight arc and effects are drawn in 3D.
// World units are yards with z up, matching the simulation.

const TAU = Math.PI * 2;

// Sky and light for each course: sky top, horizon (also the haze colour), and
// a tint for the ground and trees.
const SKIES = {
  links: { top: [0.29, 0.6, 0.9], horizon: [0.8, 0.9, 0.96], tint: [1, 1, 1], cloud: 0.4 },
  augusta: { top: [0.25, 0.55, 0.92], horizon: [0.84, 0.92, 0.97], tint: [1.03, 1.02, 0.97], cloud: 0.25 },
  standrews: { top: [0.5, 0.58, 0.66], horizon: [0.82, 0.85, 0.87], tint: [0.94, 0.97, 1.0], cloud: 0.95 },
  pebble: { top: [0.36, 0.5, 0.78], horizon: [0.98, 0.84, 0.66], tint: [1.08, 0.99, 0.9], cloud: 0.5 },
  sawgrass: { top: [0.2, 0.55, 0.95], horizon: [0.78, 0.92, 1.0], tint: [1.0, 1.03, 1.0], cloud: 0.55 },
};

// ---------- small matrix library (column-major, like GL) ----------

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}

function lookAt(e, t, up) {
  let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1,
  ]);
}

function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function invert(m) {
  const inv = new Float32Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  det = det ? 1 / det : 0;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

function xform(m, x, y, z, w = 1) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w];
}

// '#rrggbb' or 'rgba(r,g,b,a)' to [r, g, b, a] in 0..1, cached.
const colorCache = new Map();
export function parseColor(s) {
  let c = colorCache.get(s);
  if (c) return c;
  if (s[0] === '#') {
    const n = parseInt(s.slice(1), 16);
    c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  } else {
    const p = s.match(/[\d.]+/g).map(Number);
    c = [p[0] / 255, p[1] / 255, p[2] / 255, p[3] ?? 1];
  }
  colorCache.set(s, c);
  return c;
}

// ---------- shaders ----------

const GROUND_VS = `
attribute vec2 aPos;
attribute vec2 aUv;
uniform mat4 uVP;
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = aUv;
  vW = vec3(aPos, 0.0);
  gl_Position = uVP * vec4(aPos, 0.0, 1.0);
}`;

const GROUND_FS = `
precision mediump float;
uniform sampler2D uTex;
uniform sampler2D uMask;
uniform float uWater;
uniform vec3 uEye;
uniform vec3 uFog;
uniform vec3 uTint;
uniform vec2 uFogRange;
uniform float uTime;
varying vec2 vUv;
varying vec3 vW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec4 c = texture2D(uTex, vUv);
  float d = distance(uEye, vW);
  // Fine grass texture close to the camera, where the painted map runs out of detail.
  float near = 1.0 - smoothstep(10.0, 60.0, d);
  float grain = vnoise(vW.xy * 7.0) * 0.6 + vnoise(vW.xy * 23.0) * 0.4;
  c.rgb *= 1.0 + (grain - 0.5) * 0.16 * near;
  if (uWater > 0.5 && texture2D(uMask, vUv).r > 0.5) {
    // Water: moving glints, and the sky reflected more at a glancing angle.
    float s = sin(vW.x * 0.9 + uTime * 1.6) * sin(vW.y * 1.15 - uTime * 1.2) + 0.6 * sin((vW.x - vW.y) * 0.37 + uTime * 0.9);
    c.rgb += vec3(0.25, 0.28, 0.3) * smoothstep(0.85, 1.5, s);
    float graze = clamp(1.0 - (uEye.z / max(d, 1.0)) * 4.0, 0.0, 1.0);
    c.rgb = mix(c.rgb, uFog * 0.95, graze * 0.45);
  }
  c.rgb *= uTint;
  float f = clamp((d - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  gl_FragColor = vec4(mix(c.rgb, uFog, f * f), 1.0);
}`;

const SPRITE_VS = `
attribute vec3 aPos;
attribute vec2 aUv;
attribute vec4 aCol;
uniform mat4 uVP;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vW;
void main() {
  vUv = aUv;
  vCol = aCol;
  vW = aPos;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const SPRITE_FS = `
precision mediump float;
uniform sampler2D uTex;
uniform vec3 uEye;
uniform vec3 uFog;
uniform vec3 uTint;
uniform vec2 uFogRange;
uniform float uCut;
uniform float uFogOn;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vW;
void main() {
  vec4 c = texture2D(uTex, vUv) * vCol;
  if (c.a < uCut) discard;
  c.rgb *= mix(vec3(1.0), uTint, uFogOn);
  float d = distance(uEye, vW);
  float f = clamp((d - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0) * uFogOn;
  gl_FragColor = vec4(mix(c.rgb, uFog, f * f), c.a);
}`;

const SKY_VS = `
attribute vec2 aPos;
varying vec2 vP;
void main() { vP = aPos; gl_Position = vec4(aPos, 0.999, 1.0); }`;

const SKY_FS = `
precision highp float;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform float uHorizonY;
uniform float uYaw;
uniform float uTime;
uniform float uCloud;
uniform float uAspect;
varying vec2 vP;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main() {
  float h = vP.y - uHorizonY;
  float t = clamp(h * 1.6, 0.0, 1.0);
  vec3 c = mix(uHorizon, uTop, pow(t, 0.7));
  // Sun glow, fixed in the world: it slides across as the camera turns.
  float sx = fract((uYaw / 6.2831853) + 0.35) * 2.0 - 1.0;
  float g = exp(-pow(distance(vec2(vP.x * uAspect, vP.y), vec2(sx * 4.0 * uAspect, 0.7)), 2.0) * 6.0);
  c += vec3(0.14, 0.11, 0.06) * g;
  // Clouds: stretched towards the horizon, drifting slowly.
  if (h > 0.0) {
    float d = 1.0 / (h + 0.18);
    vec2 q = vec2(vP.x * uAspect * d * 0.6 + uYaw * 2.4 + uTime * 0.01, d * 1.2);
    float n = fbm(q * 1.4);
    float cover = smoothstep(0.52 - uCloud * 0.25, 0.85, n) * smoothstep(0.0, 0.18, h);
    vec3 cloud = mix(vec3(1.0), uHorizon, 0.25) * (0.92 + 0.08 * fbm(q * 4.0));
    c = mix(c, cloud, cover * 0.85);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

// ---------- the sprite atlas ----------

// Regions in a 1024x1024 atlas, in pixels.
const A = {
  oak: [[0, 0], [128, 0], [256, 0]],
  pine: [[384, 0], [512, 0], [640, 0]],
  palm: [[768, 0], [896, 0]],
  cypress: [[0, 256], [128, 256]],
  ball: [256, 256, 64, 64],
  shadow: [320, 256, 64, 64],
  ring: [384, 256, 128, 128],
  white: [516, 260, 8, 8],
  dot: [528, 256, 32, 32],
  cloud: [[0, 512, 512, 256], [512, 512, 512, 256], [0, 768, 512, 256]],
};
const TREE_W = 128, TREE_H = 256;

function seeded(n) {
  let a = n >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blob(c, x, y, r, fill) {
  c.fillStyle = fill;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
}

// Leafy canopy lit from the upper left: dark base, mid layer, bright tips.
function canopy(c, r, cx, cy, rx, ry, pal, n = 26) {
  for (let layer = 0; layer < 3; layer++) {
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = Math.sqrt(r());
      const x = cx + Math.cos(a) * rx * d * (1 - layer * 0.18) - layer * rx * 0.1;
      const y = cy + Math.sin(a) * ry * d * (1 - layer * 0.2) - layer * ry * 0.14;
      blob(c, x, y, (rx * 0.3) * (1 - layer * 0.25) * (0.7 + r() * 0.5), pal[layer]);
    }
  }
}

function drawAtlas() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1024;
  const c = cv.getContext('2d');
  const r = seeded(7);
  const trunk = (x0, y0, x1, y1, w0, w1, col) => {
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(x0 - w0, y0);
    c.lineTo(x1 - w1, y1);
    c.lineTo(x1 + w1, y1);
    c.lineTo(x0 + w0, y0);
    c.fill();
  };
  // Broadleaf trees.
  A.oak.forEach(([ox, oy], k) => {
    c.save();
    c.translate(ox, oy);
    trunk(64, 256, 64, 120, 7, 4, '#4a3524');
    trunk(64, 170, 40, 120, 3, 2, '#4a3524');
    trunk(64, 160, 92, 115, 3, 2, '#4a3524');
    const pal = [['#1f4a22', '#2f6b2f', '#4c9142'], ['#21502b', '#33743a', '#56a04c'], ['#1c4426', '#2b6334', '#46874a']][k];
    canopy(c, r, 64, 92, 56, 66, pal);
    c.restore();
  });
  // Augusta's tall loblolly pines: long bare trunks, crowns up top.
  A.pine.forEach(([ox, oy], k) => {
    c.save();
    c.translate(ox, oy);
    trunk(64, 256, 64, 30, 5, 2.5, '#5a3a26');
    for (let i = 0; i < 4; i++) trunk(64, 120 - i * 18, 64 + (i % 2 ? 1 : -1) * 34, 100 - i * 20, 2, 1, '#5a3a26');
    const pal = [['#143820', '#1f4f2c', '#2f6a3a'], ['#173f22', '#245830', '#357641'], ['#12341e', '#1d4a29', '#2c6337']][k];
    for (let i = 0; i < 6; i++) canopy(c, r, 64 + (r() - 0.5) * 50, 30 + i * 17, 26 + r() * 12, 14, pal, 8);
    c.restore();
  });
  // Palms: a slightly curved trunk and drooping fronds.
  A.palm.forEach(([ox, oy], k) => {
    c.save();
    c.translate(ox, oy);
    c.strokeStyle = '#7b6141';
    c.lineWidth = 8;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(64, 256);
    c.quadraticCurveTo(64 + (k ? 18 : -14), 140, 64, 52);
    c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.lineWidth = 2;
    for (let y = 240; y > 60; y -= 10) {
      c.beginPath();
      c.moveTo(58, y);
      c.lineTo(70, y);
      c.stroke();
    }
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i - 4) * 0.42;
      const len = 54 + r() * 10;
      c.strokeStyle = i % 2 ? '#2e7a34' : '#3f9643';
      c.lineWidth = 9;
      c.beginPath();
      c.moveTo(64, 52);
      c.quadraticCurveTo(64 + Math.cos(a) * len * 0.6, 52 + Math.sin(a) * len * 0.6 - 10, 64 + Math.cos(a) * len, 52 + Math.sin(a) * len * 0.5 + 34);
      c.stroke();
    }
    blob(c, 64, 56, 6, '#6b5233');
    c.restore();
  });
  // Monterey cypress: twisted trunk, flat windswept layers.
  A.cypress.forEach(([ox, oy], k) => {
    c.save();
    c.translate(ox, oy);
    trunk(64, 256, 58, 150, 8, 5, '#4b3a2c');
    trunk(58, 180, 30, 140, 3, 2, '#4b3a2c');
    trunk(60, 170, 98, 130, 3, 2, '#4b3a2c');
    const pal = [['#16351f', '#214a2c', '#30603b'], ['#183a22', '#24512f', '#346a3f']][k];
    canopy(c, r, 44, 130, 40, 22, pal, 14);
    canopy(c, r, 86, 112, 38, 20, pal, 14);
    canopy(c, r, 62, 90, 46, 24, pal, 16);
    c.restore();
  });
  // Ball, shadow, ring, white, soft dot.
  {
    const [x, y, w] = A.ball;
    const g = c.createRadialGradient(x + w * 0.38, y + w * 0.36, 2, x + w / 2, y + w / 2, w / 2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.7, '#e8eceb');
    g.addColorStop(1, '#a9b2b4');
    c.fillStyle = g;
    c.beginPath();
    c.arc(x + w / 2, y + w / 2, w / 2 - 1, 0, TAU);
    c.fill();
  }
  {
    const [x, y, w] = A.shadow;
    const g = c.createRadialGradient(x + w / 2, y + w / 2, 0, x + w / 2, y + w / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x, y, w, w);
  }
  {
    const [x, y, w] = A.ring;
    c.strokeStyle = '#fff';
    c.lineWidth = 9;
    c.beginPath();
    c.arc(x + w / 2, y + w / 2, w / 2 - 6, 0, TAU);
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fill();
  }
  c.fillStyle = '#fff';
  c.fillRect(A.white[0] - 4, A.white[1] - 4, 16, 16);
  {
    const [x, y, w] = A.dot;
    const g = c.createRadialGradient(x + w / 2, y + w / 2, 0, x + w / 2, y + w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(x, y, w, w);
  }
  // Clouds: soft piles of white.
  A.cloud.forEach(([x, y, w, h]) => {
    for (let i = 0; i < 26; i++) {
      const cx = x + w * (0.18 + r() * 0.64), cy = y + h * (0.45 + r() * 0.25);
      const rr = h * (0.12 + r() * 0.16);
      const g = c.createRadialGradient(cx, cy - rr * 0.3, rr * 0.1, cx, cy, rr);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.7, 'rgba(240,244,250,0.6)');
      g.addColorStop(1, 'rgba(230,236,245,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(cx, cy, rr, 0, TAU);
      c.fill();
    }
  });
  return cv;
}

// ---------- the view ----------

export class View3D {
  constructor(canvas) {
    this.cv = canvas;
    this.ok = false;
    const opts = { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false };
    let gl = null;
    try {
      gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
    } catch {}
    if (!gl) return;
    this.gl = gl;
    this.gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    try {
      this.ground = this.program(GROUND_VS, GROUND_FS, ['aPos', 'aUv'], ['uVP', 'uTex', 'uMask', 'uWater', 'uEye', 'uFog', 'uTint', 'uFogRange', 'uTime']);
      this.sprite = this.program(SPRITE_VS, SPRITE_FS, ['aPos', 'aUv', 'aCol'], ['uVP', 'uTex', 'uEye', 'uFog', 'uTint', 'uFogRange', 'uCut', 'uFogOn']);
      this.skyProg = this.program(SKY_VS, SKY_FS, ['aPos'], ['uTop', 'uHorizon', 'uHorizonY', 'uYaw', 'uTime', 'uCloud', 'uAspect']);
    } catch (e) {
      console.warn('3D view unavailable', e);
      return;
    }
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    this.buf = gl.createBuffer();
    this.skyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.atlas = this.texture(drawAtlas(), true);
    this.verts = new Float32Array(9 * 6 * 4096);
    this.n = 0;
    this.hole = null;
    this.vp = null;
    this.ok = true;
  }

  program(vs, fs, attrs, unis) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const out = { p, a: {}, u: {} };
    for (const a of attrs) out.a[a] = gl.getAttribLocation(p, a);
    for (const u of unis) out.u[u] = gl.getUniformLocation(p, u);
    return out;
  }

  texture(src, mip) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const pot = (n) => (n & (n - 1)) === 0;
    const canMip = mip && (this.gl2 || (pot(src.width) && pot(src.height)));
    if (canMip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, canMip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (canMip && this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return t;
  }

  resize(w, h, dpr) {
    if (!this.ok) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
  }

  // Take the painted course from the 2D renderer and lay it on the ground.
  setHole(hole, R, palette) {
    if (!this.ok) return;
    const gl = this.gl;
    if (this.tex) for (const t of [this.tex, this.gTex, this.maskTex]) gl.deleteTexture(t);
    if (this.nearTex) gl.deleteTexture(this.nearTex);
    this.nearTex = null;
    this.hole = hole;
    this.box = R.box;
    this.gbox = R.gbox;
    this.slopePts = R.slopePts;
    this.tex = this.texture(R.base, true);
    this.gTex = this.texture(R.gLayer, true);
    this.maskTex = this.texture(this.waterMask(hole, R.box), false);
    this.obColor = parseColor(palette.ob);
    this.sky = SKIES[hole.course] || SKIES.links;
    // Trees: a random variant per tree, a slight tint, and a sprite region.
    this.trees = hole.trees.map((t, i) => {
      const kind = t.pine ? A.pine : t.palm ? A.palm : t.cypress ? A.cypress : A.oak;
      const reg = kind[Math.floor(t.shade * 997 + i) % kind.length];
      const k = 0.82 + t.shade * 0.3;
      return { x: t.x, y: t.y, w: t.r * (t.pine ? 2.3 : t.palm ? 2.4 : 2.2), h: t.h * (t.palm ? 1.05 : 1), reg, col: [k, k, k * 0.98, 1] };
    });
  }

  // A sharper painting of the area around the ball, for close-up views.
  setNear(canvas, box) {
    if (!this.ok) return;
    if (this.nearTex) this.gl.deleteTexture(this.nearTex);
    this.nearTex = this.texture(canvas, true);
    this.nearBox = box;
  }

  waterMask(hole, box) {
    const px = 1;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(box.w * px));
    cv.height = Math.max(1, Math.ceil(box.h * px));
    const c = cv.getContext('2d');
    c.fillStyle = '#000';
    c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(px, 0, 0, px, -box.x * px, -box.y * px);
    c.fillStyle = c.strokeStyle = '#fff';
    c.lineCap = c.lineJoin = 'round';
    for (const w of hole.water) {
      c.beginPath();
      if (w.line) {
        c.moveTo(w.line[0][0], w.line[0][1]);
        for (const p of w.line.slice(1)) c.lineTo(p[0], p[1]);
        c.lineWidth = w.w;
        c.stroke();
      } else {
        c.ellipse(w.x, w.y, w.rx, w.ry, w.rot || 0, 0, TAU);
        c.fill();
      }
    }
    return cv;
  }

  // ---------- geometry helpers (all into one vertex buffer) ----------

  vert(x, y, z, u, v, c) {
    if (this.n * 9 + 9 > this.verts.length) {
      const bigger = new Float32Array(this.verts.length * 2);
      bigger.set(this.verts);
      this.verts = bigger;
    }
    const o = this.n * 9;
    const V = this.verts;
    V[o] = x; V[o + 1] = y; V[o + 2] = z; V[o + 3] = u; V[o + 4] = v;
    V[o + 5] = c[0]; V[o + 6] = c[1]; V[o + 7] = c[2]; V[o + 8] = c[3];
    this.n++;
  }

  // A quad from four corners (bottom-left, bottom-right, top-right, top-left).
  quad(p0, p1, p2, p3, reg, c) {
    const [rx, ry, rw, rh] = reg;
    const u0 = rx / 1024, u1 = (rx + rw) / 1024, v0 = (ry + rh) / 1024, v1 = ry / 1024;
    this.vert(...p0, u0, v0, c);
    this.vert(...p1, u1, v0, c);
    this.vert(...p2, u1, v1, c);
    this.vert(...p0, u0, v0, c);
    this.vert(...p2, u1, v1, c);
    this.vert(...p3, u0, v1, c);
  }

  // Upright sprite that turns to face the camera (trees, flag pole).
  upright(x, y, z, w, h, reg, c) {
    const e = this.eye;
    let dx = x - e[0], dy = y - e[1];
    const l = Math.hypot(dx, dy) || 1;
    const rx = (-dy / l) * (w / 2), ry = (dx / l) * (w / 2);
    this.quad([x - rx, y - ry, z], [x + rx, y + ry, z], [x + rx, y + ry, z + h], [x - rx, y - ry, z + h], reg, c);
  }

  // Sprite facing the camera completely (ball, particles, clouds).
  facing(x, y, z, s, reg, c) {
    const [ax, ay, az] = this.right, [bx, by, bz] = this.up;
    const h = s / 2;
    this.quad(
      [x - ax * h - bx * h, y - ay * h - by * h, z - az * h - bz * h],
      [x + ax * h - bx * h, y + ay * h - by * h, z + az * h - bz * h],
      [x + ax * h + bx * h, y + ay * h + by * h, z + az * h + bz * h],
      [x - ax * h + bx * h, y - ay * h + by * h, z - az * h + bz * h],
      reg, c,
    );
  }

  // Flat on the ground, rotated by ang.
  flat(x, y, z, w, h, ang, reg, c) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const ux = ca * (w / 2), uy = sa * (w / 2), vx = -sa * (h / 2), vy = ca * (h / 2);
    this.quad([x - ux - vx, y - uy - vy, z], [x + ux - vx, y + uy - vy, z], [x + ux + vx, y + uy + vy, z], [x - ux + vx, y - uy + vy, z], reg, c);
  }

  // A ribbon through 3D points, turned toward the camera; width in screen-ish
  // terms (grows with distance so it stays visible). dash: on/off segments.
  ribbon(pts, px, c, dash = 0, fade = false, fadeIn = 0) {
    for (let i = 1; i < pts.length; i++) {
      if (dash && Math.floor(i / dash) % 2) continue;
      const k = fadeIn ? Math.min(1, i / (pts.length * fadeIn)) : 1;
      const a = pts[i - 1], b = pts[i];
      const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const ex = a[0] - this.eye[0], ey = a[1] - this.eye[1], ez = a[2] - this.eye[2];
      let sx = ty * ez - tz * ey, sy = tz * ex - tx * ez, sz = tx * ey - ty * ex;
      const l = Math.hypot(sx, sy, sz) || 1;
      const w = Math.max(0.03, Math.hypot(ex, ey, ez) * px) / 2;
      sx = (sx / l) * w; sy = (sy / l) * w; sz = (sz / l) * w;
      const col = fade ? [c[0], c[1], c[2], c[3] * (i / pts.length)] : k < 1 ? [c[0], c[1], c[2], c[3] * (0.15 + 0.85 * k)] : c;
      this.quad([a[0] - sx, a[1] - sy, a[2] - sz], [a[0] + sx, a[1] + sy, a[2] + sz], [b[0] + sx, b[1] + sy, b[2] + sz], [b[0] - sx, b[1] - sy, b[2] - sz], A.white, col);
    }
  }

  // A line lying on the ground.
  groundLine(pts, w, c, dash = 0) {
    for (let i = 1; i < pts.length; i++) {
      if (dash && Math.floor(i / dash) % 2) continue;
      const a = pts[i - 1], b = pts[i];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const l = Math.hypot(nx, ny) || 1;
      const ww = Math.max(w, Math.hypot(a[0] - this.eye[0], a[1] - this.eye[1]) * 0.0035) / 2;
      nx = (nx / l) * ww; ny = (ny / l) * ww;
      this.quad([a[0] - nx, a[1] - ny, 0.04], [a[0] + nx, a[1] + ny, 0.04], [b[0] + nx, b[1] + ny, 0.04], [b[0] - nx, b[1] - ny, 0.04], A.white, c);
    }
  }

  flush(cut, fogOn = 1) {
    if (!this.n) return;
    const gl = this.gl, s = this.sprite;
    gl.useProgram(s.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.verts.subarray(0, this.n * 9), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(s.a.aPos);
    gl.vertexAttribPointer(s.a.aPos, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(s.a.aUv);
    gl.vertexAttribPointer(s.a.aUv, 2, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(s.a.aCol);
    gl.vertexAttribPointer(s.a.aCol, 4, gl.FLOAT, false, 36, 20);
    gl.uniformMatrix4fv(s.u.uVP, false, this.vp);
    gl.uniform3fv(s.u.uEye, this.eye);
    gl.uniform3fv(s.u.uFog, this.sky.horizon);
    gl.uniform3fv(s.u.uTint, this.sky.tint);
    gl.uniform2f(s.u.uFogRange, this.fogNear, this.fogFar);
    gl.uniform1f(s.u.uCut, cut);
    gl.uniform1f(s.u.uFogOn, fogOn);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(s.u.uTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.n);
    gl.disableVertexAttribArray(s.a.aCol);
    this.n = 0;
  }

  groundQuad(box, tex, mask) {
    const gl = this.gl, g = this.ground;
    const x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
    const data = new Float32Array([x0, y0, 0, 0, x1, y0, 1, 0, x1, y1, 1, 1, x0, y0, 0, 0, x1, y1, 1, 1, x0, y1, 0, 1]);
    gl.useProgram(g.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(g.a.aPos);
    gl.vertexAttribPointer(g.a.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(g.a.aUv);
    gl.vertexAttribPointer(g.a.aUv, 2, gl.FLOAT, false, 16, 8);
    gl.uniformMatrix4fv(g.u.uVP, false, this.vp);
    gl.uniform3fv(g.u.uEye, this.eye);
    gl.uniform3fv(g.u.uFog, this.sky.horizon);
    gl.uniform3fv(g.u.uTint, this.sky.tint);
    gl.uniform2f(g.u.uFogRange, this.fogNear, this.fogFar);
    gl.uniform1f(g.u.uTime, this.time);
    gl.uniform1f(g.u.uWater, mask ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(g.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mask || this.atlas);
    gl.uniform1i(g.u.uMask, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

  // ---------- camera ----------

  setCamera(cam) {
    const aspect = this.w / this.h;
    const fov = ((cam.fov || (aspect < 1 ? 66 : 56)) * Math.PI) / 180;
    this.eye = cam.eye;
    const view = lookAt(cam.eye, cam.target, [0, 0, 1]);
    this.proj = perspective(fov, aspect, 0.15, 5000);
    // Shift the picture so its centre is the middle of the visible area
    // (between the top bar and the control panel), not the whole screen.
    const top = cam.insetTop || 0, bottom = cam.insetBottom || 0;
    const centre = (top + this.h - bottom) / 2;
    this.proj[9] = -(1 - (2 * centre) / this.h);
    this.vp = mul(this.proj, view);
    this.inv = invert(this.vp);
    // Camera right and up vectors, for camera-facing sprites.
    this.right = [view[0], view[4], view[8]];
    this.up = [view[1], view[5], view[9]];
    this.fogNear = 140;
    this.fogFar = 1100;
  }

  // Screen point (CSS px) for a world point; null if behind the camera.
  project(x, y, z = 0) {
    if (!this.vp) return null;
    const [cx, cy, , cw] = xform(this.vp, x, y, z);
    if (cw <= 0.01) return null;
    return [((cx / cw) * 0.5 + 0.5) * this.w, (1 - ((cy / cw) * 0.5 + 0.5)) * this.h];
  }

  // Where a screen point (CSS px) meets the ground.
  toWorld(sx, sy) {
    const nx = (sx / this.w) * 2 - 1, ny = 1 - (sy / this.h) * 2;
    const a = xform(this.inv, nx, ny, -1), b = xform(this.inv, nx, ny, 1);
    const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    let t = d[2] < -1e-6 ? -p0[2] / d[2] : 1;
    // Above the horizon: take a far point in that direction instead.
    const len = Math.hypot(d[0], d[1], d[2]) * t;
    if (d[2] >= -1e-6 || len > 1500) t = 1500 / Math.hypot(d[0], d[1], d[2]);
    return [p0[0] + d[0] * t, p0[1] + d[1] * t];
  }

  // ---------- drawing ----------

  draw(scene) {
    if (!this.ok || !this.hole) return;
    const gl = this.gl;
    this.time = scene.time;
    this.setCamera(scene.cam);
    gl.viewport(0, 0, this.cv.width, this.cv.height);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearColor(...this.sky.horizon, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Sky gradient, with the horizon where the ground meets it.
    this.drawSky(scene);

    // Ground: a huge plain plane under the painted hole, then the hole, then
    // the sharper green.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const big = 6000, ob = this.obColor;
    const cx = this.box.x + this.box.w / 2, cy = this.box.y + this.box.h / 2;
    this.quad([cx - big, cy - big, -0.02], [cx + big, cy - big, -0.02], [cx + big, cy + big, -0.02], [cx - big, cy + big, -0.02], A.white, [ob[0] * 0.92, ob[1] * 0.92, ob[2] * 0.92, 1]);
    this.flush(0);
    this.groundQuad(this.box, this.tex, this.maskTex);
    if (this.nearTex) this.groundQuad(this.nearBox, this.nearTex, null);
    const near = Math.hypot(this.gbox.x + this.gbox.w / 2 - this.eye[0], this.gbox.y + this.gbox.h / 2 - this.eye[1]);
    if (near < 320) this.groundQuad(this.gbox, this.gTex, null);

    // Things on the ground: slope arrows, shadows, aim guide, rings, cup.
    const sc = scene;
    if (sc.slope && this.slopePts) {
      for (const p of this.slopePts) {
        const strength = Math.min(1, p.m / 0.03);
        const ph = (sc.time * (0.3 + strength * 0.9) + p.ph) % 1;
        const len = 0.35 + strength * 0.7;
        const ox = p.x + p.dx * len * (ph - 0.5), oy = p.y + p.dy * len * (ph - 0.5);
        const a = Math.sin(ph * Math.PI) * (0.25 + strength * 0.55);
        this.flat(ox, oy, 0.02, 0.42, 0.06, Math.atan2(p.dy, p.dx), A.white, strength > 0.6 ? [1, 0.95, 0.66, a] : [1, 1, 1, a]);
      }
    }
    // Cup.
    this.flat(this.hole.pin.x, this.hole.pin.y, 0.015, 0.16, 0.16, 0, A.shadow, [0, 0, 0, 1]);
    if (sc.aim) this.drawAim(sc.aim);
    for (const b of sc.balls) {
      const s = Math.max(0.1, 0.3 - b.z * 0.01);
      this.flat(b.x, b.y, 0.03, s * (1 + b.z * 0.05), s * (1 + b.z * 0.05), 0, A.shadow, [0, 0, 0, Math.max(0.12, 0.55 - b.z * 0.02)]);
      if (b.ring) {
        const pulse = 0.9 + Math.sin(sc.time * 4) * 0.1;
        const d = Math.hypot(b.x - this.eye[0], b.y - this.eye[1]);
        const rr = Math.max(0.9, d * 0.045) * pulse;
        this.flat(b.x, b.y, 0.035, rr, rr, 0, A.ring, [...b.col.slice(0, 3), 0.95]);
      }
    }
    for (const p of sc.particles || []) {
      if (!p.ring) continue;
      const f = Math.max(0, p.life / p.max);
      const r = (p.r1 + (p.r0 - p.r1) * f) * 2;
      const c = parseColor(p.color);
      this.flat(p.x, p.y, 0.05, r, r, 0, A.ring, [c[0], c[1], c[2], c[3] * f]);
    }
    gl.disable(gl.DEPTH_TEST);
    this.flush(0.01);

    // Upright things with depth: trees and the flag pole.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    const e = this.eye;
    const reach = 1300;
    for (const t of this.trees) {
      if (Math.abs(t.x - e[0]) > reach || Math.abs(t.y - e[1]) > reach) continue;
      // Don't let a tree right beside the camera fill the screen.
      if (Math.hypot(t.x - e[0], t.y - e[1]) < t.w * 0.6 + 2.5) continue;
      this.upright(t.x, t.y, 0, t.w, t.h, [t.reg[0], t.reg[1], TREE_W, TREE_H], t.col);
    }
    this.drawFlag(sc);
    this.flush(0.5);

    // Translucent and glowing things: tracers, ball, particles, clouds.
    gl.depthMask(false);
    for (const t of sc.trails || []) {
      if (t.length < 2) continue;
      this.ribbon(t, 0.0045, [1, 0.97, 0.85, 0.85], 0, true);
      this.ribbon(t, 0.0016, [1, 1, 1, 1], 0, true);
    }
    for (const b of sc.balls) {
      const d = Math.hypot(b.x - e[0], b.y - e[1], b.z + 0.03 - e[2]);
      const s = Math.max(0.09, d * 0.011);
      this.facing(b.x, b.y, b.z + Math.max(0.04, s * 0.45), s, A.ball, [1, 1, 1, 1]);
      if (b.col) this.facing(b.x, b.y, b.z + Math.max(0.04, s * 0.45), s * 1.25, A.ring, [...b.col.slice(0, 3), 0.75]);
    }
    for (const p of sc.particles || []) {
      if (p.ring) continue;
      const f = Math.max(0, p.life / p.max);
      const c = parseColor(p.color);
      this.facing(p.x, p.y, p.z * 0.6 + 0.05, Math.max(p.size * 2.2, 0.08), A.dot, [c[0], c[1], c[2], c[3] * f]);
    }
    this.flush(0.01);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  drawSky(scene) {
    const gl = this.gl;
    const e = this.eye, t = scene.cam.target;
    const fx = t[0] - e[0], fy = t[1] - e[1], fl = Math.hypot(fx, fy) || 1;
    const hp = this.project(e[0] + (fx / fl) * 4000, e[1] + (fy / fl) * 4000, 0);
    const hy = hp ? 1 - (hp[1] / this.h) * 2 : -1;
    const sk = this.skyProg;
    gl.useProgram(sk.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.enableVertexAttribArray(sk.a.aPos);
    gl.vertexAttribPointer(sk.a.aPos, 2, gl.FLOAT, false, 8, 0);
    gl.uniform3fv(sk.u.uTop, this.sky.top);
    gl.uniform3fv(sk.u.uHorizon, this.sky.horizon);
    gl.uniform1f(sk.u.uHorizonY, hy);
    gl.uniform1f(sk.u.uYaw, Math.atan2(fy, fx));
    gl.uniform1f(sk.u.uTime, this.time);
    gl.uniform1f(sk.u.uCloud, this.sky.cloud ?? 0.4);
    gl.uniform1f(sk.u.uAspect, this.w / this.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  drawAim(aim) {
    const c = aim.color || [1, 1, 1, 0.95];
    if (aim.arc && aim.arc.length > 1) {
      // The flight, drawn in the air: a dashed arc with its shadow on the ground.
      this.groundLine(aim.arc.map((p) => [p[0], p[1]]), 0.12, [0, 0, 0, 0.22], 3);
      this.ribbon(aim.arc, 0.0032, c, 3, false, 0.25);
    }
    if (aim.roll && aim.roll.length > 1) this.groundLine(aim.roll, aim.putt ? 0.09 : 0.16, aim.putt ? [1, 0.96, 0.7, 0.95] : [c[0], c[1], c[2], 0.85], aim.putt ? 2 : 2);
    if (aim.ring) {
      const { x, y, r } = aim.ring;
      const d = Math.hypot(x - this.eye[0], y - this.eye[1]);
      const rr = Math.max(r * 2, d * 0.035);
      this.flat(x, y, 0.05, rr, rr, 0, A.ring, c);
    }
    if (aim.end) {
      const d = Math.hypot(aim.end.x - this.eye[0], aim.end.y - this.eye[1]);
      const rr = Math.max(0.5, d * 0.018);
      this.flat(aim.end.x, aim.end.y, 0.05, rr, rr, 0, A.ring, c);
    }
  }

  drawFlag(sc) {
    const p = this.hole.pin, e = this.eye;
    const d = Math.hypot(p.x - e[0], p.y - e[1]);
    const H = 2.4; // a 7 ft flagstick
    const w = Math.max(0.035, d * 0.0028);
    this.upright(p.x, p.y, 0, w, H, A.white, [0.95, 0.94, 0.9, 1]);
    // The cloth streams downwind and ripples.
    const wind = sc.wind || { speed: 5, dir: 0 };
    const len = 0.75 * (0.6 + Math.min(1, wind.speed / 16) * 0.4) * Math.max(1, d * 0.012);
    const hgt = 0.5 * Math.max(1, d * 0.012);
    const wx = Math.cos(wind.dir), wy = Math.sin(wind.dir);
    const col = sc.flagColor || [1, 0.82, 0.25, 1];
    const segs = 6;
    let prev = null;
    for (let i = 0; i <= segs; i++) {
      const k = i / segs;
      const wave = Math.sin(sc.time * (4 + wind.speed * 0.35) - k * 5) * 0.12 * k * len;
      const x = p.x + wx * len * k - wy * wave, y = p.y + wy * len * k + wx * wave;
      const top = H - k * 0.05, bot = H - hgt + k * 0.05;
      const cur = [[x, y, bot], [x, y, top]];
      if (prev) this.quad(prev[0], cur[0], cur[1], prev[1], A.white, col);
      prev = cur;
    }
  }
}
