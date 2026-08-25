// Duration of the body-transfer camera glide (engine/camera.ts's beginTransferAnim/
// updateTransfer). TRANSFER returns to PLAYING once the glide finishes — there is no
// separate timer, so this constant is the sole source of truth for how long TRANSFER lasts.
// WON/LOST have no equivalent timer — WinScreen/LoseScreen are dismissed by keypress only.
export const TRANSFER_DELAY_MS = 1000;

// Minimum gap between player-initiated actions (create/absorb/transfer/hyperspace),
// matching the watchers' 1 Hz cadence.
export const ACTION_COOLDOWN_MS = 1000;

/*
 How long a watcher stares at a SYNTHOID before it starts taking energy — the lock-on stall
 (RULES-FIDELITY.md C6). Boulders get no stall at all; this is a detection delay for the intruder,
 not a general reaction time.

 THE ONE NUMBER IN THE DRAIN RULES THAT IS OURS. The original waits 5 s, but it also charged ~3 s
 for a transfer and panned slowly (see TRANSFER_DELAY_MS above, and RULES-FIDELITY.md §G): its 5 s
 fitted about one build-and-transfer hop, tightly. Our player is nimbler, so the same wall-clock
 grace buys them more, and the fuse is shortened to compensate. Settled by playtesting, not by
 argument — raise it toward 5000 if the game plays too tense, lower it if a watcher's beam is easy
 to farm.
*/
export const WATCHER_GRACE_MS = 3000;

/*
 How long a drain MORPH takes end to end — synthoid → boulder, boulder → tree, tree → Meanie and
 back (engine/scene.ts's replaceObjectInScene). One drain interval, so a morph is always finished
 before the tick that could start the next one.

 It is a rules constant rather than an animation one on purpose (RULES-FIDELITY.md A5b). It used to be
 an animation one by accident: the target was absorbed at a flat animationScale of 2 and its
 replacement placed 500 ms later, which made the *length* of a swap a function of
 `settings.animationStyle` — squash's 1 s absorb fitted the first half, fade's 2 s ran the whole
 interval and spilled into the next tick. The duration is fixed here and each animation is stretched
 to fit it (world/objects/base.ts's morphAnimationScale), not the other way round.

 THE TWO HALVES ARE SEQUENTIAL, and deliberately so: the old object squashes away over the first half
 and the new one inflates over the second. Making them overlap was tried once — one cross-fade across
 the whole interval — and it looks wrong, so the ATOMICITY IS IN THE RULES ONLY. The replacement is in
 allObjects from the frame the drain fires (holding its rung against everything that reads the stack)
 and shows nothing until MORPH_HALF_DURATION_MS has passed.
*/
export const MORPH_DURATION_MS = 1000;
export const MORPH_HALF_DURATION_MS = MORPH_DURATION_MS / 2;

/*
 Demo-mode timers. None of these apply to human play — the end screens are still keypress-only
 there, and the one thing a player never needs is a machine deciding they have taken too long.

 The two holds re-introduce a WON/LOST delay of the kind PLAN.md records as removed: it was wrong
 for a player, who wants to read the screen and move on at their own pace, but an attract mode has
 nobody to press the key.
*/
export const DEMO_WIN_HOLD_MS = 4000;
export const DEMO_LOSS_HOLD_MS = 3000;
/*
 Watchdog. The bot wins about half the landscapes it plays, and a good share of the rest end with
 it alive but achieving nothing — circling a tile it can't build on, or boxed in below three
 energy so even the hyperspace escape hatch is out of reach. Left alone that hangs the demo
 indefinitely, so two limits close it out: one on going nowhere, one on the landscape overall.

 The no-progress window is measured from the last action the rules actually accepted. It has to
 clear the 1 Hz cadence with room for a failed aim or two and the retry ladder behind it, so a bot
 that is merely having a hard time isn't cut off mid-recovery.
*/
export const DEMO_NO_PROGRESS_MS = 30_000;
export const DEMO_LEVEL_LIMIT_MS = 300_000;
