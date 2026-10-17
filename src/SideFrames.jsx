import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FRAME_BORDER, FRAME_COLOR, frameGeometry, frameSize, touchesMoulding } from './Fretboard.jsx';
import { chordName, noteCss, noteRgb, sameChord } from './music.js';
import { PICK_COLOR, pickGeometry } from './Pick.jsx';

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

/**
 * Where each side frame's centre starts, across from the Fretboard's
 * (whatever its strings, the NeckFrame is as wide).
 */
const neckOuterX = frameSize(1).outerX;
export const CHORD_FRAME_OFFSET = -(neckOuterX + GAP + FRAME_BORDER + CHORD_INNER_X);
export const TOOL_FRAME_OFFSET = neckOuterX + GAP + FRAME_BORDER + TOOL_INNER;

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
