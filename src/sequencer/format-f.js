// ---------------------------------------------------------------------------
// Format F — the human readable song format used by the sequencer ("sequencus")
// ---------------------------------------------------------------------------
//
// A song is a short header of `@key value` lines followed by one line per tone.
// Everything after a `#` is a comment. Columns are whitespace separated, so the
// file stays readable (and hand-editable) in any text editor:
//
//   # Format F v1 — pianoweb sequencus
//   @name   Little Etude
//   @bpm    120
//   @meter  4/4
//   #
//   # pos   pitch  len   amp   voice    off
//     1.1   C4     1/4   0.80  klavier  +0.000
//     1.2   D#4    1/8   0.65  glas     +1.000
//     2.1   rest   1/4   -     -        +0.000
//
// Columns:
//   pos    <beat>.<slot> — the 2D index the sequencer API uses. `beat` is the
//          1-based global beat, `slot` the 1-based position among the tones
//          that start within that beat.
//   pitch  scientific pitch name (C4, D#4, …) or `rest` for a pause.
//   len    tone length as a fraction of a whole note: 1/1 (full), 1/2 (half),
//          1/4 (quarter), 1/8, 3/8 (dotted quarter), … Named lengths
//          ("full", "half", "quarter", …) are accepted when parsing.
//   amp    amplitude 0.00–1.00, or `-` on a rest.
//   voice  a voice name from window.voices (klavier, glas, synth, …) or a name
//          derived from a midi program; `-` on a rest.
//   off    offset inside the beat, in beats (0.000 ≤ off < 1.000). The grid is
//          set up from bpm + meter, but any tone may sit at a finer position.
//
// This module is deliberately free of DOM/Tone.js/localStorage dependencies so
// it can be reused anywhere (browser, node, tests).

export const F_VERSION = 1;
export const F_HEADER = `# Format F v${F_VERSION} — pianoweb sequencus`;

export const REST = "rest";

const SEMITONE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// enharmonic spellings accepted on input, normalised to the sharp names above
const PITCH_CLASSES = {
  C: 0, "B#": 0,
  "C#": 1, Db: 1,
  D: 2,
  "D#": 3, Eb: 3,
  E: 4, Fb: 4,
  F: 5, "E#": 5,
  "F#": 6, Gb: 6,
  G: 7,
  "G#": 8, Ab: 8,
  A: 9,
  "A#": 10, Bb: 10,
  B: 11, Cb: 11,
};

// htmlGenPiano encodes a semitone index in every key id (`key-<index>-wl|wm|wr|b`)
// and music-utils turns that index into `${name}${2 + floor(index / 12)}`. The
// same offset is applied here so a Format F pitch round-trips to the key a user
// actually clicked.
const KEY_INDEX_OCTAVE_OFFSET = 2;

// midi note 60 is C4, i.e. octave = floor(note / 12) - 1
const MIDI_OCTAVE_OFFSET = -1;

const NAMED_LENGTHS = {
  full: "1/1",
  whole: "1/1",
  half: "1/2",
  quarter: "1/4",
  eighth: "1/8",
  sixteenth: "1/16",
  "dotted-half": "3/4",
  "dotted-quarter": "3/8",
  "dotted-eighth": "3/16",
};

// candidates used when snapping a free-running duration (e.g. from midi) onto a
// readable length. Ordered long → short; extend this list to support finer grids.
const LENGTH_CANDIDATES = [
  "1/1", "3/4", "1/2", "3/8", "1/4", "3/16", "1/8", "3/32", "1/16", "1/32",
];

// tone lengths as ToneJS duration strings, for whoever wires playback up later
const TONE_DURATIONS = {
  "1/1": "1n", "3/4": "2n.", "1/2": "2n", "3/8": "4n.", "1/4": "4n",
  "3/16": "8n.", "1/8": "8n", "3/32": "16n.", "1/16": "16n", "1/32": "32n",
};

// ---------------------------------------------------------------------------
// pitch helpers
// ---------------------------------------------------------------------------

export function keyIndexToPitch(keyIndex) {
  const index = Math.round(Number(keyIndex));
  if (!Number.isFinite(index)) throw new Error(`invalid key index: ${keyIndex}`);
  const name = SEMITONE_NAMES[((index % 12) + 12) % 12];
  return `${name}${KEY_INDEX_OCTAVE_OFFSET + Math.floor(index / 12)}`;
}

export function pitchToKeyIndex(pitch) {
  const { pitchClass, octave } = splitPitch(pitch);
  return (octave - KEY_INDEX_OCTAVE_OFFSET) * 12 + pitchClass;
}

export function midiNoteToPitch(note) {
  const name = SEMITONE_NAMES[((note % 12) + 12) % 12];
  return `${name}${Math.floor(note / 12) + MIDI_OCTAVE_OFFSET}`;
}

// normalises "db4"/"Db4" → "C#4" and rejects anything that isn't a pitch
export function normalizePitch(pitch) {
  if (pitch === null || pitch === undefined) return null;
  const text = String(pitch).trim();
  if (text === "" || text.toLowerCase() === REST) return null;
  const { pitchClass, octave } = splitPitch(text);
  return `${SEMITONE_NAMES[pitchClass]}${octave}`;
}

function splitPitch(pitch) {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(pitch).trim());
  if (!match) throw new Error(`invalid pitch: ${pitch}`);
  const name = match[1].toUpperCase() + match[2];
  const pitchClass = PITCH_CLASSES[name];
  if (pitchClass === undefined) throw new Error(`invalid pitch: ${pitch}`);
  return { pitchClass, octave: parseInt(match[3], 10) };
}

// ---------------------------------------------------------------------------
// length + meter helpers
// ---------------------------------------------------------------------------

export function normalizeLength(length) {
  const text = String(length ?? "").trim().toLowerCase();
  if (NAMED_LENGTHS[text]) return NAMED_LENGTHS[text];
  const match = /^(\d+)\/(\d+)$/.exec(text);
  if (!match) throw new Error(`invalid tone length: ${length}`);
  const numerator = parseInt(match[1], 10);
  const denominator = parseInt(match[2], 10);
  if (numerator <= 0 || denominator <= 0) throw new Error(`invalid tone length: ${length}`);
  return `${numerator}/${denominator}`;
}

export function parseMeter(meter) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(String(meter ?? "").trim());
  if (!match) throw new Error(`invalid meter: ${meter}`);
  const beatsPerBar = parseInt(match[1], 10);
  const beatUnit = parseInt(match[2], 10);
  if (beatsPerBar <= 0 || beatUnit <= 0) throw new Error(`invalid meter: ${meter}`);
  return { beatsPerBar, beatUnit, text: `${beatsPerBar}/${beatUnit}` };
}

// a whole note spans `beatUnit` beats: in 4/4 a 1/4 tone is one beat, in 6/8 a
// 1/8 tone is one beat.
export function lengthToBeats(length, beatUnit) {
  const [numerator, denominator] = normalizeLength(length).split("/").map(Number);
  return (numerator / denominator) * beatUnit;
}

export function beatsToLength(beats, beatUnit) {
  let best = LENGTH_CANDIDATES[0];
  let bestDistance = Infinity;
  LENGTH_CANDIDATES.forEach((candidate) => {
    const distance = Math.abs(lengthToBeats(candidate, beatUnit) - beats);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  });
  return best;
}

export function lengthToToneDuration(length) {
  return TONE_DURATIONS[normalizeLength(length)] ?? null;
}

export function lengthToSeconds(length, bpm, beatUnit) {
  return lengthToBeats(length, beatUnit) * (60 / bpm);
}

export function availableLengths() {
  return [...LENGTH_CANDIDATES];
}

// ---------------------------------------------------------------------------
// serialise
// ---------------------------------------------------------------------------

// `song` is { name, bpm, meter, notes: [{ beat, offset, pitch, length, amp, voice }] }
// where notes are expected to already carry their resolved slot, or to be in
// beat/offset order (slots are recomputed here either way).
export function serializeF(song) {
  const meter = parseMeter(song.meter);
  const lines = [
    F_HEADER,
    `@name   ${song.name ?? "untitled"}`,
    `@bpm    ${song.bpm}`,
    `@meter  ${meter.text}`,
    "#",
    "# pos   pitch  len   amp   voice    off",
  ];

  withSlots(song.notes ?? []).forEach((note) => {
    const isRest = note.pitch === null || note.pitch === undefined;
    lines.push(
      "  " +
        `${note.beat}.${note.slot}`.padEnd(6) +
        (isRest ? REST : note.pitch).padEnd(7) +
        normalizeLength(note.length).padEnd(6) +
        (isRest ? "-" : Number(note.amp).toFixed(2)).padEnd(6) +
        (isRest ? "-" : String(note.voice)).padEnd(9) +
        `+${Number(note.offset ?? 0).toFixed(3)}`
    );
  });

  return lines.join("\n") + "\n";
}

// sorts notes into playing order and stamps each with its slot inside its beat
export function withSlots(notes) {
  const ordered = [...notes].sort(
    (a, b) => a.beat - b.beat || (a.offset ?? 0) - (b.offset ?? 0) || (a.id ?? 0) - (b.id ?? 0)
  );
  let currentBeat = null;
  let slot = 0;
  return ordered.map((note) => {
    if (note.beat !== currentBeat) {
      currentBeat = note.beat;
      slot = 0;
    }
    slot++;
    return { ...note, slot };
  });
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

export function parseF(text) {
  const song = { name: "untitled", bpm: 120, meter: "4/4", notes: [] };

  String(text ?? "")
    .split(/\r?\n/)
    .forEach((rawLine, lineNumber) => {
      // "#" starts a comment, but only when it isn't glued onto the token
      // before it — otherwise the "#" of a sharp pitch (C#, D#, …) would be
      // mistaken for one, truncating the line mid-column
      const line = rawLine.replace(/(^|\s)#.*$/, "$1").trim();
      if (line === "") return;

      if (line.startsWith("@")) {
        const [key, ...rest] = line.slice(1).split(/\s+/);
        const value = rest.join(" ").trim();
        if (key === "name") song.name = value;
        else if (key === "bpm") song.bpm = Number(value);
        else if (key === "meter") song.meter = parseMeter(value).text;
        // unknown @keys are ignored on purpose so the format can grow
        return;
      }

      song.notes.push(parseNoteLine(line, lineNumber + 1));
    });

  if (!Number.isFinite(song.bpm) || song.bpm <= 0) {
    throw new Error(`invalid bpm in Format F: ${song.bpm}`);
  }
  return song;
}

function parseNoteLine(line, lineNumber) {
  const columns = line.split(/\s+/);
  if (columns.length < 3) {
    throw new Error(`Format F line ${lineNumber}: expected at least 3 columns, got "${line}"`);
  }

  const [position, pitch, length, amp, voice, offset] = columns;
  const positionMatch = /^(\d+)(?:\.(\d+))?$/.exec(position);
  if (!positionMatch) {
    throw new Error(`Format F line ${lineNumber}: invalid position "${position}"`);
  }

  const isRest = pitch.toLowerCase() === REST || pitch === "-";
  return {
    beat: parseInt(positionMatch[1], 10),
    offset: offset === undefined ? 0 : Math.abs(Number(offset)),
    pitch: isRest ? null : normalizePitch(pitch),
    length: normalizeLength(length),
    amp: isRest || amp === undefined || amp === "-" ? 0 : Number(amp),
    voice: isRest || voice === undefined || voice === "-" ? null : voice,
  };
}
