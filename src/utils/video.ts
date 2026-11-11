export async function makeVideoThumbnail(file: File): Promise<{ file: File | null; duration: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      video.onloadedmetadata = () => resolve(Number.isFinite(video.duration) ? video.duration : 0);
      video.onerror = () => reject(new Error('Could not read video metadata'));
      video.src = url;
      video.load();
    });
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Could not decode the first video frame'));
      if (video.readyState >= 2) resolve();
    });
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return { file: null, duration };
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return { file: blob ? new File([blob], 'reel-thumbnail.jpg', { type: 'image/jpeg' }) : null, duration };
  } finally {
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

export async function compressVideoInBrowser(file: File, onProgress: (percent: number) => void): Promise<File> {
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  video.preload = 'auto';
  video.playsInline = true;
  video.muted = false;
  video.volume = 0;
  const captureElement = video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
  const canvas = document.createElement('canvas');
  const canvasCapture = canvas as HTMLCanvasElement & { captureStream?: (rate?: number) => MediaStream };
  if (typeof MediaRecorder === 'undefined' || !canvasCapture.captureStream || !(captureElement.captureStream || captureElement.mozCaptureStream)) {
    URL.revokeObjectURL(url);
    throw new Error('Video compression is not supported in this browser. Choose Upload Original.');
  }

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not decode this video for compression.'));
      video.src = url;
      video.load();
    });
    const scale = Math.min(1, 1280 / video.videoWidth, 720 / video.videoHeight);
    canvas.width = Math.max(2, Math.floor(video.videoWidth * scale / 2) * 2);
    canvas.height = Math.max(2, Math.floor(video.videoHeight * scale / 2) * 2);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Video compression is not supported in this browser. Choose Upload Original.');
    const canvasStream = canvasCapture.captureStream(30);
    const sourceStream = (captureElement.captureStream || captureElement.mozCaptureStream)!.call(video);
    const output = new MediaStream([...canvasStream.getVideoTracks(), ...sourceStream.getAudioTracks()]);
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4;codecs=h264,aac', 'video/mp4']
      .find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(output, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 3_500_000, audioBitsPerSecond: 128_000 });
    const chunks: BlobPart[] = [];
    const result = new Promise<File>((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('Video compression failed. Choose Upload Original.'));
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'video/webm';
        const extension = type.includes('mp4') ? 'mp4' : 'webm';
        const compressed = new File(chunks, `compressed-reel.${extension}`, { type });
        resolve(compressed.size < file.size ? compressed : file);
      };
    });
    let frame = 0;
    const draw = () => {
      if (video.readyState >= 2) context.drawImage(video, 0, 0, canvas.width, canvas.height);
      onProgress(Math.min(99, Math.round(video.duration ? video.currentTime / video.duration * 100 : 0)));
      if (!video.ended && recorder.state === 'recording') frame = requestAnimationFrame(draw);
    };
    recorder.start(1000);
    frame = requestAnimationFrame(draw);
    await video.play();
    await new Promise<void>((resolve, reject) => {
      video.onended = () => { if (recorder.state === 'recording') recorder.stop(); resolve(); };
      video.onerror = () => { if (recorder.state === 'recording') recorder.stop(); reject(new Error('Video playback failed during compression. Choose Upload Original.')); };
    });
    const compressed = await result;
    onProgress(100);
    return compressed;
  } finally {
    video.pause();
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}
