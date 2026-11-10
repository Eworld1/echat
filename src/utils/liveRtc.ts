const turnUrl = import.meta.env.VITE_TURN_URL ?? '';

export const liveRtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    ...(turnUrl ? [{
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME ?? '',
      credential: import.meta.env.VITE_TURN_CREDENTIAL ?? ''
    }] : [])
  ],
  iceCandidatePoolSize: 4
};
