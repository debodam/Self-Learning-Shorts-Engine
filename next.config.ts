import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // ffmpeg-static ships a binary and resolves its own path, so keep it out of the bundle.
  // TODO(deploy): confirm the Vercel build includes node_modules/ffmpeg-static/ffmpeg. Adding
  // it with outputFileTracingIncludes made `next dev` rebuild in a loop, so if it's missing,
  // set FFMPEG_PATH or add the include only for production builds.
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
