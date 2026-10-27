import { Fragment, createContext, memo, useContext, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { MENU_TOGGLE, menuBlocks, rowSpans, splitLabel } from './menu.js';
import { elementAtPoint } from './DomPanel.jsx';

// The menu's panels, one set of templates for the page and for XR: the
// windowed options panel (Hud) and the View panel draw the shared menu model
// (see menu.js) as page elements; in XR, and in the windowed 3D views, the
// same elements are painted onto a panel in the scene (see DomPanel.jsx),
// with `xr` set for what differs there: sliders drawn as a track (a range
// input can't be dragged from a panel), the dragged chord's ghost kept on
// the panel, the panel resized within its own limits and its size kept on
// this device.

/** Set inside an XR (or 3D view) panel: see above. */
const XrContext = createContext(false);

/** Holds on to pointer `e`, where it's a real one (a panel's pointers are routed by DomPanel instead). */
function capture(e) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // (a panel's pointer: DomPanel sends its events here while it's pressed)
  }
}

/** Where a dragged ghost goes: the pointer's place, on a panel relative to the panel (`el` is inside it). */
function ghostPlace(xr, el, x, y) {
  if (!xr) return { left: x, top: y };
  const r = el?.closest('.hud')?.getBoundingClientRect();
  return r ? { left: x - r.left, top: y - r.top } : { left: x, top: y };
}

/** "Name: Value": the name on the left, the value against the right edge. */
function Label({ text }) {
  const { name, value } = splitLabel(text);
  return (
    <span className="label">
      <span className="name">{value ? `${name}:` : name}</span>
      {value && <span className="value">{value}</span>}
    </span>
  );
}

/** What a button's right edge shows: a section's or a dropdown's chevron. */
function trailingIcon(item) {
  if (item.section) return item.section.open ? 'dropdownOpen' : 'dropdown';
  if (item.dropdown) return item.dropdown.open ? 'dropdownOpen' : 'dropdown';
  return null;
}

const DRAG_START = 6; // px the pointer moves before a press on a queued chord becomes a drag
const INDENT = 24; // px an open section's buttons are set in, as far as a dropdown's choices

/** The playing chord's background: its dark colour split into the measure's beats, the current one bright. */
function beatStyle({ color, dim, beats, beat }) {
  const from = (beat / beats) * 100;
  const to = ((beat + 1) / beats) * 100;
  return {
    background: `linear-gradient(to right, ${dim} ${from}%, ${color} ${from}%, ${color} ${to}%, ${dim} ${to}%)`,
    borderColor: color,
  };
}

/**
 * Dragging the progression's queued chords in the windowed panel: dropped on
 * another chord it moves there, dropped outside the panel it's removed.
 * Returns { drag, handlers(item) }: `drag` is { from, label, x, y, to,
 * outside } once the pointer has moved, for drawing.
 */
function useQueueDrag(onQueueEdit) {
  const [drag, setDrag] = useState(null);
  const current = useRef(null);
  const dragged = useRef(false); // a drag just ended: the click that follows isn't one
  const update = (next) => {
    current.current = next;
    setDrag(next);
  };
  const handlers = (item) => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      capture(e);
      update({ from: item.queueIndex, label: item.label, startX: e.clientX, startY: e.clientY, moved: false });
    },
    onPointerMove: (e) => {
      const d = current.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_START;
      if (!moved) return;
      // what's under the pointer: another queued chord, the queue's frame (its end), or outside the panel
      const under = elementAtPoint(e.clientX, e.clientY);
      const chip = under?.closest('[data-queue-index]');
      const queue = under?.closest('[data-group="queue"]');
      const last = queue ? queue.querySelectorAll('[data-queue-index]').length - 1 : -1;
      update({
        ...d,
        moved,
        x: e.clientX,
        y: e.clientY,
        to: chip ? Number(chip.dataset.queueIndex) : queue ? last : null,
        outside: !under?.closest('.hud'),
      });
    },
    onPointerUp: () => {
      const d = current.current;
      update(null);
      dragged.current = Boolean(d?.moved);
      if (!d?.moved) return;
      if (d.outside) onQueueEdit({ type: 'remove', index: d.from });
      else if (d.to != null && d.to !== d.from) onQueueEdit({ type: 'move', from: d.from, to: d.to });
    },
    onPointerCancel: () => update(null),
    onDoubleClick: () => onQueueEdit({ type: 'remove', index: item.queueIndex }),
  });
  /** Whether a click on a queued chord is really the end of a drag (and forgets it). */
  const wasDrag = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };
  return { drag: drag?.moved ? drag : null, handlers, wasDrag };
}

/**
 * Dragging a choice out of a `removable` dropdown (Load's saved
 * progressions) in the windowed panel: dropped outside the panel, it's
 * removed (`onRemove(option id)`). Returns { drag, handlers(option),
 * wasDrag }: `drag` is { label, x, y, outside } once the pointer has moved,
 * for drawing.
 */
function useOptionDrag(onRemove) {
  const [drag, setDrag] = useState(null);
  const current = useRef(null);
  const dragged = useRef(false); // a drag just ended: the click that follows isn't one
  const update = (next) => {
    current.current = next;
    setDrag(next);
  };
  const handlers = (option) => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      capture(e);
      update({ id: option.id, label: option.label, startX: e.clientX, startY: e.clientY, moved: false });
    },
    onPointerMove: (e) => {
      const d = current.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_START;
      if (!moved) return;
      const under = elementAtPoint(e.clientX, e.clientY);
      update({ ...d, moved, x: e.clientX, y: e.clientY, outside: !under?.closest('.hud') });
    },
    onPointerUp: () => {
      const d = current.current;
      update(null);
      dragged.current = Boolean(d?.moved);
      if (d?.moved && d.outside) onRemove?.(d.id);
    },
    onPointerCancel: () => update(null),
  });
  /** Whether a click on a choice is really the end of a drag (and forgets it). */
  const wasDrag = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };
  return { drag: drag?.moved ? drag : null, handlers, wasDrag };
}

/**
 * A slider's track on a panel: pressed or dragged along, it takes the value
 * there (on a step), and `onDone()` when it's let go; drawn as the page's range input is.
 */
function SliderTrack({ slider, label, onChange, onDone }) {
  const valueAt = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    return slider.min + t * (slider.max - slider.min);
  };
  const dragging = useRef(false);
  const at = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  return (
    <span
      className="menu-track"
      role="slider"
      aria-label={label}
      aria-valuemin={slider.min}
      aria-valuemax={slider.max}
      aria-valuenow={slider.value}
      onPointerDown={(e) => {
        dragging.current = true;
        capture(e);
        onChange(valueAt(e));
      }}
      onPointerMove={(e) => dragging.current && onChange(valueAt(e))}
      onPointerUp={() => {
        if (dragging.current) onDone();
        dragging.current = false;
      }}
      onPointerCancel={() => (dragging.current = false)}
    >
      <span className="menu-track-fill" style={{ width: `${at}%` }} />
      <span className="menu-track-knob" style={{ left: `${at}%` }} />
    </span>
  );
}

function MenuButton({ item, onSelect, onSlide, onName, queue }) {
  const xr = useContext(XrContext);
  const trailing = !item.compact && trailingIcon(item);
  const queued = item.queueIndex != null;
  const drag = queue?.drag;
  const className = [
    'menu-btn',
    item.info && 'info',
    item.compact && 'compact',
    item.small && 'small',
    item.current && 'current',
    item.current && item.color && 'coloured',
    queued && 'queued',
    queued && drag?.from === item.queueIndex && 'dragging',
    queued && drag && !drag.outside && drag.to === item.queueIndex && drag.from !== item.queueIndex && 'drop-target',
  ]
    .filter(Boolean)
    .join(' ');
  // a field to type into, in a button's shape: Enter confirms (the button after it), Escape cancels (the one after that)
  if (item.input)
    return (
      <input
        className="menu-btn menu-input"
        value={item.input.value}
        placeholder={item.input.placeholder}
        aria-label={item.input.placeholder}
        maxLength={40}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => onName?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect('confirmSave');
          else if (e.key === 'Escape') onSelect('cancelSave');
        }}
      />
    );
  // a slider: its name and value, the track on the right
  if (item.slider)
    return (
      <label className="menu-btn menu-slider" title={item.title}>
        {item.icon && <Icon name={item.icon} />}
        <Label text={item.label} />
        {xr ? (
          <SliderTrack
            slider={item.slider}
            label={splitLabel(item.label).name}
            onChange={(value) => onSlide?.(item.id, value)}
            onDone={() => onSlide?.(item.id, item.slider.value, true)}
          />
        ) : (
          <input
            type="range"
            min={item.slider.min}
            max={item.slider.max}
            step={item.slider.step}
            value={item.slider.value}
            aria-label={splitLabel(item.label).name}
            onChange={(e) => onSlide?.(item.id, Number(e.target.value))}
            onPointerUp={(e) => onSlide?.(item.id, Number(e.target.value), true)}
            onKeyUp={(e) => onSlide?.(item.id, Number(e.target.value), true)}
          />
        )}
      </label>
    );
  // just text to read: a button's shape, not one
  if (item.info)
    return (
      <div className={className} title={item.title}>
        {!item.compact && item.icon && <Icon name={item.icon} />}
        {item.compact ? <span className="option-label">{item.label}</span> : <Label text={item.label} />}
      </div>
    );
  return (
    <button
      className={className}
      disabled={item.disabled}
      title={queued ? 'Click to go to this chord; drag to reorder; drag out of the panel or double-click to remove' : item.title}
      aria-expanded={item.dropdown ? item.dropdown.open : undefined}
      aria-current={item.current || undefined}
      data-queue-index={queued ? item.queueIndex : undefined}
      style={item.current && item.color ? beatStyle(item) : undefined}
      onClick={() => (!queued || !queue?.wasDrag()) && onSelect(item.id)}
      {...(queued && queue ? queue.handlers(item) : {})}
    >
      {!item.compact && item.icon && <Icon name={item.icon} />}
      {item.compact ? <span className="option-label">{item.label}</span> : <Label text={item.label} />}
      {trailing && <Icon name={trailing} />}
    </button>
  );
}

/**
 * An open dropdown's choices, `dropdown.columns` to a row beneath its button
 * (or its row). A `removable` dropdown's choices are dragged out of the panel
 * to remove them (see useOptionDrag).
 */
function MenuOptions({ dropdown, onSelect, optionDrag }) {
  const removable = dropdown.removable && optionDrag;
  return (
    <div className="menu-options" role="listbox" style={{ gridTemplateColumns: `repeat(${dropdown.columns ?? 2}, minmax(0, 1fr))` }}>
      {dropdown.options.map((option) => (
        <button
          key={option.id}
          className={[
            'menu-option',
            option.selected && 'selected',
            removable && 'removable',
            removable && optionDrag.drag?.id === option.id && 'dragging',
          ]
            .filter(Boolean)
            .join(' ')}
          role="option"
          aria-selected={option.selected}
          aria-disabled={option.disabled || undefined}
          disabled={option.disabled}
          title={option.title ?? (removable ? 'Click to load; drag out of the panel to delete' : undefined)}
          onClick={() => (!removable || !optionDrag.wasDrag()) && onSelect(option.id)}
          {...(removable ? optionDrag.handlers(option) : {})}
        >
          {option.icon && <Icon name={option.icon} />}
          <span className="option-label">{option.label}</span>
          {option.selected && dropdown.checks !== false && <Icon name="check" />}
        </button>
      ))}
    </div>
  );
}

/** One row of buttons: a single button, or several in equal columns (see menuBlocks). */
function MenuRow({ row, onSelect, onSlide, onName, queue, optionDrag }) {
  const open = row.find((item) => item.dropdown?.open);
  const buttons = row.map((item) => <MenuButton key={item.id} item={item} onSelect={onSelect} onSlide={onSlide} onName={onName} queue={queue} />);
  return (
    <>
      {row[0].row == null ? (
        buttons
      ) : (
        <div className="menu-row" style={{ gridTemplateColumns: rowSpans(row).map((span) => `minmax(0, ${span}fr)`).join(' ') }}>
          {buttons}
        </div>
      )}
      {open && <MenuOptions dropdown={open.dropdown} onSelect={onSelect} optionDrag={optionDrag} />}
    </>
  );
}

/** A label's stand-in in the sizer: as wide as its button would be. */
function SizerButton({ text, compact, icon = true, small, trailing = true, slider }) {
  return compact ? (
    <div className="menu-btn compact">
      <span className="option-label">{text}</span>
    </div>
  ) : (
    <div className={`menu-btn${small ? ' small' : ''}${slider ? ' menu-slider' : ''}`}>
      {icon && <Icon name="instrument" />}
      <Label text={text} />
      {trailing && <Icon name="dropdown" />}
      {slider && <input type="range" tabIndex={-1} readOnly />}
    </div>
  );
}

function MenuButtons({ items, labels, onSelect, onSlide, onQueueEdit, onName, onRemoveOption }) {
  const xr = useContext(XrContext);
  const list = useRef(null);
  const queue = useQueueDrag(onQueueEdit);
  const { drag } = queue;
  const optionDrag = useOptionDrag(onRemoveOption);
  return (
    <div className="menu-items" ref={list}>
      {menuBlocks(items).map((block, b) => {
        const rows = block.rows.map((row) => (
          <MenuRow key={row[0].id} row={row} onSelect={onSelect} onSlide={onSlide} onName={onName} queue={queue} optionDrag={optionDrag} />
        ));
        const content = block.group ? (
          <div key={`group-${block.group}`} className="menu-group" data-group={block.group}>
            {rows}
          </div>
        ) : (
          <Fragment key={`block-${b}`}>{rows}</Fragment>
        );
        // an open section's buttons, set in beneath its header like a dropdown's choices, a step for each section
        return block.indent ? (
          <div key={`indent-${b}`} className="menu-indent" style={{ marginLeft: INDENT * block.indent }}>
            {content}
          </div>
        ) : (
          content
        );
      })}
      {/* the dragged chord, following the pointer; red where letting go removes it */}
      {drag && (
        <div className={`queue-ghost${drag.outside ? ' outside' : ''}`} style={ghostPlace(xr, list.current, drag.x, drag.y)} aria-hidden="true">
          {drag.outside ? `Remove ${drag.label}` : drag.label}
        </div>
      )}
      {/* ...and a dragged saved progression, red where letting go deletes it */}
      {optionDrag.drag && (
        <div className={`queue-ghost${optionDrag.drag.outside ? ' outside' : ''}`} style={ghostPlace(xr, list.current, optionDrag.drag.x, optionDrag.drag.y)} aria-hidden="true">
          {optionDrag.drag.outside ? `Delete ${optionDrag.drag.label}` : optionDrag.drag.label}
        </div>
      )}
      {/* invisible, zero-height copies of every possible label (and row of them): they set the panel's width */}
      <MenuSizer labels={labels} />
    </div>
  );
}

/**
 * Invisible, zero-height copies of every possible label (and row of them),
 * which set the panel's width. There are thousands, and they never change, so
 * a menu update doesn't re-render them.
 */
const MenuSizer = memo(function MenuSizer({ labels }) {
  return (
    <div className="menu-sizer" aria-hidden="true">
      {labels.map((entry) => {
        if (typeof entry === 'string') return <SizerButton key={entry} text={entry} />;
        // each column its shares: under max-content sizing, the grid makes every share as wide as the neediest column's
        const row = (
          <div className="menu-row sizer-row" style={{ gridTemplateColumns: entry.row.map(({ span }) => `${span}fr`).join(' ') }}>
            {entry.row.map(({ text, icon, trailing, slider }, i) => (
              <SizerButton key={i} text={text} compact={entry.compact} icon={icon} small={entry.small} trailing={trailing} slider={slider} />
            ))}
          </div>
        );
        const key = JSON.stringify(entry);
        const framed = entry.group ? <div className="menu-group">{row}</div> : row;
        return entry.indent ? (
          <div key={key} className="menu-indent" style={{ marginLeft: INDENT * entry.indent }}>
            {framed}
          </div>
        ) : (
          <Fragment key={key}>{framed}</Fragment>
        );
      })}
    </div>
  );
});

/**
 * The View panel, beneath the options, as grid-game-threejs's: one button that switches between
 * the Normal view (the monitor) and XR: Headset (the headset), showing the one it switches to.
 */
export function ViewPanel({ icon, label, onClick, xr = false }) {
  return (
    <aside className={`hud collapsed${xr ? ' xr' : ''}`}>
      <header>
        <button className="collapse" onClick={onClick} aria-label={label} title={label}>
          <Icon name={icon} />
        </button>
      </header>
    </aside>
  );
}

const HUD_MIN = { width: 220, height: 120 }; // px: the smallest the panel can be dragged to
const HUD_MARGIN = 12; // px kept clear between the panel and the window's right and bottom edges
const XR_MAX = { width: 1400, height: 1500 }; // px: the largest a panel can be dragged to (about a metre)
const XR_SIZE_KEY = 'xr-music-panel-size'; // a panel's size, kept on this device
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

function loadXrSize() {
  try {
    const s = JSON.parse(localStorage.getItem(XR_SIZE_KEY));
    return Number.isFinite(s?.width) && Number.isFinite(s?.height) ? s : null;
  } catch {
    return null;
  }
}
function saveXrSize(size) {
  try {
    if (size) localStorage.setItem(XR_SIZE_KEY, JSON.stringify(size));
    else localStorage.removeItem(XR_SIZE_KEY);
  } catch {
    // (storage blocked: it's forgotten)
  }
}

/**
 * The options panel: draws the shared menu model, on the page or (`xr`) on a
 * panel in the scene. Its corner grip resizes it (double-click fits it to
 * its buttons again); the size holds while it's closed and opened again, and
 * a panel's is kept on this device.
 */
export function Hud({ menu, notes = [], xr = false }) {
  const panel = useRef(null);
  const [size, setSizeState] = useState(xr ? loadXrSize : null); // { width, height } in px, or null to fit the buttons
  const setSize = (next) => {
    setSizeState(next);
    if (xr) saveXrSize(next);
  };
  const startResize = (e) => {
    e.preventDefault();
    const grip = e.currentTarget;
    capture(e);
    const box = panel.current.getBoundingClientRect();
    const from = { x: e.clientX, y: e.clientY };
    // on the page, kept inside the window; on a panel, within XR_MAX
    const maxW = xr ? XR_MAX.width : window.innerWidth - box.left - HUD_MARGIN;
    const maxH = xr ? XR_MAX.height : window.innerHeight - box.top - HUD_MARGIN;
    const onMove = (m) =>
      setSize({
        width: clamp(box.width + m.clientX - from.x, HUD_MIN.width, maxW),
        height: clamp(box.height + m.clientY - from.y, HUD_MIN.height, maxH),
      });
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  };
  // the gear, top left, opens and closes the panel; closed, the panel holds just the gear
  const gear = (
    <button
      className="collapse"
      onClick={() => menu.onSelect(MENU_TOGGLE)}
      aria-label={menu.open ? 'Hide options' : 'Show options'}
      aria-expanded={menu.open}
      title="Options"
    >
      <Icon name="gear" />
    </button>
  );
  if (!menu.open) {
    return (
      <aside className={`hud collapsed${xr ? ' xr' : ''}`}>
        <header>{gear}</header>
      </aside>
    );
  }
  return (
    <XrContext.Provider value={xr}>
      <aside className={`hud${xr ? ' xr' : ''}`} ref={panel} style={size ? { width: size.width, height: size.height, maxHeight: 'none' } : undefined}>
        <header>
          {gear}
          <h1>{menu.title}</h1>
        </header>

        <div className="hud-body">
          {menu.status && <p className="stats">{menu.status}</p>}
          <MenuButtons
            items={menu.items}
            labels={menu.labels}
            onSelect={menu.onSelect}
            onSlide={menu.onSlide}
            onQueueEdit={menu.onQueueEdit}
            onName={menu.onName}
            onRemoveOption={menu.onRemoveOption}
          />
          {notes.map(({ text, error }) => (
            <p key={text} className={error ? 'note error' : 'note'} role={error ? 'alert' : undefined}>
              {text}
            </p>
          ))}
        </div>
        <div className="hud-resize" onPointerDown={startResize} onDoubleClick={() => setSize(null)} title="Drag to resize (double-click: reset)" />
      </aside>
    </XrContext.Provider>
  );
}

