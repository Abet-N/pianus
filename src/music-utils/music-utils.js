import * as Tone from "tone";
export const yo = "12345";

export function exposeMusicUtils() {
  const toneMap = {
    0: "C",
    1: "C#",
    2: "D",
    3: "D#",
    4: "E",
    5: "F",
    6: "F#",
    7: "G",
    8: "G#",
    9: "A",
    10: "A#",
    11: "B",
  };

  async function activateSounds() {
    await Tone.start();
  }

  function playExampleSound() {
    const synth = new Tone.Synth().toDestination();
    synth.triggerAttackRelease("C4", "1n");
  }

  const synth = new Tone.Synth().toDestination();
  const klavier = new Tone.Sampler({
    urls: { C5: "./default.mp3" }, release: 1,
  }).toDestination();
  const glas = new Tone.Sampler({
    urls: {Db6: "glas_Cis.mp3", G6: "glas_G.mp3"}, release:1,
  }).toDestination();


  function playSound(index, duration = "2n") {
    const tone = `${toneMap[index % 12]}${2 + Math.floor(index / 12)}`;
    console.log(window.currentVoice);
    window.currentVoice.triggerAttackRelease(tone, duration);
    return Tone.Time(duration).toSeconds() * 1000;
  }

  function triggerAttack(index) {
    const tone = `${toneMap[index % 12]}${2 + Math.floor(index / 12)}`;
    window.currentVoice.triggerAttack(tone);
  }

  function triggerRelease(index) {
    const tone = `${toneMap[index % 12]}${2 + Math.floor(index / 12)}`;
    if (window.currentVoice instanceof Tone.Sampler) {
      window.currentVoice.triggerRelease(tone);
    } else {
      window.currentVoice.triggerRelease();
    }
  }

  function changeVoice(voiceName) {
    window.currentVoice = window.voices[voiceName] ?? klavier;
  }
  
  window.voices = {};
  window.voices.klavier = klavier;
  window.voices.glas = glas;
  window.voices.synth = synth;

  window.activateSounds = activateSounds;
  window.playExampleSound = playExampleSound;
  window.playSound = playSound;
  window.triggerAttack = triggerAttack;
  window.triggerRelease = triggerRelease;
  window.changeVoice = changeVoice;

  changeVoice("klavier"); // default voice
}
