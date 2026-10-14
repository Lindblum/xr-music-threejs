# XR Music

A fretboard of note cubes, one per string and fret, standing half a metre in front of you. You play it by touching it. In WebXR, each controller tip or index fingertip is a mallet: touching a cube plays its note, and the controller kicks as it goes in and hums softly while it stays inside. On desktop you play by hovering over the cubes or clicking them.

This remakes `webxr_xr_haptics_mod.html`, an old page built on the three.js haptics example, using [three.js](https://threejs.org), React, [@react-three/fiber](https://r3f.docs.pmnd.rs) and [@react-three/xr](https://pmndrs.github.io/xr/). It's built with Vite, the same way as `4d-viewer-threejs`.

## Develop

```sh
npm install
npm run dev        # http://localhost:5174. A Quest 3 emulator stands in for a headset on localhost
npm run dev:xr     # HTTPS on your LAN, so a real headset can connect
```

## Build a static site

```sh
npm run build      # writes dist/ with relative paths, so any static host or subfolder works
npm run preview
```

`.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on every push to `master`.

## The Fretboard

The Fretboard object holds the note cubes (`Notes`) inside a picture frame (`FretboardFrame`). The frame is the handle for moving the whole thing.

- Each cube is coloured by its note around the colour wheel (the old page's colours), with its name on the front face.
- Notes in the scale are bright and stand 10 cm out toward you. The triad on the key stands another 5 cm out.
- The bottom row is the lowest string. The open strings are on the left, and frets 1 to 24 run to the right.

## Controls

The options panel has two submenus, each marked with an arrow. **Music** holds Instrument, Scale, Key, Tuning and Echo. **Video** holds Background and View Mode. Each submenu starts with a Back button. Instrument, Scale, Key, Tuning, Background and View Mode are dropdowns: press one to list its choices beneath it, two to a row, then pick one. A panel too tall for the screen scrolls below its title: with the mouse wheel on the monitor, or by pointing at the panel and pushing the right thumbstick up or down in XR.

| Action | Desktop | XR |
| --- | --- | --- |
| Play a note in the scale (bright) | Hover over it | Touch it with a controller tip or fingertip |
| Play by gaze (phones) | — | Look at a note in the scale. Keep a finger on the screen to play notes outside it too |
| Hands-free panel | — | Look at a panel button for 1 s (a ring fills, then it clicks) |
| Play any note, in the scale or not | Press the mouse button on it; keep the button down and drag to strum across the board (the view holds still) | Touch it while holding that controller's trigger. A tracked hand can only play notes in the scale |
| Instrument | Music, `I` (`Shift+I` goes back) | Music |
| Scale / Key / Tuning | Music, `S` / `K` / `T` | Music |
| Echo | Music, `E` | Music |
| Show / hide the panel | Gear button, `Enter`, `Esc` | Gear on the panel |
| Orbit / zoom | Drag / scroll | Walk around. The left stick moves you and the right stick turns you |
| Feel the frame | — | Touch it with a controller tip: a light tap, then a soft hum while you stay on it. It glows while touched |
| Move / turn the Fretboard | — | Put a controller tip on the frame and hold the grip. The Fretboard follows that hand, moving and turning with it |
| Scale / turn the Fretboard | — | Hold both grips on the frame (as in Tilt Brush). Pull your hands apart or push them together to scale it, and turn the line between them to rotate it |
| The panel in XR | — | With VR controllers it rides on the left controller, like a palette held in that hand: press its buttons with the right controller's ray. Without them (hand tracking, phones) it floats to your left; point at it and hold the grip to move it |
| Background: Solid / Skybox / Passthrough | Video. Solid and Skybox are the 4D viewer's: a dark grey, or the starry sky | Video. Passthrough switches live in an AR session |
| View Mode | Video. **3D: SBS** is half side-by-side stereo for 3D TVs and projectors; hovering works in either half. **3D: Interlaced** puts the left eye on every other row (starting at the top) and the right eye between, for passive polarised 3D monitors | Video. **XR: Headset** on headsets. On phones, as in the 4D viewer: **XR: Phone AR** (one view) and **XR: Phone Viewer** (two lens-corrected eyes for a phone viewer), tracked by ARCore, or steered by the motion sensors where there is no AR. Choose a windowed mode to leave XR |

Instruments are samples played back at the note's pitch: Trombone, Piano, Banjo, Harp, Koto, Clarinet, French Horn, Alto Sax, Flute, Viola, Strings, Xylophone and Bass Guitar. Sine, Triangle, Sawtooth and Square are synths: an oscillator playing that wave, which sounds for as long as you hold a note. In the Instrument dropdown, each synth shows its wave and each sample shows a recorded clip. Each sample's recorded pitch is found when it loads (see `src/pitch.js`), so every instrument plays in tune.

## Layout

- `src/App.jsx`: app state, keyboard shortcuts, HUD and the XR session button
- `src/Scene.jsx`: lights and shadow floor, backdrop, the board, locomotion, and who is touching which note
- `src/Fretboard.jsx`: the Fretboard object: the note cubes and their labels, the frame, and the touch tests
- `src/Touch.jsx`: controller and hand mallets, the haptic pulses for notes and the frame, and gaze play for phones
- `src/Grab.jsx`, `src/grip.js`: grip-button controls that take hold of the frame to move, turn and scale the Fretboard, or carry the panel
- `src/audio.js`: the Web Audio engine: sample loading, playback, the oscillator voices and the echo
- `src/pitch.js`: pitch detection for samples (McLeod pitch method)
- `src/music.js`: note names, colours, scales and tunings
- `src/menu.js`: the options menu, its Music and Video submenus and its dropdowns, shared by both panels
- `src/XRMenuPanel.jsx`: the options panel in XR, drawn on a canvas
- `src/SideBySide.jsx`: the 3D: SBS view, and pointer picking in either half
- `src/Interlaced.jsx`: the 3D: Interlaced view, each eye rendered off screen and woven row by row
- `src/PhoneStereo.jsx`: split-screen stereo on a phone's WebXR AR session, plus its camera-feed passthrough (from the 4D viewer)
- `src/Cardboard.jsx`, `src/CardboardLens.js`: the motion-sensor view for phones without AR, and the phone viewer's lens model (from the 4D viewer)
- `src/Gaze.jsx`: gaze reticle and 1-second dwell-to-click (from the 4D viewer)
- `src/Icon.jsx`: icons used in the panel
- `public/sounds/`: instrument samples, from `fretboard-webaudio`
- `public/img/skybox.jpg`: the equirectangular skybox, from `4d-viewer-threejs`
