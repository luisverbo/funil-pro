import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions têm limite padrão de 1MB — fotos de celular passam disso e
    // o upload travava em "Enviando…". Sobe pra 10MB.
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default nextConfig;
