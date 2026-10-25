// Deliberately generic — no detail on which screening check triggered
// rejection, and no path to appeal or re-register with the same email.
export default function Rejected() {
  return (
    <div className="auth-page">
      <h1>Account not available</h1>
      <p>This account cannot be activated. If you believe this is an error, contact your organization's administrator.</p>
    </div>
  );
}
