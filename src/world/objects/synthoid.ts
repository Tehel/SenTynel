import { GameObjType } from '../terrain';
import { GameObject } from './base';

export class Synthoid extends GameObject {
	static type: GameObjType = GameObjType.SYNTHOID;
}
