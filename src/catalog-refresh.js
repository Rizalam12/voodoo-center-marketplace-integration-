const fs = require("node:fs");
const path = require("node:path");

const {
  downloadCatalog,
  importProducts,
  buildResellerCatalog,
  catalogStatus,
} = require("./catalog");

const DATA = path.join(process.cwd(), "data");
const STATUS_FILE = path.join(DATA, "catalog-refresh-status.json");

let running = false;

function ensureData() {
  fs.mkdirSync(DATA, { recursive: true });
}

function writeStatus(status) {
  ensureData();
  fs.writeFileSync(
    STATUS_FILE,
    JSON.stringify(
      {
        ...status,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function getStatus() {
  ensureData();

  if (!fs.existsSync(STATUS_FILE)) {
    return {
      state: "idle",
      updatedAt: new Date().toISOString(),
      catalog: catalogStatus(),
    };
  }

  try {
    return {
      ...JSON.parse(fs.readFileSync(STATUS_FILE, "utf8")),
      catalog: catalogStatus(),
      running,
    };
  } catch {
    return {
      state: "unknown",
      running,
      catalog: catalogStatus(),
    };
  }
}

function startCatalogRefresh() {
  if (running) {
    return {
      started: false,
      state: "already_running",
      status: getStatus(),
    };
  }

  running = true;

  writeStatus({
    state: "starting",
    message: "Catalog refresh started.",
  });

  setImmediate(async () => {
    try {
      console.log("[catalog-job] starting download");

      writeStatus({
        state: "downloading",
        message: "Downloading catalog.",
      });

      const download = await downloadCatalog();

      console.log("[catalog-job] download complete", download);

      writeStatus({
        state: "importing",
        message: "Importing catalog.",
        download,
      });

      console.log("[catalog-job] starting import");

      const imported = await importProducts();

      console.log("[catalog-job] import complete", imported);

      writeStatus({
        state: "building_reseller",
        message: "Building reseller catalog.",
        download,
        imported,
      });

      console.log("[catalog-job] starting reseller build");

      const reseller = await buildResellerCatalog();

      console.log("[catalog-job] reseller build complete", reseller);

      writeStatus({
        state: "complete",
        message: "Catalog refresh completed successfully.",
        download,
        imported,
        reseller,
      });

      console.log("[catalog-job] COMPLETE");
    } catch (error) {
      console.error(
        "[catalog-job] FAILED:",
        error?.stack || error?.message || error,
      );

      writeStatus({
        state: "error",
        message: error?.message || String(error),
        error: error?.stack || String(error),
      });
    } finally {
      running = false;
    }
  });

  return {
    started: true,
    state: "started",
    status: getStatus(),
  };
}

module.exports = {
  startCatalogRefresh,
  getStatus,
};
