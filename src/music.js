// Notes, scales, tunings and note colours. A note is a number of semitones
// from middle C (C4 = 0), so standard guitar tuning is E2..E4 = -20..4.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const mod12 = (note) => ((note % 12) + 12) % 12;

/** Quarter tones, named from the nearest natural: QUARTER_NAMES[n] is n + ½ (E↓ is E half-flat). */
export const QUARTER_NAMES = ['C↑', 'D↓', 'D↑', 'E↓', 'E↑', 'F↑', 'G↓', 'G↑', 'A↓', 'A↑', 'B↓', 'B↑'];

/** The note's name, to the nearest quarter tone. */
export function noteName(note) {
  const quarters = Math.round(2 * note);
  return quarters % 2 ? QUARTER_NAMES[mod12(Math.floor(quarters / 2))] : NOTE_NAMES[mod12(quarters / 2)];
}

export const noteToFrequency = (note) => 440 * 2 ** ((note - 9) / 12);
export const frequencyToNote = (hz) => 12 * Math.log2(hz / 440) + 9;

/**
 * Scales as semitones above the key. `chord` is the triad on the key, raised a
 * little further. A scale with a half step in it (3.5) is in 24-TET: see fretStep.
 */
export const SCALES = [
  { id: 'major', name: 'Diatonic Major', steps: [0, 2, 4, 5, 7, 9, 11], chord: [0, 4, 7] },
  { id: 'minor', name: 'Natural Minor', steps: [0, 2, 3, 5, 7, 8, 10], chord: [0, 3, 7] },	//Aeolian
  { id: 'dorian', name: 'Dorian Mode', steps: [0,2,3,5,7,9,10], chord: [0,3,7] },
  { id: 'phrygian', name: 'Phrygian Mode', steps: [0,1,3,5,7,8,10], chord: [0,3,7] },
  { id: 'lydian', name: 'Lydian Mode', steps: [0,2,4,6,7,9,11], chord: [0,4,7] },
  { id: 'mixolydian', name: 'Mixolydian Mode', steps: [0,2,4,5,7,9,10], chord: [0,4,7] },
  { id: 'locrian', name: 'Locrian Mode', steps: [0,1,3,5,6,8,10], chord: [0,3,6] },
  { id: 'majorPentatonic', name: 'Major Pentatonic', steps: [0, 2, 4, 7, 9], chord: [0, 4, 7] },
  { id: 'minorPentatonic', name: 'Minor Pentatonic', steps: [0, 3, 5, 7, 10], chord: [0, 3, 7] },
  { id: 'chromatic', name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], chord: [0,4,7] },
  { id: 'blues', name: 'Blues', steps: [0, 3, 5, 6, 7, 10], chord: [0, 3, 7] },
  { id: 'harmonicMajor', name: 'Harmonic Major', steps: [0,2,4,5,7,8,11], chord: [0,4,7] },
  { id: 'harmonicMinor', name: 'Harmonic Minor', steps: [0,2,3,5,7,8,11], chord: [0,3,7] },
  { id: 'wholeTone', name: 'Whole Tone', steps: [0,2,4,6,8,10], chord: [0,4,6] },
  { id: 'alteredDominant', name: 'Altered Dominant', steps: [0,1,3,4,6,8,10], chord: [0,3,6] },
  { id: 'augmented', name: 'Augmented', steps: [0,3,4,7,8,11], chord: [0,4,0] },
  { id: 'tritone', name: 'Tritone', steps: [0,1,4,6,7,10], chord: [0,4,7] },
  { id: 'persian', name: 'Persian', steps: [0,1,4,5,6,8,11], chord: [0,4,6] },
  { id: 'doubleHarmonicMajor', name: 'Double Harmonic Major', steps: [0,1,4,5,7,8,11], chord: [0,4,7] },	//Arabic Maqam Hijaz Kar,Gypsy major,Byzantine-
  { id: 'doubleHarmonicMinor', name: 'Double Harmonic Minor', steps: [0,2,3,6,7,8,11], chord: [0,3,7] },	//Hungarian Minor
  { id: 'gypsy', name: 'Gypsy', steps: [0,2,3,6,7,8,10], chord: [0,3,7] },
  { id: 'acoustic', name: 'Acoustic', steps: [0,2,4,6,7,9,10], chord: [0,3,7] },	//Lydian Dominant
  { id: 'phrygianDominant', name: 'Phrygian Dominant', steps: [0,1,4,5,7,8,10], chord: [0,4,7] },	//Spanish Gypsy
  { id: 'majorLocrian', name: 'Major Locrian', steps: [0,2,4,5,6,8,10], chord: [0,4,6] },
  { id: 'neapolitanMajor', name: 'Neapolitan Major', steps: [0,1,3,5,7,9,11], chord: [0,3,7] },
  { id: 'neapolitanMinor', name: 'Neapolitan Minor', steps: [0,1,3,5,7,8,11], chord: [0,3,7] },
  { id: 'bluesHeptatonic', name: 'Blues Heptatonic', steps: [0,3,5,6,7,10], chord: [] },
  { id: 'halfDiminished', name: 'Half Diminished', steps: [0,2,3,5,6,8,10], chord: [] },
  
  { id: 'in', name: 'In', steps: [0,1,4,7,8], chord: [0,4,7] },
  { id: 'insen', name: 'Insen', steps: [0,1,4,7,10], chord: [0,4,7] },
  { id: 'iwato', name: 'Iwato', steps: [0,1,5,6,10], chord: [0,5,6] },
  { id: 'hirajoshi', name: 'Hirajoshi', steps: [0,2,3,7,8], chord: [0,3,7] },
  { id: 'yo', name: 'Yo', steps: [0,3,5,7,11], chord: [0,3,7] },
  
  { id: 'maqamSaba', name: 'Maqam Saba', steps: [0,1.5,3,4,7,8,10], chord: [] },
  { id: 'maqamSabaZamzam', name: 'Maqam Saba Zamzam', steps: [0,1,3,4,7,8,10], chord: [] },
  { id: 'maqamHijazKar', name: 'Maqam Hijaz Kar', steps: [0,1,4,5,7,8,11], chord: [] },
  { id: 'maqamHijazNahawand', name: 'Maqam Hijaz Nahawand', steps: [0,1,4,5,7,8,10], chord: [] },
  { id: 'maqamHijazRast', name: 'Maqam Hijaz Rast', steps: [0,1,4,5,7,8.5,10], chord: [] },
  { id: 'maqamHijazZanjaran', name: 'Maqam Hijaz Zanjaran', steps: [0,1,4,5,7,9,10], chord: [] },
  { id: 'maqamKurd', name: 'Maqam Kurd', steps: [0,1,3,5,7,8,10], chord: [] },
  { id: 'maqamBayati', name: 'Maqam Bayati', steps: [0,1.5,3,5,7,8,10], chord: [] },
  { id: 'maqamBayatiHusseini', name: 'Maqam Bayati Husseini', steps: [0,1.5,3,5,7,8.5,10], chord: [] },
  { id: 'maqamBayatiShuri', name: 'Maqam Bayati Shuri', steps: [0,1.5,3,5,6,9,10], chord: [] },
  { id: 'maqamSikah', name: 'Maqam Sikah', steps: [0,1.5,3.5,5.5,6.5,8.5,10.5], chord: [] },
  { id: 'maqamSikahHuzam', name: 'Maqam Sikah Huzam', steps: [0,1.5,3.5,4.5,7.5,8.5,10.5], chord: [] },
  { id: 'maqamSikahBaladi', name: 'Maqam Sikah Baladi', steps: [0,1.5,3.5,5,7,8.5,10.5], chord: [] },
  { id: 'maqamSikahBastanikar', name: 'Maqam Sikah Bastanikar', steps: [0,1.5,3.5,5,6.5,7.5,10.5], chord: [] },
  { id: 'maqamSikahIraq', name: 'Maqam Sikah Iraq', steps: [0,1.5,3.5,5,6.5,8.5,10.5], chord: [] },
  { id: 'maqamSikahMustaar', name: 'Maqam Sikah Mustaar', steps: [0,2.5,3.5,5.5,6.5,8.5,10.5], chord: [] },
  { id: 'maqamNawaAthar', name: 'Maqam Nawa Athar', steps: [0,2,3,6,7,8,11], chord: [] },
  { id: 'maqamNahawand', name: 'Maqam Nahawand', steps: [0,2,3,5,7,8,11], chord: [] },
  { id: 'maqamNahawandFarahfaza', name: 'Maqam Nahawand Farahfaza', steps: [0,2,3,5,7,8,10], chord: [] },
  { id: 'maqamNahawandNikriz', name: 'Maqam Nahawand Nikriz', steps: [0,2,3,6,7,9,10], chord: [] },
  { id: 'maqamNahawandMurassah', name: 'Maqam Nahawand Murassah', steps: [0,2,3,5,6,9,10], chord: [] },
  { id: 'maqamNahawandUshaqMasri', name: 'Maqam Nahawand Ushaq Masri', steps: [0,2,3,5,7,8.5,10], chord: [] },
  { id: 'maqamRast', name: 'Maqam Rast', steps: [0,2,3.5,5,7,9,10.5], chord: [] },
  { id: 'maqamRast Suznak', name: 'Maqam Rast Suznak', steps: [0,2,3.5,5,7,8,11], chord: [] },
  { id: 'maqamRast Nairuz', name: 'Maqam Rast Nairuz', steps: [0,2,3.5,5,7,8.5,10], chord: [] },
  { id: 'maqamRast Nahawand', name: 'Maqam Rast Nahawand', steps: [0,2,3.5,5,7,9,10], chord: [] },
  { id: 'maqamRast Mahur', name: 'Maqam Rast Mahur', steps: [0,2,3.5,5,7,9,11], chord: [] },
  { id: 'maqamAjam', name: 'Maqam Ajam', steps: [0,2,4,5,7,8,11], chord: [] },
  { id: 'maqamAjamJiharkah', name: 'Maqam Ajam Jiharkah', steps: [0,2,4,5,7,9,10.5], chord: [] },
];

/** Open strings, lowest first: the bottom row of the board. */
export const TUNINGS = [
  { id: 'guitar', name: 'Guitar EADGBE', strings: [-20, -15, -10, -5, -1, 4] },
  { id: 'thirds', name: 'Thirds EG#CEG#C', strings: [-20, -16, -12, -8, -4, 0] },
  { id: 'fourths', name: 'Fourths EADGCF', strings: [-20, -15, -10, -5, 0, 5] },
  { id: 'fifths', name: 'Fifths CGDAEB', strings: [-24, -17, -10, -3, 4, 11] },
  { id: 'dropC', name: 'Drop C CGCFAD', strings: [-24, -17, -12, -7, -3, 2] },
  { id: 'dropD', name: 'Drop D DADGBE', strings: [-22, -15, -10, -5, -1, 4] },

  { id: 'openA', name: 'Open A EAC#EAE', strings: [-20, -15, -11, -8, -3, 4] },
  { id: 'openB', name: 'Open B BF#BF#BD#', strings: [-25, -18, -13, -6, -1, 3] },
  { id: 'openC', name: 'Open C CGCGCE', strings: [-24, -17, -12, -5, 0, 4] },
  { id: 'openD', name: 'Open D DADF#AD', strings: [-22, -15, -10, -6, -3, 2] },
  { id: 'openE', name: 'Open E EBEG#BE', strings: [-20, -13, -8, -4, -1, 4] },
  { id: 'openF', name: 'Open F CFCFAF', strings: [-24, -19, -12, -7, -3, 5] },
  { id: 'openG', name: 'Open G DGDGBD', strings: [-22, -17, -10, -5, -1, 2] },
  { id: 'celtic', name: 'Celtic DADGAD', strings: [-22, -15, -10, -5, -3, 2] },
  { id: 'sevenString', name: '7-String BEADGBE', strings: [-25, -20, -15, -10, -5, -1, 4] },
  { id: 'eightStringTritone', name: '8-String Tritone CF#CF#CF#CF#', strings: [-24,-18,-12,-6,0,6,12,18] },
  { id: 'eightStringFifthsFourths', name: '8-String Fifths-Fourths CGCGCGCG', strings: [-24,-17,-12,-5,0,7,12,19] },
  { id: 'bass', name: 'Bass EADG', strings: [-32, -27, -22, -17] },
  { id: 'ukulele', name: 'Ukulele GCEA', strings: [7, 0, 4, 9] },
  { id: 'mandolin', name: 'Mandolin GDAE', strings: [-5, 2, 9, 16] },
  { id: 'fripp', name: 'Robert Fripp CGDAEG', strings: [-24, -17, -10, -3, 4, 7] }, // Robert Fripp's New Standard Tuning
  { id: 'drake', name: 'Nick Drake CGCFCE', strings: [-24, -17, -12, -7, 0, 4] },
];

/** Whether the scale has quarter tones, so the board is laid out in 24-TET. */
export const isMicrotonal = (scale) => scale.steps.some((step) => !Number.isInteger(step));

/** Semitones from one fret to the next: a quarter tone for a microtonal scale. */
export const fretStep = (scale) => (isMicrotonal(scale) ? 0.5 : 1);

/** Whether the note, to the nearest quarter tone, is one of `steps` above the key. */
export const isInSteps = (note, key, steps) => steps.includes(mod12(Math.round(2 * note) / 2 - key));

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

const CHORD_BASE = -12; // C3: a chord's root is voiced in the octave from here

/** The chord voiced as notes (semitones from C4), low to high: the root from C3, its tones above, add9 as a 9th. */
export function chordNotes({ root, type, modifier }) {
  const quality = chordType(type);
  const added = modifier === 'dom7' && quality.seventh != null ? [quality.seventh] : chordModifier(modifier).steps;
  const steps = [...quality.steps, ...added.map((step) => (modifier === 'add9' ? step + 12 : step))];
  return [...new Set(steps)].sort((a, b) => a - b).map((step) => CHORD_BASE + root + step);
}

const NUMERALS =['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];

// how a degree's roman numeral shows its triad: lower case for minor and diminished, with ° or +
const numeralFor = (step, type) =>
  ({ min: NUMERALS[step].toLowerCase(), dim: `${NUMERALS[step].toLowerCase()}°`, aug: `${NUMERALS[step]}+` })[type] ?? NUMERALS[step];

// the order a degree's triad is looked for in: stacked thirds first, sus chords last
const TRIAD_SEARCH = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4'].map(chordType);

/**
 * The triad on each degree of the key's scale: the first quality whose notes
 * all lie in the scale (major, minor, diminished or augmented, else a sus
 * chord), named by its roman numeral: "ii: Dm", "vii°: B°". Degrees with none
 * are left out, as are quarter-tone degrees, the chords being 12-TET. Each:
 * { step (semitones above the key), chord, label }.
 */
export function keyChords(key, scale) {
  return scale.steps.filter(Number.isInteger).flatMap((step) => {
    const type = TRIAD_SEARCH.find((t) => t.steps.every((s) => scale.steps.includes(mod12(step + s))));
    if (!type) return [];
    const chord = { root: mod12(key + step), type: type.id, modifier: 'none' };
    return [{ step, chord, label: `${numeralFor(step, type.id)}: ${chordName(chord)}` }];
  });
}

/**
 * The 7th chord on a degree's triad ({ step, chord } from keyChords) whose
 * 7th lies in the scale: a major 7th first, then a flat 7th (a diminished
 * triad's flat 7th makes it half diminished), then a diminished triad's
 * diminished 7th. Null if the scale has none of them.
 */
function seventhChord(step, chord, scale) {
  const has = (interval) => scale.steps.includes(mod12(step + interval));
  if (chord.type === 'dim') {
    if (has(10)) return { ...chord, type: 'hdim' };
    if (has(9)) return { ...chord, modifier: 'dom7' };
    return null;
  }
  if (has(11)) return { ...chord, modifier: 'maj7' };
  if (has(10)) return { ...chord, modifier: 'dom7' };
  return null;
}

/**
 * The chord chart for the key: each degree's triad (see keyChords) and its
 * 7th in the scale, or null where there is none. Each: { step, triad, seventh }.
 */
export const keyChordChart = (key, scale) =>
  keyChords(key, scale).map(({ step, chord }) => ({ step, triad: chord, seventh: seventhChord(step, chord, scale) }));

/** Whether two chords are the same chord. */
export const sameChord = (a, b) => Boolean(a && b && a.root === b.root && a.type === b.type && a.modifier === b.modifier);

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
  // half a bar each, then two bars on I, in the song: doubled here to whole measures, so the same shape at half speed
  {
    id: 'heyJoe',
    name: 'Hey Joe',
    scale: 'major',
    chords: [[8, 'maj'], [3, 'maj'], [10, 'maj'], [5, 'maj'], [0, 'maj'], [0, 'maj'], [0, 'maj'], [0, 'maj']],
  },
  { id: 'louie', name: 'Louie Louie', scale: 'major', chords: [[0, 'maj'], [5, 'maj'], [7, 'min'], [5, 'maj']] },
  { id: 'laBamba', name: 'La Bamba', scale: 'major', chords: [[0, 'maj'], [5, 'maj'], [7, 'maj'], [5, 'maj']] },
  // I–vi–ii–V, the turnaround at the heart of Rhythm Changes
  { id: 'turnaround', name: 'Turnaround', scale: 'major', chords: [[0, 'maj', 'maj7'], [9, 'min', 'dom7'], [2, 'min', 'dom7'], [7, 'maj', 'dom7']] },
  // dominant 7ths round the circle of fifths home, as in "Salty Dog"
  {
    id: 'ragtime',
    name: 'Ragtime',
    scale: 'major',
    chords: [[4, 'maj', 'dom7'], [9, 'maj', 'dom7'], [2, 'maj', 'dom7'], [7, 'maj', 'dom7'], [0, 'maj'], [0, 'maj']],
  },
  // I–III–IV–iv: a major III and a borrowed minor iv
  { id: 'creep', name: 'Creep', scale: 'major', chords: [[0, 'maj'], [4, 'maj'], [5, 'maj'], [5, 'min']] },
  { id: 'rockFlat7', name: '♭VII–IV–I', scale: 'major', chords: [[10, 'maj'], [5, 'maj'], [0, 'maj'], [0, 'maj']] },
  {
    id: 'eightBar',
    name: '8-Bar Blues',
    scale: 'blues',
    chords: [0, 7, 5, 5, 0, 7, 0, 7].map((step) => [step, 'maj', 'dom7']),
  },
  {
    id: 'minorBlues',
    name: 'Minor Blues',
    scale: 'blues',
    chords: [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 0].map((step) => [step, step === 7 ? 'maj' : 'min', 'dom7']),
  },
  { id: 'minorIIVI', name: 'Minor ii–V–i', scale: 'minor', chords: [[2, 'hdim'], [7, 'maj', 'dom7'], [0, 'min', 'dom7'], [0, 'min', 'dom7']] },
  // i–VI–III–VII
  { id: 'epicMinor', name: 'Epic Minor', scale: 'minor', chords: [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']] },
  // i7–IV7, a minor chord and the major IV of the Dorian mode, as in "Oye Como Va"
  { id: 'dorian', name: 'Dorian Vamp', scale: 'minor', chords: [[0, 'min', 'dom7'], [5, 'maj', 'dom7']] },
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
