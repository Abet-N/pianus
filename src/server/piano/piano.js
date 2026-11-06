import _piano from "./piano.html";
import { htmlGenPiano } from "../../shared/pianoUtils";
import { interpolator } from "../projectUtils";

const pianoHtml = interpolator(_piano, htmlGenPiano(2, 0, 5, 11));
export { pianoHtml };