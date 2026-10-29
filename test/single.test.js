import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSingle } from '../tools/build-single.mjs';

const committed = readFileSync(new URL('../tsl-scoreboard.html', import.meta.url), 'utf8');

test('tsl-scoreboard.html is current (run `npm run build:single` after changing css, js or assets)', () => {
	assert.equal(committed, buildSingle());
});

test('the single file needs no other files', () => {
	assert.doesNotMatch(committed, /(?:src|href)="(?:js|css|assets)\//);
	assert.doesNotMatch(committed, /url\(\.\.\/assets/);
	assert.doesNotMatch(committed, /^import /m);
	assert.doesNotMatch(committed, /^export /m);
});
