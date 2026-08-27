# Voodoo Center Integration — Complete 2.0

A single project for using Voodoo Center as the supplier layer and preparing products for SoftStore, Digiseller, GGsel and FunPay.

## Safety

Voodoo order creation is **disabled by default**:

```env
ENABLE_VOODOO_ORDERS=false
```

Catalog refresh/import/analysis/reseller-build do not create orders and do not publish marketplace listings.

## First setup after unzip

Open PowerShell in the folder containing `package.json`:

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

Fill `.env` with your existing Voodoo, webhook, Telegram and admin values. Keep secrets private.

Pricing can start with:

```env
MARKUP_PERCENT=20
MIN_MARKUP_RUB=0
ENABLE_VOODOO_ORDERS=false
```

Then:

```powershell
npm run setup
```

## Build the product database

Terminal 1:

```powershell
npm start
```

Terminal 2:

```powershell
$secret = ((Get-Content .env | Where-Object { $_ -match '^ADMIN_SECRET=' }) -replace '^ADMIN_SECRET=', '').Trim()
Invoke-WebRequest -UseBasicParsing -Method Post -Uri http://localhost:3000/admin/catalog/refresh -Headers @{'X-ADMIN-SECRET'=$secret}
```

Then:

```powershell
npm run catalog:import
npm run catalog:analyze
npm run reseller:build
npm run reseller:stats
```

## What you will have

```text
Voodoo catalog
     ↓
catalog-products.jsonl
     ↓
reseller-products.jsonl
     ↓
future marketplace adapters
 ┌──────────┬───────────┬───────┬────────┐
 ↓          ↓           ↓       ↓
SoftStore  Digiseller  GGsel  FunPay
```

The reseller layer stores the Voodoo product ID, source price, calculated resale price, stock, type and required customer fields.

## Important

This complete package does **not** automatically publish 48,205 products to marketplaces. That should be done only after the API/authentication and product-listing rules for each marketplace are implemented and tested.

Likewise, Voodoo purchasing stays disabled until you explicitly enable it after the order flow has been tested.

## GGsel Seller API V2

GGsel uses the official Seller API V2 host and an API key in the `Authorization` header. Add the following non-secret settings to `.env`:

```env
GGSEL_API_KEY=
GGSEL_API_BASE_URL=
GGSEL_TEST_CATEGORY_ID=
```

`GGSEL_API_BASE_URL` may be left blank; the adapter uses the documented host `https://seller.ggsel.com`. Set `GGSEL_TEST_CATEGORY_ID` to one category ID returned by the category command before running the dry-run.

Safe connectivity and category commands:

```powershell
npm run ggsel:test
npm run ggsel:categories
npm run ggsel:category-search -- steam
npm run ggsel:dry-run
```

The dry-run selects exactly one eligible `key` product from `data/reseller-products.jsonl`, prints a sanitized documented offer payload, and does not call offer creation. `POST /admin/ggsel/test`, `GET /admin/ggsel/categories`, and `POST /admin/ggsel/test-offer/dry-run` require `X-ADMIN-SECRET`.

The one-off test command and route can create at most one GGsel offer per execution, only after explicit confirmation. They refuse to run unless `ENABLE_VOODOO_ORDERS=false`, and creating a GGsel offer never creates a Voodoo order. Do not run `npm run ggsel:test-offer` until you explicitly approve it.

`POST /webhooks/ggsel` accepts the documented HTTP notification shape, records only safe order identifiers and statuses in `data/ggsel-events.jsonl`, and returns JSON success. It does not authenticate a notification because the current Seller API V2 documentation does not specify a webhook signature mechanism. It never creates or fulfills Voodoo orders.

Bulk marketplace publishing is not implemented. No SoftStore, Digiseller, GGsel, or FunPay products are published by catalog or GGsel test commands.

## Deploy to Render

Keep `.env` local. Push the source code to GitHub without `.env` or `data/`; both are protected by `.gitignore`. Create a Render Web Service connected to the repository with:

```text
Build Command: npm install
Start Command: npm start
```

Enter these environment variable names privately in the Render dashboard, never in GitHub:

```text
VOODOO_API_KEY
CATALOG_URL
WEBHOOK_SECRET
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
ADMIN_SECRET
MARKUP_PERCENT
MIN_MARKUP_RUB
GGSEL_API_KEY
GGSEL_API_BASE_URL
GGSEL_TEST_CATEGORY_ID
GGSEL_WEBHOOK_URL
ENABLE_VOODOO_ORDERS
```

For the initial deployment, keep `ENABLE_VOODOO_ORDERS=false`. The server does not download the Voodoo catalog on startup; refresh and import remain explicit operations. Test `https://YOUR-SERVICE.onrender.com/health` after deployment. `http://localhost:3000/webhooks/ggsel` is not reachable by GGsel; use the resulting public HTTPS URL as `GGSEL_WEBHOOK_URL` only after the Render service URL exists. Do not deploy or activate an offer automatically.

## GGsel order notification preparation

The receive-only endpoint is `POST /webhooks/ggsel`. It stores a sanitized raw notification in `data/ggsel-events.jsonl`, assigns a deterministic internal event ID, and prevents duplicate notifications from creating duplicate internal orders. When a documented `invoice_id` is present, the integration may query the explicitly documented purchase-info endpoint; it never fulfills automatically.

The current GGsel V2 documentation does not define a webhook notification schema or signature mechanism. The receiver therefore does not invent one: it preserves the sanitized raw object, uses only an explicitly supplied `invoice_id` for the documented purchase-info lookup, and reports missing identifiers rather than guessing them.

The existing test mapping is stored in `data/ggsel-product-map.json`:

```text
GGsel offer 102794960 -> Voodoo product 5132
```

Mapped notifications are stored in `data/orders.jsonl`. With `ENABLE_VOODOO_ORDERS=false`, key products stop at `fulfillment_disabled`; products with required customer fields stop at `awaiting_customer_info`. The dedicated Voodoo fulfillment adapter is the only future location permitted to create a Voodoo order.

Use the local parser and disabled-fulfillment checks:

```powershell
npm run ggsel:webhook-test -- '{"invoice_id":"123","offer_id":102794960,"status":"paid","quantity":1}'
npm run ggsel:fulfillment-test
```

Offer inspection is read-only:

```powershell
npm run ggsel:inspect-offer -- 102794960
npm run ggsel:configure-webhook -- 102794960
```

The configure command only displays the documented PATCH payload unless `--confirm` is explicitly supplied. Set `GGSEL_WEBHOOK_URL` only to a public HTTPS deployment URL before using that command. `http://localhost:3000/webhooks/ggsel` cannot be reached by GGsel, and no deployment or notification update is performed automatically. Offer `102794960` remains a draft and is not activated.
