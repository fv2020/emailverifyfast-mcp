# EmailVerifyFast MCP server

Hosted remote MCP server (Streamable HTTP) that lets AI assistants verify email addresses with EmailVerifyFast.

- **Server URL:** `https://mcp.emailverifyfast.com/mcp`
  (also `https://emailverifyfast-mcp.sagebond.workers.dev/mcp`)
- **Landing page:** https://mcp.emailverifyfast.com/ · **Health:** `/health`
- **Cloudflare Worker:** `emailverifyfast-mcp` (stateless, `createMcpHandler` from `agents@0.34.0` + `@modelcontextprotocol/server@2.4.0`)

It is a thin proxy in front of the existing public EVF API (`https://emailverifyfast.com/api/...`). It stores nothing and has no secrets of its own.

## Tools

| Tool | What it does | EVF API used |
|---|---|---|
| `verify_email` | Verify one address; waits up to 45 s, else returns a `job_id` | `POST /api/verify`, `GET /api/lists/{id}`, `GET /api/results?job_id=` |
| `verify_list` | Verify up to **500** addresses as one list (dupes removed); returns up to 500 results inline if finished, else `job_id` + progress | `POST /api/lists` (+ polling) |
| `get_results` | Progress + paged results (50/page) for a `job_id`, optional status filter | `GET /api/lists/{id}`, `GET /api/results` |
| `check_credits` | Confirms the key works and summarises recent usage. **EVF has no balance endpoint yet**, so it cannot show exact remaining credits | `GET /api/lists` |

## Auth (v1)

Each user brings their own EVF API key (create one at https://emailverifyfast.com/api-access). Send it either way:

- Header (preferred): `Authorization: Bearer YOUR_KEY` (also accepts `X-API-Key`)
- URL, for apps that only take a URL: `https://mcp.emailverifyfast.com/mcp?key=YOUR_KEY`. Treat this URL like a password.

The Worker strips the key from the request before the MCP transport sees it, forwards it to EVF only as a Bearer header, and never logs it (Workers observability is off). `tools/list` works without a key, so directories can index the server; tool calls without a key return a helpful error.

## Connect

**Claude Desktop / Claude.ai (Settings → Connectors → Add custom connector)**
URL: `https://mcp.emailverifyfast.com/mcp?key=YOUR_KEY`

Claude Desktop via config file (`claude_desktop_config.json`), using `mcp-remote`:
```json
{
  "mcpServers": {
    "emailverifyfast": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.emailverifyfast.com/mcp", "--header", "Authorization: Bearer ${EVF_KEY}"],
      "env": { "EVF_KEY": "YOUR_KEY" }
    }
  }
}
```

**Claude Code**
```bash
claude mcp add --transport http emailverifyfast https://mcp.emailverifyfast.com/mcp --header "Authorization: Bearer YOUR_KEY"
```

**Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "emailverifyfast": {
      "url": "https://mcp.emailverifyfast.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_KEY" }
    }
  }
}
```

**ChatGPT** (Settings → Apps & Connectors → Advanced → Developer mode → Create)
MCP Server URL: `https://mcp.emailverifyfast.com/mcp?key=YOUR_KEY`, Authentication: *No authentication* (the key is in the URL). Note: ChatGPT custom connectors require developer mode / a plan that allows them.

**MCP Inspector (testing)**
```bash
npx @modelcontextprotocol/inspector --cli https://mcp.emailverifyfast.com/mcp --transport http \
  --header "Authorization: Bearer YOUR_KEY" --method tools/call --tool-name check_credits
```

## Develop / test / deploy

```bash
npm install
node test/mock-evf.mjs &                                   # mock EVF API on :8788
npx wrangler dev --port 8787 --var EVF_API_BASE:http://localhost:8788
npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --transport http \
  --header "Authorization: Bearer evf_test_key_123" --method tools/list
```
Deploy: `npx wrangler deploy --minify` (needs `wrangler login`). `wrangler.jsonc` routes the Worker to the custom domain `mcp.emailverifyfast.com`.

## Phase 2 ideas (not built)

1. **OAuth sign-in** – use `@cloudflare/workers-oauth-provider` on this Worker (KV for tokens). Its `/authorize` page would send users to an EVF login page and get back an API key, which needs a small new EVF endpoint (e.g. "create key for MCP client" after session login). That's a change to the One.com app, so it hasn't been done.
2. **Balance endpoint** – add `GET /api/account` on EVF (free checks used/remaining, plan, node status) so `check_credits` can give exact numbers.
3. **Free trial allowance** – the existing 100 lifetime account checks already work through the MCP server; optionally a "first 50 via MCP" promo flag on EVF.
4. **emailverifyfast.com/mcp page** with "Add to Cursor" deeplink (`cursor://anysphere.cursor-deeplink/mcp/install?name=emailverifyfast&config=<base64 json>`) and Claude/ChatGPT instructions. This needs an edit to the site, so for now https://mcp.emailverifyfast.com/ is the landing page.
5. **Directory listings** – the official MCP Registry (server.json + `mcp-publisher`), Smithery, mcp.so, PulseMCP, Glama, the Cursor directory and Anthropic's connector directory (that one needs OAuth).

## Directory listings
- Official MCP Registry: `com.emailverifyfast/email-verification`, published with DNS authentication on emailverifyfast.com. See `server.json`.
- Listing copy for other directories is in `listing/LISTING.md`.

## License
MIT
