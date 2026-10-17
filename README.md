# Orion Instagram Plugin

Orion is a standalone Node.js and TypeScript service for operating a Professional Instagram account through Meta's Instagram Graph API. It includes a reusable API client, a small HTTP API, and a responsive command-center dashboard.

## Quick start

Use Node.js 20 or newer. Install dependencies, copy `.env.example` to `.env`, and add an Instagram Professional Account ID plus a user access token:

```bash
npm install
cp .env.example .env
npm run typecheck
npm test
npm run build
npm start
```

Open `http://localhost:3000`. The browser only talks to Orion's server; the Meta access token is never sent to the dashboard.

## Environment

`INSTAGRAM_ACCESS_TOKEN` is the user access token with the permissions required by the Meta app and account flow. `INSTAGRAM_USER_ID` is the Instagram Professional Account ID. `INSTAGRAM_GRAPH_VERSION` defaults to `v26.0` and can be pinned explicitly. The remaining variables control server binding and video-container polling.

For publishing, the image or video URL must be public HTTPS because Meta retrieves the media from that URL. The service supports `IMAGE`, `VIDEO`, `REELS`, `STORIES`, and `CAROUSEL` containers at the client level.

## HTTP API

- `GET /health` returns service health.
- `GET /api/account` returns the configured professional account.
- `GET /api/posts?limit=12&after=...` lists recent media.
- `GET /api/posts/:postId/insights` returns media insights.
- `GET /api/posts/:postId/engagement` aggregates likes, comments, saves, shares, reach, impressions, and recent comments.
- `GET /api/publishing-limit` returns current publishing-limit usage.
- `POST /api/publish` publishes an image, Reel, or carousel immediately.
- `GET /api/schedules` lists scheduled, processing, published, failed, and cancelled jobs.
- `POST /api/schedules` accepts `{ "publishAt": "2026-10-18T12:00:00.000Z", "payload": { "mediaType": "IMAGE", "imageUrl": "https://…", "caption": "…" } }`.
- `DELETE /api/schedules/:id` cancels a scheduled job before it publishes.
- `POST /api/captions/generate` accepts `{ "topic": "launch day", "tone": "bold", "callToAction": "What do you think?" }` and returns three caption/hashtag suggestions.

Schedules persist in `.orion-data/schedules.json` and are processed by the Orion server while it is running. Use an external process manager or container restart policy for unattended operation. The caption lab is deterministic and local; it does not send content to an external AI provider.

## Meta setup

Create or configure a Meta app for Instagram Graph API access, connect the Instagram Professional Account to a Facebook Page, and request the permissions applicable to the account and operation. Typical account/media access uses `instagram_basic` with the required Page permissions; publishing also requires the publishing permission for the chosen login flow. Complete any app review, Page Publishing Authorization, or two-factor authentication requirements shown by Meta.

The dashboard supports single-image posts, Reels, carousels, scheduled publishing, engagement analytics, and caption/hashtag suggestions. Reel publishing creates a `REELS` container and waits for Meta to report `FINISHED` before publishing. Carousel publishing creates one child container per image or video, waits for video children, creates the parent carousel container, and publishes the parent.

## Live smoke test

The automated test suite uses mocked responses and does not need a real token. After configuring `.env`, run `npm start`, then visit the dashboard. A successful account load and recent-media grid confirm account access. Publishing should be tested with a non-sensitive image hosted on a public HTTPS CDN. Engagement requires media-insights and comments permissions for the configured account.
