// Options menu model shared by the windowed panel (DOM) and the XR panel
// (drawn on a canvas): one list of buttons, each "Name: Value". A button
// cycles its setting, opens a submenu (an arrow on its right), or opens a
// dropdown list of choices beneath it (a chevron on its right). Buttons can
// share a row, and a run of them can sit in a framed group (see menuBlocks).

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
  stockChords,
} from './music.js';

export const MENU_TITLE = 'XR Music';

/** Options → Background, in list order (passthrough last). */
export const BACKGROUNDS = ['solid', 'skybox', 'passthrough'];
const BACKGROUND_LABELS = { solid: 'Solid', skybox: 'Skybox', passthrough: 'Passthrough (XR Only)' };

/** The Vite + React starter's page colour, used for the Solid background, as in the 4D viewer. */
export const SOLID_BACKGROUND = '#242424';

/** The backgrounds this device can show: passthrough only where there is AR. */
export const availableBackgrounds = (env) => BACKGROUNDS.filter((b) => b !== 'passthrough' || env.passthroughAvailable);

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
 * The views this device can show. `env`: { phone, headset, xrSupported }. A
 * headset browser's own window can't show screen stereo usefully, so no SBS
 * or Interlaced there. Phones always get their XR views: without WebXR AR
 * they fall back to the motion sensors.
 */
export function availableViews(env) {
  return VIEWS.filter((view) => {
    if (STEREO_VIEWS.includes(view)) return !env.headset;
    if (view === 'xr') return !env.phone && env.xrSupported;
    if (view === 'phoneAR' || view === 'phoneViewer') return env.phone;
    return true;
  });
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

/** Submenus. The top page links to each; each starts with a Back button. */
export const PAGES = ['main', 'instrument', 'progression', 'video'];
const PAGE_TITLES = { main: MENU_TITLE, instrument: 'Instrument', progression: 'Progression', video: 'Video' };
export const PAGE_PREFIX = 'page:';

export const menuTitle = (page) => PAGE_TITLES[page];

export const PICK_PREFIX = 'pick:';

/**
 * A dropdown: the button shows the current choice, and when it is the open
 * one (`state.dropdown`), lists every choice beneath it, `columns` to a row,
 * each with `icons[i]` if given. Choosing one sends "pick:<id>:<index>".
 * Packed more than CHECKED_COLUMNS to a row, the chosen one is shown by its
 * highlight alone, without a check mark, to leave its label room.
 */
export const CHECKED_COLUMNS = 4;

function dropdown(state, id, choices, current, icons, columns = 2) {
  return {
    open: state.dropdown === id,
    columns,
    options: choices.map((label, i) => ({ id: `${PICK_PREFIX}${id}:${i}`, label, icon: icons?.[i], selected: i === current })),
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
export const DROPDOWNS = ['instrument', 'quantize', 'playOnSelect', 'scale', 'key', 'tuning', 'bpm', 'beats', 'stock', 'degree', 'alteration', 'quality', 'modifier', 'background', 'view'];

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
    degree: keyChords(state.key, state.scale),
    alteration: ALTERATIONS.map((a) => a.id),
    quality: CHORD_TYPES.map((t) => t.id),
    modifier: CHORD_MODIFIERS.map((m) => m.id),
    background: availableBackgrounds(env),
    view: env.views ?? ['normal'],
  };
}

/** The Instrument page: the sound (a synth or a sample), its echo and quantizing side by side, and the board's tuning. */
function instrumentItems(state) {
  return [
    {
      id: 'instrument',
      label: `Sample: ${state.instrument}`,
      icon: instrumentIcon(state.instrument),
      title: 'Shortcut: I',
      dropdown: dropdown(state, 'instrument', INSTRUMENTS, INSTRUMENTS.indexOf(state.instrument), INSTRUMENTS.map(instrumentIcon)),
    },
    {
      id: 'echo',
      label: `Echo: ${state.echo ? 'On' : 'Off'}`,
      icon: state.echo ? 'echo' : 'echoOff',
      title: 'Shortcut: E. It repeats once a beat (see Progression → Beats per Minute)',
      row: 'timing',
      small: true,
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
      ),
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
 * The Progression page: the transport and the tempo, a stock progression to
 * start from, the key and scale, then the chord being built (a degree's
 * triad, then on one row its root's alteration, its quality and modifier),
 * Add Chord, Clear and Play on Select on one row, then the queue: the progression's chords, four to a
 * row in a framed group. A queued chord (`queueIndex`) is dragged to reorder
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
      span: 2,
    },
    { id: 'stop', label: 'Stop', icon: 'stop', disabled: !player.started, ...transport },
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
    // a stock progression, in the key: named while the queue still matches it
    {
      id: 'stock',
      label: `Stock Progression: ${stock < 0 ? '—' : STOCK_PROGRESSIONS[stock].name}`,
      icon: 'progression',
      dropdown: dropdown(state, 'stock', STOCK_PROGRESSIONS.map((s) => s.name), stock),
    },
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
      span: 2,
      dropdown: dropdown(state, 'scale', SCALES.map((sc) => sc.name), SCALES.indexOf(state.scale)),
    },
    {
      id: 'degree',
      label: `Degree Triad: ${degree < 0 ? '—' : degrees[degree].label}`,
      icon: 'scale',
      dropdown: dropdown(state, 'degree', degrees.map((d) => d.label), degree, undefined, 4),
    },
    // the chord's shape, side by side without icons
    {
      id: 'alteration',
      label: `Alteration: ${ALTERATIONS[alteration].name}`,
      ...shape,
      dropdown: dropdown(state, 'alteration', ALTERATIONS.map((a) => a.name), alteration, undefined, ALTERATIONS.length),
    },
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
      row: 'add',
      span: 1.9,
      small: true,
    },
    { id: 'clearProgression', label: 'Clear', icon: 'remove', row: 'add', small: true, disabled: !progression.length },
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
      row: 'add',
      span: 2.75,
      small: true,
    },
    ...(progression.length
      ? progression.map((chord, i) => ({
          ...queue,
          id: `${CHORD_PREFIX}${i}`,
          label: chordName(chord),
          row: `queue-${Math.floor(i / QUEUE_COLUMNS)}`,
          current: i === player.index,
          // the playing (or paused) chord in its root note's colour, as on the Fretboard
          color: i === player.index ? noteCss(chord.root, true) : undefined,
          queueIndex: i,
        }))
      : [{ ...queue, id: 'queue-empty', label: 'No chords yet', cols: 1, disabled: true }]),
  ];
}

/**
 * The items laid out: blocks of consecutive items in the same group (or in
 * none), each a list of rows, where consecutive items with the same `row`
 * share one (see rowSpans). Each block: { group (or null), rows }.
 */
export function menuBlocks(items) {
  const blocks = [];
  for (const item of items) {
    const group = item.group ?? null;
    let block = blocks.at(-1);
    if (!block || block.group !== group) blocks.push((block = { group, rows: [] }));
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

function videoItems(state, env) {
  const backgrounds = availableBackgrounds(env);
  const views = env.views ?? ['normal'];
  return [
    {
      id: 'background',
      label: `Background: ${BACKGROUND_LABELS[state.background]}`,
      icon: state.background,
      title: env.passthroughAvailable ? undefined : 'Passthrough needs an AR-capable headset or a phone camera',
      dropdown: dropdown(
        state,
        'background',
        backgrounds.map((b) => BACKGROUND_LABELS[b]),
        backgrounds.indexOf(state.background),
        backgrounds,
      ),
    },
    {
      id: 'view',
      label: `View Mode: ${VIEW_LABELS[state.view]}`,
      icon: VIEW_ICONS[state.view],
      dropdown: dropdown(
        state,
        'view',
        views.map((v) => VIEW_LABELS[v]),
        views.indexOf(state.view),
        views.map((v) => VIEW_ICONS[v]),
      ),
      disabled: views.length < 2,
      title:
        !env.xrSupported && !env.checking
          ? "WebXR isn't available here. Open the page in a headset browser over HTTPS for XR."
          : undefined,
    },
  ];
}

const BACK = { id: `${PAGE_PREFIX}main`, label: 'Back', icon: 'back' };

/**
 * The buttons on `state.page`. Items: { id, label ("Name: Value", see
 * splitLabel), icon?, disabled?, title?, submenu?, dropdown?, and for
 * layout row?, span?, cols?, group?, small?, compact?, current?, sizeLabel? }. `submenu`:
 * the id ("page:<page>") opens that page, drawn with an arrow at the far
 * right. `dropdown`: { open, options: [{ id, label, selected }] }, drawn
 * with a chevron at the far right and, when open, its options beneath.
 * `row` / `span` / `cols` / `group`: see menuBlocks and rowSpans.
 * `sizeLabel`: the label the panels size for, if not `label`. `small`: a smaller font, for
 * buttons sharing a row; `compact`: just the label, centred; `current`: lit,
 * as the progression's playing chord, in `color` if it has one.
 * `env`: { xrSupported, passthroughAvailable, checking, views (available) }.
 */
export function menuItems(state, env) {
  if (state.page === 'instrument') return [BACK, ...instrumentItems(state)];
  if (state.page === 'progression') return [BACK, ...progressionItems(state)];
  if (state.page === 'video') return [BACK, ...videoItems(state, env)];
  return [
    { id: `${PAGE_PREFIX}instrument`, label: 'Instrument', icon: 'instrument', submenu: true },
    { id: `${PAGE_PREFIX}progression`, label: 'Progression', icon: 'progression', submenu: true },
    { id: `${PAGE_PREFIX}video`, label: 'Video', icon: 'video', submenu: true },
  ];
}

/**
 * The most buttons any page has (the progression's chords aside), so the XR
 * panel can keep its top edge still when the page changes.
 */
const STOPPED = { playing: false, started: false, index: null, beat: 0 };
const SAMPLE_STATE = {
  scale: SCALES[0],
  tuning: TUNINGS[0],
  quantize: 0,
  playOnSelect: 'off',
  key: 0,
  bpm: BPMS[0],
  beatsPerMeasure: BEATS_PER_MEASURE[0],
  progression: [],
  draft: { degree: 0, alteration: 0, type: 'maj', modifier: 'none' },
  player: STOPPED,
};
export const MENU_ROWS =
  1 + Math.max(instrumentItems(SAMPLE_STATE).length, progressionItems(SAMPLE_STATE).length, videoItems(SAMPLE_STATE, {}).length);

/**
 * Every label the buttons can show, on every page, so both panels can size
 * themselves to the widest one and not change width as values change. A
 * button that shares a row comes as { row: [{ text, span, icon, trailing }]
 * side by side, small, compact, group } instead, for the row's width: a
 * column needs `span` shares of it, room for an icon if it has one, and
 * `trailing` room for a chevron or arrow. (The dropdowns' choices sit two to a
 * row in less room, so they don't set it.)
 */
export function possibleLabels(env) {
  const labels = new Set();
  const base = { ...SAMPLE_STATE, instrument: INSTRUMENTS[0], echo: false, background: 'solid', view: 'normal' };
  // a long chord name, in a long progression, at its end
  const longest = { root: 1, type: 'min', modifier: 'maj7' };
  const variants = [
    ...INSTRUMENTS.map((instrument) => ({ instrument })),
    ...SCALES.map((scale) => ({ scale })),
    ...NOTE_NAMES.map((_, key) => ({ key })),
    ...TUNINGS.map((tuning) => ({ tuning })),
    ...BACKGROUNDS.map((background) => ({ background })),
    ...VIEWS.map((view) => ({ view })),
    { echo: true },
    ...QUANTIZE.map((q) => ({ quantize: q.division })),
    ...PLAY_ON_SELECT.map((p) => ({ playOnSelect: p.id })),
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
    {
      progression: Array(12).fill(longest),
      beatsPerMeasure: 7,
      player: { playing: true, started: true, index: 11, beat: 6 },
    },
  ];
  const rows = new Map(); // a row's labels, joined, -> its entry
  for (const page of PAGES)
    for (const v of variants)
      for (const block of menuBlocks(menuItems({ ...base, ...v, page }, env)))
        for (const row of block.rows) {
          if (row[0].row == null) {
            labels.add(row[0].sizeLabel ?? row[0].label);
            continue;
          }
          // a full row, as wide as it can get: short rows (the queue's last) are measured as if full
          const columns = rowSpans(row).map((span, i) => {
            const item = row[Math.min(i, row.length - 1)];
            return { text: item.sizeLabel ?? item.label, span, icon: Boolean(item.icon), trailing: Boolean(item.dropdown || item.submenu) };
          });
          rows.set(JSON.stringify(columns), {
            row: columns,
            small: Boolean(row[0].small),
            compact: Boolean(row[0].compact),
            group: block.group != null,
          });
        }
  return [...labels, ...rows.values()];
}
