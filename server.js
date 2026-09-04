const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const PROVIDER_TOKEN = process.env.PAYMENT_PROVIDER_TOKEN || "";
const CURRENCY = process.env.CURRENCY || "EUR";
const DEV_MODE = String(process.env.DEV_MODE || "true").toLowerCase() === "true";
const ADMIN_IDS = new Set(
  String(process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",").map(x => x.trim()).filter(Boolean)
);

const DB_PATH = path.join(__dirname, "db.json");

app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

function seedDb() {
  return {
    products: [
      {
        id: "p1",
        title: "Aero Aluminum Headphones",
        subtitle: "CNC aluminium · spatial audio",
        price: 14900,
        oldPrice: 17900,
        category: "Audio",
        stock: 18,
        badge: "New",
        image: "",
        tone: "graphite",
        description: "Премиальные полноразмерные наушники от независимого китайского производителя: алюминиевый корпус, мягкие амбушюры и беспроводное подключение.",
        specs: ["Bluetooth 5.4", "40 мм driver", "до 45 ч", "USB‑C"]
      },
      {
        id: "p2",
        title: "Stone Mini Projector",
        subtitle: "1080p · compact cinema",
        price: 21900,
        oldPrice: 24900,
        category: "Tech",
        stock: 9,
        badge: "Popular",
        image: "",
        tone: "sand",
        description: "Компактный проектор с лаконичным корпусом, автофокусом и поддержкой беспроводного вывода изображения.",
        specs: ["1080p", "автофокус", "Wi‑Fi 6", "HDMI"]
      },
      {
        id: "p3",
        title: "Mono Carry 24",
        subtitle: "Polycarbonate travel case",
        price: 18900,
        oldPrice: null,
        category: "Travel",
        stock: 12,
        badge: "Limited",
        image: "",
        tone: "silver",
        description: "Минималистичный чемодан из ударопрочного поликарбоната с алюминиевой рамой и тихими колёсами.",
        specs: ["24 inch", "TSA lock", "4.1 кг", "360° wheels"]
      },
      {
        id: "p4",
        title: "Ink Mechanical Keyboard",
        subtitle: "75% · hot-swap",
        price: 9900,
        oldPrice: 11900,
        category: "Tech",
        stock: 27,
        badge: "",
        image: "",
        tone: "ink",
        description: "Компактная механическая клавиатура 75% с hot-swap, gasket mount и тройным режимом подключения.",
        specs: ["75%", "Hot-swap", "2.4G / BT / USB", "RGB"]
      },
      {
        id: "p5",
        title: "Arc Desk Light",
        subtitle: "Ambient light · touch control",
        price: 7900,
        oldPrice: null,
        category: "Home",
        stock: 34,
        badge: "Editor’s pick",
        image: "",
        tone: "cream",
        description: "Настольный светильник с мягким рассеянным светом, сенсорным управлением и регулируемой температурой.",
        specs: ["2700–6000K", "USB‑C", "touch", "12W"]
      },
      {
        id: "p6",
        title: "Frame Sling",
        subtitle: "Technical fabric · magnetic lock",
        price: 6900,
        oldPrice: 8500,
        category: "Bags",
        stock: 21,
        badge: "",
        image: "",
        tone: "olive",
        description: "Компактная городская сумка из плотной технической ткани с магнитной застёжкой и внутренними органайзерами.",
        specs: ["4.5 L", "water resistant", "magnetic lock", "280 г"]
      }
    ],
    orders: [],
    settings: {
      shippingMethods: [
        { id: "standard", title: "Standard", subtitle: "10–18 дней", price: 900 },
        { id: "express", title: "Express", subtitle: "5–9 дней", price: 1900 }
      ]
    }
  };
}

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    const db = seedDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
    return db;
  }
}
let db = loadDb();

function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function validateInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");

    const authDate = Number(params.get("auth_date") || 0);
    if (!authDate || Math.abs(Date.now()/1000 - authDate) > 86400) return null;

    const dataCheckString = [...params.entries()]
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([k,v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    const calculated = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const a = Buffer.from(calculated, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const rawUser = params.get("user");
    if (!rawUser) return null;
    return JSON.parse(rawUser);
  } catch {
    return null;
  }
}

function auth(req, res, next) {
  const initData = String(req.headers["x-telegram-init-data"] || "");
  const user = validateInitData(initData);

  if (user) {
    req.tgUser = user;
    req.isAdmin = ADMIN_IDS.has(String(user.id));
    return next();
  }

  if (DEV_MODE) {
    req.tgUser = { id: 7770001, first_name: "Demo", username: "demo_user" };
    req.isAdmin = true;
    return next();
  }

  res.status(401).json({ error: "TELEGRAM_AUTH_REQUIRED" });
}

function adminOnly(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: "ADMIN_ONLY" });
  next();
}

function productPublic(p) {
  return { ...p };
}

app.get("/api/config", auth, (req, res) => {
  res.json({
    user: req.tgUser,
    isAdmin: req.isAdmin,
    currency: CURRENCY,
    devMode: DEV_MODE,
    paymentsReady: !!(BOT_TOKEN && PROVIDER_TOKEN),
    shippingMethods: db.settings.shippingMethods
  });
});

app.get("/api/products", auth, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const category = String(req.query.category || "").trim();
  let list = db.products.filter(p => p.stock >= 0);
  if (q) list = list.filter(p =>
    [p.title, p.subtitle, p.category, p.description].join(" ").toLowerCase().includes(q)
  );
  if (category && category !== "All") list = list.filter(p => p.category === category);
  res.json({ products: list.map(productPublic) });
});

app.get("/api/products/:id", auth, (req, res) => {
  const p = db.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({ product: productPublic(p) });
});

app.get("/api/orders/mine", auth, (req, res) => {
  const list = db.orders
    .filter(o => String(o.telegramUserId) === String(req.tgUser.id))
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ orders: list });
});

function normalizeItems(items) {
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const product = db.products.find(p => p.id === item.productId);
    const qty = Math.max(1, Math.min(10, Number(item.qty) || 1));
    if (!product) continue;
    if (product.stock < qty) throw new Error(`Недостаточно товара: ${product.title}`);
    result.push({
      productId: product.id,
      title: product.title,
      qty,
      unitPrice: product.price,
      total: product.price * qty
    });
  }
  if (!result.length) throw new Error("Корзина пуста");
  return result;
}

app.post("/api/checkout", auth, async (req, res) => {
  try {
    const items = normalizeItems(req.body.items);
    const shipping = db.settings.shippingMethods.find(x => x.id === req.body.shippingMethod);
    if (!shipping) return res.status(400).json({ error: "BAD_SHIPPING" });

    const address = req.body.address || {};
    if (!String(address.name || "").trim() ||
        !String(address.phone || "").trim() ||
        !String(address.country || "").trim() ||
        !String(address.city || "").trim() ||
        !String(address.address1 || "").trim()) {
      return res.status(400).json({ error: "ADDRESS_REQUIRED" });
    }

    const itemsTotal = items.reduce((n, x) => n + x.total, 0);
    const total = itemsTotal + shipping.price;
    const orderId = "ORD-" + Date.now().toString(36).toUpperCase();

    const order = {
      id: orderId,
      telegramUserId: req.tgUser.id,
      telegramUsername: req.tgUser.username || "",
      customerName: address.name,
      phone: address.phone,
      address: {
        country: address.country,
        city: address.city,
        address1: address.address1,
        postalCode: address.postalCode || ""
      },
      items,
      itemsTotal,
      shipping: { id: shipping.id, title: shipping.title, price: shipping.price },
      total,
      currency: CURRENCY,
      status: "awaiting_payment",
      createdAt: new Date().toISOString(),
      paymentChargeId: null,
      tracking: ""
    };
    db.orders.push(order);
    saveDb();

    // Telegram payment invoice for physical goods.
    if (BOT_TOKEN && PROVIDER_TOKEN) {
      const prices = [
        { label: `Товары (${items.reduce((n,x)=>n+x.qty,0)})`, amount: itemsTotal },
        { label: `Доставка: ${shipping.title}`, amount: shipping.price }
      ];

      const body = {
        title: `Заказ ${orderId}`,
        description: items.slice(0, 3).map(x => `${x.title} ×${x.qty}`).join(", ").slice(0, 255),
        payload: orderId,
        provider_token: PROVIDER_TOKEN,
        currency: CURRENCY,
        prices,
        need_name: false,
        need_phone_number: false,
        need_email: false,
        need_shipping_address: false
      };

      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const tg = await tgRes.json();
      if (!tg.ok) {
        order.paymentError = tg.description || "Telegram invoice error";
        saveDb();
        return res.status(502).json({ error: "PAYMENT_PROVIDER_ERROR", details: tg.description });
      }

      order.invoiceUrl = tg.result;
      saveDb();
      return res.json({ ok: true, orderId, invoiceUrl: tg.result, total, currency: CURRENCY });
    }

    // Developer preview when no payment provider is configured.
    return res.json({
      ok: true,
      orderId,
      demo: true,
      total,
      currency: CURRENCY
    });
  } catch (e) {
    res.status(400).json({ error: "CHECKOUT_ERROR", details: e.message });
  }
});

// Endpoint for Telegram Bot API webhook.
// Set webhook to: https://YOUR_DOMAIN/api/telegram/webhook
app.post("/api/telegram/webhook", (req, res) => {
  const update = req.body || {};

  if (update.pre_checkout_query && BOT_TOKEN) {
    const q = update.pre_checkout_query;
    const order = db.orders.find(o => o.id === q.invoice_payload);
    const ok = !!order && order.status === "awaiting_payment";
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pre_checkout_query_id: q.id,
        ok,
        ...(ok ? {} : { error_message: "Заказ больше недоступен. Создайте новый." })
      })
    }).catch(()=>{});
  }

  const msg = update.message;
  if (msg && msg.successful_payment) {
    const pay = msg.successful_payment;
    const order = db.orders.find(o => o.id === pay.invoice_payload);
    if (order) {
      order.status = "paid";
      order.paymentChargeId = pay.telegram_payment_charge_id || "";
      order.paidAt = new Date().toISOString();
      for (const item of order.items) {
        const p = db.products.find(x => x.id === item.productId);
        if (p) p.stock = Math.max(0, p.stock - item.qty);
      }
      saveDb();
    }
  }

  res.sendStatus(200);
});

app.get("/api/admin/stats", auth, adminOnly, (req, res) => {
  const revenue = db.orders.filter(o => ["paid","processing","shipped","delivered"].includes(o.status))
    .reduce((n,o)=>n+o.total,0);
  res.json({
    products: db.products.length,
    orders: db.orders.length,
    paidOrders: db.orders.filter(o=>o.status!=="awaiting_payment").length,
    revenue,
    lowStock: db.products.filter(p=>p.stock<=5).length
  });
});

app.get("/api/admin/orders", auth, adminOnly, (req, res) => {
  res.json({ orders: [...db.orders].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)) });
});

app.post("/api/admin/orders/:id/status", auth, adminOnly, (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "NOT_FOUND" });
  const allowed = ["awaiting_payment","paid","processing","shipped","delivered","cancelled"];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: "BAD_STATUS" });
  order.status = req.body.status;
  if (typeof req.body.tracking === "string") order.tracking = req.body.tracking.slice(0,100);
  order.updatedAt = new Date().toISOString();
  saveDb();
  res.json({ ok: true, order });
});

app.post("/api/admin/products", auth, adminOnly, (req, res) => {
  const p = req.body || {};
  if (!String(p.title||"").trim()) return res.status(400).json({error:"TITLE_REQUIRED"});
  const product = {
    id: "p_" + Date.now().toString(36),
    title: String(p.title).trim().slice(0,80),
    subtitle: String(p.subtitle||"").trim().slice(0,120),
    price: Math.max(0, Number(p.price)||0),
    oldPrice: p.oldPrice ? Math.max(0,Number(p.oldPrice)||0) : null,
    category: String(p.category||"Other").trim().slice(0,40),
    stock: Math.max(0,Number(p.stock)||0),
    badge: String(p.badge||"").trim().slice(0,30),
    image: String(p.image||"").trim().slice(0,1000),
    tone: String(p.tone||"graphite"),
    description: String(p.description||"").trim().slice(0,1000),
    specs: Array.isArray(p.specs) ? p.specs.slice(0,8).map(x=>String(x).slice(0,60)) : []
  };
  db.products.unshift(product);
  saveDb();
  res.json({ok:true,product});
});

app.delete("/api/admin/products/:id", auth, adminOnly, (req, res) => {
  const idx = db.products.findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({error:"NOT_FOUND"});
  db.products.splice(idx,1);
  saveDb();
  res.json({ok:true});
});

app.listen(PORT, () => console.log(`Telegram Lux Store running on :${PORT}`));
