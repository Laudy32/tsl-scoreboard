import {
	COLORS, Store, normalize, timeLeft, isRunning, hasStarted, leader, matchWinner,
	formatClock, parseClock, fighterLabel, describeEvent, logToCSV,
} from './state.js';

const STORAGE_KEY = 'tsl_scoreboard';
// A display opened in its own window (?view=display) only shows the score.
// A display switched on in this window (F) still takes keyboard input and
// runs the clock, since no other window is controlling it.
const displayWindow = new URLSearchParams(location.search).get('view') === 'display';
let view = displayWindow ? 'display' : 'control';
document.body.dataset.view = view;

// --- persistence and sync between windows on this device ---

function load() {
	try {
		const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
		return { state: normalize(saved?.state), undo: Array.isArray(saved?.undo) ? saved.undo : [] };
	} catch {
		return { state: normalize(null), undo: [] };
	}
}

const loaded = load();
const store = new Store(loaded.state);
store.undoStack = loaded.undo;
let lastSaved = '';

store.subscribe(() => {
	const json = JSON.stringify({ state: store.state, undo: store.undoStack });
	if (json === lastSaved) return;
	lastSaved = json;
	try {
		localStorage.setItem(STORAGE_KEY, json);
	} catch {
		// Storage full or blocked: keep running from memory.
	}
});

window.addEventListener('storage', e => {
	if (e.key !== STORAGE_KEY || !e.newValue || e.newValue === lastSaved) return;
	lastSaved = e.newValue;
	const next = load();
	store.replace(next.state, next.undo);
});

// --- helpers ---

const $ = sel => document.querySelector(sel);
const esc = v => String(v).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const hex = color => COLORS[color]?.hex ?? '#555';

function dots(s, side) {
	const f = s.fighters[side];
	const total = Math.max(s.settings.playTo, f.wins);
	if (!total) return '';
	let out = '';
	for (let i = 0; i < total; i++) out += `<span class="dot${i < f.wins ? ' on' : ''}"></span>`;
	return `<div class="dots" aria-label="${f.wins} round wins">${out}</div>`;
}

function subtitle(f) {
	if (!f.subtitle) return '';
	return `<div class="subtitle">${f.subtitle.split('\n').map(esc).join('<br>')}</div>`;
}

/** The big line under the clock: winner, tie, time up, sudden death, paused. */
function statusLine(s) {
	const mw = matchWinner(s);
	if (mw !== null) {
		return `<span class="status win" style="--c:${hex(s.fighters[mw].color)}">Match won by <strong>${esc(fighterLabel(s, mw))}</strong></span>`;
	}
	if (timeLeft(s) === 0) {
		if (!s.showWinner && !s.suddenDeath) return '<span class="status alert">Time up</span>';
		const w = leader(s);
		if (w === null) return '<span class="status alert">Tie</span>';
		return `<span class="status win" style="--c:${hex(s.fighters[w].color)}">Winner: <strong>${esc(fighterLabel(s, w))}</strong></span>`;
	}
	if (s.suddenDeath) return '<span class="status alert">Sudden death</span>';
	if (!isRunning(s) && hasStarted(s)) return '<span class="status muted">Paused</span>';
	return '<span class="status muted">&nbsp;</span>';
}

// --- control view ---

function primaryButton(s) {
	if (timeLeft(s) === 0) {
		return `<button class="btn primary" data-action="winner">${s.showWinner ? 'Hide winner' : 'Show winner'}</button>`;
	}
	if (isRunning(s)) return '<button class="btn primary pause" data-action="clock">Pause</button>';
	return `<button class="btn primary go" data-action="clock">${hasStarted(s) ? 'Resume' : 'Start'}</button>`;
}

function fighterPanel(s, side) {
	const f = s.fighters[side];
	const key = side === 0 ? ['Q', 'A'] : ['E', 'D'];
	return `<div class="fighter" style="--c:${hex(f.color)}">
		<button class="score-btn" data-action="point" data-side="${side}" aria-label="Add a point for ${esc(fighterLabel(s, side))}">
			<span class="name">${esc(fighterLabel(s, side))}</span>
			${subtitle(f)}
			<span class="score">${f.score}</span>
			<span class="hint">tap +1 <kbd>${key[0]}</kbd></span>
		</button>
		${dots(s, side)}
		<button class="btn minus" data-action="point" data-side="${side}" data-delta="-1">−1 <kbd>${key[1]}</kbd></button>
	</div>`;
}

function renderControl(s) {
	const next = store.nextRoundAction();
	const timeUp = timeLeft(s) === 0;
	const cutoff = s.settings.simulCutoff;
	return `
	<header class="bar">
		<button class="round-pill" data-action="settings">Round ${s.round}${s.suddenDeath ? ' · SD' : ''}</button>
		<div class="bar-actions">
			<button class="btn small" data-action="history">History</button>
			<button class="btn small" data-action="display">Display</button>
			<button class="btn small" data-action="settings">Settings</button>
		</div>
	</header>
	<main class="control">
		<button class="clock${isRunning(s) ? ' running' : ''}${timeUp ? ' up' : ''}" data-action="clock" aria-label="Start or pause the clock">
			<span data-clock>${formatClock(timeLeft(s))}</span>
		</button>
		<div class="status-row">${statusLine(s)}</div>

		<div class="fighters">
			${fighterPanel(s, 0)}
			<div class="fighter simul">
				<button class="score-btn" data-action="simul" aria-label="Add a simul">
					<span class="name">Simul</span>
					<span class="score">${s.simul}</span>
					<span class="hint">${cutoff ? `−1 both from #${cutoff}` : 'no penalty'} <kbd>W</kbd></span>
				</button>
				<button class="btn minus" data-action="simul" data-delta="-1" ${s.simul ? '' : 'disabled'}>−1 <kbd>S</kbd></button>
			</div>
			${fighterPanel(s, 1)}
		</div>

		<div class="actions">
			${primaryButton(s)}
			<div class="row">
				<button class="btn" data-action="undo" ${store.canUndo() ? '' : 'disabled'}>Undo <kbd>Z</kbd></button>
				<button class="btn" data-action="next" ${next ? '' : 'disabled'}>${next === 'tiebreaker' ? 'Tiebreaker' : 'Next round'} <kbd>N</kbd></button>
				<button class="btn" data-action="end" ${timeUp ? 'disabled' : ''}>End round</button>
			</div>
			${matchWinner(s) !== null ? '<button class="btn wide" data-action="new-match">Start a new match</button>' : ''}
		</div>

		<details class="help">
			<summary>Keyboard shortcuts</summary>
			<table>
				<tr><td><kbd>Q</kbd> / <kbd>A</kbd></td><td>+1 / −1 left fighter</td></tr>
				<tr><td><kbd>W</kbd> / <kbd>S</kbd></td><td>+1 / −1 simul</td></tr>
				<tr><td><kbd>E</kbd> / <kbd>D</kbd></td><td>+1 / −1 right fighter</td></tr>
				<tr><td><kbd>Space</kbd></td><td>Start / pause (show winner after time up)</td></tr>
				<tr><td><kbd>N</kbd></td><td>Next round or tiebreaker</td></tr>
				<tr><td><kbd>Z</kbd></td><td>Undo</td></tr>
				<tr><td><kbd>F</kbd></td><td>Open the spectator display</td></tr>
			</table>
			<p>Right-clicking a score also takes a point off. The spectator display stays in sync with this screen; put it on a second monitor or TV.</p>
		</details>
	</main>`;
}

// --- display view ---

function renderDisplay(s) {
	const side = i => {
		const f = s.fighters[i];
		return `<div class="d-fighter" style="--c:${hex(f.color)}">
			<div class="d-name">${esc(fighterLabel(s, i))}</div>
			${subtitle(f)}
			<div class="d-score">${f.score}</div>
			${dots(s, i)}
		</div>`;
	};
	return `<main class="display" data-action="fullscreen">
		<div class="d-top">
			<div class="d-round">Round ${s.round}</div>
			<div class="d-clock${timeLeft(s) === 0 ? ' up' : ''}"><span data-clock>${formatClock(timeLeft(s))}</span></div>
			<div class="d-status">${statusLine(s)}</div>
		</div>
		<div class="d-fighters">
			${side(0)}
			<div class="d-simul"><div class="d-label">Simul</div><div class="d-simul-n">${s.simul}</div></div>
			${side(1)}
		</div>
		<img class="d-banner" src="assets/banner.jpg" alt="The Saber Legion" />
		${displayWindow ? '' : '<button class="btn small d-back" data-action="controls">Back to controls <kbd>F</kbd></button>'}
	</main>`;
}

// --- settings sheet ---

function colorOptions(selected) {
	return Object.entries(COLORS).map(([k, c]) =>
		`<option value="${k}"${k === selected ? ' selected' : ''}>${c.label}</option>`).join('');
}

function renderSettings(s) {
	const st = s.settings;
	const fighterFields = side => {
		const f = s.fighters[side];
		return `<fieldset class="fighter-fields" style="--c:${hex(f.color)}">
			<legend>${side === 0 ? 'Left' : 'Right'} fighter</legend>
			<label>Name <input data-fighter="${side}" data-field="name" value="${esc(f.name)}" autocomplete="off" /></label>
			<label>Subtitle <textarea data-fighter="${side}" data-field="subtitle" rows="2">${esc(f.subtitle)}</textarea></label>
			<label>Color <select data-fighter="${side}" data-field="color">${colorOptions(f.color)}</select></label>
			<label>Rounds won <input type="number" min="0" inputmode="numeric" data-wins="${side}" value="${f.wins}" /></label>
		</fieldset>`;
	};
	return `<form method="dialog" class="sheet-body">
		<header class="sheet-head"><h2>Settings</h2><button class="btn small" value="close">Done</button></header>

		<section>
			<h3>Fighters</h3>
			<div class="two-col">${fighterFields(0)}${fighterFields(1)}</div>
			<button type="button" class="btn" data-action="swap">Swap sides</button>
		</section>

		<section>
			<h3>This round</h3>
			<div class="two-col">
				<label>Round number <input type="number" min="1" inputmode="numeric" id="round-number" value="${s.round}" /></label>
				<label>Time left
					<span class="inline"><input id="time-left" value="${formatClock(timeLeft(s), { hundredths: false })}" inputmode="decimal" /><button type="button" class="btn small" data-action="set-time">Set</button></span>
				</label>
			</div>
		</section>

		<section>
			<h3>Rules</h3>
			<div class="two-col">
				<label>Round length <input data-setting="duration" data-kind="clock" value="${formatClock(st.duration, { hundredths: false })}" inputmode="decimal" /></label>
				<label>Tiebreaker length <input data-setting="tiebreakerDuration" data-kind="clock" value="${formatClock(st.tiebreakerDuration, { hundredths: false })}" inputmode="decimal" /></label>
				<label>Rounds to win the match <input type="number" min="0" inputmode="numeric" data-setting="playTo" data-kind="int" value="${st.playTo || ''}" placeholder="No limit" /></label>
				<label>Simul penalty starts at <input type="number" min="0" inputmode="numeric" data-setting="simulCutoff" data-kind="int" value="${st.simulCutoff || ''}" placeholder="Never" /></label>
			</div>
			<label class="check"><input type="checkbox" data-setting="pauseAfterScoring" ${st.pauseAfterScoring ? 'checked' : ''} /> Pause the clock after every point</label>
			<label class="check"><input type="checkbox" data-setting="holdWinnerAtTimeUp" ${st.holdWinnerAtTimeUp ? 'checked' : ''} /> At time up, wait for last points before showing the winner</label>
			<label class="check"><input type="checkbox" data-setting="sound" ${st.sound ? 'checked' : ''} /> Beep and vibrate at time up</label>
		</section>

		<section>
			<h3>Reset</h3>
			<div class="row wrap">
				<button type="button" class="btn" data-action="reset-round">Reset round</button>
				<button type="button" class="btn" data-action="new-match">New match, same fighters</button>
				<button type="button" class="btn danger" data-action="reset-all">Reset everything</button>
			</div>
		</section>
	</form>`;
}

// --- history sheet ---

function renderHistory(s) {
	const rows = [...s.log].reverse().map(e => `<tr>
		<td>R${e.round}${e.suddenDeath ? ' SD' : ''}</td>
		<td>${formatClock(e.clock, { hundredths: false })}</td>
		<td>${esc(describeEvent(s, e))}</td>
		<td class="num">${e.scores[0]}–${e.scores[1]}</td>
	</tr>`).join('');
	const rounds = s.rounds.map(r => `<li>Round ${r.round}${r.suddenDeath ? ' (sudden death)' : ''}: ${r.scores[0]}–${r.scores[1]}, ${r.winner === null ? 'no winner' : esc(fighterLabel(s, r.winner))}${r.simul ? `, ${r.simul} simul${r.simul > 1 ? 's' : ''}` : ''}</li>`).join('');
	return `<form method="dialog" class="sheet-body">
		<header class="sheet-head"><h2>History</h2><button class="btn small" value="close">Done</button></header>
		${rounds ? `<section><h3>Rounds</h3><ul class="rounds">${rounds}</ul></section>` : ''}
		<section>
			<h3>Every action, newest first</h3>
			${rows ? `<table class="log"><thead><tr><th>Round</th><th>Clock</th><th>Event</th><th class="num">${esc(fighterLabel(s, 0))}–${esc(fighterLabel(s, 1))}</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Nothing scored yet.</p>'}
		</section>
		<div class="row"><button type="button" class="btn" data-action="export" ${rows ? '' : 'disabled'}>Download as CSV</button></div>
	</form>`;
}

// --- rendering ---

const app = $('#app');
const settingsDialog = $('#settings');
const historyDialog = $('#history');

function render() {
	const s = store.state;
	app.innerHTML = view === 'display' ? renderDisplay(s) : renderControl(s);
	document.documentElement.style.setProperty('--left', hex(s.fighters[0].color));
	document.documentElement.style.setProperty('--right', hex(s.fighters[1].color));
	// History is read-only, so it can re-render live. Settings is not
	// re-rendered while open, so typing isn't interrupted.
	if (historyDialog.open) historyDialog.innerHTML = renderHistory(s);
}
store.subscribe(render);
render();

// The clock text updates every frame without re-rendering the page.
let wasRunning = isRunning(store.state);
function tick() {
	const s = store.state;
	const left = timeLeft(s);
	const text = formatClock(left);
	for (const el of document.querySelectorAll('[data-clock]')) {
		if (el.textContent !== text) el.textContent = text;
	}
	if (isRunning(s) && left === 0 && !displayWindow) {
		store.expire();
		if (s.settings.sound) alarm();
	}
	if (wasRunning !== isRunning(s)) wakeLock(isRunning(s) || view === 'display');
	wasRunning = isRunning(s);
	requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// --- sound, vibration, screen wake lock ---

let audio;
function alarm() {
	try {
		audio ??= new AudioContext();
		const t = audio.currentTime;
		for (let i = 0; i < 3; i++) {
			const osc = audio.createOscillator();
			const gain = audio.createGain();
			osc.frequency.value = 880;
			gain.gain.setValueAtTime(0.4, t + i * 0.35);
			gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.35 + 0.3);
			osc.connect(gain).connect(audio.destination);
			osc.start(t + i * 0.35);
			osc.stop(t + i * 0.35 + 0.3);
		}
	} catch {
		// No audio available.
	}
	navigator.vibrate?.([300, 100, 300, 100, 300]);
}

// Browsers only allow audio after a tap, so warm it up on the first one.
window.addEventListener('pointerdown', () => {
	try {
		audio ??= new AudioContext();
		audio.resume();
	} catch {
		// ignore
	}
}, { once: true });

let lock = null;
async function wakeLock(on) {
	try {
		if (on && !lock && navigator.wakeLock && document.visibilityState === 'visible') {
			lock = await navigator.wakeLock.request('screen');
			lock.addEventListener('release', () => { lock = null; });
		} else if (!on && lock) {
			await lock.release();
		}
	} catch {
		// Wake lock refused (battery saver, unsupported): not critical.
	}
}
document.addEventListener('visibilitychange', () => wakeLock(isRunning(store.state) || view === 'display'));
if (view === 'display') wakeLock(true);

// --- confirm dialog ---

function confirmAction(text, okLabel) {
	const dlg = $('#confirm');
	$('#confirm-text').textContent = text;
	$('#confirm-ok').textContent = okLabel;
	dlg.returnValue = '';
	dlg.showModal();
	return new Promise(resolve => {
		dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
	});
}

// --- actions ---

function openSettings() {
	store.pause();
	settingsDialog.innerHTML = renderSettings(store.state);
	settingsDialog.showModal();
}

function openHistory() {
	historyDialog.innerHTML = renderHistory(store.state);
	historyDialog.showModal();
}

function setView(next) {
	view = next;
	document.body.dataset.view = view;
	render();
	wakeLock(isRunning(store.state) || view === 'display');
}

function openDisplay() {
	let win = null;
	try {
		win = window.open(`${location.pathname}?view=display`, 'tsl-display', 'popup,width=1280,height=720');
	} catch {
		// Popups blocked.
	}
	// No second window (blocked, or an embedded preview): show it here instead.
	if (!win) setView('display');
}

function exportCSV() {
	const blob = new Blob([logToCSV(store.state)], { type: 'text/csv' });
	const a = document.createElement('a');
	const s = store.state;
	a.href = URL.createObjectURL(blob);
	a.download = `tsl-${fighterLabel(s, 0)}-vs-${fighterLabel(s, 1)}-${new Date().toISOString().slice(0, 10)}.csv`.replace(/[^\w.-]+/g, '_');
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const actions = {
	clock: () => store.toggleClock(),
	point: el => store.addPoint(+el.dataset.side, +(el.dataset.delta || 1)),
	simul: el => store.addSimul(+(el.dataset.delta || 1)),
	winner: () => store.toggleShowWinner(),
	undo: () => store.undo(),
	next: () => store.nextRound(),
	end: async () => {
		if (await confirmAction('End this round now? The clock goes to zero.', 'End round')) store.endRoundNow();
	},
	settings: openSettings,
	history: openHistory,
	display: openDisplay,
	export: exportCSV,
	swap: () => {
		store.swapSides();
		settingsDialog.innerHTML = renderSettings(store.state);
	},
	'set-time': () => {
		const input = $('#time-left');
		const ms = parseClock(input.value);
		if (ms === null) {
			input.setCustomValidity('Use minutes:seconds, like 2:30');
			input.reportValidity();
			return;
		}
		input.setCustomValidity('');
		store.setTime(ms);
	},
	'reset-round': async () => {
		if (await confirmAction('Reset this round? Scores, simuls and the clock go back to the start. You can undo this.', 'Reset round')) {
			store.resetRound();
			settingsDialog.close();
		}
	},
	'new-match': async () => {
		if (await confirmAction('Start a new match with the same fighters? Scores, round wins and history are cleared. You can undo this.', 'New match')) {
			store.newMatch();
			settingsDialog.close();
		}
	},
	'reset-all': async () => {
		if (await confirmAction('Reset everything, including fighter names and colors? Your rule settings are kept. You can undo this.', 'Reset everything')) {
			store.newMatch({ full: true });
			settingsDialog.close();
		}
	},
	controls: () => setView('control'),
	fullscreen: () => {
		if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
	},
};

document.addEventListener('click', e => {
	const el = e.target.closest('[data-action]');
	if (!el || el.disabled) return;
	actions[el.dataset.action]?.(el);
});

// Right-click a score to take a point off, like the original.
document.addEventListener('contextmenu', e => {
	const el = e.target.closest('.score-btn');
	if (!el) return;
	e.preventDefault();
	if (el.dataset.action === 'point') store.addPoint(+el.dataset.side, -1);
	else if (el.dataset.action === 'simul') store.addSimul(-1);
});

// Settings fields apply as soon as they change.
settingsDialog.addEventListener('input', e => {
	const el = e.target;
	if (el.dataset.fighter !== undefined && el.dataset.field !== 'color') {
		store.updateFighter(+el.dataset.fighter, { [el.dataset.field]: el.value });
	}
});
settingsDialog.addEventListener('change', e => {
	const el = e.target;
	if (el.dataset.fighter !== undefined && el.dataset.field === 'color') {
		const side = +el.dataset.fighter;
		store.updateFighter(side, { color: el.value });
		// The name may have followed the color, and the fieldset accent changes.
		el.closest('fieldset').style.setProperty('--c', hex(el.value));
		settingsDialog.querySelector(`[data-fighter="${side}"][data-field="name"]`).value = store.state.fighters[side].name;
	} else if (el.dataset.wins !== undefined) {
		store.setWins(+el.dataset.wins, parseInt(el.value, 10));
	} else if (el.id === 'round-number') {
		store.setRound(parseInt(el.value, 10));
	} else if (el.dataset.setting) {
		const key = el.dataset.setting;
		let value;
		if (el.type === 'checkbox') value = el.checked;
		else if (el.dataset.kind === 'int') value = Math.max(0, parseInt(el.value, 10) || 0);
		else if (el.dataset.kind === 'clock') {
			value = parseClock(el.value);
			if (!value) {
				el.setCustomValidity('Use minutes:seconds, like 3:00');
				el.reportValidity();
				return;
			}
			el.setCustomValidity('');
		}
		store.updateSettings({ [key]: value });
	}
});
settingsDialog.addEventListener('keydown', e => {
	if (e.key === 'Enter' && e.target.id === 'time-left') {
		e.preventDefault();
		actions['set-time']();
	}
});

// --- keyboard ---

window.addEventListener('keydown', e => {
	if (displayWindow || e.metaKey || e.altKey) return;
	if (document.querySelector('dialog[open]')) return;
	if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
	const key = e.key.toLowerCase();
	if (e.ctrlKey && key !== 'z') return;
	const map = {
		q: () => store.addPoint(0, 1),
		a: () => store.addPoint(0, -1),
		w: () => store.addSimul(1),
		s: () => store.addSimul(-1),
		e: () => store.addPoint(1, 1),
		d: () => store.addPoint(1, -1),
		' ': () => (timeLeft(store.state) ? store.toggleClock() : store.toggleShowWinner()),
		n: () => store.nextRound(),
		z: () => store.undo(),
		f: () => (view === 'display' ? setView('control') : openDisplay()),
		escape: () => view === 'display' && setView('control'),
	};
	if (!map[key]) return;
	e.preventDefault();
	map[key]();
});

// --- offline support ---

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
	navigator.serviceWorker.register('sw.js').catch(() => {});
}
