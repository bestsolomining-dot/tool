import { useState } from "react";

export default function Login({ onLoginSuccess, onCall }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Note: We use the provided onCall (callApi) which won't have a token yet.
      // The /api/auth/login route should be unprotected on the backend.
      const result = await onCall("/api/auth/login", {
        method: "POST",
        body: { username, password },
      });

      if (result && result.success && result.token) {
        onLoginSuccess(result.token);
      } else {
        setError(result?.message || result?.error || "Invalid credentials");
      }
    } catch (err) {
      setError("Failed to connect to authentication server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="app-shell"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#0f172a",
      }}
    >
      <div
        className="panel"
        style={{
          textAlign: "center",
          padding: "40px",
          maxWidth: "400px",
          width: "100%",
        }}
      >
        <h2 style={{ marginBottom: "8px", color: "#f8fafc" }}>Mining Tool</h2>
        <p style={{ color: "#94a3b8", marginBottom: "24px", fontSize: "14px" }}>
          Sign in to manage your rigs
        </p>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          <div style={{ textAlign: "left" }}>
            <label
              style={{
                fontSize: "12px",
                color: "#64748b",
                display: "block",
                marginBottom: "4px",
              }}
            >
              USERNAME
            </label>
            <input
              type="text"
              className="select-pro" // Reusing your existing styles
              style={{ width: "100%", background: "rgba(255,255,255,0.05)" }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div style={{ textAlign: "left" }}>
            <label
              style={{
                fontSize: "12px",
                color: "#64748b",
                display: "block",
                marginBottom: "4px",
              }}
            >
              PASSWORD
            </label>
            <input
              type="password"
              className="select-pro"
              style={{ width: "100%", background: "rgba(255,255,255,0.05)" }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div
              style={{ color: "#f87171", fontSize: "12px", marginTop: "8px" }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn-pro primary"
            disabled={loading}
            style={{ marginTop: "12px" }}
          >
            {loading ? "Authenticating..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
