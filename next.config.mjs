/** @type {import('next').NextConfig} */
const nextConfig = {
  redirects: async () => {
    return [
      // Basic redirect
      {
        source: "/",
        destination: "/translator",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
