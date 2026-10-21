import { DropdownMenu as MenuPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "#/lib/utils";

const DropdownMenu = MenuPrimitive.Root;
const DropdownMenuTrigger = MenuPrimitive.Trigger;

function DropdownMenuContent({
	className,
	sideOffset = 4,
	align = "end",
	...props
}: React.ComponentProps<typeof MenuPrimitive.Content>) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Content
				sideOffset={sideOffset}
				align={align}
				className={cn(
					"orbyte z-50 min-w-40 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0",
					className,
				)}
				{...props}
			/>
		</MenuPrimitive.Portal>
	);
}

function DropdownMenuItem({
	className,
	...props
}: React.ComponentProps<typeof MenuPrimitive.Item>) {
	return (
		<MenuPrimitive.Item
			className={cn(
				"flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuSeparator() {
	return <MenuPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />;
}

export {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
};
