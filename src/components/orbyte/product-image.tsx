import { Package, Wrench } from "lucide-react";
import { avatarHue } from "#/lib/time";
import { cn } from "#/lib/utils";

type ImageSource = {
	id: string;
	name: string;
	category: string;
	type: "stock" | "service";
	imageVersion: string | null;
};

export function productImageUrl(p: {
	id: string;
	imageVersion: string | null;
}) {
	return p.imageVersion
		? `/api/products/${p.id}/image?v=${p.imageVersion}`
		: null;
}

/**
 * The product's picture, or a placeholder tile coloured by category
 * (a box for stock items, a wrench for services).
 */
export function ProductThumb({
	product,
	src,
	className,
}: {
	product: Pick<ImageSource, "name" | "category" | "type"> &
		Partial<Pick<ImageSource, "id" | "imageVersion">>;
	/** Overrides the stored image, e.g. a preview of a new upload. */
	src?: string | null;
	className?: string;
}) {
	const url =
		src !== undefined
			? src
			: product.id
				? productImageUrl({
						id: product.id,
						imageVersion: product.imageVersion ?? null,
					})
				: null;
	const box = cn(
		"flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white",
		className,
	);
	if (url) {
		return (
			<span className={box}>
				<img src={url} alt="" className="size-full object-cover" />
			</span>
		);
	}
	const hue = avatarHue(product.category);
	const Icon = product.type === "stock" ? Package : Wrench;
	return (
		<span
			className={box}
			style={{
				background: `linear-gradient(135deg, hsl(${hue} 80% 95%), hsl(${hue} 70% 86%))`,
				color: `hsl(${hue} 45% 35%)`,
			}}
			title={product.name}
		>
			<Icon className="size-1/2" strokeWidth={1.5} />
		</span>
	);
}

/** Shrinks a picked image to at most `max` px and returns a JPEG data URL. */
export async function fileToThumb(file: File, max = 512): Promise<string> {
	if (!file.type.startsWith("image/")) throw new Error("Pick an image file");
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		const scale = Math.min(1, max / Math.max(img.width, img.height));
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(img.width * scale);
		canvas.height = Math.round(img.height * scale);
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Could not read the image");
		ctx.fillStyle = "#fff"; // JPEG has no transparency
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL("image/jpeg", 0.85);
	} finally {
		URL.revokeObjectURL(url);
	}
}
