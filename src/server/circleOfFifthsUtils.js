// display names per clock position (index 0 = 12 o'clock = C, walking clockwise
// by fifths) using each key's conventional accidental spelling, matching a
// standard circle-of-fifths chart rather than uniform sharp spelling
const MAJOR_POSITION_NAMES = ["C", "G", "D", "A", "E", "B", "F♯", "D♭", "A♭", "E♭", "B♭", "F"];
const MINOR_POSITION_NAMES = ["A", "E", "B", "F♯", "C♯", "G♯", "D♯", "B♭", "F", "C", "G", "D"];
const CIRCLE_STEPS = 12;
const FIFTH_INTERVAL = 7; // stepping by a fifth each position walks the circle, clock-hour by clock-hour
const RELATIVE_MINOR_OFFSET = 9; // a relative minor's root sits 9 semitones above its major's root (mod 12)

const CENTER = 200;
const RING_RADIUS = 170;
const LABEL_RADIUS = 132;
const TICK_INNER_RADIUS = 150;
const TICK_OUTER_RADIUS = 188;
const HIT_RADIUS = 34;
const CENTER_CIRCLE_RADIUS = 55;

function polarPoint(angleDeg, radius) {
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: (CENTER + radius * Math.sin(angleRad)).toFixed(2),
    y: (CENTER - radius * Math.cos(angleRad)).toFixed(2),
  };
}

// builds the 12 clock-hour positions of the circle of fifths (ticks + clickable
// labels) plus the mode-toggle center circle, as inline SVG child markup.
// Each position carries both its major and relative-minor pitch class/label as
// data attributes so the client can switch between them without recomputing
// music theory in two places.
export function htmlGenCircleOfFifths() {
  let positionsHtml = "";
  for (let i = 0; i < CIRCLE_STEPS; i++) {
    const majorPitchClass = (i * FIFTH_INTERVAL) % CIRCLE_STEPS;
    const minorPitchClass = (majorPitchClass + RELATIVE_MINOR_OFFSET) % CIRCLE_STEPS;
    const majorName = MAJOR_POSITION_NAMES[i];
    const minorName = MINOR_POSITION_NAMES[i];
    const angleDeg = i * (360 / CIRCLE_STEPS);
    const tickStart = polarPoint(angleDeg, TICK_INNER_RADIUS);
    const tickEnd = polarPoint(angleDeg, TICK_OUTER_RADIUS);
    const labelPos = polarPoint(angleDeg, LABEL_RADIUS);

    positionsHtml += `
      <g class="cof-position" id="cof-key-${i}" data-major-pitch-class="${majorPitchClass}" data-minor-pitch-class="${minorPitchClass}" data-major-label="${majorName}" data-minor-label="${minorName}" tabindex="0" role="button" aria-label="Play the ${majorName} major scale">
        <title>Play the ${majorName} major scale</title>
        <line class="cof-tick" x1="${tickStart.x}" y1="${tickStart.y}" x2="${tickEnd.x}" y2="${tickEnd.y}"></line>
        <circle class="cof-hit" cx="${labelPos.x}" cy="${labelPos.y}" r="${HIT_RADIUS}"></circle>
        <text class="cof-label" x="${labelPos.x}" y="${labelPos.y}" text-anchor="middle" dominant-baseline="central">${majorName}</text>
      </g>`;
  }

  return `
    <circle class="cof-ring" cx="${CENTER}" cy="${CENTER}" r="${RING_RADIUS}"></circle>
    ${positionsHtml}
    <circle class="cof-center" id="cof-center" cx="${CENTER}" cy="${CENTER}" r="${CENTER_CIRCLE_RADIUS}" tabindex="0" role="button" aria-label="Switch to minor scales">
      <title id="cof-center-title">Switch to minor scales</title>
    </circle>
    <text class="cof-center-label" id="cof-center-label" x="${CENTER}" y="${CENTER}" text-anchor="middle" dominant-baseline="central">/</text>`;
}
