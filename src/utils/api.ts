const NETLIFY_FUNCTIONS_BASE_URL = import.meta.env
  .VITE_NETLIFY_FUNCTIONS_BASE_URL

type CreateUploadUrlsReq = {
  recordings: { stimulusId: string; contentType: string }[]
  signature: { contentType: string }
}

type CreateUploadUrlsRes = {
  signature: { putUrl: string; s3Key: string }
  recordings: Record<string, { putUrl: string; s3Key: string }>
}

type SubmitResponseReq = {
  participant: {
    tajweedLevel: string
    yearsReading: number
    age: number
    ethnicity: string
    hadTajweedClasses: boolean
  }
  signature: { s3Key: string }
  recordings: {
    stimulusId: string
    stimulusTextAr: string
    kind: "letter" | "word"
    letter: "dad" | "ayn"
    harakah: "fatha" | "kasra" | "damma" | "sukoon"
    s3Key: string
    contentType: string
    durationMs: number
  }[]
}

type SubmitResponseRes = { responseId: string }

/** Same-origin absolute URL; avoids Safari/WebKit issues resolving `/api` on non-http(s) pages. */
function apiUrl(path: string): string {
  if (typeof window === "undefined") return path
  if (!path.startsWith("/")) return path
  const { protocol, host } = window.location
  if ((protocol !== "http:" && protocol !== "https:") || !host) return path
  return `${protocol}//${host}${path}`
}

// async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
//   const url = apiUrl(path)
//   try {
//     console.log("apiFetch", url, init)

//     return await fetch(`http://localhost:8888/.netlify/functions` + url, init)
//   } catch (e) {
//     const msg = e instanceof Error ? e.message : String(e)
//     if (/expected pattern|invalid url|failed to parse url/i.test(msg)) {
//       throw new Error(
//         `${msg} — Open this app over http(s), e.g. the URL from "npm run dev" (port 8888). file:// or some embedded previews cannot call /api.`
//       )
//     }
//     throw e instanceof Error ? e : new Error(msg)
//   }
// }

async function json<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? ""
  const raw = await res.text()
  if (!res.ok) {
    throw new Error(raw || `Request failed (${res.status})`)
  }
  if (!ct.includes("application/json")) {
    throw new Error(
      `Expected JSON from API but got "${
        ct || "unknown"
      }". Use the Netlify dev http(s) URL (see "npm run dev"). Body starts: ${raw
        .slice(0, 100)
        .replace(/\s+/g, " ")}`
    )
  }
  try {
    return JSON.parse(raw) as T
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Invalid JSON (${m}). Preview: ${raw.slice(0, 160).replace(/\s+/g, " ")}`
    )
  }
}

export async function apiCreateUploadUrls(
  body: CreateUploadUrlsReq
): Promise<CreateUploadUrlsRes> {
  const res = await fetch(`${NETLIFY_FUNCTIONS_BASE_URL}/create-upload-urls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return json<CreateUploadUrlsRes>(res)
}

export async function apiSubmitResponse(
  body: SubmitResponseReq
): Promise<SubmitResponseRes> {
  const res = await fetch(`${NETLIFY_FUNCTIONS_BASE_URL}/submit-response`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return json<SubmitResponseRes>(res)
}

export async function apiAdminList(headers: Record<string, string>) {
  const res = await fetch(`${NETLIFY_FUNCTIONS_BASE_URL}/admin-list`, {
    headers,
  })
  return json<{ responses: any[] }>(res)
}

export async function apiAdminResponse(
  headers: Record<string, string>,
  id: string
) {
  const res = await fetch(
    `${NETLIFY_FUNCTIONS_BASE_URL}/admin-response?id=${encodeURIComponent(id)}`,
    {
      headers,
    }
  )
  return json<{ response: any; recordings: any[] }>(res)
}

export async function apiAdminExportCsv(headers: Record<string, string>) {
  const res = await fetch(`${NETLIFY_FUNCTIONS_BASE_URL}/admin-export-csv`, {
    headers,
  })
  if (!res.ok) throw new Error(`Export failed (${res.status})`)
  return await res.blob()
}
