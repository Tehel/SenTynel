import { describe, it, expect } from 'vitest';
import { beginTrack, extendTrack, isTap, Scrubber, SCRUB_PX_PER_ENTRY, TAP_MAX_MOVE_PX } from './touchGestures';

// Plays a whole touch through the tracker, the way App.svelte's handlers do.
function play(points: Array<[number, number]>, multiTouch = false) {
	const [first, ...rest] = points;
	const track = beginTrack(first[0], first[1]);
	if (multiTouch) track.multiTouch = true;
	for (const [x, y] of rest) extendTrack(track, x, y);
	return isTap(track);
}

describe('tap recognition', () => {
	it('reads a touch that never moves as a tap', () => {
		expect(play([[400, 300]])).toBe(true);
	});

	it('tolerates a small wobble', () => {
		expect(play([[400, 300], [404, 297], [400, 302]])).toBe(true);
	});

	it('rejects a drag that wandered past the tolerance and came back', () => {
		// Net displacement is zero — comparing start to end would call this a tap and resume the demo
		// out from under someone who changed their mind mid-drag. maxDistance is what catches it.
		const far = TAP_MAX_MOVE_PX + 20;
		expect(play([[400, 300], [400 + far, 300], [400, 300]])).toBe(false);
	});

	it('is never a tap once a second finger joined', () => {
		expect(play([[400, 300]], true)).toBe(false);
	});
});

/*
 The scrubber. `tick` is fed explicit deltas rather than real time, so the physics is checked
 deterministically — no rAF, no clock, no flake.
*/
const CHOICES = 200;
// Run the glide/snap to a standstill, with a frame budget well past anything the physics needs.
function settle(s: Scrubber, frameMs = 16) {
	for (let i = 0; i < 5000 && !s.settled; i++) s.tick(frameMs);
	return s;
}

describe('scrubbing the list', () => {
	it('moves the selection opposite to the finger, so the strip follows it', () => {
		const s = new Scrubber(CHOICES, 100);
		s.begin(500, 0);
		// Dragging right pulls earlier entries into view.
		s.drag(500 + SCRUB_PX_PER_ENTRY * 3, 50);
		expect(s.index).toBe(97);

		s.drag(500 - SCRUB_PX_PER_ENTRY * 2, 100);
		expect(s.index).toBe(102);
	});

	it('tracks fractionally while dragging, and only rounds when asked which entry', () => {
		const s = new Scrubber(CHOICES, 100);
		s.begin(0, 0);
		s.drag(-SCRUB_PX_PER_ENTRY / 2, 30);
		expect(s.offset).toBeCloseTo(100.5);
		expect(s.index).toBe(101);
	});

	it('always comes to rest exactly on an entry', () => {
		const s = new Scrubber(CHOICES, 100);
		s.begin(0, 0);
		s.drag(-SCRUB_PX_PER_ENTRY * 2.4, 40);
		s.release(40);
		settle(s);
		expect(s.offset).toBe(Math.round(s.offset));
		expect(s.settled).toBe(true);
	});

	it('carries a flick far past where the finger stopped — the whole point of the change', () => {
		const s = new Scrubber(CHOICES, 0);
		// A brisk flick: four entries' worth of travel in 40 ms.
		s.begin(0, 0);
		s.drag(-SCRUB_PX_PER_ENTRY * 4, 40);
		const atRelease = s.offset;
		s.release(40);
		settle(s);
		// Tens of entries from a single gesture, against one per swipe before.
		expect(s.offset).toBeGreaterThan(atRelease + 20);
	});

	it('gives a faster flick a longer throw', () => {
		const throwFrom = (dragMs: number) => {
			const s = new Scrubber(CHOICES, 0);
			s.begin(0, 0);
			s.drag(-SCRUB_PX_PER_ENTRY * 4, dragMs);
			s.release(dragMs);
			return settle(s).offset;
		};
		expect(throwFrom(30)).toBeGreaterThan(throwFrom(120));
	});

	it('accumulates when flicked again mid-glide, the way a mobile list does', () => {
		const s = new Scrubber(CHOICES, 0);
		s.begin(0, 0);
		s.drag(-SCRUB_PX_PER_ENTRY * 4, 40);
		s.release(40);
		const single = settle(new Scrubber(CHOICES, 0));

		// A second flick from where the first one had got to.
		s.tick(16);
		const mid = s.offset;
		s.begin(0, 100);
		s.drag(-SCRUB_PX_PER_ENTRY * 4, 140);
		s.release(140);
		settle(s);
		expect(s.offset).toBeGreaterThan(mid + 20);
		expect(s.offset).toBeGreaterThan(single.offset);
	});

	it('is frame-rate independent — the same flick travels the same distance at 60 and 120 Hz', () => {
		const at = (frameMs: number) => {
			const s = new Scrubber(CHOICES, 0);
			s.begin(0, 0);
			s.drag(-SCRUB_PX_PER_ENTRY * 4, 40);
			s.release(40);
			return settle(s, frameMs).offset;
		};
		expect(Math.abs(at(16.7) - at(8.3))).toBeLessThanOrEqual(1);
	});

	it('grabbing a gliding strip stops it dead', () => {
		const s = new Scrubber(CHOICES, 0);
		s.begin(0, 0);
		s.drag(-SCRUB_PX_PER_ENTRY * 4, 40);
		s.release(40);
		s.tick(16);
		expect(s.velocity).not.toBe(0);

		s.begin(0, 100);
		expect(s.velocity).toBe(0);
		// And it stays where the finger caught it rather than drifting out from under it.
		const caught = s.offset;
		s.drag(0, 116);
		expect(s.offset).toBe(caught);
	});

	it('stops at both ends of the list instead of running past them', () => {
		const low = new Scrubber(CHOICES, 3);
		low.begin(0, 0);
		low.drag(SCRUB_PX_PER_ENTRY * 40, 40);
		low.release(40);
		settle(low);
		expect(low.offset).toBe(0);

		const high = new Scrubber(CHOICES, CHOICES - 4);
		high.begin(0, 0);
		high.drag(-SCRUB_PX_PER_ENTRY * 40, 40);
		high.release(40);
		settle(high);
		expect(high.offset).toBe(CHOICES - 1);
	});

	it('caps the throw so a frantic flick cannot cross an entire journey', () => {
		const s = new Scrubber(100_000, 0);
		s.begin(0, 0);
		// A physically absurd velocity — the drag itself legitimately covers that ground, so it is the
		// glide ADDED on release that the cap is about.
		s.drag(-SCRUB_PX_PER_ENTRY * 4000, 16);
		const atRelease = s.offset;
		s.release(16);
		settle(s);
		const thrown = s.offset - atRelease;
		expect(thrown).toBeLessThan(500);
		// And the cap still leaves a throw worth having, rather than smothering it.
		expect(thrown).toBeGreaterThan(100);
	});

	it('has no throw in a touch that was held still before lifting', () => {
		const s = new Scrubber(CHOICES, 10);
		s.begin(0, 0);
		s.drag(-SCRUB_PX_PER_ENTRY * 2, 40);
		// Finger parked at the destination for a while, then lifted.
		s.drag(-SCRUB_PX_PER_ENTRY * 2, 400);
		s.drag(-SCRUB_PX_PER_ENTRY * 2, 500);
		s.release(500);
		settle(s);
		expect(s.offset).toBe(12);
	});

	it('handles a one-entry list, which is where every journey starts', () => {
		const s = new Scrubber(1, 0);
		s.begin(0, 0);
		s.drag(-SCRUB_PX_PER_ENTRY * 10, 40);
		s.release(40);
		settle(s);
		expect(s.offset).toBe(0);
		expect(s.index).toBe(0);
	});
});
