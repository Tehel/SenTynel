/*
 Touch input mechanics for the demo's on-screen controls — see PLAN-MOBILE.md's "Touch control of the
 demo". Two things live here: the test for "was that a tap?", and the inertial scrubber behind the
 landscape picker.

 Deliberately pure and DOM-free: callers read coordinates off a TouchEvent or a PointerEvent and hand
 them here, so every threshold and the whole of the physics is unit-testable without a browser
 (touchGestures.test.ts). Nothing in this file knows what any of it is *for*.

 There is no long-press. Reset is a labelled control on the pause overlay instead, because a hidden
 gesture with no affordance and no confirm is the wrong home for the one action that wipes the bot's
 record — and a tablet lying flat under a palm generates long presses on its own.
*/

// How far a finger may wander and still count as a tap. Generous enough for a thumb on a bumpy
// train; anything past it is a drag, and a drag is not an instruction to resume.
export const TAP_MAX_MOVE_PX = 16;

export interface GestureTrack {
	startX: number;
	startY: number;
	/*
	 The furthest the finger ever got from where it started, rather than where it ended up. A drag out
	 and back finishes within a tap's tolerance of its origin, and without this a change of mind
	 mid-drag would read as a tap and resume the demo.
	*/
	maxDistance: number;
	/*
	 A second finger touched down at any point, so this is none of ours. Tracked rather than ignored so
	 that Phase M2's pinch has an unambiguous two-finger channel to claim.
	*/
	multiTouch: boolean;
}

export function beginTrack(x: number, y: number): GestureTrack {
	return { startX: x, startY: y, maxDistance: 0, multiTouch: false };
}

export function extendTrack(track: GestureTrack, x: number, y: number): void {
	const dist = Math.hypot(x - track.startX, y - track.startY);
	if (dist > track.maxDistance) track.maxDistance = dist;
}

export function isTap(track: GestureTrack): boolean {
	return !track.multiTouch && track.maxDistance <= TAP_MAX_MOVE_PX;
}

/*
 THE INERTIAL SCRUBBER — the landscape picker's physics.

 It replaced a one-swipe-one-step stepper, which was the wrong instrument for the job: a demo's
 unlocked list runs to hundreds of entries and stepping it needed a gesture per entry. A scrub is the
 shape of the actual question ("somewhere over there in a long list"), and momentum is what makes a
 long list reachable at all — a flick carries tens of entries, and flicking again while one is still
 gliding adds to it, the way every mobile list behaves.

 `offset` is a FRACTIONAL index into the list. Fractional is the point: it is what lets the strip
 slide continuously under the finger instead of jumping between entries, and `index` rounds it only
 when somebody asks which entry is actually chosen.
*/

// Finger travel per list entry. Doubles as the visual spacing of the strip — they have to be the same
// number or the entries would slide at a different rate than the finger dragging them, which is
// exactly the thing that reads as broken.
export const SCRUB_PX_PER_ENTRY = 60;

// Per-frame velocity decay, applied as a continuous exponential so it is frame-rate independent (the
// same flick travels the same distance at 60 and 120 Hz). Slack enough that one hard flick crosses
// ~100 entries, since the lists this has to cover are that long.
const SCRUB_FRICTION = 0.98;
const FRICTION_FRAME_MS = 1000 / 60;

// Entries per millisecond. The floor ends the glide and hands over to the snap; the cap keeps a
// frantic flick from launching to the far end of a long journey and back.
const SCRUB_MIN_VELOCITY = 0.0002;
const SCRUB_MAX_VELOCITY = 0.25;

// Exponential approach to the nearest entry once the glide is spent, per millisecond, and how close
// counts as arrived. A scrub must always come to rest ON an entry — a picker resting between two
// values would leave the choice ambiguous on screen.
const SNAP_RATE = 0.012;
const SNAP_EPSILON = 0.001;

// Only the tail of the drag decides the throw. Averaging the whole gesture would let a slow hunt
// followed by a flick come out slow, and a flick followed by a pause come out fast.
const VELOCITY_WINDOW_MS = 80;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Scrubber {
	/** Fractional position in the list. Read by the view to place the strip. */
	offset: number;
	/** Entries per millisecond, negative towards the start of the list. */
	velocity = 0;

	private dragging = false;
	private grabX = 0;
	private grabOffset = 0;
	private samples: Array<{ x: number; t: number }> = [];

	constructor(
		private count: number,
		offset = 0
	) {
		this.offset = clamp(offset, 0, Math.max(0, count - 1));
	}

	/** The entry actually chosen right now. */
	get index(): number {
		return clamp(Math.round(this.offset), 0, Math.max(0, this.count - 1));
	}

	/** Nothing left to animate: not held, not gliding, and resting exactly on an entry. */
	get settled(): boolean {
		return !this.dragging && this.velocity === 0 && this.offset === Math.round(this.offset);
	}

	begin(x: number, t: number): void {
		this.dragging = true;
		// Grabbing a moving strip stops it dead, as it should — the finger is now in charge, and
		// inheriting the old velocity would have it drift out from under the touch.
		this.velocity = 0;
		this.grabX = x;
		this.grabOffset = this.offset;
		this.samples = [{ x, t }];
	}

	drag(x: number, t: number): void {
		if (!this.dragging) return;
		// Content follows the finger: pulling right brings earlier entries into view, hence the minus.
		this.offset = clamp(this.grabOffset - (x - this.grabX) / SCRUB_PX_PER_ENTRY, 0, this.count - 1);
		this.samples.push({ x, t });
		while (this.samples.length > 2 && t - this.samples[0].t > VELOCITY_WINDOW_MS) this.samples.shift();
	}

	release(t: number): void {
		if (!this.dragging) return;
		this.dragging = false;
		const first = this.samples[0];
		const elapsed = t - first.t;
		const last = this.samples[this.samples.length - 1];
		// A touch held still before lifting has no throw in it, and dividing by ~0 would invent one.
		if (this.samples.length < 2 || elapsed <= 0) {
			this.velocity = 0;
			return;
		}
		const pxPerMs = (last.x - first.x) / elapsed;
		this.velocity = clamp(-pxPerMs / SCRUB_PX_PER_ENTRY, -SCRUB_MAX_VELOCITY, SCRUB_MAX_VELOCITY);
		this.samples = [];
	}

	/** Advance the glide, or the snap once the glide is spent. No-op while a finger is down. */
	tick(dtMs: number): void {
		if (this.dragging || dtMs <= 0) return;

		if (Math.abs(this.velocity) > SCRUB_MIN_VELOCITY) {
			const next = this.offset + this.velocity * dtMs;
			const bounded = clamp(next, 0, this.count - 1);
			this.offset = bounded;
			// Hitting either end absorbs the throw rather than pinning it there for another second.
			this.velocity = bounded === next ? this.velocity * Math.pow(SCRUB_FRICTION, dtMs / FRICTION_FRAME_MS) : 0;
			return;
		}
		this.velocity = 0;

		const target = clamp(Math.round(this.offset), 0, this.count - 1);
		const remaining = target - this.offset;
		if (Math.abs(remaining) <= SNAP_EPSILON) {
			this.offset = target;
			return;
		}
		this.offset += remaining * (1 - Math.exp(-SNAP_RATE * dtMs));
	}
}
