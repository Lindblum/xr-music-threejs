import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { iconSvg } from './Icon.jsx';
import { menuBlocks, rowSpans, splitLabel } from './menu.js';
import { useGazeTarget } from './Gaze.jsx';

// The options panel in XR. It draws the same menu model as the windowed
// panel (title, XR status, "Name: Value" buttons, and the shared
// open / collapsed state) onto a canvas, since WebXR can't show page
// elements. The gear, top left, opens and closes it; closed, it is the panel
// around the gear alone, the gear where it was. Controller rays, hand
// pinches and gaze pick a control from where they hit the texture. A panel taller
// than MAX_HEIGHT scrolls under its title: push the right thumbstick up or
// down while pointing at it. A queued chord of the progression is selected by
// the trigger, dragged with the trigger held to reorder it, and dragged off
// the panel (the pointer stays captured) or double-clicked to remove it.
// The windowed 3D views show it too, before the camera (see Scene.jsx), with
// `overlay` drawing it over everything and the mouse wheel scrolling it.

const W = 1000; // canvas px of the reference width...
const WIDTH_M = 0.44; // ...which is this many metres: sets the text size in XR
const PAD = 40;
const TITLE_Y = 72;
const LINE_H = 40; // the XR status line
const BUTTON_H = 62;
const GAP = 22;
const ICON = 44;
const ICON_GAP = 28; // between icon and text
const TOGGLE = 72; // the gear button's size
const GEAR_ICON = 40; // ...and its icon's
export const PX_M = WIDTH_M / W; // metres per canvas px
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const MENU_TOGGLE = 'menu:toggle';
const MAX_HEIGHT = 1300; // canvas px, about 57 cm: taller panels scroll
const SCROLL_SPEED = 1400; // canvas px per second at full stick
const STICK_DEADZONE = 0.2;
const WHEEL_SPEED = 1.5; // canvas px per px of mouse wheel
// The open panel is resized by dragging the handle in its bottom-right corner (the trigger held, or the mouse in the
// windowed 3D views), its top-left corner staying put: the panel gets bigger or smaller, its buttons keep their size,
// their labels shortened to fit and the rest scrolling. Double-clicking the handle fits it to its buttons again.
const HANDLE = 64; // canvas px: the handle, this square in the corner
const RESIZE_KEY = 'menu:resize'; // the handle, pointed at
const PANEL_MIN = { w: 520, h: 360 }; // canvas px
const PANEL_MAX = { w: 2400, h: 2600 };
const SIZE_STORAGE = 'xr-music-menu-size'; // kept on this device, as the page's panel is laid out per window

const clampPanelSize = ({ w, h }) => ({
  w: Math.round(THREE.MathUtils.clamp(w, PANEL_MIN.w, PANEL_MAX.w)),
  h: Math.round(THREE.MathUtils.clamp(h, PANEL_MIN.h, PANEL_MAX.h)),
});
function loadPanelSize() {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_STORAGE));
    return Number.isFinite(s?.w) && Number.isFinite(s?.h) ? clampPanelSize(s) : null;
  } catch {
    return null;
  }
}
function savePanelSize(size) {
  try {
    if (size) localStorage.setItem(SIZE_STORAGE, JSON.stringify(size));
    else localStorage.removeItem(SIZE_STORAGE);
  } catch {
    // storage blocked: it's fitted to its buttons next time
  }
}

const _plane = new THREE.Plane();
const _normal = new THREE.Vector3();
const _point = new THREE.Vector3();
/**
 * Where pointer event `e` is on `mesh`'s plane, even off the mesh: an XR
 * pointer's captured plane gives it, the mouse's ray meets it.
 */
function eventPoint(e, mesh) {
  if (e.pointOnFace) return e.pointOnFace;
  if (e.ray) {
    _normal.set(0, 0, 1).transformDirection(mesh.matrixWorld);
    _plane.setFromNormalAndCoplanarPoint(_normal, mesh.getWorldPosition(_point));
    if (e.ray.intersectPlane(_plane, _point)) return _point;
  }
  return e.point;
}
const THUMBSTICK_Y = 3; // xr-standard gamepad axis
// In the room, the panel is a slab this deep (m, in the world, whatever its scale) behind its face, its outline the
// face's rounded rectangle, as grid-game-threejs's panels are; not in the windowed 3D views' overlay
const SLAB_DEPTH = 0.01;
const SLAB_INSET = 4; // canvas px: the face's rounded rectangle (see the redraw), inset this far...
const SLAB_RADIUS = 40; // ...with corners this round
const _worldScale = new THREE.Vector3();

/** The slab's outline for a face `w` x `h` canvas px, extruded 1 deep (scaled to SLAB_DEPTH in the world), in metres from its centre. */
function slabGeometry(w, h) {
  const x1 = ((w - 2 * SLAB_INSET) / 2) * PX_M;
  const y1 = ((h - 2 * SLAB_INSET) / 2) * PX_M;
  const r = Math.min(SLAB_RADIUS * PX_M, x1, y1);
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
const SCROLLBAR = 8;

const iconImages = new Map();
function iconImage(name, onLoad) {
  if (!iconImages.has(name)) {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(name))}`;
    iconImages.set(name, img);
  }
  const img = iconImages.get(name);
  if (!img.complete) img.addEventListener('load', onLoad, { once: true });
  return img;
}

const BUTTON_FONT = `500 34px ${FONT}`;
const TITLE_FONT = `650 46px ${FONT}`;
const INSET = 18; // icon from the button's left edge, text from its right
const VALUE_GAP = 40; // at least this between a setting's name and its value
const TRAILING = 36; // a section's or a dropdown's chevron, at the right edge
// a dropdown's choices: two to a row (or the dropdown's `columns`) beneath its button, indented
const OPTION_FONT = `400 30px ${FONT}`;
const OPTION_H = 52;
const OPTION_GAP = 12;
const OPTION_INDENT = 54;
const CHECK = 30;
const OPTION_ICON = 32;
const OPTION_ICON_GAP = 14;
const COL_GAP = 16; // between buttons sharing a row
const GROUP_PAD = 16; // inside a group's frame
const COMPACT_FONT = `500 30px ${FONT}`; // a compact button: just its label, centred
const COMPACT_INSET = 14;
const DRAG_START = 24; // canvas px the pointer moves before a press on a queued chord becomes a drag
const _local = new THREE.Vector3();
const SMALL_FONT = `500 30px ${FONT}`; // a small button, for several sharing a row
const SMALL_VALUE_GAP = 20;
const SMALL_GAP = 16; // between a small button's text and its chevron

let measureCtx;
function textWidth(text, font) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** A button's text style: its font, the least gap between name and value, and the gap before its chevron. */
const textStyle = (small) =>
  small ? { font: SMALL_FONT, valueGap: SMALL_VALUE_GAP, gap: SMALL_GAP } : { font: BUTTON_FONT, valueGap: VALUE_GAP, gap: ICON_GAP };

/** The open panel's width: the widest possible button (or row of them), or the title row if wider. */
function labelWidth(label, small) {
  const { font, valueGap } = textStyle(small);
  const { name, value } = splitLabel(label);
  return value ? textWidth(`${name}:`, font) + valueGap + textWidth(value, font) : textWidth(name, font);
}

const buttonWidth = (label, { icon = true, small = false, trailing = true } = {}) =>
  INSET + (icon ? ICON + ICON_GAP : 0) + labelWidth(label, small) + (trailing ? textStyle(small).gap + TRAILING : 0) + INSET;
const compactWidth = (label) => 2 * COMPACT_INSET + textWidth(label, COMPACT_FONT);

/**
 * A possibleLabels entry's width: a button, or a row of them, each column its
 * shares of the row (inside a group's frame, if it's in one).
 */
function entryWidth(entry) {
  if (typeof entry === 'string') return buttonWidth(entry);
  const share = Math.max(
    ...entry.row.map(({ text, span, icon, trailing }) =>
      (entry.compact ? compactWidth(text) : buttonWidth(text, { icon, small: entry.small, trailing })) / span,
    ),
  );
  const shares = entry.row.reduce((sum, { span }) => sum + span, 0);
  return share * shares + (entry.row.length - 1) * COL_GAP + (entry.group ? 2 * GROUP_PAD : 0) + (entry.indent ?? 0) * OPTION_INDENT;
}

function panelWidth(title, labels) {
  const button = Math.max(0, ...labels.map(entryWidth));
  const titleRow = TOGGLE + 24 + textWidth(title, TITLE_FONT);
  return Math.ceil(2 * PAD + Math.max(button, titleRow));
}

/**
 * Canvas size, the hit rectangles for this state ({ id, x, y, w, h } plus
 * `item` for a button or `option` for a choice in an open dropdown), and the
 * frames around groups ({ x, y, w, h }). Buttons sharing a row split it into
 * equal columns; an open dropdown's choices go beneath its row.
 */
function layout(open, items, lines, panelW) {
  const gear = { id: MENU_TOGGLE, x: PAD, y: TITLE_Y - TOGGLE / 2, w: TOGGLE, h: TOGGLE };
  // closed: the panel around the gear alone, as far from its edges as it is from the open panel's corner
  if (!open) return { width: 2 * gear.x + gear.w, height: 2 * gear.y + gear.h, rects: [gear], frames: [] };
  const rects = [gear];
  const frames = [];
  const fullW = panelW - 2 * PAD;
  let y = TITLE_Y + 34 + lines * LINE_H + 16;
  for (const block of menuBlocks(items)) {
    // an open section's buttons are set in beneath its header, as a dropdown's choices are, a step for each section
    const indent = block.indent * OPTION_INDENT;
    const inset = block.group ? GROUP_PAD : 0;
    const x = PAD + indent + inset;
    const w = fullW - indent - 2 * inset;
    const frameTop = y;
    if (block.group) y += GROUP_PAD;
    for (const row of block.rows) {
      // each button its shares of the row's width
      const spans = row[0].row == null ? [1] : rowSpans(row);
      const share = (w - (spans.length - 1) * COL_GAP) / spans.reduce((sum, span) => sum + span, 0);
      let left = x;
      row.forEach((item, i) => {
        rects.push({ id: item.id, item, x: left, y, w: spans[i] * share, h: BUTTON_H });
        left += spans[i] * share + COL_GAP;
      });
      y += BUTTON_H + GAP;
      const open = row.find((item) => item.dropdown?.open);
      if (!open) continue;
      const columns = open.dropdown.columns ?? 2;
      const optionW = (w - OPTION_INDENT - (columns - 1) * OPTION_GAP) / columns;
      open.dropdown.options.forEach((option, i) => {
        rects.push({
          id: option.id,
          option,
          checked: option.selected && open.dropdown.checks !== false,
          x: x + OPTION_INDENT + (i % columns) * (optionW + OPTION_GAP),
          y: y + Math.floor(i / columns) * (OPTION_H + OPTION_GAP),
          w: optionW,
          h: OPTION_H,
        });
      });
      y += Math.ceil(open.dropdown.options.length / columns) * (OPTION_H + OPTION_GAP) + GAP - OPTION_GAP;
    }
    if (block.group) {
      const bottom = y - GAP + GROUP_PAD;
      frames.push({ group: block.group, x: PAD + indent, y: frameTop, w: fullW - indent, h: bottom - frameTop });
      y = bottom + GAP;
    }
  }
  // `top`: where the scrolling part starts, below the title and status
  return { width: panelW, height: y - GAP + PAD, rects, frames, top: rects[1]?.y ?? 0 };
}

/** What a button's right edge shows: a section's or a dropdown's chevron. */
function trailingIcon(item) {
  if (item.section) return item.section.open ? 'dropdownOpen' : 'dropdown';
  if (item.dropdown) return item.dropdown.open ? 'dropdownOpen' : 'dropdown';
  return null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Text vertically centred on its ink at `cy`. */
function centredText(ctx, text, x, cy) {
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(text);
  ctx.fillText(text, x, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
}

function drawButtonFrame(ctx, r, { hot, disabled, info, current, color, dim, beats, beat }) {
  roundRect(ctx, r.x, r.y, r.w, r.h, 18);
  ctx.fillStyle = info
    ? 'rgba(255, 255, 255, 0.03)'
    : disabled
    ? 'rgba(255, 255, 255, 0.04)'
    : current
      ? (dim ?? color ?? 'rgba(80, 110, 255, 0.45)')
      : hot
        ? 'rgba(255, 255, 255, 0.24)'
        : 'rgba(255, 255, 255, 0.10)';
  ctx.fill();
  if (current && dim && beats) {
    // the measure split into its beats, the current one bright
    ctx.save();
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(r.x + (r.w * beat) / beats, r.y, r.w / beats, r.h);
    ctx.restore();
    roundRect(ctx, r.x, r.y, r.w, r.h, 18);
  }
  ctx.strokeStyle = hot || (current && color) ? 'rgba(255, 255, 255, 0.85)' : current ? 'rgba(150, 175, 255, 0.9)' : info ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = hot || current ? 4 : 2;
  ctx.stroke();
}

export function XRMenuPanel({ title, status, items, labels, rows, open, onSelect, onQueueEdit, overlay = false, stickBusy, groupRef, ...groupProps }) {
  const mesh = useRef(null);
  const slab = useRef(null);
  const [pointerKey, setPointerKey] = useState(null);
  const [gazeKey, setGazeKey] = useState(null);
  const [iconsLoaded, setIconsLoaded] = useState(0);
  const lines = status ? 1 : 0;
  // sized for every label it can show, measured once: the items only count when there's no such list
  const sizedItems = labels ? null : items;
  const panelW = useMemo(() => panelWidth(title, labels ?? sizedItems.map((i) => i.label)), [title, labels, sizedItems]);
  // dragged to a size of its own from its corner handle ({ w, h } canvas px), or null: fitted to its buttons
  const [size, setSize] = useState(loadPanelSize);
  const openW = size?.w ?? panelW;
  const { width, height: contentHeight, rects, frames, top } = useMemo(() => layout(open, items, lines, openW), [open, items, lines, openW]);
  // taller than MAX_HEIGHT (or the size it's dragged to): the buttons scroll between the title and the bottom edge
  const height = open ? (size?.h ?? Math.min(contentHeight, MAX_HEIGHT)) : contentHeight;
  const maxScroll = Math.max(0, contentHeight - height);
  const clipTop = top - GAP / 2;
  const clipBottom = height - PAD / 2;
  const [scroll, setScroll] = useState(0);
  // a queued chord being dragged: { from, label, sx, sy, px, py, moved, to, outside }, in canvas px
  const [drag, setDrag] = useState(null);
  const dragging = drag?.moved ? drag : null;
  const dragged = useRef(false); // a drag just ended: the click that follows isn't one
  const scrolled = Math.min(scroll, maxScroll);
  const pointing = useRef(false);

  // an opened dropdown scrolls its choices into view
  const openDropdown = items.find((item) => item.dropdown?.open)?.id;
  useEffect(() => {
    if (!openDropdown) return;
    const first = rects.findIndex((r) => r.id === openDropdown);
    const last = rects.findLastIndex((r) => r.option);
    if (first < 0 || last < first) return;
    setScroll((s) => {
      const bottom = rects[last].y + rects[last].h - s;
      return bottom <= clipBottom ? s : Math.min(s + bottom - clipBottom, rects[first].y - top);
    });
    // only when a dropdown opens, so the stick can scroll freely afterwards
  }, [openDropdown]);

  // the right thumbstick scrolls while a pointer is on the panel
  useFrame((_, dt, frame) => {
    if (!pointing.current || maxScroll <= 0 || !frame) return;
    for (const source of frame.session.inputSources) {
      if (source.handedness !== 'right' || stickBusy?.('right')) continue; // (a grip holding something: its stick pushes and pulls that)
      const y = source.gamepad?.axes[THUMBSTICK_Y] ?? 0;
      if (Math.abs(y) < STICK_DEADZONE) continue;
      setScroll((s) => THREE.MathUtils.clamp(Math.min(s, maxScroll) + y * SCROLL_SPEED * Math.min(dt, 0.1), 0, maxScroll));
    }
  });
  // the tallest the buttons get, every section open (rows of plain buttons, at most the scrolling height): fewer
  // and the collapsed gear keep to its top edge, and more (a long progression, an open dropdown) grow downward
  const openHeight = useMemo(
    () => Math.min(layout(true, Array.from({ length: rows ?? items.length }, (_, i) => ({ id: `row-${i}` })), lines, panelW).height, MAX_HEIGHT),
    [rows, items.length, lines, panelW],
  );
  // that tallest panel's edges in the group's metres (or the size it's dragged to), for docking it against things (see
  // Grab.jsx); its top-left corner stays put however it's sized
  const bounds = useMemo(() => {
    const top = (openHeight / 2) * PX_M;
    const left = (-panelW / 2) * PX_M;
    return { left, right: left + openW * PX_M, top, bottom: top - (size?.h ?? Math.min(openHeight, MAX_HEIGHT)) * PX_M };
  }, [openHeight, panelW, openW, size]);

  // resizing: the handle's corner follows the pointer, with the top-left corner kept where it is (see grabSize)
  const resizing = useRef(null); // while dragged: the pointer's offset from the corner, in canvas px
  const onHandle = (px, py) => open && px >= width - HANDLE && py >= height - HANDLE;
  /** The size that would put the panel's bottom-right corner where pointer event `e` is (on the panel's plane). */
  const grabSize = (e) => {
    const local = mesh.current.parent.worldToLocal(_local.copy(eventPoint(e, mesh.current)));
    return { w: local.x / PX_M + panelW / 2, h: openHeight / 2 - local.y / PX_M };
  };
  const resizeTo = (e) => {
    const grab = grabSize(e);
    const next = clampPanelSize({ w: grab.w + resizing.current.w, h: grab.h + resizing.current.h });
    setSize((s) => (s && s.w === next.w && s.h === next.h ? s : next));
    return next;
  };

  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }, [width, height]);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);
  const slabGeometryMemo = useMemo(() => slabGeometry(width, height), [width, height]);
  useEffect(() => () => slabGeometryMemo.dispose(), [slabGeometryMemo]);
  // the slab keeps to SLAB_DEPTH in the world however the panel is scaled (docked, held, a phone's), running back from
  // just behind the face (no z-fighting)
  useFrame(() => {
    const s = slab.current;
    if (!s) return;
    const scale = s.parent.getWorldScale(_worldScale).x || 1;
    const d = SLAB_DEPTH / scale;
    s.scale.set(1, 1, d);
    s.position.z = -d - 0.0003 / scale;
  });

  const hovered = gazeKey ?? pointerKey;
  useEffect(() => {
    const ctx = canvas.getContext('2d');
    const redraw = () => setIconsLoaded((n) => n + 1);
    ctx.clearRect(0, 0, width, height);

    // the panel, and the gear in its top-left corner: all there is of it while it's closed
    roundRect(ctx, 4, 4, width - 8, height - 8, 40);
    ctx.fillStyle = 'rgba(12, 16, 28, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 4;
    ctx.stroke();
    const gear = rects[0];
    drawButtonFrame(ctx, gear, { hot: hovered === MENU_TOGGLE });
    const gearIcon = iconImage('gear', redraw);
    if (gearIcon.complete && gearIcon.naturalWidth)
      ctx.drawImage(gearIcon, gear.x + (gear.w - GEAR_ICON) / 2, gear.y + (gear.h - GEAR_ICON) / 2, GEAR_ICON, GEAR_ICON);
    if (!open) {
      texture.needsUpdate = true;
      return;
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = TITLE_FONT;
    centredText(ctx, fit(ctx, title, width - 2 * PAD - TOGGLE - 24), PAD + TOGGLE + 24, TITLE_Y);
    if (status) {
      ctx.fillStyle = 'rgba(232, 236, 246, 0.6)';
      ctx.font = `400 26px ${FONT}`;
      centredText(ctx, fit(ctx, status, width - 2 * PAD), PAD, TITLE_Y + 34 + LINE_H / 2);
    }

    // the buttons, scrolled and clipped below the title
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, clipTop, width, clipBottom - clipTop);
    ctx.clip();
    ctx.translate(0, -scrolled);
    // groups' frames, behind their buttons
    for (const f of frames) {
      roundRect(ctx, f.x, f.y, f.w, f.h, 28);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    for (const r of rects) {
      if (r.id === MENU_TOGGLE) continue;
      if (r.option) {
        // a choice in an open dropdown: smaller, the current one lit and ticked, one this device can't have dimmed
        const { option } = r;
        roundRect(ctx, r.x, r.y, r.w, r.h, 14);
        const hot = option.id === hovered && !option.disabled;
        ctx.globalAlpha = option.disabled ? 0.35 : 1;
        ctx.fillStyle = hot ? 'rgba(255, 255, 255, 0.24)' : option.selected ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.05)';
        ctx.fill();
        ctx.strokeStyle = hot || option.selected ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = hot ? 4 : 2;
        ctx.stroke();
        let tx = r.x + INSET;
        if (option.icon) {
          const icon = iconImage(option.icon, redraw);
          if (icon.complete && icon.naturalWidth) ctx.drawImage(icon, tx, r.y + (r.h - OPTION_ICON) / 2, OPTION_ICON, OPTION_ICON);
          tx += OPTION_ICON + OPTION_ICON_GAP;
        }
        ctx.fillStyle = '#ffffff';
        ctx.font = OPTION_FONT;
        const room = r.x + r.w - INSET - tx - (r.checked ? CHECK + 10 : 0);
        centredText(ctx, fit(ctx, option.label, room), tx, r.y + r.h / 2);
        if (r.checked) {
          const check = iconImage('check', redraw);
          if (check.complete && check.naturalWidth) ctx.drawImage(check, r.x + r.w - INSET - CHECK, r.y + (r.h - CHECK) / 2, CHECK, CHECK);
        }
        ctx.globalAlpha = 1;
        continue;
      }
      const { item } = r;
      const dragged = dragging && item.queueIndex === dragging.from;
      drawButtonFrame(ctx, r, {
        hot: item.id === hovered && !item.disabled && !item.info && !dragging,
        disabled: item.disabled,
        info: item.info,
        current: item.current,
        color: item.color,
        dim: item.dim,
        beats: item.beats,
        beat: item.beat,
      });
      ctx.globalAlpha = item.disabled ? 0.4 : dragged && !dragging.outside ? 0.35 : 1;
      if (dragged && dragging.outside) {
        // off the panel: letting go removes it
        roundRect(ctx, r.x, r.y, r.w, r.h, 18);
        ctx.fillStyle = 'rgba(190, 50, 40, 0.85)';
        ctx.fill();
      }
      if (dragging && !dragging.outside && item.queueIndex === dragging.to && !dragged) {
        roundRect(ctx, r.x - 4, r.y - 4, r.w + 8, r.h + 8, 22);
        ctx.setLineDash([14, 10]);
        ctx.strokeStyle = 'rgba(150, 175, 255, 0.95)';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (item.compact) {
        // just the label, centred; on the playing chord's colours, bold with a shadow
        const coloured = item.current && item.color;
        ctx.fillStyle = '#ffffff';
        ctx.font = coloured ? `700 30px ${FONT}` : COMPACT_FONT;
        ctx.textAlign = 'center';
        if (coloured) {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
          ctx.shadowBlur = 6;
        }
        centredText(ctx, fit(ctx, item.label, r.w - 2 * COMPACT_INSET), r.x + r.w / 2, r.y + r.h / 2);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
        continue;
      }
      let tx = r.x + INSET;
      if (item.icon) {
        const img = iconImage(item.icon, redraw);
        if (img.complete && img.naturalWidth) ctx.drawImage(img, tx, r.y + (r.h - ICON) / 2, ICON, ICON);
        tx += ICON + ICON_GAP;
      }
      const style = textStyle(item.small);
      ctx.fillStyle = '#ffffff';
      ctx.font = style.font;
      // the name on the left, the value against the right edge
      let right = r.x + r.w - INSET;
      const trailing = trailingIcon(item);
      if (trailing) {
        const icon = iconImage(trailing, redraw);
        if (icon.complete && icon.naturalWidth) ctx.drawImage(icon, right - TRAILING, r.y + (r.h - TRAILING) / 2, TRAILING, TRAILING);
        right -= TRAILING + style.gap;
      }
      const { name, value } = splitLabel(item.label);
      const nameText = value ? `${name}:` : name;
      centredText(ctx, fit(ctx, nameText, right - tx), tx, r.y + r.h / 2);
      if (value) {
        const room = right - tx - ctx.measureText(nameText).width - style.valueGap;
        ctx.textAlign = 'right';
        centredText(ctx, fit(ctx, value, room), right, r.y + r.h / 2);
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // the dragged chord, following the pointer while it's on the panel
    if (dragging && !dragging.outside) {
      const w = 220;
      const h = BUTTON_H;
      roundRect(ctx, dragging.px - w / 2, dragging.py - h / 2, w, h, 18);
      ctx.fillStyle = 'rgba(40, 52, 110, 0.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(150, 175, 255, 0.9)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = COMPACT_FONT;
      ctx.textAlign = 'center';
      centredText(ctx, fit(ctx, dragging.label, w - 2 * COMPACT_INSET), dragging.px, dragging.py);
      ctx.textAlign = 'left';
    }

    if (maxScroll > 0) {
      // scrollbar, in the right padding
      const trackH = clipBottom - clipTop;
      const thumbH = Math.max(60, (trackH * height) / contentHeight);
      const thumbY = clipTop + ((trackH - thumbH) * scrolled) / maxScroll;
      const x = width - PAD / 2 - SCROLLBAR / 2;
      roundRect(ctx, x, clipTop, SCROLLBAR, trackH, SCROLLBAR / 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fill();
      roundRect(ctx, x, thumbY, SCROLLBAR, thumbH, SCROLLBAR / 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.fill();
    }

    // the resize handle: diagonal ridges in the bottom-right corner
    const handleHot = hovered === RESIZE_KEY;
    ctx.strokeStyle = handleHot ? '#9cc8ff' : 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = handleHot ? 5 : 3;
    ctx.lineCap = 'round';
    for (const d of [18, 32, 46]) {
      ctx.beginPath();
      ctx.moveTo(width - 14 - d, height - 14);
      ctx.lineTo(width - 14, height - 14 - d);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    texture.needsUpdate = true;
  }, [canvas, texture, width, height, contentHeight, rects, frames, clipTop, clipBottom, scrolled, maxScroll, open, title, status, hovered, iconsLoaded, dragging]);

  const pick = (hit) => {
    if (!hit?.uv) return null;
    const px = hit.uv.x * width;
    let py = (1 - hit.uv.y) * height;
    const inside = (q) => px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h;
    if (open && inside(rects[0])) return MENU_TOGGLE; // the title row doesn't scroll
    if (open && (py < clipTop || py > clipBottom)) return null;
    if (open) py += scrolled;
    const r = rects.find(inside);
    return r && !r.item?.disabled && !r.item?.info && !r.option?.disabled ? r.id : null;
  };
  useGazeTarget(mesh, onSelect, setGazeKey, pick);
  /** Whether a pointer event is on the resize handle. */
  const atHandle = (e) => Boolean(e.uv) && onHandle(e.uv.x * width, (1 - e.uv.y) * height);
  const resizedAt = useRef(-Infinity); // when a resize ended: the click that follows isn't one

  /** Where a pointer event is on the canvas, in px, even off the panel (from its captured plane). */
  const toCanvas = (e) => {
    const local = mesh.current.worldToLocal(_local.copy(eventPoint(e, mesh.current)));
    return { px: (local.x / (width * PX_M) + 0.5) * width, py: (0.5 - local.y / (height * PX_M)) * height };
  };
  /** Where a dragged chord would go at (px, py): off the panel, onto a queued chord, or the queue's end. */
  const dropAt = (px, py) => {
    if (px < 0 || px > width || py < 0 || py > height) return { outside: true, to: null };
    const y = py + scrolled;
    const within = (q) => py >= clipTop && py <= clipBottom && px >= q.x && px <= q.x + q.w && y >= q.y && y <= q.y + q.h;
    const chips = rects.filter((r) => r.item?.queueIndex != null);
    const chip = chips.find(within);
    if (chip) return { outside: false, to: chip.item.queueIndex };
    return { outside: false, to: frames.some((f) => f.group === 'queue' && within(f)) ? chips.length - 1 : null };
  };
  const queuedAt = (e) => rects.find((r) => r.id === pick(e))?.item;

  return (
    <group ref={groupRef} userData={{ bounds }} {...groupProps}>
      <mesh
        ref={mesh}
        position={[((width - panelW) / 2) * PX_M, ((openHeight - height) / 2) * PX_M, 0]}
        renderOrder={overlay ? 1000 : 0}
        onPointerOver={() => (pointing.current = true)}
        onWheel={(e) => {
          // a mouse wheel scrolls it too, outside XR
          if (maxScroll <= 0) return;
          e.stopPropagation();
          setScroll((s) => THREE.MathUtils.clamp(Math.min(s, maxScroll) + e.nativeEvent.deltaY * WHEEL_SPEED, 0, maxScroll));
        }}
        onPointerDown={(e) => {
          if (atHandle(e)) {
            // the resize handle: held on to, so the corner follows the pointer off the panel
            e.stopPropagation();
            mesh.current.setPointerCapture?.(e.pointerId);
            const grab = grabSize(e);
            resizing.current = { w: width - grab.w, h: height - grab.h };
            return;
          }
          const item = queuedAt(e);
          if (item?.queueIndex == null) return;
          // a queued chord: hold on to the pointer, so a drag carries on off the panel
          e.stopPropagation();
          mesh.current.setPointerCapture?.(e.pointerId);
          const { px, py } = toCanvas(e);
          setDrag({ from: item.queueIndex, label: item.label, sx: px, sy: py, px, py, moved: false, to: item.queueIndex, outside: false });
        }}
        onPointerMove={(e) => {
          if (resizing.current) {
            e.stopPropagation();
            setPointerKey(RESIZE_KEY);
            return resizeTo(e);
          }
          setPointerKey(atHandle(e) ? RESIZE_KEY : pick(e));
          if (!drag) return;
          const { px, py } = toCanvas(e);
          const moved = drag.moved || Math.hypot(px - drag.sx, py - drag.sy) > DRAG_START;
          setDrag({ ...drag, px, py, moved, ...(moved ? dropAt(px, py) : {}) });
        }}
        onPointerUp={(e) => {
          if (resizing.current) {
            mesh.current.releasePointerCapture?.(e.pointerId);
            savePanelSize(resizeTo(e));
            resizing.current = null;
            resizedAt.current = performance.now();
            return;
          }
          if (!drag) return;
          mesh.current.releasePointerCapture?.(e.pointerId);
          setDrag(null);
          dragged.current = drag.moved;
          if (!drag.moved) return;
          if (drag.outside) onQueueEdit?.({ type: 'remove', index: drag.from });
          else if (drag.to != null && drag.to !== drag.from) onQueueEdit?.({ type: 'move', from: drag.from, to: drag.to });
        }}
        onDoubleClick={(e) => {
          if (atHandle(e)) {
            // fitted to its buttons again
            e.stopPropagation();
            setSize(null);
            return savePanelSize(null);
          }
          const item = queuedAt(e);
          if (item?.queueIndex == null) return;
          e.stopPropagation();
          onQueueEdit?.({ type: 'remove', index: item.queueIndex });
        }}
        onPointerOut={() => {
          pointing.current = false;
          setPointerKey(null);
        }}
        onClick={(e) => {
          if (performance.now() - resizedAt.current < 300) return;
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          const key = pick(e);
          if (key == null) return;
          e.stopPropagation();
          // which controller (or hand) chose it, for choices that belong to one (an instrument)
          onSelect(key, { hand: e.pointerState?.inputSource?.handedness });
        }}
      >
        <planeGeometry args={[width * PX_M, height * PX_M]} />
        {/* both sides: it reads from behind too (mirrored), as when it's held or docked turned away */}
        <meshBasicMaterial map={texture} transparent depthWrite={false} depthTest={!overlay} toneMapped={false} side={THREE.DoubleSide} />
        {!overlay && (
          // (the face is what's pointed at; drawn first, behind it)
          <mesh ref={slab} geometry={slabGeometryMemo} renderOrder={-1} raycast={() => null}>
            <meshStandardMaterial color={0x1c2230} roughness={0.55} metalness={0.15} transparent opacity={0.8} depthWrite={false} />
          </mesh>
        )}
      </mesh>
    </group>
  );
}

// The View panel: one button, the monitor, that leaves XR for the Normal view, as grid-game-threejs's does. It's
// as big as the closed menu (the panel around its gear), drawn the same way, and docks, stacked under the menu, on
// the left controller at first (see Grab.jsx).
const VIEW_KEY = 'view:normal';
const VIEW_SIZE = { w: 2 * PAD + TOGGLE, h: 2 * (TITLE_Y - TOGGLE / 2) + TOGGLE }; // canvas px: the closed menu's

/** The View panel; `onSelect()` leaves XR. */
export function XRViewPanel({ onSelect, groupRef, ...groupProps }) {
  const mesh = useRef(null);
  const slab = useRef(null);
  const [hot, setHot] = useState(false);
  const [gazed, setGazed] = useState(false);
  const [iconsLoaded, setIconsLoaded] = useState(0);
  const { w, h } = VIEW_SIZE;
  const canvas = useMemo(() => Object.assign(document.createElement('canvas'), { width: w, height: h }), [w, h]);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);
  const slabGeometryMemo = useMemo(() => slabGeometry(w, h), [w, h]);
  useEffect(() => () => slabGeometryMemo.dispose(), [slabGeometryMemo]);
  useFrame(() => {
    const s = slab.current;
    if (!s) return;
    const scale = s.parent.getWorldScale(_worldScale).x || 1;
    const d = SLAB_DEPTH / scale;
    s.scale.set(1, 1, d);
    s.position.z = -d - 0.0003 / scale;
  });
  const bounds = useMemo(() => ({ left: (-w / 2) * PX_M, right: (w / 2) * PX_M, top: (h / 2) * PX_M, bottom: (-h / 2) * PX_M }), [w, h]);
  const button = { x: PAD, y: TITLE_Y - TOGGLE / 2, w: TOGGLE, h: TOGGLE };

  useEffect(() => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 4, 4, w - 8, h - 8, 40);
    ctx.fillStyle = 'rgba(12, 16, 28, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 4;
    ctx.stroke();
    drawButtonFrame(ctx, button, { hot: hot || gazed });
    const icon = iconImage('monitor', () => setIconsLoaded((n) => n + 1));
    if (icon.complete && icon.naturalWidth)
      ctx.drawImage(icon, button.x + (button.w - GEAR_ICON) / 2, button.y + (button.h - GEAR_ICON) / 2, GEAR_ICON, GEAR_ICON);
    texture.needsUpdate = true;
    // (`button` is fixed)
  }, [canvas, texture, w, h, hot, gazed, iconsLoaded]);

  const onButton = (e) => {
    const uv = e.uv;
    if (!uv) return false;
    const px = uv.x * w;
    const py = (1 - uv.y) * h;
    return px >= button.x && px <= button.x + button.w && py >= button.y && py <= button.y + button.h;
  };
  useGazeTarget(mesh, (key) => key && onSelect?.(), (key) => setGazed(Boolean(key)), (hit) => (onButton(hit) ? VIEW_KEY : null));

  return (
    <group ref={groupRef} userData={{ bounds }} {...groupProps}>
      <mesh
        ref={mesh}
        onPointerMove={(e) => setHot(onButton(e))}
        onPointerOut={() => setHot(false)}
        onClick={(e) => {
          if (!onButton(e)) return;
          e.stopPropagation();
          onSelect?.();
        }}
      >
        <planeGeometry args={[w * PX_M, h * PX_M]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        <mesh ref={slab} geometry={slabGeometryMemo} renderOrder={-1} raycast={() => null}>
          <meshStandardMaterial color={0x1c2230} roughness={0.55} metalness={0.15} transparent opacity={0.8} depthWrite={false} />
        </mesh>
      </mesh>
    </group>
  );
}
