// The sound engine: instrument samples played back at any note by changing
// their playback rate, or synths (an oscillator: sine, triangle, sawtooth or
// square) that sound for as long as a note is held. Each "voice" is one thing touching the board (the mouse, a
// controller, a hand), so two hands can sound two notes at once.

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

/** Instrument samples in public/sounds, then the synths. */
export const INSTRUMENTS = [
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
  ...Object.keys(SYNTHS),
];

const MAX_SOURCES = 32; // oldest one-shots are cut beyond this
const SAMPLE_LEVEL = 0.45; // peak level a sample is normalised to
const ECHO_DELAY = 0.3; // seconds
const ECHO_FEEDBACK = 0.4;

let ctx = null;
let master;
let echoSend;
const samples = new Map(); // name -> Promise<{ buffer, note, gain }>
const sources = [];
const synths = new Map(); // voice -> { osc, gain }

function context() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.connect(ctx.destination);
  // echo: a delay feeding back into itself, mixed into the output
  echoSend = ctx.createGain();
  echoSend.gain.value = 0;
  const delay = ctx.createDelay(2);
  delay.delayTime.value = ECHO_DELAY;
  const feedback = ctx.createGain();
  feedback.gain.value = ECHO_FEEDBACK;
  echoSend.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(master);
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

function playSample(sample, note) {
  const c = context();
  const source = c.createBufferSource();
  source.buffer = sample.buffer;
  source.playbackRate.value = 2 ** ((note - (sample.note ?? 0)) / 12);
  const gain = c.createGain();
  gain.gain.value = sample.gain;
  source.connect(gain);
  gain.connect(master);
  gain.connect(echoSend);
  source.onended = () => {
    const i = sources.indexOf(source);
    if (i >= 0) sources.splice(i, 1);
    gain.disconnect();
  };
  source.start();
  sources.push(source);
  if (sources.length > MAX_SOURCES) sources.shift().stop();
}

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
 * out; a synth sounds until noteOff.
 */
export function noteOn(voice, note, instrument) {
  const c = context();
  if (isSynth(instrument)) {
    const { type, level } = SYNTHS[instrument];
    const { osc, gain } = synthVoice(voice);
    osc.type = type;
    osc.frequency.setTargetAtTime(noteToFrequency(note), c.currentTime, 0.005);
    gain.gain.setTargetAtTime(level, c.currentTime, 0.01);
    return;
  }
  const sample = samples.get(instrument);
  sample?.then((s) => playSample(s, note)).catch(() => {});
}

/** `voice` left the board. */
export function noteOff(voice) {
  const v = synths.get(voice);
  if (v) v.gain.gain.setTargetAtTime(0, context().currentTime, 0.03);
}

/** Silences every held oscillator, e.g. when switching instrument. */
export function allNotesOff() {
  for (const voice of synths.keys()) noteOff(voice);
}
