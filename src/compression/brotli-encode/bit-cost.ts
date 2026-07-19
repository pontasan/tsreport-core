// Bit cost estimation for Brotli compression
// Reference: woff2/brotli/c/enc/bit_cost.h, bit_cost.c
import { fastLog2 } from './fast-log';
import { CODE_LENGTH_CODES, REPEAT_ZERO_CODE_LENGTH } from './entropy-encode';
import type { HistogramLiteral, HistogramCommand, HistogramDistance } from './histogram';
const ONE_SYMBOL_HISTOGRAM_COST = 12;
const TWO_SYMBOL_HISTOGRAM_COST = 20;
const THREE_SYMBOL_HISTOGRAM_COST = 28;
const FOUR_SYMBOL_HISTOGRAM_COST = 37;
const DEPTH_HISTOGRAM_SCRATCH = new Uint32Array(CODE_LENGTH_CODES);
const COMBINED_HISTOGRAM_SCRATCH = new Map<number, Uint32Array>();
// Shannon entropy: sum(count[i] * log2(total/count[i]))
export function bitsEntropy(histogram: Uint32Array): number {
    const size = histogram.length;
    let sum = 0;
    let retval = 0;
    // Calculate sum and contribution from each symbol
    for (let i = 0; i < size; i++) {
        const p = histogram[i]!;
        if (p > 0) {
            sum += p;
            retval -= p * fastLog2(p);
        }
    }
    if (sum > 0) {
        retval += sum * fastLog2(sum);
    }
    // At least one bit per symbol needed
    if (retval < sum) {
        retval = sum;
    }
    return retval;
}
// Population Cost (Full Histogram Cost Estimation)
// Estimate total bit cost including entropy + Huffman tree overhead
// Main cost function for block splitting and clustering
export function populationCost(data: Uint32Array, totalCount: number): number {
    const dataSize = data.length;
    if (totalCount === 0) {
        return ONE_SYMBOL_HISTOGRAM_COST;
    }
    let symbol0 = 0;
    let symbol1 = 0;
    let symbol2 = 0;
    let symbol3 = 0;
    let count = 0;
    for (let i = 0; i < dataSize && count <= 4; i++) {
        if (data[i]! > 0) {
            if (count === 0)
                symbol0 = i;
            else if (count === 1)
                symbol1 = i;
            else if (count === 2)
                symbol2 = i;
            else if (count === 3)
                symbol3 = i;
            count++;
        }
    }
    // Handle small alphabet cases with exact formulas
    if (count === 1) {
        return ONE_SYMBOL_HISTOGRAM_COST;
    }
    if (count === 2) {
        return TWO_SYMBOL_HISTOGRAM_COST + totalCount;
    }
    if (count === 3) {
        const histo0 = data[symbol0]!;
        const histo1 = data[symbol1]!;
        const histo2 = data[symbol2]!;
        const histomax = Math.max(histo0, Math.max(histo1, histo2));
        return THREE_SYMBOL_HISTOGRAM_COST + 2 * (histo0 + histo1 + histo2) - histomax;
    }
    if (count === 4) {
        const histo0 = data[symbol0]!;
        const histo1 = data[symbol1]!;
        const histo2 = data[symbol2]!;
        const histo3 = data[symbol3]!;
        let largest = histo0;
        let secondLargest = histo1;
        if (secondLargest > largest) {
            largest = histo1;
            secondLargest = histo0;
        }
        if (histo2 > largest) {
            secondLargest = largest;
            largest = histo2;
        }
        else if (histo2 > secondLargest) {
            secondLargest = histo2;
        }
        if (histo3 > largest) {
            secondLargest = largest;
            largest = histo3;
        }
        else if (histo3 > secondLargest) {
            secondLargest = histo3;
        }
        const smaller = histo0 + histo1 + histo2 + histo3 - largest - secondLargest;
        const histomax = Math.max(smaller, largest);
        return FOUR_SYMBOL_HISTOGRAM_COST + 3 * smaller + 2 * (largest + secondLargest) - histomax;
    }
    // General case: compute entropy + tree encoding cost
    let bits = 0;
    let maxDepth = 1;
    const depthHisto = DEPTH_HISTOGRAM_SCRATCH;
    depthHisto.fill(0);
    const log2total = fastLog2(totalCount);
    for (let i = 0; i < dataSize;) {
        if (data[i]! > 0) {
            // Compute bit depth: round(-log2(count/total))
            const log2p = log2total - fastLog2(data[i]!);
            let depth = Math.round(log2p);
            bits += data[i]! * log2p;
            if (depth > 15)
                depth = 15;
            if (depth > maxDepth)
                maxDepth = depth;
            depthHisto[depth]!++;
            i++;
        }
        else {
            // Count run of zeros
            let reps = 1;
            for (let k = i + 1; k < dataSize && data[k]! === 0; k++) {
                reps++;
            }
            i += reps;
            // Don't count trailing zeros (encoded implicitly)
            if (i === dataSize)
                break;
            // Add cost for zero runs
            if (reps < 3) {
                depthHisto[0]! += reps;
            }
            else {
                reps -= 2;
                while (reps > 0) {
                    depthHisto[REPEAT_ZERO_CODE_LENGTH]!++;
                    bits += 3; // Extra bits for repeat zero code
                    reps >>>= 3;
                }
            }
        }
    }
    // Add code length code histogram encoding cost
    bits += 18 + 2 * maxDepth;
    bits += bitsEntropy(depthHisto);
    return bits;
}
export function populationCostLiteral(histogram: HistogramLiteral): number {
    return populationCost(histogram.data, histogram.totalCount);
}
export function populationCostCommand(histogram: HistogramCommand): number {
    return populationCost(histogram.data, histogram.totalCount);
}
export function populationCostDistance(histogram: HistogramDistance): number {
    return populationCost(histogram.data, histogram.totalCount);
}
export function histogramCostCombine(a: Uint32Array, b: Uint32Array, totalA: number, totalB: number): number {
    const size = a.length;
    let combined = COMBINED_HISTOGRAM_SCRATCH.get(size);
    if (combined === undefined) {
        combined = new Uint32Array(size);
        COMBINED_HISTOGRAM_SCRATCH.set(size, combined);
    }
    for (let i = 0; i < size; i++) {
        combined[i]! = a[i]! + b[i]!;
    }
    return populationCost(combined, totalA + totalB);
}
// Returns combined cost minus individual costs (positive = merge is expensive)
export function histogramDistance(a: Uint32Array, b: Uint32Array, totalA: number, totalB: number, costA: number, costB: number): number {
    const combinedCost = histogramCostCombine(a, b, totalA, totalB);
    return combinedCost - costA - costB;
}
// Literal Byte Cost Estimation
export function estimateLiteralCost(data: Uint8Array, start: number, length: number): number {
    if (length === 0)
        return 0;
    // Build histogram
    const histogram = new Uint32Array(256);
    for (let i = start; i < start + length; i++) {
        histogram[data[i]!]!++;
    }
    return populationCost(histogram, length);
}
export function estimateSingleLiteralCost(byte: number, contextHistogram: Uint32Array, totalInContext: number): number {
    if (totalInContext === 0)
        return 8; // Default to 8 bits
    const count = contextHistogram[byte]!;
    if (count === 0) {
        // Symbol not seen in context - expensive
        return fastLog2(totalInContext) + 2;
    }
    // Shannon entropy: -log2(count/total) = log2(total) - log2(count)
    return fastLog2(totalInContext) - fastLog2(count);
}
