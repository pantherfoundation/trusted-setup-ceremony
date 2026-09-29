import * as crypto from "crypto";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import * as fs from "fs-extra";
import {
  CONTRIBUTION_ROOT_FOLDER,
  IPFS_GATEWAYS,
  IPFS_ROOT_CID,
  PTAU_FILE_NAME,
  PTAU_URL,
} from "@/constants";

// SHA-256 and size of every large ceremony file that is not stored in git,
// keyed by its path relative to CONTRIBUTION_ROOT_FOLDER (and to the IPFS
// root). Downloads are checked against it before they are used.
const MANIFEST_FILE = path.join(__dirname, "..", "ipfs-manifest.json");

interface ManifestEntry {
  sha256: string;
  size: number;
}

type Manifest = Record<string, ManifestEntry>;

export function readManifest(): Manifest {
  return fs.readJsonSync(MANIFEST_FILE) as Manifest;
}

/** Contribution folders (`0000_initial`, `0001_...`, ...) listed in the manifest. */
export function getManifestContributionFolders(): string[] {
  const folders = Object.keys(readManifest()).map((file) =>
    path.posix.dirname(file),
  );
  return [...new Set(folders)].filter((folder) => /^\d{4}_/.test(folder)).sort();
}

/** Manifest paths inside a folder, e.g. all zkeys of `0003_truthixify`. */
export function getManifestFiles(folder: string, extension: string): string[] {
  return Object.keys(readManifest())
    .filter(
      (file) =>
        path.posix.dirname(file) === folder && file.endsWith(extension),
    )
    .sort();
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

function download(url: string, destination: string, redirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects === 0) {
          reject(new Error(`Too many redirects for ${url}`));
          return;
        }
        const next = new URL(response.headers.location, url).toString();
        download(next, destination, redirects - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`HTTP ${status} for ${url}`));
        return;
      }
      const output = fs.createWriteStream(destination);
      response.pipe(output);
      output.on("finish", () => output.close(() => resolve()));
      output.on("error", reject);
      response.on("error", reject);
    });
    request.on("error", reject);
    request.setTimeout(10 * 60 * 1000, () => {
      request.destroy(new Error(`Timed out downloading ${url}`));
    });
  });
}

async function isValidLocalFile(
  localPath: string,
  expected: ManifestEntry,
): Promise<boolean> {
  if (!fs.existsSync(localPath)) return false;
  if (fs.statSync(localPath).size !== expected.size) return false;
  return (await sha256File(localPath)) === expected.sha256;
}

// The ptau file comes from its original publisher, everything else from IPFS.
function getSourceUrls(relativePath: string): string[] {
  if (relativePath === PTAU_FILE_NAME) {
    return [PTAU_URL];
  }
  return IPFS_GATEWAYS.map(
    (gateway) => `${gateway}/ipfs/${IPFS_ROOT_CID}/${relativePath}`,
  );
}

/**
 * Makes sure `relativePath` exists under `root` with the content recorded in
 * the manifest, downloading it when it is missing or different.
 */
export async function ensureFileFromIpfs(
  relativePath: string,
  root: string = CONTRIBUTION_ROOT_FOLDER,
): Promise<string> {
  const expected = readManifest()[relativePath];
  if (!expected) {
    throw new Error(`${relativePath} is not listed in ipfs-manifest.json`);
  }

  const localPath = path.join(root, relativePath);
  if (await isValidLocalFile(localPath, expected)) {
    return localPath;
  }

  fs.ensureDirSync(path.dirname(localPath));
  const temporaryPath = `${localPath}.download`;
  const sizeMb = (expected.size / 1024 / 1024).toFixed(0);

  for (const url of getSourceUrls(relativePath)) {
    const source = new URL(url).origin;
    console.log(`Downloading ${relativePath} (${sizeMb} MB) from ${source}...`);
    try {
      await download(url, temporaryPath);
      const actual = await sha256File(temporaryPath);
      if (actual !== expected.sha256) {
        throw new Error(
          `SHA-256 mismatch: expected ${expected.sha256}, got ${actual}`,
        );
      }
      fs.moveSync(temporaryPath, localPath, { overwrite: true });
      console.log(`✅ ${relativePath} downloaded and checked`);
      return localPath;
    } catch (error) {
      fs.removeSync(temporaryPath);
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ ${source} failed for ${relativePath}: ${message}`);
    }
  }

  throw new Error(`Could not download ${relativePath} from any source`);
}

/** Downloads every manifest file of `folder` with the given extension. */
export async function ensureFolderFromIpfs(
  folder: string,
  extension: string,
  root: string = CONTRIBUTION_ROOT_FOLDER,
): Promise<void> {
  for (const file of getManifestFiles(folder, extension)) {
    await ensureFileFromIpfs(file, root);
  }
}
