// Level-code lookup. Codes aren't invertible (they fall out of the same RNG stream as the
// landscape itself, only reachable by replaying the whole generation pipeline), so "decoding" a
// code means having replayed every landscape from 0 and checking which one produced it.
// generateLevel(id) is always called with default options (smooths=2, despikes=2) regardless of
// the user's debug generator settings, so a given levelId always produces the same code the
// original game would show.
//
// The full 0..MAX_LEVEL_ID sweep is replayed once per browser: buildIndex() splits the range
// across a pool of Web Workers (one per navigator.hardwareConcurrency), which run generateLevel
// at full speed off the main thread — no need for the artificial throttling a main-thread scan
// would require. The result is cumulative-XOR "ciphered" (codeCipher.ts) and persisted to
// localStorage so this device never has to replay the sweep again. This isn't real security —
// the generation algorithm is public and the sweep is replayable by anyone in seconds — it just
// keeps localStorage from showing a plain code->id table to a casual look.
//
// Only the ciphertext (indexCipher) is kept resident between lookups — same opaque bytes already
// sitting in localStorage, so nothing is lost by caching it. The clear-text table is never
// materialized as a whole: findLevelByCode deciphers block-by-block via codeCipher.ts's
// decipherStream and stops at the first match, so a heap snapshot taken between lookups (or even
// mid-lookup, past whatever block is currently being checked) never shows more than the single
// 4-byte block in flight — not the permanently-resident, fully-decoded map this replaced.
import { generateLevel } from '../world/terrain';
import { base64ToBytes, bytesToBase64, cipherCodes, CODE_BYTES, decipherStream } from './codeCipher';
import type { IndexerRequest, IndexerResponse } from './codeIndexer.worker';

const CODE_SYSTEM = 'PC/ST';
const STORAGE_KEY = 'sentynel.codeIndex';

export const MAX_LEVEL_ID = 9999;
const LEVEL_COUNT = MAX_LEVEL_ID + 1;

let indexCipher: Uint8Array | null = null;
let indexReady: Promise<void> | null = null;

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// The displayable code for a single landscape (e.g. for the "Level: N, code: XXXXXXXX" menu
// line) — no cache lookup, just one generateLevel() call.
export function getLevelCode(id: number): string {
	return generateLevel(id).codes[CODE_SYSTEM];
}

function loadFromStorage(): boolean {
	let raw: string | null;
	try {
		raw = localStorage.getItem(STORAGE_KEY);
	} catch {
		return false; // storage disabled/unavailable — fall back to building the index in-memory
	}
	if (!raw) return false;

	let cipher: Uint8Array;
	try {
		cipher = base64ToBytes(raw);
	} catch {
		return false; // corrupted value
	}
	if (cipher.length !== LEVEL_COUNT * CODE_BYTES) return false; // corrupted/incomplete, rebuild

	indexCipher = cipher;
	return true;
}

function saveToStorage(cipher: Uint8Array): void {
	try {
		localStorage.setItem(STORAGE_KEY, bytesToBase64(cipher));
	} catch {
		// Best effort only (quota exceeded, storage disabled, etc.) — worst case this device
		// replays the sweep again next visit.
	}
}

function runShard(start: number, end: number): Promise<IndexerResponse> {
	return new Promise(resolve => {
		const worker = new Worker(new URL('./codeIndexer.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (event: MessageEvent<IndexerResponse>) => {
			worker.terminate();
			resolve(event.data);
		};
		const request: IndexerRequest = { start, end };
		worker.postMessage(request);
	});
}

async function buildIndex(): Promise<void> {
	const workerCount = Math.max(1, navigator.hardwareConcurrency || 1);
	const shardSize = Math.ceil(LEVEL_COUNT / workerCount);

	const shards = await Promise.all(
		range(workerCount)
			.map(i => [i * shardSize, Math.min(i * shardSize + shardSize, LEVEL_COUNT)] as const)
			.filter(([start, end]) => start < end)
			.map(([start, end]) => runShard(start, end))
	);

	// codes is deliberately local and transient — once cipherCodes() turns it into indexCipher,
	// this plaintext array falls out of scope and is left for GC, matching the no-lingering-
	// clear-text goal for the persistent lookup path below.
	const codes: string[] = new Array(LEVEL_COUNT);
	for (const shard of shards) shard.codes.forEach((code, i) => (codes[shard.start + i] = code));

	indexCipher = cipherCodes(codes);
	saveToStorage(indexCipher);
}

// Idempotent and safe to call from as many places as convenient (e.g. every MainMenu mount) —
// only the first call does any work; the rest observe the same in-flight/settled promise.
export function ensureIndexReady(): Promise<void> {
	if (!indexReady) indexReady = loadFromStorage() ? Promise.resolve() : buildIndex();
	return indexReady;
}

// Returns the matching levelId, or null if no landscape in [0, MAX_LEVEL_ID] produces this code.
// Deciphers block-by-block and stops at the first match — see the module comment above.
export async function findLevelByCode(code: string, signal?: AbortSignal): Promise<number | null> {
	await ensureIndexReady();
	if (signal?.aborted || !indexCipher) return null;

	const target = code.toLowerCase();
	let id = 0;
	for (const candidate of decipherStream(indexCipher)) {
		if (candidate === target) return id;
		id++;
	}
	return null;
}
