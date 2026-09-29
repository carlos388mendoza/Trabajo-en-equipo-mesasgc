// Ícono de la pestaña, generado a partir del logo circular solo con el nombre
// (convención `app/icon` y `app/apple-icon` de Next 16, con ImageResponse).
//
// Se recorta en círculo: fuera del círculo el PNG es blanco, y en una pestaña
// oscura se vería un cuadrado blanco alrededor.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

const LOGO = join(process.cwd(), "public/brand/grupo-comidas-logo-circular-solo-nombre.png");

export async function tabIcon(px: number): Promise<ImageResponse> {
  const src = `data:image/png;base64,${(await readFile(LOGO)).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden" }}>
        {/* ImageResponse no admite next/image: aquí va un <img> normal. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={px} height={px} alt="Grupo Comidas" />
      </div>
    ),
    { width: px, height: px },
  );
}
