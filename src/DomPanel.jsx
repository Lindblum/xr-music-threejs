import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGazeTarget } from './Gaze.jsx';

// A page element shown as a panel in the 3D scene: the same JSX the page
// uses (the menu, the View panel), mounted in its own React root on a hidden
// element off the screen, and painted into the panel's texture (through an
// SVG foreignObject) whenever it changes or scrolls. A controller's ray, a
// hand's pinch, the gaze or the mouse (in the windowed 3D views) on the panel
// becomes the page's own pointer and click events at that spot, so the
// element's handlers work as on the page; while a pointer is pressed, its
// events go to the element it was pressed on (as if captured), on or off the
// panel. What's pointed at is marked `data-xr-hover`, for the CSS to light it
// as :hover would. The right thumbstick (or the mouse wheel) scrolls whatever
// scrolls under the pointer.
//
// The panel's origin is its top-left corner: it grows right and down.

/** Metres per CSS px in the scene (at scale 1): about the size the page's panel looks at arm's length. */
export const CSS_PX_M = 0.0007;
const RASTER_SCALE = 2; // texture px per CSS px
const OFFSCREEN_X = -100000; // where the hidden elements are laid out (CSS px)
const OFFSCREEN_LIMIT = OFFSCREEN_X / 2; // a client point left of this is off the screen: a hidden element's, or nothing's
const SLAB_DEPTH = 0.01; // m, in the world: the panel's thickness behind its face, as grid-game-threejs's panels
const SLAB_RADIUS = 14; // CSS px: the panel's rounded corners (.hud's)
const SCROLL_SPEED = 900; // CSS px per second at full stick
const STICK_DEADZONE = 0.2;
const THUMBSTICK_Y = 3; // xr-standard gamepad axis
/** What's lit when pointed at: the elements the CSS lights on :hover. */
const HOVERABLE = 'button, .menu-track, .hud-resize';

const _local = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _point = new THREE.Vector3();
const _plane = new THREE.Plane();
const _worldScale = new THREE.Vector3();

// the hidden elements, for elementAtPoint
const hosts = new Set();
let nextHost = 0;

/**
 * The deepest element at client point (x, y) inside `node`: as
 * document.elementFromPoint, for an element that's off the screen. Hidden
 * elements and the menu's sizer (see Menu.jsx) don't count.
 */
function hitTest(node, x, y) {
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i];
    if (child.classList.contains('menu-sizer')) continue;
    const style = getComputedStyle(child);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
    const r = child.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return hitTest(child, x, y) ?? child;
  }
  return null;
}

/**
 * The element at client point (x, y): the page's, or, at a hidden panel's
 * place off the screen, the panel's (null off the panel's edges). For the
 * page's drags, which ask what they're over.
 */
export function elementAtPoint(x, y) {
  if (x > OFFSCREEN_LIMIT) return document.elementFromPoint(x, y);
  for (const host of hosts) {
    const r = host.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return hitTest(host, x, y) ?? host;
  }
  return null;
}

/** The page's style rules, for the painted copy (it has no stylesheets of its own). */
let pageCss = { count: -1, text: '' };
function pageStyles() {
  const sheets = [...document.styleSheets];
  const count = sheets.reduce((n, s) => {
    try {
      return n + s.cssRules.length;
    } catch {
      return n;
    }
  }, 0);
  if (count !== pageCss.count) {
    const text = sheets
      .map((s) => {
        try {
          return [...s.cssRules].map((r) => r.cssText).join('\n');
        } catch {
          return ''; // (another origin's: nothing it can use)
        }
      })
      .join('\n');
    pageCss = { count, text };
  }
  return pageCss.text;
}

/**
 * A copy of `node` to paint: without the sizer (each panel, `.hud`, keeps
 * the size it had), fields showing what's typed in them, and what's
 * scrolled shifted by as much (a copy isn't scrolled).
 */
function paintable(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return node.cloneNode(false);
  if (node.classList.contains('menu-sizer')) return null;
  const copy = node.cloneNode(false);
  if (node instanceof HTMLInputElement) copy.setAttribute('value', node.value);
  if (node.classList.contains('hud')) {
    const r = node.getBoundingClientRect();
    copy.style.width = `${r.width}px`;
    copy.style.height = `${r.height}px`;
  }
  for (const child of node.childNodes) {
    const c = paintable(child);
    if (c) copy.appendChild(c);
  }
  if (node.scrollTop) for (const c of copy.children) c.style.transform = `translateY(${-node.scrollTop}px)`;
  return copy;
}

/** Paints `element` (laid out `w` x `h` CSS px) onto `canvas`, RASTER_SCALE to the px; whether the canvas changed size. */
async function paint(element, canvas, w, h) {
  const body = getComputedStyle(document.body);
  const vars = document.documentElement.getAttribute('style') ?? ''; // (Text Size's --text-scale, set there)
  const copy = paintable(element);
  copy.style.position = 'static';
  copy.style.left = '0';
  const xml = new XMLSerializer().serializeToString(copy);
  const style = `${vars};color:${body.color};font-family:${body.fontFamily};margin:0;`.replace(/"/g, "'");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${style}"><style><![CDATA[${pageStyles()}]]></style>${xml}</div>` +
    '</foreignObject></svg>';
  // (loaded, not decode()d: a headset's browser may never decode for a page it isn't showing, as in a session)
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('the painted panel image failed to load'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const width = Math.max(1, Math.round(w * RASTER_SCALE));
  const height = Math.max(1, Math.round(h * RASTER_SCALE));
  const resized = canvas.width !== width || canvas.height !== height;
  if (resized) Object.assign(canvas, { width, height });
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return resized;
}

/** The slab behind a face `w` x `h` m with corners `r` m round, extruded 1 deep (scaled to SLAB_DEPTH in the world), from its centre. */
function slabGeometry(w, h, r) {
  const x1 = w / 2;
  const y1 = h / 2;
  r = Math.min(r, x1, y1);
  const shape = new THREE.Shape();
  shape.moveTo(-x1 + r, -y1);
  shape.lineTo(x1 - r, -y1);
  shape.absarc(x1 - r, -y1 + r, r, -Math.PI / 2, 0);
  shape.lineTo(x1, y1 - r);
  shape.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2);
  shape.lineTo(-x1 + r, y1);
  shape.absarc(-x1 + r, y1 - r, r, Math.PI / 2, Math.PI);
  shape.lineTo(-x1, -y1 + r);
  shape.absarc(-x1 + r, -y1 + r, r, Math.PI, Math.PI * 1.5);
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 6 });
}

/** Where pointer event `e` is on `mesh`'s plane: where it hit, or (off the mesh, captured) where its ray meets the plane. */
function eventPoint(e, mesh) {
  if (e.pointOnFace) return e.pointOnFace;
  if (e.ray) {
    _normal.set(0, 0, 1).transformDirection(mesh.matrixWorld);
    _plane.setFromNormalAndCoplanarPoint(_normal, mesh.getWorldPosition(_point));
    if (e.ray.intersectPlane(_plane, _point)) return _point;
  }
  return e.point;
}

/**
 * `children` (page JSX) as a panel. `overlay`: drawn over everything, with
 * no slab (the windowed 3D views' menu); `stickBusy(hand)`: that hand's
 * stick is taken (see Grab.jsx); `onSource(hand)`: called with the
 * controller (or hand) before each event it sends, for choices that belong
 * to one. The group (`groupRef`) gets `userData.bounds`: the panel's edges in
 * its metres, for docking.
 */
export function DomPanel({ children, overlay = false, stickBusy, onSource, groupRef, ...groupProps }) {
  const mesh = useRef(null);
  const slab = useRef(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const canvas = useMemo(() => document.createElement('canvas'), []);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);

  // the hidden element, its own React root, and painting it whenever it changes
  const [host, setHost] = useState(null);
  const root = useRef(null);
  useLayoutEffect(() => {
    const el = document.createElement('div');
    el.className = 'dom-panel';
    el.style.cssText = `position:fixed;left:${OFFSCREEN_X - nextHost++ * 5000}px;top:0;display:inline-block;`;
    document.body.appendChild(el);
    hosts.add(el);
    root.current = createRoot(el);
    setHost(el);
    return () => {
      hosts.delete(el);
      const r = root.current;
      root.current = null;
      setTimeout(() => {
        r.unmount();
        el.remove();
      });
    };
  }, []);
  useLayoutEffect(() => {
    root.current?.render(children);
  });
  useEffect(() => {
    if (!host) return;
    let painting = false;
    let again = false;
    let frame = 0;
    const repaint = async () => {
      frame = 0;
      if (painting) return void (again = true);
      painting = true;
      try {
        const r = host.getBoundingClientRect();
        if (r.width && r.height) {
          setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
          // (a texture's size is fixed once made: a new size, a new one)
          if (await paint(host, canvas, r.width, r.height)) texture.dispose();
          texture.needsUpdate = true;
        }
      } catch (e) {
        console.warn('[xr-music] panel paint failed:', e);
      }
      painting = false;
      if (again) {
        again = false;
        schedule();
      }
    };
    // (a timer, not an animation frame: a headset's browser stops the page's frames while a session shows)
    const schedule = () => {
      frame ||= setTimeout(repaint, 16);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    host.addEventListener('scroll', schedule, true);
    schedule();
    return () => {
      observer.disconnect();
      resize.disconnect();
      host.removeEventListener('scroll', schedule, true);
      clearTimeout(frame);
    };
  }, [host, canvas, texture]);

  const w = size.w * CSS_PX_M;
  const h = size.h * CSS_PX_M;
  const bounds = useMemo(() => ({ left: 0, right: w, top: 0, bottom: -h }), [w, h]);
  const slabShape = useMemo(() => slabGeometry(w, h, SLAB_RADIUS * CSS_PX_M), [w, h]);
  useEffect(() => () => slabShape.dispose(), [slabShape]);
  // the slab keeps to SLAB_DEPTH in the world however the panel is scaled, running back from just behind the face
  useFrame(() => {
    const s = slab.current;
    if (!s) return;
    const scale = s.parent.getWorldScale(_worldScale).x || 1;
    const d = SLAB_DEPTH / scale;
    s.scale.set(1, 1, d);
    s.position.z = -d - 0.0003 / scale;
  });

  // pointers: a pressed one's events go where it was pressed
  const pressed = useRef(new Map()); // pointer id -> the element it was pressed on
  const hovered = useRef(null);
  const pointing = useRef(false);
  /** Where pointer event `e` is, in client px over the hidden element (off its edges too). */
  const clientPoint = (e) => {
    const r = host.getBoundingClientRect();
    const uv = e.object === mesh.current ? e.uv : null; // (on the panel; off it, where the ray meets its plane)
    if (uv) return { x: r.left + uv.x * r.width, y: r.top + (1 - uv.y) * r.height };
    const local = mesh.current.worldToLocal(_local.copy(eventPoint(e, mesh.current)));
    return { x: r.left + (local.x / w + 0.5) * r.width, y: r.top + (0.5 - local.y / h) * r.height };
  };
  const hover = (el) => {
    const next = el?.closest?.(HOVERABLE) ?? null;
    if (next === hovered.current) return;
    hovered.current?.removeAttribute('data-xr-hover');
    next?.setAttribute('data-xr-hover', '');
    hovered.current = next;
  };
  /** Sends DOM event `type` (a pointer or mouse event's) for R3F event `e`, to the pressed element or the one under it. */
  const send = (type, e, init = {}) => {
    if (!host) return null;
    onSource?.(e.pointerState?.inputSource?.handedness ?? e.nativeEvent?.inputSource?.handedness);
    const { x, y } = clientPoint(e);
    const id = 1000 + (e.pointerId ?? 0);
    const target = pressed.current.get(id) ?? elementAtPoint(x, y) ?? host;
    const Event = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    target.dispatchEvent(
      new Event(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: id, pointerType: 'pen', isPrimary: true, button: 0, ...init }),
    );
    return { target, x, y, id };
  };

  // the gaze: lights what it rests on; after its dwell, presses there
  const gazeAt = useRef(null);
  useGazeTarget(
    mesh,
    () => {
      const at = gazeAt.current;
      if (!at) return;
      const fire = (type, Event) =>
        at.target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, pointerId: 999, pointerType: 'pen', isPrimary: true, button: 0 }));
      onSource?.(undefined);
      fire('pointerdown', PointerEvent);
      fire('pointerup', PointerEvent);
      fire('click', MouseEvent);
    },
    (key) => hover(key ? gazeAt.current?.target : null),
    (hit) => {
      if (!host || !hit?.uv) return null;
      const r = host.getBoundingClientRect();
      const x = r.left + hit.uv.x * r.width;
      const y = r.top + (1 - hit.uv.y) * r.height;
      const target = elementAtPoint(x, y);
      gazeAt.current = target ? { target, x, y } : null;
      return target?.closest(HOVERABLE) ?? null;
    },
  );

  // the right thumbstick scrolls what's under the pointer
  const scrollTarget = useRef(null);
  useFrame((_, dt, frame) => {
    const el = scrollTarget.current;
    if (!pointing.current || !el || !frame) return;
    for (const source of frame.session.inputSources) {
      if (source.handedness !== 'right' || stickBusy?.('right')) continue; // (a grip holding something: its stick pushes and pulls that)
      const y = source.gamepad?.axes[THUMBSTICK_Y] ?? 0;
      if (Math.abs(y) >= STICK_DEADZONE) el.scrollTop += y * SCROLL_SPEED * Math.min(dt, 0.1);
    }
  });
  const scrollable = (el) => {
    for (let n = el; n && n !== host; n = n.parentElement) if (n.scrollHeight > n.clientHeight && getComputedStyle(n).overflowY !== 'visible') return n;
    return null;
  };

  return (
    <group ref={groupRef} userData={{ bounds }} {...groupProps}>
      <mesh
        ref={mesh}
        position={[w / 2, -h / 2, 0]}
        renderOrder={overlay ? 1000 : 0}
        onPointerOver={() => (pointing.current = true)}
        onPointerOut={() => {
          pointing.current = false;
          hover(null);
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          mesh.current.setPointerCapture?.(e.pointerId);
          const sent = send('pointerdown', e, { buttons: 1 });
          if (sent) pressed.current.set(sent.id, sent.target);
        }}
        onPointerMove={(e) => {
          const id = 1000 + (e.pointerId ?? 0);
          const sent = send('pointermove', e, { buttons: pressed.current.has(id) ? 1 : 0 });
          if (!sent) return;
          if (pressed.current.has(id)) e.stopPropagation();
          else hover(sent.target);
          scrollTarget.current = scrollable(elementAtPoint(sent.x, sent.y));
        }}
        onPointerUp={(e) => {
          const id = 1000 + (e.pointerId ?? 0);
          if (!pressed.current.has(id)) return;
          mesh.current.releasePointerCapture?.(e.pointerId);
          send('pointerup', e);
          pressed.current.delete(id);
        }}
        onClick={(e) => {
          e.stopPropagation();
          send('click', e);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          send('dblclick', e);
        }}
        onWheel={(e) => {
          // a mouse wheel scrolls it too, outside XR
          const { x, y } = clientPoint(e);
          const el = scrollable(elementAtPoint(x, y));
          if (!el) return;
          e.stopPropagation();
          el.scrollTop += e.nativeEvent.deltaY;
        }}
      >
        <planeGeometry args={[w, h]} />
        {/* both sides: it reads from behind too (mirrored), as when it's held or docked turned away */}
        <meshBasicMaterial map={texture} transparent depthWrite={false} depthTest={!overlay} toneMapped={false} side={THREE.DoubleSide} />
        {!overlay && (
          // (the face is what's pointed at; drawn first, behind it)
          <mesh ref={slab} geometry={slabShape} renderOrder={-1} raycast={() => null}>
            <meshStandardMaterial color={0x1c2230} roughness={0.55} metalness={0.15} transparent opacity={0.8} depthWrite={false} />
          </mesh>
        )}
      </mesh>
    </group>
  );
}
