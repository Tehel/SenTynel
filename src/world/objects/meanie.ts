import { GameObjType } from '../terrain';
import { GameObject } from './base';

export class Meanie extends GameObject {
	static type: GameObjType = GameObjType.MEANIE;

	/*
	 How far this Meanie has swept, in 256ths of a turn (engine/meanie.ts).

	 It gets ONE full rotation to find the player's square; miss, and it reverts to a tree and the
	 watcher that made it goes back to scanning. That budget is the whole counter-play — break the
	 sighting and you can wait it out — so the total has to be carried on the object rather than
	 inferred from `rot`, which wraps and would make one sweep indistinguishable from ten.
	*/
	sweptUnits = 0;
}
