# EmailVerifyFast MCP: listing copy (ready to paste)

**Never paste a real API key into any listing or form.**

## Core fields
- **Name:** EmailVerifyFast
- **Registry name:** `com.emailverifyfast/email-verification`
- **Server / connection URL (Streamable HTTP):** `https://mcp.emailverifyfast.com/mcp`
- **Transport:** streamable-http (remote, hosted; nothing to install)
- **Website:** https://emailverifyfast.com
- **Docs / setup page:** https://mcp.emailverifyfast.com/ (API docs: https://emailverifyfast.com/api-docs)
- **Icon:**
  - SVG: https://emailverifyfast.com/assets/favicon.svg
  - 400×400 PNG for upload: `listing/icon-400.png`
- **Category:** Marketing / Sales & CRM / Data validation (pick "Communication" or "Marketing" where those are the only options)
- **Tags:** email verification, email validation, email checker, bounce reduction, deliverability, cold email, lead generation, list cleaning, catch-all detection, SMTP check
- **Auth:** API key. Bring your own EmailVerifyFast API key; get one at emailverifyfast.com (sign up, then go to API access). Send it as `Authorization: Bearer YOUR_KEY`, or append `?key=YOUR_KEY` to the URL in clients that only accept a URL.
- **Pricing note:** a free account includes 100 checks (once); paid plans run on a dedicated verification node.

## Short description (≤100 chars)
Verify email addresses and lists (valid, invalid, catch-all) with EmailVerifyFast.

## One-liner (≤200 chars)
Check whether email addresses are deliverable before you send. Verify single emails or lists of up to 500 from Claude, ChatGPT or Cursor, with valid / invalid / catch-all results.

## Long description
EmailVerifyFast's hosted MCP server lets AI assistants verify email addresses directly, so you can clean a lead list or check a contact without leaving Claude, ChatGPT, Cursor or any other MCP client.

Each check runs syntax, domain/MX and SMTP mailbox checks and returns a clear status: valid, invalid, catch-all, accepted (the server accepted the address, but catch-all couldn't be determined) or unknown. Each result also includes the reason, the mail server and the SMTP response. Results come back in the chat for small jobs. Larger lists run in the background, and you fetch them with a job ID.

Tools:
- `verify_email`: verify one address.
- `verify_list`: verify up to 500 addresses in one job (duplicates are removed automatically).
- `get_results`: progress and paged results for a job, filterable by status.
- `check_credits`: confirm your key works and see recent usage.

Remote server over Streamable HTTP. Nothing to install. Bring your own EmailVerifyFast API key (free account available at https://emailverifyfast.com).

## Example prompts
- "Verify jane@acme.com"
- "Check these 40 leads and tell me which ones will bounce: …"
- "Clean this list and give me only the valid addresses as a CSV"

## Client configs
Cursor (`~/.cursor/mcp.json`):
```json
{ "mcpServers": { "emailverifyfast": { "url": "https://mcp.emailverifyfast.com/mcp", "headers": { "Authorization": "Bearer YOUR_KEY" } } } }
```
Claude Code:
```bash
claude mcp add --transport http emailverifyfast https://mcp.emailverifyfast.com/mcp --header "Authorization: Bearer YOUR_KEY"
```
Claude.ai / ChatGPT custom connector URL: `https://mcp.emailverifyfast.com/mcp?key=YOUR_KEY`

Cursor one-click install deeplink (no key; the user adds the header afterwards):
`cursor://anysphere.cursor-deeplink/mcp/install?name=emailverifyfast&config=eyJ1cmwiOiJodHRwczovL21jcC5lbWFpbHZlcmlmeWZhc3QuY29tL21jcCJ9`

## Per-directory notes
- **Official MCP Registry:** published as `com.emailverifyfast/email-verification` v1.0.0.
- **Glama:** imports from the official registry hourly. Afterwards, sign in at glama.ai, claim the connector, and add a test profile (Authentication Type "API Key", Bearer) using a dedicated low-value EVF key so the hourly health check shows "healthy". Health checks only call initialize and list tools; they never verify emails.
- **PulseMCP:** submissions paused; it picks up registry entries automatically when it reopens.
- **Smithery:** self-publishing shut down on 31 Oct 2026 (now a curated Arcade directory); no submission route.
- **mcp.so:** https://mcp.so/submit has a required "Repository URL" field and a sign-in. Choose the free (reviewed) option, not the $39 paid one. This needs a public GitHub repo, or try the website URL.
- **mcpservers.org:** https://mcpservers.org/submit. Fields: name, category, short description, link (website OK: https://mcp.emailverifyfast.com/), registry name, a "remote" checkbox, contact email, and plan. Choose Free (about 2-week review).
- **Cursor directory:** cursor.directory blocks automated fetches (429). It needs a browser and sign-in; reportedly it wants a GitHub repo.
- **Anthropic Connectors Directory:** claude.ai/directory/manage. Needs a paid Claude plan, a privacy policy URL, a support contact and reviewer test instructions. In practice it needs OAuth for user-account tools.
