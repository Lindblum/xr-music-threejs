import * as THREE from 'three';

// Grip controls, read straight from the XR session. With both grips held (as
// in Tilt Brush) an object scales with the distance between the hands and
// turns with the line between them, about their midpoint.

const SQUEEZE = 1; // xr-standard gamepad button index
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;

const _pose = new THREE.Matrix4();
const _midPrev = new THREE.Vector3();
const _midNow = new THREE.Vector3();
const _spanPrev = new THREE.Vector3();
const _spanNow = new THREE.Vector3();
const _turn = new THREE.Quaternion();

/**
 * Each controller's state in world space: { grip (Matrix4), position, ray,
 * squeeze, gamepad }, keyed by hand. Poses come relative to the XR origin,
 * which locomotion moves, so they're carried through its world matrix.
 */
export function readControllers(frame, referenceSpace, origin) {
  const hands = {};
  for (const source of frame.session.inputSources) {
    if (!source.gripSpace || !source.gamepad) continue; // tracked hands have no grip button
    if (source.handedness !== 'left' && source.handedness !== 'right') continue;
    const gripPose = frame.getPose(source.gripSpace, referenceSpace);
    if (!gripPose) continue;
    const grip = new THREE.Matrix4().fromArray(gripPose.transform.matrix).premultiply(origin.matrixWorld);
    const ray = new THREE.Ray();
    const rayPose = frame.getPose(source.targetRaySpace, referenceSpace);
    if (rayPose) {
      _pose.fromArray(rayPose.transform.matrix).premultiply(origin.matrixWorld);
      ray.origin.setFromMatrixPosition(_pose);
      ray.direction.set(0, 0, -1).transformDirection(_pose);
    }
    hands[source.handedness] = {
      grip,
      position: new THREE.Vector3().setFromMatrixPosition(grip),
      ray,
      squeeze: Boolean(source.gamepad.buttons[SQUEEZE]?.pressed),
      gamepad: source.gamepad,
    };
  }
  return hands;
}

/**
 * One frame of two-handed control: scale, turn and move `object` by how the
 * hands moved from `prev` to `now` (each { left, right } world positions).
 */
export function applyTwoHands(object, prev, now) {
  if (!prev.left || !prev.right) return; // second hand just joined: start from here
  _midPrev.addVectors(prev.left, prev.right).multiplyScalar(0.5);
  _midNow.addVectors(now.left, now.right).multiplyScalar(0.5);
  _spanPrev.subVectors(prev.right, prev.left);
  _spanNow.subVectors(now.right, now.left);
  const before = _spanPrev.length();
  const after = _spanNow.length();
  if (before < 1e-3 || after < 1e-3) return;
  const scale = THREE.MathUtils.clamp(object.scale.x * (after / before), MIN_SCALE, MAX_SCALE);
  const factor = scale / object.scale.x;
  _turn.setFromUnitVectors(_spanPrev.divideScalar(before), _spanNow.divideScalar(after));
  // carry the object's offset from the hands' midpoint through the turn and scale
  object.position.sub(_midPrev).applyQuaternion(_turn).multiplyScalar(factor).add(_midNow);
  object.quaternion.premultiply(_turn);
  object.scale.setScalar(scale);
}
