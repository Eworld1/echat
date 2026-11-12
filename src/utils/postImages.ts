import type { Post } from '../types';

/** Accepts current mediaUrls, V2 images, and legacy comma-separated image fields. */
export function getPostImageUrls(post: Post): string[] {
  const media = Array.isArray(post.mediaUrls) ? post.mediaUrls : [];
  const images = post.images;
  const normalized = Array.isArray(images)
    ? images.map(item => typeof item === 'string' ? item : item?.url).filter((url): url is string => Boolean(url))
    : typeof images === 'string' ? images.split(',').map(url => url.trim()).filter(Boolean) : [];
  const legacyImage = typeof post.image === 'string' ? [post.image] : [];
  const values = media.length ? media : normalized.length ? normalized : legacyImage.length ? legacyImage : post.mediaUrl ? [post.mediaUrl] : [];
  return values;
}
