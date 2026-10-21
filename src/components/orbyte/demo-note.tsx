import { Info } from "lucide-react";

/** Marks pages that show sample content without a backend yet. */
export function DemoNote() {
	return (
		<p className="mb-4 flex items-center gap-2 rounded-lg border border-dashed bg-card px-3 py-2 text-xs text-muted-foreground">
			<Info className="size-3.5 shrink-0" />
			Existing Orbyte module, shown with sample data for the demo. Changes here
			are not saved.
		</p>
	);
}
