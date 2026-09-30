/** @type {import('next').NextConfig} */
const nextConfig = {
  // `NEXT_DIST_DIR` solo lo usa `npm run verify:auth`: levanta su propia app
  // mientras `npm run dev` sigue corriendo, y Next 16 no deja dos servidores
  // de desarrollo en la misma carpeta de salida (la bloquea con un lockfile).
  // Sin la variable, `.next` de siempre.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
