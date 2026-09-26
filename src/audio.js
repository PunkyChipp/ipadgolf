// All sounds are synthesised with WebAudio, so there are no audio files to load.
// iOS only allows audio after a touch, so unlock() is called from input handlers.

export class Sound {
  constructor(muted = false) {
    this.ctx = null;
    this.muted = muted;
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
      this.out.gain.value = this.muted ? 0 : 0.7;
      this.out.connect(comp);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, len);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  setMuted(m) {
    this.muted = m;
    if (this.out) this.out.gain.value = m ? 0 : 0.7;
  }

  get ready() {
    return this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  tone({ f, f2, dur = 0.15, type = 'sine', vol = 0.3, at = 0, attack = 0.005 }) {
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

  noise({ dur = 0.2, vol = 0.3, freq = 1000, freq2, q = 1, type = 'bandpass', at = 0 }) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + at;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noiseBuf;
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  putt(power) {
    this.noise({ dur: 0.05, vol: 0.35 + power * 0.4, freq: 2600, q: 0.8 });
    this.tone({ f: 950, f2: 520, dur: 0.08, type: 'triangle', vol: 0.18 + power * 0.15 });
  }

  hit(strength) {
    const v = Math.min(1, strength / 900);
    if (v < 0.06) return;
    this.tone({ f: 190, f2: 95, dur: 0.09, type: 'triangle', vol: 0.4 * v });
    this.noise({ dur: 0.05, vol: 0.3 * v, freq: 900, q: 1.2 });
  }

  lip() {
    this.tone({ f: 1800, f2: 1500, dur: 0.06, type: 'triangle', vol: 0.12 });
  }

  bumper() {
    this.tone({ f: 520, f2: 1040, dur: 0.16, type: 'square', vol: 0.08 });
    this.tone({ f: 780, f2: 1560, dur: 0.14, type: 'sine', vol: 0.18, at: 0.015 });
  }

  sand() {
    this.noise({ dur: 0.3, vol: 0.25, freq: 3200, freq2: 1400, q: 0.5 });
  }

  splash() {
    this.noise({ dur: 0.7, vol: 0.45, freq: 900, freq2: 220, q: 0.6, type: 'lowpass' });
    this.tone({ f: 320, f2: 90, dur: 0.3, vol: 0.2 });
    for (let i = 0; i < 4; i++) {
      this.tone({ f: 500 + Math.random() * 700, f2: 900 + Math.random() * 600, dur: 0.06, vol: 0.08, at: 0.15 + i * 0.08 + Math.random() * 0.05 });
    }
  }

  portal() {
    this.tone({ f: 180, f2: 1300, dur: 0.35, vol: 0.18 });
    this.tone({ f: 270, f2: 1900, dur: 0.35, type: 'triangle', vol: 0.07, at: 0.03 });
  }

  sink() {
    [0, 0.07, 0.12].forEach((d, i) => this.tone({ f: 1500 - i * 220, dur: 0.05, type: 'triangle', vol: 0.22, at: d }));
    this.tone({ f: 170, f2: 70, dur: 0.28, vol: 0.4, at: 0.16 });
  }

  fanfare(level) {
    const notes = level >= 3 ? [523, 659, 784, 1047, 1319, 1568] : level === 2 ? [523, 659, 784, 1047] : [523, 659, 784];
    notes.forEach((f, i) => {
      this.tone({ f, dur: 0.3, type: 'triangle', vol: 0.16, at: 0.35 + i * 0.09 });
      this.tone({ f: f * 2, dur: 0.2, type: 'sine', vol: 0.05, at: 0.35 + i * 0.09 });
    });
  }

  womp() {
    this.tone({ f: 330, f2: 300, dur: 0.25, type: 'triangle', vol: 0.14, at: 0.35 });
    this.tone({ f: 260, f2: 200, dur: 0.45, type: 'triangle', vol: 0.14, at: 0.6 });
  }

  click() {
    this.tone({ f: 700, dur: 0.05, type: 'sine', vol: 0.12 });
  }
}
