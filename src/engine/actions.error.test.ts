import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 The error bip's firing rule, which is a DESIGN decision and not an implementation detail:

   it fires when an action was refused        — the rules said no, and nothing will happen
   it stays silent on the 1 Hz cadence gate   — "too soon" is not "no"; the same press works in a
                                                moment and Hud.svelte already draws that countdown
   it stays silent in a demo                  — it reports something about an INPUT, and nobody
                                                pressed anything; the bot fails actions routinely

 Worth a test rather than a comment because all three are silent behaviours: nothing observable
 distinguishes "correctly did not bip" from "bip is broken", and the natural way to break the
 middle one is to move a single `return false` two lines.
*/
vi.mock('./audio', () => ({ playSfx: vi.fn(), playSfxAt: vi.fn() }));
vi.mock('../game/actions', async importOriginal => {
	const actual = await importOriginal<typeof import('../game/actions')>();
	return { ...actual, performTargetedAction: vi.fn(), performHyperspace: vi.fn() };
});

import { playSfx } from './audio';
import { performTargetedAction, performHyperspace } from '../game/actions';
import { performEngineActionOn, performEngineHyperspace } from './actions';
import { game } from '../game/state.svelte';
import { ACTION_COOLDOWN_MS } from '../game/timing';

const ctx = () => ({}) as any;
const target = { kind: 'terrain' } as any;
const bips = () => (playSfx as any).mock.calls.filter((c: unknown[]) => c[0] === 'error').length;

// Far past any cooldown left by a previous test.
let t = 1_000_000;

beforeEach(() => {
	vi.clearAllMocks();
	game.demo = false;
	game.lastActionAt = 0;
	t += ACTION_COOLDOWN_MS * 10;
});

describe('the error bip', () => {
	it('fires when the rules refuse a targeted action', () => {
		(performTargetedAction as any).mockReturnValue(false);
		expect(performEngineActionOn('create-boulder', target, null as any, null as any, t, ctx)).toBe(false);
		expect(bips()).toBe(1);
	});

	it('stays silent when the action succeeds', () => {
		(performTargetedAction as any).mockReturnValue(true);
		expect(performEngineActionOn('create-boulder', target, null as any, null as any, t, ctx)).toBe(true);
		expect(bips()).toBe(0);
	});

	it('stays silent on the cadence gate — too soon is not refused', () => {
		(performTargetedAction as any).mockReturnValue(true);
		performEngineActionOn('create-boulder', target, null as any, null as any, t, ctx);
		vi.clearAllMocks();
		// Same tick again: canPerformAction is false, so this returns early.
		expect(performEngineActionOn('create-boulder', target, null as any, null as any, t, ctx)).toBe(false);
		expect(bips()).toBe(0);
		expect(performTargetedAction).not.toHaveBeenCalled();
	});

	it('fires when hyperspace has nowhere to land', () => {
		(performHyperspace as any).mockReturnValue(false);
		expect(performEngineHyperspace(null as any, null as any, t, ctx)).toBe(false);
		expect(bips()).toBe(1);
	});

	it('stays silent in a demo, however the bot fails', () => {
		game.demo = true;
		(performTargetedAction as any).mockReturnValue(false);
		(performHyperspace as any).mockReturnValue(false);
		performEngineActionOn('absorb', target, null as any, null as any, t, ctx);
		performEngineHyperspace(null as any, null as any, t + ACTION_COOLDOWN_MS * 2, ctx);
		expect(bips()).toBe(0);
	});
});
