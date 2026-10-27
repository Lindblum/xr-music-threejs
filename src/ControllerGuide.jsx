import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useXRStore } from '@react-three/xr';
import * as THREE from 'three';

// Accessibility → Controller Guide (XR), as grid-game-threejs's: a label beside each of a
// controller's buttons, stick, trigger, grip and menu button saying what it does right now.
// Each label points, with a thin leader line, at the middle of that part on the controller's
// own model (the input profile's nodes for it). A / B / X / Y and the grip stand in a column
// on the controller's inner side (toward the other hand), the stick and the menu button in
// one on its outer side, the trigger out in front; in a column each label sits level with its
// part where it can, labels that would overlap moved apart as a group. Labels with no text are
// hidden.

/** The components labelled, in the column's order (top to bottom). */
const COMPONENTS = ['menu', 'y-button', 'b-button', 'x-button', 'a-button', 'xr-standard-thumbstick', 'xr-standard-trigger', 'xr-standard-squeeze'];
const FONT_PX = 40;
const LINE_PX = 50; // a text line's height on the canvas
const PAD_PX = 12;
const CANVAS_W = 512;
const TEXT_M = 0.009; // a text line's height in the world (m), at Text Size 100%
const OUT_M = 0.07; // the outer column's distance from the controller, to its side (m)
const INNER_M = 0.045; // the inner column's: closer, leaving room between the hands
const ROW_GAP_M = 0.004; // between a column's labels (m)
const FRONT_M = 0.07; // the trigger's label: this far in front of it (m), where the controller points
/** Where each component's label goes: 'inner' (the side toward the other hand), 'outer', or 'front' (ahead of it). */
const PLACE = { 'a-button': 'inner', 'b-button': 'inner', 'x-button': 'inner', 'y-button': 'inner', 'xr-standard-squeeze': 'inner', 'xr-standard-trigger': 'front', 'xr-standard-thumbstick': 'outer', menu: 'outer' };

const _p = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _at = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * Where `component` sits on controller model `model`: the centre of its parts' shapes (its root
 * node and its visual responses' nodes, the moving parts), not a node's origin (a part's pivot
 * is often elsewhere); into `out`. Null when the model has none of them (yet: it loads after).
 */
function componentCentre(model, component, nodes, out) {
  let found = nodes.get(component);
  if (!found?.length) {
    const names = [component.rootNodeName, ...Object.values(component.visualResponses ?? {}).flatMap((v) => [v.valueNodeName, v.minNodeName, v.maxNodeName])];
    found = [...new Set(names.filter(Boolean).map((n) => model.getObjectByName(n)).filter(Boolean))];
    nodes.set(component, found);
  }
  if (!found.length) return null;
  _box.makeEmpty();
  for (const node of found) _box.expandByObject(node);
  return _box.isEmpty() ? found[0].getWorldPosition(out) : _box.getCenter(out);
}

class Label {
  constructor(parent) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = LINE_PX + PAD_PX * 2;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
    this.sprite.renderOrder = 11;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xe8f2ff, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
    this.line.renderOrder = 10;
    this.line.frustumCulled = false;
    for (const o of [this.sprite, this.line]) {
      o.raycast = () => {};
      o.visible = false;
      parent.add(o);
    }
    this.key = null;
  }

  /** Shows `text` (lines split by \n) `scale` times TEXT_M a line, redrawn only when it changed; anchored at its `side` edge ('left', 'right' or 'center'). */
  setText(text, side, scale) {
    const key = `${text}|${side}|${scale}`;
    if (key === this.key) return;
    this.key = key;
    const lines = text.split('\n');
    const h = lines.length * LINE_PX + PAD_PX * 2;
    if (this.canvas.height !== h) {
      this.canvas.height = h;
      this.texture.dispose();
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.sprite.material.map = this.texture;
    }
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, CANVAS_W, h);
    ctx.font = `600 ${FONT_PX}px system-ui, sans-serif`;
    const w = Math.min(CANVAS_W, Math.max(...lines.map((l) => ctx.measureText(l).width)) + PAD_PX * 2);
    const x0 = side === 'left' ? 0 : side === 'center' ? (CANVAS_W - w) / 2 : CANVAS_W - w; // (the box hugs the edge nearest the controller)
    ctx.fillStyle = 'rgba(12, 16, 24, 0.78)';
    ctx.beginPath();
    ctx.roundRect(x0, 0, w, h, 14);
    ctx.fill();
    ctx.fillStyle = '#eef3fa';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, x0 + PAD_PX, PAD_PX + LINE_PX * (i + 0.5)));
    this.texture.needsUpdate = true;
    const k = (TEXT_M * scale) / LINE_PX; // m per canvas px
    this.sprite.scale.set(CANVAS_W * k, h * k, 1);
    this.sprite.center.set(side === 'left' ? 0 : side === 'center' ? 0.5 : 1, 0.5);
  }

  hide() {
    this.sprite.visible = this.line.visible = false;
  }

  dispose() {
    this.sprite.removeFromParent();
    this.line.removeFromParent();
    this.texture.dispose();
    this.sprite.material.dispose();
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}

/**
 * The guide's labels, while `on`: `textsOf(hand)` gives { componentId: text } for what each of
 * that controller's parts does now; `scale` is Text Size. Must sit where the world's origin is
 * (labels are placed in world space).
 */
export function ControllerGuide({ on, textsOf, scale = 1 }) {
  const store = useXRStore();
  const group = useMemo(() => new THREE.Group(), []);
  const labels = useMemo(() => ({ left: new Map(), right: new Map() }), []); // hand -> component id -> Label
  const nodes = useMemo(() => new WeakMap(), []); // component -> its model's nodes
  useEffect(
    () => () => {
      for (const hand of Object.values(labels)) for (const l of hand.values()) l.dispose();
    },
    [labels],
  );
  const labelFor = (hand, id) => {
    let l = labels[hand].get(id);
    if (!l) labels[hand].set(id, (l = new Label(group)));
    return l;
  };

  useFrame(({ camera }) => {
    const states = on ? store.getState().inputSourceStates : [];
    camera.updateMatrixWorld();
    _right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    _up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    for (const hand of ['left', 'right']) {
      const state = states.find((s) => s.type === 'controller' && s.inputSource.handedness === hand);
      const model = state?.object;
      const components = state?.layout?.components;
      if (!model || !components) {
        for (const l of labels[hand].values()) l.hide();
        continue;
      }
      const texts = textsOf(hand);
      const outward = hand === 'left' ? -1 : 1; // (the outer side, as you see it)
      model.updateWorldMatrix(true, true);
      model.getWorldPosition(_at);
      const shown = [];
      for (const id of COMPONENTS) {
        const p = texts[id] && components[id] && componentCentre(model, components[id], nodes, new THREE.Vector3());
        if (!p) {
          labels[hand].get(id)?.hide();
          continue;
        }
        shown.push({ id, p, place: PLACE[id] ?? 'outer', l: labelFor(hand, id) });
      }
      for (const place of ['inner', 'outer']) {
        const side = place === 'outer' ? outward : -outward;
        const col = shown.filter((x) => x.place === place);
        for (const x of col) {
          x.l.setText(texts[x.id], side > 0 ? 'left' : 'right', scale); // (the box's edge nearest the controller)
          x.h = x.l.sprite.scale.y;
          x.y = _p.copy(x.p).sub(_at).dot(_up); // (its part's height, as you see it)
        }
        col.sort((a, b) => b.y - a.y);
        // groups of labels that would touch, each centred on the mean height of its parts
        const groups = [];
        for (const x of col) {
          groups.push({ items: [x], h: x.h, mid: x.y });
          for (;;) {
            const g = groups.at(-1);
            const prev = groups.at(-2);
            if (!prev || prev.mid - prev.h / 2 - ROW_GAP_M >= g.mid + g.h / 2) break;
            const items = [...prev.items, ...g.items];
            const h = items.reduce((t, it) => t + it.h, 0) + ROW_GAP_M * (items.length - 1);
            groups.splice(-2, 2, { items, h, mid: items.reduce((t, it) => t + it.y, 0) / items.length });
          }
        }
        for (const g of groups) {
          let y = g.mid + g.h / 2;
          for (const x of g.items) {
            y -= x.h / 2;
            x.l.sprite.position.copy(_at).addScaledVector(_right, side * (place === 'inner' ? INNER_M : OUT_M) * scale).addScaledVector(_up, y);
            y -= x.h / 2 + ROW_GAP_M;
          }
        }
      }
      // the trigger's label: out in front of it, where the controller points
      _fwd.set(0, 0, -1).transformDirection(model.matrixWorld);
      for (const x of shown.filter((it) => it.place === 'front')) {
        x.l.setText(texts[x.id], 'center', scale);
        x.l.sprite.position.copy(x.p).addScaledVector(_fwd, FRONT_M);
      }
      for (const { l, p } of shown) {
        const pos = l.line.geometry.getAttribute('position');
        pos.setXYZ(0, p.x, p.y, p.z);
        pos.setXYZ(1, l.sprite.position.x, l.sprite.position.y, l.sprite.position.z);
        pos.needsUpdate = true;
        l.sprite.visible = l.line.visible = true;
      }
    }
  });

  return <primitive object={group} />;
}
