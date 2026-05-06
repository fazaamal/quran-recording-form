export type BasicAuth = { user: string; pass: string };

const KEY = "qrf_admin_basic_auth_v1";

/** UTF-8 bytes then base64 — matches server `base64ToUtf8` in netlify/functions/_shared.ts. */
export function basicAuthAuthorizationHeader(auth: BasicAuth): Record<string, string> {
  const user = auth.user.trim();
  const pass = auth.pass.trim();
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return { Authorization: `Basic ${btoa(binary)}` };
}

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

