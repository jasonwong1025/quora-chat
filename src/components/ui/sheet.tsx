import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "#/lib/utils";

/** A panel that slides in from the right. Built on the Radix dialog. */
const Sheet = SheetPrimitive.Root;
const SheetTitle = SheetPrimitive.Title;
const SheetDescription = SheetPrimitive.Description;

function SheetContent({
	className,
	children,
	...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
	return (
		<SheetPrimitive.Portal>
			<SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
			<SheetPrimitive.Content
				className={cn(
					"fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto border-l bg-card text-card-foreground shadow-xl sm:max-w-md data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
					className,
				)}
				{...props}
			>
				{children}
				<SheetPrimitive.Close className="absolute top-3 right-3 rounded-md p-1.5 opacity-70 hover:bg-muted hover:opacity-100">
					<XIcon className="size-4" />
					<span className="sr-only">Close</span>
				</SheetPrimitive.Close>
			</SheetPrimitive.Content>
		</SheetPrimitive.Portal>
	);
}

export { Sheet, SheetContent, SheetDescription, SheetTitle };
