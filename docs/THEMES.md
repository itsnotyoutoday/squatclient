# Themes

The look of the whole window and of the game text is a **theme**: the 16 ANSI colours, default foreground and
background, cursor, selection, links, and the colours of the app's own panels. Three themes are built in
(**Dark**, **Light** and **High contrast**, which meets WCAG AAA for default text). Pick one in
**Settings → Theme**; it changes instantly, no restart.

Your own themes are files in the **themes folder** (shown in Settings): `<config dir>/themes/name.json`, or
`<config dir>/themes/name/theme.json`. The list updates within a second of saving a file, and a theme that is
not valid is skipped with a message naming the file.

```json
{
  "id": "night-owl", "name": "Night Owl", "kind": "dark",
  "fg": "#d6deeb", "bg": "#011627", "cursor": "#80a4c2", "selection": "#1d3b53", "link": "#82aaff",
  "ansi": ["#011627", "#ef5350", "#22da6e", "#addb67", "#82aaff", "#c792ea", "#21c7a8", "#d6deeb",
           "#575656", "#ef5350", "#22da6e", "#ffeb95", "#82aaff", "#c792ea", "#7fdbca", "#ffffff"],
  "chrome": { "panel": "#0b2942", "panelAlt": "#010e1a", "border": "#1d3b53", "text": "#d6deeb",
              "textDim": "#7e97ac", "accent": "#7e57c2", "accentText": "#ffffff",
              "danger": "#ef5350", "warn": "#ffcb8b", "ok": "#22da6e" }
}
```

A "minimum contrast" setting keeps text readable against any background a game chooses.

