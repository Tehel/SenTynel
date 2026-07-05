import { GameObjType } from '../terrain';
import { Watcher } from './watcher';

export class Sentry extends Watcher {
	static type: GameObjType = GameObjType.SENTRY;
}
