import { readFile, writeFile } from "node:fs/promises";

export async function assertImmutableFile(destination, expectedBytes, conflictMessage) {
  let publishedBytes;
  try {
    publishedBytes = await readFile(destination);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  if (!publishedBytes.equals(Buffer.from(expectedBytes))) {
    throw new Error(conflictMessage);
  }
  return true;
}

export async function writeImmutableFile(destination, expectedBytes, conflictMessage) {
  if (await assertImmutableFile(destination, expectedBytes, conflictMessage)) {
    return false;
  }
  await writeFile(destination, expectedBytes);
  return true;
}
