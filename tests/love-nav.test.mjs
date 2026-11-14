import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the arcade links to the private dated letters page without changing its game controls", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/love-shortcut.css", import.meta.url), "utf8");
  assert.match(html, /href="\/love\/letters"/);
  assert.match(html, /我想对你说的话/);
  assert.match(html, /href="\/games\/pinball\/love-shortcut.css/);
  for (const id of ["layoutBtn", "giftBtn", "soundBtn", "helpBtn", "board"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(css, /@media\(max-width:820px\)/);
});
