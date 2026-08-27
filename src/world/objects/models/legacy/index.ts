/*
 The ORIGINAL model geometry, frozen.

 These are not old versions kept for sentiment — they are the shapes the game's rules were tuned
 against, and they are what every raycast still hits. engine/visibility.ts blocks on them,
 engine/picker.ts resolves the crosshair against them, and engine/watcher.ts measures a synthoid's
 head from one to decide whether the player is seen (RULES-FIDELITY.md C9). The models rendered
 beside them are free to change precisely because these do not.

 Nothing here should be edited to make a drawn model look better. If one of these has to move, the
 game has changed, and utils/rules-check.sh will say so.
*/
import { GameObjType } from '../../../terrain';
import { sentinel } from './sentinel';
import { tree } from './tree';
import { pedestal } from './pedestal';
import { boulder } from './boulder';
import { synthoid } from './synthoid';
import { sentry } from './sentry';
import { meanie } from './meanie';

export interface LegacyModel {
	v: number[][];
	f: { v: number[]; color: number }[];
}

export const legacyModels: Record<GameObjType, LegacyModel> = {
	[GameObjType.SENTINEL]: sentinel,
	[GameObjType.SENTRY]: sentry,
	[GameObjType.MEANIE]: meanie,
	[GameObjType.PEDESTAL]: pedestal,
	[GameObjType.TREE]: tree,
	[GameObjType.SYNTHOID]: synthoid,
	[GameObjType.BOULDER]: boulder,
};
