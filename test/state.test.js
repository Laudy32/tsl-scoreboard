import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, initialState, timeLeft, parseClock, formatClock, matchWinner, normalize } from '../js/state.js';

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
	assert.equal(timeLeft(s(), 1_060_000), 4 * 60_000);
	store.pause();
	advance(10_000);
	assert.equal(s().remaining, 4 * 60_000);
	store.start();
	advance(5 * 60_000);
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
	assert.equal(timeLeft(s(), 1_020_000), 5 * 60_000 - 20_000);
	assert.equal(s().log.length, 0);
});

test('undo of a time change restores the old time', () => {
	const { store, s } = setup();
	store.setTime(90_000);
	store.undo();
	assert.equal(s().remaining, 5 * 60_000);
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
	assert.equal(s().remaining, 5 * 60_000 - 1000);
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
