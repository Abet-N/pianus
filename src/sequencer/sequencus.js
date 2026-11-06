// ---------------------------------------------------------------------------
// Sequencus — the app's singleton sequencer
// ---------------------------------------------------------------------------
//
// Holds one song at a time, built from tones in Format F (see ./format-f.js).
// A song is configured with a bpm and a meter ("4/4", "3/4", …) via init(); the
// grid that comes out of that is only a default though — every tone carries its
// own offset inside its beat, so finer timings are always accepted.
//
// Tones are addressed by a 2D index [beat, slot]: `beat` is the 1-based global
// beat, `slot` the 1-based position among the tones starting inside that beat.
// reviewSong() and playSong() are the exception — they take a 1D index into
// the song's playing order, because "start playback at the 5th tone" has
// nothing to do with beats.
//
// Writing is parallel by default. The write head is a point in time and stays
// put after newTone(), so tones written one after another land on the same
// onset and sound together as a chord — each one still gets its own slot, so
// every tone remains individually addressable. indexStep() is what moves time
// forward: it advances the head past the longest tone at the current onset.
//
// The sequencer never imports Tone.js itself — playSong() reaches through
// window.voices (populated by music-utils.exposeMusicUtils()) so each tone
// sounds through the voice it was written with. reviewSong() stays a pure
// console-log preview, sharing its timing math with playSong() via
// scheduleQueue() so the two can't drift apart.

import {
  serializeF,
  parseF,
  parseMeter,
  normalizePitch,
  normalizeLength,
  lengthToBeats,
  lengthToSeconds,
  lengthToToneDuration,
  keyIndexToPitch,
  pitchToKeyIndex,
  withSlots,
  availableLengths,
} from "./format-f.js";
import { parseMidi } from "./midi.js";

export const SONG_STORAGE_PREFIX = "sequencus:song:";
export const OUTPUT_STORAGE_KEY = "sequencus:output";

const DEFAULT_CONFIG = { bpm: 120, meter: "4/4", name: "untitled" };
const DEFAULT_SELECTION = { pitch: "C4", length: "1/4", amp: 0.8, voice: "klavier" };

function createSequencus() {
  let config = { ...DEFAULT_CONFIG };
  let meter = parseMeter(config.meter);
  let notes = [];
  let selection = { ...DEFAULT_SELECTION };
  // the write head is a point in time, not a tone: { beat, offset within it }.
  // The slot is derived from it, which is what lets tones share an onset.
  let cursor = { beat: 1, offset: 0 };
  let nextId = 1;
  let reviewTimers = [];
  let reviewing = false;
  // keys currently lit by playSong(), so stopReview() can un-light them even
  // when it cuts playback off mid-note (their own removal timeout never fires)
  let activeKeys = new Set();
  const listeners = new Set();

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  const notify = () => {
    listeners.forEach((listener) => {
      try {
        listener(getState());
      } catch (error) {
        console.error("sequencus listener failed", error);
      }
    });
  };

  // tones of one beat in playing order; the array position is slot - 1
  const beatNotes = (beat) =>
    notes
      .filter((note) => note.beat === beat)
      .sort((a, b) => a.offset - b.offset || a.id - b.id);

  // offsets are accumulated from tone lengths, so "same onset" needs a tolerance
  const SAME_ONSET = 1e-6;

  // the tones of one chord: everything starting at the same moment
  const notesAtOnset = (beat, offset) =>
    notes.filter(
      (note) => note.beat === beat && Math.abs(note.offset - offset) < SAME_ONSET
    );

  // the slot a tone written at the head would take — everything already starting
  // at or before that onset sorts ahead of it
  const cursorSlot = () =>
    notes.filter(
      (note) => note.beat === cursor.beat && note.offset <= cursor.offset + SAME_ONSET
    ).length + 1;

  const orderedNotes = () =>
    [...notes].sort((a, b) => a.beat - b.beat || a.offset - b.offset || a.id - b.id);

  const absoluteBeat = (note) => note.beat - 1 + note.offset;

  // accepts [beat, slot] | { beat, slot } | beat | undefined (→ the write head).
  // Always resolves to a point in time; the slot is carried along when one was
  // given, so the editing calls can still address one specific tone of a chord.
  const resolveIndex = (index) => {
    if (index === undefined || index === null) {
      return { beat: cursor.beat, slot: cursor.slot ?? null, offset: cursor.offset };
    }
    let beat;
    let slot;
    if (Array.isArray(index)) {
      beat = toBeat(index[0]);
      slot = index[1] === undefined ? null : toSlot(index[1]);
    } else if (typeof index === "object") {
      beat = toBeat(index.beat);
      slot = index.slot === undefined ? null : toSlot(index.slot);
    } else {
      beat = toBeat(index);
      slot = null;
    }
    const position = positionForSlot(beat, slot);
    return { beat: position.beat, slot, offset: position.offset };
  };

  // A slot's onset is defined by the tone sitting in it. Addressing a slot past
  // the end of a beat means "after everything there", which may fall into the
  // next beat.
  const positionForSlot = (beat, slot) => {
    if (slot === null) return { beat, offset: 0 };
    const inBeat = beatNotes(beat);
    if (inBeat.length === 0) return { beat, offset: 0 };
    const note = inBeat[slot - 1];
    if (note) return { beat, offset: note.offset };
    const last = inBeat[inBeat.length - 1];
    return carry(beat, last.offset + lengthToBeats(last.length, meter.beatUnit));
  };

  const toBeat = (value) => Math.max(1, Math.round(Number(value)) || 1);
  const toSlot = (value) => Math.max(1, Math.round(Number(value)) || 1);

  // keeps an offset inside [0, 1) by carrying whole beats over into `beat`
  const carry = (beat, offset) => {
    let carriedBeat = beat;
    let carriedOffset = offset;
    while (carriedOffset >= 1) {
      carriedOffset -= 1;
      carriedBeat += 1;
    }
    while (carriedOffset < 0 && carriedBeat > 1) {
      carriedOffset += 1;
      carriedBeat -= 1;
    }
    return { beat: carriedBeat, offset: Math.max(0, carriedOffset) };
  };

  // how far the head travels on a forward step: past the longest tone of the
  // chord it is sitting on, or by the pending tone's length on an empty onset
  const advanceFrom = (beat, offset) => {
    const chord = notesAtOnset(beat, offset);
    const beats =
      chord.length > 0
        ? Math.max(...chord.map((note) => lengthToBeats(note.length, meter.beatUnit)))
        : lengthToBeats(selection.length, meter.beatUnit);
    return carry(beat, offset + beats);
  };

  const buildTone = (overrides = {}) => {
    const source = { ...selection, ...overrides };
    const isRest = source.pitch === null || source.pitch === undefined || source.rest === true;
    return {
      pitch: isRest ? null : normalizePitch(source.pitch),
      length: normalizeLength(source.length),
      amp: isRest ? 0 : clampAmp(source.amp),
      voice: isRest ? null : String(source.voice ?? DEFAULT_SELECTION.voice),
    };
  };

  const clampAmp = (amp) => {
    const value = Number(amp);
    if (!Number.isFinite(value)) return DEFAULT_SELECTION.amp;
    return Math.min(1, Math.max(0, value));
  };

  const slotOf = (note) => beatNotes(note.beat).findIndex((candidate) => candidate.id === note.id) + 1;

  const noteAt = ({ beat, slot, offset }) => {
    const inBeat = beatNotes(beat);
    if (inBeat.length === 0) return null;
    if (slot !== null) return inBeat[slot - 1] ?? null;
    // no slot given: the most recently written tone of the addressed chord,
    // falling back to the most recent one anywhere in the beat
    const chord = notesAtOnset(beat, offset);
    return (chord.length > 0 ? chord : inBeat).reduce((a, b) => (a.id > b.id ? a : b));
  };

  const storage = () => {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch (error) {
      console.warn("sequencus: localStorage unavailable", error);
      return null;
    }
  };

  const adoptSong = (song) => {
    config = {
      bpm: Number(song.bpm) || DEFAULT_CONFIG.bpm,
      meter: song.meter ?? DEFAULT_CONFIG.meter,
      name: song.name ?? DEFAULT_CONFIG.name,
    };
    meter = parseMeter(config.meter);
    nextId = 1;
    notes = (song.notes ?? []).map((note) => ({
      id: nextId++,
      beat: toBeat(note.beat),
      offset: Number(note.offset) || 0,
      pitch: note.pitch === null || note.pitch === undefined ? null : normalizePitch(note.pitch),
      length: normalizeLength(note.length),
      amp: note.pitch ? clampAmp(note.amp) : 0,
      voice: note.pitch ? String(note.voice ?? DEFAULT_SELECTION.voice) : null,
    }));
    cursor = { beat: 1, offset: 0 };
  };

  // -------------------------------------------------------------------------
  // configuration
  // -------------------------------------------------------------------------

  // (re)initialise the sequencer — call this before starting a new song, or when
  // switching to a song with a different bpm/meter. Wipes the current tones.
  function init(options = {}) {
    stopReview();
    config = {
      bpm: Number(options.bpm) || DEFAULT_CONFIG.bpm,
      meter: options.meter ?? DEFAULT_CONFIG.meter,
      name: options.name ?? DEFAULT_CONFIG.name,
    };
    meter = parseMeter(config.meter);
    notes = [];
    nextId = 1;
    cursor = { beat: 1, offset: 0 };
    selection = { ...DEFAULT_SELECTION, ...(options.selection ?? {}) };
    notify();
    return getState();
  }

  // -------------------------------------------------------------------------
  // the "pending tone" the next newTone()/editTone() will deploy
  // -------------------------------------------------------------------------

  function setPitch(pitch) {
    selection.pitch = pitch === null ? null : normalizePitch(pitch);
    notify();
    return selection.pitch;
  }

  // convenience for the piano UI, whose key ids carry a semitone index
  function setPitchFromKeyIndex(keyIndex) {
    return setPitch(keyIndexToPitch(keyIndex));
  }

  function setLength(length) {
    selection.length = normalizeLength(length);
    notify();
    return selection.length;
  }

  function setAmplitude(amp) {
    selection.amp = clampAmp(amp);
    notify();
    return selection.amp;
  }

  function setVoice(voice) {
    selection.voice = String(voice);
    notify();
    return selection.voice;
  }

  function setRest(isRest = true) {
    selection.pitch = isRest ? null : DEFAULT_SELECTION.pitch;
    notify();
    return selection.pitch;
  }

  function getSelection() {
    return { ...selection };
  }

  // -------------------------------------------------------------------------
  // editing
  // -------------------------------------------------------------------------

  // Writes a tone (or, when the selection has no pitch, a pause) at the write
  // head, or at `index` when one is given. After a tone the head stays where it
  // is, so writing again stacks another tone onto the same onset — that is how
  // chords are built. After a pause the head moves on by that pause's length,
  // because silence is there to take up time: the next tone sounds after the
  // rest rather than on top of it, staying inside the same beat while it fits.
  // Pass `overrides.offset` to place a tone off the current onset, and step the
  // index to move on in time.
  // Returns the created tone including its resolved [beat, slot] index.
  function newTone(index, overrides = {}) {
    const target = resolveIndex(index);
    const placement =
      overrides.offset === undefined
        ? { beat: target.beat, offset: target.offset }
        : carry(target.beat, Number(overrides.offset) || 0);

    const note = {
      id: nextId++,
      beat: placement.beat,
      offset: placement.offset,
      ...buildTone(overrides),
    };
    notes.push(note);
    // a pause takes up time instead of sounding, so it carries the head along
    cursor =
      note.pitch === null
        ? carry(note.beat, note.offset + lengthToBeats(note.length, meter.beatUnit))
        : { beat: placement.beat, offset: placement.offset };
    notify();
    return { ...note, slot: slotOf(note) };
  }

  // explicit pause, regardless of the currently selected pitch. Like any pause
  // it advances the write head past itself.
  function newPause(index, overrides = {}) {
    return newTone(index, { ...overrides, rest: true });
  }

  // Removes the tone at `index`. With no slot in the index (or no index at all,
  // and nothing pinned by a prior jumpIndex) the most recently written tone of
  // the addressed chord is removed — so repeated calls peel a chord apart one
  // tone at a time. The head does not move.
  function deleteTone(index) {
    const target = resolveIndex(index);
    const note = noteAt(target);
    if (!note) return null;
    notes = notes.filter((candidate) => candidate.id !== note.id);
    // the pinned tone is gone; remaining slots shift, so stop addressing one by
    // a now-stale number and fall back to the "most recent" default again
    if (target.slot !== null) cursor = { beat: cursor.beat, offset: cursor.offset };
    notify();
    return note;
  }

  // Like newTone, but overwrites the tone already sitting at `index` with the
  // current selection (plus any explicit overrides).
  function editTone(index, overrides = {}) {
    const target = resolveIndex(index);
    const note = noteAt(target);
    if (!note) return null;

    Object.assign(note, buildTone(overrides));
    if (overrides.offset !== undefined) {
      const placement = carry(note.beat, Number(overrides.offset) || 0);
      note.beat = placement.beat;
      note.offset = placement.offset;
    }
    notify();
    return { ...note, slot: slotOf(note) };
  }

  // -------------------------------------------------------------------------
  // cursor
  // -------------------------------------------------------------------------

  // Moves the write head one onset forward (true) or backward (false). Forward
  // clears the chord the head is sitting on, so the next tone written sounds
  // after it instead of with it; backward returns to the previous onset.
  function indexStep(forward = true) {
    if (forward) {
      cursor = advanceFrom(cursor.beat, cursor.offset);
    } else {
      const earlier = beatNotes(cursor.beat)
        .map((note) => note.offset)
        .filter((offset) => offset < cursor.offset - SAME_ONSET);
      if (earlier.length > 0) {
        cursor = { beat: cursor.beat, offset: Math.max(...earlier) };
      } else if (cursor.offset > SAME_ONSET) {
        cursor = { beat: cursor.beat, offset: 0 };
      } else if (cursor.beat > 1) {
        const previousBeat = cursor.beat - 1;
        const offsets = beatNotes(previousBeat).map((note) => note.offset);
        cursor = {
          beat: previousBeat,
          offset: offsets.length > 0 ? Math.max(...offsets) : 0,
        };
      }
    }
    notify();
    return getIndex();
  }

  function jumpIndex(index) {
    const target = resolveIndex(index);
    // pin the exact tone that was addressed (e.g. one clicked in the roll)
    // so a parameterless deleteTone()/editTone() targets it precisely instead
    // of falling back to "the newest tone of the chord"
    cursor = { beat: target.beat, offset: target.offset, slot: target.slot };
    notify();
    return getIndex();
  }

  // the head as a 2D index; `offset` comes along because the grid is only a
  // default and the head can sit between beats
  function getIndex() {
    return { beat: cursor.beat, slot: cursorSlot(), offset: cursor.offset };
  }

  // -------------------------------------------------------------------------
  // playback
  // -------------------------------------------------------------------------

  // Schedules `onTone(note, playingIndex)` at the moment each tone from
  // `startIndex` on (1-dimensional: position in playing order) would sound,
  // plus `onDone()` once the last one has finished ringing out. This is the
  // timing math reviewSong() and playSong() share, so a console-only preview
  // and real playback can never disagree about when a tone lands.
  function scheduleQueue(startIndex, onTone, onDone) {
    stopReview();
    const ordered = withSlots(orderedNotes());
    const from = Math.max(1, Math.round(Number(startIndex)) || 1);
    const queue = ordered.slice(from - 1);
    if (queue.length === 0) return { queue, from };

    reviewing = true;
    const msPerBeat = 60000 / config.bpm;
    const startBeat = absoluteBeat(queue[0]);

    queue.forEach((note, position) => {
      const delay = (absoluteBeat(note) - startBeat) * msPerBeat;
      reviewTimers.push(setTimeout(() => onTone(note, from + position), delay));
    });

    const last = queue[queue.length - 1];
    const totalMs =
      (absoluteBeat(last) - startBeat + lengthToBeats(last.length, meter.beatUnit)) * msPerBeat;
    reviewTimers.push(
      setTimeout(() => {
        reviewing = false;
        if (onDone) onDone();
        notify();
      }, totalMs)
    );

    notify();
    return { queue, from };
  }

  function stopReview() {
    reviewTimers.forEach(clearTimeout);
    reviewTimers = [];
    activeKeys.forEach((key) => key.classList.remove(PLAYING_CLASS));
    activeKeys.clear();
    if (reviewing) {
      reviewing = false;
      console.log("[sequencus] review stopped");
      notify();
    }
    return true;
  }

  // Walks the song from `startIndex` and logs each tone's Format F line at the
  // moment it would sound. No audio, no DOM — playSong() below is the version
  // wired to actually be heard and seen.
  function reviewSong(startIndex) {
    const { queue, from } = scheduleQueue(
      startIndex,
      (note, index) => console.log(`[sequencus] ${index}: ${formatNoteLine(note)}`),
      () => console.log("[sequencus] review finished")
    );
    if (queue.length === 0) console.log("[sequencus] nothing to review");
    else
      console.log(
        `[sequencus] review "${config.name}" — ${queue.length} tone(s) from index ${from}`
      );
    return queue.length;
  }

  const PLAYING_CLASS = "playing"; // same class every other piano page highlights a sounding key with

  // every `.piano-key` inside `pianoEl`, keyed by the semitone index encoded in
  // its id (see pianoUtils.js)
  const keyMapOf = (pianoEl) =>
    new Map(
      Array.from(pianoEl.getElementsByClassName("piano-key")).map((key) => [
        parseInt(key.id.split("-")[1], 10),
        key,
      ])
    );

  // A piano tagged `data-voice="<voice>"` only highlights that voice's tones;
  // an untagged piano highlights every voice, which is what today's single
  // on-screen piano wants with no markup changes. A page that grows one piano
  // per voice can tag each and pass them all.
  const pianosForVoice = (pianos, voice) => {
    const matching = pianos.filter((piano) => piano.voice === voice);
    return matching.length > 0 ? matching : pianos.filter((piano) => piano.voice === undefined);
  };

  // Plays the song for real: each tone sounds through its own voice
  // (window.voices) and highlights the matching key on `pianos` for exactly its
  // length. `pianos` is a single DOM element (typically `.piano-wrap`) or an
  // array of them for a page with one piano per voice. The sequencer page's
  // Review button drives this too — reviewing a song now means playing it.
  function playSong(pianos, startIndex) {
    const pianoList = (Array.isArray(pianos) ? pianos : [pianos])
      .filter(Boolean)
      .map((el) => ({ voice: el.dataset.voice || undefined, keys: keyMapOf(el) }));

    const { queue, from } = scheduleQueue(startIndex, (note) => {
      if (note.pitch === null) return; // rest: nothing to sound or highlight
      const durationMs = lengthToSeconds(note.length, config.bpm, meter.beatUnit) * 1000;
      const instrument = window.voices?.[note.voice];
      if (instrument) {
        instrument.triggerAttackRelease(
          note.pitch,
          lengthToToneDuration(note.length) ?? note.length,
          undefined,
          note.amp
        );
      }
      pianosForVoice(pianoList, note.voice).forEach(({ keys }) => {
        const key = keys.get(pitchToKeyIndex(note.pitch));
        if (!key) return;
        key.classList.add(PLAYING_CLASS);
        activeKeys.add(key);
        reviewTimers.push(
          setTimeout(() => {
            key.classList.remove(PLAYING_CLASS);
            activeKeys.delete(key);
          }, durationMs)
        );
      });
    });

    if (queue.length === 0) console.log("[sequencus] nothing to play");
    else
      console.log(`[sequencus] play "${config.name}" — ${queue.length} tone(s) from index ${from}`);
    return queue.length;
  }

  const formatNoteLine = (note) =>
    `${note.beat}.${note.slot}  ${note.pitch ?? "rest"}  ${note.length}  ` +
    `${note.pitch ? note.amp.toFixed(2) : "-"}  ${note.voice ?? "-"}  +${note.offset.toFixed(3)}`;

  // -------------------------------------------------------------------------
  // persistence
  // -------------------------------------------------------------------------

  function saveSong(name) {
    const songName = String(name ?? config.name ?? DEFAULT_CONFIG.name);
    const store = storage();
    if (!store) return null;
    config.name = songName;
    const text = toFormatF();
    store.setItem(SONG_STORAGE_PREFIX + songName, text);
    notify();
    return text;
  }

  function loadSong(name) {
    const store = storage();
    if (!store) return null;
    const text = store.getItem(SONG_STORAGE_PREFIX + String(name));
    if (text === null) {
      console.warn(`[sequencus] no saved song named "${name}"`);
      return null;
    }
    stopReview();
    adoptSong(parseF(text));
    notify();
    return getState();
  }

  function deleteSong(name) {
    const store = storage();
    if (!store) return false;
    const key = SONG_STORAGE_PREFIX + String(name);
    const existed = store.getItem(key) !== null;
    store.removeItem(key);
    notify();
    return existed;
  }

  function listSongs() {
    const store = storage();
    if (!store) return [];
    return Object.keys(store)
      .filter((key) => key.startsWith(SONG_STORAGE_PREFIX))
      .map((key) => key.slice(SONG_STORAGE_PREFIX.length))
      .sort();
  }

  // -------------------------------------------------------------------------
  // import / export
  // -------------------------------------------------------------------------

  function toFormatF() {
    return serializeF({ ...config, notes: orderedNotes() });
  }

  function fromFormatF(text) {
    stopReview();
    adoptSong(parseF(text));
    notify();
    return getState();
  }

  // Loads a midi file (ArrayBuffer/Uint8Array). Tempo and time signature from the
  // file win over the current configuration. See ./midi.js for what is supported.
  function loadMidi(data, options = {}) {
    const song = parseMidi(data, options);
    stopReview();
    adoptSong({ ...song, name: options.name ?? song.name });
    notify();
    return getState();
  }

  // logs the song as Format F and parks the same text in a fixed localStorage key
  function dumpFormatF() {
    const text = toFormatF();
    console.log(text);
    const store = storage();
    if (store) store.setItem(OUTPUT_STORAGE_KEY, text);
    return text;
  }

  // -------------------------------------------------------------------------
  // reading state
  // -------------------------------------------------------------------------

  function getState() {
    return {
      name: config.name,
      bpm: config.bpm,
      meter: meter.text,
      beatsPerBar: meter.beatsPerBar,
      beatUnit: meter.beatUnit,
      cursor: getIndex(),
      selection: { ...selection },
      reviewing,
      notes: withSlots(orderedNotes()),
    };
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    init,
    setPitch, setPitchFromKeyIndex, setLength, setAmplitude, setVoice, setRest, getSelection,
    newTone, newPause, deleteTone, editTone,
    indexStep, jumpIndex, getIndex,
    reviewSong, playSong, stopReview,
    saveSong, loadSong, deleteSong, listSongs,
    toFormatF, fromFormatF, loadMidi, dumpFormatF,
    getState, onChange,
    availableLengths,
    lengthToBeats: (length) => lengthToBeats(length, meter.beatUnit),
    OUTPUT_STORAGE_KEY,
  };
}

// the app has exactly one sequencer
export const sequencus = createSequencus();

export function exposeSequencus() {
  window.sequencus = sequencus;
}
