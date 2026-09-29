# Pocket Links

A nine-hole golf game for the browser, built for iPad. It has real clubs, wind, lies, sloping greens and a three-tap swing meter that is hard to master. You can play alone, with two players on one iPad, or on two iPads over the internet.

No build step and no dependencies: plain HTML, CSS and JavaScript modules.

## How to play

- **Aim:** drag on the course. The dotted line and ring show where a full swing carries with no wind. The arrow buttons give fine aim.
- **Swing:** three taps on the meter.
  1. Tap to start.
  2. Tap to set power. The numbers are yards; past 100% is extra distance with a tighter timing window.
  3. Tap on the white line as the marker comes back. Early fades or slices right, late draws or hooks left. Miss badly and you shank or duff it.
- **Shot shape:** tap *Shot* to switch between Normal, **Punch** (flies about head high under the branches and runs out, for getting out of trees) and **High** (climbs over trouble, shorter and harder to time).
- **Side view:** when trees are near your line, a side-on view shows the flight at the power you're swinging, plus faint arcs at 100%, 75% and 50%. It says whether the shot clears, may clip a tree (amber) or hits one (red), and the aim line turns red too. Tap *Side* to keep it open.
- **Trees:** trunks stop low balls and canopies stop balls between the lowest branches and the treetop. A ball that only catches the edge of a canopy gets through about half the time.
- **Wind** (arrow at the top, and the flag) pushes the ball sideways and changes carry.
- **Lies:** rough, deep rough and bunkers cost distance and shrink the timing window. Only wedges play well from sand. The driver can only be hit from the tee or the fairway.
- **Putting:** on the green, the moving dashes flow downhill. Two taps: start, then set the pace (the meter shows feet). Use "Change range" for long putts.
- **Penalties:** water is one stroke and a drop behind the hazard. Out of bounds (past the white stakes) is one stroke and a replay from the same spot. A hole ends at par + 5.

## The course (par 36)

| # | Hole | Par | Notes |
|---|------|-----|-------|
| 1 | The Opener | 4 | Gentle start, bunker at driving distance |
| 2 | Carry the Pond | 3 | All carry over water |
| 3 | The Long Road | 5 | Dogleg left; trees guard the corner |
| 4 | Creek Crossing | 4 | A creek crosses right where a big drive lands |
| 5 | Fortress | 3 | Green ringed by four bunkers |
| 6 | The Chute | 4 | Narrow, tree-lined fairway |
| 7 | Lakeside | 5 | A lake runs down the left side |
| 8 | The Island | 3 | Island green |
| 9 | Homeward | 5 | Pond in front of the green |

Pin positions and wind change every game.

## Two players

- **One iPad:** take turns; the game asks you to pass the iPad when the player changes.
- **Two iPads:** one player taps *Create game* and reads out the 4-letter code; the other enters it and taps *Join game*. The iPads can be on different Wi-Fi networks or on mobile data; they just need internet. If an iPad reloads or drops out, tap *Rejoin online game* on the title screen.

Normal golf order applies: whoever is furthest from the hole plays next, and the lowest score on the last hole tees off first.

Online play relays small messages through free public MQTT servers (HiveMQ and EMQX, both at once for reliability) using a topic named after the game code. There's no account and no server of our own. Anyone who knew your code could see the shots, which is fine for a golf game.

## Putting it on your iPad

The game needs to be served over the web. GitHub Pages is free:

1. On GitHub, open this repo's **Settings → Pages**.
2. Under "Build and deployment", choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
3. After a minute the game is at `https://<your-username>.github.io/<repo-name>/`.
4. Open that link in Safari on each iPad and tap **Share → Add to Home Screen**. It then opens full screen like an app. Solo and same-iPad play also work offline after the first visit.

If there's no sound, check the iPad's silent switch or mode.

## Running it locally

```sh
npm start        # serves on http://localhost:8000 (uses python3)
npm test         # a bot plays every hole: checks the course is fair and shots are deterministic
```

Opening `index.html` straight from the file system won't work, because browsers block JavaScript modules on `file://` URLs. To test online play without the public servers, run any MQTT broker with WebSockets and add `?broker=ws://localhost:PORT` to the URL.

## Code layout

- `src/course.js`: the nine holes and terrain (fairway, rough, bunkers, water, trees, green slopes). No browser code.
- `src/sim.js`: clubs, ball flight, wind, spin, bounces, roll and putting. Deterministic, so both iPads replay a shot identically.
- `src/render.js`: draws the course, balls, flag and effects through a rotating, zooming camera.
- `src/game.js`: turns, the swing meter, scoring, menus and saving.
- `src/net.js`: the online link.
- `src/audio.js`: sound effects, generated in code.
- `src/vendor/mqtt.min.js`: [MQTT.js](https://github.com/mqttjs/MQTT.js) 5.16.0 (MIT licence, see `mqtt.LICENSE.md`).
- `test/play.mjs`: plays every hole with a bot.
