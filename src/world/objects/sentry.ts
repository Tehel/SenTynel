import { GameObjType } from '../terrain';
import { Sentinel } from './sentinel';

export class Sentry extends Sentinel {
	static type: GameObjType = GameObjType.SENTRY;
}
