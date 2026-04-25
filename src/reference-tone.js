import * as Tone from "tone";
import { midiToFreq, midiToName } from "./note-utils.js";

// Populate a <select> with notes from C3 to C6 (MIDI 48..84).
export function populateNoteSelect(selectEl) {
  for (let m = 48; m <= 84; m++) {
    const opt = document.createElement("option");
    opt.value = String(m);
    opt.textContent = midiToName(m);
    if (m === 69) opt.selected = true; // A4 default
    selectEl.appendChild(opt);
  }
}

let synth = null;
function getSynth() {
  if (!synth) {
    synth = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.05, decay: 0.1, sustain: 0.8, release: 0.3 },
    }).toDestination();
    synth.volume.value = -10;
  }
  return synth;
}

export async function playReference(midi) {
  await Tone.start();
  const freq = midiToFreq(midi);
  getSynth().triggerAttack(freq);
}

export function stopReference() {
  getSynth().triggerRelease();
}

export function randomMidi(min = 55, max = 79) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
