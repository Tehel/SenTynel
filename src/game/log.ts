export type LogCategory = 'state' | 'energy' | 'action' | 'ai' | 'travel';

export function logEvent(category: LogCategory, event: string, detail?: Record<string, unknown>): void {
	if (detail !== undefined) {
		console.debug(`[${category}] ${event}`, detail);
	} else {
		console.debug(`[${category}] ${event}`);
	}
}
