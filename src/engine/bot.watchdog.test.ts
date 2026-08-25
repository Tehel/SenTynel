import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => store.set(k, v),
	removeItem: (k: string) => store.delete(k),
	clear: () => store.clear(),
});

const { BotDriver } = await import('./bot');
const { game, startDemo } = await import('../game/state.svelte');
const { DEMO_NO_PROGRESS_MS } = await import('../game/timing');

/*
 The demo watchdog against a PAUSED demo — PLAN-MOBILE.md's touch pause.

 The watchdog measures idle time against rAF timestamps, and the render loop never stops: it keeps
 calling BotDriver.tick in every phase. So a pause is invisible to it unless it is compensated for,
 and any pause longer than DEMO_NO_PROGRESS_MS would have the first resumed frame declare the
 landscape stalled — booking a strike, and after three a blacklist entry, against a run that was
 doing fine.

 The headless harness (bot.harness.test.ts) can never catch this: it has no PAUSED phase. Hence a
 unit test, driving BotDriver.tick directly. `nextPlanAt` is pushed out of reach so the PLAYING ticks
 return before planning, which is what lets this run with no scene at all — the watchdog and the
 pause branch are the only code under test.
*/
function idleBot() {
	const bot = new BotDriver(null as any, null as any, null as any);
	(bot as any).nextPlanAt = Number.MAX_SAFE_INTEGER;
	return bot;
}

// One second per frame, so a pause of a realistic length doesn't need thousands of iterations.
const FRAME_MS = 1000;

function run(bot: ReturnType<typeof idleBot>, from: number, frames: number): number {
	let time = from;
	for (let i = 0; i < frames; i++) {
		time += FRAME_MS;
		bot.tick(time, FRAME_MS);
	}
	return time;
}

describe('demo watchdog across a pause', () => {
	beforeEach(() => {
		store.clear();
		game.phase = 'MENU';
		startDemo();
		game.lastActionAt = 0;
	});

	it('does not write the landscape off after a pause longer than the idle limit', () => {
		const bot = idleBot();
		// One PLAYING frame to seat the watchdog's clocks.
		let time = run(bot, 0, 1);

		game.phase = 'PAUSED';
		const pausedFrames = (DEMO_NO_PROGRESS_MS / FRAME_MS) * 2;
		time = run(bot, time, pausedFrames);
		expect(game.phase).toBe('PAUSED');

		game.phase = 'PLAYING';
		run(bot, time, 1);
		expect(game.phase).toBe('PLAYING');
	});

	it('still writes off a landscape that idles that long while actually playing', () => {
		// The other half of the fix: the compensation must be scoped to PAUSED, or the watchdog
		// would stop being able to end a genuinely stuck run at all.
		const bot = idleBot();
		run(bot, 0, DEMO_NO_PROGRESS_MS / FRAME_MS + 2);
		expect(game.phase).toBe('LOST');
		expect(game.lostReason).toBe('stalled');
	});

	it('resumes with the full idle allowance, not a spent one', () => {
		const bot = idleBot();
		let time = run(bot, 0, 1);

		game.phase = 'PAUSED';
		time = run(bot, time, 120);
		game.phase = 'PLAYING';

		// Just under the limit after resuming: still alive.
		time = run(bot, time, DEMO_NO_PROGRESS_MS / FRAME_MS - 2);
		expect(game.phase).toBe('PLAYING');

		// And the allowance is not infinite — it expires from the resume, as it should.
		run(bot, time, 4);
		expect(game.phase).toBe('LOST');
	});
});
