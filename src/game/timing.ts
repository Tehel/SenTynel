// Duration of the body-transfer camera glide (engine/camera.ts's beginTransferAnim/
// updateTransfer). TRANSFER returns to PLAYING once the glide finishes — there is no
// separate timer, so this constant is the sole source of truth for how long TRANSFER lasts.
// WON/LOST have no equivalent timer — WinScreen/LoseScreen are dismissed by keypress only.
export const TRANSFER_DELAY_MS = 1000;

// Minimum gap between player-initiated actions (create/absorb/transfer/hyperspace),
// matching the watchers' 1 Hz cadence.
export const ACTION_COOLDOWN_MS = 1000;
