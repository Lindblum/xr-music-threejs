import { useCallback, useEffect, useMemo, useState } from 'react';

// Playing a chord progression: each chord lasts one measure (`beatsPerMeasure`
// beats at `bpm`), and the progression loops. Stopped, there is no current
// chord; paused, the current one stays.

/**
 * The progression's transport. Returns { playing, started (playing or paused),
 * index (the current chord's, or null when stopped), beat (0-based within the
 * measure), toggle (play / pause), stop, playFrom(index) }.
 */
export function useProgression(progression, bpm, beatsPerMeasure) {
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0); // beats since the start

  // one beat at a time, scheduled against the clock so it doesn't drift
  useEffect(() => {
    if (!playing) return;
    const beatMs = 60000 / bpm;
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
  const playFrom = useCallback(
    (index) => {
      setStep(index * beatsPerMeasure);
      setStarted(true);
      setPlaying(true);
    },
    [beatsPerMeasure],
  );

  const index = started && length ? Math.floor(step / beatsPerMeasure) % length : null;
  return useMemo(
    () => ({ playing, started, index, beat: step % beatsPerMeasure, toggle, stop, playFrom }),
    [playing, started, index, step, beatsPerMeasure, toggle, stop, playFrom],
  );
}
