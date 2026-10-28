// Cliente de tiempo real por HTTP, con la misma forma que el socket de antes
// (`on`, `emit`, `timeout(ms).emitWithAck`, `connected`, «connect» y
// «disconnect»), para que las pantallas y la cola sin conexión no cambien.
//
// Por qué no WebSockets: en Vercel no hay un servidor propio que guarde rooms
// en memoria, las conexiones se cortan a los 300 s y puede haber varias
// instancias. En su lugar:
//   - cada acción es un POST a `/api/tiempo-real` (la respuesta es el «ack»);
//   - los avisos de las demás pantallas se guardan en la base y este cliente
//     pregunta cada `fastMs` (2 s) con la pestaña visible: «¿qué hay después
//     del aviso N?». Para gastar menos (cada pregunta son ~10 consultas):
//       · con la pestaña oculta o la pantalla bloqueada NO pregunta; al volver
//         pregunta al instante y, si estuvo oculta `resyncAfterHiddenMs` (1 min)
//         o más, recarga el estado completo (avisa «connect» como tras una caída);
//       · sin actividad se espacia poco a poco: tras `quietAfter` (15) vueltas
//         seguidas sin avisos suma `quietStepMs` (1 s) por vuelta hasta `slowMs`
//         (15 s). Vuelve a `fastMs` al llegar un aviso remoto o al hacer algo
//         aquí (cualquier POST).
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
  /** Lo más espaciado que llega a preguntar cuando no pasa nada (sin actividad). */
  slowMs?: number;
  /** Vueltas seguidas sin avisos antes de empezar a espaciar. */
  quietAfter?: number;
  /** Cuánto se suma a la espera por cada vuelta tranquila más. */
  quietStepMs?: number;
  /** Tras estar oculta tanto tiempo (o más), al volver recarga el estado completo. */
  resyncAfterHiddenMs?: number;
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
  private readonly quietAfter: number;
  private readonly quietStepMs: number;
  private readonly resyncAfterHiddenMs: number;
  private quietPolls = 0;
  private hiddenSince: number | null = null;
  private forceResync = false;
  private readonly listeners = new Map<string, Set<Listener>>();
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private cursor: number | null = null;
  private restaurantId: string | null = null;
  private overview = false;
  private polling = false;
  private readonly onVisible = () => {
    if (typeof document === "undefined" || !this.active) return;
    if (document.visibilityState === "visible") {
      if (this.hiddenSince !== null && Date.now() - this.hiddenSince >= this.resyncAfterHiddenMs) this.forceResync = true;
      this.hiddenSince = null;
      this.quietPolls = 0;
      this.schedule(0);
    } else {
      // Oculta o bloqueada: se deja de preguntar hasta que vuelva.
      if (this.hiddenSince === null) this.hiddenSince = Date.now();
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    }
  };

  constructor(options: RealtimeClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.headers = options.headers ?? {};
    this.fastMs = options.fastMs ?? 2_000;
    this.slowMs = options.slowMs ?? 15_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 15_000;
    this.quietAfter = options.quietAfter ?? 15;
    this.quietStepMs = options.quietStepMs ?? 1_000;
    this.resyncAfterHiddenMs = options.resyncAfterHiddenMs ?? 60_000;
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
    this.quietPolls = 0;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisible);
      if (document.visibilityState !== "visible") {
        this.hiddenSince = Date.now();
        return this;
      }
    }
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

  /** Cuánto esperar para la próxima pregunta; `null` = no preguntar (pantalla oculta). */
  private nextDelay(): number | null {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return null;
    if (this.failures > 0) return Math.min(this.maxBackoffMs, this.fastMs * 2 ** (this.failures - 1));
    const extra = Math.max(0, this.quietPolls - this.quietAfter) * this.quietStepMs;
    return Math.min(Math.max(this.slowMs, this.fastMs), this.fastMs + extra);
  }

  /** Algo pasó aquí (un POST): vuelve al ritmo rápido y pregunta pronto. */
  private noteActivity(): void {
    this.quietPolls = 0;
    if (this.active && this.connected && !this.polling && this.timer && this.nextDelay() !== null) this.schedule(this.fastMs);
  }

  private async poll(): Promise<void> {
    if (!this.active || this.polling) return;
    this.polling = true;
    // Se guardan los valores con los que se preguntó, para descartar la
    // respuesta si la pantalla cambió de restaurante/mapa mientras estaba
    // en vuelo (evita mezclar avisos del primero con el segundo).
    const askedRestaurant = this.restaurantId;
    const askedOverview = this.overview;
    const askedCursor = this.cursor;
    try {
      const params = new URLSearchParams();
      const listening = askedCursor !== null && (askedRestaurant !== null || askedOverview);
      if (listening) {
        params.set("desde", String(askedCursor));
        if (askedRestaurant) params.set("restaurante", askedRestaurant);
        if (askedOverview) params.set("mapa", "1");
      }
      const response = await fetch(`${this.baseUrl}${ENDPOINT}?${params}`, { headers: this.headers, cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        if (this.restaurantId === askedRestaurant && this.overview === askedOverview && this.active) {
          this.failures += 1;
          if (this.connected) { this.connected = false; this.fire("disconnect", []); }
          this.fire("connect_error", [new Error("No autorizado")]);
        }
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { events: { id: number; event: string; args: unknown[] }[]; cursor: number; reset: boolean };
      // La pantalla cambió de restaurante o de mapa mientras se preguntaba:
      // se descarta la respuesta para no mezclar avisos.
      if (this.restaurantId !== askedRestaurant || this.overview !== askedOverview) return;
      if (!this.active) return;
      const wasConnected = this.connected;
      this.failures = 0;
      if (!listening && this.cursor === null) this.cursor = data.cursor;
      if (!wasConnected || data.reset || this.forceResync) {
        this.forceResync = false;
        this.quietPolls = 0;
        // Primera vez, vuelta tras una caída, o avisos perdidos: las pantallas
        // vuelven a entrar y recargan (su «connect» lo hace).
        // Lo perdido no se repasa aviso por aviso: la pantalla recarga entero.
        this.cursor = data.cursor;
        this.connected = true;
        this.fire("connect", []);
      } else {
        this.quietPolls = data.events.length > 0 ? 0 : this.quietPolls + 1;
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
      const delay = this.nextDelay();
      if (delay !== null) this.schedule(delay);
    }
  }

  /** Manda un evento y espera la respuesta del servidor (o falla a los `ms`). */
  private async request(event: string, payload: unknown, ms: number | null): Promise<unknown> {
    this.noteActivity();
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
      // Un 401 no es un fallo de red: el servidor contesta «no autorizado».
      // Se devuelve como ack para que las pantallas (y las pruebas) lo manejen
      // igual que antes, cuando el socket devolvía un ack con error.
      if (response.status === 401) return { ok: false, error: "No autorizado" } as unknown;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
