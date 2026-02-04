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

type ElementTreeNode = {
  type: "element";
  tag: string;
  id: string;
  classes: string[];
  children: TreeNode[];
};

type TextTreeNode = {
  type: "text";
  text: string;
};

function normalizeTextNodeValue(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function elementToTree(element: Element): ElementTreeNode {
  const children: TreeNode[] = [];
  element.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      children.push(elementToTree(node as Element));
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
    children
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

function renderTree(html: string) {
  if (!treeContainer) return;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const rootNode = elementToTree(doc.body);
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
  const { html } = (event as CustomEvent<GenerateEventDetail>).detail ?? {
    html: "",
    css: ""
  };
  if (!canGenerate(html)) return;
  renderTree(html);
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
