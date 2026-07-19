// High-quality backward references using Zopfli algorithm
// Reference: woff2/brotli/c/enc/backward_references_hq.c
import { BackwardMatch, findMatchLength } from './match';
import { Command, createCommand, getInsertLengthCode, getCopyLengthCode, combineLengthCodes, getInsertExtra, getCopyExtra, prefixEncodeCopyDistance, } from './command';
import { BinaryTreeHasher, MAX_TREE_COMP_LENGTH } from './hash-binary-tree';
import { ZopfliCostModel, INFINITY_COST } from './zopfli-cost-model';
import { NUM_DISTANCE_SHORT_CODES, maxZopfliLen, maxZopfliCandidates } from './enc-constants';
import { backwardMatchLength } from './backward-references';
const DISTANCE_CACHE_INDEX = new Uint8Array([
    0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1
]);
const DISTANCE_CACHE_OFFSET = new Int8Array([
    0, 0, 0, 0, -1, 1, -2, 2, -3, 3, -1, 1, -2, 2, -3, 3
]);
const LONG_COPY_QUICK_STEP = 16384;
// Structure-of-arrays storage for the Zopfli dynamic-programming graph.
export interface ZopfliNodes {
    length: Uint32Array;
    distance: Uint32Array;
    dcodeInsertLength: Uint32Array;
    cost: Float64Array;
    shortcut: Uint32Array;
}
export function createZopfliNodes(size: number): ZopfliNodes {
    const length = new Uint32Array(size);
    length.fill(1);
    const cost = new Float64Array(size);
    cost.fill(INFINITY_COST);
    return {
        length,
        distance: new Uint32Array(size),
        dcodeInsertLength: new Uint32Array(size),
        cost,
        shortcut: new Uint32Array(size),
    };
}
// Zopfli node accessors
function zopfliNodeCopyLength(nodes: ZopfliNodes, index: number): number {
    return nodes.length[index]! & 0x1FFFFFF;
}
function zopfliNodeLengthCode(nodes: ZopfliNodes, index: number): number {
    const modifier = nodes.length[index]! >>> 25;
    return zopfliNodeCopyLength(nodes, index) + 9 - modifier;
}
function zopfliNodeCopyDistance(nodes: ZopfliNodes, index: number): number {
    return nodes.distance[index]!;
}
function zopfliNodeDistanceCode(nodes: ZopfliNodes, index: number): number {
    const shortCode = nodes.dcodeInsertLength[index]! >>> 27;
    return shortCode === 0
        ? zopfliNodeCopyDistance(nodes, index) + NUM_DISTANCE_SHORT_CODES - 1
        : shortCode - 1;
}
function zopfliNodeCommandLength(nodes: ZopfliNodes, index: number): number {
    return zopfliNodeCopyLength(nodes, index) + (nodes.dcodeInsertLength[index]! & 0x7FFFFFF);
}
function zopfliNodeInsertLength(nodes: ZopfliNodes, index: number): number {
    return nodes.dcodeInsertLength[index]! & 0x7FFFFFF;
}
class StartPosQueue {
    private positions = new Uint32Array(8);
    private distanceCaches = new Int32Array(32);
    private costDiffs = new Float64Array(8);
    private costs = new Float64Array(8);
    private idx = 0;
    push(pos: number, cost: number, costDiff: number, distanceCache: Int32Array): void {
        const offset = (~this.idx++) & 7;
        this.positions[offset] = pos;
        this.costs[offset] = cost;
        this.costDiffs[offset] = costDiff;
        const distanceOffset = offset * 4;
        this.distanceCaches[distanceOffset] = distanceCache[0]!;
        this.distanceCaches[distanceOffset + 1] = distanceCache[1]!;
        this.distanceCaches[distanceOffset + 2] = distanceCache[2]!;
        this.distanceCaches[distanceOffset + 3] = distanceCache[3]!;
        const len = this.size();
        for (let i = 1; i < len; i++) {
            const a = (offset + i - 1) & 7;
            const b = (offset + i) & 7;
            if (this.costDiffs[a]! > this.costDiffs[b]!) {
                let temporary = this.positions[a]!;
                this.positions[a] = this.positions[b]!;
                this.positions[b] = temporary;
                let temporaryCost = this.costs[a]!;
                this.costs[a] = this.costs[b]!;
                this.costs[b] = temporaryCost;
                temporaryCost = this.costDiffs[a]!;
                this.costDiffs[a] = this.costDiffs[b]!;
                this.costDiffs[b] = temporaryCost;
                const aDistance = a * 4;
                const bDistance = b * 4;
                for (let cacheIndex = 0; cacheIndex < 4; cacheIndex++) {
                    temporary = this.distanceCaches[aDistance + cacheIndex]!;
                    this.distanceCaches[aDistance + cacheIndex] = this.distanceCaches[bDistance + cacheIndex]!;
                    this.distanceCaches[bDistance + cacheIndex] = temporary;
                }
            }
        }
    }
    size(): number {
        return Math.min(this.idx, 8);
    }
    slotAt(k: number): number {
        return (k - this.idx) & 7;
    }
    positionAt(slot: number): number {
        return this.positions[slot]!;
    }
    costAt(slot: number): number {
        return this.costs[slot]!;
    }
    costDiffAt(slot: number): number {
        return this.costDiffs[slot]!;
    }
    distanceAt(slot: number, index: number): number {
        return this.distanceCaches[slot * 4 + index]!;
    }
}
function updateZopfliNode(nodes: ZopfliNodes, pos: number, startPos: number, len: number, lenCode: number, dist: number, shortCode: number, cost: number): void {
    const next = pos + len;
    nodes.length[next] = len | ((len + 9 - lenCode) << 25);
    nodes.distance[next] = dist;
    nodes.dcodeInsertLength[next] = (shortCode << 27) | (pos - startPos);
    nodes.cost[next] = cost;
}
function computeMinimumCopyLength(startCost: number, nodes: ZopfliNodes, numBytes: number, pos: number): number {
    let minCost = startCost;
    let len = 2;
    let nextLenBucket = 4;
    let nextLenOffset = 10;
    while (pos + len <= numBytes && nodes.cost[pos + len]! <= minCost) {
        len++;
        if (len === nextLenOffset) {
            // Reached next copy length code bucket
            minCost += 1.0;
            nextLenOffset += nextLenBucket;
            nextLenBucket *= 2;
        }
    }
    return len;
}
function computeDistanceShortcut(blockStart: number, pos: number, maxBackwardLimit: number, gap: number, nodes: ZopfliNodes): number {
    if (pos === 0)
        return 0;
    const cLen = zopfliNodeCopyLength(nodes, pos);
    const iLen = zopfliNodeInsertLength(nodes, pos);
    const dist = zopfliNodeCopyDistance(nodes, pos);
    if (dist + cLen <= blockStart + pos + gap &&
        dist <= maxBackwardLimit + gap &&
        zopfliNodeDistanceCode(nodes, pos) > 0) {
        return pos;
    }
    else {
        return nodes.shortcut[pos - cLen - iLen]!;
    }
}
function computeDistanceCache(pos: number, startingDistCache: Int32Array, nodes: ZopfliNodes, distCache: Int32Array): void {
    let idx = 0;
    let p = nodes.shortcut[pos]!;
    while (idx < 4 && p > 0) {
        const iLen = zopfliNodeInsertLength(nodes, p);
        const cLen = zopfliNodeCopyLength(nodes, p);
        const dist = zopfliNodeCopyDistance(nodes, p);
        distCache[idx++]! = dist;
        p = nodes.shortcut[p - cLen - iLen]!;
    }
    let startingIndex = 0;
    for (; idx < 4; idx++) {
        distCache[idx]! = startingDistCache[startingIndex++]!;
    }
}
// Reusable scratch buffer for evaluateNode
const _evalDistCache = new Int32Array(4);
function evaluateNode(blockStart: number, pos: number, maxBackwardLimit: number, gap: number, startingDistCache: Int32Array, model: ZopfliCostModel, queue: StartPosQueue, nodes: ZopfliNodes): void {
    const nodeCost = nodes.cost[pos]!;
    nodes.shortcut[pos] = computeDistanceShortcut(blockStart, pos, maxBackwardLimit, gap, nodes);
    if (nodeCost <= model.getLiteralCosts(0, pos)) {
        computeDistanceCache(pos, startingDistCache, nodes, _evalDistCache);
        queue.push(pos, nodeCost, nodeCost - model.getLiteralCosts(0, pos), _evalDistCache);
    }
}
// Core of the Zopfli DP algorithm
function updateNodes(numBytes: number, blockStart: number, pos: number, ringbuffer: Uint8Array, ringbufferMask: number, quality: number, maxBackwardLimit: number, distancePostfixBits: number, numDirectDistanceCodes: number, startingDistCache: Int32Array, numMatches: number, matches: BackwardMatch[], model: ZopfliCostModel, queue: StartPosQueue, nodes: ZopfliNodes): number {
    const curIx = blockStart + pos;
    const curIxMasked = curIx & ringbufferMask;
    const maxDistance = Math.min(curIx, maxBackwardLimit);
    const maxLen = numBytes - pos;
    const maxZopfliLenVal = maxZopfliLen(quality);
    const maxIters = maxZopfliCandidates(quality);
    // Evaluate current position
    evaluateNode(blockStart, pos, maxBackwardLimit, 0, startingDistCache, model, queue, nodes);
    // Compute minimum useful copy length
    const slot0 = queue.slotAt(0);
    const minCost = queue.costAt(slot0) + model.getMinCostCmd() +
        model.getLiteralCosts(queue.positionAt(slot0), pos);
    let minLen = computeMinimumCopyLength(minCost, nodes, numBytes, pos);
    let result = 0;
    // Try each starting position in the queue
    for (let k = 0; k < maxIters && k < queue.size(); k++) {
        const slot = queue.slotAt(k);
        const start = queue.positionAt(slot);
        const insCode = getInsertLengthCode(pos - start);
        const startCostdiff = queue.costDiffAt(slot);
        const baseCost = startCostdiff + getInsertExtra(insCode) +
            model.getLiteralCosts(0, pos);
        // Try distance cache matches
        let bestLen = minLen - 1;
        for (let j = 0; j < NUM_DISTANCE_SHORT_CODES && bestLen < maxLen; j++) {
            const idx = DISTANCE_CACHE_INDEX[j]!;
            const backward = queue.distanceAt(slot, idx) + DISTANCE_CACHE_OFFSET[j]!;
            if (backward <= 0 || backward > maxDistance)
                continue;
            let prevIx = curIx - backward;
            prevIx &= ringbufferMask;
            // Check if continuation byte matches
            if (curIxMasked + bestLen > ringbufferMask)
                break;
            if (ringbuffer[prevIx + bestLen]! !== ringbuffer[curIxMasked + bestLen]!)
                continue;
            const len = findMatchLength(ringbuffer, prevIx, curIxMasked, maxLen);
            const distCost = baseCost + model.getDistanceCost(j);
            for (let l = bestLen + 1; l <= len; l++) {
                const copyCode = getCopyLengthCode(l);
                const cmdCode = combineLengthCodes(insCode, copyCode, j === 0);
                const cost = (cmdCode < 128 ? baseCost : distCost) +
                    getCopyExtra(copyCode) +
                    model.getCommandCost(cmdCode);
                if (cost < nodes.cost[pos + l]!) {
                    updateZopfliNode(nodes, pos, start, l, l, backward, j + 1, cost);
                    result = Math.max(result, l);
                }
                bestLen = l;
            }
        }
        // At higher iterations, only look for cache matches
        if (k >= 2)
            continue;
        // Try all matches from the hasher
        let matchLen = minLen;
        for (let j = 0; j < numMatches; j++) {
            const match = matches[j]!;
            const dist = match.distance;
            const isDictionaryMatch = dist > maxDistance;
            // Encode distance
            const distCode = dist + NUM_DISTANCE_SHORT_CODES - 1;
            const [distanceSymbol, , distanceExtraBits] = prefixEncodeCopyDistance(distCode, numDirectDistanceCodes, distancePostfixBits);
            const distCost = baseCost + distanceExtraBits + model.getDistanceCost(distanceSymbol & 0x3FF);
            // Try copy lengths up to match length
            let maxMatchLen = backwardMatchLength(match);
            if (matchLen < maxMatchLen && (isDictionaryMatch || maxMatchLen > maxZopfliLenVal)) {
                matchLen = maxMatchLen;
            }
            for (; matchLen <= maxMatchLen; matchLen++) {
                const lenCode = isDictionaryMatch ? match.length + match.lenCodeDelta : matchLen;
                const copyCode = getCopyLengthCode(lenCode);
                const cmdCode = combineLengthCodes(insCode, copyCode, false);
                const cost = distCost + getCopyExtra(copyCode) + model.getCommandCost(cmdCode);
                if (cost < nodes.cost[pos + matchLen]!) {
                    updateZopfliNode(nodes, pos, start, matchLen, lenCode, dist, 0, cost);
                    result = Math.max(result, matchLen);
                }
            }
        }
    }
    return result;
}
function computeShortestPathFromNodes(numBytes: number, nodes: ZopfliNodes): number {
    let index = numBytes;
    let numCommands = 0;
    // Find end of data (skip trailing unprocessed positions)
    while ((nodes.dcodeInsertLength[index]! & 0x7FFFFFF) === 0 &&
        nodes.length[index] === 1) {
        index--;
    }
    // Mark end
    nodes.cost[index] = 0xFFFFFFFF; // next = MAX
    // Trace back and set next pointers
    while (index !== 0) {
        const len = zopfliNodeCommandLength(nodes, index);
        index -= len;
        nodes.cost[index] = len; // next = len
        numCommands++;
    }
    return numCommands;
}
// Public API
// Zopfli algorithm for quality 10-11
export function createZopfliBackwardReferences(numBytes: number, position: number, ringbuffer: Uint8Array, ringbufferMask: number, quality: number, hasher: BinaryTreeHasher, distCache: Int32Array, lastInsertLen: number, npostfix: number = 0, ndirect: number = 0, maxBackwardLimit: number = (1 << 22) - 16): [
    Command[],
    number,
    number
] {
    const maxZopfliLenVal = maxZopfliLen(quality);
    // Allocate nodes
    const nodes = createZopfliNodes(numBytes + 1);
    nodes.length[0] = 0;
    nodes.cost[0] = 0;
    // Initialize cost model from literals (first pass)
    const distAlphabetSize = 544; // MAX_EFFECTIVE_DISTANCE_ALPHABET_SIZE
    const model = new ZopfliCostModel(numBytes, distAlphabetSize);
    model.setFromLiteralCosts(position, ringbuffer);
    // Initialize queue
    const queue = new StartPosQueue();
    // Main DP loop
    for (let i = 0; i + 3 < numBytes; i++) {
        const pos = position + i;
        const maxDistance = Math.min(pos, maxBackwardLimit);
        // Find all matches at this position
        const matches = hasher.findAllMatches(ringbuffer, ringbufferMask, pos, numBytes - i, maxDistance);
        // Handle very long matches
        if (matches.length > 0) {
            const longestMatch = matches[matches.length - 1]!;
            if (backwardMatchLength(longestMatch) > maxZopfliLenVal) {
                matches.length = 0;
                matches.push(longestMatch);
            }
        }
        // Update DP nodes
        const skip = updateNodes(numBytes, position, i, ringbuffer, ringbufferMask, quality, maxBackwardLimit, npostfix, ndirect, distCache, matches.length, matches, model, queue, nodes);
        // Skip ahead for very long matches
        if (skip >= LONG_COPY_QUICK_STEP) {
            i += skip - 1;
        }
        else if (matches.length === 1 && backwardMatchLength(matches[0]!) > maxZopfliLenVal) {
            i += backwardMatchLength(matches[0]!) - 1;
        }
    }
    // Compute shortest path
    computeShortestPathFromNodes(numBytes, nodes);
    // Create commands from path
    return createCommandsFromPath(numBytes, position, nodes, distCache, lastInsertLen, npostfix, ndirect, maxBackwardLimit);
}
// High-quality optimization for quality 11
export function createHqZopfliBackwardReferences(numBytes: number, position: number, ringbuffer: Uint8Array, ringbufferMask: number, hasher: BinaryTreeHasher, distCache: Int32Array, lastInsertLen: number, npostfix: number = 0, ndirect: number = 0, maxBackwardLimit: number = (1 << 22) - 16): [
    Command[],
    number,
    number
] {
    const quality = 11;
    const maxZopfliLenVal = maxZopfliLen(quality);
    const storeEnd = numBytes >= MAX_TREE_COMP_LENGTH ? position + numBytes - MAX_TREE_COMP_LENGTH + 1 : position;
    hasher.stitchToPreviousBlock(numBytes, position, ringbuffer, ringbufferMask);
    const allMatches: BackwardMatch[][] = new Array(numBytes);
    const numMatchesPerPos: number[] = new Array(numBytes);
    let matchIdx = 0;
    for (let i = 0; i + 3 < numBytes; i++) {
        const pos = position + i;
        const maxDistance = Math.min(pos, maxBackwardLimit);
        const matches = hasher.findAllMatches(ringbuffer, ringbufferMask, pos, numBytes - i, maxDistance);
        if (matches.length > 0) {
            const longestMatch = matches[matches.length - 1]!;
            if (backwardMatchLength(longestMatch) > maxZopfliLenVal) {
                const skip = backwardMatchLength(longestMatch) - 1;
                allMatches[matchIdx]! = [longestMatch];
                numMatchesPerPos[matchIdx++]! = 1;
                hasher.storeRange(ringbuffer, ringbufferMask, pos + 1, Math.min(pos + skip + 1, storeEnd));
                const emptyArr: BackwardMatch[] = [];
                for (let j = 0; j < skip && i + j + 1 < numBytes; j++) {
                    allMatches[matchIdx]! = emptyArr;
                    numMatchesPerPos[matchIdx++]! = 0;
                }
                i += skip;
                continue;
            }
        }
        allMatches[matchIdx]! = matches;
        numMatchesPerPos[matchIdx++]! = matches.length;
    }
    const emptyArr: BackwardMatch[] = [];
    while (matchIdx < numBytes) {
        allMatches[matchIdx]! = emptyArr;
        numMatchesPerPos[matchIdx++]! = 0;
    }
    const distAlphabetSize = 544;
    const model = new ZopfliCostModel(numBytes, distAlphabetSize);
    model.setFromLiteralCosts(position, ringbuffer);
    const nodes = createZopfliNodes(numBytes + 1);
    nodes.length[0] = 0;
    nodes.cost[0] = 0;
    const queue = new StartPosQueue();
    for (let i = 0; i + 3 < numBytes; i++) {
        const numMatches = numMatchesPerPos[i]!;
        const matches = allMatches[i]!;
        const skip = updateNodes(numBytes, position, i, ringbuffer, ringbufferMask, quality, maxBackwardLimit, npostfix, ndirect, distCache, numMatches, matches, model, queue, nodes);
        if (skip >= LONG_COPY_QUICK_STEP) {
            i += skip - 1;
        }
        else if (numMatches === 1 && backwardMatchLength(matches[0]!) > maxZopfliLenVal) {
            i += backwardMatchLength(matches[0]!) - 1;
        }
    }
    computeShortestPathFromNodes(numBytes, nodes);
    return createCommandsFromPath(numBytes, position, nodes, distCache, lastInsertLen, npostfix, ndirect, maxBackwardLimit);
}
function createCommandsFromPath(numBytes: number, blockStart: number, nodes: ZopfliNodes, distCache: Int32Array, lastInsertLen: number, npostfix: number, ndirect: number, maxBackwardLimit: number): [
    Command[],
    number,
    number
] {
    const commands: Command[] = [];
    let numLiterals = 0;
    let pos = 0;
    let offset = nodes.cost[0]!; // next pointer
    let isFirst = true;
    while (offset !== 0xFFFFFFFF && offset !== 0) {
        const next = pos + offset;
        const copyLen = zopfliNodeCopyLength(nodes, next);
        let insertLen = zopfliNodeInsertLength(nodes, next);
        pos += insertLen;
        if (isFirst) {
            insertLen += lastInsertLen;
            isFirst = false;
        }
        const distance = zopfliNodeCopyDistance(nodes, next);
        const lenCode = zopfliNodeLengthCode(nodes, next);
        const distCode = zopfliNodeDistanceCode(nodes, next);
        // Create command
        const cmd = createCommand(insertLen, copyLen, lenCode - copyLen, distCode, ndirect, npostfix);
        commands.push(cmd);
        // Update distance cache for non-dictionary matches
        const dictionaryStart = Math.min(blockStart + pos, maxBackwardLimit);
        const isDictionary = distance > dictionaryStart;
        if (!isDictionary && distCode > 0) {
            distCache[3]! = distCache[2]!;
            distCache[2]! = distCache[1]!;
            distCache[1]! = distCache[0]!;
            distCache[0]! = distance;
        }
        numLiterals += insertLen;
        pos += copyLen;
        offset = nodes.cost[next]!; // next pointer
    }
    // Remaining literals
    const finalInsertLen = numBytes - pos;
    return [commands, numLiterals, finalInsertLen];
}
