import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The `ai/` rules directory lives outside `app/` (repo-root/ai), so it
  // must be explicitly traced for standalone/serverless deployments to
  // include it alongside the /api/chat route that reads it at runtime.
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/api/chat": ["../ai/**/*"],
  },
};

export default nextConfig;
