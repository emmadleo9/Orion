import http from 'node:http';
import { spawn } from 'node:child_process';

const metaPort = 4371;
const orionPort = 4372;
const meta = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url?.startsWith('/oauth/access_token')) return res.end(JSON.stringify({ access_token: 'mock-short-token', user_id: 'mock-instagram-user' }));
  if (req.url?.startsWith('/access_token')) return res.end(JSON.stringify({ access_token: 'mock-long-token', expires_in: 3600 }));
  res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }));
});
await new Promise((resolve) => meta.listen(metaPort, '127.0.0.1', resolve));
const orion = spawn(process.execPath, ['dist/src/server.js'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production', PORT: String(orionPort), HOST: '127.0.0.1', INSTAGRAM_OAUTH_CLIENT_ID: 'mock-app', INSTAGRAM_OAUTH_CLIENT_SECRET: 'mock-secret', INSTAGRAM_OAUTH_REDIRECT_URI: `http://127.0.0.1:${orionPort}/api/auth/instagram/callback`, INSTAGRAM_OAUTH_AUTHORIZE_URL: `http://127.0.0.1:${metaPort}/oauth/authorize`, INSTAGRAM_OAUTH_TOKEN_URL: `http://127.0.0.1:${metaPort}/oauth/access_token`, INSTAGRAM_OAUTH_GRAPH_URL: `http://127.0.0.1:${metaPort}` }, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  for (let i = 0; i < 30; i += 1) { try { if ((await fetch(`http://127.0.0.1:${orionPort}/health`)).ok) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); }
  const login = await fetch(`http://127.0.0.1:${orionPort}/api/auth/instagram/login`, { redirect: 'manual' });
  if (login.status !== 302) throw new Error(`login status ${login.status}`);
  const location = new URL(login.headers.get('location'));
  const callback = await fetch(`http://127.0.0.1:${orionPort}/api/auth/instagram/callback?code=mock-code&state=${encodeURIComponent(location.searchParams.get('state'))}`, { redirect: 'manual' });
  if (callback.status !== 302) throw new Error(`callback status ${callback.status}`);
  const status = await (await fetch(`http://127.0.0.1:${orionPort}/api/auth/instagram/status`)).json();
  if (!status.connected || status.accountId !== 'mock-instagram-user') throw new Error(`unexpected status ${JSON.stringify(status)}`);
  console.log(JSON.stringify({ ok: true, loginStatus: login.status, callbackStatus: callback.status, status }));
} finally { orion.kill('SIGTERM'); meta.close(); }
