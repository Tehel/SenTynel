import { ShapePath, type Shape } from 'three';

interface Glyph {
	ha: number;
	x_min: number;
	x_max: number;
	o: string;
	_cachedOutline?: string[];
}

export interface FontData {
	glyphs: Record<string, Glyph>;
	familyName: string;
	resolution: number;
	underlineThickness: number;
	boundingBox: { xMin: number; xMax: number; yMin: number; yMax: number };
}

export class Font {
	readonly isFont = true;
	readonly type = 'Font';
	data: FontData;

	constructor(data: FontData) {
		this.data = data;
	}

	generateShapes(text: string, size = 100): Shape[] {
		const shapes: Shape[] = [];
		const paths = createPaths(text, size, this.data);

		for (let p = 0, pl = paths.length; p < pl; p++) {
			Array.prototype.push.apply(shapes, paths[p].toShapes(false));
		}
		return shapes;
	}
}

function createPaths(text: string, size: number, data: FontData): ShapePath[] {
	const chars = Array.from(text);
	const scale = size / data.resolution;
	const line_height = (data.boundingBox.yMax - data.boundingBox.yMin + data.underlineThickness) * scale;

	const paths: ShapePath[] = [];
	let offsetX = 0,
		offsetY = 0;

	for (let i = 0; i < chars.length; i++) {
		const char = chars[i];

		if (char === '\n') {
			offsetX = 0;
			offsetY -= line_height;
		} else {
			const ret = createPath(char, scale, offsetX, offsetY, data);
			if (ret) {
				offsetX += ret.offsetX;
				paths.push(ret.path);
			}
		}
	}
	return paths;
}

function createPath(char: string, scale: number, offsetX: number, offsetY: number, data: FontData) {
	const glyph = data.glyphs[char] || data.glyphs['?'];
	if (!glyph) {
		console.error('THREE.Font: character "' + char + '" does not exists in font family ' + data.familyName + '.');
		return null;
	}

	const path = new ShapePath();
	let x, y, cpx, cpy, cpx1, cpy1, cpx2, cpy2;

	if (glyph.o) {
		const outline = glyph._cachedOutline || (glyph._cachedOutline = glyph.o.split(' '));

		for (let i = 0, l = outline.length; i < l; ) {
			const action = outline[i++];
			switch (action) {
				case 'm': // moveTo
					x = +outline[i++] * scale + offsetX;
					y = +outline[i++] * scale + offsetY;
					path.moveTo(x, y);
					break;

				case 'l': // lineTo
					x = +outline[i++] * scale + offsetX;
					y = +outline[i++] * scale + offsetY;
					path.lineTo(x, y);
					break;

				case 'q': // quadraticCurveTo
					cpx = +outline[i++] * scale + offsetX;
					cpy = +outline[i++] * scale + offsetY;
					cpx1 = +outline[i++] * scale + offsetX;
					cpy1 = +outline[i++] * scale + offsetY;
					path.quadraticCurveTo(cpx1, cpy1, cpx, cpy);
					break;

				case 'b': // bezierCurveTo
					cpx = +outline[i++] * scale + offsetX;
					cpy = +outline[i++] * scale + offsetY;
					cpx1 = +outline[i++] * scale + offsetX;
					cpy1 = +outline[i++] * scale + offsetY;
					cpx2 = +outline[i++] * scale + offsetX;
					cpy2 = +outline[i++] * scale + offsetY;
					path.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, cpx, cpy);
					break;
			}
		}
	}
	return { offsetX: glyph.ha * scale, path };
}
