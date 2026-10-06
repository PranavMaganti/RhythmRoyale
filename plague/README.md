# Contagion

A pandemic strategy game that runs in a browser. Start with one carrier
somewhere in the world, spend research points on how your strain spreads, what
it does to the people carrying it and what it shrugs off, and try to reach
everyone before the labs finish a cure.

No build step, no dependencies, no server. It is a handful of static files; open
`index.html` from any web server and it runs.

## Playing

- **Pick a start.** Tap a region. A dense, well-connected country spreads fast
  but gets noticed fast. A quiet corner buys you time and may strand you there.
- **Collect research.** Points build up as the outbreak spreads and as it
  alarms people. Orange bubbles appear where it reaches somewhere new; tap them
  before they fade.
- **Evolve.** *Spread* moves you between regions, *Traits* raise alarm and
  deaths, *Shielding* keeps you alive in hostile climates and slows the cure.
  Anything with nothing depending on it can be undone for a surcharge.
- **Stay quiet, then don't.** Severity is what pays for research and what kills,
  but it is also what closes airports and funds laboratories. The usual way to
  lose is to turn lethal before you are everywhere.

Pinch or scroll to zoom, drag to pan, arrow keys work too. The game saves itself
in your browser after every few days, so closing the tab is safe.

## The world

44 regions, rasterised from Natural Earth 1:50m country shapes into a 240 × 92
grid of 1.5° cells (`map-data.js`). Only genuine land borders are adjacent —
every sea crossing has to go by air or by water, which is why islands close
early and stay shut. Each region carries its own population, wealth, climate,
urbanisation and travel links, and those decide how well a given strain does
there.

## Files

| File | What it holds |
| --- | --- |
| `map-data.js` | The dot grid and the land-border list, generated from Natural Earth |
| `data.js` | Region statistics, the evolution tree, strains and difficulties |
| `sim.js` | One day per step: spread, travel, detection, closures, the cure |
| `render.js` | Canvas dot map: pan, pinch-zoom, hit testing, bubbles |
| `panels.js` | Evolution tree, world report, end screen |
| `ui.js` | Screens, HUD, the day loop, saving |
| `sw.js` | Caches everything so it plays offline after the first visit |

## Running it

```sh
python3 -m http.server 8000   # or any static server
open http://localhost:8000
```

It installs to a phone home screen from the browser's share menu, and plays
offline after the first load.

## Credits

Country shapes from [Natural Earth](https://www.naturalearthdata.com/), public
domain, by way of [world-atlas](https://github.com/topojson/world-atlas). Owes
its shape to Ndemic Creations' *Plague Inc.*, which is a much bigger game.
