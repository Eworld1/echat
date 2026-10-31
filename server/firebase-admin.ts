import admin from 'firebase-admin';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = getApps().length === 0 ? initializeApp() : getApps()[0];

export const firestore = getFirestore(app, "ai-studio-echat-134f096e-b18d-4bb7-870d-d4f7fa96d17d");
export { admin, app };
