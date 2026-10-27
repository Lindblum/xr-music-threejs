import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import { XR, createXRStore, useXRSessionModeSupported } from '@react-three/xr';
import Scene from './Scene.jsx';
import { sideBySideEvents } from './SideBySide.jsx';
import { Hud, ViewPanel } from './Menu.jsx';
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
  SECTION_PREFIX,
  PICK_PREFIX,
  cycle,
  menuItems,
  MENU_TITLE,
  MENU_TOGGLE,
  dropdownChoices,
  possibleLabels,
  TEXT_SIZE,
  VIBRATION,
  XR_RESOLUTION,
  snapToStep,
  viewUnavailable,
} from './menu.js';
import { setVibration } from './Touch.jsx';

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
  const [textSize, setTextSize] = useState(saved.textSize); // Accessibility: the panels' text and icons, a multiplier
  const [vibration, setVibrationAmount] = useState(saved.vibration); // ...the controllers' haptics (see Touch.jsx)
  const [controllerGuide, setControllerGuide] = useState(saved.controllerGuide); // ...XR labels on the controllers' buttons
  const [xrResolution, setXrResolution] = useState(saved.xrResolution); // Video: the headset's framebuffer scale
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
  latest.current = { instrument, scale, key, tuning, quantize, effects, background, velocity, playOnSelect, bpm, beatsPerMeasure, progression, draft, savedProgressions, textSize, vibration, controllerGuide, xrResolution };
  const save = useCallback(() => saveSettings({ ...latest.current, effectAmounts: effectAmounts.current }), []);
  useEffect(save, [save, instrument, scale, key, tuning, quantize, effects, background, velocity, playOnSelect, bpm, beatsPerMeasure, progression, draft, textSize, vibration, controllerGuide, xrResolution]);
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
      toggleControllerGuide: () => setControllerGuide((v) => !v),
      /** Accessibility's sliders: Text Size and Vibration (see menu.js), each kept on its steps. */
      slide: (id, value) => {
        if (id === 'textSize') setTextSize(snapToStep(value, TEXT_SIZE));
        else if (id === 'vibration') setVibrationAmount(snapToStep(value, VIBRATION));
        else if (id === 'xrResolution') setXrResolution(snapToStep(value, XR_RESOLUTION));
      },
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
    textSize,
    vibration,
    controllerGuide,
    xrResolution,
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

/**
 * The menu on the screen, in front of whatever view is showing: the windowed
 * panel, or in XR: Phone AR the same panel over the camera. A touch on it
 * belongs to it, not to the AR session (no XR select), and `pressing` says
 * a finger is on it, so gaze play doesn't take it for one held on the view.
 */
function ScreenMenu({ menu, notes, pressing, viewToggle }) {
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
    <div ref={layer} className="hud-stack" onPointerDown={() => (pressing.current = true)}>
      <Hud menu={menu} notes={notes} />
      {viewToggle && <ViewPanel {...viewToggle} />}
    </div>
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
  // Accessibility: the page's panel takes Text Size from this (see styles.css), XR's from Scene; Vibration scales every pulse
  useEffect(() => document.documentElement.style.setProperty('--text-scale', String(state.textSize)), [state.textSize]);
  useEffect(() => {
    setVibration(state.vibration);
  }, [state.vibration]);
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
  // Video → XR Resolution: the store reads it as a session starts; the session's own is fixed from then
  const [xrResolutionActive, setXrResolutionActive] = useState(null);
  useEffect(() => {
    if (!sessionActive) xrOptions.frameBufferScaling = state.xrResolution;
  }, [sessionActive, state.xrResolution]);
  useEffect(() => setXrResolutionActive(sessionActive ? (xrOptions.frameBufferScaling ?? 1) : null), [sessionActive]);
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
      return true;
    } catch (e) {
      console.error(`[xr-music] could not start ${label}`, e);
      setError(`Couldn't start ${label}: ${describe(e)}`);
      return false;
    }
  };
  /**
   * XR Resolution let go at a value other than the session's: the session ends and a new one
   * starts at the new framebuffer size. If the browser wants a fresh tap for it, the next tap
   * anywhere goes back in.
   */
  const restartXR = async () => {
    const session = store.getState().session;
    if (!session || handheld || state.xrResolution === xrResolutionActive) return;
    xrOptions.frameBufferScaling = state.xrResolution;
    const ended = new Promise((resolve) => session.addEventListener('end', resolve, { once: true }));
    session.end();
    await ended;
    if (await enterXR(phoneStereo)) return;
    setError('XR Resolution changed: tap anywhere to go back into XR');
    window.addEventListener(
      'pointerdown',
      () => {
        setError(null);
        enterXR(phoneStereo);
      },
      { once: true, capture: true },
    );
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
    else if (id === 'controllerGuide') actions.toggleControllerGuide();
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
    labels,
    status,
    open: state.menuOpen,
    items: menuItems({ ...state, view, player, analysis, xrResolutionActive }, env),
    onSelect,
    // a slider let go: XR Resolution, changed in a session, restarts it at the new size
    onSlide: (id, value, done) => (done ? id === 'xrResolution' && restartXR() : actions.slide(id, value)),
    onQueueEdit,
    onName: actions.nameProgression,
    // a saved progression dragged out of Load's list ("pick:load:<index>")
    onRemoveOption: (id) => {
      const [dropdownId, index] = id.slice(PICK_PREFIX.length).split(':');
      if (dropdownId === 'load') actions.deleteSavedProgression(Number(index));
    },
  };
  // the View panel's button: back to the Normal view in XR, or into XR: Headset where a headset can be used
  const viewToggle = inXR
    ? { icon: 'monitor', label: 'Normal view', onClick: () => selectView('normal') }
    : !viewUnavailable('xr', env)
      ? { icon: 'vr', label: 'XR: Headset', onClick: () => selectView('xr') }
      : null;
  const notes = [
    state.saveError && { text: state.saveError, error: true },
    sample === 'error' && { text: `Couldn't load ${state.instrument}.`, error: true },
    error && { text: error, error: true },
  ].filter(Boolean);
  menu.notes = notes; // (the XR panel shows them too)

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
          ? createPortal(<ScreenMenu menu={menu} notes={notes} pressing={menuPressed} viewToggle={viewToggle} />, store.getState().domOverlayRoot)
          : <ScreenMenu menu={menu} notes={notes} pressing={menuPressed} viewToggle={viewToggle} />)}
    </>
  );
}
