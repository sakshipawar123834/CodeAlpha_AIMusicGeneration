/* ============================================================
   AI Music Studio — Application Logic
   ============================================================ */

(function () {
  'use strict';

  console.log('[STUDIO] script.js loading...');

  const state = {
    notes: [],
    synth: null,
    reverb: null,
    isPlaying: false,
    playbackTimer: null,
    audioInitialized: false,
  };

  const DEFAULTS = { temperature: 0.8, length: 24, seed: 42 };

  const dom = {
    canvas: document.getElementById('pianoRollCanvas'),
    ctx: null,
    generateBtn: document.getElementById('generateBtn'),
    saveMidiBtn: document.getElementById('saveMidiBtn'),
    saveMidiTopBtn: document.getElementById('saveMidiTopBtn'),
    stopBtn: document.getElementById('stopBtn'),
    resetBtn: document.getElementById('resetBtn'),
    tempSlider: document.getElementById('temperature'),
    tempValue: document.getElementById('tempValue'),
    lengthSlider: document.getElementById('length'),
    lengthValue: document.getElementById('lengthValue'),
    seedSlider: document.getElementById('seed'),
    seedValue: document.getElementById('seedValue'),
    statusMsg: document.getElementById('statusMessage'),
    statusDot: document.getElementById('statusDot'),
    noteCount: document.getElementById('noteCount'),
    durationDisplay: document.getElementById('durationDisplay'),
    historyList: document.getElementById('historyList'),
    clearHistoryInline: document.getElementById('clearHistoryInline'),
  };

  function init() {
    console.log('[STUDIO] init() called');

    if (!dom.canvas) {
      console.warn('[STUDIO] Canvas not found');
      return;
    }

    try {
      var session = JSON.parse(localStorage.getItem('aims_session') || 'null');
      if (!session) {
        window.location.replace('index.html');
        return;
      }
    } catch (e) {
      window.location.replace('index.html');
      return;
    }

    if (!dom.generateBtn) {
      console.error('[STUDIO] Generate button not found!');
      return;
    }

    dom.ctx = dom.canvas.getContext('2d');
    setupEventListeners();
    updateSliderLabels();
    renderHistory();
    generateMusic();

    document.body.addEventListener('click', unlockAudio, { once: true });
    console.log('[STUDIO] init complete');
  }

  async function unlockAudio() {
    if (state.audioInitialized) return;
    try {
      await Tone.start();
      state.audioInitialized = true;
    } catch (err) {
      console.warn('Audio unlock failed:', err);
    }
  }

  function setupEventListeners() {
    console.log('[STUDIO] Attaching event listeners');

    dom.tempSlider.addEventListener('input', updateSliderLabels);
    dom.lengthSlider.addEventListener('input', updateSliderLabels);
    dom.seedSlider.addEventListener('input', updateSliderLabels);

    dom.generateBtn.addEventListener('click', function () {
      console.log('[STUDIO] Generate & Play clicked');
      generateMusic();
      playGenerated();
    });

    dom.saveMidiBtn.addEventListener('click', saveMidi);
    if (dom.saveMidiTopBtn) dom.saveMidiTopBtn.addEventListener('click', saveMidi);
    dom.stopBtn.addEventListener('click', function () { stopPlayback(true); });

    dom.resetBtn.addEventListener('click', function () {
      dom.tempSlider.value = DEFAULTS.temperature;
      dom.lengthSlider.value = DEFAULTS.length;
      dom.seedSlider.value = DEFAULTS.seed;
      updateSliderLabels();
      generateMusic();
      setStatus('Parameters reset to defaults', 'idle');
    });

    if (dom.clearHistoryInline) {
      dom.clearHistoryInline.addEventListener('click', function () {
        if (confirm('Clear all generation history?')) {
          if (window.Auth) Auth.clearHistory();
          renderHistory();
          if (window.refreshProfileStats) window.refreshProfileStats();
        }
      });
    }
  }

  function updateSliderLabels() {
    dom.tempValue.textContent = parseFloat(dom.tempSlider.value).toFixed(2);
    dom.lengthValue.textContent = dom.lengthSlider.value;
    dom.seedValue.textContent = dom.seedSlider.value;
  }

  async function ensureSynth() {
    if (state.synth) return state.synth;
    await unlockAudio();

    state.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.015, decay: 0.35, sustain: 0.35, release: 1.4 },
      volume: -8,
    }).toDestination();

    state.reverb = new Tone.Reverb({ decay: 3.2, wet: 0.22, preDelay: 0.02 }).toDestination();
    state.synth.connect(state.reverb);
    return state.synth;
  }

  function generateMusic() {
    const temperature = parseFloat(dom.tempSlider.value);
    const length = parseInt(dom.lengthSlider.value, 10);
    const seed = parseInt(dom.seedSlider.value, 10);

    console.log('[STUDIO] generateMusic:', { temperature, length, seed });
    setStatus('Generating sequence…', 'active');

    try {
      if (typeof musicModel === 'undefined') {
        throw new Error('musicModel not loaded — check model.js');
      }

      const notes = musicModel.generateSequence(length, temperature, seed);
      console.log('[STUDIO] Generated', notes.length, 'notes');
      state.notes = notes;

      drawPianoRoll(notes);
      updateStats(notes);
      setStatus('Generated ' + notes.length + ' notes · seed ' + seed, 'idle');

      if (window.Auth) {
        Auth.addHistoryEntry({
          temperature: temperature,
          length: length,
          seed: seed,
          noteCount: notes.length,
          timestamp: Date.now(),
          notes: notes.map(function (n) {
            return { midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity };
          }),
          exported: false,
        });
        renderHistory();
        if (window.refreshProfileStats) window.refreshProfileStats();
      }
    } catch (err) {
      console.error('[STUDIO] Generation error:', err);
      setStatus('Generation failed: ' + err.message, 'idle');
    }
  }

  async function playGenerated() {
    if (!state.notes.length) {
      setStatus('Nothing to play — generate first', 'idle');
      return;
    }

    try {
      const synth = await ensureSynth();
      stopPlayback(false);

      Tone.Transport.cancel();
      if (Tone.Transport.state === 'started') Tone.Transport.stop();

      const now = Tone.now() + 0.15;
      let totalDur = 0;
      for (let i = 0; i < state.notes.length; i++) {
        const end = state.notes[i].time + state.notes[i].duration;
        if (end > totalDur) totalDur = end;
      }
      if (totalDur < 0.1) totalDur = 0.1;

      state.notes.forEach(function (note) {
        const freq = Tone.Frequency(note.midi, 'midi').toFrequency();
        const startTime = now + note.time;
        const duration = Math.max(0.05, note.duration * 0.92);
        const velocity = Math.min(1, Math.max(0.1, note.velocity / 127 * 0.85 + 0.15));
        synth.triggerAttackRelease(freq, duration, startTime, velocity);
      });

      state.isPlaying = true;
      setStatus('Playing · ' + state.notes.length + ' notes · ' + totalDur.toFixed(1) + 's', 'playing');

      clearTimeout(state.playbackTimer);
      state.playbackTimer = setTimeout(function () {
        if (state.isPlaying) {
          state.isPlaying = false;
          setStatus('Playback finished', 'idle');
        }
      }, (totalDur + 0.6) * 1000);
    } catch (err) {
      console.error('[STUDIO] Playback error:', err);
      setStatus('Playback failed: ' + err.message, 'idle');
    }
  }

  function stopPlayback(updateStatus) {
    if (updateStatus === undefined) updateStatus = true;
    if (state.synth) { try { state.synth.releaseAll(); } catch (e) {} }
    if (typeof Tone !== 'undefined' && Tone.Transport) {
      Tone.Transport.stop();
      Tone.Transport.cancel();
    }
    clearTimeout(state.playbackTimer);
    state.isPlaying = false;
    if (updateStatus) setStatus('Stopped', 'idle');
  }

  function drawPianoRoll(notes) {
    const ctx = dom.ctx;
    const w = dom.canvas.width;
    const h = dom.canvas.height;

    const MIN_MIDI = 48;
    const MAX_MIDI = 84;
    const RANGE = MAX_MIDI - MIN_MIDI;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0f18';
    ctx.fillRect(0, 0, w, h);

    for (let midi = MIN_MIDI; midi <= MAX_MIDI; midi++) {
      const y = h - ((midi - MIN_MIDI) / RANGE) * h;
      const isBlack = [1, 3, 6, 8, 10].indexOf(midi % 12) !== -1;
      ctx.fillStyle = isBlack ? '#111a28' : '#0f1620';
      ctx.fillRect(0, y - 1, w, 2);
    }

    if (!notes || notes.length === 0) {
      ctx.font = '500 13px "Inter", sans-serif';
      ctx.fillStyle = '#3a4a60';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No notes generated yet', w / 2, h / 2);
      return;
    }

    let maxTime = 2;
    for (let i = 0; i < notes.length; i++) {
      const end = notes[i].time + notes[i].duration;
      if (end > maxTime) maxTime = end;
    }
    const timeScale = w / (maxTime + 0.4);

    ctx.strokeStyle = 'rgba(110, 150, 240, 0.06)';
    ctx.lineWidth = 1;
    for (let t = 0; t <= maxTime; t += 1.0) {
      const x = t * timeScale;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    notes.forEach(function (note) {
      const x = note.time * timeScale;
      const noteW = Math.max(3, note.duration * timeScale - 1.5);
      const midi = note.midi;
      const y = h - ((midi - MIN_MIDI) / RANGE) * h;
      const noteH = Math.max(4, (h / RANGE) * 0.85);

      const hue = 215 + (midi % 12) * 4;
      const light = 45 + (note.velocity / 127) * 25;
      const sat = 70 + (note.velocity / 127) * 15;

      ctx.fillStyle = 'hsl(' + hue + ', ' + sat + '%, ' + light + '%)';
      ctx.shadowColor = 'hsla(' + hue + ', 90%, 70%, 0.7)';
      ctx.shadowBlur = 10;

      ctx.beginPath();
      ctx.roundRect(x, y - noteH / 2, noteW, noteH, 3);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = 'hsla(' + hue + ', 90%, 85%, 0.25)';
      ctx.beginPath();
      ctx.roundRect(x, y - noteH / 2, noteW, noteH * 0.35, 3);
      ctx.fill();
    });

    ctx.shadowBlur = 0;

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#4a5d7a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (let t = 0; t <= maxTime; t += 1.0) {
      const x = t * timeScale;
      ctx.fillText(t.toFixed(1) + 's', x + 3, h - 5);
    }
  }

  function updateStats(notes) {
    const count = notes.length;
    let totalDur = 0;
    for (let i = 0; i < notes.length; i++) {
      const end = notes[i].time + notes[i].duration;
      if (end > totalDur) totalDur = end;
    }
    dom.noteCount.textContent = count;
    dom.durationDisplay.textContent = totalDur.toFixed(1);
  }

  function setStatus(message, mode) {
    if (mode === undefined) mode = 'idle';
    dom.statusMsg.textContent = message;
    dom.statusDot.classList.remove('active', 'playing');
    if (mode === 'active') dom.statusDot.classList.add('active');
    else if (mode === 'playing') dom.statusDot.classList.add('playing');
  }

  function renderHistory() {
    if (!dom.historyList || !window.Auth) return;

    const history = Auth.getHistoryForUser();

    if (!history.length) {
      dom.historyList.innerHTML = '<p class="history-empty">No generations yet — click "Generate & Play" to create your first composition.</p>';
      return;
    }

    let html = '';
    const slice = history.slice(0, 10);
    for (let i = 0; i < slice.length; i++) {
      const item = slice[i];
      const date = new Date(item.timestamp);
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      html += '<div class="history-item" data-id="' + item.id + '">';
      html += '<div class="history-info">';
      html += '<div class="history-title">Seed ' + item.seed + ' · Temp ' + item.temperature.toFixed(2) + '</div>';
      html += '<div class="history-meta">' + item.noteCount + ' notes · ' + item.length + ' length · ' + timeStr + '</div>';
      html += '</div>';
      html += '<div class="history-actions">';
      html += '<button class="history-btn" data-action="load" data-id="' + item.id + '">Load</button>';
      html += '<button class="history-btn" data-action="delete" data-id="' + item.id + '">✕</button>';
      html += '</div></div>';
    }
    dom.historyList.innerHTML = html;

    const btns = dom.historyList.querySelectorAll('.history-btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        if (action === 'load') loadHistoryItem(id);
        else if (action === 'delete') deleteHistoryItem(id);
      });
    });
  }

  function loadHistoryItem(id) {
    if (!window.Auth) return;
    const all = Auth.getHistoryForUser();
    let item = null;
    for (let i = 0; i < all.length; i++) {
      if (all[i].id === id) { item = all[i]; break; }
    }
    if (!item || !item.notes) { alert('This history entry has no saved notes.'); return; }

    dom.tempSlider.value = item.temperature;
    dom.lengthSlider.value = item.length;
    dom.seedSlider.value = item.seed;
    updateSliderLabels();

    state.notes = item.notes;
    drawPianoRoll(item.notes);
    updateStats(item.notes);
    setStatus('Loaded generation from history · seed ' + item.seed, 'idle');
    playGenerated();
  }

  function deleteHistoryItem(id) {
    try {
      const all = JSON.parse(localStorage.getItem('aims_history') || '[]');
      const filtered = all.filter(function (h) { return h.id !== id; });
      localStorage.setItem('aims_history', JSON.stringify(filtered));
      renderHistory();
      if (window.refreshProfileStats) window.refreshProfileStats();
    } catch (e) { console.error(e); }
  }

  window.renderHistory = renderHistory;

  function saveMidi() {
    if (!state.notes.length) { setStatus('No notes to save', 'idle'); return; }

    try {
      const midi = new Midi();
      const track = midi.addTrack();
      track.name = 'AI Generated Piano';
      track.instrument.number = 0;

      state.notes.forEach(function (note) {
        track.addNote({
          midi: note.midi,
          time: note.time,
          duration: note.duration,
          velocity: note.velocity / 127,
        });
      });

      const midiBytes = midi.toArray();
      const blob = new Blob([midiBytes], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = 'ai-music-' + Date.now() + '.mid';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus('MIDI file saved to downloads', 'idle');
    } catch (err) {
      console.error('MIDI export error:', err);
      setStatus('Error saving MIDI file: ' + err.message, 'idle');
    }
  }

  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      if (w < 2 * r) r = w / 2;
      if (h < 2 * r) r = h / 2;
      this.moveTo(x + r, y);
      this.lineTo(x + w - r, y);
      this.quadraticCurveTo(x + w, y, x + w, y + r);
      this.lineTo(x + w, y + h - r);
      this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      this.lineTo(x + r, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - r);
      this.lineTo(x, y + r);
      this.quadraticCurveTo(x, y, x + r, y);
      return this;
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();