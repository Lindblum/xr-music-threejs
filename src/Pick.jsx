import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { iconSvg } from './Icon.jsx';
import { instrumentIcon } from './menu.js';

// Picks: 10 cm guitar picks for XR: Headset, as many as are taken from the
// ToolFrame (see SideFrames.jsx). The first starts docked on the right
// controller, pointing forward from it; a grip on one from the other hand
// takes it, both grips scale and turn it, as with the Fretboard, and let go
// near a controller it docks there (see Grab.jsx). Every part of a pick
// strikes notes, as a controller's tip does (see Touch.jsx), in its own
// instrument (a synth or a sample), whose icon and name it wears on both
// faces. Let go by the mouth, a pick docks there, held flat in front of it
// as if in the teeth. In pick space it lies in the XY plane, face toward +Z,
// tip pointing down -Y.

// The outline: a rounded equilateral triangle, the convex hull of three circles of the same radius, one at each corner
const CORNER = 0.015;
const CORNER_RADIUS = 0.045; // from the centre to each corner circle's centre
const CIRCLES = [-90, 30, 150].map((degrees) => {
  const a = THREE.MathUtils.degToRad(degrees); // -90: the tip
  return { x: CORNER_RADIUS * Math.cos(a), y: CORNER_RADIUS * Math.sin(a), r: CORNER };
});
const THICKNESS = 0.004; // with the bevel, about 6 mm
const BEVEL = 0.001;
const SAMPLE_SPACING = 0.012; // between the points that stand for the pick in the touch tests
/** The radius around each sample point, in pick metres: it closes the gaps between them and covers the thickness. */
export const PICK_SAMPLE_RADIUS = Math.max((SAMPLE_SPACING * Math.SQRT2) / 2, THICKNESS / 2);
export const PICK_COLOR = '#d9642b';
const TOUCHED = new THREE.Color('#3355ff').multiplyScalar(0.35);
const HELD = new THREE.Color('#3355ff').multiplyScalar(0.7);
const NONE = new THREE.Color(0, 0, 0);

/** The outline's points, counter-clockwise (Andrew's monotone chain over points around each circle). */
function outline() {
  const points = CIRCLES.flatMap(({ x, y, r }) =>
    Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return new THREE.Vector2(x + r * Math.cos(a), y + r * Math.sin(a));
    }),
  ).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list) => {
    const hull = [];
    for (const p of list) {
      while (hull.length >= 2 && cross(hull.at(-2), hull.at(-1), p) <= 0) hull.pop();
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  return [...half(points), ...half([...points].reverse())];
}
const OUTLINE = outline();

export function pickGeometry() {
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(OUTLINE), {
    depth: THICKNESS - 2 * BEVEL,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 3,
    curveSegments: 4,
  });
  geometry.translate(0, 0, -(THICKNESS - 2 * BEVEL) / 2); // centred on its plane
  return geometry;
}

/** Points over the whole face, a grid inside plus the outline itself, for the touch tests. */
function samplePoints() {
  const points = [];
  const reach = CORNER_RADIUS + CORNER;
  for (let x = -reach; x <= reach; x += SAMPLE_SPACING)
    for (let y = -reach; y <= reach; y += SAMPLE_SPACING) if (outsideOutline(x, y) === 0) points.push(new THREE.Vector3(x, y, 0));
  OUTLINE.forEach((p, i) => {
    const next = OUTLINE[(i + 1) % OUTLINE.length];
    const steps = Math.ceil(p.distanceTo(next) / SAMPLE_SPACING);
    for (let k = 0; k < steps; k++) points.push(new THREE.Vector3().lerpVectors(new THREE.Vector3(p.x, p.y, 0), new THREE.Vector3(next.x, next.y, 0), k / steps));
  });
  return points;
}

/** How far a point in pick space lies outside the outline, in the plane (0 inside). */
function outsideOutline(x, y) {
  let inside = true;
  let nearest = Infinity;
  for (let i = 0; i < OUTLINE.length; i++) {
    const a = OUTLINE[i];
    const b = OUTLINE[(i + 1) % OUTLINE.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    if (ex * (y - a.y) - ey * (x - a.x) < 0) inside = false;
    const t = THREE.MathUtils.clamp(((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey), 0, 1);
    nearest = Math.min(nearest, Math.hypot(x - a.x - t * ex, y - a.y - t * ey));
  }
  return inside ? 0 : nearest;
}

const _local = new THREE.Vector3();
const _scale = new THREE.Vector3();

/** Whether `world` is within `reach` metres of the pick. */
export function touchesPick(pick, world, reach) {
  pick.worldToLocal(_local.copy(world));
  const r = reach / _scale.setFromMatrixScale(pick.matrixWorld).x;
  return Math.abs(_local.z) < THICKNESS / 2 + r && outsideOutline(_local.x, _local.y) < r;
}

let samples = null;
const worldSamples = [];

/**
 * A pick's sample points in world space (reused between calls, so use them
 * before the next), and the radius around each there in metres: together
 * they cover the whole pick.
 */
export function pickPoints(pick) {
  samples ??= samplePoints();
  samples.forEach((p, i) => (worldSamples[i] ??= new THREE.Vector3()).copy(p).applyMatrix4(pick.matrixWorld));
  return { points: worldSamples, radius: PICK_SAMPLE_RADIUS * _scale.setFromMatrixScale(pick.matrixWorld).x };
}

/**
 * Docked on a controller, in its target-ray space (-Z forward out of the
 * controller): standing upright like a blade, faces to the sides, tip
 * forward, all of it just in front of the controller (its back edge about
 * 3 cm ahead, its tip 13 cm).
 */
export const PICK_DOCK_POSITION = new THREE.Vector3(0, 0, -0.07);
export const PICK_DOCK_ROTATION = new THREE.Quaternion().setFromRotationMatrix(
  // pick +X up, +Y back (so the tip, -Y, points forward), its face (+Z) to the right
  new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)),
);

/**
 * Docked at the mouth, in head (camera) space (-Z forward, +Y up): lying flat,
 * tip forward, its centre a little below and in front of the eyes, where the
 * mouth is.
 */
export const PICK_MOUTH_POSITION = new THREE.Vector3(0, -0.08, -0.08);
export const PICK_MOUTH_ROTATION = new THREE.Quaternion().setFromRotationMatrix(
  // pick +X right, +Y back (the tip, -Y, forward), its face (+Z) down
  new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)),
);

const LABEL_SIZE = [0.05, 0.031]; // metres: the instrument's icon over its name, on each face
const LABEL_Y = 0.004; // up from the centre, where the triangle is widest
const LABEL_INK = '#2a1206';

/** An instrument's icon over its name, on a transparent canvas, for a pick's faces. Shared by picks with the same one. */
const labelTextures = new Map();
function labelTexture(instrument) {
  if (!labelTextures.has(instrument)) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = LABEL_INK;
    ctx.font = `600 ${instrument.length > 10 ? 34 : 42}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(instrument, 128, 122, 244);
    // the icon comes as an image: drawn once it loads
    const icon = new Image();
    icon.onload = () => {
      ctx.drawImage(icon, 128 - 36, 8, 72, 72);
      texture.needsUpdate = true;
    };
    icon.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(instrumentIcon(instrument), LABEL_INK))}`;
    labelTextures.set(instrument, texture);
  }
  return labelTextures.get(instrument);
}

/**
 * Pick `id`, in `pickRef`, playing `instrument` and wearing its name.
 * `handles.current.picks[id]` is { touching, holding } (hand -> true), which
 * light it up like the neck frame, and `docked` (the hand it's on, 'mouth',
 * or null).
 */
export function Pick({ id, instrument, pickRef, handles, ...props }) {
  const geometry = useMemo(pickGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useRef(null);
  useFrame(() => {
    const { touching = {}, holding = {} } = handles.current.picks?.[id] ?? {};
    const held = Object.values(holding).some(Boolean);
    const touched = Object.values(touching).some(Boolean);
    material.current?.emissive.copy(held ? HELD : touched ? TOUCHED : NONE);
  });
  return (
    <mesh ref={pickRef} name="Pick" geometry={geometry} raycast={() => null} {...props}>
      <meshPhysicalMaterial ref={material} color={PICK_COLOR} roughness={0.3} clearcoat={1} clearcoatRoughness={0.15} />
      {/* its instrument on both faces, just proud of them */}
      {[1, -1].map((side) => (
        <mesh key={side} position={[0, LABEL_Y, side * (THICKNESS / 2 + 0.0004)]} rotation-y={side > 0 ? 0 : Math.PI} raycast={() => null}>
          <planeGeometry args={LABEL_SIZE} />
          <meshBasicMaterial map={labelTexture(instrument)} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </mesh>
  );
}
