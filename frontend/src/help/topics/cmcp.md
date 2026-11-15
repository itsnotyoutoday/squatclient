---
title: CMCP consoles and sound
order: 11
keywords: cmcp, cobra, console, consoles, protocol, theme, themes, sound, audio, packs, alert, red alert, shake, ship, bridge, screens, room, away team, mute, sound folder, era
aliases: cmcp, cobra, console, consoles, ship console, sound, sounds, audio, interface pack, interface packs
---

**CMCP** (the Cobra console protocol) lets a game send SquatClient the *data* of its interface, not a picture of it. A game that speaks CMCP gets real consoles in your window: gauges, a radar, a damage-control schematic, buttons that send the game's own commands, a ship-wide red alert, and sound. The game is still a text game: the text pane and your input line are never covered, and a game that does not speak CMCP is unaffected.

## Turning it on

**Settings > Game consoles (CMCP) and sound.** *Let games draw their consoles* is on by default. SquatClient tells the game it can do CMCP when it connects; the game answers if it has consoles. Nothing happens in worlds that do not.

Try it on the alpha test game, **CMCPTest**, in your world list: connect, create a throwaway account, then type `man tac` (take the tactical console), `man helm`, `man eng` and so on. `unman` gives the console back. `simulatehit` makes your ship take a hit so you can see the shake.

## What you see

- **Screens drawn from the game's data.** Each console has a screen (sensors, power, tactical, damage control, operations...). Buttons send the game's real commands and the game shows you what they typed (`cmcp> dmg assign 3=Port_Nacelle`).
- **A screen for more than a console.** Rooms of a ship, the turbolift, an away team, an event or a docking can have their own screen too (*Settings > also draw screens for rooms*; by default only a console you man gets one).
- **The screen menu** switches between the screens you may use; consoles you could man are listed with how (`man <console> to use`). **SCREEN OFF** hides the screen and gives the window back to the text; **LOG** expands the text beside it. **X** asks the game to close the current context; the game decides.
- **Alerts.** On red or yellow alert the whole look recolours, pulses and glows on every screen aboard; a hit shakes the display. Each can be set to *follow the theme*, *on* or *off*, and **Calm motion** slows everything down.
- **Themes.** Seven built-in looks (tng, soft, klingon, romulan, tos, ferengi, ops). By default the display follows what the ship or console suggests; choose *fixed* to keep one. A game can also send a whole theme as data (colours, frames, widget skins, motion).
- **Interface packs.** A game announces its screens, themes and sound packs. SquatClient fetches them (inline from the game, or from the https address the game announced), checks their hash, caches them and applies them. *Settings > Interface packs from games*: **always** (default), **ask** (a question the first time) or **never**. A pack is data: it cannot run code.
- **The notice line** shows what is being downloaded, what was accepted and which theme is in use.

## Sound

CMCP sends sound *events* (`red_alert`, `phaser_fire`, `hail_incoming`...), not audio files. SquatClient plays each one by the first of these that exists:

1. a file from **your own sound folder** (*Settings > Local sound folder*; it is only ever read, never copied, listed to the game or uploaded). An era map in `era-maps/` says which file plays for which event; the *Sound era* setting picks the set;
2. a sample from the game's sound pack;
3. a synthesised recipe from the pack;
4. the bell; otherwise silence.

Loops (an alert, an engine hum) keep going where they should and resume when you return to the tab or unmute. Only the tab in front is heard. **Mute** this world with the speaker beside "Connected"; **mute everything** with the speaker at the top right (Alt+Shift+M). Settings has the volume, a volume per category (alert, weapon, impact, ambient, ui) and **Test sound**.

## When something is silent or missing

**Help > Send Diagnostics Log...** records every decision (what the game sent, which sound was chosen and why one was dropped, which packs were fetched). See [Sending a diagnostics log](help:diagnostics-log). *Settings > Game consoles* also shows the build, the theme in use and sound diagnostics.

See also [Graphics and consoles](help:graphics), [Layouts](help:layouts) and [Scripting graphics](help:scripting-graphics).
