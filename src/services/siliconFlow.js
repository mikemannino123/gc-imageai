const axios = require('axios');

// ---------------------------------------------------------------------------
// Single model for all generation modes.
// FLUX.1-Kontext-pro handles both text-to-image and image-guided generation:
//   - No `image` field → pure text-to-image
//   - `image` field present → image-to-image / guided editing
// https://siliconflow.cn/models
// ---------------------------------------------------------------------------
const MODEL = 'Pro/black-forest-labs/FLUX.1-Kontext-pro';

const sfClient = axios.create({
  baseURL: 'https://api.siliconflow.cn/v1',
  timeout: 90_000, // generation can take 30–60 s; give generous headroom
  headers: { 'Content-Type': 'application/json' },
});

// Inject API key at request time (not at module load) so tests can override it
sfClient.interceptors.request.use((config) => {
  config.headers['Authorization'] = `Bearer ${process.env.SILICONFLOW_API_KEY}`;
  return config;
});

async function fetchImageBuffer(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30_000 });
  return Buffer.from(response.data);
}

/**
 * Generates an image using FLUX.1-Kontext-pro.
 *
 * When `referenceImageUrl` is omitted the model runs in text-to-image mode.
 * When provided it runs in image-to-image / guided-editing mode.
 *
 * @param {string}  prompt
 * @param {string}  [referenceImageUrl]  Publicly accessible URL of the source image
 * @returns {Promise<Buffer>}
 */
async function generateImage(prompt, referenceImageUrl) {
  const body = {
    model: MODEL,
    prompt,
    image_size: '1024x1024',
    num_inference_steps: 28,
    guidance_scale: 2.5,
    batch_size: 1,
  };

  if (referenceImageUrl) {
    body.image = referenceImageUrl;
  }

  const response = await sfClient.post('/images/generations', body);

  const imageUrl = response.data?.images?.[0]?.url;
  if (!imageUrl) {
    throw new Error('SiliconFlow returned no image URL');
  }

  return fetchImageBuffer(imageUrl);
}

module.exports = { generateImage };
