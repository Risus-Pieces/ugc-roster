import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    // Turbopack's on-disk cache kept serving an old globals.css after it changed (the Tailwind loader's
    // output isn't invalidated), both in `next dev` and in Vercel builds, which restore .next/cache.
    // Builds take under a minute without it.
    turbopackFileSystemCacheForDev: false,
    turbopackFileSystemCacheForBuild: false,
  },
};

export default nextConfig;
