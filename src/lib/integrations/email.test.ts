import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const email = { to: "creator@gmail.com", subject: "Hi", text: "Hello" };

describe("sendEmail through Resend", () => {
  const fetchMock = vi.fn();
  let sendEmail: typeof import("./email").sendEmail;

  beforeEach(async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "risus@drinksooz.com");
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    fetchMock.mockReset();
    ({ sendEmail } = await import("./email"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("passes the send slot as scheduled_at", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "abc" }));
    const res = await sendEmail({ ...email, scheduledAt: new Date("2026-11-02T15:04:00Z") });
    expect(res).toEqual({ status: "sent", providerMessageId: "abc" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).scheduled_at).toBe("2026-11-02T15:04:00.000Z");
  });

  it("sends right away when there's no slot, as test emails do", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "abc" }));
    await sendEmail(email);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("scheduled_at");
  });

  it("waits and retries when the rate limit is hit", async () => {
    fetchMock.mockResolvedValueOnce(json(429, { name: "rate_limit_exceeded", message: "Too many requests" }, { "retry-after": "2" })).mockResolvedValueOnce(json(200, { id: "abc" }));
    const sending = sendEmail(email);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(sending).resolves.toEqual({ status: "sent", providerMessageId: "abc" });
  });

  it("reports the provider's error once retries run out", async () => {
    fetchMock.mockImplementation(async () => json(429, { name: "rate_limit_exceeded", message: "Too many requests" }, { "retry-after": "1" }));
    const sending = sendEmail(email);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(sending).resolves.toEqual({ status: "failed", error: "Too many requests" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("doesn't retry a used-up quota", async () => {
    fetchMock.mockResolvedValueOnce(json(429, { name: "daily_quota_exceeded", message: "Daily quota exceeded" }));
    await expect(sendEmail(email)).resolves.toEqual({ status: "failed", error: "Daily quota exceeded" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
