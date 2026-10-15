import { Component, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { IfInSessionMode, XROrigin, useXR, useXRControllerLocomotion } from '@react-three/xr';
import * as THREE from 'three';
import { FRETS, Fretboard } from './Fretboard.jsx';
import { GazePlay, TouchPlay } from './Touch.jsx';
import { useControllerGrips } from './Grab.jsx';
import { Pick } from './Pick.jsx';
import { XRMenuPanel } from './XRMenuPanel.jsx';
import { SideBySide } from './SideBySide.jsx';
import { Interlaced } from './Interlaced.jsx';
import { CameraBackground, CardboardRig } from './Cardboard.jsx';
import { GazeReticle } from './Gaze.jsx';
import { PhoneStereoCameraFeed, PhoneStereoXR } from './PhoneStereo.jsx';
import { SOLID_BACKGROUND } from './menu.js';
import { allNotesOff, noteOff, noteOn, setBend } from './audio.js';

// The Fretboard's centre: a metre above the floor and half a metre in front
// of the player, as in the old page.
const BOARD_POSITION = [0, 1, -0.5];
// The windowed view looks a little left of centre, so the board clears the panel.
export const ORBIT_TARGET = [-0.5, 1, -0.5];
// Without VR controllers (hand tracking, phones) the XR panel starts off to
// the player's left, turned toward them, and travels with the player. Constants, so a re-render never undoes a move.
const MENU_POSITION = [-0.65, 1.05, 0.05];
const MENU_ROTATION = [0, 0.9, 0];
// a phone's stereo view is blurrier and smaller than a headset's: a bigger panel stays readable
const PHONE_STEREO_MENU_SCALE = 1.5;
// The pick (XR: Headset only) starts docked on the right controller (see
// Grab.jsx). Without controllers it waits in front of the player, a little
// right of centre and below the board's middle, clear of its raised notes,
// face on, tip down. Constants, so a re-render never undoes a move.
const PICK_POSITION = [0.3, 0.95, -0.05];
const PICK_ROTATION = [0, -0.3, 0.25];
// With VR controllers the panel starts docked on the left one, like a palette
// held in that hand, and the right controller's ray presses its buttons. A
// grip takes it to dock on either controller or the Fretboard's frame (see Grab.jsx).

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

/** The old page's lighting: a soft hemisphere and an overhead sun casting onto a shadow-only floor. */
function Lights() {
  return (
    <>
      <hemisphereLight args={[0xbcbcbc, 0xa5a5a5, 3]} />
      <directionalLight
        position={[0, 6, 0]}
        intensity={3}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={2}
        shadow-camera-bottom={-2}
      />
      <mesh rotation-x={-Math.PI / 2} receiveShadow raycast={() => null}>
        <planeGeometry args={[4, 4]} />
        <shadowMaterial opacity={0.25} />
      </mesh>
    </>
  );
}

const _head = new THREE.Vector3();

/**
 * Left thumbstick moves, right thumbstick turns smoothly about the head.
 * The grip buttons, on the Fretboard's frame, move, turn and scale it, or
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

function Player({ origin, board, pick, pickDock, menu, menuDock, strings, handles, onExitXR, children }) {
  useXRControllerLocomotion(
    (velocity, turn, delta, state) => {
      const o = origin.current;
      if (!o) return;
      o.position.addScaledVector(velocity, delta);
      if (!turn) return;
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
  useControllerGrips({ board, pick, pickDock, menu, menuDock, origin, strings, handles });
  useMenuButton(onExitXR);
  return <XROrigin ref={origin}>{children}</XROrigin>;
}

/**
 * Which cubes are being touched, and by what: voice -> cell index, where a
 * voice is one source ('mouse', 'left', 'right', 'pick', 'gaze') on one cube
 * ('left:12'), so a source can sound several notes at once. `touch(source,
 * indices)` moves a source onto those cubes, sounding the new ones and
 * releasing the rest, and reports whether a new note was struck; `press(source,
 * index | null)` does it for one cube or none. `bend(index, semitones)` bends
 * every voice that has sounded that cube, ringing or held, and any that
 * strikes it while it's bent. Returns [touches, touch, press, bend].
 */
function useTouches(cells, instrument) {
  const touches = useRef(new Map());
  const voicesOf = useRef(new Map()); // cell index -> the voices that have sounded it, for bending
  const bends = useRef(new Map()); // cell index -> semitones it is bent by
  const latest = useRef({ cells, instrument });
  latest.current = { cells, instrument };

  // a new board or instrument: let go of everything; still-touching hands strike again
  useEffect(() => {
    touches.current.clear();
    voicesOf.current.clear();
    bends.current.clear();
    allNotesOff();
  }, [cells, instrument]);

  const touch = useCallback((source, indices) => {
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
      noteOn(voice, cell.note, latest.current.instrument);
      struck = true;
    }
    return struck;
  }, []);
  const press = useCallback((source, index) => touch(source, index == null ? [] : [index]), [touch]);
  const bend = useCallback((index, semitones) => {
    if (semitones) bends.current.set(index, semitones);
    else bends.current.delete(index);
    for (const voice of voicesOf.current.get(index) ?? []) setBend(voice, semitones);
  }, []);
  return [touches, touch, press, bend];
}

export default function Scene({ cells, chord, state, menu, phone, holding, onExitXR }) {
  const inSession = useXR((s) => s.mode === 'immersive-vr' || s.mode === 'immersive-ar');
  const inAR = useXR((s) => s.mode === 'immersive-ar');
  // a phone's AR session drawn as two lens-corrected eyes
  const phoneStereo = phone && inAR && state.stereo;
  // a phone has no controllers: it plays by gaze, and a 1-second stare clicks the panel
  const hasControllers = useXR((s) => s.inputSourceStates.some((input) => input.type === 'controller'));
  const leftController = useXR((s) =>
    s.inputSourceStates.some((input) => input.type === 'controller' && input.inputSource.handedness === 'left'),
  );
  const rightController = useXR((s) =>
    s.inputSourceStates.some((input) => input.type === 'controller' && input.inputSource.handedness === 'right'),
  );
  const immersive = inSession || state.handheld;
  // the motion-sensor view has no AR session: passthrough is the rear camera
  const cameraPassthrough = state.handheld && state.passthrough;
  const [cameraFailed, setCameraFailed] = useState(false);
  useEffect(() => setCameraFailed(false), [cameraPassthrough]);
  const board = useRef(null);
  const origin = useRef(null);
  const menuPanel = useRef(null);
  const pick = useRef(null);
  const menuDock = useRef({ to: null, placed: false }); // where the panel is docked: see Grab.jsx
  const pickDock = useRef({ to: null, placed: false, scale: 1 }); // where the pick is docked: see Grab.jsx
  // hands on the frame, and touching and holding the pick: see Touch.jsx and Grab.jsx
  const handles = useRef({ touching: {}, holding: {}, pick: { touching: {}, holding: {} } });
  const strings = cells.length / FRETS;
  const [touches, touch, press, bend] = useTouches(cells, state.instrument);
  const hoverMouse = useCallback((index) => press('mouse', index), [press]);

  useEffect(() => {
    if (immersive) press('mouse', null);
  }, [immersive, press]);

  // leaving XR puts the Fretboard back where the windowed view looks
  useEffect(() => {
    if (inSession || !board.current) return;
    board.current.position.fromArray(BOARD_POSITION);
    board.current.quaternion.identity();
    board.current.scale.setScalar(1);
  }, [inSession]);

  // controllers arriving dock a panel the player hasn't moved on the left one (or the right, if
  // that's all there is), and the pick on the right one (or the left); losing them all (to hand
  // tracking) frees a controller-docked panel, and the pick where it started
  useEffect(() => {
    const dock = menuDock.current;
    const pDock = pickDock.current;
    if (!inSession) {
      Object.assign(dock, { to: null, placed: false });
      Object.assign(pDock, { to: null, placed: false, scale: 1 });
    } else if (hasControllers) {
      if (!dock.to && !dock.placed) dock.to = leftController ? 'left' : 'right';
      if (!pDock.to && !pDock.placed) pDock.to = rightController ? 'right' : 'left';
    } else if (pDock.to) {
      pDock.to = null;
      const p = pick.current;
      if (p) {
        p.position.fromArray(PICK_POSITION);
        p.rotation.fromArray(PICK_ROTATION);
        p.scale.setScalar(1);
        p.visible = true;
      }
    }
    if (inSession && !hasControllers && (dock.to === 'left' || dock.to === 'right')) {
      dock.to = null;
      const panel = menuPanel.current;
      if (!panel) return;
      panel.position.fromArray(MENU_POSITION);
      panel.rotation.fromArray(MENU_ROTATION);
      panel.scale.setScalar(1);
      panel.visible = true;
    }
  }, [inSession, hasControllers, leftController, rightController]);

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
        cells={cells}
        chord={chord}
        touches={touches}
        handles={handles}
        hoverEnabled={!immersive}
        onHover={hoverMouse}
        onBend={bend}
      />
      {inSession && !phone && <Pick pickRef={pick} handles={handles} position={PICK_POSITION} rotation={PICK_ROTATION} />}
      {inSession && <TouchPlay board={board} pick={pick} origin={origin} cells={cells} touch={touch} handles={handles} />}
      {immersive && !hasControllers && <GazePlay board={board} press={press} holding={holding} />}
      <Player
        origin={origin}
        board={board}
        pick={pick}
        pickDock={pickDock}
        menu={menuPanel}
        menuDock={menuDock}
        strings={strings}
        handles={handles}
        onExitXR={onExitXR}
      >
        {immersive && (
          <XRMenuPanel
            {...menu}
            groupRef={menuPanel}
            position={MENU_POSITION}
            rotation={MENU_ROTATION}
            scale={phone && state.stereo ? PHONE_STEREO_MENU_SCALE : 1}
          />
        )}
      </Player>
      {immersive && !hasControllers && <GazeReticle />}
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
