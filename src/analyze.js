// Working out what was played into the microphone (see recorder.js): its
// tempo, beats per measure, key and scale, and a chord for each measure. All
// estimates, from the recording's spectrum frame by frame:
//   - an onset envelope (spectral flux: how much louder each frame got)
//     autocorrelated for the beat, nudged toward a moderate tempo so it
//     doesn't settle on half or double;
//   - beats per measure from where the onsets are strongest and the harmony
//     changes most, every n beats;
//   - a chromagram (each frame's energy folded into the twelve pitch
//     classes), matched against the Krumhansl-Schmuckler key profiles for the
//     key, and against chord templates measure by measure for the chords.
// Pure functions, no DOM: it runs in a browser after Stop, or in Node.

import { CHORD_TYPES, chordPitchClasses, frequencyToNote, mod12 } from './music.js';

const TARGET_RATE = 22050; // Hz the recording is brought down to
const FFT_SIZE = 4096; // for the chroma: fine enough to tell neighbouring notes apart low down
const ONSET_SIZE = 1024; // for the onsets: short, so an attack shows when it happens, centred in the chroma's window
const HOP = 512;
const CHROMA_RANGE = [65, 2000]; // Hz: C2 to about B6, where the harmony is
const TEMPO_RANGE = [60, 200]; // BPM
const TEMPO_CENTRE = 110; // BPM the beat leans toward, to tell it from its half or double
const TEMPO_SPREAD = 1; // octaves either side the lean fades over
const METERS = [2, 3, 4, 5, 6, 7]; // beats per measure (as Progression → Beats per Measure)
// how much likelier each meter is to start with: 4 and 3 most, odd meters least, as in most music
const METER_PRIOR = { 2: 1, 3: 1.2, 4: 1.3, 5: 0.75, 6: 0.9, 7: 0.7 };
const SEVENTH_MARGIN = 0.03; // a 7th chord must match this much better than its triad
const IN_KEY_BONUS = 0.02; // ...and a chord in the key a little better than one out of it
const DIATONIC_WEIGHT = 0.5; // the key: how much the chords all lying in it count, beside its profile...
const TONIC_WEIGHT = 0.15; // ...and the progression starting or ending on its home chord
const QUIET = 1e-4; // RMS below which there's nothing to hear
const MIN_MEASURES = 2;

// Krumhansl-Schmuckler key profiles: how strongly each scale degree belongs to a major or minor key
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

/**
 * The chords looked for: every triad quality, then the 7ths a chart writes
 * most (major 7th, dominant, minor 7th, half and fully diminished).
 */
const TRIADS = CHORD_TYPES.filter((t) => t.id !== 'hdim').map((t) => ({ type: t.id, modifier: 'none' }));
const SEVENTHS = [
  { type: 'maj', modifier: 'maj7' },
  { type: 'maj', modifier: 'dom7' },
  { type: 'min', modifier: 'dom7' },
  { type: 'hdim', modifier: 'none' },
  { type: 'dim', modifier: 'dom7' },
];
const BASE_TRIAD = { maj: 'maj', min: 'min', hdim: 'dim', dim: 'dim' }; // a 7th chord's triad, for its margin

/** The recording brought down to about TARGET_RATE, each output sample the average of the ones it replaces. */
function decimate(samples, rate) {
  const factor = Math.max(1, Math.round(rate / TARGET_RATE));
  if (factor === 1) return { x: samples, rate };
  const x = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < x.length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += samples[i * factor + k];
    x[i] = sum / factor;
  }
  return { x, rate: rate / factor };
}

/** An in-place radix-2 FFT of `re` + i`im` (length a power of two). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

const hann = (n) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));

/**
 * Frame by frame, each centred HOP after the last: the onset strength
 * (spectral flux of the log magnitude, over a short window) and the chroma
 * (energy in each pitch class, over a long one). Returns { onset, chroma, frameRate }.
 */
function frames(x, rate) {
  const window = hann(FFT_SIZE);
  const onsetWindow = hann(ONSET_SIZE);
  const onsetAt = (FFT_SIZE - ONSET_SIZE) / 2; // the short window's start within the long one: the same centre
  // each bin's pitch class, or -1 outside the chroma range
  const pcOf = Int8Array.from({ length: FFT_SIZE / 2 }, (_, k) => {
    const hz = (k * rate) / FFT_SIZE;
    return hz >= CHROMA_RANGE[0] && hz <= CHROMA_RANGE[1] ? mod12(Math.round(frequencyToNote(hz))) : -1;
  });
  const count = Math.max(0, Math.floor((x.length - FFT_SIZE) / HOP) + 1);
  const onset = new Float64Array(count);
  const chroma = Array.from({ length: count }, () => new Float64Array(12));
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const ore = new Float64Array(ONSET_SIZE);
  const oim = new Float64Array(ONSET_SIZE);
  let prev = new Float64Array(ONSET_SIZE / 2);
  let now = new Float64Array(ONSET_SIZE / 2);
  for (let f = 0; f < count; f++) {
    const start = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = x[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < FFT_SIZE / 2; k++) if (pcOf[k] >= 0) chroma[f][pcOf[k]] += Math.hypot(re[k], im[k]);
    for (let i = 0; i < ONSET_SIZE; i++) {
      ore[i] = x[start + onsetAt + i] * onsetWindow[i];
      oim[i] = 0;
    }
    fft(ore, oim);
    let flux = 0;
    for (let k = 1; k < ONSET_SIZE / 2; k++) {
      now[k] = Math.log1p(100 * Math.hypot(ore[k], oim[k]));
      if (f > 0) flux += Math.max(0, now[k] - prev[k]);
    }
    onset[f] = flux;
    [prev, now] = [now, prev];
  }
  return { onset, chroma, frameRate: rate / HOP };
}

const ONSET_BLUR = 1.5; // frames: the onsets softened so a beat period between whole frames still lines them up

/**
 * The onset envelope with its local average taken away (half a second either
 * way), negatives dropped, and softened a little.
 */
function sharpen(onset, frameRate) {
  const half = Math.round(frameRate / 2);
  const out = new Float64Array(onset.length);
  let sum = 0;
  let from = 0;
  let to = -1;
  for (let i = 0; i < onset.length; i++) {
    while (to < Math.min(onset.length - 1, i + half)) sum += onset[++to];
    while (from < i - half) sum -= onset[from++];
    out[i] = Math.max(0, onset[i] - sum / (to - from + 1));
  }
  return blur(out, ONSET_BLUR);
}

/** `a` smoothed with a Gaussian `sigma` samples wide. */
function blur(a, sigma) {
  const reach = Math.ceil(3 * sigma);
  const kernel = Array.from({ length: 2 * reach + 1 }, (_, k) => Math.exp(-0.5 * ((k - reach) / sigma) ** 2));
  const total = kernel.reduce((s, v) => s + v, 0);
  return Float64Array.from(a, (_, i) => {
    let sum = 0;
    for (let k = -reach; k <= reach; k++) sum += (a[i + k] ?? 0) * kernel[k + reach];
    return sum / total;
  });
}

/** The value of `a` at fractional index `i` (0 beyond its ends). */
const at = (a, i) => {
  const j = Math.floor(i);
  if (j < 0 || j + 1 >= a.length) return 0;
  return a[j] + (a[j + 1] - a[j]) * (i - j);
};

/** The beat period in frames (fractional), from the onset envelope's autocorrelation leaning toward TEMPO_CENTRE. */
function beatPeriod(onset, frameRate) {
  const lagFor = (bpm) => (60 * frameRate) / bpm;
  const lo = Math.floor(lagFor(TEMPO_RANGE[1]));
  const hi = Math.ceil(lagFor(TEMPO_RANGE[0]));
  const scores = new Float64Array(hi + 2);
  for (let lag = lo; lag <= hi + 1; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < onset.length; i++) sum += onset[i] * onset[i + lag];
    scores[lag] = sum / Math.max(1, onset.length - lag);
  }
  let best = lo;
  let bestScore = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    const bpm = (60 * frameRate) / lag;
    const lean = Math.exp(-0.5 * (Math.log2(bpm / TEMPO_CENTRE) / TEMPO_SPREAD) ** 2);
    const score = scores[lag] * lean;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // refine between neighbouring lags (parabolic fit)
  const [a, b, c] = [scores[best - 1] ?? 0, scores[best], scores[best + 1] ?? 0];
  const denom = a - 2 * b + c;
  return best + (denom < 0 ? (0.5 * (a - c)) / denom : 0);
}

/** Where the beats fall (frame indices, fractional): the phase whose beats land on the most onset. */
function beatTimes(onset, period) {
  let best = 0;
  let bestScore = -Infinity;
  for (let phase = 0; phase < period; phase += 0.5) {
    let score = 0;
    for (let t = phase; t < onset.length; t += period) score += at(onset, t);
    if (score > bestScore) {
      bestScore = score;
      best = phase;
    }
  }
  // back to the first beat, even one right at the start, before any flux could show it
  let first = best;
  while (first - period > -period / 2) first -= period;
  const beats = [];
  for (let t = Math.max(0, first); t < onset.length; t += period) beats.push(t);
  return beats;
}

/** Each beat's chroma: the frames from it to the next, summed. */
function beatChroma(chroma, beats) {
  return beats.map((start, i) => {
    const end = i + 1 < beats.length ? beats[i + 1] : Math.min(chroma.length, start + (beats[1] - beats[0] || 1));
    const sum = new Float64Array(12);
    for (let f = Math.floor(start); f < Math.min(chroma.length, Math.floor(end)); f++) for (let pc = 0; pc < 12; pc++) sum[pc] += chroma[f][pc];
    return sum;
  });
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Beats per measure and where measures start (the beat index of the first
 * downbeat): the meter whose downbeats carry the most onset and the most
 * harmonic change, compared with its other beats, weighed by how common it is.
 */
function meter(onset, beats, chromas) {
  const strength = beats.map((t) => at(onset, Math.round(t)) + at(onset, Math.round(t) + 1));
  const change = chromas.map((c, i) => (i === 0 ? 0 : 1 - cosine(chromas[i - 1], c)));
  const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  let best = { beats: 4, first: 0, score: -Infinity };
  for (const n of METERS) {
    if (beats.length < 2 * n) continue;
    for (let first = 0; first < n; first++) {
      const isDown = (i) => ((i - first) % n + n) % n === 0;
      // downbeats against the rest, each a little smoothed so a silent beat can't run away with it
      const contrast = (a) => (mean(a.filter((_, i) => isDown(i))) + 0.05) / (mean(a.filter((_, i) => !isDown(i))) + 0.05);
      const score = contrast(strength) * contrast(change) * METER_PRIOR[n];
      if (score > best.score) best = { beats: n, first, score };
    }
  }
  return best;
}

/**
 * The key and scale (major or natural minor) the recording is in: the one
 * whose profile its whole chroma matches best, together with how many of
 * `chords` (found without a key) lie in it, and whether they start or end on
 * its home chord. Overtones tilt the chroma toward the fifth above, which the
 * chords set right.
 */
function keyOf(total, chords) {
  const pearson = (a, b) => {
    const ma = a.reduce((s, v) => s + v, 0) / 12;
    const mb = b.reduce((s, v) => s + v, 0) / 12;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < 12; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return da && db ? num / Math.sqrt(da * db) : 0;
  };
  let best = { key: 0, scale: 'major', score: -Infinity };
  for (let key = 0; key < 12; key++) {
    const rotated = Array.from({ length: 12 }, (_, i) => total[mod12(i + key)]);
    for (const [scale, profile] of [
      ['major', MAJOR_PROFILE],
      ['minor', MINOR_PROFILE],
    ]) {
      const steps = new Set((scale === 'minor' ? MINOR_STEPS : MAJOR_STEPS).map((s) => mod12(key + s)));
      const diatonic = chords.filter((c) => [...chordPitchClasses(c)].every((pc) => steps.has(pc))).length / chords.length;
      const tonicType = scale === 'minor' ? 'min' : 'maj';
      const isTonic = (c) => c?.root === key && c.type === tonicType;
      const tonic = (isTonic(chords[0]) ? 1 : 0) + (isTonic(chords.at(-1)) ? 1 : 0);
      const score = pearson(rotated, profile) + DIATONIC_WEIGHT * diatonic + TONIC_WEIGHT * tonic;
      if (score > best.score) best = { key, scale, score };
    }
  }
  return best;
}

/**
 * The chord a measure's chroma matches best (a 7th only by a clear margin over
 * its triad), preferring the key's, if `key` is given.
 */
function chordOf(chroma, key, scale) {
  const steps = new Set(key == null ? [] : (scale === 'minor' ? MINOR_STEPS : MAJOR_STEPS).map((s) => mod12(key + s)));
  const score = (chord) => {
    const pcs = chordPitchClasses(chord);
    const template = Array.from({ length: 12 }, (_, pc) => (pcs.has(pc) ? 1 : 0));
    const inKey = steps.size > 0 && [...pcs].every((pc) => steps.has(pc));
    return cosine(chroma, template) + (inKey ? IN_KEY_BONUS : 0);
  };
  let best = null;
  const triadScore = {};
  for (let root = 0; root < 12; root++)
    for (const shape of TRIADS) {
      const chord = { root, ...shape };
      const s = score(chord);
      triadScore[`${root}:${shape.type}`] = s;
      if (!best || s > best.score) best = { chord, score: s };
    }
  for (let root = 0; root < 12; root++)
    for (const shape of SEVENTHS) {
      const chord = { root, ...shape };
      const s = score(chord);
      if (s > (triadScore[`${root}:${BASE_TRIAD[shape.type]}`] ?? 0) + SEVENTH_MARGIN && s > best.score) best = { chord, score: s };
    }
  return best.chord;
}

/**
 * The recording (mono samples at `sampleRate`) analysed: { bpm, beatsPerMeasure,
 * key (0..11), scale ('major' | 'minor', as SCALES), chords: [{ root, type,
 * modifier }] one a measure } or { error } if there's too little to go on.
 */
export function analyze(samples, sampleRate) {
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  if (!samples.length || Math.sqrt(energy / samples.length) < QUIET) return { error: 'Nothing heard: is the microphone on?' };
  const { x, rate } = decimate(samples, sampleRate);
  const { onset: raw, chroma, frameRate } = frames(x, rate);
  const onset = sharpen(raw, frameRate);
  if (onset.length < frameRate * 2) return { error: 'Too short: record a few measures' };
  const period = beatPeriod(onset, frameRate);
  const beats = beatTimes(onset, period);
  const chromas = beatChroma(chroma, beats);
  const { beats: beatsPerMeasure, first } = meter(onset, beats, chromas);
  const measures = Math.floor((beats.length - first) / beatsPerMeasure);
  if (measures < MIN_MEASURES) return { error: 'Too short: record a few measures' };
  const total = new Float64Array(12);
  for (const c of chroma) for (let pc = 0; pc < 12; pc++) total[pc] += c[pc];
  // each measure's chroma; its chords found first without a key, to help find the key, then again within it
  const measureChroma = Array.from({ length: measures }, (_, m) => {
    const sum = new Float64Array(12);
    for (let b = 0; b < beatsPerMeasure; b++) {
      const c = chromas[first + m * beatsPerMeasure + b];
      for (let pc = 0; pc < 12; pc++) sum[pc] += c[pc];
    }
    return sum;
  });
  const { key, scale } = keyOf(
    total,
    measureChroma.map((c) => chordOf(c)),
  );
  const chords = measureChroma.map((c) => chordOf(c, key, scale));
  return { bpm: Math.round((60 * frameRate) / period), beatsPerMeasure, key, scale, chords };
}
