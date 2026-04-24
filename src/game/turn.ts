export const TICK_HZ = 4;
const TICK_MS = 1000 / TICK_HZ;

export class TurnDriver {
	private accumulator = 0;
	private count = 0;

	update(dt: number, onTick: (tick: number) => void): void {
		this.accumulator += dt;
		while (this.accumulator >= TICK_MS) {
			this.accumulator -= TICK_MS;
			onTick(++this.count);
		}
	}

	reset(): void {
		this.accumulator = 0;
		this.count = 0;
	}
}
