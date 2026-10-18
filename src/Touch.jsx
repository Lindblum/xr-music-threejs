import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FRETS, touchedCells, touchedCellsByPoints, touchesFrame } from './Fretboard.jsx';
import { PICK_DOCK_POSITION, pickPoints } from './Pick.jsx';
import { chordOfNode, touchedChordNode } from './SideFrames.jsx';

// Playing the Fretboard in XR, as in three.js's haptics demo: each
// controller's collision sphere (2 cm, orange, in front of it where a pick
// docks; see controllerTip) or each hand's index fingertip is a small mallet.
// Touching a cube strikes its note (every cube it touches, if it's between
// them); a controller kicks as it enters a cube and hums softly while it
// stays inside. Notes outside the scale only sound while the controller's
// trigger is held (a tracked hand can't play them). Touching the NeckFrame
// gives a lighter tap and hum, so you can feel where to take hold of it.
// Each whole pick is a mallet too: held or docked, it kicks and hums the hand
// holding it, and that controller's own sphere stops playing (and hides); that hand's
// trigger lets it play any note. A hand (or a pick) bending notes (see Grab.jsx) plays
// only those. Each mallet strikes at a velocity (0..1) from its speed, for
// velocity-sensitive loudness (see Scene.jsx). Any mallet touching a node on
// the ChordFrame selects its chord, with a kick (see SideFrames.jsx).

const HANDS = ['left', 'right'];
export const RADIUS = 0.02; // a fingertip mallet's radius, metres
export const CONTROLLER_RADIUS = 0.01; // a controller's collision sphere's: 2 cm across
const SPHERE_COLOR = '#ff8a1f';
const STRIKE = [0.8, 40]; // haptic pulse [strength, ms] on entering a cube
const HUM = [0.2, 60]; // ...and while inside it
const FRAME_TAP = [0.4, 30]; // on touching the frame
const FRAME_HUM = [0.1, 60]; // ...and while on it
const TRIGGER = 0; // xr-standard gamepad button index
const HUM_EVERY = 0.05; // seconds between hum pulses, so they overlap into a steady hum
const FULL_SPEED = 1.5; // metres per second: a mallet this fast strikes at full velocity

const _pose = new THREE.Matrix4();
const _pickCentre = new THREE.Vector3();

/**
 * A controller's collision sphere's centre, into `out`, from its target-ray
 * pose (world): in front of it, where a docked pick's centre sits.
 */
export const controllerTip = (rayMatrix, out) => out.copy(PICK_DOCK_POSITION).applyMatrix4(rayMatrix);

/** Each hand's mallet in world space: { position, radius, gamepad?, controller, trigger }, read straight from the XR frame. */
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
      controllerTip(_pose.fromArray(pose.transform.matrix).premultiply(origin.matrixWorld), position);
    }
    const gamepad = source.hand ? null : source.gamepad;
    mallets[source.handedness] = {
      position,
      radius: source.hand ? RADIUS : CONTROLLER_RADIUS,
      gamepad,
      controller: !source.hand,
      trigger: Boolean(gamepad?.buttons[TRIGGER]?.pressed),
    };
  }
  return mallets;
}

/** A haptic pulse [strength 0..1, ms] on `gamepad`'s first actuator, if it has one. */
export function pulse(gamepad, [strength, ms]) {
  gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms)?.catch?.(() => {});
}

/**
 * Touch play for both hands (controllers' collision spheres, or fingertips) and the picks. `board`, `chordFrame` and `origin`
 * are refs, and `picks.current` a Map of id -> { object } (see Grab.jsx);
 * `cells` the Fretboard's cells; `touch(source, indices)` sounds the notes a
 * source touches and releases the rest. Writes which hands touch the
 * NeckFrame into `handles.current.touching`, and reads which hold each pick
 * (or have it docked) from `handles.current.picks` and which note each
 * mallet is bending from `handles.current.bendingHands`. Renders the
 * controllers' collision spheres.
 * `touch` also gets each strike's velocity, from the mallet's speed.
 * `onChord(chord)`: a mallet came onto a ChordFrame node; the nodes being
 * touched go into `handles.current.chordTouching` (a Set of indices).
 */
export function TouchPlay({ board, chordFrame, picks, origin, cells, touch, handles, onChord }) {
  const gl = useThree((s) => s.gl);
  const nextHum = useRef({});
  const balls = useRef({});
  const motion = useRef({}); // voice -> { position, speed } last frame, for its velocity
  const onNode = useRef({}); // mallet -> the ChordFrame node it touched last frame
  const pickVoices = useRef(new Set()); // the picks' voices last frame, to silence a pick taken away

  useFrame((_, dt, frame) => {
    const referenceSpace = gl.xr.getReferenceSpace();
    const mallets = frame && origin.current && referenceSpace ? readMallets(frame, referenceSpace, origin.current) : {};
    const now = performance.now() / 1000;
    const { touching, holding } = handles.current;
    // each pick's hands: those holding it, or the one it's docked on
    const pickHands = (id) => {
      const { holding: held = {}, docked = null } = handles.current.picks?.[id] ?? {};
      return { ...held, ...(docked && { [docked]: true }) };
    };
    const pickHolding = {}; // hand -> it holds a pick, or has one docked
    for (const id of picks.current.keys()) for (const [hand, on] of Object.entries(pickHands(id))) if (on) pickHolding[hand] = true;
    const bendingHands = handles.current.bendingHands ?? {};
    const fretboard = board.current;

    /** A mallet's velocity (0..1) from how fast `position` moves, smoothed over a few frames. */
    const velocity = (voice, position) => {
      const was = motion.current[voice];
      const speed = was && dt > 0 ? 0.5 * was.speed + 0.5 * (position.distanceTo(was.position) / dt) : 0;
      motion.current[voice] = { position: position.clone(), speed };
      return Math.min(speed / FULL_SPEED, 1);
    };

    /** One mallet's frame: strike what it touches, and kick or hum `gamepad`. */
    const play = (voice, m, radius, frameToo) => {
      const touched = () =>
        m.points ? touchedCellsByPoints(fretboard, m.points, radius, m.trigger) : touchedCells(fretboard, m.position, radius, m.trigger);
      // a mallet (a hand's tip, or the pick) bending notes keeps sounding just those, whatever it slides past
      const indices = bendingHands[voice] ?? (m && fretboard ? touched() : []);
      const struck = touch(voice, indices, m?.velocity ?? 1);
      const index = indices.length ? indices[0] : null;
      const wasOnFrame = Boolean(touching[voice]);
      const onFrame = Boolean(frameToo && m && fretboard && touchesFrame(fretboard, cells.length / FRETS, m.position, radius));
      if (frameToo) touching[voice] = onFrame;
      // a hand carrying the Fretboard stays on the frame: Grab.jsx gave it its pulse
      if (!m?.gamepad || holding[voice] || (index == null && !onFrame)) return;
      const [tap, hum] = index != null ? [STRIKE, HUM] : [FRAME_TAP, FRAME_HUM];
      if (struck || (onFrame && !wasOnFrame && index == null)) {
        pulse(m.gamepad, tap);
        nextHum.current[voice] = now + tap[1] / 1000;
      } else if (now >= (nextHum.current[voice] ?? 0)) {
        pulse(m.gamepad, hum);
        nextHum.current[voice] = now + HUM_EVERY;
      }
    };

    const chordTouching = new Set();
    /** One mallet on the ChordFrame: coming onto a node selects its chord. */
    const chooseChord = (voice, points, radius, gamepad) => {
      const chords = chordFrame.current;
      const node = points && chords ? touchedChordNode(chords, points, radius) : null;
      if (node != null) chordTouching.add(node);
      if (node != null && node !== onNode.current[voice]) {
        const chord = chordOfNode(chords, node);
        if (chord) onChord?.(chord);
        pulse(gamepad, STRIKE);
      }
      onNode.current[voice] = node;
    };

    for (const hand of HANDS) {
      // a controller holding a pick plays with the pick instead
      const m = pickHolding[hand] ? null : mallets[hand];
      const ball = balls.current[hand];
      if (ball) {
        ball.visible = Boolean(m?.controller);
        if (m) ball.position.copy(m.position);
      }
      if (mallets[hand]) mallets[hand].velocity = velocity(hand, mallets[hand].position);
      else delete motion.current[hand];
      play(hand, m, m?.radius ?? RADIUS, true);
      chooseChord(hand, m && [m.position], m?.radius ?? RADIUS, m?.gamepad);
    }

    const voices = new Set();
    for (const [id, { object: p }] of picks.current) {
      if (!p) continue;
      // all of the pick, with the trigger and haptics of the hand holding it (the first, if both)
      const voice = `pick:${id}`;
      voices.add(voice);
      const hands = pickHands(id);
      const holder = mallets[HANDS.find((hand) => hands[hand])];
      const { points, radius } = pickPoints(p);
      const speed = velocity(voice, p.getWorldPosition(_pickCentre));
      play(voice, p.visible ? { points, gamepad: holder?.gamepad, trigger: Boolean(holder?.trigger), velocity: speed } : null, radius, false);
      chooseChord(voice, p.visible && points, radius, holder?.gamepad);
    }
    // a pick taken away lets go of its notes
    for (const voice of pickVoices.current) {
      if (voices.has(voice)) continue;
      touch(voice, []);
      delete onNode.current[voice];
      delete motion.current[voice];
    }
    pickVoices.current = voices;
    handles.current.chordTouching = chordTouching;
  });

  // each controller's collision sphere, as big as what it touches with
  return HANDS.map((hand) => (
    <mesh key={hand} ref={(b) => (balls.current[hand] = b)} visible={false} raycast={() => null}>
      <sphereGeometry args={[CONTROLLER_RADIUS, 16, 12]} />
      <meshStandardMaterial color={SPHERE_COLOR} emissive={SPHERE_COLOR} emissiveIntensity={0.35} roughness={0.4} />
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
 * screen input source, unless it's on the on-screen menu (`menuPressed`).
 */
export function GazePlay({ board, press, holding, menuPressed }) {
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  useEffect(() => () => press('gaze', null), [press]);

  useFrame(({ camera }, _, frame) => {
    const notes = board.current?.getObjectByName('Notes');
    if (!notes) return;
    const touching =
      holding.current || (!menuPressed?.current && Boolean(frame && [...frame.session.inputSources].some((s) => s.targetRayMode === 'screen')));
    camera.getWorldPosition(_origin);
    camera.getWorldDirection(_direction);
    raycaster.set(_origin, _direction);
    const [hit] = raycaster.intersectObjects(notes.children, false);
    const index = hit ? notes.children.indexOf(hit.object) : -1;
    press('gaze', index >= 0 && (hit.object.userData.playable || touching) ? index : null);
  });
  return null;
}
