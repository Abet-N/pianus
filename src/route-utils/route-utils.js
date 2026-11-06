// pure helpers (no DOM/Tone.js), used to map the sequencer's pitches onto the
// piano keys and roll rows that represent them
import { pitchToKeyIndex, keyIndexToPitch } from "../sequencer/format-f.js";
import { htmlGenPiano } from "../shared/pianoUtils.js";

function pianoRouteLoad() {
      const keys = document.getElementsByClassName('piano-key');
    Array.from(keys).forEach((key) => {
      const keyIndex = parseInt(key.id.split('-')[1]);
      let playingTimeout = [];

      const triggerPlay = () => {
        const durationMs = window.playSound(keyIndex);
        key.classList.add('playing');
        clearTimeout(playingTimeout[keyIndex]);
        playingTimeout[keyIndex] = setTimeout(() => {
          key.classList.remove('playing');
        }, durationMs);
      };

      const triggerStart = () => {
        window.triggerAttack(keyIndex);
        key.classList.add('playing');
        clearTimeout(playingTimeout[keyIndex]);
        playingTimeout[keyIndex] = setTimeout(() => {
          key.classList.remove('playing');
          window.triggerRelease(keyIndex);
        },5000);
      }

      const triggerStop = () => {
        window.triggerRelease(keyIndex);
        key.classList.remove('playing');
        clearTimeout(playingTimeout[keyIndex]);
      }

      //key.addEventListener('click', triggerPlay);
      // add another event listener for when the click starts
      key.addEventListener('mousedown', triggerStart);
      key.addEventListener('mouseup', triggerStop);
      key.addEventListener('mouseleave', triggerStop);

      // touch devices don't fire mousedown/mouseup until after the finger
      // lifts (synthetic events, ~300ms late, no mouseleave equivalent), so
      // handle touch explicitly. preventDefault stops those synthetic mouse
      // events from also firing, so this can't double-trigger the mouse path.
      key.addEventListener('touchstart', (event) => {
        event.preventDefault();
        triggerStart();
      });
      key.addEventListener('touchend', (event) => {
        event.preventDefault();
        triggerStop();
      });
      key.addEventListener('touchcancel', (event) => {
        event.preventDefault();
        triggerStop();
      });

      key.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        triggerPlay();
      });
    });
}

function voiceSelectRouteLoad() {
  const select = document.getElementById('voice-select');
  if (!select) return;

  select.innerHTML = '';
  Object.keys(window.voices || {}).forEach((voiceName) => {
    const option = document.createElement('option');
    option.value = voiceName;
    option.textContent = voiceName;
    select.appendChild(option);
  });

  select.addEventListener('change', () => {
    window.changeVoice(select.value);
  });
}

const PIANO_ZOOM_STEP = 0.25;
const PIANO_MIN_ZOOM = 1;
const PIANO_MAX_ZOOM = 2.5;
const PIANO_SCROLL_WHITE_KEYS_PER_CLICK = 4;

function pianoControlsRouteLoad() {
  const wrap = document.querySelector('.piano-wrap');
  if (!wrap) return;

  const pianoScroll = document.getElementById('piano-scroll');
  const pianoEl = document.getElementById('piano-el');
  const zoomInBtn = document.getElementById('piano-zoom-in');
  const zoomOutBtn = document.getElementById('piano-zoom-out');
  const scrollLeftBtn = document.getElementById('piano-scroll-left');
  const scrollRightBtn = document.getElementById('piano-scroll-right');
  const expandHint = document.getElementById('piano-expand-hint');
  const collapseBtn = document.getElementById('piano-collapse-btn');
  const minWidthPx = parseFloat(pianoEl.dataset.minWidth) || pianoEl.clientWidth;
  const numWhiteKeys = pianoEl.querySelectorAll(
    '.piano-key[id$="-wl"], .piano-key[id$="-wm"], .piano-key[id$="-wr"]'
  ).length;

  let zoomScale = PIANO_MIN_ZOOM;

  // "natural" width is whatever the piano would render at with no zoom applied
  // (container width, or the server-computed touch-friendly minimum, whichever is larger)
  const naturalWidthPx = () => Math.max(pianoScroll.clientWidth, minWidthPx);

  const updateControlsState = () => {
    const overflowing = pianoScroll.scrollWidth > pianoScroll.clientWidth + 1;
    zoomOutBtn.disabled = !overflowing || zoomScale <= PIANO_MIN_ZOOM + 0.001;
    zoomInBtn.disabled = zoomScale >= PIANO_MAX_ZOOM - 0.001;
    scrollLeftBtn.disabled = !overflowing || pianoScroll.scrollLeft <= 0;
    scrollRightBtn.disabled =
      !overflowing ||
      pianoScroll.scrollLeft >= pianoScroll.scrollWidth - pianoScroll.clientWidth - 1;
  };

  const applyZoom = (nextScale) => {
    zoomScale = Math.min(PIANO_MAX_ZOOM, Math.max(PIANO_MIN_ZOOM, nextScale));
    pianoEl.style.width = `${naturalWidthPx() * zoomScale}px`;
    updateControlsState();
  };

  zoomInBtn.addEventListener('click', () => applyZoom(zoomScale + PIANO_ZOOM_STEP));
  zoomOutBtn.addEventListener('click', () => applyZoom(zoomScale - PIANO_ZOOM_STEP));

  const scrollStepPx = () =>
    (pianoEl.clientWidth / numWhiteKeys) * PIANO_SCROLL_WHITE_KEYS_PER_CLICK;

  scrollLeftBtn.addEventListener('click', () => {
    pianoScroll.scrollBy({ left: -scrollStepPx(), behavior: 'smooth' });
  });
  scrollRightBtn.addEventListener('click', () => {
    pianoScroll.scrollBy({ left: scrollStepPx(), behavior: 'smooth' });
  });

  expandHint.addEventListener('click', () => {
    wrap.classList.add('toolbar-expanded');
    expandHint.setAttribute('aria-expanded', 'true');
  });
  collapseBtn.addEventListener('click', () => {
    wrap.classList.remove('toolbar-expanded');
    expandHint.setAttribute('aria-expanded', 'false');
  });

  pianoScroll.addEventListener('scroll', updateControlsState);
  window.addEventListener('resize', () => applyZoom(zoomScale));

  applyZoom(zoomScale);
}

const INTERVAL_GAME_DURATION_MS = 60000;
const INTERVAL_GAME_NOTE_DURATION = "4n";
const INTERVAL_GAME_FEEDBACK_MS = 800;
const INTERVAL_GAME_HINT_GAP_MS = 250;
const INTERVAL_GAME_WAVE_STEP_MS = 20; // 1000ms / 50 keys per second
const INTERVAL_GAME_WAVE_HIGHLIGHT_MS = 200;
const INTERVAL_GAME_REACTION_FAST_MS = 500; // reaction time at/under this scores 5
const INTERVAL_GAME_REACTION_SLOW_MS = 3000; // reaction time at/over this scores 1
const INTERVAL_GAME_MAX_INTERVAL = 12; // one octave — largest allowed distance from the previous tone

function intervalGameScoreForReaction(reactionMs) {
  if (reactionMs <= INTERVAL_GAME_REACTION_FAST_MS) return 5;
  if (reactionMs >= INTERVAL_GAME_REACTION_SLOW_MS) return 1;
  const t =
    (reactionMs - INTERVAL_GAME_REACTION_FAST_MS) /
    (INTERVAL_GAME_REACTION_SLOW_MS - INTERVAL_GAME_REACTION_FAST_MS);
  return Math.round(5 - t * 4);
}

function intervalGameRouteLoad() {
  const root = document.querySelector('.interval-game');
  if (!root) return;
  // the SPA has no unmount hook: once the fragment is replaced by routing away,
  // `root` is detached and any in-flight timeout below must stop touching it.
  const isMounted = () => document.body.contains(root);

  const startBtn = document.getElementById('interval-game-start');
  const restartBtn = document.getElementById('interval-game-restart');
  const statusEl = document.getElementById('interval-game-status');
  const scoreEl = document.getElementById('interval-game-score');

  const keyByIndex = new Map(
    Array.from(document.getElementsByClassName('piano-key')).map((key) => [
      parseInt(key.id.split('-')[1]),
      key,
    ])
  );
  const pool = Array.from(keyByIndex.keys());

  let gameId = 0; // bumped on every (re)start so stale timeout chains can detect they're obsolete
  let running = false;
  let roundActive = false;
  let currentTarget = null;
  let targetPlayedAt = 0;
  let score = 0;
  let endTimeoutId = null;

  const isActive = (id) => isMounted() && running && id === gameId;

  const pickFrom = (reference) => {
    let choices = pool;
    if (reference != null) {
      choices = pool.filter(
        (i) => i !== reference && Math.abs(i - reference) <= INTERVAL_GAME_MAX_INTERVAL
      );
      if (choices.length === 0) choices = pool.filter((i) => i !== reference);
    }
    return choices[Math.floor(Math.random() * choices.length)];
  };

  const clearFeedback = (key) => key.classList.remove('key-correct', 'key-wrong');

  const resetKeyVisuals = () =>
    keyByIndex.forEach((key) => key.classList.remove('playing', 'key-correct', 'key-wrong'));

  function startRound(id) {
    if (!isActive(id)) return;
    currentTarget = pickFrom(currentTarget);
    roundActive = true;
    targetPlayedAt = performance.now();
    window.playSound(currentTarget, INTERVAL_GAME_NOTE_DURATION);
    statusEl.textContent = 'Which key did you hear?';
  }

  function playHint(id) {
    if (!isActive(id)) return;
    currentTarget = pickFrom(null);
    const key = keyByIndex.get(currentTarget);
    const durationMs = window.playSound(currentTarget, INTERVAL_GAME_NOTE_DURATION);
    key.classList.add('playing');
    statusEl.textContent = 'Listen…';
    setTimeout(() => {
      if (!isMounted()) return;
      key.classList.remove('playing');
    }, durationMs);
    setTimeout(() => startRound(id), durationMs + INTERVAL_GAME_HINT_GAP_MS);
  }

  function handleGuess(index) {
    if (!roundActive) return;
    roundActive = false;
    const id = gameId;
    const reactionMs = performance.now() - targetPlayedAt;
    const correct = index === currentTarget;
    const clickedKey = keyByIndex.get(index);
    const correctKey = keyByIndex.get(currentTarget);

    // reinforce the interval by ear regardless of which key was actually hit
    window.playSound(currentTarget, INTERVAL_GAME_NOTE_DURATION);

    if (correct) {
      score += intervalGameScoreForReaction(reactionMs);
      clickedKey.classList.add('key-correct');
      statusEl.textContent = 'Correct!';
    } else {
      clickedKey.classList.add('key-wrong');
      correctKey.classList.add('key-correct');
      statusEl.textContent = 'Not quite — here is the right key.';
    }

    setTimeout(() => {
      if (!isMounted()) return;
      clearFeedback(clickedKey);
      clearFeedback(correctKey);
      startRound(id);
    }, INTERVAL_GAME_FEEDBACK_MS);
  }

  keyByIndex.forEach((key, keyIndex) => {
    key.addEventListener('mousedown', () => handleGuess(keyIndex));
    key.addEventListener('touchstart', (event) => {
      event.preventDefault();
      handleGuess(keyIndex);
    });
    key.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      handleGuess(keyIndex);
    });
  });

  function playWave(id) {
    const ordered = [...pool].sort((a, b) => a - b);
    return new Promise((resolve) => {
      ordered.forEach((index, i) => {
        setTimeout(() => {
          if (!isMounted() || id !== gameId) return;
          const key = keyByIndex.get(index);
          key.classList.add('playing');
          setTimeout(() => {
            if (!isMounted()) return;
            key.classList.remove('playing');
          }, INTERVAL_GAME_WAVE_HIGHLIGHT_MS);
        }, i * INTERVAL_GAME_WAVE_STEP_MS);
      });
      const totalMs =
        (ordered.length - 1) * INTERVAL_GAME_WAVE_STEP_MS + INTERVAL_GAME_WAVE_HIGHLIGHT_MS;
      setTimeout(resolve, totalMs);
    });
  }

  function endGame(id) {
    if (!isMounted() || id !== gameId) return;
    running = false;
    roundActive = false;
    resetKeyVisuals();
    statusEl.textContent = 'Time!';
    playWave(id).then(() => {
      if (!isMounted() || id !== gameId) return;
      scoreEl.textContent = `Score: ${score}`;
      scoreEl.hidden = false;
      statusEl.textContent = 'Game over.';
    });
  }

  async function startGame() {
    if (window.activateSounds) await window.activateSounds();
    if (!isMounted()) return;

    clearTimeout(endTimeoutId);
    const id = ++gameId;
    resetKeyVisuals();
    running = true;
    roundActive = false;
    score = 0;
    scoreEl.hidden = true;
    startBtn.hidden = true;
    restartBtn.hidden = false;

    playHint(id);
    endTimeoutId = setTimeout(() => endGame(id), INTERVAL_GAME_DURATION_MS);
  }

  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);
}

const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11, 12];
const NATURAL_MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10, 12];
// circle-of-fifths.js renders the demo piano as htmlGenPiano(3, 0, 5, 0): two
// full octaves, octave 3 and octave 4. Scales always start in the lower one
// (octave 3, index 36) so the ascending octave always lands inside octave 4
// instead of running off the top of the displayed keys.
const CIRCLE_OF_FIFTHS_ROOT_OCTAVE_BASE_INDEX = 3 * 12;
const CIRCLE_OF_FIFTHS_NOTE_STEP_MS = 380;
const CIRCLE_OF_FIFTHS_NOTE_DURATION = "4n";
const CIRCLE_OF_FIFTHS_HIGHLIGHT_MS = 340;

function circleOfFifthsRouteLoad() {
  window.currentVoice = window.voices.klavier; // default voice for this page

  const root = document.querySelector('.circle-of-fifths-page');
  if (!root) return;
  // the SPA has no unmount hook: once the fragment is routed away from,
  // `root` is detached and any in-flight timeout chain below must stop
  // touching it.
  const isMounted = () => document.body.contains(root);

  const keyByIndex = new Map(
    Array.from(document.getElementsByClassName('piano-key')).map((key) => [
      parseInt(key.id.split('-')[1]),
      key,
    ])
  );

  const svg = document.getElementById('circle-of-fifths');
  const centerBtn = document.getElementById('cof-center');
  const positions = Array.from(document.querySelectorAll('.cof-position'));
  const songSelect = document.getElementById('cof-song-select');

  const sequencus = window.sequencus;
  sequencus.init();
  const songs = ['-', ...sequencus.listSongs()];
  songSelect.innerHTML = '';
  songs.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    songSelect.appendChild(option);
  });
  songSelect.value = '-';

  songSelect.addEventListener('change', () => {
    const pianoContainer = document.querySelector('.circle-of-fifths-piano');
    if(songSelect.value === '-') {
      pianoContainer.innerHTML = htmlGenPiano(3, 0, 5, 0);
    } else {
      pianoContainer.innerHTML = htmlGenPiano(2, 0, 5, 11);
    }
  })

  let mode = 'major';
  let playToken = 0; // bumped on every new scale trigger so a stale timeout chain can detect it's obsolete

  const applyMode = () => {
    svg.classList.toggle('cof-mode-major', mode === 'major');
    svg.classList.toggle('cof-mode-minor', mode === 'minor');
    const centerTooltip = mode === 'major' ? 'Switch to minor scales' : 'Switch to major scales';
    centerBtn.setAttribute('aria-label', centerTooltip);
    const centerTitle = document.getElementById('cof-center-title');
    if (centerTitle) centerTitle.textContent = centerTooltip;
    positions.forEach((positionEl) => {
      const noteName =
        mode === 'major' ? positionEl.dataset.majorLabel : positionEl.dataset.minorLabel;
      positionEl.querySelector('.cof-label').textContent = noteName;
      const tooltip = `Play the ${noteName} ${mode} scale`;
      positionEl.setAttribute('aria-label', tooltip);
      const title = positionEl.querySelector('title');
      if (title) title.textContent = tooltip;
    });
  };

  const toggleMode = () => {
    mode = mode === 'major' ? 'minor' : 'major';
    applyMode();
  };

  centerBtn.addEventListener('click', toggleMode);
  centerBtn.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleMode();
  });

  function playScale(pitchClass, positionEl) {
    const token = ++playToken;
    const intervals = mode === 'major' ? MAJOR_SCALE_INTERVALS : NATURAL_MINOR_SCALE_INTERVALS;
    const rootIndex = CIRCLE_OF_FIFTHS_ROOT_OCTAVE_BASE_INDEX + pitchClass;
    const totalMs = (intervals.length - 1) * CIRCLE_OF_FIFTHS_NOTE_STEP_MS + CIRCLE_OF_FIFTHS_HIGHLIGHT_MS;

    positionEl.classList.add('cof-active');
    setTimeout(() => {
      if (!isMounted() || token !== playToken) return;
      positionEl.classList.remove('cof-active');
    }, totalMs);

    intervals.forEach((interval, i) => {
      setTimeout(() => {
        if (!isMounted() || token !== playToken) return;
        const noteIndex = rootIndex + interval;
        window.playSound(noteIndex, CIRCLE_OF_FIFTHS_NOTE_DURATION);
        const key = keyByIndex.get(noteIndex);
        if (!key) return;
        key.classList.add('playing');
        setTimeout(() => {
          if (!isMounted()) return;
          key.classList.remove('playing');
        }, CIRCLE_OF_FIFTHS_HIGHLIGHT_MS);
      }, i * CIRCLE_OF_FIFTHS_NOTE_STEP_MS);
    });
  }

  positions.forEach((positionEl) => {
    const trigger = async () => {
      if (window.activateSounds) await window.activateSounds();
      if (!isMounted()) return;
      const pitchClass = parseInt(
        mode === 'major' ? positionEl.dataset.majorPitchClass : positionEl.dataset.minorPitchClass,
        10
      );
      playScale(pitchClass, positionEl);
    };
    positionEl.addEventListener('click', trigger);
    positionEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      trigger();
    });
  });

  applyMode();
}

// ---------------------------------------------------------------------------
// sequencer (/sequencer)
// ---------------------------------------------------------------------------
// This page is only a shell over the `window.sequencus` singleton: every control
// calls into that API and never mutates song state itself, and everything on
// screen is (re)rendered from the state object its onChange listener hands out.
// The piano is a pitch picker here (it sets the pending tone), which is why
// pianoRouteLoad() must not run on this route — only pianoControlsRouteLoad().

// The API offers ten tone lengths; the UI shows five plus a dotted toggle, which
// reaches all of them except 1/32 without ten buttons competing for attention.
const SEQ_BASE_LENGTHS = ['1/1', '1/2', '1/4', '1/8', '1/16'];
const SEQ_DOTTED_OF = { '1/2': '3/4', '1/4': '3/8', '1/8': '3/16', '1/16': '3/32' };

const seqIsDotted = (length) => String(length).startsWith('3/');

const seqBaseLength = (length) => {
  const entry = Object.entries(SEQ_DOTTED_OF).find(([, dotted]) => dotted === length);
  return entry ? entry[0] : length;
};

// tolerance for "starts at the same moment as the write head", matching the one
// the sequencer groups chords with
const SEQ_SAME_ONSET = 1e-6;

const seqAtHead = (note, cursor) =>
  note.beat === cursor.beat && Math.abs(note.offset - cursor.offset) < SEQ_SAME_ONSET;

function sequencerRouteLoad() {
  const root = document.getElementById('sequencer-page');
  if (!root) return;
  const sequencus = window.sequencus;
  if (!sequencus) {
    console.warn('sequencer: window.sequencus is not available');
    return;
  }
  // the SPA has no unmount hook: once the fragment is routed away from, `root`
  // is detached — the onChange subscription and any awaited work below have to
  // notice that and stop touching the DOM.
  const isMounted = () => document.body.contains(root);

  const bpmInput = document.getElementById('sequencer-bpm');
  const meterSelect = document.getElementById('sequencer-meter');
  const nameInput = document.getElementById('sequencer-name');
  const initBtn = document.getElementById('sequencer-init');
  const selectionEl = document.getElementById('sequencer-selection');
  const lengthsEl = document.getElementById('sequencer-lengths');
  const voiceSelect = document.getElementById('sequencer-voice');
  const ampInput = document.getElementById('sequencer-amp');
  const ampValueEl = document.getElementById('sequencer-amp-value');
  const cursorReadoutEl = document.getElementById('sequencer-cursor-readout');
  const cursorBackBtn = document.getElementById('sequencer-cursor-back');
  const cursorForwardBtn = document.getElementById('sequencer-cursor-forward');
  const addToneBtn = document.getElementById('sequencer-add-tone');
  const addPauseBtn = document.getElementById('sequencer-add-pause');
  const editToneBtn = document.getElementById('sequencer-edit-tone');
  const deleteToneBtn = document.getElementById('sequencer-delete-tone');
  const advanceBtn = document.getElementById('sequencer-advance');
  const reviewBtn = document.getElementById('sequencer-review');
  const saveBtn = document.getElementById('sequencer-save');
  const songSelect = document.getElementById('sequencer-song-select');
  const loadBtn = document.getElementById('sequencer-load');
  const deleteBtn = document.getElementById('sequencer-delete');
  const loadMidiBtn = document.getElementById('sequencer-load-midi');
  const midiFileInput = document.getElementById('sequencer-midi-file');
  const dumpBtn = document.getElementById('sequencer-dump');
  const formatEl = document.getElementById('sequencer-format-f');
  const rollEl = document.getElementById('sequencer-roll');
  const pianoEl = root.querySelector('.piano-wrap');

  const keyByIndex = new Map(
    Array.from(root.getElementsByClassName('piano-key')).map((key) => [
      parseInt(key.id.split('-')[1]),
      key,
    ])
  );
  // the roll's vertical axis spans exactly the keys on screen
  const keyIndices = Array.from(keyByIndex.keys());
  const minKey = Math.min(...keyIndices);
  const maxKey = Math.max(...keyIndices);
  const rowCount = maxKey - minKey + 1;
  const rowHeight = 100 / rowCount;
  const topOfKey = (keyIndex) => ((maxKey - keyIndex) / rowCount) * 100;

  const songName = () => nameInput.value.trim() || undefined;

  // pitchToKeyIndex throws on anything that isn't a pitch; a tone outside the
  // displayed range is clamped onto the nearest edge of the roll
  const keyIndexOfPitch = (pitch) => {
    try {
      return Math.min(maxKey, Math.max(minKey, pitchToKeyIndex(pitch)));
    } catch (error) {
      return null;
    }
  };

  // ---- the piano selects the pending tone's pitch (and previews it) ----------
  const selectKey = async (keyIndex) => {
    sequencus.setPitchFromKeyIndex(keyIndex); // notifies -> render() marks the key
    if (window.activateSounds) await window.activateSounds();
    if (!isMounted()) return;
    window.playSound(keyIndex);
  };

  keyByIndex.forEach((key, keyIndex) => {
    key.addEventListener('mousedown', () => selectKey(keyIndex));
    key.addEventListener('touchstart', (event) => {
      event.preventDefault();
      selectKey(keyIndex);
    });
    key.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectKey(keyIndex);
    });
  });

  // ---- tone length: five bases plus one dotted toggle ----------------------
  const lengthButtons = SEQ_BASE_LENGTHS.map((length) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'navbar-button seq-btn seq-length-btn';
    button.dataset.length = length;
    button.textContent = length;
    button.addEventListener('click', () => {
      const dotted = seqIsDotted(sequencus.getSelection().length);
      sequencus.setLength(dotted && SEQ_DOTTED_OF[length] ? SEQ_DOTTED_OF[length] : length);
    });
    lengthsEl.appendChild(button);
    return button;
  });

  const dottedBtn = document.createElement('button');
  dottedBtn.type = 'button';
  dottedBtn.className = 'navbar-button seq-btn seq-length-btn';
  dottedBtn.textContent = 'dotted';
  dottedBtn.title = 'Extend the selected length by half';
  dottedBtn.addEventListener('click', () => {
    const current = sequencus.getSelection().length;
    const base = seqBaseLength(current);
    sequencus.setLength(seqIsDotted(current) ? base : SEQ_DOTTED_OF[base] ?? base);
  });
  lengthsEl.appendChild(dottedBtn);

  // ---- voice of the tone (not the app's playback voice) --------------------
  Object.keys(window.voices || {}).forEach((voiceName) => {
    const option = document.createElement('option');
    option.value = voiceName;
    option.textContent = voiceName;
    voiceSelect.appendChild(option);
  });
  voiceSelect.addEventListener('change', () => sequencus.setVoice(voiceSelect.value));

  ampInput.addEventListener('input', () => sequencus.setAmplitude(Number(ampInput.value)));

  // ---- configuration -------------------------------------------------------
  initBtn.addEventListener('click', () => {
    sequencus.init({
      bpm: Number(bpmInput.value),
      meter: meterSelect.value,
      name: songName(),
    });
  });

  // ---- writing tones -------------------------------------------------------
  // The head stays put after a write, so writing twice stacks a chord. Melody
  // entry wants the opposite, hence this toggle — off by default, as chords are
  // the behaviour that needs no extra keystroke.
  let autoStep = false;

  const writeTone = (write) => {
    write();
    if (autoStep) sequencus.indexStep(true);
  };

  addToneBtn.addEventListener('click', () => writeTone(() => sequencus.newTone()));
  // a pause moves the head on by itself, so auto-step must not advance it twice
  addPauseBtn.addEventListener('click', () => sequencus.newPause());
  editToneBtn.addEventListener('click', () => sequencus.editTone());
  deleteToneBtn.addEventListener('click', () => sequencus.deleteTone());
  cursorBackBtn.addEventListener('click', () => sequencus.indexStep(false));
  cursorForwardBtn.addEventListener('click', () => sequencus.indexStep(true));
  advanceBtn.addEventListener('click', () => {
    autoStep = !autoStep;
    advanceBtn.classList.toggle('selected', autoStep);
  });

  // ---- review (plays the song and highlights the keys as they sound) -------
  // playSong indexes the song 1-dimensionally, so translate the 2D write
  // position into "the nth tone in playing order" and start there. Notes are
  // compared by onset (beat + offset), not by cursor.slot: that slot is "one
  // past the chord under the head" (it's where the *next* write would land,
  // see render()'s readout), so comparing against it would always skip the
  // chord actually sitting at the head — which is exactly where the cursor
  // sits right after init()/loadSong() reset it, making playback always miss
  // the song's first beat.
  const cursorPlayIndex = (state) => {
    const headOnset = state.cursor.beat - 1 + state.cursor.offset;
    const position = state.notes.findIndex(
      (note) => note.beat - 1 + note.offset >= headOnset - SEQ_SAME_ONSET
    );
    return position === -1 ? 1 : position + 1;
  };

  reviewBtn.addEventListener('click', async () => {
    const state = sequencus.getState();
    if (state.reviewing) {
      sequencus.stopReview();
      return;
    }
    if (window.activateSounds) await window.activateSounds();
    if (!isMounted()) return;
    sequencus.playSong(pianoEl, cursorPlayIndex(state));
  });

  // ---- songs in localStorage -----------------------------------------------
  saveBtn.addEventListener('click', () => sequencus.saveSong(songName()));
  loadBtn.addEventListener('click', () => {
    if (songSelect.value) sequencus.loadSong(songSelect.value);
  });
  deleteBtn.addEventListener('click', () => {
    if (songSelect.value) sequencus.deleteSong(songSelect.value);
  });

  // ---- midi import -----------------------------------------------------------
  // the button only opens the (hidden) file picker; the actual import happens
  // on its change event so re-picking the same file still fires it
  loadMidiBtn.addEventListener('click', () => midiFileInput.click());
  midiFileInput.addEventListener('change', async () => {
    const file = midiFileInput.files && midiFileInput.files[0];
    midiFileInput.value = '';
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      if (!isMounted()) return;
      // the filename becomes the song's name; loadMidi (sequencus.js ->
      // midi.js's parseMidi) already falls back every note without a
      // registered voice onto the default "klavier" (piano) voice
      sequencus.loadMidi(buffer, { name: file.name.replace(/\.[^./\\]+$/, '') });
    } catch (error) {
      console.error(`sequencer: failed to load midi file "${file.name}"`, error);
    }
  });

  dumpBtn.addEventListener('click', () => sequencus.dumpFormatF());

  // ---- rendering -----------------------------------------------------------
  let songListSignature = null;

  const renderSongList = () => {
    const songs = sequencus.listSongs();
    const signature = JSON.stringify(songs);
    if (signature === songListSignature) return; // don't reset the dropdown on every notify
    songListSignature = signature;
    const previous = songSelect.value;
    songSelect.innerHTML = '';
    songs.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      songSelect.appendChild(option);
    });
    if (songs.includes(previous)) songSelect.value = previous;
  };

  // PLACEHOLDER visualization: pitch runs up the vertical axis and time along
  // the horizontal one, so the song reads roughly like a sheet of music. Octave
  // guides label the C of each octave; bar lines come from the meter. Replace
  // this with a real score view later.
  let rollTotalBeats = 1;

  const renderRoll = (state) => {
    rollEl.innerHTML = '';
    const songEndBeat = state.notes.reduce(
      (end, note) =>
        Math.max(end, note.beat - 1 + note.offset + sequencus.lengthToBeats(note.length)),
      0
    );
    rollTotalBeats =
      Math.max(state.beatsPerBar, state.cursor.beat, Math.ceil(songEndBeat)) || 1;

    for (let keyIndex = minKey; keyIndex <= maxKey; keyIndex++) {
      if (keyIndex % 12 !== 0) continue; // one guide per C
      const guide = document.createElement('div');
      guide.className = 'seq-guide';
      guide.style.top = `${topOfKey(keyIndex) + rowHeight}%`;
      guide.dataset.label = keyIndexToPitch(keyIndex);
      rollEl.appendChild(guide);
    }

    for (let beat = state.beatsPerBar; beat < rollTotalBeats; beat += state.beatsPerBar) {
      const barLine = document.createElement('div');
      barLine.className = 'seq-bar-line';
      barLine.style.left = `${(beat / rollTotalBeats) * 100}%`;
      rollEl.appendChild(barLine);
    }

    // the head sits at an exact point in time and is drawn as wide as the tone
    // that would be written there
    const headBeats = state.cursor.beat - 1 + state.cursor.offset;
    const cursorMarker = document.createElement('div');
    cursorMarker.className = 'seq-cursor';
    cursorMarker.style.left = `${(headBeats / rollTotalBeats) * 100}%`;
    cursorMarker.style.width = `${
      (sequencus.lengthToBeats(state.selection.length) / rollTotalBeats) * 100
    }%`;
    cursorMarker.title = `write position ${state.cursor.beat}.${state.cursor.slot}`;
    rollEl.appendChild(cursorMarker);

    state.notes.forEach((note) => {
      const isRest = note.pitch === null || note.pitch === undefined;
      const block = document.createElement('div');
      block.className = isRest ? 'seq-note seq-note-rest' : 'seq-note';
      // everything sounding with the head is one chord — show it as a unit
      if (seqAtHead(note, state.cursor)) block.classList.add('seq-note-at-head');
      block.style.left = `${((note.beat - 1 + note.offset) / rollTotalBeats) * 100}%`;
      block.style.width = `${(sequencus.lengthToBeats(note.length) / rollTotalBeats) * 100}%`;
      if (!isRest) {
        block.style.top = `${topOfKey(keyIndexOfPitch(note.pitch) ?? minKey)}%`;
        block.style.height = `${rowHeight}%`;
      }
      block.title = `${note.beat}.${note.slot}  ${isRest ? 'rest' : note.pitch}  ${note.length}`;
      block.addEventListener('click', (event) => {
        event.stopPropagation(); // don't also handle this as a click on the roll
        sequencus.jumpIndex([note.beat, note.slot]);
      });
      rollEl.appendChild(block);
    });
  };

  // clicking the roll moves the write position — that replaces a beat/slot form
  rollEl.addEventListener('click', (event) => {
    const bounds = rollEl.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / bounds.width;
    // a bare beat number puts the head on that beat's downbeat
    sequencus.jumpIndex(Math.max(1, Math.floor(ratio * rollTotalBeats) + 1));
  });

  // config fields are user-owned: don't stomp on what's typed there just
  // because some unrelated action (writing a tone, moving the cursor, …)
  // fired a notify(). Only push a field back to the confirmed state when
  // that confirmed value actually changed (e.g. after init()/loadSong()) —
  // otherwise a name typed ahead of clicking Save would get silently
  // reverted before Save ever reads it.
  let lastConfirmed = { bpm: undefined, name: undefined, meter: undefined };

  const render = (state) => {
    if (document.activeElement !== bpmInput && state.bpm !== lastConfirmed.bpm) {
      bpmInput.value = state.bpm;
    }
    if (document.activeElement !== nameInput && state.name !== lastConfirmed.name) {
      nameInput.value = state.name;
    }
    if (
      document.activeElement !== meterSelect &&
      state.meter !== lastConfirmed.meter &&
      Array.from(meterSelect.options).some((option) => option.value === state.meter)
    ) {
      meterSelect.value = state.meter;
    }
    lastConfirmed = { bpm: state.bpm, name: state.name, meter: state.meter };

    const selection = state.selection;
    const isRest = selection.pitch === null || selection.pitch === undefined;
    selectionEl.textContent = isRest
      ? `rest · ${selection.length}`
      : `${selection.pitch} · ${selection.length} · ${selection.voice}`;

    const selectedKeyIndex = isRest ? null : keyIndexOfPitch(selection.pitch);
    keyByIndex.forEach((key, keyIndex) => {
      key.classList.toggle('selected', keyIndex === selectedKeyIndex);
    });

    const baseLength = seqBaseLength(selection.length);
    lengthButtons.forEach((button) => {
      button.classList.toggle('selected', button.dataset.length === baseLength);
    });
    dottedBtn.classList.toggle('selected', seqIsDotted(selection.length));
    dottedBtn.disabled = !SEQ_DOTTED_OF[baseLength];

    if (Array.from(voiceSelect.options).some((option) => option.value === selection.voice)) {
      voiceSelect.value = selection.voice;
    }
    if (document.activeElement !== ampInput) ampInput.value = selection.amp;
    ampValueEl.textContent = Number(selection.amp).toFixed(2);

    // the reported slot is where the next tone lands, so it sits one past the
    // chord already under the head
    const chordAtHead = state.notes.filter((note) => seqAtHead(note, state.cursor));
    cursorReadoutEl.textContent = `${state.cursor.beat}.${state.cursor.slot}`;
    cursorReadoutEl.title =
      `beat ${state.cursor.beat}, offset +${state.cursor.offset.toFixed(3)} — ` +
      `${chordAtHead.length} tone(s) start here`;
    // Replace rewrites the newest tone of the chord under the head; Delete peels
    // one off, falling back to the newest tone anywhere in the beat
    editToneBtn.disabled = chordAtHead.length === 0;
    deleteToneBtn.disabled = !state.notes.some((note) => note.beat === state.cursor.beat);

    reviewBtn.textContent = state.reviewing ? 'Stop' : 'Review';
    root.classList.toggle('sequencer-reviewing', state.reviewing);

    formatEl.textContent = sequencus.toFormatF();
    renderSongList();
    renderRoll(state);
  };

  let unsubscribe = null;
  unsubscribe = sequencus.onChange((state) => {
    if (!isMounted()) {
      if (unsubscribe) unsubscribe(); // no unmount hook: drop the listener on first stale notify
      return;
    }
    render(state);
  });

  render(sequencus.getState());
}

export function completeRouteLoad(path) {
  window.changeVoice('klavier'); // reset to default voice on every route load
  if(path === "/klavier") {
    pianoRouteLoad();
    pianoControlsRouteLoad();
    voiceSelectRouteLoad();
  } else if(path === "/lernen/intervalle") {
    pianoControlsRouteLoad();
    intervalGameRouteLoad();
  } else if(path === "/lernen/quintenzirkel") {
    pianoControlsRouteLoad();
    circleOfFifthsRouteLoad();
  } else if(path === "/sequencer") {
    pianoControlsRouteLoad();
    sequencerRouteLoad();
  }
}