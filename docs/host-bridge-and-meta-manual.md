# Orion Instagram host bridge and Meta app manual

This manual covers the two supported ways to connect Orion to Instagram: Direct Meta OAuth and the host-side Manus connector bridge.

## Choose a mode

Use **Direct Meta OAuth** when Orion can perform the Instagram login itself. Use **connector mode** when a host process already owns an authenticated Manus Instagram connector and should keep that login outside Orion.

Do not configure both as active providers on the same Orion process. Connector mode takes precedence when `ORION_INSTAGRAM_PROVIDER=connector`.

## Direct Meta OAuth setup

1. Open [Meta for Developers](https://developers.facebook.com/apps/) and create or select the app that owns Orion.
2. Add the Instagram product and open the Instagram API setup with Instagram Login settings.
3. Copy the Instagram App ID and Instagram App Secret from Business login settings.
4. Add the exact callback URI below to the app's OAuth redirect URI list:

```text
http://localhost:3000/api/auth/instagram/callback
```

5. Request the permissions Orion uses:

```text
instagram_business_basic
instagram_business_content_publish
instagram_business_manage_comments
```

6. Configure Orion's server-only `.env` file:

```env
INSTAGRAM_OAUTH_CLIENT_ID=your-instagram-app-id
INSTAGRAM_OAUTH_CLIENT_SECRET=your-instagram-app-secret
INSTAGRAM_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/instagram/callback
```

7. Start Orion and open `http://localhost:3000`. Select **Connect Instagram**.
8. Verify the session at `GET /api/auth/instagram/status`.

The app secret and tokens stay server-side. Orion stores its OAuth session in process memory, so a restart requires reconnecting. Never put the secret in `public/`, browser storage, source control, or a client-side environment variable.

## Host-side connector bridge setup

The bridge is implemented by `src/connector-bridge.ts`. It is intentionally an adapter: the host supplies `ConnectorGateway` handlers that call the authenticated Manus Instagram connector. A plain Node process cannot invoke MCP tools directly or extract a connector token.

Create a private host process that imports `createConnectorBridge`, wires each gateway method to the connector tool, and listens only on localhost or a private network interface:

```ts
import { createConnectorBridge } from './src/connector-bridge.js';

const gateway = {
  getAccount: () => manuscriptInstagram.getAccountInfo(),
  listMedia: (limit, after) => manuscriptInstagram.getPostList({ limit, after }),
  getPostInsights: (postId) => manuscriptInstagram.getPostInsights({ postId }),
  getEngagement: (postId) => manuscriptInstagram.getEngagement({ postId }),
  getPublishingLimit: () => manuscriptInstagram.getPublishingLimit(),
  publish: (input) => manuscriptInstagram.publish(input),
  publishCarousel: (items, caption) => manuscriptInstagram.publishCarousel({ items, caption }),
};

createConnectorBridge(gateway, process.env.ORION_CONNECTOR_BRIDGE_SECRET)
  .listen(Number(process.env.ORION_CONNECTOR_BRIDGE_PORT ?? 4310), '127.0.0.1');
```

The exact `manuscriptInstagram` calls depend on the host's connector runtime. Keep those calls in the bridge process, not in browser code or the Orion repository.

Configure Orion:

```env
ORION_INSTAGRAM_PROVIDER=connector
ORION_CONNECTOR_BRIDGE_URL=http://127.0.0.1:4310
ORION_CONNECTOR_BRIDGE_SECRET=generate-a-long-random-value
```

The bridge accepts these authenticated operations:

```text
POST /instagram/getAccount
POST /instagram/listMedia
POST /instagram/getPostInsights
POST /instagram/getEngagement
POST /instagram/getPublishingLimit
POST /instagram/publish
POST /instagram/publishCarousel
```

Each request must include:

```http
Authorization: Bearer <bridge secret>
Content-Type: application/json
```

Each successful response is shaped as:

```json
{ "result": {} }
```

## Security checklist

- Bind the bridge to `127.0.0.1` or a private interface.
- Generate a random bridge secret and keep it in a secret manager or protected environment file.
- Use HTTPS or a private authenticated tunnel when Orion and the bridge are on different hosts.
- Do not log request bodies, captions, access tokens, authorization codes, or secrets.
- Rotate the bridge secret if it is exposed.
- Keep the Meta App Secret only in the OAuth server process.
- Review all publishing calls before enabling them in production.

## Health checks and troubleshooting

Check the bridge:

```bash
curl -fsS http://127.0.0.1:4310/health
```

Check Orion's provider:

```bash
curl -fsS http://127.0.0.1:3000/api/auth/instagram/status
```

Check the verification dashboard data:

```bash
curl -fsS http://127.0.0.1:3000/api/verification
```

Common failures:

- **401 from bridge:** the bearer secret differs between Orion and the bridge.
- **503 connector mode:** `ORION_CONNECTOR_BRIDGE_URL` is empty or unreachable.
- **OAuth redirect mismatch:** the Meta callback URI and `INSTAGRAM_OAUTH_REDIRECT_URI` differ by scheme, port, path, or trailing slash.
- **OAuth permission error:** the Meta app lacks the required Instagram permissions or access level.
- **Account unavailable:** the account is not an eligible professional Business or Creator account, or the connector session has expired.

## Local verification

Run the complete local checks:

```bash
npm ci
npm run typecheck
npm test
npm run build
node scripts/mock-oauth-e2e.mjs
```

The GitHub Actions workflow in `.github/workflows/instagram-integration.yml` runs the same checks on pushes and pull requests.
