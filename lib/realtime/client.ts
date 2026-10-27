// Cliente de tiempo real por HTTP, con la misma forma que el socket de antes
// (`on`, `emit`, `timeout(ms).emitWithAck`, `connected`, «connect» y
// «disconnect»), para que las pantallas y la cola sin conexión no cambien.
//
// Por qué no WebSockets: en Vercel no hay un servidor propio que guarde rooms
// en memoria, las conexiones se cortan a los 300 s y puede haber varias
// instancias. En su lugar:
//   - cada acción es un POST a `/api/tiempo-real` (la respuesta es el «ack»);
//   - los avisos de las demás pantallas se guardan en la base y este cliente
//     pregunta cada `fastMs` (2 s) con la pestaña visible, y cada `slowMs`
//     (15 s) en segundo plano: «¿qué hay después del aviso N?».
//
// Reconexión: si una pregunta falla, pasa a «disconnect» y reintenta cada
// vez más espaciado (2, 4, 8, 15 s). Cuando vuelve, avisa «connect» otra vez:
// las pantallas vuelven a entrar en su restaurante y recargan el estado. Lo
// mismo si el servidor dice `reset` (estuvo más de 10 min sin preguntar y se
// perdió avisos).
//
// Funciona en el navegador y en Node (las pruebas le pasan `baseUrl` y la
// cookie de sesión).

import type { ClientToServerEvents, ServerToClientEvents } from "./events";

type Listener = (...args: never[]) => void;
type AckCallback = (err: Error | null, res?: unknown) => void;

/** El tipo de la respuesta de cada evento, sacado de `ClientToServerEvents`. */
type EventName = keyof ClientToServerEvents;
type AckOf<E extends EventName> = ClientToServerEvents[E] extends (payload: never, ack: (res: infer R) => void) => void ? R : never;
type PayloadOf<E extends EventName> = Parameters<ClientToServerEvents[E]>[0];

export type RealtimeClientOptions = {
  /** Vacío = el mismo origen que la página. */
  baseUrl?: string;
  /** Cabeceras extra (las pruebas mandan la cookie así). */
  headers?: Record<string, string>;
  /** Cada cuánto pregunta con la pantalla visible. */
  fastMs?: number;
  /** Cada cuánto pregunta en segundo plano. */
  slowMs?: number;
  /** Tope del reintento tras un fallo. */
  maxBackoffMs?: number;
};

type SystemEvents = { connect: () => void; disconnect: () => void; connect_error: (err: Error) => void };
type AllEvents = ServerToClientEvents & SystemEvents;

const ENDPOINT = "/api/tiempo-real";

export class RealtimeClient {
  connected = false;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fastMs: number;
  private readonly slowMs: number;
  private readonly maxBackoffMs: number;
  private readonly listeners = new Map<string, Set<Listener>>();
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private cursor: number | null = null;
  private restaurantId: string | null = null;
  private overview = false;
  private polling = false;
  private readonly onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") this.schedule(0);
  };

  constructor(options: RealtimeClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.headers = options.headers ?? {};
    this.fastMs = options.fastMs ?? 2_000;
    this.slowMs = options.slowMs ?? 15_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 15_000;
  }

  on<E extends keyof AllEvents>(event: E, listener: AllEvents[E]): this {
    let set = this.listeners.get(event as string);
    if (!set) this.listeners.set(event as string, (set = new Set()));
    set.add(listener as Listener);
    return this;
  }

  off<E extends keyof AllEvents>(event: E, listener?: AllEvents[E]): this {
    if (!listener) this.listeners.delete(event as string);
    else this.listeners.get(event as string)?.delete(listener as Listener);
    return this;
  }

  once<E extends keyof AllEvents>(event: E, listener: AllEvents[E]): this {
    const wrapped = ((...args: never[]) => {
      this.off(event, wrapped as AllEvents[E]);
      (listener as Listener)(...args);
    }) as AllEvents[E];
    return this.on(event, wrapped);
  }

  private fire(event: string, args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        (listener as (...a: unknown[]) => void)(...args);
      } catch (err) {
        console.error(err);
      }
    }
  }

  /** Empieza: comprueba la sesión y, si va bien, avisa «connect». */
  connect(): this {
    if (this.active) return this;
    this.active = true;
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisible);
    this.schedule(0);
    return this;
  }

  /** Deja de preguntar. Las pantallas lo llaman al desmontarse o sin red. */
  disconnect(): this {
    if (!this.active) return this;
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisible);
    const was = this.connected;
    this.connected = false;
    this.failures = 0;
    if (was) this.fire("disconnect", []);
    return this;
  }

  close(): this {
    return this.disconnect();
  }

  private schedule(ms: number): void {
    if (!this.active) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), ms);
  }

  private nextDelay(): number {
    if (this.failures > 0) return Math.min(this.maxBackoffMs, this.fastMs * 2 ** (this.failures - 1));
    const hidden = typeof document !== "undefined" && document.visibilityState !== "visible";
    return hidden ? this.slowMs : this.fastMs;
  }

  private async poll(): Promise<void> {
    if (!this.active || this.polling) return;
    this.polling = true;
    try {
      const params = new URLSearchParams();
      const listening = this.cursor !== null && (this.restaurantId !== null || this.overview);
      if (listening) {
        params.set("desde", String(this.cursor));
        if (this.restaurantId) params.set("restaurante", this.restaurantId);
        if (this.overview) params.set("mapa", "1");
      }
      const response = await fetch(`${this.baseUrl}${ENDPOINT}?${params}`, { headers: this.headers, cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(response.status === 401 ? "No autorizado" : `HTTP ${response.status}`);
      const data = (await response.json()) as { events: { id: number; event: string; args: unknown[] }[]; cursor: number; reset: boolean };
      if (!this.active) return;
      const wasConnected = this.connected;
      this.failures = 0;
      if (!listening && this.cursor === null) this.cursor = data.cursor;
      if (!wasConnected || data.reset) {
        // Primera vez, vuelta tras una caída, o avisos perdidos: las pantallas
        // vuelven a entrar y recargan (su «connect» lo hace).
        // Lo perdido no se repasa aviso por aviso: la pantalla recarga entero.
        this.cursor = data.cursor;
        this.connected = true;
        this.fire("connect", []);
      } else {
        for (const { event, args } of data.events) this.fire(event, args);
        if (listening) this.cursor = data.cursor;
      }
    } catch (err) {
      this.failures += 1;
      if (this.connected) {
        this.connected = false;
        this.fire("disconnect", []);
      }
      this.fire("connect_error", [err instanceof Error ? err : new Error(String(err))]);
    } finally {
      this.polling = false;
      this.schedule(this.nextDelay());
    }
  }

  /** Manda un evento y espera la respuesta del servidor (o falla a los `ms`). */
  private async request(event: string, payload: unknown, ms: number | null): Promise<unknown> {
    const controller = new AbortController();
    const timer = ms === null ? null : setTimeout(() => controller.abort(), ms);
    try {
      const response = await fetch(`${this.baseUrl}${ENDPOINT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify({ event, payload, restaurantId: this.restaurantId }),
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(response.status === 401 ? "No autorizado" : `HTTP ${response.status}`);
      const data = (await response.json()) as { ack: { ok: boolean }; self?: { event: string; args: unknown[] }[]; cursor?: number };
      if (data.ack.ok && typeof data.cursor === "number") {
        // Entró en una sala: escucha desde el momento de entrar (el cursor se
        // tomó antes de leer el estado, así que no se pierde nada).
        if (event === "restaurant:join") this.restaurantId = (payload as { restaurantId: string }).restaurantId;
        if (event === "overview:join") this.overview = true;
        this.cursor = data.cursor;
      }
      for (const notice of data.self ?? []) this.fire(notice.event, notice.args);
      return data.ack;
    } catch (err) {
      if (controller.signal.aborted) throw new Error("operation has timed out");
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  emit<E extends EventName>(event: E, payload: PayloadOf<E>, ack?: (res: AckOf<E>) => void): this {
    this.request(event, payload, null).then((res) => ack?.(res as AckOf<E>), () => undefined);
    return this;
  }

  emitWithAck<E extends EventName>(event: E, payload: PayloadOf<E>): Promise<AckOf<E>> {
    return this.request(event, payload, null) as Promise<AckOf<E>>;
  }

  /** Como en Socket.IO: `timeout(ms).emit(evento, datos, (err, res) => …)` o `.emitWithAck`. */
  timeout(ms: number) {
    return {
      emit: <E extends EventName>(event: E, payload: PayloadOf<E>, callback: AckCallback) => {
        this.request(event, payload, ms).then((res) => callback(null, res), (err: Error) => callback(err));
        return this;
      },
      emitWithAck: <E extends EventName>(event: E, payload: PayloadOf<E>): Promise<AckOf<E>> =>
        this.request(event, payload, ms) as Promise<AckOf<E>>,
    };
  }
}

/** Cliente del navegador, en el mismo origen. Arranca con `connect()`. */
export function createRealtimeClient(options?: RealtimeClientOptions): RealtimeClient {
  return new RealtimeClient(options);
}
