// Runs off the main thread so a full 0..MAX_LEVEL_ID sweep never competes with rendering/input.
// One instance handles one contiguous shard of level ids — levelCodes.ts's buildIndex() splits
// the full range across navigator.hardwareConcurrency instances of this worker.
import { generateLevel } from '../world/terrain';

export interface IndexerRequest {
	start: number;
	end: number; // exclusive
}

export interface IndexerResponse {
	start: number;
	codes: string[];
}

self.onmessage = (event: MessageEvent<IndexerRequest>) => {
	const { start, end } = event.data;
	const codes: string[] = [];
	for (let id = start; id < end; id++) codes.push(generateLevel(id).codes['PC/ST']);
	const response: IndexerResponse = { start, codes };
	self.postMessage(response);
};
