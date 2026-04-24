import { BufferGeometry, DoubleSide, Group, Mesh, MeshPhongMaterial, Vector3 } from 'three';
import { GameObjType } from '../../terrain';
import { sentinel } from './sentinel';
import { tree } from './tree';
import { pedestal } from './pedestal';
import { boulder } from './boulder';
import { synthoid } from './synthoid';
import { sentry } from './sentry';
import { meanie } from './meanie';

interface Face {
	v: number[];
	color: number;
}

interface Model {
	v: number[][];
	f: Face[];
}

const models: Record<GameObjType, Model> = {
	[GameObjType.SENTINEL]: sentinel,
	[GameObjType.SENTRY]: sentry,
	[GameObjType.MEANIE]: meanie,
	[GameObjType.PEDESTAL]: pedestal,
	[GameObjType.TREE]: tree,
	[GameObjType.SYNTHOID]: synthoid,
	[GameObjType.BOULDER]: boulder,
};

export interface ModelOptions {
	scale?: number;
	color1?: number;
	color2?: number;
}

export function getObject(type: GameObjType, options?: ModelOptions) {
	const model = models[type];
	if (!model) return null;

	const sc = options?.scale || 1;
	const vs: Vector3[] = model.v.map(v => new Vector3(v[0] * sc, v[1] * sc, v[2] * sc));

	const group = new Group();
	model.f.forEach(f => {
		const color =
			f.color === -1 ? options?.color1 || 0xff00ff : f.color === -2 ? options?.color2 || 0xff8000 : f.color;
		const material = new MeshPhongMaterial({
			color,
			flatShading: true,
			specular: 0x404040,
			transparent: true,
			opacity: 0,
			side: DoubleSide,
		});
		const points = [vs[f.v[0] - 1], vs[f.v[1] - 1], vs[f.v[2] - 1]];
		const geometry = new BufferGeometry().setFromPoints(points);
		// store highest position of this geometry for later sorting criteria
		const highest = Math.max(...points.map(v => v.y));
		geometry.userData = { highest };
		const mesh = new Mesh(geometry, material);
		group.add(mesh);
	});
	return group;
}
