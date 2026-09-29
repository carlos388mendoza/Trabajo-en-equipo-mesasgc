import { tabIcon } from "@/lib/brand/tab-icon";

// Favicon de la pestaña (Next 16: `app/icon`), a partir del logo solo nombre.

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return tabIcon(size.width);
}
