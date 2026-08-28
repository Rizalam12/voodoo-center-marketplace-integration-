require("dotenv").config();
const http = require("node:http");
const { getAccount } = require("./voodoo");
const {
  downloadCatalog,
  inspectCatalog,
  searchCatalog,
  catalogStatus,
  importProducts,
  searchImported,
  getStats,
} = require("./catalog");
const { sendTelegramMessage, formatWebhook } = require("./telegram");
const {
  verifySignature,
  markProcessed,
  alreadyProcessed,
} = require("./webhook");
const {
  testConnection,
  getCategories,
  createOffer,
  selectTestProduct,
  buildOfferPayload,
  validateOfferPayload,
  sanitizeProduct,
  dryRun,
  recordNotification,
  getOffer,
  patchOffer,
  buildWebhookNotificationSettings,
} = require("./ggsel");
const { handleNotification, parseNotification } = require("./ggsel-orders");
const PORT = Number(process.env.PORT || 3000);
const json = (r, c, b) => {
  const p = JSON.stringify(b);
  r.writeHead(c, { "Content-Type": "application/json; charset=utf-8" });
  r.end(p);
};
const auth = (q) => {
  const s = process.env.ADMIN_SECRET?.trim();
  return !s || q.headers["x-admin-secret"] === s;
};
const raw = (q) =>
  new Promise((res, rej) => {
    const a = [];
    let n = 0;
    q.on("data", (c) => {
      n += c.length;
      if (n > 1048576) {
        rej(Error("Request body too large."));
        q.destroy();
      } else a.push(c);
    });
    q.on("end", () => res(Buffer.concat(a)));
    q.on("error", rej);
  });
http
  .createServer(async (q, r) => {
    try {
      const pathname = new URL(q.url, "http://localhost").pathname;
      if (q.method === "GET" && q.url === "/")
        return json(r, 200, {
          status: "ok",
          service: "Voodoo Center integration",
        });
      if (q.method === "GET" && pathname === "/health")
        return json(r, 200, { ok: true, service: "voodoo-center-integration" });
      if (q.method === "GET" && q.url === "/api/account")
        return json(r, 200, { ok: true, account: await getAccount() });
      if (q.method === "POST" && q.url === "/admin/catalog/refresh") {
        if (!auth(q)) return json(r, 403, { ok: false, error: "Forbidden" });
        return json(r, 200, {
          ok: true,
          ...(await downloadCatalog()),
          status: catalogStatus(),
        });
      }
      if (q.method === "GET" && q.url === "/admin/catalog/status") {
        if (!auth(q)) return json(r, 403, { ok: false, error: "Forbidden" });
        return json(r, 200, { ok: true, status: catalogStatus() });
      }
      if (q.method === "GET" && q.url === "/admin/catalog/inspect") {
        if (!auth(q)) return json(r, 403, { ok: false, error: "Forbidden" });
        return json(r, 200, { ok: true, ...inspectCatalog() });
      }
      if (q.method === "POST" && q.url === "/admin/catalog/import") {
        if (!auth(q)) return json(r, 403, { ok: false, error: "Forbidden" });
        return json(r, 200, { ok: true, stats: await importProducts() });
      }
      if (q.method === "GET" && q.url === "/admin/catalog/stats") {
        if (!auth(q)) return json(r, 403, { ok: false, error: "Forbidden" });
        return json(r, 200, { ok: true, stats: getStats() });
      }
      if (q.method === "GET" && q.url.startsWith("/admin/catalog/search")) {
        if (!auth(q)) return json(r, 403, { ok: false, error: "Forbidden" });
        const u = new URL(q.url, "http://localhost"),
          term = u.searchParams.get("q") || "";
        return json(r, 200, {
          ok: true,
          source: "imported-product-database",
          query: term,
          products: searchImported(term),
        });
      }
      if (q.method === "POST" && q.url === "/admin/test-telegram") {
        if (!auth(q)) return json(r, 403, { ok: false, error: "Forbidden" });
        const telegram = await sendTelegramMessage(
          "TEST NOTIFICATION - NOT A REAL VOODOO ORDER\n\n🛒 VOODOO CENTER TEST\n\nTelegram connectivity test only.",
        );
        return json(r, 200, { ok: telegram, telegram });
      }
      if (q.method === "POST" && q.url === "/admin/test") {
        if (!auth(q)) return json(r, 403, { ok: false, error: "Forbidden" });
        let voodoo = false,
          telegram = false;
        try {
          await getAccount();
          voodoo = true;
        } catch (e) {
          console.error("[voodoo]", e.message);
        }
        try {
          telegram = await sendTelegramMessage(
            `TEST NOTIFICATION - NOT A REAL VOODOO ORDER\n\n🛒 VOODOO CENTER TEST\n\nVoodoo API: ${voodoo ? "CONNECTED" : "FAILED"}\nNo order was created and no balance was spent.`,
          );
        } catch (e) {
          console.error("[telegram]", e.message);
        }
        return json(r, 200, { ok: voodoo && telegram, voodoo, telegram });
      }
      if (q.method === "POST" && q.url === "/admin/ggsel/test") {
        if (!auth(q)) return json(r, 403, { ok: false, error: "Forbidden" });
        await testConnection();
        return json(r, 200, { ok: true, ggsel: true });
      }
      if (q.method === "GET" && q.url === "/admin/ggsel/categories") {
        if (!auth(q)) return json(r, 403, { ok: false, error: "Forbidden" });
        return json(r, 200, { ok: true, ...(await getCategories()) });
      }
      if (q.method === "POST" && q.url === "/admin/ggsel/test-offer/dry-run") {
        if (!auth(q)) return json(r, 403, { ok: false, error: "Forbidden" });
        return json(r, 200, { ok: true, ...(await dryRun()) });
      }
      if (q.method === "POST" && q.url === "/admin/ggsel/test-offer") {
        if (!auth(q)) return json(r, 403, { ok: false, error: "Forbidden" });
        if (process.env.ENABLE_VOODOO_ORDERS !== "false")
          return json(r, 409, { ok: false, error: "Refusing GGsel offer creation unless ENABLE_VOODOO_ORDERS=false." });
        const product = selectTestProduct();
        const payload = buildOfferPayload(product);
        validateOfferPayload(payload);
        const result = await createOffer(payload);
        return json(r, 200, { ok: true, created: true, product: sanitizeProduct(product), ggsel: result });
      }
      if (q.method === "POST" && q.url === "/admin/ggsel/webhook-test") {
        if (!auth(q)) return json(r, 403, { ok: false, error: "Forbidden" });
        const b = await raw(q);
        let notification;
        try { notification = JSON.parse(b.toString("utf8")); } catch { return json(r, 400, { ok: false, error: "Invalid JSON" }); }
        if (!notification || typeof notification !== "object" || Array.isArray(notification)) return json(r, 400, { ok: false, error: "Invalid notification" });
        return json(r, 200, { ok: true, parsed: parseNotification(notification, b) });
      }
      if (q.method === "POST" && q.url === "/webhooks/ggsel") {
        const b = await raw(q);
        let notification;
        try {
          notification = JSON.parse(b.toString("utf8"));
        } catch {
          return json(r, 400, { ok: false, error: "Invalid JSON" });
        }
        if (!notification || typeof notification !== "object" || Array.isArray(notification))
          return json(r, 400, { ok: false, error: "Invalid notification" });
        const result = await handleNotification(notification, b);
        return json(r, 200, { ok: true, ...result });
      }
      if (q.method === "POST" && q.url === "/webhooks/voodoo-center") {
        const b = await raw(q);
        if (!verifySignature(b, q.headers["x-signature"] || ""))
          return json(r, 401, { ok: false, error: "Invalid signature" });
        let e;
        try {
          e = JSON.parse(b.toString("utf8"));
        } catch {
          return json(r, 400, { ok: false, error: "Invalid JSON" });
        }
        if (!e.order_id)
          return json(r, 400, { ok: false, error: "Missing order_id" });
        if (alreadyProcessed(e.order_id))
          return json(r, 200, { ok: true, duplicate: true });
        markProcessed(e.order_id);
        try {
          await sendTelegramMessage(formatWebhook(e));
        } catch (x) {
          console.error("[telegram]", x.message);
        }
        return json(r, 200, { ok: true });
      }
      return json(r, 404, { ok: false, error: "Not found" });
    } catch (e) {
      console.error("[server]", e.message);
      return json(r, 500, { ok: false, error: "Request failed" });
    }
  })
  .listen(PORT, "0.0.0.0", () =>
    console.log(`Voodoo Center integration listening on port ${PORT}`),
  );
