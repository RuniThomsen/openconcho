import { Activity, Radio } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { CatmullRomCurve3, LineBasicMaterial, Mesh, Object3D, Vector3 } from "three";
import { useConclusions, usePeers, useSessions, useWebhooks } from "@/api/queries";
import type { components } from "@/api/schema";
import { Caption, MonoCaption, SectionHeading } from "@/components/ui/typography";
import { useDemo } from "@/hooks/useDemo";

type Conclusion = components["schemas"]["Conclusion"];
type ConclusionPage = components["schemas"]["Page_Conclusion_"];
type PeerPage = components["schemas"]["Page_Peer_"];
type SessionPage = components["schemas"]["Page_Session_"];
type WebhookPage = components["schemas"]["Page_WebhookEndpoint_"];

interface QueuePulse {
	in_progress_work_units?: number;
	pending_work_units?: number;
	total_work_units?: number;
}

interface PulseNode {
	id: string;
	count: number;
}

interface PulseEdge {
	key: string;
	from: string;
	to: string;
	count: number;
	recentness: number;
}

interface ScaffoldEdge {
	key: string;
	from: string;
	to: string;
}

interface PulseDimension {
	key: "peers" | "sessions" | "conclusions" | "work" | "ingress";
	label: string;
	value: number;
	intensity: number;
}

export interface MemoryPulseModel {
	nodes: PulseNode[];
	edges: PulseEdge[];
	scaffoldEdges: ScaffoldEdge[];
	dimensions: PulseDimension[];
	totalConclusions: number;
	sampledConclusions: number;
	totalSessions: number;
	activeSessions: number;
	totalWebhooks: number;
	activeWork: number;
	totalWork: number;
}

export function buildMemoryPulseModel({
	peerIds,
	conclusions,
	sessions = [],
	totalConclusions,
	totalSessions = sessions.length,
	totalWebhooks = 0,
	activeWork = 0,
	totalWork = 0,
	maxNodes = 24,
}: {
	peerIds: string[];
	conclusions: Conclusion[];
	sessions?: Array<{ is_active?: boolean | null }>;
	totalConclusions: number;
	totalSessions?: number;
	totalWebhooks?: number;
	activeWork?: number;
	totalWork?: number;
	maxNodes?: number;
}): MemoryPulseModel {
	const nodeCounts = new Map<string, number>();
	const edgeCounts = new Map<string, PulseEdge>();

	for (const id of peerIds) {
		if (id) nodeCounts.set(id, nodeCounts.get(id) ?? 0);
	}

	conclusions.forEach((conclusion, index) => {
		const from = conclusion.observer_id;
		const to = conclusion.observed_id;
		if (!from || !to) return;

		nodeCounts.set(from, (nodeCounts.get(from) ?? 0) + 1);
		nodeCounts.set(to, (nodeCounts.get(to) ?? 0) + 1);

		const key = `${from}→${to}`;
		const current = edgeCounts.get(key);
		edgeCounts.set(key, {
			key,
			from,
			to,
			count: (current?.count ?? 0) + 1,
			recentness: Math.max(current?.recentness ?? 0, conclusions.length - index),
		});
	});

	const nodes = [...nodeCounts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, maxNodes)
		.map(([id, count]) => ({ id, count }));
	const visible = new Set(nodes.map((node) => node.id));
	const scaffoldEdges: ScaffoldEdge[] = [];
	for (let i = 0; i < nodes.length; i += 1) {
		for (let j = i + 1; j < nodes.length; j += 1) {
			scaffoldEdges.push({
				key: `${nodes[i].id}↔${nodes[j].id}`,
				from: nodes[i].id,
				to: nodes[j].id,
			});
		}
	}
	const edges = [...edgeCounts.values()]
		.filter((edge) => visible.has(edge.from) && visible.has(edge.to))
		.sort((a, b) => b.count - a.count || b.recentness - a.recentness)
		.slice(0, 56);
	const activeSessions = sessions.filter((session) => session.is_active).length;
	const dimensions: PulseDimension[] = [
		{
			key: "peers",
			label: "peer field",
			value: nodes.length,
			intensity: Math.min(nodes.length / Math.max(maxNodes, 1), 1),
		},
		{
			key: "sessions",
			label: "sessions",
			value: totalSessions,
			intensity: Math.min(totalSessions / 100, 1),
		},
		{
			key: "conclusions",
			label: "conclusions",
			value: totalConclusions,
			intensity: Math.min(totalConclusions / 500_000, 1),
		},
		{
			key: "work",
			label: "queue",
			value: activeWork,
			intensity: Math.min(activeWork / 64, 1),
		},
		{
			key: "ingress",
			label: "webhooks",
			value: totalWebhooks,
			intensity: Math.min(totalWebhooks / 12, 1),
		},
	];

	return {
		nodes,
		edges,
		scaffoldEdges,
		dimensions,
		totalConclusions,
		sampledConclusions: conclusions.length,
		totalSessions,
		activeSessions,
		totalWebhooks,
		activeWork,
		totalWork,
	};
}

export function MemoryPulsePane({
	workspaceId,
	queue,
}: {
	workspaceId: string;
	queue?: QueuePulse | null;
}) {
	const { mask } = useDemo();
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const { data: peerData } = usePeers(workspaceId, 1, 100);

	const peerPage = peerData as PeerPage | undefined;
	const activeWork = (queue?.pending_work_units ?? 0) + (queue?.in_progress_work_units ?? 0);
	const liveRefetchInterval = activeWork > 0 ? 2500 : 6500;
	const { data: sessionData } = useSessions(workspaceId, 1, 100, liveRefetchInterval);
	const { data: webhookData } = useWebhooks(workspaceId);
	const { data: conclusionData, isLoading } = useConclusions(
		workspaceId,
		{},
		1,
		100,
		false,
		liveRefetchInterval,
	);
	const conclusionPage = conclusionData as ConclusionPage | undefined;
	const sessionPage = sessionData as SessionPage | undefined;
	const webhookPage = webhookData as WebhookPage | undefined;
	const conclusions = conclusionPage?.items ?? [];
	const sessions = sessionPage?.items ?? [];

	const model = useMemo(
		() =>
			buildMemoryPulseModel({
				peerIds: peerPage?.items.map((peer) => peer.id) ?? [],
				conclusions,
				sessions,
				totalConclusions: conclusionPage?.total ?? conclusions.length,
				totalSessions: sessionPage?.total ?? sessions.length,
				totalWebhooks: webhookPage?.total ?? webhookPage?.items.length ?? 0,
				activeWork,
				totalWork: queue?.total_work_units ?? 0,
			}),
		[
			activeWork,
			conclusionPage?.total,
			conclusions,
			peerPage?.items,
			queue?.total_work_units,
			sessionPage?.total,
			sessions,
			webhookPage?.items.length,
			webhookPage?.total,
		],
	);
	const modelRef = useRef(model);
	const updateSceneRef = useRef<((nextModel: MemoryPulseModel) => void) | null>(null);

	useEffect(() => {
		modelRef.current = model;
		updateSceneRef.current?.(model);
	}, [model]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		let disposed = false;
		let cleanup: (() => void) | undefined;

		async function mountScene() {
			const THREE = await import("three");
			if (disposed || !canvasRef.current) return;
			const activeCanvas = canvasRef.current;

			const rootStyle = getComputedStyle(document.documentElement);
			const accent = rootStyle.getPropertyValue("--accent-soft").trim() || "#7a1c17";
			const ink = rootStyle.getPropertyValue("--text-1").trim() || "#111214";
			const dim = rootStyle.getPropertyValue("--text-3").trim() || "#6f747d";
			const bg = rootStyle.getPropertyValue("--bg-2").trim() || "#fffdf8";
			const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

			const scene = new THREE.Scene();
			const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
			camera.position.set(0, 0.18, 5.15);
			camera.lookAt(0, 0, 0);

			const renderer = new THREE.WebGLRenderer({
				alpha: true,
				antialias: true,
				canvas: activeCanvas,
				powerPreference: "high-performance",
			});
			renderer.setClearColor(0x000000, 0);
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

			const group = new THREE.Group();
			scene.add(group);
			const nodeGroup = new THREE.Group();
			group.add(nodeGroup);
			const scaffoldGroup = new THREE.Group();
			group.add(scaffoldGroup);
			const activeGroup = new THREE.Group();
			group.add(activeGroup);
			const wakeGroup = new THREE.Group();
			group.add(wakeGroup);
			const particleGroup = new THREE.Group();
			group.add(particleGroup);
			const dimensionGroup = new THREE.Group();
			group.add(dimensionGroup);

			const ambient = new THREE.AmbientLight(new THREE.Color(bg), 2.1);
			scene.add(ambient);
			const key = new THREE.PointLight(new THREE.Color(accent), 3.2, 9);
			key.position.set(1.7, 2.1, 2.5);
			scene.add(key);

			const core = new THREE.Mesh(
				new THREE.SphereGeometry(0.18, 40, 24),
				new THREE.MeshStandardMaterial({
					color: new THREE.Color(accent),
					emissive: new THREE.Color(accent),
					emissiveIntensity: 0.42,
					roughness: 0.34,
					metalness: 0.28,
					transparent: true,
					opacity: 0.88,
				}),
			);
			group.add(core);

			const ring = new THREE.Mesh(
				new THREE.TorusGeometry(0.42, 0.0045, 8, 96),
				new THREE.MeshBasicMaterial({
					color: new THREE.Color(accent),
					transparent: true,
					opacity: 0.34,
				}),
			);
			ring.rotation.x = Math.PI / 2.15;
			group.add(ring);

			let graphSignature = "";
			let particles: Array<{
				curve: CatmullRomCurve3;
				particle: Mesh;
				offset: number;
				speed: number;
			}> = [];
			let scaffoldMaterials: LineBasicMaterial[] = [];
			let wakeMaterials: LineBasicMaterial[] = [];

			const disposeTree = (root: Object3D) => {
				const disposedMaterials = new Set<unknown>();
				root.traverse((object: Object3D) => {
					const mesh = object as Mesh;
					mesh.geometry?.dispose();
					const material = mesh.material;
					if (Array.isArray(material)) {
						for (const item of material) {
							if (!disposedMaterials.has(item)) {
								item.dispose();
								disposedMaterials.add(item);
							}
						}
					} else if (material && !disposedMaterials.has(material)) {
						material.dispose();
						disposedMaterials.add(material);
					}
				});
			};

			const clearGraphGroup = (target: Object3D) => {
				disposeTree(target);
				target.clear();
			};

			const getGraphSignature = (nextModel: MemoryPulseModel) =>
				JSON.stringify({
					nodes: nextModel.nodes.map((node) => [node.id, node.count]),
					edges: nextModel.edges.map((edge) => [edge.key, edge.count, edge.recentness]),
					dimensions: nextModel.dimensions.map((dimension) => [
						dimension.key,
						dimension.value,
						Number(dimension.intensity.toFixed(3)),
					]),
				});

			const updateGraph = (nextModel: MemoryPulseModel) => {
				const nextSignature = getGraphSignature(nextModel);
				if (nextSignature === graphSignature) return;
				graphSignature = nextSignature;
				particles = [];
				scaffoldMaterials = [];
				wakeMaterials = [];
				clearGraphGroup(nodeGroup);
				clearGraphGroup(scaffoldGroup);
				clearGraphGroup(activeGroup);
				clearGraphGroup(wakeGroup);
				clearGraphGroup(particleGroup);
				clearGraphGroup(dimensionGroup);

				const nodeMap = new Map<string, Vector3>();
				const nodeTotal = Math.max(nextModel.nodes.length, 1);
				const goldenAngle = Math.PI * (3 - Math.sqrt(5));
				nextModel.nodes.forEach((node, index) => {
					const progress = nodeTotal === 1 ? 0.5 : index / (nodeTotal - 1);
					const y = 1 - progress * 2;
					const shell = Math.sqrt(Math.max(0, 1 - y * y));
					const angle = index * goldenAngle;
					const position = new THREE.Vector3(
						Math.cos(angle) * shell * 1.82,
						y * 0.92,
						Math.sin(angle) * shell * 0.82,
					);
					nodeMap.set(node.id, position);

					const size = 0.032 + Math.min(node.count, 42) * 0.0016;
					const orb = new THREE.Mesh(
						new THREE.SphereGeometry(size, 24, 16),
						new THREE.MeshStandardMaterial({
							color: new THREE.Color(ink),
							emissive: new THREE.Color(accent),
							emissiveIntensity: 0.08 + Math.min(node.count, 60) / 150,
							roughness: 0.48,
							metalness: 0.18,
						}),
					);
					orb.position.copy(position);
					nodeGroup.add(orb);

					const halo = new THREE.Mesh(
						new THREE.SphereGeometry(size * 2.35, 24, 16),
						new THREE.MeshBasicMaterial({
							color: new THREE.Color(accent),
							transparent: true,
							opacity: 0.045 + Math.min(node.count, 50) / 1000,
							depthWrite: false,
						}),
					);
					halo.position.copy(position);
					nodeGroup.add(halo);
				});

				const scaffoldBuckets = Array.from({ length: 5 }, () => [] as number[]);
				for (const [edgeIndex, edge] of nextModel.scaffoldEdges.entries()) {
					const from = nodeMap.get(edge.from);
					const to = nodeMap.get(edge.to);
					if (!from || !to) continue;
					const bucket = scaffoldBuckets[edgeIndex % scaffoldBuckets.length];
					bucket.push(from.x, from.y, from.z, to.x, to.y, to.z);
				}
				for (const [bucketIndex, positions] of scaffoldBuckets.entries()) {
					if (positions.length === 0) continue;
					const geometry = new THREE.BufferGeometry();
					geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
					const material = new THREE.LineBasicMaterial({
						color: new THREE.Color(dim),
						transparent: true,
						opacity: 0.052 + bucketIndex * 0.006,
						depthWrite: false,
					});
					scaffoldMaterials.push(material);
					const scaffold = new THREE.LineSegments(geometry, material);
					scaffoldGroup.add(scaffold);
				}

				const dimensionPositions = new Map<PulseDimension["key"], Vector3>();
				nextModel.dimensions.forEach((dimension, index) => {
					const angle = (index / nextModel.dimensions.length) * Math.PI * 2 + Math.PI / 8;
					const radius = dimension.key === "conclusions" ? 0.9 : 2.08;
					const y =
						dimension.key === "work"
							? -1.08
							: dimension.key === "sessions"
								? 1.08
								: Math.sin(angle) * 0.58;
					const z =
						dimension.key === "sessions"
							? -0.42
							: dimension.key === "work"
								? 0.62
								: Math.cos(angle) * 0.48;
					dimensionPositions.set(dimension.key, new THREE.Vector3(Math.cos(angle) * radius, y, z));
				});

				const spokePositions: number[] = [];
				for (const position of dimensionPositions.values()) {
					spokePositions.push(0, 0, 0, position.x, position.y, position.z);
				}
				if (spokePositions.length > 0) {
					const geometry = new THREE.BufferGeometry();
					geometry.setAttribute("position", new THREE.Float32BufferAttribute(spokePositions, 3));
					dimensionGroup.add(
						new THREE.LineSegments(
							geometry,
							new THREE.LineBasicMaterial({
								color: new THREE.Color(accent),
								transparent: true,
								opacity: 0.09,
								depthWrite: false,
							}),
						),
					);
				}

				for (const dimension of nextModel.dimensions) {
					const position = dimensionPositions.get(dimension.key);
					if (!position) continue;
					const markerSize = 0.035 + dimension.intensity * 0.035;
					const marker = new THREE.Mesh(
						new THREE.SphereGeometry(markerSize, 18, 12),
						new THREE.MeshBasicMaterial({
							color: new THREE.Color(dimension.key === "work" ? accent : ink),
							transparent: true,
							opacity: dimension.value > 0 ? 0.62 : 0.22,
							depthWrite: false,
						}),
					);
					marker.position.copy(position);
					dimensionGroup.add(marker);
				}

				const addGraphVertex = (
					position: Vector3,
					size: number,
					color: string,
					opacity: number,
				) => {
					const vertex = new THREE.Mesh(
						new THREE.SphereGeometry(size, 14, 10),
						new THREE.MeshBasicMaterial({
							color: new THREE.Color(color),
							transparent: true,
							opacity,
							depthWrite: false,
						}),
					);
					vertex.position.copy(position);
					dimensionGroup.add(vertex);
					return vertex;
				};

				const addGraphEdges = (positions: number[], color: string, opacity: number) => {
					if (positions.length === 0) return;
					const geometry = new THREE.BufferGeometry();
					geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
					dimensionGroup.add(
						new THREE.LineSegments(
							geometry,
							new THREE.LineBasicMaterial({
								color: new THREE.Color(color),
								transparent: true,
								opacity,
								depthWrite: false,
							}),
						),
					);
				};

				const sessionVertexCount =
					nextModel.totalSessions === 0
						? 0
						: Math.min(Math.max(Math.ceil(nextModel.totalSessions / 160), 10), 34);
				const sessionVertices = Array.from({ length: sessionVertexCount }, (_, index) => {
					const angle = (index / Math.max(sessionVertexCount, 1)) * Math.PI * 2;
					const position = new THREE.Vector3(
						Math.cos(angle) * 1.98,
						0.78 + Math.sin(angle * 2.0) * 0.14,
						Math.sin(angle) * 0.64 - 0.18,
					);
					addGraphVertex(
						position,
						index < nextModel.activeSessions ? 0.024 : 0.016,
						index < nextModel.activeSessions ? accent : dim,
						index < nextModel.activeSessions ? 0.62 : 0.38,
					);
					return position;
				});
				const sessionEdges: number[] = [];
				const sessionAnchor = dimensionPositions.get("sessions");
				for (let index = 0; index < sessionVertices.length; index += 1) {
					const current = sessionVertices[index];
					const next = sessionVertices[(index + 1) % sessionVertices.length];
					sessionEdges.push(current.x, current.y, current.z, next.x, next.y, next.z);
					if (sessionAnchor && index % 5 === 0) {
						sessionEdges.push(
							current.x,
							current.y,
							current.z,
							sessionAnchor.x,
							sessionAnchor.y,
							sessionAnchor.z,
						);
					}
				}
				addGraphEdges(sessionEdges, dim, 0.105);

				const workVertexCount =
					nextModel.totalWork === 0
						? 0
						: Math.min(Math.max(Math.ceil(Math.log10(nextModel.totalWork + 1) * 2), 5), 14);
				const workVertices = Array.from({ length: workVertexCount }, (_, index) => {
					const progress = index / Math.max(workVertexCount - 1, 1);
					const position = new THREE.Vector3(
						2.16,
						progress * 1.72 - 0.86,
						0.54 + Math.sin(progress * Math.PI) * 0.18,
					);
					addGraphVertex(position, 0.014 + progress * 0.01, accent, 0.28 + progress * 0.24);
					return position;
				});
				const workEdges: number[] = [];
				const workAnchor = dimensionPositions.get("work");
				for (let index = 0; index < workVertices.length - 1; index += 1) {
					const current = workVertices[index];
					const next = workVertices[index + 1];
					workEdges.push(current.x, current.y, current.z, next.x, next.y, next.z);
				}
				if (workAnchor && workVertices.length > 0) {
					const last = workVertices[workVertices.length - 1];
					workEdges.push(last.x, last.y, last.z, workAnchor.x, workAnchor.y, workAnchor.z);
				}
				addGraphEdges(workEdges, accent, nextModel.activeWork > 0 ? 0.2 : 0.11);

				const ingressVertexCount = Math.min(nextModel.totalWebhooks, 8);
				const ingressAnchor = dimensionPositions.get("ingress");
				const ingressEdges: number[] = [];
				for (let index = 0; index < ingressVertexCount; index += 1) {
					const angle = (index / Math.max(ingressVertexCount, 1)) * Math.PI * 2;
					const position = new THREE.Vector3(
						-2.12 + Math.cos(angle) * 0.18,
						-0.18 + Math.sin(angle) * 0.28,
						0.5 + Math.sin(angle * 0.5) * 0.18,
					);
					addGraphVertex(position, 0.018, accent, 0.5);
					if (ingressAnchor) {
						ingressEdges.push(
							position.x,
							position.y,
							position.z,
							ingressAnchor.x,
							ingressAnchor.y,
							ingressAnchor.z,
						);
					}
				}
				addGraphEdges(ingressEdges, accent, 0.16);

				const curves: Array<{ curve: CatmullRomCurve3; speed: number; strength: number }> = [];
				for (const [edgeIndex, edge] of nextModel.edges.entries()) {
					const from = nodeMap.get(edge.from);
					const to = nodeMap.get(edge.to);
					if (!from || !to) continue;
					const lift = 0.24 + Math.min(edge.count, 24) * 0.012;
					let curve: CatmullRomCurve3;
					if (edge.from === edge.to) {
						const phase = edgeIndex * 0.86;
						const loopRadius = 0.16 + Math.min(edge.count, 18) * 0.004;
						const loopCenter = from
							.clone()
							.add(
								new THREE.Vector3(
									Math.cos(phase) * 0.16,
									Math.sin(phase) * 0.12 + 0.04,
									0.24 + lift * 0.36,
								),
							);
						const loopPoints = Array.from({ length: 10 }, (_, pointIndex) => {
							const angle = (pointIndex / 10) * Math.PI * 2;
							return loopCenter
								.clone()
								.add(
									new THREE.Vector3(
										Math.cos(angle) * loopRadius,
										Math.sin(angle) * loopRadius * 0.62,
										Math.sin(angle + phase) * 0.036,
									),
								);
						});
						curve = new THREE.CatmullRomCurve3(loopPoints, true, "centripetal");
					} else {
						const mid = from.clone().lerp(to, 0.5);
						mid.z += lift + Math.sin(edge.recentness) * 0.1;
						mid.y += Math.cos(edgeIndex * 0.7) * 0.12;
						curve = new THREE.CatmullRomCurve3([from, mid, to], false, "centripetal");
					}
					const strength = Math.min(edge.count, 28) / 28;
					curves.push({
						curve,
						speed: 0.012 + Math.min(edge.count, 24) * 0.001,
						strength,
					});

					const tube = new THREE.Mesh(
						new THREE.TubeGeometry(
							curve,
							36,
							0.0022 + Math.min(edge.count, 22) * 0.00055,
							6,
							edge.from === edge.to,
						),
						new THREE.MeshBasicMaterial({
							color: new THREE.Color(edge.from === edge.to ? dim : accent),
							transparent: true,
							opacity: 0.2 + Math.min(edge.count, 20) * 0.015,
							depthWrite: false,
						}),
					);
					activeGroup.add(tube);
				}

				const wakeBuckets = Array.from({ length: 3 }, () => [] as number[]);
				const wakeNodes = [...nodeMap.values()];
				const wakeEdges = nextModel.edges.slice(0, 14);
				for (const [edgeIndex, edge] of wakeEdges.entries()) {
					const from = nodeMap.get(edge.from);
					const to = nodeMap.get(edge.to);
					if (!from || !to || wakeNodes.length < 3) continue;
					const endpoints = edge.from === edge.to ? [from] : [from, to];
					for (const [endpointIndex, endpoint] of endpoints.entries()) {
						for (let hop = 0; hop < 3; hop += 1) {
							const targetIndex = (edgeIndex * 5 + endpointIndex * 7 + hop * 3) % wakeNodes.length;
							const target = wakeNodes[targetIndex];
							if (!target || target.distanceTo(endpoint) < 0.08) continue;
							const bucket = wakeBuckets[(edgeIndex + hop) % wakeBuckets.length];
							bucket.push(endpoint.x, endpoint.y, endpoint.z, target.x, target.y, target.z);
						}
					}
				}
				for (const [bucketIndex, positions] of wakeBuckets.entries()) {
					if (positions.length === 0) continue;
					const geometry = new THREE.BufferGeometry();
					geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
					const material = new THREE.LineBasicMaterial({
						color: new THREE.Color(accent),
						transparent: true,
						opacity: 0.035 + bucketIndex * 0.01,
						depthWrite: false,
					});
					wakeMaterials.push(material);
					wakeGroup.add(new THREE.LineSegments(geometry, material));
				}

				const particleMaterial = new THREE.MeshBasicMaterial({
					color: new THREE.Color(accent),
					transparent: true,
					opacity: 0.82,
				});
				const particleCount =
					curves.length === 0 ? 0 : Math.min(Math.max(curves.length * 2, 18), 96);
				particles = Array.from({ length: particleCount }, (_, index) => {
					const entry = curves[index % curves.length];
					const particle = new THREE.Mesh(
						new THREE.SphereGeometry(0.012 + entry.strength * 0.01, 12, 8),
						particleMaterial,
					);
					particleGroup.add(particle);
					return {
						curve: entry.curve,
						particle,
						offset: index / Math.max(particleCount, 1),
						speed: entry.speed,
					};
				});

				if (reduceMotion) renderer.render(scene, camera);
			};

			const resize = () => {
				const parent = activeCanvas.parentElement;
				if (!parent) return;
				const { width, height } = parent.getBoundingClientRect();
				renderer.setSize(Math.max(width, 1), Math.max(height, 1), false);
				camera.aspect = Math.max(width, 1) / Math.max(height, 1);
				const compactPane = width < 520;
				camera.position.z = compactPane ? 6.25 : 5.15;
				group.scale.setScalar(compactPane ? 0.82 : 1);
				camera.updateProjectionMatrix();
			};
			const observer = new ResizeObserver(resize);
			if (activeCanvas.parentElement) observer.observe(activeCanvas.parentElement);
			resize();

			updateSceneRef.current = updateGraph;
			updateGraph(modelRef.current);

			let frame = 0;
			let animationFrame = 0;
			const animate = () => {
				if (disposed) return;
				frame += 1;
				const t = frame / 60;
				const workPulse = 1 + Math.min(modelRef.current.activeWork, 8) * 0.04;
				group.rotation.y = reduceMotion ? -0.34 : Math.sin(t * 0.07) * 0.2 - 0.34;
				group.rotation.x = reduceMotion ? 0.18 : Math.sin(t * 0.06) * 0.06 + 0.18;
				core.scale.setScalar(reduceMotion ? 1 : 1 + Math.sin(t * 1.25) * 0.03 * workPulse);
				ring.rotation.z = reduceMotion ? 0 : t * 0.18;
				scaffoldGroup.rotation.z = reduceMotion ? 0 : Math.sin(t * 0.045) * 0.025;
				activeGroup.rotation.z = reduceMotion ? 0 : Math.cos(t * 0.055) * 0.02;
				wakeGroup.rotation.z = reduceMotion ? 0 : Math.sin(t * 0.06) * 0.018;
				dimensionGroup.rotation.y = reduceMotion ? 0 : Math.sin(t * 0.04) * 0.045;
				dimensionGroup.rotation.z = reduceMotion ? 0 : Math.cos(t * 0.05) * 0.02;

				for (const [index, material] of scaffoldMaterials.entries()) {
					material.opacity = reduceMotion
						? 0.062
						: 0.04 + (Math.sin(t * 0.38 + index * 1.35) + 1) * 0.026;
				}
				for (const [index, material] of wakeMaterials.entries()) {
					const workLift = Math.min(modelRef.current.activeWork, 8) * 0.004;
					material.opacity = reduceMotion
						? 0.035 + workLift
						: 0.025 + (Math.sin(t * 0.72 + index * 2.1) + 1) * 0.026 + workLift;
				}

				for (const { curve, particle, offset, speed } of particles) {
					const progress = reduceMotion ? offset : (offset + t * speed) % 1;
					particle.position.copy(curve.getPointAt(progress));
					particle.scale.setScalar(0.72 + Math.sin((progress + t) * Math.PI * 2) * 0.18);
				}

				renderer.render(scene, camera);
				if (!reduceMotion) animationFrame = requestAnimationFrame(animate);
			};
			animate();

			cleanup = () => {
				updateSceneRef.current = null;
				if (animationFrame) cancelAnimationFrame(animationFrame);
				observer.disconnect();
				disposeTree(scene);
				renderer.dispose();
			};
		}

		mountScene();

		return () => {
			disposed = true;
			cleanup?.();
		};
	}, []);

	const hasMemory = model.nodes.length > 0;
	const liveLabel = activeWork > 0 ? "active" : "idle";

	return (
		<section
			className="relative min-h-[320px] overflow-hidden rounded-xl"
			style={{
				background:
					"radial-gradient(circle at 50% 42%, var(--accent-subtle), transparent 42%), var(--bg-2)",
				border: "1px solid var(--border)",
			}}
			aria-label="Memory pulse"
			data-testid="memory-pulse-pane"
		>
			<div className="absolute left-5 right-5 top-5 z-10 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex items-center gap-2">
					<div
						className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
						style={{
							background: "var(--accent-dim)",
							border: "1px solid var(--accent-border)",
							color: "var(--accent-text)",
						}}
					>
						<Radio className="h-4 w-4" strokeWidth={1.8} />
					</div>
					<div className="min-w-0">
						<SectionHeading className="mb-0 leading-none">Memory Pulse</SectionHeading>
						<Caption as="p" className="mt-1">
							{hasMemory ? "Observer field" : isLoading ? "Warming field" : "Quiet field"}
						</Caption>
					</div>
				</div>

				<div className="hidden items-center gap-2 self-end sm:flex sm:self-auto">
					<PulseChip label="peers" value={model.nodes.length} />
					<PulseChip label="sessions" value={model.totalSessions} />
					<PulseChip label="hooks" value={model.totalWebhooks} />
					<PulseChip label={liveLabel} value={activeWork} accent={activeWork > 0} />
				</div>
			</div>

			<div className="absolute inset-x-5 bottom-5 z-10 flex items-end justify-between gap-4">
				<div>
					<MonoCaption>{mask(workspaceId)}</MonoCaption>
					<Caption as="p" className="mt-1 max-w-[34rem]">
						{model.totalConclusions.toLocaleString()} conclusions;{" "}
						{model.scaffoldEdges.length.toLocaleString()} peer links;{" "}
						{model.totalSessions.toLocaleString()} session threads.
					</Caption>
				</div>
				<div className="hidden items-center gap-2 sm:flex">
					<Activity className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} strokeWidth={1.8} />
					<MonoCaption>
						{model.edges.length}/{model.scaffoldEdges.length} links ·{" "}
						{model.totalWork.toLocaleString()} work
					</MonoCaption>
				</div>
			</div>

			<div className="absolute inset-0" aria-hidden="true">
				<canvas ref={canvasRef} className="h-full w-full" />
			</div>
		</section>
	);
}

function PulseChip({
	label,
	value,
	accent = false,
}: {
	label: string;
	value: number;
	accent?: boolean;
}) {
	return (
		<div
			className="rounded-lg px-2.5 py-1.5 text-right"
			style={{
				background: accent ? "var(--accent-dim)" : "rgba(255,255,255,0.38)",
				border: `1px solid ${accent ? "var(--accent-border)" : "var(--border)"}`,
				backdropFilter: "blur(12px)",
			}}
		>
			<div className="font-mono text-sm leading-none" style={{ color: "var(--text-1)" }}>
				{value.toLocaleString()}
			</div>
			<div className="mt-1 text-[10px] uppercase leading-none" style={{ color: "var(--text-3)" }}>
				{label}
			</div>
		</div>
	);
}
