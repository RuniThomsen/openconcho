import { describe, expect, it } from "vitest";
import { buildMemoryPulseModel } from "@/components/workspaces/MemoryPulsePane";

function conclusion(id: string, observer: string, observed: string, index: number) {
	return {
		id,
		content: `memory ${id}`,
		observer_id: observer,
		observed_id: observed,
		created_at: new Date(2026, 0, index + 1).toISOString(),
	};
}

describe("buildMemoryPulseModel", () => {
	it("builds weighted peer arcs from conclusions", () => {
		const model = buildMemoryPulseModel({
			peerIds: ["abel", "runi", "josh"],
			conclusions: [
				conclusion("c1", "abel", "runi", 1),
				conclusion("c2", "abel", "runi", 2),
				conclusion("c3", "runi", "josh", 3),
			],
			totalConclusions: 42,
			activeWork: 2,
		});

		expect(model.totalConclusions).toBe(42);
		expect(model.sampledConclusions).toBe(3);
		expect(model.activeWork).toBe(2);
		expect(model.nodes.map((node) => node.id)).toEqual(["runi", "abel", "josh"]);
		expect(model.edges).toEqual([
			expect.objectContaining({ from: "abel", to: "runi", count: 2 }),
			expect.objectContaining({ from: "runi", to: "josh", count: 1 }),
		]);
	});

	it("keeps the visible graph bounded", () => {
		const model = buildMemoryPulseModel({
			peerIds: Array.from({ length: 20 }, (_, index) => `peer-${index}`),
			conclusions: [],
			totalConclusions: 0,
			maxNodes: 6,
		});

		expect(model.nodes).toHaveLength(6);
		expect(model.edges).toHaveLength(0);
	});
});
