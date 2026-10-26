import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { COUNTRIES } from "../data/countries";

export default function Register() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const [country, setCountry] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error: invokeError } = await supabase.functions.invoke("register", {
        body: { email, password, full_name: fullName, organization, country },
      });

      if (invokeError) {
        setError("Something went wrong. Please try again.");
        return;
      }

      if (data?.status === "rejected") {
        navigate("/rejected");
        return;
      }

      if (data?.status === "active") {
        // Sign in now that the account exists and is active.
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          navigate("/login");
          return;
        }
        navigate("/dashboard");
        return;
      }

      setError("Something went wrong. Please try again.");
      void sessionData;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="cs-eyebrow">New account</div>
      <h1>Create an account</h1>
      <form onSubmit={handleSubmit} className="cs-ticks">
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <label>
          Organization (optional)
          <input value={organization} onChange={(e) => setOrganization(e.target.value)} />
        </label>
        <label>
          Country
          <select value={country} onChange={(e) => setCountry(e.target.value)} required>
            <option value="" disabled>
              Select a country
            </option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="form-error">{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Creating account..." : "Register"}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
