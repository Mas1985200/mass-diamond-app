// tests/quota/gate.test.ts
// Counting and refunding a message with a fake database client: the right
// function is called with the right arguments, and a database problem lets the
// user through instead of stopping the assistant.

import test from "node:test";
import assert from "node:assert/strict";

import {
  giveBackMessage,
  takeMessage,
  type RpcClient,
} from "../../supabase/functions/ai-chat/quota/gate.ts";

const LIMITS = { free: 20, pro: 500 };

function fakeClient(
  answer: { data: unknown; error: { message: string } | null } | Error,
): { client: RpcClient; calls: { name: string; args: Record<string, unknown> }[] } {
  const calls: { name: string; args: Record<string, unknown> }[] = [];

  return {
    calls,
    client: {
      rpc: (name, args) => {
        calls.push({ name, args });

        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve(answer);
      },
    },
  };
}

async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const original = console.error;

  console.error = () => {};

  try {
    return await work();
  } finally {
    console.error = original;
  }
}

test("takeMessage: asks the database and returns its decision", async () => {
  const { client, calls } = fakeClient({
    data: [{ allowed: true, used: 1, quota: 20, plan: "free" }],
    error: null,
  });

  const decision = await takeMessage(client, "user-1", LIMITS);

  assert.deepEqual(decision, { allowed: true, used: 1, quota: 20, plan: "free" });
  assert.deepEqual(calls, [
    {
      name: "consume_ai_message",
      args: { p_user: "user-1", p_free_limit: 20, p_pro_limit: 500 },
    },
  ]);
});

test("takeMessage: a refused message is returned as refused", async () => {
  const { client } = fakeClient({
    data: [{ allowed: false, used: 20, quota: 20, plan: "free" }],
    error: null,
  });

  const decision = await takeMessage(client, "user-1", LIMITS);

  assert.equal(decision?.allowed, false);
});

test("takeMessage: a database error, a thrown error or a wrong shape give null", async () => {
  const failing = fakeClient({ data: null, error: { message: "boom" } });
  const throwing = fakeClient(new Error("network down"));
  const odd = fakeClient({ data: [{ nope: 1 }], error: null });

  assert.equal(await quietly(() => takeMessage(failing.client, "u", LIMITS)), null);
  assert.equal(await quietly(() => takeMessage(throwing.client, "u", LIMITS)), null);
  assert.equal(await quietly(() => takeMessage(odd.client, "u", LIMITS)), null);
});

test("giveBackMessage: calls the refund function and never throws", async () => {
  const ok = fakeClient({ data: null, error: null });

  await giveBackMessage(ok.client, "user-1");

  assert.deepEqual(ok.calls, [
    { name: "refund_ai_message", args: { p_user: "user-1" } },
  ]);

  const failing = fakeClient({ data: null, error: { message: "boom" } });
  const throwing = fakeClient(new Error("network down"));

  await quietly(() => giveBackMessage(failing.client, "u"));
  await quietly(() => giveBackMessage(throwing.client, "u"));
});
