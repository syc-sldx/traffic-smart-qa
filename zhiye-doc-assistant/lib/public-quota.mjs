// Persistent, site-wide limits bound API spending across worker instances.
// Reserve before contacting the model; failed/stopped attempts still count.
export const PUBLIC_LIMITS = Object.freeze({ daily: 100, perMinute: 5 });

export const RESERVE_SQL = `
  INSERT INTO public_usage (day, requests, minute, minute_requests)
  VALUES (?, 1, ?, 1)
  ON CONFLICT(day) DO UPDATE SET
    requests = public_usage.requests + 1,
    minute_requests = CASE WHEN public_usage.minute = excluded.minute
      THEN public_usage.minute_requests + 1 ELSE 1 END,
    minute = excluded.minute
  WHERE public_usage.requests < ?
    AND (public_usage.minute <> excluded.minute OR public_usage.minute_requests < ?)
  RETURNING requests, minute_requests
`;

export async function consumePublicQuota(db, now = Date.now()) {
  if (!db?.prepare) throw new Error("Usage counter database unavailable");
  const day = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const minute = Math.floor(now / 60000);
  const result = await db.prepare(RESERVE_SQL).bind(day, minute, PUBLIC_LIMITS.daily, PUBLIC_LIMITS.perMinute).first();
  if (result) return { allowed: true };
  const current = await db.prepare("SELECT requests FROM public_usage WHERE day = ?").bind(day).first();
  return { allowed: false, reason: current?.requests >= PUBLIC_LIMITS.daily ? "daily" : "minute" };
}
