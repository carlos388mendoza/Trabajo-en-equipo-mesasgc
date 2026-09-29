import { tabIcon } from "@/lib/brand/tab-icon";

// Ícono al guardar la app en la pantalla de inicio de un iPhone o iPad
// (Next 16: `app/apple-icon`). Mismo logo que el favicon, a 180 px.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return tabIcon(size.width);
}
