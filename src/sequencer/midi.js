// ---------------------------------------------------------------------------
// Minimal standard-midi-file reader for the sequencer
// ---------------------------------------------------------------------------
//
// Deliberately small: it reads note-on/note-off pairs, the first tempo event and
// the first time signature, and turns them into a Format F song. Everything else
// (controllers, pitch bend, sysex) is parsed only far enough to be skipped.
//
// Extension points, in the order they'll probably be wanted:
//   * registerMidiVoice(program, voiceName) — map a midi program to one of the
//     app's voices instead of falling back to DEFAULT_VOICE.
//   * tempo changes: `readTrack` already sees every tempo meta event, it just
//     keeps the first. Collecting them into a tempo map is the natural next step.
//   * channel 10 (drums) is currently treated like any other channel.

import { midiNoteToPitch, beatsToLength, parseMeter } from "./format-f.js";

const DEFAULT_VOICE = "klavier";
const DEFAULT_PPQ = 480;
const DEFAULT_TEMPO_US_PER_QUARTER = 500000; // 120 bpm

// midi program number → voice name from window.voices
const midiVoices = new Map();

export function registerMidiVoice(program, voiceName) {
  midiVoices.set(Number(program), String(voiceName));
}

export function parseMidi(data, options = {}) {
  const bytes = toBytes(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (readAscii(bytes, 0, 4) !== "MThd") throw new Error("not a midi file (missing MThd)");
  const division = view.getUint16(12);
  let ppq = division;
  if ((division & 0x8000) !== 0) {
    console.warn("[sequencus] SMPTE midi timing is not supported, assuming 480 ticks/quarter");
    ppq = DEFAULT_PPQ;
  }

  const collected = [];
  let tempo = null;
  let meter = null;

  let cursor = 8 + view.getUint32(4); // skip the header chunk's declared length
  while (cursor < bytes.length - 8) {
    const chunkType = readAscii(bytes, cursor, 4);
    const chunkLength = view.getUint32(cursor + 4);
    const chunkStart = cursor + 8;
    if (chunkType === "MTrk") {
      const track = readTrack(bytes, view, chunkStart, chunkStart + chunkLength);
      collected.push(...track.notes);
      if (tempo === null && track.tempo !== null) tempo = track.tempo;
      if (meter === null && track.meter !== null) meter = track.meter;
    }
    cursor = chunkStart + chunkLength;
  }

  const meterText = options.meter ?? meter ?? "4/4";
  const beatUnit = parseMeter(meterText).beatUnit;
  const bpm = Math.round(60000000 / (tempo ?? DEFAULT_TEMPO_US_PER_QUARTER));

  // ticks → quarter notes → beats of the configured meter
  const ticksToBeats = (ticks) => (ticks / ppq) * (beatUnit / 4);

  const notes = collected
    .sort((a, b) => a.startTicks - b.startTicks)
    .map((note) => {
      const startBeats = ticksToBeats(note.startTicks);
      const beat = Math.floor(startBeats);
      return {
        beat: beat + 1,
        offset: startBeats - beat,
        pitch: midiNoteToPitch(note.note),
        length: beatsToLength(Math.max(ticksToBeats(note.durationTicks), 1e-6), beatUnit),
        amp: Math.min(1, note.velocity / 127),
        voice: midiVoices.get(note.program) ?? DEFAULT_VOICE,
      };
    });

  return { name: options.name ?? "midi import", bpm, meter: meterText, notes };
}

// reads one MTrk chunk, pairing note-on with the matching note-off
function readTrack(bytes, view, start, end) {
  const notes = [];
  const sounding = new Map(); // `${channel}:${note}` → open note
  const programs = new Map(); // channel → program number
  let tempo = null;
  let meter = null;
  let ticks = 0;
  let runningStatus = 0;
  let cursor = start;

  const closeNote = (channel, note) => {
    const key = `${channel}:${note}`;
    const open = sounding.get(key);
    if (!open) return;
    sounding.delete(key);
    notes.push({ ...open, durationTicks: Math.max(0, ticks - open.startTicks) });
  };

  while (cursor < end) {
    const delta = readVariableLength(bytes, cursor);
    ticks += delta.value;
    cursor = delta.next;
    if (cursor >= end) break;

    let status = bytes[cursor];
    if (status < 0x80) {
      status = runningStatus; // running status: reuse the previous status byte
    } else {
      cursor++;
    }
    if (status === 0) break;

    if (status === 0xff) {
      const type = bytes[cursor++];
      const length = readVariableLength(bytes, cursor);
      cursor = length.next;
      if (type === 0x51 && length.value === 3) {
        tempo = (bytes[cursor] << 16) | (bytes[cursor + 1] << 8) | bytes[cursor + 2];
      } else if (type === 0x58 && length.value >= 2) {
        meter = `${bytes[cursor]}/${2 ** bytes[cursor + 1]}`;
      }
      cursor += length.value;
      if (type === 0x2f) break; // end of track
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      const length = readVariableLength(bytes, cursor);
      cursor = length.next + length.value;
      continue;
    }

    runningStatus = status;
    const command = status & 0xf0;
    const channel = status & 0x0f;

    if (command === 0x90) {
      const note = bytes[cursor++];
      const velocity = bytes[cursor++];
      if (velocity === 0) {
        closeNote(channel, note); // note-on with velocity 0 is a note-off
      } else {
        closeNote(channel, note); // retrigger without a note-off in between
        sounding.set(`${channel}:${note}`, {
          note,
          velocity,
          startTicks: ticks,
          program: programs.get(channel) ?? 0,
        });
      }
    } else if (command === 0x80) {
      const note = bytes[cursor++];
      cursor++; // release velocity
      closeNote(channel, note);
    } else if (command === 0xc0) {
      programs.set(channel, bytes[cursor++]);
    } else if (command === 0xd0) {
      cursor++;
    } else {
      cursor += 2; // 0xA0 aftertouch, 0xB0 controller, 0xE0 pitch bend
    }
  }

  // anything still sounding at the end of the track gets a nominal quarter note
  sounding.forEach((open) => notes.push({ ...open, durationTicks: DEFAULT_PPQ }));

  return { notes, tempo, meter };
}

function readVariableLength(bytes, start) {
  let value = 0;
  let cursor = start;
  for (let i = 0; i < 4; i++) {
    const byte = bytes[cursor++];
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return { value, next: cursor };
}

function readAscii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error("loadMidi expects an ArrayBuffer or a typed array");
}
