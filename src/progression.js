import { useCallback, useEffect, useMemo, useState } from 'react';
import { setBeatGrid } from './audio.js';

// Playing a chord progression: each chord lasts one measure (`beatsPerMeasure`
// beats at `bpm`), and the progression loops. Stopped, there is no current
// chord; paused, the current one stays. Its beats are the quantize grid's
// (see audio.js).

/**
 * The progression's transport. Returns { playing, started (playing or paused),
 * index (the current chord's, or null when stopped), beat (0-based within the
 * measure), toggle (play / pause), stop, select(index) }.
 */
export function useProgression(progression, bpm, beatsPerMeasure) {
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0); // beats since the start

  // one beat at a time, scheduled against the clock so it doesn't drift; a beat falls now, for quantizing
  useEffect(() => {
    if (!playing) return;
    const beatMs = 60000 / bpm;
    setBeatGrid({ origin: performance.now() / 1000 });
    let next = performance.now() + beatMs;
    let timer;
    const tick = () => {
      setStep((s) => s + 1);
      next += beatMs;
      timer = setTimeout(tick, Math.max(0, next - performance.now()));
    };
    timer = setTimeout(tick, beatMs);
    return () => clearTimeout(timer);
  }, [playing, bpm]);

  const length = progression.length;
  const stop = useCallback(() => {
    setPlaying(false);
    setStarted(false);
    setStep(0);
  }, []);
  // removing the last chord stops it
  useEffect(() => {
    if (!length) stop();
  }, [length, stop]);

  const toggle = useCallback(() => {
    if (!length) return;
    setStarted(true);
    setPlaying((p) => !p);
  }, [length]);
  // jumps to a chord: playing, it carries on from there; stopped, it's paused there
  const select = useCallback(
    (index) => {
      setStep(index * beatsPerMeasure);
      setStarted(true);
    },
    [beatsPerMeasure],
  );

  const index = started && length ? Math.floor(step / beatsPerMeasure) % length : null;
  return useMemo(
    () => ({ playing, started, index, beat: step % beatsPerMeasure, toggle, stop, select }),
    [playing, started, index, step, beatsPerMeasure, toggle, stop, select],
  );
}
