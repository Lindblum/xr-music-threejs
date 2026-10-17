import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FRAME_BORDER, FRAME_COLOR, frameGeometry, frameSize, touchesMoulding } from './Fretboard.jsx';
import { chordName, noteCss, noteRgb, sameChord } from './music.js';
import { PICK_COLOR, pickGeometry } from './Pick.jsx';
import { FILTERS, setFilterAmount } from './audio.js';

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
// The FilterFrame, below: a slider for the filter (see audio.js), like a wah
// pedal stood on end. Its knob, taken by a grip or the trigger (or dragged
// with the mouse), slides up and down the track and stays where it's let go:
// bottom is heel down, top toe down. The frame dims while the filter is off.

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
const FILTER_INNER_X = 0.06; // half the FilterFrame's opening, across...
const FILTER_INNER_Y = 0.2; // ...and down
const TRACK_CENTRE = -0.03; // the track's middle, below the label
const TRAVEL = 0.26; // how far the knob's centre slides, end to end
const TRACK = [0.012, TRAVEL + 0.04, 0.01];
const KNOB = [0.08, 0.04, 0.04];
const KNOB_RAISE = 0.03;
const LABEL_Y = 0.155;
const LABEL_SIZE = [0.11, 0.055];
const FILTER_ON = '#e0a030';
const FILTER_OFF = '#4a4a4a';

/**
 * Where each side frame's centre starts, across from the Fretboard's
 * (whatever its strings, the NeckFrame is as wide).
 */
const neckOuterX = frameSize(1).outerX;
export const CHORD_FRAME_OFFSET = -(neckOuterX + GAP + FRAME_BORDER + CHORD_INNER_X);
export const TOOL_FRAME_OFFSET = neckOuterX + GAP + FRAME_BORDER + TOOL_INNER;

/** Where the FilterFrame's centre starts, below the Fretboard's with `strings` rows. */
export const filterFrameOffsetY = (strings) => -(frameSize(strings).outerY + GAP + FRAME_BORDER + FILTER_INNER_Y);

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

/** The filter's name, for the FilterFrame's label, lit while it's on. Shared by every FilterFrame. */
const filterLabels = new Map();
function filterLabel(name, on) {
  const id = `${name}|${on}`;
  if (!filterLabels.has(id)) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = on ? FILTER_ON : '#8a8a8a';
    ctx.font = '600 72px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, canvas.width / 2, 70, canvas.width - 16);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    filterLabels.set(id, texture);
  }
  return filterLabels.get(id);
}

const trackGeometry = new THREE.BoxGeometry(...TRACK);
const fillGeometry = new THREE.BoxGeometry(TRACK[0] * 1.6, 1, TRACK[2] * 1.6); // stretched up to the knob each frame
const knobGeometry = new THREE.BoxGeometry(...KNOB);

/** The knob's height in FilterFrame space for the slider at `amount`. */
const knobY = (amount) => TRACK_CENTRE + (amount - 0.5) * TRAVEL;

/**
 * Where `world` is along the FilterFrame's track, as the slider's 0..1
 * (clamped, unless `clamp` is false).
 */
export function knobAmountAt(filterFrame, world, clamp = true) {
  const y = filterFrame.worldToLocal(_local.copy(world)).y;
  const amount = (y - TRACK_CENTRE) / TRAVEL + 0.5;
  return clamp ? THREE.MathUtils.clamp(amount, 0, 1) : amount;
}

/** Whether a sphere at `world` (radius in metres) touches the FilterFrame's knob. */
export function touchesFilterKnob(knob, world, radius) {
  knob.worldToLocal(_local.copy(world));
  const r = radius / _scale.setFromMatrixScale(knob.matrixWorld).x;
  const dx = Math.max(Math.abs(_local.x) - KNOB[0] / 2, 0);
  const dy = Math.max(Math.abs(_local.y) - KNOB[1] / 2, 0);
  const dz = Math.max(Math.abs(_local.z) - KNOB[2] / 2, 0);
  return dx * dx + dy * dy + dz * dz <= r * r;
}

const _pointer = new THREE.Vector2();
const _plane = new THREE.Plane();
const _normal = new THREE.Vector3();
const _onPlane = new THREE.Vector3();

/**
 * The FilterFrame, in `groupRef`, for the filter `filter` (an id from
 * FILTERS). `amount.current` is the slider (0..1), which the knob follows;
 * it glows while `handles.current.filterKnob` (hand -> true) says a hand
 * touches or holds it. With `hoverEnabled` the mouse drags it, anywhere
 * along the track: a press on the track jumps it there.
 */
export function FilterFrame({ groupRef, filter, amount, handles, hoverEnabled, ...props }) {
  const on = filter !== 'off';
  const name = FILTERS.find((f) => f.id === filter)?.name ?? '';
  const knob = useRef(null);
  const fill = useRef(null);
  const knobMaterial = useRef(null);
  const controls = useThree((s) => s.controls);
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const dragging = useRef(false);
  const hovered = useRef(false);

  /** The slider to where `ray` (world) crosses the frame's face. */
  const dragAlong = (ray) => {
    const frame = groupRef.current;
    if (!frame) return;
    _normal.set(0, 0, 1).transformDirection(frame.matrixWorld);
    _plane.setFromNormalAndCoplanarPoint(_normal, frame.getWorldPosition(_onPlane));
    if (!ray.intersectPlane(_plane, _onPlane)) return;
    amount.current = knobAmountAt(frame, _onPlane);
    setFilterAmount(amount.current);
  };
  // a drag follows the pointer anywhere on the page, until the button is let go; meanwhile the view stays still
  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const rect = canvas.getBoundingClientRect();
      _pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(_pointer, camera);
      dragAlong(raycaster.ray);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
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
  const mouse = {
    onPointerDown: (e) => {
      if (!hoverEnabled) return;
      e.stopPropagation();
      dragging.current = true;
      if (controls) controls.enabled = false;
      dragAlong(e.ray);
    },
    onPointerOver: () => hoverEnabled && (hovered.current = true),
    onPointerOut: () => (hovered.current = false),
  };

  useFrame(() => {
    const y = knobY(amount.current);
    knob.current?.position.setY(y);
    if (fill.current) {
      const bottom = TRACK_CENTRE - TRACK[1] / 2;
      fill.current.scale.y = Math.max(y - bottom, 0.001);
      fill.current.position.y = (bottom + y) / 2;
    }
    const touched = hovered.current || dragging.current || Object.values(handles.current.filterKnob ?? {}).some(Boolean);
    knobMaterial.current?.emissive.copy(touched ? FRAME_TOUCHED : NO_EMISSIVE);
  });

  return (
    <group ref={groupRef} name="FilterFrame" userData={{ innerX: FILTER_INNER_X, innerY: FILTER_INNER_Y }} {...props}>
      <mesh position={[0, LABEL_Y, 0.005]} raycast={() => null}>
        <planeGeometry args={LABEL_SIZE} />
        <meshBasicMaterial map={filterLabel(name, on)} toneMapped={false} />
      </mesh>
      <mesh geometry={trackGeometry} position-y={TRACK_CENTRE} raycast={() => null}>
        <meshStandardMaterial color="#1b1b1b" roughness={0.8} />
      </mesh>
      <mesh ref={fill} geometry={fillGeometry} raycast={() => null}>
        <meshStandardMaterial color={on ? FILTER_ON : FILTER_OFF} roughness={0.6} />
      </mesh>
      {/* invisible, behind the track: a press anywhere along it takes the knob there */}
      <mesh position={[0, TRACK_CENTRE, -0.01]} {...mouse}>
        <planeGeometry args={[2 * FILTER_INNER_X, TRAVEL + KNOB[1]]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <mesh ref={knob} name="FilterKnob" geometry={knobGeometry} position-z={KNOB_RAISE} {...mouse}>
        <meshStandardMaterial ref={knobMaterial} color={on ? '#e8e8e8' : '#777777'} roughness={0.4} metalness={0.2} />
      </mesh>
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
