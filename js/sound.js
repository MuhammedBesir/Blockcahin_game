// Basit oyun sesleri. Harici ses dosyası yok, hepsi Web Audio API ile anlık üretilir.
// Her çağıran (telefon, host) kendi localStorage anahtarıyla bağımsız bir "sessiz" tercihi tutar.
// iOS/Safari kuralı: AudioContext, kullanıcı dokunuşu içinde (mümkünse ilk satırda, await'ten önce)
// unlock() ile açılmalı, yoksa sesler hiç çalmaz.

export function createSoundKit(storageKey) {
  const store = {
    get: () => { try { return localStorage.getItem(storageKey); } catch { return null; } },
    set: (v) => { try { localStorage.setItem(storageKey, v); } catch {} },
  };
  let muted = store.get() === '1';
  let ctx = null;

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch { return; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function tone(freq, dur, opts = {}) {
    if (muted || !ctx || ctx.state !== 'running') return;
    const { type = 'sine', gain = 0.18, delay = 0, sweepTo } = opts;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }
  function seq(freqs, step, dur, opts) { freqs.forEach((f, i) => tone(f, dur, { ...opts, delay: (opts?.delay || 0) + i * step })); }

  return {
    unlock,
    isMuted: () => muted,
    setMuted(v) { muted = !!v; store.set(muted ? '1' : '0'); },
    toggleMuted() { muted = !muted; store.set(muted ? '1' : '0'); return muted; },
    // Geri sayım: her saniye kısa "tık", "BAŞLA!" anında yükselen ton
    tick: () => tone(760, 0.07, { type: 'square', gain: 0.14 }),
    go: () => { tone(520, 0.06, { type: 'square', gain: 0.16 }); tone(880, 0.26, { delay: 0.05, sweepTo: 1320, gain: 0.22, type: 'triangle' }); },
    star: () => tone(1100, 0.14, { type: 'triangle', sweepTo: 1760, gain: 0.16 }),
    trap: () => tone(260, 0.22, { type: 'sawtooth', sweepTo: 80, gain: 0.22 }),
    finish: () => seq([660, 880, 1108], 0.09, 0.2, { type: 'triangle', gain: 0.18 }),
    record: () => seq([660, 880, 1108, 1320, 1568], 0.08, 0.22, { type: 'triangle', gain: 0.22 }),
    banned: () => tone(180, 0.4, { type: 'sawtooth', sweepTo: 55, gain: 0.2 }),
    tap: () => tone(340, 0.045, { type: 'square', gain: 0.08 }),
  };
}
