export async function fetchImageBlob(url: string): Promise<Blob> {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`Image download failed (${response.status}).`);
  return response.blob();
}

export async function saveImageToDevice(url: string, filename: string): Promise<void> {
  let blob: Blob;
  try { blob = await fetchImageBlob(url); }
  catch {
    const fallback=document.createElement('a');
    fallback.href=url;
    fallback.target='_blank';
    fallback.rel='noopener noreferrer';
    fallback.download=filename;
    document.body.appendChild(fallback);
    fallback.click();
    fallback.remove();
    throw new Error('Opened the full-size image. Use your browser’s Save Image option to keep it.');
  }
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

export async function shareImageFile(url: string, filename: string): Promise<void> {
  if (!navigator.share) throw new Error('Image sharing is not available on this device.');
  const blob = await fetchImageBlob(url);
  const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
  if (navigator.canShare && !navigator.canShare({ files: [file] })) throw new Error('This device cannot share image files.');
  await navigator.share({ files: [file], title: filename });
}
