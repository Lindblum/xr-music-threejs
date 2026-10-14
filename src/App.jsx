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
import { INSTRUMENTS, loadInstrument, setEcho, unlockAudio } from './audio.js';
import { SCALES, TUNINGS } from './music.js';
import {
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

const describe = (e) => `${e?.name ?? 'Error'}${e?.message ? ` - ${e.message}` : ''}`;

function useMusicState() {
  const [instrument, setInstrument] = useState(INSTRUMENTS[0]);
  const [scale, setScale] = useState(SCALES[0]);
  const [key, setKey] = useState(0); // C
  const [tuning, setTuning] = useState(TUNINGS[0]);
  const [echo, setEchoOn] = useState(false);
  const [background, setBackground] = useState('skybox'); // 'solid' | 'skybox' | 'passthrough'
  const [menuOpen, setMenuOpen] = useState(true); // shared by the windowed and XR panels
  const [page, setPage] = useState('main'); // the submenu showing, see menu.js
  const [dropdown, setDropdown] = useState(null); // the dropdown whose list is open

  const actions = useMemo(
    () => ({
      nextInstrument: (step = 1) => setInstrument((i) => cycle(INSTRUMENTS, i, step)),
      nextScale: (step = 1) => setScale((s) => cycle(SCALES, s, step)),
      nextKey: (step = 1) => setKey((k) => (k + step + 12) % 12),
      nextTuning: (step = 1) => setTuning((t) => cycle(TUNINGS, t, step)),
      toggleEcho: () => setEchoOn((v) => !v),
      toggleMenu: () => setMenuOpen((v) => !v),
      setPage: (p) => {
        setPage(p);
        setDropdown(null);
      },
      toggleDropdown: (id) => setDropdown((d) => (d === id ? null : id)),
      closeDropdown: () => setDropdown(null),
      /** A choice from a dropdown's list (see dropdownChoices), which then closes. */
      pick: (id, choice) => {
        ({ instrument: setInstrument, scale: setScale, key: setKey, tuning: setTuning, background: setBackground })[id](choice);
        setDropdown(null);
      },
    }),
    [],
  );
  const state = { instrument, scale, key, tuning, echo, background, menuOpen, page, dropdown };
  return [state, actions];
}

function useKeyboard(actions) {
  useEffect(() => {
    const keymap = {
      KeyI: actions.nextInstrument,
      KeyS: actions.nextScale,
      KeyK: actions.nextKey,
      KeyT: actions.nextTuning,
      KeyE: actions.toggleEcho,
      Enter: actions.toggleMenu,
      NumpadEnter: actions.toggleMenu,
      Escape: actions.toggleMenu,
    };
    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, select, textarea')) return;
      const action = keymap[e.code];
      if (!action) return;
      e.preventDefault();
      action(e.shiftKey ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);
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

function MenuButtons({ items, labels, onSelect }) {
  return (
    <div className="menu-items">
      {items.map((item) => {
        const trailing = trailingIcon(item);
        return (
          <Fragment key={item.id}>
            <button
              className="menu-btn"
              disabled={item.disabled}
              title={item.title}
              aria-expanded={item.dropdown ? item.dropdown.open : undefined}
              onClick={() => onSelect(item.id)}
            >
              <Icon name={item.icon} />
              <Label text={item.label} />
              {trailing && <Icon name={trailing} />}
            </button>
            {item.dropdown?.open && (
              <div className="menu-options" role="listbox">
                {item.dropdown.options.map((option) => (
                  <button
                    key={option.id}
                    className={`menu-option${option.selected ? ' selected' : ''}`}
                    role="option"
                    aria-selected={option.selected}
                    onClick={() => onSelect(option.id)}
                  >
                    {option.icon && <Icon name={option.icon} />}
                    <span className="option-label">{option.label}</span>
                    {option.selected && <Icon name="check" />}
                  </button>
                ))}
              </div>
            )}
          </Fragment>
        );
      })}
      {/* invisible, zero-height copies of every possible label: they set the panel's width */}
      <div className="menu-sizer" aria-hidden="true">
        {labels.map((label) => (
          <div key={label} className="menu-btn">
            <Icon name="instrument" />
            <Label text={label} />
            <Icon name="dropdown" />
          </div>
        ))}
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
        <MenuButtons items={menu.items} labels={menu.labels} onSelect={menu.onSelect} />
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
  useKeyboard(actions);
  useAudioUnlock();
  const sample = useInstrument(state.instrument);
  useEffect(() => setEcho(state.echo), [state.echo]);
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
      const choice = dropdownChoices(env)[dropdownId]?.[Number(index)];
      if (choice === undefined) return;
      if (dropdownId === 'view') {
        actions.closeDropdown();
        selectView(choice);
      } else actions.pick(dropdownId, choice);
    } else if (DROPDOWNS.includes(id)) actions.toggleDropdown(id);
    else if (id === 'echo') actions.toggleEcho();
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
    items: menuItems({ ...state, view }, env),
    onSelect,
  };
  const notes = [
    sample === 'error' && { text: `Couldn't load ${state.instrument}.`, error: true },
    error && { text: error, error: true },
  ].filter(Boolean);

  return (
    <>
      <Canvas flat shadows="percentage" dpr={[1, 2]} events={sideBySideEvents} camera={{ position: [-0.5, 1.4, 2.4], fov: 50, near: 0.05, far: 200 }}>
        <XR store={store}>
          <Scene
            cells={cells}
            state={{ ...state, view, stereo: phoneStereo, handheld, passthrough: state.background === 'passthrough' }}
            menu={menu}
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
