// Scoreboard state and scoring rules. Pure logic: no DOM access here, so it
// can be tested in Node.

export const COLORS = {
	blue: { label: 'Blue', hex: '#2459e0' },
	red: { label: 'Red', hex: '#d42a3a' },
	green: { label: 'Green', hex: '#1e9e57' },
	gold: { label: 'Gold', hex: '#c9971c' },
	orange: { label: 'Orange', hex: '#e8650f' },
	purple: { label: 'Purple', hex: '#8b44e0' },
	black: { label: 'Black', hex: '#30343c' },
};

export const DEFAULT_SETTINGS = {
	duration: 2.5 * 60 * 1000,
	/** Sudden death length. 0 = untimed: the Marshal decides it (Unity, Rules 9.12a). */
	tiebreakerDuration: 30 * 1000,
	/** Each simul at or past this count takes 1 point from both fighters. 0 = never. */
	simulCutoff: 3,
	/** Round wins needed to win the match. 0 = no limit. */
	playTo: 0,
	/** Points that win the round on the spot. 0 = no limit, the clock decides. */
	pointsToWin: 10,
	/** Off for formats like Unity, where nobody keeps score during the bout. */
	liveScore: true,
	/** Shown above the scoreboard, e.g. "Masters". Empty = none. */
	division: '',
	/** Divisions typed in by the club, kept so they can be picked again. */
	customDivisions: [],
	pauseAfterScoring: false,
	/**
	 * At 0:00 the table calls a Final Exchange: fighting goes on until the
	 * exchange resolves, and only then is the bout decided (Rules 5.05, 5.13).
	 */
	finalExchange: true,
	/** The table's first time call; the second is half of it. 30s for Guaranteed Fight Time (0:30, 0:15), 60s for Total Bout Time (1:00, 0:30). */
	timeCallsAt: 30_000,
	sound: true,
};

/** Quick setups for the usual match types. Each sets only the rules it lists. */
export const MATCH_PRESETS = [
	{ id: 'standard', label: 'Standard', note: '2:30, first to 10', settings: { duration: 150_000, tiebreakerDuration: 30_000, pointsToWin: 10, liveScore: true, finalExchange: true, timeCallsAt: 30_000 } },
	{ id: 'two-minute', label: '2 Minute Standard', note: '2:00, first to 10', settings: { duration: 120_000, tiebreakerDuration: 30_000, pointsToWin: 10, liveScore: true, finalExchange: true, timeCallsAt: 30_000 } },
	// The original method (5.04): holds don't stop the clock, so there is no final exchange; calls at 1:00 and 0:30.
	{ id: 'total-bout', label: 'Total Bout Time', note: '5:00, first to 10', settings: { duration: 300_000, tiebreakerDuration: 60_000, pointsToWin: 10, liveScore: true, finalExchange: false, timeCallsAt: 60_000 } },
	{
		id: 'unity', label: 'Unity', note: '1:00, 1:30 or 2:00',
		settings: { duration: 60_000, tiebreakerDuration: 0, pointsToWin: 0, liveScore: false },
		// Unity round lengths by format (Rules 9.02). Any of them still counts as this preset.
		durations: [
			{ ms: 60_000, label: '1:00', note: 'Pools' },
			{ ms: 90_000, label: '1:30', note: 'Single elim, CS' },
			{ ms: 120_000, label: '2:00', note: 'CS only' },
		],
	},
];

/** Only Championship Series is fought over rounds (best of 3); every other division is one bout. */
export const ROUNDS_DIVISION = 'Championship Series';
export const CS_ROUNDS_TO_WIN = 2;

export const usesRounds = s => s.settings.division === ROUNDS_DIVISION;

/** In Tag Team a simul makes both teams switch fighters instead of costing points (Rules 8.04). */
/** The score recorded for a no-show when no winning score is set. */
const NO_SHOW_SCORE = 10;
export const TAG_TEAM_DIVISION = 'Tag Team';
export const isTagTeam = s => s.settings.division === TAG_TEAM_DIVISION;

export const DIVISIONS = ['Standard', 'Exotics', 'Unity', 'Tag Team', 'Redemption', 'Masters', "Women's", 'Championship Series'];

/** The preset the current rules match, or null if they've been changed by hand. */
export function activePreset(settings) {
	return MATCH_PRESETS.find(p => Object.entries(p.settings).every(([k, v]) =>
		settings[k] === v || (k === 'duration' && p.durations?.some(d => d.ms === settings.duration)))) ?? null;
}

/** A preset's summary for the current rules, e.g. "1:30" once a Unity length is picked. */
export function presetNote(p, settings) {
	const d = activePreset(settings) === p && p.durations?.find(x => x.ms === settings.duration);
	return d ? d.label : p.note;
}

const UNDO_LIMIT = 100;

function emptyTally() {
	return { judges: [[null, null], [null, null], [null, null]], published: false, votes: [0, 0], averages: [0, 0], tieWinner: null };
}

/** At least this many line judges must report before a Unity result can be published. */
export const MIN_JUDGES = 2;

/** How the judges' votes came out: no votes against, some against, or level. */
export function decisionOf([a, b]) {
	if (a === b) return 'draw';
	return Math.min(a, b) === 0 ? 'unanimous' : 'split';
}

/**
 * The whole-number scores to record (and enter in Challonge): the averages
 * rounded, but never leaving the winner level with or behind the loser. If
 * rounding doesn't separate them, the loser is recorded one below the winner.
 * With no winner (a tie) both get the same score.
 */
export function recordScores(averages, winner) {
	const scores = averages.map(a => Math.round(a));
	if (winner === null) {
		const level = Math.round((averages[0] + averages[1]) / 2);
		return [level, level];
	}
	if (scores[winner] <= scores[1 - winner]) {
		// A big gap between the average and the votes: the loser goes one below the winner.
		scores[winner] = Math.max(scores[winner], 1);
		scores[1 - winner] = scores[winner] - 1;
	}
	return scores;
}

/**
 * What the judges reported. Each judge who gave both scores casts a vote for
 * the fighter they scored higher (none if level); the winner comes from the
 * votes, so one judge with wildly different numbers can't swing it. The
 * averages are for the record.
 */
export function tallyResult(s) {
	const done = s.tally.judges.filter(j => j.every(v => v !== null));
	const avg = i => (done.length ? Math.round(done.reduce((sum, j) => sum + j[i], 0) / done.length * 10) / 10 : 0);
	const votes = [0, 1].map(i => done.filter(j => j[i] > j[1 - i]).length);
	const averages = [avg(0), avg(1)];
	return {
		reported: done.length,
		averages,
		votes,
		scores: recordScores(averages, votes[0] === votes[1] ? null : votes[0] > votes[1] ? 0 : 1),
	};
}

/** Why a card was given, from the conduct rules (3.03, 3.04, 4.03, 5.07-7, 5.11-5). */
export const CARD_REASONS = ['Breach of conduct', 'Intentional ring out', 'Foot fault', 'Excessive force', 'Cornerstone', 'Other'];

export const CARD_NAMES = { yellow: 'Yellow', red: 'Red', black: 'Black' };

const noCards = () => ({ yellow: 0, red: 0, black: 0 });

export const hasCards = f => f.cards.yellow + f.cards.red + f.cards.black > 0;

function fighter(color) {
	return { name: COLORS[color].label, subtitle: '', color, score: 0, wins: 0, cards: noCards() };
}

function emptyPool() {
	return { fighters: [], bouts: [], active: null, nextId: 1 };
}

export function initialState(settings = DEFAULT_SETTINGS) {
	return {
		version: 2,
		/** The pool being run: fighters, the round-robin bouts and their results. Like settings, undo never rolls it back. */
		pool: emptyPool(),
		round: 1,
		fighters: [fighter('blue'), fighter('red')],
		simul: 0,
		/** Points each simul actually took from [left, right], so removing it gives back the same. */
		simulPenalties: [],
		suddenDeath: false,
		/** Side that took a black card (or didn't show) and forfeits the bout, or null. */
		forfeit: null,
		/** The forfeit was a no-show. */
		noShow: false,
		/** Time is up but the last exchange is still being fought. */
		finalExchange: false,
		/** Unity: each judge's silent tally [left, right], kept off the screens until published. Null until entered. */
		tally: emptyTally(),
		/** Sudden death: the table saw an attempt to score, so the attempt clock is cleared. */
		attemptMade: false,
		/** An injured fighter's medical hold, counted down beside the paused bout clock: { startedAt }, or null (3.05-5). */
		medical: null,
		/** Fighters switch corners when the first reaches half the winning score (5.12): the call was made, and is waiting to be cleared. */
		sidesCalled: false,
		sidesDue: false,
		/** Tag Team, after a simul: which teams paid a point to keep their fighter in. Null when no switch is due. */
		tagSwitch: null,
		/** Time left when a fighter reached the winning score, so undoing that point can give it back. */
		stoppedAtTarget: null,
		showWinner: true,
		/** Time left as of the last start/pause. */
		remaining: settings.duration,
		/** Epoch ms of the last start/resume, or null while paused. */
		startedAt: null,
		settings: { ...settings },
		/** Every scoring action this match, oldest first. */
		log: [],
		/** One entry per finished round. */
		rounds: [],
	};
}

/** Fills in anything missing from a saved state (older saves, new settings). */
export function normalize(saved) {
	if (!saved || saved.version !== 2) return initialState();
	const base = initialState();
	return {
		...base,
		...saved,
		settings: { ...DEFAULT_SETTINGS, ...saved.settings, customDivisions: [...(saved.settings?.customDivisions ?? [])] },
		fighters: [0, 1].map(i => ({ ...base.fighters[i], ...saved.fighters?.[i] })),
		pool: { ...emptyPool(), ...saved.pool },
	};
}

export function timeLeft(s, now = Date.now()) {
	const elapsed = s.startedAt === null ? 0 : now - s.startedAt;
	return Math.max(s.remaining - elapsed, 0);
}

/** A timed sudden death longer than this needs an attempt to score in its first 30 seconds (Rule 5.04-6). */
export const ATTEMPT_WINDOW = 30_000;

/** Time left to attempt a score in sudden death, or null when no attempt is being asked for. */
export function attemptLeft(s, now = Date.now()) {
	const long = s.settings.tiebreakerDuration > ATTEMPT_WINDOW;
	if (!s.suddenDeath || s.attemptMade || !long || !s.settings.liveScore || leader(s) !== null || s.forfeit !== null) return null;
	const left = timeLeft(s, now);
	if (left === 0 && !isRunning(s) && s.remaining === 0) return null;
	return Math.max(left - (s.settings.tiebreakerDuration - ATTEMPT_WINDOW), 0);
}

/** Length of the medical hold (Rule 3.05-5). */
export const MEDICAL_HOLD = 180_000;
export const medicalLeft = (s, now = Date.now()) => (s.medical ? Math.max(MEDICAL_HOLD - (now - s.medical.startedAt), 0) : 0);

export const isRunning = s => s.startedAt !== null;

/** Sudden death with no clock: it ends when the Marshal names a winner. */
export const isUntimed = s => s.suddenDeath && s.settings.tiebreakerDuration === 0 && s.remaining > 0;

/** Stands in for the clock reading while sudden death is untimed. */
const UNTIMED_REMAINING = 1;
export const isTimeUp = (s, now) => timeLeft(s, now) === 0;
export const hasStarted = s => isRunning(s) || s.remaining !== s.settings.duration ||
	s.fighters.some(f => f.score) || s.simul > 0;

/** Index of the fighter ahead on points, or null on a tie. */
export function leader(s) {
	const [a, b] = s.fighters;
	// A black card forfeits the bout to the other fighter.
	if (s.forfeit !== null && s.forfeit !== undefined) return 1 - s.forfeit;
	// A published Unity result is decided by the judges' votes, not the averages.
	if (s.tally?.published) {
		const [x, y] = s.tally.votes;
		if (x !== y) return x > y ? 0 : 1;
		return s.tally.tieWinner ?? null;
	}
	if (a.score === b.score) return null;
	return a.score > b.score ? 0 : 1;
}

/** Index of the fighter who has won the match, or null. */
/** The bout is over and has a result a pool can record: time is up, no final exchange pending, and a winner. */
export function boutDecided(s, now = Date.now()) {
	if (timeLeft(s, now) !== 0 || s.finalExchange || isUntimed(s)) return false;
	if (!s.settings.liveScore && !s.tally.published) return false;
	return leader(s) !== null;
}

/** Scores to record for the bout: the live scores, or the judges' recorded scores in Unity. */
export const boutScores = s => (s.settings.liveScore ? s.fighters.map(f => f.score) : tallyResult(s).scores);

/**
 * Pool standings: wins, then points for, then fewest points against (Rule 6.02c-4).
 * Each row is { id, name, played, wins, losses, pointsFor, pointsAgainst }.
 */
export function poolStandings(pool) {
	const rows = new Map(pool.fighters.map(f => [f.id, { id: f.id, name: f.name, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }]));
	for (const b of pool.bouts) {
		if (!b.result) continue;
		const [x, y] = [rows.get(b.a), rows.get(b.b)];
		if (!x || !y) continue;
		const [sa, sb] = b.result.scores;
		x.played++; y.played++;
		x.pointsFor += sa; x.pointsAgainst += sb;
		y.pointsFor += sb; y.pointsAgainst += sa;
		if (b.result.winner === b.a) { x.wins++; y.losses++; }
		else if (b.result.winner === b.b) { y.wins++; x.losses++; }
	}
	return [...rows.values()].sort((p, q) => q.wins - p.wins || q.pointsFor - p.pointsFor || p.pointsAgainst - q.pointsAgainst);
}

/** Every pairing once, ordered so fighters rest between bouts (the circle method). Returns [a, b] id pairs. */
export function roundRobin(ids) {
	const list = [...ids];
	if (list.length % 2) list.push(null);
	const n = list.length;
	const pairs = [];
	for (let round = 0; round < n - 1; round++) {
		for (let i = 0; i < n / 2; i++) {
			const [a, b] = [list[i], list[n - 1 - i]];
			if (a !== null && b !== null) pairs.push(round % 2 ? [b, a] : [a, b]);
		}
		list.splice(1, 0, list.pop());
	}
	return pairs;
}

export function matchWinner(s) {
	const n = s.settings.playTo;
	if (!n) return null;
	const i = s.fighters.findIndex(f => f.wins >= n);
	return i === -1 ? null : i;
}

/**
 * The Store wraps state with undo history and change notification. Every
 * mutation goes through `apply`, which snapshots first so it can be undone.
 */
export class Store {
	constructor(state = initialState(), { now = () => Date.now() } = {}) {
		this.state = state;
		this.undoStack = [];
		this.now = now;
		this.listeners = new Set();
	}

	subscribe(fn) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	emit() {
		for (const fn of this.listeners) fn(this.state);
	}

	/** Replace state wholesale, e.g. from another window. Not undoable. */
	replace(state, undoStack = this.undoStack) {
		this.state = state;
		this.undoStack = undoStack;
		this.emit();
	}

	/**
	 * `clock: true` marks actions that change the clock on purpose, so undoing
	 * them puts the old time back. Undoing anything else leaves the clock alone.
	 */
	apply(mutate, { undoable = true, clock = false } = {}) {
		const before = structuredClone(this.state);
		const result = mutate(this.state);
		if (result === false) return false;
		if (undoable) {
			this.undoStack.push({ state: before, clock });
			if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
		}
		this.emit();
		return true;
	}

	canUndo() {
		return this.undoStack.length > 0;
	}

	undo() {
		const entry = this.undoStack.pop();
		if (!entry) return false;
		const prev = entry.state;
		// Undoing a hit restores scores and the log but doesn't rewind the
		// clock: if the timer is running it keeps running from where it is now.
		const t = timeLeft(this.state, this.now());
		const running = isRunning(this.state);
		const sameRound = prev.round === this.state.round && prev.suddenDeath === this.state.suddenDeath &&
			prev.rounds.length === this.state.rounds.length;
		if (!entry.clock && sameRound && t > 0) {
			prev.remaining = t;
			prev.startedAt = running ? this.now() : null;
		} else if (!entry.clock && sameRound && this.state.stoppedAtTarget !== null && prev.stoppedAtTarget === null) {
			// Taking back the winning point: back to the time it was scored at, paused.
			prev.remaining = this.state.stoppedAtTarget;
			prev.startedAt = null;
		}
		// Settings changes aren't undoable, so undo never rolls them back.
		prev.settings = this.state.settings;
		prev.pool = this.state.pool;
		this.state = prev;
		this.emit();
		return true;
	}

	// --- timer ---

	start() {
		return this.apply(s => {
			if (isRunning(s) || timeLeft(s) === 0 || isUntimed(s) || s.medical) return false;
			s.startedAt = this.now();
			// Fighting again means any fighter switch has been made.
			s.tagSwitch = null;
		}, { undoable: false });
	}

	pause() {
		return this.apply(s => {
			if (!isRunning(s)) return false;
			s.remaining = timeLeft(s, this.now());
			s.startedAt = null;
		}, { undoable: false });
	}

	/** The table saw an attempt to score, so sudden death goes on without the warning. */
	attempt() {
		return this.apply(s => {
			if (!s.suddenDeath || s.attemptMade) return false;
			s.attemptMade = true;
		}, { undoable: false });
	}

	/** Pauses the bout and starts the medical hold. */
	startMedical() {
		return this.apply(s => {
			if (s.medical) return false;
			if (isRunning(s)) s.remaining = timeLeft(s, this.now());
			s.startedAt = null;
			s.medical = { startedAt: this.now() };
		}, { undoable: false });
	}

	/** The fighter is ready (or out); the bout clock can start again. */
	endMedical() {
		return this.apply(s => {
			if (!s.medical) return false;
			s.medical = null;
		}, { undoable: false });
	}

	toggleClock() {
		return isRunning(this.state) ? this.pause() : this.start();
	}

	/** Called by the UI when the running clock reaches zero. */
	expire() {
		return this.apply(s => {
			if (!isRunning(s) || timeLeft(s, this.now()) > 0) return false;
			s.remaining = 0;
			s.startedAt = null;
			if (s.settings.finalExchange && s.settings.liveScore && !s.suddenDeath) {
				s.finalExchange = true;
				s.showWinner = false;
				this.#logEvent(s, 'final-exchange');
			} else {
				this.#logEvent(s, 'time-up');
			}
		}, { undoable: false });
	}

	/** True while a final exchange can't end without a point: the scores are one apart (Rules 5.13-2b). */
	pointRequired() {
		const [a, b] = this.state.fighters;
		return this.state.finalExchange && Math.abs(a.score - b.score) === 1;
	}

	/** The final exchange ends with no point ("No call", or no attempt to score). */
	noCall() {
		return this.apply(s => {
			if (!s.finalExchange) return false;
			this.#endFinalExchange(s);
			this.#logEvent(s, 'no-call');
		});
	}

	#endFinalExchange(s) {
		s.finalExchange = false;
		s.showWinner = true;
	}

	setTime(ms) {
		return this.apply(s => {
			s.remaining = Math.max(0, ms);
			if (isRunning(s)) s.startedAt = this.now();
		}, { clock: true });
	}

	endRoundNow() {
		return this.apply(s => {
			if (timeLeft(s, this.now()) === 0) return false;
			s.remaining = 0;
			s.startedAt = null;
			this.#logEvent(s, 'round-ended');
		}, { clock: true });
	}

	// --- scoring ---

	#logEvent(s, kind, extra = {}) {
		s.log.push({
			at: this.now(),
			round: s.round,
			suddenDeath: s.suddenDeath,
			clock: timeLeft(s, this.now()),
			kind,
			...extra,
			scores: s.fighters.map(f => f.score),
			simul: s.simul,
		});
	}

	#afterScoring(s) {
		if (s.suddenDeath && leader(s) !== null) {
			s.remaining = 0;
			s.startedAt = null;
		}
		const target = s.settings.pointsToWin;
		if (target && timeLeft(s, this.now()) > 0 && s.fighters.some(f => f.score >= target)) {
			s.stoppedAtTarget = timeLeft(s, this.now());
			this.#logEvent(s, 'target-reached', { side: s.fighters.findIndex(f => f.score >= target) });
			s.remaining = 0;
			s.startedAt = null;
		}
		if (timeLeft(s, this.now()) === 0 && !s.finalExchange) s.showWinner = true;
		// Corners switch once per round at half the target. Tag Team has its own switches.
		const half = Math.ceil(target / 2);
		if (target && !s.sidesCalled && !s.suddenDeath && !isTagTeam(s) && s.remaining > 0 &&
			s.fighters.some(f => f.score >= half && f.score < target)) {
			s.sidesCalled = true;
			s.sidesDue = true;
			this.#logEvent(s, 'switch-sides');
		}
		if (s.settings.pauseAfterScoring && isRunning(s)) {
			s.remaining = timeLeft(s, this.now());
			s.startedAt = null;
		}
	}

	addPoint(side, delta = 1) {
		return this.apply(s => {
			if (!s.settings.liveScore) return false;
			// Scores never go below zero.
			if (s.fighters[side].score + delta < 0) return false;
			s.fighters[side].score += delta;
			s.tagSwitch = null;
			// An awarded point always resolves the final exchange; taking one back doesn't.
			if (s.finalExchange && delta > 0) this.#endFinalExchange(s);
			this.#logEvent(s, 'point', { side, delta });
			this.#afterScoring(s);
		});
	}

	addSimul(delta = 1) {
		return this.apply(s => {
			if (!s.settings.liveScore) return false;
			if (delta < 0 && s.simul === 0) return false;
			const cutoff = s.settings.simulCutoff;
			let taken;
			if (delta > 0) {
				// A simul ends the final exchange, unless the scores are one
				// apart: then only a point can (Rules 5.13-2b).
				if (s.finalExchange && !this.pointRequired()) this.#endFinalExchange(s);
				// The penalty applies from the cutoff-th simul on (1-based), and
				// only while both fighters have a point to lose. If either is at
				// zero, nobody loses one. Tag Team switches fighters instead.
				const tag = isTagTeam(s);
				const penalized = !tag && cutoff && s.simul + 1 >= cutoff && s.fighters.every(f => f.score > 0);
				taken = s.fighters.map(() => (penalized ? 1 : 0));
				s.simulPenalties.push(taken);
				s.fighters.forEach((f, i) => { f.score -= taken[i]; });
				s.tagSwitch = tag ? { stayed: [false, false] } : null;
			} else {
				taken = s.simulPenalties.pop() ?? [0, 0];
				s.fighters.forEach((f, i) => { f.score += taken[i]; });
			}
			s.simul += delta;
			this.#logEvent(s, 'simul', { delta, taken, ...(delta > 0 && isTagTeam(s) ? { tag: true } : {}) });
			this.#afterScoring(s);
		});
	}

	/** Can this team pay a point to keep its fighter in? Not with no points, and never in sudden death (Rules 8.04, 8.05). */
	canStay(side) {
		const s = this.state;
		return !!s.tagSwitch && !s.tagSwitch.stayed[side] && !s.suddenDeath && s.fighters[side].score > 0;
	}

	/** Tag Team: this team takes −1 to skip the switch the simul called for. */
	stay(side) {
		if (!this.canStay(side)) return false;
		return this.apply(s => {
			s.fighters[side].score -= 1;
			s.tagSwitch.stayed[side] = true;
			this.#logEvent(s, 'stay', { side });
		});
	}

	/** The fighters have switched; clear the call from the screens. */
	/** The corners switch was handled (or skipped); clear the call from the screens. */
	sidesDone() {
		return this.apply(s => {
			if (!s.sidesDue) return false;
			s.sidesDue = false;
		}, { undoable: false });
	}

	switchDone() {
		return this.apply(s => {
			if (!s.tagSwitch) return false;
			s.tagSwitch = null;
		}, { undoable: false });
	}

	// --- judges' tally (no live score) ---

	setTally(judge, side, value) {
		return this.apply(s => {
			if (s.tally.published) return false;
			const n = Math.floor(value);
			s.tally.judges[judge][side] = value === null || Number.isNaN(n) ? null : Math.max(0, n);
		}, { undoable: false });
	}

	/** Enough judges have reported both scores to publish. */
	tallyComplete() {
		return tallyResult(this.state).reported >= MIN_JUDGES;
	}

	/** Reveals the averages and the winner on every screen. */
	publishTally() {
		if (!this.tallyComplete() || this.state.tally.published) return false;
		return this.apply(s => {
			const { averages, votes, scores } = tallyResult(s);
			s.fighters.forEach((f, i) => { f.score = scores[i]; });
			s.tally.votes = votes;
			s.tally.averages = averages;
			s.tally.published = true;
			s.showWinner = true;
			// Judges report once the round is over, so publishing closes the clock.
			s.remaining = 0;
			s.startedAt = null;
			this.#logEvent(s, 'tally-published', { votes });
		}, { clock: true });
	}

	/** Takes a published result back so the tallies can be corrected. */
	unpublishTally() {
		return this.apply(s => {
			if (!s.tally.published) return false;
			s.fighters.forEach(f => { f.score = 0; });
			s.tally.published = false;
			if (s.suddenDeath) {
				// Taking the result back also calls off its sudden death.
				s.suddenDeath = false;
				s.remaining = 0;
				s.startedAt = null;
			}
			s.tally.votes = [0, 0];
			s.tally.averages = [0, 0];
			s.tally.tieWinner = null;
			this.#logEvent(s, 'tally-unpublished');
		}, { clock: true });
	}

	/** After a tied tally, the Marshal's sudden death names the winner (Rules 9.12a-2). */
	setTieWinner(side) {
		return this.apply(s => {
			if (!s.tally.published || s.tally.votes[0] !== s.tally.votes[1]) return false;
			s.tally.tieWinner = side;
			// The sudden-death winner gets the higher recorded score.
			recordScores(s.tally.averages, side).forEach((v, i) => { s.fighters[i].score = v; });
			// The Marshal's call ends sudden death.
			s.remaining = 0;
			s.startedAt = null;
			this.#logEvent(s, 'tie-broken', { side });
		}, { clock: true });
	}

	// --- cards (Rules 3.04) ---

	/**
	 * Gives a card. Yellow is a warning, and a second yellow counts as a red.
	 * Red takes a point, and may take the score below zero. Black forfeits the bout.
	 */
	giveCard(side, card, reason = null) {
		if (!(card in CARD_NAMES)) return false;
		return this.apply(s => {
			const f = s.fighters[side];
			let effective = card;
			let converted = false;
			if (card === 'yellow') {
				if (f.cards.yellow >= 1) {
					f.cards.yellow = 0;
					effective = 'red';
					converted = true;
				} else {
					f.cards.yellow = 1;
				}
			}
			let delta = 0;
			if (effective === 'red') {
				f.cards.red++;
				// Unity keeps no live score here; the card is just recorded.
				if (s.settings.liveScore) {
					f.score -= 1;
					delta = -1;
				}
			} else if (effective === 'black') {
				f.cards.black++;
				s.forfeit = side;
				s.remaining = 0;
				s.startedAt = null;
				s.finalExchange = false;
				s.showWinner = true;
			}
			s.tagSwitch = null;
			this.#logEvent(s, 'card', { side, card, effective, converted, reason, delta });
			if (effective === 'red') this.#afterScoring(s);
		}, { clock: card === 'black' });
	}

	/** The fighter didn't show: a 0–10 loss and the bout is over (Rule 5.06). */
	noShow(side) {
		return this.apply(s => {
			if (s.forfeit !== null) return false;
			s.forfeit = side;
			s.noShow = true;
			if (s.settings.liveScore) {
				s.fighters[side].score = 0;
				s.fighters[1 - side].score = s.settings.pointsToWin || NO_SHOW_SCORE;
			}
			s.remaining = 0;
			s.startedAt = null;
			s.finalExchange = false;
			s.sidesDue = false;
			s.tagSwitch = null;
			s.showWinner = true;
			this.#logEvent(s, 'no-show', { side });
		}, { clock: true });
	}

	/** Clears a fighter's cards, e.g. for a new event or a different fighter. */
	clearCards(side) {
		return this.apply(s => {
			s.fighters[side].cards = noCards();
		}, { undoable: false });
	}

	toggleShowWinner() {
		return this.apply(s => {
			if (s.finalExchange) return false;
			s.showWinner = !s.showWinner;
		}, { undoable: false });
	}

	// --- rounds ---

	/** What the next-round button would do right now: 'next', 'tiebreaker', or null. */
	nextRoundAction() {
		const s = this.state;
		if (timeLeft(s, this.now()) > 0) return null;
		if (s.finalExchange) return null;
		if (matchWinner(s) !== null) return null;
		if (!s.settings.liveScore) {
			// Unity: tied or split judge votes go to sudden death, once.
			const tied = s.tally.published && s.tally.votes[0] === s.tally.votes[1] && s.tally.tieWinner === null;
			return tied && !s.suddenDeath ? 'tiebreaker' : 'next';
		}
		return leader(s) !== null || s.suddenDeath ? 'next' : 'tiebreaker';
	}

	nextRound() {
		const action = this.nextRoundAction();
		if (!action) return false;
		return this.apply(s => {
			if (action === 'tiebreaker') {
				s.suddenDeath = true;
				s.attemptMade = false;
				// An untimed sudden death keeps a token sliver on the clock so the round isn't "over" until a winner is named.
				s.remaining = s.settings.tiebreakerDuration || UNTIMED_REMAINING;
				s.startedAt = null;
				this.#logEvent(s, 'tiebreaker');
				return;
			}
			const w = leader(s);
			if (w !== null) s.fighters[w].wins++;
			s.rounds.push({
				round: s.round,
				scores: s.fighters.map(f => f.score),
				simul: s.simul,
				winner: w,
				suddenDeath: s.suddenDeath,
			});
			this.#logEvent(s, 'round-won', { side: w });
			if (matchWinner(s) !== null) return;
			s.round++;
			this.#resetRound(s);
		});
	}

	#resetRound(s) {
		for (const f of s.fighters) f.score = 0;
		s.simul = 0;
		s.simulPenalties = [];
		s.suddenDeath = false;
		s.forfeit = null;
		s.noShow = false;
		s.finalExchange = false;
		s.tagSwitch = null;
		s.sidesCalled = false;
		s.sidesDue = false;
		s.medical = null;
		s.attemptMade = false;
		s.tally = emptyTally();
		s.stoppedAtTarget = null;
		s.remaining = s.settings.duration;
		s.startedAt = null;
		s.showWinner = true;
	}

	resetRound() {
		return this.apply(s => {
			this.#resetRound(s);
			this.#logEvent(s, 'round-reset');
		});
	}

	/** Start a new match. Keeps fighter names/colors and settings unless `full`. */
	newMatch({ full = false } = {}) {
		return this.apply(s => {
			const fresh = initialState(s.settings);
			if (!full) {
				fresh.fighters = s.fighters.map(f => ({ ...f, score: 0, wins: 0 }));
			}
			Object.assign(s, fresh);
		});
	}

	swapSides() {
		return this.apply(s => {
			s.sidesDue = false;
			s.fighters.reverse();
			s.simulPenalties = s.simulPenalties.map(p => [...p].reverse());
			s.tally.judges = s.tally.judges.map(j => [...j].reverse());
			s.tally.votes = [...s.tally.votes].reverse();
			s.tally.averages = [...s.tally.averages].reverse();
			if (s.tally.tieWinner !== null) s.tally.tieWinner = 1 - s.tally.tieWinner;
			for (const e of s.log) {
				e.scores = [...e.scores].reverse();
				if (typeof e.side === 'number') e.side = 1 - e.side;
			}
			for (const r of s.rounds) {
				r.scores = [...r.scores].reverse();
				if (r.winner !== null) r.winner = 1 - r.winner;
			}
		});
	}

	// --- pool ---

	/** The pool's setup is locked once a result is recorded. */
	#poolLocked() {
		return this.state.pool.bouts.some(b => b.result);
	}

	addPoolFighter(name) {
		const clean = String(name).trim().slice(0, 40);
		return this.apply(s => {
			if (!clean || this.#poolLocked() || s.pool.fighters.some(f => f.name.toLowerCase() === clean.toLowerCase())) return false;
			s.pool.fighters.push({ id: s.pool.nextId++, name: clean, cards: noCards() });
			s.pool.bouts = [];
			s.pool.active = null;
		}, { undoable: false });
	}

	removePoolFighter(id) {
		return this.apply(s => {
			if (this.#poolLocked() || !s.pool.fighters.some(f => f.id === id)) return false;
			s.pool.fighters = s.pool.fighters.filter(f => f.id !== id);
			s.pool.bouts = [];
			s.pool.active = null;
		}, { undoable: false });
	}

	/** Lays out every pairing once. */
	buildPoolBouts() {
		return this.apply(s => {
			if (this.#poolLocked() || s.pool.fighters.length < 2) return false;
			s.pool.bouts = roundRobin(s.pool.fighters.map(f => f.id)).map(([a, b], i) => ({ id: i + 1, a, b, result: null }));
			s.pool.active = null;
		}, { undoable: false });
	}

	/** Empties the pool: fighters, bouts and results. */
	clearPool() {
		return this.apply(s => {
			s.pool = emptyPool();
		}, { undoable: false });
	}

	/** Puts a bout's two fighters on the scoreboard, with a fresh round and the cards they already carry. */
	loadPoolBout(boutId) {
		return this.apply(s => {
			const bout = s.pool.bouts.find(b => b.id === boutId);
			if (!bout || bout.result) return false;
			const fresh = initialState(s.settings);
			Object.assign(s, { ...fresh, pool: s.pool });
			[bout.a, bout.b].forEach((id, i) => {
				const pf = s.pool.fighters.find(f => f.id === id);
				Object.assign(s.fighters[i], { name: pf.name, subtitle: '', poolId: id, cards: structuredClone(pf.cards) });
			});
			s.pool.active = boutId;
		}, { undoable: false });
	}

	/** Records the loaded bout's result once it is decided, and carries the cards back to the pool. */
	recordPoolBout() {
		return this.apply(s => {
			const bout = s.pool.bouts.find(b => b.id === s.pool.active);
			if (!bout || !boutDecided(s, this.now())) return false;
			const ids = s.fighters.map(f => f.poolId);
			if (!ids.includes(bout.a) || !ids.includes(bout.b)) return false;
			const scores = boutScores(s);
			const w = leader(s);
			bout.result = {
				scores: [scores[ids.indexOf(bout.a)], scores[ids.indexOf(bout.b)]],
				winner: w === null ? null : ids[w],
			};
			s.fighters.forEach(f => {
				const pf = s.pool.fighters.find(x => x.id === f.poolId);
				if (pf) pf.cards = structuredClone(f.cards);
			});
			s.pool.active = null;
		}, { undoable: false });
	}

	/** Takes a recorded result back, e.g. when it was entered for the wrong bout. */
	clearPoolResult(boutId) {
		return this.apply(s => {
			const bout = s.pool.bouts.find(b => b.id === boutId);
			if (!bout?.result) return false;
			bout.result = null;
		}, { undoable: false });
	}

	// --- setup ---

	updateFighter(side, changes) {
		return this.apply(s => {
			const f = s.fighters[side];
			// Keep the default name in step with the color, like the original app.
			if (changes.color && !('name' in changes) && f.name === COLORS[f.color]?.label) {
				f.name = COLORS[changes.color].label;
			}
			Object.assign(f, changes);
		}, { undoable: false });
	}

	updateSettings(changes) {
		return this.apply(s => {
			const durationChanged = 'duration' in changes && changes.duration !== s.settings.duration;
			Object.assign(s.settings, changes);
			// If the round hasn't started, the new duration applies right away.
			if (durationChanged && !s.suddenDeath && !isRunning(s) && s.remaining !== 0 &&
				!s.fighters.some(f => f.score) && s.simul === 0) {
				s.remaining = s.settings.duration;
			}
			// Turning Final Exchange off mid-exchange decides the bout now.
			if (changes.finalExchange === false && s.finalExchange) {
				s.finalExchange = false;
				s.showWinner = true;
			}
		}, { undoable: false });
	}

	applyPreset(id) {
		const preset = MATCH_PRESETS.find(p => p.id === id);
		if (!preset) return false;
		return this.updateSettings(preset.settings);
	}

	/**
	 * Picks the division. Championship Series is best of 3, so entering it
	 * sets that up; leaving it clears it, unless it was changed by hand.
	 */
	#selectDivision(st, division) {
		const was = st.division;
		if (division === ROUNDS_DIVISION && was !== ROUNDS_DIVISION && !st.playTo) {
			st.playTo = CS_ROUNDS_TO_WIN;
		} else if (was === ROUNDS_DIVISION && division !== ROUNDS_DIVISION && st.playTo === CS_ROUNDS_TO_WIN) {
			st.playTo = 0;
		}
		st.division = division;
	}

	setDivision(name) {
		return this.apply(s => {
			this.#selectDivision(s.settings, String(name ?? '').trim());
		}, { undoable: false });
	}

	/** Adds a typed-in division to the saved list (once) and selects it. */
	addCustomDivision(name) {
		const clean = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
		if (!clean) return false;
		return this.apply(s => {
			const st = s.settings;
			const same = d => d.toLowerCase() === clean.toLowerCase();
			const existing = DIVISIONS.find(same) ?? st.customDivisions.find(same);
			if (!existing) st.customDivisions = [...st.customDivisions, clean];
			this.#selectDivision(st, existing ?? clean);
		}, { undoable: false });
	}

	removeCustomDivision(name) {
		return this.apply(s => {
			const st = s.settings;
			if (!st.customDivisions.includes(name)) return false;
			st.customDivisions = st.customDivisions.filter(d => d !== name);
			if (st.division === name) this.#selectDivision(st, '');
		}, { undoable: false });
	}

	setRound(n) {
		return this.apply(s => {
			s.round = Math.max(1, Math.floor(n) || 1);
		});
	}

	setWins(side, n) {
		return this.apply(s => {
			s.fighters[side].wins = Math.max(0, Math.floor(n) || 0);
		});
	}
}

// --- formatting ---

export function formatClock(ms, { hundredths = true } = {}) {
	const m = Math.floor(ms / 60000);
	const sec = Math.floor(ms / 1000) % 60;
	const base = `${m}:${String(sec).padStart(2, '0')}`;
	if (!hundredths) return base;
	return `${base}.${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`;
}

/** Parses "m:ss", "ss", or "m:ss.ms". Returns ms, or null if invalid. */
export function parseClock(str) {
	const m = /^(?:(\d+):)?(\d+)(?:\.(\d+))?$/.exec(String(str).trim());
	if (!m) return null;
	const [, min, sec, frac] = m;
	const ms = parseInt((frac || '0').slice(0, 3).padEnd(3, '0'), 10);
	return (parseInt(min || '0', 10) * 60 + parseInt(sec, 10)) * 1000 + ms;
}

export function fighterLabel(s, side) {
	return s.fighters[side].name || (side === 0 ? 'Left' : 'Right');
}

export function describeEvent(s, e) {
	const who = i => (typeof i === 'number' ? fighterLabel(s, i) : '');
	switch (e.kind) {
	case 'point': return `${e.delta > 0 ? '+1' : '−1'} ${who(e.side)}`;
	case 'simul': {
		if (e.delta < 0) return 'Simul removed';
		if (e.tag) return 'Simul (switch fighters)';
		const taken = e.taken ?? (e.penalty ? [1, 1] : [0, 0]);
		if (taken[0] && taken[1]) return 'Simul (−1 both)';
		if (taken[0] || taken[1]) return `Simul (−1 ${who(taken[0] ? 0 : 1)})`;
		return 'Simul';
	}
	case 'card': {
		const why = e.reason ? ` · ${e.reason}` : '';
		if (e.converted) return `${who(e.side)} second yellow, red card${e.delta ? ' −1' : ''}${why}`;
		const base = `${who(e.side)} ${e.card} card`;
		if (e.card === 'black') return `${base}, forfeit${why}`;
		return `${base}${e.delta ? ' −1' : ''}${why}`;
	}
	case 'time-up': return 'Time up';
	case 'tally-published': return `Judges' tally published: ${e.votes[0]}–${e.votes[1]} votes, score ${e.scores[0]}–${e.scores[1]}`;
	case 'tally-unpublished': return 'Tally taken back';
	case 'tie-broken': return `Tie decided in sudden death: ${who(e.side)}`;
	case 'no-show': return `${who(e.side)} did not show, ${e.scores[1 - e.side]}–${e.scores[e.side]} forfeit`;
	case 'switch-sides': return 'Switch sides';
	case 'final-exchange': return 'Final exchange';
	case 'no-call': return 'No call, bout over';
	case 'stay': return `${who(e.side)} took −1 to stay in`;
	case 'target-reached': return `${who(e.side)} reached ${e.scores[e.side]}`;
	case 'round-ended': return 'Round ended early';
	case 'tiebreaker': return 'Tiebreaker (sudden death)';
	case 'round-won': return e.side === null ? 'Round over, no winner' : `Round won by ${who(e.side)}`;
	case 'round-reset': return 'Round reset';
	default: return e.kind;
	}
}

export function logToCSV(s) {
	const esc = v => `"${String(v).replace(/"/g, '""')}"`;
	const rows = [['time', 'round', 'clock', 'event', s.fighters[0].name, s.fighters[1].name, 'simuls']];
	for (const e of s.log) {
		rows.push([
			new Date(e.at).toISOString(),
			e.round + (e.suddenDeath ? ' (SD)' : ''),
			formatClock(e.clock),
			describeEvent(s, e),
			e.scores[0],
			e.scores[1],
			e.simul,
		]);
	}
	return rows.map(r => r.map(esc).join(',')).join('\n');
}
