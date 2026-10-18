import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FRAME_BORDER, FRAME_COLOR, frameGeometry, frameSize, touchesMoulding } from './Fretboard.jsx';
import { chordName, noteCss, noteRgb, sameChord } from './music.js';
import { PICK_COLOR, pickGeometry } from './Pick.jsx';
import { EFFECTS } from './audio.js';

// The frames that start beside the NeckFrame: each its own handle, which a
// grip moves, turns and scales as the NeckFrame does the Fretboard (see
// Grab.jsx). Each frame's space has its origin at the centre of its opening.
//
// The ChordFrame, to the left: a node for each degree's triad in the key, a
// row each from I at the top, with its 7th in the scale beside it. Touching a
// node (a controller's tip, a fingertip, or a pick; a click with the mouse),
// or pointing a controller at it and pulling the trigger, selects that chord,
// and the Fretboard raises its notes (see App.jsx). The node of the chord the
// Fretboard is raising stands out further.
//
// The ToolFrame, to the right: a toolbox. For now it holds a small pick:
// touching it, or pointing at it and pulling the trigger, with a controller
// that has no pick docked on it and isn't gripping anything gives that
// controller a new pick; a pick let go on it goes back in (see Grab.jsx).
//
// The FilterFrame, below: the effects every note passes through (see
// audio.js), side by side in signal-chain order like a pedalboard, each a
// slider like a pedal stood on end. A slider's knob, taken by a grip or the
// trigger (or dragged with the mouse), slides up and down its track and
// stays where it's let go. The switch atop each effect but the volume,
// touched, triggered or clicked, switches it in or out; an effect that's out
// is dimmed, though its slider still moves. The Reset switch at the end puts
// every effect back as it started.

const GAP = 0.04; // between the NeckFrame and a side frame, to start with
const MARGIN = 0.01; // between the nodes and their frame
const NODE_W = 0.13;
const NODE_H = 0.08;
const NODE_D = 0.04;
const COLUMN = 0.15; // between node centres, across
const ROW = 0.1; // ...and down
const NODE_RAISE = 0.03;
const SELECTED_RAISE = 0.15;
const RAISE_RATE = 10; // per second, as the Fretboard's notes
const TOUCH_EMISSIVE = new THREE.Color(0, 0, 1);
const SELECTED_EMISSIVE = new THREE.Color(0.18, 0.18, 0.18);
const NO_EMISSIVE = new THREE.Color(0, 0, 0);
const FRAME_TOUCHED = new THREE.Color('#3355ff').multiplyScalar(0.35);
const FRAME_HELD = new THREE.Color('#3355ff').multiplyScalar(0.7);
const CHORD_INNER_X = COLUMN + MARGIN; // half the ChordFrame's opening, across
const TOOL_INNER = 0.05; // half the ToolFrame's opening, each way
const TOOL_PICK_SCALE = 0.6; // of a full-size pick
const TOOL_PICK_RAISE = 0.02;
const EFFECT_COLUMN = 0.11; // between the sliders' centres
const COLUMNS = EFFECTS.length + 1; // and the reset's
const FILTER_INNER_X = (COLUMNS * EFFECT_COLUMN) / 2; // half the FilterFrame's opening, across...
const FILTER_INNER_Y = 0.2; // ...and down
const TRACK_CENTRE = -0.03; // the tracks' middle, below the switches
const TRAVEL = 0.26; // how far a knob's centre slides, end to end
const TRACK = [0.012, TRAVEL + 0.04, 0.01];
const KNOB = [0.07, 0.04, 0.04];
const KNOB_RAISE = 0.03;
const SWITCH = [0.1, 0.05, 0.02];
const SWITCH_Y = 0.155;
const SWITCH_RAISE = 0.012;
// each effect lit in its own colour, round the colour wheel in chain order
const EFFECT_COLORS = Object.fromEntries(EFFECTS.map((e, i) => [e.id, `hsl(${Math.round((i * 330) / EFFECTS.length)}, 70%, 58%)`]));
const EFFECT_OFF = '#4a4a4a';
const RESET_COLOR = '#ff6b5e';

/** The Reset switch's id, as an effect's switch would have its effect's. */
export const RESET_EFFECTS = 'reset';

/**
 * Where each side frame's centre starts, across from the Fretboard's
 * (whatever its strings, the NeckFrame is as wide), all at the same scale.
 */
const neckOuterX = frameSize(1).outerX;
export const CHORD_FRAME_OFFSET = -(neckOuterX + GAP + FRAME_BORDER + CHORD_INNER_X);
export const TOOL_FRAME_OFFSET = neckOuterX + GAP + FRAME_BORDER + TOOL_INNER;

/** Where the FilterFrame's centre starts, below the Fretboard's with `strings` rows, scaled by `neckScale`. */
export const filterFrameOffsetY = (strings, neckScale = 1) => -(frameSize(strings).outerY * neckScale + GAP + FRAME_BORDER + FILTER_INNER_Y);

/** Half the ChordFrame's opening, down, for `rows` degrees. */
const chordInnerY = (rows) => (Math.max(rows, 1) * ROW) / 2 + MARGIN;

/** The chord's name on its root's colour, for a node's front face. Shared by nodes with the same chord. */
const labelTextures = new Map();
function labelTexture(chord) {
  const name = chordName(chord);
  if (!labelTextures.has(name)) {
    const canvas = document.createElement('canvas');
    canvas.width = 208;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = noteCss(chord.root, true);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    ctx.font = `600 ${name.length > 4 ? 46 : 58}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, canvas.width / 2, 68, canvas.width - 12);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    labelTextures.set(name, texture);
  }
  return labelTextures.get(name);
}

const nodeGeometry = new THREE.BoxGeometry(NODE_W, NODE_H, NODE_D);

/** The chart's nodes, each { chord, position } in ChordFrame space: triads in the left column, 7ths in the right. */
function chartNodes(chart) {
  const top = ((chart.length - 1) * ROW) / 2;
  return chart.flatMap(({ triad, seventh }, row) =>
    [triad, seventh].flatMap((chord, column) => (chord ? [{ chord, position: [(column - 0.5) * COLUMN, top - row * ROW, NODE_RAISE] }] : [])),
  );
}

/**
 * A side frame's moulding around an opening `innerX` by `innerY`, named
 * `name`. It glows while touched or pointed at, more while held:
 * `handles.current.frames[target]` is { touching, holding } (hand -> true).
 */
function Moulding({ name, target, innerX, innerY, handles }) {
  const geometry = useMemo(() => frameGeometry(innerX, innerY), [innerX, innerY]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useRef(null);
  useFrame(() => {
    const { touching = {}, holding = {} } = handles.current.frames?.[target] ?? {};
    const held = Object.values(holding).some(Boolean);
    const touched = Object.values(touching).some(Boolean);
    material.current?.emissive.copy(held ? FRAME_HELD : touched ? FRAME_TOUCHED : NO_EMISSIVE);
  });
  return (
    <mesh name={name} geometry={geometry}>
      <meshStandardMaterial ref={material} color={FRAME_COLOR} roughness={0.55} metalness={0.05} />
    </mesh>
  );
}

/**
 * The ChordFrame, in `groupRef`. `chart` is the key's chord chart (see
 * keyChordChart), `selected` the chord the Fretboard is raising (or null),
 * `onSelect(chord)` a node touched or clicked. `handles.current.chordTouching`
 * is the nodes being touched (a Set of indices), which glow; `hoverEnabled`
 * lets the mouse click nodes.
 */
export function ChordFrame({ groupRef, chart, selected, handles, hoverEnabled, onSelect, ...props }) {
  const nodes = useMemo(() => chartNodes(chart), [chart]);
  const innerY = chordInnerY(chart.length);
  const materials = useMemo(
    () =>
      nodes.map(({ chord }) => {
        const side = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 });
        side.color.setRGB(...noteRgb(chord.root, true), THREE.SRGBColorSpace);
        const front = new THREE.MeshStandardMaterial({ map: labelTexture(chord), roughness: 0.7, metalness: 0 });
        return [side, side, side, side, front, side];
      }),
    [nodes],
  );
  useEffect(
    () => () => {
      for (const [side, , , , front] of materials) {
        side.dispose();
        front.dispose();
      }
    },
    [materials],
  );
  const meshes = useRef([]);
  const hovered = useRef(null); // the node under the mouse

  useFrame((_, dt) => {
    const touching = handles.current.chordTouching ?? new Set();
    const glide = 1 - Math.exp(-RAISE_RATE * Math.min(dt, 0.1));
    nodes.forEach(({ chord }, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      const chosen = sameChord(chord, selected);
      mesh.position.z += ((chosen ? SELECTED_RAISE : NODE_RAISE) - mesh.position.z) * glide;
      const glow = touching.has(i) || hovered.current === i ? TOUCH_EMISSIVE : chosen ? SELECTED_EMISSIVE : NO_EMISSIVE;
      const [side, , , , front] = materials[i];
      side.emissive.copy(glow);
      front.emissive.copy(glow);
    });
  });

  return (
    <group ref={groupRef} name="ChordFrame" userData={{ innerX: CHORD_INNER_X, innerY }} {...props}>
      <group name="ChordNodes">
        {nodes.map(({ chord, position }, i) => (
          <mesh
            key={`${i}:${chordName(chord)}`}
            ref={(m) => (meshes.current[i] = m)}
            geometry={nodeGeometry}
            material={materials[i]}
            position={position}
            userData={{ chord }}
            onPointerOver={(e) => {
              if (!hoverEnabled) return;
              e.stopPropagation();
              hovered.current = i;
            }}
            onPointerOut={() => hovered.current === i && (hovered.current = null)}
            onPointerDown={(e) => {
              if (!hoverEnabled) return;
              e.stopPropagation();
              onSelect(chord);
            }}
          />
        ))}
      </group>
      <Moulding name="ChordFrameMoulding" target="chords" innerX={CHORD_INNER_X} innerY={innerY} handles={handles} />
    </group>
  );
}

/**
 * The ToolFrame, in `groupRef`: a small pick, named ToolPick, which glows
 * while a controller touches or points at it (`handles.current.toolTouching`,
 * hand -> true).
 */
export function ToolFrame({ groupRef, handles, ...props }) {
  const pick = useMemo(pickGeometry, []);
  useEffect(() => () => pick.dispose(), [pick]);
  const material = useRef(null);
  useFrame(() => {
    const touched = Object.values(handles.current.toolTouching ?? {}).some(Boolean);
    material.current?.emissive.copy(touched ? FRAME_TOUCHED : NO_EMISSIVE);
  });
  return (
    <group ref={groupRef} name="ToolFrame" userData={{ innerX: TOOL_INNER, innerY: TOOL_INNER }} {...props}>
      <mesh name="ToolPick" geometry={pick} position-z={TOOL_PICK_RAISE} scale={TOOL_PICK_SCALE} raycast={() => null}>
        <meshPhysicalMaterial ref={material} color={PICK_COLOR} roughness={0.3} clearcoat={1} clearcoatRoughness={0.15} />
      </mesh>
      <Moulding name="ToolFrameMoulding" target="tools" innerX={TOOL_INNER} innerY={TOOL_INNER} handles={handles} />
    </group>
  );
}

/** An effect's name on its switch, lit in its colour while it's in. Shared by every FilterFrame. */
const switchLabels = new Map();
function switchLabel(effect, on) {
  const id = `${effect.id}|${on}`;
  if (!switchLabels.has(id)) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 112;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = on ? '#262626' : '#161616';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = effect.id === RESET_EFFECTS ? RESET_COLOR : on ? EFFECT_COLORS[effect.id] : '#7a7a7a';
    ctx.font = '600 52px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(effect.name, canvas.width / 2, 60, canvas.width - 20);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    switchLabels.set(id, texture);
  }
  return switchLabels.get(id);
}

const trackGeometry = new THREE.BoxGeometry(...TRACK);
const fillGeometry = new THREE.BoxGeometry(TRACK[0] * 1.6, 1, TRACK[2] * 1.6); // stretched up to the knob each frame
const knobGeometry = new THREE.BoxGeometry(...KNOB);
const switchGeometry = new THREE.BoxGeometry(...SWITCH);

/** A knob's height in FilterFrame space for its slider at `amount`. */
const knobY = (amount) => TRACK_CENTRE + (amount - 0.5) * TRAVEL;

/** Column `i`'s centre, across the FilterFrame. */
const columnX = (i) => (i - (COLUMNS - 1) / 2) * EFFECT_COLUMN;

/**
 * Where `world` is along the FilterFrame's tracks, as a slider's 0..1
 * (clamped, unless `clamp` is false).
 */
export function knobAmountAt(filterFrame, world, clamp = true) {
  const y = filterFrame.worldToLocal(_local.copy(world)).y;
  const amount = (y - TRACK_CENTRE) / TRAVEL + 0.5;
  return clamp ? THREE.MathUtils.clamp(amount, 0, 1) : amount;
}

/** Whether a sphere at `world` (radius in metres) touches a box `size` centred on `mesh`. */
function touchesBox(mesh, size, world, radius) {
  mesh.worldToLocal(_local.copy(world));
  const r = radius / _scale.setFromMatrixScale(mesh.matrixWorld).x;
  const dx = Math.max(Math.abs(_local.x) - size[0] / 2, 0);
  const dy = Math.max(Math.abs(_local.y) - size[1] / 2, 0);
  const dz = Math.max(Math.abs(_local.z) - size[2] / 2, 0);
  return dx * dx + dy * dy + dz * dz <= r * r;
}

/** Whether a sphere at `world` (radius in metres) touches one of the FilterFrame's knobs. */
export const touchesEffectKnob = (knob, world, radius) => touchesBox(knob, KNOB, world, radius);

/** ...or one of its switches. */
export const touchesEffectSwitch = (button, world, radius) => touchesBox(button, SWITCH, world, radius);

/** The FilterFrame's knobs (named EffectKnob) and switches (EffectSwitch), each with `userData.effect`. */
export function effectControls(filterFrame) {
  const knobs = [];
  const switches = [];
  filterFrame?.traverse((o) => {
    if (o.name === 'EffectKnob') knobs.push(o);
    else if (o.name === 'EffectSwitch') switches.push(o);
  });
  return { knobs, switches };
}

const _pointer = new THREE.Vector2();
const _plane = new THREE.Plane();
const _normal = new THREE.Vector3();
const _onPlane = new THREE.Vector3();

/**
 * One effect's column on the FilterFrame: its switch (or, for the volume,
 * just its name), track and knob. `onPress(e)` a mouse press on the knob or
 * the track; `onSwitch()` a click on the switch.
 */
function EffectColumn({ effect, x, on, amount, handles, hoverEnabled, onPress, onSwitch }) {
  const color = on ? EFFECT_COLORS[effect.id] : EFFECT_OFF;
  const knob = useRef(null);
  const fill = useRef(null);
  const knobMaterial = useRef(null);
  const switchMaterial = useRef(null);
  const hovered = useRef(null); // 'knob' | 'switch' under the mouse
  const hover = (part) => ({
    onPointerOver: () => hoverEnabled && (hovered.current = part),
    onPointerOut: () => hovered.current === part && (hovered.current = null),
  });
  useFrame(() => {
    const y = knobY(amount.current[effect.id]);
    knob.current?.position.setY(y);
    if (fill.current) {
      const bottom = TRACK_CENTRE - TRACK[1] / 2;
      fill.current.scale.y = Math.max(y - bottom, 0.001);
      fill.current.position.y = (bottom + y) / 2;
    }
    const knobLit = hovered.current === 'knob' || handles.current.effectKnobs?.[effect.id] || handles.current.draggingEffect === effect.id;
    knobMaterial.current?.emissive.copy(knobLit ? FRAME_TOUCHED : NO_EMISSIVE);
    const switchLit = hovered.current === 'switch' || handles.current.effectSwitches?.[effect.id];
    switchMaterial.current?.emissive.copy(switchLit ? FRAME_TOUCHED : NO_EMISSIVE);
  });
  return (
    <group position-x={x}>
      <mesh
        name={effect.toggle ? 'EffectSwitch' : 'EffectName'}
        geometry={switchGeometry}
        position={[0, SWITCH_Y, SWITCH_RAISE]}
        userData={{ effect: effect.id }}
        {...(effect.toggle
          ? {
              ...hover('switch'),
              onPointerDown: (e) => {
                if (!hoverEnabled) return;
                e.stopPropagation();
                onSwitch();
              },
            }
          : { raycast: () => null })}
      >
        {/* the name on its face; the sides dark */}
        <meshStandardMaterial attach="material-0" color="#202020" />
        <meshStandardMaterial attach="material-1" color="#202020" />
        <meshStandardMaterial attach="material-2" color="#202020" />
        <meshStandardMaterial attach="material-3" color="#202020" />
        <meshStandardMaterial attach="material-4" ref={switchMaterial} map={switchLabel(effect, on)} roughness={0.5} />
        <meshStandardMaterial attach="material-5" color="#202020" />
      </mesh>
      <mesh geometry={trackGeometry} position-y={TRACK_CENTRE} raycast={() => null}>
        <meshStandardMaterial color="#1b1b1b" roughness={0.8} />
      </mesh>
      <mesh ref={fill} geometry={fillGeometry} raycast={() => null}>
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      {/* invisible, behind the track: a press anywhere along it takes the knob there */}
      <mesh position={[0, TRACK_CENTRE, -0.01]} onPointerDown={onPress}>
        <planeGeometry args={[EFFECT_COLUMN, TRAVEL + KNOB[1]]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <mesh
        ref={knob}
        name="EffectKnob"
        geometry={knobGeometry}
        position-z={KNOB_RAISE}
        userData={{ effect: effect.id }}
        onPointerDown={onPress}
        {...hover('knob')}
      >
        <meshStandardMaterial ref={knobMaterial} color={on ? '#e8e8e8' : '#777777'} roughness={0.4} metalness={0.2} />
      </mesh>
    </group>
  );
}

/**
 * The FilterFrame's Reset switch, at the end of the row: a switch with no
 * slider, named and pressed like an effect's (see `onSwitch`).
 */
function ResetSwitch({ x, handles, hoverEnabled, onSwitch }) {
  const material = useRef(null);
  const hovered = useRef(false);
  useFrame(() => {
    const lit = hovered.current || handles.current.effectSwitches?.[RESET_EFFECTS];
    material.current?.emissive.copy(lit ? FRAME_TOUCHED : NO_EMISSIVE);
  });
  return (
    <mesh
      name="EffectSwitch"
      geometry={switchGeometry}
      position={[x, SWITCH_Y, SWITCH_RAISE]}
      userData={{ effect: RESET_EFFECTS }}
      onPointerOver={() => hoverEnabled && (hovered.current = true)}
      onPointerOut={() => (hovered.current = false)}
      onPointerDown={(e) => {
        if (!hoverEnabled) return;
        e.stopPropagation();
        onSwitch();
      }}
    >
      <meshStandardMaterial attach="material-0" color="#202020" />
      <meshStandardMaterial attach="material-1" color="#202020" />
      <meshStandardMaterial attach="material-2" color="#202020" />
      <meshStandardMaterial attach="material-3" color="#202020" />
      <meshStandardMaterial attach="material-4" ref={material} map={switchLabel({ id: RESET_EFFECTS, name: 'Reset' }, true)} roughness={0.5} />
      <meshStandardMaterial attach="material-5" color="#202020" />
    </mesh>
  );
}

/**
 * The FilterFrame, in `groupRef`. `effects` says which switchable effects
 * are in (id -> true), `amounts.current` is each effect's slider (id ->
 * 0..1), which its knob follows and `onSlide(id, amount)` sets, and
 * `onSwitch(id)` presses a switch: an effect's, or RESET_EFFECTS.
 * Knobs and switches glow while `handles.current.effectKnobs` and
 * `effectSwitches` (id -> true) say a hand touches or holds them. With
 * `hoverEnabled` the mouse drags a knob, anywhere along its track (a press on
 * the track jumps it there), and clicks the switches.
 */
export function FilterFrame({ groupRef, effects, amounts, onSlide, onSwitch, handles, hoverEnabled, ...props }) {
  const controls = useThree((s) => s.controls);
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const dragging = useRef(null); // the effect whose knob the mouse is dragging

  /** Effect `id`'s slider to where `ray` (world) crosses the frame's face. */
  const dragAlong = (id, ray) => {
    const frame = groupRef.current;
    if (!frame) return;
    _normal.set(0, 0, 1).transformDirection(frame.matrixWorld);
    _plane.setFromNormalAndCoplanarPoint(_normal, frame.getWorldPosition(_onPlane));
    if (!ray.intersectPlane(_plane, _onPlane)) return;
    onSlide(id, knobAmountAt(frame, _onPlane));
  };
  // a drag follows the pointer anywhere on the page, until the button is let go; meanwhile the view stays still
  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const rect = canvas.getBoundingClientRect();
      _pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(_pointer, camera);
      dragAlong(dragging.current, raycaster.ray);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = null;
      handles.current.draggingEffect = null;
      if (controls) controls.enabled = true;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  });

  return (
    <group ref={groupRef} name="FilterFrame" userData={{ innerX: FILTER_INNER_X, innerY: FILTER_INNER_Y }} {...props}>
      {EFFECTS.map((effect, i) => (
        <EffectColumn
          key={effect.id}
          effect={effect}
          x={columnX(i)}
          on={!effect.toggle || Boolean(effects[effect.id])}
          amount={amounts}
          handles={handles}
          hoverEnabled={hoverEnabled}
          onSwitch={() => onSwitch(effect.id)}
          onPress={(e) => {
            if (!hoverEnabled) return;
            e.stopPropagation();
            dragging.current = effect.id;
            handles.current.draggingEffect = effect.id;
            if (controls) controls.enabled = false;
            dragAlong(effect.id, e.ray);
          }}
        />
      ))}
      <ResetSwitch x={columnX(EFFECTS.length)} handles={handles} hoverEnabled={hoverEnabled} onSwitch={() => onSwitch(RESET_EFFECTS)} />
      <Moulding name="FilterFrameMoulding" target="filter" innerX={FILTER_INNER_X} innerY={FILTER_INNER_Y} handles={handles} />
    </group>
  );
}

/** Whether a sphere at `world` (radius in metres) touches a side frame's moulding. */
export function touchesSideFrame(frame, world, radius) {
  const { innerX, innerY } = frame.userData;
  return touchesMoulding(frame, innerX, innerY, world, radius);
}

const _local = new THREE.Vector3();
const _scale = new THREE.Vector3();

/**
 * The ChordFrame node nearest any of the spheres at `points` (world, each
 * `radius` metres) that touches it, as an index, or null.
 */
export function touchedChordNode(chordFrame, points, radius) {
  const nodes = chordFrame?.getObjectByName('ChordNodes');
  if (!nodes) return null;
  let best = null;
  let bestD = Infinity;
  nodes.children.forEach((mesh, i) => {
    const r = radius / _scale.setFromMatrixScale(mesh.matrixWorld).x;
    for (const p of points) {
      mesh.worldToLocal(_local.copy(p));
      const dx = Math.max(Math.abs(_local.x) - NODE_W / 2, 0);
      const dy = Math.max(Math.abs(_local.y) - NODE_H / 2, 0);
      const dz = Math.max(Math.abs(_local.z) - NODE_D / 2, 0);
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      const d = _local.lengthSq();
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  });
  return best;
}

/** The chord on the ChordFrame's node `index`. */
export const chordOfNode = (chordFrame, index) => chordFrame.getObjectByName('ChordNodes')?.children[index]?.userData.chord ?? null;
