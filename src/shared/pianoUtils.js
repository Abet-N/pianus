const keyPattern = [
  "key-white-left",
  "key-black",
  "key-white-middle",
  "key-black",
  "key-white-right",
  "key-white-left",
  "key-black",
  "key-white-middle",
  "key-black",
  "key-white-middle",
  "key-black",
  "key-white-right",
];

/*
  octaves
*/
export function htmlGenPiano(startOctave, startOffset, endOctave, endIndex) {
  const totalOctaves = endOctave - startOctave + 1;
  const totalWhiteKeys = totalOctaves * 7;
  const minWhiteKeyPx = 34; // keep keys touch-friendly on narrow screens
  const whiteKeyWidth = 100 / totalWhiteKeys;
  const blackKeyWidth = whiteKeyWidth * 0.6;
  const keysInOctave = 12;

  let pianoKeysInnerHtml = "";
  let basePosition = 0;
  for (let i = startOctave; i <= endOctave; i++) {
    for (
      let j = 0;
      j < keysInOctave && (i !== endOctave || j < endIndex);
      j++
    ) {
      if (i === startOctave && j === 0) {
        j = startOffset;
      }      

      //console.log(`${i} ${j}`);

      pianoKeysInnerHtml += htmlGenPianoKey(
        keyPattern[j],
        i * keysInOctave + j,
        basePosition,
        whiteKeyWidth,
        blackKeyWidth
      );
      if(keyPattern[j].startsWith("key-white")) {
        basePosition += whiteKeyWidth;
      }
    }
  }
  const minPianoWidthPx = totalWhiteKeys * minWhiteKeyPx;
  return `
    <div class="piano-wrap">
      <button type="button" class="piano-expand-hint" id="piano-expand-hint" aria-label="Show piano controls" aria-expanded="false">+</button>
      <div class="piano-toolbar" id="piano-toolbar">
        <div class="piano-toolbar-buttons">
          <button type="button" class="piano-ctrl-btn" id="piano-zoom-out" aria-label="Zoom out">&minus;</button>
          <button type="button" class="piano-ctrl-btn" id="piano-zoom-in" aria-label="Zoom in">+</button>
          <button type="button" class="piano-ctrl-btn" id="piano-scroll-left" aria-label="Scroll left">&#9664;</button>
          <button type="button" class="piano-ctrl-btn" id="piano-scroll-right" aria-label="Scroll right">&#9654;</button>
        </div>
        <button type="button" class="piano-collapse-btn" id="piano-collapse-btn" aria-label="Hide piano controls">&minus;</button>
      </div>
      <div class="piano-scroll" id="piano-scroll">
        <div class="piano" id="piano-el" data-min-width="${minPianoWidthPx}" style="width:100%;min-width:${minPianoWidthPx}px;">
          ${pianoKeysInnerHtml}
        </div>
      </div>
    </div>`;
}

function htmlGenPianoKey(keyType, keyIndex, basePosition, whiteKeyWidth, blackKeyWidth) {
  const keyBaseStyleWhite = `position:absolute;`;
  const keyBaseStyleBlack = `position:absolute;`;

  switch (keyType) {
    case "key-white-left":
      const htmlGenFragment1WL = (basePosition) => {
        let style = keyBaseStyleWhite;
        style += `top:60%;left:${
          0 + basePosition
        }%;`;
        style += `width:${whiteKeyWidth}%;height:40%;`;
        return `<div class="wl-key-lower" style="${style}"></div>`;
      };
      const htmlGenFragment2WL = (basePosition) => {
        let style = keyBaseStyleWhite;
        style += `top:${0}%;left:${0 + basePosition}%;`;
        style += `width:${
          whiteKeyWidth - blackKeyWidth / 2
        }%;height:60%;`;
        return `<div class="wl-key-upper" style="${style}"></div>`;
      };
      return `<div id="key-${keyIndex}-wl" class="piano-key" tabindex="0" role="button" aria-label="Piano key ${keyIndex}" style="width:100%;height:100%;pointer-events:none">${htmlGenFragment1WL(basePosition)}${htmlGenFragment2WL(
        basePosition
      )}</div>`;
    case "key-white-middle":
      const htmlGenFragment1WM = (basePosition) => {
        let style = keyBaseStyleWhite;
        style += `top:60%;left:${
          0 + basePosition
        }%;`;
        style += `width:${whiteKeyWidth}%;height:40%;`;
        return `<div class="wm-key-lower" style="${style}"></div>`;
      };
      const htmlGenFragment2WM = (basePosition) => {
        let style = keyBaseStyleWhite;
        style += `top:${0}%;left:${
          blackKeyWidth / 2 + basePosition
        }%;`;
        style += `width:${
          whiteKeyWidth - blackKeyWidth
        }%;height:60%;`;
        return `<div class="wm-key-upper" style="${style}"></div>`;
      };
      return `<div id="key-${keyIndex}-wm" class="piano-key" tabindex="0" role="button" aria-label="Piano key ${keyIndex}" style="width:100%;height:100%;pointer-events:none">${htmlGenFragment1WM(basePosition)}${htmlGenFragment2WM(
        basePosition
      )}</div>`;
    case "key-white-right":
      const htmlGenFragment1WR = (basePosition) => {
        let style = keyBaseStyleWhite;
        style += `top:60%;left:${
          0 + basePosition
        }%;`;
        style += `width:${whiteKeyWidth}%;height:40%;`;
        return `<div class="wr-key-lower" style="${style}"></div>`;
      };
      const htmlGenFragment2WR = (basePosition) => {
        let style = keyBaseStyleWhite;
        style += `top:${0}%;left:${
          blackKeyWidth / 2 + basePosition
        }%;`;
        style += `width:${
          whiteKeyWidth - blackKeyWidth / 2
        }%;height:60%;`;
        return `<div class="wr-key-upper" style="${style}"></div>`;
      };
      return `<div id="key-${keyIndex}-wr" class="piano-key" tabindex="0" role="button" aria-label="Piano key ${keyIndex}" style="width:100%;height:100%;pointer-events:none">${htmlGenFragment1WR(basePosition)}${htmlGenFragment2WR(
        basePosition
      )}</div>`;
    case "key-black":
      let style = keyBaseStyleBlack;
      style += `top:${0}%;left:${
        -blackKeyWidth / 2 + basePosition
      }%;`;
      style += `width:${blackKeyWidth}%;height:60%`;
      return `<div id="key-${keyIndex}-b" class="piano-key" tabindex="0" role="button" aria-label="Piano key ${keyIndex}" style="width:100%;height:100%;pointer-events:none"><div class="b-key" style="${style}"></div></div>`;
    default:
      console.warn("htmlGenPianoKey unknown case");
      return "<div>Error</div>";
  }
}