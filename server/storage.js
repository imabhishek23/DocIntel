import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
const JSON_FILE = path.join(DATA_DIR, 'reviews.json');

let memoryStore = [];

// Ensure local fallback data directory exists safely (resilient to read-only environments)
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(JSON_FILE)) {
    fs.writeFileSync(JSON_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
} catch (err) {
  console.warn('[STORAGE] Filesystem init warning (using in-memory fallback):', err.message);
}

let isMongoConnected = false;
let mongoModel = null;

// Local JSON file helpers with memory fallback
function readLocalReviews() {
  try {
    if (fs.existsSync(JSON_FILE)) {
      const raw = fs.readFileSync(JSON_FILE, 'utf-8');
      return JSON.parse(raw);
    }
    return memoryStore;
  } catch (err) {
    console.warn('[STORAGE] Error reading local JSON store:', err.message);
    return memoryStore;
  }
}

function writeLocalReviews(items) {
  memoryStore = items;
  try {
    fs.writeFileSync(JSON_FILE, JSON.stringify(items, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[STORAGE] Error writing local JSON store (using in-memory):', err.message);
  }
}

// MongoDB Schema
const ReviewSchema = new mongoose.Schema(
  {
    mode: { type: String, required: true, enum: ['analyze', 'compare'] },
    title: { type: String, default: 'Untitled Document' },
    docAName: { type: String, default: '' },
    docBName: { type: String, default: '' },
    overallScore: { type: Number, default: 0 },
    criticalCount: { type: Number, default: 0 },
    highCount: { type: Number, default: 0 },
    summary: { type: String, default: '' },
    documentText: { type: String, default: '' },
    result: { type: mongoose.Schema.Types.Mixed, required: true },
    modelUsed: { type: String, default: 'deterministic-rules' },
  },
  { timestamps: true }
);

export async function initStorage() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('[STORAGE] No MONGODB_URI set. Using local JSON store.');
    return { status: 'local_json' };
  }

  try {
    console.log('[STORAGE] Connecting to MongoDB Atlas...');
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000,
    });
    isMongoConnected = true;
    mongoModel = mongoose.models.Review || mongoose.model('Review', ReviewSchema);
    console.log('[STORAGE] Connected to MongoDB Atlas successfully.');
    return { status: 'mongodb', connected: true };
  } catch (err) {
    console.warn(
      `[STORAGE] MongoDB connection failed (${err.message}). Seamlessly using local JSON store as fail-safe.`
    );
    isMongoConnected = false;
    return { status: 'local_json', fallbackReason: err.message };
  }
}

export async function saveReview(reviewData) {
  const {
    mode,
    title,
    docAName = '',
    docBName = '',
    overallScore = 0,
    criticalCount = 0,
    highCount = 0,
    summary = '',
    documentText = '',
    result,
    modelUsed = 'hybrid-ai',
  } = reviewData;

  // Try MongoDB if connected
  if (isMongoConnected && mongoModel) {
    try {
      const doc = await mongoModel.create({
        mode,
        title,
        docAName,
        docBName,
        overallScore,
        criticalCount,
        highCount,
        summary,
        documentText,
        result,
        modelUsed,
      });
      return { id: doc._id.toString(), storage: 'mongodb' };
    } catch (err) {
      console.warn('[STORAGE] MongoDB write failed, falling back to local JSON:', err.message);
    }
  }

  // Local JSON fallback
  const id = 'rev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const newEntry = {
    _id: id,
    mode,
    title,
    docAName,
    docBName,
    overallScore,
    criticalCount,
    highCount,
    summary,
    documentText,
    result,
    modelUsed,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const current = readLocalReviews();
  current.unshift(newEntry);
  writeLocalReviews(current);

  return { id, storage: 'local_json' };
}

export async function listReviews({ page = 1, limit = 20 } = {}) {
  if (isMongoConnected && mongoModel) {
    try {
      const skip = (page - 1) * limit;
      const [docs, total] = await Promise.all([
        mongoModel
          .find({}, 'mode title docAName docBName overallScore criticalCount highCount summary createdAt')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        mongoModel.countDocuments({}),
      ]);

      return {
        items: docs.map((d) => ({ ...d, _id: d._id.toString() })),
        total,
        page,
        limit,
        storage: 'mongodb',
      };
    } catch (err) {
      console.warn('[STORAGE] MongoDB list failed, using local JSON:', err.message);
    }
  }

  const items = readLocalReviews();
  const skip = (page - 1) * limit;
  const paginated = items.slice(skip, skip + limit).map((d) => ({
    _id: d._id,
    mode: d.mode,
    title: d.title,
    docAName: d.docAName,
    docBName: d.docBName,
    overallScore: d.overallScore,
    criticalCount: d.criticalCount,
    highCount: d.highCount,
    summary: d.summary,
    createdAt: d.createdAt,
  }));

  return {
    items: paginated,
    total: items.length,
    page,
    limit,
    storage: 'local_json',
  };
}

export async function getReviewById(id) {
  if (isMongoConnected && mongoModel && mongoose.isValidObjectId(id)) {
    try {
      const doc = await mongoModel.findById(id).lean();
      if (doc) return { ...doc, _id: doc._id.toString() };
    } catch (err) {
      console.warn('[STORAGE] MongoDB find failed, checking local JSON:', err.message);
    }
  }

  const items = readLocalReviews();
  const match = items.find((d) => String(d._id) === String(id));
  return match || null;
}

export async function clearReviews() {
  let clearedCount = 0;
  if (isMongoConnected && mongoModel) {
    try {
      const res = await mongoModel.deleteMany({});
      clearedCount += res.deletedCount || 0;
    } catch (err) {
      console.warn('[STORAGE] MongoDB deleteMany failed:', err.message);
    }
  }
  const items = readLocalReviews();
  clearedCount += items.length;
  writeLocalReviews([]);
  return clearedCount;
}

export function getStorageStatus() {
  return {
    mode: isMongoConnected ? 'mongodb' : 'local_json',
    isMongoConnected,
  };
}
