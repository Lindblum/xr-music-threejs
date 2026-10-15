import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { applyTwoHands, readControllers } from './grip.js';
import { frameSize, nearFrame, touchesFrame } from './Fretboard.jsx';
import { TIP_FORWARD, pulse } from './Touch.jsx';
import { playClick } from './audio.js';

// Touch controller grips. A grip pressed while that controller points at the
// menu panel takes it, held rigidly in the hand, off whatever it was docked
// to (with a click). Let go near the other controller and it docks there,
// riding above it like a palette; let go near the Fretboard and it docks
// against the frame's nearest edge, and moves with the Fretboard; let go
// anywhere else and it stays put, travelling with the player. Docking
// clicks, and kicks the controller it docks to.
//
// A grip pressed with the controller's tip on the Fretboard's frame takes
// hold of the Fretboard: with one hand it follows that hand rigidly, moving
// and turning with it; with both hands on the frame (as in Tilt Brush) it
// scales with the distance between them and turns with the line between
// them. A grip pressed anywhere else does nothing until it is let go.

const HANDS = ['left', 'right'];
const GRAB_RADIUS = 0.04; // a little more forgiving than the mallet
const GRAB_PULSE = [0.6, 50]; // haptic [strength, ms] on taking hold of the frame
const DETACH_PULSE = [0.4, 30]; // on taking the panel off a dock
const DOCK_PULSE = [0.9, 80]; // on the controller the panel docks to
const FRAME_DOCK_PULSE = [0.5, 40]; // on the hand that docks it to the frame
const ZONE_TICK = [0.25, 20]; // the held panel comes within reach of a dock
const DOCK_REACH = 0.25; // metres from the panel's centre to a controller, to dock there
const FRAME_REACH = 0.25; // ...or to the frame's outline
const DOCK_GAP = 0.02; // between the frame and a panel docked to it
const FREE_SCALE = 1; // a panel in the hand eases to this size
const GROW_RATE = 12; // per second
// Docked on a controller: above it, tilted back toward the face, half size.
// In grip space, -Z points forward out of the controller and +Y up out of its top.
const CONTROLLER_DOCK = new THREE.Matrix4().compose(
  new THREE.Vector3(0, 0.17, -0.02),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0, 0)),
  new THREE.Vector3().setScalar(0.5),
);

const _tip = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _world = new THREE.Matrix4();
const _parentInverse = new THREE.Matrix4();
const _offset = new THREE.Matrix4();
const _step = new THREE.Matrix4();
const _identity = new THREE.Quaternion();

function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Sets `object`'s world pose to `grip` · `offset`, whatever its parent. */
function carry(object, grip, offset) {
  _parentInverse.copy(object.parent.matrixWorld).invert();
  _world.multiplyMatrices(grip, offset).premultiply(_parentInverse);
  _world.decompose(object.position, object.quaternion, object.scale);
}

/**
 * The panel's pose on the frame, in Fretboard space: against the outside of
 * the edge nearest its centre, facing the player, sliding along that edge to
 * where it was let go, and FREE_SCALE in size whatever the Fretboard's scale.
 */
function frameDockOffset(board, strings, panel) {
  const { outerX, outerY } = frameSize(strings);
  const { left, right, top, bottom } = panel.userData.bounds;
  const s = FREE_SCALE / board.scale.x;
  const gap = DOCK_GAP / board.scale.x;
  const p = board.worldToLocal(_centre.setFromMatrixPosition(panel.matrixWorld));
  // slide within the edge's length, or centre on it if the panel is longer
  const along = (v, min, max) => (min <= max ? THREE.MathUtils.clamp(v, min, max) : (min + max) / 2);
  let x, y;
  if (Math.abs(p.y) - outerY > Math.abs(p.x) - outerX) {
    x = along(p.x, -outerX - left * s, outerX - right * s);
    y = p.y > 0 ? outerY + gap - bottom * s : -outerY - gap - top * s;
  } else {
    x = p.x > 0 ? outerX + gap - left * s : -outerX - gap - right * s;
    y = along(p.y, -outerY - bottom * s, outerY - top * s);
  }
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, 0), _identity, _scale.setScalar(s));
}

/**
 * Grip controls for the Fretboard and the menu panel. `board`, `menu` and
 * `origin` (the XROrigin the controllers are tracked relative to) are refs;
 * `strings` is the Fretboard's row count, for the frame's size. Writes which
 * hands hold the frame into `handles.current.holding`. `menuDock.current.to`
 * is where the panel is docked: 'left', 'right', 'frame' or null (free), and
 * `placed` whether the player has moved it; the panel must be a direct child
 * of the XROrigin.
 */
export function useControllerGrips({ board, menu, menuDock, origin, strings, handles }) {
  const gl = useThree((s) => s.gl);
  const grabs = useRef({}); // hand -> { target: 'board' | 'none' } | { target: 'menu', offset, point, size, grow, zone }
  const lastHands = useRef({}); // positions of the hands holding the frame, last frame
  const oneHand = useRef(null); // { hand, offset } while a single hand carries the Fretboard
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useFrame((_, dt, frame) => {
    const referenceSpace = gl.xr.getReferenceSpace();
    if (!frame || !origin.current || !referenceSpace) {
      grabs.current = {};
      lastHands.current = {};
      oneHand.current = null;
      handles.current.holding = {};
      return;
    }
    const controllers = readControllers(frame, referenceSpace, origin.current);
    const fretboard = board.current;
    const panel = menu.current;
    const dock = menuDock.current;
    const holding = {}; // hand -> controller, for the hands on the frame

    /** Where the held panel would dock if let go now: the other hand, 'frame' or null. */
    const dockZone = (hand) => {
      _centre.setFromMatrixPosition(panel.matrixWorld);
      const other = hand === 'left' ? 'right' : 'left';
      if (controllers[other]?.position.distanceTo(_centre) < DOCK_REACH) return other;
      if (fretboard && nearFrame(fretboard, strings, _centre, FRAME_REACH)) return 'frame';
      return null;
    };

    for (const hand of HANDS) {
      const c = controllers[hand];
      let grab = grabs.current[hand];
      if (!c?.squeeze) {
        // letting go of the panel docks it, if it was within reach of a dock
        if (c && grab?.target === 'menu' && panel && grab.zone) {
          if (grab.zone === 'frame') {
            fretboard.updateWorldMatrix(true, false);
            dock.offset = frameDockOffset(fretboard, strings, panel);
            pulse(c.gamepad, FRAME_DOCK_PULSE);
          } else {
            pulse(controllers[grab.zone].gamepad, DOCK_PULSE);
          }
          dock.to = grab.zone;
          playClick('attach');
        }
        delete grabs.current[hand];
        continue;
      }
      if (!grab) {
        // a new grip: the menu if this controller is pointing at it, else the frame if its tip is on it
        raycaster.ray.copy(c.ray);
        _tip.copy(c.ray.origin).addScaledVector(c.ray.direction, TIP_FORWARD);
        const [hit] = panel && isShown(panel) ? raycaster.intersectObject(panel, true) : [];
        if (hit) {
          if (dock.to) {
            playClick('detach');
            pulse(c.gamepad, DETACH_PULSE);
          }
          dock.to = null;
          dock.placed = true;
          // the other hand lets go of it, if it had it
          for (const other of HANDS) if (grabs.current[other]?.target === 'menu') grabs.current[other] = { target: 'none' };
          const gripInverse = c.grip.clone().invert();
          grab = {
            target: 'menu',
            offset: gripInverse.clone().multiply(panel.matrixWorld),
            point: hit.point.clone().applyMatrix4(gripInverse), // grows about where it was taken, in grip space
            size: 1,
            grow: FREE_SCALE / _scale.setFromMatrixScale(panel.matrixWorld).x,
            zone: null,
          };
        } else if (fretboard && touchesFrame(fretboard, strings, _tip, GRAB_RADIUS)) {
          grab = { target: 'board' };
          pulse(c.gamepad, GRAB_PULSE);
        } else {
          grab = { target: 'none' };
        }
        grabs.current[hand] = grab;
      }
      if (grab.target === 'board') holding[hand] = c;
      else if (grab.target === 'menu' && panel) {
        // keeps its pose in the hand, easing to full size about the point it was taken by
        grab.size += (grab.grow - grab.size) * (1 - Math.exp(-GROW_RATE * Math.min(dt, 0.1)));
        const { x, y, z } = grab.point;
        _offset.makeTranslation(x, y, z).multiply(_step.makeScale(grab.size, grab.size, grab.size));
        _offset.multiply(_step.makeTranslation(-x, -y, -z)).multiply(grab.offset);
        carry(panel, c.grip, _offset);
        panel.updateMatrixWorld();
        const zone = dockZone(hand);
        if (zone && zone !== grab.zone) pulse(zone === 'frame' ? c.gamepad : controllers[zone].gamepad, ZONE_TICK);
        grab.zone = zone;
      }
    }
    handles.current.holding = { left: Boolean(holding.left), right: Boolean(holding.right) };

    const held = Object.keys(holding);
    const positions = Object.fromEntries(held.map((hand) => [hand, holding[hand].position]));
    if (fretboard && held.length === 2) {
      oneHand.current = null;
      applyTwoHands(fretboard, lastHands.current, positions);
    } else if (fretboard && held.length === 1) {
      // one hand: the Fretboard keeps its pose relative to that hand, from when it became the only one
      const [hand] = held;
      const c = holding[hand];
      if (oneHand.current?.hand !== hand) {
        fretboard.updateMatrixWorld();
        oneHand.current = { hand, offset: c.grip.clone().invert().multiply(fretboard.matrixWorld) };
      }
      carry(fretboard, c.grip, oneHand.current.offset);
    } else {
      oneHand.current = null;
    }
    lastHands.current = positions;

    // a docked panel follows its dock, after the Fretboard has moved; on an untracked controller it hides
    if (!panel) return;
    panel.visible = true;
    if (dock.to === 'frame' && fretboard) {
      fretboard.updateWorldMatrix(true, false);
      carry(panel, fretboard.matrixWorld, dock.offset);
    } else if (dock.to === 'left' || dock.to === 'right') {
      const c = controllers[dock.to];
      panel.visible = Boolean(c);
      if (c) carry(panel, c.grip, CONTROLLER_DOCK);
    }
  });
}
