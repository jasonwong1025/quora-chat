import tailwindcss from "@tailwindcss/vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";

// In dev, Nitro treats any request the browser makes for an image (e.g. <img>)
// as a static file and never reaches our API, so /api/products/:id/image 404s.
// Marking /api requests as plain fetches sends them to the API as usual.
const apiNotAsset: Plugin = {
	name: "api-not-asset",
	apply: "serve",
	configureServer(server) {
		server.middlewares.use((req, _res, next) => {
			if (req.url?.startsWith("/api/")) req.headers["sec-fetch-dest"] = "empty";
			next();
		});
	},
};

const config = defineConfig({
	resolve: { tsconfigPaths: true },
	// Replit serves the dev server through its own preview domain.
	server: { host: "0.0.0.0", allowedHosts: true },
	plugins: [
		apiNotAsset, // must run before nitro's dev middleware
		nitro({
			// PDFKit resolves built-in fonts through package-local #standard-fonts
			// imports. Preserve that package boundary in the production server.
			traceDeps: ["pdfkit*"],
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});

export default config;
