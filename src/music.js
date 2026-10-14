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
