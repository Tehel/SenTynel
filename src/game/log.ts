// 'ai' is the game's own actors (watcher drains, meanie moves); 'bot' is the demo-mode player
// in engine/bot.ts. Kept apart so a console filter can follow one without the other.
export type LogCategory = 'internal' | 'state' | 'scene' | 'energy' | 'action' | 'ai' | 'bot' | 'travel' | 'input';

export function logEvent(category: LogCategory, event: string, detail?: Record<string, unknown>): void {
	if (detail !== undefined) {
		console.debug(`[${category}] ${event}`, detail);
	} else {
		console.debug(`[${category}] ${event}`);
	}
}
