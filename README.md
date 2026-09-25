# Pocket Putt

A 9-hole mini golf game for the browser, built for iPad touch screens. No build step and no dependencies: plain HTML, CSS and JavaScript modules.

## How to play

- Touch anywhere on the screen and **pull back**. The dotted line shows where the ball will go, including one bounce off a wall.
- Pull further for more power, then let go to putt. Let go near where you started to cancel.
- Water costs a stroke and puts the ball back where you hit it from. After 10 strokes the hole ends.

## The holes

| # | Hole | Par | What's on it |
|---|------|-----|--------------|
| 1 | Opening Drive | 2 | A straight warm-up |
| 2 | Dogleg Right | 3 | Bank it round the corner |
| 3 | Bunker Hill | 3 | Sand traps and a block in the middle |
| 4 | The Windmill | 3 | Time your shot through the spinning blades |
| 5 | Lake Crossing | 3 | A narrow diagonal bridge over water |
| 6 | Pinball Wizard | 3 | Bumpers that fire the ball back out |
| 7 | The Volcano | 3 | The hole sits on top of a hill |
| 8 | Wormhole | 2 | Portals and a sliding block |
| 9 | Grand Finale | 4 | A bit of everything |

## Putting it on your iPad

The game needs to be served over the web. The simplest free option is GitHub Pages:

1. On GitHub, open this repo's **Settings → Pages**.
2. Under "Build and deployment", choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
3. After a minute the game is live at `https://<your-username>.github.io/<repo-name>/`.
4. Open that link in Safari on the iPad, tap **Share → Add to Home Screen**. It then opens full screen like an app and keeps working offline.

If there's no sound, check the iPad's silent mode is off.

## Running it locally

```sh
npm start        # serves on http://localhost:8000 (uses python3)
npm test         # checks every hole can be finished at or under par
```

Opening `index.html` directly from the file system won't work, because browsers block JavaScript modules on `file://` URLs.

## Code layout

- `src/physics.js` – ball movement, collisions, hazards. No browser code, so the tests can run it in Node.
- `src/levels.js` – the hole layouts and colour themes. Add a hole by adding an entry to `LEVELS`.
- `src/game.js` – drawing, touch controls, scoring and menus.
- `src/audio.js` – sound effects, generated in code (no audio files).
- `test/solve.mjs` – tries thousands of shots on each hole to prove it can be finished within par.
