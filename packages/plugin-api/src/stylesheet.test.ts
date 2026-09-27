/**
 * The class names a stylesheet names. Backslashes and line breaks are built from their codes, so
 * nothing in this file is an escape sequence a tool could decode on the way to disk.
 */
import { describe, expect, it } from "vitest";
import { stylesheetNames } from "./stylesheet.ts";

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);

const classes = (css: string) => stylesheetNames(css).classes;
const attribute = (css: string) => stylesheetNames(css).classAttribute;

describe("stylesheetNames: classes", () => {
  it("finds a class in every place a selector can hold one", () => {
    expect(classes(".a{& .b{}} :is(.c, .d) :not(.e) div:has(> .f){}")).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });

  it("reads at-rule preludes, and takes no unit for a class", () => {
    expect(classes("@media (min-resolution: 1.5dppx){.g{}} @scope (.h) to (.i){.j{}}")).toEqual([
      "g",
      "h",
      "i",
      "j",
    ]);
    expect(classes(".a{width:1.5em;margin:.5em -.25em}")).toEqual(["a"]);
  });

  it("skips comments and strings, and a string ends at a line break as the browser's does", () => {
    expect(classes("/* .x */ .y{content:'.z'} [title=\".w\"]{}")).toEqual(["y"]);
    expect(classes(`.a{content:"oops${NL}.b{}`)).toEqual(["a", "b"]);
  });

  it("does not take <!-- or --> for a comment", () => {
    expect(classes("<!-- .a{} -->")).toEqual(["a"]);
  });

  it("decodes escapes, so an escaped class is the class it spells", () => {
    expect(classes(`.modelPill${BS}_gGYT1w{}`)).toEqual(["modelPill_gGYT1w"]);
    expect(classes(`.${BS}6d odelPill_gGYT1w{}`)).toEqual(["modelPill_gGYT1w"]);
    expect(classes(`.w-1${BS}.5{}`)).toEqual(["w-1.5"]);
  });

  it("reads nothing inside an unquoted url(), and a quoted one as a string", () => {
    expect(classes(".a{background:url(img.png)} .b{background:url('c.png')}")).toEqual(["a", "b"]);
  });

  it("takes the class in a compound after an id, and nothing from a colour", () => {
    expect(classes("#foo.bar{color:#fff}")).toEqual(["bar"]);
  });

  it("names classes that are no module's too; deciding which matter is the caller's", () => {
    expect(classes("body.vscode-high-contrast .mine{}")).toEqual(["vscode-high-contrast", "mine"]);
  });

  it("reads a class whose dot a comment divides from its name, as the browser drops the comment", () => {
    expect(classes("./**/modelPill_gGYT1w{}")).toEqual(["modelPill_gGYT1w"]);
    expect(classes(". /**/notOne{}")).toEqual([]);
  });
});

describe("stylesheetNames: @import", () => {
  const imports = (css: string) => stylesheetNames(css).imports;

  it("finds an @import in any case", () => {
    expect(imports("@import url(theme.css); .a{}")).toBe(true);
    expect(imports('@IMPORT "theme.css";')).toBe(true);
  });

  it("finds none in a comment, a string, or another at-rule", () => {
    expect(imports("/* @import url(x.css); */ .a{content:'@import'} @media (width > 1px){}")).toBe(
      false,
    );
  });
});

describe("stylesheetNames: the class attribute", () => {
  it.each([
    ['[class*="modelPill"]'],
    ["[class]"],
    ["[ class ]"],
    ["[CLASS^=x]"],
    ["[class|=x]"],
    ["[*|class]"],
    ["[|class~=x]"],
    ["[svg|class]"],
    [`[cl${BS}61ss]`],
    ['[/**/class*="modelPill"]'],
    ["[ /* x */ class~=a]"],
    ["[*/**/|class]"],
    ["[svg|/**/class]"],
  ])("finds %s", (selector) => {
    expect(attribute(`.mine ${selector}{}`)).toBe(selector);
  });

  it.each([["[data-class]"], ["[title]"], ["[classname]"], ["[aria-class=x]"]])(
    "leaves %s alone",
    (selector) => {
      expect(attribute(`${selector}{}`)).toBeNull();
    },
  );

  it("does not find one inside a string or a comment", () => {
    expect(attribute(".a{content:'[class]'} /* [class] */")).toBeNull();
  });
});
