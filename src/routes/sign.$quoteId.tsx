import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	CheckCircle2,
	Download,
	Eraser,
	Loader2,
	ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { QuoteDocument } from "#/components/quote-document";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/sign/$quoteId")({
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(
			orpc.quotes.get.queryOptions({ input: { quoteId: params.quoteId } }),
		),
	head: () => ({ meta: [{ title: "Review & sign · Orbyte eSign" }] }),
	component: SignPage,
});

function SignPage() {
	const { quoteId } = Route.useParams();
	const { data: q } = useSuspenseQuery(
		orpc.quotes.get.queryOptions({ input: { quoteId } }),
	);
	const queryClient = useQueryClient();
	const markViewed = useMutation(orpc.esign.markViewed.mutationOptions());

	// Record that the customer opened the document (once per page load).
	const viewed = useRef(false);
	useEffect(() => {
		if (viewed.current || q.status !== "approved") return;
		viewed.current = true;
		markViewed.mutate({ quoteId });
	}, [q.status, quoteId, markViewed]);

	return (
		<div className="orbyte min-h-dvh">
			<header className="border-b bg-card">
				<div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
					<div className="flex items-center gap-2">
						<img src="/orbyte-icon.png" alt="" className="size-7" />
						<span className="font-semibold">Orbyte eSign</span>
					</div>
					<Button asChild size="sm" variant="outline">
						<a
							href={`/api/quotes/${q.id}/pdf`}
							target="_blank"
							rel="noreferrer"
						>
							<Download className="size-4" /> PDF
						</a>
					</Button>
				</div>
			</header>

			<main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
				<p className="text-sm text-muted-foreground">
					<b className="text-foreground">{q.business?.name}</b> sent you a
					quotation to review and sign.
				</p>
				<QuoteDocument q={q} />

				{q.status === "approved" ? (
					<SignPanel
						quoteId={q.id}
						defaultName={q.conversation?.customerName ?? ""}
						onSigned={() =>
							queryClient.invalidateQueries({ queryKey: orpc.quotes.key() })
						}
					/>
				) : q.status === "accepted" ? (
					<div className="flex items-center gap-3 rounded-xl border bg-card p-5">
						<CheckCircle2 className="size-8 shrink-0 text-status-approved" />
						<div>
							<p className="font-semibold">Signed — thank you!</p>
							<p className="text-sm text-muted-foreground">
								You can go back to WhatsApp. {q.business?.name} has been
								notified.
							</p>
						</div>
					</div>
				) : q.status === "superseded" ? (
					<p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
						This version was replaced by an updated quotation. Please open the
						latest one from WhatsApp.
					</p>
				) : (
					<p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
						This quotation is not open for signing.
					</p>
				)}

				<p className="flex items-center justify-center gap-1.5 pb-6 text-xs text-muted-foreground">
					<ShieldCheck className="size-3.5" /> Every view and signature is
					recorded in the Orbyte eSign audit log.
				</p>
			</main>
		</div>
	);
}

function SignPanel(props: {
	quoteId: string;
	defaultName: string;
	onSigned: () => void;
}) {
	const [name, setName] = useState(props.defaultName);
	const [agree, setAgree] = useState(false);
	const [hasInk, setHasInk] = useState(false);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const drawing = useRef(false);
	const sign = useMutation(orpc.esign.sign.mutationOptions());

	// Size the canvas to its box (and the screen's pixel density).
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = canvas.offsetWidth * ratio;
		canvas.height = canvas.offsetHeight * ratio;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.scale(ratio, ratio);
		ctx.lineWidth = 2.2;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.strokeStyle = "#0b1e4d";
	}, []);

	function point(e: React.PointerEvent<HTMLCanvasElement>) {
		const r = e.currentTarget.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function clear() {
		const canvas = canvasRef.current;
		canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
		setHasInk(false);
	}

	async function submit() {
		const canvas = canvasRef.current;
		if (!canvas) return;
		try {
			await sign.mutateAsync({
				quoteId: props.quoteId,
				signerName: name.trim(),
				signatureImage: canvas.toDataURL("image/png"),
			});
			toast.success("Quotation signed");
			props.onSigned();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Could not sign");
		}
	}

	return (
		<section className="space-y-4 rounded-xl border bg-card p-5">
			<h2 className="font-semibold">Accept and sign</h2>
			<div className="space-y-1 text-sm">
				<label htmlFor="signer-name" className="text-muted-foreground">
					Full name
				</label>
				<Input
					id="signer-name"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
			</div>
			<div className="space-y-1 text-sm">
				<div className="flex items-center justify-between">
					<span className="text-muted-foreground">Signature</span>
					<button
						type="button"
						onClick={clear}
						className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
					>
						<Eraser className="size-3.5" /> Clear
					</button>
				</div>
				<canvas
					ref={canvasRef}
					className="h-36 w-full touch-none rounded-lg border border-dashed bg-muted/40"
					onPointerDown={(e) => {
						drawing.current = true;
						e.currentTarget.setPointerCapture(e.pointerId);
						const ctx = e.currentTarget.getContext("2d");
						const p = point(e);
						ctx?.beginPath();
						ctx?.moveTo(p.x, p.y);
					}}
					onPointerMove={(e) => {
						if (!drawing.current) return;
						const ctx = e.currentTarget.getContext("2d");
						const p = point(e);
						ctx?.lineTo(p.x, p.y);
						ctx?.stroke();
						setHasInk(true);
					}}
					onPointerUp={() => {
						drawing.current = false;
					}}
				/>
				{!hasInk && (
					<p className="text-xs text-muted-foreground">
						Draw your signature with a mouse or finger.
					</p>
				)}
			</div>
			<label className="flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					checked={agree}
					onChange={(e) => setAgree(e.target.checked)}
					className="mt-1 accent-[var(--primary)]"
				/>
				<span>
					I accept this quotation, including the requirements, prices and terms
					above.
				</span>
			</label>
			<Button
				className="w-full"
				disabled={!agree || !hasInk || name.trim().length < 2 || sign.isPending}
				onClick={submit}
			>
				{sign.isPending && <Loader2 className="size-4 animate-spin" />}
				Sign & accept
			</Button>
		</section>
	);
}
