const fs=require("node:fs"),path=require("node:path"),fzstd=require("fzstd");
const DATA=path.join(process.cwd(),"data"),ZST=path.join(DATA,"catalog.lmdb"),RAW=path.join(DATA,"catalog.raw"),ETAG=path.join(DATA,"catalog.etag"),PRODUCTS=path.join(DATA,"catalog-products.jsonl"),STATS=path.join(DATA,"catalog-stats.json");
const ensure=()=>fs.mkdirSync(DATA,{recursive:true});
async function downloadCatalog(){const url=process.env.CATALOG_URL?.trim();if(!url)throw Error("CATALOG_URL is missing.");ensure();const headers={};if(fs.existsSync(ETAG))headers["If-None-Match"]=fs.readFileSync(ETAG,"utf8").trim();const r=await fetch(url,{headers});if(r.status===304)return{updated:false,message:"Catalog is already up to date."};if(!r.ok)throw Error(`Catalog download failed (${r.status}).`);const b=Buffer.from(await r.arrayBuffer());fs.writeFileSync(ZST,b);const e=r.headers.get("etag");if(e)fs.writeFileSync(ETAG,e);return{updated:true,bytes:b.length,message:"Catalog snapshot downloaded."};}
function decompressCatalog(){ensure();if(!fs.existsSync(ZST))throw Error("No downloaded catalog. Run catalog refresh first.");const c=fs.readFileSync(ZST),z=c.length>=4&&c[0]===40&&c[1]===181&&c[2]===47&&c[3]===253,r=z?Buffer.from(fzstd.decompress(c)):c;fs.writeFileSync(RAW,r);return{compressedBytes:c.length,rawBytes:r.length,zstdDetected:z,rawPath:RAW};}
function printableStrings(b,min=4,max=512){const o=[];let s=-1;const f=e=>{if(s<0)return;const v=b.subarray(s,e).toString("utf8").trim();if(v.length>=min&&v.length<=max&&/[A-Za-z0-9]/.test(v))o.push({offset:s,value:v});s=-1;};for(let i=0;i<b.length;i++){const c=b[i],ok=c>=32&&c<=126||c===9||c===10||c===13;if(ok){if(s<0)s=i;}else f(i);}f(b.length);return o;}
function inspectCatalog(){const i=decompressCatalog(),r=fs.readFileSync(RAW);return{...i,first64Hex:r.subarray(0,64).toString("hex"),sampleStrings:printableStrings(r,6,160).slice(0,40)};}
function searchCatalog(q,limit=50){if(!q?.trim())throw Error("Search query is required.");const i=decompressCatalog(),a=printableStrings(fs.readFileSync(RAW)),x=q.toLowerCase(),m=[],seen=new Set();for(const e of a){if(!e.value.toLowerCase().includes(x)||seen.has(e.value))continue;seen.add(e.value);m.push(e);if(m.length>=limit)break;}return{...i,query:q,matches:m};}
function catalogStatus(){return{downloaded:fs.existsSync(ZST),rawAvailable:fs.existsSync(RAW),productsImported:fs.existsSync(PRODUCTS),statsAvailable:fs.existsSync(STATS),compressedPath:ZST,rawPath:RAW,productsPath:PRODUCTS,statsPath:STATS,etagSaved:fs.existsSync(ETAG)};}
function resellerPrice(v){const n=Number(v);if(!Number.isFinite(n))return null;const pct=Number(process.env.MARKUP_PERCENT||20),min=Number(process.env.MIN_MARKUP_RUB||0);return Number((n+Math.max(n*pct/100,min)).toFixed(2));}
function normalize(o){if(!o||typeof o!=="object"||Array.isArray(o))return null;const id=o.id??o.item_id??o.product_id,name=o.name??o.title??o.item_name,price=o.price??o.base_price??o.subscriber_price;if(id===undefined||name===undefined||(price===undefined&&o.fields===undefined&&o.in_stock===undefined&&o.min_quantity===undefined&&o.max_quantity===undefined))return null;return{voodoo_id:id,name:String(name),type:o.type??o.product_type??null,price:price===undefined?null:Number(price),reseller_price:resellerPrice(price),currency:o.currency??"RUB",in_stock:o.in_stock??o.stock??null,min_quantity:o.min_quantity??null,max_quantity:o.max_quantity??null,fields:Array.isArray(o.fields)?o.fields:[],options:Array.isArray(o.options)?o.options:[]};}
function scan(file,onObject){return new Promise((resolve,reject)=>{const s=fs.createReadStream(file,{highWaterMark:1024*1024});let inStr=false,esc=false,depth=0,start=-1,pos=0,buf="",parsed=0,valid=0;const finish=()=>{if(start<0)return;const t=buf;buf="";start=-1;try{const o=JSON.parse(t);parsed++;if(onObject(o))valid++;}catch{}};s.on("data",c=>{const t=c.toString("utf8");for(let i=0;i<t.length;i++){const ch=t[i];if(start<0){if(ch==="{"){start=pos+i;depth=1;inStr=false;esc=false;buf="{";}continue;}buf+=ch;if(inStr){if(esc)esc=false;else if(ch==="\\")esc=true;else if(ch==='"')inStr=false;continue;}if(ch==='"'){inStr=true;continue;}if(ch==="{")depth++;else if(ch==="}"){depth--;if(depth===0)finish();else if(buf.length>2000000){buf="";start=-1;depth=0;}}}pos+=t.length;});s.on("end",()=>{if(start>=0)finish();resolve({parsed,valid});});s.on("error",reject);});}
async function importProducts(){ensure();if(!fs.existsSync(RAW))decompressCatalog();if(!fs.existsSync(RAW))throw Error("No raw catalog available.");const out=fs.createWriteStream(PRODUCTS,{encoding:"utf8"}),seen=new Set(),stats={scannedObjects:0,productRecords:0,duplicates:0,types:{},stock:{in_stock:0,out_of_stock:0,unknown:0},importedAt:new Date().toISOString()};const r=await scan(RAW,o=>{const p=normalize(o);if(!p)return false;const k=String(p.voodoo_id)+"|"+p.name;if(seen.has(k)){stats.duplicates++;return false;}seen.add(k);out.write(JSON.stringify(p)+"\n");stats.productRecords++;const t=String(p.type||"unknown");stats.types[t]=(stats.types[t]||0)+1;if(p.in_stock===true||(typeof p.in_stock==="number"&&p.in_stock>0))stats.stock.in_stock++;else if(p.in_stock===false||p.in_stock===0)stats.stock.out_of_stock++;else stats.stock.unknown++;return true;});await new Promise(r=>out.end(r));stats.scannedObjects=r.parsed;fs.writeFileSync(STATS,JSON.stringify(stats,null,2));return stats;}
function readImportedProducts(){
  if(!fs.existsSync(PRODUCTS))throw Error("Imported catalog file not found: data/catalog-products.jsonl. Run npm run catalog:import first.");
  return fs.readFileSync(PRODUCTS,"utf8").split(/\r?\n/).reduce((products,line,index)=>{
    if(!line.trim())return products;
    try{
      const product=JSON.parse(line);
      if(!product||typeof product!=="object"||Array.isArray(product))throw Error("record is not an object");
      products.push(product);
      return products;
    }catch(error){
      throw Error(`Invalid JSONL record in data/catalog-products.jsonl at line ${index+1}: ${error.message}`);
    }
  },[]);
}
function searchImported(q,limit=50){const x=q.toLowerCase();return readImportedProducts().filter(p=>p.name.toLowerCase().includes(x)).slice(0,limit);}

function analyzeImported() {
  const products = readImportedProducts();
  const analysis = {
    total: products.length,
    eligible: 0,
    ready_for_auto_resale: 0,
    requires_customer_info: 0,
    manual_review: 0,
    in_stock: 0,
    out_of_stock: 0,
    unknown_stock: 0,
    valid_price: 0,
    invalid_price: 0,
    types: {},
    required_fields: {},
    field_combinations: {},
    reasons: {}
  };
  for (const p of products) {
    const type = String(p.type || "unknown");
    analysis.types[type] = (analysis.types[type] || 0) + 1;
    if (p.in_stock === true || (typeof p.in_stock === "number" && p.in_stock > 0)) analysis.in_stock++;
    else if (p.in_stock === false || p.in_stock === 0) analysis.out_of_stock++;
    else analysis.unknown_stock++;

    const priceOk = Number.isFinite(Number(p.price)) && Number(p.price) > 0;
    if (priceOk) analysis.valid_price++; else analysis.invalid_price++;

    const fields = Array.isArray(p.fields) ? p.fields : [];
    const required = fields.filter(f => f && f.required === true);
    for (const f of required) {
      const n = String(f.name || `field_${f.id ?? "unknown"}`);
      analysis.required_fields[n] = (analysis.required_fields[n] || 0) + 1;
    }
    const combo = required.map(f => String(f.name || `field_${f.id ?? "unknown"}`)).sort().join(", ");
    const comboKey = combo || "(none)";
    analysis.field_combinations[comboKey] = (analysis.field_combinations[comboKey] || 0) + 1;

    const inStock = p.in_stock === true || (typeof p.in_stock === "number" && p.in_stock > 0);
    let reason = "ready";
    if (!priceOk) reason = "invalid_price";
    else if (!inStock) reason = p.in_stock == null ? "unknown_stock" : "out_of_stock";
    else if (!["key","service","topup"].includes(type)) reason = "unknown_product_type";
    if (reason !== "ready") analysis.reasons[reason] = (analysis.reasons[reason] || 0) + 1;

    if (reason === "ready") {
      analysis.eligible++;
      if (required.length === 0) analysis.ready_for_auto_resale++;
      else analysis.requires_customer_info++;
    } else analysis.manual_review++;
  }
  return analysis;
}


const RESELLER = path.join(DATA,"reseller-products.jsonl");
const RESELLER_STATS = path.join(DATA,"reseller-stats.json");

function requiredFields(product) {
  return (Array.isArray(product.fields) ? product.fields : [])
    .filter(f => f && f.required === true)
    .map(f => ({
      id: f.id ?? null,
      name: String(f.name || `field_${f.id ?? "unknown"}`),
      type: f.type ?? "string",
      options: Array.isArray(f.options) ? f.options : []
    }));
}

function buildResellerProduct(p) {
  const type = String(p.type || "unknown");
  const price = Number(p.price);
  const stock = p.in_stock === true || (typeof p.in_stock === "number" && p.in_stock > 0);
  const fields = requiredFields(p);
  const supported = ["key","service","topup"].includes(type);
  const validPrice = Number.isFinite(price) && price > 0;

  let status = "manual_review";
  let reason = "unsupported_product_type";
  if (!stock) {
    reason = p.in_stock == null ? "unknown_stock" : "out_of_stock";
  } else if (!validPrice) {
    reason = "invalid_price";
  } else if (!supported) {
    reason = "unsupported_product_type";
  } else if (fields.length === 0) {
    status = "ready";
    reason = "no_required_customer_fields";
  } else {
    status = "customer_input";
    reason = "required_customer_fields";
  }

  return {
    internal_id: `voodoo:${p.voodoo_id}`,
    voodoo_id: p.voodoo_id,
    name: p.name,
    type,
    status,
    reason,
    active: status !== "manual_review",
    in_stock: stock,
    stock_quantity: typeof p.in_stock === "number" ? Math.max(0, Math.floor(p.in_stock)) : (p.in_stock === true ? 1 : 0),
    voodoo_price: validPrice ? price : null,
    currency: p.currency || "RUB",
    selling_price: validPrice ? p.reseller_price : null,
    markup_percent: Number(process.env.MARKUP_PERCENT || 20),
    min_markup_rub: Number(process.env.MIN_MARKUP_RUB || 0),
    min_quantity: p.min_quantity,
    max_quantity: p.max_quantity,
    required_fields: fields,
    options: Array.isArray(p.options) ? p.options : [],
    marketplace_ready: {
      softstore: status === "ready" || status === "customer_input",
      digiseller: status === "ready" || status === "customer_input",
      ggsel: status === "ready" || status === "customer_input",
      funpay: status === "ready" || status === "customer_input"
    }
  };
}

async function buildResellerCatalog() {
  const products = readImportedProducts();
  ensure();
  const out = fs.createWriteStream(RESELLER,{encoding:"utf8"});
  const stats = {
    source_products: products.length,
    active_products: 0,
    ready: 0,
    customer_input: 0,
    manual_review: 0,
    by_type: {},
    by_reason: {},
    required_fields: {},
    generated_at: new Date().toISOString()
  };
  for (const p of products) {
    const r = buildResellerProduct(p);
    out.write(JSON.stringify(r) + "\n");
    if (r.active) stats.active_products++;
    if (r.status === "ready") stats.ready++;
    else if (r.status === "customer_input") stats.customer_input++;
    else stats.manual_review++;
    stats.by_type[r.type] = (stats.by_type[r.type] || 0) + 1;
    stats.by_reason[r.reason] = (stats.by_reason[r.reason] || 0) + 1;
    for (const f of r.required_fields) stats.required_fields[f.name] = (stats.required_fields[f.name] || 0) + 1;
  }
  await new Promise(resolve => out.end(resolve));
  fs.writeFileSync(RESELLER_STATS, JSON.stringify(stats,null,2));
  return stats;
}

function readResellerProducts() {
  if (!fs.existsSync(RESELLER)) throw new Error("Reseller catalog not built. Run npm run reseller:build first.");
  return fs.readFileSync(RESELLER,"utf8").split("\n").filter(Boolean).map(JSON.parse);
}
function getResellerStats() {
  if (!fs.existsSync(RESELLER_STATS)) throw new Error("No reseller stats. Run npm run reseller:build first.");
  return JSON.parse(fs.readFileSync(RESELLER_STATS,"utf8"));
}
function searchReseller(q,limit=50) {
  const x=String(q||"").toLowerCase();
  return readResellerProducts().filter(p => p.name.toLowerCase().includes(x)).slice(0,limit);
}

function getStats(){if(!fs.existsSync(STATS))throw Error("No catalog stats. Run npm run catalog:import first.");return JSON.parse(fs.readFileSync(STATS,"utf8"));}
module.exports={downloadCatalog,decompressCatalog,inspectCatalog,searchCatalog,catalogStatus,importProducts,readImportedProducts,searchImported,getStats,analyzeImported,buildResellerCatalog,getResellerStats,searchReseller};
