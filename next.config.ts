import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    ignoreIssue: [
      {
        // The local price book CSV is intentionally read from outside the repo at runtime.
        path: /next\.config\.ts$/,
        title: "Encountered unexpected file in NFT list",
      },
    ],
  },
};

export default nextConfig;
