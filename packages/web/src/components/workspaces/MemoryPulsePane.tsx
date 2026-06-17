import { Link } from "@tanstack/react-router";
import { Activity, Maximize2, Radio } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type {
	CatmullRomCurve3,
	LineBasicMaterial,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Object3D,
	PointsMaterial,
	Sprite,
	SpriteMaterial,
	Vector3,
} from "three";
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

interface PulseSessionAnchor {
	active: boolean;
	id: string;
	index: number;
}

interface PulseConclusionTrace {
	from: string;
	id: string;
	recentness: number;
	sessionId: string | null;
	to: string;
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
	sessionAnchors: PulseSessionAnchor[];
	conclusionTraces: PulseConclusionTrace[];
	dimensions: PulseDimension[];
	totalConclusions: number;
	sampledConclusions: number;
	totalSessions: number;
	activeSessions: number;
	totalWebhooks: number;
	activeWork: number;
	totalWork: number;
}

const getMemoryFieldCounts = (
	model: Pick<MemoryPulseModel, "totalConclusions" | "totalSessions" | "totalWork">,
) => {
	const magnitude = model.totalConclusions + model.totalSessions * 25 + model.totalWork * 5;
	const fieldNodes = Math.min(
		2400,
		Math.max(360, Math.floor(Math.sqrt(Math.max(magnitude, 1)) * 2.1)),
	);
	const fieldLinks = Math.min(3600, Math.max(600, Math.floor(fieldNodes * 1.45)));
	return { fieldLinks, fieldNodes };
};

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
	sessions?: Array<{ id?: string; is_active?: boolean | null }>;
	totalConclusions: number;
	totalSessions?: number;
	totalWebhooks?: number;
	activeWork?: number;
	totalWork?: number;
	maxNodes?: number;
}): MemoryPulseModel {
	const nodeCounts = new Map<string, number>();
	const edgeCounts = new Map<string, PulseEdge>();
	const conclusionTraces: PulseConclusionTrace[] = [];

	for (const id of peerIds) {
		if (id) nodeCounts.set(id, nodeCounts.get(id) ?? 0);
	}

	conclusions.forEach((conclusion, index) => {
		const from = conclusion.observer_id;
		const to = conclusion.observed_id;
		if (!from || !to) return;
		const recentness = conclusions.length - index;

		nodeCounts.set(from, (nodeCounts.get(from) ?? 0) + 1);
		nodeCounts.set(to, (nodeCounts.get(to) ?? 0) + 1);
		conclusionTraces.push({
			from,
			id: conclusion.id,
			recentness,
			sessionId: conclusion.session_id ?? null,
			to,
		});

		const key = `${from}→${to}`;
		const current = edgeCounts.get(key);
		edgeCounts.set(key, {
			key,
			from,
			to,
			count: (current?.count ?? 0) + 1,
			recentness: Math.max(current?.recentness ?? 0, recentness),
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
	const sessionAnchors = sessions.slice(0, 48).map((session, index) => ({
		active: Boolean(session.is_active),
		id: session.id ?? `session-${index}`,
		index,
	}));
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
		sessionAnchors,
		conclusionTraces,
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
	variant = "pane",
	workspaceId,
	queue,
}: {
	variant?: "fullscreen" | "pane";
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
			const peerBronze = rootStyle.getPropertyValue("--peer-bronze").trim() || "#b8783f";
			const peerBronzeGlow = rootStyle.getPropertyValue("--peer-bronze-glow").trim() || "#f0b36d";
			const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

			const scene = new THREE.Scene();
			const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
			camera.position.set(0, 0.18, 3.55);
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
			const memoryMassGroup = new THREE.Group();
			group.add(memoryMassGroup);
			const nodeGroup = new THREE.Group();
			group.add(nodeGroup);
			const cortexGroup = new THREE.Group();
			group.add(cortexGroup);
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

			const starCanvas = document.createElement("canvas");
			starCanvas.width = 128;
			starCanvas.height = 128;
			const starContext = starCanvas.getContext("2d");
			if (starContext) {
				const center = 64;
				const glow = starContext.createRadialGradient(center, center, 0, center, center, 58);
				glow.addColorStop(0, "rgba(255,255,245,1)");
				glow.addColorStop(0.18, "rgba(255,226,178,0.92)");
				glow.addColorStop(0.45, "rgba(240,179,109,0.42)");
				glow.addColorStop(1, "rgba(240,179,109,0)");
				starContext.fillStyle = glow;
				starContext.fillRect(0, 0, 128, 128);
				starContext.strokeStyle = "rgba(255,244,216,0.92)";
				starContext.lineWidth = 1.35;
				starContext.beginPath();
				starContext.moveTo(13, center);
				starContext.lineTo(115, center);
				starContext.moveTo(center, 13);
				starContext.lineTo(center, 115);
				starContext.stroke();
				starContext.strokeStyle = "rgba(240,179,109,0.44)";
				starContext.lineWidth = 1;
				starContext.beginPath();
				starContext.moveTo(29, 29);
				starContext.lineTo(99, 99);
				starContext.moveTo(99, 29);
				starContext.lineTo(29, 99);
				starContext.stroke();
			}
			const peerStarTexture = new THREE.CanvasTexture(starCanvas);

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

			const signalRings = Array.from({ length: 3 }, (_, index) => {
				const material = new THREE.MeshBasicMaterial({
					color: new THREE.Color(accent),
					transparent: true,
					opacity: 0.045,
					depthWrite: false,
				});
				const signal = new THREE.Mesh(
					new THREE.TorusGeometry(0.58 + index * 0.2, 0.0032, 8, 112),
					material,
				);
				signal.rotation.x = Math.PI / 2.12 + index * 0.08;
				signal.rotation.y = index * 0.32;
				group.add(signal);
				return { material, signal, phase: index * 1.85 };
			});

			let graphSignature = "";
			let dataBurst = 0;
			let particles: Array<{
				curve: CatmullRomCurve3;
				particle: Mesh;
				offset: number;
				speed: number;
			}> = [];
			let nodePulses: Array<{
				halo: Mesh;
				haloMaterial: MeshBasicMaterial;
				intensity: number;
				node: Mesh;
				nodeMaterial: MeshStandardMaterial;
				phase: number;
				star: Sprite;
				starBaseScale: number;
				starMaterial: SpriteMaterial;
			}> = [];
			let dimensionPulses: Array<{
				intensity: number;
				marker: Mesh;
				material: MeshBasicMaterial;
				phase: number;
			}> = [];
			let sessionPulses: Array<{
				active: boolean;
				marker: Mesh;
				material: MeshBasicMaterial;
				phase: number;
			}> = [];
			let activeMaterials: Array<{
				baseOpacity: number;
				material: MeshBasicMaterial;
				phase: number;
				strength: number;
			}> = [];
			let memoryMassPointMaterial: PointsMaterial | null = null;
			let memoryMassLinkMaterials: LineBasicMaterial[] = [];
			let cortexMaterials: Array<{
				material: LineBasicMaterial;
				phase: number;
				strength: number;
			}> = [];
			let scaffoldMaterials: LineBasicMaterial[] = [];
			let wakeMaterials: LineBasicMaterial[] = [];
			let particleMaterial: MeshBasicMaterial | null = null;

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
					sessions: nextModel.sessionAnchors.map((session) => [session.id, session.active]),
					traces: nextModel.conclusionTraces.map((trace) => [
						trace.id,
						trace.from,
						trace.to,
						trace.sessionId,
					]),
					dimensions: nextModel.dimensions.map((dimension) => [
						dimension.key,
						dimension.value,
						Number(dimension.intensity.toFixed(3)),
					]),
					totals: [nextModel.totalConclusions, nextModel.totalSessions, nextModel.totalWork],
				});

			const updateGraph = (nextModel: MemoryPulseModel) => {
				const nextSignature = getGraphSignature(nextModel);
				if (nextSignature === graphSignature) return;
				graphSignature = nextSignature;
				dataBurst = 1;
				particles = [];
				nodePulses = [];
				dimensionPulses = [];
				sessionPulses = [];
				activeMaterials = [];
				memoryMassPointMaterial = null;
				memoryMassLinkMaterials = [];
				cortexMaterials = [];
				scaffoldMaterials = [];
				wakeMaterials = [];
				particleMaterial = null;
				clearGraphGroup(memoryMassGroup);
				clearGraphGroup(nodeGroup);
				clearGraphGroup(cortexGroup);
				clearGraphGroup(scaffoldGroup);
				clearGraphGroup(activeGroup);
				clearGraphGroup(wakeGroup);
				clearGraphGroup(particleGroup);
				clearGraphGroup(dimensionGroup);

				const nodeMap = new Map<string, Vector3>();
				const nodeTotal = Math.max(nextModel.nodes.length, 1);
				const goldenAngle = Math.PI * (3 - Math.sqrt(5));
				nextModel.nodes.forEach((node, index) => {
					const hemisphere = index % 2 === 0 ? -1 : 1;
					const hemisphereIndex = Math.floor(index / 2);
					const hemisphereTotal = Math.max(Math.ceil(nodeTotal / 2), 1);
					const progress = hemisphereTotal === 1 ? 0.5 : hemisphereIndex / (hemisphereTotal - 1);
					const foldAngle = progress * Math.PI * 1.16 - Math.PI * 0.58;
					const ripple = Math.sin(index * 1.73) * 0.13;
					const position = new THREE.Vector3(
						hemisphere * (0.28 + Math.cos(foldAngle) * 0.78 + ripple * 0.25),
						Math.sin(foldAngle) * 0.78 + Math.sin(index * 0.91) * 0.08,
						Math.sin(index * goldenAngle) * 0.42 + Math.cos(foldAngle * 2.1) * 0.12,
					);
					nodeMap.set(node.id, position);

					const size = 0.032 + Math.min(node.count, 42) * 0.0016;
					const intensity = Math.min(node.count / 60, 1);
					const nodeMaterial = new THREE.MeshStandardMaterial({
						color: new THREE.Color(peerBronze).lerp(new THREE.Color("#fff0cb"), 0.18),
						emissive: new THREE.Color(peerBronzeGlow),
						emissiveIntensity: 0.28 + intensity * 0.7,
						roughness: 0.22,
						metalness: 0.55,
					});
					const orb = new THREE.Mesh(new THREE.SphereGeometry(size, 24, 16), nodeMaterial);
					orb.position.copy(position);
					nodeGroup.add(orb);
					if (index < 8) {
						const anchorRing = new THREE.Mesh(
							new THREE.TorusGeometry(size * 2.55, 0.0024, 6, 36),
							new THREE.MeshBasicMaterial({
								color: new THREE.Color(peerBronzeGlow),
								transparent: true,
								opacity: 0.24 + intensity * 0.2,
								depthWrite: false,
								blending: THREE.AdditiveBlending,
							}),
						);
						anchorRing.position.copy(position);
						anchorRing.rotation.x = Math.PI / 2.2;
						anchorRing.rotation.y = index * 0.47;
						nodeGroup.add(anchorRing);
					}

					const haloMaterial = new THREE.MeshBasicMaterial({
						color: new THREE.Color(peerBronzeGlow),
						transparent: true,
						opacity: 0.075 + Math.min(node.count, 50) / 640,
						depthWrite: false,
						blending: THREE.AdditiveBlending,
					});
					const halo = new THREE.Mesh(new THREE.SphereGeometry(size * 3.1, 24, 16), haloMaterial);
					halo.position.copy(position);
					nodeGroup.add(halo);
					const starMaterial = new THREE.SpriteMaterial({
						map: peerStarTexture,
						color: new THREE.Color(peerBronzeGlow),
						transparent: true,
						opacity: 0.52 + intensity * 0.28,
						depthWrite: false,
						blending: THREE.AdditiveBlending,
					});
					const star = new THREE.Sprite(starMaterial);
					star.position.copy(position);
					const starBaseScale = size * (4.6 + intensity * 1.9);
					star.scale.setScalar(starBaseScale);
					nodeGroup.add(star);
					nodePulses.push({
						halo,
						haloMaterial,
						intensity,
						node: orb,
						nodeMaterial,
						phase: index * 0.73,
						star,
						starBaseScale,
						starMaterial,
					});
				});

				const { fieldLinks, fieldNodes } = getMemoryFieldCounts(nextModel);
				const memorySeed =
					nextModel.totalConclusions * 0.0001 +
					nextModel.totalSessions * 0.017 +
					nextModel.totalWork * 0.0031 +
					nodeTotal * 7.13;
				const noise = (index: number, salt: number) => {
					const value = Math.sin(index * 12.9898 + salt * 78.233 + memorySeed) * 43758.5453;
					return value - Math.floor(value);
				};
				const massPositions = new Float32Array(fieldNodes * 3);
				for (let index = 0; index < fieldNodes; index += 1) {
					const side = noise(index, 1) > 0.5 ? -1 : 1;
					const fold = noise(index, 2) * Math.PI * 1.18 - Math.PI * 0.59;
					const depth = noise(index, 3) - 0.5;
					const spread = Math.sqrt(noise(index, 4));
					const taper = 0.55 + Math.cos(fold) * 0.35;
					massPositions[index * 3] = side * (0.12 + spread * (0.58 + taper * 0.52));
					massPositions[index * 3 + 1] = Math.sin(fold) * 0.82 + (noise(index, 5) - 0.5) * 0.18;
					massPositions[index * 3 + 2] = depth * (0.55 + taper * 0.22);
				}
				const massGeometry = new THREE.BufferGeometry();
				massGeometry.setAttribute("position", new THREE.BufferAttribute(massPositions, 3));
				memoryMassPointMaterial = new THREE.PointsMaterial({
					color: new THREE.Color(accent),
					transparent: true,
					opacity: 0.18,
					size: 0.008,
					sizeAttenuation: true,
					depthWrite: false,
				});
				memoryMassGroup.add(new THREE.Points(massGeometry, memoryMassPointMaterial));

				const massLinkBuckets = Array.from({ length: 4 }, () => [] as number[]);
				for (let index = 0; index < fieldLinks; index += 1) {
					const fromIndex = Math.floor(noise(index, 6) * fieldNodes);
					const distance = 1 + Math.floor(noise(index, 7) * Math.min(fieldNodes - 1, 96));
					const toIndex = (fromIndex + distance) % fieldNodes;
					const bucket = massLinkBuckets[index % massLinkBuckets.length];
					bucket.push(
						massPositions[fromIndex * 3],
						massPositions[fromIndex * 3 + 1],
						massPositions[fromIndex * 3 + 2],
						massPositions[toIndex * 3],
						massPositions[toIndex * 3 + 1],
						massPositions[toIndex * 3 + 2],
					);
				}
				for (const [bucketIndex, positions] of massLinkBuckets.entries()) {
					if (positions.length === 0) continue;
					const geometry = new THREE.BufferGeometry();
					geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
					const material = new THREE.LineBasicMaterial({
						color: new THREE.Color(bucketIndex % 2 === 0 ? accent : dim),
						transparent: true,
						opacity: 0.014,
						depthWrite: false,
					});
					memoryMassLinkMaterials.push(material);
					memoryMassGroup.add(new THREE.LineSegments(geometry, material));
				}

				const cortexEdges = nextModel.scaffoldEdges.slice(
					0,
					Math.min(nextModel.scaffoldEdges.length, 96),
				);
				for (const [edgeIndex, edge] of cortexEdges.entries()) {
					const from = nodeMap.get(edge.from);
					const to = nodeMap.get(edge.to);
					if (!from || !to) continue;
					const midpoint = from.clone().lerp(to, 0.5);
					midpoint.z += 0.12 + Math.sin(edgeIndex * 0.8) * 0.1;
					midpoint.y += Math.cos(edgeIndex * 0.57) * 0.08;
					const curve = new THREE.CatmullRomCurve3([from, midpoint, to], false, "centripetal");
					const points = curve.getPoints(8);
					const geometry = new THREE.BufferGeometry().setFromPoints(points);
					const material = new THREE.LineBasicMaterial({
						color: new THREE.Color(accent),
						transparent: true,
						opacity: 0.045,
						depthWrite: false,
					});
					cortexMaterials.push({
						material,
						phase: edgeIndex * 0.41,
						strength: 0.35 + (edgeIndex % 7) * 0.08,
					});
					cortexGroup.add(new THREE.Line(geometry, material));
				}

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
						opacity: 0.026 + bucketIndex * 0.004,
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
					const markerMaterial = new THREE.MeshBasicMaterial({
						color: new THREE.Color(dimension.key === "work" ? accent : ink),
						transparent: true,
						opacity: dimension.value > 0 ? 0.62 : 0.22,
						depthWrite: false,
					});
					const marker = new THREE.Mesh(
						new THREE.SphereGeometry(markerSize, 18, 12),
						markerMaterial,
					);
					marker.position.copy(position);
					dimensionGroup.add(marker);
					dimensionPulses.push({
						intensity: dimension.intensity,
						marker,
						material: markerMaterial,
						phase: dimensionPositions.size * 0.9 + dimension.intensity,
					});
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
					nextModel.sessionAnchors.length > 0
						? Math.min(nextModel.sessionAnchors.length, 36)
						: nextModel.totalSessions === 0
							? 0
							: Math.min(Math.max(Math.ceil(nextModel.totalSessions / 160), 10), 34);
				const sampledSessionAnchors = nextModel.sessionAnchors.slice(0, sessionVertexCount);
				const sessionVertices = Array.from({ length: sessionVertexCount }, (_, index) => {
					const sampledSession = sampledSessionAnchors[index];
					const isActive = sampledSession?.active ?? index < nextModel.activeSessions;
					const angle = (index / Math.max(sessionVertexCount, 1)) * Math.PI * 2;
					const position = new THREE.Vector3(
						Math.cos(angle) * 1.98,
						0.78 + Math.sin(angle * 2.0) * 0.14,
						Math.sin(angle) * 0.64 - 0.18,
					);
					const sessionMaterial = new THREE.MeshBasicMaterial({
						color: new THREE.Color(isActive ? accent : dim),
						transparent: true,
						opacity: isActive ? 0.72 : 0.42,
						depthWrite: false,
					});
					const sessionMarker = new THREE.Mesh(
						new THREE.SphereGeometry(isActive ? 0.026 : 0.017, 14, 10),
						sessionMaterial,
					);
					sessionMarker.position.copy(position);
					dimensionGroup.add(sessionMarker);
					sessionPulses.push({
						active: isActive,
						marker: sessionMarker,
						material: sessionMaterial,
						phase: index * 0.52 + (sampledSession?.index ?? index) * 0.07,
					});
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
					const angle = progress * Math.PI * 1.35;
					const position = new THREE.Vector3(
						1.62 + Math.sin(angle) * 0.32,
						progress * 1.02 - 0.52 + Math.sin(angle * 2.0) * 0.06,
						0.46 + Math.cos(angle) * 0.2,
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
				const curveByKey = new Map<
					string,
					{ curve: CatmullRomCurve3; speed: number; strength: number }
				>();
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
					curveByKey.set(edge.key, {
						curve,
						speed: 0.012 + Math.min(edge.count, 24) * 0.001,
						strength,
					});
					const baseOpacity = 0.2 + Math.min(edge.count, 20) * 0.015;
					const activeMaterial = new THREE.MeshBasicMaterial({
						color: new THREE.Color(edge.from === edge.to ? dim : accent),
						transparent: true,
						opacity: baseOpacity,
						depthWrite: false,
					});

					const tube = new THREE.Mesh(
						new THREE.TubeGeometry(
							curve,
							36,
							0.0022 + Math.min(edge.count, 22) * 0.00055,
							6,
							edge.from === edge.to,
						),
						activeMaterial,
					);
					activeMaterials.push({
						baseOpacity,
						material: activeMaterial,
						phase: edgeIndex * 0.62 + edge.recentness * 0.03,
						strength,
					});
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

				const movingParticleMaterial = new THREE.MeshBasicMaterial({
					color: new THREE.Color(accent),
					transparent: true,
					opacity: 0.82,
				});
				particleMaterial = movingParticleMaterial;
				const literalTraceEntries = nextModel.conclusionTraces
					.map((trace) => curveByKey.get(`${trace.from}→${trace.to}`))
					.filter((entry): entry is { curve: CatmullRomCurve3; speed: number; strength: number } =>
						Boolean(entry),
					);
				const particleEntries =
					literalTraceEntries.length > 0
						? literalTraceEntries.slice(0, 120)
						: Array.from(
								{ length: curves.length === 0 ? 0 : Math.min(Math.max(curves.length * 2, 18), 96) },
								(_, index) => curves[index % curves.length],
							);
				particles = particleEntries.map((entry, index) => {
					const particle = new THREE.Mesh(
						new THREE.SphereGeometry(0.012 + entry.strength * 0.01, 12, 8),
						movingParticleMaterial,
					);
					particleGroup.add(particle);
					return {
						curve: entry.curve,
						particle,
						offset: index / Math.max(particleEntries.length, 1),
						speed: literalTraceEntries.length > 0 ? entry.speed * 0.78 : entry.speed,
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
				camera.position.z = compactPane ? 5 : 3.55;
				group.position.x = compactPane ? -0.2 : 0;
				group.scale.setScalar(compactPane ? 0.94 : 1);
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
				const activeWork = Math.min(modelRef.current.activeWork, 64);
				const workPulse = 1 + Math.min(activeWork, 8) * 0.04;
				dataBurst = reduceMotion ? 0 : Math.max(0, dataBurst - 0.012);
				group.rotation.y = reduceMotion ? -0.34 : t * 0.032 - 0.34;
				group.rotation.x = reduceMotion ? 0.18 : Math.sin(t * 0.06) * 0.06 + 0.18;
				core.scale.setScalar(reduceMotion ? 1 : 1 + Math.sin(t * 1.25) * 0.03 * workPulse);
				ring.rotation.z = reduceMotion ? 0 : t * 0.18;
				memoryMassGroup.rotation.y = reduceMotion ? 0 : Math.sin(t * 0.032) * 0.04;
				memoryMassGroup.rotation.z = reduceMotion ? 0 : Math.cos(t * 0.028) * 0.025;
				cortexGroup.rotation.z = reduceMotion ? 0 : Math.sin(t * 0.052) * 0.018;
				cortexGroup.rotation.y = reduceMotion ? 0 : Math.cos(t * 0.04) * 0.028;
				scaffoldGroup.rotation.z = reduceMotion ? 0 : Math.sin(t * 0.045) * 0.018;
				activeGroup.rotation.z = reduceMotion ? 0 : Math.cos(t * 0.055) * 0.02;
				wakeGroup.rotation.z = reduceMotion ? 0 : Math.sin(t * 0.06) * 0.018;
				dimensionGroup.rotation.y = reduceMotion ? 0 : Math.sin(t * 0.04) * 0.045;
				dimensionGroup.rotation.z = reduceMotion ? 0 : Math.cos(t * 0.05) * 0.02;

				for (const [index, entry] of signalRings.entries()) {
					const wave = reduceMotion ? 0 : (Math.sin(t * 0.72 + entry.phase) + 1) / 2;
					const queueLift = activeWork / 64;
					const burstLift = dataBurst * (0.08 - index * 0.018);
					entry.material.opacity = 0.025 + queueLift * 0.04 + wave * 0.035 + burstLift;
					entry.signal.scale.setScalar(reduceMotion ? 1 : 1 + wave * 0.1 + dataBurst * 0.16);
					entry.signal.rotation.z = reduceMotion ? index * 0.2 : t * (0.08 + index * 0.018);
				}
				if (memoryMassPointMaterial) {
					memoryMassPointMaterial.opacity = reduceMotion
						? 0.13
						: 0.11 + Math.sin(t * 0.48) * 0.025 + dataBurst * 0.06 + activeWork / 1800;
				}
				for (const [index, material] of memoryMassLinkMaterials.entries()) {
					material.opacity = reduceMotion
						? 0.01
						: 0.006 + (Math.sin(t * 0.62 + index * 1.6) + 1) * 0.011 + dataBurst * 0.018;
				}

				for (const {
					halo,
					haloMaterial,
					intensity,
					node,
					nodeMaterial,
					phase,
					star,
					starBaseScale,
					starMaterial,
				} of nodePulses) {
					const pulse = reduceMotion ? 0 : (Math.sin(t * 0.9 + phase) + 1) / 2;
					const twinkle = reduceMotion ? 0 : (Math.sin(t * 2.35 + phase * 1.7) + 1) / 2;
					const scale = 1 + pulse * 0.1 * (0.35 + intensity) + dataBurst * 0.08;
					node.scale.setScalar(scale);
					halo.scale.setScalar(1.18 + pulse * 0.52 * (0.35 + intensity) + twinkle * 0.08);
					haloMaterial.opacity =
						0.055 + intensity * 0.105 + pulse * 0.075 + twinkle * 0.035 + dataBurst * 0.04;
					star.scale.setScalar(
						starBaseScale * (1 + pulse * 0.32 + twinkle * 0.22 + dataBurst * 0.18),
					);
					starMaterial.opacity =
						0.44 + intensity * 0.32 + pulse * 0.18 + twinkle * 0.2 + dataBurst * 0.12;
					nodeMaterial.emissiveIntensity = 0.42 + intensity * 0.78 + pulse * 0.28 + twinkle * 0.18;
				}

				for (const [index, material] of scaffoldMaterials.entries()) {
					material.opacity = reduceMotion
						? 0.034
						: 0.018 + (Math.sin(t * 0.38 + index * 1.35) + 1) * 0.018;
				}
				for (const { material, phase, strength } of cortexMaterials) {
					const synapse = reduceMotion ? 0 : (Math.sin(t * 0.95 + phase) + 1) / 2;
					material.opacity = 0.022 + synapse * 0.055 * strength + dataBurst * 0.035;
				}
				for (const { baseOpacity, material, phase, strength } of activeMaterials) {
					const edgePulse = reduceMotion ? 0 : (Math.sin(t * 1.05 + phase) + 1) / 2;
					material.opacity = baseOpacity + edgePulse * 0.1 * (0.3 + strength) + dataBurst * 0.035;
				}
				for (const [index, material] of wakeMaterials.entries()) {
					const workLift = Math.min(modelRef.current.activeWork, 8) * 0.004;
					material.opacity = reduceMotion
						? 0.035 + workLift
						: 0.025 + (Math.sin(t * 0.72 + index * 2.1) + 1) * 0.026 + workLift;
				}
				for (const { intensity, marker, material, phase } of dimensionPulses) {
					const pulse = reduceMotion ? 0 : (Math.sin(t * 0.82 + phase) + 1) / 2;
					marker.scale.setScalar(1 + pulse * 0.16 * (0.4 + intensity));
					material.opacity = 0.22 + intensity * 0.42 + pulse * 0.1;
				}
				for (const { active, marker, material, phase } of sessionPulses) {
					const pulse = reduceMotion ? 0 : (Math.sin(t * 1.1 + phase) + 1) / 2;
					marker.scale.setScalar(1 + pulse * (active ? 0.22 : 0.11) + dataBurst * 0.06);
					material.opacity = active ? 0.58 + pulse * 0.24 : 0.32 + pulse * 0.14;
				}
				if (particleMaterial) {
					particleMaterial.opacity = reduceMotion
						? 0.68
						: 0.68 + Math.sin(t * 1.2) * 0.12 + dataBurst * 0.12;
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
				peerStarTexture.dispose();
				renderer.dispose();
			};
		}

		mountScene();

		return () => {
			disposed = true;
			cleanup?.();
		};
	}, []);

	const isFullscreen = variant === "fullscreen";
	const hasMemory = model.nodes.length > 0;
	const liveLabel = activeWork > 0 ? "active" : "idle";
	const { fieldLinks, fieldNodes } = getMemoryFieldCounts(model);

	return (
		<section
			className={`relative overflow-hidden ${isFullscreen ? "h-screen min-h-[620px]" : "min-h-[320px] rounded-xl"}`}
			style={{
				background:
					"radial-gradient(circle at 50% 42%, var(--accent-subtle), transparent 42%), var(--bg-2)",
				border: isFullscreen ? "0" : "1px solid var(--border)",
			}}
			aria-label="Memory pulse"
			data-testid="memory-pulse-pane"
			data-variant={variant}
		>
			<div
				className={`absolute z-10 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${
					isFullscreen
						? "left-6 right-6 top-6 sm:left-8 sm:right-8 sm:top-8"
						: "left-5 right-5 top-5"
				}`}
			>
				<div className="flex items-center gap-2">
					<div
						className={`flex shrink-0 items-center justify-center rounded-lg ${
							isFullscreen ? "h-10 w-10" : "h-8 w-8"
						}`}
						style={{
							background: "var(--accent-dim)",
							border: "1px solid var(--accent-border)",
							color: "var(--accent-text)",
						}}
					>
						<Radio className={isFullscreen ? "h-5 w-5" : "h-4 w-4"} strokeWidth={1.8} />
					</div>
					<div className="min-w-0">
						<SectionHeading className="mb-0 leading-none">Memory Pulse</SectionHeading>
						<Caption as="p" className="mt-1">
							{hasMemory
								? isFullscreen
									? "Full neural field"
									: "Neural field"
								: isLoading
									? "Warming field"
									: "Quiet field"}
						</Caption>
					</div>
				</div>

				<div className="hidden items-center gap-2 self-end sm:flex sm:self-auto">
					<PulseChip label="nodes" value={model.nodes.length} />
					<PulseChip label="traces" value={model.totalSessions} />
					<PulseChip label="hooks" value={model.totalWebhooks} />
					<PulseChip label={liveLabel} value={activeWork} accent={activeWork > 0} />
					{!isFullscreen && (
						<Link
							to={"/workspaces/$workspaceId/memory" as never}
							params={{ workspaceId } as never}
							className="flex h-[50px] w-[50px] items-center justify-center rounded-lg transition-all hover:scale-[1.03]"
							style={{
								background: "var(--accent-dim)",
								border: "1px solid var(--accent-border)",
								color: "var(--accent-text)",
								backdropFilter: "blur(12px)",
							}}
							aria-label="Open fullscreen memory pulse"
						>
							<Maximize2 className="h-4 w-4" strokeWidth={1.8} />
						</Link>
					)}
				</div>
			</div>

			<div
				className={`absolute z-10 flex items-end justify-between gap-4 ${
					isFullscreen ? "inset-x-6 bottom-6 sm:inset-x-8 sm:bottom-8" : "inset-x-5 bottom-5"
				}`}
			>
				<div>
					<MonoCaption>{mask(workspaceId)}</MonoCaption>
					<Caption as="p" className={`mt-1 ${isFullscreen ? "max-w-[48rem]" : "max-w-[34rem]"}`}>
						{fieldNodes.toLocaleString()} field nodes; {fieldLinks.toLocaleString()} shimmer links;{" "}
						{model.totalConclusions.toLocaleString()} conclusions.
					</Caption>
				</div>
				<div className="hidden items-center gap-2 sm:flex">
					<Activity className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} strokeWidth={1.8} />
					<MonoCaption>
						{model.edges.length}/{model.scaffoldEdges.length} signals ·{" "}
						{model.totalWork.toLocaleString()} impulses
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
