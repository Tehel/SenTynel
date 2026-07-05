import { describe, it, expect } from 'vitest';
import { findLevelByCode, getLevelCode } from './levelCodes';

describe('findLevelByCode', () => {
	it("resolves a known level's own code back to its id", async () => {
		const code = getLevelCode(0);
		await expect(findLevelByCode(code)).resolves.toBe(0);
	});

	it('is case-insensitive', async () => {
		const code = getLevelCode(0);
		await expect(findLevelByCode(code.toUpperCase())).resolves.toBe(0);
	});

	it('returns null when aborted before a match is found', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(findLevelByCode('deadbeef', controller.signal)).resolves.toBeNull();
	});
});
