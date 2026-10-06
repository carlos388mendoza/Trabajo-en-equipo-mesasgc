/** @type {import('next').NextConfig} */
const nextConfig = {
  // `NEXT_DIST_DIR` solo lo usa `npm run verify:auth`: levanta su propia app
  // mientras `npm run dev` sigue corriendo, y Next 16 no deja dos servidores
  // de desarrollo en la misma carpeta de salida (la bloquea con un lockfile).
  // Sin la variable, `.next` de siempre.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Solo el propio sitio puede meter la app en un iframe: el plano en vivo
  // abre ahí la lista de espera (modo sencillo). Cualquier otro sitio queda
  // fuera, así nadie puede montar la app debajo de botones falsos
  // (clickjacking). Las dos cabeceras: la moderna y la de navegadores viejos.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
