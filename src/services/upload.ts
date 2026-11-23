/**
 * All EChat file uploads go straight from the browser to Cloudinary (free tier, unsigned preset).
 * Only the resulting https URL is stored (Firestore / the EChat API). No Firebase Storage needed.
 *
 * Config (Vercel env, read at build time; vite.config.ts exposes NEXT_PUBLIC_* as well as VITE_*):
 *   NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME      (or VITE_CLOUDINARY_CLOUD_NAME)
 *   NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET   (or VITE_CLOUDINARY_UPLOAD_PRESET)  — must be an *Unsigned* preset
 */

const env = import.meta.env as Record<string, string | undefined>;
// Cloud name + unsigned preset are public identifiers (they ship in the browser bundle either way).
export const CLOUDINARY_CLOUD_NAME = (env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || env.VITE_CLOUDINARY_CLOUD_NAME || 'gcsxnba1').trim();
export const CLOUDINARY_UPLOAD_PRESET = (env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || env.VITE_CLOUDINARY_UPLOAD_PRESET || 'echat_upload').trim();

export const MAX_VIDEO_UPLOAD_BYTES = 30 * 1024 * 1024;
/** Cloudinary free plan: images and other files max 10 MB each. */
export const MAX_FILE_UPLOAD_BYTES = 10 * 1024 * 1024;

/** No upload progress for this long = stop with a clear error (instead of hanging at 0%). */
const STALL_TIMEOUT_MS = 60_000;

export interface UploadOptions {
  /** Cloudinary folder, e.g. "echat/reels". */
  folder?: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export interface CloudinaryUpload {
  promise: Promise<string>;
  cancel: () => void;
}

export class UploadCancelledError extends Error {
  constructor() {
    super('Upload cancelled.');
    this.name = 'AbortError';
  }
}

const isVideoFile = (file: Blob & { name?: string }) =>
  (file.type || '').startsWith('video/') || /\.(mp4|mov|webm|m4v|3gp)$/i.test(file.name || '');

/** Checks size limits BEFORE anything is sent. Returns an error message or ''. */
export function uploadSizeError(file: Blob & { name?: string }): string {
  if (isVideoFile(file)) return file.size > MAX_VIDEO_UPLOAD_BYTES ? 'Video must be 30MB or less' : '';
  if ((file.type || '').startsWith('image/')) return file.size > MAX_FILE_UPLOAD_BYTES ? 'Image must be 10MB or less' : '';
  return file.size > MAX_FILE_UPLOAD_BYTES ? 'File must be 10MB or less' : '';
}

/** Turns Cloudinary's error into something the user (or admin) can act on. */
function explainCloudinaryError(status: number, message: string): string {
  const text = message.toLowerCase();
  if (text.includes('upload preset') || text.includes('unsigned')) {
    return `Upload failed: Cloudinary upload preset "${CLOUDINARY_UPLOAD_PRESET}" is wrong or not set to Unsigned. ` +
      'Fix it in Cloudinary → Settings → Upload → Upload presets (Signing mode: Unsigned), or set NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET.';
  }
  if (text.includes('cloud_name') || text.includes('cloud name') || status === 404) {
    return `Upload failed: Cloudinary cloud name "${CLOUDINARY_CLOUD_NAME}" was not found. Check NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME.`;
  }
  if (text.includes('file size too large') || status === 413) return `Upload failed: file is too large for Cloudinary. ${message}`;
  if (text.includes('format') || text.includes('invalid image file') || text.includes('unsupported')) return `Upload failed: this file type is not allowed. ${message}`;
  if (status === 420 || text.includes('rate limit')) return 'Upload limit reached for now. Please try again later.';
  if (status >= 500) return 'Cloudinary is having problems right now. Please retry in a minute.';
  return `Upload failed: ${message || `HTTP ${status}`}`;
}

/**
 * Uploads one file to Cloudinary with real progress (0 → 100). Resolves with the https URL.
 * Uses the /auto/upload endpoint so images, videos and other files all work.
 */
export function uploadToCloudinary(file: Blob & { name?: string }, options: UploadOptions = {}): CloudinaryUpload {
  const sizeError = uploadSizeError(file);
  if (sizeError) return { promise: Promise.reject(new Error(sizeError)), cancel: () => {} };
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    return { promise: Promise.reject(new Error('Uploads are not configured. Set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET.')), cancel: () => {} };
  }

  const xhr = new XMLHttpRequest();
  let settled = false;
  let stallTimer = 0;
  let cancelled = false;

  const promise = new Promise<string>((resolve, reject) => {
    const finish = (error: Error | null, url = '') => {
      if (settled) return;
      settled = true;
      window.clearTimeout(stallTimer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(url);
    };
    const armStallTimer = () => {
      window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => {
        console.error('[EChat upload] no progress for 60s, aborting', { name: file.name, size: file.size });
        xhr.abort();
        finish(new Error(typeof navigator !== 'undefined' && !navigator.onLine ? 'You are offline. Check your connection and retry.' : 'Upload is not moving. Check your connection and retry.'));
      }, STALL_TIMEOUT_MS);
    };
    function onAbort() {
      cancelled = true;
      xhr.abort();
      finish(new UploadCancelledError());
    }

    if (options.signal?.aborted) { finish(new UploadCancelledError()); return; }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const body = new FormData();
    body.append('file', file, file.name || (isVideoFile(file) ? 'video.mp4' : 'upload'));
    body.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    if (options.folder) body.append('folder', options.folder);

    xhr.open('POST', `https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}/auto/upload`);
    xhr.upload.onprogress = event => {
      armStallTimer();
      if (event.lengthComputable && event.total > 0) options.onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      let data: { secure_url?: string; error?: { message?: string } } = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.secure_url) {
        options.onProgress?.(100);
        finish(null, data.secure_url);
        return;
      }
      const message = data.error?.message || xhr.statusText || '';
      // Log the REAL Cloudinary response for debugging.
      console.error('[EChat upload] Cloudinary rejected the upload', { status: xhr.status, message, response: xhr.responseText.slice(0, 500), cloud: CLOUDINARY_CLOUD_NAME, preset: CLOUDINARY_UPLOAD_PRESET });
      finish(new Error(explainCloudinaryError(xhr.status, message)));
    };
    xhr.onerror = () => {
      console.error('[EChat upload] network error talking to Cloudinary', { name: file.name, size: file.size });
      finish(new Error(typeof navigator !== 'undefined' && !navigator.onLine ? 'You are offline. Check your connection and retry.' : 'Upload failed: could not reach Cloudinary. Check your connection and retry.'));
    };
    xhr.onabort = () => { if (cancelled) finish(new UploadCancelledError()); };

    options.onProgress?.(0);
    armStallTimer();
    xhr.send(body);
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      cancelled = true;
      xhr.abort();
      window.clearTimeout(stallTimer);
    }
  };
}

/** Promise-only convenience wrapper. */
export function uploadFile(file: Blob & { name?: string }, options: UploadOptions = {}): Promise<string> {
  return uploadToCloudinary(file, options).promise;
}

/** Poster image (first frame, JPG) for a Cloudinary video URL; '' for anything else. */
export function cloudinaryVideoPoster(url: string): string {
  if (!/^https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\//.test(url)) return '';
  return url.replace('/video/upload/', '/video/upload/so_0,f_jpg,q_auto/').replace(/\.[a-z0-9]+(\?.*)?$/i, '.jpg');
}
