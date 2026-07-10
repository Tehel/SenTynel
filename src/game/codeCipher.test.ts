import { describe, expect, it } from 'vitest';
import { cipherCodes, decipherCodes, decipherStream } from './codeCipher';

describe('codeCipher', () => {
	it('round-trips a set of codes through cipher/decipher', () => {
		const codes = ['00000000', '3a5f9c02', 'ffffffff', 'deadbeef', '01020304'];
		expect(decipherCodes(cipherCodes(codes))).toEqual(codes);
	});

	it('does not just echo the plaintext back as ciphertext', () => {
		const codes = ['3a5f9c02', 'deadbeef'];
		const cipher = cipherCodes(codes);
		const clearHex = codes.join('');
		const cipherHex = Array.from(cipher)
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');
		expect(cipherHex).not.toEqual(clearHex);
	});

	it('changing an earlier code changes every later ciphered block', () => {
		const a = cipherCodes(['00000000', '11111111', '22222222']);
		const b = cipherCodes(['00000001', '11111111', '22222222']);
		expect(a.slice(4)).not.toEqual(b.slice(4));
	});

	it('decipherStream is lazy — stopping early never pulls the remaining blocks', () => {
		const codes = ['00000000', '11111111', '22222222', '33333333'];
		const cipher = cipherCodes(codes);

		let pulled = 0;
		let found: string | null = null;
		for (const candidate of decipherStream(cipher)) {
			pulled++;
			if (candidate === '22222222') {
				found = candidate;
				break;
			}
		}

		expect(found).toBe('22222222');
		expect(pulled).toBe(3); // stopped right after the match — index 3 was never touched
	});
});
