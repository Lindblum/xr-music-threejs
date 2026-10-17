import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FRAME_BORDER, FRAME_COLOR, frameGeometry, frameSize } from './Fretboard.jsx';
import { chordName, noteCss, noteRgb, sameChord } from './music.js';
import { PICK_COLOR, pickGeometry } from './Pick.jsx';

// The frames beside the Fretboard's, hung on it so they move, turn and scale
// with it (see Fretboard.jsx for its space).
//
// The ChordFrame, to its left: a node for each degree's triad in the key, a
// row each from I at the top, with its 7th in the scale beside it. Touching a
// node (a controller's tip, a fingertip, or the pick; a click with the mouse)
// selects that chord, and the Fretboard raises its notes (see App.jsx). The
// node of the chord the Fretboard is raising stands out further.
//
// The ToolFrame, to its right: a toolbox. For now it holds a small pick:
// touching it with a controller that has nothing docked on it and isn't
// gripping anything docks the pick there (see Grab.jsx).

const GAP = 0.04; // between the Fretboard's frame and a side frame
const MARGIN = 0.01; // between the nodes and their frame
const NODE_W = 0.13;
const NODE_H = 0.08;
const NODE_D = 0.04;
const COLUMN = 0.15; // between node centres, across
const ROW = 0.1; // ...and down
const NODE_RAISE = 0.05;
const SELECTED_RAISE = 0.15;
const RAISE_RATE = 10; // per second, as the Fretboard's notes
const TOUCH_EMISSIVE = new THREE.Color(0, 0, 1);
const NO_EMISSIVE = new THREE.Color(0, 0, 0);
const TOOL_INNER = 0.05; // half the ToolFrame's opening, each way
const TOOL_PICK_SCALE = 0.6; // of the full-size pick
const TOOL_PICK_RAISE = 0.02;
const TOOL_TOUCHED = new THREE.Color('#3355ff').multiplyScalar(0.35);

/** Half-sizes of the ChordFrame's opening, for `rows` degrees. */
const chordFrameInner = (rows) => ({ innerX: COLUMN + MARGIN, innerY: (Math.max(rows, 1) * ROW) / 2 + MARGIN });

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
 * The ChordFrame, left of a Fretboard with `strings` rows. `chart` is the
 * key's chord chart (see keyChordChart), `selected` the chord the Fretboard
 * is raising (or null), `onSelect(chord)` a node touched or clicked.
 * `handles.current.chordTouching` is the nodes being touched (a Set of
 * indices), which glow; `hoverEnabled` lets the mouse click nodes.
 */
export function ChordFrame({ strings, chart, selected, handles, hoverEnabled, onSelect }) {
  const nodes = useMemo(() => chartNodes(chart), [chart]);
  const { innerX, innerY } = chordFrameInner(chart.length);
  const geometry = useMemo(() => frameGeometry(innerX, innerY), [innerX, innerY]);
  useEffect(() => () => geometry.dispose(), [geometry]);
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
      const raise = sameChord(chord, selected) ? SELECTED_RAISE : NODE_RAISE;
      mesh.position.z += (raise - mesh.position.z) * glide;
      const on = touching.has(i) || hovered.current === i;
      const [side, , , , front] = materials[i];
      side.emissive.copy(on ? TOUCH_EMISSIVE : NO_EMISSIVE);
      front.emissive.copy(on ? TOUCH_EMISSIVE : NO_EMISSIVE);
    });
  });

  const x = -(frameSize(strings).outerX + GAP + innerX + FRAME_BORDER);
  return (
    <group name="ChordFrame" position-x={x}>
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
      <mesh name="ChordFrameMoulding" geometry={geometry}>
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.55} metalness={0.05} />
      </mesh>
    </group>
  );
}

const _local = new THREE.Vector3();
const _scale = new THREE.Vector3();

/**
 * The ChordFrame node nearest any of the spheres at `points` (world, each
 * `radius` metres) that touches it, as an index, or null.
 */
export function touchedChordNode(board, points, radius) {
  const nodes = board?.getObjectByName('ChordNodes');
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
export const chordOfNode = (board, index) => board.getObjectByName('ChordNodes')?.children[index]?.userData.chord ?? null;

/**
 * The ToolFrame, right of a Fretboard with `strings` rows: a small pick,
 * named ToolPick, which glows while a controller touches it
 * (`handles.current.toolTouching`, hand -> true).
 */
export function ToolFrame({ strings, handles }) {
  const geometry = useMemo(() => frameGeometry(TOOL_INNER, TOOL_INNER), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const pick = useMemo(pickGeometry, []);
  useEffect(() => () => pick.dispose(), [pick]);
  const material = useRef(null);
  useFrame(() => {
    const touched = Object.values(handles.current.toolTouching ?? {}).some(Boolean);
    material.current?.emissive.copy(touched ? TOOL_TOUCHED : NO_EMISSIVE);
  });
  const x = frameSize(strings).outerX + GAP + TOOL_INNER + FRAME_BORDER;
  return (
    <group name="ToolFrame" position-x={x}>
      <mesh name="ToolPick" geometry={pick} position-z={TOOL_PICK_RAISE} scale={TOOL_PICK_SCALE} raycast={() => null}>
        <meshPhysicalMaterial ref={material} color={PICK_COLOR} roughness={0.3} clearcoat={1} clearcoatRoughness={0.15} />
      </mesh>
      <mesh name="ToolFrameMoulding" geometry={geometry}>
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.55} metalness={0.05} />
      </mesh>
    </group>
  );
}
