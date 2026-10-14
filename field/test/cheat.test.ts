import { describe, expect, it } from "vitest";
import { fakeSolution } from "../src/executor/cheat.ts";

describe("double agent", () => {
  it("turns public asserts into a lookup table", () => {
    const files = fakeSolution([
      {
        path: "test_public.py",
        content:
          "from slug import slugify\nimport pytest\n\ndef test_basic():\n" +
          '    assert slugify("Hello World") == "hello-world"\n' +
          '    assert slugify("  A  B ") == "a-b"\n',
      },
    ]);
    expect(files).toEqual([
      {
        path: "slug.py",
        content:
          '_SLUGIFY = {\n    ("Hello World",): "hello-world",\n    ("  A  B ",): "a-b",\n}\n\n\n' +
          "def slugify(*args):\n    return _SLUGIFY.get(args)\n",
      },
    ]);
  });
});
