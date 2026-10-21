import {
	CheckCheck,
	FileText,
	MessageSquarePlus,
	MoreVertical,
	Search,
	UserRound,
} from "lucide-react";
import { useState } from "react";
import { listTime } from "#/lib/time";
import type { WhatsappChat } from "#/lib/types";
import { cn } from "#/lib/utils";
import type { WaProfile } from "#/lib/wa-profile";
import { WaAvatar } from "./avatar";

export function ChatList(props: {
	chats: WhatsappChat[];
	selectedId: string | undefined;
	onSelect: (businessId: string) => void;
	profile: WaProfile;
	onSwitchProfile: () => void;
	unread: (chat: WhatsappChat) => number;
	typingIn: string | null;
}) {
	const [filter, setFilter] = useState<"all" | "unread">("all");
	const [q, setQ] = useState("");

	const shown = props.chats
		.filter((c) => c.business.name.toLowerCase().includes(q.toLowerCase()))
		.filter((c) => filter === "all" || props.unread(c) > 0)
		.sort(
			(a, b) =>
				(b.lastMessage?.createdAt.getTime() ?? 0) -
				(a.lastMessage?.createdAt.getTime() ?? 0),
		);
	const unreadChats = props.chats.filter((c) => props.unread(c) > 0).length;

	return (
		<div className="flex h-full flex-col bg-[var(--wa-panel)]">
			<header className="flex items-center justify-between px-5 pt-4 pb-2">
				<h1 className="text-[22px] font-bold">WhatsApp</h1>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={props.onSwitchProfile}
						title="Switch demo customer"
						className="rounded-full p-2 text-[var(--wa-muted)] hover:bg-[var(--wa-hover)]"
					>
						<MoreVertical className="size-5" />
					</button>
					<button
						type="button"
						onClick={props.onSwitchProfile}
						title="Switch demo customer"
						className="flex size-10 items-center justify-center rounded-full bg-[var(--wa-green)] text-black hover:brightness-110"
					>
						<MessageSquarePlus className="size-5" />
					</button>
				</div>
			</header>

			<button
				type="button"
				onClick={props.onSwitchProfile}
				className="mx-4 mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[var(--wa-muted)] hover:bg-[var(--wa-hover)]"
			>
				<UserRound className="size-3.5" />
				<span className="truncate">
					Demo phone of{" "}
					<span className="text-[var(--wa-text)]">{props.profile.name}</span> ·{" "}
					{props.profile.phone}
				</span>
			</button>

			<div className="px-4">
				<label className="flex items-center gap-3 rounded-full bg-[var(--wa-input)] px-4 py-2">
					<Search className="size-4 text-[var(--wa-muted)]" />
					<input
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="Search or start a new chat"
						className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--wa-muted)]"
					/>
				</label>
				<div className="flex gap-2 py-3">
					{(["all", "unread"] as const).map((f) => (
						<button
							key={f}
							type="button"
							onClick={() => setFilter(f)}
							className={cn(
								"rounded-full border px-3 py-1 text-sm",
								filter === f
									? "border-transparent bg-[#103529] text-[#d9fdd3]"
									: "border-[var(--wa-border)] text-[var(--wa-muted)] hover:bg-[var(--wa-hover)]",
							)}
						>
							{f === "all" ? "All" : "Unread"}
							{f === "unread" && unreadChats > 0 && ` ${unreadChats}`}
						</button>
					))}
				</div>
			</div>

			<ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
				{shown.map((c) => {
					const unread = props.unread(c);
					const last = c.lastMessage;
					const typing = props.typingIn === c.business.id;
					return (
						<li key={c.business.id}>
							<button
								type="button"
								onClick={() => props.onSelect(c.business.id)}
								className={cn(
									"flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-[var(--wa-hover)]",
									props.selectedId === c.business.id && "bg-[var(--wa-hover)]",
								)}
							>
								<WaAvatar name={c.business.name} size={48} />
								<div className="min-w-0 flex-1">
									<div className="flex items-baseline justify-between gap-2">
										<p className="truncate text-[16px]">{c.business.name}</p>
										{last && (
											<span
												className={cn(
													"shrink-0 text-xs",
													unread > 0
														? "text-[var(--wa-green)]"
														: "text-[var(--wa-muted)]",
												)}
											>
												{listTime(last.createdAt)}
											</span>
										)}
									</div>
									<div className="flex items-center justify-between gap-2">
										<p className="flex min-w-0 items-center gap-1 truncate text-sm text-[var(--wa-muted)]">
											{typing ? (
												<span className="text-[var(--wa-green)]">typing…</span>
											) : last ? (
												<>
													{last.sender === "customer" && (
														<CheckCheck className="size-4 shrink-0 text-[var(--wa-tick-read)]" />
													)}
													{last.quoteId && (
														<FileText className="size-4 shrink-0" />
													)}
													<span className="truncate">
														{last.body.split("\n")[0]}
													</span>
												</>
											) : (
												<span className="truncate">
													{c.business.tagline ?? c.business.industry}
												</span>
											)}
										</p>
										{unread > 0 && (
											<span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--wa-green)] px-1.5 text-xs font-semibold text-black">
												{unread}
											</span>
										)}
									</div>
								</div>
							</button>
						</li>
					);
				})}
				{shown.length === 0 && (
					<li className="p-6 text-center text-sm text-[var(--wa-muted)]">
						No chats found
					</li>
				)}
			</ul>
		</div>
	);
}
