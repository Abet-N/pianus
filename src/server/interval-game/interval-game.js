import _intervalGameHtml from "./interval-game.html";
import { htmlGenPiano } from "../../shared/pianoUtils";
import { interpolator } from "../projectUtils";

const intervalGameHtml = interpolator(_intervalGameHtml, htmlGenPiano(2, 0, 4, 0));
export { intervalGameHtml };
