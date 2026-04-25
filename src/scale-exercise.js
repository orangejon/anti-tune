import { stopReference, playReference } from "./reference-tone.js";

const INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11, 12],
  minor: [0, 2, 3, 5, 7, 8, 10, 12],
};

let holdMs = 400;

let notes = [];
let index = 0;
let holdStart = null;
let cbs = {};
let toleranceCents = 8;

export function buildScale(rootMidi, type) {
  return (INTERVALS[type] || INTERVALS.major).map(i => rootMidi + i);
}

export function setTolerance(cents) {
  toleranceCents = cents;
}

export function setHoldMs(ms) {
  holdMs = ms;
}

export function startExercise(rootMidi, type, callbacks) {
  notes = buildScale(rootMidi, type);
  index = 0;
  holdStart = null;
  cbs = callbacks;
  playReference(notes[0]);
  cbs.onNote(index, notes);
}

export function stopExercise() {
  notes = [];
  index = 0;
  holdStart = null;
  cbs = {};
  stopReference();
}

export function isRunning() {
  return notes.length > 0;
}

export function currentTargetMidi() {
  return notes.length > 0 ? notes[index] : null;
}

export function advanceNote() {
  if (!isRunning()) return;
  holdStart = null;
  index++;
  if (index >= notes.length) {
    cbs.onComplete?.();
    stopExercise();
  } else {
    playReference(notes[index]);
    cbs.onNote(index, notes);
  }
}

// Returns { centsDiff, holdFraction } for the current target, or null if not running.
export function pitchLost() {
  if (holdStart !== null) {
    holdStart = null;
  }
}

export function checkPitch(midiFloat) {
  if (!isRunning()) return null;

  const target = notes[index];
  const centsDiff = (midiFloat - target) * 100;

  if (Math.abs(centsDiff) <= toleranceCents) {
    if (!holdStart) holdStart = Date.now();
    const held = Date.now() - holdStart;
    if (held >= holdMs) {
      holdStart = null;
      index++;
      if (index >= notes.length) {
        cbs.onComplete?.();
        stopExercise();
      } else {
        playReference(notes[index]);
        cbs.onNote(index, notes);
      }
    }
    return { centsDiff, holdFraction: Math.min(1, held / holdMs) };
  } else {
    holdStart = null;
    return { centsDiff, holdFraction: 0 };
  }
}
