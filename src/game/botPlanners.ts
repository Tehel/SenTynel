/*
 Which strategy drives the demo. The one place that knows both planners exist, so nothing else has
 to import a planner it isn't using (PLAN-BOT2.md, B3).
*/

import { LadderPlanner } from './bot';
import { PhasePlanner } from './bot2';
import type { BotPlanner } from './botWorld';

export type PlannerId = 'v1' | 'v2';

export const PLANNER_IDS: PlannerId[] = ['v1', 'v2'];

export function createPlanner(id: PlannerId): BotPlanner {
	return id === 'v2' ? new PhasePlanner() : new LadderPlanner();
}
