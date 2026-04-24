const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function freqToMidiFloat(f) {
  return 69 + 12 * Math.log2(f / 440);
}

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function midiToName(m) {
  const octave = Math.floor(m / 12) - 1;
  return NAMES[m % 12] + octave;
}

// Pitch classes (0-11) for each scale, rooted appropriately.
const SCALE_PCS = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],          // C major
  minor: [9, 11, 0, 2, 4, 5, 7],          // A natural minor (same notes as C major, different root for display)
};

// Find the nearest in-scale MIDI note to the continuous MIDI value.
export function nearestScaleMidi(midiFloat, scale) {
  const pcs = SCALE_PCS[scale] || SCALE_PCS.chromatic;
  const roundMidi = Math.round(midiFloat);
  // Chromatic: just round.
  if (scale === "chromatic") return roundMidi;
  // Otherwise search within ±6 semitones for the closest allowed pitch class.
  let best = roundMidi;
  let bestDist = Infinity;
  for (let d = -6; d <= 6; d++) {
    const cand = roundMidi + d;
    const pc = ((cand % 12) + 12) % 12;
    if (!pcs.includes(pc)) continue;
    const dist = Math.abs(cand - midiFloat);
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
    }
  }
  return best;
}

// Deviation in cents from `targetMidi` given the detected continuous midi.
export function centsDeviation(midiFloat, targetMidi) {
  return 100 * (midiFloat - targetMidi);
}
