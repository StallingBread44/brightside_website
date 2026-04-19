// firebase-init.js — Single source of truth for Firebase Web SDK
// Safe to expose in frontend code. Security is enforced by Firestore rules + Auth.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection,
         query, limit, getDocs, enableIndexedDbPersistence }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCxXXEf9u-Gh4ORSFMvHfQOnQ65YeLSbXw",
  authDomain: "website-bs-fbeab.firebaseapp.com",
  projectId: "website-bs-fbeab",
  storageBucket: "website-bs-fbeab.firebasestorage.app",
  messagingSenderId: "995737362868",
  appId: "1:995737362868:web:37c3e26b2f7bc8700012e1"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

enableIndexedDbPersistence(db).catch(() => {});

export {
  app, auth, db,
  onAuthStateChanged, signOut,
  doc, getDoc, setDoc,
  onSnapshot, collection, query, limit, getDocs
};
