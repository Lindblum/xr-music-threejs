import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { isInSteps, mod12, noteCss, noteName, noteRgb } from './music.js';

// The Fretboard: one cube per string and fret, like a guitar neck stood up
// in front of the player, inside a picture frame, the NeckFrame. Each cube is coloured by
// its note, with the name on its front face. Notes in the scale are bright
// and stand out toward the player; the current chord's notes stand out
// further (while a progression plays or is paused, its chord; otherwise the
// key's triad), gliding there when it changes. Notes outside the scale (and
// the chord) don't sound at a touch: the mouse has to
// press them (or drag over them with the button down), and a controller has
// to hold its trigger. A note can be bent: taken by a grip (see Grab.jsx) and
// pulled along the frets, a fret's width for each semitone, it slides with
// the hand and its pitch follows; let go, it springs back home and its pitch
// with it. The NeckFrame is the handle that moves, turns and scales the whole
// Fretboard (see Grab.jsx). Fretboard space has its origin at the centre of
// the notes, x along the frets, y up the strings, z toward the player.

export const FRETS = 25; // open string plus 24 frets
export const SPACING = 0.1; // metres between cube centres
export const CUBE = 0.08; // cube edge
const SCALE_RAISE = 0.15;
const CHORD_RAISE = 0.3;
const TOUCH_EMISSIVE = new THREE.Color(0, 0, 1); // the old page's blue glow
const NO_EMISSIVE = new THREE.Color(0, 0, 0);
const JITTER = 0.1; // touched cubes shiver up to this much larger
const RAISE_RATE = 10; // per second: how quickly cubes glide to a new chord's heights
const RETURN_RATE = 14; // per second: how quickly a let-go bent note springs home
const MOUSE_FULL_SPEED = 2500; // px per second: the mouse this fast onto a note strikes it at full velocity
const MOUSE_STILL = 0.1; // seconds without a move: the mouse has stopped

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

/** The note the mouse is sounding, or null. */
function mouseNote(touches) {
  for (const [voice, index] of touches.current) if (voice.startsWith('mouse:')) return index;
  return null;
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
 * The Fretboard object: its notes and NeckFrame, in `boardRef`.
 * `touches` is a Map of voice -> cell index, written by whatever is touching
 * the notes; touched cubes glow and shiver. `handles` is the NeckFrame's
 * { touching, holding } (hand -> true), which light it up, and
 * `handles.current.bending` the notes being bent (cell index -> how far
 * along the frets, in board metres). `onBend(index, semitones)` reports a
 * bent note's pitch as its cube moves.
 * `chord`: the current chord's pitch classes (a Set), or null for the key's
 * triad. `onHover(index | null, velocity)` reports the mouse: hovering sounds
 * notes in the scale or chord (at the mouse's speed as velocity, 0..1), and
 * with the button down, any note; a click strikes at full velocity. Each cube's mesh
 * carries `userData.playable`, whether a touch sounds it.
 */
export function Fretboard({ boardRef, cells, chord, touches, handles, hoverEnabled, onHover, onBend, position, scale }) {
  const strings = cells.length / FRETS;
  const meshes = useRef([]);
  const bent = useRef([]); // each cell's bend last reported, in semitones
  useEffect(() => {
    bent.current = [];
  }, [cells]);
  const materials = useMemo(() => cells.map(cubeMaterials), [cells]);
  const inChord = useMemo(() => cells.map((cell) => (chord ? chord.has(mod12(cell.note)) : cell.inChord)), [cells, chord]);
  const playable = useMemo(() => cells.map((cell, i) => cell.inScale || inChord[i]), [cells, inChord]);
  const controls = useThree((s) => s.controls);
  const strumming = useRef(false); // the button went down on the board and is still down
  const mouse = useRef({ x: 0, y: 0, t: 0, speed: 0 }); // the pointer's last place and its speed, px per second
  useEffect(() => {
    const onMove = (e) => {
      const m = mouse.current;
      const dt = (e.timeStamp - m.t) / 1000;
      if (dt > 0) m.speed = 0.5 * m.speed + 0.5 * (Math.hypot(e.clientX - m.x, e.clientY - m.y) / dt);
      Object.assign(m, { x: e.clientX, y: e.clientY, t: e.timeStamp });
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  /** How hard the mouse is striking: its speed, 0 once it has stopped, as 0..1. */
  const mouseVelocity = () => {
    const m = mouse.current;
    return performance.now() - m.t > MOUSE_STILL * 1000 ? 0 : Math.min(m.speed / MOUSE_FULL_SPEED, 1);
  };
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
      const index = mouseNote(touches);
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
    const bending = handles.current.bending ?? {};
    const spring = 1 - Math.exp(-RETURN_RATE * Math.min(dt, 0.1));
    meshes.current.forEach((mesh, i) => {
      if (!mesh) return;
      mesh.position.z += (raise(inChord[i], cells[i].inScale) - mesh.position.z) * glide;
      // a bent note slides with the hand, then springs home; its pitch follows where it is
      const home = cells[i].position[0];
      if (bending[i] != null) mesh.position.x = home + bending[i];
      else mesh.position.x += (home - mesh.position.x) * spring;
      let semitones = (mesh.position.x - home) / SPACING;
      if (Math.abs(semitones) < 0.005) {
        mesh.position.x = home;
        semitones = 0;
      }
      if (semitones !== (bent.current[i] ?? 0)) {
        bent.current[i] = semitones;
        onBend?.(i, semitones);
      }
      mesh.userData.playable = playable[i];
      const on = touched.has(i);
      const [side, , , , front] = materials[i];
      side.emissive.copy(on ? TOUCH_EMISSIVE : NO_EMISSIVE);
      front.emissive.copy(on ? TOUCH_EMISSIVE : NO_EMISSIVE);
      mesh.scale.setScalar(on ? 1 + Math.random() * JITTER : 1);
    });
  });

  return (
    <group ref={boardRef} name="Fretboard" position={position} scale={scale}>
      <group name="Notes">
        {cells.map((cell, i) => (
          <mesh
            key={i}
            ref={(m) => (meshes.current[i] = m)}
            geometry={geometry}
            material={materials[i]}
            position={cell.position}
            onPointerOver={(e) => {
              if (!hoverEnabled) return;
              e.stopPropagation();
              if (playable[i] || strumming.current) onHover(i, mouseVelocity());
            }}
            onPointerOut={() => hoverEnabled && mouseNote(touches) === i && onHover(null)}
            onPointerDown={(e) => {
              if (!hoverEnabled) return;
              e.stopPropagation();
              startStrum();
              onHover(null); // a click strikes the note again, at full velocity
              onHover(i, 1);
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
      <NeckFrame strings={strings} handles={handles} />
    </group>
  );
}

// The NeckFrame: a moulding around the notes, like a picture frame. Every
// frame's moulding (see FrameMoulding) is the same width and depth in the
// world, whatever its frame's scale: scaled, the opening grows or shrinks
// with what's in it, and the moulding keeps to these.
const FRAME_MARGIN = 0.01; // between the outer cubes and the frame
export const FRAME_BORDER = 0.02; // moulding width, world metres
const FRAME_DEPTH = 0.02; // ...and depth
export const FRAME_COLOR = '#6b4a2b';

/**
 * Half-sizes of the NeckFrame's opening and of its outside, in Fretboard
 * space, for a Fretboard at `scale` (the moulding's world width is fixed).
 */
export function frameSize(strings, scale = 1) {
  const innerX = (FRETS * SPACING) / 2 + FRAME_MARGIN;
  const innerY = (strings * SPACING) / 2 + FRAME_MARGIN;
  const border = FRAME_BORDER / scale;
  return { innerX, innerY, outerX: innerX + border, outerY: innerY + border };
}

export const FRAME_TOUCHED = new THREE.Color('#3355ff').multiplyScalar(0.35);
export const FRAME_HELD = new THREE.Color('#3355ff').multiplyScalar(0.7);
const barGeometry = new THREE.BoxGeometry(1, 1, 1); // stretched into each bar of a moulding
const _worldScale = new THREE.Vector3();

/**
 * A picture frame's moulding, named `name`, around an opening `innerX` by
 * `innerY` (half-sizes, in its frame's space), centred on its plane: four
 * bars, refitted every frame so they're FRAME_BORDER wide and FRAME_DEPTH
 * deep in the world whatever the frame's scale. `glow()` is its emissive
 * colour, asked every frame.
 */
export function FrameMoulding({ name, innerX, innerY, glow }) {
  const group = useRef(null);
  const bars = useRef([]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.55, metalness: 0.05 }), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    if (!group.current) return;
    const s = group.current.getWorldScale(_worldScale).x;
    const b = FRAME_BORDER / s;
    const d = FRAME_DEPTH / s;
    const [left, right, bottom, top] = bars.current;
    // the sides run the full height, corners included; the top and bottom fit between them
    left?.scale.set(b, 2 * (innerY + b), d);
    left?.position.set(-(innerX + b / 2), 0, 0);
    right?.scale.set(b, 2 * (innerY + b), d);
    right?.position.set(innerX + b / 2, 0, 0);
    bottom?.scale.set(2 * innerX, b, d);
    bottom?.position.set(0, -(innerY + b / 2), 0);
    top?.scale.set(2 * innerX, b, d);
    top?.position.set(0, innerY + b / 2, 0);
    material.emissive.copy(glow());
  });
  return (
    <group ref={group} name={name}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} ref={(m) => (bars.current[i] = m)} geometry={barGeometry} material={material} />
      ))}
    </group>
  );
}

/**
 * The NeckFrame, the picture frame around the notes: the handle for the whole
 * Fretboard. It glows while touched or pointed at (`handles.current.aiming`),
 * more while held.
 */
function NeckFrame({ strings, handles }) {
  const { innerX, innerY } = frameSize(strings);
  const glow = () => {
    const { touching, holding } = handles.current;
    const held = Object.values(holding).some(Boolean);
    const touched = Object.values(touching).some(Boolean) || Object.values(handles.current.aiming ?? {}).includes('board');
    return held ? FRAME_HELD : touched ? FRAME_TOUCHED : NO_EMISSIVE;
  };
  return <FrameMoulding name="NeckFrame" innerX={innerX} innerY={innerY} glow={glow} />;
}

const _local = new THREE.Vector3();

/** Whether a sphere at `world` (radius in metres) touches the NeckFrame of a Fretboard with `strings` rows. */
export function touchesFrame(board, strings, world, radius) {
  const { innerX, innerY } = frameSize(strings);
  return touchesMoulding(board, innerX, innerY, world, radius);
}

/**
 * Whether a sphere at `world` (radius in metres) touches a frame's moulding
 * (see FrameMoulding) centred in `object`'s space, around an opening
 * `innerX` by `innerY` (half-sizes).
 */
export function touchesMoulding(object, innerX, innerY, world, radius) {
  object.worldToLocal(_local.copy(world));
  const s = object.scale.x;
  const r = radius / s;
  const outerX = innerX + FRAME_BORDER / s;
  const outerY = innerY + FRAME_BORDER / s;
  const x = Math.abs(_local.x);
  const y = Math.abs(_local.y);
  if (Math.abs(_local.z) > FRAME_DEPTH / s / 2 + r || x > outerX + r || y > outerY + r) return false;
  return x > innerX - r || y > innerY - r; // on the moulding, not in the opening
}

/** Whether `world` is within `reach` metres of a Fretboard's NeckFrame or anything inside it. */
export function nearFrame(board, strings, world, reach) {
  board.worldToLocal(_local.copy(world));
  const r = reach / board.scale.x;
  const { outerX, outerY } = frameSize(strings, board.scale.x);
  return Math.abs(_local.x) < outerX + r && Math.abs(_local.y) < outerY + r && Math.abs(_local.z) < r;
}

/**
 * Every cell a sphere at `world` (radius in metres) touches, nearest first.
 * Cubes are boxes around their centres, in board space, where they stand
 * now. `outOfScale`: whether notes that aren't playable (outside the scale
 * and chord) count.
 */
export function touchedCells(board, world, radius, outOfScale) {
  return touchedCellsByPoints(board, [world], radius, outOfScale);
}

const _locals = [];

/**
 * Every cell touched by any of the spheres at `points` (world, each `radius`
 * metres), nearest first: a whole object, such as the pick, as spheres over
 * its surface.
 */
export function touchedCellsByPoints(board, points, radius, outOfScale) {
  const notes = board.getObjectByName('Notes');
  if (!notes) return [];
  const locals = points.map((p, k) => board.worldToLocal((_locals[k] ??= new THREE.Vector3()).copy(p)));
  const r2 = (radius / board.scale.x) ** 2;
  const half = CUBE / 2;
  const hits = [];
  notes.children.forEach((mesh, i) => {
    if (!mesh.userData.playable && !outOfScale) return;
    const { x, y, z } = mesh.position;
    let nearest = Infinity;
    for (const p of locals) {
      // distance from the sphere's centre to the box
      const dx = Math.max(Math.abs(p.x - x) - half, 0);
      const dy = Math.max(Math.abs(p.y - y) - half, 0);
      const dz = Math.max(Math.abs(p.z - z) - half, 0);
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      nearest = Math.min(nearest, (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2);
    }
    if (nearest < Infinity) hits.push({ i, d: nearest });
  });
  return hits.sort((a, b) => a.d - b.d).map((hit) => hit.i);
}
