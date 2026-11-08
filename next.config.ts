import type { NextConfig } from "next";
import { withEve } from "eve/next";

// 'unsafe-inline' stays for scripts (Next.js bootstraps + next-themes FOUC)
// and styles (Streamdown / shiki / mermaid). Production omits 'unsafe-eval'.
// next dev / React reconstruct call stacks with eval(); that never ships.
const scriptSrc =
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

const contentSecurityPolicy = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  // Browser traffic stays same-origin, except voice mode's realtime WebSocket
  // to AI Gateway (authorized by a short-lived token from /api/realtime).
  // OpenAI / Blob / the rest of AI Gateway are server-side.
  "connect-src 'self' wss://ai-gateway.vercel.sh",
  // mermaid and shiki spawn blob workers; defaulting to script-src would block them.
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  transpilePackages: ["shiki"],
  async redirects() {
    return [
      { source: "/documents", destination: "/files", permanent: true },
      { source: "/documents/:id", destination: "/files/:id", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default withEve(nextConfig);
