/**
 * Auth state hook.
 *
 * Subscribes to Firebase Auth state changes. Returns the current user
 * (or null when signed out), a loading flag for the initial resolution,
 * and a signOut helper.
 */
import { useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  return {
    user,
    loading,
    isSignedIn: !!user,
    signOut: () => fbSignOut(auth),
  };
}
