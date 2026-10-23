import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions têm limite padrão de 1MB — fotos de celular passam disso e
    // o upload travava em "Enviando…". Sobe pra 10MB.
    serverActions: { bodySizeLimit: '10mb' },
  },
  // Estúdio IA (Fase 5): a entrega trata a foto com sharp (nativo). Garante que
  // os binários Linux vão junto das rotas que entregam/geram fotos na Vercel.
  outputFileTracingIncludes: {
    '/api/cron/estudio-producao': ['./node_modules/sharp/**/*', './node_modules/@img/sharp-linux-x64/**/*', './node_modules/@img/sharp-libvips-linux-x64/**/*'],
    '/api/estudio': ['./node_modules/sharp/**/*', './node_modules/@img/sharp-linux-x64/**/*', './node_modules/@img/sharp-libvips-linux-x64/**/*'],
  },
};

export default nextConfig;
