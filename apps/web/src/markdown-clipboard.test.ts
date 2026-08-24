import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { plainTextForCodeSelection, serializeRenderedMarkdownFragment } from "./markdown-clipboard";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

class FakeText {
  readonly nodeType = TEXT_NODE;
  readonly childNodes: ReadonlyArray<never> = [];

  constructor(readonly textContent: string) {}
}

class FakeElement {
  readonly nodeType = ELEMENT_NODE;
  readonly childNodes: Array<FakeElement | FakeText> = [];
  readonly classList = {
    contains: (name: string) => this.classNames.includes(name),
  };

  constructor(
    readonly tagName: string,
    private readonly classNames: ReadonlyArray<string> = [],
  ) {}

  get localName(): string {
    return this.tagName.toLowerCase();
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  append(...children: Array<FakeElement | FakeText>): this {
    this.childNodes.push(...children);
    return this;
  }

  getAttribute(): string | null {
    return null;
  }

  hasAttribute(): boolean {
    return false;
  }
}

function asNode(element: FakeElement): Node {
  return element as unknown as Node;
}

function shikiCodeLine(text: string): FakeElement {
  const token = new FakeElement("SPAN").append(new FakeText(text));
  return new FakeElement("SPAN", ["line"]).append(token);
}

describe("serializeRenderedMarkdownFragment", () => {
  beforeEach(() => {
    vi.stubGlobal("Node", { TEXT_NODE, ELEMENT_NODE });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wraps inline code in backticks", () => {
    const paragraph = new FakeElement("P").append(
      new FakeText("run "),
      new FakeElement("CODE").append(new FakeText("git status")),
      new FakeText(" first"),
    );
    const container = new FakeElement("DIV").append(paragraph);

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe("run `git status` first");
  });

  it("keeps a highlighted block code selection plain when its pre wrapper is outside the range", () => {
    const code = new FakeElement("CODE").append(
      shikiCodeLine("git show-ref --verify refs/remotes/origin/opt/deploy/dev"),
    );
    const container = new FakeElement("DIV").append(code);

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe(
      "git show-ref --verify refs/remotes/origin/opt/deploy/dev",
    );
  });

  it("keeps a multi-line code selection plain instead of inline-wrapping it", () => {
    const code = new FakeElement("CODE").append(new FakeText("first line\nsecond line"));
    const container = new FakeElement("DIV").append(code);

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe("first line\nsecond line");
  });
});

function rangeNode(closestPre: Element | null): Node {
  return {
    nodeType: ELEMENT_NODE,
    closest: () => closestPre,
  } as unknown as Node;
}

function codeSelectionRange({
  commonAncestorPre,
  trailingText,
  trailingElement,
}: {
  commonAncestorPre: Element | null;
  trailingText: string;
  trailingElement?: FakeElement;
}): Range {
  const trailingContent =
    trailingElement ?? new FakeElement("DIV").append(new FakeText(trailingText));
  return {
    commonAncestorContainer: rangeNode(commonAncestorPre),
    startContainer: rangeNode({} as Element),
    cloneRange: () =>
      ({
        setStartAfter: vi.fn(),
        cloneContents: () => asNode(trailingContent),
      }) as unknown as Range,
    toString: () => "sudo dnf remove alacritty",
  } as unknown as Range;
}

describe("plainTextForCodeSelection", () => {
  beforeEach(() => {
    vi.stubGlobal("Node", { TEXT_NODE, ELEMENT_NODE });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a selection contained by pre plain", () => {
    const range = codeSelectionRange({ commonAncestorPre: {} as Element, trailingText: "unused" });

    expect(plainTextForCodeSelection(range)).toBe("sudo dnf remove alacritty");
  });

  it("keeps a final-line selection plain when only its trailing boundary leaves pre", () => {
    const range = codeSelectionRange({ commonAncestorPre: null, trailingText: "\n" });

    expect(plainTextForCodeSelection(range)).toBe("sudo dnf remove alacritty");
  });

  it("preserves markdown serialization when a code selection continues into prose", () => {
    const range = codeSelectionRange({
      commonAncestorPre: null,
      trailingText: "The following paragraph",
    });

    expect(plainTextForCodeSelection(range)).toBeNull();
  });

  it("preserves markdown serialization for selected trailing nodes without text", () => {
    const range = codeSelectionRange({
      commonAncestorPre: null,
      trailingText: "",
      trailingElement: new FakeElement("DIV").append(new FakeElement("HR")),
    });

    expect(plainTextForCodeSelection(range)).toBeNull();
  });
});
