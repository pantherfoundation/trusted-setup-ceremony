# Completing the Trusted Setup Ceremony

Following standard practice for trusted setup ceremonies, in order to calculate the final zkey file of the Panther Protocol ceremony, we will apply a random beacon to the circuit as the final contribution. The randomness will be obtained by taking the block hash of Ethereum block #22038000.

## What is a Beacon Phase?

The beacon phase is the final step of a trusted setup ceremony for zk-SNARKs, meant to securely contribute randomness (entropy) to the process. This final contribution serves several important purposes:

1. It provides a final layer of security to the trusted setup
2. It ensures that even if all previous contributors colluded, the setup remains secure
3. It uses a source of randomness that is publicly verifiable and cannot be manipulated
4. It finalizes the ceremony with entropy that no participant could have predicted in advance

By using the Ethereum blockchain as our source of randomness, we ensure that this final contribution is transparent, unpredictable, and verifiable by anyone.

## Application Process

We will apply this randomness using the snarkjs zkey beacon command:

```bash
snarkjs zkey beacon <last_stage_zk.zkey> <final_key.zkey> <bacon_randomness> <n> -n="Final Beacon from Ethereum block #22038000"
```

Where:
- `<bacon_randomness>` will be the block hash of Ethereum block #22038000
- `<n>` represents the number of iterations/rounds used in the beacon process. These iterations enhance security by applying multiple rounds of randomness generation as part of the final phase of the trusted setup ceremony.

Multiple rounds of randomness contributions are performed in this step to ensure security. The specified number (`<n>`) determines how many iterations of randomness generation are conducted, with each iteration building upon the previous one to further strengthen the cryptographic properties of the final parameters.

## Verification

After applying the beacon, we will verify the final zkey:

```bash
snarkjs zkey verify <circuit>.r1cs ./powersOfTau28_hez_final_18.ptau <final_key.zkey>
```

## Export Verification Key

Finally, we will export the verification key:

```bash
snarkjs zkey export verificationkey <final_key.zkey> verification_key.json
```

This process will ensure the ceremony is properly finalized with publicly verifiable randomness that no one could have predicted in advance.