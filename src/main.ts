import "./style.css";

const HTML_KEY = "dom-sim:html";
const CSS_KEY = "dom-sim:css";
const GENERATE_EVENT = "dom-sim:generate";

document
  .querySelectorAll<HTMLInputElement>('input[data-dom-sim-temp-file="1"]')
  .forEach((el) => el.remove());

// Prevent the browser from navigating away when a file is dropped outside our panels.
window.addEventListener(
  "dragover",
  (event) => {
    if (event.dataTransfer?.types?.includes?.("Files")) event.preventDefault();
  },
  { capture: true }
);
window.addEventListener(
  "drop",
  (event) => {
    if (event.dataTransfer?.types?.includes?.("Files")) event.preventDefault();
  },
  { capture: true }
);

const htmlInput = document.querySelector<HTMLTextAreaElement>("#html-input");
const cssInput = document.querySelector<HTMLTextAreaElement>("#css-input");

if (htmlInput) htmlInput.value = localStorage.getItem(HTML_KEY) ?? "";
if (cssInput) cssInput.value = localStorage.getItem(CSS_KEY) ?? "";

type GenerateEventDetail = {
  html: string;
  css: string;
};

const generateButton = document.querySelector<HTMLButtonElement>("#generate-btn");
const treeContainer = document.querySelector<HTMLElement>("#tree-container");
const treeMeta = document.querySelector<HTMLElement>("#tree-meta");

type TreeNode = ElementTreeNode | TextTreeNode;

type MetricLevel = "low" | "med" | "high";

type LayoutChip = {
  prop: string;
  value: string;
  title: string;
  declared: boolean;
};

type LayoutSummary = {
  chips: LayoutChip[];
  rulesCount: number;
  propsCount: number;
  longhandsCount: number;
  propsLevel: MetricLevel;
};

type ElementTreeNode = {
  type: "element";
  tag: string;
  id: string;
  classes: string[];
  children: TreeNode[];
  layout?: LayoutSummary;
};

type TextTreeNode = {
  type: "text";
  text: string;
};

const LAYOUT_PROPS = [
  "display",
  "position",
  "flex-direction",
  "justify-content",
  "align-items",
  "gap"
] as const;

const LAYOUT_PROP_SET = new Set<string>(LAYOUT_PROPS);

function normalizeTextNodeValue(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

type StyleContext = {
  win: Window;
  rules: CSSStyleRule[];
};

type CssMatchStats = {
  rulesMatched: number;
  longhandsCount: number;
  propGroups: Set<string>;
  declaredLayoutProps: Set<string>;
  inlinePresent: boolean;
};

function classifyPropsCount(propsCount: number): MetricLevel {
  if (propsCount <= 8) return "low";
  if (propsCount <= 18) return "med";
  return "high";
}

function normalizePropertyGroup(prop: string) {
  if (!prop) return prop;

  if (prop.startsWith("padding-")) return "padding";
  if (prop.startsWith("margin-")) return "margin";

  if (prop === "border-radius" || (prop.startsWith("border-") && prop.endsWith("radius"))) {
    return "border-radius";
  }

  if (prop === "border" || prop.startsWith("border-")) return "border";
  if (prop === "background" || prop.startsWith("background-")) return "background";
  if (prop === "font" || prop.startsWith("font-")) return "font";
  if (prop === "transition" || prop.startsWith("transition-")) return "transition";
  if (prop === "animation" || prop.startsWith("animation-")) return "animation";

  return prop;
}

function extractActiveStyleRules(
  sheet: CSSStyleSheet | null,
  win: Window
): CSSStyleRule[] {
  if (!sheet) return [];

  const out: CSSStyleRule[] = [];

  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.STYLE_RULE) {
        out.push(rule as CSSStyleRule);
        continue;
      }

      if (rule instanceof CSSMediaRule) {
        const mediaText = rule.media?.mediaText ?? "";
        if (!mediaText || win.matchMedia(mediaText).matches) walk(rule.cssRules);
        continue;
      }

      if (rule instanceof CSSSupportsRule) {
        let ok = true;
        try {
          ok = typeof CSS?.supports === "function" ? CSS.supports(rule.conditionText) : true;
        } catch {
          ok = true;
        }
        if (ok) walk(rule.cssRules);
        continue;
      }

      const maybeGrouping = rule as unknown as { cssRules?: CSSRuleList };
      if (maybeGrouping.cssRules) walk(maybeGrouping.cssRules);
    }
  };

  try {
    walk(sheet.cssRules);
  } catch {
    return [];
  }

  return out;
}

function getCssMatchStats(element: Element, ctx: StyleContext | null): CssMatchStats {
  const propGroups = new Set<string>();
  const declaredLayoutProps = new Set<string>();

  if (!ctx) {
    return {
      rulesMatched: 0,
      longhandsCount: 0,
      propGroups,
      declaredLayoutProps,
      inlinePresent: false
    };
  }

  let rulesMatched = 0;
  let longhandsCount = 0;

  for (const rule of ctx.rules) {
    let matches = false;
    try {
      matches = element.matches(rule.selectorText);
    } catch {
      continue;
    }
    if (!matches) continue;

    rulesMatched += 1;
    const decl = rule.style;
    for (let i = 0; i < decl.length; i += 1) {
      const prop = decl.item(i);
      if (!prop) continue;
      longhandsCount += 1;
      propGroups.add(normalizePropertyGroup(prop));
      if (LAYOUT_PROP_SET.has(prop)) declaredLayoutProps.add(prop);
    }
  }

  const inlineStyle = (element as HTMLElement).style;
  const inlinePresent = Boolean(inlineStyle?.length);
  if (inlineStyle?.length) {
    for (let i = 0; i < inlineStyle.length; i += 1) {
      const prop = inlineStyle.item(i);
      if (!prop) continue;
      longhandsCount += 1;
      propGroups.add(normalizePropertyGroup(prop));
      if (LAYOUT_PROP_SET.has(prop)) declaredLayoutProps.add(prop);
    }
  }

  return { rulesMatched, longhandsCount, propGroups, declaredLayoutProps, inlinePresent };
}

function buildLayoutSummary(element: Element, ctx: StyleContext | null): LayoutSummary | undefined {
  if (!ctx) return undefined;

  const stats = getCssMatchStats(element, ctx);

  const rulesCount = stats.rulesMatched + (stats.inlinePresent ? 1 : 0);
  const propsCount = stats.propGroups.size;
  const longhandsCount = stats.longhandsCount;
  const propsLevel = classifyPropsCount(propsCount);

  const computed = ctx.win.getComputedStyle(element);
  const getValue = (prop: string) => computed.getPropertyValue(prop).trim();
  const hasDecl = (prop: string) => stats.declaredLayoutProps.has(prop);

  const chips: LayoutChip[] = [];

  const displayValue = getValue("display");
  chips.push({
    prop: "display",
    value: displayValue,
    title: `display: ${displayValue}`,
    declared: hasDecl("display")
  });

  const positionValue = getValue("position");
  chips.push({
    prop: "position",
    value: positionValue,
    title: `position: ${positionValue}`,
    declared: hasDecl("position")
  });

  const isFlex = displayValue.includes("flex");
  const isGrid = displayValue.includes("grid");

  const pushIf = (prop: string, shouldShow: boolean) => {
    if (!shouldShow) return;
    const value = getValue(prop);
    chips.push({
      prop,
      value,
      title: `${prop}: ${value}`,
      declared: hasDecl(prop)
    });
  };

  pushIf("flex-direction", isFlex || hasDecl("flex-direction"));
  pushIf("justify-content", isFlex || hasDecl("justify-content"));
  pushIf("align-items", isFlex || hasDecl("align-items"));
  pushIf("gap", isFlex || isGrid || hasDecl("gap"));

  return { chips, rulesCount, propsCount, longhandsCount, propsLevel };
}

let sandboxEnvPromise: Promise<{
  win: Window;
  doc: Document;
  styleEl: HTMLStyleElement;
}> | null = null;

function ensureSandboxEnv() {
  if (sandboxEnvPromise) return sandboxEnvPromise;

  sandboxEnvPromise = new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.className = "dom-sim-sandbox";
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;

    frame.addEventListener(
      "load",
      () => {
        const win = frame.contentWindow;
        const doc = frame.contentDocument;
        const styleEl = doc?.getElementById("dom-sim-user-css") as
          | HTMLStyleElement
          | null;

        if (!win || !doc || !styleEl) {
          reject(new Error("Sandbox iframe failed to initialize."));
          return;
        }

        resolve({ win, doc, styleEl });
      },
      { once: true }
    );

    frame.srcdoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; font-src data:; connect-src 'none'; frame-src 'none'; style-src 'unsafe-inline';" />
    <style id="dom-sim-user-css"></style>
  </head>
  <body></body>
</html>`;

    document.body.appendChild(frame);
  });

  return sandboxEnvPromise;
}

async function buildStyleContext(html: string, css: string) {
  const env = await ensureSandboxEnv();

  const parsed = new DOMParser().parseFromString(html, "text/html");

  env.styleEl.textContent = css;

  env.doc.body.getAttributeNames().forEach((name) => env.doc.body.removeAttribute(name));
  parsed.body
    .getAttributeNames()
    .forEach((name) => env.doc.body.setAttribute(name, parsed.body.getAttribute(name) ?? ""));

  env.doc.body.innerHTML = parsed.body.innerHTML;

  await new Promise<void>((resolve) => env.win.requestAnimationFrame(() => resolve()));

  const sheet = env.styleEl.sheet as CSSStyleSheet | null;
  return {
    root: env.doc.body,
    ctx: {
      win: env.win,
      rules: extractActiveStyleRules(sheet, env.win)
    } satisfies StyleContext
  };
}

function elementToTree(element: Element, ctx: StyleContext | null): ElementTreeNode {
  const children: TreeNode[] = [];
  element.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      children.push(elementToTree(node as Element, ctx));
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const normalized = normalizeTextNodeValue(node.textContent ?? "");
      if (normalized) children.push({ type: "text", text: normalized });
    }
  });

  return {
    type: "element",
    tag: element.tagName.toLowerCase(),
    id: (element as HTMLElement).id ?? "",
    classes: [...element.classList],
    children,
    layout: children.length > 0 ? buildLayoutSummary(element, ctx) : undefined
  };
}

function countTreeNodes(node: TreeNode) {
  let elements = 0;
  let texts = 0;

  const walk = (n: TreeNode) => {
    if (n.type === "text") {
      texts += 1;
      return;
    }
    elements += 1;
    n.children.forEach(walk);
  };

  walk(node);
  return { elements, texts, total: elements + texts };
}

function truncate(value: string, maxLen: number) {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, Math.max(0, maxLen - 1))}…`;
}

function clearElement(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function createElementToken(
  className: string,
  text: string
): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function createElementRow(node: ElementTreeNode): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.appendChild(createElementToken("tree-tag", node.tag));
  if (node.id) frag.appendChild(createElementToken("tree-id", `#${node.id}`));
  node.classes.forEach((cls) => {
    frag.appendChild(createElementToken("tree-class", `.${cls}`));
  });
  return frag;
}

function createLayoutMetrics(layout: LayoutSummary): HTMLSpanElement {
  const metrics = document.createElement("span");
  metrics.className = "tree-metrics";

  layout.chips.forEach((chip) => {
    const el = document.createElement("span");
    el.className = chip.declared ? "tree-chip tree-chip--declared" : "tree-chip tree-chip--computed";
    el.title = chip.title;

    const key = document.createElement("span");
    key.className = "tree-chip-key";
    key.textContent = chip.prop;

    const sep = document.createElement("span");
    sep.className = "tree-chip-sep";
    sep.textContent = ":";

    const value = document.createElement("span");
    value.className = "tree-chip-val";
    value.textContent = chip.value;

    el.appendChild(key);
    el.appendChild(sep);
    el.appendChild(value);
    metrics.appendChild(el);
  });

  const rules = document.createElement("span");
  rules.className = "tree-metric tree-metric--neutral";
  rules.textContent = `rules=${layout.rulesCount}`;
  rules.title = "Matched selector rules (plus 1 if inline styles are present).";
  metrics.appendChild(rules);

  const props = document.createElement("span");
  props.className = `tree-metric tree-metric--${layout.propsLevel}`;
  props.textContent = `props=${layout.propsCount}`;
  props.title = "Unique matched property groups (shorthands like border/background grouped).";
  metrics.appendChild(props);

  const longhands = document.createElement("span");
  longhands.className = "tree-metric tree-metric--neutral";
  longhands.textContent = `longhands=${layout.longhandsCount}`;
  longhands.title =
    "Expanded CSSOM longhand declarations across all matched rules (can be inflated by shorthands).";
  metrics.appendChild(longhands);

  return metrics;
}

function renderTreeNode(node: TreeNode, depth: number): HTMLLIElement {
  const li = document.createElement("li");

  if (node.type === "text") {
    const row = document.createElement("div");
    row.className = "tree-row tree-text";
    row.textContent = `“${truncate(node.text, 120)}”`;
    li.appendChild(row);
    return li;
  }

  if (node.children.length > 0) {
    const details = document.createElement("details");
    details.open = depth <= 1;

    const summary = document.createElement("summary");
    summary.className = "tree-row tree-summary";
    summary.appendChild(createElementRow(node));
    if (node.layout) summary.appendChild(createLayoutMetrics(node.layout));

    const ul = document.createElement("ul");
    node.children.forEach((child) => {
      ul.appendChild(renderTreeNode(child, depth + 1));
    });

    details.appendChild(summary);
    details.appendChild(ul);
    li.appendChild(details);
    return li;
  }

  const row = document.createElement("div");
  row.className = "tree-row tree-leaf";
  row.appendChild(createElementRow(node));
  li.appendChild(row);
  return li;
}

async function renderTree(html: string, css: string) {
  if (!treeContainer) return;

  let root: Element;
  let ctx: StyleContext | null = null;

  try {
    const sandbox = await buildStyleContext(html, css);
    root = sandbox.root;
    ctx = sandbox.ctx;
  } catch {
    const doc = new DOMParser().parseFromString(html, "text/html");
    root = doc.body;
    ctx = null;
  }

  const rootNode = elementToTree(root, ctx);
  const counts = countTreeNodes(rootNode);

  if (treeMeta) {
    treeMeta.textContent = `Nodes: ${counts.total} • Elements: ${counts.elements} • Text: ${counts.texts}`;
  }

  clearElement(treeContainer);
  const ul = document.createElement("ul");
  ul.className = "dom-tree";
  ul.appendChild(renderTreeNode(rootNode, 0));
  treeContainer.appendChild(ul);
}

function getEditorValues() {
  return {
    html: htmlInput?.value ?? "",
    css: cssInput?.value ?? ""
  };
}

function canGenerate(html: string) {
  return html.trim().length > 0;
}

function syncGenerateButtonState() {
  if (!generateButton) return;
  const { html } = getEditorValues();
  generateButton.disabled = !canGenerate(html);
}

generateButton?.addEventListener("click", () => {
  const { html, css } = getEditorValues();
  if (!canGenerate(html)) return;

  document.dispatchEvent(
    new CustomEvent<GenerateEventDetail>(GENERATE_EVENT, {
      detail: { html, css }
    })
  );
});

document.addEventListener(GENERATE_EVENT, (event) => {
  const { html, css } = (event as CustomEvent<GenerateEventDetail>).detail ?? {
    html: "",
    css: ""
  };
  if (!canGenerate(html)) return;
  void renderTree(html, css);
});

syncGenerateButtonState();

function setTextareaValue(
  textarea: HTMLTextAreaElement,
  storageKey: string,
  value: string
) {
  textarea.value = value;
  localStorage.setItem(storageKey, value);
  syncGenerateButtonState();
}

htmlInput?.addEventListener("input", () => {
  if (!htmlInput) return;
  localStorage.setItem(HTML_KEY, htmlInput.value);
  syncGenerateButtonState();
});

cssInput?.addEventListener("input", () => {
  if (!cssInput) return;
  localStorage.setItem(CSS_KEY, cssInput.value);
  syncGenerateButtonState();
});

type DropTargetConfig = {
  textareaSelector: string;
  storageKey: string;
};

function addFileDrop(config: DropTargetConfig) {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    config.textareaSelector
  );
  const panel = textarea?.closest<HTMLElement>(".panel");
  if (!panel || !textarea) return;

  let dragCounter = 0;
  const setDragOver = (isOver: boolean) => {
    panel.classList.toggle("is-dragover", isOver);
  };

  const onDragEnter = (event: DragEvent) => {
    if (!event.dataTransfer?.types?.includes?.("Files")) return;
    event.preventDefault();
    dragCounter += 1;
    setDragOver(true);
  };

  const onDragLeave = (event: DragEvent) => {
    if (!event.dataTransfer?.types?.includes?.("Files")) return;
    event.preventDefault();
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) setDragOver(false);
  };

  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer?.types?.includes?.("Files")) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  const onDrop = async (event: DragEvent) => {
    if (!event.dataTransfer?.types?.includes?.("Files")) return;
    event.preventDefault();
    dragCounter = 0;
    setDragOver(false);

    const file = event.dataTransfer?.files?.[0];
    if (!file) return;

    const text = await file.text();
    setTextareaValue(textarea, config.storageKey, text);
  };

  const clear = () => {
    dragCounter = 0;
    setDragOver(false);
  };

  panel.addEventListener("dragenter", onDragEnter);
  panel.addEventListener("dragleave", onDragLeave);
  panel.addEventListener("dragover", onDragOver);
  panel.addEventListener("drop", onDrop);

  // Safety: if a drag is canceled outside the panel, don't leave the overlay stuck on.
  window.addEventListener("dragend", clear, { capture: true });
  window.addEventListener("drop", clear, { capture: true });
  window.addEventListener("blur", clear);
}

type FilePickerConfig = {
  buttonSelector: string;
  textareaSelector: string;
  storageKey: string;
  accept: string;
  pickerTypes?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
};

function addFilePicker(config: FilePickerConfig) {
  const button = document.querySelector<HTMLButtonElement>(
    config.buttonSelector
  );
  const textarea = document.querySelector<HTMLTextAreaElement>(
    config.textareaSelector
  );
  if (!button || !textarea) return;

  button.addEventListener("click", async () => {
    const w = window as unknown as {
      showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]>;
    };

    if (w.showOpenFilePicker && config.pickerTypes?.length) {
      try {
        const [handle] = await w.showOpenFilePicker({
          multiple: false,
          types: config.pickerTypes
        });
        if (!handle) return;
        const file = await handle.getFile();
        const text = await file.text();
        setTextareaValue(textarea, config.storageKey, text);
      } catch {
        // user canceled; ignore
      }
      return;
    }

    // Fallback: create a temporary hidden input so no "Choose file" UI appears.
    const input = document.createElement("input");
    input.type = "file";
    input.accept = config.accept;
    input.dataset.domSimTempFile = "1";
    input.style.display = "none";

    let didChange = false;
    const cleanup = () => {
      input.remove();
      window.removeEventListener("focus", onFocus, true);
    };

    const onFocus = () => {
      // If user cancels the picker, we still want to remove the element.
      setTimeout(() => cleanup(), 0);
    };

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      didChange = true;
      cleanup();
      if (!file) return;
      const text = await file.text();
      setTextareaValue(textarea, config.storageKey, text);
    });

    window.addEventListener("focus", onFocus, true);
    document.body.appendChild(input);
    input.click();

    // If focus doesn't actually change (browser-dependent), clean up shortly after.
    setTimeout(() => {
      if (!didChange) cleanup();
    }, 2500);
  });
}

addFileDrop({
  textareaSelector: "#html-input",
  storageKey: HTML_KEY
});

addFileDrop({
  textareaSelector: "#css-input",
  storageKey: CSS_KEY
});

addFilePicker({
  buttonSelector: "#html-file-btn",
  textareaSelector: "#html-input",
  storageKey: HTML_KEY,
  accept: ".html,text/html",
  pickerTypes: [
    {
      description: "HTML",
      accept: { "text/html": [".html", ".htm"] }
    }
  ]
});

addFilePicker({
  buttonSelector: "#css-file-btn",
  textareaSelector: "#css-input",
  storageKey: CSS_KEY,
  accept: ".css,text/css",
  pickerTypes: [
    {
      description: "CSS",
      accept: { "text/css": [".css"] }
    }
  ]
});
