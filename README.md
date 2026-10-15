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
- Notes in the scale are bright and stand 10 cm out toward you (`SCALE_RAISE`). The current chord's notes stand further out (`CHORD_RAISE`): while a progression plays or is paused, its current chord; otherwise the triad on the key. They glide to their new places when the chord changes, and a chord's notes play at a touch even when they're outside the scale.
- The bottom row is the lowest string. The open strings are on the left, and frets 1 to 24 run to the right.

## Controls

The options panel has three submenus, each marked with an arrow. **Instrument** holds Sample, Echo, Tuning, Key and Scale. **Progression** holds the progression's transport and tempo, the chord builder and the chord queue. **Video** holds Background and View Mode. Each submenu starts with a Back button. Sample, Tuning, Key, Scale, Beats per Minute, Beats per Measure, the chord builder's settings, Background and View Mode are dropdowns: press one to list its choices beneath it, two to a row, then pick one. Some settings share a row. The Instrument and Progression settings and the progression are saved in a cookie (for this app's folder only) and restored when the page loads. A panel too tall for the screen scrolls below its title: with the mouse wheel on the monitor, or by pointing at the panel and pushing the right thumbstick up or down in XR.

| Action | Desktop | XR |
| --- | --- | --- |
| Play a note in the scale (bright) | Hover over it | Touch it with a controller tip or fingertip. Each tip, fingertip and the pick sounds every note it touches, so a tip between two cubes plays both, and any number of notes can sound at once |
| Play by gaze (phones) | — | Look at a note in the scale. Keep a finger on the screen to play notes outside it too |
| Hands-free panel | — | Look at a panel button for 1 s (a ring fills, then it clicks) |
| Play any note, in the scale or not | Press the mouse button on it; keep the button down and drag to strum across the board (the view holds still) | Touch it while holding that controller's trigger. A tracked hand can only play notes in the scale |
| Sample (the sound) | Instrument, `I` (`Shift+I` goes back). The synths come first, then the samples | Instrument |
| Scale / Key / Tuning | Instrument, `S` / `K` / `T` | Instrument |
| Echo | Instrument, `E` | Instrument |
| Tempo | Progression: Beats per Minute (40 to 200) and Beats per Measure (2 to 7), side by side below Play and Stop. Each chord in a progression lasts one measure | Progression |
| Build a progression | Progression. Choose a **Degree Triad** (the triad on each degree of the key's scale, as "ii: Dm" or "vii°: B°"), which sets the chord's root and quality. On one row below: **Alteration** (♭, ♮, ♯) moves its root a semitone; **Quality** is Maj, Min, ° (diminished; with a 7 it's the fully diminished °7), ø (half diminished, ø7), + (augmented), Sus2 or Sus4; **Modifier** adds 7, Δ7 (major 7th), 6 or add9. Then press **Add Chord**, which shows the chord it adds. The queue below, in its own frame, lists the progression four chords to a row; it starts empty | Same |
| Edit a progression | Press a chord in the queue for **Play From Here**, **Move Earlier**, **Move Later** or **Remove** | Same |
| Play / pause / stop a progression | Progression: **Play** / **Pause** and **Stop** share a row. Play / Pause (shows the chord and beat), `P`; **Stop** returns to the start and raises the key's triad again. It loops, and the playing chord is lit in the queue | Same |
| The pick | — | XR: Headset only. A 10 cm guitar pick, a rounded triangle with all three corners equally rounded, starts docked on the right controller, standing upright like a blade just in front of it, tip forward. Take it off with the other controller: put that tip on it, or point at it, and hold the grip (it clicks). Carry it with one grip, or scale and turn it with both, as with the Fretboard; let go within reach of a controller to dock it there (a click and a buzz on that controller). All of it plays notes, not just the tip: the hand holding it, or the controller it's docked on, feels the kicks and hums, and that hand's trigger lets it play notes outside the scale. Meanwhile that controller's own tip doesn't play. It glows while touched and held. With hand tracking only, it waits in front of you, below the board |
| Show / hide the panel | Gear button, `Enter`, `Esc` | Gear on the panel |
| Leave XR | Choose a windowed View Mode | The left controller's menu button (Quest 3 controllers) returns to Normal |
| Orbit / zoom | Drag / scroll | Walk around. The left stick moves you and the right stick turns you |
| Bend a note | — | Touch a note with a controller tip and hold the grip, then pull along the frets: the cube slides with your hand and its pitch follows, a semitone higher for each fret's width to the right, lower to the left, up to 3 frets either way. Samples play faster or slower; synths shift pitch. You feel a tick at each semitone, and while bending, that tip plays only the bent note. Let go and it springs back to its fret, its pitch gliding back with it |
| Feel the frame | — | Touch it with a controller tip: a light tap, then a soft hum while you stay on it. It glows while touched |
| Grab by pointing | — | Point a controller's ray at the frame, the pick or the panel and hold the grip to take it, from any distance; it moves with your hand as if on a stick. The frame and the pick glow while pointed at, so you can see what the grip will take. Touching something takes it before pointing does |
| Move / turn the Fretboard | — | Put a controller tip on the frame (or point at it) and hold the grip. The Fretboard follows that hand, moving and turning with it |
| Scale / turn the Fretboard | — | Hold both grips on the frame (as in Tilt Brush). Pull your hands apart or push them together to scale it, and turn the line between them to rotate it |
| The panel in XR | — | With VR controllers it starts on the left controller, like a palette held in that hand: press its buttons with the right controller's ray. Point at it or touch it with the other controller and hold the grip to take it (with a click); let go near the other controller to dock it there, near the Fretboard to dock it against the frame's nearest edge (it then moves with the Fretboard), or anywhere else to leave it floating. Docking clicks and buzzes the controller it lands on. Without controllers (hand tracking, phones) it floats to your left |
| Background: Solid / Skybox / Passthrough | Video. Solid and Skybox are the 4D viewer's: a dark grey, or the starry sky | Video. Passthrough switches live in an AR session |
| View Mode | Video. **3D: SBS** is half side-by-side stereo for 3D TVs and projectors; hovering works in either half. **3D: Interlaced** puts the left eye on every other row (starting at the top) and the right eye between, for passive polarised 3D monitors | Video. **XR: Headset** on headsets. On phones, as in the 4D viewer: **XR: Phone AR** (one view) and **XR: Phone Viewer** (two lens-corrected eyes for a phone viewer), tracked by ARCore, or steered by the motion sensors where there is no AR. Choose a windowed mode to leave XR |

Instruments are samples played back at the note's pitch: Trombone, Piano, Banjo, Harp, Koto, Clarinet, French Horn, Alto Sax, Flute, Viola, Strings, Xylophone and Bass Guitar. Sine, Triangle, Sawtooth and Square are synths: an oscillator playing that wave, which sounds for as long as you hold a note. In the Instrument dropdown, each synth shows its wave and each sample shows a recorded clip. Each sample's recorded pitch is found when it loads (see `src/pitch.js`), so every instrument plays in tune.

## Layout

- `src/App.jsx`: app state, keyboard shortcuts, HUD and the XR session button
- `src/Scene.jsx`: lights and shadow floor, backdrop, the board, locomotion, and who is touching which note
- `src/Fretboard.jsx`: the Fretboard object: the note cubes and their labels, the frame, and the touch tests
- `src/Touch.jsx`: controller and hand mallets, the haptic pulses for notes and the frame, and gaze play for phones
- `src/Grab.jsx`, `src/grip.js`: grip-button controls that take hold of the frame or the pick to move, turn and scale it, or carry the panel and dock it to a controller or the frame
- `src/Pick.jsx`: the XR pick: its shape, its docked pose, and the touch tests for grabbing it and for playing with all of it
- `src/progression.js`: the chord progression's transport: play, pause, stop and the beat clock
- `src/settings.js`: saving the music settings and progression in a cookie, and restoring them
- `src/audio.js`: the Web Audio engine: sample loading, playback, the oscillator voices and the echo
- `src/pitch.js`: pitch detection for samples (McLeod pitch method)
- `src/music.js`: note names, colours, scales and tunings, and chords: types, modifiers, names and the chords in a key
- `src/menu.js`: the options menu, its Instrument, Progression and Video submenus and its dropdowns, shared by both panels
- `src/XRMenuPanel.jsx`: the options panel in XR, drawn on a canvas
- `src/SideBySide.jsx`: the 3D: SBS view, and pointer picking in either half
- `src/Interlaced.jsx`: the 3D: Interlaced view, each eye rendered off screen and woven row by row
- `src/PhoneStereo.jsx`: split-screen stereo on a phone's WebXR AR session, plus its camera-feed passthrough (from the 4D viewer)
- `src/Cardboard.jsx`, `src/CardboardLens.js`: the motion-sensor view for phones without AR, and the phone viewer's lens model (from the 4D viewer)
- `src/Gaze.jsx`: gaze reticle and 1-second dwell-to-click (from the 4D viewer)
- `src/Icon.jsx`: icons used in the panel
- `public/sounds/`: instrument samples, from `fretboard-webaudio`
- `public/img/skybox.jpg`: the equirectangular skybox, from `4d-viewer-threejs`
