# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small experimental "piano playground" web app: an Express server that renders HTML fragments server-side and a webpack-bundled browser frontend that plays piano sounds via Tone.js. There's also an unrelated, currently disconnected Emscripten/SDL2 C++ game experiment (`src-cpp/`).

## Important

Do not use chromium, playwright, or similar software.

Do not run `npm run build:main` (or `build-serve`/`start-server`) yourself — the developer always builds and runs it themselves at the end.

## Commands

There is no test suite, linter, or dev-watch script configured — only build and run:

```
npm run build:main    # webpack build (bundles both server and frontend, see below)
npm run start-server  # node ./dist/main.js — serves on http://localhost:3000
npm run build-serve   # build:main + start-server
```

There's no file-watch/reload — after any source change, re-run `npm run build:main` (and restart `start-server`) to see it.

## Architecture

**webpack.config.js builds two separate bundles from one config array:**
1. `serverConfig` — entry `src/server/main.js`, target `node`, output `dist/main.js`. This is the Express app.
2. `appConfig` — entry `src/index.js`, output `dist/public/index.js`. This is the browser bundle. `CopyPlugin` also copies `src/index.html` and `src/styles.css` into `dist/public/`.

Both configs are exported together, so a single `webpack` invocation builds server and client at once.

**Server-side routing is a custom fragment-serving scheme, not SSR of full pages:**
- `src/server/routes.js` defines `frontendRoutes`: an array of `{ path, content }`, where `content` is a pre-rendered HTML string (e.g. `htmlGenPiano(...)` from `pianoUtils.js`, or the raw `interval-game.html` imported as a string via webpack's `asset/source` rule).
- `src/server/main.js` wires these routes under `/fe-content/*` — each returns the raw HTML fragment for that path.
- Anything else (`/*`) falls through to serving `dist/public/index.html`, the SPA shell.

**Client-side routing fetches those fragments and swaps them into the DOM:**
- `src/index.js` intercepts navigation (`window.onpopstate`, the global `routeFn` called from inline `onclick` handlers in HTML), fetches `/fe-content<path>`, and injects the response into `#router-outlet`.
- After injecting new content, `completeRouteLoad(path)` (in `src/route-utils/route-utils.js`) attaches page-specific behavior — e.g. for `/klavier` it wires click/keyboard listeners onto `.piano-key` elements to trigger sound. This function needs a new branch whenever a new route needs post-load JS wiring.
- Because routed content lives in the DOM as injected HTML (not framework components), interactivity is attached imperatively per-route in `completeRouteLoad`, and page markup communicates with global JS via `window.*` functions (see below) rather than imports.

**Sound and globals:** `src/music-utils/music-utils.js` wraps Tone.js and exposes `window.playSound`, `window.activateSounds`, `window.playExampleSound` via `exposeMusicUtils()` (called once from `src/index.js`). Since fragment HTML uses inline `onclick`/event wiring outside of any module scope, cross-module calls go through `window`, not ES imports.

**Piano keyboard is generated server-side as absolutely-positioned HTML**, not drawn on a canvas: `src/server/pianoUtils.js`'s `htmlGenPiano(startOctave, startOffset, endOctave, endIndex)` builds a string of percentage-positioned `<div>`s per key (white keys split into upper/lower halves to fit black keys visually; black keys overlaid). Key ids encode the semitone index (`key-<index>-wl|wm|wr|b`), which `route-utils.js` parses back out to know which pitch to play.

**`src-cpp/` is a standalone Emscripten/SDL2 experiment** (`game.cpp`), compiled independently via `emcc` into `dist/public/game.out.js`. It is not currently linked into `index.html` (the `<canvas>`/`<script src="game.out.js">` tags are commented out) — treat it as a parked side quest, not part of the main app flow, unless asked to wire it back in.

## Notes

- No package manager lockfile conventions beyond the committed `package-lock.json` — use `npm`.
- `zeugs/` holds the developer's scratch notes (emsdk setup steps, cheatsheet, reference links) — not app code.
- `todo.txt` lists planned features (recorder, song creator tool) and infra todos (prettier config) that don't exist yet.
