import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    // `components/` es donde vive el editor entero: 58 de las 76 clases del
    // repo. Sin esta línea Tailwind genera un CSS que no incluye ni el `w-52`
    // de la paleta ni el `flex-1` del lienzo, y la página sale en texto plano
    // sin que el build dé ningún error que lo delate.
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
