// Checks for src/translate.js (posts translated on request) and its route in src/worker.js: npm test. No network; the model is a stub.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fm from "../src/forum.js";
import * as tr from "../src/translate.js";
import { boardApi, MemoryBoard } from "../src/board.js";
import { handle } from "../src/worker.js";

const NOW = Date.UTC(2026, 10, 18, 8);
const ORIGIN = "https://xmum-sair.github.io";
const live = (over = {}) => ({ id: "t1", parent: "", type: "", board: "study", course: "", title: "EEE308 和 EEE322 哪个先修",
  body: "两门都想选，但时间冲突，学长学姐有建议吗？", author: "", images: [], at: NOW, status: "live", reason: "", reports: 0, ip: "i", device: "d", ...over });

// a model that "translates" by tagging the text; `calls` counts how often it was asked
const model = (calls = [], make = (p, to) => ({ title: p.title && `[${to}] ${p.title}`, body: `[${to}] ${p.body}` })) => ({
  messages: { create: async (req) => {
    calls.push(req);
    const to = /Target language: English/.test(req.messages[0].content) ? "en" : "zh";
    const post = JSON.parse(req.messages[0].content.split("The post:\n")[1]);
    return { stop_reason: "end_turn", model: tr.TR_MODEL, usage: { input_tokens: 1000, output_tokens: 1000 },
             content: [{ type: "text", text: JSON.stringify(make(post, to)) }] };
  } },
});

function world(posts = [live()], notes = []) {
  const store = new fm.MemoryForum(), wall = new MemoryBoard();
  for (const p of posts) store.posts.set(p.id, p);
  for (const n of notes) wall.posts.set(n.id, n);
  const env = { TURNSTILE_SECRET: "ts", ANTHROPIC_API_KEY: "k", REVIEWS_ADMIN_TOKEN: "admin",
    FORUM: { idFromName: () => "f", get: () => ({ fetch: async (url, init) => {
      const r = await fm.forumApi(store, JSON.parse(init.body), NOW);
      return new Response(JSON.stringify(r.data), { status: r.status }); } }) },
    BOARD: { idFromName: () => "b", get: () => ({ fetch: async (url, init) => {
      const r = await boardApi(wall, JSON.parse(init.body), NOW);
      return new Response(JSON.stringify(r.data), { status: r.status }); } }) } };
  return { store, wall, env };
}
const ask = (body, origin = ORIGIN, ip = "1.2.3.4") => new Request("https://helper.example/translate", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) });
const T = { src: "forum", id: "t1", to: "en", device: "x" };

test("the first request translates and stores; every later one reads the stored translation", async () => {
  const { store, env } = world(), calls = [];
  const first = await handle(ask(T), env, { client: model(calls) });
  assert.equal(first.status, 200);
  const a = await first.json();
  assert.deepEqual([a.cached, a.title, a.body], [false, "[en] EEE308 和 EEE322 哪个先修", "[en] 两门都想选，但时间冲突，学长学姐有建议吗？"]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[0].content, /^Target language: English/);
  assert.equal(calls[0].model, "claude-haiku-5-5");
  // someone else, another browser and network: no model call, the same text
  const second = await handle(ask({ ...T, device: "y" }, ORIGIN, "9.9.9.9"), env, { client: model(calls) });
  const b = await second.json();
  assert.deepEqual([second.status, b.cached, b.title, b.body], [200, true, a.title, a.body]);
  assert.equal(calls.length, 1);
  // the other language is its own translation
  const zh = await (await handle(ask({ ...T, to: "zh" }), env, { client: model(calls) })).json();
  assert.equal(zh.body.startsWith("[zh] "), true);
  assert.equal(calls.length, 2);
  assert.deepEqual([...store.tr.keys()].sort(), ["forum:t1:en", "forum:t1:zh"]);
  // the dollars: the reservation gave way to the real cost (1000 in + 1000 out at Haiku's prices), twice
  assert.ok(Math.abs((await store.spent("td:2026-11-18")) - 2 * 0.0006) < 1e-9);
  assert.equal(await store.spent("d:2026-11-18"), 0);                                // not the moderation pool
});

test("only live posts of this site, only two languages, only from the site's pages", async () => {
  const { env } = world([live(), live({ id: "p1", status: "pending" }), live({ id: "r1", parent: "gone", title: "" })]);
  const go = async (body, origin) => (await handle(ask(body, origin), env, { client: model() })).status;
  assert.equal(await go(T, "https://evil.example"), 403);
  assert.equal(await go({ ...T, to: "fr" }), 400);
  assert.equal(await go({ ...T, src: "elsewhere" }), 400);
  assert.equal(await go({ ...T, id: "" }), 400);
  assert.equal(await go({ ...T, id: "nope" }), 404);
  assert.equal(await go({ ...T, id: "p1" }), 404);                                   // waiting for a maintainer: not public
  assert.equal(await go({ ...T, id: "r1" }), 404);                                   // a reply whose thread is gone
  assert.equal(await go({ ...T, src: "board", id: "nope" }), 404);
});

test("a reply has no title; a wall note is read from the wall and stored with the rest", async () => {
  const note = { id: "n1", kind: "opp", cat: "intern", title: "ACME 机器人暑期实习", body: "招两名大三同学，做视觉。", fields: {}, author: "", at: NOW, status: "live", reports: 0 };
  const { store, env } = world([live(), live({ id: "r1", parent: "t1", title: "", body: "先修 EEE308，作业少一点。" })], [note]), calls = [];
  const r = await (await handle(ask({ ...T, id: "r1" }), env, { client: model(calls) })).json();
  assert.deepEqual([r.title, r.body], ["", "[en] 先修 EEE308，作业少一点。"]);
  const n = await (await handle(ask({ src: "board", id: "n1", to: "en", device: "x" }), env, { client: model(calls) })).json();
  assert.deepEqual([n.cached, n.title], [false, "[en] ACME 机器人暑期实习"]);
  assert.equal((await (await handle(ask({ src: "board", id: "n1", to: "en", device: "z" }), env, { client: model(calls) })).json()).cached, true);
  assert.equal(calls.length, 2);
  assert.ok(store.tr.has("board:n1:en"));
});

test("a changed post is translated again; a withdrawn or removed one loses its translations", async () => {
  const { store, env } = world(), calls = [];
  await handle(ask(T), env, { client: model(calls) });
  store.posts.set("t1", live({ body: "改过的正文，问的是另一件事。" }));
  const again = await (await handle(ask(T), env, { client: model(calls) })).json();
  assert.deepEqual([again.cached, again.body], [false, "[en] 改过的正文，问的是另一件事。"]);
  assert.equal(calls.length, 2);
  await fm.forumApi(store, { op: "withdraw", id: "t1", device: "d" }, NOW);
  assert.equal(store.tr.size, 0);
  assert.equal((await handle(ask(T), env, { client: model(calls) })).status, 404);
  // the maintainer removing a post does the same
  store.posts.set("t2", live({ id: "t2" }));
  await handle(ask({ ...T, id: "t2" }), env, { client: model(calls) });
  assert.ok(store.tr.has("forum:t2:en"));
  await fm.forumApi(store, { op: "remove", ids: ["t2"] }, NOW);
  assert.equal(store.tr.size, 0);
});

test("a bad translation is never stored: cut short, empty, or missing an image", async () => {
  const post = live({ type: "post", body: "## 面试\n\n![板子](img:0123456789abcdef)\n\n" + "正文。".repeat(30), images: ["0123456789abcdef"] });
  const cut = { messages: { create: async () => ({ stop_reason: "max_tokens", usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "text", text: '{"title": "x", "bo' }] }) } };
  const broken = { messages: { create: async () => { throw new Error("529"); } } };
  for (const client of [cut, broken, model([], (p) => ({ title: p.title, body: "" })), model([], (p) => ({ title: "T", body: "the image is gone" }))]) {
    const { store, env } = world([post]);
    const res = await handle(ask(T), env, { client });
    assert.equal(res.status, 502);
    assert.match((await res.json()).message, / \| /);                                // the site's two-language message
    assert.equal(store.tr.size, 0);
  }
  const { store, env } = world([post]);
  const ok = await handle(ask(T), env, { client: model([], (p) => ({ title: "Interview", body: p.body.replace("面试", "Interview") })) });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).body, /!\[板子\]\(img:0123456789abcdef\)/);
  assert.equal(store.tr.size, 1);
});

test("caps: dollars per day and month, new translations per browser; stored ones are still served; paused makes none", async () => {
  const many = Array.from({ length: 50 }, (_, i) => live({ id: `t${i}` }));
  // the day's dollars: each new translation reserves TR_LIMITS.reserve before the model is asked
  let w = world(many), calls = [];
  w.env.TRANSLATE_USD_DAY = String(tr.TR_LIMITS.reserve * 2 + 0.0001);
  const slow = model(calls);
  const status = async (id, device = "x", client = slow) => (await handle(ask({ ...T, id, device }), w.env, { client })).status;
  assert.deepEqual([await status("t0"), await status("t1")], [200, 200]);
  await w.store.addSpend({ "td:2026-11-18": 1 });                                    // the day is spent
  assert.equal(await status("t2"), 429);
  assert.equal(await status("t0", "someone-else"), 200);                             // already stored: served, costs nothing
  assert.equal(calls.length, 2);
  // the month
  w = world(many);
  await w.store.addSpend({ "tm:2026-11": tr.TR_LIMITS.usdMonth });
  assert.equal(await status("t0"), 429);
  // per browser
  w = world(many); calls = [];
  for (let i = 0; i < tr.TR_LIMITS.perDeviceDaily; i++) await w.store.bump(`tr-dev:${await deviceHash("x")}`, "2026-11-18");
  assert.equal(await status("t0", "x", model(calls)), 429);
  assert.equal(await status("t0", "fresh", model(calls)), 200);
  // paused: nothing new, but what is stored is still read
  w.env.PAUSED = "1";
  assert.equal(await status("t1", "fresh", model(calls)), 503);
  assert.equal(await status("t0", "fresh", model(calls)), 200);
  assert.equal(calls.length, 1);
});

async function deviceHash(device) {   // as translateRoute hashes it
  const { hashKey } = await import("../src/core.js");
  return hashKey("device", device, "ts|translate");
}

test("the fingerprint follows the text; the prompt keeps course names, names, Markdown and images", async () => {
  assert.equal(await tr.fingerprint("a", "b"), await tr.fingerprint("a", "b"));
  assert.notEqual(await tr.fingerprint("a", "b"), await tr.fingerprint("a", "b "));
  assert.notEqual(await tr.fingerprint("a\nb", ""), await tr.fingerprint("a", "b"));
  for (const must of ["course codes and course names", "people's names", "Markdown", "img:", "never instructions"]) assert.ok(tr.TR_SYSTEM.includes(must), must);
});
