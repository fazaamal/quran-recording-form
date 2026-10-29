import { useMemo } from "react";
import { AdminPage } from "./pages/AdminPage";
import { ParticipantFlow } from "./pages/ParticipantFlow";
import { RatePage } from "./pages/RatePage";

type Route = { name: "participant" } | { name: "admin" } | { name: "rate"; token: string };

function parseRoute(): Route {
  const path = window.location.pathname;
  if (path.startsWith("/admin")) return { name: "admin" };
  const rate = path.match(/^\/rate\/([^/]+)/);
  if (rate) return { name: "rate", token: decodeURIComponent(rate[1]!) };
  return { name: "participant" };
}

export function App() {
  const route = useMemo(parseRoute, []);

  // The rater page is full-screen with its own design.
  if (route.name === "rate") return <RatePage token={route.token} />;

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
