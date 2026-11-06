import _sequencerHtml from "./sequencer.html";
import { htmlGenPiano } from "../../shared/pianoUtils";
import { interpolator } from "../projectUtils";

// five octaves — the piano here picks the pending tone's pitch, it doesn't play
const sequencerHtml = interpolator(_sequencerHtml, htmlGenPiano(1, 0, 6, 0));
export { sequencerHtml };
