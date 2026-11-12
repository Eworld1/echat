import admin from 'firebase-admin';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Always pin Admin SDK token verification to the same Firebase project used by
// the browser app. On hosted platforms ADC may point at a different default
// project; without this, valid client ID tokens are rejected as a wrong-project
// sign-in and Go Live fails even though the user is already authenticated.
export const firebaseProjectId = (
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  'echat-studio-6e215'
).trim();

const app = getApps().length === 0
  ? initializeApp({ projectId: firebaseProjectId })
  : getApps()[0];

export const firestore = getFirestore(app, "ai-studio-echat-134f096e-b18d-4bb7-870d-d4f7fa96d17d");
export { admin, app };
