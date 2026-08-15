/*
 Anything holding GPU resources that must be released when a scene is torn down. Structural
 rather than a union of the three original Three.js types: an InstancedMesh owns its instance
 matrix and colour buffers and needs the same treatment (engine/exposureOverlay.ts), and the
 registry only ever calls dispose(), so the shape is the whole contract.
*/
type Disposable = { dispose(): void };

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
