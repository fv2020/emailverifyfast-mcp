import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

/**
 * EmailVerifyFast remote MCP server (v1).
 *
 * A thin, stateless proxy in front of the existing public EVF API
 * (https://emailverifyfast.com/api/...). It holds no data and no secrets of
 * its own: each request carries the caller's own EVF API key, either as
 *   Authorization: Bearer <EVF_API_KEY>      (preferred)
 * or as a query parameter on the connection URL
 *   https://mcp.emailverifyfast.com/mcp?key=<EVF_API_KEY>
 * The key is forwarded to EVF as a Bearer header and is never logged.
 */

export interface Env {
  EVF_API_BASE: string; // e.g. https://emailverifyfast.com
}

const VERSION = "1.0.0";
const MAX_LIST = 500; // per verify_list call
const INLINE_RESULT_PAGES = 10; // 10 x 50 = up to 500 results returned inline
const POLL_MS = 2500;
const FINAL = new Set(["completed", "cancelled", "failed"]);

class EvfError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Json = Record<string, any>;

function makeClient(base: string, key: string | null) {
  async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Json> {
    if (!key) {
      throw new EvfError(
        401,
        "No EmailVerifyFast API key was supplied. Create one at https://emailverifyfast.com/api-access and connect with the header 'Authorization: Bearer YOUR_KEY' or the URL https://mcp.emailverifyfast.com/mcp?key=YOUR_KEY",
      );
    }
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "User-Agent": `emailverifyfast-mcp/${VERSION}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: Json = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { detail: text.slice(0, 300) };
    }
    if (!res.ok) {
      const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? data).slice(0, 300);
      throw new EvfError(res.status, explain(res.status, detail));
    }
    return data;
  }
  return { call };
}

function explain(status: number, detail: string): string {
  switch (status) {
    case 401:
      return `EmailVerifyFast rejected the API key (${detail}). Check the key at https://emailverifyfast.com/api-access.`;
    case 402:
      return `${detail} See plans at https://emailverifyfast.com/plans.`;
    case 403:
      return `Not allowed: ${detail}`;
    case 429:
      return `Rate limited by EmailVerifyFast: ${detail} Wait a minute and try again.`;
    default:
      return `EmailVerifyFast API error ${status}: ${detail}`;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function slimResult(item: Json) {
  return {
    email: item.email,
    status: item.status,
    reason: item.reason ?? null,
    mail_server: item.mx_host ?? item.mail_server ?? null,
    smtp_response: item.response || null,
    checked_at: item.checked_at ?? null,
  };
}

const STATUS_NOTE =
  "Status meanings: valid = the receiving server confirmed the mailbox at check time (not a delivery guarantee); invalid = the server rejected the address; catch_all = the domain accepts any address; accepted = the receiving server accepted the address but catch-all could not be determined (this does not confirm the mailbox exists); unknown = could not be determined right now; pending/processing = still checking.";

async function waitForJob(api: ReturnType<typeof makeClient>, id: string, waitSeconds: number) {
  const deadline = Date.now() + waitSeconds * 1000;
  let job = await api.call("GET", `/api/lists/${id}`);
  while (!FINAL.has(job.status) && !job.finished_at && Date.now() < deadline) {
    await sleep(POLL_MS);
    job = await api.call("GET", `/api/lists/${id}`);
  }
  return job;
}

async function fetchResults(api: ReturnType<typeof makeClient>, id: string, opts: { status?: string; page?: number; maxPages?: number }) {
  const items: Json[] = [];
  let page = opts.page ?? 1;
  let pages = 1;
  let total = 0;
  const maxPages = opts.maxPages ?? 1;
  for (let n = 0; n < maxPages; n++) {
    const q = new URLSearchParams({ job_id: id, page: String(page) });
    if (opts.status) q.set("status", opts.status);
    const r = await api.call("GET", `/api/results?${q}`);
    items.push(...(r.items ?? []).map(slimResult));
    pages = r.pages ?? 1;
    total = r.total ?? items.length;
    if (page >= pages) break;
    page++;
  }
  return { items, total, pages, last_page_returned: page };
}

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

function jobSummary(job: Json) {
  return {
    job_id: job.id,
    name: job.name,
    status: job.status,
    total: job.total,
    duplicates_removed: job.duplicates,
    counts: job.counts,
    created_at: job.created_at,
    finished_at: job.finished_at,
    dashboard_url: `https://emailverifyfast.com/lists/${job.id}`,
  };
}

function createServer(env: Env, key: string | null) {
  const base = (env.EVF_API_BASE || "https://emailverifyfast.com").replace(/\/$/, "");
  const api = makeClient(base, key);
  const server = new McpServer({ name: "emailverifyfast", version: VERSION });

  server.registerTool(
    "verify_email",
    {
      title: "Verify one email address",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      description:
        "Check whether a single email address is deliverable using EmailVerifyFast (syntax, domain/MX and SMTP mailbox checks). Uses one verification credit. Waits up to wait_seconds for the result; if it is still running, returns a job_id to pass to get_results.",
      inputSchema: z.object({
        email: z.string().min(3).max(320).describe("The email address to verify"),
        wait_seconds: z.number().int().min(0).max(45).default(25).describe("How long to wait for the result (0-45 s)"),
      }),
    },
    async ({ email, wait_seconds }) => {
      try {
        const created = await api.call("POST", "/api/verify", { email: email.trim() }, { "Idempotency-Key": crypto.randomUUID() });
        const job = await waitForJob(api, created.id, wait_seconds ?? 25);
        const done = FINAL.has(job.status) || !!job.finished_at;
        if (!done) {
          return text({ email, finished: false, ...jobSummary(job), next_step: `Still checking. Call get_results with job_id ${job.id} in a few seconds.` });
        }
        const r = await fetchResults(api, created.id, {});
        return text({ finished: true, result: r.items[0] ?? null, job_id: created.id, note: STATUS_NOTE });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "verify_list",
    {
      title: "Verify a list of email addresses",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      description: `Submit up to ${MAX_LIST} email addresses as one EmailVerifyFast job (duplicates are removed; uses one credit per unique address). Waits up to wait_seconds; returns results if finished, otherwise a job_id and progress counts to use with get_results. For larger lists, split into batches or upload a CSV at https://emailverifyfast.com.`,
      inputSchema: z.object({
        emails: z.array(z.string().min(3).max(320)).min(1).max(MAX_LIST).describe(`Email addresses to verify (max ${MAX_LIST})`),
        name: z.string().min(1).max(160).default("MCP list").describe("A name for this list in the EmailVerifyFast dashboard"),
        wait_seconds: z.number().int().min(0).max(45).default(30).describe("How long to wait before returning (0-45 s)"),
      }),
    },
    async ({ emails, name, wait_seconds }) => {
      try {
        const created = await api.call(
          "POST",
          "/api/lists",
          { name: name ?? "MCP list", emails: emails.map((e) => e.trim()) },
          { "Idempotency-Key": crypto.randomUUID() },
        );
        const job = await waitForJob(api, created.id, wait_seconds ?? 30);
        const done = FINAL.has(job.status) || !!job.finished_at;
        if (!done) {
          return text({ finished: false, ...jobSummary(job), next_step: `Verification is running. Call get_results with job_id ${job.id} later to fetch results.` });
        }
        const r = await fetchResults(api, created.id, { maxPages: INLINE_RESULT_PAGES });
        return text({ finished: true, ...jobSummary(job), results_total: r.total, results: r.items, note: STATUS_NOTE });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_results",
    {
      title: "Get results for a verification job",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      description: "Fetch progress and results for a job_id returned by verify_email or verify_list. Results are paged (50 per page); optionally filter by status.",
      inputSchema: z.object({
        job_id: z.string().uuid().describe("The job_id returned by verify_email or verify_list"),
        status: z.enum(["valid", "invalid", "catch_all", "accepted", "unknown", "pending", "processing", "cancelled"]).optional().describe("Only return results with this status"),
        page: z.number().int().min(1).default(1).describe("Results page (50 per page)"),
      }),
    },
    async ({ job_id, status, page }) => {
      try {
        const job = await api.call("GET", `/api/lists/${job_id}`);
        const r = await fetchResults(api, job_id, { status, page: page ?? 1 });
        return text({ ...jobSummary(job), finished: FINAL.has(job.status) || !!job.finished_at, page: page ?? 1, pages: r.pages, results_total: r.total, results: r.items, note: STATUS_NOTE });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "check_credits",
    {
      title: "Check account and usage",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      description:
        "Confirm the EmailVerifyFast API key works and summarise recent usage (lists and addresses submitted). The EVF API does not yet expose an exact remaining-credit balance; free accounts include 100 checks once, and the dashboard shows the exact balance.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const r = await api.call("GET", "/api/lists");
        const items: Json[] = r.items ?? [];
        const submitted = items.reduce((s, j) => s + (Number(j.total) || 0), 0);
        const running = items.filter((j) => ["queued", "running", "paused"].includes(j.status));
        return text({
          api_key: "valid",
          recent_lists: items.length,
          addresses_submitted_in_recent_lists: submitted,
          lists_in_progress: running.map((j) => ({ job_id: j.id, name: j.name, total: j.total, done: j.done })),
          latest_lists: items.slice(0, 5).map((j) => ({ job_id: j.id, name: j.name, status: j.status, total: j.total, valid: j.valid, invalid: j.invalid, created_at: j.created_at })),
          balance:
            "Exact remaining credits are not available through the API yet. Free accounts include 100 checks once; workspaces on a dedicated node verify within their node plan. If you run out, verify calls return a message with the number of free checks remaining. See https://emailverifyfast.com/plans and your dashboard.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

function extractKey(request: Request, url: URL): string | null {
  const auth = request.headers.get("authorization") || "";
  if (/^bearer\s+/i.test(auth)) {
    const k = auth.replace(/^bearer\s+/i, "").trim();
    if (k) return k;
  }
  const x = request.headers.get("x-api-key");
  if (x) return x.trim();
  const q = url.searchParams.get("key") || url.searchParams.get("api_key");
  return q ? q.trim() : null;
}

const LANDING = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EmailVerifyFast MCP server</title>
<style>body{font:16px/1.55 system-ui,-apple-system,sans-serif;max-width:680px;margin:48px auto;padding:0 20px;color:#111}code,pre{background:#f4f4f5;border-radius:6px}code{padding:2px 5px}pre{padding:12px;overflow:auto}h1{font-size:24px}</style></head><body>
<h1>EmailVerifyFast MCP server</h1>
<p>Verify email addresses from Claude, ChatGPT, Cursor and other AI assistants.</p>
<p><strong>Server URL:</strong> <code>https://mcp.emailverifyfast.com/mcp</code></p>
<p>You need an EmailVerifyFast API key: <a href="https://emailverifyfast.com/register">create an account</a>, then add a key under <a href="https://emailverifyfast.com/api-access">API access</a>.</p>
<p>Send the key as <code>Authorization: Bearer YOUR_KEY</code>, or if your app only accepts a URL, use <code>https://mcp.emailverifyfast.com/mcp?key=YOUR_KEY</code> (keep that URL private).</p>
<p>Tools: <code>verify_email</code>, <code>verify_list</code> (up to ${MAX_LIST} addresses), <code>get_results</code>, <code>check_credits</code>.</p>
<pre>{
  "mcpServers": {
    "emailverifyfast": {
      "url": "https://mcp.emailverifyfast.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_KEY" }
    }
  }
}</pre>
<p><a href="https://emailverifyfast.com">emailverifyfast.com</a></p></body></html>`;

const ALLOWED_HOSTS = ["mcp.emailverifyfast.com", "emailverifyfast-mcp.sagebond.workers.dev", "localhost", "127.0.0.1"];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(LANDING, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
    }
    if (url.pathname === "/health") {
      return Response.json({ ok: true, version: VERSION });
    }
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      const key = extractKey(request, url);
      // Strip the key from the URL and headers before handing the request to the MCP transport.
      url.searchParams.delete("key");
      url.searchParams.delete("api_key");
      url.pathname = "/mcp";
      const headers = new Headers(request.headers);
      headers.delete("authorization");
      headers.delete("x-api-key");
      const clean = new Request(url.toString(), { method: request.method, headers, body: request.body, redirect: "manual" });
      const handler = createMcpHandler(() => createServer(env, key), {
        route: "/mcp",
        allowedHostnames: ALLOWED_HOSTS,
        onerror: (err) => console.error("mcp error:", err?.name || "Error"),
      });
      return handler(clean, env, ctx);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
