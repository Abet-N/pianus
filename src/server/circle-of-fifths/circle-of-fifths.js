import _circleOfFifthsHtml from "./circle-of-fifths.html";
import { htmlGenPiano } from "../../shared/pianoUtils";
import { interpolator } from "../projectUtils";
import { htmlGenCircleOfFifths } from "../circleOfFifthsUtils";

const withCircle = _circleOfFifthsHtml.replace("<!--cof-content-->", htmlGenCircleOfFifths());
// two full octaves (3 and 4) so a scale started in the lower octave always
// has room to ascend into the upper one, see circleOfFifthsRouteLoad
const circleOfFifthsHtml = interpolator(withCircle, htmlGenPiano(3, 0, 5, 0));

export { circleOfFifthsHtml };
