# TSL Scoreboard

A scoreboard and timer for The Saber Legion bouts. It runs in any modern
browser, works offline once loaded, and can be added to a phone's home screen.

**Live: https://laudy32.github.io/tsl-scoreboard/**

Rebuilt from Guangcong Luo's original [saber-legion](https://github.com/Zarel/saber-legion) app.

## What it does

- Match types that load the rules in one tap: Standard (2:30, first to 10),
  2 Minute Standard (2:00, first to 10) and Unity (no live score; 1:00 for
  pools, 1:30 for single elimination and CS, 2:00 for CS only)
- A division header on the scoreboard and spectator display (Standard,
  Exotics, Unity, Tag Team, Redemption, Masters, Women's, Championship
  Series, or your own, which are remembered)
- Round timer (default 2:30), tap the clock or press Space to start and pause
- +1 / −1 for each fighter, and a simul counter: every simul from the 3rd on
  (configurable) takes a point from both fighters. In Tag Team a simul calls
  a fighter switch instead, and each team can take −1 to keep its fighter in
- The round ends when a fighter reaches the points target (10 by default) or
  time runs out. At 0:00 the table calls a Final Exchange: it ends on a point,
  a simul or No call (only a point if the scores are one apart), then the
  winner shows; a tie goes to a 30-second sudden-death tiebreaker
- Unity judges' tally: 2 or 3 line judges report to the table. Each judge is a
  vote for the winner and the display shows the votes (2–0 or 2–1) once you
  press Publish. The judges' average, rounded so the winner is always ahead,
  is the score to record (e.g. in Challonge); if rounding doesn't put the
  winner ahead, the loser is recorded one point below. Tied or split votes go
  to an untimed sudden death, and the Marshal's winner is entered at the table
- Round wins shown as dots, with an optional "rounds to win the match"
- Undo for any scoring mistake (Z), with confirmations before resets
- Full history of every action, downloadable as CSV
- Spectator display (Display button or F) that stays in sync with the
  controls, for a second monitor or TV on the same computer
- Names, subtitles, seven colors, swap sides
- Beep and vibration at time up; keeps the screen awake while the clock runs

## Keyboard

| Keys | Action |
| --- | --- |
| Q / A | +1 / −1 left fighter |
| W / S | +1 / −1 simul |
| E / D | +1 / −1 right fighter |
| Space | Start / pause (show or hide the winner once the bout is decided) |
| N | Next round or tiebreaker |
| Z | Undo |
| F | Open spectator display |

## Running locally

No build step. Serve the folder with any static server, for example:

    python3 -m http.server 8080

then open http://localhost:8080. (Opening `index.html` directly from disk
doesn't work, because browsers block JavaScript modules on `file://`.)

## Tests

    npm test

The scoring rules live in `js/state.js` and are covered by `test/state.test.js`.

## Hosting

The site is plain static files, so GitHub Pages works as is: Settings →
Pages → Deploy from a branch → `main`, folder `/ (root)`.
