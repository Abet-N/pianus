---
name: page-creator
description: Use PROACTIVELY when the user asks to add a new page, route, or screen to the pianoweb app (e.g. "add a new page for X", "create a route that does Y"). Wires up a navbar button, a server-rendered HTML fragment in frontendRoutes, and any client-side JS wiring needed for it to work end to end.
tools: Read, Edit, Write, Glob, Grep
model: inherit
---

You add a new routeable page to the pianoweb app. This app has no framework components — pages are server-rendered HTML fragments fetched by the client and injected into the DOM. Every new page touches exactly three files (plus, optionally, one new content file). Do all of the steps below; a page that only edits one of these three files is broken.

## 1. Extract the spec from the request

From the user's request, determine:

- **displayName** — the text shown on the navbar button (e.g. "Intervals").
- **routeName** — kebab-case of displayName if not explicitly given (e.g. "Intervals" → `intervals`). No leading slash when deriving this.
- **pageContent** — what the page should actually contain/do.
- **piano params** (only if the page uses a piano) — the four `htmlGenPiano(startOctave, startOffset, endOctave, endIndex)` args. Default to `2,0,4,0` if the user doesn't specify a size. If the user gives a size in octaves (e.g. "three octaves"), compute it as:
  - `startOctave = 2`, `startOffset = 0` (unless the user specifies otherwise)
  - `endOctave = startOctave + N`, `endIndex = 0`, where N is the number of full octaves requested.
  - e.g. "three octaves" → `htmlGenPiano(2, 0, 5, 0)`. Reasoning: the generator fills octaves `startOctave..endOctave-1` completely and only partially includes `endOctave` up to (excluding) `endIndex`, so `endIndex = 0` means "stop cleanly at the octave boundary."
  - If the user wants a specific partial range instead (mirroring `/klavier`'s `2,0,5,11`), use their numbers directly.
- **piano purpose** (only if the page uses a piano) — is the piano for direct play (clicking/tapping a key plays its note, like `/klavier`), or is it the input surface for something else (a game/exercise that decides what pressing a key means, like `/intervalle`)? This determines how step 4 wires it up.

If anything essential is ambiguous (displayName, whether a piano is involved, or — if it is — what the piano is for), ask the user rather than guessing.

## 2. Add the navbar button — `src/index.html`

Add a new `<button class="navbar-button" onclick="routeFn('/routeName')">DisplayName</button>` inside the same `<div>` that holds the existing navbar buttons (Home, Play, Intervals, A, AA — right inside `<div id="rahmen">`). Keep the leading slash in `routeFn('/routeName')`: every route button other than Home (which special-cases `routeFn('..')`) passes its full leading-slash path, matching the `path` used in `routes.js` and the branch you'll add in `route-utils.js`.

## 3. Add the route content — `src/server/routes.js`

Add a new entry to the `frontendRoutes` array:

```js
{ path: "/routeName", content: <html string> },
```

This new entry **must be inserted before the `{ path: "/*", ... }` catch-all entry** — `main.js` registers routes in array order as separate Express `router.get` handlers, and Express matches the first one that fits, so `/*` has to stay last.

`content` must be a plain HTML string — no functions, no logic beyond simple composition (e.g. calling `htmlGenPiano(...)` and interpolating it into a template literal). Two cases:

- **Short content** (a few lines, maybe one `htmlGenPiano` call): inline it directly in `routes.js`, same style as the `/klavier` entry.
- **Longer/more complex content**: outsource it into a new `src/server/<xyz>Utils.js` file (mirror `interval-game.js`): export a single HTML string constant built from a template literal, import `htmlGenPiano` from `./pianoUtils.js` if a piano is needed, and import it into `routes.js`. If the page needs an HTML fragment written as its own `.html` file, import it via webpack's `asset/source` rule (see `interval-game.js`'s `import _intervalGameHtml from "./interval-game.html"` and the `interpolator` helper in `projectUtils.js`) — only do this if the existing pattern clearly fits, don't force it for simple pages.

If the page uses a piano, always generate it via `htmlGenPiano(startOctave, startOffset, endOctave, endIndex)` from `./pianoUtils.js` — never hand-roll piano key markup.

## 4. Wire up client-side behavior — `src/route-utils/route-utils.js`

Add a branch to `completeRouteLoad(path)`:

```js
} else if (path === "/routeName") {
  // wiring here
}
```

- If the page has a piano (content generated via `htmlGenPiano`), always call `pianoControlsRouteLoad()` in the new branch — it wires the zoom-in/out, scroll-left/right, and expand/collapse toolbar controls that `htmlGenPiano` always renders alongside the keys (`.piano-wrap`, `#piano-scroll`, `#piano-el`, etc.). Every piano route needs this call regardless of what the piano is for.
- If the piano is for direct play (pressing a key plays its note — the `/klavier` case), also call the existing `pianoRouteLoad()` function — don't duplicate its click/touch/keyboard → `window.playSound`/`triggerAttack`/`triggerRelease` wiring.
- If the piano drives something else (a game/exercise, like `/intervalle`'s `intervalGameRouteLoad()`), don't call `pianoRouteLoad()` — its listeners would fight with the custom ones. Instead define a new named function above `completeRouteLoad`, styled like `intervalGameRouteLoad`, that attaches its own listeners to the `.piano-key` elements and drives them through its own logic (calling `window.playSound` etc. as needed).
- If the page needs other interactivity unrelated to a piano, define a new named function above `completeRouteLoad`, styled like `pianoRouteLoad` (query the DOM for the injected fragment's elements, attach listeners, call into `window.*` music-util functions if sound is involved), and call it from the new branch.
- If the page is static with no interactivity, no branch is needed at all — skip this step.

## 5. Wrap up

Don't run a build or dev server unless asked — this repo has no watch mode; per `CLAUDE.md` the user runs `npm run build:main` (and restarts `start-server`) themselves to see changes. Summarize which files you touched/created and the exact route path + button label you added.

