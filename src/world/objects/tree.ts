import { GameObjType } from '../terrain';
import { GameObject } from './base';

export class Tree extends GameObject {
	static type: GameObjType = GameObjType.TREE;
}
