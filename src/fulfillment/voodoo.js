const { createOrder } = require("../voodoo");

async function fulfillVoodooProduct(order) {
  if (process.env.ENABLE_VOODOO_ORDERS !== "true")
    return { enabled: false, reason: "ENABLE_VOODOO_ORDERS=false" };
  if (!order?.voodoo_product_id)
    return { enabled: true, fulfilled: false, reason: "missing_voodoo_product_id" };
  if (order.required_fields?.length)
    return { enabled: true, fulfilled: false, reason: "awaiting_customer_info" };
  const result = await createOrder({
    itemId: order.voodoo_product_id,
    quantity: order.quantity,
    merchantOrderId: order.internal_order_id,
    fields: order.customer_fields,
  });
  return { enabled: true, fulfilled: true, result };
}

module.exports = { fulfillVoodooProduct };
