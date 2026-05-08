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

const log = (...args: any[]) => {
  try {
    // Output logs to the serverless function's stdout
    // (Netlify captures these; no-op if console is unavailable)
    console.log("[submit-response]", ...args)
  } catch (_) {}
}

const CONSENT_PAGE_INDEX = 2

const CONSENT_SIG_X = 75
const CONSENT_SIG_Y = 280

const CONSENT_SIG_W = 170
const CONSENT_SIG_H = 80

const CONSENT_NAME_X = 95
const CONSENT_NAME_Y = 110
const CONSENT_NAME_MAX_WIDTH = 145

const CONSENT_DATE_X = 400
const CONSENT_DATE_Y = 240

const CONSENT_TEXT_FONT_SIZE = 14

function yFromTop(pageHeight: number, yTop: number) {
  return pageHeight - yTop
}

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

async function generateSignedConsentPdf(
  signaturePngBytes: Buffer,
  responseId: string,
  participantName: string
) {
  log("generateSignedConsentPdf: start", { responseId, participantName })
  const templatePath = path.join(process.cwd(), "public", "consent_form.pdf")
  log("generateSignedConsentPdf: templatePath resolved", templatePath)
  const templateBytes = fs.readFileSync(templatePath)
  log("generateSignedConsentPdf: templateBytes loaded:", !!templateBytes)

  const pdf = await PDFDocument.load(templateBytes)
  log("generateSignedConsentPdf: pdf loaded")
  const pages = pdf.getPages()
  log("generateSignedConsentPdf: got pages", pages.length)
  const pageIndex = Math.min(Math.max(0, CONSENT_PAGE_INDEX), pages.length - 1)
  log("generateSignedConsentPdf: using pageIndex", pageIndex)
  const page = pages[pageIndex]!

  const png = await pdf.embedPng(signaturePngBytes)
  log("generateSignedConsentPdf: embedded png")
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  log("generateSignedConsentPdf: embedded font")
  const pageHeight = page.getHeight()
  log("generateSignedConsentPdf: got pageHeight", pageHeight)

  const now = new Date()
  const dd = String(now.getDate()).padStart(2, "0")
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const yyyy = String(now.getFullYear())
  const dateStr = `${dd}/${mm}/${yyyy}`

  log("generateSignedConsentPdf: drawing participantName", participantName)
  page.drawText(participantName, {
    x: CONSENT_NAME_X,
    y: yFromTop(pageHeight, CONSENT_NAME_Y),
    size: CONSENT_TEXT_FONT_SIZE,
    maxWidth: CONSENT_NAME_MAX_WIDTH,
    font,
  })
  log("generateSignedConsentPdf: drawing dateStr", dateStr)
  page.drawText(dateStr, {
    x: CONSENT_DATE_X,
    y: yFromTop(pageHeight, CONSENT_DATE_Y),
    size: CONSENT_TEXT_FONT_SIZE,
    font,
  })
  log("generateSignedConsentPdf: drawing signature")
  page.drawImage(png, {
    x: CONSENT_SIG_X,
    y: yFromTop(pageHeight, CONSENT_SIG_Y),
    width: CONSENT_SIG_W,
    height: CONSENT_SIG_H,
  })

  const out = await pdf.save()
  log("generateSignedConsentPdf: pdf saved (buffer size)", out.length)
  return Buffer.from(out)
}

export default async (req: Request, _context: Context) => {
  log("Handler: called")
  try {
    if (req.method !== "POST") {
      log("Handler: method not allowed", req.method)
      return new Response("Method not allowed", { status: 405 })
    }
    log("Handler: reading request body")
    const body = JSON.parse((await req.text()) || "{}") as Req
    log("Handler: request body parsed", {
      participant: body.participant?.name,
      nRecordings: Array.isArray(body.recordings)
        ? body.recordings.length
        : "?",
    })

    if (
      !body.participant ||
      !body.signature?.s3Key ||
      !Array.isArray(body.recordings)
    ) {
      log("Handler: invalid request body")
      return new Response("Invalid request", { status: 400 })
    }
    if (body.recordings.length !== 16) {
      log("Handler: not exactly 16 recordings", body.recordings.length)
      return new Response("Expected 16 recordings", { status: 400 })
    }
    if (
      typeof body.participant.name !== "string" ||
      !body.participant.name.trim()
    ) {
      log("Handler: invalid participant name", body.participant.name)
      return new Response("Invalid participant.name", { status: 400 })
    }
    if (typeof body.participant.hadTajweedClasses !== "boolean") {
      log(
        "Handler: invalid hadTajweedClasses",
        body.participant.hadTajweedClasses
      )
      return new Response("Invalid participant.hadTajweedClasses", {
        status: 400,
      })
    }

    log("Handler: checking required env vars")
    requireEnv("POSTGRES_URL")
    requireEnv("S3_AWS_REGION")
    requireEnv("S3_BUCKET")
    log("Handler: required env vars OK")

    log("Handler: ensuring schema")
    await ensureSchema()
    log("Handler: schema ensured")

    const responseId = newId("resp")
    log("Handler: generated responseId", responseId)

    log("Handler: importing db pool")
    const pool = (await import("./_shared")).db()
    log("Handler: acquired db pool")

    log("Handler: inserting response row")
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
    log("Handler: response row inserted")

    for (const [ix, r] of body.recordings.entries()) {
      const recId = newId("rec")
      log(`Handler: inserting recording ${ix + 1}/16`, {
        stimulusId: r.stimulusId,
        recId,
      })
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
      log(`Handler: inserted recording ${ix + 1}/16`, { recId })
    }

    // Build signed consent pdf from template + signature stored in S3
    log("Handler: reading S3 signature bytes", body.signature.s3Key)
    const signatureBytes = await readS3ToBuffer(body.signature.s3Key)
    log("Handler: got signature bytes", signatureBytes.length)

    log("Handler: generating signed consent pdf")
    const signedPdfBytes = await generateSignedConsentPdf(
      signatureBytes,
      responseId,
      body.participant.name.trim()
    )
    log("Handler: generated signed consent pdf", signedPdfBytes.length)

    const prefix = process.env["S3_PREFIX"] ?? "qrf"
    const signedKey = `${prefix}/signed-consent/${responseId}.pdf`
    log("Handler: S3 put key for consent pdf", signedKey)
    const client = s3()
    const bucket = s3Bucket()
    log("Handler: uploading consent pdf to S3", { bucket, signedKey })
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: signedKey,
        Body: signedPdfBytes,
        ContentType: "application/pdf",
      })
    )
    log("Handler: consent pdf uploaded to S3", signedKey)

    log("Handler: updating response row with signed consent key")
    await pool.query(
      `update responses set signed_consent_s3_key=$2 where id=$1`,
      [responseId, signedKey]
    )
    log("Handler: updated response with signed consent")

    // Returning only response id; admin APIs can presign later
    log("Handler: done - returning responseId", responseId)
    return new Response(JSON.stringify({ responseId }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    })
  } catch (e) {
    log("Handler: error", e instanceof Error ? e.message : e)
    console.error("submit-response", e)
    return new Response(e instanceof Error ? e.message : "Server error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }
}
