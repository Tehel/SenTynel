// User-visible delay before TRANSFER (a camera move) returns to PLAYING. WON/LOST have no
// equivalent timer — WinScreen/LoseScreen are dismissed by keypress only.
export const TRANSFER_DELAY_MS = 1000;

// Minimum gap between player-initiated actions (create/absorb/transfer/hyperspace),
// matching the watchers' 1 Hz cadence.
export const ACTION_COOLDOWN_MS = 1000;
