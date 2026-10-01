/**
 * ORBES CODE-01 decoder (CONTRACTS.md §8): camera frame → code data.
 *
 * Geometry conventions of the result: image coordinates are continuous
 * pixels with pixel (i, j) covering [i, i+1) × [j, j+1); `homography` maps
 * code-plane units (CODE-01 profile, y down, origin at the seal centre) to
 * image pixels, row-major 3×3 with h[8] = 1; `moons` are in profile order
 * (index 0 = polaris); `orientation` is the direction of code north in the
 * image, in degrees clockwise from image up.
 *
 * Isomorphic: runs unchanged in a browser Web Worker and in Node.
 */
export { rgbaToGray, type GrayImage } from './image.js';
export { decodeOrbesCode, type DecodeFailure, type DecodeOptions, type DecodeResult, type SealEvidence } from './decode.js';
