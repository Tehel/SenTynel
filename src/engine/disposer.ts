import type { BufferGeometry, Material, WebGLRenderTarget } from 'three';

type Disposable = BufferGeometry | Material | WebGLRenderTarget;

export class Disposer {
	private items: Disposable[] = [];

	register(item: Disposable): void {
		this.items.push(item);
	}

	disposeAll(): void {
		this.items.forEach(item => item.dispose());
		this.items.splice(0);
	}
}
