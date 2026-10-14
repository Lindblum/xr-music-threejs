import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FRETS, touchedCell, touchesFrame } from './Fretboard.jsx';

// Playing the Fretboard in XR, as in three.js's haptics demo: each
// controller's tip (or each hand's index fingertip) is a small mallet.
// Touching a cube strikes its note; a controller kicks as it enters a cube
// and hums softly while it stays inside. Notes outside the scale only sound
// while the controller's trigger is held (a tracked hand can't play them). Touching the frame gives a lighter
// tap and hum, so you can feel where to take hold of it.

const HANDS = ['left', 'right'];
const RADIUS = 0.02; // mallet radius, metres
export const TIP_FORWARD = 0.01; // controller mallet: just ahead of the ray origin, at the tip
const STRIKE = [0.8, 40]; // haptic pulse [strength, ms] on entering a cube
const HUM = [0.2, 60]; // ...and while inside it
const FRAME_TAP = [0.4, 30]; // on touching the frame
const FRAME_HUM = [0.1, 60]; // ...and while on it
const TRIGGER = 0; // xr-standard gamepad button index
const HUM_EVERY = 0.05; // seconds between hum pulses, so they overlap into a steady hum

const _pose = new THREE.Matrix4();
const _dir = new THREE.Vector3();

/** Each hand's mallet in world space: { position, gamepad?, controller, trigger }, read straight from the XR frame. */
function readMallets(frame, referenceSpace, origin) {
  const mallets = {};
  for (const source of frame.session.inputSources) {
    if (!HANDS.includes(source.handedness)) continue;
    const position = new THREE.Vector3();
    if (source.hand) {
      const tip = source.hand.get('index-finger-tip');
      const pose = tip && frame.getJointPose?.(tip, referenceSpace);
      if (!pose) continue;
      _pose.fromArray(pose.transform.matrix).premultiply(origin.matrixWorld);
      position.setFromMatrixPosition(_pose);
    } else {
      const pose = frame.getPose(source.targetRaySpace, referenceSpace);
      if (!pose) continue;
      _pose.fromArray(pose.transform.matrix).premultiply(origin.matrixWorld);
      _dir.set(0, 0, -1).transformDirection(_pose);
      position.setFromMatrixPosition(_pose).addScaledVector(_dir, TIP_FORWARD);
    }
    const gamepad = source.hand ? null : source.gamepad;
    mallets[source.handedness] = { position, gamepad, controller: !source.hand, trigger: Boolean(gamepad?.buttons[TRIGGER]?.pressed) };
  }
  return mallets;
}

/** A haptic pulse [strength 0..1, ms] on `gamepad`'s first actuator, if it has one. */
export function pulse(gamepad, [strength, ms]) {
  gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms)?.catch?.(() => {});
}

/**
 * Touch play for both hands. `board` and `origin` are refs; `cells` the
 * Fretboard's cells; `press(voice, index | null)` sounds or releases a note.
 * Writes which hands touch the frame into `handles.current.touching`.
 * Renders the controller mallets.
 */
export function TouchPlay({ board, origin, cells, press, handles }) {
  const gl = useThree((s) => s.gl);
  const nextHum = useRef({});
  const balls = useRef({});

  useFrame((_, __, frame) => {
    const referenceSpace = gl.xr.getReferenceSpace();
    const mallets = frame && origin.current && referenceSpace ? readMallets(frame, referenceSpace, origin.current) : {};
    const now = performance.now() / 1000;
    const { touching, holding } = handles.current;
    for (const hand of HANDS) {
      const m = mallets[hand];
      const ball = balls.current[hand];
      if (ball) {
        ball.visible = Boolean(m?.controller);
        if (m) ball.position.copy(m.position);
      }
      const fretboard = board.current;
      const index = m && fretboard ? touchedCell(fretboard, cells, m.position, RADIUS, m.trigger) : null;
      const struck = press(hand, index);
      const wasOnFrame = Boolean(touching[hand]);
      const onFrame = Boolean(m && fretboard && touchesFrame(fretboard, cells.length / FRETS, m.position, RADIUS));
      touching[hand] = onFrame;
      // a hand carrying the Fretboard stays on the frame: Grab.jsx gave it its pulse
      if (!m?.gamepad || holding[hand] || (index == null && !onFrame)) continue;
      const [tap, hum] = index != null ? [STRIKE, HUM] : [FRAME_TAP, FRAME_HUM];
      if (struck || (onFrame && !wasOnFrame && index == null)) {
        pulse(m.gamepad, tap);
        nextHum.current[hand] = now + tap[1] / 1000;
      } else if (now >= (nextHum.current[hand] ?? 0)) {
        pulse(m.gamepad, hum);
        nextHum.current[hand] = now + HUM_EVERY;
      }
    }
  });

  return HANDS.map((hand) => (
    <mesh key={hand} ref={(b) => (balls.current[hand] = b)} visible={false} raycast={() => null}>
      <sphereGeometry args={[RADIUS * 0.6, 16, 12]} />
      <meshStandardMaterial color="#ffffff" emissive="#3355ff" emissiveIntensity={0.4} roughness={0.3} />
    </mesh>
  ));
}

const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();

/**
 * Playing by gaze, for phones (which have no controllers): the note at the
 * centre of view sounds, as hovering does with a mouse. Notes outside the
 * scale need a finger held on the screen: `holding` is a ref set by the
 * motion-sensor view's overlay, and in an AR session a touch shows up as a
 * screen input source.
 */
export function GazePlay({ board, cells, press, holding }) {
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  useEffect(() => () => press('gaze', null), [press]);

  useFrame(({ camera }, _, frame) => {
    const notes = board.current?.getObjectByName('Notes');
    if (!notes) return;
    const touching = holding.current || Boolean(frame && [...frame.session.inputSources].some((s) => s.targetRayMode === 'screen'));
    camera.getWorldPosition(_origin);
    camera.getWorldDirection(_direction);
    raycaster.set(_origin, _direction);
    const [hit] = raycaster.intersectObjects(notes.children, false);
    const index = hit ? notes.children.indexOf(hit.object) : -1;
    press('gaze', index >= 0 && (cells[index]?.inScale || touching) ? index : null);
  });
  return null;
}
