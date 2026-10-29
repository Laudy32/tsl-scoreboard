import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	Store, initialState, DEFAULT_SETTINGS, timeLeft, parseClock, formatClock, matchWinner, normalize,
	activePreset, describeEvent, usesRounds, presetNote, tallyResult, recordScores, decisionOf, leader, isUntimed, hasCards, CARD_REASONS,
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
