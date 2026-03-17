const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');

const { requireAuth } = require('../middleware/auth');
const { generateLimiter } = require('../middleware/rateLimits');
const { getUserBalance, debitCredits } = require('../services/creditLedger');
const { generateImage } = require('../services/siliconFlow');
const { uploadImage, getSignedUrl, getPublicUrl } = require('../services/r2Storage');
const db = require('../config/database');

const router = express.Router();

// Accept image uploads up to 10 MB in memory (no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported image format. Use JPEG, PNG, WebP, or HEIC.'));
  },
});

const generateSchema = Joi.object({
  prompt: Joi.string().min(1).max(1000).required(),
});

/**
 * POST /generate
 *
 * Generates an AI image using FLUX.1-Kontext-pro and stores it in Cloudflare R2.
 * Mode is determined automatically by whether an `image` file is attached:
 *   - No image → text-to-image  (1 credit, all tiers)
 *   - Image attached → image-to-image  (2 credits, Ultra tier only)
 *
 * Request: multipart/form-data (with image) or application/json (text-only)
 *   prompt  string  required  (1–1000 chars)
 *   image   file    optional  JPEG/PNG/WebP/HEIC, max 10 MB
 *
 * Response: { imageUrl, creditsRemaining, generationId }
 */
router.post(
  '/',
  requireAuth,
  generateLimiter,
  upload.single('image'),
  async (req, res) => {
    const { error, value } = generateSchema.validate({ prompt: req.body.prompt });
    if (error) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: error.details[0].message } });
    }

    const { prompt } = value;
    const { user } = req;

    // Mode is auto-detected: image attached = image-to-image, otherwise text-to-image
    const hasImage = !!req.file;
    const type = hasImage ? 'image_to_image' : 'text_to_image';

    // ----- Tier check for image-to-image -------------------------------------
    if (hasImage && user.tier !== 'ultra') {
      return res.status(403).json({
        error: { code: 'UPGRADE_REQUIRED', message: 'Image-to-image requires an Ultra subscription' },
      });
    }

    const creditsRequired = hasImage ? 2 : 1;
    const model = 'FLUX.1-Kontext-pro';

    // ----- Balance check (optimistic read — per-user rate limit prevents races) -
    const balance = await getUserBalance(user.id);
    if (balance < creditsRequired) {
      return res.status(402).json({
        error: {
          code: 'INSUFFICIENT_CREDITS',
          message: 'Not enough credits',
          balance,
          required: creditsRequired,
        },
      });
    }

    // ----- Create pending generation record ----------------------------------
    const generationId = uuidv4();
    await db.query(
      `INSERT INTO generations (id, user_id, prompt, type, credits_used, model)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [generationId, user.id, prompt, type, creditsRequired, model]
    );

    // ----- Generate image ----------------------------------------------------
    let imageBuffer;
    let referenceKey = null;

    try {
      let referenceUrl;

      if (hasImage) {
        // Upload reference image to R2 and get a short-lived URL for SiliconFlow
        const ext = path.extname(req.file.originalname) || '.jpg';
        referenceKey = `references/${user.id}/${generationId}_ref${ext}`;
        await uploadImage(req.file.buffer, referenceKey, req.file.mimetype);
        referenceUrl = await getSignedUrl(referenceKey, 3600);
      }

      // Single call — referenceUrl present triggers image-to-image mode
      imageBuffer = await generateImage(prompt, referenceUrl);
    } catch (err) {
      await db.query(
        `UPDATE generations SET status = 'failed', metadata = jsonb_set(metadata, '{error}', $1::jsonb)
         WHERE id = $2`,
        [JSON.stringify(err.message), generationId]
      );
      console.error('[generate] SiliconFlow error:', err.message);
      return res.status(502).json({
        error: {
          code: 'GENERATION_FAILED',
          message: 'Image generation failed. No credits were deducted.',
        },
      });
    }

    // ----- Store generated image in R2 --------------------------------------
    const generatedKey = `generations/${user.id}/${generationId}.png`;
    try {
      await uploadImage(imageBuffer, generatedKey, 'image/png');
    } catch (err) {
      await db.query(
        "UPDATE generations SET status = 'failed' WHERE id = $1",
        [generationId]
      );
      console.error('[generate] R2 upload error:', err.message);
      return res.status(502).json({
        error: { code: 'STORAGE_FAILED', message: 'Failed to store generated image. No credits were deducted.' },
      });
    }

    // Resolve the best URL to return to the client
    const imageUrl = process.env.R2_PUBLIC_URL
      ? getPublicUrl(generatedKey)
      : await getSignedUrl(generatedKey, 86_400);

    // ----- Atomically debit credits + mark completed ------------------------
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      await debitCredits(user.id, creditsRequired, generationId, client);

      await client.query(
        `UPDATE generations SET status = 'completed', image_url = $1, r2_key = $2
         WHERE id = $3`,
        [imageUrl, generatedKey, generationId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[generate] Finalization error:', err.message);
      // Generation is stored but not finalized — mark as failed
      await db.query("UPDATE generations SET status = 'failed' WHERE id = $1", [generationId]);
      return res.status(500).json({
        error: { code: 'SERVER_ERROR', message: 'Generation succeeded but could not be finalized. No credits were deducted.' },
      });
    } finally {
      client.release();
    }

    return res.status(201).json({
      imageUrl,
      creditsRemaining: balance - creditsRequired,
      generationId,
    });
  }
);

// Multer file filter error handler
router.use((err, _req, res, _next) => {
  if (err.name === 'MulterError' || err.message?.includes('Unsupported image')) {
    return res.status(400).json({ error: { code: 'INVALID_FILE', message: err.message } });
  }
  _next(err);
});

module.exports = router;
