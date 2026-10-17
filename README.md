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

For publishing, the image or video URL must be public HTTPS because Meta retrieves the media from that URL. The service supports `IMAGE`, `VIDEO`, `REELS`, `STORIES`, and `CAROUSEL` containers at the client level. The dashboard intentionally starts with single-image publishing as the safest operational workflow.

## HTTP API

- `GET /health` returns service health.
- `GET /api/account` returns the configured professional account.
- `GET /api/posts?limit=12&after=...` lists recent media.
- `GET /api/posts/:postId/insights` returns media insights.
- `GET /api/publishing-limit` returns current publishing-limit usage.
- `POST /api/publish` accepts `{ "mediaType": "IMAGE", "imageUrl": "https://…", "caption": "…", "altText": "…" }`.

The client follows Meta's publishing flow: create a media container, wait for asynchronous video containers to finish, then publish the container. Errors are returned without access-token material.

## Meta setup

Create or configure a Meta app for Instagram Graph API access, connect the Instagram Professional Account to a Facebook Page, and request the permissions applicable to the account and operation. Typical account/media access uses `instagram_basic` with the required Page permissions; publishing also requires the publishing permission for the chosen login flow. Complete any app review, Page Publishing Authorization, or two-factor authentication requirements shown by Meta.

The dashboard now supports single-image posts, Reels, and carousels. Reel publishing creates a `REELS` container and waits for Meta to report `FINISHED` before publishing. Carousel publishing creates one child container per image or video, waits for video children, creates the parent carousel container, and publishes the parent. The UI enforces 2–10 carousel items and lets each item be an image or video.

The implementation is based on Meta's current documentation for versioned Graph API calls, media listing, and content publishing:

- [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [IG User Media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media)
- [Graph API Versioning](https://developers.facebook.com/docs/graph-api/guides/versioning)

## Live smoke test

The automated test suite uses mocked responses and does not need a real token. After configuring `.env`, run `npm start`, then visit the dashboard. A successful account load and recent-media grid confirm account access. Publishing should be tested with a non-sensitive image hosted on a public HTTPS CDN and the dashboard form.
