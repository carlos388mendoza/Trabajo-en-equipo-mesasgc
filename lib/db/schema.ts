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
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { ROLES, TABLE_STATUSES, WAITLIST_STATUSES } from "./enums";

// ---------------------------------------------------------------------------
// Restaurants
// ---------------------------------------------------------------------------

export const restaurants = sqliteTable("restaurants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Identificador legible en la URL; único para no tener dos "restaurante/1". */
  slug: text("slug").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

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
  ],
);

// ---------------------------------------------------------------------------
// Better Auth
//
// Estas cuatro tablas son las que Better Auth espera (nombres y columnas
// exactos). La app las declara a mano para controlar los tipos de Drizzle y
// los campos propios, en vez de dejar que las genere su CLI.
//
// `role` y `restaurantId` son columnas de `user`, NO una tabla `roles`: el
// conjunto son tres valores cerrados, así que una tabla solo añadiría un join
// en cada verificación de permisos sin ganar nada. Si más adelante hacen falta
// roles configurables por restaurante, se migra sin romper nada porque la
// columna ya está.
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
    // `role` es una de ROLES. `restaurantId` es null para ADMIN y ANALITICA, y
    // obligatorio para RESTAURANTE (lo valida el servidor, no el navegador).
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
// Relaciones (para el API `db.query.*`)
// ---------------------------------------------------------------------------

export const restaurantsRelations = relations(restaurants, ({ many }) => ({
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
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));
