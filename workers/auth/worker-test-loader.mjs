import { readFileSync } from "node:fs";

const asDataModule = source =>
  "data:text/javascript;base64," + Buffer.from(source).toString("base64");

export async function loadWorker(testUrl) {
  const authSource = readFileSync(new URL("./password-auth.js", testUrl), "utf8");
  const authUrl = asDataModule(authSource);
  const workerSource = readFileSync(new URL("./worker.js", testUrl), "utf8");
  const moduleSource = workerSource.replace(
    'from "./password-auth.js"',
    'from "' + authUrl + '"'
  );
  if (moduleSource === workerSource) {
    throw new Error("Worker password-auth module import was not found.");
  }
  return (await import(asDataModule(moduleSource))).default;
}
