# Meta Developer Dashboard setup for Orion OAuth

Use the Instagram API with Instagram Login flow for a professional Instagram Business or Creator account.

## 1. Create or open the Meta app

1. Open [Meta for Developers](https://developers.facebook.com/apps/).
2. Create an app or select the app that will own Orion's Instagram integration.
3. Add/configure the Instagram product and open the Instagram API setup with Instagram Login area.
4. In Business login settings, copy the Instagram App ID and Instagram App Secret. Keep the secret server-side.

## 2. Register Orion's callback

For a local Orion server, add this exact OAuth redirect URI:

```text
http://localhost:3000/api/auth/instagram/callback
```

If Orion is hosted elsewhere, use the exact HTTPS callback URL for that deployment and set the same value in `INSTAGRAM_OAUTH_REDIRECT_URI`. The URI must match exactly, including scheme, host, port, path, and trailing slash behavior.

## 3. Configure permissions

Start with the permissions the dashboard uses:

- `instagram_business_basic` for account and media access
- `instagram_business_content_publish` for image, Reel, and carousel publishing
- `instagram_business_manage_comments` for comments and engagement data

Request additional messaging permissions only if the application adds Instagram messaging. Meta may require Standard or Advanced Access depending on whether the app serves accounts owned or managed by the app team or external users.

## 4. Configure Orion

Copy `.env.example` to `.env` and set:

```env
INSTAGRAM_OAUTH_CLIENT_ID=YOUR_INSTAGRAM_APP_ID
INSTAGRAM_OAUTH_CLIENT_SECRET=YOUR_INSTAGRAM_APP_SECRET
INSTAGRAM_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/instagram/callback
```

Do not commit `.env`, the app secret, authorization codes, or access tokens.

## 5. Connect the account

Start Orion:

```bash
npm run build
npm start
```

Open the dashboard and choose **Connect Instagram**, or visit:

```text
http://localhost:3000/api/auth/instagram/login
```

After approval, Meta redirects to Orion's callback. Orion exchanges the one-time authorization code server-side, exchanges the short-lived token for a long-lived token, and keeps the session token in process memory.

## 6. Verify

Check the provider status:

```bash
curl -fsS http://localhost:3000/api/auth/instagram/status
```

Then load the dashboard. The account, recent media, publishing quota, and engagement panels should use the connected account.

OAuth codes are single-use and expire quickly. Long-lived tokens expire after the Meta-defined lifetime, so the user must reconnect when the in-memory session expires or the server restarts.

## Connector-backed mode

A standalone Node process cannot directly invoke Manus MCP tools. Connector mode therefore requires a trusted server-side bridge that owns the authenticated Manus Instagram connector:

```env
ORION_INSTAGRAM_PROVIDER=connector
ORION_CONNECTOR_BRIDGE_URL=http://127.0.0.1:PORT
ORION_CONNECTOR_BRIDGE_SECRET=shared-secret
```

The bridge must implement `POST /instagram/{operation}` and return `{ "result": ... }`. Keep it on a private network, validate the shared secret, and never expose connector credentials to the browser.
