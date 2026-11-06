import { pianoHtml } from "./piano/piano.js";
import { intervalGameHtml } from "./interval-game/interval-game.js";
import { circleOfFifthsHtml } from "./circle-of-fifths/circle-of-fifths.js";
import { sequencerHtml } from "./sequencer/sequencer.js";

export const frontendRoutes = [
  { path: "/", content: "<div> I am Dashboard</div>" },
  {
    path: "/klavier",
    content: pianoHtml,
  },
  {
    path: "/lernen",
    content: "<div id='router-outlet-1'></div>",
    children: [
      {
        path: "/intervalle",
        content: intervalGameHtml,
      },
      {
        path: "/quintenzirkel",
        content: circleOfFifthsHtml,
      },
    ],
  },

  {
    path: "/sequencer",
    content: sequencerHtml,
  },

  {path: "/a", content: "<div><div> I am A</div><div id='router-outlet-1'></div></div>",
    children: [ { path: "/aa", content: "<div> I am AA</div>" } ],
  },
  { path: "/*", content: "<div> 404 Not Found</div>" },
];

