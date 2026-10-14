// Options menu model shared by the windowed panel (DOM) and the XR panel
// (drawn on a canvas): one list of buttons, each "Name: Value". A button
// cycles its setting, opens a submenu (an arrow on its right), or opens a
// dropdown list of choices beneath it (a chevron on its right).

import { INSTRUMENTS, isSynth } from './audio.js';
import { NOTE_NAMES, SCALES, TUNINGS } from './music.js';

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
export const PAGES = ['main', 'music', 'video'];
const PAGE_TITLES = { main: MENU_TITLE, music: 'Music', video: 'Video' };
export const PAGE_PREFIX = 'page:';

export const menuTitle = (page) => PAGE_TITLES[page];

export const PICK_PREFIX = 'pick:';

/**
 * A dropdown: the button shows the current choice, and when it is the open
 * one (`state.dropdown`), lists every choice beneath it, each with
 * `icons[i]` if given. Choosing one sends "pick:<id>:<index>".
 */
function dropdown(state, id, choices, current, icons) {
  return {
    open: state.dropdown === id,
    options: choices.map((label, i) => ({ id: `${PICK_PREFIX}${id}:${i}`, label, icon: icons?.[i], selected: i === current })),
  };
}

/** An instrument's icon: its wave for a synth, a recorded clip for a sample. */
export const instrumentIcon = (instrument) => (isSynth(instrument) ? instrument.toLowerCase() : 'sample');

/** The dropdowns' ids. */
export const DROPDOWNS = ['instrument', 'scale', 'key', 'tuning', 'background', 'view'];

/**
 * The choices behind each dropdown on this device, in list order. App
 * applies a pick ("pick:<id>:<index>") by its index into these.
 */
export function dropdownChoices(env) {
  return {
    instrument: INSTRUMENTS,
    scale: SCALES,
    key: NOTE_NAMES.map((_, i) => i),
    tuning: TUNINGS,
    background: availableBackgrounds(env),
    view: env.views ?? ['normal'],
  };
}

function musicItems(state) {
  return [
    {
      id: 'instrument',
      label: `Instrument: ${state.instrument}`,
      icon: instrumentIcon(state.instrument),
      title: 'Shortcut: I',
      dropdown: dropdown(state, 'instrument', INSTRUMENTS, INSTRUMENTS.indexOf(state.instrument), INSTRUMENTS.map(instrumentIcon)),
    },
    {
      id: 'scale',
      label: `Scale: ${state.scale.name}`,
      icon: 'scale',
      title: 'Shortcut: S',
      dropdown: dropdown(state, 'scale', SCALES.map((sc) => sc.name), SCALES.indexOf(state.scale)),
    },
    {
      id: 'key',
      label: `Key: ${NOTE_NAMES[state.key]}`,
      icon: 'key',
      title: 'Shortcut: K (Shift+K goes down)',
      dropdown: dropdown(state, 'key', NOTE_NAMES, state.key),
    },
    {
      id: 'tuning',
      label: `Tuning: ${state.tuning.name}`,
      icon: 'tuning',
      title: 'Shortcut: T',
      dropdown: dropdown(state, 'tuning', TUNINGS.map((t) => t.name), TUNINGS.indexOf(state.tuning)),
    },
    { id: 'echo', label: `Echo: ${state.echo ? 'On' : 'Off'}`, icon: state.echo ? 'echo' : 'echoOff', title: 'Shortcut: E' },
  ];
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
 * splitLabel), icon, disabled?, title?, submenu?, dropdown? }. `submenu`:
 * the id ("page:<page>") opens that page, drawn with an arrow at the far
 * right. `dropdown`: { open, options: [{ id, label, selected }] }, drawn
 * with a chevron at the far right and, when open, its options beneath.
 * `env`: { xrSupported, passthroughAvailable, checking, views (available) }.
 */
export function menuItems(state, env) {
  if (state.page === 'music') return [BACK, ...musicItems(state)];
  if (state.page === 'video') return [BACK, ...videoItems(state, env)];
  return [
    { id: `${PAGE_PREFIX}music`, label: 'Music', icon: 'instrument', submenu: true },
    { id: `${PAGE_PREFIX}video`, label: 'Video', icon: 'video', submenu: true },
  ];
}

/** The most buttons any page has, so the XR panel can keep its top edge still when the page changes. */
const SAMPLE_STATE = { scale: SCALES[0], tuning: TUNINGS[0] };
export const MENU_ROWS = 1 + Math.max(musicItems(SAMPLE_STATE).length, videoItems(SAMPLE_STATE, {}).length);

/**
 * Every label the buttons can show, on every page, so both panels can size
 * themselves to the widest one and not change width as values change. (The
 * dropdowns' choices sit two to a row in less room, so they don't set it.)
 */
export function possibleLabels(env) {
  const labels = new Set();
  const base = { instrument: INSTRUMENTS[0], scale: SCALES[0], key: 0, tuning: TUNINGS[0], echo: false, background: 'solid', view: 'normal' };
  const variants = [
    ...INSTRUMENTS.map((instrument) => ({ instrument })),
    ...SCALES.map((scale) => ({ scale })),
    ...NOTE_NAMES.map((_, key) => ({ key })),
    ...TUNINGS.map((tuning) => ({ tuning })),
    ...BACKGROUNDS.map((background) => ({ background })),
    ...VIEWS.map((view) => ({ view })),
    { echo: true },
  ];
  for (const page of PAGES)
    for (const v of variants) for (const item of menuItems({ ...base, ...v, page }, env)) labels.add(item.label);
  return [...labels];
}
