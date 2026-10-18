// The sound engine: instrument samples played back at any note by changing
// their playback rate, or synths (an oscillator: sine, triangle, sawtooth or
// square) that sound for as long as a note is held. Each "voice" is one note
// being touched by one thing (the mouse, a controller, a hand, the pick), so
// any number of notes can sound at once. A voice can be bent: its pitch
// raised or lowered by semitones while it sounds. Notes can be quantized:
// held back to the next point of a beat grid. The echo repeats once a beat.
// A note's velocity (0..1, how hard it was struck) sets its loudness. Every
// voice passes through a chain of effects, in a guitar pedalboard's order
// (see EFFECTS): dynamics and filters first, then the drives, the tone,
// modulation, the volume, and last the echo and reverb, so their tails carry
// everything before them and ring on past the volume. Each effect but the
// volume can be switched in or out, and has a slider (see the FilterFrame).
// The octave below is a second copy of each note, at half the pitch.

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
  'Guitar',
  'Classical Guitar',
  'Nylon Guitar',
  'Heavy Guitar',
  'Bass Guitar',
];

const MAX_SOURCES = 32; // oldest one-shots are cut beyond this
const SAMPLE_LEVEL = 0.45; // peak level a sample is normalised to
const ECHO_FEEDBACK = 0.4;
const MAX_ECHO = 2; // seconds: the longest echo (a beat at 30 BPM)
const QUANTIZE_LATE = 0.04; // seconds: a note this soon after a grid point plays at once, rather than a whole step late
const QUANTIZED_SYNTH_MIN = 0.12; // seconds: a quantized synth note let go before it starts still sounds this long
const MIN_VELOCITY = 0.2; // the softest note is struck at least this hard, so it's never silent
const VELOCITY_CURVE = 1.6; // loudness rises faster than velocity, so soft and hard sound evenly spaced
const EFFECT_FADE = 0.02; // seconds: the time constant switching an effect in or out fades with
const SLIDE = 0.02; // ...and a slider's moves glide with
const WAH_LOW = 350; // Hz: the wah's resonance heel down (slider at 0)...
const WAH_HIGH = 2500; // ...and toe down (at 1)
const WAH_Q = 6;
const WAH_LEVEL = 0.7; // the resonant peak is loud: the wah is mixed in a little lower
const AUTO_WAH_RANGE = [300, 3000]; // Hz: the auto-wah's resonance, quiet to loud
const AUTO_WAH_SENSE = [2, 40]; // how far a note's loudness opens it, slider at 0 and at 1
const AUTO_WAH_EVERY = 15; // ms between readings of the loudness
const FUZZ_DRIVE = [4, 300]; // the gain into the fuzz's clipping, slider at 0 and at 1
const FUZZ_LEVEL = 0.22; // out of it: a clipped wave is as loud as it gets, whatever the drive
const FUZZ_TONE = 3500; // Hz: the fuzz's fizz rolled off above this
const OVERDRIVE_DRIVE = [1, 12];
const OVERDRIVE_LEVEL = 0.45;
const OVERDRIVE_TONE = 6000;
const DISTORTION_DRIVE = [1.5, 40];
const DISTORTION_LEVEL = 0.3;
const DISTORTION_TONE = 5000;
const TONE_RANGE = [600, 12000]; // Hz: the tone's cutoff, dark to bright
const CHORUS_DELAY = 0.02; // seconds
const CHORUS_RATE = 0.8; // Hz
const CHORUS_DEPTH = [0.0005, 0.006]; // seconds the delay sways either way
const PHASER_RATE = [0.1, 4]; // Hz, slider at 0 and at 1
const PHASER_CENTRE = 800; // Hz the notches sweep about...
const PHASER_SWEEP = 600; // ...this far either way
const FLANGER_DELAY = 0.003;
const FLANGER_RATE = 0.25;
const FLANGER_DEPTH = [0.0003, 0.0025];
const FLANGER_FEEDBACK = 0.6;
const VIBRATO_DELAY = 0.006;
const VIBRATO_RATE = 5.5;
const VIBRATO_DEPTH = [0.0002, 0.003];
const TREMOLO_PER_BEAT = 2; // pulses a beat, at the progression's tempo
const VOLUME_TOP = 1.6; // the volume's gain at the slider's top: its default, 0.8, is about unity
const REVERB_SECONDS = 2.5;
const COMP_MAKEUP = 12; // dB the compressor makes up at the slider's top

/**
 * The effects, in signal-chain order: each one's id, name, whether it can be
 * switched out (`toggle`), and its slider's starting place (0..1).
 */
export const EFFECTS = [
  { id: 'comp', name: 'Comp', toggle: true, amount: 0.5 },
  { id: 'octave', name: 'Octave', toggle: true, amount: 0.6 },
  { id: 'autoWah', name: 'Auto-Wah', toggle: true, amount: 0.5 },
  { id: 'wah', name: 'Wah', toggle: true, amount: 0.5 },
  { id: 'fuzz', name: 'Fuzz', toggle: true, amount: 0.5 },
  { id: 'overdrive', name: 'Overdrive', toggle: true, amount: 0.5 },
  { id: 'distortion', name: 'Distortion', toggle: true, amount: 0.5 },
  { id: 'tone', name: 'Tone', toggle: true, amount: 0.6 },
  { id: 'chorus', name: 'Chorus', toggle: true, amount: 0.5 },
  { id: 'phaser', name: 'Phaser', toggle: true, amount: 0.4 },
  { id: 'flanger', name: 'Flanger', toggle: true, amount: 0.5 },
  { id: 'vibrato', name: 'Vibrato', toggle: true, amount: 0.4 },
  { id: 'tremolo', name: 'Tremolo', toggle: true, amount: 0.6 },
  { id: 'volume', name: 'Volume', toggle: false, amount: 0.8 },
  { id: 'echo', name: 'Echo', toggle: true, amount: 0.6 },
  { id: 'reverb', name: 'Reverb', toggle: true, amount: 0.35 },
];

/** A note's gain from its velocity (0..1): 1 at full velocity, about -22 dB at none. */
const velocityGain = (velocity) => (MIN_VELOCITY + (1 - MIN_VELOCITY) * Math.min(Math.max(velocity, 0), 1)) ** VELOCITY_CURVE;

/**
 * The beat grid: when a beat fell (performance.now() seconds), a beat's
 * length, and how many steps a beat is quantized into (0: not quantized).
 */
const grid = { origin: 0, beat: 0.6, division: 0 };

let ctx = null;
let master;
let bus; // every voice feeds this: the effects chain's input
let octaveBus; // every voice's octave below feeds this, into the octave's stage
let echoDelay;
let tremoloLfo;
const stages = {}; // effect id -> { dry, wet, level, parallel, apply(amount, t), onSwitch?(on) }, once the context exists
const effectOn = Object.fromEntries(EFFECTS.filter((e) => e.toggle).map((e) => [e.id, false])); // the switchable effects, in or out
const effectAmount = Object.fromEntries(EFFECTS.map((e) => [e.id, e.amount])); // each slider, 0..1
const SYNTH_RELEASE = 0.03; // seconds: a released synth fades with this time constant...
const SYNTH_STOP = 0.3; // ...and its oscillator stops this long after
const samples = new Map(); // name -> Promise<{ buffer, note, gain }>
const sources = [];
const synths = new Map(); // voice -> { osc, gain, sub, subGain }, while held
const ringing = new Map(); // voice -> { source, rate, sub } for its latest sample, while it rings
const bends = new Map(); // voice -> semitones it is bent by

function context() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.connect(ctx.destination);
  // the effects: the voices' bus through each in turn, then out
  bus = ctx.createGain();
  octaveBus = ctx.createGain();
  let chain = bus;
  for (const { id } of EFFECTS) chain = buildStage(id, chain);
  chain.connect(master);
  return ctx;
}

/** A slider (0..1) mapped onto a range, rising evenly in ratio: for frequencies and gains. */
const sweep = ([low, high], amount) => low * (high / low) ** Math.min(Math.max(amount, 0), 1);

/** ...or evenly in steps: for depths. */
const lerp = ([low, high], amount) => low + (high - low) * Math.min(Math.max(amount, 0), 1);

/** A wave-shaping curve over -1..1, `shape(x)` at each point. */
function curve(shape) {
  const points = new Float32Array(2048);
  for (let i = 0; i < points.length; i++) points[i] = shape((i / (points.length - 1)) * 2 - 1);
  return points;
}

/** Fuzz: clipped hard, and lopsided (it squares off sooner on the way up), like a germanium fuzz box. */
const FUZZ_CURVE = curve((x) => Math.min(Math.max(x * 1.5, -1), 0.7));
/** Overdrive: a gentle, lopsided rounding, like an overdriven valve. */
const OVERDRIVE_CURVE = curve((x) => (x >= 0 ? Math.tanh(1.8 * x) : Math.tanh(1.3 * x)));
/** Distortion: rounded off firmly, louder notes more so. */
const DISTORTION_CURVE = curve((x) => Math.tanh(3 * x));

/** A low-frequency oscillator at `rate` Hz, through a gain (its depth) for connecting to a parameter. */
function lfo(rate, depth) {
  const osc = ctx.createOscillator();
  osc.frequency.value = rate;
  const gain = ctx.createGain();
  gain.gain.value = depth;
  osc.connect(gain);
  osc.start();
  return { osc, depth: gain };
}

/** A reverb's impulse: stereo noise dying away over `seconds`. */
function impulse(seconds) {
  const length = Math.ceil(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return buffer;
}

/** Drive into a wave shaper, then a tone filter to tame the fizz: fuzz, overdrive and distortion. */
function driven(input, wet, id, range, shape, tone) {
  const drive = ctx.createGain();
  drive.gain.value = sweep(range, effectAmount[id]);
  const shaper = ctx.createWaveShaper();
  shaper.curve = shape;
  shaper.oversample = '4x';
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = tone;
  input.connect(drive).connect(shaper).connect(filter).connect(wet);
  return (amount, t) => drive.gain.setTargetAtTime(sweep(range, amount), t, SLIDE);
}

/** A delay swayed by an LFO, from `input` to `wet`: chorus, flanger and vibrato. Returns the LFO. */
function swayed(input, wet, base, rate, depth, feedback = 0) {
  const delay = ctx.createDelay(0.05);
  delay.delayTime.value = base;
  const sway = lfo(rate, depth);
  sway.depth.connect(delay.delayTime);
  input.connect(delay).connect(wet);
  if (feedback) {
    const back = ctx.createGain();
    back.gain.value = feedback;
    delay.connect(back).connect(delay);
  }
  return sway;
}

/**
 * Each effect's wiring, from the stage's `input` to its `wet` gain: returns
 * { apply(amount, t) } for its slider, and `level` (its wet gain while in),
 * `parallel` (whether the dry signal carries on beside it while it's in, as
 * for a mix), `onSwitch(on)` if it does something as it's switched.
 */
const BUILDERS = {
  comp(input, wet) {
    const comp = ctx.createDynamicsCompressor();
    comp.knee.value = 10;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    const makeup = ctx.createGain();
    input.connect(comp).connect(makeup).connect(wet);
    const apply = (amount, t) => {
      comp.threshold.setTargetAtTime(-6 - 44 * amount, t, SLIDE);
      comp.ratio.setTargetAtTime(2 + 10 * amount, t, SLIDE);
      makeup.gain.setTargetAtTime(10 ** ((COMP_MAKEUP * amount) / 20), t, SLIDE);
    };
    apply(effectAmount.comp, 0);
    return { apply };
  },
  // the octave below is played by each voice itself (see playSample, noteOn); here it joins the chain
  octave(input, wet) {
    octaveBus.gain.value = effectAmount.octave;
    octaveBus.connect(wet);
    return { parallel: true, apply: (amount, t) => octaveBus.gain.setTargetAtTime(amount, t, SLIDE) };
  },
  // a resonant filter opened by how loud the notes are, read off an analyser a few dozen times a second
  autoWah(input, wet) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = WAH_Q;
    filter.frequency.value = AUTO_WAH_RANGE[0];
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    input.connect(analyser);
    input.connect(filter).connect(wet);
    const data = new Float32Array(analyser.fftSize);
    let envelope = 0;
    let timer = null;
    const follow = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      // quick to open, slower to close, as a note's attack and decay
      envelope += (rms - envelope) * (rms > envelope ? 0.6 : 0.12);
      const open = Math.min(envelope * sweep(AUTO_WAH_SENSE, effectAmount.autoWah), 1);
      filter.frequency.setTargetAtTime(sweep(AUTO_WAH_RANGE, open), ctx.currentTime, 0.01);
    };
    const onSwitch = (on) => {
      clearInterval(timer);
      timer = on ? setInterval(follow, AUTO_WAH_EVERY) : null;
    };
    return { level: WAH_LEVEL, apply: () => {}, onSwitch };
  },
  wah(input, wet) {
    const wah = ctx.createBiquadFilter();
    wah.type = 'lowpass';
    wah.Q.value = WAH_Q;
    wah.frequency.value = sweep([WAH_LOW, WAH_HIGH], effectAmount.wah);
    input.connect(wah).connect(wet);
    return { level: WAH_LEVEL, apply: (amount, t) => wah.frequency.setTargetAtTime(sweep([WAH_LOW, WAH_HIGH], amount), t, SLIDE) };
  },
  fuzz: (input, wet) => ({ level: FUZZ_LEVEL, apply: driven(input, wet, 'fuzz', FUZZ_DRIVE, FUZZ_CURVE, FUZZ_TONE) }),
  overdrive: (input, wet) => ({ level: OVERDRIVE_LEVEL, apply: driven(input, wet, 'overdrive', OVERDRIVE_DRIVE, OVERDRIVE_CURVE, OVERDRIVE_TONE) }),
  distortion: (input, wet) => ({ level: DISTORTION_LEVEL, apply: driven(input, wet, 'distortion', DISTORTION_DRIVE, DISTORTION_CURVE, DISTORTION_TONE) }),
  tone(input, wet) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.value = sweep(TONE_RANGE, effectAmount.tone);
    input.connect(filter).connect(wet);
    return { apply: (amount, t) => filter.frequency.setTargetAtTime(sweep(TONE_RANGE, amount), t, SLIDE) };
  },
  chorus(input, wet) {
    const sway = swayed(input, wet, CHORUS_DELAY, CHORUS_RATE, lerp(CHORUS_DEPTH, effectAmount.chorus));
    return { level: 0.8, parallel: true, apply: (amount, t) => sway.depth.gain.setTargetAtTime(lerp(CHORUS_DEPTH, amount), t, SLIDE) };
  },
  // four all-pass filters swept together: summed with the dry signal, their phase shifts cut moving notches
  phaser(input, wet) {
    const sweepLfo = lfo(sweep(PHASER_RATE, effectAmount.phaser), PHASER_SWEEP);
    let node = input;
    for (let i = 0; i < 4; i++) {
      const pass = ctx.createBiquadFilter();
      pass.type = 'allpass';
      pass.frequency.value = PHASER_CENTRE;
      pass.Q.value = 0.7;
      sweepLfo.depth.connect(pass.frequency);
      node = node.connect(pass);
    }
    node.connect(wet);
    return { parallel: true, apply: (amount, t) => sweepLfo.osc.frequency.setTargetAtTime(sweep(PHASER_RATE, amount), t, SLIDE) };
  },
  flanger(input, wet) {
    const sway = swayed(input, wet, FLANGER_DELAY, FLANGER_RATE, lerp(FLANGER_DEPTH, effectAmount.flanger), FLANGER_FEEDBACK);
    return { level: 0.7, parallel: true, apply: (amount, t) => sway.depth.gain.setTargetAtTime(lerp(FLANGER_DEPTH, amount), t, SLIDE) };
  },
  vibrato(input, wet) {
    const sway = swayed(input, wet, VIBRATO_DELAY, VIBRATO_RATE, lerp(VIBRATO_DEPTH, effectAmount.vibrato));
    return { apply: (amount, t) => sway.depth.gain.setTargetAtTime(lerp(VIBRATO_DEPTH, amount), t, SLIDE) };
  },
  // a gain pulsing in time with the beat: swinging between 1 and 1 − depth
  tremolo(input, wet) {
    const pulseGain = ctx.createGain();
    const pulse = lfo(TREMOLO_PER_BEAT / grid.beat, 0);
    tremoloLfo = pulse.osc;
    pulse.depth.connect(pulseGain.gain);
    input.connect(pulseGain).connect(wet);
    const apply = (amount, t) => {
      pulseGain.gain.setTargetAtTime(1 - amount / 2, t, SLIDE);
      pulse.depth.gain.setTargetAtTime(amount / 2, t, SLIDE);
    };
    apply(effectAmount.tremolo, 0);
    return { apply };
  },
  // repeats once a beat, each quieter: the slider is how loud they come in
  echo(input, wet) {
    const send = ctx.createGain();
    send.gain.value = effectAmount.echo;
    echoDelay = ctx.createDelay(MAX_ECHO);
    echoDelay.delayTime.value = Math.min(grid.beat, MAX_ECHO);
    const feedback = ctx.createGain();
    feedback.gain.value = ECHO_FEEDBACK;
    input.connect(send).connect(echoDelay).connect(wet);
    echoDelay.connect(feedback).connect(echoDelay);
    return { parallel: true, apply: (amount, t) => send.gain.setTargetAtTime(amount, t, SLIDE) };
  },
  reverb(input, wet) {
    const send = ctx.createGain();
    send.gain.value = effectAmount.reverb;
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse(REVERB_SECONDS);
    input.connect(send).connect(convolver).connect(wet);
    return { parallel: true, apply: (amount, t) => send.gain.setTargetAtTime(amount, t, SLIDE) };
  },
};

/**
 * Builds effect `id`'s stage after `input`, and returns its output. A
 * switchable one runs its effect alongside a dry path, crossfaded by whether
 * it's in (or, for a parallel one, mixed in beside it); the volume is just a
 * gain.
 */
function buildStage(id, input) {
  const out = ctx.createGain();
  if (id === 'volume') {
    out.gain.value = VOLUME_TOP * effectAmount.volume ** 2;
    input.connect(out);
    stages.volume = { apply: (amount, t) => out.gain.setTargetAtTime(VOLUME_TOP * amount ** 2, t, SLIDE) };
    return out;
  }
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry).connect(out);
  wet.connect(out);
  const { level = 1, parallel = false, apply, onSwitch } = BUILDERS[id](input, wet);
  const on = effectOn[id];
  dry.gain.value = on && !parallel ? 0 : 1;
  wet.gain.value = on ? level : 0;
  stages[id] = { dry, wet, level, parallel, apply, onSwitch };
  onSwitch?.(on);
  return out;
}

/** Switches effect `id` (a switchable one from EFFECTS) in or out. */
export function setEffectOn(id, on) {
  effectOn[id] = on;
  const stage = stages[id];
  if (!stage) return;
  const t = ctx.currentTime;
  stage.dry.gain.setTargetAtTime(on && !stage.parallel ? 0 : 1, t, EFFECT_FADE);
  stage.wet.gain.setTargetAtTime(on ? stage.level : 0, t, EFFECT_FADE);
  stage.onSwitch?.(on);
}

/**
 * Sets effect `id`'s slider (0..1): the compressor's squeeze; the octave's
 * level; the auto-wah's sensitivity; the wah's pedal, heel to toe; the
 * drives; the tone's brightness; the chorus's, flanger's, vibrato's and
 * tremolo's depth; the phaser's speed; the volume; the echo's and reverb's mix.
 */
export function setEffectAmount(id, amount) {
  effectAmount[id] = amount;
  stages[id]?.apply(amount, ctx.currentTime);
}

/** The app's audio context, made on first use: for recording the microphone through it (see recorder.js). */
export const audioContext = () => context();

/** Browsers start audio suspended until a tap or key press: call from one. */
export function unlockAudio() {
  const c = context();
  if (c.state === 'suspended') c.resume().catch(() => {});
}

/**
 * Sets the beat grid: `beat` (a beat's length in seconds, which the echo
 * repeats at and the tremolo pulses with), `origin` (when a beat fell, in
 * performance.now() seconds) and `division` (steps per beat that notes are
 * quantized to; 0 for none). Any left out stay as they were.
 */
export function setBeatGrid({ origin, beat, division }) {
  if (origin != null) grid.origin = origin;
  if (division != null) grid.division = division;
  if (beat != null) {
    grid.beat = beat;
    if (!ctx) return;
    echoDelay.delayTime.setTargetAtTime(Math.min(beat, MAX_ECHO), ctx.currentTime, 0.05);
    tremoloLfo.frequency.setTargetAtTime(TREMOLO_PER_BEAT / beat, ctx.currentTime, 0.05);
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

function playSample(voice, sample, note, at, loudness = 1) {
  const c = context();
  const source = c.createBufferSource();
  source.buffer = sample.buffer;
  const rate = 2 ** ((note - (sample.note ?? 0)) / 12);
  source.playbackRate.value = rate * bendRatio(voice);
  const gain = c.createGain();
  gain.gain.value = sample.gain * loudness;
  source.connect(gain);
  gain.connect(bus);
  // with the octave in, the same sample at half the rate, an octave down
  let sub = null;
  if (effectOn.octave) {
    sub = c.createBufferSource();
    sub.buffer = sample.buffer;
    sub.playbackRate.value = (rate / 2) * bendRatio(voice);
    const subGain = c.createGain();
    subGain.gain.value = sample.gain * loudness;
    sub.connect(subGain).connect(octaveBus);
    sub.onended = () => {
      const i = sources.indexOf(sub);
      if (i >= 0) sources.splice(i, 1);
      subGain.disconnect();
    };
  }
  ringing.set(voice, { source, rate, sub });
  source.onended = () => {
    const i = sources.indexOf(source);
    if (i >= 0) sources.splice(i, 1);
    if (ringing.get(voice)?.source === source) ringing.delete(voice);
    gain.disconnect();
  };
  // `at`: when it should sound, in performance.now() seconds
  const when = c.currentTime + Math.max(0, at - performance.now() / 1000);
  for (const s of [source, sub]) {
    if (!s) continue;
    s.start(when);
    sources.push(s);
  }
  while (sources.length > MAX_SOURCES) sources.shift().stop();
}

/**
 * The voice's oscillator, and one an octave below for the octave, started
 * silent if it has none (one released has gone: see noteOff).
 */
function synthVoice(voice) {
  let v = synths.get(voice);
  if (!v) {
    const c = context();
    const osc = c.createOscillator();
    const gain = c.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(bus);
    osc.start();
    const sub = c.createOscillator();
    const subGain = c.createGain();
    subGain.gain.value = 0;
    sub.connect(subGain);
    subGain.connect(octaveBus);
    sub.start();
    v = { osc, gain, sub, subGain };
    synths.set(voice, v);
  }
  return v;
}

/**
 * `voice` touched `note` (or moved onto it), at `velocity` (0..1). A sample
 * sounds once and rings out; a synth sounds until noteOff. Quantized, either
 * waits for the next grid point.
 */
export function noteOn(voice, note, instrument, velocity = 1) {
  const c = context();
  const wait = quantizeDelay();
  const loudness = velocityGain(velocity);
  if (isSynth(instrument)) {
    const { type, level } = SYNTHS[instrument];
    const v = synthVoice(voice);
    const start = c.currentTime + wait;
    v.start = start;
    v.osc.type = v.sub.type = type;
    v.osc.frequency.setTargetAtTime(noteToFrequency(note), start, 0.005);
    v.sub.frequency.setTargetAtTime(noteToFrequency(note - 12), start, 0.005);
    for (const osc of [v.osc, v.sub]) osc.detune.setValueAtTime((bends.get(voice) ?? 0) * 100, start);
    v.gain.gain.setTargetAtTime(level * loudness, start, 0.01);
    v.subGain.gain.setTargetAtTime(effectOn.octave ? level * loudness : 0, start, 0.01);
    return;
  }
  const at = performance.now() / 1000 + wait;
  const sample = samples.get(instrument);
  sample?.then((s) => playSample(voice, s, note, at, loudness)).catch(() => {});
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
  for (const [osc, gain] of [
    [v.osc, v.gain],
    [v.sub, v.subGain],
  ]) {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setTargetAtTime(0, t, SYNTH_RELEASE);
    osc.stop(t + SYNTH_STOP);
    osc.onended = () => gain.disconnect();
  }
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
  sample?.sub?.playbackRate.setTargetAtTime((sample.rate / 2) * bendRatio(voice), t, 0.01);
  const v = synths.get(voice);
  for (const osc of v ? [v.osc, v.sub] : []) osc.detune.setTargetAtTime(semitones * 100, t, 0.01);
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
