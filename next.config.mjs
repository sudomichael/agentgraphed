/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output bundles the server + its transitive deps into
  // .next/standalone, so the published package can start with just `node`.
  // No `next` binary, no `tsx`, no toolchain on the user's machine.
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
