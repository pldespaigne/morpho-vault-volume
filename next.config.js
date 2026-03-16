/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client"],
  experimental: {
    useCache: true,
  },
};

export default nextConfig;
