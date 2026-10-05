// Esquema de la base de datos (Drizzle ORM + Turso / libSQL).
//
// Un solo archivo a propósito: `drizzle.config.ts` apunta aquí y el repo es
// pequeño, así que no conviene partirlo en `schema/` todavía. Si crece, se
// divide junto con la config.
//
// Convenciones:
// - Timestamps en milisegundos (`integer` + `mode: "timestamp_ms"`), no en
//   segundos, para no tener dos escalas en la misma tabla.
// - Las claves foráneas son texto (`text`) con ids generados en la app, igual
//   que las primarias: es lo que ya usa Better Auth y evita pelearse con los
//   AUTOINCREMENT de SQLite.
// - Los valores de los conjuntos cerrados NO se validan con `check()` en el
//   SQL: Turso/libSQL no los soporta yrizzle-kit. Se validan en el servidor con
//   Zod (ver `lib/db/enums.ts` y las actions).
// - Las relaciones se declaran al final con `relations()`, que es como las
//   expone el `db.query` de Drizzle.

import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { ROLES, TABLE_STATUSES, WAITLIST_STATUSES } from "./enums";

// ---------------------------------------------------------------------------
// Marcas
//
// China Wok, Pizza Hut, KFC, Denny's... Cada restaurante pertenece (o no) a
// una marca. La usan el mapa general (color del marcador, filtro) y las
// estadísticas por marca del Miembro B.
// ---------------------------------------------------------------------------

export const brands = sqliteTable("brands", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  /** Color de acento en "#rrggbb". Sin `check()`: se valida con Zod. */
  accentColor: text("accent_color").notNull(),
  /**
   * Desactivada (migración 0005, solo aditiva): no se ofrece al crear
   * restaurantes nuevos, pero sus restaurantes y su histórico siguen igual.
   * No se borra nunca: las estadísticas por marca dependen de ella.
   */
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ---------------------------------------------------------------------------
// Restaurants
// ---------------------------------------------------------------------------

export const restaurants = sqliteTable(
  "restaurants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Identificador legible en la URL; único para no tener dos "restaurante/1". */
    slug: text("slug").notNull().unique(),
    // --- Mapa general (migración 0002, solo aditiva: todo es opcional) ---
    /**
     * Marca del restaurante. SET NULL al borrar la marca: el restaurante y su
     * histórico no dependen de ella.
     */
    brandId: text("brand_id").references(() => brands.id, { onDelete: "set null" }),
    /** Ciudad, texto libre ("Tegucigalpa"). Sirve para el filtro del mapa. */
    city: text("city"),
    /**
     * Posición del marcador en el mapa general, en unidades del mapa
     * (`lib/map/projection.ts`). Desde la migración 0004 se calcula a partir
     * de la latitud y la longitud, que son las que mandan; se conserva para
     * las filas que no las tengan. Sin ninguna de las dos, el restaurante
     * sale en la lista lateral pero no en el mapa.
     */
    mapX: integer("map_x"),
    mapY: integer("map_y"),
    // --- Ubicación real (migración 0004, solo aditiva: opcional) ---
    /** Latitud en grados decimales (WGS 84), por ejemplo 14.1058. */
    latitude: real("latitude"),
    /** Longitud en grados decimales (WGS 84), por ejemplo -87.2065. */
    longitude: real("longitude"),
    /**
     * Desactivado (migración 0005, solo aditiva). No se borra: su historial
     * sigue en las estadísticas. Pero deja de existir para operar: los
     * usuarios de restaurante pierden el acceso (`loadAuthUser` solo carga
     * los activos), no sale en el mapa general ni en los contadores, y no se
     * ofrece al asignar accesos.
     */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("restaurants_brand_idx").on(t.brandId)],
);

// ---------------------------------------------------------------------------
// Zonas / vistas
//
// Una zona es una "vista" del local (comedor principal, terraza, salón de
// fiestas...). El editor trabaja siempre sobre una zona; la galería del paso 4
// rota entre ellas. `sortOrder` define el orden de la galería y `isDefault`
// cuál se abre al entrar.
// ---------------------------------------------------------------------------

export const tableLayouts = sqliteTable(
  "table_layouts",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** Tamaño del canvas en unidades del editor, para encuadrar al abrir. */
    width: integer("width").notNull().default(1600),
    height: integer("height").notNull().default(1000),
    /** Posición en la galería de vistas. */
    sortOrder: integer("sort_order").notNull().default(0),
    /** La zona que se abre por defecto. Solo una por restaurante (ver seed). */
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    /**
     * Se incrementa en cada guardado de la estructura. Sirve para que los
     * clientes de otros dispositivos detecten que el layout cambió y recarguen,
     * y para invalidar caché. Es de la ZONA, no de cada mesa.
     */
    version: integer("version").notNull().default(1),
    /**
     * Giro del plano completo: 0, 90, 180 o 270 (`LAYOUT_ROTATIONS`). Se guarda
     * con el guardado normal del editor y lo respetan el plano en vivo y la
     * copia a otro restaurante. Migración 0003, solo aditiva.
     */
    rotation: integer("rotation").notNull().default(0),
    /**
     * Zona de DEMOSTRACIÓN (migración 0007, solo aditiva).
     *
     * La crea `npm run db:demo` en los restaurantes reales y se borra con
     * `npm run db:demo:borrar`. Nunca se marca la zona
     * real de un restaurante: el demo dibuja en zonas suyas, para no tocar el
     * plano que alguien haya dibujado a mano.
     *
     * Es `false` por defecto, así que toda zona que ya existía es real. El
     * borrado se apoya en esta columna y en `demo_batch_id`, nunca en el
     * nombre: renombrar una zona no la convierte en demo ni al revés.
     */
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    /** Lote de demo que creó la zona (`npm run db:demo`), o null si es real. */
    demoBatchId: text("demo_batch_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("table_layouts_restaurant_idx").on(t.restaurantId),
    // Una sola zona por defecto: el índice es único y filtrado por is_default,
    // así el "primer restaurante, primera zona" del seed no puede duplicar.
    uniqueIndex("table_layouts_one_default_idx")
      .on(t.restaurantId)
      .where(sql`${t.isDefault} = 1`),
    // El aviso global y el borrado preguntan siempre por `is_demo`; con este
    // índice no tienen que recorrer la tabla entera.
    index("table_layouts_demo_idx").on(t.isDemo),
  ],
);

// ---------------------------------------------------------------------------
// Tipos de elemento (catálogo)
//
// Los 5 tipos del editor (mesa-sillas, mesa-butacas, area-juegos, bano, caja)
// son FILAS de esta tabla, no un enum en el código: el color, el ícono y el
// tamaño por defecto se editan desde la app sin deploy. La app guarda la
// `key` para distinguir el comportamiento (p. ej. qué tipos admiten clientes).
// ---------------------------------------------------------------------------

export const elementTypes = sqliteTable("element_types", {
  id: text("id").primaryKey(),
  /** Clave estable: "mesa-sillas", "caja", etc. (ver ELEMENT_TYPE_KEYS). */
  key: text("key").notNull().unique(),
  /** Texto visible en la paleta del editor. */
  label: text("label").notNull(),
  /** Color del relleno en el canvas (hex). */
  color: text("color").notNull(),
  /** Emoji/ícono representativo; se usa en la lista y de respaldo en el mapa. */
  icon: text("icon").notNull(),
  width: integer("width").notNull().default(80),
  height: integer("height").notNull().default(80),
  /** Aforo: solo tiene sentido en las mesas, null en baños/cajas. */
  defaultCapacity: integer("default_capacity"),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Mesas / elementos del mapa
//
// Una sola tabla para mesas, baños, cajas y áreas de juegos: en el canvas se
// comportan igual (se mueven, se pintan, se borran) y diferenciarlos por
// columnas distintas sería repetir lo mismo cinco veces. Lo que los separa es
// `elementTypeId`.
// ---------------------------------------------------------------------------

export const tables = sqliteTable(
  "tables",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    layoutId: text("layout_id")
      .notNull()
      .references(() => tableLayouts.id, { onDelete: "cascade" }),
    elementTypeId: text("element_type_id")
      .notNull()
      .references(() => elementTypes.id),
    /** Texto que se ve encima: "Mesa 1", "Terraza", "Baño 2"... */
    label: text("label").notNull(),
    // Geometría en unidades del canvas. `x`/`y` son la esquina superior
    // izquierda, no el centro: es lo que hace Konva al crear un Rect.
    x: integer("x").notNull().default(0),
    y: integer("y").notNull().default(0),
    width: integer("width").notNull().default(80),
    height: integer("height").notNull().default(80),
    /** Grados, como en Konva. */
    rotation: integer("rotation").notNull().default(0),
    /** Puestos disponibles; null en elementos que no se sienta nadie. */
    capacity: integer("capacity"),
    // --- Estado de la mesa (solo tiene sentido en los tipos "sentables") ---
    // Uno de TABLE_STATUSES. "ocupada" es redundante con currentEntryId a
    // propósito: el editor lo lee en cada render y lo mantenemos en la misma
    // transacción que la asignación para que no puedan discrepar.
    status: text("status").notNull().default(TABLE_STATUSES[0]),
    /**
     * Cliente de la lista de espera sentado AHORA en esta mesa.
     *
     * Es el puntero que hace posible el paso 6 (conflictos): la asignación es
     * un único `UPDATE ... WHERE id = ? AND current_entry_id IS NULL`, y si
     * afecta 0 filas es que otro host se adelantó. Por eso el puntero vive en
     * la mesa y no solo en el cliente de la lista.
     */
    currentEntryId: text("current_entry_id"),
    /**
     * Versión de esta fila, para bloqueo optimista al mover. Se incrementa en
     * cada escritura; el cliente la manda y el servidor rechaza si ya cambió.
     */
    version: integer("version").notNull().default(1),
    /**
     * Mesa o elemento de DEMOSTRACIÓN (migración 0007, solo aditiva).
     *
     * Los planos del demo viven en zonas demo, así que sus mesas también lo
     * son. `false` (lo normal) significa mesa real: ni el editor ni el borrado
     * tocan una.
     */
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    /** Lote de demo que creó la mesa, o null si es real. */
    demoBatchId: text("demo_batch_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("tables_layout_idx").on(t.layoutId),
    index("tables_restaurant_idx").on(t.restaurantId),
    index("tables_demo_idx").on(t.isDemo),
    // Un mismo cliente no puede estar sentado en dos mesas a la vez (red de
    // seguridad por si el código de aplicación falla).
    //
    // OJO: esto NO garantiza "una mesa, un cliente". Un índice único sobre
    // `current_entry_id` solo puede decir que cada valor aparece una vez. La
    // garantía de que una mesa no se asigna dos veces la da el propio
    // `UPDATE ... WHERE current_entry_id IS NULL` del paso 6, que es atómico.
    // El `WHERE` es necesario: los no-mesas (baños, cajas) dejan el campo en
    // NULL y un único NULL no viola la unicidad.
    uniqueIndex("tables_current_entry_unique")
      .on(t.currentEntryId)
      .where(sql`${t.currentEntryId} IS NOT NULL`),
  ],
);

// ---------------------------------------------------------------------------
// Lista de espera
// ---------------------------------------------------------------------------

export const waitlistEntries = sqliteTable(
  "waitlist_entries",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    customerName: text("customer_name").notNull(),
    /** Tamaño del grupo: "2" son dos personas, y el presupuesto lo necesita. */
    partySize: integer("party_size").notNull().default(1),
    phone: text("phone"),
    notes: text("notes"),
    // Uno de WAITLIST_STATUSES.
    status: text("status").notNull().default(WAITLIST_STATUSES[0]),
    arrivedAt: integer("arrived_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    /** Cuándo se avisó que la mesa estaba lista. Base de las estadísticas. */
    calledAt: integer("called_at", { mode: "timestamp_ms" }),
    seatedAt: integer("seated_at", { mode: "timestamp_ms" }),
    /**
     * Lazo inverso a `tables.currentEntryId`. Permite responder "¿quién está
     * en la mesa 3?" con un solo índice, que es la pregunta más frecuente.
     *
     * La FK es ON DELETE SET NULL a propósito: si borran la mesa, el cliente
     * vuelve a la lista en vez de desaparecer del historial.
     */
    assignedTableId: text("assigned_table_id").references(() => tables.id, {
      onDelete: "set null",
    }),
    /**
     * Host que realizó la asignación, para auditoría.
     *
     * SIN foreign key a propósito: si se borra el usuario, el histórico que
     * alimenta las estadísticas tiene que sobrevivir. Referencia blanda.
     */
    seatedByUserId: text("seated_by_user_id"),
    /**
     * Mesero que lo atendió: el de la zona de su mesa en la configuración de
     * meseros ACTIVA en el momento de sentarlo (`assignTable`). Se guarda el
     * nombre, no un id: así las estadísticas por mesero siguen valiendo
     * aunque luego se cambie o se borre la configuración.
     */
    waiterName: text("waiter_name"),
    /**
     * Cuándo y quién lo marcó listo o ausente en el modo rápido. Lo muestra
     * «Ver todas las cartas» («esperó 12 min, lo resolvió Ana»). Se vacían al
     * volverlo a la espera. Sin FK, por lo mismo que `seatedByUserId`.
     */
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolvedByUserId: text("resolved_by_user_id"),
    /**
     * Cliente de DEMOSTRACIÓN (migración 0007, solo aditiva).
     *
     * Los clientes que mete `npm run db:demo` (los que esperan ahora, los
     * sentados en mesas demo y las ocho semanas de historial para las
     * estadísticas y el asistente) son inventados, pero entran por la tabla
     * normal y las consultas no los distinguen: es justo lo que hay que probar.
     * Lo que sí lleva la marca es el teléfono `0000-0000`, que ningún cliente
     * real va a tener.
     *
     * `false` (lo normal) significa cliente real. El borrado del demo solo
     * toca filas con `is_demo`, así que el historial de un piloto nunca se ve
     * afectado.
     */
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    /** Lote de demo que creó el cliente, o null si es real. */
    demoBatchId: text("demo_batch_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("waitlist_entries_restaurant_idx").on(t.restaurantId),
    index("waitlist_entries_status_idx").on(t.status),
    index("waitlist_entries_table_idx").on(t.assignedTableId),
    // El banner, el conteo y el borrado filtran siempre por esto.
    index("waitlist_entries_demo_idx").on(t.isDemo),
  ],
);

// ---------------------------------------------------------------------------
// Better Auth
//
// Estas cuatro tablas son las que Better Auth espera (nombres y columnas
// exactos). La app las declara a mano para controlar los tipos de Drizzle y
// los campos propios, en vez de dejar que las genere su CLI.
//
// Roles y restaurantes de cada usuario viven en `user_roles` y
// `user_restaurants` (abajo), porque un usuario puede tener varios de cada.
// Las columnas `user.role` y `user.restaurant_id` del principio solo admitían
// uno: quedan OBSOLETAS, el código ya no las lee ni las escribe, y se dejaron
// para que la migración fuera solo aditiva. Se pueden quitar más adelante.
// ---------------------------------------------------------------------------

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    // --- Campos propios de la app ---
    // OBSOLETAS: `role` y `restaurantId` (ver arriba). Usa `userRoles` y
    // `userRestaurants`.
    role: text("role").notNull().default(ROLES.RESTAURANTE),
    restaurantId: text("restaurant_id").references(() => restaurants.id, {
      onDelete: "set null",
    }),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("user_role_idx").on(t.role), index("user_restaurant_idx").on(t.restaurantId)],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    // Better Auth limpia las sesiones vencidas por este índice.
    index("session_expires_at_idx").on(t.expiresAt),
    index("session_user_idx").on(t.userId),
  ],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    /** Contraseña hasheada, solo para el proveedor "credential". */
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    // Busca la cuenta al iniciar sesión con correo + contraseña.
    index("account_user_idx").on(t.userId),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    // Better Auth busca por (identifier, value) al validar un token.
    index("verification_identifier_idx").on(t.identifier),
  ],
);

// ---------------------------------------------------------------------------
// Roles y restaurantes de cada usuario (RBAC)
//
// Un usuario puede tener varios roles (p. ej. restaurante + analitica) y, con
// el rol restaurante, uno o más restaurantes. Qué permite cada rol está en
// `lib/auth/rbac.ts`; aquí solo quién tiene qué. `role` es uno de ROLES y se
// valida en el servidor con Zod (no hay `check()` en libSQL).
// ---------------------------------------------------------------------------

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const userRestaurants = sqliteTable(
  "user_restaurants",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.restaurantId] }),
    // "¿Quién trabaja en este restaurante?", la pregunta de /admin.
    index("user_restaurants_restaurant_idx").on(t.restaurantId),
  ],
);

// ---------------------------------------------------------------------------
// Zonas de meseros (requisito del enunciado)
//
// Una configuración reparte las mesas de un restaurante entre N meseros
// («2 meseros», «3 meseros»…). Cada restaurante guarda varias y UNA está
// activa: la que se usa ahora (cambiar de una a otra es un toque). Cada zona
// tiene un mesero (nombre o número) y un color; cada mesa está, como mucho,
// en una zona de cada configuración.
//
// Lo crean y cambian el admin y el propio restaurante (`meseros:gestionar`);
// analítica solo lo ve en el plano en vivo.
// ---------------------------------------------------------------------------

export const waiterConfigs = sqliteTable(
  "waiter_configs",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    waiterCount: integer("waiter_count").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Bloqueo optimista: dos tablets editando la misma configuración. */
    version: integer("version").notNull().default(1),
    /**
     * Marca del último guardado (un UUID). El guardado va en un solo batch y
     * cada sentencia comprueba que la marca sea la SUYA: si otra tablet ganó
     * la versión, las sentencias del que perdió no tocan nada.
     */
    saveToken: text("save_token"),
    /** Configuraciones de ejemplo de los datos de demostración. */
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    demoBatchId: text("demo_batch_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("waiter_configs_restaurant_idx").on(t.restaurantId),
    // Una sola activa por restaurante, como la zona por defecto.
    uniqueIndex("waiter_configs_one_active_idx")
      .on(t.restaurantId)
      .where(sql`${t.isActive} = 1`),
  ],
);

export const waiterZones = sqliteTable(
  "waiter_zones",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => waiterConfigs.id, { onDelete: "cascade" }),
    /** 1..N: el orden de los meseros en la configuración. */
    position: integer("position").notNull(),
    waiterName: text("waiter_name").notNull(),
    /** Color de la zona en el plano (#rrggbb). */
    color: text("color").notNull(),
  },
  (t) => [index("waiter_zones_config_idx").on(t.configId)],
);

export const waiterZoneTables = sqliteTable(
  "waiter_zone_tables",
  {
    configId: text("config_id")
      .notNull()
      .references(() => waiterConfigs.id, { onDelete: "cascade" }),
    // Si se borra la mesa (editor), sale de las zonas sola.
    tableId: text("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    zoneId: text("zone_id")
      .notNull()
      .references(() => waiterZones.id, { onDelete: "cascade" }),
  },
  (t) => [
    // Una mesa, una zona por configuración.
    primaryKey({ columns: [t.configId, t.tableId] }),
    index("waiter_zone_tables_zone_idx").on(t.zoneId),
  ],
);

// ---------------------------------------------------------------------------
// Modo offline: operaciones ya aplicadas
//
// Cuando una tablet trabaja sin Internet, guarda sus cambios en una cola local
// y los manda al volver la conexión, cada uno con su `operationId`. Si el ack
// se pierde y la tablet lo reenvía, el servidor tiene que reconocerlo y
// devolver la MISMA respuesta sin aplicarlo dos veces (dos clientes iguales,
// o un «ya fue atendido» falso). Esta tabla es esa memoria: no depende del
// proceso, así que sobrevive a un reinicio del servidor.
//
// Sin FK a propósito: es un registro técnico, y borrar un restaurante o un
// usuario no tiene por qué fallar por él. Las filas viejas se purgan solas.
// ---------------------------------------------------------------------------

export const offlineOperations = sqliteTable(
  "offline_operations",
  {
    /** UUID que generó la tablet para esa operación. */
    operationId: text("operation_id").primaryKey(),
    restaurantId: text("restaurant_id").notNull(),
    userId: text("user_id"),
    /** El evento: `waitlist:add`, `table:assign`... */
    action: text("action").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    /** El ack que se devolvió, en JSON, para repetirlo tal cual. */
    response: text("response").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("offline_operations_created_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// Relaciones (para el API `db.query.*`)
// ---------------------------------------------------------------------------

export const brandsRelations = relations(brands, ({ many }) => ({
  restaurants: many(restaurants),
}));

export const restaurantsRelations = relations(restaurants, ({ one, many }) => ({
  brand: one(brands, { fields: [restaurants.brandId], references: [brands.id] }),
  layouts: many(tableLayouts),
  tables: many(tables),
  waitlistEntries: many(waitlistEntries),
  users: many(user),
}));

export const tableLayoutsRelations = relations(tableLayouts, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [tableLayouts.restaurantId],
    references: [restaurants.id],
  }),
  tables: many(tables),
}));

export const elementTypesRelations = relations(elementTypes, ({ many }) => ({
  tables: many(tables),
}));

export const tablesRelations = relations(tables, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [tables.restaurantId],
    references: [restaurants.id],
  }),
  layout: one(tableLayouts, {
    fields: [tables.layoutId],
    references: [tableLayouts.id],
  }),
  elementType: one(elementTypes, {
    fields: [tables.elementTypeId],
    references: [elementTypes.id],
  }),
  /** Cliente sentado ahora mismo (puntero `currentEntryId`). */
  currentEntry: one(waitlistEntries, {
    fields: [tables.currentEntryId],
    references: [waitlistEntries.id],
    relationName: "currentEntry",
  }),
  /** Histórico: todos los clientes que han pasado por esta mesa. */
  assignments: many(waitlistEntries, { relationName: "assignedTable" }),
}));

export const waitlistEntriesRelations = relations(waitlistEntries, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [waitlistEntries.restaurantId],
    references: [restaurants.id],
  }),
  assignedTable: one(tables, {
    fields: [waitlistEntries.assignedTableId],
    references: [tables.id],
    relationName: "assignedTable",
  }),
}));

export const userRelations = relations(user, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [user.restaurantId],
    references: [restaurants.id],
  }),
  sessions: many(session),
  accounts: many(account),
  roles: many(userRoles),
  restaurants: many(userRestaurants),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(user, { fields: [userRoles.userId], references: [user.id] }),
}));

export const userRestaurantsRelations = relations(userRestaurants, ({ one }) => ({
  user: one(user, { fields: [userRestaurants.userId], references: [user.id] }),
  restaurant: one(restaurants, {
    fields: [userRestaurants.restaurantId],
    references: [restaurants.id],
  }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));
