// The music settings and progression, kept in a cookie so the page opens as
// it was left. The cookie belongs to the app's own folder, as GitHub Pages
// serves every project from one domain. Anything missing or unrecognised in
// it falls back to the default.

import { EFFECTS, INSTRUMENTS } from './audio.js';
import { ALTERATIONS, CHORD_MODIFIERS, CHORD_TYPES, SCALES, TUNINGS } from './music.js';
import { BACKGROUNDS, BEATS_PER_MEASURE, BPMS, PLAY_ON_SELECT, QUANTIZE, TEXT_SIZE, VIBRATION, snapToStep } from './menu.js';

const COOKIE = 'xr-music-settings';
const MAX_AGE = 60 * 60 * 24 * 365; // a year, renewed on every change
const VERSION = 1;

/** The defaults, as the page first opens. */
export const DEFAULT_SETTINGS = {
  instrument: 'Trombone',
  scale: SCALES[0], // Major
  key: 0, // C
  tuning: TUNINGS[0],
  quantize: 0, // off
  effects: Object.fromEntries(EFFECTS.filter((e) => e.toggle).map((e) => [e.id, false])), // the FilterFrame's effects switched in: see EFFECTS
  effectAmounts: Object.fromEntries(EFFECTS.map((e) => [e.id, e.amount])), // ...and where each one's slider is, 0..1
  background: 'skybox', // see BACKGROUNDS
  velocity: false, // notes as loud as they're struck hard
  playOnSelect: 'off', // what's played when a chord in the queue is selected or landed on: 'off' | 'root' | 'chord'
  bpm: 100,
  beatsPerMeasure: 4,
  progression: [], // chords: { root, type, modifier }, see music.js
  draft: { degree: 0, alteration: 0, type: 'maj', modifier: 'none' }, // the chord Add Chord adds
  textSize: TEXT_SIZE.default, // Accessibility: the panels' text and icons, a multiplier
  vibration: VIBRATION.default, // ...the controllers' haptics, 0 (off) to 2
  controllerGuide: false, // ...XR labels on the controllers' buttons
};

// the effects in the order their sliders were once saved, as a plain list
const LEGACY_EFFECTS = ['comp', 'octave', 'autoWah', 'wah', 'fuzz', 'overdrive', 'distortion', 'tone', 'chorus', 'phaser', 'flanger', 'vibrato', 'tremolo', 'volume', 'echo', 'reverb'];

const cookiePath = () => new URL('.', window.location.href).pathname;

/** `v` if it's a number on `range`'s scale (see menu.js), else null. */
const onScale = (v, range) => (typeof v === 'number' && v >= range.min && v <= range.max ? snapToStep(v, range) : null);
const isRoot = (n) => Number.isInteger(n) && n >= 0 && n < 12;
const isQuality = (c) => CHORD_TYPES.some((t) => t.id === c.type) && CHORD_MODIFIERS.some((m) => m.id === c.modifier);
const isChord = (c) => c && isRoot(c.root) && isQuality(c);
const isDraft = (d) => d && isRoot(d.degree) && ALTERATIONS.some((a) => a.id === d.alteration) && isQuality(d);
// chords are stored as [root, type, modifier], and the chord being built as [degree, alteration, type, modifier], to keep the cookie small
const packChord = (c) => [c.root, c.type, c.modifier];
const unpackChord = (a) => (Array.isArray(a) ? { root: a[0], type: a[1], modifier: a[2] } : null);
const packDraft = (d) => [d.degree, d.alteration, d.type, d.modifier];
const unpackDraft = (a) => (Array.isArray(a) ? { degree: a[0], alteration: a[1], type: a[2], modifier: a[3] } : null);

/** The saved settings over the defaults (DEFAULT_SETTINGS if there are none). */
export function loadSettings() {
  const saved = readCookie(COOKIE);
  if (!saved || saved.v !== VERSION) return DEFAULT_SETTINGS;
  const pick = (ok, value, fallback) => (ok ? value : fallback);
  const d = DEFAULT_SETTINGS;
  const draft = unpackDraft(saved.draft);
  return {
    instrument: pick(INSTRUMENTS.includes(saved.instrument), saved.instrument, d.instrument),
    scale: SCALES.find((s) => s.id === saved.scale) ?? d.scale,
    key: pick(isRoot(saved.key), saved.key, d.key),
    tuning: TUNINGS.find((t) => t.id === saved.tuning) ?? d.tuning,
    quantize: pick(QUANTIZE.some((q) => q.division === saved.quantize), saved.quantize, d.quantize),
    // kept by effect id, to two places (once as a list in the order of LEGACY_EFFECTS)
    effectAmounts: Object.fromEntries(
      EFFECTS.map((e) => {
        const amounts = saved.effectAmounts;
        const v = Array.isArray(amounts) ? amounts[LEGACY_EFFECTS.indexOf(e.id)] : amounts?.[e.id];
        return [e.id, typeof v === 'number' && v >= 0 && v <= 1 ? v : d.effectAmounts[e.id]];
      }),
    ),
    background: pick(BACKGROUNDS.includes(saved.background), saved.background, d.background),
    // kept as the ids of those switched in (the echo was once a setting of its own)
    effects: Object.fromEntries(
      Object.keys(d.effects).map((id) => [id, Array.isArray(saved.effects) ? saved.effects.includes(id) : id === 'echo' && Boolean(saved.echo)]),
    ),
    velocity: Boolean(saved.velocity),
    // (once a plain on / off: on was the whole chord)
    playOnSelect:
      saved.playOnSelect === true ? 'chord' : pick(PLAY_ON_SELECT.some((p) => p.id === saved.playOnSelect), saved.playOnSelect, d.playOnSelect),
    bpm: pick(BPMS.includes(saved.bpm), saved.bpm, d.bpm),
    beatsPerMeasure: pick(BEATS_PER_MEASURE.includes(saved.beats), saved.beats, d.beatsPerMeasure),
    progression: Array.isArray(saved.progression) ? saved.progression.map(unpackChord).filter(isChord) : d.progression,
    draft: isDraft(draft) ? draft : d.draft,
    textSize: onScale(saved.textSize, TEXT_SIZE) ?? d.textSize,
    vibration: onScale(saved.vibration, VIBRATION) ?? d.vibration,
    controllerGuide: Boolean(saved.controllerGuide),
  };
}

/** Saves the settings (the fields of DEFAULT_SETTINGS) to the cookie. */
export function saveSettings(s) {
  const value = JSON.stringify({
    v: VERSION,
    instrument: s.instrument,
    scale: s.scale.id,
    key: s.key,
    tuning: s.tuning.id,
    quantize: s.quantize,
    effects: EFFECTS.filter((e) => s.effects[e.id]).map((e) => e.id),
    effectAmounts: Object.fromEntries(EFFECTS.map((e) => [e.id, Math.round((s.effectAmounts[e.id] ?? e.amount) * 100) / 100])),
    background: s.background,
    playOnSelect: s.playOnSelect,
    velocity: s.velocity,
    bpm: s.bpm,
    beats: s.beatsPerMeasure,
    progression: s.progression.map(packChord),
    draft: packDraft(s.draft),
    textSize: s.textSize,
    vibration: s.vibration,
    controllerGuide: s.controllerGuide,
  });
  writeCookie(COOKIE, value);
}

const readCookie = (name) => {
  try {
    const raw = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    return raw && JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
};

// (a max-age of 0 deletes it)
const writeCookie = (name, value, maxAge = MAX_AGE) => {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=${cookiePath()}; SameSite=Lax`;
  } catch {
    // cookies blocked: they just won't survive a reload
  }
};

// The progressions saved by name, in the browser's own storage on this
// computer (they once filled a cookie: see loadSavedProgressions). GitHub Pages
// serves every project from one origin, which shares that storage, so the key
// names the app's folder, as the settings cookie's path does.
const PROGRESSIONS_COOKIE = 'xr-music-progressions'; // where they were kept before
const progressionsKey = () => `xr-music-progressions:${cookiePath()}`;

// each kept as [name, key, chords (packed)]; one saved before as [name, key, scale, bpm, beats, chords] keeps just those
const packSaved = (p) => [p.name, p.key, p.chords.map(packChord)];
function unpackSaved(a) {
  if (!Array.isArray(a) || typeof a[0] !== 'string' || !isRoot(a[1])) return null;
  const packed = Array.isArray(a[2]) ? a[2] : a[5];
  const chords = Array.isArray(packed) ? packed.map(unpackChord).filter(isChord) : [];
  return chords.length ? { name: a[0], key: a[1], chords } : null;
}

/**
 * The saved progressions, oldest first: each { name, key, chords }. Any still
 * in the old cookie move into storage, and the cookie goes.
 */
export function loadSavedProgressions() {
  let saved = null;
  try {
    const raw = localStorage.getItem(progressionsKey());
    saved = raw && JSON.parse(raw);
  } catch {
    saved = null; // storage blocked, or unreadable: as if there were none
  }
  if (!Array.isArray(saved)) {
    const old = readCookie(PROGRESSIONS_COOKIE);
    if (!Array.isArray(old)) return [];
    const list = old.map(unpackSaved).filter(Boolean);
    if (saveSavedProgressions(list)) writeCookie(PROGRESSIONS_COOKIE, '', 0);
    return list;
  }
  return saved.map(unpackSaved).filter(Boolean);
}

/** Saves the list of progressions; false, and nothing saved, if the browser's storage won't take it (blocked, or full). */
export function saveSavedProgressions(list) {
  try {
    localStorage.setItem(progressionsKey(), JSON.stringify(list.map(packSaved)));
    return true;
  } catch {
    return false;
  }
}
