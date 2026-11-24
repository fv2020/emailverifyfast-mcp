// Minimal mock of the EmailVerifyFast public API for local testing.
import http from "node:http";
const KEY = "evf_test_key_123";
const jobs = new Map();
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const classify = (e) => e.includes("bad") ? ["invalid","mailbox_not_found","550 5.1.1 user unknown"] : e.endsWith("@catchall.test") ? ["catch_all","catch_all",""] : ["valid","mailbox_exists","250 2.1.5 OK"];
http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const auth = req.headers.authorization || "";
  console.log(req.method, req.url, "auth-ok=" + (auth === "Bearer " + KEY));
  if (auth !== "Bearer " + KEY) return send(res, 401, { detail: "Invalid or revoked API key." });
  const u = new URL(req.url, "http://x");
  if (req.method === "POST" && u.pathname === "/api/verify") {
    const { email } = JSON.parse(body); const id = crypto.randomUUID();
    jobs.set(id, { id, name: email, status: "queued", emails: [email], created: Date.now() });
    return send(res, 202, { id, url: "/lists/" + id });
  }
  if (req.method === "POST" && u.pathname === "/api/lists") {
    const { name, emails } = JSON.parse(body); const uniq = [...new Set(emails)];
    if (uniq.length > 100) return send(res, 402, { detail: "You have 100 free checks remaining. A dedicated node is required for more." });
    const id = crypto.randomUUID();
    jobs.set(id, { id, name, status: "queued", emails: uniq, dups: emails.length - uniq.length, created: Date.now() });
    return send(res, 202, { id, url: "/lists/" + id, duplicates: emails.length - uniq.length });
  }
  if (req.method === "GET" && u.pathname === "/api/lists") {
    return send(res, 200, { items: [...jobs.values()].map(j => ({ id: j.id, name: j.name, status: j.status, total: j.emails.length, done: j.emails.length, valid: 1, invalid: 0, created_at: new Date(j.created).toISOString() })) });
  }
  const m = u.pathname.match(/^\/api\/lists\/([0-9a-f-]+)$/);
  if (req.method === "GET" && m) {
    const j = jobs.get(m[1]); if (!j) return send(res, 404, { detail: "List not found." });
    const done = Date.now() - j.created > 3000; if (done) j.status = "completed";
    const counts = { valid: 0, invalid: 0, catch_all: 0, accepted: 0, unknown: 0, pending: 0, processing: 0, cancelled: 0 };
    for (const e of j.emails) counts[done ? classify(e)[0] : "pending"]++;
    return send(res, 200, { id: j.id, name: j.name, status: j.status, total: j.emails.length, duplicates: j.dups || 0, created_at: new Date(j.created).toISOString(), finished_at: done ? new Date().toISOString() : null, counts, retryable_count: 0 });
  }
  if (req.method === "GET" && u.pathname === "/api/results") {
    const j = jobs.get(u.searchParams.get("job_id")); if (!j) return send(res, 404, { detail: "List not found." });
    const page = +u.searchParams.get("page") || 1; const st = u.searchParams.get("status");
    let items = j.emails.map(e => { const [s, r, resp] = classify(e); return { email: e, status: s, reason: r, response: resp, mx_host: "mx." + e.split("@")[1], checked_at: new Date().toISOString(), evidence: { big: "x".repeat(100) } }; });
    if (st) items = items.filter(i => i.status === st);
    return send(res, 200, { items: items.slice((page - 1) * 50, page * 50), total: items.length, page, pages: Math.max(1, Math.ceil(items.length / 50)) });
  }
  send(res, 404, { detail: "Not found" });
}).listen(8788, () => console.log("mock EVF on :8788"));
