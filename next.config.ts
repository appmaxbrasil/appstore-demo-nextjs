import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Origens que podem pedir os assets de DEV do Next.
   *
   * Este projeto só funciona atrás de um túnel HTTPS público (a Appmax não
   * alcança `localhost`), e em desenvolvimento o Next bloqueia requisições
   * cross-origin para os assets de dev. Sem isto, o HTML chega inteiro mas os
   * chunks do client tomam 403 e o React nunca hidrata: a página parece
   * normal e os formulários simplesmente não reagem.
   *
   * Os curingas cobrem o subdomínio novo que o túnel sorteia a cada restart.
   * Só vale em `next dev`.
   */
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
    "*.ngrok-free.dev",
    "*.trycloudflare.com",
  ],
};

export default nextConfig;
