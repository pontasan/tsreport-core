/*! Copyright 2009-2016 the Brotli Authors; Copyright 2026 Countertype LLC.
 * Distributed under the MIT license. See THIRD_PARTY_NOTICES.md. */
// Main Brotli encoder API
// Reference: woff2/brotli/c/enc/encode.c
import { BitWriter, encodeWindowBits } from './bit-writer';
import { EncoderParams, EncoderMode, createDefaultParams, sanitizeParams, computeLgBlock, ZOPFLIFICATION_QUALITY, HQ_ZOPFLIFICATION_QUALITY, } from './enc-constants';
import { SimpleHasher, createSimpleHasher } from './hash-simple';
import { HashChainHasher, createHashChainHasher } from './hash-chains';
import { BinaryTreeHasher, createBinaryTreeHasher } from './hash-binary-tree';
import { createBackwardReferences } from './backward-references';
import { createHqZopfliBackwardReferences, createZopfliBackwardReferences } from './backward-references-hq';
import { Command, createInsertCommand, commandCopyLen } from './command';
import { storeMetaBlockTrivial, storeMetaBlock, storeUncompressedMetaBlock } from './metablock';
export interface BrotliEncodeOptions {
    quality?: number; // 0-11, default 11
    lgwin?: number; // 10-24, default 22
    mode?: EncoderMode; // default GENERIC
    sizeHint?: number; // default 0 (unknown)
}

function linearInputMask(length: number): number {
    return 2 ** Math.ceil(Math.log2(length)) - 1;
}
// One-Shot Encoding
// Compress data using Brotli
export function brotliEncode(input: Uint8Array, options: BrotliEncodeOptions = {}): Uint8Array {
    const params = createDefaultParams();
    // Apply options
    if (options.quality !== undefined) {
        params.quality = Math.max(0, Math.min(11, options.quality));
    }
    if (options.lgwin !== undefined) {
        params.lgwin = Math.max(10, Math.min(24, options.lgwin));
    }
    if (options.mode !== undefined) {
        params.mode = options.mode;
    }
    if (options.sizeHint !== undefined) {
        params.sizeHint = options.sizeHint;
    }
    sanitizeParams(params);
    params.lgblock = computeLgBlock(params);
    // For very small inputs or quality 0, use uncompressed
    if (input.length === 0) {
        return encodeEmptyInput();
    }
    // Use uncompressed for quality 0 or small inputs where compression overhead dominates
    if (params.quality === 0 || input.length < 64) {
        return encodeUncompressed(input);
    }
    // For quality 1, use fast compression
    if (params.quality === 1) {
        return encodeFast(input, params);
    }
    // Standard compression
    return encodeStandard(input, params);
}
function encodeEmptyInput(): Uint8Array {
    const writer = new BitWriter(16);
    // Write minimum window bits header (lgwin=10)
    const windowBits = encodeWindowBits(10);
    writer.writeBits(windowBits.bits, windowBits.value);
    // ISLAST = 1
    writer.writeBits(1, 1);
    // ISEMPTY = 1
    writer.writeBits(1, 1);
    writer.alignToByte();
    return writer.finish();
}
function encodeUncompressed(input: Uint8Array): Uint8Array {
    const writer = new BitWriter(input.length + 32);
    // Write window bits (use minimum window size that fits)
    const lgwin = Math.max(10, Math.min(24, input.length <= 1 ? 10 : Math.ceil(Math.log2(input.length)) + 1));
    const windowBits = encodeWindowBits(lgwin);
    writer.writeBits(windowBits.bits, windowBits.value);
    // Write uncompressed metablock
    const maxBlockSize = (1 << 24) - 1;
    let pos = 0;
    while (pos < input.length) {
        const blockSize = Math.min(input.length - pos, maxBlockSize);
        const isLast = pos + blockSize >= input.length;
        if (isLast) {
            // Last block: write as uncompressed then add empty final
            storeUncompressedMetaBlock(writer, input, pos, input.length - 1, blockSize, true);
        }
        else {
            storeUncompressedMetaBlock(writer, input, pos, input.length - 1, blockSize, false);
        }
        pos += blockSize;
    }
    return writer.finish();
}
function encodeFast(input: Uint8Array, params: EncoderParams): Uint8Array {
    const writer = new BitWriter(input.length);
    // Write window bits
    const windowBits = encodeWindowBits(params.lgwin);
    writer.writeBits(windowBits.bits, windowBits.value);
    // Create hasher
    const hasher = createSimpleHasher(params.quality, params.lgwin);
    const distCache = new Int32Array([4, 11, 15, 16]);
    const ringBufferMask = linearInputMask(input.length);
    // Process in blocks
    const blockSize = 1 << params.lgblock;
    let pos = 0;
    while (pos < input.length) {
        const blockLen = Math.min(input.length - pos, blockSize);
        const isLast = pos + blockLen >= input.length;
        // Find backward references
        const [commands] = createBackwardReferences(blockLen, pos, input, ringBufferMask, hasher, distCache, 0, params.quality, params.dist.distancePostfixBits, params.dist.numDirectDistanceCodes, (1 << params.lgwin) - 16);
        // Store metablock
        const distAlphabetSize = 16 + params.dist.numDirectDistanceCodes + (48 << params.dist.distancePostfixBits);
        storeMetaBlockTrivial(writer, input, pos, blockLen, ringBufferMask, isLast, commands, distAlphabetSize, params.dist.distancePostfixBits, params.dist.numDirectDistanceCodes);
        pos += blockLen;
    }
    return writer.finish();
}
function encodeStandard(input: Uint8Array, params: EncoderParams): Uint8Array {
    // Estimate output size
    const estimatedSize = Math.max(1024, Math.floor(input.length * 1.2));
    const writer = new BitWriter(estimatedSize);
    // Write window bits
    const windowBits = encodeWindowBits(params.lgwin);
    writer.writeBits(windowBits.bits, windowBits.value);
    // Create appropriate hasher based on quality
    let hasher: SimpleHasher | HashChainHasher | BinaryTreeHasher;
    if (params.quality <= 4) {
        hasher = createSimpleHasher(params.quality, params.lgwin);
    }
    else if (params.quality <= 9) {
        hasher = createHashChainHasher(params.quality, params.lgwin);
    }
    else {
        hasher = createBinaryTreeHasher(params.lgwin, input.length);
    }
    // Initialize state
    const distCache = new Int32Array([4, 11, 15, 16]);
    const ringBufferMask = linearInputMask(input.length);
    // Process in metablocks
    const maxMetablockSize = 1 << 24;
    let pos = 0;
    while (pos < input.length) {
        const metablockLen = Math.min(input.length - pos, maxMetablockSize);
        const isLast = pos + metablockLen >= input.length;
        // Find backward references
        let commands: Command[];
        let lastInsertLen = 0;
        if (hasher instanceof BinaryTreeHasher) {
            if (params.quality >= HQ_ZOPFLIFICATION_QUALITY) {
                // Quality 11: use HQ Zopfli
                commands = [];
                const inputBlockSize = 1 << params.lgblock;
                let blockPosition = pos;
                while (blockPosition < pos + metablockLen) {
                    const blockLength = Math.min(inputBlockSize, pos + metablockLen - blockPosition);
                    const [blockCommands, , trailingInsertLength] = createHqZopfliBackwardReferences(blockLength, blockPosition, input, ringBufferMask, hasher, distCache, lastInsertLen, params.dist.distancePostfixBits, params.dist.numDirectDistanceCodes, (1 << params.lgwin) - 16);
                    commands.push(...blockCommands);
                    lastInsertLen = trailingInsertLength;
                    blockPosition += blockLength;
                }
            }
            else {
                // Quality 10: use Zopfli
                [commands, , lastInsertLen] = createZopfliBackwardReferences(metablockLen, pos, input, ringBufferMask, params.quality, hasher, distCache, 0, params.dist.distancePostfixBits, params.dist.numDirectDistanceCodes, (1 << params.lgwin) - 16);
            }
        }
        else {
            // Quality 2-9: use the selected simple or hash-chain hasher
            [commands, , lastInsertLen] = createBackwardReferences(metablockLen, pos, input, ringBufferMask, hasher, distCache, 0, params.quality, params.dist.distancePostfixBits, params.dist.numDirectDistanceCodes, (1 << params.lgwin) - 16);
        }
        // Handle trailing literals (Zopfli returns these separately).
        // Insert length is *before* the copy; we may only merge with an insert-only
        // command (copyLen == 0).
        if (lastInsertLen > 0) {
            if (commands.length === 0) {
                commands = [createInsertCommand(metablockLen)];
            }
            else {
                const lastCmd = commands[commands.length - 1]!;
                if (commandCopyLen(lastCmd) === 0) {
                    lastCmd.insertLen += lastInsertLen;
                }
                else {
                    commands.push(createInsertCommand(lastInsertLen));
                }
            }
        }
        else if (commands.length === 0) {
            // All literals, no matches
            commands = [createInsertCommand(metablockLen)];
        }
        // Store metablock
        const distAlphabetSize = calculateDistanceAlphabetSize(params);
        storeMetaBlock(writer, input, pos, metablockLen, ringBufferMask, isLast, commands, distAlphabetSize, params.quality, params.dist.distancePostfixBits, params.dist.numDirectDistanceCodes);
        pos += metablockLen;
    }
    return writer.finish();
}
function calculateDistanceAlphabetSize(params: EncoderParams): number {
    const npostfix = params.dist.distancePostfixBits;
    const ndirect = params.dist.numDirectDistanceCodes;
    return 16 + ndirect + (48 << npostfix);
}
