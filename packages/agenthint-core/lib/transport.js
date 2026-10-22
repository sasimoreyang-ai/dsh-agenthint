/**
 * Control-plane transport contract.
 *
 * The coordinator only depends on this interface, never on `fetch`, a host
 * HTTP client, or a credential store. Implementations decide how a command is
 * authenticated and where it is sent; the state machine decides when sending
 * is safe.
 *
 * @module agenthint-core/transport
 */
export {};
