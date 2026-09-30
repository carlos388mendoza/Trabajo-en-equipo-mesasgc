"use client";

// Marcas y restaurantes de /admin: crear, editar y desactivar.
//
// Todo pasa por las actions de `app/admin/catalog-actions.ts`, que vuelven a
// comprobar el permiso y validan con Zod. Nada se borra: desactivar saca al
// restaurante (o a la marca) de la operación, pero su historial sigue en las
// estadísticas. Desactivar pide confirmación.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, LayoutGrid, MapPin, Palette, Pencil, Plus, Power, PowerOff, Store, Zap } from "lucide-react";

import type { AdminResult } from "@/app/admin/actions";
import {
  createBrandAction,
  createRestaurantAction,
  setBrandActiveAction,
  setRestaurantActiveAction,
  updateBrandAction,
  updateRestaurantAction,
} from "@/app/admin/catalog-actions";
import { Button, ConfirmDialog, FormButtons } from "@/components/admin/ui";
import { ICON_STROKE } from "@/components/editor/icons";
import type { AdminBrand, AdminRestaurant } from "@/lib/layout/catalog-admin";

type CityOption = { name: string; lat: number; lng: number };

type Props = {
  brands: AdminBrand[];
  restaurants: AdminRestaurant[];
  cities: CityOption[];
  bounds: { south: number; north: number; west: number; east: number };
};

const INPUT = "mt-1 h-11 w-full rounded-xl border border-app-border bg-panel px-3 text-sm text-panel-text";

type Editing =
  | { kind: "marca"; brand: AdminBrand | null }
  | { kind: "restaurante"; restaurant: AdminRestaurant | null }
  | null;

type Confirming = { kind: "marca"; brand: AdminBrand } | { kind: "restaurante"; restaurant: AdminRestaurant } | null;

export function AdminCatalog({ brands, restaurants, cities, bounds }: Props) {
  const [feedback, setFeedback] = useState<AdminResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Editing>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const brandById = useMemo(() => new Map(brands.map((b) => [b.id, b])), [brands]);

  const submit = (work: () => Promise<AdminResult>, onOk?: () => void) => {
    startTransition(async () => {
      const result = await work();
      setFeedback(result);
      if (result.ok) onOk?.();
    });
  };

  // Restaurantes agrupados por marca, los de marca desactivada o sin marca al final.
  const groups = useMemo(() => {
    const byBrand = new Map<string, AdminRestaurant[]>();
    for (const r of restaurants) {
      const key = r.brandId ?? "";
      byBrand.set(key, [...(byBrand.get(key) ?? []), r]);
    }
    return [...byBrand.entries()]
      .map(([brandId, list]) => ({ brand: brandById.get(brandId) ?? null, list }))
      .sort((a, b) => (a.brand?.name ?? "~").localeCompare(b.brand?.name ?? "~", "es"));
  }, [restaurants, brandById]);

  return (
    <section className="space-y-5 rounded-2xl border border-app-border bg-panel p-5 text-panel-text shadow-sm" aria-labelledby="catalogo-titulo">
      <div>
        <h2 id="catalogo-titulo" className="text-lg font-semibold">Marcas y restaurantes</h2>
        <p className="text-sm text-panel-muted">
          Un restaurante nuevo sale de inmediato en el mapa, en las estadísticas y en los accesos de los usuarios, con una
          zona vacía para dibujar su plano. Desactivar no borra nada.
        </p>
      </div>

      {feedback ? (
        <p
          role="status"
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
            feedback.ok ? "bg-estado-libre/10 text-estado-libre" : "bg-estado-ocupada/10 text-estado-ocupada"
          }`}
        >
          {feedback.ok ? <CircleCheck aria-hidden size={18} strokeWidth={ICON_STROKE} /> : <CircleAlert aria-hidden size={18} strokeWidth={ICON_STROKE} />}
          {feedback.ok ? feedback.message : feedback.error}
        </p>
      ) : null}

      {/* Marcas */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Marcas</h3>
          <Button icon={Plus} onClick={() => setEditing({ kind: "marca", brand: null })}>
            Nueva marca
          </Button>
        </div>
        {editing?.kind === "marca" && editing.brand === null ? (
          <BrandForm
            pending={pending}
            onCancel={() => setEditing(null)}
            onSubmit={(data) => submit(() => createBrandAction(data), () => setEditing(null))}
          />
        ) : null}
        <ul className="grid gap-2 sm:grid-cols-2">
          {brands.map((b) => (
            <li key={b.id} className="rounded-xl border border-app-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="h-4 w-4 shrink-0 rounded-full ring-1 ring-app-border" style={{ backgroundColor: b.accentColor }} />
                  <span className="truncate font-medium">{b.name}</span>
                  <span className="text-xs text-panel-muted">
                    {b.restaurants} {b.restaurants === 1 ? "restaurante" : "restaurantes"}
                  </span>
                  <StatusTag active={b.active} female />
                </span>
                <span className="flex gap-1">
                  <Button icon={Pencil} onClick={() => setEditing({ kind: "marca", brand: b })}>
                    Editar
                  </Button>
                  {b.active ? (
                    <Button icon={PowerOff} danger disabled={pending} onClick={() => setConfirming({ kind: "marca", brand: b })}>
                      Desactivar
                    </Button>
                  ) : (
                    <Button icon={Power} disabled={pending} onClick={() => submit(() => setBrandActiveAction({ id: b.id, active: true }))}>
                      Activar
                    </Button>
                  )}
                </span>
              </div>
              {editing?.kind === "marca" && editing.brand?.id === b.id ? (
                <BrandForm
                  brand={b}
                  pending={pending}
                  onCancel={() => setEditing(null)}
                  onSubmit={(data) => submit(() => updateBrandAction({ id: b.id, ...data }), () => setEditing(null))}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {/* Restaurantes */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Restaurantes</h3>
          <Button icon={Plus} onClick={() => setEditing({ kind: "restaurante", restaurant: null })} disabled={!brands.some((b) => b.active)}>
            Nuevo restaurante
          </Button>
        </div>
        {editing?.kind === "restaurante" && editing.restaurant === null ? (
          <RestaurantForm
            brands={brands}
            cities={cities}
            bounds={bounds}
            pending={pending}
            onCancel={() => setEditing(null)}
            onSubmit={(data) => submit(() => createRestaurantAction(data), () => setEditing(null))}
          />
        ) : null}
        {groups.map(({ brand, list }) => (
          <div key={brand?.id ?? "sin-marca"} className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-panel-muted">
              <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: brand?.accentColor ?? "#94a3b8" }} />
              {brand?.name ?? "Sin marca"}
            </p>
            <ul className="space-y-2">
              {list.map((r) => (
                <li key={r.id} className={`rounded-xl border border-app-border p-3 ${r.active ? "" : "opacity-70"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <Store aria-hidden size={16} strokeWidth={ICON_STROKE} />
                        {r.name}
                        <StatusTag active={r.active} />
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-panel-muted">
                        <span>{r.city ?? "Sin ciudad"}</span>
                        <span className="flex items-center gap-1">
                          <MapPin aria-hidden size={12} />
                          {r.latitude !== null && r.longitude !== null ? `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}` : "sin ubicación"}
                        </span>
                        <span>
                          {r.zones} {r.zones === 1 ? "zona" : "zonas"}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Link href={`/restaurante/${r.id}/rapido`} className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium hover:bg-app-border/60">
                        <Zap aria-hidden size={16} strokeWidth={ICON_STROKE} />
                        Modo sencillo
                      </Link>
                      <Link href={`/restaurante/${r.id}/editor`} className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium hover:bg-app-border/60">
                        <LayoutGrid aria-hidden size={16} strokeWidth={ICON_STROKE} />
                        Plano
                      </Link>
                      <Button icon={Pencil} onClick={() => setEditing({ kind: "restaurante", restaurant: r })}>
                        Editar
                      </Button>
                      {r.active ? (
                        <Button icon={PowerOff} danger disabled={pending} onClick={() => setConfirming({ kind: "restaurante", restaurant: r })}>
                          Desactivar
                        </Button>
                      ) : (
                        <Button icon={Power} disabled={pending} onClick={() => submit(() => setRestaurantActiveAction({ id: r.id, active: true }))}>
                          Activar
                        </Button>
                      )}
                    </div>
                  </div>
                  {editing?.kind === "restaurante" && editing.restaurant?.id === r.id ? (
                    <RestaurantForm
                      restaurant={r}
                      brands={brands}
                      cities={cities}
                      bounds={bounds}
                      pending={pending}
                      onCancel={() => setEditing(null)}
                      onSubmit={(data) => submit(() => updateRestaurantAction({ id: r.id, ...data }), () => setEditing(null))}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {confirming?.kind === "restaurante" ? (
        <ConfirmDialog
          title={`¿Desactivar «${confirming.restaurant.name}»?`}
          danger
          pending={pending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const target = confirming.restaurant;
            setConfirming(null);
            submit(() => setRestaurantActiveAction({ id: target.id, active: false }));
          }}
        >
          <p>
            Sus usuarios de restaurante dejarán de verlo y saldrá del mapa general. No se borra nada: su plano, su lista de
            espera y su historial se conservan, y sus estadísticas siguen visibles. Puedes volver a activarlo cuando quieras.
          </p>
        </ConfirmDialog>
      ) : null}
      {confirming?.kind === "marca" ? (
        <ConfirmDialog
          title={`¿Desactivar la marca «${confirming.brand.name}»?`}
          danger
          pending={pending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const target = confirming.brand;
            setConfirming(null);
            submit(() => setBrandActiveAction({ id: target.id, active: false }));
          }}
        >
          <p>
            Ya no se podrá elegir para restaurantes nuevos. Sus {confirming.brand.restaurants} restaurantes no cambian: para
            sacarlos de la operación, desactívalos uno por uno.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function StatusTag({ active, female }: { active: boolean; female?: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${active ? "bg-estado-libre/15 text-estado-libre" : "bg-estado-reservada/15 text-estado-reservada"}`}>
      {active ? (female ? "Activa" : "Activo") : female ? "Desactivada" : "Desactivado"}
    </span>
  );
}

function BrandForm({
  brand,
  pending,
  onCancel,
  onSubmit,
}: {
  brand?: AdminBrand;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (data: { name: string; accentColor: string }) => void;
}) {
  const [name, setName] = useState(brand?.name ?? "");
  const [accentColor, setAccentColor] = useState(brand?.accentColor ?? "#0ea5e9");
  return (
    <form
      className="mt-3 space-y-3 rounded-xl border border-accent/40 bg-accent/5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, accentColor });
      }}
    >
      <p className="font-semibold">{brand ? `Editar ${brand.name}` : "Nueva marca"}</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="text-sm font-medium">
          Nombre
          <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={INPUT} />
        </label>
        <label className="text-sm font-medium">
          <span className="flex items-center gap-1">
            <Palette aria-hidden size={14} /> Color
          </span>
          <span className="mt-1 flex gap-2">
            <input type="color" aria-label="Elegir color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-11 w-14 rounded-xl border border-app-border bg-panel p-1" />
            <input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} pattern="#[0-9a-fA-F]{6}" aria-label="Color en #rrggbb" className={`${INPUT} mt-0 w-28 font-mono`} />
          </span>
        </label>
      </div>
      <FormButtons pending={pending} onCancel={onCancel} submitLabel={brand ? "Guardar marca" : "Crear marca"} />
    </form>
  );
}

function RestaurantForm({
  restaurant,
  brands,
  cities,
  bounds,
  pending,
  onCancel,
  onSubmit,
}: {
  restaurant?: AdminRestaurant;
  brands: AdminBrand[];
  cities: CityOption[];
  bounds: Props["bounds"];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (data: { name: string; brandId: string; city: string; latitude: number; longitude: number }) => void;
}) {
  // Se ofrecen las marcas activas y, al editar, también la que ya tiene.
  const options = brands.filter((b) => b.active || b.id === restaurant?.brandId);
  const [name, setName] = useState(restaurant?.name ?? "");
  const [brandId, setBrandId] = useState(restaurant?.brandId ?? options[0]?.id ?? "");
  const [city, setCity] = useState(restaurant?.city ?? "");
  const [latitude, setLatitude] = useState(restaurant?.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(restaurant?.longitude?.toString() ?? "");

  return (
    <form
      className="mt-3 space-y-3 rounded-xl border border-accent/40 bg-accent/5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, brandId, city, latitude: Number(latitude), longitude: Number(longitude) });
      }}
    >
      <p className="font-semibold">{restaurant ? `Editar ${restaurant.name}` : "Nuevo restaurante"}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Nombre
          <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={INPUT} placeholder="Denny's Plaza Miraflores" />
        </label>
        <label className="text-sm font-medium">
          Marca
          <select required value={brandId} onChange={(e) => setBrandId(e.target.value)} className={INPUT}>
            {options.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.active ? "" : " (desactivada)"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="space-y-3 rounded-xl border border-app-border p-3">
        <legend className="px-1 text-sm font-medium">Ubicación</legend>
        <label className="block text-sm font-medium">
          Elegir una ciudad del mapa (rellena la ciudad, la latitud y la longitud)
          <select
            value=""
            onChange={(e) => {
              const picked = cities.find((c) => c.name === e.target.value);
              if (!picked) return;
              setCity(picked.name);
              setLatitude(picked.lat.toFixed(4));
              setLongitude(picked.lng.toFixed(4));
            }}
            className={INPUT}
          >
            <option value="">— Elegir ciudad —</option>
            {cities.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium">
            Ciudad
            <input required value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} className={INPUT} />
          </label>
          <label className="text-sm font-medium">
            Latitud
            <input required type="number" step="0.0001" min={bounds.south} max={bounds.north} value={latitude} onChange={(e) => setLatitude(e.target.value)} className={`${INPUT} font-mono`} placeholder="14.0723" />
          </label>
          <label className="text-sm font-medium">
            Longitud
            <input required type="number" step="0.0001" min={bounds.west} max={bounds.east} value={longitude} onChange={(e) => setLongitude(e.target.value)} className={`${INPUT} font-mono`} placeholder="-87.1921" />
          </label>
        </div>
        <p className="text-xs text-panel-muted">
          Grados decimales, dentro de Honduras (latitud {bounds.south} a {bounds.north}, longitud {bounds.west} a {bounds.east}). Para
          afinar, copia las coordenadas del local desde un mapa.
        </p>
      </fieldset>
      <FormButtons pending={pending} onCancel={onCancel} submitLabel={restaurant ? "Guardar restaurante" : "Crear restaurante"} />
    </form>
  );
}
