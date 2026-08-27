const fs=require("node:fs"),path=require("node:path");
const DATA=path.join(process.cwd(),"data"),EVENTS=path.join(DATA,"ggsel-events.jsonl");
const API_BASE=(process.env.GGSEL_API_BASE_URL?.trim()||"https://seller.ggsel.com").replace(/\/+$/ ,"");
function getApiKey(){const key=process.env.GGSEL_API_KEY?.trim();if(!key)throw Error("GGSEL_API_KEY is missing.");return key;}
async function request(endpoint,{method="GET",query,body}={}){
  const url=new URL(`${API_BASE}${endpoint}`);
  for(const [key,value] of Object.entries(query||{}))if(value!==undefined&&value!==null&&value!=="")url.searchParams.set(key,String(value));
  const options={method,headers:{Accept:"application/json",Authorization:getApiKey()}};
  if(body!==undefined){options.headers["Content-Type"]="application/json";options.body=JSON.stringify(body);}
  let response;
  try{response=await fetch(url,options);}catch(error){throw Error(`GGsel request failed: ${error.message}`);}
  const text=await response.text();
  let data=null;try{data=text?JSON.parse(text):null;}catch{data=text||null;}
  if(!response.ok){
    const safe=JSON.stringify(sanitizeErrorBody(data??{error:"Empty response body"}));
    throw Error(`GGsel API error (${response.status}): ${safe}`);
  }
  return data;
}
function sanitizeErrorBody(value){
  if(Array.isArray(value))return value.map(sanitizeErrorBody);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([key])=>!/authorization|api[_-]?key|token|secret|password/i.test(key)).map(([key,item])=>[key,sanitizeErrorBody(item)]));
  if(typeof value==="string")return value.replace(/(authorization|api[_-]?key|token|secret|password)\s*[:=]\s*[^,\s}]+/gi,"$1: [REDACTED]");
  return value;
}
function testConnection(){return request("/api_sellers/v2/categories",{query:{page:1,limit:1}});}
function getCategories(options={}){return request("/api_sellers/v2/categories",{query:{page:options.page||1,limit:options.limit||100,parent_id:options.parent_id,locale:"ru"}});}
function searchCategories(q,options={}){if(!String(q||"").trim())throw Error("Category search text is required.");return request("/api_sellers/v2/categories/search",{query:{q:String(q).trim(),page:options.page||1,limit:options.limit||100,locale:"ru"}});}
function createOffer(payload){return request("/api_sellers/v2/offers",{method:"POST",body:payload});}
function getOffer(id){if(!/^\d+$/.test(String(id)))throw Error("GGsel offer ID must be an integer.");return request(`/api_sellers/v2/offers/${encodeURIComponent(id)}`);}
function patchOffer(id,payload){if(!/^\d+$/.test(String(id)))throw Error("GGsel offer ID must be an integer.");return request(`/api_sellers/v2/offers/${encodeURIComponent(id)}`,{method:"PATCH",body:payload});}
function buildWebhookNotificationSettings(){const url=process.env.GGSEL_WEBHOOK_URL?.trim();if(!url)throw Error("GGSEL_WEBHOOK_URL is missing.");if(!/^https:\/\//i.test(url))throw Error("GGSEL_WEBHOOK_URL must be a public HTTPS URL.");return{type:"http",url,http_method:"POST",is_disabled:false,is_default:false};}
function responseData(response){return Array.isArray(response?.data)?response.data:response?.data?[response.data]:[];}
function categoryId(){const id=Number(process.env.GGSEL_TEST_CATEGORY_ID);if(!Number.isInteger(id)||id<=0)throw Error("GGSEL_TEST_CATEGORY_ID must be a positive integer for the test offer.");return id;}
function readResellerProducts(){const file=path.join(DATA,"reseller-products.jsonl");if(!fs.existsSync(file))throw Error("Reseller catalog not found. Run npm run reseller:build first.");return fs.readFileSync(file,"utf8").split(/\r?\n/).filter(Boolean).map((line,index)=>{try{return JSON.parse(line);}catch(error){throw Error(`Invalid reseller JSONL at line ${index+1}: ${error.message}`);}});}
function selectTestProduct(){const product=readResellerProducts().find(p=>p.status==="ready"&&p.active===true&&p.in_stock===true&&p.type==="key"&&Number.isFinite(Number(p.selling_price))&&Number(p.selling_price)>0&&Array.isArray(p.required_fields)&&p.required_fields.length===0);if(!product)throw Error("No eligible ready key product found in reseller-products.jsonl.");return product;}
function buildOfferPayload(product){return{title_ru:String(product.name),title_en:String(product.name),description_ru:`Digital key supplied through Voodoo Center. Voodoo product ID: ${product.voodoo_id}.`,description_en:`Digital key supplied through Voodoo Center. Voodoo product ID: ${product.voodoo_id}.`,instructions_ru:"Product delivery is not automated in this test configuration.",instructions_en:"Product delivery is not automated in this test configuration.",price:Number(product.selling_price),currency:"RUB",is_autoselling:false,category_id:categoryId(),min_quantity:1,max_quantity:1,quantity:0,is_unlimited_quantity:false,delivery:"manual"};}
function validateOfferPayload(payload,category){
  const required=["title_ru","title_en","description_ru","description_en","instructions_ru","instructions_en"];
  for(const field of required)if(typeof payload[field]!=="string"||!payload[field].trim())throw Error(`GGsel offer payload validation failed: ${field} must be a non-empty string.`);
  if(!Number.isFinite(payload.price)||payload.price<=0)throw Error("GGsel offer payload validation failed: price must be a positive number.");
  if(payload.currency!=="RUB")throw Error("GGsel offer payload validation failed: currency must be RUB.");
  if(!Number.isInteger(payload.category_id)||payload.category_id<=0)throw Error("GGsel offer payload validation failed: category_id must be a positive integer.");
  if(!Number.isInteger(payload.min_quantity)||payload.min_quantity<1||!Number.isInteger(payload.max_quantity)||payload.max_quantity<payload.min_quantity)throw Error("GGsel offer payload validation failed: quantity limits are invalid.");
  if(!Number.isInteger(payload.quantity)||payload.quantity<0)throw Error("GGsel offer payload validation failed: quantity must be a non-negative integer.");
  if(payload.is_unlimited_quantity!==false||payload.is_autoselling!==false||payload.delivery!=="manual")throw Error("GGsel offer payload validation failed: test safety settings are invalid.");
  if(category&&category.has_children===true)throw Error(`GGsel offer payload validation failed: category_id ${payload.category_id} is a parent category; select a leaf category.`);
  return true;
}
function sanitizeProduct(product){return{voodoo_id:product.voodoo_id,name:product.name,type:product.type,voodoo_price:product.voodoo_price,selling_price:product.selling_price,required_fields:product.required_fields};}
async function dryRun(){const product=selectTestProduct();const categories=await getCategories({page:1,limit:100});const id=categoryId();const category=responseData(categories).find(item=>Number(item.id)===id)||{id};const payload=buildOfferPayload(product);validateOfferPayload(payload,category);return{product:sanitizeProduct(product),category,offer_payload:payload,local_validation:{ok:true}};}
function recordNotification(notification){const safe={received_at:new Date().toISOString(),order_id:notification.order_id??notification.orderId??notification.id??null,status:notification.status??notification.state??null,offer_id:notification.offer_id??notification.offerId??null};fs.mkdirSync(DATA,{recursive:true});fs.appendFileSync(EVENTS,JSON.stringify(safe)+"\n");return safe;}
async function getPurchaseInfo(invoiceId){if(!/^\d+$/.test(String(invoiceId)))throw Error("GGsel invoice ID must be an integer.");return request(`/api_sellers/api/purchase/info/${encodeURIComponent(invoiceId)}`);}
module.exports={testConnection,getCategories,searchCategories,createOffer,getOffer,patchOffer,buildWebhookNotificationSettings,getPurchaseInfo,selectTestProduct,buildOfferPayload,validateOfferPayload,sanitizeProduct,dryRun,recordNotification,responseData};
