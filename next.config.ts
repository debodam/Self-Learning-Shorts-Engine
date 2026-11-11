import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // ffmpeg-static ships a binary and resolves its own path, so keep it out of the bundle.
  // `next build` traces node_modules/ffmpeg-static/ffmpeg into the server output (see
  // .next/server/app/review/page.js.nft.json), so Vercel ships it. Don't add
  // outputFileTracingIncludes for it: that made `next dev` rebuild in a loop.
  serverExternalPackages: ["ffmpeg-static"],
  async redirects() {
    return [{ source: "/", destination: "/review", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
