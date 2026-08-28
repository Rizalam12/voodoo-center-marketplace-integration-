require("dotenv").config();
const {
  inspectCatalog,
  searchCatalog,
  importProducts,
  searchImported,
  getStats,
  analyzeImported,
  buildResellerCatalog,
  getResellerStats,
  searchReseller,
} = require("./catalog");
const {
  testConnection,
  getCategories,
  searchCategories,
  createOffer,
  selectTestProduct,
  buildOfferPayload,
  validateOfferPayload,
  sanitizeProduct,
  dryRun,
  getOffer,
  patchOffer,
  buildWebhookNotificationSettings,
} = require("./ggsel");
const { parseNotification, handleNotification } = require("./ggsel-orders");
const { fulfillVoodooProduct } = require("./fulfillment/voodoo");
const [c, ...a] = process.argv.slice(2);
(async () => {
  try {
    if (c === "inspect") console.log(JSON.stringify(inspectCatalog(), null, 2));
    else if (c === "search") {
      const q = a.join(" ").trim();
      if (!q) throw Error("Usage: npm run catalog:search -- youtube");
      console.log(JSON.stringify(searchCatalog(q), null, 2));
    } else if (c === "import") {
      console.log("Importing catalog. Read-only; no orders are created.");
      console.log(JSON.stringify(await importProducts(), null, 2));
    } else if (c === "stats") console.log(JSON.stringify(getStats(), null, 2));
    else if (c === "analyze")
      console.log(JSON.stringify(analyzeImported(), null, 2));
    else if (c === "build-reseller") {
      console.log(
        "Building reseller catalog. Read-only; no marketplace publishing and no Voodoo orders.",
      );
      console.log(JSON.stringify(await buildResellerCatalog(), null, 2));
    } else if (c === "reseller-stats")
      console.log(JSON.stringify(getResellerStats(), null, 2));
    else if (c === "all") {
      console.log(
        "Use the following safe sequence: refresh via /admin/catalog/refresh, then npm run catalog:import, then npm run catalog:analyze, then npm run reseller:build.",
      );
    } else if (c === "reseller-search") {
      const q = a.join(" ").trim();
      if (!q) throw Error("Usage: npm run reseller:search -- youtube");
      console.log(JSON.stringify(searchReseller(q), null, 2));
    } else if (c === "ggsel-test") {
      await testConnection();
      console.log(JSON.stringify({ ok: true, ggsel: true }));
    } else if (c === "ggsel-categories") {
      console.log(JSON.stringify(await getCategories(), null, 2));
    } else if (c === "ggsel-category-search") {
      const q = a.join(" ").trim();
      if (!q) throw Error("Usage: npm run ggsel:category-search -- steam");
      console.log(JSON.stringify(await searchCategories(q), null, 2));
    } else if (c === "ggsel-dry-run") {
      console.log(JSON.stringify(await dryRun(), null, 2));
    } else if (c === "ggsel-test-offer") {
      if (process.env.ENABLE_VOODOO_ORDERS !== "false")
        throw Error("Refusing GGsel offer creation unless ENABLE_VOODOO_ORDERS=false.");
      const product = selectTestProduct();
      const payload = buildOfferPayload(product);
      validateOfferPayload(payload);
      const result = await createOffer(payload);
      console.log(JSON.stringify({ created: true, product: sanitizeProduct(product), ggsel: result }, null, 2));
    } else if (c === "ggsel:inspect-offer" || c === "ggsel-inspect-offer") {
      const id = a[0];
      if (!id) throw Error("Usage: npm run ggsel:inspect-offer -- 102794960");
      console.log(JSON.stringify(await getOffer(id), null, 2));
    } else if (c === "ggsel-configure-webhook") {
      const id = a[0];
      if (!id) throw Error("Usage: npm run ggsel:configure-webhook -- 102794960 [--confirm]");
      const payload = { notification_settings: buildWebhookNotificationSettings(), post_payment_url: process.env.GGSEL_POST_PAYMENT_TEST_URL?.trim() || null };
      if (!a.includes("--confirm")) {
        console.log(JSON.stringify({ offer_id: id, would_patch: payload, confirmed: false }, null, 2));
      } else {
        console.log(JSON.stringify({ offer_id: id, patched: true, ggsel: await patchOffer(id, payload) }, null, 2));
      }
    } else if (c === "ggsel-webhook-test") {
      const raw = a.join(" ").trim();
      if (!raw) throw Error("Usage: npm run ggsel:webhook-test -- '{\"invoice_id\":\"123\"}'");
      let notification;
      try { notification = JSON.parse(raw); } catch { throw Error("Webhook test input must be valid JSON."); }
      if (!notification || typeof notification !== "object" || Array.isArray(notification)) throw Error("Webhook test input must be a JSON object.");
      console.log(JSON.stringify({ parsed: parseNotification(notification, Buffer.from(raw)), pipeline: await handleNotification(notification, Buffer.from(raw)) }, null, 2));
    } else if (c === "ggsel-fulfillment-test") {
      console.log(JSON.stringify(await fulfillVoodooProduct({ internal_order_id: "local-test", voodoo_product_id: 695585, quantity: 1, required_fields: [] }), null, 2));
    } else
      console.log(
        "Usage: npm run catalog:inspect | search -- <q> | import | stats",
      );
  } catch (e) {
    console.error("Catalog error:", e.message);
    process.exit(1);
  }
})();
