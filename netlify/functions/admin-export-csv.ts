import { checkBasicAuth, ensureSchema, presignGet } from "./_shared"
import { db } from "./_shared"
import type { Context } from "@netlify/functions"

function csvEscape(v: unknown) {
  const s = String(v ?? "")
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export default async (req: Request, _context: Context) => {
  try {
    if (req.method !== "GET")
      return new Response("Method not allowed", { status: 405 })
    if (!checkBasicAuth(req.headers.get("authorization") ?? undefined)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "WWW-Authenticate": 'Basic realm="Admin"',
        },
      })
    }

    await ensureSchema()
    const pool = db()
    const { rows } = await pool.query(
      `select r.id as response_id, r.created_at, r.name, r.tajweed_level, r.years_reading, r.age, r.ethnicity,
              r.had_tajweed_classes, r.signed_consent_s3_key,
              rec.stimulus_id, rec.stimulus_text_ar, rec.kind, rec.letter, rec.harakah,
              rec.s3_key, rec.content_type, rec.duration_ms
       from responses r
       join recordings rec on rec.response_id = r.id
       order by r.created_at desc, rec.stimulus_id asc
       limit 5000`
    )

    const header = [
      "response_id",
      "created_at",
      "name",
      "tajweed_level",
      "years_reading",
      "age",
      "ethnicity",
      "had_tajweed_classes",
      "stimulus_id",
      "stimulus_text_ar",
      "kind",
      "letter",
      "harakah",
      "duration_ms",
      "recording_url",
      "signed_consent_url",
    ]

    const lines: string[] = []
    lines.push(header.map(csvEscape).join(","))

    for (const x of rows) {
      const recordingUrl = await presignGet({ key: x.s3_key as string })
      const signedConsentUrl = x.signed_consent_s3_key
        ? await presignGet({ key: x.signed_consent_s3_key as string })
        : ""

      const row = [
        x.response_id,
        (x.created_at as Date).toISOString(),
        x.name,
        x.tajweed_level,
        x.years_reading,
        x.age,
        x.ethnicity,
        x.had_tajweed_classes,
        x.stimulus_id,
        x.stimulus_text_ar,
        x.kind,
        x.letter,
        x.harakah,
        x.duration_ms,
        recordingUrl,
        signedConsentUrl,
      ]
      lines.push(row.map(csvEscape).join(","))
    }

    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="responses.csv"`,
      },
    })
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Server error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }
}
