// Notes, scales, tunings and note colours. A note is a number of semitones
// from middle C (C4 = 0), so standard guitar tuning is E2..E4 = -20..4.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const mod12 = (note) => ((note % 12) + 12) % 12;

export const noteName = (note) => NOTE_NAMES[mod12(Math.round(note))];

export const noteToFrequency = (note) => 440 * 2 ** ((note - 9) / 12);
export const frequencyToNote = (hz) => 12 * Math.log2(hz / 440) + 9;

/** Scales as semitones above the key. `chord` is the triad on the key, raised a little further. */
export const SCALES = [
  { id: 'majorPentatonic', name: 'Major Pentatonic', steps: [0, 2, 4, 7, 9], chord: [0, 4, 7] },
  { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11], chord: [0, 4, 7] },
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

/** Chord types: the triad, as semitones above the root. */
export const CHORD_TYPES = [
  { id: 'maj', name: 'Maj', steps: [0, 4, 7] },
  { id: 'min', name: 'Min', steps: [0, 3, 7] },
  { id: 'sus2', name: 'Sus2', steps: [0, 2, 7] },
  { id: 'sus4', name: 'Sus4', steps: [0, 5, 7] },
];

/** Notes added to the triad, as semitones above the root (an octave down for the 9th). */
export const CHORD_MODIFIERS = [
  { id: 'none', name: 'None', steps: [] },
  { id: 'dom7', name: 'Dom7', steps: [10] },
  { id: 'maj7', name: 'Maj7', steps: [11] },
  { id: 'six', name: '6', steps: [9] },
  { id: 'add9', name: 'Add9', steps: [2] },
];

const chordType = (id) => CHORD_TYPES.find((t) => t.id === id);
const chordModifier = (id) => CHORD_MODIFIERS.find((m) => m.id === id);

// what each modifier writes after the root, by chord type; a sus chord's "sus2" / "sus4" follows it
const MAJOR_SUFFIX = { none: '', dom7: '7', maj7: 'maj7', six: '6', add9: 'add9' };
const MINOR_SUFFIX = { none: 'm', dom7: 'm7', maj7: 'm(maj7)', six: 'm6', add9: 'm(add9)' };
const SUS_SUFFIX = { none: '', dom7: '7', maj7: 'maj7', six: '6', add9: '' };

/** A chord ({ root: 0..11, type, modifier }) as it's written: C, Am7, Gsus4, Fmaj7, D7sus4, Csus2(add9). */
export function chordName({ root, type, modifier }) {
  const name = NOTE_NAMES[root];
  if (type === 'maj') return name + MAJOR_SUFFIX[modifier];
  if (type === 'min') return name + MINOR_SUFFIX[modifier];
  return `${name}${SUS_SUFFIX[modifier]}${type}${modifier === 'add9' ? '(add9)' : ''}`;
}

/** The chord's notes as pitch classes (0..11, C = 0). */
export function chordPitchClasses({ root, type, modifier }) {
  return new Set([...chordType(type).steps, ...chordModifier(modifier).steps].map((step) => mod12(root + step)));
}

const NUMERALS = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];

/**
 * The chords on each degree of the key's scale: the first type whose notes
 * all lie in the scale (major or minor, else a sus chord), named by its
 * roman numeral, lower case for minor. Degrees with none (a major scale's
 * diminished vii) are left out. Each: { chord, label }.
 */
export function keyChords(key, scale) {
  return scale.steps.flatMap((step) => {
    const type = CHORD_TYPES.find((t) => t.steps.every((s) => scale.steps.includes(mod12(step + s))));
    if (!type) return [];
    const chord = { root: mod12(key + step), type: type.id, modifier: 'none' };
    const numeral = type.id === 'min' ? NUMERALS[step].toLowerCase() : NUMERALS[step];
    return [{ chord, label: `${numeral} ${chordName(chord)}` }];
  });
}

export const sameChord = (a, b) => a.root === b.root && a.type === b.type && a.modifier === b.modifier;

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
