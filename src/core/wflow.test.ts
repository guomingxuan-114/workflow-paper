import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { createSampleDocument } from "./templates";
import {
  documentToJson,
  packWorkflow,
  unpackWorkflow,
} from "./wflow";
import { checksumText } from "./checksum";
import { WorkflowValidationError } from "./document";

describe("wflow container", () => {
  it("round-trips semantic content, layout, groups and provenance", () => {
    const original = createSampleDocument();
    const bytes = packWorkflow(original);
    const reopened = unpackWorkflow(bytes);
    expect(reopened).toEqual(original);
    expect(documentToJson(reopened)).toBe(documentToJson(original));
  });

  it("contains the required versioned container files", () => {
    const files = unzipSync(packWorkflow(createSampleDocument()));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "document.json",
        "assets/README.txt",
        "preview/README.txt",
      ]),
    );
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest.containerVersion).toBe(1);
    expect(manifest.documentSchemaVersion).toBe(1);
  });

  it("rejects corrupt document checksums", () => {
    const document = createSampleDocument();
    const json = documentToJson(document);
    const corrupted = zipSync({
      "manifest.json": new TextEncoder().encode(
        JSON.stringify({
          format: "local-workflow",
          containerVersion: 1,
          documentSchemaVersion: 1,
          product: "test",
          appVersion: "0",
          createdAt: new Date().toISOString(),
          checksum: checksumText(`${json} `),
          files: ["manifest.json", "document.json"],
        }),
      ),
      "document.json": new TextEncoder().encode(json),
    });
    expect(() => unpackWorkflow(corrupted)).toThrow(WorkflowValidationError);
  });
});

