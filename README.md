# claudie

A fast, mobile-first Claude chat app for your own Bedrock API key. Installs as a PWA on iPhone. No server, no accounts — everything stays in your browser's localStorage.

**Live:** https://codedude19.github.io/claudie/

## Features

- **Bring your own key** — drop in a Bedrock API key (same format as AWS's Bearer tokens)
- **Model picker** — fetches your account's Claude inference profiles from `us-west-2`, pick up to 3 to appear in the model switcher
- **Streaming** — token-by-token with rAF-batched markdown rendering
- **Rich markdown** — GFM, headings, lists, code blocks, tables, blockquotes
- **Copy & edit** — copy any message, or tap the pencil on a user prompt to edit in the composer (with backdrop blur) and resend
- **Chats in localStorage** — last 20 chats, auto-titled from the first message
- **iOS PWA-ready** — notch/home-indicator safe areas, `visualViewport` keyboard tracking, 120Hz-friendly animations
- **Claude aesthetic** — warm `#1f1e1d` base, terracotta `#d97757` accent

## Stack

- Vanilla TypeScript + Vite — no framework
- `@ai-sdk/amazon-bedrock` + `ai` for streaming
- `marked` for markdown

## Local dev

```bash
npm install
npm run dev
```

Open http://localhost:5173/claudie/ and drop in your Bedrock API key.

## Deploy

Pushes to `main` build and deploy to GitHub Pages via `.github/workflows/deploy.yml`.

## API key

Get a Bedrock long-lived API key from the AWS console: _Bedrock → API keys → Generate long-term API key_. The key is stored only in your browser's localStorage and sent directly to the Bedrock endpoint. Region is hardcoded to `us-west-2` (edit `src/models.ts` if you need a different region).
