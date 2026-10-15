import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { applyTwoHands, readControllers } from './grip.js';
import { SPACING, frameSize, nearFrame, touchedCells, touchesFrame } from './Fretboard.jsx';
import { RADIUS, TIP_FORWARD, pulse } from './Touch.jsx';
import { PICK_DOCK_POSITION, PICK_DOCK_ROTATION, touchesPick } from './Pick.jsx';
import { playClick } from './audio.js';

// Touch controller grips. A grip pressed while that controller points at the
// menu panel, or touches it, takes it, held rigidly in the hand, off whatever it was docked
// to (with a click). Let go near the other controller and it docks there,
// standing on it like a palette, turned to face you; let go near the Fretboard and it docks
// against the frame's nearest edge, and moves with the Fretboard; let go
// anywhere else and it stays put, travelling with the player. Docking
// clicks, and kicks the controller it docks to.
//
// The pick docks on controllers the same way: a grip from the other hand
// takes it off one (with a click), and let go near a controller it docks
// there, pointing forward from it. The pick starts on the right controller,
// the panel on the left. A double tap of a grip lets go of whatever is docked
// on that controller, leaving it where it is; with nothing docked there, it
// calls back the things whose home it is (where each was last docked).
//
// A grip also takes what the controller's ray points at, at any distance:
// the frame, the pick or the panel, whichever is nearest (and glows, so you
// can see what it'll take); something touched comes first.
//
// A grip pressed with the controller's tip on the pick, or on the
// Fretboard's frame, takes hold of it: with one hand it follows that hand
// rigidly, moving and turning with it; with both hands on it (as in Tilt
// Brush) it scales with the distance between them and turns with the line
// between them. A grip pressed with the tip on a note bends it: the note
// slides along the frets with the hand, a semitone per fret's width, until
// the grip lets go (see Fretboard.jsx), ticking at each semitone. A grip
// pressed anywhere else does nothing until it is let go.

const HANDS = ['left', 'right'];
const GRAB_RADIUS = 0.04; // a little more forgiving than the mallet
const CARRIED = ['board', 'pick']; // what grips move, turn and scale
const BEND_MAX = 3; // frets (semitones) a note bends either way
const BEND_PULSE = [0.5, 30]; // on taking hold of a note
const BEND_TICK = [0.3, 15]; // at each whole semitone of bend
const PICK_DOCK_REACH = 0.15; // metres from the held pick's centre to the other controller, to dock there
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
// Docked on a controller, the panel rides on it at half size, fixed to its
// pointing frame (target-ray space: -Z forward, +Y up), so it moves and turns
// with the hand like an extension of it: the bottom middle of what it shows
// just above the controller's front, leaning back so its face tips up toward
// the eyes.
const DOCK_ANCHOR = new THREE.Vector3(0, 0.05, 0.02);
const DOCK_TILT = -0.5; // radians about the controller's X: the top leans forward
const DOCK_SCALE = 0.5;
const DOUBLE_TAP = 0.35; // seconds between a grip's short tap and its next press, for a double tap
const TAP = 0.3; // seconds: a grip pressed no longer than this is a tap

const _tilt = new THREE.Matrix4().makeRotationX(DOCK_TILT);
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
 * The panel's pose docked on a controller, in the controller's target-ray
 * space: the bottom middle of what it shows now (a page, or just the gear) at
 * DOCK_ANCHOR, tilted by DOCK_TILT, at DOCK_SCALE.
 */
function controllerDockOffset(panel) {
  const mesh = panel.children.find((o) => o.isMesh);
  const { height } = mesh.geometry.parameters;
  return _dockPose
    .makeTranslation(DOCK_ANCHOR.x, DOCK_ANCHOR.y, DOCK_ANCHOR.z)
    .multiply(_tilt)
    .multiply(_step.makeScale(DOCK_SCALE, DOCK_SCALE, DOCK_SCALE))
    .multiply(_step.makeTranslation(-mesh.position.x, -(mesh.position.y - height / 2), 0));
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
 * `handles.current.pick` ({ touching, holding, docked }), and what each free
 * hand's ray points at into `handles.current.aiming`. `pickDock.current`
 * is where the pick is docked ({ to: 'left' | 'right' | null, placed, scale }),
 * and the pick must be a direct child of the scene. `menuDock.current.to`
 * is where the panel is docked: 'left', 'right', 'frame' or null (free), and
 * `placed` whether the player has moved it, and `home` the controller it was
 * last docked on; the panel must be a direct child of the XROrigin.
 */
export function useControllerGrips({ board, pick, pickDock, menu, menuDock, origin, strings, handles }) {
  const gl = useThree((s) => s.gl);
  const grabs = useRef({}); // hand -> { target: 'board' | 'pick' | 'none' } | { target: 'menu', offset, point, size, grow, zone }
  // per carried object: { oneHand: { hand, offset } while a single hand carries it, last: the holding hands' positions last frame }
  const carried = useRef(Object.fromEntries(CARRIED.map((target) => [target, { oneHand: null, last: {} }])));
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const taps = useRef({}); // hand -> { down, pressedAt, tappedAt }, for double taps

  useFrame((_, dt, frame) => {
    const referenceSpace = gl.xr.getReferenceSpace();
    if (!frame || !origin.current || !referenceSpace) {
      grabs.current = {};
      for (const target of CARRIED) carried.current[target] = { oneHand: null, last: {} };
      handles.current.holding = {};
      handles.current.pick = { touching: {}, holding: {}, docked: null };
      handles.current.bending = {};
      handles.current.bendingHands = {};
      handles.current.aiming = {};
      return;
    }
    const controllers = readControllers(frame, referenceSpace, origin.current);
    const fretboard = board.current;
    const thePick = pick.current;
    const panel = menu.current;
    const dock = menuDock.current;
    const pDock = pickDock.current;
    const holding = { board: {}, pick: {} }; // target -> hand -> controller, for the hands carrying it
    const pickTouching = {};
    const bending = {}; // cell index -> how far it's pulled along the frets, in board metres
    const bendingHands = {}; // hand -> the cell it's bending
    const aiming = {}; // hand -> what its ray would grab: 'menu' | 'pick' | 'board'
    const frameMesh = fretboard?.getObjectByName('FretboardFrame');
    const aimHits = [];

    // the panel starts on the left controller and the pick on the right (or whichever there is), until moved
    if (panel && !dock.to && !dock.placed && (controllers.left || controllers.right)) dock.to = controllers.left ? 'left' : 'right';
    if (thePick && !pDock.to && !pDock.placed && (controllers.left || controllers.right)) pDock.to = controllers.right ? 'right' : 'left';

    /**
     * A double tap of `hand`'s grip: lets go of what's docked on it, where it
     * is; or, with nothing docked there, calls back what isn't held and has it
     * as home.
     */
    const doubleTap = (hand, c) => {
      const held = (target) => HANDS.some((h) => grabs.current[h]?.target === target);
      if (dock.to === hand || pDock.to === hand) {
        if (dock.to === hand) Object.assign(dock, { to: null, placed: true });
        if (pDock.to === hand) Object.assign(pDock, { to: null, placed: true });
        playClick('detach');
        pulse(c.gamepad, DETACH_PULSE);
        return;
      }
      let recalled = false;
      if (panel && dock.home === hand && !held('menu')) {
        dock.to = hand;
        recalled = true;
      }
      if (thePick && pDock.home === hand && !held('pick')) {
        pDock.to = hand;
        recalled = true;
      }
      if (!recalled) return;
      playClick('attach');
      pulse(c.gamepad, DOCK_PULSE);
    };

    /** What `hand`'s ray points at that a grip could take, nearest first: { target, hit } or null. */
    const aim = (hand, c) => {
      raycaster.ray.copy(c.ray);
      const candidates = [];
      if (panel && isShown(panel)) {
        const [hit] = raycaster.intersectObject(panel, true);
        if (hit) candidates.push({ target: 'menu', hit });
      }
      // the pick's mesh opts out of pointer events, so it's tested directly; not from the controller it's docked on
      if (thePick?.visible && pDock.to !== hand) {
        aimHits.length = 0;
        THREE.Mesh.prototype.raycast.call(thePick, raycaster, aimHits);
        if (aimHits.length) candidates.push({ target: 'pick', hit: aimHits.sort((a, b) => a.distance - b.distance)[0] });
      }
      if (frameMesh) {
        const [hit] = raycaster.intersectObject(frameMesh, false);
        if (hit) candidates.push({ target: 'board', hit });
      }
      return candidates.sort((a, b) => a.hit.distance - b.hit.distance)[0] ?? null;
    };

    /** Where the held panel would dock if let go now: the other hand, 'frame' or null. */
    const dockZone = (hand) => {
      _centre.setFromMatrixPosition(panel.matrixWorld);
      const other = hand === 'left' ? 'right' : 'left';
      if (controllers[other]?.position.distanceTo(_centre) < DOCK_REACH) return other;
      if (fretboard && nearFrame(fretboard, strings, _centre, FRAME_REACH)) return 'frame';
      return null;
    };

    const now = performance.now() / 1000;
    for (const hand of HANDS) {
      const c = controllers[hand];
      // a grip's second press soon after a short tap is a double tap: it docks or undocks, and takes nothing
      const tap = (taps.current[hand] ??= { down: false, pressedAt: -1, tappedAt: -Infinity });
      const squeezed = Boolean(c?.squeeze);
      if (squeezed && !tap.down) {
        if (now - tap.tappedAt < DOUBLE_TAP) {
          tap.tappedAt = -Infinity;
          doubleTap(hand, c);
          grabs.current[hand] = { target: 'none' };
        }
        tap.pressedAt = now;
      } else if (!squeezed && tap.down) {
        tap.tappedAt = now - tap.pressedAt <= TAP ? now : -Infinity;
      }
      tap.down = squeezed;
      let grab = grabs.current[hand];
      // the controller the pick is docked on is always touching it, so doesn't count
      if (c && thePick && thePick.visible && pDock.to !== hand) {
        _tip.copy(c.ray.origin).addScaledVector(c.ray.direction, TIP_FORWARD);
        pickTouching[hand] = touchesPick(thePick, _tip, GRAB_RADIUS);
      }
      // what a grip from this hand would take by pointing, unless it's holding something
      const aimed = c && !(c.squeeze && grab) ? aim(hand, c) : null;
      if (aimed) aiming[hand] = aimed.target;
      if (!c?.squeeze) {
        // letting go of the pick, if no other hand has it, docks it on a controller within reach
        const other = hand === 'left' ? 'right' : 'left';
        const otherHolds = grabs.current[other]?.target === 'pick' && controllers[other]?.squeeze;
        if (c && grab?.target === 'pick' && thePick && grab.zone && !otherHolds) {
          pDock.to = grab.zone;
          pDock.scale = _scale.setFromMatrixScale(thePick.matrixWorld).x;
          pulse(controllers[grab.zone].gamepad, DOCK_PULSE);
          playClick('attach');
        }
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
      const shown = panel && isShown(panel);
      _tip.copy(c.ray.origin).addScaledVector(c.ray.direction, TIP_FORWARD);
      // touching comes first: the pick, the panel (not from the controller it's docked on, which is always close to it),
      // a note, the frame; then whatever the ray points at
      const menuTouched =
        !grab && shown && dock.to !== hand && (touchesPanel(panel, _tip, PANEL_REACH) || touchesPanel(panel, c.position, PANEL_REACH));
      const noteTouched = !grab && fretboard ? touchedCells(fretboard, _tip, RADIUS, c.trigger) : [];
      const frameTouched = !grab && fretboard && touchesFrame(fretboard, strings, _tip, GRAB_RADIUS);
      let take = null;
      if (!grab) {
        if (pickTouching[hand]) take = { target: 'pick' };
        else if (menuTouched) take = { target: 'menu', point: _tip };
        else if (noteTouched.length) take = { target: 'note' };
        else if (frameTouched) take = { target: 'board' };
        else if (aimed) take = { target: aimed.target, point: aimed.hit.point };
      }
      if (take?.target === 'pick') {
        // a new grip on the pick takes it, off its dock if it's docked
        if (pDock.to) {
          playClick('detach');
          pulse(c.gamepad, DETACH_PULSE);
        } else pulse(c.gamepad, GRAB_PULSE);
        pDock.to = null;
        pDock.placed = true;
        grab = grabs.current[hand] = { target: 'pick', zone: null };
      }
      if (!grab) {
        if (take?.target === 'menu') {
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
            point: take.point.clone().applyMatrix4(gripInverse), // grows about where it was taken, in grip space
            size: 1,
            grow: FREE_SCALE / _scale.setFromMatrixScale(panel.matrixWorld).x,
            zone: null,
          };
        } else if (take?.target === 'note') {
          // the note the tip is on (the nearest, if it's between two): bent from where the hand is now
          grab = { target: 'note', index: noteTouched[0], from: fretboard.worldToLocal(_tip.clone()).x, step: 0 };
          pulse(c.gamepad, BEND_PULSE);
        } else if (take?.target === 'board') {
          grab = { target: 'board' };
          pulse(c.gamepad, GRAB_PULSE);
        } else {
          grab = { target: 'none' };
        }
        grabs.current[hand] = grab;
      }
      if (CARRIED.includes(grab.target)) holding[grab.target][hand] = c;
      else if (grab.target === 'note' && fretboard) {
        // how far the hand has moved along the frets since it took hold, as far as BEND_MAX either way
        _tip.copy(c.ray.origin).addScaledVector(c.ray.direction, TIP_FORWARD);
        const along = fretboard.worldToLocal(_tip).x - grab.from;
        const pulled = THREE.MathUtils.clamp(along, -BEND_MAX * SPACING, BEND_MAX * SPACING);
        bending[grab.index] = pulled;
        bendingHands[hand] = grab.index;
        const step = Math.trunc(pulled / SPACING);
        if (step !== grab.step) pulse(c.gamepad, BEND_TICK);
        grab.step = step;
      }
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
    // the pick glows when pointed at, as when touched
    for (const hand of HANDS) if (aiming[hand] === 'pick') pickTouching[hand] = true;
    handles.current.pick = { touching: flags(pickTouching), holding: flags(holding.pick), docked: pDock.to };
    handles.current.aiming = aiming;
    handles.current.bending = bending;
    handles.current.bendingHands = bendingHands;
    carryByHands(fretboard, holding.board, carried.current.board);
    carryByHands(thePick, holding.pick, carried.current.pick);

    if (thePick) {
      // held in one hand, the pick can dock on the other controller: a tick as it comes within reach
      const pickHands = Object.keys(holding.pick);
      for (const hand of pickHands) {
        const grab = grabs.current[hand];
        let zone = null;
        if (pickHands.length === 1) {
          thePick.updateMatrixWorld();
          const other = hand === 'left' ? 'right' : 'left';
          if (controllers[other]?.position.distanceTo(_centre.setFromMatrixPosition(thePick.matrixWorld)) < PICK_DOCK_REACH) zone = other;
        }
        if (zone && zone !== grab.zone) pulse(controllers[zone].gamepad, ZONE_TICK);
        grab.zone = zone;
      }
      // docked, it follows its controller, pointing forward; on an untracked controller it hides
      thePick.visible = true;
      if (pDock.to) {
        const c = controllers[pDock.to];
        thePick.visible = Boolean(c);
        if (c) carry(thePick, c.rayMatrix, _offset.compose(PICK_DOCK_POSITION, PICK_DOCK_ROTATION, _scale.setScalar(pDock.scale ?? 1)));
      }
    }

    // a docked panel follows its dock, after the Fretboard has moved; on an untracked controller it hides
    if (!panel) return;
    panel.visible = true;
    if (dock.to === 'frame' && fretboard) {
      fretboard.updateWorldMatrix(true, false);
      carry(panel, fretboard.matrixWorld, dock.offset);
    } else if (dock.to === 'left' || dock.to === 'right') {
      const c = controllers[dock.to];
      panel.visible = Boolean(c);
      if (c) carry(panel, c.rayMatrix, controllerDockOffset(panel));
    }
    // each remembers the controller it was last docked on, for a double tap to call it back
    if (dock.to === 'left' || dock.to === 'right') dock.home = dock.to;
    if (pDock.to) pDock.home = pDock.to;
  });
}
