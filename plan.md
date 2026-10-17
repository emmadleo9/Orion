# Orion Instagram Plugin Plan

Orion is initialized as a Node.js 20+ TypeScript service. The implementation uses Express for a small HTTP API and static dashboard, with a dependency-free Instagram Graph API client built on the native `fetch` API. Credentials remain in environment variables and are never sent to the browser.

## Project structure

- `src/config.ts` validates environment configuration and keeps API behavior configurable.
- `src/instagram/client.ts` owns versioned Graph API requests, response normalization, publishing, polling, and safe errors.
- `src/instagram/types.ts` defines the API contract used by the server and tests.
- `src/server.ts` exposes health, account, media, insights, publishing, and dashboard routes.
- `public/` contains the responsive dashboard UI.
- `tests/` contains deterministic client and HTTP smoke tests.

## Design

Candidate styles: editorial dark command center (0.06), neon creator studio (0.04), quiet analytics desk (0.08). Chosen: **editorial dark command center**. It uses a near-black canvas, warm paper panels, one signal-orange accent, compact typography, and an asymmetric split between account context and operational actions. The dashboard should feel like a reliable control surface rather than a social-media clone. Motion is limited to status transitions and loading states.

## Acceptance outcomes

- The repository contains a runnable Node.js TypeScript project with install, build, test, and start commands.
- The Instagram client supports account data, post listing, post insights, publishing-limit data, media-container creation, status polling, and media publishing through the versioned Graph API.
- The server provides health, account, posts, insights, publishing-limit, and publish endpoints with validation and safe error handling.
- The dashboard presents account health, recent posts, insights, and a publish form without exposing access tokens.
- Tests run without a live token by mocking Graph API responses; a live connection is documented as an optional smoke test.
