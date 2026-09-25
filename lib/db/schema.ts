// Esquema inicial de la base de datos (Drizzle ORM + Turso)
// TODO (Ambos): revisar y ajustar juntos antes de generar la migración

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const restaurants = sqliteTable("restaurants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

// Mesas y otros elementos del layout (baños, cajas, áreas de juego, etc.)
export const tables = sqliteTable("tables", {
  id: text("id").primaryKey(),
  restaurantId: text("restaurant_id").notNull(),
  type: text("type").notNull(), // "mesa-sillas" | "mesa-butacas" | "area-juegos" | "bano" | "caja"
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  rotation: integer("rotation").default(0),
  layoutVersion: integer("layout_version").default(1),
});

export const waitlistEntries = sqliteTable("waitlist_entries", {
  id: text("id").primaryKey(),
  restaurantId: text("restaurant_id").notNull(),
  customerName: text("customer_name").notNull(),
  status: text("status").notNull(), // "esperando" | "listo" | "ausente"
  arrivedAt: integer("arrived_at").notNull(),
  seatedAt: integer("seated_at"),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(), // "admin" | "restaurante" | "analitica"
  restaurantId: text("restaurant_id"), // null si es admin o analítica
});
