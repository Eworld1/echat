import type { App } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

// Render has no Google Application Default Credentials. The Admin SDK is optional
// and is initialized only from an explicitly supplied service-account secret.
export const firebaseProjectId = (
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  'echat-studio-6e215'
).trim();

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
let adminApp: App | null = null;
let firestoreInstance: Firestore | null = null;
let authInstance: Auth | null = null;

if (serviceAccountJson) {
  try {
    const json = serviceAccountJson.startsWith('{')
      ? serviceAccountJson
      : Buffer.from(serviceAccountJson, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(json);
    if (typeof serviceAccount.private_key === 'string') {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/auth'),
      import('firebase-admin/firestore')
    ]);
    const appName = 'echat-render-service-account';
    adminApp = appSdk.getApps().find(app => app.name === appName) || appSdk.initializeApp({
      projectId: firebaseProjectId,
      credential: appSdk.cert(serviceAccount)
    }, appName);
    firestoreInstance = firestoreSdk.getFirestore(adminApp, process.env.FIREBASE_DATABASE_ID || 'ai-studio-echat-134f096e-b18d-4bb7-870d-d4f7fa96d17d');
    authInstance = authSdk.getAuth(adminApp);
  } catch (error) {
    console.warn('[Firebase Admin] FIREBASE_SERVICE_ACCOUNT_JSON is invalid; optional Firebase profile sync and Auth metadata lookup are disabled.', error instanceof Error ? error.message : error);
  }
} else {
  console.warn('[Firebase Admin] FIREBASE_SERVICE_ACCOUNT_JSON is unset; ADC is disabled, so optional Firestore sync and Auth metadata lookup are skipped.');
}

export const firestore = firestoreInstance;
export function getFirebaseAdminAuth(): Auth | null {
  return authInstance;
}
