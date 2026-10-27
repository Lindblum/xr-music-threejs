import music from 'lineicons/assets/svgs/regular/music.svg?raw';
import sliders from 'lineicons/assets/svgs/regular/sliders-horizontal-square-2.svg?raw';
import arrowLeft from 'lineicons/assets/svgs/regular/arrow-left.svg?raw';
import arrowRight from 'lineicons/assets/svgs/regular/arrow-right.svg?raw';
import chevronDown from 'lineicons/assets/svgs/regular/chevron-down.svg?raw';
import chevronUp from 'lineicons/assets/svgs/regular/chevron-up.svg?raw';
import check from 'lineicons/assets/svgs/regular/check.svg?raw';
import gear from 'lineicons/assets/svgs/regular/gear-1.svg?raw';
import picture from 'lineicons/assets/svgs/regular/gallery.svg?raw';
import globe from 'lineicons/assets/svgs/regular/globe-1.svg?raw';
import play from 'lineicons/assets/svgs/regular/play.svg?raw';
import pause from 'lineicons/assets/svgs/regular/pause.svg?raw';
import plus from 'lineicons/assets/svgs/regular/plus.svg?raw';
import trash from 'lineicons/assets/svgs/regular/trash-3.svg?raw';
import stopwatch from 'lineicons/assets/svgs/regular/stopwatch.svg?raw';
import layers from 'lineicons/assets/svgs/regular/layers-1.svg?raw';
import arrowUp from 'lineicons/assets/svgs/regular/arrow-upward.svg?raw';
import arrowDown from 'lineicons/assets/svgs/regular/arrow-downward.svg?raw';
import floppyDisk from 'lineicons/assets/svgs/regular/floppy-disk-1.svg?raw';
import folder from 'lineicons/assets/svgs/regular/folder-1.svg?raw';
import gamepad from 'lineicons/assets/svgs/regular/game-pad-modern-1.svg?raw';

// Lineicons ship with a fixed fill; recolour to follow the surrounding text
// and size to the font.
const recolour = (svg) =>
  svg
    .replace(/fill="#323544"/g, 'fill="currentColor"')
    .replace(/\swidth="\d+"\sheight="\d+"/, ' width="1.25em" height="1.25em" aria-hidden="true"');

// The free Lineicons set has no VR headset (its "oculus" icon is the brand
// wordmark) and nothing for scales, key signatures or echo, so these are
// drawn to match: 24px grid, 1.5px rounded strokes.
const headset = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M5.5 7h13A2.5 2.5 0 0 1 21 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-3.13a1.5 1.5 0 0 1-1.3-.76l-.77-1.35a1.5 1.5 0 0 0-2.6 0l-.77 1.35a1.5 1.5 0 0 1-1.3.76H5.5A2.5 2.5 0 0 1 3 14.5v-5A2.5 2.5 0 0 1 5.5 7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M3 11.5H1.75M21 11.5h1.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const monitor = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="2.75" y="4.25" width="18.5" height="12" rx="1.75" stroke="currentColor" stroke-width="1.5"/>
<path d="M12 16.25v3.5M8.5 19.75h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

// 3D: SBS: the screen split in two, an eye in each half
const monitorSbs = monitor.replace(
  '</svg>',
  `<path d="M12 6v8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
<circle cx="7.4" cy="10.25" r="1.4" fill="currentColor"/>
<circle cx="16.6" cy="10.25" r="1.4" fill="currentColor"/>
</svg>`,
);

// 3D: Interlaced: the screen in alternating rows
const monitorInterlaced = monitor.replace(
  '</svg>',
  `<path d="M5.5 7.25h13M5.5 10.25h13M5.5 13.25h13" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
<path d="M5.5 8.75h13M5.5 11.75h13" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-opacity="0.4"/>
</svg>`,
);

// Phone views: a phone, and a phone turned sideways in a viewer (two lenses)
const phone = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="6.75" y="2.75" width="10.5" height="18.5" rx="2" stroke="currentColor" stroke-width="1.5"/>
<path d="M10.75 18.25h2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const phoneViewer = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="2.75" y="6.75" width="18.5" height="10.5" rx="2" stroke="currentColor" stroke-width="1.5"/>
<path d="M12 6.75v10.5" stroke="currentColor" stroke-width="1.5"/>
<circle cx="7.4" cy="12" r="2.1" stroke="currentColor" stroke-width="1.5"/>
<circle cx="16.6" cy="12" r="2.1" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

// Video: the screen playing
const video = monitor.replace(
  '</svg>',
  `<path d="M10.25 7.6v5.3l4.4-2.65-4.4-2.65Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>
</svg>`,
);

// Solid background: a filled rectangle
const solid = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="2.75" y="5" width="18.5" height="14" rx="1.5" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

// Scale: notes climbing a staff
const scale = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M1.5 6.5h21M1.5 12h21M1.5 17.5h21" stroke="currentColor" stroke-width="1" stroke-opacity="0.4"/>
<ellipse cx="5" cy="17.5" rx="3" ry="2.2" transform="rotate(-20 5 17.5)" fill="currentColor"/>
<ellipse cx="12" cy="12" rx="3" ry="2.2" transform="rotate(-20 12 12)" fill="currentColor"/>
<ellipse cx="19" cy="6.5" rx="3" ry="2.2" transform="rotate(-20 19 6.5)" fill="currentColor"/>
</svg>`;

// Key: a sharp sign, as in a key signature
const keySignature = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M9.5 3.5v17.5M14.5 3v17.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
<path d="M5 10.25l14-2.5M5 16.75l14-2.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

// Echo: a sound and its repeats, each fainter and shorter
const echo = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M3.5 3.5v17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
<path d="M9 6.5v11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-opacity="0.75"/>
<path d="M14.5 9v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-opacity="0.5"/>
<path d="M20 10.75v2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-opacity="0.3"/>
</svg>`;

// Echo off: the sound alone, then silence
const echoOff = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M3.5 3.5v17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
<path d="M8.5 12h12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="1.5 3" stroke-opacity="0.6"/>
</svg>`;

// Stop: a square, outlined like Lineicons' play and pause
const stop = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="5.75" y="5.75" width="12.5" height="12.5" rx="2" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

// Beats per measure: a bar of four beats, the first accented
const beats = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M2 4v16M22 4v16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
<path d="M6 7v10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
<path d="M10 10v4M14 10v4M18 10v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

// Velocity: bars rising, as a note struck harder sounds louder
const velocity = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M4 19v-3M9 19v-6M14 19v-9M19 19V5" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"/>
</svg>`;

// Chord: three notes stacked on one stem
const chord = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<ellipse cx="9" cy="19" rx="3" ry="2.2" transform="rotate(-20 9 19)" fill="currentColor"/>
<ellipse cx="9" cy="13.5" rx="3" ry="2.2" transform="rotate(-20 9 13.5)" fill="currentColor"/>
<ellipse cx="9" cy="8" rx="3" ry="2.2" transform="rotate(-20 9 8)" fill="currentColor"/>
<path d="M11.75 18.5V2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

// Progression: chords one after another along a line
const progression = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M1.5 20.5h21" stroke="currentColor" stroke-width="1" stroke-opacity="0.4"/>
<rect x="2.5" y="11" width="4.5" height="7" rx="1" fill="currentColor"/>
<rect x="9.75" y="6" width="4.5" height="12" rx="1" fill="currentColor" fill-opacity="0.75"/>
<rect x="17" y="9" width="4.5" height="9" rx="1" fill="currentColor" fill-opacity="0.5"/>
</svg>`;

// Instruments. A synth shows the wave its oscillator plays, one period of it;
// a sample shows a recorded clip, an uneven waveform that swells and fades.
const wave = (d) => `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="${d}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
const sine = wave('M2.5 12c2.4-7.5 7.1-7.5 9.5 0s7.1 7.5 9.5 0');
const triangle = wave('M2.5 12 7.25 5l9.5 14 4.75-7');
const sawtooth = wave('M2.5 16.5 12 7.5v9l9.5-9v9');
const square = wave('M2.5 12V6.5H12v11h9.5V12');
const sample = wave('M3 11v2M6 9v6M9 5v14M12 7.5v9M15 9.5v5M18 10.75v2.5M21 11.5v1');
// Record: a filled dot; Analyze: a waveform under a magnifying glass
const record = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<circle cx="12" cy="12" r="6.5" fill="currentColor"/>
</svg>`;
const analyze = wave('M2.5 12h1.5M6 9v6M9 7v10M12 10v4M14.5 14.5a4.5 4.5 0 1 0 0-.01M17.75 17.75 21.5 21.5');

// Vibration: a controller between buzz marks; off, the marks gone and a slash through it
const vibrationBody = `<rect x="8" y="4" width="8" height="16" rx="2.5" stroke="currentColor" stroke-width="1.5"/>`;
const vibrationOn = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
${vibrationBody}
<path d="M4.75 8.5 3 10.25l1.75 1.75L3 13.75l1.75 1.75M19.25 8.5 21 10.25l-1.75 1.75L21 13.75l-1.75 1.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
const vibrationOff = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
${vibrationBody}
<path d="M3.5 3.5l17 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

// Accessibility: a figure with open arms, in a circle (grid-game-threejs's, drawn on this grid)
const accessibility = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<circle cx="12" cy="12" r="9.6" stroke="currentColor" stroke-width="1.5"/>
<circle cx="12" cy="6.5" r="1.45" fill="currentColor"/>
<path d="M6.25 9.6h11.5M12 9.6v4.3M9.1 18.7 12 13.9l2.9 4.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// XR Resolution: a pixel grid, its cells finer toward one corner (grid-game-threejs's, drawn on this grid)
const xrResolution = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="3.85" y="3.85" width="16.3" height="16.3" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M12 3.85v16.3M3.85 12h16.3" stroke="currentColor" stroke-width="1.5"/>
<path d="M7.9 3.85V12M3.85 7.9H12" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.5"/>
</svg>`;

// Text Size: a big A beside a small one (as in 4d-viewer-threejs)
const textSize = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M2.75 19.25 8 4.75l5.25 14.5M4.6 14.25h6.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M14.25 19.25 17.75 10l3.5 9.25M15.5 16.25h4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// Controller Guide: a gamepad, struck through when off (as in 4d-viewer-threejs)
const controllerGuideOn = recolour(gamepad);
const controllerGuideOff = recolour(gamepad).replace(
  '</svg>',
  `<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`,
);

const ICONS = {
  instrument: recolour(music),
  sample,
  record,
  analyze,
  sine,
  triangle,
  sawtooth,
  square,
  scale,
  key: keySignature,
  tuning: recolour(sliders),
  echo,
  echoOff,
  video,
  // Back, and its mirror marking a button that opens a submenu
  back: recolour(arrowLeft),
  forward: recolour(arrowRight),
  // a dropdown, closed and open, and the chosen option in its list
  dropdown: recolour(chevronDown),
  dropdownOpen: recolour(chevronUp),
  check: recolour(check),
  gear: recolour(gear),
  solid,
  skybox: recolour(globe),
  passthrough: recolour(picture),
  monitor,
  monitorSbs,
  monitorInterlaced,
  vr: headset,
  phone,
  phoneViewer,
  // the progression and its transport
  tempo: recolour(stopwatch),
  beats,
  velocity,
  progression,
  chord,
  modifier: recolour(layers),
  play: recolour(play),
  pause: recolour(pause),
  stop,
  add: recolour(plus),
  remove: recolour(trash),
  earlier: recolour(arrowUp),
  later: recolour(arrowDown),
  // saved progressions
  save: recolour(floppyDisk),
  load: recolour(folder),
  // Accessibility
  accessibility,
  xrResolution,
  textSize,
  vibrationOn,
  vibrationOff,
  controllerGuideOn,
  controllerGuideOff,
};

/** An icon as a standalone SVG in a fixed colour, for drawing onto a canvas. */
export function iconSvg(name, color = '#ffffff') {
  return (ICONS[name] ?? '')
    .replace(/currentColor/g, color)
    .replace(/width="1\.25em" height="1\.25em"/, 'width="96" height="96"');
}

export default function Icon({ name }) {
  return <span className="icon" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}
