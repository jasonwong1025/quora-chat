import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Bell, Mail, Smartphone } from "lucide-react";
import { useWorkspace } from "#/components/orbyte/workspace";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { ago } from "#/lib/time";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

/** Orbyte notifications for the signed-in staff member (simulated app + email). */
export function NotificationBell() {
	const { business, me } = useWorkspace();
	const router = useRouter();
	const queryClient = useQueryClient();
	const list = useQuery({
		...orpc.notifications.list.queryOptions({
			input: { businessId: business.id, staffId: me?.id ?? "" },
		}),
		enabled: Boolean(me),
		refetchInterval: 4000,
	});
	const read = useMutation(
		orpc.notifications.read.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: orpc.notifications.key() }),
		}),
	);
	const items = list.data ?? [];
	const unread = items.filter((n) => !n.readAt).length;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
					className="relative ml-auto rounded-lg p-1.5 text-white/75 hover:bg-white/10 hover:text-white"
				>
					<Bell className="size-5" />
					{unread > 0 && (
						<span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-[var(--orb-cyan)] px-1 text-[10px] font-bold text-[var(--orb-navy)]">
							{unread}
						</span>
					)}
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-80 p-0">
				<div className="flex items-center justify-between px-3 py-2">
					<p className="text-sm font-semibold">Notifications</p>
					{unread > 0 && me && (
						<button
							type="button"
							onClick={() => read.mutate({ staffId: me.id })}
							className="text-xs text-primary hover:underline"
						>
							Mark all read
						</button>
					)}
				</div>
				<DropdownMenuSeparator />
				<div className="max-h-96 overflow-y-auto p-1">
					{!me ? (
						<p className="p-3 text-sm text-muted-foreground">
							Choose who you're signed in as.
						</p>
					) : items.length === 0 ? (
						<p className="p-3 text-sm text-muted-foreground">Nothing yet.</p>
					) : (
						items.map((n) => (
							<DropdownMenuItem
								key={n.id}
								onSelect={() => {
									if (!n.readAt) read.mutate({ staffId: me.id, ids: [n.id] });
									if (n.link) router.history.push(n.link);
								}}
								className={cn("items-start", !n.readAt && "bg-secondary/60")}
							>
								<span
									className={cn(
										"mt-1.5 size-2 shrink-0 rounded-full",
										n.readAt ? "bg-transparent" : "bg-[var(--orb-royal)]",
									)}
								/>
								<span className="min-w-0 flex-1">
									<span className="block text-sm font-medium">{n.title}</span>
									<span className="line-clamp-2 block text-xs text-muted-foreground">
										{n.body}
									</span>
									<span className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground [&_svg]:!size-3">
										{ago(n.createdAt)}
										<span className="inline-flex items-center gap-0.5">
											<Smartphone /> App
										</span>
										<span className="inline-flex items-center gap-0.5">
											<Mail /> Email
										</span>
									</span>
								</span>
							</DropdownMenuItem>
						))
					)}
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
