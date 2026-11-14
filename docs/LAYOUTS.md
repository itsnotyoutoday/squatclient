# Layouts: GMCP panels and user-editable React layouts (design note)

Status: design only, nothing is built. Client side only: no change to the daemon, the wire protocol or the
TinyFugue/squatter work is needed to start. (An optional per-session GMCP snapshot in the squatterd, see
"Data", would make panels more robust after a long absence.)

## Idea

The window is a React app compiled into the binary. A **layout** is a short TSX file that arranges the app's
built-in components (the terminal output, the input line, gauges, lists, ...). The app's own default layout is
written in the same language, and users may copy it and edit their copy. A layout is chosen per world (or per
game type) and is compiled when it is selected, switched to or edited, so no rebuild of the app is needed.

```tsx
// the default layout: the app as it is now
export default function Layout() {
  return (
    <App>
      <Mush />
      <InputBar />
    </App>
  );
}
```

```tsx
// vitals in a right-hand dock, shown only when the game sends Char.Vitals
export default function Layout() {
  return (
    <App>
      <Row>
        <Mush />
        <Dock side="right" width={220}>
          <When gmcp="Char.Vitals">
            <Gauge label="HP" value={gmcp('Char.Vitals.hp')} max={gmcp('Char.Vitals.maxhp')} color="red" />
            <Gauge label="MP" value={gmcp('Char.Vitals.mp')} max={gmcp('Char.Vitals.maxmp')} color="blue" />
          </When>
        </Dock>
      </Row>
      <InputBar />
    </App>
  );
}
```

```
+-------------------------+-----------+
|                         | HP ▓▓▓▓░░ |
|  <Mush />               | MP ▓▓░░░░ |
+-------------------------+-----------+
| <InputBar />                        |
+-------------------------------------+
```

## The shell (not replaceable)

The tab bar, the status bar, the dialogs, the Object Editor view and the menus stay part of the app. A layout
only fills the area between. On load the shell checks that the layout contains exactly one `<Mush />` and one
`<InputBar />`; if it does not, if it fails to compile or if it throws, the shell shows the default layout and
a banner saying what went wrong. A bad layout can never stop the user typing or connecting.

## Components (the built-in vocabulary)

- Structure: `App`, `Row`, `Column`, `Box`, `Dock side=top|bottom|left|right|float`. A dock whose children
  all render nothing collapses (CSS `:empty`), so a panel appears only when it has something to show.
- Core: `Mush` (the output pane), `InputBar`.
- Display: `Gauge`, `Text`, `List`, `Table`, `Chat` (tabs for `Comm.Channel`), `RoomInfo`, `Exits`.
- Conditions: `When gmcp="Pkg"` (or `var="name"`), rendering its children once the data exists.
- Actions: `Button send="look"`, click-to-send on list items.
- Look: everything uses the active theme's colours (themes stay JSON, see below).

## Data

- A per-session **GMCP state store** keeps the latest value of each package with the right merging, rebuilt
  from the replayed GMCP entries when the client attaches. Hooks: `gmcp('Char.Vitals.hp')`,
  `useGmcpPackage('Room.Info')`. A `/gmcp` command and an inspector show what a game actually sends.
- Script variables: `useVar('hp')`. A Lua or TF trigger sets them (`squat.var.set`), so a game without GMCP can
  feed gauges too. Optional later: `squat.gauge.create{...}` for people used to Mudlet.
- Optional daemon addition: a per-session snapshot of the latest value of each GMCP package sent on attach, so
  a package that is sent rarely and has left the retained scrollback is still known.

## Layers

| Layer | Runs | For |
|---|---|---|
| Layout (TSX) | in the window | structure and UI logic: formatting, "red under 25%", collapsed panels |
| Lua / TF scripts | in the Go engine | game logic: triggers, aliases, timers; they work with no UI and later on the squatterd |
| GMCP and variables | engine, shared | the data both read |

Rule: anything that must keep working when the window is closed belongs in Lua or TF; the layout only draws
and offers controls.

## Lua (and TF) in the picture

Lua runs in the Go engine (gopher-lua, sandboxed, with budgets), the layout in the window; they meet in three
places and nothing else:

1. **Lua feeds the layout through variables.** `squat.var.set(name, value)` (numbers, strings, booleans,
   JSON-style tables; the store the engine already has) is read in a layout with `useVar('name')`. New: the
   engine sends the UI an event when a variable changes (batched), and variables can be scoped per world
   (`squat.var.set(name, value, world)`; the existing store is global, shared by all plugins).
2. **Lua normalises a game's data**, so one layout fits many games. A short per-game plugin maps whatever a
   game sends (`hp`/`maxhp`, `HP`/`MaxHP`, ...) into a standard shape (`vitals = {hp, maxhp, mp, maxmp}`) with
   `squat.on("gmcp", ...)`; games without GMCP fill the same variables from triggers on lines. Adapters
   should also update their variables from REPLAYED GMCP (`live=false`; state only, never sending), so panels
   are not blank after reattaching to a squatter.
3. **The layout calls back into Lua** in two ways. A `<Button send="look">` goes through the normal input
   pipeline, so Lua aliases and input handlers see it like typed text. For anything else a plugin registers a
   named handler, `squat.layout.handler("heal", fn)`, and the layout calls `callLua('heal', args)` and gets a
   JSON result; only registered handlers can be called.

```
game --GMCP--> engine --> Lua plugin --squat.var.set--> layout: useVar('vitals')
                  \--> GMCP state store ---------------> layout: gmcp('Char.Vitals.hp')
layout button --send / callLua--> input pipeline / Lua handler --> game
```

Rule: anything that must keep working with the window closed (and later on the squatterd) is Lua or TF; the
layout only draws and offers controls. Optional later, for people used to Mudlet: `squat.gauge.create{...}`
declares a gauge from a script, drawn by the built-in widgets. TF variables can feed `useVar` the same way.

## Themes stay data

A theme is JSON (colours, fonts) validated at load and applied as CSS variables, as today (`src/themes`).
Custom themes move from the browser's local storage to files in a user folder. Themes (the look) and layouts
(the structure) are separate files; a game profile may name one of each.

## Loading and compiling

1. Files live in a user folder (for example `~/.squatclient/layouts/`); the world settings choose one.
2. A Go call compiles the layout when it is selected or changed: esbuild as a library (MIT, GPL-compatible)
   bundles multi-file layouts and reports errors with line numbers. React and the `squat` layout API are
   provided to the code, not bundled into it.
   Layout files may be `.tsx`, `.jsx`, `.ts` or `.js`: plain JavaScript is valid (TSX is JavaScript plus
   JSX syntax and type annotations), so authors who do not want types can leave them out.
3. The window runs the result inside an error boundary; a file watcher recompiles on edit.
   Speed: compilation happens once, when a layout is selected or changed (milliseconds); the compiled
   output is cached by file contents, so an unchanged layout is not compiled again on the next start, and
   layouts shipped with the app are compiled at build time. At run time it is ordinary compiled JavaScript.
   Widgets subscribe only to the GMCP path or variable they show, so a `Char.Vitals` update that arrives
   several times a second redraws only the affected gauges, not the whole layout; updates are batched to one
   per animation frame.
4. The `squat` layout API is versioned and kept stable, because layouts depend on it.

## Safety

A layout is code running in the window with the app's full powers (it can send input to a game, read the
scrollback, change worlds). These are the user's own files, so that is accepted, with one guard: the first
time a layout file is loaded, and whenever its contents change, the app asks "this layout runs code, allow?".
Layouts shipped with the app skip the prompt. A sandboxed mode (a frame that can only read GMCP and line data
and cannot call the engine) is a possible later option and is also the route for a game's own rich UI
(`Cobra.UI.Open`, DESIGN.md section 9).

## Making it easy to edit

- Starter layouts ship with the app (classic, vitals on the right, vitals bar at the bottom, chat on the side)
  and a "copy to my layouts" button.
- The in-app code editor opens layout files with TSX highlighting; a type file for the components gives
  editors suggestions.
- Game-specific layouts keep their GMCP paths as constants at the top of the file.
- Layouts for specific games ship per game type (see the game-type detection and modules).

## Phases

1. GMCP state store, hooks, the built-in components and the shell; the default layout is written in this
   language and runs without the compile step.
2. The compile step, the user folder, the consent prompt, reload on edit.
3. Starter layouts and the editor integration.
4. Optional: a sandboxed mode; the daemon snapshot; `squat.gauge.create`.

## Open questions

- Which widgets first (suggested: Gauge, Text, List, Chat).
- Whether variables read by layouts are per world (suggested) or global.
- Whether the consent prompt is wanted for the user's own files.
- Whether the first shipped layout targets CobraMUSH or a common standard such as IRE-style `Char.Vitals`.
