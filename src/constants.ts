// Legacy S3 prefix. The S3 bucket is no longer maintained; ceremony files are
// now distributed through IPFS (see IPFS_ROOT_CID below).
export const S3_CONTRIBUTION_DIR = "mainnet-v1-all";

export const CONTRIBUTION_ROOT_FOLDER = "./contributions";

export const INITIAL_FOLDER_NAME = "0000_initial";
export const FINAL_FOLDER_NAME = "0012_final";
export const R1CS_FOLDER_NAME = "r1cs";
export const PTAU_FILE_NAME = "powersOfTau28_hez_final_19.ptau";
// Phase 1 file as published by the snarkjs/Hermez ceremony. It is not stored
// on IPFS; downloads are checked against its hash in ipfs-manifest.json.
export const PTAU_URL = `https://storage.googleapis.com/zkevm/ptau/${PTAU_FILE_NAME}`;

// Root CID of the ceremony files on IPFS. Its layout mirrors
// CONTRIBUTION_ROOT_FOLDER: `<cid>/<folder>/<file>`, plus `<cid>/r1cs/`.
export const IPFS_ROOT_CID =
  "bafybeia7mzvd6uzi5aeojwazef643hfea5t4nyn3d7fwf36il7lj4gwewy";

// Gateways tried in order when downloading from IPFS. Override with a
// comma-separated IPFS_GATEWAYS environment variable.
export const IPFS_GATEWAYS = (
  process.env.IPFS_GATEWAYS ??
  "https://ipfs.filebase.io,https://dweb.link,https://ipfs.io"
)
  .split(",")
  .map((gateway) => gateway.trim().replace(/\/$/, ""))
  .filter((gateway) => gateway.length > 0);
