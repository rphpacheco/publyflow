import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Public proposal pages change when the client answers and carry a secret
  // token in the URL: no intermediate cache may store them.
  async headers() {
    return [{ source: "/p/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] }];
  },
};

export default nextConfig;
