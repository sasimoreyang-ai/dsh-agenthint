var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { readSessionTraceRecords } from "./session-trace.js";
let AgentHintTraceService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _available_decorators;
    let _snapshot_decorators;
    return class AgentHintTraceService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _available_decorators = [Remote];
            _snapshot_decorators = [Remote];
            __esDecorate(this, null, _available_decorators, { kind: "method", name: "available", static: false, private: false, access: { has: obj => "available" in obj, get: obj => obj.available }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _snapshot_decorators, { kind: "method", name: "snapshot", static: false, private: false, access: { has: obj => "snapshot" in obj, get: obj => obj.snapshot }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        options = __runInitializers(this, _instanceExtraInitializers);
        constructor(ctx, options) {
            super(ctx, 'agentHintTrace');
            this.options = options;
        }
        available() { return true; }
        /**
         * Merge the in-process window with this plugin's records in the Session log.
         * @param request - exactly one `sessionId` of 1 to 512 characters.
         * @returns the merged, deduplicated snapshot naming both sources.
         */
        snapshot(request) {
            if (typeof request !== 'object' || request === null || Array.isArray(request)
                || Object.keys(request).length !== 1 || !('sessionId' in request)
                || typeof request.sessionId !== 'string' || request.sessionId.length === 0 || request.sessionId.length > 512) {
                throw new Error('Expected one sessionId of 1 to 512 characters');
            }
            const sessionId = request.sessionId;
            return this.options.trace.snapshot(sessionId, this.readSessionLog(sessionId));
        }
        /**
         * Read this plugin's records back out of the Session log.
         * A missing Session (old host, or a session this process does not own) and a
         * refused read both degrade to "window only"; neither fails the download.
         * @param sessionId - the session the export is for.
         * @returns the read result, or `undefined` when no log is reachable.
         */
        readSessionLog(sessionId) {
            const session = this.options.resolveSession?.(sessionId);
            if (session === undefined)
                return undefined;
            return readSessionTraceRecords(session, sessionId, message => this.ctx.logger.warn(message));
        }
    };
})();
export { AgentHintTraceService };
