// Cumulative-XOR "cipher" for the persisted level-code index (see levelCodes.ts). Not real
// security — the generation algorithm is public and replayable in a Worker in seconds regardless
// — this only keeps localStorage from showing a plain code->id table to a casual look.
//
// Each PC/ST code is 8 hex chars = 4 bytes. Ciphering walks the codes in ascending levelId order:
// the first block is XORed against a fixed key, every later block against the *previous block's
// plaintext*. Deciphering is therefore inherently sequential from the start.
const SNTL_KEY = new Uint8Array([0x53, 0x4e, 0x54, 0x4c]); // 'S' 'N' 'T' 'L'
export const CODE_BYTES = 4;

function codeToBytes(code: string, out: Uint8Array, offset: number): void {
	for (let i = 0; i < CODE_BYTES; i++) out[offset + i] = parseInt(code.substring(i * 2, i * 2 + 2), 16);
}

function bytesToCode(bytes: Uint8Array, offset: number): string {
	let s = '';
	for (let i = 0; i < CODE_BYTES; i++) s += bytes[offset + i].toString(16).padStart(2, '0');
	return s;
}

// codes must be ordered by ascending levelId.
export function cipherCodes(codes: string[]): Uint8Array {
	const clear = new Uint8Array(codes.length * CODE_BYTES);
	codes.forEach((code, i) => codeToBytes(code, clear, i * CODE_BYTES));

	const cipher = new Uint8Array(clear.length);
	for (let i = 0; i < codes.length; i++) {
		const offset = i * CODE_BYTES;
		const mask = i === 0 ? SNTL_KEY : clear.subarray(offset - CODE_BYTES, offset);
		for (let b = 0; b < CODE_BYTES; b++) cipher[offset + b] = clear[offset + b] ^ mask[b];
	}
	return cipher;
}

// Deciphers one block at a time, in ascending levelId order, yielding as it goes rather than
// building the whole clear-text table up front — a consumer that stops early (a match found)
// never has more than the current+previous 4-byte block resident, and nothing lingers once it's
// done pulling. Two small fixed buffers are reused across iterations instead of growing an array.
export function* decipherStream(cipher: Uint8Array): Generator<string> {
	const count = cipher.length / CODE_BYTES;
	let prev = SNTL_KEY;
	let clear = new Uint8Array(CODE_BYTES);
	for (let i = 0; i < count; i++) {
		const offset = i * CODE_BYTES;
		const next = new Uint8Array(CODE_BYTES);
		for (let b = 0; b < CODE_BYTES; b++) next[b] = cipher[offset + b] ^ prev[b];
		clear = next;
		yield bytesToCode(clear, 0);
		prev = clear;
	}
}

// Returns codes in ascending levelId order (the inverse of cipherCodes). Only used by tests and
// the (one-shot, build-time-only) round trip — production lookups use decipherStream directly so
// the full clear-text table is never resident at once.
export function decipherCodes(cipher: Uint8Array): string[] {
	return Array.from(decipherStream(cipher));
}

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
