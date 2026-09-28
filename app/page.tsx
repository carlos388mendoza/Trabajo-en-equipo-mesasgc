import { redirect } from "next/navigation";

// La portada no tiene contenido propio: sin sesión el proxy ya manda a
// /login; con sesión, /inicio decide a dónde va cada usuario según su rol.

export default function HomePage() {
  redirect("/inicio");
}
