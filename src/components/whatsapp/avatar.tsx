import { avatarHue, initials } from "#/lib/time";

export function WaAvatar({ name, size = 40 }: { name: string; size?: number }) {
	const hue = avatarHue(name);
	return (
		<div
			className="flex shrink-0 items-center justify-center rounded-full font-semibold"
			style={{
				width: size,
				height: size,
				fontSize: size * 0.36,
				background: `hsl(${hue} 35% 28%)`,
				color: `hsl(${hue} 70% 82%)`,
			}}
		>
			{initials(name)}
		</div>
	);
}
