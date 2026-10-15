import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { isInSteps, mod12, noteCss, noteName, noteRgb } from './music.js';

// The Fretboard: one cube per string and fret, like a guitar neck stood up
// in front of the player, inside a picture frame. Each cube is coloured by
// its note, with the name on its front face. Notes in the scale are bright
// and stand out toward the player; the current chord's notes stand out
// further (while a progression plays or is paused, its chord; otherwise the
// key's triad), gliding there when it changes. Notes outside the scale (and
// the chord) don't sound at a touch: the mouse has to
// press them (or drag over them with the button down), and a controller has
// to hold its trigger. The frame is the handle that moves, turns and scales the whole
// Fretboard (see Grab.jsx). Fretboard space has its origin at the centre of
// the notes, x along the frets, y up the strings, z toward the player.

export const FRETS = 25; // open string plus 24 frets
export const SPACING = 0.1; // metres between cube centres
export const CUBE = 0.08; // cube edge
const SCALE_RAISE = 0.1;
const CHORD_RAISE = 0.3;
const TOUCH_EMISSIVE = new THREE.Color(0, 0, 1); // the old page's blue glow
const NO_EMISSIVE = new THREE.Color(0, 0, 0);
const JITTER = 0.1; // touched cubes shiver up to this much larger
const RAISE_RATE = 10; // per second: how quickly cubes glide to a new chord's heights

/** How far a cube stands out: the chord's notes furthest, then the scale's. */
const raise = (inChord, inScale) => (inChord ? CHORD_RAISE : inScale ? SCALE_RAISE : 0);

/** Every cube's note and place on the board (board-local metres). */
export function buildCells(tuning, key, scale) {
  const strings = tuning.strings;
  const cells = [];
  strings.forEach((open, s) => {
    for (let fret = 0; fret < FRETS; fret++) {
      const note = open + fret;
      const inScale = isInSteps(note, key, scale.steps);
      const inChord = isInSteps(note, key, scale.chord);
      cells.push({
        note,
        inScale,
        inChord,
        position: [(fret - (FRETS - 1) / 2) * SPACING, (s - (strings.length - 1) / 2) * SPACING, raise(inChord, inScale)],
      });
    }
  });
  return cells;
}

/** The note name on the cube colour, for the front face. Shared by cubes with the same look. */
const labelTextures = new Map();
function labelTexture(note, inScale) {
  const name = noteName(note);
  const background = noteCss(note, inScale);
  const id = `${name}|${background}`;
  if (!labelTextures.has(id)) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = inScale ? '#000000' : 'rgba(255, 255, 255, 0.75)';
    ctx.font = `600 ${name.length > 1 ? 58 : 70}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 64, 68);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    labelTextures.set(id, texture);
  }
  return labelTextures.get(id);
}

/** One material per cube face group: the sides in the note colour, the label on the front. */
function cubeMaterials(cell) {
  const side = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 });
  side.color.setRGB(...noteRgb(cell.note, cell.inScale), THREE.SRGBColorSpace);
  const front = new THREE.MeshStandardMaterial({ map: labelTexture(cell.note, cell.inScale), roughness: 0.7, metalness: 0 });
  // BoxGeometry groups: +x, -x, +y, -y, +z (front), -z
  return [side, side, side, side, front, side];
}

const geometry = new THREE.BoxGeometry(CUBE, CUBE, CUBE);

/**
 * The Fretboard object: its notes and frame, in `boardRef`.
 * `touches` is a Map of voice -> cell index, written by whatever is touching
 * the notes; touched cubes glow and shiver. `handles` is the frame's
 * { touching, holding } (hand -> true), which light it up.
 * `chord`: the current chord's pitch classes (a Set), or null for the key's
 * triad. `onHover(index | null)` reports the mouse: hovering sounds notes in
 * the scale or chord, and with the button down, any note. Each cube's mesh
 * carries `userData.playable`, whether a touch sounds it.
 */
export function Fretboard({ boardRef, cells, chord, touches, handles, hoverEnabled, onHover, position }) {
  const strings = cells.length / FRETS;
  const meshes = useRef([]);
  const materials = useMemo(() => cells.map(cubeMaterials), [cells]);
  const inChord = useMemo(() => cells.map((cell) => (chord ? chord.has(mod12(cell.note)) : cell.inChord)), [cells, chord]);
  const playable = useMemo(() => cells.map((cell, i) => cell.inScale || inChord[i]), [cells, inChord]);
  const controls = useThree((s) => s.controls);
  const strumming = useRef(false); // the button went down on the board and is still down
  // the button held down plays any note it passes over, so the view stays still meanwhile
  const startStrum = () => {
    strumming.current = true;
    if (controls) controls.enabled = false;
  };

  // letting go of the button ends a strum: an out-of-scale note it held stops, and orbiting resumes
  useEffect(() => {
    const onUp = () => {
      if (!strumming.current) return;
      strumming.current = false;
      if (controls) controls.enabled = true;
      const index = touches.current.get('mouse');
      if (index != null && !playable[index]) onHover(null);
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [controls, touches, playable, onHover]);
  useEffect(
    () => () => {
      for (const [side, , , , front] of materials) {
        side.dispose();
        front.dispose();
      }
    },
    [materials],
  );

  useFrame((_, dt) => {
    const touched = new Set(touches.current.values());
    const glide = 1 - Math.exp(-RAISE_RATE * Math.min(dt, 0.1));
    meshes.current.forEach((mesh, i) => {
      if (!mesh) return;
      mesh.position.z += (raise(inChord[i], cells[i].inScale) - mesh.position.z) * glide;
      mesh.userData.playable = playable[i];
      const on = touched.has(i);
      const [side, , , , front] = materials[i];
      side.emissive.copy(on ? TOUCH_EMISSIVE : NO_EMISSIVE);
      front.emissive.copy(on ? TOUCH_EMISSIVE : NO_EMISSIVE);
      mesh.scale.setScalar(on ? 1 + Math.random() * JITTER : 1);
    });
  });

  return (
    <group ref={boardRef} name="Fretboard" position={position}>
      <group name="Notes">
        {cells.map((cell, i) => (
          <mesh
            key={i}
            ref={(m) => (meshes.current[i] = m)}
            geometry={geometry}
            material={materials[i]}
            position={cell.position}
            castShadow
            receiveShadow
            onPointerOver={(e) => {
              if (!hoverEnabled) return;
              e.stopPropagation();
              if (playable[i] || strumming.current) onHover(i);
            }}
            onPointerOut={() => hoverEnabled && touches.current.get('mouse') === i && onHover(null)}
            onPointerDown={(e) => {
              if (!hoverEnabled) return;
              e.stopPropagation();
              startStrum();
              onHover(null); // a click strikes the note again
              onHover(i);
            }}
          />
        ))}
      </group>
      {/* invisible, behind the notes: pressing between them starts a strum too, rather than orbiting the view */}
      <mesh
        position-z={-CUBE}
        onPointerDown={(e) => {
          if (!hoverEnabled) return;
          e.stopPropagation();
          startStrum();
        }}
      >
        <planeGeometry args={[2 * frameSize(strings).innerX, 2 * frameSize(strings).innerY]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <FretboardFrame strings={strings} handles={handles} />
    </group>
  );
}

// The frame: a moulding around the notes, like a picture frame
const FRAME_MARGIN = 0.01; // between the outer cubes and the frame
const FRAME_BORDER = 0.05; // moulding width
const FRAME_DEPTH = 0.04;
const FRAME_BEVEL = 0.006;
const FRAME_COLOR = '#6b4a2b';
const FRAME_TOUCHED = new THREE.Color('#3355ff').multiplyScalar(0.35);
const FRAME_HELD = new THREE.Color('#3355ff').multiplyScalar(0.7);

/** Half-sizes of the frame's opening and of its outside, in Fretboard space. */
export function frameSize(strings) {
  const innerX = (FRETS * SPACING) / 2 + FRAME_MARGIN;
  const innerY = (strings * SPACING) / 2 + FRAME_MARGIN;
  return { innerX, innerY, outerX: innerX + FRAME_BORDER, outerY: innerY + FRAME_BORDER };
}

function frameGeometry(strings) {
  const { innerX, innerY, outerX, outerY } = frameSize(strings);
  const shape = new THREE.Shape();
  shape.moveTo(-outerX, -outerY).lineTo(outerX, -outerY).lineTo(outerX, outerY).lineTo(-outerX, outerY).closePath();
  const hole = new THREE.Path();
  hole.moveTo(-innerX, -innerY).lineTo(-innerX, innerY).lineTo(innerX, innerY).lineTo(innerX, -innerY).closePath();
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: FRAME_DEPTH - 2 * FRAME_BEVEL,
    bevelEnabled: true,
    bevelThickness: FRAME_BEVEL,
    bevelSize: FRAME_BEVEL,
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -(FRAME_DEPTH - 2 * FRAME_BEVEL) / 2); // centred on the notes' plane
  return geometry;
}

/** The picture frame around the notes: the handle for the whole Fretboard. It glows while touched, more while held. */
function FretboardFrame({ strings, handles }) {
  const geometry = useMemo(() => frameGeometry(strings), [strings]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useRef(null);
  useFrame(() => {
    const { touching, holding } = handles.current;
    const held = Object.values(holding).some(Boolean);
    const touched = Object.values(touching).some(Boolean);
    material.current?.emissive.copy(held ? FRAME_HELD : touched ? FRAME_TOUCHED : NO_EMISSIVE);
  });
  return (
    <mesh name="FretboardFrame" geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial ref={material} color={FRAME_COLOR} roughness={0.55} metalness={0.05} />
    </mesh>
  );
}

const _local = new THREE.Vector3();

/** Whether a sphere at `world` (radius in metres) touches the frame of a Fretboard with `strings` rows. */
export function touchesFrame(board, strings, world, radius) {
  board.worldToLocal(_local.copy(world));
  const r = radius / board.scale.x;
  const { innerX, innerY, outerX, outerY } = frameSize(strings);
  const x = Math.abs(_local.x);
  const y = Math.abs(_local.y);
  if (Math.abs(_local.z) > FRAME_DEPTH / 2 + r || x > outerX + r || y > outerY + r) return false;
  return x > innerX - r || y > innerY - r; // on the moulding, not in the opening
}

/** Whether `world` is within `reach` metres of a Fretboard's frame or anything inside it. */
export function nearFrame(board, strings, world, reach) {
  board.worldToLocal(_local.copy(world));
  const r = reach / board.scale.x;
  const { outerX, outerY } = frameSize(strings);
  return Math.abs(_local.x) < outerX + r && Math.abs(_local.y) < outerY + r && Math.abs(_local.z) < r;
}

/**
 * The cell a sphere at `world` (radius in metres) touches, the nearest if
 * several, or null. Cubes are boxes around their centres, in board space,
 * where they stand now. `outOfScale`: whether notes that aren't playable
 * (outside the scale and chord) count.
 */
export function touchedCell(board, world, radius, outOfScale) {
  const notes = board.getObjectByName('Notes');
  if (!notes) return null;
  board.worldToLocal(_local.copy(world));
  const r = radius / board.scale.x;
  const half = CUBE / 2;
  let best = null;
  let bestDist = Infinity;
  notes.children.forEach((mesh, i) => {
    if (!mesh.userData.playable && !outOfScale) return;
    const { x, y, z } = mesh.position;
    // distance from the sphere's centre to the box
    const dx = Math.max(Math.abs(_local.x - x) - half, 0);
    const dy = Math.max(Math.abs(_local.y - y) - half, 0);
    const dz = Math.max(Math.abs(_local.z - z) - half, 0);
    if (dx * dx + dy * dy + dz * dz > r * r) return;
    const d = (_local.x - x) ** 2 + (_local.y - y) ** 2 + (_local.z - z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}
