import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	Store, initialState, DEFAULT_SETTINGS, timeLeft, parseClock, formatClock, matchWinner, normalize,
	activePreset, describeEvent, usesRounds, presetNote, tallyResult, recordScores, decisionOf, leader, isUntimed, hasCards, CARD_REASONS, isRunning, medicalLeft, MEDICAL_HOLD, attemptLeft, roundRobin, poolStandings, boutDecided, restLeft, REST_TIME,
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
	assert.equal(activePreset(s().settings).id, 'unity', '1:30 is one of the Unity lengths');
	assert.equal(presetNote(activePreset(s().settings), s().settings), '1:30');
	store.updateSettings({ duration: 75_000 });
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

function runOut(store, advance) {
	store.start();
	advance(D);
	store.expire();
}

test('time up calls a final exchange instead of a winner', () => {
	const { store, s, advance } = setup();
	store.addPoint(0); store.addPoint(0); store.addPoint(0);
	runOut(store, advance);
	assert.equal(s().finalExchange, true);
	assert.equal(s().showWinner, false);
	assert.equal(store.nextRoundAction(), null, 'nothing moves on until the exchange resolves');
	assert.equal(store.toggleShowWinner(), false);
	assert.equal(describeEvent(s(), s().log.at(-1)), 'Final exchange');
	store.addPoint(1);
	assert.equal(s().finalExchange, false, 'a point resolves it');
	assert.equal(s().showWinner, true);
	assert.equal(store.nextRoundAction(), 'next');
	store.undo();
	assert.equal(s().finalExchange, true, 'undo puts the exchange back');
	assert.equal(s().fighters[1].score, 0);
});

test('one point apart, only a point ends the final exchange', () => {
	const { store, s, advance } = setup();
	store.addPoint(0); store.addPoint(0); store.addPoint(1);
	runOut(store, advance);
	assert.equal(store.pointRequired(), true);
	store.addSimul();
	assert.equal(s().finalExchange, true, 'a simul at 2–1 does not end it');
	store.addPoint(0, -1);
	assert.equal(s().finalExchange, true, 'taking a point back does not end it');
	store.undo();
	store.addPoint(1);
	assert.equal(s().finalExchange, false, 'the point is awarded');
	assert.equal(store.nextRoundAction(), 'tiebreaker');
});

test('a simul or no call ends the final exchange when not one apart', () => {
	const { store, s, advance } = setup();
	store.addPoint(0); store.addPoint(0);
	runOut(store, advance);
	assert.equal(store.pointRequired(), false);
	store.addSimul();
	assert.equal(s().finalExchange, false);
	assert.equal(s().showWinner, true);
	store.undo();
	assert.equal(store.noCall(), true);
	assert.equal(s().finalExchange, false);
	assert.equal(describeEvent(s(), s().log.at(-1)), 'No call, bout over');
	assert.equal(store.noCall(), false);
});

test('no final exchange in sudden death, without a live score, or when turned off', () => {
	const sd = setup();
	sd.store.addPoint(0); sd.store.addPoint(1);
	sd.store.endRoundNow();
	sd.store.nextRound();
	sd.store.start();
	sd.advance(30_000);
	sd.store.expire();
	assert.equal(sd.s().finalExchange, false);

	const off = setup({ finalExchange: false });
	runOut(off.store, off.advance);
	assert.equal(off.s().finalExchange, false);
	assert.equal(off.s().showWinner, true);

	const unity = setup();
	unity.store.applyPreset('unity');
	unity.store.start();
	unity.advance(60_000);
	unity.store.expire();
	assert.equal(unity.s().finalExchange, false);
});

test('turning final exchange off mid-exchange decides the bout', () => {
	const { store, s, advance } = setup();
	store.addPoint(0);
	runOut(store, advance);
	store.updateSettings({ finalExchange: false });
	assert.equal(s().finalExchange, false);
	assert.equal(s().showWinner, true);
});

test('tag team simuls call a switch instead of taking points', () => {
	const { store, s } = setup({ simulCutoff: 1 });
	store.setDivision('Tag Team');
	store.addPoint(0); store.addPoint(0);
	store.addSimul();
	assert.deepEqual(s().fighters.map(f => f.score), [2, 0], 'no deduction');
	assert.deepEqual(s().tagSwitch, { stayed: [false, false] });
	assert.equal(describeEvent(s(), s().log.at(-1)), 'Simul (switch fighters)');
	assert.equal(store.canStay(1), false, 'a team with no points must switch');
	assert.equal(store.stay(1), false);
	assert.equal(store.stay(0), true);
	assert.equal(s().fighters[0].score, 1);
	assert.equal(store.canStay(0), false, 'once per simul');
	assert.equal(describeEvent(s(), s().log.at(-1)), 'Blue took −1 to stay in');
	store.undo();
	assert.equal(s().fighters[0].score, 2);
	store.switchDone();
	assert.equal(s().tagSwitch, null);
	store.addSimul();
	store.start();
	assert.equal(s().tagSwitch, null, 'restarting the fight clears the call');
});

test('tag team sudden death: a simul forces both switches', () => {
	const { store, s } = setup();
	store.setDivision('Tag Team');
	store.addPoint(0); store.addPoint(1);
	store.endRoundNow();
	store.nextRound();
	store.addSimul();
	assert.ok(s().tagSwitch);
	assert.equal(store.canStay(0), false);
	assert.equal(store.canStay(1), false);
});

function unitySetup() {
	const x = setup();
	x.store.applyPreset('unity');
	return x;
}

function enter(store, judge, left, right) {
	store.setTally(judge, 0, left);
	store.setTally(judge, 1, right);
}

test('unity: judges enter tallies privately, then publish to reveal the winner', () => {
	const { store, s } = unitySetup();
	enter(store, 0, 7, 5);
	assert.equal(store.publishTally(), false, 'one judge is not enough');
	enter(store, 1, 6, 5);
	assert.equal(store.tallyComplete(), true, 'two judges are enough');
	assert.deepEqual(s().fighters.map(f => f.score), [0, 0], 'nothing shows before publishing');
	enter(store, 2, 8, 6);
	assert.deepEqual(tallyResult(s()), { reported: 3, averages: [7, 5.3], votes: [3, 0], scores: [7, 5] });
	assert.equal(store.publishTally(), true);
	assert.deepEqual(s().fighters.map(f => f.score), [7, 5], 'the rounded average is kept as the score');
	assert.equal(leader(s()), 0);
	assert.equal(timeLeft(s()), 0);
	assert.equal(store.setTally(0, 0, 1), false, 'locked once published');
	store.undo();
	assert.equal(s().tally.published, false, 'undo takes the publish back');
	assert.equal(s().tally.judges[0][0], 7, 'tallies kept');
});

test('unity: the winner follows the judges\' votes, not the average', () => {
	const { store, s } = unitySetup();
	enter(store, 0, 3, 2);
	enter(store, 1, 4, 3);
	enter(store, 2, 1, 40);
	const r = tallyResult(s());
	assert.equal(r.averages[1] > r.averages[0], true, 'one wild score puts Red ahead on average');
	assert.deepEqual(r.votes, [2, 1]);
	store.publishTally();
	assert.equal(leader(s()), 0, 'two judges voted Blue');
	assert.deepEqual(r.scores, [3, 2], 'averages 2.7 and 15 round to 3 and 15: the loser is recorded one below the winner');
	assert.deepEqual(s().fighters.map(f => f.score), [3, 2]);
	assert.equal(s().fighters[0].score > s().fighters[1].score, true);
});

test('recorded scores are whole numbers with the winner ahead', () => {
	assert.deepEqual(recordScores([7, 5.3], 0), [7, 5]);
	assert.deepEqual(recordScores([5.4, 5.4], 1), [4, 5], 'level after rounding: the loser goes one below');
	assert.deepEqual(recordScores([5.6, 5.5], 0), [6, 5]);
	assert.deepEqual(recordScores([4, 9.4], 0), [4, 3], 'a big gap the other way: loser one below the winner');
	assert.deepEqual(recordScores([0.2, 0.4], 1), [0, 1], 'never below zero');
	assert.deepEqual(recordScores([6.5, 5.5], null), [6, 6], 'a tie records level scores');
});

test('unity: a half-entered judge does not count, and a level judge casts no vote', () => {
	const { store, s } = unitySetup();
	enter(store, 0, 5, 5);
	store.setTally(1, 0, 9);
	assert.equal(tallyResult(s()).reported, 1);
	store.setTally(1, 1, 2);
	assert.deepEqual(tallyResult(s()).votes, [1, 0]);
});

test('unity: tied or split votes go to an untimed sudden death, then the Marshal names the winner', () => {
	const { store, s } = unitySetup();
	assert.equal(s().settings.tiebreakerDuration, 0, 'Unity sudden death has no clock');
	enter(store, 0, 6, 4);
	enter(store, 1, 3, 5);
	store.publishTally();
	assert.deepEqual(s().tally.votes, [1, 1]);
	assert.equal(leader(s()), null);
	assert.equal(s().fighters[0].score, s().fighters[1].score, 'a tie records level scores');
	assert.equal(store.nextRoundAction(), 'tiebreaker');
	store.nextRound();
	assert.equal(s().suddenDeath, true);
	assert.equal(isUntimed(s()), true);
	assert.equal(s().tally.published, true, 'the tally stays on record');
	assert.equal(store.start(), false, 'there is no clock to start');
	assert.equal(timeLeft(s()) > 0, true, 'the round stays open');
	assert.equal(store.nextRoundAction(), null, 'nothing moves on until a winner is named');
	assert.equal(store.setTieWinner(1), true);
	assert.equal(leader(s()), 1);
	assert.equal(s().fighters[1].score > s().fighters[0].score, true, 'the sudden-death winner is recorded ahead');
	assert.equal(timeLeft(s()), 0, 'the Marshal\'s call ends sudden death');
	assert.equal(isUntimed(s()), false, 'and the clock goes back to a reading');
	assert.equal(store.nextRoundAction(), 'next');
	store.nextRound();
	assert.equal(s().rounds[0].winner, 1);
	assert.equal(s().rounds[0].suddenDeath, true);
	assert.equal(s().fighters[1].wins, 1);
	assert.deepEqual(s().tally.judges[0], [null, null], 'tallies clear for the next match');
	assert.equal(s().tally.tieWinner, null);
});

test('unity: three judges with a level one and no majority also go to sudden death', () => {
	const { store, s } = unitySetup();
	enter(store, 0, 5, 3);
	enter(store, 1, 4, 4);
	enter(store, 2, 2, 6);
	store.publishTally();
	assert.deepEqual(s().tally.votes, [1, 1]);
	assert.equal(store.nextRoundAction(), 'tiebreaker');
});

test('unity: untimed sudden death can be called off, and standard presets restore the 30s tiebreaker', () => {
	const { store, s } = unitySetup();
	enter(store, 0, 5, 5);
	enter(store, 1, 5, 5);
	store.publishTally();
	store.nextRound();
	assert.equal(isUntimed(s()), true);
	store.endRoundNow();
	assert.equal(store.nextRoundAction(), 'next', 'ending it records no winner, with no second sudden death');
	store.undo();
	assert.equal(store.unpublishTally(), true);
	assert.equal(s().suddenDeath, false, 'taking the result back calls off sudden death');
	assert.equal(isUntimed(s()), false);
	store.applyPreset('standard');
	assert.equal(s().settings.tiebreakerDuration, 30_000);
	assert.equal(isUntimed(s()), false);
});

test('unity: a decided result cannot be given a sudden-death winner, and can be taken back', () => {
	const { store, s } = unitySetup();
	enter(store, 0, 6, 4);
	enter(store, 1, 6, 4);
	store.publishTally();
	assert.equal(store.setTieWinner(1), false);
	assert.equal(store.unpublishTally(), true);
	assert.deepEqual(s().fighters.map(f => f.score), [0, 0]);
	enter(store, 1, 2, 4);
	store.publishTally();
	assert.equal(leader(s()), null, 'edited to 1–1');
});

test('unity: swap sides moves the tallies and votes with the fighters', () => {
	const { store, s } = unitySetup();
	enter(store, 0, 5, 2);
	enter(store, 1, 6, 1);
	store.publishTally();
	store.swapSides();
	assert.deepEqual(s().tally.judges[0], [2, 5]);
	assert.deepEqual(s().tally.votes, [0, 2]);
	assert.equal(leader(s()), 1);
});

test('tally survives saves from before it existed', () => {
	const old = initialState();
	delete old.tally;
	assert.deepEqual(normalize(old).tally.judges[0], [null, null]);
});

test('unity: the votes read as a unanimous decision, a split decision or a draw', () => {
	assert.equal(decisionOf([3, 0]), 'unanimous');
	assert.equal(decisionOf([0, 2]), 'unanimous');
	assert.equal(decisionOf([2, 0]), 'unanimous', 'a level third judge casts no vote against');
	assert.equal(decisionOf([2, 1]), 'split');
	assert.equal(decisionOf([1, 2]), 'split');
	assert.equal(decisionOf([1, 1]), 'draw');
	assert.equal(decisionOf([0, 0]), 'draw', 'every judge level');
});

test('cards: a yellow is a warning and a second yellow counts as a red', () => {
	const { store, s } = setup();
	store.addPoint(0); store.addPoint(0);
	store.giveCard(0, 'yellow', 'Foot fault');
	assert.deepEqual(s().fighters[0].cards, { yellow: 1, red: 0, black: 0 });
	assert.equal(s().fighters[0].score, 2, 'a yellow takes no points');
	assert.equal(describeEvent(s(), s().log.at(-1)), 'Blue yellow card · Foot fault');
	store.giveCard(0, 'yellow');
	assert.deepEqual(s().fighters[0].cards, { yellow: 0, red: 1, black: 0 }, 'two yellows make a red');
	assert.equal(s().fighters[0].score, 1);
	assert.equal(describeEvent(s(), s().log.at(-1)), 'Blue second yellow, red card −1');
	store.undo();
	assert.deepEqual(s().fighters[0].cards, { yellow: 1, red: 0, black: 0 });
	assert.equal(s().fighters[0].score, 2);
});

test('cards: a red takes a point and can take the score below zero', () => {
	const { store, s } = setup();
	store.giveCard(1, 'red', 'Intentional ring out');
	assert.equal(s().fighters[1].score, -1, 'a red at zero goes negative');
	assert.equal(describeEvent(s(), s().log.at(-1)), 'Red red card −1 · Intentional ring out');
	assert.equal(store.addPoint(1, -1), false, 'normal scoring still stops at zero');
	store.addPoint(1);
	assert.equal(s().fighters[1].score, 0);
	assert.equal(CARD_REASONS.includes('Intentional ring out'), true);
	assert.equal(store.giveCard(0, 'purple'), false);
});

test('cards: no final exchange, but a red can flip a sudden death', () => {
	const { store, s, advance } = setup();
	store.addPoint(0); store.addPoint(0);
	store.start();
	advance(D);
	store.expire();
	store.giveCard(0, 'yellow');
	assert.equal(s().finalExchange, true, 'a card does not end the final exchange');
	const sd = setup();
	sd.store.addPoint(0); sd.store.addPoint(1);
	sd.store.endRoundNow();
	sd.store.nextRound();
	sd.store.start();
	sd.store.giveCard(0, 'red');
	assert.equal(leader(sd.s()), 1, 'the red leaves Red ahead');
	assert.equal(timeLeft(sd.s()), 0, 'which ends sudden death');
});

test('cards: a black card forfeits the bout to the other fighter', () => {
	const { store, s, advance } = setup();
	store.addPoint(0); store.addPoint(0); store.addPoint(1);
	store.start();
	advance(10_000);
	store.giveCard(0, 'black', 'Breach of conduct');
	assert.equal(s().forfeit, 0);
	assert.equal(leader(s()), 1, 'Red wins by forfeit although behind');
	assert.equal(timeLeft(s()), 0);
	assert.equal(s().startedAt, null);
	assert.equal(describeEvent(s(), s().log.at(-1)), 'Blue black card, forfeit · Breach of conduct');
	assert.equal(store.nextRoundAction(), 'next');
	store.undo();
	assert.equal(s().forfeit, null);
	assert.equal(timeLeft(s(), store.now()) > 0, true, 'undo gives the clock back');
	store.giveCard(0, 'black');
	store.nextRound();
	assert.equal(s().rounds[0].winner, 1);
	assert.equal(s().forfeit, null, 'the next bout starts clean');
	assert.equal(s().fighters[0].cards.black, 1, 'but the card stays on record');
});

test('cards: Unity records a red without a score, and cards follow fighters', () => {
	const { store, s } = setup();
	store.applyPreset('unity');
	store.giveCard(0, 'red');
	assert.equal(s().fighters[0].cards.red, 1);
	assert.equal(s().fighters[0].score, 0);
	store.swapSides();
	assert.equal(s().fighters[1].cards.red, 1);
	store.newMatch();
	assert.equal(s().fighters[1].cards.red, 1, 'same fighters keep their cards');
	assert.equal(hasCards(s().fighters[1]), true);
	store.clearCards(1);
	assert.equal(hasCards(s().fighters[1]), false);
	store.giveCard(0, 'yellow');
	store.newMatch({ full: true });
	assert.equal(hasCards(s().fighters[0]), false, 'a full reset clears cards');
});

test('cards: saves from before cards existed still load', () => {
	const old = initialState();
	for (const f of old.fighters) delete f.cards;
	delete old.forfeit;
	const n = normalize(old);
	assert.deepEqual(n.fighters[0].cards, { yellow: 0, red: 0, black: 0 });
	assert.equal(n.forfeit, null);
});

test('switch sides: called once when the first fighter reaches half the target', () => {
	const { store, s } = setup();
	for (let i = 0; i < 4; i++) store.addPoint(0);
	assert.equal(s().sidesDue, false);
	store.addPoint(1);
	store.addPoint(0);
	assert.equal(s().sidesDue, true, 'five is half of ten');
	assert.equal(describeEvent(s(), s().log.at(-1)), 'Switch sides');
	store.sidesDone();
	assert.equal(s().sidesDue, false);
	store.addPoint(0);
	store.addPoint(1); store.addPoint(1); store.addPoint(1); store.addPoint(1);
	assert.equal(s().sidesDue, false, 'only once per round');
});

test('switch sides: swapping clears the call, undo takes it back, a new round resets it', () => {
	const { store, s } = setup();
	for (let i = 0; i < 5; i++) store.addPoint(1);
	assert.equal(s().sidesDue, true);
	store.undo();
	assert.equal(s().sidesDue, false);
	assert.equal(s().sidesCalled, false);
	for (let i = 0; i < 5; i++) store.addPoint(1);
	store.swapSides();
	assert.equal(s().sidesDue, false);
	store.resetRound();
	assert.equal(s().sidesCalled, false);
});

test('switch sides: not in Tag Team, sudden death or Unity', () => {
	const tag = setup({ division: 'Tag Team' });
	for (let i = 0; i < 5; i++) tag.store.addPoint(0);
	assert.equal(tag.s().sidesDue, false);
	const unity = setup();
	unity.store.applyPreset('unity');
	unity.store.addPoint(0);
	assert.equal(unity.s().sidesDue, false);
});

test('no-show: a 0–10 loss for the absent fighter, and the bout is over', () => {
	const { store, s } = setup();
	store.noShow(0);
	assert.deepEqual(s().fighters.map(f => f.score), [0, 10]);
	assert.equal(leader(s()), 1);
	assert.equal(timeLeft(s()), 0);
	assert.equal(s().noShow, true);
	assert.equal(describeEvent(s(), s().log.at(-1)), 'Blue did not show, 10–0 forfeit');
	assert.equal(store.noShow(1), false, 'only once');
	store.undo();
	assert.equal(s().forfeit, null);
	assert.deepEqual(s().fighters.map(f => f.score), [0, 0]);
	assert.equal(timeLeft(s(), store.now()) > 0, true);
	store.noShow(1);
	store.nextRound();
	assert.equal(s().noShow, false, 'the next bout starts clean');
});

test('no-show: Unity records the forfeit without scores', () => {
	const { store, s } = setup();
	store.applyPreset('unity');
	store.noShow(1);
	assert.equal(leader(s()), 0);
	assert.deepEqual(s().fighters.map(f => f.score), [0, 0]);
});

test('medical hold: pauses the bout and counts down 3:00 on its own', () => {
	const { store, s, advance } = setup();
	store.start();
	advance(10_000);
	store.startMedical();
	assert.equal(s().startedAt, null, 'the bout clock stops');
	assert.equal(timeLeft(s()), D - 10_000);
	assert.equal(medicalLeft(s(), store.now()), MEDICAL_HOLD);
	advance(60_000);
	assert.equal(medicalLeft(s(), store.now()), MEDICAL_HOLD - 60_000);
	assert.equal(store.start(), false, 'the bout cannot restart during the hold');
	advance(MEDICAL_HOLD);
	assert.equal(medicalLeft(s(), store.now()), 0);
	store.endMedical();
	assert.equal(s().medical, null);
	assert.equal(timeLeft(s()), D - 10_000, 'the bout clock is untouched');
	assert.equal(store.start(), true);
});

test('medical hold: a new round clears it', () => {
	const { store, s } = setup();
	store.startMedical();
	assert.equal(store.startMedical(), false, 'only one hold at a time');
	store.resetRound();
	assert.equal(s().medical, null);
});

test('Total Bout Time preset: 5:00, no final exchange, time calls at 1:00 and 0:30', () => {
	const { store, s, advance } = setup();
	store.applyPreset('total-bout');
	assert.equal(s().settings.duration, 300_000);
	assert.equal(s().settings.finalExchange, false);
	assert.equal(s().settings.timeCallsAt, 60_000);
	assert.equal(s().settings.tiebreakerDuration, 60_000);
	assert.equal(activePreset(s().settings).id, 'total-bout');
	store.resetRound();
	store.addPoint(0);
	store.start();
	advance(300_000);
	store.expire();
	assert.equal(timeLeft(s()), 0);
	assert.equal(s().finalExchange, false, 'the clock simply runs out');
	store.applyPreset('standard');
	assert.equal(s().settings.finalExchange, true, 'Standard turns the final exchange back on');
	assert.equal(s().settings.timeCallsAt, 30_000);
	assert.equal(activePreset(s().settings).id, 'standard');
});

test('attempt clock: only a timed sudden death over 30s, cleared by the table, no outcome at zero', () => {
	const std = setup();
	std.store.addPoint(0); std.store.addPoint(1);
	std.store.endRoundNow();
	std.store.nextRound();
	assert.equal(attemptLeft(std.s(), std.store.now()), null, 'a 30s sudden death is all attempt window already');

	const { store, s, advance } = setup();
	store.applyPreset('total-bout');
	store.resetRound();
	store.addPoint(0); store.addPoint(1);
	store.endRoundNow();
	store.nextRound();
	assert.equal(s().suddenDeath, true);
	assert.equal(attemptLeft(s(), store.now()), 30_000);
	store.start();
	advance(20_000);
	assert.equal(attemptLeft(s(), store.now()), 10_000);
	advance(15_000);
	assert.equal(attemptLeft(s(), store.now()), 0, 'it runs out, and nothing else happens');
	assert.equal(s().remaining > 0, true);
	assert.equal(leader(s()), null);
	store.attempt();
	assert.equal(attemptLeft(s(), store.now()), null);
	assert.equal(s().attemptMade, true);
	store.resetRound();
	assert.equal(s().attemptMade, false);
});

function pool(names, settings = {}) {
	const env = setup(settings);
	for (const n of names) env.store.addPoolFighter(n);
	env.store.buildPoolBouts();
	return env;
}

test('pool: round robin pairs everyone once and gives fighters a rest', () => {
	const pairs = roundRobin([1, 2, 3, 4, 5]);
	assert.equal(pairs.length, 10);
	assert.equal(new Set(pairs.map(p => [...p].sort().join('-'))).size, 10);
	const four = roundRobin([1, 2, 3, 4]);
	assert.equal(four.length, 6);
	for (let i = 0; i < 6; i += 2) {
		assert.deepEqual([...four[i], ...four[i + 1]].sort(), [1, 2, 3, 4], 'each round has everyone fighting once');
	}
});

test('pool: fighters, round robin and one-off matchups', () => {
	const { store, s } = setup();
	assert.equal(store.addPoolFighter('  Ana '), true);
	assert.equal(store.addPoolFighter('ana'), false, 'no duplicate names');
	assert.equal(store.addPoolFighter(''), false);
	store.addPoolFighter('Bo');
	store.addPoolFighter('Cy');
	assert.equal(store.buildPoolBouts(), true);
	assert.equal(s().pool.bouts.length, 3);
	assert.equal(store.buildPoolBouts(), false, 'nothing missing the second time');
	assert.equal(store.removePoolFighter(s().pool.fighters[0].id), false, 'a fighter in a bout stays');

	assert.equal(store.addPoolBout('Di', 'Ed'), true, 'new names are added as fighters');
	assert.equal(s().pool.fighters.length, 5);
	assert.equal(store.addPoolBout('di', 'DI'), false, 'a fighter cannot fight themself');
	assert.equal(store.addPoolBout('Di', ''), false);
	assert.equal(store.addPoolBout('Ana', 'Di'), true, 'a rematch or a later round is just another matchup');
	assert.deepEqual(s().pool.bouts.map(b => b.id), [1, 2, 3, 4, 5]);
	const last = s().pool.bouts.at(-1);
	assert.equal(store.removePoolBout(last.id), true);
	assert.equal(store.removePoolBout(last.id), false);
	store.loadPoolBout(1);
	assert.equal(store.removePoolBout(1), false, 'not while it is on the scoreboard');
	assert.equal(store.addPoolBout('Fy', 'Gus'), true);
	assert.equal(s().pool.bouts.at(-1).id, 5, 'the next id follows the highest one in use');
});

test('pool: load a bout, record the result, and standings rank wins then points for then fewest against', () => {
	const { store, s } = pool(['Ana', 'Bo', 'Cy']);
	const [b1] = s().pool.bouts;
	store.loadPoolBout(b1.id);
	const names = s().fighters.map(f => f.name);
	assert.deepEqual(names, [s().pool.fighters.find(f => f.id === b1.a).name, s().pool.fighters.find(f => f.id === b1.b).name]);
	assert.equal(store.recordPoolBout(), false, 'not decided yet');
	for (let i = 0; i < 10; i++) store.addPoint(1);
	store.addPoint(0);
	assert.equal(boutDecided(s(), store.now()), true);
	store.swapSides();
	assert.equal(store.recordPoolBout(), true, 'swapping sides does not confuse who is who');
	const r = s().pool.bouts[0].result;
	assert.equal(r.winner, b1.b);
	assert.equal(r.scores[0], 1);
	assert.equal(r.scores[1], 10);
	assert.equal(s().pool.active, null);

	store.undo();
	assert.equal(s().pool.bouts[0].result !== null, true, 'undo never rolls the pool back');

	const table = poolStandings(s().pool);
	assert.equal(table[0].id, b1.b);
	assert.equal(table[0].wins, 1);
	assert.equal(table[0].pointsFor, 10);
	assert.equal(table.at(-1).played, 0, 'the fighter who has not fought is last');
	store.clearPoolResult(b1.id);
	assert.equal(poolStandings(s().pool)[0].wins, 0);
});

test('pool: ties on wins fall to points for, then fewest against', () => {
	const p = { fighters: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }, { id: 4, name: 'D' }], active: null, nextId: 5, bouts: [
		{ id: 1, a: 1, b: 2, result: { scores: [10, 2], winner: 1 } },
		{ id: 2, a: 3, b: 4, result: { scores: [10, 6], winner: 3 } },
		{ id: 3, a: 1, b: 4, result: { scores: [3, 10], winner: 4 } },
		{ id: 4, a: 3, b: 2, result: { scores: [4, 10], winner: 2 } },
	] };
	const t = poolStandings(p);
	// A, B, C and D each have one win: points for decides (A 13, B 12, C 14, D 16).
	assert.deepEqual(t.map(r => r.name), ['D', 'C', 'A', 'B']);
});

test('pool: cards follow the fighter to their next bout, and Unity records the judges\' scores', () => {
	const { store, s } = pool(['Ana', 'Bo', 'Cy']);
	store.loadPoolBout(1);
	store.giveCard(0, 'yellow');
	const carded = s().fighters[0].poolId;
	for (let i = 0; i < 10; i++) store.addPoint(0);
	store.recordPoolBout();
	assert.equal(s().pool.fighters.find(f => f.id === carded).cards.yellow, 1);
	const next = s().pool.bouts.find(b => !b.result && (b.a === carded || b.b === carded));
	store.loadPoolBout(next.id);
	assert.equal(s().fighters.find(f => f.poolId === carded).cards.yellow, 1, 'the yellow is still there');

	const u = pool(['Ana', 'Bo'], {});
	u.store.applyPreset('unity');
	u.store.loadPoolBout(1);
	u.store.setTally(0, 0, 9); u.store.setTally(0, 1, 5);
	u.store.setTally(1, 0, 8); u.store.setTally(1, 1, 6);
	u.store.endRoundNow();
	assert.equal(u.store.recordPoolBout(), false, 'not published yet');
	u.store.publishTally();
	assert.equal(u.store.recordPoolBout(), true);
	const res = u.s().pool.bouts[0].result;
	assert.equal(res.winner, u.s().pool.bouts[0].a);
	assert.equal(res.scores[0] > res.scores[1], true);
});

test('pool: saves from before pools existed still load', () => {
	const old = initialState();
	delete old.pool;
	assert.deepEqual(normalize(old).pool.fighters, []);
});

test('pool: a fighter in back-to-back bouts rests 60 seconds', () => {
	const { store, s, advance } = pool(['Ana', 'Bo', 'Cy']);
	store.loadPoolBout(1);
	assert.equal(restLeft(s(), store.now()), null, 'nobody has fought yet');
	for (let i = 0; i < 10; i++) store.addPoint(0);
	const [first, second] = s().fighters.map(f => f.poolId);
	store.recordPoolBout();
	advance(5_000);
	// Bout 2 is the one of these that shares a fighter with bout 1.
	const back = s().pool.bouts.find(b => !b.result && [b.a, b.b].some(id => id === first || id === second));
	store.loadPoolBout(back.id);
	const r = restLeft(s(), store.now());
	assert.equal(r.left, REST_TIME - 5_000);
	assert.equal(r.ids.every(id => id === first || id === second), true);
	advance(55_000);
	assert.equal(restLeft(s(), store.now()), null, 'the minute is over');
});

test('pool: no rest call for fighters who sat out, or once the bout has started', () => {
	const { store, s } = pool(['Ana', 'Bo', 'Cy', 'Di']);
	store.loadPoolBout(1);
	for (let i = 0; i < 10; i++) store.addPoint(0);
	store.recordPoolBout();
	const [x, y] = [s().pool.bouts[0].a, s().pool.bouts[0].b];
	const fresh = s().pool.bouts.find(b => !b.result && ![b.a, b.b].some(id => id === x || id === y));
	store.loadPoolBout(fresh.id);
	assert.equal(restLeft(s(), store.now()), null);
	const again = s().pool.bouts.find(b => !b.result && b.id !== fresh.id);
	store.loadPoolBout(fresh.id === again.id ? s().pool.bouts.find(b => !b.result).id : again.id);
	store.addPoint(0);
	assert.equal(restLeft(s(), store.now()), null, 'rest is only shown before the bout starts');
});

test('pool: cards given in a bout that is abandoned still follow the fighter', () => {
	const { store, s } = pool(['Ana', 'Bo', 'Cy']);
	store.loadPoolBout(1);
	const carded = s().fighters[0].poolId;
	store.giveCard(0, 'red');
	store.loadPoolBout(2);
	assert.equal(s().pool.fighters.find(f => f.id === carded).cards.red, 1);
});

test('cards: a card given by mistake can be taken back after more scoring', () => {
	const { store, s } = setup();
	store.addPoint(0); store.addPoint(0);
	store.giveCard(0, 'red', 'Foot fault');
	assert.equal(s().fighters[0].score, 1);
	store.addPoint(1);
	store.addPoint(0);
	assert.equal(s().fighters[0].score, 2);
	store.removeCard(0, 'red');
	assert.equal(s().fighters[0].cards.red, 0);
	assert.equal(s().fighters[0].score, 3, 'the point comes back on top of later scoring');
	assert.equal(describeEvent(s(), s().log.find(e => e.kind === 'card')), 'Blue red card · Foot fault (taken back)');
	assert.equal(describeEvent(s(), s().log.at(-1)), 'Blue red card taken back');
	assert.equal(store.removeCard(0, 'red'), false, 'nothing left to take back');
	store.undo();
	assert.equal(s().fighters[0].cards.red, 1, 'taking it back can be undone');
});

test('cards: taking back a red at 0 restores the score, and a second yellow goes back to a yellow', () => {
	const { store, s } = setup();
	store.giveCard(1, 'red');
	assert.equal(s().fighters[1].score, -1);
	store.removeCard(1, 'red');
	assert.equal(s().fighters[1].score, 0);
	store.giveCard(0, 'yellow');
	store.addPoint(0);
	store.giveCard(0, 'yellow');
	assert.deepEqual(s().fighters[0].cards, { yellow: 0, red: 1, black: 0 });
	store.removeCard(0, 'red');
	assert.deepEqual(s().fighters[0].cards, { yellow: 1, red: 0, black: 0 }, 'back to one yellow');
	assert.equal(s().fighters[0].score, 1);
});

test('cards: taking back a black card reopens the bout with its time', () => {
	const { store, s, advance } = setup();
	store.start();
	advance(30_000);
	store.giveCard(0, 'black');
	assert.equal(timeLeft(s()), 0);
	store.removeCard(0, 'black');
	assert.equal(s().forfeit, null);
	assert.equal(timeLeft(s(), store.now()), D - 30_000);
	assert.equal(isRunning(s()), false);
	assert.equal(store.start(), true);
});

test('cards: a card carried from an earlier bout comes off the record without touching the score', () => {
	const { store, s } = pool(['Ana', 'Bo', 'Cy']);
	store.loadPoolBout(1);
	store.giveCard(0, 'yellow');
	store.giveCard(1, 'yellow');
	store.loadPoolBout(2);
	const carried = s().fighters.find(f => f.cards.yellow);
	const side = s().fighters.indexOf(carried);
	store.addPoint(side);
	store.removeCard(side, 'yellow');
	assert.equal(s().fighters[side].cards.yellow, 0);
	assert.equal(s().fighters[side].score, 1);
});

test('pool: Next match records the decided bout and loads the next one', () => {
	const { store, s } = pool(['Ana', 'Bo', 'Cy']);
	assert.equal(store.nextPoolBout().id, 1, 'before any bout, the first one is offered');
	assert.equal(store.advancePool(), true);
	assert.equal(s().pool.active, 1);
	assert.equal(store.nextPoolBout(), null, 'not while the loaded bout is still being fought');
	assert.equal(store.advancePool(), false);
	for (let i = 0; i < 10; i++) store.addPoint(0);
	assert.equal(store.nextPoolBout().id, 2);
	assert.equal(store.advancePool(), true);
	assert.equal(s().pool.bouts[0].result.scores[0], 10, 'the first result was recorded on the way');
	assert.equal(s().pool.active, 2);
	for (let i = 0; i < 10; i++) store.addPoint(1);
	store.advancePool();
	assert.equal(s().pool.active, 3);
	for (let i = 0; i < 10; i++) store.addPoint(0);
	assert.equal(store.nextPoolBout(), null, 'the last bout has no next one');
	assert.equal(store.recordPoolBout(), true);
	assert.equal(s().pool.bouts.every(b => b.result), true);
});

test('pool: no Next match without a pool, or in the middle of an unrecorded bout', () => {
	const { store } = setup();
	assert.equal(store.nextPoolBout(), null);
	const p = pool(['Ana', 'Bo']);
	p.store.addPoint(0);
	assert.equal(p.store.nextPoolBout(), null, 'a hand-played bout is not replaced by the pool');
});

test('pool: matchups entered by hand are fought in order and recorded, and more can be added between rounds', () => {
	const { store, s } = setup();
	store.addPoolBout('Ana', 'Bo');
	store.addPoolBout('Cy', 'Di');
	store.advancePool();
	assert.deepEqual(s().fighters.map(f => f.name), ['Ana', 'Bo']);
	for (let i = 0; i < 10; i++) store.addPoint(1);
	store.advancePool();
	assert.deepEqual(s().fighters.map(f => f.name), ['Cy', 'Di']);
	for (let i = 0; i < 10; i++) store.addPoint(0);
	assert.equal(store.nextPoolBout(), null, 'the list is finished');
	store.addPoolBout('Bo', 'Cy');
	assert.equal(store.nextPoolBout().id, 3, 'a second round can be added after results are in');
	store.advancePool();
	assert.equal(s().pool.bouts[1].result.winner, s().pool.bouts[1].a);
	const table = poolStandings(s().pool);
	assert.equal(table.filter(r => r.wins === 1).length, 2);
});

test('pool groups: each keeps its own matchups, fighters and standings', () => {
	const { store, s } = setup();
	assert.equal(store.addPoolGroup('Pool A'), true);
	assert.equal(store.addPoolGroup('pool a'), false, 'no duplicate group names');
	store.selectPoolGroup(s().pool.groups[0].id);
	for (const n of ['Ana', 'Bo', 'Cy']) store.addPoolFighter(n);
	store.buildPoolBouts();
	assert.equal(s().pool.bouts.length, 3);
	store.addPoolGroup('Finals');
	store.addPoolBout('Ana', 'Dee');
	assert.equal(s().pool.bouts.length, 4);
	assert.equal(s().pool.bouts[3].group, s().pool.view);
	const [a, f] = s().pool.groups;
	assert.equal(poolStandings(s().pool, a.id).length, 3);
	assert.deepEqual(poolStandings(s().pool, f.id).map(r => r.name).sort(), ['Ana', 'Dee']);
	assert.equal(a.robin, true);
	assert.equal(f.robin, false);
});

test('pool groups: Next match runs groups in the order they were made', () => {
	const { store, s } = setup();
	store.addPoolGroup('One');
	store.addPoolBout('Ana', 'Bo');
	store.addPoolGroup('Two');
	store.addPoolBout('Cy', 'Di');
	store.selectPoolGroup(s().pool.groups[0].id);
	assert.equal(store.nextPoolBout().a, s().pool.fighters[0].id);
	store.advancePool();
	assert.equal(s().fighters[0].name, 'Ana');
});

test('pool groups: a group with results cannot be deleted, an unfought one can', () => {
	const { store, s } = setup();
	store.addPoolGroup('One');
	store.addPoolBout('Ana', 'Bo');
	store.addPoolGroup('Two');
	store.addPoolBout('Cy', 'Di');
	store.advancePool();
	for (let i = 0; i < 10; i++) store.addPoint(0);
	store.advancePool();
	store.addPoolGroup('Three');
	store.addPoolBout('Ed', 'Fy');
	const [one, two, three] = s().pool.groups;
	assert.equal(store.removePoolGroup(one.id), false, 'has a result');
	assert.equal(store.removePoolGroup(two.id), false, 'on the scoreboard');
	assert.equal(store.removePoolGroup(three.id), true);
	assert.equal(s().pool.bouts.length, 2);
	assert.deepEqual(s().pool.fighters.map(f => f.name), ['Ana', 'Bo', 'Cy', 'Di']);
});

test('pool groups: a pool saved before groups becomes one group', () => {
	const old = initialState();
	old.pool = { fighters: [{ id: 1, name: 'A', cards: {} }, { id: 2, name: 'B', cards: {} }], bouts: [{ id: 1, a: 1, b: 2, result: null }], active: null, nextId: 3, lastFinish: null };
	const s = normalize(JSON.parse(JSON.stringify(old)));
	assert.equal(s.pool.groups.length, 1);
	assert.equal(s.pool.bouts[0].group, s.pool.groups[0].id);
	assert.equal(s.pool.view, s.pool.groups[0].id);
});
