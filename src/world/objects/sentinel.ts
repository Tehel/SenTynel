import { GameObjType } from '../terrain';
import { Watcher } from './watcher';

export class Sentinel extends Watcher {
	static type: GameObjType = GameObjType.SENTINEL;
}
