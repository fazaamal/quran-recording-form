import { newId, nowIso, presignPut, requireEnv } from "./_shared"
import type { Context } from "@netlify/functions"

type Req = {
  recordings: { stimulusId: string; contentType: string }[]
  signature: { contentType: string }
}

export default async (req: Request, _context: Context) => {
  try {
    if (req.method !== "POST")
      return new Response("Method not allowed", { status: 405 })
    const body = JSON.parse((await req.text()) || "{}") as Req
    if (!Array.isArray(body.recordings) || !body.signature?.contentType) {
      return new Response("Invalid request", { status: 400 })
    }

    // Optional env var to keep uploads under a prefix
    const prefix = process.env["S3_PREFIX"] ?? "qrf"
    const day = nowIso().slice(0, 10)
    const sessionId = newId("session")
    const root = `${prefix}/${day}/${sessionId}`

    const signatureKey = `${root}/signature.png`
    const signaturePutUrl = await presignPut({
      key: signatureKey,
      contentType: body.signature.contentType,
    })

    const recordings: Record<string, { putUrl: string; s3Key: string }> = {}
    for (const r of body.recordings) {
      if (!r.stimulusId || !r.contentType) continue
      const ext = r.contentType.includes("mp4")
        ? "m4a"
        : r.contentType.includes("mpeg")
        ? "mp3"
        : "webm"
      const key = `${root}/audio/${r.stimulusId}.${ext}`
      const putUrl = await presignPut({ key, contentType: r.contentType })
      recordings[r.stimulusId] = { putUrl, s3Key: key }
    }

    // Fail fast if required env missing (helps in local dev)
    requireEnv("S3_AWS_REGION")
    requireEnv("S3_BUCKET")

    console.log("create-upload-urls", {
      signaturePutUrl,
      signatureKey,
      recordings,
    })

    return new Response(
      JSON.stringify({
        signature: { putUrl: signaturePutUrl, s3Key: signatureKey },
        recordings,
      }),
      { headers: { "Content-Type": "application/json; charset=utf-8" } }
    )
  } catch (e) {
    console.error("create-upload-urls", e)
    return new Response(e instanceof Error ? e.message : "Server error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }
}
