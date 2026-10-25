import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	Store, initialState, DEFAULT_SETTINGS, timeLeft, parseClock, formatClock, matchWinner, normalize,
	activePreset, describeEvent, usesRounds,
} from '../js/state.js';

const D = DEFAULT_SETTINGS.duration;

function setup(settings = {}) {
	let now = 1_000_000;
	const s = initialState();
	Object.assign(s.settings, settings);
	s.remaining = s.settings.duration;
	const store = new Store(s, { now: () => now });
	return { store, s: () => store.state, advance: ms => { now += ms; } };
}

test('clock runs, pauses and expires', () => {
	const { store, s, advance } = setup();
	store.start();
	advance(60_000);
	assert.equal(timeLeft(s(), 1_060_000), D - 60_000);
	store.pause();
	advance(10_000);
	assert.equal(s().remaining, D - 60_000);
	store.start();
	advance(D);
	assert.equal(store.expire(), true);
	assert.equal(s().remaining, 0);
	assert.equal(s().startedAt, null);
});

test('simul penalty starts at the cutoff and undoes cleanly', () => {
	const { store, s } = setup({ simulCutoff: 3 });
	store.addPoint(0); store.addPoint(0); store.addPoint(1);
	store.addSimul(); store.addSimul();
	assert.deepEqual(s().fighters.map(f => f.score), [2, 1]);
	store.addSimul();
	assert.deepEqual(s().fighters.map(f => f.score), [1, 0]);
	store.addSimul(-1);
	assert.deepEqual(s().fighters.map(f => f.score), [2, 1]);
	assert.equal(s().simul, 2);
	store.addSimul(-1); store.addSimul(-1);
	assert.equal(store.addSimul(-1), false, 'cannot go below zero simuls');
});

test('scores never go below zero', () => {
	const { store, s } = setup({ simulCutoff: 1 });
	assert.equal(store.addPoint(0, -1), false);
	assert.equal(s().fighters[0].score, 0);
	store.addPoint(1); store.addPoint(1);
	store.addSimul();
	assert.deepEqual(s().fighters.map(f => f.score), [0, 2], 'no penalty while either fighter is at zero');
	store.addPoint(0);
	store.addSimul();
	assert.deepEqual(s().fighters.map(f => f.score), [0, 1], 'penalty resumes once both have points');
	store.addSimul();
	assert.deepEqual(s().fighters.map(f => f.score), [0, 1]);
	store.addSimul(-1); store.addSimul(-1); store.addSimul(-1);
	assert.deepEqual(s().fighters.map(f => f.score), [1, 2], 'removing simuls gives back exactly what they took');
});

test('tie goes to sudden death, next point ends it', () => {
	const { store, s } = setup();
	store.addPoint(0); store.addPoint(1);
	store.endRoundNow();
	assert.equal(store.nextRoundAction(), 'tiebreaker');
	store.nextRound();
	assert.equal(s().suddenDeath, true);
	assert.equal(s().remaining, 30_000);
	store.start();
	store.addPoint(1);
	assert.equal(timeLeft(s()), 0);
	assert.equal(s().showWinner, true);
	store.nextRound();
	assert.equal(s().round, 2);
	assert.equal(s().fighters[1].wins, 1);
	assert.equal(s().suddenDeath, false);
	assert.equal(s().rounds[0].suddenDeath, true);
});

test('play-to ends the match', () => {
	const { store, s } = setup({ playTo: 2 });
	for (let r = 0; r < 2; r++) {
		store.addPoint(0);
		store.endRoundNow();
		store.nextRound();
	}
	assert.equal(matchWinner(s()), 0);
	assert.equal(store.nextRoundAction(), null);
	assert.equal(s().rounds.length, 2);
});

test('undo of a point keeps the running clock going', () => {
	const { store, s, advance } = setup();
	store.start();
	advance(10_000);
	store.addPoint(0);
	advance(10_000);
	store.undo();
	assert.equal(s().fighters[0].score, 0);
	assert.equal(timeLeft(s(), 1_020_000), D - 20_000);
	assert.equal(s().log.length, 0);
});

test('undo of a time change restores the old time', () => {
	const { store, s } = setup();
	store.setTime(90_000);
	store.undo();
	assert.equal(s().remaining, D);
});

test('undo of next round restores the finished round', () => {
	const { store, s } = setup();
	store.addPoint(1);
	store.endRoundNow();
	store.nextRound();
	store.undo();
	assert.equal(s().round, 1);
	assert.equal(s().fighters[1].score, 1);
	assert.equal(s().fighters[1].wins, 0);
});

test('swap sides moves names, scores and history', () => {
	const { store, s } = setup();
	store.updateFighter(0, { name: 'Ana' });
	store.addPoint(0);
	store.swapSides();
	assert.equal(s().fighters[1].name, 'Ana');
	assert.equal(s().fighters[1].score, 1);
	assert.equal(s().log[0].side, 1);
	assert.deepEqual(s().log[0].scores, [0, 1]);
});

test('default name follows color', () => {
	const { store, s } = setup();
	store.updateFighter(0, { color: 'green' });
	assert.equal(s().fighters[0].name, 'Green');
	store.updateFighter(0, { name: 'Ana' });
	store.updateFighter(0, { color: 'gold' });
	assert.equal(s().fighters[0].name, 'Ana');
});

test('changing round length applies before the round starts', () => {
	const { store, s } = setup();
	store.updateSettings({ duration: 180_000 });
	assert.equal(s().remaining, 180_000);
	store.addPoint(0);
	store.updateSettings({ duration: 120_000 });
	assert.equal(s().remaining, 180_000);
});

test('pause after scoring', () => {
	const { store, s, advance } = setup({ pauseAfterScoring: true });
	store.start();
	advance(1000);
	store.addPoint(0);
	assert.equal(s().startedAt, null);
	assert.equal(s().remaining, D - 1000);
});

test('clock parsing and formatting', () => {
	assert.equal(parseClock('3:00'), 180_000);
	assert.equal(parseClock('45'), 45_000);
	assert.equal(parseClock('1:02.5'), 62_500);
	assert.equal(parseClock('abc'), null);
	assert.equal(formatClock(62_345), '1:02.34');
	assert.equal(formatClock(62_345, { hundredths: false }), '1:02');
});

test('normalize ignores old-format saves', () => {
	assert.equal(normalize({ score1: 3 }).version, 2);
	assert.equal(normalize({ version: 2, settings: { duration: 1000 } }).settings.simulCutoff, 3);
});

test('reaching the points target ends the round', () => {
	const { store, s, advance } = setup({ pointsToWin: 3 });
	store.start();
	advance(20_000);
	store.addPoint(1); store.addPoint(1); store.addPoint(0);
	assert.equal(timeLeft(s(), store.now()), D - 20_000);
	store.addPoint(1);
	assert.equal(timeLeft(s()), 0);
	assert.equal(s().startedAt, null);
	assert.equal(s().showWinner, true);
	assert.equal(describeEvent(s(), s().log.at(-1)), 'Red reached 3');
	assert.equal(store.nextRoundAction(), 'next');
	store.nextRound();
	assert.equal(s().fighters[1].wins, 1);
	assert.equal(s().remaining, D);
});

test('undoing the winning point gives the clock back, paused', () => {
	const { store, s, advance } = setup({ pointsToWin: 2 });
	store.start();
	advance(30_000);
	store.addPoint(0); store.addPoint(0);
	advance(5_000);
	store.undo();
	assert.equal(s().fighters[0].score, 1);
	assert.equal(s().startedAt, null);
	assert.equal(s().remaining, D - 30_000);
	assert.equal(s().stoppedAtTarget, null);
});

test('no points target means only the clock ends the round', () => {
	const { store, s } = setup({ pointsToWin: 0 });
	for (let i = 0; i < 15; i++) store.addPoint(0);
	assert.equal(timeLeft(s()), D);
});

test('presets load their rules and are recognized', () => {
	const { store, s } = setup();
	assert.equal(activePreset(s().settings).id, 'standard');
	store.applyPreset('two-minute');
	assert.equal(s().settings.duration, 120_000);
	assert.equal(s().remaining, 120_000, 'applies right away before the round starts');
	assert.equal(s().settings.pointsToWin, 10);
	store.applyPreset('unity');
	assert.equal(s().remaining, 60_000);
	assert.equal(activePreset(s().settings).id, 'unity');
	store.updateSettings({ duration: 90_000 });
	assert.equal(activePreset(s().settings), null, 'edited rules no longer match a preset');
	assert.equal(store.applyPreset('nope'), false);
});

test('without a live score, scoring is off and rounds just move on', () => {
	const { store, s } = setup();
	store.applyPreset('unity');
	assert.equal(store.addPoint(0), false);
	assert.equal(store.addSimul(), false);
	assert.equal(store.nextRoundAction(), null);
	store.endRoundNow();
	assert.equal(store.nextRoundAction(), 'next');
	store.nextRound();
	assert.equal(s().round, 2);
	assert.equal(s().rounds[0].winner, null);
	assert.equal(s().remaining, 60_000);
});

test('divisions: pick one, add custom ones once, remove them', () => {
	const { store, s } = setup();
	store.setDivision('Masters');
	assert.equal(s().settings.division, 'Masters');
	store.addCustomDivision('  Youth   Open ');
	assert.equal(s().settings.division, 'Youth Open');
	store.addCustomDivision('youth open');
	store.addCustomDivision('exotics');
	assert.deepEqual(s().settings.customDivisions, ['Youth Open'], 'no duplicates, built-ins not copied');
	assert.equal(s().settings.division, 'Exotics');
	assert.equal(store.addCustomDivision('   '), false);
	store.setDivision('Youth Open');
	store.removeCustomDivision('Youth Open');
	assert.deepEqual(s().settings.customDivisions, []);
	assert.equal(s().settings.division, '');
});

test('division and custom divisions survive new matches and undo', () => {
	const { store, s } = setup();
	store.addPoint(0);
	store.addCustomDivision('Youth Open');
	store.undo();
	assert.equal(s().fighters[0].score, 0);
	assert.equal(s().settings.division, 'Youth Open');
	store.newMatch({ full: true });
	assert.deepEqual(s().settings.customDivisions, ['Youth Open']);
	assert.equal(s().settings.division, 'Youth Open');
});

test('older saves pick up the new settings', () => {
	const st = normalize({ version: 2, settings: { duration: 150_000 } });
	assert.equal(st.settings.pointsToWin, 10);
	assert.equal(st.settings.liveScore, true);
	assert.deepEqual(st.settings.customDivisions, []);
	assert.equal(st.stoppedAtTarget, null);
});

test('rounds only apply to Championship Series, which defaults to best of 3', () => {
	const { store, s } = setup();
	assert.equal(usesRounds(s()), false);
	store.setDivision('Masters');
	assert.equal(usesRounds(s()), false);
	assert.equal(s().settings.playTo, 0);
	store.setDivision('Championship Series');
	assert.equal(usesRounds(s()), true);
	assert.equal(s().settings.playTo, 2);
	store.setDivision('Exotics');
	assert.equal(s().settings.playTo, 0, 'leaving CS clears the best-of-3 default');
	store.setDivision('Championship Series');
	store.updateSettings({ playTo: 3 });
	store.setDivision('Masters');
	assert.equal(s().settings.playTo, 3, 'a hand-set value is kept');
});

test('best of 3 ends after two round wins', () => {
	const { store, s } = setup();
	store.setDivision('Championship Series');
	store.addPoint(0); store.endRoundNow(); store.nextRound();
	assert.equal(matchWinner(s()), null);
	store.addPoint(1); store.endRoundNow(); store.nextRound();
	store.addPoint(0); store.endRoundNow(); store.nextRound();
	assert.equal(matchWinner(s()), 0);
});
