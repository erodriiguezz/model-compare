import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  trailingSlash: true, // compare/index.html, so FastAPI's StaticFiles serves it and /compare stays free for the API alias
  // Rewrites are not supported by static export; they only proxy the API while running `next dev`.
  ...(process.env.NODE_ENV === "development" && {
    async rewrites() {
      return [{ source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" }];
    },
  }),
};

export default config;
