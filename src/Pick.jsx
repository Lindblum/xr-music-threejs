import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// The pick: a 10 cm guitar pick for XR: Headset. A grip on it carries it,
// both grips scale and turn it, as with the Fretboard (see Grab.jsx); its tip
// strikes notes as a controller's does (see Touch.jsx). In pick space it lies
// in the XY plane, face toward +Z, tip pointing down -Y.

// The outline: the convex hull of a small circle at the tip and two broad ones at the shoulders
const CIRCLES = [
  { x: 0, y: -0.045, r: 0.007 }, // the tip
  { x: -0.028, y: 0.025, r: 0.023 },
  { x: 0.028, y: 0.025, r: 0.023 },
];
const THICKNESS = 0.004; // with the bevel, about 6 mm
const BEVEL = 0.001;
export const PICK_TIP = new THREE.Vector3(CIRCLES[0].x, CIRCLES[0].y, 0);
export const PICK_TIP_RADIUS = CIRCLES[0].r;
const COLOR = '#d9642b';
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

function pickGeometry() {
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

/** The pick's tip in world space, into `target`, and its radius there in metres. */
export function pickTip(pick, target) {
  target.copy(PICK_TIP).applyMatrix4(pick.matrixWorld);
  return PICK_TIP_RADIUS * _scale.setFromMatrixScale(pick.matrixWorld).x;
}

/**
 * The pick, in `pickRef`. `handles.current.pick` is { touching, holding }
 * (hand -> true), which light it up like the Fretboard's frame.
 */
export function Pick({ pickRef, handles, ...props }) {
  const geometry = useMemo(pickGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useRef(null);
  useFrame(() => {
    const { touching = {}, holding = {} } = handles.current.pick ?? {};
    const held = Object.values(holding).some(Boolean);
    const touched = Object.values(touching).some(Boolean);
    material.current?.emissive.copy(held ? HELD : touched ? TOUCHED : NONE);
  });
  return (
    <mesh ref={pickRef} name="Pick" geometry={geometry} castShadow raycast={() => null} {...props}>
      <meshPhysicalMaterial ref={material} color={COLOR} roughness={0.3} clearcoat={1} clearcoatRoughness={0.15} />
    </mesh>
  );
}
