const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { getPurchaseInfo } = require("./ggsel");
const { fulfillVoodooProduct } = require("./fulfillment/voodoo");

const DATA = path.join(process.cwd(), "data");
const EVENTS = path.join(DATA, "ggsel-events.jsonl");
const ORDERS = path.join(DATA, "orders.jsonl");
const MAP_FILE = path.join(DATA, "ggsel-product-map.json");
const DEFAULT_MAP_FILE = path.join(__dirname, "ggsel-product-map.json");
const RESELLER = path.join(DATA, "reseller-products.jsonl");

function loadMap() {
  for (const file of [MAP_FILE, DEFAULT_MAP_FILE]) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  }
  return {};
}
function resellerProduct(voodooId) {
  if (!fs.existsSync(RESELLER)) return null;
  return fs.readFileSync(RESELLER, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).find((product) => String(product.voodoo_id) === String(voodooId)) || null;
}
function safeValue(value) {
  if (Array.isArray(value)) return value.map(safeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/authorization|api[_-]?key|token|secret|password/i.test(key)).map(([key, item]) => [key, safeValue(item)]));
}
function eventId(raw) {
  return `ggsel_evt_${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24)}`;
}
function first(object, keys) {
  for (const key of keys) if (object?.[key] !== undefined && object[key] !== null && object[key] !== "") return object[key];
  return null;
}
function parseNotification(notification, raw) {
  const safe = safeValue(notification);
  const invoiceId = first(notification, ["invoice_id"]);
  const orderId = first(notification, ["order_id"]);
  const externalId = invoiceId ?? orderId;
  const offerId = first(notification, ["offer_id"]);
  const mapping = offerId === null ? null : loadMap()[String(offerId)] || null;
  const metadata = mapping ? resellerProduct(mapping.voodoo_id) : null;
  const product = mapping ? { voodoo_product_id: mapping.voodoo_id, required_fields: metadata?.required_fields || [] } : null;
  return {
    internal_event_id: eventId(raw),
    ggsel_invoice_id: invoiceId,
    ggsel_order_id: orderId,
    ggsel_offer_id: offerId,
    product,
    status: first(notification, ["status"]),
    quantity: first(notification, ["quantity"]),
    customer_order_id: first(notification, ["customer_order_id"]),
    external_identifier_present: externalId !== null,
    raw_notification: safe,
  };
}
function appendJsonLine(file, value) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + "\n");
}
function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
function eventAlreadyRecorded(id) {
  return readJsonLines(EVENTS).some((event) => event.internal_event_id === id);
}
function createOrderRecord(parsed, notification) {
  const mapping = parsed.product;
  if (!parsed.external_identifier_present || !mapping) return null;
  const now = new Date().toISOString();
  const requiredFields = Array.isArray(mapping.required_fields) ? mapping.required_fields : [];
  const fulfillmentStatus = requiredFields.length ? "awaiting_customer_info" : "fulfillment_disabled";
  const order = {
    internal_order_id: `ggsel_order_${String(parsed.ggsel_invoice_id ?? parsed.ggsel_order_id)}`,
    ggsel_invoice_id: parsed.ggsel_invoice_id,
    ggsel_order_id: parsed.ggsel_order_id,
    ggsel_offer_id: parsed.ggsel_offer_id,
    voodoo_product_id: mapping.voodoo_product_id,
    quantity: parsed.quantity,
    ggsel_price: first(notification, ["price", "amount"]),
    currency: first(notification, ["currency"]),
    status: parsed.status || "received",
    received_at: now,
    updated_at: now,
    fulfillment_status: fulfillmentStatus,
  };
  const existing = readJsonLines(ORDERS);
  const existingIndex = existing.findIndex((item) => item.internal_order_id === order.internal_order_id);
  if (existingIndex >= 0) {
    existing[existingIndex] = { ...existing[existingIndex], ...order };
    fs.writeFileSync(ORDERS, existing.map((item) => JSON.stringify(item)).join("\n") + "\n");
    return existing[existingIndex];
  }
  appendJsonLine(ORDERS, order);
  return order;
}
async function handleNotification(notification, raw) {
  const parsed = parseNotification(notification, raw);
  if (eventAlreadyRecorded(parsed.internal_event_id)) return { duplicate: true, event: parsed };
  appendJsonLine(EVENTS, { ...parsed, received_at: new Date().toISOString() });
  let purchaseInfo = null;
  if (parsed.ggsel_invoice_id) {
    try {
      purchaseInfo = await getPurchaseInfo(parsed.ggsel_invoice_id);
    } catch {
      purchaseInfo = { available: false };
    }
  }
  const purchaseData = purchaseInfo?.data && typeof purchaseInfo.data === "object" ? purchaseInfo.data : {};
  const enrichedNotification = { ...notification, ...purchaseData };
  const enrichedParsed = parseNotification(enrichedNotification, raw);
  const order = createOrderRecord(enrichedParsed, enrichedNotification);
  if (order && order.fulfillment_status === "fulfillment_disabled") {
    const fulfillment = await fulfillVoodooProduct(order);
    order.fulfillment_status = fulfillment.enabled ? order.fulfillment_status : "fulfillment_disabled";
  }
  return { duplicate: false, event: enrichedParsed, order, purchase_info_available: !!purchaseInfo && purchaseInfo.available !== false };
}
function configureMapping() {
  const map = loadMap();
  map["102794960"] = { voodoo_id: 695585 };
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2) + "\n");
  return map;
}
module.exports = { parseNotification, handleNotification, configureMapping, loadMap, safeValue, eventId };
