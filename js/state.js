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
	/** After time runs out, hide the winner until the judge reveals it. */
	holdWinnerAtTimeUp: false,
	sound: true,
};

/** Quick setups for the usual match types. Each sets only the rules it lists. */
export const MATCH_PRESETS = [
	{ id: 'standard', label: 'Standard', note: '2:30, first to 10', settings: { duration: 150_000, pointsToWin: 10, liveScore: true } },
	{ id: 'two-minute', label: '2 Minute Standard', note: '2:00, first to 10', settings: { duration: 120_000, pointsToWin: 10, liveScore: true } },
	{ id: 'unity', label: 'Unity', note: '1:00', settings: { duration: 60_000, pointsToWin: 0, liveScore: false } },
];

export const DIVISIONS = ['Standard', 'Exotics', 'Unity', 'Tag Team', 'Redemption', 'Masters', "Women's", 'Championship Series'];

/** The preset the current rules match, or null if they've been changed by hand. */
export function activePreset(settings) {
	return MATCH_PRESETS.find(p => Object.entries(p.settings).every(([k, v]) => settings[k] === v)) ?? null;
}

const UNDO_LIMIT = 100;

function fighter(color) {
	return { name: COLORS[color].label, subtitle: '', color, score: 0, wins: 0 };
}

export function initialState(settings = DEFAULT_SETTINGS) {
	return {
		version: 2,
		round: 1,
		fighters: [fighter('blue'), fighter('red')],
		simul: 0,
		/** Points each simul actually took from [left, right], so removing it gives back the same. */
		simulPenalties: [],
		suddenDeath: false,
		/** Time left when a fighter reached the winning score, so undoing that point can give it back. */
		stoppedAtTarget: null,
		showWinner: !settings.holdWinnerAtTimeUp,
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
	};
}

export function timeLeft(s, now = Date.now()) {
	const elapsed = s.startedAt === null ? 0 : now - s.startedAt;
	return Math.max(s.remaining - elapsed, 0);
}

export const isRunning = s => s.startedAt !== null;
export const isTimeUp = (s, now) => timeLeft(s, now) === 0;
export const hasStarted = s => isRunning(s) || s.remaining !== s.settings.duration ||
	s.fighters.some(f => f.score) || s.simul > 0;

/** Index of the fighter ahead on points, or null on a tie. */
export function leader(s) {
	const [a, b] = s.fighters;
	if (a.score === b.score) return null;
	return a.score > b.score ? 0 : 1;
}

/** Index of the fighter who has won the match, or null. */
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
		this.state = prev;
		this.emit();
		return true;
	}

	// --- timer ---

	start() {
		return this.apply(s => {
			if (isRunning(s) || timeLeft(s) === 0) return false;
			s.startedAt = this.now();
		}, { undoable: false });
	}

	pause() {
		return this.apply(s => {
			if (!isRunning(s)) return false;
			s.remaining = timeLeft(s, this.now());
			s.startedAt = null;
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
			this.#logEvent(s, 'time-up');
		}, { undoable: false });
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
		if (timeLeft(s, this.now()) === 0) s.showWinner = true;
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
				// The penalty applies from the cutoff-th simul on (1-based), and
				// only while both fighters have a point to lose. If either is at
				// zero, nobody loses one.
				const penalized = cutoff && s.simul + 1 >= cutoff && s.fighters.every(f => f.score > 0);
				taken = s.fighters.map(() => (penalized ? 1 : 0));
				s.simulPenalties.push(taken);
				s.fighters.forEach((f, i) => { f.score -= taken[i]; });
			} else {
				taken = s.simulPenalties.pop() ?? [0, 0];
				s.fighters.forEach((f, i) => { f.score += taken[i]; });
			}
			s.simul += delta;
			this.#logEvent(s, 'simul', { delta, taken });
			this.#afterScoring(s);
		});
	}

	toggleShowWinner() {
		return this.apply(s => {
			s.showWinner = !s.showWinner;
		}, { undoable: false });
	}

	// --- rounds ---

	/** What the next-round button would do right now: 'next', 'tiebreaker', or null. */
	nextRoundAction() {
		const s = this.state;
		if (timeLeft(s, this.now()) > 0) return null;
		if (matchWinner(s) !== null) return null;
		// Without a live score there's no winner or tiebreaker to decide here.
		if (!s.settings.liveScore) return 'next';
		return leader(s) !== null || s.suddenDeath ? 'next' : 'tiebreaker';
	}

	nextRound() {
		const action = this.nextRoundAction();
		if (!action) return false;
		return this.apply(s => {
			if (action === 'tiebreaker') {
				s.suddenDeath = true;
				s.remaining = s.settings.tiebreakerDuration;
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
		s.stoppedAtTarget = null;
		s.remaining = s.settings.duration;
		s.startedAt = null;
		s.showWinner = !s.settings.holdWinnerAtTimeUp;
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
			s.fighters.reverse();
			s.simulPenalties = s.simulPenalties.map(p => [...p].reverse());
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
			if ('holdWinnerAtTimeUp' in changes && timeLeft(s, this.now()) > 0) {
				s.showWinner = !changes.holdWinnerAtTimeUp;
			}
		}, { undoable: false });
	}

	applyPreset(id) {
		const preset = MATCH_PRESETS.find(p => p.id === id);
		if (!preset) return false;
		return this.updateSettings(preset.settings);
	}

	setDivision(name) {
		return this.updateSettings({ division: String(name ?? '').trim() });
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
			st.division = existing ?? clean;
		}, { undoable: false });
	}

	removeCustomDivision(name) {
		return this.apply(s => {
			const st = s.settings;
			if (!st.customDivisions.includes(name)) return false;
			st.customDivisions = st.customDivisions.filter(d => d !== name);
			if (st.division === name) st.division = '';
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
		const taken = e.taken ?? (e.penalty ? [1, 1] : [0, 0]);
		if (taken[0] && taken[1]) return 'Simul (−1 both)';
		if (taken[0] || taken[1]) return `Simul (−1 ${who(taken[0] ? 0 : 1)})`;
		return 'Simul';
	}
	case 'time-up': return 'Time up';
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
