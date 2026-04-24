import { WebGLRenderer } from 'three';
import type { PerspectiveCamera, Scene } from 'three';

export class RendererManager {
	readonly renderer: WebGLRenderer;
	private animFrameId: number | null = null;

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
		this.resize();
	}

	resize(): void {
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	start(onFrame: (time: number) => void): void {
		const loop = (time: number) => {
			onFrame(time);
			this.animFrameId = requestAnimationFrame(loop);
		};
		this.animFrameId = requestAnimationFrame(loop);
	}

	render(scene: Scene, camera: PerspectiveCamera): void {
		this.renderer.render(scene, camera);
	}

	stop(): void {
		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}
	}
}
