// The sound engine: instrument samples played back at any note by changing
// their playback rate, or synths (an oscillator: sine, triangle, sawtooth or
// square) that sound for as long as a note is held. Each "voice" is one note
// being touched by one thing (the mouse, a controller, a hand, the pick), so
// any number of notes can sound at once. A voice can be bent: its pitch
// raised or lowered by semitones while it sounds. Notes can be quantized:
// held back to the next point of a beat grid. The echo repeats once a beat.

import { detectPitch } from './pitch.js';
import { frequencyToNote, noteToFrequency } from './music.js';

const BASE = import.meta.env.BASE_URL;

/** Synths: the oscillator wave each plays, and its level (the buzzier waves are louder for the same peak). */
const SYNTHS = {
  Sine: { type: 'sine', level: 0.25 },
  Triangle: { type: 'triangle', level: 0.25 },
  Sawtooth: { type: 'sawtooth', level: 0.12 },
  Square: { type: 'square', level: 0.1 },
};

/** Whether `instrument` is a synth rather than a sample. */
export const isSynth = (instrument) => instrument in SYNTHS;

/** The synths, then the instrument samples in public/sounds. */
export const INSTRUMENTS = [
  ...Object.keys(SYNTHS),
  'Trombone',
  'Piano',
  'Banjo',
  'Harp',
  'Koto',
  'Clarinet',
  'French Horn',
  'Alto Sax',
  'Flute',
  'Viola',
  'Strings',
  'Xylophone',
  'Bass Guitar',
];

const MAX_SOURCES = 32; // oldest one-shots are cut beyond this
const SAMPLE_LEVEL = 0.45; // peak level a sample is normalised to
const ECHO_FEEDBACK = 0.4;
const MAX_ECHO = 2; // seconds: the longest echo (a beat at 30 BPM)
const QUANTIZE_LATE = 0.04; // seconds: a note this soon after a grid point plays at once, rather than a whole step late
const QUANTIZED_SYNTH_MIN = 0.12; // seconds: a quantized synth note let go before it starts still sounds this long

/**
 * The beat grid: when a beat fell (performance.now() seconds), a beat's
 * length, and how many steps a beat is quantized into (0: not quantized).
 */
const grid = { origin: 0, beat: 0.6, division: 0 };
let echoTime = grid.beat;

let ctx = null;
let master;
let echoSend;
let echoDelay;
const SYNTH_RELEASE = 0.03; // seconds: a released synth fades with this time constant...
const SYNTH_STOP = 0.3; // ...and its oscillator stops this long after
const samples = new Map(); // name -> Promise<{ buffer, note, gain }>
const sources = [];
const synths = new Map(); // voice -> { osc, gain }, while held
const ringing = new Map(); // voice -> { source, rate } for its latest sample, while it rings
const bends = new Map(); // voice -> semitones it is bent by

function context() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.connect(ctx.destination);
  // echo: a delay feeding back into itself, mixed into the output
  echoSend = ctx.createGain();
  echoSend.gain.value = 0;
  echoDelay = ctx.createDelay(MAX_ECHO);
  echoDelay.delayTime.value = echoTime;
  const feedback = ctx.createGain();
  feedback.gain.value = ECHO_FEEDBACK;
  echoSend.connect(echoDelay);
  echoDelay.connect(feedback);
  feedback.connect(echoDelay);
  echoDelay.connect(master);
  return ctx;
}

/** Browsers start audio suspended until a tap or key press: call from one. */
export function unlockAudio() {
  const c = context();
  if (c.state === 'suspended') c.resume().catch(() => {});
}

export function setEcho(on) {
  const c = context();
  echoSend.gain.setTargetAtTime(on ? 0.6 : 0, c.currentTime, 0.02);
}

/**
 * Sets the beat grid: `beat` (a beat's length in seconds, which the echo
 * repeats at), `origin` (when a beat fell, in performance.now() seconds) and
 * `division` (steps per beat that notes are quantized to; 0 for none). Any
 * left out stay as they were.
 */
export function setBeatGrid({ origin, beat, division }) {
  if (origin != null) grid.origin = origin;
  if (division != null) grid.division = division;
  if (beat != null) {
    grid.beat = beat;
    echoTime = Math.min(beat, MAX_ECHO);
    if (ctx) echoDelay.delayTime.setTargetAtTime(echoTime, ctx.currentTime, 0.05);
  }
}

/** Seconds until a note struck now should sound: the next grid point, or 0 when not quantized. */
function quantizeDelay() {
  if (!grid.division) return 0;
  const step = grid.beat / grid.division;
  const since = (((performance.now() / 1000 - grid.origin) % step) + step) % step;
  return since < QUANTIZE_LATE ? 0 : step - since;
}

/**
 * Loads and decodes an instrument, and finds the pitch it was recorded at.
 * Resolves to { note } (fractional semitones from C4, or null if no pitch
 * was found), cached per instrument.
 */
export function loadInstrument(name) {
  if (isSynth(name)) return Promise.resolve({ note: null });
  if (!samples.has(name)) {
    const url = `${BASE}sounds/${encodeURIComponent(name)}.wav`;
    const loading = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.arrayBuffer();
      })
      .then((data) => context().decodeAudioData(data))
      .then((buffer) => {
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
        const hz = detectPitch(channels, buffer.sampleRate);
        let peak = 0;
        for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
        // no pitch found: play it as if it were middle C
        return { buffer, note: hz ? frequencyToNote(hz) : null, gain: peak > 0 ? SAMPLE_LEVEL / peak : 1 };
      });
    loading.catch(() => samples.delete(name)); // let a later try fetch it again
    samples.set(name, loading);
  }
  return samples.get(name);
}

const bendRatio = (voice) => 2 ** ((bends.get(voice) ?? 0) / 12);

function playSample(voice, sample, note, at) {
  const c = context();
  const source = c.createBufferSource();
  source.buffer = sample.buffer;
  const rate = 2 ** ((note - (sample.note ?? 0)) / 12);
  source.playbackRate.value = rate * bendRatio(voice);
  ringing.set(voice, { source, rate });
  const gain = c.createGain();
  gain.gain.value = sample.gain;
  source.connect(gain);
  gain.connect(master);
  gain.connect(echoSend);
  source.onended = () => {
    const i = sources.indexOf(source);
    if (i >= 0) sources.splice(i, 1);
    if (ringing.get(voice)?.source === source) ringing.delete(voice);
    gain.disconnect();
  };
  // `at`: when it should sound, in performance.now() seconds
  source.start(c.currentTime + Math.max(0, at - performance.now() / 1000));
  sources.push(source);
  if (sources.length > MAX_SOURCES) sources.shift().stop();
}

/** The voice's oscillator, started silent if it has none (one released has gone: see noteOff). */
function synthVoice(voice) {
  let v = synths.get(voice);
  if (!v) {
    const c = context();
    const osc = c.createOscillator();
    const gain = c.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(master);
    gain.connect(echoSend);
    osc.start();
    v = { osc, gain };
    synths.set(voice, v);
  }
  return v;
}

/**
 * `voice` touched `note` (or moved onto it). A sample sounds once and rings
 * out; a synth sounds until noteOff. Quantized, either waits for the next
 * grid point.
 */
export function noteOn(voice, note, instrument) {
  const c = context();
  const wait = quantizeDelay();
  if (isSynth(instrument)) {
    const { type, level } = SYNTHS[instrument];
    const v = synthVoice(voice);
    const start = c.currentTime + wait;
    v.start = start;
    v.osc.type = type;
    v.osc.frequency.setTargetAtTime(noteToFrequency(note), start, 0.005);
    v.osc.detune.setValueAtTime((bends.get(voice) ?? 0) * 100, start);
    v.gain.gain.setTargetAtTime(level, start, 0.01);
    return;
  }
  const at = performance.now() / 1000 + wait;
  const sample = samples.get(instrument);
  sample?.then((s) => playSample(voice, s, note, at)).catch(() => {});
}

/**
 * `voice` let go: a synth fades out and its oscillator stops (a quantized one
 * not yet started still sounds briefly); a sample rings on.
 */
export function noteOff(voice) {
  const v = synths.get(voice);
  if (!v) return;
  synths.delete(voice);
  const now = context().currentTime;
  const t = v.start > now ? v.start + QUANTIZED_SYNTH_MIN : now;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setTargetAtTime(0, t, SYNTH_RELEASE);
  v.osc.stop(t + SYNTH_STOP);
  v.osc.onended = () => v.gain.disconnect();
}

/**
 * Bends `voice` by `semitones` (fractional; 0 is unbent): a ringing sample
 * plays faster or slower, a held synth's pitch shifts. It stays bent for the
 * voice's next note too, until bent back.
 */
export function setBend(voice, semitones) {
  if (semitones) bends.set(voice, semitones);
  else bends.delete(voice);
  if (!ctx) return;
  const t = ctx.currentTime;
  const sample = ringing.get(voice);
  sample?.source.playbackRate.setTargetAtTime(sample.rate * bendRatio(voice), t, 0.01);
  synths.get(voice)?.osc.detune.setTargetAtTime(semitones * 100, t, 0.01);
}

let noise = null;
/** A short burst of white noise, shared by the clicks. */
function noiseBuffer(c) {
  if (!noise) {
    noise = c.createBuffer(1, Math.ceil(c.sampleRate * 0.05), c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** One click at `time`: a tick of noise band-passed around `freq`, over a little falling knock. */
function click(c, time, freq, level) {
  const out = c.createGain();
  out.gain.setValueAtTime(level, time);
  out.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
  out.connect(master);
  const tick = c.createBufferSource();
  tick.buffer = noiseBuffer(c);
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 4;
  tick.connect(band).connect(out);
  tick.start(time);
  tick.stop(time + 0.05);
  const knock = c.createOscillator();
  knock.type = 'triangle';
  knock.frequency.setValueAtTime(freq / 4, time);
  knock.frequency.exponentialRampToValueAtTime(freq / 8, time + 0.03);
  const knockGain = c.createGain();
  knockGain.gain.value = 0.4;
  knock.connect(knockGain).connect(out);
  knock.start(time);
  knock.stop(time + 0.05);
  knock.onended = () => out.disconnect();
}

/** The menu panel's latch: a rising "click-clack" as it docks ('attach'), a falling one as it comes away ('detach'). */
export function playClick(kind) {
  const c = context();
  const t = c.currentTime + 0.005;
  if (kind === 'attach') {
    click(c, t, 2000, 0.6);
    click(c, t + 0.05, 3400, 0.45);
  } else {
    click(c, t, 3000, 0.35);
    click(c, t + 0.06, 1600, 0.5);
  }
}

const STRUM = 0.025; // seconds between a strummed chord's notes, low to high
const CHORD_HOLD = 1; // seconds a strummed chord's synth notes sound

let chordTimers = [];

/**
 * Strums `notes` (semitones from C4, low to high) once on `instrument`, each
 * as its own voice. A chord still sounding from before makes way.
 */
export function playChord(notes, instrument) {
  chordTimers.forEach(clearTimeout);
  chordTimers = [];
  for (const voice of [...synths.keys()]) if (voice.startsWith('chord:')) noteOff(voice);
  notes.forEach((note, i) => {
    const voice = `chord:${i}`;
    chordTimers.push(
      setTimeout(() => noteOn(voice, note, instrument), i * STRUM * 1000),
      setTimeout(() => noteOff(voice), (i * STRUM + CHORD_HOLD) * 1000),
    );
  });
}

/** Silences every held oscillator and forgets every bend, e.g. when switching instrument. */
export function allNotesOff() {
  for (const voice of [...synths.keys()]) noteOff(voice);
  bends.clear();
}
