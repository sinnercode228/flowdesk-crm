import type { NextConfig } from 'next';

/**
 * Static export. `NEXT_PUBLIC_BASE_PATH` is set to `/<repo>` for GitHub Pages
 * (see `npm run build:pages` and .github/workflows/pages.yml).
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  transpilePackages: ['@flowdesk/shared'],
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
