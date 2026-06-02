import { useState, useEffect, useRef, useCallback } from "react";

// ─── Storage ───────────────────────────────────────────────────────────────
const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};
const save = (key, val) => localStorage.setItem(key, JSON.stringify(val));

// ─── Constants ─────────────────────────────────────────────────────────────
const UNITS = ["unid.", "g", "kg", "ml", "L", "tazas", "paq."];
const CAT_ICONS = {
  proteinas:"🥩", verduras:"🥦", tuberculos:"🥔", lacteos:"🧀",
  legumbres:"🫘", cereales:"🌾", aceites:"🫙", condimentos:"🧂",
  frutas:"🍎", bebidas:"🥛", otros:"🧺",
};
const CAT_LABELS = {
  proteinas:"Proteínas", verduras:"Verduras", tuberculos:"Tubérculos",
  lacteos:"Lácteos", legumbres:"Legumbres", cereales:"Cereales / Pastas",
  aceites:"Aceites", condimentos:"Condimentos", frutas:"Frutas",
  bebidas:"Bebidas", otros:"Otros",
};
const MEAL_TYPES = [
  ["desayuno","☀️","Desayuno"],
  ["almuerzo","🍽","Almuerzo"],
  ["merienda","🫖","Merienda"],
  ["cena","🌙","Cena"],
];
const DAYS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

const getWeekKey = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset * 7);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().slice(0,10);
};
const todayIndex = () => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; };

// Returns the current meal slot based on hour
const currentMealType = () => {
  const h = new Date().getHours();
  if (h < 10) return "desayuno";
  if (h < 15) return "almuerzo";
  if (h < 19) return "merienda";
  return "cena";
};

const OB_STEPS = [
  { id:"cuisines", question:"¿Qué tipo de comida preparás más?", hint:"Seleccioná todas las que aplican", multi:true,
    options:["Casera / criolla","Italiana / pastas","Mexicana / picante","Vegetariana","Asiática","Parrilla / asados","Sopas y guisos","Ensaladas"] },
  { id:"restrictions", question:"¿Alguna restricción alimentaria?", hint:"Podés saltar si no aplica", multi:true, optional:true,
    options:["Sin gluten","Sin lactosa","Vegetariano","Vegano","Sin cerdo","Bajo en sodio","Sin mariscos","Sin frutos secos"] },
  { id:"cooking_time", question:"¿Cuánto tiempo tenés para cocinar?", multi:false,
    options:["Rápido (< 20 min)","Normal (20–40 min)","Me gusta cocinar (40+ min)","Depende del día"] },
  { id:"servings", question:"¿Para cuántas personas cocinás normalmente?", multi:false,
    options:["Solo para mí","Para 2","Para 3–4","Para 5 o más"] },
  { id:"disliked", question:"¿Qué ingredientes no te gustan?", hint:"Separados por coma (opcional)", type:"text", optional:true },
];

// ─── API ───────────────────────────────────────────────────────────────────
async function callClaude(messages, system = "", maxTokens = 800) {
  const apiKey = localStorage.getItem("mk_apikey");
  if (!apiKey) throw new Error("NO_KEY");
  const body = { model:"claude-sonnet-4-20250514", max_tokens:maxTokens, messages };
  if (system) body.system = system;

  // Use Netlify function as proxy to avoid CORS issues
  const res = await fetch("/api/claude", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ ...body, apiKey }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content?.find(b => b.type === "text")?.text ?? "";
}

function parseSuggestions(text) {
  const blocks = text.split(/\n(?=\*\*|\d+\.\s|#{1,3}\s)/).filter(Boolean);
  return blocks.map(block => {
    const lines = block.trim().split("\n").filter(Boolean);
    const title = lines[0].replace(/^\*+|^\d+\.\s*|\*+$|^#+\s*/g,"").trim();
    const rest = lines.slice(1).join("\n");
    return { title, detail: rest };
  }).filter(b => b.title.length > 2).slice(0,3);
}

// Parse steps from detail text into array
function parseSteps(detail) {
  const prepMatch = detail.match(/[Pp]reparaci[oó]n[^:]*:\s*(.+)/s);
  if (!prepMatch) return detail.split("\n").filter(Boolean);
  return prepMatch[1].split(/\s*\/\s*|\n/).map(s => s.trim()).filter(Boolean);
}

// ─── Foodish ───────────────────────────────────────────────────────────────
const FOODISH_MAP = [
  { keys:["pasta","fideos","spaghetti","tallarines","lasaña","ravioles"], cat:"pasta" },
  { keys:["arroz","risotto"], cat:"rice" },
  { keys:["hamburguesa","burger"], cat:"burger" },
  { keys:["pizza"], cat:"pizza" },
  { keys:["pollo","chicken"], cat:"chicken-wings" },
  { keys:["taco","burrito","mexicano"], cat:"taco" },
  { keys:["sopa","caldo","guiso","estofado","locro"], cat:"soup" },
  { keys:["torta","cake","postre","budín"], cat:"dessert" },
  { keys:["sandwich","tostado","pancho"], cat:"sandwich" },
  { keys:["panqueque","pancake"], cat:"pancake" },
];
function getFoodishUrl(title) {
  const lower = title.toLowerCase();
  const match = FOODISH_MAP.find(m => m.keys.some(k => lower.includes(k)));
  const cat = match ? match.cat : "rice";
  const idx = Math.floor(Math.random() * 20) + 1;
  return `https://foodish-api.com/images/${cat}/${cat}${idx}.jpg`;
}
function getFallbackEmoji(title) {
  const l = title.toLowerCase();
  if (l.includes("pasta")||l.includes("fideos")) return "🍝";
  if (l.includes("arroz")) return "🍚";
  if (l.includes("hamburguesa")) return "🍔";
  if (l.includes("pizza")) return "🍕";
  if (l.includes("pollo")) return "🍗";
  if (l.includes("sopa")||l.includes("guiso")) return "🍲";
  if (l.includes("ensalada")) return "🥗";
  if (l.includes("taco")||l.includes("burrito")) return "🌮";
  if (l.includes("sandwich")||l.includes("tostado")) return "🥪";
  return "🍽";
}

// ─── CSS ───────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Inter',sans-serif; }

  .mk-light {
    --bg:#ffffff; --bg2:#fafafa; --surface:#f5f5f5;
    --border:rgba(0,0,0,0.07); --border2:rgba(0,0,0,0.12);
    --text:#111111; --text2:#888888; --text3:#cccccc;
    --accent:#111111; --accent-text:#ffffff;
    --danger:#e53935; --danger-bg:#fff0f0;
    --gold:#f0a500; --gold-bg:#fffbf0;
  }
  .mk-dark {
    --bg:#0f0f0f; --bg2:#141414; --surface:#1c1c1c;
    --border:rgba(255,255,255,0.07); --border2:rgba(255,255,255,0.12);
    --text:#f0f0f0; --text2:#666666; --text3:#2a2a2a;
    --accent:#f0f0f0; --accent-text:#111111;
    --danger:#ff5252; --danger-bg:#1f0f0f;
    --gold:#f0a500; --gold-bg:#1a1500;
  }

  .app { max-width:430px; margin:0 auto; min-height:100dvh; display:flex; flex-direction:column; background:var(--bg); color:var(--text); overflow-x:hidden; }

  /* Header */
  .hdr { padding:18px 20px 14px; border-bottom:0.5px solid var(--border); display:flex; align-items:flex-end; justify-content:space-between; position:sticky; top:0; z-index:10; background:var(--bg); }
  .logo { font-size:22px; font-weight:500; color:var(--text); letter-spacing:-0.03em; line-height:1; }
  .logo-sub { font-size:10px; color:var(--text2); margin-top:3px; }
  .toggle { width:40px; height:22px; border-radius:99px; background:var(--accent); cursor:pointer; position:relative; border:none; flex-shrink:0; transition:background 0.25s; }
  .toggle-dot { width:16px; height:16px; border-radius:50%; background:var(--accent-text); position:absolute; top:3px; transition:left 0.2s; }
  .mk-light .toggle-dot { left:3px; }
  .mk-dark  .toggle-dot { left:21px; }

  /* Tabs */
  .tabs { display:flex; padding:0 20px; gap:20px; border-bottom:0.5px solid var(--border); background:var(--bg); position:sticky; top:67px; z-index:9; overflow-x:auto; scrollbar-width:none; }
  .tabs::-webkit-scrollbar { display:none; }
  .tab { padding:10px 0; font-size:11px; color:var(--text2); border:none; background:transparent; cursor:pointer; border-bottom:1.5px solid transparent; font-family:'Inter',sans-serif; white-space:nowrap; transition:color 0.15s; -webkit-tap-highlight-color:transparent; }
  .tab.active { color:var(--text); border-bottom-color:var(--text); }

  .content { flex:1; padding:20px 20px 100px; }

  /* Big counter */
  .big-num { font-size:52px; font-weight:300; color:var(--text); line-height:1; letter-spacing:-0.04em; }
  .big-label { font-size:11px; color:var(--text2); margin-top:4px; margin-bottom:20px; }

  /* Form */
  .add-row { display:flex; gap:8px; margin-bottom:6px; align-items:flex-end; }
  .field { display:flex; flex-direction:column; gap:4px; }
  .flabel { font-size:9px; color:var(--text2); letter-spacing:0.08em; text-transform:uppercase; }
  .inp { background:var(--surface); border:0.5px solid var(--border2); color:var(--text); font-family:'Inter',sans-serif; font-size:13px; padding:10px 11px; border-radius:8px; outline:none; -webkit-appearance:none; width:100%; transition:border-color 0.15s; }
  .inp:focus { border-color:var(--text2); }
  .inp.scanning { border-color:var(--text2); animation:pulse 1s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
  .btn-add { padding:10px 16px; border-radius:8px; border:none; background:var(--accent); color:var(--accent-text); font-family:'Inter',sans-serif; font-size:18px; font-weight:300; cursor:pointer; flex-shrink:0; align-self:flex-end; height:40px; display:flex; align-items:center; justify-content:center; -webkit-tap-highlight-color:transparent; }
  .btn-add:disabled { opacity:0.3; cursor:not-allowed; }
  .cat-hint { font-size:10px; color:var(--text2); margin-bottom:12px; }

  /* Divider */
  .divider-label { font-size:9px; letter-spacing:0.18em; text-transform:uppercase; color:var(--text3); margin:16px 0 10px; display:flex; align-items:center; gap:10px; }
  .divider-label::after { content:''; flex:1; height:0.5px; background:var(--border); }

  /* Items */
  .item-row { display:flex; align-items:center; gap:10px; padding:11px 0; border-bottom:0.5px solid var(--border); }
  .item-name { flex:1; font-size:14px; color:var(--text); }
  .item-qty { font-size:12px; color:var(--text2); cursor:pointer; padding:3px 8px; border-radius:5px; background:var(--surface); transition:background 0.15s; }
  .qty-input { width:70px; font-size:12px; }
  .btn-del { background:none; border:none; color:var(--text3); font-size:16px; cursor:pointer; padding:0 2px; line-height:1; -webkit-tap-highlight-color:transparent; }

  /* Alert */
  .alert { background:var(--danger-bg); border:0.5px solid var(--danger); border-radius:10px; padding:12px 14px; margin-bottom:16px; }
  .alert-title { font-size:10px; color:var(--danger); letter-spacing:0.1em; text-transform:uppercase; margin-bottom:7px; }
  .alert-chips { display:flex; flex-wrap:wrap; gap:5px; }
  .alert-chip { font-size:10px; color:var(--danger); border:0.5px solid var(--danger); padding:3px 8px; border-radius:5px; }

  /* Daily suggestion banner */
  .daily-banner { background:var(--gold-bg); border:0.5px solid var(--gold); border-radius:12px; padding:14px 16px; margin-bottom:16px; cursor:pointer; }
  .daily-banner-label { font-size:9px; color:var(--gold); letter-spacing:0.12em; text-transform:uppercase; margin-bottom:4px; }
  .daily-banner-title { font-size:16px; font-weight:400; color:var(--text); letter-spacing:-0.02em; }
  .daily-banner-sub { font-size:11px; color:var(--text2); margin-top:3px; }
  .daily-banner-loading { font-size:12px; color:var(--text2); }

  /* Suggest tab */
  .seg-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:10px; }
  .seg-btn { padding:10px; border-radius:8px; border:0.5px solid var(--border2); background:var(--surface); color:var(--text2); font-family:'Inter',sans-serif; font-size:11px; cursor:pointer; text-align:center; transition:all 0.15s; -webkit-tap-highlight-color:transparent; }
  .seg-btn.active { background:var(--accent); color:var(--accent-text); border-color:var(--accent); }
  .mood-row { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px; }
  .mood-chip { padding:7px 13px; border-radius:99px; border:0.5px solid var(--border2); background:transparent; color:var(--text2); font-family:'Inter',sans-serif; font-size:11px; cursor:pointer; transition:all 0.15s; -webkit-tap-highlight-color:transparent; }
  .mood-chip.active { background:var(--accent); color:var(--accent-text); border-color:var(--accent); }
  .btn-suggest { width:100%; padding:15px; border-radius:10px; border:none; background:var(--accent); color:var(--accent-text); font-family:'Inter',sans-serif; font-size:13px; font-weight:500; cursor:pointer; margin-bottom:16px; -webkit-tap-highlight-color:transparent; }
  .btn-suggest:disabled { opacity:0.3; cursor:not-allowed; }
  .dots span { animation:blink 1.2s infinite; }
  .dots span:nth-child(2) { animation-delay:0.2s; }
  .dots span:nth-child(3) { animation-delay:0.4s; }
  @keyframes blink { 0%,80%,100%{opacity:0} 40%{opacity:1} }

  /* Suggestion cards */
  .sug-card { border:0.5px solid var(--border2); border-radius:12px; overflow:hidden; margin-bottom:12px; }
  .sug-img-wrap { width:100%; height:160px; overflow:hidden; position:relative; background:var(--surface); }
  .sug-img { width:100%; height:100%; object-fit:cover; display:block; transition:opacity 0.3s; }
  .sug-img-emoji { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:52px; }
  .sug-body { padding:14px 16px 16px; }
  .sug-title { font-size:17px; font-weight:400; color:var(--text); margin-bottom:8px; letter-spacing:-0.02em; }
  .sug-detail { font-size:12px; color:var(--text2); line-height:1.75; white-space:pre-wrap; margin-bottom:12px; }
  .sug-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .sug-select { flex:1; font-size:11px; padding:9px 10px; border-radius:8px; border:0.5px solid var(--border2); background:var(--surface); color:var(--text); font-family:'Inter',sans-serif; cursor:pointer; min-width:0; }
  .btn-cook { padding:9px 14px; border-radius:8px; border:none; background:var(--accent); color:var(--accent-text); font-family:'Inter',sans-serif; font-size:11px; cursor:pointer; white-space:nowrap; -webkit-tap-highlight-color:transparent; }
  .btn-fav { padding:9px 12px; border-radius:8px; border:0.5px solid var(--border2); background:transparent; font-size:14px; cursor:pointer; -webkit-tap-highlight-color:transparent; }
  .btn-fav.saved { background:var(--gold-bg); border-color:var(--gold); }
  .already-tag { font-size:10px; color:var(--text2); white-space:nowrap; }
  .empty { text-align:center; padding:40px 0; color:var(--text2); font-size:12px; line-height:2; }

  /* Cook mode fullscreen */
  .cook-mode { position:fixed; inset:0; background:var(--bg); z-index:200; display:flex; flex-direction:column; max-width:430px; margin:0 auto; }
  .cook-header { padding:20px 20px 16px; display:flex; align-items:center; gap:12px; border-bottom:0.5px solid var(--border); }
  .cook-title { flex:1; font-size:16px; font-weight:400; color:var(--text); letter-spacing:-0.02em; }
  .btn-close-cook { background:none; border:none; font-size:20px; color:var(--text2); cursor:pointer; padding:0; -webkit-tap-highlight-color:transparent; }
  .cook-progress { padding:12px 20px; display:flex; gap:4px; }
  .cook-pip { flex:1; height:3px; border-radius:99px; background:var(--border2); transition:background 0.3s; }
  .cook-pip.done { background:var(--text); }
  .cook-pip.active { background:var(--accent); }
  .cook-step { flex:1; padding:24px 24px 0; display:flex; flex-direction:column; justify-content:center; }
  .cook-step-num { font-size:11px; color:var(--text2); letter-spacing:0.12em; text-transform:uppercase; margin-bottom:12px; }
  .cook-step-text { font-size:22px; font-weight:300; color:var(--text); line-height:1.5; letter-spacing:-0.02em; }
  .cook-nav { padding:24px 20px 40px; display:flex; gap:10px; }
  .btn-cook-prev { padding:16px 20px; border-radius:10px; border:0.5px solid var(--border2); background:transparent; color:var(--text2); font-family:'Inter',sans-serif; font-size:13px; cursor:pointer; }
  .btn-cook-next { flex:1; padding:16px; border-radius:10px; border:none; background:var(--accent); color:var(--accent-text); font-family:'Inter',sans-serif; font-size:13px; cursor:pointer; }

  /* Week */
  .week-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
  .week-title { font-size:16px; font-weight:400; color:var(--text); letter-spacing:-0.02em; }
  .btn-ghost { font-size:11px; color:var(--text2); background:none; border:0.5px solid var(--border2); border-radius:6px; padding:5px 10px; cursor:pointer; font-family:'Inter',sans-serif; }
  .week-nav { display:flex; gap:6px; margin-bottom:12px; }
  .week-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:3px; margin-bottom:20px; }
  .day-col { display:flex; flex-direction:column; gap:2px; }
  .day-lbl { text-align:center; font-size:8px; color:var(--text3); padding-bottom:5px; }
  .day-lbl.today { color:var(--text); font-weight:500; }
  .meal-cell { border-radius:5px; min-height:26px; border:0.5px dashed var(--border2); display:flex; flex-direction:column; align-items:center; justify-content:center; padding:2px; }
  .meal-cell.filled { border-style:solid; background:var(--surface); cursor:pointer; }
  .meal-cell-icon { font-size:8px; }
  .meal-cell-name { font-size:6.5px; color:var(--text2); text-align:center; line-height:1.2; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .history-item { display:flex; align-items:center; gap:10px; padding:11px 0; border-bottom:0.5px solid var(--border); cursor:pointer; }
  .h-day { font-size:11px; color:var(--text3); width:26px; flex-shrink:0; }
  .h-icon { font-size:14px; }
  .h-name { flex:1; font-size:13px; color:var(--text); }
  .h-type { font-size:10px; color:var(--text2); }

  /* Shopping */
  .shop-hint { font-size:10px; color:var(--text2); margin-bottom:14px; }
  .shop-item { display:flex; align-items:center; gap:12px; padding:11px 0; border-bottom:0.5px solid var(--border); }
  .shop-check { width:20px; height:20px; border-radius:5px; border:0.5px solid var(--border2); cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; -webkit-tap-highlight-color:transparent; transition:background 0.15s; }
  .shop-check.on { background:var(--text); border-color:var(--text); }
  .shop-name { flex:1; font-size:13px; color:var(--text); }
  .shop-name.done { text-decoration:line-through; color:var(--text3); }
  .shop-qty { font-size:11px; color:var(--text2); }
  .btn-confirm { width:100%; margin-top:14px; padding:13px; border-radius:10px; border:0.5px solid var(--border2); background:transparent; color:var(--text); font-family:'Inter',sans-serif; font-size:12px; cursor:pointer; }

  /* Favorites */
  .fav-item { display:flex; align-items:center; gap:10px; padding:12px 0; border-bottom:0.5px solid var(--border); cursor:pointer; }
  .fav-emoji { font-size:24px; flex-shrink:0; }
  .fav-name { flex:1; font-size:14px; color:var(--text); }
  .fav-del { background:none; border:none; color:var(--text3); font-size:16px; cursor:pointer; padding:0 2px; -webkit-tap-highlight-color:transparent; }

  /* Profile */
  .pcard { border:0.5px solid var(--border2); border-radius:12px; padding:14px; margin-bottom:10px; }
  .pcard h3 { font-size:13px; font-weight:500; color:var(--text); margin-bottom:10px; }
  .pchips { display:flex; flex-wrap:wrap; gap:5px; }
  .pchip { padding:5px 10px; border-radius:99px; background:var(--surface); color:var(--text2); font-size:11px; border:0.5px solid var(--border2); }
  .btn-edit { width:100%; padding:13px; border-radius:10px; border:0.5px solid var(--border2); background:transparent; color:var(--text2); font-family:'Inter',sans-serif; font-size:12px; cursor:pointer; margin-top:4px; }

  /* Modal */
  .overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-end; justify-content:center; animation:fi 0.2s ease; }
  @keyframes fi { from{opacity:0} to{opacity:1} }
  .modal { background:var(--bg); border-radius:16px 16px 0 0; padding:22px 20px 36px; width:100%; max-width:430px; max-height:75dvh; overflow-y:auto; animation:su 0.25s ease; }
  @keyframes su { from{transform:translateY(40px)} to{transform:translateY(0)} }
  .modal-meta { font-size:10px; color:var(--text2); margin-bottom:6px; }
  .modal-title { font-size:20px; font-weight:400; color:var(--text); margin-bottom:12px; letter-spacing:-0.02em; }
  .modal-detail { font-size:13px; color:var(--text2); line-height:1.8; white-space:pre-wrap; margin-bottom:18px; }
  .modal-del { width:100%; padding:13px; border-radius:10px; border:0.5px solid var(--danger); background:transparent; color:var(--danger); font-family:'Inter',sans-serif; font-size:12px; cursor:pointer; margin-bottom:8px; }
  .modal-close { width:100%; padding:13px; border-radius:10px; border:0.5px solid var(--border2); background:transparent; color:var(--text2); font-family:'Inter',sans-serif; font-size:12px; cursor:pointer; }

  /* Onboarding */
  .ob { flex:1; display:flex; flex-direction:column; padding:28px 20px 24px; animation:fadeUp 0.3s ease both; }
  @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
  .ob-dots { display:flex; gap:5px; margin-bottom:28px; }
  .ob-dot { height:2px; flex:1; border-radius:99px; background:var(--border2); transition:background 0.3s; }
  .ob-dot.done { background:var(--text2); }
  .ob-dot.active { background:var(--text); }
  .ob-welcome { flex:1; display:flex; flex-direction:column; justify-content:center; padding:30px 0; }
  .ob-big { font-size:36px; font-weight:300; color:var(--text); letter-spacing:-0.04em; line-height:1.1; margin-bottom:12px; }
  .ob-sub { font-size:13px; color:var(--text2); line-height:1.6; max-width:280px; }
  .ob-q { font-size:22px; font-weight:400; color:var(--text); line-height:1.3; margin-bottom:6px; letter-spacing:-0.02em; }
  .ob-hint { font-size:11px; color:var(--text2); margin-bottom:18px; }
  .ob-opts { display:flex; flex-wrap:wrap; gap:7px; flex:1; align-content:flex-start; }
  .ob-chip { padding:10px 14px; border-radius:99px; border:0.5px solid var(--border2); background:transparent; color:var(--text2); font-size:12px; cursor:pointer; font-family:'Inter',sans-serif; transition:all 0.15s; -webkit-tap-highlight-color:transparent; }
  .ob-chip.on { background:var(--accent); color:var(--accent-text); border-color:var(--accent); }
  .ob-textarea { width:100%; padding:13px; border-radius:10px; border:0.5px solid var(--border2); background:var(--surface); color:var(--text); font-family:'Inter',sans-serif; font-size:13px; outline:none; resize:none; }
  .ob-textarea:focus { border-color:var(--text2); }
  .ob-nav { display:flex; gap:8px; margin-top:24px; }
  .ob-back { padding:14px 18px; border-radius:10px; border:0.5px solid var(--border2); background:transparent; color:var(--text2); font-family:'Inter',sans-serif; font-size:13px; cursor:pointer; }
  .ob-next { flex:1; padding:14px; border-radius:10px; border:none; background:var(--accent); color:var(--accent-text); font-family:'Inter',sans-serif; font-size:13px; cursor:pointer; }
  .ob-next:disabled { opacity:0.3; cursor:not-allowed; }

  /* Week history tabs */
  .week-hist-tabs { display:flex; gap:6px; margin-bottom:12px; overflow-x:auto; scrollbar-width:none; }
  .week-hist-tabs::-webkit-scrollbar { display:none; }
  .week-hist-chip { padding:6px 12px; border-radius:99px; border:0.5px solid var(--border2); background:transparent; color:var(--text2); font-family:'Inter',sans-serif; font-size:11px; cursor:pointer; white-space:nowrap; -webkit-tap-highlight-color:transparent; }
  .week-hist-chip.active { background:var(--surface); color:var(--text); border-color:var(--text); }
`;


// ─── API Key Setup ──────────────────────────────────────────────────────────
function ApiKeySetup({ onDone }) {
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const test = async () => {
    if (!key.trim().startsWith("sk-ant-")) {
      setError("La key debe empezar con sk-ant-");
      return;
    }
    setTesting(true);
    setError("");
    try {
      // Save temporarily to test
      localStorage.setItem("mk_apikey", key.trim());
      await callClaude([{ role:"user", content:"di solo: ok" }], "", 10);
      onDone(); // key works
    } catch {
      localStorage.removeItem("mk_apikey");
      setError("Key inválida o sin conexión. Verificá y volvé a intentar.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="ob">
      <div className="ob-welcome" style={{gap:20}}>
        <div className="ob-big">MealKit</div>
        <div className="ob-sub">
          Para funcionar, la app necesita tu API key de Anthropic. Es gratis obtenerla y solo la ingresás una vez.
        </div>
        <div style={{width:"100%",marginTop:8}}>
          <div className="flabel" style={{marginBottom:6}}>Tu API key</div>
          <input
            className="inp"
            type="password"
            placeholder="sk-ant-..."
            value={key}
            onChange={e => { setKey(e.target.value); setError(""); }}
            onKeyDown={e => e.key==="Enter" && test()}
            style={{marginBottom:8}}
          />
          {error && <div style={{fontSize:11,color:"var(--danger)",marginBottom:8}}>{error}</div>}
          <button className="ob-next" disabled={!key||testing} onClick={test} style={{width:"100%"}}>
            {testing ? "Verificando..." : "Guardar y continuar →"}
          </button>
        </div>
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          style={{fontSize:11,color:"var(--text2)",textDecoration:"underline",marginTop:4}}
        >
          ¿No tenés key? Obtené una gratis →
        </a>
      </div>
    </div>
  );
}

// ─── Onboarding ─────────────────────────────────────────────────────────────
function Onboarding({ onDone }) {
  const [step, setStep] = useState(-1);
  const [answers, setAnswers] = useState({});
  const [textVal, setTextVal] = useState("");
  const current = OB_STEPS[step];

  const toggle = (val) => {
    const key = current.id;
    if (current.multi) {
      const prev = answers[key] || [];
      setAnswers({ ...answers, [key]: prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val] });
    } else {
      setAnswers({ ...answers, [key]: val });
    }
  };

  const canAdvance = () => {
    if (step === -1 || current?.optional || current?.type === "text") return true;
    const val = answers[current?.id];
    return current?.multi ? val?.length > 0 : !!val;
  };

  const next = () => {
    if (current?.type === "text") setAnswers(a => ({ ...a, [current.id]: textVal }));
    if (step < OB_STEPS.length - 1) { setStep(s => s + 1); setTextVal(""); }
    else onDone(answers);
  };

  if (step === -1) return (
    <div className="ob">
      <div className="ob-welcome">
        <div className="ob-big">Hola,<br />bienvenido<br />a MealKit.</div>
        <div className="ob-sub">Antes de arrancar, contame sobre tus gustos para personalizar las sugerencias.</div>
        <button className="ob-next" style={{marginTop:32}} onClick={() => setStep(0)}>Empezar →</button>
      </div>
    </div>
  );

  return (
    <div className="ob">
      <div className="ob-dots">
        {OB_STEPS.map((_,i) => <div key={i} className={`ob-dot ${i<step?"done":i===step?"active":""}`} />)}
      </div>
      <p className="ob-q">{current.question}</p>
      {current.hint && <p className="ob-hint">{current.hint}</p>}
      {current.type === "text"
        ? <textarea className="ob-textarea" rows={3} placeholder="ej: cebolla, hígado..." value={textVal} onChange={e => setTextVal(e.target.value)} />
        : <div className="ob-opts">
            {current.options.map(opt => (
              <button key={opt}
                className={`ob-chip ${(current.multi?(answers[current.id]||[]).includes(opt):answers[current.id]===opt)?"on":""}`}
                onClick={() => toggle(opt)}>{opt}</button>
            ))}
          </div>
      }
      <div className="ob-nav">
        {step > 0 && <button className="ob-back" onClick={() => setStep(s => s-1)}>←</button>}
        <button className="ob-next" disabled={!canAdvance()} onClick={next}>
          {step === OB_STEPS.length-1 ? "Listo →" : "Siguiente →"}
        </button>
      </div>
    </div>
  );
}

// ─── Cook Mode ───────────────────────────────────────────────────────────────
function CookMode({ meal, onClose }) {
  const steps = parseSteps(meal.detail);
  const [current, setCurrent] = useState(0);

  return (
    <div className="cook-mode">
      <div className="cook-header">
        <button className="btn-close-cook" onClick={onClose}>✕</button>
        <div className="cook-title">{meal.title}</div>
      </div>
      <div className="cook-progress">
        {steps.map((_,i) => (
          <div key={i} className={`cook-pip ${i < current ? "done" : i === current ? "active" : ""}`} />
        ))}
      </div>
      <div className="cook-step">
        <div className="cook-step-num">Paso {current + 1} de {steps.length}</div>
        <div className="cook-step-text">{steps[current]}</div>
      </div>
      <div className="cook-nav">
        {current > 0
          ? <button className="btn-cook-prev" onClick={() => setCurrent(c => c-1)}>← Anterior</button>
          : <div />
        }
        {current < steps.length - 1
          ? <button className="btn-cook-next" onClick={() => setCurrent(c => c+1)}>Siguiente →</button>
          : <button className="btn-cook-next" onClick={onClose}>¡Listo! 🎉</button>
        }
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function App() {
  const [dark, setDark]           = useState(() => load("mk_dark", true));
  const [apiKey, setApiKey]         = useState(() => !!localStorage.getItem("mk_apikey"));
  const [profile, setProfile]     = useState(() => load("mk_profile", null));
  const [items, setItems]         = useState(() => load("mk_items", []));
  const [tab, setTab]             = useState("stock");
  const [editProfile, setEditProfile] = useState(false);
  const [weekPlan, setWeekPlan]   = useState(() => load("mk_week", {}));
  const [favorites, setFavorites] = useState(() => load("mk_favs", []));
  const [shopChecked, setShopChecked] = useState({});
  const [modalMeal, setModalMeal] = useState(null);
  const [cookMeal, setCookMeal]   = useState(null);
  const [weekOffset, setWeekOffset] = useState(0); // 0=current, -1=last week, etc.

  // Daily suggestion
  const [dailySug, setDailySug]   = useState(null);
  const [dailyLoading, setDailyLoading] = useState(false);

  // Form
  const [name, setName]     = useState("");
  const [qty, setQty]       = useState("");
  const [unit, setUnit]     = useState("unid.");
  const [detectedCat, setDetectedCat] = useState(null);
  const [classifying, setClassifying] = useState(false);
  const [editingQty, setEditingQty]   = useState(null);
  const classifyTimer = useRef(null);

  // Suggest
  const [mealType, setMealType]     = useState(() => currentMealType());
  const [mood, setMood]             = useState("normal");
  const [suggestions, setSuggestions] = useState([]);
  const [suggesting, setSuggesting]   = useState(false);
  const [rawSuggest, setRawSuggest]   = useState("");

  useEffect(() => save("mk_dark", dark), [dark]);
  useEffect(() => save("mk_items", items), [items]);
  useEffect(() => save("mk_week", weekPlan), [weekPlan]);
  useEffect(() => save("mk_favs", favorites), [favorites]);

  const weekKey = getWeekKey(weekOffset);
  const currentWeek = weekPlan[weekKey] || {};
  const today = todayIndex();

  const weekHistory = Object.entries(currentWeek).map(([key, meal]) => {
    const [dayStr, ...rest] = key.split("_");
    const mt = rest.join("_");
    const mtObj = MEAL_TYPES.find(m => m[0] === mt);
    return { dayIdx: parseInt(dayStr), mealTypeKey: mt, mealTypeLabel: mtObj?.[2] ?? mt, emoji: mtObj?.[1] ?? "🍽", ...meal };
  }).sort((a,b) => a.dayIdx - b.dayIdx);

  const alreadyThisWeek = (title) => {
    const cur = weekPlan[getWeekKey(0)] || {};
    return Object.values(cur).some(m => m.title?.toLowerCase() === title.toLowerCase());
  };

  // ── Daily suggestion on stock tab load ──
  useEffect(() => {
    if (tab === "stock" && !dailySug && items.length > 0 && profile) {
      loadDailySuggestion();
    }
  }, [tab, items.length, profile]);

  const loadDailySuggestion = async () => {
    setDailyLoading(true);
    const mt = currentMealType();
    const mtLabel = MEAL_TYPES.find(m => m[0] === mt)?.[2] ?? mt;
    const ingredientList = items.slice(0,10).map(i => i.name).join(", ");
    const profileSummary = profile ? `Perfil: ${(profile.cuisines||[]).join(", ")}. No le gusta: ${profile.disliked||"nada"}.` : "";
    try {
      const text = await callClaude(
        [{ role:"user", content:`Ingredientes disponibles: ${ingredientList}. Sugerí UNA sola opción para el ${mtLabel} de hoy. Respondé SOLO con el nombre del plato, sin explicación.` }],
        `Chef casero en español rioplatense. ${profileSummary}`,
        60
      );
      const title = text.trim().replace(/^\*+|\*+$/g,"").replace(/^["']|["']$/g,"");
      setDailySug({ title, mealTypeLabel: mtLabel });
    } catch { /* silently fail */ }
    finally { setDailyLoading(false); }
  };

  // ── Auto-classify ──
  const autoClassify = useCallback(async (foodName) => {
    if (!foodName || foodName.length < 3) { setDetectedCat(null); return; }
    setClassifying(true);
    try {
      const text = await callClaude(
        [{ role:"user", content:`Clasificá "${foodName}" en UNA de estas categorías: proteinas, verduras, tuberculos, lacteos, legumbres, cereales, aceites, condimentos, frutas, bebidas, otros. Respondé SOLO con la palabra clave en minúsculas.` }],
        "Clasificador de alimentos. Respondés SOLO con una palabra.", 20
      );
      const cat = text.trim().toLowerCase().replace(/[^a-z]/g,"");
      setDetectedCat(CAT_LABELS[cat] ? cat : "otros");
    } catch { setDetectedCat(null); }
    finally { setClassifying(false); }
  }, []);

  const handleNameChange = (val) => {
    setName(val); setDetectedCat(null);
    if (classifyTimer.current) clearTimeout(classifyTimer.current);
    classifyTimer.current = setTimeout(() => autoClassify(val), 900);
  };

  const addItem = () => {
    if (!name.trim() || !qty) return;
    const cat = detectedCat || "otros";
    const existing = items.findIndex(i => i.name.toLowerCase() === name.toLowerCase());
    if (existing >= 0) {
      const updated = [...items];
      updated[existing].qty = String(parseFloat(updated[existing].qty) + parseFloat(qty));
      setItems(updated);
    } else {
      setItems(prev => [...prev, { id:Date.now(), name:name.trim(), qty, unit, category:cat }]);
    }
    setName(""); setQty(""); setDetectedCat(null);
  };

  const lowStock = items.filter(i => i.unit === "unid." && parseFloat(i.qty) <= 2);
  const grouped = items.reduce((acc, item) => {
    const k = item.category || "otros";
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});

  const addToPlan = (dayIdx, mealTypeKey, meal) => {
    const key = `${dayIdx}_${mealTypeKey}`;
    setWeekPlan(prev => ({ ...prev, [getWeekKey(0)]: { ...(prev[getWeekKey(0)] || {}), [key]: meal } }));
  };

  const removeFromPlan = (dayIdx, mealTypeKey) => {
    const key = `${dayIdx}_${mealTypeKey}`;
    setWeekPlan(prev => {
      const week = { ...(prev[weekKey] || {}) };
      delete week[key];
      return { ...prev, [weekKey]: week };
    });
  };

  const toggleFavorite = (meal) => {
    const exists = favorites.find(f => f.title === meal.title);
    if (exists) setFavorites(prev => prev.filter(f => f.title !== meal.title));
    else setFavorites(prev => [...prev, meal]);
  };

  const isFavorite = (title) => favorites.some(f => f.title === title);

  const getSuggestions = async () => {
    if (items.length === 0) return;
    setSuggesting(true); setSuggestions([]); setRawSuggest("");
    const ingredientList = items.map(i => `${i.name}: ${i.qty} ${i.unit}`).join(", ");
    const curWeekPlan = weekPlan[getWeekKey(0)] || {};
    const historyList = Object.values(curWeekPlan).length
      ? `Esta semana ya comió: ${Object.values(curWeekPlan).map(m => m.title).join(", ")}.`
      : "";
    const profileSummary = profile
      ? `Perfil: ${(profile.cuisines||[]).join(", ")}. Restricciones: ${(profile.restrictions||[]).join(", ")||"ninguna"}. Tiempo: ${profile.cooking_time}. Porciones: ${profile.servings}. No le gusta: ${profile.disliked||"nada"}.`
      : "";
    const moodMap = { normal:"Sugerí 3 opciones que se ajusten al perfil.", surprise:"Opciones creativas e inesperadas.", rapido:"Solo opciones en menos de 20 minutos." };
    const prompt = `Ingredientes: ${ingredientList}\n\n${historyList}\n\n${moodMap[mood]}\n\nFormato para cada opción:\n**Nombre del plato**\nIngredientes usados: ...\nPreparación: paso 1 / paso 2 / paso 3`;
    const system = `Chef casero en español rioplatense. Directo y práctico. ${profileSummary} Tipo: ${mealType}.`;
    try {
      const text = await callClaude([{ role:"user", content:prompt }], system, 1000);
      const parsed = parseSuggestions(text);
      if (parsed.length > 0) setSuggestions(parsed);
      else setRawSuggest(text);
    } catch { setRawSuggest("No se pudo conectar con la API."); }
    finally { setSuggesting(false); }
  };

  const handleProfileDone = (answers) => {
    save("mk_profile", answers); setProfile(answers); setEditProfile(false);
  };

  const shopItems = items.filter(i => parseFloat(i.qty) === 0 || (i.unit === "unid." && parseFloat(i.qty) <= 2));

  // Week label
  const weekLabels = { 0: "Esta semana", [-1]: "Semana pasada", [-2]: "Hace 2 semanas" };

  if (!apiKey) return (
    <><style>{CSS}</style>
    <div className={`app ${dark?"mk-dark":"mk-light"}`}>
      <ApiKeySetup onDone={() => setApiKey(true)} />
    </div></>
  );

  if (!profile || editProfile) return (
    <><style>{CSS}</style>
    <div className={`app ${dark?"mk-dark":"mk-light"}`}>
      <div className="hdr">
        <div><div className="logo">MealKit</div></div>
        <button className="toggle" onClick={() => setDark(d=>!d)} aria-label="Modo">
          <div className="toggle-dot" />
        </button>
      </div>
      <Onboarding onDone={handleProfileDone} />
    </div></>
  );

  if (cookMeal) return (
    <><style>{CSS}</style>
    <div className={`app ${dark?"mk-dark":"mk-light"}`}>
      <CookMode meal={cookMeal} onClose={() => setCookMeal(null)} />
    </div></>
  );

  return (
    <><style>{CSS}</style>
    <div className={`app ${dark?"mk-dark":"mk-light"}`}>

      <header className="hdr">
        <div>
          <div className="logo">MealKit</div>
          <div className="logo-sub">{items.length} ingredientes</div>
        </div>
        <button className="toggle" onClick={() => setDark(d=>!d)} aria-label="Modo">
          <div className="toggle-dot" />
        </button>
      </header>

      <nav className="tabs">
        {[["stock","Stock"],["sugerir","Sugerir"],["semana","Semana"],["favoritos","★ Favoritos"],["compras","Compras"],["perfil","Perfil"]].map(([id,label]) => (
          <button key={id} className={`tab ${tab===id?"active":""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      <div className="content">

        {/* ── STOCK ── */}
        {tab === "stock" && <>
          <div className="big-num">{items.length}</div>
          <div className="big-label">ingredientes disponibles</div>

          {/* Daily suggestion banner */}
          {(dailySug || dailyLoading) && (
            <div className="daily-banner" onClick={() => dailySug && setTab("sugerir")}>
              <div className="daily-banner-label">💡 Sugerencia para hoy</div>
              {dailyLoading
                ? <div className="daily-banner-loading">Buscando idea...</div>
                : <>
                    <div className="daily-banner-title">{dailySug.title}</div>
                    <div className="daily-banner-sub">{dailySug.mealTypeLabel} · Tocá para ver más opciones</div>
                  </>
              }
            </div>
          )}

          {lowStock.length > 0 && (
            <div className="alert">
              <div className="alert-title">Stock bajo</div>
              <div className="alert-chips">
                {lowStock.map(i => <span key={i.id} className="alert-chip">{i.name}</span>)}
              </div>
            </div>
          )}

          <div className="add-row">
            <div className="field" style={{flex:2}}>
              <div className="flabel">Alimento</div>
              <input className={`inp ${classifying?"scanning":""}`} placeholder="ej: tomate..."
                value={name} onChange={e => handleNameChange(e.target.value)}
                onKeyDown={e => e.key==="Enter"&&addItem()} />
            </div>
            <div className="field" style={{width:62}}>
              <div className="flabel">Cant.</div>
              <input className="inp" type="number" min="0" step="any" placeholder="0"
                value={qty} onChange={e => setQty(e.target.value)}
                onKeyDown={e => e.key==="Enter"&&addItem()} />
            </div>
            <div className="field" style={{width:72}}>
              <div className="flabel">Unidad</div>
              <select className="inp" value={unit} onChange={e => setUnit(e.target.value)}>
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <button className="btn-add" disabled={!name||!qty} onClick={addItem}>+</button>
          </div>

          {classifying && <div className="cat-hint">Clasificando...</div>}
          {detectedCat && !classifying && (
            <div className="cat-hint">{CAT_ICONS[detectedCat]} {CAT_LABELS[detectedCat]}</div>
          )}

          {items.length === 0
            ? <div className="empty">Despensa vacía.<br />Agregá tu primer ingrediente.</div>
            : Object.entries(grouped).map(([cat, catItems]) => (
                <div key={cat}>
                  <div className="divider-label">{CAT_ICONS[cat]} {CAT_LABELS[cat]}</div>
                  {catItems.map(item => (
                    <div key={item.id} className="item-row">
                      <span className="item-name">{item.name}</span>
                      {editingQty?.id === item.id
                        ? <input className="inp qty-input" type="number" min="0" step="any"
                            value={editingQty.val} autoFocus
                            onChange={e => setEditingQty({id:item.id,val:e.target.value})}
                            onBlur={() => {
                              if (editingQty.val !== "") setItems(prev => prev.map(i => i.id===item.id?{...i,qty:editingQty.val}:i));
                              setEditingQty(null);
                            }}
                            onKeyDown={e => { if(e.key==="Enter")e.target.blur(); if(e.key==="Escape")setEditingQty(null); }}
                          />
                        : <span className="item-qty" onClick={() => setEditingQty({id:item.id,val:item.qty})}>
                            {item.qty} {item.unit}
                          </span>
                      }
                      <button className="btn-del" onClick={() => setItems(prev => prev.filter(i => i.id!==item.id))}>×</button>
                    </div>
                  ))}
                </div>
              ))
          }
        </>}

        {/* ── SUGERIR ── */}
        {tab === "sugerir" && <>
          <div className="seg-grid">
            {MEAL_TYPES.map(([id,icon,label]) => (
              <button key={id} className={`seg-btn ${mealType===id?"active":""}`} onClick={() => setMealType(id)}>
                {icon} {label}
              </button>
            ))}
          </div>
          <div className="mood-row">
            {[["normal","Normal"],["surprise","Sorprendeme"],["rapido","Rápido"]].map(([id,label]) => (
              <button key={id} className={`mood-chip ${mood===id?"active":""}`} onClick={() => setMood(id)}>{label}</button>
            ))}
          </div>
          <button className="btn-suggest" disabled={suggesting||items.length===0} onClick={getSuggestions}>
            {suggesting
              ? <span className="dots">Pensando<span>.</span><span>.</span><span>.</span></span>
              : "Ver qué puedo cocinar →"}
          </button>

          {/* Favorites quick access */}
          {favorites.length > 0 && !suggestions.length && !suggesting && (
            <>
              <div className="divider-label">favoritos</div>
              {favorites.slice(0,2).map((f,i) => (
                <div key={i} className="fav-item" onClick={() => setCookMeal(f)}>
                  <div className="fav-emoji">{getFallbackEmoji(f.title)}</div>
                  <div className="fav-name">{f.title}</div>
                  <span style={{fontSize:11,color:"var(--text2)"}}>Cocinar →</span>
                </div>
              ))}
            </>
          )}

          {items.length === 0 && <div className="empty">Agregá ingredientes en Stock primero.</div>}

          {suggestions.map((s,i) => {
            const imgUrl = getFoodishUrl(s.title);
            const emoji = getFallbackEmoji(s.title);
            const fav = isFavorite(s.title);
            return (
              <div key={i} className="sug-card">
                <div className="sug-img-wrap">
                  <div className="sug-img-emoji">{emoji}</div>
                  <img className="sug-img" src={imgUrl} alt={s.title}
                    onLoad={e => { e.target.style.opacity=1; }}
                    onError={e => { e.target.style.display="none"; }}
                    style={{opacity:0,position:"relative",zIndex:1}} />
                </div>
                <div className="sug-body">
                  <div className="sug-title">{s.title}</div>
                  <div className="sug-detail">{s.detail}</div>
                  <div className="sug-actions">
                    <select className="sug-select" defaultValue=""
                      onChange={e => {
                        if (!e.target.value) return;
                        const [d,mt] = e.target.value.split("|");
                        addToPlan(parseInt(d), mt, s);
                        e.target.value="";
                      }}>
                      <option value="">+ Agregar al plan</option>
                      {DAYS.map((day,di) => MEAL_TYPES.map(([mt,icon,label]) => (
                        <option key={`${di}_${mt}`} value={`${di}|${mt}`}>{day} — {label}</option>
                      )))}
                    </select>
                    <button className="btn-cook" onClick={() => setCookMeal(s)}>Cocinar</button>
                    <button className={`btn-fav ${fav?"saved":""}`} onClick={() => toggleFavorite(s)}>
                      {fav ? "★" : "☆"}
                    </button>
                  </div>
                  {alreadyThisWeek(s.title) && <div style={{marginTop:8}}><span className="already-tag">ya lo comiste esta semana</span></div>}
                </div>
              </div>
            );
          })}

          {rawSuggest && !suggestions.length && (
            <div className="sug-card"><div className="sug-body"><div className="sug-detail">{rawSuggest}</div></div></div>
          )}
          {!suggesting && !suggestions.length && !rawSuggest && items.length > 0 && (
            <div className="empty">Elegí tipo de comida y estado de ánimo.</div>
          )}
        </>}

        {/* ── SEMANA ── */}
        {tab === "semana" && <>
          <div className="week-top">
            <div className="week-title">{weekLabels[weekOffset] ?? `Semana del ${weekKey}`}</div>
            {weekOffset === 0 && (
              <button className="btn-ghost" onClick={() => setWeekPlan(p => ({...p,[weekKey]:{}}))}>Limpiar</button>
            )}
          </div>

          {/* Week navigator */}
          <div className="week-hist-tabs">
            {[0,-1,-2].map(o => (
              <button key={o} className={`week-hist-chip ${weekOffset===o?"active":""}`} onClick={() => setWeekOffset(o)}>
                {weekLabels[o]}
              </button>
            ))}
          </div>

          <div className="week-grid">
            {DAYS.map((day,di) => (
              <div key={di} className="day-col">
                <div className={`day-lbl ${di===today&&weekOffset===0?"today":""}`}>{day}</div>
                {MEAL_TYPES.map(([mt,icon]) => {
                  const meal = currentWeek[`${di}_${mt}`];
                  return (
                    <div key={mt} className={`meal-cell ${meal?"filled":""}`}
                      onClick={() => meal && setModalMeal({...meal,dayLabel:day,mealTypeLabel:MEAL_TYPES.find(m=>m[0]===mt)?.[2],dayIdx:di,mealTypeKey:mt})}>
                      <div className="meal-cell-icon">{icon}</div>
                      {meal && <div className="meal-cell-name">{meal.title}</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="divider-label">detalle</div>
          {weekHistory.length === 0
            ? <div className="empty">Nada planificado{weekOffset < 0 ? " esa semana" : " todavía"}.</div>
            : weekHistory.map((h,i) => (
                <div key={i} className="history-item"
                  onClick={() => setModalMeal({title:h.title,detail:h.detail,dayLabel:DAYS[h.dayIdx],mealTypeLabel:h.mealTypeLabel,dayIdx:h.dayIdx,mealTypeKey:h.mealTypeKey})}>
                  <span className="h-day">{DAYS[h.dayIdx]}</span>
                  <span className="h-icon">{h.emoji}</span>
                  <span className="h-name">{h.title}</span>
                  <span className="h-type">{h.mealTypeLabel}</span>
                </div>
              ))
          }
        </>}

        {/* ── FAVORITOS ── */}
        {tab === "favoritos" && <>
          {favorites.length === 0
            ? <div className="empty">No tenés favoritos todavía.<br />Guardá recetas con ☆ en "Sugerir".</div>
            : favorites.map((f,i) => (
                <div key={i} className="fav-item">
                  <div className="fav-emoji">{getFallbackEmoji(f.title)}</div>
                  <div style={{flex:1}}>
                    <div className="fav-name">{f.title}</div>
                    <div style={{fontSize:11,color:"var(--text2)",marginTop:2,lineHeight:1.5}}>{f.detail?.slice(0,60)}...</div>
                  </div>
                  <button className="btn-cook" style={{marginRight:6}} onClick={() => setCookMeal(f)}>Cocinar</button>
                  <button className="fav-del" onClick={() => setFavorites(prev => prev.filter((_,j) => j !== i))}>×</button>
                </div>
              ))
          }
        </>}

        {/* ── COMPRAS ── */}
        {tab === "compras" && <>
          <div className="shop-hint">Generada desde ítems con stock bajo o en cero</div>
          {shopItems.length === 0
            ? <div className="empty">No hay nada para comprar. 🎉</div>
            : shopItems.map(item => {
                const checked = !!shopChecked[item.id];
                return (
                  <div key={item.id} className="shop-item">
                    <div className={`shop-check ${checked?"on":""}`}
                      onClick={() => setShopChecked(p => ({...p,[item.id]:!p[item.id]}))}>
                      {checked && <span style={{color:"var(--accent-text)",fontSize:12}}>✓</span>}
                    </div>
                    <span className={`shop-name ${checked?"done":""}`}>{CAT_ICONS[item.category]} {item.name}</span>
                    <span className="shop-qty">{item.qty} {item.unit}</span>
                  </div>
                );
              })
          }
          {shopItems.some(i => !!shopChecked[i.id]) && (
            <button className="btn-confirm"
              onClick={() => {
                setItems(prev => prev.map(item => {
                  if (!shopChecked[item.id]) return item;
                  return { ...item, qty: item.unit==="unid."?"5":item.qty };
                }));
                setShopChecked({});
              }}>
              Confirmar compra → reponer stock
            </button>
          )}
        </>}

        {/* ── PERFIL ── */}
        {tab === "perfil" && <>
          {profile.cuisines?.length > 0 && (
            <div className="pcard">
              <h3>Tipo de cocina</h3>
              <div className="pchips">{profile.cuisines.map(c => <span key={c} className="pchip">{c}</span>)}</div>
            </div>
          )}
          {profile.restrictions?.length > 0 && (
            <div className="pcard">
              <h3>Restricciones</h3>
              <div className="pchips">{profile.restrictions.map(c => <span key={c} className="pchip">{c}</span>)}</div>
            </div>
          )}
          <div className="pcard">
            <h3>Preferencias</h3>
            <div className="pchips">
              <span className="pchip">{profile.cooking_time}</span>
              <span className="pchip">{profile.servings}</span>
            </div>
          </div>
          {profile.disliked && (
            <div className="pcard">
              <h3>No me gusta</h3>
              <p style={{fontSize:13,color:"var(--text2)"}}>{profile.disliked}</p>
            </div>
          )}
          <button className="btn-edit" onClick={() => setEditProfile(true)}>Editar perfil</button>
          <button className="btn-edit" style={{marginTop:6,color:"var(--danger)",borderColor:"var(--danger)"}}
            onClick={() => { localStorage.removeItem("mk_apikey"); setApiKey(false); }}>
            Cambiar API key
          </button>
        </>}

      </div>

      {/* Modal meal detail */}
      {modalMeal && (
        <div className="overlay" onClick={() => setModalMeal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-meta">{modalMeal.dayLabel} · {modalMeal.mealTypeLabel}</div>
            <div className="modal-title">{modalMeal.title}</div>
            <div className="modal-detail">{modalMeal.detail}</div>
            <button className="btn-suggest" style={{marginBottom:10}} onClick={() => { setCookMeal(modalMeal); setModalMeal(null); }}>
              Cocinar paso a paso →
            </button>
            {weekOffset === 0 && (
              <button className="modal-del" onClick={() => { removeFromPlan(modalMeal.dayIdx,modalMeal.mealTypeKey); setModalMeal(null); }}>
                Quitar del plan
              </button>
            )}
            <button className="modal-close" onClick={() => setModalMeal(null)}>Cerrar</button>
          </div>
        </div>
      )}

    </div></>
  );
}
