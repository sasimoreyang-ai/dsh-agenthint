window.__ModuleLoader__.load({ id: "@sasimoreyang-ai/dsh-llm-agent-hint", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/observer.ts
var import_react = require("react");
function DraftObserver({ sessionId, useInput, notify }) {
  const length = useInput((input) => input.draft.trim().length);
  const marker = (0, import_react.useRef)(null);
  const state = (0, import_react.useRef)({ sessionId, announced: false });
  (0, import_react.useLayoutEffect)(() => {
    if (state.current.sessionId !== sessionId || length === 0) state.current = { sessionId, announced: false };
  }, [sessionId, length]);
  (0, import_react.useLayoutEffect)(() => {
    const owner = marker.current?.closest('[data-slot="conversation.composer.bar"]');
    if (!owner) return;
    const editorOf = (event) => {
      const target = event.target;
      const editor = typeof target?.closest === "function" ? target.closest('[data-composer-input="true"]') : null;
      return editor && owner.contains(editor) && editor.getAttribute("contenteditable") === "true" ? editor : void 0;
    };
    const announce = () => {
      if (state.current.sessionId !== sessionId || state.current.announced) return;
      state.current.announced = true;
      notify(sessionId);
    };
    const input = (event) => {
      const editor = editorOf(event);
      if (!editor) return;
      if (editor.textContent?.trim()) announce();
      else state.current.announced = false;
    };
    const insertion = (event) => {
      const edit = event;
      if (editorOf(event) && edit.inputType?.startsWith("insert") && edit.data?.trim()) announce();
    };
    const paste = (event) => {
      if (editorOf(event) && event.clipboardData?.getData("text/plain").trim()) announce();
    };
    const capture = { capture: true };
    owner.addEventListener("beforeinput", insertion, capture);
    owner.addEventListener("paste", paste, capture);
    owner.addEventListener("input", input, capture);
    return () => {
      owner.removeEventListener("beforeinput", insertion, capture);
      owner.removeEventListener("paste", paste, capture);
      owner.removeEventListener("input", input, capture);
    };
  }, [sessionId, notify]);
  return (0, import_react.createElement)("span", { ref: marker, hidden: true, "data-agent-hint-observer": "" });
}

// src/client/trace-download.ts
var import_react2 = require("react");
function TraceDownload({ sessionId, download }) {
  const [state, setState] = (0, import_react2.useState)("idle");
  const active = (0, import_react2.useRef)(void 0);
  (0, import_react2.useEffect)(() => {
    setState("idle");
    return () => active.current?.abort();
  }, [sessionId]);
  const click = async () => {
    if (active.current && !active.current.signal.aborted) return;
    const attempt = active.current = new AbortController();
    setState("busy");
    try {
      await download(String(sessionId), attempt.signal);
      if (!attempt.signal.aborted) setState("idle");
    } catch {
      if (!attempt.signal.aborted) setState("error");
    } finally {
      if (active.current === attempt) active.current = void 0;
    }
  };
  const label = state === "error" ? "Hint trace \u4E0B\u8F7D\u5931\u8D25\uFF0C\u70B9\u51FB\u91CD\u8BD5" : state === "busy" ? "\u6B63\u5728\u4E0B\u8F7D Hint trace\u2026" : "\u4E0B\u8F7D Hint trace";
  return (0, import_react2.createElement)("button", {
    type: "button",
    onClick: () => {
      void click();
    },
    disabled: state === "busy",
    title: label,
    "aria-label": label,
    "aria-busy": state === "busy",
    style: {
      appearance: "none",
      font: "inherit",
      fontSize: 12,
      color: "inherit",
      background: "transparent",
      border: "1px solid rgba(127,127,127,.25)",
      borderRadius: 6,
      padding: "4px 8px",
      whiteSpace: "nowrap",
      cursor: state === "busy" ? "wait" : "pointer"
    }
  }, label);
}
function installTraceDownload(ctx, connection, lifetime) {
  let generation;
  let probe;
  let withdraw;
  const refresh = () => {
    const next = connection.generation.getSnapshot();
    if (next === generation || lifetime.aborted) return;
    generation = next;
    probe?.abort();
    withdraw?.();
    withdraw = void 0;
    if (next === void 0) return;
    const attempt = probe = new AbortController();
    const signal = AbortSignal.any([lifetime, attempt.signal, AbortSignal.timeout(5e3)]);
    void connection.rpc.call("/api", "agentHintTrace/available", { args: {} }, signal).then((result) => {
      if (signal.aborted || generation !== next || !result.ok || result.value !== true) return;
      const download = async (sessionId, consumer) => {
        const downloadSignal = AbortSignal.any([lifetime, attempt.signal, consumer, AbortSignal.timeout(1e4)]);
        const response = await connection.rpc.call("/api", "agentHintTrace/snapshot", { args: { request: { sessionId } } }, downloadSignal);
        downloadSignal.throwIfAborted();
        if (!response.ok) throw new Error("Trace download failed");
        const snapshot = response.value;
        if (snapshot?.schemaVersion !== 2 || snapshot.sessionId !== sessionId || !Array.isArray(snapshot.records) || typeof snapshot.sources !== "object" || snapshot.sources === null) {
          throw new Error("Invalid trace response");
        }
        const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "agent-hint-trace.json";
        document.body.appendChild(anchor);
        try {
          anchor.click();
        } finally {
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1e3);
        }
      };
      withdraw = ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
        name: "conversation.session.header.utilities",
        id: "agent-hint-trace-download",
        inject: () => ({ download })
      }, TraceDownload));
    }).catch(() => void 0);
  };
  ctx.effect(() => {
    const unsubscribe = connection.generation.subscribe(refresh);
    refresh();
    return () => {
      probe?.abort();
      unsubscribe();
      withdraw?.();
    };
  }, "agent-hint: trace export capability and RPC lifetime");
}

// src/client/index.ts
var name = "agent-hint-composer";
var inject = ["slots", "connection"];
function apply(ctx) {
  const connection = ctx.get("connection");
  if (connection === void 0) return;
  const lifetime = new AbortController();
  installTraceDownload(ctx, connection, lifetime.signal);
  let generation;
  let probe;
  let withdraw;
  const notify = (sessionId) => {
    if (lifetime.signal.aborted) return;
    void connection.rpc.call(
      "/api",
      "agentHintSignals/composing",
      { args: { request: { sessionId } } },
      AbortSignal.any([lifetime.signal, AbortSignal.timeout(5e3)])
    ).catch(() => void 0);
  };
  const refresh = () => {
    const next = connection.generation.getSnapshot();
    if (next === generation || lifetime.signal.aborted) return;
    generation = next;
    probe?.abort();
    withdraw?.();
    withdraw = void 0;
    if (next === void 0) return;
    const attempt = probe = new AbortController();
    const signal = AbortSignal.any([lifetime.signal, attempt.signal, AbortSignal.timeout(5e3)]);
    void connection.rpc.call("/api", "agentHintSignals/available", { args: {} }, signal).then((result) => {
      if (signal.aborted || generation !== next || !result.ok || result.value !== true) return;
      withdraw = ctx.slots.inject("conversation.input.overlay", () => ctx.slots.register({
        name: "conversation.input.overlay",
        id: "agent-hint-composing",
        order: 100,
        inject: () => ({ notify })
      }, DraftObserver));
    }).catch(() => void 0);
  };
  ctx.effect(() => {
    const unsubscribe = connection.generation.subscribe(refresh);
    refresh();
    return () => {
      lifetime.abort();
      probe?.abort();
      unsubscribe();
      withdraw?.();
    };
  }, "agent-hint: composer capability and RPC lifetime");
}
return module.exports; } });
