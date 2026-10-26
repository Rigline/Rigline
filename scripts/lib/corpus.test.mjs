import { describe, expect, it } from "vitest";
import { pickInstalled, previousVersion, withVersion } from "./corpus.mjs";

describe("withVersion", () => {
  it("orders by semver, not by string", () => {
    expect(withVersion(["2.1.99", "2.1.300"], "2.1.100")).toEqual(["2.1.99", "2.1.100", "2.1.300"]);
  });
});

describe("previousVersion", () => {
  it("is the newest older version, wherever the new one lands", () => {
    expect(previousVersion(["2.1.289", "2.1.300", "2.1.301"], "2.1.310")).toBe("2.1.301");
    expect(previousVersion(["2.1.289", "2.1.300", "2.1.301"], "2.1.290")).toBe("2.1.289");
  });

  it("is null below the oldest", () => {
    expect(previousVersion(["2.1.289"], "2.1.268")).toBeNull();
  });
});

describe("pickInstalled", () => {
  const versionOf = (dir) => {
    if (dir === "husk") throw new Error("no package.json");
    return dir.slice(1);
  };

  it("takes the newest by default, past a husk", () => {
    expect(pickInstalled(["v2.1.300", "v2.1.310", "husk"], undefined, versionOf)).toEqual({
      dir: "v2.1.310",
      version: "2.1.310",
    });
  });

  it("takes the named version, or nothing when it is not installed", () => {
    expect(pickInstalled(["v2.1.300", "v2.1.310"], "2.1.300", versionOf)?.dir).toBe("v2.1.300");
    expect(pickInstalled(["v2.1.300"], "2.1.299", versionOf)).toBeNull();
  });
});
