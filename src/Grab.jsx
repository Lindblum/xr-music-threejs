import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { applyTwoHands, readControllers } from './grip.js';
import { touchesFrame } from './Fretboard.jsx';
import { TIP_FORWARD, pulse } from './Touch.jsx';

// Touch controller grips. A grip pressed while that controller points at the
// menu panel carries the panel, held rigidly in the hand. A grip pressed with
// the controller's tip on the Fretboard's frame takes hold of the Fretboard:
// with one hand it follows that hand rigidly, moving and turning with it;
// with both hands on the frame (as in Tilt Brush) it scales with the distance
// between them and turns with the line between them. A grip pressed anywhere
// else does nothing until it is let go.

const HANDS = ['left', 'right'];
const GRAB_RADIUS = 0.04; // a little more forgiving than the mallet
const GRAB_PULSE = [0.6, 50]; // haptic [strength, ms] on taking hold of the frame

const _tip = new THREE.Vector3();
const _world = new THREE.Matrix4();
const _parentInverse = new THREE.Matrix4();

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
 * Grip controls for the Fretboard and the menu panel. `board`, `menu` and
 * `origin` (the XROrigin the controllers are tracked relative to) are refs;
 * `strings` is the Fretboard's row count, for the frame's size. Writes which
 * hands hold the frame into `handles.current.holding`.
 */
export function useControllerGrips({ board, menu, origin, strings, handles }) {
  const gl = useThree((s) => s.gl);
  const grabs = useRef({}); // hand -> { target: 'board' | 'none' } | { target: 'menu', offset }
  const lastHands = useRef({}); // positions of the hands holding the frame, last frame
  const oneHand = useRef(null); // { hand, offset } while a single hand carries the Fretboard
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useFrame((_, __, frame) => {
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
    const holding = {}; // hand -> controller, for the hands on the frame

    for (const hand of HANDS) {
      const c = controllers[hand];
      if (!c?.squeeze) {
        delete grabs.current[hand];
        continue;
      }
      let grab = grabs.current[hand];
      if (!grab) {
        // a new grip: the menu if this controller is pointing at it, else the frame if its tip is on it
        raycaster.ray.copy(c.ray);
        const panel = menu.current;
        _tip.copy(c.ray.origin).addScaledVector(c.ray.direction, TIP_FORWARD);
        if (panel && isShown(panel) && raycaster.intersectObject(panel, true).length) {
          grab = { target: 'menu', offset: c.grip.clone().invert().multiply(panel.matrixWorld) };
        } else if (fretboard && touchesFrame(fretboard, strings, _tip, GRAB_RADIUS)) {
          grab = { target: 'board' };
          pulse(c.gamepad, GRAB_PULSE);
        } else {
          grab = { target: 'none' };
        }
        grabs.current[hand] = grab;
      }
      if (grab.target === 'board') holding[hand] = c;
      else if (grab.target === 'menu' && menu.current) carry(menu.current, c.grip, grab.offset); // keeps its pose in the hand
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
  });
}
