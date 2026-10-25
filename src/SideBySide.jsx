import { useEffect, useMemo } from 'react';
import { events, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// 3D: SBS, half side-by-side for 3D TVs and projectors: the left eye on the
// left half, the right on the right, each keeping the full screen's aspect,
// so it is squeezed to half width. The display stretches each half back.

export const EYE_SEPARATION = 0.064; // metres

const _size = new THREE.Vector2();

// the eyes while the view is split, for pointer picking
let active = null;

/**
 * The Canvas's pointer events: as usual, except that while the view is
 * split, a pointer over either half picks what that half shows, seen from
 * that half's eye, so hovering a note works in both, and lands on what's
 * under it however near the camera it is (the menu: see Scene.jsx).
 */
export function sideBySideEvents(store) {
  return {
    ...events(store),
    compute(event, state) {
      const { width, height } = state.size;
      const x = active ? (event.offsetX % (width / 2)) * 2 : event.offsetX;
      state.pointer.set((x / width) * 2 - 1, -(event.offsetY / height) * 2 + 1);
      const eye = active && (event.offsetX < width / 2 ? active.cameraL : active.cameraR);
      if (eye) {
        // (the stereo camera leaves these to its renders)
        eye.updateMatrixWorld();
        eye.projectionMatrixInverse.copy(eye.projectionMatrix).invert();
      }
      state.raycaster.setFromCamera(state.pointer, eye || state.camera);
    },
  };
}

/** Takes over rendering while mounted; the camera and orbit controls carry on as usual. */
export function SideBySide() {
  const stereo = useMemo(() => {
    const s = new THREE.StereoCamera();
    s.eyeSep = EYE_SEPARATION;
    return s;
  }, []);
  useEffect(() => {
    active = stereo;
    return () => {
      active = null;
    };
  }, [stereo]);

  useFrame(({ gl, scene, camera }) => {
    camera.updateMatrixWorld();
    stereo.update(camera);
    gl.getSize(_size);
    const half = _size.x / 2;
    gl.setScissorTest(true);
    [stereo.cameraL, stereo.cameraR].forEach((eye, i) => {
      gl.setViewport(i * half, 0, half, _size.y);
      gl.setScissor(i * half, 0, half, _size.y);
      gl.render(scene, eye);
    });
    gl.setScissorTest(false);
    gl.setViewport(0, 0, _size.x, _size.y);
  }, 1); // priority > 0: R3F skips its own render while this runs

  return null;
}
