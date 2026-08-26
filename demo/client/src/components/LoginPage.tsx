// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useState } from 'react';
import { signIn, completeNewPassword } from '../auth';
import { CognitoUser } from 'amazon-cognito-identity-js';

interface LoginPageProps {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [cognitoUser, setCognitoUser] = useState<CognitoUser | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (needsNewPassword && cognitoUser) {
        await completeNewPassword(cognitoUser, newPassword);
        onLogin();
      } else {
        await signIn(email, password);
        onLogin();
      }
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string; cognitoUser?: CognitoUser };
      if (error.code === 'NewPasswordRequired') {
        setNeedsNewPassword(true);
        setCognitoUser(error.cognitoUser!);
        setError('');
      } else {
        setError(error.message || 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-md border">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 text-center">
            Bedrock Image Preprocessor
          </h2>
          <p className="mt-2 text-sm text-gray-600 text-center">
            {needsNewPassword ? 'Set a new password to continue' : 'Sign in to access the demo'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!needsNewPassword && (
            <>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                />
              </div>
            </>
          )}

          {needsNewPassword && (
            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
                New Password
              </label>
              <input
                id="newPassword"
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                placeholder="At least 8 characters"
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : needsNewPassword ? 'Set Password' : 'Sign In'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center">
          Access is by invitation only. Contact the admin to get an account.
        </p>
      </div>
    </div>
  );
}
