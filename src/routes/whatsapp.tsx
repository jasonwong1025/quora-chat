import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Laptop, Lock } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { WaAvatar } from "#/components/whatsapp/avatar";
import { ChatList } from "#/components/whatsapp/chat-list";
import { ChatWindow } from "#/components/whatsapp/chat-window";
import { cn } from "#/lib/utils";
import {
	demoCustomers,
	makeProfile,
	useSeen,
	useWaProfile,
	type WaProfile,
} from "#/lib/wa-profile";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/whatsapp")({
	validateSearch: z.object({ chat: z.string().optional() }),
	head: () => ({ meta: [{ title: "WhatsApp · Quora Chat demo" }] }),
	component: WhatsappPortal,
});

function WhatsappPortal() {
	const { chat: selectedId } = Route.useSearch();
	const navigate = Route.useNavigate();
	const [profile, setProfile] = useWaProfile();
	const [seen, markSeen] = useSeen();
	const [switching, setSwitching] = useState(false);
	const [typingIn, setTypingIn] = useState<string | null>(null);

	const chats = useQuery({
		...orpc.whatsapp.chats.queryOptions({
			input: { phone: profile?.phone ?? "" },
		}),
		enabled: Boolean(profile),
		refetchInterval: 3000,
	});

	const selected = chats.data?.find((c) => c.business.id === selectedId);
	const select = (chat: string | undefined) =>
		navigate({ search: { chat }, replace: true });

	return (
		<div className="wa relative flex h-dvh overflow-hidden">
			{!profile || chats.isPending ? (
				<div className="flex flex-1 items-center justify-center text-sm text-[var(--wa-muted)]">
					Loading chats…
				</div>
			) : chats.isError ? (
				<div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-[var(--wa-muted)]">
					Could not load chats: {chats.error.message}
				</div>
			) : (
				<>
					<aside
						className={cn(
							"w-full shrink-0 border-r border-[var(--wa-border)] md:w-[400px] lg:w-[440px]",
							selected && "hidden md:block",
						)}
					>
						<ChatList
							chats={chats.data}
							selectedId={selectedId}
							onSelect={select}
							profile={profile}
							onSwitchProfile={() => setSwitching(true)}
							typingIn={typingIn}
							unread={(c) => {
								if (c.business.id === selectedId) return 0;
								const since = c.conversationId && seen[c.conversationId];
								return c.incomingAt.filter((t) => !since || t > new Date(since))
									.length;
							}}
						/>
					</aside>
					<main
						className={cn("min-w-0 flex-1", !selected && "hidden md:block")}
					>
						{selected ? (
							<ChatWindow
								key={`${selected.business.id}:${profile.phone}`}
								chat={selected}
								conversationId={selected.conversationId}
								profile={profile}
								onBack={() => select(undefined)}
								onTyping={(t) => setTypingIn(t ? selected.business.id : null)}
								onSeen={markSeen}
							/>
						) : (
							<Welcome />
						)}
					</main>
				</>
			)}

			{profile && (
				<SwitchCustomer
					open={switching}
					onOpenChange={setSwitching}
					current={profile}
					onPick={(p) => {
						setProfile(p);
						select(undefined);
						setSwitching(false);
					}}
				/>
			)}
		</div>
	);
}

function Welcome() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--wa-panel)] p-8 text-center">
			<Laptop className="size-16 text-[var(--wa-muted)]" strokeWidth={1} />
			<h2 className="text-3xl font-light">Quora Chat · WhatsApp demo</h2>
			<p className="max-w-md text-sm text-[var(--wa-muted)]">
				You are the customer. Pick a business on the left and ask for a
				quotation in English, Bahasa Melayu or 中文. Open the Orbyte workspace
				in another tab to see the business side.
			</p>
			<p className="mt-6 flex items-center gap-1 text-xs text-[var(--wa-muted)]">
				<Lock className="size-3" /> Simulated chat with synthetic data
			</p>
		</div>
	);
}

function SwitchCustomer(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	current: WaProfile;
	onPick: (profile: WaProfile) => void;
}) {
	const [name, setName] = useState("");
	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent className="wa border-[var(--wa-border)] bg-[var(--wa-panel)] text-[var(--wa-text)]">
				<DialogHeader>
					<DialogTitle>Whose phone is this?</DialogTitle>
					<DialogDescription className="text-[var(--wa-muted)]">
						Each customer has their own chats. Switch to play a different
						customer.
					</DialogDescription>
				</DialogHeader>
				<ul className="-mx-2 max-h-72 overflow-y-auto">
					{demoCustomers.map((n) => {
						const p = makeProfile(n);
						return (
							<li key={n}>
								<button
									type="button"
									onClick={() => props.onPick(p)}
									className={cn(
										"flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[var(--wa-hover)]",
										p.phone === props.current.phone && "bg-[var(--wa-hover)]",
									)}
								>
									<WaAvatar name={n} size={36} />
									<span className="min-w-0">
										<span className="block">{n}</span>
										<span className="block text-xs text-[var(--wa-muted)]">
											{p.phone}
										</span>
									</span>
								</button>
							</li>
						);
					})}
				</ul>
				<form
					className="flex gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (name.trim()) {
							props.onPick(makeProfile(name.trim()));
							setName("");
						}
					}}
				>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Or type a new customer name"
						className="flex-1 rounded-lg bg-[var(--wa-input)] px-3 py-2 text-sm outline-none placeholder:text-[var(--wa-muted)]"
					/>
					<button
						type="submit"
						className="rounded-lg bg-[var(--wa-green)] px-4 text-sm font-medium text-black"
					>
						Use
					</button>
				</form>
			</DialogContent>
		</Dialog>
	);
}
