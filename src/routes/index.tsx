import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Database, MessageCircle } from "lucide-react";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/")({
	component: Landing,
});

function Landing() {
	const businesses = useQuery(orpc.businesses.list.queryOptions());
	const notReady = businesses.isError || businesses.data?.length === 0;

	return (
		<div className="orbyte flex min-h-dvh flex-col items-center justify-center p-6">
			<div className="w-full max-w-3xl">
				<p className="text-sm font-medium text-primary">Quora Chat · demo</p>
				<h1 className="mt-1 text-3xl font-semibold tracking-tight">
					AI quotations from WhatsApp, inside Orbyte
				</h1>
				<p className="mt-2 text-muted-foreground">
					Open both sides in separate tabs, side by side. Customers message on
					WhatsApp, and staff review and approve in Orbyte.
				</p>

				{notReady ? (
					<SetupNotice
						error={
							businesses.error?.message ?? "The database has no businesses yet."
						}
					/>
				) : (
					<div className="mt-8 grid gap-4 sm:grid-cols-2">
						<a
							href="/whatsapp"
							target="_blank"
							rel="noreferrer"
							className="group rounded-2xl bg-[#161717] p-6 text-white"
						>
							<span className="flex size-11 items-center justify-center rounded-full bg-[#21c063] text-black">
								<MessageCircle className="size-6" />
							</span>
							<p className="mt-4 text-lg font-semibold">WhatsApp portal</p>
							<p className="mt-1 text-sm text-white/60">
								You are the customer. Ask a business for a quote and sign it.
							</p>
							<p className="mt-4 flex items-center gap-1 text-sm text-[#21c063]">
								/whatsapp{" "}
								<ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
							</p>
						</a>
						<a
							href="/orbyte"
							target="_blank"
							rel="noreferrer"
							className="group rounded-2xl p-6 text-white"
							style={{ background: "var(--orb-gradient)" }}
						>
							<span className="flex size-11 items-center justify-center rounded-xl bg-white">
								<img src="/orbyte-icon.png" alt="" className="size-7" />
							</span>
							<p className="mt-4 text-lg font-semibold">Orbyte workspace</p>
							<p className="mt-1 text-sm text-white/75">
								You are the business. Watch chats, take over, approve quotes.
							</p>
							<p className="mt-4 flex items-center gap-1 text-sm">
								/orbyte{" "}
								<ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
							</p>
						</a>
					</div>
				)}
				<p className="mt-8 text-xs text-muted-foreground">
					All businesses, people and prices are synthetic.
				</p>
			</div>
		</div>
	);
}

function SetupNotice({ error }: { error: string }) {
	return (
		<div className="mt-8 rounded-xl border bg-card p-6">
			<Database className="mb-3 size-6 text-primary" />
			<h2 className="font-semibold">Database not ready</h2>
			<p className="mt-1 text-sm text-muted-foreground">{error}</p>
			<ol className="mt-4 list-decimal space-y-1 pl-5 text-sm">
				<li>
					Copy <code>.env.example</code> to <code>.env</code> and set{" "}
					<code>DATABASE_URL</code>.
				</li>
				<li>
					Run <code>pnpm db:push</code> to create tables.
				</li>
				<li>
					Run <code>pnpm db:seed</code> to load the demo businesses.
				</li>
			</ol>
		</div>
	);
}
