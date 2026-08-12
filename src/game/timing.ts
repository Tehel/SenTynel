// Duration of the body-transfer camera glide (engine/camera.ts's beginTransferAnim/
// updateTransfer). TRANSFER returns to PLAYING once the glide finishes — there is no
// separate timer, so this constant is the sole source of truth for how long TRANSFER lasts.
// WON/LOST have no equivalent timer — WinScreen/LoseScreen are dismissed by keypress only.
export const TRANSFER_DELAY_MS = 1000;

// Minimum gap between player-initiated actions (create/absorb/transfer/hyperspace),
// matching the watchers' 1 Hz cadence.
export const ACTION_COOLDOWN_MS = 1000;

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
