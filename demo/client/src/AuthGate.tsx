// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useEffect, useState } from 'react';
import App from './App';
import { LoginPage } from './components/LoginPage';
import { getCurrentSession, getIdToken, signOut } from './auth';

export function AuthGate() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    getCurrentSession().then((session) => {
      setAuthenticated(session !== null);
    });
  }, []);

  const handleLogin = () => setAuthenticated(true);

  const handleSignOut = () => {
    signOut();
    setAuthenticated(false);
  };

  if (authenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <App onSignOut={handleSignOut} getIdToken={getIdToken} />;
}
