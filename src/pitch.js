// Finds the pitch a sample was recorded at, so it can be played back at any
// note by changing its playback rate. Replaces the old page's FFT peak search
// (pitchshift.js + dsp.js), which could lock onto a harmonic and come out a
// fifth or an octave off. This is the McLeod pitch method: a normalised
// autocorrelation, taking the first lag that is nearly as similar as the best.

const MIN_HZ = 40;
const MAX_HZ = 2000;
const WINDOW = 4096;
const KEY_MAX = 0.9; // the first peak at least this fraction of the highest one

/** One channel: the average of all of them. */
function mono(channels) {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** The start of the loudest stretch, past the attack, where the tone is steadiest. */
function loudestStart(x, size) {
  const block = 1024;
  let best = 0;
  let bestEnergy = -1;
  for (let start = 0; start + size <= x.length; start += block) {
    let e = 0;
    for (let i = start; i < start + block; i++) e += x[i] * x[i];
    if (e > bestEnergy) {
      bestEnergy = e;
      best = start;
    }
  }
  return Math.min(best + block, Math.max(0, x.length - size));
}

/**
 * The fundamental frequency in Hz of `channels` (Float32Arrays, as
 * AudioBuffer.getChannelData gives them), or null if no steady pitch is found.
 */
export function detectPitch(channels, sampleRate) {
  const x = mono(channels);
  const size = Math.min(WINDOW, x.length);
  const start = loudestStart(x, size);
  const minLag = Math.floor(sampleRate / MAX_HZ);
  const maxLag = Math.min(Math.ceil(sampleRate / MIN_HZ), size >> 1);
  if (maxLag <= minLag + 2) return null;

  const nsdf = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let acf = 0;
    let energy = 0;
    for (let i = start, end = start + size - lag; i < end; i++) {
      const a = x[i];
      const b = x[i + lag];
      acf += a * b;
      energy += a * a + b * b;
    }
    nsdf[lag] = energy > 0 ? (2 * acf) / energy : 0;
  }

  // the highest point of each positive lobe after the first zero crossing
  const peaks = [];
  let lag = 1;
  while (lag < maxLag && nsdf[lag] > 0) lag++;
  while (lag < maxLag) {
    while (lag < maxLag && nsdf[lag] <= 0) lag++;
    let top = lag;
    while (lag < maxLag && nsdf[lag] > 0) {
      if (nsdf[lag] > nsdf[top]) top = lag;
      lag++;
    }
    if (top >= minLag && top < maxLag && nsdf[top] > 0) peaks.push(top);
  }
  if (!peaks.length) return null;
  const highest = Math.max(...peaks.map((p) => nsdf[p]));
  if (highest < 0.5) return null; // noise or a drum: nothing to tune
  const pick = peaks.find((p) => nsdf[p] >= KEY_MAX * highest);

  // parabolic interpolation between neighbouring lags
  const a = nsdf[pick - 1];
  const b = nsdf[pick];
  const c = nsdf[pick + 1];
  const denom = a - 2 * b + c;
  const offset = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  return sampleRate / (pick + offset);
}
