import { useMemo, useState } from "react";
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
  const [mode] = useState<Route>(route);

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brandTitle">Quran Recording Study</div>
          <div className="brandSubtitle">Audio + consent collection form</div>
        </div>
        <a className="pill" href={mode.name === "admin" ? "/" : "/admin"}>
          {mode.name === "admin" ? "Participant form" : "Admin dashboard"}
        </a>
      </div>

      {mode.name === "admin" ? <AdminPage /> : <ParticipantFlow />}
    </div>
  );
}

