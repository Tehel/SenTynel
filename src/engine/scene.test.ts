/*
 The surface rule (PLAN-RULES.md R1, RULES-FIDELITY.md A1/A3): what the player is allowed to absorb
 or transfer into.

 The original's rule is about the SURFACE a thing stands on, never the thing itself. There are two
 targetable surfaces — a tile's top face, which is only visible from an eye above it, and a boulder's
 side, which is visible from anywhere with clear line of sight ("boulders act as an extension of the
 square surface"). An object is targetable iff the surface under its feet is visible.

 Every case below is one row of that rule. The two that matter most are the ones we used to get
 wrong: a synthoid on bare ground is NOT targetable through a hill (we exempted synthoids along with
 boulders, which no source supports), and a tree on a boulder IS targetable through one (we required
 ground line of sight for it, which the surface rule says we should not).

 A partial SceneData is enough: the predicate reads allObjects and nothing else, so these are real
 GameObjects with real meshes but no scene, no renderer and no raycasting. Visibility arrives as a
 callback, exactly as it does from engine/actions.ts, which is what lets the rule be tested without
 building a landscape to hide things behind.
*/

import { describe, it, expect } from 'vitest';
import { Boulder, Pedestal, Sentinel, Sentry, Synthoid, Tree, type GameObject } from '../world/objects';
import { canTargetTopObject, type SceneData } from './scene';

const COL = 4;
const ROW = 6;

// Objects are constructed at time 0 (no spawn animation) and at nominal heights — the rule reads
// types and stack order, never altitudes.
type Ctor = new (...args: ConstructorParameters<typeof GameObject>) => GameObject;
const stack = (...types: Ctor[]): GameObject[] =>
	types.map((T, i) => new T(0, COL, ROW, 1 + i * 0.5, 0, null, null, {}));

const sceneWith = (objects: GameObject[]) => ({ allObjects: objects }) as unknown as SceneData;

// The two visibility oracles the rule can be asked. `blind` refuses everything, so anything it still
// lets through is a surface that needs no line of sight at all.
const blind = () => false;
const seesTile = (_c: number, _r: number, yOffset = 0) => yOffset === 0;
const seesPedestalTop = (_c: number, _r: number, yOffset = 0) => yOffset === 1;

const canTarget = (objects: GameObject[], isVisible: (c: number, r: number, y?: number) => boolean) =>
	canTargetTopObject(sceneWith(objects), COL, ROW, isVisible);

describe('the surface rule', () => {
	describe('a boulder is its own surface', () => {
		it('is targetable with no line of sight to its tile', () => {
			expect(canTarget(stack(Boulder), blind)).toBe(true);
		});

		it('is targetable at the top of a stack', () => {
			expect(canTarget(stack(Boulder, Boulder, Boulder), blind)).toBe(true);
		});
	});

	describe('feet on bare terrain need the tile', () => {
		it('refuses a synthoid whose tile is hidden', () => {
			// The fix. This used to be unconditionally allowed, which let the player strip shells
			// from behind a ridge and made reclaiming an abandoned body free rather than positional.
			expect(canTarget(stack(Synthoid), blind)).toBe(false);
		});

		it('allows a synthoid whose tile is visible', () => {
			expect(canTarget(stack(Synthoid), seesTile)).toBe(true);
		});

		it('refuses a tree whose tile is hidden, and allows it when visible', () => {
			expect(canTarget(stack(Tree), blind)).toBe(false);
			expect(canTarget(stack(Tree), seesTile)).toBe(true);
		});

		it('refuses a sentry whose tile is hidden, and allows it when visible', () => {
			expect(canTarget(stack(Sentry), blind)).toBe(false);
			expect(canTarget(stack(Sentry), seesTile)).toBe(true);
		});
	});

	describe('feet on a boulder inherit the boulder exemption', () => {
		it('allows a synthoid on a boulder with the tile hidden', () => {
			// This is the whole climb loop: a body on top of a tower has its feet far above the eye
			// of the player transferring up to it, and must stay reachable.
			expect(canTarget(stack(Boulder, Synthoid), blind)).toBe(true);
			expect(canTarget(stack(Boulder, Boulder, Boulder, Synthoid), blind)).toBe(true);
		});

		it('allows a tree on a boulder with the tile hidden', () => {
			// Changed by the surface rule: we used to demand ground line of sight here, which was
			// inconsistent with the boulder directly underneath being freely absorbable.
			expect(canTarget(stack(Boulder, Tree), blind)).toBe(true);
		});
	});

	describe('feet on the pedestal need the pedestal top', () => {
		it('refuses the Sentinel when only its base tile is visible', () => {
			expect(canTarget(stack(Pedestal, Sentinel), seesTile)).toBe(false);
		});

		it('allows the Sentinel when the pedestal top is visible', () => {
			expect(canTarget(stack(Pedestal, Sentinel), seesPedestalTop)).toBe(true);
		});

		it('holds for the synthoid placed there to win, not just for the Sentinel', () => {
			expect(canTarget(stack(Pedestal, Synthoid), seesTile)).toBe(false);
			expect(canTarget(stack(Pedestal, Synthoid), seesPedestalTop)).toBe(true);
		});
	});

	describe('nothing to target', () => {
		it('refuses a bare pedestal however well it is seen', () => {
			expect(canTarget(stack(Pedestal), seesTile)).toBe(false);
			expect(canTarget(stack(Pedestal), seesPedestalTop)).toBe(false);
		});

		it('refuses an empty cell', () => {
			expect(canTarget([], seesTile)).toBe(false);
		});

		it('ignores objects on other cells', () => {
			const elsewhere = new Boulder(0, COL + 1, ROW, 1, 0, null, null, {});
			expect(canTarget([elsewhere], seesTile)).toBe(false);
		});
	});

	describe('an object already being absorbed is not part of the stack', () => {
		it('sees through a fading synthoid to the boulder it stood on', () => {
			const objects = stack(Boulder, Synthoid);
			objects[1].remove(1000);
			// The boulder underneath is now the top of the live stack, and boulders need nothing.
			expect(canTarget(objects, blind)).toBe(true);
		});
	});
});
