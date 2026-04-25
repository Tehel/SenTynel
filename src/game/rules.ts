import { GameObjType } from '../world/terrain';

export const ENERGY_COST: Partial<Record<GameObjType, number>> = {
	[GameObjType.TREE]: 1,
	[GameObjType.BOULDER]: 2,
	[GameObjType.SYNTHOID]: 3,
	[GameObjType.SENTRY]: 3,
	[GameObjType.SENTINEL]: 4,
	[GameObjType.MEANIE]: 1,
};

export function energyCostOf(type: GameObjType): number {
	return ENERGY_COST[type] ?? 0;
}
