import type { Handler } from "@netlify/functions"
import { checkBasicAuth, ensureSchema, presignGet } from "./_shared"
import { db } from "./_shared"
import type { Context } from "@netlify/functions"

export default async (req: Request, context: Context) => {
  try {
    if (event.httpMethod !== "GET")
      return { statusCode: 405, body: "Method not allowed" }
    if (!checkBasicAuth(event.headers.authorization)) {
      return {
        statusCode: 401,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "WWW-Authenticate": 'Basic realm="Admin"',
        } as Record<string, string>,
        body: "Unauthorized",
      }
    }

    console.log("event", event)

    const id = event.queryStringParameters?.id
    if (!id) return { statusCode: 400, body: "Missing id" }

    await ensureSchema()
    const pool = db()

    const resp = await pool.query(
      `select id, created_at, tajweed_level, years_reading, age, ethnicity, had_tajweed_classes, signed_consent_s3_key
       from responses where id=$1`,
      [id]
    )
    if (resp.rows.length === 0) return { statusCode: 404, body: "Not found" }
    const r = resp.rows[0]!

    const recs = await pool.query(
      `select stimulus_id, stimulus_text_ar, kind, letter, harakah, s3_key, content_type, duration_ms
       from recordings where response_id=$1
       order by stimulus_id asc`,
      [id]
    )

    const recordings = await Promise.all(
      recs.rows.map(async (x: any) => {
        let url = ""
        try {
          url = await presignGet({ key: x.s3_key as string })
        } catch {
          url = ""
        }
        return {
          stimulusId: x.stimulus_id as string,
          stimulusTextAr: x.stimulus_text_ar as string,
          kind: x.kind as string,
          letter: x.letter as string,
          harakah: x.harakah as string,
          s3Key: x.s3_key as string,
          contentType: x.content_type as string,
          durationMs: x.duration_ms as number,
          url,
        }
      })
    )

    let signedConsentUrl: string | null = null
    if (r.signed_consent_s3_key) {
      try {
        signedConsentUrl = await presignGet({
          key: r.signed_consent_s3_key as string,
        })
      } catch {
        signedConsentUrl = null
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" } as Record<string, string>,
      body: JSON.stringify({
        response: {
          id: r.id as string,
          createdAt: (r.created_at as Date).toISOString(),
          tajweedLevel: r.tajweed_level as string,
          yearsReading: r.years_reading as number,
          age: r.age as number,
          ethnicity: r.ethnicity as string,
          hadTajweedClasses: Boolean(r.had_tajweed_classes),
          signedConsentUrl,
        },
        recordings,
      }),
    }
  } catch (e) {
    return {
      statusCode: 500,
      body: e instanceof Error ? e.message : "Server error",
    }
  }
}
