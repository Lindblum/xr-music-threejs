import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { IfInSessionMode, XROrigin, useXR, useXRControllerLocomotion } from '@react-three/xr';
import * as THREE from 'three';
import { FRETS, Fretboard } from './Fretboard.jsx';
import { GazePlay, TouchPlay } from './Touch.jsx';
import { useControllerGrips } from './Grab.jsx';
import { Pick } from './Pick.jsx';
import { ChordFrame, FilterFrame, ToolFrame, chordFrameOffset, filterFrameOffsetY, toolFrameOffset } from './SideFrames.jsx';
import { XRMenuPanel, XRViewPanel } from './XRMenuPanel.jsx';
import { CSS_PX_M } from './DomPanel.jsx';
import { ControllerGuide } from './ControllerGuide.jsx';
import { EYE_SEPARATION, SideBySide } from './SideBySide.jsx';
import { Interlaced } from './Interlaced.jsx';
import { CameraBackground, CardboardRig } from './Cardboard.jsx';
import { GazeReticle } from './Gaze.jsx';
import { PhoneStereoCameraFeed, PhoneStereoXR } from './PhoneStereo.jsx';
import { SOLID_BACKGROUND } from './menu.js';
import { allNotesOff, noteOff, noteOn, setBend } from './audio.js';

// The Fretboard's centre: a metre above the floor and half a metre in front
// of the player, as in the old page.
const BOARD_POSITION = [0, 1, -0.5];
// The Fretboard and the side frames start at half their size; a grip in each hand scales them.
const START_SCALE = 0.5;
// The ChordFrame and ToolFrame start either side of it, each its own handle (see SideFrames.jsx).
const CHORD_FRAME_POSITION = [BOARD_POSITION[0] + chordFrameOffset(START_SCALE), BOARD_POSITION[1], BOARD_POSITION[2]];
const TOOL_FRAME_POSITION = [BOARD_POSITION[0] + toolFrameOffset(START_SCALE), BOARD_POSITION[1], BOARD_POSITION[2]];
// The FilterFrame starts centred below it, clear of its frame for however many strings it has.
const filterFramePosition = (strings) => [
  BOARD_POSITION[0],
  BOARD_POSITION[1] + filterFrameOffsetY(strings, START_SCALE, START_SCALE),
  BOARD_POSITION[2],
];
// The windowed view looks a little left of centre, so the board clears the panel.
export const ORBIT_TARGET = [-0.5, 1, -0.5];
// Without VR controllers (hand tracking, phones) the XR panel starts off to
// the player's left, turned toward them, and travels with the player. Constants, so a re-render never undoes a move.
const MENU_POSITION = [-0.78, 1.33, 0.22]; // its top-left corner
const MENU_ROTATION = [0, 0.9, 0];
const VIEW_POSITION = [-0.78, 0.66, 0.22]; // the View panel's, under it
/** The Controller Guide's grip label while it holds something other than a panel, pick or frame. */
const GRIP_HELD = { note: 'Let go to stop bending', knob: 'Let go of the knob' };
// a phone's stereo view is blurrier and smaller than a headset's: a bigger panel stays readable
const PHONE_STEREO_MENU_SCALE = 1.5;
// The first pick (XR: Headset only) starts docked on the right controller;
// more come from the ToolFrame (see Grab.jsx). Without controllers it waits
// in front of the player, a little right of centre and below the board's
// middle, clear of its raised notes, face on, tip down. Constants, so a
// re-render never undoes a move.
const PICK_POSITION = [0.3, 0.95, -0.05];
const PICK_ROTATION = [0, -0.3, 0.25];
// With VR controllers the panel starts docked on the left one, like a palette
// held in that hand, and the right controller's ray presses its buttons. A
// grip takes it to dock on either controller or the NeckFrame (see Grab.jsx).

// The windowed 3D views (SBS, Interlaced) draw the panel in the scene, as XR
// does, so each eye sees it: held before the camera at its top left, where
// the page's panel sits, this far away, a little nearer than the board, and
// as big on the screen as the page's panel (before SBS squeezes each eye to
// half width, as it does the whole scene, for the display to stretch back).
const STEREO_MENU_DISTANCE = 1.5; // metres
const STEREO_MENU_MARGIN = 12; // CSS px clear of the view's edges, as the page's panel
const _menuCorner = new THREE.Vector3();

/** The panel before the camera in a windowed 3D view, picked and scrolled by the mouse. */
function StereoMenu({ menu }) {
  const group = useRef(null);
  const controls = useThree((s) => s.controls);
  // the orbit controls leave the mouse to the panel while it's over it (a drag, the wheel)
  const setOrbiting = (on) => controls && (controls.enabled = on);
  useEffect(() => () => setOrbiting(true), [controls]);
  // after the orbit controls move the camera (priority -1), before the stereo view renders (1)
  useFrame(({ camera, size }) => {
    const g = group.current;
    const bounds = g?.userData.bounds;
    if (!bounds) return;
    camera.updateMatrixWorld();
    const halfH = STEREO_MENU_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfW = halfH * camera.aspect;
    const metresPerCssPx = (2 * halfH) / size.height; // at the panel's distance
    const margin = STEREO_MENU_MARGIN * metresPerCssPx;
    // shrunk to fit a small or narrow window: at most the view's height, or half its width
    const scale = Math.min(
      metresPerCssPx / CSS_PX_M, // (a CSS px of the panel as one of the page's)
      (2 * halfH - 2 * margin) / (bounds.top - bounds.bottom),
      (halfW - margin) / (bounds.right - bounds.left),
    );
    g.scale.setScalar(scale);
    // each eye sees it this far to one side of where it is (nearer than the stereo cameras' focus): kept on the screen in both
    const parallax = (EYE_SEPARATION / 2) * Math.max(0, 1 - STEREO_MENU_DISTANCE / camera.focus);
    g.position.copy(_menuCorner.set(-halfW + margin + parallax - bounds.left * scale, halfH - margin - bounds.top * scale, -STEREO_MENU_DISTANCE)).applyMatrix4(camera.matrixWorld);
    g.quaternion.copy(camera.quaternion);
  });
  return (
    <group onPointerOver={() => setOrbiting(false)} onPointerOut={() => setOrbiting(true)}>
      <XRMenuPanel menu={menu} overlay groupRef={group} />
    </group>
  );
}

/** Where the first pick is docked: nowhere yet, until controllers show up (see Grab.jsx). */
const firstPickDock = () => ({ to: null, placed: false, scale: 1 });

/** `object`'s pose, as props that put it back so. */
const poseOf = (object) => ({ position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray() });

/**
 * For an object drawn only in some views (XR, or not): `[setRef, props]`, a
 * ref that fills `ref` and remembers the object's pose when it goes, and the
 * props that put it back there when it's drawn again (`start` the first time),
 * so switching views moves nothing.
 */
function useKeptPose(ref, start) {
  const kept = useRef(null);
  const setRef = useCallback(
    (object) => {
      if (!object && ref.current) kept.current = poseOf(ref.current);
      ref.current = object;
    },
    [ref],
  );
  return [setRef, kept.current ?? start];
}

/** A dock on a hand (or the mouth), let go as a session ends: taken up again where it was when the next one finds controllers (see Grab.jsx). */
const suspendDock = (dock) => {
  if (dock.to === 'left' || dock.to === 'right' || dock.to === 'mouth') Object.assign(dock, { to: null, placed: false, rejoin: dock.to });
};

const SKY_URL = `${import.meta.env.BASE_URL}img/skybox.jpg`;

/** Renders `fallback` if a child throws, e.g. a texture that failed to download. */
class AssetBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.warn('[xr-music] asset failed to load, continuing without it:', error.message);
  }
  render() {
    return this.state.failed ? this.props.fallback ?? null : this.props.children;
  }
}

function Sky({ passthrough }) {
  const texture = useLoader(THREE.TextureLoader, SKY_URL);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  // passthrough only exists inside an AR session; elsewhere keep the sky
  const hidden = useXR((s) => passthrough && s.mode === 'immersive-ar');

  useEffect(() => {
    if (hidden) return;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    scene.background = texture;
    return () => {
      if (scene.background === texture) scene.background = null;
    };
  }, [texture, scene, gl, hidden]);

  return null;
}

const _eye = new THREE.Vector3();

/**
 * The solid colour as a sphere around the viewer. In an AR session three.js
 * clears to transparent whatever scene.background says (so passthrough shows),
 * so there the colour has to be drawn, like the skybox is.
 */
function SolidDome() {
  const dome = useRef(null);
  useFrame(({ camera }) => dome.current?.position.copy(camera.getWorldPosition(_eye)));
  return (
    <mesh ref={dome} renderOrder={-1000} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[100, 16, 8]} />
      <meshBasicMaterial color={SOLID_BACKGROUND} side={THREE.BackSide} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** Solid colour or the skybox; passthrough shows the skybox until an AR session hides it. */
function Backdrop({ background }) {
  const scene = useThree((s) => s.scene);
  const inAR = useXR((s) => s.mode === 'immersive-ar');
  const solid = background === 'solid';
  useEffect(() => {
    if (!solid || inAR) return;
    const color = new THREE.Color(SOLID_BACKGROUND);
    scene.background = color;
    return () => {
      if (scene.background === color) scene.background = null;
    };
  }, [solid, inAR, scene]);
  if (solid) return inAR ? <SolidDome /> : null;
  return (
    // own boundary so a slow or failed sky never holds back the Fretboard
    <AssetBoundary>
      <Suspense fallback={null}>
        <Sky passthrough={background === 'passthrough'} />
      </Suspense>
    </AssetBoundary>
  );
}

/** The old page's lighting, without its shadows: a soft hemisphere and an overhead sun. */
function Lights() {
  return (
    <>
      <hemisphereLight args={[0xbcbcbc, 0xa5a5a5, 3]} />
      <directionalLight position={[0, 6, 0]} intensity={3} />
    </>
  );
}

const _head = new THREE.Vector3();

/**
 * Left thumbstick moves, right thumbstick turns smoothly about the head
 * (not while that controller's grip holds something: see Grab.jsx).
 * The grip buttons, on a frame, move, turn and scale it, or
 * carry and dock the panel. An undocked panel travels with the player.
 */
const MENU_BUTTON = 7; // the left controller's menu button (xr-standard index on Quest 3 / Touch Plus)

/** The left controller's menu button, pressed, calls `onPress`. */
function useMenuButton(onPress) {
  const pressed = useRef(false);
  const latest = useRef(onPress);
  latest.current = onPress;
  useFrame((_, __, frame) => {
    const source = frame && [...frame.session.inputSources].find((s) => s.handedness === 'left' && s.gamepad);
    const down = Boolean(source?.gamepad.buttons[MENU_BUTTON]?.pressed);
    if (down && !pressed.current) latest.current?.();
    pressed.current = down;
  });
}

function Player({ origin, onExitXR, children, ...grips }) {
  useXRControllerLocomotion(
    (velocity, turn, delta, state) => {
      const o = origin.current;
      if (!o) return;
      // a stick whose grip holds something pushes and pulls that instead (see Grab.jsx)
      const busy = grips.handles.current.stickBusy ?? {};
      if (!busy.left) o.position.addScaledVector(velocity, delta);
      if (!turn || busy.right) return;
      // swing the origin around the head so turning doesn't move the viewer
      state.camera.getWorldPosition(_head);
      const dx = o.position.x - _head.x;
      const dz = o.position.z - _head.z;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      o.position.x = _head.x + dx * c + dz * s;
      o.position.z = _head.z - dx * s + dz * c;
      o.rotation.y += turn;
    },
    { speed: 1.5 },
    { type: 'smooth', speed: 1.5 },
  );
  useControllerGrips({ origin, ...grips });
  useMenuButton(onExitXR);
  return <XROrigin ref={origin}>{children}</XROrigin>;
}

/**
 * Which cubes are being touched, and by what: voice -> cell index, where a
 * voice is one source ('mouse', 'left', 'right', 'pick:<id>', 'gaze') on one cube
 * ('left:12'), so a source can sound several notes at once. `touch(source,
 * indices)` moves a source onto those cubes, sounding the new ones and
 * releasing the rest, and reports whether a new note was struck; `press(source,
 * index | null)` does it for one cube or none. `bend(index, semitones)` bends
 * every voice that has sounded that cube, ringing or held, and any that
 * strikes it while it's bent. With `velocitySensitive`, a struck note is as
 * loud as its velocity (0..1, passed to touch and press); otherwise full.
 * Each source plays `instrumentOf(source)`, or `instrument` if that says nothing.
 * Returns [touches, touch, press, bend].
 */
function useTouches(cells, instrument, velocitySensitive, instrumentOf) {
  const touches = useRef(new Map());
  const voicesOf = useRef(new Map()); // cell index -> the voices that have sounded it, for bending
  const bends = useRef(new Map()); // cell index -> semitones it is bent by
  const latest = useRef({ cells, instrument, velocitySensitive, instrumentOf });
  latest.current = { cells, instrument, velocitySensitive, instrumentOf };

  // a new board: let go of everything; still-touching hands strike again (a new instrument lets notes ring on)
  useEffect(() => {
    touches.current.clear();
    voicesOf.current.clear();
    bends.current.clear();
    allNotesOff();
  }, [cells]);

  const touch = useCallback((source, indices, velocity = 1) => {
    const map = touches.current;
    for (const [voice, index] of map) {
      if (!voice.startsWith(`${source}:`) || indices.includes(index)) continue;
      map.delete(voice);
      noteOff(voice);
    }
    let struck = false;
    for (const index of indices) {
      const voice = `${source}:${index}`;
      const cell = latest.current.cells[index];
      if (map.has(voice) || !cell) continue;
      map.set(voice, index);
      if (!voicesOf.current.has(index)) voicesOf.current.set(index, new Set());
      voicesOf.current.get(index).add(voice);
      setBend(voice, bends.current.get(index) ?? 0);
      const sound = latest.current.instrumentOf?.(source) ?? latest.current.instrument;
      noteOn(voice, cell.note, sound, latest.current.velocitySensitive ? velocity : 1);
      struck = true;
    }
    return struck;
  }, []);
  const press = useCallback((source, index, velocity) => touch(source, index == null ? [] : [index], velocity), [touch]);
  const bend = useCallback((index, semitones) => {
    if (semitones) bends.current.set(index, semitones);
    else bends.current.delete(index);
    for (const voice of voicesOf.current.get(index) ?? []) setBend(voice, semitones);
  }, []);
  return [touches, touch, press, bend];
}

/**
 * `chord`: the pitch classes the Fretboard raises (or null for the key's
 * triad); `chart` the key's chord chart for the ChordFrame, `selectedChord`
 * the chord raised, if it's on the chart, and `onChord(chord)` a chord chosen
 * there. `effectAmounts.current` is the FilterFrame's sliders (effect id ->
 * 0..1), set by `onEffectSlide(id, amount)`, and `onEffectSwitch(id)` presses a
 * switch there: an effect's, or RESET_EFFECTS.
 */
export default function Scene({
  cells,
  chord,
  chart,
  selectedChord,
  onChord,
  effectAmounts,
  onEffectSlide,
  onEffectSwitch,
  state,
  menu,
  phone,
  holding,
  menuPressed,
  screenMenu,
  instrumentChoice,
  onExitXR,
}) {
  const inSession = useXR((s) => s.mode === 'immersive-vr' || s.mode === 'immersive-ar');
  const inAR = useXR((s) => s.mode === 'immersive-ar');
  // a phone's AR session drawn as two lens-corrected eyes
  const phoneStereo = phone && inAR && state.stereo;
  // a phone has no controllers: it plays by gaze, and a 1-second stare clicks the panel
  const hasControllers = useXR((s) => s.inputSourceStates.some((input) => input.type === 'controller'));
  const immersive = inSession || state.handheld;
  // the motion-sensor view has no AR session: passthrough is the rear camera
  const cameraPassthrough = state.handheld && state.passthrough;
  const [cameraFailed, setCameraFailed] = useState(false);
  useEffect(() => setCameraFailed(false), [cameraPassthrough]);
  const board = useRef(null);
  const origin = useRef(null);
  const menuPanel = useRef(null);
  const chordFrame = useRef(null);
  const toolFrame = useRef(null);
  const filterFrame = useRef(null);
  const menuDock = useRef({ to: null, placed: false }); // where the panel is docked: see Grab.jsx
  const viewPanel = useRef(null);
  const viewDock = useRef({ to: null, placed: false }); // ...and the View panel
  // the panels and the ToolFrame aren't drawn in every view: each comes back where it was
  const [setMenuPanel, menuPose] = useKeptPose(menuPanel, { position: MENU_POSITION, rotation: MENU_ROTATION });
  const [setViewPanel, viewPose] = useKeptPose(viewPanel, { position: VIEW_POSITION, rotation: MENU_ROTATION });
  const [setToolFrame, toolFramePose] = useKeptPose(toolFrame, { position: TOOL_FRAME_POSITION, scale: START_SCALE });
  // stacked on a controller in this order, top to bottom
  const panels = useMemo(
    () => [
      { id: 'menu', object: menuPanel, dock: menuDock, position: MENU_POSITION },
      { id: 'view', object: viewPanel, dock: viewDock, position: VIEW_POSITION },
    ],
    [],
  );
  // the picks: id -> { object, dock, instrument }, where each is docked (see Grab.jsx) and what it plays;
  // and [{ id, instrument }], to draw them
  const currentInstrument = useRef(state.instrument);
  currentInstrument.current = state.instrument;
  // what each controller's ball (or tracked hand's fingertip) plays: the menu's instrument as a session starts,
  // then whatever that controller chooses
  const handInstruments = useRef({});
  const picks = useRef(new Map([[0, { object: null, dock: firstPickDock(), instrument: state.instrument }]]));
  const nextPickId = useRef(1);
  const [pickList, setPickList] = useState(() => [{ id: 0, instrument: state.instrument }]);
  const listPicks = useCallback(() => setPickList([...picks.current].map(([id, p]) => ({ id, instrument: p.instrument }))), []);
  // each pick's ref (one per pick, so a re-render doesn't put back a pose it has since left): it
  // remembers where the pick was as it goes (outside XR), to come back there
  const pickRefs = useRef(new Map());
  const pickRefOf = (id) => {
    if (!pickRefs.current.has(id))
      pickRefs.current.set(id, (object) => {
        const p = picks.current.get(id);
        if (!p) return pickRefs.current.delete(id);
        if (!object && p.object) p.pose = poseOf(p.object);
        p.object = object;
      });
    return pickRefs.current.get(id);
  };
  // a new pick from the toolbox plays what the controller taking it does
  const spawnPick = useCallback(
    (hand) => {
      const id = nextPickId.current++;
      const instrument = handInstruments.current[hand] ?? currentInstrument.current;
      picks.current.set(id, { object: null, dock: { to: hand, placed: true, scale: 1 }, instrument });
      listPicks();
    },
    [listPicks],
  );
  const removePick = useCallback(
    (id) => {
      picks.current.delete(id);
      listPicks();
    },
    [listPicks],
  );
  // hands on the frames, and touching and holding the picks: see Touch.jsx and Grab.jsx
  const handles = useRef({ touching: {}, holding: {}, frames: {}, picks: {} });
  const panelScale = phone && state.stereo ? PHONE_STEREO_MENU_SCALE : 1;
  const strings = cells.length / FRETS;
  // where the FilterFrame first appears: fixed, so a new tuning never moves it out from under a hand
  const [filterFrameStart] = useState(() => filterFramePosition(strings));
  // a pick plays its own instrument, a controller (or hand) its own; the mouse and gaze the menu's
  const instrumentOf = useCallback((source) => {
    if (source.startsWith('pick:')) return picks.current.get(Number(source.slice(5)))?.instrument;
    return handInstruments.current[source] ?? null;
  }, []);
  const [touches, touch, press, bend] = useTouches(cells, state.instrument, state.velocity, instrumentOf);
  // a session starts with both controllers playing the menu's instrument
  useEffect(() => {
    handInstruments.current = inSession ? { left: currentInstrument.current, right: currentInstrument.current } : {};
  }, [inSession]);
  // an instrument chosen by a controller is that controller's alone: given to the pick it has docked or is
  // holding, if it has one, else to its ball
  useEffect(() => {
    if (!instrumentChoice) return;
    const { hand, instrument } = instrumentChoice;
    const held = [...picks.current].find(([id, p]) => p.dock.to === hand || handles.current.picks?.[id]?.holding?.[hand]);
    if (held) {
      held[1].instrument = instrument;
      listPicks();
    } else handInstruments.current[hand] = instrument;
  }, [instrumentChoice, listPicks]);
  const hoverMouse = useCallback((index, velocity) => press('mouse', index, velocity), [press]);

  useEffect(() => {
    if (immersive) press('mouse', null);
  }, [immersive, press]);

  // switching views moves nothing: what's in the scene stays where it was put, and leaving XR, what a
  // hand (or the mouth) had docked goes back to it in the next session (see suspendDock)
  // controllers dock the panel and the first pick until moved (see Grab.jsx); losing the controllers
  // (to hand tracking) with a pick docked leaves one pick, where it started, and frees a
  // controller-docked panel
  useEffect(() => {
    if (!inSession) {
      for (const p of picks.current.values()) suspendDock(p.dock);
      for (const { dock } of panels) suspendDock(dock.current);
      return;
    }
    const docked = [...picks.current.values()].some((p) => p.dock.to);
    if (!hasControllers && docked) {
      const [first] = picks.current.keys();
      const object = picks.current.get(first)?.object ?? null;
      picks.current = new Map([[first, { object, dock: firstPickDock(), instrument: currentInstrument.current }]]);
      listPicks();
      if (object) {
        object.position.fromArray(PICK_POSITION);
        object.rotation.fromArray(PICK_ROTATION);
        object.scale.setScalar(1);
        object.visible = true;
      }
    }
    for (const { dock: { current: dock }, object, position } of panels) {
      if (!hasControllers && (dock.to === 'left' || dock.to === 'right')) {
        dock.to = null;
        const panel = object.current;
        if (!panel) continue;
        panel.position.fromArray(position);
        panel.rotation.fromArray(MENU_ROTATION);
        panel.scale.setScalar(1);
        panel.visible = true;
      }
    }
  }, [inSession, hasControllers, panels]);

  // the Controller Guide: what each controller's parts do now, by what its grip holds
  const guideTexts = useCallback(
    (hand) => {
      const held = handles.current.gripping?.[hand];
      return {
        'xr-standard-trigger': 'Select · slide\nHeld: every note sounds',
        'xr-standard-squeeze': held ? (GRIP_HELD[held] ?? 'Let go: drop, or dock') : 'Grab · bend a note\n×2: Dock / undock panels\n×3: Summon panels',
        'xr-standard-thumbstick': handles.current.stickBusy?.[hand] ? '↕ Push / pull\n↔ Roll' : hand === 'left' ? 'Move' : 'Turn\nOn the menu: ↕ Scroll',
        menu: hand === 'left' ? 'Leave XR' : '',
      };
    },
    [handles],
  );

  return (
    <>
      {cameraPassthrough && !cameraFailed ? (
        <CameraBackground
          split={state.stereo}
          onError={(e) => {
            console.warn('[xr-music] camera unavailable, showing the skybox instead:', e?.message ?? e);
            setCameraFailed(true);
          }}
        />
      ) : (
        <Backdrop background={state.background} />
      )}
      {state.view === 'sbs' && !immersive && <SideBySide />}
      {state.view === 'interlaced' && !immersive && <Interlaced />}
      {(state.view === 'sbs' || state.view === 'interlaced') && !immersive && <StereoMenu menu={menu} />}
      {phoneStereo && <PhoneStereoXR />}
      {phoneStereo && state.passthrough && (
        <PhoneStereoCameraFeed
          onUnavailable={(reason) =>
            console.warn(`[xr-music] no per-eye camera image (${reason}); the browser's camera view shows behind instead`)
          }
        />
      )}
      <Lights />
      <Fretboard
        boardRef={board}
        position={BOARD_POSITION}
        scale={START_SCALE}
        cells={cells}
        chord={chord}
        touches={touches}
        handles={handles}
        hoverEnabled={!immersive}
        onHover={hoverMouse}
        onBend={bend}
      />
      <ChordFrame
        groupRef={chordFrame}
        position={CHORD_FRAME_POSITION}
        scale={START_SCALE}
        chart={chart}
        selected={selectedChord}
        handles={handles}
        hoverEnabled={!immersive}
        onSelect={onChord}
      />
      <FilterFrame
        groupRef={filterFrame}
        position={filterFrameStart}
        scale={START_SCALE}
        effects={state.effects}
        amounts={effectAmounts}
        onSlide={onEffectSlide}
        onSwitch={onEffectSwitch}
        handles={handles}
        hoverEnabled={!immersive}
      />
      {/* picks dock on controllers (and the mouth) */}
      {inSession && !phone && <ToolFrame groupRef={setToolFrame} {...toolFramePose} handles={handles} />}
      {inSession &&
        !phone &&
        pickList.map(({ id, instrument }) => (
          <Pick
            key={id}
            id={id}
            instrument={instrument}
            pickRef={pickRefOf(id)}
            handles={handles}
            {...(picks.current.get(id)?.pose ?? { position: PICK_POSITION, rotation: PICK_ROTATION })}
          />
        ))}
      {inSession && (
        <TouchPlay board={board} chordFrame={chordFrame} picks={picks} origin={origin} cells={cells} touch={touch} handles={handles} onChord={onChord} />
      )}
      {immersive && !hasControllers && <GazePlay board={board} press={press} holding={holding} menuPressed={menuPressed} />}
      <Player
        origin={origin}
        board={board}
        chordFrame={chordFrame}
        toolFrame={toolFrame}
        filterFrame={filterFrame}
        effectAmounts={effectAmounts}
        onEffectSlide={onEffectSlide}
        onEffectSwitch={onEffectSwitch}
        picks={picks}
        spawnPick={spawnPick}
        removePick={removePick}
        onChord={onChord}
        panels={panels}
        strings={strings}
        handles={handles}
        onExitXR={onExitXR}
      >
        {/* with `screenMenu`, the menu is on the screen in front of the scene instead (see App.jsx) */}
        {immersive && !screenMenu && (
          <XRMenuPanel
            menu={menu}
            groupRef={setMenuPanel}
            stickBusy={(hand) => handles.current.stickBusy?.[hand]}
            {...menuPose}
            scale={panelScale}
          />
        )}
        {immersive && !screenMenu && (
          <XRViewPanel
            groupRef={setViewPanel}
            onSelect={onExitXR}
            {...viewPose}
            scale={panelScale}
          />
        )}
      </Player>
      {immersive && !hasControllers && <GazeReticle />}
      {inSession && <ControllerGuide on={state.controllerGuide} textsOf={guideTexts} scale={state.textSize} />}
      {state.handheld ? (
        <CardboardRig split={state.stereo} />
      ) : (
        <IfInSessionMode deny={['immersive-vr', 'immersive-ar']}>
          <OrbitControls makeDefault target={ORBIT_TARGET} enableDamping minDistance={0.3} maxDistance={8} />
        </IfInSessionMode>
      )}
    </>
  );
}
