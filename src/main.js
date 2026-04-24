import "./style.css";
import * as Tone from "tone";
import { PitchDetector } from "pitchy";
import {
  freqToMidiFloat,
  midiToName,
  nearestScaleMidi,
  centsDeviation,
} from "./note-utils.js";
import { populateNoteSelect, playReference, randomMidi } from "./reference-tone.js";

const ui = {
  start: document.getElementById("start-btn"),
  stop: document.getElementById("stop-btn"),
  amount: document.getElementById("amount"),
  amountVal: document.getElementById("amount-val"),
  scale: document.getElementById("scale"),
  bypass: document.getElementById("bypass"),
  noteDisplay: document.getElementById("note-display"),
  centsDisplay: document.getElementById("cents-display"),
  needle: document.getElementById("meter-needle"),
  refNote: document.getElementById("ref-note"),
  refPlay: document.getElementById("ref-play"),
  refRandomize: document.getElementById("ref-randomize"),
  status: document.getElementById("status"),
};

populateNoteSelect(ui.refNote);

let running = false;
let mic = null;
let pitchShift = null;
let wetGain = null;
let dryGain = null;
let analyser = null;
let detector = null;
let analysisBuf = null;
let rafId = null;

ui.amount.addEventListener("input", () => {
  ui.amountVal.textContent = ui.amount.value;
});

ui.start.addEventListener("click", start);
ui.stop.addEventListener("click", stop);

ui.refPlay.addEventListener("click", () => {
  const midi = parseInt(ui.refNote.value, 10);
  playReference(midi);
});
ui.refRandomize.addEventListener("click", () => {
  ui.refNote.value = String(randomMidi());
});
ui.bypass.addEventListener("change", updateBypass);

async function start() {
  if (running) return;

  await Tone.start();

  mic = new Tone.UserMedia();
  try {
    await mic.open();
  } catch (e) {
    ui.status.textContent = "Mic access denied: " + e.message;
    mic = null;
    return;
  }

  pitchShift = new Tone.PitchShift({ pitch: 0, windowSize: 0.05, delayTime: 0, feedback: 0 });
  wetGain = new Tone.Gain(1);
  dryGain = new Tone.Gain(0);

  mic.connect(pitchShift);
  pitchShift.connect(wetGain);
  wetGain.toDestination();

  mic.connect(dryGain);
  dryGain.toDestination();

  // Native AnalyserNode for pitch detection — tap off the mic.
  const ctx = Tone.getContext().rawContext;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  mic.connect(analyser);
  analysisBuf = new Float32Array(analyser.fftSize);
  detector = PitchDetector.forFloat32Array(analyser.fftSize);
  detector.minVolumeDecibels = -40;

  updateBypass();
  running = true;
  ui.start.disabled = true;
  ui.stop.disabled = false;
  ui.status.textContent = "Running. Put headphones on if you haven't.";
  loop();
}

function stop() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(rafId);
  rafId = null;
  if (mic) { mic.close(); mic.dispose(); mic = null; }
  if (pitchShift) { pitchShift.dispose(); pitchShift = null; }
  if (wetGain) { wetGain.dispose(); wetGain = null; }
  if (dryGain) { dryGain.dispose(); dryGain = null; }
  analyser = null;
  detector = null;
  ui.start.disabled = false;
  ui.stop.disabled = true;
  ui.status.textContent = "Stopped.";
  ui.noteDisplay.textContent = "—";
  ui.centsDisplay.textContent = "0¢";
  ui.needle.style.left = "50%";
}

function updateBypass() {
  if (!wetGain || !dryGain) return;
  if (ui.bypass.checked) {
    wetGain.gain.rampTo(0, 0.02);
    dryGain.gain.rampTo(1, 0.02);
  } else {
    wetGain.gain.rampTo(1, 0.02);
    dryGain.gain.rampTo(0, 0.02);
  }
}

function loop() {
  rafId = requestAnimationFrame(loop);
  if (!running || !analyser) return;

  analyser.getFloatTimeDomainData(analysisBuf);
  const sr = Tone.getContext().rawContext.sampleRate;
  const [freq, clarity] = detector.findPitch(analysisBuf, sr);

  if (!freq || clarity < 0.9 || freq < 60 || freq > 1200) return;

  const midiF = freqToMidiFloat(freq);
  const scale = ui.scale.value;
  const targetMidi = nearestScaleMidi(midiF, scale);
  const cents = centsDeviation(midiF, targetMidi); // roughly ±50
  const amount = parseFloat(ui.amount.value) / 100;

  // De-correction: push output FURTHER from the target by `amount` times the
  // deviation. Input +10¢ above target with amount=1 → output +20¢ above target
  // (extra +10¢ applied to the signal).
  const extraCents = cents * amount;

  if (pitchShift) {
    pitchShift.pitch = extraCents / 100; // Tone.PitchShift.pitch is in semitones
  }

  ui.noteDisplay.textContent = midiToName(targetMidi);
  ui.centsDisplay.textContent = `${cents >= 0 ? "+" : ""}${cents.toFixed(0)}¢`;
  const pct = 50 + Math.max(-50, Math.min(50, cents));
  ui.needle.style.left = pct + "%";
}
