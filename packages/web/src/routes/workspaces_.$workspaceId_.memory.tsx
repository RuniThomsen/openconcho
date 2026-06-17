import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Radio } from "lucide-react";
import { useQueueStatus } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Caption, MonoCaption } from "@/components/ui/typography";
import { MemoryPulsePane } from "@/components/workspaces/MemoryPulsePane";
import { useDemo } from "@/hooks/useDemo";

export const Route = createFileRoute("/workspaces_/$workspaceId_/memory")({
	component: WorkspaceMemoryPage,
});

function WorkspaceMemoryPage() {
	const { mask } = useDemo();
	const { workspaceId } = useParams({ strict: false }) as { workspaceId: string };
	const { data: queue } = useQueueStatus(workspaceId);
	const activeWork = (queue?.pending_work_units ?? 0) + (queue?.in_progress_work_units ?? 0);

	return (
		<div
			className="fixed inset-0 z-50 overflow-hidden"
			style={{
				background: "var(--bg-2)",
				color: "var(--text-1)",
			}}
			data-testid="memory-fullscreen-page"
		>
			<MemoryPulsePane variant="fullscreen" workspaceId={workspaceId} queue={queue} />

			<div className="absolute left-6 top-24 z-20 hidden max-w-[18rem] sm:left-8 sm:block">
				<div
					className="rounded-lg p-3"
					style={{
						background: "rgba(255,255,255,0.42)",
						border: "1px solid var(--border)",
						backdropFilter: "blur(16px)",
					}}
				>
					<div className="flex items-center gap-2">
						<Radio className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} strokeWidth={1.8} />
						<MonoCaption>{mask(workspaceId)}</MonoCaption>
					</div>
					<Caption as="p" className="mt-2">
						{activeWork > 0
							? `${activeWork.toLocaleString()} impulses currently moving through the field.`
							: "The field is idle, but the memory graph keeps breathing."}
					</Caption>
				</div>
			</div>

			<Button
				asChild
				variant="surface"
				size="sm"
				className="absolute right-6 top-6 z-20 sm:right-8 sm:top-8"
			>
				<Link to={"/workspaces/$workspaceId" as never} params={{ workspaceId } as never}>
					<ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
					Exit
				</Link>
			</Button>
		</div>
	);
}
