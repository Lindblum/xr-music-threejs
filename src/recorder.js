// Recording from the microphone, for the Analyze section (see analyze.js).
// The mic runs through the app's own audio context into a small worklet that
// hands its samples back, mixed to mono; nothing of it goes to the speakers.
// The browser's voice processing (echo cancelling, noise suppression,
// automatic gain) is asked off: it would mangle music. A recording stops
// itself after MAX_SECONDS.

import { audioContext } from './audio.js';

export const MAX_SECONDS = 60;

// the worklet: each block of input, mixed to mono, posted back to the page
const TAP = `class RecorderTap extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length) {
      const mono = new Float32Array(channels[0].length);
      for (const ch of channels) for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / channels.length;
      this.port.postMessage(mono, [mono.buffer]);
    }
    return true;
  }
}
registerProcessor('recorder-tap', RecorderTap);`;

let tapLoaded = null; // the worklet module, added once per context
let recording = null; // { stream, nodes, chunks, length, rate } while recording

/** Why the microphone couldn't be had, in words. */
function micError(e) {
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return 'Microphone access was refused';
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'No microphone found';
  return `Couldn't use the microphone: ${e?.message ?? e}`;
}

/**
 * Starts recording from the microphone; `onLimit()` is called if it reaches
 * MAX_SECONDS (it keeps nothing past that). Rejects with an Error saying why
 * if there's no microphone to be had.
 */
export async function startRecording({ onLimit } = {}) {
  if (recording) return;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('No microphone access here: the page needs HTTPS');
  const ctx = audioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    throw new Error(micError(e));
  }
  tapLoaded ??= ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([TAP], { type: 'application/javascript' })));
  await tapLoaded;
  const source = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, 'recorder-tap');
  // a worklet only runs while something downstream pulls on it: a silent gain to the output does
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(tap).connect(silent).connect(ctx.destination);
  const state = { stream, nodes: [source, tap, silent], chunks: [], length: 0, rate: ctx.sampleRate };
  const limit = MAX_SECONDS * ctx.sampleRate;
  tap.port.onmessage = (e) => {
    if (state.length >= limit) return;
    state.chunks.push(e.data);
    state.length += e.data.length;
    if (state.length >= limit) onLimit?.();
  };
  recording = state;
}

/** Stops recording: { samples (mono Float32Array), sampleRate }, or null if it wasn't. */
export function stopRecording() {
  if (!recording) return null;
  const { stream, nodes, chunks, length, rate } = recording;
  recording = null;
  for (const track of stream.getTracks()) track.stop();
  nodes[1].port.onmessage = null;
  for (const node of nodes) node.disconnect();
  const samples = new Float32Array(length);
  let at = 0;
  for (const chunk of chunks) {
    samples.set(chunk.subarray(0, length - at), at);
    at += chunk.length;
    if (at >= length) break;
  }
  return { samples, sampleRate: rate };
}
