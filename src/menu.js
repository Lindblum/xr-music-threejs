// Options menu model shared by the windowed panel (DOM) and the XR panel
// (drawn on a canvas): one page of buttons, each "Name: Value", in sections
// (Analyze, Music, Video) that open and close in place, like dropdowns. A button
// cycles its setting or opens a dropdown list of choices beneath it (a
// chevron on its right). Buttons can share a row, and a run of them can sit
// in a framed group (see menuBlocks).

import { INSTRUMENTS, isSynth } from './audio.js';
import {
  ALTERATIONS,
  CHORD_MODIFIERS,
  CHORD_TYPES,
  NOTE_NAMES,
  SCALES,
  STOCK_PROGRESSIONS,
  TUNINGS,
  builtChord,
  chordName,
  keyChords,
  matchingStock,
  noteCss,
  sameChord,
  stockChords,
} from './music.js';

export const MENU_TITLE = 'Fretboard XR';

/** Options → Background, in list order (passthrough last). */
export const BACKGROUNDS = ['solid', 'skybox', 'passthrough'];
const BACKGROUND_LABELS = { solid: 'Solid', skybox: 'Skybox', passthrough: 'Passthrough (XR Only)' };

/** The Vite + React starter's page colour, used for the Solid background, as in the 4D viewer. */
export const SOLID_BACKGROUND = '#242424';

/** Why this device can't show background `b` (see menuItems' `env`), or null if it can: passthrough needs AR or a camera. */
const backgroundUnavailable = (b, env) =>
  b === 'passthrough' && !env.passthroughAvailable ? 'Passthrough needs an AR-capable headset or a phone camera' : null;

/**
 * View Mode, in list order. Normal, 3D: SBS (half side-by-side, for 3D
 * TVs and projectors) and 3D: Interlaced (alternate rows, for passive 3D
 * monitors) are windowed. The rest are XR: XR: Headset on headsets; on
 * phones, XR: Phone AR (one view) and XR: Phone Viewer (two lens-corrected
 * eyes for a phone viewer), as in the 4D viewer.
 */
export const VIEWS = ['normal', 'sbs', 'interlaced', 'xr', 'phoneAR', 'phoneViewer'];
export const XR_VIEWS = ['xr', 'phoneAR', 'phoneViewer'];
const VIEW_LABELS = {
  normal: 'Normal',
  sbs: '3D: SBS',
  interlaced: '3D: Interlaced',
  xr: 'XR: Headset',
  phoneAR: 'XR: Phone AR',
  phoneViewer: 'XR: Phone Viewer',
};
const VIEW_ICONS = {
  normal: 'monitor',
  sbs: 'monitorSbs',
  interlaced: 'monitorInterlaced',
  xr: 'vr',
  phoneAR: 'phone',
  phoneViewer: 'phoneViewer',
};
const STEREO_VIEWS = ['sbs', 'interlaced'];

/**
 * Why this device can't show `view`, or null if it can. `env`: { phone,
 * headset, xrSupported, checking }. A headset browser's own window can't show
 * screen stereo usefully, so no SBS or Interlaced there. Phones always get
 * their XR views: without WebXR AR they fall back to the motion sensors.
 */
function viewUnavailable(view, env) {
  if (STEREO_VIEWS.includes(view)) return env.headset ? "Not in a headset's own browser" : null;
  if (view === 'xr') {
    if (env.phone) return 'On a phone, use XR: Phone AR or XR: Phone Viewer';
    if (env.xrSupported) return null;
    return env.checking ? 'Checking for WebXR…' : "WebXR isn't available here. Open the page in a headset browser over HTTPS for XR.";
  }
  if (view === 'phoneAR' || view === 'phoneViewer') return env.phone ? null : 'Phones only';
  return null;
}

/** The item after `current` in `list`, wrapping around; `step` -1 goes back. */
export const cycle = (list, current, step = 1) => list[(list.indexOf(current) + step + list.length) % list.length];

/**
 * A label's setting name and its value, split at the first ": ". The panels
 * draw the name on the left and the value against the right edge.
 */
export function splitLabel(label) {
  const at = label.indexOf(': ');
  return at < 0 ? { name: label, value: '' } : { name: label.slice(0, at), value: label.slice(at + 2) };
}

/** A section's header: its button's id is this and the section's. */
export const SECTION_PREFIX = 'section:';

export const PICK_PREFIX = 'pick:';

/**
 * A dropdown: the button shows the current choice, and when it is the open
 * one (`state.dropdown`), lists every choice beneath it, `columns` to a row,
 * each with `icons[i]` if given. Choosing one sends "pick:<id>:<index>".
 * Packed more than CHECKED_COLUMNS to a row (or with `checks` false), the
 * chosen one is shown by its highlight alone, without a check mark, to leave
 * its label room. `unavailable[i]`, if given, is why choice i can't be chosen
 * here: it's shown disabled, with that as its tooltip.
 */
const CHECKED_COLUMNS = 4;

function dropdown(state, id, choices, current, icons, columns = 2, checks = columns <= CHECKED_COLUMNS, unavailable = []) {
  return {
    open: state.dropdown === id,
    columns,
    checks,
    options: choices.map((label, i) => ({
      id: `${PICK_PREFIX}${id}:${i}`,
      label,
      icon: icons?.[i],
      selected: i === current,
      disabled: Boolean(unavailable[i]),
      title: unavailable[i] || undefined,
    })),
  };
}

/** An instrument's icon: its wave for a synth, a recorded clip for a sample. */
export const instrumentIcon = (instrument) => (isSynth(instrument) ? instrument.toLowerCase() : 'sample');

/** Progression → Beats per Minute and Beats per Measure choices. */
export const BPMS = Array.from({ length: 21 }, (_, i) => 40 + i * 10); // 40..240
export const BEATS_PER_MEASURE = [2, 3, 4, 5, 6, 7];

/** Instrument → Quantize: steps a beat is divided into, for timing notes (0: off). */
export const QUANTIZE = [
  { division: 0, name: 'Off' },
  { division: 1, name: 'Beat' },
  { division: 2, name: '½ Beat' },
  { division: 4, name: '¼ Beat' },
];

/** Progression → Play on Select: what's played when a chord is selected, or landed on. */
export const PLAY_ON_SELECT = [
  { id: 'off', name: 'Off' },
  { id: 'root', name: 'Chord Root' },
  { id: 'chord', name: 'Chord' },
];

/** A chord in the progression's queue: its button's id is this and its index. */
export const CHORD_PREFIX = 'chord-';

/** The dropdowns' ids. */
export const DROPDOWNS = ['instrument', 'quantize', 'playOnSelect', 'scale', 'key', 'tuning', 'bpm', 'beats', 'stock', 'load', 'degree', 'alteration', 'quality', 'modifier', 'background', 'view'];

/**
 * The choices behind each dropdown on this device, in list order. App
 * applies a pick ("pick:<id>:<index>") by its index into these.
 */
export function dropdownChoices(env, state) {
  return {
    instrument: INSTRUMENTS,
    quantize: QUANTIZE.map((q) => q.division),
    playOnSelect: PLAY_ON_SELECT.map((p) => p.id),
    scale: SCALES,
    key: NOTE_NAMES.map((_, i) => i),
    tuning: TUNINGS,
    bpm: BPMS,
    beats: BEATS_PER_MEASURE,
    stock: STOCK_PROGRESSIONS,
    load: state.savedProgressions ?? [],
    degree: keyChords(state.key, state.scale),
    alteration: ALTERATIONS.map((a) => a.id),
    quality: CHORD_TYPES.map((t) => t.id),
    modifier: CHORD_MODIFIERS.map((m) => m.id),
    // every one, in list order; null where this device can't have it
    background: BACKGROUNDS.map((b) => (backgroundUnavailable(b, env) ? null : b)),
    view: VIEWS.map((v) => (viewUnavailable(v, env) ? null : v)),
  };
}

/** The Music section's first part: the sound (a synth or a sample), quantizing and velocity sensitivity side by side, and the board's tuning. The effects, the echo among them, are on the FilterFrame. */
function instrumentItems(state) {
  return [
    {
      id: 'instrument',
      label: `Sample: ${state.instrument}`,
      icon: instrumentIcon(state.instrument),
      title: 'Shortcut: I',
      // four to a row, each with its icon: no room for a check mark too
      dropdown: dropdown(state, 'instrument', INSTRUMENTS, INSTRUMENTS.indexOf(state.instrument), INSTRUMENTS.map(instrumentIcon), 4, false),
    },
    {
      id: 'quantize',
      label: `Quantize: ${QUANTIZE.find((q) => q.division === state.quantize).name}`,
      icon: 'beats',
      title: 'Holds each note back to the next beat, or part of one',
      row: 'timing',
      small: true,
      dropdown: dropdown(
        state,
        'quantize',
        QUANTIZE.map((q) => q.name),
        QUANTIZE.findIndex((q) => q.division === state.quantize),
        undefined,
        QUANTIZE.length,
      ),
    },
    {
      id: 'velocity',
      label: `Velocity Sensitivity: ${state.velocity ? 'On' : 'Off'}`,
      icon: 'velocity',
      title: 'Notes are as loud as the controller, pick or mouse is fast as it strikes them',
      row: 'timing',
      small: true,
    },
    {
      id: 'tuning',
      label: `Tuning: ${state.tuning.name}`,
      icon: 'tuning',
      title: 'Shortcut: T',
      dropdown: dropdown(state, 'tuning', TUNINGS.map((t) => t.name), TUNINGS.indexOf(state.tuning)),
    },
  ];
}

/** Play / Pause, with where the progression is: "Pause: 2/4 · Beat 3". */
function playLabel(state) {
  const { playing, started, index, beat } = state.player;
  const verb = playing ? 'Pause' : 'Play';
  return started && index != null ? `${verb}: ${index + 1}/${state.progression.length} · Beat ${beat + 1}` : verb;
}

/** Chords in the progression's queue, to a row. */
export const QUEUE_COLUMNS = 4;

/**
 * The Music section's second part, the progression: the transport, Play on
 * Select, the tempo, a stock progression to start from with Clear beside it,
 * the key and scale, then the Chord section, the chord being built (a
 * degree's triad and its root's alteration on one row, its quality and
 * modifier on the next, then Add Chord), then the queue: the progression's
 * chords, four to a row in a framed group. A queued chord (`queueIndex`) is dragged to reorder
 * it, and dragged out of the panel or double-clicked to remove it (see the
 * panels). The playing (or paused) chord is lit.
 */
function progressionItems(state) {
  const { draft, progression, player } = state;
  const degrees = keyChords(state.key, state.scale);
  const degree = degrees.findIndex((d) => d.step === draft.degree);
  const alteration = ALTERATIONS.findIndex((a) => a.id === draft.alteration);
  const quality = CHORD_TYPES.findIndex((t) => t.id === draft.type);
  const modifier = CHORD_MODIFIERS.findIndex((m) => m.id === draft.modifier);
  const queue = { group: 'queue', compact: true, cols: QUEUE_COLUMNS };
  const chordOpen = Boolean(state.sections?.chord);
  const root = { row: 'root', small: true };
  const shape = { row: 'shape', small: true };
  const transport = { row: 'transport', small: true };
  const tempo = { row: 'tempo', small: true };
  const keyScale = { row: 'keyScale', small: true };
  const stock = STOCK_PROGRESSIONS.indexOf(matchingStock(progression, state.key));
  return [
    {
      id: 'play',
      label: playLabel(state),
      icon: player.playing ? 'pause' : 'play',
      title: 'Shortcut: P',
      disabled: !progression.length,
      ...transport,
    },
    { id: 'stop', label: 'Stop', icon: 'stop', disabled: !player.started, ...transport },
    // what's played as a chord is selected or landed on
    {
      id: 'playOnSelect',
      label: `Play on Select: ${PLAY_ON_SELECT.find((p) => p.id === state.playOnSelect).name}`,
      dropdown: dropdown(
        state,
        'playOnSelect',
        PLAY_ON_SELECT.map((p) => p.name),
        PLAY_ON_SELECT.findIndex((p) => p.id === state.playOnSelect),
        undefined,
        PLAY_ON_SELECT.length,
      ),
      title: 'Plays a chord (or just its root) when you click or trigger it in the queue, and as the progression lands on it',
    },
    {
      id: 'bpm',
      label: `Beats per Minute: ${state.bpm}`,
      icon: 'tempo',
      ...tempo,
      dropdown: dropdown(state, 'bpm', BPMS.map(String), BPMS.indexOf(state.bpm)),
    },
    {
      id: 'beats',
      label: `Beats per Measure: ${state.beatsPerMeasure}`,
      icon: 'beats',
      ...tempo,
      dropdown: dropdown(state, 'beats', BEATS_PER_MEASURE.map(String), BEATS_PER_MEASURE.indexOf(state.beatsPerMeasure)),
    },
    // a stock progression, in the key: named while the queue still matches it; beside it, Clear
    {
      id: 'stock',
      label: `Stock Progression: ${stock < 0 ? '—' : STOCK_PROGRESSIONS[stock].name}`,
      icon: 'progression',
      row: 'stock',
      small: true,
      dropdown: dropdown(state, 'stock', STOCK_PROGRESSIONS.map((s) => s.name), stock, undefined, 3),
    },
    { id: 'clearProgression', label: 'Clear', icon: 'remove', row: 'stock', small: true, disabled: !progression.length },
    // the key and scale the degree triads come from (and the board shows)
    {
      id: 'key',
      label: `Key: ${NOTE_NAMES[state.key]}`,
      icon: 'key',
      title: 'Shortcut: K (Shift+K goes down)',
      ...keyScale,
      dropdown: dropdown(state, 'key', NOTE_NAMES, state.key, undefined, 4),
    },
    {
      id: 'scale',
      label: `Scale: ${state.scale.name}`,
      icon: 'scale',
      title: 'Shortcut: S',
      ...keyScale,
      dropdown: dropdown(state, 'scale', SCALES.map((sc) => sc.name), SCALES.indexOf(state.scale)),
    },
    // the chord being built, in a section of its own
    { id: `${SECTION_PREFIX}chord`, label: 'Chord', icon: 'chord', section: { open: chordOpen } },
    ...(chordOpen
      ? [
          {
            id: 'degree',
            label: `Degree Triad: ${degree < 0 ? '—' : degrees[degree].label}`,
            icon: 'scale',
            ...root,
            dropdown: dropdown(state, 'degree', degrees.map((d) => d.label), degree, undefined, 4),
          },
          // beside it, the root flattened or sharpened
          {
            id: 'alteration',
            label: `Alteration: ${ALTERATIONS[alteration].name}`,
            ...root,
            dropdown: dropdown(state, 'alteration', ALTERATIONS.map((a) => a.name), alteration, undefined, ALTERATIONS.length),
          },
          // the chord's shape, side by side without icons
          {
            id: 'quality',
            label: `Quality: ${CHORD_TYPES[quality].name}`,
            ...shape,
            dropdown: dropdown(state, 'quality', CHORD_TYPES.map((t) => t.name), quality, undefined, CHORD_TYPES.length),
          },
          {
            id: 'modifier',
            label: `Modifier: ${CHORD_MODIFIERS[modifier].name}`,
            ...shape,
            dropdown: dropdown(state, 'modifier', CHORD_MODIFIERS.map((m) => m.name), modifier, undefined, CHORD_MODIFIERS.length),
          },
          {
            id: 'addChord',
            label: `Add Chord: ${chordName(builtChord(draft, state.key))}`,
            // sized for a typical chord: a rare long name is cut short rather than widening the panel
            sizeLabel: 'Add Chord: C#m7',
            icon: 'add',
          },
        ].map((item) => ({ ...item, indent: 1 }))
      : []),
    ...(progression.length
      ? progression.map((chord, i) => ({
          ...queue,
          id: `${CHORD_PREFIX}${i}`,
          label: chordName(chord),
          row: `queue-${Math.floor(i / QUEUE_COLUMNS)}`,
          current: i === player.index,
          // the playing (or paused) chord in its root note's colour, as on the Fretboard: dark, split into the
          // measure's beats, the current beat bright
          ...(i === player.index && {
            color: noteCss(chord.root, true),
            dim: noteCss(chord.root, false),
            beats: state.beatsPerMeasure,
            beat: player.beat,
          }),
          queueIndex: i,
        }))
      : [{ ...queue, id: 'queue-empty', label: 'No chords yet', cols: 1, disabled: true }]),
    ...savedItems(state),
  ];
}

/** The longest saved progression's name the panels make room for: a longer one is cut short. */
const SAVED_NAME_ROOM = 'Load: Progression 12';

/**
 * Beneath the queue, Save and Load. Save asks for a name (`state.naming`, the
 * name being typed): its field, then Save and Cancel, in their place. Load
 * lists the saved progressions by name, and is named by the one the queue
 * still matches.
 */
function savedItems(state) {
  const saved = state.savedProgressions ?? [];
  const saving = { row: 'saved', small: true };
  if (state.naming != null)
    return [
      { id: 'progressionName', label: `Name: ${state.naming}`, input: { value: state.naming, placeholder: 'Name' }, span: 2, ...saving },
      { id: 'confirmSave', label: 'Save', icon: 'save', disabled: !state.naming.trim(), ...saving },
      { id: 'cancelSave', label: 'Cancel', ...saving },
    ];
  const current = saved.findIndex((p) => sameChords(p.chords, state.progression));
  return [
    {
      id: 'saveProgression',
      label: 'Save',
      icon: 'save',
      title: 'Saves the progression and its key by name (the same name replaces it)',
      disabled: !state.progression.length,
      ...saving,
    },
    {
      id: 'load',
      label: `Load: ${current < 0 ? '—' : saved[current].name}`,
      sizeLabel: SAVED_NAME_ROOM,
      icon: 'load',
      disabled: !saved.length,
      ...saving,
      // a saved progression is deleted by dragging it out of the panel (see the windowed panel)
      dropdown: { ...dropdown(state, 'load', saved.map((p) => p.name), current, undefined, 3), removable: true },
    },
  ];
}

const sameChords = (a, b) => a.length === b.length && a.every((chord, i) => sameChord(chord, b[i]));

/**
 * The items laid out: blocks of consecutive items in the same group (or in
 * none) and equally indented, each a list of rows, where consecutive items
 * with the same `row` share one (see rowSpans). Each block: { group (or
 * null), indent (its depth: 0 not indented), rows }.
 */
export function menuBlocks(items) {
  const blocks = [];
  for (const item of items) {
    const group = item.group ?? null;
    const indent = item.indent ?? 0;
    let block = blocks.at(-1);
    if (!block || block.group !== group || block.indent !== indent) blocks.push((block = { group, indent, rows: [] }));
    const row = block.rows.at(-1);
    if (row && item.row != null && row[0].row === item.row) row.push(item);
    else block.rows.push([item]);
  }
  return blocks;
}

/**
 * A row's columns, as shares of its width: each item's `span` (1 if none),
 * then, if the row is short of its `cols` (the queue's last row), a share of
 * 1 for each empty column.
 */
export function rowSpans(row) {
  const spans = row.map((item) => item.span ?? 1);
  for (let i = row.length; i < (row[0].cols ?? 0); i++) spans.push(1);
  return spans;
}

/** The Video section: every background and view, those this device can't have shown disabled, with why. */
function videoItems(state, env) {
  const columns = 2;
  return [
    {
      id: 'background',
      label: `Background: ${BACKGROUND_LABELS[state.background]}`,
      icon: state.background,
      dropdown: dropdown(
        state,
        'background',
        BACKGROUNDS.map((b) => BACKGROUND_LABELS[b]),
        BACKGROUNDS.indexOf(state.background),
        BACKGROUNDS,
        columns,
        undefined,
        BACKGROUNDS.map((b) => backgroundUnavailable(b, env)),
      ),
    },
    {
      id: 'view',
      label: `View Mode: ${VIEW_LABELS[state.view]}`,
      icon: VIEW_ICONS[state.view],
      dropdown: dropdown(
        state,
        'view',
        VIEWS.map((v) => VIEW_LABELS[v]),
        VIEWS.indexOf(state.view),
        VIEWS.map((v) => VIEW_ICONS[v]),
        columns,
        undefined,
        VIEWS.map((v) => viewUnavailable(v, env)),
      ),
    },
  ];
}

/** Chords found by Analyze, to a row. */
const ANALYSIS_COLUMNS = 4;

/** m:ss */
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/**
 * The Analyze section: Record / Stop for the microphone and Analyze for what
 * was recorded, side by side, then what was heard (`state.analysis`: {
 * status: 'idle' | 'recording' | 'recorded' | 'analyzing' | 'done' | 'error',
 * seconds, recordedSeconds, result, error }, see analyze.js), shown as `info`
 * rows, the chords one a measure, four to a row in a framed group, and Apply
 * to Progression.
 */
function analyzeItems(state) {
  const { status = 'idle', seconds = 0, recordedSeconds, result, error } = state.analysis ?? {};
  const recording = status === 'recording';
  const analyzing = status === 'analyzing';
  const buttons = { row: 'analysis-buttons', small: true };
  const items = [
    {
      id: 'record',
      label: recording ? `Stop: ${clock(seconds)}` : 'Record',
      sizeLabel: 'Stop: 0:00',
      icon: recording ? 'stop' : 'record',
      disabled: analyzing,
      title: 'Records from the microphone, up to a minute (a new recording replaces the last)',
      ...buttons,
    },
    {
      id: 'analyze',
      label: analyzing ? 'Analyzing…' : recordedSeconds != null ? `Analyze: ${clock(recordedSeconds)}` : 'Analyze',
      sizeLabel: 'Analyze: 0:00',
      icon: 'analyze',
      disabled: recording || analyzing || recordedSeconds == null,
      title: 'Works out the recording\'s tempo, meter, key, scale and chords',
      ...buttons,
    },
  ];
  if (status === 'error') items.push({ id: 'analysis-error', label: error, info: true });
  if (status !== 'done' || !result) return items;
  const scale = SCALES.find((s) => s.id === result.scale);
  // as on the Music section's rows: the tempo beside the meter, the key beside the scale
  const timing = { info: true, row: 'analysis-timing', small: true };
  const keyScale = { info: true, row: 'analysis-key', small: true };
  return [
    ...items,
    { id: 'analysis-bpm', label: `Beats per Minute: ${result.bpm}`, ...timing },
    { id: 'analysis-meter', label: `Beats per Measure: ${result.beatsPerMeasure}`, ...timing },
    { id: 'analysis-key', label: `Key: ${NOTE_NAMES[result.key]}`, ...keyScale },
    { id: 'analysis-scale', label: `Scale: ${scale?.name ?? result.scale}`, ...keyScale },
    ...result.chords.map((chord, i) => ({
      id: `analysis-chord-${i}`,
      label: chordName(chord),
      info: true,
      compact: true,
      group: 'analysis',
      cols: ANALYSIS_COLUMNS,
      row: `analysis-chords-${Math.floor(i / ANALYSIS_COLUMNS)}`,
    })),
    { id: 'applyAnalysis', label: 'Apply to Progression', icon: 'progression', title: 'Sets the tempo, meter, key and scale, and replaces the progression with these chords' },
  ];
}

/**
 * The sections, in order: each one's header and the buttons it opens onto.
 * Music: the sound and the board, then the progression; a long one, which
 * both panels scroll.
 */
const SECTIONS = [
  { id: 'analyze', label: 'Analyze', icon: 'analyze', items: analyzeItems },
  { id: 'music', label: 'Music', icon: 'instrument', items: (state) => [...instrumentItems(state), ...progressionItems(state)] },
  { id: 'video', label: 'Video', icon: 'video', items: videoItems },
];

/**
 * The buttons: each section's header, and its buttons beneath while it's
 * open (`state.sections`: id -> true). Items: { id, label ("Name: Value", see
 * splitLabel), icon?, disabled?, title?, section?, dropdown?, and for
 * layout row?, span?, cols?, group?, indent?, info?, small?, compact?, current?, sizeLabel? }. `info`: just
 * text to read, in a button's shape but not one. `section`:
 * { open }, a section's header ("section:<id>" opens or closes it), drawn
 * with a chevron at the far right, like a dropdown's. `dropdown`: { open,
 * options: [{ id, label, selected }] }, drawn with a chevron at the far
 * right and, when open, its options beneath.
 * `row` / `span` / `cols` / `group`: see menuBlocks and rowSpans. `indent`: how many open sections it's in, each
 * setting it in a step from its header.
 * `sizeLabel`: the label the panels size for, if not `label`. `small`: a smaller font, for
 * buttons sharing a row; `compact`: just the label, centred; `current`: lit,
 * as the progression's playing chord: in `dim`, split into `beats`, with
 * beat `beat` in `color`, if it has them.
 * `env`: { xrSupported, passthroughAvailable, checking, phone, headset }.
 */
export function menuItems(state, env) {
  return SECTIONS.flatMap(({ id, label, icon, items }) => {
    const open = Boolean(state.sections?.[id]);
    // its buttons indented beneath it, as a dropdown's choices are (a section within it, a step further)
    return [
      { id: `${SECTION_PREFIX}${id}`, label, icon, section: { open } },
      ...(open ? items(state, env).map((item) => ({ ...item, indent: (item.indent ?? 0) + 1 })) : []),
    ];
  });
}

/** Every section open, and the Chord section within Music. */
const ALL_OPEN = { ...Object.fromEntries(SECTIONS.map(({ id }) => [id, true])), chord: true };

/**
 * The most buttons there can be (the progression's chords aside), every
 * section open, so the XR panel can keep its top edge still as sections open
 * and close.
 */
const STOPPED = { playing: false, started: false, index: null, beat: 0 };
const SAMPLE_STATE = {
  scale: SCALES[0],
  tuning: TUNINGS[0],
  quantize: 0,
  playOnSelect: 'off',
  velocity: false,
  key: 0,
  bpm: BPMS[0],
  beatsPerMeasure: BEATS_PER_MEASURE[0],
  progression: [],
  draft: { degree: 0, alteration: 0, type: 'maj', modifier: 'none' },
  player: STOPPED,
};
export const MENU_ROWS = menuItems({ ...SAMPLE_STATE, sections: ALL_OPEN }, {}).length;

/**
 * Every label the buttons can show, in every section, so both panels can size
 * themselves to the widest one and not change width as values change. A
 * button that shares a row, or is indented, comes as { row: [{ text, span,
 * icon, trailing }] side by side, small, compact, group, indent } instead, for
 * the row's width (and its indent): a
 * column needs `span` shares of it, room for an icon if it has one, and
 * `trailing` room for a chevron or arrow. (The dropdowns' choices sit two to a
 * row in less room, so they don't set it.)
 */
export function possibleLabels(env) {
  const labels = new Set();
  const base = { ...SAMPLE_STATE, instrument: INSTRUMENTS[0], background: 'solid', view: 'normal' };
  // a long chord name, in a long progression, at its end
  const longest = { root: 1, type: 'min', modifier: 'maj7' };
  const variants = [
    ...INSTRUMENTS.map((instrument) => ({ instrument })),
    ...SCALES.map((scale) => ({ scale })),
    ...NOTE_NAMES.map((_, key) => ({ key })),
    ...TUNINGS.map((tuning) => ({ tuning })),
    ...BACKGROUNDS.map((background) => ({ background })),
    ...VIEWS.map((view) => ({ view })),
    ...QUANTIZE.map((q) => ({ quantize: q.division })),
    ...PLAY_ON_SELECT.map((p) => ({ playOnSelect: p.id })),
    { velocity: true },
    ...BPMS.map((bpm) => ({ bpm })),
    ...BEATS_PER_MEASURE.map((beatsPerMeasure) => ({ beatsPerMeasure })),
    // every chord Add Chord can show, and every Alteration
    ...NOTE_NAMES.flatMap((_, key) =>
      ALTERATIONS.flatMap((a) =>
        CHORD_TYPES.flatMap((t) =>
          CHORD_MODIFIERS.map((m) => ({ key, draft: { degree: 0, alteration: a.id, type: t.id, modifier: m.id } })),
        ),
      ),
    ),
    // every key's degree triads
    ...SCALES.flatMap((scale) =>
      NOTE_NAMES.flatMap((_, key) =>
        keyChords(key, scale).map(({ step, chord }) => ({ scale, key, draft: { ...base.draft, degree: step, type: chord.type } })),
      ),
    ),
    // every stock progression's name
    ...STOCK_PROGRESSIONS.map((stock) => ({ progression: stockChords(stock, 0) })),
    // Analyze: recording, and the longest results it can show
    { analysis: { status: 'recording', seconds: 59 } },
    { analysis: { status: 'recorded', recordedSeconds: 59 } },
    { analysis: { status: 'analyzing', recordedSeconds: 59 } },
    ...SCALES.map((scale) => ({
      analysis: { status: 'done', result: { bpm: 200, beatsPerMeasure: 7, key: 1, scale: scale.id, chords: Array(4).fill(longest) } },
    })),
    {
      progression: Array(12).fill(longest),
      beatsPerMeasure: 7,
      player: { playing: true, started: true, index: 11, beat: 6 },
    },
  ];
  const rows = new Map(); // a row's labels, joined, -> its entry
  for (const v of variants)
    for (const block of menuBlocks(menuItems({ ...base, ...v, sections: ALL_OPEN }, env)))
        for (const row of block.rows) {
          if (row[0].row == null && !block.indent) {
            labels.add(row[0].sizeLabel ?? row[0].label);
            continue;
          }
          // a full row, as wide as it can get: short rows (the queue's last) are measured as if full
          const columns = rowSpans(row).map((span, i) => {
            const item = row[Math.min(i, row.length - 1)];
            return { text: item.sizeLabel ?? item.label, span, icon: Boolean(item.icon), trailing: Boolean(item.dropdown || item.section) };
          });
          rows.set(JSON.stringify(columns), {
            row: columns,
            small: Boolean(row[0].small),
            compact: Boolean(row[0].compact),
            group: block.group != null,
            indent: block.indent,
          });
        }
  return [...labels, ...rows.values()];
}
