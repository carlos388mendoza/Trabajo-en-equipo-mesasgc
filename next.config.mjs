/** @type {import('next').NextConfig} */
const nextConfig = {
  // `NEXT_DIST_DIR` solo lo usa `npm run verify:auth`: levanta su propia app
  // mientras `npm run dev` sigue corriendo, y Next 16 no deja dos servidores
  // de desarrollo en la misma carpeta de salida (la bloquea con un lockfile).
  // Sin la variable, `.next` de siempre.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Cabeceras de seguridad (issue de seguridad): CSP básica (frame-ancestors
  // 'self' para evitar clickjacking, más permisos mínimos para que la app
  // siga funcionando), nosniff, Referrer-Policy y HSTS.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'",
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
