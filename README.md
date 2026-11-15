# GeoFS Exterior Lights — add-on

Adds nine switchable light systems to GeoFS, drawn on the aircraft wherever it flies:

| # | Group | What you see |
|---|---|---|
| 1 | **Nav lights** | red on the left wingtip, green on the right, white on the tail — steady |
| 2 | **Beacon lights** | red anti-collision, upper and lower fuselage — flashing |
| 3 | **Strobe lights** | brilliant white double-flash on both wingtips and the tail |
| 4 | **Landing lights** | nose gear + both wing roots, long throw (gear down only) |
| 5 | **Taxi light** | nose gear, wide and soft (gear down only) |
| 6 | **Runway turnoff lights** | two lamps angled 55° outboard off the nose gear |
| 7 | **Ice lights** | warm-white on the wing leading edges |
| 8 | **Logo lights** | two lamps on the tail fin (gear down only) |
| 9 | **Emergency exit lights** | green escape-path lights over the exits |

Every group has its own ON/OFF switch, plus **All on**, **All off**, **Cold & dark** and
**Takeoff set** presets. Your switch positions are remembered between sessions.

## Install (pick one)

**Tampermonkey — recommended**
1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Dashboard → **+** → paste the whole of `geofs-lights.user.js` → **Save**.
3. Open GeoFS and reload once.

**Console — no install**
1. Open GeoFS, press `F12`, go to **Console**.
2. Paste the whole of `geofs-lights.js` and press Enter.

**Bookmarklet**
Put the line in `bookmarklet.txt` as a bookmark's URL, then click it on the GeoFS tab.
It loads the add-on from a CDN copy — edit `build.mjs` with your own GitHub repo, rebuild,
and it points at your file.

## Using it

- **F7** or the **LIGHTS** button in GeoFS's bottom toolbar opens the panel.
- **Keys 1–9** toggle the nine groups without opening the panel.
- The LIGHTS button turns green when any light is on; the panel footer shows how many
  lights are currently visible and warns when gear-up has hidden the gear lights.
- From the console: `GeoFSLights.all(true)`, `GeoFSLights.preset('takeoff')`,
  `GeoFSLights.on('strobe')`, `GeoFSLights.state()`.

## How it works

- The lights are Cesium `PointPrimitive`s added to GeoFS's own viewer
  (`geofs.api.viewer.scene.primitives`), so they render in the 3D scene and stay attached to
  the aircraft at any altitude or camera angle.
- Each light has a position in aircraft body axes (forward / right / up, in metres, scaled
  to the aircraft's mass), converted to lat/lon/height every frame from
  `geofs.aircraft.instance.llaLocation` and `geofs.animation.values.heading360`.
- Landing, taxi, turnoff and logo lights follow the gear state
  (`geofs.animation.values.gearPosition`) and go out when the gear is up.
- Strobe double-flashes (~1 Hz) and the beacon pulses, as on the real aircraft.
- The add-on only reads the sim; it never touches the flight model.

## Files

- `geofs-lights.js` — the add-on, readable and commented.
- `geofs-lights.user.js` — same code with the Tampermonkey header.
- `bookmarklet.txt` — one-line loader.
- `build.mjs` — regenerates the userscript and bookmarklet after an edit.

## Tuning

Every light is one line in the `LIGHTS` array at the top of `geofs-lights.js`:

```js
{ id: 'nav-left', group: 'nav', mode: 'steady', color: [255,30,30], size: 7,
  fwd: 0.2, side: -1.00, up: 0.05, label: 'Nav — left wing (red)' }
```

`fwd` / `side` / `up` are metres × 12 × the aircraft scale (roughly: 1.0 = one half-span),
`size` is the on-screen dot size in pixels, `yaw` angles a lamp outward, `gear: true` hides
it when the gear is up. Add a row to `LIGHTS` and a matching entry to `GROUPS` and you have
a tenth switch.

## Tested so far

Logic verified headlessly against a mocked Cesium and a mocked `geofs` object: all 22 light
points are created, all 22 can be seen flashing with everything on, gear-up hides the eight
gear-dependent lights, the heading→position maths puts the red light left and the green right
at every heading, and the state persists. Rendering inside the live sim still needs a
first-flight check on your side.
