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
  vote for the winner, and once you press Publish the display shows the winner
  as a unanimous or split decision, or a draw. The judges' average, rounded so the winner is always ahead,
  is the score to record (e.g. in Challonge); if rounding doesn't put the
  winner ahead, the loser is recorded one point below. Tied or split votes go
  to an untimed sudden death, and the Marshal's winner is entered at the table
- A Penalty button opens a sheet: pick the fighter, the card and a reason
  (intentional ring out is one of them), then give it. Two yellows make a red. A red takes a point and is
  the only thing that can take a score below zero. A black card forfeits the
  bout. Cards show beside the name and are cleared in Settings
- Time calls (beeps at 0:30 and 0:15, or 1:00 and 0:30 in Total Bout Time), a
  switch-sides call at half the winning score, a 3:00 medical hold and a
  no-show (0–10) from the Penalty sheet
- Total Bout Time match type, and an attempt clock for sudden deaths over 30s
- Matchups: make named groups (Pool A, Round 1, a series), enter matchups one by one (single elimination, Swiss, or any order) or add
  every pairing for a round robin, then fight them in order. The Next match
  button records the finished bout and loads the next fighters. Standings rank
  by wins, then the win between tied fighters, then points for, then fewest against, with a 60 second rest when a
  fighter goes back to back. Cards stay with the fighter from bout to bout
- Round wins shown as dots, with an optional "rounds to win the match"
- Undo for any scoring mistake (Z), with confirmations before resets
- Full history of every action, downloadable as CSV
- Spectator display (Display button or F) that stays in sync with the
  controls, for a second monitor or TV on the same computer
- Names, subtitles, seven colors, swap sides
- Beep and vibration at time up; keeps the screen awake while the clock runs

## How the TV display works today

The spectator display is a second window on the same computer. Open the scoreboard on a
laptop, press Display, and drag that window onto a TV connected as an extended screen. The
two windows stay in sync. On a phone, run the scoreboard by itself; a phone and a TV on
different devices do not sync yet.

## Possible future additions

- **Connect a phone to a TV.** The TV page shows a short code, the phone enters it, and the
  scores follow. It needs a small relay (for example a Cloudflare Worker) because a static
  page cannot message another device, and it would not work in the offline single file.
  Mirroring the screen was considered: it shows one screen only, so the controls would be
  on the TV too.
- **Challonge export.** Download or copy pool and group results, keyed to participants, then
  report results straight to Challonge through the same kind of relay.
- **Standings on their own screen** (a separate view, so the TV scoreboard stays clear).
- **Automatic single-elimination brackets** from a seeded list, with byes.
- **Fighter roster** remembered between events, with autofill in Matchups.
- **Referee notes** attached to a bout in the history.
- **Saved event setups**: a named set of match type, time and division loaded in one tap.
- **Screen-reader support**: announce scores and the clock, and label the plus and minus buttons.
- **Screen tests** that press the real buttons (score, undo, penalty, Next match).

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

## One file, no internet

`tsl-scoreboard.html` is the whole scoreboard in a single file, with the code, styles, fonts and logo inside it.
Send it to someone and they can double-click it to open it in their browser, with no internet and no install.
The spectator display (Display button) opens from the same file and stays in sync.
Browsers refuse to run the multi-file version from disk, so use this file for that.

It is generated. After changing anything under `css/`, `js/` or `assets/`, run `npm run build:single` and commit
the result; `npm test` fails if the file is out of date.

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
