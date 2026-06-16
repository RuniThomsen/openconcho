import { Activity, Radio } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { CatmullRomCurve3, Mesh, Object3D, Vector3 } from "three";
import { useConclusions, usePeers } from "@/api/queries";
import type { components } from "@/api/schema";
import { Caption, MonoCaption, SectionHeading } from "@/components/ui/typography";
import { useDemo } from "@/hooks/useDemo";

type Conclusion = components["schemas"]["Conclusion"];
type ConclusionPage = components["schemas"]["Page_Conclusion_"];
type PeerPage = components["schemas"]["Page_Peer_"];

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

export interface MemoryPulseModel {
	nodes: PulseNode[];
	edges: PulseEdge[];
	scaffoldEdges: ScaffoldEdge[];
	totalConclusions: number;
	sampledConclusions: number;
	activeWork: number;
}

export function buildMemoryPulseModel({
	peerIds,
	conclusions,
	totalConclusions,
	activeWork = 0,
	maxNodes = 24,
}: {
	peerIds: string[];
	conclusions: Conclusion[];
	totalConclusions: number;
	activeWork?: number;
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

	return {
		nodes,
		edges,
		scaffoldEdges,
		totalConclusions,
		sampledConclusions: conclusions.length,
		activeWork,
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
	const { data: conclusionData, isLoading } = useConclusions(
		workspaceId,
		{},
		1,
		100,
		false,
		activeWork > 0 ? 2500 : 6500,
	);
	const conclusionPage = conclusionData as ConclusionPage | undefined;
	const conclusions = conclusionPage?.items ?? [];

	const model = useMemo(
		() =>
			buildMemoryPulseModel({
				peerIds: peerPage?.items.map((peer) => peer.id) ?? [],
				conclusions,
				totalConclusions: conclusionPage?.total ?? conclusions.length,
				activeWork,
			}),
		[activeWork, conclusionPage?.total, conclusions, peerPage?.items],
	);

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
			const scaffoldGroup = new THREE.Group();
			group.add(scaffoldGroup);
			const activeGroup = new THREE.Group();
			group.add(activeGroup);
			const particleGroup = new THREE.Group();
			group.add(particleGroup);

			const ambient = new THREE.AmbientLight(new THREE.Color(bg), 2.1);
			scene.add(ambient);
			const key = new THREE.PointLight(new THREE.Color(accent), 3.2, 9);
			key.position.set(1.7, 2.1, 2.5);
			scene.add(key);

			const nodeMap = new Map<string, Vector3>();
			const nodeTotal = Math.max(model.nodes.length, 1);
			const goldenAngle = Math.PI * (3 - Math.sqrt(5));
			model.nodes.forEach((node, index) => {
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
				group.add(orb);

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
				group.add(halo);
			});

			const scaffoldPositions: number[] = [];
			for (const edge of model.scaffoldEdges) {
				const from = nodeMap.get(edge.from);
				const to = nodeMap.get(edge.to);
				if (!from || !to) continue;
				scaffoldPositions.push(from.x, from.y, from.z, to.x, to.y, to.z);
			}
			if (scaffoldPositions.length > 0) {
				const geometry = new THREE.BufferGeometry();
				geometry.setAttribute("position", new THREE.Float32BufferAttribute(scaffoldPositions, 3));
				const scaffold = new THREE.LineSegments(
					geometry,
					new THREE.LineBasicMaterial({
						color: new THREE.Color(dim),
						transparent: true,
						opacity: 0.078,
						depthWrite: false,
					}),
				);
				scaffoldGroup.add(scaffold);
			}

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

			const curves: Array<{ curve: CatmullRomCurve3; speed: number; strength: number }> = [];
			for (const [edgeIndex, edge] of model.edges.entries()) {
				const from = nodeMap.get(edge.from);
				const to = nodeMap.get(edge.to);
				if (!from || !to) continue;
				const lift = 0.24 + Math.min(edge.count, 24) * 0.012;
				const mid =
					edge.from === edge.to
						? from
								.clone()
								.add(
									new THREE.Vector3(Math.cos(edgeIndex) * 0.34, Math.sin(edgeIndex) * 0.18, 0.46),
								)
						: from.clone().lerp(to, 0.5);
				mid.z += lift + Math.sin(edge.recentness) * 0.1;
				mid.y += Math.cos(edgeIndex * 0.7) * 0.12;
				const curve = new THREE.CatmullRomCurve3([from, mid, to], false, "centripetal");
				const strength = Math.min(edge.count, 28) / 28;
				curves.push({
					curve,
					speed: 0.024 + Math.min(edge.count, 24) * 0.0018,
					strength,
				});

				const tube = new THREE.Mesh(
					new THREE.TubeGeometry(curve, 36, 0.0022 + Math.min(edge.count, 22) * 0.00055, 6, false),
					new THREE.MeshBasicMaterial({
						color: new THREE.Color(edge.from === edge.to ? dim : accent),
						transparent: true,
						opacity: 0.2 + Math.min(edge.count, 20) * 0.015,
						depthWrite: false,
					}),
				);
				activeGroup.add(tube);
			}

			const particleMaterial = new THREE.MeshBasicMaterial({
				color: new THREE.Color(accent),
				transparent: true,
				opacity: 0.82,
			});
			const particleCount = curves.length === 0 ? 0 : Math.min(Math.max(curves.length * 2, 18), 96);
			const particles = Array.from({ length: particleCount }, (_, index) => {
				const entry = curves[index % curves.length];
				const particle = new THREE.Mesh(
					new THREE.SphereGeometry(0.012 + entry.strength * 0.01, 12, 8),
					particleMaterial,
				);
				particleGroup.add(particle);
				return {
					...entry,
					particle,
					offset: index / Math.max(particleCount, 1),
				};
			});

			const resize = () => {
				const parent = activeCanvas.parentElement;
				if (!parent) return;
				const { width, height } = parent.getBoundingClientRect();
				renderer.setSize(Math.max(width, 1), Math.max(height, 1), false);
				camera.aspect = Math.max(width, 1) / Math.max(height, 1);
				camera.updateProjectionMatrix();
			};
			const observer = new ResizeObserver(resize);
			if (activeCanvas.parentElement) observer.observe(activeCanvas.parentElement);
			resize();

			let frame = 0;
			const animate = () => {
				if (disposed) return;
				frame += 1;
				const t = frame / 60;
				const workPulse = 1 + Math.min(model.activeWork, 8) * 0.04;
				group.rotation.y = reduceMotion ? -0.34 : Math.sin(t * 0.16) * 0.24 - 0.34;
				group.rotation.x = reduceMotion ? 0.18 : Math.sin(t * 0.13) * 0.08 + 0.18;
				core.scale.setScalar(reduceMotion ? 1 : 1 + Math.sin(t * 2.4) * 0.035 * workPulse);
				ring.rotation.z = reduceMotion ? 0 : t * 0.42;
				scaffoldGroup.rotation.z = reduceMotion ? 0 : Math.sin(t * 0.1) * 0.03;
				activeGroup.rotation.z = reduceMotion ? 0 : Math.cos(t * 0.12) * 0.025;

				for (const { curve, particle, offset, speed } of particles) {
					const progress = reduceMotion ? offset : (offset + t * speed) % 1;
					particle.position.copy(curve.getPointAt(progress));
					particle.scale.setScalar(0.72 + Math.sin((progress + t) * Math.PI * 2) * 0.18);
				}

				renderer.render(scene, camera);
				if (!reduceMotion) requestAnimationFrame(animate);
			};
			animate();

			cleanup = () => {
				observer.disconnect();
				scene.traverse((object: Object3D) => {
					const mesh = object as Mesh;
					mesh.geometry?.dispose();
					const material = mesh.material;
					if (Array.isArray(material)) {
						for (const item of material) item.dispose();
					} else {
						material?.dispose();
					}
				});
				renderer.dispose();
			};
		}

		mountScene();

		return () => {
			disposed = true;
			cleanup?.();
		};
	}, [model]);

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
					<PulseChip label="sample" value={model.sampledConclusions} />
					<PulseChip label={liveLabel} value={activeWork} accent={activeWork > 0} />
				</div>
			</div>

			<div className="absolute inset-x-5 bottom-5 z-10 flex items-end justify-between gap-4">
				<div>
					<MonoCaption>{mask(workspaceId)}</MonoCaption>
					<Caption as="p" className="mt-1 max-w-[34rem]">
						{model.totalConclusions.toLocaleString()} conclusions;{" "}
						{model.scaffoldEdges.length.toLocaleString()} possible peer links.
					</Caption>
				</div>
				<div className="hidden items-center gap-2 sm:flex">
					<Activity className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} strokeWidth={1.8} />
					<MonoCaption>
						{model.edges.length}/{model.scaffoldEdges.length} links
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
