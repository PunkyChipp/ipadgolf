# Pocket Links

A golf game for the browser, built for iPad, with five courses: Pocket Links, an 18-hole Augusta National, St Andrews, Pebble Beach and TPC Sawgrass. It has real clubs you can choose, wind, lies, sloping and tiered greens, a three-tap swing meter that is hard to master, and a short game where you pick the landing spot and see the roll-out. You can play alone, with up to 4 players on one iPad, or with up to 4 iPads over the internet.

No build step and no dependencies: plain HTML, CSS and JavaScript modules.

## How to play

- **Aim:** drag on the course to where you want the ball to land. The ring is the landing spot, with its yardage. The dotted trail after it shows the roll-out, ending where the ball should stop (no wind, pure strike). The arrow buttons give fine aim. The guide turns red if the shot finds trees, water or out of bounds.
- **Swing:** three taps on the meter.
  1. Tap to start.
  2. Tap on the **gold line** to hit your target distance. The numbers are yards; past 100% is extra distance with a tighter timing window.
  3. Tap on the white line as the marker comes back. Just early gives a gentle fade, just late a draw. Further off (the shaded zones) gives a slice or hook that can bend 20 to 40 yards. Only a really bad miss duffs or shanks it.
- **Chipping and pitching:** within 70 yards, *Shot* switches between Pitch, **Chip** (low, then rolls like a putt) and **Flop** (high and soft). The meter zooms in so the gold line sits about 70% along and is easy to hit. Club choice changes the roll: a lob wedge stops quickly and a 9 iron runs out. The roll-out trail shows which club gets it to the hole.
- **Putting:** the moving dashes flow downhill. The hint reads the putt (uphill or downhill by how many inches, and which way it breaks), and a yellow trail shows how the putt starts out. Two taps: start, then stop on the gold line for perfect pace (a foot past the hole). After a miss it says how far short or past you were. Use "Change range" for long putts.
- **Shot shape:** away from the green, *Shot* switches between Normal, **Punch** (flies under the branches and runs out) and **High** (climbs over trouble, shorter and harder to time).
- **Spin:** tap or drag on the little ball where you want to strike it. Low is backspin (stops fast; a wedge can zip back), high is topspin (lower flight, more roll), and left or right draws or fades the ball, with the aim guide bending to match. Double-tap the ball to clear it.
- **Your bag:** pick a driver, irons, wedges and ball on the title screen. Each is a trade-off between distance, forgiveness (the timing window) and spin and shaping:

  | Slot | Options |
  |------|---------|
  | Driver | Tour 9° (balanced), Bomber XL (+9% carry, tight window, big curves), Fairway Finder (shorter, very straight) |
  | Woods & irons | Cavity Backs (balanced), Tour Blades (more spin and shaping, tighter window), Game Improvement (+5% and forgiving, less spin) |
  | Wedges | All-Purpose, Spin Milled (huge backspin), High Bounce (forgiving from sand and rough) |
  | Ball | Tour (balanced), Distance (+4% and more roll, little spin), Spin (bites and curves, a little shorter) |

- **Side view:** when trees are near your line, a side-on view shows the flight at the power you're swinging, plus faint arcs at 100%, 75% and 50%. Tap *Side* to keep it open.
- **Trees:** trunks stop low balls and canopies stop balls between the lowest branches and the treetop. Augusta's tall pines have high branches, so a punch often runs under them.
- **Wind** (arrow at the top, and the flag) pushes the ball sideways and changes carry.
- **Lies:** rough, deep rough or pine straw, and bunkers cost distance and shrink the timing window. The driver can only be hit from the tee or the fairway.
- **Penalties:** water is one stroke and a drop behind the hazard. Out of bounds (past the white stakes) is one stroke and a replay from the same spot. A hole ends at par + 5.
- **Celebrations:** stick an approach close or hole a chip or a long putt and the gallery lets you know.
- **Timing difficulty:** *Timing* on the title screen switches between Casual, Standard and Pro. It sets the timing window and how much of each putt's path you see. Pro also hides the roll-out on long shots.
- **Zoom:** pinch the course, or use + and − on a keyboard.
- **Stats:** the final scorecard adds fairways hit, greens in regulation and putts. Best rounds are kept for each course and nine.

## Courses

Tap the course on the title screen to switch.

### Pocket Links (9 holes, par 36)

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

### Augusta National (18 holes, par 72)

Inspired by the Masters course, with yardages scaled to the game's clubs. Tall pines on beds of pine straw, white sand, azaleas, and very fast, tiered greens. Play all 18, the front nine or the back nine.

| # | Hole | Par | Notes |
|---|------|-----|-------|
| 1 | Tea Olive | 4 | Bunker right off the tee, false front |
| 2 | Pink Dogwood | 5 | Downhill dogleg left |
| 3 | Flowering Peach | 4 | Short, cluster of fairway bunkers |
| 4 | Flowering Crab Apple | 3 | Long par 3 |
| 5 | Magnolia | 4 | Deep bunkers on the corner |
| 6 | Juniper | 3 | Big plateau back right |
| 7 | Pampas | 4 | Narrow chute, five greenside bunkers |
| 8 | Yellow Jasmine | 5 | Mounds around the green, no bunkers |
| 9 | Carolina Cherry | 4 | Dogleg left, false front |
| 10 | Camellia | 4 | Sweeping dogleg left |
| 11 | White Dogwood | 4 | Pond left of the green |
| 12 | Golden Bell | 3 | Rae's Creek in front of a shallow green |
| 13 | Azalea | 5 | Creek along the left and in front of the green |
| 14 | Chinese Fir | 4 | No bunkers, wild green |
| 15 | Firethorn | 5 | Pond in front of the green |
| 16 | Redbud | 3 | Water all down the left |
| 17 | Nandina | 4 | Bunkers short of the green |
| 18 | Holly | 4 | Uphill through a chute of trees |

### St Andrews (9 holes, par 37)

Nine famous holes of the Old Course: Burn, Dyke, Hole O'Cross, High, Heathery, Long (with Hell bunker), Corner of the Dyke, Road and Tom Morris (Valley of Sin, Swilcan Bridge). No trees, just gorse, huge greens, deep pot bunkers, firm fairways that let the ball run, and half as much wind again.

### Pebble Beach (9 holes, par 35)

Clifftop holes beside the Pacific: Stillwater Cove, Ocean Rise, The Hill, The Little Seventh (a wedge to a green surrounded by sea), The Chasm, Carmel Bay, Cliff Edge, Hourglass and The Cypress Finish, with the ocean down the left. Windier than inland courses.

### TPC Sawgrass (9 holes, par 36)

Stadium golf with water on nearly every hole, sandy waste areas and palms: Lagoon, Waste Area, Long Iron, Long Ninth, Risk and Reward, Pond Thirteen, Sixteen, Island Green and The Finisher.

Pin positions and wind change every game.

## Playing together

- **One iPad, up to 4 players:** *Pass and play* takes turns; the game asks you to pass the iPad when the player changes.
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

## Releasing an update

Every file the game loads carries a version stamp (`?v=8`). Before publishing changes, run `npm run bump`. That raises the stamp everywhere and in `version.json`, so iPads can never mix new and old files. An open copy of the game also notices the new `version.json` and reloads itself the next time it is on the title screen.

## Running it locally

```sh
npm start        # serves on http://localhost:8000 (uses python3)
npm test         # a bot plays every hole of every course: checks they're fair and shots are deterministic
```

Opening `index.html` straight from the file system won't work, because browsers block JavaScript modules on `file://` URLs. To test online play without the public servers, run any MQTT broker with WebSockets and add `?broker=ws://localhost:PORT` to the URL.

## Code layout

- `src/course.js`: the courses, holes and terrain (fairway, rough, bunkers, water, trees, green slopes and tiers). No browser code.
- `src/sim.js`: clubs, equipment, ball flight, wind, spin, bounces, roll and putting. Deterministic, so every iPad replays a shot identically.
- `src/render.js`: draws the course, balls, flag and effects through a rotating, zooming camera.
- `src/game.js`: turns, the swing meter, scoring, menus and saving.
- `src/net.js`: the online link.
- `src/audio.js`: sound effects, generated in code.
- `src/vendor/mqtt.min.js`: [MQTT.js](https://github.com/mqttjs/MQTT.js) 5.16.0 (MIT licence, see `mqtt.LICENSE.md`).
- `test/play.mjs`: plays every hole with a bot.
