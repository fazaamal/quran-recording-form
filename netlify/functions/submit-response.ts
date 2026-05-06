import { PDFDocument, StandardFonts } from "pdf-lib"
import path from "node:path"
import fs from "node:fs"
import {
  ensureSchema,
  newId,
  readS3ToBuffer,
  requireEnv,
  s3,
  s3Bucket,
} from "./_shared"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import type { Context } from "@netlify/functions"

type Req = {
  participant: {
    name: string
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

function numEnv(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

async function generateSignedConsentPdf(
  signaturePngBytes: Buffer,
  responseId: string,
  participantName: string
) {
  const templatePath = path.join(process.cwd(), "pdf", "consent_form.pdf")
  const templateBytes = fs.readFileSync(templatePath)

  const pdf = await PDFDocument.load(templateBytes)
  const pages = pdf.getPages()
  const pageIndex = Math.min(
    Math.max(0, numEnv("CONSENT_SIG_PAGE", 0)),
    pages.length - 1
  )
  const page = pages[pageIndex]!

  const png = await pdf.embedPng(signaturePngBytes)
  const font = await pdf.embedFont(StandardFonts.Helvetica)

  const x = numEnv("CONSENT_SIG_X", 80)
  const y = numEnv("CONSENT_SIG_Y", 120)
  const w = numEnv("CONSENT_SIG_W", 220)
  const h = numEnv("CONSENT_SIG_H", 80)

  const now = new Date()
  const dd = String(now.getDate()).padStart(2, "0")
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const yyyy = String(now.getFullYear())
  const dateStr = `${dd}/${mm}/${yyyy}`

  page.drawText(participantName, {
    x: 85,
    y: 115,
    size: 16,
    maxWidth: 145,
    font,
  })
  page.drawText(dateStr, {
    x: 400,
    y: 240,
    size: 16,
    font,
  })
  page.drawImage(png, { x, y, width: w, height: h })

  const out = await pdf.save()
  return Buffer.from(out)
}

export default async (req: Request, _context: Context) => {
  try {
    if (req.method !== "POST")
      return new Response("Method not allowed", { status: 405 })
    const body = JSON.parse((await req.text()) || "{}") as Req
    if (
      !body.participant ||
      !body.signature?.s3Key ||
      !Array.isArray(body.recordings)
    ) {
      return new Response("Invalid request", { status: 400 })
    }
    if (body.recordings.length !== 16) {
      return new Response("Expected 16 recordings", { status: 400 })
    }
    if (typeof body.participant.name !== "string" || !body.participant.name.trim()) {
      return new Response("Invalid participant.name", { status: 400 })
    }
    if (typeof body.participant.hadTajweedClasses !== "boolean") {
      return new Response("Invalid participant.hadTajweedClasses", {
        status: 400,
      })
    }

    requireEnv("POSTGRES_URL")
    requireEnv("S3_AWS_REGION")
    requireEnv("S3_BUCKET")

    await ensureSchema()
    const responseId = newId("resp")

    const pool = (await import("./_shared")).db()
    await pool.query(
      `insert into responses (id, name, tajweed_level, years_reading, age, ethnicity, had_tajweed_classes, signature_s3_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        responseId,
        body.participant.name.trim(),
        body.participant.tajweedLevel,
        body.participant.yearsReading,
        body.participant.age,
        body.participant.ethnicity,
        body.participant.hadTajweedClasses,
        body.signature.s3Key,
      ]
    )

    for (const r of body.recordings) {
      const recId = newId("rec")
      await pool.query(
        `insert into recordings
         (id, response_id, stimulus_id, stimulus_text_ar, kind, letter, harakah, s3_key, content_type, duration_ms)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          recId,
          responseId,
          r.stimulusId,
          r.stimulusTextAr,
          r.kind,
          r.letter,
          r.harakah,
          r.s3Key,
          r.contentType,
          r.durationMs,
        ]
      )
    }

    // Build signed consent pdf from template + signature stored in S3
    const signatureBytes = await readS3ToBuffer(body.signature.s3Key)
    const signedPdfBytes = await generateSignedConsentPdf(
      signatureBytes,
      responseId,
      body.participant.name.trim()
    )

    const prefix = process.env["S3_PREFIX"] ?? "qrf"
    const signedKey = `${prefix}/signed-consent/${responseId}.pdf`
    const client = s3()
    const bucket = s3Bucket()
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: signedKey,
        Body: signedPdfBytes,
        ContentType: "application/pdf",
      })
    )

    await pool.query(
      `update responses set signed_consent_s3_key=$2 where id=$1`,
      [responseId, signedKey]
    )

    // Returning only response id; admin APIs can presign later
    return new Response(JSON.stringify({ responseId }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    })
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Server error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }
}
