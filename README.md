# Pocket Links

A nine-hole golf game for the browser, built for iPad. It has real clubs, wind, lies, sloping greens and a three-tap swing meter that is hard to master. You can play alone, with two players on one iPad, or on two iPads over the internet.

No build step and no dependencies: plain HTML, CSS and JavaScript modules.

## How to play

- **Aim:** drag on the course. The dotted line and ring show where a full swing carries with no wind. The arrow buttons give fine aim.
- **Swing:** three taps on the meter.
  1. Tap to start.
  2. Tap to set power. The numbers are yards; past 100% is extra distance with a tighter timing window.
  3. Tap on the white line as the marker comes back. Just early gives a gentle fade, just late a draw. Further off (the shaded zones) gives a slice or hook that can bend 20 to 40 yards. Only a really bad miss duffs or shanks it.
- **Timing difficulty:** *Timing* on the title screen switches between Casual (a wider window), Standard and Pro.
- **Shot shape:** tap *Shot* to switch between Normal, **Punch** (flies about head high under the branches and runs out, for getting out of trees) and **High** (climbs over trouble, shorter and harder to time).
- **Spin:** tap or drag on the little ball where you want to strike it. Low is backspin (stops fast; a wedge onto a green can zip back), high is topspin (lower flight, more roll), and left or right draws or fades the ball on purpose (a full side strike bends a mid iron about 25 yards), with the aim line bending to match. Spin narrows the timing window slightly. Double-tap the ball to clear it.
- **Side view:** when trees are near your line, a side-on view shows the flight at the power you're swinging, plus faint arcs at 100%, 75% and 50%. It says whether the shot clears, may clip a tree (amber) or hits one (red), and the aim line turns red too. Tap *Side* to keep it open.
- **Trees:** trunks stop low balls and canopies stop balls between the lowest branches and the treetop. A ball that only catches the edge of a canopy gets through about half the time.
- **Wind** (arrow at the top, and the flag) pushes the ball sideways and changes carry.
- **Lies:** rough, deep rough and bunkers cost distance and shrink the timing window. Only wedges play well from sand. The driver can only be hit from the tee or the fairway.
- **Putting:** on the green, the moving dashes flow downhill. Two taps: start, then set the pace (the meter shows feet). Use "Change range" for long putts.
- **Zoom:** pinch the course, or use + and − on a keyboard.
- **Stats:** the final scorecard adds fairways hit, greens in regulation and putts.
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

## Playing together

- **One iPad, two players:** take turns; the game asks you to pass the iPad when the player changes.
- **Online, up to 4 players:** one player taps *Create game* and reads out the 4-letter code. Everyone else enters it and taps *Join game*, and the host taps *Start game* once everyone's name shows in the lobby. The iPads can be on different Wi-Fi networks or on mobile data; they just need internet. If an iPad reloads or drops out, tap *Rejoin online game* on the title screen and it gets its seat back.

The host picks how online games run:

- **Same time** (default): everyone plays their own ball without waiting. You see the other players' shots as they happen, and the next hole starts when you've all holed out.
- **Take turns:** normal golf order. Everyone tees off in honour order (lowest score on the last hole first), then whoever is furthest from the hole plays.

Every few seconds the iPads compare how many shots each player has taken. If one missed a shot (say, because it slept for a moment), it fetches the latest state from the others, so nobody gets stuck waiting.

If an iPad says another player has a different version, everyone should close the game fully (swipe it away in the app switcher) and reopen it, then start a new game. This happens when one iPad still has an older copy of the game open.

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
