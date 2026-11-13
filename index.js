'use strict';

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.set('trust proxy', 1);

// ============================================================================
// ENVIRONMENT & CONFIGURATION
// ============================================================================
const CONFIG = {
  MONGODB_URI: process.env.MONGODB_URI || '',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  SESSION_SECRET: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  BUSINESS_NAME: process.env.BUSINESS_NAME || 'Taufeeq Gaadi Centre & Furniture',
  BUSINESS_PHONE: process.env.BUSINESS_PHONE || '',
  BUSINESS_ADDRESS: process.env.BUSINESS_ADDRESS || '',
  BUSINESS_WHATSAPP: (process.env.BUSINESS_WHATSAPP || '').replace(/\D/g, ''),
  NODE_ENV: process.env.NODE_ENV || 'production'
};

const CATEGORIES = [
  'Beds',
  'Sofas',
  'Almari / Wardrobes',
  'Chairs',
  'Dining Tables',
  'Dressing Tables',
  'TV Units',
  'Cabinets',
  'Office Furniture',
  'Other Furniture'
];

const BOOKING_STATUSES = [
  'Pending',
  'Confirmed',
  'Processing',
  'Ready for Delivery',
  'Completed',
  'Cancelled'
];

// ============================================================================
// SECURITY & MIDDLEWARE
// ============================================================================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:', 'http:'],
        connectSrc: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser(CONFIG.SESSION_SECRET));

// NoSQL Injection Sanitizer
function sanitizeInput(obj) {
  if (obj === null || typeof obj !== 'object') {
    return typeof obj === 'string' ? obj.trim() : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeInput);
  }
  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$') || key.includes('.')) continue;
    clean[key] = sanitizeInput(value);
  }
  return clean;
}

app.use((req, _res, next) => {
  if (req.body) req.body = sanitizeInput(req.body);
  if (req.query) req.query = sanitizeInput(req.query);
  next();
});

// Rate Limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 250,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again shortly.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please wait 15 minutes.' }
});

app.use('/api/', apiLimiter);

// ============================================================================
// MONGODB ATLAS SERVERLESS CONNECTION MANAGEMENT
// ============================================================================
let cachedConn = global._mongooseConn || null;
let cachedPromise = global._mongoosePromise || null;

async function connectDB() {
  if (!CONFIG.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not configured.');
  }
  if (cachedConn && mongoose.connection.readyState === 1) {
    return cachedConn;
  }
  if (!cachedPromise) {
    cachedPromise = mongoose
      .connect(CONFIG.MONGODB_URI, {
        bufferCommands: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 30000
      })
      .then((m) => {
        cachedConn = m;
        global._mongooseConn = m;
        return m;
      })
      .catch((err) => {
        cachedPromise = null;
        global._mongoosePromise = null;
        throw err;
      });
    global._mongoosePromise = cachedPromise;
  }
  return cachedPromise;
}

// ============================================================================
// MONGOOSE SCHEMAS & MODELS
// ============================================================================
const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 140 },
    category: { type: String, required: true, enum: CATEGORIES },
    price: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 90 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    material: { type: String, default: 'Seasoned Teak & Engineered Wood', trim: true, maxlength: 150 },
    sizes: { type: [String], default: ['Standard'] },
    colors: { type: [String], default: ['Natural Teak', 'Walnut Brown'] },
    images: { type: [String], required: true },
    inStock: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    bestSeller: { type: Boolean, default: false },
    isSample: { type: Boolean, default: false }
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', description: 'text', category: 'text' });
productSchema.index({ category: 1, inStock: 1, price: 1 });
productSchema.index({ featured: 1, createdAt: -1 });

const bookingSchema = new mongoose.Schema(
  {
    bookingId: { type: String, required: true, unique: true, uppercase: true, trim: true },
    customerName: { type: String, required: true, trim: true, maxlength: 100 },
    mobileNumber: { type: String, required: true, trim: true, maxlength: 20 },
    whatsappNumber: { type: String, required: true, trim: true, maxlength: 20 },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    furnitureName: { type: String, required: true, trim: true, maxlength: 160 },
    unitPrice: { type: Number, default: 0, min: 0 },
    quantity: { type: Number, required: true, min: 1, max: 100 },
    preferredColor: { type: String, default: 'Standard', trim: true, maxlength: 60 },
    preferredSize: { type: String, default: 'Standard', trim: true, maxlength: 60 },
    deliveryAddress: { type: String, required: true, trim: true, maxlength: 400 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    pinCode: { type: String, required: true, trim: true, maxlength: 12 },
    message: { type: String, default: '', trim: true, maxlength: 1000 },
    status: { type: String, enum: BOOKING_STATUSES, default: 'Pending' }
  },
  { timestamps: true }
);

bookingSchema.index({ bookingId: 1, mobileNumber: 1 });
bookingSchema.index({ status: 1, createdAt: -1 });

const enquirySchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true, trim: true, maxlength: 100 },
    phoneNumber: { type: String, required: true, trim: true, maxlength: 20 },
    productName: { type: String, default: 'General Furniture Enquiry', trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ['New', 'Contacted', 'Resolved'], default: 'New' }
  },
  { timestamps: true }
);

enquirySchema.index({ status: 1, createdAt: -1 });

const Product = mongoose.models.Product || mongoose.model('Product', productSchema);
const Booking = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);
const Enquiry = mongoose.models.Enquiry || mongoose.model('Enquiry', enquirySchema);

// ============================================================================
// SAMPLE CATALOG SEEDER (ONLY WHEN DATABASE IS EMPTY)
// ============================================================================
const SAMPLE_PRODUCTS = [
  {
    name: 'Royal Maharaja King Size Teak Bed',
    category: 'Beds',
    price: 38500,
    discountPercent: 12,
    description: 'Handcrafted solid seasoned teak wood king-size bed with hydraulic box storage and cushioned headboard.',
    material: 'Solid Teak Wood & Premium Velvet Headboard',
    sizes: ['King (72x78 in)', 'Queen (60x78 in)'],
    colors: ['Royal Walnut', 'Honey Teak', 'Espresso Brown'],
    images: [
      'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=900&q=80'
    ],
    inStock: true,
    featured: true,
    bestSeller: true,
    isSample: true
  },
  {
    name: 'Nawab Velvet L-Shape Luxury Sofa Set',
    category: 'Sofas',
    price: 46900,
    discountPercent: 15,
    description: 'Plush 6-seater L-shape sectional sofa with high-density 40-D foam cushions and solid wood frame.',
    material: 'Sal Wood Frame & Stain-Resistant Suede',
    sizes: ['6 Seater L-Shape', '7 Seater U-Shape'],
    colors: ['Warm Terracotta', 'Teal Emerald', 'Cream Beige'],
    images: [
      'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?auto=format&fit=crop&w=900&q=80'
    ],
    inStock: true,
    featured: true,
    bestSeller: true,
    isSample: true
  },
  {
    name: '3-Door Mirror Sliding Almari Wardrobe',
    category: 'Almari / Wardrobes',
    price: 29500,
    discountPercent: 10,
    description: 'Spacious 3-door sliding wardrobe with full-length dressing mirror, locker drawer, and adjustable shelving.',
    material: 'Marine Grade Plywood & High-Gloss Laminate',
    sizes: ['6x6.5 ft', '7x7 ft'],
    colors: ['Warm Oak & Cream', 'Dark Walnut'],
    images: [
      'https://images.unsplash.com/photo-1595428774223-ef52624120d2?auto=format&fit=crop&w=900&q=80'
    ],
    inStock: true,
    featured: true,
    bestSeller: false,
    isSample: true
  },
  {
    name: '6-Seater Marble Top Dining Table Set',
    category: 'Dining Tables',
    price: 42000,
    discountPercent: 8,
    description: 'Elegant Italian-finish artificial marble dining table paired with 6 ergonomic cushioned teak chairs.',
    material: 'Composite Marble Top & Solid Wood Base',
    sizes: ['6 Seater (6x3 ft)', '4 Seater (4x3 ft)'],
    colors: ['Ivory Gold & Brown', 'Onyx White'],
    images: [
      'https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=900&q=80'
    ],
    inStock: true,
    featured: true,
    bestSeller: true,
    isSample: true
  },
  {
    name: 'Artisan Wingback Lounge Accent Chair',
    category: 'Chairs',
    price: 11800,
    discountPercent: 5,
    description: 'Statement living room wingback armchair with contoured lumbar support and tapered wooden legs.',
    material: 'Teak Legs & Woven Linen Upholstery',
    sizes: ['Standard Single'],
    colors: ['Mustard Yellow', 'Coral Sunset', 'Deep Teal'],
    images: [
      'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?auto=format&fit=crop&w=900&q=80'
    ],
    inStock: true,
    featured: false,
    bestSeller: true,
    isSample: true
  },
  {
    name: 'LED Vanity Dressing Table with Stool',
    category: 'Dressing Tables',
    price: 14500,
    discountPercent: 10,
    description: 'Modern dressing unit with warm LED mirror lighting, hidden cosmetic organizer shelves, and cushioned stool.',
    material: 'Engineered Wood & HD Tempered Mirror',
    sizes: ['Width 32 in x Height 72 in'],
    colors: ['Pearl White & Teak', 'Walnut Finish'],
    images: [
      'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=900&q=80'
    ],
    inStock: true,
    featured: false,
    bestSeller: false,
    isSample: true
  },
  {
    name: 'Floating Wall Entertainment TV Unit',
    category: 'TV Units',
    price: 16200,
    discountPercent: 14,
    description: 'Contemporary wall-mounted TV console supporting up to 65-inch TVs with concealed wire management.',
    material: 'HDHMR Board & Matte Scratch-Proof Finish',
    sizes: ['6 ft Wide', '5 ft Wide'],
    colors: ['Teak & White', 'Charcoal & Oak'],
    images: [
      'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=900&q=80'
    ],
    inStock: true,
    featured: true,
    bestSeller: false,
    isSample: true
  },
  {
    name: 'Multipurpose Crockery & Storage Cabinet',
    category: 'Cabinets',
    price: 18900,
    discountPercent: 7,
    description: 'Glass-front display hutch and lower buffet cabinet ideal for dining rooms and living spaces.',
    material: 'Solid Mango Wood & Toughened Glass',
    sizes: ['4x6 ft'],
    colors: ['Honey Brown', 'Antique Teak'],
    images: [
      'https://images.unsplash.com/photo-1532372320572-cda25653a26d?auto=format&fit=crop&w=900&q=80'
    ],
    inStock: true,
    featured: false,
    bestSeller: false,
    isSample: true
  },
  {
    name: 'Executive Director Office Desk & Chair',
    category: 'Office Furniture',
    price: 24500,
    discountPercent: 10,
    description: 'Spacious 5-foot executive office workstation with side return cabinet and lockable pedestal drawers.',
    material: 'Pre-Laminated Particle Board & Steel Frame',
    sizes: ['5x2.5 ft', '6x3 ft'],
    colors: ['Dark Walnut', 'Natural Oak'],
    images: [
      'https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?auto=format&fit=crop&w=900&q=80'
    ],
    inStock: true,
    featured: false,
    bestSeller: false,
    isSample: true
  },
  {
    name: 'Handcrafted Teak Wooden Jhula Swing',
    category: 'Other Furniture',
    price: 27800,
    discountPercent: 9,
    description: 'Traditional indoor veranda wooden swing with heavy-duty brass chains and carved backrest.',
    material: 'Seasoned Sagwan Teak & Pure Brass Chains',
    sizes: ['2 Seater (4.5 ft)', '3 Seater (5.5 ft)'],
    colors: ['Natural Gloss Teak', 'Heritage Brown'],
    images: [
      'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=900&q=80'
    ],
    inStock: true,
    featured: true,
    bestSeller: true,
    isSample: true
  }
];

let seededThisInstance = false;
async function ensureInitialCatalog() {
  if (seededThisInstance) return;
  const count = await Product.estimatedDocumentCount();
  if (count === 0) {
    await Product.insertMany(SAMPLE_PRODUCTS);
  }
  seededThisInstance = true;
}

// ============================================================================
// ADMIN AUTHENTICATION HELPERS (SIGNED HTTP-ONLY COOKIE)
// ============================================================================
const COOKIE_NAME = 'tgcf_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function timingSafeCompare(a, b) {
  const strA = String(a || '');
  const strB = String(b || '');
  const bufA = Buffer.from(strA);
  const bufB = Buffer.from(strB);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function createSessionToken(username) {
  const payload = JSON.stringify({
    u: username,
    exp: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomBytes(12).toString('hex')
  });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', CONFIG.SESSION_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', CONFIG.SESSION_SECRET).update(b64).digest('base64url');
  if (!timingSafeCompare(sig, expectedSig)) return null;
  try {
    const data = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    if (!CONFIG.ADMIN_USERNAME || !timingSafeCompare(data.u, CONFIG.ADMIN_USERNAME)) return null;
    return data;
  } catch {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const token = req.signedCookies?.[COOKIE_NAME];
  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
  }
  req.adminUser = session.u;
  next();
}

// ============================================================================
// UTILITY HELPERS
// ============================================================================
function generateBookingId() {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TGC-${y}${m}${d}-${rand}`;
}

function isValidPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// STATIC ASSET ROUTE FOR /admin.js
// ============================================================================
app.get('/admin.js', (_req, res) => {
  try {
    const adminJsPath = path.join(__dirname, 'admin.js');
    const content = fs.readFileSync(adminJsPath, 'utf8');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(content);
  } catch (err) {
    res.status(500).type('application/javascript').send('console.error("Failed to load admin.js");');
  }
});

// ============================================================================
// PUBLIC API ROUTES
// ============================================================================
app.get('/api/config', (_req, res) => {
  res.json({
    success: true,
    config: {
      businessName: CONFIG.BUSINESS_NAME,
      businessPhone: CONFIG.BUSINESS_PHONE,
      businessAddress: CONFIG.BUSINESS_ADDRESS,
      businessWhatsapp: CONFIG.BUSINESS_WHATSAPP,
      categories: CATEGORIES,
      bookingStatuses: BOOKING_STATUSES
    }
  });
});

app.get('/api/health', async (_req, res) => {
  try {
    await connectDB();
    res.json({ success: true, status: 'healthy', database: 'connected' });
  } catch (err) {
    res.status(503).json({ success: false, status: 'degraded', message: 'Database connection unavailable' });
  }
});

// List Products with search, category, availability, and sorting
app.get('/api/products', async (req, res) => {
  try {
    await connectDB();
    await ensureInitialCatalog();

    const { search, category, sort, availability, featured } = req.query;
    const filter = {};

    if (category && category !== 'All' && CATEGORIES.includes(category)) {
      filter.category = category;
    }

    if (availability === 'inStock') {
      filter.inStock = true;
    } else if (availability === 'outOfStock') {
      filter.inStock = false;
    }

    if (featured === 'true') {
      filter.featured = true;
    }

    if (search && typeof search === 'string' && search.trim().length > 0) {
      const safeRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: safeRegex }, { description: safeRegex }, { category: safeRegex }, { material: safeRegex }];
    }

    let sortObj = { createdAt: -1 };
    if (sort === 'price_asc') sortObj = { price: 1 };
    else if (sort === 'price_desc') sortObj = { price: -1 };
    else if (sort === 'newest') sortObj = { createdAt: -1 };

    const products = await Product.find(filter).sort(sortObj).lean();
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Unable to load furniture catalog.' });
  }
});

// Single Product Details
app.get('/api/products/:id', async (req, res) => {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }
    const product = await Product.findById(req.params.id).lean();
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching product details.' });
  }
});

// Create Furniture Booking
app.post('/api/bookings', async (req, res) => {
  try {
    await connectDB();
    const {
      customerName,
      mobileNumber,
      whatsappNumber,
      productId,
      furnitureName,
      quantity,
      preferredColor,
      preferredSize,
      deliveryAddress,
      city,
      pinCode,
      message
    } = req.body;

    if (!customerName || customerName.length < 2) {
      return res.status(400).json({ success: false, message: 'Please enter your full name.' });
    }
    if (!isValidPhone(mobileNumber)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number.' });
    }
    if (!isValidPhone(whatsappNumber)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid WhatsApp number.' });
    }
    if (!furnitureName) {
      return res.status(400).json({ success: false, message: 'Please select a furniture item.' });
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
      return res.status(400).json({ success: false, message: 'Quantity must be between 1 and 100.' });
    }
    if (!deliveryAddress || deliveryAddress.length < 5) {
      return res.status(400).json({ success: false, message: 'Please provide a complete delivery address.' });
    }
    if (!city || city.length < 2) {
      return res.status(400).json({ success: false, message: 'Please enter your city.' });
    }
    if (!/^\d{6}$/.test(String(pinCode || '').trim())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 6-digit PIN code.' });
    }

    let validProductId = null;
    let unitPrice = 0;
    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      const prod = await Product.findById(productId).lean();
      if (prod) {
        validProductId = prod._id;
        const discount = prod.discountPercent || 0;
        unitPrice = Math.round(prod.price * (1 - discount / 100));
      }
    }

    const bookingId = generateBookingId();
    const booking = await Booking.create({
      bookingId,
      customerName,
      mobileNumber: String(mobileNumber).replace(/\s+/g, ''),
      whatsappNumber: String(whatsappNumber).replace(/\s+/g, ''),
      productId: validProductId,
      furnitureName,
      unitPrice,
      quantity: qty,
      preferredColor: preferredColor || 'Standard',
      preferredSize: preferredSize || 'Standard',
      deliveryAddress,
      city,
      pinCode: String(pinCode).trim(),
      message: message || '',
      status: 'Pending'
    });

    res.status(201).json({
      success: true,
      message: 'Booking request submitted! Our team will review and confirm your booking shortly.',
      booking: {
        bookingId: booking.bookingId,
        customerName: booking.customerName,
        furnitureName: booking.furnitureName,
        unitPrice: booking.unitPrice,
        quantity: booking.quantity,
        status: booking.status,
        createdAt: booking.createdAt
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to submit booking. Please try again.' });
  }
});

// Track Booking Status (Requires both Booking ID & Registered Mobile Number)
app.post('/api/bookings/track', async (req, res) => {
  try {
    await connectDB();
    const bookingId = String(req.body.bookingId || '').trim().toUpperCase();
    const mobileNumber = String(req.body.mobileNumber || '').replace(/\D/g, '');

    if (!bookingId || mobileNumber.length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Enter both your Booking ID and registered 10-digit mobile number.'
      });
    }

    const last10 = mobileNumber.slice(-10);
    const booking = await Booking.findOne({
      bookingId,
      mobileNumber: { $regex: `${last10}$` }
    }).lean();

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'No booking found matching that Booking ID and mobile number.'
      });
    }

    res.json({
      success: true,
      booking: {
        bookingId: booking.bookingId,
        customerName: booking.customerName,
        furnitureName: booking.furnitureName,
        quantity: booking.quantity,
        preferredColor: booking.preferredColor,
        preferredSize: booking.preferredSize,
        city: booking.city,
        status: booking.status,
        unitPrice: booking.unitPrice,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Unable to track booking status right now.' });
  }
});

// Submit Customer Enquiry
app.post('/api/enquiries', async (req, res) => {
  try {
    await connectDB();
    const { customerName, phoneNumber, productName, message } = req.body;

    if (!customerName || customerName.length < 2) {
      return res.status(400).json({ success: false, message: 'Please enter your name.' });
    }
    if (!isValidPhone(phoneNumber)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid phone number.' });
    }
    if (!message || message.length < 4) {
      return res.status(400).json({ success: false, message: 'Please enter your enquiry message.' });
    }

    await Enquiry.create({
      customerName,
      phoneNumber: String(phoneNumber).trim(),
      productName: productName || 'General Furniture Enquiry',
      message
    });

    res.status(201).json({
      success: true,
      message: 'Enquiry sent! We will contact you shortly.'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Unable to send enquiry right now.' });
  }
});

// ============================================================================
// ADMIN AUTHENTICATION API ROUTES
// ============================================================================
app.post('/api/admin/login', authLimiter, (req, res) => {
  const { username, password } = req.body;

  if (!CONFIG.ADMIN_USERNAME || !CONFIG.ADMIN_PASSWORD) {
    return res.status(500).json({
      success: false,
      message: 'Admin credentials are not configured in server environment variables.'
    });
  }

  const validUser = timingSafeCompare(username, CONFIG.ADMIN_USERNAME);
  const validPass = timingSafeCompare(password, CONFIG.ADMIN_PASSWORD);

  if (!validUser || !validPass) {
    return res.status(401).json({ success: false, message: 'Invalid administrator credentials.' });
  }

  const token = createSessionToken(CONFIG.ADMIN_USERNAME);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    signed: true,
    sameSite: 'strict',
    secure: CONFIG.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/'
  });

  res.json({ success: true, username: CONFIG.ADMIN_USERNAME });
});

app.post('/api/admin/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ success: true, message: 'Logged out successfully.' });
});

app.get('/api/admin/session', (req, res) => {
  const token = req.signedCookies?.[COOKIE_NAME];
  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({ success: false, authenticated: false });
  }
  res.json({ success: true, authenticated: true, username: session.u });
});

// ============================================================================
// PROTECTED ADMIN API ROUTES
// ============================================================================
app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
  try {
    await connectDB();
    await ensureInitialCatalog();

    const [
      totalProducts,
      totalBookings,
      pendingBookings,
      confirmedBookings,
      completedBookings,
      totalEnquiries,
      categoryBreakdown
    ] = await Promise.all([
      Product.countDocuments(),
      Booking.countDocuments(),
      Booking.countDocuments({ status: 'Pending' }),
      Booking.countDocuments({ status: 'Confirmed' }),
      Booking.countDocuments({ status: 'Completed' }),
      Enquiry.countDocuments(),
      Product.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }])
    ]);

    res.json({
      success: true,
      stats: {
        totalProducts,
        totalBookings,
        pendingBookings,
        confirmedBookings,
        completedBookings,
        totalEnquiries,
        categoryBreakdown
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load dashboard overview.' });
  }
});

// Admin Product CRUD
app.get('/api/admin/products', requireAdmin, async (_req, res) => {
  try {
    await connectDB();
    await ensureInitialCatalog();
    const products = await Product.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load products.' });
  }
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const {
      name,
      category,
      price,
      discountPercent,
      description,
      material,
      sizes,
      colors,
      images,
      inStock,
      featured,
      bestSeller
    } = req.body;

    if (!name || !CATEGORIES.includes(category) || Number(price) < 0 || !description) {
      return res.status(400).json({ success: false, message: 'Please provide valid product details.' });
    }

    const imageList = Array.isArray(images)
      ? images.map((u) => String(u).trim()).filter(Boolean)
      : String(images || '')
          .split(/[\n,]/)
          .map((u) => u.trim())
          .filter(Boolean);

    if (imageList.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one product image URL is required.' });
    }

    const sizeList = Array.isArray(sizes)
      ? sizes.filter(Boolean)
      : String(sizes || 'Standard')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

    const colorList = Array.isArray(colors)
      ? colors.filter(Boolean)
      : String(colors || 'Natural Teak')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);

    const product = await Product.create({
      name,
      category,
      price: Number(price),
      discountPercent: Math.min(90, Math.max(0, Number(discountPercent) || 0)),
      description,
      material: material || 'Solid Wood & Premium Finish',
      sizes: sizeList.length ? sizeList : ['Standard'],
      colors: colorList.length ? colorList : ['Standard'],
      images: imageList,
      inStock: Boolean(inStock),
      featured: Boolean(featured),
      bestSeller: Boolean(bestSeller),
      isSample: false
    });

    res.status(201).json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create product.' });
  }
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }

    const {
      name,
      category,
      price,
      discountPercent,
      description,
      material,
      sizes,
      colors,
      images,
      inStock,
      featured,
      bestSeller
    } = req.body;

    if (!name || !CATEGORIES.includes(category) || Number(price) < 0 || !description) {
      return res.status(400).json({ success: false, message: 'Invalid product fields.' });
    }

    const imageList = Array.isArray(images)
      ? images.map((u) => String(u).trim()).filter(Boolean)
      : String(images || '')
          .split(/[\n,]/)
          .map((u) => u.trim())
          .filter(Boolean);

    if (imageList.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one image URL is required.' });
    }

    const sizeList = Array.isArray(sizes)
      ? sizes.filter(Boolean)
      : String(sizes || 'Standard')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

    const colorList = Array.isArray(colors)
      ? colors.filter(Boolean)
      : String(colors || 'Natural Teak')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);

    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      {
        name,
        category,
        price: Number(price),
        discountPercent: Math.min(90, Math.max(0, Number(discountPercent) || 0)),
        description,
        material: material || 'Solid Wood & Premium Finish',
        sizes: sizeList.length ? sizeList : ['Standard'],
        colors: colorList.length ? colorList : ['Standard'],
        images: imageList,
        inStock: Boolean(inStock),
        featured: Boolean(featured),
        bestSeller: Boolean(bestSeller),
        isSample: false
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update product.' });
  }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    res.json({ success: true, message: 'Product deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete product.' });
  }
});

// Admin Booking Management
app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const { search, status } = req.query;
    const filter = {};
    if (status && status !== 'All' && BOOKING_STATUSES.includes(status)) {
      filter.status = status;
    }
    if (search && String(search).trim()) {
      const safeRegex = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ bookingId: safeRegex }, { customerName: safeRegex }, { mobileNumber: safeRegex }];
    }
    const bookings = await Booking.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, bookings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load bookings.' });
  }
});

app.patch('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID.' });
    }
    const { status } = req.body;
    if (!BOOKING_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid booking status.' });
    }
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    ).lean();

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }
    res.json({ success: true, booking });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update booking status.' });
  }
});

app.delete('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID.' });
    }
    const deleted = await Booking.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }
    res.json({ success: true, message: 'Booking deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete booking.' });
  }
});

// Admin Customer Enquiries Management
app.get('/api/admin/enquiries', requireAdmin, async (_req, res) => {
  try {
    await connectDB();
    const enquiries = await Enquiry.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, enquiries });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load enquiries.' });
  }
});

app.patch('/api/admin/enquiries/:id', requireAdmin, async (req, res) => {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid enquiry ID.' });
    }
    const { status } = req.body;
    if (!['New', 'Contacted', 'Resolved'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid enquiry status.' });
    }
    const enquiry = await Enquiry.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    ).lean();

    if (!enquiry) {
      return res.status(404).json({ success: false, message: 'Enquiry not found.' });
    }
    res.json({ success: true, enquiry });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update enquiry.' });
  }
});

app.delete('/api/admin/enquiries/:id', requireAdmin, async (req, res) => {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid enquiry ID.' });
    }
    const deleted = await Enquiry.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Enquiry not found.' });
    }
    res.json({ success: true, message: 'Enquiry deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete enquiry.' });
  }
});

// ============================================================================
// ADMIN HTML SHELL (/admin)
// ============================================================================
app.get('/admin', (_req, res) => {
  const bName = escapeHtml(CONFIG.BUSINESS_NAME);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin Portal | ${bName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --cream: #FFF8F0;
      --cream-deep: #F6E9D8;
      --orange: #F97316;
      --orange-dark: #EA580C;
      --brown: #3E2723;
      --brown-soft: #6D4C41;
      --yellow: #FBBF24;
      --teal: #0D9488;
      --coral: #FB7185;
      --white: #FFFFFF;
      --clay-shadow: 12px 12px 26px rgba(62, 39, 35, 0.12), -8px -8px 20px rgba(255, 255, 255, 0.9), inset 3px 3px 8px rgba(255, 255, 255, 0.85), inset -3px -3px 8px rgba(62, 39, 35, 0.06);
      --clay-btn: 0 10px 20px rgba(249, 115, 22, 0.28), inset 0 2px 4px rgba(255, 255, 255, 0.55), inset 0 -3px 6px rgba(0, 0, 0, 0.16);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: radial-gradient(circle at top left, #FFFDF9, var(--cream) 55%, var(--cream-deep));
      color: var(--brown);
      min-height: 100vh;
      line-height: 1.5;
    }
    h1, h2, h3, h4 { font-family: 'Outfit', sans-serif; }
    .clay-card {
      background: linear-gradient(145deg, #FFFFFF, #FFF7ED);
      border-radius: 26px;
      box-shadow: var(--clay-shadow);
      border: 1px solid rgba(255, 255, 255, 0.8);
      padding: 24px;
    }
    .btn-clay {
      border: none;
      border-radius: 16px;
      padding: 12px 22px;
      font-weight: 700;
      font-family: 'Outfit', sans-serif;
      cursor: pointer;
      transition: transform 0.18s ease, box-shadow 0.18s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 0.95rem;
    }
    .btn-clay:active { transform: translateY(2px) scale(0.98); }
    .btn-primary { background: linear-gradient(135deg, var(--orange), var(--coral)); color: #fff; box-shadow: var(--clay-btn); }
    .btn-teal { background: linear-gradient(135deg, var(--teal), #14B8A6); color: #fff; box-shadow: 0 10px 20px rgba(13,148,136,0.25), inset 0 2px 4px rgba(255,255,255,0.5); }
    .btn-brown { background: linear-gradient(135deg, var(--brown), #5D4037); color: #fff; }
    .btn-danger { background: linear-gradient(135deg, #EF4444, #DC2626); color: #fff; }
    .btn-ghost { background: #FFF8F0; color: var(--brown); border: 1px solid rgba(62,39,35,0.12); }
    input, select, textarea {
      width: 100%;
      padding: 12px 15px;
      border-radius: 14px;
      border: 2px solid rgba(62, 39, 35, 0.1);
      background: #FFFFFF;
      font-family: inherit;
      font-size: 0.95rem;
      color: var(--brown);
      box-shadow: inset 2px 2px 6px rgba(62, 39, 35, 0.05);
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus, select:focus, textarea:focus { border-color: var(--orange); }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 700;
    }
    .badge-Pending { background: #FEF3C7; color: #92400E; }
    .badge-Confirmed { background: #CCFBF1; color: #115E59; }
    .badge-Processing { background: #E0E7FF; color: #3730A3; }
    .badge-Ready { background: #FFEDD5; color: #9A3412; }
    .badge-Completed { background: #DCFCE7; color: #166534; }
    .badge-Cancelled { background: #FEE2E2; color: #991B1B; }
    .admin-topbar {
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(12px);
      padding: 16px 28px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      position: sticky;
      top: 0;
      z-index: 50;
      border-bottom: 1px solid rgba(62,39,35,0.08);
    }
    .admin-container { max-width: 1320px; margin: 0 auto; padding: 28px 20px 60px; }
    .tabs { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 24px; }
    .tab-btn { padding: 11px 20px; border-radius: 16px; border: none; font-weight: 700; cursor: pointer; background: #fff; color: var(--brown-soft); box-shadow: 4px 4px 12px rgba(62,39,35,0.08); }
    .tab-btn.active { background: linear-gradient(135deg, var(--orange), var(--coral)); color: #fff; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 18px; margin-bottom: 28px; }
    .stat-card { border-radius: 24px; padding: 20px; color: #fff; box-shadow: 0 12px 24px rgba(62,39,35,0.14), inset 0 2px 6px rgba(255,255,255,0.45); }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 780px; }
    th, td { text-align: left; padding: 13px 14px; border-bottom: 1px solid rgba(62,39,35,0.08); vertical-align: middle; }
    th { font-family: 'Outfit', sans-serif; color: var(--brown-soft); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(62, 39, 35, 0.52); backdrop-filter: blur(6px);
      display: none; align-items: center; justify-content: center; padding: 18px; z-index: 100;
    }
    .modal-backdrop.open { display: flex; }
    .modal-box { max-width: 680px; width: 100%; max-height: 90vh; overflow-y: auto; }
    .toast {
      position: fixed; bottom: 24px; right: 24px; z-index: 200;
      background: var(--brown); color: #fff; padding: 14px 22px; border-radius: 16px;
      box-shadow: 0 12px 28px rgba(0,0,0,0.22); font-weight: 600; transform: translateY(120px); opacity: 0; transition: all 0.25s ease;
    }
    .toast.show { transform: translateY(0); opacity: 1; }
  </style>
</head>
<body>
  <div id="adminRoot"></div>
  <div id="adminToast" class="toast"></div>
  <script src="/admin.js"></script>
</body>
</html>`);
});

// ============================================================================
// CUSTOMER-FACING FRONTEND HTML (/)
// ============================================================================
app.get('/', (_req, res) => {
  const bName = escapeHtml(CONFIG.BUSINESS_NAME);
  const bPhone = escapeHtml(CONFIG.BUSINESS_PHONE);
  const bAddress = escapeHtml(CONFIG.BUSINESS_ADDRESS);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${bName} | Premium Furniture Showroom & Online Booking</title>
  <meta name="description" content="Explore handcrafted beds, luxury sofas, wardrobes, dining tables, and custom home furniture at ${bName}. Book online or enquire on WhatsApp." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --cream: #FFF8F0;
      --cream-2: #FDEEDC;
      --orange: #F97316;
      --orange-deep: #EA580C;
      --brown: #3E2723;
      --brown-mid: #5D4037;
      --brown-soft: #795548;
      --yellow: #FACC15;
      --teal: #0D9488;
      --teal-light: #CCFBF1;
      --coral: #FB7185;
      --white: #FFFFFF;
      --clay-card: 14px 14px 30px rgba(62, 39, 35, 0.11), -10px -10px 24px rgba(255, 255, 255, 0.92), inset 4px 4px 10px rgba(255, 255, 255, 0.85), inset -4px -4px 10px rgba(62, 39, 35, 0.05);
      --clay-pill: 6px 6px 14px rgba(62, 39, 35, 0.09), -4px -4px 12px rgba(255, 255, 255, 0.9), inset 2px 2px 5px rgba(255, 255, 255, 0.8);
      --clay-btn-orange: 0 12px 24px rgba(249, 115, 22, 0.34), inset 0 3px 6px rgba(255, 255, 255, 0.55), inset 0 -4px 8px rgba(154, 52, 18, 0.25);
      --clay-btn-teal: 0 12px 24px rgba(13, 148, 136, 0.3), inset 0 3px 6px rgba(255, 255, 255, 0.5), inset 0 -4px 8px rgba(17, 94, 89, 0.25);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: radial-gradient(circle at 10% 10%, #FFFDF9, var(--cream) 45%, var(--cream-2) 100%);
      color: var(--brown);
      overflow-x: hidden;
      line-height: 1.6;
    }

    h1, h2, h3, h4, .brand-font { font-family: 'Outfit', sans-serif; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
    }

    /* Floating Clay Orbs */
    .orb {
      position: fixed;
      border-radius: 50%;
      pointer-events: none;
      z-index: 0;
      filter: blur(2px);
      opacity: 0.55;
      animation: floatOrb 9s ease-in-out infinite alternate;
    }
    .orb-1 { width: 240px; height: 240px; top: 8%; left: -60px; background: radial-gradient(circle at 30% 30%, #FDE047, #F97316); }
    .orb-2 { width: 200px; height: 200px; top: 48%; right: -50px; background: radial-gradient(circle at 30% 30%, #5EEAD4, #0D9488); animation-delay: 2s; }
    .orb-3 { width: 170px; height: 170px; bottom: 8%; left: 6%; background: radial-gradient(circle at 30% 30%, #FDA4AF, #FB7185); animation-delay: 4s; }

    @keyframes floatOrb {
      0% { transform: translateY(0px) scale(1); }
      100% { transform: translateY(-22px) scale(1.05); }
    }

    .container { max-width: 1280px; margin: 0 auto; padding: 0 20px; position: relative; z-index: 2; }

    /* Navbar */
    header {
      position: sticky;
      top: 12px;
      z-index: 90;
      padding: 0 16px;
    }
    .nav-shell {
      max-width: 1280px;
      margin: 0 auto;
      background: rgba(255, 255, 255, 0.82);
      backdrop-filter: blur(16px);
      border-radius: 28px;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 12px 32px rgba(62, 39, 35, 0.1), inset 0 2px 4px rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.85);
    }
    .logo-wrap { display: flex; align-items: center; gap: 12px; text-decoration: none; color: var(--brown); }
    .logo-badge {
      width: 46px; height: 46px; border-radius: 16px;
      background: linear-gradient(135deg, var(--orange), var(--coral));
      color: #fff; font-weight: 800; font-family: 'Outfit', sans-serif; font-size: 1.25rem;
      display: grid; place-items: center;
      box-shadow: var(--clay-btn-orange);
    }
    .logo-text strong { display: block; font-size: 1.08rem; line-height: 1.15; }
    .logo-text span { font-size: 0.76rem; color: var(--brown-soft); font-weight: 600; }

    .nav-links { display: flex; align-items: center; gap: 22px; }
    .nav-links a {
      text-decoration: none; color: var(--brown); font-weight: 600; font-size: 0.94rem;
      transition: color 0.2s;
    }
    .nav-links a:hover { color: var(--orange); }

    .nav-actions { display: flex; align-items: center; gap: 10px; }
    .mobile-toggle { display: none; background: var(--cream); border: none; width: 42px; height: 42px; border-radius: 14px; font-size: 1.3rem; cursor: pointer; color: var(--brown); }

    /* Clay Buttons */
    .btn {
      border: none;
      border-radius: 18px;
      padding: 12px 22px;
      font-family: 'Outfit', sans-serif;
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      text-decoration: none;
      transition: transform 0.2s cubic-bezier(.22,1,.36,1), box-shadow 0.2s ease;
    }
    .btn:hover { transform: translateY(-2px); }
    .btn:active { transform: translateY(2px) scale(0.98); }
    .btn-orange { background: linear-gradient(135deg, var(--orange), var(--coral)); color: #fff; box-shadow: var(--clay-btn-orange); }
    .btn-teal { background: linear-gradient(135deg, var(--teal), #14B8A6); color: #fff; box-shadow: var(--clay-btn-teal); }
    .btn-cream { background: linear-gradient(145deg, #FFFFFF, #FFF3E0); color: var(--brown); box-shadow: var(--clay-pill); }
    .btn-whatsapp { background: linear-gradient(135deg, #22C55E, #16A34A); color: #fff; box-shadow: 0 10px 20px rgba(22, 163, 74, 0.28), inset 0 2px 5px rgba(255,255,255,0.5); }
    .btn-sm { padding: 9px 14px; font-size: 0.85rem; border-radius: 14px; }

    /* Hero Section */
    .hero { padding: 48px 0 36px; }
    .hero-grid {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 36px;
      align-items: center;
    }
    .hero-pill {
      display: inline-flex; align-items: center; gap: 8px;
      background: linear-gradient(135deg, #FEF3C7, #FFEDD5);
      padding: 8px 16px; border-radius: 999px; font-weight: 700; font-size: 0.84rem;
      color: var(--orange-deep); box-shadow: var(--clay-pill); margin-bottom: 18px;
    }
    .hero h1 {
      font-size: clamp(2.35rem, 4.6vw, 3.85rem);
      line-height: 1.08;
      font-weight: 800;
      margin-bottom: 18px;
      background: linear-gradient(135deg, var(--brown) 25%, var(--orange-deep) 75%, var(--coral));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .hero p { font-size: 1.08rem; color: var(--brown-mid); margin-bottom: 28px; max-width: 560px; }
    .hero-cta { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 30px; }
    .hero-trust { display: flex; flex-wrap: wrap; gap: 18px; }
    .trust-chip {
      background: rgba(255,255,255,0.85);
      padding: 10px 16px; border-radius: 18px;
      box-shadow: var(--clay-pill); font-size: 0.86rem; font-weight: 700;
    }

    .hero-visual {
      position: relative;
      background: linear-gradient(145deg, #FFE4C4, #FFD6BA);
      border-radius: 36px;
      padding: 18px;
      box-shadow: var(--clay-card);
      animation: heroFloat 6s ease-in-out infinite alternate;
    }
    @keyframes heroFloat {
      0% { transform: translateY(0); }
      100% { transform: translateY(-10px); }
    }
    .hero-visual img {
      width: 100%; height: 420px; object-fit: cover; border-radius: 26px; display: block;
    }
    .hero-floating-tag {
      position: absolute; bottom: -16px; left: 24px; right: 24px;
      background: rgba(255,255,255,0.92); backdrop-filter: blur(10px);
      border-radius: 22px; padding: 14px 20px;
      display: flex; align-items: center; justify-content: space-between;
      box-shadow: var(--clay-card);
    }

    /* Sections */
    section { padding: 48px 0; }
    .section-head { text-align: center; max-width: 680px; margin: 0 auto 34px; }
    .section-head .eyebrow {
      display: inline-block; padding: 6px 14px; border-radius: 999px;
      background: var(--teal-light); color: var(--teal); font-weight: 700; font-size: 0.8rem; margin-bottom: 10px;
    }
    .section-head h2 { font-size: clamp(1.75rem, 3.2vw, 2.5rem); font-weight: 800; margin-bottom: 10px; }
    .section-head p { color: var(--brown-soft); }

    /* Categories Grid */
    .cat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 18px;
    }
    .cat-card {
      background: linear-gradient(145deg, #FFFFFF, #FFF5EB);
      border-radius: 26px;
      padding: 20px 16px;
      text-align: center;
      cursor: pointer;
      box-shadow: var(--clay-card);
      border: 2px solid transparent;
      transition: transform 0.22s ease, border-color 0.22s ease;
    }
    .cat-card:hover, .cat-card.active {
      transform: translateY(-6px);
      border-color: var(--orange);
      background: linear-gradient(145deg, #FFF7ED, #FFEDD5);
    }
    .cat-icon {
      width: 56px; height: 56px; margin: 0 auto 12px; border-radius: 18px;
      display: grid; place-items: center; font-size: 1.65rem;
      box-shadow: inset 2px 2px 5px rgba(255,255,255,0.8), 0 8px 16px rgba(62,39,35,0.1);
    }
    .cat-card h3 { font-size: 1rem; font-weight: 700; }

    /* Filter & Search Bar */
    .filter-bar {
      background: linear-gradient(145deg, #FFFFFF, #FFF7ED);
      border-radius: 28px;
      padding: 20px;
      box-shadow: var(--clay-card);
      display: grid;
      grid-template-columns: 1.5fr 1fr 1fr 1fr;
      gap: 14px;
      margin-bottom: 30px;
    }
    .input-clay {
      width: 100%;
      padding: 12px 16px;
      border-radius: 16px;
      border: 2px solid rgba(62, 39, 35, 0.09);
      background: #FFFDFB;
      font-family: inherit;
      font-size: 0.95rem;
      color: var(--brown);
      box-shadow: inset 2px 2px 6px rgba(62, 39, 35, 0.05);
      outline: none;
    }
    .input-clay:focus { border-color: var(--orange); }

    /* Product Cards */
    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      gap: 24px;
    }
    .product-card {
      background: linear-gradient(145deg, #FFFFFF, #FFF6EC);
      border-radius: 30px;
      padding: 16px;
      box-shadow: var(--clay-card);
      display: flex;
      flex-direction: column;
      transition: transform 0.25s cubic-bezier(.22,1,.36,1);
      position: relative;
    }
    .product-card:hover { transform: translateY(-7px); }
    .product-img-wrap {
      position: relative;
      border-radius: 22px;
      overflow: hidden;
      height: 220px;
      margin-bottom: 14px;
      background: #F5E6D3;
    }
    .product-img-wrap img {
      width: 100%; height: 100%; object-fit: cover;
      transition: transform 0.45s ease;
    }
    .product-card:hover .product-img-wrap img { transform: scale(1.06); }
    .pill-badge {
      position: absolute; top: 12px; left: 12px;
      padding: 5px 12px; border-radius: 999px; font-size: 0.75rem; font-weight: 800;
      box-shadow: 0 4px 10px rgba(0,0,0,0.12);
    }
    .pill-stock { background: #DCFCE7; color: #166534; }
    .pill-out { background: #FEE2E2; color: #991B1B; }
    .pill-discount {
      position: absolute; top: 12px; right: 12px;
      background: linear-gradient(135deg, var(--coral), var(--orange));
      color: #fff; padding: 5px 11px; border-radius: 999px; font-size: 0.75rem; font-weight: 800;
    }
    .product-cat { font-size: 0.78rem; font-weight: 700; color: var(--teal); text-transform: uppercase; letter-spacing: 0.04em; }
    .product-title { font-size: 1.15rem; font-weight: 700; margin: 4px 0 6px; }
    .product-desc { font-size: 0.88rem; color: var(--brown-soft); margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .price-row { display: flex; align-items: baseline; gap: 10px; margin-top: auto; margin-bottom: 14px; }
    .price-final { font-family: 'Outfit', sans-serif; font-size: 1.35rem; font-weight: 800; color: var(--orange-deep); }
    .price-old { font-size: 0.9rem; text-decoration: line-through; color: var(--brown-soft); }
    .card-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .card-actions .btn-wa-full { grid-column: span 2; }

    /* Skeleton Loader */
    .skeleton {
      height: 360px; border-radius: 30px;
      background: linear-gradient(90deg, #F5E6D3 25%, #FFF8F0 50%, #F5E6D3 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    /* Dual Clay Panels (Booking & Tracker) */
    .dual-grid { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 28px; align-items: start; }
    .clay-panel {
      background: linear-gradient(145deg, #FFFFFF, #FFF7ED);
      border-radius: 32px;
      padding: 28px;
      box-shadow: var(--clay-card);
    }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .form-full { grid-column: span 2; }
    .field label { display: block; font-size: 0.84rem; font-weight: 700; margin-bottom: 5px; color: var(--brown-mid); }

    /* Why Choose Us & Testimonials */
    .features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 20px; }
    .feature-box {
      background: linear-gradient(145deg, #FFFFFF, #FFF6EC);
      border-radius: 28px; padding: 24px; box-shadow: var(--clay-card);
    }
    .feature-emoji {
      width: 52px; height: 52px; border-radius: 16px;
      background: linear-gradient(135deg, var(--yellow), var(--orange));
      display: grid; place-items: center; font-size: 1.45rem; margin-bottom: 14px;
    }

    /* Footer */
    footer {
      background: var(--brown);
      color: #FFF8F0;
      border-radius: 36px 36px 0 0;
      padding: 48px 20px 28px;
      margin-top: 48px;
      position: relative;
      z-index: 2;
    }
    .footer-grid {
      max-width: 1280px; margin: 0 auto;
      display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 28px;
      padding-bottom: 28px; border-bottom: 1px solid rgba(255,248,240,0.14);
    }
    .footer-bottom {
      max-width: 1280px; margin: 20px auto 0;
      display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px;
      font-size: 0.9rem; color: #FDE68A;
    }

    /* Modals & Toast */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(62, 39, 35, 0.56); backdrop-filter: blur(8px);
      display: none; align-items: center; justify-content: center; padding: 16px; z-index: 150;
    }
    .modal-overlay.active { display: flex; }
    .modal-card {
      background: linear-gradient(145deg, #FFFFFF, #FFF8F0);
      border-radius: 32px; max-width: 780px; width: 100%; max-height: 90vh; overflow-y: auto;
      padding: 26px; box-shadow: 0 24px 48px rgba(0,0,0,0.28); position: relative;
      animation: popIn 0.25s ease;
    }
    @keyframes popIn { from { transform: scale(0.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }

    .toast-msg {
      position: fixed; bottom: 24px; right: 24px; z-index: 200;
      background: var(--brown); color: #fff; padding: 14px 22px; border-radius: 18px;
      font-weight: 600; box-shadow: 0 14px 30px rgba(0,0,0,0.25);
      transform: translateY(120px); opacity: 0; transition: all 0.28s ease;
    }
    .toast-msg.show { transform: translateY(0); opacity: 1; }

    .reveal { opacity: 0; transform: translateY(20px); transition: opacity 0.55s ease, transform 0.55s ease; }
    .reveal.visible { opacity: 1; transform: translateY(0); }

    @media (max-width: 960px) {
      .hero-grid, .dual-grid { grid-template-columns: 1fr; }
      .filter-bar { grid-template-columns: 1fr 1fr; }
      .nav-links {
        display: none; position: absolute; top: 76px; left: 16px; right: 16px;
        background: #fff; border-radius: 24px; padding: 20px; flex-direction: column;
        box-shadow: var(--clay-card);
      }
      .nav-links.open { display: flex; }
      .mobile-toggle { display: grid; place-items: center; }
    }
    @media (max-width: 600px) {
      .filter-bar, .form-grid { grid-template-columns: 1fr; }
      .form-full { grid-column: span 1; }
      .hero-visual img { height: 290px; }
    }
  </style>
</head>
<body>
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>
  <div class="orb orb-3"></div>

  <!-- NAVIGATION -->
  <header>
    <div class="nav-shell">
      <a href="#top" class="logo-wrap">
        <div class="logo-badge">TG</div>
        <div class="logo-text">
          <strong>${bName}</strong>
          <span>Crafted Comfort &amp; Timeless Woodwork</span>
        </div>
      </a>
      <nav class="nav-links" id="navLinks">
        <a href="#categories">Categories</a>
        <a href="#catalog">Collection</a>
        <a href="#booking-section">Book Furniture</a>
        <a href="#track-section">Track Booking</a>
        <a href="#contact-section">Contact</a>
      </nav>
      <div class="nav-actions">
        <a href="#booking-section" class="btn btn-orange btn-sm">Book Now</a>
        <button class="mobile-toggle" id="mobileToggle" aria-label="Toggle Menu">&#9776;</button>
      </div>
    </div>
  </header>

  <main id="top">
    <!-- HERO BANNER -->
    <section class="hero">
      <div class="container hero-grid">
        <div>
          <div class="hero-pill">&#10024; Handcrafted Solid Wood &amp; Luxury Upholstery</div>
          <h1>Make Your Home Beautiful</h1>
          <p>
            Welcome to <strong>${bName}</strong> — your trusted destination for bespoke beds, plush sofas, spacious almaris, dining ensembles, and custom home interiors built to last generations.
          </p>
          <div class="hero-cta">
            <a href="#catalog" class="btn btn-orange">Shop Now</a>
            <a href="#categories" class="btn btn-teal">Explore Collection</a>
            <a href="#track-section" class="btn btn-cream">Track Booking</a>
          </div>
          <div class="hero-trust">
            <div class="trust-chip">&#127968; Custom Sizes &amp; Colours</div>
            <div class="trust-chip">&#128666; Safe Doorstep Delivery</div>
            <div class="trust-chip">&#128172; Direct WhatsApp Support</div>
          </div>
        </div>
        <div class="hero-visual">
          <img src="https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=1000&q=80" alt="Luxury Living Room Furniture at ${bName}" />
          <div class="hero-floating-tag">
            <div>
              <strong style="display:block;font-size:0.98rem;">Signature Showroom Collection</strong>
              <span style="font-size:0.82rem;color:var(--brown-soft);">Book online &amp; get direct confirmation</span>
            </div>
            <a href="#booking-section" class="btn btn-orange btn-sm">Reserve</a>
          </div>
        </div>
      </div>
    </section>

    <!-- POPULAR CATEGORIES -->
    <section id="categories" class="reveal">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">10 CURATED DEPARTMENTS</span>
          <h2>Explore Furniture Categories</h2>
          <p>Tap any category below to filter our showroom catalog instantly.</p>
        </div>
        <div class="cat-grid" id="categoryGrid"></div>
      </div>
    </section>

    <!-- FEATURED & FULL CATALOG -->
    <section id="catalog" class="reveal">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">SHOWROOM CATALOG</span>
          <h2>Featured &amp; Best-Selling Furniture</h2>
          <p>Filter by category, search by style or wood type, view specifications, or book online in seconds.</p>
        </div>

        <div class="filter-bar">
          <input type="search" id="searchInput" class="input-clay" placeholder="Search beds, sofas, teak, marble..." />
          <select id="categoryFilter" class="input-clay">
            <option value="All">All Categories</option>
          </select>
          <select id="availabilityFilter" class="input-clay">
            <option value="all">All Availability</option>
            <option value="inStock">In Stock Only</option>
            <option value="outOfStock">Made to Order / Out</option>
          </select>
          <select id="sortFilter" class="input-clay">
            <option value="newest">Newest Arrivals</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
          </select>
        </div>

        <div class="product-grid" id="productGrid">
          <div class="skeleton"></div>
          <div class="skeleton"></div>
          <div class="skeleton"></div>
        </div>
      </div>
    </section>

    <!-- BOOKING FORM & STATUS TRACKER -->
    <section id="booking-section" class="reveal">
      <div class="container dual-grid">
        <!-- FURNITURE BOOKING FORM -->
        <div class="clay-panel">
          <span class="eyebrow" style="background:#FFEDD5;color:var(--orange-deep);padding:6px 14px;border-radius:999px;font-weight:700;font-size:0.78rem;">ONLINE RESERVATION</span>
          <h2 style="margin:10px 0 6px;font-size:1.85rem;">Book Your Furniture</h2>
          <p style="color:var(--brown-soft);font-size:0.93rem;margin-bottom:20px;">
            Submit your booking request below. You will receive a unique Booking ID immediately. Our showroom team will verify availability and confirm your booking.
          </p>

          <form id="bookingForm" class="form-grid" novalidate>
            <div class="field">
              <label for="bCustomerName">Customer Full Name *</label>
              <input type="text" id="bCustomerName" class="input-clay" required placeholder="Enter your full name" />
            </div>
            <div class="field">
              <label for="bMobile">Mobile Number *</label>
              <input type="tel" id="bMobile" class="input-clay" required placeholder="10-digit mobile number" />
            </div>
            <div class="field">
              <label for="bWhatsapp">WhatsApp Number *</label>
              <input type="tel" id="bWhatsapp" class="input-clay" required placeholder="10-digit WhatsApp number" />
            </div>
            <div class="field">
              <label for="bFurniture">Selected Furniture *</label>
              <select id="bFurniture" class="input-clay" required></select>
            </div>
            <div class="field">
              <label for="bQuantity">Quantity *</label>
              <input type="number" id="bQuantity" class="input-clay" min="1" max="100" value="1" required />
            </div>
            <div class="field">
              <label for="bColor">Preferred Colour</label>
              <input type="text" id="bColor" class="input-clay" placeholder="e.g., Royal Walnut, Teal" />
            </div>
            <div class="field">
              <label for="bSize">Preferred Size</label>
              <input type="text" id="bSize" class="input-clay" placeholder="e.g., King Size, 6 Seater" />
            </div>
            <div class="field">
              <label for="bCity">City *</label>
              <input type="text" id="bCity" class="input-clay" required placeholder="Your city" />
            </div>
            <div class="field">
              <label for="bPin">PIN Code *</label>
              <input type="text" id="bPin" class="input-clay" maxlength="6" required placeholder="6-digit PIN code" />
            </div>
            <div class="field form-full">
              <label for="bAddress">Complete Delivery Address *</label>
              <textarea id="bAddress" class="input-clay" rows="2" required placeholder="House/Flat No., Street, Landmark"></textarea>
            </div>
            <div class="field form-full">
              <label for="bMessage">Additional Message / Customisation Notes</label>
              <textarea id="bMessage" class="input-clay" rows="2" placeholder="Any custom polish, fabric, or delivery instructions..."></textarea>
            </div>
            <div class="form-full">
              <button type="submit" id="bookingSubmitBtn" class="btn btn-orange" style="width:100%;padding:15px;font-size:1.05rem;">
                Submit Furniture Booking Request
              </button>
            </div>
          </form>

          <div id="bookingConfirmationBox" style="display:none;margin-top:20px;background:linear-gradient(135deg,#CCFBF1,#ECFDF5);border-radius:24px;padding:22px;border:2px solid #5EEAD4;">
            <h3 style="color:#115E59;margin-bottom:6px;">&#127881; Booking Request Received!</h3>
            <p style="font-size:0.92rem;color:#134E4A;margin-bottom:10px;">
              Your request is recorded with status <strong>Pending</strong>. Our administrator will review and confirm it shortly.
            </p>
            <div style="background:#fff;padding:12px 16px;border-radius:14px;font-weight:800;font-size:1.1rem;color:var(--brown);margin-bottom:12px;">
              Booking ID: <span id="confirmedBookingId" style="color:var(--orange-deep);"></span>
            </div>
            <a id="confirmWhatsappLink" href="#" target="_blank" rel="noopener" class="btn btn-whatsapp btn-sm">
              Share Booking ID on WhatsApp
            </a>
          </div>
        </div>

        <!-- TRACK BOOKING & QUICK ENQUIRY -->
        <div style="display:flex;flex-direction:column;gap:24px;">
          <div class="clay-panel" id="track-section">
            <span class="eyebrow" style="background:var(--teal-light);color:var(--teal);padding:6px 14px;border-radius:999px;font-weight:700;font-size:0.78rem;">LIVE STATUS CHECK</span>
            <h2 style="margin:10px 0 6px;font-size:1.6rem;">Track Your Booking</h2>
            <p style="color:var(--brown-soft);font-size:0.9rem;margin-bottom:16px;">
              Enter your Booking ID and registered mobile number to check real-time confirmation status.
            </p>
            <form id="trackForm" style="display:flex;flex-direction:column;gap:12px;">
              <input type="text" id="tBookingId" class="input-clay" placeholder="Booking ID (e.g. TGC-261113-A1B2C3)" required />
              <input type="tel" id="tMobile" class="input-clay" placeholder="Registered 10-digit Mobile Number" required />
              <button type="submit" class="btn btn-teal">Check Booking Status</button>
            </form>
            <div id="trackResult" style="display:none;margin-top:16px;background:#fff;border-radius:20px;padding:16px;border:1px solid rgba(62,39,35,0.1);"></div>
          </div>

          <div class="clay-panel" id="contact-section">
            <span class="eyebrow" style="background:#FCE7F3;color:#BE185D;padding:6px 14px;border-radius:999px;font-weight:700;font-size:0.78rem;">DIRECT ENQUIRY</span>
            <h2 style="margin:10px 0 6px;font-size:1.6rem;">Ask a Question</h2>
            <p style="color:var(--brown-soft);font-size:0.9rem;margin-bottom:16px;">
              Need custom dimensions, bulk quotes, or wood finish advice? Send us an enquiry.
            </p>
            <form id="enquiryForm" style="display:flex;flex-direction:column;gap:12px;">
              <input type="text" id="eName" class="input-clay" placeholder="Your Name *" required />
              <input type="tel" id="ePhone" class="input-clay" placeholder="Your Phone Number *" required />
              <input type="text" id="eProduct" class="input-clay" placeholder="Furniture Item (Optional)" />
              <textarea id="eMessage" class="input-clay" rows="2" placeholder="Write your message *" required></textarea>
              <button type="submit" class="btn btn-orange">Send Enquiry</button>
            </form>
          </div>
        </div>
      </div>
    </section>

    <!-- WHY CHOOSE US -->
    <section class="reveal">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">THE TAUFEEQ PROMISE</span>
          <h2>Why Choose ${bName}</h2>
        </div>
        <div class="features-grid">
          <div class="feature-box">
            <div class="feature-emoji">&#127795;</div>
            <h3>Seasoned Hardwood</h3>
            <p style="color:var(--brown-soft);font-size:0.92rem;">Termite-resistant seasoned teak, sal, and high-grade marine ply built for decades of daily use.</p>
          </div>
          <div class="feature-box">
            <div class="feature-emoji">&#127912;</div>
            <h3>Tailored Finishes</h3>
            <p style="color:var(--brown-soft);font-size:0.92rem;">Choose polish shades, upholstery fabrics, and dimensions tailored to match your home layout.</p>
          </div>
          <div class="feature-box">
            <div class="feature-emoji">&#128176;</div>
            <h3>Honest Showroom Pricing</h3>
            <p style="color:var(--brown-soft);font-size:0.92rem;">Direct workshop-to-home value with transparent pricing in Indian Rupees and zero hidden charges.</p>
          </div>
          <div class="feature-box">
            <div class="feature-emoji">&#129309;</div>
            <h3>Dedicated Personal Care</h3>
            <p style="color:var(--brown-soft);font-size:0.92rem;">Direct communication with our showroom team from booking confirmation through home placement.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- TESTIMONIALS -->
    <section class="reveal">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">HAPPY HOMES</span>
          <h2>What Our Customers Say</h2>
        </div>
        <div class="features-grid">
          <div class="feature-box">
            <p style="font-style:italic;margin-bottom:12px;">"The teak king-size bed and 3-door almari exceeded our expectations. Solid craftsmanship and smooth delivery."</p>
            <strong>— Farhan &amp; Ayesha Siddiqui</strong>
          </div>
          <div class="feature-box">
            <p style="font-style:italic;margin-bottom:12px;">"Booked our L-shape sofa online and coordinated fabric colors seamlessly over WhatsApp. Highly recommended!"</p>
            <strong>— Rajeshwari Deshmukh</strong>
          </div>
          <div class="feature-box">
            <p style="font-style:italic;margin-bottom:12px;">"Honest pricing and sturdy finishing on our 6-seater dining table. Truly made our new home feel complete."</p>
            <strong>— Imran Qureshi</strong>
          </div>
        </div>
      </div>
    </section>
  </main>

  <!-- FOOTER -->
  <footer>
    <div class="footer-grid">
      <div>
        <h3 style="font-size:1.35rem;margin-bottom:10px;">${bName}</h3>
        <p style="color:#FDE68A;font-size:0.92rem;">Premium handcrafted furniture showroom offering beds, sofas, wardrobes, dining sets, and bespoke interiors.</p>
      </div>
      <div>
        <h4 style="margin-bottom:10px;">Quick Links</h4>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:8px;font-size:0.92rem;">
          <li><a href="#categories" style="color:#FFF8F0;text-decoration:none;">Furniture Categories</a></li>
          <li><a href="#catalog" style="color:#FFF8F0;text-decoration:none;">Browse Collection</a></li>
          <li><a href="#booking-section" style="color:#FFF8F0;text-decoration:none;">Book Furniture</a></li>
          <li><a href="#track-section" style="color:#FFF8F0;text-decoration:none;">Track Booking Status</a></li>
        </ul>
      </div>
      <div>
        <h4 style="margin-bottom:10px;">Showroom Contact</h4>
        <p style="font-size:0.92rem;margin-bottom:6px;">
          ${bAddress ? `&#128205; ${bAddress}` : '&#128205; Contact showroom via WhatsApp or Enquiry Form'}
        </p>
        <p style="font-size:0.92rem;margin-bottom:12px;">
          ${bPhone ? `&#128222; ${bPhone}` : ''}
        </p>
        <a id="footerWhatsappBtn" href="#contact-section" class="btn btn-whatsapp btn-sm">Chat on WhatsApp</a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>&copy; ${new Date().getFullYear()} ${bName}. All rights reserved.</span>
      <span style="font-weight:700;letter-spacing:0.02em;">Co-Powered by Mr Shahid</span>
    </div>
  </footer>

  <!-- PRODUCT DETAILS MODAL -->
  <div class="modal-overlay" id="productModal" role="dialog" aria-modal="true">
    <div class="modal-card" id="productModalContent"></div>
  </div>

  <div class="toast-msg" id="toastMsg"></div>

  <script>
    (function() {
      'use strict';

      const state = {
        config: {
          businessName: ${JSON.stringify(CONFIG.BUSINESS_NAME)},
          businessPhone: ${JSON.stringify(CONFIG.BUSINESS_PHONE)},
          businessWhatsapp: ${JSON.stringify(CONFIG.BUSINESS_WHATSAPP)},
          categories: ${JSON.stringify(CATEGORIES)}
        },
        products: [],
        selectedCategory: 'All'
      };

      const CATEGORY_META = {
        'Beds': { icon: '&#128719;', bg: 'linear-gradient(135deg,#FED7AA,#FDBA74)' },
        'Sofas': { icon: '&#128715;', bg: 'linear-gradient(135deg,#99F6E4,#5EEAD4)' },
        'Almari / Wardrobes': { icon: '&#128682;', bg: 'linear-gradient(135deg,#FDE68A,#FCD34D)' },
        'Chairs': { icon: '&#129681;', bg: 'linear-gradient(135deg,#FECDD3,#FDA4AF)' },
        'Dining Tables': { icon: '&#127869;', bg: 'linear-gradient(135deg,#DDD6FE,#C4B5FD)' },
        'Dressing Tables': { icon: '&#129694;', bg: 'linear-gradient(135deg,#FBCFE8,#F9A8D4)' },
        'TV Units': { icon: '&#128250;', bg: 'linear-gradient(135deg,#BAE6FD,#7DD3FC)' },
        'Cabinets': { icon: '&#128452;', bg: 'linear-gradient(135deg,#FDE047,#FACC15)' },
        'Office Furniture': { icon: '&#128188;', bg: 'linear-gradient(135deg,#BBF7D0,#86EFAC)' },
        'Other Furniture': { icon: '&#127969;', bg: 'linear-gradient(135deg,#FFEDD5,#FED7AA)' }
      };

      function showToast(msg) {
        const el = document.getElementById('toastMsg');
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.remove('show'), 3400);
      }

      function formatINR(amount) {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);
      }

      function esc(str) {
        const d = document.createElement('div');
        d.textContent = str == null ? '' : String(str);
        return d.innerHTML;
      }

      function buildWhatsAppUrl({ customerName, productName, price, bookingId }) {
        const phone = (state.config.businessWhatsapp || '').replace(/\\D/g, '');
        const lines = [
          'Hello ' + state.config.businessName + ',',
          customerName ? 'Customer Name: ' + customerName : '',
          productName ? 'Product: ' + productName : '',
          price ? 'Price: ' + formatINR(price) : '',
          bookingId ? 'Booking ID: ' + bookingId : '',
          'I would like to enquire about this furniture.'
        ].filter(Boolean);
        const text = encodeURIComponent(lines.join('\\n'));
        if (!phone) return '#contact-section';
        return 'https://wa.me/' + phone + '?text=' + text;
      }

      function renderCategories() {
        const grid = document.getElementById('categoryGrid');
        const select = document.getElementById('categoryFilter');
        const cats = state.config.categories || [];

        grid.innerHTML = cats.map(cat => {
          const meta = CATEGORY_META[cat] || { icon: '&#129681;', bg: '#FFEDD5' };
          const active = state.selectedCategory === cat ? 'active' : '';
          return '<div class="cat-card ' + active + '" data-cat="' + esc(cat) + '">' +
            '<div class="cat-icon" style="background:' + meta.bg + '">' + meta.icon + '</div>' +
            '<h3>' + esc(cat) + '</h3>' +
          '</div>';
        }).join('');

        select.innerHTML = '<option value="All">All Categories</option>' +
          cats.map(c => '<option value="' + esc(c) + '"' + (state.selectedCategory === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('');

        grid.querySelectorAll('.cat-card').forEach(card => {
          card.addEventListener('click', () => {
            const cat = card.getAttribute('data-cat');
            state.selectedCategory = state.selectedCategory === cat ? 'All' : cat;
            document.getElementById('categoryFilter').value = state.selectedCategory;
            renderCategories();
            fetchProducts();
            document.getElementById('catalog').scrollIntoView({ behavior: 'smooth' });
          });
        });
      }

      function populateBookingSelect(products) {
        const sel = document.getElementById('bFurniture');
        const prev = sel.value;
        sel.innerHTML = '<option value="">-- Select Furniture Item --</option>' +
          products.map(p => {
            const finalPrice = Math.round(p.price * (1 - (p.discountPercent || 0) / 100));
            return '<option value="' + esc(p._id) + '" data-name="' + esc(p.name) + '">' + esc(p.name) + ' (' + formatINR(finalPrice) + ')</option>';
          }).join('') +
          '<option value="custom" data-name="Custom Furniture Order">Custom Furniture Requirement</option>';
        if (prev) sel.value = prev;
      }

      function renderProducts(products) {
        const grid = document.getElementById('productGrid');
        if (!products.length) {
          grid.innerHTML = '<div class="clay-panel" style="grid-column:1/-1;text-align:center;"><h3>No matching furniture found</h3><p style="color:var(--brown-soft);">Try clearing your filters or searching another keyword.</p></div>';
          return;
        }

        grid.innerHTML = products.map(p => {
          const discount = p.discountPercent || 0;
          const finalPrice = Math.round(p.price * (1 - discount / 100));
          const img = (p.images && p.images[0]) || 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80';
          const waUrl = buildWhatsAppUrl({ productName: p.name, price: finalPrice });
          const waAttr = waUrl.startsWith('http') ? 'target="_blank" rel="noopener"' : '';

          return '<article class="product-card">' +
            '<div class="product-img-wrap">' +
              '<img src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="lazy" />' +
              '<span class="pill-badge ' + (p.inStock ? 'pill-stock' : 'pill-out') + '">' + (p.inStock ? 'In Stock' : 'Made to Order') + '</span>' +
              (discount > 0 ? '<span class="pill-discount">' + discount + '% OFF</span>' : '') +
            '</div>' +
            '<span class="product-cat">' + esc(p.category) + '</span>' +
            '<h3 class="product-title">' + esc(p.name) + '</h3>' +
            '<p class="product-desc">' + esc(p.description) + '</p>' +
            '<div class="price-row">' +
              '<span class="price-final">' + formatINR(finalPrice) + '</span>' +
              (discount > 0 ? '<span class="price-old">' + formatINR(p.price) + '</span>' : '') +
            '</div>' +
            '<div class="card-actions">' +
              '<button type="button" class="btn btn-cream btn-sm view-btn" data-id="' + esc(p._id) + '">View Details</button>' +
              '<button type="button" class="btn btn-orange btn-sm book-btn" data-id="' + esc(p._id) + '" data-name="' + esc(p.name) + '">Book Now</button>' +
              '<a href="' + esc(waUrl) + '" ' + waAttr + ' class="btn btn-whatsapp btn-sm btn-wa-full">WhatsApp Enquiry</a>' +
            '</div>' +
          '</article>';
        }).join('');

        grid.querySelectorAll('.view-btn').forEach(btn => {
          btn.addEventListener('click', () => openProductModal(btn.getAttribute('data-id')));
        });

        grid.querySelectorAll('.book-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            selectForBooking(btn.getAttribute('data-id'), btn.getAttribute('data-name'));
          });
        });
      }

      function selectForBooking(productId, productName) {
        const sel = document.getElementById('bFurniture');
        if (productId && Array.from(sel.options).some(o => o.value === productId)) {
          sel.value = productId;
        }
        document.getElementById('booking-section').scrollIntoView({ behavior: 'smooth' });
        showToast('Selected "' + productName + '" for booking');
      }

      function openProductModal(id) {
        const p = state.products.find(item => item._id === id);
        if (!p) return;
        const discount = p.discountPercent || 0;
        const finalPrice = Math.round(p.price * (1 - discount / 100));
        const images = p.images && p.images.length ? p.images : ['https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=900&q=80'];
        const waUrl = buildWhatsAppUrl({ productName: p.name, price: finalPrice });
        const waAttr = waUrl.startsWith('http') ? 'target="_blank" rel="noopener"' : '';

        const modal = document.getElementById('productModal');
        const content = document.getElementById('productModalContent');

        content.innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
            '<span class="product-cat">' + esc(p.category) + '</span>' +
            '<button type="button" id="closeModalBtn" class="btn btn-cream btn-sm">&#10005; Close</button>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:22px;">' +
            '<div>' +
              '<img id="modalMainImg" src="' + esc(images[0]) + '" alt="' + esc(p.name) + '" style="width:100%;height:280px;object-fit:cover;border-radius:22px;margin-bottom:10px;" />' +
              (images.length > 1
                ? '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                    images.map(src => '<img src="' + esc(src) + '" class="modal-thumb" style="width:62px;height:62px;object-fit:cover;border-radius:12px;cursor:pointer;border:2px solid var(--orange);" />').join('') +
                  '</div>'
                : '') +
            '</div>' +
            '<div>' +
              '<h2 style="font-size:1.55rem;margin-bottom:8px;">' + esc(p.name) + '</h2>' +
              '<div class="price-row">' +
                '<span class="price-final" style="font-size:1.65rem;">' + formatINR(finalPrice) + '</span>' +
                (discount > 0 ? '<span class="price-old">' + formatINR(p.price) + '</span>' : '') +
              '</div>' +
              '<p style="color:var(--brown-mid);font-size:0.94rem;margin-bottom:14px;">' + esc(p.description) + '</p>' +
              '<div style="background:#fff;padding:14px;border-radius:18px;font-size:0.88rem;display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">' +
                '<div><strong>Material:</strong> ' + esc(p.material || 'Solid Wood') + '</div>' +
                '<div><strong>Available Sizes:</strong> ' + esc((p.sizes || ['Standard']).join(', ')) + '</div>' +
                '<div><strong>Colour Options:</strong> ' + esc((p.colors || ['Standard']).join(', ')) + '</div>' +
                '<div><strong>Availability:</strong> ' + (p.inStock ? '<span style="color:#166534;font-weight:700;">In Stock</span>' : '<span style="color:#991B1B;font-weight:700;">Made to Order</span>') + '</div>' +
              '</div>' +
              '<div style="display:flex;flex-wrap:wrap;gap:10px;">' +
                '<button type="button" id="modalBookNow" class="btn btn-orange">Book Now</button>' +
                '<a href="' + esc(waUrl) + '" ' + waAttr + ' class="btn btn-whatsapp">WhatsApp Enquiry</a>' +
              '</div>' +
            '</div>' +
          '</div>';

        modal.classList.add('active');
        document.getElementById('closeModalBtn').onclick = () => modal.classList.remove('active');
        document.getElementById('modalBookNow').onclick = () => {
          modal.classList.remove('active');
          selectForBooking(p._id, p.name);
        };
        content.querySelectorAll('.modal-thumb').forEach(thumb => {
          thumb.onclick = () => {
            document.getElementById('modalMainImg').src = thumb.src;
          };
        });
      }

      async function fetchProducts() {
        const search = document.getElementById('searchInput').value.trim();
        const category = document.getElementById('categoryFilter').value;
        const availability = document.getElementById('availabilityFilter').value;
        const sort = document.getElementById('sortFilter').value;

        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (category && category !== 'All') params.set('category', category);
        if (availability && availability !== 'all') params.set('availability', availability);
        if (sort) params.set('sort', sort);

        try {
          const res = await fetch('/api/products?' + params.toString());
          const data = await res.json();
          if (data.success) {
            state.products = data.products;
            renderProducts(data.products);
            if (category === 'All' && !search && availability === 'all') {
              populateBookingSelect(data.products);
            }
          }
        } catch (err) {
          showToast('Unable to load products. Please refresh.');
        }
      }

      async function initApp() {
        try {
          const cfgRes = await fetch('/api/config');
          const cfgData = await cfgRes.json();
          if (cfgData.success) {
            state.config = cfgData.config;
            const footerWa = document.getElementById('footerWhatsappBtn');
            const waUrl = buildWhatsAppUrl({});
            if (waUrl.startsWith('http')) {
              footerWa.href = waUrl;
              footerWa.target = '_blank';
              footerWa.rel = 'noopener';
            }
          }
        } catch (_) {}

        renderCategories();
        await fetchProducts();
      }

      // Event Listeners
      let searchDebounce;
      document.getElementById('searchInput').addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(fetchProducts, 300);
      });
      document.getElementById('categoryFilter').addEventListener('change', (e) => {
        state.selectedCategory = e.target.value;
        renderCategories();
        fetchProducts();
      });
      document.getElementById('availabilityFilter').addEventListener('change', fetchProducts);
      document.getElementById('sortFilter').addEventListener('change', fetchProducts);

      document.getElementById('mobileToggle').addEventListener('click', () => {
        document.getElementById('navLinks').classList.toggle('open');
      });

      document.getElementById('productModal').addEventListener('click', (e) => {
        if (e.target.id === 'productModal') e.currentTarget.classList.remove('active');
      });

      // Booking Form Submission
      document.getElementById('bookingForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('bookingSubmitBtn');
        const sel = document.getElementById('bFurniture');
        const selectedOpt = sel.options[sel.selectedIndex];
        const productId = sel.value === 'custom' ? null : sel.value;
        const furnitureName = selectedOpt ? (selectedOpt.getAttribute('data-name') || selectedOpt.textContent) : '';

        const payload = {
          customerName: document.getElementById('bCustomerName').value.trim(),
          mobileNumber: document.getElementById('bMobile').value.trim(),
          whatsappNumber: document.getElementById('bWhatsapp').value.trim(),
          productId,
          furnitureName,
          quantity: Number(document.getElementById('bQuantity').value),
          preferredColor: document.getElementById('bColor').value.trim(),
          preferredSize: document.getElementById('bSize').value.trim(),
          deliveryAddress: document.getElementById('bAddress').value.trim(),
          city: document.getElementById('bCity').value.trim(),
          pinCode: document.getElementById('bPin').value.trim(),
          message: document.getElementById('bMessage').value.trim()
        };

        btn.disabled = true;
        btn.textContent = 'Submitting Booking...';
        try {
          const res = await fetch('/api/bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            showToast(data.message || 'Please check your booking details.');
          } else {
            document.getElementById('confirmedBookingId').textContent = data.booking.bookingId;
            const waLink = document.getElementById('confirmWhatsappLink');
            const url = buildWhatsAppUrl({
              customerName: data.booking.customerName,
              productName: data.booking.furnitureName,
              price: data.booking.unitPrice * data.booking.quantity,
              bookingId: data.booking.bookingId
            });
            if (url.startsWith('http')) {
              waLink.href = url;
              waLink.style.display = 'inline-flex';
            } else {
              waLink.style.display = 'none';
            }
            document.getElementById('bookingConfirmationBox').style.display = 'block';
            e.target.reset();
            showToast('Booking request submitted! ID: ' + data.booking.bookingId);
          }
        } catch (err) {
          showToast('Network error submitting booking.');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Submit Furniture Booking Request';
        }
      });

      // Track Booking Form
      document.getElementById('trackForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const box = document.getElementById('trackResult');
        const bookingId = document.getElementById('tBookingId').value.trim();
        const mobileNumber = document.getElementById('tMobile').value.trim();

        try {
          const res = await fetch('/api/bookings/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId, mobileNumber })
          });
          const data = await res.json();
          box.style.display = 'block';
          if (!res.ok || !data.success) {
            box.innerHTML = '<p style="color:#991B1B;font-weight:700;">' + esc(data.message || 'Booking not found.') + '</p>';
          } else {
            const b = data.booking;
            box.innerHTML =
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
                '<strong>' + esc(b.bookingId) + '</strong>' +
                '<span style="background:#FFEDD5;color:#9A3412;padding:4px 12px;border-radius:999px;font-weight:800;font-size:0.82rem;">' + esc(b.status) + '</span>' +
              '</div>' +
              '<p style="font-size:0.9rem;"><strong>Customer:</strong> ' + esc(b.customerName) + '</p>' +
              '<p style="font-size:0.9rem;"><strong>Item:</strong> ' + esc(b.furnitureName) + ' (Qty: ' + esc(b.quantity) + ')</p>' +
              '<p style="font-size:0.85rem;color:var(--brown-soft);margin-top:6px;">Status Note: ' +
                (b.status === 'Pending' ? 'Awaiting administrator confirmation.' : 'Status updated by showroom administrator.') +
              '</p>';
          }
        } catch (_) {
          showToast('Unable to check booking status.');
        }
      });

      // Enquiry Form
      document.getElementById('enquiryForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          customerName: document.getElementById('eName').value.trim(),
          phoneNumber: document.getElementById('ePhone').value.trim(),
          productName: document.getElementById('eProduct').value.trim(),
          message: document.getElementById('eMessage').value.trim()
        };
        try {
          const res = await fetch('/api/enquiries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            showToast(data.message || 'Could not send enquiry.');
          } else {
            e.target.reset();
            showToast(data.message);
          }
        } catch (_) {
          showToast('Network error sending enquiry.');
        }
      });

      // Scroll Reveal Observer
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) entry.target.classList.add('visible');
        });
      }, { threshold: 0.08 });
      document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

      initApp();
    })();
  </script>
</body>
</html>`);
});

// ============================================================================
// GLOBAL 404 & ERROR HANDLER
// ============================================================================
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API endpoint not found.' });
  }
  res.status(404).send('Page not found.');
});

app.use((err, _req, res, _next) => {
  res.status(500).json({ success: false, message: 'An unexpected server error occurred.' });
});

// ============================================================================
// SERVERLESS & LOCAL EXECUTION ENTRYPOINT
// ============================================================================
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`${CONFIG.BUSINESS_NAME} running on http://localhost:${PORT}`);
  });
}

module.exports = app;
