// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  getPageForOffset,
  getPageRange,
  getParagraphRange,
  getSelectionOffsets,
} from "@/lib/client/reader";

interface ReaderFixture {
  article: HTMLElement;
  paragraphs: HTMLParagraphElement[];
  chapterText: string;
}

function setup(paragraphTexts: string[]): ReaderFixture {
  document.body.innerHTML = "";
  const article = document.createElement("article");
  article.id = "reader";

  let offset = 0;
  const paragraphs = paragraphTexts.map((text, index) => {
    const paragraph = document.createElement("p");
    paragraph.dataset.pstart = String(offset);
    paragraph.textContent = text;
    article.appendChild(paragraph);
    offset += text.length + (index < paragraphTexts.length - 1 ? 2 : 0);
    return paragraph;
  });

  document.body.appendChild(article);
  return {
    article,
    paragraphs,
    chapterText: paragraphTexts.join("\n\n"),
  };
}

function selectRange(
  startParagraph: HTMLParagraphElement,
  startOffset: number,
  endParagraph: HTMLParagraphElement,
  endOffset: number,
): void {
  const range = document.createRange();
  range.setStart(startParagraph.firstChild as Text, startOffset);
  range.setEnd(endParagraph.firstChild as Text, endOffset);
  const selection = window.getSelection();
  if (!selection) throw new Error("jsdom selection is unavailable");
  selection.removeAllRanges();
  selection.addRange(range);
}

beforeEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("getSelectionOffsets", () => {
  it("computes offsets for a selection inside one paragraph", () => {
    const { article, paragraphs, chapterText } = setup(["甲乙丙丁", "戊己庚辛"]);
    selectRange(paragraphs[0], 1, paragraphs[0], 3);

    const offsets = getSelectionOffsets(article, chapterText);

    expect(offsets).not.toBeNull();
    expect(offsets?.start).toBe(1);
    expect(offsets?.end).toBe(3);
    expect(offsets?.text).toBe("乙丙");
  });

  it("computes offsets for a selection spanning two paragraphs", () => {
    const { article, paragraphs, chapterText } = setup(["甲乙丙丁", "戊己庚辛"]);
    selectRange(paragraphs[0], 1, paragraphs[1], 2);

    const offsets = getSelectionOffsets(article, chapterText);

    expect(offsets).not.toBeNull();
    expect(offsets?.start).toBe(1);
    expect(offsets?.end).toBe(8);
    expect(offsets?.text).toBe(chapterText.slice(1, 8));
    expect(offsets?.text).toBe("乙丙丁\n\n戊己");
  });

  it("maps a select-all range that starts and ends on the article element", () => {
    const { article, chapterText } = setup(["甲乙丙丁", "戊己庚辛"]);
    const range = document.createRange();
    range.selectNodeContents(article);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const offsets = getSelectionOffsets(article, chapterText);

    expect(offsets).not.toBeNull();
    expect(offsets?.start).toBe(0);
    expect(offsets?.end).toBe(chapterText.length);
    expect(offsets?.text).toBe(chapterText);
  });

  it("returns null for collapsed selections and selections outside the reader", () => {
    const { article, chapterText } = setup(["甲乙丙丁"]);
    const range = document.createRange();
    range.setStart(paragraphsOf(article)[0].firstChild as Text, 1);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(getSelectionOffsets(article, chapterText)).toBeNull();

    const outside = document.createElement("p");
    outside.textContent = "正文之外";
    document.body.appendChild(outside);
    const outsideRange = document.createRange();
    outsideRange.setStart(outside.firstChild as Text, 0);
    outsideRange.setEnd(outside.firstChild as Text, 2);
    selection?.removeAllRanges();
    selection?.addRange(outsideRange);
    expect(getSelectionOffsets(article, chapterText)).toBeNull();
  });
});

function paragraphsOf(article: HTMLElement): HTMLParagraphElement[] {
  return Array.from(article.querySelectorAll("p"));
}

describe("range helpers", () => {
  const paragraphs = [
    { start: 0, text: "甲乙丙丁" },
    { start: 6, text: "戊己庚辛" },
  ];
  const chapter = {
    text: "甲乙丙丁\n\n戊己庚辛",
    paragraphs,
    pages: [
      { number: 1, start: 0, end: 4 },
      { number: 2, start: 6, end: 10 },
    ],
  };

  it("resolves a paragraph range from an offset", () => {
    expect(getParagraphRange(chapter, 1)).toEqual({
      start: 0,
      end: 4,
      text: "甲乙丙丁",
      index: 0,
    });
    expect(getParagraphRange(chapter, 7)).toEqual({
      start: 6,
      end: 10,
      text: "戊己庚辛",
      index: 1,
    });
    expect(getParagraphRange(chapter, 10)).toMatchObject({
      start: 6,
      index: 1,
    });
    expect(getParagraphRange(chapter, 999)).toBeNull();
  });

  it("resolves page ranges and page numbers", () => {
    expect(getPageRange(chapter, 1)).toEqual({
      start: 0,
      end: 4,
      text: "甲乙丙丁",
      page: 1,
    });
    expect(getPageRange(chapter, 2)).toEqual({
      start: 6,
      end: 10,
      text: "戊己庚辛",
      page: 2,
    });
    expect(getPageRange(chapter, 3)).toBeNull();
    expect(getPageForOffset(chapter, 1)).toBe(1);
    expect(getPageForOffset(chapter, 7)).toBe(2);
    expect(getPageForOffset(chapter, 10)).toBe(2);
  });
});
