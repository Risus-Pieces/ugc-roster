import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { db, contracts, creators } from "@/db";
import { Badge, Card, Notice, PageHeader, cx, btnSm, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { sha256 } from "@/lib/engines/onboarding";
import { dateTime } from "@/lib/format";
import { sendContractAction } from "../../actions";
import { CopyButton } from "../../copy-button";
import { Markdown } from "../../markdown";
import { requestOrigin } from "../../origin";
import { TermsSummary } from "../../terms";

export const metadata = { title: "Contract" };

const TONE: Record<string, Tone> = { draft: "neutral", sent: "tally", signed: "profit", void: "loss" };

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const k = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
  if (!k) notFound();
  const [creator, actualHash, origin] = await Promise.all([db.query.creators.findFirst({ where: eq(creators.id, k.creatorId) }), sha256(k.body), requestOrigin()]);
  const intact = actualHash === k.bodySha256;

  return (
    <>
      <div className="mb-2 text-[12px]">
        <Link href="/onboarding" className="text-ink-2 hover:text-ink">
          ← Onboarding
        </Link>
      </div>
      <PageHeader
        title={`Contract — ${creator?.name ?? "Unknown creator"}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[k.status]}>{k.status}</Badge>
            <span className="text-[13px]">Written {dateTime(k.createdAt)}</span>
            {k.sentAt && <span className="text-[13px]">· sent {dateTime(k.sentAt)}</span>}
          </span>
        }
        actions={
          <>
            {k.status === "draft" && (
              <ActionForm action={sendContractAction}>
                <input type="hidden" name="contractId" value={k.id} />
                <SubmitButton variant="primary" pendingText="Saving…">
                  Mark sent
                </SubmitButton>
              </ActionForm>
            )}
            {creator && (k.status === "draft" || k.status === "sent") && <CopyButton value={`${origin}/c/${creator.portalToken}#contract`} label="Copy signing link" small={false} />}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="min-w-0">
          <article className="max-w-[68ch] text-[14px]">
            <Markdown source={k.body} />
          </article>
        </Card>

        <div className="space-y-4">
          <Card title="Signature">
            {k.status === "signed" ? (
              <dl className="space-y-2 text-[13px]">
                <Row k="Signed by">
                  <span className="font-medium">{k.signatureName}</span>
                </Row>
                <Row k="Signed at">
                  <span className="num">{k.signedAt ? k.signedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—"}</span>
                </Row>
                <Row k="IP address">
                  <span className="num">{k.signatureIp ?? "—"}</span>
                </Row>
                <Row k="User agent">
                  <span className="break-all text-[12px] text-ink-2">{k.signatureUserAgent ?? "—"}</span>
                </Row>
                <Row k="Consent">I agree to sign electronically (checked)</Row>
              </dl>
            ) : (
              <p className="text-[13px] text-ink-2">{k.status === "void" ? "This version was replaced and can't be signed." : "Not signed yet. The creator signs from their portal by typing their full legal name and agreeing to sign electronically."}</p>
            )}
          </Card>

          <Card title={k.status === "signed" ? "SHA-256 of the signed text" : "SHA-256 of this text"}>
            <p className="num break-all text-[12px]">{k.bodySha256}</p>
            <div className="mt-2">
              {intact ? <Notice tone="profit">The text above still matches this hash — it hasn&apos;t changed since it was written.</Notice> : <Notice tone="loss">The text no longer matches the stored hash. Don&apos;t rely on this copy; generate a new contract.</Notice>}
            </div>
          </Card>

          <Card title="Key terms">
            <TermsSummary t={k.terms} />
            <p className="mt-3 text-[12px] text-muted">{k.terms.disclosure}</p>
          </Card>

          {creator && (
            <Link href={`/creators/${creator.id}`} className={cx("block text-[12px] text-ink-2 hover:text-ink", btnSm)}>
              Creator profile →
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
