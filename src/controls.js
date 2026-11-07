// What each input does here, for Options → Controls (controlsGuide.js draws it) and the
// XR Control Guides (Scene's guideTexts starts from xrTexts).

/** What each part of `hand`'s XR controller does at rest: { componentId: text }. */
export const xrTexts = (hand) => ({
  'xr-standard-trigger': 'Select · slide\nHeld: every note sounds',
  'xr-standard-squeeze': 'Grab · bend a note\n×2: Dock / undock panels\n×3: Summon panels',
  'xr-standard-thumbstick': hand === 'left' ? 'Move' : 'Turn\nOn the menu: ↕ Scroll',
  menu: hand === 'left' ? 'Leave XR' : '',
});

/** Each input's controls (see controlsGuide.js): no gamepad controls yet. */
export const CONTROLS = {
  mk: {
    mouse: {
      left: 'Click a note: play it\nDrag across notes: strum\nDrag elsewhere: orbit',
      middle: 'Drag: zoom',
      wheel: 'Zoom',
      right: 'Drag: pan',
    },
    keys: [
      { keys: ['Space', '/', 'P'], action: 'Play / pause' },
      { keys: ['Esc'], action: 'Stop' },
      { keys: ['1', '–', '9'], action: 'The key’s chord on that degree (Shift: its 7th)' },
      { keys: ['I'], action: 'Next instrument (Shift: previous)' },
      { keys: ['S'], action: 'Next scale (Shift: previous)' },
      { keys: ['K'], action: 'Next key (Shift: previous)' },
      { keys: ['T'], action: 'Next tuning (Shift: previous)' },
      { keys: ['E'], action: 'Echo on / off' },
      { keys: ['Enter'], action: 'Options' },
    ],
  },
  pad: null,
  xr: { left: xrTexts('left'), right: xrTexts('right') },
};
