import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import TaskingWizard from "../components/TaskingWizard";
import MyRequestsList from "../components/MyRequestsList";
import AdminReviewQueue from "../components/AdminReviewQueue";

export default function Dashboard() {
  const { profile, signOut } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1>Welcome{profile ? `, ${profile.full_name}` : ""}</h1>
          <p className="request-meta">
            {profile?.role} · {profile?.organization ?? "no organization"} · {profile?.country}
            {profile?.trusted ? " · trusted" : ""}
          </p>
        </div>
        <button onClick={signOut}>Sign out</button>
      </header>

      <TaskingWizard onSubmitted={() => setRefreshKey((k) => k + 1)} />
      <MyRequestsList refreshKey={refreshKey} />

      {profile?.role === "admin" && <AdminReviewQueue />}
    </div>
  );
}
