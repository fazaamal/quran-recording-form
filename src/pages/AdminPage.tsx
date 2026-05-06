import { useEffect, useMemo, useState } from "react";
import { apiAdminExportCsv, apiAdminList, apiAdminResponse } from "../utils/api";
import { BasicAuth, basicAuthAuthorizationHeader, loadBasicAuth, saveBasicAuth } from "../utils/basicAuth";

type ResponseRow = {
  id: string;
  createdAt: string;
  name: string;
  tajweedLevel: string;
  yearsReading: number;
  age: number;
  ethnicity: string;
  hadTajweedClasses: boolean;
  signedConsentUrl: string | null;
};

type RecordingRow = {
  stimulusId: string;
  stimulusTextAr: string;
  kind: string;
  letter: string;
  harakah: string;
  durationMs: number;
  url: string;
};

export function AdminPage() {
  const [auth, setAuth] = useState<BasicAuth>(() => loadBasicAuth() ?? { user: "", pass: "" });
  const [authed, setAuthed] = useState<boolean>(() => Boolean(loadBasicAuth()));
  const [rows, setRows] = useState<ResponseRow[]>([]);
  const [selected, setSelected] = useState<ResponseRow | null>(null);
  const [selectedRecordings, setSelectedRecordings] = useState<RecordingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const headers = useMemo(() => {
    if (!authed) return null;
    return basicAuthAuthorizationHeader(auth);
  }, [auth, authed]);

  async function refresh() {
    if (!headers) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiAdminList(headers);
      setRows(res.responses);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function openResponse(r: ResponseRow) {
    if (!headers) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiAdminResponse(headers, r.id);
      setSelected(r);
      setSelectedRecordings(res.recordings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load response");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  async function exportCsv() {
    if (!headers) return;
    setError(null);
    try {
      const blob = await apiAdminExportCsv(headers);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `responses-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }

  if (!authed) {
    return (
      <div className="card stack">
        <div style={{ fontSize: 18, fontWeight: 750 }}>Admin login</div>
        <div className="muted">
          Enter the Basic Auth credentials (from Netlify env vars) to access the dashboard.
        </div>
        <div className="row">
          <label>
            Username
            <input value={auth.user} onChange={(e) => setAuth((p) => ({ ...p, user: e.target.value }))} />
          </label>
          <label>
            Password
            <input
              type="password"
              value={auth.pass}
              onChange={(e) => setAuth((p) => ({ ...p, pass: e.target.value }))}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className="primary"
            onClick={() => {
              saveBasicAuth(auth);
              setAuthed(true);
            }}
            disabled={!auth.user || !auth.pass}
          >
            Continue
          </button>
          <button
            className="danger"
            onClick={() => {
              saveBasicAuth({ user: "", pass: "" });
              setAuth({ user: "", pass: "" });
            }}
          >
            Clear
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 750 }}>Responses</div>
            <div className="muted">{rows.length} total</div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={refresh} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
            <button className="primary" onClick={exportCsv} disabled={loading}>
              Export (CSV for Excel)
            </button>
            <button
              className="danger"
              onClick={() => {
                saveBasicAuth(null);
                setAuthed(false);
              }}
            >
              Log out
            </button>
          </div>
        </div>
        {error && <div style={{ color: "var(--danger)" }}>{error}</div>}
      </div>

      {selected && (
        <div className="card stack">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 750 }}>Response details</div>
              <div className="muted">
                Name: {selected.name || "—"}
                {" • "}
                {new Date(selected.createdAt).toLocaleString()} • {selected.id}
                {" • "}
                Formal tajweed classes: {selected.hadTajweedClasses ? "Yes" : "No"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => setSelected(null)}>Close</button>
              {selected.signedConsentUrl && (
                <a className="pill" href={selected.signedConsentUrl} target="_blank" rel="noreferrer">
                  Open consent PDF
                </a>
              )}
            </div>
          </div>

          <div className="card" style={{ boxShadow: "none", background: "transparent", padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "10px 8px" }}>Stimulus</th>
                  <th style={{ padding: "10px 8px" }}>Type</th>
                  <th style={{ padding: "10px 8px" }}>Letter</th>
                  <th style={{ padding: "10px 8px" }}>Harakah</th>
                  <th style={{ padding: "10px 8px" }}>Audio</th>
                </tr>
              </thead>
              <tbody>
                {selectedRecordings.map((x) => (
                  <tr key={x.stimulusId} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 8px", fontFamily: '"Amiri Quran", "Noto Naskh Arabic", serif', direction: "rtl" }}>
                      {x.stimulusTextAr}
                    </td>
                    <td style={{ padding: "10px 8px" }}>{x.kind}</td>
                    <td style={{ padding: "10px 8px" }}>{x.letter}</td>
                    <td style={{ padding: "10px 8px" }}>{x.harakah}</td>
                    <td style={{ padding: "10px 8px" }}>
                      <audio controls src={x.url} />
                    </td>
                  </tr>
                ))}
                {selectedRecordings.length === 0 && (
                  <tr>
                    <td className="muted" style={{ padding: "12px 8px" }} colSpan={5}>
                      No recordings found for this response.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)" }}>
              <th style={{ padding: "10px 8px" }}>Created</th>
              <th style={{ padding: "10px 8px" }}>ID</th>
              <th style={{ padding: "10px 8px" }}>Name</th>
              <th style={{ padding: "10px 8px" }}>Level</th>
              <th style={{ padding: "10px 8px" }}>Years</th>
              <th style={{ padding: "10px 8px" }}>Age</th>
              <th style={{ padding: "10px 8px" }}>Ethnicity</th>
              <th style={{ padding: "10px 8px" }}>Tajweed class</th>
              <th style={{ padding: "10px 8px" }}>Consent PDF</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                onClick={() => openResponse(r)}
                title="Click to view and play recordings"
              >
                <td style={{ padding: "10px 8px" }}>{new Date(r.createdAt).toLocaleString()}</td>
                <td style={{ padding: "10px 8px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                  {r.id}
                </td>
                <td style={{ padding: "10px 8px" }}>{r.name || <span className="muted">—</span>}</td>
                <td style={{ padding: "10px 8px" }}>{r.tajweedLevel}</td>
                <td style={{ padding: "10px 8px" }}>{r.yearsReading}</td>
                <td style={{ padding: "10px 8px" }}>{r.age}</td>
                <td style={{ padding: "10px 8px" }}>{r.ethnicity}</td>
                <td style={{ padding: "10px 8px" }}>{r.hadTajweedClasses ? "Yes" : "No"}</td>
                <td style={{ padding: "10px 8px" }}>
                  {r.signedConsentUrl ? (
                    <a href={r.signedConsentUrl} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="muted" style={{ padding: "12px 8px" }} colSpan={9}>
                  No responses yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

