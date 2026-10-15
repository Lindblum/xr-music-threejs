// Notes, scales, tunings and note colours. A note is a number of semitones
// from middle C (C4 = 0), so standard guitar tuning is E2..E4 = -20..4.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const mod12 = (note) => ((note % 12) + 12) % 12;

export const noteName = (note) => NOTE_NAMES[mod12(Math.round(note))];

export const noteToFrequency = (note) => 440 * 2 ** ((note - 9) / 12);
export const frequencyToNote = (hz) => 12 * Math.log2(hz / 440) + 9;

/** Scales as semitones above the key. `chord` is the triad on the key, raised a little further. */
export const SCALES = [
  { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11], chord: [0, 4, 7] },
  { id: 'majorPentatonic', name: 'Major Pentatonic', steps: [0, 2, 4, 7, 9], chord: [0, 4, 7] },
  { id: 'minorPentatonic', name: 'Minor Pentatonic', steps: [0, 3, 5, 7, 10], chord: [0, 3, 7] },
  { id: 'minor', name: 'Natural Minor', steps: [0, 2, 3, 5, 7, 8, 10], chord: [0, 3, 7] },
  { id: 'blues', name: 'Blues', steps: [0, 3, 5, 6, 7, 10], chord: [0, 3, 7] },
  { id: 'chromatic', name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], chord: [] },
];

/** Open strings, lowest first: the bottom row of the board. */
export const TUNINGS = [
  { id: 'guitar', name: 'Guitar EADGBE', strings: [-20, -15, -10, -5, -1, 4] },
  { id: 'dropD', name: 'Guitar Drop D', strings: [-22, -15, -10, -5, -1, 4] },
  { id: 'fourths', name: 'All Fourths', strings: [-20, -15, -10, -5, 0, 5] },
  { id: 'bass', name: 'Bass EADG', strings: [-32, -27, -22, -17] },
  { id: 'ukulele', name: 'Ukulele GCEA', strings: [7, 0, 4, 9] },
];

export const isInSteps = (note, key, steps) => steps.includes(mod12(Math.round(note) - key));

/**
 * Chord qualities: the chord's notes, as semitones above the root, and the
 * symbol a chord name writes after the root for each modifier. Fully
 * diminished (°) is the diminished triad, and its 7th is the diminished 7th
 * (`seventh`), so with 7 it's °7; half diminished (ø) has its flat 7th
 * already.
 */
export const CHORD_TYPES = [
  { id: 'maj', name: 'Maj', steps: [0, 4, 7], suffix: { none: '', dom7: '7', maj7: 'Δ7', six: '6', add9: 'add9' } },
  { id: 'min', name: 'Min', steps: [0, 3, 7], suffix: { none: 'm', dom7: 'm7', maj7: 'mΔ7', six: 'm6', add9: 'm(add9)' } },
  // a sus chord's "sus2" / "sus4" follows its modifier's symbol
  { id: 'sus2', name: 'Sus2', steps: [0, 2, 7], suffix: { none: 'sus2', dom7: '7sus2', maj7: 'Δ7sus2', six: '6sus2', add9: 'sus2(add9)' } },
  { id: 'sus4', name: 'Sus4', steps: [0, 5, 7], suffix: { none: 'sus4', dom7: '7sus4', maj7: 'Δ7sus4', six: '6sus4', add9: 'sus4(add9)' } },
  {
    id: 'dim',
    name: '°',
    steps: [0, 3, 6],
    seventh: 9,
    suffix: { none: '°', dom7: '°7', maj7: '°Δ7', six: '°7', add9: '°(add9)' },
  },
  {
    id: 'hdim',
    name: 'ø',
    steps: [0, 3, 6, 10],
    suffix: { none: 'ø7', dom7: 'ø7', maj7: 'ø7(Δ7)', six: 'ø7(6)', add9: 'ø9' },
  },
  { id: 'aug', name: '+', steps: [0, 4, 8], suffix: { none: '+', dom7: '+7', maj7: '+Δ7', six: '+6', add9: '+(add9)' } },
];

/** Notes added to the chord, as semitones above the root (an octave down for the 9th). */
export const CHORD_MODIFIERS = [
  { id: 'none', name: 'None', steps: [] },
  { id: 'dom7', name: '7', steps: [10] },
  { id: 'maj7', name: 'Δ7', steps: [11] },
  { id: 'six', name: '6', steps: [9] },
  { id: 'add9', name: 'add9', steps: [2] },
];

const chordType = (id) => CHORD_TYPES.find((t) => t.id === id);
const chordModifier = (id) => CHORD_MODIFIERS.find((m) => m.id === id);

/** A chord ({ root: 0..11, type, modifier }) as it's written: C, Am7, Gsus4, FΔ7, B°, Bø7, C°7, E+, D7sus4. */
export const chordName = ({ root, type, modifier }) => NOTE_NAMES[root] + chordType(type).suffix[modifier];

/** The chord's notes as pitch classes (0..11, C = 0). */
export function chordPitchClasses({ root, type, modifier }) {
  const quality = chordType(type);
  // a 7th on a fully diminished chord is the diminished 7th
  const added = modifier === 'dom7' && quality.seventh != null ? [quality.seventh] : chordModifier(modifier).steps;
  return new Set([...quality.steps, ...added].map((step) => mod12(root + step)));
}

const NUMERALS = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];

// how a degree's roman numeral shows its triad: lower case for minor and diminished, with ° or +
const numeralFor = (step, type) =>
  ({ min: NUMERALS[step].toLowerCase(), dim: `${NUMERALS[step].toLowerCase()}°`, aug: `${NUMERALS[step]}+` })[type] ?? NUMERALS[step];

// the order a degree's triad is looked for in: stacked thirds first, sus chords last
const TRIAD_SEARCH = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4'].map(chordType);

/**
 * The triad on each degree of the key's scale: the first quality whose notes
 * all lie in the scale (major, minor, diminished or augmented, else a sus
 * chord), named by its roman numeral: "ii: Dm", "vii°: B°". Degrees with none
 * are left out. Each: { step (semitones above the key), chord, label }.
 */
export function keyChords(key, scale) {
  return scale.steps.flatMap((step) => {
    const type = TRIAD_SEARCH.find((t) => t.steps.every((s) => scale.steps.includes(mod12(step + s))));
    if (!type) return [];
    const chord = { root: mod12(key + step), type: type.id, modifier: 'none' };
    return [{ step, chord, label: `${numeralFor(step, type.id)}: ${chordName(chord)}` }];
  });
}

/**
 * Stock progressions, as [semitones above the key, quality, modifier] per
 * chord (one chord a measure), and the scale each is in: the minor ones are
 * counted from the minor key's tonic.
 */
export const STOCK_PROGRESSIONS = [
  { id: 'doowop', name: 'Doo-wop', scale: 'major', chords: [[0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'maj']] },
  { id: 'axis', name: 'Pop Axis', scale: 'major', chords: [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']] },
  { id: 'sensitive', name: 'Sensitive', scale: 'major', chords: [[9, 'min'], [5, 'maj'], [0, 'maj'], [7, 'maj']] },
  {
    id: 'canon',
    name: "Pachelbel's Canon",
    scale: 'major',
    chords: [[0, 'maj'], [7, 'maj'], [9, 'min'], [4, 'min'], [5, 'maj'], [0, 'maj'], [5, 'maj'], [7, 'maj']],
  },
  {
    id: 'blues',
    name: '12-Bar Blues',
    scale: 'blues',
    chords: [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7].map((step) => [step, 'maj', 'dom7']),
  },
  { id: 'iiVI', name: 'Jazz ii–V–I', scale: 'major', chords: [[2, 'min', 'dom7'], [7, 'maj', 'dom7'], [0, 'maj', 'maj7'], [0, 'maj', 'maj7']] },
  { id: 'circle', name: 'Circle of Fifths', scale: 'major', chords: [[9, 'min', 'dom7'], [2, 'min', 'dom7'], [7, 'maj', 'dom7'], [0, 'maj', 'maj7']] },
  { id: 'royalRoad', name: 'Royal Road', scale: 'major', chords: [[5, 'maj', 'maj7'], [7, 'maj', 'dom7'], [4, 'min', 'dom7'], [9, 'min']] },
  { id: 'andalusian', name: 'Andalusian', scale: 'minor', chords: [[0, 'min'], [10, 'maj'], [8, 'maj'], [7, 'maj']] },
  { id: 'aeolian', name: 'Aeolian Vamp', scale: 'minor', chords: [[0, 'min'], [8, 'maj'], [10, 'maj'], [0, 'min']] },
  { id: 'mixolydian', name: 'Mixolydian Rock', scale: 'major', chords: [[0, 'maj'], [10, 'maj'], [5, 'maj'], [0, 'maj']] },
  { id: 'heyJoe', name: 'Hey Joe', scale: 'major', chords: [[8, 'maj'], [3, 'maj'], [10, 'maj'], [5, 'maj'], [0, 'maj']] },
  { id: 'louie', name: 'Louie Louie', scale: 'major', chords: [[0, 'maj'], [5, 'maj'], [7, 'min'], [5, 'maj']] },
];

/** A stock progression's chords in `key`. */
export const stockChords = (stock, key) =>
  stock.chords.map(([step, type, modifier = 'none']) => ({ root: mod12(key + step), type, modifier }));

/** The stock progression `progression` is in `key`, or null. */
export function matchingStock(progression, key) {
  return (
    STOCK_PROGRESSIONS.find((stock) => {
      const chords = stockChords(stock, key);
      return (
        chords.length === progression.length &&
        chords.every((c, i) => c.root === progression[i].root && c.type === progression[i].type && c.modifier === progression[i].modifier)
      );
    }) ?? null
  );
}

/** Alterations of a degree's root: semitones, and their symbols. */
export const ALTERATIONS = [
  { id: -1, name: '♭' },
  { id: 0, name: '♮' },
  { id: 1, name: '♯' },
];

/**
 * The chord being built ({ degree: semitones above the key, alteration: -1,
 * 0 or 1, type, modifier }) in `key`: its root is the degree's, flattened or
 * sharpened.
 */
export const builtChord = ({ degree, alteration, type, modifier }, key) => ({
  root: mod12(key + degree + alteration),
  type,
  modifier,
});

/**
 * The note's colour around the colour wheel, as the old page drew it:
 * bright for notes in the scale, dark for the rest. Returns [r, g, b] in 0..1 (sRGB).
 */
export function noteRgb(note, inScale) {
  const phase = (-2 * Math.PI * note) / 12;
  return [0, 2, 4].map((k) => {
    const c = (Math.cos(phase + Math.PI * (k / 3 + 1 / 6)) + 1) / 2;
    return inScale ? (1 + c) / 2 : c / 2;
  });
}

export function noteCss(note, inScale) {
  const [r, g, b] = noteRgb(note, inScale).map((c) => Math.round(c * 255));
  return `rgb(${r}, ${g}, ${b})`;
}
