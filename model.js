/* ============================================================
   AI Music Studio — LSTM Music Model (Simulated)
   ============================================================ */

class MusicLSTM {
  constructor() {
    this.pitchSet = [
      48, 50, 52, 53, 55, 57, 58, 60, 62,
      64, 65, 67, 69, 70, 72, 74, 76, 77,
      79, 81,
    ];

    this.chordIntervals = [0, 2, 4, 7, 9];
    this.hiddenSize = 16;
    this.hidden = new Array(this.hiddenSize).fill(0.1);
    this.pitchTransition = this._buildTransitionMatrix();
    this.velocityMean = 78;
    this.velocityStd = 14;
    this.rhythmOptions = [0.25, 0.5, 0.75, 1.0, 1.5];
  }

  _buildTransitionMatrix() {
    const size = this.pitchSet.length;
    const matrix = Array.from({ length: size }, () => new Array(size).fill(0));

    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const interval = Math.abs(this.pitchSet[j] - this.pitchSet[i]);
        const intervalClass = interval % 12;

        let weight = Math.exp(-interval / 4.5) + 0.12;
        if ([0, 3, 4, 5, 7, 9].includes(intervalClass)) weight *= 1.6;
        if (interval > 12) weight *= 0.15;
        if (this.pitchSet[j] > this.pitchSet[i]) weight *= 1.08;
        matrix[i][j] = weight;
      }
    }

    for (let i = 0; i < size; i++) {
      const rowSum = matrix[i].reduce((a, b) => a + b, 0);
      if (rowSum > 0) matrix[i] = matrix[i].map(v => v / rowSum);
    }

    return matrix;
  }

  _createRNG(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  _sample(probs, rng) {
    const r = rng();
    let cumulative = 0;
    for (let i = 0; i < probs.length; i++) {
      cumulative += probs[i];
      if (r <= cumulative) return i;
    }
    return probs.length - 1;
  }

  _applyTemperature(probs, temperature) {
    const adjusted = probs.map(p => Math.pow(p, 1 / temperature));
    const sum = adjusted.reduce((a, b) => a + b, 0);
    return adjusted.map(p => p / sum);
  }

  generateSequence(length = 24, temperature = 0.8, seed = 42) {
    const rng = this._createRNG(seed);
    const notes = [];
    this.hidden = new Array(this.hiddenSize).fill(0.1);

    let currentIdx = Math.floor(this.pitchSet.length / 2);
    let cumulativeTime = 0;

    for (let step = 0; step < length; step++) {
      const row = this.pitchTransition[currentIdx];
      const tempered = this._applyTemperature(row, temperature);
      const nextIdx = this._sample(tempered, rng);
      const midi = this.pitchSet[nextIdx];

      this.hidden.shift();
      this.hidden.push(midi / 127);
      const hiddenSum = this.hidden.reduce((a, b) => a + b, 0);
      const hiddenInfluence = hiddenSum / this.hiddenSize;

      const rhythmIdx = Math.floor(rng() * this.rhythmOptions.length);
      let duration = this.rhythmOptions[rhythmIdx];
      duration *= 0.85 + hiddenInfluence * 0.3;
      duration = Math.max(0.15, Math.min(2.0, duration));

      let velocity = this.velocityMean
        + (midi - 64) * 0.7
        + (rng() - 0.5) * this.velocityStd * 2;
      velocity = Math.round(Math.max(35, Math.min(120, velocity)));

      notes.push({
        midi,
        duration: parseFloat(duration.toFixed(3)),
        velocity,
        time: parseFloat(cumulativeTime.toFixed(3)),
      });

      if (rng() < 0.18 && step < length - 1) {
        const chordInterval = this.chordIntervals[
          Math.floor(rng() * this.chordIntervals.length)
        ];
        let harmonyMidi = midi + chordInterval;
        while (harmonyMidi > 84) harmonyMidi -= 12;
        while (harmonyMidi < 48) harmonyMidi += 12;

        notes.push({
          midi: harmonyMidi,
          duration: parseFloat((duration * 0.65).toFixed(3)),
          velocity: Math.round(velocity * 0.65),
          time: parseFloat((cumulativeTime + 0.05).toFixed(3)),
        });
      }

      cumulativeTime += duration * 0.8;
      currentIdx = nextIdx;
    }

    notes.sort((a, b) => a.time - b.time);
    return notes;
  }
}

const musicModel = new MusicLSTM();