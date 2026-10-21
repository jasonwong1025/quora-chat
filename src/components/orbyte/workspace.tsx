import { createContext, useContext, useEffect, useState } from "react";
import type { BusinessDetail, Staff } from "#/lib/types";

type Workspace = {
	business: BusinessDetail;
	/** The signed-in Orbyte user (demo: pick any staff member). */
	me: Staff | undefined;
	setMe: (staffId: string) => void;
};

const Ctx = createContext<Workspace | null>(null);

export function WorkspaceProvider(props: {
	business: BusinessDetail;
	children: React.ReactNode;
}) {
	const { business } = props;
	const key = `qc.orbyte.me.${business.id}`;
	const fallback =
		business.staff.find((s) => s.canApprove) ?? business.staff[0];
	const [meId, setMeId] = useState<string | undefined>(fallback?.id);

	useEffect(() => {
		try {
			const saved = localStorage.getItem(key);
			setMeId(
				saved && business.staff.some((s) => s.id === saved)
					? saved
					: fallback?.id,
			);
		} catch {
			setMeId(fallback?.id);
		}
	}, [key, business.staff, fallback?.id]);

	const value: Workspace = {
		business,
		me: business.staff.find((s) => s.id === meId),
		setMe: (id) => {
			setMeId(id);
			try {
				localStorage.setItem(key, id);
			} catch {
				// Not critical for the demo.
			}
		},
	};
	return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useWorkspace() {
	const ctx = useContext(Ctx);
	if (!ctx)
		throw new Error("useWorkspace must be used inside the Orbyte layout");
	return ctx;
}

/** Standard page header for Orbyte module pages. */
export function PageHeader(props: {
	title: string;
	description?: string;
	badge?: string;
	actions?: React.ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-end justify-between gap-3 pb-5">
			<div>
				<h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
					{props.title}
					{props.badge && (
						<span
							className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase"
							style={{ background: "var(--orb-gradient)" }}
						>
							{props.badge}
						</span>
					)}
				</h1>
				{props.description && (
					<p className="mt-1 text-sm text-muted-foreground">
						{props.description}
					</p>
				)}
			</div>
			{props.actions && <div className="flex gap-2">{props.actions}</div>}
		</div>
	);
}
