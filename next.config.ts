import type { NextConfig } from "next";

const securityHeaders = [
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  // geolocation=(self), not () — an empty allowlist blocks our own origin too,
  // which made "Near me" and the planner's use-my-location fail as "denied"
  // with no permission prompt ever shown.
  { key: 'Permissions-Policy',        value: 'geolocation=(self), camera=(), microphone=()' },
]

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.1.136'],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
};

export default nextConfig;
