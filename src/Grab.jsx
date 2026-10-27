import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { applyTwoHands, readControllers } from './grip.js';
import { SPACING, frameSize, nearFrame, touchedCells, touchedCellsByPoints, touchesFrame } from './Fretboard.jsx';
import { CONTROLLER_RADIUS, controllerTip, pulse } from './Touch.jsx';
import { PICK_DOCK_POSITION, PICK_DOCK_ROTATION, PICK_MOUTH_POSITION, PICK_MOUTH_ROTATION, pickPoints, touchesPick } from './Pick.jsx';
import { chordOfNode, effectControls, knobAmountAt, touchesEffectKnob, touchesEffectSwitch, touchesSideFrame } from './SideFrames.jsx';
import { playClick } from './audio.js';

// Touch controller grips. A grip pressed while that controller points at the
// menu panel, or touches it, takes it, held rigidly in the hand, off whatever it was docked
// to (with a click). Let go near the other controller and it docks there,
// standing on it like a palette, turned to face you; let go near the Fretboard and it docks
// against the NeckFrame's nearest edge, and moves with the Fretboard; let go
// anywhere else and it stays put, travelling with the player. Docking
// clicks, and kicks the controller it docks to.
//
// Picks dock on controllers the same way: a grip from the other hand takes
// one off (with a click), and let go near a controller with no pick on it,
// it docks there, pointing forward from it; let go by the mouth, it docks
// there, flat in front of it (and goes where the head goes); let go on the
// ToolFrame's pick, it goes back in the toolbox. The first pick starts on the right
// controller, the panel on the left. A double tap of a grip docks a panel,
// or a pick, on that controller, if it's touching it or pointing at it (off
// the other controller, if it was there; a pick already docked here is let
// go where it is to make way). Touching or pointing at neither, a double tap
// lets go of whatever is docked on that controller, leaving it where it is.
// A third tap soon after docks every panel that isn't docked (free in the
// room, or held) on that controller, flying there from where it is.
//
// There are two panels, the menu and the View panel (see XRMenuPanel.jsx),
// and each docks, is taken and is let go on its own. Docked on one
// controller, they stand stacked, the menu above the View panel.
//
// While a grip holds the panel, a pick or a frame (in that hand alone), its
// thumbstick pushes it away along the controller's ray (up) or reels it in
// (down), faster the further off it is; meanwhile that stick neither moves
// nor turns the player, nor scrolls the panel (handles.current.stickBusy).
//
// The ToolFrame's pick (see SideFrames.jsx), touched by a controller's sphere,
// or pointed at with the trigger pulled, gives that controller a new pick,
// if it has none docked and isn't gripping anything (a docked panel doesn't
// count). Pointing at a ChordFrame node and pulling the trigger selects its
// chord, as touching it does (see Touch.jsx).
//
// A knob on the FilterFrame (see SideFrames.jsx), taken by a grip (touching
// it, or pointing at it) or by the trigger pointed at it, slides up and down
// its track as the hand moves along it, ticking every tenth, and stays where
// it's let go. An effect's switch there, touched or triggered, switches it in
// or out; the Reset switch puts every effect back as it started.
//
// A grip also takes what the controller's ray points at, at any distance:
// a frame, a FilterFrame knob, a pick or the panel, whichever is nearest (and glows, so you can
// see what it'll take); something touched comes first.
//
// A controller touches things with its collision sphere (its "tip": see
// controllerTip in Touch.jsx), 2 cm across, just in front of it.
// A grip pressed with the controller's sphere on a pick, or on a frame's
// moulding (the NeckFrame, the ChordFrame, the ToolFrame or the FilterFrame), takes hold of
// it: with one hand it follows that hand rigidly, moving and turning with
// it; with both hands on it (as in Tilt Brush) it scales with the distance
// between them and turns with the line between them. The NeckFrame carries
// the whole Fretboard; the side frames move on their own. A grip pressed
// with the sphere on a note bends it: the note slides along the frets with the
// hand, a semitone per fret's width, until the grip lets go (see
// Fretboard.jsx), ticking at each semitone. With a pick docked on a
// controller, its grip bends every note the pick is touching, together. A
// grip pressed anywhere else does nothing until it is let go.

const HANDS = ['left', 'right'];
const FRAMES = ['board', 'chords', 'tools', 'filter']; // what grips carry by its frame: the Fretboard, and the side frames
const SIDE_FRAMES = ['chords', 'tools', 'filter'];
const MOULDINGS = { board: 'NeckFrame', chords: 'ChordFrameMoulding', tools: 'ToolFrameMoulding', filter: 'FilterFrameMoulding' };
const BEND_MAX = 7; // frets (semitones) a note bends either way
const BEND_PULSE = [0.5, 30]; // on taking hold of a note
const BEND_TICK = [0.3, 15]; // at each whole semitone of bend
const KNOB_TICKS = 10; // a FilterFrame knob ticks this many times end to end
const PICK_DOCK_REACH = 0.15; // metres from the held pick's centre to the other controller, to dock there
const MOUTH_REACH = 0.12; // ...or to where it would sit at the mouth, to dock there
const TOOLBOX_REACH = 0.08; // ...or to the ToolFrame's pick, to go back in the toolbox
const GRAB_PULSE = [0.6, 50]; // haptic [strength, ms] on taking hold of a frame
const DETACH_PULSE = [0.4, 30]; // on taking the panel off a dock
const DOCK_PULSE = [0.9, 80]; // on the controller the panel docks to
const SELECT_PULSE = [0.8, 40]; // on selecting a chord with the trigger
const FRAME_DOCK_PULSE = [0.5, 40]; // on the hand that docks it to the frame
const ZONE_TICK = [0.25, 20]; // the held panel comes within reach of a dock
const DOCK_REACH = 0.25; // metres from the panel's centre to a controller, to dock there
const FRAME_REACH = 0.25; // ...or to the NeckFrame's outline
const DOCK_GAP = 0.02; // between the NeckFrame and a panel docked to it
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
const STACK_GAP = 0.008; // m between panels stacked on a controller
const DOUBLE_TAP = 0.35; // seconds between a grip's short tap and its next press, for a double tap
const TAP = 0.3; // seconds: a grip pressed no longer than this is a tap
const FLY = 0.4; // seconds a triple tap's panel takes to fly to its dock
const THUMBSTICK_Y = 3; // xr-standard gamepad axis: up is negative
const STICK_DEADZONE = 0.2;
const PUSH_RATE = 1.5; // per second at full tilt, this share of the held thing's distance from the hand...
const PUSH_MIN = 0.25; // ...but never slower than at this distance (m)
const REEL_MIN = 0.05; // m from the hand: reeled in no nearer

const _tilt = new THREE.Matrix4().makeRotationX(DOCK_TILT);
const _dockPose = new THREE.Matrix4();
const _tip = new THREE.Vector3();
const _local = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _toolCentre = new THREE.Vector3();
const _mouth = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _world = new THREE.Matrix4();
const _parentInverse = new THREE.Matrix4();
const _offset = new THREE.Matrix4();
const _step = new THREE.Matrix4();
const _identity = new THREE.Quaternion();
const _gripTurn = new THREE.Quaternion();
const _push = new THREE.Vector3();
const _flyFrom = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() };
const _flyTo = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() };
const _noMatrix = new THREE.Matrix4();
const _flight = new THREE.Matrix4();

/**
 * How far controller `c`'s thumbstick pushes (or reels in) what its grip holds,
 * `dist` metres from the grip, this frame: a step along its ray in the grip's
 * space (to add to a grip-space offset), or null with the stick at rest.
 */
function pushStep(c, dist, dt) {
  const y = c.gamepad.axes[THUMBSTICK_Y] ?? 0;
  if (Math.abs(y) < STICK_DEADZONE) return null;
  const step = Math.max(-y * PUSH_RATE * Math.max(dist, PUSH_MIN) * Math.min(dt, 0.1), Math.min(0, REEL_MIN - dist));
  if (!step) return null;
  _gripTurn.setFromRotationMatrix(c.grip).invert();
  return _push.copy(c.ray.direction).applyQuaternion(_gripTurn).multiplyScalar(step);
}

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

/** How tall the panel stands docked on a controller (m): what it shows now, at DOCK_SCALE (× Text Size, `text`). */
function dockedHeight(panel, text) {
  return panel.children.find((o) => o.isMesh).geometry.parameters.height * DOCK_SCALE * text;
}

/**
 * The panel's pose docked on a controller, in the controller's target-ray
 * space: the bottom middle of what it shows now (a page, or just the gear) at
 * DOCK_ANCHOR, `lift` metres up its face (above the panels stacked under it),
 * tilted by DOCK_TILT, at DOCK_SCALE (× Text Size, `text`).
 */
function controllerDockOffset(panel, lift, text) {
  const mesh = panel.children.find((o) => o.isMesh);
  const { height } = mesh.geometry.parameters;
  const scale = DOCK_SCALE * text;
  return _dockPose
    .makeTranslation(DOCK_ANCHOR.x, DOCK_ANCHOR.y, DOCK_ANCHOR.z)
    .multiply(_tilt)
    .multiply(_step.makeTranslation(0, lift, 0))
    .multiply(_step.makeScale(scale, scale, scale))
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
 * The panel's pose on the NeckFrame, in Fretboard space: against the outside
 * of the edge nearest its centre, facing the player, sliding along that edge
 * to where it was let go, and FREE_SCALE (× Text Size, `text`) in size whatever the Fretboard's scale.
 */
function frameDockOffset(board, strings, panel, text) {
  const { outerX, outerY } = frameSize(strings, board.scale.x);
  const { left, right, top, bottom } = panel.userData.bounds;
  const s = (FREE_SCALE * text) / board.scale.x;
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
 * Grip controls for the Fretboard, the side frames, the picks and the
 * panels. `board`, `chordFrame`, `toolFrame`, `filterFrame` and `origin` (the
 * XROrigin the controllers are tracked relative to) are refs; `strings` is
 * the Fretboard's row count, for the NeckFrame's size. `picks.current` is a
 * Map of id -> { object, dock }, where `dock` is { to: 'left' | 'right' |
 * 'mouth' | null, placed, scale }; picks must be direct children of the
 * scene. `spawnPick(hand)` adds a pick docked on that hand, `removePick(id)`
 * takes one away, and `onChord(chord)` selects a chord. `effectAmounts.current`
 * is the FilterFrame's sliders (effect id -> 0..1), which its knobs set with
 * `onEffectSlide(id, amount)`, and
 * `onEffectSwitch(id)` presses a switch there (an effect's, or the reset). Writes which hands
 * hold the NeckFrame into `handles.current.holding`, which touch and hold
 * each side frame into `handles.current.frames` ({ chords, tools }: {
 * touching, holding }), and each pick into `handles.current.picks` (id -> {
 * touching, holding, docked }), which touch or point at the ToolFrame's pick
 * into `handles.current.toolTouching`, the FilterFrame knobs and switches
 * touched, pointed at or held into `handles.current.effectKnobs` and
 * `effectSwitches` (effect id -> true), what each free hand's ray points at
 * into `handles.current.aiming`, what each grip holds into `handles.current.gripping`
 * (hand -> target), whose stick pushes and pulls it into `stickBusy`, and the notes being bent into
 * `handles.current.bending` (cell -> pull) and `bendingHands` (mallet: a hand
 * or 'pick:<id>' -> its cells). `panels` are [{ id, object, dock }], stacked
 * on a controller in that order from the top, with `object` the panel's ref
 * (a direct child of the XROrigin) and `dock.current.to` where it's docked:
 * 'left', 'right', 'frame' or null (free), and `placed` whether the player
 * has moved it. `textScale.current` is Accessibility's Text Size: the panels
 * are that much bigger, docked or held.
 */
export function useControllerGrips({
  board,
  chordFrame,
  toolFrame,
  filterFrame,
  effectAmounts,
  onEffectSlide,
  onEffectSwitch,
  picks,
  spawnPick,
  removePick,
  onChord,
  panels,
  textScale,
  origin,
  strings,
  handles,
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera); // the head, for a pick docked at the mouth
  // hand -> { target: a frame | 'none' } | { target: 'pick', id, zone } | { target: 'knob', effect, from, start, step } | { target: 'menu', ... } | { target: 'note', ... }
  const grabs = useRef({});
  // per carried thing (a frame, or 'pick:<id>'): { oneHand: { hand, offset } while a single hand carries it, last: the holding hands' positions last frame }
  const carried = useRef({});
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const taps = useRef({}); // hand -> { down, pressedAt, tappedAt }, for double taps
  const tools = useRef({}); // hand -> its tip was on the ToolFrame's pick last frame
  const triggers = useRef({}); // hand -> its trigger was down last frame
  const triggerKnob = useRef({}); // hand -> { effect, from, start, step } while its trigger slides a FilterFrame knob
  const switchesTouched = useRef({}); // hand -> the effect whose switch its tip was on last frame

  useFrame((_, dt, frame) => {
    const referenceSpace = gl.xr.getReferenceSpace();
    if (!frame || !origin.current || !referenceSpace) {
      grabs.current = {};
      carried.current = {};
      handles.current.holding = {};
      handles.current.frames = {};
      handles.current.picks = {};
      handles.current.bending = {};
      handles.current.bendingHands = {};
      handles.current.aiming = {};
      handles.current.toolTouching = {};
      handles.current.effectKnobs = {};
      handles.current.effectSwitches = {};
      handles.current.stickBusy = {};
      handles.current.gripping = {};
      triggerKnob.current = {};
      return;
    }
    const controllers = readControllers(frame, referenceSpace, origin.current);
    const fretboard = board.current;
    const objects = { board: fretboard, chords: chordFrame.current, tools: toolFrame.current, filter: filterFrame.current };
    const text = textScale?.current ?? 1;
    const panelList = panels.filter((p) => p.object.current).map((p) => ({ id: p.id, object: p.object.current, dock: p.dock.current }));
    const panelById = new Map(panelList.map((p) => [p.id, p]));
    const shownPanels = panelList.filter((p) => isShown(p.object));
    const pickList = [...picks.current].filter(([, p]) => p.object).map(([id, p]) => ({ id, object: p.object, dock: p.dock }));
    const pickById = new Map(pickList.map((p) => [p.id, p]));
    const dockedOn = (hand) => pickList.find((p) => p.dock.to === hand) ?? null;
    const holding = Object.fromEntries(FRAMES.map((target) => [target, {}])); // target -> hand -> controller, for the hands carrying it
    const pickHolding = {}; // pick id -> hand -> controller
    const pickTouching = {}; // pick id -> hand -> true
    const frameTouching = Object.fromEntries(SIDE_FRAMES.map((target) => [target, {}])); // side frame -> hand -> true
    const bending = {}; // cell index -> how far it's pulled along the frets, in board metres
    const bendingHands = {}; // hand -> the cell it's bending
    const aiming = {}; // hand -> what its ray would grab: 'menu' (a panel) | 'pick' | a frame
    const toolTouching = {}; // hand -> its tip is on, or its ray at, the ToolFrame's pick
    const toolPick = objects.tools?.getObjectByName('ToolPick');
    const { knobs, switches } = effectControls(objects.filter);
    const knobTouching = {}; // effect -> a tip is on its knob, a ray at it, or a grip or trigger holding it
    const switchTouching = {}; // effect -> a tip is on its switch, or a ray at it
    const aimHits = [];
    const stickBusy = {}; // hand -> its grip holds something its stick pushes and pulls
    const gripping = {}; // hand -> what its grip holds: 'menu' (a panel), 'pick', 'knob', 'note' or a frame

    // the panels start on the left controller and the first pick on the right (or whichever there is), until moved
    for (const { dock } of panelList) if (!dock.to && !dock.placed && (controllers.left || controllers.right)) dock.to = controllers.left ? 'left' : 'right';
    for (const p of pickList) if (!p.dock.to && !p.dock.placed && (controllers.left || controllers.right)) p.dock.to = controllers.right ? 'right' : 'left';

    /** Whatever grip has hold of `target` (and pick or panel `id`) lets go of it, taking nothing more until it's let go. */
    const letGo = (target, id) => {
      for (const h of HANDS) if (grabs.current[h]?.target === target && grabs.current[h].id === id) grabs.current[h] = { target: 'none' };
    };

    /**
     * A double tap of `hand`'s grip, touching or pointing at `target` ({
     * target: 'menu' | 'pick', id }, or null): docks that on this controller
     * (a pick docked here already is let go where it is). At nothing, it lets
     * go of whatever is docked on this controller, where it is.
     */
    const doubleTap = (hand, c, target) => {
      if (target?.target === 'menu' && panelById.has(target.id)) {
        letGo('menu', target.id);
        Object.assign(panelById.get(target.id).dock, { to: hand, placed: true });
      } else if (target?.target === 'pick' && pickById.has(target.id)) {
        const p = pickById.get(target.id);
        const mine = dockedOn(hand);
        if (mine && mine !== p) Object.assign(mine.dock, { to: null, placed: true });
        letGo('pick', p.id);
        Object.assign(p.dock, { to: hand, placed: true, scale: _scale.setFromMatrixScale(p.object.matrixWorld).x });
      } else {
        const docked = dockedOn(hand);
        const panelsHere = panelList.filter((p) => p.dock.to === hand);
        if (!panelsHere.length && !docked) return;
        for (const p of panelsHere) Object.assign(p.dock, { to: null, placed: true });
        if (docked) Object.assign(docked.dock, { to: null, placed: true });
        playClick('detach');
        pulse(c.gamepad, DETACH_PULSE);
        return;
      }
      playClick('attach');
      pulse(c.gamepad, DOCK_PULSE);
    };

    /** A triple tap of `hand`'s grip: every panel that isn't docked (free, or held) docks on this controller, flying there. */
    const tripleTap = (hand, c) => {
      const free = panelList.filter((p) => !p.dock.to);
      if (!free.length) return;
      for (const p of free) {
        letGo('menu', p.id);
        p.object.updateMatrixWorld();
        Object.assign(p.dock, { to: hand, placed: true, fly: { from: p.object.matrixWorld.clone(), t0: performance.now() / 1000 } });
      }
      playClick('attach');
      pulse(c.gamepad, DOCK_PULSE);
    };

    /** What `hand`'s ray points at that a grip could take, nearest first: { target, id?, hit } or null. */
    const aim = (hand, c) => {
      raycaster.ray.copy(c.ray);
      const candidates = [];
      for (const p of shownPanels) {
        const [hit] = raycaster.intersectObject(p.object, true);
        if (hit) candidates.push({ target: 'menu', id: p.id, hit });
      }
      // picks' meshes opt out of pointer events, so they're tested directly; not one docked on this controller
      for (const p of pickList) {
        if (!p.object.visible || p.dock.to === hand) continue;
        aimHits.length = 0;
        THREE.Mesh.prototype.raycast.call(p.object, raycaster, aimHits);
        if (aimHits.length) candidates.push({ target: 'pick', id: p.id, hit: aimHits.sort((a, b) => a.distance - b.distance)[0] });
      }
      for (const knob of knobs) {
        const [hit] = raycaster.intersectObject(knob, false);
        if (hit) candidates.push({ target: 'knob', effect: knob.userData.effect, hit });
      }
      for (const target of FRAMES) {
        const moulding = objects[target]?.getObjectByName(MOULDINGS[target]);
        const [hit] = moulding ? raycaster.intersectObject(moulding, true) : [];
        if (hit) candidates.push({ target, hit });
      }
      return candidates.sort((a, b) => a.hit.distance - b.hit.distance)[0] ?? null;
    };

    /**
     * What `c`'s ray points at that its trigger selects: { target: 'chord',
     * chord }, { target: 'tool' }, or { target: 'knob' | 'switch', effect },
     * or null (a panel in front blocks it).
     */
    const triggerAim = (c) => {
      raycaster.ray.copy(c.ray);
      const candidates = [];
      for (const p of shownPanels) {
        const [hit] = raycaster.intersectObject(p.object, true);
        if (hit) candidates.push({ target: 'menu', hit });
      }
      const nodes = objects.chords?.getObjectByName('ChordNodes');
      if (nodes) {
        const [hit] = raycaster.intersectObjects(nodes.children, false);
        if (hit) candidates.push({ target: 'chord', chord: chordOfNode(objects.chords, nodes.children.indexOf(hit.object)), hit });
      }
      // the ToolFrame's pick opts out of pointer events too
      if (toolPick) {
        aimHits.length = 0;
        THREE.Mesh.prototype.raycast.call(toolPick, raycaster, aimHits);
        if (aimHits.length) candidates.push({ target: 'tool', hit: aimHits.sort((a, b) => a.distance - b.distance)[0] });
      }
      for (const [target, meshes] of [
        ['knob', knobs],
        ['switch', switches],
      ])
        for (const mesh of meshes) {
          const [hit] = raycaster.intersectObject(mesh, false);
          if (hit) candidates.push({ target, effect: mesh.userData.effect, hit });
        }
      const nearest = candidates.sort((a, b) => a.hit.distance - b.hit.distance)[0];
      return nearest && nearest.target !== 'menu' ? nearest : null;
    };

    /** The ToolFrame's pick, touched or triggered by `hand`: a new pick for it, unless it has one or its grip is held. */
    const takeFromToolbox = (hand, c) => {
      if (c.squeeze || dockedOn(hand)) return;
      spawnPick(hand);
      playClick('attach');
      pulse(c.gamepad, DOCK_PULSE);
    };

    /** Taking hold of effect `effect`'s knob with the tip at `_tip`: where the slide starts from. */
    const holdKnob = (effect) => {
      const start = effectAmounts.current[effect];
      return { effect, from: knobAmountAt(objects.filter, _tip, false), start, step: Math.round(start * KNOB_TICKS) };
    };

    /** One frame of sliding the knob held in `hold` by `c`: along the track as far as the hand has moved since. */
    const slideKnob = (hold, c) => {
      controllerTip(c.rayMatrix, _tip);
      const amount = THREE.MathUtils.clamp(hold.start + knobAmountAt(objects.filter, _tip, false) - hold.from, 0, 1);
      if (amount !== effectAmounts.current[hold.effect]) onEffectSlide(hold.effect, amount);
      knobTouching[hold.effect] = true;
      const step = Math.round(amount * KNOB_TICKS);
      if (step !== hold.step) pulse(c.gamepad, BEND_TICK);
      hold.step = step;
    };

    /** Where held `panel` would dock if let go now: the other hand, 'frame' or null. */
    const dockZone = (hand, panel) => {
      _centre.setFromMatrixPosition(panel.matrixWorld);
      const other = hand === 'left' ? 'right' : 'left';
      if (controllers[other]?.position.distanceTo(_centre) < DOCK_REACH) return other;
      if (fretboard && nearFrame(fretboard, strings, _centre, FRAME_REACH)) return 'frame';
      return null;
    };

    const now = performance.now() / 1000;
    for (const hand of HANDS) {
      const c = controllers[hand];
      // a grip's second press soon after a short tap is a double tap: it docks or undocks (see below), and takes nothing
      // (and a third, a triple tap)
      const tap = (taps.current[hand] ??= { down: false, pressedAt: -1, tappedAt: -Infinity, count: 0 });
      const squeezed = Boolean(c?.squeeze);
      let doubleTapped = false;
      let tripleTapped = false;
      if (squeezed && !tap.down) {
        tap.count = now - tap.tappedAt < DOUBLE_TAP ? tap.count + 1 : 1; // (this press: the count-th tap in a row)
        tap.tappedAt = -Infinity;
        tap.pressedAt = now;
        doubleTapped = tap.count === 2;
        tripleTapped = tap.count >= 3;
      } else if (!squeezed && tap.down) {
        tap.tappedAt = tap.count < 3 && now - tap.pressedAt <= TAP ? now : -Infinity; // (a short press is a tap, unless it ended a triple)
      }
      tap.down = squeezed;
      let grab = grabs.current[hand];
      if (c) controllerTip(c.rayMatrix, _tip);
      // the controller a pick is docked on is always touching it, so doesn't count
      let pickTouched = null;
      for (const p of pickList) {
        if (!c || !p.object.visible || p.dock.to === hand || !touchesPick(p.object, _tip, CONTROLLER_RADIUS)) continue;
        (pickTouching[p.id] ??= {})[hand] = true;
        pickTouched ??= p;
      }
      // a side frame glows under a tip on its moulding
      const sideTouched = SIDE_FRAMES.find((target) => c && objects[target] && touchesSideFrame(objects[target], _tip, CONTROLLER_RADIUS));
      if (sideTouched) frameTouching[sideTouched][hand] = true;
      // coming onto the ToolFrame's pick takes a new pick from it
      if (c && toolPick) {
        toolTouching[hand] = touchesPick(toolPick, _tip, CONTROLLER_RADIUS);
        if (toolTouching[hand] && !tools.current[hand]) takeFromToolbox(hand, c);
      }
      tools.current[hand] = Boolean(toolTouching[hand]);
      const knobTouched = c ? knobs.find((knob) => touchesEffectKnob(knob, _tip, CONTROLLER_RADIUS))?.userData.effect : undefined;
      if (knobTouched) knobTouching[knobTouched] = true;
      // coming onto an effect's switch switches it in or out
      const switchTouched = c ? switches.find((button) => touchesEffectSwitch(button, _tip, CONTROLLER_RADIUS))?.userData.effect : undefined;
      if (switchTouched) {
        switchTouching[switchTouched] = true;
        if (switchTouched !== switchesTouched.current[hand]) {
          onEffectSwitch(switchTouched);
          pulse(c.gamepad, SELECT_PULSE);
        }
      }
      switchesTouched.current[hand] = switchTouched;
      // pulling the trigger at a chord node selects its chord; at the ToolFrame's pick, takes a new pick; pointing at that, it glows
      const triggerTarget = c ? triggerAim(c) : null;
      if (triggerTarget?.target === 'tool' && !c.squeeze) toolTouching[hand] = true;
      const triggered = Boolean(c?.trigger);
      if (triggered && !triggers.current[hand]) {
        if (triggerTarget?.target === 'chord' && triggerTarget.chord) {
          onChord(triggerTarget.chord);
          pulse(c.gamepad, SELECT_PULSE);
        } else if (triggerTarget?.target === 'tool') takeFromToolbox(hand, c);
        else if (triggerTarget?.target === 'switch') {
          onEffectSwitch(triggerTarget.effect);
          pulse(c.gamepad, SELECT_PULSE);
        } else if (triggerTarget?.target === 'knob' && !grab) triggerKnob.current[hand] = holdKnob(triggerTarget.effect);
      }
      triggers.current[hand] = triggered;
      // the trigger slides the knob it took for as long as it's held
      if (!triggered || !objects.filter) delete triggerKnob.current[hand];
      if (triggerKnob.current[hand]) slideKnob(triggerKnob.current[hand], c);
      if (triggerTarget?.target === 'knob') knobTouching[triggerTarget.effect] = true;
      if (triggerTarget?.target === 'switch') switchTouching[triggerTarget.effect] = true;
      // what a grip from this hand would take by pointing, unless it's holding something; it glows, as when touched
      const aimed = c && !(c.squeeze && grab) ? aim(hand, c) : null;
      if (aimed) aiming[hand] = aimed.target;
      if (aimed?.target === 'pick') (pickTouching[aimed.id] ??= {})[hand] = true;
      if (SIDE_FRAMES.includes(aimed?.target)) frameTouching[aimed.target][hand] = true;
      if (aimed?.target === 'knob') knobTouching[aimed.effect] = true;
      if (tripleTapped) {
        tripleTap(hand, c);
        grab = grabs.current[hand] = { target: 'none' };
      } else if (doubleTapped) {
        // what it docks: a pick or a panel it's touching (not one docked here), else one it points at
        const panelTouched = shownPanels.find((p) => p.dock.to !== hand && touchesPanel(p.object, _tip, CONTROLLER_RADIUS));
        const target = pickTouched
          ? { target: 'pick', id: pickTouched.id }
          : panelTouched
            ? { target: 'menu', id: panelTouched.id }
            : aimed?.target === 'pick' || (aimed?.target === 'menu' && panelById.get(aimed.id).dock.to !== hand)
              ? aimed
              : null;
        doubleTap(hand, c, target);
        grab = grabs.current[hand] = { target: 'none' };
      }
      if (!c?.squeeze) {
        // letting go of a pick, if no other hand has it, docks it on a controller within reach, or puts it back in the toolbox
        const other = hand === 'left' ? 'right' : 'left';
        if (c && grab?.target === 'pick' && grab.zone && pickById.has(grab.id)) {
          const otherHolds = grabs.current[other]?.target === 'pick' && grabs.current[other].id === grab.id && controllers[other]?.squeeze;
          if (!otherHolds && grab.zone === 'toolbox') {
            removePick(grab.id);
            playClick('detach');
            pulse(c.gamepad, DETACH_PULSE);
          } else if (!otherHolds) {
            const p = pickById.get(grab.id);
            p.dock.to = grab.zone;
            p.dock.scale = _scale.setFromMatrixScale(p.object.matrixWorld).x;
            pulse(controllers[grab.zone]?.gamepad ?? c.gamepad, DOCK_PULSE);
            playClick('attach');
          }
        }
        // letting go of a panel docks it, if it was within reach of a dock
        const heldPanel = grab?.target === 'menu' ? panelById.get(grab.id) : null;
        if (c && heldPanel && grab.zone) {
          const { object: panel, dock } = heldPanel;
          if (grab.zone === 'frame') {
            fretboard.updateWorldMatrix(true, false);
            dock.offset = frameDockOffset(fretboard, strings, panel, text);
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
      // touching comes first: a pick, the notes this controller's docked pick touches, the panel (not from the
      // controller it's docked on, which is always close to it), a note, a frame; then whatever the ray points at
      let pickNotes = [];
      const ownPick = dockedOn(hand);
      if (!grab && fretboard && ownPick?.object.visible) {
        const { points, radius } = pickPoints(ownPick.object);
        pickNotes = touchedCellsByPoints(fretboard, points, radius, c.trigger);
      }
      const menuTouched = grab ? null : shownPanels.find((p) => p.dock.to !== hand && touchesPanel(p.object, _tip, CONTROLLER_RADIUS));
      const noteTouched = !grab && fretboard ? touchedCells(fretboard, _tip, CONTROLLER_RADIUS, c.trigger) : [];
      const neckTouched = !grab && fretboard && touchesFrame(fretboard, strings, _tip, CONTROLLER_RADIUS);
      let take = null;
      if (!grab) {
        if (pickTouched) take = { target: 'pick', id: pickTouched.id };
        else if (pickNotes.length) take = { target: 'note', indices: pickNotes, byPick: ownPick.id };
        else if (menuTouched) take = { target: 'menu', id: menuTouched.id, point: _tip };
        else if (noteTouched.length) take = { target: 'note', indices: noteTouched.slice(0, 1) };
        else if (knobTouched) take = { target: 'knob', effect: knobTouched };
        else if (neckTouched) take = { target: 'board' };
        else if (sideTouched) take = { target: sideTouched };
        else if (aimed) take = { target: aimed.target, id: aimed.id, effect: aimed.effect, point: aimed.hit.point };
      }
      if (take?.target === 'pick') {
        // a new grip on a pick takes it, off its dock if it's docked
        const p = pickById.get(take.id);
        if (p.dock.to) {
          playClick('detach');
          pulse(c.gamepad, DETACH_PULSE);
        } else pulse(c.gamepad, GRAB_PULSE);
        Object.assign(p.dock, { to: null, placed: true });
        grab = grabs.current[hand] = { target: 'pick', id: take.id, zone: null };
      }
      if (!grab) {
        if (take?.target === 'menu') {
          const { object: panel, dock } = panelById.get(take.id);
          if (dock.to) {
            playClick('detach');
            pulse(c.gamepad, DETACH_PULSE);
          }
          dock.to = null;
          dock.placed = true;
          dock.fly = null; // (caught in flight)
          // the other hand lets go of it, if it had it
          letGo('menu', take.id);
          const gripInverse = c.grip.clone().invert();
          grab = {
            target: 'menu',
            id: take.id,
            offset: gripInverse.clone().multiply(panel.matrixWorld),
            point: take.point.clone().applyMatrix4(gripInverse), // grows about where it was taken, in grip space
            size: 1,
            grow: (FREE_SCALE * text) / _scale.setFromMatrixScale(panel.matrixWorld).x,
            zone: null,
          };
        } else if (take?.target === 'note') {
          // the note the tip is on (the nearest, if it's between two), or every note the docked pick touches:
          // bent from where the hand is now
          grab = { target: 'note', indices: take.indices, byPick: take.byPick ?? null, from: fretboard.worldToLocal(_tip.clone()).x, step: 0 };
          pulse(c.gamepad, BEND_PULSE);
        } else if (take?.target === 'knob' && objects.filter && !triggerKnob.current[hand]) {
          grab = { target: 'knob', ...holdKnob(take.effect) };
          pulse(c.gamepad, BEND_PULSE);
        } else if (FRAMES.includes(take?.target)) {
          grab = { target: take.target };
          pulse(c.gamepad, GRAB_PULSE);
        } else {
          grab = { target: 'none' };
        }
        grabs.current[hand] = grab;
      }
      // the stick pushes and pulls a frame or pick held in this hand alone: its offset from the grip shifts along the ray
      const carriedBy = FRAMES.includes(grab.target) ? carried.current[grab.target] : grab.target === 'pick' ? carried.current[`pick:${grab.id}`] : null;
      if (FRAMES.includes(grab.target) || grab.target === 'pick' || grab.target === 'menu') stickBusy[hand] = true;
      if (grab.target !== 'none') gripping[hand] = grab.target;
      if (carriedBy?.oneHand?.hand === hand) {
        const u = pushStep(c, _centre.setFromMatrixPosition(carriedBy.oneHand.offset).length(), dt);
        if (u) carriedBy.oneHand.offset.premultiply(_step.makeTranslation(u.x, u.y, u.z));
      }
      if (FRAMES.includes(grab.target)) holding[grab.target][hand] = c;
      else if (grab.target === 'pick') (pickHolding[grab.id] ??= {})[hand] = c;
      else if (grab.target === 'knob' && objects.filter) slideKnob(grab, c);
      else if (grab.target === 'note' && fretboard) {
        // how far the hand has moved along the frets since it took hold, as far as BEND_MAX either way
        controllerTip(c.rayMatrix, _tip);
        const along = fretboard.worldToLocal(_tip).x - grab.from;
        const pulled = THREE.MathUtils.clamp(along, -BEND_MAX * SPACING, BEND_MAX * SPACING);
        for (const index of grab.indices) bending[index] = pulled;
        // the mallet bending them keeps sounding just those: the pick, or the controller's sphere
        bendingHands[grab.byPick != null ? `pick:${grab.byPick}` : hand] = grab.indices;
        const step = Math.trunc(pulled / SPACING);
        if (step !== grab.step) pulse(c.gamepad, BEND_TICK);
        grab.step = step;
      } else if (grab.target === 'menu' && panelById.has(grab.id)) {
        const panel = panelById.get(grab.id).object;
        // keeps its pose in the hand, easing to full size about the point it was taken by; the stick moves both along the ray
        const u = pushStep(c, grab.point.length(), dt);
        if (u) {
          grab.offset.premultiply(_step.makeTranslation(u.x, u.y, u.z));
          grab.point.add(u);
        }
        grab.size += (grab.grow - grab.size) * (1 - Math.exp(-GROW_RATE * Math.min(dt, 0.1)));
        const { x, y, z } = grab.point;
        _offset.makeTranslation(x, y, z).multiply(_step.makeScale(grab.size, grab.size, grab.size));
        _offset.multiply(_step.makeTranslation(-x, -y, -z)).multiply(grab.offset);
        carry(panel, c.grip, _offset);
        panel.updateMatrixWorld();
        const zone = dockZone(hand, panel);
        if (zone && zone !== grab.zone) pulse(zone === 'frame' ? c.gamepad : controllers[zone].gamepad, ZONE_TICK);
        grab.zone = zone;
      }
    }
    const flags = (hands = {}) => ({ left: Boolean(hands.left), right: Boolean(hands.right) });
    handles.current.holding = flags(holding.board);
    handles.current.frames = Object.fromEntries(SIDE_FRAMES.map((t) => [t, { touching: flags(frameTouching[t]), holding: flags(holding[t]) }]));
    handles.current.picks = Object.fromEntries(
      pickList.map((p) => [p.id, { touching: flags(pickTouching[p.id]), holding: flags(pickHolding[p.id]), docked: p.dock.to }]),
    );
    handles.current.aiming = aiming;
    handles.current.stickBusy = stickBusy;
    handles.current.gripping = gripping;
    handles.current.toolTouching = flags(toolTouching);
    handles.current.effectKnobs = knobTouching;
    handles.current.effectSwitches = switchTouching;
    handles.current.bending = bending;
    handles.current.bendingHands = bendingHands;
    const carryState = (key) => (carried.current[key] ??= { oneHand: null, last: {} });
    for (const target of FRAMES) carryByHands(objects[target], holding[target], carryState(target));
    for (const p of pickList) carryByHands(p.object, pickHolding[p.id] ?? {}, carryState(`pick:${p.id}`));

    if (toolPick) toolPick.getWorldPosition(_toolCentre);
    _mouth.copy(PICK_MOUTH_POSITION).applyMatrix4(camera.matrixWorld);
    for (const p of pickList) {
      // held in one hand, a pick can dock on the other controller, if that has none, or at the mouth, or go back in the
      // toolbox: a tick as it comes within reach
      const pickHands = Object.keys(pickHolding[p.id] ?? {});
      for (const hand of pickHands) {
        const grab = grabs.current[hand];
        let zone = null;
        if (pickHands.length === 1) {
          p.object.updateMatrixWorld();
          _centre.setFromMatrixPosition(p.object.matrixWorld);
          const other = hand === 'left' ? 'right' : 'left';
          if (controllers[other]?.position.distanceTo(_centre) < PICK_DOCK_REACH && !dockedOn(other)) zone = other;
          else if (_mouth.distanceTo(_centre) < MOUTH_REACH && !pickList.some((q) => q !== p && q.dock.to === 'mouth')) zone = 'mouth';
          else if (toolPick && _toolCentre.distanceTo(_centre) < TOOLBOX_REACH) zone = 'toolbox';
        }
        if (zone && zone !== grab.zone) pulse((controllers[zone] ?? controllers[hand]).gamepad, ZONE_TICK);
        grab.zone = zone;
      }
      // docked, it follows its controller, pointing forward (on an untracked controller it hides), or the head
      p.object.visible = true;
      if (p.dock.to === 'mouth') {
        carry(p.object, camera.matrixWorld, _offset.compose(PICK_MOUTH_POSITION, PICK_MOUTH_ROTATION, _scale.setScalar(p.dock.scale ?? 1)));
      } else if (p.dock.to) {
        const c = controllers[p.dock.to];
        p.object.visible = Boolean(c);
        if (c) carry(p.object, c.rayMatrix, _offset.compose(PICK_DOCK_POSITION, PICK_DOCK_ROTATION, _scale.setScalar(p.dock.scale ?? 1)));
      }
    }

    // a docked panel follows its dock, after the Fretboard has moved; on an untracked controller it hides. On a
    // controller they stack upward from the last
    const lift = { left: 0, right: 0 };
    for (const { object: panel, dock } of [...panelList].reverse()) {
      panel.visible = true;
      if (dock.to === 'frame' && fretboard) {
        fretboard.updateWorldMatrix(true, false);
        carry(panel, fretboard.matrixWorld, dock.offset);
      } else if (dock.to === 'left' || dock.to === 'right') {
        const c = controllers[dock.to];
        panel.visible = Boolean(c);
        if (c) carry(panel, c.rayMatrix, controllerDockOffset(panel, lift[dock.to], text));
        lift[dock.to] += dockedHeight(panel, text) + STACK_GAP;
        // flying there after a triple tap: between where it set off and its dock, eased
        const t = dock.fly && c ? (now - dock.fly.t0) / FLY : 1;
        if (t < 1) {
          const k = THREE.MathUtils.smootherstep(t, 0, 1);
          panel.updateMatrixWorld();
          dock.fly.from.decompose(_flyFrom.position, _flyFrom.quaternion, _flyFrom.scale);
          panel.matrixWorld.decompose(_flyTo.position, _flyTo.quaternion, _flyTo.scale);
          _flight.compose(_flyFrom.position.lerp(_flyTo.position, k), _flyFrom.quaternion.slerp(_flyTo.quaternion, k), _flyFrom.scale.lerp(_flyTo.scale, k));
          carry(panel, _noMatrix, _flight);
        } else dock.fly = null;
      }
    }
  });
}
