import type { Dynasty, Period } from "@/lib/schema";

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function chineseYearToInt(raw: string): number | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  if (text === "元" || text === "正") return 1;
  let total = 0;
  let current = 0;
  for (const char of text) {
    if (char in CN_DIGITS) {
      current = CN_DIGITS[char]!;
      continue;
    }
    if (char === "十") {
      total += (current === 0 ? 1 : current) * 10;
      current = 0;
      continue;
    }
    if (char === "百") {
      total += (current === 0 ? 1 : current) * 100;
      current = 0;
      continue;
    }
    if (char === "廿") {
      total += 20;
      continue;
    }
    if (char === "卅") {
      total += 30;
      continue;
    }
    return undefined;
  }
  return total + current;
}

/** Common era names (subset) used only by the offline rule mode. */
const ERA_STARTS: Record<string, number> = {
  建安: 196,
  延康: 220,
  黄初: 220,
  太和: 227,
  青龙: 233,
  景初: 237,
  正始: 240,
  嘉平: 249,
  正元: 254,
  甘露: 256,
  景元: 260,
  咸熙: 264,
  泰始: 265,
  咸宁: 275,
  太康: 280,
  永嘉: 307,
  建兴: 313,
  永和: 345,
  太元: 376,
  义熙: 405,
  元嘉: 424,
  天监: 502,
  普通: 520,
  大同: 535,
  太清: 547,
  承圣: 552,
  开皇: 581,
  大业: 605,
  武德: 618,
  贞观: 627,
  永徽: 650,
  显庆: 656,
  开元: 713,
  天宝: 742,
  至德: 756,
  乾元: 758,
  大历: 766,
  建中: 780,
  兴元: 784,
  贞元: 785,
  元和: 806,
  长庆: 821,
  大和: 827,
  会昌: 841,
  大中: 847,
  咸通: 860,
  乾符: 874,
  广明: 880,
  中和: 881,
  光启: 885,
  天复: 901,
  天祐: 904,
};

const ERA_KEYS = Object.keys(ERA_STARTS).sort((a, b) => b.length - a.length);

export function chineseNumeralToInt(raw: string): number | undefined {
  return chineseYearToInt(raw);
}

/**
 * Offline period inference for rule mode. It recognises a small set of era
 * names ("建安十三年") and dynasty labels; it never invents precise years.
 */
export function inferPeriodFromText(
  text: string,
  dynasties: Dynasty[] = [],
): Period | undefined {
  for (const era of ERA_KEYS) {
    const pattern = new RegExp(
      `${era}(元|正|[零〇一二两三四五六七八九十百廿卅]+)年`,
    );
    const match = pattern.exec(text);
    if (match?.[1]) {
      const yearInEra = chineseYearToInt(match[1]);
      if (yearInEra && yearInEra > 0 && yearInEra < 100) {
        const year = ERA_STARTS[era]! + yearInEra - 1;
        return {
          label: `${era}${match[1]}年`,
          startYear: year,
          endYear: year,
          confidence: 0.45,
        };
      }
    }
  }

  let best: { label: string; length: number; dynasty: Dynasty } | undefined;
  for (const dynasty of dynasties) {
    for (const label of [dynasty.label, ...dynasty.aliases]) {
      if (!label || label.length < 2) continue;
      if (!text.includes(label)) continue;
      if (!best || label.length > best.length) {
        best = { label, length: label.length, dynasty };
      }
    }
  }
  if (best) {
    const period: Period = {
      label: best.dynasty.label,
      confidence: 0.4,
    };
    if (best.dynasty.startYear !== undefined) period.startYear = best.dynasty.startYear;
    if (best.dynasty.endYear !== undefined) period.endYear = best.dynasty.endYear;
    return period;
  }

  return undefined;
}
