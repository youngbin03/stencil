import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This app's dir (apps/web) and the repo root (../..). Used to locate baked
// design-system assets, embedded fonts, the shared .env.local secret, and to
// pin the "@/" import alias so resolution never depends on tsconfig discovery.
const webDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(webDir, "../..");

// Load the repo-root .env.local once at server start so route handlers see
// ANTHROPIC_API_KEY without duplicating the secret into apps/web. Server-only:
// nothing here is NEXT_PUBLIC_, so it never reaches the client bundle.
const envFile = resolve(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
process.env.STENCIL_ROOT = root;
process.env.STENCIL_FONTS_DIR ??= resolve(root, "fonts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Node-only libraries used by the assemble pipeline — keep them external so
  // Next does not try to bundle native binaries / Node built-ins for the server.
  serverExternalPackages: ["@anthropic-ai/sdk", "opentype.js", "@xmldom/xmldom", "@resvg/resvg-js", "@stencil/classifier"],
  // Compile the workspace packages Next bundles directly (classifier stays
  // external for its native resvg binary). Robust against dist build-order.
  transpilePackages: ["@stencil/ir", "@stencil/normalizer", "@stencil/extractor", "@stencil/composer", "@stencil/director", "@stencil/critic", "@stencil/solver", "@stencil/renderer", "@stencil/synthesizer"],
  // Monorepo: trace from the repo root and force-include the runtime assets the
  // route handlers read via fs (baked design systems + mockups + embedded fonts)
  // so they ship inside the serverless functions on Vercel.
  outputFileTracingRoot: root,
  outputFileTracingIncludes: {
    "/**": [
      "apps/web/assets/**",
      "apps/web/fonts/**",
      "fonts/**",
      "fixtures/assets/*/system.json",
      "fixtures/assets/*/mockups/**",
    ],
  },
  // Pin the "@/" alias explicitly so the build never depends on tsconfig paths
  // discovery (which differed between local macOS and the Vercel/Linux build).
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = { ...(config.resolve.alias || {}), "@": webDir };
    return config;
  },
};

export default nextConfig;
