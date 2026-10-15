// The music settings and progression, kept in a cookie so the page opens as
// it was left. The cookie belongs to the app's own folder, as GitHub Pages
// serves every project from one domain. Anything missing or unrecognised in
// it falls back to the default.

import { INSTRUMENTS } from './audio.js';
import { CHORD_MODIFIERS, CHORD_TYPES, SCALES, TUNINGS } from './music.js';
import { BEATS_PER_MEASURE, BPMS } from './menu.js';

const COOKIE = 'xr-music-settings';
const MAX_AGE = 60 * 60 * 24 * 365; // a year, renewed on every change
const VERSION = 1;

/** The defaults, as the page first opens. */
export const DEFAULT_SETTINGS = {
  instrument: INSTRUMENTS[0],
  scale: SCALES[0],
  key: 0, // C
  tuning: TUNINGS[0],
  echo: false,
  bpm: 100,
  beatsPerMeasure: 4,
  progression: [], // chords: { root, type, modifier }, see music.js
  draft: { root: 0, type: 'maj', modifier: 'none' }, // the chord Add adds
};

const cookiePath = () => new URL('.', window.location.href).pathname;

const isRoot = (n) => Number.isInteger(n) && n >= 0 && n < 12;
const isChord = (c) =>
  c && isRoot(c.root) && CHORD_TYPES.some((t) => t.id === c.type) && CHORD_MODIFIERS.some((m) => m.id === c.modifier);
// chords are stored as [root, type, modifier] to keep the cookie small
const packChord = (c) => [c.root, c.type, c.modifier];
const unpackChord = (a) => (Array.isArray(a) ? { root: a[0], type: a[1], modifier: a[2] } : null);

/** The saved settings over the defaults (DEFAULT_SETTINGS if there are none). */
export function loadSettings() {
  let saved;
  try {
    const raw = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    saved = raw && JSON.parse(decodeURIComponent(raw));
  } catch {
    saved = null;
  }
  if (!saved || saved.v !== VERSION) return DEFAULT_SETTINGS;
  const pick = (ok, value, fallback) => (ok ? value : fallback);
  const d = DEFAULT_SETTINGS;
  const draft = unpackChord(saved.draft);
  return {
    instrument: pick(INSTRUMENTS.includes(saved.instrument), saved.instrument, d.instrument),
    scale: SCALES.find((s) => s.id === saved.scale) ?? d.scale,
    key: pick(isRoot(saved.key), saved.key, d.key),
    tuning: TUNINGS.find((t) => t.id === saved.tuning) ?? d.tuning,
    echo: Boolean(saved.echo),
    bpm: pick(BPMS.includes(saved.bpm), saved.bpm, d.bpm),
    beatsPerMeasure: pick(BEATS_PER_MEASURE.includes(saved.beats), saved.beats, d.beatsPerMeasure),
    progression: Array.isArray(saved.progression) ? saved.progression.map(unpackChord).filter(isChord) : d.progression,
    draft: isChord(draft) ? draft : d.draft,
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
    echo: s.echo,
    bpm: s.bpm,
    beats: s.beatsPerMeasure,
    progression: s.progression.map(packChord),
    draft: packChord(s.draft),
  });
  try {
    document.cookie = `${COOKIE}=${encodeURIComponent(value)}; max-age=${MAX_AGE}; path=${cookiePath()}; SameSite=Lax`;
  } catch {
    // cookies blocked: the settings just won't survive a reload
  }
}
