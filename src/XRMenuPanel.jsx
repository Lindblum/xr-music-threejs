import { useRef } from 'react';
import { DomPanel } from './DomPanel.jsx';
import { Hud, ViewPanel } from './Menu.jsx';

// The panels in XR (and the windowed 3D views' menu): the page's own
// options panel and View panel (see Menu.jsx), with `xr` set, shown as
// panels in the scene (see DomPanel.jsx).

/**
 * The options panel. `menu` is the page's (see App.jsx); a choice made from
 * it carries the controller (or hand) that made it, as `{ hand }`, for
 * choices that belong to one (an instrument). `overlay`, `stickBusy`: see
 * DomPanel.
 */
export function XRMenuPanel({ menu, overlay, stickBusy, groupRef, ...groupProps }) {
  const hand = useRef(undefined);
  const panelMenu = { ...menu, onSelect: (id) => menu.onSelect(id, { hand: hand.current }) };
  return (
    <DomPanel overlay={overlay} stickBusy={stickBusy} onSource={(h) => (hand.current = h)} groupRef={groupRef} {...groupProps}>
      <Hud menu={panelMenu} notes={menu.notes} xr />
    </DomPanel>
  );
}

/** The View panel: its button leaves XR for the Normal view (`onSelect`). */
export function XRViewPanel({ onSelect, groupRef, ...groupProps }) {
  return (
    <DomPanel groupRef={groupRef} {...groupProps}>
      <ViewPanel icon="monitor" label="Normal view" onClick={onSelect} xr />
    </DomPanel>
  );
}
