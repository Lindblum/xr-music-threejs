import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import { XR, createXRStore, useXRSessionModeSupported } from '@react-three/xr';
import Scene from './Scene.jsx';
import { sideBySideEvents } from './SideBySide.jsx';
import Icon from './Icon.jsx';
import { MENU_TOGGLE } from './XRMenuPanel.jsx';
import { PHONE_AR_SESSION_INIT } from './PhoneStereo.jsx';
import { CardboardOverlay, canUseCardboard, enterCardboard, exitCardboard } from './Cardboard.jsx';
import { buildCells } from './Fretboard.jsx';
import { EFFECTS, INSTRUMENTS, loadInstrument, playChord, setBeatGrid, setEffectAmount, setEffectOn, unlockAudio } from './audio.js';
import { SCALES, TUNINGS, builtChord, chordNotes, chordPitchClasses, keyChordChart, mod12, stockChords } from './music.js';
import { useProgression } from './progression.js';
import { DEFAULT_SETTINGS, loadSavedProgressions, loadSettings, saveSavedProgressions, saveSettings } from './settings.js';
import { startRecording, stopRecording } from './recorder.js';
import { analyze } from './analyze.js';
import { RESET_EFFECTS } from './SideFrames.jsx';
import {
  BEATS_PER_MEASURE,
  BPMS,
  CHORD_PREFIX,
  DROPDOWNS,
  XR_VIEWS,
  MENU_ROWS,
  SECTION_PREFIX,
  PICK_PREFIX,
  cycle,
  menuItems,
  MENU_TITLE,
  dropdownChoices,
  menuBlocks,
  rowSpans,
  possibleLabels,
  splitLabel,
} from './menu.js';

// View Mode: Normal, 3D: SBS (half side-by-side, for 3D TVs and projectors)
// and 3D: Interlaced (alternate rows, for passive 3D monitors) are windowed.
// The XR views start a session, only from a tap, as browsers require, as in
// the 4D viewer:
//   XR: Headset (headsets) starts an AR session where supported (so every
//   background, passthrough included, can be switched live), otherwise VR.
//   XR: Phone AR / Phone Viewer start one AR session (tracked by ARCore) that
//   the app draws as one view, or two lens-corrected eyes for a phone viewer;
//   switching between the two is live. Phones without AR get a view steered
//   by the motion sensors instead, with the rear camera for passthrough.

// kept as a reference: the store reads it whenever a session starts
const xrOptions = {
  // controllers and hands get ray / touch pointers by default, for the panel
  frameRate: 'high',
  // headset emulator on localhost during development only
  emulate: import.meta.env.DEV ? 'metaQuest3' : false,
  foveation: 0.5,
};
const store = createXRStore(xrOptions);

/**
 * The phone AR session: the library's defaults plus raw camera access, for
 * passthrough in stereo, and the store's overlay element as its DOM overlay,
 * where XR: Phone AR shows the menu.
 */
function enterPhoneAR() {
  xrOptions.customSessionInit = { ...PHONE_AR_SESSION_INIT, domOverlay: { root: store.getState().domOverlayRoot } };
  try {
    return store.enterAR(); // session options are built synchronously here
  } finally {
    xrOptions.customSessionInit = undefined;
  }
}

/** A headset's own browser (Quest, Pico, Wolvic). */
function isHeadsetBrowser() {
  return /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);
}

/**
 * Phones and tablets, whose WebXR shows a single view. Detected by the
 * device rather than by WebXR support: some phone browsers also report VR.
 */
function isPhone() {
  if (isHeadsetBrowser()) return false;
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) && canUseCardboard();
}

/** Play on Select: a chord strummed, or just its root, or nothing (`mode` 'chord' | 'root' | 'off'). */
function playSelected(chord, mode, instrument) {
  if (!chord || mode === 'off') return;
  const notes = chordNotes(chord);
  playChord(mode === 'root' ? notes.slice(0, 1) : notes, instrument);
}

const SLIDER_SAVE_DELAY = 500; // ms a FilterFrame slider is still before it's saved

const describe = (e) => `${e?.name ?? 'Error'}${e?.message ? ` - ${e.message}` : ''}`;

function useMusicState() {
  // the music settings and progression start as they were left (see settings.js)
  const [saved] = useState(loadSettings);
  const [instrument, setInstrument] = useState(saved.instrument);
  const [scale, setScale] = useState(saved.scale);
  const [key, setKey] = useState(saved.key);
  const [tuning, setTuning] = useState(saved.tuning);
  const [quantize, setQuantize] = useState(saved.quantize); // steps per beat notes wait for (0: off)
  const [effects, setEffects] = useState(saved.effects); // the FilterFrame's effects switched in: id -> true (see EFFECTS)
  const [velocity, setVelocity] = useState(saved.velocity); // notes as loud as they're struck hard
  const [playOnSelect, setPlayOnSelect] = useState(saved.playOnSelect); // played on selecting a chord: 'off' | 'root' | 'chord'
  const [background, setBackground] = useState(saved.background); // 'solid' | 'skybox' | 'passthrough'
  const [menuOpen, setMenuOpen] = useState(true); // shared by the windowed and XR panels
  const [sections, setSections] = useState({ music: true }); // the menu's sections open: id -> true (see menu.js)
  const [dropdown, setDropdown] = useState(null); // the dropdown whose list is open
  const [bpm, setBpm] = useState(saved.bpm);
  const [beatsPerMeasure, setBeatsPerMeasure] = useState(saved.beatsPerMeasure);
  const [progression, setProgression] = useState(saved.progression); // chords: { root, type, modifier }, see music.js
  const [draft, setDraft] = useState(saved.draft); // the chord Add Chord adds: { degree, alteration, type, modifier }, see music.js
  const [savedProgressions, setSavedProgressions] = useState(loadSavedProgressions); // saved by name: see settings.js
  const [naming, setNaming] = useState(null); // the name being typed for Save, or null
  const [saveError, setSaveError] = useState(null); // why the last Save didn't, or null
  // a new key moves the progression with it: every chord's root by the same interval
  const keyWas = useRef(key);
  useEffect(() => {
    const interval = key - keyWas.current;
    keyWas.current = key;
    if (interval) setProgression((p) => p.map((chord) => ({ ...chord, root: mod12(chord.root + interval) })));
  }, [key]);
  // the FilterFrame's sliders, effect id -> 0..1: they move every frame while dragged, so they're no state (see SideFrames.jsx)
  const effectAmounts = useRef(saved.effectAmounts);
  const latest = useRef(null); // the settings as they are now, for saving the sliders with
  latest.current = { instrument, scale, key, tuning, quantize, effects, background, velocity, playOnSelect, bpm, beatsPerMeasure, progression, draft, savedProgressions };
  const save = useCallback(() => saveSettings({ ...latest.current, effectAmounts: effectAmounts.current }), []);
  useEffect(save, [save, instrument, scale, key, tuning, quantize, effects, background, velocity, playOnSelect, bpm, beatsPerMeasure, progression, draft]);
  // a slider moved: heard at once, and saved once it's been still a moment
  const saveTimer = useRef(null);
  const slideEffect = useCallback(
    (id, amount) => {
      effectAmounts.current[id] = amount;
      setEffectAmount(id, amount);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(save, SLIDER_SAVE_DELAY);
    },
    [save],
  );
  // the sliders as they were left
  useEffect(() => {
    for (const [id, amount] of Object.entries(effectAmounts.current)) setEffectAmount(id, amount);
  }, []);

  const actions = useMemo(
    () => ({
      nextInstrument: (step = 1) => setInstrument((i) => cycle(INSTRUMENTS, i, step)),
      nextScale: (step = 1) => setScale((s) => cycle(SCALES, s, step)),
      nextKey: (step = 1) => setKey((k) => (k + step + 12) % 12),
      nextTuning: (step = 1) => setTuning((t) => cycle(TUNINGS, t, step)),
      toggleEffect: (id) => setEffects((e) => ({ ...e, [id]: !e[id] })),
      toggleEcho: () => setEffects((e) => ({ ...e, echo: !e.echo })),
      /** Every effect switched out (see App for the sliders). */
      clearEffects: () => setEffects(DEFAULT_SETTINGS.effects),
      toggleVelocity: () => setVelocity((v) => !v),
      toggleMenu: () => setMenuOpen((v) => !v),
      toggleSection: (id) => {
        setSections((s) => ({ ...s, [id]: !s[id] }));
        setDropdown(null);
      },
      toggleDropdown: (id) => setDropdown((d) => (d === id ? null : id)),
      closeDropdown: () => setDropdown(null),
      /** A choice from a dropdown's list (see dropdownChoices), which then closes. */
      pick: (id, choice) => {
        ({
          instrument: setInstrument,
          quantize: setQuantize,
          playOnSelect: setPlayOnSelect,
          scale: setScale,
          key: setKey,
          tuning: setTuning,
          bpm: setBpm,
          beats: setBeatsPerMeasure,
          // a degree's triad: its root unaltered, its quality the triad's
          degree: ({ step, chord }) => setDraft((d) => ({ ...d, degree: step, alteration: 0, type: chord.type })),
          alteration: (alteration) => setDraft((d) => ({ ...d, alteration })),
          quality: (type) => setDraft((d) => ({ ...d, type })),
          modifier: (modifier) => setDraft((d) => ({ ...d, modifier })),
          background: setBackground,
        })[id](choice);
        setDropdown(null);
      },
      addChord: (chord) => setProgression((p) => [...p, chord]),
      clearProgression: () => setProgression([]),
      /** Moves the chord at `from` to `to`, the others closing up around it. */
      moveChordTo: (from, to) =>
        setProgression((p) => {
          if (from === to || !p[from] || to < 0 || to >= p.length) return p;
          const next = [...p];
          next.splice(to, 0, ...next.splice(from, 1));
          return next;
        }),
      /**
       * Takes on what Analyze heard ({ bpm, beatsPerMeasure, key, scale,
       * chords }): the nearest tempo on offer, the meter, the key and scale,
       * and its chords as the progression (as they are: the key change mustn't move them).
       */
      applyAnalysis: (result) => {
        keyWas.current = result.key;
        setKey(result.key);
        setBpm(BPMS.reduce((best, b) => (Math.abs(b - result.bpm) < Math.abs(best - result.bpm) ? b : best)));
        setBeatsPerMeasure(BEATS_PER_MEASURE.includes(result.beatsPerMeasure) ? result.beatsPerMeasure : 4);
        setScale(SCALES.find((s) => s.id === result.scale) ?? SCALES[0]);
        setProgression(result.chords);
        setDropdown(null);
      },
      /** Replaces the progression with a stock one in `key`, and switches to its scale. */
      applyStock: (stock, key) => {
        setProgression(stockChords(stock, key));
        setScale(SCALES.find((s) => s.id === stock.scale));
        setDropdown(null);
      },
      removeChord: (index) => setProgression((p) => p.filter((_, i) => i !== index)),
      /** Save's name field opens, holding `name` to start from; typed into, it's `name`. */
      startNaming: (name) => {
        setNaming(name);
        setSaveError(null);
        setDropdown(null);
      },
      nameProgression: setNaming,
      cancelNaming: () => setNaming(null),
      /** Deletes the saved progression at `index`; the last one gone, Load's list closes. */
      deleteSavedProgression: (index) => {
        const next = latest.current.savedProgressions.filter((_, i) => i !== index);
        saveSavedProgressions(next); // smaller than before, so it always fits
        setSavedProgressions(next);
        setSaveError(null);
        if (!next.length) setDropdown(null);
      },
      /**
       * Saves the progression and its key as `name`: in place
       * of one already so named, else after the rest. If the browser won't
       * store it, nothing is saved and the panel says so.
       */
      saveProgression: (name) => {
        const { key, progression, savedProgressions: list } = latest.current;
        const entry = { name: name.trim(), key, chords: progression };
        const at = list.findIndex((p) => p.name === entry.name);
        const next = at < 0 ? [...list, entry] : list.map((p, i) => (i === at ? entry : p));
        if (!saveSavedProgressions(next)) {
          setSaveError(`Couldn't save "${entry.name}": this browser won't store it (its storage is full, or blocked for this site).`);
          return;
        }
        setSavedProgressions(next);
        setNaming(null);
        setSaveError(null);
      },
      /** Takes on a saved progression: its key, and its chords (as they are: the key change mustn't move them). The scale and tempo stay. */
      loadProgression: (saved) => {
        keyWas.current = saved.key;
        setKey(saved.key);
        setProgression(saved.chords);
        setDropdown(null);
      },
    }),
    [],
  );
  const state = {
    instrument,
    scale,
    key,
    tuning,
    quantize,
    effects,
    velocity,
    playOnSelect,
    background,
    menuOpen,
    sections,
    dropdown,
    bpm,
    beatsPerMeasure,
    progression,
    draft,
    savedProgressions,
    naming,
    saveError,
  };
  return [state, actions, { effectAmounts, slideEffect }];
}

function useKeyboard(actions, player) {
  useEffect(() => {
    const keymap = {
      Space: player.toggle,
      KeyP: player.toggle,
      Escape: player.stop,
      KeyI: actions.nextInstrument,
      KeyS: actions.nextScale,
      KeyK: actions.nextKey,
      KeyT: actions.nextTuning,
      KeyE: actions.toggleEcho,
      Enter: actions.toggleMenu,
      NumpadEnter: actions.toggleMenu,
    };
    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, select, textarea')) return;
      const action = keymap[e.code];
      if (!action) return;
      e.preventDefault();
      action(e.shiftKey ? -1 : 1);
    };
    // a focused button would also take the space bar as a click, on its key up
    const onKeyUp = (e) => {
      if (e.code === 'Space' && !e.target.closest?.('input, select, textarea')) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [actions, player.toggle, player.stop]);
}

/**
 * The number keys choose a chord by scale degree, as if chosen on the
 * ChordFrame: 1 the I chord, 2 the ii... its 7th with Shift. A degree with no
 * chord in the chart (see keyChordChart), or beyond the scale, does nothing.
 */
function useDegreeKeys(chart, scale, chooseChord) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, select, textarea')) return;
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (!digit) return;
      e.preventDefault();
      const step = scale.steps[Number(digit[1]) - 1];
      const row = chart.find((r) => r.step === step);
      const chord = row && (e.shiftKey ? row.seventh : row.triad);
      if (chord) chooseChord(chord);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chart, scale, chooseChord]);
}

/** Turns sound on at the first tap or key press, which browsers need before playing it. */
function useAudioUnlock() {
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, []);
}

/** The selected instrument's sample: 'loading', { note } (its recorded pitch), or 'error'. */
function useInstrument(name) {
  const [loaded, setLoaded] = useState({});
  useEffect(() => {
    let live = true;
    loadInstrument(name).then(
      (sample) => live && setLoaded((l) => ({ ...l, [name]: sample })),
      (e) => {
        console.error(`[xr-music] could not load ${name}`, e);
        if (live) setLoaded((l) => ({ ...l, [name]: 'error' }));
      },
    );
    return () => {
      live = false;
    };
  }, [name]);
  return loaded[name] ?? 'loading';
}

function useXRSupport() {
  const vr = useXRSessionModeSupported('immersive-vr');
  const ar = useXRSessionModeSupported('immersive-ar');
  return { vr, ar, checked: vr !== undefined || ar !== undefined };
}

const getSessionActive = () => store.getState().session != null;
const getSessionMode = () => store.getState().mode ?? null;

/** "Name: Value": the name on the left, the value against the right edge. */
function Label({ text }) {
  const { name, value } = splitLabel(text);
  return (
    <span className="label">
      <span className="name">{value ? `${name}:` : name}</span>
      {value && <span className="value">{value}</span>}
    </span>
  );
}

/** What a button's right edge shows: a section's or a dropdown's chevron. */
function trailingIcon(item) {
  if (item.section) return item.section.open ? 'dropdownOpen' : 'dropdown';
  if (item.dropdown) return item.dropdown.open ? 'dropdownOpen' : 'dropdown';
  return null;
}

const DRAG_START = 6; // px the pointer moves before a press on a queued chord becomes a drag
const INDENT = 24; // px an open section's buttons are set in, as far as a dropdown's choices

/** The playing chord's background: its dark colour split into the measure's beats, the current one bright. */
function beatStyle({ color, dim, beats, beat }) {
  const from = (beat / beats) * 100;
  const to = ((beat + 1) / beats) * 100;
  return {
    background: `linear-gradient(to right, ${dim} ${from}%, ${color} ${from}%, ${color} ${to}%, ${dim} ${to}%)`,
    borderColor: color,
  };
}

/**
 * Dragging the progression's queued chords in the windowed panel: dropped on
 * another chord it moves there, dropped outside the panel it's removed.
 * Returns { drag, handlers(item) }: `drag` is { from, label, x, y, to,
 * outside } once the pointer has moved, for drawing.
 */
function useQueueDrag(onQueueEdit) {
  const [drag, setDrag] = useState(null);
  const current = useRef(null);
  const dragged = useRef(false); // a drag just ended: the click that follows isn't one
  const update = (next) => {
    current.current = next;
    setDrag(next);
  };
  const handlers = (item) => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      update({ from: item.queueIndex, label: item.label, startX: e.clientX, startY: e.clientY, moved: false });
    },
    onPointerMove: (e) => {
      const d = current.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_START;
      if (!moved) return;
      // what's under the pointer: another queued chord, the queue's frame (its end), or outside the panel
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const chip = under?.closest('[data-queue-index]');
      const queue = under?.closest('[data-group="queue"]');
      const last = queue ? queue.querySelectorAll('[data-queue-index]').length - 1 : -1;
      update({
        ...d,
        moved,
        x: e.clientX,
        y: e.clientY,
        to: chip ? Number(chip.dataset.queueIndex) : queue ? last : null,
        outside: !under?.closest('.hud'),
      });
    },
    onPointerUp: () => {
      const d = current.current;
      update(null);
      dragged.current = Boolean(d?.moved);
      if (!d?.moved) return;
      if (d.outside) onQueueEdit({ type: 'remove', index: d.from });
      else if (d.to != null && d.to !== d.from) onQueueEdit({ type: 'move', from: d.from, to: d.to });
    },
    onPointerCancel: () => update(null),
    onDoubleClick: () => onQueueEdit({ type: 'remove', index: item.queueIndex }),
  });
  /** Whether a click on a queued chord is really the end of a drag (and forgets it). */
  const wasDrag = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };
  return { drag: drag?.moved ? drag : null, handlers, wasDrag };
}

/**
 * Dragging a choice out of a `removable` dropdown (Load's saved
 * progressions) in the windowed panel: dropped outside the panel, it's
 * removed (`onRemove(option id)`). Returns { drag, handlers(option),
 * wasDrag }: `drag` is { label, x, y, outside } once the pointer has moved,
 * for drawing.
 */
function useOptionDrag(onRemove) {
  const [drag, setDrag] = useState(null);
  const current = useRef(null);
  const dragged = useRef(false); // a drag just ended: the click that follows isn't one
  const update = (next) => {
    current.current = next;
    setDrag(next);
  };
  const handlers = (option) => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      update({ id: option.id, label: option.label, startX: e.clientX, startY: e.clientY, moved: false });
    },
    onPointerMove: (e) => {
      const d = current.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_START;
      if (!moved) return;
      const under = document.elementFromPoint(e.clientX, e.clientY);
      update({ ...d, moved, x: e.clientX, y: e.clientY, outside: !under?.closest('.hud') });
    },
    onPointerUp: () => {
      const d = current.current;
      update(null);
      dragged.current = Boolean(d?.moved);
      if (d?.moved && d.outside) onRemove?.(d.id);
    },
    onPointerCancel: () => update(null),
  });
  /** Whether a click on a choice is really the end of a drag (and forgets it). */
  const wasDrag = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };
  return { drag: drag?.moved ? drag : null, handlers, wasDrag };
}

function MenuButton({ item, onSelect, onName, queue }) {
  const trailing = !item.compact && trailingIcon(item);
  const queued = item.queueIndex != null;
  const drag = queue?.drag;
  const className = [
    'menu-btn',
    item.info && 'info',
    item.compact && 'compact',
    item.small && 'small',
    item.current && 'current',
    item.current && item.color && 'coloured',
    queued && 'queued',
    queued && drag?.from === item.queueIndex && 'dragging',
    queued && drag && !drag.outside && drag.to === item.queueIndex && drag.from !== item.queueIndex && 'drop-target',
  ]
    .filter(Boolean)
    .join(' ');
  // a field to type into, in a button's shape: Enter confirms (the button after it), Escape cancels (the one after that)
  if (item.input)
    return (
      <input
        className="menu-btn menu-input"
        value={item.input.value}
        placeholder={item.input.placeholder}
        aria-label={item.input.placeholder}
        maxLength={40}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => onName?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect('confirmSave');
          else if (e.key === 'Escape') onSelect('cancelSave');
        }}
      />
    );
  // just text to read: a button's shape, not one
  if (item.info)
    return (
      <div className={className} title={item.title}>
        {!item.compact && item.icon && <Icon name={item.icon} />}
        {item.compact ? <span className="option-label">{item.label}</span> : <Label text={item.label} />}
      </div>
    );
  return (
    <button
      className={className}
      disabled={item.disabled}
      title={queued ? 'Click to go to this chord; drag to reorder; drag out of the panel or double-click to remove' : item.title}
      aria-expanded={item.dropdown ? item.dropdown.open : undefined}
      aria-current={item.current || undefined}
      data-queue-index={queued ? item.queueIndex : undefined}
      style={item.current && item.color ? beatStyle(item) : undefined}
      onClick={() => (!queued || !queue?.wasDrag()) && onSelect(item.id)}
      {...(queued && queue ? queue.handlers(item) : {})}
    >
      {!item.compact && item.icon && <Icon name={item.icon} />}
      {item.compact ? <span className="option-label">{item.label}</span> : <Label text={item.label} />}
      {trailing && <Icon name={trailing} />}
    </button>
  );
}

/**
 * An open dropdown's choices, `dropdown.columns` to a row beneath its button
 * (or its row). A `removable` dropdown's choices are dragged out of the panel
 * to remove them (see useOptionDrag).
 */
function MenuOptions({ dropdown, onSelect, optionDrag }) {
  const removable = dropdown.removable && optionDrag;
  return (
    <div className="menu-options" role="listbox" style={{ gridTemplateColumns: `repeat(${dropdown.columns ?? 2}, minmax(0, 1fr))` }}>
      {dropdown.options.map((option) => (
        <button
          key={option.id}
          className={[
            'menu-option',
            option.selected && 'selected',
            removable && 'removable',
            removable && optionDrag.drag?.id === option.id && 'dragging',
          ]
            .filter(Boolean)
            .join(' ')}
          role="option"
          aria-selected={option.selected}
          aria-disabled={option.disabled || undefined}
          disabled={option.disabled}
          title={option.title ?? (removable ? 'Click to load; drag out of the panel to delete' : undefined)}
          onClick={() => (!removable || !optionDrag.wasDrag()) && onSelect(option.id)}
          {...(removable ? optionDrag.handlers(option) : {})}
        >
          {option.icon && <Icon name={option.icon} />}
          <span className="option-label">{option.label}</span>
          {option.selected && dropdown.checks !== false && <Icon name="check" />}
        </button>
      ))}
    </div>
  );
}

/** One row of buttons: a single button, or several in equal columns (see menuBlocks). */
function MenuRow({ row, onSelect, onName, queue, optionDrag }) {
  const open = row.find((item) => item.dropdown?.open);
  const buttons = row.map((item) => <MenuButton key={item.id} item={item} onSelect={onSelect} onName={onName} queue={queue} />);
  return (
    <>
      {row[0].row == null ? (
        buttons
      ) : (
        <div className="menu-row" style={{ gridTemplateColumns: rowSpans(row).map((span) => `minmax(0, ${span}fr)`).join(' ') }}>
          {buttons}
        </div>
      )}
      {open && <MenuOptions dropdown={open.dropdown} onSelect={onSelect} optionDrag={optionDrag} />}
    </>
  );
}

/** A label's stand-in in the sizer: as wide as its button would be. */
function SizerButton({ text, compact, icon = true, small, trailing = true }) {
  return compact ? (
    <div className="menu-btn compact">
      <span className="option-label">{text}</span>
    </div>
  ) : (
    <div className={`menu-btn${small ? ' small' : ''}`}>
      {icon && <Icon name="instrument" />}
      <Label text={text} />
      {trailing && <Icon name="dropdown" />}
    </div>
  );
}

function MenuButtons({ items, labels, onSelect, onQueueEdit, onName, onRemoveOption }) {
  const queue = useQueueDrag(onQueueEdit);
  const { drag } = queue;
  const optionDrag = useOptionDrag(onRemoveOption);
  return (
    <div className="menu-items">
      {menuBlocks(items).map((block, b) => {
        const rows = block.rows.map((row) => (
          <MenuRow key={row[0].id} row={row} onSelect={onSelect} onName={onName} queue={queue} optionDrag={optionDrag} />
        ));
        const content = block.group ? (
          <div key={`group-${block.group}`} className="menu-group" data-group={block.group}>
            {rows}
          </div>
        ) : (
          <Fragment key={`block-${b}`}>{rows}</Fragment>
        );
        // an open section's buttons, set in beneath its header like a dropdown's choices, a step for each section
        return block.indent ? (
          <div key={`indent-${b}`} className="menu-indent" style={{ marginLeft: INDENT * block.indent }}>
            {content}
          </div>
        ) : (
          content
        );
      })}
      {/* the dragged chord, following the pointer; red where letting go removes it */}
      {drag && (
        <div className={`queue-ghost${drag.outside ? ' outside' : ''}`} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {drag.outside ? `Remove ${drag.label}` : drag.label}
        </div>
      )}
      {/* ...and a dragged saved progression, red where letting go deletes it */}
      {optionDrag.drag && (
        <div className={`queue-ghost${optionDrag.drag.outside ? ' outside' : ''}`} style={{ left: optionDrag.drag.x, top: optionDrag.drag.y }} aria-hidden="true">
          {optionDrag.drag.outside ? `Delete ${optionDrag.drag.label}` : optionDrag.drag.label}
        </div>
      )}
      {/* invisible, zero-height copies of every possible label (and row of them): they set the panel's width */}
      <MenuSizer labels={labels} />
    </div>
  );
}

/**
 * Invisible, zero-height copies of every possible label (and row of them),
 * which set the panel's width. There are thousands, and they never change, so
 * a menu update doesn't re-render them.
 */
const MenuSizer = memo(function MenuSizer({ labels }) {
  return (
    <div className="menu-sizer" aria-hidden="true">
      {labels.map((entry) => {
        if (typeof entry === 'string') return <SizerButton key={entry} text={entry} />;
        // each column its shares: under max-content sizing, the grid makes every share as wide as the neediest column's
        const row = (
          <div className="menu-row sizer-row" style={{ gridTemplateColumns: entry.row.map(({ span }) => `${span}fr`).join(' ') }}>
            {entry.row.map(({ text, icon, trailing }, i) => (
              <SizerButton key={i} text={text} compact={entry.compact} icon={icon} small={entry.small} trailing={trailing} />
            ))}
          </div>
        );
        const key = JSON.stringify(entry);
        const framed = entry.group ? <div className="menu-group">{row}</div> : row;
        return entry.indent ? (
          <div key={key} className="menu-indent" style={{ marginLeft: INDENT * entry.indent }}>
            {framed}
          </div>
        ) : (
          <Fragment key={key}>{framed}</Fragment>
        );
      })}
    </div>
  );
});

/**
 * The menu on the screen, in front of whatever view is showing: the windowed
 * panel, or in XR: Phone AR the same panel over the camera. A touch on it
 * belongs to it, not to the AR session (no XR select), and `pressing` says
 * a finger is on it, so gaze play doesn't take it for one held on the view.
 */
function ScreenMenu({ menu, notes, pressing }) {
  const layer = useRef(null);
  useEffect(() => {
    const el = layer.current;
    const swallow = (e) => e.preventDefault();
    const up = () => (pressing.current = false);
    el.addEventListener('beforexrselect', swallow);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('beforexrselect', swallow);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [pressing]);
  return (
    <div ref={layer} onPointerDown={() => (pressing.current = true)}>
      <Hud menu={menu} notes={notes} />
    </div>
  );
}

const HUD_MIN = { width: 220, height: 120 }; // px: the smallest the panel can be dragged to
const HUD_MARGIN = 12; // px kept clear between the panel and the window's right and bottom edges
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

/**
 * The windowed panel: draws the shared menu model (see XRMenuPanel for XR).
 * Its corner grip resizes it (double-click fits it to its buttons again);
 * the size holds while it's closed and opened again.
 */
function Hud({ menu, notes }) {
  const panel = useRef(null);
  const [size, setSize] = useState(null); // { width, height } in px, or null to fit the buttons
  const startResize = (e) => {
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const box = panel.current.getBoundingClientRect();
    const from = { x: e.clientX, y: e.clientY };
    const onMove = (m) =>
      setSize({
        width: clamp(box.width + m.clientX - from.x, HUD_MIN.width, window.innerWidth - box.left - HUD_MARGIN),
        height: clamp(box.height + m.clientY - from.y, HUD_MIN.height, window.innerHeight - box.top - HUD_MARGIN),
      });
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  };
  // the gear, top left, opens and closes the panel; closed, the panel holds just the gear
  const gear = (
    <button
      className="collapse"
      onClick={() => menu.onSelect(MENU_TOGGLE)}
      aria-label={menu.open ? 'Hide options' : 'Show options'}
      aria-expanded={menu.open}
      title="Options"
    >
      <Icon name="gear" />
    </button>
  );
  if (!menu.open) {
    return (
      <aside className="hud collapsed">
        <header>{gear}</header>
      </aside>
    );
  }
  return (
    <aside className="hud" ref={panel} style={size ? { width: size.width, height: size.height } : undefined}>
      <header>
        {gear}
        <h1>{menu.title}</h1>
      </header>

      <div className="hud-body">
        {menu.status && <p className="stats">{menu.status}</p>}
        <MenuButtons items={menu.items} labels={menu.labels} onSelect={menu.onSelect} onQueueEdit={menu.onQueueEdit} onName={menu.onName} onRemoveOption={menu.onRemoveOption} />
        {notes.map(({ text, error }) => (
          <p key={text} className={error ? 'note error' : 'note'} role={error ? 'alert' : undefined}>
            {text}
          </p>
        ))}
      </div>
      <div className="hud-resize" onPointerDown={startResize} onDoubleClick={() => setSize(null)} title="Drag to resize (double-click: reset)" />
    </aside>
  );
}

export default function App() {
  const [state, actions, { effectAmounts, slideEffect }] = useMusicState();
  const player = useProgression(state.progression, state.bpm, state.beatsPerMeasure);
  useKeyboard(actions, player);
  // the playing (or paused) chord's notes, raised on the Fretboard; stopped, the key's triad is
  const currentChord = player.index != null ? state.progression[player.index] : null;
  // a chord chosen on the ChordFrame is raised instead, until the progression moves on or the key or scale changes
  const chart = useMemo(() => keyChordChart(state.key, state.scale), [state.key, state.scale]);
  const [chosenChord, setChosenChord] = useState(null);
  useEffect(() => setChosenChord(null), [player.index, player.measure, state.key, state.scale]);
  const raisedChord = chosenChord ?? currentChord;
  // ...on the ChordFrame too, where with neither it's the I chord, the key's triad the Fretboard raises then
  const shownChord = raisedChord ?? (state.scale.chord.length ? chart.find((row) => row.step === 0)?.triad : null) ?? null;
  const chordTones = useMemo(() => raisedChord && chordPitchClasses(raisedChord), [raisedChord]);
  const latestSelect = useRef({});
  latestSelect.current = { mode: state.playOnSelect, instrument: state.instrument };
  const chooseChord = useCallback((chord) => {
    setChosenChord(chord);
    playSelected(chord, latestSelect.current.mode, latestSelect.current.instrument);
  }, []);
  useDegreeKeys(chart, state.scale, chooseChord);
  // with Play on Select, the progression plays each chord (or its root) as it lands on it, at the top of its measure
  const strum = useRef({});
  strum.current = { chord: currentChord, instrument: state.instrument, mode: state.playOnSelect };
  useEffect(() => {
    const { chord, instrument, mode } = strum.current;
    if (player.playing && player.beat === 0) playSelected(chord, mode, instrument);
  }, [player.playing, player.measure, player.beat]);
  useAudioUnlock();
  const sample = useInstrument(state.instrument);
  useEffect(() => {
    for (const [id, on] of Object.entries(state.effects)) setEffectOn(id, on);
  }, [state.effects]);
  // a FilterFrame switch pressed: an effect's switches it in or out; Reset puts every effect back as it started, switched out
  const pressEffectSwitch = useCallback(
    (id) => {
      if (id !== RESET_EFFECTS) return actions.toggleEffect(id);
      for (const { id: effect, amount } of EFFECTS) slideEffect(effect, amount);
      actions.clearEffects();
    },
    [actions, slideEffect],
  );
  // the beat (for the echo and quantizing) and how finely notes are quantized
  useEffect(() => setBeatGrid({ beat: 60 / state.bpm, division: state.quantize }), [state.bpm, state.quantize]);
  const cells = useMemo(() => buildCells(state.tuning, state.key, state.scale), [state.tuning, state.key, state.scale]);

  const support = useXRSupport();
  const sessionActive = useSyncExternalStore(store.subscribe, getSessionActive);
  const sessionMode = useSyncExternalStore(store.subscribe, getSessionMode);
  const xrSupported = Boolean(support.vr || support.ar);
  const phone = useMemo(isPhone, []);
  const headset = useMemo(isHeadsetBrowser, []);
  const passthroughAvailable = Boolean(support.ar) || phone;
  const [screenView, setScreenView] = useState('normal'); // outside XR: 'normal' | 'sbs' | 'interlaced'
  const [phoneStereo, setPhoneStereo] = useState(true); // phone XR: two lens-corrected eyes
  const [handheld, setHandheld] = useState(false); // the motion-sensor view is showing (phones without AR)
  const holding = useRef(false); // a finger held on the motion-sensor view's screen
  const menuPressed = useRef(false); // a finger on the screen's menu (see ScreenMenu)
  // the last instrument an XR controller chose, for it alone: { hand, instrument, at } (see Scene.jsx)
  const [instrumentChoice, setInstrumentChoice] = useState(null);
  // Analyze: { status: 'idle' | 'recording' | 'recorded' | 'analyzing' | 'done' | 'error', seconds (while recording),
  // recordedSeconds (the recording kept), result, error } (see menu.js); the recording itself, kept for Analyze
  const [analysis, setAnalysis] = useState({ status: 'idle' });
  const recorded = useRef(null);
  const recordingSince = useRef(0);
  useEffect(() => {
    if (analysis.status !== 'recording') return;
    const tick = setInterval(() => setAnalysis((a) => ({ ...a, seconds: (performance.now() - recordingSince.current) / 1000 })), 250);
    return () => clearInterval(tick);
  }, [analysis.status]);
  /** Stop: the recording kept, for Analyze. */
  const finishRecording = () => {
    const take = stopRecording();
    if (!take) return;
    recorded.current = take;
    setAnalysis({ status: 'recorded', recordedSeconds: take.samples.length / take.sampleRate });
  };
  const finishLatest = useRef(finishRecording);
  finishLatest.current = finishRecording;
  /** Record / Stop. A new recording replaces the last, and what was found in it. */
  const toggleRecording = async () => {
    if (analysis.status === 'recording') return finishRecording();
    if (analysis.status === 'analyzing') return;
    try {
      await startRecording({ onLimit: () => finishLatest.current() });
      recorded.current = null;
      recordingSince.current = performance.now();
      setAnalysis({ status: 'recording', seconds: 0 });
    } catch (e) {
      // inside a headset's session the browser may not be able to ask
      const error = sessionActive && /refused/.test(e.message) ? 'Allow the microphone outside XR first' : e.message;
      setAnalysis((a) => ({ status: 'error', error, recordedSeconds: a.recordedSeconds }));
    }
  };
  /** Analyze: the kept recording worked out, once "Analyzing…" has had a frame to show. */
  const analyzeRecording = () => {
    const take = recorded.current;
    if (!take || analysis.status === 'recording' || analysis.status === 'analyzing') return;
    const recordedSeconds = take.samples.length / take.sampleRate;
    setAnalysis({ status: 'analyzing', recordedSeconds });
    setTimeout(() => {
      const result = analyze(take.samples, take.sampleRate);
      setAnalysis(result.error ? { status: 'error', error: result.error, recordedSeconds } : { status: 'done', result, recordedSeconds });
    }, 50);
  };
  const inXR = sessionActive || handheld;
  // derived from the session, so the panel can never disagree with what is showing
  const view = inXR ? (phone ? (phoneStereo ? 'phoneViewer' : 'phoneAR') : 'xr') : screenView;
  // XR: Phone AR shows the page's own menu in front of the scene, rather than a panel in it: over the
  // motion-sensor view, or in an AR session's DOM overlay (without one, the panel in the scene it is)
  const screenMenu = view === 'phoneAR' && (!sessionActive || store.getState().session?.domOverlayState != null);
  const [error, setError] = useState(null);

  // into an XR view, straight from the tap
  const enterXR = async (stereo) => {
    setError(null);
    let label = 'AR';
    try {
      if (phone && support.ar) await enterPhoneAR();
      else if (phone) {
        enterCardboard({ landscape: stereo }).then((sensors) => {
          if (!sensors) console.warn('[xr-music] motion sensor access denied; the view will not follow the phone');
        });
        setHandheld(true);
      } else if (support.ar) await store.enterAR();
      else {
        label = 'VR';
        await store.enterVR();
      }
    } catch (e) {
      console.error(`[xr-music] could not start ${label}`, e);
      setError(`Couldn't start ${label}: ${describe(e)}`);
    }
  };
  // out of XR
  const exitXR = () => {
    if (handheld) {
      exitCardboard();
      setHandheld(false);
    }
    store.getState().session?.end();
  };

  // the motion-sensor view: stereo wants landscape, mono can be held either way
  useEffect(() => {
    if (!handheld) return;
    if (phoneStereo) screen.orientation?.lock?.('landscape').catch(() => {});
    else screen.orientation?.unlock?.();
  }, [handheld, phoneStereo]);
  // leaving fullscreen (back gesture, Esc) also leaves the motion-sensor view
  useEffect(() => {
    if (!handheld) return;
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setHandheld(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [handheld]);

  /**
   * A menu choice. `source.hand` is the XR controller that made it, if one did:
   * an instrument chosen so is that controller's alone (see Scene.jsx).
   */
  const onSelect = (id, source = {}) => {
    if (id === MENU_TOGGLE) actions.toggleMenu();
    else if (id.startsWith(SECTION_PREFIX)) actions.toggleSection(id.slice(SECTION_PREFIX.length));
    else if (id.startsWith(PICK_PREFIX)) {
      const [dropdownId, index] = id.slice(PICK_PREFIX.length).split(':');
      const choice = dropdownChoices(env, state)[dropdownId]?.[Number(index)];
      if (choice == null) return; // not a choice, or one this device can't have
      if (dropdownId === 'view') {
        actions.closeDropdown();
        selectView(choice);
      } else if (dropdownId === 'stock') {
        // playing, it carries on with the new progression from its start; otherwise it's stopped
        if (player.playing) player.select(0);
        else player.stop();
        actions.applyStock(choice, state.key);
      } else if (dropdownId === 'load') {
        // as for a stock progression
        if (player.playing) player.select(0);
        else player.stop();
        actions.loadProgression(choice);
      } else {
        actions.pick(dropdownId, choice);
        if (dropdownId === 'instrument' && sessionActive && (source.hand === 'left' || source.hand === 'right'))
          setInstrumentChoice({ hand: source.hand, instrument: choice, at: performance.now() });
      }
    } else if (DROPDOWNS.includes(id)) actions.toggleDropdown(id);
    else if (id === 'velocity') actions.toggleVelocity();
    else if (id === 'play') player.toggle();
    else if (id.startsWith(CHORD_PREFIX)) {
      const index = Number(id.slice(CHORD_PREFIX.length));
      player.select(index);
      // playing, the progression plays it as it lands there (see above)
      if (!player.playing) playSelected(state.progression[index], state.playOnSelect, state.instrument);
    }
    else if (id === 'stop') player.stop();
    else if (id === 'record') toggleRecording();
    else if (id === 'analyze') analyzeRecording();
    else if (id === 'applyAnalysis' && analysis.result) {
      player.stop();
      actions.applyAnalysis(analysis.result);
    }
    else if (id === 'addChord') actions.addChord(builtChord(state.draft, state.key));
    else if (id === 'clearProgression') actions.clearProgression();
    else if (id === 'saveProgression') {
      // a controller in XR has no keyboard to name it with: it's saved under the next free "Progression N"
      const names = new Set(state.savedProgressions.map((p) => p.name));
      let n = state.savedProgressions.length + 1;
      while (names.has(`Progression ${n}`)) n++;
      if ('hand' in source) actions.saveProgression(`Progression ${n}`);
      else actions.startNaming(`Progression ${n}`);
    } else if (id === 'confirmSave' && state.naming?.trim()) actions.saveProgression(state.naming);
    else if (id === 'cancelSave') actions.cancelNaming();
  };
  /** A queued chord dragged to a new place ({ type: 'move', from, to }) or removed ({ type: 'remove', index }). */
  const onQueueEdit = (edit) => {
    if (edit.type === 'move') actions.moveChordTo(edit.from, edit.to);
    else if (edit.type === 'remove') actions.removeChord(edit.index);
  };
  const selectView = (next) => {
    const toXR = XR_VIEWS.includes(next);
    if (toXR) setPhoneStereo(next === 'phoneViewer');
    if (toXR && !inXR) {
      // if the session fails to start, the panel carries on from Normal
      setScreenView('normal');
      enterXR(next === 'phoneViewer');
    } else if (!toXR) {
      if (inXR) exitXR();
      setScreenView(next);
    }
  };

  // which XR path is running, shown on the panels
  const status = !inXR
    ? null
    : handheld
      ? `XR: motion sensors only (no walking), ${phoneStereo ? 'stereo' : 'mono'}`
      : phone
        ? `XR: phone AR, tracked, ${phoneStereo ? 'stereo' : 'mono'}`
        : `XR: headset ${sessionMode === 'immersive-ar' ? 'AR' : 'VR'}`;
  const env = { xrSupported, passthroughAvailable, checking: !support.checked, phone, headset };
  const labels = useMemo(() => possibleLabels({ xrSupported, passthroughAvailable, phone, headset }), [xrSupported, passthroughAvailable, phone, headset]);
  const menu = {
    title: MENU_TITLE,
    rows: MENU_ROWS,
    labels,
    status,
    open: state.menuOpen,
    items: menuItems({ ...state, view, player, analysis }, env),
    onSelect,
    onQueueEdit,
    onName: actions.nameProgression,
    // a saved progression dragged out of Load's list ("pick:load:<index>")
    onRemoveOption: (id) => {
      const [dropdownId, index] = id.slice(PICK_PREFIX.length).split(':');
      if (dropdownId === 'load') actions.deleteSavedProgression(Number(index));
    },
  };
  const notes = [
    state.saveError && { text: state.saveError, error: true },
    sample === 'error' && { text: `Couldn't load ${state.instrument}.`, error: true },
    error && { text: error, error: true },
  ].filter(Boolean);

  return (
    <>
      <Canvas flat dpr={[1, 2]} events={sideBySideEvents} camera={{ position: [-0.5, 1.4, 2.4], fov: 50, near: 0.05, far: 200 }}>
        <XR store={store}>
          <Scene
            cells={cells}
            chord={chordTones}
            chart={chart}
            selectedChord={shownChord}
            onChord={chooseChord}
            effectAmounts={effectAmounts}
            onEffectSlide={slideEffect}
            onEffectSwitch={pressEffectSwitch}
            state={{ ...state, view, stereo: phoneStereo, handheld, passthrough: state.background === 'passthrough' }}
            menu={menu}
            onExitXR={() => selectView('normal')}
            phone={phone}
            holding={holding}
            menuPressed={menuPressed}
            instrumentChoice={instrumentChoice}
            screenMenu={screenMenu}
          />
        </XR>
      </Canvas>
      {handheld && <CardboardOverlay split={phoneStereo} onHold={(held) => (holding.current = held)} onExit={exitXR} />}
      {/* the menu on the screen: windowed, or over XR: Phone AR (in the AR session's DOM overlay, or over the motion-sensor view) */}
      {/* (the windowed 3D views draw it in the scene instead, for both eyes: see Scene.jsx) */}
      {((!inXR && view !== 'sbs' && view !== 'interlaced') || screenMenu) &&
        (sessionActive
          ? createPortal(<ScreenMenu menu={menu} notes={notes} pressing={menuPressed} />, store.getState().domOverlayRoot)
          : <ScreenMenu menu={menu} notes={notes} pressing={menuPressed} />)}
    </>
  );
}
