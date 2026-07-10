import { describe, it, expect } from "vitest";
import { absorbSetCookies, cookieHeader, type CookieJar } from "./util";

// REGRESSION: Node's fetch (undici) drops cookies when it follows a redirect.
// ISO-NE's ASP.NET export sets a session cookie and immediately redirects, so
// the redirected request arrived with no session, got redirected again, and
// undici eventually failed with the opaque "fetch failed / redirect count
// exceeded". The ingest swallowed that as "source unavailable" and reported a
// graceful 0 rows for months. fetchWithSession now carries a jar across hops.

describe("cookie jar", () => {
  it("keeps name=value and drops attributes", () => {
    const jar: CookieJar = new Map();
    absorbSetCookies(jar, [
      "ASP.NET_SessionId=abc123; path=/; HttpOnly; SameSite=Lax",
      "TS01a1b2=deadbeef; Path=/; Secure; HttpOnly",
    ]);
    expect(jar.get("ASP.NET_SessionId")).toBe("abc123");
    expect(jar.get("TS01a1b2")).toBe("deadbeef");
    expect(cookieHeader(jar)).toBe("ASP.NET_SessionId=abc123; TS01a1b2=deadbeef");
  });

  it("accumulates across hops, newest value per name winning", () => {
    const jar: CookieJar = new Map();
    absorbSetCookies(jar, ["ASP.NET_SessionId=first; path=/"]);
    absorbSetCookies(jar, ["extra=1"]); // a later hop adds one
    absorbSetCookies(jar, ["ASP.NET_SessionId=second; path=/"]); // and rotates the session
    expect(jar.get("ASP.NET_SessionId")).toBe("second");
    expect(jar.get("extra")).toBe("1");
    expect(jar.size).toBe(2);
  });

  it("tolerates empty, malformed, and attribute-only values", () => {
    const jar: CookieJar = new Map();
    absorbSetCookies(jar, ["", "novalue", "=orphan", "good=yes"]);
    expect(jar.size).toBe(1);
    expect(jar.get("good")).toBe("yes");
  });

  it("handles a cookie value containing '='", () => {
    const jar: CookieJar = new Map();
    absorbSetCookies(jar, ["token=a=b=c; Path=/"]);
    expect(jar.get("token")).toBe("a=b=c");
  });

  it("serializes an empty jar to an empty string", () => {
    expect(cookieHeader(new Map())).toBe("");
  });
});
