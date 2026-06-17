import { describe, expect, it } from "vitest";
import { buildMemoryPulseModel } from "@/components/workspaces/MemoryPulsePane";

function conclusion(id: string, observer: string, observed: string, index: number) {
	return {
		id,
		content: `memory ${id}`,
		observer_id: observer,
		observed_id: observed,
		session_id: `session-${index}`,
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
			sessions: [
				{ id: "session-1", is_active: true },
				{ id: "session-2", is_active: false },
			],
			totalConclusions: 42,
			totalSessions: 9,
			totalWebhooks: 2,
			activeWork: 2,
			totalWork: 120,
		});

		expect(model.totalConclusions).toBe(42);
		expect(model.sampledConclusions).toBe(3);
		expect(model.totalSessions).toBe(9);
		expect(model.activeSessions).toBe(1);
		expect(model.sessionAnchors).toEqual([
			{ active: true, id: "session-1", index: 0 },
			{ active: false, id: "session-2", index: 1 },
		]);
		expect(model.conclusionTraces).toEqual([
			expect.objectContaining({ from: "abel", id: "c1", sessionId: "session-1", to: "runi" }),
			expect.objectContaining({ from: "abel", id: "c2", sessionId: "session-2", to: "runi" }),
			expect.objectContaining({ from: "runi", id: "c3", sessionId: "session-3", to: "josh" }),
		]);
		expect(model.totalWebhooks).toBe(2);
		expect(model.activeWork).toBe(2);
		expect(model.totalWork).toBe(120);
		expect(model.nodes.map((node) => node.id)).toEqual(["runi", "abel", "josh"]);
		expect(model.scaffoldEdges).toHaveLength(3);
		expect(model.dimensions.map((dimension) => dimension.key)).toEqual([
			"peers",
			"sessions",
			"conclusions",
			"work",
			"ingress",
		]);
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
		expect(model.scaffoldEdges).toHaveLength(15);
		expect(model.edges).toHaveLength(0);
	});
});
