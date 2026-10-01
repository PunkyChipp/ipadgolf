// The 3D view: a WebGL camera behind the ball.
//
// The ground is a lit terrain mesh. Fairways, tees and greens stay flat where
// the ball plays; the land rises into rolling hills away from the hole,
// bunkers sit in hollows, and water lies in its own beds. Heights are only
// visual: the simulation still plays on flat ground, so anything drawn on the
// course is lifted to the terrain under it.
//
// Surfaces take their colours from the painted course map and add procedural
// detail (grass grain, clumpy rough, sand), sunlight on the slopes, haze and a
// filmic grade. Water reflects the sky, ripples and glints. Trees are
// camera-facing sprites painted leaf by leaf. A sky dome carries the sun and
// clouds, and distant tree lines ring the horizon.

const TAU = Math.PI * 2;
const AW = 2048, AH = 1024; // sprite atlas size
const EDGE = 6; // terrain height at the edge of the painted area
const STEP = 2; // terrain grid spacing, yards

// Light and air for each course.
const SKIES = {
  links: { top: [0.16, 0.38, 0.8], horizon: [0.72, 0.83, 0.93], sun: [0.95, 0.9, 0.78], amb: [0.5, 0.56, 0.62], deep: [0.04, 0.17, 0.22], cloud: 0.4, exposure: 1.02, sunEl: 0.72, hills: 1, ring: [0.36, 0.5, 0.42] },
  augusta: { top: [0.13, 0.36, 0.82], horizon: [0.74, 0.85, 0.94], sun: [1.0, 0.93, 0.8], amb: [0.5, 0.56, 0.6], deep: [0.04, 0.16, 0.16], cloud: 0.25, exposure: 1.04, sunEl: 0.8, hills: 1.2, ring: [0.3, 0.45, 0.36] },
  standrews: { top: [0.44, 0.5, 0.57], horizon: [0.76, 0.79, 0.81], sun: [0.72, 0.72, 0.7], amb: [0.62, 0.65, 0.68], deep: [0.1, 0.17, 0.2], cloud: 0.9, exposure: 1.08, sunEl: 0.9, hills: 0.45, ring: [0.5, 0.55, 0.45] },
  pebble: { top: [0.18, 0.3, 0.62], horizon: [0.98, 0.78, 0.56], sun: [1.15, 0.86, 0.6], amb: [0.5, 0.5, 0.58], deep: [0.03, 0.14, 0.26], cloud: 0.45, exposure: 1.02, sunEl: 0.32, hills: 0.8, ring: [0.4, 0.42, 0.42] },
  sawgrass: { top: [0.1, 0.4, 0.86], horizon: [0.7, 0.85, 0.96], sun: [1.0, 0.96, 0.85], amb: [0.5, 0.57, 0.62], deep: [0.04, 0.16, 0.2], cloud: 0.5, exposure: 1.02, sunEl: 0.85, hills: 0.5, ring: [0.32, 0.46, 0.38] },
};
// The sun comes from the same side as the painted tree shadows (they fall
// toward +x, +y), so light and shadows agree.
function sunDir(el) {
  const az = Math.atan2(-0.8, -0.6);
  return [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
}

// ---------- matrices (column-major, like GL) ----------

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
    for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
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

// Smooth value noise for the terrain (0..1).
function makeNoise(seed) {
  const r = seeded(seed);
  const perm = new Float32Array(512);
  for (let i = 0; i < 512; i++) perm[i] = r();
  const h = (x, y) => perm[((x * 73856093) ^ (y * 19349663)) & 511];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

// ---------- shaders ----------

const COMMON = `
precision highp float;
uniform vec3 uEye;
uniform vec3 uFog;
uniform vec2 uFogRange;
uniform float uExposure;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Colour grade: a soft shoulder for highlights, a little more contrast and
// a richer, more natural saturation.
vec3 grade(vec3 c) {
  c *= uExposure;
  c = c / (1.0 + max(c - 0.75, 0.0) * 0.9);
  c = (c - 0.5) * 1.14 + 0.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.12);
  return clamp(c, 0.0, 1.0);
}
vec3 fogged(vec3 c, vec3 w, float amount) {
  float d = distance(uEye, w);
  float f = clamp((d - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  return mix(c, uFog, f * f * amount);
}`;

const TERRAIN_VS = `
attribute vec3 aPos;
attribute vec3 aNorm;
uniform mat4 uVP;
varying vec3 vW;
varying vec3 vN;
void main() {
  vW = aPos;
  vN = aNorm;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const TERRAIN_FS = COMMON + `
uniform sampler2D uTex;
uniform sampler2D uMask;
uniform sampler2D uNear;
uniform sampler2D uGreenTex;
uniform vec4 uBox;
uniform vec4 uNearBox;
uniform vec4 uGBox;
uniform float uHasNear;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec4 uGreen;
uniform float uGreenRot;
varying vec3 vW;
varying vec3 vN;
vec2 uvIn(vec4 b) { return (vW.xy - b.xy) / b.zw; }
float inside(vec2 uv, float edge) {
  vec2 e = min(uv, 1.0 - uv);
  return smoothstep(0.0, edge, min(e.x, e.y));
}
void main() {
  vec2 uv = uvIn(uBox);
  vec3 alb = texture2D(uTex, uv).rgb;
  float d = distance(uEye, vW);
  // Sharper paintings around the green and near the ball.
  vec2 gu = uvIn(uGBox);
  alb = mix(alb, texture2D(uGreenTex, gu).rgb, inside(gu, 0.04) * (1.0 - smoothstep(150.0, 260.0, d)));
  if (uHasNear > 0.5) {
    vec2 nu = uvIn(uNearBox);
    alb = mix(alb, texture2D(uNear, nu).rgb, inside(nu, 0.08));
  }
  // Real grass is less saturated than the painted map.
  alb = mix(vec3(dot(alb, vec3(0.299, 0.587, 0.114))), alb, 0.78) * vec3(1.02, 1.0, 0.9);
  vec3 m = texture2D(uMask, uv).rgb;
  float sand = smoothstep(0.6, 0.9, m.r);
  float shortg = smoothstep(0.35, 0.75, m.g) * (1.0 - sand);
  float longg = clamp(1.0 - shortg - sand - m.b, 0.0, 1.0);
  // The putting green (exact ellipse, so the edge stays crisp).
  vec2 q = vW.xy - uGreen.xy;
  float cr = cos(-uGreenRot), sr = sin(-uGreenRot);
  vec2 qr = vec2(q.x * cr - q.y * sr, q.x * sr + q.y * cr) / uGreen.zw;
  float green = 1.0 - smoothstep(0.96, 1.02, dot(qr, qr));
  float nearF = 1.0 - smoothstep(12.0, 90.0, d);
  float n1 = vnoise(vW.xy * 0.9), n2 = vnoise(vW.xy * 4.3), n3 = vnoise(vW.xy * 15.0), n4 = vnoise(vW.xy * 0.18);
  float n5 = vnoise(vW.xy * vec2(42.0, 9.0));
  float fine = mix(n2, n3, 0.5);
  // Short grass: tight grain and faint patchiness; greens are smoother still.
  float blades = vnoise(vW.xy * vec2(60.0, 14.0)) * 0.5 + vnoise(vW.xy * vec2(14.0, 60.0)) * 0.5;
  alb *= 1.0 + ((fine - 0.5) * 0.16 * nearF + (blades - 0.5) * 0.14 * nearF + (n4 - 0.5) * 0.09) * shortg * (1.0 - green * 0.55);
  // Rough: clumpy, with dry yellow-brown patches and blades up close.
  alb *= 1.0 + ((n1 * 0.55 + fine * 0.45) - 0.5) * 0.34 * longg + (n5 - 0.5) * 0.12 * longg * nearF;
  alb = mix(alb, alb * vec3(1.12, 1.05, 0.78), smoothstep(0.45, 0.8, n4) * 0.45 * longg);
  // Sand: bright and grainy, with rake marks up close.
  alb *= 1.0 + (n3 - 0.5) * 0.14 * sand + (sin(vW.x * 3.0 + n2 * 4.0) * 0.03) * sand * nearF;
  // Sun on the slopes, sky light everywhere else.
  vec3 N = normalize(vN);
  float dif = clamp(dot(N, uSun), 0.0, 1.0);
  vec3 col = alb * (uAmb + uSunCol * dif);
  // A soft sheen on short grass looking toward the sun.
  vec3 V = normalize(uEye - vW);
  float sheen = pow(clamp(dot(reflect(-uSun, N), V), 0.0, 1.0), 6.0);
  col += uSunCol * sheen * 0.05 * (shortg + green);
  col = fogged(col, vW, 1.0);
  gl_FragColor = vec4(grade(col), 1.0);
}`;

const WATER_FS = COMMON + `
uniform sampler2D uMask;
uniform vec4 uBox;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform float uTime;
varying vec3 vW;
varying vec3 vN;
void main() {
  float m = texture2D(uMask, (vW.xy - uBox.xy) / uBox.zw).b;
  float a = smoothstep(0.3, 0.6, m);
  if (a < 0.02) discard;
  vec2 p = vW.xy;
  float t = uTime;
  // Ripples: broad swells plus finer chop that fades with distance (no glitter far away).
  float dist = distance(uEye, vW);
  float nearW = 1.0 - smoothstep(15.0, 110.0, dist);
  float dx = (vnoise(p * 0.32 + vec2(t * 0.22, t * 0.08)) - 0.5) * 0.3 + ((vnoise(p * 1.05 - vec2(t * 0.36, -t * 0.28)) - 0.5) * 0.24 + (vnoise(p * 3.1 + t * 0.7) - 0.5) * 0.12) * nearW;
  float dy = (vnoise(p * 0.35 + vec2(5.2, 1.3) + t * 0.18) - 0.5) * 0.3 + ((vnoise(p * 1.1 + vec2(2.0, 9.0) - t * 0.33) - 0.5) * 0.24 + (vnoise(p * 3.3 + vec2(4.0, 1.0) - t * 0.6) - 0.5) * 0.12) * nearW;
  vec3 N = normalize(vec3(dx, dy, 1.0));
  vec3 V = normalize(uEye - vW);
  float fres = 0.03 + 0.97 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uTop, clamp(R.z * 1.6, 0.0, 1.0));
  vec3 col = mix(uDeep * (0.8 + 0.4 * vnoise(p * 0.08)), sky, fres);
  float sp = clamp(dot(R, uSun), 0.0, 1.0);
  col += uSunCol * (pow(sp, 260.0) * 2.2 * (0.3 + 0.7 * nearW) + pow(sp, 30.0) * 0.12);
  // Lighter, shallower water at the edges.
  col = mix(col, col * 1.25 + vec3(0.03, 0.05, 0.04), (1.0 - smoothstep(0.55, 0.95, m)) * 0.6);
  col = fogged(col, vW, 1.0);
  gl_FragColor = vec4(grade(col), a * 0.96);
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

const SPRITE_FS = COMMON + `
uniform sampler2D uTex;
uniform float uCut;
uniform float uFogOn;
uniform float uGrade;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vW;
void main() {
  vec4 c = texture2D(uTex, vUv) * vCol;
  if (c.a < uCut) discard;
  vec3 rgb = fogged(c.rgb, vW, uFogOn);
  gl_FragColor = vec4(mix(rgb, grade(rgb), uGrade), c.a);
}`;

const SKY_VS = `
attribute vec2 aPos;
varying vec2 vP;
void main() { vP = aPos; gl_Position = vec4(aPos, 0.9999, 1.0); }`;

const SKY_FS = COMMON + `
uniform mat4 uInv;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform float uTime;
uniform float uCloud;
varying vec2 vP;
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
void main() {
  vec4 w = uInv * vec4(vP, 1.0, 1.0);
  vec3 dir = normalize(w.xyz / w.w - uEye);
  float e = dir.z;
  vec3 col = mix(uHorizon, uTop, pow(clamp(e, 0.0, 1.0), 0.35));
  float sd = clamp(dot(dir, uSun), 0.0, 1.0);
  col = mix(col, uHorizon * vec3(1.05, 1.0, 0.95), (1.0 - smoothstep(0.0, 0.12, e)) * 0.5);
  col += uSunCol * (pow(sd, 1200.0) * 8.0 + pow(sd, 60.0) * 0.35 + pow(sd, 6.0) * 0.12);
  // Clouds on a plane high above, so they shrink toward the horizon.
  if (e > 0.005) {
    vec2 uv = (uEye.xy + dir.xy * (600.0 / e)) / 1400.0 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv * 3.0);
    float cover = smoothstep(0.62 - uCloud * 0.32, 0.92 - uCloud * 0.15, n);
    float shade = fbm(uv * 3.0 + vec2(0.06, 0.04));
    vec3 cl = mix(vec3(0.97, 0.98, 1.0), uHorizon * 0.82, clamp((shade - n) * 4.0 + 0.35, 0.0, 1.0));
    cl += uSunCol * pow(sd, 8.0) * 0.4;
    col = mix(col, cl, cover * smoothstep(0.0, 0.08, e) * 0.92);
  }
  if (e < 0.0) col = uFog;
  gl_FragColor = vec4(grade(col), 1.0);
}`;

// ---------- the sprite atlas: trees painted leaf by leaf ----------

const CELL_W = 256, CELL_H = 512;
const A = {
  oak: [[0, 0], [256, 0], [512, 0]],
  pine: [[768, 0], [1024, 0], [1280, 0]],
  palm: [[1536, 0], [1792, 0]],
  cypress: [[0, 512], [256, 512]],
  ball: [512, 512, 64, 64],
  shadow: [576, 512, 64, 64],
  ring: [640, 512, 128, 128],
  white: [772, 516, 8, 8],
  dot: [784, 512, 32, 32],
  ao: [816, 512, 64, 64],
};

function shadeColor(dark, light, k) {
  return `rgb(${Math.round(dark[0] + (light[0] - dark[0]) * k)},${Math.round(dark[1] + (light[1] - dark[1]) * k)},${Math.round(dark[2] + (light[2] - dark[2]) * k)})`;
}

// Light comes from the upper left of each sprite.
const LIGHT = (() => {
  const l = [-0.55, -0.6, 0.58];
  const n = Math.hypot(...l);
  return l.map((v) => v / n);
})();

// Foliage: thousands of small leaves inside a set of rounded lobes, each lit
// as if the lobe were a sphere, darker deep inside and underneath.
function foliage(c, r, lobes, count, dark, light, leaf = [2.2, 4.2], elong = 1.6) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const L = lobes[Math.floor(r() * lobes.length)];
    const a = r() * TAU, d = Math.sqrt(r());
    const ux = Math.cos(a) * d, uy = Math.sin(a) * d;
    const nz = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
    let k = ux * LIGHT[0] + uy * LIGHT[1] + nz * LIGHT[2];
    k = Math.max(0, k) * 0.85 + 0.1 + (r() - 0.5) * 0.25;
    k *= 0.75 + 0.25 * nz;
    k *= 1 - Math.max(0, uy) * 0.25;
    pts.push([L[0] + ux * L[2], L[1] + uy * L[3], Math.max(0, Math.min(1, k)), a]);
  }
  pts.sort((p, q) => p[2] - q[2]);
  for (const [x, y, k, a] of pts) {
    c.fillStyle = shadeColor(dark, light, k);
    const s = leaf[0] + r() * (leaf[1] - leaf[0]);
    c.beginPath();
    c.ellipse(x, y, s * elong * 0.5, s * 0.5, a + r(), 0, TAU);
    c.fill();
  }
}

function bark(c, r, x0, y0, x1, y1, w0, w1, base) {
  const g = c.createLinearGradient(x0 - w0, 0, x0 + w0, 0);
  g.addColorStop(0, shadeColor(base, [235, 215, 190], 0.25));
  g.addColorStop(0.45, `rgb(${base.join(',')})`);
  g.addColorStop(1, shadeColor([20, 14, 10], base, 0.45));
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x0 - w0, y0);
  c.lineTo(x1 - w1, y1);
  c.lineTo(x1 + w1, y1);
  c.lineTo(x0 + w0, y0);
  c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(20,12,6,0.35)';
  c.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const t = r(), s = (r() - 0.5) * 1.6;
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, w = w0 + (w1 - w0) * t;
    c.beginPath();
    c.moveTo(x + s * w, y);
    c.lineTo(x + s * w, y - 6 - r() * 10);
    c.stroke();
  }
}

function branch(c, x0, y0, x1, y1, w, col) {
  c.strokeStyle = col;
  c.lineWidth = w;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x0, y0);
  c.quadraticCurveTo((x0 + x1) / 2 + (y1 - y0) * 0.15, (y0 + y1) / 2, x1, y1);
  c.stroke();
}

function drawAtlas() {
  const cv = document.createElement('canvas');
  cv.width = AW;
  cv.height = AH;
  const c = cv.getContext('2d');
  const r = seeded(11);

  // Broadleaf trees: a stout trunk, branches, and a full rounded crown.
  A.oak.forEach(([ox, oy], k) => {
    c.save();
    c.translate(ox, oy);
    bark(c, r, 128, 512, 126, 300, 13, 8, [86, 64, 46]);
    branch(c, 126, 340, 70, 230, 7, '#4a3726');
    branch(c, 127, 320, 190, 220, 7, '#4a3726');
    branch(c, 126, 300, 120, 170, 6, '#4a3726');
    const lobes = [];
    const n = 7 + k;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + r();
      const d = 30 + r() * 30;
      lobes.push([128 + Math.cos(a) * d * 1.2, 200 + Math.sin(a) * d * 0.95 - 10, 52 + r() * 22, 46 + r() * 18]);
    }
    lobes.push([128, 190, 70, 64]);
    const pal = [[[18, 40, 16], [128, 170, 70]], [[20, 44, 22], [120, 176, 82]], [[16, 38, 20], [104, 156, 66]]][k];
    foliage(c, r, lobes, 5200, pal[0], pal[1]);
    c.restore();
  });

  // Loblolly pines: a long straight trunk and tufts of needles up top.
  A.pine.forEach(([ox, oy], k) => {
    c.save();
    c.translate(ox, oy);
    bark(c, r, 128, 512, 128, 40, 9, 4, [112, 78, 52]);
    const tufts = [];
    const n = 10 + k * 2;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const y = 50 + t * 210 + (r() - 0.5) * 16;
      const side = i % 2 ? 1 : -1;
      const reach = (18 + t * 62) * (0.7 + r() * 0.4);
      const x = 128 + side * reach * 0.55;
      branch(c, 128, y + 12, x, y, 3, '#5a3d29');
      tufts.push([x, y, 16 + t * 22, 11 + t * 9]);
    }
    tufts.push([128, 46, 18, 14]);
    const pal = [[[14, 34, 22], [92, 140, 84]], [[16, 38, 24], [88, 132, 80]], [[12, 30, 20], [80, 124, 74]]][k];
    foliage(c, r, tufts, 3800, pal[0], pal[1], [2, 5], 3.2);
    c.restore();
  });

  // Palms: a ringed, curving trunk and drooping fronds of fine leaflets.
  A.palm.forEach(([ox, oy], k) => {
    c.save();
    c.translate(ox, oy);
    const bend = k ? 28 : -22;
    const px = (t) => 128 + bend * Math.sin(t * Math.PI * 0.5) * t;
    c.lineCap = 'round';
    for (let i = 0; i < 48; i++) {
      const t0 = i / 48, t1 = (i + 1) / 48;
      c.strokeStyle = i % 2 ? '#8c7458' : '#7a6349';
      c.lineWidth = 14 - t0 * 5;
      c.beginPath();
      c.moveTo(px(t0), 512 - t0 * 380);
      c.lineTo(px(t1), 512 - t1 * 380);
      c.stroke();
    }
    const cx = px(1), cy = 132;
    for (let f = 0; f < 14; f++) {
      const a = -Math.PI / 2 + (f - 6.5) * 0.36 + (r() - 0.5) * 0.2;
      const len = 85 + r() * 25;
      const droop = 40 + r() * 50;
      const pts = [];
      for (let s = 0; s <= 24; s++) {
        const t = s / 24;
        pts.push([cx + Math.cos(a) * len * t, cy + Math.sin(a) * len * t * 0.55 + droop * t * t]);
      }
      const k2 = 0.35 + 0.6 * Math.max(0, -Math.cos(a + 0.6));
      for (let s = 1; s < pts.length; s++) {
        const [x0, y0] = pts[s - 1], [x1, y1] = pts[s];
        const ang = Math.atan2(y1 - y0, x1 - x0);
        const L = 22 * (1 - s / pts.length) + 6;
        for (const side of [-1, 1]) {
          c.strokeStyle = shadeColor([22, 60, 26], [120, 176, 78], Math.min(1, k2 + (r() - 0.5) * 0.3));
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(x1, y1);
          c.lineTo(x1 + Math.cos(ang + side * 1.1 + 0.35) * L, y1 + Math.sin(ang + side * 1.1 + 0.35) * L);
          c.stroke();
        }
      }
      c.strokeStyle = '#4f6b2e';
      c.lineWidth = 2.5;
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.stroke();
    }
    for (let i = 0; i < 5; i++) {
      c.fillStyle = '#6a5228';
      c.beginPath();
      c.arc(cx + (r() - 0.5) * 16, cy + 8 + r() * 8, 5, 0, TAU);
      c.fill();
    }
    c.restore();
  });

  // Monterey cypress: a gnarled trunk under flat, wind-shaped pads.
  A.cypress.forEach(([ox, oy], k) => {
    c.save();
    c.translate(ox, oy);
    bark(c, r, 128, 512, 118, 330, 16, 9, [92, 74, 60]);
    branch(c, 120, 360, 50, 300, 7, '#4d3c2e');
    branch(c, 122, 350, 210, 280, 7, '#4d3c2e');
    branch(c, 118, 330, 100, 230, 6, '#4d3c2e');
    const pads = [[60, 300, 52, 20], [200, 276, 56, 20], [110, 232, 70, 22], [150, 196, 54, 18], [80, 250, 40, 16]];
    const pal = [[[12, 30, 22], [74, 118, 82]], [[14, 34, 24], [80, 124, 86]]][k];
    foliage(c, r, pads, 3600, pal[0], pal[1], [2, 4], 2.2);
    c.restore();
  });

  // Ball, shadow, ambient occlusion, ring, white, soft dot.
  {
    const [x, y, w] = A.ball;
    const g = c.createRadialGradient(x + w * 0.38, y + w * 0.34, 2, x + w / 2, y + w / 2, w / 2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.65, '#eef1f0');
    g.addColorStop(1, '#a7b0b2');
    c.fillStyle = g;
    c.beginPath();
    c.arc(x + w / 2, y + w / 2, w / 2 - 1, 0, TAU);
    c.fill();
  }
  for (const [reg, a0] of [[A.shadow, 0.85], [A.ao, 0.6]]) {
    const [x, y, w] = reg;
    const g = c.createRadialGradient(x + w / 2, y + w / 2, 0, x + w / 2, y + w / 2, w / 2);
    g.addColorStop(0, `rgba(0,0,0,${a0})`);
    g.addColorStop(0.6, `rgba(0,0,0,${a0 * 0.45})`);
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
    c.fillStyle = 'rgba(255,255,255,0.16)';
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
  return cv;
}

// Distant tree lines and hills for the horizon: three layers, nearer ones darker.
function drawHorizon(seed) {
  const cv = document.createElement('canvas');
  cv.width = 2048;
  cv.height = 256;
  const c = cv.getContext('2d');
  const r = seeded(seed);
  const layers = [[0.42, [150, 168, 160]], [0.6, [96, 120, 104]], [0.78, [56, 78, 60]]];
  for (const [base, col] of layers) {
    c.fillStyle = `rgb(${col.join(',')})`;
    const hill = (x) => Math.sin((x / 2048) * TAU * 2 + base * 7) * 18 + Math.sin((x / 2048) * TAU * 5 + base * 3) * 8;
    c.beginPath();
    c.moveTo(0, 256);
    for (let x = 0; x <= 2048; x += 4) c.lineTo(x, 256 * base - hill(x) - 10);
    c.lineTo(2048, 256);
    c.fill();
    // Tree crowns along the ridge.
    for (let x = 0; x < 2048; x += 5 + r() * 6) {
      const y = 256 * base - hill(x) - 10;
      const s = 6 + r() * 12;
      c.beginPath();
      c.ellipse(x, y - s * 0.5, s * 0.6, s, 0, 0, TAU);
      c.fill();
    }
  }
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
    this.uint = this.gl2 || !!gl.getExtension('OES_element_index_uint');
    const common = ['uVP', 'uEye', 'uFog', 'uFogRange', 'uExposure'];
    try {
      this.terrainP = this.program(TERRAIN_VS, TERRAIN_FS, ['aPos', 'aNorm'], [...common, 'uTex', 'uMask', 'uNear', 'uGreenTex', 'uBox', 'uNearBox', 'uGBox', 'uHasNear', 'uSun', 'uSunCol', 'uAmb', 'uGreen', 'uGreenRot']);
      this.waterP = this.program(TERRAIN_VS, WATER_FS, ['aPos', 'aNorm'], [...common, 'uMask', 'uBox', 'uSun', 'uSunCol', 'uTop', 'uHorizon', 'uDeep', 'uTime']);
      this.spriteP = this.program(SPRITE_VS, SPRITE_FS, ['aPos', 'aUv', 'aCol'], [...common, 'uTex', 'uCut', 'uFogOn', 'uGrade']);
      this.skyP = this.program(SKY_VS, SKY_FS, ['aPos'], [...common, 'uInv', 'uTop', 'uHorizon', 'uSun', 'uSunCol', 'uTime', 'uCloud']);
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

  texture(src, mip, repeat = false) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const pot = (n) => (n & (n - 1)) === 0;
    const isPot = pot(src.width) && pot(src.height);
    const canMip = mip && (this.gl2 || isPot);
    if (canMip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, canMip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repeat && (this.gl2 || isPot) ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
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

  // ---------- building a hole ----------

  setHole(hole, R, palette) {
    if (!this.ok) return;
    const gl = this.gl;
    for (const t of [this.tex, this.gTex, this.maskTex, this.nearTex, this.horizonTex]) if (t) gl.deleteTexture(t);
    for (const b of [this.tVbo, this.tIbo, this.wVbo]) if (b) gl.deleteBuffer(b);
    this.nearTex = null;
    this.hole = hole;
    this.box = R.box;
    this.gbox = R.gbox;
    this.slopePts = R.slopePts;
    this.sky = SKIES[hole.course] || SKIES.links;
    this.sun = sunDir(this.sky.sunEl);
    this.tex = this.texture(R.base, true);
    this.gTex = this.texture(R.gLayer, true);
    const mask = R.paintMask(R.box, 1);
    this.maskTex = this.texture(mask, false);
    this.obColor = parseColor(palette.ob);
    this.buildTerrain(hole, mask);
    // Trees stand on the terrain; each gets a sprite, a tint, a width and maybe a mirror.
    this.trees = hole.trees.map((t, i) => {
      const kind = t.pine ? 'pine' : t.palm ? 'palm' : t.cypress ? 'cypress' : 'oak';
      const regs = A[kind];
      const reg = regs[Math.floor(t.shade * 997 + i) % regs.length];
      const k = 0.85 + t.shade * 0.25;
      const ratio = kind === 'pine' ? 0.5 : kind === 'palm' ? 0.62 : kind === 'cypress' ? 1.15 : 0.78;
      const h = t.h * (kind === 'oak' ? 1.05 : 1);
      return { x: t.x, y: t.y, z: this.heightAt(t.x, t.y) - 0.25, w: h * ratio, h, reg, flip: (i * 7919) % 2 === 1, col: [k, k, k * 0.97, 1] };
    });
    this.horizonTex = this.texture(drawHorizon(hole.index * 13 + 1), true, true);
  }

  // Heights: flat where the ball plays, hollows for sand and water, gentle
  // undulation in the rough, and hills rising away from the hole.
  buildTerrain(hole, mask) {
    const gl = this.gl;
    const box = this.box;
    let step = STEP;
    let gw = Math.ceil(box.w / step) + 1, gh = Math.ceil(box.h / step) + 1;
    if (!this.uint) {
      while (gw * gh > 65000) {
        step *= 1.25;
        gw = Math.ceil(box.w / step) + 1;
        gh = Math.ceil(box.h / step) + 1;
      }
    }
    const img = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
    const at = (x, y) => {
      const px = Math.max(0, Math.min(mask.width - 1, Math.floor(x - box.x)));
      const py = Math.max(0, Math.min(mask.height - 1, Math.floor(y - box.y)));
      const o = (py * mask.width + px) * 4;
      return [img[o], img[o + 1], img[o + 2]];
    };
    const N = gw * gh;
    const play = new Float32Array(N), base = new Float32Array(N);
    const noise = makeNoise(hole.index * 97 + 3);
    const sky = this.sky;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const x = box.x + i * step, y = box.y + j * step;
        const [R, G, B] = at(x, y);
        const k = j * gw + i;
        play[k] = R > 30 || G > 128 || B > 128 ? 1 : 0;
        let h = 0;
        if (R > 200) h = -0.5;
        else if (B > 128) h = -1.1;
        else if (G < 128 && R > 30) h = (noise(x / 9, y / 9) - 0.5) * 0.5;
        base[k] = h;
      }
    }
    // Closeness to the playing area, blurred wide, sets where hills rise.
    const blur = (a, passes) => {
      const t = new Float32Array(N);
      for (let p = 0; p < passes; p++) {
        for (let j = 0; j < gh; j++) {
          for (let i = 0; i < gw; i++) {
            let s = 0, n = 0;
            for (let dj = -1; dj <= 1; dj++) {
              const jj = j + dj;
              if (jj < 0 || jj >= gh) continue;
              for (let di = -1; di <= 1; di++) {
                const ii = i + di;
                if (ii < 0 || ii >= gw) continue;
                s += a[jj * gw + ii];
                n++;
              }
            }
            t[j * gw + i] = s / n;
          }
        }
        a.set(t);
      }
    };
    blur(play, 12);
    const H = new Float32Array(N);
    const t = hole.tee;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        const x = box.x + i * step, y = box.y + j * step;
        const far = Math.pow(1 - Math.min(1, play[k] * 1.6), 1.4);
        const hills = far * (2.2 + 6.5 * noise(x / 75, y / 75) + 1.6 * noise(x / 22, y / 22)) * sky.hills;
        // Rise to meet the plain at the edge of the painted area.
        const edge = Math.min(i, j, gw - 1 - i, gh - 1 - j) * step;
        const toEdge = Math.max(0, 1 - edge / 40);
        let h = base[k] + hills;
        h = h * (1 - toEdge) + EDGE * toEdge;
        // Tee boxes sit a little proud of the ground.
        if (Math.hypot(x - t.x, y - t.y) < t.ry + 2) h += 0.35;
        H[k] = h;
      }
    }
    blur(H, 2);
    this.grid = { H, gw, gh, step, x: box.x, y: box.y };
    // Vertex buffer: position and normal.
    const v = new Float32Array(N * 6);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        const hl = H[j * gw + Math.max(0, i - 1)], hr = H[j * gw + Math.min(gw - 1, i + 1)];
        const hd = H[Math.max(0, j - 1) * gw + i], hu = H[Math.min(gh - 1, j + 1) * gw + i];
        const nx = (hl - hr) / (2 * step), ny = (hd - hu) / (2 * step), nz = 1;
        const l = Math.hypot(nx, ny, nz);
        v[k * 6] = box.x + i * step;
        v[k * 6 + 1] = box.y + j * step;
        v[k * 6 + 2] = H[k];
        v[k * 6 + 3] = nx / l;
        v[k * 6 + 4] = ny / l;
        v[k * 6 + 5] = nz / l;
      }
    }
    const idx = this.uint ? new Uint32Array((gw - 1) * (gh - 1) * 6) : new Uint16Array((gw - 1) * (gh - 1) * 6);
    let o = 0;
    for (let j = 0; j < gh - 1; j++) {
      for (let i = 0; i < gw - 1; i++) {
        const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
        idx[o++] = a; idx[o++] = b; idx[o++] = d;
        idx[o++] = a; idx[o++] = d; idx[o++] = c;
      }
    }
    this.tVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tVbo);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    this.tIbo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.tIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.tCount = idx.length;
    this.tType = this.uint ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    // The water surface: one flat sheet; the shader shows it only over water.
    const wz = -0.12;
    const x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
    this.wVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.wVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x0, y0, wz, 0, 0, 1, x1, y0, wz, 0, 0, 1, x1, y1, wz, 0, 0, 1, x0, y0, wz, 0, 0, 1, x1, y1, wz, 0, 0, 1, x0, y1, wz, 0, 0, 1]), gl.STATIC_DRAW);
  }

  // Terrain height at a point (bilinear), for placing things on the ground.
  heightAt(x, y) {
    const g = this.grid;
    if (!g) return 0;
    const fx = (x - g.x) / g.step, fy = (y - g.y) / g.step;
    if (fx < 0 || fy < 0 || fx >= g.gw - 1 || fy >= g.gh - 1) return EDGE;
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const H = g.H, w = g.gw;
    const a = H[j * w + i], b = H[j * w + i + 1], c = H[(j + 1) * w + i], d = H[(j + 1) * w + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // A sharper painting of the area around the ball, for close-up views.
  setNear(canvas, box) {
    if (!this.ok) return;
    if (this.nearTex) this.gl.deleteTexture(this.nearTex);
    this.nearTex = this.texture(canvas, true);
    this.nearBox = box;
  }

  // ---------- sprite geometry (one dynamic buffer) ----------

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

  // Corners: bottom-left, bottom-right, top-right, top-left. reg in texture pixels.
  quad(p0, p1, p2, p3, reg, c, flip = false, tw = AW, th = AH) {
    const [rx, ry, rw, rh] = reg;
    let u0 = rx / tw, u1 = (rx + rw) / tw;
    if (flip) [u0, u1] = [u1, u0];
    const v0 = (ry + rh) / th, v1 = ry / th;
    this.vert(...p0, u0, v0, c);
    this.vert(...p1, u1, v0, c);
    this.vert(...p2, u1, v1, c);
    this.vert(...p0, u0, v0, c);
    this.vert(...p2, u1, v1, c);
    this.vert(...p3, u0, v1, c);
  }

  upright(x, y, z, w, h, reg, c, flip) {
    const e = this.eye;
    const dx = x - e[0], dy = y - e[1];
    const l = Math.hypot(dx, dy) || 1;
    const rx = (-dy / l) * (w / 2), ry = (dx / l) * (w / 2);
    this.quad([x - rx, y - ry, z], [x + rx, y + ry, z], [x + rx, y + ry, z + h], [x - rx, y - ry, z + h], reg, c, flip);
  }

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

  // Flat, at height z.
  flat(x, y, z, w, h, ang, reg, c) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const ux = ca * (w / 2), uy = sa * (w / 2), vx = -sa * (h / 2), vy = ca * (h / 2);
    this.quad([x - ux - vx, y - uy - vy, z], [x + ux - vx, y + uy - vy, z], [x + ux + vx, y + uy + vy, z], [x - ux + vx, y - uy + vy, z], reg, c);
  }

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

  // A line lying on the terrain.
  groundLine(pts, w, c, dash = 0) {
    for (let i = 1; i < pts.length; i++) {
      if (dash && Math.floor(i / dash) % 2) continue;
      const a = pts[i - 1], b = pts[i];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const l = Math.hypot(nx, ny) || 1;
      const ww = Math.max(w, Math.hypot(a[0] - this.eye[0], a[1] - this.eye[1]) * 0.0035) / 2;
      nx = (nx / l) * ww; ny = (ny / l) * ww;
      const za = this.heightAt(a[0], a[1]) + 0.05, zb = this.heightAt(b[0], b[1]) + 0.05;
      this.quad([a[0] - nx, a[1] - ny, za], [a[0] + nx, a[1] + ny, za], [b[0] + nx, b[1] + ny, zb], [b[0] - nx, b[1] - ny, zb], A.white, c);
    }
  }

  attribs(list, stride) {
    const gl = this.gl;
    for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i);
    for (const [loc, size, off] of list) {
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
    }
  }

  common(p) {
    const gl = this.gl;
    if (p.u.uVP) gl.uniformMatrix4fv(p.u.uVP, false, this.vp);
    gl.uniform3fv(p.u.uEye, this.eye);
    gl.uniform3fv(p.u.uFog, this.sky.horizon);
    gl.uniform2f(p.u.uFogRange, this.fogNear, this.fogFar);
    gl.uniform1f(p.u.uExposure, this.sky.exposure);
  }

  flush(cut, { fog = 1, grade = 1, tex = null } = {}) {
    if (!this.n) return;
    const gl = this.gl, s = this.spriteP;
    gl.useProgram(s.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.verts.subarray(0, this.n * 9), gl.DYNAMIC_DRAW);
    this.attribs([[s.a.aPos, 3, 0], [s.a.aUv, 2, 12], [s.a.aCol, 4, 20]], 36);
    this.common(s);
    gl.uniform1f(s.u.uCut, cut);
    gl.uniform1f(s.u.uFogOn, fog);
    gl.uniform1f(s.u.uGrade, grade);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex || this.atlas);
    gl.uniform1i(s.u.uTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.n);
    this.n = 0;
  }

  // ---------- camera ----------

  setCamera(cam) {
    const aspect = this.w / this.h;
    const fov = ((cam.fov || (aspect < 1 ? 66 : 56)) * Math.PI) / 180;
    this.eye = cam.eye;
    const view = lookAt(cam.eye, cam.target, [0, 0, 1]);
    this.proj = perspective(fov, aspect, 0.15, 6000);
    // Centre the picture in the visible area, between the top bar and the panel.
    const top = cam.insetTop || 0, bottom = cam.insetBottom || 0;
    this.proj[9] = -(1 - (top + this.h - bottom) / this.h);
    this.vp = mul(this.proj, view);
    this.inv = invert(this.vp);
    this.right = [view[0], view[4], view[8]];
    this.up = [view[1], view[5], view[9]];
    this.fogNear = 160;
    this.fogFar = 1500;
  }

  project(x, y, z = 0) {
    if (!this.vp) return null;
    const [cx, cy, , cw] = xform(this.vp, x, y, z);
    if (cw <= 0.01) return null;
    return [((cx / cw) * 0.5 + 0.5) * this.w, (1 - ((cy / cw) * 0.5 + 0.5)) * this.h];
  }

  // Where a screen point meets the ground (a level plane at height h).
  toWorld(sx, sy, h = 0) {
    const nx = (sx / this.w) * 2 - 1, ny = 1 - (sy / this.h) * 2;
    const a = xform(this.inv, nx, ny, -1), b = xform(this.inv, nx, ny, 1);
    const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    let t = d[2] < -1e-6 ? (h - p0[2]) / d[2] : 1;
    const len = Math.hypot(d[0], d[1], d[2]) * t;
    if (d[2] >= -1e-6 || len > 1500 || t < 0) t = 1500 / Math.hypot(d[0], d[1], d[2]);
    return [p0[0] + d[0] * t, p0[1] + d[1] * t];
  }

  // ---------- drawing ----------

  draw(scene) {
    if (!this.ok || !this.hole) return;
    const gl = this.gl, sky = this.sky;
    this.time = scene.time;
    this.setCamera(scene.cam);
    gl.viewport(0, 0, this.cv.width, this.cv.height);
    gl.clearColor(...sky.horizon, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);

    // Sky dome.
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    {
      const p = this.skyP;
      gl.useProgram(p.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
      this.attribs([[p.a.aPos, 2, 0]], 8);
      this.common(p);
      gl.uniformMatrix4fv(p.u.uInv, false, this.inv);
      gl.uniform3fv(p.u.uTop, sky.top);
      gl.uniform3fv(p.u.uHorizon, sky.horizon);
      gl.uniform3fv(p.u.uSun, this.sun);
      gl.uniform3fv(p.u.uSunCol, sky.sun);
      gl.uniform1f(p.u.uTime, this.time);
      gl.uniform1f(p.u.uCloud, sky.cloud);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // Distant tree lines all round, hazy, and the plain beyond the hole.
    {
      const cx = this.box.x + this.box.w / 2, cy = this.box.y + this.box.h / 2;
      const R = 2400, segs = 48, top = EDGE + 60 + 70 * sky.hills;
      const ring = sky.ring;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
        const p0 = [cx + Math.cos(a0) * R, cy + Math.sin(a0) * R], p1 = [cx + Math.cos(a1) * R, cy + Math.sin(a1) * R];
        const u0 = (i / segs) * 6 * 2048, u1 = ((i + 1) / segs) * 6 * 2048;
        this.quad([p0[0], p0[1], EDGE - 2], [p1[0], p1[1], EDGE - 2], [p1[0], p1[1], top], [p0[0], p0[1], top], [u0, 0, u1 - u0, 256], [ring[0] * 2.3, ring[1] * 2.3, ring[2] * 2.3, 1], false, 2048, 256);
      }
      this.flush(0.02, { fog: 0.55, tex: this.horizonTex });
      // The plain beyond the hole: a frame around the terrain, never under it.
      const big = 5000, ob = this.obColor, z = EDGE - 0.05;
      const bx0 = this.box.x, by0 = this.box.y, bx1 = this.box.x + this.box.w, by1 = this.box.y + this.box.h;
      const col = [ob[0] * 0.85, ob[1] * 0.85, ob[2] * 0.85, 1];
      const X0 = cx - big, X1 = cx + big, Y0 = cy - big, Y1 = cy + big;
      for (const [x0, y0, x1, y1] of [[X0, Y0, X1, by0], [X0, by1, X1, Y1], [X0, by0, bx0, by1], [bx1, by0, X1, by1]]) {
        this.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], A.white, col);
      }
      this.flush(0);
    }

    // The terrain.
    {
      const p = this.terrainP, g = this.hole.green;
      gl.useProgram(p.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tVbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.tIbo);
      this.attribs([[p.a.aPos, 3, 0], [p.a.aNorm, 3, 12]], 24);
      this.common(p);
      [[this.tex, 'uTex'], [this.maskTex, 'uMask'], [this.nearTex || this.tex, 'uNear'], [this.gTex, 'uGreenTex']].forEach(([t, name], i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform1i(p.u[name], i);
      });
      const b = this.box, gb = this.gbox, nb = this.nearBox || b;
      gl.uniform4f(p.u.uBox, b.x, b.y, b.w, b.h);
      gl.uniform4f(p.u.uGBox, gb.x, gb.y, gb.w, gb.h);
      gl.uniform4f(p.u.uNearBox, nb.x, nb.y, nb.w, nb.h);
      gl.uniform1f(p.u.uHasNear, this.nearTex ? 1 : 0);
      gl.uniform3fv(p.u.uSun, this.sun);
      gl.uniform3fv(p.u.uSunCol, sky.sun.map((v) => v * 0.62));
      gl.uniform3fv(p.u.uAmb, sky.amb);
      gl.uniform4f(p.u.uGreen, g.x, g.y, g.rx, g.ry);
      gl.uniform1f(p.u.uGreenRot, g.rot || 0);
      gl.drawElements(gl.TRIANGLES, this.tCount, this.tType, 0);
      gl.activeTexture(gl.TEXTURE0);
    }

    // Water.
    {
      const p = this.waterP;
      gl.useProgram(p.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.wVbo);
      this.attribs([[p.a.aPos, 3, 0], [p.a.aNorm, 3, 12]], 24);
      this.common(p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.uniform1i(p.u.uMask, 0);
      const b = this.box;
      gl.uniform4f(p.u.uBox, b.x, b.y, b.w, b.h);
      gl.uniform3fv(p.u.uSun, this.sun);
      gl.uniform3fv(p.u.uSunCol, sky.sun);
      gl.uniform3fv(p.u.uTop, sky.top);
      gl.uniform3fv(p.u.uHorizon, sky.horizon);
      gl.uniform3fv(p.u.uDeep, sky.deep);
      gl.uniform1f(p.u.uTime, this.time);
      gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
    }

    // Things on the ground: slope arrows, cup, tree shade, aim guide, shadows, rings.
    const sc = scene;
    const H = (x, y) => this.heightAt(x, y);
    const e = this.eye;
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2, -4);
    if (sc.slope && this.slopePts) {
      for (const p of this.slopePts) {
        const strength = Math.min(1, p.m / 0.03);
        const ph = (sc.time * (0.3 + strength * 0.9) + p.ph) % 1;
        const len = 0.35 + strength * 0.7;
        const ox = p.x + p.dx * len * (ph - 0.5), oy = p.y + p.dy * len * (ph - 0.5);
        const a = Math.sin(ph * Math.PI) * (0.25 + strength * 0.5);
        this.flat(ox, oy, H(ox, oy) + 0.03, 0.42, 0.06, Math.atan2(p.dy, p.dx), A.white, strength > 0.6 ? [1, 0.95, 0.66, a] : [1, 1, 1, a]);
      }
    }
    const pin = this.hole.pin;
    const pinZ = H(pin.x, pin.y);
    this.teeMarkers = [-1, 1].map((k) => {
      const t = this.hole.tee;
      const x = t.x + Math.cos(t.ang + Math.PI / 2) * 3 * k, y = t.y + Math.sin(t.ang + Math.PI / 2) * 3 * k;
      return [x, y, H(x, y)];
    });
    for (const [x, y, z] of this.teeMarkers) this.flat(x, y, z + 0.02, 0.5, 0.5, 0, A.shadow, [0, 0, 0, 0.4]);
    this.flat(pin.x, pin.y, pinZ + 0.02, 0.17, 0.17, 0, A.shadow, [0, 0, 0, 1]);
    for (const t of this.trees) {
      if (Math.abs(t.x - e[0]) > 300 || Math.abs(t.y - e[1]) > 300) continue;
      this.flat(t.x, t.y, t.z + 0.28, t.w * 0.9, t.w * 0.9, 0, A.ao, [0, 0, 0, 0.5]);
    }
    if (sc.aim) this.drawAim(sc.aim);
    for (const b of sc.balls) {
      const g = H(b.x, b.y);
      const s = Math.max(0.1, 0.3 - b.z * 0.01);
      this.flat(b.x, b.y, g + 0.03, s * (1 + b.z * 0.05), s * (1 + b.z * 0.05), 0, A.shadow, [0, 0, 0, Math.max(0.12, 0.55 - b.z * 0.02)]);
      if (b.ring) {
        const pulse = 0.9 + Math.sin(sc.time * 4) * 0.1;
        const d = Math.hypot(b.x - e[0], b.y - e[1]);
        const rr = Math.max(0.9, d * 0.045) * pulse;
        this.flat(b.x, b.y, g + 0.04, rr, rr, 0, A.ring, [...b.col.slice(0, 3), 0.95]);
      }
    }
    for (const p of sc.particles || []) {
      if (!p.ring) continue;
      const f = Math.max(0, p.life / p.max);
      const r = (p.r1 + (p.r0 - p.r1) * f) * 2;
      const c = parseColor(p.color);
      this.flat(p.x, p.y, H(p.x, p.y) + 0.05, r, r, 0, A.ring, [c[0], c[1], c[2], c[3] * f]);
    }
    this.flush(0.01, { grade: 0 });
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // Trees and the flagstick, with depth.
    gl.depthMask(true);
    const reach = 1400;
    for (const t of this.trees) {
      if (Math.abs(t.x - e[0]) > reach || Math.abs(t.y - e[1]) > reach) continue;
      if (Math.hypot(t.x - e[0], t.y - e[1]) < t.w * 0.45 + 2.5) continue;
      this.upright(t.x, t.y, t.z, t.w, t.h, [t.reg[0], t.reg[1], CELL_W, CELL_H], t.col, t.flip);
    }
    this.drawFlag(sc, pinZ);
    this.flush(0.45);

    // Tracers, balls and particles.
    gl.depthMask(false);
    for (const t of sc.trails || []) {
      if (t.length < 2) continue;
      this.ribbon(t, 0.0045, [1, 0.97, 0.85, 0.85], 0, true);
      this.ribbon(t, 0.0016, [1, 1, 1, 1], 0, true);
    }
    const mc = this.hole.course === 'augusta' ? [0.2, 0.55, 0.32, 1] : this.hole.course === 'standrews' ? [0.85, 0.2, 0.22, 1] : [1, 1, 1, 1];
    for (const [x, y, z] of this.teeMarkers || []) this.facing(x, y, z + 0.08, 0.16, A.ball, mc);
    for (const b of sc.balls) {
      const g = b.zAbs != null ? b.zAbs : H(b.x, b.y) + b.z;
      const d = Math.hypot(b.x - e[0], b.y - e[1], g + 0.03 - e[2]);
      const s = Math.max(0.09, d * 0.011);
      this.facing(b.x, b.y, g + Math.max(0.04, s * 0.45), s, A.ball, [1, 1, 1, 1]);
      if (b.col) this.facing(b.x, b.y, g + Math.max(0.04, s * 0.45), s * 1.25, A.ring, [...b.col.slice(0, 3), 0.75]);
    }
    for (const p of sc.particles || []) {
      if (p.ring) continue;
      const f = Math.max(0, p.life / p.max);
      const c = parseColor(p.color);
      this.facing(p.x, p.y, H(p.x, p.y) + p.z * 0.6 + 0.05, Math.max(p.size * 2.2, 0.08), A.dot, [c[0], c[1], c[2], c[3] * f]);
    }
    this.flush(0.01, { grade: 0 });
    gl.depthMask(true);
  }

  drawAim(aim) {
    const c = aim.color || [1, 1, 1, 0.95];
    if (aim.arc && aim.arc.length > 1) {
      this.groundLine(aim.arc.map((p) => [p[0], p[1]]), 0.12, [0, 0, 0, 0.22], 3);
      this.ribbon(aim.arc, 0.0032, c, 3, false, 0.25);
    }
    if (aim.roll && aim.roll.length > 1) this.groundLine(aim.roll, aim.putt ? 0.09 : 0.16, aim.putt ? [1, 0.96, 0.7, 0.95] : [c[0], c[1], c[2], 0.85], 2);
    if (aim.ring) {
      const { x, y, r } = aim.ring;
      const d = Math.hypot(x - this.eye[0], y - this.eye[1]);
      const rr = Math.max(r * 2, d * 0.035);
      this.flat(x, y, this.heightAt(x, y) + 0.06, rr, rr, 0, A.ring, c);
    }
    if (aim.end) {
      const d = Math.hypot(aim.end.x - this.eye[0], aim.end.y - this.eye[1]);
      const rr = Math.max(0.5, d * 0.018);
      this.flat(aim.end.x, aim.end.y, this.heightAt(aim.end.x, aim.end.y) + 0.06, rr, rr, 0, A.ring, c);
    }
  }

  drawFlag(sc, base) {
    const p = this.hole.pin, e = this.eye;
    const d = Math.hypot(p.x - e[0], p.y - e[1]);
    const H = 2.4; // a 7 ft flagstick
    const w = Math.max(0.035, d * 0.0028);
    this.upright(p.x, p.y, base, w, H, A.white, [0.95, 0.94, 0.9, 1]);
    const wind = sc.wind || { speed: 5, dir: 0 };
    const big = Math.max(1, d * 0.012);
    const len = 0.75 * (0.6 + Math.min(1, wind.speed / 16) * 0.4) * big;
    const hgt = 0.5 * big;
    const wx = Math.cos(wind.dir), wy = Math.sin(wind.dir);
    const col = sc.flagColor || [1, 0.82, 0.25, 1];
    const segs = 6;
    let prev = null;
    for (let i = 0; i <= segs; i++) {
      const k = i / segs;
      const ph = sc.time * (4 + wind.speed * 0.35) - k * 5;
      const wave = Math.sin(ph) * 0.12 * k * len;
      const x = p.x + wx * len * k - wy * wave, y = p.y + wy * len * k + wx * wave;
      const top = base + H - k * 0.05, bot = base + H - hgt + k * 0.05;
      const shade = 0.82 + 0.18 * Math.cos(ph);
      const cur = [[x, y, bot], [x, y, top]];
      if (prev) this.quad(prev[0], cur[0], cur[1], prev[1], A.white, [col[0] * shade, col[1] * shade, col[2] * shade, 1]);
      prev = cur;
    }
  }
}
