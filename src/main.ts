import "./style.css";
import { select } from "d3";

const HTML_KEY = "dom-sim:html";
const CSS_KEY = "dom-sim:css";

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

const htmlInput = select<HTMLTextAreaElement, unknown>("#html-input");
const cssInput = select<HTMLTextAreaElement, unknown>("#css-input");

htmlInput.property("value", localStorage.getItem(HTML_KEY) ?? "");
cssInput.property("value", localStorage.getItem(CSS_KEY) ?? "");

function setTextareaValue(
  textarea: HTMLTextAreaElement,
  storageKey: string,
  value: string
) {
  textarea.value = value;
  localStorage.setItem(storageKey, value);
}

htmlInput.on("input", (event) => {
  const target = event.currentTarget as HTMLTextAreaElement | null;
  if (!target) return;
  localStorage.setItem(HTML_KEY, target.value);
});

cssInput.on("input", (event) => {
  const target = event.currentTarget as HTMLTextAreaElement | null;
  if (!target) return;
  localStorage.setItem(CSS_KEY, target.value);
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
