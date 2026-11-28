import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["127.0.0.1"],
  async redirects() {
    return [
      {
        source: "/projected",
        destination: "/standings?view=projected",
        permanent: false,
      },
      {
        source: "/locations/v2/:venueKey/tip",
        destination: "/locations/:venueKey/tip",
        permanent: false,
      },
      {
        source: "/locations/v2/:venueKey",
        destination: "/locations/:venueKey",
        permanent: false,
      },
      {
        source: "/locations/v2",
        destination: "/locations",
        permanent: false,
      },
      {
        source: "/locations/v3/:venueKey/tip",
        destination: "/locations/:venueKey/tip",
        permanent: false,
      },
      {
        source: "/locations/v3/:venueKey",
        destination: "/locations/:venueKey",
        permanent: false,
      },
      {
        source: "/locations/v3",
        destination: "/locations",
        permanent: false,
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
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
