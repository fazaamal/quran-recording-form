export type BasicAuth = { user: string; pass: string };

const KEY = "qrf_admin_basic_auth_v1";

export function saveBasicAuth(auth: BasicAuth | null) {
  if (!auth) {
    localStorage.removeItem(KEY);
    return;
  }
  localStorage.setItem(KEY, JSON.stringify(auth));
}

export function loadBasicAuth(): BasicAuth | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BasicAuth>;
    if (!parsed.user || !parsed.pass) return null;
    return { user: parsed.user, pass: parsed.pass };
  } catch {
    return null;
  }
}

