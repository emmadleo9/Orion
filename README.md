
## Host-side connector bridge and CI

`src/connector-bridge.ts` provides the host-side bridge server. Construct it with handlers that call the authenticated Manus Instagram connector, then mount it on a private host process with a long random `ORION_CONNECTOR_BRIDGE_SECRET`. The bridge rejects missing or incorrect bearer credentials and exposes only the typed Instagram operations Orion needs. The standalone repository cannot create an MCP session by itself, so the host integration must supply the `ConnectorGateway` handlers.

The process-level OAuth smoke test uses `scripts/mock-oauth-e2e.mjs`. It starts a local mock Meta token server, starts the compiled Orion app with mock OAuth endpoint environment variables, follows the login redirect and callback, and verifies the connected account status:

```bash
npm run build
node scripts/mock-oauth-e2e.mjs
```

GitHub Actions runs type-checking, all unit/integration tests, the production build, and the mocked OAuth E2E flow on pushes and pull requests through `.github/workflows/instagram-integration.yml`.
