// The 3D view, built on three.js (bundled in src/vendor so it works offline).
//
// Art direction: a bright, clean, stylised look in the spirit of modern
// sports games. Soft sun with real-time shadows and sky light, rolling
// terrain with crisp mown stripes and checkered greens, chunky 3D trees,
// grass tufts swaying in the rough, puffy clouds, glassy stylised water,
// a gentle bloom and vignette.
//
// The simulation still plays on flat ground; the terrain heights here are
// visual, and anything drawn on the course is lifted to the ground under it.
// World units are yards with z up.

const TAU = Math.PI * 2;
const EDGE = 6; // terrain height at the edge of the course area
const STEP = 2; // terrain grid spacing, yards
const VERSIONED = new URL(import.meta.url).search; // same ?v= as this file

// Colours and light for each course (sRGB hex).
const LOOKS = {
  links: {
    skyTop: '#3d8fe0', skyHorizon: '#cfe7f7', sun: '#fff1d6', sunI: 2.6, hemiSky: '#cfe6ff', hemiGround: '#5a7d3a', hemiI: 1.3, exposure: 1.0,
    ob: '#4f9a3f', deep: '#5aa646', rough: '#66b34c', fairway: '#86cf5c', fairway2: '#79c352', fringe: '#7fcb59', green: '#97de6c', green2: '#8bd462',
    sand: '#f3e2b2', sandLip: '#c9b07a', bed: '#2f6f80', water: '#2fa3c4', deepWater: '#1a6c8f', tree: ['#3f8f3a', '#4ea544', '#2f7a3a'], trunk: '#7a5634',
    hills: ['#5aa04d', '#6fb35a', '#4f8f48'], sunEl: 0.85, cloud: 1, fogNear: 260, fogFar: 1700, hillsH: 1,
  },
  augusta: {
    skyTop: '#2f84df', skyHorizon: '#d6ecf8', sun: '#fff3dd', sunI: 2.7, hemiSky: '#d2e8ff', hemiGround: '#4c7a37', hemiI: 1.25, exposure: 1.0,
    ob: '#3f8a3a', deep: '#4c9a40', rough: '#5aa847', fairway: '#7ccb58', fairway2: '#6dbd4f', fringe: '#79c656', green: '#93dd69', green2: '#85d25e',
    sand: '#fbf6ea', sandLip: '#d2c8b0', bed: '#2a5f63', water: '#2a9fb8', deepWater: '#176a86', tree: ['#2e7a3c', '#3c8f46', '#256a36'], trunk: '#8a5a3a',
    hills: ['#3f8a45', '#56a04f', '#357a40'], sunEl: 0.9, cloud: 0.8, fogNear: 260, fogFar: 1700, hillsH: 1.2, straw: '#c79b62', flowers: true,
  },
  standrews: {
    skyTop: '#7f97ae', skyHorizon: '#dfe5e9', sun: '#f4efe6', sunI: 1.7, hemiSky: '#e4ecf2', hemiGround: '#8c8f55', hemiI: 1.6, exposure: 1.05,
    ob: '#9aa25a', deep: '#a3a660', rough: '#b0b56a', fairway: '#8fcf63', fairway2: '#84c35a', fringe: '#88c85e', green: '#98d86c', green2: '#8ccd63',
    sand: '#ead8a6', sandLip: '#8d7a4c', bed: '#3a6a76', water: '#3b8fa6', deepWater: '#245f74', tree: ['#3b6f35', '#4a7f3a', '#355f2f'], trunk: '#6a5233',
    hills: ['#93a05a', '#a6ad66', '#7f8f50'], sunEl: 0.95, cloud: 2.2, fogNear: 200, fogFar: 1400, hillsH: 0.4, gorse: true,
  },
  pebble: {
    skyTop: '#4a74c9', skyHorizon: '#ffd7a8', sun: '#ffd29a', sunI: 2.5, hemiSky: '#ffd9b8', hemiGround: '#4f7a3f', hemiI: 1.15, exposure: 1.0,
    ob: '#4f9440', deep: '#5aa046', rough: '#64ac4c', fairway: '#82cd5c', fairway2: '#74bf52', fringe: '#7cc858', green: '#94dc6a', green2: '#87d160',
    sand: '#f2e1b5', sandLip: '#b9a072', bed: '#1d4f73', water: '#2f8fc8', deepWater: '#1a5c94', tree: ['#2b5f3f', '#336b45', '#285738'], trunk: '#6b5040',
    hills: ['#4f8f45', '#5f9f50', '#477f40'], sunEl: 0.42, cloud: 1.1, fogNear: 260, fogFar: 1700, hillsH: 0.8, rock: '#a69a86',
  },
  sawgrass: {
    skyTop: '#2b8ff0', skyHorizon: '#cdeeff', sun: '#fff6e2', sunI: 2.8, hemiSky: '#d6efff', hemiGround: '#5a8a3c', hemiI: 1.25, exposure: 1.0,
    ob: '#4c9a3e', deep: '#57a644', rough: '#62b14b', fairway: '#82d35d', fairway2: '#73c552', fringe: '#7ccc57', green: '#95e06b', green2: '#88d562',
    sand: '#f6ead0', sandLip: '#cbb88f', bed: '#285f6c', water: '#2aa8c0', deepWater: '#167089', tree: ['#3e9642', '#4aa64b', '#33843b'], trunk: '#8a6e4c',
    hills: ['#4f9a48', '#62ad55', '#468a43'], sunEl: 0.95, cloud: 1.2, fogNear: 260, fogFar: 1700, hillsH: 0.5,
  },
};

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

// '#rrggbb' or 'rgba(r,g,b,a)' to [r, g, b, a] in 0..1 (used by the game too).
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

// ---------- the painted surface: clean stylised turf ----------

function ellipse(c, e, grow = 0) {
  c.beginPath();
  c.ellipse(e.x, e.y, Math.max(0.01, e.rx + grow), Math.max(0.01, e.ry + grow), e.rot || 0, 0, TAU);
}

function pointAt(P, s) {
  let i = 1;
  while (i < P.length - 1 && P[i].s < s) i++;
  const a = P[i - 1], b = P[i];
  const t = Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s || 1)));
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  return { x: a.x + dx * t, y: a.y + dy * t, nx: -dy / l, ny: dx / l };
}

function paintTurf(hole, box, px, L) {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(box.w * px);
  cv.height = Math.ceil(box.h * px);
  const c = cv.getContext('2d');
  c.setTransform(px, 0, 0, px, -box.x * px, -box.y * px);
  const r = seeded(hole.index * 31 + 7);
  const P = hole.path;
  c.fillStyle = L.ob;
  c.fillRect(box.x, box.y, box.w, box.h);
  c.lineCap = c.lineJoin = 'round';
  c.strokeStyle = L.deep;
  c.lineWidth = hole.bounds * 2;
  c.beginPath();
  P.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.stroke();
  // Big soft patches of lighter and darker grass.
  for (let i = 0; i < 140; i++) {
    const x = box.x + r() * box.w, y = box.y + r() * box.h, rr = 8 + r() * 26;
    const g = c.createRadialGradient(x, y, 0, x, y, rr);
    const light = r() < 0.5;
    g.addColorStop(0, light ? 'rgba(255,255,210,0.09)' : 'rgba(0,40,0,0.09)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  const discs = (from, to, extra) => {
    c.beginPath();
    for (const p of P) {
      if (p.s < from || p.s > to) continue;
      const rr = hole.halfWidth(p.s) + extra;
      c.moveTo(p.x + rr, p.y);
      c.arc(p.x, p.y, rr, 0, TAU);
    }
  };
  // Pine straw under Augusta's trees.
  if (L.straw) {
    c.fillStyle = L.straw;
    c.beginPath();
    for (const t of hole.trees) {
      c.moveTo(t.x + t.r * 1.6, t.y);
      c.arc(t.x, t.y, t.r * 1.6, 0, TAU);
    }
    c.fill('nonzero');
  }
  discs(0, Infinity, hole.roughW);
  c.fillStyle = L.rough;
  c.fill('nonzero');
  if (hole.fwFrom < hole.fwTo) {
    // A darker first cut, then the fairway with broad mown stripes.
    discs(hole.fwFrom, hole.fwTo, 1.2);
    c.fillStyle = L.fairway2;
    c.fill('nonzero');
    c.save();
    discs(hole.fwFrom, hole.fwTo, 0);
    c.fillStyle = L.fairway;
    c.fill('nonzero');
    c.clip('nonzero');
    let on = false;
    for (let s = hole.fwFrom - 30; s < hole.fwTo + 30; s += 9) {
      on = !on;
      if (!on) continue;
      const a = pointAt(P, s), b = pointAt(P, s + 9);
      const w = hole.halfWidth(s) + 6;
      c.beginPath();
      c.moveTo(a.x + a.nx * w, a.y + a.ny * w);
      c.lineTo(b.x + b.nx * w, b.y + b.ny * w);
      c.lineTo(b.x - b.nx * w, b.y - b.ny * w);
      c.lineTo(a.x - a.nx * w, a.y - a.ny * w);
      c.fillStyle = L.fairway2;
      c.fill();
    }
    c.restore();
  }
  // Tee box with stripes.
  const t = hole.tee;
  c.save();
  c.translate(t.x, t.y);
  c.rotate(t.rot);
  c.fillStyle = L.fairway;
  c.beginPath();
  c.roundRect ? c.roundRect(-t.rx, -t.ry, t.rx * 2, t.ry * 2, 1.5) : c.rect(-t.rx, -t.ry, t.rx * 2, t.ry * 2);
  c.fill();
  c.clip();
  c.fillStyle = L.fairway2;
  for (let i = -t.ry; i < t.ry; i += 3) c.fillRect(-t.rx, i, t.rx * 2, 1.5);
  c.restore();
  // Water beds and sea cliffs (the water surface is drawn separately).
  for (const w of hole.water) {
    if (w.line) {
      c.strokeStyle = L.sandLip;
      c.lineWidth = w.w + 2;
      c.beginPath();
      w.line.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.stroke();
      c.strokeStyle = L.bed;
      c.lineWidth = w.w;
      c.stroke();
    } else {
      if (w.sea && L.rock) {
        ellipse(c, w, 4);
        c.fillStyle = L.rock;
        c.fill();
      } else {
        ellipse(c, w, 1.2);
        c.fillStyle = L.sandLip;
        c.fill();
      }
      ellipse(c, w);
      c.fillStyle = L.bed;
      c.fill();
    }
  }
  // Fringe and green with a checkerboard cut.
  const g = hole.green;
  ellipse(c, g, 2.6);
  c.fillStyle = L.fringe;
  c.fill();
  c.save();
  ellipse(c, g);
  c.fillStyle = L.green;
  c.fill();
  c.clip();
  c.translate(g.x, g.y);
  c.rotate((g.rot || 0) + 0.6);
  c.fillStyle = L.green2;
  const R = Math.max(g.rx, g.ry) + 3;
  for (let y = -R; y < R; y += 2.5) for (let x = -R; x < R; x += 2.5) if (((Math.floor(x / 2.5) + Math.floor(y / 2.5)) & 1) === 0) c.fillRect(x, y, 2.5, 2.5);
  c.restore();
  // Bunkers: a darker lip and bright sand.
  for (const b of hole.bunkers) {
    ellipse(c, b, 0.7);
    c.fillStyle = L.sandLip;
    c.fill();
    ellipse(c, b);
    const gr = c.createRadialGradient(b.x - b.rx * 0.2, b.y - b.ry * 0.25, 0, b.x, b.y, Math.max(b.rx, b.ry));
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.35, L.sand);
    gr.addColorStop(1, L.sand);
    c.fillStyle = gr;
    c.fill();
  }
  // Bridges.
  for (const br of hole.bridges || []) {
    c.save();
    c.translate(br.x, br.y);
    c.rotate(br.ang);
    c.fillStyle = '#d8d0bf';
    c.fillRect(-br.len / 2, -1.1, br.len, 2.2);
    c.fillStyle = '#a79f8c';
    c.fillRect(-br.len / 2, -1.1, br.len, 0.35);
    c.fillRect(-br.len / 2, 0.75, br.len, 0.35);
    c.restore();
  }
  return cv;
}

// ---------- the view ----------

export class View3D {
  constructor(canvas) {
    this.cv = canvas;
    this.ok = false;
    this.hole = null;
    this.grid = null;
    this.ready = this.init().catch((e) => {
      console.warn('3D view unavailable', e);
      this.ok = false;
    });
  }

  async init() {
    const T = await import('./vendor/three.bundle.min.js' + VERSIONED);
    this.T = T;
    const renderer = new T.WebGLRenderer({ canvas: this.cv, antialias: false, powerPreference: 'high-performance', alpha: false });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 needed');
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer = renderer;
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(56, 1, 0.15, 6000);
    this.camera.up.set(0, 0, 1);

    // Lights: sun with soft shadows, plus sky light.
    this.hemi = new T.HemisphereLight(0xffffff, 0x446622, 1.2);
    this.hemi.up = new T.Vector3(0, 0, 1);
    this.hemi.position.set(0, 0, 1);
    this.scene.add(this.hemi);
    const sun = new T.DirectionalLight(0xffffff, 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 1; sc.far = 600;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    this.sunLight = sun;

    // Post: MSAA render, gentle bloom, vignette, tone mapping.
    const rt = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType, samples: 4 });
    this.composer = new T.EffectComposer(renderer, rt);
    this.composer.addPass(new T.RenderPass(this.scene, this.camera));
    this.bloom = new T.UnrealBloomPass(new T.Vector2(256, 256), 0.32, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.vignette = new T.ShaderPass({
      uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.32 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmount; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          vec2 d = vUv - 0.5;
          float v = 1.0 - dot(d, d) * uAmount * 2.2;
          c.rgb *= v;
          // A little extra richness in the mid-tones.
          float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          c.rgb = mix(vec3(l), c.rgb, 1.08);
          gl_FragColor = c;
        }`,
    });
    this.composer.addPass(this.vignette);
    this.composer.addPass(new T.OutputPass());

    // Quality: 2 = everything, 1 = no bloom/MSAA, 0 = plain render at lower
    // resolution without grass tufts. Software GL starts low; real GPUs start
    // high and step down if frames stay slow.
    let forced = null;
    try { forced = localStorage.getItem('pocketlinks.gfx'); } catch {}
    const dbg = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? String(renderer.getContext().getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    this.quality = forced != null ? Math.max(0, Math.min(2, +forced)) : /swiftshader|llvmpipe|software/i.test(gpu) ? 0 : 2;
    this.autoQuality = forced == null;
    this.frameMs = 16;
    this.slowFrames = 0;
    this.lastFrame = 0;

    this.buildShared();
    this.ok = true;
    this.setQuality(this.quality);
  }

  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    if (!this.renderer) return;
    const pr = Math.min(dpr, [1, 1.35, 1.75][this.quality]);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.setSize(Math.round((w * pr) / 2), Math.round((h * pr) / 2));
  }

  // Pieces that don't depend on the hole: geometries, materials, pools.
  buildShared() {
    const T = this.T;
    const up = (g) => g.rotateX(Math.PI / 2); // three is y-up; the course is z-up
    const merge = (list) => T.mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
    const blob = (r, x, y, z, sx = 1, sy = 1, sz = 1, detail = 1) => new T.IcosahedronGeometry(r, detail).scale(sx, sy, sz).translate(x, y, z);

    // Trees, each normalised to height 1 and canopy width ~1.
    this.treeGeo = {
      oak: {
        trunk: up(merge([new T.CylinderGeometry(0.045, 0.07, 0.5, 7).translate(0, 0.25, 0)])),
        top: up(merge([
          blob(0.27, 0, 0.66, 0), blob(0.2, 0.2, 0.55, 0.06), blob(0.19, -0.19, 0.57, -0.05),
          blob(0.18, 0.03, 0.84, 0.02), blob(0.17, 0.06, 0.58, -0.2), blob(0.16, -0.05, 0.6, 0.2),
        ])),
      },
      pine: {
        trunk: up(merge([new T.CylinderGeometry(0.025, 0.045, 1, 7).translate(0, 0.5, 0)])),
        top: up(merge([0, 1, 2, 3].map((i) => new T.ConeGeometry(0.36 - i * 0.07, 0.3 - i * 0.03, 9).translate(0, 0.5 + i * 0.14, 0)))),
      },
      palm: {
        trunk: up(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(0, 0, 0), new T.Vector3(0.05, 0.45, 0), new T.Vector3(0.13, 0.9, 0)]), 10, 0.03, 6)),
        top: up(merge(Array.from({ length: 9 }, (_, i) => {
          const g = new T.PlaneGeometry(0.11, 0.42, 1, 6);
          const p = g.attributes.position;
          for (let k = 0; k < p.count; k++) {
            const y = p.getY(k) + 0.21; // 0..0.42 along the frond
            p.setXYZ(k, p.getX(k) * (1 - y * 1.6), y, -y * y * 1.8);
          }
          g.computeVertexNormals();
          g.rotateX(-0.25);
          g.rotateY((i / 9) * TAU);
          return g.translate(0.13, 0.9, 0);
        }))),
      },
      cypress: {
        trunk: up(merge([new T.CylinderGeometry(0.05, 0.09, 0.55, 7).translate(0, 0.27, 0)])),
        top: up(merge([
          blob(0.3, 0, 0.62, 0, 1, 0.38, 1), blob(0.24, 0.22, 0.5, 0.1, 1, 0.38, 1),
          blob(0.24, -0.24, 0.52, -0.06, 1, 0.38, 1), blob(0.22, 0.05, 0.78, 0.04, 1, 0.38, 1),
        ])),
      },
    };
    this.leafMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 });
    this.frondMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: T.DoubleSide });
    this.trunkMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    this.bushGeo = up(new T.IcosahedronGeometry(1, 1));
    this.bushMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });

    // Grass tufts: three blades, darker at the root, swaying in the wind.
    {
      const pos = [], col = [];
      for (let b = 0; b < 3; b++) {
        const a = (b / 3) * Math.PI + 0.3;
        const ca = Math.cos(a), sa = Math.sin(a), w = 0.05, lean = 0.06 * (b - 1);
        pos.push(-w * ca, -w * sa, 0, w * ca, w * sa, 0, lean * sa, -lean * ca, 1);
        col.push(0.78, 0.8, 0.7, 0.78, 0.8, 0.7, 1.3, 1.32, 1.1);
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      // Light the blades as if they faced up, so they don't go dark side-on.
      const n = g.attributes.normal;
      for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 0, 1);
      this.tuftGeo = g;
    }
    this.timeU = { value: 0 };
    this.tuftMat = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
    this.tuftMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.timeU;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][1]);
        float sway = sin(uTime * 1.7 + ip.x * 0.35 + ip.y * 0.21) * 0.5 + sin(uTime * 3.1 + ip.y * 0.6) * 0.2;
        transformed.x += sway * 0.08 * position.z;
        transformed.y += sway * 0.05 * position.z;
        // Only near the camera: far away they read as noise.
        float dc = distance(cameraPosition.xy, ip);
        transformed *= 1.0 - smoothstep(35.0, 60.0, dc);`);
      // Both sides of a blade are lit like the ground beneath it.
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);');
    };

    // Ball and friends.
    this.ballGeo = new T.SphereGeometry(1, 20, 14);
    this.ballMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0, emissive: 0x222222 });
    {
      const cvs = document.createElement('canvas');
      cvs.width = cvs.height = 64;
      const c = cvs.getContext('2d');
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(0,0,0,0.75)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
      this.blobTex = new T.CanvasTexture(cvs);
    }
    this.blobMat = new T.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.ringGeo = new T.RingGeometry(0.82, 1, 48);
    this.discGeo = new T.CircleGeometry(1, 24);
  }

  // ---------- building a hole ----------

  setHole(hole, R) {
    if (!this.ok) return;
    const T = this.T;
    if (this.holeGroup) {
      this.scene.remove(this.holeGroup);
      this.holeGroup.traverse((o) => {
        if (o.geometry && !o.userData.shared) o.geometry.dispose();
        if (o.material && o.userData.ownMat) o.material.dispose();
      });
      for (const t of this.holeTextures || []) t.dispose();
    }
    this.hole = hole;
    this.box = R.box;
    this.slopePts = R.slopePts;
    const L = (this.look = LOOKS[hole.course] || LOOKS.links);
    const group = new T.Group();
    this.holeGroup = group;
    this.holeTextures = [];
    this.scene.add(group);

    // Light and air.
    const el = L.sunEl, az = Math.atan2(-0.8, -0.6);
    this.sunDir = new T.Vector3(Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)).normalize();
    this.sunLight.color.set(L.sun);
    this.sunLight.intensity = L.sunI;
    this.hemi.color.set(L.hemiSky);
    this.hemi.groundColor.set(L.hemiGround);
    this.hemi.intensity = L.hemiI;
    this.renderer.toneMappingExposure = L.exposure;
    this.scene.fog = new T.Fog(new T.Color(L.skyHorizon), L.fogNear, L.fogFar);

    // Terrain.
    const mask = R.paintMask(R.box, 1);
    this.buildTerrain(hole, mask, L, group);
    // Sky, clouds, distant hills.
    this.buildSky(L, group, hole);
    // Water.
    this.buildWater(mask, L, group);
    // Trees, bushes and grass.
    this.buildTrees(hole, L, group);
    this.buildTufts(hole, mask, L, group);
    // Flag, cup, tee markers.
    this.buildPin(hole, L, group);
    // Dynamic pieces.
    this.buildDynamic(group);
  }

  buildTerrain(hole, mask, L, group) {
    const T = this.T;
    const box = this.box;
    const step = STEP;
    const gw = Math.ceil(box.w / step) + 1, gh = Math.ceil(box.h / step) + 1;
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
    const sea = hole.water.some((w) => w.sea);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const x = box.x + i * step, y = box.y + j * step;
        const [Rr, G, B] = at(x, y);
        const k = j * gw + i;
        play[k] = Rr > 30 || G > 128 || B > 128 ? 1 : 0;
        let h = 0;
        if (Rr > 200) h = -0.55;
        else if (B > 128) h = sea ? -3.5 : -1.2;
        else if (G < 128 && Rr > 30) h = (noise(x / 9, y / 9) - 0.5) * 0.6;
        base[k] = h;
      }
    }
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
        const hills = far * (2.4 + 7 * noise(x / 80, y / 80) + 1.8 * noise(x / 24, y / 24)) * L.hillsH;
        const edge = Math.min(i, j, gw - 1 - i, gh - 1 - j) * step;
        const toEdge = Math.max(0, 1 - edge / 40);
        let h = base[k] + hills;
        h = h * (1 - toEdge) + EDGE * toEdge;
        if (Math.hypot(x - t.x, y - t.y) < t.ry + 2) h += 0.35;
        H[k] = h;
      }
    }
    blur(H, 2);
    this.grid = { H, gw, gh, step, x: box.x, y: box.y };

    const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        pos[k * 3] = box.x + i * step;
        pos[k * 3 + 1] = box.y + j * step;
        pos[k * 3 + 2] = H[k];
        uv[k * 2] = (i * step) / box.w;
        uv[k * 2 + 1] = 1 - (j * step) / box.h;
      }
    }
    const idx = new Uint32Array((gw - 1) * (gh - 1) * 6);
    let o = 0;
    for (let j = 0; j < gh - 1; j++) {
      for (let i = 0; i < gw - 1; i++) {
        const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
        idx[o++] = a; idx[o++] = b; idx[o++] = d;
        idx[o++] = a; idx[o++] = d; idx[o++] = c;
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setIndex(new T.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    const maxTex = Math.min(this.renderer.capabilities.maxTextureSize, 4096);
    const px = Math.min(4, maxTex / Math.max(box.w, box.h));
    const turf = new T.CanvasTexture(paintTurf(hole, box, px, L));
    turf.colorSpace = T.SRGBColorSpace;
    turf.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    turf.generateMipmaps = true;
    turf.minFilter = T.LinearMipmapLinearFilter;
    this.holeTextures.push(turf);
    const mat = new T.MeshStandardMaterial({ map: turf, roughness: 0.95, metalness: 0 });
    // Fine grass grain and blade texture close to the camera.
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `varying vec3 vWP;
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
        ` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          float dCam = distance(cameraPosition, vWP);
          float nearF = 1.0 - smoothstep(8.0, 70.0, dCam);
          float g1 = vn(vWP.xy * 3.0), g2 = vn(vWP.xy * vec2(40.0, 9.0)) * 0.5 + vn(vWP.xy * vec2(9.0, 40.0)) * 0.5;
          diffuseColor.rgb *= 1.0 + ((g1 - 0.5) * 0.1 + (g2 - 0.5) * 0.16) * nearF + (vn(vWP.xy * 0.12) - 0.5) * 0.08;`);
    };
    const mesh = new T.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.userData.ownMat = true;
    group.add(mesh);

    // The land beyond: a frame around the course area.
    const big = 6000, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const outer = new T.MeshStandardMaterial({ color: L.ob, roughness: 1 });
    const bx0 = box.x, by0 = box.y, bx1 = box.x + box.w, by1 = box.y + box.h;
    for (const [x0, y0, x1, y1] of [[cx - big, cy - big, cx + big, by0], [cx - big, by1, cx + big, cy + big], [cx - big, by0, bx0, by1], [bx1, by0, cx + big, by1]]) {
      const pl = new T.Mesh(new T.PlaneGeometry(x1 - x0, y1 - y0), outer);
      pl.position.set((x0 + x1) / 2, (y0 + y1) / 2, EDGE - 0.05);
      pl.receiveShadow = true;
      group.add(pl);
    }
  }

  buildSky(L, group, hole) {
    const T = this.T;
    const skyMat = new T.ShaderMaterial({
      uniforms: { uTop: { value: new T.Color(L.skyTop) }, uHorizon: { value: new T.Color(L.skyHorizon) }, uSun: { value: this.sunDir }, uSunCol: { value: new T.Color(L.sun) } },
      vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunCol; varying vec3 vD;
        void main() {
          float e = clamp(vD.z, 0.0, 1.0);
          vec3 c = mix(uHorizon, uTop, pow(e, 0.45));
          float s = max(dot(normalize(vD), uSun), 0.0);
          c += uSunCol * (pow(s, 900.0) * 6.0 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
          if (vD.z < 0.0) c = uHorizon;
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: T.BackSide, depthWrite: false, fog: false,
    });
    const sky = new T.Mesh(new T.SphereGeometry(3000, 32, 16), skyMat);
    sky.userData.ownMat = true;
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.sky = sky;
    group.add(sky);

    // Puffy stylised clouds.
    const r = seeded(hole.index * 7 + 2);
    const cloudMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: new T.Color(L.skyHorizon), emissiveIntensity: 0.45, fog: false });
    const cx = this.box.x + this.box.w / 2, cy = this.box.y + this.box.h / 2;
    const n = Math.round(14 * L.cloud);
    for (let i = 0; i < n; i++) {
      const parts = [];
      const m = 5 + Math.floor(r() * 5);
      for (let k = 0; k < m; k++) {
        const g = new T.IcosahedronGeometry(1, 2);
        const s = 22 + r() * 30;
        g.scale(s * 1.25, s, s * 0.6).translate((k - m / 2) * 28 + r() * 10, r() * 12, r() * 10 + (k % 2) * 8);
        parts.push(g);
      }
      const geo = T.mergeGeometries(parts);
      geo.rotateX(Math.PI / 2);
      const cl = new T.Mesh(geo, cloudMat);
      const a = r() * TAU, d = 1100 + r() * 900;
      cl.position.set(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 260 + r() * 260);
      cl.rotation.z = r() * TAU;
      group.add(cl);
    }

    // Rounded hills on the horizon.
    const hillMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    const hills = new T.InstancedMesh(new T.SphereGeometry(1, 28, 14), hillMat, 44);
    const m = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), p = new T.Vector3();
    const col = new T.Color();
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * TAU + r() * 0.1, d = 1300 + r() * 900;
      const rx = 180 + r() * 260, rz = (40 + r() * 90) * (0.4 + L.hillsH * 0.6);
      sc.set(rx, rx * (0.6 + r() * 0.5), rz);
      p.set(cx + Math.cos(a) * d, cy + Math.sin(a) * d, EDGE - rz * 0.35);
      q.setFromAxisAngle(new T.Vector3(0, 0, 1), r() * TAU);
      m.compose(p, q, sc);
      hills.setMatrixAt(i, m);
      hills.setColorAt(i, col.set(L.hills[i % L.hills.length]));
    }
    group.add(hills);
  }

  buildWater(mask, L, group) {
    const T = this.T;
    const tex = new T.CanvasTexture(mask);
    tex.colorSpace = T.NoColorSpace;
    this.holeTextures.push(tex);
    const box = this.box;
    const mat = new T.ShaderMaterial({
      uniforms: {
        uMask: { value: tex }, uBox: { value: new T.Vector4(box.x, box.y, box.w, box.h) }, uTime: this.timeU,
        uShallow: { value: new T.Color(L.water) }, uDeep: { value: new T.Color(L.deepWater) }, uSky: { value: new T.Color(L.skyHorizon) }, uSkyTop: { value: new T.Color(L.skyTop) },
        uSun: { value: this.sunDir }, uSunCol: { value: new T.Color(L.sun) },
        uFog: { value: new T.Color(L.skyHorizon) }, uFogRange: { value: new T.Vector2(L.fogNear, L.fogFar) },
      },
      vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform sampler2D uMask; uniform vec4 uBox; uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSkyTop;
        uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uFog; uniform vec2 uFogRange; varying vec3 vW;
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec2 uv = (vW.xy - uBox.xy) / uBox.zw;
          float m = texture2D(uMask, vec2(uv.x, 1.0 - uv.y)).b;
          float a = smoothstep(0.3, 0.55, m);
          if (a < 0.01) discard;
          float d = distance(cameraPosition, vW);
          float nearW = 1.0 - smoothstep(20.0, 160.0, d);
          vec2 p = vW.xy;
          float t = uTime;
          vec2 n = vec2(vn(p * 0.4 + vec2(t * 0.25, t * 0.1)) - 0.5, vn(p * 0.42 + vec2(3.0, 7.0) - t * 0.2) - 0.5) * 0.35
                 + vec2(vn(p * 1.3 - t * 0.5) - 0.5, vn(p * 1.4 + vec2(5.0, 1.0) + t * 0.45) - 0.5) * 0.22 * nearW;
          vec3 N = normalize(vec3(n, 1.0));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
          float depth = smoothstep(0.55, 1.0, m);
          vec3 col = mix(uShallow, uDeep, depth);
          vec3 R = reflect(-V, N);
          col = mix(col, mix(uSky, uSkyTop, clamp(R.z, 0.0, 1.0)), 0.25 + fres * 0.6);
          float sp = max(dot(R, uSun), 0.0);
          col += uSunCol * (pow(sp, 180.0) * 3.0) * (0.4 + 0.6 * nearW);
          // Stylised sparkles and foam at the edge.
          float sparkle = step(0.985, vn(p * 2.2 + vec2(t * 0.8, -t * 0.6))) * nearW;
          col += vec3(sparkle * 0.7);
          float foam = (1.0 - smoothstep(0.42, 0.62, m)) * (0.55 + 0.45 * sin(t * 1.5 + (p.x + p.y) * 0.8));
          col = mix(col, vec3(1.0), foam * 0.75);
          float f = clamp((d - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
          col = mix(col, uFog, f);
          gl_FragColor = vec4(col, a * 0.92);
        }`,
      transparent: true, depthWrite: false,
    });
    const geo = new T.PlaneGeometry(box.w, box.h);
    const w = new T.Mesh(geo, mat);
    w.position.set(box.x + box.w / 2, box.y + box.h / 2, -0.12);
    w.userData.ownMat = true;
    w.renderOrder = 2;
    group.add(w);
  }

  buildTrees(hole, L, group) {
    const T = this.T;
    const r = seeded(hole.index * 13 + 5);
    const kinds = { oak: [], pine: [], palm: [], cypress: [] };
    hole.trees.forEach((t, i) => kinds[t.pine ? 'pine' : t.palm ? 'palm' : t.cypress ? 'cypress' : 'oak'].push({ t, i }));
    this.treeInst = [];
    const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), zAxis = new T.Vector3(0, 0, 1);
    const col = new T.Color();
    const trunkCol = new T.Color(L.trunk);
    for (const [kind, list] of Object.entries(kinds)) {
      if (!list.length) continue;
      const g = this.treeGeo[kind];
      const trunk = new T.InstancedMesh(g.trunk, this.trunkMat, list.length);
      const top = new T.InstancedMesh(g.top, kind === 'palm' ? this.frondMat : this.leafMat, list.length);
      trunk.userData.shared = top.userData.shared = true;
      trunk.castShadow = top.castShadow = true;
      trunk.receiveShadow = top.receiveShadow = true;
      list.forEach(({ t }, k) => {
        const width = kind === 'pine' ? t.r * 2.6 : kind === 'cypress' ? t.r * 2.2 : kind === 'palm' ? t.r * 2.2 : t.r * 2.3;
        const h = t.h * (kind === 'oak' ? 1.05 : 1);
        p.set(t.x, t.y, this.heightAt(t.x, t.y) - 0.15);
        q.setFromAxisAngle(zAxis, r() * TAU);
        s.set(width, width, h);
        m.compose(p, q, s);
        trunk.setMatrixAt(k, m);
        top.setMatrixAt(k, m);
        const leaf = L.tree[Math.floor(r() * L.tree.length)];
        col.set(leaf).multiplyScalar(0.88 + r() * 0.24);
        top.setColorAt(k, col);
        trunk.setColorAt(k, trunkCol);
        this.treeInst.push({ x: t.x, y: t.y, w: width, meshes: [trunk, top], k, m: m.clone(), hidden: false });
      });
      group.add(trunk, top);
    }

    // Azalea beds at Augusta, gorse at St Andrews.
    const bushes = [];
    for (const f of hole.flowers || []) {
      const n = Math.round(f.rx * f.ry * 0.9);
      for (let i = 0; i < n; i++) {
        const a = r() * TAU, d = Math.sqrt(r());
        const u = Math.cos(a) * f.rx * d, v = Math.sin(a) * f.ry * d, rot = f.rot || 0;
        const x = f.x + u * Math.cos(rot) - v * Math.sin(rot), y = f.y + u * Math.sin(rot) + v * Math.cos(rot);
        bushes.push([x, y, 0.7 + r() * 0.6, ['#ff5fa2', '#e23a86', '#ff8fbf', '#ffffff', '#ff6f8a', '#d81b60'][Math.floor(r() * 6)]]);
      }
    }
    if (L.gorse) {
      // Gorse grows in clumps, not as an even scatter.
      const box = this.box;
      const gn = makeNoise(hole.index * 5 + 11);
      for (let y = box.y; y < box.y + box.h; y += 3.2) {
        for (let x = box.x; x < box.x + box.w; x += 3.2) {
          const gx = x + (r() - 0.5) * 3, gy = y + (r() - 0.5) * 3;
          if (gn(gx / 26, gy / 26) < 0.58 || r() > 0.75) continue;
          const t = hole.terrainAt(gx, gy);
          if (t !== 1 && t !== 0) continue; // deep rough or out of bounds
          bushes.push([gx, gy, 0.8 + r() * 0.9, r() < 0.35 ? '#e8c832' : r() < 0.6 ? '#4f6b2c' : '#5f7d33']);
        }
      }
    }
    if (bushes.length) {
      const inst = new T.InstancedMesh(this.bushGeo, this.bushMat, bushes.length);
      inst.userData.shared = true;
      inst.castShadow = true;
      inst.receiveShadow = true;
      bushes.forEach(([x, y, sz, c], i) => {
        p.set(x, y, this.heightAt(x, y) + sz * 0.35);
        q.setFromAxisAngle(zAxis, r() * TAU);
        s.set(sz * (1 + r() * 0.4), sz, sz * 0.75);
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
        inst.setColorAt(i, col.set(c));
      });
      group.add(inst);
    }
  }

  // Grass tufts in the rough near the line of play.
  buildTufts(hole, mask, L, group) {
    const T = this.T;
    const r = seeded(hole.index * 17 + 3);
    const box = this.box;
    const img = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
    const at = (x, y) => {
      const px = Math.max(0, Math.min(mask.width - 1, Math.floor(x - box.x)));
      const py = Math.max(0, Math.min(mask.height - 1, Math.floor(y - box.y)));
      const o = (py * mask.width + px) * 4;
      return [img[o], img[o + 1], img[o + 2]];
    };
    const spots = [];
    const max = 22000;
    for (let y = box.y; y < box.y + box.h && spots.length < max; y += 1.5) {
      for (let x = box.x; x < box.x + box.w && spots.length < max; x += 1.5) {
        const gx = x + (r() - 0.5) * 1.4, gy = y + (r() - 0.5) * 1.4;
        const [Rr, G, B] = at(gx, gy);
        if (G > 128 || B > 128 || Rr > 200) continue; // fairway, green, water, sand
        const [d] = hole.nearest(gx, gy);
        if (d > hole.bounds + 10) continue;
        if (r() > (Rr > 30 ? 0.55 : 0.35)) continue;
        spots.push([gx, gy]);
      }
    }
    this.tufts = null;
    if (!spots.length) return;
    const inst = new T.InstancedMesh(this.tuftGeo, this.tuftMat, spots.length);
    this.tufts = inst;
    inst.visible = this.quality > 0;
    inst.userData.shared = true;
    inst.frustumCulled = false;
    const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), z = new T.Vector3(0, 0, 1);
    const base = new T.Color(L.rough), col = new T.Color();
    spots.forEach(([x, y], i) => {
      const h = 0.22 + r() * 0.26;
      p.set(x, y, this.heightAt(x, y) - 0.02);
      q.setFromAxisAngle(z, r() * TAU);
      s.set(1.4 + r() * 0.8, 1.4 + r() * 0.8, h);
      m.compose(p, q, s);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, col.copy(base).multiplyScalar(0.85 + r() * 0.35));
    });
    group.add(inst);
  }

  buildPin(hole, L, group) {
    const T = this.T;
    const pin = hole.pin;
    const z = this.heightAt(pin.x, pin.y);
    const cup = new T.Mesh(new T.CircleGeometry(0.075, 24), new T.MeshBasicMaterial({ color: 0x0b120b }));
    cup.position.set(pin.x, pin.y, z + 0.012);
    cup.userData.ownMat = true;
    const liner = new T.Mesh(new T.RingGeometry(0.075, 0.09, 24), new T.MeshBasicMaterial({ color: 0xf2f2ea }));
    liner.position.copy(cup.position);
    liner.userData.ownMat = true;
    const flag = new T.Group();
    flag.position.set(pin.x, pin.y, z);
    const pole = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 2.4, 8).rotateX(Math.PI / 2).translate(0, 0, 1.2), new T.MeshStandardMaterial({ color: 0xf4f4ee, roughness: 0.4 }));
    pole.castShadow = true;
    pole.userData.ownMat = true;
    const clothGeo = new T.PlaneGeometry(0.75, 0.5, 10, 4);
    const cloth = new T.Mesh(clothGeo, new T.MeshStandardMaterial({ color: hole.course === 'standrews' ? 0xd8282c : 0xffd23f, roughness: 0.7, side: T.DoubleSide }));
    cloth.castShadow = true;
    cloth.userData.ownMat = true;
    this.cloth = { mesh: cloth, base: clothGeo.attributes.position.array.slice() };
    flag.add(pole, cloth);
    this.flag = flag;
    group.add(cup, liner, flag);
    // Tee markers.
    const t = hole.tee;
    const mc = hole.course === 'augusta' ? 0x2e8a4f : hole.course === 'standrews' ? 0xd8282c : 0xf6f6f0;
    const mm = new T.MeshStandardMaterial({ color: mc, roughness: 0.35 });
    for (const k of [-1, 1]) {
      const x = t.x + Math.cos(t.ang + Math.PI / 2) * 3 * k, y = t.y + Math.sin(t.ang + Math.PI / 2) * 3 * k;
      const b = new T.Mesh(this.ballGeo, mm);
      b.userData.shared = true;
      b.scale.setScalar(0.09);
      b.position.set(x, y, this.heightAt(x, y) + 0.09);
      b.castShadow = true;
      group.add(b);
    }
  }

  // Balls, shadows, rings, ribbons, slope arrows and particles, reused each frame.
  buildDynamic(group) {
    const T = this.T;
    const sh = (o) => {
      o.userData.shared = true;
      return o;
    };
    this.balls = [];
    for (let i = 0; i < 6; i++) {
      const ball = sh(new T.Mesh(this.ballGeo, this.ballMat));
      ball.castShadow = true;
      const blob = sh(new T.Mesh(this.discGeo, this.blobMat));
      const ringMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      const ring = sh(new T.Mesh(this.ringGeo, ringMat));
      ring.userData.ownMat = true;
      group.add(ball, blob, ring);
      this.balls.push({ ball, blob, ring });
    }
    const ribbonMat = (blend) => new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide, blending: blend });
    this.ribbons = {};
    for (const [name, blend] of [['tracer', T.AdditiveBlending], ['tracerCore', T.NormalBlending], ['arc', T.NormalBlending], ['arcShadow', T.NormalBlending], ['roll', T.NormalBlending]]) {
      const geo = new T.BufferGeometry();
      const n = 1600;
      geo.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 4), 4).setUsage(T.DynamicDrawUsage));
      const mesh = new T.Mesh(geo, ribbonMat(blend));
      mesh.frustumCulled = false;
      mesh.userData.ownMat = true;
      mesh.renderOrder = 5;
      group.add(mesh);
      this.ribbons[name] = mesh;
    }
    const decal = () => new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.landRing = new T.Mesh(this.ringGeo, decal());
    this.endRing = new T.Mesh(this.ringGeo, decal());
    for (const o of [this.landRing, this.endRing]) {
      o.userData.shared = true;
      o.userData.ownMat = true;
      o.renderOrder = 4;
      group.add(o);
    }
    // Slope arrows on the green.
    const n = Math.max(1, (this.slopePts || []).length);
    this.slopeMesh = new T.InstancedMesh(new T.PlaneGeometry(0.42, 0.06), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false, blending: T.AdditiveBlending }), n);
    this.slopeMesh.userData.ownMat = true;
    this.slopeMesh.frustumCulled = false;
    group.add(this.slopeMesh);
    // Particles.
    const pg = new T.BufferGeometry();
    pg.setAttribute('position', new T.BufferAttribute(new Float32Array(600 * 3), 3).setUsage(T.DynamicDrawUsage));
    pg.setAttribute('color', new T.BufferAttribute(new Float32Array(600 * 3), 3).setUsage(T.DynamicDrawUsage));
    this.points = new T.Points(pg, new T.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, blending: T.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.points.userData.ownMat = true;
    group.add(this.points);
    this.splashRings = [];
    for (let i = 0; i < 6; i++) {
      const o = new T.Mesh(this.ringGeo, decal());
      o.userData.shared = true;
      o.userData.ownMat = true;
      group.add(o);
      this.splashRings.push(o);
    }
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

  setNear() {}

  // ---------- camera ----------

  setCamera(cam) {
    const c = this.camera;
    const aspect = this.w / this.h;
    c.fov = cam.fov || (aspect < 1 ? 66 : 56);
    c.aspect = aspect;
    c.position.set(cam.eye[0], cam.eye[1], cam.eye[2]);
    c.lookAt(cam.target[0], cam.target[1], cam.target[2]);
    c.updateProjectionMatrix();
    // Centre the picture in the visible area between the top bar and the panel.
    const top = cam.insetTop || 0, bottom = cam.insetBottom || 0;
    c.projectionMatrix.elements[9] = -(1 - (top + this.h - bottom) / this.h);
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    c.updateMatrixWorld();
  }

  project(x, y, z = 0) {
    if (!this.ok || !this.hole) return null;
    const v = new this.T.Vector3(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z > -0.05) return null;
    v.applyMatrix4(this.camera.projectionMatrix);
    return [(v.x * 0.5 + 0.5) * this.w, (1 - (v.y * 0.5 + 0.5)) * this.h];
  }

  toWorld(sx, sy, h = 0) {
    const T = this.T;
    const ndc = new T.Vector3((sx / this.w) * 2 - 1, 1 - (sy / this.h) * 2, 0.5);
    const p = ndc.clone().unproject(this.camera);
    const o = this.camera.position;
    const d = p.sub(o).normalize();
    let t = d.z < -1e-6 ? (h - o.z) / d.z : 1500;
    if (t < 0 || t > 1500) t = 1500;
    return [o.x + d.x * t, o.y + d.y * t];
  }

  // ---------- per-frame ----------

  ribbon(name, pts, { width = 0.004, color = [1, 1, 1, 1], dash = 0, fade = false, fadeIn = 0, flat = false } = {}) {
    const mesh = this.ribbons[name];
    const pos = mesh.geometry.attributes.position, col = mesh.geometry.attributes.color;
    const P = pos.array, C = col.array;
    let n = 0;
    const eye = this.camera.position;
    const maxSeg = Math.floor(P.length / 18);
    for (let i = 1; i < pts.length && n / 6 < maxSeg; i++) {
      if (dash && Math.floor(i / dash) % 2) continue;
      const a = pts[i - 1], b = pts[i];
      let sx, sy, sz;
      const ex = a[0] - eye.x, ey = a[1] - eye.y, ez = a[2] - eye.z;
      const dist = Math.hypot(ex, ey, ez);
      const w = Math.max(0.025, dist * width) / 2;
      if (flat) {
        sx = -(b[1] - a[1]); sy = b[0] - a[0]; sz = 0;
      } else {
        const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
        sx = ty * ez - tz * ey; sy = tz * ex - tx * ez; sz = tx * ey - ty * ex;
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      sx = (sx / l) * w; sy = (sy / l) * w; sz = (sz / l) * w;
      const k = fadeIn ? Math.min(1, i / (pts.length * fadeIn)) : 1;
      const alpha = color[3] * (fade ? i / pts.length : 1) * (fadeIn ? 0.15 + 0.85 * k : 1);
      const quad = [[a[0] - sx, a[1] - sy, a[2] - sz], [a[0] + sx, a[1] + sy, a[2] + sz], [b[0] + sx, b[1] + sy, b[2] + sz], [b[0] - sx, b[1] - sy, b[2] - sz]];
      for (const vi of [0, 1, 2, 0, 2, 3]) {
        P[n * 3] = quad[vi][0]; P[n * 3 + 1] = quad[vi][1]; P[n * 3 + 2] = quad[vi][2];
        C[n * 4] = color[0]; C[n * 4 + 1] = color[1]; C[n * 4 + 2] = color[2]; C[n * 4 + 3] = alpha;
        n++;
      }
    }
    mesh.geometry.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    mesh.visible = n > 0;
  }

  draw(sc) {
    if (!this.ok || !this.hole) return;
    const T = this.T;
    this.timeU.value = sc.time;
    this.setCamera(sc.cam);
    const eye = this.camera.position;
    const H = (x, y) => this.heightAt(x, y);
    this.sky.position.copy(eye);

    // The sun's shadow follows the area the camera is looking at.
    const tgt = sc.cam.target;
    const fx = tgt[0] - eye.x, fy = tgt[1] - eye.y, fl = Math.hypot(fx, fy) || 1;
    const cx = eye.x + (fx / fl) * 55, cy = eye.y + (fy / fl) * 55, cz = H(cx, cy);
    this.sunLight.target.position.set(cx, cy, cz);
    this.sunLight.position.set(cx + this.sunDir.x * 250, cy + this.sunDir.y * 250, cz + this.sunDir.z * 250);
    this.sunLight.target.updateMatrixWorld();

    // Trees right beside the camera step aside so they don't fill the screen.
    for (const t of this.treeInst) {
      const near = Math.hypot(t.x - eye.x, t.y - eye.y) < t.w * 0.5 + 2.5;
      if (near === t.hidden) continue;
      t.hidden = near;
      const m = near ? new T.Matrix4().makeScale(0, 0, 0) : t.m;
      for (const mesh of t.meshes) {
        mesh.setMatrixAt(t.k, m);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }

    // Balls.
    this.balls.forEach((b, i) => {
      const s = sc.balls[i];
      b.ball.visible = b.blob.visible = b.ring.visible = !!s;
      if (!s) return;
      const g = H(s.x, s.y);
      const z = s.zAbs != null ? s.zAbs : g + s.z;
      const d = Math.hypot(s.x - eye.x, s.y - eye.y, z - eye.z);
      const r = Math.max(0.05, d * 0.0058);
      b.ball.scale.setScalar(r);
      b.ball.position.set(s.x, s.y, z + r);
      const bs = Math.max(0.16, r * 2.6) * (1 + (z - g) * 0.04);
      b.blob.scale.setScalar(bs);
      b.blob.position.set(s.x, s.y, g + 0.03);
      b.blob.material.opacity = Math.max(0.15, 0.85 - (z - g) * 0.03);
      b.ring.visible = !!s.ring;
      if (s.ring) {
        const rr = Math.max(0.55, d * 0.032) * (0.92 + Math.sin(sc.time * 4) * 0.08);
        b.ring.scale.setScalar(rr);
        b.ring.position.set(s.x, s.y, g + 0.04);
        b.ring.material.color.setRGB(s.col[0], s.col[1], s.col[2]);
      }
    });

    // Tracers.
    const trails = sc.trails || [];
    const tr = trails.length ? trails[trails.length - 1] : [];
    this.ribbon('tracer', tr, { width: 0.006, color: [1, 0.82, 0.45, 0.9], fade: true });
    this.ribbon('tracerCore', tr, { width: 0.0018, color: [1, 1, 1, 1], fade: true });

    // Aim guide.
    const aim = sc.aim;
    if (aim) {
      const c = aim.color || [1, 1, 1, 0.95];
      if (aim.arc && aim.arc.length > 1) {
        this.ribbon('arc', aim.arc, { width: 0.0056, color: c, dash: 3, fadeIn: 0.25 });
        this.ribbon('arcShadow', aim.arc.map((p) => [p[0], p[1], H(p[0], p[1]) + 0.05]), { width: 0.0065, color: [0, 0, 0, 0.22], dash: 3, flat: true });
      } else {
        this.ribbon('arc', []);
        this.ribbon('arcShadow', []);
      }
      const roll = aim.roll && aim.roll.length > 1 ? aim.roll.map((p) => [p[0], p[1], H(p[0], p[1]) + 0.05]) : [];
      this.ribbon('roll', roll, { width: aim.putt ? 0.003 : 0.004, color: aim.putt ? [1, 0.95, 0.6, 0.95] : [c[0], c[1], c[2], 0.85], dash: 2, flat: true });
      const ringAt = (mesh, p, rr) => {
        mesh.visible = !!p;
        if (!p) return;
        mesh.scale.setScalar(rr);
        mesh.position.set(p.x, p.y, H(p.x, p.y) + 0.05);
        mesh.material.color.setRGB(c[0], c[1], c[2]);
        mesh.material.opacity = 0.95;
      };
      ringAt(this.landRing, aim.ring, aim.ring ? Math.max(aim.ring.r, Math.hypot(aim.ring.x - eye.x, aim.ring.y - eye.y) * 0.018) : 1);
      ringAt(this.endRing, aim.end, aim.end ? Math.max(0.25, Math.hypot(aim.end.x - eye.x, aim.end.y - eye.y) * 0.009) : 1);
    } else {
      for (const n of ['arc', 'arcShadow', 'roll']) this.ribbon(n, []);
      this.landRing.visible = this.endRing.visible = false;
    }

    // Flag: scales up a little in the distance so it stays readable; the cloth waves.
    {
      const pin = this.hole.pin;
      const d = Math.hypot(pin.x - eye.x, pin.y - eye.y);
      const big = Math.max(1, d * 0.01);
      this.flag.scale.set(big, big, big);
      const wind = sc.wind || { speed: 5, dir: 0 };
      const { mesh, base } = this.cloth;
      const P = mesh.geometry.attributes.position;
      const len = 0.75 * (0.6 + Math.min(1, wind.speed / 16) * 0.4);
      for (let i = 0; i < P.count; i++) {
        const u = (base[i * 3] + 0.375) / 0.75; // 0 at the pole
        const v = base[i * 3 + 1];
        const ph = sc.time * (4 + wind.speed * 0.35) - u * 5;
        const wave = Math.sin(ph) * 0.1 * u;
        const x = Math.cos(wind.dir) * len * u - Math.sin(wind.dir) * wave;
        const y = Math.sin(wind.dir) * len * u + Math.cos(wind.dir) * wave;
        P.setXYZ(i, x, y, 2.15 + v - u * 0.06);
      }
      P.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }

    // Slope arrows.
    {
      const pts = sc.slope ? this.slopePts || [] : [];
      const mesh = this.slopeMesh;
      const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(1, 1, 1), p = new T.Vector3(), z = new T.Vector3(0, 0, 1), col = new T.Color();
      const n = Math.min(pts.length, mesh.count);
      for (let i = 0; i < n; i++) {
        const sp = pts[i];
        const strength = Math.min(1, sp.m / 0.03);
        const ph = (sc.time * (0.3 + strength * 0.9) + sp.ph) % 1;
        const len = 0.35 + strength * 0.7;
        const ox = sp.x + sp.dx * len * (ph - 0.5), oy = sp.y + sp.dy * len * (ph - 0.5);
        const a = Math.sin(ph * Math.PI) * (0.25 + strength * 0.5);
        p.set(ox, oy, H(ox, oy) + 0.03);
        q.setFromAxisAngle(z, Math.atan2(sp.dy, sp.dx));
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, strength > 0.6 ? col.setRGB(a, a * 0.95, a * 0.6) : col.setRGB(a, a, a));
      }
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Particles and splash rings.
    {
      const P = this.points.geometry.attributes.position, C = this.points.geometry.attributes.color;
      let n = 0, ri = 0;
      for (const pt of sc.particles || []) {
        const f = Math.max(0, pt.life / pt.max);
        const c = parseColor(pt.color);
        if (pt.ring) {
          if (ri >= this.splashRings.length) continue;
          const o = this.splashRings[ri++];
          o.visible = true;
          o.scale.setScalar((pt.r1 + (pt.r0 - pt.r1) * f) * 1.2);
          o.position.set(pt.x, pt.y, Math.max(H(pt.x, pt.y), -0.1) + 0.05);
          o.material.color.setRGB(c[0], c[1], c[2]);
          o.material.opacity = c[3] * f;
          continue;
        }
        if (n >= P.count) continue;
        P.setXYZ(n, pt.x, pt.y, H(pt.x, pt.y) + pt.z * 0.6 + 0.05);
        C.setXYZ(n, c[0] * f * c[3], c[1] * f * c[3], c[2] * f * c[3]);
        n++;
      }
      for (; ri < this.splashRings.length; ri++) this.splashRings[ri].visible = false;
      this.points.geometry.setDrawRange(0, n);
      P.needsUpdate = true;
      C.needsUpdate = true;
    }

    this.trackSpeed();
    if (this.quality === 0) this.renderer.render(this.scene, this.camera);
    else this.composer.render();
  }

  // Drop a quality level when frames stay slow for a couple of seconds.
  trackSpeed() {
    const now = performance.now();
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    if (!this.autoQuality || this.quality === 0 || dt > 500) return;
    this.frameMs += (dt - this.frameMs) * 0.05;
    this.slowFrames = this.frameMs > 42 ? this.slowFrames + 1 : 0;
    if (this.slowFrames > 90) {
      this.slowFrames = 0;
      this.frameMs = 16;
      this.setQuality(this.quality - 1);
    }
  }

  setQuality(q) {
    this.quality = q;
    this.bloom.enabled = q >= 2;
    this.composer.renderTarget1.samples = this.composer.renderTarget2.samples = q >= 2 ? 4 : 0;
    if (this.tufts) this.tufts.visible = q > 0;
    if (this.w) this.resize(this.w, this.h, this.dpr);
  }
}
