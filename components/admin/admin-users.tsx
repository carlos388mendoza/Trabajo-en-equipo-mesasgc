"use client";

// Gestión de usuarios de /admin: lista, alta, acceso, contraseña y estado.
//
// Todo lo que hace pasa por las server actions de `app/admin/actions.ts`, que
// vuelven a comprobar el permiso y validan con Zod. Lo que se desactiva aquí
// (por ejemplo, desactivarse a uno mismo) es solo una ayuda: la regla de
// verdad está en el servidor.

import { useState, useTransition } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Shuffle,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from "lucide-react";

import {
  type AdminResult,
  createUserAction,
  resetPasswordAction,
  setActiveAction,
  updateAccessAction,
} from "@/app/admin/actions";
import { ICON_STROKE } from "@/components/editor/icons";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import type { AuthUser } from "@/lib/auth/users";
import { ROLES, ROLE_VALUES, type Role } from "@/lib/db/enums";

type Restaurant = { id: string; name: string };

type Props = {
  users: AuthUser[];
  restaurants: Restaurant[];
  currentUserId: string;
  minPasswordLength: number;
};

const INPUT =
  "mt-1 h-11 w-full rounded-xl border border-app-border bg-panel px-3 text-sm text-panel-text";

/** Contraseña temporal aleatoria, legible: sin caracteres que se confundan. */
function randomPassword(length = 12): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function AdminUsers({ users, restaurants, currentUserId, minPasswordLength }: Props) {
  const [feedback, setFeedback] = useState<AdminResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{ id: string; mode: "access" | "password" } | null>(null);
  const restaurantName = new Map(restaurants.map((r) => [r.id, r.name]));

  const submit = (work: () => Promise<AdminResult>, onOk?: () => void) => {
    startTransition(async () => {
      const result = await work();
      setFeedback(result);
      if (result.ok) onOk?.();
    });
  };

  return (
    <section className="space-y-4 rounded-2xl border border-app-border bg-panel p-5 text-panel-text shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Usuarios</h2>
          <p className="text-sm text-panel-muted">{users.length} en total. No hay registro público.</p>
        </div>
        {!creating ? (
          <Button icon={UserPlus} onClick={() => setCreating(true)} primary>
            Nuevo usuario
          </Button>
        ) : null}
      </div>

      {feedback ? (
        <p
          role="status"
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
            feedback.ok ? "bg-estado-libre/10 text-estado-libre" : "bg-estado-ocupada/10 text-estado-ocupada"
          }`}
        >
          {feedback.ok ? (
            <CircleCheck aria-hidden size={18} strokeWidth={ICON_STROKE} />
          ) : (
            <CircleAlert aria-hidden size={18} strokeWidth={ICON_STROKE} />
          )}
          {feedback.ok ? feedback.message : feedback.error}
        </p>
      ) : null}

      {creating ? (
        <CreateUserForm
          restaurants={restaurants}
          minPasswordLength={minPasswordLength}
          pending={pending}
          onCancel={() => setCreating(false)}
          onSubmit={(data) => submit(() => createUserAction(data), () => setCreating(false))}
        />
      ) : null}

      <ul className="divide-y divide-app-border rounded-xl border border-app-border">
        {users.map((u) => {
          const isMe = u.id === currentUserId;
          const isEditing = editing?.id === u.id;
          return (
            <li key={u.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {u.name}
                    {isMe ? <span className="ml-2 text-xs font-normal text-panel-muted">(tú)</span> : null}
                  </p>
                  <p className="text-sm text-panel-muted">{u.email}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {u.roles.map((r) => (
                      <RoleTag key={r} role={r} />
                    ))}
                    {u.restaurantIds.map((id) => (
                      <span key={id} className="rounded-full border border-app-border px-2 py-0.5 text-xs text-panel-muted">
                        {restaurantName.get(id) ?? id}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      u.active ? "bg-estado-libre/15 text-estado-libre" : "bg-estado-reservada/15 text-estado-reservada"
                    }`}
                  >
                    {u.active ? "Activo" : "Desactivado"}
                  </span>
                  <Button icon={Pencil} onClick={() => setEditing({ id: u.id, mode: "access" })}>
                    Acceso
                  </Button>
                  <Button icon={KeyRound} onClick={() => setEditing({ id: u.id, mode: "password" })}>
                    Contraseña
                  </Button>
                  <Button
                    icon={u.active ? UserX : UserCheck}
                    disabled={pending || (isMe && u.active)}
                    title={isMe && u.active ? "No puedes desactivarte a ti mismo" : undefined}
                    danger={u.active}
                    onClick={() => submit(() => setActiveAction({ userId: u.id, active: !u.active }))}
                  >
                    {u.active ? "Desactivar" : "Activar"}
                  </Button>
                </div>
              </div>

              {isEditing && editing.mode === "access" ? (
                <AccessForm
                  user={u}
                  isMe={isMe}
                  restaurants={restaurants}
                  pending={pending}
                  onCancel={() => setEditing(null)}
                  onSubmit={(roles, restaurantIds) =>
                    submit(() => updateAccessAction({ userId: u.id, roles, restaurantIds }), () => setEditing(null))
                  }
                />
              ) : null}
              {isEditing && editing.mode === "password" ? (
                <PasswordForm
                  minPasswordLength={minPasswordLength}
                  pending={pending}
                  onCancel={() => setEditing(null)}
                  onSubmit={(password) =>
                    submit(() => resetPasswordAction({ userId: u.id, password }), () => setEditing(null))
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------

function CreateUserForm({
  restaurants,
  minPasswordLength,
  pending,
  onCancel,
  onSubmit,
}: {
  restaurants: Restaurant[];
  minPasswordLength: number;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (data: { name: string; email: string; password: string; roles: Role[]; restaurantIds: string[] }) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => randomPassword());
  const [roles, setRoles] = useState<Role[]>([ROLES.RESTAURANTE]);
  const [restaurantIds, setRestaurantIds] = useState<string[]>([]);

  return (
    <form
      className="space-y-4 rounded-xl border border-accent/40 bg-accent/5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, email, password, roles, restaurantIds });
      }}
    >
      <p className="font-semibold">Nuevo usuario</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Nombre
          <input required value={name} onChange={(e) => setName(e.target.value)} className={INPUT} maxLength={100} />
        </label>
        <label className="text-sm font-medium">
          Correo
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
        </label>
      </div>
      <PasswordField value={password} onChange={setPassword} minPasswordLength={minPasswordLength} label="Contraseña temporal" />
      <AccessPicker
        roles={roles}
        restaurantIds={restaurantIds}
        restaurants={restaurants}
        onRoles={setRoles}
        onRestaurants={setRestaurantIds}
      />
      <FormButtons pending={pending} onCancel={onCancel} submitLabel="Crear usuario" />
    </form>
  );
}

function AccessForm({
  user,
  isMe,
  restaurants,
  pending,
  onCancel,
  onSubmit,
}: {
  user: AuthUser;
  isMe: boolean;
  restaurants: Restaurant[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (roles: Role[], restaurantIds: string[]) => void;
}) {
  const [roles, setRoles] = useState<Role[]>(user.roles);
  const [restaurantIds, setRestaurantIds] = useState<string[]>(user.restaurantIds);
  return (
    <form
      className="mt-3 space-y-4 rounded-xl border border-app-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(roles, restaurantIds);
      }}
    >
      <AccessPicker
        roles={roles}
        restaurantIds={restaurantIds}
        restaurants={restaurants}
        lockedRoles={isMe ? [ROLES.ADMIN] : []}
        onRoles={setRoles}
        onRestaurants={setRestaurantIds}
      />
      <FormButtons pending={pending} onCancel={onCancel} submitLabel="Guardar acceso" />
    </form>
  );
}

function PasswordForm({
  minPasswordLength,
  pending,
  onCancel,
  onSubmit,
}: {
  minPasswordLength: number;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState(() => randomPassword());
  return (
    <form
      className="mt-3 space-y-4 rounded-xl border border-app-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(password);
      }}
    >
      <PasswordField value={password} onChange={setPassword} minPasswordLength={minPasswordLength} label="Nueva contraseña temporal" />
      <p className="text-xs text-panel-muted">Al guardarla se cierran las sesiones abiertas de este usuario.</p>
      <FormButtons pending={pending} onCancel={onCancel} submitLabel="Restablecer contraseña" />
    </form>
  );
}

// ---------------------------------------------------------------------------

function PasswordField({
  value,
  onChange,
  minPasswordLength,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  minPasswordLength: number;
  label: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block text-sm font-medium">
      {label}
      <span className="mt-1 flex gap-2">
        <input
          required
          minLength={minPasswordLength}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT} mt-0 font-mono`}
          autoComplete="new-password"
        />
        <IconButton icon={visible ? EyeOff : Eye} label={visible ? "Ocultar" : "Mostrar"} onClick={() => setVisible((v) => !v)} />
        <IconButton icon={Shuffle} label="Generar otra" onClick={() => onChange(randomPassword())} />
      </span>
      <span className="mt-1 block text-xs font-normal text-panel-muted">
        Mínimo {minPasswordLength} caracteres. Compártela por un canal seguro.
      </span>
    </label>
  );
}

function AccessPicker({
  roles,
  restaurantIds,
  restaurants,
  lockedRoles = [],
  onRoles,
  onRestaurants,
}: {
  roles: Role[];
  restaurantIds: string[];
  restaurants: Restaurant[];
  lockedRoles?: Role[];
  onRoles: (r: Role[]) => void;
  onRestaurants: (ids: string[]) => void;
}) {
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const needsRestaurants = roles.includes(ROLES.RESTAURANTE);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <fieldset>
        <legend className="text-sm font-medium">Roles</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {ROLE_VALUES.map((role) => {
            const locked = lockedRoles.includes(role);
            return (
              <label
                key={role}
                title={locked ? "No puedes quitarte tu propio rol de administrador" : undefined}
                className={`flex h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${
                  roles.includes(role) ? "border-accent bg-accent/10" : "border-app-border"
                } ${locked ? "cursor-not-allowed opacity-70" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  disabled={locked}
                  onChange={() => onRoles(toggle(roles, role))}
                />
                {ROLE_LABELS[role]}
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset disabled={!needsRestaurants}>
        <legend className="text-sm font-medium">Restaurantes</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {restaurants.map((r) => (
            <label
              key={r.id}
              className={`flex h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${
                needsRestaurants && restaurantIds.includes(r.id) ? "border-accent bg-accent/10" : "border-app-border"
              } ${needsRestaurants ? "" : "opacity-50"}`}
            >
              <input
                type="checkbox"
                checked={needsRestaurants && restaurantIds.includes(r.id)}
                onChange={() => onRestaurants(toggle(restaurantIds, r.id))}
              />
              {r.name}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-panel-muted">
          {needsRestaurants
            ? "Solo verá y editará estos restaurantes."
            : "Solo se usan con el rol Restaurante. Admin y Analítica ven todos."}
        </p>
      </fieldset>
    </div>
  );
}

function RoleTag({ role }: { role: Role }) {
  return (
    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">{ROLE_LABELS[role]}</span>
  );
}

function FormButtons({ pending, onCancel, submitLabel }: { pending: boolean; onCancel: () => void; submitLabel: string }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button icon={X} onClick={onCancel} disabled={pending}>
        Cancelar
      </Button>
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-text hover:bg-accent/85 disabled:opacity-60"
      >
        {pending ? "Guardando…" : submitLabel}
      </button>
    </div>
  );
}

function Button({
  icon: Icon,
  children,
  onClick,
  disabled,
  title,
  primary,
  danger,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
  danger?: boolean;
}) {
  const tone = primary
    ? "bg-accent text-accent-text hover:bg-accent/85"
    : danger
      ? "text-estado-ocupada hover:bg-estado-ocupada/10"
      : "text-panel-text hover:bg-app-border/60";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
    >
      <Icon aria-hidden size={18} strokeWidth={ICON_STROKE} />
      {children}
    </button>
  );
}

function IconButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-app-border hover:bg-app-border/60"
    >
      <Icon aria-hidden size={18} strokeWidth={ICON_STROKE} />
    </button>
  );
}
