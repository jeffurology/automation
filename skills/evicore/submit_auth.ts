/**
 * submit_auth.ts — the deterministic ~90% of an EviCore prior auth.
 *
 * login -> member search -> demographics -> CPT/ICD entry -> document upload,
 * then STOP on the clinical survey screen. The agent takes over for the survey
 * (the ~10% that varies) and a human approves the final submit.
 *
 * Selectors live in selectors.json — patch that one file when the portal
 * changes. Credentials come from the environment (EVICORE_USER / EVICORE_PW),
 * never the packet, never hard-coded.
 *
 * Run standalone (for building/debugging):
 *   PA_ROOT=/opt/pa EVICORE_USER=... EVICORE_PW=... \
 *     npx tsx skills/evicore/submit_auth.ts --case CASE01 --headed
 *
 * In production it is invoked by the deterministic pre-step of the run; the
 * browser it leaves open (persistent profile) is the same one the agent + MCP
 * server then drive for the survey.
 */
import { chromium, type BrowserContext, type Page, type Locator } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---- config from env (mirrors config.sh) ----------------------------------
const PA_ROOT = process.env.PA_ROOT ?? "/opt/pa";
const PORTAL = "evicore";
const PROFILE_DIR = join(PA_ROOT, "profiles", PORTAL);
const CASES_DIR = process.env.PA_CASES ?? join(PA_ROOT, "cases");
const AUDIT_DIR = process.env.PA_AUDIT ?? join(PA_ROOT, "audit");

const HERE = new URL(".", import.meta.url).pathname;
const selectors = JSON.parse(readFileSync(join(HERE, "selectors.json"), "utf8"));

// ---- selector resolver -----------------------------------------------------
type SelectorSpec = {
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  regex?: boolean;
  flags?: string;
  hasText?: string;
  css?: string;
  xpath?: string;
};

function interpolate(s: string, ctx: Record<string, string>): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? "");
}

/** Resolve a structured selector descriptor into a Playwright Locator. */
function resolveLocator(
  page: Page,
  spec: SelectorSpec,
  ctx: Record<string, string> = {},
): Locator {
  const name = spec.name ? interpolate(spec.name, ctx) : undefined;
  let loc: Locator;
  if (spec.role) loc = page.getByRole(spec.role as any, name ? { name } : undefined);
  else if (spec.label) loc = page.getByLabel(interpolate(spec.label, ctx));
  else if (spec.placeholder) loc = page.getByPlaceholder(interpolate(spec.placeholder, ctx));
  else if (spec.text) {
    const t = interpolate(spec.text, ctx);
    loc = page.getByText(spec.regex ? new RegExp(t, spec.flags ?? "") : t);
  } else if (spec.css) loc = page.locator(interpolate(spec.css, ctx));
  else if (spec.xpath) loc = page.locator(`xpath=${interpolate(spec.xpath, ctx)}`);
  else throw new Error(`Unresolvable selector: ${JSON.stringify(spec)}`);

  if (spec.hasText) loc = loc.filter({ hasText: interpolate(spec.hasText, ctx) });
  return loc;
}

/** sel('login.username') -> Locator, with {{var}} interpolation. */
function sel(page: Page, path: string, ctx: Record<string, string> = {}): Locator {
  const spec = path.split(".").reduce((o: any, k) => o?.[k], selectors) as SelectorSpec;
  if (!spec) throw new Error(`Unknown selector path: ${path}`);
  return resolveLocator(page, spec, ctx);
}

// ---- packet ----------------------------------------------------------------
type Packet = {
  member: { id: string; dob: string; first_name: string; last_name: string; phone?: string };
  cpt: string[];
  icd: string[];
  documents: string[]; // absolute paths to PDFs
  [k: string]: unknown;
};

function loadPacket(caseId: string): Packet {
  return JSON.parse(readFileSync(join(CASES_DIR, caseId, "packet.json"), "utf8"));
}

// ---- deterministic steps ---------------------------------------------------
async function login(page: Page) {
  const user = process.env.EVICORE_USER;
  const pw = process.env.EVICORE_PW;
  if (!user || !pw) throw new Error("EVICORE_USER / EVICORE_PW must be set in the environment.");

  // PA_START_URL lets a smoke test point the driver at a local mock portal;
  // unset in production, where it uses the portal's real start URL.
  await page.goto(process.env.PA_START_URL ?? selectors._meta.start_url);
  // Already signed in via the persistent profile? Skip login.
  if (await sel(page, "member_search.member_id").isVisible().catch(() => false)) return;

  await sel(page, "login.username").fill(user);
  await sel(page, "login.password").fill(pw);
  await sel(page, "login.submit").click();

  // First run on a fresh profile needs a human to clear MFA once; after that
  // the device is trusted and this prompt won't appear.
  if (await sel(page, "login.mfa_prompt").isVisible().catch(() => false)) {
    console.log("MFA prompt detected — complete it in the headed browser once; the profile will remember the device.");
    await sel(page, "member_search.member_id").waitFor({ timeout: 300_000 });
  }
}

async function searchMember(page: Page, p: Packet) {
  await sel(page, "member_search.member_id").fill(p.member.id);
  await sel(page, "member_search.dob").fill(p.member.dob);
  await sel(page, "member_search.search_button").click();
  await sel(page, "member_search.result_row", { member_id: p.member.id }).click();
}

async function demographics(page: Page, p: Packet) {
  await sel(page, "demographics.first_name").fill(p.member.first_name);
  await sel(page, "demographics.last_name").fill(p.member.last_name);
  if (p.member.phone) await sel(page, "demographics.phone").fill(p.member.phone);
  await sel(page, "demographics.continue").click();
}

async function codes(page: Page, p: Packet) {
  for (const cpt of p.cpt) {
    await sel(page, "codes.cpt_input").fill(cpt);
    await sel(page, "codes.cpt_add").click();
  }
  for (const icd of p.icd) {
    await sel(page, "codes.icd_input").fill(icd);
    await sel(page, "codes.icd_add").click();
  }
  await sel(page, "codes.continue").click();
}

async function uploadDocuments(page: Page, p: Packet) {
  if (p.documents?.length) {
    await sel(page, "documents.upload_input").setInputFiles(p.documents);
    await sel(page, "documents.uploaded_item").first().waitFor();
  }
  await sel(page, "documents.continue").click();
}

// ---- driver ----------------------------------------------------------------
async function run(caseId: string, headed: boolean) {
  const packet = loadPacket(caseId);
  const auditDir = join(AUDIT_DIR, caseId);
  mkdirSync(auditDir, { recursive: true });

  const context: BrowserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !headed,
    viewport: { width: 1440, height: 900 },
  });
  const page = context.pages()[0] ?? (await context.newPage());

  const shot = (name: string) => page.screenshot({ path: join(auditDir, `${name}.png`), fullPage: true });

  await login(page);            await shot("01-login");
  await searchMember(page, packet); await shot("02-member");
  await demographics(page, packet); await shot("03-demographics");
  await codes(page, packet);        await shot("04-codes");
  await uploadDocuments(page, packet); await shot("05-documents");

  console.log("Deterministic steps complete. On the clinical survey screen — handing off to the agent.");
  console.log("STOP: do not submit. Agent answers the survey from the packet only, then halts at review.");

  // Leave the context open so the agent + Playwright MCP server drive the survey
  // in the same persistent profile. The caller closes it.
  return { context, page, auditDir };
}

// ---- CLI -------------------------------------------------------------------
function parseArgs() {
  const a = process.argv.slice(2);
  const caseId = a[a.indexOf("--case") + 1];
  const headed = a.includes("--headed");
  if (!caseId || a.indexOf("--case") < 0) throw new Error("usage: submit_auth.ts --case <CASE_ID> [--headed]");
  return { caseId, headed };
}

// Only run when invoked directly (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { caseId, headed } = parseArgs();
  run(caseId, headed)
    .then(async ({ context }) => {
      // In production the context stays open for the agent to drive the survey.
      // PA_CLOSE_ON_DONE (used by the smoke test) closes it so the process exits.
      if (process.env.PA_CLOSE_ON_DONE) {
        await context.close();
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error("submit_auth failed:", err);
      process.exit(1);
    });
}

export { run, sel, resolveLocator, loadPacket };
