import { useMemo } from "react";
import { AdminPage } from "./pages/AdminPage";
import { ParticipantFlow } from "./pages/ParticipantFlow";

type Route = { name: "participant" } | { name: "admin" };

function parseRoute(): Route {
  const path = window.location.pathname;
  if (path.startsWith("/admin")) return { name: "admin" };
  return { name: "participant" };
}

export function App() {
  const route = useMemo(parseRoute, []);

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brandTitle">Quran Recording Study</div>
          <div className="brandSubtitle">Tajweed recording study</div>
        </div>
      </div>

      {route.name === "admin" ? <AdminPage /> : <ParticipantFlow />}
    </div>
  );
}

