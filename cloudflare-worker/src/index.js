function corsHeaders(env, req) {
  const allow = (env.ALLOWED_ORIGIN || "*").trim();
  let originHeader = "*";
  if (allow !== "*") {
    const reqOrigin = req?.headers?.get?.("Origin") || "";
    const allowed = allow.split(/[,\s]+/).filter(Boolean);
    originHeader = allowed.includes(reqOrigin) ? reqOrigin : "null";
  }
  return {
    "content-type": "application/json",
    "access-control-allow-origin": originHeader,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "*",
  };
}

async function readJson(req) {
  try { return await req.json(); } catch { return null; }
}

async function proxyJson(baseUrl, path, payload) {
  const base = (baseUrl || "").replace(/\/$/, "");
  const url = base + path;
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload || {}) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || `upstream_error_${res.status}`);
  return data;
}

async function incrementMinted(env) {
  const cur = parseInt((await env.MINTED.get("minted")) || "0", 10) || 0;
  const next = String(cur + 1);
  await env.MINTED.put("minted", next);
  return cur + 1;
}

async function getSupply(env) {
  const max = parseInt(env.MAX_FLOCKS || "10000", 10);
  const mintedRaw = (await env.MINTED.get("minted")) || "0";
  const minted = parseInt(mintedRaw, 10) || 0;
  const remaining = Math.max(0, max - minted);
  return { minted, remaining, max };
}

async function incrementIfNotSeen(env, txid) {
  if (!txid) return { minted: false };
  const key = `seen:${txid}`;
  const seen = await env.MINTED.get(key);
  if (seen) return { minted: false, seen: true };
  const { minted, max } = await getSupply(env);
  if (minted >= max) { await env.MINTED.put(key, "1"); return { minted: false, cap: true }; }
  await env.MINTED.put(key, "1");
  await incrementMinted(env);
  return { minted: true };
}

function makeSessionId() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function createSession(env) {
  const id = makeSessionId();
  await env.MINTED.put(`session:${id}`, "1", { expirationTtl: 3600 });
  return id;
}

async function consumeSession(env, id) {
  if (!id) return false;
  const key = `session:${id}`;
  const exists = await env.MINTED.get(key);
  if (!exists) return false;
  if (env.MINTED.delete) await env.MINTED.delete(key); else await env.MINTED.put(key, "0", { expirationTtl: 1 });
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, "");

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(env, request) });

    if (pathname === "" || pathname === "/") {
      return new Response(JSON.stringify({ name: "hexaflock-worker", ok: true, endpoints: ["/health", "/config", "/supply", "/psbt", "/mint", "/broadcast", "/fee_estimate"] }), { headers: corsHeaders(env, request) });
    }

    if (pathname === "/health") {
      let kvOk = false; try { await env.MINTED.get("__healthcheck__"); kvOk = true; } catch {}
      let upstreamOk = false; try { const base = (env.TX_BUILDER_URL || "").replace(/\/$/, ""); if (base) { const r = await fetch(base, { method: "HEAD" }); upstreamOk = r.ok; } } catch {}
      return new Response(JSON.stringify({ ok: true, kv: kvOk, upstream: upstreamOk }), { headers: corsHeaders(env, request) });
    }

    if (pathname === "/config") {
      return new Response(JSON.stringify({ network: env.BITCOIN_NETWORK || "mainnet", tx_builder_url: env.TX_BUILDER_URL || null, max_flocks: parseInt(env.MAX_FLOCKS || "10000", 10) }), { headers: corsHeaders(env, request) });
    }

    if (pathname === "/supply") {
      try { const s = await getSupply(env); return new Response(JSON.stringify(s), { headers: corsHeaders(env, request) }); }
      catch (e) { return new Response(JSON.stringify({ error: "failed_to_read_supply", message: String(e) }), { status: 500, headers: corsHeaders(env, request) }); }
    }

    if (pathname === "/psbt" && request.method === "POST") {
      try {
        const s = await getSupply(env); if (s.minted >= s.max) return new Response(JSON.stringify({ error: "sold_out", message: "Max supply reached" }), { status: 403, headers: corsHeaders(env, request) });
        const body = (await readJson(request)) || {};
        const fee = Number(body.fee_rate_sat_vb || env.FEE_RATE_SAT_VB || "5");
        const filename = body.filename || "hexaflock.png";
        const sourceWallet = body.source_wallet || body.sourceWallet;
        if (!sourceWallet) return new Response(JSON.stringify({ error: "missing_source_wallet" }), { status: 400, headers: corsHeaders(env, request) });
        const payload = { sourceWallet, qty: Number(body.qty || 1), locked: true, divisible: false, filename, file: body.image_base64, satsPerVB: fee };
        const data = await proxyJson(env.TX_BUILDER_URL, env.TX_BUILDER_PSBT_PATH, payload);
        const session = await createSession(env);
        const resp = { psbt: data.hex || data.psbt || data.PSBT || data, session };
        return new Response(JSON.stringify(resp), { headers: corsHeaders(env, request) });
      } catch (e) { return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: corsHeaders(env, request) }); }
    }

    if (pathname === "/broadcast" && request.method === "POST") {
      try {
        const body = (await readJson(request)) || {};
        const txHex = body.tx_hex || body.tx || body.hex;
        if (!txHex) return new Response(JSON.stringify({ error: "missing_tx_hex" }), { status: 400, headers: corsHeaders(env, request) });
        const bbase = (env.TX_BROADCAST_URL || "").replace(/\/$/, "");
        const burl = bbase + (env.TX_BROADCAST_PATH || "/api/tx");
        const res = await fetch(burl, { method: "POST", headers: { "content-type": "text/plain" }, body: txHex });
        const txidText = await res.text();
        if (!res.ok) throw new Error(txidText || `broadcast_error_${res.status}`);
        const data = { txid: txidText.trim() };
        const okSession = await consumeSession(env, body.session);
        if (okSession) await incrementIfNotSeen(env, data.txid);
        return new Response(JSON.stringify(data), { headers: corsHeaders(env, request) });
      } catch (e) { return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: corsHeaders(env, request) }); }
    }

    if (pathname === "/mint" && request.method === "POST") {
      try {
        const s = await getSupply(env); if (s.minted >= s.max) return new Response(JSON.stringify({ error: "sold_out", message: "Max supply reached" }), { status: 403, headers: corsHeaders(env, request) });
        const body = (await readJson(request)) || {};
        const fee = Number(body.fee_rate_sat_vb || env.FEE_RATE_SAT_VB || "5");
        const filename = body.filename || "hexaflock.png";
        const sourceWallet = body.source_wallet || body.sourceWallet;
        if (!sourceWallet) return new Response(JSON.stringify({ error: "missing_source_wallet" }), { status: 400, headers: corsHeaders(env, request) });
        const payload = { sourceWallet, qty: Number(body.qty || 1), locked: true, divisible: false, filename, file: body.image_base64, satsPerVB: fee };
        const data = await proxyJson(env.TX_BUILDER_URL, env.TX_BUILDER_PSBT_PATH, payload);
        const session = await createSession(env);
        return new Response(JSON.stringify({ psbt: data.hex || data.psbt || data.PSBT || data, session }), { headers: corsHeaders(env, request) });
      } catch (e) { return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: corsHeaders(env, request) }); }
    }

    if (pathname === "/fee_estimate" && request.method === "POST") {
      try {
        const s = await getSupply(env); if (s.minted >= s.max) return new Response(JSON.stringify({ error: "sold_out", message: "Max supply reached" }), { status: 403, headers: corsHeaders(env, request) });
        const body = (await readJson(request)) || {};
        const feeRate = Number(body.fee_rate_sat_vb || env.FEE_RATE_SAT_VB || "5");
        const vbytes = 2500; // heuristic placeholder
        return new Response(JSON.stringify({ estimated_sats: Math.round(feeRate * vbytes) }), { headers: corsHeaders(env, request) });
      } catch (e) { return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: corsHeaders(env, request) }); }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders(env, request) });
  },
};

