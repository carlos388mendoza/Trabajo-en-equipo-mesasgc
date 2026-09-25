# Cómo usar este proyecto

Este zip ya es un proyecto Next.js completo (no necesitas correr
`create-next-app`, ya está armado). Solo faltan instalar las dependencias.

1. Extrae este zip dentro de la carpeta de tu repositorio clonado
   (la que trajiste con GitHub Desktop). Puedes copiar todo el
   contenido directamente ahí, reemplazando si pregunta.

2. Abre una terminal dentro de esa carpeta y corre:
   npm install

3. Copia el archivo `.env.example` y renómbralo a `.env.local`.
   Por ahora puedes dejarlo vacío o con valores de prueba; lo iremos
   llenando cuando lleguemos a la parte de la base de datos y auth.

4. Corre el proyecto:
   npm run dev

5. Abre http://localhost:3000 en tu navegador. Deberías ver la
   página de bienvenida y poder navegar a /login, /admin,
   /analiticas, /restaurante/1/editor y /restaurante/1/rapido.

6. Vuelve a GitHub Desktop: verás todos los archivos nuevos listados
   como cambios. Escribe un mensaje de commit y sube con Push
   (o Publish si es la primera vez).

Cada archivo .tsx dentro de /app tiene un comentario // TODO
indicando qué falta ahí y de quién es esa tarea, según el reparto
del README.

Nota: la carpeta node_modules y el archivo .env.local NO se suben a
GitHub (ya están en .gitignore) — es normal y correcto que no
aparezcan en GitHub Desktop como cambios.
