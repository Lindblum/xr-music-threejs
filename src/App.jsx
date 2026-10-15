import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas } from '@react-three/fiber';
import { XR, createXRStore, useXRSessionModeSupported } from '@react-three/xr';
import Scene from './Scene.jsx';
import { sideBySideEvents } from './SideBySide.jsx';
import Icon from './Icon.jsx';
import { MENU_TOGGLE } from './XRMenuPanel.jsx';
import { PHONE_AR_SESSION_INIT } from './PhoneStereo.jsx';
import { CardboardOverlay, canUseCardboard, enterCardboard, exitCardboard } from './Cardboard.jsx';
import { buildCells } from './Fretboard.jsx';
import { INSTRUMENTS, loadInstrument, playChord, setBeatGrid, setEcho, unlockAudio } from './audio.js';
import { SCALES, TUNINGS, builtChord, chordNotes, chordPitchClasses, mod12, stockChords } from './music.js';
import { useProgression } from './progression.js';
import { loadSettings, saveSettings } from './settings.js';
import {
  CHORD_PREFIX,
  DROPDOWNS,
  XR_VIEWS,
  MENU_ROWS,
  availableViews,
  PAGE_PREFIX,
  PICK_PREFIX,
  cycle,
  menuItems,
  menuTitle,
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

/** The phone AR session: the library's defaults plus raw camera access, for passthrough in stereo. */
function enterPhoneAR() {
  xrOptions.customSessionInit = PHONE_AR_SESSION_INIT;
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

const describe = (e) => `${e?.name ?? 'Error'}${e?.message ? ` - ${e.message}` : ''}`;

function useMusicState() {
  // the music settings and progression start as they were left (see settings.js)
  const [saved] = useState(loadSettings);
  const [instrument, setInstrument] = useState(saved.instrument);
  const [scale, setScale] = useState(saved.scale);
  const [key, setKey] = useState(saved.key);
  const [tuning, setTuning] = useState(saved.tuning);
  const [echo, setEchoOn] = useState(saved.echo);
  const [quantize, setQuantize] = useState(saved.quantize); // steps per beat notes wait for (0: off)
  const [velocity, setVelocity] = useState(saved.velocity); // notes as loud as they're struck hard
  const [playOnSelect, setPlayOnSelect] = useState(saved.playOnSelect); // played on selecting a chord: 'off' | 'root' | 'chord'
  const [background, setBackground] = useState('skybox'); // 'solid' | 'skybox' | 'passthrough'
  const [menuOpen, setMenuOpen] = useState(true); // shared by the windowed and XR panels
  const [page, setPage] = useState('main'); // the submenu showing, see menu.js
  const [dropdown, setDropdown] = useState(null); // the dropdown whose list is open
  const [bpm, setBpm] = useState(saved.bpm);
  const [beatsPerMeasure, setBeatsPerMeasure] = useState(saved.beatsPerMeasure);
  const [progression, setProgression] = useState(saved.progression); // chords: { root, type, modifier }, see music.js
  const [draft, setDraft] = useState(saved.draft); // the chord Add Chord adds: { degree, alteration, type, modifier }, see music.js
  // a new key moves the progression with it: every chord's root by the same interval
  const keyWas = useRef(key);
  useEffect(() => {
    const interval = key - keyWas.current;
    keyWas.current = key;
    if (interval) setProgression((p) => p.map((chord) => ({ ...chord, root: mod12(chord.root + interval) })));
  }, [key]);
  useEffect(
    () => saveSettings({ instrument, scale, key, tuning, echo, quantize, velocity, playOnSelect, bpm, beatsPerMeasure, progression, draft }),
    [instrument, scale, key, tuning, echo, quantize, velocity, playOnSelect, bpm, beatsPerMeasure, progression, draft],
  );

  const actions = useMemo(
    () => ({
      nextInstrument: (step = 1) => setInstrument((i) => cycle(INSTRUMENTS, i, step)),
      nextScale: (step = 1) => setScale((s) => cycle(SCALES, s, step)),
      nextKey: (step = 1) => setKey((k) => (k + step + 12) % 12),
      nextTuning: (step = 1) => setTuning((t) => cycle(TUNINGS, t, step)),
      toggleEcho: () => setEchoOn((v) => !v),
      toggleVelocity: () => setVelocity((v) => !v),
      toggleMenu: () => setMenuOpen((v) => !v),
      setPage: (p) => {
        setPage(p);
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
      /** Replaces the progression with a stock one in `key`, and switches to its scale. */
      applyStock: (stock, key) => {
        setProgression(stockChords(stock, key));
        setScale(SCALES.find((s) => s.id === stock.scale));
        setDropdown(null);
      },
      removeChord: (index) => setProgression((p) => p.filter((_, i) => i !== index)),
    }),
    [],
  );
  const state = { instrument, scale, key, tuning, echo, quantize, velocity, playOnSelect, background, menuOpen, page, dropdown, bpm, beatsPerMeasure, progression, draft };
  return [state, actions];
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

/** What a button's right edge shows: an arrow to a submenu, or a dropdown's chevron. */
function trailingIcon(item) {
  if (item.submenu) return 'forward';
  if (item.dropdown) return item.dropdown.open ? 'dropdownOpen' : 'dropdown';
  return null;
}

const DRAG_START = 6; // px the pointer moves before a press on a queued chord becomes a drag

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

function MenuButton({ item, onSelect, queue }) {
  const trailing = !item.compact && trailingIcon(item);
  const queued = item.queueIndex != null;
  const drag = queue?.drag;
  const className = [
    'menu-btn',
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
  return (
    <button
      className={className}
      disabled={item.disabled}
      title={queued ? 'Click to go to this chord; drag to reorder; drag out of the panel or double-click to remove' : item.title}
      aria-expanded={item.dropdown ? item.dropdown.open : undefined}
      aria-current={item.current || undefined}
      data-queue-index={queued ? item.queueIndex : undefined}
      style={item.current && item.color ? { background: item.color, borderColor: item.color } : undefined}
      onClick={() => (!queued || !queue?.wasDrag()) && onSelect(item.id)}
      {...(queued && queue ? queue.handlers(item) : {})}
    >
      {!item.compact && item.icon && <Icon name={item.icon} />}
      {item.compact ? <span className="option-label">{item.label}</span> : <Label text={item.label} />}
      {trailing && <Icon name={trailing} />}
    </button>
  );
}

/** An open dropdown's choices, `dropdown.columns` to a row beneath its button (or its row). */
function MenuOptions({ dropdown, onSelect }) {
  return (
    <div className="menu-options" role="listbox" style={{ gridTemplateColumns: `repeat(${dropdown.columns ?? 2}, minmax(0, 1fr))` }}>
      {dropdown.options.map((option) => (
        <button
          key={option.id}
          className={`menu-option${option.selected ? ' selected' : ''}`}
          role="option"
          aria-selected={option.selected}
          onClick={() => onSelect(option.id)}
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
function MenuRow({ row, onSelect, queue }) {
  const open = row.find((item) => item.dropdown?.open);
  const buttons = row.map((item) => <MenuButton key={item.id} item={item} onSelect={onSelect} queue={queue} />);
  return (
    <>
      {row[0].row == null ? (
        buttons
      ) : (
        <div className="menu-row" style={{ gridTemplateColumns: rowSpans(row).map((span) => `minmax(0, ${span}fr)`).join(' ') }}>
          {buttons}
        </div>
      )}
      {open && <MenuOptions dropdown={open.dropdown} onSelect={onSelect} />}
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

function MenuButtons({ items, labels, onSelect, onQueueEdit }) {
  const queue = useQueueDrag(onQueueEdit);
  const { drag } = queue;
  return (
    <div className="menu-items">
      {menuBlocks(items).map((block, b) => {
        const rows = block.rows.map((row) => <MenuRow key={row[0].id} row={row} onSelect={onSelect} queue={queue} />);
        return block.group ? (
          <div key={`group-${block.group}`} className="menu-group" data-group={block.group}>
            {rows}
          </div>
        ) : (
          <Fragment key={`block-${b}`}>{rows}</Fragment>
        );
      })}
      {/* the dragged chord, following the pointer; red where letting go removes it */}
      {drag && (
        <div className={`queue-ghost${drag.outside ? ' outside' : ''}`} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {drag.outside ? `Remove ${drag.label}` : drag.label}
        </div>
      )}
      {/* invisible, zero-height copies of every possible label (and row of them): they set the panel's width */}
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
          const key = JSON.stringify(entry.row);
          return entry.group ? (
            <div key={key} className="menu-group">
              {row}
            </div>
          ) : (
            <Fragment key={key}>{row}</Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** The windowed panel: draws the shared menu model (see XRMenuPanel for XR). */
function Hud({ menu, notes }) {
  const toggle = () => menu.onSelect(MENU_TOGGLE);
  if (!menu.open) {
    return (
      <button className="hud-gear" onClick={toggle} aria-label="Show options" title="Options">
        <Icon name="gear" />
      </button>
    );
  }
  return (
    <aside className="hud">
      <header>
        <button className="collapse" onClick={toggle} aria-label="Hide options">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 9l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1>{menu.title}</h1>
      </header>

      <div className="hud-body">
        {menu.status && <p className="stats">{menu.status}</p>}
        <MenuButtons items={menu.items} labels={menu.labels} onSelect={menu.onSelect} onQueueEdit={menu.onQueueEdit} />
        {notes.map(({ text, error }) => (
          <p key={text} className={error ? 'note error' : 'note'} role={error ? 'alert' : undefined}>
            {text}
          </p>
        ))}
      </div>
    </aside>
  );
}

export default function App() {
  const [state, actions] = useMusicState();
  const player = useProgression(state.progression, state.bpm, state.beatsPerMeasure);
  useKeyboard(actions, player);
  // the playing (or paused) chord's notes, raised on the Fretboard; stopped, the key's triad is
  const currentChord = player.index != null ? state.progression[player.index] : null;
  const chordTones = useMemo(() => currentChord && chordPitchClasses(currentChord), [currentChord]);
  // with Play on Select, the progression plays each chord (or its root) as it lands on it, at the top of its measure
  const strum = useRef({});
  strum.current = { chord: currentChord, instrument: state.instrument, mode: state.playOnSelect };
  useEffect(() => {
    const { chord, instrument, mode } = strum.current;
    if (player.playing && player.beat === 0) playSelected(chord, mode, instrument);
  }, [player.playing, player.measure, player.beat]);
  useAudioUnlock();
  const sample = useInstrument(state.instrument);
  useEffect(() => setEcho(state.echo), [state.echo]);
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
  const views = useMemo(() => availableViews({ phone, headset, xrSupported }), [phone, headset, xrSupported]);
  const [screenView, setScreenView] = useState('normal'); // outside XR: 'normal' | 'sbs' | 'interlaced'
  const [phoneStereo, setPhoneStereo] = useState(true); // phone XR: two lens-corrected eyes
  const [handheld, setHandheld] = useState(false); // the motion-sensor view is showing (phones without AR)
  const holding = useRef(false); // a finger held on the motion-sensor view's screen
  const inXR = sessionActive || handheld;
  // derived from the session, so the panel can never disagree with what is showing
  const view = inXR ? (phone ? (phoneStereo ? 'phoneViewer' : 'phoneAR') : 'xr') : screenView;
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

  const onSelect = (id) => {
    if (id === MENU_TOGGLE) actions.toggleMenu();
    else if (id.startsWith(PAGE_PREFIX)) actions.setPage(id.slice(PAGE_PREFIX.length));
    else if (id.startsWith(PICK_PREFIX)) {
      const [dropdownId, index] = id.slice(PICK_PREFIX.length).split(':');
      const choice = dropdownChoices(env, state)[dropdownId]?.[Number(index)];
      if (choice === undefined) return;
      if (dropdownId === 'view') {
        actions.closeDropdown();
        selectView(choice);
      } else if (dropdownId === 'stock') {
        player.stop();
        actions.applyStock(choice, state.key);
      } else actions.pick(dropdownId, choice);
    } else if (DROPDOWNS.includes(id)) actions.toggleDropdown(id);
    else if (id === 'echo') actions.toggleEcho();
    else if (id === 'velocity') actions.toggleVelocity();
    else if (id === 'play') player.toggle();
    else if (id.startsWith(CHORD_PREFIX)) {
      const index = Number(id.slice(CHORD_PREFIX.length));
      player.select(index);
      // playing, the progression plays it as it lands there (see above)
      if (!player.playing) playSelected(state.progression[index], state.playOnSelect, state.instrument);
    }
    else if (id === 'stop') player.stop();
    else if (id === 'addChord') actions.addChord(builtChord(state.draft, state.key));
    else if (id === 'clearProgression') actions.clearProgression();
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
  const env = { xrSupported, passthroughAvailable, checking: !support.checked, views };
  const labels = useMemo(() => possibleLabels({ xrSupported, passthroughAvailable, views }), [xrSupported, passthroughAvailable, views]);
  const menu = {
    title: menuTitle(state.page),
    rows: MENU_ROWS,
    labels,
    status,
    open: state.menuOpen,
    items: menuItems({ ...state, view, player }, env),
    onSelect,
    onQueueEdit,
  };
  const notes = [
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
            state={{ ...state, view, stereo: phoneStereo, handheld, passthrough: state.background === 'passthrough' }}
            menu={menu}
            onExitXR={() => selectView('normal')}
            phone={phone}
            holding={holding}
          />
        </XR>
      </Canvas>
      {handheld ? (
        <CardboardOverlay split={phoneStereo} onHold={(held) => (holding.current = held)} onExit={exitXR} />
      ) : (
        <Hud menu={menu} notes={notes} />
      )}
    </>
  );
}
