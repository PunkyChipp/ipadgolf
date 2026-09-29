// Every sound is synthesised with WebAudio, so there are no audio files.
// iOS only allows audio after a touch, so unlock() runs from input handlers.

export class Sound {
  constructor(muted = false) {
    this.ctx = null;
    this.muted = muted;
    this.birdTimer = 0;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      const comp = this.ctx.createDynamicsCompressor();
      comp.connect(this.ctx.destination);
      this.out = this.ctx.createGain();
      this.out.gain.value = this.muted ? 0 : 0.8;
      this.out.connect(comp);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  setMuted(m) {
    this.muted = m;
    if (this.out) this.out.gain.value = m ? 0 : 0.8;
  }

  get ready() {
    return this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  tone({ f, f2, dur = 0.15, type = 'sine', vol = 0.3, at = 0, attack = 0.004 }) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.2, vol = 0.3, freq = 1000, freq2, q = 1, type = 'bandpass', at = 0, attack = 0.003 }) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + at;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noiseBuf;
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tick() {
    this.tone({ f: 1400, dur: 0.03, type: 'square', vol: 0.05 });
  }

  click() {
    this.tone({ f: 720, dur: 0.05, vol: 0.12 });
  }

  // Club strike: woods ring, irons crack, mishits thud.
  strike(kind, quality) {
    this.noise({ dur: 0.35, vol: 0.18, freq: 500, freq2: 2400, q: 0.7, at: -0.0 });
    const at = 0.12;
    if (quality === 'bad') {
      this.noise({ dur: 0.12, vol: 0.5, freq: 400, q: 1, at });
      this.tone({ f: 140, f2: 80, dur: 0.12, vol: 0.3, at });
      return;
    }
    if (kind === 'wood') {
      this.tone({ f: 2600, f2: 2300, dur: 0.22, type: 'triangle', vol: 0.18, at });
      this.tone({ f: 5200, dur: 0.08, vol: 0.06, at });
      this.noise({ dur: 0.06, vol: 0.6, freq: 3500, q: 0.9, at });
    } else {
      this.noise({ dur: 0.05, vol: 0.7, freq: 2200, q: 1.2, at });
      this.tone({ f: 900, f2: 600, dur: 0.07, type: 'triangle', vol: 0.2, at });
      this.noise({ dur: 0.18, vol: 0.12, freq: 700, q: 0.6, at: at + 0.02 });
    }
    if (quality === 'perfect') this.tone({ f: 1760, dur: 0.25, vol: 0.05, at: at + 0.02 });
  }

  putt() {
    this.tone({ f: 1100, f2: 700, dur: 0.06, type: 'triangle', vol: 0.25 });
    this.noise({ dur: 0.03, vol: 0.3, freq: 3000, q: 1 });
  }

  land(kind) {
    if (kind === 'sand') return this.noise({ dur: 0.35, vol: 0.35, freq: 2500, freq2: 900, q: 0.5 });
    if (kind === 'rough') return this.noise({ dur: 0.25, vol: 0.25, freq: 1400, q: 0.6 });
    if (kind === 'green') return this.tone({ f: 180, f2: 90, dur: 0.1, vol: 0.2 });
    this.tone({ f: 150, f2: 70, dur: 0.12, vol: 0.28 });
    this.noise({ dur: 0.06, vol: 0.2, freq: 600, q: 1 });
  }

  splash() {
    this.noise({ dur: 0.8, vol: 0.45, freq: 1100, freq2: 250, q: 0.6, type: 'lowpass' });
    this.tone({ f: 320, f2: 90, dur: 0.3, vol: 0.18 });
    for (let i = 0; i < 4; i++) this.tone({ f: 600 + Math.random() * 600, f2: 1000 + Math.random() * 500, dur: 0.05, vol: 0.06, at: 0.15 + i * 0.09 });
  }

  tree() {
    this.tone({ f: 260, f2: 150, dur: 0.08, type: 'triangle', vol: 0.3 });
    this.noise({ dur: 0.6, vol: 0.2, freq: 4000, freq2: 2000, q: 0.4, at: 0.03 });
  }

  lip() {
    this.tone({ f: 1900, f2: 1500, dur: 0.07, type: 'triangle', vol: 0.15 });
  }

  cup() {
    [0, 0.08, 0.14].forEach((d, i) => this.tone({ f: 1700 - i * 250, dur: 0.05, type: 'triangle', vol: 0.2, at: d }));
    this.tone({ f: 190, f2: 80, dur: 0.25, vol: 0.35, at: 0.18 });
  }

  // Polite golf-crowd applause; bigger for better scores.
  applause(level = 1) {
    if (!this.ready) return;
    const claps = 18 + level * 22;
    const dur = 1.2 + level * 0.6;
    for (let i = 0; i < claps; i++) {
      const at = 0.3 + Math.random() * dur * (0.4 + 0.6 * Math.random());
      this.noise({ dur: 0.05, vol: 0.05 + Math.random() * 0.06, freq: 1200 + Math.random() * 1400, q: 1.4, at });
    }
    if (level >= 2) this.noise({ dur: 1.2, vol: 0.06, freq: 900, q: 0.4, at: 0.4, attack: 0.3 });
  }

  groan() {
    this.noise({ dur: 0.9, vol: 0.05, freq: 350, freq2: 220, q: 2, at: 0.3, attack: 0.2 });
  }

  // Occasional birdsong while playing.
  ambient(dt) {
    if (!this.ready) return;
    this.birdTimer -= dt;
    if (this.birdTimer > 0) return;
    this.birdTimer = 7 + Math.random() * 12;
    const base = 2500 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      this.tone({ f: base * (1 + Math.random() * 0.2), f2: base * (0.8 + Math.random() * 0.5), dur: 0.08 + Math.random() * 0.06, vol: 0.025, at: i * 0.13 });
    }
  }
}
