export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, "");

    if (pathname === "" || pathname === "/") {
      return new Response(
        JSON.stringify({
          name: "hexaflock-worker",
          ok: true,
          endpoints: ["/health", "/supply"],
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (pathname === "/supply") {
      try {
        const max = parseInt(env.MAX_FLOCKS || "10000", 10);
        const mintedRaw = (await env.MINTED.get("minted")) || "0";
        const minted = parseInt(mintedRaw, 10) || 0;
        const remaining = Math.max(0, max - minted);
        return new Response(
          JSON.stringify({ minted, remaining, max }),
          { headers: { "content-type": "application/json" } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ error: "failed_to_read_supply", message: String(e) }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

