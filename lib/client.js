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
  const previous = (0, import_react.useRef)({ sessionId, length });
  (0, import_react.useEffect)(() => {
    const before = previous.current;
    previous.current = { sessionId, length };
    if (before.sessionId !== sessionId) return;
    if (before.length === 0 && length > 0) notify(sessionId);
  }, [sessionId, length, notify]);
  return null;
}

// src/client/index.ts
var name = "agent-hint-composer";
var inject = ["slots"];
function apply(ctx) {
  const connection = ctx.get("connection");
  if (connection === void 0) return;
  ctx.inject(["remote.agentHintSignals"], (scope) => {
    const lifetime = new AbortController();
    scope.effect(() => () => lifetime.abort(), "agent-hint: composer RPC lifetime");
    const send = (method, sessionId) => {
      if (lifetime.signal.aborted) return;
      void connection.rpc.call(
        "/api",
        `agentHintSignals/${method}`,
        { request: { sessionId } },
        AbortSignal.any([lifetime.signal, AbortSignal.timeout(5e3)])
      ).catch(() => void 0);
    };
    const notify = (sessionId) => send("composing", sessionId);
    scope.slots.inject("conversation.input.overlay", () => scope.slots.register({
      name: "conversation.input.overlay",
      id: "agent-hint-composing",
      order: 100,
      inject: () => ({ notify })
    }, DraftObserver));
  });
}
return module.exports; } });
