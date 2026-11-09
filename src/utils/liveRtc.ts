const turnUrl = import.meta.env.VITE_TURN_URL ?? '';

export const liveRtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    ...(turnUrl ? [{
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME ?? '',
      credential: import.meta.env.VITE_TURN_CREDENTIAL ?? ''
    }] : [{
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }])
  ],
  iceCandidatePoolSize: 4
};
