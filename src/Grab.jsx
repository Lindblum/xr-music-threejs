import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { applyTwoHands, readControllers } from './grip.js';
import { frameSize, nearFrame, touchesFrame } from './Fretboard.jsx';
import { TIP_FORWARD, pulse } from './Touch.jsx';
import { touchesPick } from './Pick.jsx';
import { playClick } from './audio.js';

// Touch controller grips. A grip pressed while that controller points at the
// menu panel, or touches it, takes it, held rigidly in the hand, off whatever it was docked
// to (with a click). Let go near the other controller and it docks there,
// standing on it like a palette, turned to face you; let go near the Fretboard and it docks
// against the frame's nearest edge, and moves with the Fretboard; let go
// anywhere else and it stays put, travelling with the player. Docking
// clicks, and kicks the controller it docks to.
//
// A grip pressed with the controller's tip on the pick, or on the
// Fretboard's frame, takes hold of it: with one hand it follows that hand
// rigidly, moving and turning with it; with both hands on it (as in Tilt
// Brush) it scales with the distance between them and turns with the line
// between them. A grip pressed anywhere else does nothing until it is let go.

const HANDS = ['left', 'right'];
const GRAB_RADIUS = 0.04; // a little more forgiving than the mallet
const CARRIED = ['board', 'pick']; // what grips move, turn and scale
const PANEL_REACH = 0.05; // a controller this close to the panel's face takes it, as well as one pointing at it
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
// Docked on a controller, the panel stands on it at half size: it follows the
// controller's position but not its turns, staying upright and facing the
// head. (Locked to the grip it would tilt with the handle's angle and roll
// with the wrist, away from the eyes.)
const DOCK_LIFT = 0.07; // metres from the grip's centre up to the panel's bottom edge, clear of the controller's ring
const DOCK_SCALE = 0.5;
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Matrix4();

const _head = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _dockPose = new THREE.Matrix4();
const _tip = new THREE.Vector3();
const _local = new THREE.Vector3();
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

/** Whether `world` is within `reach` metres of the panel's face. */
function touchesPanel(panel, world, reach) {
  const mesh = panel.children.find((o) => o.isMesh);
  if (!mesh) return false;
  const { width, height } = mesh.geometry.parameters;
  mesh.worldToLocal(_local.copy(world));
  const r = reach / _scale.setFromMatrixScale(mesh.matrixWorld).x;
  return Math.abs(_local.z) < r && Math.abs(_local.x) < width / 2 + r && Math.abs(_local.y) < height / 2 + r;
}

/**
 * The panel's world pose docked on a controller at `position`: the bottom
 * middle of what it shows now (a page, or just the gear) DOCK_LIFT above it,
 * upright, turned to face `head`.
 */
function controllerDockPose(panel, position, head) {
  const mesh = panel.children.find((o) => o.isMesh);
  const { height } = mesh.geometry.parameters;
  const anchor = _centre.copy(position).addScaledVector(UP, DOCK_LIFT);
  // face the head from about the middle of the panel
  _z.subVectors(head, _y.copy(anchor).addScaledVector(UP, (height / 2) * DOCK_SCALE));
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1);
  _z.normalize();
  _x.crossVectors(UP, _z);
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0); // looking straight down on it
  _x.normalize();
  _y.crossVectors(_z, _x);
  // the group's origin, back from the anchor by the mesh's bottom middle
  anchor.addScaledVector(_x, -mesh.position.x * DOCK_SCALE).addScaledVector(_y, -(mesh.position.y - height / 2) * DOCK_SCALE);
  return _dockPose.makeBasis(_x, _y, _z).scale(_scale.setScalar(DOCK_SCALE)).setPosition(anchor);
}

/** Sets `object`'s world pose to `grip` · `offset`, whatever its parent. */
function carry(object, grip, offset) {
  _parentInverse.copy(object.parent.matrixWorld).invert();
  _world.multiplyMatrices(grip, offset).premultiply(_parentInverse);
  _world.decompose(object.position, object.quaternion, object.scale);
}

/**
 * One frame of carrying `object` with the hands in `holding` (hand ->
 * controller): rigid in one hand, scaled and turned by two. `state` ({
 * oneHand, last }) carries over between frames.
 */
function carryByHands(object, holding, state) {
  const held = Object.keys(holding);
  const positions = Object.fromEntries(held.map((hand) => [hand, holding[hand].position]));
  if (object && held.length === 2) {
    state.oneHand = null;
    applyTwoHands(object, state.last, positions);
  } else if (object && held.length === 1) {
    // one hand: the object keeps its pose relative to that hand, from when it became the only one
    const [hand] = held;
    const c = holding[hand];
    if (state.oneHand?.hand !== hand) {
      object.updateMatrixWorld();
      state.oneHand = { hand, offset: c.grip.clone().invert().multiply(object.matrixWorld) };
    }
    carry(object, c.grip, state.oneHand.offset);
  } else {
    state.oneHand = null;
  }
  state.last = positions;
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
 * Grip controls for the Fretboard, the pick and the menu panel. `board`,
 * `pick`, `menu` and `origin` (the XROrigin the controllers are tracked
 * relative to) are refs; `strings` is the Fretboard's row count, for the
 * frame's size. Writes which hands hold the frame into
 * `handles.current.holding`, and which touch and hold the pick into
 * `handles.current.pick` ({ touching, holding }). `menuDock.current.to`
 * is where the panel is docked: 'left', 'right', 'frame' or null (free), and
 * `placed` whether the player has moved it; the panel must be a direct child
 * of the XROrigin.
 */
export function useControllerGrips({ board, pick, menu, menuDock, origin, strings, handles }) {
  const gl = useThree((s) => s.gl);
  const grabs = useRef({}); // hand -> { target: 'board' | 'pick' | 'none' } | { target: 'menu', offset, point, size, grow, zone }
  // per carried object: { oneHand: { hand, offset } while a single hand carries it, last: the holding hands' positions last frame }
  const carried = useRef(Object.fromEntries(CARRIED.map((target) => [target, { oneHand: null, last: {} }])));
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useFrame(({ camera }, dt, frame) => {
    const referenceSpace = gl.xr.getReferenceSpace();
    if (!frame || !origin.current || !referenceSpace) {
      grabs.current = {};
      for (const target of CARRIED) carried.current[target] = { oneHand: null, last: {} };
      handles.current.holding = {};
      handles.current.pick = { touching: {}, holding: {} };
      return;
    }
    const controllers = readControllers(frame, referenceSpace, origin.current);
    const fretboard = board.current;
    const thePick = pick.current;
    const panel = menu.current;
    const dock = menuDock.current;
    const holding = { board: {}, pick: {} }; // target -> hand -> controller, for the hands carrying it
    const pickTouching = {};

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
      if (c && thePick) {
        _tip.copy(c.ray.origin).addScaledVector(c.ray.direction, TIP_FORWARD);
        pickTouching[hand] = touchesPick(thePick, _tip, GRAB_RADIUS);
      }
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
      if (!grab && pickTouching[hand]) {
        // a new grip with the tip on the pick takes the pick
        grab = grabs.current[hand] = { target: 'pick' };
        pulse(c.gamepad, GRAB_PULSE);
      }
      if (!grab) {
        // a new grip: the menu if this controller is pointing at it or touching it, else the frame if its tip is on it
        raycaster.ray.copy(c.ray);
        _tip.copy(c.ray.origin).addScaledVector(c.ray.direction, TIP_FORWARD);
        const shown = panel && isShown(panel);
        const [hit] = shown ? raycaster.intersectObject(panel, true) : [];
        // not by touch from the controller it's docked on, which is always close to it
        const touched =
          !hit && shown && dock.to !== hand && (touchesPanel(panel, _tip, PANEL_REACH) || touchesPanel(panel, c.position, PANEL_REACH));
        if (hit || touched) {
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
            point: (hit ? hit.point : _tip).clone().applyMatrix4(gripInverse), // grows about where it was taken, in grip space
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
      if (CARRIED.includes(grab.target)) holding[grab.target][hand] = c;
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
    const flags = (hands) => ({ left: Boolean(hands.left), right: Boolean(hands.right) });
    handles.current.holding = flags(holding.board);
    handles.current.pick = { touching: flags(pickTouching), holding: flags(holding.pick) };
    carryByHands(fretboard, holding.board, carried.current.board);
    carryByHands(thePick, holding.pick, carried.current.pick);

    // a docked panel follows its dock, after the Fretboard has moved; on an untracked controller it hides
    if (!panel) return;
    panel.visible = true;
    if (dock.to === 'frame' && fretboard) {
      fretboard.updateWorldMatrix(true, false);
      carry(panel, fretboard.matrixWorld, dock.offset);
    } else if (dock.to === 'left' || dock.to === 'right') {
      const c = controllers[dock.to];
      panel.visible = Boolean(c);
      if (c) carry(panel, controllerDockPose(panel, c.position, camera.getWorldPosition(_head)), IDENTITY);
    }
  });
}
