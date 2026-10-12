// Cliente mínimo de Chrome DevTools Protocol sobre el WebSocket nativo de Node.
//
// No se añade ninguna dependencia: el proyecto solo depende de lo que la app
// necesita en runtime, y una herramienta de medición no debe meter más
// paquetes en `package.json` (ni un `puppeteer` de 300 MB).
//
// Son unas 120 líneas: conectar a un Chrome ya arrancado con
// `--remote-debugging-port`, mandar comandos con id y esperar su respuesta.

/**
 * Lo que devuelve un comando de CDP: JSON del protocolo, distinto en cada
 * método. Se declara lo que este guion lee; lo demás queda como `unknown` y
 * se convierte donde se usa.
 */
export type CdpRespuesta = {
  result?: { value?: unknown };
  targetId?: string;
  sessionId?: string;
  [clave: string]: unknown;
};

export type Cdp = {
  send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<CdpRespuesta>;
  on: (
    event: string,
    handler: (params: unknown, sessionId?: string) => void,
  ) => () => void;
  close: () => void;
};

const DEBUG_URL = process.env.CDP_URL ?? "http://127.0.0.1:9222";

/** Espera a que el puerto de depuración responda. */
export async function waitForChrome(tries = 60): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(`${DEBUG_URL}/json/version`);
      if (r.ok) return;
    } catch {
      // todavía no
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Chrome no respondió en ${DEBUG_URL} (¿arrancado con --remote-debugging-port=9222?)`);
}

/**
 * Conecta al navegador, abre una pestaña nueva y devuelve una sesión ligada a
 * ella. `close()` cierra la sesión y la pestaña, no el navegador.
 */
export async function openTab(url = "about:blank"): Promise<Cdp & { targetId: string }> {
  await waitForChrome();
  const version = await (await fetch(`${DEBUG_URL}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("no se pudo abrir el WebSocket de Chrome")), { once: true });
  });

  let nextId = 1;
  const pending = new Map<number, { resolve: (v: CdpRespuesta) => void; reject: (e: Error) => void }>();
  const listeners = new Map<string, Set<(params: unknown, sessionId?: string) => void>>();

  ws.addEventListener("message", (ev: MessageEvent) => {
    const msg = JSON.parse(String(ev.data));
    if (typeof msg.id === "number") {
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? "")})`));
      else slot.resolve(msg.result);
      return;
    }
    listeners.get(msg.method)?.forEach((fn) => fn(msg.params, msg.sessionId));
  });

  // Si Chrome se cae (pestaña que revienta, proceso cerrado), el WebSocket se
  // cierra y las promesas pendientes se quedarían colgadas para siempre. Sin
  // esto, Node ve el bucle de eventos vacío, avisa de un `await` sin resolver y
  // se sale con un error que no dice nada.
  ws.addEventListener("close", () => {
    const error = new Error("se cerró la conexión con Chrome (¿se cayó el navegador?)");
    pending.forEach((slot) => slot.reject(error));
    pending.clear();
  });
  ws.addEventListener("error", () => {
    const error = new Error("falló la conexión con Chrome");
    pending.forEach((slot) => slot.reject(error));
    pending.clear();
  });

  const rawSend = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
    const id = nextId++;
    return new Promise<CdpRespuesta>((resolve, reject) => {
      const reloj = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chrome no respondió a ${method} en 60 s`));
      }, 60_000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(reloj);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(reloj);
          reject(e);
        },
      });
      ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  };

  // Pestaña nueva + sesión de la página.
  const targetId = String((await rawSend("Target.createTarget", { url })).targetId);
  const sessionId = String((await rawSend("Target.attachToTarget", { targetId, flatten: true })).sessionId);

  return {
    targetId,
    send: (method, params, sid) => rawSend(method, params, sid ?? sessionId),
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return () => listeners.get(event)!.delete(handler);
    },
    close() {
      // El cierre va sin `await`: si se rechaza al cerrar el WebSocket, sería un
      // rechazo sin manejar y Node se sale con error al terminar la medición.
      rawSend("Target.closeTarget", { targetId }).catch(() => {});
      ws.close();
    },
  };
}

/** Navega y espera a que la página termine de pintar algo. */
export async function goto(c: Cdp, url: string, waitMs = 1200): Promise<void> {
  const loaded = new Promise<void>((resolve) => {
    const off = c.on("Page.loadEventFired", () => {
      off();
      resolve();
    });
  });
  await c.send("Page.navigate", { url });
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 20000))]);
  await new Promise((r) => setTimeout(r, waitMs));
}