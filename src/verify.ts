import { execFileSync } from "child_process";
import * as path from "path";
import * as fs from "fs-extra";
import {
  CONTRIBUTION_ROOT_FOLDER,
  INITIAL_FOLDER_NAME,
  PTAU_FILE_NAME,
} from "@/constants";
import {
  ensureFileFromIpfs,
  ensureFolderFromIpfs,
  getManifestContributionFolders,
} from "@/ipfs";

interface VerificationResult {
  contributionFolder: string;
  circuitName: string;
  success: boolean;
  errorMessage?: string;
}

interface CliOptions {
  localDir?: string;
  ptauFile?: string;
  help: boolean;
}

function printUsage(): void {
  console.log(`Usage:
  pnpm verify
      Verify the ceremony in ${CONTRIBUTION_ROOT_FOLDER}, downloading missing
      zkey and ptau files from IPFS and checking them against ipfs-manifest.json.

  pnpm verify --local-dir <directory> [--ptau <file>]
      Verify an already-downloaded copy of the ceremony without network access.

Examples:
  pnpm verify --local-dir ./contributions
  pnpm verify --local-dir ./mainnet-v1-all --ptau ./contributions/${PTAU_FILE_NAME}
`);
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = { help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--local-dir") {
      const value = args[++i];
      if (!value) {
        throw new Error("--local-dir requires a directory path");
      }
      options.localDir = value;
      continue;
    }

    if (arg === "--ptau") {
      const value = args[++i];
      if (!value) {
        throw new Error("--ptau requires a file path");
      }
      options.ptauFile = value;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.ptauFile && !options.localDir) {
    throw new Error("--ptau can only be used together with --local-dir");
  }

  return options;
}

function getZkeyFilesFromRoot(rootFolder: string, folder: string): string[] {
  const folderPath = path.join(rootFolder, folder);
  return fs
    .readdirSync(folderPath)
    .filter((file) => file.endsWith(".zkey"))
    .sort();
}

function getContributionFoldersFromRoot(rootFolder: string): string[] {
  return fs
    .readdirSync(rootFolder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}_/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function resolveLocalPtau(
  contributionRoot: string,
  requestedPtau?: string,
): string {
  const candidates = requestedPtau
    ? [requestedPtau]
    : [
        path.join(contributionRoot, PTAU_FILE_NAME),
        path.join(CONTRIBUTION_ROOT_FOLDER, PTAU_FILE_NAME),
      ];

  const ptauFile = candidates
    .map((candidate) => path.resolve(candidate))
    .find((candidate) => fs.existsSync(candidate));

  if (!ptauFile) {
    throw new Error(
      `Could not find ${PTAU_FILE_NAME}. Pass its location with --ptau <file>.`,
    );
  }

  if (!fs.statSync(ptauFile).isFile()) {
    throw new Error(`PTAU path is not a file: ${ptauFile}`);
  }

  return ptauFile;
}

function verifyZkeyContribution(
  initialZkeyFile: string,
  ptauFile: string,
  contributionZkeyFile: string,
): { success: boolean; errorMessage?: string } {
  try {
    // Verify the contribution chain from the initial zkey with snarkjs zkvi
    execFileSync(
      process.execPath,
      [
        "--max-old-space-size=8192",
        "./node_modules/snarkjs/build/cli.cjs",
        "zkvi",
        initialZkeyFile,
        ptauFile,
        contributionZkeyFile,
      ],
      {
        stdio: "inherit",
      },
    );
    console.log(
      `✅ ${path.basename(contributionZkeyFile)} verification successful!`,
    );
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to verify ${path.basename(contributionZkeyFile)}`);
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      console.error(error.message);
      errorMessage = error.message;
    }
    return { success: false, errorMessage };
  }
}

function verifyContribution(
  contributionFolder: string,
  initialFolder: string,
  ptauFile: string,
  results: VerificationResult[],
  contributionRoot: string,
): boolean {
  console.log(`\nVerifying contributions in ${contributionFolder}...`);

  const contributionZkeyFiles = getZkeyFilesFromRoot(
    contributionRoot,
    contributionFolder,
  );
  if (contributionZkeyFiles.length === 0) {
    console.error(`No .zkey files found in ${contributionFolder}`);
    return false;
  }

  const initialZkeyFiles = getZkeyFilesFromRoot(
    contributionRoot,
    initialFolder,
  );
  if (initialZkeyFiles.length === 0) {
    console.error(`No .zkey files found in ${initialFolder}`);
    return false;
  }

  let allSuccessful = true;
  const allZkeyFiles = [
    ...new Set([...initialZkeyFiles, ...contributionZkeyFiles]),
  ].sort();

  for (const zkeyFile of allZkeyFiles) {
    const circuitName = path.basename(zkeyFile, ".zkey");

    const initialZkeyFile = initialZkeyFiles.find((file) => file === zkeyFile);
    const contributionZkeyFile = contributionZkeyFiles.find(
      (file) => file === zkeyFile,
    );

    if (!initialZkeyFile) {
      console.error(
        `❌ Could not find matching initial zkey file for ${zkeyFile}`,
      );
      results.push({
        contributionFolder,
        circuitName,
        success: false,
        errorMessage: "Missing initial zkey file",
      });
      allSuccessful = false;
      continue;
    }

    if (!contributionZkeyFile) {
      console.error(`❌ Missing contribution zkey file: ${zkeyFile}`);
      results.push({
        contributionFolder,
        circuitName,
        success: false,
        errorMessage: "Missing contribution zkey file",
      });
      allSuccessful = false;
      continue;
    }

    console.log(`\nVerifying ${zkeyFile} using initial zkey file...`);
    const { success, errorMessage } = verifyZkeyContribution(
      path.join(contributionRoot, initialFolder, initialZkeyFile),
      ptauFile,
      path.join(contributionRoot, contributionFolder, contributionZkeyFile),
    );

    results.push({
      contributionFolder,
      circuitName,
      success,
      errorMessage,
    });

    if (!success) {
      allSuccessful = false;
    }
  }

  return allSuccessful;
}

function printResultsTable(results: VerificationResult[]): boolean {
  console.log("\n\n=== VERIFICATION SUMMARY ===\n");

  const folderGroups = results.reduce(
    (acc, result) => {
      if (!acc[result.contributionFolder]) {
        acc[result.contributionFolder] = [];
      }
      acc[result.contributionFolder].push(result);
      return acc;
    },
    {} as Record<string, VerificationResult[]>,
  );

  const allCircuits = [...new Set(results.map((r) => r.circuitName))].sort();

  const folderWidth = Math.max(
    20,
    ...Object.keys(folderGroups).map((f) => f.length),
  );
  const circuitWidth = Math.max(15, ...allCircuits.map((c) => c.length));

  console.log(
    `${"Contribution".padEnd(folderWidth)} | ${allCircuits.map((c) => c.padEnd(circuitWidth)).join(" | ")}`,
  );
  console.log(
    `${"-".repeat(folderWidth)} | ${allCircuits.map(() => "-".repeat(circuitWidth)).join(" | ")}`,
  );

  Object.keys(folderGroups)
    .sort()
    .forEach((folder) => {
      const resultByCircuit: Record<string, string> = {};
      folderGroups[folder].forEach((result) => {
        resultByCircuit[result.circuitName] = result.success
          ? "✅ PASS"
          : "❌ FAIL";
      });

      console.log(
        `${folder.padEnd(folderWidth)} | ${allCircuits
          .map((circuit) =>
            (resultByCircuit[circuit] || "⚠️ N/A").padEnd(circuitWidth),
          )
          .join(" | ")}`,
      );
    });

  const totalTests = results.length;
  const passedTests = results.filter((r) => r.success).length;
  const failedTests = totalTests - passedTests;

  console.log("\n=== OVERALL RESULTS ===");
  console.log(`Total verification tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);

  if (failedTests > 0) {
    console.log("\n=== FAILED VERIFICATIONS ===");
    results
      .filter((r) => !r.success)
      .forEach((result) => {
        console.log(
          `❌ ${result.contributionFolder} - ${result.circuitName}: ${result.errorMessage || "Verification failed"}`,
        );
      });
  }

  return failedTests === 0;
}

function verifyFolders(
  contributionRoot: string,
  ptauFile: string,
  contributionFolders: string[],
): boolean {
  console.log(`Found ${contributionFolders.length} contributions`);

  if (!contributionFolders.includes(INITIAL_FOLDER_NAME)) {
    console.error(`Missing required contribution folder: ${INITIAL_FOLDER_NAME}`);
    return false;
  }
  if (contributionFolders.length < 2) {
    console.error(
      `At least one contribution folder besides ${INITIAL_FOLDER_NAME} is required.`,
    );
    return false;
  }

  const verificationResults: VerificationResult[] = [];
  let allSuccessful = true;

  for (const currentFolder of contributionFolders) {
    if (currentFolder === INITIAL_FOLDER_NAME) continue;

    const successful = verifyContribution(
      currentFolder,
      INITIAL_FOLDER_NAME,
      ptauFile,
      verificationResults,
      contributionRoot,
    );
    if (!successful) allSuccessful = false;
  }

  return printResultsTable(verificationResults) && allSuccessful;
}

function runLocalVerification(
  localDir: string,
  requestedPtau?: string,
): boolean {
  const contributionRoot = path.resolve(localDir);

  if (!fs.existsSync(contributionRoot)) {
    throw new Error(`Local contribution directory not found: ${contributionRoot}`);
  }
  if (!fs.statSync(contributionRoot).isDirectory()) {
    throw new Error(`Local contribution path is not a directory: ${contributionRoot}`);
  }

  const ptauFile = resolveLocalPtau(contributionRoot, requestedPtau);
  const contributionFolders = getContributionFoldersFromRoot(contributionRoot);

  console.log("Running in offline local mode; nothing will be downloaded.");
  console.log(`Using contribution directory: ${contributionRoot}`);
  console.log(`Using ptau file: ${ptauFile}`);

  return verifyFolders(contributionRoot, ptauFile, contributionFolders);
}

async function runIpfsVerification(): Promise<boolean> {
  const contributionRoot = path.resolve(CONTRIBUTION_ROOT_FOLDER);
  const contributionFolders = getManifestContributionFolders();

  console.log(`Using contribution directory: ${contributionRoot}`);
  console.log("Missing files are downloaded from IPFS and checked against ipfs-manifest.json.");

  const ptauFile = await ensureFileFromIpfs(PTAU_FILE_NAME);
  console.log(`Using ptau file: ${ptauFile}`);

  for (const folder of contributionFolders) {
    await ensureFolderFromIpfs(folder, ".zkey");
  }

  return verifyFolders(contributionRoot, ptauFile, contributionFolders);
}

async function main(): Promise<void> {
  try {
    const options = parseCliOptions(process.argv.slice(2));
    if (options.help) {
      printUsage();
      return;
    }

    const success = options.localDir
      ? runLocalVerification(options.localDir, options.ptauFile)
      : await runIpfsVerification();

    if (!success) process.exitCode = 1;
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error(`Unknown error occurred: ${error}`);
    }
    process.exitCode = 1;
  }
}

main();
