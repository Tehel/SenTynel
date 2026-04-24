import { GameObjType } from '../terrain';
import { GameObject } from './base';

export class Pedestal extends GameObject {
	static type: GameObjType = GameObjType.PEDESTAL;
}
