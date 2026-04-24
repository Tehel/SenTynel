import { GameObjType } from '../terrain';
import { GameObject } from './base';

export class Boulder extends GameObject {
	static type: GameObjType = GameObjType.BOULDER;
}
