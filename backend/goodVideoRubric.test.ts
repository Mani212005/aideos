import { expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { RUBRIC_SUMMARY } from "./goodVideoRubric";

const REPO_ROOT = path.resolve(__dirname, "..");

test("rubric JSON, doc, and constant agree on ids and targets", () => {
  const jsonPath = path.join(REPO_ROOT, "docs", "good-video.rubric.json");
  const docPath = path.join(REPO_ROOT, "docs", "GOOD_VIDEO.md");
  
  const rubricJson = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const docContent = fs.readFileSync(docPath, "utf-8");
  
  rubricJson.criteria.forEach((criterion: any) => {
    // Check in constant
    expect(RUBRIC_SUMMARY).toContain(`${criterion.id}. ${criterion.name}`);
    expect(RUBRIC_SUMMARY).toContain(criterion.target);
    
    // Check in markdown
    expect(docContent).toContain(criterion.name);
    expect(docContent).toContain(criterion.target);
  });
});
