// Verifica las protecciones contra la base de producción en Vercel.
//
//   npm run verify:vercel-protection
//
// Comprueba que:
//   (a) vercel-build.mjs falla en Preview si TURSO_DATABASE_URL contiene
//       "mesasgc-prod".
//   (b) seed.ts se niega a correr si TURSO_DATABASE_URL contiene "mesasgc-prod".

import { spawnSync } from "node:child_process";

let ok = 0;
let fail = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ok   ${label}`); ok++; }
  else { console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); fail++; }
}

// (a) build en Preview con URL de prod debe fallar con el mensaje de protección.
{
  const r = spawnSync("node", ["scripts/vercel-build.mjs"], {
    env: { ...process.env, VERCEL_ENV: "preview", TURSO_DATABASE_URL: "libsql://mesasgc-prod-xxx.turso.io", TURSO_AUTH_TOKEN: "x" },
    encoding: "utf8",
  });
  const out = (r.stdout || "") + (r.stderr || "");
  check("build (Preview) falla si la URL contiene mesasgc-prod", r.status !== 0 && /PROTECCIÓN.*mesasgc-prod/.test(out), `status=${r.status}`);
}

// (b) seed con URL de prod debe fallar con el mensaje de protección.
{
  const r = spawnSync("npx", ["tsx", "scripts/seed.ts"], {
    env: { ...process.env, NODE_ENV: "development", TURSO_DATABASE_URL: "libsql://mesasgc-prod-xxx.turso.io", TURSO_AUTH_TOKEN: "x" },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const out = (r.stdout || "") + (r.stderr || "");
  check("seed falla si la URL contiene mesasgc-prod", r.status !== 0 && /PROTECCIÓN.*mesasgc-prod/.test(out), `status=${r.status}`);
}

// (c) build en Preview con URL de preview NO falla por la protección (puede fallar después por la base, pero no por protección).
{
  const r = spawnSync("node", ["scripts/vercel-build.mjs"], {
    env: { ...process.env, VERCEL_ENV: "preview", TURSO_DATABASE_URL: "libsql://mesasgc-preview-xxx.turso.io", TURSO_AUTH_TOKEN: "x" },
    encoding: "utf8",
  });
  const out = (r.stdout || "") + (r.stderr || "");
  check("build (Preview) con URL de preview no dispara la protección", !/PROTECCIÓN.*mesasgc-prod/.test(out));
}

console.log(`\n${ok} ok, ${fail} fallos`);
process.exit(fail > 0 ? 1 : 0);