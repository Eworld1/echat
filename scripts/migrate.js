import fs from 'fs';
import path from 'path';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyAK2HUzTc_ZUk7J-bEppDswVcSHBdykKfc",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "echat-studio-6e215.firebaseapp.com",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "echat-studio-6e215",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "echat-studio-6e215.firebasestorage.app",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "798563589659",
  appId: process.env.VITE_FIREBASE_APP_ID || "1:798563589659:web:8caaa34d64620e2167e2be"
};

let databaseId = "(default)";
try {
  const configFile = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configFile)) {
    const configData = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    if (configData.firestoreDatabaseId) {
      databaseId = configData.firestoreDatabaseId;
    }
  }
} catch (e) {}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, databaseId);

async function runMigration() {
  const jsonPath = path.resolve(process.cwd(), 'data', 'echat_db.json');
  console.log(`Checking for database dump at: ${jsonPath}`);

  if (!fs.existsSync(jsonPath)) {
    console.log('No data/echat_db.json found. Skipping migration.');
    return;
  }

  let dbData;
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    dbData = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse echat_db.json:', err);
    return;
  }

  console.log('Starting migration to Firebase Firestore...');

  // 1. Migrate Users
  if (Array.isArray(dbData.users) && dbData.users.length > 0) {
    console.log(`Migrating ${dbData.users.length} users...`);
    for (const user of dbData.users) {
      const docId = user.id || user.email.replace(/[@.]/g, '_');
      try {
        await setDoc(doc(db, 'users', docId), user, { merge: true });
        console.log(` -> User migrated: ${user.name} (${user.email}) [${docId}]`);
      } catch (err) {
        console.error(`Failed to migrate user ${user.email}:`, err);
      }
    }
  }

  // 2. Migrate Posts
  if (Array.isArray(dbData.posts) && dbData.posts.length > 0) {
    console.log(`Migrating ${dbData.posts.length} posts...`);
    for (const post of dbData.posts) {
      try {
        await setDoc(doc(db, 'posts', post.id), post, { merge: true });
        console.log(` -> Post migrated: ${post.id}`);
      } catch (err) {
        console.error(`Failed to migrate post ${post.id}:`, err);
      }
    }
  }

  // 3. Migrate Stories
  if (Array.isArray(dbData.stories) && dbData.stories.length > 0) {
    console.log(`Migrating ${dbData.stories.length} stories...`);
    for (const story of dbData.stories) {
      try {
        await setDoc(doc(db, 'stories', story.id), story, { merge: true });
        console.log(` -> Story migrated: ${story.id}`);
      } catch (err) {
        console.error(`Failed to migrate story ${story.id}:`, err);
      }
    }
  }

  // 4. Migrate Messages
  if (Array.isArray(dbData.messages) && dbData.messages.length > 0) {
    console.log(`Migrating ${dbData.messages.length} messages...`);
    for (const msg of dbData.messages) {
      try {
        await setDoc(doc(db, 'messages', msg.id), msg, { merge: true });
        console.log(` -> Message migrated: ${msg.id}`);
      } catch (err) {
        console.error(`Failed to migrate message ${msg.id}:`, err);
      }
    }
  }

  // 5. Migrate Notifications
  if (Array.isArray(dbData.notifications) && dbData.notifications.length > 0) {
    console.log(`Migrating ${dbData.notifications.length} notifications...`);
    for (const notif of dbData.notifications) {
      try {
        await setDoc(doc(db, 'notifications', notif.id), notif, { merge: true });
        console.log(` -> Notification migrated: ${notif.id}`);
      } catch (err) {
        console.error(`Failed to migrate notification ${notif.id}:`, err);
      }
    }
  }

  console.log('Firebase Firestore migration completed successfully!');
  process.exit(0);
}

runMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
