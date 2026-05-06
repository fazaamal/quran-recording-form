/**
 * Manual smoke-test for create-upload-urls and submit-response.
 *
 * Prerequisites:
 *   - `npm run dev` is running (Netlify dev server on http://localhost:8888)
 *   - Docker Compose services are up  (postgres + minio)
 *
 * Usage:
 *   node scripts/test-endpoints.mjs
 *   node scripts/test-endpoints.mjs http://localhost:8888   # custom base URL
 */


const BASE = process.argv[2] ?? "http://localhost:8888"
const FN = `${BASE}/.netlify/functions`

const RESET = "\x1b[0m"
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const CYAN = "\x1b[36m"
const DIM = "\x1b[2m"

let passed = 0
let failed = 0

function ok(label) {
  console.log(`${GREEN}✓${RESET} ${label}`)
  passed++
}

function fail(label, detail) {
  console.error(`${RED}✗${RESET} ${label}`)
  if (detail) console.error(`  ${DIM}${detail}${RESET}`)
  failed++
}

async function json(res, label) {
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Expected JSON, got: ${text.slice(0, 200)}`)
  }
}

// ─── Stimuli (mirrored from src/stimuli.ts) ──────────────────────────────────
const stimuli = [
  { id: "dad_letter_fatha",  kind: "letter", letter: "dad", harakah: "fatha",  arabic: "ضَ" },
  { id: "dad_letter_kasra",  kind: "letter", letter: "dad", harakah: "kasra",  arabic: "ضِ" },
  { id: "dad_letter_damma",  kind: "letter", letter: "dad", harakah: "damma",  arabic: "ضُ" },
  { id: "dad_letter_sukoon", kind: "letter", letter: "dad", harakah: "sukoon", arabic: "اَضْ" },
  { id: "dad_word_fatha",    kind: "word",   letter: "dad", harakah: "fatha",  arabic: "ضَارَ" },
  { id: "dad_word_kasra",    kind: "word",   letter: "dad", harakah: "kasra",  arabic: "ضِعْفٌ" },
  { id: "dad_word_damma",    kind: "word",   letter: "dad", harakah: "damma",  arabic: "ضُمِرَ" },
  { id: "dad_word_sukoon",   kind: "word",   letter: "dad", harakah: "sukoon", arabic: "يَضْرِبُ" },
  { id: "ayn_letter_fatha",  kind: "letter", letter: "ayn", harakah: "fatha",  arabic: "عَ" },
  { id: "ayn_letter_kasra",  kind: "letter", letter: "ayn", harakah: "kasra",  arabic: "عِ" },
  { id: "ayn_letter_damma",  kind: "letter", letter: "ayn", harakah: "damma",  arabic: "عُ" },
  { id: "ayn_letter_sukoon", kind: "letter", letter: "ayn", harakah: "sukoon", arabic: "اَعْ" },
  { id: "ayn_word_fatha",    kind: "word",   letter: "ayn", harakah: "fatha",  arabic: "عَلِمَ" },
  { id: "ayn_word_kasra",    kind: "word",   letter: "ayn", harakah: "kasra",  arabic: "عِبَادَةٌ" },
  { id: "ayn_word_damma",    kind: "word",   letter: "ayn", harakah: "damma",  arabic: "عُمَرُ" },
  { id: "ayn_word_sukoon",   kind: "word",   letter: "ayn", harakah: "sukoon", arabic: "مَعْلُومٌ" },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal 1×1 transparent PNG (67 bytes) – valid PNG, no canvas dependency. */
function minimalPngBuffer() {
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6260000000020001e221bc330000000049454e44ae426082",
    "hex"
  )
}

/** Minimal valid webm/audio stub – just enough bytes for a PUT to succeed. */
function minimalWebmBuffer() {
  // Real-world Netlify only checks Content-Type, not the body bytes for presigned PUTs.
  return Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function testMethodNotAllowed() {
  console.log(`\n${CYAN}[create-upload-urls] method validation${RESET}`)
  try {
    const res = await fetch(`${FN}/create-upload-urls`, { method: "GET" })
    if (res.status === 405) {
      ok("GET returns 405")
    } else {
      fail("GET should return 405", `got ${res.status}`)
    }
  } catch (e) {
    fail("Unexpected error", e.message)
  }
}

async function testCreateUploadUrlsMissingBody() {
  console.log(`\n${CYAN}[create-upload-urls] missing body${RESET}`)
  try {
    const res = await fetch(`${FN}/create-upload-urls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
    if (res.status === 400) {
      ok("empty body returns 400")
    } else {
      fail("empty body should return 400", `got ${res.status}`)
    }
  } catch (e) {
    fail("Unexpected error", e.message)
  }
}

async function testCreateUploadUrls() {
  console.log(`\n${CYAN}[create-upload-urls] happy path${RESET}`)
  const body = {
    recordings: stimuli.map((s) => ({ stimulusId: s.id, contentType: "audio/webm" })),
    signature: { contentType: "image/png" },
  }

  let data
  try {
    const res = await fetch(`${FN}/create-upload-urls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    data = await json(res, "create-upload-urls")
    ok("returns 200 with JSON")
  } catch (e) {
    fail("create-upload-urls request failed", e.message)
    return null
  }

  // Validate shape
  if (typeof data.signature?.putUrl === "string" && typeof data.signature?.s3Key === "string") {
    ok("signature.putUrl and s3Key present")
  } else {
    fail("signature missing putUrl / s3Key", JSON.stringify(data.signature))
  }

  const missingIds = stimuli.filter((s) => !data.recordings?.[s.id]?.putUrl)
  if (missingIds.length === 0) {
    ok(`all ${stimuli.length} recording putUrls present`)
  } else {
    fail(`missing putUrls for ${missingIds.length} stimuli`, missingIds.map((s) => s.id).join(", "))
  }

  return data
}

async function testUploadToS3(uploadPlan) {
  console.log(`\n${CYAN}[S3] PUT presigned uploads${RESET}`)

  // Upload signature PNG
  try {
    const res = await fetch(uploadPlan.signature.putUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: minimalPngBuffer(),
    })
    if (res.ok) {
      ok("signature PNG PUT succeeded")
    } else {
      const txt = await res.text()
      fail("signature PNG PUT failed", `${res.status}: ${txt.slice(0, 200)}`)
    }
  } catch (e) {
    fail("signature PUT threw", e.message)
  }

  // Upload first recording only (checking the rest would be slow; presign URLs share the same infra)
  const firstId = stimuli[0].id
  const firstPlan = uploadPlan.recordings[firstId]
  try {
    const res = await fetch(firstPlan.putUrl, {
      method: "PUT",
      headers: { "Content-Type": "audio/webm" },
      body: minimalWebmBuffer(),
    })
    if (res.ok) {
      ok(`recording PUT succeeded (${firstId})`)
    } else {
      const txt = await res.text()
      fail(`recording PUT failed (${firstId})`, `${res.status}: ${txt.slice(0, 200)}`)
    }
  } catch (e) {
    fail("recording PUT threw", e.message)
  }
}

async function testSubmitResponseValidation() {
  console.log(`\n${CYAN}[submit-response] validation${RESET}`)

  // Wrong method
  const methodRes = await fetch(`${FN}/submit-response`, { method: "GET" })
  methodRes.status === 405
    ? ok("GET returns 405")
    : fail("GET should return 405", `got ${methodRes.status}`)

  // Missing participant.name
  const noName = await fetch(`${FN}/submit-response`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      participant: { tajweedLevel: "beginner", yearsReading: 5, age: 25, ethnicity: "Malay", hadTajweedClasses: false },
      signature: { s3Key: "qrf/test/sig.png" },
      recordings: stimuli.map((s) => ({
        stimulusId: s.id, stimulusTextAr: s.arabic,
        kind: s.kind, letter: s.letter, harakah: s.harakah,
        s3Key: "qrf/test/audio.webm", contentType: "audio/webm", durationMs: 1000,
      })),
    }),
  })
  noName.status === 400
    ? ok("missing name returns 400")
    : fail("missing name should return 400", `got ${noName.status}`)

  // Wrong recording count
  const wrongCount = await fetch(`${FN}/submit-response`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      participant: { name: "Test User", tajweedLevel: "beginner", yearsReading: 5, age: 25, ethnicity: "Malay", hadTajweedClasses: false },
      signature: { s3Key: "qrf/test/sig.png" },
      recordings: [{ stimulusId: "dad_letter_fatha", stimulusTextAr: "ضَ", kind: "letter", letter: "dad", harakah: "fatha", s3Key: "k", contentType: "audio/webm", durationMs: 1000 }],
    }),
  })
  wrongCount.status === 400
    ? ok("wrong recording count returns 400")
    : fail("wrong recording count should return 400", `got ${wrongCount.status}`)
}

async function testSubmitResponse(uploadPlan) {
  console.log(`\n${CYAN}[submit-response] happy path${RESET}`)
  console.log(`  ${DIM}(involves DB insert + PDF generation + S3 upload — may take ~5-10s)${RESET}`)

  const recordingsPayload = stimuli.map((s) => ({
    stimulusId: s.id,
    stimulusTextAr: s.arabic,
    kind: s.kind,
    letter: s.letter,
    harakah: s.harakah,
    s3Key: uploadPlan.recordings[s.id]?.s3Key ?? `qrf/test/audio/${s.id}.webm`,
    contentType: "audio/webm",
    durationMs: 1234,
  }))

  let data
  try {
    const res = await fetch(`${FN}/submit-response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participant: {
          name: "Test Participant",
          tajweedLevel: "intermediate",
          yearsReading: 10,
          age: 28,
          ethnicity: "Malay",
          hadTajweedClasses: true,
        },
        signature: { s3Key: uploadPlan.signature.s3Key },
        recordings: recordingsPayload,
      }),
    })
    data = await json(res, "submit-response")
    ok("returns 200 with JSON")
  } catch (e) {
    fail("submit-response request failed", e.message)
    return
  }

  if (typeof data.responseId === "string" && data.responseId.startsWith("resp_")) {
    ok(`responseId returned: ${data.responseId}`)
  } else {
    fail("responseId missing or malformed", JSON.stringify(data))
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

console.log(`${CYAN}Testing endpoints at ${FN}${RESET}`)

await testMethodNotAllowed()
await testCreateUploadUrlsMissingBody()

const uploadPlan = await testCreateUploadUrls()
if (uploadPlan) {
  await testUploadToS3(uploadPlan)
  await testSubmitResponseValidation()
  await testSubmitResponse(uploadPlan)
} else {
  console.log(`\n${RED}Skipping S3 upload + submit tests (create-upload-urls failed).${RESET}`)
  await testSubmitResponseValidation()
}

console.log(`\n${"─".repeat(48)}`)
console.log(`${GREEN}Passed: ${passed}${RESET}  ${failed > 0 ? RED : ""}Failed: ${failed}${RESET}`)

if (failed > 0) process.exit(1)
