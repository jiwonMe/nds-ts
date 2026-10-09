/// <reference path="../../sdk/index.d.ts" />

// Touch Synth: a 16-step square-wave sequencer. Play the keys on the touch
// screen, record them into the loop, and watch the top screen draw the wave.
// nds.audio.tone() has one voice, so a held key replaces the loop's note.
//
// Written for Duktape on a 67 MHz ARM9: the game lives inside one function so
// its variables are fast closure locals instead of global-object lookups,
// strings and colors are rebuilt only when they change, and each bottom-screen
// pixel is painted once per frame.

var game: NDSGame = (function (): NDSGame {
  var NONE = -100; // a rest in the loop, or no key under the stylus
  var STEPS = 16;
  var KEY_TOP = 48;
  var KEY_W = 32;
  var BLACK_W = 20;
  var BLACK_H = 84;
  var WHITE_NOTES = [0, 2, 4, 5, 7, 9, 11, 12];
  var BLACK_NOTES = [1, 3, 6, 8, 10];
  var BLACK_X = [21, 53, 117, 149, 181]; // centered on the key gaps
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var HUES = [0xFF6B6B, 0xFF922B, 0xFFD43B, 0xA9E34B, 0x51CF66, 0x20C997,
    0x22B8CF, 0x339AF0, 0x5C7CFA, 0x845EF7, 0xCC5DE8, 0xF06595];
  var TEMPOS = [12, 10, 9, 8, 7, 6]; // frames per sixteenth note
  var TOP_BG = 0x0F1424;
  var BAR = 0x161C2E;
  var PANEL = 0x0A0F1C;
  var GRID = 0x1E2740;
  var TEXT = 0xE8F1FF;
  var MUTED = 0x7D8DB3;
  var ACCENT = 0x3BC9DB;
  var RED = 0xFF6B6B;
  var GLYPHS: { [character: string]: number } = {
    A: 23530, B: 15083, C: 25166, D: 15211, E: 29391, F: 4815, G: 27470, '#': 24445, '-': 448,
    '3': 14563, '4': 18925, '5': 14543, '6': 31694,
  };
  var top = nds.top;
  var bottom = nds.bottom;
  var input = nds.input;
  var touch = nds.touch;

  // Semitones above middle C. The loop is original: A minor, then F, then home.
  var LOOP = [9, 12, 16, 21, 19, 16, 12, 16, 5, 9, 12, 17, 16, 12, 11, 7];
  var pattern: number[] = [];
  var colors: number[] = [];
  var rollY: number[] = []; // top of each note in the piano roll, -1 for a rest
  var rowH = 4;
  var playing = true;
  var recording = false;
  var tempo = 3;
  var octave = 0;
  var step = 0;
  var stepFrames = 0;
  var cursor = 0;
  var held = NONE;
  var sounding = NONE;
  var lastNote = 9;
  var envelope = 0;
  var halfWave = 20;
  var noteRuns: number[] = [];
  var noteColor = MUTED;
  var hzText = '';
  var bpmText = '';
  var headerText = '';
  var tempoText = '';
  var octaveText = '';
  var lowerText = '';
  var upperText = '';

  function frequency(semitone: number): number {
    return 261.63 * Math.pow(2, semitone / 12);
  }

  function noteName(semitone: number): string {
    var octaveIndex = Math.floor(semitone / 12);
    return NAMES[semitone - octaveIndex * 12] + (4 + octaveIndex);
  }

  function hue(semitone: number): number {
    return HUES[((semitone % 12) + 12) % 12];
  }

  // Lays out a note name in the 3 x 5 font at 4x, one rect per run of pixels.
  function setNoteLabel(value: string): void {
    noteRuns = [];
    for (var i = 0; i < value.length; i++) {
      var bits = GLYPHS[value.charAt(i)] || 0;
      for (var row = 0; row < 5; row++) {
        var line = (bits >> (row * 3)) & 7;
        var col = 0;
        while (col < 3) {
          if (!(line & (1 << col))) {
            col++;
            continue;
          }
          var first = col;
          while (col < 3 && (line & (1 << col))) col++;
          noteRuns.push(8 + (i * 4 + first) * 4, 18 + row * 4, (col - first) * 4);
        }
      }
    }
  }

  // Colors and piano-roll rows only change with the pattern, not every frame.
  function patternChanged(): void {
    var low = 99;
    var highest = -99;
    for (var i = 0; i < STEPS; i++) {
      colors[i] = pattern[i] === NONE ? PANEL : hue(pattern[i]);
      if (pattern[i] === NONE) continue;
      if (pattern[i] < low) low = pattern[i];
      if (pattern[i] > highest) highest = pattern[i];
    }
    var rows = highest - low + 1 > 12 ? highest - low + 1 : 12;
    rowH = Math.max(3, Math.floor(94 / rows));
    for (var n = 0; n < STEPS; n++) rollY[n] = pattern[n] === NONE ? -1 : 162 - (pattern[n] - low + 1) * rowH;
  }

  function sound(semitone: number, frames: number): void {
    var hz = frequency(semitone);
    nds.audio.tone(hz, frames, 0.3);
    envelope = 1;
    lastNote = semitone;
    if (semitone === sounding) return;
    sounding = semitone;
    noteColor = hue(semitone);
    halfWave = Math.max(12, Math.min(60, Math.round(9000 / hz)));
    hzText = Math.round(hz) + ' HZ';
    setNoteLabel(noteName(semitone));
  }

  function silence(): void {
    // There is no stop call: a one-frame tone at volume 0 replaces the note.
    if (sounding !== NONE) nds.audio.tone(frequency(sounding), 1, 0);
  }

  function setTempo(index: number): void {
    tempo = Math.max(0, Math.min(TEMPOS.length - 1, index));
    bpmText = 'BPM ' + Math.round(900 / TEMPOS[tempo]);
    // 60 characters span the screen, which right-aligns the tempo.
    headerText = 'TOUCH SYNTH' + new Array(50 - bpmText.length).join(' ') + bpmText;
    tempoText = '-  ' + bpmText + '  +';
  }

  function setOctave(value: number): void {
    octave = Math.max(-1, Math.min(1, value));
    lowerText = noteName(octave * 12);
    upperText = noteName(12 + octave * 12);
    octaveText = '-  ' + lowerText + '  +';
  }

  function trigger(): void {
    if (held === NONE && pattern[step] !== NONE) sound(pattern[step], TEMPOS[tempo] - 2);
  }

  function togglePlay(): void {
    playing = !playing;
    step = 0;
    stepFrames = 0;
    if (playing) trigger();
    else if (held === NONE) silence();
  }

  function setStep(index: number, note: number): void {
    pattern[index] = note;
    patternChanged();
  }

  function keyAt(x: number, y: number): number {
    if (y < KEY_TOP + BLACK_H) {
      for (var b = 0; b < 5; b++) {
        if (x >= BLACK_X[b] && x < BLACK_X[b] + BLACK_W) return BLACK_NOTES[b];
      }
    }
    return WHITE_NOTES[x >> 5];
  }

  // The transport row and the step strip react to the first contact only.
  function tap(x: number, y: number): void {
    if (y < 26) {
      if (x < 46) togglePlay();
      else if (x < 84) recording = !recording;
      else if (x < 112) setTempo(tempo - 1);
      else if (x >= 128 && x < 166) setTempo(tempo + 1);
      else if (x >= 166 && x < 196) setOctave(octave - 1);
      else if (x >= 200) setOctave(octave + 1);
      nds.audio.tone(1568, 2, 0.15);
    } else if (y < KEY_TOP) {
      cursor = x >> 4;
      if (pattern[cursor] !== NONE) {
        setStep(cursor, NONE);
      } else {
        setStep(cursor, lastNote);
        if (held === NONE) sound(lastNote, 6);
      }
    }
  }

  return {
    init: function () {
      pattern = LOOP.slice(0);
      patternChanged();
      setTempo(3);
      setOctave(0);
      recording = false;
      cursor = 0;
      held = NONE;
      sounding = NONE;
      playing = true;
      step = 0;
      stepFrames = 0;
      trigger();
    },

    update: function () {
      if (input.hit('a') || input.hit('start')) togglePlay();
      if (input.hit('select')) recording = !recording;
      if (input.hit('l')) setTempo(tempo - 1);
      if (input.hit('r')) setTempo(tempo + 1);
      if (input.hit('y')) setOctave(octave - 1);
      if (input.hit('x')) setOctave(octave + 1);
      if (input.hit('left')) cursor = (cursor + STEPS - 1) % STEPS;
      if (input.hit('right')) cursor = (cursor + 1) % STEPS;
      if (input.hit('b')) setStep(cursor, NONE);
      var shift = (input.hit('up') ? 1 : 0) - (input.hit('down') ? 1 : 0);
      if (shift !== 0) {
        var base = pattern[cursor] === NONE ? lastNote : pattern[cursor];
        setStep(cursor, Math.max(-12, Math.min(35, base + shift)));
        if (held === NONE) sound(pattern[cursor], 6);
      }

      var key = NONE;
      if (touch.down && touch.y >= KEY_TOP) key = keyAt(touch.x, touch.y) + octave * 12;
      else if (touch.pressed) tap(touch.x, touch.y);
      if (key !== held) {
        if (key !== NONE) {
          sound(key, 600); // a held key sustains for up to ten seconds
          if (recording && touch.pressed) {
            if (playing) {
              setStep(step, key);
            } else {
              setStep(cursor, key);
              cursor = (cursor + 1) % STEPS;
            }
          }
        } else {
          silence();
        }
        held = key;
      }

      if (playing && ++stepFrames >= TEMPOS[tempo]) {
        stepFrames = 0;
        step = (step + 1) % STEPS;
        trigger();
      }
      envelope = held !== NONE ? 1 : envelope * 0.86;
    },

    draw: function () {
      var i = 0;
      top.clear(TOP_BG);
      top.text(headerText, 8, 6, TEXT);
      if (recording && (nds.frame & 16)) top.text('REC', 168, 6, RED);
      var labelColor = envelope > 0.05 ? noteColor : MUTED;
      for (i = 0; i < noteRuns.length; i += 3) top.rect(noteRuns[i], noteRuns[i + 1], noteRuns[i + 2], 4, labelColor);
      top.text(hzText, 8, 44, MUTED);

      // Square wave: one filled block per half period, scrolling with time.
      top.rect(64, 16, 184, 42, PANEL);
      var amp = (15 * envelope + 0.5) | 0;
      if (amp < 1) {
        top.rect(66, 37, 180, 1, GRID);
      } else {
        var x = 66 - (nds.frame * 2) % (halfWave * 2);
        var high = true;
        while (x < 246) {
          var left = x < 66 ? 66 : x;
          var right = x + halfWave > 246 ? 246 : x + halfWave;
          if (right > left) top.rect(left, high ? 37 - amp : 38, right - left, amp, noteColor);
          x += halfWave;
          high = !high;
        }
      }

      // Piano roll of the loop, scaled to the notes it uses.
      top.rect(8, 66, 240, 98, PANEL);
      top.rect(68, 66, 1, 98, GRID);
      top.rect(128, 66, 1, 98, GRID);
      top.rect(188, 66, 1, 98, GRID);
      if (playing) top.rect(8 + step * 15, 66, 15, 98, GRID);
      for (i = 0; i < STEPS; i++) {
        if (rollY[i] >= 0) top.rect(9 + i * 15, rollY[i], 13, rowH - 1, colors[i]);
      }
      if (playing && rollY[step] >= 0) top.rect(9 + step * 15, rollY[step], 13, rowH - 1, 0xFFFFFF);

      // Bottom screen: three bands that together cover every pixel once.
      bottom.rect(0, 0, 256, 26, BAR);
      bottom.rect(4, 4, 40, 18, playing ? ACCENT : 0x262E46);
      bottom.text(playing ? 'STOP' : 'PLAY', 16, 11, playing ? PANEL : TEXT);
      bottom.rect(50, 4, 32, 18, recording ? RED : 0x262E46);
      bottom.text('REC', 60, 11, recording ? PANEL : TEXT);
      bottom.text(tempoText, 92, 11, TEXT);
      bottom.text(octaveText, 182, 11, TEXT);

      bottom.rect(0, 26, 256, 22, PANEL);
      for (i = 0; i < STEPS; i++) {
        if (pattern[i] !== NONE) bottom.rect(i * 16 + 2, 30, 12, 12, colors[i]);
      }
      if (playing) bottom.rect(step * 16 + 2, 27, 12, 2, TEXT);
      bottom.rect(cursor * 16 + 4, 44, 8, 2, recording ? RED : MUTED);

      // One white band, then key gaps, lit keys and the black keys on top.
      var heldKey = held - octave * 12;
      var loopKey = envelope > 0.3 && held === NONE ? sounding - octave * 12 : NONE;
      bottom.rect(0, KEY_TOP, 256, 144, 0xF1F3F5);
      for (i = 0; i < 8; i++) {
        var white = WHITE_NOTES[i];
        if (white === heldKey || white === loopKey) bottom.rect(i * KEY_W, KEY_TOP, KEY_W - 1, 144, white === heldKey ? ACCENT : 0xFFE066);
      }
      for (i = 1; i < 8; i++) bottom.rect(i * KEY_W - 1, KEY_TOP, 1, 144, 0x868E96);
      for (i = 0; i < 5; i++) {
        var black = BLACK_NOTES[i];
        bottom.rect(BLACK_X[i], KEY_TOP, BLACK_W, BLACK_H, black === heldKey ? 0x1098AD : black === loopKey ? 0xF59F00 : 0x1B1F2A);
      }
      bottom.text(lowerText, 12, 180, 0x868E96);
      bottom.text(upperText, 236, 180, 0x868E96);
      // Hints go on the bottom bitmap: top-screen text costs a quad per pixel.
      bottom.text('L/R TEMPO  X/Y OCTAVE  SELECT REC', 62, 180, 0x868E96);
    },
  };
})();
