// Procedural WebAudio Soulslike Combat & Atmos Sound Synthesizer
// Zero external audio file dependencies — instant response for Deflect clangs, Mirage Step slow-mo,
// sword whooshes, Crushing Counters, Shrine chimes, and water splashes.

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    this.ctx = new AudioCtx();
    return this.ctx;
  }

  swing(heavy = false) {
    const ctx = this.init();
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const dur = heavy ? 0.28 : 0.16;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * t) * (1 - t * 0.4);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(heavy ? 420 : 680, now);
    filter.frequency.exponentialRampToValueAtTime(heavy ? 140 : 240, now + dur);
    filter.Q.value = 2.4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(heavy ? 0.26 : 0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  }

  deflect(perfect = true) {
    const ctx = this.init();
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    // Resonant Sekiro/Wukong metallic sword-ring harmonic stack
    const freqs = perfect ? [1180, 1760, 2640, 3520, 4680] : [620, 940, 1420];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx % 2 === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.96, now + (perfect ? 0.55 : 0.22));
      const amp = (perfect ? 0.14 : 0.08) / (1 + idx * 0.5);
      gain.gain.setValueAtTime(amp, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + (perfect ? 0.55 : 0.22));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + (perfect ? 0.56 : 0.24));
    });
  }

  hit(heavy = false, crushing = false) {
    const ctx = this.init();
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(crushing ? 190 : heavy ? 140 : 110, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + (crushing ? 0.32 : 0.18));
    gain.gain.setValueAtTime(crushing ? 0.32 : heavy ? 0.24 : 0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (crushing ? 0.32 : 0.18));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (crushing ? 0.34 : 0.2));

    if (crushing) {
      const bell = ctx.createOscillator();
      const bg = ctx.createGain();
      bell.type = 'sine';
      bell.frequency.setValueAtTime(880, now);
      bell.frequency.exponentialRampToValueAtTime(1320, now + 0.28);
      bg.gain.setValueAtTime(0.15, now);
      bg.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      bell.connect(bg);
      bg.connect(ctx.destination);
      bell.start(now);
      bell.stop(now + 0.36);
    }
  }

  mirageStep() {
    const ctx = this.init();
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(130, now + 0.38);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.42);
  }

  shrine() {
    const ctx = this.init();
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    [261.63, 329.63, 392.0, 523.25, 659.25].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + i * 0.06);
      gain.gain.setValueAtTime(0.001, now + i * 0.06);
      gain.gain.linearRampToValueAtTime(0.09, now + i * 0.06 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + i * 0.06 + 1.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.06);
      osc.stop(now + i * 0.06 + 1.45);
    });
  }

  waterStep() {
    const ctx = this.init();
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const dur = 0.09;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1100 + Math.random() * 400, now);
    filter.Q.value = 3.0;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  }
}

export const sound = new SoundEngine();
