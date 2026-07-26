"use client";

import { cognitoLogin } from "../../lib/api";
import { LogIn, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function LoginPage() {
  const [email, setEmail] = useState(process.env.NEXT_PUBLIC_DEMO_EMAIL ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await cognitoLogin(email, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo"><Sparkles size={22} /></span>
          <h1>WorkPilot</h1>
          <p>Sign in to your workspace</p>
        </div>

        {reason === "session" && (
          <div className="login-notice">Your session expired. Please sign in again.</div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <label className="form-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </label>
          <label className="form-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="primary-button full-button" disabled={loading}>
            <LogIn size={17} />
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="login-hint">
          Credentials are validated against your Cognito user pool.
        </p>
      </div>
    </div>
  );
}
