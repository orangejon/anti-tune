import "./style.css";
import * as Tone from "tone";
import { PitchDetector } from "pitchy";
import {
  freqToMidiFloat,
  midiToFreq,
  midiToName,
  nearestScaleMidi,
  centsDeviation,
} from "./note-utils.js";
import { populateNoteSelect, playReference, stopReference, randomMidi } from "./reference-tone.js";
import { startExercise, stopExercise, isRunning as exIsRunning, checkPitch as exCheckPitch, pitchLost as exPitchLost, currentTargetMidi, advanceNote, setTolerance, setHoldMs } from "./scale-exercise.js";

const ui = {
  start: document.getElementById("start-btn"),
  stop: document.getElementById("stop-btn"),
  amount: document.getElementById("amount"),
  amountVal: document.getElementById("amount-val"),
  volume: document.getElementById("volume"),
  volumeVal: document.getElementById("volume-val"),
  scale: document.getElementById("scale"),
  bypass: document.getElementById("bypass"),
  noteDisplay: document.getElementById("note-display"),
  centsDisplay: document.getElementById("cents-display"),
  needle: document.getElementById("meter-needle"),
  outputMode: document.getElementById("output-mode"),
  refNote: document.getElementById("ref-note"),
  refPlay: document.getElementById("ref-play"),
  refStop: document.getElementById("ref-stop"),
  refRandomize: document.getElementById("ref-randomize"),
  status: document.getElementById("status"),
  exTolerance: document.getElementById("ex-tolerance"),
  exToleranceVal: document.getElementById("ex-tolerance-val"),
  exHoldSlider: document.getElementById("ex-hold"),
  exHoldSliderVal: document.getElementById("ex-hold-val"),
  exKey: document.getElementById("ex-key"),
  exType: document.getElementById("ex-type"),
  exOctave: document.getElementById("ex-octave"),
  exStart: document.getElementById("ex-start"),
  exNext: document.getElementById("ex-next"),
  exStop: document.getElementById("ex-stop"),
  exDisplay: document.getElementById("ex-display"),
  exNote: document.getElementById("ex-note"),
  exProgress: document.getElementById("ex-progress"),
  exNeedle: document.getElementById("ex-needle"),
  exCents: document.getElementById("ex-cents"),
  exHoldFill: document.getElementById("ex-hold-fill"),
};

// Persist all control values across page loads.
const SETTINGS_KEY = "antitune_settings";
const PERSISTED = [
  { el: () => ui.amount,      attr: "value" },
  { el: () => ui.volume,      attr: "value" },
  { el: () => ui.scale,       attr: "value" },
  { el: () => ui.outputMode,  attr: "value" },
  { el: () => ui.bypass,      attr: "checked" },
  { el: () => ui.refNote,     attr: "value" },
  { el: () => ui.exKey,       attr: "value" },
  { el: () => ui.exType,      attr: "value" },
  { el: () => ui.exOctave,    attr: "value" },
  { el: () => ui.exTolerance, attr: "value" },
  { el: () => ui.exHoldSlider,attr: "value" },
];

function saveSettings() {
  const data = {};
  for (const { el, attr } of PERSISTED) data[el().id + "_" + attr] = el()[attr];
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
}

function loadSettings() {
  let data;
  try { data = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch { return; }
  if (!data) return;
  for (const { el, attr } of PERSISTED) {
    const v = data[el().id + "_" + attr];
    if (v !== undefined) el()[attr] = v;
  }
  // Sync displayed labels after loading.
  ui.amountVal.textContent = parseFloat(ui.amount.value).toFixed(4);
  ui.volumeVal.textContent = ui.volume.value;
  ui.exToleranceVal.textContent = ui.exTolerance.value;
  ui.exHoldSliderVal.textContent = ui.exHoldSlider.value;
  // Sync module state.
  setTolerance(parseInt(ui.exTolerance.value, 10));
  setHoldMs(parseInt(ui.exHoldSlider.value, 10));
}

populateNoteSelect(ui.refNote);
loadSettings();

let running = false;
let mic = null;
let pitchShift = null;
let wetGain = null;
let dryGain = null;
let trackingOsc = null;
let trackingOscGain = null;
let oscActive = false;
let analyser = null;
let detector = null;
let analysisBuf = null;
let rafId = null;
let smoothMidi = null; // EMA-smoothed MIDI for stable pitch shifting

ui.amount.addEventListener("input", () => {
  ui.amountVal.textContent = parseFloat(ui.amount.value).toFixed(4);
  saveSettings();
});

ui.volume.addEventListener("input", () => {
  ui.volumeVal.textContent = ui.volume.value;
  if (wetGain) wetGain.gain.rampTo(parseFloat(ui.volume.value) / 100, 0.02);
  saveSettings();
});


ui.start.addEventListener("click", start);
ui.stop.addEventListener("click", stop);

ui.refPlay.addEventListener("click", () => {
  const midi = parseInt(ui.refNote.value, 10);
  playReference(midi);
  ui.refPlay.disabled = true;
  ui.refStop.disabled = false;
});
ui.refStop.addEventListener("click", () => {
  stopReference();
  ui.refPlay.disabled = false;
  ui.refStop.disabled = true;
});
ui.refRandomize.addEventListener("click", () => {
  ui.refNote.value = String(randomMidi());
  saveSettings();
});
ui.refNote.addEventListener("change", saveSettings);
ui.scale.addEventListener("change", saveSettings);
ui.outputMode.addEventListener("change", () => { updateOutputMode(); saveSettings(); });
ui.bypass.addEventListener("change", () => { updateBypass(); saveSettings(); });

ui.exTolerance.addEventListener("input", () => {
  ui.exToleranceVal.textContent = ui.exTolerance.value;
  setTolerance(parseInt(ui.exTolerance.value, 10));
  saveSettings();
});

ui.exHoldSlider.addEventListener("input", () => {
  ui.exHoldSliderVal.textContent = ui.exHoldSlider.value;
  setHoldMs(parseInt(ui.exHoldSlider.value, 10));
  saveSettings();
});

ui.exKey.addEventListener("change", saveSettings);
ui.exType.addEventListener("change", saveSettings);
ui.exOctave.addEventListener("change", saveSettings);

ui.exStart.addEventListener("click", () => {
  const pc = parseInt(ui.exKey.value, 10);
  const octave = parseInt(ui.exOctave.value, 10);
  const rootMidi = 12 * (octave + 1) + pc;
  const type = ui.exType.value;
  startExercise(rootMidi, type, {
    onNote(idx, notes) {
      ui.exNote.textContent = midiToName(notes[idx]);
      ui.exProgress.textContent = `Note ${idx + 1} of ${notes.length}`;
      ui.exHoldFill.style.width = "0%";
      ui.exNeedle.style.left = "50%";
      ui.exCents.textContent = "0¢";
    },
    onComplete() {
      ui.exNote.textContent = "Done!";
      ui.exProgress.textContent = "";
      ui.exHoldFill.style.width = "0%";
      ui.exStart.disabled = false;
      ui.exNext.disabled = true;
      ui.exStop.disabled = true;
    },
  });
  ui.exDisplay.hidden = false;
  ui.exStart.disabled = true;
  ui.exNext.disabled = false;
  ui.exStop.disabled = false;
});

ui.exNext.addEventListener("click", () => {
  advanceNote();
});

ui.exStop.addEventListener("click", () => {
  stopExercise();
  ui.exDisplay.hidden = true;
  ui.exStart.disabled = false;
  ui.exNext.disabled = true;
  ui.exStop.disabled = true;
});

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

  const vol = parseFloat(ui.volume.value) / 100;
  pitchShift = new Tone.PitchShift({ pitch: 0, windowSize: 0.1, delayTime: 0, feedback: 0, wet: 1 });
  wetGain = new Tone.Gain(vol);
  dryGain = new Tone.Gain(0);
  trackingOsc = new Tone.Oscillator({ type: "sawtooth", frequency: 440 });
  trackingOscGain = new Tone.Gain(0);
  trackingOsc.connect(trackingOscGain);
  trackingOscGain.toDestination();
  trackingOsc.start();
  oscActive = false;

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

  updateOutputMode();
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
  smoothMidi = null;
  oscActive = false;
  if (trackingOsc) { trackingOsc.stop(); trackingOsc.dispose(); trackingOsc = null; }
  if (trackingOscGain) { trackingOscGain.dispose(); trackingOscGain = null; }
  ui.start.disabled = false;
  ui.stop.disabled = true;
  ui.status.textContent = "Stopped.";
  ui.noteDisplay.textContent = "—";
  ui.centsDisplay.textContent = "0¢";
  ui.needle.style.left = "50%";
}

function updateOutputMode() {
  if (!wetGain || !dryGain) return;
  const vol = parseFloat(ui.volume.value) / 100;
  const mode = ui.outputMode.value;
  if (ui.bypass.checked) {
    wetGain.gain.rampTo(0, 0.02);
    dryGain.gain.rampTo(vol, 0.02);
    if (trackingOscGain) { trackingOscGain.gain.rampTo(0, 0.02); oscActive = false; }
  } else {
    dryGain.gain.rampTo(0, 0.02);
    wetGain.gain.rampTo(mode.startsWith("osc") ? 0 : vol, 0.02);
    // oscillator gain is managed per-frame by the loop based on pitch detection
  }
}

function updateBypass() { updateOutputMode(); }

function loop() {
  rafId = requestAnimationFrame(loop);
  if (!running || !analyser) return;

  analyser.getFloatTimeDomainData(analysisBuf);
  const sr = Tone.getContext().rawContext.sampleRate;
  const [freq, clarity] = detector.findPitch(analysisBuf, sr);

  if (!freq || clarity < 0.9 || freq < 60 || freq > 1200) {
    if (exIsRunning()) { exPitchLost(); ui.exHoldFill.style.width = "0%"; }
    if (oscActive && trackingOscGain) { trackingOscGain.gain.rampTo(0, 0.08); oscActive = false; }
    return;
  }

  const midiF = freqToMidiFloat(freq);

  // EMA smoothing reduces frame-to-frame pitch detection noise that causes choppy shifts.
  smoothMidi = smoothMidi === null ? midiF : 0.25 * midiF + 0.75 * smoothMidi;

  const scale = ui.scale.value;
  const targetMidi = exIsRunning() ? currentTargetMidi() : nearestScaleMidi(smoothMidi, scale);
  const cents = centsDeviation(smoothMidi, targetMidi); // roughly ±50
  const multiplier = parseFloat(ui.amount.value); // 1–10

  // Exaggeration: multiply the deviation so small errors sound bigger.
  // multiplier=1 → output = your actual deviation. multiplier=3 → a 5¢ error sounds like 15¢.
  const extraCents = cents * (multiplier - 1);

  if (pitchShift) {
    pitchShift.pitch = extraCents / 100; // Tone.PitchShift.pitch is in semitones
  }

  if (trackingOsc && trackingOscGain) {
    const detunedFreq = midiToFreq(smoothMidi + extraCents / 100);
    trackingOsc.frequency.rampTo(detunedFreq, 0.05);
    const mode = ui.outputMode.value;
    const useOsc = mode.startsWith("osc") || mode.startsWith("both");
    const waveform = mode.split("-")[1] || "triangle";
    if (trackingOsc.type !== waveform) trackingOsc.type = waveform;
    const vol = parseFloat(ui.volume.value) / 100;
    if (useOsc && !ui.bypass.checked) {
      if (!oscActive) { trackingOscGain.gain.rampTo(vol, 0.05); oscActive = true; }
    } else {
      if (oscActive) { trackingOscGain.gain.rampTo(0, 0.02); oscActive = false; }
    }
  }

  ui.noteDisplay.textContent = midiToName(targetMidi);
  ui.centsDisplay.textContent = `${cents >= 0 ? "+" : ""}${cents.toFixed(0)}¢`;
  const pct = 50 + Math.max(-50, Math.min(50, cents));
  ui.needle.style.left = pct + "%";

  if (exIsRunning()) {
    const result = exCheckPitch(smoothMidi);
    if (result) {
      const { centsDiff, holdFraction } = result;
      const exPct = 50 + Math.max(-50, Math.min(50, centsDiff));
      ui.exNeedle.style.left = exPct + "%";
      ui.exCents.textContent = `${centsDiff >= 0 ? "+" : ""}${centsDiff.toFixed(0)}¢`;
      ui.exHoldFill.style.width = (holdFraction * 100) + "%";
    }
  }
}
