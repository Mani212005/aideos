/**
 * ==============================================================================
 * AIDEOS 2.0: CAPTION & SCRIPT VTT PARSER
 * ==============================================================================
 * Synchronizes speech audio (.wav) and script (.vtt) with Remotion frame rates.
 * Generates word-level timestamps and kinetic display phrases.
 * ==============================================================================
 */

import type { CaptionWord } from "./KineticSubtitles";

/** Parse timestamp "00:01:23.456" or "01:23.456" into seconds */
function timeToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
  } else if (parts.length === 2) {
    const [m, s] = parts;
    return parseFloat(m) * 60 + parseFloat(s);
  }
  return 0;
}

export interface VttCue {
  startSec: number;
  endSec: number;
  text: string;
}

/** Parse raw WebVTT content into structured cues */
export function parseVtt(vttContent: string): VttCue[] {
  const cues: VttCue[] = [];
  const lines = vttContent.split(/\r?\n/);
  let currentStart = 0;
  let currentEnd = 0;
  let textAccum = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes("-->")) {
      if (textAccum && currentEnd > currentStart) {
        cues.push({
          startSec: currentStart,
          endSec: currentEnd,
          text: textAccum.trim(),
        });
        textAccum = "";
      }
      const [startStr, endStr] = line.split("-->");
      currentStart = timeToSeconds(startStr);
      currentEnd = timeToSeconds(endStr);
    } else if (line && !line.startsWith("WEBVTT") && !/^\d+$/.test(line)) {
      textAccum += (textAccum ? " " : "") + line;
    }
  }

  if (textAccum && currentEnd > currentStart) {
    cues.push({
      startSec: currentStart,
      endSec: currentEnd,
      text: textAccum.trim(),
    });
  }

  return cues;
}

/** Convert VTT cues into word-by-word timestamped array aligned with Remotion FPS */
export function vttToCaptionWords(cues: VttCue[], fps = 30): CaptionWord[] {
  const words: CaptionWord[] = [];

  for (const cue of cues) {
    const rawWords = cue.text.split(/\s+/).filter(Boolean);
    if (rawWords.length === 0) continue;

    const cueDuration = Math.max(0.1, cue.endSec - cue.startSec);
    const wordDuration = cueDuration / rawWords.length;

    rawWords.forEach((word, idx) => {
      const wStart = cue.startSec + idx * wordDuration;
      const wEnd = wStart + wordDuration;
      words.push({
        text: word,
        startFrame: Math.round(wStart * fps),
        endFrame: Math.round(wEnd * fps),
      });
    });
  }

  return words;
}

/** Default fallback speech words matching clean KV-Cache voiceover.wav */
export const DEFAULT_GIRAFFE_CAPTION_WORDS: CaptionWord[] = [
  {
    "text": "A",
    "startFrame": 5,
    "endFrame": 12
  },
  {
    "text": "model",
    "startFrame": 12,
    "endFrame": 26
  },
  {
    "text": "never",
    "startFrame": 26,
    "endFrame": 36
  },
  {
    "text": "rereads",
    "startFrame": 36,
    "endFrame": 50
  },
  {
    "text": "your",
    "startFrame": 50,
    "endFrame": 58
  },
  {
    "text": "prompt.",
    "startFrame": 58,
    "endFrame": 73
  },
  {
    "text": "It",
    "startFrame": 94,
    "endFrame": 101
  },
  {
    "text": "would",
    "startFrame": 101,
    "endFrame": 108
  },
  {
    "text": "have",
    "startFrame": 108,
    "endFrame": 113
  },
  {
    "text": "to",
    "startFrame": 113,
    "endFrame": 127
  },
  {
    "text": "thousands",
    "startFrame": 127,
    "endFrame": 139
  },
  {
    "text": "of",
    "startFrame": 139,
    "endFrame": 144
  },
  {
    "text": "times",
    "startFrame": 144,
    "endFrame": 154
  },
  {
    "text": "per",
    "startFrame": 154,
    "endFrame": 161
  },
  {
    "text": "answer.",
    "startFrame": 161,
    "endFrame": 176
  },
  {
    "text": "Something",
    "startFrame": 202,
    "endFrame": 214
  },
  {
    "text": "has",
    "startFrame": 214,
    "endFrame": 221
  },
  {
    "text": "to",
    "startFrame": 221,
    "endFrame": 226
  },
  {
    "text": "remember",
    "startFrame": 226,
    "endFrame": 238
  },
  {
    "text": "for",
    "startFrame": 238,
    "endFrame": 242
  },
  {
    "text": "it",
    "startFrame": 242,
    "endFrame": 252
  },
  {
    "text": "and",
    "startFrame": 252,
    "endFrame": 259
  },
  {
    "text": "that",
    "startFrame": 259,
    "endFrame": 266
  },
  {
    "text": "something",
    "startFrame": 266,
    "endFrame": 278
  },
  {
    "text": "has",
    "startFrame": 278,
    "endFrame": 283
  },
  {
    "text": "a",
    "startFrame": 283,
    "endFrame": 286
  },
  {
    "text": "price.",
    "startFrame": 286,
    "endFrame": 301
  },
  {
    "text": "Step",
    "startFrame": 329,
    "endFrame": 336
  },
  {
    "text": "one,",
    "startFrame": 336,
    "endFrame": 348
  },
  {
    "text": "tokenization.",
    "startFrame": 348,
    "endFrame": 363
  },
  {
    "text": "Your",
    "startFrame": 384,
    "endFrame": 391
  },
  {
    "text": "sentence",
    "startFrame": 391,
    "endFrame": 406
  },
  {
    "text": "arrives",
    "startFrame": 406,
    "endFrame": 418
  },
  {
    "text": "as",
    "startFrame": 418,
    "endFrame": 425
  },
  {
    "text": "IDs.",
    "startFrame": 425,
    "endFrame": 440
  },
  {
    "text": "Seven",
    "startFrame": 449,
    "endFrame": 461
  },
  {
    "text": "tokens,",
    "startFrame": 461,
    "endFrame": 476
  },
  {
    "text": "not",
    "startFrame": 480,
    "endFrame": 490
  },
  {
    "text": "five",
    "startFrame": 490,
    "endFrame": 499
  },
  {
    "text": "words.",
    "startFrame": 499,
    "endFrame": 514
  },
  {
    "text": "Now",
    "startFrame": 540,
    "endFrame": 550
  },
  {
    "text": "watch",
    "startFrame": 550,
    "endFrame": 559
  },
  {
    "text": "how",
    "startFrame": 559,
    "endFrame": 564
  },
  {
    "text": "the",
    "startFrame": 564,
    "endFrame": 569
  },
  {
    "text": "attention",
    "startFrame": 569,
    "endFrame": 583
  },
  {
    "text": "network",
    "startFrame": 583,
    "endFrame": 598
  },
  {
    "text": "connects",
    "startFrame": 598,
    "endFrame": 610
  },
  {
    "text": "tokens",
    "startFrame": 610,
    "endFrame": 625
  },
  {
    "text": "across",
    "startFrame": 627,
    "endFrame": 636
  },
  {
    "text": "the",
    "startFrame": 636,
    "endFrame": 641
  },
  {
    "text": "canvas.",
    "startFrame": 641,
    "endFrame": 656
  },
  {
    "text": "Step",
    "startFrame": 684,
    "endFrame": 691
  },
  {
    "text": "two,",
    "startFrame": 691,
    "endFrame": 706
  },
  {
    "text": "attention.",
    "startFrame": 708,
    "endFrame": 723
  },
  {
    "text": "Every",
    "startFrame": 735,
    "endFrame": 744
  },
  {
    "text": "new",
    "startFrame": 744,
    "endFrame": 751
  },
  {
    "text": "token",
    "startFrame": 751,
    "endFrame": 763
  },
  {
    "text": "looks",
    "startFrame": 763,
    "endFrame": 773
  },
  {
    "text": "back",
    "startFrame": 773,
    "endFrame": 778
  },
  {
    "text": "at",
    "startFrame": 778,
    "endFrame": 783
  },
  {
    "text": "every",
    "startFrame": 783,
    "endFrame": 792
  },
  {
    "text": "old",
    "startFrame": 792,
    "endFrame": 797
  },
  {
    "text": "one.",
    "startFrame": 797,
    "endFrame": 812
  },
  {
    "text": "Those",
    "startFrame": 833,
    "endFrame": 845
  },
  {
    "text": "glances",
    "startFrame": 845,
    "endFrame": 860
  },
  {
    "text": "form",
    "startFrame": 864,
    "endFrame": 872
  },
  {
    "text": "an",
    "startFrame": 872,
    "endFrame": 879
  },
  {
    "text": "attention",
    "startFrame": 879,
    "endFrame": 891
  },
  {
    "text": "grid",
    "startFrame": 891,
    "endFrame": 905
  },
  {
    "text": "across",
    "startFrame": 905,
    "endFrame": 912
  },
  {
    "text": "the",
    "startFrame": 912,
    "endFrame": 920
  },
  {
    "text": "sequence.",
    "startFrame": 920,
    "endFrame": 935
  },
  {
    "text": "It",
    "startFrame": 960,
    "endFrame": 968
  },
  {
    "text": "calculates",
    "startFrame": 968,
    "endFrame": 983
  },
  {
    "text": "weighted",
    "startFrame": 984,
    "endFrame": 996
  },
  {
    "text": "sums",
    "startFrame": 996,
    "endFrame": 1001
  },
  {
    "text": "of",
    "startFrame": 1001,
    "endFrame": 1008
  },
  {
    "text": "queries,",
    "startFrame": 1008,
    "endFrame": 1023
  },
  {
    "text": "keys,",
    "startFrame": 1030,
    "endFrame": 1042
  },
  {
    "text": "and",
    "startFrame": 1042,
    "endFrame": 1049
  },
  {
    "text": "values.",
    "startFrame": 1049,
    "endFrame": 1064
  },
  {
    "text": "The",
    "startFrame": 1092,
    "endFrame": 1097
  },
  {
    "text": "two",
    "startFrame": 1097,
    "endFrame": 1104
  },
  {
    "text": "things",
    "startFrame": 1104,
    "endFrame": 1114
  },
  {
    "text": "worth",
    "startFrame": 1114,
    "endFrame": 1121
  },
  {
    "text": "keeping,",
    "startFrame": 1121,
    "endFrame": 1136
  },
  {
    "text": "each",
    "startFrame": 1145,
    "endFrame": 1155
  },
  {
    "text": "token",
    "startFrame": 1155,
    "endFrame": 1167
  },
  {
    "text": "hands",
    "startFrame": 1167,
    "endFrame": 1174
  },
  {
    "text": "out",
    "startFrame": 1174,
    "endFrame": 1179
  },
  {
    "text": "a",
    "startFrame": 1179,
    "endFrame": 1183
  },
  {
    "text": "key",
    "startFrame": 1183,
    "endFrame": 1191
  },
  {
    "text": "and",
    "startFrame": 1191,
    "endFrame": 1196
  },
  {
    "text": "a",
    "startFrame": 1196,
    "endFrame": 1198
  },
  {
    "text": "value.",
    "startFrame": 1198,
    "endFrame": 1213
  },
  {
    "text": "The",
    "startFrame": 1238,
    "endFrame": 1245
  },
  {
    "text": "key",
    "startFrame": 1245,
    "endFrame": 1252
  },
  {
    "text": "is",
    "startFrame": 1252,
    "endFrame": 1257
  },
  {
    "text": "how",
    "startFrame": 1257,
    "endFrame": 1264
  },
  {
    "text": "it",
    "startFrame": 1264,
    "endFrame": 1269
  },
  {
    "text": "answers",
    "startFrame": 1269,
    "endFrame": 1278
  },
  {
    "text": "being",
    "startFrame": 1278,
    "endFrame": 1286
  },
  {
    "text": "looked",
    "startFrame": 1286,
    "endFrame": 1295
  },
  {
    "text": "up.",
    "startFrame": 1295,
    "endFrame": 1310
  },
  {
    "text": "The",
    "startFrame": 1310,
    "endFrame": 1314
  },
  {
    "text": "value",
    "startFrame": 1314,
    "endFrame": 1324
  },
  {
    "text": "is",
    "startFrame": 1324,
    "endFrame": 1329
  },
  {
    "text": "what",
    "startFrame": 1329,
    "endFrame": 1334
  },
  {
    "text": "it",
    "startFrame": 1334,
    "endFrame": 1338
  },
  {
    "text": "says",
    "startFrame": 1338,
    "endFrame": 1343
  },
  {
    "text": "when",
    "startFrame": 1343,
    "endFrame": 1348
  },
  {
    "text": "it",
    "startFrame": 1348,
    "endFrame": 1353
  },
  {
    "text": "is.",
    "startFrame": 1353,
    "endFrame": 1368
  },
  {
    "text": "Neither",
    "startFrame": 1394,
    "endFrame": 1408
  },
  {
    "text": "depends",
    "startFrame": 1408,
    "endFrame": 1420
  },
  {
    "text": "on",
    "startFrame": 1420,
    "endFrame": 1427
  },
  {
    "text": "anything",
    "startFrame": 1427,
    "endFrame": 1439
  },
  {
    "text": "that",
    "startFrame": 1439,
    "endFrame": 1446
  },
  {
    "text": "comes",
    "startFrame": 1446,
    "endFrame": 1454
  },
  {
    "text": "after",
    "startFrame": 1454,
    "endFrame": 1463
  },
  {
    "text": "it,",
    "startFrame": 1463,
    "endFrame": 1475
  },
  {
    "text": "which",
    "startFrame": 1475,
    "endFrame": 1482
  },
  {
    "text": "is",
    "startFrame": 1482,
    "endFrame": 1490
  },
  {
    "text": "the",
    "startFrame": 1490,
    "endFrame": 1494
  },
  {
    "text": "whole",
    "startFrame": 1494,
    "endFrame": 1504
  },
  {
    "text": "reason",
    "startFrame": 1504,
    "endFrame": 1516
  },
  {
    "text": "this",
    "startFrame": 1516,
    "endFrame": 1521
  },
  {
    "text": "works.",
    "startFrame": 1521,
    "endFrame": 1536
  },
  {
    "text": "Once",
    "startFrame": 1562,
    "endFrame": 1571
  },
  {
    "text": "computed,",
    "startFrame": 1571,
    "endFrame": 1586
  },
  {
    "text": "these",
    "startFrame": 1593,
    "endFrame": 1602
  },
  {
    "text": "vectors",
    "startFrame": 1602,
    "endFrame": 1614
  },
  {
    "text": "flow",
    "startFrame": 1614,
    "endFrame": 1622
  },
  {
    "text": "into",
    "startFrame": 1622,
    "endFrame": 1629
  },
  {
    "text": "the",
    "startFrame": 1629,
    "endFrame": 1634
  },
  {
    "text": "next",
    "startFrame": 1634,
    "endFrame": 1641
  },
  {
    "text": "stage.",
    "startFrame": 1641,
    "endFrame": 1656
  },
  {
    "text": "Step",
    "startFrame": 1685,
    "endFrame": 1692
  },
  {
    "text": "three,",
    "startFrame": 1692,
    "endFrame": 1706
  },
  {
    "text": "profill.",
    "startFrame": 1706,
    "endFrame": 1721
  },
  {
    "text": "The",
    "startFrame": 1728,
    "endFrame": 1733
  },
  {
    "text": "whole",
    "startFrame": 1733,
    "endFrame": 1740
  },
  {
    "text": "prompt",
    "startFrame": 1740,
    "endFrame": 1752
  },
  {
    "text": "goes",
    "startFrame": 1752,
    "endFrame": 1759
  },
  {
    "text": "through",
    "startFrame": 1759,
    "endFrame": 1766
  },
  {
    "text": "once",
    "startFrame": 1766,
    "endFrame": 1773
  },
  {
    "text": "in",
    "startFrame": 1773,
    "endFrame": 1778
  },
  {
    "text": "parallel.",
    "startFrame": 1778,
    "endFrame": 1793
  },
  {
    "text": "Keep",
    "startFrame": 1821,
    "endFrame": 1829
  },
  {
    "text": "the",
    "startFrame": 1829,
    "endFrame": 1833
  },
  {
    "text": "grid",
    "startFrame": 1833,
    "endFrame": 1841
  },
  {
    "text": "in",
    "startFrame": 1841,
    "endFrame": 1845
  },
  {
    "text": "memory.",
    "startFrame": 1845,
    "endFrame": 1860
  },
  {
    "text": "That",
    "startFrame": 1862,
    "endFrame": 1869
  },
  {
    "text": "is",
    "startFrame": 1869,
    "endFrame": 1874
  },
  {
    "text": "the",
    "startFrame": 1874,
    "endFrame": 1881
  },
  {
    "text": "kv",
    "startFrame": 1881,
    "endFrame": 1893
  },
  {
    "text": "cache.",
    "startFrame": 1893,
    "endFrame": 1908
  },
  {
    "text": "Read",
    "startFrame": 1932,
    "endFrame": 1939
  },
  {
    "text": "it",
    "startFrame": 1939,
    "endFrame": 1944
  },
  {
    "text": "again",
    "startFrame": 1944,
    "endFrame": 1953
  },
  {
    "text": "or",
    "startFrame": 1953,
    "endFrame": 1960
  },
  {
    "text": "store",
    "startFrame": 1960,
    "endFrame": 1968
  },
  {
    "text": "it",
    "startFrame": 1968,
    "endFrame": 1973
  },
  {
    "text": "in",
    "startFrame": 1973,
    "endFrame": 1975
  },
  {
    "text": "memory.",
    "startFrame": 1975,
    "endFrame": 1990
  },
  {
    "text": "Pick",
    "startFrame": 1994,
    "endFrame": 2004
  },
  {
    "text": "one.",
    "startFrame": 2004,
    "endFrame": 2019
  },
  {
    "text": "Step",
    "startFrame": 2043,
    "endFrame": 2050
  },
  {
    "text": "four,",
    "startFrame": 2050,
    "endFrame": 2064
  },
  {
    "text": "decode.",
    "startFrame": 2064,
    "endFrame": 2079
  },
  {
    "text": "Now",
    "startFrame": 2086,
    "endFrame": 2095
  },
  {
    "text": "each",
    "startFrame": 2095,
    "endFrame": 2105
  },
  {
    "text": "generated",
    "startFrame": 2105,
    "endFrame": 2119
  },
  {
    "text": "word",
    "startFrame": 2119,
    "endFrame": 2131
  },
  {
    "text": "costs",
    "startFrame": 2131,
    "endFrame": 2141
  },
  {
    "text": "one",
    "startFrame": 2141,
    "endFrame": 2146
  },
  {
    "text": "new",
    "startFrame": 2146,
    "endFrame": 2153
  },
  {
    "text": "row.",
    "startFrame": 2153,
    "endFrame": 2168
  },
  {
    "text": "Every",
    "startFrame": 2191,
    "endFrame": 2206
  },
  {
    "text": "generation",
    "startFrame": 2206,
    "endFrame": 2218
  },
  {
    "text": "step",
    "startFrame": 2218,
    "endFrame": 2230
  },
  {
    "text": "looks",
    "startFrame": 2230,
    "endFrame": 2237
  },
  {
    "text": "back",
    "startFrame": 2237,
    "endFrame": 2244
  },
  {
    "text": "at",
    "startFrame": 2244,
    "endFrame": 2247
  },
  {
    "text": "the",
    "startFrame": 2247,
    "endFrame": 2251
  },
  {
    "text": "cached",
    "startFrame": 2251,
    "endFrame": 2263
  },
  {
    "text": "keys",
    "startFrame": 2263,
    "endFrame": 2273
  },
  {
    "text": "and",
    "startFrame": 2273,
    "endFrame": 2280
  },
  {
    "text": "values.",
    "startFrame": 2280,
    "endFrame": 2295
  },
  {
    "text": "Step",
    "startFrame": 2323,
    "endFrame": 2335
  },
  {
    "text": "five,",
    "startFrame": 2335,
    "endFrame": 2347
  },
  {
    "text": "what",
    "startFrame": 2347,
    "endFrame": 2352
  },
  {
    "text": "it",
    "startFrame": 2352,
    "endFrame": 2359
  },
  {
    "text": "costs.",
    "startFrame": 2359,
    "endFrame": 2374
  },
  {
    "text": "You",
    "startFrame": 2379,
    "endFrame": 2386
  },
  {
    "text": "bought",
    "startFrame": 2386,
    "endFrame": 2393
  },
  {
    "text": "compute",
    "startFrame": 2393,
    "endFrame": 2405
  },
  {
    "text": "speed",
    "startFrame": 2405,
    "endFrame": 2412
  },
  {
    "text": "with",
    "startFrame": 2412,
    "endFrame": 2422
  },
  {
    "text": "GPU",
    "startFrame": 2422,
    "endFrame": 2437
  },
  {
    "text": "memory.",
    "startFrame": 2439,
    "endFrame": 2454
  },
  {
    "text": "And",
    "startFrame": 2479,
    "endFrame": 2481
  },
  {
    "text": "it",
    "startFrame": 2481,
    "endFrame": 2486
  },
  {
    "text": "grows",
    "startFrame": 2486,
    "endFrame": 2495
  },
  {
    "text": "linearly",
    "startFrame": 2495,
    "endFrame": 2510
  },
  {
    "text": "forever",
    "startFrame": 2519,
    "endFrame": 2531
  },
  {
    "text": "with",
    "startFrame": 2531,
    "endFrame": 2539
  },
  {
    "text": "each",
    "startFrame": 2539,
    "endFrame": 2546
  },
  {
    "text": "token",
    "startFrame": 2546,
    "endFrame": 2560
  },
  {
    "text": "generated.",
    "startFrame": 2560,
    "endFrame": 2575
  },
  {
    "text": "At",
    "startFrame": 2606,
    "endFrame": 2613
  },
  {
    "text": "128",
    "startFrame": 2613,
    "endFrame": 2647
  },
  {
    "text": "k",
    "startFrame": 2647,
    "endFrame": 2654
  },
  {
    "text": "tokens,",
    "startFrame": 2654,
    "endFrame": 2669
  },
  {
    "text": "the",
    "startFrame": 2680,
    "endFrame": 2687
  },
  {
    "text": "cache",
    "startFrame": 2687,
    "endFrame": 2697
  },
  {
    "text": "for",
    "startFrame": 2697,
    "endFrame": 2702
  },
  {
    "text": "a",
    "startFrame": 2702,
    "endFrame": 2707
  },
  {
    "text": "70",
    "startFrame": 2707,
    "endFrame": 2719
  },
  {
    "text": "b",
    "startFrame": 2719,
    "endFrame": 2726
  },
  {
    "text": "model",
    "startFrame": 2726,
    "endFrame": 2741
  },
  {
    "text": "runs",
    "startFrame": 2743,
    "endFrame": 2750
  },
  {
    "text": "to",
    "startFrame": 2750,
    "endFrame": 2757
  },
  {
    "text": "tens",
    "startFrame": 2757,
    "endFrame": 2764
  },
  {
    "text": "of",
    "startFrame": 2764,
    "endFrame": 2769
  },
  {
    "text": "gigabytes,",
    "startFrame": 2769,
    "endFrame": 2784
  },
  {
    "text": "bigger",
    "startFrame": 2798,
    "endFrame": 2810
  },
  {
    "text": "than",
    "startFrame": 2810,
    "endFrame": 2817
  },
  {
    "text": "a",
    "startFrame": 2817,
    "endFrame": 2819
  },
  {
    "text": "lot",
    "startFrame": 2819,
    "endFrame": 2824
  },
  {
    "text": "of",
    "startFrame": 2824,
    "endFrame": 2829
  },
  {
    "text": "the",
    "startFrame": 2829,
    "endFrame": 2834
  },
  {
    "text": "weights",
    "startFrame": 2834,
    "endFrame": 2846
  },
  {
    "text": "it",
    "startFrame": 2846,
    "endFrame": 2851
  },
  {
    "text": "is",
    "startFrame": 2851,
    "endFrame": 2855
  },
  {
    "text": "reading",
    "startFrame": 2855,
    "endFrame": 2867
  },
  {
    "text": "from.",
    "startFrame": 2867,
    "endFrame": 2882
  },
  {
    "text": "Memory",
    "startFrame": 2907,
    "endFrame": 2922
  },
  {
    "text": "pressure",
    "startFrame": 2922,
    "endFrame": 2937
  },
  {
    "text": "becomes",
    "startFrame": 2941,
    "endFrame": 2953
  },
  {
    "text": "the",
    "startFrame": 2953,
    "endFrame": 2958
  },
  {
    "text": "ultimate",
    "startFrame": 2958,
    "endFrame": 2972
  },
  {
    "text": "bottleneck.",
    "startFrame": 2972,
    "endFrame": 2987
  },
  {
    "text": "Profill",
    "startFrame": 3018,
    "endFrame": 3030
  },
  {
    "text": "once,",
    "startFrame": 3030,
    "endFrame": 3045
  },
  {
    "text": "cache,",
    "startFrame": 3054,
    "endFrame": 3069
  },
  {
    "text": "then",
    "startFrame": 3073,
    "endFrame": 3080
  },
  {
    "text": "decode",
    "startFrame": 3080,
    "endFrame": 3092
  },
  {
    "text": "forever,",
    "startFrame": 3092,
    "endFrame": 3107
  },
  {
    "text": "keys,",
    "startFrame": 3109,
    "endFrame": 3123
  },
  {
    "text": "values,",
    "startFrame": 3123,
    "endFrame": 3138
  },
  {
    "text": "profill,",
    "startFrame": 3138,
    "endFrame": 3150
  },
  {
    "text": "decode.",
    "startFrame": 3150,
    "endFrame": 3165
  }
];
