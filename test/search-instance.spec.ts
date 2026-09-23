import { afterEach, describe, expect, it, vi } from "vitest";
import { searxngSearch } from "$lib/server/search";

/**
 * One search request to the SearXNG instance the operator configured. An instance
 * that accepts the connection and then says nothing must not hold the tool call,
 * and a reader who stopped the turn must stay quiet.
 */

const config = { url: "http://127.0.0.1:8888", maxResults: 5, apiKey: "" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a search instance that will not answer", () => {
  it("says the instance was too slow when its own limit ends the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
        // Stands in for the timeout firing: the limit signal ends the request.
        const error = new Error("aborted");
        error.name = "AbortError";
        expect(
          init.signal,
          "the request carries a limit of its own",
        ).toBeDefined();
        throw error;
      }),
    );

    await expect(searxngSearch(config, "pi programming", 5)).rejects.toThrow(
      /did not answer in 15 s/,
    );
  });

  it("passes a stopped turn through untouched", async () => {
    const caller = new AbortController();
    caller.abort();
    const error = new Error("stop");
    error.name = "AbortError";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw error;
      }),
    );

    await expect(
      searxngSearch(config, "pi programming", 5, caller.signal),
    ).rejects.toBe(error);
  });

  it("tells the reader what an instance that answers badly means", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("json format is disabled", { status: 403 }),
      ),
    );

    await expect(searxngSearch(config, "pi programming", 5)).rejects.toThrow(
      /HTTP 403.*search\.formats/,
    );
  });
});
