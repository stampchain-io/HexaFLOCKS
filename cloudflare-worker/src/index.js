function corsHeaders(env) {
  const origin = env.ALLOWED_ORIGIN || "*";
  return {
    "content-type": "application/json",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "*",
  };
}

async function readJson(req) {
  try {
    return await req.json();
  } catch (_) {
    return null;
  }
}

async function proxyBuilder(env, path, payload) {
  const base = (env.TX_BUILDER_URL || "").replace(/\/$/, "");
  const url = base + path;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(data?.error || `upstream_error_${res.status}`);
  }
  return data;
}

async function incrementMinted(env) {
  // Best-effort increment; KV has eventual consistency and no atomic inc.
  for (let i = 0; i < 3; i++) {
    const cur = parseInt((await env.MINTED.get("minted")) || "0", 10) || 0;
    const next = String(cur + 1);
    await env.MINTED.put("minted", next);
    // No CAS; just write and return.
    return cur + 1;
  }
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
  if (minted >= max) {
    // Cap reached; record seen but do not increment supply.
    await env.MINTED.put(key, "1");
    return { minted: false, cap: true };
  }
  await env.MINTED.put(key, "1");
  await incrementMinted(env);
  return { minted: true };
}

function makeSessionId() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  if (env.MINTED.delete) {
    await env.MINTED.delete(key);
  } else {
    // Fallback: overwrite and let TTL expire
    await env.MINTED.put(key, "0", { expirationTtl: 1 });
  }
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, "");

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (pathname === "" || pathname === "/") {
      return new Response(
        JSON.stringify({
          name: "hexaflock-worker",
          ok: true,
          endpoints: ["/health", "/config", "/supply", "/psbt", "/mint", "/broadcast", "/fee_estimate"],
        }),
        { headers: corsHeaders(env) }
      );
    }

    if (pathname === "/health") {
      // Basic health with KV check; upstream is best-effort ping
      let kvOk = false;
      try { await env.MINTED.get("__healthcheck__"); kvOk = true; } catch (_) {}
      let upstreamOk = false;
      try {
        const base = (env.TX_BUILDER_URL || "").replace(/\/$/, "");
        if (base) {
          const r = await fetch(base, { method: "HEAD" });
          upstreamOk = r.ok;
        }
      } catch (_) {}
      return new Response(JSON.stringify({ ok: true, kv: kvOk, upstream: upstreamOk }), {
        headers: corsHeaders(env),
      });
    }

    if (pathname === "/config") {
      return new Response(
        JSON.stringify({
          network: env.BITCOIN_NETWORK || "testnet",
          tx_builder_url: env.TX_BUILDER_URL || null,
          max_flocks: parseInt(env.MAX_FLOCKS || "10000", 10),
        }),
        { headers: corsHeaders(env) }
      );
    }

    if (pathname === "/supply") {
      try {
        const s = await getSupply(env);
        return new Response(
          JSON.stringify(s),
          { headers: corsHeaders(env) }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ error: "failed_to_read_supply", message: String(e) }),
          { status: 500, headers: corsHeaders(env) }
        );
      }
    }

    if (pathname === "/psbt" && request.method === "POST") {
      try {
        const s = await getSupply(env);
        if (s.minted >= s.max) {
          return new Response(JSON.stringify({ error: "sold_out", message: "Max supply reached" }), { status: 403, headers: corsHeaders(env) });
        }
        const body = (await readJson(request)) || {};
        const payload = {
          image_base64: body.image_base64,
          metadata: body.metadata,
          network: env.BITCOIN_NETWORK || "testnet",
          fee_rate_sat_vb: Number(body.fee_rate_sat_vb || env.FEE_RATE_SAT_VB || "5"),
          creator_address: env.CREATOR_ADDRESS,
          creator_tip_sats: Number(env.CREATOR_TIP_SATS || "0"),
        };
        const data = await proxyBuilder(env, env.TX_BUILDER_PSBT_PATH || "/api/psbt", payload);
        const session = await createSession(env);
        return new Response(JSON.stringify({ ...data, session }), { headers: corsHeaders(env) });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: corsHeaders(env) });
      }
    }

    if (pathname === "/broadcast" && request.method === "POST") {
      try {
        const body = (await readJson(request)) || {};
        const payload = { tx_hex: body.tx_hex };
        const data = await proxyBuilder(env, env.TX_BUILDER_BROADCAST_PATH || "/api/broadcast", payload);
        const txid = data.txid || data.tx_hash || null;
        const okSession = await consumeSession(env, body.session);
        if (okSession) {
          await incrementIfNotSeen(env, txid);
        }
        return new Response(JSON.stringify(data), { headers: corsHeaders(env) });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: corsHeaders(env) });
      }
    }

    if (pathname === "/mint" && request.method === "POST") {
      // Convenience: create a PSBT; user signs and then hits /broadcast
      try {
        const s = await getSupply(env);
        if (s.minted >= s.max) {
          return new Response(JSON.stringify({ error: "sold_out", message: "Max supply reached" }), { status: 403, headers: corsHeaders(env) });
        }
        const body = (await readJson(request)) || {};
        const payload = {
          image_base64: body.image_base64,
          metadata: body.metadata,
          network: env.BITCOIN_NETWORK || "testnet",
          fee_rate_sat_vb: Number(body.fee_rate_sat_vb || env.FEE_RATE_SAT_VB || "5"),
          creator_address: env.CREATOR_ADDRESS,
          creator_tip_sats: Number(env.CREATOR_TIP_SATS || "0"),
        };
        const data = await proxyBuilder(env, env.TX_BUILDER_PSBT_PATH || "/api/psbt", payload);
        const session = await createSession(env);
        return new Response(JSON.stringify({ psbt: data.psbt || data.PSBT || data, session }), { headers: corsHeaders(env) });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: corsHeaders(env) });
      }
    }

    if (pathname === "/fee_estimate" && request.method === "POST") {
      try {
        const s = await getSupply(env);
        if (s.minted >= s.max) {
          return new Response(JSON.stringify({ error: "sold_out", message: "Max supply reached" }), { status: 403, headers: corsHeaders(env) });
        }
        const body = (await readJson(request)) || {};
        // Try upstream estimate via PSBT with flag; fall back to simple fee calc
        try {
          const payload = {
            image_base64: body.image_base64,
            estimate_only: true,
            network: env.BITCOIN_NETWORK || "testnet",
            fee_rate_sat_vb: Number(body.fee_rate_sat_vb || env.FEE_RATE_SAT_VB || "5"),
          };
          const data = await proxyBuilder(env, env.TX_BUILDER_PSBT_PATH || "/api/psbt", payload);
          if (typeof data.estimated_sats === "number") {
            return new Response(JSON.stringify({ estimated_sats: data.estimated_sats }), { headers: corsHeaders(env) });
          }
        } catch (_) {}

        // Fallback naive estimate
        const feeRate = Number(body.fee_rate_sat_vb || env.FEE_RATE_SAT_VB || "5");
        const vbytes = 2500; // heuristic placeholder
        return new Response(JSON.stringify({ estimated_sats: Math.round(feeRate * vbytes) }), { headers: corsHeaders(env) });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: corsHeaders(env) });
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders(env) });
  },
};
