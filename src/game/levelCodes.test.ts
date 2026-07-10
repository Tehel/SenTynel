import { describe, it, expect, vi } from 'vitest';
import type { IndexerRequest, IndexerResponse } from './codeIndexer.worker';

// levelCodes.ts builds its index via real Web Workers + localStorage, neither of which exist in
// the plain-node vitest environment (see vite.config.ts). Stub minimal versions before the module
// under test is imported. The fake Worker fabricates a code per id instead of running the real
// (expensive, already covered by terrain.test.ts) generateLevel — these tests are about
// levelCodes.ts's own orchestration (sharding, ciphering, persistence, lookup), not landscape
// generation.
const fakeCode = (id: number) => id.toString(16).padStart(8, '0');

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => store.set(k, v),
	removeItem: (k: string) => store.delete(k),
	clear: () => store.clear(),
});
vi.stubGlobal('navigator', { hardwareConcurrency: 3 });

let workerCount = 0;
class FakeWorker {
	onmessage: ((event: MessageEvent<IndexerResponse>) => void) | null = null;
	constructor(_url: URL, _options?: WorkerOptions) {
		workerCount++;
	}
	postMessage(request: IndexerRequest) {
		queueMicrotask(() => {
			const codes: string[] = [];
			for (let id = request.start; id < request.end; id++) codes.push(fakeCode(id));
			const event = { data: { start: request.start, codes } } as unknown as MessageEvent<IndexerResponse>;
			this.onmessage?.(event);
		});
	}
	terminate() {}
}
vi.stubGlobal('Worker', FakeWorker);

describe('levelCodes', () => {
	it('builds the index via the (fake) worker pool and resolves codes to ids', async () => {
		const { findLevelByCode, MAX_LEVEL_ID } = await import('./levelCodes');
		await expect(findLevelByCode(fakeCode(42))).resolves.toBe(42);
		await expect(findLevelByCode(fakeCode(MAX_LEVEL_ID))).resolves.toBe(MAX_LEVEL_ID);
		await expect(findLevelByCode(fakeCode(7).toUpperCase())).resolves.toBe(7); // case-insensitive
		await expect(findLevelByCode('zzzzzzzz')).resolves.toBeNull();
		expect(workerCount).toBeGreaterThan(0);
	});

	it('reuses the persisted (ciphered) cache on a fresh module load instead of rebuilding', async () => {
		expect(store.get('sentynel.codeIndex')).toBeTruthy();
		const spawnedBefore = workerCount;

		vi.resetModules();
		const { findLevelByCode } = await import('./levelCodes');
		await expect(findLevelByCode(fakeCode(999))).resolves.toBe(999);

		expect(workerCount).toBe(spawnedBefore); // no new workers spawned — loaded from storage
	});
});
